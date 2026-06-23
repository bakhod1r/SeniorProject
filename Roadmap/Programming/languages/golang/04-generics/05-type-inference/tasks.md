# Type Inference — Exercises

Twenty-plus exercises arranged easy → hard. Each task has a prompt, the relevant snippet, and a sample solution at the end. Try them without peeking.

---

## Easy

### Task 1 — Predict the inferred type
```go
func F[T any](x T) T { return x }

F(42)
F(3.14)
F("hello")
F(true)
```
**Goal.** Write down `T` for each call.

---

### Task 2 — Why does this fail?
```go
func F[T any]() T { var z T; return z }
v := F()
```
**Goal.** Explain. Then make it compile in two different ways.

---

### Task 3 — Equal of mixed types
```go
func Equal[T comparable](a, b T) bool { return a == b }

Equal(1, 2)
Equal(1, "x")
```
**Goal.** Which call fails? Why?

---

### Task 4 — Default type drill
For each, write the inferred type:
```go
F(1)        // ?
F(1.0)      // ?
F('a')      // ?
F("hi")     // ?
F(true)     // ?
F(0i)       // ?
```
Where `func F[T any](x T) T { return x }`.

---

### Task 5 — Slice + element pattern
```go
func First[S ~[]E, E any](s S) E { return s[0] }

type IDs []int
First(IDs{1, 2, 3})
```
**Goal.** What are `S` and `E`? Why does this work despite `IDs` being a named type?

---

## Medium

### Task 6 — Reduce with literal
```go
func Reduce[T, U any](s []T, init U, f func(U, T) U) U {
    acc := init
    for _, v := range s { acc = f(acc, v) }
    return acc
}

events := []Event{ /* ... */ }
sum := Reduce(events, 0, count)
```
**Goal.** What is the inferred `U`? If you wanted `int64`, what would you change?

---

### Task 7 — Map with strconv.Itoa
```go
func Map[T, U any](s []T, f func(T) U) []U { /* ... */ }

nums := []int{1, 2, 3}
strs := Map(nums, strconv.Itoa)
```
**Goal.** What versions of Go can compile this? What if we use `fmt.Sprint` instead?

---

### Task 8 — Fix this Map call
```go
strs := Map([]int{1,2,3}, fmt.Sprint)
```
**Goal.** Make it compile without changing the underlying behaviour (still returns `[]string`).

---

### Task 9 — Generic function value
```go
var f = Map
nums := []int{1, 2, 3}
strs := f(nums, strconv.Itoa)
```
**Goal.** Why does this fail to compile? Make it compile.

---

### Task 10 — Untyped constant interaction
```go
func Add[T int | float64](a, b T) T { return a + b }

Add(1, 2)
Add(1, 2.0)
Add(int64(1), 2)
```
**Goal.** Predict each call's outcome. Which one fails to compile?

---

### Task 11 — Cast with partial inference
```go
func Cast[Out, In any](x In) Out { return any(x).(Out) }

Cast[float64](42)
```
**Goal.** What is the inferred `In`? Why does this work despite `Out` being explicit?

---

### Task 12 — Find the inference failure
```go
func F[T any](x *T) {}
F(nil)
```
**Goal.** Why does this fail? Make it compile two ways.

---

### Task 13 — Constraint inference unblocks FTAI
```go
type Number interface { ~int | ~float64 }

func Sum[S ~[]E, E Number](s S) E {
    var total E
    for _, v := range s { total += v }
    return total
}

xs := []int{1, 2, 3}
Sum(xs)
```
**Goal.** Trace the inference: which step binds `S`? Which binds `E`?

---

### Task 14 — Variadic with no args
```go
func Sum[T int | float64](xs ...T) T { /* ... */ }
Sum()
Sum(1, 2, 3)
Sum(1.0, 2.0)
```
**Goal.** Predict each. Make the failing one compile.

---

### Task 15 — Method value
```go
type Greeter struct{}
func (g Greeter) Greet(name string) string { return "Hi " + name }

func Apply[T, U any](x T, f func(T) U) U { return f(x) }

g := Greeter{}
Apply("Anna", g.Greet)
```
**Goal.** What are `T` and `U`? Why does inference work on a method value?

---

## Hard

### Task 16 — Refactor for inference
Original:
```go
type Cache struct{}
func Get[V any](c *Cache, k string) V { /* ... */ }
u := Get[*User](cache, "u-1")
```
**Goal.** Refactor so callers do not need explicit `[*User]` on every call. Test your design with two different value types.

---

### Task 17 — Design from scratch
**Goal.** Design a generic `Result[T]` type with `Ok` and `Err` constructors. Write it so:
- `Ok(42)` infers `T = int`.
- `Err[int](errors.New("bad"))` accepts an explicit type parameter.
- Methods like `(r Result[T]) Unwrap() T` need no explicit instantiation.

---

### Task 18 — Predict and explain
```go
func Pair[A, B any](a A, b B) (A, B) { return a, b }

a, b := Pair(1, 2.0)
c, d := Pair(int32(1), 2)
e, f := Pair("hi", []byte{1, 2, 3})
```
**Goal.** For each, write `A` and `B` exactly.

---

### Task 19 — Constraint set without core type
```go
type Mixed interface { ~int | ~string }
func F[T Mixed](x T) T { return x }

F(1)
F("hi")
F(true)
```
**Goal.** Which compile? Why does inference work even though `Mixed` has no core type?

---

### Task 20 — Builder for inference
**Goal.** Write a `Stream[T]` that supports `Filter` and a free-standing `MapStream[T, U]` so this is fully inferred:
```go
out := MapStream(From([]Order{...}).Filter(isShipped), totalOf)
```
Where `From[T any](xs []T) *Stream[T]` and `func (s *Stream[T]) Filter(p func(T) bool) *Stream[T]`.

---

### Task 21 — Diagnose and fix
You ship a library. A user reports:
```go
total := pkg.Sum(prices)
// error: cannot infer E
```
where `prices` is `type Prices []float64` and:
```go
func Sum[E Number](s []E) E { /* ... */ }
```
**Goal.** Diagnose. Fix the library so the user's call compiles.

---

### Task 22 — Inference contract test
**Goal.** Write a test (compile-only) that locks the inference shape of `Sum`:
```go
func ExampleSum() {
    fmt.Println(pkg.Sum([]int{1, 2, 3}))
    // Output: 6
}
```
Then make a deliberate change to `Sum`'s constraint that *breaks* inference. Show that the example fails to build.

---

### Task 23 — Design a typed cache
**Goal.** Design `Cache[K comparable, V any]` such that:
- `c := New[string, *User]()` is the only place type arguments appear.
- `c.Get("k")`, `c.Set("k", u)`, `c.Delete("k")` all infer their types via the receiver.
- `c.Items()` returns `iter.Seq2[K, V]` (Go 1.23+) with full inference at the for-range call site.

---

### Task 24 — Migration drill
You inherit a 1.18 codebase with calls like:
```go
out := Map[Order, Receipt](orders, formatReceipt)
```
**Goal.** Bump the module to 1.21. Identify which type-argument lists can be removed. Run `gofmt` and `staticcheck`. Commit only the safe removals.

---

### Task 25 — Edge case — comparable through generics
```go
func Set[K comparable](xs []K) map[K]struct{} {
    out := make(map[K]struct{}, len(xs))
    for _, x := range xs { out[x] = struct{}{} }
    return out
}

Set([]int{1, 2, 3})
Set([]any{1, "x", true})
Set([][]int{{1}, {2}})
```
**Goal.** Which calls compile? Explain each.

---

## Solutions

### S1
- `int`, `float64`, `string`, `bool`.

### S2
- Fails because `T` is only in the return type. Fix: `F[int]()` or pass a sentinel: `func F[T any](_ T) T { var z T; return z }; F(0)`.

### S3
- `Equal(1, "x")` fails — `T` cannot be both `int` and `string`.

### S4
- `int`, `float64`, `int32` (rune), `string`, `bool`, `complex128`.

### S5
- `S = IDs`, `E = int`. `~[]E` accepts named slice types whose underlying is `[]int`.

### S6
- `T = Event`, `U = int`. To get `int64` use `Reduce[Event, int64](events, 0, count)` or pass `int64(0)`.

### S7
- 1.21+ for `strconv.Itoa`. `fmt.Sprint` always fails because of `...any` shape.

### S8
- `Map([]int{1,2,3}, func(x int) string { return fmt.Sprint(x) })`.

### S9
- `Map` is generic; cannot be assigned without instantiation. Fix: `var f = Map[int, string]`.

### S10
- `Add(1, 2)` → `T = int`. `Add(1, 2.0)` → `T = float64`. `Add(int64(1), 2)` → fails because `int64` is not in the type set.

### S11
- `In = int` (from the argument `42`). `Out` is explicit.

### S12
- `nil` carries no type. Fix: `F[int](nil)` or `var p *int; F(p)`.

### S13
- FTAI binds `S = []int` from `xs`. Constraint inference uses `~[]E` to derive `E = int`.

### S14
- `Sum()` fails. `Sum(1,2,3)` → `T = int`. `Sum(1.0, 2.0)` → `T = float64`. Fix: `Sum[int]()`.

### S15
- `T = string`, `U = string`. Method values are first-class function values with a fixed signature, so unification works.

### S16
- Move `V` to the cache type.
```go
type Cache[V any] struct{}
func New[V any]() *Cache[V] { return &Cache[V]{} }
func (c *Cache[V]) Get(k string) V { /* ... */ }
users := New[*User]()
u := users.Get("u-1")
```

### S17 (sketch)
```go
type Result[T any] struct { v T; err error }
func Ok[T any](v T) Result[T]    { return Result[T]{v: v} }
func Err[T any](e error) Result[T] { return Result[T]{err: e} }
func (r Result[T]) Unwrap() T    { return r.v }

Ok(42)                         // T = int
Err[int](errors.New("bad"))    // explicit T
```

### S18
- `(int, float64)`, `(int32, int)`, `(string, []byte)`.

### S19
- `F(1)` and `F("hi")` compile. `F(true)` fails. Inference works via FTAI directly — constraint type inference is not needed; the type set is only used for *constraint satisfaction*.

### S20 (sketch)
```go
type Stream[T any] struct { xs []T }
func From[T any](xs []T) *Stream[T] { return &Stream[T]{xs} }
func (s *Stream[T]) Filter(p func(T) bool) *Stream[T] {
    out := s.xs[:0:0]
    for _, x := range s.xs { if p(x) { out = append(out, x) } }
    return &Stream[T]{out}
}
func MapStream[T, U any](s *Stream[T], f func(T) U) *Stream[U] {
    out := make([]U, 0, len(s.xs))
    for _, x := range s.xs { out = append(out, f(x)) }
    return &Stream[U]{out}
}
```

### S21
- Library uses `[]E`, but `Prices` is a named slice. Fix:
```go
func Sum[S ~[]E, E Number](s S) E { /* ... */ }
```
Now `Sum(prices)` infers `S = Prices, E = float64`.

### S22
The `ExampleSum` block above is the test. Break inference by changing the signature to require an explicit accumulator:
```go
func Sum[T any](init T, xs []T) T { /* ... */ }
```
The example fails to build because the call shape no longer matches.

### S23 (sketch)
```go
type Cache[K comparable, V any] struct{ m map[K]V }
func New[K comparable, V any]() *Cache[K, V] { return &Cache[K, V]{m: map[K]V{}} }
func (c *Cache[K, V]) Get(k K) (V, bool) { v, ok := c.m[k]; return v, ok }
func (c *Cache[K, V]) Set(k K, v V)      { c.m[k] = v }
func (c *Cache[K, V]) Delete(k K)        { delete(c.m, k) }
// Items() can be added with iter.Seq2 in Go 1.23+.
```

### S24
- Bump `go.mod` to 1.21.
- Remove brackets from calls where every type parameter is reachable from arguments.
- Keep brackets where the reader benefits from the explicit form (e.g., `Reduce[Event, int64]`).
- `staticcheck` will flag unnecessary type-argument lists.

### S25
- `Set([]int{1,2,3})` OK — `int` is comparable.
- `Set([]any{...})` OK — `any` is comparable since 1.20.
- `Set([][]int{...})` fails — `[]int` is not comparable.

---

## Stretch Goals

- Take any 5 exercises and write a `examples_test.go` that pins their canonical inferred call. Verify with `go test ./...`.
- Convert one exercise's solution into a public package. Document the inferred call in a doc comment. Treat any future signature change as a breaking change.
- Run `go vet` and `staticcheck` on your solutions; address every warning.
