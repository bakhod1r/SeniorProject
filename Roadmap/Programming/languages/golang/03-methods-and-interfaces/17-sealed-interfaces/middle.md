# Sealed Interfaces — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [How `go/ast.Node` Is Sealed](#how-goastnode-is-sealed)
3. [The Three-Tier Seal in `go/ast`](#the-three-tier-seal-in-goast)
4. [Walking Through `reflect.Type`](#walking-through-reflecttype)
5. [`go/types.Type` and `go/types.Object`](#gotypestype-and-gotypesobject)
6. [Naming Conventions Across the Std-Lib](#naming-conventions-across-the-std-lib)
7. [Sealing Method on Pointer vs Value](#sealing-method-on-pointer-vs-value)
8. [The Embedding Loophole — In Detail](#the-embedding-loophole-in-detail)
9. [Combining Seal With Behavior](#combining-seal-with-behavior)
10. [Type-Switch Patterns](#type-switch-patterns)
11. [When to Seal vs When to Leave Open](#when-to-seal-vs-when-to-leave-open)
12. [Sealing for Test-Only Variants](#sealing-for-test-only-variants)
13. [Documenting a Sealed Interface](#documenting-a-sealed-interface)
14. [Cheat Sheet](#cheat-sheet)
15. [Test](#test)
16. [Summary](#summary)

---

## Introduction

At the junior level you saw the pattern in isolation. At the middle level we open the standard library and watch the pattern in production. The Go core team uses sealed interfaces in **every package that exposes an AST or a type system**, including `go/ast`, `go/types`, `go/parser`, `reflect`, `encoding/json/v2`, `cmd/compile/internal/ssa`, and others. By studying these we learn:

- How sealing scales to dozens or hundreds of variants
- Why a *seal hierarchy* is sometimes used (sub-sealing)
- How to name the seal method
- When pointer vs value receiver matters
- How combinators and visitors interact with seals

---

## How `go/ast.Node` Is Sealed

The Go AST package defines a tree of nodes, each one of: `*File`, `*Ident`, `*BinaryExpr`, `*CallExpr`, `*FuncDecl`, ...there are over 60 concrete types. The root interface is sealed:

```go
// (excerpt of go/ast)
package ast

type Node interface {
    Pos() token.Pos // first character offset
    End() token.Pos // first offset past the node
}
```

Wait — `Pos()` and `End()` are **exported**. There is no obvious sealing method. So how is `ast.Node` sealed?

It is **soft sealed by sub-interfaces**. `Node` itself is not strictly sealed — you could in theory implement `Pos`/`End` and call yourself a `Node`. But every meaningful node also implements one of three sub-interfaces, each of which IS sealed:

```go
type Expr interface {
    Node
    exprNode() // unexported — seals Expr
}

type Stmt interface {
    Node
    stmtNode() // unexported — seals Stmt
}

type Decl interface {
    Node
    declNode() // unexported — seals Decl
}
```

So every real ast node implements at least one of these:

```go
func (*BadExpr)  exprNode() {}
func (*Ident)    exprNode() {}
func (*BinaryExpr) exprNode() {}
// ... over 30 expression types

func (*BadStmt)   stmtNode() {}
func (*ReturnStmt) stmtNode() {}
// ... over 20 statement types

func (*BadDecl)  declNode() {}
func (*FuncDecl) declNode() {}
// ... 3 declaration types
```

The `Node` interface itself is left "open enough" so that `*Comment` and `*CommentGroup` (which are neither expr, stmt, nor decl) can satisfy it. But the practical surface — the things you write a type switch over — is split into three sealed buckets.

---

## The Three-Tier Seal in `go/ast`

This is a real pattern worth recognising. When the variant space is large, split it:

```
Node                       <-- soft sealed (just Pos/End)
├── Expr                   <-- sealed via exprNode()
│   ├── Ident
│   ├── BinaryExpr
│   ├── CallExpr
│   └── ... (30+ variants)
├── Stmt                   <-- sealed via stmtNode()
│   ├── ReturnStmt
│   ├── IfStmt
│   └── ... (20+ variants)
├── Decl                   <-- sealed via declNode()
│   ├── FuncDecl
│   ├── GenDecl
│   └── BadDecl
└── (misc: Comment, File, Spec...)
```

Why split? Because a type switch over **all** AST nodes would have 60+ cases. Splitting lets each consumer focus:

```go
// Visitor-style — only handles Expr variants
func walkExpr(e ast.Expr) {
    switch e := e.(type) {
    case *ast.Ident:      ...
    case *ast.BinaryExpr: walkExpr(e.X); walkExpr(e.Y)
    case *ast.CallExpr:   ...
    // ~30 cases instead of 60
    }
}
```

**Lesson:** If you hit ~10 variants, consider sub-sealing.

---

## Walking Through `reflect.Type`

`reflect.Type` is a famous sealed interface, but the seal is hidden:

```go
// (simplified excerpt of reflect)
type Type interface {
    Align() int
    FieldAlign() int
    Kind() Kind
    // ... ~30 exported methods

    common()  // unexported — the seal
    uncommon() *uncommonType
}
```

`common()` and `uncommon()` are unexported, so only `reflect`'s internal `*rtype` type can satisfy `reflect.Type`. This is why every reflect call that returns a `Type` is safe to switch on `Kind()` (or to type-assert): the runtime guarantees you're dealing with the one true `*rtype`.

```go
t := reflect.TypeOf(42)
// t is *rtype under the hood
// no external package can fake it
```

This seal is what makes reflect's invariants hold. If users could implement `reflect.Type`, the runtime would have to defensively re-check everything. Sealing turns that into a compile-time guarantee.

---

## `go/types.Type` and `go/types.Object`

The type-checker package uses sealing extensively:

```go
// go/types
type Type interface {
    Underlying() Type
    String() string
}
```

Wait — those look open! But every concrete `Type` (`*Basic`, `*Pointer`, `*Slice`, `*Struct`, `*Interface`, `*Named`, `*Map`, `*Chan`, ...) is in `package types`, and the interface is documented as "do not implement this outside go/types". The seal is **by convention** plus an unexported field on each struct that prevents copying.

For `Object`, however, sealing is structural:

```go
// go/types
type Object interface {
    Parent() *Scope
    Pos() token.Pos
    Pkg() *Package
    Name() string
    Type() Type
    Exported() bool
    Id() string
    String() string
    order() uint32         // unexported — seals
    setOrder(uint32)
    setParent(*Scope)
    setColor(color)
    color() color
    setType(Type)
    setScopePos(token.Pos)
    sameId(...) bool
    scopePos() token.Pos
}
```

Many unexported methods. Variants: `*PkgName`, `*Const`, `*TypeName`, `*Var`, `*Func`, `*Label`, `*Builtin`, `*Nil`. Each embeds an `*object` base struct that provides the unexported methods automatically:

```go
type object struct {
    parent     *Scope
    pos        token.Pos
    pkg        *Package
    name       string
    typ        Type
    order_     uint32
    color_     color
    scopePos_  token.Pos
}

func (obj *object) Parent() *Scope { return obj.parent }
func (obj *object) order() uint32  { return obj.order_ }
// ... all the methods

type Var struct {
    object              // embedding gives Var all the seal methods for free
    embedded bool
    isField  bool
    used     bool
}
```

**Lesson:** When all variants share state, a base struct with unexported methods solves both the seal and the boilerplate at once.

---

## Naming Conventions Across the Std-Lib

| Package | Interface | Seal method | Style |
|---------|-----------|-------------|-------|
| `go/ast` | `Expr` | `exprNode()` | `<lower-name>Node()` |
| `go/ast` | `Stmt` | `stmtNode()` | same |
| `go/ast` | `Decl` | `declNode()` | same |
| `go/types` | `Type` | (convention + unexported state) | structural |
| `go/types` | `Object` | `order()` and others | many private contract methods |
| `reflect` | `Type` | `common()` | one private method |
| `cmd/compile/internal/ssa` | `Value` | many | structural |
| `database/sql/driver` | `Value` | (NamedValue is sealed) | `value()` |

There is **no single official rule**. Three patterns dominate:

1. **`<interface>Node()`** — verbose but unambiguous (`exprNode`, `stmtNode`)
2. **`<package>()` or `<lower-interface>()`** — short (`expr()`, `stmt()`)
3. **`isXxx()`** — for boolean-style guards (rare but seen)

For your own code, prefer style 1 or 2 with **one consistent choice per package**.

---

## Sealing Method on Pointer vs Value

Should the seal method have a pointer or value receiver? It depends on whether the variants are value-shaped or pointer-shaped.

```go
// All variants are values — value receiver
type Token interface{ token() }

type Ident  struct{ Name string }
type Number struct{ Value float64 }

func (Ident)  token() {}
func (Number) token() {}

// Variants are pointers (because they carry state) — pointer receiver
type Decl interface{ declNode() }

type FuncDecl struct{ Name *Ident; Body *BlockStmt }
type GenDecl  struct{ Tok token.Token; Specs []Spec }

func (*FuncDecl) declNode() {}
func (*GenDecl)  declNode() {}
```

**Rule:** match the receiver style of the variant. If a variant has any pointer-receiver method, give the seal a pointer receiver too. Mixing is awkward.

`go/ast` uses pointer receivers for almost all variants (`*FuncDecl`, `*Ident`, `*BinaryExpr`) because the variants are large structs with mutable fields.

`go/ast.Comment` uses pointer too — even though `*Comment` is small — for consistency.

---

## The Embedding Loophole — In Detail

Recall from junior: external code can embed a sealed variant and inherit its seal method. Let's walk through what that means in practice.

```go
package fruit

type Fruit interface{ fruit() }

type Apple struct{ Color string }
func (Apple) fruit() {}
```

```go
package main

import "myapp/fruit"

type GoldenApple struct {
    fruit.Apple  // embed
    Carat int
}

// GoldenApple inherits Apple's fruit() method via promotion.
var _ fruit.Fruit = GoldenApple{} // compiles
```

So the seal is "soft". But what does this actually break?

```go
func describe(f fruit.Fruit) string {
    switch v := f.(type) {
    case fruit.Apple:
        return "apple: " + v.Color
    case fruit.Banana:
        return "banana"
    default:
        return "unknown"
    }
}

ga := GoldenApple{Apple: fruit.Apple{Color: "yellow"}, Carat: 24}
describe(ga) // "unknown" — falls through default
```

The switch does **not** match `fruit.Apple` because the dynamic type is `main.GoldenApple`, not `fruit.Apple`. Embedding **does not change the runtime type**. So consumers get a "default" arm; the seal protects against unexpected behavior.

If you really need to forbid embedding too, you can:

1. Make all variants unexported (`type apple struct{...}`) and only expose constructor functions returning `Fruit`. External code can't embed `apple` because it can't name it.

```go
package fruit

type Fruit interface{ fruit() }

type apple struct{ Color string }

func (apple) fruit() {}
func NewApple(c string) Fruit { return apple{Color: c} }
```

Now external consumers receive `Fruit` values they cannot disassemble (other than by switch on internal types, which they don't have). This is the **fully sealed** form.

Trade-off: type switches in external code lose access to the variant struct fields. You need exported accessor methods.

---

## Combining Seal With Behavior

A seal does not have to be a pure marker — it can also be a real method. `go/types.Type` does this with `Underlying()`:

```go
type Type interface {
    Underlying() Type   // shared behaviour
    String() string     // shared behaviour
    // (plus structural unexported state)
}
```

Every variant implements both methods meaningfully. The seal is a *contract* about the embedded `*object` field.

For your own ADTs, a hybrid pattern works well:

```go
type Expr interface {
    String() string  // useful for debugging
    Pos() Position   // useful for error messages
    expr()           // pure seal
}
```

Now `Expr` is sealed AND every variant must implement two real methods. This is the most common production form.

---

## Type-Switch Patterns

### Pattern 1: Exhaustive switch with `default: panic`

```go
func eval(e Expr) float64 {
    switch n := e.(type) {
    case Number: return n.Value
    case Var:    return lookup(n.Name)
    case BinOp:  return apply(n.Op, eval(n.Lhs), eval(n.Rhs))
    default:
        panic(fmt.Sprintf("unhandled Expr variant: %T", e))
    }
}
```

### Pattern 2: Switch returning `(result, error)`

```go
func eval(e Expr) (float64, error) {
    switch n := e.(type) {
    case Number: return n.Value, nil
    case Var:    v, ok := env[n.Name]; if !ok { return 0, fmt.Errorf("undef %q", n.Name) }; return v, nil
    case BinOp:  return evalBin(n)
    default:     return 0, fmt.Errorf("unhandled %T", e)
    }
}
```

### Pattern 3: Visitor function map (table dispatch)

```go
var handlers = map[reflect.Type]func(Expr) string{
    reflect.TypeOf(Number{}): func(e Expr) string { return fmt.Sprintf("%g", e.(Number).Value) },
    reflect.TypeOf(Var{}):    func(e Expr) string { return e.(Var).Name },
}

// Trade-off: harder to read, no compile-time check at all.
```

Most code uses Pattern 1.

### Pattern 4: Generic visitor interface

```go
type Visitor interface {
    Number(Number)
    Var(Var)
    BinOp(BinOp)
}

func (n Number) accept(v Visitor) { v.Number(n) }
func (n Var)    accept(v Visitor) { v.Var(n) }
func (n BinOp)  accept(v Visitor) { v.BinOp(n) }
```

This is the visitor pattern; we contrast it with type switch in `senior.md`.

---

## When to Seal vs When to Leave Open

| Situation | Seal? | Why |
|-----------|-------|-----|
| Modeling a finite, conceptual variant set (AST node, expression, command) | Yes | True ADT |
| Plugin / extension point (e.g. `Storage`, `Codec`, `Notifier`) | No | Users must implement |
| Internal tagged-union for performance (e.g. variant in a parser) | Yes | You control all variants |
| Public hand-out interface (`io.Reader`) | No | Maximum implementer freedom |
| Library that wants stability for its switches | Yes | Refactor safety |
| Type with one or two implementations, future extension expected | No | Premature seal |

**Rule of thumb:** seal when the variant set is *conceptually closed*. Don't seal because "I only have two implementations right now" — that's not closed, that's incomplete.

---

## Sealing for Test-Only Variants

A subtle issue: if you seal an interface, your tests may want to inject a fake. Solutions:

### Option 1: Test variant lives in the same package

```go
// in package expr (same package)
type testStub struct{ Value float64 }
func (testStub) expr() {}
```

Now `testStub` is sealed-compliant because it's in the package. Use it in `_test.go` files.

### Option 2: Export a `Custom` variant for advanced users

```go
type Custom struct {
    Eval  func() float64
    Print func() string
}
func (Custom) expr() {}
```

This lets external tests inject behavior **without** breaking the seal. The seal still prevents new variant *types*; users can only use the predefined `Custom`.

### Option 3: Don't seal in the first place

If your tests really need ad-hoc implementations, sealing may be the wrong choice.

---

## Documenting a Sealed Interface

Always document the seal explicitly:

```go
// Expr is the root of the expression AST.
//
// All implementations of Expr are defined in this package; the unexported
// expr() method prevents external types from satisfying the interface.
// Consumers should treat Expr as a closed sum of:
//   - Number
//   - Var
//   - BinOp
//   - If
//
// New variants may be added in future versions; consumers handling Expr
// values via type switch should include a default arm.
type Expr interface {
    Pos() Position
    String() string
    expr()
}
```

The comment buys you:
- Future maintainers know it's intentional
- Documentation tooling (`go doc`) shows the contract
- Users know to write a `default` case

---

## Cheat Sheet

```
SEALING TIERS
─────────────────────────────────────
1. Marker only:        type I interface { foo() }
2. Marker + behavior:  type I interface { Pos() P; String() string; foo() }
3. Sub-sealing:        Node → {Expr, Stmt, Decl} each separately sealed
4. Hidden variants:    unexported variant types + factory functions

NAMING
─────────────────────────────────────
exprNode(), stmtNode()        // go/ast style
expr(),     stmt()            // short form
isType(),   isExpr()          // boolean style

RECEIVER
─────────────────────────────────────
Match the variants:
  value variants  → value receiver (Number{}.expr())
  pointer variants → pointer receiver ((*FuncDecl).declNode)

EMBEDDING LOOPHOLE
─────────────────────────────────────
External wrapper:
  type W struct { pkg.Variant }
  W satisfies the seal via promotion.
Mitigation:
  unexport variant types, expose only constructors.

DOC TEMPLATE
─────────────────────────────────────
// I is sealed: only types in this package implement it.
// Variants: A, B, C. Consumers should include default arm.
```

---

## Test

### 1. How does `go/ast` seal its interfaces?
- a) Single `node()` method on `Node`
- b) Sub-sealing — `Expr`, `Stmt`, `Decl` each have their own unexported method
- c) `reflect.Kind` runtime check
- d) Build tags

**Answer: b**

### 2. What problem does **sub-sealing** (multiple sealed sub-interfaces under a common root) solve?
- a) Allows users to implement
- b) Reduces `type switch` size and groups related variants
- c) Makes the code faster
- d) Required by the spec

**Answer: b**

### 3. In `go/types`, the `Object` seal works via:
- a) A single `object()` method
- b) An embedded base struct (`*object`) carrying many unexported methods
- c) Reflection
- d) Build tags

**Answer: b**

### 4. The biggest practical leak through embedding is:
- a) Compilation slowdown
- b) An external wrapper can satisfy the interface but appears as an unknown type in switches (often falling through `default`)
- c) Memory leaks
- d) The seal silently breaks at runtime

**Answer: b**

### 5. To completely prevent embedding, you should:
- a) Use `unsafe` checks
- b) Make variant types unexported and provide factory functions returning the sealed interface
- c) Add `//go:nosplit` directives
- d) It is impossible

**Answer: b**

---

## Summary

At the middle level, sealed interfaces stop being a curiosity and become a tool you reach for. The standard library is full of examples — `go/ast`, `go/types`, `reflect`, `cmd/compile/internal/ssa` — and each illustrates a slightly different flavor:

- **Single seal method** — `reflect.common()`
- **Sub-sealing** — `go/ast` splits its 60+ variants into `Expr`/`Stmt`/`Decl`
- **Structural seal via embedded base** — `go/types.Object`
- **Hybrid behavior + seal** — `go/types.Type` with `Underlying()`/`String()`

You now know:
- How to read these patterns in std-lib source
- How to choose a naming convention
- How to handle the embedding loophole if you care about it
- When sealing is the right design and when it isn't

Senior level explores ADT theory, the visitor alternative, and dispatch performance.
