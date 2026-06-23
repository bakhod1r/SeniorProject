# Buffered vs Unbuffered Channels — Junior Level

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
> Focus: "I can spawn goroutines. How do I make them talk to each other safely?"

You have learned that `go someFunction()` launches a goroutine. You may have already discovered the first hard problem of concurrency: a goroutine you launched is now running off in the distance, doing something — and you have no clean way to know when it is done, or what value it produced, or whether it crashed.

Channels solve that. A channel is a typed, first-class value in Go that lets one goroutine *send* something and another goroutine *receive* it. The Go runtime takes care of all the locking, the memory ordering, and the parking-and-waking that you would otherwise have to write by hand. You declare what kind of values flow through the channel, and the compiler enforces that.

There are two flavours, decided by a single optional argument to `make`:

- **Unbuffered**: `make(chan int)` — the sender waits until a receiver is ready; the receiver waits until a sender is ready. Every transfer is a rendezvous.
- **Buffered**: `make(chan int, 5)` — the channel has a queue with room for `5` values. A sender only waits when the queue is full; a receiver only waits when the queue is empty.

This file teaches you what each one *is*, what each one *does*, when each one is the right choice, and why the difference matters. After reading it you will:

- Know how to declare, create, send to, and receive from a channel
- Understand the blocking rules in plain English
- Be able to read and write a `range` loop over a channel
- Know what `close()` does and what `nil` channels do
- Have written your first producer-consumer pair without touching `sync.Mutex`
- Recognise the two or three deadlocks every newcomer writes the first day

You do **not** need to know the runtime internals, the `hchan` struct, or the formal happens-before guarantees yet. Those come later. This file is about the moment a value crosses from one goroutine to another.

---

## Prerequisites

- **Required:** A working Go install, version 1.18 or newer. Check with `go version`.
- **Required:** Comfort with the `go` keyword from the [Goroutines](../../01-goroutines/01-overview/junior.md) chapter. You should be able to launch a goroutine without thinking about it.
- **Required:** Familiarity with `for` loops, slices, and basic functions.
- **Helpful:** Having seen `sync.WaitGroup` once, even if you do not love it. We will avoid it for the first few examples on purpose.
- **Helpful:** A terminal where you can run `go run main.go` and see panics. The runtime's deadlock detector will be your tutor; we *want* it to fire while you experiment.

If `go run` works and you can write `go someFunc()` without looking it up, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Channel** | A typed conduit for sending and receiving values between goroutines. Declared as `chan T` for some type `T`. |
| **Unbuffered channel** | A channel with capacity zero, created by `make(chan T)`. Every send blocks until a receiver is ready, and every receive blocks until a sender is ready. |
| **Buffered channel** | A channel with capacity `N > 0`, created by `make(chan T, N)`. Sends only block when the buffer is full; receives only block when the buffer is empty. |
| **Send** | The operation `ch <- v`, which delivers value `v` to the channel `ch`. The arrow points *into* the channel. |
| **Receive** | The operation `<-ch`, which takes a value out of the channel. The arrow points *out of* the channel. |
| **Block** | To pause the current goroutine until some condition is met. Channel operations block according to specific rules. |
| **Rendezvous** | A "meeting" between sender and receiver on an unbuffered channel — they synchronise at the moment of transfer. |
| **Capacity** | The size of a channel's internal buffer, queried with `cap(ch)`. Always `0` for unbuffered channels. |
| **Length** | The current number of buffered values, queried with `len(ch)`. Always `0` for unbuffered channels at rest. |
| **Close** | The operation `close(ch)`, which marks a channel as "no more sends will happen." Receivers can still drain remaining values. |
| **Nil channel** | A channel variable whose value is `nil` (the zero value for channel types). Sends and receives on a nil channel block forever. |
| **Deadlock** | A state where every goroutine is blocked and none can make progress. The Go runtime detects this for the main goroutine and panics. |

---

## Core Concepts

### A channel is a typed pipe between goroutines

A channel has a direction (or no direction), a value type, and a capacity. Before you can use one, you have to create it with `make`:

```go
ch := make(chan int)      // unbuffered, holds zero values at rest
buf := make(chan int, 5)  // buffered, holds up to 5 values at rest
```

You send into a channel with the `<-` operator on the right of the channel:

```go
ch <- 42  // send 42 to ch
```

You receive from a channel with the `<-` operator on the left of the channel:

```go
v := <-ch       // receive a value, store in v
v, ok := <-ch   // receive a value AND a flag — ok is false if ch is closed and empty
```

Every operation on a channel may block. The whole topic boils down to *when*.

### The blocking rules — one table to rule them all

| Operation | Channel state | What happens |
|-----------|---------------|--------------|
| `ch <- v` | unbuffered, no receiver waiting | sender blocks until a receiver shows up |
| `ch <- v` | unbuffered, receiver waiting | value transfers, both proceed |
| `ch <- v` | buffered, buffer not full | value goes into buffer, sender proceeds |
| `ch <- v` | buffered, buffer full | sender blocks until space appears |
| `ch <- v` | closed channel | **panic**: send on closed channel |
| `ch <- v` | nil channel | blocks forever |
| `<-ch` | unbuffered, no sender waiting | receiver blocks until a sender shows up |
| `<-ch` | unbuffered, sender waiting | value transfers, both proceed |
| `<-ch` | buffered, buffer not empty | value comes out of buffer, receiver proceeds |
| `<-ch` | buffered, buffer empty | receiver blocks until a value arrives |
| `<-ch` | closed channel, buffer empty | returns the zero value of the type immediately, with `ok == false` |
| `<-ch` | closed channel, buffer not empty | drains buffer; only after empty does it return zero+`!ok` |
| `<-ch` | nil channel | blocks forever |

Tape this table to your wall. Every channel bug you will ever write is a contradiction of one of these rows.

### Unbuffered = synchronous handshake

```go
done := make(chan struct{})

go func() {
    fmt.Println("worker doing the thing")
    done <- struct{}{}        // (1) blocks here until main reads
    fmt.Println("worker done") // (3) only prints after main has received
}()

<-done                         // (2) unblocks the worker
fmt.Println("main proceeds")
```

The worker writes to `done` before printing "worker done". But because the channel is unbuffered, that write *cannot complete* until `main` reaches `<-done`. The two goroutines synchronise *at* the channel operation. After this point, you have a happens-before relationship: anything the worker did before sending is visible to main after receiving.

### Buffered = asynchronous queue (with a limit)

```go
ch := make(chan int, 3)
ch <- 1   // does not block: buffer was empty, now has 1
ch <- 2   // does not block: buffer has 2
ch <- 3   // does not block: buffer is full
ch <- 4   // BLOCKS: no room
```

If we never receive from this channel, the fourth send hangs forever, and if it is the only goroutine, the runtime declares a deadlock. The buffer turns the channel into a small bounded queue. The producer can run "ahead" of the consumer, but only by `cap(ch)` values.

### `close(ch)` says "no more values"

Closing tells receivers, "the producer side is done."

```go
ch := make(chan int, 3)
ch <- 10
ch <- 20
close(ch)

v, ok := <-ch  // 10, true
v, ok = <-ch   // 20, true
v, ok = <-ch   //  0, false  (zero value because channel is closed and drained)
```

Important rules:

- Only the **sender** should close a channel. Closing from the receiver side leads to send-on-closed panics.
- Closing an already-closed channel panics.
- Sending on a closed channel panics.
- Receiving from a closed channel never panics — it just returns zero values forever.

### `range` over a channel = receive until close

```go
for v := range ch {
    fmt.Println(v)
}
```

This loop receives until `ch` is closed and drained, and then ends naturally. If you forget to `close(ch)`, the loop blocks forever after the last real value.

### Nil channels block forever

```go
var ch chan int  // nil
ch <- 1          // hangs forever
<-ch             // hangs forever
```

That is a feature, not a bug. We will exploit it later in `select` statements to *disable* a case at runtime.

---

## Real-World Analogies

### Unbuffered channel — handing a coffee directly to the customer

Picture a one-person coffee stand with no counter. The barista finishes a coffee and *holds it in her hand*. She cannot start the next one until the customer takes it from her. Likewise, the customer cannot leave until she hands him the cup. Sender and receiver meet at the exact moment of transfer. That is an unbuffered channel.

### Buffered channel — coffee with a pickup shelf

Now the stand has a shelf with three slots labelled "Order A, B, C." The barista finishes a drink, places it on the shelf, and immediately starts the next one. Customers come and pick their drinks off the shelf at their own pace. The barista only stops when all three slots are full and no one has come to pick anything up. The customer only waits when the shelf is empty. That is a buffered channel.

### Closing the channel — the shop posts "Closed" sign

When the barista posts the sign, no new drinks will be made — but customers can still take whichever drinks remain on the shelf. Once the shelf is empty, anyone who comes in is told politely, "We are closed, no drink for you" — they do not stand around waiting forever. That is `close(ch)` plus `v, ok := <-ch` returning `ok == false`.

### Nil channel — a coffee stand that does not exist

A nil channel is a coffee stand with no shelf, no barista, and no door. Anyone who tries to order or pick up just stands there, forever. Useful when you want to disable a path entirely without restructuring the program.

---

## Mental Models

### Model 1: capacity is the difference

The single most useful mental model: **an unbuffered channel is a buffered channel with capacity zero, and a buffered channel is an unbuffered channel with a small queue glued to its front.** Every blocking rule reduces to: "is there room?" for sends and "is there a value?" for receives. Capacity zero just means there is *never* room except at the moment a receiver is also there.

### Model 2: think of it like a turnstile vs a waiting room

An unbuffered channel is a turnstile that needs one person on each side to spin. A buffered channel is a turnstile with a small waiting room behind it: people can pass through and queue up until the room fills.

### Model 3: count the "happens-before" arrows

Every successful send paired with a successful receive creates a *happens-before* edge from the goroutine that sent to the goroutine that received. Anything written *before* the send is visible *after* the receive. This is how channels act as both communication and synchronisation. In an unbuffered channel, sender and receiver synchronise on the same instant. In a buffered channel, the synchronisation is between the *send* and the *matching* receive that drains it — they are not generally simultaneous in time.

---

## Pros & Cons

### Unbuffered channels

**Pros**
- **Strong synchronisation**: when send returns, you know the receiver has the value.
- **Forces you to think about pacing** — there is no hidden queue to mask producer-consumer mismatches.
- **No hidden memory cost** — there is no buffer to grow.

**Cons**
- **Easy to deadlock** if you forget that sends block.
- **No tolerance for short bursts** — if the producer makes two values in a row, the second waits.

### Buffered channels

**Pros**
- **Smooth out short bursts** — the producer can write `cap` items ahead before blocking.
- **Useful for fixed-size work queues** in worker-pool patterns.

**Cons**
- **Hides producer/consumer mismatches** — the buffer fills silently before deadlocking, and the deadlock often surfaces far from the code that caused it.
- **Tempts you to "fix" deadlocks by raising the capacity** — almost always wrong.
- **Loses synchronous handshake** — when send returns, the value may still be sitting unread.
- **Memory cost** — `cap` × `sizeof(T)` bytes per channel, plus runtime metadata.

---

## Use Cases

### When to reach for unbuffered channels

- **Signalling** that one event has happened, and you want the listener to know *exactly* when. Example: a `done` channel or a `started` channel.
- **Synchronous handoff** between two goroutines that should run in lockstep.
- **Test scaffolding** where you want deterministic ordering.
- When in doubt — *start* unbuffered. Add buffer only when you have a reason.

### When to reach for buffered channels

- **Bounded queues** between a producer and a consumer when you can prove the consumer keeps up *most* of the time and you only need to absorb short bursts.
- **Worker pool job queues**, where you accept a known maximum backlog.
- **Fan-in pipelines** where multiple producers feed one consumer and you want producers to not block on each other's pace.
- **Semaphores**: a buffered channel with capacity `N` and dummy `struct{}{}` tokens caps concurrency at `N`.

---

## Code Examples

### Example 1: hello world with an unbuffered channel

```go
package main

import "fmt"

func main() {
    ch := make(chan string)

    go func() {
        ch <- "hello from goroutine"
    }()

    msg := <-ch
    fmt.Println(msg)
}
```

The send blocks until main reaches `<-ch`. Then the value transfers and both goroutines move on. Without the goroutine launch, the send and receive would be on the same goroutine and the runtime would deadlock-panic immediately.

### Example 2: hello world with a buffered channel

```go
package main

import "fmt"

func main() {
    ch := make(chan string, 1)
    ch <- "hello from main"   // does not block: buffer has room

    msg := <-ch
    fmt.Println(msg)
}
```

No goroutine needed. The single send fits in the buffer, the receive immediately drains it. This style works only because we know exactly how many sends we will do.

### Example 3: a producer + a consumer with `range` and `close`

```go
package main

import "fmt"

func produce(ch chan<- int, n int) {
    defer close(ch)
    for i := 0; i < n; i++ {
        ch <- i * i
    }
}

func main() {
    ch := make(chan int, 3)
    go produce(ch, 5)

    for v := range ch {
        fmt.Println(v)
    }
}
```

Output: `0 1 4 9 16`. The producer closes when finished. The `range` loop drains the buffer and exits cleanly. Try the same program with `make(chan int)` (unbuffered) — it still works, but each send is a synchronous handshake.

### Example 4: send/receive with the comma-ok idiom

```go
ch := make(chan int, 1)
ch <- 7
close(ch)

for {
    v, ok := <-ch
    if !ok {
        fmt.Println("channel closed and drained")
        return
    }
    fmt.Println("got", v)
}
```

Output:
```
got 7
channel closed and drained
```

### Example 5: the "trip the deadlock detector on purpose" program

```go
package main

func main() {
    ch := make(chan int)
    ch <- 1   // BUG: no receiver, no other goroutine
}
```

Run it:

```
fatal error: all goroutines are asleep - deadlock!
```

This is the runtime telling you, "every goroutine is blocked and progress is impossible." Memorise this message — you will see it again, often.

### Example 6: capacity vs length

```go
ch := make(chan int, 3)
fmt.Println(len(ch), cap(ch))  // 0 3
ch <- 1
ch <- 2
fmt.Println(len(ch), cap(ch))  // 2 3
```

`cap` is fixed at creation. `len` is the number of values currently buffered. For unbuffered channels both are zero.

---

## Coding Patterns

### Pattern 1: the done signal

```go
done := make(chan struct{})

go func() {
    // ... work ...
    close(done)
}()

<-done   // unblocks when the goroutine closes done
```

We use `chan struct{}` because the value carries no information — we only care whether or not the channel is signalled. `struct{}` is the zero-byte type. Closing instead of sending is conventional: closing fans out to *all* receivers cheaply.

### Pattern 2: the result channel

```go
result := make(chan int)
go func() {
    result <- expensive()
}()
fmt.Println("result:", <-result)
```

Useful when you launch one goroutine and want one value back.

### Pattern 3: the worker with a job queue

```go
jobs := make(chan int, 10)
go func() {
    for j := range jobs {
        process(j)
    }
}()

for i := 0; i < 5; i++ {
    jobs <- i
}
close(jobs)
```

The buffered channel absorbs short bursts. Closing tells the worker to stop.

### Pattern 4: the semaphore

```go
sem := make(chan struct{}, 3) // at most 3 concurrent

for _, item := range items {
    sem <- struct{}{}      // acquire
    go func(it Item) {
        defer func() { <-sem }() // release
        process(it)
    }(item)
}
```

A buffered channel of zero-byte tokens caps concurrency at `cap(sem)`.

---

## Clean Code

- **Always state the channel direction in function signatures**: `chan<- T` for send-only, `<-chan T` for receive-only. The compiler then catches misuse.
- **Close from the producer side, never the consumer side**. If you find yourself wanting the consumer to close, restructure: usually, the consumer should signal the producer via a `done` channel, and the producer closes the data channel.
- **Use `chan struct{}` for pure signals**. It is zero bytes per value and immediately tells the reader, "this carries no payload."
- **Name signal channels after the event they announce**: `done`, `ready`, `cancel`, `started`. Avoid `ch` for anything that lives longer than five lines.
- **Make capacity an explicit, well-justified number**. `make(chan T, 100)` should make the reader ask "why 100?" and the answer should be in a comment or a constant.

---

## Product Use / Feature

### Feature: a request rate limiter shared across handlers

```go
type Limiter struct {
    tokens chan struct{}
}

func NewLimiter(n int) *Limiter {
    return &Limiter{tokens: make(chan struct{}, n)}
}

func (l *Limiter) Acquire() {
    l.tokens <- struct{}{}
}
func (l *Limiter) Release() {
    <-l.tokens
}
```

A buffered channel of size `n` gives you a hard ceiling of `n` concurrent operations across the whole process. Each `Acquire` blocks if the ceiling is already reached. It is the simplest production-grade rate limiter you can write in five lines, and it is what countless Go services use for "max 50 outbound HTTP calls in flight."

### Feature: a cancellation signal for a long-running export job

```go
func runExport(cancel <-chan struct{}) {
    for chunk := range chunks {
        select {
        case <-cancel:
            fmt.Println("cancelled mid-export")
            return
        default:
        }
        write(chunk)
    }
}
```

A read-only `chan struct{}` parameter is the idiomatic Go way to thread cancellation through a function. The caller closes it; every level checks it cooperatively. (We will see `select` in the next section — for now, just notice how `<-chan struct{}` fits naturally as a "kill switch" in an API.)

---

## Error Handling

Channel operations themselves do not return errors — they return values, blocks, or panics. The errors you have to handle are:

- **Send on closed channel** → `runtime panic`. Catch by *protocol*, not by `recover`. Make sure the writer side decides closing.
- **Close of nil channel** or **close of closed channel** → both panic. Same advice.
- **Channel-bound deadlock** → not catchable; the runtime kills the process. The fix is design, not error handling.

When the channel is delivering values *that themselves* may carry errors, send a struct:

```go
type Result struct {
    Value int
    Err   error
}

results := make(chan Result, 5)
results <- Result{Value: 42}
results <- Result{Err: io.EOF}
```

Receivers then check `r.Err` after `r := <-results`.

---

## Security Considerations

- **Unbounded channels are an OOM vector.** A buffered channel with a huge capacity (or worse, an unbuffered channel feeding a slow consumer plus a backlog elsewhere) can let an attacker who controls the producer drive memory growth without bound. *Always* size buffered channels with a defensible number, ideally backed by a constant.
- **Slow consumers as DoS.** If a public-facing producer (HTTP handler, message subscriber) stalls because a downstream channel is full, the producer's queue fills and the system grinds. Use timeouts (we cover them in the `select` chapter).
- **Sensitive data left in a buffer**. If a buffered channel still holds, say, password reset tokens at the moment a process panics or is profiled, those values may end up in the heap dump. For sensitive payloads, prefer unbuffered channels so the value lifetime is as short as possible.

---

## Performance Tips

- **The cost of a channel operation is not free, but it is cheap** — under 100 ns for typical word-sized payloads on modern hardware. You usually do not need to optimise it. You usually need to *not* use a channel for things that should be a single mutex-protected counter.
- **Prefer unbuffered or small-buffered channels** unless you have measured contention with a profiler. Big buffers hide contention; they do not eliminate it.
- **Pool large value types**: if `T` is a 4 KB struct, every send copies 4 KB. Send pointers (`chan *Job`) when payloads are large.
- **Avoid one channel per value over many short-lived transactions**. The cost of `make` plus the GC pressure of small channels shows up under heavy load. Reuse long-lived channels with worker patterns.

---

## Best Practices

- **Default to unbuffered.** Buffer only when you have a measured reason and you can name what burst the buffer absorbs.
- **Name the channel after its semantic role.** `jobs`, `done`, `errs`, `results` — never `c`, `ch`, `chan2`.
- **One owner of `close`.** Document on the channel which goroutine closes it.
- **Use `chan struct{}` for signals.** It compiles to zero bytes and reads as "event."
- **Prefer `range ch` over `for { v, ok := <-ch; if !ok ... }`.** It is shorter and harder to write a leak with.
- **Pass send-only and receive-only channels** in function signatures so the compiler enforces direction.
- **Never close from the receiver side.** It almost always becomes a send-on-closed panic.
- **Never close a channel you do not own.** If two goroutines write, neither owns it.

---

## Edge Cases & Pitfalls

### Pitfall 1: forgetting that an unbuffered send blocks

```go
ch := make(chan int)
ch <- 1  // deadlock
fmt.Println(<-ch)
```

The send blocks first; the receive never runs. This pattern only works if the send and receive are on different goroutines, *or* the channel is buffered with at least 1.

### Pitfall 2: sending after `close`

```go
ch := make(chan int, 1)
close(ch)
ch <- 1  // panic: send on closed channel
```

The fix is structural: the goroutine that does the close must be the only one that sends.

### Pitfall 3: closing twice

```go
close(ch)
close(ch) // panic: close of closed channel
```

If you have multiple producers, do *not* let any of them close. Use a coordinator goroutine or `sync.Once`.

### Pitfall 4: ranging over an unclosed channel

```go
ch := make(chan int)
go func() { ch <- 1; ch <- 2 }() // never closes
for v := range ch {
    fmt.Println(v)
}
// hangs after printing 2
```

The range loop blocks waiting for either a value or a close. Without the close, it waits forever.

### Pitfall 5: assuming a buffered send "happened" by the time send returns

```go
ch := make(chan int, 100)
ch <- 1
// The receiver may not have seen 1 yet. The value is just in the buffer.
```

If you needed the receiver to see it before you continued, you needed an unbuffered channel.

---

## Common Mistakes

- **"Let me increase the buffer to fix the deadlock."** Almost always wrong. The deadlock means a send has no receiver in the long run; bumping capacity just delays the symptom.
- **Closing a channel to "free its memory"** as if it were a `free()`. Closing is purely a signal. The garbage collector reclaims channels when no goroutine still references them.
- **Using `chan int` to send `nil`-or-something signals**. Use a struct or a pointer; an `int` channel cannot carry "no value" — its zero value is `0`, which is indistinguishable from a real `0`.
- **Spawning a goroutine with no `done` mechanism**, especially if it blocks on a channel. The goroutine leaks and so does the channel and so does any captured state.

---

## Common Misconceptions

- **"Buffered channels are faster."** Not in general. Their advantage is decoupling, not speed. A correctly designed unbuffered channel often beats a buffered one in latency-sensitive code because it avoids extra wakeups.
- **"`close` cancels in-flight sends."** It does not. `close` only stops *future* sends (and panics if anyone tries). Already-sent values stay in the buffer and remain receivable.
- **"A nil channel is just an empty channel."** No: an empty channel is a real channel with no values; a nil channel has no underlying object and blocks forever.
- **"`len(ch)` tells me how many goroutines are waiting."** No, `len(ch)` tells you only how many values are buffered. Goroutines parked on send/receive are counted separately by the runtime.

---

## Tricky Points

- **Capacity is fixed at `make` time.** You cannot grow a channel.
- **`cap(ch)` is `0` for unbuffered channels.** It is *not* `1`. The intuitive "well, one value passes through, so cap must be 1" is wrong — for unbuffered, no value ever sits at rest in the channel.
- **Receiving from a closed channel never blocks.** That is sometimes used (and sometimes abused) to signal cancellation broadcast.
- **Closing a `chan struct{}` is the cheapest fan-out broadcast in Go**: every receiver wakes up at once.
- **The order of cases that became ready inside `select` is randomised.** That detail is for the next chapter, but worth knowing now.

---

## Test

```go
package channels_test

import (
    "sync"
    "testing"
    "time"
)

func TestUnbufferedSendBlocksUntilReceive(t *testing.T) {
    ch := make(chan int)
    var wg sync.WaitGroup
    wg.Add(1)

    sentAt := make(chan time.Time, 1)
    go func() {
        defer wg.Done()
        sentAt <- time.Now()
        ch <- 42 // should block until main reads
    }()

    time.Sleep(50 * time.Millisecond)
    receivedAt := time.Now()
    v := <-ch

    if v != 42 {
        t.Fatalf("want 42, got %d", v)
    }
    if delta := receivedAt.Sub(<-sentAt); delta < 40*time.Millisecond {
        t.Fatalf("expected sender to have been blocked at least ~50ms, was blocked %v", delta)
    }
    wg.Wait()
}

func TestBufferedDoesNotBlockUntilFull(t *testing.T) {
    ch := make(chan int, 2)
    ch <- 1 // does not block
    ch <- 2 // does not block

    if got := len(ch); got != 2 {
        t.Fatalf("len want 2, got %d", got)
    }
}

func TestRangeStopsOnClose(t *testing.T) {
    ch := make(chan int, 3)
    ch <- 1
    ch <- 2
    close(ch)

    var sum int
    for v := range ch {
        sum += v
    }
    if sum != 3 {
        t.Fatalf("sum want 3, got %d", sum)
    }
}
```

Run with `go test -race`. The race flag is your friend; channels eliminate races, but only if you actually use them.

---

## Tricky Questions

1. *Why does `make(chan int)` not deadlock immediately at creation?*
   Because creation is just allocation. Deadlock requires a *blocked* operation. Until you send or receive, nothing blocks.

2. *Is `close(ch)` legal on an empty unbuffered channel?*
   Yes. Closing is independent of whether values exist. The next receiver will immediately get the zero value with `ok == false`.

3. *Can two goroutines safely receive from the same channel?*
   Yes. The runtime uses a queue of waiting receivers; each value is delivered to exactly one of them. This is the fan-out worker pattern.

4. *What happens if I receive from a `nil` channel inside a `select` with a `default`?*
   The nil case is never ready, so `default` runs. This is precisely the "disable case" trick we will use in the next chapter.

5. *Can I send `nil` over a channel of pointer type?*
   Yes — `nil` is a valid value of `*T`. Receivers must check.

---

## Cheat Sheet

```text
make(chan T)         unbuffered, capacity 0
make(chan T, N)      buffered,   capacity N

ch <- v              send
v := <-ch            receive
v, ok := <-ch        receive with closed-flag (ok == false if closed and drained)

close(ch)            mark channel done; panics if already closed or nil
range ch             receive until close
len(ch), cap(ch)     current size and capacity

chan T               bidirectional
chan<- T             send-only (function param)
<-chan T             receive-only (function param)

nil channel          blocks forever (use as "disabled" case in select)
zero-byte signal     chan struct{}
broadcast cancel     close(stopCh)  →  every <-stopCh wakes up
```

### One-line decision rule
> *"Unbuffered until proven buffered."*

---

## Self-Assessment Checklist

- [ ] I can write a producer/consumer pair using unbuffered channels.
- [ ] I can do the same using a buffered channel with a meaningful capacity.
- [ ] I can use `range` over a channel and explain when it terminates.
- [ ] I know what `close` does, who should call it, and what happens after.
- [ ] I know why receiving from a nil channel blocks forever and how that is useful.
- [ ] I can explain what `len(ch)` and `cap(ch)` return.
- [ ] I can read a deadlock panic and find at least one channel operation that did not have a partner.
- [ ] I know why "increase the buffer" is not a deadlock fix.
- [ ] I have used `chan struct{}` at least once for a pure signal.

---

## Summary

A channel is a typed conduit between goroutines. Made with `make(chan T)` it is unbuffered: every send and every receive must rendezvous. Made with `make(chan T, N)` it is buffered: a small queue absorbs short bursts. The blocking rules are summarised in one short table you should commit to memory; every channel bug is a contradiction of one of those rules. Closing announces "no more sends." Ranging receives until close. Nil channels block forever — sometimes a feature, more often a bug. Default to unbuffered. Buffer only when you can name the burst it is meant to absorb.

---

## What You Can Build

- A "ping" goroutine that signals once and exits.
- A producer-consumer pipeline with a buffered work queue and a `done` channel.
- A semaphore that limits concurrent operations to *N*.
- A simple fan-in: many producers, one channel, one consumer.
- A broadcast cancel: close one `chan struct{}` and every listener wakes up.
- A bounded job-runner: process at most *N* jobs in flight, the rest queued.

---

## Further Reading

- The Go Programming Language Specification — *Channel types*, *Send statements*, *Receive operator*, *Close*.
- Effective Go — *Concurrency* and *Channels* sections.
- Dave Cheney, "Channel Axioms" — five rules every Go programmer should know cold.
- *Go Concurrency Patterns* (Pike, Google I/O 2012) — still the canonical introduction.
- Sameer Ajmani, "Go Concurrency Patterns: Pipelines and cancellation" (Go blog).

---

## Related Topics

- [Goroutines](../../01-goroutines/01-overview/junior.md) — without goroutines, you have no one to send to or receive from.
- [Select Statement](../02-select-statement/junior.md) — the next step: multiplexing several channels.
- [Worker Pools](../03-worker-pools/junior.md) — applying buffered channels in a real pattern.
- [Sync package](../../03-sync-package/01-mutexes/junior.md) — when *not* to use a channel.

---

## Diagrams & Visual Aids

### Unbuffered handshake

```
sender                              receiver
  |                                    |
  | -- ch <- v (blocks) --             |
  |                                    | -- <-ch (blocks) --
  |  rendezvous: value v transfers     |
  | -------- happens-before --------->|
  | (continue)                        | (continue)
```

### Buffered queue

```
sender                  buffer (cap=3)              receiver
  | ch <- 1 ------>   [ 1 . . ]
  | ch <- 2 ------>   [ 1 2 . ]
  | ch <- 3 ------>   [ 1 2 3 ]    (buffer full)
  | ch <- 4 BLOCKS                                  <-ch  --> 1
  |                   [ 2 3 . ]
  | (resumes, sends 4) [ 2 3 4 ]
```

### State machine of a channel

```
            close()                  drain
[OPEN] -----------> [CLOSED, has values] ------> [CLOSED, drained]
   |                   |                              |
   v                   v                              v
 send: ok           send: panic                   send: panic
 recv: blocks       recv: returns buffered         recv: zero, ok=false
```

### Capacity visual

```
unbuffered          ::       (no slot at rest)
buffered(1)         :: [ ]
buffered(3)         :: [ ][ ][ ]
buffered(N)         :: [ ][ ][ ]...[ ]   N times
```

The wider the brackets, the more you can lie to yourself about producer/consumer balance — and the further from the original misalignment your eventual deadlock will surface.
