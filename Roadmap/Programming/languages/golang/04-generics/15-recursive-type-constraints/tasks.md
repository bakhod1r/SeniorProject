# Recursive Type Constraints — Tasks

## Exercise structure

- 🟢 **Easy** — for beginners
- 🟡 **Medium** — middle level
- 🔴 **Hard** — senior level
- 🟣 **Expert** — professional level

A solution for each exercise is at the end. Each task highlights a specific aspect of recursive type constraints — usually by asking you to compare a non-recursive version with a recursive one.

---

## Easy 🟢

### Task 1 — Define `Cloner[T]`
Write the generic interface `Cloner[T any] interface { Clone() T }` and a struct `User` that satisfies `Cloner[User]`.

### Task 2 — Implement `DupAll`
Implement `DupAll[T Cloner[T]](xs []T) []T` that clones every element. Compare its return type with a non-recursive version.

### Task 3 — `Comparable[T]`
Define `Comparable[T any] interface { CompareTo(other T) int }` and implement it for `Money struct{ Cents int }`.

### Task 4 — Generic `Max[T Comparable[T]]`
Write `func Max[T Comparable[T]](a, b T) T`. Why must the constraint be recursive?

### Task 5 — Builder one-liner
Write `type Stepper[B any] interface { Step() B }` and a single function `Run[B Stepper[B]](b B) B` that returns `b.Step()`.

---

## Medium 🟡

### Task 6 — Self-merging counter
Define `Merger[T any] interface { Merge(other T) T }` and implement it for `type Counter struct { N int }`. Then write `Reduce[T Merger[T]](xs []T, zero T) T`.

### Task 7 — Three-step builder
Define `IntBuilder` with a `Step() IntBuilder` method that increments `V`. Write a helper `RunN[B Stepper[B]](b B, n int) B` that calls `Step` n times.

### Task 8 — Compare value and pointer receivers
Implement `Cloner[T]` once for value receiver (`func (u User) Clone() User`) and once for pointer receiver (`func (u *User) Clone() *User`). Show what `T` should be in each case for `DupAll` to compile.

### Task 9 — Generic linked list with Clone
Define `Node[T Cloner[T]] struct { v T; next *Node[T] }` and a `(*Node[T]).Clone() *Node[T]` method that deep-clones the list.

### Task 10 — Comparable-based Sort
Write `Sort[T Comparable[T]](xs []T)` using insertion sort. Test it on `Money`.

### Task 11 — Generic Min over Comparable
Write `MinOf[T Comparable[T]](xs []T) (T, bool)` returning `(zero, false)` when empty.

### Task 12 — Builder with two methods
Extend `Stepper[B]` with two methods `Step() B` and `Reset() B`. Implement for `IntBuilder` and write a helper that calls `b.Step().Reset().Step()`.

### Task 13 — Mixed recursive and comparable
Define `EqClone[T any] interface { comparable; Clone() T }`. Write `Distinct[T EqClone[T]](xs []T) []T` that keeps the first clone of each unique value.

### Task 14 — Mutual recursive interfaces
Define `A[T any] interface { ToB() B[T] }` and `B[T any] interface { ToA() A[T] }`. Show one concrete pair of types that satisfies both.

---

## Hard 🔴

### Task 15 — Two-parameter F-bound
Write `Pairable[A, B any] interface { Pair(other A) B }`. Define a function `PairAll[A Pairable[A, B], B any](xs []A) []B`. Demonstrate where inference works and where you must instantiate explicitly.

### Task 16 — Generic Tree with self-cloning nodes
Define `TreeNode[T Cloner[T]]` with `value T`, `left, right *TreeNode[T]`. Implement `(*TreeNode[T]).Clone() *TreeNode[T]` that deep-clones the tree.

### Task 17 — Self-typed state machine
Define `State[S any] interface { Next() (S, bool) }`. Implement a state machine `type Light struct{ name string }` whose `Next()` cycles `red → green → yellow → red`. Write `Run[S State[S]](s S) []S` that runs until `Next` returns `false`.

### Task 18 — Generic event-sourcing aggregate
Define `Aggregate[A any] interface { Apply(e Event) A }` and a function `Replay[A Aggregate[A]](init A, events []Event) A`.

### Task 19 — Self-comparing immutable list
Define `ImmutableList[T Comparable[T]] struct{ items []T }` with a method `Sorted() ImmutableList[T]` that returns a new list with sorted items.

---

## Expert 🟣

### Task 20 — Convert pre-generic Cloner
Take this pre-1.18 code and migrate it to a recursive constraint:
```go
type Cloner interface { Clone() Cloner }
func DupAll(xs []Cloner) []Cloner {
    out := make([]Cloner, len(xs))
    for i, v := range xs { out[i] = v.Clone() }
    return out
}
```
Show the migrated version and discuss the trade-offs.

### Task 21 — Inference investigation
Write `func PairAll[A Pairable[A, B], B any](xs []A) []B`. Then call it from a `main` package twice — once where inference works and once where it does not. Add comments explaining why.

### Task 22 — Nested recursion limits
Try to write `[T Cloner[Cloner[T]]]` and observe what the compiler does. Document the failure mode.

---

## Solutions

### Solution 1
```go
type Cloner[T any] interface {
    Clone() T
}

type User struct{ Name string }

func (u User) Clone() User { return User{Name: u.Name} }
```

### Solution 2
```go
func DupAll[T Cloner[T]](xs []T) []T {
    out := make([]T, len(xs))
    for i, v := range xs { out[i] = v.Clone() }
    return out
}
```
The recursive return type is `[]T`, not `[]Cloner`. Caller keeps the concrete type.

### Solution 3
```go
type Comparable[T any] interface {
    CompareTo(other T) int
}

type Money struct{ Cents int }

func (m Money) CompareTo(other Money) int { return m.Cents - other.Cents }
```

### Solution 4
```go
func Max[T Comparable[T]](a, b T) T {
    if a.CompareTo(b) > 0 { return a }
    return b
}
```
Recursive because `T` must compare to **other Ts**. Without the recursion, `CompareTo` would accept any type and return wrong results.

### Solution 5
```go
type Stepper[B any] interface { Step() B }

func Run[B Stepper[B]](b B) B { return b.Step() }
```

### Solution 6
```go
type Merger[T any] interface { Merge(other T) T }

type Counter struct{ N int }

func (c Counter) Merge(other Counter) Counter { return Counter{N: c.N + other.N} }

func Reduce[T Merger[T]](xs []T, zero T) T {
    acc := zero
    for _, v := range xs { acc = acc.Merge(v) }
    return acc
}
```

### Solution 7
```go
type IntBuilder struct{ V int }
func (b IntBuilder) Step() IntBuilder { return IntBuilder{V: b.V + 1} }

func RunN[B Stepper[B]](b B, n int) B {
    for i := 0; i < n; i++ { b = b.Step() }
    return b
}
```

### Solution 8
```go
// Value receiver
type V struct{ N int }
func (v V) Clone() V { return v }
// DupAll[V] works.

// Pointer receiver
type P struct{ N int }
func (p *P) Clone() *P { return &P{N: p.N} }
// DupAll[*P] works (note: T = *P, not P).
```

### Solution 9
```go
type Node[T Cloner[T]] struct {
    v    T
    next *Node[T]
}

func (n *Node[T]) Clone() *Node[T] {
    if n == nil { return nil }
    return &Node[T]{v: n.v.Clone(), next: n.next.Clone()}
}
```

### Solution 10
```go
func Sort[T Comparable[T]](xs []T) {
    for i := 1; i < len(xs); i++ {
        for j := i; j > 0 && xs[j].CompareTo(xs[j-1]) < 0; j-- {
            xs[j], xs[j-1] = xs[j-1], xs[j]
        }
    }
}
```

### Solution 11
```go
func MinOf[T Comparable[T]](xs []T) (T, bool) {
    var zero T
    if len(xs) == 0 { return zero, false }
    m := xs[0]
    for _, v := range xs[1:] {
        if v.CompareTo(m) < 0 { m = v }
    }
    return m, true
}
```

### Solution 12
```go
type Stepper[B any] interface {
    Step() B
    Reset() B
}

type IntB struct{ V int }
func (b IntB) Step() IntB  { return IntB{V: b.V + 1} }
func (b IntB) Reset() IntB { return IntB{V: 0} }

func Chain[B Stepper[B]](b B) B { return b.Step().Reset().Step() }
```

### Solution 13
```go
type EqClone[T any] interface {
    comparable
    Clone() T
}

func Distinct[T EqClone[T]](xs []T) []T {
    seen := map[T]struct{}{}
    out := []T{}
    for _, v := range xs {
        if _, ok := seen[v]; ok { continue }
        seen[v] = struct{}{}
        out = append(out, v.Clone())
    }
    return out
}
```

### Solution 14
```go
type A[T any] interface { ToB() B[T] }
type B[T any] interface { ToA() A[T] }

type aFoo struct{}
type bFoo struct{}

func (aFoo) ToB() B[int] { return bFoo{} }
func (bFoo) ToA() A[int] { return aFoo{} }
```

### Solution 15
```go
type Pairable[A, B any] interface {
    Pair(other A) B
}

func PairAll[A Pairable[A, B], B any](xs []A) []B {
    out := make([]B, 0, len(xs)/2)
    for i := 0; i+1 < len(xs); i += 2 {
        out = append(out, xs[i].Pair(xs[i+1]))
    }
    return out
}

// Inference works when A's Pair method shape pins B.
// If B is unrelated to A's methods, instantiate explicitly:
//   PairAll[Foo, Bar](xs)
```

### Solution 16
```go
type TreeNode[T Cloner[T]] struct {
    value       T
    left, right *TreeNode[T]
}

func (n *TreeNode[T]) Clone() *TreeNode[T] {
    if n == nil { return nil }
    return &TreeNode[T]{
        value: n.value.Clone(),
        left:  n.left.Clone(),
        right: n.right.Clone(),
    }
}
```

### Solution 17
```go
type State[S any] interface { Next() (S, bool) }

type Light struct{ name string }

func (l Light) Next() (Light, bool) {
    switch l.name {
    case "red":    return Light{"green"}, true
    case "green":  return Light{"yellow"}, true
    case "yellow": return Light{"red"}, false
    }
    return l, false
}

func Run[S State[S]](s S) []S {
    out := []S{s}
    for {
        next, ok := s.Next()
        out = append(out, next)
        if !ok { return out }
        s = next
    }
}
```

### Solution 18
```go
type Event struct{ Name string }

type Aggregate[A any] interface { Apply(e Event) A }

func Replay[A Aggregate[A]](init A, events []Event) A {
    cur := init
    for _, e := range events { cur = cur.Apply(e) }
    return cur
}
```

### Solution 19
```go
type ImmutableList[T Comparable[T]] struct{ items []T }

func (l ImmutableList[T]) Sorted() ImmutableList[T] {
    out := make([]T, len(l.items))
    copy(out, l.items)
    Sort(out) // from solution 10
    return ImmutableList[T]{items: out}
}
```

### Solution 20
```go
// Migrated:
type Cloner[T any] interface { Clone() T }

func DupAll[T Cloner[T]](xs []T) []T {
    out := make([]T, len(xs))
    for i, v := range xs { out[i] = v.Clone() }
    return out
}

// Trade-offs:
// + Concrete type preserved
// + No allocations from interface boxing
// - Old code calling DupAll([]Cloner{...}) breaks
// - Existing implementations may need a tweak (return T instead of Cloner)
```

### Solution 21
```go
// Inference works: B is determined by Foo's Pair method.
// Inference fails: when B does not appear in any argument type and
// the constraint cannot uniquely determine it.

// Explicit fix:
out := PairAll[Foo, Bar](xs)
```

### Solution 22
```go
// Attempt:
func F[T Cloner[Cloner[T]]](v T) {} // ❌

// The compiler usually rejects this with a confusing error
// about the inner Cloner[T] not being a valid argument
// to the outer Cloner. Lesson: keep recursion shallow.
```

---

## Final notes

These tasks emphasise the central insight: a recursive constraint **preserves the concrete type** across method calls. The pattern is small but powerful. After completing the easy and medium tasks you should be able to read any recursive constraint in third-party code without effort. The hard and expert tasks expose the limits where Go's compiler stops cooperating — those are the moments to step back and reconsider whether the abstraction is worth the friction.
