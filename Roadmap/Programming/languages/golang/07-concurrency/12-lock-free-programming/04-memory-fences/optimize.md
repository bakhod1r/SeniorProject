# Memory Fences — Optimisation

## Table of Contents
1. [Introduction](#introduction)
2. [Measuring Before Optimising](#measuring-before-optimising)
3. [Avoid Atomics Where Possible](#avoid-atomics-where-possible)
4. [Reducing Atomic Operation Count](#reducing-atomic-operation-count)
5. [Cache-Line Padding and False Sharing](#cache-line-padding-and-false-sharing)
6. [Sharding Hot Atomics](#sharding-hot-atomics)
7. [Read-Mostly Patterns](#read-mostly-patterns)
8. [Batching and Buffering](#batching-and-buffering)
9. [Architecture-Specific Tuning](#architecture-specific-tuning)
10. [When to Pay the Fence Cost](#when-to-pay-the-fence-cost)
11. [Summary](#summary)

---

## Introduction

Memory fence overhead is real but usually small. On uncontended atomic operations, you pay 3–10 nanoseconds per call on modern hardware — a couple of cache line transitions, a serialising point in the pipeline. The overhead becomes visible only in specific patterns:

- A tight loop with one atomic operation per iteration.
- A heavily contended counter or pointer hit by many CPUs at once.
- An ARM or POWER workload where the seq_cst fences are more expensive than on x86.
- A microbenchmark designed to expose the cost.

This file covers the techniques that move atomic-heavy code from "slow" to "fast enough." None of them weaken the memory model — Go does not allow that. All of them reduce the number of fences executed, or push the fences to a less-hot path, or shape the data so that contention drops.

---

## Measuring Before Optimising

The first rule of fence optimisation is: do not. Most Go atomic code is not fence-bound — it is cache-coherence-bound under contention, or it is irrelevant to overall performance.

### Profile first

Use `pprof` to identify hot paths:

```bash
go test -bench=. -cpuprofile=cpu.prof
go tool pprof -top cpu.prof
```

If your program spends 0.1% of its time in `sync/atomic.(*Int64).Add`, optimising it cannot save you more than 0.1% — not worth the engineering time. Focus on the top 5 functions.

### Measure under realistic load

A microbenchmark that hammers one variable with no other work tells you the absolute cost of the atomic, but says nothing about your real workload. Reproduce the contention pattern your production sees. Use `-cpu=N` to vary parallelism.

### Distinguish fence cost from contention cost

Run the benchmark single-threaded first. If it is fast single-threaded and slow multi-threaded, the bottleneck is contention (cache-line bouncing), not the fence. The optimisations differ:

- Fence-bound: reduce atomic operation count, batch.
- Contention-bound: shard, pad, redesign access pattern.

---

## Avoid Atomics Where Possible

The cheapest fence is one that never runs. Patterns that avoid atomics:

### Goroutine-local state

If a piece of data is only read and written by one goroutine, it needs no synchronisation. Stack-allocated locals are the obvious case; per-goroutine maps and slices are another.

```go
func process(items []Item) []Result {
    results := make([]Result, 0, len(items)) // local, no atomics
    for _, it := range items {
        results = append(results, transform(it))
    }
    return results
}
```

When the function returns, the slice is handed off; the receiver synchronises through whatever mechanism received the result (channel, return value, etc.).

### Immutable shared state

Data that is set once and never modified can be read concurrently without atomics:

```go
type Config struct {
    Endpoints []string
    Timeout   time.Duration
}

var globalConfig = loadConfig() // set at init, never modified
```

Once the `main` function starts, every goroutine reads `globalConfig` without synchronisation. The happens-before edge from goroutine creation establishes ordering.

### Goroutine-per-shard

If your workload partitions naturally (e.g., one goroutine per partition), give each partition its own state. No cross-goroutine sharing means no atomics.

```go
type Partition struct {
    data map[string]int
    in   chan event
}

// One goroutine per partition; events are routed by key.
```

This is the actor model. The trade-off is the channel send cost (a mutex inside the channel), but channels can carry many events per send if you batch.

---

## Reducing Atomic Operation Count

When you must use atomics, do fewer of them.

### Load once, use many

```go
// Bad — three loads, three fences:
if config.Load().LogRequests {
    log.Println(r)
}
if config.Load().AuthRequired {
    auth(r)
}
timeout := config.Load().Timeout

// Good — one load:
cfg := config.Load()
if cfg.LogRequests {
    log.Println(r)
}
if cfg.AuthRequired {
    auth(r)
}
timeout := cfg.Timeout
```

The good version pays one fence per request handler rather than three.

### Accumulate locally, publish in batches

```go
// Bad — atomic per item:
for _, item := range items {
    counter.Add(1)
}

// Good — one atomic for the whole batch:
counter.Add(int64(len(items)))
```

If `items` has 1000 elements, you save 999 fences.

### Use `Add` instead of `Load` + `Store`

```go
// Bad — not atomic, and two fences:
v := counter.Load()
counter.Store(v + 1)

// Good — atomic and one fence:
counter.Add(1)
```

The bad version is also wrong: another goroutine can interleave between the load and the store.

### Use `Swap` instead of `Load` + `Store` for "take and reset"

```go
// Bad:
v := counter.Load()
counter.Store(0)

// Good:
v := counter.Swap(0)
```

Same atomicity benefit and half the fences.

---

## Cache-Line Padding and False Sharing

When two atomic variables live on the same cache line and are written by different CPUs, every write to one invalidates the other's cache. This is **false sharing**: the cores are not contending for the same variable, but they are contending for the same line.

### Identifying false sharing

Symptoms: a multi-threaded program runs much slower than expected; profiling shows time in cache miss handling; the variables look unrelated.

Standard cache line size: 64 bytes on Intel, AMD, and most ARM. 128 bytes on Apple Silicon (effective; the line is 64 but pairs are fetched together).

### The padding pattern

```go
type Counter struct {
    v atomic.Int64
    _ [56]byte // 64 - 8 = 56 bytes of padding
}
```

Two `Counter` values are now on separate lines. Each can be written by its own CPU without disturbing the other.

For Apple Silicon, you may want 120 bytes of padding instead of 56:

```go
type Counter struct {
    v atomic.Int64
    _ [120]byte // 128 - 8
}
```

The cost is memory — 64 or 128 bytes per counter rather than 8 — and a slight increase in memory bandwidth. For hot counters, the trade-off is overwhelmingly worth it.

### Padding the underlying array

When you shard a counter into N buckets, pad each bucket:

```go
type ShardedCounter struct {
    cells [128]struct {
        v atomic.Int64
        _ [56]byte
    }
}
```

Without the padding, eight `atomic.Int64` values per line means each write invalidates seven others. With padding, each cell stands alone.

---

## Sharding Hot Atomics

When many goroutines hit one atomic variable concurrently, cache-line bouncing dominates. The fix is sharding.

### Simple sharding by goroutine ID

```go
type Counter struct {
    cells [N]struct {
        v atomic.Int64
        _ [56]byte
    }
}

func (c *Counter) Add(delta int64) {
    i := goroutineID() % N
    c.cells[i].v.Add(delta)
}

func (c *Counter) Load() int64 {
    var sum int64
    for i := range c.cells {
        sum += c.cells[i].v.Load()
    }
    return sum
}
```

`N` is typically `GOMAXPROCS` or a small multiple. Each goroutine consistently hits the same cell, so contention is per-cell rather than global.

The trade-off: `Load` becomes O(N). For counters read infrequently and incremented frequently, this is excellent. For counters read on every request, less so.

### Getting a goroutine ID

Go does not expose goroutine IDs intentionally — the standard advice is to pass the ID through context. For a sharded counter, alternatives:

- Use `runtime_procPin` (internal — risky).
- Use `runtime.NumCPU()` and stripe by an external counter.
- Use a `sync.Pool` of cells — each goroutine borrows from the pool, returns on done.

The `pcg` library and other contention-aware counter packages do exactly this. Look at `go.uber.org/atomic`'s counter or the various "padded counter" libraries.

### Sharding by hash

If the writes come keyed by some natural identifier (request ID, user ID), hash to a shard:

```go
func (c *Counter) AddFor(key string, delta int64) {
    h := fnv.New32a()
    h.Write([]byte(key))
    i := h.Sum32() % N
    c.cells[i].v.Add(delta)
}
```

This works when many distinct keys are flowing through; the sharding becomes natural.

---

## Read-Mostly Patterns

When reads vastly outnumber writes, design for the readers.

### `sync.Map` for read-mostly maps

`sync.Map` has two internal stores: a read-only snapshot accessed via atomic load, and a write-protected mutable map. Reads from the snapshot are wait-free; writes promote keys into the mutable map and occasionally rebuild the snapshot.

```go
var cache sync.Map

cache.Store("key", "value")
v, ok := cache.Load("key")
```

Use `sync.Map` only when the read/write ratio is very heavy on reads. For balanced workloads, a plain `map` with `sync.RWMutex` may be faster.

### `atomic.Pointer` for read-mostly configuration

Pattern from `senior.md`:

```go
var cfg atomic.Pointer[Config]

func current() *Config { return cfg.Load() }
func reload(c *Config) { cfg.Store(c) }
```

Readers pay one atomic load. Writers replace the entire struct. Excellent for configuration that updates rarely but is read on every request.

### RCU (Read-Copy-Update)

The most general read-mostly pattern: readers grab a snapshot pointer; writers copy the structure, modify, swap the pointer atomically; old snapshot is garbage-collected after all readers are done.

Go's garbage collector handles the cleanup automatically. In C/C++ where you must manage memory, RCU is much more involved (grace periods, hazard pointers).

---

## Batching and Buffering

If you cannot avoid the atomic, batch the operations behind it.

### Batched producer

```go
// Bad — atomic per item:
for _, item := range items {
    queue.Push(item) // one atomic per push
}

// Good — atomic for the whole batch:
queue.PushAll(items) // one atomic that installs the batch
```

The batched queue keeps a small buffer per producer, flushes when full or on demand.

### Coalesced writers

If many writers want to update the same atomic, have one of them act as the broker. Writers queue intents in a local buffer; a single goroutine drains and applies. Reduces atomic-on-shared-state to one per drain.

This pattern shows up in metrics libraries (e.g., Prometheus's histograms): increments go to thread-local buckets; an aggregator periodically combines.

### Backoff under contention

```go
for {
    old := counter.Load()
    if counter.CompareAndSwap(old, old+1) {
        return
    }
    runtime.Gosched() // back off
}
```

Under heavy CAS contention, an exponential backoff reduces the rate at which contending goroutines slam the cache line. The throughput often improves.

---

## Architecture-Specific Tuning

### x86: fences are cheap; contention is the cost

On x86, a `LOCK`-prefixed instruction is 10–20 cycles uncontended. Single atomics rarely show up in profiles. The optimisation focus should be on contention — sharding, padding, batching.

### ARM64: fences cost a measurable few cycles

`LDAR` and `STLR` carry their own ordering, but they cost a few cycles more than `LDR` and `STR`. In tight loops with many atomic loads per iteration, the cost compounds. Mitigations:

- Read once outside the loop where possible.
- Use ARMv8.1 LSE atomics (`CASAL`, `LDADDAL`, `SWPAL`) which are single-instruction and often faster than LL/SC loops.

Go's runtime auto-detects LSE support and emits the appropriate instructions on supporting cores. On AWS Graviton and Apple Silicon, you get LSE for free.

### POWER: heavyweight fences

POWER's `sync` is 50+ cycles, one of the slower full fences. On POWER hardware (less common but still in some banking and HPC environments), the cost of atomic operations is more significant. The same optimisations apply, just with more urgency: batch, shard, avoid.

### Apple Silicon: M1/M2/M3 quirks

Apple Silicon implements ARMv8.4-A with the LSE2 extension. Native atomics are fast. One quirk: the effective cache line is 64 bytes but adjacent lines are often fetched together, so padding to 128 bytes can help eliminate false sharing more reliably.

---

## When to Pay the Fence Cost

Some places where you should not optimise atomics:

### Configuration and feature flags

A handler reads `atomic.Pointer[Config].Load()` once per request. The cost is 1–2 ns. The request itself takes hundreds of microseconds. Save the engineering time for somewhere else.

### Stop signals

A worker loop checks `atomic.Bool.Load()` once per iteration. The iteration does work that takes microseconds or more. The fence is invisible.

### Lock-free queue handoffs in moderate-traffic systems

A queue that sees thousands of operations per second has plenty of time between operations. The atomic cost is irrelevant.

Places where you should optimise:

### Tight loops with one atomic per iteration

A statistics counter incremented once per network packet at 10 million packets per second is potentially 30 ms of CPU per second just for the atomic. Sharding can cut this by 10x.

### Lock-free data structures under heavy contention

A producer-consumer queue with many producers will pay heavy cache-line costs. Sharding and per-producer buffers turn it into a series of single-writer atomics.

### ARM workloads with measured atomic bottleneck

If profiling shows `atomic` calls dominate on ARM, consider whether you can fall back to a mutex (similar cost on ARM) or to a sharded approach.

---

## Summary

The cost of Go's seq_cst atomics is real but rarely the bottleneck. Profile first; treat atomics as the constant they usually are. When they do bottleneck, the optimisations are: do fewer atomics (read once, use many; batch); spread the load (shard with cache-line padding); design for the read-heavy case (RCU, `sync.Map`, `atomic.Pointer`); and pick the right hardware-specific tactics (LSE atomics on ARM, careful padding on Apple Silicon, batching everywhere on POWER). None of these techniques weaken the memory model — Go does not allow that. They all reduce the number of fences your hot path actually executes.
