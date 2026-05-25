# Slice Tricks — Optimize

## 1. Goal of this file

This file is about **reducing allocations and CPU on slice-heavy hot paths**. The levers, in roughly the order they matter:

1. Preallocate when length is known (`make([]T, 0, n)` or `slices.Grow`).
2. Choose the cheapest trick for the operation (swap-and-pop, in-place filter).
3. Batch deletes instead of one-by-one.
4. Replace wiki tricks with `slices.*` helpers (free pointer-tail-zeroing, fewer allocations).
5. Use `sync.Pool` for transient scratch slices in hot paths.
6. Switch data structures (ring buffer, deque) when slice semantics force quadratic work.
7. Reuse `[:0]` for buffer recycling (with `clear` for pointer types).
8. Avoid `append` to a `nil` slice in a loop without bound.

Realistic wins on a typical Go service: 30–60 % fewer allocations on slice-heavy handlers, 5–20 % CPU reduction, dramatically lower steady-state heap.

---

## 2. Measurement baseline

Always measure first. The Go benchmark harness with `-benchmem` is the simplest tool:

```go
func BenchmarkFilter(b *testing.B) {
    src := make([]int, 1000)
    for i := range src {
        src[i] = i
    }
    b.ResetTimer()
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        s := slices.Clone(src)         // each iter starts fresh
        s = filter(s, func(x int) bool { return x%2 == 0 })
        _ = s
    }
}
```

```bash
go test -bench=BenchmarkFilter -benchmem -count=10
```

Output:

```
BenchmarkFilter-8   100000   18234 ns/op   16384 B/op   2 allocs/op
```

| Column | Meaning |
|--------|---------|
| `ns/op` | wall-clock per operation |
| `B/op` | bytes allocated per op (sum of heap allocations) |
| `allocs/op` | number of distinct heap allocations per op |

Two allocations per op means we have one we can probably drop. `pprof` finds it.

```bash
go test -bench=BenchmarkFilter -benchmem -memprofile=mem.out
go tool pprof -alloc_objects mem.out
(pprof) top10
(pprof) list filter
```

Run `list` to see which line allocates. Typically it's the `slices.Clone` (intentional, per iter) and the `make` inside filter (the target).

---

## 3. Prealloc — the single best optimization

The most universal win across slice-heavy code:

```go
// SLOW: log2(n) reallocations
result := []Foo{}
for _, x := range input {
    result = append(result, transform(x))
}
```

```go
// FAST: 1 allocation
result := make([]Foo, 0, len(input))
for _, x := range input {
    result = append(result, transform(x))
}
```

| Input size | Slow allocations | Fast allocations | Slow `B/op` | Fast `B/op` |
|------------|------------------|------------------|------------|-------------|
| 10 | 4 | 1 | ~240 | ~80 |
| 100 | 7 | 1 | ~2,400 | ~800 |
| 1,000 | 10 | 1 | ~25,000 | ~8,000 |
| 10,000 | 14 | 1 | ~250,000 | ~80,000 |

The slow version's `B/op` exceeds the fast version's by 2–3× because reallocation copies the existing data each time. The cumulative copy work for `append` to grow from 0 to `n` is roughly `2n` element-copies.

When the output size is unknown but estimable, use a guess:

```go
result := make([]Foo, 0, 64)  // typical case fits in 64
```

If wrong, `append` falls back to grow. Even a wrong guess is better than `len=0, cap=0`.

For "I have a slice and I'll grow it by k more elements":

```go
s = slices.Grow(s, k)   // ensures cap(s) >= len(s) + k
// then a loop of append, none of which reallocate
```

`slices.Grow` is idempotent: if `cap` is already sufficient, returns `s` unchanged.

---

## 4. The cheapest delete

Picking the right delete trick by intent:

| Intent | Trick | Cost |
|--------|-------|------|
| One element, preserve order | `slices.Delete(s, i, i+1)` | O(n−i) |
| One element, order-don't-care | swap-and-pop (`s[i] = s[len(s)-1]; s = s[:len(s)-1]`) | O(1) |
| Range, preserve order | `slices.Delete(s, i, j)` | O(n−j) |
| Many elements by predicate, preserve order | `slices.DeleteFunc(s, p)` | O(n) one-pass |
| Many elements by predicate, one-by-one | `for ... slices.Delete` | O(n × m) |

**The single largest win is batch-deleting.** Many one-by-one deletes is `O(n × m)`; one DeleteFunc pass is `O(n + m)`. For `n=10_000, m=100`:

| Strategy | Operations |
|----------|------------|
| One-by-one | ~1 000 000 element shifts |
| `DeleteFunc` | ~10 000 reads + ~9 900 writes |

Three orders of magnitude. Always batch.

If you've collected a set of IDs to delete:

```go
toDel := map[int]struct{}{...}

s = slices.DeleteFunc(s, func(x Item) bool {
    _, drop := toDel[x.ID]
    return drop
})
```

One pass, pointer-tail-clear handled automatically (Go 1.22+).

---

## 5. Replace wiki tricks with `slices.*`

Each replacement is small individually but compounds across a codebase:

| Wiki trick | `slices.*` | Wins |
|-----------|------------|------|
| `append(s[:i], append([]T{x}, s[i:]...)...)` | `slices.Insert(s, i, x)` | -1 alloc; 50 % fewer copies |
| `append(s[:i], s[i+1:]...)` | `slices.Delete(s, i, i+1)` | pointer-tail-clear |
| `append(s[:i], append(v, s[j:]...)...)` | `slices.Replace(s, i, j, v...)` | -1 alloc; pointer-tail-clear |
| `append([]T(nil), s...)` | `slices.Clone(s)` | readability |
| Nested-loop adjacent dedupe | `slices.Compact(s)` | readability; pointer-tail-clear |
| Two-finger reverse | `slices.Reverse(s)` | readability |

For a codebase migrating from pre-1.21 Go: a `grep -r 'append([^,]*\[:[^,]*\][^,]*, append'` finds most insert-trick sites; a similar grep finds delete tricks. Automated rewrites are feasible but `slices.*` requires the right Go version in go.mod.

---

## 6. `sync.Pool` for scratch slices

The pattern for a per-request scratch buffer:

```go
var bufPool = sync.Pool{
    New: func() any {
        b := make([]byte, 0, 4096)
        return &b
    },
}

func handle(req *Request) Response {
    bp := bufPool.Get().(*[]byte)
    defer func() {
        *bp = (*bp)[:0]   // reset len, keep cap
        bufPool.Put(bp)
    }()
    *bp = encode(*bp, req)
    return parse(*bp)
}
```

Three rules:

1. **Pool `*[]T`, not `[]T`.** Slice headers are values; pooling the pointer ensures `Put` sees the updated cap after `append` may have grown.
2. **Reset to `[:0]` before `Put`.** The cap is the reusable resource.
3. **Cap by size if upper bound matters.** A pool slice that grew to 10 MiB stays 10 MiB forever (until GC drops it).

```go
const maxReusableSize = 64 * 1024

defer func() {
    if cap(*bp) > maxReusableSize {
        return   // let GC reclaim oversized
    }
    *bp = (*bp)[:0]
    bufPool.Put(bp)
}()
```

`sync.Pool` is probabilistic — entries are dropped at every GC cycle. Use it for allocation pressure relief, not for correctness.

Pool wins are largest for: per-request JSON encode buffers, hash state objects, large temp slices that fit in `<10 MiB`. Wins are smallest for: small one-shot allocations, slices shorter than `~64 bytes` (escape analysis often keeps these on the stack anyway).

For `[]byte` specifically, consider `bytes.Buffer` which already pools internally via `bufPool`, or `bufio.Writer` for streaming.

---

## 7. Switch to a ring buffer for FIFO

A slice-based queue is quadratic on long runs (see [find-bug.md Bug 1](find-bug.md)). For any FIFO with more than a few thousand operations, switch:

```go
type Ring[T any] struct {
    buf            []T
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

Push and pop are amortized O(1). Backing storage is O(max depth ever), not O(operations). Popped slots are zeroed so pointer-element rings don't leak.

Benchmark comparison: 1M push/pop pairs on a ring vs a slice queue, with `*Job` of 1 KB:

| | Ring | Slice queue |
|-|------|-------------|
| ns/op (pair) | ~30 | ~50 |
| Steady-state heap | ~16 KiB (cap) | ~1 GiB and growing |
| GC pause p99 | < 1 ms | 30 ms+ |

The latency win is from the avoided GC; the heap win is from not retaining popped storage.

---

## 8. `[:0]` for buffer recycling

When a slice is fully overwritten on each iteration, you can reuse its capacity:

```go
var buf []int
for {
    buf = buf[:0]                     // reset len, keep cap
    buf = parse(input, buf)           // parse appends into buf
    process(buf)
}
```

After the first iteration, `cap(buf)` is large enough for typical inputs and never reallocates. The same buffer serves every iteration.

For pointer-element slices, **`clear` before `[:0]`** to release GC roots:

```go
var batch []*Job
for {
    clear(batch)
    batch = batch[:0]
    batch = collect(source, batch)
    process(batch)
}
```

Without `clear`, the old `*Job` values stay in `cap` slots until overwritten — or forever if subsequent iterations produce fewer jobs.

This pattern is the slice-equivalent of a free list and the workhorse of CPU-conscious Go code (parsers, log processors, codec inner loops).

---

## 9. Avoid quadratic patterns

A few patterns produce quadratic work without warning:

```go
// O(n^2): push-front in a loop
for _, x := range items {
    s = slices.Insert(s, 0, x)  // each insert is O(n)
}

// O(1) per op: append then reverse
for _, x := range items {
    s = append(s, x)
}
slices.Reverse(s)
```

```go
// O(n^2): mid-iteration delete
for i := 0; i < len(s); i++ {
    if shouldDelete(s[i]) {
        s = slices.Delete(s, i, i+1)
        i--
    }
}

// O(n): one-pass DeleteFunc
s = slices.DeleteFunc(s, shouldDelete)
```

```go
// O(n^2): nested loop dedupe
for i := 0; i < len(s); i++ {
    for j := i+1; j < len(s); j++ {
        if s[i] == s[j] {
            s = append(s[:j], s[j+1:]...)
            j--
        }
    }
}

// O(n): sort then Compact, or map-based
slices.Sort(s)
s = slices.Compact(s)
```

The pattern: if you find yourself nesting loops over the same slice or deleting in a loop, there is usually a one-pass alternative. Look for it.

---

## 10. `slices.Grow` over guessing

When the exact size isn't known but the *growth amount* is:

```go
s := loadInitial()
s = slices.Grow(s, expectedNewItems)
for _, x := range source {
    s = append(s, x)
}
```

`Grow` ensures cap is enough for `len(s) + expectedNewItems`. If the loop produces exactly that many, zero reallocations occur. If it produces more, only the overflow forces a grow (which is itself amortized).

Compare:

| Pattern | Allocs (for `n` appends) |
|---------|--------------------------|
| `append` from `nil` | `log2(n)` |
| `make([]T, 0, n)` upfront | 1 |
| `slices.Grow(s, n)` then append | 0 (if `s` had no cap), 1 (if grow needed) |
| `make([]T, n)` then index | 0 (well, 1 — the `make`) |

The last pattern (`make([]T, n)` + index) is the cheapest when `n` is known and you fill in deterministic order:

```go
result := make([]Foo, len(input))
for i, x := range input {
    result[i] = transform(x)
}
```

Versus `append`-with-prealloc, this skips the `len` update per element (small but real saving in tight loops) and produces clearer intent.

---

## 11. Defer the small allocations

Common small per-request allocations to look for:

| Allocation | Optimization |
|-----------|--------------|
| `make([]byte, 0, n)` for known small `n` | Use a stack buffer: `var buf [n]byte; b := buf[:0]` |
| `append([]int{x}, ...)` literal | `slices.Insert` or use `[]int{x}` from a pool |
| String→`[]byte` conversion in a loop | If read-only, `unsafe.Slice(unsafe.StringData(s), len(s))` |
| `[]byte→string` conversion in a loop | If short-lived, hold as `[]byte`; convert once at the boundary |
| `fmt.Sprintf` for log fields | Use `slog`'s key-value pairs; no formatting until handler runs |

For the stack-buffer trick:

```go
func parseTokens(s string) []string {
    var buf [32]string
    tokens := buf[:0]                      // backed by stack array
    for _, t := range strings.Split(s, ",") {
        tokens = append(tokens, t)
    }
    if len(tokens) <= 32 {
        // tokens still on stack
        return slices.Clone(tokens)        // copy out only at the return
    }
    // overflow: heap
    return tokens
}
```

Escape analysis keeps `buf` on the stack if it doesn't escape. `tokens := buf[:0]` is a sub-slice of the stack-allocated array. `append` writes into the stack as long as cap suffices. Only the final `slices.Clone` allocates.

This optimization is fragile — escape analysis decisions can flip with a refactor. Verify with `go build -gcflags="-m=2"`.

---

## 12. `append` cost: when growing matters

`runtime.growslice` does three things:

1. Picks a new cap based on the element size and current cap.
2. Allocates a new backing array.
3. Copies the existing elements over.

For `[]byte` of size 1 KB → 2 KB: about 1 KB of memory copy. For `[]int` of size 1000 → 2000: 8 KB copy. The runtime uses size-class rounding (Go 1.18+) to pick the cap, so actual cap may be slightly larger than the doubled value.

For elements with pointers, the copy also runs the write barrier per element, which is slower than a `memmove`. **Growing a `[]*T` is materially more expensive than growing a `[]int`** — sometimes 2–3× slower for the same `len`.

Implication: when you can predict the final size, prealloc — and especially prealloc for pointer-element slices.

---

## 13. Iterators (`iter.Seq`) — when not building a slice

Go 1.23+ adds `iter.Seq` for lazy sequences. When the caller is just iterating, you can skip building a slice entirely:

```go
// Instead of returning []T
func (s *Store) Items() []Item {
    return slices.Clone(s.items)   // allocation
}

// Return an iterator
func (s *Store) Items() iter.Seq[Item] {
    return func(yield func(Item) bool) {
        for _, it := range s.items {
            if !yield(it) {
                return
            }
        }
    }
}

// Caller
for it := range store.Items() {
    process(it)
}
```

Allocation: the closure literal (usually escape-analyzed to the heap). Per-element cost: one indirect call. For "iterate once and discard" use cases, iterators are cheaper than slices. For "store and index repeatedly" use cases, slices remain optimal.

---

## 14. Compiler tools and flags

Useful invocations during optimization work:

```bash
# escape analysis
go build -gcflags="-m=2" ./... 2>&1 | grep -i 'escape\|moved to heap'

# inline decisions
go build -gcflags="-m -l=4" ./... 2>&1 | grep 'inline'

# assembly for a function
go tool objdump -s "package.Func" ./binary

# benchstat for comparing benchmark runs
go install golang.org/x/perf/cmd/benchstat@latest
go test -bench=. -count=10 > old.txt
# make change
go test -bench=. -count=10 > new.txt
benchstat old.txt new.txt
```

`benchstat` reports the geometric-mean delta and a confidence interval. Treat any change without `(p<0.05)` as noise.

---

## 15. PGO and slice tricks

Profile-guided optimization (Go 1.21+) targets the hot path; slice operations on the hot path benefit, but the wins are usually small (2–5 %) compared to algorithmic changes. PGO is the icing; preallocation and the right trick choice are the cake.

```bash
# Capture profile from a representative workload
curl -o cpu.pprof http://localhost:6060/debug/pprof/profile?seconds=30

# Build with PGO
go build -pgo=cpu.pprof -o app ./cmd/server
```

PGO can inline `slices.X` helpers across boundaries, eliminate redundant bounds checks in known-size loops, and pick better register allocation in tight slice loops. Not as transformative as switching from `append`-in-loop to `make + index`, but worth applying once those low-hanging fruits are picked.

---

## 16. The optimization checklist

Run through this on every slice-heavy hot path before declaring it done:

1. [ ] All append-in-loop have `make([]T, 0, n)` prealloc when `n` is known or estimable.
2. [ ] All `slices.X(s, ...)` calls capture the return value (`s = slices.X(...)`).
3. [ ] Deletes are batched with `slices.DeleteFunc`, never one-by-one in a loop.
4. [ ] Pointer-element slices `clear(s[n:])` before shrink, or use `slices.*` (Go 1.22+).
5. [ ] No `append([]T{x}, s...)` for push-front in a loop — use append-then-reverse or a deque.
6. [ ] Long-lived FIFOs use a ring buffer, not a slice queue.
7. [ ] Per-request scratch slices are pooled via `sync.Pool` (with size cap).
8. [ ] Returning slices from a public API uses `slices.Clone` or `s[:len(s):len(s)]`.
9. [ ] No mid-iteration deletes from the slice being iterated.
10. [ ] Sub-slices returned to untrusted callers use the three-index form `s[i:j:j]`.
11. [ ] No `s[:0]` for pointer slices without preceding `clear`.
12. [ ] Iterator (`iter.Seq`) used when the caller never needs the materialized slice.
13. [ ] Benchmarks (`-benchmem`) recorded baseline and post-optimization; difference verified with `benchstat`.

---

## 17. Real-world wins

Three composite case studies from real services:

**Case A — JSON-decoding handler.** Decoding a 10 KB JSON array of 1000 small structs. Baseline: 47 allocs/op, 32 KB B/op. After preallocating the result slice and replacing `append([]T(nil), src...)` with `slices.Clone`: 12 allocs/op, 18 KB B/op. p50 latency: 0.8 ms → 0.5 ms.

**Case B — Event-bus dispatcher.** Slice queue holding pending events. Symptom: heap grows to 4 GiB over a week. Fix: replace slice queue with ring buffer; zero popped slots. Steady-state heap drops to ~50 MiB.

**Case C — Batch update.** Removing N users from a slice of all users, called N times: O(N²). Fix: collect IDs to delete, one-pass `slices.DeleteFunc`. Time on 100k slice with 1k deletes: 4.2 s → 12 ms. Three orders of magnitude.

The pattern across all three: the wrong trick (`append` in a loop without prealloc, slice as queue, one-by-one delete) was the culprit. Each fix is small and local.

---

## 18. Summary

Optimizing slice tricks is mostly: preallocate when size is known, batch deletes, swap wiki tricks for `slices.*` (which gets pointer-safety and one-allocation insert/replace for free), pool transient buffers, and switch to ring buffers for FIFOs. The single largest win is usually preallocation; the second is replacing quadratic patterns with one-pass equivalents. Profile-driven (`-benchmem`, `pprof`, `benchstat`) workflow tells you which line is the offender and proves the fix. PGO is a small additional win once the basics are right.

---

## Further reading
- `slices` package: https://pkg.go.dev/slices
- `runtime/metrics`: https://pkg.go.dev/runtime/metrics
- `sync.Pool` docs: https://pkg.go.dev/sync#Pool
- `pprof` user guide: https://github.com/google/pprof/blob/main/doc/README.md
- `benchstat`: https://pkg.go.dev/golang.org/x/perf/cmd/benchstat
- Sibling — capacity and growth (preallocation deep dive): [../01-capacity-and-growth/optimize.md](../01-capacity-and-growth/optimize.md)
- Sibling — slice header internals: [../05-slice-header-internals/](../05-slice-header-internals/)
