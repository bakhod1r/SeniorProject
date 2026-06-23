# Send/Receive Flow — Junior Level

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

In your Go source code you write something like this:

```go
ch <- 42       // send
v := <-ch      // receive
v, ok := <-ch  // receive with "is it closed" flag
```

Three little arrows. To a beginner they look like syntax, almost like assignment. They are not. Each arrow is a function call into the Go runtime. The compiler rewrites them. The runtime then locks a small struct in memory, looks at two queues of parked goroutines, and decides what to do — wake somebody, park yourself, copy a value into a slot, panic, or return a zero value.

This subsection is about that "what to do." We will follow a single send and a single receive from the source code down to the runtime, step by step. You will learn:

- What `ch <- v` actually compiles into.
- What `<-ch` actually compiles into.
- What happens when a sender finds a receiver already waiting.
- What happens when a sender finds nobody waiting (and has no buffer space).
- What happens for buffered channels.
- What happens when the channel is closed.
- Roughly how long each path takes.

The end goal is not to memorise runtime function names. It is to be able to look at a piece of channel code and say: "Here, the sender will directly hand off to the receiver. Here, the sender will park. Here, the receive returns a zero value with `ok == false`."

---

## Prerequisites

To follow this comfortably you should already know:

- That goroutines are lightweight threads scheduled by the Go runtime.
- That a channel is created with `make(chan T)` or `make(chan T, N)`.
- That `<-` is the send/receive operator.
- That an unbuffered channel blocks the sender until a receiver is there, and vice versa.
- That a buffered channel acts like a queue of fixed size.
- That `close(ch)` exists and that you can read from a closed channel.

If any of these are fuzzy, read the earlier subsections of `02-channels` and `09-channel-internals/01-hchan-struct` first. We will not re-derive the basic semantics; we will explain how the runtime implements them.

---

## Glossary

- **`hchan`**: the Go runtime's internal struct representing a channel. Created by `make`. Lives on the heap.
- **`chansend`**: the runtime function called for every send. Lives in `runtime/chan.go`.
- **`chanrecv`**: the runtime function called for every receive.
- **`chansend1`**: the small wrapper the compiler actually emits for `ch <- v`. Calls `chansend(c, &v, true, callerpc)`.
- **`chanrecv1`**: wrapper for `v := <-ch`. Calls `chanrecv(c, &v, true)`.
- **`chanrecv2`**: wrapper for `v, ok := <-ch`. Calls `chanrecv(c, &v, true)` and returns the `ok` flag.
- **sudog**: a small runtime struct that records "this goroutine is parked, waiting on this channel, with a value at this address."
- **`recvq`**: linked list of sudogs for receivers currently waiting on the channel.
- **`sendq`**: linked list of sudogs for senders currently waiting on the channel.
- **`buf`**: the ring buffer inside `hchan` (only used for buffered channels).
- **direct handoff**: when a value is copied straight from sender's stack to receiver's stack, skipping the buffer.
- **`gopark`**: the runtime call that puts a goroutine to sleep with state `_Gwaiting`.
- **`goready`**: the runtime call that wakes a sleeping goroutine into the scheduler's runnable set.
- **fast path / slow path**: the lock-free check at the top of the runtime function vs the full locked logic underneath.

---

## Core Concepts

### The arrow is a function call

When you write:

```go
ch <- 42
```

the Go compiler lowers this to (roughly):

```go
runtime.chansend1(ch, &localCopyOf42)
```

The runtime, not your code, is what does the work. The `&localCopyOf42` part matters: the compiler stores the value to be sent in a small location on your stack, then passes a pointer. The runtime can then `memmove` the value out of your stack into wherever it needs (a queue slot, the receiver's stack, or a sudog's `elem` pointer).

Similarly:

```go
v := <-ch
```

becomes:

```go
runtime.chanrecv1(ch, &v)
```

The runtime writes the received value through `&v`. That is why the destination of a receive must be an addressable lvalue.

And:

```go
v, ok := <-ch
```

becomes:

```go
ok := runtime.chanrecv2(ch, &v)
```

`chanrecv2` returns `false` when the channel is closed *and* the buffer is empty.

### Two queues live inside every channel

The `hchan` struct holds two linked lists:

- `recvq` — goroutines currently parked in `<-ch`.
- `sendq` — goroutines currently parked in `ch <- v`.

At any moment, at most one of these is non-empty. (If a receiver and a sender are both willing, one immediately satisfies the other — they never both queue.)

### Three possible outcomes for a send

When `chansend` runs, exactly one of these happens:

1. **Direct handoff**: a receiver was already parked in `recvq`. The runtime copies the value into the receiver's destination and wakes the receiver. Both goroutines proceed.
2. **Buffer hop**: no receiver is parked, but the channel is buffered and has room. The runtime stores the value in `buf[sendx]`, advances `sendx`, and returns.
3. **Park**: no receiver, no buffer space (or unbuffered). The runtime allocates a sudog, attaches it to `sendq`, calls `gopark`, and the sender sleeps until a receiver shows up.

Plus the special case: if the channel is *closed*, the send panics — there is no fourth option.

### Three possible outcomes for a receive

Symmetric:

1. **Direct handoff**: a sender was already parked in `sendq`. The runtime copies the sender's value into the receiver's destination and wakes the sender.
2. **Buffer hop**: the buffer has data. The runtime reads `buf[recvx]`, advances `recvx`, and returns.
3. **Park**: nothing available, channel still open. The receiver parks on `recvq`.

Special case: the channel is closed *and* the buffer is empty. The receiver does not park; it returns the zero value of the element type, with `ok == false`.

### The lock is held briefly

Every one of the above paths involves taking `hchan.lock` (a small spin-mutex). The lock is held only long enough to inspect and modify the channel's fields. The actual `memcpy` of the value into a receiver's stack happens *under the lock* (this is what guarantees no torn reads). But the goroutine is *woken* (`goready`) only *after* the lock is released.

### The shape of the runtime functions

`chansend` and `chanrecv` are similar in shape:

```go
func chansend(c *hchan, ep unsafe.Pointer, block bool, callerpc uintptr) bool {
    // 1. Nil-channel handling
    // 2. Fast-path check (lock-free)
    // 3. Lock
    // 4. Closed check
    // 5. Try direct handoff (peek recvq)
    // 6. Try buffer (if any room)
    // 7. If non-blocking, return false
    // 8. Otherwise, allocate sudog, attach to sendq, gopark
    // 9. (Woken) cleanup, possibly panic, return
}
```

Everything in the rest of this subsection is a deeper read of this shape.

---

## Real-World Analogies

### The package locker room

Imagine a small room with two waiting benches and a row of lockers (the buffer).

- A sender arrives carrying a package.
- A receiver arrives empty-handed.

If a receiver is already on the receiver-bench, the sender hands the package directly to them and both leave. **Direct handoff.**

If the receiver-bench is empty but there is a free locker, the sender drops the package in the next available locker, locks it, and leaves. **Buffer hop.**

If the receiver-bench is empty and all lockers are full, the sender sits on the sender-bench with the package on their lap and waits for someone to come for it. **Park.**

Receivers do the symmetric thing: take from a sender-bench occupant first, then from a locker, then sit and wait.

### A waiter at a small restaurant kitchen

Cook (sender) hands a finished plate to a waiter (receiver) standing at the pass. If no waiter is there and a single shelf has room, the cook puts the plate on the shelf. If the shelf is full and no waiter is there, the cook stands holding the plate.

A channel with `cap == 0` is "no shelf at all" — every handoff must be hand-to-hand. A channel with `cap == 4` has a four-slot shelf.

### A walkie-talkie call

Unbuffered channel = a real walkie-talkie call: both parties must be on the air at the same moment. Buffered channel = voicemail with N slots: the caller can leave a message and walk away, the receiver can listen later.

---

## Mental Models

### Model 1: every arrow is a runtime call

Stop reading `<-` as syntax. Read it as a function call. This single shift in perspective makes every later question easy.

### Model 2: three possible outcomes, in this order

For send: direct handoff → buffer hop → park. For receive: direct handoff → buffer hop → park (or "closed-and-empty → return zero").

The runtime always checks in this order. The order is what creates the "direct handoff is fastest" intuition.

### Model 3: the buffer is a fallback, not a primary path

Many beginners think a buffered channel "uses the buffer." It does not, if a peer is already waiting. The buffer is what catches values when peers are mismatched in time.

### Model 4: parking is just "go to sleep on this channel's queue"

`gopark` is not magic. It moves a goroutine from `_Grunning` to `_Gwaiting` and tells the scheduler "do not run this G until someone calls `goready` on it." The goroutine's stack is left intact; when it wakes, it picks up where it left off.

### Model 5: panic is a path, not an exception

"Send on closed channel" is the runtime explicitly calling `panic` inside `chansend`. It is not an exception caught by the language; it is an ordinary Go panic that propagates up the stack. Your goroutine dies unless somebody `recover`s.

---

## Pros & Cons

### Pros of the send/receive design

- Atomic. From the user's point of view, a send is a single operation; the runtime hides the lock, the queue manipulation, the copy.
- Bidirectional. The same primitive supports rendezvous, queueing, and broadcast (via close).
- Fast on the hot path. A direct handoff is ~50 ns on a modern CPU — comparable to a mutex `Lock/Unlock` pair.
- Composes with `select`. The same flow plugs into the multi-channel branch of `select`.
- Type-safe. The compiler ensures the value type matches the channel type.

### Cons

- Hidden cost on the slow path. A park-and-wake costs ~200+ ns and a scheduler round-trip. If you do this in a tight loop with no other work, performance is bounded by the channel.
- Lock contention scales poorly. The single `hchan.lock` is fine for two goroutines but becomes a hot point for hundreds.
- Panic surface. Close on a channel with active senders, or close-of-closed, are panics.
- Hard to reason about ordering. A naive read of the code suggests "send then receive." Reality is "lock, inspect queue, maybe direct handoff, maybe buffer, maybe park" — five different orderings depending on state.

---

## Use Cases

Almost every Go concurrency pattern reduces to "I have a send and a receive on a channel." Notable shapes:

- Worker pool: workers receive jobs from a single channel, send results to another.
- Pipeline: each stage receives from the previous, sends to the next.
- Cancellation: a `done` channel that everyone reads, closed by the coordinator.
- Fan-out: one channel sends to many readers (the first reader wins each value).
- Fan-in: many writers send to one channel, one reader drains.

In all of these, knowing whether the runtime is taking the direct-handoff path or the park path tells you whether your bottleneck is computation or scheduling.

---

## Code Examples

### Example 1: send finds a receiver waiting (direct handoff)

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    ch := make(chan int)

    go func() {
        v := <-ch
        fmt.Println("received", v)
    }()

    time.Sleep(10 * time.Millisecond) // let the receiver park
    ch <- 42                          // direct handoff
    time.Sleep(10 * time.Millisecond) // let stdout flush
}
```

What happens at runtime:

1. Receiver goroutine runs first.
2. Receiver enters `chanrecv`, locks `hchan`, finds `sendq` empty and buffer empty.
3. Receiver allocates a sudog, attaches to `recvq`, calls `gopark`. State: `_Gwaiting`.
4. Main goroutine sleeps 10 ms, then sends.
5. Sender enters `chansend`, locks `hchan`, sees a sudog in `recvq`.
6. Sender copies `42` directly into the receiver's destination (the variable `v` in the goroutine's stack, via the sudog's `elem` pointer).
7. Sender calls `goready` on the receiver, unlocks, returns.
8. Receiver resumes, prints "received 42".

The buffer is never touched. There is no buffer.

### Example 2: send with no receiver, no buffer (park)

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    ch := make(chan int)

    go func() {
        time.Sleep(100 * time.Millisecond)
        v := <-ch
        fmt.Println("received", v)
    }()

    fmt.Println("about to send")
    ch <- 42 // parks for ~100 ms
    fmt.Println("send returned")
    time.Sleep(10 * time.Millisecond)
}
```

What happens:

1. Sender starts. Goroutine starts (but sleeps).
2. Sender enters `chansend`, locks `hchan`, finds `recvq` empty, no buffer, channel open.
3. Sender allocates a sudog with `elem = &42`, attaches to `sendq`, calls `gopark`.
4. ~100 ms later the receiver wakes, enters `chanrecv`, locks `hchan`, sees a sudog in `sendq`.
5. Receiver copies the sender's value (via `sudog.elem`) into its own `v`.
6. Receiver `goready`s the sender, unlocks.
7. Sender resumes (the `ch <- 42` call returns), prints "send returned".

### Example 3: buffered send, room available (buffer hop)

```go
package main

import "fmt"

func main() {
    ch := make(chan int, 3)

    ch <- 1
    ch <- 2
    ch <- 3
    fmt.Println("three sends complete without blocking")

    fmt.Println(<-ch, <-ch, <-ch)
}
```

What happens for the first send:

1. `chansend` locks `hchan`, finds `recvq` empty.
2. Checks `qcount < dataqsiz` (0 < 3) → yes, room.
3. Copies `1` to `buf[0]`. `sendx = 1`. `qcount = 1`.
4. Unlocks, returns.

No park, no direct handoff. The fastest path for a buffered channel.

### Example 4: buffered send, buffer full (park)

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

    go func() {
        time.Sleep(50 * time.Millisecond)
        fmt.Println("drain", <-ch)
    }()

    fmt.Println("about to send the third")
    ch <- 3 // parks until the goroutine drains one
    fmt.Println("third send returned")
}
```

The third send finds `qcount == dataqsiz` (2 == 2). No `recvq` waiter either. So it parks on `sendq`, exactly like an unbuffered send.

### Example 5: receive-with-ok on closed channel

```go
package main

import "fmt"

func main() {
    ch := make(chan int)
    close(ch)

    v, ok := <-ch
    fmt.Println(v, ok) // 0 false
}
```

Inside `chanrecv`:

1. Lock `hchan`.
2. `c.closed == 1` and `qcount == 0`.
3. Write zero value to `*ep` (i.e., to `&v`).
4. Unlock.
5. Return `false` (which `chanrecv2` returns as `ok`).

No park, no sudog, ~30 ns.

### Example 6: send on closed channel panics

```go
package main

import "fmt"

func main() {
    defer func() {
        if r := recover(); r != nil {
            fmt.Println("recovered:", r)
        }
    }()

    ch := make(chan int)
    close(ch)
    ch <- 1 // panics
}
```

Inside `chansend`:

1. Lock `hchan`.
2. `c.closed != 0` → unlock, `panic("send on closed channel")`.

### Example 7: closed channel drains buffer before zero

```go
package main

import "fmt"

func main() {
    ch := make(chan int, 3)
    ch <- 1
    ch <- 2
    close(ch)

    fmt.Println(<-ch) // 1
    fmt.Println(<-ch) // 2
    v, ok := <-ch
    fmt.Println(v, ok) // 0 false
}
```

This shows: a closed channel still serves any buffered values before producing `ok = false`. This is implemented in `chanrecv` by checking `qcount > 0` *before* the closed-empty short-circuit.

### Example 8: a sender wakes a parked receiver

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    ch := make(chan int)
    var wg sync.WaitGroup
    wg.Add(1)

    go func() {
        defer wg.Done()
        v := <-ch
        fmt.Println("got", v)
    }()

    ch <- 99
    wg.Wait()
}
```

The sender finds the receiver in `recvq`, copies `99` into the receiver's `v` directly, calls `goready` on the receiver. The receiver does not need to re-lock the channel — the copy is already done.

### Example 9: receiver-first vs sender-first symmetric

```go
package main

import "fmt"

func main() {
    a := make(chan int)
    b := make(chan int)
    go func() { a <- 1 }()
    go func() { b <- 2 }()
    fmt.Println(<-a, <-b)
}
```

Depending on which goroutine wins the race, either:

- The sender parks first, then the receiver finds it in `sendq` and does a direct handoff (sender→receiver).
- The receiver parks first, then the sender finds it in `recvq` and does a direct handoff (sender→receiver).

Either way, the value reaches the receiver. The path differs but the outcome is identical.

### Example 10: a buffered channel never directly hands off if buffer has data

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    ch := make(chan int, 2)
    ch <- 1
    ch <- 2 // buffer is now full

    go func() {
        time.Sleep(10 * time.Millisecond)
        fmt.Println(<-ch) // pulls from buffer slot 0 → 1
    }()

    ch <- 3 // parks; when receiver runs, it pulls 1 from the buffer
            // then the sender's value 3 is moved into the buffer slot
}
```

Subtle: when a sender is parked and a receiver runs, the receiver pulls from the *buffer*, not from the sender. Then the receiver "promotes" the sender's value into the freed buffer slot. The sender wakes with its value already deposited.

This is one of the cleverest pieces of `runtime/chan.go`: it preserves FIFO ordering of the buffer even when senders are queued behind it.

---

## Coding Patterns

### Pattern 1: fast pipe between two goroutines (use unbuffered)

```go
ch := make(chan T)
```

If both sides are roughly in sync, an unbuffered channel runs the direct-handoff path almost every time. Highest throughput.

### Pattern 2: smooth out bursts (use small buffer)

```go
ch := make(chan T, 16)
```

A buffer lets a faster producer get ahead while the consumer catches up. Avoids park-and-wake when the workload is bursty.

### Pattern 3: signal via close

```go
done := make(chan struct{})
// later:
close(done)
```

`<-done` becomes a free, allocation-free "wake all readers" broadcast. The receive returns immediately with the zero value.

### Pattern 4: comma-ok loop

```go
for {
    v, ok := <-ch
    if !ok {
        return
    }
    process(v)
}
```

The `ok` form is your loop's exit condition. It is implemented by `chanrecv2`, which calls `chanrecv` and returns the success flag.

### Pattern 5: `range` over channel

```go
for v := range ch {
    process(v)
}
```

The compiler lowers this to repeated `chanrecv2` calls; the loop exits when `ok == false`.

---

## Clean Code

- Prefer the directional types: `chan<- T` for send-only, `<-chan T` for receive-only. The compiler then prevents you from doing the wrong operation. The runtime behaviour is identical; the directional types are a compile-time discipline.
- Hide channel ownership in a constructor; expose only the directional view.
- Name channels for what flows through them (`jobs`, `results`, `done`), not for the type (`intChan`).
- Avoid passing the same channel to many writers if you can route through one. Single-writer channels are easier to reason about.

---

## Product Use / Feature

A real example: a price-quote ingestion service receives quotes from a market data feed, batches them, persists to a database, and emits aggregated bars.

```go
quotes := make(chan Quote, 1024)
bars := make(chan Bar)

go ingest(feed, quotes)
go aggregate(quotes, bars)
go persist(bars)
```

- `quotes` buffered: absorbs bursts of market data.
- `bars` unbuffered: backpressure from the persistence step propagates upstream.

When you understand the send/receive flow, you can predict which channel sends will hot-loop (buffer hop) and which will park (full or unbuffered). That informs both correctness (no surprise deadlocks) and performance (CPU-bound vs scheduler-bound).

---

## Error Handling

The send/receive flow has three error-shaped outcomes:

1. **Panic from `chansend`**: send on closed channel.
2. **`ok == false`** from `chanrecv2`: channel closed and drained.
3. **Goroutine leak** (not a panic): you send to a channel that nobody ever reads from. The goroutine parks on `sendq` and stays parked forever. The runtime won't tell you; tools like `pprof` (goroutine profile) and the `runtime/debug.SetGCPercent`+goroutine count metric will.

Defensive patterns:

```go
// Pattern: bounded send with cancellation
select {
case ch <- v:
case <-ctx.Done():
    return ctx.Err()
}
```

This `select` ensures the sender does not park forever if context is cancelled.

```go
// Pattern: never close a shared-writer channel
// Instead, close a dedicated done channel
done := make(chan struct{})
// many writers writing to `data`...
// closer:
close(done)
// writers check done before writing
```

---

## Security Considerations

Channel send/receive is not a security boundary; both sides run in the same memory space. But two patterns matter:

- **Untrusted size**: `make(chan T, N)` with `N` from user input. A malicious user could request `N = 1<<40`, which allocates a huge buffer. Validate `N`.
- **Untrusted close**: if you expose a channel API where another component can close the channel, a malicious close panics your senders. Hide channels behind functions.

---

## Performance Tips

- Unbuffered with a direct handoff: ~40–100 ns per send/receive pair.
- Buffered with room: ~30–60 ns per send (no scheduler involvement).
- Park-and-wake: ~200+ ns plus a scheduler round-trip, plus possible Mp transitions.
- A mutex `Lock/Unlock` pair: ~30–50 ns. Comparable to a buffered channel send.

If you are doing a million send/receive pairs in a tight loop, you are probably scheduler-bound, not channel-bound. Profile.

---

## Best Practices

- Default to unbuffered. Buffer only when you have measured a need.
- One closer per channel. Document which goroutine closes.
- Use `select` with a `ctx.Done()` case for any send or receive that could outlive its caller.
- Avoid `cap > 0` "as backpressure". Backpressure comes from a closed loop of producers and consumers; buffering is a smoothing tool, not backpressure.
- Pair every send with a known receiver. Channels with no receiver are goroutine leaks waiting to happen.

---

## Edge Cases & Pitfalls

### Send to a nil channel blocks forever

```go
var ch chan int
ch <- 1 // blocks forever (no panic)
```

`chansend` checks `c == nil` first; if blocking, it calls `gopark` immediately with no sudog allocated. The goroutine sleeps until program exit.

### Receive from a nil channel blocks forever

Symmetric.

### Close of nil channel panics

```go
var ch chan int
close(ch) // panic("close of nil channel")
```

### Double close panics

```go
ch := make(chan int)
close(ch)
close(ch) // panic("close of closed channel")
```

### `select { case ch <- v: default: }` does not park

This is the non-blocking form; `chansend(c, ep, false, callerpc)` runs with `block == false`. Returns immediately with `false` if it would have parked. Implementation in `runtime/select.go`.

---

## Common Mistakes

- Assuming a buffered send "always uses the buffer". Wrong: it uses the buffer only if no receiver is parked.
- Assuming the receiver of `<-ch` runs after the sender of `ch <- v`. In direct handoff, the receiver might already be parked *before* the sender even arrives.
- Thinking `chansend1` is different from `chansend`. It is just a thin wrapper that passes `block = true`.
- Confusing `chanrecv1` and `chanrecv2`. The first returns nothing; the second returns the `ok` flag.

---

## Common Misconceptions

- "Channels are just queues." No. A channel is a queue *plus* two wait queues *plus* a lock *plus* a closed flag. The queue is only one of three paths the runtime can take.
- "The fastest path is the buffer path." No. The fastest path is the direct handoff: it skips the buffer copy entirely.
- "A send blocks until a receive happens." Only for unbuffered, no waiter case. For buffered, sends do not block until the buffer fills.
- "Closing a channel triggers all sends to fail." It triggers all sends to *panic*. Receivers, by contrast, succeed.

---

## Tricky Points

### `chansend1` is not exported, but it is what your code calls

You cannot call `runtime.chansend1` directly from user code (it is not exported). But every `ch <- v` in your program is, at the machine level, a call to this function. Stack traces inside the runtime will mention it.

### The address of `v` in `ch <- v` may be a temporary

If you write `ch <- f()`, the compiler stores the return of `f()` into a temporary stack slot, then passes `&temp` to `chansend1`. The runtime never sees `f`; it sees a pointer.

### The lock is taken even on the fast path

Some "fast paths" exist (e.g., non-blocking close check), but the actual send/receive sequence always takes the lock. There is no lock-free send/receive in the public API.

### Direct handoff bypasses the buffer even if buffer has room

Reading the code carefully: `chansend` first checks `recvq` for a waiting receiver. If found, it copies directly to that receiver — *regardless of whether the buffer has room*. The buffer is only used when no receiver is waiting.

Wait, that's actually wrong for buffered channels in normal flow. Read carefully: a receiver only parks on `recvq` if the *buffer is empty*. So if the buffer has any data, no receivers can be parked. The "direct handoff takes priority over buffer" rule never actually fires in conflict with "buffer has room" — they are mutually exclusive states.

---

## Test

A small program that demonstrates the three paths and measures their latency:

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

func benchDirectHandoff() time.Duration {
    ch := make(chan int)
    var wg sync.WaitGroup
    wg.Add(1)

    ready := make(chan struct{})
    go func() {
        defer wg.Done()
        close(ready)
        for i := 0; i < 1_000_000; i++ {
            <-ch
        }
    }()
    <-ready
    time.Sleep(10 * time.Millisecond) // ensure receiver parked

    start := time.Now()
    for i := 0; i < 1_000_000; i++ {
        ch <- i
    }
    wg.Wait()
    return time.Since(start)
}

func benchBufferHop() time.Duration {
    ch := make(chan int, 1_000_000)

    start := time.Now()
    for i := 0; i < 1_000_000; i++ {
        ch <- i
    }
    for i := 0; i < 1_000_000; i++ {
        <-ch
    }
    return time.Since(start)
}

func main() {
    d := benchDirectHandoff()
    fmt.Printf("direct handoff: %v / op = %v\n", d, d/1_000_000)
    b := benchBufferHop()
    fmt.Printf("buffer hop:     %v / op = %v\n", b, b/2_000_000)
}
```

Typical numbers on a modern x86:

```
direct handoff: 120ms / op = 120ns
buffer hop:     80ms / op = 40ns
```

The buffer hop wins per-op because there is no scheduler round-trip. Direct handoff loses on per-op but is the only option when you actually need synchronisation.

---

## Tricky Questions

**Q: Does `ch <- v` allocate?**
A: Generally no. The value goes through a stack slot or directly through a sudog's `elem` pointer. Sudogs themselves come from a per-P pool, not a fresh heap allocation. The exception is large values that require boxing for some sudog paths; the compiler usually avoids this.

**Q: If a sender parks, and then is woken by a close, what happens to its value?**
A: The value is discarded; the sender panics on resumption with "send on closed channel."

**Q: Why is `chanrecv1` separate from `chanrecv2`?**
A: Compiler convenience. `chanrecv1` returns nothing (the simple `v := <-ch`); `chanrecv2` returns a `bool` (the `v, ok := <-ch` form). Both call `chanrecv` underneath.

**Q: If two senders are parked on `sendq`, in what order do they wake?**
A: FIFO. The receiver pulls `sendq.first`, copies its value, wakes that goroutine. The next receiver pulls the next.

**Q: Does the sender of `ch <- v` see anything after the send completes?**
A: No return value. The function returns nothing. But the goroutine continues execution. If the channel was closed mid-park, it panics instead.

**Q: How does `chansend` decide between direct handoff and buffer for a buffered channel?**
A: Direct handoff wins *if there is a waiting receiver*. There can only be a waiting receiver when the buffer is empty (otherwise the receiver would have taken the buffered value and not parked). So direct handoff only fires when the buffer is empty.

**Q: When can a send and a receive happen "simultaneously"?**
A: They cannot — both take the same lock. The runtime serialises them. The illusion of simultaneity is just that the lock is held for a few hundred nanoseconds.

---

## Cheat Sheet

| Source code | Runtime call | Returns |
|---|---|---|
| `ch <- v` | `runtime.chansend1(ch, &v)` | (none) |
| `v := <-ch` | `runtime.chanrecv1(ch, &v)` | (none, writes to `&v`) |
| `v, ok := <-ch` | `runtime.chanrecv2(ch, &v)` | `bool` (`ok`) |
| `close(ch)` | `runtime.closechan(ch)` | (none) |
| `select { case ch <- v: }` | `runtime.selectgo` → `chansend(c, ep, false, ...)` | success bool |

Decision tree for `chansend`:

```
chansend
  c == nil?            -> park forever (or return false if non-blocking)
  c.closed == 1?       -> panic("send on closed channel")
  recvq has waiter?    -> direct handoff to receiver
  qcount < dataqsiz?   -> store to buf[sendx], advance sendx
  else                 -> allocate sudog, attach to sendq, gopark
```

Decision tree for `chanrecv`:

```
chanrecv
  c == nil?            -> park forever (or return zero+false if non-blocking)
  c.closed == 1 and qcount == 0?  -> return zero, ok=false
  sendq has waiter?    -> direct handoff from sender (or buffer promotion)
  qcount > 0?          -> read from buf[recvx], advance recvx
  else                 -> allocate sudog, attach to recvq, gopark
```

---

## Self-Assessment Checklist

- [ ] I can write down which runtime function corresponds to `ch <- v`, `<-ch`, and `v, ok := <-ch`.
- [ ] I can describe the three outcomes of a send and the three outcomes of a receive.
- [ ] I can explain what "direct handoff" means.
- [ ] I can predict whether a particular send will park or not, given the channel state.
- [ ] I know that close affects receivers (return zero) and senders (panic) asymmetrically.
- [ ] I know that send/receive on a nil channel blocks forever.
- [ ] I can estimate the cost difference between a buffered hop and a park/wake.

---

## Summary

A single `ch <- v` in Go is a function call. It enters `runtime.chansend`, locks the channel, picks one of three paths (direct handoff, buffer hop, park), and returns. The symmetric `<-ch` enters `runtime.chanrecv` and does the same. Closed channels make sends panic and receives return zero with `ok == false`. The fastest path — direct handoff — is the runtime's preferred outcome whenever sender and receiver meet at roughly the same time; it skips the buffer entirely. The slowest path — park and wake — costs hundreds of nanoseconds and a scheduler round-trip.

The shape of the runtime functions is symmetric (send mirrors receive). Once you know the decision tree, every channel-related question becomes a matter of "which path does this code take?"

---

## What You Can Build

- A tracing wrapper around `chan T` that logs which path each send takes (a fake `hchan` implemented in user code).
- A latency-distribution measurement tool that benchmarks direct handoff vs buffer hop on various workloads.
- A goroutine-leak detector that monitors goroutines parked on channels for too long.
- A teaching tool that animates the three paths for a sample program.

---

## Further Reading

- `src/runtime/chan.go` — the source of truth.
- "Go's work-stealing scheduler" by Dmitry Vyukov.
- Russ Cox's blog: "Bell Labs and CSP Threads."
- `runtime/HACKING.md` in the Go source.

---

## Related Topics

- [hchan struct](../01-hchan-struct/) — the data layout we are operating on.
- [Runtime behaviour](../02-runtime-behavior/) — the broader runtime model.
- [Buffer mechanics](../03-buffer-mechanics/) — the ring buffer details.
- [Closing channels](../../02-channels/06-closing-channels/) — the close path that intersects send/receive.

---

## Diagrams & Visual Aids

### Decision tree: send

```
ch <- v
   |
   v
chansend1(ch, &v)
   |
   v
chansend(c, ep, true, callerpc)
   |
   +-- c == nil?
   |     yes -> gopark forever
   |
   +-- lock(c)
   |
   +-- c.closed?
   |     yes -> unlock; panic("send on closed channel")
   |
   +-- sg := recvq.dequeue()
   |     sg != nil:
   |       copy *ep -> sg.elem (receiver's destination)
   |       goready(sg.g)
   |       unlock
   |       return
   |
   +-- qcount < dataqsiz?
   |     yes:
   |       copy *ep -> buf[sendx]
   |       sendx = (sendx + 1) % dataqsiz
   |       qcount++
   |       unlock
   |       return
   |
   +-- (slow path)
         allocate sudog, sg.elem = ep
         sendq.enqueue(sg)
         gopark(unlock_chan_lock_and_park)
         (woken)
         if sg.success == false and c.closed:
           panic("send on closed channel")
         release sudog
         return
```

### Decision tree: receive

```
v := <-ch     becomes    chanrecv1(ch, &v)
v, ok := <-ch becomes    chanrecv2(ch, &v)

chanrecv(c, ep, true)
   |
   +-- c == nil?
   |     yes -> gopark forever
   |
   +-- lock(c)
   |
   +-- c.closed != 0 && qcount == 0?
   |     yes -> write zero to *ep; unlock; return ok=false
   |
   +-- sg := sendq.dequeue()
   |     sg != nil:
   |       if buffer non-empty:
   |         copy buf[recvx] -> *ep
   |         copy sg.elem -> buf[recvx]
   |         advance recvx and sendx
   |       else (unbuffered):
   |         copy sg.elem -> *ep
   |       goready(sg.g)
   |       unlock
   |       return ok=true
   |
   +-- qcount > 0?
   |     yes:
   |       copy buf[recvx] -> *ep
   |       advance recvx
   |       qcount--
   |       unlock
   |       return ok=true
   |
   +-- (slow path)
         allocate sudog, sg.elem = ep
         recvq.enqueue(sg)
         gopark
         (woken)
         release sudog
         return sg.success
```

### Lifecycle: park and resume

```
Goroutine state machine for a sender that parks:

  _Grunning  ---chansend, no peer---> _Gwaiting (parked on sendq)
                                            |
                                            |  <--- another goroutine calls
                                            |       chanrecv, finds sender,
                                            |       does direct handoff,
                                            |       calls goready
                                            v
                                       _Grunnable
                                            |
                                            |  <--- scheduler picks
                                            v
                                       _Grunning
                                            |
                                            v
                                       chansend returns
```

### Buffer-hop vs direct handoff comparison

```
Direct handoff (unbuffered, both ready):
  sender stack: [42]
                  |
                  v   (memcpy under hchan.lock, via sudog.elem)
                receiver stack: [v=42]
  total: ~40-100 ns

Buffer hop (buffered, no waiter):
  sender stack: [42]
                  |
                  v   (memcpy under hchan.lock, into buf[sendx])
                hchan.buf: [_, _, 42, _, _]
                                ^ sendx
  total: ~30-60 ns

Park and wake (no peer, no buffer room):
  sender enters chansend
    -> lock(hchan)
    -> sudog := acquireSudog
    -> sudog.elem = &42
    -> sendq.enqueue(sudog)
    -> gopark
       (... time passes, lock released atomically ...)
    -> someone calls chanrecv
       -> finds sudog
       -> copies 42 to receiver
       -> goready(sender)
    -> sender resumes
  total: ~200+ ns + scheduler round-trip
```

### Sudog as a meeting record

```
A sudog is the runtime's "I'm waiting" envelope:

  sudog {
    g    *g                   // who is waiting
    next *sudog               // queue link
    prev *sudog
    elem unsafe.Pointer       // where to read/write the value
    c    *hchan               // which channel
    success bool              // set by the waker; false = closed
    // ... more fields
  }

A queued send is: sender's value already at &senderStack.v,
                  sudog.elem = &senderStack.v.

When a receiver wakes the sender, the receiver does:
  memmove(*receiverDst, sudog.elem, elemsize)
which reads from the sender's stack into the receiver's destination.

This is why "direct handoff" is literally direct: one memmove
between the two goroutines' stacks, no buffer involved.
```

### Closed channel: send vs receive

```
                   +--- chansend ----------------------+
                   |   c.closed != 0 -> PANIC          |
close(ch) -------- |                                   |
                   +--- chanrecv ----------------------+
                       c.closed != 0 and qcount == 0:
                         write zero to *ep
                         return ok = false
                       c.closed != 0 and qcount > 0:
                         drain buf normally
                         return ok = true
                         (next receive will see qcount == 0)
```

That ends the junior tour. The middle level digs into the exact runtime functions and their fast/slow paths; the senior level handles the direct-handoff trick and the race detector hooks; the professional level reads the source line by line.
