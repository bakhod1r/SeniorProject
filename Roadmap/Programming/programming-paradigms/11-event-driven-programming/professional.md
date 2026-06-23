# Event-Driven Programming — Professional Level

> **Roadmap:** [Programming Paradigms](../README.md) → Event-Driven Programming
> *Every event loop you've used is a thin layer over one OS call — `epoll`, `kqueue`, or IOCP — that answers "which of my thousands of file descriptors are ready?" without a thread per descriptor.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [The C10k Problem and Why the Loop Won](#the-c10k-problem-and-why-the-loop-won)
3. [Under the Loop: epoll, kqueue, IOCP, libuv](#under-the-loop-epoll-kqueue-iocp-libuv)
4. [The Reactor and Proactor Patterns](#the-reactor-and-proactor-patterns)
5. [Production Event-Driven Servers: Nginx, Redis, Node](#production-event-driven-servers-nginx-redis-node)
6. [Backpressure and Event Storms](#backpressure-and-event-storms)
7. [The Distributed Cousin: Event-Driven Architecture](#the-distributed-cousin-event-driven-architecture)
8. [Relation to Reactive, Actor, and Dataflow Paradigms](#relation-to-reactive-actor-and-dataflow-paradigms)
9. [Common Mistakes](#common-mistakes)
10. [Summary](#summary)
11. [Further Reading](#further-reading)
12. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What does this look like at scale, and where does the mechanism actually live?**

At this level the event loop stops being an abstraction you *use* and becomes a mechanism you *understand from the kernel up*. The single-threaded loop that serves 100,000 concurrent connections on one core is not magic; it's a specific, decades-old answer to a specific scaling problem (C10k), built on a specific OS primitive (readiness notification), wrapped in a recurring design pattern (the reactor), and embodied in specific production systems (Nginx, Redis, Node) whose architecture you should be able to reason about.

We'll also draw the bright line the whole topic has been pointing at: the difference between event-driven *programming* (the in-process loop — this topic's core) and event-driven *architecture* (events flowing between services over a broker — a **system-design** discipline). They rhyme, but they live in different chapters of an engineer's knowledge, and conflating them produces both bad code and bad system designs.

One scoping note carried from the README: this topic owns the *paradigm* — the loop, the patterns, the trade-offs. The *implementation mechanics* of async runtimes, schedulers, and OS concurrency primitives live in [Concurrency, Async & Parallelism](../../language-internals/concurrency-async-parallel/); the *distributed architecture* lives in [system design](../../../Architecture/system-design/). We cross-link rather than duplicate.

---

## The C10k Problem and Why the Loop Won

In 1999 Dan Kegel framed the **C10k problem**: how do you serve *ten thousand concurrent connections* on one machine? The dominant model then was **thread-per-connection** (or process-per-connection): accept a connection, hand it a thread, let that thread do blocking reads and writes. It's beautifully simple to *write* — each connection is plain sequential blocking code — but it doesn't scale, for concrete reasons:

- **Memory:** each thread needs a stack (default ~1–8 MB). 10,000 threads ≈ several GB of stack alone, most of it idle.
- **Scheduler overhead:** the OS scheduler must manage 10,000 runnable threads; context-switch cost grows and cache locality suffers.
- **Mostly-idle waste:** at any instant the vast majority of those threads are *blocked waiting on the network*, holding a full stack and a scheduler slot to do nothing.

The **event-driven** answer inverts it: **one thread (per core), many connections.** Instead of a thread blocking per connection, a single thread asks the OS "which of my 10,000 sockets have data ready *right now*?" and processes only those, in a loop. No per-connection stack, no per-connection scheduler entry, no context switches between connections. Memory per connection drops from megabytes to kilobytes (just the connection's state object). The thread is *never blocked* — when nothing is ready, it parks in one OS call and the kernel wakes it.

This is the architectural reason event-driven servers dominate the high-concurrency tier. The trade is the one from senior level — fragmented control flow — but for a proxy or cache whose logic *per event* is small, that trade is overwhelmingly worth it. (The modern counter-move is **green threads** — goroutines, Java virtual threads — which give you thread-per-connection's *readability* with the event loop's *scalability* by multiplexing many lightweight threads onto few OS threads over the *same* `epoll` primitive. The loop didn't disappear; it moved under the runtime. See [07 — Actor Model & CSP](../07-actor-model-and-csp/).)

---

## Under the Loop: epoll, kqueue, IOCP, libuv

The whole edifice rests on one OS capability: **readiness notification that scales**. The naive version, `select()`/`poll()`, takes the *entire* list of file descriptors on *every* call and scans it — O(n) per wait, which collapses at 10k FDs. The scalable versions are O(1)-ish in the number of *ready* FDs:

- **`epoll`** (Linux): you register interest in FDs *once* (`epoll_ctl`), then call `epoll_wait`, which returns *only the FDs that are ready*. Cost scales with the number of *active* connections, not *total* connections — exactly right when most of 10k connections are idle.
- **`kqueue`** (BSD/macOS): the same idea with a more general "kevent" filter model (covers FDs, timers, signals, file changes).
- **IOCP** (Windows I/O Completion Ports): a *completion*-based model (see proactor below) rather than readiness-based.
- **`io_uring`** (modern Linux): a newer ring-buffer interface that pushes toward completion-based, batched, lower-syscall I/O.

```text
The skeleton of every event-driven server, in pseudocode:

  register each socket with epoll (EPOLLIN = "tell me when readable")
  loop:
      ready = epoll_wait(...)        // BLOCKS here until ≥1 FD is ready (or timeout)
      for fd in ready:
          handler = handlers[fd]
          handler(fd)               // run-to-completion, then back to epoll_wait
```

That's the entire trick. `epoll_wait` is where an idle server *sleeps* using zero CPU; the kernel wakes it the instant a socket becomes readable. Everything above it — Node, Nginx, your async framework — is ergonomics over this loop.

**`libuv`** is the C library that gives Node (and others) a *cross-platform* event loop: it abstracts `epoll`/`kqueue`/IOCP behind one API, runs the phase-based loop you saw at middle level, and — crucially — adds a **thread pool** for operations the OS *can't* do via readiness notification (file system I/O on Linux, DNS resolution, CPU-bound crypto). So "Node is single-threaded" is precise but incomplete: *your JavaScript* runs on one thread; *libuv* uses a small pool (default 4) behind the scenes for the unavoidably-blocking bits, delivering their results back as events. The mechanics here belong to [Concurrency, Async & Parallelism](../../language-internals/concurrency-async-parallel/); we cover them as the *floor* the paradigm stands on.

---

## The Reactor and Proactor Patterns

Two named design patterns formalize event-driven I/O. Knowing them gives you precise vocabulary for any async server.

**Reactor** (readiness-based). The loop waits for the OS to signal *"this FD is ready for I/O,"* then the *application* performs the (now-guaranteed-non-blocking) read/write itself, then dispatches to a handler. Steps: register handler → demultiplex readiness (`epoll_wait`) → app does the I/O → handler processes the data. This is the `epoll`/`kqueue` model, and it's what Node, Nginx, Netty, libevent, and Twisted use. "Reactor" = *react to readiness; you do the I/O.*

**Proactor** (completion-based). The application *initiates* an asynchronous I/O operation and hands the OS a buffer; the OS performs the *entire* operation (including the data transfer) in the background and signals *"this operation is complete, here's the result."* Steps: initiate async op → OS does everything → completion event → handler processes the result. This is the Windows IOCP model (and where `io_uring` and Boost.Asio point). "Proactor" = *the OS does the I/O; you react to completion.*

| | Reactor | Proactor |
|---|---|---|
| OS signals | "ready to do I/O" | "I/O is done" |
| Who does the data transfer | The application | The OS |
| Backed by | `epoll`, `kqueue`, `select` | IOCP, `io_uring`, POSIX AIO |
| Classic systems | Nginx, Node/libuv, Netty | Windows servers, Boost.Asio |

Both are *demultiplexers + dispatchers* — they take many event sources and fan them to the right handler on (typically) one thread. The difference is *where the I/O work happens*. Many cross-platform libraries (including libuv) present a reactor-style API but use a proactor (IOCP) underneath on Windows, normalizing the two. Knowing the distinction lets you read any async-runtime's docs and immediately place its model.

---

## Production Event-Driven Servers: Nginx, Redis, Node

The paradigm is easiest to respect when you see how the systems you depend on every day are built on it.

- **Nginx.** Born as the explicit C10k answer to Apache's thread/process-per-connection model. Nginx runs a small number of **worker processes** (typically one per CPU core), and *each worker* is a single-threaded `epoll`/`kqueue` event loop juggling thousands of connections. This is why Nginx serves enormous connection counts on modest hardware with flat memory — there's no per-connection thread. The architecture is "N processes for *parallelism* across cores, one event loop *each* for *concurrency* within a core" — a pattern worth copying.
- **Redis.** Famously (mostly) **single-threaded** for command execution, on its own event loop (`ae`, over `epoll`/`kqueue`). Why does single-threaded make a *fast* database? Because Redis is in-memory, so commands are microsecond-fast and the bottleneck is I/O, not CPU — and single-threaded execution means **no locks, no contention, atomic commands for free** (exactly the run-to-completion atomicity from middle level, exploited deliberately). Redis added threaded I/O (for reading/writing sockets) and background threads (for `UNLINK`, persistence) over time, but the *command processing* stays single-threaded on purpose. It's the loop's "no data races" gift turned into a design principle.
- **Node.js.** A general-purpose runtime built on V8 + libuv, with the phase-based loop from middle level. The same shape as Nginx — one loop per process, scale across cores with the **cluster** module or multiple processes behind a load balancer. The lesson Node teaches the hard way is the senior one: because *your* code shares the loop, one CPU-heavy or blocking handler stalls the whole worker, so production Node demands the slow-handler discipline (offload to `worker_threads`, bound everything).

The recurring production pattern across all three: **one event loop per core/process for concurrency; multiple processes for parallelism.** A single loop maxes out one core; you scale horizontally by running more loops. This is the mature shape of event-driven systems at scale.

---

## Backpressure and Event Storms

Event-driven systems have a characteristic failure mode: **the producer of events outruns the consumer.** Events arrive faster than handlers can process them, the queue grows without bound, latency climbs, and eventually memory is exhausted and the process dies — or the queue's growth *is* the outage. This is the dark side of "decouple producers from consumers": nothing automatically slows the producer down.

**Backpressure** is the mechanism that propagates "I'm full, slow down" from a slow consumer back to a fast producer. Without it, an unbounded buffer just defers the crash. The forms it takes:

- **Pull-based / demand signaling.** The consumer requests N items; the producer sends at most N. Reactive Streams (and the JVM `Flow` API) standardize exactly this `request(n)` protocol — backpressure as a first-class signal. See [05 — Reactive Programming](../05-reactive-programming/).
- **Bounded buffers + blocking/pausing.** Node streams expose `writable.write()` returning `false` ("buffer full, pause") and a `'drain'` event ("resume"); honoring that return value *is* respecting backpressure. Ignoring it is a textbook memory-leak/OOM bug.
- **Load shedding.** When you *can't* slow the producer (it's the open internet), drop or reject excess events deliberately — return 503, sample, or degrade — rather than queue unboundedly. Bounded queues with a drop policy beat unbounded queues that crash.

**Event storms** are the acute version: a burst (a thundering herd of reconnects after an outage, a feedback loop where handling one event emits several more, a retry storm) floods the loop. Defenses: rate limiting / throttling, **debouncing/coalescing** (collapse a flood of "changed" events into one), circuit breakers, and bounded concurrency (cap in-flight operations). The unifying principle: **every event pipeline needs a bound and a plan for what happens at the bound** — backpressure to slow down, or shedding to drop. An event-driven system without backpressure is a system that works in testing and falls over under load.

---

## The Distributed Cousin: Event-Driven Architecture

Here is the bright line. Everything above is **event-driven programming**: one process, one loop, in-memory handlers. Scale the *same instinct* — "components react to events instead of calling each other" — across a *network of services*, and you get **event-driven architecture (EDA)**, which is a **system-design discipline, not a programming paradigm.** Mark this boundary clearly; it's the most-confused point in the whole topic.

The architectural concepts (covered properly in [system design](../../../Architecture/system-design/), summarized here only to fix the boundary):

- **Event bus / message broker.** Kafka, RabbitMQ, NATS, cloud pub/sub — a *durable* intermediary between services. Unlike in-process `EventEmitter` (fire-and-forget, lost if no listener), a broker **persists** events, supports **replay**, and **buffers** producer/consumer speed mismatches.
- **Publish/subscribe.** The Observer pattern across the network: services publish events; others subscribe; the publisher doesn't know its subscribers — the distributed echo of the in-process emitter.
- **Event sourcing.** Store state as an append-only *log of events* rather than current values; rebuild state by replaying. A storage/architecture pattern with no in-process equivalent.
- **Choreography vs orchestration.** Choreography = services react to each other's events with no central coordinator (emergent flow); orchestration = a central coordinator directs the sequence. The distributed analogue of "scattered handlers vs a controlling main."

Why keep them separate? Because the *hard problems differ*. In-process event-driven programming worries about loop blocking, microtask ordering, and callback structure. EDA worries about *network* concerns: delivery guarantees (at-least-once / exactly-once), message ordering across partitions, idempotency, the dual-write problem, schema evolution, and distributed tracing. The senior-level hazards (lost events, ordering, error leakage) *recur* at the architecture level but with network-scale answers (durable logs, partition keys, dead-letter queues, sagas). Bring in-process thinking to a distributed event system and you'll forget idempotency; bring broker thinking to a button click and you'll over-engineer. **Same instinct, different scale, different chapter.** Go to [Event-Driven Architecture](../../../Architecture/system-design/) and the [asynchronism](../../../Architecture/system-design/16-asynchronism/) / [data-streaming](../../../Architecture/system-design/15-data-streaming/) sections for the distributed treatment.

---

## Relation to Reactive, Actor, and Dataflow Paradigms

Event-driven programming is the common ancestor of several paradigms in this roadmap; placing it among them sharpens all of them.

- **Reactive ([05](../05-reactive-programming/))** generalizes events into **streams of values over time** with composable operators (`map`/`filter`/`debounce`/`merge`) and *built-in backpressure*. Where event-driven gives you raw callbacks and emitters, reactive gives you a *typed, composable algebra* over event streams. Reactive is event-driven *grown up* for the case where you compose and transform event sequences rather than handle single callbacks. The seam: a `Promise` is a single async value; an `Observable` is many — when you find yourself coordinating sequences of events, you've outgrown callbacks into reactive.
- **Actor model & CSP ([07](../07-actor-model-and-csp/))** is event-driven concurrency with **isolation and identity**: each actor has its own mailbox (a per-actor event queue) and processes messages one at a time, run-to-completion — *the same single-threaded-handler discipline, but per actor*, so you get many independent loops instead of one global loop. Actors solve the "one loop, one slow handler stalls everything" problem by giving each entity its *own* loop, and the "shared mutable state" problem by isolating state per actor. CSP (Go channels) is the same family from the channel side.
- **Dataflow & stream ([06](../06-dataflow-and-stream-programming/))** structures computation as a **graph of stages** where data (events) flow along edges and each node fires when its inputs are available. It's event-driven where the "events" are *data tokens arriving at a node*, and the wiring is the program. Backpressure and pipeline composition are first-class.

The unifying view: **all four are "react to things arriving."** Event-driven is the bare mechanism (loop + handlers). Reactive adds *composition + backpressure* over streams. Actors add *isolation + identity + per-entity loops*. Dataflow adds *explicit graph wiring*. Knowing event-driven as the substrate lets you see the others as principled extensions of it, each adding structure to tame a specific weakness of raw callbacks.

---

## Common Mistakes

- **Conflating event-driven programming with event-driven architecture.** Treating in-process emitters like durable brokers (expecting replay/persistence they don't have), or treating a distributed event system like an in-process loop (forgetting idempotency, ordering across partitions, delivery guarantees).
- **"Node is single-threaded" as the whole story.** Your JS is single-threaded; libuv has a thread pool, and you scale across cores with multiple processes. Saying "single-threaded" without these caveats reveals a shallow model.
- **No backpressure.** Building an event pipeline with unbounded buffering, which passes load tests and OOMs in production. Every pipeline needs a bound and a policy at the bound.
- **One loop, expecting parallelism.** A single event loop saturates one core. CPU-bound scaling needs multiple processes/threads; the loop gives concurrency, not parallelism.
- **Ignoring `writable.write()` return value / `'drain'`.** The classic Node stream memory leak — writing faster than the sink drains, with no pause.
- **Misplacing the reactor/proactor distinction.** Assuming all async I/O is "the same"; the readiness-vs-completion difference changes who buffers and when, and matters for cross-platform code.
- **Reaching for raw callbacks where reactive/actors fit.** Hand-rolling stream composition, per-entity queues, or backpressure that a reactive library or actor framework provides correctly out of the box.

---

## Summary

The single-threaded loop that serves 100,000 connections on one core is a specific answer to the **C10k problem** — "one thread per connection doesn't scale; one thread, many connections does" — built on a specific OS primitive: **scalable readiness notification** (`epoll`/`kqueue`/IOCP/`io_uring`), wrapped by cross-platform libraries like **libuv** (which adds a thread pool for the unavoidably-blocking bits). The pattern has two named forms: **reactor** (OS signals "ready," the app does the I/O — `epoll`, Nginx, Node) and **proactor** (OS signals "done," the OS did the I/O — IOCP, `io_uring`). The production shape is consistent — **one event loop per core/process for concurrency, multiple processes for parallelism** — and you see it in **Nginx** (worker-per-core loops), **Redis** (deliberately single-threaded command execution for lock-free atomicity), and **Node** (one loop, scale via cluster). The characteristic failure mode is the **producer outrunning the consumer**; every event pipeline therefore needs **backpressure** (propagate "slow down") or **load shedding** (drop deliberately), and defenses against **event storms** (throttle, debounce, bound concurrency). Scaling the *instinct* across services yields **event-driven architecture** — a **system-design discipline** (brokers, pub/sub, event sourcing, choreography) with *network-scale* concerns (delivery guarantees, ordering, idempotency) — which this paradigm cross-links to but does not own. Among paradigms, event-driven is the substrate: **reactive** adds stream composition and backpressure, **actors** add isolation and per-entity loops, **dataflow** adds explicit graph wiring — all variations on "react to things arriving."

---

## Further Reading

- Dan Kegel, *The C10k Problem* — the foundational write-up that named the scaling challenge and surveyed the I/O models.
- Douglas Schmidt et al., *Pattern-Oriented Software Architecture, Vol. 2* — the canonical descriptions of the **Reactor** and **Proactor** patterns.
- *The Architecture of Open Source Applications: Nginx* (Andrew Alexeev) — how Nginx's worker + event-loop model actually works.
- Redis docs, *Redis is single-threaded? How can it be so fast?* and the threading FAQ — the deliberate single-threaded design and its evolution.
- *Reactive Streams* specification and the JVM `Flow` API — backpressure as a standardized protocol.
- libuv design overview (docs.libuv.org) — the cross-platform loop, phases, and thread pool that power Node.

---

## Related Topics

- [`junior.md`](junior.md) — the handler/loop intuition and inversion of control.
- [`middle.md`](middle.md) — loop phases, micro/macrotasks, non-blocking I/O, `EventEmitter`.
- [`senior.md`](senior.md) — the trade-offs, debugging, the slow-handler problem, async error handling.
- [`interview.md`](interview.md) — the full Q&A bank, including reactor pattern and EDP-vs-EDA.
- [05 — Reactive Programming](../05-reactive-programming/) — composable event streams with backpressure.
- [06 — Dataflow & Stream Programming](../06-dataflow-and-stream-programming/) — computation as a graph of event-firing stages.
- [07 — Actor Model & CSP](../07-actor-model-and-csp/) — isolation + per-entity loops; green threads over the same `epoll` substrate.
- [Concurrency, Async & Parallelism](../../language-internals/concurrency-async-parallel/) — the *mechanics* of async runtimes, schedulers, and OS primitives.
- [Event-Driven Architecture](../../../Architecture/system-design/) · [Asynchronism](../../../Architecture/system-design/16-asynchronism/) · [Data Streaming](../../../Architecture/system-design/15-data-streaming/) — the distributed cousin (system design).
