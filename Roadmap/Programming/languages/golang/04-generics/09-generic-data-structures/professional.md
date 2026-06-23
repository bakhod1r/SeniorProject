# Generic Data Structures — Professional Level

## Table of Contents
1. [The stdlib `container/*` packages](#the-stdlib-container-packages)
2. [`container/heap` vs a generic Heap[T]](#containerheap-vs-a-generic-heapt)
3. [`container/list` vs a generic LinkedList[T]](#containerlist-vs-a-generic-linkedlistt)
4. [`container/ring` vs a generic RingBuffer[T]](#containerring-vs-a-generic-ringbuffert)
5. [When to ship a generic library](#when-to-ship-a-generic-library)
6. [When to use stdlib](#when-to-use-stdlib)
7. [Library API design checklist](#library-api-design-checklist)
8. [Real-world generic container libraries](#real-world-generic-container-libraries)
9. [Summary](#summary)

---

## The stdlib `container/*` packages

Go ships three container packages from the pre-generics era:

| Package | What it gives you | API style |
|---------|-------------------|-----------|
| `container/heap` | Priority queue | Interface-based, requires user wrapper |
| `container/list` | Doubly linked list | Operates on `any`-typed elements |
| `container/ring` | Circular list | Operates on `any`-typed elements |

All three are **frozen** in the post-generics era — the Go team chose not to genericize them. Why? Backwards compatibility, plus uncertainty about the right shape for a generic API.

For new code, you have three options:

1. **Use the stdlib container** — accept the `any` boxing and assertions
2. **Write your own generic container** — full type safety, more code to maintain
3. **Use a community library** — type safety, external dependency

A senior engineer chooses among these consciously.

---

## `container/heap` vs a generic Heap[T]

### The stdlib API

```go
type Interface interface {
    sort.Interface
    Push(x any)
    Pop() any
}

// Using it requires a wrapper type
type IntHeap []int
func (h IntHeap) Len() int           { return len(h) }
func (h IntHeap) Less(i, j int) bool { return h[i] < h[j] }
func (h IntHeap) Swap(i, j int)      { h[i], h[j] = h[j], h[i] }
func (h *IntHeap) Push(x any)        { *h = append(*h, x.(int)) }
func (h *IntHeap) Pop() any {
    old := *h
    n := len(old)
    x := old[n-1]
    *h = old[0 : n-1]
    return x
}

// Now use heap.Push, heap.Pop, etc.
h := &IntHeap{2, 1, 5}
heap.Init(h)
heap.Push(h, 3)
v := heap.Pop(h).(int) // type assertion required
```

Boilerplate per element type:
- 5 method definitions
- A type assertion on every `Pop`
- Boxing on every `Push` (`x any`)

### The generic alternative

```go
type Heap[T any] struct {
    data []T
    less func(a, b T) bool
}
// Push, Pop, up, down — see senior.md

h := NewHeap[int](cmp.Less[int])
h.Push(2); h.Push(1); h.Push(5)
v, _ := h.Pop() // v is int — no assertion
```

### Trade-off matrix

| Aspect | `container/heap` | Generic `Heap[T]` |
|--------|------------------|-------------------|
| Boilerplate | High | Low |
| Type safety | Runtime assertions | Compile-time |
| Boxing | Yes (`any`) | No |
| Familiarity | Universal | New to most users |
| Performance (numeric) | Slower | Faster |
| Performance (pointer T) | Comparable | Comparable |

**Recommendation:** for new code that will be touched by multiple engineers, ship a generic heap. For one-off internal scripts, `container/heap` is fine because the boilerplate is contained.

### Why the stdlib didn't genericize

The Go team had three concerns:

1. **Compat:** the existing API has many users; changing it risks breakage.
2. **Right shape:** is the comparator a constraint (`cmp.Ordered`), a function, or an interface? The community has not converged.
3. **Subjective taste:** the stdlib team prefers minimal API surface; a fully generic heap with multiple comparator styles bloats it.

A **third-party** generic heap can experiment freely — and several do (see "Real-world generic container libraries" below).

---

## `container/list` vs a generic LinkedList[T]

### The stdlib API

```go
import "container/list"

l := list.New()
l.PushBack(42)
l.PushBack("hello") // also accepted!
for e := l.Front(); e != nil; e = e.Next() {
    fmt.Println(e.Value) // any — assert to use
}
```

The `Element.Value` field is `any`. You can mix types, which is rarely what you want, and you must assert on every read.

### The generic alternative

```go
type LinkedList[T any] struct{ /* see middle.md */ }

l := &LinkedList[int]{}
l.PushBack(42)
// l.PushBack("hello") // ❌ does not compile
l.ForEach(func(v int) { fmt.Println(v) })
```

Compile-time enforcement of element type. No assertions.

### When `container/list` still wins

- **Sorted insertion via `MoveBefore`/`MoveAfter`** is built in.
- **The element type can change** mid-list if you really need that (rare, usually a code smell).
- **Existing code already uses it** — adding a parallel generic version is overkill.

For new code, prefer a generic linked list every time. Iteration with Go 1.23 `iter.Seq[T]` makes the generic version even more ergonomic than the stdlib.

---

## `container/ring` vs a generic RingBuffer[T]

`container/ring` is a circular **list** (not a ring buffer for queueing). Each element holds an `any` value. Use cases include:

- Fixed-size cyclic structures
- Round-robin selection
- Cyclic redo buffers

```go
import "container/ring"

r := ring.New(5)
for i := 0; i < r.Len(); i++ {
    r.Value = i
    r = r.Next()
}
```

### The generic alternative

```go
type Ring[T any] struct {
    data []T
    pos  int
}

func NewRing[T any](size int) *Ring[T] {
    return &Ring[T]{data: make([]T, size)}
}

func (r *Ring[T]) Set(v T)       { r.data[r.pos] = v }
func (r *Ring[T]) Next()         { r.pos = (r.pos + 1) % len(r.data) }
func (r *Ring[T]) Value() T      { return r.data[r.pos] }
```

Same shape, type-safe.

### Practical guidance

`container/ring` is rarely used in modern Go code. For ring-buffer **queue** semantics, see the `RingQueue[T]` from `middle.md`. For cyclic iteration, a small generic struct is just as clean as the stdlib.

---

## When to ship a generic library

You have a generic data structure inside your project. Should you publish it as a library?

### Ship if

1. **It is a primitive** every Go programmer needs (LRU cache, set, ordered map).
2. **The API has stabilised** over at least three real users.
3. **You can commit to maintenance** — bug fixes, Go version updates, godoc.
4. **No suitable library exists** — check `pkg.go.dev` first.
5. **Your team uses it across multiple repos** — extracting it pays off.

### Do not ship if

1. **It is internal** to one product. Keep it in `internal/`.
2. **It is one method shy of `slices`/`maps`** — propose adding it to stdlib instead.
3. **It mixes business logic** with the container. Decouple first.
4. **You are still iterating** on the API. Wait until you would be embarrassed by the next change.

### How to ship

The Hashicorp model is the gold standard:

1. Module path with explicit major version (`github.com/you/lib/v2`).
2. Generic-only API, Go 1.21+ (for stdlib `slices`/`maps`/`cmp`).
3. README with a 5-line "before/after" comparison.
4. Examples for the two or three most common use cases.
5. Benchmarks against stdlib equivalents.

---

## When to use stdlib

Sometimes the boring choice is right.

### Use `container/heap` when

- You are already importing it
- The wrapper boilerplate is not in a hot path
- Backwards compatibility with Go 1.17 matters

### Use `container/list` when

- You want `Element` references that survive across operations
- You need `MoveBefore`/`MoveAfter`
- You truly want `any`-typed mixed elements (rare, suspicious)

### Use `container/ring` when

- You need a circular list with explicit `Next`/`Prev`
- You want no allocations during rotation

### Default to generic for new code

For greenfield code in Go 1.21+, generic versions are simpler at the call site, faster on numeric types, and type-safe. The stdlib `container/*` packages are now mostly **legacy** — usable, but rarely the best tool.

---

## Library API design checklist

Before publishing a generic container library:

- [ ] Pick **one** comparator style (`cmp.Ordered`, function, both) and document it.
- [ ] Constructor returns a pointer (`*MyContainer[T]`).
- [ ] Mutating methods use pointer receivers; pure functions are free functions.
- [ ] `(T, bool)` returns for "may not exist" — not panics.
- [ ] No method-level type parameters (Go forbids them).
- [ ] Iteration: `ToSlice`, `ForEach`, optionally `iter.Seq[T]` (build-tagged for 1.23+).
- [ ] Document concurrency: "not safe for concurrent use" or "safe for concurrent reads".
- [ ] Benchmarks against stdlib and against `interface{}`-based equivalents.
- [ ] At least one type test (`TestStack_Strings`) and one interface test (`TestStack_Pointers`).
- [ ] Examples for each type-parameter shape (numeric, string, struct).
- [ ] godoc with type parameter explanation in the package doc.
- [ ] Semantic version `v1.0.0` only after API has been stable for at least one release.

---

## Real-world generic container libraries

A non-exhaustive list, current as of 2026:

| Library | Coverage | Notes |
|---------|----------|-------|
| `golang.org/x/exp/maps` | Map utilities | Many functions promoted to stdlib `maps` in 1.21 |
| `golang.org/x/exp/slices` | Slice utilities | Promoted to stdlib `slices` in 1.21 |
| `golang.org/x/exp/constraints` | `Integer`, `Float`, etc. | Most users only need `cmp.Ordered` from stdlib now |
| `hashicorp/golang-lru/v2` | LRU, ARC, 2Q caches | Production-grade, used in Vault and Terraform |
| `deckarep/golang-set/v2` | Set with rich methods | Most polished generic set library |
| `samber/lo` | Lodash-style helpers | Big surface, opinionated |
| `elliotchance/orderedmap/v2` | Ordered map | Maintains insertion order |
| `puzpuzpuz/xsync/v3` | Concurrent maps and counters | Lock-free, generic |
| `gammazero/deque` | Fast double-ended queue | Generic since 2022 |

Most projects pick **two or three** of these and write the rest in-house. Watch out for libraries that have **not** updated their generics API since 1.18 — they often miss `cmp.Ordered` and use a custom `Ordered` constraint.

### What is still missing

As of 2026, the Go ecosystem has no clear winner for:

- Generic concurrent priority queues
- Generic skip lists
- Generic persistent (immutable) trees and lists
- Generic on-disk B-trees

Each has multiple competing libraries with different APIs. If your team needs one, expect to evaluate three options and pick the smallest one with a known maintainer.

### Notes on `samber/lo`

`samber/lo` ports many JavaScript/Lodash idioms to Go generics:

```go
import "github.com/samber/lo"

doubled := lo.Map([]int{1, 2, 3}, func(v int, _ int) int { return v * 2 })
```

Some teams love it; others find it un-Go-idiomatic. A common compromise: use it in application code where ergonomics dominate, avoid it in library code where small dependencies matter.

---

## Summary

The professional view of generic data structures has three layers:

1. **Stdlib `container/*`** — still works, still useful, increasingly legacy. Use it when its API fits your problem and the boxing/assertions are not in a hot path.
2. **Hand-written generics** — for primitives that match your domain. The cost is maintenance; the benefit is full control.
3. **Community libraries** — `hashicorp/golang-lru/v2`, `deckarep/golang-set/v2`, etc. Use them when they save real code and the maintainer is reliable.

The migration from `container/*` to generic equivalents is **not a stampede** — it is a gradual replacement as old code is rewritten. New code should default to generic. Old code stays on the stdlib until there is a real reason to change.

If you are about to ship your own generic container library, the checklist above is your friend. If you are about to use someone else's, look at maintenance cadence, godoc coverage, and benchmark numbers before importing.

The biggest practical lesson: **generics did not eliminate `container/*`; they added a parallel layer**. Knowing both is part of what makes a Go engineer professional in the 1.18+ world.

Move on to `specification.md` for the formal grammar of generic type declarations.
