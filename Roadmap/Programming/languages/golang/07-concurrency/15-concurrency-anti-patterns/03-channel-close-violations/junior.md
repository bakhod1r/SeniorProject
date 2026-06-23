# Channel Close Violations — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [What `close` Actually Does](#what-close-actually-does)
3. [The Five Rules](#the-five-rules)
4. [Rule 1: Never Close a Nil Channel](#rule-1-never-close-a-nil-channel)
5. [Rule 2: Never Close a Closed Channel](#rule-2-never-close-a-closed-channel)
6. [Rule 3: Never Send on a Closed Channel](#rule-3-never-send-on-a-closed-channel)
7. [Rule 4: The Receiver Should Not Close](#rule-4-the-receiver-should-not-close)
8. [Rule 5: Multi-Sender Close Needs Coordination](#rule-5-multi-sender-close-needs-coordination)
9. [Why These Rules Exist](#why-these-rules-exist)
10. [Reading the Panic Stack Trace](#reading-the-panic-stack-trace)
11. [Anti-Pattern 1: Receiver Closes "To Signal Done"](#anti-pattern-1-receiver-closes-to-signal-done)
12. [Anti-Pattern 2: Closing Twice from Concurrent Code](#anti-pattern-2-closing-twice-from-concurrent-code)
13. [Anti-Pattern 3: Sending After Close](#anti-pattern-3-sending-after-close)
14. [Anti-Pattern 4: `defer close(ch)` with Multiple Producers](#anti-pattern-4-defer-closech-with-multiple-producers)
15. [Anti-Pattern 5: Closing `chan struct{}` Carelessly](#anti-pattern-5-closing-chan-struct-carelessly)
16. [Safe Pattern 1: Single-Sender Close](#safe-pattern-1-single-sender-close)
17. [Safe Pattern 2: Coordinator Goroutine Closes](#safe-pattern-2-coordinator-goroutine-closes)
18. [Safe Pattern 3: `sync.Once` Wrapper](#safe-pattern-3-synconce-wrapper)
19. [Safe Pattern 4: Done Channel for Broadcast](#safe-pattern-4-done-channel-for-broadcast)
20. [Detecting Violations at Test Time](#detecting-violations-at-test-time)
21. [How `range` Interacts with Close](#how-range-interacts-with-close)
22. [How `select` Interacts with Close](#how-select-interacts-with-close)
23. [The Comma-Ok Idiom](#the-comma-ok-idiom)
24. [Buffered Channels and Close](#buffered-channels-and-close)
25. [Nil-Channel Tricks vs. Closed-Channel Tricks](#nil-channel-tricks-vs-closed-channel-tricks)
26. [Linters and Static Checks](#linters-and-static-checks)
27. [Cross-Reference Reading](#cross-reference-reading)
28. [Self-Assessment](#self-assessment)
29. [Summary](#summary)

---

## Introduction

Closing a channel looks like the simplest operation in Go: one keyword, one argument, no return value. In a tutorial that is true. In production code, more goroutines have crashed on a misplaced `close` than on almost any other concurrency primitive.

The reason is that `close` does three things at once:

1. It changes the state of the channel so that further receives return the zero value with `ok == false`.
2. It changes the state so that further sends panic.
3. It wakes up every goroutine currently blocked on a receive.

The first behaviour is what you want. The second is the trap. The third is what makes close so seductive — it is the only way in Go to broadcast a signal to an unknown number of waiters.

This file is the entry point to the anti-pattern. We will list the five rules of `close`, show the canonical panic stacks, walk through the violations you will see in real codebases, and then give the small handful of safe patterns that cover every multi-sender scenario you are likely to meet.

When we finish, you will:

- Know exactly which operations on `close` panic and why.
- Be able to read a `close of closed channel` stack trace and find the bug from it.
- Recognise the receiver-closes anti-pattern at a glance.
- Apply single-sender, coordinator, `sync.Once`, and done-channel patterns in your own code.

This is junior-level material. We focus on rules, panics, and the simplest safe patterns. The middle and senior files build on this to cover multi-sender coordination, pipelines, and library-grade close helpers.

---

## What `close` Actually Does

Go's runtime represents a channel as a struct named `hchan` (you can read the source in `runtime/chan.go`). One of its fields is a boolean called `closed`. The `close` builtin sets that flag from `false` to `true` and wakes any goroutines parked in receive on the channel.

Conceptually:

```go
// pseudo-code; not real source
func close(c *hchan) {
    lock(&c.lock)
    if c == nil {
        panic("close of nil channel")
    }
    if c.closed {
        panic("close of closed channel")
    }
    c.closed = true
    wakeAllReceivers(c)
    unlock(&c.lock)
}
```

That is the whole operation. There is no `unclose`. There is no `close-if-not-closed`. A closed channel stays closed for the lifetime of the runtime; it is garbage-collected when no goroutine and no variable reference it.

Once `closed == true`:

- Sends panic with `send on closed channel`.
- Receives on an empty buffered channel and an unbuffered channel return the zero value with `ok == false`.
- Receives on a buffered channel still drain remaining buffered values before returning zero; close does not discard buffered data.

This last detail matters: closing a buffered channel does not throw away its contents. The receiver can still read all values that were sent before close, and only after the buffer drains does it begin receiving zero values.

---

## The Five Rules

These five rules are the entire content of this file in compressed form. Internalise them and you will avoid 95% of close bugs.

1. **Never close a nil channel.** The runtime panics with `close of nil channel`.
2. **Never close a closed channel.** The runtime panics with `close of closed channel`.
3. **Never send on a closed channel.** The runtime panics with `send on closed channel`.
4. **The receiver should not close.** This is a convention, not a runtime check, but violating it is almost always a bug.
5. **Multi-sender close needs coordination.** When more than one goroutine sends on a channel, neither sender can safely close it directly; a coordinator or some other synchronisation mechanism must.

The first three rules are enforced by the runtime — you cannot violate them silently. The last two are conventions, but they are the conventions that prevent you from accidentally hitting the first three under load.

We will spend the rest of this file unpacking each rule and the patterns that follow from them.

---

## Rule 1: Never Close a Nil Channel

```go
package main

func main() {
    var ch chan int // nil
    close(ch)
}
```

Output:

```
panic: close of nil channel

goroutine 1 [running]:
main.main()
        /tmp/main.go:5 +0x18
exit status 2
```

A nil channel is a channel variable whose value is `nil` — either because you declared it but never `make`d it, or because someone explicitly set it to `nil`. Sends and receives on a nil channel block forever, which is sometimes useful in `select` statements. Close, however, is not useful: it panics.

Common ways to end up here:

- Forgetting to `make` the channel before returning it from a constructor.
- Setting a channel to `nil` deliberately (to disable a `select` case) and then later closing it because the producer has exited.
- Reading a channel out of a struct whose zero value was used.

The fix is always the same: ensure the channel is non-nil before closing. If your code legitimately works with a possibly-nil channel, guard the close:

```go
if ch != nil {
    close(ch)
}
```

But ask first whether the design is right. A nil channel that might also be closed often indicates that ownership of the channel is unclear.

---

## Rule 2: Never Close a Closed Channel

```go
package main

func main() {
    ch := make(chan int)
    close(ch)
    close(ch)
}
```

Output:

```
panic: close of closed channel

goroutine 1 [running]:
main.main()
        /tmp/main.go:6 +0x3c
exit status 2
```

Single-threaded, this is so obvious nobody writes it. Multi-threaded, it is one of the top three reasons for production panics in Go services.

The pattern that produces it:

```go
go func() {
    for v := range work {
        process(v)
    }
    close(done)
}()

go func() {
    err := waitForCancel()
    if err != nil {
        close(done)
    }
}()
```

Two goroutines, two `close(done)` calls. If both fire, the second panics. If only one fires, you got lucky. Code reviewers miss this because each goroutine looks correct in isolation.

The defence is one of:

- Have exactly one goroutine own the close.
- Use `sync.Once` to make close idempotent.
- Use a coordinator goroutine that does the close after waiting for both paths.

We will cover all three later in this file.

---

## Rule 3: Never Send on a Closed Channel

```go
package main

func main() {
    ch := make(chan int, 1)
    close(ch)
    ch <- 1
}
```

Output:

```
panic: send on closed channel

goroutine 1 [running]:
main.main()
        /tmp/main.go:6 +0x44
exit status 2
```

This is the most dangerous of the three runtime rules because the violation is racy. In a multi-goroutine program, the sender and the closer may be in different goroutines, and whether the send happens before or after the close depends on the scheduler. A test run with `GOMAXPROCS=1` may never see the bug; the same code on a 32-core production box panics within seconds.

Canonical broken pattern:

```go
ch := make(chan int)
go func() {
    for i := 0; i < 10; i++ {
        ch <- i
    }
}()
go func() {
    if shouldCancel() {
        close(ch) // sender is still running
    }
}()
```

The closer runs concurrently with the sender. Eventually the sender tries to send to a channel that the closer just closed and panics.

The standard defence is to **never close the data channel from the consumer side**. Instead, signal cancellation through a separate channel (the done-channel pattern) and let the producer notice and exit. We cover this in Anti-Pattern 1 and Safe Pattern 4 below.

---

## Rule 4: The Receiver Should Not Close

This is a convention, not a runtime check. The runtime does not know who closes a channel; it only knows the channel got closed. But violating the convention is almost always wrong because it leads to violations of Rule 3.

Think of it from the sender's point of view. The sender is sending values one by one. It is the only entity that knows when the data stream is finished. The receiver, on the other hand, only knows that the next receive blocked; it cannot know whether more sends are coming or not.

If the receiver closes the channel "because it has had enough", the sender — which is still alive and still trying to send — will panic on its next send. This is Rule 3 again.

The convention "only the sender closes" is therefore equivalent to "do not close from the receiver because you cannot prove the sender is done".

The exception: when the channel is purely a signal (no data), and the sender side is the consumer rather than the producer, the directions can flip. This is the done-channel idiom — but here the "close" itself is the message, not a sign of data-stream completion. We will return to this in Anti-Pattern 5.

---

## Rule 5: Multi-Sender Close Needs Coordination

Two or more goroutines send on the same channel. Each finishes when it runs out of work. Who closes?

- If each closes, the first close is fine and the rest panic on Rule 2.
- If one closes and the others are still mid-send, the others panic on Rule 3.
- If none closes, the receiver's `for range` blocks forever — a leak.

The rule of thumb: **a channel must have exactly one closer, and that closer must run after every sender has finished sending**.

There are three idiomatic ways to satisfy this:

1. A coordinator goroutine that waits on `sync.WaitGroup` and then closes.
2. A `sync.Once` wrapper around `close` so that whichever path "wins" the race closes safely, and the others are no-ops.
3. A separate done channel for cancellation, with the data channel never closed from the consumer side.

We cover all three in Safe Pattern 2, 3, and 4. For now, the rule: multiple senders means you need a closer that is not one of the senders.

---

## Why These Rules Exist

The Go team designed `close` to be loud rather than forgiving. They could have made double-close a silent no-op, like `Close` on most `io.Closer` implementations. They chose to panic instead, for a deliberate reason:

> Closing the channel is a signal that no more values will be sent. Sending a duplicate "no more values" signal is meaningless; if your program is doing it, your program's design is wrong, and we would rather you find that out at the line of the second close than ship to production with a silently-broken protocol.

The same logic applies to send-on-closed. A closed channel means "no more values from this side". Sending is the opposite of that; the program is contradicting itself. Better to panic than to silently lose the value or to silently re-open the channel.

So the panics are a feature. They are the language pushing you towards designs in which there is a clear, single owner of close. When you find yourself reaching for `sync.Once` or `recover` to suppress the panic, take it as a hint that the ownership model is unclear and consider redesigning.

---

## Reading the Panic Stack Trace

When a panic happens in production, you typically get:

```
panic: send on closed channel

goroutine 47 [running]:
main.(*Worker).process(0xc000010040, 0x42)
        /app/worker.go:88 +0x6f
main.(*Worker).Run(0xc000010040)
        /app/worker.go:55 +0x123
created by main.NewWorker
        /app/worker.go:32 +0x9a

goroutine 1 [running]:
main.main()
        /app/main.go:25 +0x80
```

How to read it:

- The first line tells you which rule was violated: `send on closed channel`, `close of closed channel`, or `close of nil channel`.
- The next block is the goroutine that panicked, with the file and line number where the violation happened.
- For multi-goroutine programs, the `created by` line tells you which line of code spawned the offending goroutine — usually more useful than the panic line itself, because that is where you set up the ownership.

In a production crash dump you may have hundreds of goroutines. Look for two things:

1. The goroutine with `[running]` — that is the one that panicked.
2. Goroutines waiting on send or receive on the same channel — they tell you who else thought the channel was open.

When a `close of closed channel` panic fires, the channel itself is identified only by its memory address inside `hchan` — not by name. You have to map the address back to a variable by reading the stack trace, which is why naming the channel and centralising its close in one place pays off.

---

## Anti-Pattern 1: Receiver Closes "To Signal Done"

The single most common close violation in real codebases:

```go
func consumer(ch chan int) {
    for v := range ch {
        if v == -1 {
            close(ch) // signal "no more"
            return
        }
        process(v)
    }
}
```

The author thought: "I am done consuming, let me close the channel to tell the producer to stop." The producer, however, is still in the middle of sending. On its next send it panics with `send on closed channel`.

The producer's code:

```go
go func() {
    for _, item := range items {
        ch <- item // panics here
    }
    close(ch)
}()
```

Two close calls plus a send-on-closed: a perfect storm.

**Fix.** Use a separate done channel.

```go
func consumer(ch <-chan int, done chan<- struct{}) {
    defer close(done)
    for v := range ch {
        if v == -1 {
            return // signals done by closing `done`
        }
        process(v)
    }
}

func producer(ch chan<- int, done <-chan struct{}) {
    defer close(ch)
    for _, item := range items {
        select {
        case ch <- item:
        case <-done:
            return
        }
    }
}
```

Now the consumer never closes the data channel. It closes `done`, which is a signal channel that the producer watches. The producer is the sole owner of `ch` and is the only one that closes it.

This is Safe Pattern 4 in detail.

---

## Anti-Pattern 2: Closing Twice from Concurrent Code

```go
func (s *Server) Shutdown() {
    close(s.done)
}

func (s *Server) handleSignal() {
    <-sigChan
    close(s.done)
}
```

If both `Shutdown()` (called from a test or a manager) and a `SIGTERM` arrive, both close `s.done` and the second panics.

This bug is invisible in single-path tests. It only surfaces when shutdown races signal handling — typically on production restart.

**Fix 1: `sync.Once`.**

```go
type Server struct {
    done     chan struct{}
    closeDone sync.Once
}

func (s *Server) Shutdown() {
    s.closeDone.Do(func() { close(s.done) })
}

func (s *Server) handleSignal() {
    <-sigChan
    s.closeDone.Do(func() { close(s.done) })
}
```

`sync.Once.Do` is guaranteed to call its function at most once even under heavy concurrency.

**Fix 2: state machine with mutex.**

```go
type Server struct {
    mu     sync.Mutex
    done   chan struct{}
    closed bool
}

func (s *Server) Shutdown() {
    s.mu.Lock()
    defer s.mu.Unlock()
    if s.closed {
        return
    }
    s.closed = true
    close(s.done)
}
```

Functionally identical to `sync.Once`. Use this when you also need to expose `IsClosed()` or otherwise read the closed state.

---

## Anti-Pattern 3: Sending After Close

```go
func (b *Broker) Publish(msg Message) {
    b.subscribers.Range(func(_, sub any) bool {
        sub.(chan Message) <- msg
        return true
    })
}

func (b *Broker) Unsubscribe(sub chan Message) {
    b.subscribers.Delete(sub)
    close(sub)
}
```

Race: `Publish` and `Unsubscribe` run concurrently. `Publish` is iterating subscribers; `Unsubscribe` removes one and closes its channel. The `Publish` goroutine may have already taken a reference to the channel before `Delete`, and then sends to it after `close`. Panic.

The pattern "close to tell subscribers to stop" is appealing but unsafe whenever someone else might still be sending.

**Fix.** Do not close the subscriber's channel from the broker side. Let the subscriber drain naturally and use a separate per-subscriber `done` channel:

```go
type Subscriber struct {
    Ch   chan Message
    Done chan struct{}
}

func (b *Broker) Publish(msg Message) {
    b.subscribers.Range(func(_, sub any) bool {
        s := sub.(*Subscriber)
        select {
        case s.Ch <- msg:
        case <-s.Done:
            // subscriber gone; skip
        }
        return true
    })
}

func (b *Broker) Unsubscribe(sub *Subscriber) {
    b.subscribers.Delete(sub)
    close(sub.Done) // safe: nobody sends on Done
}
```

Now `Publish` never sends to a closed `Ch`. Instead, it races send against `Done`; whichever wins, no panic.

---

## Anti-Pattern 4: `defer close(ch)` with Multiple Producers

```go
func producers() <-chan int {
    ch := make(chan int)
    for i := 0; i < 5; i++ {
        go func(id int) {
            defer close(ch) // each producer defers close
            for j := 0; j < 10; j++ {
                ch <- id*10 + j
            }
        }(i)
    }
    return ch
}
```

Five producers, five deferred closes. Whichever producer finishes first calls `close(ch)`. The remaining four are then either:

- About to send → panic on `send on closed channel`.
- About to finish → panic on `close of closed channel`.

Pick your poison.

**Fix.** Move the close out of the producers entirely. Use a coordinator with `sync.WaitGroup`:

```go
func producers() <-chan int {
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
    return ch
}
```

One closer, runs after all senders are done. This is Safe Pattern 2.

---

## Anti-Pattern 5: Closing `chan struct{}` Carelessly

`chan struct{}` is often used for "done" signals. The pattern looks safe because the channel has no data — there is no risk of "send after close losing a value". But the rules still apply.

```go
type Worker struct {
    done chan struct{}
}

func (w *Worker) Cancel() {
    close(w.done)
}

func (w *Worker) Restart() {
    w.done = make(chan struct{})
    close(w.done) // race with Cancel?
}
```

If `Cancel` and `Restart` race, you can get `close of closed channel` or — worse — a `close` of one channel while another goroutine still holds a reference to a closed version. Subtle, and only diagnosable by reading the stack trace and the source side-by-side.

**Rule of thumb for `chan struct{}` done channels:**

- Allocate it in the constructor and never reassign.
- Close it exactly once, from one goroutine.
- Wrap with `sync.Once` if multiple call sites might trigger close.

When done right, the done channel is the cleanest broadcast mechanism in Go. Done wrong, it has the same hazards as any other channel.

---

## Safe Pattern 1: Single-Sender Close

The simplest pattern: one goroutine, one channel, one close.

```go
func gen(n int) <-chan int {
    ch := make(chan int)
    go func() {
        defer close(ch)
        for i := 0; i < n; i++ {
            ch <- i
        }
    }()
    return ch
}
```

The goroutine that creates `ch` is the only goroutine that sends to it, and it `defer`s the close. When the goroutine exits — normally or via panic — close runs.

Use this whenever you can. The single-sender invariant is the cheapest way to avoid every close violation.

---

## Safe Pattern 2: Coordinator Goroutine Closes

When you have multiple senders feeding one channel, spawn a coordinator:

```go
func fanIn(sources []<-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    for _, src := range sources {
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
```

The `sync.WaitGroup` tracks all senders. The coordinator goroutine is separate from any sender; its only job is to wait for them all and then close. No sender ever calls `close(out)` directly.

This pattern is used inside `errgroup.Group.Wait`, inside `os/exec`'s `Wait`, and inside dozens of `pipeline.go` files in the wild.

---

## Safe Pattern 3: `sync.Once` Wrapper

When close can be triggered from several call sites — for example, shutdown and signal handling — wrap with `sync.Once`:

```go
type SafeClose struct {
    ch   chan struct{}
    once sync.Once
}

func New() *SafeClose {
    return &SafeClose{ch: make(chan struct{})}
}

func (s *SafeClose) Close() {
    s.once.Do(func() { close(s.ch) })
}

func (s *SafeClose) Done() <-chan struct{} {
    return s.ch
}
```

Now `Close()` is idempotent: calling it twice (or twenty times) closes the channel exactly once, panicking never. The cost is one `sync.Once` allocation per channel, which is usually free.

---

## Safe Pattern 4: Done Channel for Broadcast

The "close to broadcast" idiom — using close as a one-shot signal to many waiters — is the safest use of close, because the channel never carries data and only the owner closes it.

```go
type Job struct {
    done chan struct{}
}

func NewJob() *Job {
    return &Job{done: make(chan struct{})}
}

func (j *Job) Cancel() {
    close(j.done)
}

func (j *Job) Wait() {
    <-j.done
}
```

Any number of goroutines can call `Wait()` and block on `<-j.done`. When `Cancel()` is called, every waiter unblocks at once. There is no send-on-closed risk because nobody sends.

This is the pattern `context.Context.Done()` uses internally, and it is the right tool whenever you need to broadcast a cancellation or completion signal.

---

## Detecting Violations at Test Time

The Go race detector (`go test -race`, `go run -race`) does not catch close-related panics directly — they are runtime panics, not data races. But it does catch the underlying race: concurrent close and send on the same channel typically involve unsynchronised writes to the same memory, which the race detector sees.

In tests:

```go
func TestNoCloseRace(t *testing.T) {
    for i := 0; i < 1000; i++ {
        ch := make(chan int)
        go func() { close(ch) }()
        go func() {
            defer func() { recover() }()
            ch <- 1
        }()
    }
}
```

Run with `go test -race`. If the close and send touch the same memory without synchronisation, the race detector will flag it.

Three habits that help:

1. Always run CI with `-race`.
2. Stress-test channel code: loop the test 1000 times to coax out scheduler-dependent bugs.
3. Treat any `recover()` around `close` or `send` as a code smell — it is suppressing the very signal Go is trying to give you.

---

## How `range` Interacts with Close

`for v := range ch` is shorthand for:

```go
for {
    v, ok := <-ch
    if !ok {
        break
    }
    // use v
}
```

The loop exits cleanly when the channel is closed *and* fully drained. This means:

- Closing a buffered channel does not stop the loop immediately; the loop continues until the buffer is empty.
- The loop never sees the zero-value-from-closed-channel inside the body, because `ok == false` causes the break first.

So `range` is the safe, idiomatic way to consume from a channel that may be closed. Combined with single-sender close, `range` makes consumer code as short as it gets.

---

## How `select` Interacts with Close

`select` is more nuanced. A receive case on a closed channel is *always ready* and returns the zero value with `ok == false`:

```go
select {
case v, ok := <-ch:
    if !ok {
        // channel closed
    } else {
        // got value
    }
case <-time.After(time.Second):
    // timeout
}
```

This is the basis for the done-channel idiom: a closed `done` channel means "every `select` case watching it fires immediately, every time".

The corollary: if you set up a `select` that watches a closed channel without expecting it, the select will spin furiously, hitting the closed case on every iteration. The cure is to set the channel variable to `nil` after you have seen it close, which permanently disables the case (sends and receives on nil block forever):

```go
for {
    select {
    case v, ok := <-data:
        if !ok {
            data = nil // disable this case
            continue
        }
        process(v)
    case <-done:
        return
    }
}
```

Now once `data` closes, the `data` case never fires again, and the loop blocks only on `done` until it too closes.

---

## The Comma-Ok Idiom

```go
v, ok := <-ch
```

- `ok == true` and `v` holds the received value: normal case.
- `ok == false` and `v` holds the zero value: channel is closed and drained.

This is the only way to distinguish "received zero" from "channel closed". For typed channels like `chan int`, the zero value (`0`) is a legitimate datum, so the receiver must check `ok` to know which case it is.

For `chan struct{}`, the zero value and the "closed" signal are the same shape, so the idiom is less interesting — receivers usually just block on `<-done` without caring why they woke up.

---

## Buffered Channels and Close

A common source of confusion: does close discard the buffer?

No.

```go
ch := make(chan int, 3)
ch <- 1
ch <- 2
ch <- 3
close(ch)

for v := range ch {
    fmt.Println(v) // 1, 2, 3
}
```

Output: `1 2 3`. Close marks the channel as closed but leaves the three buffered values intact. The `for range` drains them, then sees `ok == false` and exits.

This is important for shutdown patterns: closing a worker's input channel does not lose work in flight; the worker can still process every value already queued.

---

## Nil-Channel Tricks vs. Closed-Channel Tricks

Both nil and closed channels have special `select` behaviour:

|                          | Send on nil | Receive on nil | Send on closed | Receive on closed |
| ------------------------ | ----------- | -------------- | -------------- | ----------------- |
| Blocks forever           | Yes         | Yes            | No (panics)    | No (returns zero) |
| Panics                   | No          | No             | Yes            | No                |
| Useful in `select`       | Yes (disable case) | Yes (disable case) | No  | Yes (always-ready) |

Two complementary idioms:

- Set a channel to nil inside a `select` to *disable* that case (it can never fire).
- Close a channel to make every `select` case on it *always fire* (broadcast).

Both are tools in the same toolbox; learning when to reach for nil versus close is a senior-level concern, but the junior takeaway is that they exist and are both legitimate.

---

## Linters and Static Checks

Several tools catch close violations:

- **`go vet`** with the `closes` analyser warns about some obvious cases (closing a receive-only channel, for example).
- **`staticcheck`** (`SA4019`, `SA4030`) flags suspicious close patterns.
- **`closechan`** is a community-maintained analyser focused on close anti-patterns: receiver closes, double close, close-of-nil.
- **Style guides** at Uber, Google, and Twitch include guidance like "only the sender closes" and "use `sync.Once` for closable types".

Add these to CI. They will not catch every bug — many close races are runtime-dependent — but they catch the obvious ones cheaply.

---

## Cross-Reference Reading

This subsection is the anti-pattern view of close. For the canonical, positive-framed treatment of closing channels, read:

- [`02-channels/06-closing-channels`](../../02-channels/06-closing-channels/) — the rules of close in the canonical channel chapter, with parallel structure to this one.
- [`07-goroutine-lifecycle-leaks`](../../07-goroutine-lifecycle-leaks/) — close failures are a major cause of goroutine leaks.
- [`08-deadlock-livelock-starvation`](../../08-deadlock-livelock-starvation/) — when nobody closes, the consumer deadlocks.
- [`20-cancellation-deep`](../../20-cancellation-deep/) — `context.Context` builds on the done-channel idiom.

Cross-referencing the canonical chapter and this anti-pattern chapter is the fastest way to internalise the rules; same content, different angle.

---

## Self-Assessment

Without scrolling up, answer:

1. What are the three runtime panics around `close`?
2. Why is "the receiver should not close" a convention rather than a runtime check?
3. Sketch the coordinator pattern for closing a fan-in channel with N senders.
4. Why does `sync.Once.Do(func() { close(ch) })` make close idempotent?
5. In `select`, what happens to a receive case on a closed channel? On a nil channel?
6. Does `close(ch)` discard buffered values? Why or why not?
7. Name two static checkers that flag close anti-patterns.
8. Describe the "done channel for broadcast" pattern in one sentence.

If any answer is fuzzy, re-read the corresponding section. If all eight are crisp, move on to the middle file.

---

## Summary

- `close` does three things: marks the channel closed, makes future sends panic, wakes blocked receivers.
- Five rules: no close on nil, no close on closed, no send on closed, receiver should not close, multi-sender needs coordination.
- The runtime enforces the first three with panics; the last two are conventions that prevent you from hitting the first three by accident.
- The five anti-patterns: receiver closes, double close, send after close, multi-producer `defer close`, careless `chan struct{}` close.
- The four safe patterns: single-sender close, coordinator goroutine, `sync.Once` wrapper, done channel for broadcast.
- `range` exits cleanly on close; `select` treats closed channels as always-ready and nil channels as never-ready.
- Static checkers (`go vet`, `staticcheck`, `closechan`) catch many close mistakes; run them in CI.

Next: the middle file digs into multi-sender coordination, pipelines, and library-grade close helpers.
