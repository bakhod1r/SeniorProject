# Pointer Receivers — Specification

> Source: [Go Language Specification](https://go.dev/ref/spec) — §Method_declarations, §Method_sets, §Pointer_types, §Address_operators

---

## Table of Contents

1. [Spec Reference](#1-spec-reference)
2. [Formal Grammar (EBNF)](#2-formal-grammar-ebnf)
3. [Receiver Type Rules](#3-receiver-type-rules)
4. [Method Set Rules](#4-method-set-rules)
5. [Addressability Rules](#5-addressability-rules)
6. [Auto-Addressing Mechanics](#6-auto-addressing-mechanics)
7. [Defined vs Undefined Behavior](#7-defined-vs-undefined-behavior)
8. [Edge Cases from Spec](#8-edge-cases-from-spec)
9. [Version History](#9-version-history)
10. [Spec Compliance Checklist](#10-spec-compliance-checklist)
11. [Official Examples](#11-official-examples)
12. [Related Spec Sections](#12-related-spec-sections)

---

## 1. Spec Reference

### Method Receiver — Official Text

> The type denoted by T is called the receiver base type. It must be a defined
> type defined in the same package as the method. ... The receiver is specified
> via an extra parameter section preceding the method name in the function
> declaration.

Source: https://go.dev/ref/spec#Method_declarations

### Pointer Receiver — Official Text

> A method declaration binds an identifier, the method name, to a method, and
> associates the method with the receiver's base type. ... Methods may be
> defined for any named type (except a pointer or interface) if the type is
> declared in the same package as the method. The pointer receiver and the
> base receiver are bound to the same base type, but they may have different
> method sets.

Source: https://go.dev/ref/spec#Method_declarations

### Method Set of *T — Official Text

> The method set of a pointer to a defined type T (where T is neither a
> pointer nor an interface) is the set of all methods declared with receiver
> *T or T.

Source: https://go.dev/ref/spec#Method_sets

### Address Operator — Official Text

> The operand must be addressable, that is, either a variable, pointer
> indirection, or slice indexing operation; or a field selector of an
> addressable struct operand; or an array indexing operation of an addressable
> array. As an exception to the addressability requirement, x may also be a
> (possibly parenthesized) composite literal.

Source: https://go.dev/ref/spec#Address_operators

### Selectors — Official Text

> For a value x of type T or *T where T is not a pointer or interface type,
> x.f denotes the field or method at the shallowest depth in T where there is
> such an f. If there is not exactly one f with shallowest depth, the selector
> expression is illegal.
>
> A selector f may denote a field or method f of type T, or it may refer to a
> field or method f of a nested embedded field of T. The number of embedded
> fields traversed to reach f is called its depth in T.
>
> For a value x of type I where I is an interface type, x.f denotes the dynamic
> method called f of the value assigned to x.

Source: https://go.dev/ref/spec#Selectors

---

## 2. Formal Grammar (EBNF)

### Pointer Receiver Method

```ebnf
MethodDecl   = "func" Receiver MethodName Signature [ FunctionBody ] .
Receiver     = "(" [ identifier ] [ "*" ] BaseTypeName ")" .
BaseTypeName = identifier .
```

The optional `*` distinguishes pointer receiver from value receiver.

### Pointer Type

```ebnf
PointerType = "*" BaseType .
BaseType    = Type .
```

### Method Call

```ebnf
PrimaryExpr = PrimaryExpr Selector | PrimaryExpr Arguments .
Selector    = "." identifier .
Arguments   = "(" [ ... ] ")" .
```

---

## 3. Receiver Type Rules

### Rule 1: Receiver base type restrictions

The receiver base type **must satisfy all of**:
1. Be a defined type (not a type alias).
2. Be in the **same package** as the method.
3. Be neither a pointer type nor an interface type.

### Rule 2: Pointer receiver legal forms

| Form | Legal? | Notes |
|------|--------|-------|
| `func (t T) M()` | ✅ | Value receiver |
| `func (t *T) M()` | ✅ | Pointer receiver |
| `func (t **T) M()` | ❌ | Multiple indirection forbidden |
| `func (t *I) M()` where I is interface | ❌ | Cannot have pointer to interface receiver |
| `func (t *(*T)) M()` | ❌ | Same as above |

### Rule 3: One receiver per method declaration

```go
// Illegal — exactly one receiver allowed
// func (a A, b B) M() {}
```

### Rule 4: Receiver identifier may be omitted

```go
type T struct{}
func (T) M() {}        // legal — receiver name elided
func (*T) M() {}       // legal — same for pointer receiver
```

The receiver value cannot be referenced inside the body if elided.

---

## 4. Method Set Rules

### Method set of T (T not pointer/interface)

The method set of T consists of all methods declared with receiver type T.

| Receiver | In method set of T? |
|----------|--------------------|
| `func (t T) M()` | ✅ Yes |
| `func (t *T) M()` | ❌ No |

### Method set of *T

The method set of *T is the set of all methods declared with receiver *T or T.

| Receiver | In method set of *T? |
|----------|----------------------|
| `func (t T) M()` | ✅ Yes |
| `func (t *T) M()` | ✅ Yes |

### Promotion via embedding

If S embeds T:
- S's method set includes promoted methods.
- For T value embed: only T's value-receiver methods are promoted to S; all of T's methods (value + pointer) are promoted to *S.
- For *T embed: all methods (value + pointer) are promoted to both S and *S.

---

## 5. Addressability Rules

### Addressable operands

The spec defines addressable as:
- A **variable** (declared in any scope).
- A **pointer indirection** (`*p`).
- A **slice indexing** operation (`s[i]`).
- A **field selector** of an addressable struct operand.
- An **array indexing** operation of an addressable array.
- A **composite literal** (exception — addressable for taking pointer).

### Not addressable

- **Map element** — `m[k]` is not addressable.
- **Function call result** — `f()` is not addressable.
- **String index** — `s[i]` is byte value, not addressable.
- **Constant** — `5`, `"abc"`.
- **Channel receive** — `<-ch`.
- **Type conversion** — `int(x)` (unless x is addressable and convertible-equivalent).

---

## 6. Auto-Addressing Mechanics

### Auto-addressing rule

> A method call x.m() is valid if the method set of (the type of) x contains
> m and the argument list can be assigned to the parameter list of m. If x is
> addressable and &x's method set contains m, x.m() is shorthand for
> (&x).m().

This is the auto-addressing rule.

### Practical implications

```go
type C struct{}
func (c *C) M() {}

var c C       // c is a variable → addressable
c.M()         // legal — Go: (&c).M()

// But:
m := map[string]C{"k": {}}
m["k"].M()    // illegal — m["k"] not addressable
```

### Auto-dereferencing

> If the method set of *x contains m, x.m() is shorthand for (*x).m().

Always works because dereferencing does not require addressability.

```go
type C struct{}
func (c C) M() {}

p := &C{}
p.M()          // legal — Go: (*p).M()
```

---

## 7. Defined vs Undefined Behavior

### Defined operations

| Operation | Behavior |
|-----------|---------|
| `func (t *T) M()` | M added to method set of *T |
| `t.M()` where t addressable | Auto-`&t` if M is pointer receiver |
| `p.M()` where p is *T | Auto-`*p` if M is value receiver |
| Calling pointer-receiver method on nil pointer | Method runs with t=nil |
| Dereferencing nil inside method | Runtime panic (defined as panic) |

### Illegal operations

| Operation | Result |
|-----------|--------|
| `m["k"].PtrM()` | Compile error: cannot take address |
| `f().PtrM()` (return value) | Compile error: cannot take address |
| `(*I).M` where I is interface | Compile error: cannot have pointer to interface receiver |
| Method on imported type | Compile error: cannot define new method on non-local type |
| Method on alias (different package's type) | Compile error |

---

## 8. Edge Cases from Spec

### Edge Case 1: Nil pointer receiver

```go
type T struct{}
func (t *T) Hello() string {
    if t == nil { return "hello, nil" }
    return "hello"
}

var p *T
fmt.Println(p.Hello())  // "hello, nil" — legal, no panic
```

### Edge Case 2: Composite literal addressability

The spec includes a special exception for composite literals:

```go
type T struct{}
func (t *T) M() {}

(&T{}).M()    // legal — composite literal addressable for &
T{}.M()        // also legal in some contexts due to exception, but generally avoided
```

### Edge Case 3: Map element via vary intermediate

```go
type C struct{ n int }
func (c *C) Inc() { c.n++ }

m := map[string]*C{"k": {n: 0}}
m["k"].Inc()   // legal — m["k"] is *C value, dereferencing
```

When map values are pointers, `.PtrM()` works because dereferencing is always legal.

### Edge Case 4: Slice element via index

```go
s := []C{{}}
s[0].Inc()   // legal — slice index addressable
```

### Edge Case 5: Chained pointer dereferences

```go
type T struct{ n int }
func (t *T) Inc() { t.n++ }

p := &(&T{}).n   // illegal? Let's see
```

`(&T{}).n` is field access of addressable composite literal — addressable.

### Edge Case 6: Embedded pointer

```go
type Base struct{}
func (b *Base) M() {}

type S1 struct{ Base }      // value embed
type S2 struct{ *Base }     // pointer embed

var s1 S1
var s2 S2 = S2{Base: &Base{}}

s1.M()    // legal if s1 addressable — Go: (&s1.Base).M()
s2.M()    // legal — Go: (*s2.Base).M() then auto-`&` is N/A
                  // actually: s2.Base is *Base, so s2.Base.M() works directly
```

---

## 9. Version History

| Go Version | Change |
|------------|--------|
| Go 1.0 | Pointer/value receiver introduced. |
| Go 1.0 | Method set rules formalized. |
| Go 1.4 | Method values clarified. |
| Go 1.18 | Generics: `func (l *List[T]) M()` requires type parameter list. |
| Go 1.22 | Loop variable semantics: per-iteration variable. Fixes loop-variable-capture bug with method values. |

---

## 10. Spec Compliance Checklist

- [ ] Pointer receiver base type is defined type, not pointer/interface.
- [ ] Receiver tip same package as method.
- [ ] No `**T` or pointer-to-interface receivers.
- [ ] Method set rules respected for interface satisfaction.
- [ ] Map elements not used directly with pointer-receiver methods.
- [ ] Nil pointer receivers handled defensively if applicable.
- [ ] Receiver naming consistent across methods of the same type.
- [ ] `noCopy` marker used for sync-containing types.

---

## 11. Official Examples

### Method declaration — pointer vs value

```go
type Point struct { x, y float64 }

// Value receiver — Length doesn't modify
func (p Point) Length() float64 {
    return math.Sqrt(p.x*p.x + p.y*p.y)
}

// Pointer receiver — Scale modifies
func (p *Point) Scale(factor float64) {
    p.x *= factor
    p.y *= factor
}
```

### Method set illustration (from spec)

```go
type T struct{}

func (t  T) Mv()  {}      // method set of T:  {Mv}
func (t *T) Mp()  {}      // method set of *T: {Mv, Mp}

var v T
var p *T = &v

v.Mv()   // OK
v.Mp()   // OK if v addressable; equivalent to (&v).Mp()
p.Mv()   // OK; equivalent to (*p).Mv()
p.Mp()   // OK
```

### Auto-addressing

```go
package main

type Counter struct{ n int }
func (c *Counter) Inc() { c.n++ }

func main() {
    c := Counter{}
    c.Inc()              // OK — Go: (&c).Inc()
    c.Inc()
    println(c.n)         // 2

    m := map[string]Counter{"k": {}}
    // m["k"].Inc()       // illegal — cannot take address of m["k"]

    v := m["k"]
    v.Inc()
    m["k"] = v
}
```

---

## 12. Related Spec Sections

| Section | URL | Relevance |
|---------|-----|-----------|
| Method declarations | https://go.dev/ref/spec#Method_declarations | Receiver syntax |
| Method sets | https://go.dev/ref/spec#Method_sets | Pointer receiver in method set |
| Pointer types | https://go.dev/ref/spec#Pointer_types | *T type |
| Address operators | https://go.dev/ref/spec#Address_operators | & and addressability |
| Selectors | https://go.dev/ref/spec#Selectors | x.f and method lookup |
| Calls | https://go.dev/ref/spec#Calls | Method call semantics |
| Composite literals | https://go.dev/ref/spec#Composite_literals | Addressability exception |
| Slice expressions | https://go.dev/ref/spec#Slice_expressions | Slice element addressability |
| Index expressions | https://go.dev/ref/spec#Index_expressions | Map vs slice indexing |
