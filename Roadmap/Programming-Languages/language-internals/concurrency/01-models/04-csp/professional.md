# CSP — Professional Level

> **Topic:** [CSP](README.md)
> **Focus:** theory, occam history, modern descendants, API design

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

At the professional level, CSP stops being a syntax for goroutines and channels and starts being a **design philosophy**. You are no longer asking "how do I avoid a race condition?" — you are asking "what is the *shape* of the concurrent system, what are its invariants, and how do I prove they hold under adversarial scheduling?"

CSP, as Tony Hoare formalised it in 1978 and refined in his 1985 book, is an **algebra**. Processes are first-class terms; you can compose them with prefix (`a -> P`), choice (`P [] Q`), parallel (`P || Q`), and hiding (`P \ A`). You can ask, mechanically, whether one process *refines* another. That algebra is still used today, four decades later, by Network Rail, by defense contractors, and by chip designers verifying cache coherence protocols.

The Go language, which most developers meet first, is a **pragmatic dialect** of CSP — it borrowed the vocabulary (processes, channels, choice) but discarded the algebra (no refinement, no `||`, no FDR). It is to Hoare's CSP what C is to lambda calculus: a useful, leaky, beloved approximation.

This document sits between three audiences:

- the engineer who has shipped Go services for years and wants to know **why** the language looks the way it does;
- the architect who has to decide between CSP-style channels, the actor model, and structured concurrency for a new system;
- the team lead who has to set guidelines that prevent the channel-spaghetti graveyard that every successful Go codebase eventually becomes.

We will trace CSP from its theoretical roots, through the Transputer's industrial collapse, to its modern descendants — Go, Clojure's `core.async`, Crystal, Pony, Trio, Kotlin Flow — and extract the design rules that survived contact with production.

By the end you should be able to (a) read a CSP refinement specification, (b) recognise when your "channel everywhere" architecture has degenerated into a distributed mutex, (c) decide when TLA+ or FDR4 verification is justified, and (d) design library APIs that expose concurrency without forcing it on the caller.

---

## Prerequisites

Before reading this document you should be comfortable with:

- The **junior and middle** levels of CSP in this roadmap (unbuffered/buffered channels, `select`, fan-in/fan-out, pipeline patterns).
- Goroutine lifecycle and the `context.Context` propagation idiom.
- The actor model at least in outline (Erlang or Akka), enough to compare it with CSP.
- Basic operational semantics — the difference between a *trace* and a *state*, what a *deadlock* is formally.
- Memory models — happens-before, sequential consistency vs relaxed.
- One non-Go concurrency tool, ideally `async`/`await` in Python, Rust, or JavaScript.

If a phrase like "channel of channels" feels uncomfortable, revisit the middle-level material first.

---

## Glossary

- **Process algebra** — a mathematical framework where concurrent systems are expressed as terms in an algebra, equational reasoning included.
- **Trace** — the finite sequence of visible events a process can perform.
- **Failure** — a pair `(trace, refusal_set)` describing what the process can refuse to do after a given trace.
- **Refinement** — `P ⊑ Q` means `Q` does only things `P` is allowed to do; used to prove an implementation meets a specification.
- **FDR4** — Failures-Divergences Refinement checker, the standard CSP model checker, developed at Oxford.
- **Occam** — the original CSP-based language, used on the Inmos Transputer.
- **Transputer** — a 1980s CPU with hardware channels and built-in scheduler, designed to make CSP fast.
- **Structured concurrency** — the discipline that every spawned task must complete (or be cancelled) before its parent scope returns.
- **Nursery / TaskGroup** — concrete construct in Trio, Kotlin, Swift that enforces structured concurrency.
- **Back-pressure** — flow control: slow consumer slows fast producer through bounded channels or credit-based protocols.
- **Cap-secure** — a design where references *are* the only capability; if you do not hold a reference you cannot act.
- **Pony** — CSP-actor hybrid language with capability-secure type system and reference orcas (ref-count GC).
- **Refusal** — the set of events a process is unwilling to engage in at some point of its trace.
- **Divergence** — infinite internal action without external progress (livelock).
- **Stable failure** — a failure reachable without further internal action.
- **TLA+** — Lamport's specification language; not CSP but used for similar verification goals.
- **STM** — Software Transactional Memory; Clojure's main story, with `core.async` as the CSP escape hatch.

---

## Core Concepts

### Theory — Hoare's algebraic CSP, refinement orderings, FDR4 in industry

Hoare's CSP, in its mature form, defines a process by three observations:

1. its **traces** — every finite sequence of events it can perform;
2. its **failures** — every `(trace, X)` such that after that trace the process can refuse all events in `X`;
3. its **divergences** — every trace after which the process can spin forever doing internal work.

These three are the **failures-divergences model**. A process `Impl` *refines* a process `Spec`, written `Spec ⊑FD Impl`, iff every trace, failure, and divergence of `Impl` is permitted by `Spec`. This is the engineering contract: the specification says what the system *might* do; the implementation must not do anything else.

FDR4 (Formal Systems Europe / Oxford) is the industrial-strength tool that decides this question for finite-state CSP. It has been used in production for decades:

- **Network Rail (UK)** verifies parts of the European Rail Traffic Management System (ERTMS) signalling logic with CSP and FDR — checking that a "release route" event cannot occur while a train occupies a section.
- **Defense and avionics contractors** use CSP+FDR for protocols that must be free of deadlock under all schedules — the Bremen and ROOS work on safety-critical CAN bus protocols is canonical.
- **Cache coherence** in CPU designs has been checked with CSP-like models (Lamport's TLA+ has taken more of this work today, but the techniques are sibling).

What does this mean for an engineer? Almost no Go shop will ever run FDR4. But the **refinement mindset** is portable:

- write a tiny CSP-ish "spec" — even in comments — that describes the *allowed* event orderings;
- check informally (or in a property-based test) that the implementation does not exhibit a sequence the spec forbids.

That habit, even without tooling, prevents whole classes of "shouldn't be possible" production incidents.

### Industrial occam history — Inmos Transputer, why occam didn't survive

In the mid-1980s the British company Inmos built the **Transputer** — a chip designed top-down around CSP. Every Transputer had:

- four hardware **links** (channels) clocked at 10 or 20 Mbit/s, full duplex;
- a microcode **scheduler** that switched processes in ~1 microsecond;
- an instruction set that included `in`, `out`, `alt` (Hoare's `[]`) as primitive opcodes;
- the **occam** language as its native tongue.

occam looked like CSP. You wrote:

```
PAR
  produce(chan)
  consume(chan)
```

and the compiler put `produce` on one Transputer and `consume` on another — same source code, different topology. It was, briefly, the future. The European supercomputer Meiko CS-1 (1986) was a 400-Transputer machine. The robot vision lab at Edinburgh ran on Transputers. NASA experimented.

Why did it die?

1. **Memory wall.** Transputers had on-chip memory, but expanding it required cycles. By the time Intel's i486 launched in 1989 with cache and a much faster pipeline, the cost-per-MIPS gap was enormous.
2. **Compiler quality.** GCC for x86 got an army of contributors. occam compilers stayed niche.
3. **The C tax.** Even on a Transputer, you wanted to run C code. The CSP-shaped runtime did not help C, and the host-target development workflow was awkward.
4. **Inmos was acquired** (SGS-Thomson, 1989) and the Transputer line was de-prioritised.
5. **Asynchronous send was missing** for too long. Pure CSP rendezvous made hardware-level message passing simple but software-level patterns (e.g., producer that should not block) hard.

The lesson the survivors absorbed: a CSP language *cannot* dictate hardware. It has to ride commodity CPUs and offer *enough* CSP to be useful (Go) rather than insisting on the full algebra (occam).

### Modern descendants — Go, Clojure core.async, Crystal, Pony

#### Go (2009)

Go inherited:

- **channels** (typed, buffered or unbuffered),
- **`select`** = Hoare's external choice,
- **goroutines** as cheap processes,
- the **CSP intuition**: "share by communicating".

It discarded:

- the algebra,
- the parallel composition operator,
- hiding,
- formal refinement.

It added:

- **closures over shared memory** — channels are not the only way to communicate, and most production Go code mixes mutexes with channels;
- the **`context.Context`** convention — propagating cancellation orthogonal to channels;
- **race detector** — runtime tool to catch the inevitable shared-state mistakes.

#### Clojure core.async (2013)

`core.async` brought CSP to a Lisp on the JVM. Key differences:

- channels carry any value;
- `<!` and `>!` are macros that work only inside a `go` block, which is compiled to a state machine running on a thread pool (cooperative scheduling, like async/await);
- composes beautifully with Clojure's immutable data structures — what travels on the channel cannot be mutated mid-flight.

`core.async` is the right answer when your concurrency need lives inside a mostly-functional, value-oriented system.

#### Crystal (2014)

Crystal's **fibers** + **channels** look exactly like Go. The differences are flavour:

- compiled to native via LLVM,
- Ruby-like syntax,
- single scheduler thread by default historically (a deliberate trade for simplicity).

Crystal demonstrates that the CSP UX is reusable across language traditions.

#### Pony (2015)

Pony is the most theoretically interesting descendant. It is an **actor language**, not strictly CSP, but it took a critical idea from CSP-land: **capability-secure** message passing. You cannot send a mutable reference to another actor unless the type system proves no aliases remain. The runtime is a per-actor message queue with a custom garbage collector (ORCA — Ownership and Reference Counting in Actors).

Pony's value here is the demonstration that CSP-style isolation can be *enforced by the type system*, not just by convention. Go has none of that — it leaves it to you to not send a `*User` and then mutate it.

### Design patterns that scaled — Go's standard library design

Go's standard library is the largest, oldest, most-read CSP-influenced codebase in the world. It is therefore the best evidence of what *actually scales*.

Surprise: most of `net/http` and all of `database/sql` use **no channels at all in their public API**.

`net/http.Server.Serve`:

```go
for {
    rw, err := l.Accept()
    if err != nil { ... }
    c := srv.newConn(rw)
    go c.serve(connCtx)
}
```

A goroutine per connection. No channels between accept and handler. State is held inside the connection struct. Channels are used *inside* implementations (e.g., the HTTP/2 server has channels for frame dispatch) but the **API surface is blocking calls and contexts**, not channels.

`database/sql` follows the same rule. `db.QueryContext(ctx, ...)` blocks. Internally it manages a connection pool with channels and mutexes mixed; externally you see `Rows`, `Row`, `Result`. There is no `<-rowsChannel`.

The pattern: **internally use whatever (channels, mutexes, atomics) is correct; externally expose synchronous functions plus `context.Context`**.

Deviations from pure CSP that this represents:

1. **No PAR operator** — Go has only goroutine spawn (`go`), so structured parallel composition is convention not language.
2. **Closures over shared memory** — the standard library uses mutexes liberally (the `sync` package is heavily used inside `net/http`).
3. **`select` is not Hoare's `[]`** — Go's `select` evaluates all cases, picks one randomly when multiple are ready, and supports a `default` clause for non-blocking polls. Hoare's `[]` resolves deterministically through the environment.

These deviations are *deliberate* and have proven correct: the standard library has shipped trillions of requests.

### Designing channel-based APIs — should your library return a channel or a callback?

This is one of the most consequential professional decisions in a Go codebase. Here is a usable rule set:

1. **Return a channel** only when:
   - the operation is genuinely a *stream* of values with no natural end (subscriptions, events, ticker);
   - **and** the caller will plausibly want to use `select` with other streams;
   - **and** the lifetime of the channel is bounded by an explicit `context.Context` or `Close()` method.

2. **Return a slice or iterator** when:
   - the result set is finite;
   - the caller almost always consumes all of it;
   - back-pressure semantics are uninteresting.

3. **Take a callback** when:
   - the caller wants to react inline without spawning a goroutine to read a channel;
   - the operation is fire-and-forget per item (server middleware, log handlers).

4. **Use `context.Context` for cancellation**, never expose `chan struct{}` for "stop this".

5. **Document who closes the channel.** The unwritten Go rule is "the sender closes". If your library is the sender, you close. If the caller is the sender, the caller closes. Mixed ownership is a bug magnet.

A signature like this is a code smell:

```go
func (s *Service) Watch() chan Event  // who closes? buffered? what on error?
```

A better one:

```go
// Watch returns events until ctx is cancelled. The returned channel is
// closed by Watch when ctx is done; callers must not close it.
func (s *Service) Watch(ctx context.Context) (<-chan Event, error)
```

### Trio's "structured concurrency" — escape from goroutine sprawl, nursery model

Nathaniel Smith's 2018 essay *Notes on structured concurrency, or: Go statement considered harmful* is the most influential post-CSP critique of CSP-derived languages. The argument:

A bare `go f()` is the new `goto`. Once the goroutine is launched, the parent has *no syntactic relationship* to it. You cannot statically tell where it ends, who waits for it, what happens to its errors, how it is cancelled.

Trio (a Python async library) introduced the **nursery**:

```python
async with trio.open_nursery() as nursery:
    nursery.start_soon(worker1)
    nursery.start_soon(worker2)
    # both must finish before the `async with` exits
```

The block does not return until every task inside has finished or been cancelled. Errors propagate. Cancellation propagates. There is one entry, one exit — like `{ ... }` for concurrency.

The idea has spread:

- **Kotlin** `coroutineScope { launch { ... } }`,
- **Swift** `withTaskGroup`,
- **Java 21** `StructuredTaskScope`,
- **Go** has **`golang.org/x/sync/errgroup`** and now (Go 1.25+) deeper conventions, but no syntactic enforcement.

A professional Go codebase should use `errgroup.WithContext` almost everywhere a bare `go` is tempting:

```go
g, ctx := errgroup.WithContext(ctx)
g.Go(func() error { return worker1(ctx) })
g.Go(func() error { return worker2(ctx) })
if err := g.Wait(); err != nil { ... }
```

This is structured concurrency in Go, by convention.

### Comparison: actor model vs CSP — when each wins

| Axis | CSP (Go-style) | Actor (Erlang-style) |
|------|---------------|---------------------|
| Addressing | by channel value | by actor PID/name |
| Coupling | sender knows the channel | sender knows the address |
| Send | synchronous rendezvous (default) | asynchronous mailbox |
| Failure | crash propagation by panic + ctx | "let it crash" + supervisor trees |
| Identity | processes are anonymous | actors have stable identity |
| Patterns | pipelines, fan-in/fan-out | request/reply, supervision |
| Distribution | poor (channels do not cross machines) | excellent (Erlang/OTP, Akka) |
| Back-pressure | natural (unbuffered blocks producer) | requires explicit credit |

**CSP wins** when:
- you are inside a single process;
- the topology is fixed at design time (pipeline shape);
- back-pressure matters;
- you want compile-time typed channels.

**Actors win** when:
- the system spans machines;
- failures are common and recovery is per-entity;
- entities have identity (account `42`, device `xyz`);
- supervision hierarchies model the domain.

"You should not need both" is folklore in the Erlang and Go communities. In practice, a large system uses CSP-style channels *within* a service and actor-style addressed messaging *between* services (Kafka topics, NATS subjects). The debate is mostly about which one is your **default mental model**, not which one is "in the codebase".

### Anti-patterns at scale

After years of CSP-style code at scale, the following anti-patterns are documented:

1. **Channels everywhere.** Every internal call goes through a channel. Result: tracing is impossible, latency is unpredictable, GC pressure from boxing, and the channel itself becomes the synchronisation primitive that needs its own mutex around access.
2. **Hidden state machine via `select`.** A 300-line `select` with 12 cases, where each case mutates package-level state. This is a finite-state machine pretending to be CSP. Extract it into a real state machine.
3. **Channels as queues with no back-pressure thought.** Someone wrote `make(chan Job, 10000)` because "we should not block". When the consumer slows, the channel fills, then either the producer blocks (you got back-pressure by accident) or it allocates a separate unbounded slice (you got OOM). Decide explicitly.
4. **Panicking close.** Closing an already-closed channel panics. Closing while another goroutine sends panics. Many production crashes are closes done by the receiver.
5. **Leaking goroutines around channel reads.** `for x := range ch` where `ch` is never closed because the sender died without cancellation.
6. **Channels of mutable pointers.** You sent `*User` through the channel and the sender kept mutating it.
7. **`select` with `default` in a busy loop.** Burns a CPU spinning.
8. **Aliasing channel direction in API.** Returning `chan T` instead of `<-chan T` lets callers send into your output channel.

### Verifying critical concurrency — when TLA+ or FDR is worth it

Formal verification has cost. The cost is roughly:

- one engineer-week to learn TLA+ enough to write a useful spec;
- one engineer-week per non-trivial protocol to model it;
- ongoing maintenance as the protocol evolves.

The benefit, when justified, is enormous:

- Amazon used TLA+ on S3 and DynamoDB and found bugs that would only manifest in races between three concurrent failure modes.
- MongoDB used TLA+ on its replication protocol.
- AWS publishes its TLA+ specs (the "Verifying replicated data" papers).

When is it worth it?

- The protocol is **safety critical** (financial settlement, medical, signalling).
- The protocol has **distributed consensus** (Raft, Paxos, custom leader election).
- A bug here costs more than 100 engineer-weeks of debugging or remediation.
- The team can keep the spec **alive** — abandoned specs are worse than none.

When is it not worth it?

- The system is a CRUD HTTP service with one database.
- The concurrency is a thread pool + queue, well covered by existing libraries.
- The team will not maintain the spec.

For these, **property-based testing** + **race detector** + a small CSP sketch in comments are the right tool.

### The future — Go workspace generics + channels + iterators, Rust async streams, Kotlin Flow

CSP's vocabulary keeps showing up in new shapes:

- **Go iterators (1.23)** — `iter.Seq[T]` is a *pull*-based stream, not a channel. Many things that used to be `chan T` will become `iter.Seq[T]`. Channels remain for cross-goroutine work; iterators absorb intra-goroutine streaming.
- **Generics** let libraries write `chan T` once, properly, instead of `interface{}` channels with type assertions.
- **Rust `Stream` trait** — async iterator with back-pressure baked in; sometimes called the *typed*, *cancellation-aware* CSP channel.
- **Kotlin Flow** — cold streams that look like CSP from the outside but are implemented as continuations under the hood.
- **Effect systems** (Scala 3 ZIO, Effekt) — go beyond CSP by tracking effects in the type system.

The direction of travel is clear: **CSP's surface API (channels, select, cancellation)** is being absorbed into mainstream languages, while the **algebraic core** lives on only in safety-critical pockets via FDR4 and TLA+.

---

## Real-World Analogies

- **Air traffic control radio frequencies.** Each frequency is a channel; pilots and controllers are processes; you transmit only when the channel is clear (rendezvous). Hand-off between sectors is a channel-of-channels — the controller hands you a new frequency to switch to.
- **Restaurant kitchen pass.** Cook puts a plate on the pass (send); waiter takes it (receive); plate cannot exist in two places. Buffered pass is a heated shelf. Back-pressure: if the shelf is full, the cook stops plating.
- **Factory conveyor with stop button.** A worker can stop the line (cancellation propagates upstream); the supervisor can divert items (select on multiple lines).
- **Postal service.** Actor model. Each address has a mailbox; you do not need to know if anyone is home; messages queue.
- **Live concert stage cues.** Stage manager (parent scope) hands cards (tasks) to performers (children); the scene cannot end until every performer has finished their cue (structured concurrency).

---

## Mental Models

1. **CSP is the algebra; channels are the implementation.** You will ship channels. You will rarely write the algebra. The algebra exists so you have a vocabulary for invariants.
2. **The shape of the system is a directed graph of processes connected by channels.** Draw it. If you cannot draw it on one page, refactor.
3. **Every goroutine has an owner.** The owner is the function that spawned it and is responsible for its termination. If you cannot name the owner, you have leaked.
4. **Channels are types, not message brokers.** They are not Kafka. They are typed pipes inside one process.
5. **`select` is the only place where non-determinism enters your program intentionally.** Audit every `select` like you audit every `unsafe`.
6. **Cancellation is a first-class concern, equal to data flow.** `context.Context` is half the API even when it is not in the diagram.

---

## Code Examples

### 1) Low-latency market-data pipeline

A pipeline that ingests UDP price ticks, normalises them, computes a moving average, and emits to subscribers. The professional concerns are: bounded queues with explicit drop policy, no allocation in the hot path, instrumented back-pressure.

```go
package marketdata

import (
	"context"
	"sync/atomic"
	"time"
)

type Tick struct {
	Symbol [8]byte // fixed-size to avoid allocation
	Price  float64
	TS     int64 // nanoseconds since epoch
}

type Normalised struct {
	Tick
	MidPrice float64
}

// Stage represents one stage of the pipeline with explicit metrics.
type Stage struct {
	dropped uint64
	processed uint64
}

func (s *Stage) Dropped() uint64   { return atomic.LoadUint64(&s.dropped) }
func (s *Stage) Processed() uint64 { return atomic.LoadUint64(&s.processed) }

// normaliseStage receives raw ticks and emits normalised ticks.
// Bounded channel + drop-newest policy: in market data, an old tick is
// worthless; we prefer to drop the new one and keep the stream flowing.
func (s *Stage) normaliseStage(ctx context.Context, in <-chan Tick, out chan<- Normalised) {
	for {
		select {
		case <-ctx.Done():
			return
		case t, ok := <-in:
			if !ok {
				return
			}
			n := Normalised{Tick: t, MidPrice: t.Price} // placeholder
			select {
			case out <- n:
				atomic.AddUint64(&s.processed, 1)
			default:
				atomic.AddUint64(&s.dropped, 1)
			}
		}
	}
}

// fanOut delivers each normalised tick to all subscribers.
// Slow subscribers do not block fast ones: per-subscriber bounded channel
// with drop policy.
type Subscriber struct {
	ch     chan Normalised
	missed uint64
}

func (sub *Subscriber) Recv() <-chan Normalised { return sub.ch }
func (sub *Subscriber) Missed() uint64          { return atomic.LoadUint64(&sub.missed) }

type Broker struct {
	subs []*Subscriber
}

func NewBroker() *Broker { return &Broker{} }

func (b *Broker) Subscribe(buf int) *Subscriber {
	s := &Subscriber{ch: make(chan Normalised, buf)}
	b.subs = append(b.subs, s)
	return s
}

func (b *Broker) Run(ctx context.Context, in <-chan Normalised) {
	for {
		select {
		case <-ctx.Done():
			for _, s := range b.subs {
				close(s.ch)
			}
			return
		case n, ok := <-in:
			if !ok {
				return
			}
			for _, s := range b.subs {
				select {
				case s.ch <- n:
				default:
					atomic.AddUint64(&s.missed, 1)
				}
			}
		}
	}
}

// movingAverage is a per-symbol running mean over the last N ticks.
// Pure function from the perspective of CSP: stateful inside the stage,
// no shared state outside.
func movingAverage(ctx context.Context, in <-chan Normalised, out chan<- Normalised, window int) {
	state := make(map[[8]byte]*ring)
	defer close(out)
	for {
		select {
		case <-ctx.Done():
			return
		case n, ok := <-in:
			if !ok {
				return
			}
			r, ok := state[n.Symbol]
			if !ok {
				r = newRing(window)
				state[n.Symbol] = r
			}
			r.push(n.MidPrice)
			n.MidPrice = r.mean()
			select {
			case out <- n:
			case <-ctx.Done():
				return
			}
		}
	}
}

type ring struct {
	buf  []float64
	i, n int
	sum  float64
}

func newRing(size int) *ring { return &ring{buf: make([]float64, size)} }
func (r *ring) push(v float64) {
	if r.n == len(r.buf) {
		r.sum -= r.buf[r.i]
	} else {
		r.n++
	}
	r.buf[r.i] = v
	r.sum += v
	r.i = (r.i + 1) % len(r.buf)
}
func (r *ring) mean() float64 { return r.sum / float64(r.n) }

// Demo wiring.
func ExampleRun(ctx context.Context, raw <-chan Tick) (*Broker, *Stage) {
	stage := &Stage{}
	normalised := make(chan Normalised, 1024)
	averaged := make(chan Normalised, 1024)
	go stage.normaliseStage(ctx, raw, normalised)
	go movingAverage(ctx, normalised, averaged, 32)
	broker := NewBroker()
	go broker.Run(ctx, averaged)
	_ = time.Second
	return broker, stage
}
```

Notes for review:

- Fixed-size `[8]byte` symbol avoids heap allocation per tick.
- Drop policy is explicit and per-stage.
- Every `select` includes `<-ctx.Done()`.
- `Broker.Run` closes subscriber channels on shutdown so consumers `range` exits cleanly.
- The fan-out non-blocking send to subscribers prevents one slow subscriber from causing back-pressure into the producer — this is the right trade-off for market data; for billing data the opposite is right.

### 2) IoT ingestion — many slow producers, one merged stream, back-pressure to MQTT

The professional concern here is **flow control end to end**. Devices push MQTT; the gateway parses, validates, batches, writes to a time-series DB. If the DB stalls, devices must slow down or messages must be dropped — but *which* must be a policy decision, not an accident.

```go
package iot

import (
	"context"
	"errors"
	"time"

	"golang.org/x/sync/errgroup"
)

type Reading struct {
	DeviceID string
	Metric   string
	Value    float64
	At       time.Time
}

type Sink interface {
	WriteBatch(ctx context.Context, batch []Reading) error
}

// Ingest runs the pipeline. It uses errgroup for structured concurrency:
// if any stage errors, the context is cancelled and all goroutines are
// torn down. Ingest does not return until all are done.
func Ingest(ctx context.Context, src <-chan Reading, sink Sink, batchSize int, flush time.Duration) error {
	g, ctx := errgroup.WithContext(ctx)

	validated := make(chan Reading, batchSize)
	batches := make(chan []Reading, 4)

	g.Go(func() error {
		defer close(validated)
		for {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case r, ok := <-src:
				if !ok {
					return nil
				}
				if !valid(r) {
					continue
				}
				select {
				case validated <- r:
				case <-ctx.Done():
					return ctx.Err()
				}
			}
		}
	})

	g.Go(func() error {
		defer close(batches)
		buf := make([]Reading, 0, batchSize)
		t := time.NewTimer(flush)
		defer t.Stop()
		emit := func() error {
			if len(buf) == 0 {
				return nil
			}
			send := make([]Reading, len(buf))
			copy(send, buf)
			buf = buf[:0]
			select {
			case batches <- send:
				return nil
			case <-ctx.Done():
				return ctx.Err()
			}
		}
		for {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case r, ok := <-validated:
				if !ok {
					return emit()
				}
				buf = append(buf, r)
				if len(buf) >= batchSize {
					if err := emit(); err != nil {
						return err
					}
					if !t.Stop() {
						<-t.C
					}
					t.Reset(flush)
				}
			case <-t.C:
				if err := emit(); err != nil {
					return err
				}
				t.Reset(flush)
			}
		}
	})

	g.Go(func() error {
		for {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case b, ok := <-batches:
				if !ok {
					return nil
				}
				if err := sink.WriteBatch(ctx, b); err != nil {
					return err
				}
			}
		}
	})

	return g.Wait()
}

func valid(r Reading) bool {
	return r.DeviceID != "" && r.Metric != "" && !r.At.IsZero()
}

// errFlush is intentionally unused but documents the design.
var errFlush = errors.New("flush failed")
```

The key professional moves:

- **`errgroup.WithContext`** — one parent context, all stages cancel together on error.
- **bounded channels** — the batcher channel has capacity 4, so the sink can stall at most 4 batches before the batcher blocks.
- **back-pressure propagates** — batcher blocked => `validated` fills up => validator blocks => `src` is not drained => MQTT client must apply its own back-pressure (e.g., QoS 1 will pause acks).
- **timer + size flush** — the canonical batching primitive, carefully drained on `t.Stop`.

### 3) Refactor — from goroutine soup to structured concurrency

Before (typical mid-level Go that has grown):

```go
func handle(ctx context.Context, req Req) (Resp, error) {
	var resp Resp
	var err error

	done := make(chan struct{})

	go func() {
		resp.User, err = fetchUser(ctx, req.UserID)
		done <- struct{}{}
	}()
	go func() {
		resp.Cart, _ = fetchCart(ctx, req.UserID)
		done <- struct{}{}
	}()
	go func() {
		resp.Recs, _ = fetchRecs(ctx, req.UserID)
		done <- struct{}{}
	}()

	for i := 0; i < 3; i++ {
		<-done
	}
	return resp, err
}
```

Problems:

- shared `resp` and `err` written from three goroutines (data race);
- one `err` overwritten by whoever loses;
- if `ctx` is cancelled mid-flight, the goroutines still run and write to `resp`;
- channel `done` never closed, so goroutines that block on send after a return leak.

After (structured):

```go
func handle(ctx context.Context, req Req) (Resp, error) {
	g, ctx := errgroup.WithContext(ctx)

	var user User
	var cart Cart
	var recs []Rec

	g.Go(func() error {
		u, err := fetchUser(ctx, req.UserID)
		if err != nil {
			return err
		}
		user = u
		return nil
	})
	g.Go(func() error {
		c, err := fetchCart(ctx, req.UserID)
		if err != nil {
			return err // or return nil if cart is optional
		}
		cart = c
		return nil
	})
	g.Go(func() error {
		r, err := fetchRecs(ctx, req.UserID)
		if err != nil {
			return nil // recommendations are optional
		}
		recs = r
		return nil
	})

	if err := g.Wait(); err != nil {
		return Resp{}, err
	}
	return Resp{User: user, Cart: cart, Recs: recs}, nil
}
```

Why this is better:

- single point of error capture;
- each task writes to its own variable, no race;
- `g.Wait()` is the structured join — function does not return until all tasks have stopped;
- cancellation propagates: if `fetchUser` errors, ctx is cancelled and the other two stop;
- optional dependencies are made explicit by returning `nil` from those goroutines.

---

## Pros & Cons

**Pros at scale:**

- Channels make data flow visible — a `chan T` in a struct is a documented coupling.
- `select` is a single primitive that subsumes timeouts, cancellation, choice.
- Goroutines + channels compose with `errgroup` into structured concurrency.
- Back-pressure is the *default* with unbuffered channels.
- The race detector catches misuse of shared state.

**Cons at scale:**

- No syntactic structured concurrency — every team must adopt `errgroup` discipline.
- Channels do not cross processes — distribution needs other tools (gRPC, NATS, Kafka).
- The standard library mixes channels and mutexes in ways that newcomers find inconsistent.
- `select`'s non-determinism makes some race conditions hard to test.
- Closing channels is a footgun — the language gives you no help.
- Channels of channels work but are hard to read and harder to debug.
- No typed back-pressure protocol — buffered channels conflate "asynchrony" with "capacity".

---

## Use Cases

- Streaming data pipelines inside one process (log processing, ETL, market data).
- Server connection accept-and-dispatch loops.
- Bounded worker pools with task queues.
- Pub/sub within a single process (the `Broker` pattern above).
- Coordinating phased shutdown of subsystems.
- Implementing higher-level primitives — semaphores, rate limiters, debouncers — when `sync` is too low level.
- Glue between event sources (signals, timers, network) where `select` is the cleanest expression.

---

## Coding Patterns

- **Pipeline with explicit stages, each with ctx + close-on-exit**.
- **Fan-in via a single goroutine doing `select`** over a small fixed set of channels; for dynamic sets use reflection (`reflect.Select`) sparingly or merge per-source goroutines.
- **Fan-out with `Broker`** — explicit per-subscriber bounded channel and drop counter.
- **Worker pool**: one input channel, N worker goroutines, errgroup join.
- **Or-done channel** — wrap a channel and a done channel so the consumer only sees one channel; useful for libraries.
- **Bridge** — a channel of channels for dynamic stream reconfiguration.
- **Tee** — duplicate one stream into two with independent back-pressure.

Each pattern is documented in *Concurrency in Go* (Cox-Buday); review that book yearly.

---

## Clean Code

- A goroutine should be **named** by the function it runs, and that function should be **at most one screen** of code.
- Channels in struct fields should be documented: direction, buffer size, who closes, what cancellation means.
- Avoid `interface{}` channels — use generics or a typed wrapper.
- Avoid channels that carry both data and a "done" signal via close; use two channels or a `context.Context`.
- Do not nest `go` inside `go` inside `go` without an `errgroup` at each level.
- One `select` per function, ideally; if you need two, you may be hiding a state machine.

---

## Best Practices

1. **Always pass `context.Context`** as the first parameter to any function that may block, send, or receive.
2. **Use `errgroup.WithContext`** instead of bare `go` whenever results or errors matter.
3. **Document channel ownership** at the type level — `chan T` for owned, `<-chan T` and `chan<- T` at API boundaries.
4. **Bounded channels by default**; pick the bound by capacity planning, not by hope.
5. **Define drop policy** explicitly — drop-oldest, drop-newest, block, or apply-back-pressure.
6. **Test with `-race`** in CI on every build.
7. **Track goroutine count** in production metrics; investigate spikes.
8. **Profile with pprof** — channel contention shows up as `chanrecv`/`chansend` in goroutine profiles.
9. **Prefer functions over channels for results** — return slices when finite, channels only when streaming.
10. **Use TLA+ or FDR4** when failure costs more than the verification cost; not before.

---

## Edge Cases & Pitfalls

- **Closing a channel from the receiver side.** The sender will panic on next send. Standard rule: only the sender closes.
- **Multiple senders, single receiver.** If you need to close, do it from a coordinator goroutine that knows all senders have finished, typically via a `sync.WaitGroup`.
- **`select` with a `nil` channel.** `nil` channels block forever; useful to disable a case dynamically.
- **`time.After` in a loop.** Each call allocates a timer that lives until it fires; in a hot loop this leaks until GC catches up. Use a `*time.Timer` with `Reset`.
- **Send on closed channel.** Panic, no recovery.
- **Range over a channel that is never closed.** Goroutine leak.
- **`for-select` without default but with all cases blocked.** Deadlock if no goroutine wakes any of them; the runtime will detect *full* program deadlock but not partial leaks.
- **`select` with default in a tight loop.** CPU spin.
- **Channel of pointers shared after send.** Send transfers logical ownership; do not mutate after sending.
- **Closing twice.** Panic. Use `sync.Once` if uncertain.

---

## Common Mistakes

- Treating a buffered channel as a queue without thinking about back-pressure when full.
- Spawning goroutines without a corresponding wait or error path.
- Using channels for synchronisation of single events; `sync.WaitGroup` or `chan struct{}` closed once is clearer.
- Forgetting that `select` cases are evaluated all at once — putting a function call in a case sends every iteration.
- Catching `ctx.Done()` only at the top of a `select` and not inside a long send; if the send blocks, ctx cancellation is ignored until the receiver appears.
- Building a generic event bus when you have three event types — make three typed channels instead.

---

## Tricky Points

- Hoare's `||` operator synchronises on shared events. Go's "parallel" is goroutine spawn — they are not the same. The Go equivalent of Hoare's `||` is "two goroutines sharing a channel".
- A buffered channel with capacity `N` is **not** equivalent to a queue of size `N`. The send happens-before the receive, even when buffered; this is part of Go's memory model.
- `select` with multiple ready cases picks **uniformly at random**, not in source order. Do not rely on order.
- Cancelling a context does **not** unblock a goroutine that is blocked on a channel send unless the send is inside a `select` with `<-ctx.Done()`.
- Closing a channel is a happens-before edge: every goroutine that receives the close observes everything the closer did before close.
- `reflect.Select` lets you do dynamic `select` with N channels but is slow; prefer a fixed shape.

---

## Test Yourself

1. Specify in CSP-style pseudo-notation the *traces* of a bounded buffer of size 2.
2. Why did occam not survive even though the Transputer was technically interesting? Give three reasons.
3. Implement an `errgroup`-based bounded worker pool with cancellation.
4. Design an API: a metrics library that exposes a stream of measurements. Channel, callback, or iterator? Justify.
5. Translate the following Go `select` into Hoare's CSP external choice: `select { case x := <-a: f(x); case y := <-b: g(y); case <-ctx.Done(): return }`.
6. Implement structured concurrency for a tree of tasks where any leaf failure cancels the whole tree.
7. When would you reach for TLA+ over property-based testing? Concrete example.
8. Explain the Pony cap-secure approach in one paragraph.
9. Draw the topology of the IoT ingestion example. Mark back-pressure direction.
10. List five anti-patterns from this document and a one-line fix for each.

---

## Tricky Questions

1. A team proposes "channels for everything, no mutexes". You are the tech lead. What is your reply?
2. A junior asks: "Why does Go not have parallel composition like `PAR`?" Answer them.
3. Why is `Broker` in the market-data example using non-blocking sends to subscribers, but the IoT pipeline uses blocking sends to batcher?
4. Your CSP-style pipeline has 10 stages. Latency p99 doubles. What do you measure first?
5. A Kafka consumer group is often called "actor-like". Is it CSP? Defend.
6. You have a `chan T` in a public API and want to change to `iter.Seq[T]`. What breaks? What is the migration plan?
7. Why does `context.Context` exist if channels are already a coordination primitive?
8. Implement a *fair* fan-in over an arbitrary number of input channels. What is the cost?
9. Defend or attack: "structured concurrency is to `go` what `for` is to `goto`."
10. The Erlang community says supervisor trees are the answer. The Go community says `errgroup` is. Are these the same idea?

---

## Cheat Sheet

```
DESIGN RULES
------------
- channel direction at API boundary: <-chan T or chan<- T
- sender closes; if multiple senders, coordinator closes after WaitGroup
- every for-select has a <-ctx.Done() case
- bounded channels; drop policy is documented
- errgroup.WithContext over bare 'go' for results/errors

PATTERNS
--------
- pipeline: stages with ctx + close-on-exit
- fan-in: single select OR merge goroutines
- fan-out: Broker with per-sub channel + drop counter
- worker pool: input chan + N workers + errgroup
- or-done: wrap (ch, done) into one
- tee: independent back-pressure on two outputs

ANTI-PATTERNS
-------------
- channels-everywhere
- 300-line select hiding a state machine
- buffered channel without back-pressure plan
- close from receiver
- select+default tight loop
- chan of mutable pointers shared post-send

VERIFICATION TIERS
------------------
- race detector + tests           : every project
- property-based tests            : non-trivial protocols
- TLA+ / FDR4                     : safety-critical or consensus
```

---

## Summary

CSP, professionally, is two things at once: a 40-year-old algebraic theory still used in safety-critical engineering, and a vocabulary that every modern language now borrows. The pragmatic dialect — Go's channels and `select`, Clojure's `core.async`, Crystal's fibers, Kotlin's Flow — is what you will ship. The algebraic core — Hoare's failures-divergences model, FDR4, refinement — is what you reach for when an outage costs more than the verification effort.

The hardest skill at this level is **knowing which CSP to use**. For the 95% case: bounded channels, `errgroup`, contexts, structured concurrency by convention. For the 4% case: property-based tests of invariants. For the 1% case: TLA+ or FDR4.

The single most valuable habit is to **draw the topology**. If you can fit it on a page, you understand the system. If you cannot, no amount of channel cleverness will save you when it breaks at 3 a.m.

---

## What You Can Build

- A production-grade streaming ETL service with explicit back-pressure and drop policies.
- A library that exposes events as well-designed `<-chan T` or `iter.Seq[T]` with documented ownership.
- A market-data fan-out broker handling tens of thousands of ticks per second.
- An IoT ingestion gateway with end-to-end flow control to a time-series DB.
- A reusable structured-concurrency wrapper for your team's standard service shape.
- A TLA+ specification of your team's leader election or replication protocol.
- A code review checklist that catches the eight anti-patterns above before merge.
- A refactoring playbook that converts goroutine-soup handlers into structured concurrency.

---

## Further Reading

- C. A. R. Hoare, *Communicating Sequential Processes* (Prentice Hall, 1985) — the book. Hoare publishes a free PDF; read at least chapters 1, 2, and 7.
- A. W. Roscoe, *Understanding Concurrent Systems* (Springer, 2010) — the modern textbook of CSP with FDR examples.
- FDR4 Manual — Oxford / Formal Systems Europe, current edition. https://cocotec.io/fdr/
- Nathaniel J. Smith, *Notes on structured concurrency, or: Go statement considered harmful* (2018) — the structured concurrency manifesto. https://vorpus.org/blog/notes-on-structured-concurrency-or-go-statement-considered-harmful/
- Sylvan Clebsch et al., *Deny Capabilities for Safe, Fast Actors* (2015) — the Pony paper.
- Rich Hickey, *Clojure core.async Channels* — original announcement and talks (2013).
- Cox-Buday, *Concurrency in Go* (O'Reilly, 2017) — production patterns reference.
- Leslie Lamport, *Specifying Systems* — TLA+ textbook; chapters on safety and liveness.
- Russ Cox, *Bell Labs and CSP Threads* (2005) — historical bridge from Newsqueak/Limbo to Go.
- Inmos, *occam Programming Manual* (1984) — historical artefact, free online.

---

## Related Topics

- [CSP — Senior Level](./senior.md)
- [Actor model](../05-actor/README.md) (if present)
- [Structured concurrency](../../02-structured-concurrency/README.md) (if present)
- [Go runtime scheduler](../../../languages/golang/15-go-source-reading/03-runtime-source/README.md)
- [`context.Context` deep dive](../../../languages/golang/15-go-source-reading/04-context-source/README.md)
- [Backpressure patterns](../../../../system-design/patterns/backpressure/README.md) (if present)
- [Distributed locking](../../../../system-design/patterns/distributed-locking/README.md) (if present)

---

## Diagrams & Visual Aids

### Market-data pipeline topology

```
   UDP Ticks
       |
       v
 +-----------+    bounded(1024)    +---------------+    bounded(1024)
 | normalise | -------------------> | movingAverage | --------------------+
 +-----------+   drop-newest        +---------------+   block (in-stage)  |
                                                                          v
                                                                +-----------------+
                                                                |     Broker      |
                                                                +-----------------+
                                                                  |   |   |   |
                                                                  v   v   v   v
                                                                 sub sub sub sub
                                                                (each bounded,
                                                                 drop-newest)
```

Back-pressure direction: blocked subscriber does NOT slow the broker (non-blocking send to subs). Blocked moving-average DOES slow normalise (in-stage select waits).

### IoT pipeline topology

```
  MQTT brokers --> src chan --> validator --> validated chan -->
                                                                 batcher --> batches chan --> sink
                                                                                                |
                                                                                                v
                                                                                            TimescaleDB
```

Back-pressure direction: sink slow -> batches chan full -> batcher blocks -> validated chan full -> validator blocks -> src chan full -> MQTT acks pause -> devices slow.

### Refinement hierarchy

```
      SPEC  (CSP process: allowed traces, failures, divergences)
        |
        | refinement: SPEC  is refined by  IMPL
        v
      IMPL  (CSP process: a more restricted set of behaviours)

   FDR4 checks: traces(IMPL) subset traces(SPEC) and similar for failures, divergences.
```

### Anti-pattern: hidden state machine in select

```
  +------------------------------------+
  |  for {                             |
  |    select {                        |
  |      case <-a: state = S1; ...     |
  |      case <-b: state = S2; ...     |
  |      case <-c: if state==S1 ...    |
  |      ... 9 more cases ...          |
  |    }                               |
  |  }                                 |
  +------------------------------------+
                |
                v
       Extract into explicit FSM:
       states + events + transitions in a table.
```

### Structured concurrency tree

```
       request handler  (parent scope)
              |
   +----------+----------+
   |          |          |
 fetchUser fetchCart  fetchRecs
   |          |          |
   +----------+----------+
              |
        g.Wait() joins
```

If any child returns error, ctx is cancelled, siblings stop, parent returns the first error. No child outlives the parent.
