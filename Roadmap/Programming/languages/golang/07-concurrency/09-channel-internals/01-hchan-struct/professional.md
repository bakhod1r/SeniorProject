# The `hchan` Struct — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Source: `src/runtime/chan.go`](#the-source-srcruntimechango)
3. [Reading `hchan` Field by Field](#reading-hchan-field-by-field)
4. [`makechan` Line by Line](#makechan-line-by-line)
5. [`chansend` Walk-Through](#chansend-walk-through)
6. [`chanrecv` Walk-Through](#chanrecv-walk-through)
7. [`closechan` and Drain Logic](#closechan-and-drain-logic)
8. [The `send` and `recv` Helpers](#the-send-and-recv-helpers)
9. [`sendDirect` and `recvDirect` — Stack Pointer Hazards](#senddirect-and-recvdirect-stack-pointer-hazards)
10. [`waitq` Operations and the `selectDone` Race](#waitq-operations-and-the-selectdone-race)
11. [Race Detector Integration](#race-detector-integration)
12. [GC Interaction](#gc-interaction)
13. [Lock Rank and Invariants](#lock-rank-and-invariants)
14. [Version-by-Version Evolution](#version-by-version-evolution)
15. [Reading Path for Maximum Yield](#reading-path-for-maximum-yield)
16. [Summary](#summary)

---

## Introduction

The professional level is where you read `src/runtime/chan.go` line by line and know which line in `chansend` corresponds to which path you observed in `pprof`. The file is small — under 800 lines total, including comments — but every line is load-bearing. This document walks it in order.

References are to Go 1.22 source; line numbers approximate. The shape of `hchan` and the function names have been stable since Go 1.5.

---

## The Source: `src/runtime/chan.go`

Top of the file:

```go
package runtime

// This file contains the implementation of Go channels.

// Invariants:
//   At least one of c.sendq and c.recvq is empty,
//   except for the case of an unbuffered channel with a single goroutine
//   blocked on it for both sending and receiving using a select statement,
//   in which case the length of c.sendq and c.recvq is limited only by the
//   size of the select statement.
//
// For buffered channels, also:
//   c.qcount > 0 implies that c.recvq is empty.
//   c.qcount < c.dataqsiz implies that c.sendq is empty.

import (
    "internal/abi"
    "runtime/internal/atomic"
    "runtime/internal/math"
    "unsafe"
)

const (
    maxAlign  = 8
    hchanSize = unsafe.Sizeof(hchan{}) + uintptr(-int(unsafe.Sizeof(hchan{}))&(maxAlign-1))
    debugChan = false
)
```

The two invariants quoted in the header comment are the most important sentences in the file:

1. **At least one of `sendq` and `recvq` is empty.** A channel with both queues non-empty (outside of weird `select` cases) would be a contradiction — the next operation should have matched them up.
2. **For buffered channels**: data in the buffer implies no receiver is waiting; free buffer space implies no sender is waiting.

These imply the order of paths in `chansend`/`chanrecv`: check the opposite queue first; if empty, use the buffer; if buffer is unavailable, park.

---

## Reading `hchan` Field by Field

```go
type hchan struct {
    qcount   uint           // total data in the queue
    dataqsiz uint           // size of the circular queue
    buf      unsafe.Pointer // points to an array of dataqsiz elements
    elemsize uint16
    closed   uint32
    elemtype *_type // element type
    sendx    uint   // send index
    recvx    uint   // receive index
    recvq    waitq  // list of recv waiters
    sendq    waitq  // list of send waiters

    // lock protects all fields in hchan, as well as several
    // fields in sudogs blocked on this channel.
    //
    // Do not change another G's status while holding this lock
    // (in particular, do not ready a G), as this can deadlock
    // with stack shrinking.
    lock mutex
}
```

Roles:

| Field | Type | Read without lock? | Notes |
|---|---|---|---|
| `qcount` | `uint` | Yes (atomic, for `len`) | Stale possible. |
| `dataqsiz` | `uint` | Yes (immutable after `makechan`) | Used for `cap`. |
| `buf` | `unsafe.Pointer` | Yes (immutable) | May alias `raceaddr()` for empty channels. |
| `elemsize` | `uint16` | Yes (immutable) | Bound: 65535. |
| `closed` | `uint32` | Yes (atomic) | Set once, never cleared. |
| `elemtype` | `*_type` | Yes (immutable) | GC scan metadata. |
| `sendx`, `recvx` | `uint` | No | Modified under lock only. |
| `recvq`, `sendq` | `waitq` | No | Doubly-linked-list head/tail under lock. |
| `lock` | `mutex` | (Itself) | Runtime spin-mutex. |

Knowing which fields can be read without the lock is essential for understanding the fast paths.

---

## `makechan` Line by Line

```go
func makechan(t *chantype, size int) *hchan {
    elem := t.Elem

    // compiler checks this but be safe.
    if elem.Size_ >= 1<<16 {
        throw("makechan: invalid channel element type")
    }
    if hchanSize%maxAlign != 0 || elem.Align_ > maxAlign {
        throw("makechan: bad alignment")
    }

    mem, overflow := math.MulUintptr(elem.Size_, uintptr(size))
    if overflow || mem > maxAlloc-hchanSize || size < 0 {
        panic(plainError("makechan: size out of range"))
    }

    // Hchan does not contain pointers interesting for GC when elements stored in buf do not contain pointers.
    // buf points into the same allocation, elemtype is persistent.
    // SudoG's are referenced from their owning thread so they can't be collected.
    var c *hchan
    switch {
    case mem == 0:
        // Queue or element size is zero.
        c = (*hchan)(mallocgc(hchanSize, nil, true))
        // Race detector uses this location for synchronization.
        c.buf = c.raceaddr()
    case elem.PtrBytes == 0:
        // Elements do not contain pointers.
        // Allocate hchan and buf in one call.
        c = (*hchan)(mallocgc(hchanSize+mem, nil, true))
        c.buf = add(unsafe.Pointer(c), hchanSize)
    default:
        // Elements contain pointers.
        c = new(hchan)
        c.buf = mallocgc(mem, elem, true)
    }

    c.elemsize = uint16(elem.Size_)
    c.elemtype = elem
    c.dataqsiz = uint(size)
    lockInit(&c.lock, lockRankHchan)

    if debugChan {
        print("makechan: chan=", c, "; elemsize=", elem.Size_, "; dataqsiz=", size, "\n")
    }
    return c
}
```

Step by step:

1. **Validation**: element size <= 65535, alignment correct, total memory doesn't overflow `uintptr`, `size >= 0`.
2. **Three allocation cases**:
   - `mem == 0`: only the header. `buf` is set to a non-nil "race address" (the address of the field itself), so race-detector annotations don't get confused.
   - Pointer-free elements: one `mallocgc` covers header + buffer. `nil` type tells the allocator it does not need to set up GC scanning for this object.
   - Pointer-containing elements: header via `new(hchan)` (uses `*hchan` type info so GC scans the `buf`/`elemtype` fields), buffer separately via `mallocgc(mem, elem, true)` so the buffer has the right type metadata.
3. **Initialise**: set `elemsize`, `elemtype`, `dataqsiz`, lock rank.

The clever detail in case 1: `buf = c.raceaddr()` ensures `buf` is never `nil` even when the channel has no buffer. This simplifies later checks: code never has to special-case `buf == nil`.

---

## `chansend` Walk-Through

Full structure with annotations:

```go
func chansend(c *hchan, ep unsafe.Pointer, block bool, callerpc uintptr) bool {
    if c == nil {
        if !block {
            return false
        }
        gopark(nil, nil, waitReasonChanSendNilChan, traceBlockForever, 2)
        throw("unreachable")
    }

    if debugChan {
        print("chansend: chan=", c, "\n")
    }

    if raceenabled {
        racereadpc(c.raceaddr(), callerpc, abi.FuncPCABIInternal(chansend))
    }

    // Fast path: check for failed non-blocking operation without acquiring the lock.
    if !block && c.closed == 0 && full(c) {
        return false
    }

    var t0 int64
    if blockprofilerate > 0 {
        t0 = cputicks()
    }

    lock(&c.lock)

    if c.closed != 0 {
        unlock(&c.lock)
        panic(plainError("send on closed channel"))
    }

    if sg := c.recvq.dequeue(); sg != nil {
        // Found a waiting receiver. We pass the value we want to send
        // directly to the receiver, bypassing the channel buffer (if any).
        send(c, sg, ep, func() { unlock(&c.lock) }, 3)
        return true
    }

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

    // Block on the channel. Some receiver will complete our operation for us.
    gp := getg()
    mysg := acquireSudog()
    mysg.releasetime = 0
    if t0 != 0 {
        mysg.releasetime = -1
    }
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

    // Someone woke us up.
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

Notable details beyond what middle covered:

- **`KeepAlive(ep)`**: after the goroutine wakes, the runtime forces the compiler to keep `ep` (the source address) alive across the call. Without this, the optimizer could decide `ep` is no longer used and let the GC reclaim what it points to (if `ep` is on the heap) — leading to a corrupt receive.

- **`gp.parkingOnChan.Store(true)`**: tells the stack-shrinking code "don't touch this G's stack while we're in the middle of parking on a channel". The flag is cleared when the G is fully parked.

- **`closed := !mysg.success`**: when `closechan` drains a sender, it sets `success = false`. The sender, on wake, panics. This is the only way for a sender to discover the channel was closed mid-park.

- **`throw("chansend: spurious wakeup")`**: a sanity check; should be unreachable. If `success` is false but `closed` is somehow still 0, the runtime catches the inconsistency.

---

## `chanrecv` Walk-Through

```go
func chanrecv(c *hchan, ep unsafe.Pointer, block bool) (selected, received bool) {
    if c == nil {
        if !block {
            return
        }
        gopark(nil, nil, waitReasonChanReceiveNilChan, traceBlockForever, 2)
        throw("unreachable")
    }

    // Fast path: check for failed non-blocking operation without acquiring the lock.
    if !block && empty(c) {
        if atomic.Load(&c.closed) == 0 {
            return
        }
        if empty(c) {
            // The channel is irreversibly closed and empty.
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

    lock(&c.lock)

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
    } else {
        // Just found waiting sender with not closed.
        if sg := c.sendq.dequeue(); sg != nil {
            recv(c, sg, ep, func() { unlock(&c.lock) }, 3)
            return true, true
        }
    }

    if c.qcount > 0 {
        // Receive directly from queue
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

    // no sender available: block on this channel.
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

    // someone woke us up
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

Interesting points:

- The **double `empty(c)` check** in the fast path: a non-blocking receive that sees an empty open channel returns; if the channel happens to be closed, we recheck emptiness before declaring "closed and empty". This avoids racing with concurrent sends that beat the close.

- **`if c.closed != 0 { ... } else { ... }`**: when closed and empty, return zero. When closed and non-empty, fall through to drain the buffer. When open, prefer matching with a waiting sender.

- **`typedmemclr(c.elemtype, qp)`**: after pulling a value from the buffer, the slot is *cleared*. This is important if the element contains pointers — leaving the pointer in the buffer would keep the pointee alive past its useful life and could leak memory through the channel.

- The return value structure: `(selected, received)`. `selected` is for `select` polling (true means the case was taken); `received` is the Go-level `ok` value (true if a real value was received, false if zero-value-from-closed).

---

## `closechan` and Drain Logic

```go
func closechan(c *hchan) {
    if c == nil {
        panic(plainError("close of nil channel"))
    }

    lock(&c.lock)
    if c.closed != 0 {
        unlock(&c.lock)
        panic(plainError("close of closed channel"))
    }

    if raceenabled {
        callerpc := getcallerpc()
        racewritepc(c.raceaddr(), callerpc, abi.FuncPCABIInternal(closechan))
        racerelease(c.raceaddr())
    }

    c.closed = 1

    var glist gList

    // release all readers
    for {
        sg := c.recvq.dequeue()
        if sg == nil {
            break
        }
        if sg.elem != nil {
            typedmemclr(c.elemtype, sg.elem)
            sg.elem = nil
        }
        if sg.releasetime != 0 {
            sg.releasetime = cputicks()
        }
        gp := sg.g
        gp.param = unsafe.Pointer(sg)
        sg.success = false
        if raceenabled {
            raceacquireg(gp, c.raceaddr())
        }
        glist.push(gp)
    }

    // release all writers (they will panic)
    for {
        sg := c.sendq.dequeue()
        if sg == nil {
            break
        }
        sg.elem = nil
        if sg.releasetime != 0 {
            sg.releasetime = cputicks()
        }
        gp := sg.g
        gp.param = unsafe.Pointer(sg)
        sg.success = false
        if raceenabled {
            raceacquireg(gp, c.raceaddr())
        }
        glist.push(gp)
    }
    unlock(&c.lock)

    // Ready all Gs now that we've dropped the channel lock.
    for !glist.empty() {
        gp := glist.pop()
        gp.schedlink = 0
        goready(gp, 3)
    }
}
```

The two-phase pattern:

1. Inside the lock: flip `closed`, drain queues into a local list, set `success = false` on each `sudog`. Receivers also get their `elem` cleared (so the wake-up gives them the zero value).
2. Outside the lock: call `goready` on each goroutine.

This is the constraint about not changing G status under the lock, embodied. The local `glist` is a temporary holding area.

`racerelease(c.raceaddr())` paired with `raceacquire(c.raceaddr())` on the receiver side ensures the close is *happens-before* every subsequent receive — including the "closed and empty" return path.

---

## The `send` and `recv` Helpers

```go
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
```

The race-detector branch is essentially "do enough phantom buffer movement to make the race detector's vector clocks line up". The actual work is `sendDirect` (copy from sender's source to receiver's destination), unlock, set success, ready.

`recv` is structurally similar but more involved because for buffered channels it has to both pull from `buf[recvx]` *and* push the sender's value into `buf[sendx]` (which equals the just-vacated slot).

---

## `sendDirect` and `recvDirect` — Stack Pointer Hazards

```go
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

Subtle but crucial. `sg.elem` was set by the receiver to a stack address. Stacks can move (shrink/grow). The runtime arranges that the receiver's stack cannot be moved while `sg.elem` is being dereferenced — but the function comment reminds us not to insert any preemption points (safe points) between reading `sg.elem` and the `memmove`.

`typeBitsBulkBarrier` issues GC write barriers if the element contains pointers. `memmove` is plain. Why not `typedmemmove`? Because `typedmemmove` is what you call when you don't already have a separate handle on the GC barrier path; here we split for performance and for the stack-safety reason above.

`recvDirect` is the mirror: source is on the sender's stack, destination is on the receiver's stack (or a heap variable).

---

## `waitq` Operations and the `selectDone` Race

```go
func (q *waitq) enqueue(sgp *sudog) {
    sgp.next = nil
    x := q.last
    if x == nil {
        sgp.prev = nil
        q.first = sgp
        q.last = sgp
        return
    }
    sgp.prev = x
    x.next = sgp
    q.last = sgp
}

func (q *waitq) dequeue() *sudog {
    for {
        sgp := q.first
        if sgp == nil {
            return nil
        }
        y := sgp.next
        if y == nil {
            q.first = nil
            q.last = nil
        } else {
            y.prev = nil
            q.first = y
            sgp.next = nil
        }

        // if a goroutine was put on this queue because of a
        // select, there is a small window between the goroutine
        // being woken up by a different case and it grabbing the
        // channel locks. Once it has the lock
        // it removes itself from the queue, so we won't see it after that.
        // We use a flag in the G struct to tell us when someone
        // else has won the race to signal this goroutine but the goroutine
        // hasn't removed itself from the queue yet.
        if sgp.isSelect {
            if !sgp.g.selectDone.CompareAndSwap(0, 1) {
                continue
            }
        }

        return sgp
    }
}
```

The CAS on `selectDone` is the entire reason we have to retry inside `dequeue`. A `sudog` from a `select` may be sitting in our queue even after another channel woke its goroutine. We must skip such "stale" sudogs.

This is also why removing a winning `sudog` is more expensive than enqueueing: dequeue might iterate over multiple stale entries before finding a live one. In practice, the cleanup pass after `selectgo` removes stale sudogs proactively, keeping the queues clean.

---

## Race Detector Integration

`c.raceaddr()` returns a stable address that the race detector uses as the channel's "synchronization variable":

```go
func (c *hchan) raceaddr() unsafe.Pointer {
    // Treat read-like and write-like operations on the channel to
    // happen at this address. Avoid using the address of qcount
    // or dataqsiz, because the operations there may be re-ordered.
    return unsafe.Pointer(&c.buf)
}
```

The address of `c.buf` is chosen — a stable, immutable-after-makechan field. Every send issues a `racereadpc` against this address; every receive issues a `raceacquire`/`raceread`; close issues a `racerelease`. ThreadSanitizer's vector clocks then connect these events into the happens-before graph.

In a `mem == 0` channel (no buffer, no elements), `c.buf` is set to `c.raceaddr()` *itself* — i.e., `&c.buf` — by `makechan`. The race address still works.

---

## GC Interaction

Three GC concerns:

1. **Channel object**: a regular heap allocation. Reachable as long as any user variable or any parked `sudog.c` holds a pointer.

2. **Buffer**: in the pointer-free single-allocation case, the buffer is part of the same object as the header — no separate GC concern. In the pointer-containing case, it's a separate object whose type is `elemtype`, so the GC scans it normally.

3. **Pointer cleanup on receive**: when a receiver pulls a value out of the buffer (`typedmemmove` from `qp` to `ep`), the runtime also calls `typedmemclr(c.elemtype, qp)`. The clear is essential for pointer-containing element types — without it, the buffer would retain a pointer to the old element, preventing GC. For pointer-free elements, `typedmemclr` is a no-op (or a cheap memset).

In the direct hand-off paths (`send` calls `sendDirect`, `recv` calls `recvDirect`), no buffer slot is touched, so no clear is needed.

---

## Lock Rank and Invariants

`lockRankHchan` is defined in `runtime/lockrank.go`. It sits below most other runtime locks. Specifically, when a channel operation must acquire any other lock (e.g., to schedule a goroutine), `c.lock` must be released first.

The runtime has lock-rank-checking mode (build with `-race` plus internal flags) that catches violations. The famous constraint "do not change another G's status while holding this lock" is encoded as a rank rule: `goready` may acquire higher-ranked locks (scheduler-level), so it cannot be called inside `c.lock`.

The two-phase commit pattern in `closechan` (drain into local list, unlock, then `goready` each) is precisely the rank-compliant way to wake multiple goroutines.

---

## Version-by-Version Evolution

Major channel-related changes in recent Go releases:

| Version | Change |
|---|---|
| 1.5 | Runtime translated from C to Go; `chan.go` becomes a Go file. |
| 1.7 | `chanrecv` returns `(selected, received bool)` instead of int. |
| 1.10 | `closechan` rewritten to drain into a local list (avoid `goready` under lock). |
| 1.14 | Async preemption interacts with parked goroutines. `g.parkingOnChan` flag added. |
| 1.17 | Stack-pointer hazards in `sendDirect`/`recvDirect` documented and tightened. |
| 1.18 | Generics; no impact on `hchan` (always type-descriptor-based). |
| 1.19 | Minor field reorder for cache-line packing. |
| 1.21 | `selectDone` field on G struct moves to atomic type. |
| 1.22 | `traceBlock*` instrumentation refactor (no behavioral change). |

The remarkable consistency: the shape of `hchan` and the names `chansend`/`chanrecv`/`closechan` have been stable for over a decade.

---

## Reading Path for Maximum Yield

If you have one hour and want to know everything in this file:

1. **5 min**: skim the header comment and the invariants block at the top.
2. **5 min**: read `hchan`, `waitq`, `hchanSize` definitions.
3. **10 min**: read `makechan`. Note the three allocation cases.
4. **15 min**: read `chansend` end-to-end. Pay attention to which paths are taken under what conditions; map them to the three invariants.
5. **15 min**: read `chanrecv`. Compare with `chansend`; note the "closed-and-empty" special case.
6. **5 min**: read `closechan`. Confirm the two-phase pattern.
7. **5 min**: read `send`, `recv`, `sendDirect`, `recvDirect`, `chanbuf`, `full`, `empty`. These are tiny.

After this hour you can answer almost any question about Go channel semantics by referring to specific lines.

A productive follow-up: write a tiny program that puts a channel into each interesting state (empty, has data, full, closed-empty, closed-non-empty, with parked senders, with parked receivers), then read each path in `chansend`/`chanrecv` that triggers, and confirm your prediction matches the source.

---

## Summary

The professional view of `hchan` is grounded in the file itself. You can answer:

- **Where does `make(chan T, N)` allocate?** `runtime.makechan`. Three cases based on element pointer-ness.
- **What does `ch <- v` do?** Lowers to `runtime.chansend1` → `chansend`. Three internal paths: hand-off to waiter, write to buffer, park.
- **What does `<-ch` do?** Lowers to `runtime.chanrecv1` → `chanrecv`. Symmetric three paths.
- **How does `close(ch)` work?** `closechan` sets `c.closed`, drains both queues into a local list, then wakes each goroutine outside the lock.
- **Why is the lock a runtime mutex, not `sync.Mutex`?** Layering — `sync.Mutex` is implemented atop runtime primitives. Also: critical sections are tiny, spin-mutex with brief spin is the right choice.
- **What synchronizes a send-receive happens-before?** The lock acquire/release pair, annotated for the race detector via `c.raceaddr()`.

At this level the channel is no longer magic. It is a 700-line Go file you can read, modify, and recompile.

Next level — `specification.md` — catalogues the formal invariants `hchan` upholds, mapped to the user-facing channel contract from the Go Language Specification and the Go Memory Model.
