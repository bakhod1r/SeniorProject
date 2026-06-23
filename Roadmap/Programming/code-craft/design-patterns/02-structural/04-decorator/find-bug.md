# Decorator — Find the Bug

> **Source:** [refactoring.guru/design-patterns/decorator](https://refactoring.guru/design-patterns/decorator)

Each section presents a Decorator that *looks* fine but is broken. Find the bug yourself, then check.

---

## Table of Contents

1. [Bug 1: Wrong order — caching above logging hides hits](#bug-1-wrong-order-caching-above-logging-hides-hits)
2. [Bug 2: Retry without idempotency key](#bug-2-retry-without-idempotency-key)
3. [Bug 3: Decorator throws, breaks the call](#bug-3-decorator-throws-breaks-the-call)
4. [Bug 4: Stateful decorator without thread-safety](#bug-4-stateful-decorator-without-thread-safety)
5. [Bug 5: Cancellation not propagated](#bug-5-cancellation-not-propagated)
6. [Bug 6: Decorator forgets to close inner](#bug-6-decorator-forgets-to-close-inner)
7. [Bug 7: Equals/hashCode confused with the inner](#bug-7-equalshashcode-confused-with-the-inner)
8. [Bug 8: Hidden field shadowing inner state](#bug-8-hidden-field-shadowing-inner-state)
9. [Bug 9: Decorator return value silently dropped](#bug-9-decorator-return-value-silently-dropped)
10. [Bug 10: Decorator changes the contract subtly (Java)](#bug-10-decorator-changes-the-contract-subtly-java)
11. [Bug 11: Logging decorator allocates per call](#bug-11-logging-decorator-allocates-per-call)
12. [Bug 12: Async retry without await (Python)](#bug-12-async-retry-without-await-python)
13. [Practice Tips](#practice-tips)

---

## Bug 1: Wrong order — caching above logging hides hits

```java
Service svc = new CachingService(
    new LoggingService(           // logging inside cache
        new RealService(),
        logger),
    cache);
```

A user reports "the dashboard says 0 calls/sec but the cache hit rate is 99%."

<details><summary>Reveal</summary>

**Bug:** Logging is *inside* caching. On a cache hit, logging never runs — the cache short-circuits before `LoggingService.call()` is invoked. The dashboard counts only cache misses, which look like 0 from the user's perspective.

**Fix:** Logging *outside* caching:

```java
Service svc = new LoggingService(
    new CachingService(new RealService(), cache),
    logger);
```

**Lesson:** Order in a Decorator stack determines who sees what. Always be explicit about whether a layer should see *all* calls or *only* what passes through the layer below.

</details>

---

## Bug 2: Retry without idempotency key

```go
type RetryDecorator struct{ inner PaymentService; max int }
func (r *RetryDecorator) Pay(ctx context.Context, req PaymentRequest) error {
    var err error
    for i := 0; i < r.max; i++ {
        err = r.inner.Pay(ctx, req)
        if err == nil { return nil }
    }
    return err
}
```

After deploying this, customers report being charged 2-3 times for the same order.

<details><summary>Reveal</summary>

**Bug:** The retry decorator calls `Pay` again on transient failure, but the `req` doesn't have an idempotency key. The downstream payment provider treats each retry as a *new* charge. Network blip + 3 retries = 3 charges.

**Fix:** Generate an idempotency key once; reuse on every retry.

```go
func (r *RetryDecorator) Pay(ctx context.Context, req PaymentRequest) error {
    if req.IdempotencyKey == "" {
        req.IdempotencyKey = uuid.NewString()
    }
    var err error
    for i := 0; i < r.max; i++ {
        err = r.inner.Pay(ctx, req)
        if err == nil { return nil }
        if !isRetryable(err) { return err }
    }
    return err
}
```

**Lesson:** Retry around non-idempotent operations is dangerous. Either pass an idempotency key or document loudly that the wrapped service must already be idempotent.

</details>

---

## Bug 3: Decorator throws, breaks the call

```python
class LoggingDecorator:
    def __init__(self, inner, log_path):
        self._inner = inner
        self._log = open(log_path, "a")   # opens at construction

    def call(self, req):
        self._log.write(f"calling with {req}\n")
        return self._inner.call(req)
```

Some calls fail with `ValueError: I/O operation on closed file`.

<details><summary>Reveal</summary>

**Bug:** The log file is closed somewhere (maybe by tests, maybe by GC, maybe by a process restart). The next `write` throws. Logging — *purely cross-cutting* — now breaks the actual call.

**Fix:** Don't let logging break the call. Wrap in try/except.

```python
def call(self, req):
    try:
        self._log.write(f"calling with {req}\n")
    except Exception:
        # Best-effort logging; don't fail the call.
        pass
    return self._inner.call(req)
```

Or use a robust logger (Python's `logging` module handles this).

**Lesson:** A decorator should not change the inner contract unless intentional. Logging that fails shouldn't take down the request.

</details>

---

## Bug 4: Stateful decorator without thread-safety

```go
type CounterDecorator struct {
    inner Service
    count int
}

func (c *CounterDecorator) Call(req Request) Result {
    c.count++
    return c.inner.Call(req)
}
```

Under load test the counter is consistently lower than the actual request count.

<details><summary>Reveal</summary>

**Bug:** `c.count++` is not atomic. Two goroutines can read 5, both write 6 — losing one increment. The race detector (`go test -race`) flags it; production silently undercounts.

**Fix:** Atomic ops or a mutex.

```go
import "sync/atomic"

type CounterDecorator struct {
    inner Service
    count atomic.Int64
}

func (c *CounterDecorator) Call(req Request) Result {
    c.count.Add(1)
    return c.inner.Call(req)
}
```

**Lesson:** Stateful decorators shared across threads must be thread-safe. Test under load with race detector enabled.

</details>

---

## Bug 5: Cancellation not propagated

```go
type CachedRepo struct{ inner UserRepo; cache sync.Map }

func (c *CachedRepo) Get(ctx context.Context, id string) (User, error) {
    if v, ok := c.cache.Load(id); ok { return v.(User), nil }
    u, err := c.inner.Get(context.Background(), id)   // !
    if err == nil { c.cache.Store(id, u) }
    return u, err
}
```

A failing test: the test uses a context with a 100ms deadline; the cached repo hangs for 5 seconds.

<details><summary>Reveal</summary>

**Bug:** The decorator passes `context.Background()` to the inner instead of forwarding the caller's context. The inner can't see the deadline; it runs to completion regardless of cancellation.

**Fix:** propagate the caller's context.

```go
u, err := c.inner.Get(ctx, id)
```

**Lesson:** Decorators must propagate context, deadlines, and cancellation tokens. Replacing them silently leads to leaks and unbounded operations.

</details>

---

## Bug 6: Decorator forgets to close inner

```java
public class LoggingStream implements InputStream {
    private final InputStream inner;
    private final Logger log;
    public LoggingStream(InputStream inner, Logger log) {
        this.inner = inner; this.log = log;
    }
    public int read() throws IOException {
        int b = inner.read();
        log.info("read byte {}", b);
        return b;
    }
    // forgot to override close()
}

try (var s = new LoggingStream(new FileInputStream("data"), log)) {
    // read...
}
// FileInputStream is leaked!
```

<details><summary>Reveal</summary>

**Bug:** The decorator doesn't override `close()`. With `try-with-resources`, only the *outer* (`LoggingStream`) is closed; its `close()` (inherited or default) doesn't close the inner `FileInputStream`. File descriptor leak.

**Fix:** Override `close()` to propagate.

```java
@Override
public void close() throws IOException {
    inner.close();
}
```

Better: extend `FilterInputStream`, which forwards `close()` automatically.

**Lesson:** Decorators must respect the lifecycle of the wrapped object. Close must propagate.

</details>

---

## Bug 7: Equals/hashCode confused with the inner

```java
public class CachingRepo implements UserRepo {
    private final UserRepo inner;
    @Override public boolean equals(Object o) { return inner.equals(o); }
    @Override public int hashCode() { return inner.hashCode(); }
}

Map<UserRepo, String> map = new HashMap<>();
UserRepo cached = new CachingRepo(real);
map.put(cached, "value");
map.put(real, "other");           // collides!
```

<details><summary>Reveal</summary>

**Bug:** The decorator delegates `equals`/`hashCode` to the inner. Now `cached.equals(real)` is true; they collide in hash maps. Different decorations are treated as the same key — breaking the map.

**Fix:** Use identity-based equality on the decorator (default `Object.equals`), or define equality based on the *whole stack* shape (uncommon and tricky).

```java
// Either: leave equals/hashCode to default (identity)
// Or: include the decorator class in the comparison.
```

**Lesson:** Equality across decorators is a design choice. Don't blindly delegate; think about what "equal" means for a decorated object.

</details>

---

## Bug 8: Hidden field shadowing inner state

```python
class CachingRepo:
    def __init__(self, inner):
        self._inner = inner
        self._items = {}   # cache

    def add(self, x):
        self._items[x.id] = x   # ! cache populated, inner skipped
```

A test asserts that after `repo.add(x)`, `inner.get(x.id)` returns `x`. It fails.

<details><summary>Reveal</summary>

**Bug:** The `add` method updates the cache but never delegates to the inner. The wrapped repository never sees the addition. Subsequent reads return the cached value, but persistence (the inner's job) is missing.

**Fix:** delegate to inner *and* update the cache.

```python
def add(self, x):
    self._inner.add(x)
    self._items[x.id] = x
```

**Lesson:** Decorators add behavior *around* the inner; they don't replace it. Forgetting to delegate is a common bug.

</details>

---

## Bug 9: Decorator return value silently dropped

```go
type LoggingService struct{ inner Service; log Logger }

func (l *LoggingService) Call(req Request) Result {
    l.log.Info("calling")
    l.inner.Call(req)   // !
    l.log.Info("done")
    return Result{}     // returns empty!
}
```

Tests pass; production reports "all responses are blank."

<details><summary>Reveal</summary>

**Bug:** The decorator calls the inner but doesn't capture or forward the result. Every call returns the zero-value `Result{}`. The inner runs but its work is thrown away.

**Fix:** capture and return.

```go
func (l *LoggingService) Call(req Request) Result {
    l.log.Info("calling")
    r := l.inner.Call(req)
    l.log.Info("done")
    return r
}
```

**Lesson:** Decorators must thread the inner's result through. A boilerplate-but-critical step.

</details>

---

## Bug 10: Decorator changes the contract subtly (Java)

```java
public interface Service {
    Result call(Request req) throws ServiceException;
}

public class CachingService implements Service {
    @Override
    public Result call(Request req) {   // ! removed throws clause
        return cache.computeIfAbsent(req.id(), k -> {
            try { return inner.call(req); }
            catch (ServiceException e) { throw new RuntimeException(e); }
        });
    }
}
```

Callers expecting `ServiceException` now see `RuntimeException`. Error handling code breaks silently.

<details><summary>Reveal</summary>

**Bug:** The decorator wraps `ServiceException` in `RuntimeException`. Callers' `try { ... } catch (ServiceException e) { ... }` blocks no longer catch the failure; an unchecked exception escapes.

**Fix:** propagate the same exception type.

```java
public Result call(Request req) throws ServiceException {
    try {
        return cache.computeIfAbsent(req.id(), k -> {
            try { return inner.call(req); }
            catch (ServiceException e) { throw new CacheException(e); }
        });
    } catch (CacheException e) {
        throw (ServiceException) e.getCause();
    }
}
```

(Or use a helper that propagates checked exceptions through `computeIfAbsent`.)

**Lesson:** A Decorator must respect the contract — exceptions, return types, semantics. Subtle changes break callers in production.

</details>

---

## Bug 11: Logging decorator allocates per call

```java
public class LoggingService implements Service {
    @Override
    public Result call(Request req) {
        Map<String, Object> ctx = new HashMap<>();   // per call
        ctx.put("request", req.toString());
        ctx.put("user", req.userId());
        ctx.put("timestamp", System.currentTimeMillis());
        log.info("calling", ctx);
        return inner.call(req);
    }
}
```

GC pressure spikes; profiler shows `HashMap` constructor allocations dominating.

<details><summary>Reveal</summary>

**Bug:** Every call allocates a new `HashMap`. At 10k QPS, 10k tiny maps/second → minor GC pressure. Multiplied by every decorator with a similar pattern, it adds up.

**Fix:** prefer structured logging APIs that don't allocate per call:

```java
log.atInfo()
   .addKeyValue("request", req)
   .addKeyValue("user", req.userId())
   .log("calling");
```

Or pre-allocate / reuse builders. Or accept the allocation if QPS is low.

**Lesson:** Per-call allocations in decorators add up. Profile if you suspect; mitigate with structured logging or builder reuse.

</details>

---

## Bug 12: Async retry without await (Python)

```python
class AsyncRetry:
    def __init__(self, inner, max_tries):
        self._inner = inner
        self._max = max_tries

    async def call(self, req):
        for i in range(self._max):
            try:
                return self._inner.call(req)   # !
            except Exception:
                if i == self._max - 1: raise
```

Tests pass occasionally; under load, calls return coroutine objects instead of results.

<details><summary>Reveal</summary>

**Bug:** `self._inner.call(req)` is a coroutine in async code; without `await`, it's never executed. The function returns the coroutine object as if it were the result.

**Fix:** `await` the inner.

```python
async def call(self, req):
    for i in range(self._max):
        try:
            return await self._inner.call(req)
        except Exception:
            if i == self._max - 1: raise
```

**Lesson:** Async decorators must be async-aware. Mixing sync wrappers with async inners breaks silently.

</details>

---

## Practice Tips

- Read the snippet, **stop**, predict the failure mode.
- For each bug, trace the call: input → decorator A → decorator B → inner → response → decorator B → decorator A → output. The bug is usually a missing or wrong step.
- After fixing, write a test that *would have caught* the bug. If the test is awkward to write, the fix is incomplete.
- Repeat in a week. These bugs repeat across codebases; pattern-recognize them.

---

← Back to Decorator folder · [↑ Structural Patterns](../README.md) · [↑↑ Roadmap Home](../../../README.md)

**Next:** [Decorator — Optimize](optimize.md)
