# Methods on Generic Types — Senior Level

## Table of Contents
1. [Embedding generic types](#embedding-generic-types)
2. [Method promotion across generic boundaries](#method-promotion-across-generic-boundaries)
3. [Method expressions and method values](#method-expressions-and-method-values)
4. [Composing constraints across methods](#composing-constraints-across-methods)
5. [Promoted methods and shadowing](#promoted-methods-and-shadowing)
6. [Method ambiguity in multi-embedding](#method-ambiguity-in-multi-embedding)
7. [Summary](#summary)

---

## Embedding generic types

Embedding a generic type in another type requires **fully instantiating** the embedded type's parameters at the embedding site:

```go
type Base[T any] struct {
    items []T
}

func (b *Base[T]) Add(v T) { b.items = append(b.items, v) }

// Concrete embedding — Base specialised to int
type IntStore struct {
    Base[int]
}

s := IntStore{}
s.Add(42)   // promoted method, T resolved to int
```

Or you can **propagate** the parameter:

```go
type Store[T any] struct {
    Base[T]
    name string
}

func (s *Store[T]) Add(v T) { s.Base.Add(v) }   // shadows Base[T].Add
```

Here `Store[T]` itself stays generic; the embedded `Base[T]` reuses the outer parameter.

### What gets promoted

After embedding, the **methods of the embedded instantiation** become promoted on the outer type. A `Store[T]` containing `Base[T]` automatically has `Add(v T)` if it does not declare its own.

The promotion mechanism is identical to non-generic Go — but the parameter substitution happens before promotion.

---

## Method promotion across generic boundaries

When `Store[T]` embeds `Base[T]`, the `T` in `Base.Add(v T)` becomes the `T` of `Store`. This propagation is automatic.

```go
type Logger[T any] struct{ items []T }
func (l *Logger[T]) Log(v T) { l.items = append(l.items, v) }

type Service[T any] struct {
    Logger[T]
    name string
}

func main() {
    s := Service[string]{name: "http"}
    s.Log("started")     // Logger[string].Log promoted
    s.Log("connected")
}
```

The compiler stencils `Logger[string]` once and reuses it for both the standalone and embedded use.

### Mixing instantiated and parameterised embeds

You can mix concrete and parameterised embeds:

```go
type Hybrid[T any] struct {
    Base[int]    // always int
    Logger[T]    // varies with T
}

h := Hybrid[string]{}
h.Add(1)         // from Base[int]
h.Log("hello")   // from Logger[string]
```

Be careful — this can confuse readers. Prefer one consistent pattern.

### Promotion does not propagate constraints

If the inner type has a tighter constraint than the outer, you must respect it at instantiation:

```go
type Comp[T comparable] struct{ v T }
func (c Comp[T]) Eq(other Comp[T]) bool { return c.v == other.v }

type Outer[T any] struct {  // looser
    Comp[T]                  // ❌ T must be comparable here
}
```

The fix: tighten `Outer`'s constraint:

```go
type Outer[T comparable] struct {
    Comp[T]
}
```

The compiler enforces this at the embedding site, not at usage.

---

## Method expressions and method values

A **method value** binds a receiver: `f := s.Push` produces a function value where `s` is captured. A **method expression** binds the type: `f := (*Stack[int]).Push` produces a function that takes the receiver as its first argument.

### Method values on generic types

```go
type Stack[T any] struct{ data []T }
func (s *Stack[T]) Push(v T) { s.data = append(s.data, v) }

s := &Stack[int]{}
push := s.Push           // method value: func(int)
push(1); push(2); push(3)
fmt.Println(s.data)      // [1 2 3]
```

The type parameter is **already resolved** in the method value — `push` is `func(int)`, no `T` left.

### Method expressions on generic types

```go
push := (*Stack[int]).Push   // method expression: func(*Stack[int], int)
s := &Stack[int]{}
push(s, 1); push(s, 2)
fmt.Println(s.data)          // [1 2]
```

You must write the **full instantiation** in a method expression — `(*Stack[int]).Push`, not `(*Stack).Push`.

### Method values capture the receiver

A method value captures the receiver pointer (or value). For pointer receivers, the captured pointer outlives the local scope:

```go
func makePusher() func(int) {
    s := &Stack[int]{}
    return s.Push   // s escapes — captured by the method value
}
```

This is the same as non-generic Go but worth remembering: **method values cause heap allocations** for the receiver. Detail in `optimize.md`.

### Method values on value receivers

```go
type Box[T any] struct{ v T }
func (b Box[T]) Get() T { return b.v }

b := Box[int]{v: 42}
get := b.Get          // method value: func() int (b is COPIED at this moment)
b.v = 100
fmt.Println(get())    // 42 — captured the old b
```

Value receivers copy at the moment the method value is created. Modifying `b` afterwards has no effect.

### Method expressions that compose with generics

You can build generic helpers that take method expressions:

```go
func Apply[R any](f func() R) R { return f() }

b := Box[int]{v: 7}
result := Apply(b.Get)   // T inferred as int → R = int
fmt.Println(result)       // 7
```

This pattern works because `b.Get` is a typed `func() int` — generic functions can accept it normally.

---

## Composing constraints across methods

Sometimes you want different methods to have different constraint requirements while staying on the same type. Go does not support per-method constraints, but you can simulate it with **separate types** that share state.

### Pattern 1 — Wrapper type for tighter constraint

```go
type Bag[T any] struct{ items []T }

func (b *Bag[T]) Add(v T) { b.items = append(b.items, v) }

type ComparableBag[T comparable] struct {
    *Bag[T]  // embed pointer so updates are shared
}

func (b ComparableBag[T]) Distinct() []T {
    seen := make(map[T]struct{})
    out := make([]T, 0, len(b.items))
    for _, v := range b.items {
        if _, ok := seen[v]; !ok {
            seen[v] = struct{}{}
            out = append(out, v)
        }
    }
    return out
}
```

`ComparableBag[T]` requires `T comparable`; its embedded `Bag[T]` does not. Callers who need `Distinct` reach for `ComparableBag`; callers who do not stay with `Bag`.

### Pattern 2 — Free function with a tighter generic signature

```go
func Distinct[T comparable](b *Bag[T]) []T { ... }
```

Loses the method-call syntax but avoids the wrapper type.

### Pattern 3 — Interface for the tighter operations

If the operations follow a structured pattern:

```go
type Equaler[T any] interface {
    Equal(other T) bool
}

func Distinct[T Equaler[T]](b *Bag[T]) []T { ... }
```

Now `T` brings its own equality method instead of relying on `comparable`. Useful when struct equality is too coarse.

---

## Promoted methods and shadowing

When the outer type defines a method with the same name as the embedded type's method, it **shadows** the inner method:

```go
type Inner[T any] struct{ v T }
func (i Inner[T]) String() string { return fmt.Sprintf("Inner(%v)", i.v) }

type Outer[T any] struct{ Inner[T] }
func (o Outer[T]) String() string { return fmt.Sprintf("Outer[%s]", o.Inner.String()) }

o := Outer[int]{Inner: Inner[int]{v: 1}}
fmt.Println(o.String())          // Outer[Inner(1)]
fmt.Println(o.Inner.String())    // Inner(1)
```

The outer's `String` wins on `o.String()`. The inner is still reachable explicitly via `o.Inner.String()`.

### Shadowing across instantiations

Shadowing happens **per instantiation** — each `Outer[T]` instantiates its own `String` based on its own `Inner[T]`.

### Why shadowing matters

In a public API, accidental shadowing is a refactoring hazard. If you rename a method on the embedded type, all promoted-method users break unless the outer also renames. Always document shadowed methods explicitly.

---

## Method ambiguity in multi-embedding

When two embedded types provide a method with the same name, neither is promoted — calling that method on the outer is a compile error:

```go
type A[T any] struct{}
func (A[T]) Name() string { return "A" }

type B[T any] struct{}
func (B[T]) Name() string { return "B" }

type C[T any] struct {
    A[T]
    B[T]
}

c := C[int]{}
fmt.Println(c.Name())  // ❌ ambiguous selector
fmt.Println(c.A.Name()) // OK — explicit
fmt.Println(c.B.Name()) // OK — explicit
```

Resolve by:
1. Adding an explicit `Name` method on `C`
2. Calling the embedded type explicitly (`c.A.Name()`)
3. Renaming one of the inner methods

### Ambiguity is not silent

Generic types do not change the ambiguity rule. The compile error is identical to the non-generic case: `ambiguous selector c.Name`.

### Designing to avoid it

Senior advice: when embedding multiple generic types, audit method names. A common naming clash is `Len`, `Size`, `Reset`, `Close`, `String` — these appear on many container types. If you must embed both, **explicitly forward** the methods you want to expose.

---

## Summary

Senior-level mastery of generic-type methods requires understanding three more layers beyond the basic syntax:

1. **Embedding** brings the inner instantiation's methods into the outer type's method set.
2. **Method values and expressions** work the same as classic Go — but the type parameter is resolved at the moment of binding.
3. **Composing constraints** across methods is impossible directly; use wrapper types or free functions.
4. **Shadowing and ambiguity** rules apply to generic methods too — embedded methods can be hidden or made unreachable by name clashes.

The architectural takeaway: **methods on generic types are powerful but rigid**. The fixed-arity, no-method-parameters rule shapes what abstractions are practical. Embed thoughtfully, document shadowed methods, and reach for free functions when the constraint truly needs to vary.

Move on to `professional.md` for interface satisfaction and API design.
