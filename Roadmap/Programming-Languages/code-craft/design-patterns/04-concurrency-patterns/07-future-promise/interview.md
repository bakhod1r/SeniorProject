# Future / Promise — Interview Questions

> Graded question bank for the Future/Promise concurrency pattern. Start at [junior.md](junior.md) if the terms below are unfamiliar.

---

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional Questions](#professional-questions)
5. [Coding Tasks](#coding-tasks)
6. [Trick Questions](#trick-questions)
7. [Behavioral / Architectural Questions](#behavioral-architectural-questions)
8. [Tips for Answering](#tips-for-answering)

---

## Junior Questions

**Q1. What is the difference between a Future and a Promise?**
A **Future** is the **read-only** side — a placeholder you can query, await, or compose. A **Promise** is the **write-once** producer side — you `complete` it with a value or an error, which resolves the Future. In Scala/C++ they're separate types; in Java's `CompletableFuture` they're one object whose read methods (`get`, `thenApply`) and write methods (`complete`, `completeExceptionally`) form the two sides.

**Q2. What are the possible states of a Future?**
`PENDING` → either `FULFILLED` (a value) or `REJECTED` (an error). Settled states are terminal and immutable; a second completion is a no-op.

**Q3. What does `CompletableFuture.supplyAsync` return, and does it block?**
It returns a `CompletableFuture<T>` immediately, *without* blocking. The supplier runs on an executor; the caller continues and only blocks later if it calls `get()`/`join()`.

**Q4. Why is `supplyAsync(...).get()` on one line usually a mistake?**
It starts async work and immediately blocks for it — a synchronous call with extra overhead. The benefit of a Future is doing other work or composing while it runs.

---

## Middle Questions

**Q5. Explain `thenApply` vs `thenCompose`.**
`thenApply(fn)` maps the value: `T → U` (it's `map`). `thenCompose(fn)` is for when `fn` *itself returns a Future*: `T → Future<U>`, and it **flattens** the result (it's `flatMap`). Using `thenApply` with a future-returning lambda yields a nested `Future<Future<U>>` — a common bug.

**Q6. How do you run three independent calls in parallel and combine them?**
Start three `supplyAsync` Futures, then `CompletableFuture.allOf(f1, f2, f3).thenApply(v -> combine(f1.join(), f2.join(), f3.join()))`. After `allOf` settles, the per-future `join()`s don't actually block. Latency becomes the slowest call, not the sum.

**Q7. What are `exceptionally`, `handle`, and `whenComplete`?**
`exceptionally(ex -> fallback)` recovers only on failure. `handle((v, ex) -> ...)` runs on both outcomes and can transform either. `whenComplete((v, ex) -> ...)` observes both but **doesn't change** the result (good for logging/cleanup).

**Q8. How does an exception propagate through a chain?**
A failing stage rejects the Future; downstream `thenApply`/`thenCompose` stages are **skipped**, and the error jumps to the nearest `exceptionally`/`handle`/`whenComplete` — like `try/catch` across stages. Note `get` wraps it in `ExecutionException`, `join` in `CompletionException`; unwrap with `getCause()`.

---

## Senior Questions

**Q9. Where does a `thenApply` callback run, and how do you control it?**
Non-async `thenApply` runs on whichever thread completed the previous stage — or the *calling* thread if the source is already settled. That's unpredictable, so for anything non-trivial or blocking use `thenApplyAsync(fn, executor)` with an **explicit** executor. The no-executor `*Async` form uses `ForkJoinPool.commonPool()`, which must never hold blocking work.

**Q10. Describe a deadlock you can get from blocking `get()`.**
If a task running on bounded pool P calls `get()` on a Future whose producing task is *also* scheduled on P, and P is saturated, the producer can't get a thread while the consumer holds one blocked. Enough such tasks deadlock P. Fix: never block on results produced by the same pool; compose instead, or isolate pools (bulkheading).

**Q11. Does `CompletableFuture.cancel(true)` stop the running computation?**
No. It marks the Future cancelled but does **not** interrupt a running `supplyAsync` task — the work runs to completion. Real cancellation requires cooperative checks or the raw `ExecutorService` `Future`, whose `cancel(true)` *does* interrupt.

**Q12. How do you collect partial results instead of fail-fast `allOf`?**
Wrap each future with `handle((v, ex) -> Outcome.of(v, ex))` so it never fails, then `allOf` over the wrapped futures and join each. Now nothing short-circuits and you get every success and failure.

---

## Professional Questions

**Q13. How is `CompletableFuture` implemented internally?**
A single volatile `result` field (null = pending, value or `AltResult(throwable)` = settled), completed by a CAS so the first writer wins. Dependents are held in a lock-free Treiber **stack** of `Completion` nodes; on completion they're popped and fired — inline for sync stages, submitted to an executor for `*Async` stages. No locks on the hot path.

**Q14. Eager vs lazy futures — contrast Java and Rust.**
Java/JS/Scala futures are **eager/push**: creation starts the work; completion pushes to callbacks; cancellation is weak. Rust futures are **lazy/poll**: inert state machines that do nothing until an executor `poll`s them; cancellation is just *dropping* the future; no allocation by default; the runtime is external (Tokio). JS adds that `.then` always defers to the microtask queue, never running inline.

**Q15. How do virtual threads / structured concurrency change the picture?**
Loom makes blocking cheap (virtual threads unmount on block), so plain `get()` is acceptable again with linear, debuggable code. `StructuredTaskScope` scopes child tasks, propagates cancellation, and preserves stack traces. `CompletableFuture` stays as the interop return type; structured concurrency becomes the internal fan-out implementation.

**Q16. Why doesn't publishing a mutable result object need extra synchronization?**
`complete` is a volatile write and observing completion is a volatile read, establishing a happens-before edge. Everything the producer did before completing is visible to consumers after they observe it — provided the producer stops mutating the result before completing.

---

## Coding Tasks

**T1.** Implement `firstSuccessful(List<CompletableFuture<T>>)` returning the first to *succeed* (not merely settle — `anyOf` would return the first failure too).

**T2.** Convert a 3-level nested callback API into a flat `thenCompose` chain with one `exceptionally`.

**T3.** Implement `withRetry(Supplier<CompletableFuture<T>>, attempts, backoff)` using `exceptionallyCompose` and recursion.

**T4.** Implement `timeout(CompletableFuture<T>, Duration)` that completes exceptionally if the source is too slow (without `orTimeout`).

**T5.** Bounded fan-out: process 10k IDs with at most 32 in flight, returning all results. (Solutions in [tasks.md](tasks.md).)

---

## Trick Questions

**TQ1. Does `allOf()` with no arguments block forever?**
No — it completes immediately and successfully. Guard empty input if your logic assumes "at least one."

**TQ2. If you attach `thenApply` to an already-completed Future, on which thread does it run?**
The **calling** thread, synchronously, right there — because the source is already settled. (`thenApplyAsync` would still hop to the executor.) In JavaScript, by contrast, `.then` on a resolved Promise still defers to the microtask queue.

**TQ3. Two threads call `complete()` on the same `CompletableFuture`. What happens?**
The first wins (CAS), returns `true`; the second is a no-op, returns `false`. The observed value is the first one. It's race-safe, not an error.

**TQ4. A chain ends in `.thenApply(...)` with no error handler and the work throws. What does the user see?**
Nothing — the exception is captured in the unobserved Future and silently swallowed. No log, no crash. Always terminate fire-and-forget chains with `whenComplete`/`exceptionally`.

**TQ5. Does `whenComplete` swallow the exception?**
No — it observes and passes the result/exception through unchanged. `handle` is the one that "consumes" the exception by returning a substitute value.

---

## Behavioral / Architectural Questions

**BQ1. Tell me about a time async code caused a production incident.**
Strong answers name a concrete failure mode (blocking `get()` on the common pool starving parallel streams; an unobserved exception hiding a data-loss bug; unbounded fan-out OOMing the service), the diagnosis (thread dump showing all pool threads blocked; missing error metric), and the fix (separate bulkheaded pools, mandatory `whenComplete` logging, semaphore-bounded concurrency).

**BQ2. When would you choose reactive streams over Futures? Virtual threads over both?**
Futures for **one** async value; reactive streams when you have **many values over time and need backpressure**; virtual threads/structured concurrency when you want **blocking code that's cheap and debuggable** and don't need streaming semantics.

**BQ3. How would you make a Future-heavy service testable?**
Inject the executor (use a same-thread `Runnable::run` executor in tests for determinism), stub collaborators with `completedFuture`/`failedFuture`, control the clock for timeout tests, and assert on settled outcomes with an outer test timeout rather than `sleep`.

---

## Tips for Answering

- **Lead with the read/write split** on any "what is a Future" question — it signals you understand the pattern, not just the API.
- **Name the executor.** Whenever you mention `*Async`, say *which* executor and why — interviewers probe exactly there.
- **Volunteer the failure modes:** blocking `get()` starvation, lost exceptions, weak cancellation. Knowing the sharp edges separates senior from middle.
- **Use `thenCompose` correctly** in any live coding — reaching for `thenApply` on a future-returning lambda is an instant tell.
- **Bridge to Loom** at professional level: show you know `CompletableFuture` is becoming the *interop* layer over structured concurrency, not the end state.
