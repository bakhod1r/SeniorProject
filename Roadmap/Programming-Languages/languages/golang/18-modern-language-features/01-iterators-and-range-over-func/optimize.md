# Iterators & Range-over-Func — Optimization

> Honest framing first: a push iterator (`iter.Seq`) is, when inlined, a plain loop — the same machine code you would write by hand, with zero heap allocation. The performance story is therefore not "make the iterator fast" but "keep it on the inlined, non-escaping path, and don't reach for the heavyweight forms (`iter.Pull`, channel-backed sequences) when the lightweight one suffices." Most iterator performance problems are really *shape* problems: an interface dispatch that defeats inlining, a deep dynamic pipeline that allocates closures, or a pull iterator where push would do.
>
> Each entry below states the problem, shows a "before" and "after", and the realistic gain. The closing sections cover measurement and the cases where iterators are the wrong tool.

---

## Optimization 1 — Keep the iterator concrete so it inlines

**Problem:** Passing an iterator through an `iter.Seq[T]` variable that the compiler cannot devirtualise forces the synthesised `yield` closure to escape to the heap, adding an allocation per loop (and sometimes per element).

**Before:**
```go
var seq iter.Seq[int] = Count(1000) // opaque to the caller's loop
sum := 0
for v := range seq {
    sum += v
}
```
`-gcflags=-m` shows the `yield` closure escaping; `-benchmem` shows non-zero `allocs/op`.

**After:**
```go
sum := 0
for v := range Count(1000) { // concrete call — inlinable
    sum += v
}
```

**Expected gain:** Drops to `0 allocs/op` on the per-element path and collapses to a plain loop. The win is small per call but compounds on hot paths called millions of times.

---

## Optimization 2 — Prefer push (`for range`) over `iter.Pull`

**Problem:** `iter.Pull` runs the producer on a coroutine and hands back `next`/`stop`. Every element costs a coroutine switch; every pull iterator costs a goroutine. People reach for it for "control" when a plain `for range` would do.

**Before:**
```go
next, stop := iter.Pull(seq)
defer stop()
for {
    v, ok := next()
    if !ok { break }
    use(v)
}
```

**After:**
```go
for v := range seq {
    use(v)
}
```

**Expected gain:** Eliminates a goroutine and a coroutine switch per element. For tight loops the push form is several times faster and allocation-free. Reserve `iter.Pull` for merge/zip/interleave where push genuinely cannot express the iteration.

---

## Optimization 3 — Fuse deep pipelines on hot paths

**Problem:** A pipeline `Take(Map(Filter(src, p), f), n)` is elegant, but a *deep* or *dynamically built* chain may exceed the inliner's budget, allocate a closure per layer, and pay a function call per element per layer.

**Before:**
```go
out := Take(Map(Filter(Values(s), isEven), square), 1000)
for v := range out { acc += v }
```
On a very hot path with many layers, `-benchmem` shows allocations and `pprof` shows per-layer closure frames.

**After (fuse the hot operators into one):**
```go
func filterMapTake(s []int, keep func(int) bool, f func(int) int, n int) iter.Seq[int] {
    return func(yield func(int) bool) {
        c := 0
        for _, v := range s {
            if !keep(v) { continue }
            if c >= n { return }
            if !yield(f(v)) { return }
            c++
        }
    }
}
```

**Expected gain:** One closure instead of three or four; better inlining; fewer per-element calls. Only worth doing where profiling shows the pipeline on the hot path — for cold/clarity-first code, keep the composable form.

---

## Optimization 4 — Don't wrap a slice you already have

**Problem:** Code routes an in-memory slice through `slices.Values` purely out of habit, adding an indirection for no benefit.

**Before:**
```go
for v := range slices.Values(s) {
    use(v)
}
```

**After:**
```go
for _, v := range s {
    use(v)
}
```

**Expected gain:** Identical when inlined, but the direct form is unambiguously zero-cost, simpler, and gives you the index for free. Use `slices.Values` only when you need a `Seq[T]` to *pass somewhere* (a combinator, a function parameter), not to loop locally.

---

## Optimization 5 — Pre-size when collecting a known length

**Problem:** `slices.Collect` is an `append` loop; for a large iterator of known size it reallocates the backing array several times as it grows.

**Before:**
```go
out := slices.Collect(seq) // grows by reallocation
```

**After (when the count is known):**
```go
out := make([]T, 0, n)
for v := range seq {
    out = append(out, v)
}
// or, if seq comes from a slice: slices.AppendSeq(make([]T, 0, n), seq)
```

**Expected gain:** Eliminates intermediate reallocations and copies for large collections. For unknown or small sizes, `slices.Collect` is fine — its amortised growth is the standard `append` behaviour.

---

## Optimization 6 — Use laziness to avoid work, not just memory

**Problem:** Code that materialises an entire sequence and then takes the first match pays for every element even though it needed one.

**Before:**
```go
all := slices.Collect(AllUsers())   // fetches every page
var found User
for _, u := range all {
    if u.ID == target { found = u; break }
}
```

**After (let the iterator stop early):**
```go
for u := range AllUsers() {
    if u.ID == target {
        found = u
        break // iterator stops; later pages never fetched
    }
}
```

**Expected gain:** The biggest practical win of iterators. For a paginated source, finding the target on page 1 avoids fetching pages 2..N entirely — turning an O(total) scan into O(until-found). No allocation of the full slice either.

---

## Optimization 7 — Avoid per-element allocations inside the iterator

**Problem:** An iterator that allocates a new object per `yield` (a map, a slice, a boxed value) generates garbage proportional to the sequence length, dwarfing the iterator's own overhead.

**Before:**
```go
return func(yield func(map[string]string) bool) {
    for _, row := range rows {
        m := map[string]string{} // bug: alloc per element
        fill(m, row)
        if !yield(m) { return }
    }
}
```

**After (yield a reusable value, or a struct, documenting aliasing):**
```go
return func(yield func(*Row) bool) {
    var r Row // reused; document that it is only valid until next iteration
    for _, raw := range rows {
        r.reset()
        fill(&r, raw)
        if !yield(&r) { return }
    }
}
```

**Expected gain:** Drops per-element allocations to zero on the hot path. Caveat: reusing a value means the consumer must not retain it past the iteration — document this loudly, because retaining it is a real aliasing bug (see find-bug Bug 14). If consumers need to retain, yield a copy and accept the allocation.

---

## Optimization 8 — Replace channel-backed sequences with push iterators

**Problem:** Pre-1.23 code exposed sequences as `<-chan T` fed by a goroutine. Every element pays a channel send/receive and scheduler round-trip; abandoned consumers leak the producer goroutine.

**Before:**
```go
func Stream() <-chan int {
    ch := make(chan int)
    go func() {
        defer close(ch)
        for i := 0; i < n; i++ { ch <- i }
    }()
    return ch
}
for v := range Stream() { use(v) } // leaks goroutine if you break early
```

**After:**
```go
func Stream() iter.Seq[int] {
    return func(yield func(int) bool) {
        for i := 0; i < n; i++ {
            if !yield(i) { return }
        }
    }
}
for v := range Stream() { use(v) } // synchronous, leak-clean, inlinable
```

**Expected gain:** Removes the goroutine, the channel ops, and the early-break leak. For in-process single-consumer iteration the push iterator is dramatically faster and safer. (Keep channels only where you need actual concurrency or fan-out.)

---

## Optimization 9 — Bound the inliner: keep iterator bodies small

**Problem:** A large iterator body (lots of logic between `yield` calls) exceeds the inliner's cost budget; the iterator is not inlined, the `yield` closure escapes, and you lose the zero-allocation property.

**Before:** A 60-line iterator with branches, logging, and helper calls inline-blocked.

**After:** Factor the heavy work into helper functions the iterator *calls*, keeping the iterator's own body (the loop + `yield`) lean enough to inline:
```go
return func(yield func(T) bool) {
    for _, raw := range src {
        v, ok := transform(raw) // heavy work in a non-inlined helper
        if !ok { continue }
        if !yield(v) { return }
    }
}
```

**Expected gain:** Restores inlining of the loop skeleton even when the per-element work is heavy. The work itself still costs what it costs, but the iterator overhead returns to zero. Verify with `go build -gcflags='-m=2'`.

---

## Optimization 10 — Stop early in combinators by forwarding `false` promptly

**Problem:** A combinator that does extra work *after* the consumer has signalled stop wastes cycles and can desync the pipeline.

**Before:**
```go
func Map[A, B any](seq iter.Seq[A], f func(A) B) iter.Seq[B] {
    return func(yield func(B) bool) {
        for a := range seq {
            b := f(a)        // computed even when we're about to stop
            ok := yield(b)
            log(b)           // runs after yield, even on stop
            if !ok { return }
        }
    }
}
```

**After (return immediately on `false`):**
```go
func Map[A, B any](seq iter.Seq[A], f func(A) B) iter.Seq[B] {
    return func(yield func(B) bool) {
        for a := range seq {
            if !yield(f(a)) {
                return // forward stop instantly; no trailing work
            }
        }
    }
}
```

**Expected gain:** Short-circuiting propagates up the whole pipeline with no wasted per-element work after the consumer breaks. On a `Take(.., k)` over a huge source this is the difference between O(k) and O(n) work upstream.

---

## Benchmarking and Measurement

Optimization without measurement is folklore. For iterators the most useful signals are:

```bash
# Allocations and ns/op on the per-element path
go test -bench=. -benchmem ./...

# Did the iterator inline? Did the yield closure escape?
go build -gcflags='-m'  ./...
go build -gcflags='-m=2' ./...   # verbose inlining reasoning

# Where does time actually go in a deep pipeline?
go test -bench=Pipeline -cpuprofile cpu.out ./...
go tool pprof -top cpu.out

# Detect goroutine leaks from iter.Pull (missing stop())
# in tests: go.uber.org/goleak, or compare runtime.NumGoroutine()
```

Two numbers matter most: **`allocs/op` on the per-element loop** (should be 0 for a clean inlined iterator) and **`ns/op` versus an equivalent hand-written loop** (should be near-parity). If `allocs/op` is non-zero, the `-m` output names the escaping closure; that is your lever. For pull-based code, watch goroutine count under load.

A reliable baseline benchmark:
```go
func BenchmarkIter(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        sum := 0
        for v := range Count(1000) {
            sum += v
        }
        sink = sum
    }
}
```
Compare it to a literal `for j := 0; j < 1000; j++` loop. Parity confirms the iterator is on the fast path.

---

## When Iterators Are the Wrong Tool

Iterators are a sequencing/laziness abstraction, not a universal speedup.

- **Small in-memory data:** a `[]T` is simpler, indexable, and identical in cost. Don't wrap it.
- **You need concurrency:** a push iterator is synchronous — no parallelism. Use goroutines/channels; iterators won't make the producer run alongside the consumer.
- **Hot path with a deep dynamic pipeline:** lost inlining and closure allocations can make it slower than a fused hand loop. Profile; fuse the hot operators.
- **You'll materialise it anyway:** if every consumer immediately `Collect`s the whole thing (to sort, index, or re-scan), produce the slice directly and skip the iterator round-trip.
- **`iter.Pull` for simple iteration:** it costs a goroutine and a coroutine switch per element. Use push unless you truly need manual advancement.

Reach for an iterator when laziness pays: large/unbounded data, expensive per-element production, or early-exit savings (pagination, search). Reach for `iter.Pull` only for merge/zip/interleave. Otherwise lean on a plain slice loop — and spend the saved effort elsewhere.

---

## Summary

A push iterator is not slow — inlined, it *is* a plain loop with zero allocation. The optimization work is keeping it on that path: call iterators concretely so they inline and their `yield` closure doesn't escape; keep iterator bodies lean (factor heavy work into helpers); fuse deep pipelines on hot paths; and forward `false` immediately so short-circuiting propagates. Prefer push (`for range`) over `iter.Pull`, which costs a goroutine and a coroutine switch per element and exists only for merge/zip/interleave. Use laziness deliberately — early `break` over a paginated or infinite source is the single biggest practical win, turning O(n) into O(until-found) and avoiding full-slice allocation.

Measure with `-benchmem` (expect `0 allocs/op`), `-gcflags=-m` (confirm inlining and non-escape), and `pprof` for deep pipelines; watch goroutine count for pull-based code. The biggest optimization, as always, is upstream: decide honestly whether the data even wants an iterator. For small in-memory data, or when you need concurrency, a slice or a channel is the right tool — and not reaching for an iterator is the best optimization of all.
