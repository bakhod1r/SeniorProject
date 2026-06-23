# Stdlib Generic Packages — Senior Level

## Table of Contents
1. [Algorithmic guarantees](#algorithmic-guarantees)
2. [In-place vs copying APIs](#in-place-vs-copying-apis)
3. [Aliasing pitfalls](#aliasing-pitfalls)
4. [When stdlib is good enough](#when-stdlib-is-good-enough)
5. [When to roll your own](#when-to-roll-your-own)
6. [Summary](#summary)

---

## Algorithmic guarantees

The Go standard library documents complexity, but a senior engineer must know what **algorithm** is actually used. The `slices` and `maps` packages give specific guarantees.

### `slices.Sort` — pdqsort

`slices.Sort` and `slices.SortFunc` use **pdqsort** (pattern-defeating quicksort), a 2016 algorithm by Orson Peters. Its properties:

- **Average:** `O(n log n)`
- **Worst case:** `O(n log n)` (unlike plain quicksort)
- **Memory:** `O(log n)` stack from recursion, no heap
- **Adaptive:** `O(n)` on already-sorted data
- **Unstable**

The pdqsort implementation in `slices` was contributed by the Go team and is faster than the old `sort.Sort` for most workloads — typically 30-50% on numeric slices, sometimes 2-3× on partially sorted data.

### `slices.SortStableFunc` — symmerge / mergesort hybrid

The stable variant uses a stable in-place merge sort, with `O(n log n)` time and `O(log² n)` extra stack. It is around 1.5-2× slower than the unstable version on random data.

### `slices.BinarySearch` — guaranteed lower-bound

Returns the index of the **first** element >= target if not found exactly. This makes it a "lower bound" search, not just a "find anything". The Go team documents this explicitly so callers can rely on it.

### `slices.Contains` — linear

`O(n)` always. There is no early termination beyond the obvious "stop on first match". For sorted data, prefer `BinarySearch`.

### `maps.Clone` — `O(n)` with allocator hints

`maps.Clone` calls into the runtime via `runtime.mapclone` (an unexported helper). It pre-sizes the destination map to the source size and copies entries with the runtime's internal layout knowledge — typically 2-3× faster than a `for k, v := range src { dst[k] = v }` loop.

### `slices.Equal` — short-circuit linear

Returns `false` on length mismatch immediately. Otherwise, `O(n)` comparisons.

### `cmp.Compare` — branchless on numeric types

For most numeric types, the compiler emits a branchless sequence (subtraction + sign extraction). For floats, NaN handling forces a branch. For strings, it delegates to `runtime.cmpstring`.

---

## In-place vs copying APIs

A senior engineer cares about **which functions mutate** and **which return new slices**.

### In-place (mutates the input)

| Function | Effect |
|----------|--------|
| `slices.Sort` | sorts in place |
| `slices.SortFunc` | sorts in place |
| `slices.Reverse` | reverses in place |
| `maps.Copy(dst, src)` | mutates `dst` |
| `maps.DeleteFunc(m, ...)` | mutates `m` |

### Returns a new slice

| Function | Returns |
|----------|---------|
| `slices.Clone` | new slice |
| `slices.Concat` | new slice (1.22+) |
| `slices.Sorted` | new sorted slice (1.23+) |
| `maps.Clone` | new map |

### Mutates **and** returns

The trickiest category — these mutate the input **and** return a (possibly different) slice header:

| Function | Behaviour |
|----------|-----------|
| `slices.Insert(s, i, v...)` | may reallocate; you must reassign |
| `slices.Delete(s, i, j)` | shifts elements left, zeroes tail; reassign |
| `slices.Compact(s)` | shifts elements left; reassign |
| `slices.Replace` | inserts and deletes; reassign |

Never write `slices.Insert(s, 0, x)` and discard the return value. The original `s` may now have stale length.

```go
// Wrong — silent bug
slices.Insert(s, 0, x)

// Right
s = slices.Insert(s, 0, x)
```

---

## Aliasing pitfalls

`slices.Compact`, `slices.Delete`, and `slices.Insert` may **alias** the input. Knowing when is critical.

### `slices.Compact` returns a prefix

```go
s := []int{1, 1, 2, 3, 3}
out := slices.Compact(s)
// out is s[:3] = [1 2 3], aliasing the same backing array
// s[3] and s[4] are zero — Compact zeroes the tail for GC
```

If you keep both `s` and `out`, mutating `out[i]` mutates `s[i]`. If you keep `s` after `Compact`, the trailing zeros are surprising.

### `slices.Delete` zeroes the tail

```go
s := []int{1, 2, 3, 4, 5}
s = slices.Delete(s, 1, 3) // remove indices 1 and 2
// s is now [1, 4, 5]; the underlying array's positions 3, 4 are zeroed
```

The zeroing matters for slices of pointers — without it, the GC could not reclaim the removed entries. The cost is `O(j - i)` extra writes.

### `slices.Insert` may reallocate

If `cap(s) < len(s) + len(v)`, `Insert` allocates a new backing array. Otherwise it shifts in place. Two cases means you cannot rely on either pointer identity or absence of allocation.

### `slices.Clone` is a shallow copy

`maps.Clone` and `slices.Clone` are **shallow**. If `T` is a pointer or contains pointers, the clone shares them with the original.

```go
type Box struct { inner *int }
orig := []Box{{inner: new(int)}}
cp := slices.Clone(orig)
*cp[0].inner = 99
// orig[0].inner now points to 99 too — shared *int
```

For deep copies, write your own with the same pattern but a per-element clone callback.

### `maps.Copy` doesn't allocate

`maps.Copy(dst, src)` writes each `src` entry into `dst`. It does not check whether `dst` is large enough — Go maps grow automatically. But the cost of growing while copying can dominate; pre-size with `make(map[K]V, len(src))` first.

---

## When stdlib is good enough

The `slices`, `maps`, and `cmp` packages cover the **majority** of slice and map operations a Go program needs. A senior engineer reaches for them when:

1. **The operation is named in the godoc** — do not reinvent.
2. **The performance is not in the top 1% hot path** — stdlib is well within 10% of any reasonable implementation.
3. **Type safety matters more than micro-optimization.**
4. **Testability is helped by using a well-known function name.** Reviewers immediately understand `slices.Contains(s, v)`.
5. **Cross-team or cross-project consistency** — every team uses the same primitives.

### Cases the stdlib already handles well

- Sorting any `[]T` with `cmp.Ordered` keys
- Multi-key sorting via `cmp.Or` chains
- Set-membership with `slices.Contains`
- Lower-bound search with `BinarySearch`
- Map cloning, key iteration, deletion by predicate
- Sorted dedup with `Sort` + `Compact`
- "First non-zero" with `cmp.Or`

---

## When to roll your own

Stdlib is not always the right answer. A senior engineer recognises the cases.

### 1. Missing operations

The `slices` package does **not** include:

- `Reduce` / `Fold`
- `GroupBy`
- `Chunk` / `Window`
- `ZipWith`
- `Unique` (it has `Compact` only after sorting)

If you need these, write them. Don't hack `slices.X` to fake them.

### 2. Specialized data structures

`maps` does not give you LRU, TTL, or concurrent maps. For those, third-party packages (`hashicorp/golang-lru/v2`, `puzpuzpuz/xsync`) or hand-rolled solutions are correct.

### 3. Performance hot paths

For numeric kernels processing tens of millions of elements per second, hand-tuned SIMD-friendly code may beat `slices.Sort`. Examples: sorting `[]float32` with a known small range can use radix sort. The stdlib intentionally chooses general-purpose algorithms.

### 4. Custom invariants

If your slice maintains an invariant (e.g., "sorted by Score with no duplicates"), wrapping the slice with a custom type and methods preserves the invariant better than calling raw `slices.X`.

```go
type SortedScores []Score
func (s *SortedScores) Add(v Score) {
    idx, _ := slices.BinarySearchFunc(*s, v, byScore)
    *s = slices.Insert(*s, idx, v)
}
```

The wrapping type ensures every insertion goes through the right call.

### 5. Domain-specific equality

`slices.Contains` uses `==`. If your equality is "same UUID even if other fields differ", use `slices.ContainsFunc`. Sometimes the predicate is so specific it deserves its own named function.

### 6. Generation semantics

The stdlib zeroes deleted slots. If your code already overwrites the tail, the extra writes are wasted. In that narrow case a hand-rolled `Delete` may be faster — but verify with benchmarks.

---

## API design lessons from the stdlib

The Go team's choices in `slices`, `maps`, `cmp` carry lessons for any generic library:

### Lesson 1 — Plain function for the common case, `Func` for flexibility

Every search/sort/compare in `slices` ships in two forms. The plain form requires a tighter constraint and gives clean call sites. The `Func` form takes a callback. Splitting these avoids forcing every user to write a comparator.

### Lesson 2 — `~[]E` and `~map[K]V` are mandatory

Without the tilde, named slice types would not satisfy the constraint. `type IDs []int; slices.Contains(ids, 5)` fails. The Go team learned from early `golang.org/x/exp/slices` feedback and the stdlib went straight to `~[]E`.

### Lesson 3 — Panics for clear preconditions

`slices.Min([])` panics. The team chose this over `(T, error)` because:
- `Min` is one expression in 99% of call sites; an error return clutters every line
- Empty input is a programmer bug, not a runtime condition
- The panic message is documented and discoverable

### Lesson 4 — Mutate-and-return for slice mutation

`Insert`, `Delete`, `Compact` all return `S`. Forces the caller to reassign — which is correct given that the slice header may change.

### Lesson 5 — One small helper package per concern

`cmp` contains three functions and one constraint. Tiny. The team resisted putting `Compare` and `Or` into `slices` to keep concepts separate. A user importing `cmp` reads the godoc in 30 seconds.

These lessons are worth applying to internal generic helpers your team writes.

## Summary

A senior engineer treats `slices`, `maps`, and `cmp` as the **default toolset**, with deliberate awareness of:

1. **Pdqsort** (unstable) vs the stable variant
2. **In-place** vs **copying** vs **mutate-and-return** semantics
3. **Aliasing** of `Compact`, `Delete`, `Insert`
4. **Shallow-copy** semantics of `Clone`
5. **Missing operations** that justify rolling your own
6. **Performance ceilings** where SIMD or domain-specific algorithms beat the general one

The standard library's stance is "good enough for almost everything, predictable and well-documented". A senior engineer reaches for it first, profiles when speed matters, and writes custom code only when the stdlib genuinely does not fit.

Move on to `professional.md` for the migration story across releases 1.21–1.24 and the team-level patterns that make these packages stick.
