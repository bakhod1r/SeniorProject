# Future / Promise — Find the Bug

> Buggy Future/Promise snippets. For each: read the code, spot the defect, then check the diagnosis. These are the real mistakes that ship to production. See [middle.md](middle.md)/[senior.md](senior.md) for the underlying concepts.

---

## Table of Contents

1. [Bug 1 — Accidental blocking](#bug-1)
2. [Bug 2 — The nesting trap](#bug-2)
3. [Bug 3 — Swallowed exception](#bug-3)
4. [Bug 4 — Sequential instead of parallel](#bug-4)
5. [Bug 5 — Blocking on the common pool](#bug-5)
6. [Bug 6 — Wrong exception unwrap](#bug-6)
7. [Bug 7 — Post-completion mutation](#bug-7)
8. [Bug 8 — Cancellation that does nothing](#bug-8)
9. [Bug 9 — allOf without joining results](#bug-9)
10. [Bug 10 — whenComplete used to recover](#bug-10)
11. [Bug 11 — JS: forgotten return in then](#bug-11)
12. [Bug 12 — Re-completing a Promise](#bug-12)
13. [Practice Tips](#practice-tips)

---

<a id="bug-1"></a>
## Bug 1 — Accidental blocking

```java
List<Report> reports = new ArrayList<>();
for (Long id : ids) {
    reports.add(CompletableFuture.supplyAsync(() -> build(id), io).get());
}
```

**What's wrong.** `.get()` inside the loop blocks for each task before starting the next.
**Root cause.** Starting *and* awaiting on the same line serializes everything; the pool runs one task at a time.
**Fix.** Start all futures, then join.
```java
var fs = ids.stream().map(id -> supplyAsync(() -> build(id), io)).toList();
List<Report> reports = fs.stream().map(CompletableFuture::join).toList();
```

---

<a id="bug-2"></a>
## Bug 2 — The nesting trap

```java
CompletableFuture<CompletableFuture<Address>> r =
    fetchUserId().thenApply(id -> lookupAddress(id));   // lookupAddress returns a Future
```

**What's wrong.** `r` is a `Future<Future<Address>>`; consumers must double-unwrap.
**Root cause.** `thenApply` maps to whatever the lambda returns — here, another Future — instead of flattening.
**Fix.** Use `thenCompose` (the `flatMap` of Futures).
```java
CompletableFuture<Address> r = fetchUserId().thenCompose(id -> lookupAddress(id));
```

---

<a id="bug-3"></a>
## Bug 3 — Swallowed exception

```java
CompletableFuture.supplyAsync(() -> chargeCard(order), io)
    .thenApply(receipt -> persist(receipt));   // fire-and-forget, no error handler
```

**What's wrong.** If `chargeCard` throws, the rejection is never observed — no log, no alert, payment silently lost from the audit trail.
**Root cause.** An unobserved exceptional `CompletableFuture` swallows its error.
**Fix.** Terminate the chain with a handler.
```java
.thenApply(receipt -> persist(receipt))
.whenComplete((ok, ex) -> { if (ex != null) log.error("charge failed", unwrap(ex)); });
```

---

<a id="bug-4"></a>
## Bug 4 — Sequential instead of parallel

```java
Profile p = supplyAsync(() -> profileApi.get(id), io).join();
Balance b = supplyAsync(() -> walletApi.balance(id), io).join();
return new View(p, b);
```

**What's wrong.** The first `join()` blocks until profile finishes *before* balance even starts. Total latency = sum, not max.
**Root cause.** Joining one future before starting the next removes overlap.
**Fix.** Start both, then join.
```java
var pf = supplyAsync(() -> profileApi.get(id), io);
var bf = supplyAsync(() -> walletApi.balance(id), io);
return new View(pf.join(), bf.join());   // overlap; latency = slower of the two
```

---

<a id="bug-5"></a>
## Bug 5 — Blocking on the common pool

```java
CompletableFuture.supplyAsync(() -> httpClient.get(url))   // no executor → commonPool
    .thenApply(this::parse);
```

**What's wrong.** Blocking HTTP runs on `ForkJoinPool.commonPool()`, which is CPU-sized and shared JVM-wide. Under load it starves parallel streams and other libraries.
**Root cause.** Default `*Async` uses the common pool; blocking work doesn't belong there.
**Fix.** Pass an explicit, IO-sized executor.
```java
CompletableFuture.supplyAsync(() -> httpClient.get(url), ioPool).thenApplyAsync(this::parse, cpuPool);
```

---

<a id="bug-6"></a>
## Bug 6 — Wrong exception unwrap

```java
future.exceptionally(ex -> {
    if (ex instanceof IOException) return fallback;   // never true
    throw new RuntimeException(ex);
});
```

**What's wrong.** `ex` is a `CompletionException` wrapping the real `IOException`; the `instanceof` check fails and the IO error is wrongly re-thrown.
**Root cause.** Stage failures are wrapped; you must unwrap `getCause()`.
**Fix.**
```java
.exceptionally(ex -> {
    Throwable cause = (ex instanceof CompletionException) ? ex.getCause() : ex;
    if (cause instanceof IOException) return fallback;
    throw new CompletionException(cause);
});
```

---

<a id="bug-7"></a>
## Bug 7 — Post-completion mutation

```java
List<Row> rows = new ArrayList<>();
CompletableFuture<List<Row>> f = supplyAsync(() -> rows, io);
loadInBackground(rows);   // keeps adding to `rows` AFTER the future completed
```

**What's wrong.** The supplier returns `rows` immediately and completes the Future, but another thread keeps mutating `rows`. Consumers read it concurrently — a data race outside any happens-before edge.
**Root cause.** The producer mutates the published result *after* completion; the JMM visibility guarantee only covers writes that happen-before completion.
**Fix.** Fill the list *before* completing, then publish an immutable copy.
```java
CompletableFuture<List<Row>> f = supplyAsync(() -> {
    List<Row> rows = new ArrayList<>();
    load(rows);
    return List.copyOf(rows);   // complete with a finished, immutable value
}, io);
```

---

<a id="bug-8"></a>
## Bug 8 — Cancellation that does nothing

```java
CompletableFuture<String> f = supplyAsync(this::longRunning, io);
f.cancel(true);
// expecting longRunning() to stop — it doesn't
```

**What's wrong.** `cancel(true)` marks `f` cancelled but does **not** interrupt the running `supplyAsync` task; `longRunning` runs to completion, wasting the thread.
**Root cause.** `CompletableFuture` cancellation is advisory; `mayInterruptIfRunning` is effectively ignored.
**Fix.** Make the task cooperative, or use the raw `ExecutorService.submit` Future whose `cancel(true)` interrupts.
```java
Future<String> raw = io.submit(this::longRunning);  // checks Thread.interrupted()
raw.cancel(true);                                    // actually interrupts
```

---

<a id="bug-9"></a>
## Bug 9 — allOf without joining results

```java
var a = supplyAsync(() -> fetchA(), io);
var b = supplyAsync(() -> fetchB(), io);
CompletableFuture.allOf(a, b)
    .thenApply(combined -> combined.toString());   // `combined` is Void!
```

**What's wrong.** `allOf` returns `CompletableFuture<Void>`; the lambda's parameter is `null`. The actual results live in `a` and `b`.
**Root cause.** Misreading what `allOf` produces — it signals completion, not the values.
**Fix.** Join the originals after `allOf`.
```java
CompletableFuture.allOf(a, b).thenApply(v -> a.join() + " / " + b.join());
```

---

<a id="bug-10"></a>
## Bug 10 — whenComplete used to recover

```java
CompletableFuture<Integer> r = compute()
    .whenComplete((v, ex) -> { if (ex != null) log.warn("failed"); });
// caller treats r as recovered, but...
int value = r.join();   // still throws!
```

**What's wrong.** `whenComplete` observes but does **not** transform; the original exception still propagates, so `join()` throws.
**Root cause.** Confusing `whenComplete` (peek) with `handle`/`exceptionally` (recover).
**Fix.** Use `exceptionally`/`handle` to actually substitute a value.
```java
CompletableFuture<Integer> r = compute().exceptionally(ex -> { log.warn("failed"); return 0; });
```

---

<a id="bug-11"></a>
## Bug 11 — JS: forgotten return in then

```javascript
fetchUser(id)
  .then(user => {
    fetchOrders(user.id);          // missing `return`
  })
  .then(orders => render(orders)); // orders is undefined
```

**What's wrong.** The first `.then` doesn't `return` the inner promise, so the chain doesn't wait for `fetchOrders`; the next `.then` receives `undefined`.
**Root cause.** A `.then` callback that calls an async op without returning it breaks the chain — the JS analogue of the `thenCompose` flattening rule.
**Fix.**
```javascript
fetchUser(id)
  .then(user => fetchOrders(user.id))   // return the promise (implicit arrow return)
  .then(orders => render(orders));
```

---

<a id="bug-12"></a>
## Bug 12 — Re-completing a Promise

```java
CompletableFuture<Config> cfg = new CompletableFuture<>();
loadPrimary(c -> cfg.complete(c));
loadFallback(c -> cfg.complete(c));   // assumed to "override" if primary failed
```

**What's wrong.** Whichever callback fires first wins; the second `complete` is a silent no-op. If the fallback was meant to override a *failed* primary, this logic never works — and if primary succeeded, a late fallback is silently dropped (which may be fine, but it's accidental, not designed).
**Root cause.** A Promise is write-once; re-completion is ignored, not an error — so bugs hide.
**Fix.** Make the intent explicit: complete from primary; on primary *failure*, complete from fallback.
```java
loadPrimaryF()
    .exceptionallyCompose(ex -> loadFallbackF())
    .whenComplete((c, ex) -> { if (ex == null) cfg.complete(c); else cfg.completeExceptionally(ex); });
```

---

## Practice Tips

- **For every chain, ask "where does the exception go?"** If you can't point to the `exceptionally`/`handle`/`whenComplete` that observes it, you have Bug 3.
- **Grep for `.get()` and `.join()`** in async code paths; each one is a blocking/starvation suspect (Bugs 1, 4, 5).
- **Whenever a lambda returns a Future, the operator must be `thenCompose`** (Java) or `return` the promise (JS) — Bugs 2 and 11 are the same mistake in two languages.
- **Treat `allOf`'s result as `Void`** and always join the originals (Bug 9).
- **Memorize the recover trio:** `whenComplete` peeks, `handle` transforms both, `exceptionally` substitutes on failure (Bug 10).
- **Reproduce starvation deliberately:** size a pool to 2, submit tasks that `get()` on each other, watch it deadlock — then you'll never write Bug 5 again.
