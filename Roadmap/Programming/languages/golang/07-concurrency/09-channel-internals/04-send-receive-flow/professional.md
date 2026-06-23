# Send/Receive Flow — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Compiler Lowering Pass](#compiler-lowering-pass)
3. [`chansend1`, `chanrecv1`, `chanrecv2` — The Wrappers](#chansend1-chanrecv1-chanrecv2--the-wrappers)
4. [`chansend` Line by Line](#chansend-line-by-line)
5. [`chanrecv` Line by Line](#chanrecv-line-by-line)
6. [The `send` Helper](#the-send-helper)
7. [The `recv` Helper](#the-recv-helper)
8. [`gopark` and `chanparkcommit`](#gopark-and-chanparkcommit)
9. [`goready` Path](#goready-path)
10. [Atomic Visibility of `closed`](#atomic-visibility-of-closed)
11. [Memory Model in `runtime/chan.go`](#memory-model-in-runtimechango)
12. [Reading the Runtime Source](#reading-the-runtime-source)
13. [Summary](#summary)

---

## Introduction

At professional level, "what does `ch <- v` do" must be answerable as: "It calls `runtime.chansend1`, which calls `runtime.chansend` with `block = true`, which locks `c.lock`, dequeues from `c.recvq`, and if successful calls `send` which does `sendDirect` and `goready`." This document walks `runtime/chan.go` end to end for the send/receive flow.

References to Go 1.22. The functions and structures are stable across recent Go versions; line numbers drift slightly.

After this file you will:

- Read `chansend` and `chanrecv` and recognise every branch.
- Trace `send` and `recv` and explain the direct-handoff and buffer-promotion mechanisms.
- Understand the `gopark` → `park_m` → `chanparkcommit` chain.
- Identify race-detector and trace hook insertion points.

---

## Compiler Lowering Pass

The Go compiler's SSA generation pass handles channel operators. The relevant code is in `cmd/compile/internal/ssagen/ssa.go`. Pattern-matched cases:

```go
case ir.OSEND:
    // ch <- v
    n := n.(*ir.SendStmt)
    s.callResult(n.Chan, ...)
    // The lowering emits:
    //   chanType := s.expr(n.Chan)
    //   value := s.expr(n.Value)
    //   tmp := s.temp(value.Type)
    //   s.store(tmp, value)
    //   s.rtcall(chansend1, true, chanType, tmp.Addr())

case ir.ORECV:
    // <-ch
    n := n.(*ir.UnaryExpr)
    // For `v := <-ch`:
    //   s.rtcall(chanrecv1, true, chanType, dst.Addr())
    // For `v, ok := <-ch`:
    //   ok := s.rtcall(chanrecv2, true, chanType, dst.Addr())

case ir.ORANGE:
    // for v := range ch
    // Lowered to a loop calling chanrecv2 each iteration.
```

The compiler generates a stack temporary for the value (`tmp`) and passes its address. This ensures the runtime sees an `unsafe.Pointer` it can `memmove` from.

For `close(ch)`:

```go
case ir.OCLOSE:
    s.rtcall(closechan, true, chanType)
```

### The select case

`select` is lowered specially:

```go
case ir.OSELECT:
    // Build an array of `scase` records, one per case.
    // Call selectgo, get back the index of the case that fired.
    // Dispatch to that case's body.
```

Each `scase` has fields `c` (channel), `kind` (send/recv), `elem` (value pointer). `selectgo` then implements the same fast/slow paths over the whole array.

---

## `chansend1`, `chanrecv1`, `chanrecv2` — The Wrappers

From `runtime/chan.go`:

```go
// entry point for c <- x from compiled code.
//
//go:nosplit
func chansend1(c *hchan, elem unsafe.Pointer) {
    chansend(c, elem, true, getcallerpc())
}

//go:nosplit
func chanrecv1(c *hchan, elem unsafe.Pointer) {
    chanrecv(c, elem, true)
}

//go:nosplit
func chanrecv2(c *hchan, elem unsafe.Pointer) (received bool) {
    _, received = chanrecv(c, elem, true)
    return
}
```

Three points worth highlighting:

- `//go:nosplit`: these functions cannot grow their stack. Stack growth would require taking the stack mutex, which interacts badly with `chansend`'s own locking. Keeping them tiny avoids overflow.
- `getcallerpc()`: returns the PC of the caller (your user code line). Used for race-detector diagnostics.
- The wrappers exist so the compiler does not have to know about `chansend`'s extra arguments (`block`, `callerpc`).

---

## `chansend` Line by Line

Here is the real `chansend` from `runtime/chan.go`, with annotations:

```go
func chansend(c *hchan, ep unsafe.Pointer, block bool, callerpc uintptr) bool {
    // 1. Nil channel.
    if c == nil {
        if !block {
            return false
        }
        // Park forever — the goroutine has no way to be unblocked.
        gopark(nil, nil, waitReasonChanSendNilChan, traceBlockForever, 2)
        throw("unreachable")
    }

    if debugChan {
        print("chansend: chan=", c, "\n")
    }

    if raceenabled {
        racereadpc(c.raceaddr(), callerpc, abi.FuncPCABIInternal(chansend))
    }

    // 2. Fast path for non-blocking sends.
    //
    // After observing that the channel is not closed, we observe that the
    // channel is not ready for sending. Each of these observations is a
    // single word-sized read (first c.closed and second full()).
    // Because a closed channel cannot transition from 'ready for sending' to
    // 'not ready for sending', even if the channel is closed between the two
    // observations, they imply a moment between the two when the channel was
    // both not yet closed and not ready for sending. We behave as if we
    // observed the channel at that moment, and report that the send cannot
    // proceed.
    //
    // It is okay if the reads are reordered here: if we observe that the
    // channel is not ready for sending and then observe that it is not
    // closed, that implies that the channel wasn't closed during the first
    // observation. However, nothing here guarantees forward progress. We
    // rely on the side effects of lock release in chanrecv() and closechan()
    // to update this thread's view of c.closed and full().
    if !block && c.closed == 0 && full(c) {
        return false
    }

    var t0 int64
    if blockprofilerate > 0 {
        t0 = cputicks()
    }

    // 3. Lock.
    lock(&c.lock)

    // 4. Closed check (under lock).
    if c.closed != 0 {
        unlock(&c.lock)
        panic(plainError("send on closed channel"))
    }

    // 5. Direct handoff: dequeue a parked receiver.
    if sg := c.recvq.dequeue(); sg != nil {
        // Found a waiting receiver. We pass the value we want to send
        // directly to the receiver, bypassing the channel buffer (if any).
        send(c, sg, ep, func() { unlock(&c.lock) }, 3)
        return true
    }

    // 6. Buffer write.
    if c.qcount < c.dataqsiz {
        // Space is available in the channel buffer. Enqueue the element to send.
        qp := chanbuf(c, c.sendx)
        if raceenabled {
            racenotify(c, c.sendx, nil)
        }
        typedmemmove(c.elemtype, qp, ep)
        c.sendx++
        if c.sendx == c.dataqsiz {
            c.sendx = 0
        }
        c.qcount++
        unlock(&c.lock)
        return true
    }

    if !block {
        unlock(&c.lock)
        return false
    }

    // 7. Park.
    gp := getg()
    mysg := acquireSudog()
    mysg.releasetime = 0
    if t0 != 0 {
        mysg.releasetime = -1
    }
    // No stack splits between assigning elem and enqueuing mysg
    // on gp.waiting where copystack can find it.
    mysg.elem = ep
    mysg.waitlink = nil
    mysg.g = gp
    mysg.isSelect = false
    mysg.c = c
    gp.waiting = mysg
    gp.param = nil
    c.sendq.enqueue(mysg)
    // Signal to anyone trying to shrink our stack that we're about
    // to park on a channel. The window between when this G's status
    // changes and when we set gp.activeStackChans is not safe for
    // stack shrinking.
    gp.parkingOnChan.Store(true)
    gopark(chanparkcommit, unsafe.Pointer(&c.lock), waitReasonChanSend, traceBlockChanSend, 2)
    // Ensure the value being sent is kept alive until the
    // receiver copies it out. The sudog has a pointer to the
    // stack object, but sudogs aren't considered as roots of the
    // stack tracer.
    KeepAlive(ep)

    // 8. Woken from park.
    if mysg != gp.waiting {
        throw("G waiting list is corrupted")
    }
    gp.waiting = nil
    gp.activeStackChans = false
    closed := !mysg.success
    gp.param = nil
    if mysg.releasetime > 0 {
        blockevent(mysg.releasetime-t0, 2)
    }
    mysg.c = nil
    releaseSudog(mysg)
    if closed {
        if c.closed == 0 {
            throw("chansend: spurious wakeup")
        }
        panic(plainError("send on closed channel"))
    }
    return true
}
```

Branch summary:

| Step | Condition | Action |
|---|---|---|
| 1 | `c == nil` | Park forever (or return false for non-blocking) |
| 2 | `!block && !closed && full` | Return false (lock-free fast path) |
| 3 | always | Acquire `c.lock` |
| 4 | `c.closed != 0` | Unlock + panic |
| 5 | `recvq.first != nil` | Direct handoff to receiver |
| 6 | `qcount < dataqsiz` | Write to buffer slot |
| 7 | `!block` | Unlock + return false |
| 8 | else | Park (acquire sudog, enqueue, gopark) |
| 9 | (woken) `mysg.success == false` | Panic ("send on closed channel") |

---

## `chanrecv` Line by Line

```go
func chanrecv(c *hchan, ep unsafe.Pointer, block bool) (selected, received bool) {
    if debugChan {
        print("chanrecv: chan=", c, "\n")
    }

    // 1. Nil channel.
    if c == nil {
        if !block {
            return
        }
        gopark(nil, nil, waitReasonChanReceiveNilChan, traceBlockForever, 2)
        throw("unreachable")
    }

    // 2. Fast path for non-blocking receives.
    if !block && empty(c) {
        if atomic.Load(&c.closed) == 0 {
            return
        }
        if empty(c) {
            if raceenabled {
                raceacquire(c.raceaddr())
            }
            if ep != nil {
                typedmemclr(c.elemtype, ep)
            }
            return true, false
        }
    }

    var t0 int64
    if blockprofilerate > 0 {
        t0 = cputicks()
    }

    // 3. Lock.
    lock(&c.lock)

    // 4. Closed-empty short-circuit.
    if c.closed != 0 {
        if c.qcount == 0 {
            if raceenabled {
                raceacquire(c.raceaddr())
            }
            unlock(&c.lock)
            if ep != nil {
                typedmemclr(c.elemtype, ep)
            }
            return true, false
        }
        // The channel has been closed, but the channel's buffer have data.
        // Fall through.
    } else {
        // 5. Direct handoff: dequeue a parked sender.
        if sg := c.sendq.dequeue(); sg != nil {
            // Found a waiting sender. If buffer is size 0, receive value
            // directly from sender. Otherwise, receive from head of queue
            // and add sender's value to the tail of the queue (both map
            // to the same buffer slot because the queue is full).
            recv(c, sg, ep, func() { unlock(&c.lock) }, 3)
            return true, true
        }
    }

    // 6. Buffer read.
    if c.qcount > 0 {
        qp := chanbuf(c, c.recvx)
        if raceenabled {
            racenotify(c, c.recvx, nil)
        }
        if ep != nil {
            typedmemmove(c.elemtype, ep, qp)
        }
        typedmemclr(c.elemtype, qp)
        c.recvx++
        if c.recvx == c.dataqsiz {
            c.recvx = 0
        }
        c.qcount--
        unlock(&c.lock)
        return true, true
    }

    if !block {
        unlock(&c.lock)
        return false, false
    }

    // 7. Park.
    gp := getg()
    mysg := acquireSudog()
    mysg.releasetime = 0
    if t0 != 0 {
        mysg.releasetime = -1
    }
    mysg.elem = ep
    mysg.waitlink = nil
    gp.waiting = mysg
    mysg.g = gp
    mysg.isSelect = false
    mysg.c = c
    gp.param = nil
    c.recvq.enqueue(mysg)
    gp.parkingOnChan.Store(true)
    gopark(chanparkcommit, unsafe.Pointer(&c.lock), waitReasonChanReceive, traceBlockChanRecv, 2)

    // 8. Woken from park.
    if mysg != gp.waiting {
        throw("G waiting list is corrupted")
    }
    gp.waiting = nil
    gp.activeStackChans = false
    if mysg.releasetime > 0 {
        blockevent(mysg.releasetime-t0, 2)
    }
    success := mysg.success
    gp.param = nil
    mysg.c = nil
    releaseSudog(mysg)
    return true, success
}
```

The closed-channel logic is subtler than `chansend`'s:

- If closed AND buffer empty → return `(true, false)` with zero value.
- If closed AND buffer non-empty → drain the buffer normally; the next receive will hit the empty case and return zero.

This is how you can `for v := range ch` and still get the last buffered values after `close(ch)`.

---

## The `send` Helper

```go
// send processes a send operation on an empty channel c.
// The value ep sent by the sender is copied to the receiver sg.
// The receiver is then woken up to go on its merry way.
// Channel c must be empty and locked. send unlocks c with unlockf.
// sg must already be dequeued from c.
// ep must be non-nil and point to the heap or the caller's stack.
func send(c *hchan, sg *sudog, ep unsafe.Pointer, unlockf func(), skip int) {
    if raceenabled {
        if c.dataqsiz == 0 {
            racesync(c, sg)
        } else {
            // Pretend we go through the buffer, even though
            // we copy directly. Note that we need to increment
            // the head/tail locations only when raceenabled.
            racenotify(c, c.recvx, nil)
            racenotify(c, c.recvx, sg)
            c.recvx++
            if c.recvx == c.dataqsiz {
                c.recvx = 0
            }
            c.sendx = c.recvx // c.sendx = (c.sendx+1) % c.dataqsiz
        }
    }
    if sg.elem != nil {
        sendDirect(c.elemtype, sg, ep)
        sg.elem = nil
    }
    gp := sg.g
    unlockf()
    gp.param = unsafe.Pointer(sg)
    sg.success = true
    if sg.releasetime != 0 {
        sg.releasetime = cputicks()
    }
    goready(gp, skip+1)
}

// Sends and receives on unbuffered or empty-buffered channels are the
// only operations where one running goroutine writes to the stack of
// another running goroutine. The GC assumes that stack writes only
// happen when the goroutine is running and are only done by that
// goroutine. Using a write barrier is sufficient to make up for
// violating that assumption, but the write barrier has to work.
// typedmemmove will call bulkBarrierPreWrite, but the target bytes
// are not in the heap, so that will not help. We arrange to call
// memmove and typeBitsBulkBarrier instead.
func sendDirect(t *_type, sg *sudog, src unsafe.Pointer) {
    // src is on our stack, dst is a slot on another stack.

    // Once we read sg.elem out of sg, it will no longer
    // be updated if the destination's stack gets copied (shrunk).
    // So make sure that no preemption points can happen between read & use.
    dst := sg.elem
    typeBitsBulkBarrier(t, uintptr(dst), uintptr(src), t.Size_)
    // No need for cgo write barrier checks because dst is always
    // Go memory.
    memmove(dst, src, t.Size_)
}
```

The comment block on `sendDirect` is the runtime team's own explanation. Two key points:

- The write target is *another goroutine's stack*. This is unusual; the GC normally assumes stack writes are done by the stack's owner.
- `typeBitsBulkBarrier` invokes the GC's write barrier appropriately for the type's pointer layout, even though the destination is not a heap address.

The `racesync` / `racenotify` calls are dead code unless `-race` is enabled. They emit acquire/release events that the race detector uses to verify happens-before.

---

## The `recv` Helper

```go
// recv processes a receive operation on a full channel c.
// There are 2 parts:
//  1. The value sent by the sender sg is put into the channel
//     and the sender is woken up to go on its merry way.
//  2. The value received by the receiver (the current G) is
//     written to ep.
//
// For synchronous channels, both values are the same.
// For asynchronous channels, the receiver gets its data from
// the channel buffer and the sender's data is put in the channel buffer.
// Channel c must be full and locked. recv unlocks c with unlockf.
// sg must already be dequeued from c.
// A non-nil ep must point to the heap or the caller's stack.
func recv(c *hchan, sg *sudog, ep unsafe.Pointer, unlockf func(), skip int) {
    if c.dataqsiz == 0 {
        if raceenabled {
            racesync(c, sg)
        }
        if ep != nil {
            // copy data from sender
            recvDirect(c.elemtype, sg, ep)
        }
    } else {
        // Queue is full. Take the item at the
        // head of the queue. Make the sender enqueue
        // its item at the tail of the queue. Since the
        // queue is full, those are both the same slot.
        qp := chanbuf(c, c.recvx)
        if raceenabled {
            racenotify(c, c.recvx, nil)
            racenotify(c, c.recvx, sg)
        }
        // copy data from queue to receiver
        if ep != nil {
            typedmemmove(c.elemtype, ep, qp)
        }
        // copy data from sender to queue
        typedmemmove(c.elemtype, qp, sg.elem)
        c.recvx++
        if c.recvx == c.dataqsiz {
            c.recvx = 0
        }
        c.sendx = c.recvx // c.sendx = (c.sendx+1) % c.dataqsiz
    }
    sg.elem = nil
    gp := sg.g
    unlockf()
    gp.param = unsafe.Pointer(sg)
    sg.success = true
    if sg.releasetime != 0 {
        sg.releasetime = cputicks()
    }
    goready(gp, skip+1)
}

func recvDirect(t *_type, sg *sudog, dst unsafe.Pointer) {
    // dst is on our stack or the heap, src is on another stack.
    // The channel is locked, so src will not move during this
    // operation.
    src := sg.elem
    typeBitsBulkBarrier(t, uintptr(dst), uintptr(src), t.Size_)
    memmove(dst, src, t.Size_)
}
```

The two-step "head out, tail in" maneuver for buffered channels:

1. `typedmemmove(ep, qp)`: copy oldest buffer value into receiver.
2. `typedmemmove(qp, sg.elem)`: copy sender's value into the now-empty slot.
3. Advance `recvx`. Set `sendx = recvx` because the buffer rotated by one.

This is also where the assignment `c.sendx = c.recvx` happens — the comment explains it equals `(c.sendx+1) % c.dataqsiz`.

---

## `gopark` and `chanparkcommit`

`gopark` in `runtime/proc.go`:

```go
// Puts the current goroutine into a waiting state and calls unlockf on the
// system stack.
//
// If unlockf returns false, the goroutine is resumed.
//
// unlockf must not access this G's stack, as it may be moved between
// the call to gopark and the call to unlockf.
//
// Note that because unlockf is called after putting the G into a waiting
// state, the G may have already been readied by the time unlockf is called
// unless there is external synchronization preventing the G from being
// readied. If unlockf returns false, it must guarantee that the G cannot be
// externally readied.
//
// Reason explains why the goroutine has been parked. It is displayed in stack
// traces and heap dumps. Reasons should be unique and descriptive. Do not
// re-use reasons, add new ones.
func gopark(unlockf func(*g, unsafe.Pointer) bool, lock unsafe.Pointer, reason waitReason, traceReason traceBlockReason, traceskip int) {
    if reason != waitReasonSleep {
        checkTimeouts() // timeouts may expire while two goroutines keep the scheduler busy
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

    if trace.ok() {
        // Trace the event before the transition. It may take a
        // stack trace, but we won't own the stack after the transition.
        trace.GoPark(mp.waitTraceBlockReason, mp.waitTraceSkip)
    }
    // N.B. Not using casGToWaiting here because the waitreason is
    // set by gopark.
    casgstatus(gp, _Grunning, _Gwaiting)
    if trace.ok() {
        traceRelease(trace)
    }

    dropg()

    if fn := mp.waitunlockf; fn != nil {
        ok := fn(gp, mp.waitlock)
        mp.waitunlockf = nil
        mp.waitlock = nil
        if !ok {
            trace := traceAcquire()
            casgstatus(gp, _Gwaiting, _Grunnable)
            if trace.ok() {
                trace.GoUnpark(gp, 2)
                traceRelease(trace)
            }
            execute(gp, true) // Schedule it back, never returns.
        }
    }
    schedule()
}
```

`chanparkcommit` (the `unlockf` passed to `gopark` for channels):

```go
func chanparkcommit(gp *g, chanLock unsafe.Pointer) bool {
    // There are unlocked sudogs that point into gp's stack. Stack
    // copying must lock the channels of those sudogs.
    // Set activeStackChans here instead of before we try parking
    // because we could self-deadlock in stack growth on the
    // channel lock.
    gp.activeStackChans = true
    // Mark that it's safe for stack shrinking to occur now,
    // because any thread acquiring this G's stack for shrinking
    // is guaranteed to observe activeStackChans after this store.
    gp.parkingOnChan.Store(false)
    // Make sure we unlock after setting activeStackChans and
    // unsetting parkingOnChan. The moment we release the lock,
    // it's possible for another goroutine to wake us up and read
    // our stack — but only if it can acquire the lock — so the
    // unlock must come after the stores.
    unlock((*mutex)(chanLock))
    return true
}
```

The sequence is precise:

1. Set `gp.activeStackChans = true` (so stack movers know to lock channels first).
2. Set `gp.parkingOnChan = false` (so stack shrinker knows we are now safely parked).
3. Unlock the channel.
4. Return `true` (committing to park).

Between steps 3 and 4, another goroutine can already start waking us via `goready`. That is fine: the wake just sets us to `_Grunnable`; the scheduler reschedules us later.

---

## `goready` Path

The waker calls `goready(gp, skip)`:

```go
func goready(gp *g, traceskip int) {
    systemstack(func() {
        ready(gp, traceskip, true)
    })
}

func ready(gp *g, traceskip int, next bool) {
    status := readgstatus(gp)

    // Mark runnable.
    mp := acquirem() // disable preemption because it can be holding p in a local var
    if status&^_Gscan != _Gwaiting {
        dumpgstatus(gp)
        throw("bad g->status in ready")
    }

    // status is Gwaiting or Gscanwaiting; make Grunnable and put on runq
    trace := traceAcquire()
    casgstatus(gp, _Gwaiting, _Grunnable)
    if trace.ok() {
        trace.GoUnpark(gp, traceskip)
        traceRelease(trace)
    }
    runqput(mp.p.ptr(), gp, next)
    wakep()
    releasem(mp)
}
```

Steps:

1. CAS the goroutine from `_Gwaiting` to `_Grunnable`.
2. Emit a trace `GoUnpark` event.
3. `runqput`: push onto the local P's runqueue. If `next == true`, into the "next" slot (front of queue). For channels, we use `next = true` to favour low-latency handoff.
4. `wakep`: if no spinning M exists, start one (so the unparked G runs promptly).

The `next = true` hint is what makes channel handoff feel fast: the woken goroutine is scheduled before any other queued goroutines.

`wakep` may call `startm` to start a new M if necessary. On a system with many idle Ms in the M-pool, this is a `notewakeup` (futex). On a fresh system, it may be a `clone(2)`.

---

## Atomic Visibility of `closed`

`chansend`'s fast-path checks `c.closed == 0` without taking the lock. For correctness, this must work even under concurrent close. The runtime relies on:

```go
// chansend fast path
if !block && c.closed == 0 && full(c) {
    return false
}
```

The reads of `c.closed` and `c.qcount` (inside `full`) are *plain loads*, not atomics. The comment in `chansend` (quoted earlier) gives the argument:

- If we observe `c.closed == 0`, the channel was not closed at *some point* during this function's execution.
- If we observe `full(c)`, the buffer was full at *some point*.
- Combining: at some point, the channel was open and full. So returning `false` (would-block) is correct.

This is the "moment-in-time" argument. It avoids the need for atomic loads on the fast path, which would cost cycles.

For the slow path (after lock), all checks are under the lock and therefore correct without atomics.

In Go 1.19+ the runtime uses `atomic.Load` for `c.closed` in `chanrecv`'s fast path to satisfy a strict reading of the memory model. Performance impact is minimal.

---

## Memory Model in `runtime/chan.go`

The Go memory model says (paraphrased):

- A send on a channel happens-before the corresponding receive completes.
- A close happens-before a receive observing the closed state.

How `runtime/chan.go` implements this:

1. **Send → receive via buffer**: sender writes value under `c.lock` (with `typedmemmove`); receiver reads value under the same `c.lock`. The lock provides acquire/release semantics. All writes before the lock release on the sender are visible after the lock acquire on the receiver.

2. **Send → receive via direct handoff**: sender writes value via `sendDirect` under `c.lock`. Receiver wakes after sender does `goready`, which involves the scheduler's runqueue (also acquire/release). When the receiver's `gopark` returns, all sender writes are visible.

3. **Close → receive**: closer sets `c.closed = 1` under `c.lock`. Receiver reads `c.closed` under `c.lock` (slow path) or with `atomic.Load` (fast path). Either way: writes before the close in the closer's view are visible after the receiver observes the close.

The race detector's `racerelease` and `raceacquire` events at send and receive emit happens-before edges in the race detector's vector clock, matching the memory model precisely.

---

## Reading the Runtime Source

`runtime/chan.go` has ~800 lines. Recommended reading order:

1. The `hchan` struct definition (~line 35).
2. `makechan` (~line 70). Understand allocation.
3. `chansend1` (~line 140). Trivial wrapper.
4. `chansend` (~line 145). The main function. Read all branches.
5. `send` (~line 290). Direct-handoff helper.
6. `sendDirect` (~line 310). The cross-stack memmove.
7. `closechan` (~line 365). Skim for now; covered in another subsection.
8. `chanrecv1` and `chanrecv2` (~line 440). Wrappers.
9. `chanrecv` (~line 455). Symmetric to `chansend`.
10. `recv` (~line 590). Two paths: unbuffered and buffered-promotion.
11. `recvDirect` (~line 635).

Also worth reading:

- `runtime/proc.go`: `gopark`, `park_m`, `ready`, `goready`, `runqput`, `wakep`.
- `runtime/runtime2.go`: `g`, `sudog`, `hchan`, `waitq` struct definitions.
- `runtime/select.go`: `selectgo`, how `chansend`/`chanrecv` plug into `select`.
- `runtime/race0.go` vs `runtime/race.go`: race detector hook stubs vs real implementations.

### Practical reading tactic

Take a printout of `chansend` and `chanrecv`. Highlight:

- One color: lock acquisition / release.
- Another color: queue operations (dequeue / enqueue).
- Another color: memory operations (`typedmemmove`, `typedmemclr`, `sendDirect`).
- Another color: scheduler interactions (`gopark`, `goready`).

After 30 minutes of highlighting, the control flow becomes obvious.

---

## Summary

`runtime/chan.go` is a ~800-line file that implements all of Go's channel operations. The send/receive flow lives in two ~120-line functions, `chansend` and `chanrecv`, each with the same shape:

```
1. nil-channel check
2. lock-free fast path (non-blocking only)
3. lock
4. closed check
5. direct handoff (peek opposite queue)
6. buffer hop (if room/data)
7. non-blocking return false
8. park (sudog + gopark + chanparkcommit)
9. (woken) panic if closed sender, else return success
```

The `send` and `recv` helpers do the direct handoff: `sendDirect` and `recvDirect` perform a `memmove` between two goroutines' stacks under the channel lock, with explicit GC write barriers.

`gopark` calls `park_m` on the system stack; `park_m` transitions the goroutine to `_Gwaiting` and invokes `chanparkcommit` which sets `activeStackChans` and releases the channel lock. The wake path is `goready` → `ready` → `casgstatus(_Gwaiting → _Grunnable)` → `runqput` → `wakep`.

Memory model invariants are enforced by:

- The lock's acquire/release semantics (for buffered ops).
- The wake/park sync (for direct handoff).
- Atomic loads on the fast path for `c.closed`.

The professional reads this file. The specification level catalogues the contracts these functions must uphold.
