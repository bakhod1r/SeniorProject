# Generic Data Structures — Middle Level

## Table of Contents
1. [Beyond stacks and sets](#beyond-stacks-and-sets)
2. [Queue — slice-backed implementation](#queue-slice-backed-implementation)
3. [Queue — ring buffer implementation](#queue-ring-buffer-implementation)
4. [LinkedList[T] with pointer receivers](#linkedlistt-with-pointer-receivers)
5. [Pair[K, V] — a small but useful tuple](#pairk-v-a-small-but-useful-tuple)
6. [Optional[T] / Maybe[T]](#optionalt-maybet)
7. [Method-set choices](#method-set-choices)
8. [Iteration over generic containers](#iteration-over-generic-containers)
9. [Summary](#summary)

---

## Beyond stacks and sets

After the basics — `Stack[T]` and `Set[T]` — most generic data structure work falls into four categories:

1. **Queues** for FIFO order
2. **Linked lists** for splicing and ordered insertion
3. **Tuples** like `Pair[K,V]` to bundle two values without naming a struct
4. **Wrappers** like `Optional[T]` to express "value or absence" cleanly

Each one introduces a new generic skill: `Queue` teaches you to choose between two memory layouts, `LinkedList` teaches you about pointer receivers and node types, `Pair` introduces multiple type parameters, and `Optional` teaches you to wrap a value with safety semantics.

---

## Queue — slice-backed implementation

A queue is FIFO: enqueue at the back, dequeue from the front.

### Naive slice queue

```go
type Queue[T any] struct {
    data []T
}

func (q *Queue[T]) Enqueue(v T) {
    q.data = append(q.data, v)
}

func (q *Queue[T]) Dequeue() (T, bool) {
    var zero T
    if len(q.data) == 0 {
        return zero, false
    }
    v := q.data[0]
    q.data = q.data[1:]
    return v, true
}

func (q *Queue[T]) Len() int { return len(q.data) }
```

This is correct but wasteful: every `Dequeue` reslices, leaving the front of the underlying array unused. After many enqueue/dequeue cycles the underlying array grows but the live region drifts forward, holding dead references that the GC cannot collect.

### Improved slice queue with reset

```go
func (q *Queue[T]) Dequeue() (T, bool) {
    var zero T
    if len(q.data) == 0 {
        return zero, false
    }
    v := q.data[0]
    q.data[0] = zero // clear the slot so GC can collect
    q.data = q.data[1:]

    // Periodically compact
    if cap(q.data) > 16 && len(q.data) < cap(q.data)/4 {
        q.data = append([]T(nil), q.data...)
    }
    return v, true
}
```

The `zero` write helps the GC reclaim pointer-shaped values. Compaction prevents unbounded backing-array growth.

### When the slice queue is fine

If the queue is **short-lived** and bounded in length, the naive version is perfectly fine. Reach for a ring buffer only when you have measured a problem.

---

## Queue — ring buffer implementation

A ring buffer (circular buffer) reuses a fixed-size array with two indices: head and tail.

```go
type RingQueue[T any] struct {
    data []T
    head int
    tail int
    size int
}

func NewRingQueue[T any](capacity int) *RingQueue[T] {
    return &RingQueue[T]{data: make([]T, capacity)}
}

func (q *RingQueue[T]) Enqueue(v T) bool {
    if q.size == len(q.data) {
        return false // full
    }
    q.data[q.tail] = v
    q.tail = (q.tail + 1) % len(q.data)
    q.size++
    return true
}

func (q *RingQueue[T]) Dequeue() (T, bool) {
    var zero T
    if q.size == 0 {
        return zero, false
    }
    v := q.data[q.head]
    q.data[q.head] = zero
    q.head = (q.head + 1) % len(q.data)
    q.size--
    return v, true
}

func (q *RingQueue[T]) Len() int { return q.size }
```

Tradeoffs:

| Aspect | Slice queue | Ring queue |
|--------|-------------|------------|
| Bounded? | No | Yes |
| Allocation per op | Amortised O(1) | Zero |
| Implementation complexity | Trivial | Moderate |
| Best for | Small, bursty | Steady-state, fixed capacity |

A ring buffer is the right tool for things like **fixed-size sliding windows**, **audio sample buffers**, and **bounded work queues**.

### Resizable ring buffer

If you want unbounded capacity with ring-buffer semantics, double the array on overflow:

```go
func (q *RingQueue[T]) grow() {
    newCap := len(q.data) * 2
    if newCap == 0 {
        newCap = 8
    }
    newData := make([]T, newCap)
    for i := 0; i < q.size; i++ {
        newData[i] = q.data[(q.head+i)%len(q.data)]
    }
    q.data = newData
    q.head = 0
    q.tail = q.size
}
```

This gives amortised O(1) enqueue with no boxing.

---

## LinkedList[T] with pointer receivers

A doubly linked list is the classic generic exercise. The tricky part is **node types** — they must also be generic.

```go
type listNode[T any] struct {
    value T
    prev  *listNode[T]
    next  *listNode[T]
}

type LinkedList[T any] struct {
    head *listNode[T]
    tail *listNode[T]
    size int
}

func (l *LinkedList[T]) PushFront(v T) {
    n := &listNode[T]{value: v, next: l.head}
    if l.head != nil {
        l.head.prev = n
    } else {
        l.tail = n
    }
    l.head = n
    l.size++
}

func (l *LinkedList[T]) PushBack(v T) {
    n := &listNode[T]{value: v, prev: l.tail}
    if l.tail != nil {
        l.tail.next = n
    } else {
        l.head = n
    }
    l.tail = n
    l.size++
}

func (l *LinkedList[T]) PopFront() (T, bool) {
    var zero T
    if l.head == nil {
        return zero, false
    }
    v := l.head.value
    l.head = l.head.next
    if l.head != nil {
        l.head.prev = nil
    } else {
        l.tail = nil
    }
    l.size--
    return v, true
}

func (l *LinkedList[T]) Len() int { return l.size }
```

Key rules for generic linked structures:

1. **Node types must list `[T]`** — `listNode[T]`, not `listNode`.
2. **Internal pointers reference `*listNode[T]`**, not `*listNode`.
3. **Constructor returns `*LinkedList[T]`** because methods mutate.
4. **`var zero T`** is the safe way to return an absent value.

### Why pointer receivers

```go
func (l *LinkedList[T]) PushFront(v T) { ... } // mutates l.head, l.tail, l.size
```

A value receiver would copy the list header. The new node would attach to a copy and the caller would see no change. Always use `*LinkedList[T]` for any mutating method.

### Iterating

A common pattern is an external iterator function:

```go
func (l *LinkedList[T]) ForEach(f func(T)) {
    for n := l.head; n != nil; n = n.next {
        f(n.value)
    }
}

list.ForEach(func(v int) { fmt.Println(v) })
```

In Go 1.23+ you can return an `iter.Seq[T]` for `range` integration:

```go
func (l *LinkedList[T]) All() iter.Seq[T] {
    return func(yield func(T) bool) {
        for n := l.head; n != nil; n = n.next {
            if !yield(n.value) {
                return
            }
        }
    }
}

for v := range list.All() {
    fmt.Println(v)
}
```

---

## Pair[K, V] — a small but useful tuple

Two type parameters introduce no new theory — you just declare them both.

```go
type Pair[K, V any] struct {
    First  K
    Second V
}

func NewPair[K, V any](k K, v V) Pair[K, V] {
    return Pair[K, V]{First: k, Second: v}
}

func (p Pair[K, V]) Swap() Pair[V, K] {
    return Pair[V, K]{First: p.Second, Second: p.First}
}
```

Notes:

- **`Swap`'s return type rebinds** the parameters — the result is `Pair[V, K]`, not `Pair[K, V]`.
- **Value receiver** is fine here because `Pair` is small and immutable in spirit.
- **`MapEntries`** style helpers compose well: `Map[K]V` to `[]Pair[K, V]` is one line.

```go
func Entries[K comparable, V any](m map[K]V) []Pair[K, V] {
    out := make([]Pair[K, V], 0, len(m))
    for k, v := range m {
        out = append(out, NewPair(k, v))
    }
    return out
}
```

`K comparable` is needed because the map key already requires it; `V any` permits everything.

### When NOT to use Pair

If the two fields have a real domain meaning, prefer a named struct (`type Coordinate struct{ X, Y int }`). `Pair` is for **anonymous** tuples in pipeline code.

---

## Optional[T] / Maybe[T]

Some teams import the `Optional[T]` pattern from Rust or Scala. In Go this fights the idiomatic `(value, ok)` pattern, but it has its place — especially in pipelines and field types where `(value, ok)` is awkward.

```go
type Optional[T any] struct {
    value   T
    present bool
}

func Some[T any](v T) Optional[T] {
    return Optional[T]{value: v, present: true}
}

func None[T any]() Optional[T] {
    return Optional[T]{}
}

func (o Optional[T]) Get() (T, bool) {
    return o.value, o.present
}

func (o Optional[T]) OrElse(def T) T {
    if o.present {
        return o.value
    }
    return def
}

func (o Optional[T]) Map(f func(T) T) Optional[T] {
    if !o.present {
        return o
    }
    return Some(f(o.value))
}
```

Usage:

```go
maybeUser := Some(User{Name: "Ana"})
nameLen := maybeUser.Map(func(u User) User {
    u.Name = strings.ToUpper(u.Name)
    return u
})
```

### Why a separate `present` flag

You might think `*T` is enough — `nil` means absent. Two reasons it is not:

1. **A nil pointer is itself a value** — distinguishing "no user" from "a nil-valued user" matters.
2. **Pointers force allocation.** `Optional[T]` keeps the value inline.

### When NOT to use Optional[T]

- Function return values: prefer `(T, bool)` or `(T, error)`.
- Common Go-style nil checks: just use `*T`.
- Code shared with engineers unfamiliar with the pattern: it adds cognitive load.

A reasonable rule: **use `Optional[T]` for struct fields where "absent" is a real domain concept, and `(T, bool)` everywhere else**.

---

## Method-set choices

Generic data structures expose a public method set. Two questions to answer for every method:

### Question 1 — Pointer or value receiver?

| Method behaviour | Receiver |
|------------------|----------|
| Mutates internal state | `*Container[T]` |
| Read-only, container is small | `Container[T]` (sometimes) or `*Container[T]` (usually) |
| Returns a new container | Either |

The Go convention — used in `container/list`, `container/heap`, `container/ring` — is to use pointer receivers everywhere on a container, even for read-only methods. The reasons are consistency and zero-copy semantics.

### Question 2 — Constraint?

Decide what operations the method performs on `T`:

| Operation in body | Constraint needed |
|-------------------|-------------------|
| None — just store and return | `T any` |
| `==`, `!=`, map key | `T comparable` |
| `<`, `<=`, sort | `T cmp.Ordered` |
| Method on `T` | Custom interface |

Once chosen, every method on the type must accept that constraint.

### Don't let constraints leak

If `Stack[T]` has a `Contains(T) bool` method that uses `==`, the entire type must declare `[T comparable]` — even if 90% of methods do not need it. This is the classic constraint-leak problem.

The clean fix is to **split** the type: keep `Stack[T any]` minimal, and offer `Contains` as a free function over a `Stack[T comparable]`:

```go
type Stack[T any] struct{ data []T }
func (s *Stack[T]) Push(v T)       { ... }
func (s *Stack[T]) Pop() (T, bool) { ... }

func StackContains[T comparable](s *Stack[T], target T) bool {
    for _, v := range s.data {
        if v == target { return true }
    }
    return false
}
```

This way `Stack[any]` still works, and `Contains` is available for `Stack[T comparable]` only.

---

## Iteration over generic containers

Three idioms exist, in order of "Go idiomatic":

### 1. Slice export

```go
func (s *Set[T]) ToSlice() []T {
    out := make([]T, 0, len(s.m))
    for k := range s.m {
        out = append(out, k)
    }
    return out
}
```

Simple, predictable. Allocates one slice.

### 2. Callback iterator

```go
func (l *LinkedList[T]) ForEach(f func(T)) { ... }
```

Avoids the slice allocation. Slightly less ergonomic at the call site.

### 3. `iter.Seq[T]` (Go 1.23+)

```go
func (l *LinkedList[T]) All() iter.Seq[T] {
    return func(yield func(T) bool) {
        for n := l.head; n != nil; n = n.next {
            if !yield(n.value) { return }
        }
    }
}
```

Integrates with `for v := range list.All()`. Requires Go 1.23 or newer.

A library that works on Go 1.18+ should ship the slice-export and callback iterators. Add `iter.Seq[T]` as a 1.23-only build-tagged file if needed.

---

## Summary

After this file you can:

- Build a slice-backed queue and know when its dequeue cost matters
- Build a ring-buffer queue with both bounded and resizable variants
- Build a doubly linked list with the right node-type and receiver patterns
- Use `Pair[K, V]` for ad hoc tuples without inventing names
- Use `Optional[T]` where "absent" is a real domain concept

The recurring lessons:

1. **Pointer receivers** for any mutation
2. **Generic node types** must list their type parameter list
3. **Multiple type parameters** are no harder than one — just declare them all
4. **Constraints leak** — split the type when one method needs a tighter constraint
5. **Iteration idioms** depend on the target Go version

Move on to `senior.md` for trees, heaps, and graphs — where method-set constraints become more interesting.
