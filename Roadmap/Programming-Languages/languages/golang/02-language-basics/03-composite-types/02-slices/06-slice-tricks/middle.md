# Slice Tricks — Middle

## 1. Beyond insert and delete

[junior.md](junior.md) covered the seven essential tricks. This file picks up where it ended:

- **Filter in place** — keep only elements matching a predicate, no extra allocation.
- **Dedupe** — both the easy (sorted) case and the general (set) case.
- **Batch / chunk** — split a slice into fixed-size sub-slices.
- **Flatten** `[][]T` → `[]T`.
- **Scoped clone** — `s[:len(s):len(s)]`, the three-index slice expression that controls capacity.
- **Rotate** — left or right by `k` positions.
- **Shuffle** — Fisher–Yates.
- **Allocation accounting** — what each trick costs in memory, and how to measure.

These are the tricks you reach for once you're writing real services. They show up in stream-processing code, batched API calls, paginated data, and anywhere you need to massage a slice without making garbage.

All of them sit on top of the same three-field slice header `(ptr, len, cap)`. If a trick reuses the existing backing array, it's allocation-free. If it allocates, it's because `append` had to grow or because the trick deliberately copies.

---

## 2. Filter in place

You have `s []int` and want to keep only positive values.

```go
n := 0
for _, x := range s {
    if x > 0 {
        s[n] = x
        n++
    }
}
s = s[:n]
```

What this does, header-wise: the backing array is rewritten left-to-right; survivors end up packed at the front; finally `len` is reset to the count of survivors.

```
before:  [3, -1, 7, -4, 2, -8]   len=6, cap=6
after:   [3,  7, 2, -4, 2, -8]   len=3, cap=6
          ^-- valid --^   ^-- stale, out of len
```

The "stale" tail is the same pointer-leak hazard from [junior.md §5](junior.md). For pointer types, zero the tail:

```go
for i := n; i < len(s); i++ {
    s[i] = nil   // or the zero value for T
}
s = s[:n]
```

There's a one-allocation alternative that's more readable for short slices:

```go
out := make([]int, 0, len(s))
for _, x := range s {
    if x > 0 {
        out = append(out, x)
    }
}
s = out
```

Trade-off: the in-place version mutates `s` (which may be a parameter shared with the caller) and never allocates; the `make + append` version allocates once but doesn't disturb the input. **Pick based on whether the caller observes mutation.**

### Go 1.21+ equivalent

There's no `slices.Filter` in the standard library (as of 1.23). The community-favorite shape is what's above.

---

## 3. Dedupe — sorted input

If your slice is sorted, deduping is one pass:

```go
n := 1
for i := 1; i < len(s); i++ {
    if s[i] != s[i-1] {
        s[n] = s[i]
        n++
    }
}
s = s[:n]
```

Same filter-in-place pattern: a write index `n` that advances only for kept elements.

### Go 1.21+ equivalent

```go
s = slices.Compact(s)
```

`slices.Compact` does exactly this — sorted-adjacent-only dedupe. Cheap, in-place, no allocation. It zeroes the tail for pointer-element types since Go 1.22.

### Dedupe with a custom equality

```go
s = slices.CompactFunc(s, func(a, b Item) bool {
    return a.ID == b.ID
})
```

`CompactFunc` lets you specify the equality predicate, useful for struct slices where you care about a key field.

---

## 4. Dedupe — unsorted input

Without sort, you need a set:

```go
seen := make(map[int]struct{}, len(s))
n := 0
for _, x := range s {
    if _, ok := seen[x]; ok {
        continue
    }
    seen[x] = struct{}{}
    s[n] = x
    n++
}
s = s[:n]
```

`struct{}{}` is the empty-struct zero value — it occupies zero bytes, so the map is "set of int". Total cost: one map allocation, O(n) average time, in-place rewrite of the slice.

If the slice element is a pointer or has a long key, you may prefer to sort first and use `slices.Compact`:

```go
slices.Sort(s)         // O(n log n)
s = slices.Compact(s)  // O(n)
```

This is a different trade-off: sort doesn't allocate (it's in-place), so the only allocation is `slices.Compact`'s zeroing of the tail. But sort changes order, and `O(n log n)` may dominate for large `n`.

| Approach | Time | Allocations | Order-preserving? |
|----------|------|-------------|-------------------|
| map-based | O(n) avg | 1 (map) | yes |
| sort + Compact | O(n log n) | 0 | no |
| sort + Compact + index trick | O(n log n) | 2 | yes |

For "n < 64 and elements are small", map-based wins on both axes. For "n > 10 000 and elements are 8-byte ints", sort+Compact wins on memory.

---

## 5. Batch / chunk a slice

Split `s` into groups of size `k`:

```go
func chunks[T any](s []T, k int) [][]T {
    if k <= 0 {
        return nil
    }
    out := make([][]T, 0, (len(s)+k-1)/k)
    for i := 0; i < len(s); i += k {
        end := i + k
        if end > len(s) {
            end = len(s)
        }
        out = append(out, s[i:end])
    }
    return out
}
```

Each returned sub-slice **shares the same backing array as `s`**. No element-level copy happens; just three-field headers are written. This is the cheap version.

If the caller might mutate the chunks independently and you don't want the mutations to bleed into `s`, allocate per chunk:

```go
out = append(out, append([]T(nil), s[i:end]...))
```

That's one allocation per chunk plus the copy. Use only when you actually need isolation.

### Go 1.23 equivalent

`slices.Chunk` (added in Go 1.23) returns an iterator instead of a `[][]T`:

```go
for chunk := range slices.Chunk(s, k) {
    process(chunk)   // each chunk is a sub-slice sharing s's backing array
}
```

Iterator form avoids allocating the outer `[][]T`. Same aliasing rules.

---

## 6. Flatten `[][]T` → `[]T`

Naive:

```go
var out []T
for _, inner := range s {
    out = append(out, inner...)
}
```

Each `append` may grow `out`. Total appends: `len(s)` calls; each call is amortized O(1) but the realloc copies grow super-linearly in worst case.

Better: preallocate.

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

One pass to size; one pass to copy. Exactly one allocation. This is the standard pattern for "merge many small slices into one large one".

### Go 1.22+ equivalent

```go
out := slices.Concat(s...)
```

`slices.Concat` sums lengths internally and allocates exactly once. Same shape as the preallocation idiom above, less code.

---

## 7. The "scoped clone" — `s[:len(s):len(s)]`

The three-index slice expression `s[low:high:max]` sets cap explicitly:

```go
out := s[:len(s):len(s)]   // len=len(s), cap=len(s)
```

Why this matters: `out` and `s` share the same backing array, but `out`'s `cap == len`. Any further `append(out, x)` is **guaranteed to allocate a new backing array** — `out` cannot grow into the array beyond what `s` originally allocated.

Use case: you're returning a slice to a caller you don't trust. You don't want the caller's `append` to overwrite elements you still hold via `s[len(s):]`.

```go
// BAD: caller's append may stomp into s's backing array
func (b *Buf) Tail() []byte { return b.data[b.start:] }

// GOOD: caller can append safely; it always allocates
func (b *Buf) Tail() []byte { return b.data[b.start:len(b.data):len(b.data)] }
```

The result is sometimes called a "scoped clone" or "fully-capped slice". It's a header trick — no data is copied. Only the cap field is forced down.

### True clone (data copy)

If you want an isolated backing array too:

```go
out := make([]T, len(s))
copy(out, s)
```

Or, Go 1.21+:

```go
out := slices.Clone(s)
```

`slices.Clone` is `append([]T(nil), s...)` underneath. One allocation, one copy.

---

## 8. Rotate

Rotate `s` left by `k` (so `s[k:]` ends up at the front):

```go
func rotateLeft[T any](s []T, k int) {
    if len(s) == 0 {
        return
    }
    k %= len(s)
    if k < 0 {
        k += len(s)
    }
    reverse(s[:k])
    reverse(s[k:])
    reverse(s)
}

func reverse[T any](s []T) {
    for i, j := 0, len(s)-1; i < j; i, j = i+1, j-1 {
        s[i], s[j] = s[j], s[i]
    }
}
```

This is the "three reverses" trick. It allocates **nothing** and runs in O(n) with about 1.5n element writes. The intuition: reversing `[a,b,c|d,e,f]` partwise gives `[b,a,c|f,e,d]`, then a full reverse gives `[d,e,f,a,b,c]`. The vertical bar marks the split at `k`.

### Go 1.21+ equivalent

There's no `slices.Rotate` (as of 1.23). Write the three-reverses trick.

---

## 9. Shuffle (Fisher–Yates)

```go
import "math/rand/v2"

func shuffle[T any](s []T) {
    for i := len(s) - 1; i > 0; i-- {
        j := rand.IntN(i + 1)
        s[i], s[j] = s[j], s[i]
    }
}
```

Pick a random index `j` in `[0, i]`, swap `s[i]` with `s[j]`, decrement `i`. Each element ends up in each position with equal probability. In-place, O(n).

### stdlib equivalent

`math/rand/v2.Shuffle(n int, swap func(i, j int))` already exists:

```go
rand.Shuffle(len(s), func(i, j int) {
    s[i], s[j] = s[j], s[i]
})
```

Same algorithm; the helper just spares you writing the loop. Older `math/rand.Shuffle` (pre-`v2`) works identically.

---

## 10. Allocation accounting

Most tricks "in place" *don't* allocate when the existing backing array fits. They do allocate when:

1. **`append` grew past `cap`.** Insert, push back, push front (always), flatten without preallocation.
2. **You explicitly `make`d a new slice.** `slices.Clone`, `make + copy`.
3. **`append([]T{x}, s...)` style** constructed a literal slice. Insert at front pattern.

To measure inside a test:

```go
import "testing"

func BenchmarkInsertMiddle(b *testing.B) {
    base := make([]int, 100)
    for i := range base {
        base[i] = i
    }
    b.ResetTimer()
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        s := slices.Clone(base)               // start fresh per iter
        s = slices.Insert(s, 50, 999)
        _ = s
    }
}
```

`go test -bench=. -benchmem` reports `B/op` (bytes per op) and `allocs/op`. The trick is finding the right "start fresh per iter" — `slices.Clone` adds one allocation per iter that you must remember when reading the numbers.

A handful of typical Go 1.22 results for `[]int` slices of length 1000 (your numbers will vary):

| Operation | `B/op` | `allocs/op` |
|-----------|-------|-------------|
| `slices.Insert(s, 500, 999)` (cap = len) | 8200 | 1 |
| `slices.Insert(s, 500, 999)` (cap = 2× len) | 0 | 0 |
| `slices.Delete(s, 500, 501)` | 0 | 0 |
| `slices.Clone(s)` | 8192 | 1 |
| `slices.Compact(s)` (no dupes) | 0 | 0 |
| `slices.Concat(s1, s2, s3)` | 24576 | 1 |
| `slices.Reverse(s)` | 0 | 0 |

The pattern: **structural ops with sufficient cap are free; clone always allocates; growing inserts allocate once**.

---

## 11. The "share backing array" gotcha

Many tricks return sub-slices of the input. That's fast — no copy — but it means the caller's writes propagate into the original. Pop quiz:

```go
s := []int{1, 2, 3, 4, 5}
out := s[:3]
out = append(out, 99)
// s == ?
```

`out` had `len=3, cap=5`, so `append(out, 99)` writes into `s[3]` without growing. Result: `s == [1, 2, 3, 99, 5]`. The "append to a sub-slice" silently mutated the parent.

Two defenses:

```go
// Defense 1: scoped clone — cap match len, forces grow
out := s[:3:3]
out = append(out, 99)
// s unchanged

// Defense 2: real clone — independent backing array
out := slices.Clone(s[:3])
out = append(out, 99)
// s unchanged
```

The right answer depends on whether you also want to protect against mutation via index (`out[0] = 99`). The scoped clone shares storage, so `out[0] = 99` *does* change `s[0]`. Only the real clone fully isolates.

---

## 12. Combining tricks: in-place dedupe-then-filter

Real code chains tricks. Example: take `[]User`, drop users with `User.Banned`, then dedupe by `User.ID`.

```go
// Filter in place
n := 0
for _, u := range users {
    if !u.Banned {
        users[n] = u
        n++
    }
}
users = users[:n]

// Sort by ID, then Compact
slices.SortFunc(users, func(a, b User) int {
    return cmp.Compare(a.ID, b.ID)
})
users = slices.CompactFunc(users, func(a, b User) bool {
    return a.ID == b.ID
})
```

Allocations: zero (assuming the sort is in-place, which `slices.SortFunc` is). The whole pipeline reuses one backing array. For `[]User` containing pointers, you'd also need to zero the tail after filter and after Compact — but `slices.CompactFunc` handles its own tail-zeroing in Go 1.22+.

---

## 13. Pointer-element tricks: the "release roots" pattern

Whenever you shrink a `[]*T` (or `[]T` where `T` contains pointers), the dead tail is GC-rooted. Pattern to release roots:

```go
// Generic helper
func zeroTail[T any](s []T, from int) {
    var zero T
    for i := from; i < len(s); i++ {
        s[i] = zero
    }
}

// Apply after every shrink
n := filterCount(s)
zeroTail(s, n)
s = s[:n]
```

Most production code uses `slices.Delete` / `slices.Compact` from Go 1.22+ instead, which do this internally. For pre-1.22 code (or hand-rolled tricks), `zeroTail` is the canonical pattern.

The Go runtime exposes this internally via `clear(s[n:])` (Go 1.21+):

```go
clear(s[n:])   // zeros every element in the sub-slice
s = s[:n]
```

`clear` is the modern way. It works on both slices and maps and is preferred over a loop.

---

## 14. Quick reference: middle-level tricks

| Trick | Code | Allocations |
|-------|------|-------------|
| Filter in place | write-index loop | 0 |
| Dedupe sorted | `slices.Compact(s)` | 0 |
| Dedupe unsorted (preserve order) | map-based | 1 (map) |
| Dedupe unsorted (sort OK) | `slices.Sort` + `Compact` | 0 |
| Chunk (sharing) | sub-slice in loop | 1 (outer) |
| Chunk (copy) | sub-slice + `Clone` | 1 + 1/chunk |
| Flatten | preallocate `make` + `append` | 1 |
| `slices.Concat` | builds total, allocates once | 1 |
| Scoped clone | `s[:len(s):len(s)]` | 0 |
| Real clone | `slices.Clone(s)` | 1 |
| Rotate | three reverses | 0 |
| Shuffle | Fisher–Yates | 0 |
| Zero tail before shrink | `clear(s[n:])` | 0 |

---

## 15. Common mistakes at this level

1. **Filtering without zeroing pointers.** `s = s[:n]` leaves the dead tail referencing `T` pointers until the whole backing array is freed.
2. **Append to a sub-slice mutating the parent.** `s[:3]` shares storage with `s`; appending to it writes into `s[3:]` until cap is reached.
3. **Allocating per chunk by accident.** `out = append(out, append([]T{}, s[i:end]...))` allocates per chunk; intentional only when isolation is needed.
4. **Dedupe unsorted with `slices.Compact`.** `Compact` only deduplicates adjacent equal elements. On unsorted input it doesn't find non-adjacent duplicates.
5. **Cloning with `out := s`.** That's a header copy, not a slice copy. `out` and `s` still share the same backing array. Use `slices.Clone(s)` for a real copy.
6. **Forgetting `clear` exists.** Pre-1.21 the loop was canonical; from 1.21 `clear(s[n:])` is shorter and clearer.

---

## 16. Things you can do today

1. Benchmark filter-in-place vs `make + append` for a `[]int` of size 10, 100, 10 000. Identify the crossover point.
2. Write a generic `Dedupe[T comparable](s []T) []T` that preserves order. Compare allocations to `slices.Sort + Compact`.
3. Implement `chunks` two ways: sharing storage, and copying. Verify mutation visibility with a small test.
4. Take a `[]*Job` of 1000 entries, each holding a 1 MiB byte slice. Filter to keep 100, both with and without `clear` for the tail. Measure `runtime.ReadMemStats().HeapAlloc` after `runtime.GC()`.
5. Build a "scoped clone" wrapper `Snapshot[T any](s []T) []T` returning `s[:len(s):len(s)]`. Document when to prefer it over `slices.Clone`.

---

## 17. Summary

Middle-level slice tricks build the lego pieces for real services: filter in place, dedupe (sorted and unsorted), chunk, flatten, rotate, shuffle, and the scoped clone. All of them operate on the slice header; "in place" means the same backing array is reused. The two recurring hazards are **shared-backing-array aliasing** (a sub-slice's `append` can mutate the parent) and **pointer-element leaks** (a shrunk `len` doesn't free elements still referenced by the dead tail of the backing array). Go 1.21+ helps with `slices.Compact`, `slices.Clone`, `slices.Concat`, and `clear`; Go 1.22+ extends helper functions to handle pointer-tail zeroing automatically. New code should prefer those helpers; older code uses the wiki tricks shown here.

---

## Further reading
- SliceTricks wiki: https://github.com/golang/go/wiki/SliceTricks
- `slices` package: https://pkg.go.dev/slices
- `clear` built-in: https://pkg.go.dev/builtin#clear
- Three-index slice spec: https://go.dev/ref/spec#Slice_expressions
- Sibling — slice header model: [../05-slice-header-internals/](../05-slice-header-internals/)
- Sibling — capacity and growth: [../01-capacity-and-growth/](../01-capacity-and-growth/)
