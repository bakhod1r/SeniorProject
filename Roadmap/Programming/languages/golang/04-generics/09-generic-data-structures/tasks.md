# Generic Data Structures — Tasks

## Exercise structure

- 🟢 **Easy** — for beginners
- 🟡 **Medium** — middle level
- 🔴 **Hard** — senior level
- 🟣 **Expert** — professional level

A solution sketch for each exercise is provided at the end. Each task highlights **a real generic data structure pattern** — not just syntax practice.

---

## Easy 🟢

### Task 1 — Stack[T]
Implement `Stack[T any]` with `Push`, `Pop`, `Peek`, `Len`. Test it with `int` and `string`.

### Task 2 — Set[T]
Implement `Set[T comparable]` with `Add`, `Has`, `Remove`, `Len`, `ToSlice`. Why is `comparable` required?

### Task 3 — Bag[T] (multi-set)
Implement a multi-set where each element has a count. `Add(v T)`, `Count(v T) int`, `Remove(v T)`.

### Task 4 — Stack-based reverse
Use `Stack[byte]` to reverse a string. Don't allocate a second slice manually.

### Task 5 — Queue[T] slice version
Implement `Queue[T any]` using a slice. Discuss the dequeue cost.

---

## Medium 🟡

### Task 6 — RingQueue[T]
Build a fixed-capacity ring buffer queue. `Enqueue` returns `false` when full. Compare vs the slice queue.

### Task 7 — LinkedList[T]
Build a doubly linked list with `PushFront`, `PushBack`, `PopFront`, `PopBack`, `Len`, and `ForEach`.

### Task 8 — Pair[K, V]
Define `Pair[K, V any]` with a `Swap()` method. Use it to convert a `map[string]int` into a `[]Pair[string, int]` sorted by key.

### Task 9 — Optional[T]
Build `Optional[T]` with `Some`, `None`, `Get`, `OrElse`, `Map`. Show why it is *not* the same as `*T`.

### Task 10 — Set Union and Intersection
Add `Union[T comparable](a, b *Set[T]) *Set[T]` and `Intersection`. Why are these free functions, not methods?

### Task 11 — Iterator wrapper
Wrap a `LinkedList[T]` with an `Iterator[T]` type that has `Next() (T, bool)` and `Reset()`. Why might this be cleaner than a `ForEach` callback?

### Task 12 — OrderedMap[K, V]
Build a map that preserves insertion order. Iterate yields `Pair[K, V]` in insertion order.

### Task 13 — Multi-level cache
`Cache[K comparable, V any]` with two layers: a fast small map and a slower bigger one. On miss in the small one, fall through.

### Task 14 — Inverted index
`Index[T comparable]` mapping each token to a `Set[ID]` where ID is comparable. Used for full-text search prototypes.

---

## Hard 🔴

### Task 15 — Tree[T] with Walk and Find
Build a generic n-ary tree. Walk in DFS order. `Find(predicate func(T) bool) *Tree[T]`.

### Task 16 — BST[T cmp.Ordered]
Implement `Insert`, `Contains`, `InOrder`. Then make a parallel `BSTFunc[T any]` taking a `less` function. Compare ergonomics.

### Task 17 — Heap[T] (priority queue)
Build a min-heap with a `less` function. Implement `Push`, `Pop`, `Peek`. Test with structs ordered by a field.

### Task 18 — Trie[T] for byte-keyed values
Generic trie that maps `string` keys to `T` values. `Set`, `Get`, `Delete`, `Prefix(p string) []T`.

### Task 19 — Graph[V, E] with BFS and DFS
Build an adjacency-map graph. Implement BFS and DFS as methods that take a visit callback.

### Task 20 — LRU[K, V]
Generic LRU cache with capacity. Doubly linked list plus map. `Get`, `Put`. When over capacity, evict the tail.

---

## Expert 🟣

### Task 21 — Trie[T] reflection-free
Take Task 18 and make it work for `T any` without ever using `reflect`. Discuss what changes when `T` is a pointer.

### Task 22 — BloomFilter[T]
Build `BloomFilter[T any]` with a `hash func(T) uint64` parameter. Add `Insert`, `Contains`, with the standard probabilistic semantics.

### Task 23 — CircularBuffer[T] overwrite-on-full
Like `RingQueue[T]` but `Push` overwrites the oldest element when full instead of failing.

### Task 24 — CowList[T] (copy-on-write)
Slice-backed list that clones the backing array on first mutation after a snapshot was taken. Useful for snapshots.

### Task 25 — Persistent Tree[T]
Immutable tree where `Insert` returns a new tree sharing unchanged subtrees with the old.

### Task 26 — SkipList[T cmp.Ordered]
Probabilistic ordered structure with O(log n) operations. Each node has a randomised level.

---

## Solutions

### Solution 1
```go
type Stack[T any] struct{ data []T }
func (s *Stack[T]) Push(v T) { s.data = append(s.data, v) }
func (s *Stack[T]) Pop() (T, bool) {
    var zero T
    if len(s.data) == 0 { return zero, false }
    n := len(s.data) - 1
    v := s.data[n]; s.data = s.data[:n]
    return v, true
}
func (s *Stack[T]) Peek() (T, bool) {
    var zero T
    if len(s.data) == 0 { return zero, false }
    return s.data[len(s.data)-1], true
}
func (s *Stack[T]) Len() int { return len(s.data) }
```

### Solution 2
```go
type Set[T comparable] struct{ m map[T]struct{} }
func NewSet[T comparable]() *Set[T] { return &Set[T]{m: map[T]struct{}{}} }
func (s *Set[T]) Add(v T)      { s.m[v] = struct{}{} }
func (s *Set[T]) Has(v T) bool { _, ok := s.m[v]; return ok }
func (s *Set[T]) Remove(v T)   { delete(s.m, v) }
func (s *Set[T]) Len() int     { return len(s.m) }
func (s *Set[T]) ToSlice() []T {
    out := make([]T, 0, len(s.m))
    for k := range s.m { out = append(out, k) }
    return out
}
```
`comparable` is required because map keys must support `==`.

### Solution 3
```go
type Bag[T comparable] struct{ m map[T]int }
func NewBag[T comparable]() *Bag[T] { return &Bag[T]{m: map[T]int{}} }
func (b *Bag[T]) Add(v T)        { b.m[v]++ }
func (b *Bag[T]) Count(v T) int  { return b.m[v] }
func (b *Bag[T]) Remove(v T) {
    if b.m[v] > 1 { b.m[v]--; return }
    delete(b.m, v)
}
```

### Solution 4
```go
func Reverse(s string) string {
    st := &Stack[byte]{}
    for i := 0; i < len(s); i++ { st.Push(s[i]) }
    out := make([]byte, 0, len(s))
    for st.Len() > 0 {
        v, _ := st.Pop()
        out = append(out, v)
    }
    return string(out)
}
```

### Solution 5
```go
type Queue[T any] struct{ data []T }
func (q *Queue[T]) Enqueue(v T)      { q.data = append(q.data, v) }
func (q *Queue[T]) Dequeue() (T, bool) {
    var zero T
    if len(q.data) == 0 { return zero, false }
    v := q.data[0]
    q.data[0] = zero
    q.data = q.data[1:]
    return v, true
}
```
Naive dequeue is O(1) amortised but the underlying array's head wastes memory; for long-lived queues use a ring buffer.

### Solution 6
```go
type RingQueue[T any] struct {
    data       []T
    head, tail int
    size       int
}
func NewRingQueue[T any](cap int) *RingQueue[T] {
    return &RingQueue[T]{data: make([]T, cap)}
}
func (q *RingQueue[T]) Enqueue(v T) bool {
    if q.size == len(q.data) { return false }
    q.data[q.tail] = v
    q.tail = (q.tail + 1) % len(q.data)
    q.size++
    return true
}
func (q *RingQueue[T]) Dequeue() (T, bool) {
    var zero T
    if q.size == 0 { return zero, false }
    v := q.data[q.head]
    q.data[q.head] = zero
    q.head = (q.head + 1) % len(q.data)
    q.size--
    return v, true
}
```

### Solution 7
```go
type listNode[T any] struct{ value T; prev, next *listNode[T] }
type LinkedList[T any] struct{ head, tail *listNode[T]; size int }

func (l *LinkedList[T]) PushBack(v T) {
    n := &listNode[T]{value: v, prev: l.tail}
    if l.tail != nil { l.tail.next = n } else { l.head = n }
    l.tail = n; l.size++
}
func (l *LinkedList[T]) PushFront(v T) {
    n := &listNode[T]{value: v, next: l.head}
    if l.head != nil { l.head.prev = n } else { l.tail = n }
    l.head = n; l.size++
}
func (l *LinkedList[T]) ForEach(f func(T)) {
    for n := l.head; n != nil; n = n.next { f(n.value) }
}
func (l *LinkedList[T]) Len() int { return l.size }
```

### Solution 8
```go
type Pair[K, V any] struct{ First K; Second V }
func (p Pair[K, V]) Swap() Pair[V, K] {
    return Pair[V, K]{First: p.Second, Second: p.First}
}

import "sort"
func Entries[V any](m map[string]V) []Pair[string, V] {
    out := make([]Pair[string, V], 0, len(m))
    for k, v := range m { out = append(out, Pair[string, V]{k, v}) }
    sort.Slice(out, func(i, j int) bool { return out[i].First < out[j].First })
    return out
}
```

### Solution 9
```go
type Optional[T any] struct{ v T; present bool }
func Some[T any](v T) Optional[T] { return Optional[T]{v, true} }
func None[T any]() Optional[T]    { return Optional[T]{} }
func (o Optional[T]) Get() (T, bool) { return o.v, o.present }
func (o Optional[T]) OrElse(d T) T {
    if o.present { return o.v }
    return d
}
func (o Optional[T]) Map(f func(T) T) Optional[T] {
    if !o.present { return o }
    return Some(f(o.v))
}
```
`*T` cannot distinguish "absent" from "a nil-valued pointer". `Optional[T]` carries an explicit flag.

### Solution 10
```go
func Union[T comparable](a, b *Set[T]) *Set[T] {
    out := NewSet[T]()
    for k := range a.m { out.Add(k) }
    for k := range b.m { out.Add(k) }
    return out
}
func Intersection[T comparable](a, b *Set[T]) *Set[T] {
    out := NewSet[T]()
    for k := range a.m { if b.Has(k) { out.Add(k) } }
    return out
}
```
Free functions because methods cannot declare their own type parameters and don't need to here either.

### Solution 11
```go
type Iterator[T any] struct {
    list *LinkedList[T]
    cur  *listNode[T]
}
func NewIter[T any](l *LinkedList[T]) *Iterator[T] {
    return &Iterator[T]{list: l, cur: l.head}
}
func (it *Iterator[T]) Next() (T, bool) {
    var zero T
    if it.cur == nil { return zero, false }
    v := it.cur.value
    it.cur = it.cur.next
    return v, true
}
func (it *Iterator[T]) Reset() { it.cur = it.list.head }
```
Cleaner than `ForEach` when you need to interleave iteration with other state changes.

### Solution 12
```go
type OrderedMap[K comparable, V any] struct {
    m    map[K]V
    keys []K
}
func NewOrderedMap[K comparable, V any]() *OrderedMap[K, V] {
    return &OrderedMap[K, V]{m: map[K]V{}}
}
func (om *OrderedMap[K, V]) Set(k K, v V) {
    if _, ok := om.m[k]; !ok {
        om.keys = append(om.keys, k)
    }
    om.m[k] = v
}
func (om *OrderedMap[K, V]) ForEach(f func(K, V)) {
    for _, k := range om.keys { f(k, om.m[k]) }
}
```

### Solution 13
```go
type Cache[K comparable, V any] struct {
    fast map[K]V
    slow map[K]V
    fastCap int
}
func (c *Cache[K, V]) Get(k K) (V, bool) {
    if v, ok := c.fast[k]; ok { return v, true }
    if v, ok := c.slow[k]; ok {
        if len(c.fast) < c.fastCap { c.fast[k] = v }
        return v, true
    }
    var zero V; return zero, false
}
```

### Solution 14
```go
type Index[Tok comparable, ID comparable] struct {
    inv map[Tok]*Set[ID]
}
func NewIndex[Tok, ID comparable]() *Index[Tok, ID] {
    return &Index[Tok, ID]{inv: map[Tok]*Set[ID]{}}
}
func (idx *Index[Tok, ID]) Add(tok Tok, id ID) {
    s, ok := idx.inv[tok]
    if !ok { s = NewSet[ID](); idx.inv[tok] = s }
    s.Add(id)
}
func (idx *Index[Tok, ID]) Lookup(tok Tok) *Set[ID] { return idx.inv[tok] }
```

### Solution 15
```go
type Tree[T any] struct{ Value T; Children []*Tree[T] }
func (t *Tree[T]) AddChild(v T) *Tree[T] {
    c := &Tree[T]{Value: v}
    t.Children = append(t.Children, c)
    return c
}
func (t *Tree[T]) Walk(f func(T)) {
    if t == nil { return }
    f(t.Value)
    for _, c := range t.Children { c.Walk(f) }
}
func (t *Tree[T]) Find(pred func(T) bool) *Tree[T] {
    if t == nil { return nil }
    if pred(t.Value) { return t }
    for _, c := range t.Children {
        if r := c.Find(pred); r != nil { return r }
    }
    return nil
}
```

### Solution 16
See `senior.md` for `BST[T cmp.Ordered]`. The `BSTFunc` variant replaces every `<` and `>` with `t.less(a, b)` calls, and adds a `less func(a, b T) bool` field.

### Solution 17
See `senior.md` for `Heap[T]` with `less func(a, b T) bool`.

### Solution 18
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
        if n.children == nil { var zero T; return zero, false }
        c, ok := n.children[k[i]]
        if !ok { var zero T; return zero, false }
        n = c
    }
    return n.value, n.has
}
```

### Solution 19
See `senior.md` for `Graph[V, E]` with BFS. DFS follows the same pattern using a stack instead of a queue.

### Solution 20
See `interview.md` Q21 for the LRU sketch. Full code includes `moveToFront`, `addToFront`, and `evictTail` helpers.

### Solution 21
The trie in Solution 18 is already reflection-free. When `T` is a pointer, the only difference is that `var zero T` returns a typed `nil` pointer.

### Solution 22
```go
type BloomFilter[T any] struct {
    bits []uint64
    k    int
    hash func(T) uint64
}
func NewBloom[T any](size, k int, hash func(T) uint64) *BloomFilter[T] {
    return &BloomFilter[T]{bits: make([]uint64, (size+63)/64), k: k, hash: hash}
}
func (b *BloomFilter[T]) Insert(v T) {
    h := b.hash(v)
    for i := 0; i < b.k; i++ {
        idx := (h + uint64(i)*0x9E3779B97F4A7C15) % uint64(len(b.bits)*64)
        b.bits[idx/64] |= 1 << (idx % 64)
    }
}
func (b *BloomFilter[T]) Contains(v T) bool {
    h := b.hash(v)
    for i := 0; i < b.k; i++ {
        idx := (h + uint64(i)*0x9E3779B97F4A7C15) % uint64(len(b.bits)*64)
        if b.bits[idx/64]&(1<<(idx%64)) == 0 { return false }
    }
    return true
}
```

### Solution 23
```go
type CircularBuffer[T any] struct {
    data       []T
    head, size int
}
func NewCircular[T any](cap int) *CircularBuffer[T] {
    return &CircularBuffer[T]{data: make([]T, cap)}
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

### Solution 24
```go
type CowList[T any] struct {
    data   []T
    shared bool
}
func (l *CowList[T]) Snapshot() *CowList[T] {
    l.shared = true
    return &CowList[T]{data: l.data, shared: true}
}
func (l *CowList[T]) Append(v T) {
    if l.shared {
        l.data = append([]T(nil), l.data...)
        l.shared = false
    }
    l.data = append(l.data, v)
}
```

### Solution 25
```go
type PTree[T cmp.Ordered] struct {
    value       T
    left, right *PTree[T]
}
func (t *PTree[T]) Insert(v T) *PTree[T] {
    if t == nil { return &PTree[T]{value: v} }
    if v < t.value {
        return &PTree[T]{value: t.value, left: t.left.Insert(v), right: t.right}
    }
    if v > t.value {
        return &PTree[T]{value: t.value, left: t.left, right: t.right.Insert(v)}
    }
    return t
}
```
Each insert returns a new root sharing untouched subtrees.

### Solution 26
A skip list is too long to fit here, but the structure is:
```go
type slNode[T cmp.Ordered] struct {
    value T
    forward []*slNode[T]
}
type SkipList[T cmp.Ordered] struct {
    head     *slNode[T]
    maxLevel int
    p        float64
}
```
`Insert` picks a random level (geometric distribution with parameter `p`) and threads the node into all levels at and below it. Search walks forward at each level until it overshoots, then drops down.

---

## Final notes

These tasks build the muscles for **real** generic data structure work. The recurring lessons:

1. **Constraints follow operations.** `any` for stack, `comparable` for set keys, `cmp.Ordered` (or `less`) for ordered structures.
2. **Pointer receivers** for any container that mutates.
3. **Free functions** for binary operations and constraint-tighter helpers.
4. **`var zero T`** is the universal zero-value idiom inside generic methods.
5. **Composition over god types** — `ConcurrentSet[T]` wrapping `Set[T]` beats one type with `mu sync.Mutex` baked in.

Work through the easier tasks first; the senior and expert tasks reward time spent on the basics.
