# Buffered vs Unbuffered Channels — Professional Level

## Table of Contents
1. [Internals Overview](#internals-overview)
2. [The `hchan` Struct](#the-hchan-struct)
3. [Send Path: `chansend` Walkthrough](#send-path-chansend-walkthrough)
4. [Receive Path: `chanrecv` Walkthrough](#receive-path-chanrecv-walkthrough)
5. [Sudog Queues and Goroutine Parking](#sudog-queues-and-goroutine-parking)
6. [Close Semantics in the Runtime](#close-semantics-in-the-runtime)
7. [Memory Model in Runtime Terms](#memory-model-in-runtime-terms)
8. [Locking and Lock Contention](#locking-and-lock-contention)
9. [Performance Characteristics](#performance-characteristics)
10. [GC and Channel Lifetime](#gc-and-channel-lifetime)
11. [Race Detector Internals](#race-detector-internals)
12. [Why You Cannot Beat the Runtime](#why-you-cannot-beat-the-runtime)
13. [Putting It All Together](#putting-it-all-together)
14. [Summary](#summary)

---

## Internals Overview

Channels in Go are not language primitives in the sense of "compiler-special" — they are runtime objects allocated on the heap with a public-but-unexported struct named `hchan`, and accessed through a small set of runtime functions: `runtime.makechan`, `runtime.chansend`, `runtime.chanrecv`, `runtime.closechan`. The compiler lowers `ch <- v`, `<-ch`, `close(ch)`, `len(ch)`, `cap(ch)` to calls into these functions (with a few fast-path inlinings).

At runtime, every channel is one of three flavours:

| Flavour | Storage | Behaviour |
|---------|---------|-----------|
| Unbuffered | no ring buffer | every send/receive parks until partner |
| Buffered | a ring buffer of `cap` slots | sends/receives bypass parking when buffer has room/values |
| Nil | the variable holds a nil pointer | every operation parks forever |

The fast path through a buffered channel is just: take the lock, write into the ring buffer, advance index, release the lock. The slow path — when the operation cannot complete immediately — parks the goroutine on a queue inside the channel and is unparked later by a partner.

---

## The `hchan` Struct

Inside `runtime/chan.go` (Go 1.22+, with minor changes between versions), the channel type looks like this (simplified):

```go
type hchan struct {
    qcount   uint           // total data in the queue
    dataqsiz uint           // size of the circular queue (cap)
    buf      unsafe.Pointer // points to an array of dataqsiz elements
    elemsize uint16
    closed   uint32
    timer    *timer         // (since Go 1.23) for select-with-timeout
    elemtype *_type
    sendx    uint           // send index
    recvx    uint           // receive index
    recvq    waitq          // list of recv waiters
    sendq    waitq          // list of send waiters

    lock mutex               // protects all fields
}

type waitq struct {
    first *sudog
    last  *sudog
}
```

Key things to notice:

- **One mutex protects everything.** No fancy lock-free queue. The runtime authors measured carefully and concluded that one well-tuned spin-then-park mutex is faster than a CAS-based lockless ring for the access patterns Go programs actually have.
- **Buffer is a ring with `sendx` and `recvx` indices**, so push/pop are O(1).
- **`recvq` and `sendq` are FIFO lists of parked goroutines** (`sudog` = "synchronisation user data, goroutine"). They are doubly linked, but conceptually a queue.
- **`closed` is a single uint32 flag**, set under the lock by `closechan`.
- **`buf` is a pointer to a flat slice** of `dataqsiz × elemsize` bytes. The garbage collector knows to scan it as the right type via `elemtype`.

For an *unbuffered* channel, `dataqsiz == 0` and `buf` is nil. The path through `chansend`/`chanrecv` then *only* uses the wait queues; nothing goes into a ring.

---

## Send Path: `chansend` Walkthrough

In simplified pseudocode the send path looks like this:

```go
func chansend(c *hchan, ep unsafe.Pointer, block bool) bool {
    if c == nil {
        if !block { return false }
        gopark(forever)        // nil channel: park forever
    }

    lock(&c.lock)

    if c.closed != 0 {
        unlock(&c.lock)
        panic("send on closed channel")
    }

    // 1. Is there a parked receiver to hand off to directly?
    if sg := c.recvq.dequeue(); sg != nil {
        send(c, sg, ep) // copies value into receiver, wakes receiver
        unlock(&c.lock)
        return true
    }

    // 2. Buffered: is there room in the ring?
    if c.qcount < c.dataqsiz {
        qp := chanbuf(c, c.sendx)
        typedmemmove(c.elemtype, qp, ep)
        c.sendx++
        if c.sendx == c.dataqsiz { c.sendx = 0 }
        c.qcount++
        unlock(&c.lock)
        return true
    }

    // 3. No receiver, no room: park.
    if !block {
        unlock(&c.lock)
        return false
    }
    gp := getg()
    mysg := acquireSudog()
    mysg.elem = ep
    mysg.g    = gp
    c.sendq.enqueue(mysg)
    goparkunlock(&c.lock, "chan send", ...)

    // wakeup happens here when receiver dequeues us.
    releaseSudog(mysg)
    return true
}
```

Critical steps explained:

1. **Direct hand-off**: if a receiver is already parked (case 1), the runtime *copies the value directly from the sender's stack frame into the receiver's variable* and wakes the receiver. **No buffer is touched.** This is the main reason unbuffered channels do not have memory cost beyond the `hchan` itself: the value never sits in the channel.

2. **Ring buffer write**: only if no receiver is waiting *and* the ring has room. This is the "fast async" path of buffered channels.

3. **Park**: if neither, the sender allocates a `sudog`, hooks itself into `c.sendq`, and yields the OS thread back to the scheduler.

The `block` parameter is `false` for the send case of `select` with `default` and for non-blocking probes; `true` for plain `ch <- v`.

The same lock guards everything: the receiver queue check, the buffer, and the parking — so no races inside the channel itself.

### Why direct hand-off matters

Consider:

```go
ch := make(chan Big, 0)   // unbuffered
ch <- big                 // sender blocks
v := <-ch                 // receiver wakes
```

If hand-off went through a buffer, `big` would be copied twice: sender-to-buffer, buffer-to-receiver. Direct hand-off copies once: sender-stack-to-receiver-stack. For large `T` this is a real win.

For *buffered* channels with a parked receiver, the runtime *also* uses the direct path — it skips the buffer entirely when a receiver is already waiting. That is why `cap(ch)` is largely a fast-path optimisation for cases where producer outpaces consumer; whenever consumer is "waiting for me," the buffer is irrelevant.

---

## Receive Path: `chanrecv` Walkthrough

Symmetric to send:

```go
func chanrecv(c *hchan, ep unsafe.Pointer, block bool) (selected, received bool) {
    if c == nil {
        if !block { return false, false }
        gopark(forever)
    }

    lock(&c.lock)

    if c.closed != 0 && c.qcount == 0 {
        unlock(&c.lock)
        if ep != nil { typedmemclr(c.elemtype, ep) } // zero the destination
        return true, false                            // ok = false
    }

    // 1. A parked sender ready to hand off?
    if sg := c.sendq.dequeue(); sg != nil {
        recv(c, sg, ep)         // copies sg.elem to ep; wakes sender
        unlock(&c.lock)
        return true, true
    }

    // 2. Buffer has data?
    if c.qcount > 0 {
        qp := chanbuf(c, c.recvx)
        if ep != nil { typedmemmove(c.elemtype, ep, qp) }
        typedmemclr(c.elemtype, qp)
        c.recvx++
        if c.recvx == c.dataqsiz { c.recvx = 0 }
        c.qcount--
        unlock(&c.lock)
        return true, true
    }

    // 3. Nothing to do: park.
    if !block { unlock(&c.lock); return false, false }
    gp := getg()
    mysg := acquireSudog()
    mysg.elem = ep
    mysg.g    = gp
    c.recvq.enqueue(mysg)
    goparkunlock(&c.lock, "chan receive", ...)

    return true, mysg.success
}
```

Two subtleties:

- **Closed-and-drained returns the zero value with `ok == false`.** The runtime explicitly zeroes the destination via `typedmemclr` so even pointer-typed channels do not leak old contents.
- **In the buffered case, after copying to the receiver, the slot is cleared.** This is for GC: if the slot held a pointer, leaving it would keep the referent alive. Clearing turns it into the zero value of the type.

When there is a parked sender plus a non-empty buffer (e.g. cap 3, all full, sender parked waiting), the runtime takes the *oldest* buffer slot first, then dequeues the parked sender's value into a now-vacated slot. This preserves FIFO order across the queue + buffer combination.

---

## Sudog Queues and Goroutine Parking

`sudog` (synchronisation user data + goroutine) is the per-park record. When a goroutine parks on a channel, it acquires a sudog from a per-P pool, fills in `g`, `elem`, `success`, and links into the relevant queue. When the partner arrives, it pulls the sudog off the queue, copies the value, sets `success`, and calls `goready` to wake the goroutine. The woken goroutine returns from `gopark`, releases the sudog, and continues.

Cost breakdown for a parked send-receive pair:

- 1 sudog allocation (usually pool-hit, so amortised free).
- 1 goroutine park: scheduler costs to remove from runqueue, save state.
- 1 goroutine wakeup: scheduler costs to enqueue on a P, possibly steal-target.
- 1 mutex acquisition each side.
- 1 typed memmove of `elemsize` bytes.

Total: a few hundred nanoseconds for typical sizes. The dominant cost is the scheduler interactions, not the mutex or memcpy. That is why, when you saturate a channel with millions of operations per second, you start seeing the scheduler in the profile.

---

## Close Semantics in the Runtime

```go
func closechan(c *hchan) {
    if c == nil          { panic("close of nil channel") }
    lock(&c.lock)
    if c.closed != 0 {
        unlock(&c.lock)
        panic("close of closed channel")
    }
    c.closed = 1

    // Release every parked receiver.
    for sg := c.recvq.dequeue(); sg != nil; sg = c.recvq.dequeue() {
        if sg.elem != nil {
            typedmemclr(c.elemtype, sg.elem) // zero their destination
            sg.elem = nil
        }
        sg.success = false
        goready(sg.g, 3)
    }
    // Release every parked sender — they will panic when they wake.
    for sg := c.sendq.dequeue(); sg != nil; sg = c.sendq.dequeue() {
        sg.elem = nil
        sg.success = false
        goready(sg.g, 3)
    }
    unlock(&c.lock)
}
```

Notice three subtleties:

- **All waiters are released**, in two FIFO sweeps.
- **Parked senders wake up and *then* check the closed flag**, panicking on send-on-closed. So closing while senders are waiting does cause panics; you cannot use close to "cancel pending sends."
- **The buffer is left intact**. Receivers can drain it after close.

The cost of close is `O(receivers + senders parked)`. For a typical small program, that is a single-digit number; for a broadcast cancel with thousands of listeners it is still microseconds total.

---

## Memory Model in Runtime Terms

The Go memory model's channel guarantees are implemented via the lock plus the explicit ordering of operations inside `chansend`/`chanrecv`. Because every send and every receive acquires `c.lock`, there is a clear *acquire-release* relationship between any send and the receive that pairs with it.

For programmers, what this means:

- Every operation on the *same* channel is totally ordered.
- Operations on *different* channels are not synchronised with each other unless you do so explicitly.
- The lock release/acquire pair gives you the needed memory fence on architectures that need it (ARM, etc.); on x86, the lock op already does.

Direct hand-off (no buffer) still goes through the lock, so the visibility guarantees hold.

---

## Locking and Lock Contention

The single lock per channel is a deliberate trade-off:

- For small contention, a mutex with spin then park is cheaper than maintaining a lock-free invariant for a multi-field structure.
- For very high contention on one channel — say, 16 goroutines hammering one buffered channel — the lock becomes the bottleneck.

If you are profiling and see `runtime.lock2` near a channel, the typical fixes are:

- **Shard.** Use multiple channels and round-robin across them.
- **Coalesce sends.** Send a batch (a slice) per channel op, instead of one item per op.
- **Move to atomics or per-P storage.** A channel might be the wrong primitive at that contention level.

`go tool pprof -mutex` shows mutex contention; channels appear there, and the fix is structural.

---

## Performance Characteristics

Concrete benchmarks (Go 1.22, AMD Zen 4, single thread, no contention):

| Operation | Time | Notes |
|-----------|------|-------|
| `make(chan int)` | ~120 ns | hchan only |
| `make(chan int, 16)` | ~140 ns | hchan + buffer alloc |
| Buffered send (room, no waiter) | ~30 ns | one lock + memmove |
| Buffered receive (data, no waiter) | ~30 ns | one lock + memmove |
| Unbuffered send + receive (parked) | ~250–400 ns | two parks + two mem moves |
| Closed empty receive | ~20 ns | lock + flag check |

Conclusion: a buffered fast-path channel is roughly twice the cost of a mutex. An unbuffered hand-off costs roughly 5–10× a mutex. None of this is bad; it is the price of synchronisation. But if you want to send 50 M items/sec across one channel, you will not get there.

---

## GC and Channel Lifetime

A channel is a heap object. It stays alive as long as *any* goroutine still holds a reference (either via a variable or via a parked sudog inside its queues). When the last reference dies, the channel becomes garbage.

Two practical consequences:

1. **A leaked goroutine that is parked on a channel keeps the channel alive.** That keeps the buffer alive and any pointer-typed values inside the buffer live. Goroutine leaks beget memory leaks beget GC pressure.

2. **Unclosed channels do not leak by themselves.** A channel with no live references is collectable whether closed or not. You close for receiver-side semantics (`range` ends, `ok=false`), not for memory hygiene.

If you are debugging memory growth and see channel buffers in the heap profile, look at the goroutine profile next: there is almost always a leaked listener or a leaked producer.

---

## Race Detector Internals

The race detector (TSAN, `go test -race`) treats channel operations as synchronisation events. Each successful send-receive pair is a synchronisation arc that orders the writes on the sender side before the reads on the receiver side. As a result, *any* race that the memory model would report as undefined behaviour is detected if it slips through your channel discipline.

A common false-positive-looking case: shared state guarded *only* by an unbuffered channel signal. The race detector accepts it because the channel arc gives the proper ordering. If you accidentally make the channel buffered, the same code is suddenly racy *if* you read the shared state immediately after the buffered send (because the receiver may not have run yet) — and the race detector will catch it.

Race-detect builds your code with bigger sudogs and more bookkeeping, so they run perhaps 2–4× slower. It is a CI tool, not a production tool.

---

## Why You Cannot Beat the Runtime

Engineers occasionally try to roll their own ring-buffer-with-CAS in pure Go to "avoid the lock." Almost always, this loses to the runtime channel for these reasons:

- The runtime hand-off path bypasses the buffer entirely when a receiver is parked. A naive ring always touches the buffer.
- The runtime lock has been tuned over years (spin counts, futex backoff). Hand-rolled equivalents typically use simple `sync.Mutex` or atomics with worse profiles.
- Channels integrate with the goroutine scheduler. A custom queue still has to park/wake goroutines somehow, and the obvious tools (`sync.Cond`, channels, sleeping) are either slower or violate fairness.

Where a custom design *can* win:

- Single-producer single-consumer (SPSC) ring with strong assumptions, where you do not need parking and can spin briefly. Microsecond-latency systems have used this.
- Per-P sharded queues where the dominant work item is "thread-local + occasional steal."

Both are specialised. For 95% of code, the language-provided channel is the fastest *and* simplest answer.

---

## Putting It All Together

A senior engineer who internalises the runtime model writes channel code that:

- Avoids contention by sharding or batching when profiles show the lock.
- Uses unbuffered channels for "I want a clean handshake" because they are cheaper *for the common case of a partner ready*.
- Uses buffered channels for "I tolerate slack" because the fast path is exactly the buffer write.
- Treats the buffer as an *optimisation*, not as state. Logic should not depend on whether values sit in the buffer.
- Reasons about memory model guarantees by visualising the lock acquire/release at each end of a send-receive pair.
- Treats `close` as a costly broadcast, not a per-value operation.
- Knows when to *not* use a channel — counters, shared maps, or per-P caches.

---

## Summary

Channels in Go are heap-allocated `hchan` structs guarded by a single mutex. Sends and receives go through `runtime.chansend` and `runtime.chanrecv`, which try three paths in order: direct hand-off to a parked partner, buffer slot manipulation, and parking. The direct hand-off skips the buffer entirely, which is why unbuffered channels carry no per-message memory cost. Close releases every parked receiver and sender (the latter wake to panic). The race detector treats each send-receive pair as a synchronisation arc. The single lock is the common bottleneck under high contention; the fix is sharding or batching, not lock-free heroics. Understanding these mechanics is what lets you reason about the second-order effects — GC, scheduler, profiler output — that distinguish a senior practitioner from a professional.
