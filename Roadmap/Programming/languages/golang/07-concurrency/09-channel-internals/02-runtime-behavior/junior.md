# Channel Runtime Behaviour — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros--cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use--feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Common Misconceptions](#common-misconceptions)
20. [Tricky Points](#tricky-points)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

When you write `ch <- 42` in Go, that one line of source compiles down to a runtime call: `runtime.chansend1(ch, &v)`. Inside the runtime there is a function — `chansend` — that does roughly nine things in a fixed order: it locks the channel, checks if the channel is closed, looks for a parked receiver, copies into the buffer if there is room, otherwise parks the sender. Receive is the mirror image, and `close` is a third function that wakes everybody.

This document opens the curtain on those three runtime functions and explains, at a junior level, what each step does and why. You do not need to memorise the source code. You do need a mental model that says "every channel op locks the channel first" and "a send sometimes copies directly to a waiting receiver without ever touching the buffer." Once you have that, the runtime stops being magic and every blocking, panic, or unexpected ordering you ever see makes sense.

We will use the actual function names from `runtime/chan.go` (Go 1.22), but we will stay at the level of pseudocode. The deeper internals — the `sudog` allocator, the `gopark` primitive, the lock ordering inside `selectgo` — are covered in the middle, senior, and professional pages.

---

## Prerequisites

You should already be comfortable with:

- Sending and receiving on a channel: `ch <- v`, `v := <-ch`, `v, ok := <-ch`.
- The difference between unbuffered (`make(chan T)`) and buffered (`make(chan T, N)`) channels.
- What it means for a goroutine to block.
- The basic idea of `close(ch)`: it signals "no more values will be sent."
- The `select` statement and its `default` clause.

If any of those are shaky, read `02-channels/01-buffered-vs-unbuffered` and `02-channels/02-select-statement` first.

You do not need any prior knowledge of the Go runtime, of `hchan`, of `sudog`, of `gopark`, or of the scheduler. Those are introduced here.

---

## Glossary

| Term | Meaning |
|---|---|
| `hchan` | The runtime struct that backs every channel. Contains the buffer, the lock, and the wait queues. |
| `chansend` | Runtime function that implements every send. |
| `chanrecv` | Runtime function that implements every receive. |
| `closechan` | Runtime function that implements `close(ch)`. |
| `selectgo` | Runtime function that implements `select`. |
| Direct hand-off | Optimisation where a send copies straight from the sender's stack to the receiver's stack, skipping the buffer. |
| `recvq` | Wait queue of receivers parked on this channel. |
| `sendq` | Wait queue of senders parked on this channel. |
| `sudog` | A small struct (Go's "sudo-G") that represents a parked goroutine waiting on a channel or other primitive. |
| `gopark` | Runtime primitive that puts the current goroutine to sleep. |
| `goready` | Runtime primitive that wakes a parked goroutine. |
| Buffer | The ring of slots inside a buffered channel. |
| `sendx` / `recvx` | Indices into the ring buffer. |
| `qcount` | Number of elements currently in the buffer. |
| `dataqsiz` | Capacity of the buffer. |
| Parked | Goroutine status `_Gwaiting`; not eligible to run. |
| Runnable | Goroutine status `_Grunnable`; eligible for a scheduler to pick up. |
| Spin-mutex | A short-spin lock the runtime uses for `hchan.lock`. |

---

## Core Concepts

### The three runtime functions

Almost every channel operation goes through one of three functions:

| Source line | Runtime function | Lives in |
|---|---|---|
| `ch <- v` | `chansend` | `runtime/chan.go` |
| `v, ok := <-ch` | `chanrecv` | `runtime/chan.go` |
| `close(ch)` | `closechan` | `runtime/chan.go` |
| `select { ... }` | `selectgo` | `runtime/select.go` |

`select` is a special case that calls into helpers shared with `chansend`/`chanrecv`. We will treat it separately.

### `chansend` pseudocode

This is what `chansend` does, paraphrased from `runtime/chan.go`:

```go
// chansend implements `c <- ep`. block=true if the caller wants to block,
// false for the select-default fast path. Returns true if the value was sent.
func chansend(c *hchan, ep unsafe.Pointer, block bool, callerpc uintptr) bool {
    // 1. Nil channel: block forever (or fall through if non-blocking).
    if c == nil {
        if !block {
            return false
        }
        gopark(nil, nil, waitReasonChanSendNilChan, traceBlockForever, 2)
        throw("unreachable")
    }

    // 2. Fast non-blocking check: if neither the buffer has room nor a
    //    receiver is waiting, return false without locking.
    if !block && c.closed == 0 && full(c) {
        return false
    }

    // 3. Lock the channel.
    lock(&c.lock)

    // 4. Closed? Panic.
    if c.closed != 0 {
        unlock(&c.lock)
        panic(plainError("send on closed channel"))
    }

    // 5. Is a receiver waiting in recvq? Hand the value over directly.
    if sg := c.recvq.dequeue(); sg != nil {
        send(c, sg, ep, func() { unlock(&c.lock) }, 3)
        return true
    }

    // 6. Buffer has room? Copy into the ring, advance sendx.
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

    // 7. No room and the caller is non-blocking: bail.
    if !block {
        unlock(&c.lock)
        return false
    }

    // 8. Otherwise, park ourselves on sendq.
    gp := getg()
    mysg := acquireSudog()
    mysg.elem = ep
    mysg.g = gp
    mysg.c = c
    gp.waiting = mysg
    c.sendq.enqueue(mysg)

    gopark(chanparkcommit, unsafe.Pointer(&c.lock), waitReasonChanSend, traceBlockChanSend, 2)

    // 9. Woken up: the receiver already copied our value. Clean up.
    releaseSudog(mysg)
    return true
}
```

Read it twice. The numbered comments map to the bullet list in the task brief:

1. Lock the channel — step 3.
2. Closed → panic — step 4.
3. Receiver parked → direct hand-off — step 5.
4. Buffer has room → copy, increment `sendx` — step 6.
5. Otherwise park — step 8.

The non-blocking branches (steps 2, 7) exist because `select` may call `chansend` with `block=false` to implement a `case ch <- v:` arm with a `default`.

### `chanrecv` pseudocode

The mirror image:

```go
func chanrecv(c *hchan, ep unsafe.Pointer, block bool) (selected, received bool) {
    if c == nil {
        if !block {
            return false, false
        }
        gopark(nil, nil, waitReasonChanReceiveNilChan, traceBlockForever, 2)
    }

    // Non-blocking fast path
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

    lock(&c.lock)

    // 1. Channel closed and buffer empty: return zero value, ok=false.
    if c.closed != 0 && c.qcount == 0 {
        unlock(&c.lock)
        if ep != nil {
            typedmemclr(c.elemtype, ep)
        }
        return true, false
    }

    // 2. Sender parked in sendq? Two sub-cases.
    if sg := c.sendq.dequeue(); sg != nil {
        recv(c, sg, ep, func() { unlock(&c.lock) }, 3)
        return true, true
    }

    // 3. Buffer has data? Copy out, advance recvx.
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

    // 4. Park on recvq.
    gp := getg()
    mysg := acquireSudog()
    mysg.elem = ep
    mysg.g = gp
    mysg.c = c
    gp.waiting = mysg
    c.recvq.enqueue(mysg)
    gopark(chanparkcommit, unsafe.Pointer(&c.lock), waitReasonChanReceive, traceBlockChanRecv, 2)

    // Woken: the sender already wrote our value (direct hand-off) or the
    // channel was closed.
    closed := mysg.success
    releaseSudog(mysg)
    return true, closed
}
```

Two important sub-cases inside step 2 (sender parked):

- If the channel is unbuffered, the sender's value is copied directly into our `ep` (direct hand-off).
- If the channel is buffered and full, we take the value from the front of the ring buffer, and the parked sender's value is copied into the slot we just freed (so the buffer stays full while we drain it).

### `closechan` pseudocode

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

    // Drain recvq: every waiting receiver gets the zero value and ok=false.
    var glist gList
    for {
        sg := c.recvq.dequeue()
        if sg == nil {
            break
        }
        if sg.elem != nil {
            typedmemclr(c.elemtype, sg.elem)
            sg.elem = nil
        }
        sg.success = false
        gp := sg.g
        gp.param = unsafe.Pointer(sg)
        glist.push(gp)
    }

    // Drain sendq: every waiting sender will panic when it wakes up.
    for {
        sg := c.sendq.dequeue()
        if sg == nil {
            break
        }
        sg.elem = nil
        sg.success = false
        gp := sg.g
        gp.param = unsafe.Pointer(sg)
        glist.push(gp)
    }
    unlock(&c.lock)

    // Wake everyone.
    for !glist.empty() {
        gp := glist.pop()
        goready(gp, 3)
    }
}
```

Two takeaways:

1. Closing a channel does not throw away buffered data. Receivers can still drain the buffer; only when both `c.closed == 1` and `c.qcount == 0` does receive return `ok=false`.
2. After `close`, every parked sender will panic on its next instruction. The wake-up itself is silent; the panic comes from the sender code path that re-checks `c.closed` after waking.

### Direct hand-off: the key optimisation

Imagine an unbuffered channel and two goroutines:

```
G1: ch <- 5
G2: v := <-ch
```

If G2 runs first, it parks on `recvq`. When G1 sends, the runtime takes G2's `sudog` out of `recvq` and copies the value `5` *directly into the address G2 was about to read from*. The buffer is never touched (and unbuffered channels have no buffer to begin with). G2 is woken with the value already in place.

The same happens for buffered channels when a receiver is parked: even if the buffer has room, the sender hands off directly. This is a latency win — you skip two buffer copies and never re-acquire the channel lock for the receiver to drain.

### Parking and waking: `gopark` / `goready`

`gopark(commit, lock, reason, traceEv, traceSkip int)`:

- Sets the current goroutine's status to `_Gwaiting`.
- Calls `commit` (a callback that typically releases the lock just before yielding).
- Yields the M (OS thread) to the scheduler so it can run other goroutines.
- The goroutine will stay parked until somebody calls `goready` on it.

`goready(gp, traceSkip int)`:

- Sets `gp`'s status from `_Gwaiting` to `_Grunnable`.
- Places `gp` on the local runqueue of the current P, or the global runqueue if local is full.
- Returns; the parked goroutine will run when the scheduler picks it.

`chansend` calls `gopark` after enqueueing the `sudog`. The matching `chanrecv` calls `goready` on the sender's goroutine after copying the value.

### `selectgo`: multi-channel readiness

`select` is *not* implemented by calling `chansend`/`chanrecv` in a loop with non-blocking flags. That would race: a case could become ready between two checks, and you would lose it.

Instead, `runtime.selectgo` does this:

1. Build an array of `scase` structs, one per case.
2. Shuffle the array with a pseudo-random Fisher-Yates pass. This randomises which case is checked first when multiple are ready.
3. Sort case indices by the address of each channel's `hchan` so locks are always acquired in the same global order — this prevents two `select`s from deadlocking against each other.
4. Acquire all the channel locks.
5. Loop through the (already-shuffled) cases. As soon as one is ready (receiver waiting, sender waiting, or buffer state matches), perform the operation, release all locks, return the case index.
6. If none is ready and there is a `default` case, release all locks and take `default`.
7. Otherwise, enqueue a `sudog` for *each* channel involved, then `gopark`. When one channel wakes us, we get the index of the case that fired.
8. On wake-up, walk the other channels and dequeue our sudog from each (otherwise they would carry a dead pointer).

The pseudo-random shuffle is what gives `select` its no-starvation property. The lock-order trick is what keeps two simultaneous `select`s from deadlocking.

### The wait queues

`recvq` and `sendq` are doubly-linked FIFO queues of `sudog` nodes. `enqueue` appends to the tail; `dequeue` removes the head. Combined with the FIFO property, this means: under contention, parked receivers and senders are served in the order they arrived.

But: the fast paths (direct hand-off, buffer slot available, fast-path CAS) can let a *new* arriving goroutine snatch the lock or the slot before the queued waiters wake up. This is the same "barging" model as `sync.Mutex` normal mode. Channels do not have a "starvation mode" — the FIFO of the wait queue plus the very short critical section is considered enough.

### Memory model: send/receive establishes happens-before

The Go Memory Model formally says: a send on a channel is synchronised before the corresponding receive completes. In runtime terms: every write that happened in the sender goroutine before the `chansend` call is visible to the receiver after `chanrecv` returns.

The mechanism is the `hchan.lock` itself. Both `chansend` and `chanrecv` acquire and release the same `runtime.mutex`. A mutex release happens-before the next acquire, and lock/unlock impose memory barriers on the hardware. That is sufficient: the receiver's load of the value is ordered after the sender's stores.

Direct hand-off uses the same mechanism. The sender copies the data into the receiver's `ep` while holding `c.lock`. The receiver then unlocks (via `chanparkcommit`) and reads. The lock release pairs with the eventual `unlock` issued by the sender.

---

## Real-World Analogies

**Restaurant pickup window.** The channel is the window. Cooks (senders) put plates through; waiters (receivers) take them. If the window has room (buffered), cooks can leave plates and walk away. If it is full, cooks stand and wait. If a waiter is already standing at the window waiting for the next plate, the cook can hand the plate directly to the waiter and the plate never touches the shelf — that is direct hand-off.

**Bank teller.** `closechan` is the manager flipping the "closed" sign. Existing customers in the queue are still served (buffered data drains), but any new customer trying to deposit money is shown the door (send on closed → panic). Customers who were standing at the deposit window get a refund and leave with empty hands (parked senders wake to panic).

**Locking the cash register first.** Both `chansend` and `chanrecv` lock the channel first. Just like a bank teller would not let a customer reach into the register without locking it, the runtime serialises all access to the buffer and queues through `c.lock`.

---

## Mental Models

1. **Every operation locks.** There is no lock-free fast path inside `chansend` or `chanrecv` for the contended case. The lock is short, but it exists.

2. **Direct hand-off is the common case for unbuffered.** If two goroutines rendezvous, the buffer (which is empty anyway) is bypassed. Latency: ~50-200 ns.

3. **Buffered hot path is two atomic-like operations.** Lock, copy, increment, unlock. ~30-50 ns when uncontended.

4. **Park is expensive.** Once a goroutine has to `gopark`, you pay the cost of context switch and re-scheduling: hundreds of nanoseconds to a few microseconds.

5. **Close is a fan-out wake.** A single `close` can wake dozens of receivers. The wake happens with the lock held (sort of) — actually, the goroutines are collected onto a list while locked, then `goready` is called for each after unlocking, to avoid running user code under the channel lock.

---

## Pros & Cons

### Pros

- The runtime functions are short and well-documented. You can read all three in an afternoon.
- The lock-then-decide design makes the semantics easy to reason about: no race between "is there a receiver?" and "do I take the receiver?".
- Direct hand-off makes channel rendezvous competitive with mutex/condvar patterns despite being a higher-level primitive.

### Cons

- Every operation acquires a mutex. For very high-throughput single-producer/single-consumer pipes, this is slower than a lock-free ring buffer.
- Parking and waking cost significantly more than a simple atomic compare-and-swap. Channels are not the right tool for sub-microsecond signalling.
- The semantics of `nil` channels (block forever) and `closed` channels (panic on send, return zero on receive) are surprising to readers who do not know them.

---

## Use Cases

This page is about understanding behaviour, not picking a tool. Specific channel design choices are in `02-channels/01-buffered-vs-unbuffered`. Read this page when:

- You see a goroutine parked on `runtime.chanrecv` or `runtime.chansend` in a profile and want to know what it is doing.
- You hit a "send on closed channel" panic and want to understand exactly why.
- You are optimising a hot path and need to know what the runtime overhead actually is.
- You are debugging a `select` that seems to starve one case (it should not — but bias is possible at the application layer).

---

## Code Examples

### Example 1: Tracing send/receive in a unit test

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    ch := make(chan int, 2)
    var wg sync.WaitGroup
    wg.Add(2)

    go func() {
        defer wg.Done()
        ch <- 1 // step: buffer has room (qcount=0, dataqsiz=2) → copy, sendx=1, qcount=1
        ch <- 2 // step: buffer has room (qcount=1) → copy, sendx=0 (wraps), qcount=2
        ch <- 3 // step: buffer full → park on sendq → woken when receiver consumes one
        close(ch)
    }()

    go func() {
        defer wg.Done()
        for v := range ch {
            // step: each iter calls chanrecv. If qcount > 0 → drain ring buffer.
            //       If sendq has a waiter → take buffered + transfer parked value.
            fmt.Println(v)
        }
    }()

    wg.Wait()
}
```

### Example 2: Direct hand-off in action (unbuffered)

```go
package main

import (
    "sync"
    "time"
)

func main() {
    ch := make(chan int) // unbuffered
    var wg sync.WaitGroup
    wg.Add(2)

    go func() {
        defer wg.Done()
        time.Sleep(50 * time.Millisecond) // ensure receiver parks first
        ch <- 7
        // Inside chansend: c.recvq has one parked goroutine.
        // Direct hand-off path: copy 7 into the receiver's stack frame,
        // call goready on the receiver. We never touch the (empty) buffer.
    }()

    go func() {
        defer wg.Done()
        <-ch
        // Inside chanrecv: c.qcount == 0, c.sendq is empty.
        // Park: gopark. Woken by sender's direct hand-off.
    }()

    wg.Wait()
}
```

### Example 3: Close drains receivers

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    ch := make(chan int)
    var wg sync.WaitGroup
    for i := 0; i < 3; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            v, ok := <-ch
            fmt.Printf("recv %d: v=%d ok=%v\n", id, v, ok)
        }(i)
    }

    // Wait briefly so all three goroutines park on c.recvq.
    // closechan drains recvq, wakes all three with zero value, ok=false.
    close(ch)
    wg.Wait()
}
```

Expected output: each goroutine prints `v=0 ok=false`.

### Example 4: Send on closed channel

```go
package main

func main() {
    ch := make(chan int, 1)
    close(ch)
    ch <- 1 // panic: send on closed channel
}
```

Inside `chansend`: step 3 takes the lock, step 4 sees `c.closed != 0`, panics. No data is sent.

### Example 5: select chooses pseudo-randomly

```go
package main

import "fmt"

func main() {
    a := make(chan int, 1)
    b := make(chan int, 1)
    a <- 1
    b <- 2

    select {
    case v := <-a:
        fmt.Println("a", v)
    case v := <-b:
        fmt.Println("b", v)
    }
    // Run this multiple times: you will see "a 1" and "b 2" each about half the time.
    // selectgo shuffled the case order before checking readiness.
}
```

### Example 6: Non-blocking send via select default

```go
package main

import "fmt"

func main() {
    ch := make(chan int, 1)
    ch <- 1

    select {
    case ch <- 2:
        fmt.Println("sent")
    default:
        fmt.Println("buffer full") // this branch
    }
    // selectgo: chansend called with block=false → returns false on full buffer.
}
```

---

## Coding Patterns

### Detect channel closure

```go
for {
    v, ok := <-ch
    if !ok {
        // chanrecv returned (true, false): channel closed, buffer drained.
        return
    }
    process(v)
}
```

### Wake-on-close signal

```go
done := make(chan struct{})

go worker(done)

// To stop:
close(done) // wakes worker's <-done with ok=false
```

### Non-blocking send

```go
select {
case ch <- v:
default:
    // dropped
}
```

### Coordinated startup (rendezvous)

```go
ready := make(chan struct{})
go func() {
    initialise()
    close(ready)
}()
<-ready // waits until close fires
```

---

## Clean Code

- Comment why a channel is buffered or unbuffered. The runtime behaviour is different enough that future readers need a hint.
- Use `chan struct{}` for signal-only channels. The zero-byte element type means the runtime allocates a smaller buffer and the typedmemmove path is faster.
- Always document who closes the channel. Send-on-closed panics come from breaking this convention.

---

## Product Use / Feature

Real product code uses channel behaviour for:

- **Rate-limiting**: a buffered channel with capacity N caps the number of in-flight requests. The runtime parks producers when full.
- **Graceful shutdown**: closing a "done" channel fans out the wake-up to every goroutine listening, via `closechan` draining `recvq`.
- **Result fan-in**: many producers send into one buffered channel; one consumer drains. Each producer goes through `chansend` and may park if the consumer is slow.
- **Worker pool dispatch**: jobs go through `chansend`. Workers `chanrecv`. Direct hand-off dominates the latency when workers are idle.

You do not pick channels because the runtime is fast. You pick them because the semantics are easy and the cost is acceptable. Knowing the runtime helps you decide when "acceptable" stops being true.

---

## Error Handling

There are exactly three runtime-issued panics from channel operations:

| Panic message | Triggered by | Where |
|---|---|---|
| `send on closed channel` | `chansend` after seeing `c.closed != 0` | step 4 of `chansend` |
| `close of closed channel` | `closechan` seeing `c.closed != 0` | top of `closechan` |
| `close of nil channel` | `closechan` with `c == nil` | top of `closechan` |

Two other "soft" misuses do not panic but block forever:

- Send on a nil channel: parks on a nil mutex (`gopark(nil, nil, ..., traceBlockForever, 2)`).
- Receive on a nil channel: same.

A goroutine parked forever is a leak. The `pprof` `goroutine` profile is your friend.

---

## Security Considerations

Channels themselves are not a security boundary. They live inside one Go process; an attacker who can run code in your process can read or write them directly via `unsafe`.

But: misusing close-as-signal can introduce denial-of-service if untrusted input triggers a panic. Example: an HTTP handler that closes a shared `done` channel on receiving a particular request would crash the server if the channel was already closed (`close of closed channel` panic). Use `sync.Once` or atomic flags for idempotent close.

---

## Performance Tips

| Operation | Approximate cost |
|---|---|
| Buffered send/recv, uncontended, no park | 30–50 ns |
| Unbuffered send/recv, direct hand-off | 50–200 ns |
| Send/recv that parks | 1–5 μs (context switch) |
| `close(ch)` waking N receivers | O(N) + scheduling cost per wake |
| `select` with K cases, ready immediately | linear in K, plus K lock ops |
| `select` with K cases, blocks | linear in K (sudog per case) plus park |

Implications:

- A channel send-receive pair, when both goroutines stay on their P, is ~2x the cost of a mutex Lock/Unlock pair.
- Parking is hundreds of times more expensive than the lock fast path. Minimise contention.
- `select` cost grows linearly with case count.

---

## Best Practices

1. **Lock the channel once per operation, period.** Do not try to "peek" before send/receive. The runtime already handles the peek-and-act atomically; manual peeking races.

2. **Avoid `close` if multiple writers exist.** Use `sync.Once` to ensure idempotent close, or a separate "done" channel to signal end-of-input.

3. **Match `chan struct{}` for signals.** Less memory per element, faster typedmemmove path.

4. **Trust direct hand-off.** You do not need to add tiny buffers to make rendezvous "faster." An unbuffered channel between two ready goroutines is already optimal.

5. **Drain after close in `range`.** A `for v := range ch { ... }` loop both consumes buffered data and detects close — one idiom, both behaviours.

---

## Edge Cases & Pitfalls

### Sending to nil channel blocks forever

```go
var ch chan int // nil
ch <- 1 // gopark with no chance of wake-up
```

This is sometimes useful: a nil case in `select` is permanently dead, which lets you "disable" a case by setting its channel to nil.

### Receive from nil channel blocks forever

Same as above.

### Close of nil channel panics

```go
var ch chan int
close(ch) // panic: close of nil channel
```

### Close of already-closed channel panics

```go
ch := make(chan int)
close(ch)
close(ch) // panic: close of closed channel
```

### Receive on closed channel never blocks

```go
ch := make(chan int)
close(ch)
v, ok := <-ch // returns 0, false immediately
```

This is a feature: a closed channel is a permanently-ready select case.

### Buffered send after close panics, even with room

```go
ch := make(chan int, 10)
close(ch)
ch <- 1 // panic: send on closed channel
```

The closed flag is checked before the buffer space.

### Buffered receive after close drains then returns zero

```go
ch := make(chan int, 3)
ch <- 1; ch <- 2; ch <- 3
close(ch)
// Three successful receives, then closed semantics.
for v := range ch {
    fmt.Println(v) // 1, 2, 3
}
```

---

## Common Mistakes

1. **Closing a channel from the receiver side.** The convention is "the sender closes." Receiver-side close requires coordination to avoid send-on-closed panic from the senders.

2. **Closing a channel with multiple senders without coordination.** Same problem. Use `sync.Once`.

3. **Assuming `close` blocks until all data is drained.** It does not. `close` returns instantly; buffered data is still there for receivers to drain.

4. **Relying on `len(ch)` for synchronisation.** `len(ch)` returns `c.qcount` under a lock and is immediately stale. Do not branch on it.

5. **Treating channels as zero-cost.** They are cheap, but not free. A million sends per second is fine; a billion is not.

---

## Common Misconceptions

- "Channels are lock-free." False. The runtime uses a mutex inside `hchan`.
- "Buffered channels are always faster than unbuffered." False. Direct hand-off on unbuffered is two copies; buffered with a slow consumer is more copies and may park.
- "Close wakes receivers with no value." Half-true: the *zero value* is delivered, plus `ok=false`. Buffered data is delivered first.
- "Select picks the case in source order." False. `selectgo` shuffles cases.
- "`for v := range ch` exits when the channel is empty." False. It exits only when the channel is *closed and drained*.

---

## Tricky Points

- A `select` with only nil channels and no `default` parks forever, with no path to wake-up. The runtime recognises this and detects deadlock if it is the only running goroutine.
- `select` with `default` cases for both send and receive can spin a CPU. Add a `time.Sleep` or change design.
- `chanrecv` returns `(true, false)` for "closed channel, drained" and `(true, true)` for "got a value." `(false, false)` only happens in non-blocking mode (no value available, channel not closed).
- The sender-direct-handoff case in `chanrecv` also moves data through the ring buffer when the channel is full and buffered: the receiver takes the head of the buffer, and the parked sender's value is written into the now-empty slot. Net result: the buffer stays full while throughput continues.

---

## Test

```go
package chan_runtime_test

import (
    "testing"
    "time"
)

func TestClosedSendPanics(t *testing.T) {
    defer func() {
        if r := recover(); r == nil {
            t.Fatal("expected panic")
        }
    }()
    ch := make(chan int)
    close(ch)
    ch <- 1
}

func TestClosedRecvDrains(t *testing.T) {
    ch := make(chan int, 3)
    ch <- 1
    ch <- 2
    ch <- 3
    close(ch)
    sum := 0
    for v := range ch {
        sum += v
    }
    if sum != 6 {
        t.Fatalf("expected 6, got %d", sum)
    }
}

func TestNilSendBlocks(t *testing.T) {
    var ch chan int
    done := make(chan struct{})
    go func() {
        ch <- 1 // blocks forever
        close(done)
    }()
    select {
    case <-done:
        t.Fatal("nil send should not complete")
    case <-time.After(50 * time.Millisecond):
        // expected
    }
}

func TestDirectHandoff(t *testing.T) {
    ch := make(chan int)
    done := make(chan int)
    go func() {
        v := <-ch
        done <- v
    }()
    time.Sleep(10 * time.Millisecond) // let receiver park
    ch <- 42
    if v := <-done; v != 42 {
        t.Fatalf("expected 42, got %d", v)
    }
}
```

---

## Tricky Questions

**Q: A goroutine is parked on `runtime.chansend1`. What does that mean?**
A: The channel is full (or unbuffered with no receiver). The goroutine has been placed on `c.sendq` and is `_Gwaiting`.

**Q: Why does `close` not deliver an error to senders?**
A: The runtime cannot deliver a typed error through the channel — that would require allocating and changing the channel's element type. Instead, it panics. The convention is: do not close if other goroutines might still send.

**Q: What is the order in which select cases are tried?**
A: Pseudo-random. `selectgo` shuffles the cases with a Fisher-Yates pass seeded from the goroutine. This avoids starvation when multiple cases are perpetually ready.

**Q: How does `select` not deadlock against another `select`?**
A: Cases are sorted by channel pointer address before locks are acquired. All `select`s agree on the global order, so simultaneous selects on overlapping channel sets never circularly wait.

**Q: Is `<-ch` cheaper or more expensive than a mutex Lock/Unlock?**
A: An uncontended channel op is ~2x the cost of an uncontended mutex op. A parking channel op is ~10x.

---

## Cheat Sheet

```
chansend (`ch <- v`):
  1. lock c
  2. if closed → panic
  3. if recvq waiter → direct hand-off, unlock, return
  4. if buffer room → copy, sendx++, unlock, return
  5. if non-block → unlock, return false
  6. enqueue sudog on sendq → gopark

chanrecv (`v, ok := <-ch`):
  1. lock c
  2. if closed AND qcount==0 → unlock, zero v, return (true,false)
  3. if sendq waiter → direct hand-off, unlock, return (true,true)
  4. if qcount > 0 → copy, recvx++, unlock, return (true,true)
  5. if non-block → unlock, return (false,false)
  6. enqueue sudog on recvq → gopark

closechan:
  1. lock c
  2. if c==nil or closed → panic
  3. set closed=1
  4. dequeue all recvq and sendq into glist
  5. unlock
  6. for each gp in glist: goready

selectgo:
  shuffle → sort by addr → lock all → poll → act or park on every channel
```

---

## Self-Assessment Checklist

- [ ] I can recite the nine steps of `chansend` in order.
- [ ] I can explain why direct hand-off skips the buffer.
- [ ] I know which three runtime errors panic and which two simply block.
- [ ] I can explain why `select` cases are shuffled.
- [ ] I can explain why `select` does not deadlock with itself.
- [ ] I understand that `close` does not throw away buffered data.
- [ ] I can read a stack trace ending in `runtime.chanrecv` and tell whether the goroutine is parked.

---

## Summary

Three runtime functions implement every channel operation: `chansend`, `chanrecv`, `closechan`. A fourth, `selectgo`, coordinates multi-channel waits. Every operation locks the `hchan.lock` mutex, then dispatches based on closed flag, wait queues, and buffer state. Direct hand-off lets a sender and a parked receiver exchange a value without ever touching the buffer — this is the key latency optimisation. Closing a channel wakes every parked goroutine: receivers get the zero value and `ok=false`, senders wake to panic. The Go Memory Model's happens-before guarantee comes from the lock acquisitions on both sides of the channel op.

---

## What You Can Build

- A "leak detector" that polls `runtime.NumGoroutine` and dumps stacks when it grows; reading the stacks will teach you to recognise parked channel ops.
- A latency benchmark that compares `chan struct{}` ping-pong against `sync.Mutex` ping-pong.
- A toy scheduler that mirrors the `recvq`/`sendq` design with explicit park/unpark — implementing it pins the runtime ideas in your memory.

---

## Further Reading

- `runtime/chan.go` in the Go source. Read it top to bottom; ~800 lines.
- `runtime/select.go` for `selectgo`.
- "The Anatomy of Channels in Go," by Vincent Blanchon.
- Go Memory Model: <https://go.dev/ref/mem>.
- "How channels work in Go," by Daria Pakhomova, GoConf 2022.

---

## Related Topics

- `09-channel-internals/01-hchan-struct` — the data layout that this section operates on.
- `09-channel-internals/03-buffer-mechanics` — ring buffer mechanics in depth.
- `09-channel-internals/04-send-receive-flow` — full sequence diagrams of every flow.
- `07-concurrency/02-channels/02-select-statement` — user-level select.
- `07-concurrency/10-scheduler-deep-dive` — what `gopark`/`goready` do at the scheduler level.

---

## Diagrams & Visual Aids

### `chansend` decision tree

```
ch <- v
  |
  v
[lock c.lock]
  |
  +-- c.closed != 0? --> [unlock] --> panic("send on closed channel")
  |
  +-- c.recvq has waiter? --> [direct hand-off] --> [unlock] --> goready(waiter) --> return
  |
  +-- c.qcount < c.dataqsiz? --> [copy to buffer, sendx++] --> [unlock] --> return
  |
  +-- block == false? --> [unlock] --> return false
  |
  v
[enqueue sudog on sendq]
[gopark]
  ...
[wakeup: receiver already copied; release sudog; return]
```

### `chanrecv` decision tree

```
<-ch
  |
  v
[lock c.lock]
  |
  +-- c.closed != 0 AND qcount == 0? --> [unlock] --> return (true,false)
  |
  +-- c.sendq has waiter? --> [direct hand-off (or buffer rotate)] --> [unlock] --> goready(sender) --> return
  |
  +-- c.qcount > 0? --> [copy from buffer, recvx++] --> [unlock] --> return (true,true)
  |
  +-- block == false? --> [unlock] --> return (false,false)
  |
  v
[enqueue sudog on recvq]
[gopark]
  ...
[wakeup: sender wrote to ep, or close drained recvq; return]
```

### `closechan` flow

```
close(ch)
  |
  v
[lock c.lock]
  |
  +-- ch == nil? --> panic("close of nil channel")
  +-- c.closed != 0? --> [unlock] --> panic("close of closed channel")
  |
  v
[c.closed = 1]
[drain c.recvq into glist, each sg.success = false, sg.elem cleared]
[drain c.sendq into glist, each sg.success = false]
[unlock]
[for each gp in glist: goready(gp)]
```

### `selectgo` flow

```
select { case <-a:; case b <- v:; case <-c:; default: }
  |
  v
[build []scase]
[fisher-yates shuffle of pollorder]
[sort lockorder by channel address]
[lock all channels in lockorder]
[for each case in pollorder]:
  | -- if ready: perform op, unlock all, return case index
[has default?]:
  +-- yes: unlock all, return default index
[enqueue sudog on every case's channel]
[gopark]
  ...
[woken via one channel]
[dequeue sudog from all other channels]
[return the case index that woke us]
```

### Direct hand-off (unbuffered)

```
G1 (sender)                  G2 (receiver, parked on recvq)
+---------+                  +---------+
|  v=5    |   chansend:      | ep ──┐  |
+---------+   lock; dequeue  +------│--+
              recvq ─────────────►  │
              typedmemmove(elemtype, sg.elem, ep)
                                    │
                                    ▼
                           [G2's stack now contains 5]
              goready(G2)
              unlock
              return
```

### Direct hand-off (buffered, full)

```
buffer: [A][B][C][D]   (full, recvx=0)
sendq:  [G3 with X][G4 with Y]
                                  G_recv calls chanrecv
                                  → dequeue sendq → sg = G3,X
                                  → copy buffer[recvx] = A → ep (receiver gets A)
                                  → copy X → buffer[recvx]
                                  → recvx++
                                  → goready(G3)
buffer becomes: [X][B][C][D]   (still full, recvx=1)
sendq:  [G4 with Y]
```
