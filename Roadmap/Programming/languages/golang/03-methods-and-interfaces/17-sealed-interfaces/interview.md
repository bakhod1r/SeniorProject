# Sealed Interfaces — Interview Questions

## Table of Contents
1. [Junior-Level Questions](#junior-level-questions)
2. [Middle-Level Questions](#middle-level-questions)
3. [Senior-Level Questions](#senior-level-questions)
4. [Tricky / Curveball Questions](#tricky-curveball-questions)
5. [Coding Tasks](#coding-tasks)
6. [System Design Style](#system-design-style)
7. [Standard Library Trivia](#standard-library-trivia)
8. [What Interviewers Look For](#what-interviewers-look-for)

---

## Junior-Level Questions

### Q1: Does Go have a `sealed` keyword?

**Answer:** No. Sealing is an **idiom**, not a language feature. It is implemented by adding an unexported method to an interface — only types in the same package can satisfy it because of identifier visibility rules.

```go
type Expr interface {
    expr() // unexported — sealing marker
}
```

### Q2: What is the purpose of the unexported method in a sealed interface?

**Answer:** The unexported method (often called the "sealing marker") prevents code in other packages from satisfying the interface. Because the method name is unexported, it can only be declared by types in the same package.

### Q3: Give an example of a sealed interface in the standard library.

**Answer:** `go/ast.Expr`, `go/ast.Stmt`, `go/ast.Decl` (each has an unexported `exprNode()`, `stmtNode()`, `declNode()` method). Also `go/types.Object` and (effectively) `reflect.Type`.

### Q4: Can you call the unexported sealing method from outside the package?

**Answer:** No. Unexported identifiers are not accessible from other packages — that is precisely what makes the seal work.

### Q5: What is the typical body of a sealing marker?

**Answer:** Empty. The method exists only as a compile-time marker.

```go
func (Lit) expr() {}
```

It is never called at runtime.

### Q6: Why use a sealed interface instead of an open one?

**Answer:** When the type set is intentionally **closed** — for example, the variants of an AST node or the cases of an Algebraic Data Type. Closing the set:
- Allows exhaustive `switch` reasoning.
- Makes refactoring safer (the package owner controls every variant).
- Documents the intent.

### Q7: Can a sealed interface have other methods besides the marker?

**Answer:** Yes — and it usually does. The marker is one of several methods.

```go
type Expr interface {
    Pos() Position
    String() string
    expr()  // sealing marker
}
```

### Q8: What happens if I try to implement a sealed interface from another package?

**Answer:** The compiler reports something like:

```
cannot use Foo{} (type Foo) as type p.Expr:
    Foo does not implement p.Expr (missing expr method)
```

Your `Foo` cannot be made to satisfy the interface because the sealing method is in a different package's namespace.

### Q9: What is an ADT?

**Answer:** Algebraic Data Type — a type defined as a finite, exhaustive list of variants. In Haskell or Rust this is a language feature (`enum`, `data`). In Go we emulate it with a sealed interface plus several concrete types.

```go
type JSONValue interface{ jsonValue() }
type Null struct{}
type Bool struct{ V bool }
type Number struct{ V float64 }
// ...
```

### Q10: Give the simplest possible sealed interface example.

**Answer:**

```go
package shape

type Shape interface { shape() }

type Circle struct{ R float64 }
type Square struct{ S float64 }

func (Circle) shape() {}
func (Square) shape() {}
```

---

## Middle-Level Questions

### Q11: Why does `go/ast` use multiple sealing markers (`exprNode`, `stmtNode`, `declNode`) instead of one?

**Answer:** Each marker corresponds to a distinct sealed interface — `Expr`, `Stmt`, `Decl`. A node can be a member of more than one (rare, but `*ast.FuncLit` is both an `Expr` and acts as a function literal). Multiple markers let the package express several closed type families that overlap.

### Q12: What is the embedding loophole?

**Answer:** External code can embed an exported sealed type and inherit its sealing method via promotion:

```go
// pkg p
type Expr interface{ expr() }
type Lit struct{ V int }
func (Lit) expr() {}

// pkg q
type EvilLit struct{ p.Lit }   // satisfies p.Expr through promotion
```

The seal is broken in the sense that a foreign type now satisfies the interface. Mitigations include not exporting concrete types (use constructors that return the interface) or accepting the loophole because honest callers will not exploit it.

### Q13: How do you mitigate the embedding loophole?

**Answer:** Three approaches:
1. **Hide concrete types** — export only constructors and the interface; keep struct types unexported.
2. **Document the contract** — state that direct or embedded implementation outside the package is unsupported.
3. **Runtime guard** — type-switch on known variants and panic on `default` (rarely worth the cost).

`go/ast` uses approach 2 — concrete types are exported, but no production code embeds them.

### Q14: Why does Go not provide native exhaustive `switch`?

**Answer:** Go's design philosophy favors keeping the language small and pushing such checks to tooling. Exhaustiveness is enforceable by external analyzers (`nishanths/exhaustive`, custom `go/analysis` passes) without burdening the language spec or the compiler.

### Q15: How do you write an exhaustiveness lint check for sealed interfaces?

**Answer:** Build an analyzer with `golang.org/x/tools/go/analysis`:

1. Walk every `*ast.TypeSwitchStmt` in the program.
2. Resolve the switched expression's type.
3. If it is a sealed interface, list the implementations within its package using `go/types`.
4. Diff against the case clauses; report any missing implementor.

The analyzer can be added to `golangci-lint` or run standalone in CI.

### Q16: When should you NOT seal an interface?

**Answer:**
- The interface is an extension point (`io.Reader`, `http.Handler`).
- Users need to provide their own implementations.
- The type set is naturally open (mockable services, plugins).
- You want broad ecosystem compatibility.

Sealing here is a design mistake — it kills the ecosystem.

### Q17: When IS sealing the right choice?

**Answer:**
- Algebraic data types (variants of an expression, JSON value, AST).
- Compiler/parser IRs.
- Domain types with finite, well-defined cases (payment events, order states).
- Library APIs where exhaustiveness checks matter.

### Q18: Compare sealed interfaces to the visitor pattern.

**Answer:** Both solve the closed-set problem.

| Aspect | Sealed interface + type switch | Visitor pattern |
|---|---|---|
| Adding a new variant | requires updating every switch | requires updating every visitor |
| Adding a new operation | new function with type switch | requires updating every concrete type |
| Performance | type switch O(n) cases | virtual dispatch O(1) |
| Idiomatic in Go | yes | possible but verbose |

In Go, sealed interface + type switch is more common. Visitor is used when the operation set is also closed (e.g., compiler passes).

### Q19: What does `types.Implements` do?

**Answer:** From `go/types`, it reports whether a given type satisfies an interface, taking unexported methods into account. For sealed interfaces, only types declared in the sealing package will satisfy.

```go
import "go/types"

types.Implements(t, iface) // bool
```

### Q20: Can a generic interface be sealed?

**Answer:** Yes. Type parameters do not affect sealing.

```go
type Container[T any] interface {
    container()
    Get() T
}
```

Only types in the defining package can satisfy `Container[T]` for any `T`.

---

## Senior-Level Questions

### Q21: Why does `ast.Node` use sealing while `error` does not?

**Answer:** `error` is an open extension point — every package needs to define its own error types. Restricting the implementations would break the language.

`ast.Node` represents the closed grammar of Go source code. Adding a node type changes the language, which the `go/ast` maintainers do deliberately. External packages adding ad-hoc node types would corrupt downstream tools (`gofmt`, `go/types`, `go/parser`).

The decision rule: seal types that are part of a fixed schema; leave open types that are part of an extensibility contract.

### Q22: Walk through how you would migrate an existing public interface to be sealed.

**Answer:** This is a **breaking change**. Steps:

1. Announce the change one or two minor releases ahead in `CHANGELOG.md`.
2. Provide a `Base*` embeddable type that satisfies the new interface, so users have a clean migration path.
3. Cut a new major version (`/v2`).
4. In v2, add the unexported method to the interface.
5. Document migration: "embed `BaseFoo` in your custom `Foo` implementations."

If breaking is unacceptable, keep the original interface open and add a new sealed sibling interface for internal use.

### Q23: Sealed interfaces vs error wrapping — when do they meet?

**Answer:** When errors form a finite hierarchy. For example, a parser may have a closed set of error categories:

```go
type ParseError interface {
    error
    parseError()
    Token() Token
}

type SyntaxError      struct{ ... }
type SemanticError    struct{ ... }
type UnexpectedEOF    struct{ ... }
```

Callers can exhaustively switch on parser errors. Combined with `errors.As`, this gives precise, type-safe error handling for a closed domain. For open error types (`io.EOF`, `os.PathError`), use the standard `error` interface and `errors.Is`/`errors.As`.

### Q24: How does the seal interact with `interface{}` (or `any`)?

**Answer:** A sealed interface value can always be assigned to `any`. From `any`, you can type-assert back to the sealed interface:

```go
var a any = Lit{}
if e, ok := a.(p.Expr); ok { ... }
```

The seal applies at the **declaration site**, not the use site. Once a value is in `any`, you can pass it anywhere; you cannot use that to **create** a sealed-interface implementation in a foreign package.

### Q25: Why is the sealing method usually declared with a value receiver?

**Answer:** Because the method set rule states:
- Value receiver → method is in the method set of both `T` and `*T`.
- Pointer receiver → method is in the method set of `*T` only.

Declaring the marker with a value receiver means both `T` and `*T` satisfy the interface, giving callers flexibility.

```go
func (Lit) expr()  {}    // both Lit and *Lit satisfy
func (*Lit) expr() {}    // only *Lit satisfies — usually undesired
```

### Q26: How do you use `go/types` to check that a sealed interface is exhaustively switched?

**Answer:**

```go
func isSealed(iface *types.Interface) (bool, *types.Package) {
    for i := 0; i < iface.NumMethods(); i++ {
        m := iface.Method(i)
        if !m.Exported() {
            return true, m.Pkg()
        }
    }
    return false, nil
}

func implementations(iface *types.Interface, pkg *types.Package) []types.Type {
    var impls []types.Type
    for _, name := range pkg.Scope().Names() {
        t := pkg.Scope().Lookup(name).Type()
        if types.Implements(t, iface) {
            impls = append(impls, t)
        }
        if pt := types.NewPointer(t); types.Implements(pt, iface) {
            impls = append(impls, pt)
        }
    }
    return impls
}
```

Then compare each `*ast.TypeSwitchStmt`'s case clauses against the implementations.

### Q27: What does `reflect.Type.PkgPath()` return for a sealing marker?

**Answer:** The import path of the package where the unexported method was declared. For exported methods, `PkgPath` is the empty string; unexported methods always have a non-empty `PkgPath`. This is the runtime trace of the seal.

```go
t := reflect.TypeOf(ast.BasicLit{})
for i := 0; i < t.NumMethod(); i++ {
    m := t.Method(i)
    if m.PkgPath != "" {
        // unexported, possibly a sealing marker
        fmt.Println(m.Name, "in", m.PkgPath)
    }
}
```

### Q28: Performance of type switch over a sealed interface vs visitor dispatch?

**Answer:** Type switch compiles to a sequence of itab pointer comparisons. For small case counts (under ~8) it is linear; the compiler may pick a jump table for larger sets.

Visitor dispatch goes through the interface table directly — one virtual call. For hot paths with many variants, the visitor pattern is typically 10-30% faster.

In practice, both are below 5 ns/op on modern x86-64; the difference rarely matters.

### Q29: Can you seal an interface across multiple packages?

**Answer:** No, not directly. The unexported method is bound to one package. Workarounds:

1. **Internal package** — put the marker in `internal/sealed`; both public packages depend on it.
2. **Single root package with sub-packages** — collapse into one logical module.
3. **Re-exports** — one package re-exports types from another, but the seal still belongs to the defining package.

True module-spanning sealing is not possible.

### Q30: Sealed interface plus generics — what subtleties arise?

**Answer:**

```go
type Result[T any] interface {
    result()
    Get() (T, error)
}
```

Pitfalls:
- A `Result[int]` and a `Result[string]` are different types; you cannot type-switch one as the other.
- Constraint `comparable` combined with sealing requires every implementation to be comparable.
- Method set rules are unchanged.

### Q31: Discuss API stability of sealed interfaces.

**Answer:**

| Change | Breaking? |
|---|---|
| Add a variant | mostly safe; breaks exhaustive switches without `default` |
| Remove a variant | breaking |
| Add a method to the interface | breaking |
| Remove a method | breaking |
| Rename the marker | not breaking (unexported, callers cannot reference it) |
| Add a marker to an open interface | breaking — every external implementor breaks |

Treat sealing as a **firm versioning commitment**.

### Q32: How does `go/types.Type` differ from `go/ast.Node` regarding sealing?

**Answer:** `ast.Node` is technically not sealed (no unexported method on `Node` itself); seals live on `Expr`, `Stmt`, `Decl`. `types.Type` is "soft sealed" — by documentation rather than an unexported method. New implementations would compile, but the package's algorithms switch on the known set.

The lesson: sealing is a contract, not always a hard compile-time guarantee. Soft sealing via documentation is acceptable when the set is large and stable enough.

### Q33: What is the idiomatic naming for the sealing marker?

**Answer:** Three common conventions:

1. **`aType()` / `aNode()`** — used in `go/ast`, `go/types`. Concise.
2. **`<category>Node()`** — used in `go/ast` for category-specific seals: `exprNode`, `stmtNode`, `declNode`.
3. **`isXxx()` or `sealed()`** — used in application code. Self-documenting.

Pick one convention per package and apply uniformly.

### Q34: Sealed interface vs typed enum — which is better?

**Answer:**

```go
// typed enum
type Status int
const (
    Pending Status = iota
    Active
    Closed
)

// sealed ADT
type Status interface { status() }
type Pending struct{}
type Active  struct{ since time.Time }
type Closed  struct{ reason string }
```

Use **typed enum** when variants carry no data — just labels.
Use **sealed ADT** when each variant carries different data.

### Q35: How would you test that no foreign type implements your sealed interface?

**Answer:**

```go
package p_test

import (
    "go/types"
    "go/ast"
    "go/parser"
    "go/token"
    "golang.org/x/tools/go/packages"
    "testing"
)

func TestSealed(t *testing.T) {
    cfg := &packages.Config{Mode: packages.NeedTypes | packages.NeedSyntax}
    pkgs, _ := packages.Load(cfg, "./...")
    var iface *types.Interface
    for _, pkg := range pkgs {
        if pkg.PkgPath == "yourmodule/p" {
            obj := pkg.Types.Scope().Lookup("Expr")
            iface = obj.Type().Underlying().(*types.Interface)
        }
    }
    // Walk every type in every package; assert types.Implements is true
    // only for types from package p.
}
```

In practice, document the seal and rely on review rather than tests.

---

## Tricky / Curveball Questions

### Q36: What does this code print?

```go
package main

type Expr interface{ expr() }
type Lit struct{ V int }
func (Lit) expr() {}

func main() {
    var e Expr = Lit{V: 7}
    switch v := e.(type) {
    case Lit:
        println(v.V)
    }
}
```

- a) 7
- b) compile error (Lit is in a different package)
- c) panic
- d) no output

**Answer: a — 7.** Everything is in the same package; the seal is satisfied trivially.

### Q37: What does this code do?

```go
// pkg p
type Expr interface { expr() }
type Lit struct{}
func (Lit) expr() {}

// pkg q
type Foo struct { p.Lit }   // embeds p.Lit
```

Does `Foo` satisfy `p.Expr`?

- a) Yes
- b) No
- c) Compile error
- d) Runtime check needed

**Answer: a — Yes.** The sealing method is promoted through embedding. This is the embedding loophole.

### Q38: Spot the bug.

```go
type Expr interface{ expr() }
type Lit struct{ V int }
func (l *Lit) expr() {}

func main() {
    var e Expr = Lit{V: 7}   // does this compile?
}
```

**Answer:** Compile error. `expr` has a pointer receiver, so only `*Lit` is in the interface's required method set. Either use `&Lit{V: 7}` or change the receiver to value.

### Q39: Why is the marker method usually empty?

- a) Speed
- b) Mandated by the spec
- c) It is never called; only the existence of the method matters
- d) It is a Go style requirement

**Answer: c — it exists for compile-time checks only.** Putting code in it is wasteful and obscures intent.

### Q40: Can I seal an interface using a private struct as a marker parameter?

```go
type private struct{}
type Expr interface { expr(private) }
```

**Answer:** Yes — even more locked down. External callers cannot construct `private` because it is unexported. This is occasionally seen in security-critical code but is overkill in most cases.

### Q41: True or false: a sealed interface cannot be embedded in another interface.

**Answer: False.** It can be embedded, but the seal is preserved. The embedding interface is also sealed (transitively).

```go
type Foo interface { Expr; foo() }   // Foo also sealed
```

### Q42: True or false: a sealed interface can have only one implementation.

**Answer: False.** A sealed interface can have any number of implementations, all in the same package.

### Q43: What is the difference between sealing and `interface{}` with a private wrapper struct?

**Answer:** They are different patterns.

- **Sealing** — restricts who can implement an interface.
- **Private wrapper** — `type Handle struct { internal *something }` hides the implementation behind an opaque token.

You can combine them: a sealed interface where every concrete type is also unexported is the most locked-down form.

### Q44: Why does the standard library not seal `error`?

**Answer:** `error` is the universal extension point for every Go program. Sealing it would force all error types into a single package, which is impossible. `error` is the canonical example of an open interface.

### Q45: Can `database/sql/driver.Value` be considered sealed?

**Answer:** Soft-sealed by documentation. The `driver.Value` interface is `interface{}` with a documented constraint:

```go
// Value is a value that drivers must be able to handle.
// It is either nil, a type handled by a database driver's NamedValueChecker
// interface, or an instance of one of these types:
//   int64
//   float64
//   bool
//   []byte
//   string
//   time.Time
```

There is no compile-time enforcement; the constraint is documented and respected by convention.

---

## Coding Tasks

### Task 1: Build a sealed expression ADT

Build an `Expr` ADT with `Lit`, `Add`, `Mul`, `Neg`, and an `Eval(Expr) int` function.

**Solution:**

```go
package expr

type Expr interface{ expr() }

type Lit struct{ V int }
type Add struct{ L, R Expr }
type Mul struct{ L, R Expr }
type Neg struct{ X Expr }

func (Lit) expr() {}
func (Add) expr() {}
func (Mul) expr() {}
func (Neg) expr() {}

func Eval(e Expr) int {
    switch e := e.(type) {
    case Lit: return e.V
    case Add: return Eval(e.L) + Eval(e.R)
    case Mul: return Eval(e.L) * Eval(e.R)
    case Neg: return -Eval(e.X)
    }
    panic("unreachable")
}
```

### Task 2: Build a sealed JSON value type

Build a `Value` ADT covering JSON shapes and a `Walk(Value, func(Value))` function.

**Solution:**

```go
package jsonv

type Value interface{ jsonValue() }

type Null   struct{}
type Bool   struct{ V bool }
type Number struct{ V float64 }
type String struct{ V string }
type Array  struct{ V []Value }
type Object struct{ V map[string]Value }

func (Null)   jsonValue() {}
func (Bool)   jsonValue() {}
func (Number) jsonValue() {}
func (String) jsonValue() {}
func (Array)  jsonValue() {}
func (Object) jsonValue() {}

func Walk(v Value, f func(Value)) {
    f(v)
    switch x := v.(type) {
    case Array:
        for _, e := range x.V { Walk(e, f) }
    case Object:
        for _, e := range x.V { Walk(e, f) }
    }
}
```

### Task 3: Build a sealed event log with replay

```go
package events

import "time"

type Event interface{ event() }

type Created struct{ ID string; At time.Time }
type Updated struct{ ID string; Field, Value string; At time.Time }
type Deleted struct{ ID string; At time.Time }

func (Created) event() {}
func (Updated) event() {}
func (Deleted) event() {}

type State struct{ Records map[string]map[string]string }

func (s *State) Apply(e Event) {
    switch e := e.(type) {
    case Created:
        s.Records[e.ID] = map[string]string{}
    case Updated:
        if r, ok := s.Records[e.ID]; ok {
            r[e.Field] = e.Value
        }
    case Deleted:
        delete(s.Records, e.ID)
    }
}
```

### Task 4: Mini AST mirroring `go/ast`

```go
package mini

import "fmt"

type Node interface { aNode(); String() string }

type Expr interface { Node; expr() }
type Stmt interface { Node; stmt() }

// Expressions
type Ident   struct{ Name string }
type IntLit  struct{ V int64 }
type Binary  struct{ Op string; L, R Expr }

// Statements
type Assign  struct{ Lhs *Ident; Rhs Expr }
type If      struct{ Cond Expr; Then, Else Stmt }
type Block   struct{ Stmts []Stmt }

func (*Ident)  aNode() {}
func (*IntLit) aNode() {}
func (*Binary) aNode() {}
func (*Assign) aNode() {}
func (*If)     aNode() {}
func (*Block)  aNode() {}

func (*Ident)  expr() {}
func (*IntLit) expr() {}
func (*Binary) expr() {}

func (*Assign) stmt() {}
func (*If)     stmt() {}
func (*Block)  stmt() {}

func (i *Ident)  String() string { return i.Name }
func (l *IntLit) String() string { return fmt.Sprint(l.V) }
func (b *Binary) String() string {
    return fmt.Sprintf("(%s %s %s)", b.L.String(), b.Op, b.R.String())
}
func (a *Assign) String() string {
    return fmt.Sprintf("%s = %s", a.Lhs.String(), a.Rhs.String())
}
func (i *If) String() string { return "if ..." }
func (b *Block) String() string {
    out := "{ "
    for _, s := range b.Stmts { out += s.String() + "; " }
    return out + "}"
}
```

### Task 5: Sealed `Result[T]` ADT

```go
package result

type Result[T any] interface{ result() }

type Ok[T any] struct{ V T }
type Err[T any] struct{ E error }

func (Ok[T])  result() {}
func (Err[T]) result() {}

func Map[T, U any](r Result[T], f func(T) U) Result[U] {
    switch r := r.(type) {
    case Ok[T]:  return Ok[U]{V: f(r.V)}
    case Err[T]: return Err[U]{E: r.E}
    }
    panic("unreachable")
}
```

---

## System Design Style

### Q46: Design a sealed expression language for a query engine.

**Answer:** Use a sealed `Expr` interface with categories: literals, references, calls, binary ops, unary ops. Wrap each category with its own sealed marker. Keep the IR in one package; expose construction via factory functions; lock down concrete struct types if possible. Pair with an exhaustive analyzer in CI to ensure every analyzer pass handles every variant.

```go
package queryir

type Expr interface { expr() }
type Lit struct { Value any }
type Ref struct { Column string }
type Call struct { Name string; Args []Expr }
type BinOp struct { Op string; L, R Expr }

func (Lit) expr()   {}
func (Ref) expr()   {}
func (Call) expr()  {}
func (BinOp) expr() {}
```

Analyzer passes (`SimplifyConstants`, `PushDownPredicates`, `EstimateCost`) all use exhaustive switches.

### Q47: Migration plan for sealing an open `Visitor` interface in a published library.

**Answer:**

1. Audit external implementations (search GitHub, GoDoc).
2. Provide `BaseVisitor` struct with all current methods as no-ops.
3. Add `// Deprecated: embed BaseVisitor` to current public methods.
4. Wait one minor release.
5. In v2 (major bump), add the sealing marker to the interface and require `BaseVisitor` embedding.
6. Document migration in CHANGELOG with code examples.

### Q48: Trade-off between sealed interface + type switch and the visitor pattern.

**Answer:**

- **Sealed + type switch**: easier to add operations (just write a new function with a switch); harder to add variants (must update every switch).
- **Visitor**: easier to add variants (one new struct + one new visitor method); harder to add operations (must update every visitor implementation).

The choice depends on which axis evolves faster. AST-style code (variants stable, many operations) prefers type switch. Compiler passes (variants stable, many passes) often combine both.

### Q49: When does a sealed type cause a memory or binary size concern?

**Answer:** Each sealed implementation contributes a tiny method to the binary. For ASTs with hundreds of variants, this can add tens of KB. The interface table for each variant is also small but real (~80 bytes per concrete-interface pair on x86-64).

Concerns appear in:
- Embedded systems (constrained binary size).
- Large generated code (e.g., protobuf-generated ASTs).

Mitigation: combine related variants, prefer composition over many tiny variant types.

---

## Standard Library Trivia

### Q50: How many implementations does `go/ast.Expr` have?

**Answer:** Approximately 22 (varies slightly between Go versions). Includes `*BadExpr`, `*Ident`, `*Ellipsis`, `*BasicLit`, `*FuncLit`, `*CompositeLit`, `*ParenExpr`, `*SelectorExpr`, `*IndexExpr`, `*IndexListExpr`, `*SliceExpr`, `*TypeAssertExpr`, `*CallExpr`, `*StarExpr`, `*UnaryExpr`, `*BinaryExpr`, `*KeyValueExpr`, plus type expressions: `*ArrayType`, `*StructType`, `*FuncType`, `*InterfaceType`, `*MapType`, `*ChanType`.

### Q51: Why does `reflect.Type` have `common()` and `uncommon()` as sealing markers?

**Answer:** They return internal types from `internal/abi` and `reflect` itself. Even if an external implementer named the methods correctly, the parameter and return types are inaccessible from outside the standard library.

### Q52: Is `error` sealed?

**Answer:** No — `error` is the canonical open interface. Any package can implement it.

### Q53: Is `io.Reader` sealed?

**Answer:** No — every storage backend, network connection, and decoder implements it. Sealing would defeat its purpose.

### Q54: Is `time.Time` sealed?

**Answer:** `time.Time` is a struct, not an interface. The concept of sealing does not apply. However, it is unexported in the sense that its fields are private — callers must use methods.

---

## What Interviewers Look For

### Junior

- Knows that "sealed" is an idiom, not a keyword.
- Can write a sealed interface with an unexported marker.
- Can name `go/ast` as an example.
- Understands "only same-package types can implement."

### Middle

- Can list standard library examples (`ast`, `types`, `reflect`, `ssa`).
- Knows the embedding loophole and at least one mitigation.
- Knows there is no native exhaustive switch and external linters fill the gap.
- Can choose between sealed and open based on intent.
- Understands the trade-offs vs visitor pattern.

### Senior

- Can articulate when sealing is wrong (`http.Handler`, plugins).
- Can write an exhaustiveness analyzer skeleton with `go/analysis`.
- Knows API stability rules (adding marker = breaking).
- Can discuss the interaction with generics.
- Knows the spec basis (`§Exported_identifiers`, `§Uniqueness_of_identifiers`).
- Can plan a migration of an existing public interface to be sealed.

### Professional / Staff

- Multi-package architecture decisions (sealed kernel + open extensions).
- Custom analyzer implementation in CI.
- Trade-off between hard seal and soft seal via embeddable base.
- Comparison with alternatives in other languages (Rust enums, Haskell ADTs, sealed in Java/Kotlin).
- Can audit a codebase for sealing opportunities and risks.

---

## Cheat Sheet

```
SEALING — KEY FACTS
────────────────────────────
- Not a Go keyword; it is an idiom.
- Mechanism: unexported method in the interface.
- Only same-package types can satisfy.
- Embedding can leak the seal — mitigate by hiding concrete types.

WHEN TO SEAL
────────────────────────────
- ADTs (closed type families)
- AST/IR/parser types
- Domain types with finite cases
- Closed event types

WHEN NOT TO SEAL
────────────────────────────
- io.Reader / http.Handler (open extension points)
- Plugin / middleware interfaces
- Mockable services (use test doubles)

NAMING CONVENTIONS
────────────────────────────
aNode(), aType()    — go/ast, go/types
exprNode()          — go/ast (per category)
isExpr() / sealed() — application code

EXHAUSTIVE SWITCH
────────────────────────────
- No native Go support.
- Tools: nishanths/exhaustive, custom go/analysis.
- Pair with default arm that panics.

API STABILITY
────────────────────────────
Add variant      → soft break (analyzer warnings)
Remove variant   → BREAKING
Add marker       → BREAKING
Rename marker    → safe (unexported)

CANONICAL EXAMPLES
────────────────────────────
go/ast.Expr, ast.Stmt, ast.Decl
go/types.Object
reflect.Type
golang.org/x/tools/go/ssa.Value, ssa.Instruction
```
