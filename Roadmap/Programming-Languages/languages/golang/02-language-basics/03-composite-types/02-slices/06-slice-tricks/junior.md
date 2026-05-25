# Slice Tricks — Junior

## 1. What is a "slice trick"?

A **slice trick** is a short, idiomatic Go expression that performs a non-obvious slice operation — inserting in the middle, deleting an element, reversing in place — using only the built-ins `append`, `copy`, and slice expressions `s[i:j]`. The original collection (the "SliceTricks" wiki: https://github.com/golang/go/wiki/SliceTricks) catalogues about thirty of them.

Since Go 1.21, the standard `slices` package (https://pkg.go.dev/slices) provides typed, generic functions for the most common ones: `slices.Insert`, `slices.Delete`, `slices.Reverse`, `slices.Clone`, `slices.Compact`. You should prefer those in new code. But the tricks themselves remain useful because:

1. They show **what the standard helper is doing under the hood**.
2. You will see them in code older than Go 1.21 (most production codebases).
3. Some operations still don't have a one-line stdlib equivalent (rotate, swap-and-pop delete).

This file teaches the seven most essential tricks: insert, delete (two flavours), cut a range, push/pop, and reverse. For each, you get the trick, a diagram of what changes in the slice header, and the modern `slices.*` equivalent.

A slice is three things in memory: `(pointer, length, capacity)`. Every trick below is just shuffling those three values plus the bytes they point to. If something looks magic, draw the header. See [slice-header-internals](../05-slice-header-internals/) for the underlying data model.

---

## 2. Insert at index `i`

You have `s = [a, b, d, e]` and you want to insert `c` at index 2, getting `[a, b, c, d, e]`.

```go
s := []int{1, 2, 4, 5}
i := 2
x := 3

s = append(s[:i], append([]int{x}, s[i:]...)...)
// s == [1, 2, 3, 4, 5]
```

Reading it inside-out:

1. `s[i:]` is the tail `[4, 5]`.
2. `append([]int{x}, s[i:]...)` builds a fresh slice `[3, 4, 5]` in a new backing array.
3. `append(s[:i], ...)` appends those three elements to `s[:i] = [1, 2]`. If `cap(s)` is large enough, this writes in place; otherwise it allocates.

Header before and after (assuming `cap(s) >= len(s)+1`, so no growth):

```
before:  ptr=A0   len=4   cap=4    [1, 2, 4, 5]
after:   ptr=A0   len=5   cap=4    [1, 2, 3, 4, 5]   <-- overwrites old slot for "4"
                                                          and uses one more cap slot
```

The trick allocates **one temporary slice** (`[]int{x}` in step 2). For a single insert, that's fine. For a hot loop that inserts millions of times, see [optimize.md](optimize.md).

### Go 1.21+ equivalent

```go
import "slices"

s = slices.Insert(s, i, x)
```

`slices.Insert` accepts a variadic — you can insert multiple elements at once:

```go
s = slices.Insert(s, i, 3, 7, 9)
```

It does no extra allocation when the existing capacity already fits the new elements.

---

## 3. Delete preserving order

You have `s = [a, b, c, d, e]` and you want to delete index 2, getting `[a, b, d, e]`.

```go
s := []int{1, 2, 3, 4, 5}
i := 2

s = append(s[:i], s[i+1:]...)
// s == [1, 2, 4, 5]
```

`append` copies `s[i+1:] = [4, 5]` onto the end of `s[:i] = [1, 2]`. Because the destination overlaps the source, Go's `append` (and `copy`) is required by spec to handle this correctly when the destination starts at or before the source — which is the case here.

Header before and after:

```
before:  ptr=A0   len=5   cap=5    [1, 2, 3, 4, 5]
after:   ptr=A0   len=4   cap=5    [1, 2, 4, 5, 5]
                                              ^ stale leftover; not part of len
```

Note the last slot still holds `5` — the old value. It's outside `len(s)` so you can't see it via `s[4]` (that would be `panic: index out of range`), but **the backing array still has it**. If `5` were a pointer (`*Customer`), the garbage collector could not free `*Customer` because the array reference keeps it alive. See §5 below.

### Go 1.21+ equivalent

```go
s = slices.Delete(s, i, i+1)   // delete a half-open range [i, i+1)
```

`slices.Delete` deletes a range, so to remove one element you pass `[i, i+1)`. It zeroes the tail slots for pointer-element slices since Go 1.22.

---

## 4. Delete without preserving order (swap-and-pop)

If the order of elements doesn't matter, there's a much cheaper trick: move the last element into the deleted slot, then shrink.

```go
s := []int{1, 2, 3, 4, 5}
i := 1

s[i] = s[len(s)-1]   // copy last onto position i
s = s[:len(s)-1]     // drop the last
// s == [1, 5, 3, 4]
```

Header:

```
before:  ptr=A0   len=5   cap=5    [1, 2, 3, 4, 5]
                                       ^ to delete
after:   ptr=A0   len=4   cap=5    [1, 5, 3, 4, 5]
                                                ^ stale; out of len
```

Cost: **one assignment**, no `append`, no copy of the tail. The non-preserving delete is O(1); the preserving one is O(n−i). Use this whenever the order doesn't matter (unordered set membership, free lists, etc.).

There's no stdlib helper for swap-and-pop — write it inline. It's so short and so dependent on the calling code's intent that abstracting it usually obscures rather than clarifies.

---

## 5. Why the deleted slot matters: the pointer-leak trap

`int` doesn't leak, but pointers do. Consider:

```go
type Job struct{ Data []byte }   // imagine Data is 1 MiB
jobs := []*Job{j0, j1, j2, j3, j4}

i := 2
jobs = append(jobs[:i], jobs[i+1:]...)
// jobs == [j0, j1, j3, j4]
// but the backing array is [j0, j1, j3, j4, j4]
//                                          ^ still points to *Job j4
```

`j4` is referenced twice: once inside `len`, once in the dead tail slot. The slice itself doesn't see the second reference, but **the garbage collector does**. The `Job` (with its 1 MiB `Data`) cannot be freed until you drop the whole backing array.

The fix: zero the dead slot before shrinking.

```go
jobs[len(jobs)-1] = nil          // release the GC root
jobs = jobs[:len(jobs)-1]
```

For a range delete:

```go
copy(jobs[i:], jobs[i+1:])
jobs[len(jobs)-1] = nil
jobs = jobs[:len(jobs)-1]
```

Go 1.22+ `slices.Delete` does this for you when the element type contains pointers. Before that — and in any hand-rolled trick — **you must zero the tail yourself for pointer types**.

For non-pointer types (`int`, `byte`, `time.Time`), zeroing is unnecessary; there's nothing for the GC to collect.

---

## 6. Cut a range

Removing a contiguous range `[i, j)`:

```go
s := []int{1, 2, 3, 4, 5, 6}
i, j := 1, 4
s = append(s[:i], s[j:]...)
// s == [1, 5, 6]
```

Same shape as single-element delete, just with `s[j:]` instead of `s[i+1:]`. The same pointer-leak warning applies: zero the now-out-of-len slots before shrinking if elements contain pointers.

### Go 1.21+ equivalent

```go
s = slices.Delete(s, i, j)
```

Same `slices.Delete` as before — it was designed to take a range.

---

## 7. Push / pop, front and back

A slice doubles as a stack when you only push and pop the back:

```go
// Push back
s = append(s, x)

// Pop back
x, s = s[len(s)-1], s[:len(s)-1]
```

Push back is amortized O(1) thanks to `append`'s growth doubling. Pop back is O(1) — no copy, just shrink `len`. **For pointer element types, zero the popped slot before shrinking**, same as delete.

For a queue (FIFO), you push back and pop front:

```go
// Push back
q = append(q, x)

// Pop front
x, q = q[0], q[1:]
```

Pop front looks O(1) — it just slides the slice header's pointer forward by one element. But there's a leak: the dropped slot is *still in the original backing array*, and the original array keeps growing the underlying storage as you keep pushing. The "queue" grows without bound even though logically it stays small.

```
push 5 elements:   ptr=A0, len=5, cap=8   [a, b, c, d, e, _, _, _]
pop front 3:       ptr=A3, len=2, cap=5   [d, e, _, _, _]
push 5 more:       ptr=A3, len=7, cap=8   [d, e, f, g, h, i, j, k]  -- but realloc?
                   if cap=5 < 7, append allocates new backing array of cap=10
                   the old A0..A2 are abandoned (GC) -- but only at realloc.
```

The slots before `A3` are GC-reachable for as long as the original array is live. For a long-running queue this is a real leak. See [professional.md](professional.md) §3 for the ring-buffer fix.

Push front is the expensive case:

```go
// Push front -- O(n)
s = append([]int{x}, s...)
```

This allocates a new array, copies all of `s` into it after `x`. There is no cheap "push front" with a plain slice; that's what a ring buffer is for.

---

## 8. Reverse in place

The simplest two-finger swap:

```go
for i, j := 0, len(s)-1; i < j; i, j = i+1, j-1 {
    s[i], s[j] = s[j], s[i]
}
```

No allocations; in-place; O(n/2) swaps. The slice header doesn't change at all — only the bytes the pointer addresses.

### Go 1.21+ equivalent

```go
slices.Reverse(s)
```

Identical semantics; just shorter to write.

---

## 9. The complete trick table (junior level)

| Operation | Trick | `slices.*` (Go 1.21+) | Cost |
|-----------|-------|----------------------|------|
| Insert at `i` | `append(s[:i], append([]T{x}, s[i:]...)...)` | `slices.Insert(s, i, x)` | O(n−i) + possibly 1 alloc |
| Delete preserving order | `append(s[:i], s[i+1:]...)` | `slices.Delete(s, i, i+1)` | O(n−i) |
| Delete swap-and-pop | `s[i] = s[len(s)-1]; s = s[:len(s)-1]` | n/a (write inline) | O(1) |
| Cut range `[i,j)` | `append(s[:i], s[j:]...)` | `slices.Delete(s, i, j)` | O(n−j) |
| Push back | `s = append(s, x)` | n/a | amortized O(1) |
| Pop back | `x, s = s[len(s)-1], s[:len(s)-1]` | n/a | O(1) |
| Pop front | `x, s = s[0], s[1:]` | n/a | O(1), but leaks |
| Push front | `s = append([]T{x}, s...)` | `slices.Insert(s, 0, x)` | O(n) + 1 alloc |
| Reverse | two-finger swap loop | `slices.Reverse(s)` | O(n/2) swaps |

---

## 10. The two rules to internalize before reading anything else

**Rule 1: every trick is a slice-header edit plus maybe a memory move.** When the trick looks weird, draw the three header fields before and after; the trick becomes obvious.

**Rule 2: deleting pointer elements without zeroing them leaks memory.** The element is no longer reachable through the slice, but it *is* still reachable through the backing array. Go's escape analysis can't help you — you must overwrite the dead slot with `nil` (or the zero value) before shrinking `len`.

The `slices` package since Go 1.22 follows rule 2 for you. In hand-rolled tricks, you're on your own.

---

## 11. Things you can try today

1. Implement insert and delete (preserving order) on a `[]int`. Print before/after, and `len`/`cap` of each.
2. Take a `[]*[]byte` of 10 elements where each pointed-to slice is 1 MiB. Delete index 0 using the wrong trick (no zero) and using the right one. Compare `runtime.ReadMemStats().HeapAlloc` after `runtime.GC()`.
3. Write a stack (push/pop back) on top of `[]string`. Verify with a `strings.NewReader` parsing.
4. Rewrite the same stack using `slices.Insert` / `slices.Delete`. Compare line count and clarity.
5. Write a queue using pop-front. Push 10 000 items, pop 9 999, then `cap(q)` — note how big it still is.

---

## 12. Summary

Slice tricks are short expressions that perform structural edits on a slice — insert, delete, push, pop, reverse — using only `append`, `copy`, and slice expressions. Since Go 1.21 the `slices` package wraps the most common ones in typed generic functions; prefer those in new code. The wiki tricks are still essential because (a) older code uses them everywhere and (b) some operations (swap-and-pop delete, certain rotates) have no one-line stdlib form. The single most important caution: **deleting pointer elements without zeroing the now-dead slot leaks memory** because the backing array still references the element even though the slice's `len` no longer covers it.

---

## Further reading
- SliceTricks wiki: https://github.com/golang/go/wiki/SliceTricks
- `slices` package: https://pkg.go.dev/slices
- Sibling topic — slice header model: [../05-slice-header-internals/](../05-slice-header-internals/)
- Sibling topic — capacity and growth: [../01-capacity-and-growth/](../01-capacity-and-growth/)
