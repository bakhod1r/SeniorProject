# Sealed Interfaces — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Sealing Mechanism in Production](#the-sealing-mechanism-in-production)
3. [API Design Around Closed Type Sets](#api-design-around-closed-type-sets)
4. [Sealing Strategies for Libraries](#sealing-strategies-for-libraries)
5. [Multi-Package Architecture](#multi-package-architecture)
6. [ADT Modeling at Scale](#adt-modeling-at-scale)
7. [Migration Playbooks](#migration-playbooks)
8. [Exhaustiveness Tooling](#exhaustiveness-tooling)
9. [Embedding Caveat and Hardening](#embedding-caveat-and-hardening)
10. [Production Patterns Catalog](#production-patterns-catalog)
11. [Anti-Patterns Catalog](#anti-patterns-catalog)
12. [Performance Considerations](#performance-considerations)
13. [Summary](#summary)

---

## Introduction

A "sealed" interface in Go is an interface that contains at least one **unexported method**. Because the method name is unexported, only types declared in the **same package** can satisfy the interface. The Go language has no `sealed` keyword — sealing is an idiom, encoded in the visibility rules from the language specification (`§Exported_identifiers`, `§Method_sets`).

In production codebases sealing is used to:
- Enumerate a finite, closed set of variants — Algebraic Data Types (ADT) emulation.
- Protect parsers, compilers, and AST/IR layers from third-party extension.
- Lock the surface area of a public API while keeping the package extensible internally.
- Make exhaustive `switch` statements analyzable by linters.

Canonical standard-library users:
- `go/ast.Node`, `go/ast.Expr`, `go/ast.Stmt`, `go/ast.Decl`
- `go/types.Type`, `go/types.Object`
- `reflect.Type`
- `golang.org/x/tools/go/ssa.Value`, `ssa.Instruction`
- `database/sql/driver.Value` (semi-sealed via documentation)

This file covers the architectural decisions a senior or staff engineer makes when adopting sealing in a production system.

---

## The Sealing Mechanism in Production

### The minimum form

```go
package ast

// Node is the sealed root of every AST node in this package.
type Node interface {
    Pos() token.Pos
    End() token.Pos
    aNode() // unexported; sealing marker
}
```

`aNode()` is empty, has no semantics, and exists only to make the method name unexported. External packages cannot declare a method with that name on a foreign type, so they cannot satisfy `Node`.

### Naming convention

Two conventions dominate in the Go ecosystem:

| Convention | Example | Where used |
|---|---|---|
| `aXxx()` | `aNode()`, `aType()` | `go/ast`, `go/types` |
| `sealed()` or `isXxx()` | `isExpr()`, `sealed()` | application code |
| `<typeName>Node()` | `exprNode()`, `stmtNode()` | `go/ast` (per category) |

Pick one and apply it uniformly. In `go/ast` the prefixed-with-category form (`exprNode()`, `stmtNode()`, `declNode()`) lets a node belong to multiple sealed groups — `*ast.FuncLit` is both an `Expr` and an `ast.Node`.

### Implementation pattern: zero-cost marker

```go
type Expr interface {
    Node
    exprNode()
}

func (*BinaryExpr) exprNode() {}
func (*Ident)      exprNode() {}
func (*CallExpr)   exprNode() {}
```

Each implementation is a one-liner with an empty body. The compiler will emit it but the method is never called by the runtime — the inliner usually elides the entire stub.

### Where sealing breaks down

External code cannot **directly** implement the interface but it can **embed** any of your concrete types and inherit the sealing method:

```go
package thirdparty

type FakeExpr struct{ ast.Ident }   // embeds *ast.Ident? No — Ident is a struct
// type FakeExpr struct{ *ast.Ident }
// FakeExpr now satisfies ast.Expr through promotion
```

We address mitigation in [Embedding Caveat and Hardening](#embedding-caveat-and-hardening). For most production code the embedding loophole is acceptable because anyone who embeds your private type accepts the contract.

---

## API Design Around Closed Type Sets

### When to seal a public interface

Seal **only when the closed set is intentional**. Ask three questions before sealing:

1. *Does the meaning of "this interface" rely on the variants being exhaustively known?* — Yes for AST nodes, JSON values, currency types; No for `io.Reader`, `http.Handler`, `error`.
2. *Is exhaustive `switch` a real concern in caller code?* — If linters need to verify every case is handled, sealing is justified.
3. *Will adding a new variant be a controlled, versioned event?* — If a new variant arrives at every release, sealing is fine. If users must be free to add their own, do not seal.

### A decision matrix

| Question | Sealed | Open |
|---|---|---|
| Domain has finite, well-defined variants | yes | no |
| Users implement the interface | no | yes |
| Cross-package mocking via real implementations needed | no | yes |
| Cross-package mocking via test doubles only | yes | yes |
| Library acts as a closed system (parser, IR, language) | yes | no |
| Library acts as a hub (HTTP, RPC, plugin) | no | yes |

### Public marker vs private marker

If you want to allow embedding-based extension while still discouraging direct implementation, expose the marker but document it:

```go
// Node represents any node in the IR.
//
// Implementations must embed BaseNode to satisfy the contract. Direct
// implementation is unsupported; the interface may grow new methods in
// future versions and only embedded types are guaranteed to keep working.
type Node interface {
    Pos() token.Pos
    End() token.Pos
    isNode()
}

type BaseNode struct{}

func (BaseNode) isNode() {}
```

This pattern (popularized by `cuelang.org/go` and `go/ast.CommentGroup`) gives you both extensibility (via embedding) and forward compatibility (the interface can grow methods that have default implementations on `BaseNode`).

---

## Sealing Strategies for Libraries

### Strategy A: Hard seal, no extension

The strictest option — used by `go/ast`, `go/types`, and `cmd/compile`.

```go
package expr

type Expr interface {
    expr()
    String() string
}

type Lit  struct{ V int64 }
type Add  struct{ L, R Expr }
type Mul  struct{ L, R Expr }
type Neg  struct{ X Expr }

func (Lit) expr() {}
func (Add) expr() {}
func (Mul) expr() {}
func (Neg) expr() {}
```

Pros: fully controlled, exhaustive switches are reliable, package owners can refactor freely.
Cons: third parties cannot extend without forking.

### Strategy B: Soft seal via embedding

Permits extension but flags the contract.

```go
type ExprBase struct{}
func (ExprBase) expr() {}

type Expr interface {
    expr()
    String() string
}
```

Third-party code:

```go
type MyCustomExpr struct {
    expr.ExprBase
    Value string
}
func (m MyCustomExpr) String() string { return m.Value }
```

Pros: extensibility for advanced users, default behavior via base.
Cons: weakens exhaustiveness — linters cannot enumerate external implementations.

### Strategy C: Sealed by interface composition

Seal a domain interface but compose it from open ones. The open interfaces stay reusable; the sealed one becomes the contract for *your* algorithms.

```go
type Stringer interface{ String() string }
type Hasher   interface{ Hash() uint64 }

type Expr interface {
    Stringer
    Hasher
    expr()
}
```

`Stringer` and `Hasher` remain open and reusable across packages; only `Expr` is sealed.

### Strategy D: Sealed via internal package

Place the unexported marker inside `internal/`:

```go
// internal/sealed/seal.go
package sealed

// Mark is a sealing token. Embed it to satisfy the sealed contract.
type Mark struct{}
```

```go
// public/api.go
package api

import "yourmodule/internal/sealed"

type Expr interface {
    sealed.Mark
    Eval() int
}
```

This pattern lets multiple public packages share a single sealing primitive without exposing it. It is used in `go/internal/gcimporter` and `golang.org/x/tools/go/types/typeutil`.

---

## Multi-Package Architecture

### Sealed kernel + open extensions

Common in compilers and IDE tooling:

```
mylang/
├── ir/          // sealed: ir.Node, ir.Expr, ir.Stmt
├── parser/      // emits ir.* values
├── analyzer/    // pattern-matches ir.* with exhaustive switch
├── plugin/      // open: plugin.Pass interface (NOT sealed)
└── codegen/     // pattern-matches ir.*
```

The IR layer is sealed because:
- Adding a new IR node requires changing every analyzer pass — you want compile-time discoverability.
- Plugins extend behavior, not data. Behavior is open; data is closed.

### Spreading variants across files (still in one package)

Even with hundreds of variants, all sealed implementations must live in one package. Use **file-per-variant** organization:

```
ir/
├── node.go        // Node interface + sealing marker
├── expr.go        // Expr interface composition
├── expr_lit.go
├── expr_add.go
├── expr_call.go
├── stmt.go
├── stmt_if.go
├── stmt_for.go
└── visitor.go
```

This is exactly the structure of `go/ast`: one file per node category and per variant.

### Sealed across modules — not possible

You cannot split a sealed interface across two Go modules unless one re-exports the other's types. The unexported method anchors the seal to a single package.

If you need module-spanning sealing, choose between:
- A single module with sub-packages (recommended).
- A `internal/sealed` package that both modules import indirectly via the **same** root module.

You cannot seal across truly independent modules.

---

## ADT Modeling at Scale

### Real-world example: a JSON value type

```go
package jsonv

type Value interface {
    isValue()
    Type() Kind
}

type Kind int

const (
    KindNull Kind = iota
    KindBool
    KindNumber
    KindString
    KindArray
    KindObject
)

type Null   struct{}
type Bool   struct{ V bool }
type Number struct{ V float64 }
type String struct{ V string }
type Array  struct{ V []Value }
type Object struct{ V map[string]Value }

func (Null)   isValue() {}
func (Bool)   isValue() {}
func (Number) isValue() {}
func (String) isValue() {}
func (Array)  isValue() {}
func (Object) isValue() {}

func (Null)   Type() Kind { return KindNull }
func (Bool)   Type() Kind { return KindBool }
func (Number) Type() Kind { return KindNumber }
func (String) Type() Kind { return KindString }
func (Array)  Type() Kind { return KindArray }
func (Object) Type() Kind { return KindObject }
```

The seal lets a `Walk(v Value)` function safely assume it has covered every shape:

```go
func Walk(v Value, f func(Value)) {
    f(v)
    switch x := v.(type) {
    case Null, Bool, Number, String:
        // leaf; nothing to recurse into
    case Array:
        for _, e := range x.V { Walk(e, f) }
    case Object:
        for _, e := range x.V { Walk(e, f) }
    default:
        panic("unreachable: jsonv.Value sealed but unknown variant")
    }
}
```

The `default` arm is defensive: linters should never let it execute, but if a future maintainer adds a variant and forgets to update `Walk`, the panic surfaces fast.

### Real-world example: payment events

```go
package payments

type Event interface {
    isEvent()
    OccurredAt() time.Time
}

type Authorized struct {
    At     time.Time
    Amount Money
}

type Captured struct {
    At     time.Time
    Amount Money
    Auth   *Authorized
}

type Refunded struct {
    At     time.Time
    Amount Money
}

type Voided struct {
    At time.Time
}

func (Authorized) isEvent() {}
func (Captured)   isEvent() {}
func (Refunded)   isEvent() {}
func (Voided)     isEvent() {}

func (e Authorized) OccurredAt() time.Time { return e.At }
func (e Captured)   OccurredAt() time.Time { return e.At }
func (e Refunded)   OccurredAt() time.Time { return e.At }
func (e Voided)     OccurredAt() time.Time { return e.At }
```

A state machine that consumes events can pattern-match exhaustively:

```go
func (s *State) Apply(e Event) error {
    switch e := e.(type) {
    case Authorized: return s.applyAuth(e)
    case Captured:   return s.applyCapture(e)
    case Refunded:   return s.applyRefund(e)
    case Voided:     return s.applyVoid(e)
    }
    return fmt.Errorf("unknown event %T", e)
}
```

### Real-world example: SQL expression IR (mini-`go/ast`)

```go
package sqlir

type Expr interface {
    Node
    expr()
}

type Stmt interface {
    Node
    stmt()
}

type Node interface {
    Pos() Position
    aNode()
}

// Statements
type SelectStmt struct {
    Cols []Expr
    From *TableRef
    Where Expr
}
type InsertStmt struct {
    Table  *TableRef
    Values [][]Expr
}

// Expressions
type Ident      struct{ Name string }
type Literal    struct{ V any }
type BinaryExpr struct{ Op string; L, R Expr }
type FuncCall   struct{ Name string; Args []Expr }

func (*SelectStmt) aNode() {}
func (*InsertStmt) aNode() {}
func (*Ident)      aNode() {}
func (*Literal)    aNode() {}
func (*BinaryExpr) aNode() {}
func (*FuncCall)   aNode() {}

func (*SelectStmt) stmt() {}
func (*InsertStmt) stmt() {}

func (*Ident)      expr() {}
func (*Literal)    expr() {}
func (*BinaryExpr) expr() {}
func (*FuncCall)   expr() {}
```

This mirrors the multi-tier sealing pattern from `go/ast` (`Node` is the most general; `Expr`, `Stmt`, `Decl` are sealed sub-interfaces of `Node`).

---

## Migration Playbooks

### Playbook 1: Sealing an existing public interface — breaking

Adding an unexported method to an existing interface **breaks** every external implementor.

```go
// v1 — open
type Visitor interface {
    Visit(Node)
}

// v2 — sealed (BREAKING)
type Visitor interface {
    Visit(Node)
    visitor()  // unexported — every external impl breaks
}
```

This is a major-version bump. Steps:
1. Announce intent in `CHANGELOG.md` one minor version before.
2. Provide a `BaseVisitor` type that satisfies the new interface for users to embed.
3. Cut a new major version (`/v2`).

### Playbook 2: Soft migration via interface split

Keep the old interface open; add a new sealed one.

```go
// v1 stays open
type Visitor interface {
    Visit(Node)
}

// v2 adds a sealed sub-interface
type SealedVisitor interface {
    Visitor
    visitor()
}
```

Internal algorithms migrate to `SealedVisitor` over several minor versions. Old `Visitor` keeps working for external callers.

### Playbook 3: Adding a variant to a sealed type

Adding a new variant is **non-breaking** for users who only consume values, but **may break** users who pattern-match exhaustively without a `default` arm.

Steps:
1. Add the variant.
2. Update internal exhaustive switches.
3. Document in `CHANGELOG.md` under "New variants".
4. If you ship `staticcheck` directives or `go-exhaustive` config, ensure CI for downstream users will fail loudly so they can react.

### Playbook 4: Removing a variant

Removing a sealed variant is **always breaking** because pattern-matching code references the type by name.

Steps:
1. Mark the variant as `// Deprecated:`.
2. Make every internal site stop producing it.
3. Wait one or two minor versions.
4. Remove in a major version.

### Playbook 5: Renaming a sealed marker method

Internal-only change. Safe because external code cannot reference the unexported method anyway. Use `gofmt -r` or `gopls rename`.

---

## Exhaustiveness Tooling

Go has no native exhaustive `switch`. Tooling fills the gap.

### `nishanths/exhaustive`

```bash
go install github.com/nishanths/exhaustive/cmd/exhaustive@latest
exhaustive ./...
```

Originally for enums (`iota` constants), but with `-default-signifies-exhaustive=false` and the `//exhaustive:enforce` directive it can be wired to interface switches via separate analyzers.

### `go-exhaustive-interface` (community)

Several community linters implement interface-exhaustiveness. The reliable approach in production is to combine:

1. A list of sealed types maintained as a comment near the interface declaration.
2. A custom `golang.org/x/tools/go/analysis` analyzer that walks `*ast.TypeSwitchStmt` and verifies all case clauses cover the listed types.

### Hand-rolled analyzer skeleton

```go
package exhaustivesealed

import (
    "go/ast"
    "go/types"
    "golang.org/x/tools/go/analysis"
    "golang.org/x/tools/go/analysis/passes/inspect"
    "golang.org/x/tools/go/ast/inspector"
)

var Analyzer = &analysis.Analyzer{
    Name:     "exhaustivesealed",
    Doc:      "checks type switches over sealed interfaces are exhaustive",
    Requires: []*analysis.Analyzer{inspect.Analyzer},
    Run:      run,
}

func run(pass *analysis.Pass) (any, error) {
    insp := pass.ResultOf[inspect.Analyzer].(*inspector.Inspector)
    sealed := findSealedInterfaces(pass)

    insp.Preorder([]ast.Node{(*ast.TypeSwitchStmt)(nil)}, func(n ast.Node) {
        ts := n.(*ast.TypeSwitchStmt)
        // determine the interface type of the assertion
        // compare the set of case clauses to the known impls of that interface
        // emit a diagnostic if any impl is missing
        _ = ts; _ = sealed
    })
    return nil, nil
}
```

The full implementation needs to:
- Resolve the type of the type-switch expression.
- Look up all types implementing it within the sealing package (use `go/types.Implements`).
- Diff against the case clauses.

This is the same approach `go/analysis/passes/typeparams` uses internally.

### `staticcheck`

`staticcheck` does not yet have native sealed-exhaustiveness, but `S1034` and `SA9005` cover related concerns. Many teams couple a custom analyzer with the rest of `staticcheck`.

### CI integration

```yaml
# .golangci.yml
linters:
  enable:
    - exhaustive
    - exhaustivestruct
    - staticcheck
linters-settings:
  exhaustive:
    default-signifies-exhaustive: false
    check-generated: false
    package-scope-only: true
```

Run on every PR. Fail the build if exhaustiveness is violated.

---

## Embedding Caveat and Hardening

### The loophole

```go
// your library
package ir

type Expr interface { expr() }

type BaseExpr struct{}
func (BaseExpr) expr() {}

// third-party code
package external

type Evil struct {
    ir.BaseExpr  // satisfies ir.Expr through promotion
    Wickedness string
}
```

Any exported type whose method set contains an unexported sealing marker becomes a vehicle for embedding-based extension.

### Hardening 1: Don't expose any concrete type with the marker

Make every implementation an unexported struct with an exported constructor:

```go
package ir

type Expr interface{ expr() }

type literal struct{ V int64 }
func (literal) expr() {}

func NewLiteral(v int64) Expr { return literal{V: v} }
```

External code cannot embed `literal`, so the seal holds. But callers also cannot pattern-match by struct name from outside — they must call accessor methods. This is the trade-off `go/types` chose: every `types.Type` is accessed via methods, not field access.

### Hardening 2: Marker on a private wrapper

```go
package ir

type sealedMark struct{}
func (sealedMark) expr() {}

type Expr interface{ expr() }

type Add struct {
    sealedMark
    L, R Expr
}
```

`sealedMark` is unexported, so external code cannot embed it. But `Add` is exported — and any field of `Add` is a `sealedMark`, but you cannot embed `Add` from outside without reproducing the sealedMark, which is impossible.

Wait — external code *can* embed `ir.Add`:

```go
type Evil struct{ ir.Add }   // Evil satisfies Expr
```

Hardening 2 alone is insufficient. Combine it with Hardening 1.

### Hardening 3: Runtime type guard

```go
func mustBeMine(e Expr) {
    switch e.(type) {
    case Lit, Add, Mul, Neg:
        return
    }
    panic("ir: foreign Expr implementation")
}
```

Use sparingly — it is a runtime check rather than a compile-time guarantee. Acceptable in compilers and parsers where the cost is dominated by other work.

### Practical recommendation

For most production libraries:
- Use the simplest sealing form (interface with `aXxx()` marker).
- Accept the embedding loophole — it is rarely exploited by accident.
- Document the contract: "Direct implementation outside this package is unsupported."

The Go standard library makes this exact choice. `go/ast.Node` is technically embeddable, but no production code does it because the consequences are clearly unsupported.

---

## Production Patterns Catalog

### Pattern 1: Sealed visitor

```go
type ExprVisitor interface {
    visitor()
    VisitLit(*Lit)
    VisitAdd(*Add)
    VisitMul(*Mul)
    VisitNeg(*Neg)
}

func Walk(v ExprVisitor, e Expr) {
    switch e := e.(type) {
    case *Lit: v.VisitLit(e)
    case *Add: v.VisitAdd(e); Walk(v, e.L); Walk(v, e.R)
    case *Mul: v.VisitMul(e); Walk(v, e.L); Walk(v, e.R)
    case *Neg: v.VisitNeg(e); Walk(v, e.X)
    }
}
```

The visitor itself is sealed so the library author can add new `VisitXxx` methods without breaking external visitors that embed `BaseVisitor`.

### Pattern 2: Sealed event log

```go
type Event interface{ event() }

type Log struct {
    events []Event
}

func (l *Log) Append(e Event) { l.events = append(l.events, e) }

func (l *Log) Replay(state any) {
    for _, e := range l.events {
        switch e := e.(type) {
        case UserCreated: applyUserCreated(state, e)
        case UserUpdated: applyUserUpdated(state, e)
        case UserDeleted: applyUserDeleted(state, e)
        }
    }
}
```

Sealed events guarantee the replay function covers every case — verifiable by an exhaustiveness linter.

### Pattern 3: Sealed result type

```go
type Result interface{ result() }

type Ok[T any] struct{ Value T }
type Err       struct{ Error error }

func (Ok[T]) result() {}
func (Err)   result() {}
```

A `Result` ADT mirrors Rust/Haskell-style error handling. Mostly idiomatic Go prefers `(T, error)`, but in pipelines of fallible transformations a sealed `Result` is cleaner.

### Pattern 4: Sealed state machine

```go
type State interface{ state() }

type Idle    struct{}
type Running struct{ Started time.Time }
type Done    struct{ Result string }
type Failed  struct{ Err error }

func (Idle)    state() {}
func (Running) state() {}
func (Done)    state() {}
func (Failed)  state() {}

type Machine struct{ s State }

func (m *Machine) Transition(input Event) {
    switch s := m.s.(type) {
    case Idle:    m.s = m.fromIdle(s, input)
    case Running: m.s = m.fromRunning(s, input)
    case Done:    // terminal
    case Failed:  // terminal
    }
}
```

Each transition handler returns a `State`. The compiler plus an exhaustiveness linter ensure every state has a handler.

### Pattern 5: Sealed configuration variant

```go
type DataSource interface{ dataSource() }

type FileSource struct{ Path string }
type S3Source   struct{ Bucket, Key string }
type HTTPSource struct{ URL string }

func (FileSource) dataSource() {}
func (S3Source)   dataSource() {}
func (HTTPSource) dataSource() {}

type Config struct {
    Sources []DataSource
}
```

A finite set of allowed configurations. New source types require a release.

---

## Anti-Patterns Catalog

### Anti-pattern 1: Sealing an interface that should be open

```go
// BAD — http.Handler-style interface, sealed
type Middleware interface {
    Wrap(http.Handler) http.Handler
    middleware()
}
```

Middleware is the canonical extension point. Sealing kills the ecosystem. Reserve sealing for closed type families.

### Anti-pattern 2: Sealing without exhaustive checks

```go
type Expr interface{ expr() }

func Eval(e Expr) int {
    switch e := e.(type) {
    case Lit: return e.V
    case Add: return Eval(e.L) + Eval(e.R)
    }
    return 0  // silently swallows new variants
}
```

If you seal, commit to exhaustive switches. Otherwise the seal gives no benefit over an open interface.

### Anti-pattern 3: Sealing across packages by accident

```go
// pkg a
type Expr interface{ expr() }

// pkg b
type MyExpr struct{}
func (MyExpr) expr() {}    // compile error — wait, no, it compiles!
                           // BUT b.expr() != a.expr() — different identifier
```

If you misread the rules and create a same-named unexported method in another package, you have not satisfied the original interface — you have created a different one. Verify with `var _ a.Expr = b.MyExpr{}`.

### Anti-pattern 4: Marker method that returns something useful

```go
type Expr interface {
    expr() string  // BAD — gives meaning to the marker
}
```

The marker should be `func() expr()` with no result. Returning data couples the marker to behavior and makes refactoring harder.

### Anti-pattern 5: Public marker

```go
type Expr interface {
    Expr()  // public — every random type can satisfy it
}
```

Defeats the purpose. The marker must be unexported.

### Anti-pattern 6: Multiple competing markers

```go
type Expr interface {
    expr1()
    expr2()
    expr3()
}
```

One marker is sufficient. More than one adds boilerplate without security.

### Anti-pattern 7: Marker called on the hot path

```go
func Optimize(e Expr) Expr {
    e.expr()  // calling the marker — pointless
    ...
}
```

The marker exists for compile-time reasons. Never call it at runtime.

---

## Performance Considerations

### Marker method overhead

The unexported marker method is empty. The compiler:
- Generates a small function body (typically the function epilogue only).
- Inlines it everywhere it can — with `-gcflags=-m` you'll see `can inline (*Lit).expr`.
- Includes it in the type's `itab` along with all other methods.

The runtime cost is **zero** in any realistic profile. The main impact is binary size: each implementation contributes one tiny function. For ASTs with hundreds of node types this can add a few KB to the binary.

### Type switch vs interface dispatch

A type switch over a sealed interface compiles to a sequence of comparisons against `*itab` pointers. For a small number of cases (less than ~8) the compiler emits a linear search; for larger sets it may emit a binary search or a jump table.

Benchmark from a real `go/ast`-style switch with 12 cases:

```
BenchmarkTypeSwitch_12cases    250M    4.2 ns/op
BenchmarkVirtualDispatch       300M    3.4 ns/op
```

Visitor pattern (virtual dispatch through the sealed visitor interface) is usually faster than type switch for hot paths with many cases. Sealed marker plus visitor is the canonical compiler design.

### Memory layout

Sealed interface values have the standard Go interface layout: a `(*itab, *data)` pair, 16 bytes on 64-bit platforms. The interface header is the same regardless of sealing.

A sealed concrete type with only an embedded marker (`type Lit struct{ V int64 }` plus `func (Lit) expr() {}`) has the same memory footprint as one without the marker — empty methods do not consume struct memory.

### `BaseExpr` embedding cost

Embedding `BaseExpr struct{}` adds zero bytes (Go specifies size-zero structs). Embedding is the cheapest way to share the marker.

---

## Cheat Sheet

```
SEALING DECISION
────────────────────────────
Closed type family    → seal
Plugin extension point → don't seal
Mocking surface        → don't seal (use test doubles)
AST/IR layer           → seal
HTTP middleware        → don't seal
Domain ADT             → seal

NAMING CONVENTION
────────────────────────────
aNode() / aType()     — go/ast, go/types
exprNode() / stmtNode()— go/ast (per category)
isXxx() / sealed()    — application code
Pick ONE; apply uniformly

EMBEDDING DEFENSE
────────────────────────────
Best: hide every concrete type behind constructors
Good: document "no direct implementation"
OK:   accept the loophole — most code is honest

EXHAUSTIVENESS TOOLING
────────────────────────────
nishanths/exhaustive
golangci-lint with `exhaustive`
custom analyzer via golang.org/x/tools/go/analysis

MIGRATION
────────────────────────────
Add variant   → minor (informational)
Remove variant → major (deprecate first)
Add marker    → major (BREAKING)
Remove marker → major (BREAKING — silently widens)

CANONICAL EXAMPLES
────────────────────────────
go/ast.Node, ast.Expr, ast.Stmt, ast.Decl
go/types.Type, types.Object
reflect.Type
golang.org/x/tools/go/ssa.Value, ssa.Instruction
```

---

## Summary

Sealing in Go is not a language feature — it is an idiom built on the unexported-method visibility rule from the spec. Production use boils down to:

1. **Decide intent** — seal only when the closed type set is part of the design contract.
2. **Choose strategy** — hard seal (`go/ast` style) or soft seal (embeddable base) depending on extension policy.
3. **Organize the package** — file-per-variant, sealed kernel, open extensions.
4. **Tooling** — pair sealing with an exhaustiveness analyzer or accept silent gaps.
5. **Migration** — sealing a public interface is breaking; plan the major version.
6. **Trade-offs** — the embedding loophole is real; mitigate via constructor APIs.
7. **Performance** — sealing has effectively zero runtime cost; visitor pattern outperforms type switch on hot paths.

The standard library's `go/ast`, `go/types`, `reflect`, and SSA tooling all rely on sealing. When you adopt the pattern, you join a long-standing Go tradition for closed, exhaustively analyzable type hierarchies.
