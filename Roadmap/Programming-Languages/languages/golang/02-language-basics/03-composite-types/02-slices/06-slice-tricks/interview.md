# Slice Tricks — Interview Questions

A set of interview-style questions on Go slice tricks (the SliceTricks wiki idioms) and the modern `slices` package, with concise but complete answers.

---

## Q1. Implement insert at index `i` without using `slices.Insert`.

```go
s = append(s[:i], append([]T{x}, s[i:]...)...)
```

Reading inside-out: build a fresh slice `[x, s[i], s[i+1], ...]`, then append it to `s[:i]`. Allocates the literal `[]T{x}` always (one alloc); may allocate again at the outer `append` if `cap(s)` doesn't fit `len(s)+1`. Time O(n−i). Equivalent to `slices.Insert(s, i, x)` but with one extra allocation.

---

## Q2. Why does this delete leak memory for `[]*User`?

```go
users = append(users[:i], users[i+1:]...)
```

The `append` left-shifts elements `[i+1:]` into positions starting at `i`, then the new `len` is `len(users)-1`. But the backing array's last slot still holds the **old** `*User` pointer (a duplicate of `users[len(users)-2]`). That pointer keeps the `User` GC-reachable through the backing array even though it's no longer reachable through `users`. Fix:

```go
copy(users[i:], users[i+1:])
clear(users[len(users)-1:])   // or: users[len(users)-1] = nil
users = users[:len(users)-1]
```

`slices.Delete` does the `clear` step automatically as of Go 1.22.

---

## Q3. Rewrite using Go 1.21 `slices`:

```go
s = append(s[:i], append([]T{x}, s[i:]...)...)
```

```go
s = slices.Insert(s, i, x)
```

`slices.Insert` shifts the tail right in place when capacity permits (zero allocations) and falls back to one allocation if growth is required. The wiki trick always pays one allocation for the `[]T{x}` literal.

---

## Q4. Implement swap-and-pop delete. When is it correct to use?

```go
s[i] = s[len(s)-1]
s = s[:len(s)-1]
```

For pointer-element types, zero the now-dead slot before re-slicing.

Correct **only when element order doesn't matter**: free lists, particle systems, hash-table buckets, membership sets. Use cases where the elements are conceptually unordered. The trick is O(1) vs O(n−i) for order-preserving delete.

---

## Q5. What is `s[:len(s):len(s)]` and why use it?

A **three-index slice expression** that returns a header with `len == cap == len(s)`. The returned slice shares the backing array with `s` but its `cap` is full — any `append` on it must allocate a new array. Use it to return a "scoped clone" from an API: the caller can't accidentally grow the slice into your private backing storage. Header trick only; no data copied.

Compare:

```go
out := s[:len(s)]        // cap unchanged; caller's append may stomp s's tail
out := s[:len(s):len(s)] // cap shrunk; caller's append always allocates
out := slices.Clone(s)   // full data copy; caller has independent backing
```

---

## Q6. Why is `s = append([]T{x}, s...)` slow as a push-front primitive?

Two reasons:

1. Always allocates the literal `[]T{x}` (one alloc) and the outer `append` allocates a new backing array of cap ≥ `len(s)+1` (second alloc).
2. Copies all `len(s)` elements every time.

Total: 2 allocations and O(n) work per push-front. For a real deque, use a ring buffer (constant-amortized push and pop at both ends).

---

## Q7. Rotate a slice left by `k` in place.

The three-reverses trick:

```go
func rotateLeft[T any](s []T, k int) {
    if len(s) == 0 {
        return
    }
    k %= len(s)
    if k < 0 {
        k += len(s)
    }
    slices.Reverse(s[:k])
    slices.Reverse(s[k:])
    slices.Reverse(s)
}
```

Allocates nothing; does about `1.5n` element writes. Intuition: `(A·B)^R = B^R · A^R`, so reversing the two halves then the whole thing yields `B · A`.

---

## Q8. Implement Fisher–Yates shuffle.

```go
import "math/rand/v2"

for i := len(s) - 1; i > 0; i-- {
    j := rand.IntN(i + 1)
    s[i], s[j] = s[j], s[i]
}
```

Each element ends up in each position with equal probability. In-place, O(n). `rand.Shuffle(len(s), func(i, j int) { s[i], s[j] = s[j], s[i] })` is the stdlib equivalent.

---

## Q9. Filter in place vs filter with a new slice — when do you pick which?

```go
// in place
n := 0
for _, x := range s {
    if keep(x) { s[n] = x; n++ }
}
clear(s[n:])   // for pointer types
s = s[:n]

// new slice
out := make([]T, 0, len(s))
for _, x := range s {
    if keep(x) { out = append(out, x) }
}
```

In-place: zero allocations, but mutates the caller's slice. Use when the caller expects mutation or when the slice is a private hot-path buffer.

New slice: one allocation, leaves input untouched. Use when the input must remain unchanged (concurrent readers, public API).

`slices.DeleteFunc(s, func(x T) bool { return !keep(x) })` is the Go 1.21+ in-place form and zeros pointer tails in Go 1.22+.

---

## Q10. What's wrong with this loop?

```go
for i, x := range s {
    if shouldDelete(x) {
        s = slices.Delete(s, i, i+1)
    }
}
```

`range s` snapshots `len(s)` at the start. After `Delete`, the loop variable `i` advances past the new end and `x` is stale. The loop runs past the new tail and either panics or skips elements.

Fixes:

1. Iterate backwards: `for i := len(s) - 1; i >= 0; i--`.
2. `s = slices.DeleteFunc(s, shouldDelete)`.
3. Collect indices, delete in a separate backwards pass.

---

## Q11. Dedupe an unsorted `[]string`, preserving order.

```go
seen := make(map[string]struct{}, len(s))
n := 0
for _, x := range s {
    if _, ok := seen[x]; !ok {
        seen[x] = struct{}{}
        s[n] = x
        n++
    }
}
clear(s[n:])
s = s[:n]
```

One map allocation, O(n) average. `slices.Compact` won't work — it only deduplicates adjacent equal elements, and the slice isn't sorted.

If you can afford to reorder: `slices.Sort(s); s = slices.Compact(s)` is zero allocations but O(n log n).

---

## Q12. Flatten `[][]T` into `[]T` with the minimum number of allocations.

```go
total := 0
for _, inner := range s {
    total += len(inner)
}
out := make([]T, 0, total)
for _, inner := range s {
    out = append(out, inner...)
}
```

One pass to size, one pass to copy. Exactly one allocation. Go 1.22+ has `slices.Concat(s...)` which does the same internally.

---

## Q13. Why is a slice as a long-running FIFO queue a leak?

```go
q = append(q, x)   // push back
x, q = q[0], q[1:]  // pop front
```

Pop front advances the slice's `Data` pointer but leaves the popped slot in the original backing array. The backing array stays GC-reachable through the new `q.Data` (which points into it). Over time the slice keeps growing (push beyond cap → realloc) and the "dead zone" of popped slots before `q.Data` keeps growing too. For pointer-element slices this means popped values stay alive forever.

Fix: use a ring buffer. Backing storage is bounded by max queue depth, popped slots are explicitly zeroed.

---

## Q14. Implement a generic ring buffer with push, pop, len, cap.

```go
type Ring[T any] struct {
    buf   []T
    head, tail, n int
}

func NewRing[T any](cap int) *Ring[T] {
    if cap < 1 { cap = 1 }
    return &Ring[T]{buf: make([]T, cap)}
}

func (r *Ring[T]) Push(x T) {
    if r.n == len(r.buf) { r.grow() }
    r.buf[r.tail] = x
    r.tail = (r.tail + 1) % len(r.buf)
    r.n++
}

func (r *Ring[T]) Pop() (T, bool) {
    var zero T
    if r.n == 0 { return zero, false }
    x := r.buf[r.head]
    r.buf[r.head] = zero
    r.head = (r.head + 1) % len(r.buf)
    r.n--
    return x, true
}

func (r *Ring[T]) Len() int { return r.n }
func (r *Ring[T]) Cap() int { return len(r.buf) }

func (r *Ring[T]) grow() {
    nb := make([]T, len(r.buf)*2)
    if r.head < r.tail {
        copy(nb, r.buf[r.head:r.tail])
    } else {
        m := copy(nb, r.buf[r.head:])
        copy(nb[m:], r.buf[:r.tail])
    }
    r.buf = nb
    r.head, r.tail = 0, r.n
}
```

Push and pop are amortized O(1). Backing storage is O(max depth), never grows past that. Popped slots are zeroed.

---

## Q15. What does `clear` do that a manual loop doesn't?

`clear(s[n:])` zeroes every element in the sub-slice using the runtime's `memclr` for blittable types or a write-barrier-aware sequence for pointer types — the compiler picks the right one based on `T`. The manual loop:

```go
for i := n; i < len(s); i++ {
    var zero T
    s[i] = zero
}
```

is equivalent in semantics but harder to read and may not always inline as efficiently. `clear` (Go 1.21+) is the modern idiom. It also handles maps (`clear(m)` empties the map).

---

## Q16. What's wrong with `out := s[:3]; out = append(out, 99)` if you expected `s` to be unchanged?

`out` had `len=3` but inherited `cap` from `s` (say cap=5). `append(out, 99)` finds room in the existing backing array and writes `99` into `s[3]`. The "append to a sub-slice" silently mutated `s`. Defenses:

```go
out := s[:3:3]            // scoped clone; append must allocate
out := slices.Clone(s[:3]) // full clone; append on isolated array
```

---

## Q17. Compare `slices.Clone(s)` and `append([]T(nil), s...)`.

Effectively identical: both allocate a new backing array of capacity `len(s)` and copy all elements. `slices.Clone` is the readable form, internally implemented as `append([]T(nil), s...)`. One allocation, O(n) copy.

`copy(out, s)` after `out := make([]T, len(s))` is the third equivalent form. All three produce the same observable result.

---

## Q18. What does `slices.Grow(s, n)` do?

Ensures `cap(s) >= len(s) + n`. If the current cap is sufficient, returns `s` unchanged. Otherwise allocates a new backing array of sufficient capacity, copies all existing elements over, and returns a new slice header with `len = len(s)` and `cap >= len(s) + n`. Use it before a known-size series of `append`s to prevent multiple intermediate growths.

```go
s = slices.Grow(s, 1000)   // now cap is at least len(s) + 1000
for _, x := range source {
    s = append(s, x)        // never reallocates inside this loop
}
```

---

## Q19. Why doesn't `slices.Compact` work on unsorted input?

It only removes **adjacent equal** elements:

```go
slices.Compact([]int{1, 1, 2, 1, 3, 3, 4}) == []int{1, 2, 1, 3, 4}
```

The two non-adjacent `1`s remain because they have a `2` between them. To dedupe non-adjacent equals, either sort first (`slices.Sort(s); s = slices.Compact(s)`) or use a map-based loop.

---

## Q20. Implement `chunk` that returns `[][]T` of sub-slices, sharing the backing array of `s`.

```go
func chunk[T any](s []T, k int) [][]T {
    if k <= 0 { return nil }
    out := make([][]T, 0, (len(s)+k-1)/k)
    for i := 0; i < len(s); i += k {
        end := i + k
        if end > len(s) { end = len(s) }
        out = append(out, s[i:end])
    }
    return out
}
```

Each chunk is a sub-slice header pointing into `s`'s backing array — no data copy. Caller's mutation of a chunk affects `s`. Go 1.23+ has `slices.Chunk(s, k)` returning an iterator, allocating zero outer slices.

---

## Q21. How do you cheaply check if two slices have the same elements in the same order?

```go
slices.Equal(a, b)
```

O(n) comparison with early exit on length mismatch or first differing element. Zero allocations. For element types that aren't `comparable`, use `slices.EqualFunc(a, b, equal)`.

---

## Q22. How would you implement an LRU eviction list using slice tricks?

A naive slice LRU does move-to-front on access (O(n) shift) and pop-back on eviction. For a real LRU, use a doubly-linked list (`container/list`) plus a `map[K]*list.Element` — O(1) for both operations.

If you must use a slice for cache locality, use a small N (≤ 64) so the O(n) move-to-front is acceptable. The reason `container/list` is the standard LRU substrate despite its overhead: O(1) reorders dominate as N grows.

---

## Q23. What does this code do?

```go
s = s[:cap(s)]
```

Extends the slice's `len` to its `cap`. Useful when you've shrunk a slice with `s = s[:n]` but want to expose the trailing capacity (e.g., for a buffer reuse pattern). The trailing elements may hold whatever was last written there; they are not zeroed. Combine with `clear(s[oldLen:])` if you want a clean reusable buffer.

---

## Q24. How do you delete many elements from a slice efficiently?

Build a predicate or set; one pass; one write per kept element.

```go
toDel := map[int]struct{}{1: {}, 3: {}, 5: {}}

s = slices.DeleteFunc(s, func(x int) bool {
    _, drop := toDel[x]
    return drop
})
```

One O(n) pass instead of O(n·m) one-by-one deletes. `slices.DeleteFunc` zeroes the tail for pointer types in Go 1.22+.

---

## Q25. What's the difference between `slices.Compact` and `slices.CompactFunc`?

`slices.Compact[E comparable](s []E)` uses `==` to compare adjacent elements. Works only when `E` is `comparable`.

`slices.CompactFunc[E any](s []E, eq func(E, E) bool)` accepts a custom equality predicate. Use it when the equality is a field of a struct, or when `E` isn't `comparable` (e.g., a slice or map).

```go
s = slices.CompactFunc(users, func(a, b User) bool { return a.ID == b.ID })
```

---

## Q26. Implement a stack using a slice, including peek.

```go
type Stack[T any] struct{ data []T }

func (s *Stack[T]) Push(x T) { s.data = append(s.data, x) }
func (s *Stack[T]) Pop() (T, bool) {
    var zero T
    if len(s.data) == 0 { return zero, false }
    n := len(s.data) - 1
    x := s.data[n]
    s.data[n] = zero       // pointer-safe
    s.data = s.data[:n]
    return x, true
}
func (s *Stack[T]) Peek() (T, bool) {
    var zero T
    if len(s.data) == 0 { return zero, false }
    return s.data[len(s.data)-1], true
}
func (s *Stack[T]) Len() int { return len(s.data) }
```

Push amortized O(1); pop and peek O(1). Backing storage is bounded by the max depth ever reached. No leak because we zero the popped slot.

---

## Q27. Why is `clear(s)` (without sub-slice) sometimes preferable to `s = s[:0]`?

`s = s[:0]` resets `len` to 0 but **does not modify the underlying elements** — they remain reachable through the backing array (which is still referenced by `s.Data`). For pointer-element slices, the popped values are still GC-rooted.

`clear(s)` zeroes every element in `s`, releasing all GC roots, then you can do `s = s[:0]` (or not, since `clear` doesn't change `len`).

For non-pointer types, both are equivalent in effect (no GC roots to release); use `s = s[:0]` for the cap-preserving reuse pattern.

---

## Q28. When would you use `iter.Seq[T]` instead of returning a `[]T`?

When the caller iterates and doesn't need random access, length, or storage. Pros:

- Zero allocation of the outer slice.
- Lazy evaluation — caller can `break` early.
- Decouples storage from API.

Cons:

- One-pass — can't iterate twice without re-calling the function.
- No `len`, no index access.
- Slightly heavier per-element cost (closure call).

Use case: read-only views over internal state, paginated streams, transformed sequences.

---

## Q29. Why does `append(s, v...)` to a `nil` slice work?

`nil` is a valid zero-value slice with `Data=nil, Len=0, Cap=0`. `append` checks cap, sees 0, allocates a new backing array, copies the appended elements in, and returns a new header. Equivalent to starting from `make([]T, 0)`. The asymmetry (nil-receiver `append`) is one of Go's smartest small design decisions: it removes a lot of special-case `if s == nil` code.

---

## Q30. What's the asymptotic cost of `slices.Insert(s, 0, x)` for `n` calls?

Each call shifts `n` elements right (worst case) and possibly reallocates. Across `n` calls starting from an empty slice, that's O(n²) work — quadratic.

If you need to push front many times, **don't use a slice**. Use a deque (double-ended ring buffer) where push-front is amortized O(1).

```go
// Quadratic: avoid
for _, x := range items {
    s = slices.Insert(s, 0, x)
}

// Better: append, then reverse
for _, x := range items {
    s = append(s, x)
}
slices.Reverse(s)   // same final order, total O(n)
```

The "append then reverse" trick is the standard fix when the natural construction order is reverse of the desired final order.

---

## Q31. What's the difference between `append(s, v...)` and `slices.Concat(s, v)`?

`append(s, v...)` modifies (or replaces) `s` with the concatenation. If `s` has enough cap, it's in-place; otherwise it allocates a new array and copies all of `s` plus `v`.

`slices.Concat(s1, s2, ..., sn)` (Go 1.22+) builds a brand-new slice from any number of input slices. It sums all input lengths and allocates exactly once. The inputs are unchanged.

```go
out := slices.Concat(a, b, c)   // a, b, c unchanged
a = append(a, b...)              // a is modified (or replaced)
```

`Concat` is cleaner when you have many inputs; `append` is the idiom for "add to this slice".

---

## Q32. How do you efficiently reverse a string in Go using slice tricks?

Convert to `[]rune`, reverse, convert back:

```go
func reverse(s string) string {
    r := []rune(s)
    slices.Reverse(r)
    return string(r)
}
```

`[]rune` handles multi-byte UTF-8 codepoints correctly. Reversing `[]byte` would corrupt non-ASCII strings.

---

## 33. Summary

These thirty-two questions cover the wiki SliceTricks surface plus the modern `slices` package: insert/delete in both order-preserving and swap-and-pop forms, the pointer-zeroing rule, scoped clones, ring-buffer alternatives to slice-queues, dedupe in both sorted and unsorted forms, rotate, shuffle, chunk, flatten, filter, and the cap/len/data aliasing rules that produce footgun mutation. Default to `slices.*` in Go 1.21+ code; use the wiki tricks when the helper doesn't exist (swap-pop, rotate) or when reading code older than 1.21. The recurring themes are: every trick is a header edit, pointer-element shrinkage leaks unless zeroed, and shared backing arrays make sub-slices dangerous to expose past their scope.

---

## Further reading
- SliceTricks wiki: https://github.com/golang/go/wiki/SliceTricks
- `slices` package: https://pkg.go.dev/slices
- `slices` source: https://cs.opensource.google/go/go/+/refs/tags/go1.23.0:src/slices/slices.go
- `clear` built-in: https://pkg.go.dev/builtin#clear
- `iter.Seq` (Go 1.23+): https://pkg.go.dev/iter
