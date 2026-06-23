# Send/Receive Flow — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Compiler Lowering of the Arrow](#compiler-lowering-of-the-arrow)
3. [The Three Wrappers](#the-three-wrappers)
4. [The Shape of `chansend`](#the-shape-of-chansend)
5. [The Shape of `chanrecv`](#the-shape-of-chanrecv)
6. [Unbuffered Send Walkthrough](#unbuffered-send-walkthrough)
7. [Unbuffered Receive Walkthrough](#unbuffered-receive-walkthrough)
8. [Buffered Send Walkthrough](#buffered-send-walkthrough)
9. [Buffered Receive Walkthrough](#buffered-receive-walkthrough)
10. [The Direct Handoff Mechanism](#the-direct-handoff-mechanism)
11. [Sudog Allocation and Recycling](#sudog-allocation-and-recycling)
12. [Park and Wake](#park-and-wake)
13. [The Closed-Channel Branches](#the-closed-channel-branches)
14. [Fast Path vs Slow Path](#fast-path-vs-slow-path)
15. [Memory Model Implications](#memory-model-implications)
16. [Latency Budget](#latency-budget)
17. [Comparison with `sync.Mutex`](#comparison-with-syncmutex)
18. [Reading the Source Without Drowning](#reading-the-source-without-drowning)
19. [Summary](#summary)

---

## Introduction

The middle level peels the wrapper off the channel operators. We will look at:

- The exact functions the compiler emits for `ch <- v`, `<-ch`, and `v, ok := <-ch`.
- The decision tree inside `chansend` and `chanrecv`.
- How direct handoff works and why it is two steps under the same lock.
- How `gopark` and `goready` form one round-trip when the runtime decides to park you.
- Where the buffered-channel ring buffer interacts with the wait queues.

This level assumes you have the basics from `junior.md` and the `hchan` struct from `09-channel-internals/01-hchan-struct`. We will not redefine `hchan`. Cross-check the field names if needed.

---

## Compiler Lowering of the Arrow

The Go compiler's lowering pass replaces every channel operator with a call to a runtime function. The decision happens in `cmd/compile/internal/gc/ssa.go` (older Go) or `cmd/compile/internal/ssagen/ssa.go` (Go 1.20+). Three cases:

```
Source           Compiler emits
---------------  --------------------------------
ch <- v          chansend1(ch, &v)
v := <-ch        chanrecv1(ch, &v)
v, ok := <-ch    ok = chanrecv2(ch, &v)
close(ch)        closechan(ch)
```

The arrow is not preserved in the SSA; only the function call survives. By the time the linker is done, the only thing that remains of your channel syntax is a `CALL runtime.chansend1` (or similar).

This is important because:

- Stack traces show `runtime.chansend1` (or `chanrecv1`/`chanrecv2`), not your arrow.
- Profiling samples appear under the runtime function.
- `go tool trace` events are emitted from inside these runtime functions.

### The `&v` part

When you write `ch <- f()`, the compiler does:

```
tmp := f()
chansend1(ch, &tmp)
```

It must materialise the value somewhere addressable before passing a pointer. Same for `<-ch`: the destination must be addressable.

For struct-valued sends and receives, the compiler may copy into and out of stack temporaries to ensure the pointer is valid for the duration of the call.

---

## The Three Wrappers

In `runtime/chan.go`:

```go
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

All three are `//go:nosplit` — they cannot grow their stack. They are tiny wrappers that pass `block = true` and the caller PC (for race detection) to the real worker.

The `block` parameter says "I am willing to wait." When the compiler lowers a `select` case, it passes `block = false`, which makes the runtime return immediately if the operation cannot complete synchronously.

`chanrecv` returns *two* booleans: `(selected, received)`. The wrapper for `chanrecv1` discards both. The wrapper for `chanrecv2` returns the second (which is `false` if the channel was closed and drained).

---

## The Shape of `chansend`

Stripped of race-detector and trace code, `chansend` looks like this:

```go
func chansend(c *hchan, ep unsafe.Pointer, block bool, callerpc uintptr) bool {
    if c == nil {
        if !block {
            return false
        }
        gopark(nil, nil, waitReasonChanSendNilChan, traceBlockForever, 2)
        throw("unreachable")
    }

    // Optional fast-path: no lock, just a non-blocking probe.
    if !block && c.closed == 0 && full(c) {
        return false
    }

    lock(&c.lock)

    if c.closed != 0 {
        unlock(&c.lock)
        panic(plainError("send on closed channel"))
    }

    // 1. Try direct handoff to a waiting receiver.
    if sg := c.recvq.dequeue(); sg != nil {
        send(c, sg, ep, func() { unlock(&c.lock) }, 3)
        return true
    }

    // 2. Try the buffer.
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

    if !block {
        unlock(&c.lock)
        return false
    }

    // 3. Park.
    gp := getg()
    mysg := acquireSudog()
    mysg.releasetime = 0
    mysg.elem = ep
    mysg.waitlink = nil
    mysg.g = gp
    mysg.isSelect = false
    mysg.c = c
    gp.waiting = mysg
    gp.param = nil
    c.sendq.enqueue(mysg)

    gopark(chanparkcommit, unsafe.Pointer(&c.lock), waitReasonChanSend, traceBlockChanSend, 2)

    // Woken.
    KeepAlive(ep) // ensure ep stays valid until wake
    gp.waiting = nil
    gp.activeStackChans = false
    closed := !mysg.success
    gp.param = nil
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

The shape:

1. nil-channel guard.
2. non-blocking fast-path probe.
3. lock.
4. closed check (panic).
5. direct handoff (dequeue from recvq).
6. buffer write.
7. park (sudog + gopark).
8. (woken) panic if closed, else success.

---

## The Shape of `chanrecv`

Similarly:

```go
func chanrecv(c *hchan, ep unsafe.Pointer, block bool) (selected, received bool) {
    if c == nil {
        if !block {
            return
        }
        gopark(nil, nil, waitReasonChanReceiveNilChan, traceBlockForever, 2)
        throw("unreachable")
    }

    // Non-blocking fast-path probe.
    if !block && empty(c) {
        if atomic.Load(&c.closed) == 0 {
            return
        }
        if empty(c) {
            if ep != nil {
                typedmemclr(c.elemtype, ep)
            }
            return true, false
        }
    }

    lock(&c.lock)

    if c.closed != 0 && c.qcount == 0 {
        unlock(&c.lock)
        if ep != nil {
            typedmemclr(c.elemtype, ep)
        }
        return true, false
    }

    // 1. Try direct handoff from a parked sender.
    if sg := c.sendq.dequeue(); sg != nil {
        recv(c, sg, ep, func() { unlock(&c.lock) }, 3)
        return true, true
    }

    // 2. Try the buffer.
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

    // 3. Park.
    gp := getg()
    mysg := acquireSudog()
    mysg.releasetime = 0
    mysg.elem = ep
    mysg.waitlink = nil
    gp.waiting = mysg
    mysg.g = gp
    mysg.isSelect = false
    mysg.c = c
    gp.param = nil
    c.recvq.enqueue(mysg)

    gopark(chanparkcommit, unsafe.Pointer(&c.lock), waitReasonChanReceive, traceBlockChanRecv, 2)

    // Woken.
    KeepAlive(c)
    gp.waiting = nil
    success := mysg.success
    gp.param = nil
    mysg.c = nil
    releaseSudog(mysg)
    return true, success
}
```

`chanrecv` is the mirror of `chansend`, with the closed-channel branch returning `(true, false)` and writing zero instead of panicking.

The two return values mean:

- `selected == true`: this receive completed (took a value or saw close).
- `received == true`: a real value was received (not the zero on close).

For the standalone `v, ok := <-ch`, `chanrecv2` returns `received` as `ok`.

---

## Unbuffered Send Walkthrough

You have:

```go
ch := make(chan int)
go func() { v := <-ch; use(v) }()
ch <- 42
```

The receiver runs first (typically). Step by step:

**Receiver (`chanrecv`)**:

1. `c.closed == 0`, `c.qcount == 0`. Buffer is empty.
2. `sendq.dequeue()` returns `nil`. No parked sender.
3. `c.qcount > 0` false. No buffer.
4. `block == true` → enter park path.
5. `acquireSudog()` → fresh sudog from the per-P pool.
6. `mysg.elem = ep` — the address where `v` will go.
7. `mysg.g = current goroutine`.
8. `recvq.enqueue(mysg)`.
9. `gopark(chanparkcommit, &c.lock, ...)`.
10. The `chanparkcommit` callback atomically: marks the goroutine as parked, unlocks the channel.
11. Scheduler runs other goroutines. This G is in state `_Gwaiting`.

**Sender (`chansend`)**:

1. `lock(&c.lock)`.
2. `c.closed == 0`.
3. `recvq.dequeue()` returns the receiver's `mysg`.
4. Call `send(c, sg, ep, ...)`. This is the direct-handoff helper:

```go
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

func sendDirect(t *_type, sg *sudog, src unsafe.Pointer) {
    // typedmemmove from src to sg.elem (receiver's destination).
    dst := sg.elem
    typeBitsBulkBarrier(t, uintptr(dst), uintptr(src), t.Size_)
    memmove(dst, src, t.Size_)
}
```

5. `sendDirect` copies `42` from the sender's stack (`ep` points to it) into the receiver's `v` (via `sg.elem`).
6. `unlockf()` releases the channel lock.
7. `sg.success = true`.
8. `goready(gp)` marks the receiver runnable.
9. `chansend` returns. Sender continues.

**Receiver resumes** at the line after `gopark`. The value is already in `v`. The receiver calls `releaseSudog(mysg)` and returns from `chanrecv`.

Key insight: **the receiver does not need to take the lock again**. The sender did the copy under the same lock. The receiver wakes up with the value already deposited.

---

## Unbuffered Receive Walkthrough

You have:

```go
ch := make(chan int)
go func() { ch <- 42 }()
v := <-ch
```

The sender parks first this time.

**Sender (`chansend`)**:

1. `lock(&c.lock)`.
2. `c.closed == 0`.
3. `recvq.dequeue()` returns `nil`.
4. `c.qcount < c.dataqsiz` false (both are 0).
5. Park path: `acquireSudog`, `mysg.elem = &42` (pointer to a stack slot holding 42), `sendq.enqueue(mysg)`, `gopark`.

**Receiver (`chanrecv`)**:

1. `lock(&c.lock)`.
2. `c.closed == 0` and `qcount == 0`: skip closed branch.
3. `sendq.dequeue()` returns the sender's `mysg`.
4. Call `recv(c, sg, ep, ...)`:

```go
func recv(c *hchan, sg *sudog, ep unsafe.Pointer, unlockf func(), skip int) {
    if c.dataqsiz == 0 {
        // Unbuffered: copy directly from sender's stack to receiver's dst.
        if ep != nil {
            recvDirect(c.elemtype, sg, ep)
        }
    } else {
        // Buffered: receiver takes from buf[recvx], sender's value
        //          replaces it in buf[recvx], indexes advance.
        qp := chanbuf(c, c.recvx)
        if ep != nil {
            typedmemmove(c.elemtype, ep, qp)
        }
        typedmemmove(c.elemtype, qp, sg.elem)
        c.recvx++
        if c.recvx == c.dataqsiz {
            c.recvx = 0
        }
        c.sendx = c.recvx
    }
    sg.elem = nil
    gp := sg.g
    unlockf()
    gp.param = unsafe.Pointer(sg)
    sg.success = true
    goready(gp, skip+1)
}

func recvDirect(t *_type, sg *sudog, dst unsafe.Pointer) {
    src := sg.elem
    typeBitsBulkBarrier(t, uintptr(dst), uintptr(src), t.Size_)
    memmove(dst, src, t.Size_)
}
```

5. For an unbuffered channel: `recvDirect` does `memmove` from sender's stack (via `sg.elem`) into the receiver's `v` (via `ep`).
6. Unlock, `sg.success = true`, `goready(sender)`.
7. Receiver returns from `chanrecv` with the value.
8. Sender wakes, releases sudog, returns from `chansend`.

---

## Buffered Send Walkthrough

You have:

```go
ch := make(chan int, 4)
ch <- 1
ch <- 2
ch <- 3 // (no receiver yet)
```

For each send:

1. `lock(&c.lock)`.
2. `c.closed == 0`.
3. `recvq.dequeue()` returns `nil` (no receivers).
4. `c.qcount < c.dataqsiz` (e.g., 0 < 4 for the first send).
5. Compute `qp = chanbuf(c, c.sendx)`. `chanbuf` is a tiny helper:

```go
func chanbuf(c *hchan, i uint) unsafe.Pointer {
    return add(c.buf, uintptr(i)*uintptr(c.elemsize))
}
```

6. `typedmemmove(elemtype, qp, ep)`: copy the value into the buffer slot.
7. `sendx = (sendx + 1) % dataqsiz`. `qcount++`.
8. `unlock`.
9. Return.

No sudog. No park. ~30–60 ns.

If `qcount == dataqsiz` (buffer full) and no receiver is parked, the sender takes the park path identical to the unbuffered case.

---

## Buffered Receive Walkthrough

You have:

```go
ch := make(chan int, 4)
ch <- 1
ch <- 2
v := <-ch // reads 1
```

For the receive:

1. `lock(&c.lock)`.
2. `c.closed == 0` (or `c.closed != 0`; doesn't matter as long as `qcount > 0`).
3. `sendq.dequeue()` returns `nil`.
4. `c.qcount > 0` (qcount == 2).
5. `qp = chanbuf(c, c.recvx)`.
6. `typedmemmove(elemtype, ep, qp)`: copy from buffer slot into `&v`.
7. `typedmemclr(elemtype, qp)`: zero the slot (so the GC doesn't see a stale pointer).
8. `recvx = (recvx + 1) % dataqsiz`. `qcount--`.
9. `unlock`.
10. Return `(selected=true, received=true)`.

If `qcount == 0` and there's a parked sender in `sendq` (because the buffer was full and a sender was waiting):

- `chanrecv` dequeues the sender from `sendq`.
- `recv` runs the *buffered* branch: reads `buf[recvx]` into receiver, copies sender's value into `buf[recvx]`, advances indices.
- This preserves the buffer FIFO order even with queued senders.

---

## The Direct Handoff Mechanism

The direct handoff is implemented by `send` and `recv` (the helper functions, not the public ones). The key property:

- The copy from sender to receiver happens *under the channel lock*.
- The lock is released before `goready`.
- The receiver, on wake, finds the value already in place.

This means there is **no second lock acquisition**, no second `memmove`. One lock, one copy, two `goready`s (one for each side of the rendezvous — but actually only one, because the goroutine that's *running* doesn't need to be readied).

### Why direct handoff matters

Without direct handoff, a send-with-receiver would have to:

1. Sender writes to the buffer.
2. Sender wakes the receiver.
3. Receiver locks the channel.
4. Receiver reads from the buffer.

That is two lock acquisitions and two `memmove`s. Direct handoff cuts it to one.

For an unbuffered channel there is *no buffer to write to*, so direct handoff is also the *only* way to transfer the value.

---

## Sudog Allocation and Recycling

A sudog is a 96-byte struct (varies a bit by Go version). Allocating one per blocked send/receive would be too expensive, so the runtime pools them.

```go
func acquireSudog() *sudog {
    // Pull from current P's local cache.
    mp := acquirem()
    pp := mp.p.ptr()
    if len(pp.sudogcache) == 0 {
        lock(&sched.sudoglock)
        for len(pp.sudogcache) < cap(pp.sudogcache)/2 && sched.sudogcache != nil {
            s := sched.sudogcache
            sched.sudogcache = s.next
            s.next = nil
            pp.sudogcache = append(pp.sudogcache, s)
        }
        unlock(&sched.sudoglock)
        if len(pp.sudogcache) == 0 {
            pp.sudogcache = append(pp.sudogcache, new(sudog))
        }
    }
    n := len(pp.sudogcache)
    s := pp.sudogcache[n-1]
    pp.sudogcache[n-1] = nil
    pp.sudogcache = pp.sudogcache[:n-1]
    if s.elem != nil {
        throw("acquireSudog: found s.elem != nil in cache")
    }
    releasem(mp)
    return s
}

func releaseSudog(s *sudog) {
    // Push back to P's local cache.
    if s.elem != nil { throw("...") }
    if s.next != nil { throw("...") }
    // ... defensive checks ...
    mp := acquirem()
    pp := mp.p.ptr()
    if len(pp.sudogcache) == cap(pp.sudogcache) {
        // Spill half back to the central cache.
        var first, last *sudog
        for len(pp.sudogcache) > cap(pp.sudogcache)/2 {
            n := len(pp.sudogcache)
            p := pp.sudogcache[n-1]
            pp.sudogcache[n-1] = nil
            pp.sudogcache = pp.sudogcache[:n-1]
            if first == nil {
                first = p
            } else {
                last.next = p
            }
            last = p
        }
        lock(&sched.sudoglock)
        last.next = sched.sudogcache
        sched.sudogcache = first
        unlock(&sched.sudoglock)
    }
    pp.sudogcache = append(pp.sudogcache, s)
    releasem(mp)
}
```

So sudog allocation is *almost always* a per-P cache pop, ~10 ns. The central cache is touched only on overflow/underflow.

---

## Park and Wake

`gopark` (in `runtime/proc.go`) is the universal "go to sleep" primitive:

```go
func gopark(unlockf func(*g, unsafe.Pointer) bool, lock unsafe.Pointer, reason waitReason, traceReason traceBlockReason, traceskip int) {
    // ...
    mp := acquirem()
    gp := mp.curg
    status := readgstatus(gp)
    // ...
    mp.waitlock = lock
    mp.waitunlockf = unlockf
    gp.waitreason = reason
    mp.waitTraceBlockReason = traceReason
    mp.waitTraceSkip = traceskip
    releasem(mp)
    // can't do anything that might move the G off this M from here on.
    mcall(park_m)
}
```

`park_m` runs on the M's `g0`:

```go
func park_m(gp *g) {
    mp := getg().m
    // ...
    casgstatus(gp, _Grunning, _Gwaiting)
    dropg()
    if fn := mp.waitunlockf; fn != nil {
        ok := fn(gp, mp.waitlock)
        mp.waitunlockf = nil
        mp.waitlock = nil
        if !ok {
            // spurious -> resume
            casgstatus(gp, _Gwaiting, _Grunnable)
            execute(gp, true)
        }
    }
    schedule()
}
```

The `unlockf` callback — for channels, this is `chanparkcommit`:

```go
func chanparkcommit(gp *g, chanLock unsafe.Pointer) bool {
    // There are unlocked sudogs that point into gp's stack. Stack
    // copying must lock the channels of those sudogs.
    gp.activeStackChans = true
    // Mark that it's safe for stack shrinking to occur now,
    // because any thread acquiring this G's stack for shrinking
    // is guaranteed to observe activeStackChans after this store.
    unlock((*mutex)(chanLock))
    return true
}
```

This callback is what atomically releases the channel lock once the goroutine is committed to waiting. The atomicity matters: between "I will park" and "I have released the lock", no one else can wake me — but no one needs to either, because the lock is still held.

`goready` (called by the waker):

```go
func goready(gp *g, traceskip int) {
    systemstack(func() {
        ready(gp, traceskip, true)
    })
}

func ready(gp *g, traceskip int, next bool) {
    // ...
    casgstatus(gp, _Gwaiting, _Grunnable)
    runqput(mp.p.ptr(), gp, next)
    wakep()
}
```

So a wake costs: status CAS, runqueue push, optional `wakep` (which may launch a new M if there are no spinning Ps).

### The full park-wake cycle cost

```
acquireSudog                  ~10 ns
sudog setup                   ~5 ns
sendq/recvq enqueue           ~5 ns
gopark + park_m + schedule    ~80 ns (and a context switch)
... time passes ...
peer dequeue + send/recv      ~30 ns
goready + ready + wakep       ~80 ns (and a context switch)
sudog release                 ~10 ns
```

Total round-trip: ~200+ ns plus the cost of two context switches on the M.

Compare to direct handoff: ~50 ns. A 4x difference.

---

## The Closed-Channel Branches

In `chansend`:

```go
lock(&c.lock)
if c.closed != 0 {
    unlock(&c.lock)
    panic(plainError("send on closed channel"))
}
```

If a sender already parked and then the channel is closed by `closechan`, the sender is woken with `mysg.success = false`. On resumption:

```go
closed := !mysg.success
// ...
if closed {
    if c.closed == 0 {
        throw("chansend: spurious wakeup")
    }
    panic(plainError("send on closed channel"))
}
```

So senders can panic from two places:

1. They lock and find `c.closed != 0`.
2. They wake from `sendq` with `success == false`.

In `chanrecv`:

```go
lock(&c.lock)
if c.closed != 0 && c.qcount == 0 {
    unlock(&c.lock)
    if ep != nil {
        typedmemclr(c.elemtype, ep)
    }
    return true, false
}
```

A closed channel with an empty buffer returns `(true, false)` — `selected == true`, `received == false`. The receive does not panic; it returns the zero value.

If a receiver is parked on `recvq` and the channel is closed, the receiver is woken with `mysg.success = false`. Resumption returns the same `(true, false)`.

---

## Fast Path vs Slow Path

`chansend` has a fast-path check at the top *only when `block == false`*:

```go
if !block && c.closed == 0 && full(c) {
    return false
}
```

`full(c)` is:

```go
func full(c *hchan) bool {
    if c.dataqsiz == 0 {
        return c.recvq.first == nil
    }
    return c.qcount == c.dataqsiz
}
```

For a non-blocking `select` send case: if buffer is full and no receiver is parked, return immediately without locking. This is the only lock-free shortcut.

For blocking sends (`ch <- v` directly), the lock is always taken.

`chanrecv` has a similar non-blocking shortcut for `empty(c)`.

The takeaway: the *blocking* arrow forms have no lock-free fast path. Each send/receive does a `lock(&c.lock)` even if the operation completes immediately. The lock itself is uncontended in single-pair flows, so it's cheap — but it is not nothing.

---

## Memory Model Implications

The Go memory model says:

> A send on a channel happens before the corresponding receive from that channel completes.

How the runtime ensures this:

- The `lock(&c.lock)` / `unlock(&c.lock)` pair gives acquire/release semantics.
- The sender writes the value into the receiver's destination (or into the buffer) *under* the lock.
- The receiver reads the value *under* the same lock.
- Therefore any writes the sender did before `ch <- v` are visible to the receiver after `<-ch`.

For direct handoff: even stronger, because the same goroutine does *both* writes (sender writes value, then immediately writes to memory via `sendDirect`). The single memory-ordering boundary is the lock release on the sender side.

The race detector instruments these points (`racerelease` at send, `raceacquire` at receive) to verify the memory model holds.

---

## Latency Budget

Putting numbers together:

| Path | Approximate cost |
|---|---|
| Send direct handoff (unbuffered) | 40–100 ns |
| Receive direct handoff (unbuffered) | 40–100 ns |
| Send to buffer (room available) | 30–60 ns |
| Receive from buffer (data available) | 30–60 ns |
| Send to closed channel (panic) | ~1 µs (panic propagation) |
| Receive from closed empty channel | 30–60 ns |
| Send park-and-wake | ~200 ns + scheduler |
| Receive park-and-wake | ~200 ns + scheduler |

These are wall-clock numbers on a modern x86. ARM is slightly higher; cache-cold cases significantly higher.

For comparison:

- `sync.Mutex.Lock` + `Unlock` uncontended: ~25–50 ns.
- `sync.Mutex.Lock` + `Unlock` with one waiter (Go's semaphore-backed slow path): ~200+ ns.

So a channel send/receive has the same order of magnitude as a mutex, with direct handoff being the equivalent of an uncontended mutex round-trip.

---

## Comparison with `sync.Mutex`

A channel-based handoff:

```go
ch <- value
// ... receiver ...
v := <-ch
```

A mutex-based handoff:

```go
mu.Lock()
value = v
mu.Unlock()
// ... receiver ...
mu.Lock()
v = value
mu.Unlock()
```

Both serialise access. The mutex version requires manual signalling (perhaps a `sync.Cond`) for the receiver to know when data is ready. The channel version bundles the signalling.

Cost comparison for the "happy path":

| Operation | Mutex | Channel direct handoff |
|---|---|---|
| Lock acquire | ~15 ns | ~15 ns (`c.lock`) |
| Memory operation | (your code) | one memmove |
| Wake/signal | (cond signal: ~150 ns) | inline (`goready`) |
| Lock release | ~15 ns | ~15 ns |

For one-shot signal + value transfer, the channel is *cheaper* than `Mutex + Cond` because the runtime fuses signalling and lock release.

For thousands of unrelated reads of shared state, a `sync.RWMutex` is cheaper than a channel-based design — that is not the channel's strong point.

---

## Reading the Source Without Drowning

`runtime/chan.go` is ~800 lines. To find what you need:

1. Search for `func chansend(`. Read to the end of the function (~100 lines).
2. Search for `func chanrecv(`. Read to the end (~120 lines).
3. Search for `func send(`. Tiny (~20 lines), the direct-handoff helper.
4. Search for `func recv(`. Slightly larger because of buffered-receiver-with-queued-sender logic (~40 lines).
5. Skip race detector branches on first read.

When you encounter unfamiliar runtime functions:

- `lock`, `unlock` → runtime mutex (`runtime/lock_futex.go` on Linux).
- `gopark`, `goready`, `acquireSudog`, `releaseSudog` → `runtime/proc.go`.
- `typedmemmove`, `typedmemclr` → `runtime/mbarrier.go`, `runtime/memclr_*.s`. GC-aware memory copies.
- `getcallerpc`, `getg` → runtime intrinsics, defined in assembly.

Reading the entire file in one pass is overwhelming. Read by *path*: pick "what happens for an unbuffered send-with-parked-receiver" and trace only that path. Then pick another path.

---

## Summary

`ch <- v` and `<-ch` are not language primitives; they are function calls into `runtime.chansend1` and `runtime.chanrecv1` (or `chanrecv2` for the comma-ok form). The real workers `chansend` and `chanrecv` follow a three-step decision: direct handoff → buffer hop → park. Each step requires the channel lock; the unlock happens either inline (handoff and buffer paths) or atomically with `gopark` via the `chanparkcommit` callback.

Direct handoff is the runtime's preferred outcome whenever a peer is already waiting. The value is `memmove`d straight from sender's stack to receiver's stack (or vice versa) under one lock. The receiver wakes with the value already in place.

Buffered channels add the ring buffer as a fallback when no peer is waiting. The buffer is a circular array with two indices and a `qcount`.

Park costs ~200 ns plus a scheduler round-trip; direct handoff and buffer hop cost 30–100 ns. Comparable to `sync.Mutex` in both cases.

The senior level digs into the direct-handoff implementation, sudog lifecycles, and race detector hooks. The professional level reads `runtime/chan.go` line by line.
