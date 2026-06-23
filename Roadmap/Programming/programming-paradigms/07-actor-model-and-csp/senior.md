# Actor Model & CSP — Senior Level

> **Roadmap:** [Programming Paradigms](../README.md) → Actor Model & CSP
> *Message passing doesn't eliminate concurrency bugs — it trades one set for another. You lose data races and lock-ordering deadlocks; you gain mailbox overflow, message-flow deadlock, and the loss of any global consistent view. The senior skill is knowing which trade you're making and when it's worth it.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [What You Gain, What You Trade](#what-you-gain-what-you-trade)
3. [The New Deadlock: Waiting on Messages](#the-new-deadlock-waiting-on-messages)
4. [Mailbox Overflow & Backpressure](#mailbox-overflow--backpressure)
5. [Delivery Semantics: Loss, Duplication, Ordering](#delivery-semantics-loss-duplication-ordering)
6. [No Global Consistency](#no-global-consistency)
7. [Supervision & "Let It Crash"](#supervision--let-it-crash)
8. [The Poison Message](#the-poison-message)
9. [Debugging Asynchronous Message Flows](#debugging-asynchronous-message-flows)
10. [Choosing: Actor vs CSP vs Shared Memory](#choosing-actor-vs-csp-vs-shared-memory)
11. [Common Mistakes](#common-mistakes)
12. [Summary](#summary)
13. [Further Reading](#further-reading)
14. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What are the trade-offs, and when is it the right call?**

Junior and middle sold you the upside: no shared memory means no data races, no locks to forget, correctness from structure. That's all true, and it's a big deal. But a senior engineer's job is to know the *bill* that comes with it — because message passing doesn't make concurrency easy, it makes it **differently hard**.

Here's the honest trade. You delete:

- **data races** (nothing is shared, so nothing can be raced on),
- **lock-ordering deadlocks** (no locks),
- the entire discipline of "remember to guard every access."

And in exchange you take on:

- **message-flow deadlock** (two units each blocked waiting for the other's message),
- **mailbox overflow** (a fast sender drowning a slow receiver in an unbounded queue),
- **delivery uncertainty** (was the message processed? lost? processed twice?),
- **no global snapshot** (you can never see the whole system's consistent state at one instant),
- **harder debugging** (a request's story is scattered across many asynchronous hops with no single stack trace).

This page is about managing that bill — and about the actor world's signature answer to failure, **supervision and "let it crash."** The goal isn't to sell message passing or warn you off it; it's to make you able to say, for a given system, *"message passing pays for itself here"* — or *"this is a plain shared variable; a mutex is simpler."*

---

## What You Gain, What You Trade

A senior should be able to recite this table cold, because every design discussion comes back to it:

| Concern | Shared memory + locks | Message passing (actors/CSP) |
|---|---|---|
| Data races | Possible; prevented by discipline | **Impossible by construction** |
| Forgotten guard | Silent corruption | N/A — nothing shared to guard |
| Deadlock | Lock ordering | **Message-flow** (A waits for B, B waits for A) |
| Overload behavior | Lock contention, latency spikes | **Mailbox/queue growth** → memory blowup or backpressure |
| Reading state | Direct, cheap | Round trip (request → reply) |
| Global consistent view | Possible (stop the world, snapshot) | **Not possible** — only per-unit views |
| Failure isolation | A crash can corrupt shared state | A unit can crash **alone**; others unaffected |
| Scaling across machines | Hard (shared memory doesn't cross the network) | **Natural** — messages already cross processes |
| Debugging | One stack trace per thread | Flow scattered across async hops |

The pattern: message passing is **excellent at isolation and distribution** and **mediocre at "I just need to read this value quickly" and "show me the whole system's state."** It moves the hard part from *protecting shared state* to *reasoning about message flow under failure and overload*.

---

## The New Deadlock: Waiting on Messages

You don't get deadlock-freedom for free; you get a *different* deadlock. The classic shape:

```go
// Two goroutines, two unbuffered channels, crossed waits → deadlock.
func main() {
    a := make(chan int)  // unbuffered: send blocks until receive
    b := make(chan int)

    go func() {
        a <- 1           // blocks: waiting for someone to receive from a
        <-b              // never reached
    }()

    b <- 2               // blocks: waiting for someone to receive from b
    <-a                  // never reached
    // Both goroutines block forever. Go's runtime can sometimes detect
    // "all goroutines asleep" and panic; in real systems it just hangs.
}
```

The actor analogue: actor **A** does a *synchronous ask* to **B** and waits for the reply, while **B** is busy doing a synchronous ask to **A**. Each is blocked in its own message handler, so neither can process the other's request. The mailbox model hides this better (sends are async), but synchronous request/reply re-introduces it the moment you `await` a reply inside a handler.

Senior-level mitigations:

- **Avoid synchronous request/reply inside a handler when you can.** If an actor blocks waiting for a reply, it can't process its own mailbox — including the very message the other side needs. Prefer fire-and-forget plus a later "result" message that re-enters the mailbox normally.
- **Impose a directionality / hierarchy on message flow.** Cycles of synchronous waits are the deadlock fuel. A DAG of who-calls-whom (requests flow "downward", results flow "upward") has no cycle to deadlock on — the same idea as a lock-ordering discipline, applied to messages.
- **Bound every wait with a timeout.** A timeout turns a deadlock into a recoverable error. It doesn't *prevent* the bad design, but it stops one stuck pair from wedging the whole system.
- **Use `select` with a cancellation channel** (Go) or a timeout in `receive ... after` (Erlang) so a blocked unit can always make progress or bail.

---

## Mailbox Overflow & Backpressure

This is the failure mode that bites *exactly when you can't afford it* — under load. The two models have opposite default postures:

- **Actors: unbounded mailbox.** A producer faster than the consumer doesn't block — its messages pile up in the consumer's mailbox, which grows until the process (or the whole node) runs out of memory. The system stays "up" right up until it falls over, often with no warning. **There is no built-in backpressure.**
- **CSP: bounded channel.** An unbuffered or capacity-N channel **blocks the sender** when full. That *is* backpressure: a fast producer is automatically throttled to the consumer's rate. The cost is that the producer can block — which, mishandled, becomes the deadlock above.

So the senior question for any message-passing design is: **what happens when the receiver can't keep up?** You must pick a policy explicitly:

| Policy | What it does | When |
|---|---|---|
| **Block the sender** | CSP default; producer waits | Throughput where slowing the source is acceptable |
| **Bounded mailbox + reject** | Drop/NACK when full (Akka bounded mailbox, full-buffer error) | When shedding load beats falling over |
| **Drop oldest / newest** | Lose some messages on purpose | Telemetry, metrics — freshness over completeness |
| **Spill / scale out** | Add consumers, partition the work | When the load is real and must be served |

The anti-pattern is the *implicit* policy: an unbounded actor mailbox is a "policy" of *grow until OOM*, chosen by accident. Backpressure must be a deliberate part of the design, not an emergent property. (Reactive Streams and Go's bounded channels exist precisely to make backpressure a first-class concern — see [Reactive Programming](../05-reactive-programming/) and [Dataflow & Stream](../06-dataflow-and-stream-programming/).)

---

## Delivery Semantics: Loss, Duplication, Ordering

In-process, messages are reliable and point-to-point ordered. The moment messages cross a process or network boundary (distributed actors, message brokers), you confront **delivery guarantees**, and they're a spectrum, not a yes/no:

- **At-most-once** — the message is delivered zero or one times; never duplicated, but may be **lost**. (Erlang's default node-to-node send: fire-and-forget; if the link drops, the message is gone.) Cheap, no bookkeeping.
- **At-least-once** — the message is delivered one *or more* times; never lost, but may be **duplicated** (because the sender retries when unsure). Requires acks and retries.
- **Exactly-once** — delivered precisely once. Not achievable as a pure transport guarantee in a distributed system; it's *approximated* as **at-least-once delivery + idempotent processing** (the receiver deduplicates or designs operations so a repeat is a no-op).

Senior implications:

- **"Exactly-once delivery" is mostly a myth; "exactly-once *effect*" is the real goal.** You get it by making handlers **idempotent** (processing the same message twice yields the same result) and/or **deduplicating** by message id — not by trusting the transport.
- **Pick the weakest guarantee that's correct.** At-most-once for a metrics tick (a lost sample doesn't matter). At-least-once + idempotency for "charge this card" (losing it is unacceptable; double-charging is, so dedupe).
- **Ordering weakens across boundaries.** Point-to-point FIFO that held in-process may not survive retries, partitions, or multiple network paths. If global order matters, you need sequence numbers and a single ordering point — don't assume the transport gives it to you.

These guarantees are the bridge to distributed systems and message queues — the professional level and [System Design](../../../Architecture/system-design/) go deeper, but a senior must already reason in *at-most / at-least / idempotent*.

---

## No Global Consistency

A subtle, paradigm-level consequence: **a pure message-passing system has no consistent global state you can read at an instant.** Each unit knows only its own state plus whatever messages it has received. There is no "stop the world and look at everything," because there's no shared memory to look at and no global clock to define "at the same time."

This is liberating *and* limiting:

- **Liberating:** it's exactly why actor systems distribute so naturally. Nothing assumes a shared view, so spreading units across machines changes little — the network was always the model.
- **Limiting:** any question of the form *"what is the total across all actors right now?"* has no crisp answer. By the time you've collected each unit's reply, the others have moved on. Computing a consistent global snapshot requires real algorithms (Chandy–Lamport snapshots, distributed transactions, consensus) — it is *not* a free read.

The senior takeaway: if your problem **fundamentally needs a single consistent view of everything at once** (a global invariant enforced synchronously, a strongly-consistent bank balance across all accounts), message passing makes that *harder*, not easier — you'll be reaching for consensus or a transactional store anyway. Message passing shines when the problem **decomposes into mostly-independent units** whose interactions are naturally local.

---

## Supervision & "Let It Crash"

The actor world's most distinctive contribution to engineering isn't the mailbox — it's a **failure philosophy**: *don't write defensive code for every weird state; let the unit crash, and have a supervisor restart it from a known-good state.*

The reasoning, due to Erlang/OTP:

1. **Most bugs are transient or context-specific.** A request hits an unexpected nil, a connection blips, a corrupt message arrives. Trying to handle every such case in-line produces tangled error code that's *itself* buggy and untested.
2. **A crash is a clean reset.** Because each actor's state is **isolated**, one actor crashing can't corrupt anything else. Kill it and respawn it, and you're back to a known-good state — no half-mutated shared memory to clean up. *This is only safe because state isn't shared* — the paradigm enables the philosophy.
3. **Move error handling up, to a supervisor.** A **supervisor** is an actor whose job is to watch children and react to their deaths with a **restart strategy** (restart just the failed one, restart all siblings, give up and escalate). The result is a **supervision tree**: leaves do work, inner nodes manage failure.

```erlang
% A supervisor: if a worker crashes, restart it. The worker code itself
% can stay "happy path" — no defensive try/catch around every operation.
init([]) ->
    SupFlags = #{strategy => one_for_one,   % restart only the crashed child
                 intensity => 5, period => 10},  % give up if >5 crashes in 10s
    Worker = #{id => kv,
               start => {kv_server, start_link, []},
               restart => permanent},        % always restart this one
    {ok, {SupFlags, [Worker]}}.
```

Why this works where it would be reckless elsewhere: in a shared-memory program, "just crash and restart" risks leaving shared state corrupted or locks held. In an actor system, isolation guarantees a crash is *local*, so restart-to-known-good is genuinely clean. "Let it crash" is not "be careless" — it's "concentrate correctness in the supervisor and the known-good initial state, instead of smearing it across defensive checks everywhere."

CSP (Go) has **no built-in supervision**. The idioms are manual: `recover()` in a deferred function to stop a panic from killing the process, a supervising goroutine that restarts a worker, and `context` for cancellation propagation. Libraries (e.g., supervised worker pools, `errgroup`) approximate it, but it's a discipline you assemble, not a runtime guarantee. This is one of the sharpest practical differences between the two models.

The restart-intensity limit ("≤ N restarts in T seconds, else escalate") is not a detail — it's what keeps "let it crash" from degenerating into a **crash loop**. Without it, a permanently-broken worker restarts forever, burning CPU and hiding the real failure. With it, a *transient* fault is silently absorbed (restart, recover, move on), while a *persistent* one trips the limit and bubbles up to a supervisor that can take a bigger action (restart a whole subsystem, fail over, page a human). The intensity threshold is, in effect, an automatic "transient vs persistent" classifier built into the runtime.

---

## The Poison Message

There's one failure mode where "let it crash" actively backfires: a **poison message** — an input that *deterministically* crashes whatever processes it. The actor crashes, the supervisor restarts it, the message is still at the head of the mailbox (or redelivered by the broker), it crashes again — a tight crash loop that can take down the supervisor's whole subtree via the intensity limit.

This is the message-passing analogue of an infinite retry on a permanently-failing operation, and the fixes are the same family:

- **Dead-letter queue (DLQ).** After *k* failed attempts, route the message *out* of the normal flow to a DLQ for inspection, and let processing continue. This is the broker's version of a supervisor giving up on one message instead of the whole actor. Kafka/SQS/RabbitMQ all provide it; Akka has dead-letters built in.
- **Skip-and-record.** The handler catches the specific parse/validation failure, logs the bad message with its id, and *acks* it (so it won't be redelivered) — turning a fatal crash into a recorded, skipped event.
- **Quarantine the producer.** If one source keeps emitting poison, isolate or rate-limit *that source* rather than the consumer.

The senior insight: "let it crash" is the right default for *transient, unexpected* faults, but a *deterministic* bad input is neither transient nor unexpected once you've seen it twice — and crashing on it forever is worse than handling it. Distinguish the two: crash on the surprising, **DLQ** the reproducible.

---

## Debugging Asynchronous Message Flows

The cost you feel daily isn't a crash — it's that **a single logical operation has no single stack trace.** A request becomes: client → actor A → (async) actor B → (async) actor C → reply, possibly interleaved with unrelated traffic, possibly across machines. When something's wrong, the stack trace shows you *one hop*, not the story.

Techniques seniors rely on:

- **Correlation / trace IDs.** Stamp every message with an id that flows through the whole chain, so logs from all hops can be stitched into one timeline. This is distributed tracing (OpenTelemetry, Jaeger), and it's *mandatory*, not optional, in serious message-passing systems. See [Observability](../../../Architecture/system-design/).
- **Make message protocols explicit and typed.** Sequence diagrams of who-sends-what-to-whom, and typed messages (Akka Typed, Go typed channels) so the compiler catches "wrong message to wrong recipient."
- **Log message *transitions*, not just states.** "Actor X received `Charge` in state `Idle` → moved to `Charging`" tells you the flow; a bare "balance is wrong" doesn't.
- **Watch the mailbox/queue depths.** A growing mailbox is the leading indicator of overload or a stuck consumer — instrument it. Often the *first* symptom of a deadlock or slow consumer is a queue that won't drain.
- **Reproduce with deterministic scheduling where possible.** Go's `-race` detector catches accidental shared memory; property/simulation tests (e.g., deterministic actor schedulers) catch ordering-dependent bugs that only appear under specific interleavings.

The meta-skill: in a shared-memory program you debug *state* (what's in the variable, who held the lock). In a message-passing program you debug *flow* (what message went where, in what order, and what got stuck). Your tooling has to match.

---

## Choosing: Actor vs CSP vs Shared Memory

A senior picks deliberately. Heuristics:

**Reach for shared memory + locks when:**
- the state is a **small, hot, read-mostly** value (a config, a cache, a counter) where a channel round trip per access is pure overhead;
- everything is **in one process** and the critical sections are tiny and obvious;
- you need a **consistent multi-variable read** that a single lock makes trivial.
Don't over-engineer a mutex-sized problem into a message protocol.

**Reach for CSP (channels) when:**
- the problem is naturally a **pipeline / flow** — stages transforming a stream of work;
- you want **backpressure for free** (a fast source throttled to a slow sink);
- units are **anonymous and interchangeable** (a worker pool draining one channel);
- you're in Go, or any language where channels are the idiomatic concurrency primitive.

**Reach for actors when:**
- the domain is a set of **stateful entities** (users, orders, devices, sessions) that each own state and react to events — "one actor per entity" maps cleanly;
- you need **fault isolation and supervision** — crashing and restarting individual entities without taking down the system;
- you're going **distributed** — location transparency means the same code spans machines;
- you have **huge numbers of mostly-idle concurrent things** (millions of connections) that lightweight actors handle cheaply.

**When message passing is overkill:**
- a single-threaded program with no concurrency (don't invent actors to feel modern);
- a tight numeric loop where the answer is *fewer* abstractions, not more (see [Data-Oriented Programming](../10-data-oriented-programming/));
- a problem genuinely needing a **global synchronous invariant** — you'll end up adding a transactional store or consensus anyway, so message passing buys little.

The senior framing: **message passing is a tool for decomposing a system into isolated, independently-failing, possibly-distributed units.** When the problem *has* that shape, it's a superpower. When it doesn't, it's ceremony that adds round trips, queues, and async-debugging tax for no benefit.

---

## Common Mistakes

- **Believing message passing has no deadlocks.** It trades lock-ordering deadlock for message-flow deadlock. Synchronous request/reply inside a handler, in a cycle, hangs just as dead — bound every wait and avoid cyclic synchronous waits.
- **Ignoring backpressure until production.** An unbounded actor mailbox is a latent OOM. Decide the overflow policy (block / drop / reject / scale) *before* load finds it for you.
- **Assuming exactly-once delivery.** Across a network you get at-most-once or at-least-once. Engineer **idempotent handlers**; don't trust the transport to deduplicate.
- **Expecting a consistent global view.** There isn't one. Any "total across all units right now" needs a snapshot algorithm or a transactional store, not a fan-out of reads.
- **Using "let it crash" without isolation.** The philosophy is safe *because* actor state is isolated. Applying "just restart it" to a component that shares mutable state (or holds external resources/locks) restarts into a corrupt world.
- **Debugging message flows with state-debugging tools.** Without correlation IDs and message-transition logs, an async system is nearly opaque. Build the tracing in from day one.
- **Forcing the paradigm on a mutex-sized problem.** A channel round trip per read of a hot counter is slower and more complex than a `RWMutex`. Match the tool to the shape.

---

## Summary

Message passing buys real safety — **no data races, no lock-ordering deadlocks, correctness from structure, natural fault isolation and distribution** — but it is not free: it **trades** those problems for **message-flow deadlock** (cyclic synchronous waits), **mailbox overflow** (unbounded actor queues with no built-in backpressure, versus CSP's blocking channels that supply it), **delivery uncertainty** (at-most-once loses, at-least-once duplicates, "exactly-once" is really *idempotent handling*), and the **loss of any consistent global view** (no instant in which the whole system's state is readable). The actor world's answer to failure is **supervision and "let it crash"** — concentrate correctness in a supervisor and a known-good initial state, and let isolated units die and restart cleanly, which is safe *only because* their state isn't shared; CSP gives you no such runtime and you assemble supervision by hand (`recover`, supervising goroutines, `context`). Debugging shifts from inspecting *state* to tracing *flow*, which makes **correlation IDs and message-transition logging mandatory**. The senior skill is **selection**: shared memory for small hot read-mostly state and consistent multi-variable reads; CSP for pipelines and free backpressure; actors for stateful entities, fault isolation, and distribution — and the judgment to *not* impose a message protocol on a problem that's really just a shared variable.

---

## Further Reading

- Joe Armstrong, *Making reliable distributed systems in the presence of software errors* — the thesis behind "let it crash" and supervision trees.
- *Designing for Scalability with Erlang/OTP* (Cesarini & Vinoski) — supervision, restart strategies, and failure design in depth.
- *Reactive Messaging Patterns with the Actor Model* (Vaughn Vernon) — actor design patterns, delivery semantics, and back-pressure.
- K. Mani Chandy & Leslie Lamport, *Distributed Snapshots: Determining Global States* — why a global view is an *algorithm*, not a read.
- *The Go Blog — "Go Concurrency Patterns: Context"* and *"Pipelines and cancellation"* — backpressure, cancellation, and avoiding goroutine leaks in CSP.

---

## Related Topics

- [`middle.md`](middle.md) — the mechanics this page weighs: addresses, mailboxes, channels, `select`, ordering.
- [`professional.md`](professional.md) — OTP, supervision trees at scale, distribution transparency, and message passing across services.
- [`interview.md`](interview.md) — the trade-offs as Q&A: deadlock, delivery guarantees, let-it-crash, when to choose message passing.
- [05 — Reactive Programming](../05-reactive-programming/) — backpressure and streams as a first-class paradigm.
- [06 — Dataflow & Stream Programming](../06-dataflow-and-stream-programming/) — pipelines and bounded buffers, the CSP cousin.
- [11 — Event-Driven Programming](../11-event-driven-programming/) — events/handlers and the async-flow debugging tax.
- [System Design](../../../Architecture/system-design/) — message queues, delivery guarantees, and observability at system scale.
- [Concurrency, Async & Parallelism](../../language-internals/concurrency-async-parallel/) — the thread/scheduler mechanics underneath.
