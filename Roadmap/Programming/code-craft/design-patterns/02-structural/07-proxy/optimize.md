# Proxy — Optimize

> **Source:** [refactoring.guru/design-patterns/proxy](https://refactoring.guru/design-patterns/proxy)

Each section presents a Proxy that *works* but is wasteful. Profile, optimize, measure.

---

## Table of Contents

1. [Optimization 1: Single-flight to prevent stampede](#optimization-1-single-flight-to-prevent-stampede)
2. [Optimization 2: Refresh-ahead caching](#optimization-2-refresh-ahead-caching)
3. [Optimization 3: Reuse HTTP connections](#optimization-3-reuse-http-connections)
4. [Optimization 4: Replace dynamic proxy with static where hot](#optimization-4-replace-dynamic-proxy-with-static-where-hot)
5. [Optimization 5: Batched fetching (DataLoader)](#optimization-5-batched-fetching-dataloader)
6. [Optimization 6: Cache locally (L1) before remote (L2)](#optimization-6-cache-locally-l1-before-remote-l2)
7. [Optimization 7: Asynchronous lazy init](#optimization-7-asynchronous-lazy-init)
8. [Optimization 8: AspectJ instead of Spring AOP](#optimization-8-aspectj-instead-of-spring-aop)
9. [Optimization 9: Drop unused proxies](#optimization-9-drop-unused-proxies)
10. [Optimization 10: Use service-mesh smart features](#optimization-10-use-service-mesh-smart-features)
11. [Optimization Tips](#optimization-tips)

---

## Optimization 1: Single-flight to prevent stampede

### Before

```go
func (c *CachingProxy) Get(key string) (Result, error) {
    if v, ok := c.cache.Load(key); ok { return v.(Result), nil }
    v, err := c.inner.Get(key)
    if err == nil { c.cache.Store(key, v) }
    return v, err
}
```

100 concurrent threads miss the cache; 100 backend calls happen.

### After

```go
import "golang.org/x/sync/singleflight"

type SFCache struct {
    inner Service
    cache sync.Map
    sf    singleflight.Group
}

func (c *SFCache) Get(key string) (Result, error) {
    if v, ok := c.cache.Load(key); ok { return v.(Result), nil }
    val, err, _ := c.sf.Do(key, func() (any, error) {
        v, err := c.inner.Get(key)
        if err == nil { c.cache.Store(key, v) }
        return v, err
    })
    if err != nil { return Result{}, err }
    return val.(Result), nil
}
```

**Measurement.** Backend load drops dramatically on cache flush. Single backend call per missed key, regardless of concurrent waiters.

**Lesson:** Cache stampede is a real production hazard. Single-flight is the standard mitigation.

---

## Optimization 2: Refresh-ahead caching

### Before

TTL-based cache: every entry expires; the next request triggers a backend call. Every TTL boundary = latency spike.

### After (Caffeine)

```java
import com.github.benmanes.caffeine.cache.Caffeine;

public final class RefreshAheadProxy {
    private final Cache<String, User> cache = Caffeine.newBuilder()
        .refreshAfterWrite(Duration.ofMinutes(1))     // background refresh
        .expireAfterWrite(Duration.ofMinutes(10))     // hard TTL
        .build();

    private final Function<String, User> loader;

    public User get(String id) {
        return cache.get(id, loader);
    }
}
```

Caffeine refreshes entries in the background near expiration; reads always serve from a warm cache.

**Measurement.** P99 latency stays low; TTL boundary spikes vanish.

**Lesson:** Refresh-ahead trades CPU for latency. Worth it for low-latency-critical paths.

---

## Optimization 3: Reuse HTTP connections

### Before

```python
class RemoteProxy:
    def get(self, url):
        return requests.get(url)   # new connection each time
```

Each call re-handshakes TLS, reopens TCP. Under load, latency dominated by handshakes.

### After

```python
class RemoteProxy:
    def __init__(self):
        self._session = requests.Session()

    def get(self, url):
        return self._session.get(url)   # connection pool reuse
```

**Measurement.** RTT drops; CPU drops; latency p99 improves significantly.

**Lesson:** Remote proxies should reuse connections. `requests.Session`, `http.Client`, `OkHttp` clients should be per-application, not per-request.

---

## Optimization 4: Replace dynamic proxy with static where hot

### Before

Spring AOP `@Cacheable` adds ~50-100 ns per call via dynamic proxy. A hot path calls the proxied method 1M times/sec → ~100 ms/sec proxy overhead.

### After

Hand-write a static caching proxy:

```java
public final class CachingProductService implements ProductService {
    private final ProductService inner;
    private final Cache<String, Product> cache;

    public Product findById(String id) {
        return cache.get(id, k -> inner.findById(k));
    }
}
```

Wire via DI explicitly. JVM inlines the entire chain after warmup.

**Measurement.** Per-call overhead drops to near-zero. Hot-path throughput improves measurably.

**Lesson:** Dynamic proxies are convenient but have real cost in inner loops. Static proxies inline.

---

## Optimization 5: Batched fetching (DataLoader)

### Before

```python
def load_user_orders(users):
    for u in users:
        u.orders = order_proxy.get_for(u.id)   # N+1 queries
```

100 users → 100 queries. Each query has ~5ms latency = 500ms total.

### After (DataLoader pattern)

```python
class BulkOrderProxy:
    def __init__(self, inner):
        self._inner = inner
        self._pending: dict = {}

    async def get_for(self, user_id):
        if user_id in self._pending: return await self._pending[user_id]
        fut = asyncio.get_event_loop().create_future()
        self._pending[user_id] = fut
        asyncio.get_event_loop().call_soon(self._flush)
        return await fut

    async def _flush(self):
        ids = list(self._pending.keys())
        futs = list(self._pending.values())
        self._pending.clear()
        results = await self._inner.get_many(ids)
        for f, r in zip(futs, results): f.set_result(r)
```

**Measurement.** 100 queries → 1 query. 500ms → ~5ms.

**Lesson:** Batching at the proxy layer fixes N+1 patterns. Used by GraphQL DataLoader, ORMs.

---

## Optimization 6: Cache locally (L1) before remote (L2)

### Before

Every cache lookup goes to Redis: ~1ms RTT.

### After

```java
public final class TwoTierCache {
    private final Cache<String, User> l1 = Caffeine.newBuilder()
        .maximumSize(10_000)
        .expireAfterWrite(Duration.ofSeconds(30))
        .build();
    private final RedisCache l2;

    public User get(String id) {
        var u = l1.getIfPresent(id);
        if (u != null) return u;
        u = l2.get(id);
        if (u != null) l1.put(id, u);
        return u;
    }
}
```

L1 hits: ~50 ns. L2 hits: ~1 ms. Both faster than the original DB.

**Measurement.** P50 latency drops dramatically; Redis QPS drops; cost goes down.

**Lesson:** Multi-tier caching reduces remote calls. The L1 cache is essentially a local proxy in front of the remote cache.

---

## Optimization 7: Asynchronous lazy init

### Before

```java
public Service real() {
    if (real == null) {
        synchronized (lock) {
            if (real == null) real = expensiveBuild();   // 5 second build
        }
    }
    return real;
}
```

The first caller waits 5 seconds; subsequent callers return immediately. The latency spike on first request is bad UX.

### After

```java
public final class AsyncLazyProxy implements Service {
    private final CompletableFuture<Service> realFuture;

    public AsyncLazyProxy(Supplier<Service> supplier, Executor executor) {
        this.realFuture = CompletableFuture.supplyAsync(supplier, executor);
    }

    public Result call(Request req) {
        return realFuture.join().call(req);
    }
}
```

Construction kicks off in the background at startup. First request only waits if construction isn't done.

**Measurement.** First-request latency drops from 5 seconds to nearly normal (the build completed in background).

**Lesson:** "Lazy" doesn't have to mean "wait for first user." Background warmup gets the cost out of the request path.

---

## Optimization 8: AspectJ instead of Spring AOP

### Before

Spring AOP `@Cacheable` adds ~50-100 ns per call. In a hot loop with 10M calls per second, ~1 second is lost to proxy overhead.

### After

Switch to AspectJ load-time weaving (`-javaagent:aspectjweaver.jar`). The aspect's logic is woven into the bytecode at class-load time. Per-call overhead drops to near-zero.

**Measurement.** ~50-100 ns per call → ~1-5 ns. For high-throughput services, real wall time saved.

**Trade.** Build/runtime complexity, agent dependency, harder debugging. Worth it for hot paths only.

**Lesson:** AspectJ removes dynamic-proxy overhead. Use when measured hot paths suffer.

---

## Optimization 9: Drop unused proxies

### Before

A code review reveals 8 proxy layers. Investigation: only 2 actually contribute. The others are dead weight.

### After

Audit each layer. Keep what's load-bearing:
- Caching proxy: 95% hit rate → keep.
- Logging proxy: prints to file nobody reads → drop.
- Metrics proxy: emits to Prometheus → keep.
- Audit proxy: ran once for compliance, no longer required → drop.
- Retry proxy: 99% calls succeed first try → keep but reduce attempts.
- Tracing proxy: enabled in dev only → drop in prod.

**Measurement.** Per-call overhead drops. Stack traces shrink. Mental model simplifies.

**Lesson:** Periodic proxy audits keep stacks lean. Dead proxies are pure overhead.

---

## Optimization 10: Use service-mesh smart features

### Before

Each microservice implements its own retry, circuit breaker, mTLS, tracing. Code duplicated; configurations diverge; outages from misconfiguration.

### After

Adopt Envoy / Istio. Each pod has a sidecar proxy. Mesh handles:
- Retries with exponential backoff.
- Circuit breaking per backend.
- mTLS between services.
- Distributed tracing (span injection).
- Load balancing (round-robin, weighted, locality-aware).

Application code simplifies dramatically.

**Measurement.** Service code shrinks; resilience improves; outage MTTR drops (mesh exposes consistent metrics).

**Trade.** Operational complexity (managing the mesh); per-hop latency added (~1-5 ms).

**Lesson:** When you have a mesh, use it. Don't reimplement what the proxy already does.

---

## Optimization Tips

1. **Profile first.** Most proxies are not the bottleneck.
2. **Single-flight for caches.** Prevents stampede; cheap to add.
3. **Refresh-ahead** for low-latency-critical caches.
4. **Reuse connections.** HTTP, gRPC, DB — pool everywhere.
5. **Static over dynamic** in hot paths. JIT inlines static; dynamic costs reflection.
6. **Batch in remote proxies.** DataLoader pattern fixes N+1.
7. **Multi-tier caching.** L1 (local) → L2 (remote) → backend.
8. **Background lazy init** to avoid first-request latency spikes.
9. **AspectJ over Spring AOP** when measured hot paths suffer.
10. **Drop unused proxies.** Periodic audits.
11. **Use mesh features** when available; don't reinvent.
12. **Optimize for change too.** A clean 3-layer proxy chain beats a tweaked 12-layer one.

---

← Back to Proxy folder · [↑ Structural Patterns](../README.md) · [↑↑ Roadmap Home](../../../README.md)

**You've completed the Proxy pattern suite.**

**Structural Patterns are complete (7/7).** Continue to: [Behavioral Patterns](../../03-behavioral/README.md) →
