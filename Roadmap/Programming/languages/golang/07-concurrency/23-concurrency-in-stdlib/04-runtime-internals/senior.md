---
layout: default
title: Runtime Internals Used by Stdlib — Senior
parent: Runtime Internals Used by Stdlib
grand_parent: Concurrency in Stdlib
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/23-concurrency-in-stdlib/04-runtime-internals/senior/
---

# Runtime Internals Used by Stdlib — Senior

[← Back](../)

This is the senior-engineer pass. You have read the runtime once. You know there
is an M:N scheduler, you know there is a netpoller, you have seen the timer heap
in `runtime/time.go`, you have read at least one race-detector report. What you
want is the bridge between those internals and the surface area of the standard
library: `net`, `time`, `context`, `sync`, `runtime/pprof`, `runtime/trace`. The
goal here is not to be exhaustive; the goal is to wire the pieces together so
that when you read a goroutine dump, a flame graph, or a TSan report, you know
which structure in the runtime produced it and which stdlib API put you there.

The structure follows the call chain a typical service walks every millisecond:
a goroutine calls `(*net.TCPConn).Read`, blocks in `netpoll`, gets unblocked by
an epoll wakeup, executes user code, hits a `time.NewTimer`, may emit profiling
samples on the way, and eventually triggers a SIGURG preempt from sysmon. We
walk that journey and stop at every component the stdlib depends on.

Everything in this document refers to Go 1.22 and the changes in Go 1.23 for
timers. Where the behavior is older we say so explicitly.

---

## 1. netpoll integration with stdlib `net`

### 1.1 The netpoll boundary

The runtime has a single, platform-independent interface that the rest of the
scheduler treats as a black box:

```go
// runtime/netpoll.go
//
// netpoll checks for ready network connections.
// Returns list of goroutines that become runnable.
// delay < 0: blocks indefinitely
// delay == 0: does not block, just polls
// delay > 0: block for up to that many nanoseconds
func netpoll(delay int64) gList
```

The platform-specific files plug a real implementation in:

```
runtime/netpoll_epoll.go      // Linux
runtime/netpoll_kqueue.go     // macOS, BSDs
runtime/netpoll_windows.go    // IOCP
runtime/netpoll_solaris.go    // /dev/poll
runtime/netpoll_aix.go        // pollset
runtime/netpoll_fake.go       // js/wasm
```

Each file defines `netpollinit`, `netpollopen(fd, *pollDesc)`, `netpollclose`,
and the actual `netpoll(delay)` that calls `epoll_wait` / `kevent` / etc. The
return type, `gList`, is a singly-linked list of runnable goroutines threaded
through `g.schedlink`. The scheduler treats the returned list as a batch of
work to inject.

The integration point for the rest of the scheduler is `findRunnable`:

```go
// runtime/proc.go, simplified shape
func findRunnable() (gp *g, inheritTime, tryWakeP bool) {
    // ... check local runq, global runq, work stealing ...

    // poll network if there is no local work
    if netpollinited() && netpollAnyWaiters() && sched.lastpoll.Load() != 0 {
        if list := netpoll(0); !list.empty() {
            gp := list.pop()
            injectglist(&list)
            casgstatus(gp, _Gwaiting, _Grunnable)
            return gp, false, false
        }
    }
    // ... stealing from other Ps ...

    // about to park; compute pollUntil from timers and call netpoll with a deadline
    delay := computePollDelay()
    list := netpoll(delay)
    if !list.empty() {
        injectglist(&list)
        // pick one to run on this M
        ...
    }
}
```

There are three distinct call sites for `netpoll`:

1. **Opportunistic poll** during `findRunnable`, with `delay=0`. This is cheap
   and prevents starvation of network-ready goroutines while CPU-bound work is
   running.
2. **Blocking poll** when the M is about to go idle. `delay` is the time until
   the next timer fires (or `-1` if no timers). When this returns, the M either
   has a goroutine to run, a timer to fire, or is woken by `netpollBreak`.
3. **Sysmon poll** every ~10ms as a safety net; see Section 7.

### 1.2 pollDesc — the per-FD bookkeeping

Every file descriptor that participates in netpoll has a `pollDesc`:

```go
// runtime/netpoll.go, abridged
type pollDesc struct {
    link *pollDesc      // free list link
    fd   uintptr        // OS-level fd

    atomicInfo atomic.Uint32  // closing, expired flags

    // rg, wg encode either:
    //   pdNil    (0)               - no goroutine waiting
    //   pdReady  (1)               - I/O ready, no goroutine yet
    //   pdWait   (2)               - goroutine about to park
    //   ptr to g                   - parked goroutine waiting
    rg atomic.Uintptr  // read goroutine
    wg atomic.Uintptr  // write goroutine

    lock    mutex      // protects following fields
    closing bool
    rrun    bool       // read timer armed
    wrun    bool       // write timer armed

    rseq    uintptr    // seqno for read timer
    rt      timer      // read deadline timer
    rd      int64      // read deadline (nanotime)
    wseq    uintptr
    wt      timer
    wd      int64
    self    *pollDesc  // stored in epoll_event.data, for the runtime to find us
}
```

Two facts about this struct are non-obvious:

- The `rg`/`wg` are tagged unions packed into a `uintptr`. The values `0`, `1`,
  `2` are reserved sentinels; any other value is a pointer to a `g`. The CAS
  dance in `netpollblock` is the choreography that parks a goroutine atomically
  with the FD readiness state.
- The `rt`/`wt` are runtime `timer` values stored *inside* the pollDesc. When
  you call `(*net.TCPConn).SetReadDeadline`, the runtime calls `modtimer` on
  `&pd.rt` directly; there is no allocation, no goroutine for the timer.

### 1.3 The block-and-park dance

The kernel-side semantics on Linux are edge-triggered (`EPOLLET`). When a
socket transitions from "not readable" to "readable", you get exactly one
edge. If you do not drain it now you will not get another edge until it
transitions again. Go uses this aggressively because it eliminates a
`EPOLL_CTL_MOD` per I/O.

The state machine for a read is:

```go
// runtime/netpoll.go, simplified
func netpollblock(pd *pollDesc, mode int32, waitio bool) bool {
    gpp := &pd.rg
    if mode == 'w' {
        gpp = &pd.wg
    }

    // set the gpp semaphore to pdWait
    for {
        // need to recheck error states after setting waitio
        if pd.closing {
            return false
        }
        old := gpp.Load()
        if old == pdReady {
            gpp.Store(pdNil)
            return true            // ready! no need to park
        }
        if old != pdNil {
            throw("netpollblock: double wait")
        }
        if gpp.CompareAndSwap(pdNil, pdWait) {
            break
        }
    }

    // park the goroutine; the unparker will CAS the goroutine pointer in
    if waitio || netpollcheckerr(pd, mode) == pollNoError {
        gopark(netpollblockcommit, unsafe.Pointer(gpp),
               waitReasonIOWait, traceBlockNet, 5)
    }
    // returned: either I/O ready, deadline expired, or closed
    old := gpp.Swap(pdNil)
    if old > pdWait {
        throw("netpollblock: corrupted state")
    }
    return old == pdReady
}
```

`gopark` switches off the goroutine, calls `netpollblockcommit` which CASes the
pdWait sentinel into the actual `*g` pointer, and the OS thread re-enters the
scheduler. When the kernel reports the FD readable, `netpoll` walks the events,
finds the `pollDesc` via the kernel event's user data, atomically swaps `rg`
back to `pdNil`, and emits the saved goroutine into the returned `gList`.

The same `pollDesc` slot is also poked by the *timer* if `SetReadDeadline`
fires: the timer's `f` is `netpollDeadline`, which marks `pd.atomicInfo` with
`pollExpiredReadDeadline` and wakes the read-waiter without any FD event. This
is how `i/o timeout` is delivered.

### 1.4 net/fd_posix.go — the user-visible side

Take `(*netFD).Read`:

```go
// net/fd_posix.go, abridged
func (fd *netFD) Read(p []byte) (n int, err error) {
    n, err = fd.pfd.Read(p)
    runtime.KeepAlive(fd)
    return n, wrapSyscallError(readSyscallName, err)
}

// internal/poll/fd_unix.go
func (fd *FD) Read(p []byte) (int, error) {
    if err := fd.readLock(); err != nil { return 0, err }
    defer fd.readUnlock()
    if len(p) == 0 { return 0, nil }
    if err := fd.pd.prepareRead(fd.isFile); err != nil { return 0, err }
    for {
        n, err := ignoringEINTRIO(syscall.Read, fd.Sysfd, p)
        if err != nil {
            n = 0
            if err == syscall.EAGAIN && fd.pd.pollable() {
                if err = fd.pd.waitRead(fd.isFile); err == nil {
                    continue
                }
            }
        }
        ...
        return n, err
    }
}
```

The pattern is: try a non-blocking `read(2)` first. If it returns data,
fast-path return; nothing touched the scheduler. If it returns `EAGAIN`, call
`waitRead`, which is the linkname into `runtime_pollWait`, which is the entry
point into the `netpollblock` we just saw. When the goroutine is unparked,
loop and retry the syscall.

There are several efficiency consequences of this design:

- **Idle goroutines cost very little.** A goroutine parked in `netpollblock`
  occupies a `g` struct (small, ~2KB stack) and one slot in a `pollDesc`. There
  is no kernel thread blocked on its behalf; the M moved on to other work.
- **A million idle connections work.** As long as you have ~2KB per goroutine
  and one FD per connection, the scheduler does not iterate over connections;
  the epoll kernel structure does.
- **One memcpy per read.** The syscall happens inline in the goroutine's stack;
  there is no I/O thread, no queue.

### 1.5 Cross-OS quirks

The `netpoll_windows.go` implementation is fundamentally different: IOCP is
**completion-based**, not readiness-based. The runtime issues overlapped reads
and the kernel notifies us when the read completes, with the bytes already in
the buffer. The runtime hides this behind the same `pollDesc` API; user-visible
behavior of `(*TCPConn).Read` is identical.

Solaris uses `/dev/poll`. AIX uses `pollset`. The `js/wasm` build provides a
fake implementation because the JS runtime drives I/O itself. The net
implication: do not assume `netpoll` always means epoll.

### 1.6 netpollBreak

Suppose an M is blocked in `netpoll(-1)` and a new timer is added on another P
whose fire time is earlier than the current poll deadline. The new timer
needs to wake that M. The mechanism is `netpollBreak`:

```go
// runtime/netpoll_epoll.go, abridged
var netpollBreakRd, netpollBreakWr uintptr // notification pipe

func netpollBreak() {
    for {
        var b byte
        n := write(netpollBreakWr, noescape(unsafe.Pointer(&b)), 1)
        if n == 1 || n == -_EAGAIN { break }
        if n == -_EINTR { continue }
        throw("netpollBreak: write failed")
    }
}
```

On Linux this is an `eventfd` or a self-pipe; on macOS it is `kevent` user
event. The reader side is a sentinel FD registered in epoll. When the
sleeping M's `epoll_wait` returns this FD, the runtime knows it's a wake-up,
discards the bytes, and recomputes the poll deadline.

---

## 2. Per-P timer wheel

### 2.1 Historical context

Pre-1.10 timers all lived in one global heap protected by a single mutex. This
was a notorious contention point: every `time.Sleep`, every `Reset`, every
deadline-bearing socket op went through `timerLock`. Two transitions fixed it:

- **Go 1.10**: 64 timer heaps, sharded by goroutine address. Reduced contention.
- **Go 1.14**: one timer heap *per P*. Locking is replaced by atomic CAS on a
  per-timer status word. The scheduler walks timers as part of `findRunnable`.
- **Go 1.23**: redesigned again to fix Reset/firing races with a generation
  counter, and to move timer storage off the P into a separately-allocated
  `timers` struct.

We describe the Go 1.22 state machine first, then note 1.23.

### 2.2 The struct on the P

```go
// runtime/runtime2.go (Go 1.22), abridged
type p struct {
    ...
    // Per-P timer heap. Lock held while modifying.
    timersLock mutex
    timers     []*timer
    numTimers      atomic.Uint32
    deletedTimers  atomic.Uint32
    timerRaceCtx   uintptr
    ...
}

// runtime/time.go
type timer struct {
    pp puintptr  // P that owns this timer

    when     int64
    period   int64
    f        func(any, uintptr)  // callback
    arg      any
    seq      uintptr

    nextwhen int64

    // The status field holds one of the timer{NoStatus,Waiting,...}
    // values below; transitions are by CAS.
    status atomic.Uint32
}
```

The `f` field is the callback. For `time.NewTimer` it is a function that sends
on the channel; for `time.AfterFunc` it is a function that goes off and
launches a goroutine for the user's callback; for `(*pollDesc).rt` it is
`netpollDeadline`.

### 2.3 The status state machine

```go
// runtime/time.go
const (
    timerNoStatus = iota   // not in any heap
    timerWaiting           // in heap, waiting to fire
    timerRunning           // running the timer's function
    timerDeleted           // removed but still in heap
    timerRemoving          // being removed from heap
    timerRemoved           // not in heap, ready to GC
    timerModifying         // in the middle of a modtimer
    timerModifiedEarlier   // modified to an earlier time
    timerModifiedLater     // modified to a later time
    timerMoving            // moving from one P to another
)
```

Why so many states? Because we want to support `Reset` and `Stop` from
arbitrary goroutines, without holding the P's `timersLock` for the duration of
the user-supplied callback, and without a mutex on every timer. The states
encode a small lock-free protocol:

- A `Reset` that races with the firing goroutine sees the timer in
  `timerRunning` and atomically transitions to `timerModifying`. The firing
  goroutine completes, observes the new state, and reschedules.
- A `Stop` that races with the heap fixup sees `timerMoving` and yields.
- `cleantimers` walks the heap occasionally to garbage-collect `timerDeleted`
  entries.

This is one of the densest pieces of lock-free engineering in the runtime.
It is also one of the historical sources of bugs; the Go 1.23 redesign
(below) was driven by edge cases discovered in 2020-2022.

### 2.4 The four key entry points

```go
// runtime/time.go
func addtimer(t *timer)
func deltimer(t *timer) bool
func modtimer(t *timer, when, period int64, f func(any, uintptr), arg any, seq uintptr) bool
func cleantimers(pp *p) bool
```

- `addtimer` claims the current goroutine's P, pushes the timer into the heap,
  and updates `pp.timer0When` so the scheduler's idle-wake logic notices it.
- `deltimer` does a CAS from `timerWaiting` to `timerDeleted`; the heap entry
  is removed lazily by `cleantimers` when the deleted count exceeds a fraction
  of the heap.
- `modtimer` is the workhorse: it handles both `Reset` on an active timer and
  the rare case where a timer needs to be moved between Ps.
- `cleantimers` runs from `runtimer` (see below) and prunes deleted entries.

### 2.5 runqtimers — when the scheduler fires timers

```go
// runtime/proc.go, simplified path
func findRunnable() (gp *g, ...) {
    ...
    // Step: fire any timers on _this_ P
    now, pollUntil, _ := checkTimers(pp, 0)
    ...
}

// runtime/time.go
func checkTimers(pp *p, now int64) (rnow, pollUntil int64, ran bool) {
    next := pp.timer0When.Load()
    if next == 0 {
        return now, 0, false
    }
    if now == 0 { now = nanotime() }
    if next > now {
        return now, next, false
    }

    lock(&pp.timersLock)
    if pp.timers != nil {
        adjusttimers(pp, now)
        for len(pp.timers) > 0 {
            if tw := runtimer(pp, now); tw != 0 {
                if tw > 0 { pollUntil = tw }
                break
            }
            ran = true
        }
        if int(pp.deletedTimers.Load()) > len(pp.timers)/4 {
            cleantimers(pp)
        }
    }
    unlock(&pp.timersLock)
    return now, pollUntil, ran
}
```

`runtimer` pops the heap root if its `when <= now`, transitions it through
`timerRunning`, invokes `t.f(t.arg, t.seq)`, and either re-adds it (periodic
ticker) or marks it `timerRemoved`. The whole loop is bounded by the heap's
log-N structure.

### 2.6 Sleeping the M

When an M cannot find work, it picks the smaller of (earliest timer's `when`)
and (forever) as the netpoll deadline:

```go
// runtime/proc.go, sketch
func stopm() {
    ...
    delay := int64(-1)
    if t := pollWhen(); t > 0 {
        delay = t - nanotime()
        if delay < 0 { delay = 0 }
    }
    list := netpoll(delay)
    if !list.empty() {
        injectglist(&list)
    }
    ...
}
```

So a sleeping M wakes on either:

- A timer reaching `when`
- A network FD becoming ready
- A `netpollBreak` wakeup (someone added a sooner timer or signaled work)

This is why a single mostly-idle Go program with a few sockets and a few
`time.Sleep` calls draws so little power: there are no spinning loops; the
runtime sits in `epoll_wait` with a timeout equal to the next timer.

### 2.7 Go 1.23 redesign

In 1.23 the timer was split into a smaller `timer` and a separate
`timers` struct on the P. The fields `when`, `period`, `f`, `arg`, `seq`,
`state` live in `runtime.timer`; the `runtime.Timer` exposed to `time.Timer`
holds `*timer` plus a sequence number. The redesign removes the race where
`Reset` could resurrect a timer that the firing goroutine had already begun
executing, and avoids losing wakeups in `time.NewTimer().Reset()` patterns.

The user-visible consequence is that in 1.23+, calling `Reset` on a
non-stopped, non-expired timer is now well-defined (previously the docs warned
against it). The internal mechanism: the timer carries a generation counter
that the firing goroutine compares against the latest before sending on the
channel.

---

## 3. The `time` package on top

The `time` package is a thin user-facing shell. The interesting code is in
`runtime/time.go`, accessed via `go:linkname`.

### 3.1 time.NewTimer

```go
// time/sleep.go, abridged
type Timer struct {
    C <-chan Time
    r runtimeTimer
}

func NewTimer(d Duration) *Timer {
    c := make(chan Time, 1)
    t := &Timer{
        C: c,
        r: runtimeTimer{
            when: when(d),
            f:    sendTime,
            arg:  c,
        },
    }
    startTimer(&t.r)
    return t
}

// sendTime is invoked by the runtime when the timer fires.
// Non-blocking send to a 1-buffered channel.
func sendTime(c any, seq uintptr) {
    select {
    case c.(chan Time) <- Now():
    default:
    }
}
```

Note: `c` is a 1-buffered channel; `sendTime` is *non-blocking*. If you do not
drain `t.C`, an extra firing is dropped, but the program does not deadlock.
This is significant for `for-select` patterns where the user code may be late.

### 3.2 time.AfterFunc

```go
func AfterFunc(d Duration, f func()) *Timer {
    t := &Timer{
        r: runtimeTimer{
            when: when(d),
            f:    goFunc,
            arg:  f,
        },
    }
    startTimer(&t.r)
    return t
}

func goFunc(arg any, seq uintptr) {
    go arg.(func())()
}
```

Two important properties:

- **`f` runs on a new goroutine, not on the timer goroutine.** This is on
  purpose: it isolates user code from the timer subsystem, so a slow `f` does
  not delay other timers on the same P. The trade-off is that every fire is
  a `go` statement; do not use `AfterFunc` for nanosecond-grade scheduling.
- **There is no goroutine sleeping waiting for the timer.** The timer just
  sits in the per-P heap; firing it goes through `runtimer` on the scheduler.

### 3.3 time.Sleep

```go
// time/sleep.go
func Sleep(d Duration)

// runtime/time.go
//go:linkname timeSleep time.Sleep
func timeSleep(ns int64) {
    if ns <= 0 { return }
    gp := getg()
    t := gp.timer
    if t == nil {
        t = new(timer)
        gp.timer = t
    }
    *t = timer{}
    t.when = nanotime() + ns
    t.f = goroutineReady
    t.arg = gp
    gp.sleepWhen = t.when
    if traceEnabled() { traceGoBlockSync(...) }
    gopark(resetForSleep, unsafe.Pointer(t), waitReasonSleep, traceBlockSleep, 1)
}

func goroutineReady(arg any, seq uintptr) {
    goready(arg.(*g), 0)
}
```

`time.Sleep` does not allocate a channel; it parks the goroutine with a
runtime timer whose `f` is `goroutineReady`, which simply calls `goready` on
the sleeping `g`. This is the cheapest possible sleep: no channel, no select,
no extra goroutine. If you only need a delay, `time.Sleep` is strictly
preferable to `<-time.After(d)`.

### 3.4 context.WithDeadline

In Go 1.21+ this is implemented with `time.AfterFunc`:

```go
// context/context.go, abridged
func WithDeadline(parent Context, d time.Time) (Context, CancelFunc) {
    c := &timerCtx{
        cancelCtx: newCancelCtx(parent),
        deadline:  d,
    }
    propagateCancel(parent, c)
    dur := time.Until(d)
    if dur <= 0 {
        c.cancel(true, DeadlineExceeded, nil)
        return c, func() { c.cancel(false, Canceled, nil) }
    }
    c.mu.Lock()
    defer c.mu.Unlock()
    if c.err == nil {
        c.timer = time.AfterFunc(dur, func() {
            c.cancel(true, DeadlineExceeded, nil)
        })
    }
    return c, func() { c.cancel(true, Canceled, nil) }
}
```

The `timer` field exists so the cancel func can call `c.timer.Stop()` to take
the timer out of the heap when the context is cancelled early. If you do not
cancel, the timer remains until it fires; in 1.20 and earlier this was a
common source of leaks because the timer kept the closure alive.

### 3.5 time.Ticker

`time.NewTicker` is `time.NewTimer` with `period != 0`. After each fire,
`runtimer` re-adds the timer with `when += period`. The channel is again
1-buffered and `sendTime` is non-blocking; tick events are dropped if the
consumer is slow. This is a feature: it means `Ticker` does not back up and
bloat memory under load.

Stopping a ticker still requires `ticker.Stop()` because the runtime timer
holds a reference to the channel; the GC will not collect either until you
explicitly stop.

---

## 4. Race detector internals

### 4.1 What it actually is

When you compile with `-race`, the compiler inserts a call before every memory
read and write:

```
raceread(addr)
racewrite(addr)
```

These are runtime functions that thunk into the C++ ThreadSanitizer (TSan)
library that ships with the Go toolchain (vendored from LLVM). TSan maintains:

- **Shadow memory.** For each application byte, ~8 bytes of metadata recording
  the goroutine ID and clock of the last access.
- **Vector clocks.** Each goroutine has a clock; happens-before relationships
  advance the clock; synchronization operations exchange clocks.
- **Sync objects.** Each sync.Mutex, channel, atomic-touched address gets a
  TSan sync object that carries a vector clock.

When `raceread(addr)` is called, TSan checks shadow memory for `addr`. If a
prior write was performed by another goroutine and our vector clock does not
include that goroutine's clock at the time of write, that is a race.

### 4.2 The runtime shim

```go
// runtime/race/race.go (build tag race)
//
//go:cgo_export_static __tsan_init_func __tsan_init_func
//go:cgo_import_static __tsan_init
//go:cgo_import_static __tsan_read
//go:cgo_import_static __tsan_write
//go:cgo_import_static __tsan_acquire
//go:cgo_import_static __tsan_release
//go:cgo_import_static __tsan_release_merge
//go:cgo_import_static __tsan_go_start
//go:cgo_import_static __tsan_go_end
//go:cgo_import_static __tsan_finalizer_goroutine
//go:cgo_import_static __tsan_func_enter
//go:cgo_import_static __tsan_func_exit
```

The runtime exposes Go-visible helpers:

```go
// runtime/race.go
//
//go:nosplit
func raceread(addr uintptr) {
    if getg().raceignore != 0 { return }
    if !raceenabled { return }
    racereadpc(unsafe.Pointer(addr), getcallerpc(), abi.FuncPCABIInternal(raceread))
}

func racewrite(addr uintptr) { ... }
func raceacquire(addr unsafe.Pointer) { ... }
func racerelease(addr unsafe.Pointer) { ... }
func racereleaseAcquire(addr unsafe.Pointer) { ... }
func racefuncenter(pc uintptr) { ... }
func racefuncexit() { ... }
```

### 4.3 How channels emit acquire/release

Inside `runtime/chan.go`:

```go
// chansend, abridged
func chansend(c *hchan, ep unsafe.Pointer, block bool, callerpc uintptr) bool {
    ...
    if raceenabled {
        racereleaseacquire(c.raceaddr())
    }
    ...
    if sg := c.recvq.dequeue(); sg != nil {
        // direct hand-off
        send(c, sg, ep, ...)
        return true
    }
    ...
}

func chanrecv(c *hchan, ep unsafe.Pointer, block bool) (selected, received bool) {
    ...
    if raceenabled {
        racereleaseacquire(c.raceaddr())
    }
    ...
}
```

Every send is a release on the channel's sync address; every receive is an
acquire. This is what gives the user the documented rule "a send happens-before
the corresponding receive completes." TSan reads this as: the receiver's
vector clock now includes the sender's at the moment of send. Subsequent
accesses by the receiver are compared against that newly-advanced clock.

### 4.4 How sync.Mutex emits acquire/release

In `sync/mutex.go`:

```go
// Lock
func (m *Mutex) Lock() {
    if atomic.CompareAndSwapInt32(&m.state, 0, mutexLocked) {
        if race.Enabled {
            race.Acquire(unsafe.Pointer(m))
        }
        return
    }
    m.lockSlow()
}

// Unlock
func (m *Mutex) Unlock() {
    if race.Enabled {
        _ = m.state
        race.Release(unsafe.Pointer(m))
    }
    new := atomic.AddInt32(&m.state, -mutexLocked)
    if new != 0 {
        m.unlockSlow(new)
    }
}
```

`race.Enabled` is `false` in non-race builds; the compiler eliminates the
branch. In race builds, the address of the mutex is the sync object; Lock is
acquire, Unlock is release. The vector clock attached to `unsafe.Pointer(m)`
carries the happens-before across goroutines.

`sync.RWMutex`, `sync.WaitGroup`, `sync.Once`, and `sync/atomic.Load*/Store*`
all emit the same calls into TSan at the right points.

### 4.5 The report format

A TSan race report includes:

```
WARNING: DATA RACE
Read at 0x00c0000... by goroutine 7:
  main.reader()
      main.go:12 +0x44

Previous write at 0x00c0000... by goroutine 6:
  main.writer()
      main.go:8 +0x44

Goroutine 7 (running) created at:
  main.main()
      main.go:18 +0x6e

Goroutine 6 (finished) created at:
  main.main()
      main.go:17 +0x42
```

TSan walks shadow memory and prints the PC of the last access. The runtime
shim translates PCs into Go function names via the symbol table. The
"synchronizes-before" section is omitted in the default report but is
available with `GORACE=history_size=N`; it shows which acquire/release events
TSan considered and which did not happen-before.

### 4.6 Cost and limits

A race-instrumented binary is 2-3x slower and uses 5-10x memory. There is a
hard limit of 8128 simultaneously-live goroutines (TSan internal `kMaxTid`),
though Go 1.19+ raised the practical limit. Race builds are for testing and
canaries, not production.

The detector is **sound** (no false positives — if it reports a race, there is
one) but **incomplete** (it only sees code that executed). Two writes to the
same address from different goroutines on different code paths are only
flagged if both happen during a test run.

---

## 5. CPU profiler

### 5.1 SIGPROF, the kernel side

```go
// runtime/cpuprof.go (approximately)
func SetCPUProfileRate(hz int) {
    lock(&cpuprof.lock)
    if hz < 0 { hz = 0 }
    if hz > 1000000 { hz = 1000000 }
    cpuprof.hz = int32(hz)
    if hz != 0 {
        setProcessCPUProfiler(hz) // wraps setitimer(ITIMER_PROF, ...)
    } else {
        setProcessCPUProfiler(0)
    }
    unlock(&cpuprof.lock)
}
```

The kernel delivers `SIGPROF` to the process at the configured rate (default
100 Hz). The signal is delivered to *some* thread; the kernel does not promise
which. Each M has a signal-handler trampoline (`sigtramp`) installed at
runtime startup.

### 5.2 The signal handler

When `SIGPROF` fires, the runtime's signal handler is entered on whichever M
was running:

```go
// runtime/signal_unix.go, abridged
func sigtrampgo(sig uint32, info *siginfo, ctx unsafe.Pointer) {
    ...
    if sig == _SIGPROF {
        sigprof(...)  // collect a sample
        return
    }
    ...
}

// runtime/proc.go
func sigprof(pc, sp, lr uintptr, gp *g, mp *m) {
    if prof.hz.Load() == 0 { return }
    ...
    // Walk the stack of the goroutine that was running when SIGPROF arrived.
    n := gentraceback(pc, sp, lr, gp, 0, &stk[0], maxCPUProfStack, ...)
    cpuprof.add(tag, stk[:n])
}
```

The stack walk runs *in the signal handler*. This is allowed because Go's
runtime carefully avoids allocations and locks inside `sigprof`. The result is
appended to a per-M lockless ring buffer in `cpuprof`.

### 5.3 The drainer goroutine

```go
// runtime/cpuprof.go
func (p *cpuProfile) addExtra() { ... }

// runtime/pprof/proto.go
func profileWriter(w io.Writer) {
    ...
    for {
        time.Sleep(100 * time.Millisecond)
        data, tags, eof := readProfile()
        if e := b.addCPUData(data, tags); e != nil { ... }
        if eof { break }
    }
    b.build()
}
```

A goroutine started by `runtime/pprof.StartCPUProfile` loops, calling
`runtime.readProfile()`, which drains the per-M buffers and returns the raw
samples. The goroutine pickles them into the pprof protobuf format and writes
them to the user-provided writer (`os.File`, `bytes.Buffer`, etc.).

### 5.4 Per-thread, not per-goroutine

A CPU profile records what was on-CPU when the signal fired. That is, it is
a **thread profile** filtered through Go's stack walker. Consequences:

- **Goroutines that are blocked on I/O, channels, or sleep are invisible.**
  They are off-CPU and SIGPROF will not pick them up. If your program spends
  90% wall-time blocked on a database query, `pprof` will show 100% CPU on the
  remaining 10%. This is correct! It is also commonly confusing.
- **CPU profiles do not measure scheduling latency.** For that you want
  `goroutine` profiles, `runtime.trace`, or the experimental `-gcflags=...`
  options.
- **Sample rate is global.** The 100 Hz default samples every M roughly 100
  times per second. With 32 cores you have up to 3200 samples per second; one
  sample is one full Go stack trace, so high-rate profiling has cost.

### 5.5 Block profile

A different mechanism. Enabled via `runtime.SetBlockProfileRate(rate)`:

```go
// rate is the average number of nanoseconds of blocking that triggers one
// sample. A rate of 1 records every event; rate of 0 disables.
```

Block events are recorded *inside* the runtime, at the point where a goroutine
goes from running to blocked. The runtime keeps a hash table keyed by the
stack trace of the blocking call site; each entry counts total blocked
duration and number of events.

The recorded sites are:

- `chan send`, `chan recv` (blocking) — `runtime/chan.go`
- `select` (blocking) — `runtime/select.go`
- `sync.Mutex.Lock` (contended) — `sync/mutex.go`
- `sync.RWMutex.{Lock,RLock}` (contended)
- `sync.WaitGroup.Wait`
- `sync.Cond.Wait`
- semrelease/semacquire — `runtime/sema.go`

Block profile data is read via `runtime.BlockProfile([]BlockProfileRecord)`.

### 5.6 Mutex profile

Yet another mechanism. Enabled via `runtime.SetMutexProfileFraction(rate)`.
This profile records who **holds** a mutex when a contended unlock happens
(i.e., when another goroutine is waiting). It is the "fault" side of
contention — the block profile shows you the waiters, the mutex profile shows
the holders.

Recorded sites:

- `sync.Mutex.unlockSlow`
- `sync.RWMutex.unlockSlow`

Data is read via `runtime.MutexProfile`.

### 5.7 Heap profile

For completeness. Heap samples are collected at every allocation with
probability proportional to the size (default rate `MemProfileRate = 512KB`),
in `mallocgc`:

```go
// runtime/malloc.go, sketch
func mallocgc(size uintptr, ...) unsafe.Pointer {
    ...
    if rate := MemProfileRate; rate > 0 {
        if c.nextSample -= int64(size); c.nextSample < 0 {
            profilealloc(mp, x, size)
        }
    }
    ...
}
```

`profilealloc` records the allocation's stack into an in-memory hash table.

---

## 6. runtime/trace

### 6.1 Goals

`go tool trace` shows you a Gantt chart of goroutines, GC, syscalls, I/O, all
on a microsecond-resolution timeline. For this to work the runtime needs to
emit events at every state transition without serializing through a global
lock.

### 6.2 Per-P trace buffers

```go
// runtime/trace.go (Go 1.22 implementation)
type traceBuf struct {
    link *traceBuf
    pos  int
    arr  [traceBufSize]byte
}

// Each P has a pair of buffers: one being filled, one being submitted.
type p struct {
    ...
    trace pTraceState
    ...
}

type pTraceState struct {
    buf    [2]*traceBuf
    inFlush bool
    ...
}
```

When code on a P emits a trace event, the runtime appends an LEB128-encoded
event to the current buffer with no lock — the buffer is owned by that P.
When the buffer fills, the runtime swaps to the alternate buffer and puts the
full one on a queue for the reader goroutine to flush. Two buffers per P
means trace event recording is non-blocking even during flush.

### 6.3 The event taxonomy

```go
// runtime/trace.go event constants (abridged)
const (
    traceEvGoCreate          = 40
    traceEvGoStart           = 41
    traceEvGoEnd             = 42
    traceEvGoStop            = 43
    traceEvGoBlockSend       = 44
    traceEvGoBlockRecv       = 45
    traceEvGoBlockSelect     = 46
    traceEvGoBlockSync       = 47
    traceEvGoBlockCond       = 48
    traceEvGoBlockNet        = 49
    traceEvGoSysCall         = 50
    traceEvGoSysExit         = 51
    traceEvGoSysBlock        = 52
    traceEvGoWaiting         = 53
    traceEvGoInSyscall       = 54
    traceEvHeapAlloc         = 55
    traceEvHeapGoal          = 56
    traceEvUnblock           = ...
    ...
)
```

Every event is emitted at the source. `traceGoBlockNet` is emitted from
`netpollblock` right before `gopark`; `traceGoUnblock` is emitted from
`netpollunblock` or `goready`; `traceGoSysCall` from `entersyscall`; etc.

### 6.4 Reconstruction

`go tool trace` reads the binary stream and builds a per-goroutine timeline.
For each goroutine it knows when it became runnable (Create or Unblock event),
when it was scheduled (GoStart), when it stopped (GoStop, GoEnd, GoBlock*).
For each P it knows what was running. For each M it knows what syscalls
fired.

The resulting Gantt chart is the most informative profiling artifact Go
produces. Reading it is how you discover that your "obviously parallel"
program is actually serialized on a Mutex inside a third-party library.

### 6.5 Cost

Trace recording adds ~10-30% overhead and produces ~1-10 MB of data per
second. It is intended for short captures (a few seconds), not for always-on
production observability. The Go 1.22 trace format (v2) is more compact and
parallel-readable than v1; the writer is lock-free per-P.

### 6.6 User events

```go
// runtime/trace package
trace.Start(w)
defer trace.Stop()

ctx, task := trace.NewTask(ctx, "request")
defer task.End()

trace.WithRegion(ctx, "db.query", func() {
    // ...
})
trace.Log(ctx, "request.id", reqID)
```

These propagate through the context and show up in the trace UI as colored
bands. They are how you correlate application-level operations with the
runtime-level timeline.

---

## 7. The sysmon goroutine

### 7.1 What it is

`sysmon` is a goroutine started at runtime initialization that runs **without
a P**. It is the runtime's housekeeping daemon, doing things that the
P-bound scheduler cannot do without recursion.

```go
// runtime/proc.go, sketch
func main() {
    ...
    if GOARCH != "wasm" {
        systemstack(func() {
            newm(sysmon, nil, -1)
        })
    }
    ...
}
```

`newm(sysmon, nil, -1)` creates an M whose entry point is the `sysmon`
function and that does not bind to a P.

### 7.2 What it does

```go
// runtime/proc.go, abridged
func sysmon() {
    ...
    for {
        if idle == 0 {
            delay = 20 // micro
        } else if idle > 50 {
            delay *= 2
        }
        if delay > 10*1000 {
            delay = 10 * 1000
        }
        usleep(delay)

        // 1. poll the network as a safety net
        if netpollinited() && lastpoll != 0 && lastpoll+10*1000*1000 < now {
            sched.lastpoll.CompareAndSwap(lastpoll, now)
            list := netpoll(0)
            if !list.empty() {
                injectglist(&list)
            }
        }

        // 2. retake Ps blocked in syscall or running too long
        if retake(now) != 0 {
            idle = 0
        } else {
            idle++
        }

        // 3. check GC pacing and finalizer triggering
        if t := (gcTrigger{kind: gcTriggerTime, now: now}); t.test() && gcphase == _GCoff {
            gcStart(t)
        }

        // 4. forced GC if hours have passed
        if forcegcperiod > 0 && lastgc+forcegcperiod < now {
            ...
        }

        // 5. scavenger
        ...
    }
}
```

So sysmon does five things you should know about:

1. **Netpoll safety net.** If no M has called `netpoll` in 10ms, sysmon does
   it. Without this, a busy program with no idle M could leave network events
   unhandled for arbitrarily long.
2. **Preemption.** Sysmon walks the P list; if a P has been running the same
   goroutine for >10ms, sysmon signals preemption. Since Go 1.14 this uses
   `SIGURG` (signal-based async preemption); pre-1.14 it set a flag the
   goroutine would check at function prologues.
3. **Syscall handoff.** If a P has been in a syscall for too long, sysmon
   takes the P away and gives it to another M. The blocked M will get a new P
   when its syscall returns.
4. **GC pacing.** Triggers the next GC cycle when the heap growth target is
   reached. Also triggers `runtime.GC()` if 2 minutes have passed without a
   cycle.
5. **Memory scavenging.** Returns unused pages to the OS.

### 7.3 SIGURG preemption

Async preemption is one of the few cases where Go uses signals to interrupt
user code. The sequence:

```go
// runtime/preempt.go, sketch
func preemptM(mp *m) {
    if mp.signalPending.CompareAndSwap(0, 1) {
        signalM(mp, sigPreempt)  // SIGURG
    }
}

// runtime/signal_unix.go, on SIGURG:
func doSigPreempt(gp *g, ctxt *sigctxt) {
    if wantAsyncPreempt(gp) {
        if ok, newpc := isAsyncSafePoint(gp, ctxt.sigpc(), ctxt.sigsp(), ctxt.siglr()); ok {
            ctxt.pushCall(asyncPreempt, newpc)
        }
    }
}
```

On the signal, the runtime checks whether the goroutine is at an
"async-safe-point" — a PC where the stack is consistent enough to be unwound.
If so, the runtime rewrites the signal context to make the goroutine, on
return from the signal handler, jump into `asyncPreempt`, which calls
`mcall(gopreempt_m)` and yields the P. If not, the signal is dropped and
sysmon will try again next tick.

This is why pre-1.14 a `for {}` loop could deadlock a Go program: there were
no preemption points. Since 1.14, sysmon's SIGURG breaks out of arbitrary
user code.

### 7.4 sysmon and netpoll interplay

Imagine a 32-core machine where all 32 Ms are doing CPU-bound work and there
is one parked goroutine blocked on a network read. When the FD becomes
readable, none of the 32 Ms is in `netpoll`. The kernel buffers the readable
event, but no Go code knows. Sysmon's 10ms safety-net poll discovers it and
calls `injectglist` to make the parked goroutine runnable. One of the 32 Ms
will pick it up at its next `findRunnable`.

Without sysmon, that goroutine would be starved indefinitely.

---

## 8. Putting it together — a request lifecycle

Let us trace a single HTTP request through the stdlib and runtime to see
which subsystems light up.

```go
// User code
func handler(w http.ResponseWriter, r *http.Request) {
    body, err := io.ReadAll(r.Body)
    if err != nil { http.Error(w, err.Error(), 500); return }

    ctx, cancel := context.WithTimeout(r.Context(), 100*time.Millisecond)
    defer cancel()

    resp, err := http.NewRequestWithContext(ctx, "GET", upstreamURL, nil)
    // ...
    w.Write([]byte("ok"))
}
```

The journey:

1. **Accept.** A goroutine serving the `http.Server` is parked in
   `(*netFD).Accept` -> `(*pollDesc).waitRead`, which is `gopark`. The
   listening socket becomes readable; epoll returns; `netpoll` produces this
   goroutine in a gList; some M schedules it. It calls `accept4(2)`, gets a
   new FD, calls `newPollDesc` to register the FD, spawns a new goroutine to
   serve the connection.
2. **Read request.** The connection-serving goroutine calls
   `(*bufio.Reader).ReadLine`. First read returns `EAGAIN`; the goroutine
   parks in `netpollblock`. Bytes arrive, the FD becomes readable, an M in
   `netpoll` retrieves it, the goroutine is enqueued.
3. **WithTimeout.** Calls `time.AfterFunc(100ms, ...)` which goes through
   `runtime.startTimer`. Some current P's `timers` heap has a new entry. The
   firing goroutine, if scheduled, will eventually call `c.cancel(...)`. The
   M that is currently parked in `netpoll(-1)` may need to wake up earlier;
   `addtimer` calls `wakeNetPoller` which calls `netpollBreak`.
4. **Upstream request.** `http.Client.Do` opens a TCP connection. New
   `pollDesc`, more `netpollblock` parks. The Read/Write deadlines from the
   context are applied via `(*netFD).SetReadDeadline`, which writes to
   `pd.rd` and calls `modtimer(&pd.rt, ...)`. Now there are *two* timers on
   the P's heap: the context's `AfterFunc`, and the FD's read-deadline
   timer.
5. **Write response.** `w.Write` goes through `(*netFD).Write` ->
   `internal/poll.(*FD).Write` -> nonblocking `write(2)`, which usually
   succeeds without parking.
6. **Connection close.** `(*pollDesc).close` removes the FD from epoll and
   reclaims the pollDesc into a free list.
7. **In parallel:** If you compiled with `-race`, every read of `r.Body`,
   every Mutex Lock in `net/http`, every channel send in
   `(*http.connReader).backgroundRead` was emitting acquire/release events
   into TSan, advancing vector clocks.
8. **In parallel:** if you ran `pprof.StartCPUProfile`, SIGPROF fired
   approximately 10 times during this request (assuming 100 Hz, 100ms
   total), each producing a stack sample.
9. **In parallel:** sysmon ticked 10 times, each time poking netpoll as a
   safety net.

Every stdlib API touched at least one runtime structure described above.
That is what the standard library is — a thin user-visible skin over the
runtime, with the runtime providing the actually-hard concurrency
primitives.

---

## 9. Pitfalls and engineering consequences

### 9.1 Don't fight the netpoller

A common anti-pattern is to set socket FDs to blocking mode via raw
`syscall.SetNonblock(fd, false)` because some library "needs" blocking
semantics. This pulls the FD out of the netpoller. The goroutine that does
`read(2)` now blocks an entire OS thread. Under load you can drain the
default M pool.

If a library wants blocking, give it a separate goroutine and let it block;
that is one thread per blocking call, which is still cheaper than one
goroutine per call, but it bounds the cost.

### 9.2 Timer leaks

Pre-1.23, the `time.NewTimer().Reset()` pattern was easy to get wrong; the
docs warned `Reset should be invoked only on stopped or expired timers`. The
practical advice was:

```go
if !t.Stop() {
    select { case <-t.C: default: }
}
t.Reset(d)
```

In 1.23+ this is no longer required, but if you target older Go versions, a
misuse here can leak goroutines holding `Timer` references.

A second leak: `context.WithDeadline` with no `cancel` call. The
`time.AfterFunc` registered for the deadline runs even after the parent
goroutine has finished; it holds the `*timerCtx`, which holds the parent's
cancel func, which is a closure on the parent's frame.

### 9.3 Profile interpretation

Three rules:

1. **CPU profile shows on-CPU work.** If wall-clock latency is dominated by
   blocking, CPU profile is misleading.
2. **Block profile shows wait time.** Useful when you suspect lock or
   channel contention.
3. **Trace shows everything in time.** When you do not know what to look
   for, start with a 1-second trace.

For latency tail problems, the trace is irreplaceable. For "make this
function faster" problems, the CPU profile is enough.

### 9.4 Race detector in CI

A standard CI matrix runs the test suite both with and without `-race`. The
race build is 2-3x slower, so allocate budget accordingly. Some tests are
flaky only under `-race` because of timing changes — usually those are
genuine bugs being uncovered, not detector bugs.

Do not ship `-race` to production. The detector has not been audited as a
production runtime; its goal is precision in debug builds.

### 9.5 Trace overhead in production

Recording a continuous trace costs ~10-30%. A common pattern is to expose a
HTTP endpoint that captures a 5-second trace on demand:

```go
import _ "net/http/pprof"
// curl http://host:port/debug/pprof/trace?seconds=5 > trace.out
// go tool trace trace.out
```

This is in `net/http/pprof` already; you just have to import for the side
effect of registering the handlers.

### 9.6 sysmon vs SIGURG vs cooperative preemption

If you build a Go program with `GODEBUG=asyncpreemptoff=1` you turn off SIGURG
preemption and fall back to the pre-1.14 cooperative model. This is mostly
useful for debugging — a tight loop will deadlock without sysmon. In
production, leave it on.

If you embed Go via cgo or use it inside another runtime, SIGURG handling can
collide with the host runtime's signal handlers. The runtime carefully
chains, but be aware: a misbehaving cgo callback that installs its own
SIGURG handler will break preemption.

---

## 10. Reading the source

If you want to read the runtime to follow along, here is the order I
recommend.

1. `runtime/proc.go` — the scheduler. Search for `schedule()` and
   `findRunnable()`. About 7000 lines, but skim the first 1000 to get
   landmarks.
2. `runtime/runtime2.go` — the type definitions. `g`, `m`, `p`, `schedt`.
   Read the field comments.
3. `runtime/netpoll.go` — the platform-independent netpoll. Then
   `netpoll_epoll.go` for Linux.
4. `runtime/time.go` — the timer wheel. Start at `addtimer`, then
   `runtimer`, then `cleantimers`.
5. `runtime/chan.go` — channel send/recv. About 800 lines; readable in one
   sitting.
6. `runtime/sema.go` — semaphores. Foundation for `sync.Mutex` and
   `sync.Cond`.
7. `runtime/lock_sema.go` and `runtime/lock_futex.go` — the runtime's own
   `mutex` (not `sync.Mutex`!). Note Go runtime mutex is a futex on Linux.
8. `sync/mutex.go`, `sync/rwmutex.go`, `sync/waitgroup.go` — the stdlib
   layer on top of `runtime_Semacquire`.
9. `net/fd_posix.go` and `internal/poll/fd_unix.go` — the stdlib net layer.
10. `runtime/cpuprof.go`, `runtime/trace.go`, `runtime/race.go` — profiler
    and tracer.

Read each file with one question: "what synchronization primitive does this
ultimately rest on?" Almost everything bottoms out in
`atomic.{Cas,Load,Store}`, `runtime.semacquire`, `gopark`/`goready`, or
`netpoll`.

---

## 11. Worked example — building intuition for the timer races

The Go 1.23 redesign was driven by patterns like the following. Read it
carefully; the bug is not obvious.

```go
// PRE-1.23 INCORRECT IDIOM (relied on undocumented behavior)
var t *time.Timer
t = time.AfterFunc(d, func() {
    t.Reset(d) // schedule self-repetition; but t may have been Stopped
})
```

The author meant: "fire every d, but let me Stop it." The bug: if `Stop`
returns false (timer already firing), the `Reset` inside the callback wins,
re-arming a timer the user thought was dead. Internally, the firing goroutine
was in `timerRunning` state; the user's `Stop` saw `timerRunning` and
transitioned to `timerDeleted`; then the firing callback issued
`startTimer` again, re-inserting into the heap with a fresh status. The user
now has a "Stopped" timer that fires.

The 1.23 fix puts a generation counter on the timer. `Stop` increments the
generation; the firing goroutine, before doing anything user-visible, checks
that its generation matches the timer's current generation. If not, the
firing is silently dropped. This makes `Stop` actually stop, even from
inside the callback.

Lesson for senior code: timer libraries are not as simple as they look.
When you reach for `time.AfterFunc`, audit your `Stop`/`Reset` interactions
carefully, especially across goroutines.

---

## 12. Worked example — a netpoll-friendly TCP echo

```go
package main

import (
    "io"
    "log"
    "net"
)

func main() {
    ln, err := net.Listen("tcp", ":7000")
    if err != nil { log.Fatal(err) }
    for {
        c, err := ln.Accept()
        if err != nil { log.Fatal(err) }
        go handle(c)
    }
}

func handle(c net.Conn) {
    defer c.Close()
    io.Copy(c, c)
}
```

This 16-line program scales to ~100k concurrent connections on a single
machine. Why? Walk the runtime path:

- `ln.Accept` parks the listener goroutine in netpoll. One park.
- Each `go handle(c)` spawns a goroutine. ~2KB each.
- Inside `io.Copy`, `c.Read` blocks via netpoll, `c.Write` mostly does not
  block (kernel has buffer).
- All blocked goroutines are off-CPU. The Ms cycle through whichever
  goroutines are runnable.
- Timers? None (no deadlines). Race? None. Trace? None.
- The scheduler is doing about `O(connections_with_pending_data)` work per
  epoll wake, not `O(total_connections)`.

The same program in a thread-per-connection language (Java pre-Loom, C
without epoll) would consume tens of GB and saturate the kernel at 100k
threads. Go's runtime structure described in this document is what makes the
16-line version actually work.

---

## 13. Worked example — diagnosing a tail-latency problem

You have a service whose p99 latency is 200ms; p50 is 2ms. CPU is 30%. The
trace is the answer; here is how to read it.

1. Capture: `curl ".../debug/pprof/trace?seconds=5" > trace.out` during a load
   test that produces the bad p99.
2. Open: `go tool trace trace.out`.
3. Pick a Goroutine analysis. Sort by total wall time descending.
4. For the top goroutine, look at the timeline. Long horizontal "blocked"
   bars are your enemy.

Common findings:

- **GC mark-assist.** The trace shows your goroutines pausing during GC.
  `MARK ASSIST` is a goroutine being conscripted to help the GC because it
  allocated faster than the dedicated GC worker can scan. Fix: reduce
  allocation rate or raise `GOGC`.
- **Network blocking.** Long bars on "GoBlockNet" — that is, your goroutine
  is parked in `netpollblock`. If those bars correlate with backend slowness,
  your problem is downstream.
- **Mutex contention.** Long bars on "GoBlockSync" — your goroutine is in
  `semacquire1` from `sync.Mutex.Lock`. Block profile confirms; mutex
  profile names the holder.
- **Channel contention.** "GoBlockSend"/"GoBlockRecv" — you have a hot
  channel. Often a sign of an unintentional fan-in.
- **No P available.** "GoWaiting" without an obvious blocker — your service
  is CPU-bound and there are more runnable goroutines than Ps.

Each diagnosis comes from a runtime event documented above. The reason
the trace works is that every state transition emits an event into the
per-P trace buffer, lock-free.

---

## 14. A note on `GODEBUG`

Several flags expose runtime internals at runtime:

- `GODEBUG=schedtrace=1000,scheddetail=1` — every second, print the
  scheduler state to stderr: G/M/P counts, per-P queue lengths.
- `GODEBUG=gctrace=1` — every GC cycle, print a one-line summary.
- `GODEBUG=netdns=2` — enable verbose DNS lookups.
- `GODEBUG=asyncpreemptoff=1` — disable SIGURG preemption.
- `GODEBUG=tracebackancestors=N` — show N levels of "who created this
  goroutine" in panics.
- `GODEBUG=cgocheck=2` — strict cgo pointer checking.
- `GODEBUG=madvdontneed=1` — change scavenger MADV behavior.

These are senior tools; do not enable them in production except briefly to
diagnose. `schedtrace=1000` is the closest thing Go has to `strace` for the
scheduler.

---

## 15. Closing — what this document is not

This document does not cover:

- The garbage collector mark phase in detail (write barrier, tri-color
  invariant). That belongs in a GC document.
- Escape analysis. That is a compiler topic.
- The internal `runtime.mutex` (futex-based) vs `sync.Mutex` distinction.
  Briefly: `runtime.mutex` is for runtime-internal use only and is
  uncontended-fast; `sync.Mutex` is for user code and integrates with
  `semacquire` for the slow path.
- The unsafe pointer rules for cgo. That is `cmd/cgo` territory.

What it does cover is the connective tissue between stdlib APIs and runtime
internals, which is the layer most engineers find under-documented. If you
have read to here, you should be able to:

- Pick any blocking stdlib call and predict which runtime state machine it
  parks in.
- Read a goroutine dump and recognize `IO wait`, `chan send`,
  `chan receive`, `semacquire`, `sleep`, `GC assist wait`, `runnable`, and
  know what produced each state.
- Read a trace.out and follow a request goroutine end to end.
- Read a TSan report and identify whether the missing happens-before is in
  application code, in a sync primitive, or in a channel.
- Decide between block profile, mutex profile, CPU profile, and trace for a
  given symptom.

That is what "senior" means for this topic: not knowing every line of the
runtime, but knowing which file to open and which struct's invariants to
consult when a production incident lands at 3am.

---

## Appendix A — quick reference table

| stdlib API | Runtime mechanism | Parks via | Wakes via |
|---|---|---|---|
| `time.Sleep` | timer | gopark on timer | `goroutineReady` from `runtimer` |
| `time.After` / `NewTimer.C` | timer + channel | gopark on chan recv | `sendTime` from `runtimer` |
| `time.AfterFunc` | timer + new goroutine | n/a | `goFunc` spawns goroutine |
| `time.Tick` / `Ticker` | periodic timer + channel | gopark on chan recv | `sendTime`, re-arms timer |
| `context.WithTimeout` | `time.AfterFunc` | n/a (sets ctx.Err) | callback calls `cancel` |
| `<-chan` (empty) | chan recv | gopark in `chanrecv` | sender's `goready` |
| `chan <-` (full) | chan send | gopark in `chansend` | receiver's `goready` |
| `select{}` (no default) | select | `gopark` in `selectgo` | first ready case |
| `sync.Mutex.Lock` (contended) | sema | `semacquire1` -> gopark | unlock's `semrelease1` |
| `sync.Cond.Wait` | sema | gopark on cond's notifyList | Signal/Broadcast |
| `sync.WaitGroup.Wait` | sema | gopark | last `Done` |
| `sync.Once.Do` | atomic + mutex | usually no park | n/a |
| `net.Conn.Read` (EAGAIN) | netpoll | `netpollblock` | epoll/kqueue ready |
| `net.Conn.Write` (EAGAIN) | netpoll | `netpollblock` | epoll/kqueue writable |
| `net.SetReadDeadline` | timer attached to pollDesc | n/a (sets pd.rd) | timer fires `netpollDeadline` |
| `os.Read` on a pipe | netpoll (since 1.9 for pipes) | `netpollblock` | epoll ready |
| `runtime.Gosched` | scheduler yield | `gopark` then `goready` | self |
| `runtime.GC` | GC | gopark on gc finished | GC mark/sweep completion |
| Garbage collection mark assist | GC | gopark on assist credit | GC scan progress |

---

## Appendix B — files to open in your editor right now

If you are about to debug something:

- A blocked goroutine that "should not be blocked" — open
  `runtime/runtime2.go` and read the `g.waitreason` enumeration; cross
  reference the value from `goroutine` profile.
- A profile that says 80% in `runtime.gcBgMarkWorker` — open
  `runtime/mgcmark.go`.
- A profile that says 80% in `runtime.findRunnable` — your scheduler is
  spinning looking for work; open `runtime/proc.go`, `findRunnable`. Often
  caused by overprovisioned `GOMAXPROCS`.
- A trace where a goroutine sits in "GoBlockNet" for 10s — your downstream
  is slow, or you forgot a deadline; check `internal/poll/fd_unix.go`.
- A trace where `gomaxprocs` Ps are all in syscall — sysmon will take Ps
  away (see `runtime/proc.go:retake`); open `runtime/proc.go` and search
  for `retake`.

---

## Appendix C — historical timeline

- **Go 1.1 (2013).** First scheduler with work stealing; per-P run queues.
- **Go 1.5 (2015).** GOMAXPROCS defaults to NumCPU. Concurrent GC.
- **Go 1.9 (2017).** Pipes go through netpoll on Unix.
- **Go 1.10 (2018).** Sharded timer heaps (64 of them).
- **Go 1.14 (2020).** Per-P timer heap. SIGURG async preemption.
- **Go 1.17 (2021).** Register-based ABI; faster function calls.
- **Go 1.18 (2022).** Generics; new internal stack frame format.
- **Go 1.19 (2022).** Soft memory limit (`GOMEMLIMIT`). Race detector
  scaling improvements.
- **Go 1.21 (2023).** `context.WithDeadline` uses `time.AfterFunc`. New
  trace v2 format introduced experimentally.
- **Go 1.22 (2024).** Trace v2 default. Loopvar semantics (separate from
  runtime but affects goroutine-creation patterns).
- **Go 1.23 (2024).** Timer redesign with generation counters. Iterator
  pattern (`range func`). The `unique` package.

Each release typically tweaks the scheduler and netpoller; reading the
release notes for "runtime" and "compiler" is the cheapest way to stay
current.

---

## Appendix D — common GODEBUG cheats during incidents

When the service is misbehaving and you have shell access:

```
# scheduler state every second
GODEBUG=schedtrace=1000 ./service

# detailed per-P state
GODEBUG=schedtrace=1000,scheddetail=1 ./service

# every GC cycle
GODEBUG=gctrace=1 ./service

# print info on every preemption
GODEBUG=asyncpreemptoff=0,schedtrace=100 ./service

# turn off CGO pointer checks (DANGEROUS, debug only)
GODEBUG=cgocheck=0 ./service
```

The `schedtrace` output is the most useful one to know by sight:

```
SCHED 4014ms: gomaxprocs=8 idleprocs=0 threads=23 spinningthreads=0 idlethreads=12
runqueue=0 [0 0 0 0 0 0 0 0]
```

- `gomaxprocs` = your P count.
- `idleprocs` = how many Ps are sitting around looking for work.
- `threads` = total OS threads (Ms).
- `idlethreads` = Ms parked, waiting to be reused.
- `runqueue` = global runq length.
- `[0 0 0 ...]` = per-P local runq lengths.

A pattern of `idleprocs=8` and `runqueue=100` means your goroutines are not
making it from the global queue to the Ps fast enough — usually you have
single-G producer of work and the work-stealing has not kicked in yet.

---

## Appendix E — read-with-debugger exercises

Two short exercises to cement the material. You do not have to actually run
them; reading the source while imagining the execution is enough.

**Exercise 1.** Open `runtime/chan.go` and `runtime/proc.go`. Trace what
happens when goroutine A executes `ch <- 1` on an unbuffered channel where
goroutine B is parked in `<-ch`. Specifically:

1. Which function does A call?
2. Where is the queued receiver `sg` dequeued from?
3. Which function copies the value?
4. Where does A's path call `goready(sg.g, 0)`?
5. Where does B get put back on a runq?

Expected answer: `chansend` -> `c.recvq.dequeue()` -> `sendDirect` ->
`goready` -> `ready` -> `runqput(_p_, gp, true)`.

**Exercise 2.** Open `internal/poll/fd_unix.go` and `runtime/netpoll.go`.
Trace what happens when:

1. `(*FD).Read` returns `EAGAIN`.
2. Where does it call `waitRead`?
3. Where does `waitRead` enter the runtime?
4. Where in the runtime does the goroutine park?
5. Where does `netpoll` (on the next epoll_wait) find the parked goroutine
   to wake?

Expected answer: `(*FD).Read` -> `fd.pd.waitRead(fd.isFile)` ->
`runtime_pollWait` (linkname) -> `poll_runtime_pollWait` ->
`netpollblock` -> `gopark`. On wake side: `netpoll` -> `netpollready` ->
gList accumulation -> returned to `findRunnable`.

---

## Appendix F — the bridge between `sync.Mutex` and the runtime

`sync.Mutex` deserves a careful walk because it is the primitive most
user code touches and because its implementation is a microcosm of how
the stdlib leans on the runtime.

```go
// sync/mutex.go (Go 1.22, abridged)
type Mutex struct {
    state int32
    sema  uint32
}

const (
    mutexLocked      = 1 << 0
    mutexWoken       = 1 << 1
    mutexStarving    = 1 << 2
    mutexWaiterShift = 3

    starvationThresholdNs = 1e6
)

func (m *Mutex) Lock() {
    if atomic.CompareAndSwapInt32(&m.state, 0, mutexLocked) {
        if race.Enabled {
            race.Acquire(unsafe.Pointer(m))
        }
        return
    }
    m.lockSlow()
}

func (m *Mutex) lockSlow() {
    var waitStartTime int64
    starving := false
    awoke := false
    iter := 0
    old := m.state
    for {
        if old&(mutexLocked|mutexStarving) == mutexLocked && runtime_canSpin(iter) {
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
                break // locked by CAS
            }
            queueLifo := waitStartTime != 0
            if waitStartTime == 0 {
                waitStartTime = runtime_nanotime()
            }
            runtime_SemacquireMutex(&m.sema, queueLifo, 1)
            starving = starving || runtime_nanotime()-waitStartTime > starvationThresholdNs
            old = m.state
            if old&mutexStarving != 0 {
                // We were woken by the previous owner under starvation;
                // we own the lock now.
                ...
                break
            }
            awoke = true
            iter = 0
        } else {
            old = m.state
        }
    }
    if race.Enabled {
        race.Acquire(unsafe.Pointer(m))
    }
}
```

Walk it slowly:

- **Fast path.** Single CAS, zero allocations, no system call. This is the
  case most uncontended Lock calls take. The race-enabled build inserts a
  `race.Acquire`; non-race build elides it.
- **Spin path.** `runtime_canSpin` is a linkname into the runtime that
  checks whether spinning is sensible (active spinning is forbidden on
  uniprocessor systems and when the local P has work waiting). If allowed,
  `runtime_doSpin` runs ~30 iterations of `PAUSE` (x86) / `YIELD` (arm).
  Spinning amortizes the cost of mode-switching for short critical sections.
- **Park path.** `runtime_SemacquireMutex` is the linkname into
  `runtime.sync_runtime_SemacquireMutex`, which calls `semacquire1` in
  `runtime/sema.go`. That function manipulates a per-`sema-address`
  tree-treap of waiters and ultimately calls `gopark`. The waiter is now
  off-CPU; another M is free to do work.
- **Starvation mode.** A waiter that has been blocked for >1ms flips the
  mutex into "starvation" mode. In starvation mode, `Unlock` hands the lock
  *directly* to a waiter, bypassing the normal CAS-race-with-new-arrival
  contest. This bounds tail-latency on the lock.

The unlock side:

```go
func (m *Mutex) Unlock() {
    if race.Enabled {
        _ = m.state
        race.Release(unsafe.Pointer(m))
    }
    new := atomic.AddInt32(&m.state, -mutexLocked)
    if new != 0 {
        m.unlockSlow(new)
    }
}

func (m *Mutex) unlockSlow(new int32) {
    if (new+mutexLocked)&mutexLocked == 0 {
        fatal("sync: unlock of unlocked mutex")
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
        runtime_Semrelease(&m.sema, true, 1)
    }
}
```

`runtime_Semrelease` is linkname into `runtime.sync_runtime_Semrelease` ->
`semrelease1`, which finds a parked waiter on `&m.sema`, makes it runnable
via `goready`, and returns. The waiter's M is signaled to wake up and run
that goroutine.

The `sema` is `uint32` because the runtime keys waiters by the address of
that uint32; the value itself does not encode much. The treap-of-waiters in
`runtime/sema.go` is the actual queue. Multiple sync primitives —
`sync.Cond`, `sync.RWMutex`, `sync.WaitGroup`, even `runtime.notifyList` —
all share this semaphore subsystem.

The lesson: when you read `sync.Mutex.Lock`, you should immediately think
"this might call into `semacquire1`, which might call `gopark`, which might
let another goroutine run on this M." That is a deeper picture than "Lock
takes a lock."

## Appendix G — the bridge between channels and the runtime

A symmetric walk for channels:

```go
// runtime/chan.go (abridged, send path)
func chansend(c *hchan, ep unsafe.Pointer, block bool, callerpc uintptr) bool {
    if c == nil {
        if !block { return false }
        gopark(nil, nil, waitReasonChanSendNilChan, traceBlockForever, 2)
        throw("unreachable")
    }
    if !block && c.closed == 0 && full(c) {
        return false
    }
    lock(&c.lock)
    if c.closed != 0 {
        unlock(&c.lock)
        panic(plainError("send on closed channel"))
    }
    if sg := c.recvq.dequeue(); sg != nil {
        // direct hand-off: copy ep -> sg.elem and wake sg.g
        send(c, sg, ep, func() { unlock(&c.lock) }, 3)
        return true
    }
    if c.qcount < c.dataqsiz {
        // buffered enqueue
        qp := chanbuf(c, c.sendx)
        typedmemmove(c.elemtype, qp, ep)
        c.sendx++
        if c.sendx == c.dataqsiz { c.sendx = 0 }
        c.qcount++
        unlock(&c.lock)
        return true
    }
    if !block {
        unlock(&c.lock)
        return false
    }
    // park: build sudog, enqueue in sendq, gopark
    gp := getg()
    mysg := acquireSudog()
    mysg.elem = ep
    mysg.g = gp
    mysg.c = c
    gp.waiting = mysg
    c.sendq.enqueue(mysg)
    atomic.Store8(&gp.parkingOnChan, 1)
    gopark(chanparkcommit, unsafe.Pointer(&c.lock),
        waitReasonChanSend, traceBlockChanSend, 2)
    KeepAlive(ep)
    if mysg != gp.waiting { throw("G waiting list is corrupted") }
    gp.waiting = nil
    closed := !mysg.success
    gp.param = nil
    if mysg.releasetime > 0 {
        blockevent(mysg.releasetime-t0, 2)
    }
    mysg.c = nil
    releaseSudog(mysg)
    if closed {
        if c.closed == 0 { throw("chansend: spurious wakeup") }
        panic(plainError("send on closed channel"))
    }
    return true
}
```

Five interesting things:

1. **`acquireSudog`/`releaseSudog`** is a per-P cache of `sudog` structs
   (one per blocking party in a channel/select). Avoids hitting the
   allocator on the hot path.
2. **Lock is `runtime.mutex`, not `sync.Mutex`.** The runtime's own mutex
   is futex-backed and very fast for short holds; it never recurses into
   the scheduler. `sync.Mutex` cannot be used here because it would
   recurse: `sync.Mutex.Lock` calls into the runtime, and the runtime
   would deadlock on itself.
3. **Direct hand-off in `send(c, sg, ep, ...)`.** If a receiver is parked,
   the sender writes directly into the receiver's stack frame
   (`sg.elem` points there) and then calls `goready(sg.g, ...)`. This is
   the famous "channel hand-off" that skips the buffer.
4. **`gopark` with `chanparkcommit`.** `chanparkcommit` is the function
   the scheduler calls *after* it has detached the goroutine from its M;
   it unlocks `c.lock` from the safe state. This is a common pattern
   when parking requires releasing the lock that proved the park was
   legal.
5. **Spurious wake guard.** `if c.closed == 0 { throw("chansend: spurious
   wakeup") }` documents an invariant: the only legal reason for a
   blocked sender to wake without a matching receiver is that the channel
   was closed. If the runtime ever broke that invariant, the program
   would panic loudly rather than silently corrupting.

The receive path is symmetric. The select implementation in
`runtime/select.go` is more complex because it has to atomically observe
multiple channels, with poll orders and lock orders, but the building
blocks are the same: `sudog`s, per-P caches, `gopark`, direct hand-off.

Reading this code is the closest you can get to a textbook on lock-free
queue programming in Go.

## Appendix H — final words

The runtime is a 100k-line C/Go hybrid that the rest of the language is built
on. Most engineers will never need to touch it. The standard library
maintainers, however, write to its APIs every day, which is why
`net`, `time`, `sync`, `os`, and friends look the way they do: small, fast,
correct surface APIs sitting on top of a fiercely-engineered concurrent
machine.

When you write Go code that scales — to thousands of goroutines, to
microsecond-tail-latency requirements, to per-CPU-core throughput — you are
not writing against the language; you are writing against the runtime. The
language abstractions hide most of it. This document, more than anything
else, is an attempt to make the abstractions translucent.

Go forth and read the source.

[← Back](../)
