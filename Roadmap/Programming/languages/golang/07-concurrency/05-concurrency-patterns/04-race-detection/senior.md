# Race Detection — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Detector Architecture](#detector-architecture)
3. [Vector Clocks and TSan](#vector-clocks-and-tsan)
4. [Performance Overhead](#performance-overhead)
5. [False Negatives in Practice](#false-negatives-in-practice)
6. [Memory Model in Depth](#memory-model-in-depth)
7. [CI Integration](#ci-integration)
8. [Race Detector and Cgo](#race-detector-and-cgo)
9. [Atomics in Depth](#atomics-in-depth)
10. [Sharded Counters](#sharded-counters)
11. [Lock-Free Patterns](#lock-free-patterns)
12. [Tooling Around `-race`](#tooling-around-race)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)

---

## Introduction

Senior-level race detection means understanding not just *how* to fix a race but the architecture of the detector, its limits, and the formal model behind it. You should be able to:

- Explain why an intermittent test failure is or is not a race.
- Decide between mutex, atomic, and channel as the correct primitive.
- Audit code for memory-model violations the detector cannot catch.
- Integrate `-race` into a production CI pipeline.

This file assumes fluency with the middle-level material.

---

## Detector Architecture

The Go race detector is built on **ThreadSanitizer v2** (TSan), the same instrumentation Google uses for C++ race detection. The pipeline is:

1. The compiler, when invoked with `-race`, replaces every memory load and store with a call into the runtime: `__tsan_read1`, `__tsan_write8`, etc.
2. The runtime maintains, for each goroutine, a vector clock. Every synchronisation event (mutex unlock, channel send, atomic store-release, sync.Once.Do, WaitGroup.Done) advances or merges clocks.
3. For each memory address, the runtime keeps a small history (~4 entries) of recent accesses with their clocks.
4. On every memory access, the runtime checks: was there a previous access from a different goroutine whose clock is *not* ordered before the current goroutine's clock? If so, report a race.
5. The first race per address is reported; subsequent races on the same address are suppressed for a while.

The instrumentation is direct — no sampling. Every access is checked. This is why it is accurate (almost no false positives) but expensive.

---

## Vector Clocks and TSan

A vector clock is a vector of integer counters, one per goroutine. Each goroutine has its own clock. When goroutine A synchronises with goroutine B (e.g., A acquires a mutex B previously released), B's clock is merged into A's.

```
Goroutine 1 clock: [1: 5, 2: 3, 3: 7]
Goroutine 2 clock: [1: 2, 2: 8, 3: 4]

After 1 receives a message from 2 on a channel:
Goroutine 1 clock: [1: 5, 2: 8, 3: 7]   ← max of corresponding entries
```

A memory access stores the writer's clock alongside the address. A reader compares its current clock to the stored clock; if every component is ≥, the access is ordered (no race); otherwise, race.

Practical implications:

- **Cap on goroutines**: vector clocks grow with goroutine count. The detector caps tracked goroutines around 8128. Above that, results are unreliable.
- **Per-address overhead**: each tracked address occupies ~32-128 bytes. Memory overhead is ~2-3x the program's normal heap.
- **CPU overhead**: every load/store becomes a function call plus clock comparison. Expect 5-10x slowdown on hot paths.

---

## Performance Overhead

A typical breakdown:

| Aspect | Without `-race` | With `-race` |
|--------|-----------------|--------------|
| CPU | baseline | 5-10x slower |
| Memory | baseline | 2-3x more heap |
| Binary size | baseline | +30-50% |
| Startup | baseline | slightly slower (TSan runtime) |

Some workloads pay more:
- Very write-heavy workloads (shared map mutation): up to 20x slower.
- Heavy cgo: most of cgo runs uninstrumented, so overhead is lower but coverage is worse.

Why we accept this in CI: catching even one production race is worth hours of CI compute.

Why we never ship `-race` to production: a 5x slowdown breaks every SLO.

---

## False Negatives in Practice

The detector reports only races it observes. It does *not* prove the absence of races. Common false-negative scenarios:

1. **The race needs specific scheduling.** Two goroutines accessing the same variable might run sequentially in test (the scheduler picks one then the other). Add `-cpu=1,2,4,8` and `-count=N` to vary scheduling.
2. **The race is in a code path not exercised.** Add tests for that path.
3. **The race is in cgo or unsafe.** TSan does not instrument C code; pointer arithmetic via `unsafe` may bypass instrumentation.
4. **The race involves rare events.** If two goroutines write to the same variable but only one writes once at startup, the test rarely triggers it.

A senior practice: stress runs. Take the suspect test, run with `-race -count=1000 -cpu=1,8`. If it reports nothing, you have moderate (not absolute) confidence.

---

## Memory Model in Depth

The Go memory model (https://go.dev/ref/mem) defines:

- **happens-before**: a partial order on memory operations within a program execution.
- **synchronizing operations**: operations that establish edges in this order.
- **data race**: two memory accesses (one a write) to the same location, not ordered by happens-before, and not both atomic.

Synchronising operations:

1. Channel send happens-before the matching receive completes.
2. Channel close happens-before a receive that observes the close.
3. The k-th receive on an unbuffered channel happens-before the k-th send completes.
4. `sync.Mutex.Unlock` happens-before the next `Lock` returns.
5. `sync.RWMutex.Unlock` happens-before the next `RLock` and `Lock`.
6. `sync.Once.Do(f)`'s call to f happens-before the return of any later `Do(f)`.
7. A `sync.WaitGroup.Done` happens-before a `Wait` that decrements the counter to zero.
8. An atomic store with release semantics happens-before an atomic load with acquire that observes it.
9. The exit of a goroutine *does not* happen-before any event in another goroutine; you need an explicit edge (e.g., wg.Wait).
10. The `go f()` statement happens-before the start of f's execution.

A subtler one for senior engineers: **there is no happens-before between two atomic operations on different variables** unless those atomics are sequentially consistent (which Go's atomics are, by spec). So Go's atomics are stronger than C++ relaxed atomics; you cannot get C++-style race-free-but-non-SC behaviour in Go.

---

## CI Integration

A senior CI pipeline includes:

```yaml
race-test:
  strategy:
    matrix:
      cpu: [1, 4, 8]
  steps:
    - run: go test -race -count=3 -cpu=${{ matrix.cpu }} ./...
      env:
        GORACE: "halt_on_error=1 exitcode=66"

stress-test:
  if: github.event_name == 'schedule' # nightly
  steps:
    - run: go test -race -count=200 ./internal/concurrent/...
      timeout-minutes: 60
```

Two stages:

1. **Per-PR**: Race tests at multiple CPU settings, count=3 (catches scheduling-sensitive races).
2. **Nightly**: High-iteration stress tests on the most concurrency-heavy packages.

Additional safeguards:

- A `go vet` step catches some races statically (e.g., `copylocks`).
- `staticcheck` catches more (e.g., `SA2002` — concurrent map access in some shapes).
- `goleak` catches goroutine leaks, often a symptom of broken concurrency.

---

## Race Detector and Cgo

Cgo code is uninstrumented. Memory access from C is invisible to TSan. Implications:

- A race entirely in C code is missed.
- A race between Go and C code (Go reads memory C is writing) may or may not be caught — depends on whether Go's load is instrumented.
- Pointers passed across the cgo boundary: ownership rules apply (Go pointers cannot be stored by C beyond the call).

Mitigations:

- Use `-fsanitize=thread` when building the C side to instrument it (rare in Go projects).
- Wrap cgo calls in clear ownership boundaries: pass values, copy buffers, do not retain pointers.
- Test cgo-heavy code with extreme paranoia. The detector will not save you.

---

## Atomics in Depth

`sync/atomic` operations:

- `Load*`, `Store*`: load/store with sequential consistency.
- `Add*`, `Swap*`: read-modify-write atomically.
- `CompareAndSwap*`: classic CAS.

Typed wrappers (Go 1.19+): `atomic.Int32`, `atomic.Pointer[T]`, `atomic.Value`. These guarantee alignment on 32-bit platforms (the original `int64` atomics required the variable to be 64-bit aligned, which struct fields do not always satisfy).

Senior judgement on atomics:

- **Single integer or pointer**: atomic suffices.
- **Multiple fields updated together**: mutex required. Atomics cannot atomically update two fields.
- **Read-mostly hot path with occasional write**: `atomic.Pointer[Config]` for snapshot replacement is faster than `RWMutex`.
- **Counter under contention**: `atomic.Add` is faster than `Mutex.Lock; counter++; Mutex.Unlock` for simple counters but contends on the cache line.

Cache-line contention: if many goroutines hammer one atomic, every CPU's L1 invalidates that cache line on each write. Throughput collapses. Solution: shard.

---

## Sharded Counters

For high-rate counters under contention:

```go
type ShardedCounter struct {
    shards []atomic.Int64
    mask   uint64
}

func NewShardedCounter(shards int) *ShardedCounter {
    if shards&(shards-1) != 0 {
        panic("shards must be power of 2")
    }
    return &ShardedCounter{
        shards: make([]atomic.Int64, shards),
        mask:   uint64(shards - 1),
    }
}

func (c *ShardedCounter) Add(delta int64) {
    // pick a shard based on the goroutine's pseudo-random ID
    idx := fastrand() & c.mask
    c.shards[idx].Add(delta)
}

func (c *ShardedCounter) Value() int64 {
    var sum int64
    for i := range c.shards {
        sum += c.shards[i].Load()
    }
    return sum
}
```

Each shard is on its own cache line (or padded to be so). Writes scatter; the hot cache line is gone.

`fastrand()` is a runtime-internal function; in user code use `math/rand.Intn` or pin the goroutine to a fixed shard via runtime hooks. Some libraries use the `runtime_procPin/unpin` pair for this.

Trade-off: `Value()` is now O(shards). Acceptable if reads are rare.

---

## Lock-Free Patterns

True lock-free queues are hard to write correctly. Production options:

- **Treiber stack**: a CAS-based lock-free LIFO. Useful for free lists.
- **Michael-Scott queue**: a CAS-based MPMC queue. Available in third-party libraries.
- **`sync.Pool`**: an internal lock-free per-P cache for object reuse. Use it; do not rebuild it.
- **`atomic.Pointer` snapshot swap**: simple lock-free for read-mostly state.

Most production Go does not need lock-free queues. Channels are good enough up to ~10M ops/sec on a single channel. Beyond that, redesign before reaching for atomics.

---

## Tooling Around `-race`

- `go test -race` — primary tool.
- `go vet` — catches `copylocks`, `loopclosure` (loop var capture), some race-prone shapes.
- `staticcheck` — wider net of concurrency-related lints.
- `goleak` — tests goroutine leakage.
- `pprof` — profile under `-race` to find synchronisation bottlenecks.
- `go tool trace` — visualise goroutine scheduling, channel events, blocking.
- `golangci-lint` — orchestrates the above.

A senior team runs all of these in CI.

---

## Cheat Sheet

| Decision | Senior choice |
|----------|---------------|
| Single-variable counter, low contention | `atomic.Int64` |
| Multi-field update | `sync.Mutex` |
| Read-mostly config | `atomic.Pointer[Config]` |
| Hot-counter contention | sharded atomic |
| Communication | channel |
| Lazy init | `sync.Once` |
| One-shot signal | `chan struct{}` close |
| Map of varying keys | `sync.Map` (rarely) or `map+RWMutex` |

CI matrix: race tests at CPUs 1, 4, 8 with `-count=3`; nightly stress at `-count=200`.

---

## Summary

Senior race detection is a combination of language fluency (the memory model), tool fluency (TSan internals, cgo limits), and engineering practice (CI matrices, sharding, atomic vs mutex judgement). The race detector is necessary but not sufficient; production-grade Go also requires vector-clock awareness, careful primitive choice, and a stress-test discipline that goes beyond a single `go test -race ./...` run.
