# Work Stealing — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Reading `runtime/proc.go`](#reading-runtimeprocgo)
3. [`findRunnable` Line by Line](#findrunnable-line-by-line)
4. [`runqsteal` and `runqgrab` Internals](#runqsteal-and-runqgrab-internals)
5. [The `stealOrder` Structure](#the-stealorder-structure)
6. [`stealWork` Loop](#stealwork-loop)
7. [Lock Ranks Involved](#lock-ranks-involved)
8. [Runtime Invariants and Assertions](#runtime-invariants-and-assertions)
9. [Diagnosing Stealing Issues in Production](#diagnosing-stealing-issues-in-production)
10. [Performance Numbers (Measured)](#performance-numbers-measured)
11. [Summary](#summary)

---

## Introduction

The professional view of work stealing reads the runtime source. We name files, give approximate line numbers, walk through `findRunnable` and its helpers as written in Go 1.22, and connect the code to the diagnostic tools (`pprof`, `trace`, `GODEBUG`). After this page you should be able to bring up `runtime/proc.go` in your editor and follow the flow byte by byte.

Source references are to Go 1.22 (`go1.22.x`). Line numbers drift across releases; function names and structure have been stable since Go 1.14.

Files of interest:

- `src/runtime/proc.go` — `findRunnable`, `stealWork`, `runqget`, `runqput`, `runqsteal`, `runqgrab`, `wakep`, `injectglist`, `globrunqget`, `globrunqput`.
- `src/runtime/runtime2.go` — `p`, `m`, `g`, `schedt` type definitions.
- `src/runtime/lock_futex.go` — `sched.lock` implementation on Linux.
- `src/runtime/trace.go` — trace event emission used by `go tool trace`.
- `src/runtime/HACKING.md` — invariants and lock-rank documentation.

---

## Reading `runtime/proc.go`

The file is ~7000 lines. Recommended read order for work stealing:

1. `schedule()` (line ~3540). The top of the M's main loop. Calls `findRunnable`.
2. `findRunnable()` (line ~2960). Decides what to run next.
3. `stealWork()` (line ~3260). Inside `findRunnable`, the steal loop.
4. `runqsteal()` (line ~6470). Moves Gs between LRQs.
5. `runqgrab()` (line ~6510). The atomic-CAS half-take.
6. `runqget()` (line ~6390). Owner-side LRQ pop.
7. `runqput()` and `runqputslow()` (line ~6230). Owner-side push and overflow.
8. `wakep()` (line ~2620). Starts a spinner when work is created.
9. `injectglist()` (line ~3490). Redistributes a list of Gs.
10. `globrunqget()` and `globrunqput()` (line ~6160). GRQ access.

The whole stealing path is ~600 lines of Go. Worth reading once, even at the cost of one afternoon.

`HACKING.md` (in `src/runtime/`) documents the lock-rank order. Lock ranks ensure no scheduler code path can deadlock by violating the ordering.

---

## `findRunnable` Line by Line

Skeleton (Go 1.22, paraphrased to remove cgo and arch noise):

```go
func findRunnable() (gp *g, inheritTime, tryWakeP bool) {
    mp := getg().m

top:
    pp := mp.p.ptr()
    if sched.gcwaiting.Load() {
        gcstopm()
        goto top
    }
    if pp.runSafePointFn != 0 {
        runSafePointFn()
    }

    // (1) periodic timer check
    now, pollUntil, _ := checkTimers(pp, 0)

    // (2) 1-in-61 rule: occasionally take from GRQ first
    if pp.schedtick%61 == 0 && sched.runqsize > 0 {
        lock(&sched.lock)
        gp := globrunqget(pp, 1)
        unlock(&sched.lock)
        if gp != nil {
            return gp, false, false
        }
    }

    // (3) local LRQ
    if gp, inheritTime := runqget(pp); gp != nil {
        return gp, inheritTime, false
    }

    // (4) global runqueue (GRQ)
    if sched.runqsize != 0 {
        lock(&sched.lock)
        gp := globrunqget(pp, 0)
        unlock(&sched.lock)
        if gp != nil {
            return gp, false, false
        }
    }

    // (5) netpoll (non-blocking)
    if netpollinited() && netpollAnyWaiters() && sched.lastpoll.Load() != 0 {
        if list := netpoll(0); !list.empty() {
            gp := list.pop()
            injectglist(&list)
            casgstatus(gp, _Gwaiting, _Grunnable)
            if trace.enabled {
                traceGoUnpark(gp, 0)
            }
            return gp, false, false
        }
    }

    // (6) steal from other Ps
    if mp.spinning || 2*atomic.Load(&sched.nmspinning) < gomaxprocs-atomic.Load(&sched.npidle) {
        if !mp.spinning {
            mp.becomeSpinning()
        }
        gp, inheritTime, tnow, w, newWork := stealWork(now)
        if gp != nil {
            return gp, inheritTime, false
        }
        if newWork {
            goto top
        }
        now = tnow
        if w != 0 && (pollUntil == 0 || w < pollUntil) {
            pollUntil = w
        }
    }

    // (7) GC mark workers (idle-mark assist)
    if gcBlackenEnabled != 0 && gcMarkWorkAvailable(pp) {
        node := (*gcBgMarkWorkerNode)(gcBgMarkWorkerPool.pop())
        if node != nil {
            pp.gcMarkWorkerMode = gcMarkWorkerIdleMode
            gp := node.gp.ptr()
            casgstatus(gp, _Gwaiting, _Grunnable)
            if trace.enabled {
                traceGoUnpark(gp, 0)
            }
            return gp, false, false
        }
    }

    // (8) final pre-park checks
    // ... re-check timers, GRQ, netpoll under sched.lock, then stopm() ...
    stopm()
    goto top
}
```

### The numbered phases

| # | Phase | Cost |
|---|---|---|
| 1 | Timer check (`checkTimers`) | ~10 ns |
| 2 | 1-in-61 GRQ peek | ~3 ns (61 of 62 times skipped) |
| 3 | Local LRQ pop (`runqget`) | ~5 ns |
| 4 | GRQ pop (`globrunqget`) | ~30 ns (lock + pop) |
| 5 | Netpoll (`netpoll(0)`) | ~50 ns (syscall) |
| 6 | Steal loop (`stealWork`) | ~25 ns/successful steal, ~100 ns/failed-round |
| 7 | GC idle-mark worker | ~10 ns (peek) |
| 8 | Park M (`stopm`) | ~1 μs (futex) |

The empty-LRQ path through (3) to (6) is the *hot path* when stealing is needed. Total cost on a successful steal: ~50–100 ns.

---

## `runqsteal` and `runqgrab` Internals

`runqsteal` (Go 1.22, `proc.go` line ~6470):

```go
func runqsteal(pp, p2 *p, stealRunNextG bool) *g {
    t := pp.runqtail
    n := runqgrab(p2, &pp.runq, t, stealRunNextG)
    if n == 0 {
        return nil
    }
    n--
    gp := pp.runq[(t+n)%uint32(len(pp.runq))].ptr()
    if n == 0 {
        return gp
    }
    h := atomic.LoadAcq(&pp.runqhead)
    if t-h+n >= uint32(len(pp.runq)) {
        throw("runqsteal: runq overflow")
    }
    atomic.StoreRel(&pp.runqtail, t+n)
    return gp
}
```

`runqgrab` (line ~6510):

```go
func runqgrab(pp *p, batch *[256]guintptr, batchHead uint32, stealRunNextG bool) uint32 {
    for {
        h := atomic.LoadAcq(&pp.runqhead) // load-acquire, sync with consumer
        t := atomic.LoadAcq(&pp.runqtail) // load-acquire, sync with producer
        n := t - h
        n = n - n/2
        if n == 0 {
            if stealRunNextG {
                if next := pp.runnext; next != 0 {
                    if pp.status == _Prunning {
                        // sleep to ensure that p isn't about to run the g
                        // we are about to steal.
                        if GOOS != "windows" && GOOS != "openbsd" && GOOS != "netbsd" {
                            usleep(3)
                        } else {
                            osyield()
                        }
                    }
                    if !pp.runnext.cas(next, 0) {
                        continue
                    }
                    batch[batchHead%uint32(len(batch))] = next
                    return 1
                }
            }
            return 0
        }
        if n > uint32(len(pp.runq)/2) { // read inconsistent h and t
            continue
        }
        for i := uint32(0); i < n; i++ {
            g := pp.runq[(h+i)%uint32(len(pp.runq))]
            batch[(batchHead+i)%uint32(len(batch))] = g
        }
        if atomic.CasRel(&pp.runqhead, h, h+n) {
            return n
        }
    }
}
```

Analysis:

1. `LoadAcq` on both `runqhead` and `runqtail`. Memory order: acquire ensures we see all writes that happened before the producer's store-release on `runqtail`.
2. Compute `n = (t - h) - (t - h)/2`. This equals `ceil((t-h)/2)`. Half of the available items.
3. If `n == 0` and `stealRunNextG`, attempt to grab `runnext`.
   - The `usleep(3)` is a real gem: we sleep 3 μs *before* CAS'ing `runnext`. This is to avoid stealing a `runnext` that the owner is about to consume — a "polite" steal that waits a moment to see if the owner takes it.
4. If `n > len/2`, we read inconsistent indices (head moved past tail concurrently). Retry.
5. Copy n entries from victim's LRQ into thief's batch.
6. CAS victim's `runqhead` from `h` to `h+n`. If it succeeds, we own those entries. If it fails, another thief got there first; retry.

### The `LoadAcq` / `StoreRel` pairing

Go's atomics use Go-specific memory ordering. `LoadAcq` is acquire-load: subsequent reads cannot be reordered before it. `StoreRel` is release-store: prior writes cannot be reordered after it. The pairing ensures:

- Producer: writes G pointer to `runq[t]`, then `StoreRel(runqtail, t+1)`. Other threads that see the new `runqtail` are guaranteed to see the G pointer.
- Consumer (thief): `LoadAcq(runqhead)` and `LoadAcq(runqtail)`. Once we see `runqtail`, we are guaranteed to see the G pointers up to that point.

Without acquire-release, a thief could read `runqtail` as N+1 but read `runq[N]` as still-empty (the G pointer write was reordered after the index update). The bug would be subtle and disastrous.

### The `usleep(3)` quirk

Why 3 μs? Empirical tuning. Long enough that the owner — if currently running — finishes its current scheduling cycle and consumes `runnext`. Short enough that if the owner is *not* about to consume, the thief gets it quickly.

On Windows and BSDs, `osyield` (which calls `SwitchToThread`/`sched_yield`) is used instead, because `usleep` granularity is poor on those kernels.

This sleep is a *hack*. It introduces a small latency on `runnext` stealing to bias toward "owner runs it." Without it, thieves would aggressively steal Gs that the owner expected to run next, defeating the LIFO-slot optimisation.

---

## The `stealOrder` Structure

`stealOrder` is a small struct that generates a deterministic permutation of [0, gomaxprocs) starting from a random seed. From `runtime/proc.go`:

```go
type randomOrder struct {
    count    uint32
    coprimes []uint32
}

type randomEnum struct {
    i     uint32
    count uint32
    pos   uint32
    inc   uint32
}

func (ord *randomOrder) reset(count uint32) {
    ord.count = count
    ord.coprimes = ord.coprimes[:0]
    for i := uint32(1); i <= count; i++ {
        if gcd(i, count) == 1 {
            ord.coprimes = append(ord.coprimes, i)
        }
    }
}

func (ord *randomOrder) start(i uint32) randomEnum {
    return randomEnum{
        count: ord.count,
        pos:   i % ord.count,
        inc:   ord.coprimes[i/ord.count%uint32(len(ord.coprimes))],
    }
}
```

When `GOMAXPROCS` changes, `reset` is called. It precomputes all coprimes of `gomaxprocs` (which are step sizes that visit every position before repeating). The number of coprimes is `phi(gomaxprocs)` (Euler totient).

`start(i)` initialises an enumeration: start position `i % count`, step `coprimes[(i/count) % len(coprimes)]`. The enumeration walks `count` steps in a permutation of [0, count).

### Why coprime stride

A stride `s` such that `gcd(s, n) = 1` will visit every position in [0, n) exactly once before returning to the start (after n steps). This is faster than computing a full random permutation (which would need O(n) work per attempt).

Cost of `start(i)`: ~5 ns (a modulus and an array index). Cost per `next()`: ~3 ns (addition and modulus).

### The seed

The seed `i` comes from `cheaprand()`. Different thieves get different starts. Different attempts by the same thief also get different starts (each call to `stealWork` re-seeds).

---

## `stealWork` Loop

`stealWork` (line ~3260) is the body of phase 6 in `findRunnable`:

```go
func stealWork(now int64) (gp *g, inheritTime bool, rnow int64, pollUntil int64, newWork bool) {
    pp := getg().m.p.ptr()
    ranTimer := false

    const stealTries = 4
    for i := 0; i < stealTries; i++ {
        stealTimersOrRunNextG := i == stealTries-1

        for enum := stealOrder.start(cheaprand()); !enum.done(); enum.next() {
            if sched.gcwaiting.Load() {
                // GC needs us; bail out.
                return nil, false, now, pollUntil, true
            }
            p2 := allp[enum.position()]
            if pp == p2 {
                continue
            }

            if stealTimersOrRunNextG && timerpMask.read(enum.position()) {
                tnow, w, ran := checkTimers(p2, now)
                now = tnow
                if w != 0 && (pollUntil == 0 || w < pollUntil) {
                    pollUntil = w
                }
                if ran {
                    // checkTimers may have run a timer that pushed
                    // a G to our runq. Recheck.
                    if gp, inheritTime := runqget(pp); gp != nil {
                        return gp, inheritTime, now, pollUntil, ranTimer
                    }
                    ranTimer = true
                }
            }

            if !idlepMask.read(enum.position()) {
                if gp := runqsteal(pp, p2, stealTimersOrRunNextG); gp != nil {
                    return gp, false, now, pollUntil, ranTimer
                }
            }
        }
    }

    return nil, false, now, pollUntil, ranTimer
}
```

Key details:

1. **4 attempts maximum**. On the last attempt, both timer-steal and `runnext`-steal are enabled.
2. **Random start, coprime walk**. Each attempt re-randomises via `cheaprand()`.
3. **Skip self**. `if pp == p2 { continue }`.
4. **Skip idle Ps**. `idlepMask` is a bitmap of Ps known to be idle. Skipping them avoids wasted peeks.
5. **`timerpMask`**. A bitmap of Ps that have timers. Only check timers on those Ps.
6. **GC check**. If `sched.gcwaiting`, return immediately so the M can transition into GC mode.

### The `idlepMask` and `timerpMask` bitmaps

Two atomic bitmaps in `sched`:

```go
type pMask []uint32

func (p pMask) read(id uint32) bool {
    word := id / 32
    mask := uint32(1) << (id % 32)
    return atomic.Load(&p[word])&mask != 0
}

func (p pMask) set(id int32) { ... }
func (p pMask) clear(id int32) { ... }
```

`idlepMask` is set when a P enters `pidle`, cleared when it leaves. `timerpMask` is set when a P has timers, cleared when it has none.

These bitmaps allow `stealWork` to skip Ps in O(1) per skip, much faster than checking each P's status field. For large `GOMAXPROCS` (e.g., 64+), this is significant.

---

## Lock Ranks Involved

Go's runtime uses lock ranks to detect ordering violations. Relevant ranks for work stealing:

```go
// runtime/lockrank.go
const (
    lockRankSysmon
    lockRankSched
    lockRankAllg
    lockRankAllp
    // ...
    lockRankTimers
    lockRankGlobalAlloc
    // ...
)
```

`sched.lock` has rank `lockRankSched`. The rule: when acquiring multiple locks, take them in increasing rank order.

In work stealing:

- `globrunqget` takes `sched.lock`. No other lock is held.
- `runqsteal` is lock-free (atomic CAS on `runqhead`).
- `wakep` may briefly take `sched.lock` via `pidleget`.

The runtime asserts lock-rank order via `lockRankCrash`. A violation crashes the program with a clear message in `-race` or debug builds.

---

## Runtime Invariants and Assertions

`throw()` calls in the work-stealing path:

| Assertion | Triggered by |
|---|---|
| `"runqsteal: runq overflow"` | After a steal, the thief's LRQ would exceed capacity. Indicates a bug in the runqhead/runqtail accounting. |
| `"runqputslow: queue is not full"` | `runqputslow` called when LRQ has room. Logic error. |
| `"runqput: G not in expected status"` | A G being pushed has the wrong status (e.g., `_Grunning` instead of `_Grunnable`). Corruption. |
| `"findRunnable: nmspinning is 0"` | After a spinning M's flag is cleared, the counter check failed. Concurrency bug. |
| `"sched.runqsize != 0 but globrunqget returned nil"` | The GRQ counter is out of sync with the list. Corruption. |

These exist because the scheduler cannot recover from corruption. Crashing with a clear message is preferable to silent misscheduling.

### Status transitions during steal

A G being stolen is in `_Grunnable` state. The steal does not change its status — only its location (which LRQ). The status changes happen at:

- `runqput`: G is already `_Grunnable` when pushed (assertion via `if readgstatus(gp) != _Grunnable`).
- `runqget`: returned G remains `_Grunnable`; the caller (typically `execute`) transitions to `_Grunning`.

This means stealing is "physical" only — the G's lifecycle state is unchanged.

---

## Diagnosing Stealing Issues in Production

### Symptom: high `idleprocs` with non-zero LRQ

`GODEBUG=schedtrace=1000` shows:

```
SCHED ...: gomaxprocs=8 idleprocs=3 threads=12 spinningthreads=0 ...
  P0: lrq=5 ...
  P1: lrq=0 ...
```

3 Ps idle but P0 has 5 runnable Gs. Possible causes:

1. Spinners parked too quickly. The runtime stopped spinning because `2*nmspinning >= gomaxprocs - npidle`. But work appeared after spinning stopped.
2. `LockOSThread` Gs on P0. They are not stealable.
3. cgo on those Gs. They are not on the LRQ.

Diagnose: stack trace each goroutine. Look for `LockOSThread` or `cgocall` in frames.

### Symptom: high `spinningthreads` with no work

```
SCHED ...: gomaxprocs=8 idleprocs=4 threads=12 spinningthreads=4 ...
```

4 Ms spinning but no work. The runtime's spin cap (`2*nmspinning < gomaxprocs - npidle`, i.e., `8 < 4` here, so should have stopped at 2 spinners). Indicates a transient mismatch — spinners about to park.

Persistent high spinning is a bug. File against Go runtime.

### Symptom: GRQ size growing unboundedly

```
SCHED ...: runqueue=12345 ...
```

LRQs overflowing repeatedly. Cause: producer P >> consumer Ps. Profile:

```bash
go tool pprof http://host:6060/debug/pprof/profile
```

Look for time in `runtime.runqput` or `runtime.runqputslow`. Mitigate by sharding the producer.

### Symptom: scheduler trace shows G never moves

In `go tool trace`, you see Gs created on P0 but never observed on P1, P2, P3.

- Are those Gs running? Or parked? If parked, stealing cannot help.
- Is `LockOSThread` used? Check the G's stack.
- Is `GOMAXPROCS=1`? Check.

If none apply and you have many runnable Gs on P0 while P1–3 are idle, file a runtime bug with a reproducer.

---

## Performance Numbers (Measured)

Reference: `BenchmarkChanProdCons` and `BenchmarkPingPong` in `runtime/`. Modern x86_64 server, Go 1.22, GOMAXPROCS=8:

| Operation | Approximate ns |
|---|---|
| `runqget` (local pop) | 5 |
| `runqput` (local push, no overflow) | 5 |
| `runqputslow` (overflow path) | 200 |
| `globrunqget` (GRQ pop under lock) | 40 |
| `runqsteal` (4 Gs) | 25 |
| `runqsteal` (16 Gs) | 50 |
| Failed steal (peek victim, empty) | 3 |
| `wakep` (no spinner running) | 100 |
| `wakep` (spinner already running) | 5 |
| Park M (`stopm` + futex) | 1000 |
| Wake M (futex + transition) | 800 |

For comparison, channel send/recv pair: ~70 ns. Mutex lock/unlock: ~25 ns uncontended.

### Scaling

Throughput of work stealing scales near-linearly with `GOMAXPROCS` up to ~64 cores. Beyond that, `sched.lock` contention on GRQ access can degrade scaling. NUMA effects also kick in: stealing across NUMA nodes is slower than within.

Modern Go (1.20+) has improvements for very large `GOMAXPROCS` — sharded GRQ proposals are being discussed for future versions.

### Steal latency

For a typical Go HTTP server under load, the time from "new G created" to "new G running on some P" is:

- 95th percentile: ~1 μs (a spinner picks it up).
- 99th percentile: ~10 μs (spinning cap reached; some delay).
- 99.99th percentile: ~100 μs (spinner had to be created from a parked M).

These numbers are why work stealing matters: bursty traffic spikes are absorbed without queueing delays.

---

## Summary

The professional view of work stealing is the runtime source plus the tooling:

- `findRunnable` in `runtime/proc.go` orchestrates the steal flow.
- `runqsteal` and `runqgrab` implement the atomic-CAS half-move.
- `stealOrder` generates random-permutation walks via coprime stride.
- `stealWork` runs up to 4 attempts over all Ps with timer and `runnext` steals enabled on the last attempt.
- `sched.lock` is the only mutex in the stealing path (acquired for GRQ access).
- Acquire-release atomics on `runqhead`/`runqtail` make the operation memory-safe.
- The `usleep(3)` before `runnext`-steal is a deliberate tuning hack.
- Production diagnosis uses `GODEBUG=schedtrace`, `go tool trace`, and pprof.
- Steal cost: ~25 ns per steal; parking cost: ~1 μs. Spinning avoids the latter.

After this page, the runtime is fully transparent. You can read `proc.go`, you can read scheduler traces, and you can debug pathological cases without guessing.

The specification page that follows catalogues the formal invariants the scheduler must preserve.
