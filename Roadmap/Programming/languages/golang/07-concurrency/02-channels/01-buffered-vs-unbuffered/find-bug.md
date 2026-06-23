# Buffered vs Unbuffered Channels — Find the Bug

> Each snippet contains a real bug rooted in the choice (or misuse) of a buffered or unbuffered channel: deadlocks, panics, leaks, races, and silent ordering surprises. Read the code, decide what is wrong, then check the explanation and the fix.
>
> Every example is runnable. The fastest way to learn channels is to make Go's runtime yell at you, then learn to predict when it will.

---

## Bug 1 — Deadlock from an unbuffered channel with no receiver

```go
package main

import "fmt"

func main() {
    ch := make(chan int)
    ch <- 42
    fmt.Println(<-ch)
}
```

```
fatal error: all goroutines are asleep - deadlock!
```

**What's wrong?** An unbuffered channel demands a *rendezvous*: the send blocks until some other goroutine is ready to receive. There is no other goroutine here — the single `main` goroutine cannot both send and receive at the same time. It parks itself on `ch <- 42`, the runtime notices that *every* goroutine is parked, and prints the deadlock.

The mistake is conceptual: an unbuffered channel is not a one-element queue. It is a synchronisation point. Without a receiver, there is nothing on the other side of the synchronisation.

**Fix:** put the send (or the receive) in a separate goroutine so the rendezvous can complete:

```go
package main

import "fmt"

func main() {
    ch := make(chan int)
    go func() { ch <- 42 }()
    fmt.Println(<-ch)
}
```

Or, if you really want the single-goroutine semantics, use a capacity-1 buffered channel:

```go
ch := make(chan int, 1)
ch <- 42
fmt.Println(<-ch) // 42
```

Both compile, but they mean different things. The first synchronises two goroutines. The second uses the channel as a one-slot mailbox. Pick the one that matches your intent — do not pick "buffer it to avoid the panic."

---

## Bug 2 — Sending on a closed channel (panic)

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    ch := make(chan int, 4)
    var wg sync.WaitGroup

    for i := 0; i < 3; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            ch <- i
        }(i)
    }

    close(ch) // close immediately
    wg.Wait()

    for v := range ch {
        fmt.Println(v)
    }
}
```

```
panic: send on closed channel
```

**What's wrong?** `close(ch)` runs *before* the producer goroutines have done their sends. Whichever goroutine wakes up next finds a closed channel and panics. A buffered channel does not save you here — closing means "no more values will ever arrive," not "drain the buffer first then refuse new sends." Sends after `close` always panic, even if the buffer has free slots.

**Fix:** the goroutine that owns the channel (typically the one that creates and sends to it) is the one that closes it. Wait for the producers to finish, *then* close, *then* range:

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    ch := make(chan int, 4)
    var wg sync.WaitGroup

    for i := 0; i < 3; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            ch <- i
        }(i)
    }

    go func() {
        wg.Wait()
        close(ch) // closer waits for all senders
    }()

    for v := range ch {
        fmt.Println(v)
    }
}
```

The closer goroutine acts as a barrier: it joins on the WaitGroup, then closes. The receiver's `range` terminates cleanly because no further sends are possible.

---

## Bug 3 — Closing a channel from the receiver side

```go
package main

import "fmt"

func main() {
    ch := make(chan int, 2)

    go func() {
        for v := range ch {
            fmt.Println(v)
            if v == 2 {
                close(ch) // receiver closes
            }
        }
    }()

    ch <- 1
    ch <- 2
    ch <- 3
}
```

```
panic: send on closed channel
```

**What's wrong?** Closing from the consumer is the second-most-common channel bug after deadlock. The consumer cannot know whether the producer is about to send another value — and here the producer's `ch <- 3` runs after the consumer's `close(ch)`, so it panics.

The convention in Go is: **the sender closes**. A channel is half-duplex by ownership: whoever sends is responsible for declaring the stream finished. If multiple goroutines send, none of them can safely close — coordinate via a WaitGroup or a "closer" goroutine (Bug 2 fix).

**Fix:** let the producer signal end-of-stream by closing, and let the consumer cancel via a separate channel or context if it wants to stop early:

```go
package main

import (
    "context"
    "fmt"
)

func main() {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    ch := make(chan int, 2)

    go func() {
        defer close(ch) // producer closes
        for i := 1; ; i++ {
            select {
            case <-ctx.Done():
                return
            case ch <- i:
            }
        }
    }()

    for v := range ch {
        fmt.Println(v)
        if v == 2 {
            cancel() // consumer asks to stop, does NOT close
            break
        }
    }
}
```

The producer owns `close`. The consumer signals "I'm done" via context cancellation. Two roles, two tools.

---

## Bug 4 — Leaked receiver waiting forever

```go
package main

import (
    "fmt"
    "time"
)

func fetch() int {
    ch := make(chan int)
    go func() {
        time.Sleep(2 * time.Second)
        ch <- 42 // unbuffered: needs a receiver
    }()

    select {
    case v := <-ch:
        return v
    case <-time.After(100 * time.Millisecond):
        return -1 // timeout
    }
}

func main() {
    fmt.Println(fetch())
    time.Sleep(3 * time.Second) // wait long enough to expose the leak
}
```

The output is `-1` and the program exits — but the worker goroutine is still alive, blocked forever on `ch <- 42` because the receiver gave up after 100 ms.

**What's wrong?** The channel is unbuffered. When `fetch` times out, it walks away from the receive without telling the worker. The worker arrives 1.9 seconds later with a value, finds nobody on the other side, and parks. It will never be scheduled again, and its stack and any captured variables are pinned in memory forever — a classic goroutine leak.

In a long-running program (a server handling thousands of requests), this leaks one goroutine per timeout. Memory grows; you blame GC; the real cause is a missing buffer.

**Fix:** give the worker a place to drop the value and walk away. Capacity 1 is exactly right:

```go
func fetch() int {
    ch := make(chan int, 1) // capacity 1 — worker can always send
    go func() {
        time.Sleep(2 * time.Second)
        ch <- 42 // never blocks; receiver may or may not exist
    }()

    select {
    case v := <-ch:
        return v
    case <-time.After(100 * time.Millisecond):
        return -1
    }
}
```

The buffer absorbs the lone result. If `fetch` waits, it gets it. If `fetch` times out, the value lands in the buffer, the worker exits, and the channel becomes garbage. No leak.

This pattern — "result channel for a one-shot worker" — is the canonical use of a capacity-1 buffered channel.

---

## Bug 5 — Hidden async with buffered channel hiding an ordering bug

```go
package main

import "fmt"

func main() {
    ch := make(chan string, 3)

    go func() {
        ch <- "a"
        ch <- "b"
        ch <- "c"
    }()

    go func() {
        ch <- "x"
        ch <- "y"
        ch <- "z"
    }()

    for i := 0; i < 6; i++ {
        fmt.Println(<-ch)
    }
}
```

The author expects `a, b, c, x, y, z` (or `x, y, z, a, b, c`). The actual output is something like `a, x, b, y, c, z` — interleaved.

**What's wrong?** A buffered channel preserves order *per sender*, not globally. With two producers each sending three items to a shared buffer, the runtime is free to schedule them in any order. The buffer (capacity 3) only widens the window in which interleaving can occur — it does not impose a global ordering.

This bug bites teams that switch from unbuffered to buffered "for performance" and discover that some downstream check ("the second item is always related to the first") starts failing intermittently.

**Fix:** if you need per-batch ordering, send batches as a single value:

```go
package main

import "fmt"

func main() {
    ch := make(chan []string, 2)

    go func() { ch <- []string{"a", "b", "c"} }()
    go func() { ch <- []string{"x", "y", "z"} }()

    for i := 0; i < 2; i++ {
        for _, v := range <-ch {
            fmt.Println(v)
        }
    }
}
```

Each batch arrives atomically. If you instead need a global order across producers, you need a single sender — collect from both goroutines via a coordinator, or use a different data structure entirely.

The general lesson: a channel is a queue, not a sort. Multiple senders interleave.

---

## Bug 6 — Goroutine leak when consumer exits early

```go
package main

import "fmt"

func produce(ch chan<- int) {
    for i := 0; i < 1_000_000; i++ {
        ch <- i // blocks once the (unbuffered) channel has no receiver
    }
    close(ch)
}

func main() {
    ch := make(chan int)
    go produce(ch)

    for v := range ch {
        fmt.Println(v)
        if v >= 5 {
            break // consumer leaves early
        }
    }
}
```

The program prints 0 through 5, then `main` returns — but the producer goroutine is still alive, blocked on `ch <- 6`, holding its stack and a million-iteration future of allocations it will never make.

**What's wrong?** The consumer's `break` walks away from the channel. The producer is unbuffered, so its next send waits for a receiver that will never appear. Process exit eventually cleans up, but in a long-lived service this same pattern (e.g. an HTTP handler that bails on the first error) leaks a goroutine per request.

**Fix:** signal the producer to stop. A `done` channel or a `context.Context` is the standard tool:

```go
package main

import (
    "context"
    "fmt"
)

func produce(ctx context.Context, ch chan<- int) {
    defer close(ch)
    for i := 0; i < 1_000_000; i++ {
        select {
        case <-ctx.Done():
            return
        case ch <- i:
        }
    }
}

func main() {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    ch := make(chan int)
    go produce(ctx, ch)

    for v := range ch {
        fmt.Println(v)
        if v >= 5 {
            cancel() // tell the producer
            break
        }
    }
}
```

`cancel()` unblocks the producer's `select`, which returns, which closes the channel cleanly. `defer cancel()` is belt-and-braces in case the loop exits a different way.

---

## Bug 7 — Range over a channel that's never closed

```go
package main

import "fmt"

func main() {
    ch := make(chan int, 4)
    ch <- 1
    ch <- 2
    ch <- 3

    for v := range ch {
        fmt.Println(v)
    }
}
```

```
1
2
3
fatal error: all goroutines are asleep - deadlock!
```

**What's wrong?** `range ch` is a loop that calls `<-ch` repeatedly, terminating *only* when the channel is closed. The buffer holds three values; after `range` drains them, it tries to receive a fourth. The channel is empty and not closed, so the receive blocks. Nothing else is running, so the runtime declares deadlock.

This is a recurring trap when prototyping: people fill a buffered channel up-front, range over it, and forget that ranging requires the channel to be closed eventually.

**Fix:** close the channel when no more sends will happen. For this synchronous example, close before the loop:

```go
package main

import "fmt"

func main() {
    ch := make(chan int, 4)
    ch <- 1
    ch <- 2
    ch <- 3
    close(ch) // no more sends; range will terminate after draining

    for v := range ch {
        fmt.Println(v)
    }
}
```

In a producer/consumer setup, the producer closes after its last send (Bug 2 fix). If you cannot guarantee a close — e.g. multiple producers — do not use `range`; receive with the comma-ok form and break on a separate signal.

---

## Bug 8 — Double close panic

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    ch := make(chan int, 2)
    ch <- 1
    ch <- 2

    var wg sync.WaitGroup
    for i := 0; i < 2; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for v := range ch {
                fmt.Println(v)
            }
            close(ch) // close from each consumer
        }()
    }
    close(ch) // also close from main
    wg.Wait()
}
```

```
panic: close of closed channel
```

**What's wrong?** `close` is idempotent in the sense that closing a channel twice is *not* allowed — Go panics. Multiple goroutines trying to "be helpful" by closing the channel after they finish ranging guarantees at least one will lose the race and panic.

The pattern echoes Bug 3: anyone who is not the sole sender has no business calling `close`.

**Fix:** one closer, one close. The simplest version is to drop all the redundant closes:

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    ch := make(chan int, 2)
    ch <- 1
    ch <- 2
    close(ch) // exactly one close, in the goroutine that owns the channel

    var wg sync.WaitGroup
    for i := 0; i < 2; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for v := range ch {
                fmt.Println(v)
            }
        }()
    }
    wg.Wait()
}
```

If you genuinely have multiple potential closers, guard with `sync.Once`:

```go
var once sync.Once
once.Do(func() { close(ch) })
```

But `sync.Once` is usually a smell — it means the ownership is unclear. Fix the ownership instead.

---

## Bug 9 — Capacity-zero buffered channel mistake

```go
package main

import "fmt"

func main() {
    capacity := 0 // computed elsewhere, sometimes ends up zero
    ch := make(chan int, capacity)

    go func() { ch <- 1 }()
    fmt.Println(<-ch)

    ch <- 2 // expect "buffered" behaviour
    fmt.Println(<-ch)
}
```

The first round works. The third line — `ch <- 2` from the main goroutine with no waiting receiver — deadlocks.

**What's wrong?** `make(chan int, 0)` produces an *unbuffered* channel. The "0" is not "zero buffer slots, treat as a one-deep queue"; it is the literal absence of buffering. Programmers who size channels from a config (`workerCount`, `cores - 1`, etc.) sometimes end up with a `0` and silently get unbuffered semantics — which then deadlock as soon as code that assumed buffered behaviour runs.

**Fix:** validate the capacity before constructing the channel. If "no real buffering needed" is a valid case, branch explicitly so the reader sees the intent:

```go
package main

import "fmt"

func makeCh(cap int) chan int {
    if cap < 1 {
        cap = 1 // smallest meaningful buffer
    }
    return make(chan int, cap)
}

func main() {
    ch := makeCh(0)

    go func() { ch <- 1 }()
    fmt.Println(<-ch)

    ch <- 2
    fmt.Println(<-ch)
}
```

The bigger lesson: do not let runtime-computed capacities silently flip a channel between "synchronous handshake" and "queue." Pick the semantics deliberately.

---

## Bug 10 — Wrong direction: sending to a receive-only channel

```go
package main

import "fmt"

func consumer(in <-chan int) {
    in <- 1 // typo: meant to receive
    fmt.Println(<-in)
}

func main() {
    ch := make(chan int, 1)
    consumer(ch)
}
```

```
./main.go:6:5: invalid operation: cannot send to receive-only channel in
```

**What's wrong?** `<-chan int` is a receive-only view of a channel. The compiler refuses any send against it. The fix is mechanical, but the underlying mistake — confusing "receive value" with "send value" — is a hint that the function's role is unclear in the author's head.

**Fix:** receive from the channel, do not send:

```go
package main

import "fmt"

func consumer(in <-chan int) {
    v := <-in // receive
    fmt.Println(v)
}

func main() {
    ch := make(chan int, 1)
    ch <- 1
    consumer(ch)
}
```

Direction annotations in the signature are not just documentation; they are a compile-time guarantee. Lean on them — `producer(out chan<- int)` and `consumer(in <-chan int)` make a function's role obvious and unforgeable.

---

## Bug 11 — Using a nil channel by accident

```go
package main

import "fmt"

type Worker struct {
    in chan int // never initialised
}

func (w *Worker) Run() {
    for v := range w.in { // blocks forever on nil channel
        fmt.Println(v)
    }
}

func main() {
    w := &Worker{}
    go w.Run()

    w.in <- 1 // blocks forever on nil channel
    fmt.Println("done")
}
```

```
fatal error: all goroutines are asleep - deadlock!
```

**What's wrong?** The zero value of `chan T` is `nil`. Sends on a nil channel block forever; receives on a nil channel block forever; `range` over a nil channel blocks forever. There is no panic — just silent stalling. This makes nil-channel bugs harder to spot than closed-channel bugs.

The struct here has a `chan int` field but never initialises it. Any code that touches `w.in` parks immediately.

**Fix:** initialise the channel in a constructor and refuse to expose un-initialised states:

```go
package main

import "fmt"

type Worker struct {
    in chan int
}

func NewWorker(buf int) *Worker {
    return &Worker{in: make(chan int, buf)}
}

func (w *Worker) Run() {
    for v := range w.in {
        fmt.Println(v)
    }
}

func (w *Worker) Send(v int) { w.in <- v }
func (w *Worker) Close()     { close(w.in) }

func main() {
    w := NewWorker(4)
    go w.Run()
    w.Send(1)
    w.Send(2)
    w.Close()
}
```

In production code, prefer constructors (`NewX`) that fully initialise the value. If you must zero-init, document loudly in the type that callers must call `Init()` first — but a constructor is almost always cleaner.

A small bonus: nil channels are useful inside `select`. Setting a case's channel to `nil` disables that case. This is intentional and powerful (Bug 12).

---

## Bug 12 — `select` case that never disables itself

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    ch := make(chan int, 1)
    timeout := time.After(50 * time.Millisecond)

    go func() {
        for i := 0; i < 5; i++ {
            ch <- i
            time.Sleep(20 * time.Millisecond)
        }
        close(ch)
    }()

    for {
        select {
        case v, ok := <-ch:
            if !ok {
                fmt.Println("channel closed")
                return
            }
            fmt.Println("got", v)
        case <-timeout:
            fmt.Println("timeout!")
            // missing: re-arm or exit
        }
    }
}
```

After the timeout fires once, the loop spins. `time.After` returns a channel that, once it has fired, is *closed* (in older Go) or has a permanent value sitting in it (depending on version). Either way the `<-timeout` case becomes immediately selectable on every iteration, starving the data case and printing "timeout!" forever.

**What's wrong?** The author wanted "stop after 50 ms total." But they put the timer outside the loop, so it persists; and they did not handle the case (return, or disable it). After firing, the timer's case is permanently ready, so `select` keeps picking it.

**Fix (1):** exit on timeout:

```go
case <-timeout:
    fmt.Println("timeout!")
    return
```

**Fix (2):** disable the case by setting `timeout` to nil — a nil channel case is never selected:

```go
case <-timeout:
    fmt.Println("first timeout — disabling")
    timeout = nil // this case will not fire again
```

**Fix (3):** if you wanted a per-iteration timeout, recreate the timer inside the loop with `time.NewTimer`:

```go
for {
    t := time.NewTimer(50 * time.Millisecond)
    select {
    case v, ok := <-ch:
        t.Stop()
        if !ok { return }
        fmt.Println("got", v)
    case <-t.C:
        fmt.Println("per-iteration timeout")
        return
    }
}
```

Three legitimate fixes for three different intents. Pick deliberately.

---

## Bug 13 — Buffer of "infinity" via large capacity

```go
package main

import "fmt"

func main() {
    ch := make(chan []byte, 1_000_000)

    go func() {
        for {
            buf := make([]byte, 1024)
            ch <- buf // never blocks until 1 GB of buffers are queued
        }
    }()

    for {
        v := <-ch
        // process slowly
        fmt.Println(len(v))
    }
}
```

The program looks "fast" for a few seconds, then RSS climbs into the gigabytes and the OOM killer steps in.

**What's wrong?** A capacity of one million is not "buffering" — it is a *memory leak with a delay*. Buffered channels are not flow-control: the producer can outrun the consumer indefinitely, accumulating values in the buffer. Each `[]byte{1024}` is 1 KiB; a million of them is 1 GiB of headers plus the slice overhead.

The author tried to avoid the synchronous handshake "for throughput" and ended up with an unbounded queue. The blocking that an unbuffered (or modestly-buffered) channel provides is *backpressure* — it tells the producer to slow down. Removing it is rarely a win.

**Fix:** size the buffer to the actual burst you need to absorb, not to "very large":

```go
package main

import "fmt"

func main() {
    ch := make(chan []byte, 64) // absorbs short bursts; producer waits otherwise

    go func() {
        for {
            buf := make([]byte, 1024)
            ch <- buf // blocks once the consumer falls behind
        }
    }()

    for v := range ch {
        fmt.Println(len(v))
    }
}
```

If you genuinely need a large queue (e.g. you are smoothing a known traffic spike), document the capacity, justify the worst-case memory cost in the comment, and add a metric so an alert can fire when the queue stays above 80 % depth for too long.

---

## Bug 14 — Receive on an empty closed channel returns the zero value

```go
package main

import "fmt"

func main() {
    ch := make(chan int)
    close(ch)

    v := <-ch
    fmt.Println("got", v)        // got 0
    fmt.Println("processing", v) // processes 0 as if it were real data
}
```

**What's wrong?** A receive on a closed, drained channel does not block and does not panic — it returns the zero value of the channel's element type. The author treats the `0` as a real datum. This is one of the most insidious channel bugs: the program "works," it just produces wrong results.

**Fix:** always use the comma-ok form when "channel might be closed" is a real case:

```go
package main

import "fmt"

func main() {
    ch := make(chan int)
    close(ch)

    v, ok := <-ch
    if !ok {
        fmt.Println("channel closed; no more values")
        return
    }
    fmt.Println("got", v)
}
```

Inside `range`, this is automatic — `range` exits on close. The trap is hand-rolled receives. Make the comma-ok form your default outside `range`.

---

## Bug 15 — Wrong assumption that buffered send is "fire-and-forget"

```go
package main

import "fmt"

func sendStat(ch chan<- string, s string) {
    ch <- s // assumes "buffer absorbs it; we move on"
}

func main() {
    ch := make(chan string, 2)
    sendStat(ch, "login")
    sendStat(ch, "click")
    sendStat(ch, "purchase") // blocks: buffer is full, no consumer
    fmt.Println("recorded")
}
```

```
fatal error: all goroutines are asleep - deadlock!
```

**What's wrong?** A buffered channel only absorbs sends *up to its capacity*. After that it blocks. The author treats `chan T` like a logging client with infinite memory. With no consumer running, the third send fills the buffer's last vacancy, and the fourth would block — except `main` does not get to a fourth, the deadlock detector fires anyway because no goroutine can ever drain.

**Fix:** if the channel is meant to absorb without blocking, you need either a consumer or a non-blocking send with a fallback:

```go
package main

import "fmt"

func sendStat(ch chan<- string, s string) {
    select {
    case ch <- s:
        // queued
    default:
        fmt.Println("dropping stat:", s) // back-pressure: drop on overflow
    }
}

func main() {
    ch := make(chan string, 2)
    go func() {
        for s := range ch {
            fmt.Println("stat:", s)
        }
    }()

    sendStat(ch, "login")
    sendStat(ch, "click")
    sendStat(ch, "purchase")
    close(ch)
}
```

Now the producer can never block — it either delivers or drops. For metrics this is usually correct: a dropped stat is far better than a stalled request handler.

The general principle: a buffered channel without a consumer is just deferred deadlock. Pair every buffered channel with a draining strategy.

---

## Bug 16 — Unbuffered channel inside a hot loop

```go
package main

import "fmt"

func main() {
    ch := make(chan int) // unbuffered

    go func() {
        for v := range ch {
            _ = v * v
        }
    }()

    for i := 0; i < 1_000_000; i++ {
        ch <- i // every send rendezvous with the receiver
    }
    close(ch)
    fmt.Println("done")
}
```

The program is correct but slow — orders of magnitude slower than the same workload with even a small buffer.

**What's wrong?** Each unbuffered send forces a goroutine handoff: producer parks, scheduler picks consumer, consumer receives, scheduler picks producer, producer continues. That round-trip dominates the loop. There is no real reason for the synchronous handshake here — the consumer just wants the next value, and it does not matter exactly when.

This is not a correctness bug; it is a *cost* bug that is easy to mistake for "channels are slow." Channels are fine; an unnecessary handshake on every value is not.

**Fix:** buffer the channel just enough to amortise scheduling overhead:

```go
ch := make(chan int, 1024) // any small power of two helps
```

A capacity of a few hundred or a few thousand gives the producer headroom to fill while the consumer drains, eliminating most of the per-message scheduler dance. Benchmark the two and you will typically see 5–20× throughput improvement on this kind of pipeline.

The deeper rule: an unbuffered channel is a synchronisation primitive. If you don't need synchronisation per value, do not pay for it per value.

---

## Bug 17 — Signal channel sized 1 but sent twice

```go
package main

import "fmt"

func main() {
    done := make(chan struct{}, 1)

    go func() {
        // ... work A ...
        done <- struct{}{}
        // ... work B ...
        done <- struct{}{} // expect "buffer is empty by now"
    }()

    <-done
    // forget to receive again until much later
    <-done
    fmt.Println("both signals received")
}
```

If the second `<-done` runs before the goroutine's second send, the order works. If the second send runs while the buffer still holds the first signal (because the receiver was slow), the goroutine blocks. With more complex timing, you get either a deadlock or a never-received second signal.

**What's wrong?** `chan struct{}, 1` is a one-slot buffer, not a counter. Sending twice without a receive in between blocks the sender. The author's mental model is "the buffer absorbs both" — but the buffer only absorbs what fits.

**Fix:** if you really need *N* signals, use `sync.WaitGroup` (cleaner) or close the channel as a fan-out signal (one close = unlimited receivers see it):

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var wg sync.WaitGroup
    wg.Add(2)

    go func() {
        defer wg.Done()
        // work A
    }()
    go func() {
        defer wg.Done()
        // work B
    }()

    wg.Wait()
    fmt.Println("both signals received")
}
```

If the signals come from a single goroutine in sequence, just use two channels — one per signal. They cost nothing and the intent is obvious.

The deeper rule: channels are not counters. `sync.WaitGroup` is.

---

## Bug 18 — Forgotten direction conversion making API mutable

```go
package main

import "fmt"

type Source struct {
    Out chan int // exposed bidirectionally
}

func NewSource() *Source {
    s := &Source{Out: make(chan int, 4)}
    go func() {
        defer close(s.Out)
        for i := 0; i < 3; i++ {
            s.Out <- i
        }
    }()
    return s
}

func main() {
    s := NewSource()
    close(s.Out) // caller closes the producer's channel — undefined behaviour
    for v := range s.Out {
        fmt.Println(v)
    }
}
```

The caller closes the channel out from under the producer, which then panics on its next send.

**What's wrong?** `Out chan int` exposes *both* send and receive on the field. The caller, who should only be receiving, can also send and close. This violates the channel ownership rule (Bug 3 / Bug 8) at the type level.

**Fix:** expose a receive-only channel from the type:

```go
package main

import "fmt"

type Source struct {
    out chan int
}

func NewSource() *Source {
    s := &Source{out: make(chan int, 4)}
    go func() {
        defer close(s.out)
        for i := 0; i < 3; i++ {
            s.out <- i
        }
    }()
    return s
}

// Channel returns a receive-only view callers may range over.
func (s *Source) Channel() <-chan int { return s.out }

func main() {
    s := NewSource()
    for v := range s.Channel() {
        fmt.Println(v)
    }
}
```

The caller can range, receive, and `select`, but it cannot send to or close the channel. The type's authors retain full ownership of writes and lifetime. Same channel underneath; different access at the type system level.

---

## Bug 19 — `len(ch)` used for flow control

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    ch := make(chan int, 10)

    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        for v := range ch {
            fmt.Println(v)
        }
    }()

    for i := 0; i < 100; i++ {
        if len(ch) < cap(ch) { // "is there room?"
            ch <- i
        } else {
            fmt.Println("dropped", i)
        }
    }
    close(ch)
    wg.Wait()
}
```

Items are dropped sporadically even when the consumer is keeping up, and sometimes the program drops nothing on a slow run and lots on a fast one.

**What's wrong?** `len(ch) < cap(ch)` is a non-atomic check followed by a non-atomic action — a classic time-of-check vs time-of-use race. Between the `len` call and the `ch <- i`, the consumer may drain (no longer needed to drop), or another sender (in real-world code) may fill the buffer (drop was correct, but `i` might still block now). Worse, the `len` call is implementation-defined under contention; relying on it is fragile.

**Fix:** use `select` with a `default` for the non-blocking send. The runtime atomically tries the send and falls through if the buffer is full:

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    ch := make(chan int, 10)

    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        for v := range ch {
            fmt.Println(v)
        }
    }()

    for i := 0; i < 100; i++ {
        select {
        case ch <- i:
        default:
            fmt.Println("dropped", i)
        }
    }
    close(ch)
    wg.Wait()
}
```

`len(ch)` is fine for instrumentation ("how full is the queue right now?") but it is not a synchronisation primitive. Use `select` for any control flow.

---

## Bug 20 — Two goroutines, one channel, accidental fan-in collision

```go
package main

import "fmt"

func main() {
    ch := make(chan int)

    // worker A
    go func() {
        for i := 0; i < 5; i++ {
            ch <- i
        }
    }()

    // worker B
    go func() {
        for i := 100; i < 105; i++ {
            ch <- i
        }
    }()

    // expects exactly 10 values then closes
    for i := 0; i < 10; i++ {
        fmt.Println(<-ch)
    }
    close(ch)
}
```

The output is the expected 10 values, but the program panics with `panic: send on closed channel` when the late goroutine tries to send after main closes.

**What's wrong?** The receiver counts 10 values and closes. But "I have received 10 values" is not the same as "all senders have finished sending." If one sender's goroutine is preempted between "decided to send next value" and "actually sends it," `close` runs first, and the late send panics.

**Fix:** let the senders coordinate their own completion, then a closer goroutine closes after they finish (Bug 2 fix applied at scale). Receiver just ranges:

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    ch := make(chan int)
    var wg sync.WaitGroup

    wg.Add(2)
    go func() {
        defer wg.Done()
        for i := 0; i < 5; i++ {
            ch <- i
        }
    }()
    go func() {
        defer wg.Done()
        for i := 100; i < 105; i++ {
            ch <- i
        }
    }()

    go func() {
        wg.Wait()
        close(ch)
    }()

    for v := range ch {
        fmt.Println(v)
    }
}
```

Now `close` runs *after* all sends, the receiver naturally stops on the close, and there is no panic.

The general lesson: receiver-side counting is fragile because the receiver does not know the producers' state. Producers know when they are done. Make them say so via WaitGroup, then close as a join.

---

## Cross-Cutting Patterns

Reading those twenty bugs back to back, four rules surface:

1. **The sender owns the channel.** It creates, sends, and closes. Receivers do not close. Multiple senders coordinate via a WaitGroup and a single closer goroutine.
2. **Unbuffered = handshake. Buffered = small queue with backpressure. Neither is "infinite."** Never use a giant capacity to "avoid blocking." Either you need synchronisation or you do not — pick deliberately.
3. **Use the comma-ok form on receives outside `range`.** `v := <-ch` silently returns zero on a closed channel.
4. **Goroutines that send to (or receive from) a channel must always have a way out.** A `context.Context`, a `done` channel, or a buffered slot for one final value. "Block forever" is rarely what you want.

If a channel bug bites you in production and is not on this list, it is almost always a violation of one of those four rules. Read the failing code with them in mind and the fix usually appears immediately.
