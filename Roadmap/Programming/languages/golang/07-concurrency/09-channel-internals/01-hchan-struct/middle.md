# The `hchan` Struct — Middle

[← Back to index](index.md)

## Table of Contents
1. [What This Page Adds Over Junior](#what-this-page-adds-over-junior)
2. [Recap: the Struct and Its Fields](#recap-the-struct-and-its-fields)
3. [The Three Buffer States](#the-three-buffer-states)
4. [The Circular Index Arithmetic](#the-circular-index-arithmetic)
5. [`chansend` — the Three Paths](#chansend-the-three-paths)
6. [Path A: Hand-off to a Waiting Receiver](#path-a-hand-off-to-a-waiting-receiver)
7. [Path B: Buffer Has Room](#path-b-buffer-has-room)
8. [Path C: Block on Send](#path-c-block-on-send)
9. [`chanrecv` — the Symmetric Three Paths](#chanrecv-the-symmetric-three-paths)
10. [`send` and `recv` Helper Functions](#send-and-recv-helper-functions)
11. [`closechan` and the `closed` Flag](#closechan-and-the-closed-flag)
12. [Why `lock` Wraps Everything](#why-lock-wraps-everything)
13. [Read-Without-Lock Optimisations](#read-without-lock-optimisations)
14. [How `select` Picks a Case](#how-select-picks-a-case)
15. [The Element Copy Path](#the-element-copy-path)
16. [GC, Pointers, and `elemtype`](#gc-pointers-and-elemtype)
17. [Where `hchanSize` Comes From](#where-hchansize-comes-from)
18. [Putting It Together: a Worked Trace](#putting-it-together-a-worked-trace)
19. [What to Read Next](#what-to-read-next)

---

## What This Page Adds Over Junior

Junior introduced the eleven fields and showed where they live in memory. This middle page traces *what those fields do during a send and a receive*. By the end you should be able to read `chansend` and `chanrecv` in `runtime/chan.go` end-to-end without confusion, and know which field is touched at each step.

We stay on the in-language level — no signal handlers, no race-detector internals, no GC barriers in detail. Those are for senior and professional.

---

## Recap: the Struct and Its Fields

For reference, the struct again:

```go
type hchan struct {
    qcount   uint
    dataqsiz uint
    buf      unsafe.Pointer
    elemsize uint16
    closed   uint32
    elemtype *_type
    sendx    uint
    recvx    uint
    recvq    waitq
    sendq    waitq
    lock     mutex
}
```

Imagine three groups:

- **Buffer state**: `qcount`, `dataqsiz`, `buf`, `elemsize`, `sendx`, `recvx`, `elemtype`.
- **Wait queues**: `recvq`, `sendq`.
- **Synchronisation**: `lock` (and the always-modifiable `closed`).

`chansend` and `chanrecv` operate on all three groups under the protection of `lock`.

---

## The Three Buffer States

At any moment the buffer is in one of three states:

| State | Condition | Effect on send | Effect on recv |
|---|---|---|---|
| Empty | `qcount == 0` | Hand to waiter, or write to buffer, or block | Block (or grab from sendq if any) |
| Has data | `0 < qcount < dataqsiz` | Write to buffer | Read from buffer |
| Full | `qcount == dataqsiz` | Block | Read from buffer, possibly wake a sender |

For unbuffered channels (`dataqsiz == 0`), only the "Empty" row applies: there is never a slot to put a value in.

The wait queues add cross-cutting subtleties:

- If `recvq` is non-empty, a producer can hand-off **directly** to a parked receiver, skipping the buffer entirely. The receiver had to be parked because the buffer was empty when it arrived; now the buffer is still empty and the producer's value bypasses it.
- If `sendq` is non-empty (only possible when buffer is full **or** unbuffered), a receiver pulls one value from the buffer (advancing `recvx`) **and** wakes a parked sender so it can place its value in the freshly vacated slot.

---

## The Circular Index Arithmetic

Both `sendx` and `recvx` live in the range `[0, dataqsiz)`. After each operation:

```go
c.sendx++
if c.sendx == c.dataqsiz {
    c.sendx = 0
}
```

The runtime uses an explicit `if` instead of `%` because modulo is slower on some architectures when the divisor is not known to be a power of two. The `if`-and-reset pattern is the canonical ring-buffer increment.

`chanbuf(c, i)` computes the address of slot `i`:

```go
func chanbuf(c *hchan, i uint) unsafe.Pointer {
    return add(c.buf, uintptr(i)*uintptr(c.elemsize))
}
```

Plain pointer arithmetic. No bounds checks at runtime because the caller maintains the invariant `i < dataqsiz` itself.

A sanity check: `qcount` always equals `(sendx - recvx + dataqsiz) mod dataqsiz` when the queue is non-empty, and equals `0` otherwise. Both `qcount == 0` and `qcount == dataqsiz` make `sendx == recvx`; the count breaks the ambiguity.

---

## `chansend` — the Three Paths

The full skeleton of `chansend`, from `runtime/chan.go`, simplified:

```go
func chansend(c *hchan, ep unsafe.Pointer, block bool, callerpc uintptr) bool {
    if c == nil {
        if !block { return false }
        gopark(nil, nil, waitReasonChanSendNilChan, traceBlockForever, 2)
        throw("unreachable")
    }

    // Fast path: select-on-not-ready-buffered-channel.
    if !block && c.closed == 0 && full(c) {
        return false
    }

    lock(&c.lock)

    if c.closed != 0 {
        unlock(&c.lock)
        panic(plainError("send on closed channel"))
    }

    // Path A: a receiver is already waiting.
    if sg := c.recvq.dequeue(); sg != nil {
        send(c, sg, ep, func() { unlock(&c.lock) }, 3)
        return true
    }

    // Path B: buffer has room.
    if c.qcount < c.dataqsiz {
        qp := chanbuf(c, c.sendx)
        typedmemmove(c.elemtype, qp, ep)
        c.sendx++
        if c.sendx == c.dataqsiz { c.sendx = 0 }
        c.qcount++
        unlock(&c.lock)
        return true
    }

    // Path C: block (or return false for non-blocking).
    if !block {
        unlock(&c.lock)
        return false
    }

    // Park.
    gp := getg()
    mysg := acquireSudog()
    mysg.elem = ep
    mysg.g = gp
    mysg.c = c
    gp.waiting = mysg
    c.sendq.enqueue(mysg)
    gopark(chanparkcommit, unsafe.Pointer(&c.lock), waitReasonChanSend, traceBlockChanSend, 2)

    // ... woken up, cleanup ...
    return true
}
```

Three paths after the lock is acquired. The order matters: A before B because direct hand-off is faster (and required for unbuffered channels). B before C because not blocking is preferable to parking.

---

## Path A: Hand-off to a Waiting Receiver

If `c.recvq` has a parked receiver, the sender's value goes **directly** to that receiver's destination buffer. No buffer slot is touched.

Inside `send` (helper, also in `chan.go`):

```go
func send(c *hchan, sg *sudog, ep unsafe.Pointer, unlockf func(), skip int) {
    // If buffer is non-empty, the queue invariant says recvq must be empty.
    // So when recvq has a waiter, the buffer is either empty or unbuffered.
    if sg.elem != nil {
        sendDirect(c.elemtype, sg, ep)
        sg.elem = nil
    }
    gp := sg.g
    unlockf()  // release c.lock
    gp.param = unsafe.Pointer(sg)
    sg.success = true
    goready(gp, skip+1)
}
```

`sendDirect` performs a `typedmemmove` from the sender's source (`ep`) to the receiver's destination (`sg.elem`, which is the address where the receiver wants the value). The receiver is now ready to run.

Important detail: `unlockf` is called **before** `goready`. The runtime comment we already cited warns: do not change another G's status while holding `hchan.lock` — that can deadlock with stack shrinking on the woken goroutine.

---

## Path B: Buffer Has Room

If the buffer has free space and there is no waiter (which the order of paths guarantees), the sender copies its value into slot `sendx`, advances `sendx` and `qcount`, then releases the lock.

```go
qp := chanbuf(c, c.sendx)
typedmemmove(c.elemtype, qp, ep)
c.sendx++
if c.sendx == c.dataqsiz { c.sendx = 0 }
c.qcount++
unlock(&c.lock)
```

The lock is held only for these few instructions. This is the fastest path for a buffered channel under no contention: enter, copy, advance, exit.

`typedmemmove` is used (not raw `memmove`) because the GC must observe the new pointer in the buffer if the element contains pointers. For pointer-free element types the call falls through to a plain `memmove`.

---

## Path C: Block on Send

If the buffer is full and no receiver is waiting, the sender must park. Steps:

1. Acquire a `sudog` from the local P's free list (or allocate one).
2. Fill in `elem`, `g`, `c`, etc.
3. Append `sudog` to `c.sendq`.
4. Call `gopark` with `unlockf` set to release `c.lock` after the goroutine is fully parked. (`chanparkcommit` is the unlock function — it atomically transitions the G to `_Gwaiting` and unlocks.)

When woken up (because a receiver has consumed our element), `goready` resumed our G; we wake at the line right after `gopark`. The cleanup:

```go
gp.waiting = nil
mysg.c = nil
releaseSudog(mysg)
```

Returns `true` (send succeeded). If `c.closed` was set while we were parked, the runtime sets `mysg.success = false` and we panic on resume.

---

## `chanrecv` — the Symmetric Three Paths

`chanrecv` mirrors `chansend`. From the same file, simplified:

```go
func chanrecv(c *hchan, ep unsafe.Pointer, block bool) (selected, received bool) {
    if c == nil {
        if !block { return }
        gopark(nil, nil, waitReasonChanReceiveNilChan, traceBlockForever, 2)
    }

    lock(&c.lock)

    // Channel is closed and buffer is empty: return zero value.
    if c.closed != 0 && c.qcount == 0 {
        unlock(&c.lock)
        if ep != nil {
            typedmemclr(c.elemtype, ep)
        }
        return true, false
    }

    // Path A: a sender is waiting.
    if sg := c.sendq.dequeue(); sg != nil {
        recv(c, sg, ep, func() { unlock(&c.lock) }, 3)
        return true, true
    }

    // Path B: buffer has data.
    if c.qcount > 0 {
        qp := chanbuf(c, c.recvx)
        if ep != nil {
            typedmemmove(c.elemtype, ep, qp)
        }
        typedmemclr(c.elemtype, qp)
        c.recvx++
        if c.recvx == c.dataqsiz { c.recvx = 0 }
        c.qcount--
        unlock(&c.lock)
        return true, true
    }

    // Path C: block.
    if !block {
        unlock(&c.lock)
        return false, false
    }

    gp := getg()
    mysg := acquireSudog()
    mysg.elem = ep
    mysg.g = gp
    mysg.c = c
    gp.waiting = mysg
    c.recvq.enqueue(mysg)
    gopark(chanparkcommit, unsafe.Pointer(&c.lock), waitReasonChanReceive, traceBlockChanRecv, 2)

    // ... woken, cleanup ...
    return true, mysg.success
}
```

The structure mirrors `chansend`:

- Closed-and-empty fast exit at the top (returns zero value, `ok = false`).
- Path A: if `sendq` has a waiter, take its element.
- Path B: if buffer has data, copy out.
- Path C: park.

A subtle asymmetry: in Path A for the receiver, the sender being parked means the buffer is **either** full (buffered case) or unbuffered. For the buffered case, the receiver must take the *oldest* element from the buffer (at `recvx`) and the sender's element goes into the *freshly vacated* slot (`sendx` after wrap). This bit of bookkeeping is in `recv`.

---

## `send` and `recv` Helper Functions

`send` we already saw. Here is `recv`:

```go
func recv(c *hchan, sg *sudog, ep unsafe.Pointer, unlockf func(), skip int) {
    if c.dataqsiz == 0 {
        // Unbuffered: copy directly from sender to receiver.
        if ep != nil {
            recvDirect(c.elemtype, sg, ep)
        }
    } else {
        // Buffered: take from buffer at recvx, put sender's value at sendx.
        qp := chanbuf(c, c.recvx)
        if ep != nil {
            typedmemmove(c.elemtype, ep, qp)
        }
        // Move sender's value into the just-vacated slot.
        typedmemmove(c.elemtype, qp, sg.elem)
        c.recvx++
        if c.recvx == c.dataqsiz { c.recvx = 0 }
        c.sendx = c.recvx  // by invariant since queue is full
    }
    sg.elem = nil
    gp := sg.g
    unlockf()
    gp.param = unsafe.Pointer(sg)
    sg.success = true
    goready(gp, skip+1)
}
```

Two cases:

- **Unbuffered**: just copy from `sg.elem` to `ep` and wake the sender.
- **Buffered (full)**: pop from `recvx`, push sender's value into the same slot (which becomes the new `sendx`), and wake the sender.

This is the magic that keeps a full buffered channel "alive" under producer-faster-than-consumer load: every receive both advances the head *and* opens space for one parked sender, atomically.

---

## `closechan` and the `closed` Flag

`close(ch)` calls `runtime.closechan`:

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
    // Wake all parked receivers.
    for {
        sg := c.recvq.dequeue()
        if sg == nil { break }
        if sg.elem != nil {
            typedmemclr(c.elemtype, sg.elem)
            sg.elem = nil
        }
        gp := sg.g
        gp.param = unsafe.Pointer(sg)
        sg.success = false
        glist.push(gp)
    }
    // Wake all parked senders (they will panic).
    for {
        sg := c.sendq.dequeue()
        if sg == nil { break }
        gp := sg.g
        gp.param = unsafe.Pointer(sg)
        sg.success = false
        glist.push(gp)
    }
    unlock(&c.lock)

    for !glist.empty() {
        gp := glist.pop()
        gp.schedlink = 0
        goready(gp, 3)
    }
}
```

Key observations:

- `closed` is set to `1` and never returns to `0`.
- Both queues are drained under the lock; goroutines are collected into a local list.
- `goready` is called **after** releasing the lock — same rule as `send`/`recv`.
- Parked senders are woken with `success = false`; their `chansend` code path sees this and panics.

So "close" is, mechanically, a flag flip plus a queue drain. The semantic complexity (panics, zero values, range loop termination) all derives from how `chansend`/`chanrecv` interpret `closed`.

---

## Why `lock` Wraps Everything

Everything done on the buffer (`qcount`, `sendx`, `recvx`, `buf` writes) and on the wait queues happens under `c.lock`. The reasons:

- Multiple senders may race for the same `sendx` slot.
- Multiple receivers may race for the same `recvx` slot.
- A close-in-progress must see a consistent view of the queues to drain them.
- The two queues are coupled (`recvq` empty implies the buffer is non-empty before a sender wakes one).

A `mutex` (runtime spin-mutex) is used rather than `sync.Mutex` because the critical section is *tiny* — a handful of pointer operations and a memcpy. Spinning briefly is cheaper than the user-space `sync.Mutex` slow path. Plus, `sync.Mutex` itself would be implemented on top of runtime primitives, creating a layering loop.

---

## Read-Without-Lock Optimisations

A few reads bypass `c.lock`:

- `len(ch)` reads `c.qcount` atomically without locking.
- `cap(ch)` reads `c.dataqsiz` (a constant after `makechan`, so even atomic is unnecessary).
- The non-blocking *fast path* at the very top of `chansend` peeks at `c.closed` and "is full?" without the lock, to avoid the lock-lock-release dance when the answer is obvious.

The "full" check is in `func full(c *hchan) bool`:

```go
func full(c *hchan) bool {
    if c.dataqsiz == 0 {
        return c.recvq.first == nil
    }
    return c.qcount == c.dataqsiz
}
```

This is racy (you might observe a stale value), but the runtime corrects under the lock if it ends up taking the slow path. The fast path is only an optimisation for `select` cases that should return immediately when not ready.

---

## How `select` Picks a Case

A multi-case `select` builds an array of `scase` structures, each with a channel pointer and the operation. The runtime then:

1. Locks all involved channels in a deterministic order (pointer order) to prevent deadlock.
2. Polls each case: if any case is ready, take it now.
3. If none are ready, the runtime enqueues `sudog`s on **each** channel involved.
4. The goroutine parks once. The first channel to wake it removes its `sudog` from all other channels.

The relevant struct is `scase`; the relevant functions are `selectgo` and `selunlock`. For this page, the takeaway is: a `select` involves one `sudog` per case. A goroutine doing `select { case ch1 <- v; case <-ch2 }` allocates two `sudog`s, queued on `ch1.sendq` and `ch2.recvq` respectively. The `isSelect` field of `sudog` flags this; on wake, the runtime walks `g.waiting` to remove all the other `sudog`s.

---

## The Element Copy Path

Every element transfer goes through `typedmemmove(elemtype, dst, src)`. For pointer-free elements (`int`, `bool`, `[16]byte`) this collapses into a `memmove`. For elements containing pointers (`*T`, `string`, `interface{}`, `[]T`, `map[K]V`, structs with pointer fields) the function emits the appropriate write barriers.

Write barriers ensure the garbage collector observes the new pointer in the destination. Without them, the GC could miss a reference and free a still-reachable object.

This is one of the reasons benchmarks of channels show measurable differences between `chan int` and `chan *T`. Same data structure, but the per-element cost is higher when GC must be informed.

---

## Where `hchanSize` Comes From

`hchanSize` is a runtime constant defined as:

```go
const hchanSize = unsafe.Sizeof(hchan{}) + uintptr(-int(unsafe.Sizeof(hchan{}))&(maxAlign-1))
```

In words: `sizeof(hchan)`, rounded up to a multiple of `maxAlign`. `maxAlign` is `8` on most platforms.

For amd64 today, the unrounded size is something like 88 bytes, rounded to 96. The buffer follows immediately at offset `hchanSize` (for the pointer-free single-alloc case).

The alignment matters because the runtime computes `c.buf = add(unsafe.Pointer(c), hchanSize)` and assumes the result is suitably aligned for the element type.

---

## Putting It Together: a Worked Trace

Consider:

```go
ch := make(chan int, 2)
ch <- 1
ch <- 2
// no receiver yet
go func() { ch <- 3 }()    // will park
go func() { ch <- 4 }()    // will park
time.Sleep(10 * time.Millisecond)
fmt.Println(<-ch)          // receives 1
fmt.Println(<-ch)          // receives 2 ...and wakes the third sender
```

State after `ch <- 1; ch <- 2`:

```
qcount   = 2
dataqsiz = 2
sendx    = 0   (after wrap from 2)
recvx    = 0
buf      = [1, 2]
sendq    = empty
recvq    = empty
closed   = 0
```

After the two parking goroutines run `ch <- 3` and `ch <- 4` (in some order, say 3 then 4):

```
qcount   = 2
sendx    = 0
recvx    = 0
buf      = [1, 2]
sendq    = [sudog(g=G_3, elem=&3) -> sudog(g=G_4, elem=&4)]
recvq    = empty
```

Now `<-ch` runs. Path B (buffer has data). It reads `buf[recvx]` = `1`, clears the slot, advances `recvx = 1`, decrements `qcount = 1`. After releasing the lock... wait. Step back. The receiver code path is:

```go
if c.qcount > 0 {
    qp := chanbuf(c, c.recvx)
    typedmemmove(c.elemtype, ep, qp)
    typedmemclr(c.elemtype, qp)
    c.recvx++
    if c.recvx == c.dataqsiz { c.recvx = 0 }
    c.qcount--
    unlock(&c.lock)
    return true, true
}
```

So actually Path A is checked first (`sendq.dequeue()`). Because `sendq` is non-empty, we take Path A via `recv`:

```go
// Buffered case:
qp := chanbuf(c, c.recvx)        // qp = &buf[0] (==1)
typedmemmove(c.elemtype, ep, qp) // ep = 1
typedmemmove(c.elemtype, qp, sg.elem) // buf[0] = 3
c.recvx++                        // recvx = 1
c.sendx = c.recvx                // sendx = 1
```

State after first `<-ch`:

```
qcount   = 2      (unchanged: one out, one in)
sendx    = 1
recvx    = 1
buf      = [3, 2]
sendq    = [sudog(g=G_4, elem=&4)]
recvq    = empty
```

`G_3` is woken; `ch <- 3` returns.

Second `<-ch`: same code path. Reads `buf[recvx]` = `buf[1]` = `2`. Pushes `4` into `buf[1]`. Advances indices.

```
qcount   = 2
sendx    = 0      (wrapped)
recvx    = 0      (wrapped)
buf      = [3, 4]
sendq    = empty
recvq    = empty
```

`G_4` is woken; `ch <- 4` returns.

Two further `<-ch` calls would drain the buffer normally (Path B each time):

```
After receive of 3: qcount=1, recvx=1, buf=[_, 4]
After receive of 4: qcount=0, recvx=0, buf=[_, _]
```

End state. The trace shows how Path A on receive keeps `qcount` constant by simultaneously dequeueing and enqueueing.

---

## What to Read Next

- **`senior.md`** — `waitq` and `sudog` internals, the runtime mutex's spin behavior, cache-line layout, and the compiler-side rewrites for `select` cases.
- **`professional.md`** — Full source walk of `runtime/chan.go` with line numbers and version annotations.
- **`02-runtime-behavior/`** — How the scheduler treats channels-blocked goroutines, including async preemption interactions.
- **`03-buffer-mechanics/`** — Pathological buffer scenarios and how the indices behave under heavy fan-in/fan-out.
- **`tasks.md`** — Exercises that ask you to reproduce `chansend` and `chanrecv` from scratch.
