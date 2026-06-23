---
layout: default
title: Senior
parent: Channel Close Violations
grand_parent: Concurrency Anti-Patterns
ancestor: Go
nav_order: 3
permalink: /roadmap/programming-languages/golang/07-concurrency/15-concurrency-anti-patterns/03-channel-close-violations/senior/
---

# Channel Close Violations — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Ownership as a First-Class Concept](#ownership-as-a-first-class-concept)
3. [The Channel State Machine](#the-channel-state-machine)
4. [The "Only Sender Closes" Idiom Revisited](#the-only-sender-closes-idiom-revisited)
5. [Multi-Sender Fan-In: The Done-Channel Pattern](#multi-sender-fan-in-the-done-channel-pattern)
6. [Coordinator Patterns at Scale](#coordinator-patterns-at-scale)
7. [sync.Once for Safe-Close](#synconce-for-safe-close)
8. [Atomic Close-Bit Patterns](#atomic-close-bit-patterns)
9. [Double-Close Panic Semantics](#double-close-panic-semantics)
10. [Send-on-Closed Panic Semantics](#send-on-closed-panic-semantics)
11. [Quiescent-State Closing](#quiescent-state-closing)
12. [Race Window Analysis](#race-window-analysis)
13. [Library API Design](#library-api-design)
14. [Returning a Closable Channel](#returning-a-closable-channel)
15. [Cascading Close in Pipelines](#cascading-close-in-pipelines)
16. [Errors in the Close Protocol](#errors-in-the-close-protocol)
17. [Close vs Context Cancellation](#close-vs-context-cancellation)
18. [Hybrid Close+Context Idiom](#hybrid-closecontext-idiom)
19. [Testing Close Behaviour](#testing-close-behaviour)
20. [Recover as a Last-Resort Tool](#recover-as-a-last-resort-tool)
21. [Anti-Pattern Catalogue](#anti-pattern-catalogue)
22. [Self-Assessment](#self-assessment)
23. [Summary](#summary)

---

## Introduction

At junior level we listed the five rules of `close` and met the four canonical safe patterns. At middle level we focused on the multi-sender problem and learned five patterns that cover every scenario.

At senior level we stop memorising patterns and start designing them. The questions shift:

- How do I express channel ownership in a type system that has no notion of ownership?
- How do I make "you cannot misuse this API" a compile-time or initialisation-time guarantee, not a comment in a code review?
- When two reasonable patterns disagree, which one is appropriate for the system I am building?
- How do I reason about the race window between "last data" and "close" without writing prose proofs in every change request?
- How does close interact with `context.Context`, `errgroup.Group`, `sync.Cond`, `sync.WaitGroup`, atomic flags, and the rest of the synchronisation toolkit?

This document gives the answers. It is the level at which you can review an unfamiliar codebase, find the close violations from the structure of the code (not from running the program), and propose a refactor that the on-call team will trust.

What this is not: a guide to the runtime panic itself. That lives in `professional.md`. Here we stay in the design space.

---

## Ownership as a First-Class Concept

In a low-level language, ownership is visible: who allocated this, who frees it, who is allowed to write to it. In Go, the runtime owns memory; you own the lifecycle. For a channel, the lifecycle has three positions:

1. **Allocation.** `make(chan T)` or `make(chan T, n)`. Once.
2. **Use.** Sends, receives, range, select. Any number of times.
3. **Close.** `close(ch)`. Exactly zero or one time.

Position 3 is where ownership matters. There must be exactly one entity in the program with the authority to call `close`. We will call that entity the *closer*.

### The closer is not necessarily a goroutine

A common misreading of "single closer" is "single goroutine". That is too strict. The closer can be:

- A single goroutine — the simplest case.
- A coordinator goroutine that observes a `sync.WaitGroup` reach zero and then calls `close`.
- An object method protected by `sync.Once`, which guarantees that out of N concurrent calls, exactly one will run the close.
- An object method protected by an atomic compare-and-swap on a state field.
- An object method protected by a mutex and a `closed bool` flag.

What matters is that the *semantics* of single-closer hold: exactly one call to `close(ch)` is ever reachable for that channel, regardless of how many goroutines race through the code.

### Closer ≠ Owner

The closer is one role; the owner is another. The owner is the goroutine or component that decided when the channel should close. The closer is the entity that physically executes `close(ch)`. They are often the same, but not always:

- In a coordinator pattern, the senders are owners (they know when their work is done). The coordinator is the closer (it knows when all senders are done).
- In a `sync.Once` wrapper, the caller of `Close()` is the owner (it decided closure should happen). The `Once.Do` callback is the closer (it actually runs `close`).

Splitting these two roles is what makes safe-close patterns possible.

### Channel directionality as documented ownership

Go's channel direction types — `chan<- T` and `<-chan T` — are how you document ownership in the type system. They are not enforcement of correctness; they are enforcement of intent.

```go
type Producer struct {
    out chan<- Event // I own this side: sends + close
}

type Consumer struct {
    in <-chan Event // I do not own this side: I may only read
}
```

The compiler will refuse `close(c.in)` because `<-chan` cannot be closed. That is a real safety property — Rule 4 (the receiver should not close) is enforced at compile time by direction types.

The flip side: once you cast `chan T` to `chan<- T`, you have given that recipient the authority to close. Be honest about who you hand the bidirectional reference to.

### Anti-pattern: passing `chan T` because "it is more convenient"

```go
// BAD: convenience that destroys the close contract
func startWorker(jobs chan Job) { /* worker may close jobs */ }
```

If `startWorker` does not need to close `jobs`, the parameter must be `<-chan Job`. If it does need to close, the parameter must be `chan<- Job` and `startWorker` becomes the closer — at which point the caller must guarantee no other goroutine sends.

If both sides need to send, you have a multi-sender channel and must use a coordinator. There is no API that lets you pretend you do not.

### A note on private channels

If a channel never escapes a struct, the channel direction in the type signature is less critical — internal code can be reviewed for correctness. But for any channel that crosses an API boundary, the direction is your only durable contract. Senior code reviews should reject mixed-direction channels at API boundaries with the same severity as `interface{}` parameters that should be typed.

---

## The Channel State Machine

A channel has four observable states. Senior-level reasoning about close requires keeping these states sharply distinguished.

```
                  +-----+
        +-------->| nil |<--------+
        |         +-----+         |
        |            ^            |
        |  var ch    |  ch = nil  |
        |            |            |
        |       +----+----+       |
        |       |         |       |
        | make  |         |       |
        v       v         v       v
   +-----------------+ +------------------+
   | open  & empty   | | open & non-empty |
   +-----------------+ +------------------+
        ^   |     ^    ^         |
        |   |     |    | recv    | send
        |   |send |    |         v
        |   v     |    +---------+
        | (block) +-->|             |
        |              | sends fill |
        +--------+-----+ to capacity|
                 |     +-----+------+
                 v           |
            +----------------v---------+
            | closed (drainable or empty)
            +--------------------------+
                       |
                       | every receive
                       v
            +--------------------------+
            | closed & empty           |
            | (zero value forever)     |
            +--------------------------+
```

Important consequences from this state machine:

- The transitions from any open state to closed are via `close(ch)`, and they are one-way. You cannot reopen.
- The transition from nil to open requires assignment from `make`. Setting `ch = nil` after closure is a *programmer-side* convention: the runtime channel object is gone-but-not-deallocated until GC.
- The "closed & empty" state is a black hole for receivers: every receive succeeds immediately with the zero value and `ok = false`.
- `select` treats a nil case as "never ready". A closed case is "always ready (zero value)". A nil case is identical to omitting the case altogether.

### State queries

You cannot directly query whether a channel is closed. The two indirect queries are:

1. **Receive with comma-ok.** `v, ok := <-ch` — if `ok == false`, the channel is closed and drained. But this is *destructive*: if the channel was open and had data, the receive consumes it.
2. **Non-blocking receive in select.** `select { case v, ok := <-ch: ...; default: }` — also destructive if data is available.

There is no `IsClosed(ch)` because such a function would be a race by construction. The state can flip between your check and your action.

### Why no IsClosed

Consider the hypothetical:

```go
// HYPOTHETICAL: not in the language
if !runtime.IsClosed(ch) {
    ch <- v // race: another goroutine can close between check and send
}
```

Even if `IsClosed` existed, this would panic under a race. So Go simply does not expose the query — you must use one of the safe-close patterns instead.

### Buffered channels: extra dimension

A buffered channel has an additional dimension: occupancy (0..cap). Close interacts with the buffer:

- `close(ch)` does not drain the buffer. Buffered values remain available to readers.
- After close, `for range ch` will deliver every buffered value, then exit.
- After close, a single `<-ch` returns the next buffered value, or the zero value if empty.
- After close, `len(ch)` reports the number of buffered values still available.

This is sometimes useful: enqueue N work items, close, then signal workers via "channel closed" — they will still see every queued item. The pattern is called "drainable close".

---

## The "Only Sender Closes" Idiom Revisited

The conventional rule "only the sender closes" is correct but underspecified. The fully-stated form:

> Only a goroutine that holds the *exclusive* right to send on this channel may close it. If the right to send is shared, the closer is the unique entity that has aggregated the senders' right.

This is the property that makes single-sender channels easy and multi-sender channels hard. Single-sender: the only sender is also the only valid closer. Multi-sender: no individual sender can safely close without coordination.

### Single-sender, single-receiver

```go
func produce() <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 0; i < 10; i++ {
            out <- i
        }
    }()
    return out
}
```

The producer goroutine is the unique sender. It is also the closer. The `defer close(out)` is correct because no other goroutine can race with it.

### Single-sender, multi-receiver (fan-out)

```go
func produce() <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 0; i < 10; i++ {
            out <- i
        }
    }()
    return out
}

func main() {
    src := produce()
    for i := 0; i < 5; i++ {
        go func(id int) {
            for v := range src {
                fmt.Println(id, v)
            }
        }(i)
    }
    // ...
}
```

Still single-sender. The five receivers compete for items via the channel's internal locking. When the producer closes, every receiver exits its range. No close coordination required on the receiver side.

### Multi-sender, single-receiver

Now the rule breaks. If two senders each try `defer close(out)`, the second will panic. If one sender closes early, the other will panic on send. We need a coordinator (covered next).

### Multi-sender, multi-receiver

Same problem as above; receivers are not the issue, senders are.

### The "right to send" delegation

A common pattern: a coordinator goroutine has the right to send, but it delegates that right to N worker goroutines. The right is *still single* — it is held by the coordinator — but the workers borrow it temporarily.

```go
type Pool struct {
    out chan Result
    wg  sync.WaitGroup
}

func (p *Pool) Start(n int) {
    for i := 0; i < n; i++ {
        p.wg.Add(1)
        go func() {
            defer p.wg.Done()
            for {
                r, ok := compute()
                if !ok {
                    return
                }
                p.out <- r
            }
        }()
    }
    go func() {
        p.wg.Wait()
        close(p.out)
    }()
}
```

The coordinator (the third goroutine) is the closer. The workers are senders who borrow the right; they relinquish it by calling `wg.Done`. Only when all rights have been returned does the closer execute `close`.

This is the canonical idiom for multi-sender close. It works because:

1. The `wg.Add` is called *before* spawning each worker, in the parent goroutine, so the coordinator cannot wake up early.
2. The `wg.Done` is called from `defer`, so it runs even on panic.
3. The closer is a single goroutine, satisfying single-closer.
4. At the moment of close, every worker has finished or is about to finish its `defer wg.Done`, so no live send can race the close.

### Where this idiom fails

The idiom assumes that workers exit eventually. If a worker is stuck on `p.out <- r` because the receiver stopped reading, `wg.Done` is never reached, and the closer never wakes up. The whole pipeline leaks.

Sender-side deadlock is the dual of the close problem: just as you must coordinate the close, you must coordinate the unblocking of senders. The fix is to attach a done signal that aborts the send:

```go
go func() {
    defer p.wg.Done()
    for {
        r, ok := compute()
        if !ok {
            return
        }
        select {
        case p.out <- r:
        case <-p.done:
            return
        }
    }
}()
```

Now if the consumer goes away and closes `p.done`, every worker sees the cancellation and returns; `wg` reaches zero; the coordinator closes `out`. No leak.

---

## Multi-Sender Fan-In: The Done-Channel Pattern

Fan-in is the canonical multi-sender case: take N input streams, merge them into one output stream. Multi-sender close violations live here.

```go
func merge(srcs ...<-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    wg.Add(len(srcs))
    for _, s := range srcs {
        go func(s <-chan int) {
            defer wg.Done()
            for v := range s {
                out <- v
            }
        }(s)
    }
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}
```

This is the WaitGroup variant, identical in shape to the previous pool. It is correct under the assumption that every input channel will eventually close. If one input is a long-lived stream that may never close, fan-in must take a `done` channel for cancellation.

### Fan-in with done-channel cancellation

```go
func merge(done <-chan struct{}, srcs ...<-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    wg.Add(len(srcs))
    for _, s := range srcs {
        go func(s <-chan int) {
            defer wg.Done()
            for {
                select {
                case v, ok := <-s:
                    if !ok {
                        return
                    }
                    select {
                    case out <- v:
                    case <-done:
                        return
                    }
                case <-done:
                    return
                }
            }
        }(s)
    }
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}
```

Two selects, nested. The outer chooses between "receive from `s`" and "done". The inner chooses between "send to `out`" and "done". Cancellation reaches the worker whether it is blocked on receive or blocked on send.

A common simplification — merging the inner select into the outer — is wrong:

```go
// BAD: missed cancellation
select {
case v, ok := <-s:
    if !ok { return }
    out <- v // blocks forever if reader gone
case <-done:
    return
}
```

If `done` closes *after* we have received `v` but before `out <- v` completes, we are stuck. The nested form prevents this.

### Why `done` is a `<-chan struct{}` and not `chan struct{}`

The merge function takes `done <-chan struct{}`. It is a receive-only channel for two reasons:

1. The caller owns the `done` channel and is the only entity allowed to close it. Caller-side direction is `chan<- struct{}` (or `chan struct{}` if it both reads and writes). Callee-side is `<-chan struct{}`.
2. The compiler enforces that `merge` cannot accidentally `close(done)` — that would be Rule 4 (receiver closes). Rule 4 is enforced at the type system level.

### Cancellation race: receive vs done

What if `done` and a value-from-`s` are both ready simultaneously? Go's `select` picks pseudo-randomly. That is fine: under cancellation we are allowed to deliver-or-drop the value. The contract of `merge` does not promise "we delivered every input we had a chance to read"; it promises "we eventually exit cleanly".

If you do want "deliver everything you have read", reorder: check `done` only when there is no work pending. But then a stuck reader can never be cancelled. There is no free lunch; pick a side.

### Why we still need the closer goroutine

After `wg.Wait()` returns, every worker has exited. We then call `close(out)`. Could we instead skip the closer goroutine by having the *last* worker call `close(out)`?

```go
// SUBTLY BROKEN
go func(s <-chan int) {
    defer func() {
        if last := wg.Done(); last { // wg.Done() doesn't return last!
            close(out)
        }
    }()
    for v := range s { out <- v }
}(s)
```

`wg.Done()` is `void`. It does not tell you if you were the last. The standard library has no public API for "is this the last Done". You can implement one with an atomic counter, but the WaitGroup itself does not expose it:

```go
var pending int32 = int32(len(srcs))
for _, s := range srcs {
    go func(s <-chan int) {
        for v := range s { out <- v }
        if atomic.AddInt32(&pending, -1) == 0 {
            close(out)
        }
    }(s)
}
```

This is correct but loses the `wg` semantics. It is fine for small fan-in; for production pipelines, the coordinator-goroutine version is more readable and equally efficient. The atomic version saves one goroutine and a `Wait` syscall; not usually worth it.

### Fan-in with errors

If each source can fail, the merge function must propagate failures. The done channel is no longer enough — it conveys "stop" but not "why". Convert to an error channel:

```go
type Item struct {
    Value int
    Err   error
}

func merge(done <-chan struct{}, srcs ...<-chan int) <-chan Item {
    out := make(chan Item)
    var wg sync.WaitGroup
    wg.Add(len(srcs))
    for _, s := range srcs {
        go func(s <-chan int) {
            defer wg.Done()
            for {
                select {
                case v, ok := <-s:
                    if !ok { return }
                    select {
                    case out <- Item{Value: v}:
                    case <-done: return
                    }
                case <-done: return
                }
            }
        }(s)
    }
    go func() { wg.Wait(); close(out) }()
    return out
}
```

For source-level errors, embed them in the item type. Do not introduce a side-channel for errors — it adds another channel to close and another race window.

---

## Coordinator Patterns at Scale

The coordinator-WaitGroup pattern scales linearly with N senders. But there are cases where it is too heavy or too restrictive.

### Hierarchical coordinators

If you have N producers feeding M intermediate aggregators feeding 1 final output, you have a tree of close protocols. Each aggregator is a coordinator for its inputs; the root aggregator is the coordinator for the whole tree.

```go
func tree(done <-chan struct{}) <-chan int {
    // Three groups of three senders each.
    var groups []<-chan int
    for g := 0; g < 3; g++ {
        var srcs []<-chan int
        for s := 0; s < 3; s++ {
            srcs = append(srcs, gen(done, g*10+s))
        }
        groups = append(groups, merge(done, srcs...))
    }
    return merge(done, groups...)
}
```

Each layer's `merge` independently closes its output when its inputs are drained. The cascade is automatic: source closes → tier 1 drains and closes → tier 2 drains and closes → terminal channel closes.

### Coordinator on a critical path

If the coordinator goroutine becomes a hot path (many merges per second), the `wg.Wait`'s park-unpark cost matters. Two optimisations:

1. Replace the goroutine with an atomic counter as shown above.
2. If the senders themselves can never block on `out` (because the consumer is fast), share the close via `sync.Once`:

```go
type Once struct {
    once sync.Once
    out  chan T
}

func (o *Once) Send(v T) {
    select {
    case o.out <- v:
    case <-shutdown:
        o.once.Do(func() { close(o.out) })
    }
}
```

This is dangerous: now any sender can close, but `sync.Once` makes it idempotent. The risk is sending after close; that requires a different idiom (covered later).

### Generation-based coordinators

Long-running services do not close their primary channels — they reuse them across "epochs". An epoch boundary is closer to a checkpoint than a shutdown. For these, the coordinator is a state machine rather than a goroutine:

```go
type Generation struct {
    mu     sync.Mutex
    out    chan Event
    closed bool
}

func (g *Generation) Rotate() (oldOut, newOut chan Event) {
    g.mu.Lock()
    defer g.mu.Unlock()
    oldOut = g.out
    g.out = make(chan Event, cap(g.out))
    g.closed = false
    newOut = g.out
    // Caller now drains oldOut and closes it.
    return
}
```

This is generation-based ownership: at any moment, exactly one channel is the current one; the previous one is held only by goroutines that already had a reference and will eventually exit.

---

## sync.Once for Safe-Close

`sync.Once` is the smallest possible safe-close primitive when you do not care which goroutine closes — only that exactly one of them does.

```go
type SafeCh struct {
    ch   chan int
    once sync.Once
}

func New() *SafeCh             { return &SafeCh{ch: make(chan int)} }
func (s *SafeCh) Send(v int)   { s.ch <- v } // BAD: can panic
func (s *SafeCh) Close()       { s.once.Do(func() { close(s.ch) }) }
func (s *SafeCh) Recv() (int, bool) { v, ok := <-s.ch; return v, ok }
```

This is the *minimum* safe-close. Multiple callers of `Close()` are safe; subsequent calls become no-ops.

But this implementation has the send-after-close hole: a sender calling `Send(v)` after another goroutine calls `Close()` will panic. The minimal `SafeCh` is not actually safe for sending.

### Full safe-send via select on done

```go
type SafeCh struct {
    ch   chan int
    done chan struct{}
    once sync.Once
}

func New() *SafeCh {
    return &SafeCh{ch: make(chan int), done: make(chan struct{})}
}

func (s *SafeCh) Send(v int) (ok bool) {
    select {
    case <-s.done:
        return false
    default:
    }
    select {
    case s.ch <- v:
        return true
    case <-s.done:
        return false
    }
}

func (s *SafeCh) Close() {
    s.once.Do(func() { close(s.done) })
}

func (s *SafeCh) Recv() (int, bool) {
    select {
    case v := <-s.ch:
        return v, true
    case <-s.done:
        return 0, false
    }
}
```

Now `Send` cannot panic, regardless of how many goroutines call `Close` concurrently. The trick: we never close `s.ch`. We close `s.done`. The data channel remains open forever (until GC); the cancellation channel is what flips state.

This is the **single most important safe-close idiom** in production Go. It is the basis of `context.WithCancel`, `errgroup.Group`, and every well-designed concurrent library.

### Cost of `sync.Once`

`sync.Once` is two fields (one `uint32` flag, one `sync.Mutex`). The fast path is a single atomic load. The slow path acquires the mutex and runs the function exactly once.

For the safe-close pattern, the slow path runs once per channel lifetime. The cost is negligible compared to the channel itself.

### `sync.Once` is not magic

You can implement the same thing with `atomic.CompareAndSwapUint32`:

```go
type SafeCh struct {
    ch     chan int
    done   chan struct{}
    closed uint32
}

func (s *SafeCh) Close() {
    if atomic.CompareAndSwapUint32(&s.closed, 0, 1) {
        close(s.done)
    }
}
```

This is equivalent. `sync.Once` is more readable; the atomic version is microseconds faster on uncontended paths. For library code, choose readability unless profiling demands otherwise.

---

## Atomic Close-Bit Patterns

When the channel is part of a larger state machine, using `sync.Once` may not be enough — the close transition needs to be coupled with other state. Use a single atomic word to encode all the states.

```go
const (
    stateOpen   = 0
    stateDraining = 1
    stateClosed = 2
)

type Channel struct {
    state atomic.Uint32
    ch    chan Item
}

func (c *Channel) Send(it Item) error {
    if c.state.Load() != stateOpen {
        return ErrClosed
    }
    select {
    case c.ch <- it:
        return nil
    default:
        return ErrFull
    }
}

func (c *Channel) BeginDrain() {
    if c.state.CompareAndSwap(stateOpen, stateDraining) {
        close(c.ch)
    }
}
```

There is a race here: a sender that passed the `state.Load()` check can still race the `close`. Atomic-bit alone is insufficient; you must combine it with the done-channel trick or with a mutex. We will return to this in the race-window section.

### When pure-atomic is enough

If senders never block — they always use non-blocking sends with `default` — then a closed channel does not cause send-on-closed panics. Why? Because the panic happens only when `runtime.chansend` proceeds past the closed check, which requires either a waiting receiver or a slot in the buffer. A `default` arm in `select` cancels the send before the runtime is committed.

Actually — that is not quite right. Even the non-blocking send checks the closed bit *first*; if it sees closed, it panics regardless of the default arm. The default arm is only chosen if the send *cannot* proceed (e.g., buffer full, no waiter). Closed-channel panics happen during the chansend setup phase, before considering the default.

So even non-blocking sends to closed channels panic. The correct pattern is always to gate sends behind a separate "shutdown" channel.

---

## Double-Close Panic Semantics

The Go runtime detects double-close inside `runtime.closechan` and panics with "close of closed channel".

```go
ch := make(chan int)
close(ch)
close(ch) // panic: close of closed channel
```

The detection is via the channel's internal `closed` flag (a `uint32` member of `runtime.hchan`). The flag is read and written under the channel's lock. Once it is non-zero, a second `closechan` raises the panic.

### Why the panic and not a return value

In other languages (Erlang, Rust mpsc), close-on-closed is a no-op. Why does Go panic?

The Go authors chose strict failure because double-close almost always indicates a design bug: two goroutines both believe they are the closer. Silent tolerance would hide the bug. The panic forces you to think about ownership.

It also makes the spec simpler: the rule is "close exactly once", not "close at most once". No tolerance, no ambiguity.

### Where double-close arises

The vast majority of production double-closes I have seen fall into these patterns:

1. **`defer close(ch)` in multiple producers.** Each producer goroutine has its own `defer`. As they finish in any order, the second triggers panic.
2. **Cleanup in both `defer` and explicit `Stop()`.** A struct's `Close` calls `close(ch)`, and a `defer close(ch)` somewhere else is "just in case".
3. **Wrapper functions called more than once.** A `Drain()` helper that closes the underlying channel, called by both the producer and the orchestrator.
4. **Tests that close the channel manually for "cleanup" after the SUT already closed it.**
5. **Retry loops that re-enter `Close()` after an error.**

Each is a symptom of "I do not know who owns the close". The fix is always the same: identify the unique closer and remove the redundant close.

### Defensive: catch double-close with recover

You can wrap close in a recover:

```go
func safeClose(ch chan int) (closed bool) {
    defer func() {
        if r := recover(); r != nil {
            closed = false
        }
    }()
    close(ch)
    return true
}
```

This works but is bad style. Recovering a panic to fix a design bug means you are deciding to ignore a runtime invariant. Use `sync.Once` instead — same effect, no panic, no recover overhead.

---

## Send-on-Closed Panic Semantics

```go
ch := make(chan int, 1)
close(ch)
ch <- 1 // panic: send on closed channel
```

The detection is in `runtime.chansend`. After taking the channel lock, the runtime reads `c.closed`. If non-zero, it releases the lock and panics.

### Why send-on-closed cannot be made safe by buffering

Beginners sometimes hope that a buffered channel will absorb a send after close. It does not. The buffer is for blocking-vs-non-blocking; it is not for after-close semantics. Once `c.closed` is set, every send panics regardless of buffer state.

### Receive after close: zero value, ok=false

The dual is benign: receives from a closed channel succeed forever, returning the zero value with `ok == false`. This asymmetry — sends panic, receives do not — is what makes close usable as a broadcast signal.

A senior question: why this asymmetry? Why does the runtime not deliver an error to the sender instead of panicking?

The answer is that delivering an error would make `ch <- v` have a runtime type signature `error`, but it does not — it is a statement, not an expression. The language can either silently drop the send (bad: lost data) or panic (good: loud failure). Panic is the right choice given the syntax.

### Recover-around-send

```go
func trySend(ch chan int, v int) (sent bool) {
    defer func() {
        if r := recover(); r != nil {
            sent = false
        }
    }()
    ch <- v
    return true
}
```

This is a deliberate use of recover. It is acceptable in narrow cases (e.g., a logging subsystem where dropping a log line is preferable to panicking the producer), but in general avoid it: the panic indicates that the design is wrong, and recover-around-send hides the symptom while leaving the bug.

Better: use the done-channel idiom and check shutdown before send:

```go
func trySend(ch chan<- int, done <-chan struct{}, v int) bool {
    select {
    case <-done:
        return false
    case ch <- v:
        return true
    }
}
```

This requires `ch` to remain open, with `done` carrying the cancellation. The pattern eliminates the panic by construction.

---

## Quiescent-State Closing

A "quiescent" close happens when the closer waits until the system reaches a state where no sender can possibly be in progress. WaitGroup-based close is quiescent-state close: by the time `wg.Wait()` returns, every sender has finished or never started.

### Properties of quiescent close

1. **No panic possible.** No sender is live, so send-on-closed cannot happen.
2. **No drop possible.** Every send the senders intended has either completed or has been signalled to skip.
3. **Deterministic.** The closer's wakeup is causally after all sender exits.
4. **Composable.** Multiple quiescent closes nest — close the inner pipeline, observe its closure, then close the outer.

The downside: quiescent close requires that senders cooperate (return when signalled). Misbehaving senders (e.g., stuck on an unrelated network call) prevent quiescence indefinitely.

### Non-quiescent close: snapping the channel

Sometimes you cannot wait for quiescence — the consumer has crashed, the timeout has fired, the user pressed Ctrl-C. You want to close *now*, accept the risk that some senders may still be in flight, and use the safe-send idiom to avoid panics.

The snap-close form:

```go
type Channel struct {
    ch   chan Item
    done chan struct{}
    once sync.Once
}

func (c *Channel) Send(v Item) bool {
    select {
    case <-c.done:
        return false
    case c.ch <- v:
        return true
    }
}

func (c *Channel) Shutdown() {
    c.once.Do(func() {
        close(c.done)
        // Note: we do NOT close c.ch
    })
}
```

After `Shutdown`, `c.ch` remains open. Senders learn from `c.done` and stop. The data channel is GC'd when both Sender and Receiver references are released.

This is exactly the pattern in `context.WithCancel`: `cancel()` closes the done channel, not the channel of values.

### Trade-off: leaked values

Snap-close may drop values: a sender that was mid-construction of `v` and about to call `Send` will skip the send entirely. This is acceptable for cancellation but unacceptable for "graceful shutdown with no data loss". Graceful shutdown must be quiescent.

---

## Race Window Analysis

The race window of a close pattern is the interval during which a sender's "is it safe to send?" check is no longer accurate. Patterns differ in how they shrink this window.

### Pattern 1: bare `defer close`

```go
go func() {
    defer close(ch)
    for v := range src { ch <- v }
}()

// Elsewhere:
go func() {
    for v := range src2 { ch <- v }
}()
```

Race window: the entire lifetime of the second sender. The first sender's `defer close` can fire at any moment, including while the second sender is in the middle of `ch <- v`. This is "no synchronisation"; the program is broken.

### Pattern 2: WaitGroup coordinator

```go
wg.Add(2)
go func() { defer wg.Done(); for v := range src { ch <- v } }()
go func() { defer wg.Done(); for v := range src2 { ch <- v } }()
go func() { wg.Wait(); close(ch) }()
```

Race window: zero. By the time `wg.Wait` returns, both senders have completed their last send and executed `wg.Done`. The close fires causally after both sends.

The "causal after" claim depends on the memory model: `wg.Done` happens-before the `wg.Wait` return, which happens-before the `close(ch)`. The senders' last `ch <- v` happens-before their `wg.Done`. Transitive: last send happens-before close. Safe.

### Pattern 3: sync.Once + done-channel

```go
type C struct {
    ch   chan int
    done chan struct{}
    once sync.Once
}
func (c *C) Send(v int) bool {
    select {
    case <-c.done: return false
    case c.ch <- v: return true
    }
}
func (c *C) Close() { c.once.Do(func() { close(c.done) }) }
```

Race window: zero, but for a different reason. The data channel is never closed, so send-on-closed cannot happen. Instead, the done-channel select forms a race-free choice: either the send completes (no concurrent close because the data channel does not close), or the done-channel signals and the send is abandoned.

### Pattern 4: mutex + closed flag

```go
type C struct {
    mu     sync.Mutex
    ch     chan int
    closed bool
}
func (c *C) Send(v int) bool {
    c.mu.Lock()
    defer c.mu.Unlock()
    if c.closed { return false }
    c.ch <- v  // BAD: blocks while holding lock; deadlock if buffer full
    return true
}
```

This deadlocks under load: a slow receiver will block `Send`, which holds the mutex; `Close` cannot acquire the mutex; the system stalls. Pattern 4 is acceptable only for buffered channels with `select default`:

```go
func (c *C) Send(v int) bool {
    c.mu.Lock()
    defer c.mu.Unlock()
    if c.closed { return false }
    select {
    case c.ch <- v:
        return true
    default:
        return false // buffer full, drop
    }
}
```

Now Send never blocks. The race window is zero: `c.closed` and `c.ch <- v` happen under the same mutex; close-after-send-started is impossible because they cannot interleave.

The trade-off: any send that could block is lost.

### Comparison table

| Pattern              | Window | Drops? | Blocks senders? | Use case                       |
|----------------------|--------|--------|------------------|--------------------------------|
| Bare `defer close`   | huge   | n/a    | maybe            | NEVER (broken)                 |
| WaitGroup coord.     | zero   | no     | no               | Quiescent close                |
| Once + done          | zero   | yes    | no               | Snap-close, cancellation       |
| Mutex + flag + select| zero   | yes    | no               | Buffered drop-on-full          |
| Mutex + flag + send  | zero   | no     | yes              | Buffered, slow ok              |
| Atomic flag          | non-zero | yes  | no               | NEVER (race-prone, see below) |

The atomic-flag-without-done pattern is unsafe because of the read-then-act race we covered earlier. Avoid it.

---

## Library API Design

When you design a library that exposes a channel, you are making an ownership decision that the caller cannot override. Get it wrong and your users will have close-violation panics that they cannot fix without forking your code.

### Three-channel choices for library APIs

For each channel a library exposes, you choose:

1. Who closes it — library or caller?
2. Who sends — library or caller?
3. Who receives — library or caller?

If library sends and caller receives, the library is the closer. The library returns `<-chan T`. Caller cannot accidentally close.

If caller sends and library receives, the caller is the closer. The library returns `chan<- T`. Library cannot accidentally close.

If both send (a bidirectional pipe), the close ownership is contested. Use a `Close()` method on the library object, not direct close on the channel. The channel itself should be hidden behind methods.

### The "I expose the channel" mistake

```go
// BAD: library returns chan T (bidirectional)
func (s *Streamer) Out() chan Event {
    return s.out
}
```

Now the caller can close `s.out`. The library cannot defend itself. Two production bugs from this pattern in our codebase:

1. A test did `defer close(stream.Out())` for cleanup. The library's own close routine then double-closed. Panic in test, found in CI.
2. A consumer wanted to "stop listening" and called `close(stream.Out())`. The library was still sending. Panic in production.

The fix is to expose the channel only as receive-only:

```go
func (s *Streamer) Out() <-chan Event { return s.out }
func (s *Streamer) Close() { s.once.Do(func() { close(s.out) }) }
```

Now the caller cannot close. The library's `Close()` is idempotent.

### Avoid exposing the channel at all

Better: expose only methods. The channel becomes an implementation detail.

```go
func (s *Streamer) Next() (Event, bool) { v, ok := <-s.out; return v, ok }
func (s *Streamer) Close()              { /* idempotent */ }
```

This is more verbose but ironclad: the caller cannot misuse a channel they cannot see.

The downside: callers can no longer use `range`, `select`, or `len`. For simple iteration use cases, that is a real loss.

A middle ground: expose a `for-range`-compatible interface via Go 1.23 range-over-func:

```go
func (s *Streamer) All(yield func(Event) bool) {
    for v := range s.out {
        if !yield(v) { return }
    }
}

// caller:
for v := range streamer.All { ... }
```

The library still owns the channel; the caller gets iteration. This is the modern idiom.

---

## Returning a Closable Channel

If your API really must let the caller close the channel — for example, because the channel represents work the caller submits — design carefully.

### Pattern: return chan<- T

```go
func (s *Submitter) Submit() chan<- Job {
    return s.jobs
}
```

The caller can send and close. The library is the receiver. The library's receiver loop should:

```go
for j := range s.jobs {
    s.handle(j)
}
```

When the caller closes, the receiver exits cleanly. Note that the caller is now responsible for not double-closing — and we cannot help them.

### Wrapper struct with documented Close

The friendlier pattern is a wrapper:

```go
type Submitter struct {
    jobs chan Job
    once sync.Once
}

func (s *Submitter) Submit(j Job) error {
    defer func() { _ = recover() }() // catch send-on-closed
    s.jobs <- j
    return nil
}

func (s *Submitter) Close() {
    s.once.Do(func() { close(s.jobs) })
}
```

The wrapper:

- Has idempotent `Close` (sync.Once).
- Has safe `Submit` (catches the panic if someone closes between check and send — though this still loses the value).

The recover-on-send is a deliberate concession to robust APIs: callers will call Submit and Close concurrently no matter what your docs say.

### Cleaner: refuse send after close via select+done

```go
type Submitter struct {
    jobs chan Job
    done chan struct{}
    once sync.Once
}

func (s *Submitter) Submit(j Job) error {
    select {
    case <-s.done:
        return ErrClosed
    case s.jobs <- j:
        return nil
    }
}

func (s *Submitter) Close() {
    s.once.Do(func() { close(s.done) })
}
```

Now `Submit` returns an error rather than panicking. The library can decide whether to close `s.jobs` itself (after observing `s.done`, to release the receiver) or to leave it for GC.

If the receiver also reads from `s.done` first, the library can simply stop reading and let GC reclaim the channel:

```go
func (s *Submitter) loop() {
    for {
        select {
        case <-s.done:
            return
        case j := <-s.jobs:
            s.handle(j)
        }
    }
}
```

After `Close`, the loop exits, references to `s.jobs` are dropped, and GC frees it. No close on `s.jobs` required.

---

## Cascading Close in Pipelines

A pipeline is a sequence of stages connected by channels. Close cascades from one stage to the next.

```go
gen → filter → transform → sink
```

The producer (`gen`) closes its output when done. `filter` ranges over `gen`'s output and closes its own output when the range exits. `transform` does the same. Finally `sink` consumes from `transform`'s output and exits when the range closes.

```go
func gen(n int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 0; i < n; i++ { out <- i }
    }()
    return out
}

func filter(in <-chan int, p func(int) bool) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for v := range in {
            if p(v) { out <- v }
        }
    }()
    return out
}

func transform(in <-chan int, f func(int) int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for v := range in {
            out <- f(v)
        }
    }()
    return out
}
```

Each stage is a single-sender to a single output channel. `defer close(out)` is correct. The cascade is automatic.

### Cancellation in pipelines

If the consumer stops early, every stage upstream blocks on its send. Goroutine leak. Fix: every stage takes a `done` channel.

```go
func filter(done <-chan struct{}, in <-chan int, p func(int) bool) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for v := range in {
            if !p(v) { continue }
            select {
            case out <- v:
            case <-done:
                return
            }
        }
    }()
    return out
}
```

If `done` closes, every stage exits. The `defer close(out)` cascades.

### Why every stage needs the done channel

Imagine `gen` does *not* take `done`. The consumer cancels, but `gen` is mid-send on a full buffer. Backpressure: every upstream stage is blocked because no one is receiving. `gen` never sees the cancellation. The pipeline stalls forever.

Putting `done` only at the source is insufficient: source can produce indefinitely. Putting `done` only at the sink is insufficient: source still blocks on full buffers upstream. Every stage needs cancellation.

### context.Context as the done channel

Modern pipelines use `context.Context` instead of a bare `<-chan struct{}`:

```go
func filter(ctx context.Context, in <-chan int, p func(int) bool) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for v := range in {
            if !p(v) { continue }
            select {
            case out <- v:
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}
```

Context propagates deadline and cause information; it is the strictly more capable choice. Use `<-chan struct{}` only when context is unavailable or overkill (e.g., a tiny library that does not want a context dependency).

### Cascading errors

Errors are not part of `close`. If a stage encounters an error mid-pipeline, it must somehow signal failure to all other stages. Two patterns:

1. **Embed errors in the data type.** `chan Result` where `Result` has both value and error fields.
2. **Use `errgroup`.** Each stage's goroutine is registered with the errgroup; the first error cancels the errgroup's context, which all stages observe via `ctx.Done()`.

The second pattern is cleaner because it unifies the close cascade with the error cascade.

```go
func pipeline(ctx context.Context) error {
    g, ctx := errgroup.WithContext(ctx)
    src := gen(ctx, 100)
    filt := filter(ctx, src, isEven)
    xform := transform(ctx, filt, square)
    g.Go(func() error {
        for v := range xform {
            if err := store(v); err != nil { return err }
        }
        return nil
    })
    return g.Wait()
}
```

If `store` returns an error, `errgroup` cancels `ctx`, every upstream stage observes `ctx.Done()`, the cascade closes everything. `g.Wait()` returns the first error.

---

## Errors in the Close Protocol

Close is silent: there is no "I am closing because of an error" channel. Three integration patterns:

### 1. Side-channel error

Add an `errCh chan error` parallel to the data channel. The sender writes its terminal error there before closing the data channel.

```go
func gen() (<-chan int, <-chan error) {
    out := make(chan int)
    errCh := make(chan error, 1)
    go func() {
        defer close(out)
        defer close(errCh)
        for {
            v, err := readNext()
            if err != nil {
                errCh <- err
                return
            }
            out <- v
        }
    }()
    return out, errCh
}
```

Caller:

```go
out, errs := gen()
for v := range out { use(v) }
if err := <-errs; err != nil { return err }
```

Order matters: drain `out` first, then read `errs`. If you read `errs` first, you may deadlock — the sender writes to `errs` after closing `out`, so you cannot block on `errs` until you have drained `out`.

### 2. Embedded error in result

Replace `chan int` with `chan Result`:

```go
type Result struct {
    Value int
    Err   error
}

func gen() <-chan Result {
    out := make(chan Result)
    go func() {
        defer close(out)
        for {
            v, err := readNext()
            if err != nil {
                out <- Result{Err: err}
                return
            }
            out <- Result{Value: v}
        }
    }()
    return out
}
```

Caller:

```go
for r := range gen() {
    if r.Err != nil { return r.Err }
    use(r.Value)
}
```

Cleaner. One channel, one close. Error is just another value.

### 3. errgroup context cancellation

The errgroup pattern from the previous section folds errors and cancellation into one mechanism. The data channels do not carry errors — the cancellation context does. After `g.Wait()` returns the error, the caller knows what happened.

This is the most idiomatic modern style.

---

## Close vs Context Cancellation

A common senior-level question: when do I close a channel as a signal, vs use `ctx.Done()`?

### Close is for "I produced everything"

`close(out)` semantically says: "I have nothing more to send. You may stop reading."

It is a *natural-end* signal, not a *please-stop* signal. The producer is done; the consumer should finish.

### context.Done is for "stop, abort"

`<-ctx.Done()` semantically says: "the consumer (or its parent) wants you to abort. Drop what you are doing."

It is a *please-stop* signal, originating outside the producer.

### Both are needed

A robust system uses both:

- Producer closes its output when it has produced everything.
- Consumer cancels the context when it wants to abort.
- Producer's send loop selects on `ctx.Done()` to abandon mid-send.
- Consumer's receive loop selects on `ctx.Done()` and on the data channel (with `ok`).

```go
func produce(ctx context.Context) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 0; ; i++ {
            select {
            case <-ctx.Done():
                return
            case out <- i:
            }
        }
    }()
    return out
}

func consume(ctx context.Context, in <-chan int) {
    for {
        select {
        case <-ctx.Done():
            return
        case v, ok := <-in:
            if !ok { return }
            use(v)
        }
    }
}
```

Cancellation closes `ctx.Done()`. Natural completion closes `in`. Both lead the consumer to return.

### Why not just close?

Why not use close instead of context? Because close is one-directional: producer signals consumer. Context is hierarchical: any parent can signal any descendant, including across many channels and goroutines simultaneously.

Context also carries deadline and value (cause), which close cannot.

### Why not just context?

Why not use context instead of close? Because context cannot deliver values. It is a signal only. You still need a data channel; close on that data channel signals "I produced all I will". Context handles the abort case; close handles the natural-end case.

A pipeline that only uses context can leak buffered data: the consumer may not know how many items the producer had queued before cancellation. Using close + context together gives the consumer "drain remaining" semantics:

```go
case v, ok := <-in:
    if !ok { return } // producer ended cleanly
    use(v)
case <-ctx.Done():
    // optional: drain remaining buffered items
    for {
        select {
        case v, ok := <-in:
            if !ok { return }
            use(v)
        default:
            return
        }
    }
```

---

## Hybrid Close+Context Idiom

The canonical senior-level pipeline uses three concurrent signals:

1. **Data channel `out`.** Producer→consumer values. Closed by producer when done.
2. **Context `ctx`.** Consumer→producer abort. Closed by consumer or parent.
3. **Sync structure (WaitGroup or errgroup).** Closer wait for producer goroutines.

```go
func pipeline(ctx context.Context) error {
    out := make(chan Result)
    g, gctx := errgroup.WithContext(ctx)

    g.Go(func() error {
        defer close(out)
        for i := 0; i < 1000; i++ {
            select {
            case <-gctx.Done():
                return gctx.Err()
            case out <- compute(i):
            }
        }
        return nil
    })

    g.Go(func() error {
        for r := range out {
            if err := consume(gctx, r); err != nil {
                return err
            }
        }
        return nil
    })

    return g.Wait()
}
```

`errgroup.WithContext` returns a derived context that cancels on first error. Producer observes `gctx.Done()`. Producer closes `out` on its way out (via `defer`). Consumer ranges over `out`; range exits when `out` is closed.

This pattern is the right answer to almost every "design a pipeline" interview question.

---

## Testing Close Behaviour

Close races are notoriously hard to test because they are timing-dependent. Three strategies:

### 1. Channel close is observable

Tests can call `<-ch` after a `Close()` and assert that `ok` is false. This catches "did the library close the channel" but not race conditions.

```go
func TestClose(t *testing.T) {
    s := New()
    s.Close()
    if _, ok := s.Recv(); ok {
        t.Fatal("expected closed")
    }
}
```

### 2. Stress with -race

The race detector catches send-on-closed and double-close in many cases. Drive the SUT from many goroutines simultaneously.

```go
func TestConcurrentClose(t *testing.T) {
    s := New()
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() { defer wg.Done(); s.Close() }()
    }
    wg.Wait()
}
```

If `Close` is not idempotent, this panics on a Go runtime check (not race detector, but `panic: close of closed channel`). Run with `go test -race -count=100` to catch sporadic ordering.

### 3. Inject ordering via channels

For deterministic race window tests, inject a synchronisation point:

```go
type spyChannel struct {
    *Channel
    beforeClose chan struct{}
}

func (s *spyChannel) Close() {
    <-s.beforeClose
    s.Channel.Close()
}
```

The test can now control exactly when `Close` proceeds, ensuring it interleaves with a sender at a chosen point.

This is overkill for most cases. Prefer pure stress tests with the race detector, plus careful design review.

### 4. Property tests

For libraries with rich close semantics (error propagation, ordering of drains, etc.), property-based tests are valuable. Generate random sequences of "send" and "close" operations; assert invariants like "no panic", "every accepted send appears at the receiver", "after close, no more sends accepted".

The `testing/quick` package or third-party `gopter` work. The investment is high; reserve it for foundational libraries.

---

## Recover as a Last-Resort Tool

`recover()` can catch close-related panics. It is the wrong tool for almost all cases, but there are a few where it is appropriate.

### Appropriate: legacy API integration

You receive a `chan T` from external code that you cannot modify, and there is no documented close protocol. You want to send safely.

```go
func sendBestEffort(ch chan<- T, v T) (sent bool) {
    defer func() {
        if r := recover(); r != nil {
            sent = false
        }
    }()
    ch <- v
    return true
}
```

This is a defensive bridge. Mark it clearly as such. The first opportunity, refactor the external API to use a safe-close pattern.

### Appropriate: panic-tolerant logger

Loggers should never panic the application. If the log channel is closed for some reason (perhaps during shutdown), the log call should be a no-op, not a fatal error.

```go
func (l *Logger) Log(msg string) {
    defer func() { _ = recover() }()
    select {
    case l.ch <- msg:
    default:
        // log buffer full, drop
    }
}
```

Note: even in this case, `select default` doesn't help against close-panic. We still need the recover.

### Inappropriate: covering up design bugs

If your code panics on close in normal operation, recover is not the fix. The fix is to identify why the close protocol is wrong and rebuild it.

### Performance cost of recover

`defer ... recover` costs a few hundred nanoseconds per send, even when no panic occurs (deferred function setup). For hot paths, this matters; for cold paths or library APIs, it does not.

If you must use recover but care about performance, hoist the recover to a single outer goroutine. Senders inside that goroutine inherit its recovery without per-send defer overhead.

---

## Anti-Pattern Catalogue

A reference list of the close-related anti-patterns reviewers should reject on sight.

### 1. defer close in every producer

```go
go func() { defer close(ch); /* send */ }()
go func() { defer close(ch); /* send */ }()
```

Double-close in flight. Use a coordinator.

### 2. Receiver closes the channel

```go
for v := range ch {
    if shouldStop(v) { close(ch) }
}
```

Send-on-closed in any in-flight sender. Use a done-channel separate from the data channel.

### 3. Atomic flag without done channel

```go
if atomic.LoadInt32(&c.closed) == 0 {
    ch <- v
}
```

Race between check and send. Add a done channel.

### 4. close to "free resources"

```go
defer close(ch) // for cleanup
```

If the goroutine is not the closer, this is wrong. Resources are not freed by close; the channel is reclaimed by GC when all references drop.

### 5. Closing a channel passed in

```go
func work(ch chan int) { close(ch); /* ... */ }
```

You do not own a channel given to you. The caller may have other plans for it.

### 6. Close in select default

```go
select {
case ch <- v:
default:
    close(ch) // ???
}
```

Closing because the channel is full is nonsense. The buffer being full is unrelated to closure.

### 7. Close-and-recreate

```go
close(ch)
ch = make(chan int)
```

Re-assignment doesn't bring old senders forward. They are still sending on the closed channel. Use a new variable name (and a new struct field), or rotate channels with proper coordination.

### 8. Conditional defer close

```go
defer func() {
    if shouldClose { close(ch) }
}()
```

Whoever sets `shouldClose` from another goroutine causes a race. Either the goroutine always closes, or it never closes.

### 9. Closing a nil channel

```go
var ch chan int
close(ch) // panic: close of nil channel
```

Always check or always initialise. The runtime panics because the runtime cannot mark a nil channel as closed — there is no channel.

### 10. Sending to a channel parameter without ownership clarification

```go
func emit(ch chan int) { ch <- 1 } // may or may not close downstream
```

`chan int` is a code smell at API boundaries. Use `chan<- int`.

### 11. for range on a never-closed channel

```go
for v := range ch { ... } // ch never closes
```

Loop never exits; goroutine leaks. Either close ch eventually, or use select with `ctx.Done()`.

### 12. close to indicate "error happened"

```go
if err != nil { close(out) }
```

Close means "no more data". Use a separate error channel or embed the error in the result.

### 13. Implicit close via panic-and-recover

```go
defer recover() // catches close panics, but who closed?
```

If you don't know who closed, you don't know the system. Find out.

### 14. Reading length to gate sends

```go
if len(ch) < cap(ch) { ch <- v }
```

`len` is a snapshot; another goroutine can fill the buffer between check and send. Use non-blocking send via `select default`.

### 15. close inside the receive loop

```go
for v := range ch {
    if done(v) { close(ch); break }
}
```

If another sender is in flight, panic. Use a done-channel and let the producer close on its own.

### 16. Wrapping close in a method called by both Close and Reset

```go
type C struct { ch chan int }
func (c *C) Close() { close(c.ch) }
func (c *C) Reset() { close(c.ch); c.ch = make(chan int) }
```

`Close` then `Reset` double-closes. `Reset` then `Close` reuses the old reference if any sender held it. Both fail. Channels are not the right primitive for resettable resources; use a state machine with a generation counter.

### 17. Treating close as a synchronisation barrier

```go
close(start) // signal all workers to begin
```

This works *only* if `start` was never closed before and only as a single-shot fire. Reset is impossible. For repeatable barriers, use `sync.Cond` or rotate channels.

### 18. Closing a chan returned from a third-party API

```go
ch := lib.Events()
defer close(ch) // do not own this channel
```

The library may close it itself, may send forever, may pool the channel for reuse. You do not have the authority. Read the docs; if the docs do not say, assume you must not close.

### 19. Closing during init for "fast path on no-data"

```go
if !needsData { close(ch) } // race with sender starting
```

If the channel was already given to a goroutine that may now try to send, you have a race. Construction-time close is acceptable only if you have not yet exposed the channel.

### 20. close-as-error-broadcast across packages

```go
// package A
var Errors = make(chan error)

// package B
close(A.Errors) // signal failure
```

Cross-package writes to shared channels are a code smell on their own. Cross-package close is a guaranteed bug; package A cannot defend itself against a panic on a future send.

---

## Selecting on Multiple Closes

A common multi-step shutdown reads from several "done" sources. Each is a `<-chan struct{}` that closes when its source asks for shutdown. The receiver wakes up when any source closes.

```go
func waitAny(a, b, c <-chan struct{}) int {
    select {
    case <-a: return 0
    case <-b: return 1
    case <-c: return 2
    }
}
```

This is the basis of `context` propagation: `ctx.Done()` of a child unblocks when the parent's done unblocks, when its own cancel is called, or when its deadline passes.

The internal implementation merges multiple closes into one observable close via a propagating goroutine — covered in `professional.md`.

### Anti-pattern: blocking select on closed channels

If two of three channels are closed, a select still chooses pseudo-randomly. A naive `waitAny` may wake up on the wrong source. The fix is to check sources in priority order:

```go
func waitAny(a, b, c <-chan struct{}) int {
    // prefer a if already closed
    select {
    case <-a: return 0
    default:
    }
    select {
    case <-a: return 0
    case <-b: return 1
    case <-c: return 2
    }
}
```

The first `select` with `default` is a non-blocking poll on `a`. If `a` is closed, return immediately. Otherwise fall through to the blocking select.

This idiom is rare but matters when shutdown has well-defined priority: e.g., a SIGKILL channel must win over a normal SIGINT channel.

---

## The Three-State Channel

Some libraries need three channel states: open-for-business, draining (no new accepts, finish existing), and closed (no more activity). The state machine is one-way: open → draining → closed.

```go
type Server struct {
    mu       sync.Mutex
    state    int32 // atomic-loadable
    accept   chan Conn
    done     chan struct{}
    drain    chan struct{}
    wg       sync.WaitGroup
}

const (
    open int32 = iota
    draining
    closed
)

func (s *Server) Accept(c Conn) error {
    if atomic.LoadInt32(&s.state) != open {
        return ErrNotOpen
    }
    select {
    case s.accept <- c:
        s.wg.Add(1)
        return nil
    case <-s.drain:
        return ErrNotOpen
    }
}

func (s *Server) BeginDrain() {
    if !atomic.CompareAndSwapInt32(&s.state, open, draining) {
        return
    }
    close(s.drain)
}

func (s *Server) Wait() {
    s.wg.Wait()
}

func (s *Server) Shutdown(ctx context.Context) error {
    s.BeginDrain()
    waitCh := make(chan struct{})
    go func() { s.wg.Wait(); close(waitCh) }()
    select {
    case <-waitCh:
        atomic.StoreInt32(&s.state, closed)
        close(s.done)
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

This is the `http.Server.Shutdown` shape. Two close-channels (drain, done) plus a WaitGroup. Note that we never close `s.accept`: doing so would race with Accept callers.

### Why three states matter

Real systems need a graceful-shutdown phase between "accepting" and "stopped":

- **Open.** All callers welcome.
- **Draining.** Existing connections served; new connections rejected. Time-bounded.
- **Closed.** Nothing accepts; nothing serves.

Two-state systems (open/closed) lose connections on shutdown. They are appropriate only for stateless throwaway workers, not for servers handling user requests.

---

## Closing Buffered Channels with Pending Data

A buffered channel close does not flush the buffer. Receivers can still drain the buffered values after close.

```go
ch := make(chan int, 3)
ch <- 1
ch <- 2
ch <- 3
close(ch)
for v := range ch {
    fmt.Println(v) // 1, 2, 3, then loop exits
}
```

This is occasionally useful: produce N items, close, hand to consumer. Consumer sees all items, then exits cleanly. Synchronisation-free.

### Anti-pattern: assuming close blocks until drained

```go
close(ch)
// At this point, ch may still have buffered items.
// Reads from ch will return them. Do not assume "channel is empty".
```

Close is a single instruction. It does not wait. If your code logic depends on "after close, no more values", you are wrong; use `for range` to drain.

### Pattern: enqueue-then-close

```go
func batch(items []Item) <-chan Item {
    ch := make(chan Item, len(items))
    for _, it := range items {
        ch <- it
    }
    close(ch)
    return ch
}
```

The producer enqueues N items synchronously (cheap, since the buffer is big enough), closes, and returns. No goroutine needed. The consumer ranges and sees every item.

This is a *zero-goroutine* concurrency pattern. It is useful for tests and for cases where the entire dataset fits in memory.

---

## Drain-then-close vs Close-then-drain

Two ways to "stop a channel cleanly":

### Drain-then-close

```go
for v := range ch { ... } // drain whatever sender has sent
// Sender's defer close fires when sender finishes
```

The consumer drains until the channel closes. The sender is the closer. This is the natural flow.

### Close-then-drain

```go
close(ch) // sender stops; receiver drains buffer
for v := range ch { ... } // collects buffered items, then exits
```

The sender closes proactively (e.g., on cancellation), and the receiver drains the buffer. This requires that no sender is in flight — otherwise the close panics future sends.

For pure-buffered, pure-batch patterns, close-then-drain is fine. For live producers, drain-then-close is the only safe path.

---

## Channel Reuse Pitfalls

A channel is a one-time resource. You cannot reopen it. Patterns that try to "reset" a channel are usually wrong.

### Anti-pattern: nil to "deactivate" instead of close

```go
type C struct {
    ch chan int
}
func (c *C) Deactivate() { c.ch = nil }
```

This does not propagate. Existing goroutines that captured the old `ch` still hold their reference; they will continue to send into a channel that no one reads. The new readers see `nil` and block forever.

Channels are values that propagate through reference. Reassigning a field is not how you change channel state.

### Anti-pattern: pool of channels

```go
var pool = sync.Pool{New: func() interface{} { return make(chan int, 16) }}

func get() chan int {
    return pool.Get().(chan int)
}
func put(ch chan int) {
    // drain
    for { select { case <-ch: default: goto done } }
done:
    pool.Put(ch)
}
```

Tempting (avoid allocation per request) but broken:

- `select default` in a loop can drop values if a sender beat the drain.
- Pooled channels cannot be closed; downstream code that ranges over them blocks forever.
- A retained sender reference is a footgun: it can send into the pooled channel after some other consumer picked it up.

Do not pool channels. The allocation cost of `make(chan T)` is small (under 100 ns for unbuffered). Buffered allocate one extra slice. Pooling is rarely worth the correctness risk.

### Acceptable: generation-keyed maps

If you need many channels and want to reuse the *slots*, key them by generation:

```go
type Reg struct {
    mu  sync.Mutex
    chs map[uint64]chan int
}

func (r *Reg) Get(gen uint64) chan int {
    r.mu.Lock()
    defer r.mu.Unlock()
    if ch, ok := r.chs[gen]; ok { return ch }
    ch := make(chan int)
    r.chs[gen] = ch
    return ch
}

func (r *Reg) Done(gen uint64) {
    r.mu.Lock()
    defer r.mu.Unlock()
    if ch, ok := r.chs[gen]; ok {
        close(ch)
        delete(r.chs, gen)
    }
}
```

A new channel per generation; the map holds them; close-and-delete on retire. No pooling, no reuse, but no allocation explosion either because the map slots are reused.

---

## Type-Level Close Contracts

A small but high-leverage technique: encode the close contract in the type, not in documentation.

### Read-only channel return

```go
func Watch() <-chan Event { ... }
```

The caller cannot close `Watch`'s return. The contract is enforced at compile time.

### Send-only channel parameter

```go
func Submit(jobs chan<- Job) { ... }
```

`Submit` can send but not close. Combined with a receiver in the calling code, this gives the caller close authority.

### Channel-of-channels for completion signalling

```go
type WorkItem struct {
    Data  Input
    Reply chan<- Output
}
```

A work item carries its own reply channel (send-only from the worker's perspective). The submitter receives on the reply. The reply channel's lifetime is one round-trip; no close is needed. After receive, the submitter drops its reference; GC frees the channel.

This is the request-reply pattern. It avoids cross-cutting close protocols.

### Channel of `chan struct{}` for fan-out triggering

```go
type Broadcaster struct {
    subs []chan struct{}
}

func (b *Broadcaster) Subscribe() <-chan struct{} {
    ch := make(chan struct{}, 1)
    b.subs = append(b.subs, ch)
    return ch
}

func (b *Broadcaster) Trigger() {
    for _, ch := range b.subs {
        select { case ch <- struct{}{}: default: }
    }
}
```

This is a fan-out pattern that does not close any channel; subscribers receive a struct{} each time Trigger is called. The buffer of 1 prevents missed events when subscribers are slow.

Subscribers stop listening by dropping their reference; the broadcaster does not need to know.

---

## Closing Channels Carried Inside Structs

When a channel is a struct field, the struct's lifecycle should drive close.

```go
type Worker struct {
    in   chan Job
    done chan struct{}
    wg   sync.WaitGroup
}

func NewWorker(buf int) *Worker {
    w := &Worker{
        in:   make(chan Job, buf),
        done: make(chan struct{}),
    }
    w.wg.Add(1)
    go w.run()
    return w
}

func (w *Worker) Submit(j Job) error {
    select {
    case <-w.done:
        return ErrClosed
    case w.in <- j:
        return nil
    }
}

func (w *Worker) Close() {
    select {
    case <-w.done:
        return // already closed
    default:
    }
    close(w.done)
    w.wg.Wait()
}

func (w *Worker) run() {
    defer w.wg.Done()
    for {
        select {
        case <-w.done:
            return
        case j := <-w.in:
            j.Do()
        }
    }
}
```

Two close patterns are wrong here. Let's enumerate them:

1. **Closing `w.in`.** Sends to `w.in` may be in flight. Panic.
2. **Closing `w.done` twice.** A naive `Close` may be called from two goroutines.

The fix: gate the close with a select-default:

```go
func (w *Worker) Close() {
    select {
    case <-w.done:
        return
    default:
    }
    close(w.done)
    w.wg.Wait()
}
```

But this has a race: two callers can both pass the default arm. The fix is `sync.Once`:

```go
type Worker struct {
    in   chan Job
    done chan struct{}
    wg   sync.WaitGroup
    once sync.Once
}

func (w *Worker) Close() {
    w.once.Do(func() {
        close(w.done)
    })
    w.wg.Wait()
}
```

Now any number of concurrent Close calls produces exactly one close and one wait. The wait is outside the `Once.Do` so each caller blocks until completion.

### Pointer vs value receivers

`Close` must be a pointer receiver: copying the struct would also copy the `sync.Once`, defeating its purpose. Lint check this; `vet` will complain on a sync.Once-by-value.

---

## Composing Closes Across Modules

A larger system has many modules each with their own `Close` method. Composing them safely is a design challenge.

### Sequential close

```go
func (s *Server) Close() error {
    var errs []error
    if err := s.api.Close(); err != nil { errs = append(errs, err) }
    if err := s.workers.Close(); err != nil { errs = append(errs, err) }
    if err := s.db.Close(); err != nil { errs = append(errs, err) }
    return errors.Join(errs...)
}
```

Pros: deterministic order. Cons: a slow module blocks all subsequent closes; total time is sum of module times.

### Parallel close

```go
func (s *Server) Close() error {
    var wg sync.WaitGroup
    errCh := make(chan error, 3)
    for _, m := range []io.Closer{s.api, s.workers, s.db} {
        wg.Add(1)
        go func(m io.Closer) {
            defer wg.Done()
            if err := m.Close(); err != nil {
                errCh <- err
            }
        }(m)
    }
    wg.Wait()
    close(errCh)
    var errs []error
    for err := range errCh { errs = append(errs, err) }
    return errors.Join(errs...)
}
```

Pros: total time is max of module times. Cons: order-of-shutdown matters for some systems (e.g., flush logs before closing log file).

### Phased close

For systems with dependencies between modules:

```go
func (s *Server) Close() error {
    // Phase 1: stop accepting new work
    s.api.Drain()
    s.workers.Drain()
    // Phase 2: wait for in-flight work
    s.api.Wait()
    s.workers.Wait()
    // Phase 3: close stateful resources
    return s.db.Close()
}
```

Each phase is parallel internally but the phases are sequential. This handles dependencies correctly.

The close-of-closes is itself a state machine; treat it with the same care as a single-channel close.

---

## Close in the Memory Model

Go's memory model guarantees:

> The closing of a channel is synchronized before a receive that returns because the channel is closed.

In other words: every write a sender did before its last successful send happens-before every receive after the close. The close acts as a synchronisation point.

### Example

```go
var x int

go func() {
    x = 42
    close(done)
}()

<-done
fmt.Println(x) // guaranteed to see 42
```

The write to `x` is causally before the close. The receive from `done` (which returns due to the close) sees that close. Therefore the receive sees the write.

This is *why* `close` is usable as a one-shot signal: it has happens-before semantics, not just "channel state changes".

### Implications for close-on-shutdown

If the goroutine that calls `close(done)` has done some work first, every observer of the closed `done` is guaranteed to see that work. This is the basis of `context.Cancel`: the parent's cancel happens-before every child's observation of `ctx.Done()`.

### Anti-pattern: read after close without re-sync

```go
go func() {
    close(done)
    x = 42 // write after close
}()

<-done
fmt.Println(x) // not guaranteed to see 42
```

The write to `x` is *after* the close, so it is not synchronised by the close. The observer may or may not see 42. The same race-detector error you would expect.

The fix: order matters. Sequence writes before close, not after.

### Channels are not locks

Some patterns try to use close as a write-once lock:

```go
var initialized = make(chan struct{})

func Init() {
    // ... initialize ...
    close(initialized)
}

func Use() {
    <-initialized
    // ... use ...
}
```

This works *if* `Init` is called exactly once. If it can be called twice, you get a double-close panic. Use `sync.Once` for one-time initialisation:

```go
var once sync.Once
func Init() { once.Do(func() { /* initialize */ }) }
```

Or, if you must use a channel, combine:

```go
var once sync.Once
var initialized = make(chan struct{})
func Init() { once.Do(func() { /* initialize */; close(initialized) }) }
func Use() { <-initialized; /* use */ }
```

---

## Real-World Case Study: A Pub/Sub System

Consider a small publish/subscribe system with these requirements:

- Subscribers register with a Subscribe method that returns a channel.
- Publishers call Publish to send a message to all current subscribers.
- Subscribers unsubscribe by calling Unsubscribe with their channel.
- The whole system has a Close method that cancels all subscribers cleanly.

The close-violation traps here are numerous. Let's design carefully.

### First attempt

```go
type PubSub struct {
    mu   sync.Mutex
    subs map[chan<- Msg]struct{}
}

func (p *PubSub) Subscribe() <-chan Msg {
    ch := make(chan Msg, 16)
    p.mu.Lock()
    p.subs[ch] = struct{}{}
    p.mu.Unlock()
    return ch
}

func (p *PubSub) Unsubscribe(ch <-chan Msg) {
    p.mu.Lock()
    // problem: we have <-chan, but stored chan<-. Type mismatch.
    p.mu.Unlock()
}

func (p *PubSub) Publish(m Msg) {
    p.mu.Lock()
    for ch := range p.subs {
        select { case ch <- m: default: }
    }
    p.mu.Unlock()
}

func (p *PubSub) Close() {
    p.mu.Lock()
    for ch := range p.subs {
        close(ch) // who closes? Subscriber or publisher?
    }
    p.subs = nil
    p.mu.Unlock()
}
```

Problems:

1. Subscribe returns `<-chan Msg` (correct), but storing under `<-chan` makes unsubscribe possible. We store `chan<- Msg` (also reasonable for publishing). Different types.
2. Close calls `close(ch)` on subscriber channels. The subscriber may also call Unsubscribe and try to use the channel. If we close while subscriber reads, that's fine (receive gives zero+false). If subscriber sends to (some other) channel, we don't care. But if a Publish goroutine is mid-send when Close runs, panic.
3. Close acquires the mutex. Publish acquires the mutex. So at the moment of close, no Publish is mid-send. Good — this prevents the publish-vs-close race. But: what if the Publish goroutine has already grabbed `ch` from `subs`, released the lock (wait, no, it holds the lock during the loop), and is mid-send? It still holds the mutex. Close has to wait. OK, safe.

The mutex covers publish-vs-close. Let's refine.

### Second attempt: closure-friendly design

```go
type PubSub struct {
    mu     sync.Mutex
    subs   map[uint64]chan Msg
    nextID uint64
    closed bool
}

type Subscription struct {
    ID  uint64
    Ch  <-chan Msg
    ps  *PubSub
}

func (p *PubSub) Subscribe() *Subscription {
    p.mu.Lock()
    defer p.mu.Unlock()
    if p.closed {
        // return a never-firing channel
        ch := make(chan Msg)
        close(ch)
        return &Subscription{Ch: ch}
    }
    id := p.nextID
    p.nextID++
    ch := make(chan Msg, 16)
    p.subs[id] = ch
    return &Subscription{ID: id, Ch: ch, ps: p}
}

func (s *Subscription) Unsubscribe() {
    if s.ps == nil { return }
    s.ps.mu.Lock()
    defer s.ps.mu.Unlock()
    if ch, ok := s.ps.subs[s.ID]; ok {
        close(ch) // we are the only sender after removal; safe
        delete(s.ps.subs, s.ID)
    }
}

func (p *PubSub) Publish(m Msg) {
    p.mu.Lock()
    defer p.mu.Unlock()
    if p.closed { return }
    for _, ch := range p.subs {
        select {
        case ch <- m:
        default: // subscriber slow; drop
        }
    }
}

func (p *PubSub) Close() {
    p.mu.Lock()
    defer p.mu.Unlock()
    if p.closed { return }
    p.closed = true
    for _, ch := range p.subs {
        close(ch)
    }
    p.subs = nil
}
```

Analysis:

- All accesses to `subs` are under the mutex.
- Subscribe checks `closed`. If closed, returns a pre-closed channel (so the subscriber's range immediately exits).
- Unsubscribe closes the channel under the mutex. No publisher can be mid-send because publishers also hold the mutex.
- Publish holds the mutex for the entire send loop, blocking subscribers from unsubscribing mid-publish. This is *necessary* for correctness but causes a problem: a slow subscriber blocks all other subscribers. The `select default` mitigates: we drop on slow subscribers.
- Close is idempotent (`if p.closed { return }`) and closes every subscriber channel. The mutex ensures no publish is mid-send.

This is a working pub-sub. But it has subtle problems we should call out:

1. **Publish under lock is bad latency.** A high-frequency publisher serialises all subscribers through one mutex. For low-fan-out it's fine; for high fan-out you want shard-per-subscriber.
2. **`select default` drops messages.** This is the right default for telemetry but not for reliable delivery. For reliable delivery, you need backpressure: block the publisher when any subscriber is slow.
3. **Subscriber `range` is the right consumer pattern.** Subscribers do `for m := range sub.Ch { ... }`. When Unsubscribe or Close fires, the channel closes, the range exits. No special handling required.

### Why not give subscribers the `close` authority

If subscribers could close their own channel, what happens on Publish? Publisher holds `ch`, subscriber closes from another goroutine, publisher sends. Panic.

So subscribers must *not* close. They must call Unsubscribe, which closes the channel under the mutex (after removing it from `subs`, so no future publish targets it).

Alternatively, subscribers send a "leave" message to the broker (no close at all):

```go
type leaveMsg struct{ id uint64 }

func (p *PubSub) loop() {
    for {
        select {
        case msg := <-p.publishCh: p.fanout(msg)
        case leave := <-p.leaveCh: delete(p.subs, leave.id)
        }
    }
}
```

This is the actor-model variant. No mutex. One goroutine owns the subs map. Publishes and unsubscribes are sent as messages. Cleaner concurrency, more code.

For most internal pub-subs, the mutex variant is simpler. For high-throughput systems, the actor variant is faster.

---

## Production Patterns: The errgroup-Based Pipeline

We have referenced `errgroup` several times. Here is the full production pipeline pattern.

```go
import (
    "context"
    "errors"
    "log"

    "golang.org/x/sync/errgroup"
)

type Pipeline struct {
    cfg Config
}

func (p *Pipeline) Run(ctx context.Context) error {
    g, ctx := errgroup.WithContext(ctx)

    src := make(chan Job, 32)
    mid := make(chan Result, 32)

    // Stage 1: source
    g.Go(func() error {
        defer close(src)
        return p.runSource(ctx, src)
    })

    // Stage 2: workers (N parallel)
    var wg sync.WaitGroup
    for i := 0; i < p.cfg.Workers; i++ {
        wg.Add(1)
        g.Go(func() error {
            defer wg.Done()
            return p.runWorker(ctx, src, mid)
        })
    }

    // Coordinator: close mid after all workers exit
    g.Go(func() error {
        wg.Wait()
        close(mid)
        return nil
    })

    // Stage 3: sink
    g.Go(func() error {
        return p.runSink(ctx, mid)
    })

    return g.Wait()
}

func (p *Pipeline) runSource(ctx context.Context, out chan<- Job) error {
    for i := 0; i < p.cfg.N; i++ {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case out <- Job{ID: i}:
        }
    }
    return nil
}

func (p *Pipeline) runWorker(ctx context.Context, in <-chan Job, out chan<- Result) error {
    for j := range in {
        r, err := p.process(ctx, j)
        if err != nil {
            return err
        }
        select {
        case <-ctx.Done():
            return ctx.Err()
        case out <- r:
        }
    }
    return nil
}

func (p *Pipeline) runSink(ctx context.Context, in <-chan Result) error {
    for r := range in {
        if err := p.store(ctx, r); err != nil {
            return err
        }
    }
    return nil
}
```

Close protocol:

1. **`src`.** Source goroutine closes via `defer close(src)`. Single closer, single sender. Safe.
2. **`mid`.** N workers send. Coordinator goroutine waits for all workers via `wg.Wait()`, then closes. Single closer (the coordinator). Safe.
3. **errgroup's context.** Auto-cancels on first error. Every stage selects on `ctx.Done()`. Cancellation propagates.

This is the senior-level template for production pipelines. Memorise the shape.

### Common variations

1. **Sink replaced by errgroup.Wait.** If the sink simply collects results into a slice, you can write it inline before `g.Wait()`.
2. **Workers organised by stage.** If processing has multiple stages, add more channels (`mid1`, `mid2`, ...) and more coordinators.
3. **Result fan-out.** Replace one sink with multiple parallel sinks each ranging over `mid`. Each sink-ranges-mid pattern is safe because there is one closer (the worker coordinator).

### What goes wrong if you forget the coordinator

```go
// BROKEN
for i := 0; i < cfg.Workers; i++ {
    g.Go(func() error {
        defer close(mid) // each worker tries to close
        return p.runWorker(ctx, src, mid)
    })
}
```

First worker to finish closes `mid`. Other workers panic on send. The errgroup catches the panic? No — panics in goroutines crash the program. The coordinator goroutine is required.

---

## Close in Worker-Pool Lifecycles

A worker pool has a complex lifecycle: start, drain, stop. Close happens at "stop".

```go
type Pool struct {
    jobs chan Job
    done chan struct{}
    wg   sync.WaitGroup
    once sync.Once
}

func NewPool(workers int, buf int) *Pool {
    p := &Pool{
        jobs: make(chan Job, buf),
        done: make(chan struct{}),
    }
    p.wg.Add(workers)
    for i := 0; i < workers; i++ {
        go p.worker(i)
    }
    return p
}

func (p *Pool) Submit(j Job) error {
    select {
    case <-p.done:
        return ErrClosed
    case p.jobs <- j:
        return nil
    }
}

func (p *Pool) worker(id int) {
    defer p.wg.Done()
    for {
        select {
        case <-p.done:
            return
        case j, ok := <-p.jobs:
            if !ok {
                return
            }
            j.Run()
        }
    }
}

func (p *Pool) Drain() {
    // Allow current jobs to finish; reject new ones.
    p.once.Do(func() {
        close(p.done) // signal: no new accept
        // Note: workers still drain p.jobs until empty
    })
}

func (p *Pool) Stop() {
    p.Drain()
    close(p.jobs) // safe: no more Submit (Submit checks p.done first)
    p.wg.Wait()
}
```

Wait — is `close(p.jobs)` safe after `close(p.done)`?

A Submit caller may have passed the `<-p.done` check before another goroutine called `Drain`. That Submit is now selecting on both arms: `<-p.done` is now closed; `p.jobs <- j` may or may not still be selectable. Select picks pseudo-randomly. If it picks `<-p.done`, return error. If it picks `p.jobs <- j` and a worker is reading, the send succeeds. If it picks `p.jobs <- j` and the buffer has space, the send succeeds.

So Submit *can* still send to `p.jobs` after Drain. Stop calling `close(p.jobs)` may race with that send. Panic.

The fix: make Drain prevent further sends *before* Stop closes:

```go
func (p *Pool) Submit(j Job) error {
    // Pre-check: refuse fast if already draining.
    select {
    case <-p.done:
        return ErrClosed
    default:
    }
    // Real send with cancellation arm.
    select {
    case <-p.done:
        return ErrClosed
    case p.jobs <- j:
        return nil
    }
}
```

Even this has the same race: after the second select picks `p.jobs <-`, the actual send may run concurrently with `close(p.jobs)`. The pre-check helps but does not eliminate.

The robust fix: do not close `p.jobs`. Let workers exit when `p.done` is closed and the jobs channel is empty:

```go
func (p *Pool) worker(id int) {
    defer p.wg.Done()
    for {
        select {
        case j := <-p.jobs:
            j.Run()
        case <-p.done:
            // drain remaining jobs after done
            for {
                select {
                case j := <-p.jobs:
                    j.Run()
                default:
                    return
                }
            }
        }
    }
}

func (p *Pool) Stop() {
    p.once.Do(func() { close(p.done) })
    p.wg.Wait()
}
```

Now we never close `p.jobs`. The Submit-vs-Close race disappears. Workers drain the buffer on shutdown via a non-blocking inner loop.

This is the production shape. Note that the actor-style approach (single channel for both jobs and commands) is even cleaner but more invasive.

---

## Close in Server Lifecycles

A network server has tighter constraints: in-flight connections must be served, listeners must close, accept loops must exit. The `http.Server.Shutdown` pattern is the reference.

```go
type Server struct {
    listener net.Listener
    conns    map[net.Conn]struct{}
    mu       sync.Mutex
    wg       sync.WaitGroup
    done     chan struct{}
    once     sync.Once
}

func (s *Server) Serve() error {
    for {
        c, err := s.listener.Accept()
        if err != nil {
            select {
            case <-s.done:
                return nil // shutdown initiated
            default:
                return err
            }
        }
        s.wg.Add(1)
        s.mu.Lock()
        s.conns[c] = struct{}{}
        s.mu.Unlock()
        go s.handle(c)
    }
}

func (s *Server) handle(c net.Conn) {
    defer s.wg.Done()
    defer func() {
        s.mu.Lock()
        delete(s.conns, c)
        s.mu.Unlock()
        c.Close()
    }()
    // ... serve protocol on c ...
}

func (s *Server) Shutdown(ctx context.Context) error {
    s.once.Do(func() {
        close(s.done)
        s.listener.Close() // makes Accept return error
    })
    waitCh := make(chan struct{})
    go func() { s.wg.Wait(); close(waitCh) }()
    select {
    case <-waitCh:
        return nil
    case <-ctx.Done():
        // hard-close remaining connections
        s.mu.Lock()
        for c := range s.conns {
            c.Close()
        }
        s.mu.Unlock()
        s.wg.Wait()
        return ctx.Err()
    }
}
```

The close protocol here is:

1. **`s.done`.** Single close via `sync.Once`. Signals Accept loop to exit on listener error.
2. **`s.listener`.** Closed once. Triggers Accept error.
3. **`waitCh`.** Newly allocated per Shutdown; closed when WaitGroup reaches zero.
4. **Connection close.** Each connection's Close is called from `handle`'s defer; on context timeout, forcibly closed by Shutdown.

No data channel close at all. Closes are control signals, not data.

---

## Test Patterns for Close-Safe Libraries

A library that promises close-safety must test it. Here is a battery.

### Test 1: idempotent Close

```go
func TestIdempotentClose(t *testing.T) {
    c := New()
    for i := 0; i < 10; i++ {
        if err := c.Close(); err != nil {
            t.Fatalf("Close %d: %v", i, err)
        }
    }
}
```

If Close panics on the second call, this fails. If it returns an error, this fails. Idempotent.

### Test 2: concurrent Close

```go
func TestConcurrentClose(t *testing.T) {
    c := New()
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() { defer wg.Done(); _ = c.Close() }()
    }
    wg.Wait()
}
```

Catches `close of closed channel` panics under concurrency.

### Test 3: Send after Close returns error

```go
func TestSendAfterClose(t *testing.T) {
    c := New()
    _ = c.Close()
    if err := c.Send(1); err != ErrClosed {
        t.Fatalf("want ErrClosed, got %v", err)
    }
}
```

The library must reject sends cleanly.

### Test 4: Close during Send

```go
func TestCloseDuringSend(t *testing.T) {
    c := New()
    var sendErr error
    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        sendErr = c.Send(1)
    }()
    runtime.Gosched()
    _ = c.Close()
    wg.Wait()
    // sendErr may be nil (delivered) or ErrClosed (rejected).
    // The only forbidden outcome is panic.
}
```

The exact outcome is unspecified; the test only requires no panic.

### Test 5: Range completes after Close

```go
func TestRangeAfterClose(t *testing.T) {
    c := New()
    _ = c.Send(1)
    _ = c.Send(2)
    _ = c.Close()
    var got []int
    for v := range c.Out() {
        got = append(got, v)
    }
    if !reflect.DeepEqual(got, []int{1, 2}) {
        t.Fatalf("want [1 2], got %v", got)
    }
}
```

After close, the receiver should still see buffered values, then exit. This tests drainable close.

### Test 6: Stress with race detector

```go
func TestStressRace(t *testing.T) {
    c := New()
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(2)
        go func() { defer wg.Done(); for j := 0; j < 100; j++ { _ = c.Send(j) } }()
        go func() { defer wg.Done(); for v := range c.Out() { _ = v } }()
    }
    time.AfterFunc(100*time.Millisecond, func() { _ = c.Close() })
    wg.Wait()
}
```

Run with `go test -race -count=10`. Race detector should not flag.

---

## Observability of Close Events

In production, you want to know when channels close, what closed them, and what the close pattern looks like over time.

### Wrapper with logging

```go
type LoggedCh struct {
    name string
    ch   chan int
    once sync.Once
}

func (l *LoggedCh) Close() {
    l.once.Do(func() {
        log.Printf("channel %s closing; len=%d cap=%d", l.name, len(l.ch), cap(l.ch))
        close(l.ch)
    })
}
```

This logs the channel's occupancy at close time. Useful for detecting buffer-bloat ("we always close with full buffers — buffer is too big?") or starvation ("we always close empty — buffer is unnecessary?").

### Metrics on close

```go
var (
    closeCount = prometheus.NewCounterVec(
        prometheus.CounterOpts{Name: "ch_close_total"},
        []string{"name"},
    )
    closeLatency = prometheus.NewHistogramVec(
        prometheus.HistogramOpts{Name: "ch_close_duration_seconds"},
        []string{"name"},
    )
)

func (l *LoggedCh) Close() {
    l.once.Do(func() {
        start := time.Now()
        close(l.ch)
        closeLatency.WithLabelValues(l.name).Observe(time.Since(start).Seconds())
        closeCount.WithLabelValues(l.name).Inc()
    })
}
```

`close` itself is fast (<100ns); the duration captures any post-close cleanup the library does. Useful when close cascades to a Wait or to other goroutines.

### Tracing close events

For distributed tracing, instrument Close with a span:

```go
func (l *LoggedCh) Close(ctx context.Context) {
    ctx, span := tracer.Start(ctx, "ch.close",
        trace.WithAttributes(attribute.String("ch.name", l.name)))
    defer span.End()
    l.once.Do(func() { close(l.ch) })
}
```

This makes shutdown sequences visible in trace timelines, which is invaluable when debugging slow shutdowns.

---

## Documenting Close Semantics in Code

Close behaviour is part of an API's contract. Document it explicitly.

```go
// Close stops the worker pool and waits for in-flight jobs to complete.
//
// Close is idempotent: calling it multiple times is safe and returns
// the same error as the first call.
//
// After Close, Submit returns ErrPoolClosed. In-flight jobs proceed to
// completion; Close returns when all have finished.
//
// Close is safe to call from multiple goroutines.
func (p *Pool) Close() error { ... }
```

Make explicit:

- Idempotency (yes/no).
- Concurrency (safe from multiple goroutines, or single-caller).
- Blocking behaviour (returns immediately, or waits for in-flight work).
- Effect on other methods (Submit returns error, Recv drains buffer, etc.).
- Errors returned.

A close method without these documented is a source of bugs in client code.

---

## Versioning Close Semantics

Changing a library's close behaviour is a breaking change. Be careful.

If you switch from "Close waits for in-flight work" to "Close interrupts in-flight work", any client that relied on graceful drain will now lose data. Use a version bump.

If you switch from "Close is single-caller" to "Close is concurrent-safe", you have strengthened the contract. No version bump needed.

If you switch from "Close returns nil" to "Close returns error", clients that ignored the return value still compile; clients that checked the return now get nil-or-error. Bump minor version.

When in doubt, add a new method (`Shutdown` alongside `Close`) and deprecate the old one. This is what `net/http` did: `Server.Close()` is the abrupt close; `Server.Shutdown()` is the graceful close.

---

## Race-Free Drain Patterns

A "drain" reads remaining data from a channel after the producer has stopped. Done wrong, drain can race with the producer.

### Producer-driven drain (safe)

```go
func produce() <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        // ... send all values ...
    }()
    return out
}

// Consumer:
for v := range produce() { ... }
```

The producer closes when done. The consumer's range drains until close. No race.

### Consumer-driven drain with cancellation

```go
ctx, cancel := context.WithCancel(parent)
out := produce(ctx)
// ... consume some ...
cancel()
// Drain remaining
for {
    select {
    case v, ok := <-out:
        if !ok { return }
        process(v)
    case <-time.After(time.Second):
        return // give up
    }
}
```

After cancel, the producer eventually closes `out` (because its select arms on `ctx.Done()`). The drain loop reads until close, with a timeout to abandon if the producer is slow.

### Anti-pattern: drain after close

```go
close(out) // can panic if any sender alive
for v := range out { ... }
```

Only safe if you can prove no sender is in flight. Usually wrong.

---

## Putting It All Together: The Close Discipline

A practitioner's checklist for every channel in the codebase:

1. **Direction.** What is the channel's direction at every API boundary?
2. **Closer.** Who has the authority to close?
3. **Senders.** Who can send, and how do they coordinate with the closer?
4. **Receivers.** How do they observe close (range, comma-ok, select)?
5. **Cancellation.** How do senders abort if the consumer goes away?
6. **Errors.** How are errors propagated (embedded, side-channel, context)?
7. **Idempotency.** Is the close idempotent? Should it be?
8. **Tests.** Is the close behaviour tested under concurrency and under cancellation?

If you can answer all eight for every channel in a module, the module is close-safe.

---

## Reactive Close Patterns: Watch and Notify

A common channel pattern is "I subscribe to changes and want to be told when subscription ends". The close is the end-of-stream signal, but a richer protocol may carry an error.

```go
type Watcher struct {
    Events <-chan Event
    // Err returns the error that ended the watch.
    // It blocks until the watcher exits.
    Err   func() error
}

func Watch(ctx context.Context, key string) *Watcher {
    events := make(chan Event)
    errCh := make(chan error, 1)
    go func() {
        defer close(events)
        err := runWatch(ctx, key, events)
        errCh <- err
        close(errCh)
    }()
    return &Watcher{
        Events: events,
        Err: func() error {
            for err := range errCh { return err }
            return nil
        },
    }
}
```

Two channels: `events` for the stream, `errCh` for the terminal error. The producer closes both on exit; close order matters (events first so the consumer's range exits, then errCh).

The `Err()` accessor blocks until the error is delivered. Consumers call it after their `range` exits.

### Avoiding the Err accessor

A simpler design embeds the error in the last event:

```go
type Event struct {
    Type EventType
    Data Data
    Err  error // non-nil only on final "terminal" event
}
```

If `Err != nil`, this is the last event. The producer sends it and then closes. The consumer's range sees it before exit. One channel, one close.

This is cleaner if the protocol allows it. Some streaming APIs require the error to be observable even *before* the data has been fully consumed, in which case the two-channel approach wins.

---

## Re-entrancy and Close

A close method that calls back into user code (callbacks, listener notifications) creates re-entrancy hazards. If the user code calls back into Close again, sync.Once protects but Wait may deadlock.

```go
type Pool struct {
    once sync.Once
    wg   sync.WaitGroup
    onClose func()
}

func (p *Pool) Close() {
    p.once.Do(func() {
        if p.onClose != nil { p.onClose() } // user code
        p.wg.Wait()
    })
}
```

If `p.onClose` calls `p.Close()` recursively, the second call hits `sync.Once.Do` which sees the function is *running* and waits for it to return — but we are inside it. Deadlock.

This is a real bug pattern. Fix by deferring the user callback to outside the Once:

```go
func (p *Pool) Close() {
    var cb func()
    p.once.Do(func() {
        cb = p.onClose
    })
    if cb != nil { cb() } // outside Once; recursive Close is no-op
    p.wg.Wait()
}
```

Or document that `onClose` must not call back into Pool methods. Documenting is fragile; code defence is better.

---

## Generic Safe-Close Helpers

Go's generics let us write reusable safe-close primitives.

```go
type SafeCh[T any] struct {
    ch   chan T
    done chan struct{}
    once sync.Once
}

func NewSafeCh[T any](buf int) *SafeCh[T] {
    return &SafeCh[T]{
        ch:   make(chan T, buf),
        done: make(chan struct{}),
    }
}

func (s *SafeCh[T]) Send(v T) bool {
    select {
    case <-s.done:
        return false
    case s.ch <- v:
        return true
    }
}

func (s *SafeCh[T]) Recv() (T, bool) {
    select {
    case v := <-s.ch:
        return v, true
    case <-s.done:
        var zero T
        return zero, false
    }
}

func (s *SafeCh[T]) Close() {
    s.once.Do(func() { close(s.done) })
}

func (s *SafeCh[T]) Done() <-chan struct{} {
    return s.done
}
```

The generic version factors out the boilerplate. You can use it for any element type.

### Costs of generics

Generics in Go are implemented via GCShape stenciling, which means each type instantiation may have its own machine code (or share with shape-compatible types). The performance is typically equivalent to hand-written code, plus a small overhead for the dictionary parameter. For close-safe channels, this is negligible.

### When not to use a generic helper

If your code is full of `SafeCh[Event]`, `SafeCh[Job]`, `SafeCh[Result]` calls, you may have lost something: the type of channel is no longer documenting *what* it is for. Sometimes a named struct is clearer:

```go
type EventCh struct {
    SafeCh[Event]
}

func (e *EventCh) PublishEvent(ev Event) bool { return e.Send(ev) }
```

Named wrappers give back the domain language at the cost of more code.

---

## Close in High-Throughput Systems

For systems doing millions of channel operations per second, even small overheads matter. Some advanced techniques:

### Hot-path: avoid select

A `select` with multiple cases has overhead (the runtime has to evaluate each case, lock the channels in canonical order, etc.). For hot paths where you know exactly one channel is involved:

```go
// Hot path: pure send, no done
ch <- v
```

This is faster than:

```go
// Cold path: select with cancellation
select {
case ch <- v:
case <-done:
}
```

But the hot path can panic on close. The trade-off is real.

A common compromise: pure send on the hot path, with a pre-check on the cold path. The cold path is rare (close usually doesn't fire), so the average case stays fast.

### Batching: amortise the close

Instead of close-per-job, batch many jobs through one channel and close once at the end:

```go
const batchSize = 1000
batch := make([]Job, 0, batchSize)
for { /* fill batch */ }
ch <- batch // single send of a slice
close(ch)
```

The cost of close is now N times less. Useful when the channel itself is the bottleneck.

### Lock-free idempotent close

If `sync.Once` is too expensive (rare; we are talking sub-100ns), use a CAS-based check:

```go
type FastClose struct {
    ch     chan struct{}
    closed atomic.Uint32
}

func (f *FastClose) Close() {
    if f.closed.CompareAndSwap(0, 1) {
        close(f.ch)
    }
}
```

The CAS is a single atomic instruction; sync.Once involves a memory barrier and possibly a mutex acquisition. For ultra-hot paths, the CAS wins. In production code, both are fast enough.

We will return to this in `optimize.md`.

---

## Close in Embedded Systems

Some Go programs run on embedded targets (TinyGo, GOOS=js). The runtime is different; some patterns are wasteful.

For embedded targets:

- Goroutines may map to cooperative coroutines, not OS threads. Spawning many is cheap but not free.
- Channel close still has the same semantics.
- WaitGroup-based coordinators add a goroutine per close. On a 64KB-RAM device, that matters.

For embedded, prefer the atomic-flag style of close and avoid coordinator goroutines:

```go
type EmbeddedCh struct {
    ch     chan int
    closed uint32
}

func (e *EmbeddedCh) Close() {
    if atomic.CompareAndSwapUint32(&e.closed, 0, 1) {
        close(e.ch)
    }
}
```

This adds zero goroutines.

For server-grade Go, this concern is negligible; one goroutine costs 2KB stack.

---

## Close as Resource Management

In Go, `Close()` is the conventional name for "release resources". When the resource is a channel, close-the-method differs from close-the-builtin.

```go
type Reader struct { ch chan Line }
func (r *Reader) Close() error {
    close(r.ch)  // close-the-builtin
    return nil
}
```

These are different:

- `close(r.ch)`: a runtime primitive on a channel.
- `r.Close()`: an API method that may do more than just close the channel.

The method may also flush buffers, release file descriptors, cancel goroutines, etc. The channel close is one part of resource release.

Convention: name the method `Close` only if it implements `io.Closer`. Use `Stop`, `Shutdown`, `Cancel`, or domain-specific names when the semantics differ:

- `Stop()` — abrupt halt.
- `Shutdown(ctx)` — graceful with timeout.
- `Cancel()` — cancellation signal, no wait.
- `Drain()` — finish in-flight, then halt.

This makes the API self-documenting.

---

## Closing Channels in Iterator Functions

Go 1.23 introduced range-over-func. Iterators may use channels internally and need to close them.

```go
func Lines(filename string) iter.Seq[string] {
    return func(yield func(string) bool) {
        f, err := os.Open(filename)
        if err != nil { return }
        defer f.Close()
        scanner := bufio.NewScanner(f)
        for scanner.Scan() {
            if !yield(scanner.Text()) {
                return
            }
        }
    }
}
```

No channel; pure synchronous iteration. Close-safe trivially.

But if the iterator wraps a channel-based stream:

```go
func Watch(ctx context.Context) iter.Seq2[Event, error] {
    return func(yield func(Event, error) bool) {
        ch, errCh := startWatcher(ctx)
        for {
            select {
            case ev, ok := <-ch:
                if !ok {
                    err := <-errCh
                    yield(Event{}, err)
                    return
                }
                if !yield(ev, nil) { return }
            case <-ctx.Done():
                return
            }
        }
    }
}
```

The iterator yields events. When the caller's range body returns false (e.g., `break`), the iterator returns; the deferred resources clean up.

The channel `ch` is owned by `startWatcher`. The iterator does not close it. If the iterator exits early (yield returned false), the watcher's goroutine should learn via `ctx.Done()`. If `ctx` is not properly child-of-the-caller's context, leak.

The full pattern:

```go
func Watch(parentCtx context.Context) iter.Seq2[Event, error] {
    return func(yield func(Event, error) bool) {
        ctx, cancel := context.WithCancel(parentCtx)
        defer cancel() // tells watcher to stop on early exit
        ch, errCh := startWatcher(ctx)
        for {
            select {
            case ev, ok := <-ch:
                if !ok {
                    yield(Event{}, <-errCh)
                    return
                }
                if !yield(ev, nil) { return }
            case <-ctx.Done():
                return
            }
        }
    }
}
```

The `defer cancel()` ensures the watcher learns even if the caller breaks early. This is the iterator+channel idiom for Go 1.23+.

---

## Cross-Goroutine Close Propagation

In a hierarchy, a parent's close should propagate to children. There are several mechanisms:

### Context as the canonical propagation

```go
parentCtx, cancel := context.WithCancel(...)
go func() {
    childCtx, _ := context.WithCancel(parentCtx)
    // child observes childCtx.Done(); also fires when parent cancels
}()
```

`context.WithCancel(parent)` creates a child whose Done fires when either the child's own cancel is called or the parent cancels. This is the canonical propagation.

### Manual close-channel propagation

Without context:

```go
parentDone := make(chan struct{})
go func(parentDone <-chan struct{}) {
    childDone := make(chan struct{})
    go func() {
        select {
        case <-parentDone:
            close(childDone)
        }
    }()
    // child code uses childDone
}(parentDone)
```

This works but is fiddly. Prefer context.

### Notify on close

```go
type Closer struct {
    done chan struct{}
    once sync.Once
}

func (c *Closer) Close() {
    c.once.Do(func() { close(c.done) })
}

func (c *Closer) Done() <-chan struct{} { return c.done }
```

Other goroutines call `<-c.Done()` to observe close. They cannot accidentally close (the field is private; Done returns receive-only).

This is the basis of the standard library's `context.Context` and the `sync.WaitGroup` (via Wait).

---

## Closing Channels in Loops

A common bug: closing in a loop.

```go
for i := 0; i < n; i++ {
    ch := make(chan int)
    go work(ch)
    close(ch) // closed before work can read
}
```

This is almost certainly wrong. `close(ch)` here makes work see a closed channel immediately. If `work` does a non-blocking receive, that's fine, but typically work expects sends.

Fix: close on a different schedule, perhaps with WaitGroup.

```go
var wg sync.WaitGroup
for i := 0; i < n; i++ {
    ch := make(chan int)
    wg.Add(1)
    go func() { defer wg.Done(); work(ch) }()
    // send items to ch ...
    close(ch)
}
wg.Wait()
```

This is the producer-completes-its-channel pattern, repeated per iteration. Each iteration spawns a worker, sends items, closes, and the worker drains.

If `n` is huge, you may want to share channels across iterations (worker pool). But then close is harder; refer back to the pool patterns.

---

## Closing Channels That Are Never Sent To

Sometimes a channel exists purely as a signal. It is never sent to; it is only closed.

```go
done := make(chan struct{})
// ... some condition becomes true ...
close(done)
// observers via <-done now unblock
```

This is the "broadcast on close" idiom. The empty `struct{}` carries no data; close is the signal.

Properties:

- No data race on a "send"-free channel.
- Single close (via sync.Once if multiple sites can close).
- Receivers via `<-done` see an instant zero-value (struct{}{}).
- Cheap: receive on a closed channel is non-blocking.

This is the most reliable broadcast mechanism in Go. Use it for one-shot signals: shutdown, cancellation, lifecycle transitions.

### Anti-pattern: sending to a "broadcast" channel

```go
done <- struct{}{} // only one receiver wakes up
```

Sending wakes exactly one receiver. Closing wakes all. For broadcast, you must close, not send.

For "every receiver gets a copy", you need a fan-out: store a list of subscribers, send to each.

---

## Close in Generic Pool Patterns

A generic pool of any resource that needs explicit cleanup:

```go
type Pool[T any] struct {
    mu    sync.Mutex
    pool  []T
    new   func() T
    reset func(T)
    close func(T)
    closed bool
}

func (p *Pool[T]) Get() (T, error) {
    p.mu.Lock()
    defer p.mu.Unlock()
    if p.closed {
        var zero T
        return zero, ErrClosed
    }
    if n := len(p.pool); n > 0 {
        v := p.pool[n-1]
        p.pool = p.pool[:n-1]
        return v, nil
    }
    return p.new(), nil
}

func (p *Pool[T]) Put(v T) error {
    p.mu.Lock()
    defer p.mu.Unlock()
    if p.closed {
        if p.close != nil { p.close(v) }
        return ErrClosed
    }
    if p.reset != nil { p.reset(v) }
    p.pool = append(p.pool, v)
    return nil
}

func (p *Pool[T]) Close() error {
    p.mu.Lock()
    defer p.mu.Unlock()
    if p.closed { return nil }
    p.closed = true
    if p.close != nil {
        for _, v := range p.pool { p.close(v) }
    }
    p.pool = nil
    return nil
}
```

No channel close here, but the pattern is informative: a Closed flag under a mutex, idempotent Close, cleanup of pooled resources on Close, rejection of Put after Close.

The same shape applies to channel-bearing pools (worker pools, etc.).

---

## Close and the Garbage Collector

When all references to a channel drop, the channel is GC'd. Close does not affect this.

A closed channel with no references is GC'd. A closed channel with references is *not* GC'd until the references drop. A non-closed channel can be GC'd if no goroutine is blocked on it (sending or receiving).

Wait — really? Yes. The runtime tracks blocked goroutines as roots; if a goroutine is blocked on a channel, the channel is a live reference from the goroutine's stack. So a channel with a blocked goroutine survives GC. But a channel with no blocked goroutines and no other references can be GC'd, regardless of whether it was ever closed.

This means: not closing a channel does not leak the channel, *as long as* nothing keeps a reference. The leak comes from references, not from missing close.

The closure does affect goroutine liveness: a goroutine ranging over a never-closed channel blocks forever, keeping itself live, keeping the channel referenced. That is the leak. Close releases the goroutine, which then drops its reference, which lets GC reclaim everything.

So: close is about goroutine lifecycle, not about channel lifecycle. Misunderstanding this leads to overzealous closing ("I must close every channel before exit") which is wrong — only close when you want receivers to stop.

---

## Close Across Process Boundaries

What does "close" mean for a channel that represents a network stream?

Convention: a network stream has its own close (TCP FIN, gRPC end-of-stream, etc.). The Go channel that surfaces the stream to user code mirrors that close: when the underlying stream ends, the channel is closed.

```go
func ReadFrames(conn net.Conn) <-chan Frame {
    out := make(chan Frame)
    go func() {
        defer close(out)
        for {
            f, err := readFrame(conn)
            if err != nil { return } // EOF or net error
            out <- f
        }
    }()
    return out
}
```

The channel close corresponds to "connection closed". The consumer sees the close as natural end-of-stream.

If the consumer wants to stop reading early, it cancels the context, which causes `readFrame` to return an error (typically EOF after the conn is closed by the cancellation handler), which closes `out`.

```go
func ReadFrames(ctx context.Context, conn net.Conn) <-chan Frame {
    out := make(chan Frame)
    go func() {
        defer close(out)
        defer conn.Close()
        for {
            select {
            case <-ctx.Done(): return
            default:
            }
            conn.SetReadDeadline(time.Now().Add(time.Second))
            f, err := readFrame(conn)
            if err != nil {
                if isTimeout(err) { continue } // try again
                return
            }
            select {
            case <-ctx.Done(): return
            case out <- f:
            }
        }
    }()
    return out
}
```

Now cancellation propagates: ctx-cancel → next read-deadline-timeout → loop checks ctx-Done → goroutine returns → defer closes both `out` and `conn`.

The two-layer close (channel close + connection close) is typical for stream-bearing channels. Keep them paired in the defer.

---

## Close in Long-Running Background Services

A background service (a daemon, a worker, a watcher) typically runs for the life of the process. Its close protocol must satisfy several constraints:

1. Initiated from outside (signal handler, admin endpoint).
2. Idempotent — multiple shutdown attempts must not break.
3. Bounded time — must finish within some SLA.
4. Drainable — in-flight work proceeds, new work is rejected.
5. Observable — emit metrics about shutdown progress.

The full template:

```go
type Service struct {
    cancel context.CancelFunc
    done   chan struct{}
    err    error
    once   sync.Once
    wg     sync.WaitGroup
}

func StartService(parent context.Context, cfg Config) *Service {
    ctx, cancel := context.WithCancel(parent)
    s := &Service{
        cancel: cancel,
        done:   make(chan struct{}),
    }
    s.wg.Add(1)
    go func() {
        defer s.wg.Done()
        s.err = s.run(ctx, cfg)
    }()
    go func() {
        s.wg.Wait()
        close(s.done)
    }()
    return s
}

func (s *Service) Shutdown(ctx context.Context) error {
    s.once.Do(func() { s.cancel() })
    select {
    case <-s.done:
        return s.err
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

Properties:

- `s.cancel` is called once (via sync.Once).
- The internal run loop observes the context cancel.
- `s.done` closes when the run loop exits.
- `Shutdown` waits for `s.done` or the provided timeout context.
- The first error from `run` is propagated.

This is the production template. Vary it for multi-goroutine services by adding to the WaitGroup; the `s.done` close happens after all wg.Done.

---

## Close in Pipelined Job Engines

A pipelined job engine has stages, retries, dead-letter queues, and shutdown phases. The close protocol must handle all of them.

```go
type Engine struct {
    Source <-chan Job
    Stages []Stage
    DLQ    chan<- Job
    Done   <-chan struct{}
}
```

When `Done` closes (initiated by `Engine.Shutdown`):

1. Source goroutine stops accepting (cancels its reader context).
2. Each stage's input channel closes after the previous stage drains.
3. Each stage finishes its in-flight job.
4. Failed jobs go to DLQ.
5. After all stages exit, DLQ is closed.
6. Engine's Run method returns.

The shutdown is a cascade: Source → Stage1 → Stage2 → ... → DLQ. Each link in the chain closes when the previous exits.

```go
func (e *Engine) Run(ctx context.Context) error {
    g, ctx := errgroup.WithContext(ctx)
    chans := make([]chan Job, len(e.Stages)+1)
    for i := range chans { chans[i] = make(chan Job, 32) }

    g.Go(func() error {
        defer close(chans[0])
        for {
            select {
            case <-ctx.Done(): return nil
            case j, ok := <-e.Source:
                if !ok { return nil }
                select {
                case <-ctx.Done(): return nil
                case chans[0] <- j:
                }
            }
        }
    })

    for i, st := range e.Stages {
        i, st := i, st
        g.Go(func() error {
            defer close(chans[i+1])
            for j := range chans[i] {
                out, err := st.Process(ctx, j)
                if err != nil {
                    select {
                    case e.DLQ <- j:
                    case <-ctx.Done(): return nil
                    }
                    continue
                }
                select {
                case <-ctx.Done(): return nil
                case chans[i+1] <- out:
                }
            }
            return nil
        })
    }

    // Drain final stage; discard.
    g.Go(func() error {
        for range chans[len(chans)-1] {}
        return nil
    })

    return g.Wait()
}
```

Each stage's `defer close(chans[i+1])` is the cascade point. The next stage ranges, finishes when closed, and closes the one after. The cascade unwinds naturally.

DLQ is not closed by the engine; it is an external channel passed in. The owner of DLQ closes it.

---

## Close and the Race Detector

Go's race detector (`-race` flag) catches data races, including some close-related ones. It does not catch all of them.

### What -race catches

- Send to a closed channel from one goroutine while another is closing: race detected.
- Reading a shared variable that another goroutine writes: race detected.

### What -race does not catch

- Double-close from concurrent goroutines: this is not a *data* race; it is a runtime invariant violation. The runtime catches it directly via panic.
- Close-then-leak-of-blocked-sender: not a race; just a logic bug.
- Send-after-close where the send is single-goroutine: not a race; just a panic.

The race detector is necessary but not sufficient. Combined with stress tests and code review, it gives high confidence.

---

## When to Reach for Channels-of-Channels

A channel of channels lets you build sophisticated coordination protocols.

```go
type Request struct {
    Data Input
    Done chan<- Output
}

func server(requests <-chan Request) {
    for req := range requests {
        out := process(req.Data)
        req.Done <- out
        close(req.Done) // done with this request
    }
}

func client(requests chan<- Request, in Input) Output {
    done := make(chan Output, 1)
    requests <- Request{Data: in, Done: done}
    return <-done
}
```

The server closes the per-request Done channel after sending the reply. The client never closes `done` — it just reads once.

This avoids the multi-sender close problem: each Done channel has exactly one sender (the server) and one receiver (the client). No coordination needed.

The cost: a channel allocation per request. For high QPS, this is too much; use sync.Pool of Done channels (carefully, with reset semantics).

---

## Reasoning About Close as a Code Reviewer

When you see `close(ch)` in a code review, ask:

1. **Who is the sender?** Is there exactly one goroutine that ever sends to `ch`? If yes, this is the only one who may close.
2. **Could two goroutines reach this close?** Trace the call sites. If two paths reach `close`, you need `sync.Once` or a coordinator.
3. **What happens to receivers after close?** Do they handle `ok = false`? Is there a range loop that will exit cleanly?
4. **What about late senders?** Could a send be in flight when close fires? If yes, panic risk.
5. **Is this part of a Close method?** Methods named `Close` should be idempotent. Is `sync.Once` or equivalent in place?

If you cannot trace the answers in 30 seconds, the close is probably broken. Request a refactor.

---

## Close in Anti-Patterns Encountered Across Codebases

Let me document several real-world close mistakes I've seen in production codebases:

### The deferred sentinel

```go
func process(items []Item) {
    out := make(chan Result, len(items))
    defer close(out) // executes after function returns

    for _, it := range items {
        go func(it Item) {
            out <- process(it) // may panic if function already returned
        }(it)
    }
    // function returns before goroutines complete
}
```

Defer fires before goroutines complete. Goroutines panic. Classic bug.

Fix: wait for goroutines before close.

```go
func process(items []Item) {
    out := make(chan Result, len(items))
    var wg sync.WaitGroup
    for _, it := range items {
        wg.Add(1)
        go func(it Item) {
            defer wg.Done()
            out <- process(it)
        }(it)
    }
    wg.Wait()
    close(out)
}
```

### The conditional close

```go
go func() {
    for v := range in {
        if v.Stop {
            close(out)
            return
        }
        out <- transform(v)
    }
    close(out)
}()
```

`close(out)` runs from one of two branches. If both branches can fire (e.g., the loop ends naturally and Stop is true on a final item), close runs twice. Use `defer`:

```go
go func() {
    defer close(out)
    for v := range in {
        if v.Stop { return }
        out <- transform(v)
    }
}()
```

`defer` guarantees exactly one close on exit.

### The exit-fast close

```go
go func() {
    defer close(out)
    for {
        v, ok := <-in
        if !ok { return }
        if cond(v) { return } // fast exit; defer fires close
        out <- transform(v)
    }
}()
```

Looks fine, but: `in` still has items that are now lost because the goroutine returned early. Is that the desired behaviour? Possibly. Document it.

The deeper issue: if `in` is single-source and has a `defer close(in)` upstream, the upstream goroutine will eventually exit. Fine. But if `in` is multi-source, upstream goroutines keep running because no one's reading. Leaks.

For early-exit goroutines downstream of multi-source pipelines, you must signal the upstream to stop via `done`. This is the cancellation cascade.

### The optional close

```go
type T struct {
    ch chan int
    closeOnExit bool
}

func (t *T) loop() {
    for v := range t.ch { ... }
    if t.closeOnExit { close(t.ch) }
}
```

`for range t.ch` exits when `t.ch` is *already* closed. Then the conditional close panics (close of closed channel). The condition is nonsensical.

This pattern usually indicates confusion about who closes the channel. Trace and rewrite.

---

## Specific Library API Pitfalls

A short tour of close-related API mistakes I've seen in published libraries.

### Library exposes `chan T` (not directional)

```go
func (l *Lib) Events() chan Event { return l.events }
```

Callers can send to and close `events`. Both are wrong: the library is the producer. Even if the docs say "do not send or close", the type system allows it, and users will.

Fix: return `<-chan Event`. Compile-time enforcement.

### Library does not document close

```go
// EventCh returns the event channel.
func (l *Lib) EventCh() <-chan Event { return l.events }
```

When does it close? Caller cannot tell. Use:

```go
// EventCh returns the event channel. The channel is closed when the
// library is shut down via l.Close(); after that, no more events are
// delivered and any receivers see ok=false.
```

### Library closes on caller-side resource exhaustion

Some libraries close their channel when they detect that no one is receiving (e.g., they timeout on send). This is surprising behaviour. The caller may want to resume reading later. Better to log and drop, or keep blocking.

### Library forgets to close

If the library's docs say "the channel is closed on Shutdown" and Shutdown does not actually close, callers's `for range` blocks forever. This is a goroutine leak from the caller's perspective. Test with `range` to verify.

---

## Multi-Tenant Channel Close

In systems serving multiple tenants (multi-tenant SaaS, multi-account services), each tenant may have its own channel. Closing one tenant's channel must not affect others.

```go
type TenantCh struct {
    mu     sync.RWMutex
    chs    map[TenantID]chan Event
    closed map[TenantID]bool
}

func (t *TenantCh) Subscribe(tid TenantID) <-chan Event {
    t.mu.Lock()
    defer t.mu.Unlock()
    if t.chs[tid] == nil {
        t.chs[tid] = make(chan Event, 64)
    }
    return t.chs[tid]
}

func (t *TenantCh) Publish(tid TenantID, e Event) {
    t.mu.RLock()
    ch := t.chs[tid]
    closed := t.closed[tid]
    t.mu.RUnlock()
    if ch == nil || closed { return }
    select {
    case ch <- e:
    default: // drop on full
    }
}

func (t *TenantCh) CloseTenant(tid TenantID) {
    t.mu.Lock()
    defer t.mu.Unlock()
    if t.closed[tid] { return }
    t.closed[tid] = true
    if ch := t.chs[tid]; ch != nil {
        close(ch)
        delete(t.chs, tid)
    }
}
```

Notes:

- Per-tenant `closed` flag for idempotent close.
- Publish reads `ch` and `closed` under RLock for concurrency.
- Subscribe and Close take the full lock.
- The race window between `Publish`'s check and its send: another goroutine could call `CloseTenant`. Then `ch <- e` panics. Fix: hold RLock during the send, or use the done-channel idiom.

The robust version:

```go
type tenantState struct {
    ch   chan Event
    done chan struct{}
    once sync.Once
}

type TenantCh struct {
    mu  sync.RWMutex
    chs map[TenantID]*tenantState
}

func (t *TenantCh) Publish(tid TenantID, e Event) {
    t.mu.RLock()
    st := t.chs[tid]
    t.mu.RUnlock()
    if st == nil { return }
    select {
    case <-st.done:
        return
    case st.ch <- e:
    default: // drop on full
    }
}

func (t *TenantCh) CloseTenant(tid TenantID) {
    t.mu.Lock()
    st := t.chs[tid]
    delete(t.chs, tid)
    t.mu.Unlock()
    if st != nil {
        st.once.Do(func() { close(st.done) })
    }
}
```

The `done` channel handles the race: Publish selects on both `done` and the data channel. If done fires first, abandon. The data channel is never closed; GC reclaims when references drop.

This is the senior-grade multi-tenant close pattern.

---

## Real-World Bug Examples

### Bug 1: Kubernetes informer close race

A real bug in early Kubernetes versions: an informer goroutine closed its event channel while another informer was sending. Panic in production. The fix introduced a stop channel and rewrote the close protocol to use it.

The lesson: any shared channel between goroutines needs documented ownership.

### Bug 2: gRPC stream close

In some gRPC stream patterns, the server-side handler closes the response channel on exit. If the client cancels the stream, the server's exit code may double-close. Panic.

The fix: use sync.Once or do not close at all (let the client cancellation handle teardown).

### Bug 3: errgroup-with-buffered-results

```go
g, ctx := errgroup.WithContext(parent)
out := make(chan Result, 1)
g.Go(func() error {
    out <- compute(ctx) // blocks if buffer full
    return nil
})
g.Go(func() error {
    return process(<-out)
})
// who closes out?
```

Neither goroutine closes `out`. After both exit, the channel is GC'd. Fine.

But: if compute returns an error, the second goroutine waits forever on `<-out`. errgroup will collect the first error, but the second goroutine never returns. g.Wait blocks forever.

Fix: the compute goroutine must always send, even on error (perhaps with a sentinel). Or use a struct with both Result and Err.

### Bug 4: shutdown ordering

A service has database, queue, and HTTP handler goroutines. On shutdown, the database is closed first. The queue still has in-flight messages. HTTP handlers try to write to the database. Errors everywhere.

Fix: shutdown in reverse order of dependencies. HTTP first (stop accepting), then queue (drain), then database (close).

---

## Self-Assessment

By the end of this file, you should be able to answer:

1. What are the three roles in a close protocol (owner, closer, senders), and how can they overlap?
2. Why is "only the sender closes" insufficient as a rule? When does it fail?
3. What is the race window of the bare `defer close` pattern? Of WaitGroup-based close? Of sync.Once+done?
4. Why does the runtime panic on double-close instead of returning an error?
5. What is the difference between quiescent close and snap-close, and when do you use each?
6. How does a pipeline cascade close from source to sink without explicit coordination?
7. Why does every stage in a pipeline need a done-channel or context, not just the source?
8. When should a library expose `<-chan T` vs `chan<- T` vs hide the channel entirely?
9. What is the danger of an atomic flag without a done-channel?
10. How would you test a Close method for idempotency and for race-freedom?

If you can answer all ten without re-reading, you are ready for `professional.md`.

---

## Summary

Senior-level close handling is not about memorising patterns; it is about reasoning over them. The same channel can be safely closed by five different mechanisms, and the choice depends on the system around it.

The recurring principles:

- **Ownership is the foundation.** Every channel has exactly one closer. Use direction types to document this.
- **Quiescence beats snapping.** When you can wait for senders to finish, do. Use WaitGroup or errgroup.
- **When you cannot wait, use done-channel + sync.Once.** Never close the data channel; close a separate cancellation channel.
- **Context and close coexist.** Context is for abort; close is for natural end. Both are needed.
- **Atomic flags are insufficient on their own.** They race with sends. Always pair with done-channel or mutex+select.
- **At API boundaries, hide the channel.** Or expose it as receive-only and offer a `Close()` method that is idempotent.

The senior code reviewer's instinct: when you see `close(ch)`, ask "who else can send on ch right now?" If the answer is "I am not sure", the design is wrong, regardless of whether the program currently passes tests.

Next, `professional.md` covers the runtime mechanics of close, the anatomy of the panic, lock-free idempotence, and forensic recovery from production close-violations.
