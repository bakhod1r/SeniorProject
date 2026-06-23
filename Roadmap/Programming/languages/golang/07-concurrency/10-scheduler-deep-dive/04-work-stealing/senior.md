# Work Stealing — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Random Victim Selection](#random-victim-selection)
3. [Comparison with Classic Cilk](#comparison-with-classic-cilk)
4. [Comparison with Tokio and Rust Schedulers](#comparison-with-tokio-and-rust-schedulers)
5. [The Steal/Spin Interaction with Timers](#the-stealspin-interaction-with-timers)
6. [`runnext` Stealing Policy](#runnext-stealing-policy)
7. [LRQ Overflow and the GRQ Path](#lrq-overflow-and-the-grq-path)
8. [Sysmon Forces Hand-Off](#sysmon-forces-hand-off)
9. [Reading Scheduler Trace Events](#reading-scheduler-trace-events)
10. [Pathological Cases](#pathological-cases)
11. [Summary](#summary)

---

## Introduction

The senior level focuses on theory, comparisons, and edge cases. We look at *why* random victim selection works (with reference to the Cilk paper), how Tokio adapted the design, what happens around timers, and the corner cases where work stealing can degrade. By the end you should be able to reason about a scheduler trace and predict where stealing would or would not help.

This page assumes you have read middle.md and understand `findRunnable`, `runqsteal`, spinning Ms, and `wakep`.

---

## Random Victim Selection

The thief picks a random starting P, then walks all Ps in order (modulo `GOMAXPROCS`). This is not pure random per attempt — it is "random start, deterministic walk." Why?

### Pure random would waste

If the thief picked a random victim each iteration, two thieves stealing simultaneously could both miss the only busy P repeatedly. With deterministic walk after random start, each thief is guaranteed to *visit* every other P within one round.

### The fast `cheaprand` PRNG

The runtime uses `cheaprand()` (in `runtime/rand.go`), a fast xorshift PRNG. It does not need cryptographic quality — it just needs to avoid hotspots. Cost: ~2 ns per call.

```go
// runtime/proc.go (paraphrased)
func stealWork(now int64) (*g, ...) {
    pp := getg().m.p.ptr()
    var stealTimers bool
    var newWork bool

    for i := 0; i < 4; i++ {
        // Random starting offset
        for enum := stealOrder.start(cheaprand()); !enum.done(); enum.next() {
            pp2 := allp[enum.position()]
            if pp == pp2 {
                continue
            }
            // ... try steal ...
        }
    }
    return nil, ...
}
```

`stealOrder` is a structure that, given a random seed, produces a permutation of [0, gomaxprocs). The walk is coprime-stride: pick a stride coprime with gomaxprocs and step by it. This is faster than computing a full random permutation per attempt.

### Why not deterministic for everyone?

If every thief used the same starting P, P0 would always be hit first. P0's `runqhead` atomic would contend; cache lines would bounce. Random start spreads the contention.

### Empirical result

In benchmarks, random victim selection produces a near-uniform distribution of attempts across victims. No P gets hammered. Empty Ps cost ~3 ns to peek (just a load). Busy Ps cost ~25 ns to steal from. The walk terminates as soon as one steal succeeds.

---

## Comparison with Classic Cilk

The Cilk paper (Blumofe & Leiserson 1999) proves work stealing's optimality. Cilk's algorithm:

1. Each worker has a double-ended queue (deque) of tasks.
2. The owner pushes and pops from the *bottom*.
3. Thieves pull from the *top*.
4. When a worker's deque is empty, pick a random victim and steal from the top.

Go's design follows this closely, with two differences:

### Difference 1: Bounded LRQ

Cilk's deque is unbounded. Go's LRQ is fixed at 256. When the LRQ fills, Go overflows half to the GRQ. Cilk has no GRQ — the deque always grows.

Why bounded? Cache locality. A 256-slot array stays warm; an unbounded deque would require allocation and could blow out L1.

### Difference 2: Global runqueue

Cilk has only per-worker deques. Go has both per-P LRQs *and* the GRQ. The GRQ exists to:
- Absorb LRQ overflow.
- Handle timer-fired Gs (no P context).
- Handle cgo-callback Gs.

The GRQ is *not* the primary path — LRQs are. The GRQ is a safety valve.

### What Cilk's proof shows

For a computation with total work T_1 (on one CPU) and critical path T_∞ (longest dependency chain), Cilk's work stealing achieves:

```
T_P ≤ T_1/P + O(T_∞)
```

That is, near-perfect speedup on parallel work, plus a small overhead proportional to the critical path. For Go's typical workload (many short Gs with shallow dependencies), this is excellent.

The proof requires:
- Half-steal (or any constant fraction).
- Random victim selection.
- Deque (FIFO from owner's side, LIFO from thief's side — though Go uses FIFO from both sides; see below).

### Why Go uses FIFO-FIFO instead of FIFO-LIFO

Cilk uses LIFO from the owner's side (push and pop the most recently created task — depth-first execution). Thieves take from the bottom (oldest task — breadth-first). The combination gives good cache locality (owner runs recent work) plus efficient stealing (thieves take work that has been "cold" longest).

Go uses FIFO from both sides. The owner pushes and pops from the tail; thieves pull from the head. This was a deliberate design choice to make goroutine ordering more predictable (you tend to run goroutines in roughly the order they were created). It costs some cache locality but matches user intuition.

The `runnext` slot provides a partial LIFO override: a recently created G goes into `runnext` and runs next, restoring some locality.

### Cilk-5 vs Cilk++

Cilk-5 used "the THE protocol" for the deque (a clever single-CAS algorithm). Cilk++ (Intel's commercial version) added Hyperobjects and reducer support. Go's `runqsteal` is conceptually closer to Cilk-5's protocol — atomic head, locked-free push by owner.

---

## Comparison with Tokio and Rust Schedulers

Tokio (Rust async runtime) explicitly modelled its scheduler on Go's. Differences:

### Tokio: cooperative LRQ

Tokio's worker has a local queue of fixed size (256 in current versions). Tokio is "fair within local queue" — every N polls, the worker checks the global injection queue. This is similar to Go's 1-in-61 rule but Tokio uses every 31 polls.

### Tokio: explicit yield

Tokio tasks must `.await` to yield. There is no async preemption (until very recent unstable work). Go's async preemption (Go 1.14+) is more aggressive.

### Tokio: I/O reactor per worker

Tokio runs the I/O event loop *per worker thread*. Go's netpoller is shared (one `epoll` instance). Tokio's design has slightly better locality at the cost of more wakeups; Go's design has lower thread count at the cost of more cross-thread wakeups.

### Tokio: LIFO slot

Tokio has an "LIFO slot" similar to Go's `runnext`. A newly-spawned task goes there. Steal does not touch the LIFO slot unless the worker has not used it for a tick.

### What Go does better

- Async preemption: a long-running CPU loop cannot starve other goroutines.
- Cgo handling: a syscall'd M detaches its P automatically.
- Sysmon: a permanent background monitor ensures progress.

### What Tokio does better

- Per-worker I/O reactor avoids the central netpoller bottleneck under heavy I/O load.
- Explicit `.await` makes preemption points predictable (helps with profiling).

### Lessons

Both schedulers converged on similar designs (LRQ, GRQ, work stealing, LIFO slot) independently — strong evidence that the design is near-optimal for M:N user-space scheduling on commodity hardware.

---

## The Steal/Spin Interaction with Timers

Go's timer wheel was rewritten in Go 1.14 to per-P timer heaps. Each P has its own timer heap; expired timers fire on that P.

### Stealable timers

In Go 1.14+, the runtime *also* steals timers. When a thief looks at a victim P, it checks both:
- `victim.runqhead != victim.runqtail` (runnable Gs)
- The victim's timer heap for expired timers (after the steal)

If timers have expired but the victim is busy, the thief can fire them. This prevents timer-driven goroutines from being starved when their P is busy.

### Timer heap stealing protocol

From `runtime/proc.go`:

```go
// Inside stealWork
if shouldStealTimers(pp2) {
    tnow, w, ran := checkTimers(pp2, now)
    now = tnow
    if w != 0 && (pollUntil == 0 || w < pollUntil) {
        pollUntil = w
    }
    if ran {
        // Need to recheck local runqueue:
        // checkTimers may have run a timer that
        // pushed a G to our LRQ.
        if gp, inheritTime := runqget(pp); gp != nil {
            return gp, inheritTime, ...
        }
    }
}
```

The thief runs the victim's expired timers. Some timer callbacks push Gs to the *thief's* LRQ (via `goready`). The thief then re-checks its own LRQ.

### Timer-fired goroutines

`time.AfterFunc(d, f)` schedules `f` to run after `d`. When the timer fires, `f` becomes a goroutine that is pushed to the firing P's LRQ (or GRQ if no P is bound). Stealing then redistributes.

Note: `time.AfterFunc` callbacks run as goroutines, not inline in the timer thread. The timer thread (or whichever M fires the timer) creates a goroutine and pushes it for normal scheduling.

---

## `runnext` Stealing Policy

The `runnext` slot stores the "next G to run on this P." It is privileged: it runs *before* the LRQ tail. This gives cache locality for parent-child goroutine pairs.

### Default: do not steal `runnext`

Thieves looking at a victim's LRQ skip `runnext`. This preserves the privilege.

### Exception: `stealRunNextG`

After a thief has visited a victim several times and found nothing, on the last attempt it may steal `runnext`. This is rare and exists to prevent a pathological case: one P spawning many short Gs that always go to `runnext`, never to the LRQ tail. Thieves see an empty LRQ tail and would forever miss the work.

```go
// runtime/proc.go: stealWork
for i := 0; i < 4; i++ {
    stealTimersOrRunNextG := (i == 3) // last round
    // ... use stealTimersOrRunNextG in runqsteal ...
}
```

The fourth and final round of stealing also steals from `runnext`. The first three rounds leave it alone.

### The `runnext` race

If the owner is about to consume `runnext` and a thief is reading it, there is a tiny race. The runtime uses `atomic.Casuintptr` on `runnext` to resolve: only one of the two can succeed in claiming the slot.

The owner's path: `gp := pp.runnext.ptr(); pp.runnext = 0` — but with CAS:

```go
for {
    next := pp.runnext
    if next == 0 { break }
    if pp.runnext.cas(next, 0) {
        // got it
        break
    }
}
```

Cost: a few atomic ops in the worst case. Almost always uncontended.

---

## LRQ Overflow and the GRQ Path

When `runqput` finds the LRQ full (256 entries), it overflows. From `runtime/proc.go`:

```go
func runqput(pp *p, gp *g, next bool) {
    if next {
        // put on runnext slot
        // ...
    }

retry:
    h := atomic.LoadAcq(&pp.runqhead)
    t := pp.runqtail
    if t-h < uint32(len(pp.runq)) {
        pp.runq[t%uint32(len(pp.runq))].set(gp)
        atomic.StoreRel(&pp.runqtail, t+1)
        return
    }
    if runqputslow(pp, gp, h, t) {
        return
    }
    goto retry
}

func runqputslow(pp *p, gp *g, h, t uint32) bool {
    var batch [len(pp.runq)/2 + 1]*g

    // First, grab a batch from pp.runq.
    n := t - h
    n = n / 2
    if n != uint32(len(pp.runq)/2) {
        throw("runqputslow: queue is not full")
    }
    for i := uint32(0); i < n; i++ {
        batch[i] = pp.runq[(h+i)%uint32(len(pp.runq))].ptr()
    }
    if !atomic.CasRel(&pp.runqhead, h, h+n) {
        return false
    }
    batch[n] = gp

    // Link the goroutines.
    for i := uint32(0); i < n; i++ {
        batch[i].schedlink.set(batch[i+1])
    }
    var q gQueue
    q.head.set(batch[0])
    q.tail.set(batch[n])

    // Now put the batch on global queue.
    lock(&sched.lock)
    globrunqputbatch(&q, int32(n+1))
    unlock(&sched.lock)
    return true
}
```

What happens:

1. The LRQ is full. `runqputslow` grabs the first half (128 Gs) from the LRQ via CAS on `runqhead`.
2. The new G is appended to the batch.
3. The batch (129 Gs) is pushed onto the GRQ under `sched.lock`.

Cost of overflow: one CAS plus one `sched.lock` acquisition. Slow compared to LRQ push (which is lock-free).

### When does overflow happen in practice?

Rare. The LRQ fills to 256 only when:
- A P has 256 runnable Gs simultaneously.
- Production rate >> consumption rate.

Most workloads consume Gs as fast as they produce. Overflow is a signal of a producer-consumer imbalance.

### Overflow cascade

If overflow puts work on the GRQ, the next call to `runqput` from the same P will likely succeed (LRQ now has 128 slots free). But the GRQ is now populated, and other Ps will pull from it via `globrunqget` or the 1-in-61 rule. The work spreads.

---

## Sysmon Forces Hand-Off

Sysmon is a special goroutine that runs without a P. It runs periodically (every 20 μs to 10 ms depending on system load). Sysmon's role in work stealing:

### Force preemption

If a G has been running for > 10 ms without yielding, sysmon sends `SIGURG` to the M to force a preemption. The preempted G goes back to the LRQ tail; another G (possibly stolen from this P) can now run.

Without sysmon-driven preemption, a CPU-bound G could starve every other G on the same M for arbitrarily long. Stealing alone does not solve this — stealing redistributes *runnable* Gs, not *running* Gs.

### Wake idle Ms

If sysmon notices that `sched.runqsize > 0` (GRQ has work) but no spinner is alive, it calls `wakep`. This is a backstop in case `wakep` was skipped earlier.

### Detect long syscalls

Sysmon detects Ps in `_Psyscall` state for > 10 μs and `handoffp`s them — the P is given to a fresh M (potentially a spinner). This makes Gs on the syscalling P available for stealing again.

### Frequency

Sysmon's sleep duration adapts: 20 μs when busy, doubling up to 10 ms when idle. The cost is one M permanently dedicated, but the benefit (preemption + handoff) is essential.

---

## Reading Scheduler Trace Events

`go tool trace` shows scheduler events. Relevant events:

| Event | Meaning |
|---|---|
| `GoCreate` | A new G was created on this P |
| `GoStart` | A G started running on this M |
| `GoStop` | A G stopped (yielded, blocked, exited) |
| `ProcStart` | A P started running (an M attached) |
| `ProcStop` | A P stopped (M detached) |
| `GoSysCall` | A G entered a syscall |
| `GoSysExit` | A G exited a syscall |
| `GoUnblock` | A parked G was unparked |

To see stealing in action:

1. Run a program with `runtime/trace`.
2. Open the trace in `go tool trace`.
3. Look at the "Procs" view.
4. A G appearing on Pn after being created on Pm (n ≠ m) is a steal.

There is no explicit `Steal` event. You infer it from the cross-P movement.

### Telemetry from `GODEBUG=schedtrace=1000`

```bash
GODEBUG=schedtrace=1000 ./myprogram
```

Output every 1000 ms:

```
SCHED 1000ms: gomaxprocs=8 idleprocs=0 threads=12 spinningthreads=1 ...
```

Fields:
- `idleprocs`: Ps currently idle.
- `spinningthreads`: spinning Ms.
- `threads`: total M count.
- `runqueue`: GRQ size.
- Per-P LRQ sizes follow.

If `spinningthreads` is consistently 0 while `idleprocs > 0`, your program is not creating work fast enough; the spinners parked. If `spinningthreads` is consistently 4+ while `idleprocs > 0`, the spinners are burning CPU finding nothing — possible scheduler bug or pathological producer.

---

## Pathological Cases

### Case 1: producer faster than stealers can spread

A single P pushes 10,000 Gs/s; consumers cannot keep up. LRQ overflows; GRQ accumulates. Cost: `sched.lock` contention. Symptom: pprof shows time in `runtime.lock`.

Mitigation: rate-limit the producer or shard.

### Case 2: every G is short-lived

100,000 Gs/s, each ~1 μs of work. Scheduling overhead dominates. Symptom: high system CPU, low user CPU.

Mitigation: batch the work. Replace 100 Gs each doing 1 μs with 10 Gs each doing 10 μs.

### Case 3: lock-bound Gs

All Gs contend on a single `sync.Mutex`. Stealing redistributes Gs, but they all park immediately on the mutex's wait queue. Stealers find empty LRQs and park. Latency spikes.

Mitigation: shard the mutex.

### Case 4: pinned goroutines

Many Gs use `runtime.LockOSThread`. Each is unstealable; its M sits idle when the G blocks. Stealers cannot help.

Mitigation: use `LockOSThread` only when truly required (cgo, OS-thread state).

### Case 5: thrashing spinners

Two spinning Ms repeatedly attempt to steal from the same P. Each loses a CAS to the other, retries, loses again. Throughput tanks.

Mitigation: rare in practice; the runtime's random victim selection avoids hotspots. If reproducible, it is a runtime bug.

### Case 6: blocked netpoll

If `netpoll` is slow (e.g., a buggy network driver), Gs ready on sockets are not unparked. Stealing finds nothing. The system appears idle but is actually waiting on `epoll_wait`.

Mitigation: investigate kernel; profile with `perf` to confirm time in `epoll_wait`.

---

## Summary

The senior view of work stealing covers theory, comparisons, and edge cases:

- Random victim selection (random start, coprime walk) avoids hotspots without per-attempt random.
- Cilk's theorem gives near-optimal speedup; Go follows the design with bounded LRQs and a GRQ safety valve.
- Tokio's design converged independently on similar patterns.
- Timer stealing in Go 1.14+ prevents timer-driven Gs from being starved.
- `runnext` is privileged; thieves only touch it on the fourth attempt.
- LRQ overflow uses `runqputslow` to push half to the GRQ.
- Sysmon enforces preemption (so stealable Gs become available) and handoffs (so syscalled Ps free up).
- `go tool trace` and `GODEBUG=schedtrace=1000` are the diagnostic tools.
- Pathological cases (producer too fast, locks, pinned Gs) require user-level fixes; the scheduler cannot solve them.

The professional level descends into the runtime source — actual file and function names, line numbers, lock ranks, and what each `throw()` means.
