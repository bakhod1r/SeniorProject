# Future / Promise — Tasks

> Hands-on tasks for the Future/Promise pattern. Each has a goal, requirements, hints, and a solution sketch. Primary language Java (`CompletableFuture`), with JavaScript/Scala where the read/write split is clearer. Read [middle.md](middle.md) first.

---

## Table of Contents

1. [Task 1 — Callback to Future adapter](#task-1)
2. [Task 2 — Flatten the nesting bug](#task-2)
3. [Task 3 — Parallel fan-out / fan-in](#task-3)
4. [Task 4 — firstSuccessful](#task-4)
5. [Task 5 — Custom timeout](#task-5)
6. [Task 6 — Retry with exponential backoff](#task-6)
7. [Task 7 — Bounded-concurrency fan-out](#task-7)
8. [Task 8 — Partial-results aggregation](#task-8)
9. [Task 9 — Scala Promise split](#task-9)
10. [Task 10 — Cache-then-network race](#task-10)
11. [How to Practice](#how-to-practice)

---

<a id="task-1"></a>
## Task 1 — Callback to Future adapter

**Goal.** Wrap a legacy callback API in a method returning `CompletableFuture<User>`.

**Requirements.** Resolve on success, `completeExceptionally` on error. Never block.

**Hints.** Create an empty `new CompletableFuture<>()`, complete it from inside the callback, return it immediately.

**Solution sketch.**
```java
CompletableFuture<User> fetchUserF(long id) {
    CompletableFuture<User> p = new CompletableFuture<>();
    legacyApi.fetchUser(id, (user, err) -> {
        if (err != null) p.completeExceptionally(err);
        else             p.complete(user);
    });
    return p;   // returned BEFORE the callback fires
}
```

---

<a id="task-2"></a>
## Task 2 — Flatten the nesting bug

**Goal.** Given `fetchUserId(): CompletableFuture<Long>` and `lookupAddress(Long): CompletableFuture<Address>`, produce `CompletableFuture<Address>`.

**Requirements.** No nested `Future<Future<…>>`; no blocking `get()`.

**Hints.** When the lambda returns a Future, the operator is `thenCompose`, not `thenApply`.

**Solution sketch.**
```java
CompletableFuture<Address> address =
    fetchUserId().thenCompose(id -> lookupAddress(id));
// thenApply here would give CompletableFuture<CompletableFuture<Address>>.
```

---

<a id="task-3"></a>
## Task 3 — Parallel fan-out / fan-in

**Goal.** Fetch `profile`, `orders`, `balance` in parallel and assemble a `Dashboard`.

**Requirements.** True parallelism (overlapping calls), explicit executor, no mid-chain blocking.

**Hints.** Start all three Futures first, then `allOf`, then `join` each *after* `allOf`.

**Solution sketch.**
```java
var profile = supplyAsync(() -> profileApi.get(id), io);
var orders  = supplyAsync(() -> orderApi.recent(id), io);
var balance = supplyAsync(() -> walletApi.balance(id), io);

return CompletableFuture.allOf(profile, orders, balance)
    .thenApply(v -> new Dashboard(profile.join(), orders.join(), balance.join()));
```

---

<a id="task-4"></a>
## Task 4 — firstSuccessful

**Goal.** Return the first Future to **succeed**, ignoring earlier failures. If all fail, fail with the last error.

**Requirements.** Don't use raw `anyOf` (it returns the first to *settle*, even a failure).

**Hints.** Create a result promise; have each future, on success, `complete` it; track failures with a countdown.

**Solution sketch.**
```java
<T> CompletableFuture<T> firstSuccessful(List<CompletableFuture<T>> fs) {
    CompletableFuture<T> result = new CompletableFuture<>();
    AtomicInteger remaining = new AtomicInteger(fs.size());
    for (var f : fs) {
        f.whenComplete((v, ex) -> {
            if (ex == null) result.complete(v);                 // first success wins
            else if (remaining.decrementAndGet() == 0)
                result.completeExceptionally(ex);               // all failed
        });
    }
    return result;
}
```

---

<a id="task-5"></a>
## Task 5 — Custom timeout

**Goal.** Implement `timeout(future, duration)` without `orTimeout`.

**Requirements.** Complete exceptionally with `TimeoutException` if the source is too slow; otherwise relay the source.

**Hints.** Schedule a timer on a `ScheduledExecutorService` that calls `completeExceptionally`; race it against the source.

**Solution sketch.**
```java
<T> CompletableFuture<T> timeout(CompletableFuture<T> src, Duration d, ScheduledExecutorService sched) {
    CompletableFuture<T> out = new CompletableFuture<>();
    src.whenComplete((v, ex) -> { if (ex == null) out.complete(v); else out.completeExceptionally(ex); });
    ScheduledFuture<?> t = sched.schedule(
        () -> out.completeExceptionally(new TimeoutException()), d.toMillis(), TimeUnit.MILLISECONDS);
    out.whenComplete((v, ex) -> t.cancel(false));   // stop the timer once settled
    return out;
}
```

---

<a id="task-6"></a>
## Task 6 — Retry with exponential backoff

**Goal.** Retry an async operation up to N times with doubling delay.

**Requirements.** No blocking sleeps; delays scheduled asynchronously.

**Hints.** Use `exceptionallyCompose` and recursion; `delayed(d)` returns a Future that completes after `d`.

**Solution sketch.**
```java
<T> CompletableFuture<T> withRetry(Supplier<CompletableFuture<T>> op, int attempts, Duration delay) {
    return op.get().exceptionallyCompose(ex ->
        attempts <= 1
            ? CompletableFuture.failedFuture(ex)
            : delayed(delay).thenCompose(v -> withRetry(op, attempts - 1, delay.multipliedBy(2))));
}
```

---

<a id="task-7"></a>
## Task 7 — Bounded-concurrency fan-out

**Goal.** Process 10,000 IDs with at most 32 calls in flight at once.

**Requirements.** Return all results; release the permit on both success and failure.

**Hints.** A `Semaphore(32)`; acquire before each call, release in `whenComplete`.

**Solution sketch.**
```java
Semaphore gate = new Semaphore(32);
List<CompletableFuture<Result>> fs = ids.stream()
    .map(id -> CompletableFuture.runAsync(gate::acquireUninterruptibly, io)
        .thenComposeAsync(v -> fetch(id), io)
        .whenComplete((r, ex) -> gate.release()))
    .toList();
return CompletableFuture.allOf(fs.toArray(CompletableFuture[]::new))
    .thenApply(v -> fs.stream().map(CompletableFuture::join).toList());
```

---

<a id="task-8"></a>
## Task 8 — Partial-results aggregation

**Goal.** Aggregate N calls but **don't** short-circuit on the first failure; return every outcome.

**Requirements.** Each result tagged success/failure.

**Hints.** `handle` converts a failing future into a successful one carrying an `Outcome`.

**Solution sketch.**
```java
var wrapped = fs.stream()
    .map(f -> f.handle((r, ex) -> ex == null ? Outcome.ok(r) : Outcome.fail(ex)))
    .toList();
return CompletableFuture.allOf(wrapped.toArray(CompletableFuture[]::new))
    .thenApply(v -> wrapped.stream().map(CompletableFuture::join).toList());
```

---

<a id="task-9"></a>
## Task 9 — Scala Promise split

**Goal.** Show the read/write separation explicitly: a producer fulfills, a consumer observes.

**Requirements.** Use `Promise` for the write side and `.future` for the read side.

**Hints.** `p.success(v)` / `p.failure(ex)`; `f.onComplete { case Success/Failure }`.

**Solution sketch.**
```scala
val p = Promise[Int]()
val f = p.future                  // read side
f.onComplete {
  case Success(v) => println(s"ok $v")
  case Failure(e) => println(s"err ${e.getMessage}")
}
Future { compute() }.onComplete {  // producer
  case Success(v) => p.success(v)
  case Failure(e) => p.failure(e)
}
```

---

<a id="task-10"></a>
## Task 10 — Cache-then-network race

**Goal.** Return whichever of a cache lookup or a network fetch resolves first; fall back to the other on failure.

**Requirements.** Prefer the fastest *successful* result.

**Hints.** Combine `firstSuccessful` (Task 4) over `[cacheF, networkF]`.

**Solution sketch.**
```java
CompletableFuture<Quote> cacheF   = supplyAsync(() -> cache.get(sym), io);
CompletableFuture<Quote> networkF = supplyAsync(() -> api.quote(sym), io);
return firstSuccessful(List.of(cacheF, networkF));   // first to SUCCEED
```
*(In JavaScript: `Promise.any([cacheP, networkP])` is the built-in equivalent — first to fulfill, ignoring rejections.)*

---

## How to Practice

1. **Do each task twice:** once with `CompletableFuture`, once with JS `Promise`/`async-await`. Notice where the read/write split is hidden (Java) vs explicit (Scala).
2. **Run every solution with a same-thread executor first** (`Runnable::run`) to make behavior deterministic, then with a real pool to observe parallelism.
3. **Inject failures** into Tasks 3, 7, 8: throw inside one branch and watch fail-fast (`allOf`) vs partial-results behavior.
4. **Profile Task 7** with the semaphore at 1, 32, and unbounded — watch latency and memory change.
5. **Verify cancellation reality:** in Task 6, cancel the outer Future mid-retry and confirm the in-flight attempt still completes (cancellation is advisory).
6. **Rewrite Task 3 with `StructuredTaskScope`** (Java 21+) and compare readability and stack traces against the `allOf` version.
