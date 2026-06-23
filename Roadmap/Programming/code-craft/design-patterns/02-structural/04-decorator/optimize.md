# Decorator — Optimize

> **Source:** [refactoring.guru/design-patterns/decorator](https://refactoring.guru/design-patterns/decorator)

Each section presents a Decorator that *works* but is wasteful. Profile, optimize, measure.

---

## Table of Contents

1. [Optimization 1: Consolidate adjacent decorators](#optimization-1-consolidate-adjacent-decorators)
2. [Optimization 2: Pre-format log messages once](#optimization-2-pre-format-log-messages-once)
3. [Optimization 3: Avoid per-call map allocation](#optimization-3-avoid-per-call-map-allocation)
4. [Optimization 4: Pointer receivers for stack of decorators (Go)](#optimization-4-pointer-receivers-for-stack-of-decorators-go)
5. [Optimization 5: Lazy decorator construction](#optimization-5-lazy-decorator-construction)
6. [Optimization 6: Drop unused decorators](#optimization-6-drop-unused-decorators)
7. [Optimization 7: Reorder for short-circuit](#optimization-7-reorder-for-short-circuit)
8. [Optimization 8: Async-friendly chain](#optimization-8-async-friendly-chain)
9. [Optimization 9: Replace dynamic proxy with explicit decorator](#optimization-9-replace-dynamic-proxy-with-explicit-decorator)
10. [Optimization 10: Code-gen vs runtime composition](#optimization-10-code-gen-vs-runtime-composition)
11. [Optimization Tips](#optimization-tips)

---

## Optimization 1: Consolidate adjacent decorators

### Before

```java
service = new LoggingService(service, log);
service = new MetricsService(service, metrics);
service = new TracingService(service, tracer);
```

Three decorators each do a tiny thing: log, count, span. Three indirections per call.

### After

```java
service = new ObservabilityService(service, log, metrics, tracer);
```

One decorator with all three responsibilities. Trade: less granular control over enabling individual concerns. Gain: one indirection, less per-call work.

**Measurement.** A 5-decorator stack with three "instrumentation" decorators consolidated into one drops per-call latency by 30-40 ns at warm JVM steady state. For 100k QPS service: meaningful.

**Lesson:** When several decorators are *always together*, consolidate. Composition is good; over-decomposition has cost.

---

## Optimization 2: Pre-format log messages once

### Before

```java
public Result call(Request req) {
    log.info(String.format("calling %s with %s at %s", inner.getClass().getName(), req, Instant.now()));
    return inner.call(req);
}
```

`String.format` allocates per call. `Instant.now()` is a syscall.

### After

```java
private static final String CALL_MSG = "calling";

public Result call(Request req) {
    log.atInfo()
       .addKeyValue("inner", inner.getClass().getName())
       .addKeyValue("request", req)
       .log(CALL_MSG);
    return inner.call(req);
}
```

Structured logging APIs (SLF4J 2.x, Log4j 2 fluent) avoid per-call string allocations.

**Measurement.** GC pressure drops; per-call latency improves a few hundred ns.

**Lesson:** Logging is a hot path; format lazily or use structured APIs. `String.format` everywhere is a tax.

---

## Optimization 3: Avoid per-call map allocation

### Before

```python
class LoggingDecorator:
    def call(self, req):
        ctx = {"req": str(req), "user": req.user_id, "t": time.time()}
        log.info("call", **ctx)
        return self._inner.call(req)
```

A new dict every call. Python GC handles it, but allocations + reference counting add up at high QPS.

### After

```python
class LoggingDecorator:
    def call(self, req):
        # Pass kwargs directly; logger handles formatting lazily.
        log.info("call", req=str(req), user=req.user_id, t=time.time())
        return self._inner.call(req)
```

Or use a logger that takes a callable for lazy formatting:

```python
log.info_lazy(lambda: f"call user={req.user_id}")
```

Skip the dict if the log level is below `INFO`.

**Measurement.** ~20% improvement in tight Python loops. More with `logging.disable(logging.INFO)` in dev.

**Lesson:** Don't build context maps unconditionally. Use lazy logging APIs and check log levels.

---

## Optimization 4: Pointer receivers for stack of decorators (Go)

### Before

```go
type RetryDecorator struct{ inner Service; max int }
func (r RetryDecorator) Call(req Request) Result { ... }   // value receiver

processor := RetryDecorator{inner: real, max: 3}
var s Service = processor   // copies; allocates
```

Each interface conversion copies the struct. Many decorations = many copies.

### After

```go
func (r *RetryDecorator) Call(req Request) Result { ... }   // pointer receiver

processor := &RetryDecorator{inner: real, max: 3}
var s Service = processor   // single pointer; no copy
```

**Measurement.** Allocations drop; CPU profile cleaner.

**Lesson:** In Go, decorators going through interfaces should use pointer receivers. Same advice as Adapter and Bridge.

---

## Optimization 5: Lazy decorator construction

### Before

```java
public class ServiceFactory {
    public static Service build(Config cfg) {
        Service s = new RealService(cfg);
        s = new LoggingService(s, new ExpensiveLogger(cfg));   // eager
        s = new MetricsService(s, new ExpensiveMetrics(cfg));  // eager
        return s;
    }
}
```

Every service constructed at app startup pays for full instrumentation, even features not used.

### After

```java
public static Service build(Config cfg) {
    Service s = new RealService(cfg);
    if (cfg.loggingEnabled()) s = new LoggingService(s, ...);
    if (cfg.metricsEnabled()) s = new MetricsService(s, ...);
    return s;
}
```

Or use lazy initialization:

```java
public static Service build(Config cfg) {
    return new LazyDecorator(() -> {
        Service s = new RealService(cfg);
        // ... heavy decoration
        return s;
    });
}
```

**Measurement.** App boot time drops; memory footprint shrinks.

**Lesson:** Construct only the decorators you need. Boot time and memory are real costs.

---

## Optimization 6: Drop unused decorators

### Before

A 12-layer stack accumulated over 3 years. `git blame` shows nobody owns half of them.

### After

Audit: profile, count log lines per decorator, check feature flag usage. Decorators with no recent observability hits get dropped.

**Measurement.** Per-call latency drops. Stack traces shrink. Mental load on new engineers drops.

**Lesson:** Decorators are easy to add and easy to forget. Periodic audits keep stacks sane.

---

## Optimization 7: Reorder for short-circuit

### Before

```java
service = new MetricsService(
    new ValidationService(
        new ExpensiveAuthService(
            new RealService(),
            authProvider),
        validator),
    metrics);
```

Auth runs before validation. Even invalid requests hit the auth provider — expensive.

### After

```java
service = new MetricsService(
    new ExpensiveAuthService(
        new ValidationService(
            new RealService(),
            validator),
        authProvider),
    metrics);
```

Validation rejects bad requests before auth runs.

**Measurement.** Auth provider load drops noticeably for buggy clients sending malformed requests. Latency on valid requests unchanged.

**Lesson:** Order decorators so cheap rejects happen before expensive operations. Short-circuit early.

---

## Optimization 8: Async-friendly chain

### Before (Python)

```python
class CachingDecorator:
    def __init__(self, inner, cache): self._inner = inner; self._cache = cache
    def call(self, req):
        if req.id in self._cache: return self._cache[req.id]
        result = self._inner.call(req)
        self._cache[req.id] = result
        return result
```

Wrapped service is async; this decorator is sync. Calling `self._inner.call(req)` returns a coroutine; storing the coroutine in cache; future "hits" return coroutines, not results.

### After

```python
class AsyncCachingDecorator:
    def __init__(self, inner, cache): self._inner = inner; self._cache = cache

    async def call(self, req):
        if req.id in self._cache: return self._cache[req.id]
        result = await self._inner.call(req)
        self._cache[req.id] = result
        return result
```

**Measurement.** Cache works correctly; throughput restored.

**Lesson:** Match the concurrency model. Async inner → async decorator. Don't mix.

---

## Optimization 9: Replace dynamic proxy with explicit decorator

### Before (Spring AOP)

```java
@Service
public class PaymentService {
    @Retryable(maxAttempts = 3)
    @Cacheable("payments")
    public Receipt pay(PaymentRequest req) { ... }
}
```

Spring weaves a dynamic proxy. ~30-50 ns per intercepted call (reflection + plumbing). For 1M QPS hot paths, real cost.

### After

```java
public final class PaymentService {
    public Receipt pay(PaymentRequest req) { ... }   // pure
}

PaymentService svc = new RetryingPaymentService(
    new CachingPaymentService(new PaymentService(), cache),
    3
);
```

Explicit decorators; no dynamic proxy. JVM can inline the entire chain.

**Measurement.** Hot-path latency drops 30-100 ns/call. For most apps invisible; for inner-loop services, meaningful.

**Lesson:** AOP is great for ergonomics; explicit Decorator wins for performance-critical code.

---

## Optimization 10: Code-gen vs runtime composition

### Before

For 50 service interfaces, each with `@Retryable` and `@Cacheable`, Spring generates 100 dynamic proxies at runtime. Boot time and memory cost.

### After

Use an annotation processor (Java) or code generator (Go: `go generate`, Rust: macros) that produces decorator classes at compile time. No runtime proxy generation; faster boot; predictable performance.

```java
// Generated:
public class RetryablePaymentServiceDecorator implements PaymentService {
    private final PaymentService inner;
    public RetryablePaymentServiceDecorator(PaymentService inner) { this.inner = inner; }

    @Override
    public Receipt pay(PaymentRequest req) {
        for (int i = 0; i < 3; i++) {
            try { return inner.pay(req); }
            catch (TransientException e) { /* ... */ }
        }
        throw new RetriesExhaustedException();
    }
}
```

**Measurement.** Boot time drops (no runtime weaving). Hot-path performance improves slightly. CI build time increases (extra annotation processing).

**Lesson:** Code-gen trades build complexity for runtime performance. Worth it for services where boot time or hot-path latency matters.

---

## Optimization Tips

1. **Profile first.** Most decorator overhead is invisible behind I/O. Don't optimize what you can't measure.
2. **Consolidate decorators that always travel together.** `Logging+Metrics+Tracing` → `Observability`.
3. **Use structured logging APIs** that avoid per-call string allocation.
4. **Lazy-construct heavy decorators.** Boot time matters.
5. **Reorder for short-circuit.** Cheap rejects before expensive operations.
6. **Match concurrency models.** Async outer → async inner; don't mix.
7. **Drop unused decorators.** Audits pay off; stack traces shrink.
8. **Prefer pointer receivers in Go.** Avoid per-conversion allocations.
9. **Replace dynamic proxies with explicit decorators** in performance-critical paths.
10. **Code-gen decorators** when boot time or runtime perf matters more than build complexity.
11. **Cap stack depth** with a code-review rule. Discipline beats cleanup.
12. **Optimize for change too.** A clean 4-layer stack beats a tweaked 12-layer one.

---

← Back to Decorator folder · [↑ Structural Patterns](../README.md) · [↑↑ Roadmap Home](../../../README.md)

**You've completed the Decorator pattern suite.** Continue to: [Facade](../05-facade/junior.md) · [Flyweight](../06-flyweight/junior.md) · [Proxy](../07-proxy/junior.md)
