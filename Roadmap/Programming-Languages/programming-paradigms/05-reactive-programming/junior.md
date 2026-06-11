# Reactive Programming — Junior Level

> **Roadmap:** [Programming Paradigms](../README.md) → Reactive Programming
> *A spreadsheet doesn't ask you to re-run anything. You change one cell, and every cell that depends on it updates by itself. Reactive programming is that idea, applied to whole programs.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Values That Change Over Time](#core-concept-1--values-that-change-over-time)
5. [Core Concept 2 — Events as Streams](#core-concept-2--events-as-streams)
6. [Core Concept 3 — Subscribe, and Let Change Propagate](#core-concept-3--subscribe-and-let-change-propagate)
7. [Core Concept 4 — Transforming Streams with Operators](#core-concept-4--transforming-streams-with-operators)
8. [The Same Problem, Imperative vs Reactive](#the-same-problem-imperative-vs-reactive)
9. [Real-World Examples](#real-world-examples)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What is it, and why does it matter?**

Open a spreadsheet. Put `10` in cell A1, `20` in A2, and `=A1+A2` in A3. A3 shows `30`. Now change A1 to `15`. You didn't press a "recompute" button, you didn't write a loop, you didn't re-call anything — A3 simply became `35` on its own. A3 *declared* that it equals A1 plus A2, and the spreadsheet's engine took responsibility for keeping that true whenever A1 or A2 changes.

That is the entire idea of **reactive programming**, and almost everyone already understands it intuitively from spreadsheets. The hard part isn't the concept — it's noticing that most of the code you write *doesn't* work this way. When you write `total = price * quantity` in ordinary code, that line runs **once**. If `price` changes a second later, `total` is stale; nothing recomputes it. You have to *remember* to recompute it — re-run the line, call an `update()`, poll in a loop, wire a callback. The relationship between `total` and `price` exists only in your head, not in the program.

Reactive programming makes that relationship a real thing the program *holds onto*. You declare **how an output depends on its inputs**, and a runtime watches the inputs and **propagates the change** to the output automatically. You stop writing "do X, then later remember to redo X when Y changes" and start writing "X *is* this function of Y" — once.

> **The mindset shift:** stop thinking of a value as a single snapshot computed at one moment. Start thinking of it as something that *changes over time* — and describe how it reacts to its inputs, rather than manually re-running computations whenever something updates.

---

## Prerequisites

- **Required:** You can read basic code in one language — variables, functions, arrays. Examples use **JavaScript/TypeScript** (the RxJS library), with a little **Python** and **Java**.
- **Required:** You've used a callback or an event handler at least once (a button `onClick`, a `setTimeout`, an `addEventListener`).
- **Helpful:** You've used `map` and `filter` on an array. Reactive operators are the same idea applied to events instead of arrays.
- **Helpful:** You've used a spreadsheet formula. That's the single best intuition for this whole topic.
- **Not required:** Any prior knowledge of "observables," RxJS, or "streams." We build those from zero.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Reactive programming** | A style where you declare how outputs depend on inputs, and a runtime automatically updates outputs when inputs change. |
| **Stream** (a.k.a. *observable*) | A sequence of values that arrive **over time** — like an array whose items show up one by one, possibly forever. |
| **Event** | A single thing that happened at a point in time: a click, a keypress, a network response, a sensor reading. |
| **Emit** | When a stream produces a value ("the click stream *emitted* a click"). |
| **Subscribe** | To say "when this stream emits, run this code." Nothing flows out of a stream until something subscribes. |
| **Observer** | The thing that receives values from a stream — usually a callback you pass to `subscribe`. |
| **Operator** | A function that transforms one stream into another: `map`, `filter`, `merge`, and many more. |
| **Push vs pull** | **Pull**: you ask for the next value when *you* want it (a loop). **Push**: the source hands you values when *they* are ready (reactive). |
| **Derived value** | A value defined as a function of other values, kept up to date automatically (like spreadsheet `A3 = A1 + A2`). |

> The word to lock in is **stream**: a value that arrives over time rather than all at once. Everything reactive is built on streams and on *reacting* to what they emit.

---

## Core Concept 1 — Values That Change Over Time

Most programming languages give you values that are computed **once**:

```js
let price = 10;
let quantity = 3;
let total = price * quantity;   // total is 30 — computed right now, once

price = 20;
console.log(total);             // still 30. The line never re-ran.
```

`total` captured a *snapshot* of `price * quantity` at the instant that line executed. The fact that `total` was *supposed* to track `price` is lost — the language threw the relationship away the moment it finished the multiplication.

In an imperative world, keeping `total` correct is **your** job, and you have a few unpleasant options:

```js
// Option A: remember to recompute every time, by hand.
price = 20;
total = price * quantity;       // easy to forget; one missed spot = a bug.

// Option B: poll — keep checking, just in case.
setInterval(() => { total = price * quantity; }, 100);  // wasteful, laggy.

// Option C: callbacks — fire an update whenever price changes.
function setPrice(p) { price = p; total = price * quantity; }  // grows messy fast.
```

Each option re-states, in a different place, the *same* relationship you already wrote once. That duplication is where bugs breed: a stale total here, a missed update there. The reactive answer is to declare the relationship **one time** and let the runtime maintain it:

```
   price ──┐
           ├──►  total = price * quantity   (recomputed automatically
quantity ──┘                                 whenever an input changes)
```

When `price` becomes `20`, `total` becomes `60` **without you re-running anything**. The dependency is now a fact the program holds, not a chore you have to remember. That is what "values that change over time" buys you: outputs that stay correct as inputs move.

---

## Core Concept 2 — Events as Streams

An **array** is a bunch of values you have all at once, laid out in space:

```
[ 1, 2, 3, 4 ]        all present now; you can loop over them whenever
```

A **stream** is a bunch of values laid out in *time* — they arrive one by one, and you may not know how many there will be or when the next one comes:

```
clicks:   ───●────●──────────●────●──────►   (each ● is a click, time goes right →)
            t=1  t=2        t=5  t=6
```

That picture is a **marble diagram**, the standard way to draw a stream: a timeline, with each emitted value as a marble. You'll see them everywhere in reactive docs.

The key realization is that *almost everything that "happens" in a program is a stream*:

- Mouse clicks are a stream of click events.
- Keystrokes in a search box are a stream of strings.
- Messages from a websocket are a stream of payloads.
- Readings from a temperature sensor are a stream of numbers.
- Even a single network request is a (very short) stream: it emits one response, then ends.

Once you see events as streams, you can do to them everything you already do to arrays. You can `map` a stream (transform each value), `filter` a stream (keep only some values), and `merge` two streams into one. The difference is only *when* the values show up — an array gives them to you immediately; a stream gives them to you over time.

```js
// An array of numbers — you have them all now.
const nums = [1, 2, 3, 4];
const doubled = nums.map(n => n * 2);     // [2, 4, 6, 8], immediately

// A stream of numbers (RxJS) — they arrive over time.
import { interval } from 'rxjs';
import { map } from 'rxjs/operators';

const ticks  = interval(1000);            // emits 0, 1, 2, 3, … one per second
const doubledTicks = ticks.pipe(map(n => n * 2));   // 0, 2, 4, 6, … over time
```

Same `map`, same intent ("double each value"). The only change is space versus time. **A stream is an array spread out over time** — hold that thought; it is the bridge from what you already know to everything reactive.

---

## Core Concept 3 — Subscribe, and Let Change Propagate

A stream by itself doesn't *do* anything. `interval(1000)` above doesn't start ticking just because you wrote it down — it's a *description* of a stream, sitting idle. Values start flowing only when someone **subscribes**: declares "here's what to do each time you emit."

```js
import { interval } from 'rxjs';

const ticks = interval(1000);

// Nothing happens yet. Now we subscribe:
ticks.subscribe(n => console.log('tick', n));
// tick 0   (after 1s)
// tick 1   (after 2s)
// tick 2   (after 3s)  … forever, until we unsubscribe
```

`subscribe` is the bridge between the reactive description and the real world. The function you pass is the **observer** — it gets *pushed* a value every time the stream emits. You are not looping and asking "is there a new value yet?" (that's *pull*). The stream **pushes** values to you when they're ready. This push model is the heart of reactivity: the source is in charge of *when*, and you've declared *what to do*.

This is the **Observer pattern** you may know from OOP — "subscribers register interest; the subject notifies them on change" — turned into a first-class value you can pass around and transform. (A stream is sometimes literally called an *Observable*.) The leap reactive programming makes is that the thing being observed isn't just notifying you of changes — you can `map`, `filter`, and combine it *before* you ever subscribe, building a whole pipeline that reacts as a unit.

And critically: when an input stream emits, the change **propagates** through everything built on top of it. If `total` is derived from a `price` stream, a new price flows downstream and `total` updates — the same automatic propagation as the spreadsheet, now for events arriving over time.

> One responsibility comes with subscribing: you usually have to **unsubscribe** when you're done (close the tab, leave the page, cancel the request). A subscription you forget to close is like an `addEventListener` you never remove — it keeps the stream alive and leaks resources. The middle and senior levels cover this in depth; for now, just know that *subscribe creates a live connection you're responsible for*.

---

## Core Concept 4 — Transforming Streams with Operators

The real power shows up when you **transform** streams before subscribing. An **operator** takes a stream and returns a *new* stream, without touching the original. You chain operators into a pipeline, exactly like chaining array methods — except the values flow through over time.

Here are the four you'll use constantly, drawn as marble diagrams.

**`map`** — transform every value:
```
in:   ──1────2────3──►
          map(x => x * 10)
out:  ──10───20───30─►
```

**`filter`** — keep only values that pass a test:
```
in:   ──1──2──3──4──5──►
          filter(x => x % 2 === 0)
out:  ─────2─────4─────►
```

**`merge`** — interleave two streams into one:
```
a:    ──A───────A───────►
b:    ─────B───────B─────►
          merge(a, b)
out:  ──A──B────A──B─────►
```

**`debounceTime`** — wait for a pause before emitting the latest value (great for "user stopped typing"):
```
keys: ──h─e─l─l─o──────────►
          debounceTime(300ms)
out:  ───────────────hello─►   (only emits once typing pauses)
```

Put together, a realistic example — a search box that queries only after the user stops typing and ignores blanks:

```js
import { fromEvent } from 'rxjs';
import { map, filter, debounceTime } from 'rxjs/operators';

const input = document.querySelector('#search');

const searchTerms = fromEvent(input, 'input').pipe(
  map(event => event.target.value),   // event → the text typed
  map(text => text.trim()),           // clean it up
  filter(text => text.length > 0),    // ignore empty searches
  debounceTime(300),                  // wait 300ms after the last keystroke
);

searchTerms.subscribe(term => {
  console.log('searching for:', term);   // runs only on a meaningful, settled term
});
```

Read that pipeline top to bottom: it *declares* what a "search term" is — text, trimmed, non-empty, settled after a pause. There's no manual timer juggling, no flag tracking whether the user is still typing, no `if` checking emptiness scattered around. Each concern is one line. That readability — describing the *what* and letting the runtime handle the *when* — is the payoff of thinking in streams.

---

## The Same Problem, Imperative vs Reactive

> Task: **show a live count of how many times a button has been clicked.**

**Imperative** — you hold the state and mutate it on each event:

```js
let count = 0;                                   // state you own
const btn = document.querySelector('#btn');
const label = document.querySelector('#label');

btn.addEventListener('click', () => {
  count = count + 1;                             // mutate
  label.textContent = `Clicks: ${count}`;        // remember to update the UI
});
```

**Reactive** — you declare the count as a *derived stream* of the click stream:

```js
import { fromEvent } from 'rxjs';
import { scan, map } from 'rxjs/operators';

const btn = document.querySelector('#btn');

const count$ = fromEvent(btn, 'click').pipe(
  scan(total => total + 1, 0),     // running total over the click stream
);

count$.subscribe(count => {
  document.querySelector('#label').textContent = `Clicks: ${count}`;
});
```

What changed?

- **Imperative**: there's a mutable variable `count` living outside the handler, and the handler is responsible for both *updating the number* and *updating the UI*. The "count is the number of clicks" relationship is implicit — it only holds because the handler happens to do it right every time.
- **Reactive**: the count is *defined* as "the click stream, accumulated" (`scan` is the streaming version of `reduce`). There's no free-floating mutable variable; `count$` **is** the running total. You subscribe once to push it into the UI.

Neither is dramatically shorter here — that's honest. The reactive win grows with complexity: add "reset on a second button," "ignore double-clicks within 200ms," "also count from a keyboard shortcut," and the imperative version sprouts flags and tangled handlers, while the reactive version adds one operator each. We return to *when reactive wins and when it's overkill* at the senior level.

---

## Real-World Examples

| Thing you've used | Reactive idea inside it |
|---|---|
| A **spreadsheet** recalculating cells | Derived values that auto-update when inputs change — the canonical mental model. |
| A **search-as-you-type** box | A keystroke *stream*, debounced and filtered into query terms. |
| A **React/Vue/Svelte** component re-rendering on state change | The UI is a *derived value* of state; the framework propagates changes. |
| A **stock ticker** or live dashboard | A *stream* of price updates pushed to the screen. |
| **Excel/Google Sheets** charts updating live | A chart derived from cells that change over time. |
| A **chat app** showing new messages | A websocket *stream* of messages, mapped into UI rows. |
| **Notification badges** that update without refresh | An event stream `scan`-ned into an unread count. |
| **Reactive form validation** (error appears as you type) | Input stream → validation stream → error-message stream. |

You've already *used* reactive systems constantly. This topic gives you the vocabulary — *stream, emit, subscribe, operator* — to build them on purpose instead of reinventing the wiring with ad-hoc callbacks each time.

---

## Mental Models

- **The spreadsheet.** The single best model. A reactive value is a *cell with a formula*: it declares how it depends on other cells, and the engine keeps it correct as they change. If you understand why A3 updates when A1 changes, you understand reactive programming.
- **An array spread over time.** A stream is an array whose elements arrive one by one instead of all at once. Everything you do to arrays (`map`, `filter`, combine) you can do to streams — the only new variable is *when* each element shows up.
- **Push, not pull.** Imperative code *pulls*: it loops and asks "is there a new value yet?" Reactive code is *pushed*: the source hands you values when they're ready, and you've pre-declared what to do with each. You wait to be told, instead of constantly asking.
- **A conveyor belt with stations.** A stream is a conveyor belt carrying items past a line of stations (operators). Each station transforms or drops items and passes the rest along. `subscribe` is the worker at the end who finally takes each item and does something real with it.

---

## Common Mistakes

- **Expecting a stream to "run" without subscribing.** A pipeline of operators is just a *recipe*. Nothing flows — no network call, no log — until something subscribes. "My `map` never ran" almost always means "I never subscribed."
- **Confusing a stream's snapshot value with the stream itself.** A stream is not "the current value"; it's *the whole sequence over time*. Don't reach in for "the value right now" — react to each value as it arrives.
- **Forgetting to unsubscribe.** Subscriptions are live connections. Leaving them open after you're done (navigating away, closing a component) leaks memory and keeps work running. Always have an end for every subscribe.
- **Mutating outside state inside operators.** Writing to a global variable inside a `map` recreates the imperative tangle you were escaping. Operators should *transform values and pass them on*, not reach out and mutate the world. (Side effects belong in `subscribe` or an explicit `tap`.)
- **Reaching for reactive when a plain variable would do.** If a value is computed once and never changes, it isn't a stream — don't wrap it in one. Reactive shines for *things that change over time*; using it for static values is just ceremony.
- **Thinking reactive = asynchronous magic.** Reactive isn't about making things async; it's about *declaring dependencies between changing values*. Plenty of streams are synchronous. Async is a common *use*, not the definition.

---

## Test Yourself

1. In your own words, why does spreadsheet cell A3 (`=A1+A2`) update automatically, but `let total = a + b;` in ordinary code does not?
2. What is a *stream*, and how does it differ from an array?
3. What does `subscribe` do, and why does nothing happen in a reactive pipeline until you call it?
4. Explain "push vs pull" with the example of a button click.
5. Draw a marble diagram for `filter(x => x > 2)` applied to the input `1, 2, 3, 4`.
6. Give one situation where reactive programming clearly helps, and one where it would be unnecessary overhead.

> Try each before reading on. If #1 or #4 is fuzzy, re-read [Values That Change Over Time](#core-concept-1--values-that-change-over-time) and [Subscribe](#core-concept-3--subscribe-and-let-change-propagate).

---

## Cheat Sheet

```
REACTIVE PROGRAMMING = declare how outputs depend on inputs;
                       the runtime propagates changes automatically.
                       (Think: a spreadsheet for your whole program.)

THE CORE NOUNS:
  stream / observable   a sequence of values arriving OVER TIME
  event                 one thing that happened (click, keypress, message)
  emit                  a stream producing a value
  observer              the callback that receives emitted values
  subscribe             "when this emits, do THIS" — starts the flow
  operator              transforms one stream into a new stream

PUSH vs PULL:
  pull (imperative)  you loop and ASK for the next value
  push (reactive)    the source HANDS you values when ready

A STREAM IS AN ARRAY SPREAD OVER TIME — same map/filter, new axis: WHEN.

EVERYDAY OPERATORS:
  map           transform each value
  filter        keep values passing a test
  merge         interleave two streams into one
  scan          running accumulator (reduce, but over time)
  debounceTime  emit the latest value only after a pause

REMEMBER:
  nothing flows until you subscribe
  always unsubscribe when done (or you leak)
  don't mutate outside state inside operators
  reactive is for values that CHANGE OVER TIME — not static values
```

---

## Summary

**Reactive programming** models values that **change over time** as **streams** (observables), lets you **declare** how outputs depend on those streams, and relies on a runtime to **propagate** changes automatically — the spreadsheet model applied to whole programs. The shift from ordinary code is giving up the idea of a value as a one-time snapshot you must manually keep fresh, and instead describing *how a value reacts to its inputs* once. Everything that "happens" — clicks, keystrokes, messages, sensor readings — can be seen as a **stream**, and a stream is just an array spread out over time, so the same `map`/`filter`/`merge` you know from arrays apply directly. A stream is inert until you **subscribe**; subscribing pushes values to your **observer** and creates a live connection you must eventually close. The everyday operators — `map`, `filter`, `merge`, `scan`, `debounceTime` — let you compose declarative pipelines that handle messy event logic (debounced search, accumulated counts) in a line each. Reactive isn't about async magic and isn't a fit for static values; it shines precisely when values change over time and outputs must stay in sync.

---

## Further Reading

- *The introduction to Reactive Programming you've been missing* (André Staltz / "egghead" gist) — the famous, beginner-friendly essay that builds the intuition from clicks and streams.
- [RxJS — Overview](https://rxjs.dev/guide/overview) — the official guide; start with "Observable" and "Operators."
- [RxMarbles](https://rxmarbles.com/) — interactive marble diagrams you can drag; the fastest way to *feel* what each operator does.
- *Reactive Programming with RxJS* (Sergi Mansilla) — a gentle book-length on-ramp using small, runnable examples.

---

## Related Topics

- [`middle.md`](middle.md) — Observable/Observer/Subscription in depth, hot vs cold, more operators, escaping callback hell, cleanup, the error channel.
- [`senior.md`](senior.md) — backpressure, debugging reactive graphs, glitches, and when reactive *wins* vs adds needless complexity.
- [`interview.md`](interview.md) — graded Q&A from definitions to staff-level trade-offs.
- [01 — Overview & Taxonomy](../01-overview-and-taxonomy/) — where reactive sits on the imperative ↔ declarative map.
- [06 — Dataflow & Stream Programming](../06-dataflow-and-stream-programming/) — the closely related "computation as a graph of data dependencies" paradigm.
- [11 — Event-Driven Programming](../11-event-driven-programming/) — events and handlers, the substrate reactive builds on.
- [Functional Programming → Laziness & Streams](../../code-craft/functional-programming/12-laziness-and-streams/) — where the lazy-stream *mechanics* live.
