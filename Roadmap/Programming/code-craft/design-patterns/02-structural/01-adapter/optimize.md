# Adapter — Optimize

> **Source:** [refactoring.guru/design-patterns/adapter](https://refactoring.guru/design-patterns/adapter)

Each section presents an adapter that *works* but is wasteful. Profile, optimize, measure.

---

## Table of Contents

1. [Optimization 1: Eliminate per-call allocations (Java)](#optimization-1-eliminate-per-call-allocations-java)
2. [Optimization 2: Batched API exposes batched calls](#optimization-2-batched-api-exposes-batched-calls)
3. [Optimization 3: Move cross-cutting concerns out of adapter](#optimization-3-move-cross-cutting-concerns-out-of-adapter)
4. [Optimization 4: Pointer receivers in Go](#optimization-4-pointer-receivers-in-go)
5. [Optimization 5: Cache deterministic translations](#optimization-5-cache-deterministic-translations)
6. [Optimization 6: Avoid boxing on the hot path (Java)](#optimization-6-avoid-boxing-on-the-hot-path-java)
7. [Optimization 7: Reuse buffers in serialization adapters](#optimization-7-reuse-buffers-in-serialization-adapters)
8. [Optimization 8: Stream large responses (Python)](#optimization-8-stream-large-responses-python)
9. [Optimization 9: Coalesce vendor calls (debounce/batch)](#optimization-9-coalesce-vendor-calls-debouncebatch)
10. [Optimization 10: Lazy adapter initialization](#optimization-10-lazy-adapter-initialization)
11. [Optimization Tips](#optimization-tips)

---

## Optimization 1: Eliminate per-call allocations (Java)

### Before

```java
public final class StripeAdapter implements PaymentProcessor {
    private final StripeClient client;

    public StripeAdapter(StripeClient c) { this.client = c; }

    @Override
    public PaymentResult pay(PaymentRequest req) {
        Map<String, Object> params = new HashMap<>();
        params.put("amount", req.amount());
        params.put("currency", req.currency());
        params.put("source", req.token());
        Charge ch = client.charges().create(params);
        return new PaymentResult(ch.getId(), Money.ofMinor(ch.getAmount(), ch.getCurrency()));
    }
}
```

**Cost:** Every call allocates a new `HashMap`. `HashMap` itself is a chunky object (~48 bytes header + a 16-slot table = ~120 bytes start). At 10k calls/sec, that's ~1.2 MB/sec of garbage just for the params map.

### After

If the SDK accepts a builder, use it:

```java
@Override
public PaymentResult pay(PaymentRequest req) {
    Charge ch = client.charges().create(
        ChargeCreateParams.builder()
            .setAmount(req.amount())
            .setCurrency(req.currency())
            .setSource(req.token())
            .build()
    );
    return new PaymentResult(ch.getId(), Money.ofMinor(ch.getAmount(), ch.getCurrency()));
}
```

The vendor builder is allocation-aware and may use object pools internally. If the SDK only accepts `Map`, **size the map exactly**:

```java
Map<String, Object> params = new HashMap<>(8, 1.0f);   // capacity 8, load 1.0
```

**Measurement.** Before: GC time ~5%. After: ~1%. Latency p99 drops by 0.4 ms under 10k QPS.

**Lesson:** Adapters in hot paths should be allocation-conscious. Pre-sized maps, builders, and immutable types beat ad-hoc constructions.

---

## Optimization 2: Batched API exposes batched calls

### Before

```java
public interface UserRepository {
    User findById(String id);
}

// In a controller:
List<User> users = ids.stream()
    .map(repo::findById)   // N round trips!
    .toList();
```

The adapter exposes only single-record fetch, but the underlying SDK supports `findAll(ids)` in one call. Calling N times → N network round trips.

### After

```java
public interface UserRepository {
    User findById(String id);
    List<User> findAll(List<String> ids);  // batched
}

public final class JpaUserRepositoryAdapter implements UserRepository {
    private final EntityManager em;

    @Override
    public User findById(String id) { return toDomain(em.find(JpaUser.class, id)); }

    @Override
    public List<User> findAll(List<String> ids) {
        var jpaUsers = em.createQuery("SELECT u FROM JpaUser u WHERE u.id IN :ids", JpaUser.class)
                         .setParameter("ids", ids)
                         .getResultList();
        return jpaUsers.stream().map(this::toDomain).toList();
    }
}
```

**Measurement.** Fetching 100 users: before ≈ 100 × 2 ms = 200 ms; after ≈ 1 × 5 ms = 5 ms. **40× faster.**

**Lesson:** When the adaptee supports batching, the target interface should expose it. Otherwise the abstraction hides a performance feature.

---

## Optimization 3: Move cross-cutting concerns out of adapter

### Before

```java
public final class StripeAdapter implements PaymentProcessor {
    private final StripeClient client;
    private final MeterRegistry metrics;
    private final RetryPolicy retry;

    @Override
    public PaymentResult pay(PaymentRequest req) {
        return retry.execute(() -> {
            long start = System.nanoTime();
            try {
                Charge ch = client.charges().create(toParams(req));
                metrics.timer("pay").record(System.nanoTime() - start, TimeUnit.NANOSECONDS);
                return toResult(ch);
            } catch (StripeException e) {
                metrics.counter("pay.errors").increment();
                throw new PaymentException(...);
            }
        });
    }
}
```

**Cost:** The adapter is 50+ lines of mixed concerns. Hard to test (needs metrics + retry mocks). Hard to reason about (translation entangled with cross-cutting). Hard to swap (new `AdyenAdapter` would re-implement metrics + retry).

### After

Decompose into Decorators:

```java
// Adapter — translation only.
public final class StripeAdapter implements PaymentProcessor {
    private final StripeClient client;
    public StripeAdapter(StripeClient c) { this.client = c; }
    @Override
    public PaymentResult pay(PaymentRequest req) {
        try {
            return toResult(client.charges().create(toParams(req)));
        } catch (StripeException e) {
            throw translate(e);
        }
    }
}

// Decorators — wrap any PaymentProcessor.
public final class MetricsProcessor implements PaymentProcessor {
    private final PaymentProcessor inner; private final MeterRegistry metrics;
    public MetricsProcessor(PaymentProcessor i, MeterRegistry m) { this.inner = i; this.metrics = m; }
    @Override
    public PaymentResult pay(PaymentRequest req) {
        long start = System.nanoTime();
        try { return inner.pay(req); }
        finally { metrics.timer("pay").record(System.nanoTime() - start, TimeUnit.NANOSECONDS); }
    }
}

public final class RetryingProcessor implements PaymentProcessor { /* ... */ }

// Wiring (Spring, Guice, or factory):
PaymentProcessor processor = new MetricsProcessor(
    new RetryingProcessor(new StripeAdapter(stripeClient), retryPolicy),
    metrics
);
```

**Measurement.** Adapter line count drops from ~70 to ~20. Test time drops because each piece is independently mocked. Adding `AdyenAdapter` reuses both decorators.

**Lesson:** Optimize for *change*, not just runtime. The decorator stack is the canonical adapter cleanup.

---

## Optimization 4: Pointer receivers in Go

### Before

```go
type StripeAdapter struct{ client *stripe.Client }

func (s StripeAdapter) Pay(amount int) error { ... }   // value receiver

// hot path:
for _, req := range reqs {
    var p PaymentProcessor = StripeAdapter{client: c}   // allocates per loop!
    p.Pay(req.Amount)
}
```

**Cost:** Each `var p PaymentProcessor = StripeAdapter{...}` copies the struct to the heap (interface needs a stable pointer). With one pointer field, the alloc is small (~16 bytes), but at millions of iterations it shows up in `go tool pprof`.

### After

```go
func (s *StripeAdapter) Pay(amount int) error { ... }   // pointer receiver

processor := &StripeAdapter{client: c}                  // build once
var p PaymentProcessor = processor                       // no alloc
for _, req := range reqs {
    p.Pay(req.Amount)
}
```

**Measurement.** `pprof -alloc_objects` shows zero allocations in the loop after the change. CPU time unchanged but GC pauses drop.

**Lesson:** Go adapters going through interfaces always use pointer receivers. Construct once, pass the pointer.

---

## Optimization 5: Cache deterministic translations

### Before

```python
class TimezoneAdapter:
    def __init__(self, tz_provider):
        self._tz = tz_provider

    def to_utc(self, local_iso: str, tz_name: str) -> str:
        tz = self._tz.lookup(tz_name)         # heavy: parses tz files!
        dt = datetime.fromisoformat(local_iso).replace(tzinfo=tz)
        return dt.astimezone(timezone.utc).isoformat()
```

**Cost:** `tz_provider.lookup("America/New_York")` parses the entire tz database on every call. A trace showed this adapter eating 30% of API CPU time on a calendar service.

### After

```python
from functools import lru_cache


class TimezoneAdapter:
    def __init__(self, tz_provider):
        self._tz = tz_provider

    @lru_cache(maxsize=512)
    def _resolve(self, tz_name):
        return self._tz.lookup(tz_name)

    def to_utc(self, local_iso: str, tz_name: str) -> str:
        tz = self._resolve(tz_name)
        dt = datetime.fromisoformat(local_iso).replace(tzinfo=tz)
        return dt.astimezone(timezone.utc).isoformat()
```

**Measurement.** Calendar service CPU per request drops by ~25%. Memory stays flat (cache size capped).

**Lesson:** Cache deterministic, expensive, low-cardinality translations *inside the adapter*. Bound the cache.

---

## Optimization 6: Avoid boxing on the hot path (Java)

### Before

```java
public interface PriceFetcher {
    Optional<Long> priceFor(String symbol);   // boxes Long
}

public final class CachedPriceAdapter implements PriceFetcher {
    private final Map<String, Long> cache = new ConcurrentHashMap<>();
    public Optional<Long> priceFor(String symbol) {
        Long cached = cache.get(symbol);
        return Optional.ofNullable(cached);   // both Optional + Long allocate
    }
}
```

**Cost:** On every call, `Optional.ofNullable` allocates an `Optional` instance. The map already gives you a `Long` (boxed), so you're double-boxed in tight loops.

### After

```java
public interface PriceFetcher {
    OptionalLong priceFor(String symbol);   // primitive specialization
}

public final class CachedPriceAdapter implements PriceFetcher {
    private final ConcurrentHashMap<String, Long> cache = new ConcurrentHashMap<>();
    public OptionalLong priceFor(String symbol) {
        Long v = cache.get(symbol);
        return v == null ? OptionalLong.empty() : OptionalLong.of(v);
    }
}
```

For *very* hot paths, even `OptionalLong` allocates (one instance per call beyond the empty singleton). If you can change the contract to "0 means absent" (acceptable for prices), use a primitive:

```java
public long priceForOrZero(String symbol) {
    Long v = cache.get(symbol);
    return v == null ? 0L : v;
}
```

**Measurement.** JMH: ~12 ns/call → ~3 ns/call. GC pressure drops to near zero. For 10k QPS service, this is invisible. For 1M QPS pricing engine, it's the difference between meeting and missing SLO.

**Lesson:** Boxing is a real cost in Java hot paths. Primitive specializations and value semantics matter.

---

## Optimization 7: Reuse buffers in serialization adapters

### Before

```go
func (a *KafkaAdapter) Publish(event Event) error {
    payload, err := json.Marshal(event)   // allocates a new slice every call
    if err != nil { return err }
    return a.producer.Send(a.topic, payload)
}
```

**Cost:** `json.Marshal` allocates a fresh `[]byte` per event. At 50k events/sec, that's serious GC pressure.

### After

```go
type KafkaAdapter struct {
    producer Producer
    topic    string
    bufPool  sync.Pool
}

func NewKafkaAdapter(p Producer, topic string) *KafkaAdapter {
    return &KafkaAdapter{
        producer: p, topic: topic,
        bufPool:  sync.Pool{New: func() any { return new(bytes.Buffer) }},
    }
}

func (a *KafkaAdapter) Publish(event Event) error {
    buf := a.bufPool.Get().(*bytes.Buffer)
    buf.Reset()
    defer a.bufPool.Put(buf)

    if err := json.NewEncoder(buf).Encode(event); err != nil {
        return err
    }
    return a.producer.Send(a.topic, buf.Bytes())
}
```

**Caution:** `Send` must consume `buf.Bytes()` synchronously — if it stores the slice for later, you'll mutate it on the next call. Read the SDK contract.

**Measurement.** Allocations drop ~80%; GC pause time on a 50k QPS publisher drops from 4% to <1%.

**Lesson:** `sync.Pool` (Go), `ThreadLocal<>` reusable buffers (Java), or generators that yield in-place (Python) keep adapter throughput high.

---

## Optimization 8: Stream large responses (Python)

### Before

```python
class S3Adapter:
    def __init__(self, client, bucket): ...
    def get(self, key: str) -> bytes:
        return self._c.get_object(Bucket=self._bucket, Key=key)["Body"].read()
```

**Cost:** Loads the entire object into memory. For multi-GB blobs, the process OOMs.

### After

```python
from typing import Iterator


class S3Adapter:
    def get_stream(self, key: str, chunk_size: int = 64 * 1024) -> Iterator[bytes]:
        body = self._c.get_object(Bucket=self._bucket, Key=key)["Body"]
        try:
            while True:
                chunk = body.read(chunk_size)
                if not chunk:
                    return
                yield chunk
        finally:
            body.close()
```

**Measurement.** Memory per request: O(blob size) → O(64 KB). The process now serves 1000 concurrent downloads instead of 5.

**Lesson:** When the adaptee streams, the adapter must stream too — else you concentrate the blob in memory at the boundary. Match the data shape, not just the call shape.

---

## Optimization 9: Coalesce vendor calls (debounce/batch)

### Before

```java
public final class MetricsApiAdapter implements MetricsSink {
    private final MetricsClient client;
    @Override
    public void record(String name, double value) {
        client.send(name, value);   // one HTTP call per metric
    }
}
```

**Cost:** Hot loops call `record` thousands of times per second. The vendor accepts batches; you're not using them. Network and CPU explode.

### After

A buffering adapter that flushes on size or interval:

```java
public final class BatchingMetricsAdapter implements MetricsSink, AutoCloseable {
    private final MetricsClient client;
    private final BlockingQueue<MetricEntry> buffer = new ArrayBlockingQueue<>(10_000);
    private final ScheduledExecutorService flusher;

    public BatchingMetricsAdapter(MetricsClient client, Duration interval) {
        this.client = client;
        this.flusher = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "metrics-flusher");
            t.setDaemon(true);
            return t;
        });
        flusher.scheduleAtFixedRate(this::flush, interval.toMillis(),
                                    interval.toMillis(), TimeUnit.MILLISECONDS);
    }

    @Override
    public void record(String name, double value) {
        boolean ok = buffer.offer(new MetricEntry(name, value, System.currentTimeMillis()));
        if (!ok) flush();   // back-pressure: block? drop? here we flush.
    }

    private void flush() {
        var batch = new ArrayList<MetricEntry>(buffer.size());
        buffer.drainTo(batch);
        if (!batch.isEmpty()) client.sendBatch(batch);
    }

    @Override
    public void close() {
        flusher.shutdown();
        flush();
    }
}
```

**Measurement.** 10k metrics/sec → ~10 batched HTTP calls/sec instead of 10k. CPU and network drop ~99%. Latency improves slightly because batched calls amortize TLS handshakes.

**Trade-off:** metrics now have up-to-`interval` lag. Document it.

**Lesson:** When the adaptee supports batching but the target is per-event, the adapter is the right place to buffer.

---

## Optimization 10: Lazy adapter initialization

### Before

```java
@Configuration
public class AdaptersConfig {
    @Bean PaymentProcessor stripe()      { return new StripeAdapter(StripeClient.create(...)); }
    @Bean PaymentProcessor adyen()       { return new AdyenAdapter(AdyenClient.create(...)); }
    @Bean PaymentProcessor mercadoPago() { return new MercadoPagoAdapter(...); }
    // 10 more...
}
```

**Cost:** App startup connects to **all** payment vendors, even if 90% of traffic uses one. Slow boot, wasted connection pools, potential boot failure if any vendor is down.

### After

Lazy beans + a router that resolves the right adapter on demand:

```java
@Configuration
public class AdaptersConfig {
    @Bean @Lazy PaymentProcessor stripe()      { return new StripeAdapter(StripeClient.create(...)); }
    @Bean @Lazy PaymentProcessor adyen()       { return new AdyenAdapter(AdyenClient.create(...)); }
    // ...
}

@Component
public class PaymentRouter {
    private final Map<String, ObjectProvider<PaymentProcessor>> byName;

    public PaymentRouter(ApplicationContext ctx) {
        this.byName = Map.of(
            "stripe",      ctx.getBeanProvider(PaymentProcessor.class, "stripe"),
            "adyen",       ctx.getBeanProvider(PaymentProcessor.class, "adyen")
        );
    }

    public PaymentProcessor pick(String name) { return byName.get(name).getObject(); }
}
```

**Measurement.** Boot time drops from 18s to 4s on a multi-vendor app. Vendor outages no longer cascade into deploy failures.

**Lesson:** Adapter construction is rarely free. When you have many adapters, lazy + routed wins on both boot time and resilience.

---

## Optimization Tips

1. **Profile before optimizing.** "Adapter is slow" is rarely true. The adaptee is usually slow. Measure with real load.
2. **Move cross-cutting concerns out of the adapter.** Decorators are cheaper to test, easier to reason about, and reusable across adapters.
3. **Match the adaptee's shape.** If it batches, batch. If it streams, stream. If it's async, propagate async.
4. **Bound everything.** Buffers, caches, retry attempts — unbounded is choosing failure mode under load.
5. **In Go, use pointer receivers for adapters** through interfaces — sidesteps allocation traps.
6. **In Java, watch for boxing** in adapter return types on hot paths.
7. **In Python, watch for repeated heavy operations** (regex compile, tz lookup, JSON parse). Cache them inside the adapter.
8. **Lazy-initialize adapters** when many adapter instances are configured but few are used per request.
9. **Don't optimize what the JIT erases.** Microbenchmark first; the JVM/Go runtime often makes adapter overhead vanish.
10. **Optimize for change as often as performance.** A clean adapter that's easy to swap is more valuable than a tweaked one that's tangled.

---

← Back to Adapter folder · [↑ Structural Patterns](../README.md) · [↑↑ Roadmap Home](../../../README.md)

**You've completed the Adapter pattern suite.** Continue to: [Bridge](../02-bridge/junior.md) · [Composite](../03-composite/junior.md) · [Decorator](../04-decorator/junior.md)
