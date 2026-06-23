# Reactive Programming — Professional Level

> **Roadmap:** [Programming Paradigms](../README.md) → Reactive Programming
> *Reactive programming is a way to write a function. A reactive **system** is a way to architect a distributed application. They share a name and a lineage but solve different problems — and conflating them is the most consequential mistake at this level.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Reactive Programming vs Reactive Systems](#reactive-programming-vs-reactive-systems)
3. [The Reactive Manifesto](#the-reactive-manifesto)
4. [The Reactive Streams Spec as an Interop Contract](#the-reactive-streams-spec-as-an-interop-contract)
5. [The Implementation Landscape: Reactor, RxJava, Akka Streams](#the-implementation-landscape-reactor-rxjava-akka-streams)
6. [Reactive at the Service Boundary](#reactive-at-the-service-boundary)
7. [End-to-End Backpressure Across the Network](#end-to-end-backpressure-across-the-network)
8. [Where Reactive Overlaps Dataflow and Event-Driven](#where-reactive-overlaps-dataflow-and-event-driven)
9. [Context Propagation and Observability](#context-propagation-and-observability)
10. [Architectural Trade-offs and When It Pays Off](#architectural-trade-offs-and-when-it-pays-off)
11. [Common Mistakes](#common-mistakes)
12. [Summary](#summary)
13. [Further Reading](#further-reading)
14. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How does this scale to a system, and where does it sit among the paradigms?**

By now you can build and reason about a reactive pipeline. The professional questions are architectural. When a vendor says their platform is "reactive," do they mean *the code uses observables* or *the system is built to stay responsive under failure and load*? Those are different claims with different costs, and they're routinely conflated in marketing, job descriptions, and architecture reviews. When a streaming pipeline spans an HTTP boundary — a slow client, a fast server — does the backpressure you carefully arranged inside one process survive the trip across the wire? And where does this paradigm end and the adjacent ones (dataflow, event-driven) begin, so you cross-link rather than reinvent?

This level draws the boundaries. It separates **reactive programming** (a local technique) from **reactive systems** (a distributed architecture), reads the **Reactive Manifesto** as the definition of the latter, treats the **Reactive Streams spec** as the interop contract that makes libraries composable, and traces **end-to-end backpressure** from a database cursor through a service to a browser. Throughout, the discipline is *placement*: knowing which problem each tool solves so you apply reactive where it pays and not where another paradigm or a plain function fits better.

> **The mindset shift:** "reactive" is two ideas wearing one word. Keep the *programming model* (observables in a function) and the *system property* (responsive-under-load architecture) separate in your head, your designs, and your interviews — most confusion at this level is one masquerading as the other.

---

## Reactive Programming vs Reactive Systems

This is the single most important distinction at the professional level, and the one most people get wrong.

**Reactive programming** is a *programming model*: you write logic as observables/operators that react to changing values, inside a single process. It's a technique, like recursion or dependency injection. Scope: a function, a class, a UI component, a service's internals.

**Reactive systems** (a.k.a. *reactive architecture*) is a set of *architectural properties* for distributed applications: the system stays responsive under failure and varying load, achieved through asynchronous message-passing between loosely-coupled components. Scope: the whole distributed application — services, message brokers, deployment topology.

| | Reactive **programming** | Reactive **systems** |
|---|---|---|
| What it is | a way to write code | a way to architect a system |
| Scope | within one process / function | across services / the network |
| Unit | observable, operator, subscription | component, message, isolation boundary |
| Defined by | the Observable contract | the Reactive Manifesto |
| Tools | RxJS, Reactor, RxJava | Akka, message queues, Erlang/OTP, microservices |
| Goal | compose async/time-varying logic | responsiveness under load & failure |

The crucial truths:

- **You can have either without the other.** A monolith written entirely in RxJS is reactive *programming* without being a reactive *system* (one process, no isolation, no message-passing resilience). An Erlang/OTP system or a well-architected message-driven microservice mesh is a reactive *system* whose individual services might be written in plain imperative code — reactive *architecture* without reactive *programming*.
- **Reactive programming is a common *implementation tactic* for reactive systems, not a requirement.** Async, non-blocking, backpressure-aware code (Reactor) makes it *easier* to build the responsive, elastic components a reactive system wants — but the *architecture* is defined by message-passing and isolation, not by which library writes the handlers.
- **The interview tell:** a candidate who says "we made it reactive by using RxJS" when asked about *system* resilience has conflated the two. The strong answer separates them and says how the code model serves (or doesn't) the architectural goal.

Hold this distinction and the rest of the level is clarifying detail.

---

## The Reactive Manifesto

The [Reactive Manifesto](https://www.reactivemanifesto.org/) (Jonas Bonér et al., 2014) defines reactive *systems* via four traits arranged as means-to-an-end:

```
          RESPONSIVE          ← the goal: react in a timely, predictable way
          /        \
   RESILIENT      ELASTIC     ← the properties that keep it responsive
   (under failure) (under load)
          \        /
       MESSAGE-DRIVEN          ← the foundation that enables the above
```

- **Responsive** (the *goal*): the system responds in a timely manner whenever possible — bounded, predictable latency. Everything else exists to protect this under stress. Responsiveness is also the basis of usability and of detecting problems fast.
- **Resilient** (responsive *under failure*): the system stays responsive when things break, via **replication, isolation, containment, and delegation**. Failure of one component is contained (bulkheaded) and doesn't cascade; recovery is delegated to another component. This is where the actor model and supervision trees shine. See [Circuit Breaker](../../../Architecture/system-design/) and resilience patterns.
- **Elastic** (responsive *under varying load*): the system scales out and in with demand, with no contention bottleneck or central point of serialization — implying minimal shared state and the ability to shard/replicate.
- **Message-driven** (the *foundation*): components communicate via **asynchronous message-passing**, which establishes the boundaries that make isolation, location transparency, elasticity, and backpressure possible. Async messages decouple components in *time* (sender doesn't block) and *space* (sender needn't know the receiver's location), and let load be managed via the message queue (which is where backpressure lives at the system level).

The throughline: **message-driven is the substrate; resilient and elastic are what it buys you; responsive is the point.** Note the manifesto never mentions observables or RxJS — reactive *systems* are an *architecture*, and reactive *programming* is merely one convenient way to implement the components. This is the formal statement of the programming-vs-systems split above.

---

## The Reactive Streams Spec as an Interop Contract

The senior level introduced [Reactive Streams](https://www.reactive-streams.org/) as a backpressure protocol. At the professional level its more important role is as an **interop standard** — the reason a Reactor `Flux` can feed an RxJava `Flowable` can feed an Akka Stream without glue code or buffering surprises.

The spec is deliberately *minimal*: four interfaces (`Publisher`, `Subscriber`, `Subscription`, `Processor`) and a precise rule set (the `request(n)` demand protocol, the terminal-signal guarantees, the no-emit-without-demand rule). It is *not* a library and has *no operators* — it's the lowest common denominator that any compliant library implements, so they compose:

```
Reactor Flux ──(Publisher)──► RxJava Flowable ──(Publisher)──► Akka Source
       \______________ all speak the same request(n) protocol ______________/
```

Two milestones cement its importance:

- **Adopted into the JDK** as `java.util.concurrent.Flow` (Java 9) — the four interfaces are now in the standard library, so the contract needs no third-party dependency.
- **The backbone of modern JVM async I/O** — Spring WebFlux, R2DBC (reactive DB drivers), reactive Kafka clients, and gRPC's reactive bindings all speak Reactive Streams, so a request can flow from an HTTP handler through a DB driver as one demand-driven pipeline.

The professional value is *composability with preserved backpressure*: because every link honors `request(n)`, demand propagates across library boundaries, and you can assemble a heterogeneous pipeline that's still bounded-memory end to end. Without the standard, each library bridge would need a buffer (and an overflow policy, and a leak). The spec is the contract that makes "lossless flow control" survive crossing between codebases.

---

## The Implementation Landscape: Reactor, RxJava, Akka Streams

The three dominant JVM implementations encode different philosophies; choosing among them is an architectural decision.

**Project Reactor** (`Mono`/`Flux`) — the Spring ecosystem's reactive core, powering WebFlux. Two types by cardinality: `Mono` (0..1, the async-result/Promise role) and `Flux` (0..N stream). Deeply integrated with Spring, R2DBC, reactive Kafka. Choose it when you're on Spring and want non-blocking I/O end to end.

```java
// Reactor: a non-blocking HTTP endpoint streaming from a reactive DB driver.
@GetMapping(value = "/orders", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
public Flux<Order> stream() {
    return orderRepository.findAllByStatus("OPEN")   // R2DBC: a reactive Flux
        .filter(Order::isLarge)
        .timeout(Duration.ofSeconds(5))
        .onErrorResume(e -> Flux.empty());           // demand flows DB → HTTP client
}
```

**RxJava** — the original JVM Rx port, the de-facto standard on Android. `Observable` (no backpressure, for UI events) vs `Flowable` (backpressure-aware, for data) — the split *forces* you to declare whether a source needs flow control. Choose it for Android or non-Spring JVM apps.

**Akka Streams** — built on the actor model, the most "reactive *systems*" of the three: streams *are* materialized as actors, so backpressure, supervision, and distribution come from the actor substrate. Its `Source`/`Flow`/`Sink` graph DSL models stream *topologies* (fan-out, fan-in, cycles) explicitly. Choose it when the streaming is part of a larger actor-based, distributed, resilient architecture (it's the bridge between reactive programming and reactive systems). See [Actor Model & CSP](../07-actor-model-and-csp/).

The meta-point: all three implement Reactive Streams, so they *interoperate*, but they sit at different points on the programming↔systems axis — Reactor and RxJava are reactive-programming libraries; Akka Streams reaches into reactive-systems territory by riding the actor model.

---

## Reactive at the Service Boundary

Adopting reactive programming inside a service forces a decision at its *edges*: the value of non-blocking, backpressure-aware code is **lost the moment it touches a blocking call**. A reactive pipeline that calls a blocking JDBC driver or a blocking HTTP client ties up a thread waiting — defeating the entire point of the reactive runtime (a small fixed thread pool serving many concurrent requests via non-blocking I/O).

This is the **"reactive all the way down" constraint**:

```
[ reactive HTTP server ] → [ reactive logic ] → [ BLOCKING JDBC driver ]
                                                  ▲
                       one blocking call here pins a thread and
                       collapses the non-blocking throughput model
```

The implications professionals must manage:

- **Every boundary must be non-blocking** to keep the benefit: reactive web layer (WebFlux), reactive DB driver (R2DBC, reactive Mongo), reactive HTTP client (WebClient), reactive messaging (reactive Kafka). A single blocking dependency forces you to either isolate it on a bounded elastic scheduler (`subscribeOn(Schedulers.boundedElastic())` — a thread-pool fallback that *gives up* the non-blocking advantage for that call) or abandon reactive for that path.
- **The cost/benefit only closes at high concurrency.** Reactive's payoff is serving thousands of concurrent, mostly-idle connections on few threads (the C10k shape: many slow clients, lots of I/O wait). For CPU-bound work or low concurrency, the blocking thread-per-request model is simpler and often *faster* — reactive's machinery is pure overhead.
- **Observability and debugging cross the boundary too.** A blocking stack trace tells you where you are; a reactive one doesn't (senior level), and that pain compounds across services. Reactor's `checkpoint()` and context-propagation (MDC across async hops) are non-optional in production.

The decision: go reactive at the boundary **only when the whole path can be non-blocking and concurrency is genuinely high**. A half-reactive service — reactive web layer over a blocking database — has the costs of both models and the benefits of neither.

---

## End-to-End Backpressure Across the Network

The senior level handled backpressure *within* a process. The professional question: does it survive crossing the network, where producer and consumer are on different machines?

In-process, `request(n)` is a method call — instant, reliable. Across a network, "send me n more" is itself a message that takes time and can be lost, and the producer might be a different service with its own load. Backpressure must be *encoded into the transport*:

- **TCP flow control is the substrate.** TCP's receive window *is* backpressure at the byte level: a slow reader's shrinking window stalls the sender's writes. A naive streaming server that writes to a socket faster than the client reads will eventually block on the socket write (or buffer unboundedly if it ignores the signal) — so respecting TCP's signal is the floor.
- **HTTP/2 and gRPC streaming** carry flow control per-stream (HTTP/2 `WINDOW_UPDATE` frames), giving application-level backpressure over a multiplexed connection. gRPC's reactive bindings map this to `request(n)`, so a slow gRPC client genuinely slows a streaming server — backpressure end to end.
- **Server-Sent Events (SSE) and WebSockets** are weaker: SSE has no app-level demand signal (it relies on TCP backpressure only), and WebSocket backpressure is manual (watch `bufferedAmount`, pause sending). Streaming `Flux` over SSE (`text/event-stream`) works but bottoms out at TCP-level flow control. See [Server-Sent Events](../../../Architecture/system-design/) and [WebSocket Patterns](../../../Architecture/system-design/).
- **Message brokers move backpressure to the queue.** With Kafka/RabbitMQ between services, backpressure becomes *consumer lag* and *queue depth*: a slow consumer lets the queue grow (bounded by retention/disk), and you manage it with consumer-group scaling, partitioning, and lag-based autoscaling rather than `request(n)`. The buffer is now durable and external — which is often the *right* answer for cross-service decoupling (it converts synchronous backpressure into asynchronous, observable lag). See [System Design → Data Streaming](../../../Architecture/system-design/15-data-streaming/) and [Message Queue Patterns](../../../Architecture/system-design/).

The professional synthesis: **true end-to-end backpressure requires every hop — DB driver, service code, transport, broker — to honor demand or expose lag.** Reactor + R2DBC + WebFlux + gRPC can preserve `request(n)` from a database cursor to a browser; but the instant any hop is unaware (a blocking driver, SSE's TCP-only signal, a fire-and-forget queue publish), backpressure breaks there and you fall back to buffering or dropping at that boundary. Designing the system means knowing *where* the demand signal lives at each hop.

Trace one demand signal through a fully-reactive path — a browser slowly consuming a stream of millions of rows, with bounded memory the whole way:

```
browser (slow render)                                  Postgres (10M rows)
   │  HTTP/2 WINDOW_UPDATE: "ready for ~N more frames"        ▲
   ▼                                                          │
[ WebFlux endpoint ]──Flux──►[ service logic ]──Flux──►[ R2DBC driver ]
   request(8) ───────────────► request(8) ─────────────────► request(8)
                                                              │
                            cursor FETCH 8 rows  ◄────────────┘
   ◄──── 8 rows flow downstream, HTTP/2 frames sent, browser renders ────►
   (when the browser's window reopens, the next request(n) fires another FETCH)
```

The chain holds because **every link speaks `request(n)`**: the browser's HTTP/2 receive window throttles the WebFlux writer, which propagates demand to the service `Flux`, which propagates it to R2DBC, which issues a *bounded* cursor `FETCH` — so Postgres never produces, and the JVM never buffers, more than the browser is ready to render. Peak memory is `O(demand)`, not `O(10M rows)`. Now swap *one* hop for a blocking JDBC driver: it eagerly pulls the full result set (or pages without honoring downstream demand), the `Flux` upstream of it loses its throttle, and you're back to buffering 10M rows in the heap — the single-blocking-hop failure, made concrete. This is why "reactive all the way down" is a *backpressure* requirement, not just a throughput one.

---

## Where Reactive Overlaps Dataflow and Event-Driven

Reactive sits among three closely-related paradigms; professionals link rather than conflate them.

**Reactive vs Dataflow ([topic 06](../06-dataflow-and-stream-programming/)).** Both model computation as values flowing through a graph of transformations. The emphasis differs: **dataflow** centers the *graph of dependencies* and is often about *throughput* through a topology (FBP, stream-processing engines like Flink, a build DAG); **reactive** centers *time-varying values and the subscription/observer mechanics*, often for *event coordination*. A reactive pipeline *is* a dataflow graph, and spreadsheet-style propagation belongs to both. The glitch/topological-ordering concerns (senior level) are fundamentally *dataflow* concerns — which is why that mechanics treatment lives in topic 06. Rule of thumb: if you're thinking "observable, subscribe, operator," it's reactive; if you're thinking "nodes, edges, scheduling the graph," it's dataflow.

**Reactive vs Event-Driven ([topic 11](../11-event-driven-programming/)).** Event-driven is the *substrate*: an event loop, events, and handlers/callbacks. Reactive is a *higher-level structuring* built on it — it takes the raw event-driven model (`addEventListener`, callbacks) and gives it composition (operators), a unified error channel, and cancellation. Every reactive UI runs on an event-driven loop; reactive is "event-driven with first-class, composable, cancellable streams." Plain event-driven code scatters handlers and shared mutable state; reactive collapses that into declarative pipelines.

**Where the mechanics live (deduplication).** Per this roadmap's scope discipline: the *lazy-stream / pull-evaluation mechanics* live in [FP → Laziness & Streams](../../code-craft/functional-programming/12-laziness-and-streams/) (push-reactive is the dual of pull-lazy); the *infrastructure-scale streaming* (Kafka, Flink, exactly-once, partitioning) lives in [System Design → Data Streaming](../../../Architecture/system-design/15-data-streaming/); the *concurrency primitives* live in [Language Internals → Concurrency](../../language-internals/concurrency-async-parallel/). This topic stays at the *paradigm* level and points to those.

---

## Context Propagation and Observability

A non-obvious but production-critical cost of going reactive: the per-request **context** that imperative code carries implicitly on the thread — trace IDs, the authenticated user, the tenant, MDC logging fields — *does not* follow a reactive pipeline for free. In a blocking thread-per-request model, a `ThreadLocal` (the basis of SLF4J's MDC, Spring Security's `SecurityContextHolder`, and most tracing) is set at the request edge and is automatically visible everywhere downstream, *because it's the same thread the whole time*. A reactive pipeline shatters that assumption: work hops across schedulers and threads, so a `ThreadLocal` set when the request arrives is *gone* by the time an operator three hops later runs on a different pool thread.

The consequences are real and routinely shipped as bugs:

- **Lost trace correlation.** Logs from inside a `flatMap` print with no trace ID, so a distributed trace has holes exactly where the async work happened — the hardest part to debug.
- **Vanished security context.** `SecurityContextHolder.getContext()` returns empty inside a reactive operator, so an authorization check silently sees an anonymous principal.
- **Wrong tenant / locale.** Multi-tenant or i18n context set per-request leaks or disappears across the scheduler boundary.

The fix is an explicit, framework-provided context that rides *with the data flow* rather than the thread:

- **Reactor `Context` / `contextWrite`** — an immutable key-value map attached to the *subscription*, propagated upstream through the whole chain regardless of which thread each operator runs on. You read it with `Mono.deferContextual(...)`.
- **The `Micrometer Context Propagation` library** bridges `ThreadLocal`-based tools (MDC, tracing, security) to Reactor `Context`, restoring the `ThreadLocal` *around* each operator execution so legacy logging/tracing "just works" again.
- **In RxJS**, there's no built-in context; you thread correlation IDs through the values themselves or via a closure, which is more manual.

The professional takeaway: **adopting reactive means re-plumbing your observability and security context propagation**, and forgetting this produces a system that *runs* fine and is *un-debuggable in production* — traces with gaps, auth checks against the wrong principal. It's a major hidden line item in the "reactive all the way down" cost, and a frequent reason teams underestimate the migration.

---

## Architectural Trade-offs and When It Pays Off

A professional makes the adoption call with eyes open. The reactive bargain, stated plainly:

**What you pay:**
- A steep learning curve and a permanent **debuggability tax** (non-linear control flow, opaque stack traces) borne by every engineer who touches the code, forever.
- **"Reactive all the way down"** pressure: one blocking dependency undermines the model, so adoption tends to be all-or-nothing along a request path.
- **Ecosystem lock-in and migration cost**: rewriting a blocking stack to non-blocking is a major investment, not an incremental refactor.
- **Operational complexity**: context propagation (tracing/MDC across async hops), tuning schedulers, and reasoning about backpressure under failure.

**What you get:**
- **Resource efficiency at high concurrency**: many concurrent, I/O-bound, mostly-idle connections served on a small fixed thread pool — the WebFlux/Node/C10k win.
- **End-to-end backpressure**: bounded memory streaming millions of items, when every hop honors demand.
- **Composable async coordination**: cancellation, combination, and time-handling as first-class operators.
- **A natural fit for streaming/real-time** workloads.

**When it pays off:** high-concurrency, I/O-bound services (API gateways, streaming endpoints, fan-out aggregators), real-time data platforms, and systems where backpressure is a genuine requirement. **When it doesn't:** CPU-bound work, low/moderate concurrency, simple request/response CRUD (where blocking thread-per-request with virtual threads — JDK 21 — now offers reactive-like scalability *with* blocking-style debuggability), and teams without the expertise to maintain it. The arrival of **virtual threads** (Project Loom) is significant: it delivers much of reactive's concurrency benefit while letting you write straightforward blocking-style code — shrinking the set of cases where reactive's complexity is *worth* it to genuinely stream-shaped and backpressure-critical problems.

The senior-to-professional through-line: reactive programming is a *targeted* tool; reactive systems are an *architecture*; and the wise default for most services is plain code (increasingly on virtual threads), reserving the reactive machinery for the parts of the system that are genuinely streams.

---

## Common Mistakes

- **Conflating reactive programming with reactive systems.** "We use RxJS, so we're a reactive system" — no. One is a code model; the other is a message-driven distributed architecture. Keep them separate.
- **Going reactive over a blocking stack.** A reactive web layer calling a blocking JDBC driver has both models' costs and neither's benefit. Reactive must be non-blocking all the way down.
- **Assuming backpressure survives the network for free.** It survives only if every hop (driver, transport, broker) honors demand or exposes lag. SSE and fire-and-forget publishes break it.
- **Adopting reactive at low concurrency / for CPU-bound work.** The machinery is pure overhead; thread-per-request (now with virtual threads) is simpler and often faster.
- **Treating Reactive Streams as a library.** It's a four-interface *interop contract* with no operators — the thing that lets Reactor, RxJava, and Akka compose with preserved backpressure.
- **Reinventing dataflow/event-driven/streaming mechanics here.** The graph-scheduling, infra-streaming, and concurrency mechanics live in adjacent topics — cross-link, don't duplicate.

---

## Summary

The professional level is about *placement and architecture*. The cardinal distinction: **reactive programming** is a within-process code model (observables/operators), while **reactive systems** are a distributed architecture of loosely-coupled, message-passing components — you can have either without the other, and reactive programming is merely a convenient *tactic* for building reactive-system components. The **Reactive Manifesto** defines reactive systems as *responsive* (the goal), kept so by being *resilient* (under failure, via isolation/replication/delegation) and *elastic* (under load), both founded on *message-driven* async communication — and notably never mentions observables. The **Reactive Streams spec** matters most as a minimal four-interface **interop contract** (now `java.util.concurrent.Flow`) that lets Reactor, RxJava `Flowable`, and Akka Streams compose with `request(n)` backpressure preserved across library boundaries. Those three implementations sit at different points on the programming↔systems axis (Reactor/RxJava = programming; Akka Streams = riding the actor model toward systems). Adopting reactive forces **"all the way down"** non-blocking at every service boundary — a single blocking call collapses the model — and only pays off at **high I/O-bound concurrency**. True **end-to-end backpressure** requires every hop (DB driver → service → transport → broker) to honor demand or expose lag; SSE, WebSockets, and fire-and-forget publishes weaken it, and brokers convert synchronous backpressure into observable consumer lag. Reactive **overlaps** dataflow (the dependency-graph view; glitch/topology mechanics live in topic 06), is built atop **event-driven** (topic 11) with added composition/cancellation, and defers stream *mechanics* to FP laziness and *infra streaming* to system design. Finally, **virtual threads** (Loom) reclaim much of reactive's concurrency benefit with blocking-style debuggability — narrowing reactive's worthwhile niche to genuinely stream-shaped, backpressure-critical, high-concurrency problems.

---

## Further Reading

- [The Reactive Manifesto](https://www.reactivemanifesto.org/) — the short, definitive statement of *reactive systems* (responsive/resilient/elastic/message-driven).
- *Reactive Design Patterns* (Roland Kuhn, Brian Hanafee, Jamie Allen) — the book-length treatment of reactive *systems*, from the Akka authors.
- [Reactive Streams Specification](https://www.reactive-streams.org/) and JEP for `java.util.concurrent.Flow` — the interop contract and its JDK adoption.
- [Spring WebFlux Reference](https://docs.spring.io/spring-framework/reference/web/webflux.html) — reactive at the service boundary, non-blocking I/O, and the blocking-driver pitfall in practice.
- *Loom and Reactive Programming* (Brian Goetz talks / JEP 444) — why virtual threads change the reactive cost/benefit calculus.

---

## Related Topics

- [`senior.md`](senior.md) — backpressure strategies, glitches, and the debuggability tax this level scales to systems.
- [`interview.md`](interview.md) — reactive-programming-vs-systems, the Manifesto, end-to-end backpressure, and staff-level architecture questions.
- [06 — Dataflow & Stream Programming](../06-dataflow-and-stream-programming/) — the dependency-graph paradigm reactive overlaps; graph-scheduling mechanics live here.
- [07 — Actor Model & CSP](../07-actor-model-and-csp/) — the message-driven foundation of reactive *systems*; Akka Streams bridges into it.
- [11 — Event-Driven Programming](../11-event-driven-programming/) — the event-loop substrate reactive programming is built on.
- [Functional Programming → Laziness & Streams](../../code-craft/functional-programming/12-laziness-and-streams/) — pull-lazy streams, the dual of push-reactive; the stream *mechanics*.
- [System Design → Data Streaming](../../../Architecture/system-design/15-data-streaming/) — Kafka/Flink-scale streaming, partitioning, and infra-level backpressure.
- [Language Internals → Concurrency](../../language-internals/concurrency-async-parallel/) — threads, event loops, and virtual threads under the reactive runtime.
