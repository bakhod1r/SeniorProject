# Decorator — Hands-On Tasks

> **Source:** [refactoring.guru/design-patterns/decorator](https://refactoring.guru/design-patterns/decorator)

Each task includes a brief, the interface, and a reference solution. Try first; check after.

---

## Table of Contents

1. [Task 1: Coffee with toppings](#task-1-coffee-with-toppings)
2. [Task 2: Logging + Caching repository](#task-2-logging-caching-repository)
3. [Task 3: HTTP middleware chain](#task-3-http-middleware-chain)
4. [Task 4: Retry with idempotency](#task-4-retry-with-idempotency)
5. [Task 5: Circuit breaker decorator](#task-5-circuit-breaker-decorator)
6. [Task 6: Rate limiter decorator](#task-6-rate-limiter-decorator)
7. [Task 7: Stream pipeline (compress + buffer + write)](#task-7-stream-pipeline-compress-buffer-write)
8. [Task 8: Conditional decoration by config](#task-8-conditional-decoration-by-config)
9. [Task 9: Trace context propagation](#task-9-trace-context-propagation)
10. [Task 10: Refactor inline logging into Decorator](#task-10-refactor-inline-logging-into-decorator)
11. [How to Practice](#how-to-practice)

---

## Task 1: Coffee with toppings

**Brief.** Build a `Coffee` interface; `Plain` is the base; `Milk`, `Sugar`, `Whip` are decorators.

### Solution (Python)

```python
class Coffee:
    def cost(self) -> int: ...
    def desc(self) -> str: ...

class Plain(Coffee):
    def cost(self): return 30
    def desc(self): return "coffee"

class Milk(Coffee):
    def __init__(self, inner): self._inner = inner
    def cost(self): return self._inner.cost() + 10
    def desc(self): return self._inner.desc() + " + milk"

class Sugar(Coffee):
    def __init__(self, inner): self._inner = inner
    def cost(self): return self._inner.cost() + 5
    def desc(self): return self._inner.desc() + " + sugar"

class Whip(Coffee):
    def __init__(self, inner): self._inner = inner
    def cost(self): return self._inner.cost() + 15
    def desc(self): return self._inner.desc() + " + whip"

c = Whip(Sugar(Milk(Plain())))
print(c.desc(), c.cost())   # coffee + milk + sugar + whip 60
```

---

## Task 2: Logging + Caching repository

**Brief.** A repo that fetches users; add caching and logging via decorators.

### Solution (Go)

```go
type UserRepo interface {
    Get(id string) (User, error)
}

type postgresRepo struct{ db *sql.DB }
func (p *postgresRepo) Get(id string) (User, error) { /* ... */ }

type cacheRepo struct {
    inner UserRepo
    cache sync.Map
    ttl   time.Duration
}
func (c *cacheRepo) Get(id string) (User, error) {
    if v, ok := c.cache.Load(id); ok { return v.(User), nil }
    u, err := c.inner.Get(id)
    if err == nil { c.cache.Store(id, u) }
    return u, err
}

type logRepo struct{ inner UserRepo; logger Logger }
func (l *logRepo) Get(id string) (User, error) {
    l.logger.Info("get", "id", id)
    return l.inner.Get(id)
}

repo := &logRepo{inner: &cacheRepo{inner: &postgresRepo{db: db}, ttl: time.Minute}, logger: log}
```

---

## Task 3: HTTP middleware chain

**Brief.** Express-style middleware in Go: Logging + RequestID + Auth wrapping a handler.

### Solution

```go
type Middleware func(http.Handler) http.Handler

func Chain(h http.Handler, mw ...Middleware) http.Handler {
    for i := len(mw) - 1; i >= 0; i-- { h = mw[i](h) }
    return h
}

func Logging(l Logger) Middleware {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            start := time.Now()
            next.ServeHTTP(w, r)
            l.Info("http", "path", r.URL.Path, "duration", time.Since(start))
        })
    }
}

func RequestID() Middleware {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            id := uuid.NewString()
            w.Header().Set("X-Request-ID", id)
            r = r.WithContext(context.WithValue(r.Context(), "rid", id))
            next.ServeHTTP(w, r)
        })
    }
}

func Auth(verify func(*http.Request) bool) Middleware {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            if !verify(r) { http.Error(w, "unauthorized", 401); return }
            next.ServeHTTP(w, r)
        })
    }
}

handler := Chain(realHandler, Logging(log), RequestID(), Auth(verifyToken))
```

---

## Task 4: Retry with idempotency

**Brief.** Wrap a service with retry; ensure each retry uses the same idempotency key.

### Solution (Java)

```java
public class IdempotentRetry implements Service {
    private final Service inner;
    private final int maxTries;
    private final Backoff backoff;

    @Override
    public Result call(Request req) throws Exception {
        Request keyed = req.idempotencyKey() != null ? req
                                                      : req.withIdempotencyKey(UUID.randomUUID().toString());
        Throwable last = null;
        for (int i = 0; i < maxTries; i++) {
            try { return inner.call(keyed); }
            catch (TransientException e) {
                last = e;
                if (i < maxTries - 1) Thread.sleep(backoff.delay(i));
            }
        }
        throw new RetriesExhaustedException(last);
    }
}
```

---

## Task 5: Circuit breaker decorator

**Brief.** A simple circuit breaker: opens after N consecutive failures; rejects calls until cooldown elapses; half-open after cooldown to test recovery.

### Solution (Go)

```go
type State int
const (
    Closed State = iota
    Open
    HalfOpen
)

type CircuitBreaker struct {
    inner       Service
    threshold   int
    cooldown    time.Duration
    failures    int
    openedAt    time.Time
    state       State
    mu          sync.Mutex
}

func (cb *CircuitBreaker) Call(ctx context.Context, req Request) (Result, error) {
    cb.mu.Lock()
    if cb.state == Open {
        if time.Since(cb.openedAt) > cb.cooldown {
            cb.state = HalfOpen
        } else {
            cb.mu.Unlock()
            return Result{}, errors.New("circuit open")
        }
    }
    cb.mu.Unlock()

    r, err := cb.inner.Call(ctx, req)

    cb.mu.Lock()
    defer cb.mu.Unlock()
    if err != nil {
        cb.failures++
        if cb.failures >= cb.threshold {
            cb.state = Open
            cb.openedAt = time.Now()
        }
    } else {
        cb.failures = 0
        cb.state = Closed
    }
    return r, err
}
```

---

## Task 6: Rate limiter decorator

**Brief.** Token bucket: allow N permits/second; block until permit available.

### Solution (Java, simplified)

```java
public class RateLimitedService implements Service {
    private final Service inner;
    private final RateLimiter limiter;   // e.g., Guava RateLimiter

    public RateLimitedService(Service inner, double permitsPerSecond) {
        this.inner = inner;
        this.limiter = RateLimiter.create(permitsPerSecond);
    }

    @Override
    public Result call(Request req) {
        limiter.acquire();
        return inner.call(req);
    }
}
```

---

## Task 7: Stream pipeline (compress + buffer + write)

**Brief.** Java-style decorated streams.

### Solution (Java)

```java
try (var out = new ObjectOutputStream(
                  new GZIPOutputStream(
                      new BufferedOutputStream(
                          new FileOutputStream("snapshot.gz"))))) {
    out.writeObject(snapshot);
}
```

Each layer adds behavior. Reading reverses: `ObjectInputStream(GZIPInputStream(BufferedInputStream(FileInputStream)))`.

---

## Task 8: Conditional decoration by config

**Brief.** Build a service stack based on a config object; some decorators are off in dev.

### Solution (Python)

```python
def maybe(d, condition, **kwargs):
    return d if not condition else lambda inner: d(inner, **kwargs)

def build_processor(cfg):
    p = StripeProcessor(cfg.stripe_client)
    if cfg.retry_enabled:
        p = RetryProcessor(p, max_tries=cfg.max_tries)
    if cfg.cb_enabled:
        p = CircuitBreaker(p, threshold=5, cooldown=30)
    p = MetricsProcessor(p, cfg.metrics)   # always on
    return p
```

---

## Task 9: Trace context propagation

**Brief.** A decorator that creates a span and propagates context.

### Solution (Go)

```go
type tracedService struct {
    inner  Service
    tracer Tracer
    name   string
}

func (t *tracedService) Call(ctx context.Context, req Request) (Result, error) {
    span, ctx := t.tracer.StartSpan(ctx, t.name)
    defer span.End()

    r, err := t.inner.Call(ctx, req)

    if err != nil {
        span.SetStatus(codes.Error, err.Error())
    }
    return r, err
}
```

---

## Task 10: Refactor inline logging into Decorator

**Brief.** Take this class with embedded logging:

```java
public class UserService {
    private final UserRepo repo;
    private final Logger log;

    public User get(String id) {
        log.info("get({})", id);
        try {
            User u = repo.get(id);
            log.info("got user {}", u.email());
            return u;
        } catch (Exception e) {
            log.error("failed", e);
            throw e;
        }
    }
}
```

Refactor logging into a Decorator.

### Solution

```java
public class UserService {
    private final UserRepo repo;
    public User get(String id) { return repo.get(id); }   // pure
}

public class LoggingUserService implements UserService {
    private final UserService inner;
    private final Logger log;

    public User get(String id) {
        log.info("get({})", id);
        try {
            User u = inner.get(id);
            log.info("got user {}", u.email());
            return u;
        } catch (Exception e) {
            log.error("failed", e);
            throw e;
        }
    }
}

UserService svc = new LoggingUserService(new RealUserService(repo), logger);
```

`UserService` is single-responsibility; logging lives in its own class.

---

## How to Practice

1. **Try each task.** Don't peek until you have something working.
2. **Stack the decorators.** Don't just write one — stack 2-3 to feel the composition.
3. **Test in isolation.** Each decorator gets its own unit test against a fake inner.
4. **Test the order.** Build two stacks with reversed orderings; show different behavior.
5. **Add idempotency** to retry tasks. Pass and assert the key.
6. **Profile a deep stack.** 5 trivial layers under load — measure overhead.
7. **Refactor real code.** Find a class with embedded cross-cutting concerns; extract one decorator at a time.

---

← Back to Decorator folder · [↑ Structural Patterns](../README.md) · [↑↑ Roadmap Home](../../../README.md)

**Next:** [Decorator — Find the Bug](find-bug.md)
