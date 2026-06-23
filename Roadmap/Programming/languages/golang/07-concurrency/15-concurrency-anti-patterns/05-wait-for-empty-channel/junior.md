# Wait-for-Empty-Channel — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Anti-Pattern in One Snippet](#the-anti-pattern-in-one-snippet)
3. [What `len(ch)` Actually Returns](#what-lench-actually-returns)
4. [What `cap(ch)` Actually Returns](#what-capch-actually-returns)
5. [Why Polling Burns CPU](#why-polling-burns-cpu)
6. [The Race Between `len` and Send](#the-race-between-len-and-send)
7. [The Race Between `len` and Receive](#the-race-between-len-and-receive)
8. [Sleep Does Not Fix the Race](#sleep-does-not-fix-the-race)
9. [Snapshot Semantics: Why `len` Cannot Be Trusted](#snapshot-semantics-why-len-cannot-be-trusted)
10. [Correct Pattern 1: `close` + `for range`](#correct-pattern-1-close--for-range)
11. [Correct Pattern 2: The Done Channel](#correct-pattern-2-the-done-channel)
12. [Correct Pattern 3: `sync.WaitGroup`](#correct-pattern-3-syncwaitgroup)
13. [Correct Pattern 4: `errgroup` for Errors and Done](#correct-pattern-4-errgroup-for-errors-and-done)
14. [Correct Pattern 5: `context.Context` for Cancellation](#correct-pattern-5-contextcontext-for-cancellation)
15. [Variant: Spin-Checking `cap == 0`](#variant-spin-checking-cap--0)
16. [Variant: `select` / `default` Polling Loop](#variant-select--default-polling-loop)
17. [Variant: Polling Without Backoff](#variant-polling-without-backoff)
18. [Variant: Polling With Backoff Is Still Wrong](#variant-polling-with-backoff-is-still-wrong)
19. [Spotting the Anti-Pattern in Code Review](#spotting-the-anti-pattern-in-code-review)
20. [Why Tests Pass and Production Fails](#why-tests-pass-and-production-fails)
21. [Real-World Story 1: The Batch Job That Lost 0.3% of Rows](#real-world-story-1-the-batch-job-that-lost-03-of-rows)
22. [Real-World Story 2: The 80% CPU Idle Worker](#real-world-story-2-the-80-cpu-idle-worker)
23. [Real-World Story 3: The Flaky Test That Took Six Months](#real-world-story-3-the-flaky-test-that-took-six-months)
24. [Refactor Playbook](#refactor-playbook)
25. [Mental Model: Channels Are Pipes, Not Buckets](#mental-model-channels-are-pipes-not-buckets)
26. [Cheat Sheet: When You Are Tempted to Use `len`](#cheat-sheet-when-you-are-tempted-to-use-len)
27. [Common Counter-Arguments and Why They Are Wrong](#common-counter-arguments-and-why-they-are-wrong)
28. [Self-Assessment](#self-assessment)
29. [Summary](#summary)

---

## Introduction

You have written goroutines, you have sent values down channels, and now you want to wait until "the work is done." Your first instinct, especially if you came from a thread-and-queue language, is to check the queue:

```go
for len(jobs) > 0 {
    time.Sleep(10 * time.Millisecond)
}
fmt.Println("all jobs processed")
```

This compiles. It runs. It will pass your laptop test and most of your CI runs. It will also, sooner or later, miss a job, drop a result, hang, deadlock, or spin a core at 100% for no reason. The bug is not subtle — it is a race condition baked into the very first line.

This file is the most important one in the anti-patterns section because the temptation is universal. Every Go programmer encounters it. The correct replacement is always one of three things: `close` the channel and `range` it, signal completion with a `done` channel, or use `sync.WaitGroup`. We will write every wrong version first, explain why it is wrong, and then refactor it to the right one.

After reading this file you will:

- Never use `len(ch)` for synchronisation.
- Recognise five flavours of the anti-pattern at sight.
- Refactor a polling loop into `range`, done, or `WaitGroup` in under a minute.
- Explain to a colleague *why* `len` is a snapshot, not a fact.
- Pass a code review where this pattern is the trap.

---

## The Anti-Pattern in One Snippet

The full, classic shape:

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    jobs := make(chan int, 100)
    for i := 0; i < 50; i++ {
        go func(i int) {
            jobs <- process(i)
        }(i)
    }

    // wait for all 50 results
    for len(jobs) > 0 {
        time.Sleep(10 * time.Millisecond)
    }
    fmt.Println("done, len is", len(jobs))
}

func process(i int) int { return i * 2 }
```

Read it like the author intended: "spawn 50 goroutines, each writes a result, wait until the buffer drains, print done."

Read it like the runtime actually executes it:

1. `len(jobs)` is **zero at the moment of the first check** — none of the 50 goroutines has been scheduled yet on a busy machine. The loop exits immediately. The message prints. The goroutines proceed to send into a channel that has no reader and never will, and they block forever. Or, with a buffered channel of 100, they all send successfully but their values are discarded.
2. Even if some goroutines have run, `len(jobs)` reflects what was in the buffer *one nanosecond ago*. Another goroutine might be about to send. There is no fence, no read barrier, nothing that says "no more sends will happen."

What the author wanted was a coordination primitive. `len` is a measurement. Measurements do not coordinate.

---

## What `len(ch)` Actually Returns

From the Go specification: for a channel `ch`, `len(ch)` returns "the number of elements queued in the channel buffer." For an unbuffered channel, this is always 0. For a buffered channel of capacity `cap(ch)`, it is a snapshot of how many sends are currently in the buffer but have not yet been received.

Key properties:

- **It is a snapshot.** By the time the value is returned to your goroutine, another goroutine may have sent or received.
- **It does not block.** Unlike a receive, `len` returns immediately. That is the whole problem.
- **It does not synchronise.** It is not a release/acquire operation. It does not happen-before any send or receive in the memory model sense.
- **It is concurrency-safe** in that it will not crash, but the *value* it returns is meaningless for control flow decisions that need to be true a moment later.

Compare to a receive `v, ok := <-ch`. The receive blocks, transfers a value, and (with `ok`) tells you whether the channel was closed. Every guarantee `len` lacks, the receive provides.

---

## What `cap(ch)` Actually Returns

`cap(ch)` returns the channel's buffer capacity. For an unbuffered channel, `cap` is 0. For a buffered channel made with `make(chan T, N)`, `cap` is `N`.

Unlike `len`, `cap` is constant for the channel's lifetime. So `cap` is not really racy in the same way — it does not change. But people still abuse it. Two common variants:

```go
// "wait until the channel is full"
for len(ch) < cap(ch) {
    time.Sleep(time.Millisecond)
}
```

```go
// "this channel has no buffer, so spin to fake a rendezvous"
for cap(ch) == 0 && nothingReady(ch) {
    time.Sleep(time.Millisecond)
}
```

Both share the same disease as `len`-polling. The fact that `cap` is constant does not save the loop; what is changing under the loop is the *state* of pending sends and receives, which is not visible through `cap`.

---

## Why Polling Burns CPU

The most innocent-looking line:

```go
for len(ch) > 0 { }
```

is a tight loop with no scheduling point. Go's scheduler is cooperative-ish: it preempts on function calls, channel operations, system calls, and (since Go 1.14) on asynchronous preemption signals. A bare loop calling only `len` is borderline — `len` is a builtin, not a function call in the syntactic sense. In practice the goroutine consumes a full CPU core until the loop body grows or the scheduler preempts.

Add `time.Sleep`:

```go
for len(ch) > 0 {
    time.Sleep(10 * time.Millisecond)
}
```

Now you have stopped melting the core but you have introduced a 10 ms latency floor for every "completion event." If 100 such loops run in your service, you wake the goroutine roughly 100 times per second per loop — at 100 loops, that is 10 000 timer wakeups per second across the process. The Go runtime handles this fine, but you have replaced a free coordination (channel receive) with a paid coordination (timer fire + status check).

And you still have the race.

---

## The Race Between `len` and Send

Imagine the sender:

```go
go func() {
    ch <- 1
    ch <- 2
    ch <- 3
}()
```

And the polling waiter:

```go
for len(ch) > 0 {
    time.Sleep(time.Millisecond)
}
// "all sends are done"
```

Possible interleavings:

| Time | Sender | Waiter |
|------|--------|--------|
| t0   | (not yet scheduled) | `len(ch) == 0` → exit loop |
| t1   | `ch <- 1` | (already past the loop) |
| t2   | `ch <- 2` | (already past the loop) |
| t3   | `ch <- 3` | (already past the loop) |

The waiter saw the channel empty *before* the sender had a chance to send anything. The "wait" terminated immediately. The sender's values arrive into the buffer with no one to read them.

The reverse interleaving is also possible: the waiter sees a non-empty channel and sleeps; another consumer (or just buffer drain by a separate reader) empties the channel; the waiter wakes, sees empty, exits — but at that exact moment the sender pushes one more value the waiter never sees.

There is no version of "check then act" that closes this gap, because between the check and the act, anything can happen.

---

## The Race Between `len` and Receive

Symmetric problem from the receiver side:

```go
go func() {
    for {
        select {
        case v := <-ch:
            handle(v)
        default:
            if len(ch) == 0 {
                return // "no more work"
            }
        }
    }
}()
```

The receiver's `default` branch fires because `<-ch` was not ready *at that instant*. Then `len(ch) == 0` confirms emptiness *at this instant*. The receiver returns. Two microseconds later, the sender sends one more value. The receiver is gone. The value sits in the buffer (or blocks the sender if unbuffered).

In a worker pool with 10 such workers, the loss is multiplied: each worker independently decides "channel is empty, I am done." Items can be picked up by one worker, processed, and the rest of the workers shut down before the sender's later values reach anyone.

---

## Sleep Does Not Fix the Race

A common "fix" is to add a sleep before the check:

```go
time.Sleep(100 * time.Millisecond) // give senders time
for len(ch) > 0 { time.Sleep(10 * time.Millisecond) }
```

This is "guess a duration that is bigger than the senders' worst case." It is exactly the same anti-pattern as ["sleep for sync"](../06-sleep-for-sync/), with the added confusion of a `len` check on top.

What "worst case" do you guess? The senders' duration depends on:

- CPU load (your laptop vs CI vs production)
- Garbage collection pauses
- Scheduler latency under contention
- I/O latency if senders do I/O
- Cold caches, JIT warmup (Go has neither but containers do)

No constant is right. Even if you guess 100x the typical case, a slow CI run or a GC spike will violate it. Tests pass for months, then a Kubernetes node gets noisy and the test starts failing intermittently. The bug was there the whole time.

---

## Snapshot Semantics: Why `len` Cannot Be Trusted

Think of `len(ch)` as `chan_buffer_size_at_some_point_in_the_recent_past()`. The runtime atomically reads the buffer count, but by the time the value reaches your code:

- Another goroutine may have sent (increasing the real count).
- Another goroutine may have received (decreasing the real count).
- The channel may have been closed (impossible to detect from `len`).

`len` answers the question "how many items are buffered *right now*?" but "right now" expires immediately. To use `len` for synchronisation you would need to hold a lock around `len` *and* every send and every receive. At that point you are not using a channel, you are using a mutex-protected queue, and Go has those (`container/list` plus `sync.Mutex`, or `sync/atomic` for primitives).

Channels are not queues you observe from outside. Channels are pipes you communicate through. The synchronisation lives inside the send and receive operations, not around them.

---

## Correct Pattern 1: `close` + `for range`

The single most common refactor: the sender closes the channel when it is done, and the receiver loops with `range`.

```go
package main

import "fmt"

func main() {
    ch := make(chan int)
    go func() {
        defer close(ch)
        for i := 0; i < 5; i++ {
            ch <- i
        }
    }()

    for v := range ch {
        fmt.Println(v)
    }
    fmt.Println("done")
}
```

`for v := range ch` blocks until a value arrives, processes it, and exits when the channel is closed. No polling, no sleeping, no race. The Go runtime handles the "no more values" signal exactly. The receiver wakes only when there is something to do or when the channel is closed.

This pattern requires:

- A single, identifiable closer. With multiple senders, you need a coordinator (see [closing channels](../../02-channels/06-closing-channels/)).
- The receiver to stop when the channel closes (which `range` does automatically).

It does not require:

- A timer.
- A `len` check.
- A `done` signal.

---

## Correct Pattern 2: The Done Channel

When you cannot or should not close the data channel — for example, when the data channel has multiple senders, or carries values across many components — use a separate `done` channel for the "I'm finished" signal:

```go
package main

import "fmt"

func worker(jobs <-chan int, results chan<- int, done chan<- struct{}) {
    for j := range jobs {
        results <- j * 2
    }
    done <- struct{}{}
}

func main() {
    jobs := make(chan int, 10)
    results := make(chan int, 10)
    done := make(chan struct{}, 3)

    for w := 0; w < 3; w++ {
        go worker(jobs, results, done)
    }

    for i := 0; i < 9; i++ {
        jobs <- i
    }
    close(jobs)

    // wait for 3 done signals
    for i := 0; i < 3; i++ {
        <-done
    }
    close(results)

    for r := range results {
        fmt.Println(r)
    }
}
```

Each worker sends one signal on `done` when it returns. The main goroutine receives exactly `numWorkers` signals — no more, no less. This is deterministic; there is no buffer to inspect, no polling, no sleep.

`chan struct{}` is the idiomatic type for a signal-only channel: zero-byte values, no payload, just "I happened."

---

## Correct Pattern 3: `sync.WaitGroup`

When you have N goroutines and want to wait for all of them, `sync.WaitGroup` is the standard. It is essentially a typed, optimised version of "count down N done signals":

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            fmt.Println("worker", i, "done")
        }(i)
    }
    wg.Wait()
    fmt.Println("all done")
}
```

Three rules:

1. `wg.Add(n)` happens in the *parent* goroutine before spawning the children. If you `Add` inside the goroutine, `Wait` can return before `Add` runs.
2. `wg.Done()` happens in the *child* goroutine, ideally via `defer` so it fires on panic too.
3. `wg.Wait()` happens in the goroutine that needs to observe completion. It blocks until the counter reaches zero.

`WaitGroup` has zero polling, zero `len`, zero sleep. The counter is atomic; `Wait` blocks on a semaphore. This is the most efficient "wait for N" primitive in the standard library.

---

## Correct Pattern 4: `errgroup` for Errors and Done

If any of your goroutines can return an error, `golang.org/x/sync/errgroup` extends `WaitGroup` with first-error propagation and context cancellation:

```go
package main

import (
    "context"
    "fmt"

    "golang.org/x/sync/errgroup"
)

func main() {
    g, ctx := errgroup.WithContext(context.Background())
    for i := 0; i < 5; i++ {
        i := i
        g.Go(func() error {
            return doWork(ctx, i)
        })
    }
    if err := g.Wait(); err != nil {
        fmt.Println("error:", err)
        return
    }
    fmt.Println("all done")
}

func doWork(ctx context.Context, i int) error {
    select {
    case <-ctx.Done():
        return ctx.Err()
    default:
    }
    return nil
}
```

`g.Wait()` returns the first non-nil error (if any) once every goroutine has returned. The shared `ctx` is cancelled as soon as the first error occurs, so peers can shut down promptly.

No `len`, no sleep, no polling. This is the right primitive whenever "wait for N to finish or first failure."

---

## Correct Pattern 5: `context.Context` for Cancellation

For "stop when something external decides we are done" rather than "stop when the work is done," use `context.Context`:

```go
package main

import (
    "context"
    "fmt"
    "time"
)

func worker(ctx context.Context, jobs <-chan int) {
    for {
        select {
        case <-ctx.Done():
            fmt.Println("worker stopped")
            return
        case j, ok := <-jobs:
            if !ok {
                return
            }
            fmt.Println("processing", j)
        }
    }
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
    defer cancel()

    jobs := make(chan int)
    go worker(ctx, jobs)
    time.Sleep(50 * time.Millisecond)
    jobs <- 1
    <-ctx.Done()
    time.Sleep(20 * time.Millisecond)
}
```

The worker selects on `ctx.Done()` *and* `jobs`. Whichever fires first wins. No `len`, no polling.

---

## Variant: Spin-Checking `cap == 0`

Sometimes people imagine they can detect "this is an unbuffered channel" or "this channel is at capacity" by spinning on `cap`. Because `cap` is constant, the test never changes meaning, but the surrounding code is still wrong:

```go
// "wait until the channel is full so we know all senders sent"
for len(ch) < cap(ch) {
    time.Sleep(time.Millisecond)
}
```

Three things wrong:

1. **Same race as `len`.** Even if you see `len(ch) == cap(ch)` once, the next moment a receiver may drain a slot and a new sender push another value. "Full" is not "done."
2. **It assumes sender count equals capacity.** If you have 5 senders and a channel of cap 10, the loop waits forever.
3. **For unbuffered channels (`cap == 0`), `len` is always 0**, so `len(ch) < cap(ch)` is `0 < 0` — false — and the loop exits immediately, before any communication.

Fix with a `WaitGroup` or a counter you control yourself.

---

## Variant: `select` / `default` Polling Loop

```go
for {
    select {
    case v := <-ch:
        process(v)
    default:
        // channel was empty just now
        if doneFlag.Load() {
            return
        }
    }
}
```

This is `len(ch) > 0` in disguise. The `default` branch is taken whenever there is no value *at this exact moment*. Then we check a separate "done flag" and decide to leave. But between the `default` branch firing and the flag check, a value may have arrived. We never read it.

Fix:

```go
for {
    select {
    case <-doneCh:
        return
    case v := <-ch:
        process(v)
    }
}
```

Now we block on either signal. No polling, no missed values.

Better yet, if `ch` has a single, identifiable closer, just `for v := range ch`.

---

## Variant: Polling Without Backoff

```go
for len(ch) > 0 {
    runtime.Gosched()
}
```

`runtime.Gosched` yields to other goroutines. It is better than a tight spin, worse than a sleep, much worse than a block. It still pings the runtime hundreds of thousands of times per second.

The fix is not "add a sleep" — it is "stop polling."

---

## Variant: Polling With Backoff Is Still Wrong

```go
delay := time.Millisecond
for len(ch) > 0 {
    time.Sleep(delay)
    if delay < 100*time.Millisecond {
        delay *= 2
    }
}
```

Exponential backoff for a polling loop is the kind of code that gets praised for being "thoughtful." It is still the same race. Worse: the longer you back off, the longer the gap between the last `len` check and the eventual exit, increasing the window in which the sender can sneak in another value.

Backoff is for retrying *I/O*, not for waiting on local state.

---

## Spotting the Anti-Pattern in Code Review

Look for any of these tokens in close proximity:

- `len(` followed by a channel name, anywhere outside a debug log.
- `cap(` of a channel, used in a condition.
- `select { case ... <-ch: ... default: ... }` inside a `for { }` loop.
- `time.Sleep` inside a loop whose only purpose is to wait.
- `runtime.Gosched` inside a loop with no other body.

`len(ch)` in a `log.Printf` is fine — observability is a legitimate read. `len(ch)` in a metric exporter is fine. `len(ch)` *driving control flow* is the bug.

A useful linter pattern:

```bash
git grep -nE 'for[^{]*len\(\s*\w+\s*\)' .
```

Filter the results to channel-typed variables. Any survivor is suspicious.

---

## Why Tests Pass and Production Fails

The pattern's signature behaviour is **time-dependent correctness**:

- On a fast laptop with no load, the senders are quick, the polling loop sleeps once or twice, and the channel really is empty by the time the loop exits. Test passes.
- On a slow CI runner under parallel test execution, the senders are starved, the loop exits before any send happens, and the test sees empty results.
- On a production node under memory pressure, the GC pauses for 20 ms, the senders are paused mid-loop, the waiter exits early.

This is why so much code with this bug ships. Tests are not the place this fails. Production load is.

Indicators in production:

- "We sometimes process N-1 items instead of N."
- "Workers shut down before the last message arrives."
- "The graceful shutdown loses a few messages every restart."
- "CPU sits at 1% per worker even when idle."

---

## Real-World Story 1: The Batch Job That Lost 0.3% of Rows

A nightly ETL job at a fintech company moved rows from one database to another. The producer fanned out 20 goroutines reading from the source, each pushing rows into a buffered channel of 1000. A consumer goroutine drained the channel and wrote to the destination. The driver code waited for completion with:

```go
for len(rowCh) > 0 {
    time.Sleep(100 * time.Millisecond)
}
log.Println("done, rows transferred:", count)
```

For 18 months this worked. Then a network blip caused one of the 20 reader goroutines to pause for 400 ms on a `SELECT`. The waiter saw `len(rowCh) == 0`, exited, and the job logged "done." Forty-three rows arrived after the log line, never written to the destination.

The bug was found six months after the loss. Reconciliation tooling discovered the gap by accident. Fix: a `WaitGroup` for the 20 readers, then `close(rowCh)`, then `for row := range rowCh` in the consumer.

---

## Real-World Story 2: The 80% CPU Idle Worker

A company's monitoring noticed that an "idle" service was burning 80% of one CPU per pod. The service consumed from a Kafka topic and dispatched messages to internal channels. The dispatcher had:

```go
for {
    if len(msgCh) > 0 {
        msg := <-msgCh
        handle(msg)
    }
}
```

When `msgCh` was empty (the common case at night), the `for` body was just `len(msgCh) > 0` — a tight loop. The author had reasoned, "this is faster than a select because select adds overhead." The fact that the loop pegged a CPU was missed because Kubernetes capped at 1 CPU per pod and the pod looked "healthy" within limits.

Fix:

```go
for msg := range msgCh {
    handle(msg)
}
```

Or, with a cancellation channel:

```go
for {
    select {
    case <-ctx.Done():
        return
    case msg := <-msgCh:
        handle(msg)
    }
}
```

CPU went from 80% to 0.4%.

---

## Real-World Story 3: The Flaky Test That Took Six Months

A unit test was flaky at about 0.2% — one in 500 CI runs. The test spawned 10 goroutines that produced events into a buffered channel of 100, then waited for completion with `for len(events) > 0 { time.Sleep(time.Millisecond) }`, then asserted on the total event count.

The test occasionally asserted 99 instead of 100. The team disabled the test, then tried `time.Sleep(time.Second)` to be safe, then re-enabled, then it flaked again at 1 in 5000, and the cycle repeated. Six months of intermittent CI failures, several "investigations" that concluded "transient infra issue."

The fix, when finally identified, was a one-line `wg.Wait()` before the assertion. The test became deterministic on the first attempt.

---

## Refactor Playbook

### Step 1 — Identify the polling site

Search:

```bash
git grep -nE 'len\(\s*\w+\s*\)\s*[><=!]' -- '*.go'
git grep -nE 'cap\(\s*\w+\s*\)' -- '*.go'
git grep -nE 'select\s*\{[^}]*default:' -- '*.go'
```

Filter to channel uses. For each hit, ask: is this *measuring* or *waiting*?

### Step 2 — Classify the wait

| Scenario | Replacement |
|----------|-------------|
| "Wait until a sender finishes sending N values" | `for v := range ch` after `defer close(ch)` in the sender |
| "Wait until M goroutines all return" | `sync.WaitGroup` |
| "Wait until M goroutines finish, capturing first error" | `errgroup.Group` |
| "Wait until something external cancels" | `context.Context` + `<-ctx.Done()` |
| "Wait for a one-shot signal" | `chan struct{}` closed by the signaller |

### Step 3 — Three concrete replacements

**Replacement A: `len` poll to `range`.**

```go
// Before
go func() {
    for _, x := range items {
        ch <- x
    }
}()
for len(ch) > 0 {
    time.Sleep(time.Millisecond)
}
// done

// After
go func() {
    defer close(ch)
    for _, x := range items {
        ch <- x
    }
}()
for v := range ch {
    consume(v)
}
```

**Replacement B: `len` poll to `WaitGroup`.**

```go
// Before
for i := 0; i < n; i++ {
    go work(i, done)
}
for len(done) < n {
    time.Sleep(time.Millisecond)
}

// After
var wg sync.WaitGroup
for i := 0; i < n; i++ {
    wg.Add(1)
    go func(i int) {
        defer wg.Done()
        work(i)
    }(i)
}
wg.Wait()
```

**Replacement C: `select`/`default` poll to blocking `select`.**

```go
// Before
for {
    select {
    case v := <-ch:
        consume(v)
    default:
        if shouldStop() {
            return
        }
    }
}

// After
for {
    select {
    case <-stopCh:
        return
    case v := <-ch:
        consume(v)
    }
}
```

### Step 4 — Verify with `-race`

After refactor, run the test suite with `go test -race ./...`. The race detector cannot prove the absence of races, but the refactored code uses standard primitives whose memory model semantics are well known.

### Step 5 — Add a regression test

Write a test where the producer artificially slows down (e.g., `time.Sleep` between sends). With the old polling loop, the test loses values. With the new `range`/`WaitGroup`, it captures all values. Lock in the contract.

---

## Mental Model: Channels Are Pipes, Not Buckets

The fundamental misunderstanding behind the anti-pattern is treating a channel as a *bucket* you peek into. A bucket has a level; you can look at the level without disturbing it. A pipe does not have a level — it has *flow*. Asking "is the pipe empty?" is meaningless unless you also know whether the source has shut off.

The right questions for a channel are:

- "Has every expected sender finished?" — `WaitGroup`, `errgroup`, or a counter of `done` signals.
- "Is the channel closed?" — `v, ok := <-ch`; `ok == false` means closed.
- "Should I stop consuming?" — listen for cancellation on a separate channel.

The wrong question is:

- "Is the channel empty right now?" — irrelevant. Even if it is empty, more might be coming.

---

## Cheat Sheet: When You Are Tempted to Use `len`

| Temptation | Real Need | Right Tool |
|-----------|-----------|-----------|
| "Wait until queue drains" | Wait for sender to finish | `close` + `range` |
| "Wait until N workers done" | Wait for N goroutines | `sync.WaitGroup` |
| "Stop when no more work" | Stop on close signal | `for v := range ch` |
| "Don't block if empty" | Try-receive | `select { case v := <-ch: ...; default: }` (used correctly, not in a polling loop) |
| "Show backlog in metrics" | Measure depth | `len(ch)` — but only for observability, not control flow |

The last row is the legitimate use of `len`: emitting a metric, writing a log line, displaying a debug counter. None of those are synchronisation.

---

## Common Counter-Arguments and Why They Are Wrong

**"My buffer is big enough that the race can never trigger."**

The race detector disagrees, and so does production load. Buffer size affects *probability* of the race, not its possibility. Code that works "in practice" because of buffer size is one traffic spike from breaking.

**"I added a sleep, now it works."**

Sleep makes the race window smaller, not absent. You shipped a bug that takes longer to manifest. When it finally does — in production, at 3 AM — you will not remember the sleep.

**"`len` is atomic, so it's safe."**

`len` returning a stable value at the moment of the call is not the same as your *decision based on that value* being safe. The atomicity of the read is irrelevant; the validity of the decision is the issue.

**"This is a closed system, I control all the senders."**

Today, yes. In six months, after a refactor, after a colleague adds a new sender that you do not know about, after a library you use spawns a helper goroutine — no. Build correctness in, do not assume it.

**"Polling is simpler than `WaitGroup`."**

`var wg sync.WaitGroup; wg.Add(n); ... wg.Done(); wg.Wait()` is four lines. The polling loop with backoff is six lines and broken. Simpler is the wrong axis to optimise on; correct is.

**"The standard library does it."**

It does not. `net/http`, `database/sql`, `sync`, `runtime` — none of these synchronise on `len(ch)`. If you find a place that appears to, look closer: it is almost certainly used for metrics, debugging, or as a fast-path optimisation guarded by a separate proven synchronisation.

---

## Self-Assessment

Answer aloud, then check against the file:

1. Why does `for len(ch) > 0 { time.Sleep(...) }` fail even with a generous sleep?
2. What is the difference between `len(ch)` and `cap(ch)`?
3. Given five producer goroutines and one consumer, which primitive coordinates "all done"?
4. Why is `select { default: ... }` inside a `for` loop a polling pattern even though it uses `select`?
5. When is `len(ch)` an acceptable expression to write?
6. Refactor: "wait for buffered channel to drain" → idiomatic code.
7. Refactor: "wait for N goroutines" → idiomatic code.
8. Refactor: "stop consuming when cancelled" → idiomatic code.
9. Why does adding exponential backoff to a polling loop not fix the race?
10. What does the race detector show when you run `go test -race` against the polling version?

If you stumble on any of these, re-read the corresponding section.

---

## Summary

`len(ch)` is a snapshot, not a synchronisation primitive. Polling on it — with or without sleep, with or without backoff — produces code that is racy by construction and burns CPU as a bonus. Every legitimate "wait" has a proper Go primitive:

- `close(ch)` + `for v := range ch` for "sender done."
- `sync.WaitGroup` for "N goroutines done."
- `errgroup.Group` for "N goroutines done, first error wins."
- `context.Context` for "cancelled."
- Done channels (`chan struct{}`) for one-shot signals.

The refactor playbook is simple: identify the poll, classify the wait, replace with the right primitive, verify with `-race`, add a regression test. The middle-level file explores the memory model and four production case studies; senior level focuses on system design so this anti-pattern cannot enter the codebase in the first place.

Continue with [middle.md](middle.md).
