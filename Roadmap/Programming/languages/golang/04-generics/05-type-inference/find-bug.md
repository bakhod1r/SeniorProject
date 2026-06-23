# Type Inference — Find the Bug

Fifteen-plus snippets where type inference subtly fails or gives a surprising result. For each: read the code, hunt the bug, peek at the hint, then check the fix and explanation.

---

## Bug 1 — The vanishing T

```go
package main

import "fmt"

func Build[T any]() T {
    var z T
    return z
}

func main() {
    v := Build()
    fmt.Println(v)
}
```

**Hint.** Where does `T` appear in the signature?

**Fix.**
```go
v := Build[int]()
```
or restructure:
```go
func Build[T any](_ T) T { var z T; return z }
v := Build(0) // T inferred from the sentinel.
```

**Explanation.** `T` only appears in the return type. FTAI has nothing to look at. Inference fails with "cannot infer T".

---

## Bug 2 — fmt.Sprint in Map

```go
func Map[T, U any](s []T, f func(T) U) []U {
    out := make([]U, len(s))
    for i, v := range s { out[i] = f(v) }
    return out
}

nums := []int{1, 2, 3}
strs := Map(nums, fmt.Sprint)
```

**Hint.** What is the actual type of `fmt.Sprint`?

**Fix.**
```go
strs := Map(nums, func(x int) string { return fmt.Sprint(x) })
```

**Explanation.** `fmt.Sprint` is `func(...any) string`. The compiler tries to unify `func(T) U` with `func(...any) string` and fails on arity (variadic vs fixed). Wrapping in a closure with the right signature fixes it.

---

## Bug 3 — Wrong default type

```go
func Reduce[T, U any](s []T, init U, f func(U, T) U) U {
    acc := init
    for _, v := range s { acc = f(acc, v) }
    return acc
}

events := []Event{ /* ... */ }
total := Reduce(events, 0, count)

if total > math.MaxInt32 { /* never true */ }
```

**Hint.** What is the type of `0`?

**Fix.**
```go
total := Reduce(events, int64(0), count)
// or
total := Reduce[Event, int64](events, 0, count)
```

**Explanation.** `0` is an untyped int constant, defaulting to `int`. On 32-bit platforms `int` is `int32`, so the comparison is always false. Pin the accumulator type explicitly.

---

## Bug 4 — Nil with no anchor

```go
func F[T any](p *T) {}

F(nil)
```

**Hint.** What does `nil` tell you about `T`?

**Fix.**
```go
F[int](nil)
// or
var p *int
F(p)
```

**Explanation.** Bare `nil` carries no type information. Inference cannot proceed.

---

## Bug 5 — Conflicting bindings

```go
func Equal[T comparable](a, b T) bool { return a == b }

found := Equal(user.ID, "u-42")
```

**Hint.** What is the type of `user.ID`?

**Fix.**
```go
found := Equal(string(user.ID), "u-42")
// or
found := Equal(user.ID, UserID("u-42"))
```

**Explanation.** If `user.ID` is `UserID` (a defined type) and `"u-42"` defaults to `string`, unification cannot agree on `T`. Convert one side, or define a constructor.

---

## Bug 6 — Named slice type rejected

```go
type IDs []int

func Sum[E int | float64](s []E) E {
    var total E
    for _, v := range s { total += v }
    return total
}

ids := IDs{1, 2, 3}
total := Sum(ids)
```

**Hint.** Is `IDs` the same as `[]int` for inference purposes?

**Fix.**
```go
func Sum[S ~[]E, E int | float64](s S) E { /* ... */ }
```

**Explanation.** Without `~[]E`, only the exact type `[]int` is acceptable, not `IDs`. The fix is to use `~[]E` so named slice types are accepted.

---

## Bug 7 — Missing comparable

```go
func Index[E any](s []E, target E) int {
    for i, v := range s {
        if v == target { return i } // compile error: == on E
    }
    return -1
}
```

**Hint.** What does `E any` permit?

**Fix.**
```go
func Index[E comparable](s []E, target E) int { /* ... */ }
```

**Explanation.** `any` does not allow `==`. Use `comparable`. This is a constraint bug, but it shows up at the inference stage because the compiler cannot proceed past the function body type-check.

---

## Bug 8 — Variadic with no values

```go
func Sum[T int | float64](xs ...T) T {
    var total T
    for _, v := range xs { total += v }
    return total
}

zero := Sum()
```

**Hint.** What does the compiler see in the variadic args?

**Fix.**
```go
zero := Sum[int]()
```

**Explanation.** No arguments means nothing to unify. Provide a type explicitly or pass at least one element.

---

## Bug 9 — Inference defaults to int when you wanted int64

```go
func MakeBuffer[T any](n int) []T {
    return make([]T, n)
}

buf := MakeBuffer(1024)
```

**Hint.** Where is `T` carried by the call?

**Fix.**
```go
buf := MakeBuffer[byte](1024)
```

**Explanation.** `T` is in the return type only. Inference fails. The bug is that the user assumed `T = byte` would magically be picked.

---

## Bug 10 — Method value loses receiver type

```go
type Repo struct{}
func (r *Repo) Get(id string) (User, error) { /* ... */ }

func Apply[T, U any](x T, f func(T) (U, error)) (U, error) { return f(x) }

var r *Repo
u, _ := Apply("u-1", r.Get)
```

**Hint.** This works in 1.21+. What about earlier?

**Fix.** Bump `go.mod` to 1.21+. If you must support 1.18:
```go
u, _ := Apply[string, User]("u-1", r.Get)
```

**Explanation.** Function-shape unification on method values was unreliable before 1.21.

---

## Bug 11 — Constraint without core type

```go
type Pair interface { ~int | ~string }

func Bag[T Pair, S ~[]T](xs S) S { return xs }

xs := []int{1, 2, 3}
out := Bag(xs)
```

**Hint.** Can constraint inference walk through `Pair`?

**Fix.** It actually compiles fine in 1.21+ because FTAI binds `T = int` and `S = []int` directly. But:
```go
func Bag[S ~[]T, T Pair](xs S) S { return xs } // any order is fine.
```

**Explanation.** Constraint inference is not needed when FTAI alone binds everything. The bug is the assumption that order or core types are problems here — they are not.

---

## Bug 12 — Untyped string ambiguity

```go
type Slug string

func Concat[T ~string](a, b T) T { return a + b }

var s Slug = "hi"
out := Concat(s, "world")
```

**Hint.** Is `"world"` representable as `Slug`?

**Fix.** This works in 1.21+; it may fail in older versions.

**Explanation.** Untyped string `"world"` must be representable as `Slug`. The improved 1.21 inference correctly performs the conversion. Older versions sometimes refused.

---

## Bug 13 — Generic function value assigned

```go
var f = Map
strs := f([]int{1, 2}, strconv.Itoa)
```

**Hint.** `Map` is a generic function. Can it be a value?

**Fix.**
```go
var f = Map[int, string]
strs := f([]int{1, 2}, strconv.Itoa)
```

**Explanation.** A generic function must be instantiated before being used as a first-class value.

---

## Bug 14 — Mixed numeric types in inference

```go
func Min[T int | float64](a, b T) T {
    if a < b { return a }
    return b
}

var x int32 = 5
result := Min(x, 10)
```

**Hint.** Is `int32` in the type set?

**Fix.**
```go
result := Min(int(x), 10)
// or expand the constraint
func Min[T int | int32 | float64](a, b T) T { /* ... */ }
```

**Explanation.** `int32` is not a member of `int | float64`. The typed argument forces `T = int32`, which then fails the constraint check.

---

## Bug 15 — Pointer to value not pointer to T

```go
func Set[T any](dst *T, src T) { *dst = src }

var u User
Set(&u, "hi")
```

**Hint.** Two arguments, both involve `T`. What does each say?

**Fix.**
```go
Set(&u, User{ /* ... */ })
```

**Explanation.** From `&u` the compiler infers `T = User`. From `"hi"` it infers `T = string`. Conflict. Inference fails. Make the second argument a `User`.

---

## Bug 16 — Inference of E from any-typed slice

```go
func First[E any](s []E) E { return s[0] }

xs := []any{1, "x", true}
v := First(xs)
fmt.Printf("%T\n", v) // ?
```

**Hint.** What does `E` become?

**Fix.** Compiles, but `v` is `any`. To get `int`:
```go
v := xs[0].(int)
```

**Explanation.** `E = any`. The bug is the assumption that `First` could pick the dynamic type at index 0. It cannot — generics are static.

---

## Bug 17 — Map key type collision

```go
func Invert[K, V comparable](m map[K]V) map[V]K {
    out := make(map[V]K, len(m))
    for k, v := range m { out[v] = k }
    return out
}

byID := map[int][]string{1: {"a"}, 2: {"b"}}
inv := Invert(byID)
```

**Hint.** Is `V` comparable here?

**Fix.** `[]string` is not comparable; pick a different value representation.
```go
flat := map[int]string{1: "a", 2: "b"}
inv := Invert(flat)
```

**Explanation.** Constraint check fails — `[]string` is not `comparable`. The error happens after FTAI, at constraint validation.

---

## Bug 18 — Channel direction mismatch

```go
func Drain[T any](ch <-chan T) []T {
    var out []T
    for v := range ch { out = append(out, v) }
    return out
}

ch := make(chan int)
out := Drain(ch)
```

**Hint.** Does `chan int` match `<-chan T`?

**Fix.** It works — Go converts `chan T` to `<-chan T` implicitly. The "bug" is in the *opposite* direction:
```go
recv := make(<-chan int)
out := Drain(recv) // fine
sender := make(chan<- int)
Drain(sender) // fails: cannot use chan<- as <-chan
```

**Explanation.** Channel direction matters for unification. Send-only cannot be passed as receive-only.

---

## Bug 19 — Reduce reset on each call

```go
func Reduce[T, U any](s []T, init U, f func(U, T) U) U { /* ... */ }

total := Reduce([]int{1, 2, 3}, 0, func(acc, x int) int { return acc + x })
total += Reduce([]int{4, 5, 6}, 0, func(acc, x int) int { return acc + x })
```

**Hint.** This is not strictly an inference bug — but the `0` is.

**Explanation.** Each `0` is `int`. For long-running aggregations across calls you may want `int64`:
```go
var total int64
total += Reduce([]int{1, 2, 3}, int64(0), func(acc int64, x int) int64 { return acc + int64(x) })
```

---

## Bug 20 — Generic builtin assumption

```go
buf := make([]T, 0)
```

**Hint.** Is `make` generic?

**Fix.** Provide a concrete type.
```go
buf := make([]int, 0)
```

**Explanation.** `make` is a builtin, not a generic function. It does not participate in user-level type inference; you must always specify the type.

---

## Self-Check

For each bug above:
- Could you predict the failure without running the code?
- Did you reach for the right fix on the first try?
- Could you write a unit test that pins the correct behaviour?

If yes to all three, you have a working professional understanding of where Go's inference breaks down and how to recover.
