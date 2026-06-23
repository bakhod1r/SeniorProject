# Reactive Programming — Senior Level

> **Roadmap:** [Programming Paradigms](../README.md) → Reactive Programming
> *Knowing the operators is the easy part. The senior questions are: what happens when the producer is faster than the consumer, why is this reactive graph impossible to debug, and — most importantly — when is reactive the wrong tool entirely?*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Backpressure: When the Producer Outpaces the Consumer](#backpressure-when-the-producer-outpaces-the-consumer)
3. [Backpressure Strategies](#backpressure-strategies)
4. [The Reactive Streams request(n) Protocol](#the-reactive-streams-requestn-protocol)
5. [Cold/Hot Pitfalls in Production](#coldhot-pitfalls-in-production)
6. [Subscription Leaks at Scale](#subscription-leaks-at-scale)
7. [Glitches and Consistency](#glitches-and-consistency)
8. [Schedulers: Where and When Code Runs](#schedulers-where-and-when-code-runs)
9. [A Worked Debugging Walkthrough](#a-worked-debugging-walkthrough)
10. [Debugging Reactive Graphs](#debugging-reactive-graphs)
11. [When Reactive Wins](#when-reactive-wins)
12. [When Reactive Is the Wrong Tool](#when-reactive-is-the-wrong-tool)
13. [Common Mistakes](#common-mistakes)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What breaks at scale, and when should I *not* reach for this?**

A reactive pipeline that works on a developer's laptop with a trickle of events can fall apart in production for reasons that never appear in tutorials. The producer emits ten thousand events per second and the consumer handles one thousand — where do the other nine thousand go? A bug only reproduces under load, and the stack trace is a meaningless wall of internal RxJS frames with no hint of *which* of your forty operators misbehaved. Two derived values that should always agree briefly disagree, flickering a wrong number on screen.

These are the senior concerns: **backpressure** (the mismatch between production and consumption rates), the **debuggability tax** of non-linear control flow, **glitches** (transient inconsistency in a dependency graph), and the production failure modes of cold/hot confusion and leaked subscriptions. But the most senior skill isn't handling any of these well — it's *judgment*: recognizing the problem shapes where reactive earns its complexity, and the larger set of shapes where it's an expensive way to write what a loop and a callback would have said plainly.

> **The mindset shift:** stop asking "how do I express this reactively?" and start asking "*should* this be reactive at all?" The paradigm's power and its cost are the same thing — implicit, propagating dataflow — and a senior engineer spends that cost deliberately.

---

## Backpressure: When the Producer Outpaces the Consumer

**Backpressure** is the problem of a source producing values faster than the downstream can consume them. It is the defining hard problem of stream processing, and it's invisible until the rates diverge.

```
producer:  ●●●●●●●●●●●●●●●●●●●●●●●●●●●●  (10,000 events/sec — a firehose)
consumer:  ●────●────●────●────●────●──  (1,000 events/sec — slow DB write)
                            ▲
              where do the other 9,000/sec go?
```

There are only four physically possible answers, and every backpressure strategy is one of them:

1. **Buffer** them — hold the excess in memory. Bounded → eventually full; unbounded → eventually out-of-memory. Buffering doesn't solve the imbalance; it *delays* the reckoning and converts a throughput problem into a latency-and-memory problem.
2. **Drop** them — discard values you can't keep up with. Cheap and safe for memory, but you lose data.
3. **Slow the producer** — tell the source to stop emitting until the consumer asks for more. Only possible if the producer *can* be slowed (a database cursor can; a mouse cannot; a stock exchange will not).
4. **Crash** — the default if you ignore the problem. Unbounded buffers grow until OOM.

The critical insight is that **backpressure is only solvable when the producer is controllable.** A "pull-based" source (a file, a database cursor, a paginated API) can be asked to wait. A "push-based" source you don't control (UI events, sensor data, market feeds, another team's Kafka topic) *cannot be slowed* — for those, your only options are buffer, drop, or sample. This is why RxJS (designed for UI events, which can't be slowed) largely *omits* backpressure and expects you to use lossy operators, while Project Reactor and Akka Streams (designed for server data pipelines, which often can be slowed) build backpressure into the core protocol. The library you pick encodes an assumption about whether your producers are controllable.

---

## Backpressure Strategies

When the producer can't be slowed, you choose *how to lose or delay* data. The operators encode the policy:

| Strategy | Operator (RxJS) | Behavior | Use when |
|---|---|---|---|
| **Buffer** | `bufferTime`, `bufferCount`, `onBackpressureBuffer` (Reactor) | collect into batches | bursty input, batchable work (bulk DB insert) |
| **Drop newest** | `onBackpressureDrop` (Reactor), `audit` | discard incoming while busy | you can afford to miss values; freshness > completeness |
| **Drop oldest / keep latest** | `onBackpressureLatest` (Reactor), `auditTime` | keep only the most recent | UI state, gauges — only the current value matters |
| **Sample** | `sampleTime`, `throttleTime` | emit the latest every N ms | rate-limit a firehose to a sustainable cadence |
| **Window** | `windowTime`, `windowCount` | split into sub-streams | per-interval aggregation |
| **Request-based** | Reactive Streams `request(n)` | consumer pulls what it can handle | controllable producers; lossless |

The decision rule is **"what does losing a value cost?"** For a live price gauge, dropping all but the latest is *correct* — nobody cares about the price 50ms ago. For financial transactions, dropping is a data-loss bug; you must buffer (bounded, with a defined overflow policy) or apply true request-based backpressure and let the slowness propagate upstream. Sampling fits telemetry; windowing fits aggregation. The wrong default — an unbounded buffer — looks fine in testing and OOMs in production exactly when load is highest.

```java
// Reactor: an uncontrollable fast source, keep only the latest, never OOM.
fastSensorFlux()
    .onBackpressureLatest()                 // overflow policy: drop all but newest
    .publishOn(Schedulers.boundedElastic()) // hand off to a slower consumer
    .subscribe(this::writeToDb);            // slow consumer can't drown
```

---

## The Reactive Streams request(n) Protocol

When the producer *is* controllable, the elegant answer is to make consumption **pull-driven on top of a push model** — the consumer signals how much it's ready for, and the producer never emits more than that. This is the **Reactive Streams** specification (adopted into the JDK as `java.util.concurrent.Flow`), the contract behind Reactor, RxJava's `Flowable`, and Akka Streams.

The protocol is four interfaces and one key call:

```
Publisher ──subscribe──► Subscriber
Subscriber receives a Subscription, then drives the flow:
    subscription.request(n)   "I can handle n more items — send up to n"
    onNext(item) × up to n
    subscription.request(n)   "ready for n more"
    ...
    onComplete() / onError(e)
```

The magic is `request(n)`: the publisher is **forbidden** from emitting more than the total requested. A slow consumer requests `1`, processes it, requests `1` more — and that demand signal propagates *all the way upstream*, naturally slowing a controllable producer (a DB cursor fetches the next page only when demand arrives). No buffer grows unbounded because nothing is produced without a matching request. This is **lossless, bounded-memory** flow control, and it's why server-side reactive stacks (Spring WebFlux, gRPC streaming) can stream millions of rows through fixed memory.

The limit, again: `request(n)` only works when the producer can *honor* it by slowing down. Bridge an uncontrollable source (a websocket firehose) into a Reactive Streams pipeline and you're back to choosing an overflow strategy (`onBackpressure*`) at the boundary — the spec makes you declare, explicitly, what happens when demand can't keep up. That forced explicitness is the spec's real value: it turns "we'll OOM under load, surprise" into a decision you made on purpose.

---

## Cold/Hot Pitfalls in Production

The cold/hot distinction (middle level) graduates from "gotcha" to "incident" at scale:

- **Cold duplication → load amplification.** A cold HTTP Observable subscribed by three UI components fires **three** identical backend requests. Multiply across a dashboard with dozens of widgets and you've tripled load on a service for no reason. The fix is `shareReplay(1)` to multicast one execution — but `shareReplay` has its *own* trap (below).
- **`shareReplay` reference leaks.** A naive `shareReplay(1)` keeps the source subscription alive *forever* even after all downstream subscribers leave, because it holds the replay buffer. Use `shareReplay({ bufferSize: 1, refCount: true })` so it tears down when the last subscriber unsubscribes. The default not having `refCount` has caused countless leaks.
- **Hot latecomers miss the start.** Subscribe to a hot stream after it emitted the initial state and your component renders blank. The fix is a `BehaviorSubject` or `ReplaySubject` that holds the last value(s) for late joiners — but `ReplaySubject(∞)` is itself an unbounded buffer (a backpressure leak in disguise).
- **Accidental hot-from-cold via `share`.** Adding `share()` to fix duplication can *change semantics*: if some subscribers needed the full sequence from the start and others joined late, sharing makes the latecomers miss data they used to get. The cold/hot choice is a *correctness* property, not just performance.

The senior habit: for every Observable crossing a component boundary, you can state whether it's cold or hot and what its multicasting/replay policy is — because in production that policy determines both your backend load and your memory profile.

---

## Subscription Leaks at Scale

A single leaked subscription is invisible; ten thousand of them is an outage. The leak pattern compounds with component lifecycles:

```ts
// A component created and destroyed thousands of times (a list row, a modal).
// If each leaks one interval subscription, you accumulate thousands of live
// intervals, each pinning the component's closure — heap climbs, then OOM.
ngOnInit() { interval(1000).subscribe(() => this.refresh()); }   // never torn down
```

What makes reactive leaks especially nasty:

- **The leak retains the whole closure graph.** A live subscription keeps its handler alive, which keeps `this` (the component) and everything *it* references alive — a destroyed component that can't be garbage-collected. This is the closure-retention leak from the FP roadmap, at scale. See [Memory Leak Detection](../../code-craft/functional-programming/01-first-class-and-higher-order-functions/interview.md).
- **Hot/infinite sources never self-terminate.** Unlike an HTTP call that completes, `interval`, DOM events, and websockets run until unsubscribed. Every one is a potential leak.
- **The symptom is delayed and diffuse.** Heap grows slowly over hours; the crash happens far from the cause. Diagnosis requires a heap dump showing thousands of retained subscriptions/closures — not a stack trace.

Defenses: the `takeUntil(destroy$)` discipline applied *uniformly* (lint it), framework auto-teardown (`async` pipe, `takeUntilDestroyed`, React effect cleanup), and operators that complete (`take`, `first`, `takeWhile`). The organizational fix is a lint rule banning bare `.subscribe()` without a teardown path — leaks are too easy to introduce one at a time to catch in review.

---

## Glitches and Consistency

A **glitch** is a transient, *incorrect* intermediate value that appears in a reactive graph when a single logical change reaches a node through multiple paths at different times — a momentary inconsistency before the graph settles.

The classic diamond:
```
        ┌──► b = a + 1 ──┐
a ──────┤                ├──► d = b + c
        └──► c = a * 2 ──┘
```
Suppose `a` changes from `1` to `2`. Both `b` and `c` depend on `a`, and `d` depends on both. If the runtime propagates depth-first — updates `b`, then immediately recomputes `d` *before* updating `c` — `d` briefly computes with the *new* `b` and the *old* `c`. That intermediate `d` is a **glitch**: a value that never should have existed, corresponding to no consistent state of the inputs.

```
a:  1 ─────► 2
b:  2 ─────► 3
c:  2 ─────────► 4
d:  4 ──► 5(glitch!) ──► 7   ← the 5 is wrong; correct values are 4 then 7
```

Why it matters: a glitch can fire a side effect (an analytics event, a network call, a UI flash) on a value that was *never real*. In `combineLatest`, partial updates produce exactly this — an array with some fields updated and others stale.

Mitigations:
- **Glitch-free runtimes** topologically order the graph and recompute each node *once* per change, after all its inputs settle (some FRP systems and signal libraries like SolidJS/Vue's reactivity guarantee this). RxJS does **not** — it's push-based and depth-first, so glitches are possible.
- **Operator choice:** `combineLatest` is glitch-prone on shared sources; restructuring so the shared dependency is combined *once* (or using `withLatestFrom`, or deriving from a single upstream) avoids the diamond.
- **`distinctUntilChanged`** suppresses re-emission of unchanged values, reducing spurious glitch propagation.
- **Debounce the consumer** of a glitchy graph (`auditTime(0)`) so it only acts on the settled value — a pragmatic fix when you can't restructure.

Glitches are the reactive analogue of a race condition: the *eventual* value is right, but an *observer mid-propagation* sees a lie. Whether you must care depends on whether anything observes intermediate states.

---

## Schedulers: Where and When Code Runs

A subtle senior concept: a reactive pipeline doesn't necessarily run on the thread (or event-loop tick) you wrote it on. A **scheduler** controls *when* and *on what execution context* a stream's work and emissions happen — and getting it wrong causes UI jank, surprising ordering, and tests that fail only under real timing.

The kinds you'll meet (RxJS names; Reactor's `Schedulers` are analogous):

- **Synchronous / immediate** — emit on the current call stack, right now. `of(1,2,3)` is synchronous by default; its values arrive *before* the next line runs. People are surprised that `of(...).subscribe(...)` completes entirely before the statement after it.
- **Microtask / async** (`asapScheduler`, `asyncScheduler`) — defer emissions to a later tick, so they interleave with other async work rather than blocking the current stack.
- **Animation-frame** — emit in sync with the browser's repaint, for smooth visual updates.
- **Thread-pool** (Reactor: `Schedulers.parallel()` for CPU work, `boundedElastic()` for blocking I/O) — move work off the subscribing thread onto a pool, on the JVM.

Two operators place work explicitly:
- **`observeOn(scheduler)`** — change the context for everything *downstream* of it (where the consumer runs). Use it to bounce heavy work off the UI thread, then `observeOn(animationFrame)` to render.
- **`subscribeOn(scheduler)`** — change where the *subscription and the source's producing work* happen (it affects the whole chain, regardless of position).

```ts
// Off-load a CPU-heavy transform, then render on the UI repaint cycle.
source$.pipe(
  observeOn(asapScheduler),       // get off the synchronous stack
  map(expensiveTransform),
  observeOn(animationFrameScheduler),
).subscribe(updateDom);
```

On the JVM this is *the* mechanism for the "reactive all the way down" rule (professional level): a blocking call must be pushed onto `boundedElastic()` (`subscribeOn(Schedulers.boundedElastic())`) so it doesn't pin an event-loop thread. The senior takeaway: **emission timing and threading are explicit, schedulable choices** — and a pipeline that's correct but on the wrong scheduler will stutter the UI or serialize work you meant to parallelize.

---

## A Worked Debugging Walkthrough

Concretely, how a senior tracks down "the search box sometimes shows stale results." The bug isn't in any single operator — it's *emergent*, which is exactly why reactive debugging is hard.

```ts
// The suspect pipeline.
const results$ = fromEvent(input, 'input').pipe(
  map(e => e.target.value),
  mergeMap(term => http.get(`/search?q=${term}`)),   // ← the culprit
).subscribe(render);
```

Step 1 — **instrument every stage with `tap`** to see what *actually* flows and *when*:

```ts
fromEvent(input, 'input').pipe(
  map(e => e.target.value),
  tap(t => console.log(`%c[in]  ${t} @ ${performance.now() | 0}`, 'color:blue')),
  mergeMap(term =>
    http.get(`/search?q=${term}`).pipe(
      tap(r => console.log(`%c[out] ${term} resolved @ ${performance.now() | 0}`, 'color:green')),
    )
  ),
).subscribe(render);
```

Step 2 — **read the timeline.** The logs reveal the smoking gun: `[in] cat` logs *after* `[in] ca`, but `[out] ca resolved` logs *after* `[out] cat resolved` — a later request resolving *earlier*. That's the order-inversion signature of a race, and `mergeMap` (which keeps all inner requests alive concurrently) is the only operator that permits it.

Step 3 — **form the hypothesis and confirm with a marble test**, so the fix is locked against regression:

```ts
testScheduler.run(({ cold, hot, expectObservable }) => {
  // model "ca" as a SLOW request, "cat" as a FAST one
  const slow = cold('-----c|');   // resolves at t=5
  const fast = cold('--t|');      // resolves at t=2
  // ... assert that with switchMap the slow 'ca' is cancelled
});
```

Step 4 — **fix at the right level:** `mergeMap` → `switchMap` (cancel the stale request), and add `debounceTime`/`distinctUntilChanged` upstream. The lesson the walkthrough teaches: in reactive code you debug by **making the timeline visible** (`tap` + timestamps), reasoning about *which operator's concurrency semantics* permit the observed ordering, and pinning the fix with a *marble test* — because the bug lived in the interaction between operators, not in any one of them, and a normal stack trace would never have shown it.

---

## Debugging Reactive Graphs

The honest senior truth: **reactive code is harder to debug than imperative code, and you should price that in.** The reasons are structural, not incidental:

- **Non-linear control flow.** There is no single thread of execution to step through. Values flow through a *graph* of operators on possibly many schedulers; "what runs next" isn't lexically obvious. A breakpoint in a `map` tells you little about *why* this value arrived.
- **Useless stack traces.** A stack trace through a reactive pipeline is dominated by internal library frames (`Subscriber.next`, `OperatorSubscriber`, `lift`) with your tiny lambda buried in the middle and *no record of the upstream operators* that produced the value. The async boundary erases the causal chain.
- **Lazy + deferred.** Nothing happens until subscription, and a lot happens on later ticks, so the code's *textual* order isn't its *execution* order. "Why didn't my pipeline run?" (forgot to subscribe) and "why did it run twice?" (cold, two subscribers) are constant.
- **State is implicit.** `scan`, `shareReplay`, and `Subject`s hold state that isn't a visible variable, so you can't just inspect a value — you have to reconstruct the stream's history.

The tooling that actually helps:
- **`tap` for X-ray vision:** insert `tap(v => console.log('after debounce:', v))` between operators to see what flows at each stage. This is the single most useful technique.
- **Marble testing** (`TestScheduler`): assert pipeline behavior with virtual time and marble strings — turns "it's flaky under timing" into a deterministic test.
- **Observable spy / devtools** (RxJS `tap`-based loggers, `rxjs-spy`, Reactor's `checkpoint()`/`log()` and `Hooks.onOperatorDebug()`): tag operators so traces name *which* operator in the chain failed.
- **Name your streams** (`stream$` convention, `.pipe(tap(), ...).pipe(/* @name */)`) and keep pipelines short — a 30-operator chain is undebuggable; three 10-operator pipelines composed are not.

The takeaway for design: **debuggability is a cost you pay per operator.** Long, clever, deeply-nested reactive chains optimize for write-time elegance and tax every future read and every production incident. Senior reactive code is often *less* clever than it could be, on purpose.

---

## When Reactive Wins

Reactive earns its complexity when the problem is *inherently* about coordinating multiple asynchronous, time-varying sources. The honest list:

- **Event-heavy UIs with derived state.** Autocomplete, drag-and-drop, multi-field live validation, "combine these five inputs into a query" — debounce, switch-to-latest, combine-latest are *exactly* these problems, and the imperative version is a flag-and-timer swamp.
- **Real-time streaming.** Websockets, server-sent events, live dashboards, collaborative editing — a continuous push source mapped/filtered/merged into UI or downstream is the native shape. See [System Design → Data Streaming](../../../Architecture/system-design/15-data-streaming/).
- **Coordinating multiple async sources.** "Wait for A and B, then on either's change, refetch C, but cancel C if the selection changes" — the cancellation and combination semantics are first-class operators, painful to hand-roll.
- **Server pipelines needing backpressure.** Streaming millions of DB rows through fixed memory (WebFlux, gRPC streaming) — Reactive Streams' `request(n)` is the right tool, and there's no simple imperative equivalent.
- **Cancellation-heavy work.** Anything where "a newer request obsoletes an older one" matters; `switchMap`'s built-in cancellation is hard to replicate correctly by hand.

The common thread: **multiple sources, changing over time, that must be combined and cancelled.** When you have that, reactive's implicit propagation is a genuine simplification, not just a different spelling.

---

## When Reactive Is the Wrong Tool

Equally important — and the mark of seniority — is recognizing when reactive adds cost for no benefit:

- **A single async operation.** One HTTP request that returns once? A `Promise` / `async-await` is simpler, debuggable, and universally understood. Wrapping it in an Observable to call `switchMap` once is ceremony. (Reach for Rx when there's a *stream* or *cancellation* need, not for one-shot calls.)
- **Simple, linear, synchronous logic.** A loop and an `if` are clearer than `from(arr).pipe(filter(), map())`. Reactive over a static in-memory array is pure overhead and worse stack traces.
- **A team that doesn't know Rx.** Reactive has a steep learning curve and a debuggability tax. A codebase where most engineers can't confidently read a `switchMap` will accumulate subtle bugs (wrong flattening operator, leaks). The *team's* fluency is a real engineering constraint; "the right paradigm the team can't maintain" is the wrong paradigm.
- **When `async/await` already reads well.** Sequential async steps with no concurrency or cancellation read beautifully as `await a(); await b();`. Reactive's win is *coordination*; if there's nothing to coordinate, prefer the linear syntax.
- **Over-reactive architectures.** Making *everything* a stream — config, one-time setup, request-scoped values — turns a codebase into an undebuggable web of implicit dataflow. Reactive should be a *targeted* tool for the time-varying parts, not the universal substrate.

The discipline: **reactive is a sharp tool for a specific shape (multiple, cancellable, time-varying sources combined), and a liability everywhere else.** The senior move is to keep the reactive surface small and well-bounded, and to use plain functions, promises, and loops for the large majority of code that isn't shaped like a stream.

---

## Common Mistakes

- **Ignoring backpressure until production.** Unbounded buffers (default `ReplaySubject`, naive `bufferTime`) pass tests and OOM under load. Decide the overflow policy *before* deploying.
- **Assuming RxJS does backpressure.** It largely doesn't — it expects lossy operators (`throttle`, `audit`, `sample`). True `request(n)` backpressure lives in Reactor / RxJava `Flowable` / Akka Streams.
- **`shareReplay` without `refCount`.** Leaks the source subscription forever. Use `shareReplay({ bufferSize: 1, refCount: true })`.
- **Ignoring glitches that fire side effects.** A transient wrong value triggering an analytics event or a flash is a real bug; either restructure the graph or act only on the settled value.
- **Writing 40-operator pipelines.** Undebuggable. Compose short, named pipelines; insert `tap` at stage boundaries.
- **Defaulting to reactive.** The biggest senior mistake: reaching for Rx for a single request or linear logic because it's the team's habit. Match the tool to the *shape* — most code isn't a stream.

---

## Summary

The senior reactive concerns are the ones tutorials skip. **Backpressure** — producer faster than consumer — has only four answers (buffer, drop, slow the producer, crash), and is *only fully solvable when the producer is controllable*; for uncontrollable sources (UI, sensors, market feeds) you must choose a lossy strategy (`throttle`/`sample`/`onBackpressureLatest`/bounded buffer) by asking "what does losing a value cost?" The **Reactive Streams `request(n)`** protocol gives lossless, bounded-memory flow control for controllable producers by propagating demand upstream — the backbone of Reactor, RxJava `Flowable`, and Akka Streams, and the reason RxJS (UI-focused) largely omits backpressure. **Cold/hot confusion** becomes load amplification and leaks at scale, with `shareReplay` itself a leak trap without `refCount`. **Subscription leaks** retain whole closure graphs and compound across component lifecycles into OOMs; uniform `takeUntil`/auto-teardown and lint rules are the defense. **Glitches** — transient wrong values from multi-path propagation in a diamond — are the reactive race condition, mattering whenever an intermediate state is observed or fires a side effect. **Debugging** is structurally harder (non-linear control flow, useless stack traces, implicit state, lazy/deferred execution), so debuggability is a per-operator cost — favor short, named, `tap`-instrumented pipelines. Above all, the senior skill is *judgment*: reactive **wins** for multiple, cancellable, time-varying sources that must be combined (event-heavy UIs, real-time streaming, server pipelines needing backpressure) and is the **wrong tool** for single async calls, linear synchronous logic, async work that reads fine as `await`, and teams without Rx fluency. Keep the reactive surface small and deliberate.

---

## Further Reading

- [Reactive Streams Specification](https://www.reactive-streams.org/) — the `Publisher`/`Subscriber`/`Subscription`/`Processor` contract and `request(n)`; short and worth reading in full.
- *Backpressure explained — the resisted flow of data through software* (Jay Phelps) — the clearest conceptual treatment of the four strategies.
- [Project Reactor — Backpressure & `onBackpressure*` operators](https://projectreactor.io/docs/core/release/reference/#producing) — the strategies in code, server-side.
- *RxJS: Don't Unsubscribe* (Ben Lesh) and the `takeUntil` pattern write-ups — the canonical leak-avoidance discussion.
- *Glitch-free FRP* — the diamond-problem literature (Cooper & Krishnamurthi, "Embedding Dynamic Dataflow"); explains why some runtimes guarantee no glitches and RxJS doesn't.

---

## Related Topics

- [`middle.md`](middle.md) — the operators, cold/hot basics, and flattening operators this level stress-tests.
- [`professional.md`](professional.md) — reactive *systems* (the Reactive Manifesto), end-to-end backpressure across the network, and the spec interop story.
- [`interview.md`](interview.md) — backpressure strategies, glitches, "when not to use Rx," and senior trade-off questions.
- [06 — Dataflow & Stream Programming](../06-dataflow-and-stream-programming/) — glitches and topological propagation are core dataflow concerns; deep treatment lives there.
- [11 — Event-Driven Programming](../11-event-driven-programming/) — the uncontrollable push sources that force lossy backpressure.
- [System Design → Data Streaming](../../../Architecture/system-design/15-data-streaming/) — backpressure and streaming at the infrastructure scale (Kafka, Flink).
- [Functional Programming → Laziness & Streams](../../code-craft/functional-programming/12-laziness-and-streams/) — pull-based laziness, the dual of push-based reactive.
