# Async Error-Handling Anti-Patterns — Interview Q&A

> **Category:** [Async Anti-Patterns](../README.md) → **Error Handling** — *errors that fall on the floor instead of propagating.*
> **Covers (collectively):** Swallowed Promise Rejection · Floating Promise · Fire-and-Forget Without Logging · Forgotten `await`

A bank of 60+ interview questions and answers on the four ways async errors disappear silently. Each answer models the reasoning a strong candidate gives — including the trade-offs and the language-specific detail (JavaScript/TypeScript primarily, Python `asyncio`, Go for contrast). Use the `<details>` toggles to self-quiz: read the question, answer out loud, then expand.

---

## Table of Contents

1. [Fundamentals / Junior](#fundamentals--junior)
2. [Intermediate / Middle](#intermediate--middle)
3. [Senior — Structured Concurrency, Cancellation, Supervision](#senior--structured-concurrency-cancellation-supervision)
4. [Professional / Deep — Event Loop, Policy, Leaks, Tracing](#professional--deep--event-loop-policy-leaks-tracing)
5. [Code-Reading — Diagnose the Snippet](#code-reading--diagnose-the-snippet)
6. [Curveballs](#curveballs)
7. [Rapid-Fire / One-Liners](#rapid-fire--one-liners)
8. [How to Talk About Async Errors in Interviews](#how-to-talk-about-async-errors-in-interviews)
9. [Summary](#summary)
10. [Related Topics](#related-topics)

---

## Fundamentals / Junior

> What a rejection is, what `await` does, and why these four bugs are silent.

**Q1. Name the four async error-handling anti-patterns and give a one-line symptom for each.**

<details><summary>Answer</summary>

- **Swallowed Promise Rejection** — `p.then(handle)` with no `.catch()`, or `catch(() => {})` that eats the error; the failure produces nothing observable.
- **Floating Promise** — a Promise is created but never `await`ed or `.catch`ed; it runs, may reject, and nobody is attached to hear it.
- **Fire-and-Forget Without Logging** — a background task is launched deliberately, but its failure is never logged or measured, so it vanishes in production.
- **Forgotten `await`** — `const u = getUser()` leaves `u` as a `Promise<User>`, not a `User`; the next line reads `.name` off a Promise and gets `undefined`.

The common thread: an error (or a value) exists, but no observer is attached to it, so the program continues as if nothing happened.
</details>

**Q2. What is a Promise rejection, concretely?**

<details><summary>Answer</summary>

A Promise is a placeholder for a future value in one of three states: *pending*, *fulfilled* (resolved with a value), or *rejected* (failed with a reason, usually an `Error`). A rejection is the asynchronous analogue of a thrown exception — it's how an async operation signals failure. The crucial difference from a synchronous `throw` is *timing*: the rejection happens later, after the call stack that created the Promise has already unwound, so there is no enclosing `try/catch` on the stack to catch it. You must attach a handler (`.catch`, or `try/catch` around `await`) explicitly, or the failure has nowhere to go.
</details>

**Q3. What does `await` actually do?**

<details><summary>Answer</summary>

`await p` suspends the current async function until the Promise `p` settles, then either *evaluates to the fulfilled value* or *throws the rejection reason* at that point in the code. Two consequences matter: (1) it unwraps `Promise<T>` to `T`, so you work with the value, not the box; (2) it re-introduces the rejection into the synchronous control flow as a `throw`, so an ordinary `try/catch` around the `await` works again. Forgetting `await` loses both: you keep the unwrapped Promise *and* the rejection escapes your `try/catch`.
</details>

**Q4. Why is a forgotten `await` a *silent* bug instead of a crash?**

<details><summary>Answer</summary>

Because a Promise is a perfectly valid object. `const user = getUser(id)` succeeds — `user` is a real `Promise<User>`. Reading `user.name` doesn't throw; it returns `undefined`, because `Promise` objects have no `name` property. So the program keeps running with `undefined` flowing downstream — a logic bug, not an exception. In JavaScript there's no runtime type check to catch it. The fix at the type level is TypeScript: `Promise<User>` is not assignable to `User`, so `user.name` is a compile error — *if* you have types and `strict` on. Untyped JS gives you nothing but the wrong result.
</details>

**Q5. Show the swallowed-rejection bug and the minimal fix.**

<details><summary>Answer</summary>

```js
// Bug: no .catch — if save() rejects, the rejection is unhandled.
saveOrder(order).then(() => render());

// Fix A — promise style:
saveOrder(order).then(() => render()).catch(err => showError(err));

// Fix B — async/await style (clearer):
try {
  await saveOrder(order);
  render();
} catch (err) {
  showError(err);
}
```

The `.then`-without-`.catch` form attaches a fulfillment handler but no rejection handler, so a failure has no observer. The `await` form lets a normal `try/catch` catch it because `await` re-throws the rejection synchronously.
</details>

**Q6. What's the difference between a *floating* Promise and a *swallowed* rejection?**

<details><summary>Answer</summary>

They overlap but aren't the same. A **floating Promise** has *no continuation attached at all* — you called `doAsync()` and discarded the return value entirely, so neither success nor failure is handled. A **swallowed rejection** *does* attach a continuation but it ignores or drops the error — `.then(ok)` with no `.catch`, or `.catch(() => {})`. Floating is "I forgot to handle it"; swallowed is "I handled it wrong (by doing nothing)." Both end the same way — the error vanishes — but the floating one is usually an accidental omission while the swallowed one is often a deliberate-but-wrong `catch`.
</details>

**Q7. In Python `asyncio`, what's the equivalent of a forgotten `await`?**

<details><summary>Answer</summary>

Calling a coroutine function without awaiting it: `result = fetch_user(id)` returns a *coroutine object* that has **not started running** — the body never executes. Python is friendlier than JS here: you get a `RuntimeWarning: coroutine 'fetch_user' was never awaited` at GC time, and using the coroutine object as if it were the value fails loudly in most uses. The "floating task" variant is `asyncio.create_task(fetch_user(id))` and then dropping the reference — that *does* run, but its exception surfaces only as an "exception was never retrieved" warning when the task is collected.
</details>

**Q8. What is "fire-and-forget" and why is the *without-logging* part the actual sin?**

<details><summary>Answer</summary>

Fire-and-forget means launching async work and intentionally not waiting for it — e.g. kicking off an analytics ping during a request. The pattern itself is sometimes legitimate. The anti-pattern is doing it *blind*: no `.catch`, no log, no metric. When the background task fails — and network tasks fail constantly — there is no record anywhere. You discover it only when a user reports missing data weeks later. The cure isn't "never fire-and-forget"; it's "never fire-and-forget *silently*": always attach a failure handler that at minimum logs, ideally emits a metric, and runs the work under some supervisor that knows it exists.
</details>

**Q9. Why can't a normal `try/catch` catch a floating Promise's rejection?**

<details><summary>Answer</summary>

```js
try {
  doAsync(); // floating — no await
} catch (e) {
  // NEVER runs for an async rejection
}
```

`try/catch` only catches what is thrown *synchronously* while that block is on the call stack. `doAsync()` returns immediately (a pending Promise); the `try` block completes and the stack unwinds. The rejection happens later, on a future microtask, long after `catch` is out of scope. To catch it you must keep the Promise on the synchronous path with `await` (`try { await doAsync() }`) or attach `.catch()` directly to the Promise.
</details>

**Q10. Where does an unhandled rejection actually go — does it just disappear?**

<details><summary>Answer</summary>

Not quite — the runtime notices. In V8/Node and browsers, when a rejected Promise is garbage-collected (or the microtask drains) with no rejection handler attached, the runtime fires an **`unhandledrejection`** event (browser) / **`unhandledRejection`** process event (Node). If nobody listens, the browser logs it to the console; modern Node (v15+) *terminates the process* by default. So it's not literally silent at the runtime level — it's silent in *your* code because you didn't attach a handler, and what happens next depends on the runtime's default policy.
</details>

**Q11. What does `.catch()` return, and why does that matter for chaining?**

<details><summary>Answer</summary>

`.catch(fn)` is sugar for `.then(undefined, fn)` and itself returns a *new Promise*. If `fn` returns a value, the chain becomes fulfilled with that value (the error is "recovered"); if `fn` re-throws or returns a rejected Promise, the chain stays rejected and propagates onward. This is why placement matters: a `.catch()` only handles rejections from steps *above* it, and a `.then()` after a `.catch()` runs in the recovered (fulfilled) state. Putting `.catch()` at the *end* of a chain is the common pattern because it catches any rejection from any earlier step.
</details>

**Q12. Is `getUser()` without `await` ever correct?**

<details><summary>Answer</summary>

Yes — when you genuinely want the Promise, not the value. `return getUser(id)` from inside an async function is correct and idiomatic: you hand the Promise back to the caller, who awaits it (and `await` on a returned Promise is flattened, so no double-wrapping). Likewise `const [a, b] = await Promise.all([getUser(1), getUser(2)])` deliberately *doesn't* await each call individually so they run concurrently. The anti-pattern is forgetting `await` when you intended to use the *value* on the next line. Tools can't always tell intent apart, which is why `no-floating-promises` flags the unconsumed cases and you mark deliberate ones with `void`.
</details>

---

## Intermediate / Middle

> Correct error handling, `all` vs `allSettled`, observable fire-and-forget, lint/TS prevention.

**Q13. `Promise.all` vs `Promise.allSettled` — when do you use each?**

<details><summary>Answer</summary>

`Promise.all([...])` rejects **as soon as any one input rejects**, with that first rejection's reason, and discards the rest of the results (the other Promises keep running but you ignore them). Use it for *all-or-nothing* work where one failure means the whole operation is meaningless — fetch three things you all need to render a page. `Promise.allSettled([...])` **never rejects**; it waits for every Promise and returns an array of `{status: 'fulfilled', value}` / `{status: 'rejected', reason}`. Use it for *independent best-effort* work where you want every result regardless — send 100 notifications and report which failed. Choosing `all` when you meant `allSettled` silently drops successful results; choosing `allSettled` when you meant `all` hides failures behind a "resolved" outer Promise.
</details>

**Q14. What's wrong with `Promise.all`, and how do `race` and `any` differ from it?**

<details><summary>Answer</summary>

The subtle trap with `Promise.all` is that a rejection short-circuits the *outer* Promise but does **not cancel** the still-running inner Promises — they finish and, if they reject, can produce *their own* unhandled rejections. The companions: **`Promise.race`** settles with the first Promise to settle *either way* (used for timeouts: race work against a timer); **`Promise.any`** settles with the first to *fulfill*, ignoring rejections until all fail (then rejects with an `AggregateError`) — used for "first successful mirror wins." Knowing which combinator matches the semantics you want is the core middle-level async skill.
</details>

**Q15. How do you make fire-and-forget *observable* without blocking the caller?**

<details><summary>Answer</summary>

Attach a terminal handler that turns failures into telemetry, and make the intent explicit:

```js
void recordAnalytics(event).catch(err => {
  logger.error({ err, event }, 'analytics failed');
  metrics.increment('analytics.failure');
});
```

The `void` documents "I'm intentionally not awaiting this" and satisfies `no-floating-promises`. The `.catch` guarantees no unhandled rejection and converts the failure into a log line plus a counter you can alert on. Better still, run it through a small task tracker so shutdown can drain in-flight work. The point: fire-and-forget is fine *operationally* only if failures are visible and the work is idempotent/non-critical.
</details>

**Q16. What lint rules and TypeScript settings prevent these bugs, and what do they each catch?**

<details><summary>Answer</summary>

- **`@typescript-eslint/no-floating-promises`** — flags any Promise-returning expression whose result is neither awaited, returned, nor `.catch`ed, nor explicitly `void`-ed. This catches floating Promises and most forgotten `await`s.
- **`@typescript-eslint/no-misused-promises`** — flags passing an async function where a `void`-returning callback is expected (e.g. `arr.forEach(async ...)`, an `onClick={async}` that swallows rejections).
- **`require-await`** — flags `async` functions with no `await` (the *misuse* sibling pattern).
- **TypeScript `strict` + return types** — `Promise<T>` is not assignable to `T`, so a forgotten `await` becomes a type error *wherever you use the value as if unwrapped*.

The combination of `no-floating-promises` and `strict` types catches the large majority of this whole category at author/CI time rather than in production.
</details>

**Q17. `forEach(async x => await f(x))` — what's the bug?**

<details><summary>Answer</summary>

`Array.prototype.forEach` ignores its callback's return value, so each async callback returns a Promise that `forEach` *throws away* — every one is a floating Promise. Two failures result: (1) the loop does **not** wait, so code after `forEach` runs before any `f(x)` finishes; (2) any rejection is unhandled. Fixes depend on intent: to run sequentially, use a plain `for...of` with `await`; to run concurrently and wait, use `await Promise.all(arr.map(f))`. `no-misused-promises` flags exactly this.
</details>

**Q18. In Python, what's the `asyncio` equivalent of `Promise.all` vs `allSettled`?**

<details><summary>Answer</summary>

`asyncio.gather(*coros)` is like `Promise.all`: by default the first exception propagates and cancels the others' awaiting (though already-scheduled tasks may keep running). Pass `return_exceptions=True` to get `allSettled` semantics — you get back a list where failures appear as exception *objects* instead of being raised, so you inspect each. The modern structured alternative is `asyncio.TaskGroup` (3.11+): it awaits all children, and if any raise, it cancels the siblings and raises an `ExceptionGroup` — closer to "all-or-nothing with cleanup."
</details>

**Q19. Why is `catch(() => {})` (empty catch) worse than no catch at all?**

<details><summary>Answer</summary>

An empty `.catch` is the most dangerous form because it *silences the runtime's safety net*. With no handler, at least the `unhandledRejection` event fires and you might see a console error or process crash that tips you off. An empty catch tells the runtime "handled — move along," so the error is now *truly* invisible: no log, no event, no crash, no trace. It's the swallowed-rejection anti-pattern in its purest form. If you must catch to prevent a crash, never make the body empty — log at minimum, and re-throw or convert to a typed failure if the caller needs to know.
</details>

**Q20. How do you add a timeout to an async operation, and what error-handling pitfall does it introduce?**

<details><summary>Answer</summary>

Classic approach is `Promise.race([work(), timeout(5000)])` where `timeout` rejects after the delay. The pitfall: racing doesn't *cancel* the slow `work()` — it keeps running, holds resources, and if it later rejects you get an unhandled rejection from the loser of the race. The modern fix is `AbortController`: pass `signal` into `fetch`/your work, and call `controller.abort()` when the timer fires, so the underlying operation is actually cancelled. (`AbortSignal.timeout(5000)` packages this.) So "add a timeout" really means "add cancellation," or you've traded a slow path for a leak plus a floating rejection.
</details>

**Q21. A function returns a Promise *and* takes a callback. Why is that an error-handling hazard?**

<details><summary>Answer</summary>

Dual-mode APIs make error handling ambiguous: does a failure surface via the callback's error argument, via the rejected Promise, or both? Callers wire up one path, the library uses the other, and the error falls through the gap — a swallowed rejection by design. It also tempts double-invocation bugs (callback fires *and* Promise settles). Pick one model per function. If you're wrapping a Node-style callback API, use `util.promisify` rather than hand-rolling, because hand-rolled wrappers commonly forget to `reject` on the error argument — converting every failure into a hang or a swallowed error. (See [Mixing Callbacks and Promises](../README.md).)
</details>

**Q22. What's the difference between "handling" an error and "logging" it, and why does it matter here?**

<details><summary>Answer</summary>

Logging is *recording* that something failed; handling is *deciding what the program does next* (retry, fall back, surface to the user, abort the transaction). A `.catch(log)` makes the failure observable but leaves the program in an undefined state — the caller proceeds as if it succeeded. For fire-and-forget best-effort work, log-and-continue is the correct handling. For anything the caller depends on, logging alone is still a swallowed rejection in disguise: you saw the error and then ignored its consequences. The interview signal is distinguishing "this failure is non-critical, so log-and-drop is *the* handling" from "this failure matters, so I must propagate or compensate."
</details>

**Q23. How does returning vs. awaiting inside a `try` change error handling?**

<details><summary>Answer</summary>

```js
// (A) return without await — the catch does NOT catch a rejection of inner()
async function f() {
  try { return inner(); } catch (e) { return fallback(); }
}
// (B) return await — the catch DOES catch it
async function g() {
  try { return await inner(); } catch (e) { return fallback(); }
}
```

In (A) the Promise is returned and the `try` exits before it settles, so a rejection escapes to the caller — the local `catch` is dead code. In (B) `await` settles the Promise *inside* the `try`, so a rejection is thrown where `catch` can see it. `return await` inside a `try/catch` is the one place the otherwise-redundant `await` on a return is necessary — `no-return-await` rules whitelist this case.
</details>

**Q24. What is `unhandledRejection` and how should a service respond to it?**

<details><summary>Answer</summary>

It's a process/global event the runtime fires when a Promise rejects with no handler attached. A service should *register a listener* both to log the failure with full context (it's your last-resort capture for bugs you missed) and to decide policy. The recommended Node policy mirrors the default: **log it, then crash and let your supervisor restart**, because an unhandled rejection means the process is in an unknown state and continuing risks corrupt data. The anti-pattern is registering a handler that *swallows* it (`process.on('unhandledRejection', () => {})`) to "stop the crashes" — that converts a loud bug into a silent one and is how leaks and data corruption hide.
</details>

**Q25. Refactor this Python fire-and-forget so failures are visible.**

```python
async def handle_request(req):
    asyncio.create_task(send_metrics(req))  # dropped task
    return await process(req)
```

<details><summary>Answer</summary>

```python
def _log_task_error(task: asyncio.Task):
    if not task.cancelled() and task.exception():
        logger.error("metrics task failed", exc_info=task.exception())

async def handle_request(req):
    task = asyncio.create_task(send_metrics(req))
    task.add_done_callback(_log_task_error)   # observe the result
    background_tasks.add(task)                 # keep a strong reference
    task.add_done_callback(background_tasks.discard)
    return await process(req)
```

Two fixes: the `add_done_callback` *retrieves* the exception so it's logged instead of vanishing into a "Task exception was never retrieved" warning; and holding a strong reference in `background_tasks` prevents the loop from garbage-collecting the task before it finishes (a real `asyncio` footgun — `create_task` returns a weakly-held task). For request-scoped work, an `asyncio.TaskGroup` is even better because it ties lifetime and error propagation to a scope.
</details>

**Q26. When is `Promise.all` the *wrong* choice for a batch of independent jobs?**

<details><summary>Answer</summary>

When the jobs are independent and you want all results regardless of individual failures — e.g. sending 1,000 emails. `Promise.all` rejects on the first failed email and you lose the success/failure status of the other 999 (they finished or are finishing, but you've already bailed). That's a mass swallowed-result bug. Use `Promise.allSettled` to get per-job outcomes, then aggregate: count successes, collect failures, decide whether the overall batch "passed" by your own threshold. Reserve `Promise.all` for the case where any single failure genuinely invalidates the whole operation.
</details>

---

## Senior — Structured Concurrency, Cancellation, Supervision

> Scoped lifetimes, cancellation, supervision, error boundaries, and refactoring at scale.

**Q27. What is structured concurrency and how does it eliminate floating Promises and fire-and-forget by design?**

<details><summary>Answer</summary>

Structured concurrency says every concurrent task has a *parent scope* that does not exit until all its children have completed, and a child's failure propagates to the parent (which cancels its siblings). The consequence: there is **no way to "fire and forget"** — every task is owned by a scope, so it can't outlive its parent, leak, or fail silently. Python's `asyncio.TaskGroup`, Trio's nurseries, Kotlin's `coroutineScope`, and Java's `StructuredTaskScope` implement this. JavaScript has no native version, so the discipline is manual: never spawn a Promise you don't `await`, `Promise.all`, or hand to an explicit supervisor. The senior insight is that floating Promises and fire-and-forget are *symptoms of unstructured concurrency* — the model itself is the root cause.
</details>

**Q28. Cancellation: how do you cancel in-flight async work in JS, Python, and Go, and why does it relate to error handling?**

<details><summary>Answer</summary>

- **JS:** `AbortController`/`AbortSignal` — pass the signal into `fetch`/your async fn; `abort()` rejects pending operations with an `AbortError`. There's no preemptive cancellation; it's cooperative.
- **Python:** `task.cancel()` raises `CancelledError` inside the coroutine at the next `await`; you must let it propagate (don't swallow it) for cleanup to work.
- **Go:** `context.Context` with `cancel()`; functions select on `ctx.Done()` and return `ctx.Err()`.

It's an error-handling problem because cancellation *is* an error path: a cancelled operation must reject/raise, propagate, run cleanup (`finally`/`defer`), and **not** be swallowed. The classic bug is a broad `catch (e) {}` or `except Exception:` that eats `AbortError`/`CancelledError`, defeating cancellation and leaking the very work you tried to stop.
</details>

**Q29. What is an "error boundary" for async work, and where do you place it?**

<details><summary>Answer</summary>

An error boundary is a designated place where async failures are *expected, caught, and converted into a defined outcome* — a fallback value, a user-facing error, a retry, or a logged abort. You place it at *ownership boundaries*: the request handler (turn any failure into a 5xx + log), the job runner (catch, record, decide retry vs. dead-letter), the UI component subtree (React error boundaries / suspense), the top-level supervisor. The anti-pattern is *no* boundary (errors float to `unhandledRejection`) or boundaries scattered randomly mid-flow that swallow errors the caller needed. The principle: let errors propagate *up to the level that owns the decision*, and handle them exactly once, there.
</details>

**Q30. What is supervision, and how does a supervisor change how you treat fire-and-forget?**

<details><summary>Answer</summary>

A supervisor is a component that *owns the lifecycle* of background tasks: it tracks what's running, observes each task's outcome, applies a restart/back-off/dead-letter policy on failure, and drains in-flight work on shutdown (think Erlang/OTP supervision trees, or a job queue with retries and a DLQ). Under supervision, "fire-and-forget" stops being forget: you *register* the task with the supervisor instead of orphaning it. So the senior reframing is — don't ban background work, *put it under supervision*. The anti-pattern is `setTimeout(work, 0)` / `create_task(...)`-and-drop, which is background work with *no* supervisor, so failures and shutdown-time loss are guaranteed-invisible.
</details>

**Q31. How do you refactor a large codebase riddled with floating Promises without a risky big-bang change?**

<details><summary>Answer</summary>

Make the problem *visible*, then fix incrementally. (1) Turn on `no-floating-promises` and `no-misused-promises` as warnings (not errors) and run across the repo to get the inventory. (2) Triage: deliberate fire-and-forget gets an explicit `void ....catch(log)`; bugs get an `await`. (3) Promote the rules to *errors* directory-by-directory as you clean each, so new code can't regress. (4) Add `strict` TypeScript on the same cadence to catch forgotten-`await` value misuse. (5) For the genuinely background work, introduce a small task tracker/supervisor so shutdown drains it. Each PR is small, green-to-green, and scoped to a module — never a repo-wide sweep that's impossible to review or revert.
</details>

**Q32. Cooperative cancellation can be *swallowed*. Show the Python footgun and the rule.**

<details><summary>Answer</summary>

```python
async def worker():
    try:
        await do_work()
    except Exception:        # BUG: also catches CancelledError in 3.7
        logger.error("failed")   # cancellation silently swallowed → task won't stop
```

In Python 3.8+ `CancelledError` inherits from `BaseException`, *not* `Exception`, partly to make `except Exception:` stop eating it — but `except BaseException:` or a bare `except:` still does. The rule: **never swallow the cancellation exception** — either don't catch it, or catch, run cleanup, and *re-raise*. The same rule applies to JS `AbortError` (don't let a broad catch turn it into a no-op) and Go (don't ignore `ctx.Err()`). Swallowing the cancellation signal turns "stop now" into "keep running forever," the worst kind of leak.
</details>

**Q33. How does retry logic interact with these anti-patterns — what new failure does it introduce?**

<details><summary>Answer</summary>

Retry is itself an async error handler, and badly built retries create fresh versions of the same bugs. A retry loop that catches *all* errors and retries blindly will retry *non-retryable* failures (a 400, a validation error), masking real bugs as transient — a swallowed rejection with extra steps. A fire-and-forget retry with no max attempts and no jitter becomes a runaway floating-Promise storm. The discipline: classify errors (retryable vs. terminal), bound attempts, add exponential back-off + jitter, propagate the *final* failure (don't swallow it), and make the retried operation idempotent. Retrying without idempotency turns one transient blip into duplicate side effects. (See [retry-pattern](../../../../../Backend/distributed-systems/README.md).)
</details>

**Q34. In a request handler, where exactly should the `await` and the `try/catch` live so nothing is swallowed or floated?**

<details><summary>Answer</summary>

`await` every operation whose result or completion the response depends on, inside a single boundary `try/catch` at the handler top level that converts any failure into a logged, typed HTTP error. Operations the response does *not* depend on (analytics, cache warming) go to an explicit, observed fire-and-forget (`void task.catch(log)`) or to a supervisor — never inside the critical path. The anti-pattern shapes to avoid: awaiting nothing (handler returns 200 before work finishes), a mid-handler `catch` that logs and continues so a downstream step uses bad data, and background work that the framework cancels at response-end (orphaned tasks in serverless are a classic loss). The rule: *critical path = awaited + boundary-caught; best-effort = supervised + logged.*
</details>

**Q35. How do you preserve a useful stack trace across `await` boundaries?**

<details><summary>Answer</summary>

The challenge: when a Promise rejects, the stack reflects where it *rejected*, not the `await` chain that led there, because each `await` is a separate microtask with its own stack. Mitigations: (1) Node's **async stack traces** (on by default in modern V8) stitch the chains together — keep them enabled. (2) Always reject/throw `Error` *objects*, never strings or plain values, because only `Error` captures a stack. (3) When re-throwing across a boundary, wrap with `cause`: `throw new Error('saving order failed', { cause: err })`, preserving the original. (4) Avoid `.catch(e => { throw e })` no-ops that can reset traces. Swallowing-then-rethrowing a *new* bare error is the common way teams destroy the trace that would have located the bug.
</details>

---

## Professional / Deep — Event Loop, Policy, Leaks, Tracing

> Microtasks, runtime rejection policy, leaks, and distributed tracing.

**Q36. Walk through what the event loop does with a rejected Promise that has no handler.**

<details><summary>Answer</summary>

When a Promise rejects, the engine schedules its rejection-handler callbacks as **microtasks**, which drain completely after the current synchronous task and before the next macrotask (timers, I/O). If, by the time the microtask queue is drained, a rejected Promise still has *no* rejection reaction attached, V8 marks it and, on a later turn (or at GC), emits the host's "unhandled rejection" hook. Crucially this is *deferred*: attaching a `.catch()` *synchronously after* creating the Promise — even on a later line in the same tick — still counts as handled, which is why the warning is about Promises that reach a quiescent point with no handler, not ones handled "late but same tick." This timing is also why `await`ing in a different tick than creation can momentarily produce a transient unhandled-rejection warning under heavy load.
</details>

**Q37. Why does modern Node *exit the process* on an unhandled rejection, and is that the right default?**

<details><summary>Answer</summary>

Since Node 15 the default `--unhandled-rejections=throw` treats an unhandled rejection like an uncaught exception: print it and exit non-zero. The rationale: an unhandled rejection means a failure path you didn't account for, leaving the process in an *unknown, possibly corrupt* state; crashing-and-restarting (under a supervisor like systemd/Kubernetes) is safer than limping on with inconsistent data. It's the right default for *services* with a supervisor and idempotent restarts. It can be wrong for long-lived stateful processes where a restart is expensive and the rejection is known-benign — but the cure there is to *handle* the specific rejection, not to set `--unhandled-rejections=warn` globally, which re-hides every other bug. "Let it crash" (Erlang's philosophy) is a feature, not a flaw.
</details>

**Q38. How can floating Promises and dropped tasks cause memory leaks?**

<details><summary>Answer</summary>

Several ways. (1) A pending Promise that never settles (e.g. an `await` on a Promise whose `resolve` is never called — a forgotten timeout or a lost event listener) keeps its `.then` continuations and their closed-over scope alive forever; thousands of these accumulate. (2) Async work captured by closures retains everything in scope until it settles — if it never does, that's a leak proportional to traffic. (3) In `asyncio`, tasks held only by the event loop's weak set get the "never retrieved" warning, but tasks you *do* reference and never await pile up. (4) Unbounded fire-and-forget under load creates back-pressure-free task accumulation. The signature is memory growing with request volume and never recovering at idle. Heap snapshots showing retained Promise/closure chains, or growing pending-task counts, are the diagnostic.
</details>

**Q39. How do you trace an async failure across services in a distributed system?**

<details><summary>Answer</summary>

Propagate a **trace context** (W3C `traceparent` header / OpenTelemetry) through every async hop, and ensure your error handlers *record the span with the error attached* rather than swallowing it. Concretely: instrument the async runtime (Node's `AsyncLocalStorage`, Python's `contextvars`) so the current trace/span is available across `await` boundaries without threading it manually; on a caught error, call `span.recordException(err); span.setStatus(ERROR)` before deciding to retry/propagate. The anti-pattern interaction is direct — a swallowed rejection produces a *gap* in the trace (a span that ends "ok" while its child silently failed), and a floating Promise's failure has *no span at all*, so the distributed trace lies. Observability is only as honest as your error handling.
</details>

**Q40. `AsyncLocalStorage` / `contextvars` — why are they relevant to async error handling specifically?**

<details><summary>Answer</summary>

They carry per-operation context (request id, trace id, user) *across* `await` suspensions, where a plain variable or `try/catch` scope would be lost because the stack unwound. This matters for error handling because when a rejection surfaces — possibly many ticks and several `await`s away from where the request started — you want to log it *with the originating request's context*. Without async-context propagation, your top-level `unhandledRejection`/error-boundary handler logs an error with no idea which request caused it, which makes the failure observable-but-useless. So async context is what lets a centralized error boundary attribute a late, detached failure back to its origin.
</details>

**Q41. How does Go's error-as-value model avoid most of these anti-patterns — and what does it *not* prevent?**

<details><summary>Answer</summary>

Go has no Promises and no `await`; a goroutine that can fail returns its result and an `error` *value* through a channel or a synchronous return. This structurally removes several bugs: there's no "forgot to `await`" (you call the function and get its result/error directly), and the compiler/vet flags ignored error returns, so silent swallowing is harder. **What it does *not* prevent:** you can still `_ = doThing()` to deliberately discard an error (the explicit swallow), launch `go work()` as fire-and-forget with no way to recover its error or even know it panicked (a goroutine panic with no `recover` crashes the whole process), and leak goroutines blocked forever on a channel (the floating-Promise analogue — a goroutine leak). The lesson for interviews: making errors *values* eliminates the *accidental* loss (the floating/forgotten cases) but not the *deliberate* loss (the empty-catch case) or the unsupervised-background-work case.
</details>

**Q42. What's the cost of `async`/`await` at the event-loop level, and how does it relate to error handling?**

<details><summary>Answer</summary>

Each `await` introduces at least one microtask hop — the function suspends and resumes on a later microtask turn even if the awaited value is already available. That's cheap individually but adds up in hot loops, and it changes *ordering*: code after an `await` runs strictly later than synchronous code queued before it. The error-handling tie-in: this re-ordering is exactly why a forgotten `await` is silent (the value isn't ready yet on the synchronous next line) and why `try/catch` placement is subtle (the throw happens on a resumed microtask, not synchronously). Understanding microtask timing is what lets you reason about *when* a rejection becomes observable and *where* a handler must sit to catch it.
</details>

**Q43. How would you build a process-wide safety net so no async error is ever truly lost, without it masking bugs?**

<details><summary>Answer</summary>

Layer it. (1) Local: every critical path is awaited inside a boundary `try/catch`; every deliberate fire-and-forget has `.catch(log+metric)`. (2) Lint/types: `no-floating-promises` + `strict` as CI gates so the local layer is enforced. (3) Process: `process.on('unhandledRejection')` and `uncaughtException` handlers that **log with full context and then exit** (let the supervisor restart) — they're a *capture-and-crash* net, never a *swallow-and-continue* net. (4) Platform: a supervisor (k8s/systemd) restarts; alerting fires on the metric/log. The discipline is that the global handler *records and crashes* rather than *recovers*, so it surfaces the bugs the local layers missed instead of hiding them. A global handler that returns normally is itself the swallowed-rejection anti-pattern at the largest scale.
</details>

---

## Code-Reading — Diagnose the Snippet

> You're shown a snippet; name the anti-pattern(s) and state the fix.

**Q44. Which anti-pattern, and what's the fix?**

```js
function saveAndNotify(order) {
  db.save(order);          // returns a Promise
  notify(order.userId);    // returns a Promise
  return { ok: true };
}
```

<details><summary>Answer</summary>

**Floating Promises** (two of them) plus a **forgotten `await`** in effect. `db.save` and `notify` are launched but never awaited, so the function returns `{ ok: true }` *before either completes* — and if `db.save` rejects, it's an unhandled rejection. The caller is told it succeeded when it may not have. Fix:

```js
async function saveAndNotify(order) {
  await db.save(order);
  await notify(order.userId);   // or Promise.all if independent
  return { ok: true };
}
```

If `notify` is genuinely best-effort, keep it fire-and-forget but make it observable: `void notify(order.userId).catch(err => logger.warn({ err }, 'notify failed'))`.
</details>

**Q45. Which anti-pattern, and what's the fix?**

```ts
async function getName(id: string): Promise<string> {
  const user = fetchUser(id);   // no await
  return user.name;             // 'name' on a Promise
}
```

<details><summary>Answer</summary>

**Forgotten `await`.** `user` is a `Promise<User>`, not a `User`; `user.name` is `undefined` at runtime. With TypeScript `strict` on this is actually a *compile error* — `Property 'name' does not exist on type 'Promise<User>'` — which is the whole point of types here. Fix: `const user = await fetchUser(id); return user.name;`. The interview note: in plain JS this ships silently and returns `undefined`; the type system is what converts a silent production bug into a build failure.
</details>

**Q46. Which anti-pattern, and what's the fix?**

```python
async def process_all(items):
    for item in items:
        asyncio.create_task(handle(item))   # tasks dropped
    return "done"
```

<details><summary>Answer</summary>

**Fire-and-forget without supervision** (and a **floating-task** leak). The function returns `"done"` immediately while the `handle` tasks run detached; any exception surfaces only as a "Task exception was never retrieved" warning, and because no references are kept, tasks can be GC'd mid-flight. Fix with structured concurrency:

```python
async def process_all(items):
    async with asyncio.TaskGroup() as tg:
        for item in items:
            tg.create_task(handle(item))
    return "done"   # only reached after all complete; failures raise ExceptionGroup
```

The `TaskGroup` waits for every child, propagates failures, and cancels siblings on error — no leak, no swallowed exception.
</details>

**Q47. Which anti-pattern, and what's the fix?**

```js
fetchConfig()
  .then(cfg => applyConfig(cfg))
  .catch(() => {});           // empty catch
```

<details><summary>Answer</summary>

**Swallowed Promise Rejection** in its purest form — the empty `.catch` silences any failure of `fetchConfig` *or* `applyConfig`, including programmer errors like a `TypeError` in `applyConfig`. The app proceeds with no config and no clue why. Fix: handle it meaningfully — log and apply a known fallback, or surface it: `.catch(err => { logger.error({ err }, 'config load failed'); applyConfig(DEFAULT_CONFIG); })`. If there's truly no recovery, at minimum log; never leave the body empty, which defeats even the runtime's last-resort `unhandledrejection` net.
</details>

**Q48. Which anti-pattern, and what's the fix?**

```js
const results = await Promise.all(
  userIds.map(id => sendReminderEmail(id))
);
console.log(`Sent ${results.length} reminders`);
```

<details><summary>Answer</summary>

**Swallowed results via the wrong combinator.** These emails are *independent best-effort* sends, but `Promise.all` rejects on the first failure — so one bad address aborts the whole batch and you lose the status of every other send (and the log line never runs). It also leaves the other in-flight Promises to reject unhandled. Fix with `allSettled` and aggregate:

```js
const outcomes = await Promise.allSettled(userIds.map(id => sendReminderEmail(id)));
const sent = outcomes.filter(o => o.status === 'fulfilled').length;
const failed = outcomes.filter(o => o.status === 'rejected');
failed.forEach(f => logger.warn({ err: f.reason }, 'reminder failed'));
console.log(`Sent ${sent}/${userIds.length} reminders`);
```
</details>

**Q49. This Go snippet has an async error-handling bug — name it.**

```go
func handle(w http.ResponseWriter, r *http.Request) {
    go auditLog(r)        // fire-and-forget goroutine
    process(w, r)
}

func auditLog(r *http.Request) {
    db.Write(buildEntry(r))   // error return ignored; can panic
}
```

<details><summary>Answer</summary>

**Fire-and-forget without logging/supervision**, the Go flavor. `go auditLog(r)` launches an unsupervised goroutine: its `db.Write` error is discarded, and worse, an unrecovered *panic* inside it crashes the entire process (a goroutine panic is not contained). It can also outlive the request and read a recycled `*http.Request`. Fix: don't launch raw goroutines for fallible work — handle the error and recover the panic, and ideally feed it to a worker pool / supervisor:

```go
func auditLog(r *http.Request) {
    defer func() { if p := recover(); p != nil { log.Printf("audit panic: %v", p) } }()
    if err := db.Write(buildEntry(r)); err != nil {
        log.Printf("audit write failed: %v", err)
    }
}
```

Even so, an unbounded `go` per request can leak goroutines under load — a bounded queue is the production answer.
</details>

**Q50. This snippet shows two anti-patterns at once — name both.**

```js
async function checkout(cart) {
  try {
    chargeCard(cart);          // (1) no await
  } catch (e) {
    logger.error(e);           // (2) will never run
  }
  return clearCart(cart);
}
```

<details><summary>Answer</summary>

**Forgotten `await`** *and* a resulting **swallowed rejection**. `chargeCard(cart)` isn't awaited, so it floats; the `try/catch` can't catch its rejection (the block exits before the Promise settles), so the `catch` is dead code — and a charge failure becomes an unhandled rejection while `clearCart` runs anyway, emptying the cart of an unpaid order. Fix: `await` inside the `try` so the catch is live, and make ordering correct:

```js
async function checkout(cart) {
  try {
    await chargeCard(cart);
  } catch (e) {
    logger.error(e);
    throw e;                 // don't clear the cart on a failed charge
  }
  return clearCart(cart);
}
```
</details>

---

## Curveballs

> The questions designed to catch glib answers.

**Q51. What happens to an unhandled Promise rejection in Node?**

<details><summary>Answer</summary>

In **modern Node (v15+)** the default is to treat it like an uncaught exception: print the rejection and the stack to stderr and **exit the process with a non-zero code**. Older Node (pre-15) merely logged a `UnhandledPromiseRejectionWarning` and kept running (and warned that future versions would crash). You can override with `--unhandled-rejections=warn|strict|none`, and you can register `process.on('unhandledRejection', ...)` to intercept. The strong-candidate framing: the *default is to crash because the process is in an unknown state*, and the right response in production is to log-with-context and let the supervisor restart — not to register a handler that swallows it to "fix the crashes."
</details>

**Q52. Is fire-and-forget ever OK?**

<details><summary>Answer</summary>

Yes — under three conditions met together: the work is **non-critical** (the caller's correctness doesn't depend on it — analytics, cache warming, best-effort notifications); failures are **observable** (a `.catch` that logs and increments a metric, never an empty catch); and the work is **idempotent / safe to lose** (so a dropped or duplicated run causes no corruption). Ideally it also runs under a **supervisor** that drains in-flight work on shutdown. So the honest interview answer isn't "never" — it's "fire-and-forget is fine for best-effort, logged, idempotent work under supervision; it's an anti-pattern only when it's *silent* or when the caller actually depends on it."
</details>

**Q53. `Promise.all` vs `Promise.allSettled` — which would you reach for by default, and why is "default" a trap?**

<details><summary>Answer</summary>

There is no safe default — the choice *is* the semantics. `all` = all-or-nothing (one failure invalidates everything); `allSettled` = independent best-effort (collect every outcome). Reaching for one "by default" is exactly how the swallowed-results bug ships: people habitually write `Promise.all` and silently lose successful results when one item fails, or habitually write `allSettled` and never notice that a critical dependency failed because the outer Promise resolved fine. The senior answer refuses the premise: state the semantics you need (does any single failure make the whole thing meaningless?) and pick accordingly — and remember `all` doesn't cancel the losers.
</details>

**Q54. Why does a forgotten `await` cause a silent logic bug rather than a crash?**

<details><summary>Answer</summary>

Because every step along the way is *valid*. `getUser()` returns a real object (a Promise). Assigning it succeeds. Reading a missing property off it returns `undefined`, not an error. Passing `undefined` onward is legal. So there's no point at which the runtime can say "this is wrong" — JavaScript has no synchronous type check to notice you're holding a box instead of its contents. The error is *semantic*, not *operational*. This is precisely why the cure is the type system (TS `Promise<T>` ≠ `T`) and the linter (`no-floating-promises`), which restore a place where "wrong" can be detected — at build time, not 2 a.m.
</details>

**Q55. How does Go's error-as-value model avoid these anti-patterns, and where does it fall short?**

<details><summary>Answer</summary>

By returning failures as ordinary `error` values that the caller receives *synchronously* alongside the result, Go eliminates the "forgot to await" and "floating Promise" cases structurally — there's no detached future to lose, and `go vet`/`errcheck` flag ignored returns. But it doesn't prevent the *deliberate* losses: `_ = f()` explicitly discards an error (the empty-catch analogue), `go work()` is unsupervised fire-and-forget where a panic crashes the whole process, and a goroutine blocked forever on a channel is a leak (the floating analogue). So errors-as-values fixes *accidental* invisibility but the *intentional* swallow and the *unsupervised background* cases survive — they're discipline problems in any language.
</details>

**Q56. A teammate adds `process.on('unhandledRejection', () => {})` "to stop the crashes." What do you say?**

<details><summary>Answer</summary>

That it doesn't fix anything — it converts a loud, debuggable crash into a silent fleet of broken requests and slow leaks. The crashes were a *symptom*; the disease is somewhere a rejection isn't handled. An empty global handler is the swallowed-rejection anti-pattern at maximum scope: every unhandled rejection in the entire app now vanishes, including ones that leave state corrupt. The right move is to *find* the unhandled rejection (the crash log points right at it), handle it locally, and keep the global handler as **log-with-context-then-crash**. The global net captures bugs you missed; it must never let the process limp on in an unknown state.
</details>

**Q57. If `Promise.all` rejects, what happens to the other Promises — and why is that a hidden bug source?**

<details><summary>Answer</summary>

They keep running. `Promise.all` settling-rejected only resolves the *outer* aggregate Promise; it has no power to cancel the inputs, which continue to completion. Two hidden bugs follow: (1) **wasted/uncancelled work** — the other requests still hit the network, hold connections, and mutate state, even though you've "given up." (2) **secondary unhandled rejections** — if one of those still-running Promises later rejects and nothing is attached to it (because you already bailed at the first failure), you get a *separate* unhandled rejection that crashes the process or pollutes logs. The fix when cancellation matters is to thread an `AbortSignal` into each input and abort the rest in the aggregate's failure handler.
</details>

**Q58. "We `await` everything, so we're safe from these bugs." True?**

<details><summary>Answer</summary>

No — awaiting everything fixes floating/forgotten cases but introduces the opposite problem and leaves others untouched. Awaiting *everything* serializes work that could be concurrent (the `await`-in-a-loop anti-pattern), and it doesn't address swallowed rejections (you can still `try{await x}catch{}` empty) or fire-and-forget done *deliberately wrong*. It also can't help if you `await` inside a broad `catch` that eats cancellation. The mature stance: `await` what you depend on, run independent work concurrently with `Promise.all`/`allSettled`, route best-effort work to observed fire-and-forget, and never let a `catch` be empty. "Await everything" is a juniorism that trades silent-failure bugs for silent-slowness bugs. (See [await in a Loop](../README.md).)
</details>

---

## Rapid-Fire / One-Liners

> Crisp answers; what an interviewer wants in one or two sentences.

**Q59. One-line cure for each of the four?**

<details><summary>Answer</summary>

Swallowed Rejection → never an empty `.catch`; log and handle or re-throw. Floating Promise → `await` it (or `void it.catch(log)` if deliberate). Fire-and-Forget → log + metric + idempotent + supervised, or don't. Forgotten `await` → `await` + TS `strict` + `no-floating-promises`.
</details>

**Q60. What does an unhandled rejection do in modern Node?**

<details><summary>Answer</summary>

Logs it and exits the process non-zero (default `--unhandled-rejections=throw`) — let the supervisor restart.
</details>

**Q61. `Promise.all` vs `allSettled` in one sentence?**

<details><summary>Answer</summary>

`all` rejects on the first failure (all-or-nothing); `allSettled` always resolves with every outcome (independent best-effort).
</details>

**Q62. The fastest way to make fire-and-forget acceptable?**

<details><summary>Answer</summary>

`void task().catch(err => { log(err); metric.inc(); })` — explicit, observed, non-blocking.
</details>

**Q63. Why is an empty `catch` worse than no `catch`?**

<details><summary>Answer</summary>

No catch still trips the runtime's `unhandledRejection` net; an empty catch silences even that.
</details>

**Q64. The one place `return await` is necessary?**

<details><summary>Answer</summary>

Inside a `try/catch` — without `await`, the catch can't see the rejection.
</details>

**Q65. Lint rule that catches the most of this category?**

<details><summary>Answer</summary>

`@typescript-eslint/no-floating-promises` (plus `no-misused-promises` and TS `strict`).
</details>

**Q66. Structured concurrency in one sentence, and which anti-patterns it kills?**

<details><summary>Answer</summary>

Every task lives in a scope that won't exit until its children finish and propagates their errors — which structurally eliminates floating Promises and unsupervised fire-and-forget.
</details>

**Q67. The cancellation footgun in one sentence?**

<details><summary>Answer</summary>

A broad `catch`/`except` that swallows `AbortError`/`CancelledError` turns "stop now" into "run forever."
</details>

---

## How to Talk About Async Errors in Interviews

A few habits separate a strong answer from a textbook recital:

- **Name the mechanism, not just the label.** Don't only say "floating Promise." Explain *why* the error is lost — "the stack unwound before it rejected, so there was no `try/catch` and no handler attached, and the runtime's `unhandledRejection` fired." Interviewers want the event-loop reasoning.
- **Refuse false defaults.** "`Promise.all` vs `allSettled`?" has no default answer — state the *semantics* (does one failure invalidate everything?) and pick. Reaching for a habitual combinator is how the swallowed-results bug ships.
- **Reframe "never" into "never *silently*."** Fire-and-forget, global handlers, and background tasks aren't banned — they're banned *unsupervised and unlogged*. Showing the legitimate-with-conditions version is the senior signal.
- **Tie the cure to the layer.** Local (`await` + boundary `try/catch`), tooling (`no-floating-promises` + TS `strict`), process (log-and-crash global handler), platform (supervisor restart). Naming all four layers shows you've run this in production.
- **Distinguish handling from logging.** "I'd `.catch(log)`" is only correct for best-effort work; for critical paths, logging-and-continuing is a swallowed rejection in disguise. Say what the program *does next*.
- **Bring cancellation and tracing in when asked to go deep.** `AbortController`/`CancelledError`/`context`, `AsyncLocalStorage`/`contextvars`, async stack traces with `cause`, and structured concurrency are the depth markers.
- **Use the contrast languages deliberately.** Python's `TaskGroup`/`never retrieved` warning and Go's errors-as-values sharpen the JS answer — they show the same bug class solved (or not) by different language design.

---

## Summary

- The four async error-handling anti-patterns all share one root: **an error or value exists but no observer is attached**, so the program proceeds as if nothing failed — **Swallowed Rejection** (handler eats it), **Floating Promise** (no handler at all), **Fire-and-Forget Without Logging** (deliberate background work, blind to failure), and **Forgotten `await`** (you keep the Promise instead of the value, and the rejection escapes your `try/catch`).
- Recognition and "what `await`/rejection mean" is the junior bar; the middle bar is **correct combinators** (`all` vs `allSettled`), **observable fire-and-forget**, and **lint/TS prevention** (`no-floating-promises`, `no-misused-promises`, `strict`); the senior bar is **structured concurrency, cancellation, supervision, and error boundaries**; the professional bar is the **event loop, runtime rejection policy, leaks, and distributed tracing**.
- The strongest answers explain the **mechanism** (stack unwinds before the rejection, microtask timing), **refuse false defaults** (combinator choice is semantics, not habit), reframe "never" into **"never *silently*,"** and tie cures to **layers** — local handling, tooling gates, a log-and-crash global net, and platform supervision.
- The recurring curveball insight: a forgotten `await` is a *silent logic bug* (every step is valid; only types/lint can flag it), an empty `catch` is worse than none (it defeats the runtime net), and fire-and-forget is acceptable only when **non-critical, logged, idempotent, and supervised**.

---

## Related Topics

- [`junior.md`](junior.md) — what `await` and rejections are; avoid creating these bugs.
- [`middle.md`](middle.md) — correct combinators, observable fire-and-forget, lint/TS gates.
- [`senior.md`](senior.md) — structured concurrency, cancellation, supervision, error boundaries.
- [`professional.md`](professional.md) — event loop, rejection policy, leaks, tracing.
- [`tasks.md`](tasks.md) · [`find-bug.md`](find-bug.md) · [`optimize.md`](optimize.md) — practice the diagnosis and cleanup.
- [Async Anti-Patterns chapter](../README.md) — execution-shape (`await`-in-a-loop, Promise chain hell, mixing callbacks and Promises) and misuse (Promise constructor, `async` without `await`) siblings.
- [Concurrency Anti-Patterns](../../03-concurrency/README.md) — the multi-thread sibling chapter (locks, races, deadlocks).
- [Clean Code → Error Handling](../../../clean-code/06-error-handling/README.md) — the positive error-handling discipline these anti-patterns violate.
- [Backend / Distributed Systems](../../../../../Backend/distributed-systems/README.md) — retries, timeouts, dead-letter queues, and tracing at the network layer.
