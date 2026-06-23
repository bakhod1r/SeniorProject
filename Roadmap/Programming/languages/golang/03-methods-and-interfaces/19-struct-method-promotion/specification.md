# Struct Method Promotion - Specification

> **Official Specification Reference**
> Source: [Go Language Specification](https://go.dev/ref/spec) - Struct types, Selectors, Method sets

> Scope note: This file specifies **struct method promotion** - the rules by which methods of an embedded **struct field** become part of the outer struct's method set. The neighboring file `06-embedding-interfaces/specification.md` covers **interface embedding**, where one interface type lists another interface type and inherits its method signatures. The two are governed by different sections of the spec. Do not conflate them.

---

## Table of Contents

1. [Spec Reference](#1-spec-reference)
2. [Formal Grammar (EBNF)](#2-formal-grammar-ebnf)
3. [Core Rules and Constraints](#3-core-rules-and-constraints)
4. [Selectors and Promoted Fields/Methods](#4-selectors-and-promoted-fieldsmethods)
5. [Method Sets with Embedded Fields](#5-method-sets-with-embedded-fields)
6. [Behavioral Specification](#6-behavioral-specification)
7. [Defined vs Undefined Behavior](#7-defined-vs-undefined-behavior)
8. [Edge Cases from Spec](#8-edge-cases-from-spec)
9. [Version History](#9-version-history)
10. [Implementation Notes](#10-implementation-notes)
11. [Spec Compliance Checklist](#11-spec-compliance-checklist)

---

## 1. Spec Reference

### Struct Types - Embedded Fields

> A field declared with a type but no explicit field name is called an embedded field. An embedded field must be specified as a type name `T` or as a pointer to a non-interface type name `*T`, and `T` itself may not be a pointer type. The unqualified type name acts as the field name.

Source: https://go.dev/ref/spec#Struct_types

### Selectors - Promotion

> For a value `x` of type `T` or `*T` where `T` is not a pointer or interface type, `x.f` denotes the field or method at the shallowest depth in `T` where there is such an `f`. If there is not exactly one `f` with shallowest depth, the selector expression is illegal.

Source: https://go.dev/ref/spec#Selectors

> A field or method `f` of an embedded field in a struct `x` is called **promoted** if `x.f` is a legal selector that denotes that field or method `f`.

Source: https://go.dev/ref/spec#Selectors

### Method Sets - Embedding Clauses

> The method set of a struct type S consists of all methods declared with receiver type S. The method set of a pointer to a struct type S (where S is not a pointer or interface type) is the set of all methods declared with receiver `*S` or `S`. Further rules apply to structs containing embedded fields, as described in the section on struct types. Any other type has an empty method set.

Source: https://go.dev/ref/spec#Method_sets

> Promoted methods are included in the method set of the struct as follows:
> - If S contains an embedded field T, the method sets of S and *S both include promoted methods with receiver T. The method set of *S also includes promoted methods with receiver *T.
> - If S contains an embedded field *T, the method sets of S and *S both include promoted methods with receiver T or *T.

Source: https://go.dev/ref/spec#Struct_types

---

## 2. Formal Grammar (EBNF)

### Struct type

```ebnf
StructType    = "struct" "{" { FieldDecl ";" } "}" .
FieldDecl     = (IdentifierList Type | EmbeddedField) [ Tag ] .
EmbeddedField = [ "*" ] TypeName [ TypeArgs ] .
TypeName      = identifier | QualifiedIdent .
Tag           = string_lit .
```

The relevant production is `EmbeddedField`. Notice it is either `T`, `*T`, or `pkg.T` / `*pkg.T`. The grammar forbids `**T` and forbids declaring an embedded field with an explicit name.

### Selector

```ebnf
PrimaryExpr = ... | PrimaryExpr Selector | ...
Selector    = "." identifier .
```

Selector resolution is governed by the depth-and-uniqueness rule in the spec text quoted above.

---

## 3. Core Rules and Constraints

### Rule 1 - Embedded field syntax

An embedded field is written as a type, with no explicit name. The unqualified type name acts as the field name.

```go
type Inner struct{}
type Outer struct {
    Inner       // field name is "Inner"
}

var o Outer
_ = o.Inner    // field access
```

For a pointer-embedded field:

```go
type Outer struct {
    *Inner      // field name is still "Inner"
}
```

### Rule 2 - Embedded type restrictions

The type of an embedded field must be one of:

- A defined type `T` (not a type parameter, not a pointer type, not a function type with named results).
- A pointer to a defined non-interface type, `*T`.
- A type alias to one of the above (since Go 1.9), as long as the alias resolves to a permitted form.

The type may not be:

- A pointer to a pointer (`**T`).
- A pointer to an interface (`*I`) - explicitly forbidden by the spec.
- An anonymous type (`struct{ ... }` without a name).

```go
// Legal
type T struct{}
type S struct{ T }
type S2 struct{ *T }

// Illegal
// type S3 struct{ **T }      // pointer to pointer
// type I interface{}
// type S4 struct{ *I }       // pointer to interface
// type S5 struct{ struct{} } // anonymous type
```

### Rule 3 - Field name uniqueness

A struct may not contain two embedded fields with the same field name. Because the field name comes from the type name, this prohibits embedding `pkg1.T` and `pkg2.T` simultaneously - both would yield field name `T`.

```go
import (
    "image"
    "image/color"
)

// type Both struct {
//     image.Point
//     color.Point  // illegal: duplicate field name "Point"
// }
```

### Rule 4 - Embedded interface in a struct

An interface type can be embedded in a struct (the field name is the interface type's unqualified name). Promotion still applies, but the methods come from whatever value is stored in the interface field at runtime. This is the mechanism that powers test stubs:

```go
type Stub struct {
    io.Reader
}
// Stub.Read promoted from io.Reader; runtime dispatch via interface
```

This is closely related to interface embedding but is technically a struct field whose type happens to be an interface. The method-set propagation rules apply unchanged: methods of `io.Reader` are promoted onto both `Stub` and `*Stub`.

---

## 4. Selectors and Promoted Fields/Methods

### Selector resolution algorithm

When the compiler resolves `x.f`:

1. Determine the type `T` of `x` (or the pointed-to type if `x` is `*T`).
2. Walk the **embedded-field tree** starting from `T`. The depth of `T` is 0; the depth of an embedded field at level k is k+1.
3. At each depth, collect all fields and methods named `f`.
4. Choose the **shallowest depth** at which any `f` was found.
5. If there is **exactly one** `f` at that depth, the selector resolves to it.
6. If there is **more than one** `f` at that depth, the selector is **illegal** (compile error: ambiguous selector).
7. If there is no `f` at any depth, the selector is **illegal** (compile error: undefined field or method).

### Worked example

```go
type A struct{ X int }
func (A) M() string { return "A" }

type B struct{ X int }
func (B) M() string { return "B" }

type C struct {
    A
    B
}

var c C
// c.X       // ambiguous: A.X and B.X at depth 1
// c.M()     // ambiguous: A.M and B.M at depth 1
c.A.X        // legal - depth 1, unique selector
c.A.M()      // legal
```

### Shallowest-depth wins

```go
type Inner struct{ X int }
type Outer struct {
    X int        // depth 0
    Inner        // X also at depth 1, but we already win at depth 0
}

var o Outer
o.X = 1          // resolves to Outer.X (depth 0)
o.Inner.X = 2    // explicit qualifier reaches the inner X
```

### Promoted field also legal as l-value

A promoted field is addressable and assignable:

```go
type Inner struct{ X int }
type Outer struct{ Inner }

var o Outer
o.X = 5        // assignment via promoted selector
p := &o.X      // address-of through promotion
```

For a `*Inner` embedding, the same is true if the pointer is non-nil; otherwise dereference panics at runtime.

---

## 5. Method Sets with Embedded Fields

### Definition (from spec)

For a struct type `S`:

- `S` has a method set determined by:
  1. All methods declared with receiver `S`.
  2. For every embedded field `T` (value embed), all methods of `T`'s method set.
  3. For every embedded field `*T` (pointer embed), all methods of `*T`'s method set.

For pointer type `*S`:

- All methods declared with receiver `S` or `*S`.
- For every embedded field `T` (value embed), all methods of `T`'s method set **and** `*T`'s method set (because from `*S` we can address `S.T` and form `&S.T`).
- For every embedded field `*T` (pointer embed), all methods of `*T`'s method set (which by spec already includes `T`'s value-receiver methods).

### Tabular summary

| Outer field declaration | Method set of Outer (value) | Method set of *Outer |
|---|---|---|
| `Inner` (value embed) | Inner's value methods | Inner's value + pointer methods |
| `*Inner` (pointer embed) | Inner's value + pointer methods | Inner's value + pointer methods |

### Example matrix

```go
type Inner struct{}
func (i  Inner) V() {}    // value receiver
func (i *Inner) P() {}    // pointer receiver

type ByValue   struct{ Inner }
type ByPointer struct{ *Inner }

// Method sets:
// ByValue:    {V}
// *ByValue:   {V, P}
// ByPointer:  {V, P}
// *ByPointer: {V, P}
```

### Interface satisfaction consequence

```go
type HasP interface { P() }

var bv  ByValue
var bp  ByPointer
// var _ HasP = bv     // compile error - V only
var _ HasP = &bv       // OK - *ByValue has P
var _ HasP = bp        // OK
var _ HasP = &bp       // OK
```

This is the source of most "does not implement interface" diagnostics involving embedding.

### Promoted method receiver remains the inner type

A subtle but spec-mandated point: a promoted method's receiver is **still the inner type**, not the outer type.

```go
type Inner struct{ N int }
func (i *Inner) Show() { fmt.Println(i.N) }

type Outer struct {
    *Inner
    N int
}

o := Outer{Inner: &Inner{N: 1}, N: 99}
o.Show()    // prints 1, not 99 - Show binds to o.Inner, not o
```

The receiver inside the promoted method is `o.Inner`, not `&o`. This is the crucial difference between Go's promotion and Java's inheritance: there is no "this" that refers to the outer object.

---

## 6. Behavioral Specification

### Method promotion is purely lexical

Promotion is a compile-time selector-resolution rule. It is **not** runtime dispatch. The expression `o.M()` where `M` is promoted from `o.Inner` is exactly equivalent to `o.Inner.M()` after compilation. There is no virtual dispatch and no entry in any vtable for the outer type that points to the inner method.

### Method values created from promoted methods

```go
type Inner struct{}
func (Inner) Greet() string { return "hi" }

type Outer struct{ Inner }

var o Outer
mv := o.Greet       // method value
fmt.Println(mv())   // "hi"

me := Outer.Greet   // method expression - type is func(Outer) string
fmt.Println(me(o))
```

The method expression `Outer.Greet` is legal because `Greet` is in the method set of `Outer`. Internally, the compiler synthesizes a stub that calls `Inner.Greet` after taking `o.Inner`.

### Shadowing is depth-based

A method declared on the outer type wins because it sits at depth 0; the promoted method sits at depth 1. The shallowest-depth rule eliminates the promoted candidate.

```go
type Inner struct{}
func (Inner) Hello() string { return "inner" }

type Outer struct{ Inner }
func (Outer) Hello() string { return "outer" }

var o Outer
o.Hello()      // "outer"
o.Inner.Hello() // "inner"
```

Shadowing is purely lexical; there is no concept of overriding.

---

## 7. Defined vs Undefined Behavior

### Defined operations

| Operation | Behavior |
|---|---|
| Embed value type `T` | Promotes `T`'s value methods to `Outer`; `Outer`'s pointer methods include `*T`'s methods too |
| Embed pointer type `*T` | Promotes both `T`'s and `*T`'s methods to `Outer` and `*Outer` |
| `outer.M()` where `M` is promoted | Resolved at compile time to `outer.Inner.M()` |
| `outer.Inner.M()` | Always legal regardless of shadowing |
| `outer.M()` where `Outer` defines own `M` | Outer's own method wins |
| Two embedded fields share method name and `M` is called | Compile error: ambiguous selector |
| Calling promoted pointer-receiver method on non-addressable value | Compile error |

### Illegal operations

| Operation | Result |
|---|---|
| `type S struct{ **T }` | Compile error |
| `type S struct{ *I }` where I is interface | Compile error |
| `type S struct{ A; B }` where A and B have same unqualified name | Compile error: duplicate field |
| Promoted method call on non-addressable value when method needs `*T` receiver | Compile error |
| `outer.M()` where two siblings at same depth declare M | Compile error: ambiguous selector |

### Runtime behavior

- If `*T` is embedded and the embedded field is nil, calling a promoted method that dereferences the receiver causes a runtime panic.
- Calling a promoted method that does not dereference (`func (t *T) IsNil() bool { return t == nil }`) is safe even with a nil embedded pointer.

---

## 8. Edge Cases from Spec

### Edge Case 1 - Two embedded fields, same depth, same name

```go
type A struct{}
func (A) M() {}
type B struct{}
func (B) M() {}

type C struct{ A; B }

var c C
// c.M() // ambiguous selector c.M
```

Per spec, "If there is not exactly one f with shallowest depth, the selector expression is illegal." This is the formal reason there is no diamond problem.

### Edge Case 2 - Same name, different depths

```go
type Inner struct{}
func (Inner) M() {}

type Mid struct{ Inner }
func (Mid) M() {} // shadows Inner.M at depth 0 of Mid

type Outer struct{ Mid }

var o Outer
o.M() // resolves to Mid.M (depth 1), Inner.M is not at shallowest depth
```

Shallowest depth rule continues to apply through any nesting level.

### Edge Case 3 - Field and method with same name

```go
type Inner struct{ Name string }
func (Inner) Method() {}

type Outer struct {
    Inner
    Name string  // shadows Inner.Name at depth 0
}

var o Outer
o.Name = "x"     // Outer's Name
o.Inner.Name     // Inner's Name
o.Method()       // promoted from Inner
```

A shadowing field and a promoted method coexist freely as long as their names differ. If they share a name, the field wins (it is at the shallower depth).

### Edge Case 4 - Embedded type from another package

```go
import "sync"

type Counter struct {
    sync.Mutex     // field name is "Mutex"
    n int
}

c := &Counter{}
c.Lock()           // promoted from sync.Mutex
c.Mutex.Lock()     // explicit qualifier - field name is unqualified
```

The unqualified type name (`Mutex`) becomes the field name, regardless of the package qualifier in the declaration.

### Edge Case 5 - Embedded interface in a struct

```go
type Stringer interface{ String() string }

type Wrapper struct {
    Stringer
}

w := Wrapper{Stringer: stringerImpl{}}
fmt.Println(w.String()) // dispatches via interface
```

`Wrapper` has `String()` in its method set because it embeds `Stringer`. The actual call goes through the interface table at runtime.

### Edge Case 6 - Generic embedded field

Since Go 1.18 a struct may embed a parameterized type's instantiation:

```go
type Container[T any] struct{ items []T }

func (c *Container[T]) Add(x T) {}

type IntContainer struct {
    Container[int]
}

var ic IntContainer
ic.Add(42)     // promoted; type is func(int)
```

The embedded field's name is `Container` (the unqualified type name without type arguments).

### Edge Case 7 - Anonymous struct field disallowed

```go
// type S struct { struct{ X int } } // illegal: anonymous struct
```

The grammar requires a TypeName, not a TypeLit. Use a named type if you need this shape.

### Edge Case 8 - Pointer receiver promotion and addressability

```go
type Inner struct{ N int }
func (i *Inner) Show() {}

type Outer struct{ Inner }

func makeOuter() Outer { return Outer{} }

makeOuter().Show()   // compile error - return value not addressable
o := makeOuter()
o.Show()             // OK - o is addressable
```

The non-addressability of function results disables promoted pointer-receiver method calls. Same constraint applies to map element access.

---

## 9. Version History

| Go Version | Change |
|---|---|
| Go 1.0 | Embedded fields and method promotion specified. Field-name = unqualified type name. |
| Go 1.0 | Selector ambiguity rule (shallowest depth, unique). |
| Go 1.4 | Method values formalized; promoted methods produce method values consistently. |
| Go 1.9 | Type aliases (`type X = Y`) - aliases may be used in embedded fields (the field name comes from the alias name, not the underlying type). |
| Go 1.18 | Generics - struct types may embed instantiations of generic types. The field name is the unqualified base name without type arguments. |
| Go 1.21 | No method-promotion semantic change. |
| Go 1.22 | No method-promotion semantic change. Loop-variable per-iteration scoping does not affect embedded field semantics. |

---

## 10. Implementation Notes

### Compile-time only

Method promotion has zero runtime cost. The compiler rewrites `o.M()` to `o.Inner.M()` during selector resolution. The resulting program contains no extra indirection beyond the explicit form.

### Method values for promoted methods

A method value `o.M` for a promoted `M` is implemented as a closure that captures `o.Inner` (or `&o.Inner`, depending on receiver type) and calls the underlying method. This means the receiver capture happens at the time of the method-value expression, exactly as for non-promoted method values.

### Race detector

The `-race` flag treats promoted methods identically to direct methods. A data race on an embedded `sync.Mutex` is detected at the point of access through the embedded selector.

### Compiler diagnostics

- "ambiguous selector" - two equally-shallow promotions or fields with the same name.
- "cannot take address" - pointer-receiver method called on a non-addressable expression containing a promoted selector.
- "duplicate field" - two embedded fields with the same unqualified type name.

These messages are stable across recent Go versions.

---

## 11. Spec Compliance Checklist

- [ ] Embedded field is declared as `T` or `*T` where `T` is a defined non-pointer non-interface type, or a type alias resolving to such a form.
- [ ] No two embedded fields share the same unqualified type name.
- [ ] All embedded types come from packages that are properly imported.
- [ ] Selectors that could be ambiguous are explicitly qualified with `o.Inner.M()`.
- [ ] Pointer-receiver promoted methods are called only on addressable values (named variables, dereferenced pointers, struct fields), not on map elements or function return values directly.
- [ ] Embedded `sync.Mutex` (or any `Locker`) is used only with pointer receivers on the outer type.
- [ ] When two embedded types could conflict on a method name, the outer type defines its own version of the method to shadow them.
- [ ] When using interface-typed embedded fields, the runtime initialization sets the field before any promoted method is called.
- [ ] Generic embedded fields use the correct field name (base name without type args).

---

## Cheat Sheet

```
EMBEDDED FIELD GRAMMAR
─────────────────────────────────────────
struct { T }       value embed,   field name = T
struct { *T }      pointer embed, field name = T
struct { **T }     ILLEGAL
struct { *I }      ILLEGAL (I is interface)

SELECTOR RESOLUTION
─────────────────────────────────────────
1. Walk embedded tree to find f.
2. Take f at shallowest depth.
3. Exactly one at that depth → legal.
4. More than one → ambiguous selector (compile error).
5. None → undefined field/method (compile error).

METHOD-SET PROMOTION
─────────────────────────────────────────
Embed T:
  Outer            ← T's value methods
  *Outer           ← T's value + *T's methods
Embed *T:
  Outer  and *Outer ← T's value + *T's methods

KEY INVARIANT
─────────────────────────────────────────
Receiver of a promoted method is the INNER type,
never the OUTER. There is no `super`, no `this`-points-
to-outer, and no virtual dispatch.

DIFF FROM 06-EMBEDDING-INTERFACES
─────────────────────────────────────────
This file:  STRUCT embeds STRUCT (or interface field) -
            method promotion via selectors.
06 file:    INTERFACE embeds INTERFACE - method-signature
            inheritance in interface declarations.
```
