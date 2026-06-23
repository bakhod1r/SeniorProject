# Work Stealing — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [The `findRunnable` Flow in Detail](#the-findrunnable-flow-in-detail)
3. [LRQ Layout](#lrq-layout)
4. [`runqsteal`: The Move](#runqsteal-the-move)
5. [Spinning Ms](#spinning-ms)
6. [`nmspinning` Counter](#nmspinning-counter)
7. [`wakep` and the Spin Invariant](#wakep-and-the-spin-invariant)
8. [The Global Runqueue Path](#the-global-runqueue-path)
9. [`injectglist`: Reinserting Goroutines](#injectglist-reinserting-goroutines)
10. [Steal Cost Breakdown](#steal-cost-breakdown)
11. [Summary](#summary)

---

## Introduction

The middle level moves from "work stealing exists and helps" to "here is the actual sequence of operations." We trace `findRunnable` step by step, look at the LRQ as a circular array with two indices, walk through `runqsteal` (the function that moves goroutines from one LRQ to another), introduce spinning Ms in proper detail, and describe `wakep` and `injectglist`. Pseudocode here is close to the Go 1.22 `runtime/proc.go` source but stripped of build-tag and instrumentation noise.

If you have not read the junior level, do so first. This page assumes you know the seven-step flow at a high level.

---

## The `findRunnable` Flow in Detail

`findRunnable` is called from `schedule()` every time an M needs a goroutine. The simplified flow:

```go
// runtime/proc.go (paraphrased)
func findRunnable() (gp *g, inheritTime, tryWakeP bool) {
    mp := getg().m
top:
    pp := mp.p.ptr()

    // 0. periodic GC and timers
    if pp.runSafePointFn != 0 {
        runSafePointFn()
    }
    now, pollUntil, _ := checkTimers(pp, 0)

    // 1. local LRQ
    if gp, inheritTime := runqget(pp); gp != nil {
        return gp, inheritTime, false
    }

    // 2. global runqueue
    if sched.runqsize != 0 {
        lock(&sched.lock)
        gp := globrunqget(pp, 0)
        unlock(&sched.lock)
        if gp != nil {
            return gp, false, false
        }
    }

    // 3. netpoll (non-blocking)
    if netpollinited() && netpollAnyWaiters() && sched.lastpoll.Load() != 0 {
        if list := netpoll(0); !list.empty() {
            gp := list.pop()
            injectglist(&list)  // remaining go to runqueue
            casgstatus(gp, _Gwaiting, _Grunnable)
            return gp, false, false
        }
    }

    // 4. Spin up to steal
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

    // 5. Final checks before parking
    // ... re-check GRQ, timers, network poll ...
    // ... park the M ...
    stopm()
    goto top
}
```

The numbered steps map onto the seven steps from the junior level, with steps 4–6 consolidated into the steal phase. Key points:

- **Local LRQ first** via `runqget(pp)`. This is a single load on the LRQ's tail and an atomic load on the head. Lock-free.
- **Global runqueue** uses `sched.lock`. Cost: one mutex.
- **Netpoll** is non-blocking (`netpoll(0)`). It returns ready Gs without sleeping. Result list goes through `injectglist` to be spread across LRQs.
- **Stealing** happens only if this M is "spinning" or eligible to spin. The spin condition limits CPU burn.
- **Park** when nothing is found anywhere.

After parking, when the M is woken, control jumps back to `top` and the cycle repeats.

---

## LRQ Layout

The LRQ is a fixed-size circular array. Definition in `runtime/runtime2.go`:

```go
type p struct {
    // ...
    runqhead uint32           // atomic
    runqtail uint32           // atomic
    runq     [256]guintptr    // the queue
    runnext  guintptr         // single-slot "next" cache
    // ...
}
```

- **`runq`**: 256-slot ring buffer of `*g` pointers.
- **`runqhead`**: atomic index where thieves take from (head = older entries).
- **`runqtail`**: atomic index where the owner pushes onto (tail = newer entries).
- **`runnext`**: a single-slot "hot G" cache. When a G yields and the runtime expects to run another G immediately, the next G goes into `runnext` rather than the queue tail. `runnext` is checked first by `runqget`.

The capacity is 256 because:
- 2 KB (256 × 8 bytes for pointers) fits in two L1 cache lines.
- Larger queues mean longer worst-case steal latency.
- Smaller queues cause more frequent GRQ overflow on bursty producers.

### Indices and the modulo

`runqhead` and `runqtail` are 32-bit counters that *never wrap to zero* — they grow monotonically. To map to a slot, the code does:

```go
slot := runq[head % 256]
```

Since 256 is a power of two, the modulo is a bitwise AND. The 32-bit counter overflows after ~4 billion ops; on a hot LRQ that happens after about a year of nonstop running. The runtime handles the wraparound correctly via unsigned arithmetic.

### `runnext` semantics

When goroutine A is running and yields to spawn goroutine B (e.g., `go work()`), the runtime puts B into `runnext` so it runs next. This is faster than queue push/pop and preserves cache locality (A's data may still be relevant to B).

`runnext` is not stolen by thieves *until* this M has run for a while without picking it up. Specifically, `runqgrab` (the thief-side function) takes from the queue head only; `runnext` is left alone unless the queue is empty *and* the owner has not used `runnext` for one scheduler tick.

This protects the most recently created G from being immediately stolen — which would defeat the cache locality optimisation.

---

## `runqsteal`: The Move

The actual G-moving code:

```go
// runtime/proc.go (paraphrased)
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

What happens:

1. The thief's P (`pp`) has empty LRQ. It picks a victim `p2`.
2. `runqgrab(p2, &pp.runq, t, ...)` atomically pulls up to half of `p2`'s LRQ into `pp.runq` starting at offset `t`.
3. The grabbed Gs are now in `pp.runq` but not yet visible — `pp.runqtail` has not been updated.
4. The thief reserves one G for itself to run immediately (`gp`).
5. If more than one was grabbed, the rest become part of `pp`'s LRQ: `runqtail` is bumped.

The "atomic move" inside `runqgrab` is the key trick. The thief reads `h := atomic.LoadAcq(&p2.runqhead)` and `t := atomic.LoadAcq(&p2.runqtail)`. It computes `n := (t - h) / 2` (the half). Then it does `atomic.CasRel(&p2.runqhead, h, h+n)`. If the CAS succeeds, the thief has "reserved" those n slots; it copies them into its own LRQ. If the CAS fails (another thief or the owner moved `runqhead`), the thief retries.

Race-free: the CAS ensures only one thief succeeds in claiming a particular range. The owner pushes via `runqtail` only, so it cannot conflict with the head-CAS.

---

## Spinning Ms

A spinning M is an M that:

- Has no goroutine currently running.
- Has no P bound (well, it has one — the spinning state requires a P).
- Is actively calling `findRunnable` in a loop.
- Is *not* parked on a futex.

The spin keeps the CPU "hot" and reactive. When new work arrives anywhere in the system, a spinning M finds it within a microsecond.

### Why spin instead of park?

Parking an M means a futex syscall (a few hundred nanoseconds) and an OS context switch. Waking that M later costs another futex roundtrip — another few hundred ns. Total parking + wake: ~1–2 μs.

If new work is going to arrive within 100 μs, parking is a lose. Spinning for 100 μs costs ~10% of one core but avoids the context-switch hit. Empirically, in typical Go programs, work arrives within 10–100 μs of stealing — so spinning is profitable.

### The spinning state field

`mp.spinning` (a boolean on the M struct). Transitions:

```
not spinning ── becomeSpinning() ──> spinning
spinning ── found work ──> not spinning + sched.nmspinning--
spinning ── no work after rounds ──> stop M, transition to parked
```

`becomeSpinning` increments `sched.nmspinning`. When the spinning M finds work, it decrements and clears the flag.

### Spin budget

To avoid all Ms spinning forever, the runtime caps the number of spinning Ms. The cap is roughly `gomaxprocs / 2`. The check in `findRunnable`:

```go
if mp.spinning ||
   2*atomic.Load(&sched.nmspinning) < gomaxprocs - atomic.Load(&sched.npidle) {
    // OK to spin
}
```

Translated: "Spin if I am already spinning, *or* if fewer than half of the non-idle Ps have a spinning M." This keeps `nmspinning <= (gomaxprocs - npidle) / 2`.

### Spin rounds

A spinning M does multiple passes over all Ps:

```go
// runtime/proc.go: stealWork (paraphrased)
for i := 0; i < 4; i++ {
    for ; enum.next() != enum.done(); {
        pp2 := allp[enum.position()]
        if pp == pp2 { continue }
        if pp2.runqhead != pp2.runqtail {
            // attempt steal
            if gp := runqsteal(pp, pp2, stealTimersOrRunNextG); gp != nil {
                return gp
            }
        }
    }
}
```

Up to 4 passes, each pass walks all Ps starting from a random offset. So a thief checks up to `4 * (GOMAXPROCS-1)` victims before giving up. With GOMAXPROCS=8, that is 28 attempts in the worst case.

The four-pass loop also looks at timers on each P and may steal expired timers (not just runnable Gs). That makes `findRunnable` the central authority for both Gs and timer-driven wakeups.

---

## `nmspinning` Counter

`sched.nmspinning` is an atomic 32-bit counter. Invariants:

1. `nmspinning >= 0` always.
2. If any P has runnable work, `nmspinning >= 1` (unless an M is actively transitioning).
3. `nmspinning <= gomaxprocs` always (each M can only be spinning once).

Transitions:

| Event | Effect |
|---|---|
| `becomeSpinning` | `nmspinning++` |
| Spinning M finds work | `nmspinning--`, `m.spinning = false` |
| Spinning M parks (no work) | `nmspinning--` |
| New work arrives, no spinner exists | `wakep()` may start a spinner |

The counter is read in many places to decide whether to start a new spinner. Heavy contention on this counter is rare because writes are infrequent compared to other scheduler ops.

---

## `wakep` and the Spin Invariant

`wakep` is called whenever new work is created and we suspect no spinning M exists. From `runtime/proc.go`:

```go
func wakep() {
    // Be conservative: only one wakeup at a time.
    if atomic.Load(&sched.nmspinning) != 0 ||
       !atomic.Cas(&sched.nmspinning, 0, 1) {
        return
    }
    // Find an idle P; if none, undo nmspinning increment.
    pp, _ := pidleget(0)
    if pp == nil {
        atomic.Xadd(&sched.nmspinning, -1)
        return
    }
    startm(pp, true, false) // true = spinning
}
```

Behaviour:

1. If a spinning M already exists, do nothing — that spinner will find the work.
2. Otherwise, try to bump `nmspinning` from 0 to 1 atomically. The CAS prevents two callers from both starting a spinner.
3. Find an idle P (an unbound P sitting in `sched.pidle`).
4. If no idle P, revert the increment and return — every P is busy, so no need for an extra spinner.
5. Otherwise, start a new M (from the M-pool or a freshly cloned thread) in spinning state on this P.

### Where `wakep` is called

- After `runqput` (when a G is pushed onto an LRQ).
- After `globrunqput` (when a G is pushed onto the GRQ).
- After `goready` (when a parked G is unparked).
- After `injectglist` (when a list of Gs is reinserted).
- After `netpoll` returns Gs.

Each of these creates runnable work and may need a spinner to find it.

### Why not always wake?

Calling `wakep` on every G creation would dominate the scheduler cost. The CAS-on-zero pattern means: if any spinner is alive, we skip the syscall. In a busy program, `nmspinning > 0` always, and `wakep` returns immediately.

---

## The Global Runqueue Path

The GRQ (`sched.runq`) is a singly-linked list protected by `sched.lock`. Pushes and pops both take the lock.

```go
type schedt struct {
    // ...
    runqsize int32
    runq     gQueue
    runqtail guintptr
    // ...
}
```

### When is the GRQ used?

1. **Overflow** from an LRQ. When `runqput` finds the LRQ full (256 entries), it pushes half of them onto the GRQ via `runqputslow`.
2. **Timer-fired Gs**. `time.AfterFunc` callbacks are pushed to the GRQ.
3. **Long-blocked Gs from netpoll**. The runtime may inject these via `injectglist`.
4. **Goroutines created from a non-P context** (rare; mostly cgo callbacks or runtime internals).

### Fairness: the 1-in-61 rule

To prevent GRQ starvation, the scheduler periodically forces a GRQ check before the LRQ. From `schedule`:

```go
if pp.schedtick%61 == 0 && sched.runqsize > 0 {
    lock(&sched.lock)
    gp := globrunqget(pp, 1)
    unlock(&sched.lock)
    if gp != nil {
        return gp
    }
}
```

Every 61st `schedule()` call on this P, if the GRQ has any work, take one G from it. 61 is a prime chosen to avoid aliasing with other periodic events.

Without this rule, an always-busy LRQ would never look at the GRQ, and timer-fired or injected work could starve.

### `globrunqget`

```go
func globrunqget(pp *p, max int32) *g {
    if sched.runqsize == 0 {
        return nil
    }
    n := sched.runqsize/gomaxprocs + 1
    if n > sched.runqsize { n = sched.runqsize }
    if max > 0 && n > max { n = max }
    if n > int32(len(pp.runq))/2 { n = int32(len(pp.runq)) / 2 }
    sched.runqsize -= n
    gp := sched.runq.pop()
    n--
    for ; n > 0; n-- {
        gp1 := sched.runq.pop()
        runqput(pp, gp1, false)
    }
    return gp
}
```

When called for stealing (not the 61-rule), it pulls up to `runqsize/gomaxprocs + 1` Gs into the local LRQ. This spreads GRQ work across Ps in proportion to GRQ size. The first G is returned to run immediately; the rest go to the LRQ.

---

## `injectglist`: Reinserting Goroutines

When the netpoller returns a list of ready goroutines (or any other path produces a batch), the runtime distributes them via `injectglist`:

```go
func injectglist(glist *gList) {
    if glist.empty() {
        return
    }

    // Mark all as runnable
    var head, tail *g
    qsize := 0
    for gp := glist.head.ptr(); gp != nil; gp = gp.schedlink.ptr() {
        qsize++
        casgstatus(gp, _Gwaiting, _Grunnable)
        if tail == nil { head = gp }
        tail = gp
    }
    // Build a queue
    var q gQueue
    q.head.set(head)
    q.tail.set(tail)
    glist.head = 0
    glist.tail = 0

    // Try to put first onto current P's runnext, rest onto local/global
    pp := getg().m.p.ptr()
    if pp != nil {
        // Spread among other Ps
        npidle := int(atomic.Load(&sched.npidle))
        var n int
        if npidle != 0 && qsize > npidle {
            n = npidle
        } else {
            n = qsize
        }
        // ... push remaining to runq or sched.runq ...
    } else {
        // No P: put all on global runq
        lock(&sched.lock)
        globrunqputbatch(&q, int32(qsize))
        unlock(&sched.lock)
    }

    // Wake up to npidle spinning Ms
    for ; npidle != 0 && qsize != 0; npidle-- {
        startm(nil, true, false)
        qsize--
    }
}
```

Behaviour:

- All Gs in the list go from `_Gwaiting` to `_Grunnable`.
- If a P is available, push a fair share onto it and the rest onto the GRQ.
- If no P is available, push everything onto the GRQ.
- Wake one spinning M per `npidle` (up to as many idle Ps as there are new Gs). This ensures the new work has Ms to run it.

`injectglist` is the runtime's "burst arrival" handler. When 50 sockets become ready at once, `netpoll` returns 50 Gs and `injectglist` spreads them across the system.

---

## Steal Cost Breakdown

A single steal involves:

| Step | Cost |
|---|---|
| Load `victim.runqhead`, `victim.runqtail` | ~5 ns (two atomic loads) |
| Compute `n = (tail - head) / 2` | ~1 ns |
| CAS `victim.runqhead, h, h+n` | ~10 ns (one atomic CAS) |
| `memcpy` n pointers into thief's LRQ | ~5 ns + 0.5 ns/G |
| Update thief's `runqtail` | ~3 ns |
| Total for stealing 4 Gs | ~25 ns |
| Total for stealing 16 Gs | ~35 ns |

But the *finding* cost matters more than the moving cost. A spinning M may iterate through 8–28 victims before finding a non-empty one:

| Phase | Cost |
|---|---|
| Per-victim peek (load runqhead, runqtail) | ~3 ns |
| Per spin round (8 Ps) | ~25 ns |
| Failed spin (4 rounds, all empty) | ~100 ns |
| Successful spin (find on first try) | ~5 ns + steal cost = ~30 ns |

In contrast, parking and waking an M costs ~1 μs (futex roundtrip). So spinning is profitable if work arrives within ~30 cycles of stealing — which is almost always the case in real programs.

### When stealing fails

If 4 full passes complete with no steal, the M parks. The parked M holds no P; the P returns to `sched.pidle`. Total cost of failed find-and-park: a few microseconds. The M waits on a futex until `wakep` (or sysmon-triggered wakeup) revives it.

---

## Summary

At the middle level, work stealing has gone from "an algorithm" to "a sequence of operations with measurable costs." Key takeaways:

- `findRunnable` checks sources in fixed order: local LRQ, GRQ (with periodic priority via the 61-rule), netpoll, then steal × 4.
- The LRQ is a 256-slot circular buffer with `runqhead` (thieves) and `runqtail` (owner) indices.
- `runqsteal` atomically reserves and copies half of a victim's LRQ.
- Spinning Ms keep latency low; the cap is roughly `gomaxprocs / 2` spinning Ms.
- `nmspinning` is the atomic counter; `wakep` ensures the spin invariant.
- `injectglist` redistributes batches of newly runnable Gs (from netpoll and similar paths) and wakes spinners as needed.
- The 1-in-61 rule prevents GRQ starvation.
- One steal costs ~25 ns; one failed-spin-and-park costs ~1 μs.

The senior level zooms further out: random victim selection theory, comparison with classic Cilk and Tokio, the steal/spin interaction with timers, and how to read scheduler trace events to see all this in action.
