# Stdlib Generic Packages — Interview Q&A

## How to use this file

Each question has a **short answer** for memorization and a **long answer** for understanding.

Difficulty:
- 🟢 Beginner
- 🟡 Mid-level
- 🔴 Senior
- 🟣 Expert

---

## Beginner 🟢

### Q1. Which Go release added `slices`, `maps`, and `cmp` to the stdlib?
**Short:** Go 1.21 (August 2023).

**Long:** They had lived in `golang.org/x/exp/slices` and `golang.org/x/exp/maps` since Go 1.18. The team gathered a year of community feedback before promoting them to stdlib.

### Q2. Which package provides `cmp.Ordered`?
**Short:** `cmp`.

**Long:** Before 1.21 the analogous constraint was `golang.org/x/exp/constraints.Ordered`. Importing `cmp` is now the canonical way to write "this type supports `<`".

### Q3. What does `slices.Sort` do?
**Short:** Sorts a slice in place using `<`.

**Long:** It works on any `cmp.Ordered` type — integers, floats, strings. The algorithm is pdqsort (pattern-defeating quicksort), unstable, with `O(n log n)` worst-case time.

### Q4. Difference between `slices.Contains` and `slices.ContainsFunc`?
**Short:** `Contains` uses `==`; `ContainsFunc` takes a predicate.

**Long:** `Contains` requires `comparable`. `ContainsFunc` works on any `T` because the callback decides equality.

### Q5. Does `slices.Sort` allocate?
**Short:** No — it sorts in place.

**Long:** Pdqsort uses `O(log n)` stack space for recursion but no heap allocations.

### Q6. What does `slices.Min` return on an empty slice?
**Short:** It panics.

**Long:** The pkg-doc says explicitly: "Min panics if x is empty." Always guard `len(s) > 0` first or use a custom safe wrapper.

### Q7. What does `cmp.Compare` return?
**Short:** -1, 0, or +1 for `a<b`, `a==b`, `a>b`.

### Q8. What does `cmp.Or` do?
**Short:** Returns the first non-zero argument.

**Long:** Added in Go 1.22. Replaces "first non-empty string" chains. With no non-zero argument it returns the zero value of `T`.

### Q9. What's the constraint of `slices.Equal`?
**Short:** `comparable`.

**Long:** It uses `==` element-by-element. For non-comparable element types, use `slices.EqualFunc`.

### Q10. What does `maps.Clone` produce?
**Short:** A shallow copy of the map.

**Long:** Pointer values are shared with the original. For deep copies, write your own that clones each value.

---

## Mid-level 🟡

### Q11. Difference between `slices.Compact` and `slices.CompactFunc`?
**Short:** `Compact` uses `==`; `CompactFunc` takes a custom equality.

**Long:** Both remove **adjacent** duplicates only. To deduplicate the whole slice, sort it first.

### Q12. How do you sort a slice of structs by multiple fields?
**Short:** `slices.SortStableFunc(s, func(a, b T) int { return cmp.Or(cmp.Compare(a.X, b.X), cmp.Compare(a.Y, b.Y)) })`.

**Long:** `cmp.Or` returns the first non-zero argument, so the second `Compare` is only consulted when the first is equal. Stable sort prevents reshuffling on equal keys.

### Q13. When does `slices.Sort` allocate?
**Short:** Never — pdqsort is in place.

**Long:** Allocations would only appear if your comparator captures state into closures. The sort itself does not.

### Q14. What's the time complexity of `slices.BinarySearch`?
**Short:** `O(log n)`.

**Long:** It returns the index of the first element >= target plus a `bool` indicating exact match. The slice must be sorted, otherwise behaviour is unspecified.

### Q15. `slices.Index` vs `slices.IndexFunc`?
**Short:** `Index` returns the position of an exact match using `==`; `IndexFunc` uses a predicate.

**Long:** Both return `-1` when nothing matches. Use `IndexFunc` when the slice element is non-comparable or when you want a derived match (e.g., "first user older than 18").

### Q16. How do you deduplicate a slice fully?
**Short:** Sort first, then `slices.Compact`.

**Long:**
```go
slices.Sort(s)
s = slices.Compact(s)
```
Order is no longer preserved. To preserve order, write a manual loop with a `map[T]struct{}` seen-set.

### Q17. Why does `maps.Keys` return `iter.Seq[K]` in Go 1.23?
**Short:** Iterators are the new general-purpose collection-traversal abstraction.

**Long:** Go 1.23 promoted range-over-func to a stable feature. `maps.Keys` was changed to return an iterator so callers can range directly without allocating a slice. To get a slice, wrap with `slices.Collect`.

### Q18. How do you build a sorted slice of a map's keys?
**Short:** `slices.Sorted(maps.Keys(m))` (1.23+).

**Long:** This is one line in 1.23. In 1.21/1.22 it was `keys := maps.Keys(m); slices.Sort(keys)`.

### Q19. Is `slices.Sort` stable?
**Short:** No.

**Long:** Use `slices.SortStableFunc` if you need stability. The unstable version is faster.

### Q20. What does `slices.Delete` do to the freed slots?
**Short:** Zeroes them, then shifts.

**Long:** The zeroing allows the GC to reclaim the freed elements. The returned slice has the new length; the underlying array's tail no longer references your data.

---

## Senior 🔴

### Q21. Difference between `Compact` and `CompactFunc` in performance?
**Short:** `Compact` is slightly faster because `==` is inlined; `CompactFunc` calls through the dictionary or a closure.

**Long:** For numeric and string types, `slices.Compact` benefits from compiler inlining of `==`. `CompactFunc` is a function call per pair; it inlines too if the closure is simple, but rarely as efficiently.

### Q22. When should you choose `BinarySearch` over `Index`?
**Short:** When the slice is already sorted and N is large.

**Long:** `Index` is `O(n)`, `BinarySearch` is `O(log n)`. The break-even depends on constants but for `n > 20` or so binary search wins. For unsorted input, `BinarySearch` is unsound.

### Q23. How does `cmp.Compare` handle `NaN`?
**Short:** `NaN < anything else`, including other NaNs equal to themselves.

**Long:** `cmp.Compare` defines a total order so sorts are deterministic. The order is: `NaN < -inf < ... < +inf`, with `-0 < +0`. This contradicts IEEE-754 semantics where `NaN != NaN`, but it makes sort behaviour stable.

### Q24. Why does `slices.Insert` sometimes reallocate?
**Short:** Capacity may not fit the inserted elements.

**Long:** When `cap(s) >= len(s) + k` the function shifts existing elements right and writes new ones in place. When capacity is exceeded, it allocates a larger backing array and copies. Always reassign the return value.

### Q25. How do you express "sort descending" with `cmp.Compare`?
**Short:** Swap the arguments or negate the result.

**Long:**
```go
slices.SortFunc(s, func(a, b int) int { return cmp.Compare(b, a) })
// or
slices.SortFunc(s, func(a, b int) int { return -cmp.Compare(a, b) })
```
Both are valid. Swapping arguments is more idiomatic.

### Q26. When does `slices.Compact` alias the input?
**Short:** Always — it returns a prefix of the input.

**Long:** The returned slice shares the backing array. Mutating the result mutates the original up to the new length. Beyond the new length, slots are zeroed.

### Q27. How do you deduplicate while preserving order?
**Short:** Use a seen-set; do not use `Compact`.

**Long:**
```go
seen := map[T]struct{}{}
out := s[:0]
for _, v := range s {
    if _, ok := seen[v]; !ok {
        seen[v] = struct{}{}
        out = append(out, v)
    }
}
```
The seen-set adds `O(n)` memory but preserves first-occurrence order. `Compact` requires sorted input.

### Q28. Why isn't there a `slices.Reduce`?
**Short:** The Go team decided callbacks complicate the API and deferred it.

**Long:** Several proposals (e.g., golang/go#54768) suggested `Reduce[T, R]`. The team felt the function reads less clearly than a small for loop in idiomatic Go. The decision is not necessarily permanent — it may land in a future release.

### Q29. How does `maps.Clone` differ from `for k, v := range src { dst[k] = v }`?
**Short:** `maps.Clone` uses a runtime fast path that copies the map's internal hash table layout.

**Long:** The runtime helper pre-sizes the destination and copies buckets directly, skipping the hash recomputation that the for-loop version triggers. Benchmarks show 2-3× speedups on large maps.

### Q30. What pitfall does `cmp.Or` have with floats?
**Short:** `0.0` and `-0.0` are both zero — both treated as the zero value.

**Long:** `cmp.Or(0.0, -0.0, 5.0)` returns `5.0`. If you need to distinguish zero values, do not use `cmp.Or` on floats.

### Q31. Does `slices.Equal` short-circuit?
**Short:** Yes — it returns `false` immediately on length mismatch.

**Long:** It also short-circuits on the first unequal element. The `EqualFunc` variant short-circuits the same way.

### Q32. Why doesn't `slices.SortFunc` panic when the comparator is inconsistent?
**Short:** Behaviour is undefined; the sort may loop or produce wrong output.

**Long:** The Go team chose not to detect inconsistent comparators (e.g., `func(a, b T) int { return random() }`). Pdqsort assumes the comparator is a total order; violating that contract is the caller's bug.

---

## Expert 🟣

### Q33. Walk through the cost of `slices.SortFunc(people, func(a, b Person) int { ... })`.
**Short:** One call per comparison, indirect call through the closure, may inline.

**Long:** The `SortFunc` body lives in one shape (the function pointer is pointer-shaped). Inside, each comparator call goes through the function value. If the closure is simple, the compiler inlines it; otherwise it is a regular call. Pdqsort makes around `1.5 * n * log n` comparisons on random data.

### Q34. Why does `slices.Concat` allocate exactly once?
**Short:** It pre-computes total length and allocates once.

**Long:** Compare to `append(append(a, b...), c...)` which may reallocate twice. `Concat` walks the inputs to sum lengths, allocates a single backing array, then copies. The single-allocation guarantee is documented.

### Q35. How does `slices.BinarySearchFunc` differ when target type ≠ element type?
**Short:** The comparator is `func(elem, target) int`, so the target may have any type.

**Long:** This lets you search a `[]Person` for a string ID without constructing a fake `Person`:
```go
idx, ok := slices.BinarySearchFunc(people, "alice", func(p Person, name string) int {
    return cmp.Compare(p.Name, name)
})
```
The slice element type and target type are independent type parameters.

### Q36. Why is `Compact` faster than `CompactFunc` for `[]int`?
**Short:** `==` on `int` inlines; `func(a, b int) bool` does not always.

**Long:** For numeric types the compiler emits a single instruction for `==`. The closure adds a function pointer dereference and possibly an indirect call. For trivial closures the optimiser sometimes inlines, but not reliably across releases.

### Q37. Why doesn't `cmp.Or` short-circuit on side-effecting expressions?
**Short:** It does — it stops as soon as it finds a non-zero argument.

**Long:** `cmp.Or(a(), b(), c())` calls `a()`, `b()`, `c()` until it finds non-zero. **But** in Go, function arguments are evaluated **before** `cmp.Or` is called, so `a`, `b`, and `c` all execute regardless. To short-circuit you must write the chain manually with `||` or sequential ifs.

### Q38. How does `slices.Sort` perform on a sorted slice?
**Short:** `O(n)` — pdqsort detects sortedness.

**Long:** Pdqsort has an adaptive optimization: it scans the partition and if it is already sorted, it returns without recursion. This is a major win for "almost sorted" inputs common in real workloads.

### Q39. What's the catch with `slices.Sorted(seq)` on infinite iterators?
**Short:** It collects everything first; an infinite sequence will hang or OOM.

**Long:** `slices.Sorted` materializes the iterator into a slice, then sorts. For infinite iterators (e.g., `iter.Seq[int]` yielding forever), the function never returns. Use a bounded iterator or take a prefix with `slices.AppendSeq` against a length cap.

### Q40. How do generic type aliases (1.24+) affect `slices.X`?
**Short:** The `~[]E` constraint already accepts named slice types; aliases just add another layer.

**Long:** Pre-1.24, you could write `type IDs []int` and pass it to `slices.Contains` because the constraint is `~[]E`. From 1.24, you can write `type Vec[T any] = []T` and pass `Vec[int]` to the same function. The aliases interact cleanly with the existing tilde constraints.

---

## Summary

Memorize the **short answers** for fluency. The most common interview themes for this section:

- Which release added each function (1.21/1.22/1.23/1.24)
- Plain vs `*Func` variant — when each applies
- `slices.Sort` is **unstable**; `SortStableFunc` is stable
- `slices.Min`/`Max` panic on empty input
- `cmp.Or` returns first non-zero
- `slices.Compact` only removes adjacent duplicates — sort first
- `maps.Keys` returns an iterator in 1.23+
- `BinarySearchFunc` allows different element and target types

A confident candidate explains **what each function does, when it allocates, and what its complexity is** — not just the syntax.
