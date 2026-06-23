# Livelock — Specification

## Table of Contents
1. [Definitions](#definitions)
2. [Distinguishing Properties](#distinguishing-properties)
3. [Required Conditions](#required-conditions)
4. [Standard Cures](#standard-cures)
5. [Standard Detection Mechanisms](#standard-detection-mechanisms)
6. [Reference Algorithms](#reference-algorithms)
7. [Library and API Reference](#library-and-api-reference)
8. [Versioned Behaviour in Go](#versioned-behaviour-in-go)

---

## Definitions

### Livelock

A state of a concurrent system in which two or more execution units (goroutines, threads, processes) are concurrently *running* and reacting to one another, yet the system makes no useful progress over an unbounded time interval.

Equivalent formal statement: there exists an infinite execution where some application-defined progress predicate `P` is never satisfied, even though no execution unit is in a *blocked* state.

### Progress

An application-defined predicate over the state of the system. Examples:

- A request has been served.
- An item has been processed.
- A commit has been recorded.

Progress is *not* the same as "an iteration completed." A retry loop iterating forever satisfies "iteration progress" but not "request progress."

### Liveness

The property that, eventually, something good happens. In temporal logic: `◇P` for some predicate `P`.

### Safety

The property that, always, something bad never happens. In temporal logic: `□¬B` for some predicate `B`.

### Deadlock vs Livelock vs Starvation

| Property | Deadlock | Livelock | Starvation |
|----------|----------|----------|-----------|
| Goroutines blocked | Yes (all) | No | No (some are) |
| CPU usage | Low | High | Mixed |
| Some progress | No | No | Yes (others progress) |
| Specific party stuck | All | All | One or few |
| Cure category | Lock ordering / detection | Randomisation / priority | Fairness / FIFO |

---

## Distinguishing Properties

### Livelock vs deadlock

- Deadlock: every relevant goroutine is in `waiting` state (parked on a mutex, channel, or sync primitive). The Go runtime can sometimes detect this (`all goroutines are asleep`).
- Livelock: every relevant goroutine is in `running` or `runnable` state. The runtime cannot detect this.

### Livelock vs starvation

- Starvation: at least one goroutine makes progress at the expense of one or more others. The system is making progress; the victim is denied.
- Livelock: no goroutine makes useful application progress. The whole system is stalled despite running.

### Livelock vs contention

- Contention: progress is slow because of competition for a resource, but throughput scales with the cost of the critical section.
- Livelock: progress is bounded *below* the intrinsic critical-section cost because most time is spent in retry / wait overhead.

Operational test: halve the goroutines and observe throughput.
- Throughput halves → no contention or livelock; you were CPU-bound.
- Throughput doubles → contention.
- Throughput more than doubles → livelock.

---

## Required Conditions

Livelock requires all four:

1. **Multiple actors.** At least two execution units must compete or coordinate.
2. **Shared state.** A resource over which the actors interact: a memory location, a lock, a leadership lease.
3. **Reaction loop.** Each actor's behaviour depends on the others' state; on observing conflict, the actor retries.
4. **Synchrony.** The actors retry on schedules that overlap predictably; the conflict pattern reproduces.

Removing any one prevents livelock.

---

## Standard Cures

### Cure 1: Randomisation

Add random jitter to back-off intervals. Breaks synchronous retries; the canonical fix.

Standard formula:

```
sleep = base_backoff + uniform_random([0, base_backoff))
```

This is "full jitter." Variants include "equal jitter" (half-deterministic, half-random) and "decorrelated jitter" (next sleep depends on previous).

### Cure 2: Priority

Designate one actor as the winner of ties. Asymmetric protocol prevents oscillation.

Standard mechanisms:
- Lock order by address (`uintptr(unsafe.Pointer(&a)) < uintptr(unsafe.Pointer(&b))`).
- ID-based priority (lower ID wins, or hash-based).
- Designated leader / proposer (Multi-Paxos, Raft leader).

### Cure 3: Bounded retries

Convert a potential infinite loop into a bounded one. After N attempts, return an error.

```
for attempt := 0; attempt < maxAttempts; attempt++ { ... }
return errExhausted
```

### Cure 4: Coalescing

Merge concurrent requests for the same work. `singleflight.Group.Do` is the canonical Go implementation.

### Cure 5: Sharding

Spread contention across multiple resources. N shards reduce per-shard contention by 1/N.

### Cure 6: Algorithm change

Replace a livelock-prone algorithm with a livelock-free alternative.

- `atomic.Add` instead of CAS loop for counters.
- `sync.Mutex` (which parks losers) instead of spinlock.
- MVCC instead of optimistic-snapshot loops.

### Cure 7: Load shedding

Reject excess load at the edge. Reduces the actor count below the livelock threshold.

### Cure 8: AIMD

Adaptive Increase, Multiplicative Decrease. Dynamically size concurrency to maximum sustainable level.

---

## Standard Detection Mechanisms

### Mechanism 1: Throughput counter

Application-level success counter; alert when it stays below threshold for N seconds.

### Mechanism 2: Success-to-attempt ratio

Application-level: track both attempts and successes; the ratio is the livelock signal.

### Mechanism 3: CPU profile

`go tool pprof` CPU profile dominated by a tight loop is a livelock signature.

### Mechanism 4: Goroutine dump

Many goroutines in the same retry function in `runnable` state.

### Mechanism 5: Tracing

`go tool trace` showing repeated short bursts of execution with no useful work between them.

### Mechanism 6: Latency p99 spike with stable goroutine count

p99 climbing while goroutine count is stable rules out leaks; combined with CPU at the saturation point, livelock becomes likely.

### Mechanism 7: Health check coupled with progress

Liveness probes that check *progress*, not just *responsiveness*. A livelocked service responds to ping; it does not advance work.

---

## Reference Algorithms

### Algorithm: Exponential back-off with full jitter

```
function fullJitter(attempt, base, cap):
    delay = min(cap, base * 2^attempt)
    return uniformRandom(0, delay)
```

### Algorithm: Decorrelated jitter

```
function decorrelatedJitter(prev, base, cap):
    delay = uniformRandom(base, prev * 3)
    return min(cap, delay)
```

`prev` is the previous delay; on the first call, `prev = base`.

### Algorithm: AIMD permits

```
on success: permits := permits + 1
on failure: permits := max(1, permits / 2)
on request: if permits > inflight: proceed
            else: reject
```

### Algorithm: Single-flight call

```
function Do(key, fn):
    if call already in flight for key:
        wait for result
        return same result
    else:
        run fn, store result, signal waiters
        return result
```

### Algorithm: Sharded counter

```
function Inc():
    shard := hash(goroutine_id) mod N
    atomic_add(shards[shard], 1)

function Sum():
    s := 0
    for i in 0..N: s += atomic_load(shards[i])
    return s
```

### Algorithm: Randomised election timeout (Raft)

```
electionTimeout = baseTimeout + uniformRandom(0, baseTimeout)
```

Where `baseTimeout` is typically 150 ms. Random component is at least 50% of base.

---

## Library and API Reference

### `sync/atomic`

- `atomic.Int64.Add(delta int64) int64` — single-instruction atomic add. Livelock-free.
- `atomic.Int64.CompareAndSwap(old, new int64) bool` — CAS. Livelock-prone in tight loops at high contention.
- `atomic.Value.Store(v any)` — atomic store of any value. Used internally with optimised paths.

### `sync`

- `sync.Mutex` — mutex with FIFO discipline and starvation mode (Go 1.9+). Livelock-resistant by design.
- `sync.Mutex.TryLock() bool` — non-blocking attempt (Go 1.18+). Livelock-prone if used in a retry loop without jitter.
- `sync.RWMutex` — readers/writer mutex. Has its own subtle starvation modes.
- `sync.Map` — concurrent map. Read-mostly optimisation. Not a generic livelock cure.
- `sync.Once` — at-most-once execution. Internally uses atomic + mutex. Livelock-free.
- `sync.Pool` — object reuse. Beware ABA-style issues, but not livelock-prone itself.
- `sync.Cond` — condition variable. Livelock-free under correct use.

### `golang.org/x/sync`

- `singleflight.Group.Do(key, fn)` — coalesce duplicate concurrent calls. Cures thundering-herd livelock.
- `errgroup.Group` — bounded goroutine group with context cancellation. Helpful for bounded retries.
- `semaphore.Weighted` — weighted semaphore for concurrency limiting.

### `github.com/cenkalti/backoff/v4`

- `backoff.NewExponentialBackOff()` — exponential back-off with default jitter.
- `backoff.WithContext(b, ctx)` — adds context cancellation.
- `backoff.WithMaxRetries(b, max)` — bounded retries.
- `backoff.Retry(operation, b)` — main retry loop.
- `backoff.Permanent(err)` — short-circuits retry on definite failures.

### `golang.org/x/time/rate`

- `rate.Limiter` — token-bucket rate limiter. Useful for capping retry rate.

### Runtime

- `runtime.NumGoroutine() int` — current goroutine count. Stable count under livelock.
- `runtime.GOMAXPROCS(n int)` — CPU parallelism. Affects livelock symptoms.
- `runtime.Gosched()` — yield CPU. Not a livelock cure but used in mixed strategies.

### `net/http/pprof`

- `/debug/pprof/profile` — CPU profile.
- `/debug/pprof/goroutine` — goroutine dump.
- `/debug/pprof/trace` — execution trace.

---

## Versioned Behaviour in Go

| Go version | Relevant change |
|-----------|------------------|
| 1.9 | `sync.Mutex` starvation mode introduced. Reduces livelock between newcomers and FIFO waiters. |
| 1.14 | Asynchronous preemption. Goroutines in tight loops can be preempted by the scheduler, mitigating "stuck on one core" livelock symptoms but not curing the bug. |
| 1.18 | `sync.Mutex.TryLock()` added. Introduces a new livelock-prone pattern; document it carefully. |
| 1.18 | Generics. Allows livelock-free generic data structures (sharded counters parameterised on type). |
| 1.19 | `sync/atomic` typed atomics (`atomic.Int64`, `atomic.Pointer[T]`). Cleaner APIs but same livelock properties as before. |
| 1.20 | `math/rand` seeded automatically. Eliminates "everyone seeds with 1" failure mode. |
| 1.21 | `min`, `max` builtins. Useful in back-off formulas. |
| 1.22 | `math/rand/v2`. Goroutine-safe by default with per-goroutine state. Recommended for jitter. |
| 1.22 | Loop variable per-iteration semantics. Fixes a class of bugs but not specifically livelock-related. |

---

## Conformance Tests

A library or service claiming "livelock-resistant" should pass:

1. **Throughput under contention.** Throughput stays above 50% of single-goroutine maximum at N goroutines, for N up to 1000.
2. **Bounded retry latency.** No retry exceeds a documented maximum.
3. **Context cancellation.** Cancelling the context aborts all retries within 100 ms.
4. **Jitter dispersion.** Repeated runs of N goroutines retrying at the same time produce retry timestamps whose pairwise distance is at least the back-off / N expected value.
5. **No silent infinite loop.** Every retry path has a documented bound and an error return.

---

## Glossary of Symbols Used in This Section

| Symbol | Meaning |
|--------|---------|
| `N` | Number of concurrent goroutines / actors. |
| `T` | Time bound or elapsed time. |
| `P` | Progress predicate. |
| `◇` | "Eventually" (temporal logic). |
| `□` | "Always" (temporal logic). |
| `attempts/s` | Attempt rate per second. |
| `success/s` | Useful-operation rate per second. |
| `base` | Base back-off interval before jitter. |
| `cap` | Maximum back-off interval. |

This specification is the reference for terminology elsewhere in this section. When a junior or middle file says "decorrelated jitter," it means the algorithm defined here.
