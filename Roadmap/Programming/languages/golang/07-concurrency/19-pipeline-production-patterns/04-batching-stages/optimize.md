---
layout: default
title: Batching Stages — Optimize
parent: Batching Stages
grand_parent: Pipeline Production Patterns
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/19-pipeline-production-patterns/04-batching-stages/optimize/
---

# Batching Stages — Optimization

> Each entry describes a problem, a "before" snippet, an "after" snippet, and the realistic gain. Numbers are illustrative; measure in your own code.

---

## Optimization 1 — Reuse the buffer

**Problem.** Allocating a fresh slice on every flush is wasteful when the size is predictable.

**Before:**
```go
flush := func() {
    out <- buf
    buf = make([]Item, 0, maxSize)  // allocates each time
}
```

**After:**
```go
flush := func() {
    batch := make([]Item, len(buf))
    copy(batch, buf)
    buf = buf[:0]  // reuses underlying array
    out <- batch
}
```

**Gain.** Buffer allocation eliminated. The copy allocation still happens but is bounded by `maxSize × sizeof(Item)`. Heap pressure drops ~50% in typical workloads.

---

## Optimization 2 — Use `sync.Pool` for batch slices

**Problem.** The copy in `flush` still allocates `maxSize × sizeof` per flush.

**Before:**
```go
batch := make([]Item, len(buf))
copy(batch, buf)
out <- batch
```

**After:**
```go
var pool = sync.Pool{
    New: func() any { s := make([]Item, 0, maxSize); return &s },
}

pp := pool.Get().(*[]Item)
*pp = append((*pp)[:0], buf...)
out <- *pp

// Consumer:
for b := range out {
    sink.Write(b)
    s := b[:0]
    pool.Put(&s)
}
```

**Gain.** Steady-state allocation drops to near zero. GC pauses shorter by 10x or more. CPU bound for batching usually drops 5–15%.

**Cost.** Consumer-must-return contract. Document loudly.

---

## Optimization 3 — Bound async flush

**Problem.** Sync flush is throughput-bound. Adding `go write(batch)` is unbounded.

**Before:**
```go
case <-timer.C:
    sink.Write(ctx, batch)  // sync, slow
```

**After:**
```go
jobs := make(chan []Item, Inflight)
for i := 0; i < Inflight; i++ {
    go func() {
        for b := range jobs { sink.Write(ctx, b) }
    }()
}

case <-timer.C:
    select {
    case jobs <- batch:
    case <-ctx.Done():
    }
```

**Gain.** Throughput up by `Inflight` factor (e.g. 4x at `Inflight=4`). Back-pressure preserved via bounded channel.

**Cost.** Ordering across batches lost; preserved within a single worker.

---

## Optimization 4 — Larger `maxSize`

**Problem.** Small batches mean more per-batch overhead.

**Before:** `maxSize = 10`. Sink overhead per call dominates.

**After:** `maxSize = 200` (sink supports up to 500). Sink overhead amortised across more items.

**Gain.** Throughput up 5–10x if sink overhead was the bottleneck.

**Cost.** Slightly higher per-batch latency (sink takes longer per call). Verify against SLO.

---

## Optimization 5 — Tune `maxWait` to SLO

**Problem.** `maxWait` set too small → small batches at low load. Set too large → latency violation.

**Before:** `maxWait = 1s` for a 200 ms SLO.

**After:** `maxWait = 50ms` (= SLO / 4).

**Gain.** Latency p99 drops within SLO. Throughput unchanged at high load (size trigger dominates).

---

## Optimization 6 — Output channel cap > 0

**Problem.** Unbuffered output channel means accumulator blocks on every send.

**Before:** `out := make(chan []Item)` (cap 0).

**After:** `out := make(chan []Item, 4)`.

**Gain.** 10–20% throughput improvement by overlapping accumulate and consume.

**Cost.** Slightly more memory: 4 × batch size.

---

## Optimization 7 — Pre-allocate the timer

**Problem.** `time.After(maxWait)` in a select loop allocates each iteration.

**Before:**
```go
select {
case <-time.After(maxWait):
    flush()
```

**After:**
```go
timer := time.NewTimer(maxWait)
if !timer.Stop() { <-timer.C }
// ...
select {
case <-timer.C:
    flush()
    // Reset on next non-empty
```

**Gain.** Eliminates timer allocations. At 1000 flushes/s, saves ~1000 timer allocs/s. GC less stressed.

---

## Optimization 8 — Drop empty-batch sends

**Problem.** Time trigger fires on empty buffer; flush sends empty batches.

**Before:**
```go
flush := func() {
    out <- buf  // sends even if empty
    buf = buf[:0]
}
```

**After:**
```go
flush := func() {
    if len(buf) == 0 { return }
    out <- batch
    buf = buf[:0]
}
```

**Gain.** Eliminates wasted downstream cycles. Memory unchanged.

---

## Optimization 9 — Drop the ticker

**Problem.** `time.Ticker` fires every `maxWait` regardless of buffer state.

**Before:**
```go
t := time.NewTicker(maxWait)
case <-t.C: flush()
```

**After:**
```go
// Use *time.Timer armed on empty->non-empty transition
if len(buf) == 0 { timer.Reset(maxWait) }
```

**Gain.** Eliminates idle wakeups. Negligible CPU; meaningful for low-traffic stages on slow processors.

---

## Optimization 10 — Inline the size check

**Problem.** Checking size in a separate select case is a redundant wakeup.

**Before:**
```go
select {
case x := <-in: buf = append(buf, x)
case ...:
}
if len(buf) >= maxSize { flush() }
```

**After:**
```go
case x := <-in:
    buf = append(buf, x)
    if len(buf) >= maxSize { flush() }
```

**Gain.** Trivial CPU saving but cleaner code.

---

## Optimization 11 — Use pre-sized output channel

**Problem.** Output channel cap based on guess.

**Before:** `make(chan []Item, 100)` (overkill).

**After:** `make(chan []Item, 4)` (tuned).

**Gain.** Memory bounded; back-pressure preserved.

---

## Optimization 12 — Avoid per-item copies

**Problem.** If items are large structs, `append(buf, x)` may copy them.

**Before:** `buf []Item` where `Item` is 1 KB.

**After:** `buf []*Item` (slice of pointers).

**Gain.** Append cost goes from 1 KB copy to 8-byte pointer copy. Slice growth is cheaper.

**Cost.** Indirection cost on read; GC has to scan pointers.

Use when items are large (> 64 bytes) and not too numerous.

---

## Optimization 13 — Reduce metric overhead

**Problem.** Per-flush metric updates with high cardinality.

**Before:**
```go
metricLatency.WithLabelValues(reason, tenant, region).Observe(d.Seconds())
```

**After:**
```go
metricLatency.Observe(d.Seconds())  // single histogram, no labels
```

**Gain.** Eliminates per-call label-lookup cost. Cardinality manageable.

**Cost.** Lose per-tenant/per-region breakdowns. Trade-off; choose based on usage.

---

## Optimization 14 — Atomic counters instead of mutex

**Problem.** Multiple goroutines update a stats counter.

**Before:**
```go
mu.Lock(); stats.flushes++; mu.Unlock()
```

**After:**
```go
atomic.AddInt64(&stats.flushes, 1)
```

**Gain.** Atomic ~5 ns; mutex ~50 ns. 10x faster on hot counters.

---

## Optimization 15 — Parallelise marshaling

**Problem.** Marshaling items is CPU-bound; happens serially.

**Before:**
```go
for _, item := range batch {
    w.Write(marshal(item))
}
```

**After:**
```go
// Parallel marshal
chunks := make([][]byte, len(batch))
var wg sync.WaitGroup
for i, item := range batch {
    wg.Add(1)
    go func(i int, item Item) {
        defer wg.Done()
        chunks[i] = marshal(item)
    }(i, item)
}
wg.Wait()
for _, c := range chunks { w.Write(c) }
```

**Gain.** Up to N × speedup on N cores. Useful for expensive marshalling.

**Cost.** Goroutine spawn cost; only pays off for ~100+ items per batch.

---

## Optimization 16 — Adaptive sizing

**Problem.** Static `maxSize` is suboptimal across load regimes.

**Before:** `maxSize = 100` always.

**After:** Adaptive controller that grows under slack, shrinks under pressure.

**Gain.** 20–40% throughput improvement during low-load periods. Latency stays within SLO at high load.

**Cost.** Controller complexity. Document.

---

## Optimization 17 — Jittered timers

**Problem.** Fleet-wide synchronous flushes at second boundaries.

**Before:**
```go
timer.Reset(maxWait)
```

**After:**
```go
jitter := time.Duration(rand.Int63n(int64(maxWait / 10)))
timer.Reset(maxWait - maxWait/20 + jitter)
```

**Gain.** Eliminates sink-side traffic spikes. p99 sink latency stable.

---

## Optimization 18 — Skip `time.Now()` in inner loop

**Problem.** Per-item `time.Now()` is ~30 ns.

**Before:**
```go
for x := range in {
    item.ts = time.Now()
    buf = append(buf, item)
}
```

**After:**
```go
now := time.Now()
for x := range in {
    item.ts = now  // shared across batch
    buf = append(buf, item)
}
```

**Gain.** Eliminates per-item time.Now() cost. 1-3% throughput improvement at very high rates.

**Cost.** Timestamps less precise (per-batch instead of per-item).

---

## Optimization 19 — Batch slice as map key

**Problem.** For coalescing, looking up by key per item is `O(1)` map lookup × N items.

**Before:**
```go
for x := range in {
    latest[x.Key] = x
}
```

**After:** Already optimal. The map lookup is the dominant cost. No further optimisation without changing algorithm.

Actually a real optimisation here: pre-allocate the map with hint:

```go
latest := make(map[string]Item, expectedKeys)
```

**Gain.** Avoids resize allocations.

---

## Optimization 20 — Skip the copy when consumer is synchronous

**Problem.** Copy on send is the safe default but wasteful when the consumer processes synchronously.

**Before:**
```go
batch := make([]Item, len(buf))
copy(batch, buf)
out <- batch  // consumer processes, returns; buf reused safely
buf = buf[:0]
```

**After (only safe with synchronous consumer):**
```go
out <- buf
<-doneCh  // wait for consumer to finish
buf = buf[:0]
```

**Gain.** Eliminates copy allocation. Throughput up.

**Cost.** Requires synchronous consumer protocol. Fragile; document.

---

## Combining optimisations — A realistic tuning session

A telemetry pipeline. Baseline: 100K events/s, 80ms p99, 250 MB/s allocations, 5ms GC pause p99.

**Step 1.** Add `sync.Pool` for batch slices.
After: 100K/s (unchanged), 80ms p99 (unchanged), 5 MB/s allocations (50x less), 0.3ms GC pause (16x less).

**Step 2.** Increase `maxSize` from 100 to 500. Sink p99 latency rose from 30ms to 60ms; still under SLO.
After: 200K/s (2x), 100ms p99 (still under SLO), allocations unchanged, GC unchanged.

**Step 3.** Increase `Inflight` from 1 to 4.
After: 600K/s (3x more), 120ms p99 (still under SLO), connections per pod up to 4, memory up by 2 MB.

**Step 4.** Add jitter on `maxWait`.
After: throughput unchanged, sink-side p99 latency cleaner across fleet, no thundering herd.

Total: 6x throughput improvement, p99 still under SLO, GC pauses eliminated, fleet behavior smoothed.

---

## Optimisation Decision Tree

```
Is your pipeline performing within SLO?
├── Yes: Don't optimise. Move on.
└── No: Profile.
    ├── Top allocator is flush copy?
    │   └── Add sync.Pool. Stop if SLO met.
    ├── Sink is bottleneck?
    │   ├── Sink supports parallelism?
    │   │   └── Add bounded async (Inflight=N).
    │   └── Sink does not support parallelism?
    │       ├── Larger batches?
    │       │   └── Increase maxSize.
    │       └── No options?
    │           └── Shard sink or use different sink.
    ├── GC pause is bottleneck?
    │   └── Reduce allocations (Optimizations 1, 2, 18).
    ├── Channel ops are bottleneck?
    │   └── Reduce channel hops; inline stages.
    └── Other?
        └── Profile deeper.
```

Follow the tree. Measure at each branch.

---

## Anti-Optimisations

Things that look like optimisations but are not.

### Anti-1 — Unbounded async flush

`go write(batch)` for every batch. Looks fast; OOMs.

### Anti-2 — Eliminating the copy without `sync.Pool`

Causes data corruption. Always copy or pool.

### Anti-3 — `time.After` in the loop

Looks succinct; leaks timers.

### Anti-4 — `time.Tick` for the time trigger

Looks simple; leaks goroutines forever.

### Anti-5 — Unbounded buffer

`buf` without `maxSize`. Memory growth unbounded.

### Anti-6 — Premature `sync.Pool`

Adding pooling before measurement. Complexity without benefit.

### Anti-7 — Goroutine per item

`go process(item)` for every item. Spawn cost dominates.

### Anti-8 — Skipping back-pressure

Drop-on-full as the default. Losing data is not an optimisation.

---

## Final Note

Optimisation is profile-driven. Without measurement, every "optimisation" is speculation. Profile baseline, identify bottleneck, apply targeted fix, re-measure, iterate.

The canonical pattern in junior.md is already quite efficient. Most pipelines do not need any of these optimisations. Add them only when measurement shows you must.
