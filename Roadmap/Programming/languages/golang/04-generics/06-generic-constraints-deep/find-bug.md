# Generic Constraints Deep Dive — Find the Bug

## How to use

Each problem shows a code snippet. Read it carefully and answer:

1. What is the bug?
2. How would you fix it?
3. What constraint principle did the author miss?

Solutions are at the end. Every bug here is realistic — most have been seen in pull requests during real Go-1.18+ adoption.

---

## Bug 1 — Missing tilde

```go
type Number interface { int | float64 }

type Celsius float64

func Sum[T Number](s []T) T {
    var t T
    for _, v := range s { t += v }
    return t
}

var c []Celsius = []Celsius{36.6, 37.0}
_ = Sum(c) // ❌
```

**Hint:** What types are in `Number`'s type set?

---

## Bug 2 — Constraint that is not an interface

```go
type Number int | float64

func Sum[T Number](s []T) T {
    var t T
    for _, v := range s { t += v }
    return t
}
```

**Hint:** Look at the declaration of `Number`.

---

## Bug 3 — Method-only constraint vs runtime interface

```go
type Stringer interface { String() string }

func PrintAll[T Stringer](xs []T) {
    for _, x := range xs { fmt.Println(x.String()) }
}

PrintAll([]any{...}) // ❌
```

**Hint:** Why does `any` not satisfy `Stringer`?

---

## Bug 4 — `comparable` instead of `cmp.Ordered`

```go
import "cmp"

func Min[T comparable](a, b T) T {
    if a < b { return a }
    return b
}
```

**Hint:** What operators does `comparable` authorise?

---

## Bug 5 — Empty type set

```go
type C interface { int; string }

func F[T C](v T) T { return v }
```

**Hint:** What is the intersection of `{int}` and `{string}`?

---

## Bug 6 — Mixing `~int` with bare `int`

```go
type C interface { int | ~float64 }

type Celsius int
type Fahrenheit float64

func F[T C](v T) {}

F(int(1))         // OK
F(Celsius(2))     // ?
F(Fahrenheit(3))  // ?
```

**Hint:** Apply the rule for each term separately.

---

## Bug 7 — `~T` where `T` is an interface

```go
type C interface { ~error }

func F[T C](v T) {}
```

**Hint:** Read the spec rule for `~T`.

---

## Bug 8 — Constraint demands two methods, type has only one

```go
type ReadCloser interface {
    Read(p []byte) (int, error)
    Close() error
}

type FakeReader struct{}
func (FakeReader) Read(p []byte) (int, error) { return 0, nil }

func F[T ReadCloser](r T) {}

F(FakeReader{}) // ❌
```

**Hint:** What is the rule for satisfying a constraint with multiple method elements?

---

## Bug 9 — `range` on a no-core-type constraint

```go
type Slice interface { ~[]int | ~[]string }

func Len[T Slice](s T) int {
    n := 0
    for range s { n++ }
    return n
}
```

**Hint:** The compiler complains about `range`. Why?

---

## Bug 10 — `comparable` panic at runtime

```go
type Bag[T comparable] struct { items []T }

func (b *Bag[T]) Has(v T) bool {
    for _, x := range b.items { if x == v { return true } }
    return false
}

b := Bag[any]{}
b.items = append(b.items, []int{1}, []int{2})
fmt.Println(b.Has([]int{1})) // panic in 1.20+
```

**Hint:** Why does this compile but panic?

---

## Bug 11 — Tightening a public constraint

```go
// v1.0.0
type Numeric interface { ~int | ~float64 }
func Sum[T Numeric](s []T) T { ... }

// v1.1.0 — proposed change
type Numeric interface { ~int }
```

**Hint:** What happens to existing callers using `float64`?

---

## Bug 12 — Constraint declared inline, used many times

```go
func Min[T interface{ ~int | ~float64 | ~string }](a, b T) T { ... }
func Max[T interface{ ~int | ~float64 | ~string }](a, b T) T { ... }
func Sort[T interface{ ~int | ~float64 | ~string }](s []T) { ... }
```

**Hint:** Not a compile error — but smelly. Why?

---

## Bug 13 — Confusing union and intersection

```go
type C interface {
    int | float64
    string
}

func F[T C](v T) {}
```

**Hint:** Read the lines as **and**, the `|` as **or**. What is the type set?

---

## Bug 14 — `comparable` thinks slices satisfy it

```go
type Set[T comparable] struct{ m map[T]struct{} }

func main() {
    s := Set[[]int]{} // ❌
    _ = s
}
```

**Hint:** Are slices comparable?

---

## Bug 15 — Self-bounded constraint mistake

```go
type Less interface {
    LessThan(other Less) bool
}

type Money struct { Amount int }
func (m Money) LessThan(other Less) bool { ... } // odd
```

**Hint:** The signature uses `Less` as a runtime interface. What should it use?

---

## Bug 16 — Forgetting the constraint allows `+`

```go
func Add[T any](a, b T) T {
    return a + b
}
```

**Hint:** Compile error. Why?

---

## Solutions

### Bug 1 — fix
`Number` admits the bare `int` and `float64`, not defined types. Add `~`:
```go
type Number interface { ~int | ~float64 }
```
Now `Celsius` (with underlying `float64`) is in the type set.

### Bug 2 — fix
A constraint must be an **interface**:
```go
type Number interface { int | float64 }
```
The type elements live inside an `interface{ ... }` body, not at top level.

### Bug 3 — fix
A type satisfies `Stringer` only if it has the `String() string` method. `any` does not. The fix depends on intent:
```go
// If you have concrete Stringer types:
type Person struct { Name string }
func (p Person) String() string { return p.Name }
PrintAll([]Person{...})

// Or if you must accept arbitrary values, use a different design.
```

### Bug 4 — fix
`comparable` allows `==` and `!=` only. Use `cmp.Ordered`:
```go
import "cmp"

func Min[T cmp.Ordered](a, b T) T {
    if a < b { return a }
    return b
}
```

### Bug 5 — fix
The intersection of `{int}` and `{string}` is empty. The constraint compiles, but `F` cannot be instantiated. Either use union or remove the contradiction:
```go
type C interface { int | string } // union
```

### Bug 6 — explanation and fix
- `int(1)` matches the **bare** `int` term: OK.
- `Celsius(2)` does **not** match `int` (no tilde) and does not match `~float64` (wrong underlying): compile error.
- `Fahrenheit(3)` matches `~float64`: OK.

If the intent was "any defined int or float type", use `~int | ~float64`.

### Bug 7 — fix
The spec forbids `~T` where `T` is an interface. Use a non-interface type:
```go
type C interface { ~int }
```
Or, if you need an interface, drop the tilde:
```go
type C interface { error }
```

### Bug 8 — fix
A constraint with multiple method elements is satisfied only when **all** methods are present. `FakeReader` has `Read` but not `Close`. Either implement `Close`, or relax the constraint:
```go
type Reader interface { Read(p []byte) (int, error) }
func F[T Reader](r T) {}
```

### Bug 9 — fix
The constraint has no core type because `[]int` and `[]string` have different underlying types. Parameterise the element:
```go
type Slice[E any] interface { ~[]E }
func Len[T Slice[E], E any](s T) int {
    n := 0
    for range s { n++ }
    return n
}
```

### Bug 10 — fix
Go 1.20+ allows interface types to satisfy `comparable`, but `==` panics if the dynamic type is non-comparable. Either:
- Validate input before storing:
  ```go
  func (b *Bag[T]) Add(v T) {
      _ = v == v // smoke-test comparability; recover if panic
      b.items = append(b.items, v)
  }
  ```
- Document the runtime risk in godoc.
- Use a different design: hash-based sets with a `Hash()` method instead of `==`.

### Bug 11 — fix
Tightening `Numeric` from `~int | ~float64` to `~int` breaks every caller using floats. This must be a **major version bump**, not a minor one. Or keep `Numeric` and add a sibling `Integer`:
```go
type Numeric interface { ~int | ~float64 } // unchanged
type Integer interface { ~int }
```

### Bug 12 — fix
Inline constraints are fine for one-off uses but smelly when repeated. Promote to a named constraint:
```go
type Sortable interface { ~int | ~float64 | ~string }
func Min[T Sortable](a, b T) T { ... }
func Max[T Sortable](a, b T) T { ... }
func Sort[T Sortable](s []T) { ... }
```

### Bug 13 — fix
Multiple lines mean **intersection**. So `C`'s type set is `({int, float64}) ∩ {string}` = empty.

If you meant "int, float64, or string", combine with `|`:
```go
type C interface { int | float64 | string }
```

### Bug 14 — fix
Slices are not comparable. The compiler rejects `Set[[]int]` because `[]int` does not satisfy `comparable`. Either pick a different element type, or use a set design that does not depend on `==`:
```go
type Set[T comparable] struct { m map[T]struct{} }
s := Set[string]{} // OK
```

### Bug 15 — fix
Use a self-bounded constraint:
```go
type Less[T any] interface { LessThan(other T) bool }

type Money struct { Amount int }
func (m Money) LessThan(other Money) bool { return m.Amount < other.Amount }

func Min[T Less[T]](a, b T) T { ... }
```
The "self type" is expressed via the type parameter, not via the runtime interface.

### Bug 16 — fix
`+` is not defined for arbitrary `T`. Add a numeric constraint:
```go
type Numeric interface { ~int | ~float64 }
func Add[T Numeric](a, b T) T { return a + b }
```

---

## Lessons

Patterns from these bugs:

1. **Forgetting `~`** is the most common constraint bug (Bugs 1, 6).
2. **Constraints must be interfaces** (Bug 2).
3. **`~T` requires a non-interface** `T` (Bug 7).
4. **Multiple lines intersect; `|` unions** (Bugs 5, 13).
5. **`comparable` does not include slices** (Bug 14) and may panic at runtime in 1.20+ (Bug 10).
6. **`comparable` is not `cmp.Ordered`** (Bug 4).
7. **No core type → no `range`/`len`** (Bug 9).
8. **Tightening is a breaking change** (Bug 11).
9. **Inline constraints scale badly** (Bug 12).
10. **Self-bounded constraints** are the right way to take "self" parameters (Bug 15).

A senior reader maps each constraint to a **type set** and reads it as set algebra. Mismatches between expected and actual type sets are the entire bug class.
