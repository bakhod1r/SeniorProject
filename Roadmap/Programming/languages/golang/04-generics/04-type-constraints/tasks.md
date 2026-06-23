# Type Constraints — Practice Tasks

## Table of Contents
1. [How to Use This File](#how-to-use-this-file)
2. [Easy (1-7)](#easy-1-7)
3. [Medium (8-14)](#medium-8-14)
4. [Hard (15-20)](#hard-15-20)
5. [Solutions](#solutions)

---

## How to Use This File

Each task gives a problem statement, expected behavior, and a hint. Try to solve it yourself before peeking at the solution. The solutions are at the bottom; they are illustrative and not the only valid approach.

---

## Easy (1-7)

### Task 1 — Write `Identity[T any]`

Implement the simplest possible generic. Take any value, return it unchanged.

```go
// Identity returns x unchanged.
func Identity[T any](x T) T
```

Hint: this is one line.

---

### Task 2 — Write `Equal[T comparable]`

Return `true` if the two arguments are equal.

```go
func Equal[T comparable](a, b T) bool
```

Hint: use `==` directly.

---

### Task 3 — Define a constraint for "anything that can be summed"

Build `Summable` so that `Sum[T Summable]([]T) T` works on `int`, `float64`, and `string`. Hint: think about what operator they all share.

---

### Task 4 — Write `Sum` with the constraint from Task 3

```go
func Sum[T Summable](xs []T) T
```

Test with `[]int{1,2,3}` and `[]string{"a","b"}`.

---

### Task 5 — Build a numeric tower

Create three constraints: `Signed`, `Unsigned`, `Integer`, where `Integer = Signed | Unsigned`. Use `~` so newtype wrappers work.

---

### Task 6 — Write `Min[T constraints.Ordered]`

```go
func Min[T constraints.Ordered](xs []T) T
```

Hint: import `golang.org/x/exp/constraints`.

---

### Task 7 — Write `Contains[T comparable]`

```go
func Contains[T comparable](xs []T, target T) bool
```

Test with at least two element types.

---

## Medium (8-14)

### Task 8 — Constraint for ordered iterable types

Define a constraint `OrderedSlice` so that `func F[T ~[]E, E constraints.Ordered](xs T) E` works. The function returns the maximum element.

Hint: this involves **two** type parameters where the second describes the element type.

---

### Task 9 — Constraint for serializable types

Define `Serializable` requiring a method `MarshalJSON() ([]byte, error)`. Then write `Encode[T Serializable](xs []T) ([][]byte, error)` that returns the byte slices.

---

### Task 10 — Compose constraints

Define `Numeric = Integer | Float`. Then define `Calculable = Numeric | Complex`. Finally write `Add[T Calculable](a, b T) T`.

---

### Task 11 — Constraint with both type and method

Define `Loggable` that accepts `~int` types **and** requires a `Log() string` method. Write a function that prints `Log()` for each element.

Hint: define a struct or named type that satisfies both halves.

---

### Task 12 — `Set[T comparable]` with operations

Implement `Set[T]` with `Add`, `Has`, `Remove`, `Union(Set[T]) Set[T]`, `Intersect(Set[T]) Set[T]`. Use `comparable`.

---

### Task 13 — `Map[T, U any]` and `Filter[T any]`

```go
func Map[T, U any](xs []T, f func(T) U) []U
func Filter[T any](xs []T, keep func(T) bool) []T
```

Test with various combinations.

---

### Task 14 — `Reduce[T, U any]`

```go
func Reduce[T, U any](xs []T, init U, f func(U, T) U) U
```

Use it to compute a sum with an `int` accumulator over `[]string` representing numbers (parse inside `f`).

---

## Hard (15-20)

### Task 15 — Build a constraint for "ordered iterables with a length"

Combine `~[]E`, `E constraints.Ordered`, and require methods `Len() int` and `At(int) E`. Write `Median` returning the middle element.

Hint: you may need to generalize beyond just slices — think about `~[]E` vs interfaces.

---

### Task 16 — Type-safe state machine

Define a constraint `State` with method `Transitions() []State`. Write a generic state machine `Machine[S State]` that runs `S.Transitions()` and validates each next state via a user callback.

This task involves a self-referential constraint — explore whether Go allows it.

---

### Task 17 — Generic ring buffer

Implement `RingBuffer[T any]` with `Push(T)`, `Pop() (T, bool)`, and `Len() int`. Constrain `T` only by `any`. Discuss when `comparable` would be appropriate.

---

### Task 18 — Strict-comparable constraint

Build a constraint `StrictHashable` that excludes interface and struct types. Implement `HashSet[T StrictHashable]`. Show that calling with `[]int` works and with `any` does not.

---

### Task 19 — Constraint hierarchy with re-exports

Build a `myproject/constraints` package that re-exports `x/exp/constraints` and adds `Numeric`, `Hashable`, `Stringy`. Show every dependent file uses only `myproject/constraints`.

---

### Task 20 — Build a typed DSL using sealed-marker constraints

Build a query DSL with a `Selectable` constraint enforced via an unexported method. Show that:
1. `Column`, `Aggregate`, `Literal` types satisfy it.
2. A user-defined type from another package cannot satisfy it.

---

## Solutions

### Solution 1
```go
func Identity[T any](x T) T { return x }
```

### Solution 2
```go
func Equal[T comparable](a, b T) bool { return a == b }
```

### Solution 3
```go
type Summable interface {
    ~int | ~int8 | ~int16 | ~int32 | ~int64 |
        ~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64 | ~uintptr |
        ~float32 | ~float64 | ~string
}
```

The trick: every type that supports the `+` operator is in this set. Strings included.

### Solution 4
```go
func Sum[T Summable](xs []T) T {
    var s T
    for _, x := range xs {
        s += x
    }
    return s
}
```

### Solution 5
```go
type Signed interface {
    ~int | ~int8 | ~int16 | ~int32 | ~int64
}

type Unsigned interface {
    ~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64 | ~uintptr
}

type Integer interface { Signed | Unsigned }
```

### Solution 6
```go
import "golang.org/x/exp/constraints"

func Min[T constraints.Ordered](xs []T) T {
    m := xs[0]
    for _, x := range xs[1:] {
        if x < m {
            m = x
        }
    }
    return m
}
```

### Solution 7
```go
func Contains[T comparable](xs []T, target T) bool {
    for _, x := range xs {
        if x == target {
            return true
        }
    }
    return false
}
```

### Solution 8
```go
import "golang.org/x/exp/constraints"

func Max[T ~[]E, E constraints.Ordered](xs T) E {
    m := xs[0]
    for _, x := range xs[1:] {
        if x > m {
            m = x
        }
    }
    return m
}

// Test
type Heights []float64
hs := Heights{1.5, 1.8, 1.65}
fmt.Println(Max(hs))   // 1.8
```

### Solution 9
```go
type Serializable interface {
    MarshalJSON() ([]byte, error)
}

func Encode[T Serializable](xs []T) ([][]byte, error) {
    out := make([][]byte, len(xs))
    for i, x := range xs {
        b, err := x.MarshalJSON()
        if err != nil {
            return nil, err
        }
        out[i] = b
    }
    return out, nil
}
```

### Solution 10
```go
import "golang.org/x/exp/constraints"

type Numeric interface { constraints.Integer | constraints.Float }
type Calculable interface { Numeric | constraints.Complex }

func Add[T Calculable](a, b T) T { return a + b }
```

### Solution 11
```go
type Loggable interface {
    ~int
    Log() string
}

type Score int
func (s Score) Log() string { return fmt.Sprintf("score=%d", s) }

func PrintLogs[T Loggable](xs []T) {
    for _, x := range xs {
        fmt.Println(x.Log())
    }
}

PrintLogs([]Score{10, 20, 30})
```

### Solution 12
```go
type Set[T comparable] map[T]struct{}

func New[T comparable]() Set[T]      { return Set[T]{} }
func (s Set[T]) Add(v T)             { s[v] = struct{}{} }
func (s Set[T]) Has(v T) bool        { _, ok := s[v]; return ok }
func (s Set[T]) Remove(v T)          { delete(s, v) }

func (s Set[T]) Union(o Set[T]) Set[T] {
    out := New[T]()
    for k := range s { out.Add(k) }
    for k := range o { out.Add(k) }
    return out
}

func (s Set[T]) Intersect(o Set[T]) Set[T] {
    out := New[T]()
    for k := range s {
        if o.Has(k) { out.Add(k) }
    }
    return out
}
```

### Solution 13
```go
func Map[T, U any](xs []T, f func(T) U) []U {
    out := make([]U, len(xs))
    for i, x := range xs {
        out[i] = f(x)
    }
    return out
}

func Filter[T any](xs []T, keep func(T) bool) []T {
    out := make([]T, 0, len(xs))
    for _, x := range xs {
        if keep(x) {
            out = append(out, x)
        }
    }
    return out
}
```

### Solution 14
```go
func Reduce[T, U any](xs []T, init U, f func(U, T) U) U {
    acc := init
    for _, x := range xs {
        acc = f(acc, x)
    }
    return acc
}

// Example
total := Reduce([]string{"1", "2", "3"}, 0, func(acc int, s string) int {
    n, _ := strconv.Atoi(s)
    return acc + n
})
fmt.Println(total)   // 6
```

### Solution 15
```go
import "golang.org/x/exp/constraints"

type Lengthed[E constraints.Ordered] interface {
    Len() int
    At(int) E
}

func Median[T Lengthed[E], E constraints.Ordered](xs T) E {
    n := xs.Len()
    return xs.At(n / 2)
}

// Note: this is the "interface plus type parameter" pattern.
// Pure-slice version:
func MedianSlice[T ~[]E, E constraints.Ordered](xs T) E {
    return xs[len(xs)/2]
}
```

### Solution 16
Self-referential constraints are not allowed in Go. The closest you can get:

```go
type Transitioner[S any] interface {
    Transitions() []S
}

type Machine[S Transitioner[S]] struct {
    state S
}
```

The trick: `S` itself satisfies `Transitioner[S]`. This is the "F-bounded polymorphism" pattern in Go.

### Solution 17
```go
type RingBuffer[T any] struct {
    buf  []T
    head int
    size int
}

func NewRing[T any](capacity int) *RingBuffer[T] {
    return &RingBuffer[T]{buf: make([]T, capacity)}
}

func (r *RingBuffer[T]) Push(v T) {
    if r.size == len(r.buf) {
        r.buf[r.head] = v
        r.head = (r.head + 1) % len(r.buf)
    } else {
        r.buf[(r.head+r.size)%len(r.buf)] = v
        r.size++
    }
}

func (r *RingBuffer[T]) Pop() (T, bool) {
    var zero T
    if r.size == 0 {
        return zero, false
    }
    v := r.buf[r.head]
    r.head = (r.head + 1) % len(r.buf)
    r.size--
    return v, true
}

func (r *RingBuffer[T]) Len() int { return r.size }
```

`comparable` would be needed if you wanted to support `Contains(T)` — to use `==` on elements.

### Solution 18
```go
type StrictHashable interface {
    ~int | ~int8 | ~int16 | ~int32 | ~int64 |
        ~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64 | ~uintptr |
        ~float32 | ~float64 | ~string | ~bool
}

type HashSet[T StrictHashable] map[T]struct{}

// Compiles:
var s = HashSet[int]{}

// Does NOT compile:
// var s = HashSet[any]{}   // any is not in the StrictHashable type set
```

### Solution 19
```go
// myproject/constraints/constraints.go
package constraints

import xc "golang.org/x/exp/constraints"

type (
    Integer  = xc.Integer
    Float    = xc.Float
    Ordered  = xc.Ordered
    Signed   = xc.Signed
    Unsigned = xc.Unsigned
    Complex  = xc.Complex
)

type Numeric interface { Integer | Float }
type Hashable interface { Integer | Float | ~string | ~bool }
type Stringy interface { ~string | ~[]byte }
```

Every other package in `myproject` imports `myproject/constraints` only.

### Solution 20
```go
package query

type Selectable interface {
    isSelectable()   // unexported method — sealed
}

type Column struct{ Name string }
func (Column) isSelectable() {}

type Aggregate struct {
    Func string
    Of   Column
}
func (Aggregate) isSelectable() {}

type Literal[T any] struct{ Value T }
func (Literal[T]) isSelectable() {}

func Select[S Selectable](items ...S) string {
    return fmt.Sprintf("SELECT %v", items)
}

// Outside package query:
//   type MyType struct{}
//   Select[MyType](MyType{})   // ❌ MyType has no isSelectable() method
```

The unexported method is the gate: only types defined in this package can satisfy `Selectable`.
