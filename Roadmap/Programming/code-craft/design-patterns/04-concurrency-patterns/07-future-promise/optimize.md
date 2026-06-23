# Future / Promise — Optimize

> Ten optimization walkthroughs for Future/Promise code. Each shows *before*, the *problem*, the *after*, *why* it's faster/safer, and the *trade-off*. Concepts come from [senior.md](senior.md)/[professional.md](professional.md).

---

## Table of Contents

1. [Serial awaits → parallel fan-out](#opt-1)
2. [Blocking get() → composition](#opt-2)
3. [Common pool → bulkheaded executors](#opt-3)
4. [Excessive async hops → collapse sync stages](#opt-4)
5. [Unbounded fan-out → bounded concurrency](#opt-5)
6. [Fail-fast → partial results](#opt-6)
7. [No timeout → bounded latency](#opt-7)
8. [Per-item futures in a hot loop → batching](#opt-8)
9. [Redundant duplicate calls → dedupe/memoize](#opt-9)
10. [Blocking pipeline → virtual threads](#opt-10)
11. [Optimization Tips](#optimization-tips)

---

<a id="opt-1"></a>
## 1. Serial awaits → parallel fan-out

**Before**
```java
var a = supplyAsync(() -> callA(), io).join();
var b = supplyAsync(() -> callB(), io).join();   // starts only after A
```
**Problem.** Latency = A + B; the two independent calls don't overlap.
**After**
```java
var fa = supplyAsync(() -> callA(), io);
var fb = supplyAsync(() -> callB(), io);
return combine(fa.join(), fb.join());            // latency = max(A, B)
```
**Why.** Both requests are in flight at once; you pay only the slower one.
**Trade-off.** Higher peak concurrency on downstreams — ensure pools/rate limits allow it.

---

<a id="opt-2"></a>
## 2. Blocking get() → composition

**Before**
```java
int v = supplyAsync(this::load, io).get();
return transform(v);
```
**Problem.** The calling thread blocks idle until `load` finishes; under request load this ties up request threads.
**After**
```java
return supplyAsync(this::load, io).thenApply(this::transform);
```
**Why.** No thread blocks; the transform runs on completion. The request thread is freed (returns a Future up the stack).
**Trade-off.** The whole call stack must become Future-returning; half-migrations leave a blocking boundary somewhere.

---

<a id="opt-3"></a>
## 3. Common pool → bulkheaded executors

**Before**
```java
supplyAsync(() -> blockingHttp(url))          // commonPool
    .thenApplyAsync(this::parse);             // commonPool
```
**Problem.** Blocking IO on the CPU-sized shared common pool starves parallel streams and other libraries; CPU and IO contend for the same threads.
**After**
```java
supplyAsync(() -> blockingHttp(url), ioPool)   // IO isolated
    .thenApplyAsync(this::parse, cpuPool);     // CPU isolated
```
**Why.** Bulkheading prevents a slow downstream from consuming threads the fast path needs; each workload is sized for its nature.
**Trade-off.** More pools to size, name, and monitor; mis-sizing one shifts the bottleneck.

---

<a id="opt-4"></a>
## 4. Excessive async hops → collapse sync stages

**Before**
```java
f.thenApplyAsync(this::trim, ex)
 .thenApplyAsync(String::toLowerCase, ex)
 .thenApplyAsync(this::normalize, ex);   // 3 executor hops for pure transforms
```
**Problem.** Each `*Async` is an executor submit + cross-core wakeup (~µs each); for trivial pure functions the dispatch cost dwarfs the work.
**After**
```java
f.thenApply(s -> normalize(s.trim().toLowerCase()));   // one inline stage
```
**Why.** Pure CPU-trivial transforms should run inline; collapsing removes scheduling overhead and cache-cold resumes.
**Trade-off.** Inline stages run on the completing thread — only safe when the work is fast and non-blocking.

---

<a id="opt-5"></a>
## 5. Unbounded fan-out → bounded concurrency

**Before**
```java
var fs = millionIds.stream().map(id -> supplyAsync(() -> fetch(id), io)).toList();
```
**Problem.** A million queued tasks at once: memory blowup and downstream overload (no rate control).
**After**
```java
Semaphore gate = new Semaphore(64);
var fs = millionIds.stream()
    .map(id -> runAsync(gate::acquireUninterruptibly, io)
        .thenComposeAsync(v -> fetch(id), io)
        .whenComplete((r, ex) -> gate.release()))
    .toList();
```
**Why.** At most 64 in flight bounds memory and respects downstream capacity.
**Trade-off.** Lower peak throughput; the cap becomes a tuning knob you must size to the downstream.

---

<a id="opt-6"></a>
## 6. Fail-fast → partial results

**Before**
```java
CompletableFuture.allOf(a, b, c).thenApply(v -> List.of(a.join(), b.join(), c.join()));
```
**Problem.** If `b` fails, the whole aggregate rejects — you lose the perfectly good `a` and `c` results.
**After**
```java
var wrapped = Stream.of(a, b, c)
    .map(f -> f.handle((r, ex) -> ex == null ? Outcome.ok(r) : Outcome.fail(ex)))
    .toList();
CompletableFuture.allOf(wrapped.toArray(CompletableFuture[]::new))
    .thenApply(v -> wrapped.stream().map(CompletableFuture::join).toList());
```
**Why.** `handle` turns each failure into a successful `Outcome`, so `allOf` never short-circuits; you return everything available.
**Trade-off.** Callers must now branch per-item on success/failure instead of one all-or-nothing path.

---

<a id="opt-7"></a>
## 7. No timeout → bounded latency

**Before**
```java
return supplyAsync(() -> slowDependency(), io).thenApply(this::use);
```
**Problem.** A stuck dependency hangs the request indefinitely, holding resources and breaking SLA.
**After**
```java
return supplyAsync(() -> slowDependency(), io)
    .orTimeout(300, TimeUnit.MILLISECONDS)            // reject if too slow
    .exceptionally(ex -> cachedFallback());           // graceful degradation
```
**Why.** Bounds tail latency and converts a hang into a fast, degraded answer.
**Trade-off.** `orTimeout` rejects the Future but doesn't stop the underlying work (it runs on, wasting a thread); pair with cooperative cancellation if that matters.

---

<a id="opt-8"></a>
## 8. Per-item futures in a hot loop → batching

**Before**
```java
ids.forEach(id -> supplyAsync(() -> db.lookup(id), io));   // N round-trips, N futures
```
**Problem.** N network round-trips and N future allocations; the per-future overhead and per-call latency dominate.
**After**
```java
CompletableFuture<Map<Id, Row>> batch = supplyAsync(() -> db.lookupBatch(ids), io);
```
**Why.** One round-trip, one future; amortizes both network latency and allocation across the batch.
**Trade-off.** Larger batches add latency for the first item and need backend batch support; choose a batch size that balances latency vs throughput.

---

<a id="opt-9"></a>
## 9. Redundant duplicate calls → dedupe/memoize

**Before**
```java
CompletableFuture<Price> price(String sym) {
    return supplyAsync(() -> api.quote(sym), io);   // 100 callers → 100 identical calls
}
```
**Problem.** Concurrent callers for the same key each launch a duplicate expensive call (a "cache stampede").
**After**
```java
ConcurrentHashMap<String, CompletableFuture<Price>> inflight = new ConcurrentHashMap<>();
CompletableFuture<Price> price(String sym) {
    return inflight.computeIfAbsent(sym, s ->
        supplyAsync(() -> api.quote(s), io)
            .whenComplete((r, ex) -> inflight.remove(s)));   // single-flight
}
```
**Why.** Concurrent callers for the same key **share one in-flight Future** (single-flight), collapsing N calls into one.
**Trade-off.** A failure is shared by all waiters; and you must evict on completion to avoid serving stale results forever.

---

<a id="opt-10"></a>
## 10. Blocking pipeline → virtual threads

**Before**
```java
// Deeply nested CompletableFuture chain just to avoid blocking platform threads.
fetchF(id).thenCompose(this::enrichF).thenCompose(this::persistF).thenApply(...);
```
**Problem.** Callback-shaped control flow, lost stack traces, and executor-confinement complexity — all to dodge cheap-to-write blocking.
**After (Java 21+)**
```java
try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
    var raw = scope.fork(() -> persist(enrich(fetch(id))));  // plain blocking, virtual thread
    scope.join().throwIfFailed();
    return raw.get();
}
```
**Why.** Virtual threads make blocking cheap, so the pipeline becomes linear, debuggable code with real stack traces and proper cancellation.
**Trade-off.** Requires Java 21+; `CompletableFuture` is still needed at interop boundaries (libraries, async servlet APIs), so both styles coexist.

---

## Optimization Tips

- **Profile before optimizing.** Measure where p99 latency actually lives — usually pool queueing, not your functions. A JMH/async-profiler flame graph beats intuition.
- **The executor hop is the unit of cost.** Count `*Async` boundaries; each is ~µs. Collapse cheap pure stages (Opt 4), keep hops only at CPU↔IO confinement changes.
- **Parallelize independent work, sequence only true dependencies** (Opt 1) — and never block one future before starting the next.
- **Always bound concurrency and time** (Opts 5, 7); unbounded fan-out and missing timeouts are the top two production failure modes.
- **Single-flight + batching** (Opts 8, 9) attack call *count*, which often dwarfs per-call tuning.
- **When blocking is cheap (Loom), simpler often wins** (Opt 10): don't carry `CompletableFuture` complexity where a virtual-threaded `StructuredTaskScope` is clearer.
- **Re-measure after each change** — async optimizations frequently move the bottleneck rather than removing it.
