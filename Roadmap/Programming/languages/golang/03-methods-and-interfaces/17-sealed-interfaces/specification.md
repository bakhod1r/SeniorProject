# Sealed Interfaces — Specification

> **Official Specification Reference**
> Source: [Go Language Specification](https://go.dev/ref/spec) — §Exported_identifiers, §Method_sets, §Interface_types, §Type_assertions, §Type_switches
>
> Sealing is **not a Go language keyword**. It is an idiom that derives entirely from the visibility rules of unexported identifiers and the formal definition of interface satisfaction. This document grounds the idiom in the spec and shows how `go/ast`, `go/types`, and `reflect` implement it.

---

## Table of Contents

1. [Spec Reference](#1-spec-reference)
2. [Formal Grammar (EBNF)](#2-formal-grammar-ebnf)
3. [Core Rules and Constraints](#3-core-rules-and-constraints)
4. [Identifier Visibility — Foundation of Sealing](#4-identifier-visibility-foundation-of-sealing)
5. [Method Sets and Interface Satisfaction](#5-method-sets-and-interface-satisfaction)
6. [Behavioral Specification of Sealed Interfaces](#6-behavioral-specification-of-sealed-interfaces)
7. [Defined vs Undefined Behavior](#7-defined-vs-undefined-behavior)
8. [Edge Cases from Spec](#8-edge-cases-from-spec)
9. [Standard Library Reference](#9-standard-library-reference)
10. [Tooling: go/ast, reflect, go/types, go/analysis](#10-tooling-goast-reflect-gotypes-goanalysis)
11. [Spec Compliance Checklist](#11-spec-compliance-checklist)

---

## 1. Spec Reference

### Exported and Unexported Identifiers — Official Text

> An identifier is exported if both:
> - the first character of the identifier's name is a Unicode uppercase letter (Unicode class "Lu"); and
> - the identifier is declared in the package block or it is a field name or method name.
> All other identifiers are not exported.

Source: https://go.dev/ref/spec#Exported_identifiers

This single rule is the foundation of sealing. A method whose name begins with a lowercase letter is unexported, and "Method names referring to interface methods may be exported or not, but in either case they're identified by the (qualified) method name (see Uniqueness of identifiers)." Two methods with the same simple name in different packages are **distinct identifiers**.

### Uniqueness of Identifiers — Official Text

> Given a set of identifiers, an identifier is called unique if it is different from every other in the set. Two identifiers are different if they are spelled differently, or if they appear in different packages and are not exported. Otherwise, they are the same.

Source: https://go.dev/ref/spec#Uniqueness_of_identifiers

This is the formal mechanism by which an unexported method `expr()` declared in package `p` cannot be satisfied by `expr()` declared in package `q`: they are different identifiers.

### Interface Types — Official Text

> An interface type defines a type set. A variable of interface type can store a value of any type that is in the type set of the interface. Such a type is said to implement the interface.

> The type set of an interface type is the intersection of the type sets of its interface elements.

> A type T implements an interface if [...] for every basic interface in the interface's type set, T's method set contains the interface's method set.

Source: https://go.dev/ref/spec#Interface_types

When the interface contains an unexported method, the requirement "T's method set contains the interface's method set" means T must declare a method with the same unqualified name **in the same package**. This is sealing.

### Method Sets — Official Text

> The method set of a type determines the interfaces that the type implements. The method set of a defined type T consists of all methods declared with receiver type T.

Source: https://go.dev/ref/spec#Method_sets

### Type Assertions — Official Text

> For an expression x of interface type, but not a type parameter, and a type T, the primary expression `x.(T)` asserts that x is not nil and that the value stored in x is of type T.

Source: https://go.dev/ref/spec#Type_assertions

Sealed interfaces depend heavily on type assertions and type switches for pattern matching.

### Type Switches — Official Text

> A type switch compares types rather than values. It is otherwise similar to an expression switch.

Source: https://go.dev/ref/spec#Type_switches

A type switch over a sealed interface is the canonical pattern for ADT discrimination.

---

## 2. Formal Grammar (EBNF)

### Interface Type with Sealing Marker

```ebnf
InterfaceType  = "interface" "{" { InterfaceElem ";" } "}" .
InterfaceElem  = MethodElem | TypeElem .
MethodElem     = MethodName Signature .
MethodName     = identifier .
```

The sealing marker is a `MethodElem` whose `MethodName` starts with a lowercase letter:

```ebnf
SealingMarker  = LowerIdent "(" ")" .
LowerIdent     = lowercase_letter { letter | digit } .
```

The grammar does not distinguish a sealing marker from any other unexported method — sealing is encoded in the visibility of the identifier, not in the grammar.

### Type Switch over a Sealed Interface

```ebnf
TypeSwitchStmt  = "switch" [ SimpleStmt ";" ] TypeSwitchGuard "{" { TypeCaseClause } "}" .
TypeSwitchGuard = [ identifier ":=" ] PrimaryExpr "." "(" "type" ")" .
TypeCaseClause  = TypeSwitchCase ":" StatementList .
TypeSwitchCase  = "case" TypeList | "default" .
TypeList        = Type { "," Type } .
```

There is no grammar-level enforcement of exhaustiveness. Exhaustiveness is enforced by external analyzers.

---

## 3. Core Rules and Constraints

### Rule 1 — A sealed interface contains at least one unexported method

```go
package p

type Expr interface {
    expr()           // unexported — sealing marker
    String() string  // exported — public method
}
```

The unexported method is what makes the interface sealed. Without it, any package can implement the interface.

### Rule 2 — Only types in the same package can implement the interface

By spec §Uniqueness_of_identifiers, the unexported `expr` declared in package `p` is **not the same identifier** as `expr` declared in package `q`. Therefore types in `q` cannot satisfy `p.Expr`.

```go
// pkg p
type Expr interface { expr() }

// pkg q
type Foo struct{}
func (Foo) expr() {}     // this `expr` is q.expr, not p.expr

var _ p.Expr = Foo{}     // compile error: Foo does not implement p.Expr
                         //   (missing method expr)
```

### Rule 3 — Embedding propagates sealing

If a type `T` from package `p` is exported and has the sealing method in its method set, embedding `T` from another package brings the sealing method into the embedder's method set.

```go
// pkg p
type Expr interface { expr() }
type Lit struct{ V int }
func (Lit) expr() {}

// pkg q
type Wrap struct { p.Lit }
var _ p.Expr = Wrap{}    // OK — sealing method promoted
```

This is the embedding loophole.

### Rule 4 — Sealing applies to concrete types, not to interfaces

An interface `I` cannot have methods, only declared method elements. There is no concept of "implementing" one interface by another — by spec, an interface `J` satisfies `I` if `J`'s type set is a subset of `I`'s type set.

```go
type I interface { x() }
type J interface { x(); String() string }   // J's type set ⊂ I's type set

var _ I = J(nil)   // OK by spec — type set inclusion
```

A sealed interface can be embedded by another interface in the same package; outside the package, the embedded interface is still sealed.

### Rule 5 — Sealing is not transitive across packages via aliases

Type aliases preserve the original package binding:

```go
// pkg p
type Expr interface { expr() }

// pkg q
type Expr = p.Expr   // alias

type Foo struct{}
func (Foo) expr() {} // q.expr, not p.expr
var _ q.Expr = Foo{} // compile error — still sealed
```

### Rule 6 — Generic interface types

Type parameters do not affect sealing. A generic sealed interface is still sealed.

```go
type Container[T any] interface {
    container()
    Get() T
}
```

Type-set sealing applies the same way regardless of `T`.

---

## 4. Identifier Visibility — Foundation of Sealing

### The visibility rule (formal)

From §Declarations_and_scope:

> An identifier declared in a block may be redeclared in an inner block. While the identifier of the inner declaration is in scope, it denotes the entity declared by the inner declaration.

And from §Exported_identifiers:

> An identifier is exported if [first character is uppercase Unicode "Lu"]. All other identifiers are not exported.

For unexported identifiers, the package itself acts as an outer scope. The identifier is **qualified by its package** when compared to identifiers from other packages.

### Practical consequence: "private namespace" per package

Each package owns the namespace of its unexported identifiers. Two packages can declare unexported identifiers with the same spelling and they remain distinct.

```go
// pkg a
type I interface { foo() }

// pkg b
type J interface { foo() }

// pkg c
type T struct{}
func (T) foo() {}

var _ a.I = T{}   // compile error: T's foo is c.foo, not a.foo
var _ b.J = T{}   // compile error: T's foo is c.foo, not b.foo
var _ a.I = a.something{} // possibly OK if a.something defines foo
```

The compiler tracks the **defining package** of every unexported method name. The `go/types` package exposes this via `types.Func.Pkg()`:

```go
import "go/types"

func isSealed(iface *types.Interface) bool {
    for i := 0; i < iface.NumMethods(); i++ {
        m := iface.Method(i)
        if !m.Exported() {
            return true
        }
    }
    return false
}

func sealingPackage(iface *types.Interface) *types.Package {
    for i := 0; i < iface.NumMethods(); i++ {
        m := iface.Method(i)
        if !m.Exported() {
            return m.Pkg()
        }
    }
    return nil
}
```

`types.Func.Pkg()` returns the package in which the identifier was declared — the only package whose types can satisfy the interface.

---

## 5. Method Sets and Interface Satisfaction

### Method set of a sealing implementor

```go
type Lit struct{ V int }
func (Lit) expr() {}
func (Lit) Print() string { return fmt.Sprint(Lit{}.V) }
```

| Type | Method set (unqualified names) |
|---|---|
| `Lit` | `{expr, Print}` |
| `*Lit` | `{expr, Print}` |

Both methods are in the method set of `Lit` and `*Lit` because both are declared with value receivers.

### Interface satisfaction with unexported methods (formal)

For `Lit` to implement `p.Expr` (defined in package `p` with an `expr()` method), the spec requires:

1. `Lit`'s method set contains a method whose **qualified name** is `p.expr()`.
2. Equivalently: `Lit` is declared in package `p` and declares a method `expr()`.

If `Lit` is in package `q`, condition 1 fails — `q.expr()` is a different qualified identifier.

### How `go/types` checks satisfaction

```go
import "go/types"

func implements(t types.Type, iface *types.Interface) bool {
    return types.Implements(t, iface)
}
```

`types.Implements` walks the interface methods and looks them up in `t`'s method set using `LookupFieldOrMethod`. For unexported names, it requires the lookup to succeed **with the interface's defining package** as the visibility scope.

### Method set rules and sealing

The standard rules (§Method_sets) apply. A sealing marker declared with a value receiver puts it in the method set of both `T` and `*T`. With a pointer receiver, only `*T`.

Convention: declare the marker with **value receiver**.

```go
func (Lit) expr() {}    // good — both Lit and *Lit satisfy
func (*Lit) expr() {}   // surprising — only *Lit satisfies
```

---

## 6. Behavioral Specification of Sealed Interfaces

### Type assertion against a sealed interface

A type assertion `x.(T)` where `x` has interface type and `T` is one of the sealed implementors is the standard discriminator.

```go
e := someExpr()
if lit, ok := e.(Lit); ok {
    // e is a Lit
}
```

The runtime check is identical to any other type assertion. Sealing is a **compile-time** property; the runtime knows nothing about it.

### Type switch over sealed interface

```go
switch e := e.(type) {
case Lit:
    return e.V
case Add:
    return Eval(e.L) + Eval(e.R)
}
```

The compiler does not enforce exhaustiveness. Per the spec:

> The expression may also be the predeclared identifier nil. The case "default" is allowed.

A missing case yields the zero value of the result (or falls through to a `default`). Linters fill the gap.

### Reflection

Reflection treats sealed and unsealed interfaces identically. `reflect.Type.Method(i)` returns all methods including unexported ones, but the unexported method's `PkgPath` is set:

```go
import "reflect"

t := reflect.TypeOf(Lit{})
for i := 0; i < t.NumMethod(); i++ {
    m := t.Method(i)
    fmt.Println(m.Name, m.PkgPath)
    // expr   pkg/p
    // Print  ""
}
```

The `PkgPath` is non-empty for unexported methods, identifying the sealing package.

### `reflect.Type.Implements`

```go
ifaceType := reflect.TypeOf((*p.Expr)(nil)).Elem()
litType   := reflect.TypeOf(Lit{})
fmt.Println(litType.Implements(ifaceType))
```

Returns `true` only if `Lit` is in package `p` (or embeds something in package `p` whose method set contains `expr`).

---

## 7. Defined vs Undefined Behavior

### Defined Operations

| Operation | Behavior |
|---|---|
| Declare interface with unexported method | sealed; only same-package types satisfy |
| Implement sealed interface from same package | satisfies |
| Implement sealed interface from another package | compile error |
| Embed exported sealed type from another package | satisfies via promotion |
| Type assertion to a sealed implementor | standard runtime check |
| Type switch over sealed interface | standard semantics; no exhaustiveness check |
| Reflection on sealed interface | works; unexported method has `PkgPath` |
| `types.Implements` from `go/types` | recognizes sealing |

### Compile Errors

| Operation | Result |
|---|---|
| Implementing sealed interface from another package without embedding | "T does not implement I (missing method m)" |
| Calling unexported method from outside the package on the interface | "m undefined (type I has no field or method m)" — but is implementation-defined; the spec disallows external access |
| Declaring a method with the same simple name on a foreign type | unrelated: it satisfies a different interface |

### Undefined Behavior

The Go spec does not contain undefined behavior in this domain. Either a program is well-formed and behaves per the spec, or it is rejected at compile time.

The only runtime panic possible from sealing-related code:
- Type assertion that fails without `ok` form: `e.(Lit)` panics if `e` is not a `Lit`. This is standard panic behavior, not specific to sealing.

---

## 8. Edge Cases from Spec

### Edge Case 1 — Marker on unexported type

```go
type Expr interface { expr() }

type lit struct{ V int }
func (lit) expr() {}

func NewLit(v int) Expr { return lit{V: v} }
```

`lit` is unexported, so external code cannot directly construct or embed it. The sealing is reinforced — even the embedding loophole is closed for `lit`.

### Edge Case 2 — Sealed interface embedding open interface

```go
type Stringer interface { String() string }

type Expr interface {
    Stringer        // open
    expr()          // sealed marker
}
```

`Expr` is sealed because of `expr()`. The `Stringer` requirement is unchanged.

### Edge Case 3 — Open interface embedding sealed interface

```go
type Expr interface { expr() }

type ExprPlus interface {
    Expr
    Optimize() Expr
}
```

`ExprPlus` inherits the seal: only types in `Expr`'s package can satisfy `ExprPlus`. Embedding does not break the seal.

### Edge Case 4 — Multiple sealed markers

```go
type Expr interface {
    expr()
    isExpr()
}
```

Both must be implemented. No additional security; idiomatic style is one marker.

### Edge Case 5 — Sealed marker with parameters

```go
type Expr interface { expr(internal struct{}) }
```

Even more restrictive: external code cannot construct `internal struct{}` with the right package qualification, so they cannot call the method even via reflection. Rarely used; the parameterless marker is sufficient.

### Edge Case 6 — Generic sealed interface

```go
type Container[T any] interface {
    container()
    Get() T
}

type intBox struct{ v int }
func (intBox) container() {}
func (b intBox) Get() int { return b.v }

var _ Container[int] = intBox{}
```

Generics do not affect sealing. Type-parameterized sealed interfaces are common in libraries that mix ADT modeling with generics (e.g., `Result[T]`).

### Edge Case 7 — Reflective construction

`reflect.New(reflect.TypeOf(Lit{}))` creates a new `*Lit`, which satisfies the sealed interface. Reflection cannot be used to satisfy a sealed interface from a foreign package because there is no way to create a foreign type with the matching unexported method via reflection alone — `reflect.StructOf` builds anonymous structs but cannot attach methods.

### Edge Case 8 — `any` to sealed interface conversion

Standard interface-to-interface conversion via type assertion:

```go
var a any = Lit{}
if e, ok := a.(p.Expr); ok {
    // works because Lit's method set contains p.expr
}
```

The conversion respects the seal: only types whose method set contains the sealed method succeed.

### Edge Case 9 — `comparable` constraint and sealed interfaces

Sealed interfaces are not necessarily comparable. If any implementor is non-comparable (contains a slice or map), the interface itself cannot be used as a map key.

```go
type Expr interface { expr() }
type Add struct{ L, R Expr }   // contains Expr (interface) — comparable depends on dynamic type

m := map[Expr]int{}
m[Lit{V: 1}] = 1   // OK if Lit comparable
// m[Array{[]int{}}] = 1  // panic: comparing uncomparable type
```

The seal does not change comparability rules.

---

## 9. Standard Library Reference

### `go/ast` — the canonical sealed hierarchy

```go
// $GOROOT/src/go/ast/ast.go (excerpt)

type Node interface {
    Pos() token.Pos
    End() token.Pos
}

type Expr interface {
    Node
    exprNode()
}

type Stmt interface {
    Node
    stmtNode()
}

type Decl interface {
    Node
    declNode()
}
```

`Node` itself is **not sealed** (no unexported method) — any type with `Pos()` and `End()` could satisfy it. The seals live one layer down: `Expr`, `Stmt`, `Decl`.

Implementations are spread across many files:

```go
// ast/expr.go
func (*BadExpr)        exprNode() {}
func (*Ident)          exprNode() {}
func (*Ellipsis)       exprNode() {}
func (*BasicLit)       exprNode() {}
func (*FuncLit)        exprNode() {}
func (*CompositeLit)   exprNode() {}
func (*ParenExpr)      exprNode() {}
func (*SelectorExpr)   exprNode() {}
func (*IndexExpr)      exprNode() {}
func (*IndexListExpr)  exprNode() {}
func (*SliceExpr)      exprNode() {}
func (*TypeAssertExpr) exprNode() {}
func (*CallExpr)       exprNode() {}
func (*StarExpr)       exprNode() {}
func (*UnaryExpr)      exprNode() {}
func (*BinaryExpr)     exprNode() {}
func (*KeyValueExpr)   exprNode() {}
```

Source: https://pkg.go.dev/go/ast#Expr

### `go/types` — sealed type system

```go
// $GOROOT/src/go/types/type.go

type Type interface {
    Underlying() Type
    String() string
}
```

Despite appearance, `Type` is sealed via documentation and convention rather than an unexported method. Types like `*Basic`, `*Slice`, `*Map`, `*Struct`, `*Interface`, `*Named` all implement it. New types cannot meaningfully be added because algorithms in the package switch on the known set.

Pre-Go-1.18 the sealing was de facto. In modern code, `types.Type` is sometimes called "soft sealed".

### `go/types.Object`

```go
type Object interface {
    Parent() *Scope
    Pos() token.Pos
    Pkg() *Package
    Name() string
    Type() Type
    Exported() bool
    Id() string
    String() string

    // ...

    color() color
    setColor(color)
    setOrder(uint32)
    order() uint32
    setColor1(color)
    // ...
}
```

`Object` *is* sealed via several unexported methods. Implementations: `*PkgName`, `*Const`, `*TypeName`, `*Var`, `*Func`, `*Label`, `*Builtin`, `*Nil`.

Source: https://pkg.go.dev/go/types#Object

### `reflect.Type`

```go
// $GOROOT/src/reflect/type.go

type Type interface {
    Align() int
    FieldAlign() int
    Method(int) Method
    MethodByName(string) (Method, bool)
    NumMethod() int
    Name() string
    PkgPath() string
    Size() uintptr
    String() string
    Kind() Kind
    Implements(u Type) bool
    AssignableTo(u Type) bool
    ConvertibleTo(u Type) bool
    Comparable() bool
    Bits() int
    ChanDir() ChanDir
    IsVariadic() bool
    Elem() Type
    Field(i int) StructField
    FieldByIndex(index []int) StructField
    FieldByName(name string) (StructField, bool)
    FieldByNameFunc(match func(string) bool) (StructField, bool)
    In(i int) Type
    Key() Type
    Len() int
    NumField() int
    NumIn() int
    NumOut() int
    Out(i int) Type
    OverflowComplex(x complex128) bool
    OverflowFloat(x float64) bool
    OverflowInt(x int64) bool
    OverflowUint(x uint64) bool
    CanSeq() bool
    CanSeq2() bool

    common() *abi.Type
    uncommon() *uncommonType
}
```

The two trailing methods, `common()` and `uncommon()`, are the sealing markers. They return internal types from `internal/abi` and `reflect` itself, so even if an external implementer guessed the names, the parameter types would be inaccessible.

Source: https://pkg.go.dev/reflect#Type

### `golang.org/x/tools/go/ssa.Value`

```go
// golang.org/x/tools/go/ssa/ssa.go

type Value interface {
    Name() string
    String() string
    Type() types.Type
    Parent() *Function
    Referrers() *[]Instruction
    Pos() token.Pos
}
```

Sealing is by documentation (`// All concrete types that implement Value also implement Member or Instruction.`) and the package's unexported helper methods on related interfaces. SSA's `Instruction` interface uses unexported markers more aggressively.

---

## 10. Tooling: go/ast, reflect, go/types, go/analysis

### Detecting sealed interfaces with `go/types`

```go
import (
    "go/types"
)

// IsSealed reports whether iface contains at least one unexported method.
func IsSealed(iface *types.Interface) bool {
    for i := 0; i < iface.NumMethods(); i++ {
        if !iface.Method(i).Exported() {
            return true
        }
    }
    return false
}

// SealingPackage returns the package whose types are allowed to implement iface.
func SealingPackage(iface *types.Interface) *types.Package {
    for i := 0; i < iface.NumMethods(); i++ {
        m := iface.Method(i)
        if !m.Exported() {
            return m.Pkg()
        }
    }
    return nil
}
```

### Enumerating implementors of a sealed interface

```go
import (
    "go/types"
    "golang.org/x/tools/go/packages"
)

func Implementors(iface *types.Interface, sealingPkg *types.Package) []types.Type {
    var impls []types.Type
    scope := sealingPkg.Scope()
    for _, name := range scope.Names() {
        obj := scope.Lookup(name)
        t := obj.Type()
        if types.Implements(t, iface) {
            impls = append(impls, t)
        }
        // Also consider pointer receiver
        if pt := types.NewPointer(t); types.Implements(pt, iface) {
            impls = append(impls, pt)
        }
    }
    return impls
}
```

This is the basis of an exhaustiveness analyzer.

### Building an exhaustiveness analyzer with `go/analysis`

```go
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

    insp.Preorder([]ast.Node{(*ast.TypeSwitchStmt)(nil)}, func(n ast.Node) {
        ts := n.(*ast.TypeSwitchStmt)
        // Resolve the switched expression's type.
        var assert *ast.TypeAssertExpr
        switch s := ts.Assign.(type) {
        case *ast.AssignStmt:
            assert = s.Rhs[0].(*ast.TypeAssertExpr)
        case *ast.ExprStmt:
            assert = s.X.(*ast.TypeAssertExpr)
        }
        tv := pass.TypesInfo.Types[assert.X]
        iface, ok := tv.Type.Underlying().(*types.Interface)
        if !ok || !IsSealed(iface) {
            return
        }
        // Collect cases.
        covered := map[types.Type]bool{}
        for _, c := range ts.Body.List {
            cc := c.(*ast.CaseClause)
            for _, e := range cc.List {
                covered[pass.TypesInfo.Types[e].Type] = true
            }
        }
        // Compare against sealed implementors.
        sealingPkg := SealingPackage(iface)
        for _, impl := range Implementors(iface, sealingPkg) {
            if !covered[impl] {
                pass.Reportf(ts.Pos(), "missing case for %s", impl)
            }
        }
    })
    return nil, nil
}
```

This skeleton is the production pattern. Real implementations also handle pointer/value distinctions, embedded types, and `default` clauses.

### `reflect`-based sealing inspection at runtime

```go
import "reflect"

func IsSealedRuntime(ifaceVal any) (bool, string) {
    t := reflect.TypeOf(ifaceVal)
    for t.Kind() == reflect.Ptr {
        t = t.Elem()
    }
    if t.Kind() != reflect.Interface {
        return false, ""
    }
    for i := 0; i < t.NumMethod(); i++ {
        m := t.Method(i)
        if m.PkgPath != "" {
            return true, m.PkgPath
        }
    }
    return false, ""
}
```

Runtime detection is rarely needed; static analysis covers the use cases.

---

## 11. Spec Compliance Checklist

- [ ] At least one unexported method in the interface (the sealing marker).
- [ ] Marker has empty body and no parameters or return values (idiomatic).
- [ ] Marker declared with **value receiver** (so both `T` and `*T` satisfy).
- [ ] All implementations live in the same package as the interface.
- [ ] Embedded base types (if any) are documented as the official extension point.
- [ ] Package documentation states whether external implementation is supported.
- [ ] Type switches over the sealed interface either cover every variant or include a `default` arm.
- [ ] Exhaustiveness is enforced by an analyzer in CI.
- [ ] No type alias re-exports the interface in a way that misleads about its package boundary.
- [ ] When using `go/types.Implements`, account for both `T` and `*T` method sets.
- [ ] When using reflection, treat unexported methods as sealing markers (`PkgPath != ""`).
- [ ] Adding a marker to an existing public interface is recognized as a major-version-breaking change.

---

## Summary

Sealing in Go is a direct application of three spec sections:

1. **§Exported_identifiers** — lowercase first letter ⇒ unexported.
2. **§Uniqueness_of_identifiers** — unexported identifiers are scoped to their declaring package.
3. **§Interface_types** — implementation requires the implementor's method set to contain the interface's method set, including unexported methods, which can only be declared in the interface's defining package.

The standard library uses this pattern in `go/ast`, `go/types`, `reflect`, and `golang.org/x/tools/go/ssa`. The `go/types` package exposes `types.Implements` and `types.Func.Pkg()` to programmatically inspect sealed interfaces. Tooling like `go/analysis` enables custom analyzers for exhaustiveness checks. Sealing has zero runtime semantics — it is purely a compile-time, identifier-visibility property.
