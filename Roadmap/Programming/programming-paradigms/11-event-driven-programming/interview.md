# Event-Driven Programming — Interview Q&A

> **Roadmap:** [Programming Paradigms](../README.md) → Event-Driven Programming
>
> *Event-driven programming inverts control: instead of your code calling functions in order, you register **handlers** and an **event loop** calls them when events arrive. One thread, one queue, one rule — run each handler to completion — gives you concurrency without parallelism. Almost every interview question here is a consequence of that one model: why Node is single-threaded yet concurrent, why a slow handler freezes everything, why promises beat timers in ordering, and where the in-process loop ends and distributed event-driven **architecture** begins.*

A bank of 40+ questions spanning definitions, the loop model, ordering puzzles, the trade-offs, the reactor pattern, and the programming-vs-architecture distinction. Each answer models the reasoning a strong candidate gives, including the trade-off and the runtime reality underneath. Use the `<details>` toggles to self-quiz: read the question, answer out loud, then expand.

Examples are in **JavaScript** (browser + Node) and **Python** (`asyncio`), with a GUI aside where it clarifies.

---

## Table of Contents

1. [Fundamentals / Junior](#fundamentals--junior)
2. [The Loop Model / Middle](#the-loop-model--middle)
3. [Ordering Puzzles — Read the Output](#ordering-puzzles--read-the-output)
4. [Trade-offs & Design / Senior](#trade-offs--design--senior)
5. [Internals & Scale / Professional / Staff](#internals--scale--professional--staff)
6. [Programming vs Architecture](#programming-vs-architecture)
7. [Curveballs](#curveballs)
8. [Rapid-Fire / One-Liners](#rapid-fire--one-liners)
9. [How to Talk About Event-Driven Programming in Interviews](#how-to-talk-about-event-driven-programming-in-interviews)
10. [Summary](#summary)
11. [Related Topics](#related-topics)

---

## Fundamentals / Junior

> Definitions, the core inversion, and the "why does this matter" reasoning.

**Q1. What is event-driven programming, in one or two sentences?**

<details><summary>Answer</summary>

It's a style where, instead of a top-down script that decides what happens next, the program **registers handlers** for events (clicks, messages, I/O completion, timers) and hands control to an **event loop** that waits for events and **calls the matching handler**. Your code is a set of "when X happens, do Y" reactions; the loop owns the timeline. The defining feature is **inversion of control** — the framework calls you, not the other way around.
</details>

**Q2. What is an event loop?**

<details><summary>Answer</summary>

A runtime construct that repeatedly: waits for an event to be available, takes the next one from a queue, and calls the handler registered for it — then repeats, for the life of the program. Concretely: `while (true) { if (stack empty && queue non-empty) run next task to completion; else sleep until an event arrives; }`. When nothing is queued, the program genuinely *sleeps* (parked by the OS), using ~0% CPU — it isn't spinning. It's the engine that turns "events happened" into "handlers ran."
</details>

**Q3. What is inversion of control, and why is it the heart of this paradigm?**

<details><summary>Answer</summary>

In normal code, *you* call the framework's functions in *your* order — you're in control. With inversion of control, you hand the framework your functions and *it* calls them when *it* decides. The nickname is the **Hollywood Principle**: "Don't call us, we'll call you." It's the heart of event-driven programming because it's what lets one program wait responsively on many unpredictable things: you can't write "wait for any of 100 events in order" as a straight script, but you *can* register 100 handlers and let the loop dispatch whichever fires. The cost is that you no longer control *when* your code runs — the world does.
</details>

**Q4. What is a callback? How does it relate to an event handler?**

<details><summary>Answer</summary>

A callback is a function passed to other code to be **called later** — on completion, on an event, or per element. An event handler is a callback specialized to "run when this event fires." "Callback" emphasizes *timing* (called back at a future point); "handler" emphasizes *what triggers it* (an event). `setTimeout(fn, 0)`, `fs.readFile(path, cb)`, and `button.addEventListener("click", fn)` all pass callbacks; the last is also an event handler.
</details>

**Q5. Events vs polling — what's the difference and why is event-driven usually better?**

<details><summary>Answer</summary>

Polling repeatedly *asks* "has it happened yet?" in a loop; event-driven *subscribes* and waits to be *told*. Polling burns a CPU core spinning even when nothing happens, scales badly to many sources (a tangle of `if` checks), and adds latency bounded by how often you ask. Event-driven parks the program (~0% CPU when idle), lets one loop watch many sources naturally, and reacts the instant an event arrives. The inversion is "keep checking" → "notify me." (Polling still wins when there's no notification mechanism, or when you deliberately want to batch/rate-limit checks.)
</details>

**Q6. Why is `button.addEventListener("click", onClick())` a bug?**

<details><summary>Answer</summary>

The `()` *calls* `onClick` immediately and registers its **return value** (likely `undefined`) as the handler — so nothing useful happens on click, and any side effects in `onClick` fire once, at registration time, not on click. You want `addEventListener("click", onClick)` — pass the function *itself*, no parentheses. This is the most common beginner error in event code: confusing "give the loop this function" with "call this function now."
</details>

**Q7. Walk through what happens when a user clicks a button on a web page.**

<details><summary>Answer</summary>

Earlier, your code registered a handler (`button.addEventListener("click", fn)`), which added an entry to the browser's internal listener table and returned — `fn` did *not* run. The browser's event loop has been running the whole time. On click, the browser creates a click event, finds the registered handler(s), and **queues** a task to run them. When the call stack is empty, the loop dispatches that task, running `fn` to completion. So the click → handler path is: user acts → browser enqueues → loop dispatches when free → your handler runs. You never called it; the loop did.
</details>

---

## The Loop Model / Middle

> Run-to-completion, single-threaded concurrency, Node phases, async layers.

**Q8. Why is Node.js single-threaded yet able to handle thousands of concurrent connections?**

<details><summary>Answer</summary>

Because its concurrency comes from **non-blocking I/O on an event loop**, not from threads. When a request needs the DB or network, Node doesn't block a thread waiting — it registers a callback and returns to the loop, which is then free to service *other* requests. The work is **I/O-bound**, so each request spends most of its life *waiting*, and waiting is free here (the thread parks; the OS wakes it when a socket is ready). One thread juggles thousands of *in-flight* requests because at any instant only a few need CPU. The precise framing: it's **concurrency without parallelism** — many things in progress, one instruction stream at a time. (Caveat: libuv uses a small thread pool for file I/O, DNS, and crypto; *your JavaScript* is single-threaded.)
</details>

**Q9. What does "run-to-completion" mean, and what does it buy and cost you?**

<details><summary>Answer</summary>

Once a handler starts, it runs to its end with no interruption from the loop; the loop dispatches the next task only after the current one fully returns. **It buys** freedom from data races within your code — only one handler runs at a time, uninterrupted, so check-then-act sequences are atomic with no locks (the basis of Redis's lock-free design). **It costs** you the slow-handler hazard — because the loop can't preempt a running handler, any handler that doesn't return promptly stalls *every* other event. The model is cooperatively scheduled: tasks must voluntarily finish (or `await`) to yield.
</details>

**Q10. What blocks the event loop? Give concrete examples and the fix.**

<details><summary>Answer</summary>

Any synchronous work that doesn't yield: a long `while`/`for` loop, a CPU-heavy computation, `JSON.parse`/`JSON.stringify` of a huge payload, synchronous I/O (`fs.readFileSync`, a sync DB driver), `time.sleep()` in Python `asyncio`, or a catastrophically-backtracking regex on attacker input. Any of these freezes *all* other events for its duration — on a server, every other request's latency spikes; in a browser, the UI goes "not responding." Fixes: move CPU-bound work to `worker_threads`/web workers/a separate process; chunk long loops and `await`/`setImmediate` between slices; bound payload sizes and add timeouts; replace sync APIs with async ones.
</details>

**Q11. Is `async/await` multithreaded? What does `await` actually do?**

<details><summary>Answer</summary>

No — it's single-threaded cooperative scheduling. `await` does **not** block the thread; it **suspends the current async function**, hands control back to the event loop (which goes off and runs other work), and **resumes** the function later — as a microtask — when the awaited promise resolves. `async/await` is *syntactic sugar over promises*, which are *sugar over callbacks*, which are the raw loop primitive: three layers of ergonomics, one machine. The common misconception is that `await` parallelizes; it doesn't. CPU-bound work between awaits still blocks the loop, and `await`ing in a loop *serializes* operations you might have wanted parallel (use `Promise.all`).
</details>

**Q12. Explain Node's event loop phases. Which one matters most?**

<details><summary>Answer</summary>

libuv cycles through fixed phases each tick: **timers** (due `setTimeout`/`setInterval`), **pending callbacks**, **poll** (retrieve and run I/O callbacks — and *block here* if nothing else is pending), **check** (`setImmediate`), and **close callbacks**. After *each* callback, the microtask queue (promises, `process.nextTick`) is drained. The **poll** phase matters most: it's where Node asks the OS which sockets are ready, and where an idle process *sleeps* (parked by `epoll`/`kqueue`/IOCP) until I/O arrives. A useful consequence: inside an I/O callback, `setImmediate` (check) always fires before `setTimeout` (timers, next tick).
</details>

**Q13. What's the difference between a microtask and a macrotask, and the ordering rule?**

<details><summary>Answer</summary>

**Macrotasks** (`setTimeout`, `setImmediate`, I/O callbacks, UI events) run **one per loop iteration**. **Microtasks** (resolved-promise `.then`/`await` continuations, `queueMicrotask`, Node's `process.nextTick`) are **fully drained after each macrotask**, before the next macrotask or any rendering. The rule in one line: *after each task, run all microtasks, then take the next task.* So a resolved-promise callback beats a `setTimeout(_, 0)` even though both look "async." The hazard: microtasks that schedule more microtasks can **starve** the macrotask queue — timers and I/O never get a turn.
</details>

**Q14. What is `EventEmitter` / the Observer pattern, and is `emit` synchronous?**

<details><summary>Answer</summary>

The Observer pattern: a *subject* keeps a list of *observers* (handlers) and notifies them when something happens; `EventEmitter` is Node's implementation. Subscribers `.on("event", handler)`; the subject `.emit("event", data)`. **`emit` is synchronous** — it calls every registered listener *right now*, in registration order, on the current stack; it does *not* defer to the next tick. `EventEmitter` is about **decoupling** (the emitter doesn't know its listeners), not **deferral**. Sharp edges: a throwing listener can break `emit` for later listeners; forgotten `.on()` without `.off()` leaks (Node warns at 10+ listeners); and emitting `"error"` with no listener attached *crashes the process* by design.
</details>

**Q15. What problem does the callbacks → promises → async/await progression solve?**

<details><summary>Answer</summary>

Nested callbacks produce **callback hell** (the pyramid of doom): code marching rightward, with error handling duplicated at every nesting level and the real logic buried in indentation. **Promises** flatten the nesting into a `.then` chain and centralize errors into one `.catch`. **async/await** then makes the chain *read* like ordinary sequential code (`const x = await f()`), with normal `try/catch` working across awaits — while still running non-blocking on the same loop. Each layer is ergonomics over the previous; none changes the underlying single-threaded loop. The key caveat: async/await cured callback hell for *linear async sequences*, not for genuine *event* systems (which still need named handlers and tracing).
</details>

**Q16. Explain event bubbling, capturing, and delegation in the DOM.**

<details><summary>Answer</summary>

A DOM event propagates through the tree in three phases: **capture** (root → target; handlers with `{capture:true}`), **target** (the clicked element), and **bubble** (target → root; the default). So a click on a child reaches the parent's handler as it bubbles up. **Event delegation** exploits bubbling: instead of attaching a handler to each of 1,000 list items, attach *one* to their parent and read `event.target` to find which child was clicked. It's more memory-efficient (one handler) and automatically covers items added *later*. `stopPropagation()` halts the journey; `preventDefault()` cancels the browser's default action — different things.
</details>

---

## Ordering Puzzles — Read the Output

> You're shown a snippet; state the exact output and *why*.

**Q17. What does this print?**

```javascript
console.log("A");
setTimeout(() => console.log("B"), 0);
Promise.resolve().then(() => console.log("C"));
console.log("D");
```

<details><summary>Answer</summary>

`A, D, C, B`. `A` and `D` run synchronously in the current task. When the stack empties, the loop **drains microtasks** first → `C` (a resolved-promise continuation). Only then does it take the next **macrotask** → `B` (the timer). The takeaway: microtasks (promises) always beat macrotasks (`setTimeout`), even a `0`ms one.
</details>

**Q18. What does this print, and why is it a classic trap?**

```javascript
console.log("start");
setTimeout(() => console.log("timeout"), 0);
Promise.resolve()
  .then(() => console.log("promise 1"))
  .then(() => console.log("promise 2"));
console.log("end");
```

<details><summary>Answer</summary>

`start, end, promise 1, promise 2, timeout`. Synchronous first: `start`, `end`. Stack empties → drain microtasks: `promise 1` runs, and its `.then` *schedules another microtask*, which the loop drains *in the same pass* → `promise 2`. Only after the microtask queue is fully empty does the macrotask `timeout` run. The trap: chained `.then`s all complete before any timer, because each resolved `.then` enqueues another microtask and the queue is drained to exhaustion before the next macrotask.
</details>

**Q19. Node — what's the output order, and is it guaranteed?**

```javascript
setTimeout(() => console.log("timeout"), 0);
setImmediate(() => console.log("immediate"));
```

<details><summary>Answer</summary>

At the **top level**, the order is **not guaranteed** — it depends on how long process startup took relative to the 1 ms timer floor, so you may see either order across runs. But **inside an I/O callback** (e.g., within an `fs.readFile` callback), `setImmediate` **always** runs before `setTimeout`, because the I/O callback runs in the *poll* phase, and *check* (`setImmediate`) comes immediately after poll, while *timers* must wait for the next loop iteration. A strong answer names the phase ordering, not just the empirical result.
</details>

**Q20. Python — what does this print, and what's the bug if `sleep` were `time.sleep`?**

```python
import asyncio
async def task(name, delay):
    await asyncio.sleep(delay)
    print(name)
async def main():
    await asyncio.gather(task("slow", 2), task("fast", 1))
asyncio.run(main())
```

<details><summary>Answer</summary>

Prints `fast` then `slow`, and total runtime is ~2 s (not 3). Both coroutines run concurrently on one thread; `asyncio.sleep` **yields** to the loop, so while `slow` waits 2 s, `fast` finishes at 1 s. If you replaced `asyncio.sleep` with `time.sleep`, it would **block the entire loop**: `slow`'s `time.sleep(2)` would freeze everything, the coroutines would run effectively sequentially (~3 s total), and concurrency would vanish. That's the #1 `asyncio` bug — a blocking call on the loop thread.
</details>

**Q21. What does this print? (the loop-closure classic, event flavor)**

```javascript
for (var i = 0; i < 3; i++) {
  setTimeout(() => console.log(i), 0);
}
```

<details><summary>Answer</summary>

`3, 3, 3`. With `var`, there's one shared `i`. All three timer callbacks close over that *same variable*, and they don't run until after the synchronous loop finishes — by which point `i` is `3`. The fix is per-iteration binding: use `let` (block-scoped, fresh `i` each iteration → `0, 1, 2`), or an IIFE capturing the value. This is the event/closure interaction: callbacks run *later*, so they see the variable's *final* value, not its value when scheduled.
</details>

---

## Trade-offs & Design / Senior

> When it wins, when it hurts, and how to mitigate.

**Q22. When is event-driven the right choice, and when is it the wrong one?**

<details><summary>Answer</summary>

**Right** for I/O-bound, high-concurrency workloads (servers, proxies, real-time feeds), responsive UIs, and inherently event-shaped domains (interactions, messages, ticks) — anywhere the work is *dominated by waiting* or *responsiveness is paramount*. **Wrong** for linear logic with no concurrency ("do A then B then C" — event-driving it adds indirection for nothing) and for CPU-bound work that needs true parallelism (the loop gives concurrency, not parallelism; it can't speed up a hot computation, only stop it from blocking — use threads/processes). Most "event-driven is awful" complaints are really "event-driven misapplied to linear logic," where async/await or green threads read better.
</details>

**Q23. What is callback hell, and do promises/async-await fully solve it?**

<details><summary>Answer</summary>

Callback hell (the pyramid of doom) is deeply nested callbacks drifting rightward, with error handling repeated at every level and the logic lost in indentation. Promises flatten it into a chain with one `.catch`; async/await restores top-to-bottom readability with `try/catch`. They **fully solve it for *linear* async sequences** — a series of awaited steps. They do **not** solve the deeper issue for genuine *event* systems, where flow is inherently scattered across handlers triggered by the world. For those, the cure is *discipline*: named top-level handlers (not anonymous nested closures), flat dispatch, and causal logging — not syntax. And async/await is a *leaky* abstraction: you must remember it's a cooperative loop (CPU work between awaits blocks; `await` in a loop serializes).
</details>

**Q24. Why are stack traces in event-driven code so unhelpful, and what's the fix?**

<details><summary>Answer</summary>

When a handler throws, the trace starts at the **event loop**, not at the code that logically *caused* this handler to run — because the frames that *registered* the callback unwound the moment they returned. Across an `await`, `setTimeout`, or `emit`, the synchronous stack is severed; cause and effect live in different ticks. Fixes: enable **async stack traces** (modern runtimes stitch the broken stacks back together); thread **correlation IDs** through every event so you can reconstruct one logical flow from interleaved logs; **structured logging** at handler entry/exit; and **distributed tracing** (OpenTelemetry) when events cross processes. The principle: since the stack can't tell the causal story, you must *record* it explicitly.
</details>

**Q25. How does error handling differ across async boundaries, and what are the leak points?**

<details><summary>Answer</summary>

In sequential code an exception propagates up the stack automatically; across async boundaries that breaks and you must reconnect it. **Callbacks:** a `throw` goes to the loop, not the scheduling code (whose stack is gone) — hence Node's error-first `(err, result)` convention (errors as *data*, not thrown). **Promises:** errors become *rejected promises*; a missing `.catch` is an **unhandled rejection** (now process-crashing in modern Node). **async/await:** `try/catch` works across awaits — but an `await` outside a `try` with no surrounding handler rejects silently, and `Promise.all` rejects on the *first* failure (use `allSettled` for all outcomes). **EventEmitter:** a thrown listener can abort `emit`; an `"error"` event with no listener *crashes by design*. Discipline: `.catch` every chain, `try/catch` meaningful awaits, attach `"error"` listeners, and add a top-level `unhandledRejection` backstop (to log and shut down, not resume).
</details>

**Q26. What ordering and delivery hazards exist in in-process event systems?**

<details><summary>Answer</summary>

Three big ones. **Ordering isn't guaranteed** across independent async operations — two `fetch`es can resolve in either order, causing "search-as-you-type shows stale results" bugs; fix with a request token / sequence number or `AbortController`. **Events can be lost** — a listener attached *after* an event fired never sees it, and an event emitted with no listener attached vanishes (in-process `EventEmitter` is fire-and-forget, unlike a durable broker). **Re-entrancy** — a handler that emits an event triggering itself, or mutates the listener list mid-`emit`, creates infinite loops or listeners that fire-or-not depending on timing. The theme: event-driven code makes *timing and order* explicit concerns you must reason about; sequential code hands you ordering for free.
</details>

**Q27. The event loop is "concurrent but not parallel." Explain, and when does that bite?**

<details><summary>Answer</summary>

Concurrency = many tasks *in progress*, interleaved; parallelism = many tasks *executing at the same instant* on multiple cores. The loop gives concurrency (thousands of in-flight I/O operations) but runs one instruction stream at a time — no parallelism. It bites for **CPU-bound** work: the loop can't make a hot computation faster, and worse, that computation *blocks every other task* while it runs. The fix is to add parallelism *around* the loop — `worker_threads`, multiple processes (one loop per core, the Nginx/Node pattern), or offloading to a thread pool — not to expect the loop itself to parallelize. "Concurrency for waiting, parallelism for computing" is the slogan.
</details>

---

## Internals & Scale / Professional / Staff

> The kernel-level mechanism, the patterns, and production servers.

**Q28. What is the reactor pattern? How does the proactor differ?**

<details><summary>Answer</summary>

**Reactor** (readiness-based): the loop waits for the OS to signal "this FD is *ready* for I/O," then the *application* performs the now-non-blocking read/write itself and dispatches to a handler. Backed by `epoll`/`kqueue`/`select`; used by Node/libuv, Nginx, Netty, libevent. **Proactor** (completion-based): the application *initiates* an async operation with a buffer, the OS performs the *entire* I/O (including the data transfer) in the background, and signals "*done*, here's the result." Backed by Windows IOCP, `io_uring`, POSIX AIO. The difference is **who does the data transfer** — the app (reactor) or the OS (proactor) — and whether the signal means "ready" or "complete." Both are demultiplexer + dispatcher patterns fanning many event sources to handlers on one thread.
</details>

**Q29. What OS mechanism makes a single thread able to watch 10,000 sockets, and why not `select`?**

<details><summary>Answer</summary>

Scalable **readiness notification**: `epoll` (Linux), `kqueue` (BSD/macOS), IOCP (Windows), `io_uring` (modern Linux). You register interest in FDs *once*, then a single call returns *only the FDs that are ready* — cost scales with the number of *active* connections, not *total*. `select`/`poll` don't scale because they take the *entire* FD set on *every* call and scan it linearly (O(n) per wait), so at 10k mostly-idle FDs they spend all their time rescanning. `epoll`'s register-once-then-get-only-ready model is the kernel feature that makes the C10k-scale event loop possible. The loop's idle `epoll_wait` is also exactly where the process *sleeps* at ~0% CPU.
</details>

**Q30. What was the C10k problem, and how did event-driven servers answer it?**

<details><summary>Answer</summary>

C10k (Dan Kegel, 1999): how to serve 10,000 concurrent connections on one machine. The then-dominant **thread-per-connection** model doesn't scale — each thread needs ~1–8 MB of stack (GBs for 10k), the scheduler chokes on 10k runnable threads, and most are *blocked waiting on the network*, wasting a stack and a scheduler slot to do nothing. The event-driven answer inverts it: **one thread (per core), many connections** — a single loop asks the OS which sockets are ready and processes only those, with no per-connection stack or context switch, dropping memory from megabytes to kilobytes per connection. The modern refinement is **green threads** (goroutines, virtual threads): thread-per-connection's readability over the event loop's scalability, by multiplexing lightweight threads onto few OS threads atop the same `epoll`.
</details>

**Q31. Why is Redis single-threaded, and how is that *fast*?**

<details><summary>Answer</summary>

Redis processes commands on a single-threaded event loop because it's **in-memory** — commands are microsecond-fast, so the bottleneck is network I/O, not CPU, and a single loop saturates that easily. Single-threaded execution is a *feature*: no locks, no contention, and **every command is atomic for free** (run-to-completion means a command can't be interrupted mid-way). That lock-free simplicity is also why Redis is so predictable. It later added *threaded I/O* (parallelizing socket reads/writes) and *background threads* (for `UNLINK`, persistence), but *command execution* stays single-threaded by design. It's the loop's "no data races" gift turned into an architecture.
</details>

**Q32. What is backpressure, and what happens without it?**

<details><summary>Answer</summary>

Backpressure is the mechanism that propagates "I'm full, slow down" from a slow **consumer** back to a fast **producer**. Without it, events arrive faster than handlers process them, the queue/buffer grows unbounded, latency climbs, and the process eventually OOMs — the unbounded buffer just defers the crash. Forms: **demand signaling** (consumer requests N items; Reactive Streams' `request(n)`), **bounded buffers with pause/resume** (Node's `writable.write()` returns `false` = "buffer full," `'drain'` = "resume" — honoring that return value *is* backpressure), and **load shedding** (when you can't slow the producer, drop/reject deliberately — 503s, sampling). The rule: every event pipeline needs a *bound* and a *policy at the bound*.
</details>

**Q33. What's an "event storm," and how do you defend against one?**

<details><summary>Answer</summary>

An event storm is an acute flood that overwhelms the loop: a thundering herd of reconnects after an outage, a feedback loop where handling one event emits several more, or a retry storm. The queue explodes, latency spikes, and the system can topple. Defenses: **rate limiting / throttling** (cap events per unit time), **debouncing / coalescing** (collapse a burst of "changed" events into one), **circuit breakers** (stop calling a failing dependency), **bounded concurrency** (cap in-flight operations), and **jittered backoff** on retries (so clients don't synchronize). The unifying idea is the same as backpressure: bound everything and have a deliberate policy for what happens at the bound.
</details>

**Q34. "One loop per core, multiple processes for parallelism" — explain this production pattern.**

<details><summary>Answer</summary>

A single event loop saturates exactly *one* CPU core (it's one thread of execution), so on an 8-core box a single-process event-driven server uses 1/8 of the machine. The mature pattern is **one event loop per core for concurrency, multiple processes for parallelism**: run N worker processes (≈ core count), each with its own loop, behind a load balancer or shared listening socket. Nginx does this (worker-per-core, each an `epoll` loop); Node does it via the `cluster` module or a process manager. You get the loop's per-core efficiency *and* full-machine parallelism. It also isolates failures — one crashed worker doesn't take down the others.
</details>

---

## Programming vs Architecture

> The most-confused boundary in the topic.

**Q35. Event-driven *programming* vs event-driven *architecture* — what's the difference?**

<details><summary>Answer</summary>

Same instinct ("react to events instead of calling directly"), different scale and discipline. **Event-driven programming** is *in-process*: one event loop, in-memory handlers, callbacks reacting to clicks/timers/I/O — a *programming paradigm*. **Event-driven architecture (EDA)** is *between services*: events flow over a durable **message broker** (Kafka, RabbitMQ, NATS), services publish/subscribe across a network — a *system-design discipline*. The hard problems differ: in-process worries about loop blocking, microtask ordering, callback structure; EDA worries about *network* concerns — delivery guarantees (at-least-once/exactly-once), ordering across partitions, idempotency, the dual-write problem, schema evolution. Conflating them is the classic mistake: treating an in-process emitter like a durable broker (expecting replay it doesn't have), or treating a distributed system like an in-process loop (forgetting idempotency).
</details>

**Q36. How does in-process `EventEmitter` differ from a message broker like Kafka?**

<details><summary>Answer</summary>

`EventEmitter` is **synchronous, in-memory, fire-and-forget**: `emit` calls listeners inline on the current stack; if no one's subscribed at emit time, the event is *gone* — no persistence, no replay, no buffering, no cross-process reach. A broker is **asynchronous, durable, decoupled in time and space**: it *persists* events (replay, late subscribers can catch up), *buffers* producer/consumer speed mismatches (backpressure), spans *processes and machines*, and offers *delivery guarantees* and *ordering* semantics. They're the same Observer/pub-sub *shape* at radically different scales — one for decoupling within a program, one for decoupling a distributed system in time and space.
</details>

**Q37. How do the senior-level hazards (lost events, ordering) reappear at the architecture level?**

<details><summary>Answer</summary>

They recur but get *network-scale* answers. **Lost events** in-process (no listener at emit time) become *delivery guarantees* in EDA — durable logs and at-least-once delivery ensure no event is dropped, paid for with possible duplicates (hence **idempotent** consumers). **Ordering** that's unguaranteed across in-process async ops becomes *partition-key ordering* in Kafka (ordered within a partition, not across). **Error leakage** becomes *dead-letter queues* and *retry topics*. **Re-entrancy / coordination** becomes *sagas* (choreographed or orchestrated distributed transactions). The instinct to "make timing and order explicit" is the same; the toolbox scales from `AbortController` and correlation IDs to partition keys, DLQs, and idempotency keys.
</details>

---

## Curveballs

> Questions designed to catch glib answers.

**Q38. "Node is single-threaded" — is that actually true?**

<details><summary>Answer</summary>

Layered. *Your JavaScript* runs on a single thread (one V8 isolate, one event loop), so application code never races against itself — true and load-bearing. But the **runtime is not single-threaded**: libuv maintains a thread pool (default 4) for operations the OS can't do via readiness notification — file system I/O, DNS lookups (`getaddrinfo`), and CPU-bound crypto/zlib — and delivers their results back as events. And you can spawn real parallelism via `worker_threads` or multiple processes. So the honest statement is "*your JS executes on one thread; the runtime uses more behind the scenes, and you can add parallelism explicitly.*" Saying just "single-threaded" without the caveats signals a shallow model.
</details>

**Q39. If the loop is single-threaded, can event-driven code still have race conditions?**

<details><summary>Answer</summary>

Yes — **logical** races, even without *memory* races. Run-to-completion prevents two handlers from corrupting a variable simultaneously, but it does *not* prevent bad *interleaving* across `await` points. Between `const x = await read()` and a later `await write(x)`, the loop runs *other* tasks, which may change shared state — so two async functions can interleave to produce a lost update, a double-spend, or stale data, exactly like a TOCTOU race. Example: two requests both `await checkBalance()` (sees 100), both proceed to `await debit(80)` — overdrawn. The fix isn't a memory lock (pointless on one thread) but a *logical* one: serialize the critical section, use an atomic operation, or hold a per-resource async mutex. "Single-threaded" kills *data* races, not *logical* ones.
</details>

**Q40. Isn't an event loop just polling with extra steps?**

<details><summary>Answer</summary>

No — that's the trap. Naive polling *spins* in user space asking "ready yet?" and burns CPU. An event loop's wait (`epoll_wait`/`kqueue`) is a *blocking* syscall: the thread is **descheduled by the kernel** and uses *zero* CPU until the kernel itself wakes it because an FD became ready. The "loop" only iterates when there's *actual work*; when idle it's asleep, not spinning. So it's the inverse of polling: instead of the application repeatedly checking, the kernel notifies. (There's a niche exception — *busy-poll* / spin-wait modes in ultra-low-latency networking deliberately spin to shave microseconds — but that's a special case, not how general event loops work.)
</details>

**Q41. Does `EventEmitter`'s `emit` run listeners on the next tick?**

<details><summary>Answer</summary>

No — `emit` is **synchronous**. It iterates the registered listeners and calls them *immediately*, in registration order, on the *current* call stack, before `emit` returns. People assume it defers (like `setTimeout`) because "events" feel asynchronous, but `EventEmitter` is purely a *decoupling* mechanism, not a *deferral* one. If you genuinely need deferral, you wrap the call in `setImmediate`/`process.nextTick`/`queueMicrotask` yourself. This trips people up when a listener throws — because it's synchronous, the throw propagates right back through the `emit` call site.
</details>

**Q42. Why did async/await become popular if it's "just" sugar over the same loop?**

<details><summary>Answer</summary>

Because *ergonomics are not cosmetic* — they change what code is maintainable. async/await restores the property that **the text reads as the timeline** (top-to-bottom sequence) and that **`try/catch` works across async steps**, eliminating callback-hell nesting and per-level error handling. That's a massive readability and correctness win for *linear* async flows, even though the runtime behavior is identical to promises. But it's a *leaky* abstraction with real costs: it can hide that you're on a cooperative loop (`await` in a loop silently serializes; CPU work between awaits blocks), and it splits a codebase into "colored" sync/async functions (Bob Nystrom's "What Color Is Your Function?"). Strong answer: it's sugar that genuinely improved the human side, with caveats a senior names.
</details>

---

## Rapid-Fire / One-Liners

> Crisp answers; what an interviewer wants in a sentence or two.

**Q43. Inversion of control in one line?**

<details><summary>Answer</summary>

The framework calls your code, not vice versa — "don't call us, we'll call you."
</details>

**Q44. Microtask vs macrotask ordering in one line?**

<details><summary>Answer</summary>

After each macrotask, *all* microtasks (promises) drain before the next macrotask — so promises beat `setTimeout`.
</details>

**Q45. What blocks the event loop, in one phrase?**

<details><summary>Answer</summary>

Any synchronous CPU-bound or blocking work in a handler — it stalls every other event until it returns.
</details>

**Q46. Reactor vs proactor in one line?**

<details><summary>Answer</summary>

Reactor = OS says "ready," *you* do the I/O (`epoll`); proactor = OS says "done," the *OS* did the I/O (IOCP).
</details>

**Q47. Concurrency vs parallelism for an event loop?**

<details><summary>Answer</summary>

The loop gives concurrency (many in-flight) but not parallelism (one core); add processes/workers for parallelism.
</details>

**Q48. Is `await` blocking?**

<details><summary>Answer</summary>

No — it suspends the function and yields to the loop, resuming later when the promise resolves.
</details>

**Q49. One-line difference: event-driven programming vs architecture?**

<details><summary>Answer</summary>

Programming = one in-process loop + handlers; architecture = events between services over a durable broker.
</details>

**Q50. The OS call that lets one thread watch thousands of sockets?**

<details><summary>Answer</summary>

`epoll` (Linux) / `kqueue` (BSD/macOS) / IOCP (Windows) — register once, get back only the ready FDs.
</details>

**Q51. The defining downside of run-to-completion?**

<details><summary>Answer</summary>

One slow handler blocks the entire loop — cooperative scheduling has no preemption.
</details>

---

## How to Talk About Event-Driven Programming in Interviews

A few habits separate a strong answer from a textbook recital:

- **Lead with the model, derive the rest.** "Single thread, one queue, run handlers to completion" explains *everything* — single-threaded-yet-concurrent, the slow-handler problem, lock-free atomicity, promise-vs-timer ordering. Derive answers from it instead of memorizing them separately.
- **Keep "concurrency" and "parallelism" crisp.** The loop is concurrent, not parallel. Conflating them is an instant tell; "concurrency for waiting, parallelism for computing" is a quick credibility win.
- **Say `await` yields, it doesn't block.** And that async/await is sugar over promises over callbacks over the loop. This shows you understand the machine, not just the syntax.
- **Name the trade-off every time.** I/O-bound + responsiveness → event-driven; linear logic → sequential; CPU-bound parallelism → threads. Absolutism ("Node is always faster," "callbacks are always bad") is a calibration miss.
- **Draw the programming-vs-architecture line unprompted.** Distinguishing the in-process loop from distributed EDA — and noting the hazards recur with network-scale answers — signals senior breadth.
- **Go to the kernel when invited.** `epoll`/`kqueue` readiness, the reactor pattern, C10k, libuv's thread pool, one-loop-per-core — these show you know what runs under the abstraction.
- **Trace ordering puzzles out loud, by phase.** Don't guess the output; walk the stack → microtask drain → next macrotask sequence. It demonstrates the model is *operational* for you, not memorized.

---

## Summary

- **Event-driven programming** registers handlers and hands control to an **event loop** that calls them — **inversion of control** ("don't call us, we'll call you"). It beats **polling** because an idle loop parks at ~0% CPU and one loop watches many sources.
- The load-bearing model is **single-threaded, one queue, run-to-completion**. From it everything follows: Node is **single-threaded yet concurrent** (non-blocking I/O, concurrency without parallelism), a **slow handler blocks everything** (cooperative scheduling, no preemption), and you get **lock-free atomicity** (Redis's design) for free.
- **Ordering** splits into **microtasks** (promises, drained fully after each task) vs **macrotasks** (timers/I/O, one per tick) — so promises beat `setTimeout`. **`async/await`** is sugar over promises over callbacks over the *same* loop; `await` **yields**, it doesn't block.
- The **trade-off**: great for **I/O-bound concurrency** and **responsiveness**, painful for **linear logic** (use sequential) and **CPU-bound parallelism** (use threads/processes). The costs — fragmented control flow, useless stack traces, the slow-handler hazard, async error leakage, ordering/lost-event bugs — are mitigated by named handlers, correlation IDs, offloading CPU work, and explicit backpressure.
- At **scale**, the loop sits on **`epoll`/`kqueue`/IOCP** (the C10k answer), formalized as the **reactor**/**proactor** patterns, embodied in **Nginx/Redis/Node**, deployed as **one loop per core + multiple processes**, and guarded by **backpressure** against **event storms**.
- Keep the **programming vs architecture** line bright: the in-process loop is a *paradigm*; **event-driven architecture** (brokers, pub/sub, event sourcing, sagas) is a *system-design discipline* where the same hazards recur with network-scale answers (delivery guarantees, partition ordering, idempotency).

---

## Related Topics

- [`junior.md`](junior.md) — handlers, the loop, inversion of control, events vs polling.
- [`middle.md`](middle.md) — the loop model, Node phases, micro/macrotasks, `EventEmitter`, async layers.
- [`senior.md`](senior.md) — trade-offs, debugging inverted flow, the slow-handler problem, async error handling.
- [`professional.md`](professional.md) — `epoll`/`kqueue`, reactor/proactor, C10k, Nginx/Redis/Node, backpressure, EDA.
- [05 — Reactive Programming](../05-reactive-programming/) — composable event streams with backpressure.
- [07 — Actor Model & CSP](../07-actor-model-and-csp/) — message-passing concurrency and green threads.
- [Concurrency, Async & Parallelism](../../language-internals/concurrency-async-parallel/) — the mechanics of async runtimes and schedulers.
- [Event-Driven Architecture](../../../Architecture/system-design/) — the distributed cousin (system design).
