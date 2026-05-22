# N-Barrier — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [When to Introduce a Barrier](#when-to-introduce-a-barrier)
3. [When to Refuse a Barrier in Review](#when-to-refuse-a-barrier-in-review)
4. [Review Checklist](#review-checklist)
5. [Designing the Barrier into a Service](#designing-the-barrier-into-a-service)
6. [Observability and Operations](#observability-and-operations)
7. [Interaction with the Wider Codebase](#interaction-with-the-wider-codebase)
8. [Distributed Barriers](#distributed-barriers)
9. [Migration: Replacing an Ad-Hoc Barrier](#migration-replacing-an-ad-hoc-barrier)
10. [War Stories](#war-stories)
11. [Cheat Sheet](#cheat-sheet)
12. [Summary](#summary)

---

## Introduction

By the professional level the question is rarely "how do I implement a barrier" and almost always "should this barrier exist in our codebase, and if so, how do we keep it from becoming a 3 a.m. page?" Barriers are a *liveness liability*: their characteristic failure is a deadlock, and a deadlock in a phased subsystem usually freezes a whole pipeline. This file is about team-level judgement — introducing, reviewing, operating, and removing barriers.

---

## When to Introduce a Barrier

Introduce one only when *all* of these hold:

1. **The work is genuinely phased** — phase *k+1* reads data that phase *k* writes, for the same long-lived workers.
2. **Workers must persist across phases** because they hold expensive, hard-to-rebuild state (warm caches, pinned cores, open GPU contexts, large preallocated arenas). If workers are cheap to recreate, prefer errgroup-per-phase.
3. **The party count is stable** for the lifetime of a trip.
4. **You have a cancellation story** — a `context`, an abort path, and a watchdog.

If any one fails, the barrier is probably the wrong abstraction. The most common honest answer in application code is "we don't need a barrier; we need `errgroup` with one `Wait()` per phase."

---

## When to Refuse a Barrier in Review

Push back when you see:

- A barrier used for **one-shot** "wait for all to finish" — that is a `WaitGroup`/`errgroup`.
- A barrier guarding **stateless** workers that could just be re-spawned per phase.
- A barrier with **no abort/cancel path** — it *will* deadlock in production the first time a party errors.
- A **hand-rolled `count` reset** without a generation counter or sense flag — the fast-looper race.
- A barrier whose **N is read from mutable shared state** mid-trip.
- A **phase action that can block or re-enter** the barrier.
- A barrier added for "performance" with **no benchmark** showing the re-spawn idiom was too slow.

A barrier in a PR should come with: a justification for long-lived workers, the cancellation path, a test that runs under `-race` with a timeout, and ideally a benchmark vs the re-spawn alternative.

---

## Review Checklist

```text
[ ] Justified: long-lived workers with expensive state (not stateless re-spawn candidates)
[ ] Correct reset: generation counter or sense flag, never a bare count=0
[ ] for-loop around cond.Wait(), never a bare if
[ ] N fixed per trip; matches the goroutine count exactly
[ ] Every worker path reaches Wait() once per phase (no early return/continue that skips it)
[ ] Cancellable: context-aware wait + Abort() on error/panic
[ ] Panic safety: defer-recover in each phase body calls Abort()
[ ] Watchdog: deadline that logs which parties have NOT arrived
[ ] Double barrier where a shared buffer is swapped
[ ] Tests: -race, GOMAXPROCS>1, timeout-guarded join, multi-phase, abort path
[ ] Metrics: trips/sec, per-phase wait time, straggler identity
```

Treat a missing cancellation path as a blocking review comment, not a nit. It is the difference between a recoverable error and a frozen service.

---

## Designing the Barrier into a Service

Encapsulate the barrier behind a domain-meaningful type. Callers should see "phases of the simulation," not "a sync primitive."

```go
// SimEngine runs a fixed pool of workers in lockstep ticks.
type SimEngine struct {
    workers int
    barrier *barrier.Safe
    state   *World
}

func (e *SimEngine) Run(ctx context.Context, ticks int) error {
    g, gctx := errgroup.WithContext(ctx)
    for id := 0; id < e.workers; id++ {
        id := id
        g.Go(func() error { return e.worker(gctx, id, ticks) })
    }
    return g.Wait()
}

func (e *SimEngine) worker(ctx context.Context, id, ticks int) error {
    defer func() {
        if r := recover(); r != nil {
            e.barrier.Abort()
            panic(r) // re-panic after releasing peers, so the supervisor sees it
        }
    }()
    for t := 0; t < ticks; t++ {
        e.compute(id, t)
        if err := e.barrier.Wait(ctx); err != nil {
            return err // peer aborted or context cancelled
        }
        if id == 0 {
            e.state.Swap()
        }
        if err := e.barrier.Wait(ctx); err != nil {
            return err
        }
    }
    return nil
}
```

Note the combination: `errgroup` owns lifecycle and error propagation across workers; the `Safe` barrier owns intra-phase lockstep; `Abort()` bridges the two so an error or panic in one worker tears down the cohort gracefully. This layering — errgroup outside, barrier inside — is the production-grade shape.

---

## Observability and Operations

A barrier is a black box until you instrument it. Track:

| Metric | Why it matters |
|--------|----------------|
| `barrier_trips_total` | Throughput; a flat line means phases stopped advancing (stuck). |
| `barrier_wait_seconds` (histogram) | Time parties spend blocked = straggler cost. Rising p99 = imbalance. |
| `barrier_parties_arrived` (gauge per trip) | If it plateaus below N, a party is hung — alert on this. |
| `barrier_aborts_total` | Error/cancel rate. |
| straggler identity | Which party arrives last most often → where to rebalance. |

Operational signals:

- **Stuck barrier:** `parties_arrived < N` for longer than the phase SLA. The watchdog should log the *missing* party IDs and their last-known stack (via `runtime.Stack`).
- **Straggler imbalance:** one party consistently arrives last → uneven sharding or a noisy neighbour. Rebalance the work, do not enlarge the barrier.
- **Abort storms:** rising `barrier_aborts_total` usually means upstream cancellation or a flaky dependency in the phase body.

Wire a `pprof` goroutine dump to fire automatically when the barrier watchdog trips — a deadlocked barrier is trivially diagnosable from a goroutine dump (you will see N-1 goroutines parked in `sync.runtime_notifyListWait` and one elsewhere).

---

## Interaction with the Wider Codebase

- **Context propagation.** The barrier's wait must honour the request/job context so a cancelled job does not leave a parked cohort. Thread `ctx` from the caller all the way into `Wait(ctx)`.
- **Goroutine pools.** If the barrier's parties come from a shared worker pool, a stuck barrier *holds those pool slots*, starving the rest of the system. Prefer a *dedicated* set of goroutines for barriered work, or bound how long they may hold a slot.
- **Backpressure.** A barriered subsystem advances at its slowest party; upstream producers must handle that pace (a bounded queue in front, see the Push-Pull pattern). A barrier with an unbounded inbox just moves the OOM risk upstream.
- **Graceful shutdown.** Shutdown must `Abort()` the barrier (or cancel its context) so parked workers exit. A naive `close(quit)` that workers check *after* the barrier never gets read by a parked party.
- **Testing seams.** Inject the barrier (or a barrier interface) so tests can substitute a deterministic or instrumented version. A barrier baked in with `sync.Cond` literals is hard to test in isolation.

---

## Distributed Barriers

When parties are separate processes/nodes, an in-memory barrier no longer applies. The same *semantics* (all N reach the line, then all proceed) are provided by coordination services:

- **etcd / Consul / ZooKeeper.** ZooKeeper's recipe book defines a "double barrier": each node creates an ephemeral znode under a barrier path; when the child count reaches N, all enter; a symmetric protocol governs leaving. etcd offers similar primitives via leases + transactions.
- **Kubernetes Jobs with completions/parallelism.** A Job's completion count is effectively a one-shot barrier across pods.
- **Spark / MapReduce stage boundaries.** The framework barriers between stages; you rarely build it yourself.

Distributed barriers add the failure modes of the network: a node may *appear* not to arrive because of a partition. Always pair a distributed barrier with a lease/TTL so a dead node's slot is reclaimed and the cohort can make progress or fail explicitly — never "wait forever for a node that will never return."

---

## Migration: Replacing an Ad-Hoc Barrier

Teams often have a home-grown, buggy "barrier" (a shared counter with `time.Sleep` polling, or a re-used `WaitGroup` that occasionally panics). To migrate safely:

1. **Characterise the current behaviour** with a test that captures the *intended* lockstep (phases, party count, abort behaviour). It will probably reveal latent bugs.
2. **Introduce the new barrier behind the same call site** (an interface or a thin wrapper) so the diff is small.
3. **Run both in shadow** if the system is critical: log a divergence metric when the new barrier would trip at a different time than the old logic.
4. **Add the cancellation path the old code lacked** — this is usually the whole reason to migrate.
5. **Delete the `time.Sleep` polling.** Spin-polling a counter wastes CPU and adds latency jitter; a `Cond`/channel barrier wakes precisely.

A frequent finding: the ad-hoc barrier "worked" only because the workload happened to be balanced; the new barrier exposes a straggler the old code masked with sleeps.

---

## War Stories

- **The forgotten `return`.** A worker added an early `return err` on a validation failure *before* `barrier.Wait()`. In tests (always-valid data) it passed. In production the first bad record stranded the other 31 workers; the pipeline froze and the on-call saw 31 goroutines parked in `notifyListWait`. Fix: the abort-on-error path, and a lint rule that flags `return` between two `Wait()` calls.
- **The autoscaler vs the barrier.** A pool autoscaled mid-trip; the new worker did not call `Wait()` for the in-flight generation, so N never matched. Fix: freeze membership per trip; size the barrier from the *live* roster between trips.
- **Sleep-polling tax.** A "barrier" implemented as `for atomic.Load(&n) < N { time.Sleep(time.Millisecond) }` added ~1 ms p50 latency per phase; at thousands of phases that dominated runtime. Replacing it with a `Cond` barrier cut phase latency by 30x.
- **The 32-bit generation overflow that wasn't.** A reviewer worried the `uint64` generation counter would overflow. At a billion trips/sec it overflows in ~580 years. Use the sense-reversing barrier only if you genuinely dislike the (non-)concern; do not over-engineer.

---

## Cheat Sheet

```text
INTRODUCE when: phased + long-lived stateful workers + fixed N + cancellation story
REFUSE when:    one-shot, stateless, no abort path, hand-rolled reset, no benchmark
LAYER:          errgroup (lifecycle/errors) OUTSIDE, barrier (lockstep) INSIDE
INSTRUMENT:     trips_total, wait_seconds, parties_arrived (alert < N), aborts_total
SHUTDOWN:       Abort()/cancel ctx — never rely on a flag a parked party can't read
DISTRIBUTED:    etcd/ZK double-barrier + lease/TTL; never wait forever for a dead node
```

---

## Summary

Professionally, a barrier is a deliberate liveness risk you accept only when long-lived workers with expensive state must run in lockstep across many phases — and only with a cancellation path, panic-to-abort safety, and a watchdog that names stuck parties. In review, refuse barriers that are really one-shot waits, that guard stateless workers, that reset their count by hand, or that lack an abort path. In a service, layer `errgroup` (lifecycle and errors) around the barrier (lockstep), instrument trips and per-phase wait time, alert when arrived-parties stalls below N, and ensure shutdown aborts the barrier. Across processes, the same semantics come from etcd/ZooKeeper double-barriers, always paired with a lease so a dead node never freezes the cohort forever.
