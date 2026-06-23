# Channel Runtime Behaviour — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [The `hchan` Lock in Context](#the-hchan-lock-in-context)
3. [`chansend` Walkthrough with State Diagrams](#chansend-walkthrough-with-state-diagrams)
4. [`chanrecv` Walkthrough with State Diagrams](#chanrecv-walkthrough-with-state-diagrams)
5. [Direct Hand-off in Detail](#direct-hand-off-in-detail)
6. [Buffer Rotation on Full-Buffer Receive](#buffer-rotation-on-full-buffer-receive)
7. [`closechan` and the Wake List](#closechan-and-the-wake-list)
8. [Wait Queue Behaviour](#wait-queue-behaviour)
9. [Parking Mechanics: `gopark`](#parking-mechanics-gopark)
10. [Waking Mechanics: `goready`](#waking-mechanics-goready)
11. [Select Readiness Check](#select-readiness-check)
12. [Non-Blocking Variants](#non-blocking-variants)
13. [Practical Implications](#practical-implications)
14. [Summary](#summary)

---

## Introduction

The junior page introduced the runtime functions and what they do at a glance. This page turns the page on the source code: we look at every step in `chansend` and `chanrecv`, walk through what changes in the `hchan` struct on each operation, and discuss the design choices that make the runtime predictable under contention.

The function names, lock points, and state transitions in this document are accurate against Go 1.22's `runtime/chan.go`. The pseudocode follows the source closely; the only liberties are simplification of error paths and tracing hooks.

---

## The `hchan` Lock in Context

`c.lock` is a `runtime.mutex`, the runtime's internal mutex. Unlike `sync.Mutex`, it is *not* used through the `sync` package API; it is the lower-level futex/sema-based primitive declared in `runtime/lock_futex.go` (Linux) or `lock_sema.go` (others). Key properties:

- Lock is a 4-byte futex on Linux; ~8 bytes including state on macOS.
- Acquisition is uncontended-fast (one CAS), contended-slow (futex syscall).
- Holds for at most the duration of one channel op — bounded by a few hundred nanoseconds in the no-park case.
- Released before `goready` is called, so wakeups happen outside the critical section.

The lock is the *only* synchronisation inside the channel. Everything in `hchan` — the buffer slots, the queue pointers, the closed flag — is protected exclusively by it. There is no double-checked locking, no per-slot atomic, no "fast path without lock." If you see a stack trace in `runtime.lock2`, that goroutine is queuing for `c.lock`.

The shortness of the critical section is why channels scale reasonably. But it is also why channels do not scale infinitely: a million senders contending on one channel will queue on `c.lock` no matter how fancy your hardware is.

---

## `chansend` Walkthrough with State Diagrams

### Annotated source

The actual signature is:

```go
// chansend implements `c <- ep`.
// If block is false (set by select with default), and the send cannot
// complete immediately, it returns false without blocking.
func chansend(c *hchan, ep unsafe.Pointer, block bool, callerpc uintptr) bool {
```

The body, with annotations:

```go
// (A) Nil channel: block forever, or fast-fail.
if c == nil {
    if !block {
        return false
    }
    gopark(nil, nil, waitReasonChanSendNilChan, traceBlockForever, 2)
    throw("unreachable")
}

// (B) Non-blocking fast check (select default).
//     If the channel is open AND we cannot send (no receiver, no room),
//     bail without locking.
if !block && c.closed == 0 && full(c) {
    return false
}

// (C) Acquire the lock.
lock(&c.lock)

// (D) Closed check.
if c.closed != 0 {
    unlock(&c.lock)
    panic(plainError("send on closed channel"))
}

// (E) Receiver waiting? Direct hand-off.
if sg := c.recvq.dequeue(); sg != nil {
    send(c, sg, ep, func() { unlock(&c.lock) }, 3)
    return true
}

// (F) Buffer has room? Copy in.
if c.qcount < c.dataqsiz {
    qp := chanbuf(c, c.sendx)
    typedmemmove(c.elemtype, qp, ep)
    c.sendx++
    if c.sendx == c.dataqsiz {
        c.sendx = 0
    }
    c.qcount++
    unlock(&c.lock)
    return true
}

// (G) Non-blocking and could not send: bail.
if !block {
    unlock(&c.lock)
    return false
}

// (H) Park ourselves.
gp := getg()
mysg := acquireSudog()
mysg.elem = ep
mysg.g = gp
mysg.c = c
mysg.waitlink = nil
gp.waiting = mysg
c.sendq.enqueue(mysg)
atomic.Store8(&gp.parkingOnChan, 1)
gopark(chanparkcommit, unsafe.Pointer(&c.lock), waitReasonChanSend, traceBlockChanSend, 2)

// (I) Woken up. Either the receiver took our value, or the channel closed.
//     If closed, mysg.success is false → panic.
KeepAlive(ep)
if mysg.elem != nil {
    throw("chansend: bad sudog elem")
}
mysg.c = nil
closed := !mysg.success
gp.param = nil
releaseSudog(mysg)
if closed {
    if c.closed == 0 {
        throw("chansend: spurious wakeup")
    }
    panic(plainError("send on closed channel"))
}
return true
```

### State diagram: typical send paths

```
                 send(c, v)
                     |
       +-------------+---------------+
       |             |               |
       v             v               v
[nil channel]   [open channel]  [closed channel]
       |             |               |
  block forever      v             panic
                +----+---+
                |        |
        recvq ready    no waiter
                |        |
       direct hand-off   v
                    qcount < cap?
                    /        \
                  yes         no
                  /            \
            copy to buffer    block?
                              /     \
                            yes      no
                            /         \
                       park on        return false
                       sendq         (select default)
```

### What changes inside `hchan` per branch

| Branch | `qcount` | `sendx` | `recvq` | `sendq` | `closed` |
|---|---|---|---|---|---|
| Direct hand-off | unchanged | unchanged | head removed | unchanged | unchanged |
| Buffer copy | +1 | +1 mod `dataqsiz` | unchanged | unchanged | unchanged |
| Park on sendq | unchanged | unchanged | unchanged | tail appended | unchanged |
| Closed panic | unchanged | unchanged | unchanged | unchanged | unchanged |

---

## `chanrecv` Walkthrough with State Diagrams

### Annotated source

```go
func chanrecv(c *hchan, ep unsafe.Pointer, block bool) (selected, received bool) {
    // (A) Nil channel: block forever or fast-fail.
    if c == nil {
        if !block {
            return
        }
        gopark(nil, nil, waitReasonChanReceiveNilChan, traceBlockForever, 2)
        throw("unreachable")
    }

    // (B) Non-blocking fast check.
    if !block && empty(c) {
        if atomic.Load(&c.closed) == 0 {
            return false, false
        }
        if empty(c) {
            if ep != nil {
                typedmemclr(c.elemtype, ep)
            }
            return true, false
        }
    }

    // (C) Lock.
    lock(&c.lock)

    // (D) Closed and empty: return zero.
    if c.closed != 0 && c.qcount == 0 {
        unlock(&c.lock)
        if ep != nil {
            typedmemclr(c.elemtype, ep)
        }
        return true, false
    }

    // (E) Sender waiting? Two sub-cases below.
    if sg := c.sendq.dequeue(); sg != nil {
        recv(c, sg, ep, func() { unlock(&c.lock) }, 3)
        return true, true
    }

    // (F) Buffer non-empty.
    if c.qcount > 0 {
        qp := chanbuf(c, c.recvx)
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

    // (G) Park on recvq.
    gp := getg()
    mysg := acquireSudog()
    mysg.elem = ep
    mysg.g = gp
    mysg.c = c
    gp.waiting = mysg
    c.recvq.enqueue(mysg)
    gopark(chanparkcommit, unsafe.Pointer(&c.lock), waitReasonChanReceive, traceBlockChanRecv, 2)

    // (H) Woken.
    success := mysg.success
    gp.param = nil
    mysg.c = nil
    releaseSudog(mysg)
    return true, success
}
```

### State diagram

```
                 v, ok := <-c
                     |
       +-------------+---------------+
       |             |               |
       v             v               v
[nil channel]   [open channel]  [closed channel]
       |             |               |
  block forever      v             qcount>0?
                +----+---+             /  \
                |        |          yes    no
                v        v           |     |
        sendq ready   no waiter      v     v
                |        |       drain   return (true,false)
       direct hand-off   v       buffer
       or buffer rotate qcount>0?
                          /  \
                        yes   no
                         |     |
                  drain buffer  block?
                                /  \
                              yes   no
                               |     |
                          park on   return (false,false)
                          recvq
```

### What changes inside `hchan` per branch

| Branch | `qcount` | `recvx` | `recvq` | `sendq` | `closed` |
|---|---|---|---|---|---|
| Direct hand-off (unbuffered) | unchanged | unchanged | unchanged | head removed | unchanged |
| Buffer rotate (full buffer + parked sender) | unchanged | +1 mod cap | unchanged | head removed | unchanged |
| Buffer drain | −1 | +1 mod cap | unchanged | unchanged | unchanged |
| Park on recvq | unchanged | unchanged | tail appended | unchanged | unchanged |
| Closed-and-empty | unchanged | unchanged | unchanged | unchanged | unchanged |

---

## Direct Hand-off in Detail

The `send` helper, called from both `chansend` (when a receiver is parked) and the equivalent path in `chanrecv` (when a sender is parked), is the implementation of direct hand-off.

```go
// send processes a send operation on an empty channel c.
// The value ep sent by the sender is copied to the receiver sg.
// The receiver is then woken up to go on its merry way.
func send(c *hchan, sg *sudog, ep unsafe.Pointer, unlockf func(), skip int) {
    if sg.elem != nil {
        sendDirect(c.elemtype, sg, ep)
        sg.elem = nil
    }
    gp := sg.g
    unlockf()
    gp.param = unsafe.Pointer(sg)
    sg.success = true
    goready(gp, skip+1)
}
```

`sendDirect` does a `memmove` from `ep` (the sender's stack) into `sg.elem` (the receiver's stack address). The runtime has special handling here: the receiver was parked, so its stack will not move (no GC stack-shrink while parked), and the receiver's `ep` pointer is a stable target. The runtime uses `typedmemmovestack` to also handle write barriers if the element type contains pointers (the GC needs to know about the cross-stack write).

### Why direct hand-off is fast

Without direct hand-off, an unbuffered rendezvous would require:

1. Sender locks `c.lock`.
2. Sender sees no receiver, no buffer → parks.
3. Receiver later locks `c.lock`.
4. Receiver sees parked sender → take value from sender's `sudog.elem` into receiver's `ep`.
5. Wake sender.

That is two lock-unlock pairs and an extra copy through the `sudog`. With direct hand-off, the receiver is already parked, and the sender writes directly into the receiver's `ep`:

1. Sender locks `c.lock`.
2. Sender sees receiver parked → `typedmemmove(elemtype, sg.elem, ep)`.
3. Unlock; `goready` the receiver.

Saving one lock-unlock pair and one copy is a non-trivial fraction of the operation's total cost.

### The cross-stack write

`sg.elem` points into the *receiver's* stack frame (where the receive expression's destination is). The sender writes into that address from its own stack. This is unusual because Go's garbage collector usually relies on goroutine stacks being private. The trick: while a goroutine is parked, its stack is pinned (won't be relocated). The write barrier is invoked if `elemtype` contains pointers, so the GC sees the write.

---

## Buffer Rotation on Full-Buffer Receive

The "sender parked + buffer full" case is subtler than direct hand-off. The receiver wants to drain a value; the sender wants to add a value; the buffer is full. The runtime does this:

```go
func recv(c *hchan, sg *sudog, ep unsafe.Pointer, unlockf func(), skip int) {
    if c.dataqsiz == 0 {
        // Unbuffered: direct copy from sender's ep into receiver's ep.
        if ep != nil {
            recvDirect(c.elemtype, sg, ep)
        }
    } else {
        // Buffered, full: take from head of buffer; put sender's value at tail.
        qp := chanbuf(c, c.recvx)
        if ep != nil {
            typedmemmove(c.elemtype, ep, qp)
        }
        typedmemmove(c.elemtype, qp, sg.elem)
        c.recvx++
        if c.recvx == c.dataqsiz {
            c.recvx = 0
        }
        c.sendx = c.recvx // assignment: sendx tracks recvx in the full-buffer case
    }
    sg.elem = nil
    gp := sg.g
    unlockf()
    gp.param = unsafe.Pointer(sg)
    sg.success = true
    goready(gp, skip+1)
}
```

This is a clever optimisation. The buffer is full, so `sendx == recvx` (think of the ring: head and tail meet). The receiver:

1. Reads buffer[recvx] into its `ep`.
2. Writes sender's value into the same slot.
3. Advances `recvx`.
4. Sets `sendx = recvx` (the slot just written is now the new tail).

Net effect: the buffer stays full, but the receiver got one value out and the parked sender got their value in. No copy through `sudog.elem` to the buffer separately — the buffer slot does double duty.

If a queue of senders is parked, each subsequent receive does the same rotation, walking through senders FIFO.

---

## `closechan` and the Wake List

### Source

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

    c.closed = 1

    var glist gList

    // Drain recvq.
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
        glist.push(gp)
    }

    // Drain sendq.
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
        glist.push(gp)
    }
    unlock(&c.lock)

    // Wake each goroutine.
    for !glist.empty() {
        gp := glist.pop()
        gp.schedlink = 0
        goready(gp, 3)
    }
}
```

### Why two passes?

Drain inside the lock, wake outside the lock. If `goready` were called inside the critical section, it could cause cascading scheduling work while still holding `c.lock`, slowing other channel ops. By collecting goroutines into `glist` and releasing the lock first, the wake-up cost does not block other operations on the channel — even though, at this point, the channel is closed and no further operations on it make sense.

### What woken senders do

A parked sender, on wake-up, returns from `gopark` inside `chansend`. The post-park code reads `mysg.success`. `closechan` set it to `false`. The sender then panics with "send on closed channel."

So: closing a channel that has parked senders causes deferred panics in the sending goroutines. This is *not* a single panic in the closing goroutine — it is N panics, one per sender, after they wake. If those panics are unrecoverable (no `defer recover`), they crash the program.

### What woken receivers do

A parked receiver returns from `gopark` inside `chanrecv`. `mysg.success` is `false`. The receiver returns `(true, false)` — the standard "channel closed" return — without panicking.

Receivers always handle close gracefully. Senders never do.

---

## Wait Queue Behaviour

`waitq` is the doubly-linked list of `sudog` used for both `recvq` and `sendq`:

```go
type waitq struct {
    first *sudog
    last  *sudog
}

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
        // Filter out sudogs that were already woken by select.
        if sgp.isSelect && !sgp.g.selectDone.CompareAndSwap(0, 1) {
            continue
        }
        return sgp
    }
}
```

Two notable details:

- Strict FIFO order. The runtime does not allow "barging" in the wait queue itself — but barging *can* happen, because a new send/recv that arrives while waiters are still parked may complete its operation under the lock and only then check the queue. By the time the queue is checked, the new arrival has already won.

- `isSelect` filtering. A `sudog` from a `select` may be on multiple channels' queues. When one channel wakes the goroutine, that goroutine's `selectDone` is CAS'd. The dequeue function on other channels will skip already-claimed sudogs.

---

## Parking Mechanics: `gopark`

`gopark` puts the current goroutine to sleep:

```go
func gopark(unlockf func(*g, unsafe.Pointer) bool, lock unsafe.Pointer, reason waitReason, traceEv byte, traceskip int) {
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
```

`mcall(park_m)` switches to the M's `g0` (system stack), then runs `park_m`:

```go
func park_m(gp *g) {
    casgstatus(gp, _Grunning, _Gwaiting)
    dropg()

    if fn := mp.waitunlockf; fn != nil {
        ok := fn(gp, mp.waitlock)
        mp.waitunlockf = nil
        mp.waitlock = nil
        if !ok {
            // unlock failed; resurrect the goroutine.
            casgstatus(gp, _Gwaiting, _Grunnable)
            execute(gp, true)
        }
    }
    schedule()
}
```

Steps:

1. Goroutine status → `_Gwaiting`.
2. M drops the G (no longer associated).
3. The unlock function is called — for channel ops, this is `chanparkcommit`, which calls `unlock(&c.lock)`.
4. `schedule()` finds another G to run.

`chanparkcommit`:

```go
func chanparkcommit(gp *g, chanLock unsafe.Pointer) bool {
    gp.activeStackChans = true
    atomic.Store8(&gp.parkingOnChan, 0)
    unlock((*mutex)(chanLock))
    return true
}
```

The key trick: the channel lock is released *as part of parking*. This means the wake-side cannot find the sudog on the queue until the parker has fully gone to sleep. Without this dance, you could have a race where the waker sees an sudog whose goroutine status is still `_Grunning`.

---

## Waking Mechanics: `goready`

```go
func goready(gp *g, traceskip int) {
    systemstack(func() {
        ready(gp, traceskip, true)
    })
}

func ready(gp *g, traceskip int, next bool) {
    status := readgstatus(gp)
    casgstatus(gp, _Gwaiting, _Grunnable)
    runqput(getg().m.p.ptr(), gp, next)
    wakep()
}
```

The receiver/closer calls `goready` after the parker has already released the channel lock. The flow:

1. Goroutine status: `_Gwaiting` → `_Grunnable`.
2. `runqput` puts the goroutine on the current P's local runqueue (head if `next` is true, tail otherwise).
3. `wakep` ensures some idle P is woken to run the goroutine if no P is currently spinning.

The `next` parameter is `true` for channel wakeups — Go preferentially runs the woken goroutine soon, on the assumption that the just-completed channel op is part of a hot path.

---

## Select Readiness Check

`selectgo` (in `runtime/select.go`) handles `select`:

```go
func selectgo(cas0 *scase, order0 *uint16, pc0 *uintptr, nsends, nrecvs int, block bool) (int, bool) {
    cases := cas0[:ncases:ncases]
    pollorder := order0[:ncases:ncases]      // permutation
    lockorder := order0[ncases:][:ncases:ncases] // sorted by lock address

    // 1. Generate pollorder via Fisher-Yates shuffle.
    norder := 0
    for i := range pollorder {
        cas := &cases[i]
        if cas.c == nil {
            cas.elem = nil
            continue
        }
        j := fastrandn(uint32(norder + 1))
        pollorder[norder] = pollorder[j]
        pollorder[j] = uint16(i)
        norder++
    }
    pollorder = pollorder[:norder]

    // 2. Sort lockorder by channel address.
    //    Heap-sort, in place, using channel pointer as key.
    ...

    // 3. Lock all channels (in lockorder).
    sellock(scases, lockorder)

    // 4. Pass 1: find any case that is immediately ready.
    var casi int
    var cas *scase
    var caseSuccess bool
    var recvOK bool
    var sg *sudog
loop:
    for _, casei := range pollorder {
        casi = int(casei)
        cas = &scases[casi]
        c := cas.c
        if casi >= nsends {
            // Receive case.
            sg = c.sendq.dequeue()
            if sg != nil {
                goto recv
            }
            if c.qcount > 0 {
                goto bufrecv
            }
            if c.closed != 0 {
                goto rclose
            }
        } else {
            // Send case.
            if c.closed != 0 {
                goto sclose
            }
            sg = c.recvq.dequeue()
            if sg != nil {
                goto send
            }
            if c.qcount < c.dataqsiz {
                goto bufsend
            }
        }
    }

    // 5. None ready. If default, unlock all and take default.
    if !block {
        selunlock(scases, lockorder)
        casi = -1
        goto retc
    }

    // 6. Park on every channel.
    ...
    gopark(selparkcommit, nil, waitReasonSelect, traceBlockSelect, 1)

    // 7. Woken. Find which channel fired. Dequeue from the rest.
    ...
    goto retc
```

The big picture:

- One linear scan with the shuffled `pollorder` picks the first ready case.
- If no case is ready and there is no default, the goroutine parks itself on *every* channel in the select.
- When one channel wakes the goroutine, the runtime walks the other channels and removes the goroutine's sudog from their wait queues.

### Lock acquisition order: deadlock avoidance

`lockorder` is sorted by `hchan` pointer address. All `select` statements in the program agree on this ordering. So if two selects share two channels — say A and B — they both lock min(addr(A), addr(B)) first. No two-cycle deadlock is possible.

This is a classic lock-hierarchy trick. The cost is a sort (heap-sort, O(n log n)) per select. Selects with many cases pay this cost, but `n` is usually small.

### Why shuffle?

`pollorder` is shuffled to avoid bias. If we always checked source-order, a `select` with many ready cases would always take the first one. With shuffle, ready cases are chosen with equal probability — this prevents one channel from monopolising a worker that selects across many channels.

---

## Non-Blocking Variants

`chansend` and `chanrecv` accept a `block` parameter:

```go
chansend(c, &v, true,  callerpc)  // ch <- v (blocking)
chansend(c, &v, false, callerpc)  // select { case ch <- v: ... default: }
chanrecv(c, &v, true)             // <-ch (blocking)
chanrecv(c, &v, false)            // select { case v = <-ch: ... default: }
```

When `block=false`:

- The fast-path "non-blocking pre-check" (step B above) bails without locking if the channel is open and there is no work to do.
- After taking the lock, if we cannot complete immediately, we return `false` instead of parking.

The fast non-blocking check is a *read-without-lock*. It can race against another goroutine that changes `c.qcount` or `c.recvq`. But: races that miss a ready operation are acceptable for non-blocking — at worst, the `default` case fires when a true blocking op would have succeeded. The runtime accepts this. It does *not* accept missing a `closed` flag, which is why the closed check requires the atomic load.

---

## Practical Implications

### Why `select` cases are not free

Each case in a `select` is checked under a lock on its channel. A select with 8 cases on 8 different channels acquires 8 locks. That is 8x the lock cost of a single channel op. For very wide selects, this is measurable.

### Why a small buffer is sometimes worse than no buffer

An unbuffered channel between two ready goroutines uses direct hand-off and no buffer copy. A buffered channel (capacity 1) between the same two ready goroutines uses one buffer copy plus one drain — twice the data movement, in the worst case.

If the producer is consistently slightly faster than the consumer, a small buffer absorbs the difference. If they run in lockstep, an unbuffered channel is faster.

### Why `close` is a fanout

Closing a channel with N parked receivers wakes all N. Each wake is a `goready`, which puts the goroutine on a runqueue and may invoke `wakep`. If you close a channel with thousands of receivers, the closing goroutine is responsible for that whole avalanche — and it happens before `close` returns.

This is fine for "done" channels with a handful of receivers. It is not fine for "fan-out to a thousand workers and close" patterns where you want bounded wake-up time.

### Why direct hand-off helps latency but not throughput

Direct hand-off saves one copy and one wake. For a single rendezvous, that is a real win. For high-throughput pipelines, the bottleneck is `c.lock` contention, which direct hand-off does not address. To scale, you shard channels or batch sends.

---

## Summary

At middle level, the channel runtime is a small state machine: lock, decide based on closed/queues/buffer, act, unlock. The actions are:

- Hand off directly to a parked partner.
- Use the ring buffer.
- Park on a wait queue.
- (For close) drain both queues into a wake-list and wake everyone after unlocking.

The non-obvious bits are: direct hand-off across stacks, full-buffer rotation, the `selectgo` lock-ordering trick, and the dance between `gopark` and `chanparkcommit` to release the channel lock at exactly the right moment.

You now have enough of the model to read `runtime/chan.go` and `runtime/select.go` straight through. The senior level adds the `sudog` allocator, memory-model details, and scheduler interactions.
