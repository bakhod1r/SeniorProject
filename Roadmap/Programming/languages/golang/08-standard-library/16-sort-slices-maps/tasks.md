# 8.16 `sort`, `slices`, `maps` — Tasks

> **Audience.** You've read [junior.md](junior.md) and at least the
> first half of [middle.md](middle.md). These exercises take an hour
> at the early end and a half-day at the harder end. Each task lists a
> problem statement, acceptance criteria, and a stretch goal. No
> solutions — that's the point.

Common ground rules:

- Run with `go test -race`. Any race in your solution disqualifies it.
- Sort comparators must be valid strict weak orderings — no `<=`, no
  `time.Now()`, no random.
- Pre-allocate result slices when the size is known.
- Tests must use `bytes.Buffer` / `strings.Reader` for I/O when
  applicable, never real files.

## 1. Sort users by multi-key

Given `[]User` where `User` has fields `LastName`, `FirstName`, `Age`,
sort the slice ascending by last name, then first name, then age.

**Acceptance criteria.**

- Use `slices.SortFunc` (not `sort.Slice` or `sort.Sort`).
- Comparator must be a strict weak ordering (write a unit test that
  asserts `cmp(a, a) == 0` for several samples).
- Tie-breaker behavior is correct: equal last names are then ordered
  by first name; equal last+first names are ordered by age.
- Stable sort *not* required; tests verify the multi-key ordering
  directly without checking equal-element order.

**Stretch.** Use `cmp.Or` instead of cascaded `if` checks.

## 2. Top-K by score with `container/heap`

Given a stream of `(name, score)` pairs and an integer K, return the K
highest-scoring names.

**Acceptance criteria.**

- Single pass over the input; do not materialize the full stream.
- Memory usage is `O(K)`, independent of input size.
- Result is sorted by score, descending.
- Ties broken alphabetically by name (smaller name wins).
- Implementation uses `container/heap` (not `slices.Sort` of the
  whole input).

**Stretch.** Make the function generic on element type `T` with an
ordering function `cmp func(a, b T) int`.

## 3. Sorted-slice index

Build an `Index` type that wraps `[]Record` (each with a `Key string`
field) and exposes:

```go
type Index struct { /* ... */ }
func NewIndex(records []Record) *Index
func (ix *Index) Lookup(key string) (Record, bool)
func (ix *Index) Range(from, to string) []Record
```

**Acceptance criteria.**

- `NewIndex` clones the input (does not mutate the caller's slice).
- `Lookup` is `O(log n)` using `slices.BinarySearch`.
- `Range` returns all records with keys in `[from, to]` inclusive,
  using two binary searches.
- Test with at least 10k records and verify lookup correctness.
- Benchmark `Lookup` against a `map[string]Record` baseline; report
  the break-even point.

**Stretch.** Make `Index` generic on `K Ordered, V any` with a
key extractor function.

## 4. Stable group-by

Group `[]Order` by `Customer string` and produce
`map[string][]Order`. Within each group, preserve the input order.

**Acceptance criteria.**

- Each group's slice is in input order (stable).
- Function does not modify the input slice.
- Test: feed in 100 orders alternating between two customers; verify
  each customer's group has the orders in the correct order.

**Stretch.** Add a second variant that returns `[]Group` where
`Group = struct{ Key string; Items []Order }`, sorted alphabetically
by key.

## 5. Dedupe preserving order

Implement `func Dedupe[T comparable](s []T) []T` that returns a new
slice with each element appearing only once, in first-seen order.

**Acceptance criteria.**

- Returns a fresh slice; does not mutate the input.
- For input of length n, runs in O(n) time using a `map[T]struct{}`.
- For input of length 0, returns nil (or empty slice — both
  acceptable, document which).
- Compare with the sort-then-`Compact` approach in the same package;
  benchmark and document the trade-off.

**Stretch.** Add a `DedupeFunc[T any](s []T, key func(T) K) []T`
variant where `K comparable` is the dedupe key.

## 6. Top-N moving window

Given a stream of integers and a window size W, output the largest
value in each consecutive window of W.

**Acceptance criteria.**

- Output length is `len(input) - W + 1` (inclusive windows).
- Each window's max is computed in amortized O(1) using a deque
  (monotonic queue) — *not* by re-scanning the window.
- Tests cover W = 1, W = len(input), and intermediate.

**Stretch.** Generic over `T cmp.Ordered`. Then add a variant that
takes a comparator function for non-`Ordered` types.

## 7. Sort + binary-search + range query

Given a slice of `Event{ At time.Time; Detail string }`, build a
function that:

1. Sorts the slice in place by `At` (ascending).
2. Returns all events with `from <= e.At <= to` for arbitrary
   `from`, `to time.Time` values.

**Acceptance criteria.**

- After the sort, `slices.IsSortedFunc` confirms the ordering.
- Range queries use two `slices.BinarySearchFunc` calls; no linear
  scan.
- For `n = 10000` events and 1000 random range queries, total time
  is dominated by the sort (one `O(n log n)`) plus
  `O(query_count * log n)` lookups.
- Equal timestamps are handled — range query includes all matching
  events, not just one.

**Stretch.** Provide a `Subscribe(at time.Time) <-chan Event`
function that returns a channel emitting all events from `at` onward,
in chronological order, without re-sorting.

## 8. Map-of-slices merge

Given `a, b map[string][]int`, produce a merged map where each key's
value is the deduplicated sorted union of `a[k]` and `b[k]`.

**Acceptance criteria.**

- Keys present in only one input also appear in the output.
- Values are deduplicated — no duplicates within any slice.
- Each output slice is sorted ascending.
- Function does not mutate either input.

**Stretch.** Generic over `V cmp.Ordered`.

## 9. Schwartzian transform for expensive keys

Sort `[]Document` by `expensiveScore(d Document) float64` (a function
that takes ~100 microseconds per call). The slice has 50,000 elements.

**Acceptance criteria.**

- `expensiveScore` is called exactly `n` times (not `O(n log n)` times).
- Result is sorted descending by score.
- Use a Schwartzian transform: build a `[]struct{ Score; Doc }`,
  sort that, then project back.
- Benchmark against the naive `slices.SortFunc` that calls
  `expensiveScore` inside the comparator. Demonstrate at least a 5x
  speedup.

**Stretch.** Make the transform generic and reusable: `func
SortByKey[T any, K cmp.Ordered](s []T, key func(T) K)`.

## 10. Stable JSON serializer

Implement `MarshalStable(v any) ([]byte, error)` that produces JSON
with deterministic key order (sorted alphabetically) for all
`map[string]any` values it encounters, recursively.

**Acceptance criteria.**

- Output is valid JSON (round-trips through `json.Unmarshal`).
- For two equivalent maps with different insertion order, the output
  bytes are identical.
- Nested maps are also key-sorted recursively.
- Slices, strings, numbers, booleans, and nil pass through unchanged.
- Reuse `encoding/json` for primitives; only override the map case.

**Stretch.** Compare the output to `json.Marshal` of the same value
and verify the byte difference is purely key reordering.

## 11. Sort large slice with parallelism

Sort a `[]int` of 10 million elements using two goroutines that each
sort one half, followed by a merge.

**Acceptance criteria.**

- Total runtime measurably faster than single-threaded `slices.Sort`
  on a multi-core machine.
- Result is correctly sorted (`slices.IsSorted` returns true).
- No data races (`go test -race` passes).
- Memory overhead is documented: at least one auxiliary slice of
  size n/2 for the merge.

**Stretch.** Generalize to N goroutines (parallel merge sort).
Document the threshold below which the parallelism overhead exceeds
the gain.

## 12. Custom `sort.Interface` for a non-slice container

Implement `sort.Interface` on a custom container — say, a circular
buffer with random access:

```go
type RingBuffer struct {
    buf  []int
    head int
    size int
}
func (r *RingBuffer) Len() int            { /* ... */ }
func (r *RingBuffer) Less(i, j int) bool  { /* ... */ }
func (r *RingBuffer) Swap(i, j int)       { /* ... */ }
```

**Acceptance criteria.**

- `sort.Sort(rb)` produces a sorted ring buffer (with the same
  `head` semantics, content rearranged).
- A unit test fills, sorts, then iterates and verifies ascending
  order.
- The implementation is correct after wrap-around (sorting works
  when the buffer's logical start is not at index 0 of the
  underlying slice).

**Stretch.** Implement `slices.SortFunc`-style sorting on the same
container by exposing an `AsSlice() []int` view, sorting that, and
copying back.

## 13. Detect a violated `Less` function

Write a `ValidateLess[T any](samples []T, less func(a, b T) bool)
error` that checks whether `less` defines a strict weak ordering on
the given samples.

**Acceptance criteria.**

- Detects irreflexivity violations: `less(x, x) == true`.
- Detects asymmetry violations: `less(x, y) && less(y, x)`.
- Detects transitivity violations: `less(x, y) && less(y, z) &&
  !less(x, z)` (for some triple).
- Reports the violating values in the error message.
- Runs in `O(n³)` time — acceptable because this is for testing,
  not production.

**Stretch.** Property-based tester that generates random inputs and
quickfinds a minimal counter-example.

## 14. Implement `slices.Compact` from scratch

Re-implement `slices.Compact[T comparable](s []T) []T` without using
the standard library's version.

**Acceptance criteria.**

- Result matches `slices.Compact` exactly on a battery of test cases:
  empty slice, single element, all duplicates, no duplicates, mixed.
- Single pass, in-place, returns the truncated slice.
- Trailing slots beyond the new length are zeroed (Go 1.22+ behavior).
- Generic over `T comparable`.

**Stretch.** Implement `CompactFunc` next; make it generic over `T any`
with an equality function.

## 15. Reservoir sampling on a stream

Given a stream you cannot pre-count and an integer K, return K random
elements from the stream with uniform probability.

**Acceptance criteria.**

- Single pass; no rewinding the stream.
- Memory `O(K)`.
- The first K elements are always retained at first; from element K+1
  onwards, each new element replaces a random existing one with
  probability `K / current_index`.
- Distribution is uniform: a Monte Carlo test with 100k runs of a
  small stream shows each element selected ~K/N of the time.

**Stretch.** Make it generic on element type `T`. Make the random
source injectable (`*rand.Rand`) for deterministic tests.

## 16. Sort by external compare function (database results)

Imagine you receive `[]map[string]any` rows from a database and the
caller provides a sort key as a string (`"name"`, `"age"`, etc.).
Sort the rows by that key.

**Acceptance criteria.**

- Comparator handles string, int, int64, and float64 values.
- Mixed-type values (some rows have int for the key, some have float)
  are coerced to a common type before compare; document the rule.
- Missing key (key not present in a row) treats that row as smallest.
- Stable across equal keys (use `slices.SortStableFunc` or an
  explicit tie-breaker).

**Stretch.** Multi-key sort: caller passes `[]string{"-age", "name"}`
where leading `-` means descending.

## 17. Inverse map (group keys by value)

Given `map[string]int`, return `map[int][]string` where each int value
maps to all keys that pointed to it, sorted alphabetically.

**Acceptance criteria.**

- All input entries appear in the output.
- Each group's slice is sorted ascending (alphabetical for strings).
- The function does not mutate the input.
- For 10k entries, runs in `O(n log n)` total (dominated by sorting
  each group).

**Stretch.** Generic over `K comparable, V comparable`. Note that
when `V` is not `Ordered`, you can't sort each group — the caller
provides a comparator or accepts unsorted groups.

## 18. Build an ordered set type

Implement an `OrderedSet[T cmp.Ordered]` with operations: `Add`,
`Remove`, `Has`, `Len`, `Iterate` (in sorted order).

**Acceptance criteria.**

- `Add` and `Remove` work on a sorted slice using `BinarySearch` plus
  `Insert`/`Delete`.
- `Has` is `O(log n)`.
- `Iterate` returns items in ascending order.
- Adding a duplicate is a no-op (does not change `Len`).
- Removing an absent value is a no-op.

**Stretch.** Add `Union`, `Intersection`, `Difference` — implemented
in O(n+m) using two-pointer sweeps over the sorted slices.

## 19. Profile-driven sort optimization

Take a function that sorts a slice of `Order` (with about 30 fields
each) by `CreatedAt`. Profile it, then optimize.

**Acceptance criteria.**

- A `pprof` CPU profile shows the sort as a hot spot in the original
  version.
- Apply at least two optimizations from [professional.md](professional.md):
  pointer slice for sorting, comparator key precomputation, etc.
- Document the speedup ratio (before vs after) using
  `go test -bench` with `-count=10` and `benchstat`.

**Stretch.** Add a benchmark that varies the slice length (1K, 10K,
100K, 1M) and document where each optimization starts paying off.

## 20. The "stable result, random map iteration" test

Write a test that verifies a function's output is deterministic
*despite* the function internally iterating a map.

**Acceptance criteria.**

- Function takes `map[string]int` and returns a string concatenation
  of "key=value" pairs separated by commas.
- The same input map produces the same output bytes on every call —
  even though `for k := range m` is randomized.
- The test runs the function 100 times and asserts identical results.
- Hint: sort the keys.

**Stretch.** Test the negative case too: write a deliberately
nondeterministic version (no key sort), run it 100 times, and assert
that *at least* two calls produced different outputs (catches a
regression where someone removes the sort).

## 21. Interval merge

Given `[]Interval{ Start, End int }`, return a new slice of intervals
where overlapping intervals have been merged into one.

**Acceptance criteria.**

- Input `[{1,3}, {2,6}, {8,10}, {15,18}]` returns
  `[{1,6}, {8,10}, {15,18}]`.
- Function does not mutate the input.
- Sort by `Start` first using `slices.SortFunc`, then sweep.
- Handles edge cases: empty input, single interval, intervals with
  equal endpoints.

**Stretch.** Generic over endpoint type `T cmp.Ordered`. Then add a
`Subtract(a, b []Interval) []Interval` that returns regions covered
by `a` but not by `b` — the set-difference of two interval sets.

## 22. Frequency-sorted output

Given `[]string`, return a new slice with each element appearing once,
ordered by frequency in the input (most frequent first); break ties
alphabetically.

**Acceptance criteria.**

- Single pass to count, plus one sort.
- For `["a", "b", "a", "c", "b", "a"]` returns `["a", "b", "c"]`.
- For ties, alphabetical order is preserved.
- Uses `maps.Keys` (or the explicit collect loop) plus a comparator
  that captures the frequency map.

**Stretch.** Generic over `T comparable`, with an optional
tie-breaker comparator passed in. Make the function streaming:
process arbitrary `iter.Seq[T]` input rather than a slice (Go 1.23+).

## 23. Diff two slices

Given `[]string` `a` and `b`, return three slices: elements only in
`a`, elements only in `b`, and elements in both.

**Acceptance criteria.**

- Sort each input first; sweep with two pointers in `O(n + m)`.
- Function does not mutate inputs.
- Handles duplicates: if `a` has `"x"` twice and `b` has `"x"` once,
  `"x"` appears once in `both`, once in `onlyA`.
- Returns deterministic, sorted results.

**Stretch.** Generic over `T cmp.Ordered`. Add a variant taking a
comparator function for non-`Ordered` types.
