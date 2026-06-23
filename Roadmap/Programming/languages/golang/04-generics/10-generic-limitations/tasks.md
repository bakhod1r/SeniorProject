# Generic Limitations — Tasks

## Exercise structure

- 🟢 **Easy** — for beginners
- 🟡 **Medium** — middle level
- 🔴 **Hard** — senior level
- 🟣 **Expert** — professional level

A solution for each exercise is provided at the end. Each task asks you to **identify a limit** and write the canonical workaround.

---

## Easy 🟢

### Task 1 — Lift a method to a free function
You wrote:
```go
type Box[T any] struct{ V T }
func (b Box[T]) Map[U any](f func(T) U) Box[U] { return Box[U]{V: f(b.V)} }
```
The compiler refuses. Rewrite as a free function `MapBox`.

### Task 2 — Type-switch via `any`
The body
```go
func Describe[T any](v T) string {
    switch v.(type) { case int: return "int"; case string: return "str" }
    return "?"
}
```
fails. Make it compile.

### Task 3 — Convert `[]Cat` to `[]Animal`
Given:
```go
type Animal interface{ Name() string }
type Cat struct{}
func (Cat) Name() string { return "cat" }
cats := []Cat{{}, {}}
```
Produce a `[]Animal` from `cats`.

### Task 4 — `len` on a generic
```go
func Length[T any](v T) int { return len(v) }
```
Why does this fail? Add a constraint that makes it compile.

### Task 5 — `make` on a generic
```go
func Empty[T any]() T { return make(T) }
```
Why does this fail? Rewrite to allocate an empty slice for any element type `E`.

---

## Medium 🟡

### Task 6 — Polymorphism in disguise
Refactor the following to an interface, removing the runtime type-switch:
```go
func Run[T any](v T) {
    switch x := any(v).(type) {
    case *Order:  x.Process()
    case *Refund: x.Process()
    }
}
```

### Task 7 — Free `Filter` over a `Stack[T]`
Given `type Stack[T any] struct{ data []T }`, write a free function `FilterStack[T any](s *Stack[T], keep func(T) bool) *Stack[T]`.

### Task 8 — `MapPair`
Given `type Pair[A, B any] struct{ First A; Second B }`, write a free `MapPair[A, B, C, D any](p Pair[A, B], f func(A) C, g func(B) D) Pair[C, D]`.

### Task 9 — Generic `Coalesce` without specialization
The hot path is `int`. Write `Coalesce[T comparable]` for the generic case AND `CoalesceInt` for the specialized hot type. Discuss why you cannot have one body that auto-specializes.

### Task 10 — Stack of pointers vs values
Why is `Stack[*int]` a different type from `Stack[int]`? Demonstrate with a compile error and explain.

### Task 11 — Interface with method type parameter
```go
type Mapper interface { Map[U any](f func(int) U) Mapper }
```
Why does this fail? Provide a free-function alternative.

### Task 12 — Constraint with `~`
Write a constraint `Number` allowing `int`, `float64`, and any defined type whose underlying type is `int` or `float64`. Then write `Sum[T Number](s []T) T`.

### Task 13 — Slice constraint
Write `func Reverse[E any, S ~[]E](s S) S` that reverses a slice of any underlying-slice type. Why does the constraint need both `E` and `S`?

### Task 14 — Type-switch at the boundary
Write a logging function `Log[T any](v T)` that handles `string` specially, falls back to `fmt.Sprintf("%v", v)` for everything else. Discuss the cost of the workaround.

---

## Hard 🔴

### Task 15 — HKT-free `Map` per container
You want a generic `Map` that works on `[]T`, `map[K]V`, and `chan T`. Why can't one signature do it? Provide three free functions.

### Task 16 — Generic-type-alias workaround pre-1.24
Pretend you are on Go 1.22. You want `type Vec[T any] = []T`. The compiler refuses. Provide the type-definition workaround and discuss the differences in identity and method set.

### Task 17 — Free `Reduce` over a generic type
Given `type Tree[T any] struct{ ... }`, write a free `ReduceTree[T, R any](t *Tree[T], init R, f func(R, T) R) R`. Explain why this cannot be a method.

### Task 18 — Polymorphism vs parameterism diagnostic
Given:
```go
func Handle[T any](v T) error {
    switch x := any(v).(type) {
    case *Email: return x.Send()
    case *SMS: return x.Send()
    }
    return errors.New("unknown")
}
```
Diagnose what limit is being misused and refactor to the correct shape.

### Task 19 — Specialization without language support
You have `Hash[T any](v T) uint64` and want `int` to take a fast path. Write the hot-path branch using `any(v).(type)` and benchmark vs a hand-specialized `HashInt`. Discuss when the branch overhead beats the speedup.

---

## Expert 🟣

### Task 20 — Layered library with reflection cache
Design a `Decode[T any](data []byte) (T, error)` that uses cached reflection internally. Show how the public API stays clean while the internal layer hides the reflection cost.

### Task 21 — Interface embedding with type-parameter clash
Given `type Container[T any] struct{ Inner Box[T] }`, write methods on `Container` that delegate to `Box`. Note the verbosity of repeating `[T]` and discuss whether free functions are cleaner.

### Task 22 — Audit a generic API for limits
Take a small generic library (your own or `samber/lo`) and identify three places where a limit shaped the API. Document each with the proposal number or spec reference.

---

## Solutions

### Solution 1
```go
type Box[T any] struct{ V T }
func MapBox[T, U any](b Box[T], f func(T) U) Box[U] {
    return Box[U]{V: f(b.V)}
}
```
The method version is rejected because methods cannot declare new type parameters.

### Solution 2
```go
func Describe[T any](v T) string {
    switch any(v).(type) {
    case int:    return "int"
    case string: return "str"
    }
    return "?"
}
```
A type switch needs an interface operand. `any(v)` produces one.

### Solution 3
```go
animals := make([]Animal, len(cats))
for i, c := range cats { animals[i] = c }
```
Slices are invariant. Element-by-element copy is the canonical workaround.

### Solution 4
`len` is not defined for arbitrary `T`. Add a constraint:
```go
func Length[E any, S ~[]E | ~string](s S) int { return len(s) }
```

### Solution 5
`make(T)` requires T to be a slice/map/chan kind. The compiler cannot guarantee that for `T any`. Rewrite:
```go
func Empty[E any]() []E { return make([]E, 0) }
```

### Solution 6
```go
type Processor interface{ Process() error }

func Run(p Processor) error { return p.Process() }
```
Polymorphism (different behaviour per type) belongs to interfaces, not generics.

### Solution 7
```go
func FilterStack[T any](s *Stack[T], keep func(T) bool) *Stack[T] {
    out := &Stack[T]{}
    for _, v := range s.data { if keep(v) { out.data = append(out.data, v) } }
    return out
}
```

### Solution 8
```go
func MapPair[A, B, C, D any](p Pair[A, B], f func(A) C, g func(B) D) Pair[C, D] {
    return Pair[C, D]{First: f(p.First), Second: g(p.Second)}
}
```

### Solution 9
```go
func Coalesce[T comparable](vals ...T) T {
    var zero T
    for _, v := range vals { if v != zero { return v } }
    return zero
}

func CoalesceInt(vals ...int) int {
    for _, v := range vals { if v != 0 { return v } }
    return 0
}
```
Go has no compile-time specialization. The hand-written `CoalesceInt` may inline more aggressively. PGO may close part of the gap automatically in 1.21+.

### Solution 10
```go
var a Stack[int]
var b Stack[*int]
// b = a // ❌ — different types, even if you want to "promote"
```
Each instantiation is its own type. There is no implicit conversion across element types.

### Solution 11
```go
// Failed:
// type Mapper interface { Map[U any](f func(int) U) Mapper }

// Free function workaround:
type IntSlice []int
func MapMapper[U any](m IntSlice, f func(int) U) []U {
    out := make([]U, len(m))
    for i, v := range m { out[i] = f(v) }
    return out
}
```
Methods on interfaces cannot have type parameters either.

### Solution 12
```go
type Number interface { ~int | ~float64 }

func Sum[T Number](s []T) T {
    var total T
    for _, v := range s { total += v }
    return total
}
```

### Solution 13
```go
func Reverse[E any, S ~[]E](s S) S {
    out := make(S, len(s))
    for i, v := range s { out[len(s)-1-i] = v }
    return out
}
```
The constraint needs `S ~[]E` to preserve the original named slice type in the return; `E` is needed inside to talk about the element type.

### Solution 14
```go
func Log[T any](v T) string {
    switch x := any(v).(type) {
    case string: return "str:" + x
    default:     return fmt.Sprintf("%v", v)
    }
}
```
Cost: each call boxes `v` into `interface{}`. For `string` (already pointer-shaped) the cost is small. For value types it may allocate.

### Solution 15
```go
func MapSlice[T, U any](s []T, f func(T) U) []U { ... }
func MapMap[K comparable, V, U any](m map[K]V, f func(K, V) U) []U { ... }
func MapChan[T, U any](c <-chan T, f func(T) U) <-chan U { ... }
```
HKTs would allow `Map[F[_], T, U]`, but Go does not have them. Per-container free functions are the idiomatic workaround.

### Solution 16
```go
// Pre-1.24: type definition, not alias
type Vec[T any] []T

// Vec[int] is a NEW named type, not the same as []int
var v Vec[int] = Vec[int]{1, 2, 3}
// var s []int = v // would compile (slice conversion is implicit only via copy)
```
On 1.24+ the alias version compiles and is interchangeable with `[]int`.

### Solution 17
```go
type Tree[T any] struct{ /* ... */ }

func ReduceTree[T, R any](t *Tree[T], init R, f func(R, T) R) R {
    /* in-order traversal accumulating init via f */
    return init
}
```
A method `(*Tree[T]).Reduce[R any]` would need a method type parameter, which is forbidden.

### Solution 18
The limit being misused is "type-switch on T". Both `*Email` and `*SMS` have a `Send()` method — that is polymorphism. The right shape is an interface:
```go
type Sender interface{ Send() error }
func Handle(s Sender) error { return s.Send() }
```

### Solution 19
```go
func Hash[T any](v T) uint64 {
    if x, ok := any(v).(int); ok { return uint64(x) * 2654435761 }
    return slowHash(v)
}

func HashInt(v int) uint64 { return uint64(v) * 2654435761 }
```
Benchmark: hand-specialized `HashInt` is fastest. The `Hash[int]` branch adds an `any(v)` boxing and a type-assertion cost. PGO in 1.21+ may collapse this in profiled binaries.

### Solution 20
```go
type meta struct { /* cached field info */ }
var cache sync.Map // map[reflect.Type]*meta

func metaOf(t reflect.Type) *meta {
    if m, ok := cache.Load(t); ok { return m.(*meta) }
    m := buildMeta(t)
    cache.Store(t, m)
    return m
}

func Decode[T any](data []byte) (T, error) {
    var t T
    rv := reflect.ValueOf(&t).Elem()
    m := metaOf(rv.Type())
    if err := decodeWith(rv, m, data); err != nil {
        return t, err
    }
    return t, nil
}
```
The public API is fully typed; the reflection machinery is hidden and amortized via the cache.

### Solution 21
```go
type Container[T any] struct{ Inner Box[T] }

func (c Container[T]) Get() T { return c.Inner.V }
func (c Container[T]) Map(f func(T) T) Container[T] {
    return Container[T]{Inner: Box[T]{V: f(c.Inner.V)}}
}
```
Notice every method must repeat `[T]`. For type-changing transforms, use a free function `MapContainer[T, U any]`. This is cleaner than trying to get a method type parameter.

### Solution 22
Sample audit findings (illustrative):
1. `lo.Map` is a top-level function, not a method on a slice — because methods cannot have new type parameters (proposal 47781).
2. `lo.Reduce` has separate signatures for slice and map — because Go has no HKT.
3. Many helpers take `(item T, index int)` callbacks — because Go has no covariance, the signatures are uniform across call sites.
Each is a direct consequence of a documented limit.

---

## Final notes

These tasks emphasize **recognition**: when you hit a compile error related to generics, the first question is which of the well-known limits you triggered. Once recognized, the workaround is mechanical. The code rarely changes shape much; only the function name moves from a method to a free function, or a type-switch gains an `any(v)` cast.

The deeper lesson is that limits push you toward better designs. Most of the time, fighting the limit produces worse code than accepting the workaround.
