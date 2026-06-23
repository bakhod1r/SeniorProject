# Channel Direction — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Channel Direction as Architectural Contract](#channel-direction-as-architectural-contract)
3. [Module Boundaries and Public Surface](#module-boundaries-and-public-surface)
4. [Ownership Models for Long-Lived Services](#ownership-models-for-long-lived-services)
5. [Generics and Direction at Scale](#generics-and-direction-at-scale)
6. [When Direction Hurts: Anti-Patterns](#when-direction-hurts-anti-patterns)
7. [Interop With Non-Channel APIs](#interop-with-non-channel-apis)
8. [Refactoring Production Systems](#refactoring-production-systems)
9. [Plug-Ins, Untrusted Callbacks, and Direction](#plug-ins-untrusted-callbacks-and-direction)
10. [Channels of Channels in Real Systems](#channels-of-channels-in-real-systems)
11. [Observability and Lifecycle](#observability-and-lifecycle)
12. [Design Reviews: a Senior's Lens](#design-reviews-a-seniors-lens)
13. [Self-Assessment](#self-assessment)
14. [Summary](#summary)

---

## Introduction

At senior level you stop thinking about channel direction at a line-of-code level and start thinking at the **module boundary**. The questions change:

- What does my package promise to callers? Direction is part of the public type.
- How do plug-ins, callbacks, and goroutine subtrees interact with our channels?
- What invariants does direction give me when I have 50 long-running pipelines and a team of 20 engineers touching them?
- When is `chan T` actually the right answer? (Sometimes!)
- How do I evolve a public API that uses channels without breaking semver?

After this file you will:

- Choose appropriate directional contracts at module boundaries.
- Recognise the small set of cases where direction is the wrong abstraction.
- Design plug-in interfaces that use directional channels for safety.
- Evaluate other people's designs in code review through a "direction" lens.
- Plan refactors that change channel direction without breaking downstream consumers.

---

## Channel Direction as Architectural Contract

A package's public API is its contract. When that API uses channels, the directional types form a small but important part of the contract:

```go
package events

type Stream interface {
    Subscribe() <-chan Event
    Close()
}
```

Three guarantees:

1. **Subscribers cannot publish.** Direction prevents accidental "writes upstream" from a subscriber buggy enough to try.
2. **Subscribers cannot close the stream.** Lifecycle is owned by the producer.
3. **Subscribers may `select` and `range` over the channel** as a normal Go primitive.

If `Subscribe()` returned `chan Event`, the contract would be much weaker — every subscriber would be a potential mis-actor.

### Versioning channels

Once you publish a `<-chan T` in a public API, you must keep it stable across versions:

- Element type `T` cannot change without breaking subscribers (no implicit narrowing or widening between types).
- Closing semantics cannot change quietly. If you used to close on shutdown and now you never close, every subscriber's `range` loop hangs.
- Buffer size is *not* part of the type — `chan T` and `chan T` of capacity 4 are the same type. You can change capacity transparently. Good.
- Direction is part of the type. Changing `<-chan T` to `chan T` widens; subscribers compile fine, but new code might start writing where it should not. Changing `chan T` back to `<-chan T` is a breaking change.

> Rule: pick the narrowest direction for public APIs from day one. Widening later is silent; narrowing later breaks.

### Lifetime contract

A public `<-chan T` carries an implicit lifetime contract:

| Producer behaviour | Consumer expectation |
|---|---|
| Closes channel on shutdown | `range` terminates cleanly |
| Drains slowly | Consumer must keep reading or buffer fills |
| Never closes | Consumer's `range` never returns; document this |
| Closes on context cancel | Document and tie to passed `ctx` |

Direction tells the consumer they cannot influence the lifetime — they can only observe it. The accompanying docs must therefore say *how* and *when* the producer closes.

---

## Module Boundaries and Public Surface

A package's surface is the set of exported identifiers visible to other packages. Channels appear in three forms on the surface:

1. **Functions that return channels.** `func Subscribe() <-chan Event`.
2. **Functions that accept channels.** `func RegisterSink(in <-chan Event)`.
3. **Struct fields with channel types.** Rare in idiomatic Go — usually wrapped in methods.

### Public return: receive-only

A library that gives you a stream gives you a `<-chan T`. The consumer pattern:

```go
events := lib.Stream()
for e := range events {
    handle(e)
}
```

The consumer cannot close `events` — the library decides when. The consumer cannot publish back — the library handles that internally. This is the cleanest public surface and the default for streaming APIs.

### Public parameter: send-only

A library that *accepts* a stream from the caller — for instance, a logging sink:

```go
func RegisterSink(events <-chan Event)
```

Wait — this is receive-only too. The library reads; the caller produces. The caller holds the bidirectional reference; the library holds the read-only view.

A send-only parameter is rarer. A library that lets you push work in:

```go
func (q *Queue) Submitter() chan<- Job
```

Returns send-only. The caller can send and close, but cannot read.

### Public field: avoid

```go
type Broker struct {
    Events <-chan Event       // public
}
```

Acceptable but unidiomatic. Prefer a method `Events() <-chan Event` to leave room for evolution (e.g., adding metrics, supporting late subscribers, switching to a different mechanism).

### Interface methods

Channels in interface methods are common in mocking and dependency injection:

```go
type EventSource interface {
    Events(ctx context.Context) <-chan Event
}
```

The interface mandates the directional return. Implementations cannot return `chan Event` because the type does not match the interface signature.

---

## Ownership Models for Long-Lived Services

In long-running services (servers, daemons), channels live for the lifetime of the process. Ownership becomes critical because misallocated responsibility leads to leaks, premature closes, or zombie goroutines.

### Model 1: Single-owner stream

One goroutine owns the bidirectional channel. All sends come from inside that goroutine; all closes come from it. External code only reads.

```go
type Hub struct {
    in   chan Message     // bidirectional, owned by Hub.run
    subs chan chan<- Message
}

func (h *Hub) Subscribe() <-chan Message {
    out := make(chan Message, 64)
    h.subs <- out
    return out
}
```

`Hub.run()` is the single owner. It accepts new subscriptions, fans messages out, and closes downstream channels when subscribers leave.

### Model 2: Producer-owned downstream

A pipeline stage owns the downstream channel; the upstream stage owns its own downstream. Each stage closes its own output when its input closes:

```go
func stage(ctx context.Context, in <-chan In) <-chan Out {
    out := make(chan Out)
    go func() {
        defer close(out)              // closes its own
        for v := range in {           // until upstream closes
            ...
        }
    }()
    return out
}
```

The chain propagates closure from the source downward. Direction lets the type system enforce that each stage owns only its own output.

### Model 3: Coordinator pattern

A coordinator goroutine owns multiple channels and dispatches between them. Worker goroutines have only directional references:

```go
type Coordinator struct {
    jobs    chan Job     // owned: writes from external API, reads from workers
    results chan Result  // owned: writes from workers, reads from caller
}

// expose to workers
func (c *Coordinator) jobsRead() <-chan Job        { return c.jobs }
func (c *Coordinator) resultsWrite() chan<- Result { return c.results }
```

Workers see read-only `jobs` and write-only `results`. The coordinator does everything else.

### Model 4: Hand-off model

A producer creates a channel, sends into it, closes it, and hands the read-side to a consumer. Lifetime is bounded to one request:

```go
func RequestStream(req Request) <-chan Response {
    out := make(chan Response, 8)
    go func() {
        defer close(out)
        for r := range fetch(req) {
            out <- r
        }
    }()
    return out
}
```

The caller reads until close, then discards the reference. No long-lived sharing.

### Choosing among models

| Lifecycle | Recommended model |
|---|---|
| Per-request stream | Hand-off |
| Long-lived broadcast | Single-owner with subscriber list |
| Pipeline | Producer-owned downstream |
| Work queue with results | Coordinator |

In all four, directional types enforce who can do what — closes are owned, sends are owned, reads are open.

---

## Generics and Direction at Scale

Generics give you reusable pipeline parts. The signatures look like this:

```go
type Source[T any] interface {
    Next(ctx context.Context) (<-chan T, error)
}

type Sink[T any] interface {
    Write(ctx context.Context, in <-chan T) error
}

type Stage[A, B any] interface {
    Run(ctx context.Context, in <-chan A) <-chan B
}
```

You can build a typed runner:

```go
func Run[A, B any](
    ctx context.Context,
    src Source[A],
    st  Stage[A, B],
    snk Sink[B],
) error {
    in, err := src.Next(ctx)
    if err != nil {
        return err
    }
    out := st.Run(ctx, in)
    return snk.Write(ctx, out)
}
```

The compiler now enforces direction across the whole pipeline at compile time. A `Sink[B]` cannot accidentally send into its input; a `Source[A]` cannot read from its own output.

### A library of stages

A senior-level codebase often has a small library of generic stages:

```go
// stages.go
func Map[A, B any](ctx context.Context, in <-chan A, f func(A) B) <-chan B
func Filter[T any](ctx context.Context, in <-chan T, p func(T) bool) <-chan T
func Batch[T any](ctx context.Context, in <-chan T, n int) <-chan []T
func Throttle[T any](ctx context.Context, in <-chan T, rate time.Duration) <-chan T
func Buffer[T any](ctx context.Context, in <-chan T, size int) <-chan T
```

Each takes `<-chan T` and returns `<-chan T` (or `<-chan U` for `Map`). Each owns its output. Each respects ctx. A team can compose pipelines from these primitives with the type system catching almost every misuse.

### Limits of generics

You cannot generalise over channel direction. You can have `Map[A, B]` that always takes `<-chan A`. You cannot have one function that handles *any* directional view of `T`. In practice, this is fine — almost no code needs that abstraction.

---

## When Direction Hurts: Anti-Patterns

Direction is not always the right call. A few cases where it backfires:

### Anti-pattern 1: Two-way request/reply on one channel

Some old code uses one channel for both request and reply:

```go
type Req struct {
    Reply chan Resp
}

func server(in chan Req) {
    for r := range in {
        r.Reply <- handle(r)
    }
}
```

Direction here is awkward. `in` could be `<-chan Req` (server reads); but each `r.Reply` is bidirectional because the server sends into it. Trying to make `r.Reply` directional changes the API: callers need to construct a bidirectional channel, then narrow it before storing in `Req.Reply`. Not always worth the complexity for short-lived RPC-style channels.

In modern code, you would use a separate goroutine per request or use a sync primitive. But for the legacy pattern, leave it bidirectional.

### Anti-pattern 2: Symmetric peer-to-peer channels

Two goroutines that take turns sending and receiving (a chess game, a state-machine handshake) genuinely use the channel both ways:

```go
func peer(self, other chan Move) {
    for {
        m := <-self
        other <- respond(m)
    }
}
```

There is no single producer or consumer. Direction does not help. Keep it `chan T`.

### Anti-pattern 3: Overzealous narrowing

A 20-line function that uses one channel to send and once to close, then exits, does not benefit from narrowing every local variable. Reserve direction for boundaries, not internals.

### Anti-pattern 4: Direction as a substitute for ownership documentation

Direction tells the compiler what is legal. It does not document the lifecycle: when does the producer close? Is the channel ever nil? Does it have a buffer? You still need clear comments and docs. Direction is necessary but not sufficient.

### Anti-pattern 5: Returning `chan T` "in case the caller wants flexibility"

Almost always wrong. If the caller wants flexibility, the API design has not figured out the role. Pick a role, narrow accordingly, and let the type system carry that decision.

---

## Interop With Non-Channel APIs

Real systems mix channels with other abstractions: callbacks, iterators, futures, contexts. Direction sets the boundary.

### Channel → callback adapter

Convert a `<-chan T` stream into a callback API:

```go
func Each[T any](ctx context.Context, in <-chan T, fn func(T)) {
    for v := range in {
        fn(v)
        if ctx.Err() != nil {
            return
        }
    }
}
```

`in` is receive-only; the function consumes. Callback `fn` is the sink. Direction at the boundary makes the role unambiguous.

### Callback → channel adapter

Convert a callback-style API into a channel:

```go
func Stream[T any](register func(func(T))) <-chan T {
    out := make(chan T, 64)
    register(func(v T) {
        out <- v
    })
    return out
}
```

Returns receive-only. The internal `chan T` is owned by the closure. Callers cannot write or close.

Caveat: the `register` callback API rarely tells you when it is "done." This adapter never closes `out`. Document that, or add a Stop method.

### Iterator → channel

`for v := range iter { out <- v }` inside a goroutine, returning `<-chan T`. The goroutine owns the close.

### Channel → future

A future is "single value, eventually." A `<-chan T` of capacity 1 is the natural Go representation:

```go
func Async[T any](f func() T) <-chan T {
    out := make(chan T, 1)
    go func() {
        out <- f()
        close(out)
    }()
    return out
}
```

`<-chan T` is the read-only "promise." The caller blocks on `<-future` or `select`s with a timeout.

---

## Refactoring Production Systems

You inherit a 100k-line Go service with channels everywhere, mostly `chan T`. Goals: improve safety, reduce leaks, make code reviewable. Plan:

1. **Audit.** Grep for `chan ` (with the trailing space) across the codebase. Categorise: pipeline channels, queue channels, control channels, broadcast channels.
2. **Narrow returns.** For each exported function that returns `chan T`, check call sites. If none write, narrow to `<-chan T`. If some write, fix them first (move the write into the function or into a method).
3. **Narrow parameters.** For each exported function that takes `chan T`, check the body. If it only reads, narrow to `<-chan T`. If only writes, narrow to `chan<- T`. If both, document why and consider splitting.
4. **Wrap fields.** For each struct field of type `chan T`, ensure access goes through methods that narrow.
5. **Generic stages.** Replace ad-hoc pipeline code with calls to a small set of generic stages: `Map`, `Filter`, `Batch`, etc.
6. **Run race detector.** `go test -race ./...` on the whole code base. Direction does not catch races; the race detector does.

Schedule this work in small PRs. Each narrowing is binary-compatible if the receiver of the value was already only using it in one direction.

### A specific refactor: leak-prone subscription

Before:

```go
type Hub struct {
    Subs []chan Event
}

func (h *Hub) Subscribe() chan Event {
    c := make(chan Event, 16)
    h.Subs = append(h.Subs, c)
    return c
}
```

Problems:

- Caller can `close(c)`, causing panics in `Hub` when it tries to send to a closed channel.
- Caller can send into `c`, polluting the stream.

After:

```go
type Hub struct {
    subs []chan Event
    mu   sync.Mutex
}

func (h *Hub) Subscribe() (<-chan Event, func()) {
    c := make(chan Event, 16)
    h.mu.Lock()
    h.subs = append(h.subs, c)
    h.mu.Unlock()
    unsub := func() {
        h.mu.Lock()
        defer h.mu.Unlock()
        for i, s := range h.subs {
            if s == c {
                h.subs = append(h.subs[:i], h.subs[i+1:]...)
                close(s)
                return
            }
        }
    }
    return c, unsub
}
```

Now:

- Return type is `<-chan Event`. Caller cannot send or close.
- Unsubscribe is an explicit closure provided by Hub; only it can close `c`.
- Hub controls all writes; safe.

Every existing caller would compile-fail if they tried to close or send, signalling places that need fixing.

---

## Plug-Ins, Untrusted Callbacks, and Direction

If your service supports user-provided plug-ins (compiled Go plug-ins, or scripted via interfaces), direction limits what they can do to internal state.

### A plug-in interface

```go
type Plugin interface {
    Process(in <-chan Event, out chan<- Event) error
}
```

The plug-in receives events read-only and produces events write-only. It cannot:

- Close `in` (we own that — and `<-chan` forbids it).
- Read from `out` (it has `chan<-`).
- Skip back to the host's bidirectional channel (no implicit widening; no `reflect` path).

If the host wants to grant *more* power (e.g., plug-in can publish into a system stream), it explicitly hands a `chan<- T` for that stream. The plug-in interface itself defines the *narrowest* useful API.

### Defence in depth

Direction does not stop a malicious plug-in from panicking, hanging, or allocating gigabytes. It only narrows the channel surface. You still need:

- `context.Context` with timeout for cancellation.
- `recover` boundaries around plug-in calls.
- Memory and CPU limits.

But within the channel API, direction is a strong defence: a plug-in physically cannot disrupt the host's internal pipelines via a channel it was given.

---

## Channels of Channels in Real Systems

Pipelines occasionally use channels-of-channels. Two real patterns:

### Pattern: Dynamic fan-out

A `chan <-chan T` lets a coordinator dynamically add new output streams:

```go
type Broker struct {
    addSub chan chan<- Event       // bi: send sub-channel in
}

func (b *Broker) Subscribe() <-chan Event {
    out := make(chan Event, 64)
    b.addSub <- out                // out widens to chan<- Event
    return out
}
```

The broker loop receives new subscribers on `addSub` and tracks them.

### Pattern: Request/response with reply channel

```go
type Request struct {
    Data  []byte
    Reply chan<- Response          // send-only from request side
}
```

The requester creates a bidirectional `chan Response` of capacity 1, narrows it to `chan<- Response` for the request, sends the request, then waits on the bidirectional reference it kept:

```go
func ask(srv chan<- Request, data []byte) Response {
    reply := make(chan Response, 1)
    srv <- Request{Data: data, Reply: reply}
    return <-reply
}
```

The server receives the request, computes, and sends the response into the request's `Reply` field. The server cannot read from `Reply` because it is `chan<- Response`. The requester reads from its bidirectional `reply` reference.

### Reading nested types

`chan<- chan<- Event` is "send-only channel of send-only channels of Event." That nesting shows up in pub/sub broker designs. Read right-to-left; in practice, name the types:

```go
type SubChan = chan<- Event
type AddChan = chan<- SubChan
```

Type aliases (Go 1.9+) make the intent obvious.

---

## Observability and Lifecycle

Channel direction informs observability:

- A producer's `chan<- T` exposes how much it has sent. Track with a counter on each send.
- A consumer's `<-chan T` exposes how much it has received and how often it blocks.
- The lifecycle (close vs not) is visible via `runtime.NumGoroutine` and pprof goroutine dumps.

Patterns:

```go
var producedTotal = expvar.NewInt("produced_total")

func produce(out chan<- Event) {
    defer close(out)
    for evt := range source() {
        out <- evt
        producedTotal.Add(1)
    }
}
```

The metric is owned by the producer because direction tells us this is where sends happen.

In pprof's goroutine dump, you see "chan send" and "chan receive" states; the channel's identity (pointer) helps you correlate which goroutines are blocked on which channels. Direction is not visible in the dump (the runtime only sees a `*hchan`), but the *code path* shows the directional view used.

---

## Design Reviews: a Senior's Lens

When reviewing a PR that uses channels, look for:

1. **Returns of `chan T`.** Almost always wrong. The narrowed `<-chan T` is the right return.
2. **Parameters of `chan T`.** Look at the body. If only reads, narrow. If only writes, narrow.
3. **Public fields of `chan T`.** Wrap in methods.
4. **Closes from inside a receive-only consumer.** Impossible if narrowed, but if the consumer holds a bidirectional reference, the close may be wrong-place.
5. **Goroutine leaks.** Pair every `go func` with a clear exit path. Directional types do not prevent leaks but make them easier to reason about.
6. **Buffer sizing.** Direction does not change capacity; check the rationale separately.
7. **Race-detector failures.** Direction does not catch races. Insist on `-race` in CI.

A typical comment in review:

> "This `func Stream() chan Message` returns a bidirectional channel. The only caller in the codebase reads from it; nothing writes. Can we narrow to `<-chan Message`? That prevents future bugs where someone adds a write or close from outside."

---

## Self-Assessment

- [ ] I can articulate the difference between a `chan T` API and a `<-chan T` API in terms of what changes when the producer evolves.
- [ ] I default to narrowed returns in every public function I write.
- [ ] I design plug-in and callback APIs with directional channels to limit blast radius.
- [ ] I know the four ownership models for long-lived services and which fits each scenario.
- [ ] I have refactored at least one production-scale codebase to narrow channel types, in small reviewable steps.
- [ ] I know when not to narrow: symmetric peers, RPC-style reply channels in legacy code.
- [ ] I use generic pipeline stages that respect directional types.
- [ ] I review other people's PRs through a "who can send, who can close" lens.
- [ ] I document the lifecycle (close timing) alongside the directional return type.
- [ ] I treat directional types as a design tool, not a microoptimisation.

---

## Summary

Senior-level mastery of channel direction is architectural. Direction is the visible part of a much larger contract: who owns the channel, who closes it, what its lifetime is, who can read or write. The narrowed type at a module boundary is binding documentation that the compiler enforces forever.

You design APIs around the narrowest direction that gets the job done. You spot anti-patterns (`chan T` returns "for flexibility," consumers given the power to close). You refactor legacy codebases in small steps, narrowing one return at a time. You combine direction with `context.Context` for cancellation, with generics for reusability, and with pprof for observability.

Direction is not a security feature, not a performance feature, and not a substitute for documentation. It is a precise, zero-cost compile-time check that catches a specific class of design errors at the perfect moment: build time. The professional file goes deeper — into how the compiler enforces direction, how `reflect` mirrors it, and how the runtime sees no difference at all.
