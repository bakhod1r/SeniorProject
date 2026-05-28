# Scheduler Source — Professional

> Focus: the actual code in `runtime/proc.go`, `runtime/asm_amd64.s`, and `runtime/signal_unix.go` at go1.22. The senior tier covered why the scheduler looks the way it does — GMP, preemption, work-stealing as design choices. This tier opens the file and walks the lines: function by function, branch by branch, ending in the assembly that hands control to a goroutine. If you can read `schedule()` and predict what `findRunnable()` returns under load, the rest of the runtime stops being mysterious.

---

## 0. Reading the source

`runtime/proc.go` is ~7 000 lines of C-influenced Go: `//go:nosplit` everywhere, `g0` vs `gp` is load-bearing, comments reference "M0" without defining it. Vocabulary: **M** = OS thread, **P** = logical processor (`GOMAXPROCS` of them), **G** = goroutine, **g0** = the special G that runs scheduler code on each M (separate stack), **gsignal** = the G for signal handlers. Invariant: scheduler code (`schedule`, `findRunnable`, `gopark`, `execute`) runs on `g0`; user code runs on a regular G. Transitions: `mcall` switches G→g0, `gogo` switches g0→G. `getg()` returns whichever G the current M is executing; half the `//go:nosplit` annotations exist because the function might run on `g0`, whose stack does not grow.

File layout (go1.22; line numbers drift release to release): `schedule` ~3300, `findRunnable` ~3450, `execute` ~3700, `gopark`/`goready` ~4200, `entersyscall` ~5000, `exitsyscall` ~5300, `sysmon` ~5600, `startm`/`stopm` ~2600, `runqget`/`runqput`/`runqsteal` ~6100. Assembly counterparts (`gogo`, `mcall`) live in `asm_$GOARCH.s`; async preempt handler in `signal_unix.go`. Anchor on those names; everything else is plumbing.

---

## 1. `schedule()` — the main loop

```go
// from runtime/proc.go (paraphrased, ~3300)
// One round of scheduler: find a runnable G and execute it. Never returns.
func schedule() {
    mp := getg().m
    if mp.lockedg != 0 {                              // LockOSThread binding
        stoplockedm(); execute(mp.lockedg.ptr(), false)
    }
top:
    pp := mp.p.ptr(); pp.preempt = false
    if sched.gcwaiting.Load() { gcstopm(); goto top } // STW pending

    var gp *g; var inheritTime, tryWakeP bool
    if gcBlackenEnabled != 0 {
        gp, tryWakeP = gcController.findRunnableGCWorker(pp, tryWakeP)
    }
    if gp == nil {
        gp, inheritTime, tryWakeP = findRunnable()    // blocks until runnable
    }
    if mp.spinning { resetspinning() }
    if tryWakeP { wakep() }
    if gp.lockedm != 0 { startlockedm(gp); goto top }
    execute(gp, inheritTime)                          // never returns here
}
```

Anatomy: the `top:` label exists so conditions that need fresh state (GC wait, locked-G migration) can re-enter selection from scratch via structured `goto`. `mp.lockedg` handles `runtime.LockOSThread`: a 1-to-1 G↔M binding that leaves this M no choice but to wait for that exact G. `gcstopm` parks until STW finishes. `findRunnable()` does the work and blocks (parks the M) if nothing is runnable. `tryWakeP` is a producer hint that bounds the latency from "G runnable" to "some M is searching." `execute` never returns; it calls `gogo`, which `JMP`s into G's saved PC. Control comes back here only when that G blocks or finishes via another `mcall(schedule)`. `inheritTime` is small but load-bearing — if the G came from `runnext` (immediate successor produced by the previous G), don't charge a new scheduler tick: morally the same unit of work continues.

---

## 2. `findRunnable()` — the priority cascade

The hot path. ~250 lines, paraphrased into ordered steps:

```go
// from runtime/proc.go (paraphrased ~3450)
func findRunnable() (gp *g, inheritTime, tryWakeP bool) {
    mp := getg().m
top:
    pp := mp.p.ptr()
    if sched.gcwaiting.Load() { gcstopm(); goto top }                       // 1
    if fingStatus.Load()&fingWait != 0 { wakefing() /* maybe */ }           // 2
    if pp.schedtick%61 == 0 && sched.runqsize > 0 {                         // 3
        if gp := lockedGlobrunqget(pp, 1); gp != nil { return gp, false, false }
    }
    if gp, inh := runqget(pp); gp != nil { return gp, inh, false }          // 4
    if sched.runqsize != 0 {                                                // 5
        if gp := lockedGlobrunqget(pp, 0); gp != nil { return gp, false, false }
    }
    if netpollinited() && netpollAnyWaiters() {                             // 6
        if list, _ := netpoll(0); !list.empty() {
            gp := list.pop(); injectglist(&list)
            casgstatus(gp, _Gwaiting, _Grunnable)
            return gp, false, false
        }
    }
    if mp.spinning || 2*sched.nmspinning.Load() < gomaxprocs-sched.npidle.Load() { // 7
        if !mp.spinning { mp.becomeSpinning() }
        if gp, inh, _, _, newWork := stealWork(now); gp != nil {
            return gp, inh, false
        } else if newWork { goto top }
    }
    // 8. idle GC mark work; 9. drop P, become idle
    releasep(); pidleput(pp, now)
    if netpollinited() && sched.lastpoll.Swap(0) != 0 {                     // 10
        if list, _ := netpoll(delay); !list.empty() {
            acquirep(pp); gp := list.pop(); injectglist(&list)
            casgstatus(gp, _Gwaiting, _Grunnable)
            return gp, false, false
        }
    }
    stopm(); goto top                                                       // 11
}
```

Why this order:

| Step | Source | Why here |
|---|---|---|
| 3. Every 61st: global runq | tick counter | Starvation prevention; local-only would let global wait forever |
| 4. Local runq | `runqget` | Lock-free, cache-hot G (this P placed it) |
| 5. Global runq | `globrunqget` | Holds G's spilled from full local queues |
| 6. Netpoll (non-blocking) | `netpoll(0)` | Cheap; promotes network-bound G's quickly |
| 7. Work stealing | `stealWork` | Heaviest local operation; capped by spinning-M count |
| 8. Idle GC | `addIdleMarkWorker` | Use idle moments to help GC |
| 10. Blocking netpoll | `netpoll(delay)` | One M sleeps on epoll for the whole P group |
| 11. `stopm()` | futex wait | Nothing else; sleep until `wakep()` |

The number 61 in step 3 is a small prime, avoiding resonance with common burst patterns (every 10, every 60). The spinning-M cap (`2*nmspinning < gomaxprocs - npidle`) bounds stealing: at most half the available Ps may be searching simultaneously, preventing CPU burn on fruitless scans.

---

## 3. The per-P lock-free runqueue

Each P has a 256-slot ring buffer plus a `runnext` slot. The ring is consumed FIFO; `runnext` is a LIFO override for the "just spawned a child" case.

```go
// from runtime/runtime2.go
type p struct {
    runqhead uint32       // consumer side — owner or thief CAS
    runqtail uint32       // producer side — owner only
    runq     [256]guintptr
    runnext  guintptr     // next G to run (LIFO override)
}
```

### 3.1 `runqput` — owner pushes

```go
// from runtime/proc.go (paraphrased ~6100)
func runqput(pp *p, gp *g, next bool) {
    if next {
    retryNext:
        oldnext := pp.runnext
        if !pp.runnext.cas(oldnext, guintptr(unsafe.Pointer(gp))) { goto retryNext }
        if oldnext == 0 { return }
        gp = oldnext.ptr() // kick old runnext into main queue
    }
retry:
    h := atomic.LoadAcq(&pp.runqhead)   // load with acquire
    t := pp.runqtail                    // owner; plain load
    if t-h < uint32(len(pp.runq)) {
        pp.runq[t%uint32(len(pp.runq))].set(gp)
        atomic.StoreRel(&pp.runqtail, t+1)  // publish with release
        return
    }
    if runqputslow(pp, gp, h, t) { return }  // spill half to global
    goto retry
}
```

Correctness rules:

- **`runqtail` is owner-only.** No CAS needed; a release-store publishes the new G.
- **`runqhead` is contended.** Owner reads with acquire to see steals committed by other Ps.
- **Release-store on `runqtail`** ensures the slot write happens *before* a thief sees the new tail. Without it, a thief could read a stale slot.
- **Full queue spills half to global.** `runqputslow` takes `sched.lock` and moves 128 G's — amortised cost ~5 ns/put.

### 3.2 `runqget` — owner pops

```go
func runqget(pp *p) (gp *g, inheritTime bool) {
    for {  // runnext first
        next := pp.runnext
        if next == 0 { break }
        if pp.runnext.cas(next, 0) { return next.ptr(), true } // inheritTime = true
    }
    for {  // main queue
        h := atomic.LoadAcq(&pp.runqhead)
        t := pp.runqtail
        if t == h { return nil, false }
        gp := pp.runq[h%uint32(len(pp.runq))].ptr()
        if atomic.CasRel(&pp.runqhead, h, h+1) { return gp, false }
    }
}
```

The CAS on `runqhead` is required because a thief could be racing. Owner-vs-thief contention is rare (thieves only steal when their own P is empty), so the CAS almost always succeeds on the first try. `runnext` always wins — the "child goroutine just spawned" optimisation, saving a queue hop and preserving cache warmth.

### 3.3 `runqsteal` — thief takes half

```go
// from runtime/proc.go (paraphrased ~6200)
func runqgrab(pp *p, batch *[256]guintptr, bh uint32, stealRunNextG bool) uint32 {
    for {
        h := atomic.LoadAcq(&pp.runqhead)
        t := atomic.LoadAcq(&pp.runqtail)
        n := t - h; n = n - n/2                     // take half (rounded up)
        if n == 0 {
            if stealRunNextG {
                if next := pp.runnext; next != 0 {
                    if pp.status == _Prunning { usleep(3) }   // give owner a chance
                    if !pp.runnext.cas(next, 0) { continue }
                    batch[bh%uint32(len(batch))] = next
                    return 1
                }
            }
            return 0
        }
        if n > uint32(len(pp.runq))/2 { continue }  // inconsistent snapshot, retry
        for i := uint32(0); i < n; i++ {
            batch[(bh+i)%uint32(len(batch))] = pp.runq[(h+i)%uint32(len(pp.runq))]
        }
        if atomic.CasRel(&pp.runqhead, h, h+n) { return n }
    }
}
```

"Steal half" is load balancing — Cilk's textbook rule, inherited unchanged: enough to be worth the sync, not so much that the owner starves. `stealRunNextG` is rate-limited — the thief sleeps 3 µs before stealing `runnext` from a running P, betting the owner consumes it first; this preserves the locality optimisation in the common case.

### 3.4 Protocol summary

```
        head=20                 tail=24
         │                       │
         ▼                       ▼
     ┌──┬──┬──┬──┬──┬──┬──┬──┐
runq │  │..│G3│G4│G5│G6│  │  │     thieves CAS head (acquire)
     └──┴──┴──┴──┴──┴──┴──┴──┘     owner stores tail (release)

Owner put:   load head, store tail (release)          → fast path, no atomic on tail
Owner get:   load tail, CAS head (acquire/release)
Steal:       double-snapshot h/t, CAS head            → contends with owner
```

Tail-release pairs with head-acquire across the producer-consumer boundary. Without those orderings, a thief could read an empty slot a cycle before the store became visible.

---

## 4. `execute()` → `gogo()` — control transfer to a G

```go
// from runtime/proc.go (paraphrased ~3700)
func execute(gp *g, inheritTime bool) {
    mp := getg().m
    mp.curg = gp
    gp.m = mp
    casgstatus(gp, _Grunnable, _Grunning)
    gp.waitsince = 0
    gp.preempt = false
    gp.stackguard0 = gp.stack.lo + stackGuard  // reset stack-overflow trigger
    if !inheritTime { mp.p.ptr().schedtick++ }
    gogo(&gp.sched) // never returns
}
```

`gogo` is assembly — restore state from `Gobuf`, longjmp:

```asm
// from runtime/asm_amd64.s
TEXT runtime·gogo(SB), NOSPLIT, $0-8
    MOVQ    buf+0(FP), BX
    MOVQ    gobuf_g(BX), DX         // target G
    MOVQ    0(DX), CX               // touch first word (fault if zero)
    get_tls(CX)
    MOVQ    DX, g(CX)               // TLS["g"] = target G (getg() returns it)
    MOVQ    DX, R14                 // g register (Go 1.17+ ABI)
    MOVQ    gobuf_sp(BX), SP        // restore SP
    MOVQ    gobuf_ret(BX), AX
    MOVQ    gobuf_ctxt(BX), DX
    MOVQ    gobuf_bp(BX), BP
    MOVQ    $0, gobuf_sp(BX)        // clear (GC hint)
    MOVQ    $0, gobuf_pc(BX)        // ... etc
    MOVQ    gobuf_pc(BX), BX
    JMP     BX
```

In plain English: the `Gobuf` is the G's saved register frame. `gogo` reloads SP, BP, return register, context, *updates the TLS slot* that `getg()` reads, and jumps to the saved PC. After the JMP, the M is running user G — `getg()` no longer returns `g0`.

The `g` register (R14 on amd64 since Go 1.17's register ABI) is a calling-convention contract: every Go function assumes R14 holds the current G. Stack-overflow checks compare `SP` against `R14.stackguard0` — that's why `execute()` resets `stackguard0` before `gogo`. Without that update, the new G appears to be out of stack and triggers a spurious `morestack`.

The return path is the mirror — `mcall` saves the user G's PC/SP/BP into its `Gobuf`, swaps `R14` and `SP` to `g0`'s versions, then calls `fn(g)` on `g0`'s stack:

```asm
// from runtime/asm_amd64.s — mcall(fn func(*g))
TEXT runtime·mcall<ABIInternal>(SB), NOSPLIT, $0-8
    MOVQ    g(R14), AX
    MOVQ    0(SP), BX                       // save caller PC →
    MOVQ    BX, (g_sched+gobuf_pc)(AX)      // gp.sched.pc
    LEAQ    fn+0(FP), BX
    MOVQ    BX, (g_sched+gobuf_sp)(AX)      // gp.sched.sp
    MOVQ    g_m(AX), BX
    MOVQ    m_g0(BX), SI                    // SI = g0
    MOVQ    SI, R14                         // switch g register
    MOVQ    (g_sched+gobuf_sp)(SI), SP      // switch to g0 stack
    PUSHQ   AX                              // push old g as fn arg
    CALL    fn                              // fn(g) on g0
```

Pattern: save user G registers into its `Gobuf`, swap to `g0`'s stack, call the scheduler function (`schedule`, `gopark`, `goexit0`, …) on `g0`. The old G stays parked with its registers in its `Gobuf` until someone schedules it again. This is what "scheduler code runs on g0" means physically: a stack-pointer swap to a per-M dedicated stack.

---

## 5. `gopark()` / `goready()` — block and wake

`gopark` is how a G removes itself from the run queue. Used by channel send/recv, mutex acquire, network read, `time.Sleep`, GC waits — every blocking primitive.

```go
// from runtime/proc.go (paraphrased ~4200)
func gopark(unlockf func(*g, unsafe.Pointer) bool, lock unsafe.Pointer, reason waitReason, ...) {
    mp := acquirem()
    mp.waitlock = lock; mp.waitunlockf = unlockf
    mp.curg.waitreason = reason
    releasem(mp)
    mcall(park_m)               // switch to g0, then run park_m
}

func park_m(gp *g) {
    mp := getg().m
    casgstatus(gp, _Grunning, _Gwaiting)
    dropg()                     // mp.curg = nil; gp.m = nil
    if fn := mp.waitunlockf; fn != nil {
        if ok := fn(gp, mp.waitlock); !ok {
            casgstatus(gp, _Gwaiting, _Grunnable)
            execute(gp, true)   // unlock said "wait condition lost" — resume now
        }
    }
    schedule()
}
```

The `unlockf` callback runs on `g0` *after* the G has transitioned to `_Gwaiting`. That ordering closes the lost-wakeup race: if `unlockf` ran first, a producer could acquire the freed lock, see no waiter (G still `_Grunning`), and skip `goready`; the G would then park and never wake. With the cas-then-unlock order, the producer always sees `_Gwaiting` and issues the wake.

`goready` is the inverse — wakes a parked G:

```go
func ready(gp *g, traceskip int, next bool) {
    mp := acquirem()
    casgstatus(gp, _Gwaiting, _Grunnable)
    runqput(mp.p.ptr(), gp, next)   // next=true: place in runnext, hand off slice
    wakep()                         // ensure some M picks it up
    releasem(mp)
}
```

`runqput(..., next=true)` places the woken G in `runnext` of the current P — so a producer that wakes a consumer hands off the time slice immediately. `wakep()` ensures an idle M picks it up if the current M is busy.

Concrete `unlockf` examples:

| Primitive | `unlockf` does |
|---|---|
| `chan` send/recv | Unlocks `hchan.lock`; counterparty takes it next |
| `sync.Mutex` slow path | Returns `true` (mutex already released by `Lock`) |
| `sync.Cond.Wait` | Releases user lock before park, re-acquires on wake |
| `netpoll` read/write | Returns `true`; wait is on epoll fd |
| `time.Sleep` | Returns `true`; timer wakes via `goready` from timer heap |

Channel parks dominate in practice — every blocked consumer in a busy pipeline is a `gopark` with `chansend`/`chanrecv` as the unlock.

---

## 6. `startm` / `stopm` / `wakep` — M lifecycle

Ms (OS threads) are expensive to create — `pthread_create` is hundreds of microseconds — but cheap to park (futex wait). The runtime keeps an `m.midle` list of parked Ms and prefers wake-from-park to fresh-create.

```go
// from runtime/proc.go (paraphrased ~2600)
func startm(pp *p, spinning bool) {
    lock(&sched.lock)
    if pp == nil { pp, _ = pidleget(0); if pp == nil { return } }
    nmp := mget()                                 // try parked-M list first
    if nmp == nil {
        unlock(&sched.lock)
        newm(spinningFn(spinning), pp, mReserveID())  // → newosproc → clone()
        return
    }
    unlock(&sched.lock)
    nmp.spinning = spinning; nmp.nextp.set(pp)
    notewakeup(&nmp.park)                         // futex wake
}

func stopm() {
    gp := getg()
    lock(&sched.lock); mput(gp.m); unlock(&sched.lock)  // add to idle list
    mPark()                                       // futex sleep until wakeup
    acquirep(gp.m.nextp.ptr()); gp.m.nextp = 0
}

func wakep() {
    if !sched.nmspinning.CompareAndSwap(0, 1) { return }
    if sched.npidle.Load() == 0 { sched.nmspinning.Add(-1); return }
    if mp := mget(); mp != nil {
        mp.spinning = true; notewakeup(&mp.park); return
    }
    startm(nil, true)
}
```

The "spinning M" optimisation is the subtle part. A spinning M has no work yet but is actively looking (running the steal loop in `findRunnable`). The runtime caps spinning Ms at `nmspinning < gomaxprocs/2` to bound CPU spent on stealing scans, while maintaining the invariant *nmspinning ≥ 1 whenever any runnable work and any idle P coexist*, so fresh work gets discovered without every M waking.

`wakep` is called whenever a G becomes runnable (channel send, network ready, timer fire). It is a hint, not a command — the spinning M will find the work via the normal cascade. The hint just bounds the latency from "G is runnable" to "some M is searching."

Thread creation cost matters here: `newm → newosproc → clone()` is ~200 µs. A burst of goroutine creation that exhausts the parked-M pool triggers thread spawns and a corresponding latency spike. Cause: massive goroutine burst at startup, sudden CGO surge (each blocking CGO call ties up an M).

---

## 7. `sysmon()` — the daemon

```go
// from runtime/proc.go (paraphrased ~5600)
// Runs without a P, in a permanent loop. Started by runtime.main.
func sysmon() {
    idle, delay := 0, uint32(0)
    for {
        if idle == 0 { delay = 20 } else if idle > 50 { delay *= 2 }
        if delay > 10*1000 { delay = 10 * 1000 }              // 20 µs → 10 ms
        usleep(delay)

        if gcTrigger{kind: gcTriggerTime, now: nanotime()}.test() && forcegc.idle.Load() {
            injectglist(&forcegcList)                          // periodic forced GC
        }
        if netpollinited() && sched.lastpoll.Load()+10e6 < now {
            sched.lastpoll.Store(now)
            if list, _ := netpoll(0); !list.empty() { injectglist(&list) }
        }
        if retake(now) != 0 { idle = 0 } else { idle++ }
        scavenger.wake()
    }
}

func retake(now int64) uint32 {
    for _, pp := range allp {
        switch pp.status {
        case _Psyscall:                                       // blocked syscall
            if pp.syscallwhen+10e6 > now { continue }
            if atomic.Cas(&pp.status, _Psyscall, _Pidle) { handoffp(pp) }
        case _Prunning:                                       // long-running G
            if pp.sysmontick.schedwhen+forcePreemptNS > now { continue }
            preemptone(pp)                                    // sets preempt flags + SIGURG
        }
    }
}
```

`sysmon` runs on its own M, without a P (so it doesn't compete with scheduled work). Variable-delay backoff (20 µs → 10 ms) keeps idle systems quiet. Responsibilities:

| Job | Cadence | Mechanism |
|---|---|---|
| Force GC | every 2 minutes | inject force-gc G |
| Background scavenger | as needed | `scavenger.wake()` |
| Poll netpoll | every 10 ms | `netpoll(0)` + `injectglist` |
| Retake P from syscall | after ~10 ms blocked | `handoffp` |
| Preempt long-running G | after 10 ms | `preemptone` (async signal) |

The 10 ms threshold is the source of the "Go scheduler tick" you see in trace tooling. Below 10 ms, `sysmon` does nothing; above 10 ms, a G that hasn't yielded gets a SIGURG.

---

## 8. Async preemption

Before go1.14, Go preempted only at function prologues (stack-growth check). Tight loops without function calls could starve the scheduler. Go 1.14 added async preemption via signals: `sysmon → preemptone → preemptM → signal handler → asyncPreempt`.

```go
// from runtime/preempt.go (paraphrased)
func preemptone(pp *p) bool {
    gp := pp.m.ptr().curg
    if gp == nil || gp == pp.m.ptr().g0 { return false }
    gp.preempt = true
    gp.stackguard0 = stackPreempt        // function prologue check trips on next call
    if preemptMSupported && debug.asyncpreemptoff == 0 {
        pp.preempt = true
        preemptM(pp.m.ptr())             // → signalM(mp, _SIGURG)
    }
    return true
}

// from runtime/signal_unix.go
const sigPreempt = _SIGURG               // SIGURG: TCP OOB; effectively unused in modern Go

func doSigPreempt(gp *g, ctxt *sigctxt) {
    if wantAsyncPreempt(gp) {
        if ok, newpc := isAsyncSafePoint(gp, ctxt.sigpc(), ctxt.sigsp(), ctxt.siglr()); ok {
            ctxt.pushCall(funcPC(asyncPreempt), newpc)   // synth call; resumes at newpc
        }
    }
}
```

Flow: `sysmon` (P running > 10 ms) → `preemptone` (sets `gp.preempt`, `gp.stackguard0 = stackPreempt`) → `preemptM` (`tgkill(thread, SIGURG)`) → signal delivered → `sighandler → doSigPreempt` checks `isAsyncSafePoint` (PC in non-`//go:nosplit` code, no runtime lock, stack unwindable) → rewrites saved PC via `pushCall(asyncPreempt, originalPC)` → `sigreturn` runs `asyncPreempt` on the G's stack → `asyncPreempt2` → `mcall(gopreempt_m)` → `schedule()` picks next G.

`isAsyncSafePoint` is the gatekeeper: code in syscalls, in assembly, in the GC, or in the runtime itself is not a safe point — preemption is deferred until execution naturally returns to user G code. The `pushCall` trick is elegant: rather than redirecting PC destructively, the handler synthesises a function call into `asyncPreempt`; when that function returns (via `gopreempt_m`), the saved return address is the original PC. SIGURG was chosen because the POSIX semantic (out-of-band TCP data) is effectively unused in modern programs.

---

## 9. `entersyscall` / `exitsyscall`

A syscall blocks the M but should not block the P. The runtime detaches P at entry, reattaches (or hands off) at exit.

```go
// from runtime/proc.go (paraphrased ~5000)
//go:nosplit
func reentersyscall(pc, sp uintptr) {
    gp := getg()
    gp.stackguard0 = stackPreempt                       // no preempt during transition
    casgstatus(gp, _Grunning, _Gsyscall)
    pp := gp.m.p.ptr()
    pp.m = 0; gp.m.oldp.set(pp); gp.m.p = 0             // remember P
    atomic.Store(&pp.status, _Psyscall)
}

//go:nosplit
func exitsyscall() {
    gp := getg()
    oldp := gp.m.oldp.ptr(); gp.m.oldp = 0
    if exitsyscallfast(oldp) {                          // fast path: reclaim same P
        casgstatus(gp, _Gsyscall, _Grunning)
        gp.m.p.ptr().syscalltick++
        gp.stackguard0 = gp.stack.lo + stackGuard
        return
    }
    mcall(exitsyscall0)                                 // slow path → schedule
}
```

P state machine: `_Prunning → entersyscall → _Psyscall → exitsyscallfast → _Prunning` if < 10 ms; otherwise `sysmon → handoffp → _Pidle → startm` picks up a new M.

`entersyscall` is the fast path for syscalls expected to return quickly (most reads/writes on local files, `clock_gettime`). The P stays in `_Psyscall`; M reclaims it with one CAS on return. For known-blocking syscalls, the wrapper calls `entersyscallblock` instead, which immediately hands off. The `net` package goes through `netpoll` rather than direct syscalls — `netpoll` parks the G without touching the M's P at all. The `oldp` pointer is what makes "P stickiness" work: the M tries the same P first, preserving per-P caches.

---

## 10. P-attached caches: `mcache`, `pcache`

Each P owns an `mcache` (allocator size-class cache) and a `pageCache` (page allocator hint). These travel *with the P*, not the M.

```go
// from runtime/runtime2.go
type p struct {
    mcache *mcache    // per-P allocator cache (size-class spans)
    pcache pageCache  // 64-page hint to avoid the heap-wide lock
    // deferpool, sudogcache, gcMarkWorkerMode, ...
}

// from runtime/proc.go
func acquirep(pp *p)       { wirep(pp); pp.mcache.prepareForSweep() }
func releasep() *p         { /* unwire; mcache and pcache stay with the P */ }
```

Implication: allocations during user code use *this P's* mcache. When work-stealing migrates a G across Ps, the next allocation comes from a different mcache — usually fine, occasionally a cache thrash if the G allocates heavily right after migration. `procresize` (GOMAXPROCS changes, boot) creates/destroys Ps; reducing GOMAXPROCS hands the old P's mcache contents back to the central allocator via `mcache.releaseAll`.

---

## 11. Commit walkthrough: go1.21 moves timers into Ps

go1.21 ("runtime: move timer goroutine into Ps") rewrote how timers integrate with the scheduler. Before 1.21, a dedicated timer goroutine slept on the soonest timer in a global heap. After 1.21, each P owns a timer heap, and `findRunnable` checks expired timers as part of its scan.

```go
// pre-1.21: one goroutine, global heap
func timerproc() {
    for {
        lock(&timers.lock); t := timers.heap[0]
        if t.when > nanotime() {
            unlock(&timers.lock)
            gopark(unlockTimers, &timers.lock, waitReasonTimerGoroutineIdle, ...)
            continue
        }
        /* pop, run t.f */
    }
}

// 1.21+: per-P heap; findRunnable inline-checks
type p struct {
    timers     []*timer
    timer0When atomic.Int64    // earliest expiry; 0 if none
}
// inside findRunnable:
if w := pp.timer0When.Load(); w > 0 && w <= now {
    if gp := runtimer(pp, now); gp != nil { return gp, false, false }
}
// stealWork also steals expired timers from busy Ps.
```

The diff was ~3 000 lines across `proc.go`, `time.go`, `runtime2.go`. Effects:

- **Latency.** Pre-1.21, timer-wakeup latency was bounded by the timer goroutine's `gopark`/`goready` round trip — 20–50 µs. Post-1.21, the P checks its own heap inline during `findRunnable` — sub-microsecond when there's other work.
- **Scaling.** The global heap was a contention point at high timer rates (100k `time.AfterFunc`/s from network deadlines). Per-P heaps spread the load.
- **Stealing.** Idle Ps now steal expired timers, keeping every P useful.

User-visible API didn't change. The commit is a textbook example of co-design: `time.After`/`context.WithTimeout` are identical from the outside, but the integration moved from "separate goroutine talking to scheduler" to "scheduler walks the same data structure during its normal scan."

---

## 12. Reading order

First pass through `runtime/proc.go`:

1. `runtime2.go` — type definitions (`g`, `m`, `p`, `schedt`, `Gobuf`). Re-read until register save/restore makes sense.
2. `runtime/HACKING.md` — contributor conventions: `//go:nosplit`, `g0`, `systemstack`, allocation rules.
3. `schedule` (~3300) — shape of one round.
4. `findRunnable` (~3450) — the cascade. Skip GC/finalizer branches first; focus on local → global → netpoll → steal.
5. `runqget` / `runqput` / `runqsteal` (~6100) — until head/tail acquire/release is unambiguous.
6. `execute` → `gogo` (proc.go ~3700, asm_amd64.s) — scheduler-to-user-code transition.
7. `gopark` / `park_m` / `ready` (~4200) — the blocking primitive.
8. `entersyscall` / `exitsyscall` (~5000) — P detach/reattach.
9. `startm` / `stopm` / `wakep` / `newm` (~2600) — M lifecycle.
10. `sysmon` (~5600) — daemon responsibilities.
11. `preemptone` / `doSigPreempt` / `asyncPreempt` (preempt.go, signal_unix.go, asm_amd64.s) — async preemption.
12. `procresize` (~1500) — GOMAXPROCS changes.

After this, the rest of `proc.go` is GC-worker integration, traceback support, and edge cases (locked Ms, race-detector hooks, profiling). Read those when something breaks.

---

## Further reading

- Dmitry Vyukov, *Scalable Go Scheduler Design Doc* (2012) — original GMP proposal; bones intact.
- Austin Clements, *Proposal: Non-cooperative goroutine preemption* (golang/proposal#24543) — async preemption design, safe-point reasoning, SIGURG choice.
- `runtime/HACKING.md` — contributor conventions: `//go:nosplit`, `mcall`, `systemstack`, write barriers, allocation rules.
- `runtime/proc.go` itself — comments are dense but accurate; the block comment above `schedule()` rewards re-reading.
- `runtime/asm_amd64.s` — `gogo`, `mcall`, `systemstack`, `asyncPreempt`: ~200 lines holding the runtime together.
- `runtime/runtime2.go` — `g`, `m`, `p`, `schedt`, `Gobuf` type definitions.
- `runtime/preempt.go` + `runtime/signal_unix.go` — async preemption from request to handler.
- `runtime/netpoll.go` + `runtime/netpoll_epoll.go` — how `netpoll` integrates with `findRunnable`.
- Release notes: 1.14 (async preempt), 1.17 (register ABI — affects `gogo`/`mcall`), 1.21 (per-P timers).
- Russ Cox, *Go scheduler at GopherCon 2017* — whiteboard walkthrough.
- golang.org/issue search for "scheduler" — every non-trivial change has a design discussion attached.

The scheduler stops being mysterious when `schedule → findRunnable → execute → gogo` becomes a single mental image and you can trace a channel send from `chansend` through `goready` to a thief's `runqsteal`. After that, GC, allocator, netpoller are just more subsystems that integrate with the same hooks you now know.
