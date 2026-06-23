# Channels — Professional Level

> **Topic:** [Channels](README.md)
> **Focus:** designing channel-based APIs, ecosystem, migration, the future

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Pros & Cons](#pros--cons)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Best Practices](#best-practices)
13. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
14. [Common Mistakes](#common-mistakes)
15. [Tricky Points](#tricky-points)
16. [Test Yourself](#test-yourself)
17. [Tricky Questions](#tricky-questions)
18. [Cheat Sheet](#cheat-sheet)
19. [Summary](#summary)
20. [What You Can Build](#what-you-can-build)
21. [Further Reading](#further-reading)
22. [Related Topics](#related-topics)
23. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

At the professional level, channels are no longer a syntactic tool you reach for to "make goroutines talk." They become an **API design decision** with long-term consequences: once a channel is in a public function signature, it becomes part of your library's contract. Changing it later breaks every caller. Adding a buffer changes back-pressure semantics. Closing it from the wrong side becomes a panic that propagates across binaries.

This level focuses on the questions that separate a senior engineer from a library author and architect:

- Should a function return a channel, accept a callback, or expose an iterator?
- How do you migrate a 50,000-line codebase from "goroutine soup" — channels strung together with `select` statements and shared mutexes — into structured concurrency, without rewriting it all at once?
- How do channels in Go compare to nurseries in Trio (Python), streams in Rust, and Flow in Kotlin — and what can you steal from each ecosystem?
- When is the right answer "no channel at all"?
- What does the next decade look like, with Go 1.23+ iterators, Rust async streams stabilizing, and structured concurrency becoming the default in new languages?

The professional engineer answers these by reaching back to the theoretical foundations — Hoare's CSP, Milner's Pi-calculus, the occam programming language — and forward to the tooling that verifies designs before they ship: TLA+ specifications, model checkers, and structured concurrency invariants enforced by the compiler.

---

## Prerequisites

Before this material lands, you should be comfortable with:

- The junior and middle channel material in this folder — buffering, direction, select, fan-in/fan-out, leak prevention.
- Writing a non-trivial Go program with multiple goroutines coordinating through channels and `context.Context`.
- Reading Rust or Python async code, at least at a "I can follow what it does" level.
- The basic vocabulary of concurrency: race condition, deadlock, livelock, back-pressure, fairness, ownership.
- API design intuition: the difference between a function that returns and a function that streams, the cost of a breaking change in a public interface.
- Some exposure to formal methods is helpful but not required — we will introduce TLA+ at a sketch level.

---

## Glossary

- **API surface** — the set of types, functions, and behaviors a library exposes to its callers and promises not to break.
- **Channel ownership** — the convention that exactly one goroutine is responsible for closing a channel; usually the sender.
- **Structured concurrency** — a discipline where every spawned task has a definite parent scope; the scope cannot exit until all children finish or are cancelled.
- **Nursery** — Trio's name for a structured concurrency scope; a block that owns a set of concurrent tasks.
- **Stream** — an asynchronous iterator that yields values over time; the async analogue of a synchronous iterator.
- **Flow** — Kotlin's cold asynchronous stream type with built-in back-pressure.
- **CSP** — Communicating Sequential Processes, Tony Hoare's 1978 model of concurrency where processes interact only via synchronous message passing on named channels.
- **Pi-calculus** — Robin Milner's process algebra that extends CSP with mobile names: channels themselves can be sent over channels.
- **occam** — a 1980s programming language built directly on CSP, used on the Transputer microprocessor; the spiritual ancestor of Go's channels.
- **Back-pressure** — the mechanism by which a slow consumer slows down a fast producer, instead of letting unbounded buffering eat memory.
- **Cold stream** — a stream whose work starts only when someone collects it; restartable.
- **Hot stream** — a stream that produces regardless of consumers; values are dropped or buffered if no one is reading.
- **Goroutine soup** — a codebase pattern where goroutines are spawned ad hoc with `go funcName(...)` and connected by channels without a clear owner or scope.
- **TLA+** — Leslie Lamport's specification language for concurrent and distributed systems, with a model checker (TLC).
- **Iterator (Go 1.23+)** — a function-shaped iterator using the `iter.Seq` and `iter.Seq2` types; range over functions.
- **Public surface stability** — the guarantee that callers compiled against version N keep working against version N+1.

---

## Core Concepts

### Designing a library API: return a channel, accept a callback, or expose an iterator?

When you are writing a function that produces a sequence of values over time, you have three primary shapes:

```go
// Shape A: return a channel
func Watch(ctx context.Context) <-chan Event

// Shape B: accept a callback
func Watch(ctx context.Context, onEvent func(Event)) error

// Shape C: expose an iterator (Go 1.23+)
func Watch(ctx context.Context) iter.Seq[Event]
```

Each has consequences that ripple through the rest of the codebase. Use this checklist:

| Question | Channel | Callback | Iterator |
|----------|---------|----------|----------|
| Can the caller easily combine with other producers? | Yes (select) | Awkward | Hard |
| Can the caller easily back-pressure? | Yes (unbuffered) | Yes (return value) | Yes (don't pull) |
| Can the producer know when the consumer is done? | Only via close direction | Yes (return error/bool) | Yes (stop iterating) |
| Is the function easy to test? | Medium | Easy | Easy |
| Does the function leak resources if the caller forgets? | Yes (goroutine + channel) | Less likely | No (lazy) |
| Is the API friendly to non-Go callers reading the docs? | No | Yes | Yes |

**Rule of thumb.** Return a channel only when the caller genuinely benefits from `select`-style composition: merging multiple producers, racing against a timeout, fanning out to workers. If the caller will only ever `for v := range ch`, prefer a callback or an iterator — they are cheaper to evolve and harder to misuse.

### Channels as public surface — versioning concerns

Once a channel is in your public API, several properties become part of the contract:

- **Direction.** Returning `<-chan T` versus `chan T` is a breaking change.
- **Buffering.** Going from unbuffered to buffered changes back-pressure observable behavior; callers may have written code that depends on the producer blocking.
- **Who closes.** If your library used to close the channel and you stop closing it, range loops hang forever. If you start closing a channel you used to leave open, callers who send to it crash.
- **What close means.** If close signals "no more values," fine. If it signals "I had an error, check the error field," now you have invented a side channel and a breaking convention.

This is why mature Go libraries (the standard library especially) rarely expose raw channels. `http.Request.Context().Done()` returns a `<-chan struct{}` — receive-only, the closing semantics are documented, and the channel is owned by the request lifecycle. Compare with the deprecated `os.Signal` patterns: `signal.Notify` accepts a channel from the caller, putting ownership and capacity choice on the consumer.

### Channel ownership rules in a library context

The rule from the junior level — **the sender closes** — still holds, but at the library level it sharpens into:

1. **A channel returned from a library function is owned by the library.** The library closes it. Callers must not close it (panic).
2. **A channel passed into a library function is owned by the caller.** The library must not close it. The library documents whether it will send, receive, or both.
3. **A channel passed as both directions is a smell.** Split the API: one function for the producer side, one for the consumer side.
4. **Document the close condition.** "Closed when ctx is cancelled and all in-flight work finishes." Not "closed eventually." Not silence.

### Migration: from goroutine soup to structured concurrency

A typical legacy Go service looks like this:

```go
go writer(reqCh, errCh)
go reader(reqCh, doneCh)
go monitor(errCh, doneCh)
// main() returns, goroutines keep running until... when, exactly?
```

You cannot trace lifetimes. Goroutines leak when something goes wrong. Error propagation is via a side `errCh` that may or may not have a reader. Shutdown is a race.

The migration pattern, applied incrementally:

1. **Introduce `context.Context` at the entry points first.** Every long-running goroutine takes a context. Cancel it on shutdown.
2. **Replace ad hoc `go f(...)` with `errgroup.Group` or a custom nursery.** The group is the structured concurrency scope; it owns its children.
3. **Convert side `errCh` into return values from the group.** First error wins, rest are cancelled.
4. **Push channel ownership down into the package that creates each channel.** No more chains of channels passed across three packages.
5. **Replace `for { select { case <-ctx.Done(): return ... } }` boilerplate with helpers** that encapsulate the cancellation discipline.

You do this one subsystem at a time. After each pass, the code is still working; only one component has moved to structured form. Over months, the soup thickens into a tree.

### Trio (Python) nursery as channel-friendly structured concurrency

Trio, an async Python library by Nathaniel J. Smith, popularized the **nursery** abstraction. A nursery is a context manager that owns a set of tasks; the `with` block cannot exit until all started tasks finish or all are cancelled together.

```python
import trio

async def parent():
    async with trio.open_nursery() as nursery:
        nursery.start_soon(child_a)
        nursery.start_soon(child_b)
    # block exits only after both children finish
```

Trio offers **memory channels** (`trio.open_memory_channel`) that integrate with this discipline: the send and receive halves are explicit objects with capacities and a clear `close` operation. The nursery guarantees that a channel and the tasks that use it have a bounded lifetime.

The lesson Go can take: structured concurrency is a strict superset of channel-based concurrency. Channels still work, but they are scoped.

### Rust async streams vs channels — the merge

Rust has both:

- `tokio::sync::mpsc::channel` — a multi-producer, single-consumer channel similar to Go's.
- `futures::stream::Stream` — an async iterator trait: `poll_next(&mut self, cx: &mut Context<'_>) -> Poll<Option<T>>`.

A channel can be turned into a stream with `ReceiverStream`. From the consumer's perspective, both look like `while let Some(x) = stream.next().await`. From the producer's perspective, one is `tx.send(x).await` (back-pressure) and the other is `yield x` inside an `async_stream::stream!` macro.

The Rust community has converged on **streams as the consumer-facing abstraction** because they compose: `.map`, `.filter`, `.buffer_unordered(n)`, `.merge`. Channels stay inside the implementation. This is the same lesson as the Go iterator story: hide the channel, expose the iterator.

### Kotlin Flow as a channel-with-back-pressure

Kotlin's `Flow` is a cold asynchronous stream with structured concurrency baked in:

```kotlin
fun watch(): Flow<Event> = flow {
    while (true) {
        emit(nextEvent())
    }
}

scope.launch {
    watch().collect { event -> handle(event) }
}
```

Flow's `emit` suspends naturally; the collector's processing time becomes back-pressure on the producer. There is no channel visible. Under the hood, when you need fan-out or buffering, you use `channelFlow { ... }` which lets you `send` to an underlying channel. The default is the simple, safe shape; channels are an opt-in for advanced cases.

This is, again, the lesson: the **end-user API is the stream**, the **implementation detail is the channel**.

### Theory: Hoare CSP, occam, Pi-calculus

Tony Hoare's 1978 paper "Communicating Sequential Processes" introduced the model: processes are sequential, do not share state, and synchronize only by sending and receiving messages on named channels. The communication is **synchronous** — the sender and the receiver rendezvous; if either is not ready, the other waits.

David May took this idea to industrial reality with **occam** in 1983, paired with the Transputer microprocessor. occam channels were built into the language with `!` (send) and `?` (receive) operators and `PAR` blocks that ran processes concurrently. Hardware-level CSP.

Robin Milner generalized CSP to the **Pi-calculus** in 1992: channels are first-class values that can themselves be sent over channels (mobility). This is what makes Go's `chan chan T` not just a curiosity but a foundation for service discovery patterns, where the channel of communication is itself negotiated dynamically.

Why does the history matter? Because the design choices Go made — unbuffered channels as the default, the ability to send channels over channels, `select` as a generalized choice operator — were not invented; they were inherited. When you reach for a buffer to "make it work," you are stepping outside CSP semantics and into a different model, and you need to know it.

### When channels are wrong for an API

- **High-frequency events, low-cost handling.** A channel involves a goroutine scheduling round trip. For events at gigahertz rates (interrupts, audio samples), a ring buffer with atomic indices is orders of magnitude faster.
- **Strict total ordering across multiple producers.** A channel preserves order within a single producer but not across producers. If you need a global sequence number, you need a coordinator anyway, so the channel is just a queue in front of it.
- **Many-to-many broadcast.** A channel delivers each value to exactly one receiver. Pub/sub topics need a different shape: either copy-per-subscriber (with all the back-pressure questions that brings) or an event bus library.
- **Request/response with correlation.** You can build this on top of channels with reply channels, but it grows quickly into a custom RPC. A real RPC library is usually a better answer.

### Anti-patterns

**The deeply nested select.** When a single `select` has six cases and one of them is a nested goroutine that talks to another `select`, you have hidden a state machine. Make it explicit: a typed state, a function per state, a transition table.

**Channels everywhere.** Some teams adopt the rule "no shared state, only channels." It is well-intentioned but leads to channels carrying mutex-like signals — a channel of `struct{}` used as a "lock" — which is slower and harder to reason about than a `sync.Mutex`.

**"We'll just use a channel for that."** A reflex answer in code review. Push back. Ask: who owns it, who closes it, what is the back-pressure story, why not a callback?

### Mentoring: when a junior reaches for `make(chan ...)`

A common interview-and-code-review failure mode is the junior who writes `make(chan)` as the first move on any concurrency problem. Productive questions to ask:

- "How many senders and receivers?"
- "Is this synchronous or buffered, and why that capacity?"
- "Who closes it?"
- "What is the back-pressure story? What happens if the consumer is slower?"
- "What does the test look like?"
- "Could this be a function call instead?"

If they cannot answer cleanly, the channel is premature. Refactor the design first.

### Verifying channel-based code: TLA+, structured concurrency invariants

For systems that must be correct (consensus, replication, leader election), informal channel reasoning is not enough. TLA+ lets you specify the protocol — states, messages, transitions — and have the TLC model checker explore all interleavings. A typical channel-based pipeline has invariants like:

- "Every value sent is eventually received or the channel is closed."
- "The pipeline drains within finite steps after `ctx` is cancelled."
- "No goroutine survives past `ctx.Done()` plus a grace period."

These can be expressed as temporal formulas and checked.

Structured concurrency provides weaker but compiler-checked invariants:

- "Every child task's lifetime is contained in its parent's."
- "If the parent scope returns, all children have either finished or been cancelled."

### The future: Go iterators, Rust streams ergonomics, Loom-style virtual threads

- **Go 1.23 iterators** (`iter.Seq[V]`, `iter.Seq2[K, V]`) let you write `for x := range producer()` where `producer()` returns an iterator function. No channel, no goroutine, no leak. For producer/consumer APIs where composition is not needed, iterators are now the right answer.
- **Rust async streams** are stabilizing through `Stream` in `std::async_iter`. The ergonomics gap with channels narrows.
- **Java virtual threads (Project Loom)** make blocking I/O cheap again, which means CSP-style blocking sends and receives become viable on the JVM at scale.

The throughline: the **language gives you a structured, scoped, type-safe primitive** for sequences over time, and the channel becomes an implementation detail when you need fan-in, fan-out, or merging.

---

## Real-World Analogies

- **Channels in an API** are like **plumbing exposed on the outside of a building**: it works, you can attach to it, but every renovation has to preserve every fitting. Indoor plumbing (an iterator or callback) is easier to remodel.
- **Structured concurrency** is like **a family tree of responsibility**: every task has a parent who is liable for it. You cannot orphan children; the parent waits at the door.
- **CSP and occam** are the **theoretical blueprints**; Go and Rust are **two different houses built from those blueprints** with different trade-offs in the kitchen.
- **TLA+ for a channel pipeline** is like **doing structural calculations on a bridge before pouring concrete**: most of the time you do not need it; for the bridge that will carry trains, you do.
- **The deeply nested select** is the **rats' nest of cables behind the TV**: it works, but no one wants to debug it at 2 a.m.

---

## Mental Models

**Model 1: The API surface contract.** When you write `func F() <-chan T` in a public package, you have signed a contract that says: "I will produce zero or more T values, and at some documented point I will close this channel; you may receive, you may not send, you may not close." Every word of that contract is now versioned.

**Model 2: The scope tree.** Structured concurrency turns the goroutine graph from a flat soup into a tree. Each node is a scope; each scope has a parent; cancellation flows down, errors flow up. Channels live inside scopes, not across them, except at clearly defined seams.

**Model 3: Stream vs channel as roles.** A stream is a consumer-facing abstraction — pull-shaped, composable. A channel is a coordination primitive — push-shaped, primitive. In a well-designed library, the stream is the wrapper and the channel is the implementation detail.

**Model 4: The migration ratchet.** Each migration step moves one subsystem from soup to structured form, never both directions. You ratchet forward. After every PR, the system still works; the share of "structured" code grows monotonically.

**Model 5: Theory bounds practice.** When you ask "should I add a buffer?" you are choosing a model: CSP (no buffer) versus the buffered variant. Knowing which model you are in keeps you from mixing semantics.

---

## Code Examples

### Worked example 1: API design — return channel or accept callback

**Naive version: returns a channel.**

```go
// Package events
package events

// Watch returns a channel of events. Closed when ctx is done.
func Watch(ctx context.Context, src Source) <-chan Event {
    ch := make(chan Event)
    go func() {
        defer close(ch)
        for {
            select {
            case <-ctx.Done():
                return
            case ev := <-src.next():
                select {
                case ch <- ev:
                case <-ctx.Done():
                    return
                }
            }
        }
    }()
    return ch
}
```

Problems:

- Every caller must remember to cancel `ctx` to avoid leaks.
- The library spawns a goroutine the caller did not ask for.
- If the caller stops ranging, the producer blocks forever on send (until `ctx` cancels).
- Versioning: changing buffering or close semantics is breaking.

**Refactored: callback with error return.**

```go
// Watch calls onEvent for each event. Returns when ctx is done
// or onEvent returns ErrStop. No background goroutine.
func Watch(ctx context.Context, src Source, onEvent func(Event) error) error {
    for {
        if err := ctx.Err(); err != nil {
            return err
        }
        ev, err := src.next(ctx)
        if err != nil {
            return err
        }
        if err := onEvent(ev); err != nil {
            return err
        }
    }
}

var ErrStop = errors.New("watch: stop requested")
```

Now:

- No background goroutine; the caller's goroutine runs the loop.
- Back-pressure is automatic — `onEvent` blocks the loop.
- The caller can stop with `ErrStop` or by cancelling `ctx`.
- No channel ownership questions.
- Easy to evolve: add fields to `Event` or to `onEvent` later.

**Even better in Go 1.23+: iterator.**

```go
// Watch returns an iterator over events. The iterator stops when
// ctx is done or the consumer stops ranging. The error is reported
// through Err() after the loop ends.
func Watch(ctx context.Context, src Source) (iter.Seq[Event], func() error) {
    var err error
    seq := func(yield func(Event) bool) {
        for {
            if err = ctx.Err(); err != nil {
                return
            }
            var ev Event
            ev, err = src.next(ctx)
            if err != nil {
                return
            }
            if !yield(ev) {
                return // consumer stopped
            }
        }
    }
    return seq, func() error { return err }
}

// Caller:
seq, errFn := events.Watch(ctx, src)
for ev := range seq {
    handle(ev)
}
if err := errFn(); err != nil {
    log.Print(err)
}
```

This is the modern, leak-free shape.

### Worked example 2: goroutine-soup refactor to structured concurrency

**Before — soup.**

```go
func runPipeline(ctx context.Context, in <-chan Job) {
    parsed := make(chan Parsed, 16)
    enriched := make(chan Enriched, 16)
    errCh := make(chan error, 4)

    go parser(in, parsed, errCh)
    go enricher(parsed, enriched, errCh)
    go writer(enriched, errCh)
    go monitor(errCh)
}
```

Where are these goroutines when `runPipeline` returns? Still running. When does `errCh` get closed? Never. What if `parser` panics? The other stages hang.

**After — structured with `errgroup`.**

```go
import "golang.org/x/sync/errgroup"

func runPipeline(ctx context.Context, in <-chan Job) error {
    g, ctx := errgroup.WithContext(ctx)

    parsed := make(chan Parsed, 16)
    enriched := make(chan Enriched, 16)

    g.Go(func() error {
        defer close(parsed)
        return parser(ctx, in, parsed)
    })
    g.Go(func() error {
        defer close(enriched)
        return enricher(ctx, parsed, enriched)
    })
    g.Go(func() error {
        return writer(ctx, enriched)
    })

    return g.Wait()
}
```

Now:

- `runPipeline` blocks until every stage finishes — caller sees the scope.
- First error cancels `ctx`, which propagates to every stage that checks it.
- Each stage closes its own output channel; ownership is clear.
- No `errCh`, no `monitor`; errors flow up naturally.
- The code reads top to bottom as a data flow.

To migrate incrementally, you do this one pipeline at a time. After the first conversion, the rest of the codebase still uses the old style; nothing else has changed. After the tenth conversion, the style is the default.

### Worked example 3: TLA+ sketch for a critical pipeline

The TLA+ specification language is verbose; here is a sketch for a two-stage pipeline with an unbuffered channel between them:

```tla
---------------- MODULE Pipeline ----------------
EXTENDS Naturals, Sequences

CONSTANTS Workers, Items
VARIABLES inbox, channel, outbox, doneStage1, doneStage2

Init ==
    /\ inbox = Items
    /\ channel = << >>
    /\ outbox = << >>
    /\ doneStage1 = FALSE
    /\ doneStage2 = FALSE

Stage1Send ==
    /\ inbox /= << >>
    /\ Len(channel) = 0           \* unbuffered: must be empty
    /\ channel' = << Head(inbox) >>
    /\ inbox' = Tail(inbox)
    /\ UNCHANGED << outbox, doneStage1, doneStage2 >>

Stage2Recv ==
    /\ Len(channel) = 1
    /\ outbox' = Append(outbox, Head(channel))
    /\ channel' = << >>
    /\ UNCHANGED << inbox, doneStage1, doneStage2 >>

Stage1Close ==
    /\ inbox = << >>
    /\ doneStage1' = TRUE
    /\ UNCHANGED << inbox, channel, outbox, doneStage2 >>

Stage2Finish ==
    /\ doneStage1 = TRUE
    /\ Len(channel) = 0
    /\ doneStage2' = TRUE
    /\ UNCHANGED << inbox, channel, outbox, doneStage1 >>

Next ==
    \/ Stage1Send
    \/ Stage2Recv
    \/ Stage1Close
    \/ Stage2Finish

Spec == Init /\ [][Next]_<< inbox, channel, outbox, doneStage1, doneStage2 >>

\* Invariant: nothing is lost
NoLoss == doneStage2 => Len(outbox) = Len(Items)

\* Liveness: pipeline eventually finishes
Termination == <>(doneStage2 = TRUE)
=================================================
```

TLC will explore every interleaving and report a counterexample if `NoLoss` or `Termination` can fail. For a real pipeline you would add buffer capacity, cancellation, and multiple workers. The point: at this scale of system, you specify before you code.

---

## Pros & Cons

**Pros of channels as a public API surface.**

- Composable with `select`, fan-in, fan-out at the call site.
- Familiar to anyone who has used Go.
- Back-pressure is a property of the channel, not a wire-up step.

**Cons of channels as a public API surface.**

- Versioning hazards: direction, capacity, close semantics are all part of the contract.
- Easy to leak if the caller forgets a cancellation path.
- The library spawns goroutines the caller cannot easily observe.
- Hostile to non-Go integrations: tracing, metrics, and FFI all want function calls.

**Pros of structured concurrency.**

- Lifetimes are obvious from indentation.
- Errors propagate naturally.
- Cancellation is a single operation.
- Code is easier to test and easier to reason about.

**Cons of structured concurrency.**

- More boilerplate in the simplest cases (a single goroutine inside a group).
- Migration cost from legacy code is real.
- Some patterns (long-lived background workers managed by a supervisor) need a layer above the basic scope.

---

## Use Cases

- **Library author writing a producer API.** Choose iterator first, callback second, channel only when composition demands it.
- **Architect adopting structured concurrency.** Roll it out subsystem by subsystem; introduce `errgroup` at the entry points; refactor inward.
- **Mentor reviewing a junior's first concurrent code.** Use the channel ownership and back-pressure questions; suggest a callback if no composition is needed.
- **Team writing a consensus or replication protocol.** Specify the protocol in TLA+; implement on channels with the spec as the test oracle.
- **Migrating from Go 1.22 to 1.23+.** Convert leak-prone channel APIs to iterators where it makes sense; channels remain inside the implementation.
- **Working in Rust or Kotlin.** Apply the same lesson: streams or flows on the outside, channels on the inside.

---

## Coding Patterns

**Pattern: callback with `ErrStop`.** Use a sentinel error to let the caller end iteration without confusing it with a real failure.

**Pattern: iterator with `errFn`.** Pair a `for-range` iterator with a function that returns the final error.

**Pattern: nursery / errgroup at every entry point.** The first thing the request handler does is open a scope; the last thing it does is wait on it.

**Pattern: typed phantom directions.** Build your library's internal channels with named types that wrap `chan T` so that direction violations fail at compile time, even when channels are stored in structs.

**Pattern: TLA+ as a design artifact.** Keep the spec in the repo next to the code. Reviewers update both.

**Pattern: anti-corruption layer between subsystems.** Each subsystem owns its channels; the seams between subsystems are function calls, not channels.

---

## Clean Code

- A function signature should tell a future reader: "I produce values for as long as ctx is alive." If the function spawns hidden goroutines, the documentation must say so.
- Name channels in code by their role: `parsed`, `enriched`, `done` — not `ch`, `ch1`, `ch2`.
- Avoid mixing `select` with shared mutexes; pick one model per subsystem.
- If a `select` has more than four cases, extract a state machine.
- Comment the close discipline directly above the `make(chan ...)`: who closes, why, when.

---

## Best Practices

- Default to **iterator or callback** in new public APIs; reach for channel only when composition is the point.
- Adopt `errgroup` or a custom nursery at every entry point of every long-running subsystem.
- Document every public channel's: direction, capacity, close condition, and ownership.
- For protocols, write a TLA+ or Alloy spec before the implementation; treat it as test material.
- Use Go 1.23+ iterators in new code where they fit; they eliminate a class of leaks.
- In Rust, prefer `Stream` over raw channels at API boundaries.
- In Kotlin, prefer `Flow` over `Channel` at API boundaries; reach for `channelFlow` only when you need fan-out.
- Treat the deeply nested `select` as a code smell; refactor into a state machine.
- Periodically audit `make(chan` occurrences for leaks and ownership clarity.

---

## Edge Cases & Pitfalls

- **A library that closes a caller-owned channel.** Panic. Document who owns what; never assume.
- **A consumer that stops ranging early.** The producer goroutine blocks on send forever, unless it selects on `ctx.Done()`.
- **`errgroup.WithContext` and a non-cancellable child task.** The group's cancellation never propagates; the wait hangs. Always check `ctx.Done()` in long loops.
- **TLA+ spec drift.** Spec says one thing, code does another; both compile, neither matches reality. Treat the spec as living documentation; review it in PRs.
- **Migration partway through.** Half the codebase is structured, half is soup. The seam between them is dangerous: an `errgroup` waiting on a soup goroutine that never returns hangs the whole scope.
- **Iterator that calls `yield` from inside a goroutine.** Iterators in Go 1.23 must call `yield` from the goroutine that called the iterator, not from a child. Otherwise undefined behavior.
- **Buffered channel as "we'll never block."** If your consumer is genuinely slower than the producer, the buffer fills and you block anyway, or you OOM. The buffer is not a fix for missing back-pressure.

---

## Common Mistakes

- Returning `chan T` (bidirectional) from a library function. Return `<-chan T`.
- Spawning a goroutine inside a library function without documenting it.
- Adding a buffer to "fix" a deadlock that was caused by missing close.
- Using a channel as a mutex. Use a mutex.
- Migrating to structured concurrency by deleting `go` keywords. You need to think about scopes, not just keywords.
- Writing a TLA+ spec, never running TLC, and treating the spec as decoration.
- Forgetting to update the iterator-returning API when the underlying channel semantics change.

---

## Tricky Points

- **Iterators are pull-shaped, channels are push-shaped.** Converting between them is non-trivial; you usually need a goroutine to bridge.
- **Structured concurrency does not prevent all leaks.** It prevents lifetime leaks; logical leaks (a worker that loops forever even when cancelled) still happen.
- **CSP semantics versus Go semantics.** Go's channels are CSP-inspired but not identical: buffering, select, close, and `nil` channels add behavior CSP does not specify.
- **TLA+ is hard to learn.** Budget weeks, not days, before your first useful spec.
- **Migration is political, not just technical.** Senior engineers must agree on the target shape and the ratchet; otherwise you get half-converted code that pleases no one.

---

## Test Yourself

1. You are designing a library function that produces log lines from a file. Channel, callback, or iterator? Defend your choice.
2. What is the contract a public `<-chan T` makes with its callers? List every property that becomes versioned.
3. Translate a small Go pipeline of `go writer; go reader; go monitor` into structured concurrency with `errgroup`.
4. Describe how Trio's nursery would handle the same pipeline.
5. What is the relationship between a Kotlin `Flow` and a Kotlin `Channel`?
6. What does Hoare's CSP say about synchronous communication? How does Go deviate?
7. Why might you write a TLA+ spec for a leader-election protocol but not for a single-machine job queue?
8. A junior wants to add a buffer of 1000 to a channel that has been blocking. What questions do you ask before agreeing?
9. When does Go 1.23+ iterator syntax beat channels for a producer API?
10. Give an example of a deeply nested `select` and refactor it to a state machine.

---

## Tricky Questions

- **Q:** A library exposes `func Stream() <-chan Event`. You want to add a way to report errors to the caller. How do you evolve the API without breaking existing callers?
  **A:** You cannot, cleanly. Adding an error channel changes the type; embedding errors in `Event` changes its meaning. The honest answer is a new function — `func StreamWithErrors() (<-chan Event, <-chan error)` — and deprecate the original. This is exactly the versioning hazard that argues against channels in public APIs.

- **Q:** Why does Trio refuse to let you spawn a task outside a nursery?
  **A:** To make leaks impossible. Every task must have a parent scope that will wait for it. There is no "fire and forget" because forgetting is the bug.

- **Q:** Kotlin's `Flow` and Rust's `Stream` look very different syntactically. What do they have in common?
  **A:** Both are cold, pull-based asynchronous sequences with structured scoping. Both hide channels behind a composable iterator interface. Both make back-pressure the default.

- **Q:** What does Pi-calculus add over CSP that Go's channels exploit?
  **A:** Mobility — channels can be sent over channels. Go's `chan chan T` and the request/reply pattern (send a reply channel inside a request) come straight from Pi-calculus.

- **Q:** Is `errgroup` structured concurrency?
  **A:** It is the closest Go ships in the standard ecosystem, yes. It is not as rigid as Trio's nursery — you can still leak goroutines by spawning outside the group — but it gives you scope, cancellation, and error propagation in a small API.

- **Q:** Should you ever use channels for high-frequency events like 100k events/sec?
  **A:** Probably not. The scheduling and goroutine cost dominates. Use a ring buffer with atomic indices, or batch events into chunks of 1000 and send the chunks through a channel.

- **Q:** A TLA+ spec passes the model checker. Does that mean the implementation is correct?
  **A:** No. The spec models what you thought you were building; the implementation may not match. The spec catches design bugs, not implementation bugs.

- **Q:** When will Go iterators fully replace channel APIs?
  **A:** They will not. Iterators replace channels for sequence-producing APIs without composition needs. Channels remain the primitive for fan-in, fan-out, racing, and coordination.

---

## Cheat Sheet

| Decision | Default | Reach for alternative when |
|----------|---------|----------------------------|
| Public producer API | Iterator (Go 1.23+) or callback | Caller needs `select`-style composition |
| Channel direction in signature | `<-chan T` (receive-only) | You explicitly want callers to send |
| Buffer capacity | 0 (unbuffered) | You have a measured rate mismatch with bounded burst |
| Close discipline | Sender closes | Library returns channel — library closes |
| Long-running goroutine | Inside `errgroup` scope | Truly process-lifetime worker (supervisor pattern) |
| Error propagation | Return value from scope | None — embedding errors in channels is a smell |
| Cancellation | `context.Context` | None — context everywhere |
| Verification | Tests + race detector | TLA+ for protocols, model checking for consensus |
| Cross-language equivalent | Trio nursery / Kotlin Flow / Rust Stream | Each ecosystem has converged on stream-on-the-outside |

---

## Summary

At the professional level, channels stop being a primitive you reach for and become a design decision you justify. The questions are no longer "how do I use a channel?" but "should I expose one?", "how do I version it?", "who owns it?", "what does structured concurrency look like for this team?", and "what does the verification story look like for this protocol?".

The answers form a coherent direction:

- **Default to iterators and callbacks** in public APIs; channels are an implementation detail.
- **Adopt structured concurrency** — `errgroup` in Go, nurseries in Python, scopes in Kotlin, tasks in Rust — at every entry point.
- **Migrate incrementally** from goroutine soup to scoped trees; never both directions at once.
- **Steal from other ecosystems.** Trio's nursery, Kotlin's Flow, Rust's Stream all teach the same lesson.
- **Reach back to the theory.** CSP and Pi-calculus tell you what semantics you are choosing; occam tells you the choices are old and well-understood.
- **Specify critical protocols** in TLA+ before coding.
- **Watch the future arrive.** Go iterators, Rust streams, virtual threads on the JVM are quietly making channels less central, not more.

If the junior level was "channels are messages on wires," and the middle level was "channels are coordination tools you must own," then the professional level is **"channels are an implementation detail of a structured concurrency design that you justify, version, verify, and migrate toward."**

---

## What You Can Build

- A `migrate-to-errgroup` codemod that rewrites top-level `go f(...)` calls in a file to `g.Go(func() error { return f(...) })` inside an `errgroup`, with a final `g.Wait()`.
- A linter rule that flags public functions returning `chan T` (bidirectional) instead of `<-chan T`.
- A library that wraps a channel-returning API in an iterator (Go 1.23+) with proper cleanup, so legacy callers can migrate gradually.
- A TLA+ specification of a real pipeline in your codebase, with TLC scripted in CI to fail the build if the spec breaks.
- A mentoring rubric for code review: a checklist of channel-ownership and back-pressure questions a reviewer can paste.
- A talk or internal write-up comparing Trio nurseries, Kotlin Flow, Rust Stream, and Go errgroup, with side-by-side examples.

---

## Further Reading

- Tony Hoare, "Communicating Sequential Processes," CACM 1978 — the founding paper.
- Robin Milner, "Communicating and Mobile Systems: The Pi-Calculus," 1999.
- "Notes on Structured Concurrency, or: Go statement considered harmful" by Nathaniel J. Smith (2018).
- Go 1.23 release notes — iterator types (`iter.Seq`, `iter.Seq2`).
- "Concurrency in Go" by Katherine Cox-Buday — chapters on patterns and pitfalls.
- "Programming with TLA+" by Leslie Lamport — for the formal-methods route.
- Kotlin coroutines and Flow documentation — for the structured-concurrency-with-back-pressure design.
- Tokio and `futures` crate documentation — for Rust's stream model.
- "occam Programming Manual" — for the historical perspective.
- "Software and the Concurrency Revolution" by Sutter and Larus — for the broader context.

---

## Related Topics

- [Channels — Overview](README.md)
- [Channels — Junior Level](junior.md)
- [Channels — Middle Level](middle.md)
- [Structured Concurrency](../../README.md)
- [Concurrency Models](../../../01-models/README.md)
- [Mutexes and Atomics](../03-mutexes/README.md)
- [Context Cancellation](../06-context/README.md)
- [Async Programming](../../../../async-programming/README.md)

---

## Diagrams & Visual Aids

**Diagram 1: API shape decision tree.**

```
Function produces values over time?
       |
       v
Will the caller compose multiple sources, race, or fan-in/out?
       |
   +---+-----------+
   |               |
  Yes              No
   |               |
   v               v
 Channel        Will the caller want to stop early?
                   |
               +---+---+
               |       |
              Yes      No
               |       |
               v       v
            Iterator  Callback
            (Go 1.23+)
```

**Diagram 2: Goroutine soup vs structured tree.**

```
Soup:                              Structured:

main                                main
 |                                   |
 +--> writer (?)                     +-- errgroup
 +--> reader (?)                          |
 +--> monitor (?)                         +-- parser
 +--> ??? (leaked)                        +-- enricher
                                          +-- writer
 No tree, no ownership.            All children owned by group;
 No clean shutdown.                Wait() blocks until all done.
```

**Diagram 3: Ecosystem comparison.**

```
                Producer-facing             Consumer-facing
Go (<=1.22):    chan T (send)               chan T (receive via range)
Go (1.23+):     iter.Seq (yield)            for-range
Trio:           memory_channel send         async for + nursery
Kotlin:         flow { emit(x) }            collect { ... }
Rust:           async-stream yield          while let Some = next().await
```

**Diagram 4: TLA+ in the development loop.**

```
[Spec.tla] --(TLC model check)--> [Counterexample or PASS]
   ^                                       |
   |                                       v
   +--<-- update spec <----- [Implementation diverges] <-- code review
```

**Diagram 5: The deeply nested select smell.**

```
Before:                            After:

for {                              type State int
  select {                         const (
    case <-a:                        StateWaiting State = iota
      for {                          StateProcessing
        select {                     StateClosing
          case <-b:                )
            for {
              select {             func (m *Machine) Step() State { ... }
                case <-c: ...
              }
            }
        }
      }
  }
}
```

**Diagram 6: Migration ratchet.**

```
Time --->
[soup][soup][soup][soup][soup][soup]    week 0
[soup][soup][SC ][soup][soup][soup]     week 2 (one subsystem converted)
[soup][SC ][SC ][soup][SC ][soup]       week 4
[SC ][SC ][SC ][SC ][SC ][SC ]          week N

Never goes backward. Each PR converts one piece.
```

**Diagram 7: Channel ownership at a library boundary.**

```
+-------------------------+        +-------------------------+
| Library                 |        | Caller                  |
|                         |        |                         |
|   ch := make(chan T)    |        |                         |
|   go produce(ch)        |        |                         |
|   return <-chan T(ch) --|------->|   for v := range ch     |
|                         |        |       handle(v)         |
|   // library closes ch  |        |   // caller never        |
|                         |        |   // closes or sends    |
+-------------------------+        +-------------------------+
```

The contract is one-directional and the close is on the library side. Every word of that contract is now versioned.
