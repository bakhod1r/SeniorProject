# Methods on Generic Types — Middle Level

## Table of Contents
1. [Method sets after instantiation](#method-sets-after-instantiation)
2. [Type-level vs method-level constraints](#type-level-vs-method-level-constraints)
3. [Why methods cannot introduce new type parameters](#why-methods-cannot-introduce-new-type-parameters)
4. [The free-function workaround](#the-free-function-workaround)
5. [Receiver compatibility rules](#receiver-compatibility-rules)
6. [Methods and the addressable-value rule](#methods-and-the-addressable-value-rule)
7. [Generic methods and interfaces](#generic-methods-and-interfaces)
8. [Methods on type aliases (Go 1.24+)](#methods-on-type-aliases-go-124)
9. [Summary](#summary)

---

## Method sets after instantiation

A generic type by itself is **not** a usable type — it is a template. Its method set comes alive only after instantiation.

```go
type Stack[T any] struct{ data []T }

func (s *Stack[T]) Push(v T)       { s.data = append(s.data, v) }
func (s *Stack[T]) Pop() (T, bool) { ... }
func (s *Stack[T]) Len() int       { return len(s.data) }
```

After `Stack[int]` is instantiated, the method set is:

```
*Stack[int]: { Push(int), Pop() (int, bool), Len() int }
 Stack[int]: { Len() int }
```

Pointer-receiver methods belong to the pointer's method set; value-receiver methods belong to both the value's and the pointer's method set — same rule as classic Go.

### Why instantiation is required

Without type arguments, `Stack` cannot have a method set:
- `Push(v T)` mentions `T` — what type is `T` here?
- The compiler cannot type-check the body until `T` is fixed.

Hence:

```go
var s *Stack    // ❌ cannot use generic type Stack without instantiation
var s *Stack[int]  // OK — method set is { Push(int), Pop() (int, bool), Len() int }
```

### Each instantiation has a distinct method set

`Stack[int]` and `Stack[string]` are **different types** with **different method sets** — even though they share source code:

```go
var a Stack[int]
var b Stack[string]
a = b   // ❌ cannot assign — different types
```

This is the same rule as `[]int` vs `[]string`.

---

## Type-level vs method-level constraints

A generic type's constraint is declared **once**, on the type:

```go
type Counter[T ~int | ~int64] struct{ n T }

func (c *Counter[T]) Add(d T) { c.n += d }
func (c Counter[T]) Get() T   { return c.n }
```

Every method automatically inherits the constraint — `T` is `~int | ~int64` everywhere.

### You cannot tighten the constraint per method

You cannot say "this method requires more than the type":

```go
type Box[T any] struct{ v T }

func (b Box[T comparable]) Eq(other Box[T]) bool {  // ❌ not allowed
    return b.v == other.v
}
```

The receiver's type parameter list **mirrors** the type's. The constraints are fixed once at the type declaration.

### Workaround — split into two types

If some operations need `comparable` and others do not:

```go
type Box[T any] struct{ v T }
type ComparableBox[T comparable] struct{ Box[T] }   // embeds, adds Eq

func (b ComparableBox[T]) Eq(other ComparableBox[T]) bool {
    return b.v == other.v
}
```

Or move the operation to a free function:

```go
func Eq[T comparable](a, b Box[T]) bool { return a.v == b.v }
```

### Constraint inheritance and embedding

Generic embedding (covered in `senior.md`) inherits the embedded type's constraint:

```go
type Pair[A, B any] struct { /* ... */ }
type LabeledPair[A, B any] struct {
    Pair[A, B]
    Label string
}
```

`LabeledPair[A, B]` re-declares the parameters and inherits methods of `Pair[A, B]`.

---

## Why methods cannot introduce new type parameters

Go 1.18+ deliberately forbids:

```go
type Box[T any] struct{ v T }

func (b Box[T]) Map[U any](f func(T) U) Box[U] {  // ❌
    return Box[U]{v: f(b.v)}
}
```

The compiler rejects this with: `methods cannot have type parameters`.

### The reasoning

Three reasons given by the Go team:

1. **Implementation cost.** Adding method-level type parameters would require:
   - Each call site to track per-method dictionaries
   - Method tables (vtables) with per-method type-parameter slots
   - Reflection support for method-level parameters
   - Linker work for methods that may be instantiated lazily
2. **Cognitive cost.** Two layers of generics (type and method) make signatures unreadable: `func (b Box[T]) Map[U any](f func(T) U) Box[U]` is hard to scan.
3. **Limited benefit.** Most use cases can be expressed as **free functions** with the type as an argument.

### What the spec says

From the spec: *"A method declaration binds an identifier, the method name, to a method, and associates the method with the receiver's base type. ... A method's type parameter list, if present, is identical to the type parameter list of its receiver base type."*

The rule is firm: a method's type parameter list is **identical** to the receiver's. No extras allowed.

---

## The free-function workaround

The recommended workaround is to express the operation as a free function:

```go
type Box[T any] struct{ v T }

// Free function — can introduce U
func Map[T, U any](b Box[T], f func(T) U) Box[U] {
    return Box[U]{v: f(b.v)}
}

// Usage
intBox := Box[int]{v: 1}
strBox := Map(intBox, func(i int) string { return fmt.Sprint(i) })
```

The caller writes `Map(intBox, ...)` instead of `intBox.Map(...)`. Slightly less fluent, but expressive.

### Helper: pkg-level `Apply`

A common pattern is to provide a free function `Apply` for "operations that change shape":

```go
package box

func Apply[T, U any](b Box[T], f func(T) U) Box[U] {
    return Box[U]{v: f(b.v)}
}
```

### When to accept the limitation

If your operation does **not** change the element type, prefer a method:

```go
// Stays in Box[T] — method is fine
func (b *Box[T]) Set(v T) { b.v = v }
```

If the operation **does** change shape, accept the free function.

---

## Receiver compatibility rules

The Go spec lists strict rules for what a generic-type method receiver may look like.

### Allowed forms

```go
func (b Box[T]) M()   {}       // value receiver
func (b *Box[T]) M()  {}       // pointer receiver
func (b Box[A]) M()   {}       // renamed parameter — legal but discouraged
func (_ *Box[T]) M()  {}       // blank identifier — for unused receiver
```

### Forbidden forms

```go
func (b Box) M() {}            // ❌ missing [T]
func (b *Box[T, U]) M() {}     // ❌ wrong arity
func (b Box[int]) M() {}       // ❌ cannot specialise — must be a parameter
```

The arity (number of type parameters) and shape (parameter, not concrete type) are checked against the receiver type's declaration.

### Cannot specialise

You cannot write a method that exists only for one specific instantiation:

```go
type Stack[T any] struct{ data []T }

func (s *Stack[int]) SumInts() int { ... }  // ❌
```

If you need this, write a free function `func SumInts(s *Stack[int]) int { ... }`.

---

## Methods and the addressable-value rule

A method with a pointer receiver can be called on:
- A pointer to the value
- An **addressable** value (local variable, field of an addressable struct)

This rule is the same for generics:

```go
type Counter[T ~int] struct{ n T }
func (c *Counter[T]) Inc() { c.n++ }

c := Counter[int]{}
c.Inc()                    // OK — c is addressable
Counter[int]{}.Inc()       // ❌ — composite literal is not addressable
(&Counter[int]{}).Inc()    // OK — explicitly take address
```

For value-receiver methods, no addressability is required.

### Method calls on map elements

Map values are **not addressable**, which surprises people:

```go
m := map[string]Counter[int]{}
m["a"].Inc()  // ❌ — m["a"] is not addressable

// Workarounds:
v := m["a"]
v.Inc()
m["a"] = v
// or store *Counter[int]:
m2 := map[string]*Counter[int]{}
m2["a"].Inc()  // OK
```

This rule has nothing to do with generics, but it bites generic-container designers. **Storing pointers in maps** is the usual fix.

---

## Generic methods and interfaces

A generic type's methods make instantiations satisfy interfaces:

```go
type Stringer interface { String() string }

type Box[T any] struct{ v T }
func (b Box[T]) String() string { return fmt.Sprintf("Box{%v}", b.v) }

var s Stringer = Box[int]{v: 1}    // OK — Box[int] satisfies Stringer
```

### A subtle point — `Box[T]` is not "always" a `Stringer`

Even though every instantiation `Box[int]`, `Box[string]`, etc., satisfies `Stringer`, you cannot say "the generic type satisfies":

```go
var s Stringer = Box  // ❌ — Box is not a type
```

You always need a concrete instantiation. This is the topic of `professional.md`.

### Methods that take/return the same generic type

A method can refer to its own receiver type with type arguments:

```go
type Pair[K, V any] struct{ Key K; Value V }
func (p Pair[K, V]) Swap() Pair[V, K] {  // returns differently parameterised type
    return Pair[V, K]{Key: p.Value, Value: p.Key}
}
```

The return type `Pair[V, K]` is a **new instantiation** — the parameters are reshuffled.

---

## Methods on type aliases (Go 1.24+)

Until Go 1.24, type aliases could not have type parameters and could not host methods. From 1.24:

```go
type IntStack = Stack[int]   // alias, no type parameters

// Cannot define methods on the alias — methods belong to Stack[T]
```

Generic type aliases (with parameters) are also Go 1.24+:

```go
type List[T any] = []T   // 1.24+ only

// Cannot define methods on a generic alias either
```

The rule remains: **methods belong to the underlying type definition**, not the alias. Pre-1.24 you cannot even spell `type IntStack = Stack[int]` as a generic alias — only as a non-generic alias.

---

## Summary

Methods on generic types are governed by a small set of strict rules:

1. **Method sets exist only after instantiation.** `Stack[int]` has a method set; `Stack` alone does not.
2. **Constraints are declared once on the type.** Methods inherit them and cannot tighten or loosen.
3. **Method-level type parameters are forbidden.** Workaround: free functions.
4. **Receiver arity must match the type's** — same number of parameters.
5. **You cannot specialise a method** for a specific instantiation.
6. **The classic value/pointer/addressability rules** still apply — generics don't change them.
7. **Generic types satisfy interfaces** only after instantiation; the interface check happens per concrete type.

Internalising these rules makes the rest of generic-method design (embedding, interface satisfaction, performance) much more predictable. The next file (`senior.md`) covers embedding, method promotion, and method values.
