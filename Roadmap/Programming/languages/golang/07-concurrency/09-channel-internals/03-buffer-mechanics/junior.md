# Buffer Mechanics — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use-feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
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
29. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "What is inside a buffered channel? Where do the values actually live? How does the channel know it is full?"

When you write

```go
ch := make(chan int, 4)
```

Go allocates two things at once: a small bookkeeping struct called `hchan`, and a flat block of memory big enough to hold four `int` values. That flat block is the **ring buffer**. It is the heart of a buffered channel — the place where values sit between the moment a sender writes them and the moment a receiver reads them.

This file is about that ring buffer and nothing else. We will not yet dive into goroutine parking, mutex internals, or the full source of `runtime/chan.go`. Those come at middle and senior levels. Here we focus on the question: "I sent four values without anyone receiving. Where did they go?"

After reading this file you will:

- Know what a ring buffer is and why Go picked one
- Be able to draw the buffer of `make(chan int, 4)` on paper
- Understand `sendx`, `recvx`, and `qcount` and why they exist
- Predict whether a send will block by looking at the buffer state
- Understand why `chan struct{}` is special (its buffer holds nothing per slot)
- Recognise that the buffer is bypassed entirely when a receiver is already waiting
- Be ready to read the middle-level details with confidence

A buffered channel is one of the smallest, sharpest pieces of the Go runtime. Once you can see its ring buffer in your head, half the mystery of "what is going on with my channel?" disappears.

---

## Prerequisites

- **Required:** You know how to declare and use a channel: `ch := make(chan T)`, `ch <- v`, `v := <-ch`, `close(ch)`.
- **Required:** You have written at least one program with `go f()` and a channel.
- **Required:** You know the difference between "buffered" and "unbuffered" at the source-code level (the second argument to `make`).
- **Helpful:** You have read the earlier sections on channels at the junior level, especially `02-channels/01-buffered-vs-unbuffered`.
- **Helpful:** Familiarity with arrays and indices — if you have ever written `arr[i % len(arr)]` you already have the core idea of a ring.
- **Optional:** A glance at `01-hchan-struct/junior.md` will make the field names feel familiar, but it is not required.

If `make(chan int, 4)` is a line of code you have written and not a line you are guessing at, you are ready.

---

## Glossary

| Term | Definition |
|---|---|
| **Buffered channel** | A channel created with `make(chan T, N)` where `N > 0`. It carries up to `N` values in flight without a receiver. |
| **Unbuffered channel** | A channel created with `make(chan T)` or `make(chan T, 0)`. It carries zero values in flight; every send must meet a matching receive at the same instant. |
| **Ring buffer** | A fixed-size array used as a queue: the write index wraps from the last slot back to slot 0 when it would go past the end. Also called a "circular buffer." |
| **Capacity (`cap`)** | The number of slots in the ring buffer. Equal to the `N` you passed to `make`. Stored in `hchan.dataqsiz`. |
| **Length (`len`)** | The number of slots currently occupied. Equal to `hchan.qcount`. |
| **`sendx`** | The index in the ring buffer where the next send will write. After a successful send, it is incremented and wraps modulo `dataqsiz`. |
| **`recvx`** | The index in the ring buffer where the next receive will read. After a successful receive, it is incremented and wraps modulo `dataqsiz`. |
| **`qcount`** | The current number of values stored in the buffer. `qcount == 0` means empty; `qcount == dataqsiz` means full. |
| **`dataqsiz`** | The total number of slots — the capacity. Set once at `make` time and never changes. |
| **`hchan.buf`** | An `unsafe.Pointer` inside `hchan` that points at the first byte of the ring buffer's flat memory. |
| **`elemsize`** | The size in bytes of one element. Used to compute slot addresses: slot `i` starts at `buf + i * elemsize`. |
| **Direct hand-off** | When sender and receiver are both ready, the runtime copies the value straight from sender to receiver and skips the buffer. |
| **`typedmemmove`** | The internal runtime function that copies one element from a source pointer to a destination pointer, honouring the element type's pointer layout so the GC sees it correctly. |
| **`chanbuf(c, i)`** | A helper that returns the address of slot `i` in channel `c`'s buffer. Just `unsafe.Add(c.buf, uintptr(i) * uintptr(c.elemsize))`. |

---

## Core Concepts

### A buffered channel is a ring buffer plus indices

Imagine a row of `N` boxes laid out in a circle. Two arrows hover over the row:

- The **send arrow** (`sendx`) points at the next box to fill.
- The **receive arrow** (`recvx`) points at the next box to empty.

A counter (`qcount`) tracks how many boxes currently hold a value. That is the whole ring-buffer data structure. Every buffered channel in Go is one of these.

```text
make(chan int, 4) right after allocation:

  +---+---+---+---+
  | _ | _ | _ | _ |     dataqsiz = 4
  +---+---+---+---+     qcount   = 0
    ^                   sendx    = 0
    |                   recvx    = 0
  send/recv
```

After `ch <- 10`:

```text
  +----+---+---+---+
  | 10 | _ | _ | _ |    qcount = 1
  +----+---+---+---+    sendx  = 1
    ^    ^               recvx  = 0
    |    |
   recv  send
```

After `ch <- 20; ch <- 30`:

```text
  +----+----+----+---+
  | 10 | 20 | 30 | _ |   qcount = 3
  +----+----+----+---+   sendx  = 3
    ^              ^      recvx  = 0
    |              |
   recv          send
```

After `<-ch` (consumes 10):

```text
  +---+----+----+---+
  | _ | 20 | 30 | _ |    qcount = 2
  +---+----+----+---+    sendx  = 3
         ^         ^      recvx  = 1
         |         |
        recv      send
```

After two more sends — `ch <- 40; ch <- 50`:

```text
  +----+----+----+----+
  | 50 | 20 | 30 | 40 |  qcount = 4 (full)
  +----+----+----+----+  sendx  = 1 (wrapped)
         ^                recvx  = 1
         |
       send & recv
```

Notice that `sendx` wrapped from 4 back to 0 and then advanced to 1. That is the "ring" in ring buffer. Modular arithmetic: `sendx = (sendx + 1) % dataqsiz`. The Go runtime writes it slightly differently — incrementing and resetting on equality — but it is the same idea.

### `qcount == dataqsiz` means full; `qcount == 0` means empty

These two simple checks are the entire "is there room?" / "is there something to take?" logic inside the channel runtime.

```text
send needs room:    qcount < dataqsiz
recv needs data:    qcount > 0
```

If a send happens when `qcount == dataqsiz`, the sender either blocks (regular `ch <- v`) or returns immediately (select-with-default). If a receive happens when `qcount == 0` and the channel is not closed, same thing on the receive side.

### Why a ring, not a linked list?

A linked list could also be a queue: each send appends a node, each receive pops one. But that is the wrong choice here:

- **Allocation cost.** Every send would allocate a new node. The whole point of a channel is to be fast.
- **GC pressure.** Each node would be a small heap object the garbage collector has to scan.
- **Cache locality.** Linked-list nodes scatter across memory; a ring buffer is one contiguous block.
- **No bound.** A linked list has no natural capacity. A ring is fixed-size by construction, which matches the channel contract: "up to `N` values in flight."

The ring buffer is cheaper, denser, more cache-friendly, and bounded by design. Pick a ring.

### The buffer is allocated together with `hchan`

When you call `make(chan T, N)`, the runtime asks the allocator for one block big enough to hold both the `hchan` struct *and* the buffer behind it. Allocation: one call to `mallocgc`. Result: one pointer the GC tracks as a unit.

For an unbuffered channel (`N == 0`), there is no buffer block — just the `hchan` itself. `hchan.buf` is set to a sentinel (the address of the `hchan` itself, or a dummy pointer) so that GC bookkeeping is uniform. We will see this in detail at the senior level.

### Direct hand-off bypasses the buffer

Even on a buffered channel, the buffer is *not* always involved. If a receiver is parked when a send arrives, the runtime copies the value straight from the sender's stack to the receiver's stack and wakes the receiver. The buffer is never touched.

```text
  Buffered channel with parked receiver:
  send(v) → recv's destination (direct copy) → done
  buffer is bypassed
```

This is the same fast path as an unbuffered channel. It happens whenever sender and receiver are simultaneously ready. The buffer matters only when sends "get ahead" — that is, when nobody is currently waiting to receive.

### Zero-size element types: `chan struct{}` and friends

What if `elemsize` is zero? Consider `chan struct{}`. The empty struct has no fields, no bytes, no representation. A buffer of `N * 0 = 0` bytes is still well-defined: it is "nothing."

The runtime handles this specially. The buffer pointer is set to a known sentinel (the address of a global zero-size object), `elemsize` is zero, and the slot-address arithmetic still works because every slot resolves to the same address. The accounting (`sendx`, `recvx`, `qcount`) still works because indices and the count are independent of element bytes.

Why does anyone use `chan struct{}`? Because zero-size means **only signalling matters**: closed/open, sent/not-sent. No data is conveyed. Patterns like "done channels" and "semaphores" use it constantly. We will see examples below.

### The buffer holds *values*, not goroutines

A common confusion at first: people imagine the buffer holding goroutines. It does not. The buffer holds plain values of type `T`. Parked goroutines waiting to send or receive live in *two separate FIFO queues* (`sendq` and `recvq`) inside `hchan`. The ring buffer and the wait queues are different data structures with different jobs.

---

## Real-World Analogies

### The conveyor belt of pancakes

A pancake stall has a conveyor belt with `N` slots. The cook (sender) places a pancake on the next free slot. The customer (receiver) takes the pancake from the next filled slot. The belt loops. When all slots are full, the cook waits. When all slots are empty, the customer waits. When the cook places a pancake just as a customer is reaching out, the cook hands it over directly without using the belt — the belt is bypassed. That is the ring buffer plus direct hand-off, exactly.

### The mailbox with `N` pigeonholes

Imagine a wall of `N` numbered mailboxes. The postman writes the next letter into box `sendx` and increments `sendx`. The clerk reads from box `recvx` and increments `recvx`. Both indices wrap at the end of the wall. The mailroom only has `N` boxes — when all `N` are full, the postman has to wait. When all are empty, the clerk has to wait. The wall is a ring, not a stack of papers, because everyone reads and writes in O(1).

### The drive-through queue

A drive-through has `N` parking spots between the order window and the food window. Cars enter at the order side (`sendx`), pick up food at the food side (`recvx`), and leave. When `N` cars are queued, the order window can't take new orders. When zero cars are queued, the food window has nothing to hand out. The number of cars currently in queue is `qcount`. Exactly the channel ring.

### The library hold shelf

Each library has a shelf of held books. When a book is reserved, it is placed at position `sendx`. When a patron picks it up, it is removed from position `recvx`. The shelf has a fixed capacity. New holds beyond capacity have to wait. Empty shelf, no pickups happen. The same shape, again.

---

## Mental Models

### Model 1: "Two arrows and a counter"

Stop thinking "data structure." Think "two arrows on a ring, plus a counter." The arrows show where to write next and where to read next. The counter resolves the ambiguity when the arrows are at the same position: counter zero means empty, counter equal to capacity means full.

### Model 2: "Capacity is a soft brake, not a hard wall"

Capacity controls when sends start blocking. It is not a hard limit on throughput. A buffered channel with capacity 1 and a busy receiver can move millions of values per second. The buffer's role is to absorb short bursts where the sender is briefly faster than the receiver. It is a **shock absorber**.

### Model 3: "The buffer is paperwork; direct hand-off is a handshake"

When sender and receiver are both ready, the runtime prefers a handshake — direct copy from one stack to the other. Only when nobody is on the other side does the value land in the buffer (paperwork) for later pickup. Most well-designed channel programs spend most of their time on the handshake path.

### Model 4: "Indices, not pointers"

The ring uses indices (`sendx`, `recvx`), not pointers. This is cheaper, smaller (uint instead of pointer), and immune to relocation. Slot address is computed on demand: `buf + sendx * elemsize`. The runtime is happy to do that one multiplication; the cost is irrelevant compared to the lock.

### Model 5: "Buffers don't make channels faster, they make them less blocking"

A larger buffer does not raise per-operation throughput; it lowers the probability that a sender has to park. If your sender and receiver are perfectly paced, buffer size 0 vs. 100 makes no measurable difference. Buffer size matters when the producer-consumer rate is uneven.

---

## Pros & Cons

### Pros of the ring-buffer design

- **O(1) push and pop.** Index arithmetic only; no shifting, no allocation per element.
- **Cache-friendly.** One contiguous block of memory; the CPU can prefetch it.
- **Single allocation.** The buffer is allocated together with `hchan`, so the cost is one `mallocgc` call.
- **Bounded by construction.** No surprise growth, no resize logic, no rebalance.
- **Trivial "empty?" and "full?" checks.** Single counter comparison.
- **No per-operation allocations.** Sending and receiving touch existing memory; nothing new is allocated.

### Cons

- **Fixed size at creation.** You cannot grow or shrink the buffer after `make`. If you guessed wrong, your only recovery is to make a new channel.
- **Full buffer parks senders.** A slow receiver still causes back-pressure even with a buffer; the buffer only delays the inevitable.
- **Hides ordering bugs early.** Code that "works" with capacity 100 may deadlock with capacity 1 because the buffer happened to mask the bug.
- **Buffer holds references.** If `T` contains pointers, those pointers are kept alive by the channel; they cannot be collected until removed.
- **Wraparound arithmetic is one more thing to be careful about.** Not hard, but a reader needs to know it is there.

---

## Use Cases

| Scenario | Buffer choice | Why |
|---|---|---|
| Worker pool with `N` workers | `make(chan Task, N)` | Holds enough work for every worker to pick up immediately. |
| Producer hands off at unpredictable rate | small buffer (4–16) | Absorbs short bursts; back-pressure is preserved. |
| "Done" / cancellation signal | `make(chan struct{})` unbuffered, then `close` | Closure broadcasts to all waiters; no values needed. |
| Counting semaphore for "max N concurrent" | `make(chan struct{}, N)` | Each "Acquire" sends, each "Release" receives; ring capacity = N. |
| Pipeline stages with even rates | buffer 1 | Allows stages to overlap one tick without unbounded growth. |
| Logging fan-in from many goroutines | larger buffer (100s) | Avoids stalling hot paths when the log writer is briefly slow. |

| Anti-use | What goes wrong |
|---|---|
| Use a huge buffer "to be safe" | Hides back-pressure; lets memory blow up under load. |
| Use unbuffered when you need decoupling | Each send waits for a receiver; throughput is paced by the slower side. |
| Use buffered to "avoid deadlocks" | The deadlock is a design bug; the buffer just defers it. |

---

## Code Examples

### Example 1: Watching `len` and `cap` track the buffer

```go
package main

import "fmt"

func main() {
    ch := make(chan int, 3)
    fmt.Println(len(ch), cap(ch)) // 0 3

    ch <- 10
    ch <- 20
    fmt.Println(len(ch), cap(ch)) // 2 3

    <-ch
    fmt.Println(len(ch), cap(ch)) // 1 3
}
```

`len(ch)` reads `hchan.qcount`. `cap(ch)` reads `hchan.dataqsiz`. The capacity never changes after `make`. The length goes up and down with `qcount`.

### Example 2: Filling a buffer to the brim, then one more

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    ch := make(chan int, 2)
    ch <- 1
    ch <- 2
    fmt.Println("buffer full")

    go func() {
        time.Sleep(200 * time.Millisecond)
        v := <-ch
        fmt.Println("received", v)
    }()

    ch <- 3 // blocks until the goroutine receives
    fmt.Println("sent 3")
}
```

The third send blocks because the buffer is full. After ~200ms the receiver takes a value, freeing one slot. The blocked send completes and prints "sent 3."

### Example 3: Round-trip through the ring

```go
package main

import "fmt"

func main() {
    ch := make(chan int, 4)
    for i := 1; i <= 4; i++ {
        ch <- i
    }
    // buffer: [1,2,3,4], sendx=0(wrapped), recvx=0
    fmt.Println(<-ch) // 1, recvx -> 1
    fmt.Println(<-ch) // 2, recvx -> 2
    ch <- 5            // sendx -> 1
    ch <- 6            // sendx -> 2
    // buffer: [5,6,3,4], sendx=2, recvx=2
    for i := 0; i < 4; i++ {
        fmt.Println(<-ch)
    }
}
```

Output:

```
1
2
3
4
5
6
```

Notice that even though `5` and `6` were written to slots 0 and 1 (which previously held `1` and `2`), they still come out in send order. That is the FIFO guarantee of the ring with `recvx` chasing `sendx`.

### Example 4: `chan struct{}` for signalling

```go
package main

import "fmt"

func main() {
    done := make(chan struct{}, 1)
    go func() {
        fmt.Println("worker doing work")
        done <- struct{}{} // capacity 1: never blocks here
    }()
    <-done
    fmt.Println("main saw the signal")
}
```

The channel has a buffer of one zero-sized slot. Sending takes `0 * 1 = 0` bytes of payload — the send is a pure synchronisation event. The buffer's "slot" is conceptual; no bytes are copied.

### Example 5: Semaphore via buffered channel

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    sem := make(chan struct{}, 3) // at most 3 concurrent
    var wg sync.WaitGroup
    for i := 1; i <= 10; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            sem <- struct{}{}        // acquire
            defer func() { <-sem }() // release
            fmt.Println("task", id, "running")
        }(i)
    }
    wg.Wait()
}
```

The ring buffer's capacity *is* the concurrency limit. Acquire = "send into the ring." Release = "take one out." When the ring is full, new acquires park. This is one of the most common uses of a buffered channel that does nothing with values — `struct{}{}` is just a token.

### Example 6: Checking `len` before sending (anti-pattern, but instructive)

```go
package main

import "fmt"

func main() {
    ch := make(chan int, 2)
    ch <- 1
    if len(ch) < cap(ch) {
        ch <- 2 // OK
    }
    if len(ch) < cap(ch) {
        ch <- 3 // never executes; len == cap == 2
    }
    fmt.Println(len(ch), cap(ch)) // 2 2
}
```

This works but is brittle in concurrent code: between `len(ch) < cap(ch)` and `ch <- v`, another goroutine could fill the buffer. **The check is not atomic.** Use a `select` with `default` instead, which the runtime evaluates under the lock.

### Example 7: Non-blocking send via `select`

```go
package main

import "fmt"

func main() {
    ch := make(chan int, 1)
    ch <- 10 // buffer full
    select {
    case ch <- 20:
        fmt.Println("sent 20")
    default:
        fmt.Println("buffer full, skipped 20")
    }
}
```

`select` with `default` is atomic with respect to the buffer state. Inside the lock, the runtime either writes and returns, or drops to the `default` branch.

### Example 8: Draining the ring

```go
package main

import "fmt"

func main() {
    ch := make(chan int, 4)
    for i := 1; i <= 4; i++ {
        ch <- i
    }
    close(ch)
    for v := range ch {
        fmt.Println(v)
    }
}
```

After `close(ch)`, the ring buffer's remaining values still come out in order. Closing does not erase the buffer. Only when `qcount == 0` *and* `closed != 0` does receive return `(zero, false)`.

### Example 9: Two senders, one receiver — FIFO preserved per send order

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    ch := make(chan int, 8)
    var wg sync.WaitGroup
    wg.Add(2)
    go func() {
        defer wg.Done()
        for i := 0; i < 4; i++ {
            ch <- 100 + i
        }
    }()
    go func() {
        defer wg.Done()
        for i := 0; i < 4; i++ {
            ch <- 200 + i
        }
    }()
    wg.Wait()
    close(ch)
    for v := range ch {
        fmt.Println(v)
    }
}
```

The receiver sees values in the order they entered the buffer. Within one goroutine the order is preserved (100, 101, 102, 103), but between the two goroutines the interleaving is unpredictable — that depends on which one won the mutex first.

### Example 10: Watching `sendx` and `recvx` indirectly via `len`

```go
package main

import "fmt"

func main() {
    ch := make(chan int, 3)
    ch <- 1
    ch <- 2
    ch <- 3
    fmt.Println("len", len(ch)) // 3
    <-ch                         // recvx advances
    ch <- 4                      // sendx wraps
    fmt.Println("len", len(ch)) // 3 again
}
```

We cannot read `sendx` or `recvx` from user code, but we can see that the ring kept its full count of 3 throughout — one out, one in.

---

## Coding Patterns

### Pattern 1: Bounded work queue

```go
const N = 8
queue := make(chan Task, N)
go func() {
    for t := range queue {
        process(t)
    }
}()
for _, t := range tasks {
    queue <- t // blocks if N tasks already pending
}
close(queue)
```

The ring is a back-pressure mechanism: when N tasks are pending, producers pause.

### Pattern 2: Semaphore

```go
sem := make(chan struct{}, MaxConcurrent)
for _, item := range items {
    sem <- struct{}{}
    go func(item Item) {
        defer func() { <-sem }()
        handle(item)
    }(item)
}
```

### Pattern 3: Done channel

```go
done := make(chan struct{}) // unbuffered, signal by close
go worker(done)
// ... later
close(done)
```

This one does not use the buffer at all — the closure of the channel is the signal. Many goroutines can receive on `done` simultaneously.

### Pattern 4: Buffered "latest value wins" (drop-old)

```go
ch := make(chan int, 1)
send := func(v int) {
    select {
    case ch <- v:
    default:
        <-ch     // drop the old
        ch <- v  // (this can still block if a receiver beat us to it; in practice use a mutex)
    }
}
```

Useful for "latest sensor reading" patterns. The ring is size 1, and we explicitly evict the old.

### Pattern 5: Pipeline with small buffers

```go
stage1 := make(chan int, 4)
stage2 := make(chan int, 4)
go produce(stage1)
go transform(stage1, stage2)
go consume(stage2)
```

Small buffers (2–16) absorb one tick of jitter without letting memory grow unbounded.

---

## Clean Code

- **Name your channels for what they carry, not for the type.** `tasks chan Task`, not `ch chan Task`.
- **Pick the smallest buffer size that meets the throughput goal.** Big buffers hide bugs.
- **Document the buffer choice.** A comment like `// buffer size = num workers, so producer never parks` saves the next reader.
- **Use `chan struct{}` when you only need a signal.** Reviewers see immediately that no payload is involved.
- **Treat `cap(ch)` as part of the channel's identity.** Do not change it (you cannot anyway), and do not rely on resizing.
- **Avoid `len(ch)` as a control-flow primitive.** It races with concurrent sends and receives. Use `select` instead.

---

## Product Use / Feature

In a real product the ring buffer is invisible but its capacity is a knob you set deliberately:

- **HTTP server with backpressure.** A handler that hands off work to a goroutine pool uses `make(chan Job, MaxQueue)`. The capacity *is* the depth of the backpressure queue. Tune it based on latency targets.
- **Metrics fan-in.** A central goroutine writes metrics to disk or wire. Every emitter sends into `make(chan Metric, 1024)`. The capacity buys the writer time to flush during disk hiccups.
- **Connection limiting.** A server uses `make(chan struct{}, MaxConns)` as a semaphore. The capacity is the connection cap.
- **Cancellation broadcast.** A `done := make(chan struct{})` (unbuffered) with `close(done)` lets any number of goroutines see the shutdown signal simultaneously.

The product question is always "what capacity?" Too small and you lose throughput; too large and you hide problems. There is no universal right answer, only the right answer for your traffic shape.

---

## Error Handling

The ring buffer itself does not produce errors. It is just memory. But errors arise around it:

- **Sending on a closed channel panics.** The buffer is irrelevant — the runtime checks `closed` first.
- **Closing twice panics.** Again, buffer state is irrelevant; `closed` is a flag.
- **Sending to a nil channel parks forever.** No buffer is allocated for a nil channel; the send never gets to the ring.
- **Buffer leak via abandoned channel.** A channel left with values in the buffer holds those values' memory until the channel itself is garbage-collected. If `T` contains pointers, those are kept alive too.

When designing error paths around buffered channels:

- Always have one and only one closer.
- Drain the channel after closing if values held references and you want them collected immediately.
- Use `select` with `context.Done()` to time out blocked sends and receives.

```go
select {
case ch <- v:
case <-ctx.Done():
    return ctx.Err()
}
```

This is the standard pattern: never block on a buffered channel forever in production code.

---

## Security Considerations

The ring buffer is not a security boundary, but its capacity *is* a resource cap. A few patterns to watch:

- **Unbounded buffers are a denial-of-service vector.** A buffer of size `math.MaxInt32` with a busy producer and a stalled consumer can exhaust memory. Never let user input choose the capacity.
- **Capacity must be validated.** If your code does `make(chan T, n)` where `n` comes from configuration, validate `n` against a reasonable upper bound.
- **Values in the buffer outlive the send.** Once you put a pointer into a buffered channel, the channel can hold it for a long time. If the data is sensitive (a credential, a token), think about zeroing it after the receive.
- **`chan struct{}` carries no data.** It is the safest channel from a data-leak perspective — there is literally nothing in the slot.

The ring buffer cannot itself overflow into memory it does not own; the runtime's index arithmetic always stays within `[0, dataqsiz)`. So there is no buffer-overflow style vulnerability here — only resource exhaustion via too-large capacities.

---

## Performance Tips

- **Right-size the buffer.** Default to small (1–16) unless profiling tells you otherwise.
- **Prefer `chan struct{}` for signals.** Zero element size means zero copy cost.
- **Keep element types small.** Each send copies `elemsize` bytes via `typedmemmove`. Sending `chan [1024]byte` is much slower than `chan *Big`.
- **Avoid `len(ch)` in hot paths.** It takes the channel lock under the hood (briefly).
- **Use `select` with `default` for non-blocking sends instead of `len`/`cap` checks.**
- **Benchmark before "fixing."** The buffered fast path is around 30 nanoseconds on modern hardware; you will rarely outdo it.
- **Avoid creating a new channel inside a hot loop.** Allocation costs more than any send.

---

## Best Practices

- **Decide buffer size at design time, not at debugging time.** A buffer added "to fix a deadlock" usually papers over a coordination bug.
- **Document the buffer capacity's role** in a comment near `make`.
- **Pair `make(chan T, N)` with a sentence about who closes the channel** and when.
- **For broadcasts, use `close` on an unbuffered `chan struct{}`.** Do not try to "broadcast" via a buffered channel.
- **For semaphores, the capacity is the max concurrency.** Make that explicit.
- **Use a pipeline of small buffers** rather than one large buffer at the end. Small buffers preserve back-pressure.
- **Don't mix `chan T` ownership across packages without convention.** Buffer size and close responsibility are part of the API contract.

---

## Edge Cases & Pitfalls

- **Send to a closed buffered channel still panics**, even if the buffer has room.
- **Receive from a closed buffered channel drains the buffer first**, then returns the zero value with `ok == false`.
- **A nil channel never uses its buffer** — there isn't one. Send/receive on nil parks forever.
- **`len(ch)` is a snapshot.** By the time it returns, the value may be stale.
- **`cap(ch) == 0` on an unbuffered channel.** There is no ring at all.
- **Zero-element-size channels** (`chan struct{}` with capacity > 0) still behave like buffered channels for blocking purposes; the buffer just stores nothing per slot.
- **A goroutine blocked on a full buffer does *not* see when room appears unless it is on the wait queue.** The runtime wakes it from the queue; userland polling won't help.
- **Buffer is FIFO, but FIFO between two senders is decided by lock order**, not by send time on the wall clock.

---

## Common Mistakes

### Mistake 1: Using a large buffer to avoid deadlocks

```go
ch := make(chan Job, 1_000_000) // "just in case"
```

The deadlock returns the moment your producer outpaces your consumer for long enough. Worse, your memory now blows up before the deadlock signals itself.

### Mistake 2: Treating buffer size as throughput

```go
ch := make(chan int, 1024) // "for performance"
```

Buffer size does not directly affect throughput. It affects when sends start parking. If sender and receiver are balanced, buffer 1 is as fast as buffer 1024.

### Mistake 3: `len(ch)` to decide whether to send

```go
if len(ch) < cap(ch) {
    ch <- v
} else {
    drop()
}
```

Between the check and the send, the buffer can fill. Use `select` with `default`.

### Mistake 4: Capacity from user input without bound

```go
ch := make(chan T, n) // n from a config file
```

If `n` is huge, you allocate a huge buffer up front (`n * elemsize` bytes). Validate.

### Mistake 5: Forgetting that `chan struct{}` still parks

```go
done := make(chan struct{}, 1)
done <- struct{}{}
done <- struct{}{} // BLOCKS — capacity 1 is full
```

Zero-size element does *not* mean zero-size capacity. The slot count still matters.

### Mistake 6: Sending pointers and forgetting GC

```go
ch <- bigStruct{} // copies the whole struct into the buffer
```

vs

```go
ch <- &bigStruct{} // copies a pointer; the pointee stays alive while in the buffer
```

The buffer keeps references alive. If `T` contains pointers, every slot holds them.

---

## Common Misconceptions

- **"The buffer makes the channel faster."** No. The buffer changes *when* the sender blocks. Per-op cost is similar.
- **"A buffered channel skips the lock."** No. Every send and receive takes the same channel lock. The buffer just gives the lock a job to do (write/read a slot) without parking.
- **"`chan struct{}` allocates zero memory."** Mostly true, but the `hchan` itself is still allocated. Only the buffer block is zero bytes for the zero-size case.
- **"FIFO holds across all senders."** FIFO holds in the order they acquired the lock. Two senders in parallel may interleave in any order.
- **"The buffer grows when full."** No. The capacity is fixed at `make` time.
- **"You can resize a channel."** No, you cannot. Make a new one.
- **"`len(ch)` and `cap(ch)` are cheap and always accurate."** They are cheap, but they are point-in-time snapshots that race with concurrent operations.

---

## Tricky Points

- **The ring buffer's wrap is `if sendx == dataqsiz { sendx = 0 }`**, not `% dataqsiz`. Same result, cheaper instruction.
- **The slot a sender writes to is cleared by `typedmemclr` during the receive**, not by the send. This ensures that the buffer never retains references to already-received values.
- **`hchan` and its buffer are one allocation.** That is part of why channels are fast to create.
- **For `elemsize == 0`, all slot addresses are equal**, but the indices and count still advance — the runtime treats accounting independently from byte copying.
- **The buffer is invisible to `reflect`.** You cannot enumerate its contents from user code.
- **Closing a channel does not zero its buffer.** Remaining values come out in order. Only after `qcount == 0 && closed == 1` do receives return the zero value.

---

## Test

Write a small test that fills a buffer of capacity 3, partially drains it, refills it past the wrap, and verifies FIFO order with `close + for-range`.

```go
package main

import (
    "reflect"
    "testing"
)

func TestRingFIFO(t *testing.T) {
    ch := make(chan int, 3)
    ch <- 1
    ch <- 2
    ch <- 3
    if <-ch != 1 {
        t.Fatal("expected 1")
    }
    ch <- 4 // wraps
    if <-ch != 2 {
        t.Fatal("expected 2")
    }
    ch <- 5 // wraps again
    close(ch)
    var got []int
    for v := range ch {
        got = append(got, v)
    }
    want := []int{3, 4, 5}
    if !reflect.DeepEqual(got, want) {
        t.Fatalf("got %v want %v", got, want)
    }
}
```

Run with `go test -race`. The test should pass cleanly. If you flip any of the comparisons it will fail, confirming the FIFO property of the ring.

---

## Tricky Questions

1. What is the smallest amount of memory `make(chan struct{}, 100)` allocates? Hint: 100 × sizeof(struct{}) = 0 bytes of buffer, plus the `hchan` header.
2. After `ch := make(chan int, 4); ch <- 1; ch <- 2; <-ch; ch <- 3; ch <- 4; ch <- 5`, what are `sendx` and `recvx`? (They are 1 and 1 respectively; the ring wrapped once.)
3. Why is the buffer bypassed when a receiver is parked? Answer: because the receiver's destination address is known and we save one copy.
4. Why is the ring buffer's pointer (`hchan.buf`) stored separately from the `hchan` struct when they are allocated together? Hint: it is set to `unsafe.Pointer(&hchan{} + sizeof(hchan))` for the buffered case.
5. If you `make(chan int, 0)`, what does `hchan.buf` point at? (It is a sentinel — the address of the `hchan` itself in some versions, or nil; never used.)
6. Why is `qcount` not an `int` but a `uint`? Hint: it cannot be negative, and the runtime prefers unsigned for bounds-free arithmetic.
7. Can two goroutines write to two different slots of the buffer simultaneously without a race? Answer: no — the channel lock serialises every operation, even though the slots are independent.

---

## Cheat Sheet

```text
hchan ring buffer (buffered channel):

  dataqsiz  = capacity (set once at make)
  qcount    = current length (== len(ch))
  sendx     = next write index
  recvx     = next read index
  buf       = pointer to dataqsiz * elemsize bytes

Send (buffer path):
  if qcount < dataqsiz:
      buf[sendx] = v
      sendx = (sendx + 1) mod dataqsiz
      qcount++

Recv (buffer path):
  if qcount > 0:
      v = buf[recvx]
      clear buf[recvx]
      recvx = (recvx + 1) mod dataqsiz
      qcount--

Empty: qcount == 0
Full:  qcount == dataqsiz

Direct hand-off bypasses the buffer entirely.
chan struct{} has elemsize == 0; the buffer is a no-op for byte copies but indices still advance.
```

---

## Self-Assessment Checklist

- [ ] I can draw the ring buffer for `make(chan int, 4)` after a sequence of sends and receives.
- [ ] I know the meaning of `sendx`, `recvx`, `qcount`, `dataqsiz`.
- [ ] I can explain why the ring buffer is preferred over a linked list.
- [ ] I can explain why `chan struct{}` has zero per-slot bytes but still parks.
- [ ] I understand the direct hand-off path and when the buffer is bypassed.
- [ ] I can identify the difference between a buffered channel with capacity 0 (illegal in `make(chan T, -1)`, fine as `make(chan T, 0)`) and an unbuffered channel (they are the same thing).
- [ ] I never use `len(ch)` as a control-flow primitive in concurrent code.
- [ ] I can write a semaphore using a buffered `chan struct{}`.
- [ ] I know that closing a buffered channel does not erase the buffer.
- [ ] I know that the buffer holds the values until receive, including any pointers within them.

---

## Summary

A buffered channel in Go is a ring buffer with two cursor indices and a counter, all bundled inside `hchan` and guarded by one mutex. `make(chan T, N)` allocates the `hchan` header and a flat block of `N * sizeof(T)` bytes in a single allocation. Sends write at `sendx` and advance it; receives read at `recvx` and advance it; both indices wrap modulo `N`. The count `qcount` tells you how full the ring is — empty when zero, full when equal to capacity. The ring is preferred over a linked list because it is contiguous, allocated once, and bounded by construction.

The buffer is *not* always used. When a receiver is already parked, the runtime hands the value directly from the sender's stack to the receiver's stack and skips the buffer entirely. The buffer matters only when the sender outpaces the receiver. The zero-element-size case (`chan struct{}`) skips the byte-copy step but still uses indices and counters; it is the canonical channel for signalling.

Once you can picture the two arrows and the counter, the rest of channel internals (parking, hand-off, close) makes sense as natural extensions, not as magic.

---

## What You Can Build

- A debug "channel inspector" that periodically prints `len(ch)` and `cap(ch)` to spot back-pressure
- A bounded semaphore type that wraps a `chan struct{}` and offers `Acquire`/`Release` methods
- A fan-in goroutine that reads from many input channels and writes to one buffered output channel
- A pipeline of stages, each connected by a small buffered channel, with one global cancellation signal
- A unit-test harness that fills, drains, and re-fills a channel to assert FIFO under wrap

---

## Further Reading

- The Go source: `src/runtime/chan.go`. Look for `hchan`, `makechan`, `chanbuf`, `chansend`, `chanrecv`.
- "Go memory model": https://go.dev/ref/mem — for the happens-before edges around channel operations.
- Dave Cheney, "Channel Axioms" — short and sharp on what channels guarantee.
- Bryan C. Mills, "Go Concurrency Patterns" talks — for higher-level uses of buffered channels.
- This roadmap's `02-channels/01-buffered-vs-unbuffered/` at all levels — the prerequisite reading.
- This roadmap's `09-channel-internals/01-hchan-struct/` — the broader struct that contains the ring.

---

## Related Topics

- `01-hchan-struct` — The struct that contains the ring buffer
- `02-runtime-behavior` — How `chansend`/`chanrecv` interact with the ring
- `04-send-receive-flow` — Step-by-step traversal of the runtime paths that touch the ring
- `02-channels/01-buffered-vs-unbuffered` — The user-level view of the same mechanism
- `02-channels/03-channel-axioms` — The behavioural guarantees the ring buffer must uphold

---

## Diagrams & Visual Aids

### Ring after `make(chan int, 4)`

```text
Index:    0    1    2    3
        +----+----+----+----+
buf:    |    |    |    |    |
        +----+----+----+----+
qcount = 0
sendx  = 0  (•)
recvx  = 0  (◦)
```

### Ring after `ch <- 10; ch <- 20`

```text
Index:    0    1    2    3
        +----+----+----+----+
buf:    | 10 | 20 |    |    |
        +----+----+----+----+
qcount = 2
sendx  = 2  (•)
recvx  = 0  (◦)
```

### Ring after another `<-ch`

```text
Index:    0    1    2    3
        +----+----+----+----+
buf:    |    | 20 |    |    |
        +----+----+----+----+
qcount = 1
sendx  = 2  (•)
recvx  = 1  (◦)
```

### Ring at full capacity with wrap

```text
After ch <- 30; ch <- 40; ch <- 50:

Index:    0    1    2    3
        +----+----+----+----+
buf:    | 50 | 20 | 30 | 40 |
        +----+----+----+----+
qcount = 4 (FULL)
sendx  = 1  (•, wrapped from 4 to 0 and advanced to 1)
recvx  = 1  (◦)
```

Sender and receiver indices are aligned at position 1; the counter tells us the ring is full (`qcount == dataqsiz`).

### Direct hand-off, buffer bypassed

```text
Sender goroutine                Buffer            Receiver goroutine
   ep ──────── typedmemmove ────────────────────► destination
                  (one copy)
                  buffer untouched
```

### Memory layout after `make(chan int, 4)`

```text
Heap block (single allocation):
+----------------------------+
| hchan { qcount, dataqsiz,  |   <-- header
|         buf, sendx,        |
|         recvx, lock, ... } |
+----------------------------+
| int slot 0                 |   <-- buffer starts here
+----------------------------+
| int slot 1                 |
+----------------------------+
| int slot 2                 |
+----------------------------+
| int slot 3                 |
+----------------------------+
hchan.buf points to "int slot 0"
```

### Memory layout for `make(chan struct{}, 4)`

```text
+----------------------------+
| hchan { qcount, dataqsiz=4 |   <-- header
|         buf=sentinel,      |
|         sendx, recvx, ...} |
+----------------------------+
(no bytes for the buffer; elemsize == 0)
hchan.buf points to a sentinel; never dereferenced as bytes
```

### State diagram of a slot

```text
       (slot is empty)
            │  send
            ▼
       (slot has value)
            │  receive (typedmemclr after copy)
            ▼
       (slot is empty)
```

A slot oscillates between "empty" and "full" exactly twice per round trip of the ring.
