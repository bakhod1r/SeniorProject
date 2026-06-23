# Event-Driven Programming — Middle Level

> **Roadmap:** [Programming Paradigms](../README.md) → Event-Driven Programming
> *One thread, one queue, one rule — run each handler to completion — and from that you get a whole concurrency model.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [The Event Loop, Precisely](#the-event-loop-precisely)
3. [Run-to-Completion and Single-Threaded Concurrency](#run-to-completion-and-single-threaded-concurrency)
4. [The Node.js Loop: Phases and Non-Blocking I/O](#the-nodejs-loop-phases-and-non-blocking-io)
5. [Microtasks vs Macrotasks](#microtasks-vs-macrotasks)
6. [EventEmitter and the Observer Pattern](#eventemitter-and-the-observer-pattern)
7. [Callbacks → Promises → async/await](#callbacks--promises--asyncawait)
8. [DOM Events: Bubbling, Capture, Delegation](#dom-events-bubbling-capture-delegation)
9. [Python's asyncio: the Same Idea, Different Words](#pythons-asyncio-the-same-idea-different-words)
10. [Common Mistakes](#common-mistakes)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How does it actually work?**

At junior level you learned the shape: register handlers, hand control to a loop, get called back. That's the *what*. This level is the *how* — and the how is surprisingly mechanical, which is good news, because it means the behavior is predictable once you internalize a few rules.

The payoff for understanding the machinery is concrete. You'll be able to predict the exact output order of interleaved timers, promises, and I/O callbacks — a favorite interview exercise — and you'll understand *why* `async/await` is not a new concurrency model but a nicer syntax over the same single loop you already met. Most importantly, you'll understand the load-bearing constraint of the whole paradigm: **the loop runs your handlers one at a time, to completion, on a single thread**, and everything good and bad about event-driven code flows from that one fact.

We'll work mostly in **JavaScript** (browser and Node, where the model is purest) and **Python** (`asyncio`, which makes the same machinery explicit), and we'll keep returning to one question: *given a pile of pending events, in what order does the loop run them, and why?*

---

## The Event Loop, Precisely

Strip away the framework specifics and an event loop is four parts:

1. **A queue (or several)** of events/tasks waiting to be processed.
2. **A call stack** — the single place where a function actually executes.
3. **The loop itself** — the algorithm that moves work from queue to stack.
4. **Event sources** — timers, I/O completions, user input, messages — that *enqueue* work from the outside.

The algorithm is almost trivial to state:

```text
loop:
    if the call stack is empty:
        if there is a task in the queue:
            take the oldest task, push it onto the stack, run it to completion
        else:
            block (sleep) until an event source enqueues something
```

Two non-obvious truths hide in there:

- **The loop only acts when the stack is empty.** It never preempts running code to start something else. A handler that's mid-execution cannot be paused by the loop to run another handler.
- **When nothing is queued, the program truly sleeps.** It is not spinning. The OS (via mechanisms like `epoll`/`kqueue`, covered at professional level) wakes the process only when a watched event source becomes ready. That's why an idle Node server with 10,000 open connections uses almost no CPU.

The "queue" is a simplification — real loops have *multiple* queues with priorities (timers, I/O, microtasks, …), which is exactly what makes output ordering subtle. We'll unpack those below. But the core remains: **empty the stack, then dispatch the next thing.**

---

## Run-to-Completion and Single-Threaded Concurrency

The single most important rule of these loops is **run-to-completion**: once a task (a handler, a callback) starts running, it runs to its end with no interruption from the loop. The loop dispatches the *next* task only after the current one's stack frame has fully unwound.

This rule buys you something precious and costs you something painful.

**What it buys: no data races within your code.** Because only one piece of your code runs at a time, and it runs uninterrupted, you never have two handlers half-modifying the same variable simultaneously. The check-then-act sequences that require locks in multithreaded code are automatically atomic here:

```javascript
let balance = 100;
function withdraw(amount) {
  if (balance >= amount) {   // no other handler can run between this check...
    balance -= amount;       // ...and this update. Atomic, no lock needed.
  }
}
```

In a multithreaded program, two threads could both pass the `if` before either subtracts, overdrawing the account — the classic race. On a single-threaded loop, that interleaving *cannot happen*, because `withdraw` runs to completion before any other handler starts. This is **concurrency without parallelism**: the loop juggles thousands of in-flight operations (concurrency) but only ever executes one instruction stream at a time (no parallelism). You get interleaving *between* tasks, never *within* one.

**What it costs: one slow task blocks everything.** Because the loop can't interrupt a running handler, a handler that takes 5 seconds means *nothing else happens for 5 seconds* — no other clicks, no I/O callbacks, no rendering. The loop is **cooperatively scheduled**: tasks must voluntarily *finish* (or yield via `await`) to give the loop a turn. A task that hogs the CPU starves every other task. This is the defining trade-off of the paradigm, and senior level is largely about living with it. See [`senior.md`](senior.md).

> **The mental model:** the loop is a single worker processing a queue. It's fast because it never wastes time waiting (it parks instead) and never pays for locks (one-at-a-time). It's fragile because any single task that refuses to finish quickly stalls the whole line.

---

## The Node.js Loop: Phases and Non-Blocking I/O

The browser loop is simple (roughly: macrotasks, then drain microtasks, then maybe render). Node's loop, built on the **libuv** library, is more elaborate because it serves servers, not just UIs. It runs in **phases**, and each tick cycles through them in a fixed order:

```text
   ┌───────────────────────────┐
┌─►│   timers                  │  setTimeout / setInterval callbacks whose time is due
│  ├───────────────────────────┤
│  │   pending callbacks       │  some deferred system callbacks (e.g. certain TCP errors)
│  ├───────────────────────────┤
│  │   poll                    │  ← retrieve new I/O events; run their callbacks; may BLOCK here
│  ├───────────────────────────┤
│  │   check                   │  setImmediate callbacks
│  ├───────────────────────────┤
│  │   close callbacks         │  'close' events (e.g. socket.on('close'))
└──┴───────────────────────────┘
   (after EACH callback: drain the microtask queue — promises, process.nextTick)
```

The phase that matters most is **poll**. This is where Node asks the OS "which of my thousands of sockets/files have data ready?" — and if nothing else is pending, **this is where the process sleeps**, parked by `epoll` (Linux) / `kqueue` (macOS) / IOCP (Windows). When a socket becomes readable, the OS wakes Node, and the poll phase runs that socket's callback.

The reason Node scales is **non-blocking I/O**. A naive server does this per request: read from socket (block until data), query DB (block until result), write response (block). One thread can serve one client at a time; 10,000 clients need 10,000 threads. Node instead does:

```javascript
const http = require("http");

http.createServer((req, res) => {
  // This handler returns ALMOST IMMEDIATELY. It doesn't wait for the DB.
  db.query("SELECT ...", (err, rows) => {     // registers a callback, returns now
    res.end(JSON.stringify(rows));            // runs LATER, when the DB replies
  });
  // <-- control returns to the loop here; it's free to handle other requests
}).listen(3000);
```

While the DB works (milliseconds — an eternity in CPU terms), the single thread isn't blocked waiting. It goes back to the loop and services *other* requests. One thread, thousands of concurrent in-flight requests, because each request spends most of its life *waiting on I/O* and waiting is free here. (Under the hood, libuv uses a small thread pool for things the OS can't do asynchronously — file system ops, DNS, crypto — but your JavaScript still runs on one thread.)

A worked ordering example everyone should be able to trace:

```javascript
setTimeout(() => console.log("timeout"), 0);
setImmediate(() => console.log("immediate"));
// Inside an I/O callback, setImmediate ALWAYS fires before setTimeout,
// because 'check' comes right after 'poll', while 'timers' waits for the next tick.
// At the top level, the order is not guaranteed (depends on loop startup timing).
```

---

## Microtasks vs Macrotasks

Both browser and Node split queued work into two priority tiers, and the ordering rule between them is the most asked, most missed detail in JS interviews.

- **Macrotasks** (a.k.a. "tasks"): `setTimeout`, `setInterval`, `setImmediate`, I/O callbacks, UI events. The loop runs **one** macrotask per iteration.
- **Microtasks**: resolved-Promise callbacks (`.then`/`await` continuations), `queueMicrotask`, and Node's `process.nextTick` (which jumps ahead of even other microtasks). After *each* macrotask, the loop **drains the entire microtask queue** before doing anything else — including before rendering or taking the next macrotask.

The rule in one line: **after each task, run *all* microtasks; only then take the next task.**

```javascript
console.log("A");
setTimeout(() => console.log("B"), 0);          // macrotask
Promise.resolve().then(() => console.log("C")); // microtask
console.log("D");

// Output: A, D, C, B
// A, D run synchronously (current task).
// Stack empties → drain microtasks → C.
// Next macrotask → B.
```

`C` beats `B` *even though both look "async,"* because the microtask queue is fully drained before the next macrotask runs. The practical hazard: a microtask that schedules another microtask, that schedules another… can **starve** the macrotask queue forever — timers and I/O never get a turn. Microtasks are a priority lane with no built-in fairness.

---

## EventEmitter and the Observer Pattern

So far events came from the runtime (clicks, I/O). You can also define *your own* events. The structure for that is the **Observer pattern**: an object (the *subject* / *emitter*) keeps a list of *observers* (handlers) and notifies them when something happens. Node's `EventEmitter` is the canonical implementation.

```javascript
const EventEmitter = require("events");

class Order extends EventEmitter {}
const order = new Order();

// Observers SUBSCRIBE (register handlers):
order.on("paid", (amount) => console.log(`Charge card: ${amount}`));
order.on("paid", (amount) => console.log(`Email receipt for ${amount}`));

// The subject NOTIFIES (emits) — synchronously calls every registered handler in order:
order.emit("paid", 49.99);
// → "Charge card: 49.99"
// → "Email receipt for 49.99"
```

Key properties to internalize:

- **`emit` is synchronous.** It calls all listeners *right now*, in registration order, on the current stack — *not* on the next loop tick. `EventEmitter` is about *decoupling*, not *deferring*. (Contrast `setTimeout`, which defers.)
- **Decoupling is the point.** The `Order` doesn't know who's listening; observers don't know about each other. You add a "fraud check" listener without touching the payment code. This is the Observer pattern's whole value: a publisher and many subscribers, wired loosely.
- **Errors and leaks bite here.** A throwing listener can break the `emit` for later listeners. And listeners you `.on()` but never `.removeListener()` accumulate — Node warns at 10+ (`MaxListenersExceededWarning`) precisely because forgotten subscriptions are a classic leak.

This same pattern, scaled across *services* over a network, becomes **publish/subscribe** in event-driven architecture — but that's a different scale (see [`professional.md`](professional.md) and the [system-design EDA topic](../../../Architecture/system-design/)). Here it's in-process: one program, synchronous notification.

---

## Callbacks → Promises → async/await

Callbacks work, but nesting them produces the infamous **callback hell** — code that marches diagonally off the right edge of the screen:

```javascript
getUser(id, (err, user) => {
  if (err) return done(err);
  getOrders(user, (err, orders) => {       // nested
    if (err) return done(err);
    getItems(orders, (err, items) => {     // nested deeper
      if (err) return done(err);
      done(null, items);                   // and the error checks repeat at every level
    });
  });
});
```

It's not just ugly — error handling is manual and repeated at every level, and the control flow is hard to follow. **Promises** flatten the nesting into a chain, and centralize errors into a single `.catch`:

```javascript
getUser(id)
  .then(user => getOrders(user))
  .then(orders => getItems(orders))
  .then(items => done(items))
  .catch(err => done(err));     // ONE place handles errors from ANY step
```

**async/await** then makes that chain *look* like ordinary sequential code, while running on the exact same loop:

```javascript
async function loadItems(id) {
  try {
    const user = await getUser(id);       // "await" = "register a continuation, yield to the loop"
    const orders = await getOrders(user); // resumes here when the promise resolves
    return await getItems(orders);
  } catch (err) {
    throw err;                            // normal try/catch works across awaits
  }
}
```

The crucial mental correction: **`await` is not blocking.** It does *not* freeze the thread. It **suspends the function**, hands control back to the event loop (which goes off and does other work), and **resumes the function** later as a microtask when the awaited promise resolves. `async/await` is *syntactic sugar over promises*, which are *sugar over callbacks*, which are *the raw event-loop primitive*. Three layers of ergonomics, **one underlying machine**. Understanding that they're the same loop is what separates someone who memorized `async/await` from someone who understands it. The mechanics of suspend/resume live in [Concurrency, Async & Parallelism](../../language-internals/concurrency-async-parallel/).

---

## DOM Events: Bubbling, Capture, Delegation

Browser events add a wrinkle: the DOM is a *tree*, and an event on a leaf (a click on a `<button>` inside a `<div>` inside `<body>`) doesn't just fire on the button. It **propagates** through the tree in three phases:

1. **Capture phase** — the event travels *down* from the root toward the target. Handlers registered with `{ capture: true }` fire here.
2. **Target phase** — the event reaches the element actually clicked.
3. **Bubble phase** — the event travels back *up* from the target to the root. This is the default for most handlers.

```javascript
document.body.addEventListener("click", () => console.log("body (bubble)"));
button.addEventListener("click", () => console.log("button"));
// Clicking the button prints: "button", then "body (bubble)" — the event bubbles UP.

// event.stopPropagation() halts the journey; event.preventDefault() cancels the
// browser's default action (e.g. following a link) — they're different things.
```

Bubbling enables a powerful idiom — **event delegation**: instead of attaching a handler to every one of 1,000 list items, attach *one* handler to their shared parent and read `event.target` to see which child was clicked.

```javascript
// One listener for the whole list, instead of 1000:
list.addEventListener("click", (e) => {
  const item = e.target.closest("li");
  if (item) console.log("clicked", item.dataset.id);
});
```

Delegation is more memory-efficient (one handler, not thousands) and automatically covers items added *later* (you didn't have to wire them up). It works *because* of bubbling — the child's click reaches the parent's handler.

---

## Python's asyncio: the Same Idea, Different Words

Python's `asyncio` is the same event-loop machine with different vocabulary, which makes it a useful Rosetta Stone.

```python
import asyncio

async def fetch(name, delay):
    print(f"start {name}")
    await asyncio.sleep(delay)     # NOT time.sleep — this YIELDS to the loop
    print(f"done {name}")
    return name

async def main():
    # Both run concurrently on ONE thread; total time ≈ 2s, not 3s.
    results = await asyncio.gather(fetch("A", 2), fetch("B", 1))
    print(results)

asyncio.run(main())   # creates the loop, runs main to completion, closes the loop
```

The mappings:

- `async def` ↔ `async function`; `await` ↔ `await` (same suspend-to-the-loop meaning).
- `asyncio.sleep()` is the non-blocking sleep — it yields. **`time.sleep()` blocks the whole loop** (the Python equivalent of the slow-handler footgun). Mixing a blocking call into an async program is the #1 `asyncio` bug.
- `asyncio.get_event_loop()` / `asyncio.run()` ↔ the JS loop you never see because the runtime starts it for you.

The single-threaded, cooperative, run-to-completion rules are identical: a coroutine that never `await`s (or calls a blocking C function) starves every other coroutine, exactly as a never-finishing JS handler does. Different syntax, same physics. The mechanics live in [Concurrency, Async & Parallelism](../../language-internals/concurrency-async-parallel/).

---

## Common Mistakes

- **Believing `async/await` is multithreaded.** It's one thread cooperatively scheduling. `await` yields; it doesn't parallelize. CPU-bound work in an async function still blocks the loop.
- **Blocking the loop with sync work.** A long synchronous loop, `JSON.parse` of a 50 MB string, `time.sleep()`, or a synchronous DB driver freezes *everything*. Offload CPU work to a worker thread/process or chunk it.
- **Mis-ordering microtasks and macrotasks.** Assuming `setTimeout(fn, 0)` runs before a resolved-promise `.then`. It doesn't — microtasks drain first.
- **Forgetting `EventEmitter` is synchronous.** Expecting `emit` to defer to the next tick. It calls listeners inline, right now.
- **Leaking listeners.** `.on()` without a matching `.off()`/`removeListener` on long-lived emitters accumulates handlers and retained memory — the source of "handler fired N times" bugs.
- **Swallowing async errors.** An unhandled rejected promise, or an error thrown in a callback nobody catches, vanishes silently. Always `.catch` chains and `try/catch` your awaits.
- **Awaiting in a loop when you meant to parallelize.** `for (const x of xs) await f(x)` runs them *sequentially*; `await Promise.all(xs.map(f))` runs them concurrently. Easy to do the slow one by accident.

---

## Summary

An event loop is four parts — queue(s), a single call stack, the dispatch algorithm, and event sources — governed by one rule: **empty the stack, then run the next task to completion.** That **run-to-completion**, single-threaded model gives you **concurrency without parallelism**: thousands of in-flight operations interleaved, but only one instruction stream at a time, so your code is free of data races *and* hostage to any single slow task. **Node's loop runs in phases** (timers → poll → check → close) on libuv, and scales via **non-blocking I/O** — register a callback, return to the loop, get called back when the OS says the socket is ready. Queued work splits into **macrotasks** (one per tick) and **microtasks** (fully drained after each task, so promises beat timers). **`EventEmitter`** implements the **Observer pattern** for your own (synchronous) events. **Callbacks → Promises → async/await** are three layers of ergonomics over the *same* loop — `await` suspends and yields, it does not block. The DOM adds **capture/bubble propagation**, which powers **event delegation**. Python's `asyncio` is the identical machine with different words. Master the ordering rules and the slow-handler hazard, and you understand the paradigm.

---

## Further Reading

- Node.js docs, *The Node.js Event Loop, Timers, and `process.nextTick()`* — the authoritative phase-by-phase reference.
- Jake Archibald, *"Tasks, microtasks, queues and schedules"* — the definitive deep-dive on browser micro/macrotask ordering, with animations.
- Bert Belder, *"Everything You Need to Know About Node.js Event Loop"* (libuv talk) — the loop from the libuv author's perspective.
- Python docs, *Developing with asyncio* and *Event Loop* — the official `asyncio` model and pitfalls (notably blocking calls).
- *You Don't Know JS: Async & Performance* (Kyle Simpson) — callbacks → promises → async, with the *why* behind each layer.

---

## Related Topics

- [`junior.md`](junior.md) — the handler/loop intuition, events vs polling, inversion of control.
- [`senior.md`](senior.md) — the trade-offs: callback hell, debugging inverted flow, cooperative-scheduling hazards, async error handling.
- [`professional.md`](professional.md) — libuv, `epoll`/`kqueue`, the reactor pattern, C10k, and event-driven *architecture*.
- [05 — Reactive Programming](../05-reactive-programming/) — promises and emitters generalized to *streams* of events over time.
- [06 — Dataflow & Stream Programming](../06-dataflow-and-stream-programming/) — pipelines of event-producing stages.
- [07 — Actor Model & CSP](../07-actor-model-and-csp/) — message-passing concurrency, a different answer to the same problems.
- [Concurrency, Async & Parallelism](../../language-internals/concurrency-async-parallel/) — the *mechanics* of async runtimes, suspend/resume, and schedulers.
