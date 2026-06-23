# Starvation — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [`sync.Mutex` Starvation Mode: Source-Level Walkthrough](#syncmutex-starvation-mode-source-level-walkthrough)
3. [`sync.RWMutex` Writer Pending: The Sign-Bit Trick](#syncrwmutex-writer-pending-the-sign-bit-trick)
4. [Async Preemption in Go 1.14+](#async-preemption-in-go-114)
5. [Comparison with the Linux CFS Scheduler](#comparison-with-the-linux-cfs-scheduler)
6. [Summary](#summary)

---

## Introduction

This file opens the runtime sources. We will trace what the CPU does when:

- A `sync.Mutex.Lock` enters the slow path, parks, wakes, and decides to flip the mutex into starvation mode.
- A `sync.RWMutex.Lock` rotates the sign of `readerCount` to exclude new readers.
- A goroutine running a tight loop is hit by `SIGURG` and rescheduled.

We then compare Go's fairness design with Linux's CFS scheduler so you can speak about Go fairness in the broader systems context.

References used throughout:

- `src/sync/mutex.go` (Go 1.21 sources, structurally unchanged since 1.9).
- `src/sync/rwmutex.go`.
- `src/runtime/sema.go` — the semaphore primitives mutexes park on.
- `src/runtime/proc.go` and `src/runtime/preempt.go` — scheduler and preemption.
- `src/runtime/signal_unix.go` — async preemption signal handling.

---

## `sync.Mutex` Starvation Mode: Source-Level Walkthrough

### State word recap

```go
const (
    mutexLocked      = 1 << iota // 1
    mutexWoken                   // 2
    mutexStarving                // 4
    mutexWaiterShift = iota      // 3

    starvationThresholdNs = 1e6 // 1 ms
)
```

The `state` field is a packed `int32`:

```
 31                                              3 2 1 0
+--------------------------------------------------+-+-+-+
| waiter count (29 bits)                           |S|W|L|
+--------------------------------------------------+-+-+-+
```

### `Lock` slow path

```go
func (m *Mutex) lockSlow() {
    var waitStartTime int64
    starving := false
    awoke := false
    iter := 0
    old := m.state
    for {
        // Don't spin in starvation mode; ownership is handed off to waiters
        // so we wouldn't be able to acquire the mutex anyway.
        if old&(mutexLocked|mutexStarving) == mutexLocked && runtime_canSpin(iter) {
            // Active spinning makes sense.
            // Try to set mutexWoken flag to inform Unlock not to wake other blocked goroutines.
            if !awoke && old&mutexWoken == 0 && old>>mutexWaiterShift != 0 &&
                atomic.CompareAndSwapInt32(&m.state, old, old|mutexWoken) {
                awoke = true
            }
            runtime_doSpin()
            iter++
            old = m.state
            continue
        }
        new := old
        // Don't try to acquire starving mutex; new arriving goroutines must queue.
        if old&mutexStarving == 0 {
            new |= mutexLocked
        }
        if old&(mutexLocked|mutexStarving) != 0 {
            new += 1 << mutexWaiterShift
        }
        // The current goroutine switches mutex to starvation mode.
        // But if the mutex is currently unlocked, don't do the switch.
        // Unlock expects that starving mutex has waiters, which will not be true.
        if starving && old&mutexLocked != 0 {
            new |= mutexStarving
        }
        if awoke {
            if new&mutexWoken == 0 {
                throw("sync: inconsistent mutex state")
            }
            new &^= mutexWoken
        }
        if atomic.CompareAndSwapInt32(&m.state, old, new) {
            if old&(mutexLocked|mutexStarving) == 0 {
                break // locked the mutex with CAS
            }
            // If we were already waiting before, queue at the front of the queue.
            queueLifo := waitStartTime != 0
            if waitStartTime == 0 {
                waitStartTime = runtime_nanotime()
            }
            runtime_SemacquireMutex(&m.sema, queueLifo, 1)
            starving = starving || runtime_nanotime()-waitStartTime > starvationThresholdNs
            old = m.state
            if old&mutexStarving != 0 {
                // If this goroutine was woken and mutex is in starvation mode,
                // ownership was handed off to us but mutex is in somewhat inconsistent state:
                // mutexLocked is not set and we are still accounted as waiter. Fix that.
                if old&(mutexLocked|mutexWoken) != 0 || old>>mutexWaiterShift == 0 {
                    throw("sync: inconsistent mutex state")
                }
                delta := int32(mutexLocked - 1<<mutexWaiterShift)
                if !starving || old>>mutexWaiterShift == 1 {
                    // Exit starvation mode.
                    delta -= mutexStarving
                }
                atomic.AddInt32(&m.state, delta)
                break
            }
            awoke = true
            iter = 0
        } else {
            old = m.state
        }
    }
}
```

### Step-by-step

1. **Spin (line `runtime_canSpin`).** Active spinning is allowed only if not in starvation mode, GOMAXPROCS>1, and there is at least one running P with empty queue. Spinning sets `mutexWoken` so `Unlock` does not wake another waiter unnecessarily.
2. **CAS attempt.** Build `new` state: add the locked bit (if not in starvation mode), increment waiter count, set starving if this iteration is past the threshold.
3. **Park.** `runtime_SemacquireMutex` parks the goroutine on `m.sema`. The `queueLifo` flag is set the second and subsequent times the goroutine wakes, meaning if a goroutine was already waiting before, it joins the front of the queue.
4. **Wake.** When the goroutine resumes, check elapsed time. If > 1 ms, mark `starving = true`.
5. **Starvation hand-off.** If the woken goroutine sees `mutexStarving` set, the lock has been handed to it directly. Compute the state delta: add `mutexLocked`, subtract one waiter. Possibly clear `mutexStarving` if this was the last waiter or its own wait was short.

### Step-by-step: `Unlock` in starvation mode

```go
func (m *Mutex) unlockSlow(new int32) {
    if (new+mutexLocked)&mutexLocked == 0 {
        throw("sync: unlock of unlocked mutex")
    }
    if new&mutexStarving == 0 {
        old := new
        for {
            if old>>mutexWaiterShift == 0 || old&(mutexLocked|mutexWoken|mutexStarving) != 0 {
                return
            }
            new = (old - 1<<mutexWaiterShift) | mutexWoken
            if atomic.CompareAndSwapInt32(&m.state, old, new) {
                runtime_Semrelease(&m.sema, false, 1)
                return
            }
            old = m.state
        }
    } else {
        // Starving mode: handoff mutex ownership to the next waiter,
        // and yield our time slice so that the next waiter can start to run immediately.
        runtime_Semrelease(&m.sema, true, 1)
    }
}
```

In starvation mode the `Unlock` path is dramatically simpler: just call `runtime_Semrelease(&m.sema, true, 1)`. The `true` is the `handoff` flag — it tells the semaphore implementation to *directly* transfer ownership to the parked waiter rather than racing.

### Why direct hand-off matters

Without hand-off, `Unlock` simply sets the locked bit to 0 and signals one waiter. Both the waker and any concurrent arriver race for the freed lock. The arriver typically wins (already on CPU). The waiter must sleep again.

With hand-off, `Semrelease(true)` transfers ownership *before* the waiter actually wakes. By the time the waiter checks the state, it already owns the lock; no race. Any concurrent arriver sees `mutexStarving` set, does not enter the CAS fast path, and queues.

### Cost summary

- **Normal mode.** Fast path is one CAS. Slow path has spinning (cheap), then park, then CAS race on wake.
- **Starvation mode.** Every acquire goes to the slow path. Spinning is disabled. Park-and-handoff happens for every acquire, even uncontended ones, until the last waiter clears the bit.

The mutex auto-flips between modes. Most production workloads spend most time in normal mode.

---

## `sync.RWMutex` Writer Pending: The Sign-Bit Trick

### Code skeleton

```go
const rwmutexMaxReaders = 1 << 30

type RWMutex struct {
    w           Mutex
    writerSem   uint32
    readerSem   uint32
    readerCount atomic.Int32
    readerWait  atomic.Int32
}

func (rw *RWMutex) RLock() {
    if rw.readerCount.Add(1) < 0 {
        runtime_SemacquireRWMutexR(&rw.readerSem, false, 0)
    }
}

func (rw *RWMutex) RUnlock() {
    if r := rw.readerCount.Add(-1); r < 0 {
        rw.rUnlockSlow(r)
    }
}

func (rw *RWMutex) rUnlockSlow(r int32) {
    if r+1 == 0 || r+1 == -rwmutexMaxReaders {
        throw("sync: RUnlock of unlocked RWMutex")
    }
    if rw.readerWait.Add(-1) == 0 {
        runtime_Semrelease(&rw.writerSem, false, 1)
    }
}

func (rw *RWMutex) Lock() {
    // First, resolve competition with other writers.
    rw.w.Lock()
    // Announce to readers there is a pending writer.
    r := rw.readerCount.Add(-rwmutexMaxReaders) + rwmutexMaxReaders
    // Wait for active readers.
    if r != 0 && rw.readerWait.Add(r) != 0 {
        runtime_SemacquireRWMutex(&rw.writerSem, false, 0)
    }
}

func (rw *RWMutex) Unlock() {
    r := rw.readerCount.Add(rwmutexMaxReaders)
    if r >= rwmutexMaxReaders {
        throw("sync: Unlock of unlocked RWMutex")
    }
    // Unblock blocked readers, if any.
    for i := 0; i < int(r); i++ {
        runtime_Semrelease(&rw.readerSem, false, 0)
    }
    rw.w.Unlock()
}
```

### The sign-bit trick explained

`readerCount` is an `atomic.Int32`. In normal operation it counts active readers (positive). When a writer arrives:

1. `Add(-rwmutexMaxReaders)` subtracts ~1 billion. If `n` readers were active, the new value is `n - 1<<30`, which is negative.
2. The previous value of `readerCount` (before the subtract) gives the number of readers the writer must wait for. `readerWait` is initialised to that count.
3. New `RLock` calls do `Add(1)`. They see the result is still negative, so they park on `readerSem`.
4. Each existing `RUnlock` does `Add(-1)`. The result remains negative. The slow path decrements `readerWait`; the last one signals the writer.

So the same atomic field encodes both "active reader count" (when positive) and "writer pending; active readers must drain" (when negative). The trick is robust because `rwmutexMaxReaders` (2^30) is larger than any realistic reader count and smaller than `int32` max (so it does not overflow).

### Writer's `Unlock`

When the writer releases:

1. `Add(rwmutexMaxReaders)` undoes the negation, making the count positive again.
2. The returned value is `r`, the number of readers that were parked while the writer held the lock.
3. For each, call `Semrelease(&readerSem)` to wake one. Each woken reader retries `RLock`'s fast path; `readerCount` is now positive so they proceed.
4. Release `w`, the inner writer-vs-writer lock.

### Why writers can still starve

Two failure modes:

**1. Existing readers don't release.** If a reader holds `RLock` for a long time, the writer waits for `readerWait` to reach zero, which depends on the slowest reader. No mechanism inside the runtime can shorten that.

**2. The writer's `w.Lock()` itself can starve.** Multiple writers compete for the inner `w Mutex`. The starvation-mode trick of `sync.Mutex` still applies, so one writer cannot wait more than ~1 ms beyond contention level. But across many writers, the cumulative wait for any single one can grow.

### Why readers don't starve under writer pressure

Each writer's `Unlock` wakes *all* parked readers via the broadcast in the loop. New readers admitted before the next writer arrives proceed normally. So readers are scheduled in batches between writers. A reader can wait at most one writer's critical section.

### Practical implication

If your writer must complete in <1 ms but your readers can run for 10 ms each, no concurrency primitive in Go will fix it. You must either:

- Shorten read critical sections (snapshot pattern).
- Replicate state so writers do not collide with readers (CoW, RCU-style).
- Use a different lock type (a fair FIFO lock with read/write distinctions, hand-built).

---

## Async Preemption in Go 1.14+

### The problem before 1.14

The Go scheduler used *cooperative preemption*: a goroutine could only be preempted at a function-call boundary (where the runtime inserts a check) or at a channel/select/lock operation. A pure-CPU goroutine without function calls — or with only inlined ones — never reached a check.

Examples that *would not* be preempted pre-1.14:

```go
go func() {
    for i := uint64(0); ; i++ {
        _ = i * i
    }
}()
```

```go
go func() {
    for {
        select {
        default:
        }
    }
}()
```

(The second one *does* enter the runtime via `select`, but the runtime check is per-tick, not per-iteration.)

### The implementation in 1.14

The scheduler maintains a per-G `preempt` flag. When the scheduler decides to preempt a goroutine (because it has run too long, or to balance work), it:

1. Sets the `preempt` flag on the G.
2. Sends a `SIGURG` signal to the M running the G via `pthread_kill` (or `tgkill` on Linux).
3. The signal handler interrupts the G mid-instruction.
4. The handler inspects the G's PC and registers. If it is at a *safe point* (no pointers in registers without GC info), it switches the G's PC to a runtime function that performs preemption.
5. Otherwise, the handler returns and the G continues; the scheduler retries later.

This logic lives in `src/runtime/preempt.go` and `src/runtime/signal_unix.go`.

### Safe points

A safe point is a PC where:

- All live values are in stack slots with known types (so the GC can scan them).
- No critical hardware state is mid-update.

The Go compiler emits enough metadata that the runtime can identify safe points in any function. The 1.14 work extended the metadata to cover assembly stubs and loops that previously had no safe points.

### Effects

- Pre-1.14: GOMAXPROCS=1 + tight loop = whole program hangs.
- 1.14+: same scenario yields within 10 ms; other goroutines get CPU; the program progresses.

The improvement is dramatic for fairness. It eliminates an entire class of starvation bugs that had to be worked around with `runtime.Gosched()` calls scattered through CPU-heavy code.

### Caveats

- **Cgo and assembly.** Goroutines inside cgo calls or pure-assembly functions without safe points are not preemptible. These finish first. Rare in pure Go code.
- **Signal interference.** Programs that use `SIGURG` for their own purposes can conflict. The runtime owns this signal in modern Go; programs should pick another.
- **Slice/map operations.** A `for k := range m {}` loop *is* preemptible; the iterator inserts safe points.
- **Latency floor.** The preempt slice is 10 ms. A goroutine cannot block another for less than that without yielding voluntarily. Most workloads do not notice; latency-critical ones might.

### Diagnosing preemption issues

Set `GODEBUG=schedtrace=1000` to print scheduler state every second. Look for goroutines stuck in `runnable` state on a P for many ticks. Set `GODEBUG=asyncpreemptoff=1` to disable async preemption temporarily and confirm a regression.

`runtime.SetCPUProfileRate(100)` and `pprof` will show CPU time per goroutine. A goroutine with high CPU and no neighbours getting time is the culprit.

---

## Comparison with the Linux CFS Scheduler

### CFS in one paragraph

The Completely Fair Scheduler (CFS), introduced in Linux 2.6.23, maintains a *virtual runtime* (`vruntime`) for every runnable task. Tasks are ordered in a red-black tree keyed by `vruntime`. The next task to run is the leftmost (smallest `vruntime`). When a task runs, its `vruntime` increases proportionally to wall time, with priority weighting. Lower-priority tasks accumulate `vruntime` faster, so they reach a given threshold sooner and yield to higher-priority tasks. Conceptually, every task is racing toward infinity, and the scheduler always picks the one with the lowest current position.

The result: every task gets a share of CPU proportional to its weight, with no task strictly starving (a starving task's `vruntime` stops growing, so it eventually reaches the front of the tree).

### Go's scheduler in one paragraph

The Go scheduler is a *work-stealing* GMP scheduler. Each P has a local run queue (LRQ). Ms execute goroutines from the LRQ. When an LRQ is empty, the M steals half of another P's LRQ. There is a global run queue (GRQ) for overflow and for newly created Gs that cannot be placed locally. There is no `vruntime`; selection is roughly FIFO within a queue, with the steal-and-balance mechanism providing system-wide fairness. Since 1.14, async preemption forces long-running goroutines to yield every 10 ms.

### Comparison points

| Aspect | Linux CFS | Go Scheduler |
|--------|-----------|--------------|
| Fairness primitive | `vruntime` ordering | Work-stealing across LRQs |
| Preemption | Tick-based (1 ms typical) | 10 ms async preempt (1.14+) |
| Priority | Nice values, RT classes | None at runtime level |
| Per-task overhead | RB tree node + state | Lightweight G struct |
| Number of tasks | Thousands typical | Millions feasible |
| Latency target | ~1 ms slice | ~10 ms slice |
| Cross-CPU balancing | Periodic load balancer | Steal on idle |

### Lessons Go could borrow (and largely has not)

- **Priority.** Linux gives every task a priority via the nice value. Go has none. Engineers must build application-level priority (queues, dispatchers) on top. This is intentional in Go's design philosophy ("goroutines are cheap and equal") but means production systems often reinvent priority queues.
- **`vruntime` accounting.** The notion that every waiter accumulates "credit" while it waits is powerful. Go's mutex starvation mode uses a simpler "did this waiter wait more than 1 ms?" rule. A `vruntime`-like mechanism would give finer fairness but cost more.
- **Periodic balancing.** Linux runs a load balancer every few ms. Go's stealer fires only on idle. Under heavy load with sustained imbalance, stealing kicks in; under bursty load it may not.

### Lessons CFS could not borrow

- **Cheap concurrency.** A million CFS tasks would melt any Linux box. Go's runtime keeps goroutine state tiny and avoids expensive bookkeeping. Trade-off: less precise fairness.
- **In-process execution.** All goroutines share an address space. The runtime can move them between Ms without TLB flushes. Linux can't move processes that way.

### Why this matters for starvation

Go's choice of work-stealing + async preempt is good enough for most workloads. The trade-off is that *fine-grained fairness* — millisecond-level shares between many classes of work — must be built at application level. Production Go systems that need that level of control end up building queue dispatchers, custom locks, and explicit priority schemes on top of the runtime.

If you have ever wondered "why does Linux give me cgroup CPU shares but Go does not", the answer is: Go's runtime is intentionally simpler. The fairness you build yourself is application-aware in ways the kernel can never be.

---

## Summary

At the professional level you have read the runtime sources for `sync.Mutex` starvation mode and `sync.RWMutex` writer hand-off. You understand the sign-bit trick that encodes "writer pending" in `readerCount`. You know how Go 1.14's async preemption uses `SIGURG` to interrupt long-running goroutines at safe points. And you can place Go's fairness model in context against Linux CFS.

The professional concern: every fairness mechanism has a cost. Go's mutex pays a throughput dip in starvation mode for a latency cap. `RWMutex`'s reader-bias pays writer wait time for read throughput. Async preemption pays a small signal overhead for scheduler responsiveness. Knowing the costs lets you choose primitives intelligently, build custom ones when needed, and explain to your team why the trade-offs are right.

Continue to [specification.md](specification.md) for a formal recap of guarantees, [interview.md](interview.md) for senior interview prep, or the exercise files for hands-on practice.
