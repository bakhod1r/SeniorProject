# Generic Data Structures — Interview Q&A

## How to use this file

Each question has a **short answer** for memorization and a **long answer** for understanding. Practice both. Containers are an interview favourite — be ready to whiteboard `Stack[T]`, `Set[T]`, and `LRUCache[K, V]` from memory.

Difficulty:
- 🟢 Beginner
- 🟡 Mid-level
- 🔴 Senior
- 🟣 Expert

---

## Beginner 🟢

### Q1. Why couldn't we write a clean Stack[T] before Go 1.18?
**Short:** Because Go had no type parameters. You either wrote `IntStack` per type, used `[]interface{}` (boxing + assertions), or generated code with `genny`.

**Long:** Pre-1.18, type-safe containers required either per-element-type duplication or relying on `interface{}`. The first is verbose; the second loses compile-time type safety and adds runtime overhead. Code generators (`genny`, `gotemplate`) gave type safety at the cost of build complexity.

### Q2. Implement Stack[T] with Push, Pop, Len.
**Short:**
```go
type Stack[T any] struct { data []T }
func (s *Stack[T]) Push(v T)        { s.data = append(s.data, v) }
func (s *Stack[T]) Pop() (T, bool) {
    var zero T
    if len(s.data) == 0 { return zero, false }
    n := len(s.data) - 1
    v := s.data[n]
    s.data = s.data[:n]
    return v, true
}
func (s *Stack[T]) Len() int { return len(s.data) }
```

### Q3. Why does Set[T] require comparable, not any?
**Short:** Because the implementation uses `map[T]struct{}`, and Go map keys must support `==`.

**Long:** A set is internally a map from element to a marker. Maps in Go require their key type to be comparable so that hashing and lookup with `==` are well-defined. `T any` would allow `[]int`, which is not comparable, and the compiler refuses.

### Q4. Why use `struct{}` as the map value in a set?
**Short:** It is zero bytes, saving memory compared to `bool` (1 byte) or other types.

**Long:** Empty struct `struct{}` has size 0. Whether the set has 10 or 10 million entries, the values consume zero memory; only the keys matter. `map[T]bool` works but wastes one byte per entry.

### Q5. What is `var zero T` for?
**Short:** It produces the zero value of `T`, used for "absent" return values inside generic methods.

**Long:** Inside `func (s *Stack[T]) Pop() (T, bool)`, when the stack is empty you need to return some `T`. You cannot write `T{}` because `T` could be any type. `var zero T` declares a variable whose value is `T`'s zero value, which is universally legal.

### Q6. Why pointer receivers for containers?
**Short:** To mutate the underlying slice/map. Value receivers operate on a copy.

**Long:** A method like `Push` must update `s.data`. If the receiver is `Stack[T]` (value), the method receives a copy of the struct — appending to the copy's slice does not change the caller's stack. `*Stack[T]` (pointer) shares the struct so the mutation is visible.

### Q7. Implement Set[T] with Add, Has, Remove.
**Short:**
```go
type Set[T comparable] struct{ m map[T]struct{} }
func NewSet[T comparable]() *Set[T] { return &Set[T]{m: map[T]struct{}{}} }
func (s *Set[T]) Add(v T)       { s.m[v] = struct{}{} }
func (s *Set[T]) Has(v T) bool  { _, ok := s.m[v]; return ok }
func (s *Set[T]) Remove(v T)    { delete(s.m, v) }
```

### Q8. Why provide a `New<Container>` constructor?
**Short:** To initialise internal maps. Without it, the zero value has a `nil` map and panics on first `Add`.

**Long:** `&Set[int]{}` builds a zero-valued struct where `m` is `nil`. Writing to a nil map panics. A constructor like `NewSet[T]()` initialises the map and prevents this footgun.

### Q9. Can `Stack[T]` hold mixed types like `int` and `string`?
**Short:** No. Each instantiation `Stack[int]`, `Stack[string]` is a distinct type.

**Long:** If you need a heterogeneous container, that is what `interface{}` is for — but that is exactly what generics are designed to avoid. Mixed-type containers are usually a sign of weak design.

### Q10. What does `[T comparable]` allow that `[T any]` does not?
**Short:** Use of `==` and `!=` on values of `T`, including using `T` as a map key.

---

## Mid-level 🟡

### Q11. Implement a queue with both Enqueue and Dequeue. Why is naive slice dequeue inefficient?
**Short:**
```go
type Queue[T any] struct{ data []T }
func (q *Queue[T]) Enqueue(v T) { q.data = append(q.data, v) }
func (q *Queue[T]) Dequeue() (T, bool) {
    var zero T
    if len(q.data) == 0 { return zero, false }
    v := q.data[0]
    q.data = q.data[1:]
    return v, true
}
```
Naive dequeue (`q.data[1:]`) leaves the underlying array's front holding dead references that the GC cannot reclaim.

**Long:** After many enqueue/dequeue cycles, the underlying array grows but the live region drifts. The garbage collector sees pointers to dead values in the slice header. Either zero them explicitly (`q.data[0] = zero; q.data = q.data[1:]`) or use a ring buffer.

### Q12. When would you pick a ring buffer over a slice queue?
**Short:** When the queue has a bounded capacity and you want zero-allocation operations.

**Long:** Ring buffers reuse a fixed-size array with head/tail indices. Each operation is O(1) with no allocation. They are ideal for fixed-size sliding windows, audio buffers, and bounded job queues.

### Q13. Why is Pair[K, V] useful?
**Short:** Anonymous tuple to bundle two values without naming a struct.

**Long:** When converting a `map[K]V` to a slice for sorting or transmission, `[]Pair[K, V]` is more ergonomic than declaring a one-off struct for each call site. The naming `Pair[K, V].First`, `Second` is explicit enough for short-lived pipelines.

### Q14. Walk through implementing a doubly linked list.
**Short:**
```go
type listNode[T any] struct{ value T; prev, next *listNode[T] }
type List[T any] struct{ head, tail *listNode[T]; size int }
```
Push/Pop on both ends, careful with nil cases when list becomes empty.

**Long:** The trick is the **node type must also be generic** — `listNode[T]`, not `listNode`. Internal pointers are `*listNode[T]`. Always use pointer receivers. Pop should clear the removed node's pointers to help GC and to fail fast if a stale reference is reused.

### Q15. Implement Optional[T] / Maybe[T].
**Short:**
```go
type Optional[T any] struct{ v T; present bool }
func Some[T any](v T) Optional[T] { return Optional[T]{v, true} }
func None[T any]() Optional[T]    { return Optional[T]{} }
func (o Optional[T]) Get() (T, bool) { return o.v, o.present }
```

**Long:** Use a separate boolean flag to distinguish "absent" from "present with zero value". Don't use `*T` because (a) nil and a real nil-valued `*T` are confusable, and (b) you allocate.

### Q16. Why does this constructor fail?
```go
type Set[T comparable] struct{ m map[T]struct{} }
var s Set[int]
s.Add(5) // panic
```
**Short:** `m` is nil. Writing to a nil map panics. Use `NewSet[int]()`.

### Q17. How would you make Set[T] thread-safe?
**Short:** Wrap with `sync.RWMutex` in a separate type.

**Long:**
```go
type ConcurrentSet[T comparable] struct {
    mu sync.RWMutex
    s  *Set[T]
}
func (c *ConcurrentSet[T]) Add(v T) {
    c.mu.Lock(); defer c.mu.Unlock()
    c.s.Add(v)
}
```
Composing the simple `Set[T]` keeps responsibilities clean.

### Q18. Why do methods on Stack[T] have to repeat `[T]` on the receiver?
**Short:** The spec requires it to bring the type parameter into scope for the body.

**Long:** Without `[T]`, the body cannot reference `T`. The receiver's bracket list is mandatory and must list the same number of type parameters as the type declaration.

### Q19. How do you iterate a generic container?
**Short:** Three idioms — `ToSlice() []T`, `ForEach(func(T))`, or `iter.Seq[T]` (Go 1.23+).

**Long:** `ToSlice` is simplest but allocates. `ForEach` avoids allocation but breaks iteration mid-loop is awkward. `iter.Seq[T]` (Go 1.23+) integrates with `for range` and supports early termination via the `yield` callback.

### Q20. Why can't a method on a generic type declare its own type parameters?
**Short:** Deliberate language design choice in Go 1.18+.

**Long:** Allowing method-level type parameters would significantly complicate runtime types and reflection. The workaround is a free function: `func StackContains[T comparable](s *Stack[T], target T) bool`.

---

## Senior 🔴

### Q21. Build LRUCache[K comparable, V any] in 5 minutes.
**Short:** A map of K to a doubly-linked-list node, plus head/tail pointers. Get moves the node to the head; Put evicts the tail when over capacity.

**Long:**
```go
type lruEntry[K comparable, V any] struct {
    k K; v V
    prev, next *lruEntry[K, V]
}
type LRU[K comparable, V any] struct {
    cap        int
    m          map[K]*lruEntry[K, V]
    head, tail *lruEntry[K, V]
}
func (c *LRU[K, V]) Get(k K) (V, bool) {
    e, ok := c.m[k]
    if !ok { var zero V; return zero, false }
    c.moveToFront(e)
    return e.v, true
}
func (c *LRU[K, V]) Put(k K, v V) {
    if e, ok := c.m[k]; ok {
        e.v = v; c.moveToFront(e); return
    }
    e := &lruEntry[K, V]{k: k, v: v}
    c.m[k] = e
    c.addToFront(e)
    if len(c.m) > c.cap { c.evictTail() }
}
```
The full implementation with `moveToFront`, `addToFront`, `evictTail` is straightforward link-list manipulation.

### Q22. Why does Heap[T] often take a `less` function instead of using `cmp.Ordered`?
**Short:** Because most real heaps order custom struct types where `cmp.Ordered` does not apply.

**Long:** `cmp.Ordered` only includes the predeclared ordered types. A priority queue of `Job` structs by `Priority` field cannot use `cmp.Ordered`. A `less func(a, b T) bool` parameter accommodates any ordering. The trade-off mirrors `slices.Sort` (constraint-based) vs `slices.SortFunc` (function-based).

### Q23. How do you choose between `[T any]` + `less` and `[T cmp.Ordered]`?
**Short:** `cmp.Ordered` for primitives where the default ordering is right; `less` parameter for everything else.

**Long:** Some libraries ship both APIs. The constraint version is faster (no function call per comparison) and shorter to use; the function version is more flexible. For a public library targeting general use, ship both like the stdlib does.

### Q24. Build a Trie[T] for string-keyed values.
**Short:** Each node is a map from `byte` (or `rune`) to a child node, plus an optional value.

**Long:**
```go
type Trie[T any] struct {
    children map[byte]*Trie[T]
    value    T
    has      bool
}
func (t *Trie[T]) Set(k string, v T) {
    n := t
    for i := 0; i < len(k); i++ {
        if n.children == nil { n.children = map[byte]*Trie[T]{} }
        c, ok := n.children[k[i]]
        if !ok { c = &Trie[T]{}; n.children[k[i]] = c }
        n = c
    }
    n.value = v; n.has = true
}
func (t *Trie[T]) Get(k string) (T, bool) {
    n := t
    for i := 0; i < len(k); i++ {
        c, ok := n.children[k[i]]
        if !ok { var zero T; return zero, false }
        n = c
    }
    return n.value, n.has
}
```

### Q25. Why is Tree[T] usually `[T any]` while BST[T] is `[T cmp.Ordered]`?
**Short:** A general tree imposes no order; a BST does.

**Long:** A `Tree[T]` does not compare `T` values — it just stores them and walks. So `[T any]` is enough. A BST orders elements by `<`, which requires either `cmp.Ordered` or a `less` function.

### Q26. Walk through Graph[V, E].
**Short:**
```go
type Graph[V comparable, E any] struct{ edges map[V]map[V]E }
```
`V` is `comparable` (map key); `E` is `any` (any edge data).

**Long:** The adjacency map of maps is the simplest representation. For dense graphs, an adjacency matrix `[][]E` is more efficient. Most algorithms (BFS, DFS, Dijkstra) work on the same `Graph[V, E]` shape.

### Q27. What is a CowList (copy-on-write list)?
**Short:** A list that shares its backing data with copies until a mutation happens, at which point the mutated copy clones the data.

**Long:** Useful for "snapshots" — readers see a consistent view; writers do not block readers. Implemented with a slice plus a sync.Mutex; on Add, if the slice is shared (high refcount or "dirty" flag), clone before appending.

### Q28. How would you build a thread-safe Stack[T]?
**Short:** Wrap a `sync.Mutex` around a non-thread-safe `Stack[T]`.

**Long:**
```go
type ConcurrentStack[T any] struct {
    mu sync.Mutex
    s  Stack[T]
}
func (c *ConcurrentStack[T]) Push(v T) {
    c.mu.Lock(); defer c.mu.Unlock()
    c.s.Push(v)
}
func (c *ConcurrentStack[T]) Pop() (T, bool) {
    c.mu.Lock(); defer c.mu.Unlock()
    return c.s.Pop()
}
```
For very high contention, consider lock-free designs based on `sync/atomic`, but most code does not need them.

### Q29. Constraint leak — what is it and how do you avoid it?
**Short:** When one method needs `comparable`, the entire type becomes `[T comparable]`, restricting users who don't need that method.

**Long:** Solution: keep the type at `[T any]` and provide constraint-tighter operations as **free functions** that accept the loose-typed container. `Stack[T any]` plus `StackContains[T comparable](s *Stack[T], v T) bool` is the canonical pattern.

### Q30. Why doesn't the stdlib provide a generic Heap[T]?
**Short:** Backwards compatibility, plus the team has not converged on the right comparator API.

**Long:** `container/heap` is a frozen API; changing it would break callers. The stdlib could have added `heap.Generic[T]` alongside, but the design space (constraint vs function comparator) is unsettled. Third-party libraries are filling the gap.

---

## Expert 🟣

### Q31. Implement a BloomFilter[T] generically.
**Short:** A bit array plus k hash functions. The hash functions must be derivable from `T`, which usually means `T` is `[]byte`-coercible or has a `Hash()` method.

**Long:** A generic bloom filter is harder than it looks because you need a way to hash arbitrary `T`. Two designs:
1. `BloomFilter[T any]` with a `hash func(T) uint64` parameter — most flexible.
2. `BloomFilter[T Hashable]` where `Hashable` has a `Hash() uint64` method — type-safe but restrictive.

The flexibility-vs-safety tradeoff repeats throughout generic library design.

### Q32. Implement a CircularBuffer[T] with overwrite-on-full semantics.
**Short:** Like a ring queue but with `Push` overwriting the oldest element when full.

**Long:**
```go
type CircularBuffer[T any] struct {
    data []T
    head int
    size int
}
func (c *CircularBuffer[T]) Push(v T) {
    if c.size < len(c.data) {
        c.data[(c.head+c.size)%len(c.data)] = v
        c.size++
    } else {
        c.data[c.head] = v
        c.head = (c.head + 1) % len(c.data)
    }
}
```
Common in metrics buffers (last-N samples) and audio codecs.

### Q33. Why is the receiver type `*Stack[T]` and not `Stack[*T]`?
**Short:** They mean different things. `*Stack[T]` is a pointer to a stack of `T`. `Stack[*T]` is a stack of pointers to `T`.

**Long:** This is the most common confusion for newcomers. `*Stack[int]` is a *Stack pointer with int element*. `Stack[*int]` is a stack of *int pointers*. Both are valid, but for very different purposes.

### Q34. How would you design a generic Skip List?
**Short:** A multi-level linked list where each node has random "express lanes". Generic over `T cmp.Ordered` or `T any` + `less`.

**Long:** Skip lists are a probabilistic alternative to balanced BSTs. The generic form follows the BST pattern: ordered constraint or comparator function. Each node carries multiple `*node[T]` pointers (one per level). The `Insert` function walks from the highest level down, using the `less` predicate at each step.

### Q35. What goes wrong with `Stack[*Stack[int]]`?
**Short:** Nothing technically — but each instantiation is a distinct GC shape stencil, and deeply nested generics inflate binary size.

**Long:** The compiler stencils `Stack[int]` and `Stack[*Stack[int]]` separately. For two or three levels, this is fine; for an arbitrarily deep tower, you grow the binary. Pre-1.18 hand-rolled code did not have this problem because it was all `interface{}`. The trade-off is binary size for type safety.

### Q36. Walk through an issue when methods return the receiver type.
**Short:** A method that returns `*Stack[T]` cannot be inherited by an embedding type without adjustment, because the return type is fixed to `*Stack[T]`, not `*EmbeddingType`.

**Long:** This is a classic "self type" problem. Languages like Java solve it with `<T extends Self>`. Go does not. If `Stack[T].Push` returned `*Stack[T]` for chaining, an embedding `LoggedStack[T]` that wants `Push` to return `*LoggedStack[T]` for chaining cannot get that automatically. Workaround: shadow the method.

### Q37. How does GC shape stenciling affect a Heap[T] of pointer-shaped T?
**Short:** All pointer-shaped Ts share one stencil body. The dictionary lookup adds a small per-comparison overhead.

**Long:** For `Heap[*Foo]` and `Heap[*Bar]`, the compiled body is shared. Inside, the `less` call dispatches through the runtime dictionary. For tight inner loops, this can be 10-20% slower than a hand-rolled `*Foo`-only heap. Profile before assuming.

### Q38. Could you implement a persistent (immutable) Tree[T] generically?
**Short:** Yes. Each "mutation" returns a new `*Tree[T]` that shares unchanged subtrees with the original.

**Long:** Persistent data structures are a great fit for generics because the implementation does not depend on `T`. Pattern: Insert returns `(newRoot, prevValue)`. The new root shares subtrees with the old root that were unaffected by the insert. Immutable trees are useful for snapshots and concurrent reads without locks.

### Q39. Why can't methods narrow the constraint of T?
**Short:** Because the spec ties methods to the type. A method that needs `comparable` cannot exist on a type declared with `T any`.

**Long:** The compiler enforces the constraint declared on the type at every method call site. There is no "where T: comparable" extension. The free-function workaround is the only way to add type-class style constraints to specific operations.

### Q40. What surprises do generic data structures introduce in pprof and the debugger?
**Short:** Stenciled bodies show up with mangled names like `pkg.Heap[go.shape.*pkg.Foo].Push`.

**Long:** In `pprof` flame graphs, the GC shape suffix tells you which stencil is hot. For `Heap[*Foo]`, you see `go.shape.*pkg.Foo`. This is helpful for performance analysis (you can identify which T is dominant) but confusing to first-time users. `dlv` handles generics correctly in modern versions but had stack-frame quirks early on.

---

## Summary

Memorize the **short answers** for fluency. Practice the **long answers** for depth. The most common interview themes for generic data structures are:

- Implementing `Stack[T]` from scratch (Q2)
- Why `Set[T]` needs `comparable` (Q3)
- Why pointer receivers (Q6)
- Constructor patterns (Q8, Q16)
- LRU cache implementation (Q21)
- Heap with `less` function (Q22, Q23)
- Constraint leak and the free-function pattern (Q29)
- Thread-safe wrappers (Q17, Q28)

A confident candidate writes `Stack[T]`, `Set[T]`, and `LRU[K, V]` from memory and can articulate **why** each constraint and receiver style was chosen.
