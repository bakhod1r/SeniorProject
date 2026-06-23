# Reactive Programming — Middle Level

> **Roadmap:** [Programming Paradigms](../README.md) → Reactive Programming
> *The junior level taught you to think in streams. The middle level is where you learn the actual machinery — Observable, Observer, Subscription — and the operators that let you compose asynchronous work without drowning in nested callbacks.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [The Three Core Types: Observable, Observer, Subscription](#the-three-core-types-observable-observer-subscription)
4. [The Observer Contract: next, error, complete](#the-observer-contract-next-error-complete)
5. [Cold vs Hot Observables](#cold-vs-hot-observables)
6. [Reading Marble Diagrams](#reading-marble-diagrams)
7. [The Operator Toolbox](#the-operator-toolbox)
8. [Flattening Operators: switchMap, mergeMap, concatMap](#flattening-operators-switchmap-mergemap-concatmap)
9. [Escaping Callback Hell](#escaping-callback-hell)
10. [Unsubscription and Resource Cleanup](#unsubscription-and-resource-cleanup)
11. [The Error Channel](#the-error-channel)
12. [Reactive Beyond Rx: Reactor, RxJava, Python](#reactive-beyond-rx-reactor-rxjava-python)
13. [Common Mistakes](#common-mistakes)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How does it actually work, and how do I compose it?**

At the junior level, a "stream" was a helpful intuition: an array spread over time, something you `map` and `filter` and `subscribe` to. That intuition is correct, but it's vague about three things you now need precise: *what exactly* is the object you subscribe to, *what exactly* gets pushed to you, and *what exactly* you get back when you subscribe so you can later stop.

This level pins those down. The object is an **Observable**, the thing receiving pushes is an **Observer**, and what `subscribe` returns is a **Subscription** — the handle you use to tear everything down. Once those three are concrete, two questions that confuse every newcomer become answerable: *does my stream replay its values for each new subscriber, or share one live source?* (cold vs hot), and *how do I compose a stream of requests where each request is itself a stream?* (the flattening operators — the single most important skill at this level, and the thing that finally kills callback hell).

> **The mindset shift:** treat an Observable as a *blueprint for a computation*, not a running thing. Subscribing instantiates the blueprint; the Subscription is your contract to clean it up. Composition happens on the blueprints, before anything runs.

---

## Prerequisites

- **Required:** The [junior level](junior.md) — streams, `subscribe`, `map`/`filter`/`merge`/`scan`, the push model.
- **Required:** Comfort with first-class functions and closures (you pass functions to operators constantly). See [First-Class & Higher-Order Functions](../../code-craft/functional-programming/01-first-class-and-higher-order-functions/junior.md).
- **Required:** You've hit "callback hell" at least once — nested callbacks for sequential async work. The pain is the motivation.
- **Helpful:** Familiarity with Promises (a Promise is a degenerate one-shot Observable; the contrast clarifies a lot).
- **Examples:** **TypeScript/RxJS** primarily, with **Java** (Project Reactor / RxJava) and **Python** (RxPY / async generators) for contrast.

---

## The Three Core Types: Observable, Observer, Subscription

Reactive libraries are built on three types. Get these crisp and the rest of the API stops being mysterious.

**Observable** — *a lazy blueprint that produces values over time.* It is a description, not a running process. Writing `const o = interval(1000)` produces no ticks; it produces an *object that knows how to* produce ticks once subscribed. This laziness is the single most important property to internalize.

**Observer** — *the consumer.* An object (or set of callbacks) with up to three methods: `next(value)` for each emitted value, `error(err)` if the stream fails, and `complete()` when it finishes. When you write `subscribe(v => ...)`, that single function becomes the `next` handler of an Observer.

**Subscription** — *the live connection,* returned by `subscribe`. It represents the running execution and exposes `unsubscribe()` to tear it down: stop the producer, run cleanup logic, release resources.

```ts
import { Observable } from 'rxjs';

// An Observable is a blueprint: a function describing how to feed an Observer.
const numbers$ = new Observable<number>(observer => {
  observer.next(1);
  observer.next(2);
  const id = setTimeout(() => {
    observer.next(3);
    observer.complete();          // signal: no more values
  }, 1000);

  // The returned teardown runs on unsubscribe OR on complete/error.
  return () => clearTimeout(id);
});

// Subscribing runs the blueprint and returns a Subscription.
const sub = numbers$.subscribe({
  next:  v   => console.log('next', v),
  error: err => console.error('error', err),
  complete:  () => console.log('done'),
});

// Later, to stop early and run the teardown:
sub.unsubscribe();
```

The relationship in one line: **an Observable, when handed an Observer, returns a Subscription and begins pushing values until it completes, errors, or is unsubscribed.** That sentence is the entire contract.

---

## The Observer Contract: next, error, complete

A stream emits along **three channels**, and exactly one of two terminal events ends it:

```
next   next   next   ...   complete        (a stream that finishes cleanly)
next   next   error                        (a stream that fails)
```

The rules the library guarantees (the *Observable contract*, formalized in the Reactive Streams spec):

- **`next`** can fire zero or more times — each carries one value.
- **`error`** fires **at most once** and is **terminal**: no `next` or `complete` follows. The stream is dead.
- **`complete`** fires **at most once** and is **terminal**: no further emissions.
- After a terminal event, the Subscription is automatically cleaned up.

This three-channel shape is what makes Observables strictly more expressive than callbacks or Promises:

| | Values | Success end | Failure end |
|---|---|---|---|
| Callback `(err, value)` | one | implicit | `err` arg |
| Promise | **one** | `resolve` | `reject` |
| **Observable** | **zero..many over time** | `complete` | `error` |

A Promise is an Observable that emits at most one value and then completes — which is why "an Observable is a Promise that can resolve many times." The extra power (many values, a distinct completion signal, lazy + cancellable) is exactly what you need for events, sockets, and intervals that a Promise can't model.

---

## Cold vs Hot Observables

This distinction trips up *everyone* once, then never again. It answers: **when does the data-producing work start, and is it shared?**

**Cold** — the Observable creates its *own* producer **per subscriber**. Each subscription gets an independent, fresh execution from the start. Think of a song *file*: every viewer presses play and watches from 0:00 on their own copy.

```ts
import { Observable } from 'rxjs';

const cold$ = new Observable<number>(observer => {
  console.log('producer started');          // runs ONCE PER SUBSCRIBE
  observer.next(Math.random());
});

cold$.subscribe(v => console.log('A', v));   // producer started; A 0.41
cold$.subscribe(v => console.log('B', v));   // producer started; B 0.93  (different value!)
```

**Hot** — the producer exists *independently* of subscribers and is **shared**. Subscribers tap into a single live source and only see values emitted *after* they join. Think of a *live broadcast*: late viewers miss the opening; everyone watching sees the same frame at the same time.

```ts
import { Subject } from 'rxjs';

const hot$ = new Subject<number>();          // a Subject is hot — one shared producer

hot$.subscribe(v => console.log('A', v));
hot$.next(1);                                // A 1
hot$.subscribe(v => console.log('B', v));    // B joins late
hot$.next(2);                                // A 2, B 2  (B missed the 1)
```

Marble view of the difference:
```
COLD (per-subscriber replay)       HOT (shared, live)
A: ──1──2──3──►                    source: ──1──2──3──4──►
B:    ──1──2──3──►  (own copy)     A:      ──1──2──3──4──►
                                   B:           ──3──4──►  (joined late)
```

| | Cold | Hot |
|---|---|---|
| Producer created | per subscription | once, independently |
| Subscribers see | full sequence from start | only emissions after they join |
| Examples | HTTP request, `of`, `range`, `interval` | DOM events, `Subject`, websocket, mouse moves |
| Risk | duplicated work (N subscribers → N HTTP calls) | missed early values; needs sharing |

The practical traps: subscribing to a cold HTTP Observable three times fires **three** requests (a common surprise — fix with `shareReplay`); subscribing late to a hot stream **misses** earlier events. You convert cold→hot with multicasting operators (`share`, `shareReplay`, `publish`). Knowing which kind you hold is a prerequisite to reasoning about *any* reactive bug.

---

## Reading Marble Diagrams

Marble diagrams are the lingua franca of reactive docs and tests. The notation:

```
──1──2──3──|        time flows right →; 1,2,3 are emitted values; | is complete
──1──2──X           X (or #) is an error — terminal, like |
──a────b───►        ► (no terminator) means the stream is still open / infinite
  ^
  subscription point
```

An operator is drawn as a transformation between an input timeline and an output timeline:

```
in:    ──1──2──3──|
            map(x => x * 10)
out:   ──10─20─30─|
```

```
in:    ──1──2──3──4──5──|
            filter(x => x % 2 === 0)
out:   ─────2─────4─────|
```

```
a:     ──1───────3──────|
b:     ─────2───────4────|
            merge(a, b)
out:   ──1──2────3──4────|
```

Reading skill to build: trace each input marble *down* through the operator and figure out **where (in time) and whether** it appears in the output. Most operator confusion — especially the flattening operators next — dissolves once you can read and *draw* the marble diagram for a given input.

---

## The Operator Toolbox

Operators are pure functions `Observable → Observable`. They're grouped by what they do. You compose them in a `pipe(...)`.

**Transformation** — change each value:
- `map(fn)` — transform each value.
- `scan(fn, seed)` — running accumulator; emits the accumulator after *each* value (the streaming `reduce`).
- `pluck('a','b')` / `map(x => x.a.b)` — extract a nested field.

**Filtering** — decide which values pass:
- `filter(pred)` — keep values passing a predicate.
- `take(n)` / `takeUntil(notifier$)` — take the first `n`, or until another stream emits.
- `distinctUntilChanged()` — drop consecutive duplicates (vital for derived state).
- `debounceTime(ms)` — emit the latest value only after a quiet gap (user stopped typing).
- `throttleTime(ms)` — emit at most once per window (rate-limit a firehose).

**Combination** — merge multiple streams:
- `merge(...)` — interleave emissions from several streams.
- `combineLatest(...)` — emit an array of the *latest* value from each input whenever any input emits (the spreadsheet pattern: output depends on several cells).
- `withLatestFrom(other$)` — on each emission, also grab the latest from `other$`.
- `concat(...)` — run streams one after another, in order.

**Utility** — observe without changing the value:
- `tap(fn)` — perform a side effect (logging, debugging) and pass the value through unchanged.

`scan` and `combineLatest` together cover most "derive a value from changing inputs" needs. `debounceTime` and `distinctUntilChanged` together cover most "react to user input sanely" needs. Learn those four well before the long tail.

---

## Flattening Operators: switchMap, mergeMap, concatMap

This is the most important — and most misused — family at this level. The problem they solve: **you have a stream, and for each value you want to start *another* stream (typically an async call), then flatten the results back into one stream.** A search box emits terms; each term triggers an HTTP request (itself a stream of one response); you want a single stream of results.

If you naively `map(term => http.get(term))`, you get an Observable *of Observables* — a stream of streams. The flattening operators subscribe to those inner streams for you and decide **what to do when a new inner stream starts while a previous one is still running.** That decision is the whole game:

| Operator | When a new value arrives while an inner stream is active | Use when |
|---|---|---|
| **`switchMap`** | **cancel** the previous inner stream, switch to the new one | latest-wins: autocomplete, live search, "load data for the current selection" |
| **`mergeMap`** | run **all** inner streams concurrently, interleave results | independent parallel work: fire N uploads at once |
| **`concatMap`** | **queue** — wait for the current inner to finish, then start the next | order matters / serialize: sequential writes, ordered animations |
| **`exhaustMap`** | **ignore** new values while an inner stream is active | drop duplicates: ignore repeated submit clicks until the first finishes |

Marble contrast (each input letter triggers a 2-tick inner stream `letter-letter`):
```
source:    ──a────b──────────►

switchMap: ──a─a──b─b─────────►   (a's second tick CANCELLED when b arrives)
mergeMap:  ──a─a──b─b─────────►   (both run; if overlapping, interleaved)
concatMap: ──a─a──b─b─────────►   (b waits for a to finish first)
```

The canonical autocomplete — **`switchMap` is correct**, because if the user types a new letter, the *previous* in-flight request is stale and should be cancelled:

```ts
import { fromEvent } from 'rxjs';
import { map, debounceTime, distinctUntilChanged, switchMap } from 'rxjs/operators';
import { ajax } from 'rxjs/ajax';

const results$ = fromEvent(input, 'input').pipe(
  map(e => (e.target as HTMLInputElement).value),
  debounceTime(300),
  distinctUntilChanged(),
  switchMap(term => ajax.getJSON(`/search?q=${term}`)),   // cancels stale requests
);
```

Using `mergeMap` here causes the classic **race condition**: a slow request for `"ca"` can resolve *after* a fast request for `"cat"`, painting stale results over fresh ones. Choosing the wrong flattening operator is the most common serious bug in reactive code — and the question every interviewer asks. The mnemonic: **switch = cancel, merge = parallel, concat = queue, exhaust = ignore.**

---

## Escaping Callback Hell

The historical motivation for reactive composition. Sequential async work in callbacks pyramids to the right and scatters error handling:

```js
// Callback hell: nested, each level repeats error handling, hard to read/cancel.
getUser(id, (err, user) => {
  if (err) return handle(err);
  getOrders(user.id, (err, orders) => {
    if (err) return handle(err);
    getShipping(orders[0].id, (err, shipping) => {
      if (err) return handle(err);
      render(shipping);
    });
  });
});
```

The same logic as a flat reactive pipeline — sequential dependency expressed with `concatMap`/`switchMap`, one error channel, cancellable:

```ts
import { of } from 'rxjs';
import { switchMap, map, catchError } from 'rxjs/operators';

getUser$(id).pipe(
  switchMap(user   => getOrders$(user.id)),
  switchMap(orders => getShipping$(orders[0].id)),
  map(shipping => render(shipping)),
  catchError(err => { handle(err); return of(null); }),   // ONE place for errors
).subscribe();
```

The pyramid flattens into a vertical pipeline you read top to bottom; error handling collapses from "at every level" to "once, at the end"; and the whole chain is **cancellable** by unsubscribing — something callbacks can't do at all. This is the practical reason reactive (and Promises, its one-shot cousin) displaced raw callbacks for async orchestration.

---

## Unsubscription and Resource Cleanup

A Subscription is a **live resource**, like an open file or socket. Forgetting to close it is the #1 reactive memory leak. A subscription to a long-lived hot source (DOM events, a websocket, `interval`) **never ends on its own** — it runs until you `unsubscribe`, holding its closure (and whatever it captured) alive forever.

```ts
// LEAK: this interval runs forever, even after the component is gone.
ngOnInit() {
  interval(1000).subscribe(n => this.tick = n);   // who stops this?
}
```

Ways to guarantee teardown, roughly in order of preference:

**1. Let the stream complete itself.** A finite stream (`http.get` emits once and completes; `take(5)` completes after 5) cleans up automatically. Prefer operators that bound the stream.

**2. `takeUntil(destroy$)` — the idiomatic pattern.** Emit on a "destroy" stream when the component dies; every pipeline ends with `takeUntil(destroy$)` and unsubscribes itself:

```ts
private destroy$ = new Subject<void>();

ngOnInit() {
  interval(1000).pipe(takeUntil(this.destroy$)).subscribe(n => this.tick = n);
}
ngOnDestroy() {
  this.destroy$.next();      // completes all pipelines wired to it
  this.destroy$.complete();
}
```

**3. Framework helpers.** Angular's `async` pipe and `takeUntilDestroyed`, React's `useEffect` cleanup return, and RxJS's `Subscription.add()` (collect children, unsubscribe the parent once) all automate teardown.

The rule to live by: **every `subscribe` must have a defined end** — either the stream completes, or something unsubscribes it. A subscribe with no end is a leak waiting to happen. (Side effects belonging in the *subscribe* vs *operators* matters too: `tap` for incidental effects mid-pipeline, the `subscribe` callback for the final consumption.)

---

## The Error Channel

Errors are not exceptions you `try/catch` around a pipeline — they travel **through the stream**, on the dedicated `error` channel, and are handled with operators.

```ts
import { of, throwError, timer } from 'rxjs';
import { catchError, retry, retryWhen, delayWhen } from 'rxjs/operators';

http.get$('/data').pipe(
  retry(3),                                 // resubscribe up to 3 times on error
  catchError(err => {                       // last resort: substitute a fallback stream
    console.error('failed:', err);
    return of([]);                          // emit a default, complete cleanly
  }),
).subscribe(data => render(data));
```

Key behaviors that surprise newcomers:

- **An error is terminal.** Once a stream errors, it's *done* — no more `next`, no `complete`. If you want it to keep going, you must *recover* (catch and return a new stream) or *retry* (resubscribe).
- **`catchError` returns a *new Observable*.** You don't return a value — you return a replacement stream (often `of(fallback)` or `EMPTY`). That stream's emissions continue downstream.
- **`retry` / `retryWhen`** resubscribe to the *source*, re-running it. For cold HTTP that means a fresh request — exactly what you want for transient failures (pair with backoff via `retryWhen` + `delayWhen`).
- **Placement matters.** `catchError` inside a `switchMap`'s inner stream recovers *that one request* without killing the outer stream; `catchError` at the outer level kills the whole pipeline on the first inner failure. For a search box you almost always want the *inner* placement, so one failed query doesn't break the box.

The mental model: an Observable has *two* exits — the happy `complete` and the unhappy `error` — and operators let you intercept, transform, and recover on the error exit just as fluidly as you `map` on the happy path.

---

## Reactive Beyond Rx: Reactor, RxJava, Python

The Observable model isn't a JavaScript thing — it's a cross-language pattern, with near-identical operators.

**Java — Project Reactor** (`Mono`/`Flux`), the backbone of Spring WebFlux:

```java
Flux.fromIterable(userIds)
    .flatMap(id -> userService.fetch(id))   // mergeMap equivalent
    .filter(User::isActive)
    .map(User::getName)
    .timeout(Duration.ofSeconds(2))
    .onErrorResume(e -> Flux.empty())        // catchError equivalent
    .subscribe(System.out::println);
```
`Mono` = 0..1 values (Promise-like); `Flux` = 0..N values. Reactor implements the **Reactive Streams** spec, so it has real backpressure (the senior level) — a thing RxJS lacks.

**Java — RxJava**: the original JVM port of Rx; `Observable`/`Flowable` (`Flowable` adds backpressure), same operator names as RxJS.

**Python**: two flavors. `RxPY` mirrors RxJS (`map`, `filter`, `subscribe`). But idiomatic modern Python often reaches for **async generators** instead — `async for value in stream:` is the language's native "values over time," covering many reactive needs without a library:

```python
async def search(terms):
    async for term in terms:                 # a stream of terms
        results = await fetch(term)          # await an inner async result
        yield results                        # emit downstream
```

The throughline: *Observable, Observer, Subscription, and the operator vocabulary are portable.* Learn them once in RxJS and you read Reactor and RxJava almost immediately; the per-language differences are mostly naming (`flatMap` vs `mergeMap`) and whether the library implements true backpressure.

---

## Common Mistakes

- **Subscribing to a cold Observable multiple times and expecting shared work.** Three subscribers to a cold HTTP request = three requests. Share it (`shareReplay`) when you mean one source.
- **Using `mergeMap` where `switchMap` is needed (or vice versa).** The autocomplete race condition. Latest-wins → `switchMap`; parallel-independent → `mergeMap`; ordered → `concatMap`. Choosing wrong is a silent correctness bug.
- **Nesting `subscribe` inside `subscribe`.** This is callback hell wearing a reactive costume — and you lose cancellation and unified error handling. Flatten with `switchMap`/`concatMap` instead.
- **Never unsubscribing from hot/infinite streams.** The classic leak. Use `takeUntil`, framework helpers, or operators that complete.
- **Treating an Observable like a value you can "read now."** It's a blueprint over time, not a current value. If you genuinely need the latest snapshot, use a `BehaviorSubject` (which holds and replays its current value) — deliberately, not by reaching in.
- **Putting side effects in `map`.** `map` should be a pure transform. Side effects go in `tap` (mid-pipeline) or the `subscribe` callback (the end). Mixing them makes pipelines unpredictable.
- **Catching errors at the wrong level.** A `catchError` at the outer level kills the whole pipeline on one inner failure; place it inside the inner stream when you want per-item recovery.

---

## Summary

The reactive machinery is three types: an **Observable** is a *lazy blueprint* that produces values over time; an **Observer** consumes them via `next`/`error`/`complete`; a **Subscription** is the live, cancellable connection `subscribe` returns. The Observer contract — many `next`s, then exactly one terminal `error` *or* `complete` — is what makes Observables strictly more capable than callbacks or Promises (which emit at most one value). The **cold vs hot** distinction governs whether each subscriber gets its own producer (cold: HTTP, `of`, `interval`) or shares one live source (hot: DOM events, `Subject`, sockets) — get it wrong and you duplicate work or miss early events. **Operators** are pure `Observable → Observable` functions grouped into transformation, filtering, combination, and utility; the four to master first are `map`, `scan`, `combineLatest`, and `debounceTime` + `distinctUntilChanged`. The crucial skill is the **flattening operators** — `switchMap` (cancel/latest-wins), `mergeMap` (parallel), `concatMap` (queue/ordered), `exhaustMap` (ignore) — which flatten a stream-of-streams and whose wrong choice causes the most common reactive bugs. Flattening operators are what turn **callback hell** into flat, cancellable, single-error-channel pipelines. Always pair every `subscribe` with a defined end (`takeUntil`, completion, framework helper) to avoid leaks, and handle failures on the dedicated **error channel** with `retry`/`catchError`, minding placement. The whole model is portable: Reactor, RxJava, and RxPY share the vocabulary.

---

## Further Reading

- [RxJS — Observable, Subject, Operators guides](https://rxjs.dev/guide/observable) — the canonical reference for the three core types and the operator catalog.
- [Learn RxJS](https://www.learnrxjs.io/) — operator-by-operator with runnable examples and marble diagrams; the best lookup site.
- *Hot vs Cold Observables* (Ben Lesh) — the clearest single explanation of multicasting.
- [Project Reactor Reference](https://projectreactor.io/docs/core/release/reference/) — the JVM perspective, including the `Mono`/`Flux` split and where backpressure enters.
- [RxMarbles](https://rxmarbles.com/) — drag-the-marbles interactive diagrams; indispensable for the flattening operators.

---

## Related Topics

- [`junior.md`](junior.md) — streams, subscribe, the spreadsheet intuition, the everyday operators.
- [`senior.md`](senior.md) — backpressure, glitches, debugging reactive graphs, when reactive is the *wrong* tool.
- [`professional.md`](professional.md) — Reactive Streams spec, reactive *systems* vs reactive *programming*, end-to-end backpressure.
- [`interview.md`](interview.md) — hot vs cold, the flattening-operator question, subscription leaks, and more, graded by level.
- [06 — Dataflow & Stream Programming](../06-dataflow-and-stream-programming/) — the dependency-graph cousin of reactive pipelines.
- [11 — Event-Driven Programming](../11-event-driven-programming/) — events and handlers, the layer reactive sits on top of.
- [Functional Programming → Laziness & Streams](../../code-craft/functional-programming/12-laziness-and-streams/) — lazy evaluation and the stream mechanics underneath operators.
- [First-Class & Higher-Order Functions](../../code-craft/functional-programming/01-first-class-and-higher-order-functions/middle.md) — operators are HOFs; the capture/closure rules apply.
