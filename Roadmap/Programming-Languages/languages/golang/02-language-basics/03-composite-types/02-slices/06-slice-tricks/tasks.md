# Slice Tricks — Hands-on Tasks

Work through these in order. Each has explicit acceptance criteria. You need Go 1.21+ (1.22+ recommended) and `go test -bench` to verify the allocation claims.

---

## Task 1: Implement every basic trick by hand

Write a single Go file `tricks.go` containing **hand-written** versions of: insert, delete (preserving order), delete (swap-and-pop), cut range, push back, pop back, push front, pop front, and reverse — all on `[]int`. No `slices.*` imports allowed.

**Acceptance criteria**
- [ ] Each function has a doc comment listing the asymptotic time cost.
- [ ] Each function works for the empty slice and the singleton slice without panicking.
- [ ] A `TestAll` runs each operation against a `[1,2,3,4,5]` input and asserts the expected result.
- [ ] `go vet ./...` is clean.

---

## Task 2: Compare trick vs `slices.*` allocations

Take the insert and delete tricks from Task 1. Write benchmarks for each, against the matching `slices.Insert` / `slices.Delete` call, on slices of size 100, 1000, and 10 000.

**Acceptance criteria**
- [ ] You run `go test -bench=. -benchmem -count=5 ./...`.
- [ ] Output table shows `B/op` and `allocs/op` for each combination.
- [ ] You can explain why `slices.Insert` allocates 0 when `cap` fits and 1 otherwise, while the wiki trick always allocates at least 1.
- [ ] You document the crossover point where the difference becomes a > 10 % speed gap.

---

## Task 3: Demonstrate the pointer-element leak

Create `[]*Job` where `Job` holds a `[1 << 20]byte` (1 MiB) field. Push 100 jobs. Then:

1. **Bad version**: delete the first 90 using `s = append(s[:0], s[90:]...)`. Force `runtime.GC()`. Read `runtime.MemStats.HeapAlloc`.
2. **Good version**: delete the first 90 using a copy + `clear` + reslice. Same GC + measurement.

**Acceptance criteria**
- [ ] The bad version's heap is at least 80 MiB higher than the good version's after GC.
- [ ] You print the slice's `cap` in both versions to show storage isn't released either way.
- [ ] You verify the fix using `slices.Delete(s, 0, 90)` (Go 1.22+) — it should match the good version.

---

## Task 4: Implement a generic ring buffer

Build `Ring[T any]` supporting `Push`, `Pop`, `Len`, `Cap`, with amortized O(1) Push and Pop, and explicit zeroing of popped slots for GC safety. Use the API and structure described in [professional.md §3](professional.md).

**Acceptance criteria**
- [ ] Push 1000 elements then Pop 500 — `Len` is 500, `Cap` is at least 1000.
- [ ] Push then Pop alternating 1M times — `Cap` never exceeds 4× the maximum ever seen `Len`.
- [ ] For `Ring[*Job]` with 1 MiB jobs: after Pop, the popped slot is `nil` (verify via reflection or by exposing a `peek` method).
- [ ] Benchmark Push/Pop pairs against a slice-based queue; ring should win on both throughput and steady-state memory.

---

## Task 5: Implement filter-in-place vs filter-allocating

Write two filter functions:

```go
func FilterInPlace[T any](s []T, keep func(T) bool) []T
func FilterCopy[T any](s []T, keep func(T) bool) []T
```

**Acceptance criteria**
- [ ] In-place version mutates input and returns a sub-slice; zero allocations except for the optional tail-clear of pointer-element slices.
- [ ] Copy version leaves input untouched; one allocation (the new backing array).
- [ ] Tests verify that for `T = *struct{...}`, in-place properly zeroes the tail using `clear(s[n:])`.
- [ ] Benchmarks show in-place wins on memory; copy wins on caller-isolation.

---

## Task 6: Three-reverses rotate

Implement `RotateLeft[T any](s []T, k int)` using the three-reverses trick. Then implement `RotateRight[T any](s []T, k int)` in terms of `RotateLeft`.

**Acceptance criteria**
- [ ] `RotateLeft` allocates zero bytes (verify with `-benchmem`).
- [ ] Works for `k > len(s)` (modular reduction).
- [ ] Works for `k < 0` (right rotation).
- [ ] Works for the empty slice.
- [ ] `RotateRight(s, k)` is equivalent to `RotateLeft(s, len(s)-k)`.

---

## Task 7: Dedupe three ways

Write three dedupe implementations for `[]string`:

1. `DedupeSorted` — requires sorted input, uses `slices.Compact`.
2. `DedupeMapPreserveOrder` — unsorted, preserves first occurrence order, uses a map.
3. `DedupeSortThenCompact` — unsorted, may reorder, uses `slices.Sort` + `slices.Compact`.

**Acceptance criteria**
- [ ] Each function has correctness tests on a 100-element input with 30 duplicates.
- [ ] Benchmarks for input sizes 10, 100, 1000, 10 000.
- [ ] You identify the crossover where map-based becomes faster than sort+compact (typically around N < 1000 for strings).
- [ ] You document the memory and order trade-offs in a comment at the top of each.

---

## Task 8: Chunk a slice two ways

Write:

1. `ChunkShare[T any](s []T, k int) [][]T` — each sub-slice shares the backing array of `s`.
2. `ChunkCopy[T any](s []T, k int) [][]T` — each sub-slice is an independent clone.

Then write a test that demonstrates the mutation behavior of each.

**Acceptance criteria**
- [ ] `ChunkShare` allocates exactly 1 (the outer `[][]T`).
- [ ] `ChunkCopy` allocates `1 + ceil(len(s)/k)`.
- [ ] Mutation test: modify `chunks[0][0]` — for `Share`, `s[0]` changes; for `Copy`, `s[0]` is unchanged.
- [ ] You compare against `slices.Chunk` (Go 1.23+) and document the differences.

---

## Task 9: Build a queue that never leaks

Take a naive slice-based FIFO:

```go
type Queue[T any] struct{ data []T }

func (q *Queue[T]) Push(x T) { q.data = append(q.data, x) }
func (q *Queue[T]) Pop() (T, bool) {
    var zero T
    if len(q.data) == 0 { return zero, false }
    x := q.data[0]
    q.data = q.data[1:]
    return x, true
}
```

Replace with a leak-free implementation that bounds backing storage by max-depth-ever-seen.

**Acceptance criteria**
- [ ] Push 1M elements, then Pop 999 999 — `cap(internal buffer)` should be O(max ever depth), not O(operations).
- [ ] For `Queue[*Job]` (with `Job` holding 1 MiB): the popped jobs are GC-reclaimed after `runtime.GC()`.
- [ ] You document the trade-off vs the naive slice queue.

---

## Task 10: Allocation-profile a real handler

Pick (or write) a small HTTP handler that decodes a JSON array, filters it, sorts it, and re-encodes it. Run `go test -bench -benchmem` and `pprof`.

**Acceptance criteria**
- [ ] You record the baseline `allocs/op` and `B/op`.
- [ ] You apply at least three optimizations: preallocate with `make([]T, 0, n)`, replace wiki tricks with `slices.*`, and use `sync.Pool` for the JSON buffer.
- [ ] The optimized version has at least 30 % fewer `allocs/op`.
- [ ] You use `go tool pprof -alloc_space` to identify which line was the biggest allocator before and after.

---

## Task 11: Replace `append` with `slices.Grow`

Find a loop in your codebase (or write one) that does `s = append(s, ...)` `n` times where `n` is roughly known. Replace it with `slices.Grow(s, n)` before the loop.

**Acceptance criteria**
- [ ] You record `allocs/op` before and after.
- [ ] After replacement, `allocs/op` drops from `log2(n)` to 1.
- [ ] You verify the resulting slices are bit-identical in content.

---

## Task 12: Write a `Snapshot` API

Build a `Store[T any]` with thread-safe `Add(x T)` and `Snapshot() []T`. Snapshot should return a slice safe for the caller to mutate without affecting the store.

**Acceptance criteria**
- [ ] Snapshot returns `slices.Clone(internal)` for full isolation.
- [ ] A second variant `SnapshotScoped()` returns `internal[:len(internal):len(internal)]` (scoped clone) — caller's `append` allocates, but element-write still mutates.
- [ ] You document the right choice per use case.
- [ ] Concurrent test: 10 goroutines call `Add`, one calls `Snapshot` repeatedly — no race detected by `go test -race`.

---

## 13. Summary

These twelve tasks walk every category covered by [junior.md](junior.md), [middle.md](middle.md), [senior.md](senior.md), [professional.md](professional.md), and [optimize.md](optimize.md): hand-rolled tricks (Task 1), trick-vs-helper allocation (Task 2), pointer-leak demonstration (Task 3), ring buffer (Task 4), filter and rotate (Tasks 5–6), dedupe (Task 7), chunking (Task 8), production queue (Task 9), real-handler profiling (Task 10), prealloc with `slices.Grow` (Task 11), and a thread-safe Snapshot API (Task 12). By the end you have hands-on familiarity with every canonical trick, their allocation profiles, and the production patterns that make slice-heavy Go code fast and leak-free.

---

## Further reading
- SliceTricks wiki: https://github.com/golang/go/wiki/SliceTricks
- `slices` package: https://pkg.go.dev/slices
- `go test -benchmem`: https://pkg.go.dev/cmd/go#hdr-Testing_flags
- `pprof` user guide: https://github.com/google/pprof/blob/main/doc/README.md
- Sibling — capacity and growth tasks: [../01-capacity-and-growth/tasks.md](../01-capacity-and-growth/tasks.md)
