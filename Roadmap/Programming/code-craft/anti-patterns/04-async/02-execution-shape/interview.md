# Async Execution-Shape Anti-Patterns — Interview Q&A

> **Category:** [Async Anti-Patterns](../README.md) → **Execution Shape** — *async control flow that runs differently than the code reads.*
> **Covers (collectively):** `await` in a Loop · Promise Chain Hell / Callback Pyramid · Mixing Callbacks and Promises

A bank of 60+ interview questions and answers spanning concurrency fundamentals, parallel-vs-sequential decisions, bounded concurrency, callback→promise migration, event-loop internals, and latency math. Each answer models the reasoning a strong candidate gives — including the trade-offs. Use the `<details>` toggles to self-quiz: read the question, answer out loud, then expand. Examples are JavaScript/TypeScript first, with Python `asyncio` where it sharpens the point.

---

## Table of Contents

1. [Fundamentals / Junior](#fundamentals--junior)
2. [Intermediate / Middle](#intermediate--middle)
3. [Senior — Backpressure, N+1, Migration, Cancellation](#senior--backpressure-n1-migration-cancellation)
4. [Professional / Deep — Event Loop, Latency Math, Zalgo](#professional--deep--event-loop-latency-math-zalgo)
5. [Code-Reading — Serialize vs Parallelize](#code-reading--serialize-vs-parallelize)
6. [Curveballs](#curveballs)
7. [Rapid-Fire / One-Liners](#rapid-fire--one-liners)
8. [How to Talk About Async in Interviews](#how-to-talk-about-async-in-interviews)
9. [Summary](#summary)
10. [Related Topics](#related-topics)

---

## Fundamentals / Junior

> Definitions, recognition, and the "why is it slow / why does it read wrong" reasoning.

**Q1. Name the three execution-shape anti-patterns and give a one-line symptom for each.**

<details><summary>Answer</summary>

- **`await` in a Loop** — `for (const x of xs) { await f(x) }` serializes N independent operations that could overlap; total time becomes the *sum* of the latencies instead of the *max*.
- **Promise Chain Hell / Callback Pyramid** — `.then(a => .then(b => .then(c => …)))` or nested callbacks marching rightward; intermediate values and error handling get tangled across closures.
- **Mixing Callbacks and Promises** — one API both takes a callback *and* returns a Promise, or hand-wraps a callback API and gets error/`this`/double-call semantics subtly wrong.

The common thread: the code's *shape on the page* doesn't match the *shape of its execution* — it looks parallel but runs serial, looks linear but nests, looks like one model but is two.
</details>

**Q2. What's the difference between concurrency and parallelism in an `async` runtime?**

<details><summary>Answer</summary>

**Concurrency** is dealing with many tasks by interleaving them — pausing one when it's waiting (on I/O) and running another. **Parallelism** is literally executing multiple things at the same instant on multiple cores. A single-threaded event loop (Node, the browser, Python `asyncio`) gives you **concurrency without parallelism**: while one `fetch` is in flight, the loop runs other JavaScript, but only one line of *your* JS executes at a time. This is exactly why `await`-in-a-loop is wasteful for I/O — you're idling the loop on each wait instead of overlapping the waits — yet why it does *not* speed up CPU-bound work, which still needs threads or worker processes.
</details>

**Q3. Why does `await` inside a `for` loop make a batch of requests slow?**

<details><summary>Answer</summary>

`await` suspends the function until *that one* Promise settles before the next iteration even starts the next request. So ten 100 ms requests run back-to-back: ~1000 ms total. The requests are independent — the network can carry them concurrently — but the loop forces them into a single-file line. The fix when they're independent is to *start them all*, then wait for all: `await Promise.all(items.map(f))`, which overlaps the waits so total time is ~max(latency) ≈ 100 ms, not the sum.
</details>

**Q4. What does `Promise.all` do, and what is its timing relative to a sequential loop?**

<details><summary>Answer</summary>

`Promise.all(promises)` takes an array of already-started Promises and returns a single Promise that resolves to an array of their results once *all* settle, in input order, or rejects as soon as *any one* rejects. Because the promises were already initiated (the work is in flight before `Promise.all` is called), the total wait is roughly the **slowest** task, not the sum. The key subtlety juniors miss: `Promise.all` doesn't *start* anything — the array elements must already be live promises. `Promise.all(urls.map(u => fetch(u)))` works because `.map` fires every `fetch` synchronously, then `all` just awaits them.
</details>

**Q5. Rewrite this to run in parallel, and explain when you would *not*.**

```js
const results = [];
for (const id of ids) {
  results.push(await getUser(id));
}
```

<details><summary>Answer</summary>

```js
const results = await Promise.all(ids.map(id => getUser(id)));
```

Each `getUser` fires immediately inside `.map`; `Promise.all` awaits them together, so latency drops from sum to max. You would *not* do this if the calls are **dependent** (each needs the previous result), if order-sensitive **side effects** matter, if the downstream service can't tolerate `ids.length` simultaneous requests (you'd overwhelm it — use bounded concurrency instead), or if you need **backpressure** to avoid buffering all results in memory at once.
</details>

**Q6. What's wrong with this Promise chain, and how does `async/await` improve it?**

```js
function load(id) {
  return getUser(id).then(user => {
    return getOrders(user).then(orders => {
      return getInvoices(orders).then(invoices => {
        return { user, orders, invoices };
      });
    });
  });
}
```

<details><summary>Answer</summary>

It nests because each step needs the *previous* values (`user`, `orders`) in scope, so the closures pyramid rather than flatten. The same logic with `async/await` reads as straight-line code with all values in one scope:

```js
async function load(id) {
  const user = await getUser(id);
  const orders = await getOrders(user);
  const invoices = await getInvoices(orders);
  return { user, orders, invoices };
}
```

Here the `await`-in-sequence is *correct* — the steps are genuinely dependent. The win is readability and unified error handling (`try/catch` wraps the whole thing), not parallelism.
</details>

**Q7. What does it mean that an `async` function "always returns a Promise"?**

<details><summary>Answer</summary>

The `async` keyword wraps the function's return value in a resolved Promise (and any thrown error in a rejected one). So `async function f() { return 1 }` returns `Promise<number>`, not `number` — callers must `await` it or `.then` it. This is why forgetting `await` is so common: `const x = f()` gives you a Promise, and using it like a value (`x.toFixed(2)`) fails or yields `undefined`. It's also why a function that does only synchronous work doesn't *need* `async` — adding it costs a microtask hop for no benefit (that's a separate "async without await" anti-pattern).
</details>

**Q8. In Python `asyncio`, what is the equivalent of `await`-in-a-loop, and how do you parallelize?**

<details><summary>Answer</summary>

Sequential (serialized) — each `await` finishes before the next begins:

```python
results = []
for url in urls:
    results.append(await fetch(url))
```

Parallel — schedule all coroutines, then gather:

```python
results = await asyncio.gather(*(fetch(url) for url in urls))
```

`asyncio.gather` is the rough analog of `Promise.all`: it schedules every coroutine on the loop and awaits them together, so total time approaches the slowest call. A subtlety: simply *creating* a coroutine (`fetch(url)`) does **not** start it — unlike a JS Promise, a Python coroutine only runs when awaited or wrapped in a `Task`/`gather`.
</details>

**Q9. What is a "callback pyramid" (callback hell), and what causes it?**

<details><summary>Answer</summary>

It's the staircase of nested callbacks you get when each async step's result is needed by the next, in a callback-based API:

```js
getUser(id, (err, user) => {
  getOrders(user, (err, orders) => {
    getInvoices(orders, (err, invoices) => { /* … */ });
  });
});
```

The cause is that callbacks have no native composition: to sequence step B after step A you must call B *inside* A's callback, so dependency depth becomes indentation depth. Error handling compounds it — each level repeats the `if (err)` check. Promises (and then `async/await`) exist precisely to flatten this into linear, composable code.
</details>

**Q10. What is `util.promisify` in Node, and why use it?**

<details><summary>Answer</summary>

`util.promisify` converts a Node-style "error-first callback" function — `fn(args…, (err, result) => …)` — into one that returns a Promise. `const readFile = util.promisify(fs.readFile)` lets you write `await readFile(path)` instead of nesting callbacks. You use it so you don't hand-roll the Promise wrapper (which people get subtly wrong: forgetting to reject on `err`, resolving twice, or losing `this`). It encodes the error-first convention correctly once. The point is to *pick one model* — promises — and convert the callback API into it, rather than mixing both.
</details>

**Q11. What does `Promise.all` reject behavior mean for the other in-flight promises?**

<details><summary>Answer</summary>

`Promise.all` rejects as soon as the *first* promise rejects, with that error — it does **not** wait for the rest. But it also does **not cancel** them: the other promises keep running to completion in the background (Promises aren't cancellable by default), their results are simply discarded, and if any of *them* later rejects, that rejection is unhandled and may surface as an `unhandledRejection`. So "Promise.all failed" doesn't mean the work stopped; it means you stopped *waiting*. If you need every result regardless of failures, use `Promise.allSettled`.
</details>

**Q12. Why is mixing a callback and a returned Promise in the same function a bug magnet?**

<details><summary>Answer</summary>

Because callers can't tell which mechanism is authoritative, and the function often fires both — invoking the callback *and* resolving the Promise — so the result is handled twice, or an error is reported via one channel while the other silently succeeds. Example: `function get(cb) { return fetch(url).then(r => { cb(null, r); return r; }) }` — a caller that `await`s it *and* a caller that passes `cb` both work, but a caller doing both double-handles, and a throw inside `cb` rejects the Promise confusingly. Rule: one async contract per function — either callback or Promise, never both.
</details>

---

## Intermediate / Middle

> Deciding parallel vs sequential, bounding concurrency, and clean conversions.

**Q13. How do you decide between sequential `await` and `Promise.all`?**

<details><summary>Answer</summary>

Ask: **does step N depend on step N−1's result?** If yes — chained data, ordered side effects, or "stop on first failure cheaply" — sequence them with `await` in order (or a chain). If no — the operations are independent — fire them together and `await Promise.all`. The trap is *accidental* sequencing: independent calls written as a loop run serially for no reason. The opposite trap is *unbounded* parallelism: independent but numerous calls fired all at once can overwhelm the callee or your own memory. So it's three-way: dependent → sequential; independent and few → `Promise.all`; independent and many → bounded concurrency.
</details>

**Q14. Show two independent awaits done wrong (serial) and right (parallel).**

<details><summary>Answer</summary>

Wrong — serial, ~sum of latencies:

```js
const user = await getUser(id);     // waits 100ms
const config = await getConfig();   // then waits 80ms  → 180ms total
```

Right — parallel, ~max latency, because both start before either is awaited:

```js
const [user, config] = await Promise.all([getUser(id), getConfig()]);  // ~100ms
```

The two calls share no dependency, so launching them together and awaiting both halves-ish the latency. This "two sequential awaits that don't depend on each other" is the single most common real-world instance of the anti-pattern.
</details>

**Q15. What is bounded concurrency and why do you need it?**

<details><summary>Answer</summary>

Bounded concurrency caps how many async operations are *in flight at once* — say, at most 10 of 10,000. You need it because unbounded `Promise.all` over a large list opens all N operations simultaneously: that can exhaust file descriptors or sockets, trip the callee's rate limits, blow your memory holding N pending results, and actually run *slower* due to contention. A concurrency limit of N gives you a sliding window: as one finishes, the next starts, keeping exactly N busy. It's the middle ground between "one at a time" (slow) and "all at once" (overload).
</details>

**Q16. How do you bound concurrency to N in JavaScript?**

<details><summary>Answer</summary>

The pragmatic answer: a library like `p-limit`.

```js
import pLimit from "p-limit";
const limit = pLimit(10);
const results = await Promise.all(items.map(it => limit(() => work(it))));
```

`limit()` wraps each task so no more than 10 of the underlying functions run concurrently; the rest queue. Hand-rolled, you maintain a pool of N worker loops pulling from a shared index, or a counting semaphore that you acquire before each task and release in a `finally`. The key properties: exactly N in flight, the rest queued not dropped, and errors propagated (decide `Promise.all` fail-fast vs `allSettled` collect-all). In Python: `asyncio.Semaphore(N)` acquired with `async with` around each task.
</details>

**Q17. Convert this callback API to a Promise correctly, and name the pitfalls of doing it by hand.**

```js
db.query("SELECT 1", (err, rows) => { /* ... */ });
```

<details><summary>Answer</summary>

Preferred: `const query = util.promisify(db.query.bind(db));` then `await query("SELECT 1")`. By hand:

```js
const query = (sql) => new Promise((resolve, reject) => {
  db.query(sql, (err, rows) => (err ? reject(err) : resolve(rows)));
});
```

Pitfalls people hit hand-rolling this: (1) forgetting `reject(err)`, so failures hang forever; (2) losing `this` — `db.query` may need binding; (3) calling `resolve`/`reject` more than once if the callback can fire twice; (4) for callbacks that yield *multiple* values, `promisify` only captures the first unless you customize it; (5) wrapping a function that *also* returns a Promise (double model). Use `promisify` so the convention is encoded once and correctly.
</details>

**Q18. What's the difference between `Promise.all`, `Promise.allSettled`, and `Promise.race`?**

<details><summary>Answer</summary>

- **`Promise.all`** — resolves with all results once *all* fulfill; rejects on the *first* rejection (fail-fast). Use when you need every result and any failure should abort.
- **`Promise.allSettled`** — never rejects; resolves with an array of `{status, value}` / `{status, reason}` for *every* input, settled or not. Use when you want all outcomes regardless of partial failures (e.g. "fan out to 50 services, report which succeeded").
- **`Promise.race`** — settles as soon as the *first* promise settles (fulfilled *or* rejected), adopting its outcome. Use for timeouts (`race([work, timeout])`) and "first wins."

There's also **`Promise.any`** — resolves on the first *fulfillment*, ignoring rejections until all reject (then `AggregateError`).
</details>

**Q19. How do you add a timeout to an async operation?**

<details><summary>Answer</summary>

Race the work against a timer that rejects:

```js
const withTimeout = (p, ms) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
```

But note the underlying work is **not cancelled** — `race` just stops you waiting; the original Promise keeps running and its eventual result/rejection is discarded (and a late rejection may go unhandled). For true cancellation you need the operation to honor an `AbortSignal` (e.g. `fetch(url, { signal })`) and abort it when the timer fires. In Python: `asyncio.wait_for(coro, timeout)`, which *does* cancel the coroutine on timeout by raising `CancelledError` into it.
</details>

**Q20. When is `await`-in-a-loop the *correct* choice?**

<details><summary>Answer</summary>

When iterations are **dependent** (each needs the previous result — pagination cursors, a state machine, "insert parent then children"), when you must enforce **ordering of side effects** (write A before B), or when you deliberately want **backpressure / rate control** (process one item at a time so you don't overwhelm a downstream system or buffer everything in memory). It's also correct when iterating an **async iterator** where items aren't all available up front (`for await (const chunk of stream)`). The anti-pattern is *only* when the iterations are independent and parallelizable — then serialization is wasted latency.
</details>

**Q21. What's the bug in `forEach` with an async callback?**

```js
items.forEach(async (it) => { await save(it); });
console.log("done");  // prints before saves finish
```

<details><summary>Answer</summary>

`Array.prototype.forEach` ignores the return value of its callback, so it does **not** await the `async` callback — it fires all the (now floating) promises and returns immediately. `"done"` prints before any `save` completes, errors inside become unhandled rejections, and you've lost all sequencing and error propagation. Fix: use `for...of` with `await` if you want sequential, or `await Promise.all(items.map(save))` if you want parallel. `forEach` simply has no async-aware variant; this is a top-five real-world async bug.
</details>

**Q22. Flatten this chain and explain what you preserved.**

```js
fetch(url)
  .then(r => r.json())
  .then(data => transform(data))
  .then(result => save(result))
  .catch(err => log(err));
```

<details><summary>Answer</summary>

```js
async function run() {
  try {
    const r = await fetch(url);
    const data = await r.json();
    const result = transform(data);
    await save(result);
  } catch (err) {
    log(err);
  }
}
```

This is a *correct* chain (dependent steps), so flattening to `async/await` is about readability, not parallelism. Preserved: the same sequential dependency, and the single `.catch` becomes one `try/catch` covering every `await` (a rejection at any step jumps to the handler). The chain wasn't "hell" — it was linear — but `async/await` reads better and lets you `await` in conditionals/loops naturally. Chain *hell* is specifically *nested* `.then`s, which is what you must avoid.
</details>

**Q23. In Python, how is sequential vs concurrent expressed, and what's the `gather` gotcha?**

<details><summary>Answer</summary>

Sequential: `for x in xs: await f(x)`. Concurrent: `await asyncio.gather(*(f(x) for x in xs))`. The gotcha: by default `gather` is **fail-fast on the first exception** — it returns/raises that exception and the remaining tasks keep running (unless you pass `return_exceptions=True`, which makes it collect exceptions as results, analogous to `allSettled`). Also, if a `gather` is cancelled, you must handle cancellation of the children carefully. For structured guarantees, modern code prefers `asyncio.TaskGroup` (3.11+), which cancels siblings on failure and won't let tasks outlive the block.
</details>

**Q24. What is `for await...of` and when do you reach for it?**

<details><summary>Answer</summary>

`for await (const item of asyncIterable)` consumes an **async iterator** — a source that yields promises one at a time, like a paginated API, a Kafka consumer, or a Node stream. You reach for it when data arrives incrementally and you want to process each piece as it lands, *with* natural backpressure: the loop body's `await` pauses consumption until you're ready for the next item. This is the legitimate, intentional cousin of `await`-in-a-loop — here serialization is the *point* (stream the data, don't buffer it all), not an accident.
</details>

---

## Senior — Backpressure, N+1, Migration, Cancellation

> Production-scale concerns: overload, the async N+1, large migrations, and cancellation.

**Q25. What is backpressure, and how does unbounded `Promise.all` violate it?**

<details><summary>Answer</summary>

Backpressure is the feedback that keeps a fast producer from overwhelming a slower consumer — the system slows intake to match what downstream can handle. `Promise.all(hugeList.map(callApi))` violates it by starting *every* operation at once: it ignores how many requests the callee can absorb, holds all N pending promises (and eventually all N results) in memory, and may exhaust sockets/file descriptors. There's no signal back to the producer to slow down. The cure is to *create* the backpressure yourself with bounded concurrency (a semaphore / `p-limit` / worker pool) so only N run at a time and the rest wait — matching production rate to capacity.
</details>

**Q26. Explain the async N+1 problem and how DataLoader solves it.**

<details><summary>Answer</summary>

The async N+1: you fetch a list (1 query), then loop and fetch a related entity per item (N queries) — often as `await`-in-a-loop, so it's both serialized *and* chatty. Even parallelized with `Promise.all`, it's N individual round-trips. **DataLoader** (Facebook's pattern, ubiquitous in GraphQL resolvers) fixes it with **batching + caching**: instead of issuing each `load(id)` immediately, it collects all `load` calls made within the same tick into one batch and dispatches a single `loadMany([ids])` (`SELECT … WHERE id IN (…)`), then distributes results back. It also memoizes per request so duplicate ids hit once. So N+1 round-trips collapse to 1+1, without the call sites knowing.
</details>

**Q27. How do you migrate a large callback-based codebase to Promises/async-await safely?**

<details><summary>Answer</summary>

Incrementally, from the leaves up. (1) **Wrap at the boundary** — `promisify` the lowest-level callback APIs (DB driver, fs) so you have Promise-returning primitives, without changing call sites yet. (2) **Convert one call chain at a time**, leaf functions first, each behind tests, keeping the public callback signature via a thin adapter (`(cb) => promiseFn().then(r => cb(null, r), cb)`) so callers are unaffected. (3) **Migrate callers** to await the new Promise API, then delete the adapter. (4) **Avoid the mixed state** — never have a function expose both at once except transiently behind an adapter. (5) Add a linter (`no-floating-promises`, `require-await`) so new code can't regress. Keep structural conversion and behavior changes in separate commits.
</details>

**Q28. Promises aren't cancellable by default — how do you cancel async work in practice?**

<details><summary>Answer</summary>

You cancel the *underlying operation*, not the Promise. The standard mechanism is `AbortController`/`AbortSignal`: create a controller, pass `controller.signal` to operations that honor it (`fetch`, many libraries, timers via `AbortSignal.timeout`), and call `controller.abort()` to make them reject with `AbortError`. The awaiter still has to handle that rejection. Patterns: wire one signal through a request scope so cancelling the request aborts all its children; race a Promise against `abort`. In Python, `asyncio` *does* support cancellation natively — `task.cancel()` raises `CancelledError` into the coroutine at the next `await`, and `TaskGroup`/`wait_for` use it — which is cleaner than JS's bolt-on signal model.
</details>

**Q29. Design a fan-out to 5,000 URLs that's fast but won't melt the target or your process.**

<details><summary>Answer</summary>

Bounded concurrency with retries, timeout, and partial-failure handling:

```js
import pLimit from "p-limit";
const limit = pLimit(20);                       // cap in-flight
const fetchOne = (url) =>
  withRetry(() => withTimeout(fetch(url, { signal: AbortSignal.timeout(5000) }), 5000), 3);
const results = await Promise.allSettled(
  urls.map(url => limit(() => fetchOne(url)))
);
```

Key decisions: **bound** to ~20 in flight (tune to the callee's limits and your sockets); per-request **timeout** + **abort** so a hung URL doesn't pin a slot; **retry with backoff + jitter** for transient failures; **`allSettled`** so one bad URL doesn't abort the other 4,999; stream/aggregate results rather than buffering raw bodies if memory matters. This is the production shape: not a naked `Promise.all`, not a serial loop.
</details>

**Q30. How does rate limiting differ from concurrency limiting, and when do you need both?**

<details><summary>Answer</summary>

**Concurrency limiting** caps *simultaneous* in-flight operations (at most N at once). **Rate limiting** caps operations *per unit time* (at most R per second), regardless of how many are concurrent. They're orthogonal: an API might allow only 5 concurrent connections *and* 100 requests/minute — fast requests could blow the rate cap while well under the concurrency cap. You often need both: a semaphore for concurrency plus a token-bucket/leaky-bucket throttle for rate. Many client libraries (`bottleneck`) combine them. The mistake is using a concurrency limit to *approximate* a rate limit — they only coincide if latency is constant.
</details>

**Q31. A reviewer sees `await` in a loop and says "always use Promise.all." How do you push back?**

<details><summary>Answer</summary>

Agree on the common case, correct the absolute. Yes — *independent* iterations should usually parallelize. But "always `Promise.all`" is wrong when iterations are **dependent** (need the prior result), when **ordering of side effects** matters, when you need **backpressure** (the loop is intentionally pacing a stream or sparing a downstream service), or when N is so large that `Promise.all` becomes *unbounded* overload. The senior framing: the loop's `await` is only an anti-pattern when the work is independent *and* the count is safe to fan out. Otherwise sequential — or *bounded* concurrency — is the correct shape. The reviewer's rule needs the qualifier "for independent, bounded work."
</details>

**Q32. How do you instrument and observe failures in fanned-out async work?**

<details><summary>Answer</summary>

Treat each task's outcome as data. Use `allSettled` (or `gather(return_exceptions=True)`) so you *collect* every result and rejection rather than aborting on the first; then aggregate: count successes/failures, log each rejection with the input that caused it (the id/URL), and emit metrics (success rate, latency histogram, retry count). For the in-flight pool, expose gauges: current concurrency, queue depth, time-in-queue — these reveal backpressure problems. Wrap tasks so a failure carries context (which item, which attempt). Without this, a fan-out is a black box: `Promise.all` either "worked" or threw one opaque error, hiding that 300 of 5,000 silently failed.
</details>

**Q33. Sequential awaits vs parallel: walk through the latency arithmetic for 3 calls of 100/200/150 ms.**

<details><summary>Answer</summary>

- **Sequential** (`await` each in turn): 100 + 200 + 150 = **450 ms** — you pay every latency end to end.
- **Parallel** (`Promise.all` of all three): **~200 ms** — the max, since all start together and you wait for the slowest.
- **Bounded to 2 concurrent**: start 100 & 200; the 100 ms finishes first → start 150 ms (now running alongside the remaining 100 ms of the 200 ms task); the 200 ms task ends at 200 ms, the 150 ms task ends at 100+150 = **250 ms** → total **250 ms**.

The lesson: parallel converts *sum* to *max*; bounding trades a little of that speedup for protection against overload. Senior candidates do this math out loud to justify the chosen shape.
</details>

**Q34. What's the danger of `await` inside a `try` that's inside a loop, for error handling?**

<details><summary>Answer</summary>

It's actually often *correct* and a reason to keep a loop: per-iteration `try/catch` lets you handle/skip a single failed item and continue, which a single `Promise.all` can't do (it fails fast). The danger is the opposite — a loop *without* per-item handling where one rejection throws out of the whole loop, abandoning remaining items mid-batch, possibly leaving partial state. So: if you want "process all, collect failures," either `try/catch` inside the loop or `allSettled` over a parallel map. Choose based on whether items are independent and whether you need them all attempted. Don't let the error-handling requirement silently force serialization you didn't intend.
</details>

---

## Professional / Deep — Event Loop, Latency Math, Zalgo

> Runtime internals, the cost model, and the subtle hazards.

**Q35. Walk through how the event loop schedules `await` continuations (microtasks vs macrotasks).**

<details><summary>Answer</summary>

When an `async` function hits `await p`, it suspends and registers its continuation as a **microtask** to run when `p` settles. After each macrotask (a timer callback, an I/O event, a script), the runtime drains the **entire microtask queue** before the next macrotask or render. So `Promise.then`/`await` continuations have *higher priority* than `setTimeout`/`setImmediate` (macrotasks). Consequences: a flood of resolved promises can **starve** macrotasks and rendering (the microtask queue must empty first); `await Promise.resolve()` yields to other microtasks but not to I/O. Understanding this explains why `Promise.all` of resolved values runs in a tight microtask burst, and why mixing timers and promises has non-obvious ordering.
</details>

**Q36. Concretely, what does unbounded `Promise.all` over a million items cost?**

<details><summary>Answer</summary>

Several real costs. **Memory:** N pending Promise objects plus their closures, *plus* every resolved result retained until all settle — `Promise.all` can't release early results, so peak memory is all N results at once (OOM risk). **Descriptors/sockets:** N concurrent `fetch`/DB calls can exhaust the OS fd limit or the connection pool, causing errors unrelated to your logic. **Callee overload:** you DDoS your own dependency, tripping its rate limits or degrading it for everyone. **Scheduling:** a giant microtask burst when many settle together starves the loop. **Slower, not faster:** beyond the point of useful parallelism, contention and context-switching make it slower than a bounded pool. The fix is always bounding + streaming results, never a naked `all` over a large list.
</details>

**Q37. What is "releasing Zalgo," and how do you avoid it?**

<details><summary>Answer</summary>

"Releasing Zalgo" (Isaac Schlueter's term) is writing an API that invokes its callback **sometimes synchronously and sometimes asynchronously** — e.g. it returns from cache *synchronously* but goes to disk *asynchronously*. This is dangerous because callers can't reason about ordering: code after the call may or may not have run before the callback; `this`/closure state may differ; bugs appear only on the cache-miss path. Avoid it by being **consistently async**: always defer the callback to a later tick (`process.nextTick`/`queueMicrotask`/`Promise.resolve().then`) even on the sync path. Promises enforce this by design — `.then` callbacks *always* run asynchronously (as microtasks), never synchronously — which is one reason promises are safer than raw callbacks.
</details>

**Q38. Why is hand-wrapping a callback in `new Promise` error-prone — name the specific failure modes.**

<details><summary>Answer</summary>

(1) **Swallowed errors:** a `throw` inside the executor *before* the async call rejects the Promise, but a throw inside the callback does *not* — it becomes an uncaught exception. (2) **Double settle:** if the callback can fire twice, you call `resolve`/`reject` twice; the second is silently ignored, hiding bugs. (3) **Never settling:** forgetting to handle the `err` branch leaves the Promise pending forever (a leak). (4) **`this` loss** when wrapping a method. (5) **The Promise-constructor anti-pattern:** wrapping something that's *already* a Promise in `new Promise`, which loses rejection propagation. `util.promisify` (or library equivalents) encodes the error-first convention once and correctly — prefer it over hand-rolling.
</details>

**Q39. How do async iterators provide backpressure that `Promise.all` cannot?**

<details><summary>Answer</summary>

An async iterator yields **one value at a time, on demand** — the consumer's `for await` body must finish (its `await` resolves) before the iterator is asked for the next value. That pull-based cadence *is* backpressure: a slow consumer naturally slows the producer, and only a bounded amount of data is in memory at once. `Promise.all`, by contrast, is push-based and eager — it materializes *all* operations and *all* results simultaneously, with no feedback to slow intake. So for large or unbounded streams you use async iterators (or streams) to process incrementally; `Promise.all` is for small, bounded, all-at-once fan-outs where holding everything is fine.
</details>

**Q40. Does `async/await` add measurable overhead versus a raw Promise chain?**

<details><summary>Answer</summary>

A little, and almost never enough to matter. Each `await` introduces at least one microtask hop and the engine generates a state machine to suspend/resume the function, with some allocation. Modern V8 has heavily optimized this (no extra throwaway promises per `await` since the spec change around Node 12), so the gap versus `.then` chains is tiny. The cases where it shows up: extremely hot loops with `await` on already-resolved values (you're paying microtask hops for nothing — hoist the await out, or don't make the function async), and very high-throughput servers where micro-overheads compound. For ordinary I/O-bound code, the latency of the I/O dwarfs any await overhead — optimize the *shape* (parallel vs serial), not the keyword.
</details>

**Q41. What's the difference between scheduling with `queueMicrotask`, `setTimeout(0)`, and `setImmediate`?**

<details><summary>Answer</summary>

- **`queueMicrotask` / `Promise.resolve().then`** — runs on the **microtask** queue, drained fully after the current task and before any macrotask/render. Highest priority; risks starving macrotasks if you flood it.
- **`setTimeout(fn, 0)`** — a **macrotask** (timer phase), runs after microtasks and after the minimum timer clamp (~1–4 ms in browsers); yields to I/O and rendering.
- **`setImmediate`** (Node) — a macrotask in the **check** phase, after the current poll phase completes; useful to defer work until after pending I/O callbacks.

You pick based on how urgently the deferred work must run relative to I/O and rendering. The relevance to anti-patterns: deferring a callback to *any* of these makes a sometimes-sync API consistently async (defeats Zalgo).
</details>

**Q42. In a single-threaded loop, when does parallelizing async calls *not* help — and what do you do instead?**

<details><summary>Answer</summary>

Parallelizing helps when the time is spent **waiting on I/O** (network, disk, DB) — overlapping the waits is free concurrency. It does **not** help when the time is spent in **CPU-bound JavaScript** (parsing, hashing, image processing): there's only one thread, so wrapping CPU work in promises just interleaves it without speeding it up — and `Promise.all` of CPU tasks runs them one after another anyway, possibly slower due to scheduling. For CPU-bound work you need real parallelism: **Worker Threads** (Node), **Web Workers** (browser), or `multiprocessing`/`ProcessPoolExecutor` (Python, to dodge the GIL). Diagnosis first: is this latency from waiting (parallelize) or computing (offload to a thread/process)?
</details>

**Q43. Why can `Promise.all` cause a memory spike that a sequential loop avoids?**

<details><summary>Answer</summary>

Because `Promise.all` holds the *entire* working set live at once: all N pending promises, all their closures/buffers, and — critically — every resolved result retained in the results array until the *last* one settles (it can't hand back partial results). If each result is large (a downloaded file, a big JSON blob), peak memory ≈ N × result-size. A sequential loop processes one item, lets it be garbage-collected, then moves on, so peak memory ≈ 1 × result-size. This is a core reason "just `Promise.all` everything" is wrong at scale: bounded concurrency or streaming caps peak memory while still overlapping I/O.
</details>

**Q44. How does `Promise.all`'s fail-fast interact with resource cleanup and "orphaned" work?**

<details><summary>Answer</summary>

When one promise rejects, `Promise.all` rejects immediately but the *other* operations keep running — they're orphaned: still consuming sockets/memory, and any later rejection among them is unhandled. So a naive `Promise.all` over operations that acquire resources (open files, DB transactions) can leak them on partial failure, because nothing cancels or cleans up the in-flight siblings. Robust code wires an `AbortController` so the first failure aborts the rest, and ensures each task cleans up in `finally`, or uses a structured construct (`asyncio.TaskGroup`) that cancels siblings on failure. "It rejected" must not be confused with "everything stopped."
</details>

---

## Code-Reading — Serialize vs Parallelize

> You're shown a snippet; identify the shape problem and give the fix.

**Q45. Which anti-pattern, and what's the fix?**

```js
async function totals(userIds) {
  let sum = 0;
  for (const id of userIds) {
    const balance = await getBalance(id);  // independent calls
    sum += balance;
  }
  return sum;
}
```

<details><summary>Answer</summary>

**`await` in a loop** over *independent* calls — serialized for no reason, so latency is the sum of all `getBalance` calls. Fix: fan out, then reduce.

```js
async function totals(userIds) {
  const balances = await Promise.all(userIds.map(getBalance));
  return balances.reduce((a, b) => a + b, 0);
}
```

If `userIds` could be huge, bound it (`pLimit`) instead of a naked `Promise.all`.
</details>

**Q46. Which anti-pattern, and what's the fix?**

```python
async def load_all(ids):
    out = []
    for i in ids:
        out.append(await fetch_item(i))
    return out
```

<details><summary>Answer</summary>

**`await` in a loop** (Python flavor) — `fetch_item` calls are independent but run one after another. Fix with `gather`:

```python
async def load_all(ids):
    return await asyncio.gather(*(fetch_item(i) for i in ids))
```

For a large `ids`, wrap each in a `Semaphore` to bound concurrency, and consider `return_exceptions=True` if one failure shouldn't abort the rest.
</details>

**Q47. Which anti-pattern, and what's the fix?**

```js
function getProfile(id, cb) {
  return fetchUser(id).then(user => {
    cb(null, user);     // also calls back
    return user;        // and returns a promise
  });
}
```

<details><summary>Answer</summary>

**Mixing callbacks and Promises** — the function both invokes `cb` *and* returns a Promise, so callers can't tell which is canonical, and a caller using both double-handles. Also, a throw inside `cb` rejects the returned Promise confusingly. Fix: pick one model — return the Promise only:

```js
function getProfile(id) {
  return fetchUser(id);
}
```

Callers that need a callback can adapt at the edge, but the core API exposes a single contract.
</details>

**Q48. Which anti-pattern, and what's the fix?**

```js
getUser(id, (e, user) => {
  if (e) return done(e);
  getOrders(user, (e, orders) => {
    if (e) return done(e);
    getInvoices(orders, (e, invoices) => {
      if (e) return done(e);
      done(null, { user, orders, invoices });
    });
  });
});
```

<details><summary>Answer</summary>

**Callback pyramid** — dependent steps nested as callbacks, with the `if (e) return` error check repeated at each level (the staircase). Fix: promisify the APIs and use `async/await`:

```js
async function load(id) {
  const user = await getUser(id);
  const orders = await getOrders(user);
  const invoices = await getInvoices(orders);
  return { user, orders, invoices };
}
```

One `try/catch` (or the caller's) replaces the three repeated error checks; the sequential awaits are correct because the steps are genuinely dependent.
</details>

**Q49. Which anti-pattern, and what's the fix?**

```js
const data = await Promise.all(
  millionIds.map(id => fetch(`/api/${id}`).then(r => r.json()))
);
```

<details><summary>Answer</summary>

**Unbounded `Promise.all`** — firing a million `fetch`es at once exhausts sockets, OOMs holding a million parsed bodies, and overloads the API. Fix: bound concurrency and tolerate partial failure.

```js
import pLimit from "p-limit";
const limit = pLimit(25);
const settled = await Promise.allSettled(
  millionIds.map(id => limit(() => fetch(`/api/${id}`).then(r => r.json())))
);
```

Better still, stream/process results incrementally rather than collecting all in memory. The bug isn't using `Promise.all` — it's using it *unbounded* over a large list.
</details>

**Q50. This snippet has a subtle serialization bug — find it.**

```js
async function summary(id) {
  const user = await getUser(id);
  const settings = await getSettings(id);   // does NOT use user
  return { user, settings };
}
```

<details><summary>Answer</summary>

`getSettings(id)` doesn't depend on `user`, yet it's awaited *after* `getUser`, so the two independent calls run serially — latency is the sum, not the max. This is the most common real-world `await`-shape bug: two consecutive independent awaits. Fix:

```js
async function summary(id) {
  const [user, settings] = await Promise.all([getUser(id), getSettings(id)]);
  return { user, settings };
}
```

The tell is "the second `await` doesn't reference the first's result" — that's a parallelization opportunity hiding in plain sight.
</details>

**Q51. Which anti-pattern, and what's the fix?**

```js
function delay(ms, value) {
  return new Promise(resolve => {
    Promise.resolve(value).then(resolve);   // wrapping a promise
  });
}
```

<details><summary>Answer</summary>

A **Promise-constructor wrap of an existing Promise** (a misuse adjacent to chain hell) — wrapping `Promise.resolve(value)` in `new Promise` for nothing, and worse, it **drops rejection propagation** (no `reject` wired). Fix: return the promise directly, or, if a delay was intended, schedule it properly:

```js
const delay = (ms, value) =>
  new Promise(resolve => setTimeout(() => resolve(value), ms));
```

Never wrap a Promise in `new Promise` — return it (or `await` it).
</details>

---

## Curveballs

> The questions designed to catch glib answers.

**Q52. Is `await` in a loop always wrong?**

<details><summary>Answer</summary>

No — and "always parallelize loops" is the juniorism here. `await`-in-a-loop is *correct* when iterations are **dependent** (each needs the previous result, like paginating with a cursor or a state machine), when **side-effect ordering** must be preserved (write A before B), when you want **backpressure** (intentionally pacing intake so you don't overload a downstream service or buffer everything in memory), or when consuming an **async iterator** (`for await`) where items arrive one at a time. It's an anti-pattern *only* when the iterations are independent and the count is safe to fan out. Recognize the difference; don't reflexively `Promise.all` every loop.
</details>

**Q53. Why not just `Promise.all` everything?**

<details><summary>Answer</summary>

Because unbounded parallelism has real costs that scale with N. `Promise.all` over a large list opens *every* operation at once: it can exhaust sockets/file descriptors, **OOM** by holding all pending promises and all results in memory until the last settles, **overload** (effectively DDoS) the callee and trip its rate limits, and even run *slower* once contention dominates. It also **fails fast** — one rejection discards all the other results — and **doesn't cancel** the orphaned siblings. For independent-but-numerous work you want *bounded* concurrency; for huge/unbounded streams you want async iterators. `Promise.all` is for small, bounded fan-outs where holding everything at once is fine.
</details>

**Q54. `Promise.all` vs `allSettled` vs `race` vs `any` — when each?**

<details><summary>Answer</summary>

- **`all`** — need every result, abort on first failure (fail-fast). "Fetch user + settings + perms; if any fails, the page can't render."
- **`allSettled`** — need every *outcome* regardless of failures. "Fan out to 50 services and report which succeeded." Never rejects.
- **`race`** — first to settle wins (success *or* failure). Timeouts: `race([work, rejectAfter(ms)])`; "fastest mirror."
- **`any`** — first to *succeed* wins, ignore failures until all fail (then `AggregateError`). "Query 3 replicas, take the first that answers."

The discriminators: do you need *all* or *one*? do failures *abort* or just *get recorded*? do you care about first-*settle* or first-*success*?
</details>

**Q55. What is "releasing Zalgo" and why do Promises prevent it?**

<details><summary>Answer</summary>

Releasing Zalgo is shipping an API whose callback runs **sometimes synchronously, sometimes asynchronously** (sync on cache hit, async on miss). It's a hazard because callers can't reason about whether code after the call has run before the callback, so subtle ordering bugs appear only on one path. The cure is to be *consistently* async — always defer the callback a tick. Promises enforce this by spec: `.then` (and `await`) continuations are **always** scheduled as microtasks and **never** invoked synchronously within the same tick, even for an already-resolved promise. So adopting Promises eliminates a whole class of sync/async-inconsistency bugs that hand-rolled callbacks invite.
</details>

**Q56. How do you bound concurrency to N, conceptually, without a library?**

<details><summary>Answer</summary>

Two equivalent mental models. **Worker pool:** spawn N "workers," each a loop that pulls the next item from a shared queue/index and processes it, until the queue is empty; `Promise.all` the N workers. At most N run at once because there are only N loops. **Counting semaphore:** maintain a counter initialized to N; each task `acquire()`s (waits if zero) before starting and `release()`s in a `finally`; the semaphore hands a slot to a waiter on release. Both guarantee exactly N in flight, queue (not drop) the rest, and must release on error (`finally`) or the pool deadlocks. Python's `asyncio.Semaphore(N)` is the semaphore model built in.
</details>

**Q57. If I `await` a function that isn't `async` and returns a plain value, is that a bug?**

<details><summary>Answer</summary>

No — `await` on a non-thenable value just resolves to that value, after one microtask hop. So `await 5` is `5`. It's harmless and even useful when a function *might* return a value or a Promise (`await maybePromise`). The reverse is the real bug: *forgetting* `await` on a function that *does* return a Promise, leaving you holding a `Promise<T>` you treat as `T`. The cost of an unnecessary `await` is one microtask hop (negligible); the cost of a missing one is wrong behavior and unhandled rejections. TypeScript helps: `await` on a non-Promise is flagged or simply typed through.
</details>

**Q58. Does adding more concurrency always make a batch faster?**

<details><summary>Answer</summary>

No — throughput rises with concurrency only up to the **bottleneck's capacity**, then flattens or *declines*. Past the point where the callee, the network, the connection pool, or your CPU saturates, extra concurrency adds queueing, contention, retries (from timeouts you caused), and memory pressure — making things slower and less reliable. This is just Little's Law / the Universal Scalability Law in practice. The right concurrency limit is found empirically: increase N until latency starts climbing or error rate rises, then back off. "More parallel = faster" holds only while you're below the bottleneck.
</details>

**Q59. Is `async/await` "just syntactic sugar" over Promises with no behavioral difference?**

<details><summary>Answer</summary>

Mostly sugar, but with behavioral consequences worth knowing. `await` desugars to consuming a Promise, *but* it changes how you can structure control flow (loops, conditionals, `try/catch` over async) and it makes sequential-vs-parallel mistakes easier to write (two awaits look innocent but serialize). There are real differences: error stack traces are generally better with `async/await`; `await` always yields to the microtask queue even on resolved values; and a `return await p` inside `try/catch` behaves differently from `return p` (the former catches rejections locally, the latter doesn't). So "just sugar" is the right intuition but a too-glib answer in a senior interview.
</details>

---

## Rapid-Fire / One-Liners

> Crisp answers; what an interviewer wants in one or two sentences.

**Q60. One-line cure for each of the three?**

<details><summary>Answer</summary>

`await`-in-loop → `Promise.all` for independent/bounded, `p-limit`/semaphore for many, keep the loop only if dependent. Chain hell / pyramid → flatten to `async/await`, promisify callbacks. Mixing callbacks + promises → pick one model per API; `util.promisify` the callback side.
</details>

**Q61. Concurrency vs parallelism, one sentence?**

<details><summary>Answer</summary>

Concurrency is interleaving many tasks (overlapping their *waits*); parallelism is executing many at the same instant on multiple cores — a single-threaded event loop gives concurrency, not parallelism.
</details>

**Q62. `Promise.all` rejection behavior in one sentence?**

<details><summary>Answer</summary>

It rejects on the first rejection (fail-fast) but does **not** cancel the other in-flight promises — they keep running, results discarded.
</details>

**Q63. The fastest tell that two awaits should be `Promise.all`?**

<details><summary>Answer</summary>

The second `await` doesn't use the first one's result — they're independent, so they can start together.
</details>

**Q64. Why is `items.forEach(async …)` a trap?**

<details><summary>Answer</summary>

`forEach` ignores the callback's return value, so it never awaits — it fires floating promises, runs the next line immediately, and loses error handling.
</details>

**Q65. Bounded concurrency in one sentence?**

<details><summary>Answer</summary>

Keep exactly N operations in flight at once (semaphore or worker pool), queueing the rest — the middle ground between serial (slow) and unbounded `Promise.all` (overload).
</details>

**Q66. What does parallelizing convert latency from, to?**

<details><summary>Answer</summary>

From the **sum** of the operations' latencies to the **max** (the slowest one).
</details>

**Q67. Releasing Zalgo in one line?**

<details><summary>Answer</summary>

An API that calls back sometimes sync, sometimes async — always defer to a later tick to be consistent; Promises do this for you.
</details>

**Q68. Python's `Promise.all` / `allSettled` equivalents?**

<details><summary>Answer</summary>

`asyncio.gather(*coros)` (fail-fast); `asyncio.gather(*coros, return_exceptions=True)` or `TaskGroup` for collect-all-outcomes.
</details>

**Q69. CPU-bound work and the event loop in one sentence?**

<details><summary>Answer</summary>

Parallelizing async calls only overlaps *I/O waits*; CPU-bound work needs real threads/processes (Worker Threads, `multiprocessing`) because the loop is single-threaded.
</details>

---

## How to Talk About Async in Interviews

A few habits separate a strong answer from a textbook recital:

- **Lead with the execution shape, then the cost.** Don't just say "await in a loop is bad." Say *what runs differently* — "these independent calls serialize, so latency is the sum instead of the max" — and do the arithmetic out loud.
- **Always reach for the three-way choice.** Dependent → sequential; independent and few → `Promise.all`; independent and many → bounded concurrency. Naming all three (not just `Promise.all`) is the senior signal.
- **Name the failure modes of the easy answer.** Unbounded `Promise.all` → OOM, socket exhaustion, callee overload, fail-fast with orphaned siblings. Showing you know *why* `Promise.all` everything is wrong beats reciting that it's "parallel."
- **Distinguish concurrency from parallelism, and I/O-bound from CPU-bound.** It governs whether parallelizing helps at all; mixing these up is a common tell.
- **Show cancellation and backpressure awareness.** `AbortSignal`, timeouts that don't actually cancel, async iterators for streams — these prove production experience.
- **Go deep when invited.** Microtask vs macrotask ordering, Zalgo, why hand-rolled `new Promise` wrappers are buggy, the latency/memory math — these separate "uses async" from "understands the runtime."
- **Avoid absolutism.** "Always parallelize," "always `Promise.all`," "`async/await` is just sugar" are juniorisms. Calibrate: it depends on dependency, count, and where the time goes.

---

## Summary

- The three execution-shape anti-patterns are **mismatches between how async code reads and how it runs**: `await`-in-a-loop (looks fine, serializes independent work), Promise chain hell / callback pyramid (dependent steps nested into a staircase), and mixing callbacks with Promises (two contracts, double-handled results).
- The junior bar is recognizing the shape and the concurrency-vs-parallelism distinction; the middle bar is the **parallel-vs-sequential decision**, **bounded concurrency**, and clean **`promisify`** conversions; the senior bar is **backpressure, the async N+1 / DataLoader, safe callback→promise migration, and cancellation**; the professional bar is the **event loop, latency/memory math, and Zalgo**.
- The strongest answers reach for the **three-way choice** (dependent → sequential, few → `Promise.all`, many → bounded), do the **latency arithmetic** (sum vs max), and name the **costs of unbounded fan-out** (OOM, descriptor/socket exhaustion, callee overload, fail-fast with orphaned work).
- Common curveballs hinge on the same insight: `await`-in-a-loop is fine for *dependent / backpressured* work; `Promise.all` is wrong when *unbounded*; the choice depends on **dependency, count, and whether time is spent waiting or computing** — not on a one-size rule.

---

## Related Topics

- [`junior.md`](junior.md) — recognize each shape and read what the code actually does.
- [`middle.md`](middle.md) — parallel vs sequential, bounded concurrency, promisify.
- [`senior.md`](senior.md) — backpressure, async N+1 / DataLoader, migration, cancellation.
- [`professional.md`](professional.md) — event loop, microtask scheduling, latency/memory math, Zalgo.
- [`tasks.md`](tasks.md) · [`find-bug.md`](find-bug.md) · [`optimize.md`](optimize.md) — practice serializing-vs-parallelizing and fixing the shapes.
- [Error Handling Async Anti-Patterns](../01-error-handling/README.md) — swallowed rejections and floating promises, the failure-visibility siblings.
- [Async Misuse Anti-Patterns](../03-misuse/README.md) — the Promise-constructor anti-pattern and `async` without `await`.
- [Concurrency Anti-Patterns](../../03-concurrency/README.md) — the multi-thread sibling chapter (locks, races, deadlocks).
- [Clean Code → Functions](../../../clean-code/02-functions/README.md) — small, single-contract functions; the cure for mixed callback/Promise APIs.
- [Backend / Distributed Systems](../../../../../Backend/distributed-systems/README.md) — fan-out, retry, timeout, and rate-limiting at the network layer.
