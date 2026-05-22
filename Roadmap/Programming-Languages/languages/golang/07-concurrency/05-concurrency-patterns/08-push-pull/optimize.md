# Push-Pull — Optimize

This file moves from "correct pipeline" to "fast pipeline." First rule: measure. The buffer size, worker count, and batch size that are optimal for one workload are wrong for another — and the channel is usually *not* the bottleneck. Steady-state throughput is set by the consumer's service rate; most "channel optimisations" only matter at very high item rates.

## Table of Contents
1. [Measure First](#measure-first)
2. [Buffer Size vs Throughput](#buffer-size-vs-throughput)
3. [Worker Count Tuning](#worker-count-tuning)
4. [Batching to Amortise Channel Cost](#batching-to-amortise-channel-cost)
5. [Allocation Reduction](#allocation-reduction)
6. [Lock Contention on a Shared Channel](#lock-contention-on-a-shared-channel)
7. [Sharding to Avoid Head-of-Line Blocking](#sharding-to-avoid-head-of-line-blocking)
8. [Channel vs Mutex Queue](#channel-vs-mutex-queue)
9. [Benchmarking Pitfalls](#benchmarking-pitfalls)
10. [Cheat Sheet](#cheat-sheet)
11. [Summary](#summary)

---

## Measure First

Benchmark the pipeline end to end, then isolate the channel cost. A pure channel-throughput bench:

```go
func BenchmarkChanThroughput(b *testing.B) {
    ch := make(chan int, 64)
    go func() {
        for i := 0; i < b.N; i++ {
            ch <- i
        }
        close(ch)
    }()
    b.ResetTimer()
    n := 0
    for range ch {
        n++
    }
    _ = n
}
```

Run `go test -bench ChanThroughput -benchmem -cpuprofile cpu.out`, then `go tool pprof cpu.out`. If most time is in `process()` not `chansend`/`chanrecv`, the channel is *not* your bottleneck — optimise the work, not the plumbing. If it *is* in the channel runtime, the sections below apply.

---

## Buffer Size vs Throughput

Illustrative numbers (synthetic, single machine, your hardware differs). One producer, one consumer, trivial per-item work, items/sec:

| Buffer | items/sec | Notes |
|--------|-----------|-------|
| 0 (unbuffered) | 6.2 M | rendezvous on every item — most synchronisation overhead |
| 1 | 9.0 M | a little slack, fewer parks |
| 8 | 18 M | sweet spot for trivial work |
| 64 | 21 M | diminishing returns |
| 1024 | 21 M | no further gain; just more memory |
| 65536 | 20 M | slightly worse (cache pressure) |

The lesson: a *small* buffer (8–64) buys most of the throughput by amortising goroutine wakeups; beyond that you only spend memory and *delay* feeling backpressure. There is no throughput reason to use a huge buffer — steady-state rate is capped by the consumer, not the buffer. Use a large buffer only to absorb a *known* burst (Little's Law), accepting the added latency under load.

---

## Worker Count Tuning

For CPU-bound work, more workers than cores wastes time on context switches. For IO-bound work, more workers hide latency. Illustrative, IO-bound (each item = 1 ms simulated IO), 8-core box:

| Workers | items/sec | Notes |
|---------|-----------|-------|
| 1 | ~1,000 | serial |
| 4 | ~4,000 | scales with concurrency |
| 8 | ~8,000 | |
| 64 | ~60,000 | IO latency hidden by concurrency |
| 512 | ~62,000 | diminishing; scheduler + memory overhead |

For CPU-bound work the curve peaks near `GOMAXPROCS` and then *declines*. Rule: start workers at `runtime.GOMAXPROCS(0)` for CPU-bound, much higher for IO-bound, and *measure* — the optimum depends on the work/IO ratio. Do not hardcode a magic number; make it configurable and benchmark per workload.

---

## Batching to Amortise Channel Cost

At very high item rates, per-item channel overhead dominates. Sending batches divides that overhead by the batch size.

**Before** (one item per send):
```go
for it := range in {
    out <- it
}
```

**After** (batched):
```go
batch := make([]Item, 0, 256)
for it := range in {
    batch = append(batch, it)
    if len(batch) == cap(batch) {
        out <- batch
        batch = make([]Item, 0, 256) // fresh slice — never reuse a sent one
    }
}
if len(batch) > 0 { out <- batch }
```

Illustrative (high item rate, trivial work):

| Batch size | items/sec | per-item latency |
|------------|-----------|------------------|
| 1 | 21 M | lowest |
| 16 | 120 M | low |
| 256 | 240 M | higher (waits to fill) |
| 4096 | 260 M | highest latency |

Batching is the single biggest channel-throughput lever at high rates. Cost: latency (an item waits for its batch to fill — add a `time.Ticker` flush to bound it). Critical: allocate a fresh slice per batch; reusing a sent slice is a data race (see find-bug Bug 8).

---

## Allocation Reduction

Channels of pointers and per-item allocations create GC pressure. Tactics:

- **Send values, not pointers, for small structs** — avoids a heap allocation and keeps data in the channel buffer (which is contiguous). For large structs, pointers avoid copying; profile to choose.
- **`sync.Pool` for reusable buffers** when items wrap a `[]byte` or similar — but only return to the pool *after* the consumer is done (ownership), or you reintroduce the mutate-after-send race.
- **Batch slices reduce allocation count** (one slice header per N items vs N sends) but each fresh batch is still an allocation — pool the batch slices if profiling shows it matters.

Verify with `-benchmem`:

| Design | allocs/op | B/op |
|--------|-----------|------|
| `chan *Item` (alloc per item) | 1 | 48 |
| `chan Item` (value) | 0 | 0 |
| batched `chan []Item` (fresh slice/256) | ~0.004 | ~0.2 |

Do not pool prematurely — confirm GC is the bottleneck (high `runtime.gcBgMarkWorker` in the profile) first.

---

## Lock Contention on a Shared Channel

A channel is internally a mutex-guarded ring buffer. With one producer and many consumers (fan-out), every send and receive contends on that one lock. At high rates and high worker counts, the channel lock itself becomes the bottleneck — visible as time in `runtime.chanrecv`/`lock2` in the profile.

Mitigations:

- **Batch** (above) — fewer channel operations per item, so less lock traffic.
- **Shard** — multiple channels, each with a subset of workers, removing the single-lock chokepoint (next section).
- **Fewer, busier workers** — if workers are starved (each does tiny work), the lock dominates; coarsen the per-item work or batch.

You cannot make a single channel's lock faster; you reduce how often you touch it (batch) or stop sharing one (shard).

---

## Sharding to Avoid Head-of-Line Blocking

A single shared channel has two problems at scale: lock contention, and head-of-line blocking (one slow item stalls everything behind it). Sharding by key fixes both:

```go
shards := make([]chan Item, K)
for i := range shards {
    shards[i] = make(chan Item, 64)
    go worker(shards[i]) // one (or more) worker per shard
}
// route by key so the same key always lands on the same shard (ordering/affinity)
func route(it Item) {
    shards[hash(it.Key)%uint64(K)] <- it
}
```

Each shard has its own lock and its own queue, so K shards give ~K× the channel throughput and confine a slow item's impact to its shard. The trade-off: load may be uneven across shards (a hot key overloads one shard while others idle), and you lose global ordering. Use sharding when you have a natural partition key and tail latency on a shared channel is hurting you — confirmed by a benchmark, not assumed.

Illustrative (8 workers, high rate):

| Topology | items/sec | p99 latency |
|----------|-----------|-------------|
| 1 shared channel | 21 M | high (HoL blocking) |
| 4 shards | 70 M | lower |
| 8 shards | 120 M | lowest (if keys are balanced) |

---

## Channel vs Mutex Queue

For pure queueing (no select, no fan-out subtleties), is a channel or a mutex+slice ring buffer faster? Channels carry select/wakeup machinery a bare ring buffer lacks, so a hand-rolled lock-free or mutex ring can be faster in microbenchmarks. But:

- The channel gives you backpressure, `select`, `range`, close semantics, and `-race`-friendly happens-before for free.
- A hand-rolled queue must reimplement backpressure (block when full), signalling (`sync.Cond`), and correctness — easy to get wrong.

Decision: **default to the channel.** Only consider a custom queue if profiling proves the channel is the dominant cost *and* you do not need select/close semantics — a rare combination. The maintenance and correctness cost of a hand-rolled queue almost always outweighs the microbenchmark win.

---

## Benchmarking Pitfalls

- **Measuring the work, not the channel.** Use trivial per-item work to isolate channel cost; then add realistic work to see the channel's *share*.
- **GOMAXPROCS=1.** Fan-out and contention behave completely differently with real parallelism. Bench with `GOMAXPROCS > 1`.
- **Forgetting backpressure in the bench.** A bench with an infinitely fast consumer hides the producer-blocking cost that dominates real pipelines. Add a realistic slow consumer.
- **Huge buffer hiding the problem.** A 1M-element buffer makes a microbench look fast but never exercises backpressure. Bench at realistic buffer sizes.
- **Not separating throughput from latency.** Batching raises throughput but raises latency; report both. A throughput-only bench misleads latency-sensitive callers.
- **Allocation noise.** Always `-benchmem`; a "faster" design that allocates more may be slower under GC pressure in production.
- **No `-race` correctness pass.** A fast-but-racy pipeline (reused slices, mutated items) is worthless. Validate correctness under `-race` before trusting speed numbers.

---

## Cheat Sheet

```text
1. Profile first        -> is the channel even the bottleneck? (usually it's the work)
2. Small buffer (8-64)  -> most of the throughput; bigger only for known bursts
3. Worker count         -> ~GOMAXPROCS (CPU-bound), higher (IO-bound), measure
4. Batch sends          -> biggest lever at high item rates (cost: latency)
5. Send values for small structs; pool buffers only if GC-bound
6. Shard by key         -> kills single-channel lock contention + HoL blocking
7. Channel vs ring      -> default to channel; custom queue rarely worth it
ALWAYS: bench with GOMAXPROCS>1, realistic backpressure, -benchmem, correctness under -race
```

| Symptom in profile | Cause | Fix |
|--------------------|-------|-----|
| time in `chansend`/`chanrecv`/`lock2` | channel op overhead at high rate | batch / shard |
| high `gcBgMarkWorker` | per-item allocation | send values / pool / batch |
| workers idle, low throughput | too few workers (IO-bound) | raise worker count |
| throughput flat with bigger buffer | consumer is the cap | speed up / parallelise the consumer |
| high p99 on shared channel | head-of-line blocking | shard by key |

---

## Summary

Optimising push-pull starts with a profile, because the channel is usually *not* the bottleneck — steady-state throughput is set by the consumer's service rate, and most "channel tuning" only matters at very high item rates. When it does matter: a small buffer (8–64) buys most of the throughput (bigger buffers only absorb known bursts and add latency); worker count should track the work type (~GOMAXPROCS for CPU-bound, higher for IO-bound) and be measured; batching is the biggest channel-throughput lever at high rates, at the cost of latency; sending values and pooling buffers cut GC pressure; and sharding by key removes both single-channel lock contention and head-of-line blocking. Default to the channel over a hand-rolled queue — its backpressure, select, and close semantics are worth far more than a microbenchmark win. Always benchmark with real parallelism, realistic backpressure, `-benchmem`, and a `-race` correctness pass.
