# Chain of Responsibility — Optimize

> **Source:** [refactoring.guru/design-patterns/chain-of-responsibility](https://refactoring.guru/design-patterns/chain-of-responsibility)

Each section presents a CoR that *works* but is wasteful. Profile, optimize, measure.

---

## Table of Contents

1. [Optimization 1: Inline static chain for JIT](#optimization-1-inline-static-chain-for-jit)
2. [Optimization 2: Iterative runner — avoid stack frames](#optimization-2-iterative-runner-avoid-stack-frames)
3. [Optimization 3: Batch processing in chain](#optimization-3-batch-processing-in-chain)
4. [Optimization 4: Cache expensive handler results](#optimization-4-cache-expensive-handler-results)
5. [Optimization 5: Skip handlers that don't apply](#optimization-5-skip-handlers-that-dont-apply)
6. [Optimization 6: Combine compatible handlers](#optimization-6-combine-compatible-handlers)
7. [Optimization 7: Compile chain to single method](#optimization-7-compile-chain-to-single-method)
8. [Optimization 8: Replace CompletableFuture with virtual threads](#optimization-8-replace-completablefuture-with-virtual-threads)
9. [Optimization 9: Use LongAdder for hot counters](#optimization-9-use-longadder-for-hot-counters)
10. [Optimization 10: Sort handlers by short-circuit probability](#optimization-10-sort-handlers-by-short-circuit-probability)
11. [Optimization Tips](#optimization-tips)

---

## Optimization 1: Inline static chain for JIT

### Before

```java
public class ChainBuilder {
    public Handler build(Request r) {
        Handler h = new AuthHandler();
        h.setNext(new LogHandler()).setNext(new BusinessHandler());
        return h;
    }
}

// Per request:
Handler chain = builder.build(req);
chain.handle(req);
```

Per-request allocation of 3 handlers. JIT sees varying chain shapes; can't inline.

### After

```java
public class StaticChain {
    private static final Handler PIPELINE;
    static {
        PIPELINE = new AuthHandler();
        PIPELINE.setNext(new LogHandler()).setNext(new BusinessHandler());
    }

    public static void process(Request r) {
        PIPELINE.handle(r);
    }
}

StaticChain.process(req);
```

**Measurement.** No per-request allocation. Stable chain shape → JIT inlines `next.handle()` calls into one method body. ~2-3× faster after warmup.

**Lesson:** Chain assembly should happen once at startup, not per request. JIT can fully optimize a static chain.

---

## Optimization 2: Iterative runner — avoid stack frames

### Before

```java
public abstract class Handler {
    protected Handler next;
    public abstract void handle(Request r);   // recursive next.handle(r)
}

// 50-deep chain × 100K req/s = 50 stack frames per req × 100K = 5M frames/s.
// JIT inlining helps but doesn't eliminate frame overhead in megamorphic case.
```

### After

```java
public enum HandleResult { CONTINUE, SHORT_CIRCUIT }

public abstract class IterHandler {
    public abstract HandleResult handle(Request r);
}

public class ChainRunner {
    private final IterHandler[] handlers;

    public ChainRunner(List<IterHandler> handlers) {
        this.handlers = handlers.toArray(new IterHandler[0]);
    }

    public void run(Request r) {
        for (IterHandler h : handlers) {
            if (h.handle(r) == HandleResult.SHORT_CIRCUIT) return;
        }
    }
}
```

**Measurement.** No nested call frames. Tighter loop; cache-friendly array access. ~10-30% faster for long chains.

**Trade-off.** Loses onion model — can't easily do post-work after `next`. For pure forward-only CoR: better.

**Lesson:** For deep chains where onion model isn't needed, iterative runner with array beats recursion.

---

## Optimization 3: Batch processing in chain

### Before

```java
for (Request r : requests) {
    chain.handle(r);   // chain runs once per request
}
```

100K requests = 100K chain traversals. Each traversal: 10 virtual calls.

### After

```java
public abstract class BatchHandler {
    protected BatchHandler next;
    public abstract void handle(List<Request> batch);
}

public final class AuthBatchHandler extends BatchHandler {
    public void handle(List<Request> batch) {
        // Vectorize JWT verifications (e.g., batch RSA)
        List<Request> valid = batch.stream()
            .filter(r -> verifyToken(r.token()))
            .toList();
        if (next != null) next.handle(valid);   // pass valid ones forward
    }
}

public final class BusinessBatchHandler extends BatchHandler {
    public void handle(List<Request> batch) {
        // Bulk DB query
        Map<String, User> users = repo.findAllById(batch.stream().map(Request::userId).toList());
        // ... process
    }
}
```

**Measurement.** Per-batch dispatch cost amortized across batch size. For batch size 100: ~100× fewer virtual calls. DB queries batched: 1 query instead of 100.

**Trade-off.** Latency: requests wait until batch fills. Use for high-throughput scenarios where latency tolerated (analytics, log processing). Not for synchronous user requests.

**Lesson:** Batching changes throughput economics. Apache Kafka, Spark, Flink all use batch-style chain processing.

---

## Optimization 4: Cache expensive handler results

### Before

```java
public class JwtAuthHandler extends Handler {
    public void handle(Request r) {
        Claims claims = jwtParser.parse(r.token());   // expensive: RSA verify, parse
        r.setUser(decodeUser(claims));
        if (next != null) next.handle(r);
    }
}

// Same user makes many requests in a session; JWT parsed every time.
```

### After

```java
public class JwtAuthHandler extends Handler {
    private final Cache<String, Claims> cache = Caffeine.newBuilder()
        .maximumSize(10_000)
        .expireAfterWrite(Duration.ofMinutes(5))
        .build();

    public void handle(Request r) {
        Claims claims = cache.get(r.token(), this::parseAndVerify);
        r.setUser(decodeUser(claims));
        if (next != null) next.handle(r);
    }

    private Claims parseAndVerify(String token) {
        return jwtParser.parse(token);   // expensive
    }
}
```

**Measurement.** With 99% cache hit rate: 100× faster for hot tokens. Cache miss: same as before. Memory: bounded by `maximumSize`.

**Trade-off.** TTL must be ≤ token expiry. Cache invalidation on logout. Distributed: per-instance cache; eventual consistency.

**Lesson:** Expensive handlers (DB, crypto, network) → cache. Caffeine is the standard Java cache library. Per-instance cache is fine for most cases.

---

## Optimization 5: Skip handlers that don't apply

### Before

```java
public class TenantValidationHandler extends Handler {
    public void handle(Request r) {
        if (r.tenantId() != null) {
            // expensive validation
            validateTenant(r.tenantId());
        }
        if (next != null) next.handle(r);
    }
}

// Many requests don't have tenantId — handler still runs (no-op).
// 1M requests × 0.1µs check + dispatch = 100ms wasted.
```

### After

```java
public class ConditionalHandler extends Handler {
    private final Predicate<Request> applies;
    private final Handler delegate;

    public ConditionalHandler(Predicate<Request> applies, Handler delegate) {
        this.applies = applies;
        this.delegate = delegate;
    }

    public void handle(Request r) {
        if (applies.test(r)) {
            delegate.handle(r);
        }
        if (next != null) next.handle(r);   // forward regardless
    }
}

Handler chain = new AuthHandler()
    .setNext(new ConditionalHandler(
        r -> r.tenantId() != null,
        new TenantValidationHandler()
    ))
    .setNext(new BusinessHandler());
```

**Measurement.** Per-request: predicate check ~1ns vs handler dispatch + body. For 99% non-applicable requests: 100× faster on this step.

Better: pre-route requests so they bypass the handler entirely:

```java
public class Router {
    public Handler routeFor(Request r) {
        return r.tenantId() != null ? tenantChain : nonTenantChain;
    }
}
```

Compile-time chain selection. Zero runtime cost.

**Lesson:** A handler that's a no-op for most requests is dispatch waste. Use predicates or routing to skip.

---

## Optimization 6: Combine compatible handlers

### Before

```java
new HeaderValidator()      // validates headers
.setNext(new HeaderEnricher())   // adds derived headers
.setNext(new HeaderLogger())     // logs all headers
.setNext(...)
```

3 separate handlers, 3 dispatch calls, 3 iterations over headers.

### After

```java
public class HeaderProcessor extends Handler {
    public void handle(Request r) {
        // Single pass over headers
        Map<String, String> headers = r.headers();
        for (var entry : headers.entrySet()) {
            // validate
            validate(entry.getKey(), entry.getValue());
            // enrich (set derived)
            // log
            log.info("{}: {}", entry.getKey(), entry.getValue());
        }
        // ... derived headers
        if (next != null) next.handle(r);
    }
}
```

**Measurement.** 1 dispatch + 1 pass instead of 3. ~3× faster when iteration cost dominates.

**Trade-off.** Less modular. Harder to reorder. Use only when handlers are tightly coupled and always run together.

**Lesson:** CoR's modularity has a cost. For inner-loop chains, fusing handlers eliminates dispatch and improves cache locality. Profile before fusing — most chains aren't bottlenecks.

---

## Optimization 7: Compile chain to single method

### Before

```java
Handler chain = new AuthHandler();
chain.setNext(new LogHandler()).setNext(new BusinessHandler());

chain.handle(req);   // 3 virtual calls
```

### After (annotation processor or codegen)

```java
public final class GeneratedChain {
    public static void process(Request r) {
        // Inlined Auth
        if (!verify(r.token())) throw new UnauthorizedException();

        // Inlined Log
        long start = System.currentTimeMillis();

        // Inlined Business
        process(r);

        log.info("{} {}ms", r.url(), System.currentTimeMillis() - start);
    }
}
```

**Measurement.** Zero CoR overhead — chain dissolved into linear code. ~5-10× faster than dynamic dispatch chain.

**Trade-off.** Build complexity (annotation processor / codegen). Loss of runtime configurability. Best for very hot paths and stable chain configurations.

**Tools:** Java annotation processors, ANTLR, Dagger (DI), MapStruct (mappers), Roslyn analyzers.

**Lesson:** When chain configuration is fixed at build time, codegen eliminates abstraction. ANTLR generates parsers; same idea for chains.

---

## Optimization 8: Replace CompletableFuture with virtual threads

### Before

```java
public CompletableFuture<Response> handle(Request req) {
    return validate(req)
        .thenCompose(this::auth)
        .thenCompose(this::log)
        .thenCompose(this::business);
}
```

Each `thenCompose` allocates a `CompletableFuture` + `BiCompletion`. For 4-step × 100K req/s: ~20MB/s GC. Plus async scheduling overhead.

### After (Java 21 virtual threads)

```java
public Response handle(Request req) {
    Request validated = validate(req);
    Request authed = auth(validated);
    Request logged = log(authed);
    return business(logged);
}

// Caller:
Thread.startVirtualThread(() -> {
    Response r = handler.handle(req);
    sendResponse(r);
});
```

**Measurement.** No future allocations. No async scheduling. Virtual thread mounts/unmounts on carrier thread when blocked. 1M concurrent virtual threads cheap.

**Trade-off.** Java 21+ only. Some libraries pin to OS threads (synchronized blocks, native code) — virtual threads stuck. Test for pinning.

**Lesson:** Project Loom changes async-vs-sync trade-off. For I/O-bound CoR chains: synchronous code with virtual threads is simpler AND faster. `CompletableFuture` becomes legacy for most use cases.

---

## Optimization 9: Use LongAdder for hot counters

### Before

```java
public class HitCounter extends Handler {
    private final AtomicLong count = new AtomicLong();

    public void handle(Request r) {
        count.incrementAndGet();
        if (next != null) next.handle(r);
    }
}

// 100K req/s on 32-core machine:
// AtomicLong's CAS contention serializes — ~50ns per increment under contention.
```

### After

```java
public class HitCounter extends Handler {
    private final LongAdder count = new LongAdder();

    public void handle(Request r) {
        count.increment();
        if (next != null) next.handle(r);
    }

    public long count() { return count.sum(); }
}
```

**Measurement.** `LongAdder` is sharded — each thread updates its own cell. No contention. ~10× faster under high contention.

**Trade-off.** `sum()` is O(N) cells (N = thread count). Slow for frequent reads. Use when writes >> reads.

For metrics:
- Counter (write-heavy, read at scrape time) → `LongAdder`.
- Real-time dashboard counter (frequent read) → `AtomicLong`.

**Lesson:** For hot atomic counters in chain handlers (rate limit, hit count), `LongAdder` scales better than `AtomicLong`. Java 8+.

---

## Optimization 10: Sort handlers by short-circuit probability

### Before

```java
Handler chain = new HeaderValidator()        // always passes
    .setNext(new BodyParser())                // always succeeds
    .setNext(new ExpensiveCheck())            // takes 50ms; rejects 10%
    .setNext(new AuthCheck())                 // rejects 20%
    .setNext(new BusinessHandler());

// Average: 50ms × 100% requests = 50ms wasted on rejected paths.
```

### After

```java
Handler chain = new AuthCheck()                  // rejects 20% — early
    .setNext(new ExpensiveCheck())               // rejects 10% — second
    .setNext(new HeaderValidator())              // always passes — last
    .setNext(new BodyParser())
    .setNext(new BusinessHandler());

// Rejected requests now exit early — avoid expensive work.
```

**Measurement.** If 30% of requests rejected:
- Before: 100% pay full chain cost up to rejection point.
- After: 30% rejected after AuthCheck (~5ms); save 50ms × 30% = 15ms average.

For 100K req/s: 1.5s CPU saved per second.

**Trade-off.** Reorders may break dependencies (handlers expecting earlier handler's work). Document and test.

**Lesson:** Place handlers most likely to short-circuit first. Place expensive handlers as late as possible. **Fail fast, fail cheap.** Same principle as DB query optimization (filter early, project late).

---

## Optimization Tips

- **Static chain assembly.** Build once at startup; JIT inlines.
- **Iterative runner** for deep chains; avoids stack frames and recursion overhead.
- **Batch processing** when latency permits — vector operations + amortized dispatch.
- **Cache expensive handler results.** JWT, DB lookups, RSA verifications.
- **Skip non-applicable handlers** with predicates or routing.
- **Fuse compatible handlers** when modularity isn't worth the dispatch cost.
- **Codegen** for build-time-fixed chains.
- **Virtual threads** instead of CompletableFuture for I/O-bound chains (Java 21+).
- **LongAdder** for hot counters under contention.
- **Order handlers** by short-circuit probability — fail fast.
- **Profile first.** Chain dispatch is rarely the bottleneck. Cache misses, allocations, lock contention usually dominate.

[← Find Bug](find-bug.md) · [Behavioral patterns home](../README.md)
