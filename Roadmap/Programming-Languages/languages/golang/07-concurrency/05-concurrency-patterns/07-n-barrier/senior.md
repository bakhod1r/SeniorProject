# N-Barrier — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Idiomatic Go: Do You Even Need a Barrier?](#idiomatic-go-do-you-even-need-a-barrier)
3. [Barrier vs errgroup for Phased Work](#barrier-vs-errgroup-for-phased-work)
4. [The Memory Model Contract](#the-memory-model-contract)
5. [Centralised Barrier Contention](#centralised-barrier-contention)
6. [Dissemination and Tree Barriers](#dissemination-and-tree-barriers)
7. [Sense-Reversing Barriers](#sense-reversing-barriers)
8. [Dynamic Party Counts](#dynamic-party-counts)
9. [Context, Timeouts, and Recovery](#context-timeouts-and-recovery)
10. [Where Barriers Fail](#where-barriers-fail)
11. [Production Checklist](#production-checklist)
12. [Cheat Sheet](#cheat-sheet)
13. [Summary](#summary)

---

## Introduction

At senior level the barrier stops being a data structure and becomes a *design decision* with sharp edges:

- Half the time a Go reviewer should ask "why not re-spawn workers with `errgroup` per phase instead of a long-lived barrier?"
- The other half, the barrier is right, and then the question is performance: a centralised `Cond` barrier serialises every party through one lock, which becomes the bottleneck at high party counts.
- And in every case, the barrier must interact correctly with `context` cancellation, panics, and the Go memory model.

This file assumes the cyclic barrier, generation counter, and abort path from middle.md.

---

## Idiomatic Go: Do You Even Need a Barrier?

Go's idiom for "do work in phases" is frequently *not* a long-lived barrier at all. It is: **spawn a fresh set of goroutines per phase, join them, repeat.** Joining N goroutines is exactly what `WaitGroup` (or `errgroup`) does, and re-spawning gives you a clean phase boundary with no generation-counter bookkeeping.

```go
for phase := 0; phase < phases; phase++ {
    var wg sync.WaitGroup
    for i := 0; i < n; i++ {
        wg.Add(1)
        go func(id int) { defer wg.Done(); doWork(id, phase) }(i)
    }
    wg.Wait() // implicit barrier between phases
}
```

The implicit barrier here is the `wg.Wait()` between iterations. This is *more* idiomatic than a custom barrier when:

- Goroutine spawn cost is negligible relative to per-phase work (almost always true — goroutines are cheap).
- Workers do not carry expensive per-worker state across phases.

Reach for an explicit barrier only when **goroutines must persist across phases** because they hold costly state (a warmed cache, a pinned CPU, an open connection, a large preallocated buffer) that you do not want to rebuild every phase. That is the genuine niche: long-lived workers in lockstep. If your workers are stateless, prefer the re-spawn idiom and skip the barrier entirely.

---

## Barrier vs errgroup for Phased Work

`golang.org/x/sync/errgroup` is the idiomatic way to run *one* phase and collect the first error with cancellation propagation. Chain a `Group` per phase and you get phased work with error handling for free:

```go
import "golang.org/x/sync/errgroup"

func runPhased(ctx context.Context, phases int, n int, work func(ctx context.Context, phase, id int) error) error {
    for phase := 0; phase < phases; phase++ {
        g, gctx := errgroup.WithContext(ctx)
        for id := 0; id < n; id++ {
            id := id
            g.Go(func() error { return work(gctx, phase, id) })
        }
        if err := g.Wait(); err != nil {
            return fmt.Errorf("phase %d: %w", phase, err)
        }
    }
    return nil
}
```

Compare:

| Property | errgroup-per-phase | Long-lived barrier |
|----------|--------------------|--------------------|
| Error propagation | first error cancels the phase, returned to caller | you must build it (Abort) |
| Cancellation | `errgroup.WithContext` does it | bolt on `context.AfterFunc` |
| Persistent worker state across phases | lost (new goroutines) | preserved |
| Phase boundary | `g.Wait()` | `barrier.Wait()` |
| Spawn cost | N goroutines per phase | N goroutines total |
| Code clarity | very high | moderate |

**Rule of thumb:** default to `errgroup`-per-phase. It gives you error handling and cancellation that you would otherwise reimplement on a barrier. Use a barrier only to preserve expensive per-worker state across many phases, *and* the spawn cost is shown by a benchmark to matter.

---

## The Memory Model Contract

A barrier must establish a *happens-before* edge: every memory write a party performed before its `Wait()` in generation *g* must be visible to every party after `Wait()` returns for generation *g*. The `Cond`/`Mutex` barrier gets this for free because:

- All `count`/`generation` mutations happen under `mu`.
- `cond.Wait()` re-acquires `mu` before returning.
- The Go memory model guarantees that an unlock happens-before a subsequent lock of the same mutex.

So the chain is: party A's writes → A unlocks (inside `Wait`) → Nth party locks, broadcasts, unlocks → A re-locks on wake → A's reads. Visibility holds across the whole cohort. **This is the entire reason a barrier makes the Game-of-Life swap safe.** If you ever build a "lock-free" barrier with atomics, you must reproduce this edge with `atomic` acquire/release semantics or you will get torn reads of phase data on weakly-ordered hardware (ARM).

A subtle corollary: the happens-before edge is per-generation. Writes from generation *g+1* are *not* ordered relative to reads in generation *g* unless a *second* barrier separates them — which is why simulations need the double barrier (compute, swap).

---

## Centralised Barrier Contention

The `Cond` barrier funnels every party through one mutex. At N=4 this is invisible. At N=128 on a 64-core box, every `Wait()` contends on `mu`, every trip wakes 127 goroutines that all immediately re-contend for `mu` to re-check the predicate — a thundering herd. Symptoms: the barrier's wall-clock cost grows super-linearly in N, and a CPU profile shows time in `runtime.lock2` / `sync.(*Mutex).lockSlow`.

Illustrative numbers (synthetic, single trip latency, your hardware will differ):

| N parties | Centralised Cond barrier | Dissemination barrier |
|-----------|--------------------------|------------------------|
| 4 | ~0.3 µs | ~0.5 µs |
| 16 | ~1.4 µs | ~0.9 µs |
| 64 | ~9 µs | ~1.8 µs |
| 256 | ~70 µs | ~3.2 µs |

The centralised barrier is *fine and simpler* for small N (≤ ~16). Beyond that, the log-depth barriers below win.

---

## Dissemination and Tree Barriers

These reduce the O(N) per-trip contention to O(log N) by avoiding a single shared counter.

**Tree (combining) barrier.** Parties are leaves of a tree. Each party signals its parent; a parent signals its parent only after both children arrived; the root, once reached, broadcasts release down the tree. Arrival is O(log N) depth, release is O(log N) depth, and contention is local (each node has ≤ 2 children).

**Dissemination barrier.** No shared state at all. In round *r* (for `ceil(log2 N)` rounds), party *i* signals party `(i + 2^r) mod N` and waits for a signal from `(i - 2^r) mod N`. After all rounds, every party has transitively heard from every other. Each party only ever touches a private per-round flag, so there is *no* central lock.

```go
// Sketch of a dissemination barrier for a power-of-two N.
// Each party owns a slice of per-round flag channels.
type Dissem struct {
    n     int
    rounds int
    // flags[party][round] is signalled (closed/sent) by the partner.
    flags [][]chan struct{}
}
```

These are the right tool for genuinely large, performance-critical lockstep (HPC-style numeric kernels). For the vast majority of Go services, you never reach the N where they pay off — and they are far harder to get right. Document why you chose one if you do.

---

## Sense-Reversing Barriers

A clever lock-light reusable barrier for small-to-medium N that avoids per-trip allocation and minimises shared mutation. Instead of a generation counter, it uses a single boolean *sense* that flips each trip. Each party holds its own *local sense*; it flips its local sense, and the last party flips the *global* sense to match. Waiters spin/wait until `global sense == local sense`.

```go
type SenseBarrier struct {
    mu          sync.Mutex
    cond        *sync.Cond
    n, count    int
    globalSense bool
}

func NewSenseBarrier(n int) *SenseBarrier {
    b := &SenseBarrier{n: n}
    b.cond = sync.NewCond(&b.mu)
    return b
}

// Each goroutine keeps its own localSense, initialised to false.
func (b *SenseBarrier) Wait(localSense *bool) {
    *localSense = !*localSense
    b.mu.Lock()
    b.count++
    if b.count == b.n {
        b.count = 0
        b.globalSense = *localSense
        b.cond.Broadcast()
        b.mu.Unlock()
        return
    }
    for b.globalSense != *localSense {
        b.cond.Wait()
    }
    b.mu.Unlock()
}
```

The sense flag plays the same role as the generation counter — it disambiguates "this trip" from "the next trip" so a fast looper cannot satisfy an old trip's predicate — but with a single bit instead of a monotonically growing integer (no overflow concern, ever). The trade-off is the caller must thread a per-goroutine `localSense`, which is slightly awkward in Go.

---

## Dynamic Party Counts

A fixed N is a strong assumption. Real systems sometimes need parties to *join* or *leave* between phases (a worker crashes; the pool autoscales). Options:

- **Re-create the barrier each phase** sized to the live party count. Cleanest; pairs naturally with the errgroup-per-phase idiom.
- **Track an atomic `parties` count** that may only change *between* trips (never mid-trip), and have the last arriver read it. Fragile; the "between trips" invariant is hard to enforce.
- **Treat departure as an Abort** that breaks the current generation; survivors re-form a new barrier of the new size. This is how robust HPC runtimes handle node loss.

Mid-trip membership changes are a research-grade problem; in application code, prefer "the barrier size is fixed for the lifetime of one trip" and rebuild between trips.

---

## Context, Timeouts, and Recovery

Production rules:

- **Every barrier wait must be cancellable.** A `Cond` cannot `select`, so use `context.AfterFunc` to break the barrier on cancel (middle.md `Safe`), or use a channel-based barrier and `select` on `ctx.Done()`.
- **Panics must not strand the cohort.** Wrap each worker's per-phase body in `defer func(){ if recover() != nil { barrier.Abort() } }()` so a panicking party releases the others with an error rather than deadlocking them.
- **Add a watchdog.** A barrier that has not tripped within a deadline is almost always a stuck party. Log which party indices have *not* arrived (instrument the barrier to record arrived IDs) — this turns "service frozen" into "worker 7 hung in `decodeImage`."

```go
func phaseBody(ctx context.Context, b *barrier.Safe, id int, fn func() error) (err error) {
    defer func() {
        if r := recover(); r != nil {
            b.Abort() // never leave peers waiting
            err = fmt.Errorf("party %d panicked: %v", id, r)
        }
    }()
    if err := fn(); err != nil {
        b.Abort()
        return err
    }
    return b.Wait(ctx)
}
```

---

## Where Barriers Fail

- **Straggler domination.** The barrier runs at the speed of the slowest party *every phase*. With heterogeneous work or noisy neighbours, throughput collapses. Mitigate by balancing work per party or by using work-stealing *within* a phase (then barrier).
- **Deadlock on early exit.** Any code path that returns before `Wait()` strands the rest. This is the number-one production incident with barriers.
- **N mismatch.** Spawn N-1 workers but build a barrier of N → permanent hang. Build a barrier of N but have a worker `Wait()` twice in a phase → corrupts the count.
- **Hidden serialisation.** A barrier turns parallel work into a sequence of synchronised phases; if phases are short, you have effectively serialised the program with extra overhead. Profile to confirm phases are coarse enough.
- **Coupling to a fixed topology.** Tree/dissemination barriers bake N into their structure; resizing means rebuilding.
- **Reentrancy.** Calling `Wait()` from inside a phase action, or from a callback the barrier triggers, deadlocks under the lock.

---

## Production Checklist

- [ ] Did you genuinely need a long-lived barrier, or would errgroup-per-phase be simpler?
- [ ] Is N fixed for the lifetime of each trip, and does it match the number of goroutines that call `Wait()`?
- [ ] Does every worker path reach the barrier exactly once per phase (no early `return`)?
- [ ] Is the wait cancellable via context?
- [ ] Does a panic in one party `Abort()` the rest?
- [ ] Is there a watchdog/timeout that names the non-arrived parties?
- [ ] For N ≳ 16, did you measure whether the centralised lock is a bottleneck before adding a tree/dissemination barrier?
- [ ] Does the simulation use *two* barriers per tick where a buffer swap is involved?
- [ ] Tested with `-race` and `GOMAXPROCS > 1`?

---

## Cheat Sheet

| Situation | Choice |
|-----------|--------|
| Stateless phased work | errgroup-per-phase (re-spawn) — *not* a barrier |
| Long-lived workers, expensive state, small N | centralised `Cond` cyclic barrier |
| Large N, perf-critical | dissemination / tree barrier |
| Avoid generation overflow / per-trip alloc | sense-reversing barrier |
| Must cancel/fail | `Safe` barrier (`context.AfterFunc` + `Abort`) |
| Buffer-swap simulation | two barriers per tick |

```go
// Visibility chain (why a barrier is safe):
// writes(g) -> unlock -> [Nth: lock, broadcast, unlock] -> relock-on-wake -> reads(g)
```

---

## Summary

The senior view of barriers is mostly about *not* using one: the idiomatic Go answer to phased work is re-spawning goroutines and joining with `WaitGroup`/`errgroup`, which hands you cancellation and error propagation for free. A genuine barrier earns its place only when long-lived workers must keep expensive state across many phases. When you do use one, the centralised `Cond` design is fine to ~16 parties; beyond that, log-depth tree or dissemination barriers cut the thundering-herd contention, and the sense-reversing variant sidesteps generation-counter overflow. Whatever the form, the barrier must establish a per-generation happens-before edge (the memory-model contract that makes lockstep data safe), must be cancellable, and must convert a panicking or dying party into an `Abort` rather than a cohort-wide deadlock.
