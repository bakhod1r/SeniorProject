# Channel Close Violations — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Multi-Sender Close Theorem](#the-multi-sender-close-theorem)
3. [Pattern A: Coordinator with WaitGroup](#pattern-a-coordinator-with-waitgroup)
4. [Pattern B: `sync.Once` Wrapper](#pattern-b-synconce-wrapper)
5. [Pattern C: Done Channel (Never Close Data)](#pattern-c-done-channel-never-close-data)
6. [Pattern D: Mutex + Closed-Flag State Machine](#pattern-d-mutex--closed-flag-state-machine)
7. [Pattern E: Single-Goroutine Owner](#pattern-e-single-goroutine-owner)
8. [Cascading Close in Pipelines](#cascading-close-in-pipelines)
9. [Close with `context.Context`](#close-with-contextcontext)
10. [Integrating with `errgroup`](#integrating-with-errgroup)
11. [Defensive `recover` Around Close](#defensive-recover-around-close)
12. [Race-Window Analysis](#race-window-analysis)
13. [Library API: Returning a Closable Channel](#library-api-returning-a-closable-channel)
14. [Testing Close Behaviour](#testing-close-behaviour)
15. [Decision Table: Which Safe Pattern When](#decision-table-which-safe-pattern-when)
16. [Common Multi-Sender Mistakes](#common-multi-sender-mistakes)
17. [Self-Assessment](#self-assessment)
18. [Summary](#summary)

---

## Introduction

At junior level we listed the five rules and the four safe patterns. This file goes deeper into the multi-sender problem — which is where every close-related panic in production really comes from — and presents the five patterns you can mix and match to solve any close-coordination problem you will meet.

We also cover what most introductory material skips: how to integrate close cleanly with `context.Context` and `errgroup`, how to write a closable library API without leaking the close to callers, how to test close behaviour deterministically, and how to reason about the race window between "last send" and "close".

---

## The Multi-Sender Close Theorem

A channel can be safely closed if and only if these three properties hold simultaneously:

1. **Single closer.** Exactly one goroutine executes `close(ch)`. Multiple closers risk Rule 2.
2. **No live senders at close time.** Every sender has either finished sending or learned that it must stop. A sender mid-send when close fires triggers Rule 3.
3. **Receivers indifferent.** Receivers must be safe under both "more data coming" and "no more data". `for range` and `comma-ok` satisfy this automatically.

Each of the five patterns below is a different mechanism for enforcing properties 1 and 2. They differ in cost, in scaling, and in how they handle errors and cancellation.

---

## Pattern A: Coordinator with WaitGroup

The canonical multi-sender solution. Spawn one extra goroutine whose only job is to wait for all senders to finish and then close.

```go
package main

import (
    "fmt"
    "sync"
)

func fanIn(srcs ...<-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    for _, src := range srcs {
        wg.Add(1)
        go func(s <-chan int) {
            defer wg.Done()
            for v := range s {
                out <- v
            }
        }(src)
    }
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}

func gen(start, n int) <-chan int {
    ch := make(chan int)
    go func() {
        defer close(ch)
        for i := 0; i < n; i++ {
            ch <- start + i
        }
    }()
    return ch
}

func main() {
    out := fanIn(gen(0, 5), gen(100, 5), gen(200, 5))
    for v := range out {
        fmt.Println(v)
    }
}
```

**Why it satisfies the theorem.**

- Single closer: the dedicated coordinator goroutine.
- No live senders at close: `wg.Wait()` blocks until every sender goroutine has called `wg.Done()`. Since `wg.Done()` is the last statement of each sender, the coordinator wakes only after all sends are complete.

**Cost.** One extra goroutine (about 4 KB stack) and one `sync.WaitGroup` (small). Negligible.

**Scaling.** Works for any N senders. The coordinator's overhead does not grow with N; only `wg.Wait()` becomes marginally slower with more counters, but the difference is unobservable below thousands of senders.

**Caveat.** `wg.Add(1)` must happen *in the parent goroutine before* the `go` statement, not inside the launched goroutine. Otherwise the coordinator may call `Wait()` before any `Add()` has run, observe count = 0, and close prematurely.

**Variant.** If senders themselves spawn child senders, those children must `Add` to the same `WaitGroup`. Or — better — wrap the child-spawning into the parent's `Add` accounting.

---

## Pattern B: `sync.Once` Wrapper

When close can be triggered from multiple unrelated code paths (shutdown, error, signal, timeout), `sync.Once` makes close idempotent without coordinating the paths explicitly.

```go
package main

import (
    "fmt"
    "sync"
)

type Stream struct {
    Ch        chan int
    closeOnce sync.Once
}

func New() *Stream {
    return &Stream{Ch: make(chan int)}
}

func (s *Stream) Close() {
    s.closeOnce.Do(func() { close(s.Ch) })
}

func (s *Stream) Send(v int) (sent bool) {
    defer func() {
        if r := recover(); r != nil {
            sent = false
        }
    }()
    s.Ch <- v
    return true
}

func main() {
    s := New()
    go func() {
        defer s.Close()
        for i := 0; i < 3; i++ {
            if !s.Send(i) {
                return
            }
        }
    }()
    s.Close() // race with the goroutine's close — still safe

    for v := range s.Ch {
        fmt.Println(v)
    }
}
```

Three things to notice:

1. `closeOnce.Do(func() { close(s.Ch) })` is the standard idempotent-close idiom.
2. `Send` recovers from `send on closed channel`. This is the *only* recover that is sometimes defensible — when the producer cannot otherwise know that the channel was closed concurrently. Use sparingly; see Section 11.
3. We still get one of the three outcomes: every value sent and received, or fewer values if close races send. Neither side panics fatally.

**When to use.**

- Multiple close call sites, hard to coordinate.
- The closing is a "best-effort cleanup" rather than a precise end-of-stream signal.

**When not to use.**

- When you actually know who closes (use Pattern A or E).
- When the recover around send hides bugs (use Pattern C — done channel).

---

## Pattern C: Done Channel (Never Close Data)

The cleanest pattern for cancellation. The data channel is closed only by its sole owner — typically the producer. Cancellation is signalled via a separate `done` channel.

```go
package main

import "fmt"

func producer(done <-chan struct{}) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 0; ; i++ {
            select {
            case out <- i:
            case <-done:
                return
            }
        }
    }()
    return out
}

func main() {
    done := make(chan struct{})
    stream := producer(done)

    for v := range stream {
        if v == 10 {
            close(done) // tell producer to stop
            break
        }
        fmt.Println(v)
    }
    // drain to let producer exit
    for range stream {
    }
}
```

**Why it satisfies the theorem.**

- The data channel `out` is closed only by its single sender goroutine.
- The `done` channel is closed only by the consumer, and nobody sends on `done`, so no send-on-closed risk.
- Closing `done` unblocks any number of waiters at once (broadcast).

**Trade-offs.**

- The producer must check `done` in every send; we do this with `select`.
- The consumer must drain the stream after closing `done`, otherwise the producer can block on its next `select` send (if the data channel buffer is full).

This is the pattern `context.Context` uses internally. We will replace the bespoke `done` with `ctx.Done()` in Section 9.

---

## Pattern D: Mutex + Closed-Flag State Machine

When you also need to *query* the closed state — for example, to skip work or to log "closed already" — a mutex plus boolean flag works:

```go
type Closable struct {
    mu     sync.Mutex
    ch     chan struct{}
    closed bool
}

func New() *Closable {
    return &Closable{ch: make(chan struct{})}
}

func (c *Closable) Close() {
    c.mu.Lock()
    defer c.mu.Unlock()
    if c.closed {
        return
    }
    c.closed = true
    close(c.ch)
}

func (c *Closable) IsClosed() bool {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.closed
}

func (c *Closable) Done() <-chan struct{} {
    return c.ch
}
```

Functionally equivalent to `sync.Once` plus an explicit `closed` field. The mutex is more flexible: you can hold it across multiple state transitions, log inside the critical section, or expose `IsClosed`.

`sync.Once` is slightly faster and zero-allocation, but `sync.Once` does not expose "did it run?" — you would need the boolean anyway. If you need the boolean, this pattern is cleaner.

**Variant: atomic flag for lock-free reads.**

```go
type Closable struct {
    ch     chan struct{}
    closed atomic.Bool
    once   sync.Once
}

func (c *Closable) Close() {
    c.once.Do(func() {
        c.closed.Store(true)
        close(c.ch)
    })
}

func (c *Closable) IsClosed() bool { return c.closed.Load() }
```

`IsClosed` becomes lock-free. Useful when many goroutines poll it.

---

## Pattern E: Single-Goroutine Owner

When the design allows it, push *all* channel operations through a single owner goroutine. Other code talks to the owner via input channels; the owner is the only entity that sends on the output channel, and the only entity that closes.

```go
type Service struct {
    inbox chan request
}

type request struct {
    payload string
    reply   chan int
}

func NewService() *Service {
    s := &Service{inbox: make(chan request)}
    go s.run()
    return s
}

func (s *Service) run() {
    out := make(chan int)
    defer close(out)
    for req := range s.inbox {
        // do work, send result
        req.reply <- len(req.payload)
    }
}

func (s *Service) Shutdown() {
    close(s.inbox) // safe: only callers send on inbox, only one closer
}
```

The owner goroutine is the sole sender on `out` and the sole closer of `out`. Multiple producers feed `inbox`, but `inbox` is closed only by `Shutdown`, which is itself an externally-coordinated operation (often wrapped with `sync.Once`).

**When to use.**

- Long-lived services with a clear "lifecycle owner".
- Designs where state must remain serialised inside one goroutine ("share by communicating").

**When not to use.**

- Hot paths where the extra serialisation bottlenecks throughput.
- Cases where you have many short-lived data channels (use Pattern A instead).

---

## Cascading Close in Pipelines

A pipeline is a chain of stages, each consuming from the previous and producing to the next. The natural close protocol is "when my upstream closes its output, I finish my work and close my own output".

```go
package main

import "fmt"

func source() <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 0; i < 10; i++ {
            out <- i
        }
    }()
    return out
}

func square(in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for v := range in {
            out <- v * v
        }
    }()
    return out
}

func sink(in <-chan int) {
    for v := range in {
        fmt.Println(v)
    }
}

func main() {
    sink(square(source()))
}
```

Each stage is a single-sender for its output. When upstream's `range` returns (because upstream closed), the stage's loop exits and the `defer close(out)` runs. Close cascades cleanly from source to sink.

**Adding cancellation.** With a `done` channel, every stage's send must `select` against `done`:

```go
func square(done <-chan struct{}, in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for v := range in {
            select {
            case out <- v * v:
            case <-done:
                return
            }
        }
    }()
    return out
}
```

Close on `done` causes every stage to exit early. Each stage still closes its own output through `defer close(out)`. The pipeline drains gracefully.

---

## Close with `context.Context`

`context.Context` is just a sophisticated done-channel. `ctx.Done()` returns a `<-chan struct{}` that closes when the context is cancelled.

```go
func produce(ctx context.Context) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 0; ; i++ {
            select {
            case out <- i:
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}
```

Three properties of `ctx.Done()` that make it the right tool for cancellation:

- It is closed exactly once, by the context's cancel func or by a deadline expiry.
- It is closed by the context library, not by application code, so application code cannot accidentally double-close it.
- It propagates: a child context closes when its parent closes.

When in doubt, use `context.Context` rather than a bespoke `done` channel. The semantics are the same; the discipline of using `context.WithCancel`/`context.WithTimeout` makes ownership explicit.

---

## Integrating with `errgroup`

`errgroup.Group` adds error propagation and cancellation to `WaitGroup`. For a pipeline that may fail at any stage, `errgroup` plus context replaces both the coordinator goroutine and the done channel.

```go
package main

import (
    "context"
    "errors"
    "fmt"

    "golang.org/x/sync/errgroup"
)

func pipeline(ctx context.Context) error {
    g, ctx := errgroup.WithContext(ctx)
    out := make(chan int)

    g.Go(func() error {
        defer close(out)
        for i := 0; i < 100; i++ {
            select {
            case out <- i:
            case <-ctx.Done():
                return ctx.Err()
            }
        }
        return nil
    })

    g.Go(func() error {
        for v := range out {
            if v == 42 {
                return errors.New("found 42")
            }
        }
        return nil
    })

    if err := g.Wait(); err != nil {
        return err
    }
    fmt.Println("done")
    return nil
}
```

Three properties:

- The producer closes `out` via `defer`. Single sender, single closer.
- The consumer returns an error; `errgroup` cancels `ctx`; the producer's `select` sees `ctx.Done()` and exits.
- `g.Wait()` blocks until both goroutines have returned, so we know the pipeline is fully drained when `Wait()` returns.

`errgroup` is what most production pipelines reach for after they outgrow plain `sync.WaitGroup`.

---

## Defensive `recover` Around Close

You will see this pattern in older code:

```go
func safeSend(ch chan int, v int) (sent bool) {
    defer func() {
        if r := recover(); r != nil {
            sent = false
        }
    }()
    ch <- v
    return true
}
```

It works: a send on a closed channel panics, the deferred `recover` catches the panic, and the caller learns that the send failed.

But it is a code smell because:

- The panic-and-recover dance is much more expensive than a `select` against a done channel.
- The producer cannot distinguish "channel closed" from "any other panic", so other bugs are silently absorbed.
- It hides the design problem ("why is somebody else closing the channel my producer owns?") rather than fixing it.

Use it only when you cannot redesign — typically when adapting third-party APIs that close a channel without telling you. In application code, prefer Pattern C (done channel) or `context.Context`.

---

## Race-Window Analysis

The hardest close bugs are race windows: a window of nanoseconds during which a send and a close are both eligible to fire.

Consider:

```go
func (s *Service) Stop() {
    close(s.done)
    close(s.work) // race with workers still sending on work
}
```

The author wanted "first signal stop, then close the work queue". But between line 2 and line 3, workers may still be in the middle of sending on `work`. The window is small but real, and it grows under load.

**Diagnosis.** Run with `-race`. The race detector will flag concurrent close-send memory accesses to the same channel even though the panic is a runtime check.

**Fix.** Make close-of-`work` follow workers' exit, not precede it:

```go
func (s *Service) Stop() {
    close(s.done)        // tell workers to stop
    s.workersWG.Wait()   // wait for them all to return
    close(s.work)        // safe now: no senders left
}
```

Or skip closing `work` entirely if nothing depends on the close. Many "for cleanliness" closes are unnecessary; the channel will be garbage-collected when no goroutine references it.

---

## Library API: Returning a Closable Channel

When you write a library that produces a stream, the typical API is:

```go
func Stream() <-chan int
```

The receive-only return type tells callers "you cannot send, you cannot close". This is exactly what you want. Inside the function, your single sender goroutine closes the channel.

If callers must be able to cancel, take a `context.Context`:

```go
func Stream(ctx context.Context) <-chan int
```

The caller cancels the context; the library's sender exits and closes the channel. The caller never touches close.

Anti-pattern: exposing the channel as bidirectional just so callers can close it:

```go
func Stream() chan int // BAD
```

Now the caller can close. The library has lost control of its own close protocol. If two callers both close, panic. Avoid.

**Variant.** If the library has multiple termination conditions (graceful shutdown, force shutdown), expose a `Close()` method that wraps the close logic safely:

```go
type Streamer struct {
    out  chan int
    done chan struct{}
    once sync.Once
}

func (s *Streamer) Out() <-chan int { return s.out }
func (s *Streamer) Close()          { s.once.Do(func() { close(s.done) }) }
```

The caller cannot close `out`; they can only call `Close()`, which is idempotent. Internally, the streamer goroutine watches `done` and closes `out` when it exits.

---

## Testing Close Behaviour

Three test idioms cover most close-correctness work.

**1. Verify close completes the range.**

```go
func TestCloseDrains(t *testing.T) {
    ch := producer(3)
    var got []int
    for v := range ch {
        got = append(got, v)
    }
    if len(got) != 3 {
        t.Errorf("expected 3 values, got %d", len(got))
    }
}
```

If `producer` forgets to close, the test deadlocks. Run with `-timeout 5s` so deadlocks become test failures rather than hanging CI.

**2. Verify cancellation closes the stream.**

```go
func TestCancelClosesStream(t *testing.T) {
    ctx, cancel := context.WithCancel(context.Background())
    ch := streamer(ctx)
    cancel()
    timer := time.After(time.Second)
    for {
        select {
        case _, ok := <-ch:
            if !ok {
                return // closed; pass
            }
        case <-timer:
            t.Fatal("stream did not close after cancel")
        }
    }
}
```

**3. Stress test for race-window panics.**

```go
func TestNoDoubleClose(t *testing.T) {
    for i := 0; i < 10000; i++ {
        s := New()
        var wg sync.WaitGroup
        for j := 0; j < 10; j++ {
            wg.Add(1)
            go func() {
                defer wg.Done()
                s.Close()
            }()
        }
        wg.Wait()
    }
}
```

10 000 iterations × 10 concurrent closers. If `Close` is not idempotent, the test panics. Combined with `-race`, this catches most close-coordination bugs.

---

## Decision Table: Which Safe Pattern When

| Scenario                                              | Pattern             |
| ----------------------------------------------------- | ------------------- |
| One producer, one channel                             | Single-sender close (A.junior) |
| N producers, fan-in, known N                          | Coordinator + WaitGroup (A)    |
| Multiple unrelated paths might trigger close          | `sync.Once` (B)     |
| Cancellation from consumer to producer                | Done channel (C)    |
| Need `IsClosed()` query                               | Mutex state machine (D) |
| All state through one goroutine                       | Single owner (E)    |
| Cancellation across many stages                       | `context.Context`   |
| Pipeline with errors                                  | `errgroup` + ctx    |

When more than one row applies, prefer the higher row in the table — they tend to be simpler.

---

## Common Multi-Sender Mistakes

1. **Each sender defers close.** Whichever finishes first closes; rest panic. Use Pattern A.
2. **Receiver closes "to free producer".** Producer panics on next send. Use Pattern C.
3. **Coordinator uses `wg.Add` inside the goroutine.** Race: `wg.Wait` may see 0 before any `Add` runs. Always `Add` in the parent.
4. **Close inside the WaitGroup-counted goroutine.** The deferred `close` runs before `wg.Done` only if you `defer` in reverse order, but typically the close belongs to the coordinator, not any worker.
5. **Close-then-send "for cleanliness".** Closing channels you do not need to close is harmless; closing while senders are alive is fatal. When in doubt, leave the channel uncovered.

---

## Self-Assessment

1. State the multi-sender close theorem in your own words.
2. Compare Patterns A and B: which is preferable when, and why?
3. Why do we say "never close a data channel from the consumer side"?
4. How does `context.Context` make Pattern C cleaner?
5. Write a one-paragraph proof that the `errgroup` example above never panics on close.
6. What does the race detector tell you about a close-send race, and what does it not tell you?
7. Why is `recover` around `send` a code smell?
8. In Pattern E, what would happen if two goroutines called `Shutdown` simultaneously? Fix it.

---

## Summary

- Multi-sender close requires one closer running after every sender finishes.
- Five patterns cover the space: coordinator + WaitGroup, `sync.Once`, done channel, mutex state machine, single owner.
- `context.Context` is the standard form of the done channel for cancellation.
- `errgroup` plus context replaces the coordinator and the done channel for pipelines.
- Defensive `recover` around send works but hides design problems; prefer redesign.
- Race windows between last-send and close are the most common cause of panics in older code; the cure is to wait for workers to exit before closing their input.
- Library APIs should return receive-only channels and expose `Close()` methods that are idempotent.
- Test close correctness with three idioms: drain, cancel-and-observe, and stress.

Next: the senior file goes into pipeline cascade in detail, library-grade close helpers, and the runtime view of close.
