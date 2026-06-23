# Slice Tricks — Find the Bug

A collection of realistic slice-trick bugs. For each: the symptom, the (often subtle) cause at the slice-header level, and the fix. Reading them in order builds the intuition you need to spot slice bugs in code review.

---

## Bug 1: The "deleted" pointer that wouldn't die

```go
type Session struct {
    UserID string
    Data   []byte   // typically a few MB per session
}

var sessions []*Session

func evictOldest() {
    if len(sessions) == 0 {
        return
    }
    sessions = sessions[1:]
}
```

**Symptom.** A long-running server's RSS grows steadily. Each `evictOldest` is supposed to release the oldest session, but `pprof -inuse_space` shows millions of bytes still attributed to `Session.Data`.

**Cause.** `sessions = sessions[1:]` advances the slice header's `Data` pointer by one element, dropping `len` and `cap` by one. **The popped `*Session` is still in the backing array**, just outside the slice's `len` window. The backing array remains alive through `sessions.Data`. So the popped session's `Data []byte` is still GC-reachable through the array.

In addition, every Pop creates a "dead zone" of orphaned slots before `Data`. Push enough sessions and the backing array grows; the dead zone grows with it. Classic slice-queue leak.

**Fix.** Zero the popped slot before re-slicing, **and** move to a ring buffer for the actual queue semantics.

```go
func evictOldest() {
    if len(sessions) == 0 {
        return
    }
    sessions[0] = nil          // release the GC root
    sessions = sessions[1:]
}
```

That fixes the per-element leak but not the cumulative backing-storage growth. For that, use a `Ring[*Session]` (see [professional.md §3](professional.md)).

For a one-off "drop oldest" in a short-lived collection, the `nil` assignment is enough. For an actual long-running queue, ring buffer is mandatory.

---

## Bug 2: The off-by-one in "insert at index i"

```go
func insert(s []int, i, x int) []int {
    return append(s[:i], append([]int{x}, s[i+1:]...)...)
}
```

**Symptom.** `insert([]int{10, 20, 30}, 1, 99)` returns `[10, 99, 30]` instead of `[10, 99, 20, 30]`. The element at position `i` is silently overwritten.

**Cause.** `s[i+1:]` skips the element that was at index `i`. The trick should preserve every element of `s`, shifting `s[i:]` right by one. The right tail is `s[i:]`, not `s[i+1:]`.

**Fix.**

```go
func insert(s []int, i, x int) []int {
    return append(s[:i], append([]int{x}, s[i:]...)...)
}
```

Or, much better, use the stdlib:

```go
func insert(s []int, i, x int) []int {
    return slices.Insert(s, i, x)
}
```

The wiki trick has this off-by-one as its most common transcription error. `slices.Insert` makes it impossible.

---

## Bug 3: Filter that "leaks" pointer elements

```go
type Job struct {
    Payload []byte    // can be MB-sized
}

func keepLive(jobs []*Job) []*Job {
    n := 0
    for _, j := range jobs {
        if j.IsLive() {
            jobs[n] = j
            n++
        }
    }
    return jobs[:n]
}
```

**Symptom.** Filtering 1000 jobs down to 10 should release 990 jobs' worth of memory. After `runtime.GC()`, only the 10 kept jobs should remain. `pprof` shows all 1000 still in `inuse_space`.

**Cause.** The first 10 slots now hold the kept `*Job` pointers, but slots `[10..1000)` still hold the **old** `*Job` pointers from the original positions. The slice's `len = 10` doesn't see them, but the backing array still does. GC can't reclaim because the array is rooted by the slice.

**Fix.** Zero the tail before shrinking.

```go
func keepLive(jobs []*Job) []*Job {
    n := 0
    for _, j := range jobs {
        if j.IsLive() {
            jobs[n] = j
            n++
        }
    }
    clear(jobs[n:])     // Go 1.21+
    return jobs[:n]
}
```

Or, equivalent and shorter:

```go
func keepLive(jobs []*Job) []*Job {
    return slices.DeleteFunc(jobs, func(j *Job) bool { return !j.IsLive() })
}
```

`slices.DeleteFunc` zeros the dead tail for pointer-element types as of Go 1.22.

---

## Bug 4: Append into a sub-slice corrupting the parent

```go
func processFirst(events []Event, n int) {
    first := events[:n]
    first = append(first, computeExtra(events)...)
    save(first)
}
```

**Symptom.** `save(first)` writes the right values, but after `processFirst` returns, the caller's `events` slice has been silently mutated — elements after position `n` are different.

**Cause.** `events[:n]` produces a sub-slice with `len=n`, but `cap = cap(events)` — the sub-slice inherits the parent's capacity. When `append(first, ...)` finds enough cap, it writes into the parent's backing array at position `n` and beyond. `events[n], events[n+1], ...` are overwritten.

```
events:   [e0, e1, e2, e3, e4, e5, _, _]    len=6, cap=8
first:    [e0, e1, e2]                       len=3, cap=8 (inherited)
extras:   [x0, x1]
after append: [e0, e1, e2, x0, x1, e5, _, _]
                            ^^^^^^  these used to be e3, e4
```

**Fix.** Cap the sub-slice's capacity to its length:

```go
first := events[:n:n]   // scoped clone — append must allocate
```

Or, with full isolation:

```go
first := slices.Clone(events[:n])
```

The scoped clone (`events[:n:n]`) is zero-allocation and still safe for `append`. The full clone allocates one new array.

In a code review, **`events[:n]` followed by `append(events[:n], ...)` should be a red flag**. Either use the three-index form or clone.

---

## Bug 5: Wrong cap in the three-index slice

```go
func chunk(s []int, k int) [][]int {
    var out [][]int
    for i := 0; i < len(s); i += k {
        end := i + k
        if end > len(s) {
            end = len(s)
        }
        out = append(out, s[i:end:len(s)])   // <-- wrong
    }
    return out
}
```

**Symptom.** Each chunk's `cap` is `len(s) - i`, much larger than `end - i`. A caller doing `append(chunks[0], 99)` writes into `s[end]`, corrupting the next chunk.

**Cause.** The third index in `s[low:high:max]` is **the absolute position one past the last accessible element in the backing array**, not a length. `s[i:end:len(s)]` gives `cap = len(s) - i`. To cap at `end - i`, use `end` as the max:

```go
out = append(out, s[i:end:end])
```

Now each chunk has `cap = end - i`, matching its `len`. `append` on a chunk allocates a new array; chunks don't stomp each other.

**Fix.**

```go
func chunk(s []int, k int) [][]int {
    out := make([][]int, 0, (len(s)+k-1)/k)
    for i := 0; i < len(s); i += k {
        end := i + k
        if end > len(s) {
            end = len(s)
        }
        out = append(out, s[i:end:end])
    }
    return out
}
```

Or use the Go 1.23+ iterator:

```go
for chunk := range slices.Chunk(s, k) {
    process(chunk)
}
```

`slices.Chunk` returns sub-slices with `cap == len` automatically.

---

## Bug 6: Aliasing while iterating

```go
func dedupeInPlace(s []string) []string {
    for i := 0; i < len(s); i++ {
        for j := i + 1; j < len(s); j++ {
            if s[i] == s[j] {
                s = append(s[:j], s[j+1:]...)
                j--
            }
        }
    }
    return s
}
```

**Symptom.** Works on small inputs (10 elements). On larger inputs (100+), produces wrong output occasionally. Sometimes panics with `index out of range`.

**Cause.** Multiple problems:

1. `len(s)` is recomputed each loop iteration (correct), but the slice `s` is being reassigned inside the body. The reassignment doesn't break the outer loop because it uses `len(s)` correctly each pass, but the **inner loop's bounds check** races with the outer reassignment.
2. `j--` after delete is needed to re-check position `j`, but `j` may now equal `len(s)` after the delete — the inner condition `j < len(s)` catches it on the next pass, which is OK. But if multiple deletes happen, the algorithm is O(n²) of shifts on top of the O(n²) of the loop.

Subtler issue: this is doing O(n³) work overall — n² comparisons each with up to n shift work. For n=1000, that's 10⁹ operations.

**Fix.** Use the standard "sort + Compact" or "map-based" idiom.

```go
// preserve order, allocate map
func dedupeInPlace(s []string) []string {
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
    return s[:n]
}
```

Or, sort and use `slices.Compact`:

```go
slices.Sort(s)
s = slices.Compact(s)
```

The original "nested loop delete" pattern is always wrong for large inputs. Don't do mid-iteration deletes from the slice being iterated.

---

## Bug 7: `append` to a stale slice header

```go
func buildIDs(events []Event) []int {
    ids := make([]int, 0, 100)
    for _, e := range events {
        if e.Type == "create" {
            appendID(ids, e.ID)
        }
    }
    return ids
}

func appendID(ids []int, id int) {
    ids = append(ids, id)
}
```

**Symptom.** `buildIDs` returns an empty slice no matter how many "create" events are in the input.

**Cause.** `appendID` receives `ids` **by value**. The slice header (Data, Len, Cap) is copied into the function. `append` modifies the local copy's Len (and possibly Data if grow happened). The original `ids` in the caller never sees the change.

**Fix.** Return the appended slice and reassign:

```go
func appendID(ids []int, id int) []int {
    return append(ids, id)
}

// caller
ids = appendID(ids, e.ID)
```

Or, use a pointer-to-slice if you want the function to mutate in place:

```go
func appendID(ids *[]int, id int) {
    *ids = append(*ids, id)
}

// caller
appendID(&ids, e.ID)
```

In Go, `append` always returns a (possibly new) slice. The "fire and forget" call doesn't propagate the change. This is the most common slice bug in junior code, and it's worth flagging in every code review.

---

## Bug 8: Pop without checking length

```go
func popLast[T any](s []T) (T, []T) {
    n := len(s) - 1
    return s[n], s[:n]
}
```

**Symptom.** Panic with `runtime error: index out of range [-1]` when called on an empty slice.

**Cause.** `len(s) - 1` is `-1` for an empty slice. `s[-1]` panics. The function should return a zero value and a `false` (or error) on empty input.

**Fix.**

```go
func popLast[T any](s []T) (T, []T, bool) {
    var zero T
    if len(s) == 0 {
        return zero, s, false
    }
    n := len(s) - 1
    x := s[n]
    s[n] = zero       // pointer-safe
    return x, s[:n], true
}
```

The empty-slice case is the most-missed corner case in slice helpers. Every Pop, Front, Back, RemoveLast must handle it.

---

## Bug 9: The "rotate" that allocates

```go
func rotateLeft[T any](s []T, k int) []T {
    return append(s[k:], s[:k]...)
}
```

**Symptom.** Works correctly, but allocates a new backing array on every call. For a hot path doing rotation per request, the GC pressure is enormous.

**Cause.** `append(s[k:], s[:k]...)` may seem in-place, but it isn't: `s[k:]` has `cap = cap(s) - k`. Appending `k` elements to it: if `k > cap(s) - len(s[k:]) = cap(s) - (len(s) - k) = cap(s) - len(s) + k`, then growth happens. For typical `cap(s) == len(s)`, `cap(s[k:]) = len(s) - k`, and appending `k` elements requires cap `len(s)`. The condition `k > cap(s[k:]) - len(s[k:]) = 0` is always true unless `k == 0`. So **every call allocates**.

Worse, the new slice is in a different order — but the original `s` is unmodified. The caller probably wanted in-place rotation.

**Fix.** Use the three-reverses trick:

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

In-place, zero allocations, ~1.5n element writes. Signature now mutates instead of returning, matching the semantics most callers want.

---

## Bug 10: Filter that runs out of memory

```go
func filterPositive(s []int) []int {
    var out []int
    for _, x := range s {
        if x > 0 {
            out = append(out, x)
        }
    }
    return out
}
```

**Symptom.** Works, but for `len(s) = 10_000_000`, the function does many `append`-driven reallocations. Profiler shows `runtime.growslice` accounts for 60 % of CPU.

**Cause.** `out` starts at `len=0, cap=0`. Each `append` may grow. The doubling strategy means `log2(10_000_000) ≈ 23` reallocations, each copying everything written so far. Total copy work: 2× the final size. Plus 23 separate allocations the GC has to track.

**Fix.** Preallocate with the upper bound on output size — at most `len(s)`:

```go
func filterPositive(s []int) []int {
    out := make([]int, 0, len(s))
    for _, x := range s {
        if x > 0 {
            out = append(out, x)
        }
    }
    return out
}
```

Single allocation, no reallocation regardless of how many pass the filter. If the filter rate is very low (e.g., 1 % pass), this overallocates 99×; consider a smaller initial cap and accept some growth, or filter in two passes (count, then allocate). For most filter ratios, "cap = len(input)" is the right default.

For absolutely no allocation, filter in place (mutates input):

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

---

## Bug 11: Clone via re-assignment

```go
func snapshot(s []int) []int {
    cp := s
    return cp
}
```

**Symptom.** `cp` and `s` share the same backing array. Mutations to elements via `cp[i] = ...` are visible through `s`.

**Cause.** `cp := s` copies the slice **header** (Data, Len, Cap). Both headers point to the same backing array. There is no element copy.

**Fix.** Use `slices.Clone` or `copy`:

```go
func snapshot(s []int) []int {
    return slices.Clone(s)
}
```

Or pre-1.21:

```go
func snapshot(s []int) []int {
    cp := make([]int, len(s))
    copy(cp, s)
    return cp
}
```

A common variant of this bug: passing a slice as a function argument, mutating it, and expecting the caller's slice to be unchanged. **Elements** are shared even when the headers are not.

---

## Bug 12: `clear` on the wrong sub-slice

```go
func evictExpired(s []*Session) []*Session {
    n := 0
    for _, sess := range s {
        if !sess.Expired() {
            s[n] = sess
            n++
        }
    }
    clear(s[:n])     // <-- wrong
    return s[:n]
}
```

**Symptom.** Compiles. Returns a slice of `nil` pointers instead of the live sessions.

**Cause.** `clear(s[:n])` zeros the kept elements. The intent was to clear the **dropped** elements `s[n:]`, not the kept ones.

**Fix.**

```go
clear(s[n:])      // zero the dropped elements, releasing GC roots
return s[:n]
```

The `[:n]` vs `[n:]` typo is easy to make and easy to miss in review. Always say it out loud: "I want to clear the dead tail, the part beyond `n`." Then write `clear(s[n:])`.

---

## Bug 13: The `copy` that copies the wrong direction

```go
func deleteAt(s []int, i int) []int {
    copy(s[i+1:], s[i:])    // <-- wrong direction
    return s[:len(s)-1]
}
```

**Symptom.** After `deleteAt([]int{1,2,3,4,5}, 1)`, result is `[1, 2, 2, 3, 4]` — element at index 1 is duplicated, the last useful element is dropped.

**Cause.** `copy(s[i+1:], s[i:])` shifts elements **right** by one, starting from `s[i]`. But the desired delete shifts **left** by one, starting from `s[i+1]`. The destination should be `s[i:]`, source `s[i+1:]`.

**Fix.**

```go
func deleteAt(s []int, i int) []int {
    copy(s[i:], s[i+1:])
    return s[:len(s)-1]
}
```

For pointer-element types, also `clear(s[len(s)-1:])` before re-slicing.

Or just use `slices.Delete(s, i, i+1)` which handles direction and pointer-zeroing correctly.

Mnemonic: when deleting, the "left side" of the gap is the destination; the "right side" (after the gap) is the source. `dst = s[i:]`, `src = s[i+1:]`.

---

## Bug 14: Misusing `s[:0]` to "reset" a pointer slice

```go
var buf []*Job

for {
    events := source.Next()
    for _, e := range events {
        buf = append(buf, processToJob(e))
    }
    sink(buf)
    buf = buf[:0]   // reset for reuse
}
```

**Symptom.** Memory grows steadily. After many iterations, `runtime.MemStats.HeapAlloc` is far higher than the working set.

**Cause.** `buf = buf[:0]` resets `len` to 0 but **leaves the elements in the backing array**. Each `*Job` pointer in the cap range is still GC-reachable through the backing array. Across iterations, the old `*Job` values accumulate (whichever was last written to each slot stays until overwritten or until `buf` itself becomes unreachable).

When `len > cap`, `append` overwrites the slot — fine. But if the loop produces fewer jobs than the high-water mark, the trailing slots still hold the old pointers.

**Fix.** Clear before resetting `len`:

```go
clear(buf)         // zeros every slot in [0, len(buf))
buf = buf[:0]
```

Or, more carefully, clear only the trailing slots that weren't overwritten:

```go
written := len(buf)   // before the reset
clear(buf[:written])  // clear what was used
buf = buf[:0]
```

For non-pointer types (`[]int`, `[]byte`), `buf = buf[:0]` alone is fine — there's nothing for GC to collect.

---

## Bug 15: `slices.Delete` on Go 1.21 with pointer elements

```go
// Go 1.21 only
type Cache struct {
    items []*Item
}

func (c *Cache) Remove(i int) {
    c.items = slices.Delete(c.items, i, i+1)
}
```

**Symptom.** On Go 1.21, the removed `*Item` is not GC-reclaimed even after `runtime.GC()`. On Go 1.22+, the same code works correctly.

**Cause.** `slices.Delete` in Go 1.21 did the left-shift but **did not** `clear` the now-dead tail slot. The behavior changed in Go 1.22 to zero pointer-containing trailing slots. So on 1.21 you have the same pointer-leak as the wiki trick.

**Fix.** Either upgrade to Go 1.22+, or zero manually:

```go
func (c *Cache) Remove(i int) {
    c.items = slices.Delete(c.items, i, i+1)
    if i < len(c.items) {
        // not really needed; the bug is elsewhere
    }
    // The actual fix:
    // explicitly clear the tail that fell off
    n := len(c.items)
    c.items = c.items[:n+1]         // re-extend by one
    c.items[n] = nil                // zero the slot
    c.items = c.items[:n]           // shrink back
}
```

Or, simpler, do it by hand:

```go
func (c *Cache) Remove(i int) {
    copy(c.items[i:], c.items[i+1:])
    c.items[len(c.items)-1] = nil
    c.items = c.items[:len(c.items)-1]
}
```

The lesson: **`slices.Delete` is pointer-safe only from Go 1.22 onwards**. The release notes called this out. If you're targeting 1.21 (or earlier), you must zero manually.

---

## Bug 16: Reading `slices.Insert` return value into the wrong variable

```go
func InsertSorted(s []int, x int) []int {
    i, _ := slices.BinarySearch(s, x)
    slices.Insert(s, i, x)        // <-- discards return value
    return s
}
```

**Symptom.** The insert seems to have no effect. The returned slice equals the input.

**Cause.** `slices.Insert` returns a (possibly new) slice. The original `s` is not modified — its header is a value, and `Insert` can't mutate the caller's header. The trick is no different from `append`: you must assign.

**Fix.**

```go
func InsertSorted(s []int, x int) []int {
    i, _ := slices.BinarySearch(s, x)
    return slices.Insert(s, i, x)
}
```

Compiler doesn't flag the unused return value because slices are values; the function appears to be called for side effects. Treat any `slices.X(s, ...)` call without `s = ...` reassignment as a bug.

A `golangci-lint` rule (or a custom analyzer) catching `slices.{Insert,Delete,Replace,Concat,Compact,etc.}` without reassignment is a good investment in a large team.

---

## 17. Summary

Slice-trick bugs cluster around five themes:

1. **Pointer leaks** (Bugs 1, 3, 14, 15) — shrinking a `[]T*` without zeroing the dead tail leaves elements GC-reachable through the backing array.
2. **Backing-array aliasing** (Bugs 4, 5, 11) — sub-slices share storage with the parent; `append` on a sub-slice may overwrite parent elements; `cp := s` is not a clone.
3. **Off-by-one in tricks** (Bugs 2, 13) — `s[i+1:]` vs `s[i:]`, `copy` direction, range bounds.
4. **Header-vs-value confusion** (Bugs 7, 16) — `append`'s return value not captured; slice argument passed by value.
5. **Iteration vs mutation** (Bugs 6, 8) — deleting from a slice mid-iteration; empty-slice corner case.

Internalize: every slice is `(Data, Len, Cap)`; every trick edits some subset; for pointer types, zero the dead tail; use `slices.*` (Go 1.21+ / 1.22+) which encodes all this correctly. When debugging, draw the header before and after — the bug almost always appears immediately.

---

## Further reading
- SliceTricks wiki: https://github.com/golang/go/wiki/SliceTricks
- `slices` package: https://pkg.go.dev/slices
- Go 1.22 release notes — `slices` tail-clear: https://go.dev/doc/go1.22
- `clear` built-in: https://pkg.go.dev/builtin#clear
- Sibling — header internals: [../05-slice-header-internals/](../05-slice-header-internals/)
- Sibling — capacity and growth: [../01-capacity-and-growth/](../01-capacity-and-growth/)
