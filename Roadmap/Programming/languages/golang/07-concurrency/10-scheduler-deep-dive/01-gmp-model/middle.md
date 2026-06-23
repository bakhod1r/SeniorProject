# The G-M-P Model — Middle

[← Back to index](index.md)

## Table of Contents
1. [What This Page Adds Over Junior](#what-this-page-adds-over-junior)
2. [Recap: Three Letters, Three Structs](#recap-three-letters-three-structs)
3. [The `g` Struct in Practice](#the-g-struct-in-practice)
4. [The `m` Struct in Practice](#the-m-struct-in-practice)
5. [The `p` Struct in Practice](#the-p-struct-in-practice)
6. [The `sched` Global](#the-sched-global)
7. [Local Runqueue vs Global Runqueue](#local-runqueue-vs-global-runqueue)
8. [`runnext` — the Fast-Path Slot](#runnext-the-fast-path-slot)
9. [Idle Lists: `pidle` and `midle`](#idle-lists-pidle-and-midle)
10. [State Transitions of G, M, P](#state-transitions-of-g-m-p)
11. [`newproc` — What `go f()` Becomes](#newproc-what-go-f-becomes)
12. [The Scheduler Loop: `schedule()` in Outline](#the-scheduler-loop-schedule-in-outline)
13. [Per-P Caches in Detail](#per-p-caches-in-detail)
14. [Why P Is Necessary (Pre-vs-Post)](#why-p-is-necessary-pre-vs-post)
15. [Counting Goroutines, Ms, Ps at Runtime](#counting-goroutines-ms-ps-at-runtime)
16. [Reading a Trace](#reading-a-trace)
17. [What to Read Next](#what-to-read-next)

---

## What This Page Adds Over Junior

Junior gave the big picture: G is a goroutine, M is an OS thread, P is the scheduling context, and the three must align for user code to run. Middle is where you start touching the structs themselves, see what fields live inside them, and walk the transitions that happen during one schedule tick. We will not yet open every method in `runtime/proc.go` (that is the senior and professional level), but you will leave able to look at the code and recognise the actors.

---

## Recap: Three Letters, Three Structs

All three are defined in `src/runtime/runtime2.go`:

```go
type g struct { ... }   // a goroutine
type m struct { ... }   // a machine (OS thread)
type p struct { ... }   // a processor (scheduler context)
```

There is also a singleton `schedt` global named `sched` that holds runtime-wide state: the global runqueue, the idle M and P lists, the global lock, GC coordination flags. Together these four — `g`, `m`, `p`, `sched` — are the entire scheduler's data model.

---

## The `g` Struct in Practice

Trimmed to the fields you actually care about:

```go
type g struct {
    stack       stack    // [stack.lo, stack.hi) — the G's stack bounds
    stackguard0 uintptr  // compared against SP for stack overflow / preempt
    stackguard1 uintptr  // same for system stack

    _panic    *_panic
    _defer    *_defer

    m         *m         // current M, or nil
    sched     gobuf      // saved registers when parked
    syscallsp uintptr
    syscallpc uintptr

    param         unsafe.Pointer // passed during park/ready handoffs
    atomicstatus  atomic.Uint32  // _Gidle, _Grunnable, ...
    goid          uint64
    schedlink     guintptr  // intrusive linked-list pointer (for runqueues, idle lists)
    waitsince     int64
    waitreason    waitReason
    preempt       bool   // preemption requested
    preemptStop   bool
    preemptShrink bool

    lockedm    muintptr  // M this G is locked to (LockOSThread)
    sig        uint32
    writebuf   []byte
    sigcode0   uintptr
    sigcode1   uintptr
    sigpc      uintptr
    parentGoid uint64
    gopc       uintptr  // pc of go statement that created this g
    ancestors  *[]ancestorInfo
    startpc    uintptr  // pc of goroutine function
}
```

Status values:

| Status | Meaning |
|---|---|
| `_Gidle` | Just allocated, not yet initialised. |
| `_Grunnable` | Ready to run; sitting in a runqueue. |
| `_Grunning` | Currently executing on an M (uses a P). |
| `_Gsyscall` | The M holding this G entered a syscall. |
| `_Gwaiting` | Parked waiting for a channel/mutex/sleep/IO. |
| `_Gdead` | Terminated; sitting in a free pool, ready to be reused by `newproc`. |
| `_Gcopystack` | Stack is being grown or moved. |
| `_Gpreempted` | Suspended by async preemption. |

A G in `_Grunnable` lives in exactly one runqueue. A G in `_Grunning` lives on no queue; it is the `curg` of some M. A G in `_Gwaiting` lives in some primitive's wait queue (e.g., `hchan.recvq`).

The `gobuf` (in `sched`) saves PC, SP, BP, and a function pointer. When `schedule()` resumes a G, it restores those registers and jumps to PC.

---

## The `m` Struct in Practice

```go
type m struct {
    g0      *g       // goroutine with scheduler stack (~8 KiB on the OS thread)
    morebuf gobuf
    divmod  uint32

    procid     uint64       // OS thread id (TID on Linux)
    gsignal    *g           // signal-handling goroutine
    sigmask    sigset
    tls        [tlsSlots]uintptr // thread-local storage
    mstartfn   func()
    curg       *g           // currently running user G, or nil
    caughtsig  guintptr
    p          puintptr     // attached P, or nil
    nextp      puintptr     // hint for which P to take when waking
    oldp       puintptr     // last P we held
    id         int64
    mallocing  int32
    throwing   throwType
    preemptoff string
    locks      int32
    dying      int32
    profilehz  int32
    spinning   bool          // searching for work; counted in sched.nmspinning
    blocked    bool          // parked on note (futex)
    newSigstack bool
    printlock  int8
    incgo      bool          // currently inside a cgo call
    isextra    bool
    isExtraInC bool

    fastrand   uint64
    needextram bool
    traceback  uint8
    ncgocall   uint64
    ncgo       int32
    cgoCallersUse atomic.Uint32
    cgoCallers *cgoCallers
    park       note          // futex this M parks on when idle
    alllink    *m            // sched.allm chain
    schedlink  muintptr
    lockedg    guintptr      // G this M is locked to (LockOSThread)
    createstack [32]uintptr
    lockedExt   uint32
    lockedInt   uint32
    nextwaitm   muintptr
    mLockProfile mLockProfile
    waitunlockf  func(*g, unsafe.Pointer) bool
    waitlock     unsafe.Pointer
    waittraceev  byte
    waittraceskip int
    startingtrace bool
    syscalltick   uint32
    freelink      *m
    mFixup        mFixup
}
```

Crucial fields:

- `g0` — the system goroutine that owns the M's OS-thread stack. All scheduler code runs here. When you see `runtime.systemstack(fn)` in a trace, the runtime is switching to `g0` to run `fn`.
- `curg` — the user goroutine you would intuitively call "what is running on this thread". May be nil when the M is in scheduler code or parked.
- `p` — the attached P. When `m.p == nil`, the M is not running user Go code.
- `nextp` — set by the runtime when waking an M ("here's a P for you"). The M binds it after waking.
- `spinning` — true while the M is in `findrunnable` actively spinning for work (looking at other Ps, then the global queue, then netpoll, before parking). Capped at `GOMAXPROCS/2` total spinning Ms.
- `park` — the futex word the M sleeps on when idle.

An M's lifecycle in short:
1. Created by `newm()` when an idle P needs work.
2. Starts in `mstart` (assembly), calls `mstart1`, enters the `schedule()` loop.
3. Loops forever, picking Gs and running them.
4. Parks on `park` (futex) when `findrunnable` cannot find work.
5. Wakes when another M or sysmon does `futex_wake(&m.park)`.

Ms are essentially never destroyed in the steady state; the runtime keeps them around as a thread pool. They only die in unusual cases (cgo callback Ms, profile signal handling).

---

## The `p` Struct in Practice

```go
type p struct {
    id          int32
    status      uint32       // _Pidle, _Prunning, _Psyscall, _Pgcstop, _Pdead
    link        puintptr     // chain in sched.pidle
    schedtick   uint32       // increments per schedule call
    syscalltick uint32       // increments per syscall
    sysmontick  sysmontick   // last observed tick by sysmon
    m           muintptr     // back to owning M, or nil
    mcache      *mcache      // per-P allocator cache
    pcache      pageCache    // per-P page cache for spans
    raceprocctx uintptr

    deferpool    []*_defer
    deferpoolbuf [32]*_defer

    goidcache    uint64
    goidcacheend uint64

    // Per-P runnable queue. Accessed without lock.
    runqhead uint32           // atomic; head moves on dequeue
    runqtail uint32           // atomic; tail moves on enqueue
    runq     [256]guintptr    // the ring buffer

    // runnext, if non-nil, is a runnable G that was ready'd by the current G
    // and should be run next instead of what's in runq.
    runnext guintptr

    // Available G's (status == Gdead) — local cache
    gFree struct {
        gList
        n int32
    }

    sudogcache []*sudog
    sudogbuf   [128]*sudog

    mspancache struct {
        len int
        buf [128]*mspan
    }

    pinnerCache *pinner

    trace pTraceState

    palloc persistentAlloc // per-P to avoid mutex

    gcAssistTime         int64
    gcFractionalMarkTime int64

    limiterEvent limiterEvent
    gcMarkWorkerMode gcMarkWorkerMode
    gcMarkWorkerStartTime int64
    gcw gcWork

    wbBuf wbBuf

    runSafePointFn uint32
    statsSeq atomic.Uint32

    timersLock mutex
    timers []*timer
    deletedTimers atomic.Uint32
    timerRaceCtx uintptr

    maxStackScanDelta int64
    scannedStackSize uint64
    scannedStacks    uint64

    preempt bool
    pageTraceBuf pageTraceBuf
}
```

Three groups of fields:

- **Runqueue**: `runqhead`, `runqtail`, `runq[256]`, `runnext`.
- **Caches**: `mcache`, `pcache`, `mspancache`, `deferpool`, `sudogcache`, `gFree`, `goidcache`.
- **Coordination**: `status`, `m`, `link`, `preempt`, `schedtick`.

The runqueue is the most interesting part for now. It is a **ring buffer of 256 slots** indexed by atomic head/tail. Pushes happen on the local M (single producer) and stealing happens from other Ms (multi-consumer); the atomic operations make this safe without a lock.

`runqhead` and `runqtail` are 32-bit values that grow indefinitely; the slot index is `head % 256`. This avoids "wrap-around" ambiguity that a smaller counter would have.

---

## The `sched` Global

```go
type schedt struct {
    goidgen      atomic.Uint64
    lastpoll     atomic.Int64
    pollUntil    atomic.Int64

    lock         mutex

    midle        muintptr // idle M list
    nmidle       int32
    nmidlelocked int32
    mnext        int64
    maxmcount    int32
    nmsys        int32
    nmfreed      int64

    ngsys        atomic.Int32  // number of system goroutines

    pidle        puintptr      // idle P list
    npidle       atomic.Int32
    nmspinning   atomic.Int32

    // Global runnable queue.
    runq         gQueue
    runqsize     int32

    disable struct {
        user      bool
        runnable  gQueue
        n         int32
    }

    // Global cache of dead G's.
    gFree struct {
        lock    mutex
        stack   gList // Gs with stacks
        noStack gList // Gs without stacks
        n       int32
    }

    sudoglock  mutex
    sudogcache *sudog

    deferlock  mutex
    deferpool  *_defer

    // freem is the list of Ms waiting to be freed.
    freem *m

    gcwaiting    atomic.Bool
    stopwait     int32
    stopnote     note
    sysmonwait   atomic.Bool
    sysmonnote   note

    safePointFn   func(*p)
    safePointWait int32
    safePointNote note

    profilehz int32

    procresizetime int64
    totaltime      int64

    sysmonlock mutex

    timeToRun timeHistogram
    idleTime  atomic.Int64
    totalMutexWaitTime atomic.Int64
}
```

The whole runtime has **one** `sched` instance. The `lock` field guards the global runqueue, the idle lists, the `nmspinning` and `npidle` counters, and the M allocation. It is the only "big" lock in the scheduler; the whole local-first design exists to avoid taking it.

---

## Local Runqueue vs Global Runqueue

The local runqueue (LRQ) belongs to a P. The global runqueue (GRQ) belongs to `sched`. The distinction matters in three places:

**Where do new Gs go?**

`newproc` puts a fresh G in the *current* P's LRQ (via `runnext` first, then `runq` if `runnext` was already occupied). If the LRQ is full, half of it plus the new G are moved to the GRQ in one batch under `sched.lock`. This batching amortises the lock cost.

**Where does the scheduler look?**

`schedule()` first tries `runnext`, then the LRQ. Every 61st iteration it dips into the GRQ first instead, to ensure GRQ Gs don't starve. If both LRQ and runnext are empty, `findrunnable` tries the GRQ in batch.

**Why batched moves?**

Taking `sched.lock` is expensive (it's the only contended global lock in the hot path). Moving 128 Gs at a time pays the lock cost once for the whole batch.

A useful invariant: the *total* runnable G count is roughly `sum(p.runq.size) + sched.runqsize`. Live (running) Gs are separate.

---

## `runnext` — the Fast-Path Slot

```go
runnext guintptr
```

A single slot on each P. When a goroutine **wakes another** (most commonly via channel send or `sync.Cond.Signal`), the waker's runtime code places the freshly-readied G into the *current* P's `runnext` slot. The next iteration of `schedule()` runs `runnext` ahead of `runq`.

Why this design?

- **Locality**: if A wakes B, A is probably about to block (channel send → receiver wakes → sender finishes). Running B on the same P keeps it cache-hot.
- **Latency**: a single-slot direct hand-off bypasses both the LRQ and any work-stealing victim search.
- **Channel ping-pong**: the canonical "A→B→A→B" pattern becomes a tight loop on one P.

If `runnext` is already occupied, the *displaced* G is pushed onto the LRQ; the new G takes the slot. This means the "skip" is always at most one G deep, never a queue of priority-boosted Gs.

---

## Idle Lists: `pidle` and `midle`

Two singly-linked lists in `sched`:

- `sched.pidle` — chain of Ps not currently bound to an M. Linked via `p.link`.
- `sched.midle` — chain of Ms parked on their `m.park` note. Linked via `m.schedlink`.

When `newproc` adds a G to a P's runqueue and there are idle Ps and idle Ms, `wakep` is called: pop an idle P, pop an idle M, set `m.nextp = p`, futex-wake `m.park`. The woken M starts at `mstart`, sees `nextp`, attaches to it, and enters `schedule()`.

Three subtle points:

- **An idle P is not idle CPU**. The CPU could be running a different process; the runtime is unaware. An idle P just means "no M is currently using this scheduling slot."
- **Adding a P to pidle does not free its caches**. The P keeps its `mcache`, `sudogcache`, etc., for the next M that grabs it.
- **`nmspinning` bounds the number of spinning Ms**. At most `GOMAXPROCS/2` Ms may be in the spinning state simultaneously. This prevents a thundering herd of Ms burning CPU looking for work.

---

## State Transitions of G, M, P

Each of the three has its own state machine. Here are the most-common transitions you will see in stack traces and tools.

### G transitions (`atomicstatus`)

```
_Gidle ──(after stack alloc)──▶ _Grunnable
_Grunnable ──(picked by schedule)──▶ _Grunning
_Grunning ──(blocks on chan/mutex/sleep)──▶ _Gwaiting
_Grunning ──(enters syscall)──▶ _Gsyscall
_Grunning ──(async preempt)──▶ _Gpreempted
_Gwaiting ──(woken via goready)──▶ _Grunnable
_Gsyscall ──(exits syscall)──▶ _Grunnable (then schedule picks it)
_Gpreempted ──(resumed)──▶ _Grunnable
_Grunning ──(goexit)──▶ _Gdead (returned to gFree pool)
```

### M transitions

```
created ──▶ in mstart ──▶ schedule() loop
schedule ──▶ executing G ──▶ schedule ...
schedule ──(no work)──▶ findrunnable ──(steal/global/netpoll)
findrunnable ──(nothing)──▶ park on m.park (in sched.midle)
parked ──(futex wake)──▶ m.nextp ──▶ schedule
schedule G ──(G enters syscall)──▶ entersyscall (M stays with G, P detaches)
exitsyscall ──(grab nextp)──▶ schedule
```

### P transitions

```
_Pidle ──(picked up by an M)──▶ _Prunning
_Prunning ──(M enters syscall)──▶ _Psyscall
_Psyscall ──(another M grabs P)──▶ _Prunning (under a new M)
_Psyscall ──(original M returns fast)──▶ _Prunning (kept by same M)
_Prunning ──(M parks; no other work)──▶ _Pidle
during STW ──▶ _Pgcstop
GOMAXPROCS shrink ──▶ _Pdead (caches drained)
```

The triple synchronicity: when a P moves from `_Prunning` to `_Pidle` because an M finished schedule loops, the corresponding M moves from active to `_Gwaiting` on its `g0` (or is destroyed if not needed). The two transitions happen together.

---

## `newproc` — What `go f()` Becomes

The compiler turns `go f(args)` into a call to `runtime.newproc(siz, fn)`. Roughly:

```go
func newproc(fn *funcval) {
    gp := getg()                          // the calling G (so we can find its P)
    pc := getcallerpc()
    systemstack(func() {
        newg := newproc1(fn, gp, pc)      // allocate or reuse a G
        pp := getg().m.p.ptr()
        runqput(pp, newg, true)           // place on local runq (true = use runnext)
        if mainStarted {
            wakep()                       // wake an idle P if any
        }
    })
}
```

`newproc1` does the heavy lifting:

1. Try to pop a dead G from `p.gFree`. If present, reset and reuse it (saves a stack allocation).
2. Otherwise allocate: `g` struct + 2-KiB initial stack.
3. Set up `gobuf` so that resuming the G calls `fn`.
4. Mark `_Grunnable`.

`runqput(pp, gp, next)`:

- If `next == true`, swap into `pp.runnext`. The displaced G (if any) goes to the LRQ.
- Otherwise push to `pp.runq` at `runqtail`. If full, call `runqputslow` which moves half the LRQ + the new G to the GRQ.

`wakep`:

- If `npidle > 0 && nmspinning == 0`, find an idle P + idle M, wake the M with `m.nextp` set.

That whole sequence — allocation, status set, runqueue push, possible wake — takes around 100–200 nanoseconds on modern hardware. Cheap.

---

## The Scheduler Loop: `schedule()` in Outline

```go
func schedule() {
    mp := getg().m

top:
    pp := mp.p.ptr()
    pp.preempt = false

    if sched.gcwaiting.Load() {
        gcstopm()
        goto top
    }

    if pp.runSafePointFn != 0 {
        runSafePointFn()
    }

    var gp *g
    var inheritTime, tryWakeP bool

    // Fairness: every 61st schedule, sip from the global queue first.
    if pp.schedtick%61 == 0 && sched.runqsize > 0 {
        lock(&sched.lock)
        gp = globrunqget(pp, 1)
        unlock(&sched.lock)
    }

    if gp == nil {
        gp, inheritTime = runqget(pp)
    }

    if gp == nil {
        gp, inheritTime, tryWakeP = findrunnable()  // blocks until work
    }

    if mp.spinning {
        resetspinning()
    }

    if tryWakeP {
        wakep()
    }

    execute(gp, inheritTime)
}
```

A simplified mental model. The full function is around 100 lines plus comments; we walk it in detail at the professional level. For now, internalise:

- `schedule()` is called by the M after every G finishes or yields.
- It picks the *next* G via a deterministic priority: fairness sip → runnext → runq → findrunnable (which is the slow path).
- `execute()` jumps into the G's code via assembly. It does not return; control comes back to `schedule()` through `goexit` or `mcall(park_m)`.

`findrunnable` is the heart of work discovery. Its order:

1. Local runqueue once more (in case something arrived during a previous step).
2. Global runqueue (batch).
3. Network poller (timers about to fire, ready file descriptors).
4. **Work-stealing**: pick a random P, try to steal half its queue.
5. Global runqueue once more (covered in `04-work-stealing`).
6. Park the M on its `m.park` note, after returning the P to `sched.pidle`.

When the M wakes from park, it returns from `findrunnable` with a G and the loop continues.

---

## Per-P Caches in Detail

P is not just a runqueue. It owns several caches that exist precisely because they should not be globally shared.

**`mcache`** — the per-P memory allocator cache. Small object allocations (size ≤ 32 KiB) take a span from `mcache` without any locks. Larger allocations go to the central allocator (`mcentral`) under a lock. Without per-P mcache, every `new(T)` would be lock-contended.

**`sudogcache`** — a buffer of up to 128 `sudog` structs. When a G parks on a channel or `sync.Cond`, the runtime needs a `sudog`. Allocating one through the global cache would mean a lock; the per-P cache avoids it. Refilled in batches from `sched.sudogcache`.

**`deferpool`** — a buffer of up to 32 `_defer` records. Each `defer` statement allocates one (unless the compiler proves it can elide). Per-P pooling avoids allocations on the defer hot path.

**`gFree`** — a small cache of dead Gs ready to be reused by `newproc`. Refills from `sched.gFree.stack`.

**`mspancache`** — a buffer of 128 `mspan` structs to back `mcache` refills.

**`goidcache`** — a range of pre-reserved goroutine IDs. Avoids atomic-increment on `sched.goidgen` per `go` statement; takes the next ID from the local range, refilling when exhausted.

Each cache exists because *not* having it would put a global lock on the hot path. The cumulative effect: a goroutine creating a goroutine that channel-pings another goroutine touches no global lock at all.

---

## Why P Is Necessary (Pre-vs-Post)

Pre-Go 1.1, the runtime had only G and M. The scheduler kept all runnable Gs in `sched.runq` and protected it with `sched.lock`. Every operation a goroutine did — spawning, parking, waking — contended for that lock.

Symptoms (documented in Vyukov's 2012 proposal):

- Throughput barely improved beyond `GOMAXPROCS=4`.
- A workload that pinged messages between goroutines saw most time burned acquiring `sched.lock`.
- Memory allocator contention was tied to the same lock structure.

The fix was to factor the global state into per-P slices:

- The global runqueue split into one global plus N local. Hot paths use only local.
- The memory allocator's central free lists split into one per P (`mcache`). Hot paths use only local.
- The sudog/defer pools split into per-P.

By making P explicit, the runtime can answer "where do I put this G?" without consulting any global state. The lock is only taken when a P overflows or runs dry — rare events on a healthy system.

After the change, Go scaled smoothly to 64+ cores. The G-M-P model is the direct consequence.

---

## Counting Goroutines, Ms, Ps at Runtime

Public API:

```go
runtime.NumGoroutine()       // count of all Gs (including system Gs)
runtime.GOMAXPROCS(0)        // count of Ps (passing 0 means "read, don't change")
runtime.NumCPU()             // OS-reported CPU count
```

There is **no** `runtime.NumThread()`. The closest available is via `runtime/metrics`:

```go
import "runtime/metrics"

samples := []metrics.Sample{
    {Name: "/sched/goroutines:goroutines"},
    {Name: "/sched/threads:threads"}, // total Ms ever created (not currently alive)
    {Name: "/sched/latencies:seconds"},
    {Name: "/sched/runnable:goroutines"}, // (added in newer Go versions)
}
metrics.Read(samples)
```

The available metric names depend on the Go version; see `runtime/metrics`' documentation.

For deeper inspection, `runtime.SchedTrace`-style output is enabled via:

```
GODEBUG=schedtrace=1000,scheddetail=1 ./your-program
```

Every 1000 ms, the runtime prints a status line: number of Ms, Ps, Gs, idle counts, plus per-P details if `scheddetail=1`.

---

## Reading a Trace

`runtime/trace`-driven profiles, viewed with `go tool trace`, show:

- **Procs lane**: one row per P. Each colored block is a G occupying that P for some interval. You see migrations as a G switching lanes.
- **Goroutine view**: per-goroutine timeline showing time spent in each state (Runnable, Running, Syscall, Wait).
- **Network blocking profile**: which Gs are stuck on netpoll.

A typical "I have 16 cores but only 50% CPU" mystery is solved by the Procs lane: if 8 lanes are colored at any time, you have a parallelism cap somewhere (often `GOMAXPROCS` set too low, or work-stealing not happening because of a coarse-grained lock in your code).

---

## What to Read Next

- **`senior.md`** — the same picture but with state transitions, lock ranks, and the precise dance between `schedule` and `findrunnable`.
- **`professional.md`** — the structs and the scheduler read line by line in `runtime/runtime2.go` and `runtime/proc.go`.
- **`02-preemption`** — how a running G is interrupted (cooperative until 1.14, async since).
- **`04-work-stealing`** — what `findrunnable` does when both local and global queues are empty.
- **`05-syscall-handling`** — the `entersyscall`/`exitsyscall` dance and how P is reused while M is blocked.
