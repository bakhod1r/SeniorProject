# Closing Channels — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Multi-Sender Problem](#the-multi-sender-problem)
3. [Pattern 1: Synchronising Closer](#pattern-1-synchronising-closer)
4. [Pattern 2: `sync.Once` for Idempotent Close](#pattern-2-synconce-for-idempotent-close)
5. [Pattern 3: Separate Done Channel (Never Close the Data Channel)](#pattern-3-separate-done-channel-never-close-the-data-channel)
6. [Pattern 4: `WaitGroup` then Close](#pattern-4-waitgroup-then-close)
7. [Pattern 5: Coordinator Goroutine](#pattern-5-coordinator-goroutine)
8. [Generator Pattern in Depth](#generator-pattern-in-depth)
9. [Broadcast Pattern in Depth](#broadcast-pattern-in-depth)
10. [Pipelines and Cascading Close](#pipelines-and-cascading-close)
11. [Fan-In with Close](#fan-in-with-close)
12. [Fan-Out with Close](#fan-out-with-close)
13. [Close and `context.Context`](#close-and-contextcontext)
14. [Defensive Close with Recover](#defensive-close-with-recover)
15. [Testing Close Behaviour](#testing-close-behaviour)
16. [Common Antipatterns](#common-antipatterns)
17. [Decision Table: Which Pattern When](#decision-table-which-pattern-when)
18. [Self-Assessment](#self-assessment)
19. [Summary](#summary)

---

## Introduction

At junior level we learned the rules: close on a closed channel panics, send on closed panics, close on nil panics, and only the sender closes. Those rules cover one-sender scenarios perfectly.

The moment you have **two or more senders**, the rule "the sender closes" fragments. *Which* sender closes? If both close, you panic. If neither closes, you leak. If one closes while the other is mid-send, that other sender panics.

This file is about the multi-sender close problem and its half-dozen idiomatic solutions. Each solution has a flavour, a cost, and a domain where it shines. By the end you will know which one to reach for in any given situation.

After reading this file you will:

- Recognise the multi-sender problem in any concurrent design.
- Apply five distinct close-safety patterns with confidence.
- Build robust pipelines whose stages close cleanly in order.
- Combine close with `context.Context` for cooperative cancellation.
- Test close behaviour without flakiness.
- Avoid the three antipatterns that look correct but are not.

---

## The Multi-Sender Problem

Consider:

```go
ch := make(chan int)
var wg sync.WaitGroup
for i := 0; i < 5; i++ {
    wg.Add(1)
    go func(id int) {
        defer wg.Done()
        for j := 0; j < 10; j++ {
            ch <- id*10 + j
        }
        // who closes ch?
    }(i)
}
```

Five senders. Each sends 10 values, then exits. Total 50 values across the channel. The consumer wants to `for v := range ch { ... }` and have the loop exit when all 50 have arrived.

For the loop to exit, the channel must be closed. The question is: by whom?

### Attempt 1: each sender closes (broken)

```go
go func(id int) {
    defer wg.Done()
    defer close(ch) // first sender to finish closes; rest panic
    for j := 0; j < 10; j++ {
        ch <- id*10 + j
    }
}(i)
```

Five senders, five `close(ch)` calls. After the first close, the next four panic with "close of closed channel." If any sender is still mid-send when another closes, that one panics with "send on closed channel." Catastrophic.

### Attempt 2: receiver closes (broken)

```go
go func() {
    for v := range ch {
        process(v)
    }
}()
close(ch) // but when? receiver never knows "no more senders"
```

The receiver does not know there are five senders, nor when they all finish. Closing here is guesswork.

### Attempt 3: defer in main (broken if senders use the channel after main starts wait)

```go
defer close(ch)
wg.Wait()
```

`defer` fires on return from `main`. `wg.Wait()` blocks until all senders finish. But this defers `close` after `Wait` — so close runs after senders are done. Almost right, but the receiver, in another goroutine using `for range`, needs the close to know to exit. Sequencing is fragile.

### The right framing

Multi-sender close requires a **single closer** synchronised against **all senders being done**. The patterns below all answer those two requirements in different ways.

---

## Pattern 1: Synchronising Closer

The simplest, most idiomatic answer for "N senders, one channel": spawn a coordinator goroutine that waits for all senders to finish, then closes.

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    ch := make(chan int)
    var wg sync.WaitGroup

    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            for j := 0; j < 10; j++ {
                ch <- id*10 + j
            }
        }(i)
    }

    go func() {
        wg.Wait()
        close(ch)
    }()

    total := 0
    for v := range ch {
        _ = v
        total++
    }
    fmt.Println("received", total)
}
```

**How it works.**

1. Each sender `Add(1)` (in the parent) and `defer Done()` (in the goroutine).
2. A separate "closer" goroutine waits for *all* senders' `Done()` via `wg.Wait()`.
3. After `Wait` returns, no sender is left; the closer calls `close(ch)`.
4. The consumer's `for range ch` exits when the channel closes.

**Why it works.**

- Single closer goroutine: no double-close.
- `wg.Wait()` guarantees all sends are complete before close: no send-on-closed.
- The closer runs in its own goroutine: `main` does not block waiting to close; the consumer's `for range` and the closer's `wg.Wait` proceed in parallel.

**When to use.**

- Default for multi-sender designs with a known sender population.
- Static fan-in: a fixed N of producers feeding one consumer.

**Caveats.**

- `wg.Add` must happen in the parent before `go`, otherwise `Wait` may return before any goroutine has been counted.
- If senders themselves spawn child goroutines that send on `ch`, those must also be added to the same `WaitGroup` (or use a different shutdown coordination).

---

## Pattern 2: `sync.Once` for Idempotent Close

When multiple code paths might trigger a close — e.g. "close on error from any sender, or on normal completion" — `sync.Once` makes close idempotent.

```go
package main

import (
    "fmt"
    "sync"
)

type SafeChannel struct {
    Ch    chan int
    once  sync.Once
}

func (s *SafeChannel) Close() {
    s.once.Do(func() { close(s.Ch) })
}

func main() {
    s := &SafeChannel{Ch: make(chan int, 10)}
    var wg sync.WaitGroup

    for i := 0; i < 3; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            for j := 0; j < 5; j++ {
                s.Ch <- id*100 + j
            }
            if id == 0 {
                s.Close() // any sender can request close — only first wins
            }
        }(i)
    }

    go func() {
        wg.Wait()
        s.Close() // safety net
    }()

    for v := range s.Ch {
        fmt.Println(v)
    }
}
```

**How it works.**

- `sync.Once.Do(f)` runs `f` exactly once. Subsequent calls are no-ops.
- Wrapping `close(ch)` in `once.Do` makes it safe to call multiple times.
- The "first" caller wins; the rest do nothing.

**Why it's not enough by itself.**

- `Once` prevents double-close but does **not** prevent send-on-closed. If sender A closes while sender B is mid-send, sender B still panics.
- For full safety you must also ensure no send happens after the close — typically by stopping senders before closing.

**When to use.**

- An owner can call `Close()` multiple times in cleanup paths (defers in nested scopes).
- A library exposes a `Close()` method that callers might invoke from anywhere.
- Combine with a separate "stop" mechanism so senders stop before close.

**Caveats.**

- `Once` is not a substitute for proper shutdown ordering. It is a safety net.
- The "sender after close" problem is *unsolved* by `Once`. You need a *separate* mechanism to make senders stop before close.

---

## Pattern 3: Separate Done Channel (Never Close the Data Channel)

If you cannot guarantee "no sends after close," the simplest answer is **never close the data channel**. Instead, use a separate `done` channel as the shutdown signal.

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    data := make(chan int)
    done := make(chan struct{})
    var wg sync.WaitGroup

    for i := 0; i < 3; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            for j := 0; ; j++ {
                select {
                case <-done:
                    return
                case data <- id*100 + j:
                }
            }
        }(i)
    }

    // consumer reads until satisfied, then signals done
    received := 0
    for v := range data {
        _ = v
        received++
        if received >= 20 {
            close(done)
            break
        }
    }

    // drain remaining sends that were in-flight when done closed
    go func() {
        for range data {
        }
    }()

    wg.Wait()
    close(data) // safe now: all senders have returned
    fmt.Println("received", received)
}
```

**How it works.**

- The data channel `data` is never closed by anyone except after all senders exit.
- The `done` channel is the shutdown signal; closing it tells senders to stop.
- Each sender uses `select` with `case <-done: return` so it cannot get stuck.
- The consumer signals `close(done)` when it is done.

**Why it works.**

- Senders observe `done` close before they panic on `data`. Their next iteration's `select` picks the `done` case.
- `data` is only closed *after* `wg.Wait()` proves all senders have returned.

**When to use.**

- Multiple senders, dynamic sender population, no central coordinator possible.
- Pipelines with cancellation: the upstream stage can stop on signal.
- This is the most general-purpose pattern.

**Caveats.**

- A bit more boilerplate per sender (`select` in every iteration).
- The consumer must remember to drain after signalling done, to unblock any sender mid-send.

This is the pattern behind `context.Context.Done()`, just generalised.

---

## Pattern 4: `WaitGroup` then Close

A slightly tighter version of Pattern 1, often seen in tutorials:

```go
func process(items []Item) []Result {
    in := make(chan Item)
    out := make(chan Result)
    var wg sync.WaitGroup

    for i := 0; i < numWorkers; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for item := range in {
                out <- transform(item)
            }
        }()
    }

    go func() {
        for _, item := range items {
            in <- item
        }
        close(in) // single sender (the dispatcher) closes the input channel
    }()

    go func() {
        wg.Wait()
        close(out) // closer waits for all workers to finish, then closes output
    }()

    var results []Result
    for r := range out {
        results = append(results, r)
    }
    return results
}
```

**Two distinct close events.**

- `close(in)` — done by the **single dispatcher** that sends inputs. Pattern: one sender, defer close. Workers' `for range in` exits cleanly.
- `close(out)` — done by the **synchronising closer** that waits for all workers via `wg`. Pattern 1 again.

This is the canonical worker pool with bounded fan-in and bounded fan-out. We cover worker pools in depth in `03-worker-pools`.

---

## Pattern 5: Coordinator Goroutine

When senders are dynamic (started or stopped at runtime), put close ownership behind a coordinator that manages all sender lifecycle.

```go
type Stream struct {
    out    chan int
    addCh  chan func()
    doneCh chan struct{}
}

func NewStream() *Stream {
    s := &Stream{
        out:    make(chan int),
        addCh:  make(chan func()),
        doneCh: make(chan struct{}),
    }
    go s.run()
    return s
}

func (s *Stream) run() {
    var wg sync.WaitGroup
    for {
        select {
        case work := <-s.addCh:
            wg.Add(1)
            go func() {
                defer wg.Done()
                work()
            }()
        case <-s.doneCh:
            wg.Wait()
            close(s.out)
            return
        }
    }
}

func (s *Stream) Add(work func()) { s.addCh <- work }
func (s *Stream) Done()           { close(s.doneCh) }
func (s *Stream) Out() <-chan int { return s.out }
```

The coordinator owns the channel. Adding new senders is funnelled through `addCh`. Shutdown is signalled through `doneCh`. The coordinator alone closes `s.out` after waiting for all senders.

**When to use.**

- Dynamic sender population.
- Library exposing a "stream" or "topic" abstraction.
- Need a single point of control for lifecycle.

**Caveats.**

- More machinery; only use when simpler patterns don't fit.
- The coordinator goroutine itself must be reliably reachable for shutdown.

---

## Generator Pattern in Depth

The generator pattern produces a sequence on a channel and closes when the sequence ends. The simplest concurrency abstraction.

```go
func nums(max int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 0; i < max; i++ {
            out <- i
        }
    }()
    return out
}

for n := range nums(10) {
    fmt.Println(n)
}
```

### Generators that may be cancelled

```go
func nums(ctx context.Context, max int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 0; i < max; i++ {
            select {
            case <-ctx.Done():
                return
            case out <- i:
            }
        }
    }()
    return out
}
```

The generator now cooperates with cancellation. If the caller cancels the context, the goroutine exits and closes the channel. The caller's `for range` then exits because the channel closed.

### Generators with errors

```go
type intOrErr struct {
    v   int
    err error
}

func nums(max int) <-chan intOrErr {
    out := make(chan intOrErr)
    go func() {
        defer close(out)
        for i := 0; i < max; i++ {
            v, err := compute(i)
            out <- intOrErr{v, err}
            if err != nil {
                return
            }
        }
    }()
    return out
}
```

The generator wraps values with errors. The consumer ranges over results and stops on the first non-nil error.

### Chained generators

```go
func ints() <-chan int { /* yields 0..N */ }
func squares() <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for x := range ints() {
            out <- x * x
        }
    }()
    return out
}
```

The output channel closes naturally when the input channel closes. Closure cascades down the chain — the foundation of pipelines.

---

## Broadcast Pattern in Depth

A closed channel as a fan-out signal:

```go
type Stopper struct {
    done chan struct{}
    once sync.Once
}

func (s *Stopper) Stop()    { s.once.Do(func() { close(s.done) }) }
func (s *Stopper) Done() <-chan struct{} { return s.done }

func worker(id int, s *Stopper) {
    for {
        select {
        case <-s.Done():
            fmt.Println("worker", id, "stopping")
            return
        case <-time.After(100 * time.Millisecond):
            // do periodic work
        }
    }
}

func main() {
    s := &Stopper{done: make(chan struct{})}
    for i := 0; i < 100; i++ {
        go worker(i, s)
    }
    time.Sleep(500 * time.Millisecond)
    s.Stop() // wakes all 100 workers at once
    time.Sleep(200 * time.Millisecond)
}
```

**Key properties.**

- `Stop()` is idempotent thanks to `sync.Once`.
- One `close` wakes every receiver. The cost is constant in number of receivers; the runtime walks the receiver queue.
- The signal is permanent. After `Stop`, every new `<-s.Done()` returns immediately. Late-arriving goroutines see the signal too.

This is exactly the pattern `context.Context.Done()` uses internally.

---

## Pipelines and Cascading Close

A pipeline is a chain of generators. Each stage's output is the next stage's input. The discipline:

1. Each stage owns its output channel (creates, sends to, closes).
2. Each stage closes its output when its input closes.
3. The "source" stage closes its output when the source data is exhausted.
4. Cancellation propagates by closing a shared done channel that every stage `select`s on.

```go
func source(ctx context.Context, nums []int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for _, n := range nums {
            select {
            case <-ctx.Done():
                return
            case out <- n:
            }
        }
    }()
    return out
}

func square(ctx context.Context, in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for n := range in {
            select {
            case <-ctx.Done():
                return
            case out <- n * n:
            }
        }
    }()
    return out
}

func sum(ctx context.Context, in <-chan int) int {
    total := 0
    for n := range in {
        total += n
    }
    return total
}

func main() {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()
    nums := source(ctx, []int{1, 2, 3, 4, 5})
    squares := square(ctx, nums)
    fmt.Println(sum(ctx, squares))
}
```

**Why this works.**

- If `source` finishes naturally, it closes its output. `square` sees the close on its input, closes its output. `sum`'s range exits.
- If `cancel()` is called, every stage's `select` picks `ctx.Done()` and returns, closing its output via `defer`. Closure still cascades down.

The result: a pipeline with **predictable cleanup on both completion and cancellation**.

---

## Fan-In with Close

Multiple producers, one consumer. The classic merge pattern:

```go
func merge(cs ...<-chan int) <-chan int {
    var wg sync.WaitGroup
    out := make(chan int)

    output := func(c <-chan int) {
        defer wg.Done()
        for n := range c {
            out <- n
        }
    }

    wg.Add(len(cs))
    for _, c := range cs {
        go output(c)
    }

    go func() {
        wg.Wait()
        close(out)
    }()

    return out
}
```

This is Pattern 1 applied to channel merging. Each input goroutine reads from one input channel; the synchronising closer waits for all of them, then closes the output.

If any input never closes, the merge never closes either — the bug propagates.

---

## Fan-Out with Close

One producer, multiple consumers. Two flavours:

### Fan-out via shared channel (consumers race for items)

```go
func work(jobs <-chan Job, results chan<- Result) {
    for j := range jobs {
        results <- process(j)
    }
}

func main() {
    jobs := make(chan Job)
    results := make(chan Result)
    var wg sync.WaitGroup
    for i := 0; i < 8; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            work(jobs, results)
        }()
    }

    go func() {
        for _, j := range inputJobs {
            jobs <- j
        }
        close(jobs) // one sender, defer close OK
    }()

    go func() {
        wg.Wait()
        close(results) // synchronising closer for results
    }()

    for r := range results {
        process(r)
    }
}
```

Each consumer reads one job; jobs are partitioned across consumers. Close on `jobs` propagates to all consumers (each `for range jobs` exits when drained).

### Fan-out via broadcast (every consumer sees every item)

A channel cannot broadcast values; a `close` can. For value broadcast, use either `sync.Cond` or a slice of subscriber channels:

```go
type Broadcaster struct {
    subs []chan Event
    mu   sync.Mutex
}

func (b *Broadcaster) Subscribe() <-chan Event {
    b.mu.Lock()
    defer b.mu.Unlock()
    ch := make(chan Event, 16)
    b.subs = append(b.subs, ch)
    return ch
}

func (b *Broadcaster) Publish(e Event) {
    b.mu.Lock()
    defer b.mu.Unlock()
    for _, ch := range b.subs {
        select {
        case ch <- e:
        default: // slow subscriber: drop
        }
    }
}

func (b *Broadcaster) Close() {
    b.mu.Lock()
    defer b.mu.Unlock()
    for _, ch := range b.subs {
        close(ch)
    }
    b.subs = nil
}
```

`Close()` closes every subscriber channel. Each subscriber's `for range` exits.

---

## Close and `context.Context`

`context.Context` is built on closed channels:

- `ctx.Done()` returns a `<-chan struct{}` that is closed when the context is cancelled.
- Closing wakes every goroutine selecting on `ctx.Done()`.
- The same context can be passed to thousands of goroutines; one cancel reaches all of them.

The Go standard library uses this for HTTP request cancellation, database query timeouts, and request scoping. Internally, `cancelCtx.cancel()` does:

```go
// simplified from context.go
func (c *cancelCtx) cancel(removeFromParent bool, err error) {
    c.mu.Lock()
    if c.err != nil {
        c.mu.Unlock()
        return // already cancelled
    }
    c.err = err
    close(c.done) // the broadcast
    for child := range c.children {
        child.cancel(false, err)
    }
    c.mu.Unlock()
    if removeFromParent {
        removeChild(c.Context, c)
    }
}
```

The `close(c.done)` is the workhorse. Once a context is cancelled, every goroutine selecting on `ctx.Done()` wakes simultaneously.

### Practical usage

```go
func fetch(ctx context.Context, urls []string) ([]Response, error) {
    out := make(chan Response)
    var wg sync.WaitGroup
    for _, u := range urls {
        wg.Add(1)
        go func(u string) {
            defer wg.Done()
            select {
            case <-ctx.Done():
                return
            default:
            }
            r, err := doFetch(ctx, u)
            if err == nil {
                select {
                case out <- r:
                case <-ctx.Done():
                }
            }
        }(u)
    }
    go func() {
        wg.Wait()
        close(out)
    }()
    var results []Response
    for r := range out {
        results = append(results, r)
    }
    return results, ctx.Err()
}
```

Cancellation propagates via `ctx.Done()`. Completion propagates via `close(out)`. Two close mechanisms working together.

---

## Defensive Close with Recover

In rare cases where you cannot guarantee single-close ownership and `sync.Once` is not available, you can wrap close in `recover`:

```go
func safeClose(ch chan int) (closed bool) {
    defer func() {
        if recover() != nil {
            closed = true
        }
    }()
    close(ch)
    return false
}
```

**Don't do this in normal code.** It hides bugs. The right answer is to design the close path correctly. Defensive close is a last resort for legacy code or for testing infrastructure.

The same goes for "safe send":

```go
func safeSend(ch chan int, v int) (sent bool) {
    defer func() {
        if recover() != nil {
            sent = false
        }
    }()
    ch <- v
    return true
}
```

Also a code smell. Restructure.

The only legitimate use I have seen for `safeClose`: in test teardown, when a test may fail before close is reached, and the cleanup function must be idempotent.

---

## Testing Close Behaviour

Close behaviour is deterministic when ordering is controlled. Tests should not rely on goroutine scheduling.

### Test that a closed channel returns zero/!ok

```go
func TestClosedRecv(t *testing.T) {
    ch := make(chan int)
    close(ch)
    v, ok := <-ch
    if v != 0 || ok {
        t.Fatalf("expected (0, false), got (%d, %v)", v, ok)
    }
}
```

### Test that send-on-closed panics

```go
func TestSendOnClosedPanics(t *testing.T) {
    ch := make(chan int, 1)
    close(ch)
    defer func() {
        if r := recover(); r == nil {
            t.Fatal("expected panic")
        }
    }()
    ch <- 1
}
```

### Test that close wakes a blocked receiver

```go
func TestCloseWakesReceiver(t *testing.T) {
    ch := make(chan int)
    woken := make(chan struct{})
    go func() {
        <-ch
        close(woken)
    }()
    close(ch)
    select {
    case <-woken:
    case <-time.After(time.Second):
        t.Fatal("receiver was not woken")
    }
}
```

### Test that close broadcasts

```go
func TestBroadcast(t *testing.T) {
    done := make(chan struct{})
    var wg sync.WaitGroup
    woken := atomic.Int32{}
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            <-done
            woken.Add(1)
        }()
    }
    close(done)
    wg.Wait()
    if woken.Load() != 100 {
        t.Fatalf("expected 100 woken, got %d", woken.Load())
    }
}
```

### Test cancellation cascade

```go
func TestPipelineCancellation(t *testing.T) {
    ctx, cancel := context.WithCancel(context.Background())
    out := square(ctx, source(ctx, []int{1, 2, 3, 4, 5}))
    received := 0
    go func() {
        time.Sleep(10 * time.Millisecond)
        cancel()
    }()
    for range out {
        received++
    }
    // pipeline exited cleanly; received may be 0..5 depending on timing
    if received < 0 || received > 5 {
        t.Fatalf("unexpected count %d", received)
    }
}
```

The key invariant: the pipeline always closes its output, never deadlocks.

---

## Common Antipatterns

### Antipattern 1: closing in the receiver

```go
go func() {
    for v := range ch {
        if v == sentinel {
            close(ch) // wrong: receiver closes
            return
        }
    }
}()
```

Wrong because the sender may still be sending. The fix: have the sender check for "done" and close, or send a stop signal back.

### Antipattern 2: close-and-ignore

```go
defer func() {
    recover()
    close(ch)
}()
```

Recovering "just in case" and closing blindly hides every actual bug. If close panics here, you should hear about it.

### Antipattern 3: close to send a "value"

```go
ch := make(chan struct{}, 1)
// to "send" a signal
close(ch)
```

This works once. The next "send" — a new close — panics. If you want a one-shot signal, just send a value on a buffered channel: `ch <- struct{}{}`.

### Antipattern 4: closing to drain

```go
close(ch)
for range ch {
    // discard
}
```

Closing does **not** stop senders. If senders are still running, they panic. Closing a channel does not "drain" it — receivers do. To drain, just read.

### Antipattern 5: multiple closers protected only by a mutex

```go
var mu sync.Mutex
closed := false
mu.Lock()
if !closed {
    closed = true
    close(ch)
}
mu.Unlock()
```

Works, but `sync.Once` is shorter, more idiomatic, and harder to get wrong:

```go
once.Do(func() { close(ch) })
```

### Antipattern 6: closing in a defer that may run twice

```go
func work(ch chan int) {
    defer close(ch)
    defer func() {
        if r := recover(); r != nil {
            // ... but if close is in another defer, ordering matters
        }
    }()
    risky()
}
```

If `risky()` panics, both defers run. The recover catches it, but close runs *after* recover (LIFO). If the panicking code already closed the channel, the second close panics — which the recover does **not** catch (the second panic is in the defer, not in the original frame).

Always either:

- Recover *after* close, or
- Wrap close in `sync.Once`.

---

## Decision Table: Which Pattern When

| Scenario | Pattern |
|---|---|
| One sender, one or many receivers | Sender closes with `defer close(ch)`. |
| Many senders, fixed count, one consumer | Synchronising closer (Pattern 1): `WaitGroup` + closer goroutine. |
| Close may be requested from many code paths | `sync.Once` (Pattern 2). |
| Many senders, no central coordinator, cancellation needed | Separate done channel (Pattern 3). |
| Worker pool: one dispatcher, N workers, results channel | Dispatcher closes input; synchronising closer closes results (Pattern 4). |
| Dynamic sender population, library-style API | Coordinator goroutine (Pattern 5). |
| Pipeline of generators | Each stage owns its output channel; close cascades. |
| Broadcast cancellation | Closed done channel; combine with `sync.Once` for safety. |
| Cancellation from outside the goroutine tree | `context.Context` (built on close). |

---

## Self-Assessment

- [ ] I can articulate the multi-sender problem in one sentence and explain why naive approaches fail.
- [ ] I have used the synchronising-closer pattern in production code.
- [ ] I have wrapped a close in `sync.Once` to make it idempotent.
- [ ] I have used a separate done channel when the data channel could not be safely closed.
- [ ] I can write a generator function that closes its channel even when the goroutine panics.
- [ ] I have built a pipeline where close cascades down stages.
- [ ] I understand how `context.Context.Done()` uses close to broadcast cancellation.
- [ ] I can test close behaviour deterministically without relying on `time.Sleep` for ordering.
- [ ] I can list at least four close-related antipatterns and explain why each is wrong.
- [ ] I know when *not* to close: when sends may still happen, or when the channel is shared across closers without coordination.

---

## Summary

The single-sender close rule is simple: defer close in the producer. The multi-sender problem requires explicit coordination — a synchronising closer, `sync.Once`, a separate done channel, or a coordinator goroutine. Each pattern has a domain:

- **Synchronising closer** — fixed sender count, simplest fan-in.
- **`sync.Once`** — multiple close paths, idempotent close.
- **Done channel** — dynamic senders, cancellation built-in.
- **Coordinator** — dynamic lifecycle, library-style API.

Pipelines compose these patterns: each stage applies the single-sender rule for its own output channel, and close cascades from the source to the sink.

`close` doubles as a **broadcast signal**: one close wakes every receiver. This is the foundation of `context.Context.Done()` and the idiomatic Go cancellation mechanism. The same property makes "done channel" the canonical inter-goroutine signalling primitive.

At senior level, we look at the Go memory model's happens-before guarantees with close, and how to architect large systems where close is one of many coordination signals. At professional level, we dive into `closechan` runtime internals — exactly which atomic operations happen, in what order, and what makes close O(N) in the receiver count but still effectively constant in practice.
