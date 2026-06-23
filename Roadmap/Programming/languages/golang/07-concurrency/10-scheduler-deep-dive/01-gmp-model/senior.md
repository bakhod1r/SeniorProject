# The G-M-P Model — Senior

[← Back to index](index.md)

## Table of Contents
1. [What This Page Adds Over Middle](#what-this-page-adds-over-middle)
2. [The Full G Status Machine](#the-full-g-status-machine)
3. [The Full M State Machine](#the-full-m-state-machine)
4. [The Full P Status Machine](#the-full-p-status-machine)
5. [`schedule()` Step by Step](#schedule-step-by-step)
6. [`findrunnable` — the Search Order](#findrunnable-the-search-order)
7. [`runqget`, `runqput`, and the Ring Buffer Atomics](#runqget-runqput-and-the-ring-buffer-atomics)
8. [`runnext` Steal Semantics](#runnext-steal-semantics)
9. [The Spinning M Protocol](#the-spinning-m-protocol)
10. [How `gopark` and `goready` Tie G to the Scheduler](#how-gopark-and-goready-tie-g-to-the-scheduler)
11. [Per-P Caches: The Refill Protocol](#per-p-caches-the-refill-protocol)
12. [Lock Ranks Inside the Scheduler](#lock-ranks-inside-the-scheduler)
13. [The Vyukov Proposal — Annotated](#the-vyukov-proposal-annotated)
14. [`procresize` — Changing `GOMAXPROCS`](#procresize-changing-gomaxprocs)
15. [Where Sysmon Fits Without a P](#where-sysmon-fits-without-a-p)
16. [Invariants You Can Assert](#invariants-you-can-assert)
17. [What to Read Next](#what-to-read-next)

---

## What This Page Adds Over Middle

Middle introduced the structs, the runqueues, and the rough scheduler outline. Senior is where you trace the interactions: the precise sequence of state transitions during a wake, the atomic protocol for runqueue access, what work-stealing does to `runnext`, how spinning Ms are bounded, and how `gopark` ties channels and mutexes back into the scheduler. By the end you should be able to predict what the scheduler does in any given scenario without running it.

---

## The Full G Status Machine

Defined in `runtime/runtime2.go`:

```go
const (
    _Gidle          = 0
    _Grunnable      = 1
    _Grunning       = 2
    _Gsyscall       = 3
    _Gwaiting       = 4
    _Gmoribund_unused = 5
    _Gdead          = 6
    _Genqueue_unused = 7
    _Gcopystack     = 8
    _Gpreempted     = 9
    _Gscan          = 0x1000 // OR'd in during stack scan
)
```

The interesting transitions, with the function names that perform them:

| From | To | Function | Trigger |
|---|---|---|---|
| `_Gidle` | `_Grunnable` | `newproc1` | `go f()` |
| `_Grunnable` | `_Grunning` | `execute` | scheduler picks |
| `_Grunning` | `_Gwaiting` | `gopark` | channel/mutex/sleep/IO |
| `_Grunning` | `_Gsyscall` | `reentersyscall` | `Syscall6` etc. |
| `_Grunning` | `_Gpreempted` | `preemptM` callback | async preempt signal |
| `_Gwaiting` | `_Grunnable` | `goready` (then `ready`) | wake |
| `_Gsyscall` | `_Grunnable` | `exitsyscall0` | syscall returns |
| `_Gpreempted` | `_Grunnable` | `goready` from `runtime.preemptone` | resume |
| `_Grunning` | `_Gdead` | `goexit0` | function returns |
| `_Gdead` | `_Grunnable` | `newproc1` (reuse) | recycled by `gFree` cache |
| any | `_Gscan|_Gxxx` | `castogscanstatus` | GC stack scan begins |

The `_Gscan` bit is OR'd into the status during GC stack scanning, so other code that observes a non-zero scan bit knows "this G is being scanned, don't move it." All transitions use `atomic.CompareAndSwap` on the 32-bit `atomicstatus` word.

Two transitions worth special attention:

- **`gopark`**: the canonical "parking" function. It atomically switches G to `_Gwaiting`, places a back-pointer in the primitive's wait queue, then calls `mcall(park_m)` which switches to `g0` and re-enters `schedule()`. The G's CPU registers (PC, SP, BP) are saved in `g.sched` so resumption is just a register restore.
- **`reentersyscall`**: pre-emptively releases the P from the M, marks the G `_Gsyscall`. If the syscall returns fast (under ~10 µs sysmon tick), `exitsyscall` re-grabs the P; if not, sysmon hands the P to a fresh M. Either way the G ends up `_Grunnable` and re-scheduled.

---

## The Full M State Machine

M does not have a numeric "status" word like G. Its state is implicit in field combinations:

| State | `m.curg` | `m.p` | `m.spinning` | `m.blocked` |
|---|---|---|---|---|
| Running user G | non-nil | non-nil | false | false |
| In scheduler code (g0) | nil or back-pointer | non-nil | false | false |
| Spinning for work | nil | non-nil | true | false |
| Parked on `m.park` | nil | nil | false | true |
| In syscall | non-nil (the G in syscall) | nil (released to nextp) | false | false |
| In cgo | non-nil | nil | false | false |
| Dead (rare) | nil | nil | n/a | n/a |

Critical transitions:

- **Running G → scheduler code**: happens when the G calls `gopark`, `Gosched`, or returns. The runtime executes `mcall` which switches to `g0`'s stack and calls the scheduler.
- **Spinning → parked**: when `findrunnable` has searched everywhere and found nothing, it adds the P to `pidle`, decrements `nmspinning`, and parks the M on `m.park`. The note is a futex word.
- **Parked → running**: another M (or sysmon) does `notewakeup(&m.park)`. The M wakes, attaches to `m.nextp`, and enters `schedule()`.

The spinning state has a global cap: `sched.nmspinning <= GOMAXPROCS / 2`. The cap prevents waste — too many Ms looking for nothing burns CPU.

---

## The Full P Status Machine

```go
const (
    _Pidle    = 0  // not bound, in sched.pidle
    _Prunning = 1  // bound to an M running user code or runtime code
    _Psyscall = 2  // its M is in a syscall, P is "borrowed" status
    _Pgcstop  = 3  // halted for STW
    _Pdead    = 4  // GOMAXPROCS was shrunk; P's caches drained
)
```

Transition rules:

- `_Pidle ↔ _Prunning`: under `sched.lock` for `pidle` insertion; lock-free CAS when popping (the standard `pidleget` does a lockless lookahead then takes the lock).
- `_Prunning → _Psyscall`: when its M calls `entersyscall`. The transition is CAS-only; no global lock.
- `_Psyscall → _Prunning`: if `exitsyscall` succeeds in CAS-ing back before sysmon takes the P. If sysmon takes it, the P goes through `_Pidle` and is given to another M.
- `_Prunning → _Pgcstop`: during STW the runtime walks `allp[]` and CAS's each to `_Pgcstop`. Restart reverses.
- `_Prunning → _Pdead`: only via `procresize` when `GOMAXPROCS` shrinks. Caches are drained back to centrals; the P struct is kept (for re-growth) but unused.

The `_Psyscall` state is the linchpin of efficient syscall handling — it lets sysmon notice and reassign without contending with the M that's blocked.

---

## `schedule()` Step by Step

Annotated walkthrough of the production scheduler loop:

```go
func schedule() {
    mp := getg().m

    if mp.locks != 0 {
        throw("schedule: holding locks")
    }

    // Step 1: If this M is locked to a specific G (LockOSThread), park
    // and wait until that G is runnable again. Don't pick anything else.
    if mp.lockedg != 0 {
        stoplockedm()
        execute(mp.lockedg.ptr(), false)
    }

top:
    pp := mp.p.ptr()
    pp.preempt = false

    // Step 2: If GC requested a stop, do it before scheduling.
    if sched.gcwaiting.Load() {
        gcstopm()
        goto top
    }
    if pp.runSafePointFn != 0 {
        runSafePointFn()
    }

    // Step 3: If a trace is enabled and asked for periodic GC, check.
    checkTimers(pp, 0)

    var gp *g
    var inheritTime, tryWakeP bool

    // Step 4: Fairness sip every 61 schedules.
    if pp.schedtick%61 == 0 && sched.runqsize > 0 {
        lock(&sched.lock)
        gp = globrunqget(pp, 1)
        unlock(&sched.lock)
    }

    // Step 5: Try runnext, then runq.
    if gp == nil {
        gp, inheritTime = runqget(pp)
    }

    // Step 6: Slow path — search globally, steal, netpoll, or park.
    if gp == nil {
        gp, inheritTime, tryWakeP = findrunnable()
    }

    // Step 7: Stop spinning if we were.
    if mp.spinning {
        resetspinning()
    }

    // Step 8: If a G that wants its own goroutine was just produced
    // (e.g., we just stole one), try to wake another P to run more.
    if tryWakeP {
        wakep()
    }

    // Step 9: G is locked to a different M (LockOSThread holder).
    // Hand off to that M.
    if gp.lockedm != 0 {
        startlockedm(gp)
        goto top
    }

    execute(gp, inheritTime)
}
```

`execute(gp, inheritTime)`:

```go
func execute(gp *g, inheritTime bool) {
    mp := getg().m

    mp.curg = gp
    gp.m = mp
    casgstatus(gp, _Grunnable, _Grunning)

    gp.waitsince = 0
    gp.preempt = false
    gp.stackguard0 = gp.stack.lo + stackGuard
    if !inheritTime {
        mp.p.ptr().schedtick++
    }

    gogo(&gp.sched)  // assembly: load registers, jump to PC
}
```

`gogo` is implemented in assembly per architecture (`runtime/asm_amd64.s` and friends). It restores SP, BP, and other registers from `gp.sched`, then jumps to `gp.sched.pc`. The G is now running.

Eventually the G calls `gopark`, `Gosched`, returns (`goexit`), or is preempted. All paths come back to `schedule()` via either `mcall(fn)` (saves G state and calls `fn` on g0) or `goexit0` (the G's exit handler).

---

## `findrunnable` — the Search Order

When `schedule()` finds nothing in `runnext` or the local runq, it calls `findrunnable()`. The function is long (~250 lines including comments). Its skeleton:

```go
func findrunnable() (gp *g, inheritTime, tryWakeP bool) {
    mp := getg().m

top:
    pp := mp.p.ptr()

    // 1. Check local runqueue once more (might have changed)
    if gp, inheritTime = runqget(pp); gp != nil {
        return gp, inheritTime, false
    }

    // 2. Check global runqueue
    if sched.runqsize != 0 {
        lock(&sched.lock)
        gp = globrunqget(pp, 0)  // 0 = take a batch
        unlock(&sched.lock)
        if gp != nil { return gp, false, false }
    }

    // 3. Poll the network (non-blocking)
    if netpollinited() && netpollAnyWaiters() && sched.lastpoll.Load() != 0 {
        if list := netpoll(0); !list.empty() {
            gp = list.pop()
            injectglist(&list)        // push the rest to global
            casgstatus(gp, _Gwaiting, _Grunnable)
            return gp, false, false
        }
    }

    // 4. Spinning: try to steal from other Ps
    if !mp.spinning && 2*sched.nmspinning.Load() < gomaxprocs-sched.npidle.Load() {
        mp.spinning = true
        sched.nmspinning.Add(1)
    }

    if mp.spinning {
        for i := 0; i < 4; i++ {
            for enum := stealOrder.start(fastrand()); !enum.done(); enum.next() {
                p2 := allp[enum.position()]
                if p2 == pp { continue }
                if gp = runqsteal(pp, p2, /* stealRunNext */ i > 2); gp != nil {
                    return gp, false, false
                }
            }
        }
    }

    // 5. No work — drop P, park M.
    lock(&sched.lock)
    if sched.runqsize != 0 {
        gp = globrunqget(pp, 0)
        unlock(&sched.lock)
        return gp, false, false
    }
    if releasep() != pp { throw("releasep") }
    pidleput(pp, 0)
    unlock(&sched.lock)

    // 6. Final checks before parking (might have just become runnable)
    if mp.spinning {
        mp.spinning = false
        sched.nmspinning.Add(-1)
    }
    for id, p2 := range allp {
        if !runqempty(p2) {
            // Acquire a P, retry from top.
            ...
        }
    }
    if netpollinited() && netpollAnyWaiters() {
        // park on netpoll
        ...
    }

    // 7. Park.
    stopm()
    goto top
}
```

Important points:

- **Four steal attempts**. The function tries up to four passes over a random permutation of other Ps. The randomisation (`stealOrder`) ensures no bias toward the lowest-id P.
- **`runqsteal` takes half**. The thief moves half of the victim's `runq` slots to its own `runq`, plus optionally the victim's `runnext` on later passes.
- **Re-check after stealing nothing**. Between "found nothing" and "park," the runtime re-checks the global queue and netpoll once more, because parking is expensive.
- **`stopm` parks**. `stopm` puts the P on `pidle`, decrements `nmspinning` if applicable, and futex-sleeps on `m.park`.

---

## `runqget`, `runqput`, and the Ring Buffer Atomics

The runqueue is a 256-slot ring. Operations:

```go
// runqput puts g on the local runnable queue.
// If next is false, runqput adds g to the tail of the runnable queue.
// If next is true, runqput puts g in the pp.runnext slot.
// If runq is full, runnable g is put on the global queue.
func runqput(pp *p, gp *g, next bool) {
    if randomizeScheduler && next && fastrandn(2) == 0 {
        next = false
    }

    if next {
    retryNext:
        oldnext := pp.runnext
        if !pp.runnext.cas(oldnext, guintptr(unsafe.Pointer(gp))) {
            goto retryNext
        }
        if oldnext == 0 { return }
        gp = oldnext.ptr()  // displaced G goes to runq
    }

retry:
    h := atomic.LoadAcq(&pp.runqhead)
    t := pp.runqtail
    if t-h < uint32(len(pp.runq)) {
        pp.runq[t%uint32(len(pp.runq))].set(gp)
        atomic.StoreRel(&pp.runqtail, t+1)
        return
    }
    if runqputslow(pp, gp, h, t) { return }
    goto retry
}
```

Three key invariants:

- **Single producer for `runqtail`**. Only the owning M ever advances `runqtail`. So the store is plain (with release semantics for thieves).
- **Multi-consumer for `runqhead`**. Both the owning M and stealing Ms can advance `runqhead`. So pops use CAS.
- **`runqtail - runqhead` is the count**. Modular arithmetic on `uint32` gives correct wrap behavior; the buffer is full when the difference equals 256.

`runqget`:

```go
func runqget(pp *p) (gp *g, inheritTime bool) {
    // Check runnext first.
    next := pp.runnext
    if next != 0 && pp.runnext.cas(next, 0) {
        return next.ptr(), true
    }

    for {
        h := atomic.LoadAcq(&pp.runqhead)
        t := pp.runqtail
        if t == h {
            return nil, false
        }
        gp := pp.runq[h%uint32(len(pp.runq))].ptr()
        if atomic.CasRel(&pp.runqhead, h, h+1) {
            return gp, false
        }
    }
}
```

`runqsteal` (the thief side):

```go
func runqsteal(pp, p2 *p, stealRunNextG bool) *g {
    t := pp.runqtail
    n := runqgrab(p2, &pp.runq, t, stealRunNextG)
    if n == 0 { return nil }
    n--
    gp := pp.runq[(t+n)%uint32(len(pp.runq))].ptr()
    if n == 0 { return gp }
    h := atomic.LoadAcq(&pp.runqhead)
    if t-h+n >= uint32(len(pp.runq)) {
        throw("runqsteal: runq overflow")
    }
    atomic.StoreRel(&pp.runqtail, t+n)
    return gp
}
```

`runqgrab` takes half (`(t - h + 1) / 2`) of the victim's runqueue, CAS'ing the head forward. The thief copies the grabbed entries into its own runqueue, returns one to run immediately, leaves the rest queued.

The atomic protocol — release on tail-store, acquire on head-load, CAS for popping — is identical to the pattern in Chase-Lev work-stealing queues, of which Go's is a variant.

---

## `runnext` Steal Semantics

`runnext` is a single-slot store, and it can be stolen, but with a caveat: a thief only steals `runnext` after several failed steal passes (typically pass 3 or 4 of `findrunnable`'s outer loop). The reason: `runnext` is a hint that "this G is about to run anyway — leave it for the local P." Stealing it eagerly would defeat the latency improvement it exists to provide.

If a thief does steal `runnext`, the victim has its `runnext` cleared via CAS. Race-free because both reader and writer use CAS on the same word.

A separate subtlety: when a G ready'd via `runnext` displaces another G into the runqueue, the displaced G *is* in the runqueue and can be stolen normally. Only the "current" `runnext` is special.

---

## The Spinning M Protocol

Two counters in `sched`:

- `npidle` — number of idle Ps.
- `nmspinning` — number of Ms currently in the spinning state.

Invariant: `nmspinning <= GOMAXPROCS / 2`, and increments happen *before* an M enters spinning. The condition to enter spinning is:

```
2 * nmspinning < gomaxprocs - npidle
```

Equivalently: at most half of the non-idle Ps may have spinning Ms.

Why the cap? Spinning is "active waiting" — the M burns CPU looking at other Ps. Too many spinners → wasted cycles. Too few → wakes are slow. The runtime found half-of-active-Ps to be a sweet spot empirically.

When work arrives (someone calls `wakep`), the runtime tries to wake a spinning M *or* an idle M, not a spinning *and* an idle M. Spinning Ms find work themselves; the wake is for the case "no one is currently looking."

---

## How `gopark` and `goready` Tie G to the Scheduler

`gopark` is the universal "park this G" entry point used by channels, mutexes, sleep, network IO, and `sync.Cond`. Signature:

```go
func gopark(unlockf func(*g, unsafe.Pointer) bool,
            lock unsafe.Pointer,
            reason waitReason,
            traceEv byte,
            traceskip int)
```

Implementation outline:

```go
func gopark(...) {
    mp := acquirem()
    gp := mp.curg
    status := readgstatus(gp)
    if status != _Grunning && status != _Gscanrunning {
        throw("gopark: bad g status")
    }
    mp.waitlock = lock
    mp.waitunlockf = unlockf
    gp.waitreason = reason
    mp.waittraceev = traceEv
    mp.waittraceskip = traceskip
    releasem(mp)
    mcall(park_m)
}

func park_m(gp *g) {
    mp := getg().m
    casgstatus(gp, _Grunning, _Gwaiting)
    dropg()  // mp.curg = nil

    if fn := mp.waitunlockf; fn != nil {
        ok := fn(gp, mp.waitlock)
        mp.waitunlockf = nil
        mp.waitlock = nil
        if !ok {
            // Spurious wake — put G back as runnable.
            casgstatus(gp, _Gwaiting, _Grunnable)
            execute(gp, true)
        }
    }

    schedule()
}
```

The trick is `unlockf`: a callback that runs *after* the G is marked `_Gwaiting` but *before* the scheduler picks the next G. The pattern is used by channels: the channel's `chansend` first enqueues a `sudog`, then calls `gopark` with `unlockf` set to release the channel lock. This ordering guarantees that any wake racing the park will see the parked G (because the sudog is enqueued first) but the channel lock is held until the G is truly parked (because `unlockf` runs after the status change).

`goready` is the reciprocal:

```go
func goready(gp *g, traceskip int) {
    systemstack(func() {
        ready(gp, traceskip, true)
    })
}

func ready(gp *g, traceskip int, next bool) {
    casgstatus(gp, _Gwaiting, _Grunnable)
    runqput(getg().m.p.ptr(), gp, next)
    wakep()
}
```

If `next == true`, the G goes into `runnext`. This is how channel handoffs achieve the ping-pong locality mentioned in middle: receiver wakes sender via `goready(g, ..., true)`, sender lands in `runnext`, runs next iteration without queue contention.

---

## Per-P Caches: The Refill Protocol

Each per-P cache has the same pattern: take from local; if empty, take a batch from a central pool under a global lock.

**`mcache` refill** (in `runtime/mcache.go`):

```go
func (c *mcache) refill(spc spanClass) {
    s := c.alloc[spc]
    // Return the current span to mcentral.
    if s != &emptymspan {
        mheap_.central[spc].mcentral.uncacheSpan(s)
    }
    // Get a new span from mcentral.
    s = mheap_.central[spc].mcentral.cacheSpan()
    c.alloc[spc] = s
}
```

`mcentral.cacheSpan` takes `mcentral.partial` under a lock and returns a span with free slots. Calls per allocation: typically zero (the span has many slots); when the span fills, exactly one.

**`sudogcache` refill**:

```go
func acquireSudog() *sudog {
    mp := acquirem()
    pp := mp.p.ptr()
    if len(pp.sudogcache) == 0 {
        lock(&sched.sudoglock)
        // Steal half of sched.sudogcache.
        for len(pp.sudogcache) < cap(pp.sudogcache)/2 && sched.sudogcache != nil {
            s := sched.sudogcache
            sched.sudogcache = s.next
            s.next = nil
            pp.sudogcache = append(pp.sudogcache, s)
        }
        unlock(&sched.sudoglock)
        if len(pp.sudogcache) == 0 {
            pp.sudogcache = append(pp.sudogcache, new(sudog))
        }
    }
    n := len(pp.sudogcache)
    s := pp.sudogcache[n-1]
    pp.sudogcache[n-1] = nil
    pp.sudogcache = pp.sudogcache[:n-1]
    releasem(mp)
    return s
}
```

Refills happen in chunks (cap/2) to amortise lock cost.

**`gFree` refill** is similar: when a P has too few free Gs, it pulls a batch from `sched.gFree`. When a P has too many (after many goroutine exits), it returns some to `sched.gFree`. The thresholds are heuristic constants in `runtime/proc.go`.

---

## Lock Ranks Inside the Scheduler

The runtime uses a static lock-ranking system (in `runtime/lockrank.go`) to detect potential deadlocks. Scheduler-relevant ranks, lowest to highest:

| Rank | Lock | Purpose |
|---|---|---|
| Low | `pp.timers` | Per-P timer heap |
| Low | `sudoglock` | Global sudog free list |
| Low | `deferlock` | Global defer free list |
| Mid | `sched.lock` | The big scheduler lock |
| Mid | `mheap.lock` | Memory heap |
| Mid | `notesleep` | Futex notes |
| High | `gscan` | GC scan synchronization |

The rule: you may only acquire higher-rank locks while holding lower-rank ones, never the reverse. The runtime debug builds enforce this with `LockRanked` checks.

A key consequence: `chansend`/`chanrecv` may not call `goready` while holding the channel mutex (which has rank "below" sched.lock indirectly), because `goready` may need `sched.lock`. The pattern is "release the channel lock, then `goready`."

---

## The Vyukov Proposal — Annotated

Vyukov's design doc proposed P with three goals:

1. **Eliminate global lock on hot path.** The 2010-era Go scheduler had a single `sched.lock` protecting the runqueue, allocator caches, and idle thread lists. At `GOMAXPROCS=8`, this lock was held >30% of the time.
2. **Improve cache locality.** Goroutines pinned to a P tend to stay on the same M, so per-G data (stack, recent allocations) stays cache-hot.
3. **Enable work-stealing.** Without per-P queues, "stealing" was meaningless. With them, the runtime could let any idle P snatch work from any busy P, smoothing load.

The doc gave benchmarks showing 2-3x throughput improvement on contention-heavy workloads at `GOMAXPROCS=16`. Subsequent Go releases extended the design with:

- **Async preemption** (1.14): runs in parallel with the same struct layout — `g.preempt` flag and `g.stackguard0` poisoning.
- **Network poller integration** (1.5): `findrunnable` learned to call `netpoll`, weaving the IO event loop into the scheduler.
- **Cooperative GC** (1.5+): the same per-P structs hold GC work and assist credit.

The proposal lives at <https://docs.google.com/document/d/1TTj4T2JO42uD5ID9e89oa0sLKhJYD0Y_kqxDv3I3XMw/edit>. It is the single most important runtime document in Go's history.

---

## `procresize` — Changing `GOMAXPROCS`

When `runtime.GOMAXPROCS(n)` changes the count, `procresize(n)` is called under STW:

```go
func procresize(nprocs int32) *p {
    old := gomaxprocs
    if nprocs > int32(len(allp)) {
        // Grow allp slice
        ...
    }

    // Initialize new P's.
    for i := old; i < nprocs; i++ {
        pp := allp[i]
        if pp == nil { pp = new(p); allp[i] = pp }
        pp.init(i)
        atomic.Store(&pp.status, _Pgcstop)
    }

    // Free unused P's.
    for i := nprocs; i < old; i++ {
        pp := allp[i]
        pp.destroy()  // drain caches, move runq to global
        atomic.Store(&pp.status, _Pdead)
    }

    gomaxprocs = nprocs

    // Distribute current G runqueue across the new P set.
    ...

    return runnablePs
}
```

Destroying a P drains its `mcache` back to `mcentral`, returns its `sudogcache`/`deferpool` to globals, and moves any runnable Gs in its `runq` to the GRQ. The P struct itself is not freed (it stays in `allp` for potential re-growth) but is marked `_Pdead`.

This is expensive — full STW, cache draining, queue redistribution. Do not call `GOMAXPROCS(n)` from the hot path.

---

## Where Sysmon Fits Without a P

Sysmon is a single dedicated goroutine started in `main()` at runtime startup. It runs on its own M and **never holds a P**. Its responsibilities:

- **Retake Ps from blocked syscalls** — every ~10 µs, scan `allp` for `_Psyscall` Ps that have been blocked too long. CAS them to `_Pidle`, hand off to a fresh M.
- **Force preemption** — for Gs running longer than 10 ms without yielding, send a SIGURG that triggers async preemption (post-1.14).
- **Trigger background GC** — when the heap is large enough relative to the goal, start a GC cycle.
- **Network poller wake** — periodically call `netpoll` to push ready Gs onto runqueues.

Because sysmon runs without a P, it cannot run user Go code or hold most runtime locks. It uses atomics and short `sched.lock` acquisitions only.

Sysmon is critical to fairness: without it, a long-running G could prevent the runtime from noticing that other Gs are starving.

---

## Invariants You Can Assert

If you instrument a Go binary with runtime checks, these invariants must hold (and they are asserted in debug builds):

1. **Status invariant**: `g.atomicstatus` is one of the defined states (possibly with `_Gscan` OR'd in).
2. **Triangle invariant**: a `_Grunning` G has `g.m != nil`, `g.m.curg == g`, `g.m.p != nil`.
3. **Queue invariant**: a `_Grunnable` G is in exactly one runqueue (a P's `runnext`, a P's `runq`, or `sched.runq`). Never in two.
4. **Wait invariant**: a `_Gwaiting` G is in exactly one wait queue (a primitive's `recvq`/`sendq`/cond list).
5. **Spinning bound**: `sched.nmspinning <= GOMAXPROCS / 2`.
6. **Idle invariant**: an idle M (in `sched.midle`) has `m.p == nil` and `m.curg == nil`.
7. **P-M reciprocity**: if `p.m == m`, then `m.p == p`.
8. **No-park-while-locked**: a G holding a runtime lock cannot park via `gopark`.

Most bugs in early scheduler code (Go 1.1–1.4 era) were violations of (3) or (4): a G in two queues or no queue. The current code's invariant assertions caught most of those at development time.

---

## What to Read Next

- **`professional.md`** — the structs and the scheduler line by line, with Go source citations.
- **`specification.md`** — the contracts the runtime must honor, framed as invariants.
- **`02-preemption`** — how `g.preempt` and `g.stackguard0` interact with `schedule()`.
- **`04-work-stealing`** — `runqsteal`, `findrunnable`'s outer loop, and the steal order randomization.
- **`05-syscall-handling`** — `entersyscall`/`exitsyscall` and the `_Psyscall` state in depth.
