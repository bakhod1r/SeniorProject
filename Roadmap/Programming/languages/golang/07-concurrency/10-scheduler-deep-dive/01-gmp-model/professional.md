# The G-M-P Model — Professional

[← Back to index](index.md)

## Table of Contents
1. [Introduction](#introduction)
2. [Source Layout](#source-layout)
3. [Reading `g` Field by Field](#reading-g-field-by-field)
4. [Reading `m` Field by Field](#reading-m-field-by-field)
5. [Reading `p` Field by Field](#reading-p-field-by-field)
6. [Reading `schedt` Field by Field](#reading-schedt-field-by-field)
7. [`newproc` Line by Line](#newproc-line-by-line)
8. [`schedule` Line by Line](#schedule-line-by-line)
9. [`findrunnable` Walk-Through](#findrunnable-walk-through)
10. [`runqput`, `runqget`, `runqsteal` — the Atomic Protocol](#runqput-runqget-runqsteal-the-atomic-protocol)
11. [`gopark` and `goready` Internals](#gopark-and-goready-internals)
12. [`wakep` and the Spinning Cap](#wakep-and-the-spinning-cap)
13. [`stopm` and `startm`](#stopm-and-startm)
14. [`pidleget`, `pidleput`, `mput`, `mget`](#pidleget-pidleput-mput-mget)
15. [Lock Ranks and Invariants](#lock-ranks-and-invariants)
16. [Version-by-Version Evolution](#version-by-version-evolution)
17. [Reading Path for Maximum Yield](#reading-path-for-maximum-yield)
18. [Summary](#summary)

---

## Introduction

The professional level is where the runtime stops being a black box. You read `src/runtime/runtime2.go` for the structs and `src/runtime/proc.go` for the scheduler logic, and you know — for any line of your Go program — which function in the runtime executes when, on which goroutine. This document walks the canonical paths in order.

References are to Go 1.22 source; line numbers approximate. The struct names and field positions have been broadly stable since Go 1.5 (when the runtime was rewritten in Go from C); cosmetic changes happen each release but the model is unchanged.

---

## Source Layout

```
src/runtime/
    runtime2.go        — struct definitions for g, m, p, schedt, sudog, ...
    proc.go            — schedule, findrunnable, newproc, gopark, ready, ...
    asm_amd64.s        — gogo, mcall, systemstack assembly
    chan.go            — channels (calls gopark/goready)
    mheap.go, mcache.go, mcentral.go — allocator (uses P-local mcache)
    sema.go, lock_futex.go — semaphores, futex notes
    sigqueue.go        — signal forwarding
    sys_linux_amd64.s  — clone(2) and syscall stubs
```

`runtime2.go` is the data structure file. `proc.go` is by far the largest source file at ~5000 lines; it contains the entire scheduler. Everything you read in this document maps to those two files unless otherwise noted.

---

## Reading `g` Field by Field

From `runtime/runtime2.go` (around line 400):

```go
type g struct {
    // Stack parameters.
    // stack describes the actual stack memory: [stack.lo, stack.hi).
    // stackguard0 is the stack pointer compared in the Go stack growth prologue.
    // It is stack.lo+StackGuard normally, but can be StackPreempt to trigger a preemption.
    // stackguard1 is the stack pointer compared in the C stack growth prologue.
    // It is stack.lo+StackGuard on g0 and gsignal stacks.
    // It is ~0 on other goroutine stacks, to trigger a call to morestackc.
    stack       stack   // offset known to runtime/cgo
    stackguard0 uintptr // offset known to liblink
    stackguard1 uintptr // offset known to liblink

    _panic    *_panic // innermost panic - offset known to liblink
    _defer    *_defer // innermost defer
    m         *m      // current m; offset known to arm liblink
    sched     gobuf
    syscallsp uintptr // if status==Gsyscall, syscallsp = sched.sp to use during gc
    syscallpc uintptr // if status==Gsyscall, syscallpc = sched.pc to use during gc
    stktopsp  uintptr // expected sp at top of stack, to check in traceback

    // param is a generic pointer parameter field used to pass values
    // in particular contexts where other storage for the parameter would be difficult to find.
    param        unsafe.Pointer
    atomicstatus atomic.Uint32
    stackLock    uint32 // sigprof/scang lock; TODO: fold in to atomicstatus
    goid         uint64
    schedlink    guintptr
    waitsince    int64      // approx time when the g become blocked
    waitreason   waitReason // if status==Gwaiting

    preempt       bool // preemption signal, duplicates stackguard0 = stackpreempt
    preemptStop   bool // transition to _Gpreempted on preemption; otherwise, just deschedule
    preemptShrink bool // shrink stack at synchronous safe point

    // asyncSafePoint is set if g is stopped at an asynchronous
    // safe point. This means there are frames on the stack
    // without precise pointer information.
    asyncSafePoint bool

    paniconfault bool // panic (instead of crash) on unexpected fault address
    gcscandone   bool // g has scanned stack; protected by _Gscan bit in status
    throwsplit   bool // must not split stack
    activeStackChans bool
    parkingOnChan    atomic.Bool

    raceignore     int8   // ignore race detection events
    nocgocallback  bool   // whether disable callback from C
    tracking       bool   // whether we're tracking this G for sched latency statistics
    trackingSeq    uint8  // used to decide whether to track this G
    trackingStamp  int64  // timestamp of when the G last started being tracked
    runnableTime   int64  // the amount of time spent runnable, cleared when running, only used when tracking
    lockedm        muintptr
    sig            uint32
    writebuf       []byte
    sigcode0       uintptr
    sigcode1       uintptr
    sigpc          uintptr
    parentGoid     uint64          // goid of goroutine that created this goroutine
    gopc           uintptr         // pc of go statement that created this goroutine
    ancestors      *[]ancestorInfo // ancestor information goroutine(s) that created this goroutine (only used if debug.tracebackancestors)
    startpc        uintptr         // pc of goroutine function
    racectx        uintptr
    waiting        *sudog         // sudog structures this g is waiting on (that have a valid elem ptr); in lock order
    cgoCtxt        []uintptr      // cgo traceback context
    labels         unsafe.Pointer // profiler labels
    timer          *timer         // cached timer for time.Sleep
    selectDone     atomic.Uint32  // are we participating in a select and did someone win the race?

    coroarg *coro // argument during coroutine transfers

    gcAssistBytes int64
}
```

Field roles, grouped:

| Group | Fields | Notes |
|---|---|---|
| Stack | `stack`, `stackguard0`, `stackguard1`, `stktopsp` | Stack bounds; preempt is signalled by poisoning `stackguard0`. |
| Saved regs | `sched gobuf` | Saved when parked; restored by `gogo`. |
| Status | `atomicstatus` | CAS'd between states. |
| Linkage | `schedlink`, `m`, `lockedm`, `waiting`, `param` | Pointers used by the scheduler. |
| Identity | `goid`, `parentGoid`, `gopc`, `startpc` | Tracking, traceback, debugging. |
| Preemption | `preempt`, `preemptStop`, `preemptShrink`, `asyncSafePoint` | See `02-preemption`. |
| Sigs | `sig`, `sigcode0`, `sigcode1`, `sigpc` | Signal forwarding to user. |
| GC | `gcAssistBytes`, `gcscandone` | Per-G GC assist credit. |
| Tracing | `tracking`, `trackingSeq`, `trackingStamp`, `runnableTime` | Scheduler latency tracking. |

The `gobuf`:

```go
type gobuf struct {
    sp   uintptr
    pc   uintptr
    g    guintptr
    ctxt unsafe.Pointer
    ret  uintptr
    lr   uintptr
    bp   uintptr // for framepointer-enabled architectures
}
```

`pc`, `sp`, `bp`, `ret`, `lr` — the saved register set. `ctxt` is the function-value pointer that `gogo` will install in the closure context register. `g` is a back-pointer ensuring resumption restores the right G pointer in TLS.

---

## Reading `m` Field by Field

```go
type m struct {
    g0      *g     // goroutine with scheduling stack
    morebuf gobuf  // gobuf arg to morestack
    divmod  uint32 // div/mod denominator for arm - known to liblink

    // Fields not known to debuggers.
    procid        uint64            // for debuggers, but offset not hard-coded
    gsignal       *g                // signal-handling g
    goSigStack    gsignalStack      // Go-allocated signal handling stack
    sigmask       sigset            // storage for saved signal mask
    tls           [tlsSlots]uintptr // thread-local storage (for x86 extern register)
    mstartfn      func()
    curg          *g       // current running goroutine
    caughtsig     guintptr // goroutine running during fatal signal
    p             puintptr // attached p for executing go code (nil if not executing go code)
    nextp         puintptr
    oldp          puintptr // the p that was attached before executing a syscall
    id            int64
    mallocing     int32
    throwing      throwType
    preemptoff    string // if != "", keep curg running on this m
    locks         int32
    dying         int32
    profilehz     int32
    spinning      bool // m is out of work and is actively looking for work
    blocked       bool // m is blocked on a note
    newSigstack   bool // minit on C thread called sigaltstack
    printlock     int8
    incgo         bool   // m is executing a cgo call
    isextra       bool   // m is an extra m
    isExtraInC    bool   // m is an extra m that is not executing Go code
    isExtraInSig  bool   // m is an extra m in a signal handler
    freeWait      atomic.Uint32 // Whether it is safe to free g0 and delete m (one of freeMRef, freeMStack, freeMWait)
    needextram    bool
    traceback     uint8
    ncgocall      uint64        // number of cgo calls in total
    ncgo          int32         // number of cgo calls currently in progress
    cgoCallersUse atomic.Uint32 // if non-zero, cgoCallers in use temporarily
    cgoCallers    *cgoCallers   // cgo traceback if crashing in cgo call
    park          note
    alllink       *m // on allm
    schedlink     muintptr
    lockedg       guintptr
    createstack   [32]uintptr // stack that created this thread, it's used for StackRecord.Stack0, so it must align with it.
    lockedExt     uint32      // tracking for external LockOSThread
    lockedInt     uint32      // tracking for internal lockOSThread
    nextwaitm     muintptr    // next m waiting for lock

    mLockProfile mLockProfile // fields relating to runtime.lock contention

    // wait* are used to carry arguments from gopark into park_m, because
    // there's no stack to put them on. That is their sole purpose.
    waitunlockf          func(*g, unsafe.Pointer) bool
    waitlock             unsafe.Pointer
    waitTraceBlockReason traceBlockReason
    waitTraceSkip        int

    syscalltick uint32
    freelink    *m // on sched.freem
    trace       mTraceState

    // these are here because they are too large to be on the stack
    // of low-level NOSPLIT functions.
    libcall   libcall
    libcallpc uintptr // for cpu profiler
    libcallsp uintptr
    libcallg  guintptr
    winsyscall winlibcall // stores syscall parameters on windows

    vdsoSP uintptr // SP for traceback while in VDSO call (0 if not in call)
    vdsoPC uintptr // PC for traceback while in VDSO call

    // preemptGen counts the number of completed preemption signals. This is used to detect if a preemption call missed.
    preemptGen atomic.Uint32

    // Whether this is a pending preemption signal on this M.
    signalPending atomic.Uint32

    dlogPerM

    mOS
    chacha8 chacha8rand.State
    cheaprand uint64

    // Up to 10 locks held by this m, maintained by the lock ranking code.
    locksHeldLen int
    locksHeld    [10]heldLockInfo
}
```

Critical fields:

- `g0` — system goroutine for scheduler/GC code; stack is the OS thread's stack.
- `curg` — currently running user G or nil.
- `p`/`nextp`/`oldp` — current, hinted-next, and previously-bound P.
- `park` — futex word for idle parking.
- `spinning`/`blocked` — booleans counted in `sched.nmspinning`/`nmidle`.
- `incgo` — true during a cgo call; sysmon uses this to avoid retaking the P.
- `lockedg`/`lockedExt`/`lockedInt` — LockOSThread bookkeeping.
- `preemptGen`/`signalPending` — async-preemption signal tracking.

The `mOS` field embeds OS-specific fields (e.g., `procid`, `vdso*` on Linux).

---

## Reading `p` Field by Field

```go
type p struct {
    id          int32
    status      uint32 // one of pidle/prunning/...
    link        puintptr
    schedtick   uint32     // incremented on every scheduler call
    syscalltick uint32     // incremented on every system call
    sysmontick  sysmontick // last tick observed by sysmon
    m           muintptr   // back-link to associated m (nil if idle)
    mcache      *mcache
    pcache      pageCache
    raceprocctx uintptr

    deferpool    []*_defer // pool of available defer structs (see panic.go)
    deferpoolbuf [32]*_defer

    // Cache of goroutine ids, amortizes accesses to runtime·sched.goidgen.
    goidcache    uint64
    goidcacheend uint64

    // Queue of runnable goroutines. Accessed without lock.
    runqhead uint32
    runqtail uint32
    runq     [256]guintptr

    // runnext, if non-nil, is a runnable G that was ready'd by
    // the current G and should be run next instead of what's in
    // runq if there's time remaining in the running G's time
    // slice. It will inherit the time left in the current time
    // slice. If a set of goroutines is locked in a
    // communicate-and-wait pattern, this schedules that set as a
    // unit and eliminates the (potentially large) scheduling
    // latency that otherwise arises from adding the ready'd
    // goroutines to the end of the run queue.
    //
    // Note that while other P's may atomically CAS this to zero,
    // only the owner can CAS it to a valid G.
    runnext guintptr

    // Available G's (status == Gdead)
    gFree struct {
        gList
        n int32
    }

    sudogcache []*sudog
    sudogbuf   [128]*sudog

    // Cache of mspan objects from the heap.
    mspancache struct {
        len int
        buf [128]*mspan
    }

    pinnerCache *pinner

    trace pTraceState

    palloc persistentAlloc // per-P to avoid mutex

    // Per-P GC state
    gcAssistTime         int64 // Nanoseconds in assistAlloc
    gcFractionalMarkTime int64 // Nanoseconds in fractional mark worker (atomic)

    // limiterEvent tracks events for the GC CPU limiter.
    limiterEvent limiterEvent

    // gcMarkWorkerMode is the mode for the next mark worker to run in.
    gcMarkWorkerMode      gcMarkWorkerMode
    gcMarkWorkerStartTime int64

    // gcw is this P's GC work buffer cache. The work buffer is
    // filled by write barriers, drained by mutator assists, and
    // disposed on certain GC state transitions.
    gcw gcWork

    // wbBuf is this P's GC write barrier buffer.
    //
    // TODO: Consider caching this in the running G.
    wbBuf wbBuf

    runSafePointFn uint32 // if 1, run sched.safePointFn at next safe point

    // statsSeq is a counter indicating whether this P is currently
    // writing any stats. Its value is even when not, odd when it is.
    statsSeq atomic.Uint32

    // Lock for timers. We normally access the timers while running
    // on this P, but the scheduler can also do it from a different P.
    timersLock mutex

    // Actions to take at some time. This is used to implement the
    // standard library's time package.
    // Must hold timersLock to access.
    timers []*timer

    // Number of timers in P's heap.
    numTimers atomic.Uint32

    // Number of timerDeleted timers in P's heap.
    deletedTimers atomic.Uint32

    // Race context used while executing timer functions.
    timerRaceCtx uintptr

    maxStackScanDelta int64

    // gc-time statistics about current goroutines
    scannedStackSize uint64 // stack size of goroutines scanned by this P
    scannedStacks    uint64 // number of goroutines scanned by this P

    // preempt is set to indicate that this P should be enter the
    // scheduler ASAP (regardless of what G is running on it).
    preempt bool

    // pageTraceBuf is a buffer for writing out page allocation/free/scavenge traces.
    pageTraceBuf pageTraceBuf

    // Padding is no longer needed. False sharing is now not a worry because p is large enough
    // that its size class is an even multiple of the cache line size (for any of our supported
    // architectures).
}
```

Eight sub-systems live inside a P:

1. **Identity and status** — `id`, `status`, `link`, `m`.
2. **Tick counters** — `schedtick`, `syscalltick`, `sysmontick`.
3. **Runqueue** — `runqhead`, `runqtail`, `runq[256]`, `runnext`.
4. **G cache** — `gFree`, `goidcache`, `goidcacheend`.
5. **Sync caches** — `sudogcache`, `sudogbuf`, `deferpool`, `deferpoolbuf`.
6. **Allocator caches** — `mcache`, `pcache`, `mspancache`, `palloc`, `pinnerCache`.
7. **GC state** — `gcAssistTime`, `gcMarkWorkerMode`, `gcw`, `wbBuf`, `scannedStacks`, `scannedStackSize`, `maxStackScanDelta`.
8. **Timers** — `timers`, `timersLock`, `numTimers`, `deletedTimers`, `timerRaceCtx`.

The size of `p` is around 5–6 KiB on 64-bit. It is the largest scheduler struct, justified by the volume of per-P caches.

---

## Reading `schedt` Field by Field

```go
type schedt struct {
    goidgen   atomic.Uint64
    lastpoll  atomic.Int64 // time of last network poll, 0 if currently polling
    pollUntil atomic.Int64 // time to which current poll is sleeping

    lock mutex

    // When increasing nmidle, nmidlelocked, nmsys, or nmfreed, be sure to
    // call checkdead().

    midle        muintptr // idle m's waiting for work
    nmidle       int32    // number of idle m's waiting for work
    nmidlelocked int32    // number of locked m's waiting for work
    mnext        int64    // number of m's that have been created and next M ID
    maxmcount    int32    // maximum number of m's allowed (or die)
    nmsys        int32    // number of system m's not counted for deadlock
    nmfreed      int64    // cumulative number of freed m's

    ngsys atomic.Int32 // number of system goroutines

    pidle        puintptr // idle p's
    npidle       atomic.Int32
    nmspinning   atomic.Int32
    needspinning atomic.Uint32 // See "Delicate dance" comment in proc.go. Boolean. Must hold sched.lock to set to 1.

    // Global runnable queue.
    runq     gQueue
    runqsize int32

    // disable controls selective disabling of the scheduler.
    //
    // Use schedEnableUser to control this.
    //
    // disable is protected by sched.lock.
    disable struct {
        // user disables scheduling of user goroutines.
        user     bool
        runnable gQueue // pending runnable Gs
        n        int32  // length of runnable
    }

    // Global cache of dead G's.
    gFree struct {
        lock    mutex
        stack   gList // Gs with stacks
        noStack gList // Gs without stacks
        n       int32
    }

    // Central cache of sudog structs.
    sudoglock  mutex
    sudogcache *sudog

    // Central pool of available defer structs.
    deferlock mutex
    deferpool *_defer

    // freem is the list of m's waiting to be freed when their
    // m.exited is set. Linked through m.freelink.
    freem *m

    gcwaiting  atomic.Bool // gc is waiting to run
    stopwait   int32
    stopnote   note
    sysmonwait atomic.Bool
    sysmonnote note

    // safepointFn should be called on each P at the next GC
    // safepoint if p.runSafePointFn is set.
    safePointFn   func(*p)
    safePointWait int32
    safePointNote note

    profilehz int32 // cpu profiling rate

    procresizetime int64 // nanotime() of last change to gomaxprocs
    totaltime      int64 // ∫gomaxprocs dt up to procresizetime

    // sysmonlock protects sysmon's actions on the runtime.
    //
    // Acquire and release with sysmon being on its own M makes
    // contended uses of this lock predictable.
    sysmonlock mutex

    // timeToRun is a distribution of scheduling latencies, defined
    // as the sum of time a G spends in the _Grunnable state before
    // it transitions to _Grunning.
    timeToRun timeHistogram

    // idleTime is the total CPU time Ps have "spent" idle.
    //
    // Reset on each GC cycle.
    idleTime atomic.Int64

    // totalMutexWaitTime is the sum of time goroutines have spent in _Gwaiting
    // with a waitreason of the form waitReasonSync{RW,}Mutex{R,}Lock.
    totalMutexWaitTime atomic.Int64
}
```

The `sched` global is the answer to "where do I look up state that is *not* per-P?"

---

## `newproc` Line by Line

From `runtime/proc.go`:

```go
// Create a new g running fn.
// Put it on the queue of g's waiting to run.
// The compiler turns a go statement into a call to this.
func newproc(fn *funcval) {
    gp := getg()
    pc := getcallerpc()
    systemstack(func() {
        newg := newproc1(fn, gp, pc)

        pp := getg().m.p.ptr()
        runqput(pp, newg, true)

        if mainStarted {
            wakep()
        }
    })
}

// Create a new g in state _Grunnable, starting at fn. callerpc is the
// address of the go statement that created this. The caller is responsible
// for adding the new g to the scheduler.
func newproc1(fn *funcval, callergp *g, callerpc uintptr) *g {
    if fn == nil {
        fatal("go of nil func value")
    }

    mp := acquirem() // disable preemption because we hold M and P in local vars.
    pp := mp.p.ptr()
    newg := gfget(pp)
    if newg == nil {
        newg = malg(stackMin)
        casgstatus(newg, _Gidle, _Gdead)
        allgadd(newg) // publishes with a g->status of Gdead so GC scanner doesn't look at uninitialized stack.
    }
    if newg.stack.hi == 0 {
        throw("newproc1: newg missing stack")
    }

    if readgstatus(newg) != _Gdead {
        throw("newproc1: new g is not Gdead")
    }

    totalSize := uintptr(4*goarch.PtrSize + sys.MinFrameSize) // extra space in case of reads slightly beyond frame
    totalSize = alignUp(totalSize, sys.StackAlign)
    sp := newg.stack.hi - totalSize
    spArg := sp
    if usesLR {
        // caller's LR
        *(*uintptr)(unsafe.Pointer(sp)) = 0
        prepGoExitFrame(sp)
        spArg += sys.MinFrameSize
    }

    memclrNoHeapPointers(unsafe.Pointer(&newg.sched), unsafe.Sizeof(newg.sched))
    newg.sched.sp = sp
    newg.stktopsp = sp
    newg.sched.pc = abi.FuncPCABI0(goexit) + sys.PCQuantum
    newg.sched.g = guintptr(unsafe.Pointer(newg))
    gostartcallfn(&newg.sched, fn)
    newg.parentGoid = callergp.goid
    newg.gopc = callerpc
    newg.ancestors = saveAncestors(callergp)
    newg.startpc = fn.fn
    if isSystemGoroutine(newg, false) {
        sched.ngsys.Add(1)
    } else {
        // Only user goroutines inherit pprof labels.
        if mp.curg != nil {
            newg.labels = mp.curg.labels
        }
        if goroutineProfile.active {
            newg.goroutineProfiled.Store(goroutineProfileSatisfied)
        }
    }
    newg.trackingSeq = uint8(cheaprand())
    if newg.trackingSeq%gTrackingPeriod == 0 {
        newg.tracking = true
    }
    gcController.addScannableStack(pp, int64(newg.stack.hi-newg.stack.lo))

    // Get a goid and switch to runnable. Make all this atomic
    // to the tracer.
    trace := traceAcquire()
    var status uint32 = _Grunnable
    if parked {
        status = _Gwaiting
        newg.waitreason = waitreason
    }
    if pp.goidcache == pp.goidcacheend {
        // Sched.goidgen is the last allocated id, this batch must be [sched.goidgen+1, sched.goidgen+GoidCacheBatch].
        pp.goidcache = sched.goidgen.Add(_GoidCacheBatch)
        pp.goidcache -= _GoidCacheBatch - 1
        pp.goidcacheend = pp.goidcache + _GoidCacheBatch
    }
    newg.goid = pp.goidcache
    pp.goidcache++
    casgstatus(newg, _Gdead, status)
    if trace.ok() {
        trace.GoCreate(newg, newg.startpc, parked)
        traceRelease(trace)
    }

    releasem(mp)

    return newg
}
```

Step by step:

1. **`acquirem()`** disables preemption — we are about to read `mp.p`, which would be invalid if we got preempted to another M.
2. **`gfget(pp)`** tries to reuse a dead G from `pp.gFree`. Hit: returns existing G with a stack. Miss: returns nil.
3. **`malg(stackMin)`** allocates a fresh G with a 2-KiB stack. `allgadd` publishes it under `allglock` so GC can find it.
4. **`memclrNoHeapPointers`** zeros `newg.sched` to start clean.
5. **`gostartcallfn`** pushes a "call" frame onto the new G's stack so that when scheduled, it executes `fn`. The return PC is `goexit`, so when `fn` returns, control jumps to `goexit` which cleans up.
6. **`casgstatus(newg, _Gdead, status)`** atomically marks the G as `_Grunnable`.
7. **`runqput(pp, newg, true)`** places on `runnext` (and bumps the previous `runnext` into `runq`).
8. **`wakep()`** wakes an idle P+M pair if available, so the new G has a chance to run in parallel.

---

## `schedule` Line by Line

```go
// One round of scheduler: find a runnable goroutine and execute it.
// Never returns.
func schedule() {
    mp := getg().m

    if mp.locks != 0 {
        throw("schedule: holding locks")
    }

    if mp.lockedg != 0 {
        stoplockedm()
        execute(mp.lockedg.ptr(), false) // Never returns.
    }

    // We should not schedule away from a g that is executing a cgo call,
    // since the cgo call is using the m's g0 stack.
    if mp.incgo {
        throw("schedule: in cgo")
    }

top:
    pp := mp.p.ptr()
    pp.preempt = false

    // Safety check: if we are spinning, the runqueue should be empty.
    // Check this before calling checkTimers, as that might call goready
    // to put a ready goroutine on the local runqueue.
    if mp.spinning && (pp.runnext != 0 || pp.runqhead != pp.runqtail) {
        throw("schedule: spinning with local work")
    }

    gp, inheritTime, tryWakeP := findRunnable() // blocks until work is available

    if debug.dontfreezetheworld > 0 && freezing.Load() {
        // See comment in freezetheworld. We don't want to perturb
        // scheduler state, so we didn't gcstopm in findRunnable, but
        // we aren't going to let this 'g' run unless gp == mp.g0.
        if gp != mp.g0 {
            // We didn't find any user code to run. Just stop the M.
            stopm()
            goto top
        }
    }

    // This thread is going to run a goroutine and is not spinning anymore,
    // so if it was marked as spinning we need to reset it now and potentially
    // start a new spinning M.
    if mp.spinning {
        resetspinning()
    }

    if sched.disable.user && !schedEnabled(gp) {
        // Scheduling of this goroutine is disabled. Put it on
        // the list of pending runnable goroutines for when we re-enable
        // user scheduling and look again.
        lock(&sched.lock)
        if schedEnabled(gp) {
            // Something re-enabled scheduling while we
            // were acquiring the lock.
            unlock(&sched.lock)
        } else {
            sched.disable.runnable.pushBack(gp)
            sched.disable.n++
            unlock(&sched.lock)
            goto top
        }
    }

    // If about to schedule a not-normal goroutine (a GCworker or tracereader),
    // wake a P if there is one.
    if tryWakeP {
        wakep()
    }
    if gp.lockedm != 0 {
        // Hands off own p to the locked m,
        // then blocks waiting for a new p.
        startlockedm(gp)
        goto top
    }

    execute(gp, inheritTime)
}
```

The function does not return; it always ends in `execute`, which switches into the G's code via `gogo`. Control returns to `schedule` only when the G calls `Gosched`, `gopark`, or `goexit`.

---

## `findrunnable` Walk-Through

The actual function is ~250 lines including comments. We will not reproduce it verbatim but list the search order and the gotchas:

```go
func findRunnable() (gp *g, inheritTime, tryWakeP bool) {
    mp := getg().m

top:
    pp := mp.p.ptr()

    // STW check
    if sched.gcwaiting.Load() { gcstopm(); goto top }
    if pp.runSafePointFn != 0 { runSafePointFn() }

    // (1) Local runq, including runnext.
    if gp, inheritTime = runqget(pp); gp != nil {
        return gp, inheritTime, false
    }

    // (2) Global runq.
    if sched.runqsize != 0 {
        lock(&sched.lock)
        gp = globrunqget(pp, 0)
        unlock(&sched.lock)
        if gp != nil { return gp, false, false }
    }

    // (3) Network poller (non-blocking).
    if netpollinited() && netpollAnyWaiters() && sched.lastpoll.Load() != 0 {
        if list, delta := netpoll(0); !list.empty() {
            gp := list.pop()
            injectglist(&list)
            netpollAdjustWaiters(delta)
            casgstatus(gp, _Gwaiting, _Grunnable)
            return gp, false, false
        }
    }

    // (4) Spinning to steal.
    if mp.spinning || 2*sched.nmspinning.Load() < gomaxprocs-sched.npidle.Load() {
        if !mp.spinning {
            mp.becomeSpinning()
        }
        gp, inheritTime, tnow, w, newWork := stealWork(now)
        if gp != nil { return gp, inheritTime, false }
        if newWork { goto top }  // we made it ourselves
    }

    // (5) GC-only Gs.
    if gcBlackenEnabled != 0 && gcMarkWorkAvailable(pp) {
        node := (*gcBgMarkWorkerNode)(gcBgMarkWorkerPool.pop())
        if node != nil { ... return mark worker G ... }
    }

    // (6) Last chance global runq.
    lock(&sched.lock)
    if sched.runqsize != 0 {
        gp := globrunqget(pp, 0)
        unlock(&sched.lock)
        return gp, false, false
    }
    if releasep() != pp { throw("findrunnable: wrong p") }
    now := pidleput(pp, now)
    unlock(&sched.lock)

    // (7) Stop spinning if applicable.
    wasSpinning := mp.spinning
    if mp.spinning {
        mp.spinning = false
        if sched.nmspinning.Add(-1) < 0 {
            throw("findrunnable: negative nmspinning")
        }
        // Final check
        ...
    }

    // (8) Park.
    stopm()
    goto top
}
```

Key invariant: when an M is spinning, no Gs are runnable that it could see. If a G becomes runnable on another P during a steal attempt, the spinning M will see it on the next pass (or `wakep` will wake another M).

Steps (6) and (7) include the "delicate dance" — racing between dropping the P, checking once more, and parking. The full code has detailed comments explaining why each re-check is necessary.

---

## `runqput`, `runqget`, `runqsteal` — the Atomic Protocol

```go
const _RunqMask = 255

// runqput tries to put g on the local runnable queue.
// If next is false, runqput adds g to the tail of the runnable queue.
// If next is true, runqput puts g in the pp.runnext slot.
// If the run queue is full, runnable g is put on the global queue.
// Executed only by the owner P.
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
        if oldnext == 0 {
            return
        }
        // Kick the old runnext out to the regular run queue.
        gp = oldnext.ptr()
    }

retry:
    h := atomic.LoadAcq(&pp.runqhead) // load-acquire, synchronize with consumers
    t := pp.runqtail
    if t-h < uint32(len(pp.runq)) {
        pp.runq[t%uint32(len(pp.runq))].set(gp)
        atomic.StoreRel(&pp.runqtail, t+1) // store-release, makes the item available for consumption
        return
    }
    if runqputslow(pp, gp, h, t) {
        return
    }
    // the queue is not full, now the put above must succeed
    goto retry
}
```

The atomics:

- `runqhead` is accessed by **multiple writers** (the owning P and stealing Ps via CAS).
- `runqtail` is accessed by **a single writer** (the owning P), so it uses `LoadAcq`/`StoreRel` only.
- `runnext` is accessed by **multiple writers** (the owning P and stealing Ps via CAS, only on later steal passes).

`runqputslow`:

```go
func runqputslow(pp *p, gp *g, h, t uint32) bool {
    var batch [len(pp.runq)/2 + 1]*g

    // First, grab a batch from local queue.
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

    if randomizeScheduler {
        for i := uint32(1); i <= n; i++ {
            j := fastrandn(i + 1)
            batch[i], batch[j] = batch[j], batch[i]
        }
    }

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

Half of the LRQ (128 Gs) is moved to the GRQ under `sched.lock`. The "random shuffle" branch (in `randomizeScheduler` race-detector builds) ensures tests don't accidentally depend on FIFO order.

---

## `gopark` and `goready` Internals

`gopark` parks the calling G. `goready` makes a parked G runnable. Together they implement every blocking primitive.

```go
func gopark(unlockf func(*g, unsafe.Pointer) bool, lock unsafe.Pointer, reason waitReason, traceReason traceBlockReason, traceskip int) {
    if reason != waitReasonSleep {
        checkTimeouts()
    }
    mp := acquirem()
    gp := mp.curg
    status := readgstatus(gp)
    if status != _Grunning && status != _Gscanrunning {
        throw("gopark: bad g status")
    }
    mp.waitlock = lock
    mp.waitunlockf = unlockf
    gp.waitreason = reason
    mp.waitTraceBlockReason = traceReason
    mp.waitTraceSkip = traceskip
    releasem(mp)
    // can't do anything that might move the G between Ms here.
    mcall(park_m)
}

// park continuation on g0.
func park_m(gp *g) {
    mp := getg().m

    trace := traceAcquire()

    // N.B. Not using casGToWaiting here because the waitreason is
    // set by park_m's caller.
    casgstatus(gp, _Grunning, _Gwaiting)
    if trace.ok() {
        trace.GoPark(mp.waitTraceBlockReason, mp.waitTraceSkip)
        traceRelease(trace)
    }

    dropg()

    if fn := mp.waitunlockf; fn != nil {
        ok := fn(gp, mp.waitlock)
        mp.waitunlockf = nil
        mp.waitlock = nil
        if !ok {
            // spurious wake — put G back.
            if trace.ok() {
                trace.GoUnpark(gp, 2)
                traceRelease(trace)
            }
            casgstatus(gp, _Gwaiting, _Grunnable)
            execute(gp, true) // never returns.
        }
    }
    schedule()
}
```

`goready`:

```go
// goready marks the G as ready to run.
func goready(gp *g, traceskip int) {
    systemstack(func() {
        ready(gp, traceskip, true)
    })
}

// Mark gp ready to run.
func ready(gp *g, traceskip int, next bool) {
    status := readgstatus(gp)

    // Mark runnable.
    mp := acquirem()
    if status&^_Gscan != _Gwaiting {
        dumpgstatus(gp)
        throw("bad g->status in ready")
    }

    casgstatus(gp, _Gwaiting, _Grunnable)
    runqput(mp.p.ptr(), gp, next)
    wakep()
    releasem(mp)
}
```

The `next=true` argument from `goready` is why channel-driven wake places G in `runnext`. The pattern is so important that `goready` does not even accept `next=false`; callers that want the regular queue use `ready(gp, ..., false)` directly.

---

## `wakep` and the Spinning Cap

```go
// Tries to add one more P to execute G's.
// Called when a G is made runnable (newproc, ready).
// Must be called with a P.
func wakep() {
    // Be conservative about spinning threads, only start one if none exist
    // already.
    if sched.nmspinning.Load() != 0 || !sched.nmspinning.CompareAndSwap(0, 1) {
        return
    }

    // Disable preemption until ownership of pp transfers to the next M in startm.
    // Otherwise preemption here would leave pp stuck in _Pgcstop.
    mp := acquirem()

    var pp *p
    lock(&sched.lock)
    pp, _ = pidlegetSpinning(0)
    if pp == nil {
        if sched.nmspinning.Add(-1) < 0 {
            throw("wakep: negative nmspinning")
        }
        unlock(&sched.lock)
        releasem(mp)
        return
    }
    unlock(&sched.lock)

    startm(pp, true, false)

    releasem(mp)
}
```

Key check: `nmspinning.CAS(0, 1)`. Only one M-wake is allowed at a time globally. If many `wakep` calls race, only the first proceeds; the rest see `nmspinning != 0` and return.

`startm`:

```go
// Schedules some M to run the p (creates an M if necessary).
// If p == nil, tries to get an idle P, if no idle P's does nothing.
func startm(pp *p, spinning bool, lockheld bool) {
    mp := acquirem()
    if !lockheld {
        lock(&sched.lock)
    }
    if pp == nil {
        if spinning {
            // ...
            unlock(&sched.lock)
            releasem(mp)
            return
        }
        pp, _ = pidleget(0)
        if pp == nil {
            if !lockheld { unlock(&sched.lock) }
            releasem(mp)
            return
        }
    }
    nmp := mget()
    if nmp == nil {
        // No M is available, we must drop sched.lock and call newm.
        id := mReserveID()
        unlock(&sched.lock)

        var fn func()
        if spinning {
            fn = mspinning
        }
        newm(fn, pp, id)
        if lockheld { lock(&sched.lock) }
        releasem(mp)
        return
    }
    if !lockheld { unlock(&sched.lock) }
    nmp.spinning = spinning
    nmp.nextp.set(pp)
    notewakeup(&nmp.park)
    releasem(mp)
}
```

The decision tree: idle M available → wake it; otherwise → `newm` creates a new OS thread via `clone(2)`.

---

## `stopm` and `startm`

`stopm` parks the calling M:

```go
// Stops execution of the current m until new work is available.
// Returns with acquired P.
func stopm() {
    gp := getg()

    if gp.m.locks != 0 {
        throw("stopm holding locks")
    }
    if gp.m.p != 0 {
        throw("stopm holding p")
    }
    if gp.m.spinning {
        throw("stopm spinning")
    }

    lock(&sched.lock)
    mput(gp.m)
    unlock(&sched.lock)
    mPark()
    acquirep(gp.m.nextp.ptr())
    gp.m.nextp = 0
}

func mPark() {
    gp := getg()
    notesleep(&gp.m.park)
    noteclear(&gp.m.park)
}
```

`mput` puts the M on `sched.midle`. `notesleep` is a futex wait. `acquirep` binds `m.nextp` to the M (`nextp` was set by whoever woke us).

---

## `pidleget`, `pidleput`, `mput`, `mget`

The idle-list management:

```go
func pidleput(pp *p, now int64) int64 {
    assertLockHeld(&sched.lock)

    if !runqempty(pp) {
        throw("pidleput: P has non-empty run queue")
    }
    if now == 0 {
        now = nanotime()
    }
    updateTimerPMask(pp) // clear timerpMask bit
    idlepMask.set(pp.id)
    pp.link = sched.pidle
    sched.pidle.set(pp)
    sched.npidle.Add(1)
    if !pp.limiterEvent.start(limiterEventIdle, now) {
        throw("pidleput: idle event already started")
    }
    return now
}

func pidleget(now int64) (*p, int64) {
    assertLockHeld(&sched.lock)

    pp := sched.pidle.ptr()
    if pp != nil {
        if now == 0 {
            now = nanotime()
        }
        timerpMask.set(pp.id)
        idlepMask.clear(pp.id)
        sched.pidle = pp.link
        sched.npidle.Add(-1)
        pp.limiterEvent.stop(limiterEventIdle, now)
    }
    return pp, now
}

func mput(mp *m) {
    assertLockHeld(&sched.lock)

    mp.schedlink = sched.midle
    sched.midle.set(mp)
    sched.nmidle++
    checkdead()
}

func mget() *m {
    assertLockHeld(&sched.lock)

    mp := sched.midle.ptr()
    if mp != nil {
        sched.midle = mp.schedlink
        sched.nmidle--
    }
    return mp
}
```

`idlepMask` and `timerpMask` are bitmasks the runtime maintains alongside the list, enabling fast "any idle P?" and "any P has timers?" checks without walking the list.

`checkdead` is called after `mput`: if every G is parked and no Ms can do anything, the runtime prints the famous deadlock fatal.

---

## Lock Ranks and Invariants

From `runtime/lockrank.go` (the relevant ranks for the scheduler):

```go
const (
    lockRankSysmon = lockRank(iota)
    lockRankScavenge
    lockRankForcegc
    lockRankDefer
    lockRankSudog
    lockRankAllg
    lockRankAllp
    lockRankSched
    lockRankAllocmW
    lockRankExecW
    lockRankCpuprof
    lockRankPollDesc
    lockRankWakeableSleep
    lockRankHchan
    lockRankNotifyList
    lockRankSweep
    lockRankMheap
    ...
)
```

`sched.lock` sits in the middle. Channel locks (`hchan.lock`) and heap locks (`mheap.lock`) are above it; sudog/defer pool locks are below. The rule "do not acquire higher-rank locks while holding lower-rank ones" governs every call sequence in the scheduler.

A consequence: channel code releases `hchan.lock` *before* calling `goready`, because `goready` may need `sched.lock` (which is lower-rank). Acquiring `sched.lock` while holding `hchan.lock` would violate the rank order.

---

## Version-by-Version Evolution

| Version | Change |
|---|---|
| Go 1.0 (Mar 2012) | Single global runqueue, single lock. |
| Go 1.1 (Apr 2013) | G-M-P introduced (Vyukov design). Work-stealing scheduler. |
| Go 1.2 | Per-P timer heaps (replacing a global heap). |
| Go 1.5 | Runtime rewritten in Go (was C). `mcache` per-P. Cooperative preemption via `morestack` calls only. |
| Go 1.7 | Net poller integrated into `findrunnable`. |
| Go 1.14 | Async preemption via SIGURG. Loops without function calls now preemptible. |
| Go 1.18 | Internal cleanup; `runnext` semantics formalised. |
| Go 1.21 | Improved scheduler latency tracking via `timeToRun` histogram. |
| Go 1.22 | Cgroup-aware `GOMAXPROCS` proposals begin. |
| Go 1.25 | Default `GOMAXPROCS` reads cgroup CPU quota. |

Each release tweaks heuristics — steal pass count, fairness sip interval, spinning cap, gFree thresholds — but the struct shapes and the core function signatures have not changed since 1.5.

---

## Reading Path for Maximum Yield

If you have an hour, read these in order:

1. `runtime/runtime2.go` lines 380–550 (struct definitions).
2. `runtime/proc.go` `schedule()` (around line 3500).
3. `runtime/proc.go` `findRunnable()` (just after `schedule`).
4. `runtime/proc.go` `runqput`, `runqget`, `runqsteal` (toward the bottom).
5. `runtime/proc.go` `gopark`, `park_m`, `ready` (in the middle of the file).
6. `runtime/proc.go` `newproc`, `newproc1`.

If you have a day, also:

7. `runtime/HACKING.md` — Russ Cox's developer notes.
8. The Vyukov proposal in full.
9. `runtime/lockrank.go` for the rank list.

You will emerge able to read any stack trace in any Go panic and know precisely which scheduler path was active.

---

## Summary

The G-M-P model is implemented by three structs (`g`, `m`, `p`) plus one global (`sched`) defined in `runtime/runtime2.go`, manipulated by a handful of functions in `runtime/proc.go`: `newproc`, `schedule`, `findrunnable`, `runqput`/`runqget`/`runqsteal`, `gopark`/`ready`, `wakep`/`startm`/`stopm`. Every Go program — every `go f()`, every channel send, every `time.Sleep`, every network read — exercises some path through this code. The atomic protocol on the ring-buffer runqueue, the lock-rank discipline, and the spinning-M cap are the three subtleties that make it scalable. Read the source once and the rest of the deep-dive section becomes commentary on what you have already seen.
