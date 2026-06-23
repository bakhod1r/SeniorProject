# Methods on Generic Types — Find the Bug

## How to use

Each problem shows a code snippet. Read it carefully and answer:
1. What is the bug?
2. How would you fix it?
3. What rule about generic-type methods does this illustrate?

Solutions are at the end. The bugs are realistic — they map to the most common mistakes Go developers make when first writing methods on generic types.

---

## Bug 1 — Forgot type parameters on receiver

```go
type Box[T any] struct{ v T }

func (b Box) Get() T { return b.v }
```

**Hint:** What does the receiver need when the type is generic?

---

## Bug 2 — Wrong receiver arity

```go
type Pair[K, V any] struct{ Key K; Value V }

func (p Pair[K]) Swap() Pair[V, K] {
    return Pair[V, K]{Key: p.Value, Value: p.Key}
}
```

**Hint:** Count the type parameters.

---

## Bug 3 — Method-level type parameter

```go
type Box[T any] struct{ v T }

func (b Box[T]) Map[U any](f func(T) U) Box[U] {
    return Box[U]{v: f(b.v)}
}
```

**Hint:** Methods cannot do something here that free functions can.

---

## Bug 4 — Tightening constraint on a method

```go
type Bag[T any] struct{ items []T }

func (b Bag[T comparable]) Distinct() []T {
    seen := map[T]struct{}{}
    out := make([]T, 0)
    for _, v := range b.items {
        if _, ok := seen[v]; !ok {
            seen[v] = struct{}{}
            out = append(out, v)
        }
    }
    return out
}
```

**Hint:** Where do constraints live?

---

## Bug 5 — Specialising on a concrete type

```go
type Stack[T any] struct{ data []T }

func (s *Stack[int]) SumInts() int {
    total := 0
    for _, v := range s.data { total += v }
    return total
}
```

**Hint:** Can you write a method only for one instantiation?

---

## Bug 6 — Value receiver mutating a slice

```go
type Stack[T any] struct{ data []T }

func (s Stack[T]) Push(v T) {
    s.data = append(s.data, v)
}

func main() {
    s := Stack[int]{}
    s.Push(1); s.Push(2); s.Push(3)
    fmt.Println(s.data)   // []
}
```

**Hint:** What does a value receiver do?

---

## Bug 7 — Calling pointer method on map element

```go
type Counter[T ~int] struct{ n T }
func (c *Counter[T]) Inc() { c.n++ }

func main() {
    m := map[string]Counter[int]{}
    m["a"] = Counter[int]{}
    m["a"].Inc()  // ❌
}
```

**Hint:** Map values are not what?

---

## Bug 8 — Receiver renamed but used wrong

```go
type Pair[K, V any] struct{ Key K; Value V }

func (p Pair[A, B]) Swap() Pair[K, V] {
    return Pair[K, V]{Key: p.Value, Value: p.Key}
}
```

**Hint:** What names are in scope inside the method body?

---

## Bug 9 — Generic type used without instantiation

```go
type Stack[T any] struct{ data []T }

func main() {
    var s *Stack
    s.Push(1)
}
```

**Hint:** Generic types are templates.

---

## Bug 10 — Mixing pointer and value receivers, then calling pointer method on value

```go
type Box[T any] struct{ v T }

func (b *Box[T]) Set(v T) { b.v = v }
func (b Box[T]) Get() T   { return b.v }

func main() {
    Box[int]{}.Set(7)     // ❌
}
```

**Hint:** Composite literals are not addressable.

---

## Bug 11 — Ambiguous embedded methods

```go
type A[T any] struct{}
func (A[T]) Print() { fmt.Println("A") }

type B[T any] struct{}
func (B[T]) Print() { fmt.Println("B") }

type C[T any] struct {
    A[T]
    B[T]
}

func main() {
    C[int]{}.Print()
}
```

**Hint:** What if both embedded types have the same method?

---

## Bug 12 — Promoting from a generic embed with constraint mismatch

```go
type Comp[T comparable] struct{ v T }
func (c Comp[T]) Eq(other Comp[T]) bool { return c.v == other.v }

type Outer[T any] struct {
    Comp[T]
}
```

**Hint:** Outer says `any`; inner says `comparable`.

---

## Bug 13 — Method value with escaping receiver

```go
func makePush() func(int) {
    s := &Stack[int]{}
    return s.Push
}

func main() {
    push := makePush()
    push(1); push(2)
    // expected to see 1, 2 in some Stack — but where?
}
```

**Hint:** The bug is conceptual: where did `s` go?

---

## Bug 14 — Wrong method expression syntax

```go
type Stack[T any] struct{ data []T }
func (s *Stack[T]) Push(v T) { s.data = append(s.data, v) }

func main() {
    push := (*Stack).Push   // ❌
    s := &Stack[int]{}
    push(s, 1)
}
```

**Hint:** The compiler cannot infer the instantiation.

---

## Bug 15 — Returning the wrong instantiation

```go
type Pair[K, V any] struct{ Key K; Value V }

func (p Pair[K, V]) Swap() Pair[K, V] {  // ❌ same instantiation
    return Pair[K, V]{Key: p.Value, Value: p.Key}
}
```

**Hint:** Look at the field types vs the return type.

---

## Bug 16 — Method on un-instantiated generic alias

```go
type Stack[T any] struct{ data []T }
type IntStack = Stack[int]

func (s *IntStack) Top() (int, bool) {
    if len(s.data) == 0 { return 0, false }
    return s.data[len(s.data)-1], true
}
```

**Hint:** Where do methods belong?

---

## Solutions

### Bug 1 — fix
The receiver must include `[T]`:
```go
func (b Box[T]) Get() T { return b.v }
```
**Rule:** receivers on generic types must list the type parameters.

### Bug 2 — fix
The arity must match the type's:
```go
func (p Pair[K, V]) Swap() Pair[V, K] { ... }
```
**Rule:** receiver type parameter list count must equal the type's.

### Bug 3 — fix
Make `Map` a free function:
```go
func Map[T, U any](b Box[T], f func(T) U) Box[U] {
    return Box[U]{v: f(b.v)}
}
```
**Rule:** methods cannot declare their own type parameters.

### Bug 4 — fix
Move the constraint to the type or use a wrapper:
```go
type Bag[T comparable] struct{ items []T }
func (b Bag[T]) Distinct() []T { ... }

// or
type Bag[T any] struct{ items []T }
func Distinct[T comparable](b *Bag[T]) []T { ... }
```
**Rule:** constraints live on the type, not on individual methods.

### Bug 5 — fix
Use a free function:
```go
func SumInts(s *Stack[int]) int {
    total := 0
    for _, v := range s.data { total += v }
    return total
}
```
**Rule:** methods cannot specialise on a concrete instantiation.

### Bug 6 — fix
Use a pointer receiver:
```go
func (s *Stack[T]) Push(v T) { s.data = append(s.data, v) }
```
**Rule:** mutating methods need pointer receivers — same as classic Go.

### Bug 7 — fix
Store pointers in the map, or pull out and put back:
```go
m := map[string]*Counter[int]{}
m["a"] = &Counter[int]{}
m["a"].Inc()                   // OK

// or
v := m["a"]
v.Inc()
m["a"] = v
```
**Rule:** map values are not addressable, so pointer-receiver methods fail.

### Bug 8 — fix
Use the receiver-local names inside the body and return type:
```go
func (p Pair[A, B]) Swap() Pair[B, A] {
    return Pair[B, A]{Key: p.Value, Value: p.Key}
}
```
**Rule:** the receiver may rename parameters, but the method body sees only those names.

### Bug 9 — fix
Instantiate the type:
```go
var s *Stack[int]
s = &Stack[int]{}
s.Push(1)
```
**Rule:** generic types must be instantiated before use.

### Bug 10 — fix
Use a pointer:
```go
b := &Box[int]{}
b.Set(7)
```
**Rule:** pointer-receiver methods need an addressable value or an explicit pointer.

### Bug 11 — fix
Add an explicit method on `C` or call qualified:
```go
func (c C[T]) Print() { c.A.Print(); c.B.Print() }
// or
c := C[int]{}
c.A.Print()
c.B.Print()
```
**Rule:** ambiguous promoted methods are not promoted; resolve explicitly.

### Bug 12 — fix
Tighten `Outer`'s constraint:
```go
type Outer[T comparable] struct {
    Comp[T]
}
```
**Rule:** embedding a constrained type imposes the constraint on the outer.

### Bug 13 — fix
There is no bug per se, but `s` escapes to the heap because the method value captures it. If `push` is short-lived, the GC reclaims `s` once `push` is no longer reachable. The conceptual point: **method values keep the receiver alive**.
```go
// Aware fix: avoid creating method values in hot paths
func makePush() func(int) {
    s := &Stack[int]{}
    return func(v int) { s.Push(v) }   // explicit closure makes intent clear
}
```
**Rule:** method values cause the receiver to escape.

### Bug 14 — fix
The method expression must include the instantiation:
```go
push := (*Stack[int]).Push
```
**Rule:** method expressions on generic types require explicit type arguments.

### Bug 15 — fix
The return type must reorder the parameters:
```go
func (p Pair[K, V]) Swap() Pair[V, K] {
    return Pair[V, K]{Key: p.Value, Value: p.Key}
}
```
**Rule:** the return type can be a different instantiation; pay attention to the order.

### Bug 16 — fix
Define methods on the original type:
```go
func (s *Stack[T]) Top() (T, bool) {
    var zero T
    if len(s.data) == 0 { return zero, false }
    return s.data[len(s.data)-1], true
}
```
**Rule:** methods belong to the underlying type, not aliases.

---

## Lessons

Patterns from these bugs:

1. **The receiver must repeat `[T]`** (Bugs 1, 2). The arity matters.
2. **Methods cannot have their own type parameters** (Bug 3). Free functions fill the gap.
3. **Constraints live on the type, not on methods** (Bugs 4, 12).
4. **You cannot specialise** a method for a concrete instantiation (Bug 5).
5. **Pointer vs value receivers** still matters for mutation and addressability (Bugs 6, 7, 10).
6. **Receiver-local parameter names** shadow the type's; use them in the body (Bug 8).
7. **Generic types must be instantiated** before use (Bug 9).
8. **Promoted methods can be ambiguous** when both embedded types share a name (Bug 11).
9. **Method values capture the receiver** — be aware of escape (Bug 13).
10. **Method expressions need explicit instantiation** (Bug 14).
11. **Return type instantiation matters** — `Pair[V, K]` vs `Pair[K, V]` (Bug 15).
12. **Methods belong to the original type**, not aliases (Bug 16).

A senior engineer treats the receiver list as a contract: the arity, names, and order are all load-bearing. Mistakes here become compile errors quickly — a benefit of generics' compile-time discipline.
