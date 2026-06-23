# Generic Data Structures — Senior Level

## Table of Contents
1. [The hard ones — trees, heaps, graphs](#the-hard-ones-trees-heaps-graphs)
2. [Tree[T] — generic n-ary tree](#treet-generic-n-ary-tree)
3. [BST[T cmp.Ordered] — binary search tree](#bstt-cmpordered-binary-search-tree)
4. [Heap[T] — priority queue](#heapt-priority-queue)
5. [Graph[V, E] — vertices and edges](#graphv-e-vertices-and-edges)
6. [Method-set constraints on T](#method-set-constraints-on-t)
7. [Architectural choices](#architectural-choices)
8. [Summary](#summary)

---

## The hard ones — trees, heaps, graphs

Trees and graphs are where generic data structures stop being a syntactic exercise and start asking real design questions:

- What constraint does `T` need? `cmp.Ordered`? `comparable`? A method?
- Should the comparator be a parameter, a constraint, or a hard-coded `<`?
- Where do node types live — exported, unexported, internal?
- How do I expose iteration without leaking the node type?

A senior engineer answers these questions consciously, not by accident.

---

## Tree[T] — generic n-ary tree

A general tree has a value and a list of children. No order, no constraint.

```go
type Tree[T any] struct {
    Value    T
    Children []*Tree[T]
}

func (t *Tree[T]) AddChild(v T) *Tree[T] {
    child := &Tree[T]{Value: v}
    t.Children = append(t.Children, child)
    return child
}

func (t *Tree[T]) Walk(f func(T)) {
    if t == nil {
        return
    }
    f(t.Value)
    for _, c := range t.Children {
        c.Walk(f)
    }
}
```

Notes:

- `[T any]` — no requirement on `T` because we never compare or hash.
- `*Tree[T]` everywhere as the child type, never `Tree[T]`, because trees are usually mutated and shared.
- `AddChild` returns the new child so callers can chain construction.

Use `Tree[T]` for **filesystem-like** structures, **DOM-like** trees, **scene graphs**, **expression trees**.

### Recursive construction is awkward

A natural-looking recursive constructor:

```go
func MakeTree[T any](v T, children ...*Tree[T]) *Tree[T] {
    return &Tree[T]{Value: v, Children: children}
}
```

…lets you build trees declaratively:

```go
root := MakeTree("root",
    MakeTree("a"),
    MakeTree("b",
        MakeTree("b1"),
        MakeTree("b2"),
    ),
)
```

This pattern scales well for static trees but, like all variadic-recursive builders, gets awkward when nodes need parent pointers.

---

## BST[T cmp.Ordered] — binary search tree

A BST imposes order: left children are smaller, right children are larger. The natural constraint is **`cmp.Ordered`** so we can use `<` directly.

```go
import "cmp"

type bnode[T cmp.Ordered] struct {
    value T
    left  *bnode[T]
    right *bnode[T]
}

type BST[T cmp.Ordered] struct {
    root *bnode[T]
    size int
}

func (t *BST[T]) Insert(v T) {
    t.root, _ = bstInsert(t.root, v)
    // Note: bstInsert returns (newRoot, inserted)
}

func bstInsert[T cmp.Ordered](n *bnode[T], v T) (*bnode[T], bool) {
    if n == nil {
        return &bnode[T]{value: v}, true
    }
    switch {
    case v < n.value:
        var ins bool
        n.left, ins = bstInsert(n.left, v)
        return n, ins
    case v > n.value:
        var ins bool
        n.right, ins = bstInsert(n.right, v)
        return n, ins
    default:
        return n, false // already present
    }
}

func (t *BST[T]) Contains(v T) bool {
    n := t.root
    for n != nil {
        switch {
        case v < n.value:
            n = n.left
        case v > n.value:
            n = n.right
        default:
            return true
        }
    }
    return false
}

func (t *BST[T]) InOrder(f func(T)) {
    inOrder(t.root, f)
}

func inOrder[T cmp.Ordered](n *bnode[T], f func(T)) {
    if n == nil {
        return
    }
    inOrder(n.left, f)
    f(n.value)
    inOrder(n.right, f)
}
```

### Why `cmp.Ordered` and not a custom `Less`

Two design choices for ordered containers:

| Choice | Pros | Cons |
|--------|------|------|
| `[T cmp.Ordered]` | Zero ceremony, `<` works | Cannot order custom struct types |
| `[T any]` + `less func(a, b T) bool` | Works for any T including structs | Caller must remember to pass `less` |

A senior engineer often offers **both**: a default `BST[T cmp.Ordered]` and a `BSTFunc[T any]` that takes a comparator. This is the same pattern `slices.Sort` and `slices.SortFunc` follow.

```go
type BSTFunc[T any] struct {
    root *bnode[T]
    less func(a, b T) bool
}
```

(Inside, replace `v < n.value` with `t.less(v, n.value)` and so on.)

### Why `cmp.Ordered` vs `comparable`

`comparable` only guarantees `==`/`!=`. `cmp.Ordered` guarantees `<`, `<=`, `>`, `>=`. A BST needs the second.

`cmp.Ordered` is roughly:
```go
type Ordered interface {
    ~int | ~int8 | ... | ~uint | ... | ~float32 | ~float64 | ~string
}
```

Custom struct types do **not** satisfy `cmp.Ordered`. They satisfy `comparable` (if their fields are comparable) and need a custom comparator function for ordering.

---

## Heap[T] — priority queue

A heap is a tree where every parent is less than its children (min-heap) or greater (max-heap). Implemented over a slice with index arithmetic.

```go
type Heap[T any] struct {
    data []T
    less func(a, b T) bool
}

func NewHeap[T any](less func(a, b T) bool) *Heap[T] {
    return &Heap[T]{less: less}
}

func (h *Heap[T]) Len() int { return len(h.data) }

func (h *Heap[T]) Push(v T) {
    h.data = append(h.data, v)
    h.up(len(h.data) - 1)
}

func (h *Heap[T]) Pop() (T, bool) {
    var zero T
    if len(h.data) == 0 {
        return zero, false
    }
    top := h.data[0]
    n := len(h.data) - 1
    h.data[0] = h.data[n]
    h.data[n] = zero
    h.data = h.data[:n]
    if n > 0 {
        h.down(0)
    }
    return top, true
}

func (h *Heap[T]) up(i int) {
    for i > 0 {
        parent := (i - 1) / 2
        if !h.less(h.data[i], h.data[parent]) {
            break
        }
        h.data[i], h.data[parent] = h.data[parent], h.data[i]
        i = parent
    }
}

func (h *Heap[T]) down(i int) {
    n := len(h.data)
    for {
        l := 2*i + 1
        r := 2*i + 2
        smallest := i
        if l < n && h.less(h.data[l], h.data[smallest]) {
            smallest = l
        }
        if r < n && h.less(h.data[r], h.data[smallest]) {
            smallest = r
        }
        if smallest == i {
            return
        }
        h.data[i], h.data[smallest] = h.data[smallest], h.data[i]
        i = smallest
    }
}
```

Usage:

```go
import "cmp"

minHeap := NewHeap[int](cmp.Less[int])
minHeap.Push(3); minHeap.Push(1); minHeap.Push(2)
v, _ := minHeap.Pop() // 1
```

A `cmp.Ordered`-only version:

```go
type OrderedHeap[T cmp.Ordered] struct{ data []T }
// up/down use < directly
```

The function-based version is more flexible (supports max-heap, custom struct ordering); the constraint-based version is shorter for simple cases.

### Comparison with `container/heap`

`container/heap` works through an interface:

```go
type Interface interface {
    sort.Interface
    Push(x any)
    Pop() any
}
```

Every user must define a wrapper type that implements five methods. With generics, the user just supplies a `less` function. The generic version is dramatically more ergonomic but slightly slower (we explore why in `optimize.md` and `professional.md`).

---

## Graph[V, E] — vertices and edges

A graph has two type parameters: vertex labels `V` and edge weights `E`.

```go
type Graph[V comparable, E any] struct {
    edges map[V]map[V]E
}

func NewGraph[V comparable, E any]() *Graph[V, E] {
    return &Graph[V, E]{edges: make(map[V]map[V]E)}
}

func (g *Graph[V, E]) AddVertex(v V) {
    if _, ok := g.edges[v]; !ok {
        g.edges[v] = make(map[V]E)
    }
}

func (g *Graph[V, E]) AddEdge(from, to V, weight E) {
    g.AddVertex(from)
    g.AddVertex(to)
    g.edges[from][to] = weight
}

func (g *Graph[V, E]) Neighbors(v V) map[V]E {
    return g.edges[v]
}

func (g *Graph[V, E]) HasEdge(from, to V) bool {
    if m, ok := g.edges[from]; ok {
        _, ok2 := m[to]
        return ok2
    }
    return false
}
```

### Why `V comparable` and `E any`

`V` is a map key — it must be `comparable`. `E` only stores weight data — it can be `any` (an `int` for weights, a struct for typed edges, etc.).

### BFS over the generic graph

```go
func (g *Graph[V, E]) BFS(start V, visit func(V)) {
    seen := map[V]struct{}{}
    queue := []V{start}
    for len(queue) > 0 {
        v := queue[0]
        queue = queue[1:]
        if _, ok := seen[v]; ok {
            continue
        }
        seen[v] = struct{}{}
        visit(v)
        for n := range g.edges[v] {
            if _, ok := seen[n]; !ok {
                queue = append(queue, n)
            }
        }
    }
}
```

Note that `V comparable` propagated automatically: `seen` is `map[V]struct{}` and the queue-based BFS uses `==` implicitly.

### When to add a third type parameter

If your graph also carries vertex data (not just labels), you need three parameters:

```go
type DataGraph[V comparable, VD any, E any] struct {
    vertices map[V]VD
    edges    map[V]map[V]E
}
```

Three parameters is the practical limit. Beyond that, **the type is doing too much** — split it.

---

## Method-set constraints on T

Some containers want elements that have specific methods. The constraint becomes a custom interface.

### Container with `String() string`

```go
type Printable interface {
    String() string
}

type Diary[T Printable] struct {
    entries []T
}

func (d *Diary[T]) Add(v T) { d.entries = append(d.entries, v) }

func (d *Diary[T]) PrintAll() {
    for _, e := range d.entries {
        fmt.Println(e.String())
    }
}
```

Now only types with `String() string` are accepted:

```go
type Note struct{ msg string }
func (n Note) String() string { return n.msg }

d := &Diary[Note]{}
d.Add(Note{"first entry"})
d.PrintAll()
```

### Mixing method-set and type-set constraints

```go
type Sortable[T any] interface {
    ~[]T
    Less(i, j int) bool
}
```

Any type whose underlying type is `[]T` and which has a `Less` method satisfies `Sortable[T]`. This pattern is rare in practice but useful for sort-style helpers.

### The trade-off

Method-set constraints push the design **back toward interfaces**. If every operation goes through a method, you may not need generics at all — a plain interface is simpler.

A useful rule: **use a method-set constraint only when the container also performs type-set operations** (like `==` or `<`). Otherwise pick an interface and write a non-generic helper.

---

## Architectural choices

A senior engineer designing a generic data structure thinks about five axes.

### 1. Constraint scope

`[T any]` is the most permissive. Each tightening (`comparable`, `cmp.Ordered`, custom interface) restricts the user. Choose the loosest constraint that lets the body compile.

### 2. Receiver style

Pointer receivers (`*Container[T]`) are conventional for mutable containers. Value receivers (`Container[T]`) for tiny immutable types like `Pair[K, V]`. Mixing the two on one type is confusing.

### 3. Comparator: constraint or function?

| Option | When to pick |
|--------|--------------|
| `[T cmp.Ordered]` | Built-in ordered types only |
| `[T any]` + `less func(a, b T) bool` | Custom orderings on structs |
| Both as parallel APIs | Library aimed at broad audience |

`slices.Sort` and `slices.SortFunc` is the canonical example.

### 4. Iteration

Pick one or two of:
- `ToSlice() []T` — simplest, allocates
- `ForEach(func(T))` — no allocation
- `iter.Seq[T]` — modern (Go 1.23+)

Document the iteration order if it is not obvious.

### 5. Concurrency

Most generic containers are **not** safe for concurrent use. Document this explicitly. If you provide a thread-safe variant, do so as a separate type:

```go
type ConcurrentSet[T comparable] struct {
    mu sync.RWMutex
    s  Set[T]
}
```

Composing the simple `Set[T]` keeps responsibilities clean.

### Anti-pattern: the "god container"

```go
type SortedDedupCacheStackSet[T any, K comparable, V any] struct{ ... }
```

Five jobs in one type. Split into smaller types and let the user compose them.

---

## Summary

Senior-level generic data structures are about **architectural clarity**, not syntax:

1. **Pick the constraint deliberately** — `any`, `comparable`, `cmp.Ordered`, or a method set.
2. **Default to pointer receivers** for mutable containers; value receivers for tiny tuples.
3. **Offer comparators** when `cmp.Ordered` is too restrictive — and follow the `Sort`/`SortFunc` pairing.
4. **Bound generic surface** — three type parameters is the practical limit.
5. **Don't ship a god type** — small, composable structures beat one monster.

The hardest call is constraint scope. `Stack[T any]` is permissive but cannot offer `Contains`. `Stack[T comparable]` can offer `Contains` but excludes types with slice fields. Picking the right tradeoff is the senior skill.

Move on to `professional.md` for the comparison with the stdlib `container/*` packages and the question of when to ship a generic library at all.
