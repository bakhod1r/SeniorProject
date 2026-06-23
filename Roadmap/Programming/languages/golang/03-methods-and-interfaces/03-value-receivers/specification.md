# Value Receivers — Specification

> Source: [Go Language Specification](https://go.dev/ref/spec) — §Method_declarations, §Method_sets, §Comparison_operators

---

## Table of Contents

1. [Spec Reference](#1-spec-reference)
2. [Formal Grammar (EBNF)](#2-formal-grammar-ebnf)
3. [Receiver Type Rules](#3-receiver-type-rules)
4. [Method Set Rules](#4-method-set-rules)
5. [Copy Semantics](#5-copy-semantics)
6. [Comparability Rules](#6-comparability-rules)
7. [Defined vs Undefined Behavior](#7-defined-vs-undefined-behavior)
8. [Edge Cases from Spec](#8-edge-cases-from-spec)
9. [Version History](#9-version-history)
10. [Spec Compliance Checklist](#10-spec-compliance-checklist)
11. [Official Examples](#11-official-examples)
12. [Related Spec Sections](#12-related-spec-sections)

---

## 1. Spec Reference

### Method Receiver — Official Text

> The type of the receiver must be of the form T or *T (possibly with
> parentheses) where T is a type name. The type denoted by T is called the
> receiver base type.

Source: https://go.dev/ref/spec#Method_declarations

### Method Set of T — Official Text

> The method set of a defined type T consists of all methods declared with
> receiver type T.

Source: https://go.dev/ref/spec#Method_sets

### Calls — Official Text

> A method call x.m() is valid if the method set of (the type of) x contains
> m and the argument list can be assigned to the parameter list of m. If x is
> addressable and &x's method set contains m, x.m() is shorthand for (&x).m().

Source: https://go.dev/ref/spec#Calls

### Comparison Operators — Official Text

> Struct values are comparable if all their fields are comparable. Two struct
> values are equal if their corresponding non-blank fields are equal.

Source: https://go.dev/ref/spec#Comparison_operators

---

## 2. Formal Grammar (EBNF)

### Value Receiver

```ebnf
MethodDecl   = "func" Receiver MethodName Signature [ FunctionBody ] .
Receiver     = "(" [ identifier ] BaseTypeName ")" .   // no leading *
BaseTypeName = identifier .
```

### Pointer Receiver (for contrast)

```ebnf
Receiver = "(" [ identifier ] "*" BaseTypeName ")" .
```

The asterisk distinguishes pointer from value.

---

## 3. Receiver Type Rules

### Rule 1: Receiver base type restrictions

The receiver base type must:
1. Be a defined type (not an alias).
2. Be in the same package as the method.
3. Not be a pointer type (so `**T` is illegal).
4. Not be an interface type.

### Rule 2: Value receiver legal forms

```go
func (t T) M()         // legal
func (T) M()           // legal — receiver name elided
func (_ T) M()         // legal — explicit blank
```

### Rule 3: Receiver and Generic Types

A method on a generic type must include the type parameter list (without
constraints) on the receiver:

```go
type List[T any] struct { items []T }

func (l List[T]) Get(i int) T { return l.items[i] }   // value receiver, generic
```

---

## 4. Method Set Rules

### Method set of T

> The method set of a defined type T consists of all methods declared with
> receiver type T.

| Receiver | In method set of T? | In method set of *T? |
|----------|--------------------|----------------------|
| `func (t T) M()` | ✅ Yes | ✅ Yes |
| `func (t *T) M()` | ❌ No | ✅ Yes |

### Implication for interface satisfaction

If interface I has method M:
- `T` satisfies I if M is declared with value receiver.
- `*T` satisfies I in either case.

### Promotion via embedding

If S embeds T:
- T's value-receiver methods are promoted to S and *S.
- T's pointer-receiver methods are promoted to *S only (and to S if S is addressable).

---

## 5. Copy Semantics

### Receiver copy on call

When `t.M()` is called and M has value receiver, the value of `t` is copied
into the parameter `t` of M. This is a normal value copy.

```go
type T struct{ n int }
func (t T) M() {
    t.n = 99   // local copy modified
}

x := T{n: 1}
x.M()
// x.n is still 1
```

### Reference field semantics

Reference fields (slice, map, function, pointer, channel) share underlying
data after copy:

```go
type Box struct{ items []int }
func (b Box) Zero() {
    b.items[0] = 0   // SHARED underlying array
}

box := Box{items: []int{1, 2, 3}}
box.Zero()
// box.items is now [0, 2, 3]
```

`append`, however, may allocate new backing storage and the local copy of the
slice header is not propagated back.

---

## 6. Comparability Rules

### Struct comparability

> Struct types are comparable if all their field types are comparable. Two
> struct values are equal if their corresponding non-blank fields are equal.

```go
type Point struct{ X, Y int }
a := Point{1, 2}
b := Point{1, 2}
fmt.Println(a == b)  // true
```

### Non-comparable field

```go
type Bag struct{ items []int }   // not comparable (slice)
// var m map[Bag]int  // compile error: invalid map key type
```

### Comparable as constraint

`comparable` is a built-in constraint introduced in Go 1.18:

```go
func Find[T comparable](items []T, target T) int { ... }
```

Comparable includes all built-in types (except slice/map/func) and structs of
comparable fields.

---

## 7. Defined vs Undefined Behavior

### Defined operations

| Operation | Behavior |
|-----------|---------|
| `func (t T) M()` | M added to method set of T (and *T) |
| `t.M()` where t is T | t copied to parameter |
| `(&t).M()` where M is value receiver | OK — auto-dereference |
| `t.M()` where t is *T value receiver M | OK — auto-dereference |
| `==` on comparable struct | Field-by-field equality |

### Illegal operations

| Operation | Result |
|-----------|--------|
| `func (t **T) M()` | Compile error |
| Method on alias type | Compile error if base in different package |
| `==` on struct with non-comparable field | Compile error |
| Map key with non-comparable type | Compile error |

---

## 8. Edge Cases from Spec

### Edge Case 1: Reference field mutation

Per spec: Slice header is copied; underlying array is shared.

```go
type S struct{ b []int }
func (s S) M() { s.b[0] = 99 }   // modifies original
```

### Edge Case 2: Comparable struct

```go
type P struct{ X, Y int }   // comparable
type C struct{ items []int } // not comparable

p1 := P{1, 2}
p2 := P{1, 2}
fmt.Println(p1 == p2)   // true

c1 := C{items: []int{1}}
// c1 == C{items: []int{1}}  // compile error
```

### Edge Case 3: Generic type method with constraint

```go
type Set[T comparable] struct { m map[T]struct{} }

func (s Set[T]) Has(x T) bool {
    _, ok := s.m[x]
    return ok
}
```

`comparable` constraint required because `==` is used.

### Edge Case 4: Function type method

```go
type Handler func(int) int

func (h Handler) Pipe(other Handler) Handler {
    return func(x int) int { return other(h(x)) }
}
```

Function type — value receiver, returns Handler.

### Edge Case 5: Slice-typed method

```go
type IntSlice []int

func (s IntSlice) Sum() int {
    total := 0
    for _, v := range s { total += v }
    return total
}
```

Slice value receiver — header copy.

---

## 9. Version History

| Go Version | Change |
|------------|--------|
| Go 1.0 | Value/pointer receiver introduced. |
| Go 1.0 | Method set rules formalized. |
| Go 1.18 | Generics: `comparable` constraint, type parameter list on receiver. |
| Go 1.21 | `min`, `max`, `clear` predeclared. No method/receiver semantic change. |

---

## 10. Spec Compliance Checklist

- [ ] Value receiver base type is defined type, not pointer/interface.
- [ ] Value receiver method-set inclusion understood (T and *T).
- [ ] Reference field semantics understood (shared mutation).
- [ ] Comparable types — all comparable fields.
- [ ] Map key types are comparable.
- [ ] Generic types repeat type parameter list on receiver.

---

## 11. Official Examples

### Value receiver method (from spec)

```go
type Point struct{ X, Y float64 }

func (p Point) Length() float64 {
    return math.Sqrt(p.X*p.X + p.Y*p.Y)
}
```

### Method set inclusion

```go
type T struct{}
func (t T)  V() {}    // method set of T:  {V}
func (t *T) P() {}    // method set of *T: {V, P}

var v T
var p *T = &v

v.V()   // OK
v.P()   // OK if v addressable
p.V()   // OK
p.P()   // OK
```

### Comparable struct

```go
type Pt struct { X, Y int }

a := Pt{1, 2}
b := Pt{1, 2}
fmt.Println(a == b)   // true

m := map[Pt]string{}
m[Pt{0, 0}] = "origin"
```

---

## 12. Related Spec Sections

| Section | URL | Relevance |
|---------|-----|-----------|
| Method declarations | https://go.dev/ref/spec#Method_declarations | Receiver syntax |
| Method sets | https://go.dev/ref/spec#Method_sets | Value receiver inclusion |
| Calls | https://go.dev/ref/spec#Calls | Method call semantics |
| Comparison operators | https://go.dev/ref/spec#Comparison_operators | == on structs |
| Type identity | https://go.dev/ref/spec#Type_identity | Comparable types |
| Type constraints | https://go.dev/ref/spec#Type_constraints | comparable constraint |
| Composite literals | https://go.dev/ref/spec#Composite_literals | Value initialization |
