---
layout: default
title: Runtime Internals Used by Stdlib — Middle
parent: Runtime Internals Used by Stdlib
grand_parent: Concurrency in Stdlib
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/23-concurrency-in-stdlib/04-runtime-internals/middle/
---

# Runtime Internals Used by Stdlib — Middle

[← Back](../)

This page peels back the layer between `sync`/`chan` you write every day and the
machinery in `src/runtime/` that actually parks goroutines, wakes them, and
arbitrates contention. The target reader already knows how to call
`sync.Mutex.Lock` and `select { case <-ch: }`. The question we answer is: when
those calls block, what happens *inside the runtime*, line by line, file by
file, structure by structure?

We will follow the cold paths through `runtime/proc.go`, `runtime/sema.go`,
`runtime/lock_futex.go`, `runtime/lock_sema.go`, `runtime/chan.go`, the netpoller,
the profiler, and the race detector shims. Every primitive we name has a real
source location; we cite it. Most snippets are simplified (the actual code
inside the runtime carries assertions, race annotations, KeepAlive calls, GC
barriers, and atomic write rules that would drown the topic in noise), but the
control flow is faithful.

## 1. The two-layer model: user goroutines vs runtime threads

Before we dive into individual primitives, fix the vocabulary:

* `g` — a goroutine. The struct is in `runtime/runtime2.go`. It holds the
  goroutine's stack pointer, program counter, status, `waitreason`, parking
  state, and a pointer to the next `g` in whatever queue it is on.
* `m` — an OS thread (machine). `runtime2.go`. Has a fixed system stack (`g0`),
  a pointer to the `g` it is currently running, a `curg` field for the user
  goroutine, signal handling state, and a TLS slot to find itself.
* `p` — a logical processor. There are `GOMAXPROCS` of them. Each `p` owns a
  local run queue of runnable `g`s, a cache for the heap allocator (`mcache`),
  and a few other per-CPU structures. An `m` must be associated with a `p` to
  run Go code (`m.p != nil`).
* The scheduler is the code in `runtime/proc.go` that moves `g`s between
  states (`_Grunnable`, `_Grunning`, `_Gwaiting`, `_Gsyscall`, `_Gdead`) and
  binds them to `m`s through their `p`.

Everything in this page is a variation on one move: an `m` stops running its
`curg`, sets `curg.atomicstatus = _Gwaiting`, links `curg` into some wait
structure, and calls `schedule()` to pick the next `g`. The variations are
about *which* wait structure and *who* will wake the `g` later.

## 2. `gopark` — the universal "go to sleep" primitive

The entry point used by channels, `sync.Mutex` slow path, `sync.Cond`, the
network poller, timers, `sync.WaitGroup`, semaphores, and finalizer wait is
the same function: `gopark`. Its signature in `runtime/proc.go` is roughly:

```go
// runtime/proc.go
//
// gopark puts the current goroutine into a wait state.
// The unlockf callback is invoked from the runtime after the goroutine is
// safely parked but before it is fully descheduled. If unlockf returns false,
// gopark resumes the goroutine immediately (it lost a race).
func gopark(
    unlockf func(*g, unsafe.Pointer) bool,
    lock     unsafe.Pointer,
    reason   waitReason,
    traceEv  byte,
    traceskip int,
)
```

The contract is the careful part:

1. The caller has *already* added the current `g` to some wait list (channel
   recvq, semaphore treap, etc.) and is holding the lock that protects that
   list.
2. The caller passes that lock as `lock` and a function `unlockf` that knows
   how to release it.
3. `gopark` switches to the system stack (`mcall`), sets `gp.atomicstatus =
   _Gwaiting`, and only *then* calls `unlockf(gp, lock)`. This ordering is the
   whole point of `gopark`: the lock is released only after the goroutine is
   visible as "waiting" to whoever might wake it.
4. If `unlockf` returns `true`, `gopark` calls `schedule()` to pick the next
   `g`. If `unlockf` returns `false`, `gopark` re-runs the current goroutine —
   it was a false alarm.

The `_Gwaiting` state matters: it tells the GC the goroutine's stack is safe
to scan but not running, and it tells the scheduler not to try to run this
`g` until `goready` is called.

A simplified body:

```go
// runtime/proc.go (simplified)
func gopark(unlockf func(*g, unsafe.Pointer) bool, lock unsafe.Pointer,
    reason waitReason, traceEv byte, traceskip int) {

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
    // can't do anything that might move to other M between acquirem/releasem
    mcall(park_m)
}

// park_m runs on m.g0's system stack.
func park_m(gp *g) {
    mp := getg().m
    casgstatus(gp, _Grunning, _Gwaiting)
    dropg()  // m no longer owns gp; gp.m = nil, mp.curg = nil
    if fn := mp.waitunlockf; fn != nil {
        ok := fn(gp, mp.waitlock)
        mp.waitunlockf = nil
        mp.waitlock = nil
        if !ok {
            casgstatus(gp, _Gwaiting, _Grunnable)
            execute(gp, true) // resume immediately, no schedule
        }
    }
    schedule()
}
```

The `mcall(park_m)` switches to `m.g0`'s stack so that we can safely change
`gp.atomicstatus` without running on `gp` itself. After `dropg`, the `m` is
free; `schedule()` will pick another runnable `g` from `p.runq` or the global
queue, or steal from another `p`.

## 3. `goready` — the universal wakeup

The counterpart lives in the same file:

```go
// runtime/proc.go
//
// goready wakes a parked goroutine.
// gp must be in state _Gwaiting; it is moved to _Grunnable and pushed onto a
// run queue.
func goready(gp *g, traceskip int) {
    systemstack(func() {
        ready(gp, traceskip, true)
    })
}

func ready(gp *g, traceskip int, next bool) {
    status := readgstatus(gp)
    if status&^_Gscan != _Gwaiting {
        throw("bad g->status in ready")
    }
    casgstatus(gp, _Gwaiting, _Grunnable)
    mp := acquirem()
    runqput(mp.p.ptr(), gp, next)
    wakep()  // may spin up another m if there is unused parallelism
    releasem(mp)
}
```

Two flags decide how aggressive the wakeup is:

* `next=true` puts `gp` into the `runnext` slot of the current `p` — it will be
  the next thing this `m` runs, ahead of the local queue. This is the wakeup
  pattern channels use: when a send unparks the receiver, we want to hand the
  CPU off to the receiver immediately so the value stays hot in cache.
* `wakep()` checks whether there is a spinning `m` already, an idle `p` we
  could pair with an idle `m`, and may call `startm()` to bring a thread out
  of `notesleep` (see §5). This is how the scheduler creates parallelism out
  of nothing when a long-blocked goroutine becomes runnable again.

Putting `gopark` and `goready` together gives the canonical pattern that you
will see repeated many times in this page:

```go
// pattern: park on a lock, wake from somewhere else
lock(&L)
addToWaitList(&L.waiters, getg())
unlockf := func(gp *g, l unsafe.Pointer) bool {
    unlock((*mutex)(l))
    return true
}
gopark(unlockf, unsafe.Pointer(&L), waitReasonSomething, traceEvGoBlock, 1)

// elsewhere, the waker:
lock(&L)
gp := popFromWaitList(&L.waiters)
unlock(&L)
goready(gp, 1)
```

Every primitive below is a refinement of this pattern with different wait
lists and different fairness rules.

## 4. `runtime.note` — one-shot binary semaphores

For very simple "wait until some event happens, with no fairness, no list of
waiters, just one sleeper" cases, the runtime uses a structure called `note`.
It lives in `runtime/runtime2.go`:

```go
// runtime/runtime2.go
type note struct {
    key uintptr // futex on Linux, M pointer on lock_sema platforms
}
```

The note exposes four operations defined in `runtime/lock_futex.go` (for
Linux/FreeBSD/DragonFly) and `runtime/lock_sema.go` (for Darwin, Windows,
Plan 9, AIX, Solaris, NetBSD):

```go
// runtime/lock_futex.go
func noteclear(n *note)            // n.key = 0
func notewakeup(n *note)           // n.key = 1; futexwakeup if anyone is parked
func notesleep(n *note)            // wait until n.key != 0
func notetsleep(n *note, ns int64) bool // wait with timeout, returns false on timeout
func notetsleepg(n *note, ns int64) bool // gopark-friendly version, drops the m
```

On Linux the futex-backed implementation is small and worth showing in full
because it is the floor below `sync.Mutex` on that platform:

```go
// runtime/lock_futex.go (Linux/futex)
func notesleep(n *note) {
    gp := getg()
    if gp != gp.m.g0 {
        throw("notesleep not on g0")
    }
    ns := int64(-1)
    for atomic.Load(key32(&n.key)) == 0 {
        gp.m.blocked = true
        futexsleep(key32(&n.key), 0, ns)
        gp.m.blocked = false
    }
}

func notewakeup(n *note) {
    old := atomic.Xchg(key32(&n.key), 1)
    if old != 0 {
        print("notewakeup - double wakeup\n")
        throw("notewakeup - double wakeup")
    }
    futexwakeup(key32(&n.key), 1)
}

func noteclear(n *note) {
    n.key = 0
}
```

Three properties make `note` very specific:

1. It is a *one-shot* event. `noteclear` resets it back to "unsignaled", but
   you cannot wait, wake, wait, wake without an explicit `noteclear` between
   the wake and the next wait.
2. It supports at most one sleeper. If two `m`s call `notesleep` on the same
   note, behavior is undefined (in practice, both may wake, but the design
   does not promise this).
3. It is an *m-level* primitive. `notesleep` runs on `g0`, parks the entire
   OS thread, and does not interact with the goroutine scheduler. That is
   exactly what you want for the scheduler's own internal handshakes.

Who uses notes?

* The scheduler itself: when an `m` has no work, it calls `stopm()`, which
  pushes the `m` onto the `sched.midle` list and calls `notesleep(&mp.park)`.
  When the scheduler later finds work for it, it calls `notewakeup(&mp.park)`.
* The sysmon thread (`runtime/proc.go: sysmon`) sleeps on `sched.sysmonnote`
  between scans.
* `runtime.GC()` uses notes to coordinate the STW phases.
* `chan.go` uses `notetsleep`-like timing for some debug paths but not for
  the main channel sleep — that uses `gopark`, not notes.

The variant `notetsleepg` is special: it parks the *goroutine*, not the M.
It is used when a goroutine needs to wait for an event but should not pin its
thread. The signal handling code uses this to deliver `os/signal.Notify`
events. The implementation:

```go
// runtime/lock_futex.go
func notetsleepg(n *note, ns int64) bool {
    gp := getg()
    if gp == gp.m.g0 {
        throw("notetsleepg on g0")
    }
    // hand-off to g0, which calls notetsleep, then resume gp
    entersyscallblock()
    ok := notetsleep_internal(n, ns)
    exitsyscall()
    return ok
}
```

In short: `note` is the M-level primitive; `gopark` is the g-level primitive.
`sync.Mutex` slow path uses semacquire which uses gopark, not notes. But the
runtime's own scheduler lock uses notes everywhere.

## 5. `runtime.mutex` — the runtime-internal lock

There is also a `mutex` type *inside* the runtime that is **distinct** from
`sync.Mutex`. It is used to protect runtime data structures (`sched.lock`,
`mheap_.lock`, `runtime.allgs lock`, `pollDesc` lock, etc.). It is defined
in `runtime/runtime2.go`:

```go
// runtime/runtime2.go
type mutex struct {
    // Empty struct if lock_futex; pointer-sized word otherwise.
    // Futex implementation uses key as the futex word.
    // Sema implementation uses key as a pointer to a list of parked m's.
    lockRankStruct
    key uintptr
}
```

`runtime.mutex` is also implemented in `lock_futex.go` (Linux) and
`lock_sema.go` (Darwin, Windows, etc.). The Linux version is short enough to
quote:

```go
// runtime/lock_futex.go (Linux)
//
// runtime.mutex is a 3-state futex:
//   0 unlocked
//   1 locked, no one waiting
//   2 locked, one or more m's waiting
func lock(l *mutex) { lockWithRank(l, getLockRank(l)) }

func lock2(l *mutex) {
    gp := getg()
    if gp.m.locks < 0 {
        throw("runtime·lock: lock count")
    }
    gp.m.locks++

    // Speculative grab for the unlocked case.
    v := atomic.Xchg(key32(&l.key), mutex_locked)
    if v == mutex_unlocked {
        return
    }
    // Slow path: spin a bit, then sleep.
    wait := v
    spin := 0
    if ncpu > 1 {
        spin = active_spin
    }
    for {
        // Try locking by setting from 0 -> 2 (i.e., locked-with-waiters)
        for i := 0; i < spin; i++ {
            for l.key == mutex_unlocked {
                if atomic.Cas(key32(&l.key), mutex_unlocked, wait) {
                    return
                }
            }
            procyield(active_spin_cnt)
        }
        for i := 0; i < passive_spin; i++ {
            for l.key == mutex_unlocked {
                if atomic.Cas(key32(&l.key), mutex_unlocked, wait) {
                    return
                }
            }
            osyield()
        }
        v = atomic.Xchg(key32(&l.key), mutex_sleeping)
        if v == mutex_unlocked {
            return
        }
        wait = mutex_sleeping
        futexsleep(key32(&l.key), mutex_sleeping, -1)
    }
}

func unlock2(l *mutex) {
    v := atomic.Xchg(key32(&l.key), mutex_unlocked)
    if v == mutex_unlocked {
        throw("unlock of unlocked lock")
    }
    if v == mutex_sleeping {
        futexwakeup(key32(&l.key), 1)
    }
    gp := getg()
    gp.m.locks--
    if gp.m.locks < 0 {
        throw("runtime·unlock: lock count")
    }
    if gp.m.locks == 0 && gp.preempt {
        gp.stackguard0 = stackPreempt
    }
}
```

Three things are important:

1. The runtime's `mutex` sleeps the **M**, not the **g**. There is no g-level
   parking. That means `runtime.mutex` is safe to acquire from interrupt-like
   contexts (signal handlers, system stack code) where there is no g to park.
2. It uses a three-state algorithm to avoid futex syscalls when there is no
   contention. The expensive `futexsleep` is only entered if `Xchg` returned
   2 (`mutex_sleeping`), meaning some other `m` is contending.
3. It tracks `gp.m.locks` so the runtime can detect "I am holding a runtime
   lock, do not preempt me". When `m.locks` is non-zero, `newstack` and
   `preemptone` refuse to preempt the current goroutine. This is critical for
   correctness: a goroutine holding a runtime lock cannot be preempted by GC
   or by the async preemption signal until it unlocks.

On Darwin, Windows, and other lock_sema platforms, the same `runtime.mutex`
interface is implemented in `runtime/lock_sema.go` using per-M semaphores
acquired through OS APIs (`mach_semaphore_wait` on Darwin, `WaitForSingleObject`
on Windows). The user-facing semantics are identical, but the wait list is a
stack of parked `m`s linked through `m.nextwaitm`.

## 6. `runtime.semacquire1` / `runtime_Semrelease` — the semaphore behind sync

This is where `sync.Mutex`, `sync.WaitGroup`, `sync.Cond`, and `sync.RWMutex`
actually live. The file is `runtime/sema.go`.

The semaphore is a counted token. Acquire decrements and possibly blocks;
release increments and possibly wakes. But what makes the runtime
implementation special is the *waiter data structure*: a hash table of
*treaps* (tree-of-treaps) keyed by the address of the user-level uint32.

### 6.1 The treap-of-treaps

The exported types in `sema.go`:

```go
// runtime/sema.go
const semTabSize = 251 // prime, fits in one cache line of pointers

var semtable [semTabSize]struct {
    root semaRoot
    pad  [cpu.CacheLinePadSize - unsafe.Sizeof(semaRoot{})]byte
}

type semaRoot struct {
    lock  mutex      // runtime.mutex protecting this tree
    treap *sudog     // root of the treap, keyed by addr
    nwait atomic.Uint32 // number of waiters in this tree
}
```

Each user-level semaphore — every `sync.Mutex.sema`, every `sync.WaitGroup`
counter, every `sync.Cond.notify` field — hashes its *address* into one of the
251 buckets. The bucket's treap then contains nodes (each a `sudog`) keyed by
that same address. Waiters for the same `sync.Mutex` end up at the same treap
node, which has its own FIFO linked list of waiters.

Why a treap (a random-priority BST) rather than a simple list or hash?

* The runtime needs O(log n) lookup by address because in any one bucket, many
  unrelated semaphores collide and we cannot afford to walk a linear list.
* It needs O(log n) insertion and deletion (waiters come and go).
* A treap maintains BST invariant on the *key* (address) and heap invariant
  on a *random priority* assigned per insertion, giving expected O(log n)
  without rebalancing complexity.
* Treaps allow easy splicing: when a waiter cancels (timeout), removing it is
  cheap.

### 6.2 The `sudog`

Every waiter is represented by a `sudog` (defined in `runtime/runtime2.go`):

```go
// runtime/runtime2.go
type sudog struct {
    g *g

    next *sudog // next in waitq (FIFO at the treap node)
    prev *sudog
    elem unsafe.Pointer // data element (for chan ops)

    acquiretime int64
    releasetime int64
    ticket      uint32

    isSelect    bool
    success     bool

    waiters uint16 // semaRoot: number of waiters chained at this address

    parent     *sudog // semaRoot binary tree
    waitlink   *sudog // gsignal stack / arena cache
    waittail   *sudog
    c          *hchan
}
```

`sudog` is allocated from a per-P cache (`p.sudogcache`) and on top of a
global pool (`sched.sudogcache`) to avoid heap pressure during channel/sema
operations. They are recycled with `releaseSudog`.

### 6.3 `semacquire1`

```go
// runtime/sema.go
func semacquire1(addr *uint32, lifo bool, profile semaProfileFlags,
    skipframes int, reason waitReason) {

    gp := getg()
    if gp != gp.m.curg {
        throw("semacquire not on the G stack")
    }

    // Fast path: try to decrement.
    if cansemacquire(addr) {
        return
    }

    // Slow path:
    s := acquireSudog()
    root := semroot(addr)
    t0 := int64(0)
    s.releasetime = 0
    s.acquiretime = 0
    s.ticket = 0
    if profile&semaBlockProfile != 0 && blockprofilerate > 0 {
        t0 = cputicks()
        s.releasetime = -1
    }
    if profile&semaMutexProfile != 0 && mutexprofilerate > 0 {
        t0 = cputicks()
        s.acquiretime = -1
    }
    for {
        lockWithRank(&root.lock, lockRankRoot)
        // Add ourselves to nwait to disable "easy case" in semrelease.
        root.nwait.Add(1)
        // Check cansemacquire to avoid missed wakeup.
        if cansemacquire(addr) {
            root.nwait.Add(-1)
            unlock(&root.lock)
            break
        }
        // Any other goroutine cannot finish a semrelease that started before
        // our nwait.Add(1), because they must read nwait after the atomic on
        // *addr. So if cansemacquire failed above, we are guaranteed to be
        // woken.
        root.queue(addr, s, lifo)
        goparkunlock(&root.lock, reason, traceEvGoBlockSync, 4+skipframes)
        if s.ticket != 0 || cansemacquire(addr) {
            break
        }
    }
    if s.releasetime > 0 {
        blockevent(s.releasetime-t0, 3+skipframes)
    }
    releaseSudog(s)
}
```

The key correctness argument is the interaction between `nwait` and the atomic
`*addr`:

1. The release path does `atomic.Xadd(addr, +1)` first, then reads `nwait`.
2. The acquire path does `nwait.Add(+1)` first, then `cansemacquire(addr)`
   (which is `atomic.Cas(addr, n>0, n-1)`).
3. If the acquire's CAS failed (saw zero), then the release's Xadd has not yet
   happened *or* the release happened but the resulting positive value was
   stolen by some other acquirer. Either way, the next release will see our
   `nwait > 0` and wake us, because of pairing memory orders on these atomics.

This is a classic "membar pair" pattern. Note that `nwait` does **not** count
exactly the number of sleepers; it counts a slightly larger set (acquirers who
are about to sleep but have not yet parked). That is fine — the release path
is willing to wake a stale acquirer; the waker just dequeues and `goready`s
whatever is at the head of the queue, and that goroutine re-checks
`cansemacquire`.

### 6.4 `semrelease`

```go
// runtime/sema.go
func semrelease1(addr *uint32, handoff bool, skipframes int) {
    root := semroot(addr)
    atomic.Xadd(addr, 1)

    // Easy case: no waiters.
    if root.nwait.Load() == 0 {
        return
    }

    // Harder case: lock the tree, find a waiter, hand off.
    lockWithRank(&root.lock, lockRankRoot)
    if root.nwait.Load() == 0 {
        // The count is already consumed by another thread, so no need to wake.
        unlock(&root.lock)
        return
    }
    s, t0 := root.dequeue(addr)
    if s != nil {
        root.nwait.Add(-1)
    }
    unlock(&root.lock)
    if s != nil {
        acquiretime := s.acquiretime
        if acquiretime != 0 {
            mutexevent(t0-acquiretime, 3+skipframes)
        }
        if s.ticket != 0 {
            throw("corrupted semaphore ticket")
        }
        if handoff && cansemacquire(addr) {
            s.ticket = 1 // direct handoff: decrement *addr ourselves
        }
        readyWithTime(s, 5+skipframes)
        if s.ticket == 1 && getg().m.locks == 0 {
            // Direct handoff: yield this M to the awakened goroutine.
            // This is essential to the starvation-mode handoff used by sync.Mutex.
            goyield()
        }
    }
}
```

Two release modes:

* `handoff = false` (the normal case for `sync.Mutex.Unlock` in normal mode,
  for `sync.WaitGroup.Done`'s eventual broadcast, etc.). The waiter is moved
  from `_Gwaiting` to `_Grunnable` and put on a run queue. Some other
  goroutine that is currently spinning on `Lock` may grab the mutex first;
  the awakened waiter then has to re-loop.
* `handoff = true` (used by `sync.Mutex` in starvation mode — see §7). The
  semaphore counter is decremented on behalf of the awakened goroutine
  (`s.ticket = 1`), and after `goready`, the current goroutine calls
  `goyield()` so the next thing the scheduler runs on this `m` is, very
  likely, the awakened waiter (because we put it via `runnext` in
  `goready`/`ready`). This eliminates the "convoy" where a fast acquirer
  starves the slow one.

### 6.5 The linkname bridge to `sync`

Package `sync` does not import `runtime`, but it does call into it. The bridge
is `//go:linkname`:

```go
// runtime/sema.go
//go:linkname sync_runtime_Semacquire sync.runtime_Semacquire
func sync_runtime_Semacquire(addr *uint32) {
    semacquire1(addr, false, semaBlockProfile, 0, waitReasonSemacquire)
}

//go:linkname sync_runtime_SemacquireMutex sync.runtime_SemacquireMutex
func sync_runtime_SemacquireMutex(addr *uint32, lifo bool, skipframes int) {
    semacquire1(addr, lifo, semaBlockProfile|semaMutexProfile, skipframes,
        waitReasonSyncMutexLock)
}

//go:linkname sync_runtime_Semrelease sync.runtime_Semrelease
func sync_runtime_Semrelease(addr *uint32, handoff bool, skipframes int) {
    semrelease1(addr, handoff, skipframes)
}
```

And in `sync/runtime.go`:

```go
// sync/runtime.go
func runtime_Semacquire(s *uint32)
func runtime_SemacquireMutex(s *uint32, lifo bool, skipframes int)
func runtime_Semrelease(s *uint32, handoff bool, skipframes int)
```

These are declared without bodies; the linker resolves them to the
linknamed symbols above. The cost of crossing this boundary is essentially
free — same calling convention, no marshalling.

## 7. `sync.Mutex` normal mode vs starvation mode

`sync.Mutex` (in `sync/mutex.go`) wraps the runtime semaphore with two state
bits packed into a single uint32 `state`:

```go
// sync/mutex.go
type Mutex struct {
    state int32
    sema  uint32
}

const (
    mutexLocked      = 1 << iota // bit 0: lock held
    mutexWoken                   // bit 1: a goroutine has been woken to try
    mutexStarving                // bit 2: starvation mode
    mutexWaiterShift = iota      // bits 3..: count of waiters
    starvationThresholdNs = 1e6  // 1ms
)
```

The Lock fast path is a single CAS:

```go
// sync/mutex.go
func (m *Mutex) Lock() {
    if atomic.CompareAndSwapInt32(&m.state, 0, mutexLocked) {
        return
    }
    m.lockSlow()
}
```

The slow path is where it gets interesting:

```go
// sync/mutex.go (simplified)
func (m *Mutex) lockSlow() {
    var waitStartTime int64
    starving := false
    awoke := false
    iter := 0
    old := m.state
    for {
        // Don't spin in starvation mode; ownership is handed off, so we
        // can't get the lock anyway.
        if old&(mutexLocked|mutexStarving) == mutexLocked && runtime_canSpin(iter) {
            // Active spin makes sense; try to set woken so unlocker
            // doesn't wake a goroutine.
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
        if old&mutexStarving == 0 {
            new |= mutexLocked
        }
        if old&(mutexLocked|mutexStarving) != 0 {
            new += 1 << mutexWaiterShift
        }
        if starving && old&mutexLocked != 0 {
            new |= mutexStarving
        }
        if awoke {
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
                // We are the next, take over.
                delta := int32(mutexLocked - 1<<mutexWaiterShift)
                if !starving || old>>mutexWaiterShift == 1 {
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

The unlock side:

```go
// sync/mutex.go (simplified)
func (m *Mutex) Unlock() {
    new := atomic.AddInt32(&m.state, -mutexLocked)
    if new != 0 {
        m.unlockSlow(new)
    }
}

func (m *Mutex) unlockSlow(new int32) {
    if (new+mutexLocked)&mutexLocked == 0 {
        throw("sync: unlock of unlocked mutex")
    }
    if new&mutexStarving == 0 {
        old := new
        for {
            if old>>mutexWaiterShift == 0 ||
                old&(mutexLocked|mutexWoken|mutexStarving) != 0 {
                return
            }
            new := (old - 1<<mutexWaiterShift) | mutexWoken
            if atomic.CompareAndSwapInt32(&m.state, old, new) {
                runtime_Semrelease(&m.sema, false, 1)
                return
            }
            old = m.state
        }
    } else {
        // Starvation mode: hand off ownership to the next waiter.
        runtime_Semrelease(&m.sema, true, 1)
    }
}
```

The narrative:

1. *Normal mode.* A `Lock` caller may spin (`runtime_canSpin` returns true if
   `iter < 4`, the M is running on a P with idle Ps available, and the CPU
   isn't already saturated). Spinning gives the current holder a chance to
   release the lock without paying the full park-unpark round trip.
2. If spinning fails, the caller adds itself as a waiter (incrementing the
   high bits of `state`) and parks via `runtime_SemacquireMutex`. The mutex
   keeps the runtime semaphore at zero; waiters block on `cansemacquire`.
3. When `Unlock` runs, it either *posts* a token (normal mode — wakes any
   waiter, which competes with newcomers for the lock) or *hands off*
   ownership (starvation mode — the awakened waiter takes the lock without
   competition; `s.ticket = 1` in `semrelease1` records this).
4. The switch to starvation mode happens when a waiter has been waiting more
   than 1ms (`starvationThresholdNs`). Once set, all subsequent acquires
   queue without spinning and ownership is handed off in FIFO order. The
   mode is cleared when the last waiter is woken or when a waiter that did
   not have to wait long acquires the lock.

This design is from the Go 1.9 change (CL 34310) that fixed pathological
unfairness in `sync.Mutex`. Before 1.9, a fast loop calling `Lock`/`Unlock`
could starve a slow waiter indefinitely because the slow waiter would always
lose the race after wakeup. Starvation mode caps the worst-case latency at
roughly 1ms.

## 8. `runtime.procPin` / `procUnpin`

Defined in `runtime/proc.go`:

```go
// runtime/proc.go
//
// procPin pins the current g to its P. While pinned, no goroutine switch
// can happen on this M; in particular, GC's stop-the-world cannot preempt
// us asynchronously. It increments mp.locks, which the scheduler treats
// as "do not preempt".
//
//go:nosplit
func procPin() int {
    gp := getg()
    mp := gp.m
    mp.locks++
    return int(mp.p.ptr().id)
}

//go:nosplit
func procUnpin() {
    gp := getg()
    gp.m.locks--
}

//go:linkname sync_runtime_procPin sync.runtime_procPin
func sync_runtime_procPin() int {
    return procPin()
}

//go:linkname sync_runtime_procUnpin sync.runtime_procUnpin
func sync_runtime_procUnpin() {
    procUnpin()
}
```

`sync.Pool` uses these to read its per-P shard without a lock:

```go
// sync/pool.go (simplified)
func (p *Pool) pin() (*poolLocal, int) {
    pid := runtime_procPin()
    s := atomic.LoadUintptr(&p.localSize)
    l := p.local
    if uintptr(pid) < s {
        return indexLocal(l, pid), pid
    }
    return p.pinSlow()
}
```

While pinned (`m.locks > 0`), the runtime will not preempt this goroutine —
neither the cooperative preemption from `morestack` nor the asynchronous
preemption signal. That guarantees the `pid` returned by `procPin` is still
the current P's id at the time of the load. The cost is paid: nothing slow
should happen between `procPin` and `procUnpin`; in particular, do not call
into other code that may park.

`procPin` does **not** disable garbage collection — it disables *preemption*
of the current goroutine. GC's mark phase can run concurrently on other
threads; what it cannot do is *synchronously stop* this particular `g` to
scan its stack. The GC waits for `m.locks` to drop to zero, at which point
`gp.stackguard0 = stackPreempt` and the goroutine yields at the next
function prologue.

Other users of `procPin`:

* Runtime atomic counters that increment a per-P slot. See `runtime/metrics`
  for sched counters.
* The race detector occasionally pins.

## 9. `runtime.LockOSThread` / `UnlockOSThread`

Defined in `runtime/proc.go`:

```go
// runtime/proc.go
//
// LockOSThread wires the calling goroutine to its current OS thread. The
// goroutine will always execute in that thread, and no other goroutine
// will execute in it until UnlockOSThread is called. The counter is nested.
//
//go:nosplit
func LockOSThread() {
    if atomic.Load(&newmHandoff.haveTemplateThread) == 0 && GOOS != "plan9" {
        // If we are the first to call LockOSThread, start a template thread
        // for spawning new OS threads.
        startTemplateThread()
    }
    gp := getg()
    gp.m.lockedExt++
    if gp.m.lockedExt == 0 {
        gp.m.lockedExt--
        panic("LockOSThread nesting overflow")
    }
    dolockOSThread()
}

func dolockOSThread() {
    if GOARCH == "wasm" {
        return
    }
    gp := getg()
    gp.lockedm.set(gp.m)
    gp.m.lockedg.set(gp)
}

func UnlockOSThread() {
    gp := getg()
    if gp.m.lockedExt == 0 {
        return
    }
    gp.m.lockedExt--
    dounlockOSThread()
}

func dounlockOSThread() {
    if GOARCH == "wasm" {
        return
    }
    gp := getg()
    if gp.m.lockedInt != 0 || gp.m.lockedExt != 0 {
        return
    }
    gp.m.lockedg = 0
    gp.lockedm = 0
}
```

Three counters interact:

* `lockedExt` — number of `LockOSThread` calls made by user code.
* `lockedInt` — number of internal lock requests (cgo, syscalls that need
  the same thread, etc.).
* The g↔m wiring is established once both are nonzero and torn down when
  both return to zero.

Use cases:

* `cgo` callbacks. The C code may rely on thread-local storage; if the Go
  scheduler moved the goroutine to a different M after a callback, TLS
  would change.
* OS APIs that require thread affinity: `ptrace`, Linux's `setns`,
  Windows's COM single-threaded apartment, GUI main loops.
* `os/signal` integration on some platforms (the signal handler thread is
  effectively locked).
* `runtime.main` itself locks the main goroutine to its OS thread because
  many OS APIs require initialization on thread 1.

A subtle property: when a goroutine that has called `LockOSThread` exits
without calling `UnlockOSThread`, the M *also* exits. This is the
documented "I want my thread to die when I do" pattern, used by `net.Listen`
on Plan 9 and by libraries that wrap thread-affine resources.

### 9.1 Scheduler interaction

The scheduler in `runtime/proc.go` recognises locked g/m pairs at multiple
points:

```go
// runtime/proc.go (excerpt)
// findRunnable's locked-g handling
if gp != nil && gp.lockedm != 0 {
    // This g is locked to m; we can't run it.
    startlockedm(gp)
    goto top
}

// startlockedm switches to the target M.
func startlockedm(gp *g) {
    mp := gp.lockedm.ptr()
    if mp == getg().m {
        throw("startlockedm: locked to me")
    }
    if mp.nextp != 0 {
        throw("startlockedm: m has p")
    }
    // hand off our p to the locked M
    incidlelocked(-1)
    pp := releasep()
    mp.nextp.set(pp)
    notewakeup(&mp.park)
    stopm()
}
```

When a goroutine wants to run but is locked to a specific M, the current M
*gives up its P* to that M, wakes the M via `notewakeup(&mp.park)`, and
itself calls `stopm()` to park. This is one of the more delicate dances in
the scheduler.

## 10. `runtime.SetFinalizer` and concurrency

```go
// runtime/mfinal.go
//
// SetFinalizer(obj, fn) registers fn to be called when obj becomes
// unreachable. Multiple finalizers run concurrently in their own
// goroutines, on a private finalizer queue.
func SetFinalizer(obj interface{}, finalizer interface{})
```

How it works under the hood:

* `SetFinalizer` records `(obj, fn)` in a hash table keyed by `obj`'s
  pointer. The GC tracks objects with finalizers separately so it does not
  collect them as soon as user code drops the reference; instead, when the
  GC determines the object is unreachable *from non-finalizer roots*, it
  schedules the finalizer to run and *resurrects* the object for one more
  cycle (so the finalizer can read it).
* Finalizers run in goroutines spawned by `runfinq` (in `mfinal.go`). The
  function:

```go
// runtime/mfinal.go (simplified)
func runfinq() {
    var (
        frame    unsafe.Pointer
        framecap uintptr
        argRegs  int
    )
    for {
        lock(&finlock)
        fb := finq
        finq = nil
        if fb == nil {
            gp := getg()
            fingwait = true
            goparkunlock(&finlock, waitReasonFinalizerWait,
                traceEvGoBlock, 1)
            continue
        }
        unlock(&finlock)
        for fb != nil {
            for i := fb.cnt; i > 0; i-- {
                f := &fb.fin[i-1]
                // ...call f.fn(f.arg)...
            }
            fb = fb.next
        }
    }
}
```

* The finalizer goroutine is *not* the same goroutine as the one that called
  `SetFinalizer`, nor is it the GC. It can run concurrently with anything
  else. Therefore, finalizers must use proper synchronization just like any
  other goroutine.

Concurrency consequences:

* The order of finalizer execution is unspecified. Do not rely on it.
* Finalizers run with the object still pointed at — meaning the object's
  memory is live during the call. After the finalizer returns, the object
  becomes a candidate for collection in the next cycle (assuming no other
  references and assuming `SetFinalizer(obj, nil)` was not called).
* `runtime.KeepAlive(x)` is the mechanism to *defeat* the finalizer-eligible
  optimization. The compiler may otherwise reuse the storage of a variable
  after its last use, even if a finalizer expects it to live longer.
* If a finalizer panics, that brings the whole program down. Wrap with
  `defer recover()` if you cannot tolerate it.

## 11. `runtime.GC()` and concurrent mark

`runtime.GC()` forces a garbage collection. The interesting concurrency
detail is *what runs at the same time* during the mark phase:

```go
// runtime/mgc.go (sketch of gcStart -> gcBgMarkWorker)
//
// 1. STW1: stop the world, install write barriers, snapshot roots.
// 2. Mark: concurrent. User goroutines run; their writes go through the
//    write barrier so the GC can track new pointers.
// 3. STW2: stop the world, finish mark termination, clean up.
// 4. Sweep: concurrent. Memory is reclaimed lazily as allocations happen.
```

During concurrent mark, every Go pointer write — `*p = q` — actually compiles
to (roughly):

```go
// Equivalent of Dijkstra-style write barrier (simplified).
if writeBarrier.enabled {
    gcWriteBarrier(p, q) // record q as a possibly-newly-reachable object
}
*p = q
```

Why this matters for concurrency: if your code does `atomic.StorePointer`,
the runtime *also* runs the write barrier. That barrier is itself
synchronization-aware; it pushes pointers into per-P buffers that flush into
a shared queue. The barrier code is hot enough that it is written in assembly
(`runtime/asm_amd64.s` has `gcWriteBarrier`).

A subtle implication: garbage-collected pointers move through more memory
ordering machinery than non-pointer atomic stores. This is why
`atomic.Value`'s `Store` of a non-pointer interface goes through extra
allocation.

## 12. `runtime.Gosched()`

```go
// runtime/proc.go
//
// Gosched yields the processor, allowing other goroutines to run.
// It does not suspend the current goroutine; it remains runnable.
//
//go:nosplit
func Gosched() {
    checkTimeouts()
    mcall(gosched_m)
}

func gosched_m(gp *g) {
    goschedImpl(gp)
}

func goschedImpl(gp *g) {
    status := readgstatus(gp)
    if status&^_Gscan != _Grunning {
        dumpgstatus(gp)
        throw("bad g status")
    }
    casgstatus(gp, _Grunning, _Grunnable)
    dropg()
    lock(&sched.lock)
    globrunqput(gp)
    unlock(&sched.lock)
    schedule()
}
```

The current `g` is moved to `_Grunnable`, pushed onto the *global* run queue,
and the scheduler picks something else. Pushing onto the global queue (rather
than the local P queue) is intentional: it spreads load. Some library code
calls `Gosched` from a hot loop to be polite; this is generally an
anti-pattern in modern Go because asynchronous preemption (since Go 1.14)
already deschedules tight loops at safepoints.

## 13. `runtime.Goexit()`

```go
// runtime/panic.go (Goexit lives here logically; defer machinery is here)
//
// Goexit terminates the goroutine that calls it. No other goroutine is
// affected. Goexit runs all deferred calls before terminating.
//
// Calling Goexit from the main goroutine causes the program to crash with
// "no goroutines (main called runtime.Goexit) - deadlock!" if no other
// goroutines are running.
func Goexit() {
    gp := getg()
    if gp.m.curg != gp {
        throw("runtime: Goexit on g0")
    }
    // ...run deferreds in order, panicking gracefully if any of them panic...
    goexit1()
}

// goexit1 transitions to g0 and finishes.
func goexit1() {
    mcall(goexit0)
}

func goexit0(gp *g) {
    mp := getg().m
    casgstatus(gp, _Grunning, _Gdead)
    gp.m = nil
    locked := gp.lockedm != 0
    gp.lockedm = 0
    mp.lockedg = 0
    // ...gfput, schedule()...
    if locked {
        // The goroutine was locked to this M. The M dies with the g (POSIX)
        // or stays around but unlocked (Plan 9).
        if GOOS != "plan9" {
            gogo(&mp.g0.sched) // running on g0, exit M
        }
    }
    schedule()
}
```

The deferred-call dance is what makes `Goexit` different from a `panic`
that runs only the current frame's deferreds. `Goexit` walks *all* deferred
calls on the goroutine, in LIFO order, and only after all have run does the
goroutine die.

## 14. `runtime.NumGoroutine` and `runtime.Stack`

These two seem trivial but expose the runtime's internal locking:

```go
// runtime/proc.go
//
// NumGoroutine returns the number of goroutines that currently exist.
func NumGoroutine() int {
    return int(gcount())
}

func gcount() int32 {
    n := int32(atomic.Loaduintptr(&allglen)) - sched.gFree.n - sched.ngsys.Load()
    for _, pp := range allp {
        n -= pp.gFree.n
    }
    if n < 1 {
        n = 1
    }
    return n
}
```

`allglen` is the length of `allgs`, the slice of all `g`s ever created.
Goroutines are not removed from `allgs`; instead, dead ones are linked into
a free list (`sched.gFree`, `p.gFree`) and recycled. So `NumGoroutine` is a
subtraction.

`runtime.Stack` is heavier:

```go
// runtime/mprof.go (Stack is here)
func Stack(buf []byte, all bool) int {
    if all {
        stopTheWorld("stack trace")
    }
    n := 0
    if len(buf) > 0 {
        gp := getg()
        sp := getcallersp()
        pc := getcallerpc()
        systemstack(func() {
            g0 := getg()
            g0.m.traceback = 1
            g0.writebuf = buf[0:0:len(buf)]
            goroutineheader(gp)
            traceback(pc, sp, 0, gp)
            if all {
                tracebackothers(gp)
            }
            g0.m.traceback = 0
            n = len(g0.writebuf)
            g0.writebuf = nil
        })
    }
    if all {
        startTheWorld()
    }
    return n
}
```

Two costs:

* `Stack(buf, false)` walks only the current goroutine. Cheap.
* `Stack(buf, true)` calls `stopTheWorld`, which is a *full GC-style* stop:
  all goroutines must reach a safepoint and pause. Then `tracebackothers`
  walks `allgs` and prints each stack. This can take milliseconds on a busy
  process and is intended only for crash dumps. The `net/http/pprof` handler
  for `/debug/pprof/goroutine` uses this; do not poll it.

## 15. The race detector shims

If you build with `-race`, the Go compiler injects calls to `racefuncenter`,
`raceread`, `racewrite`, `racefuncexit`, etc. before every memory access.
These calls go into `runtime/race.go` (Linux/Mac) or `runtime/race_*.go`,
which is a thin Go wrapper over `runtime/race_amd64.s` and ultimately into
the LLVM ThreadSanitizer C library (`compiler-rt`).

The public Go shims for explicit synchronization:

```go
// runtime/race.go
//
// RaceRead/RaceWrite/RaceAcquire/RaceRelease are no-ops outside of -race.
// Under -race they call into ThreadSanitizer.

func RaceRead(addr unsafe.Pointer)
func RaceWrite(addr unsafe.Pointer)
func RaceReadRange(addr unsafe.Pointer, len int)
func RaceWriteRange(addr unsafe.Pointer, len int)
func RaceAcquire(addr unsafe.Pointer)
func RaceRelease(addr unsafe.Pointer)
func RaceReleaseMerge(addr unsafe.Pointer)
func RaceDisable()
func RaceEnable()
```

Their semantics map to ThreadSanitizer:

* `RaceRead` / `RaceWrite` — model an ordinary memory access at `addr`. If
  another goroutine writes the same address without a synchronization
  edge, TSan reports a data race.
* `RaceAcquire` — model an acquire fence at `addr`. Any data the source
  goroutine wrote *before* its matching `RaceRelease(addr)` is now visible
  to us.
* `RaceRelease` — model a release fence at `addr`.
* `RaceReleaseMerge` — like `RaceRelease`, but the acquiring goroutine
  inherits *all* of the releaser's history, not only the most recent
  release.
* `RaceDisable` / `RaceEnable` — bracket a region in which race accesses
  are ignored. Use with care; this is what `sync/atomic`'s implementation
  uses to *implement* the synchronization, since otherwise TSan would
  observe the inside of the atomic op as a race.

Inside the runtime:

```go
// runtime/chan.go
func chansend(c *hchan, ep unsafe.Pointer, block bool, callerpc uintptr) bool {
    // ...
    if raceenabled {
        racereadpc(c.raceaddr(), callerpc, abi.FuncPCABIInternal(chansend))
    }
    // ...
    if raceenabled {
        racerelease(chanbuf(c, c.sendx))
    }
    // ...copy data into buffer...
}
```

The channel send issues a `racerelease` on the buffer slot, and the
matching `chanrecv` issues a `raceacquire` on the same slot. That is the
"channel send happens-before channel receive" rule of the Go memory model
*implemented* — not declared.

`sync.Mutex.Lock` similarly does `raceacquire(&m.sema)` and `Unlock` does
`racerelease(&m.sema)`, which encodes the Unlock-happens-before-Lock rule.

`sync/atomic` uses `RaceReleaseMerge` and `RaceAcquire` to model sequential
consistency among atomics.

The cost: a `-race` build is typically 2x to 10x slower and uses ~5x to 10x
more memory. The shim calls dominate; the actual TSan engine is reasonable
but every memory access becomes a function call into C.

## 16. `runtime.SetCPUProfileRate` and the profiler signal

The CPU profiler is delivered via `SIGPROF`. Here is how it actually works:

```go
// runtime/cpuprof.go
//
// SetCPUProfileRate sets the CPU profiling rate to hz samples per second.
// If hz <= 0, profiling is turned off.
func SetCPUProfileRate(hz int)
```

The setup steps when `hz > 0`:

1. The runtime calls `setProcessCPUProfiler(hz)` (in
   `runtime/signal_unix.go`), which on Linux issues
   `setitimer(ITIMER_PROF, ...)` to ask the kernel to deliver `SIGPROF` to
   *the process* (one thread chosen by the kernel) at `hz` Hz.
2. On per-thread granularity systems (Linux modern kernels), the runtime
   instead uses `timer_create` with `SIGEV_THREAD_ID` per `m`, so each
   thread gets its own `SIGPROF` and we get per-thread sampling without
   bias.
3. Each `m` installs a `sigaction` handler `sigtramp` -> `sighandler` ->
   `sigprof`.

The actual sample handler is in `runtime/proc.go`:

```go
// runtime/proc.go
//
// sigprof is called from the signal handler.
// It must be safe to call in any context (signal handlers may interrupt
// system calls, GC, even cgo).
func sigprof(pc, sp, lr uintptr, gp *g, mp *m) {
    if prof.hz.Load() == 0 {
        return
    }
    // ...filter out signals from cgo callbacks, idle Ms, etc...
    var stk [maxCPUProfStack]uintptr
    n := 0
    if mp.profilehz != 0 && mp.curg != nil {
        // Walk the user goroutine's stack, not g0's.
        n = gentraceback(pc, sp, lr, mp.curg, 0, &stk[0],
            len(stk), nil, nil, _TraceTrap|_TraceJumpStack)
    }
    cpuprof.add(gp, stk[:n])
}
```

Three subtleties that bear directly on concurrency in stdlib:

1. The handler runs in *signal context*. It cannot allocate, cannot call
   `mallocgc`, cannot park. It writes into a lock-free ring buffer
   (`cpuprof.log`).
2. The handler may interrupt the runtime itself — including the goroutine
   scheduler — while holding `sched.lock`. The handler must therefore not
   try to take `sched.lock`. It uses `mp` directly, not goroutine-level
   indirection.
3. Per-thread sampling matters because process-level `ITIMER_PROF` has
   skew on multi-CPU systems — Linux delivers the signal to a single
   thread, biasing samples toward whichever thread is "first" at the
   moment. The per-thread `timer_create` path avoids this.

The reader goroutine for the profile lives in `pprof.startCPUProfile`:

```go
// runtime/pprof/pprof.go
func StartCPUProfile(w io.Writer) error {
    // ...
    runtime.SetCPUProfileRate(hz)
    go profileWriter(w)
    return nil
}

func profileWriter(w io.Writer) {
    for {
        data, tags, eof := readProfile() // blocks until samples available
        if e := b.addCPUData(data, tags); e != nil && err == nil {
            err = e
        }
        if eof {
            break
        }
    }
}
```

`readProfile` itself is implemented in `runtime/cpuprof.go` and uses
`gopark` against a `note` that the signal handler `notewakeup`s when the
buffer crosses a threshold. So the signal handler is a producer; the
profile-writer goroutine is a consumer; the `note` is the rendezvous.

## 17. Putting it together — the call chain for `sync.Mutex.Lock`

To anchor everything, here is the full call chain a contended
`sync.Mutex.Lock` traverses, from user code to the kernel and back:

```
user code:
    mu.Lock()
sync/mutex.go:
    Mutex.Lock                              -> CAS fast path
    Mutex.lockSlow                          -> spin / queue / sleep
        runtime_canSpin                     -> linkname to runtime.sync_runtime_canSpin
        runtime_SemacquireMutex             -> linkname to runtime.sync_runtime_SemacquireMutex

runtime/sema.go:
    sync_runtime_SemacquireMutex
    semacquire1
        cansemacquire                       -> atomic CAS on m.sema
        acquireSudog                        -> per-P sudog cache
        semroot                             -> &semtable[hash]
        root.queue                          -> treap insert
        goparkunlock                        -> gopark with unlockf=unlock

runtime/proc.go:
    gopark                                  -> mcall(park_m)
    park_m                                  -> casgstatus(_Grunning, _Gwaiting); dropg; schedule
    schedule                                -> findRunnable
    findRunnable                            -> stealwork, netpoll, idle
        stopm                               -> notesleep(&m.park)

runtime/lock_futex.go (Linux):
    notesleep                               -> futexsleep
    futexsleep                              -> SYS_futex(FUTEX_WAIT)

[ kernel parks the thread until a future SYS_futex(FUTEX_WAKE) ]

unlocker side:
sync/mutex.go:
    Mutex.Unlock
    Mutex.unlockSlow
    runtime_Semrelease                      -> linkname

runtime/sema.go:
    sync_runtime_Semrelease
    semrelease1
        root.dequeue                        -> treap remove
        readyWithTime                       -> goready

runtime/proc.go:
    goready                                 -> systemstack(ready)
    ready
        casgstatus(_Gwaiting, _Grunnable)
        runqput                             -> push to P.runnext or P.runq
        wakep                               -> maybe startm()

runtime/proc.go:
    startm                                  -> notewakeup(&mp.park)

runtime/lock_futex.go:
    notewakeup                              -> futexwakeup
    futexwakeup                             -> SYS_futex(FUTEX_WAKE)

[ kernel wakes the thread; control returns to notesleep, then to schedule,
  which picks our newly-runnable g and runs it; the awakened Lock caller
  finally returns from lockSlow ]
```

Every node on this chain is in one of the files we have cited:
`sync/mutex.go`, `runtime/sema.go`, `runtime/proc.go`,
`runtime/lock_futex.go`. The `chan` operations have a parallel chain
through `runtime/chan.go` with the same `gopark`/`goready` pivot.

## 18. Cross-references for the curious

| Stdlib API | Runtime entry point | Source file |
|---|---|---|
| `sync.Mutex.Lock` slow path | `sync_runtime_SemacquireMutex` | `runtime/sema.go` |
| `sync.Mutex.Unlock` slow path | `sync_runtime_Semrelease(handoff?)` | `runtime/sema.go` |
| `sync.RWMutex.RLock` / `RUnlock` | `sync_runtime_Semacquire` / `Semrelease` on `r.readerSem`, `r.writerSem` | `runtime/sema.go` |
| `sync.WaitGroup.Wait` | `sync_runtime_SemacquireWaitGroup` | `runtime/sema.go` |
| `sync.WaitGroup.Add(neg)` | `sync_runtime_Semrelease` | `runtime/sema.go` |
| `sync.Cond.Wait` | unique-ticket semaphore: `sync_runtime_SemacquireMutex` on `c.notify` | `runtime/sema.go`, `sync/cond.go` |
| `sync.Cond.Signal` / `Broadcast` | `sync_runtime_Semrelease` | `runtime/sema.go` |
| `sync.Once.Do` | `sync.Mutex` + atomic | `sync/once.go` |
| `sync.Pool.Get` | `runtime_procPin` + per-P shard | `sync/pool.go`, `runtime/proc.go` |
| channel send/recv blocking | `gopark` on `hchan.sendq`/`recvq` | `runtime/chan.go`, `runtime/proc.go` |
| `select` blocking | `gopark` on multiple `sudog`s | `runtime/select.go` |
| `time.Sleep` | timer fires `goready` | `runtime/time.go` |
| `time.After` | timer goroutine + channel | `runtime/time.go`, `runtime/chan.go` |
| `net.Conn.Read` blocking | netpoll `gopark` | `runtime/netpoll.go` |
| `os/exec.Cmd.Wait` | `sigchld` -> wakeup | `runtime/os_linux.go` |
| `runtime.GC()` | STW + concurrent mark | `runtime/mgc.go` |
| `runtime.GOMAXPROCS` | adjusts `len(allp)` | `runtime/proc.go` |
| `runtime.SetFinalizer` | finalizer queue + `runfinq` goroutine | `runtime/mfinal.go` |
| race detector | TSan shims | `runtime/race.go`, `runtime/race_amd64.s` |
| CPU profiler | `SIGPROF` + `cpuprof` ring buffer | `runtime/cpuprof.go`, `runtime/proc.go` |
| `LockOSThread` | `g.lockedm`/`m.lockedg` | `runtime/proc.go` |
| `procPin` | `m.locks++` | `runtime/proc.go` |
| `Gosched` | `mcall(gosched_m)` | `runtime/proc.go` |
| `Goexit` | deferreds + `goexit0` | `runtime/panic.go`, `runtime/proc.go` |

## 19. A worked example: tracing one `select` block

Consider:

```go
ch := make(chan int, 1)
go func() {
    time.Sleep(50 * time.Millisecond)
    ch <- 42
}()

select {
case v := <-ch:
    use(v)
case <-time.After(1 * time.Second):
    fmt.Println("timeout")
}
```

What the runtime does, step by step:

1. `make(chan int, 1)` calls `runtime.makechan` which allocates an `hchan`
   struct with a 1-element buffer.
2. The `go` statement calls `runtime.newproc`, which allocates a `g` from
   `p.gFree` (or creates one), copies the closure onto its stack, sets up
   PC to `goexit` so the goroutine's frame returns to the runtime,
   `casgstatus(_Gdead, _Grunnable)`, and `runqput`s it on the local P.
3. The `select` statement is compiled to a call to `runtime.selectgo` in
   `runtime/select.go`. selectgo:
   * Allocates two `sudog`s (one for each case).
   * Wires sudog `s0` into `ch.recvq` (the receive case).
   * Wires sudog `s1` into the timer channel's recvq. The
     timer channel is created by `time.After`, which calls
     `runtime.newTimer` with a callback that does `goready` on a goroutine
     blocked on the channel.
   * Calls `gopark` with an `unlockf` that releases the channel lock.
4. Meanwhile, the spawned goroutine, having woken from `time.Sleep` (which
   ultimately came from a timer `goready`), runs `ch <- 42`. This calls
   `runtime.chansend`. Because `ch` has a waiting receiver in `recvq`,
   chansend does **direct send**: it dequeues `s0`, copies the value
   directly to the receiver's stack location (avoiding the buffer), and
   calls `goready(s0.g, ...)`.
5. The receiver goroutine wakes up in `selectgo` after `gopark` returns.
   `selectgo` checks `s0.success == true`, returns case index 0.
6. The other sudog `s1` is still on the timer channel's recvq. `selectgo`
   walks `cases` and calls `dequeueSudoG` on each non-winning case to
   unhook them. The timer goroutine, when it fires 950ms later, finds an
   empty recvq and just enqueues into the buffered channel (which has a
   1-slot buffer); since no one is listening anymore, the value is dropped
   and the timer goroutine exits. (In practice, `time.After`'s timer is
   not stopped, so the buffered channel and timer struct will eventually
   be garbage collected.)

Three primitives we discussed appear: `gopark` (selectgo), `goready`
(direct send), `goready` again (timer fire). Plus `runqput` (`go`
statement) and the per-P sudog cache.

## 20. Things that are *not* in the runtime, but feel like they should be

* **`sync.Map`** — entirely in the `sync` package, no runtime calls
  besides `atomic`. It uses a read-mostly two-map design (a `read` map
  loaded atomically and a `dirty` map under a `Mutex`). No new primitives.
* **`context.Context`** — pure Go, no runtime calls. Cancellation is a
  channel close (which uses `chan.go` machinery).
* **`golang.org/x/sync/errgroup`, `singleflight`** — wrap `sync.WaitGroup`
  and `sync.Mutex`; no runtime extensions.
* **`atomic.Value`** — uses `unsafe.Pointer` swap with the runtime's
  publication-barrier conventions; the implementation file is in
  `sync/atomic/value.go`, no runtime additions besides the standard
  `atomic` instructions.
* **`reflect.Select`** — calls into `runtime.reflect_rselect` (linkname),
  which is essentially the same as `selectgo` but takes a runtime-built
  `scase` array.

Knowing what is *not* a runtime primitive narrows your debugging surface:
if `sync.Map` is misbehaving, do not go looking in `runtime/sema.go`.

## 21. How to read the runtime sources

A few practical tips when you go spelunking:

* Search for `//go:linkname` to find the bridges between stdlib packages
  and the runtime. The list is short — maybe 100 entries in total — and
  it tells you exactly which functions cross the boundary.
* Functions that run on the system stack are typically tagged with
  `//go:systemstack` or use `systemstack(...)` / `mcall(...)`. You cannot
  call most goroutine-level primitives from them (no `gopark`, no
  allocation, no defer).
* `//go:nosplit` means "do not insert the stack-check prologue here".
  Such functions must be very careful about stack use because they cannot
  grow the stack. Most signal-context code and `procPin`/`procUnpin` are
  `nosplit`.
* `//go:noinline` and `//go:nowritebarrier` appear on functions that
  must not run write barriers, e.g., during GC bootstrap.
* The "wait list / sudog" pattern repeats: read `runtime/chan.go` once
  carefully and you will recognize the shape in `runtime/sema.go`,
  `runtime/netpoll.go`, and `runtime/select.go` immediately.

## 22. What changes between Go versions

The runtime is internal, so any of this can change. Recent notable
adjustments:

* Go 1.14: asynchronous preemption via signals (`SIGURG`). Before this,
  goroutines could be preempted only at function prologues / channel ops.
  Tight loops without function calls would starve. The change is in
  `runtime/preempt.go` and `runtime/signal_unix.go`.
* Go 1.18: `sync.Mutex` mode tracking added the `mutexFairness` flag in
  the runtime profiler; the user-facing behaviour did not change but
  block profiling improved.
* Go 1.19: `sync/atomic` got typed atomics (`Int64`, `Pointer[T]`); the
  underlying machine code is the same as before, but layout was tightened
  to guarantee 8-byte alignment on 32-bit platforms.
* Go 1.21: `clear()` builtin and minor changes to `mfinal.go` finalizer
  ordering.
* Go 1.22: `for range` over an integer; loop variables are per-iteration
  (changes interaction with closures captured by goroutines).
* Go 1.23: timer overhaul — each `time.Timer` and `time.Ticker` now has
  its own goroutine-less internal state, removing the global timer
  goroutine. `runtime/time.go` was substantially rewritten.

When debugging concurrency behavior across versions, look first at
`runtime/proc.go`, `runtime/sema.go`, `runtime/chan.go`, `runtime/time.go`,
and `runtime/preempt.go`. Those five files account for most user-visible
concurrency changes.

## 23. Quick reference card

```
// Park a goroutine; caller holds 'lock'; unlockf releases it after park.
runtime.gopark(unlockf, lock, reason, traceEv, skip)

// Wake a parked goroutine.
runtime.goready(gp, skip)

// Park an OS thread on a one-shot event.
runtime.notesleep(n)                   // wait
runtime.notewakeup(n)                  // wake one
runtime.noteclear(n)                   // reset
runtime.notetsleep(n, ns) bool         // timed wait (m-level)
runtime.notetsleepg(n, ns) bool        // timed wait (g-level)

// Runtime-internal mutex (no g parking; m parks).
runtime.lock(&l)
runtime.unlock(&l)

// User-level semaphore (g parking, tree-of-treaps, profiled).
runtime.semacquire1(addr, lifo, profile, skip, reason)
runtime.semrelease1(addr, handoff, skip)

// linkname bridges into sync.
sync.runtime_Semacquire(s)
sync.runtime_SemacquireMutex(s, lifo, skip)
sync.runtime_SemacquireWaitGroup(s)
sync.runtime_Semrelease(s, handoff, skip)
sync.runtime_canSpin(iter) bool
sync.runtime_doSpin()
sync.runtime_procPin() int
sync.runtime_procUnpin()
sync.runtime_nanotime() int64

// Public:
runtime.LockOSThread()
runtime.UnlockOSThread()
runtime.NumGoroutine() int
runtime.Stack(buf, all) int
runtime.Gosched()
runtime.Goexit()
runtime.SetFinalizer(obj, fn)
runtime.GC()
runtime.SetCPUProfileRate(hz)
runtime.RaceRead(addr)
runtime.RaceWrite(addr)
runtime.RaceAcquire(addr)
runtime.RaceRelease(addr)
runtime.RaceDisable()
runtime.RaceEnable()
```

## 24. Common misconceptions corrected

* **"`runtime.Gosched` improves throughput."** Usually it hurts. Async
  preemption already deschedules tight loops. `Gosched` adds a context
  switch and pushes the current g to the *global* queue, slowing it down.
  Use only when you can demonstrate it helps with a benchmark.
* **"`runtime.LockOSThread` makes operations atomic."** No. It only ties
  the goroutine to one thread. The goroutine can still be preempted; other
  goroutines on other threads still run.
* **"`sync.Mutex` is fair."** Only in starvation mode. In normal mode, a
  fast acquirer can repeatedly beat a slow one. Starvation mode caps the
  worst case at ~1ms; without it, you can construct schedules with
  unbounded latency.
* **"Channel ops are lock-free."** No. `hchan` has a `mutex` field (a
  `runtime.mutex`). Channel ops *do* take that lock. Direct hand-off
  (when there is a waiter ready) avoids the buffer but not the lock.
* **"Finalizers run promptly."** No. They run when the GC decides the
  object is unreachable from non-finalizer roots, which can be several
  GC cycles after the user drops the reference. Do not rely on finalizers
  for resource release; use `defer` or explicit `Close`.
* **"`runtime.GC` is synchronous."** Mostly — the call returns after the
  next GC cycle finishes. But during the cycle, user goroutines continue
  to run (concurrent mark). Only mark termination is STW.
* **"`runtime.procPin` disables GC."** No. It disables *preemption of the
  current goroutine*. GC can still run on other threads.
* **"`sync.Pool` is a memory cache."** It is a *temporary* cache. Items
  are dropped at every GC. Do not use it to amortize expensive
  initialization across long periods.
* **"`gopark` puts the goroutine on a timeout."** No, by itself it parks
  indefinitely. Timed waits use the timer subsystem (`runtime/time.go`) to
  call `goready` after a delay.
* **"The race detector finds all races."** No. It only finds races that
  *actually execute* during the test. Use `-race` in CI and stress the
  code with realistic concurrency to maximize coverage.

## 25. Going deeper

When you are ready to read the runtime sources directly, start here in this
order:

1. `runtime/runtime2.go` — all the struct definitions (`g`, `m`, `p`,
   `sudog`, `hchan`, `mutex`, `note`). Read it as a glossary, not
   linearly.
2. `runtime/proc.go` — the scheduler. Focus on `schedule`, `findRunnable`,
   `execute`, `gopark`, `goready`, `stopm`, `startm`, `wakep`. The file
   is ~6000 lines; skim by function name.
3. `runtime/chan.go` — full channel implementation. Pair with
   `runtime/select.go`.
4. `runtime/sema.go` — semaphore and treap.
5. `runtime/lock_futex.go` and `runtime/lock_sema.go` — the platform
   adapters. Read both to understand why the runtime carries two
   implementations.
6. `runtime/netpoll.go` — IO multiplexing (epoll/kqueue/iocp); shows how
   `gopark`/`goready` glue to the kernel's IO events.
7. `runtime/time.go` — timer heap, `goready` from timers.
8. `runtime/mgc.go`, `runtime/mbarrier.go` — GC. Optional for
   concurrency, mandatory for GC-aware concurrency tuning.

Reading these in this order gives you a complete picture of how every
goroutine-blocking standard library call gets serviced.

[← Back](../)
