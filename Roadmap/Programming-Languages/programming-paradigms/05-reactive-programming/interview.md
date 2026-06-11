# Reactive Programming — Interview Q&A

> **Roadmap:** [Programming Paradigms](../README.md) → Reactive Programming
>
> *Reactive programming models values that **change over time** as observable streams: you declare how outputs depend on inputs, and a runtime propagates change automatically — the spreadsheet, applied to whole programs. The interview signal is whether you can keep three pairs straight: observable vs value, hot vs cold, and (the big one) reactive **programming** vs reactive **systems** — and whether you know when *not* to reach for Rx.*

A bank of 45+ questions spanning definitions, operators, cold/hot, backpressure, marble-reading, leaks, and the architecture-level distinctions — graded Junior → Staff. Each answer models the reasoning a strong candidate gives, including trade-offs and the runtime reality. Use the `<details>` toggles to self-quiz: read the question, answer out loud, then expand.

Examples are in **TypeScript/RxJS**, with **Java** (Project Reactor / RxJava) and **Python** asides where they sharpen a point.

---

## Table of Contents

1. [Fundamentals / Junior](#fundamentals--junior)
2. [Operators & Composition / Middle](#operators--composition--middle)
3. [Cold/Hot, Leaks & Errors / Middle–Senior](#coldhot-leaks--errors--middlesenior)
4. [Backpressure, Glitches & Judgment / Senior](#backpressure-glitches--judgment--senior)
5. [Reactive Systems & Architecture / Staff](#reactive-systems--architecture--staff)
6. [Marble & Code-Reading](#marble--code-reading)
7. [Curveballs](#curveballs)
8. [Rapid-Fire / One-Liners](#rapid-fire--one-liners)
9. [How to Talk About Reactive in Interviews](#how-to-talk-about-reactive-in-interviews)
10. [Summary](#summary)
11. [Related Topics](#related-topics)

---

## Fundamentals / Junior

> Definitions, the core intuition, and "why does this matter."

**Q1. What is reactive programming, in one or two sentences?**

<details><summary>Answer</summary>

Reactive programming is a declarative style where you model values that **change over time** as streams, declare how outputs **depend on** those streams, and let a runtime **propagate** changes automatically. The canonical intuition is a spreadsheet: cell `A3 = A1 + A2` declares a dependency, and changing `A1` updates `A3` with no manual recomputation. Reactive programming applies that to whole programs — UI state, network responses, sensor data.
</details>

**Q2. What's wrong with ordinary `total = price * quantity` from a reactive viewpoint?**

<details><summary>Answer</summary>

That line runs **once** and captures a *snapshot*. If `price` changes later, `total` is stale — the language threw away the *relationship* the moment it computed the product. Keeping `total` correct then becomes your manual job (recompute by hand, poll, or wire callbacks), and that duplicated relationship is where bugs breed. Reactive programming makes the dependency a first-class thing the runtime maintains, so `total` stays correct as `price` moves — like the spreadsheet cell.
</details>

**Q3. What is a stream (observable), and how does it differ from an array?**

<details><summary>Answer</summary>

A stream is a sequence of values that arrive **over time**, possibly infinitely; an array is a collection of values you have **all at once, in space**. The mental model is "a stream is an array spread out over time." Crucially, the *same* operations apply — `map`, `filter`, `merge` — the only new variable is *when* each value shows up. Clicks, keystrokes, websocket messages, and sensor readings are all streams; even a single HTTP response is a one-element stream that then completes.
</details>

**Q4. What does `subscribe` do, and why does nothing happen until you call it?**

<details><summary>Answer</summary>

`subscribe` connects an **Observer** (your callbacks) to an Observable and *starts the flow* — from then on, the stream **pushes** values to your `next` handler. Nothing happens before it because an Observable is a **lazy blueprint**, not a running process: `interval(1000)` describes ticks but produces none until subscribed. "My pipeline never ran" almost always means "I never subscribed." `subscribe` returns a **Subscription** — the handle you use to later `unsubscribe`.
</details>

**Q5. Explain "push vs pull."**

<details><summary>Answer</summary>

**Pull** (imperative): the consumer drives — you loop and *ask* for the next value when *you* want it (`for`, an iterator's `next()`). **Push** (reactive): the producer drives — the source *hands* you values when *they* are ready, and you've pre-declared what to do with each. A button click is push: you don't poll "was it clicked?"; the click stream pushes the event to your handler. Reactive is fundamentally a push model, which is why it fits event sources you don't control.
</details>

**Q6. How does reactive relate to the Observer pattern?**

<details><summary>Answer</summary>

Reactive programming generalizes the Gang-of-Four **Observer pattern** — "subscribers register interest; the subject notifies them on change" — into a *first-class, composable value*. The leap is that an Observable isn't just a subject you attach listeners to: you can `map`, `filter`, and combine it *before* subscribing, building a whole transformation pipeline that reacts as a unit, with a defined error and completion protocol. Observer is the seed; Observables add composition, lazy evaluation, cancellation, and a formal contract.
</details>

**Q7. Give a concrete example where reactive clearly beats imperative.**

<details><summary>Answer</summary>

Search-as-you-type. Imperatively you juggle a debounce timer, a flag for "still typing," empty-string checks scattered around, and manual cancellation of stale requests. Reactively it's one declarative pipeline: `fromEvent(input,'input').pipe(map(value), debounceTime(300), distinctUntilChanged(), filter(nonEmpty), switchMap(http.get))`. Each concern is one line, `switchMap` auto-cancels stale requests, and there's no mutable flag state. The win scales with how many time-varying concerns you're coordinating.
</details>

**Q8. Is reactive programming the same as asynchronous programming?**

<details><summary>Answer</summary>

No. Reactive is about **declaring dependencies between values that change over time** and propagating changes; async is about **not blocking** while waiting. They overlap heavily (most reactive sources are async events) but neither implies the other: you can have synchronous streams (`of(1,2,3)` emits synchronously), and you can do async without reactive (`async/await`). Treating "reactive" as a synonym for "async magic" is a classic junior tell.
</details>

---

## Operators & Composition / Middle

> The toolbox, the flattening operators, and escaping callback hell.

**Q9. Name the operator families and one example of each.**

<details><summary>Answer</summary>

- **Transformation** — change each value: `map`, `scan` (running accumulator), `pluck`.
- **Filtering** — decide which values pass: `filter`, `take`, `debounceTime`, `distinctUntilChanged`, `throttleTime`.
- **Combination** — merge multiple streams: `merge`, `combineLatest`, `withLatestFrom`, `concat`.
- **Flattening** (stream-of-streams) — `switchMap`, `mergeMap`, `concatMap`, `exhaustMap`.
- **Utility / side-effect** — `tap` (do a side effect, pass value through).
- **Error** — `catchError`, `retry`.

Operators are pure functions `Observable → Observable`, composed in a `pipe(...)`.
</details>

**Q10. What is `scan`, and how does it differ from `reduce`?**

<details><summary>Answer</summary>

`scan(fn, seed)` is a **running accumulator**: it threads an accumulator through the stream and emits the accumulator **after every value**. `reduce` emits **only once, at completion**, the final accumulator. So `scan` on a click stream gives a live running count (emits 1, 2, 3, …); `reduce` would give a single total only when the stream completes — useless for an infinite stream. `scan` is the streaming workhorse for derived running state.
</details>

**Q11. The big one: `switchMap` vs `mergeMap` vs `concatMap` vs `exhaustMap`.**

<details><summary>Answer</summary>

All four flatten a *stream of streams* (for each outer value, start an inner stream — usually an async call). They differ in **what happens when a new outer value arrives while an inner stream is still active**:

- **`switchMap`** — **cancel** the previous inner, switch to the new. Latest-wins. → autocomplete, live search, "load data for current selection."
- **`mergeMap`** (a.k.a. `flatMap`) — run **all** inners **concurrently**, interleave results. → independent parallel work (fire N uploads).
- **`concatMap`** — **queue**: finish the current inner before starting the next. Preserves order. → sequential writes, ordered effects.
- **`exhaustMap`** — **ignore** new outer values while an inner is active. → drop duplicate submit clicks until the first finishes.

Mnemonic: **switch = cancel, merge = parallel, concat = queue, exhaust = ignore.**
</details>

**Q12. Why is `switchMap` correct for autocomplete and `mergeMap` a bug?**

<details><summary>Answer</summary>

With `switchMap`, typing a new letter **cancels the previous in-flight request** — stale results never arrive. With `mergeMap`, all requests run concurrently, so a *slow* request for `"ca"` can resolve *after* a *fast* request for `"cat"`, painting stale results over fresh ones — a **race condition**. This is the single most common serious reactive bug and the most-asked operator question. Autocomplete wants latest-wins → `switchMap`.
</details>

**Q13. How does reactive solve callback hell?**

<details><summary>Answer</summary>

Nested callbacks pyramid to the right and repeat error handling at every level. A reactive pipeline flattens sequential async dependencies into a vertical chain — `getUser$(id).pipe(switchMap(u => getOrders$(u.id)), switchMap(o => getShipping$(o[0].id)), catchError(handle))` — read top to bottom, with **one** error channel (`catchError`) instead of an `if (err)` at every level, and the whole chain is **cancellable** by unsubscribing (callbacks can't be cancelled). This is why Promises and Observables displaced raw callbacks for async orchestration.
</details>

**Q14. What's the anti-pattern of nesting `subscribe` inside `subscribe`?**

<details><summary>Answer</summary>

It's callback hell in a reactive costume. Subscribing inside a subscribe (to run a second async step after the first) loses unified error handling, loses cancellation of the inner work, and leaks subscriptions. The fix is a **flattening operator**: `switchMap`/`concatMap`/`mergeMap` to chain the inner stream into the pipeline, so it composes, cancels, and errors as one unit. Nested `subscribe` is an instant code-review red flag.
</details>

**Q15. What's the difference between `merge`, `concat`, and `combineLatest`?**

<details><summary>Answer</summary>

- **`merge`** — subscribe to all inputs at once, interleave emissions as they come.
- **`concat`** — subscribe in order: fully consume the first stream (until it completes), then the next. Order-preserving, sequential.
- **`combineLatest`** — emit an **array of the latest value from each input** whenever *any* input emits (after all have emitted once). This is the spreadsheet pattern: "output depends on the current value of several cells." Beware: it's glitch-prone on shared upstreams and partial-update flickers.
</details>

---

## Cold/Hot, Leaks & Errors / Middle–Senior

> The distinctions that cause real bugs.

**Q16. Cold vs hot observables — define and contrast.**

<details><summary>Answer</summary>

**Cold**: the Observable creates its **own producer per subscriber** — each subscription gets an independent execution from the start (a song *file*: everyone plays from 0:00 on their own copy). Examples: HTTP requests, `of`, `interval`. **Hot**: the producer exists **independently and is shared** — subscribers tap one live source and see only emissions *after* they join (a *live broadcast*: latecomers miss the opening). Examples: DOM events, `Subject`, websockets. The practical consequence: cold + multiple subscribers = duplicated work; hot + late subscriber = missed values.
</details>

**Q17. You subscribe to an HTTP Observable three times. How many requests fire?**

<details><summary>Answer</summary>

**Three** — an HTTP Observable is **cold**, so each subscription triggers its own request. This surprises people and amplifies backend load (a dashboard with N widgets sharing a "cold" call makes N requests). The fix is to **multicast** with `shareReplay({ bufferSize: 1, refCount: true })`, which executes the source once and replays the result to all subscribers. (Plain `shareReplay(1)` without `refCount` leaks the source subscription forever — a common trap.)
</details>

**Q18. How do you make a hot stream's latecomers see the current value?**

<details><summary>Answer</summary>

Use a **`BehaviorSubject`** (holds and replays its *current* value to new subscribers — ideal for state) or a **`ReplaySubject(n)`** (replays the last `n`). A plain `Subject` is hot with no replay, so latecomers miss everything before they joined. Caution: `ReplaySubject` with an unbounded buffer is itself a memory leak in disguise (an unbounded buffer) — bound it.
</details>

**Q19. What is a subscription leak, and how do you prevent it?**

<details><summary>Answer</summary>

A Subscription is a **live resource**. A subscription to a hot/infinite source (DOM events, `interval`, websocket) **never ends on its own** — it runs until you `unsubscribe`, holding its handler's closure (and everything it captured, including the component) alive. Forgetting to unsubscribe in a component created/destroyed thousands of times accumulates live subscriptions and OOMs. Prevent it by ensuring **every `subscribe` has a defined end**: let the stream complete (`take`, `first`), use `takeUntil(destroy$)`, or rely on framework teardown (Angular `async` pipe / `takeUntilDestroyed`, React effect cleanup). Lint bare `.subscribe()`.
</details>

**Q20. How do errors work in Observables — and why isn't it `try/catch`?**

<details><summary>Answer</summary>

Errors travel **through the stream** on a dedicated **error channel**, not as thrown exceptions you wrap. An `error` is **terminal**: it fires at most once, and after it there are no more `next` or `complete` — the stream is dead. You handle it with operators: `catchError(err => fallback$)` returns a *replacement Observable* (e.g., `of([])` or `EMPTY`) to recover, and `retry(n)`/`retryWhen` *resubscribe* to re-run the source (for transient failures, ideally with backoff). **Placement matters**: `catchError` inside a `switchMap`'s inner stream recovers one request without killing the box; at the outer level, one failure kills the whole pipeline.
</details>

**Q21. A Promise vs an Observable — when does the difference matter?**

<details><summary>Answer</summary>

A Promise emits **at most one value**, is **eager** (starts immediately), and is **not cancellable**. An Observable emits **0..N values over time**, is **lazy** (nothing until subscribe), is **cancellable** (unsubscribe), and has a distinct `complete` signal. Use a Promise / `async-await` for a single async result — it's simpler and universally understood. Reach for an Observable when there's a *stream* of values, a need for *cancellation* (switch-to-latest), or *time operators* (debounce, throttle). Wrapping a one-shot call in an Observable just to call `switchMap` once is ceremony.
</details>

---

## Backpressure, Glitches & Judgment / Senior

> What breaks at scale, and when not to use reactive.

**Q22. What is backpressure?**

<details><summary>Answer</summary>

Backpressure is the problem of a **producer emitting faster than the consumer can consume**. There are only four physically possible responses: **buffer** the excess (risks unbounded memory / OOM), **drop** values (loses data), **slow the producer** (only if it's controllable), or **crash** (the default if ignored). Every backpressure strategy is one of these four. It's invisible until production rates diverge from consumption rates, which is why it surfaces as an under-load incident, not a test failure.
</details>

**Q23. When is backpressure actually solvable?**

<details><summary>Answer</summary>

Only when the **producer is controllable** — it can be told to slow down. A DB cursor, a file, a paginated API can wait for demand. An **uncontrollable** push source — mouse moves, sensor data, market feeds, another team's Kafka topic — *cannot* be slowed, so your only options there are buffer (bounded), drop, or sample. This is why RxJS (built for UI events, uncontrollable) largely omits backpressure and offers lossy operators, while Project Reactor / RxJava `Flowable` / Akka Streams (built for server data, often controllable) implement true `request(n)` backpressure.
</details>

**Q24. Explain the Reactive Streams `request(n)` protocol.**

<details><summary>Answer</summary>

It's pull-on-top-of-push flow control. The `Subscriber` receives a `Subscription` and calls `subscription.request(n)` to signal "I can handle `n` more items." The `Publisher` is **forbidden** from emitting more than the total requested. That demand signal **propagates upstream**, naturally slowing a controllable producer (a cursor fetches the next page only when demand arrives) — giving **lossless, bounded-memory** flow control. It's the four-interface contract (`Publisher`/`Subscriber`/`Subscription`/`Processor`) behind Reactor, RxJava `Flowable`, and Akka Streams, adopted into the JDK as `java.util.concurrent.Flow`.
</details>

**Q25. Producer is an uncontrollable firehose; you can't keep up. What do you do?**

<details><summary>Answer</summary>

You can't slow it, so you choose a **lossy or batching strategy by asking "what does losing a value cost?"** For a live gauge where only the current value matters → keep latest (`onBackpressureLatest`, `auditTime`). For telemetry → `sampleTime`/`throttleTime` to a sustainable cadence. For batchable work → `bufferTime`/`bufferCount` then bulk-process. For data you *cannot* lose (financial events) → a **bounded** buffer with an explicit overflow policy, or push the buffering to a durable broker (Kafka) and manage it as consumer lag. The wrong default is an *unbounded* buffer: fine in tests, OOM under peak load.
</details>

**Q26. What is a glitch in a reactive graph?**

<details><summary>Answer</summary>

A **glitch** is a transient, *incorrect* intermediate value that appears when one logical change reaches a node through **multiple paths at different times**. Classic diamond: `b = a+1` and `c = a*2`, and `d = b+c`. If `a` changes and the runtime updates `b` then recomputes `d` *before* updating `c`, `d` briefly mixes the new `b` with the *old* `c` — a value that corresponds to no consistent input state. It matters when something *observes* that intermediate value or fires a side effect (analytics, a UI flash) on it. RxJS is push/depth-first and **can** glitch; glitch-free runtimes (some FRP/signal systems) topologically order and recompute each node once after its inputs settle. Mitigations: restructure to avoid the diamond, `distinctUntilChanged`, or act only on the settled value.
</details>

**Q27. Why is reactive code hard to debug?**

<details><summary>Answer</summary>

Structurally, not incidentally: (1) **non-linear control flow** — values flow through a *graph* on possibly many schedulers, so there's no single thread to step through; (2) **useless stack traces** — dominated by internal library frames with no record of which upstream operators produced the value; (3) **lazy + deferred** — execution order ≠ textual order, so "didn't run" (forgot subscribe) and "ran twice" (cold, two subs) are constant; (4) **implicit state** in `scan`/`shareReplay`/`Subject`s. The practical tools: `tap` between operators for X-ray vision, marble testing with `TestScheduler`, and Reactor's `checkpoint()`/`log()`. The design lesson: debuggability is a **per-operator cost** — keep pipelines short and named.
</details>

**Q28. When does reactive *win*?**

<details><summary>Answer</summary>

When the problem is inherently **multiple, cancellable, time-varying sources that must be combined**: event-heavy UIs with derived state (autocomplete, multi-field live validation, drag-and-drop), real-time streaming (websockets, live dashboards, collaborative editing), coordinating several async sources with cancellation, and server pipelines needing genuine backpressure (streaming millions of rows through fixed memory). In those shapes, reactive's implicit propagation, first-class cancellation (`switchMap`), and combination operators are a real simplification over a flag-and-timer imperative swamp.
</details>

**Q29. When should you *not* use reactive?**

<details><summary>Answer</summary>

- **A single async call** → `Promise`/`async-await` is simpler and debuggable; don't wrap it just to `switchMap` once.
- **Linear synchronous logic** → a loop and an `if` beat `from(arr).pipe(filter, map)`; reactive over a static array is pure overhead.
- **Async that reads fine as `await a(); await b();`** → reactive's win is *coordination*; with nothing to coordinate, prefer linear syntax.
- **A team without Rx fluency** → the learning curve and debuggability tax mean subtle bugs (wrong flattening operator, leaks). Team fluency is a real constraint.
- **CPU-bound or low-concurrency work** → the machinery is overhead; thread-per-request (now virtual threads) is simpler and often faster.

The discipline: keep the reactive surface *small and deliberate*; use plain functions, promises, and loops for the majority of code that isn't shaped like a stream.
</details>

---

## Reactive Systems & Architecture / Staff

> The distinction that separates senior from staff.

**Q30. Reactive *programming* vs reactive *systems* — the key distinction.**

<details><summary>Answer</summary>

**Reactive programming** is a *code model*: observables/operators reacting to changing values **within one process** — a technique like recursion. **Reactive systems** are an *architecture*: distributed, loosely-coupled components communicating via **asynchronous message-passing** to stay **responsive under failure and load** — defined by the Reactive Manifesto, scope is the whole application. You can have either without the other: a RxJS monolith is reactive programming, not a reactive system; an Erlang/OTP mesh of imperative services is a reactive system without reactive programming. Reactive programming is a convenient *tactic* for building reactive-system components, not a requirement. Conflating them ("we use RxJS, so we're a reactive system") is the classic staff-level tell.
</details>

**Q31. What are the four traits of the Reactive Manifesto, and how do they relate?**

<details><summary>Answer</summary>

**Responsive** is the *goal* — timely, predictable response. It's protected under stress by being **Resilient** (responsive *under failure*, via isolation, replication, containment, delegation — bulkheading so one failure doesn't cascade) and **Elastic** (responsive *under varying load*, scaling out/in with no central bottleneck). Both rest on **Message-Driven** — asynchronous message-passing — which is the *foundation*: it decouples components in time and space, establishes isolation boundaries, enables location transparency and elasticity, and is where backpressure lives at the system level. In short: message-driven is the substrate, resilient + elastic are what it buys, responsive is the point. Notably, the Manifesto never mentions observables.
</details>

**Q32. Why is the Reactive Streams spec important *beyond* backpressure?**

<details><summary>Answer</summary>

As an **interop contract**. It's a deliberately minimal four-interface standard (no operators, not a library) that any compliant implementation honors — so a Reactor `Flux`, an RxJava `Flowable`, and an Akka `Source` can compose **with `request(n)` backpressure preserved across library boundaries**, no glue buffer needed. Adopted into the JDK as `java.util.concurrent.Flow` (Java 9), it's the backbone of Spring WebFlux, R2DBC, reactive Kafka, and gRPC bindings — letting a request flow demand-driven from a DB cursor to an HTTP client through heterogeneous libraries. Without the standard, every bridge would need a buffer, an overflow policy, and a potential leak.
</details>

**Q33. What does "reactive all the way down" mean, and why does it matter?**

<details><summary>Answer</summary>

Reactive's benefit — serving many concurrent connections on a small thread pool via non-blocking I/O — is **destroyed by a single blocking call**. A reactive web layer (WebFlux) calling a *blocking* JDBC driver pins a thread waiting, collapsing the throughput model. So every boundary must be non-blocking: reactive web (WebFlux), reactive DB (R2DBC), reactive HTTP client (WebClient), reactive messaging. A half-reactive service (reactive web over blocking DB) has *both* models' costs and *neither's* benefit. You either go non-blocking end to end or isolate the blocking call on a bounded elastic scheduler (giving up the advantage for that call). This makes reactive adoption tend toward all-or-nothing along a request path.
</details>

**Q34. Does in-process backpressure survive crossing the network?**

<details><summary>Answer</summary>

Only if every hop encodes it. In-process `request(n)` is a method call; across the network "send n more" is a message that takes time. **TCP flow control** (the receive window) is the byte-level floor. **HTTP/2 and gRPC** carry per-stream flow control (`WINDOW_UPDATE`), mapped to `request(n)` — so a slow gRPC client genuinely slows a streaming server. **SSE and WebSockets** are weaker (SSE relies on TCP only; WebSocket backpressure is manual via `bufferedAmount`). **Message brokers** (Kafka/RabbitMQ) convert backpressure into **consumer lag / queue depth** — managed by consumer-group scaling and lag-based autoscaling, with a durable external buffer. End-to-end backpressure requires *every* hop (driver → service → transport → broker) to honor demand or expose lag; the instant one is unaware, you fall back to buffering or dropping there.
</details>

**Q35. How does reactive relate to dataflow and event-driven programming?**

<details><summary>Answer</summary>

**Event-driven** is the *substrate*: an event loop, events, handlers/callbacks. **Reactive** is a higher-level structuring on top — it takes raw event-driven callbacks and adds composition (operators), a unified error channel, and cancellation ("event-driven with first-class, composable, cancellable streams"). **Dataflow** is the close cousin that centers the *graph of data dependencies* and topology/throughput (FBP, Flink, build DAGs); a reactive pipeline *is* a dataflow graph, and the glitch/topological-ordering concerns are fundamentally *dataflow* concerns. Rule of thumb: "observable/subscribe/operator" → reactive; "nodes/edges/schedule the graph" → dataflow; "event loop/handlers" → event-driven (the layer beneath).
</details>

**Q36. How do virtual threads (Project Loom) change the case for reactive?**

<details><summary>Answer</summary>

Significantly. Reactive's headline benefit was high-concurrency, I/O-bound scalability *without* a thread per request — at the cost of a steep learning curve and a permanent debuggability tax. **Virtual threads** (JDK 21) deliver much of that concurrency benefit while letting you write **straightforward blocking-style code** that's easy to debug (normal stack traces, normal control flow). This shrinks reactive's worthwhile niche: for ordinary high-concurrency request/response services, virtual threads now offer reactive-like scalability with far less complexity. Reactive remains compelling for *genuinely stream-shaped* work (real-time, multi-source coordination) and *backpressure-critical* pipelines — but "use reactive for scalability" is a much weaker argument post-Loom.
</details>

---

## Marble & Code-Reading

> You're shown a diagram or snippet; say what happens.

**Q37. Read this marble diagram. What does the output emit?**

```
source:  ──1──2──3──4──5──|
              filter(x => x % 2 === 1)
              map(x => x * 10)
out:     ?
```

<details><summary>Answer</summary>

`──10────30────50──|`. `filter(odd)` keeps `1, 3, 5` (dropping `2, 4`); `map(*10)` turns them into `10, 30, 50`; the `|` (complete) passes through. The values keep their original *timing* — filtering removes marbles but doesn't shift the survivors earlier. Reading marbles is exactly this: trace each input marble down through each operator and decide *whether* and *when* it appears.
</details>

**Q38. RxJS — how many HTTP requests, and why?**

```ts
const data$ = http.get('/api/data');   // cold
data$.subscribe(renderA);
data$.subscribe(renderB);
data$.subscribe(logToAnalytics);
```

<details><summary>Answer</summary>

**Three** requests. `http.get` is a **cold** Observable, so each `subscribe` runs an independent execution. To fire **one** request shared by all three, multicast: `const shared$ = http.get('/api/data').pipe(shareReplay({ bufferSize: 1, refCount: true }))`, then subscribe `shared$` three times. This is the cold-duplication trap that amplifies backend load on dashboards.
</details>

**Q39. RxJS — spot the bug.**

```ts
fromEvent(input, 'input').pipe(
  map(e => e.target.value),
  mergeMap(term => http.get(`/search?q=${term}`)),
).subscribe(showResults);
```

<details><summary>Answer</summary>

`mergeMap` lets all in-flight requests run concurrently, so a **slow earlier request can resolve after a fast later one** — stale results overwrite fresh ones (a race condition). For latest-wins autocomplete, use **`switchMap`**, which cancels the previous request when a new term arrives. Also missing for production quality: `debounceTime(300)` (don't fire per keystroke) and `distinctUntilChanged()` (skip duplicate terms). The core fix is `mergeMap` → `switchMap`.
</details>

**Q40. RxJS — does this leak? What's the fix?**

```ts
ngOnInit() {
  interval(1000).subscribe(n => this.count = n);
}
```

<details><summary>Answer</summary>

**Yes** — `interval` is infinite; this subscription **never ends**, so when the component is destroyed the subscription (and its closure capturing `this`, hence the whole component) stays alive — a leak that compounds if the component is recreated. Fix with a teardown path: `interval(1000).pipe(takeUntil(this.destroy$)).subscribe(...)` where `destroy$` emits in `ngOnDestroy`; or use the `async` pipe / `takeUntilDestroyed`. The rule: every `subscribe` needs a defined end.
</details>

**Q41. What does `scan` emit here?**

```ts
of('a', 'b', 'c').pipe(
  scan((acc, x) => acc + x, '')
).subscribe(console.log);
```

<details><summary>Answer</summary>

`a`, then `ab`, then `abc` — three emissions, one after each input, because `scan` emits the **running** accumulator. (If it were `reduce`, it would emit only `abc` once, at completion.) This is why `scan` is the tool for live derived state and `reduce` is for a single final fold of a finite stream.
</details>

---

## Curveballs

> Designed to catch glib answers.

**Q42. "Reactive programming is just the Observer pattern." Agree?**

<details><summary>Answer</summary>

Partly — Observer is the *seed*, but the claim undersells the difference. Observer is "attach listeners to a subject; get notified on change." Reactive programming makes the stream a **first-class, composable value**: you can `map`/`filter`/`combine`/`switchMap` it into new streams *before subscribing*, it's **lazy** (nothing runs until subscribe), **cancellable**, and governed by a formal **contract** (many `next`, one terminal `error`/`complete`) with a dedicated error channel and backpressure. Observer gives you notification; reactive gives you an algebra of streams. So: built on Observer, but far more than it.
</details>

**Q43. "We should make the whole codebase reactive." React.**

<details><summary>Answer</summary>

Push back. Reactive is a *targeted* tool for the time-varying, multi-source, cancellable parts of a system — not a universal substrate. Making *everything* a stream (config, one-time setup, request-scoped values, simple CRUD) turns the codebase into an undebuggable web of implicit dataflow, with the per-operator debuggability tax applied everywhere and a steep onboarding wall for the team. The right posture is a **small, well-bounded reactive surface** (the genuinely stream-shaped parts) with plain functions, promises, and loops — increasingly on virtual threads — for the large majority. "The right paradigm the team can't maintain is the wrong paradigm."
</details>

**Q44. Is an Observable lazy or eager? Why does it matter?**

<details><summary>Answer</summary>

**Lazy** — it's a blueprint that does nothing until subscribed (unlike a Promise, which is eager and starts on creation). This matters three ways: (1) you can build and compose pipelines with *zero* side effects until you decide to run them; (2) **cold** Observables re-execute per subscriber (the duplication trap), because each subscribe re-runs the lazy blueprint; (3) "my stream didn't fire" is usually a missing subscribe. Laziness is what makes Observables composable and cancellable — but it's also the source of the cold-duplication and "forgot to subscribe" surprises.
</details>

**Q45. If you `catchError` and return a value, what actually happens to the stream?**

<details><summary>Answer</summary>

You don't return a *value* — `catchError` must return a **new Observable** that *replaces* the errored stream from that point. Whatever that replacement emits flows downstream, and when it completes, the pipeline completes. So `catchError(() => of([]))` emits `[]` then completes cleanly; `catchError(() => EMPTY)` emits nothing and completes; `catchError(err => throwError(() => err))` re-raises. The subtlety people miss: after `catchError`, the *original* source is gone (errors are terminal) — you're now consuming the replacement. To keep retrying the original instead, use `retry`/`retryWhen`, which *resubscribe* to the source.
</details>

**Q46. Does using lots of operators make code "more reactive" or better?**

<details><summary>Answer</summary>

Neither follows. Operator count is the wrong metric — a 40-operator pipeline is *less* maintainable (undebuggable, opaque stack traces) than three short named ones. And "more reactive" isn't a goal: reactive is valuable only where the problem is shaped like a stream. Cramming synchronous logic through `from(arr).pipe(...)`, or wrapping one-shot calls in observables, is *worse* code wearing reactive syntax. The senior stance mirrors the HOF one: reach for an operator because it expresses the *intent* better here, and reach for a plain loop/`await` when *that* is clearer.
</details>

---

## Rapid-Fire / One-Liners

> Crisp answers; what an interviewer wants in one or two sentences.

**Q47. Reactive programming in one line?**

<details><summary>Answer</summary>

Declare how outputs depend on values that change over time, and let a runtime propagate changes — a spreadsheet for your whole program.
</details>

**Q48. Hot vs cold in one line each?**

<details><summary>Answer</summary>

Cold = own producer per subscriber, replays from the start (HTTP, `of`). Hot = one shared producer, latecomers miss earlier values (DOM events, `Subject`).
</details>

**Q49. switchMap vs mergeMap vs concatMap vs exhaustMap?**

<details><summary>Answer</summary>

switch = cancel previous, merge = run all in parallel, concat = queue in order, exhaust = ignore new while busy.
</details>

**Q50. The four backpressure responses?**

<details><summary>Answer</summary>

Buffer, drop, slow the producer (only if controllable), or crash.
</details>

**Q51. One-line: reactive programming vs reactive systems?**

<details><summary>Answer</summary>

Reactive *programming* = observables in your code; reactive *systems* = a message-driven distributed architecture that stays responsive under failure and load.
</details>

**Q52. The four Reactive Manifesto traits?**

<details><summary>Answer</summary>

Responsive (goal), resilient + elastic (the properties), message-driven (the foundation).
</details>

**Q53. Why does nothing happen until you subscribe?**

<details><summary>Answer</summary>

An Observable is a lazy blueprint; `subscribe` runs it and starts the push.
</details>

**Q54. One reason a subscription leaks?**

<details><summary>Answer</summary>

A subscription to an infinite/hot source (`interval`, DOM events) never ends on its own and pins its closure; you forgot to unsubscribe.
</details>

**Q55. Is RxJS backpressure-aware?**

<details><summary>Answer</summary>

Largely no — it offers lossy operators (`throttle`/`sample`/`audit`). True `request(n)` backpressure lives in Reactor / RxJava `Flowable` / Akka Streams.
</details>

**Q56. When prefer a Promise over an Observable?**

<details><summary>Answer</summary>

A single async result with no cancellation or time-handling — `async/await` is simpler and more readable.
</details>

---

## How to Talk About Reactive in Interviews

A few habits separate a strong answer from a textbook recital:

- **Lead with the spreadsheet.** Anchoring "values that change over time → runtime propagates change" in the spreadsheet shows you understand the *why*, not just the API. It's the fastest way to demonstrate real intuition.
- **Keep the three pairs crisp.** Observable (a blueprint over time) vs a value; **hot** (shared) vs **cold** (per-subscriber); reactive **programming** (code) vs reactive **systems** (architecture). Mixing any of these is a calibration tell; nailing them is quick credibility.
- **Nail the flattening operators.** "switch = cancel, merge = parallel, concat = queue, exhaust = ignore," plus *why `switchMap` is the autocomplete answer* (the race condition). This is the most-asked operator question; a confident answer signals real Rx experience.
- **Name the trade-off, refuse the purism.** Reactive expresses time-varying coordination beautifully *and* taxes debuggability and onboarding. "It depends, and here's on what" — single async → Promise, linear logic → loop, high-concurrency stream → reactive — beats "reactive everything."
- **Separate programming from systems on demand.** When asked about *resilience/scalability*, don't answer with RxJS. Reach for the Reactive Manifesto (message-driven → resilient/elastic → responsive) and note reactive programming is just one implementation tactic.
- **Go deep when invited.** `request(n)` and the Reactive Streams interop contract, glitches and topological ordering, `shareReplay` refCount leaks, end-to-end backpressure across HTTP/2 vs SSE, and the Loom impact — these show you know what runs under the abstraction.
- **Show judgment.** The strongest signal is knowing *when not to use it*. Volunteering "I'd use a Promise here, not an Observable" unprompted reads as senior; defaulting everything to Rx reads as junior-with-a-favorite-hammer.

---

## Summary

- **Reactive programming** models values that *change over time* as observable **streams**, lets you *declare* how outputs depend on inputs, and relies on a runtime to *propagate* changes — the spreadsheet applied to whole programs. A stream is "an array spread over time"; nothing flows until you **subscribe** (lazy blueprint), and `subscribe` returns a cancellable **Subscription**.
- The **junior** bar is the spreadsheet intuition, streams vs arrays, push vs pull, and subscribe. The **middle** bar is the operator toolbox and especially the **flattening operators** — *switch = cancel (autocomplete), merge = parallel, concat = queue, exhaust = ignore* — plus cold vs hot, the error channel, and subscription leaks. The **senior** bar is **backpressure** (four responses; solvable only for controllable producers; `request(n)` for lossless flow), **glitches**, the **debuggability tax**, and the *judgment* of when reactive wins vs is overkill. The **staff** bar is **reactive programming vs reactive systems**, the **Reactive Manifesto**, the **Reactive Streams interop contract**, "reactive all the way down," **end-to-end backpressure** across the network, and the **virtual-threads** shift.
- The strongest answers **lead with mechanism and intuition** (spreadsheet, "captures change over time"), **keep the three pairs straight** (observable/value, hot/cold, programming/systems), **name trade-offs**, and **refuse purism** — a Promise for one call, a loop for linear logic, reactive for genuinely stream-shaped, multi-source, cancellable, high-concurrency work.

---

## Related Topics

- [`junior.md`](junior.md) — the spreadsheet intuition, streams, subscribe, and the everyday operators.
- [`middle.md`](middle.md) — Observable/Observer/Subscription, hot vs cold, the operator toolbox, flattening operators, leaks, the error channel.
- [`senior.md`](senior.md) — backpressure strategies, the `request(n)` protocol, glitches, debugging reactive graphs, and when *not* to use Rx.
- [`professional.md`](professional.md) — reactive programming vs reactive systems, the Manifesto, end-to-end backpressure, and the implementation landscape.
- [Programming Paradigms](../README.md) — the paradigm overview and section map.
- [06 — Dataflow & Stream Programming](../06-dataflow-and-stream-programming/) — the dependency-graph paradigm reactive overlaps; glitch/topology mechanics.
- [11 — Event-Driven Programming](../11-event-driven-programming/) — the event-loop substrate reactive is built on.
- [Functional Programming → Laziness & Streams](../../code-craft/functional-programming/12-laziness-and-streams/) — pull-lazy streams, the dual of push-reactive.
- [System Design → Data Streaming](../../../Architecture/system-design/15-data-streaming/) — infrastructure-scale streaming and backpressure.
