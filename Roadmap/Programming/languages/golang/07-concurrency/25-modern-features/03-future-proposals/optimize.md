---
layout: default
title: Future Proposals — Optimize
parent: Future Concurrency Proposals
grand_parent: Modern Concurrency Features
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/25-modern-features/03-future-proposals/optimize/
---

# Future Proposals — Optimize

[← Back](../)

The proposals on this list change the cost model of Go concurrency in subtle ways. Adopting
them too eagerly buys you bugs; adopting them too late leaves performance on the table.

This page lays out the realistic optimization gains and the situations where the new feature
is actually slower than what it replaces. Treat the numbers as order-of-magnitude estimates,
not guarantees — your hardware, workload, and Go version will vary.

---

## testing/synctest — wall-time savings

Synctest is not a runtime feature, so it does not affect production performance. It changes
the cost model of your **test suite**: tests that used `time.Sleep` to wait for retries,
timeouts, and tickers go from minutes to milliseconds.

If your CI runs 500 retry-related tests at 1 second each, you save 8 minutes per CI run.
Multiplied across a team, that's hours of developer wait time per day.

The trade-off: synctest does not test real timing on hardware. If your code has a CPU-bound
loop that happens to take 50ms in real time but does not call `time.Sleep`, synctest will see
it as "instantaneous" and your test will not catch performance regressions. Keep one or two
real-time benchmarks for code paths where wall-clock latency matters.

### When synctest is slower

Counterintuitively, synctest can be **slower** than a regular test for code with no time-based
operations. The bubble's bookkeeping (per-goroutine state tracking, synthetic clock advance
detection) has fixed overhead. For a test that completes in 10 microseconds, the bookkeeping
might add 50 microseconds.

If you have hundreds of thousands of fast unit tests, do not wrap them all in synctest. Wrap
only the ones that benefit (timing-related tests).

---

## iter.Pull — coroutine vs goroutine performance

Per-step cost on amd64 (rough numbers from a 2024 Apple M2 and matching x86 silicon):

| Mechanism | Cost per yield+receive |
|---|---|
| Goroutine + unbuffered channel | ~150-300ns |
| Goroutine + buffered channel | ~80-150ns |
| `iter.Pull` (coroutine swap) | ~20-40ns |
| Plain function call | ~1-2ns |

`iter.Pull` is roughly 5-10x faster than goroutine+channel for serial iteration because it
does not involve the scheduler. Where this matters: parsers that emit millions of tokens,
streaming database cursors, tree walks that yield each node.

Where it doesn't matter: anything with a network round-trip per step, where the per-step cost
is dominated by I/O.

When `iter.Pull` is **slower** than a plain callback: if your producer would happily call
`yield(v)` directly via a push iterator, using `iter.Pull` adds the coroutine swap
unnecessarily. Use `Pull` only when the consumer logic genuinely needs pull semantics (e.g.
merging two streams).

### Memory cost

Each `iter.Pull` invocation allocates a coroutine stack (typically 2-8KB initial, growable).
For programs that hold many open iterators at once, this is comparable to having that many
goroutines, but with lower scheduler overhead.

If you create and stop iterators in a hot loop, the allocator may also become a bottleneck.
The runtime caches coroutine stacks for reuse, but the cache has limits. Profile with
`pprof -alloc_objects` to see if iterator stack allocation shows up in your hot path.

---

## weak.Pointer — cache sizing

`weak.Pointer` lets a cache grow to memory pressure rather than to an arbitrary count. For an
interning cache (e.g. canonicalizing strings or URLs), this typically reduces total memory by
30-60% compared to a fixed-size LRU because dead entries vanish at the next GC instead of
waiting for eviction.

The cost: each `Value()` call is more expensive than a plain pointer deref — it requires a
synchronizing read with the GC, roughly 5-10ns extra per call. For hot lookups (millions per
second), this adds up. Benchmark before assuming weak pointers are a free win.

### Comparison to alternatives

| Mechanism | Memory bound | Per-lookup cost |
|---|---|---|
| `map[K]V` | Unbounded | ~30ns (map lookup) |
| `map[K]*V` + LRU eviction | Fixed | ~30ns + LRU bookkeeping |
| `map[K]weak.Pointer[V]` | Memory-pressure bound | ~30ns + weak Value cost |
| `sync.Pool` | Unspecified | Lower lookup cost, no key |

For identity-keyed caches, `weak.Pointer` is the right choice. For temporary buffers without
identity (the canonical `sync.Pool` use case), keep `sync.Pool`.

---

## runtime.AddCleanup — finalizer goroutine pool

`SetFinalizer` runs all finalizers on **one** goroutine. If finalizers are slow or block, you
bottleneck the entire process. `AddCleanup` uses a pool of cleanup workers, removing the
single-goroutine constraint.

Programs that allocate millions of finalizable objects per second (TLS connection pools, large
caches) see measurable GC pause reductions because the cleanup goroutine no longer queues up.

The optimization rule: if your service spends more than 1% of CPU in the finalizer goroutine
(visible in `pprof` as `runfinq`), migrate to `AddCleanup`. Otherwise, the migration is
neutral on performance.

### Cleanup pool sizing

The cleanup pool size scales with `GOMAXPROCS` (with a minimum of 1). This means high-
concurrency services benefit more than single-core ones. On a 16-core machine with 16 workers,
cleanup throughput can be roughly 10x higher than the single-goroutine finalizer.

For services that allocate a lot of finalizable objects but each cleanup is fast, the
parallelism does not help (the bottleneck is allocation, not cleanup). For services where each
cleanup is non-trivial (closing a socket, releasing a mmap), the parallelism is a big win.

---

## Atomic vector ops — when the polyfill is good enough

If issue [#50860](https://go.dev/issue/50860) lands, double-width CAS becomes available,
eliminating ABA in lock-free data structures. Until then, the mutex-based polyfill in the
tasks page is correct but loses lock-freedom.

Question: when is lock-freedom actually worth it?

Empirically:

- Under low contention (< 1000 ops/sec), an uncontended mutex costs ~30ns per op,
  indistinguishable from atomic CAS.
- Under high contention (> 1M ops/sec across many cores), the mutex becomes a serialization
  point and lock-free wins by 10-100x.

So the optimize advice is: profile first. If you don't have a hot lock-free data structure
now, you probably don't need the atomic vector ops when they land.

### Realistic Go workloads

Most Go services are I/O-bound (network, database, disk). The CPU cycles available for lock-
free games are tiny compared to the cycles spent in I/O wait. Even a 10x lock-free win on a
1µs CPU operation is a 9µs speedup in a request that already takes 10ms. Often invisible.

Where lock-free actually wins: CPU-bound services (HTTP routers, in-memory caches,
serialization layers, real-time systems). For these, the atomic vector ops would be a clear
improvement. For the rest of the Go ecosystem, the proposal lands and you barely notice.

---

## Automatic GOMAXPROCS — Kubernetes scheduling

The single biggest performance improvement for Go services on Kubernetes is setting
`GOMAXPROCS` to the cgroup quota. Without it, a pod with `cpu: 100m` on a 64-core node runs
with `GOMAXPROCS=64`, causing:

- **Scheduler thrash**: 64 Ps fighting over 10% of one core, with constant park/unpark
  overhead.
- **Goroutine starvation**: a worker pool sized to `runtime.NumCPU()` creates 64 workers that
  share a tiny CPU budget.
- **GC stalls**: the GC tries to use 64 worker threads, each of which gets a fraction of the
  budget, multiplying real pause time.

Real measurements from production deployments (e.g. Uber's blog from when they shipped
automaxprocs) show 30-70% CPU reduction for CPU-bound workloads after setting GOMAXPROCS
correctly. This is one of the rare cases where one line of code in `main.go` is worth a 2x
cost win.

### When automaxprocs is no-op

If your pod has no CPU limit (Kubernetes burstable QoS, or no limit set), automaxprocs reads
`max` from cgroup and falls back to `NumCPU`. Behavior is unchanged. Same for non-container
deployments (bare metal, VMs without cgroup limits).

If your CPU limit is large (e.g. 8 CPUs on a 16-core node), the difference between
`GOMAXPROCS=16` and `GOMAXPROCS=8` is smaller but still meaningful — the scheduler still has
fewer Ps to thrash through.

---

## Goroutine-local storage — when context.Context is the bottleneck

The argument for GLS is that passing `ctx` through every function call has a cost (~1-2ns per
call). The argument against is that the runtime overhead of GLS is comparable or higher, and
the API surface is larger.

Real measurements: for code that calls `ctx.Value(key)` more than a million times per second,
the linked-list walk inside `context` becomes visible in profiles. Solutions that don't
require GLS:

- Cache the value at the top of the request and pass it explicitly to inner functions.
- Use a typed wrapper struct instead of `context.Value`.
- For tracing only, use `runtime/pprof.Labels` which is a per-G linked list lookup but is
  goroutine-attached.

None of these is GLS in the language sense. The optimization conclusion: GLS is a micro-
optimization for an extreme case that almost no one hits.

---

## Structured concurrency — overhead vs. errgroup

A hypothetical language-level structured concurrency block would compile to roughly the same
code as `errgroup.WithContext` + `g.Wait()`. There is no expected performance difference.

The proposal is about **correctness**, not speed: making "all children done before parent
returns" a language guarantee instead of a library convention.

If you adopt the polyfill `Scope` type from the tasks page now, you get exactly the same
performance as direct `errgroup`. No optimization is left on the table by waiting for the
language feature.

---

## Cross-cutting: which proposal to adopt first

If you can ship Go 1.24 today, the order of optimization wins is roughly:

1. **automaxprocs** (or equivalent) — biggest cost reduction, smallest code change.
2. **runtime.AddCleanup** for finalizer-heavy code paths.
3. **weak.Pointer** for interning and identity-keyed caches.
4. **testing/synctest** for test suite speedup (developer time, not runtime).
5. **iter.Pull** for hot serial iteration paths.

Everything else (atomic vector ops, structured concurrency, GLS) is either still proposed or
not worth chasing yet. Wait for the formal acceptance, then revisit.

### Cost-of-not-adopting

For each proposal above, ask: what's the cost of not adopting it?

- **automaxprocs:** 30-70% CPU waste on containers. Adopt now.
- **AddCleanup:** higher tail-latency GC pauses. Adopt for cleanup-heavy services.
- **weak.Pointer:** unbounded cache growth. Adopt for identity caches.
- **synctest:** flaky CI, longer test runs. Adopt for timing-heavy test suites.
- **iter.Pull:** ~5-10x overhead on serial iteration hot paths. Adopt where measured.

If you do nothing, your code still works. The cost is incremental, paid in CPU, memory, or
test minutes. The decision to adopt is therefore one of priorities, not necessity.

---

## Benchmark methodology for these features

When benchmarking new concurrency features, a few rules:

1. **Measure with `-race` enabled** to ensure your microbenchmark is correct, then re-run
   without it to get the production-realistic number.
2. **Set `GOMAXPROCS` explicitly** in your benchmark to avoid auto-detection skewing results.
3. **Warm up** with `b.ResetTimer()` after any initialization.
4. **Run for at least 5 seconds** (use `-benchtime=5s`) to smooth out scheduling jitter.
5. **Use `-count=10`** and look at the distribution, not just the mean.

For comparison benchmarks (e.g. `iter.Pull` vs goroutine+channel), keep the per-step work
identical. If the iterator computes Fibonacci while the channel version does no work, the
benchmark is meaningless.

---

## A final perspective on speculation

Performance numbers in this page are estimates from current Go versions. Future Go versions
will move them. The Go runtime team frequently makes the scheduler faster, the GC quieter, and
the allocator lower-overhead. The gap between "old" and "new" patterns shrinks over time.

Treat the optimization advice as directional, not absolute. The actual measurements on your
service, on your Go version, are what counts. Re-benchmark after each major Go upgrade.
