# Async Misuse Anti-Patterns — Interview Q&A

> **Category:** [Async Anti-Patterns](../README.md) → **Misuse** — *async machinery applied where it doesn't help, and Promise plumbing built by hand when none is needed.*
> **Covers (collectively):** Promise Constructor Anti-Pattern · `async` Without `await`

A bank of 60+ interview questions spanning Promise mechanics, the microtask queue, the *legitimate* uses of `new Promise` and `async`, and the subtle ways both anti-patterns lose errors. Each answer models the reasoning a strong candidate gives — including the trade-offs. Use the `<details>` toggles to self-quiz: read the question, answer out loud, then expand. Examples are JS/TS-first with Python `asyncio` parallels where they sharpen the point.

---

## Table of Contents

1. [Fundamentals / Junior](#fundamentals--junior)
2. [Intermediate / Middle](#intermediate--middle)
3. [Senior — Bridging, Lint Gates, Conventions](#senior--bridging-lint-gates-conventions)
4. [Professional / Deep — Microtasks, Error Loss, Zalgo](#professional--deep--microtasks-error-loss-zalgo)
5. [Code-Reading — Diagnose the Snippet](#code-reading--diagnose-the-snippet)
6. [Curveballs](#curveballs)
7. [Rapid-Fire / One-Liners](#rapid-fire--one-liners)
8. [How to Talk About These in Interviews](#how-to-talk-about-these-in-interviews)
9. [Summary](#summary)
10. [Related Topics](#related-topics)

---

## Fundamentals / Junior

> What the Promise constructor is, what `async` does, and why misusing them is wasteful.

**Q1. Name the two misuse anti-patterns and give a one-line symptom for each.**

<details><summary>Answer</summary>

- **Promise Constructor Anti-Pattern** — wrapping an *already-existing* Promise inside `new Promise((resolve) => existing.then(resolve))`. The wrapper adds nothing, swallows rejections, and is pure noise.
- **`async` Without `await`** — a function marked `async` whose body contains no `await` and does only synchronous work. It pays a microtask-hop tax and wraps results in a Promise for no benefit.

Both are *misuse*: the async machinery is invoked where the plain version would be correct, simpler, and faster. You spot them by the *shape* (a `new Promise` around a `.then`, or an `async` with no `await`), not by a broken test.
</details>

**Q2. What is the Promise constructor and when is it the right tool?**

<details><summary>Answer</summary>

`new Promise(executor)` takes an *executor* function `(resolve, reject) => {…}` that runs **synchronously and immediately**. You call `resolve(value)` to fulfill and `reject(error)` to reject. Its legitimate job is **bridging** a non-Promise async API — a callback-style function, an event, a timer — into a Promise. Example: `new Promise(res => setTimeout(res, 1000))` turns `setTimeout` into an awaitable `delay`. The anti-pattern is using it when you *already* have a Promise; then there is nothing to bridge.
</details>

**Q3. What does the `async` keyword actually do to a function?**

<details><summary>Answer</summary>

It changes the function's *return contract*: an `async` function always returns a Promise. A `return v` becomes `Promise.resolve(v)`, and a `throw` becomes a rejected Promise instead of a synchronous exception. It also *enables* the use of `await` inside the body. That's all — it does not make synchronous code run in parallel or on another thread. If the body never awaits and never needs the auto-wrapping, the keyword only adds overhead and a misleading signal that the function does async work.
</details>

**Q4. Why is `new Promise(resolve => fetchUser().then(resolve))` wrong?**

<details><summary>Answer</summary>

`fetchUser()` is *already* a Promise. Wrapping it gains nothing and loses something: the executor's `resolve` is called on success, but there is no `reject`, so if `fetchUser()` rejects, the rejection has nowhere to go — the outer Promise hangs forever (and the inner rejection becomes unhandled). The fix is to **return the Promise directly**: `return fetchUser();`. The rule of thumb: if the thing you're wrapping is already a Promise, you don't need `new Promise`.
</details>

**Q5. What's the difference between `return value` and `return Promise.resolve(value)` in an `async` function?**

<details><summary>Answer</summary>

Inside an `async` function, **nothing observable** — both produce a Promise that fulfills with `value`. `async` auto-wraps the return, so `return 5` and `return Promise.resolve(5)` are equivalent to the caller. If `value` is itself a Promise, `async` *also* unwraps (adopts) it, so `return somePromise` yields the resolved inner value, not a `Promise<Promise<…>>`. The takeaway: you rarely need to write `Promise.resolve` by hand inside an `async` function — the keyword does it.
</details>

**Q6. If `async` with no `await` "works," why is it an anti-pattern?**

<details><summary>Answer</summary>

It works correctly but lies and costs. It **lies** because the `async` keyword signals "this function does asynchronous work — await it," when in fact it's synchronous; readers and tooling treat it as deferred. It **costs** because the function now returns a Promise that resolves on the next microtask tick instead of returning the value immediately, so every caller must `await` (or `.then`) and the result is delayed by at least one tick. If the work is synchronous, drop `async` and return the value plainly.
</details>

**Q7. What is a microtask, and how does it relate to these patterns?**

<details><summary>Answer</summary>

A microtask is a callback queued to run **after the currently executing synchronous code finishes but before the next macrotask** (timer, I/O, rendering). Promise `.then`/`await` continuations are microtasks. The relevance: an `async` function — even one that does no real async work — forces its result through a microtask, so the value is not available synchronously. The Promise-constructor wrapper adds *another* layer of `.then`, i.e. another microtask. Both patterns insert ticks of latency and reordering that the plain code wouldn't have.
</details>

**Q8. In Python `asyncio`, what's the equivalent of "`async` without `await`"?**

<details><summary>Answer</summary>

An `async def` function with no `await` in the body. Calling it returns a **coroutine object** that does nothing until awaited or scheduled — so a synchronous caller that just calls it gets a coroutine, not a result, and may even get a "coroutine was never awaited" warning. As in JS, if the function does only synchronous work, it should be a plain `def`. The Python analogue is arguably *worse* because forgetting to await yields a silent no-op coroutine rather than a Promise that at least runs.
</details>

**Q9. What's the simplest correct way to turn a callback API into a Promise?**

<details><summary>Answer</summary>

For Node-style `(err, result)` callbacks, prefer the built-in `util.promisify(fn)`. When you must do it by hand, that's the **one legitimate** use of `new Promise`:

```js
const readFileP = (path) =>
  new Promise((resolve, reject) =>
    fs.readFile(path, (err, data) => (err ? reject(err) : resolve(data))));
```

Note both `resolve` *and* `reject` are wired — the error path is what people forget, and forgetting it is how the constructor pattern loses errors.
</details>

**Q10. What is "fulfilled," "rejected," and "settled" for a Promise?**

<details><summary>Answer</summary>

A Promise starts **pending**. It becomes **fulfilled** when `resolve(value)` is called, or **rejected** when `reject(error)` is called; either of those is **settled** (a settled Promise never changes again). A Promise that is never settled hangs forever — which is exactly what the constructor anti-pattern causes when the wrapped Promise rejects but the executor wired only `resolve`. Understanding "settled once, forever" is what makes that bug obvious.
</details>

**Q11. Does marking a function `async` make it run on a separate thread?**

<details><summary>Answer</summary>

No. JavaScript is single-threaded for user code; `async`/`await` is *cooperative* scheduling on the event loop, not parallelism. `await` yields control so other queued work can run, but your code never executes concurrently with itself. So an `async` function with no `await` doesn't offload anything — it just makes a synchronous computation return a Promise. (CPU-bound parallelism needs Worker threads / `worker_threads` / multiprocessing, not `async`.)
</details>

**Q12. What does the executor function's timing tell you about `new Promise`?**

<details><summary>Answer</summary>

The executor runs **synchronously, the instant `new Promise(...)` is evaluated** — before the constructor returns the Promise object. So any synchronous code in the executor (including a synchronous `throw`) happens immediately; only the eventual `resolve`/`reject` is deferred. This matters for the constructor anti-pattern: starting the wrapped Promise inside the executor is eager, and a synchronous throw there is automatically turned into a rejection — one of the few helpful behaviors, and a reason hand-rolled wrappers sometimes *seem* to work.
</details>

---

## Intermediate / Middle

> When `new Promise` IS needed, async return semantics, and `promisify`.

**Q13. Give three cases where `new Promise` is genuinely the right tool.**

<details><summary>Answer</summary>

1. **Wrapping a callback API** that you can't or won't change (`fs.readFile`, an old SDK).
2. **Wrapping an event** — resolve when an event fires: `new Promise(res => emitter.once('done', res))`, or a DOM `'load'` / `'error'` pair.
3. **Wrapping a timer / one-shot signal** — `delay`, a manual `AbortController` race, or exposing a `resolve`/`reject` pair to be called later (a "deferred").

The unifying trait: the thing being wrapped is **not already a Promise**. The moment it is, you return it directly instead.
</details>

**Q14. Show the deferred pattern and when it's justified.**

<details><summary>Answer</summary>

A deferred captures `resolve`/`reject` to settle the Promise from *outside* the executor:

```js
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
```

Justified when settlement is driven by an external event that doesn't map to a single call — e.g. a request/response correlator over a WebSocket, where a message arriving later resolves the matching Promise. It's `new Promise` used correctly because there's no existing Promise to return. Overused, it becomes a smell; prefer `async`/`await` whenever the flow is linear.
</details>

**Q15. When is an `async` function with no visible `await` still defensible?**

<details><summary>Answer</summary>

Two cases. (1) **Interface conformance** — implementing a method whose contract is `Promise`-returning (an interface, an overridden base method, a route handler the framework awaits) even though this particular implementation is synchronous; keeping it `async` keeps the type uniform. (2) **Normalizing a sometimes-sync API** — a function that *usually* awaits but has an early synchronous path; `async` guarantees every path returns a Promise so callers have one contract. Outside these, drop the keyword.
</details>

**Q16. Why does wrapping a synchronous throw in `async` sometimes help?**

<details><summary>Answer</summary>

A *plain* function that `throw`s does so **synchronously** — the caller must `try/catch` around the call site. An `async` function that throws produces a **rejected Promise** instead, which callers handle with `.catch`/`await try`. If a function's contract is "returns a Promise," you want even its validation failures to be rejections, not synchronous throws, so callers don't need *two* error-handling styles. Making it `async` (or returning `Promise.reject`) normalizes the error channel. This is the legitimate flip side of "`async` without `await`."
</details>

**Q17. What does `util.promisify` do that hand-rolling `new Promise` risks getting wrong?**

<details><summary>Answer</summary>

`util.promisify` correctly handles the Node `(err, result)` convention: it rejects on a truthy `err`, resolves on `result`, forwards `this`, and supports the `[util.promisify.custom]` symbol for APIs with non-standard signatures (e.g. multiple result args). Hand-rolled wrappers commonly forget the `reject` branch, mishandle `this`, or call `resolve` twice. Prefer the built-in (or `fs.promises`, or the library's native Promise API) and reserve manual `new Promise` for APIs `promisify` can't model.
</details>

**Q18. What's the deal with `return await bar()` versus `return bar()`?**

<details><summary>Answer</summary>

Usually `return bar()` is enough — `async` already adopts a returned Promise, so the `await` adds one redundant microtask hop. The classic guidance is "drop the redundant `await` at the tail." The important exception: inside a `try/catch`, `return await bar()` is **required** to keep `bar`'s rejection inside the `try` so your `catch` runs; `return bar()` would settle the rejection *after* the function (and its `try`) has exited, and the `catch` would never fire. So `return await` is a deliberate tool inside `try`, not always a smell. (`return await` also gives cleaner async stack traces, another reason some teams keep it.)
</details>

**Q19. Rewrite this constructor anti-pattern correctly.**

```js
function getUser(id) {
  return new Promise((resolve, reject) => {
    db.query(id).then(rows => resolve(rows[0]));
  });
}
```

<details><summary>Answer</summary>

`db.query(id)` is already a Promise, so return it and transform with `.then`:

```js
function getUser(id) {
  return db.query(id).then(rows => rows[0]);
}
```

The original also dropped errors: `reject` is declared but never wired, so a failing `db.query` leaves `getUser` pending forever. The rewrite propagates rejection automatically. (An `async` version — `const rows = await db.query(id); return rows[0];` — is equally fine and arguably clearer.)
</details>

**Q20. Compare `async` overhead vs. a plain function — does it ever matter?**

<details><summary>Answer</summary>

For the vast majority of code, no — a microtask hop is nanoseconds and irrelevant next to actual I/O. It *can* matter in **hot paths**: a synchronous helper called millions of times in a tight loop that's needlessly `async` forces a Promise allocation and a tick each call, adding allocation pressure and GC churn, and it serializes oddly because each call now resolves on a later tick. The right framing in an interview: "the overhead is real but usually negligible; I'd remove needless `async` for *correctness and clarity*, and the perf win is a bonus on hot paths."
</details>

**Q21. Your function sometimes returns a value and sometimes a Promise. Why is that a problem and how do you fix it?**

<details><summary>Answer</summary>

A function with a **mixed sync/async return** forces every caller to defensively `await` or `Promise.resolve` the result because they can't tell which they'll get — and code that *doesn't* defend will break only on the path it didn't expect (the "releasing zalgo" problem, Q41). Fix by making the contract uniform: mark it `async` (or always return a Promise) so every path is async, even the synchronous one. This is the *good* use of "`async` without `await`": consistency beats the micro-optimization of returning sync sometimes.
</details>

**Q22. In Python, how do you bridge a callback-based library into `asyncio`?**

<details><summary>Answer</summary>

Use a `Future` from the running loop — the `asyncio` analogue of `new Promise`:

```python
async def fetch():
    loop = asyncio.get_running_loop()
    fut = loop.create_future()
    legacy.on_done(lambda result: loop.call_soon_threadsafe(fut.set_result, result))
    legacy.on_error(lambda err: loop.call_soon_threadsafe(fut.set_exception, err))
    return await fut
```

`fut.set_result` / `fut.set_exception` mirror `resolve` / `reject`. The same rule applies: only bridge things that aren't already awaitables; never wrap an existing coroutine/awaitable in a new Future.
</details>

**Q23. Is `return Promise.resolve(x)` in a non-async function the same anti-pattern?**

<details><summary>Answer</summary>

Not quite — that's a deliberate, plain-function way to return an already-resolved Promise, which is fine and sometimes preferable (no `async` overhead, explicit). The anti-pattern is specifically `new Promise(res => res(x))` or `new Promise(res => existingPromise.then(res))`. `Promise.resolve(x)` is the idiomatic "lift a value into a settled Promise"; `Promise.reject(e)` is its error twin. Use those instead of constructing a Promise to immediately settle it.
</details>

**Q24. What's the difference between `Promise.resolve(p)` and `new Promise(r => r(p))` when `p` is a Promise?**

<details><summary>Answer</summary>

`Promise.resolve(p)` returns `p` **itself** when `p` is already a native Promise (an identity short-circuit) — zero extra wrapping. `new Promise(r => r(p))` creates a *new* Promise that *adopts* `p`, costing an extra object and microtask, and — if you forgot `reject` and instead relied on `.then(r)` — losing the rejection. So even when both "resolve to the same value," the constructor form is strictly more expensive and more error-prone. Reach for `Promise.resolve`.
</details>

---

## Senior — Bridging, Lint Gates, Conventions

> Bridging utilities, lint rules that prevent these, and team conventions.

**Q25. What lint rules catch these two anti-patterns, and what do they enforce?**

<details><summary>Answer</summary>

- **`require-await`** (ESLint / `@typescript-eslint`) flags `async` functions with no `await` — the core "`async` without `await`" gate.
- **`no-async-promise-executor`** forbids `new Promise(async (res) => …)`, a particularly dangerous constructor misuse (Q33).
- **`no-promise-executor-return`** flags returning a value from the executor, a sign someone confused the executor with a `.then` callback.
- **`@typescript-eslint/no-floating-promises`** and **`@typescript-eslint/return-await`** cover adjacent issues (unawaited Promises; `return await` in `try`).

There's no single rule named "promise-constructor-anti-pattern," so code review plus `no-async-promise-executor`/`no-promise-executor-return` are the practical net.
</details>

**Q26. Build a reusable, correct callback-to-Promise bridge. What must it get right?**

<details><summary>Answer</summary>

```js
function promisifyOnce(start) {
  return new Promise((resolve, reject) => {
    try {
      start(
        (value) => resolve(value),
        (err) => reject(err)
      );
    } catch (e) {
      reject(e); // synchronous throw from start() becomes a rejection
    }
  });
}
```

It must: wire **both** `resolve` and `reject`; convert a **synchronous throw** in `start` into a rejection (not let it escape); and rely on the fact that calling `resolve`/`reject` more than once is a **safe no-op** (Promises settle once). For multi-shot signals (an event that fires repeatedly), a Promise is the *wrong* abstraction — use an async iterator or observable instead.
</details>

**Q27. How do you migrate a codebase full of the Promise-constructor anti-pattern safely?**

<details><summary>Answer</summary>

Treat it as behavior-preserving refactoring. (1) **Find** them: grep for `new Promise` and triage — keep the ones bridging callbacks/events, target the ones wrapping existing Promises. (2) **Pin behavior** with tests, especially the *error* path, since that's what the wrapper silently broke. (3) **Rewrite** each `new Promise(r => p.then(r))` to `return p` (plus any `.then` transform), or to an `async`/`await` body. (4) Watch for cases where the original *swallowed* a rejection and downstream code depended on the hang/timeout — surfacing the real error is correct but may newly fail a test that relied on the bug. (5) Add `no-async-promise-executor` and review gates so they don't come back.
</details>

**Q28. A teammate says "I wrap every API in `new Promise` so the signatures are consistent." What's your counter?**

<details><summary>Answer</summary>

Agree with the *goal* (uniform Promise-returning signatures) and correct the *means*. For something already returning a Promise, `async function f() { return existing(); }` — or just returning it — gives the identical uniform signature with no wrapping, no lost errors, and no double microtask. `new Promise` should be reserved for APIs that *aren't* Promise-based. So consistency is achieved by the `async` keyword and direct return, not by re-wrapping. The wrapper doesn't make things more consistent; it makes them slower and error-lossy.
</details>

**Q29. How do you decide between `async`/`await` and `new Promise` + `.then` when writing a bridge?**

<details><summary>Answer</summary>

If the underlying operation is **already a Promise/awaitable**, you never need `new Promise` — write the body with `await`. You reach for `new Promise` *only* at the boundary where a **non-Promise** primitive must be lifted: a callback, an event, a timer. So a bridge typically has exactly one `new Promise` at the very edge, and everything above it is `async`/`await`. If you find `new Promise` more than one layer deep, that's the smell — the inner Promise should have been awaited or returned, not re-wrapped.
</details>

**Q30. What team conventions reduce these misuses before review?**

<details><summary>Answer</summary>

(1) Enable `require-await`, `no-async-promise-executor`, `no-promise-executor-return` in CI so they fail the build, not just nag. (2) Adopt a house rule: "`new Promise` is allowed only to wrap a callback/event/timer; wrapping a Promise is a review-blocker." (3) Prefer `util.promisify` / native `*.promises` APIs over hand-rolled wrappers. (4) Use TypeScript so `Promise<T>` vs `T` mismatches surface where a needless `async` changed a return type. (5) Keep bridges in a small, reviewed `utils/promise.ts` so the few legitimate `new Promise` usages are centralized and audited.
</details>

**Q31. Does removing a needless `async` ever change observable behavior?**

<details><summary>Answer</summary>

Yes — subtly. A plain function returns its value **synchronously**; an `async` one returns it on the **next microtask**. If any caller relied (knowingly or not) on the result being deferred — e.g. a value read after a `.then` that assumed ordering, or a synchronous `throw` that callers caught with `try/catch` rather than `.catch` — removing `async` can reorder execution or change *where* the error surfaces (sync throw vs. rejection). Usually it's safe, but it's a behavior-affecting change, so do it under tests and treat it as more than cosmetic.
</details>

**Q32. How does TypeScript help — and where does it fall short — on these patterns?**

<details><summary>Answer</summary>

TS helps on **forgotten await** (a `Promise<T>` won't assign to a `T`, so dereferencing the wrong type errors) and makes a needless-`async` return type visibly `Promise<X>`. It does **not** flag "`async` with no `await`" by itself (that's the `require-await` lint rule, not the type checker), and it doesn't stop you wrapping a Promise in `new Promise` — both produce a `Promise<T>`, so the types look fine. So TS narrows the blast radius but you still need lint + review for the misuse shapes themselves.
</details>

---

## Professional / Deep — Microtasks, Error Loss, Zalgo

> Microtask ticks, the error-loss mechanics, `no-async-promise-executor`, and zalgo.

**Q33. Why is an `async` Promise executor — `new Promise(async (resolve, reject) => …)` — a bug?**

<details><summary>Answer</summary>

Two failure modes. First, **errors are lost**: an `async` executor returns a Promise the constructor *ignores*, so any `throw` (or rejection) inside the executor that happens after the first `await` becomes an **unhandled rejection** — it never reaches the outer Promise's `reject`, and the outer Promise can hang. Second, it signals confusion: if you need `await` inside, you don't need `new Promise` at all — write a plain `async` function. ESLint's `no-async-promise-executor` exists precisely because there is no correct use of this shape. The fix is almost always "delete `new Promise`, make the surrounding function `async`."
</details>

**Q34. Trace the exact error-loss mechanism in `new Promise(res => p.then(res))` when `p` rejects.**

<details><summary>Answer</summary>

`p.then(res)` registers a fulfillment handler only — there's no rejection handler and no `reject` wired. When `p` rejects: (1) the outer Promise's `resolve` is never called, so it stays **pending forever** (the caller's `await` hangs); (2) `p`'s rejection has no `.catch`, so it surfaces as an **unhandled promise rejection** event in the runtime, far from the code that "looks like" it handles `p`. So a single missing argument produces *both* a hang and a detached unhandled rejection. `return p` (or `.then(res, rej)` / a wired `reject`) eliminates both.
</details>

**Q35. What is "zalgo," and what does "releasing zalgo" mean?**

<details><summary>Answer</summary>

"Zalgo" (coined by Isaac Schlueter) is a function with a **nondeterministic sync-or-async callback**: sometimes it invokes your callback **synchronously** (before it returns), sometimes **asynchronously** (on a later tick), depending on input or cache state. "Releasing zalgo" is shipping such a function. It's dangerous because callers can't reason about ordering — state set after the call may or may not exist when the callback runs, producing Heisenbugs. The cure is to **always be async** (or always sync): if any path is async, force *all* paths async (e.g. `Promise.resolve().then(…)` or making the function `async`). Note this is the *good* reason to keep an `async` with no `await` on the sync path.
</details>

**Q36. How many microtask ticks does `new Promise(res => existingPromise.then(res))` add versus `return existingPromise`?**

<details><summary>Answer</summary>

The wrapper adds **extra ticks**. `return existingPromise` lets the caller adopt it directly with no added hop. The wrapped form chains a `.then` (one microtask to run the handler) which then resolves the outer Promise, whose own continuations run on a *further* microtask — so the consumer's `await` resolves one-to-two ticks later than necessary, plus an extra Promise allocation. It's never *faster* and never *more correct* than returning the inner Promise; it is strictly worse on both axes. (Exact tick counts vary by engine and resolution-adoption rules, but the direction — more ticks — is invariant.)
</details>

**Q37. Walk through the resolution-adoption (thenable) rules and why they make hand-wrapping unnecessary.**

<details><summary>Answer</summary>

When you `resolve(x)`, the spec checks whether `x` is **thenable** (has a `.then`). If so, the outer Promise *adopts* `x`: it waits for `x` to settle and takes on its state and value — including its **rejection**. This is why `return promiseB` inside an `async` function gives you `B`'s resolved value, not a nested Promise, and why `Promise.resolve(p)` short-circuits to `p`. The machinery already flattens and adopts for you, so hand-building a `new Promise` to "unwrap" or "re-resolve" an existing Promise is redundant — you're re-implementing, badly, what the runtime does correctly.
</details>

**Q38. Why does `return await` matter for stack traces and error containment, deeply?**

<details><summary>Answer</summary>

Two effects. **Containment:** `return bar()` schedules the rejection to settle the *caller's* awaiter; the current function's `try` block has already unwound, so a local `catch` (or `finally` cleanup keyed on the result) won't apply. `return await bar()` keeps the awaiting frame alive until `bar` settles, so the `catch`/`finally` runs in-frame. **Stack traces:** with `await`, V8 can stitch the async frame into the stack (async stack traces), so the trace shows the `await` site; with a bare `return`, the frame is gone by the time the rejection propagates, yielding a shorter, less useful trace. The cost is one microtask. In `try`/`finally` or where traces matter, keep the `await`.
</details>

**Q39. Does `async` without `await` affect concurrency or just latency?**

<details><summary>Answer</summary>

Just latency/ordering, not parallelism. Since the body is synchronous, the function still runs to completion on the same stack; the only difference is the result is delivered on a microtask instead of immediately. It does *not* yield to I/O or let other work interleave mid-body (there's no `await` to yield at). So it can't improve throughput — it can only delay the result by a tick and add an allocation. People sometimes add `async` hoping to "not block"; for synchronous CPU work that's a misconception — only moving the work off-thread (Workers) helps.
</details>

**Q40. Compare the JS unhandled-rejection story with Python's, for these misuses.**

<details><summary>Answer</summary>

In JS, a wrapped-and-dropped rejection fires an `unhandledRejection` (Node) / `unhandledrejection` (browser) event — observable but easy to miss, and the wrapping Promise still hangs. In Python `asyncio`, a coroutine wrapped in a needless `Future` that's never awaited yields a "coroutine was never awaited" `RuntimeWarning`, and a `Task` whose exception is never retrieved logs "Task exception was never retrieved" when garbage-collected. Both ecosystems *try* to surface the lost error, but both rely on runtime warnings rather than failing loudly — which is why the structural fix (don't wrap; return/await directly) beats relying on the safety net.
</details>

**Q41. How does the constructor anti-pattern interact with cancellation / `AbortSignal`?**

<details><summary>Answer</summary>

When you wrap an existing Promise in `new Promise`, you typically **lose the wrapped operation's cancellation hooks**. The inner `fetch(url, { signal })` is still cancellable, but the outer wrapper exposes none of that — and if the inner rejects on abort, the (un-wired) `reject` means the outer hangs instead of rejecting with `AbortError`. Returning the inner Promise directly preserves the propagation of `AbortError`. If you genuinely need to *build* a cancellable Promise from a primitive, `new Promise` is legitimate — but then you must wire `signal.addEventListener('abort', () => reject(signal.reason))` and clean up the listener. Wrapping an already-cancellable Promise just discards the feature.
</details>

**Q42. In a tight hot loop, quantify what a needless `async` costs.**

<details><summary>Answer</summary>

Each call that should be synchronous now: (1) allocates a Promise object (heap pressure → more minor GCs); (2) defers the result to a microtask, so a caller awaiting in a loop processes one item per drained microtask batch instead of straight-line; (3) prevents some JIT optimizations / inlining that apply to small synchronous functions. None of this matters at hundreds or thousands of calls, but at millions per second it shows up as measurable allocation rate and latency. The fix costs nothing: drop `async`, return the value. Measure with a profiler before claiming it's the bottleneck — usually it isn't.
</details>

---

## Code-Reading — Diagnose the Snippet

> You're shown a snippet; name the anti-pattern(s) and give the fix.

**Q43. Which anti-pattern, and what's the fix?**

```js
function loadConfig() {
  return new Promise((resolve, reject) => {
    fetch('/config').then(r => r.json()).then(resolve);
  });
}
```

<details><summary>Answer</summary>

**Promise Constructor Anti-Pattern.** `fetch(...).then(...).then(...)` is already a Promise; wrapping it adds a layer and — because `reject` is never wired — drops every error: a network failure or bad JSON leaves `loadConfig()` pending forever and surfaces as an unhandled rejection. Fix: return the chain directly.

```js
function loadConfig() {
  return fetch('/config').then(r => r.json());
}
// or: async function loadConfig() { return (await fetch('/config')).json(); }
```
</details>

**Q44. Which anti-pattern, and what's the fix?**

```ts
async function fullName(u: User): string {
  return `${u.first} ${u.last}`;
}
```

<details><summary>Answer</summary>

**`async` Without `await`** (and a type error — `async` can't return `string`, only `Promise<string>`). The body is pure string concatenation; no async work happens. Drop `async`:

```ts
function fullName(u: User): string {
  return `${u.first} ${u.last}`;
}
```

Now callers get the value synchronously instead of paying a microtask hop and being forced to `await` a non-async computation.
</details>

**Q45. Spot the bug.**

```js
const result = new Promise(async (resolve, reject) => {
  const data = await fetchData();   // if this rejects, where does it go?
  resolve(process(data));
});
```

<details><summary>Answer</summary>

**`no-async-promise-executor`** — an `async` executor. If `fetchData()` rejects, the `await` throws inside the async executor, which produces a rejected Promise the `Promise` constructor *ignores*; `reject` is never called, so `result` hangs and the error becomes an unhandled rejection. There's no reason to use `new Promise` here at all — `await` means you don't need it:

```js
const result = (async () => process(await fetchData()))();
// or just await fetchData() inside a normal async function
```
</details>

**Q46. Which anti-pattern, and what's the fix?**

```js
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

<details><summary>Answer</summary>

**No anti-pattern — this is correct and idiomatic.** `setTimeout` is a callback/timer primitive, *not* a Promise, so `new Promise` is the right bridge. There's nothing to await and no Promise to return directly. The only nuance: it intentionally never rejects (a timer can't fail), so omitting `reject` is fine here — unlike the cases where an existing Promise's rejection is being dropped. A good answer states *why* this one is legitimate, demonstrating you don't pattern-match "`new Promise` = bad."
</details>

**Q47. Which anti-pattern, and what's the fix?**

```js
async function save(record) {
  if (!record.id) throw new ValidationError('missing id');
  return db.insert(record);   // db.insert returns a Promise
}
```

<details><summary>Answer</summary>

**No anti-pattern — keep it.** It *looks* like "`async` with one path that doesn't await," but the `async` is doing real work: it turns the synchronous `throw` into a **rejection** so callers have one uniform error channel (`await save(...)` in a `try`), and it normalizes the return so both paths yield a Promise. That's the legitimate "normalize sometimes-sync" / "wrap sync throw as rejection" use. Stripping `async` would make the validation throw synchronously and break callers that only `.catch`. Leave it.
</details>

**Q48. Which anti-pattern, and what's the fix?**

```js
async function getOrCached(key) {
  if (cache.has(key)) return cache.get(key);   // synchronous path
  const v = await fetchRemote(key);
  cache.set(key, v);
  return v;
}
```

<details><summary>Answer</summary>

**No anti-pattern — this is the cure, not the disease.** The cached path is synchronous and the remote path awaits, so the function *could* "release zalgo" if written as a plain function returning sometimes a value and sometimes a Promise. Keeping it `async` forces **both** paths to be asynchronous (the cache hit resolves on a microtask), giving callers one consistent ordering. The deliberate "`async` so the sync path is also deferred" is exactly right. Removing `async` here would reintroduce zalgo.
</details>

**Q49. Diagnose this Python snippet.**

```python
async def compute(x):
    return x * x

results = [compute(n) for n in range(5)]   # what's in results?
```

<details><summary>Answer</summary>

**`async` Without `await`** (Python flavor). `compute` does only synchronous arithmetic, so it shouldn't be `async`. Worse, the list comprehension produces a list of **coroutine objects**, not numbers — and never awaits them, triggering "coroutine was never awaited" warnings. Fix: make it a plain `def` and call normally — `results = [compute(n) for n in range(5)]` now yields ints. If it genuinely needed to be async, you'd gather: `await asyncio.gather(*(compute(n) for n in range(5)))`.
</details>

**Q50. This snippet has the constructor anti-pattern *and* loses a feature — name both.**

```js
function fetchWithTimeout(url, signal) {
  return new Promise((resolve) => {
    fetch(url, { signal }).then(resolve);
  });
}
```

<details><summary>Answer</summary>

**Promise Constructor Anti-Pattern** (wrapping the already-Promise `fetch`) **plus loss of cancellation/error propagation.** `reject` is unwired, so both a network error *and* an `AbortError` from the `signal` are dropped — the Promise hangs instead of rejecting, defeating the very timeout/cancel the `signal` is for. Fix: return `fetch` directly so abort and errors propagate.

```js
function fetchWithTimeout(url, signal) {
  return fetch(url, { signal });
}
```

(If you needed to *add* a timeout, you'd use `AbortSignal.timeout(ms)` or `Promise.race`, not a hand-rolled wrapper.)
</details>

---

## Curveballs

> The questions designed to catch glib answers.

**Q51. When is `new Promise` legitimate?**

<details><summary>Answer</summary>

Whenever you're **bridging a non-Promise primitive** into the Promise world: a callback API (`fs.readFile`-style), an event (`emitter.once`, DOM `load`/`error`), a timer (`setTimeout`), or building a deferred whose `resolve`/`reject` you call from elsewhere (e.g. correlating async messages). The single disqualifier is: *if the thing you'd put inside the executor is already a Promise, don't use `new Promise` — return or await it.* So "is there a Promise here already?" is the whole test. Bridging = yes; re-wrapping = anti-pattern.
</details>

**Q52. Is `async` with no `await` ever useful?**

<details><summary>Answer</summary>

Yes, in three real cases. (1) **Normalize a sometimes-sync API** so every path returns a Promise (kills zalgo). (2) **Turn a synchronous `throw` into a rejection** so the function has one error channel matching its `Promise`-returning contract. (3) **Conform to an interface / framework** that expects a `Promise`-returning method even when this implementation is synchronous. Outside those, it's the anti-pattern — pure overhead and a misleading signal. The senior move is distinguishing "needless `async`" from "deliberate normalization."
</details>

**Q53. `return await foo()` vs `return foo()` — which is right?**

<details><summary>Answer</summary>

Default to `return foo()` (the `await` is a redundant microtask hop since `async` adopts the returned Promise). But use `return await foo()` when it's inside a **`try`/`catch`/`finally`** — you need the awaiting frame alive so the `catch` catches `foo`'s rejection and `finally` runs at the right time — or when you want **better async stack traces**. So it's contextual: outside `try`, drop it; inside `try`, keep it. A blanket "always" or "never" rule is the junior answer.
</details>

**Q54. Why is an async Promise executor a bug, in one breath?**

<details><summary>Answer</summary>

Because the `Promise` constructor ignores the executor's return value, so any error after the first `await` inside an `async` executor becomes an unhandled rejection that never reaches `reject` — the Promise hangs and the error is lost. And it's pointless: if you can `await`, you don't need `new Promise`. Hence `no-async-promise-executor` treats it as having no correct use.
</details>

**Q55. "Promises are slow, so I cache `Promise.resolve` and reuse it." Good idea?**

<details><summary>Answer</summary>

Mostly a non-issue and occasionally wrong. A microtask is cheap; reaching for micro-optimizations here is usually premature. Reusing a single resolved Promise is fine for a constant, but if you ever attach different `.then` chains expecting independent settlement you can confuse yourself, and it doesn't help at all for *pending* work. The real performance lever isn't avoiding Promises — it's avoiding **needless** ones (the `async`-without-`await` and constructor-wrap patterns) and avoiding accidental serialization (`await` in a loop). Optimize the structure, not the Promise primitive.
</details>

**Q56. Someone returns `Promise.reject(new Error('x'))` from a plain function instead of `throw`ing. Bug or fine?**

<details><summary>Answer</summary>

Fine — and sometimes preferable. From a `Promise`-returning (non-`async`) function, `return Promise.reject(err)` puts the failure on the **async channel**, matching the success channel, so callers handle everything with `.catch`/`await try` and never need a synchronous `try` around the call. A synchronous `throw` from a function callers expect to be Promise-returning is the inconsistency (a mini-zalgo for errors). The only caveat: it's easy to create an unhandled rejection if no one ever attaches a handler — but that's true of any rejection. It's the deliberate twin of "`async` to normalize a throw."
</details>

**Q57. Can `new Promise` ever *help* error handling rather than hurt it?**

<details><summary>Answer</summary>

Yes, at a genuine boundary. When bridging a callback API, `new Promise` lets you convert a Node `(err, …)` callback *and* a synchronous throw from the starting call into a single rejection path — centralizing error handling that was previously split between callbacks and try/catch. The harm only appears when there's no boundary to bridge (you're wrapping an existing Promise) or when you wire `resolve` but forget `reject`. So the tool isn't the problem; using it where a Promise already exists, or wiring it incompletely, is.
</details>

---

## Rapid-Fire / One-Liners

> Crisp answers; what an interviewer wants in a sentence or two.

**Q58. One-line cure for each of the two?**

<details><summary>Answer</summary>

Promise Constructor anti-pattern → if it's already a Promise, `return` it; never re-wrap. `async` without `await` → drop `async` and return the value (unless you're deliberately normalizing sync-to-async).
</details>

**Q59. The single test for "do I need `new Promise`?"**

<details><summary>Answer</summary>

"Is the thing I'm wrapping already a Promise?" Yes → don't; return it. No (callback/event/timer) → `new Promise` is correct.
</details>

**Q60. What does `async` actually guarantee about a function's return?**

<details><summary>Answer</summary>

It always returns a Promise: values become `Promise.resolve(value)`, throws become rejections, returned Promises are adopted.
</details>

**Q61. When must you write `return await`?**

<details><summary>Answer</summary>

Inside `try`/`catch`/`finally`, so the rejection is caught and cleanup runs in-frame (and for better async stack traces).
</details>

**Q62. Why does a wrapped-Promise constructor lose errors?**

<details><summary>Answer</summary>

The executor wires `resolve` but not `reject`, so the inner rejection has nowhere to go: the outer Promise hangs and the rejection goes unhandled.
</details>

**Q63. What is zalgo in one sentence?**

<details><summary>Answer</summary>

A callback/function that's sometimes synchronous and sometimes asynchronous, so callers can't reason about ordering — always be one or the other.
</details>

**Q64. Why ban `new Promise(async …)`?**

<details><summary>Answer</summary>

The constructor ignores the executor's returned Promise, so post-`await` errors become unhandled rejections and the Promise can hang — and if you can `await`, you don't need `new Promise` at all.
</details>

**Q65. Does removing a needless `async` change behavior?**

<details><summary>Answer</summary>

Sometimes — the result becomes synchronous (no microtask hop) and a `throw` becomes synchronous rather than a rejection; safe usually, but do it under tests.
</details>

---

## How to Talk About These in Interviews

A few habits separate a strong answer from a textbook recital:

- **Lead with the mechanism, not the label.** Don't just say "that's the Promise constructor anti-pattern." Say *why it's wrong* — "`fetch` already returns a Promise, so wrapping it adds a microtask and, because `reject` isn't wired, drops the error and hangs." Mechanism beats vocabulary.
- **Always know the legitimate use.** The senior signal here is refusing to pattern-match "`new Promise` = bad" or "`async` with no `await` = bad." Name the bridging cases for the constructor and the normalize/conform/wrap-throw cases for `async`. Absolutism is a juniorism.
- **Be precise about errors.** These two anti-patterns are fundamentally *error-loss* bugs, not just style. Explain the hang-plus-unhandled-rejection mechanic and the sync-throw-vs-rejection channel difference; that's where depth shows.
- **Use `return await` as a litmus test.** "It depends — drop it normally, keep it in a `try`" with the containment reason signals you've debugged real async stack traces.
- **Bring in zalgo at the right moment.** Mentioning "always-be-async to avoid releasing zalgo" turns "`async` with no `await`" from a smell into a tool you wield deliberately — that nuance lands.
- **Go deep when invited.** Microtask ordering, thenable adoption rules, `no-async-promise-executor`, cancellation propagation — these show you understand the runtime, not just the syntax.
- **Tie cures to tooling.** `require-await`, `no-async-promise-executor`, `util.promisify`, TypeScript's `Promise<T>` vs `T` — knowing the gates proves you've prevented these at scale, not just spotted them.

---

## Summary

- The two misuse anti-patterns are **applying async machinery where it doesn't help**: the **Promise Constructor anti-pattern** (re-wrapping an existing Promise, which adds ticks and silently drops rejections) and **`async` Without `await`** (a synchronous function paying a microtask tax and lying about being async).
- The **single test** for `new Promise` is "is this already a Promise?" — bridging a callback/event/timer is legitimate; re-wrapping a Promise is the anti-pattern. The cure is to **return the existing Promise directly**.
- `async` without `await` is the anti-pattern *unless* it's deliberately **normalizing a sometimes-sync API**, **turning a sync throw into a rejection**, or **conforming to a Promise-returning contract** — all of which prevent the caller-confusing "zalgo" of sometimes-sync, sometimes-async behavior.
- Both are at heart **error-loss** bugs: the missing `reject`, the ignored `async`-executor return, and the sync-vs-async error channel are where the depth lies. `return await` (keep in `try`, drop otherwise), microtask ordering, thenable adoption, and lint gates (`require-await`, `no-async-promise-executor`) are the professional-level details.
- The strongest answers lead with **mechanism**, name the **legitimate uses** rather than absolutes, and connect cures to **lint rules, `util.promisify`, and TypeScript**.

---

## Related Topics

- [`junior.md`](junior.md) — recognize each misuse and the plain-code alternative.
- [`middle.md`](middle.md) — when `new Promise` and `async` are genuinely needed, and `promisify`.
- [`senior.md`](senior.md) — bridging utilities, lint gates, and team conventions.
- [`professional.md`](professional.md) — microtask internals, error-loss mechanics, zalgo, cancellation.
- [`tasks.md`](tasks.md) · [`find-bug.md`](find-bug.md) · [`optimize.md`](optimize.md) — practice diagnosing and fixing the misuses.
- [Error Handling Async Anti-Patterns](../01-error-handling/middle.md) — swallowed rejections and floating Promises, the error-loss siblings.
- [Execution Shape Async Anti-Patterns](../02-execution-shape/middle.md) — `await` in loops and Promise chain hell, the "reads differently than it runs" siblings.
- [Async Anti-Patterns Chapter](../README.md) — the full 9-pattern map and category overview.
- [Concurrency Anti-Patterns](../../03-concurrency/README.md) — the multi-thread sibling chapter.
- [Backend / Distributed Systems](../../../../../Backend/distributed-systems/README.md) — timeouts, retries, and cancellation at the network layer.
