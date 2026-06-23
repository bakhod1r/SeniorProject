# Singleton — Optimize

> **Source:** [refactoring.guru/design-patterns/singleton](https://refactoring.guru/design-patterns/singleton)
> **Format:** Slow / inefficient implementations + benchmarks + optimized version + tradeoffs.

Each exercise: take a working but slow Singleton, profile or reason about why it's slow, optimize, and measure the win.

---

## Table of Contents

1. [Optimization 1: Replace synchronized lazy with lazy holder](#optimization-1-replace-synchronized-lazy-with-lazy-holder)
2. [Optimization 2: Replace mutex with sync.Once](#optimization-2-replace-mutex-with-synconce)
3. [Optimization 3: Recreating value inside Once](#optimization-3-recreating-value-inside-once)
4. [Optimization 4: Bound an unbounded cache](#optimization-4-bound-an-unbounded-cache)
5. [Optimization 5: Sharded singleton for hot reads](#optimization-5-sharded-singleton-for-hot-reads)
6. [Optimization 6: Eager init slowing startup](#optimization-6-eager-init-slowing-startup)
7. [Optimization 7: Async logger to remove serialization](#optimization-7-async-logger-to-remove-serialization)
8. [Optimization 8: Trim the singleton's deep object graph](#optimization-8-trim-the-singletons-deep-object-graph)
9. [Optimization 9: Defer expensive Python module init](#optimization-9-defer-expensive-python-module-init)
10. [Optimization 10: Per-context state instead of mutated singleton](#optimization-10-per-context-state-instead-of-mutated-singleton)

All benchmarks below come from a 2024 Apple M2 Pro, single-threaded unless noted.

---

## Optimization 1: Replace synchronized lazy with lazy holder

### Slow code (Java)

```java
public final class Logger {
    private static Logger INSTANCE;
    private Logger() {}
    public static synchronized Logger getInstance() {  // BOTTLENECK
        if (INSTANCE == null) INSTANCE = new Logger();
        return INSTANCE;
    }
    public void log(String msg) { /* ... */ }
}
```

### Benchmark (JMH, 8 threads)

```
Benchmark                     Mode  Cnt   Score   Error  Units
LoggerSync.getInstance       thrpt   10  29.8M  ±  0.4M  ops/s
```

Throughput plateaus at single-thread speed because every read takes the lock.

### Optimized — Lazy Holder

```java
public final class Logger {
    private Logger() {}
    private static class Holder { static final Logger INSTANCE = new Logger(); }
    public static Logger getInstance() { return Holder.INSTANCE; }
    public void log(String msg) { /* ... */ }
}
```

### Benchmark after

```
LoggerHolder.getInstance     thrpt   10  4500M  ±  20M  ops/s
```

**150× speedup.** The hot path is now a single `getstatic` instruction; after JIT, it's effectively constant-folded.

### Tradeoff

- Lazy Holder is correct, simple, fast.
- The class can't easily be subclassed for testing — use interface + DI if mocking is needed.
- For a *replaceable* singleton (test scenarios), expose a `__reset()` for tests or use enum + factory.

---

## Optimization 2: Replace mutex with sync.Once

### Slow code (Go)

```go
var (
    instance *Service
    mu       sync.Mutex
)

func Get() *Service {
    mu.Lock(); defer mu.Unlock()
    if instance == nil {
        instance = &Service{}
    }
    return instance
}
```

### Benchmark

```go
func BenchmarkMutexLazy(b *testing.B) {
    for i := 0; i < b.N; i++ { _ = Get() }
}
```

```
BenchmarkMutexLazy-8     100000000     11.0 ns/op
```

### Optimized — `sync.Once`

```go
var (
    instance *Service
    once     sync.Once
)

func Get() *Service {
    once.Do(func() { instance = &Service{} })
    return instance
}
```

### Benchmark after

```
BenchmarkOnce-8     500000000      2.3 ns/op
```

**~5× speedup.** Hot path is a single atomic load — no mutex contention.

### Tradeoff

`sync.Once` is the idiomatic Go pattern. No real tradeoff vs the mutex approach for this use case — strictly better.

---

## Optimization 3: Recreating value inside Once

### Slow / buggy code (Go)

```go
var (
    instance *Service
    once     sync.Once
)

func InitWithConfig(cfg Config) *Service {
    once.Do(func() {
        instance = buildService(cfg)
    })
    return buildService(cfg)   // BUG/SLOW: build every call
}
```

### Symptom

Every call to `InitWithConfig` allocates a new `Service` and discards it (returning the freshly built one instead of the cached `instance`). 100× slower than expected.

### Benchmark

```
BenchmarkBadInit-8     1000000     1500 ns/op    (allocates per call)
```

### Optimized

```go
func Get(cfg Config) *Service {
    once.Do(func() { instance = buildService(cfg) })
    return instance
}
```

### Benchmark after

```
BenchmarkGet-8     500000000     2.3 ns/op    0 allocs/op
```

**~650× speedup.** And no allocations.

### Lesson

Subtle bug: returning `buildService(cfg)` instead of `instance`. Code review catches this; benchmarks make it screaming-obvious.

---

## Optimization 4: Bound an unbounded cache

### Slow code (Python)

```python
class Cache:
    _instance = None
    @classmethod
    def get(cls):
        if cls._instance is None: cls._instance = cls()
        return cls._instance
    def __init__(self): self.data = {}
    def set(self, key, value): self.data[key] = value
    def lookup(self, key): return self.data.get(key)
```

### Symptoms

After running the application for hours, RSS grows from 200 MB to 8 GB. `tracemalloc` shows millions of entries in `Cache.data`.

```python
# tracemalloc snapshot
[<frame at cache.py:8 (set)>]   12.5 GiB
```

### Optimized — Bounded LRU + TTL

```python
from cachetools import TTLCache

cache = TTLCache(maxsize=10_000, ttl=300)
```

### Memory after

RSS stable at ~250 MB regardless of runtime.

### Benchmark (set/lookup)

| | Naive `dict` | `TTLCache` |
|---|---|---|
| `set` | ~150 ns | ~700 ns |
| `lookup` (hit) | ~80 ns | ~300 ns |

`TTLCache` is slower per op but bounded — the *real* tradeoff is between op cost and memory growth. For long-running services, bounded almost always wins.

### Tradeoff

- 4× slower per operation.
- 30× less memory in steady state.
- Eviction may evict hot entries — tune `maxsize` based on working set.

---

## Optimization 5: Sharded singleton for hot reads

### Slow code (Go)

```go
var (
    instance *Cache
    once     sync.Once
)

type Cache struct {
    mu sync.RWMutex
    m  map[string]string
}

func Get() *Cache {
    once.Do(func() { instance = &Cache{m: map[string]string{}} })
    return instance
}

func (c *Cache) Lookup(k string) string {
    c.mu.RLock(); defer c.mu.RUnlock()
    return c.m[k]
}

func (c *Cache) Set(k, v string) {
    c.mu.Lock(); defer c.mu.Unlock()
    c.m[k] = v
}
```

### Symptoms

Under 64 concurrent goroutines doing reads, throughput plateaus around 30 M ops/s. `pprof` shows 60% time in `RWMutex.RLock`.

### Optimized — Sharded

```go
const shardCount = 32

type Cache struct {
    shards [shardCount]struct {
        mu sync.RWMutex
        m  map[string]string
    }
}

func newCache() *Cache {
    c := &Cache{}
    for i := range c.shards {
        c.shards[i].m = map[string]string{}
    }
    return c
}

var (
    instance *Cache
    once     sync.Once
)

func Get() *Cache { once.Do(func() { instance = newCache() }); return instance }

func (c *Cache) Lookup(k string) string {
    s := &c.shards[fnv32(k)%shardCount]
    s.mu.RLock(); defer s.mu.RUnlock()
    return s.m[k]
}

func (c *Cache) Set(k, v string) {
    s := &c.shards[fnv32(k)%shardCount]
    s.mu.Lock(); defer s.mu.Unlock()
    s.m[k] = v
}

func fnv32(s string) uint32 {
    h := uint32(2166136261)
    for i := 0; i < len(s); i++ { h ^= uint32(s[i]); h *= 16777619 }
    return h
}
```

### Benchmark (64 goroutines)

| Implementation | Throughput | Lock time |
|---|---|---|
| Single RWMutex | 30 M ops/s | 60% |
| 32 shards | 850 M ops/s | <5% |

**~28× speedup.** Most goroutines now contend on different mutexes.

### Tradeoff

- Memory: N hash maps instead of 1 — slight overhead.
- Iteration order: harder to enumerate all keys consistently.
- Hash function: must be fast and well-distributed.

---

## Optimization 6: Eager init slowing startup

### Slow code (Java)

```java
public final class Reports {
    private static final Reports INSTANCE = new Reports();
    private final ExpensiveCache cache;
    private Reports() { this.cache = ExpensiveCache.preload(); }   // 800 ms
    public static Reports getInstance() { return INSTANCE; }
}
```

### Symptom

App startup takes 1.2 s, mostly in `Reports`'s static init. The `Reports` feature is used by only 5% of users.

### Optimized — Lazy holder

```java
public final class Reports {
    private final ExpensiveCache cache;
    private Reports() { this.cache = ExpensiveCache.preload(); }
    private static class Holder { static final Reports INSTANCE = new Reports(); }
    public static Reports getInstance() { return Holder.INSTANCE; }
}
```

### Result

- Startup: 400 ms (3× faster).
- First call to `Reports.getInstance()` for users who use it: +800 ms.
- 95% of users who never call it: pay nothing.

### Tradeoff

Faster startup vs. higher first-call latency for the feature. Worth it when:
- Most users don't use the feature.
- Or, the cold path is acceptable.

If even the first call must be fast, run `Reports.getInstance()` in a background thread shortly after startup (warmup).

---

## Optimization 7: Async logger to remove serialization

### Slow code (Go)

```go
type Logger struct{ mu sync.Mutex; out io.Writer }

func (l *Logger) Log(msg string) {
    l.mu.Lock(); defer l.mu.Unlock()
    fmt.Fprintln(l.out, msg)   // syscall under the lock
}
```

### Symptom

100 concurrent goroutines logging 1 KB each → ~5 µs per log on average. Lock-and-syscall serializes all calls.

### Optimized — Async logger

```go
type Logger struct {
    ch chan string
}

func newLogger(out io.Writer) *Logger {
    l := &Logger{ch: make(chan string, 1024)}
    go func() {
        bw := bufio.NewWriter(out)
        ticker := time.NewTicker(50 * time.Millisecond)
        defer bw.Flush()
        for {
            select {
            case msg := <-l.ch:
                bw.WriteString(msg); bw.WriteByte('\n')
            case <-ticker.C:
                bw.Flush()
            }
        }
    }()
    return l
}

func (l *Logger) Log(msg string) { l.ch <- msg }
```

### Benchmark

| | Sync | Async |
|---|---|---|
| 100 goroutines × 1k logs | 500 ms | 30 ms |
| Per-log latency at producer | 5 µs | 50 ns |

**~17× speedup at the call site.** Producers don't wait for I/O.

### Tradeoff

- Logs may be lost on `SIGKILL` — they're in the buffer.
- Need explicit shutdown flush.
- Buffered I/O delays log visibility by ~50 ms.

For most production logging, this is acceptable. For audit logs that *must* persist, keep them sync (or use durable log shipping).

---

## Optimization 8: Trim the singleton's deep object graph

### Slow code

```java
public final class Settings {
    private static final Settings INSTANCE = new Settings();
    private final List<UserSession> activeSessions = new ArrayList<>();   // BUG: grows forever
    private final Map<String, byte[]> attachmentCache = new HashMap<>();  // BUG: grows forever

    public static Settings getInstance() { return INSTANCE; }
    // ...
}
```

### Symptom

Heap dumps show the singleton retaining 500 MB after 1 day of operation. GC pauses grow from 50 ms to 500 ms because the old generation is full of singleton-rooted objects.

### Optimized

```java
public final class Settings {
    private static final Settings INSTANCE = new Settings();

    // Bounded: only the 100 most recent sessions
    private final EvictingQueue<UserSession> activeSessions = EvictingQueue.create(100);

    // Bounded with LRU eviction + TTL
    private final Cache<String, byte[]> attachmentCache = Caffeine.newBuilder()
        .maximumSize(50)
        .expireAfterAccess(Duration.ofMinutes(10))
        .build();
}
```

### Result

- Old gen size: stable at 50 MB.
- GC pauses: 50 ms.

### Lesson

Singletons are GC roots. Anything they reference, **anything**, becomes effectively immortal. If a collection grows unbounded inside a singleton, it's a memory leak with extra steps. **Audit collections inside singletons** for: `add`/`put` without `remove`/`evict`.

---

## Optimization 9: Defer expensive Python module init

### Slow code

```python
# heavy.py
import time
time.sleep(0.5)   # simulate expensive setup
data = {i: f"value-{i}" for i in range(1_000_000)}
```

### Symptom

`from heavy import data` adds 500 ms + 60 MB to every process that imports it, even if `data` is never used.

### Optimized — Lazy property

```python
# heavy.py
class _Lazy:
    _data = None
    @property
    def data(self):
        if self._data is None:
            time.sleep(0.5)
            self._data = {i: f"value-{i}" for i in range(1_000_000)}
        return self._data

heavy = _Lazy()
```

Callers use `heavy.data`. The expensive initialization runs only on first access.

### Result

- Import time: 50 ms (10× faster).
- Memory before first access: 0 MB.
- First access after import: 500 ms (same total cost, just deferred).

### Tradeoff

- First access becomes slower (cold start).
- `heavy.data` becomes a property call instead of a plain attribute (negligible).

Useful when: many modules import `heavy`, few of them use `data`.

---

## Optimization 10: Per-context state instead of mutated singleton

### Slow / wrong code (Python)

```python
class RequestContext:
    _instance = None
    @classmethod
    def get(cls):
        if cls._instance is None: cls._instance = cls()
        return cls._instance
    def __init__(self): self.user = None; self.tenant = None
```

```python
# in middleware
RequestContext.get().user = parse_user(req)
RequestContext.get().tenant = parse_tenant(req)

# in handler
user = RequestContext.get().user
```

### Symptom

Under concurrent requests, user A's context is visible to user B. Subtle bugs: requests see wrong user identity. Security leak.

The "Singleton" was hijacked to hold per-request state — but it's process-wide.

### Optimized — Context-local

**Python (using `contextvars`):**

```python
from contextvars import ContextVar

_user: ContextVar = ContextVar("user", default=None)
_tenant: ContextVar = ContextVar("tenant", default=None)

class RequestContext:
    @staticmethod
    def set_user(u): _user.set(u)
    @staticmethod
    def user(): return _user.get()
    @staticmethod
    def set_tenant(t): _tenant.set(t)
    @staticmethod
    def tenant(): return _tenant.get()
```

`contextvars` are scoped per asyncio task / per-thread (in WSGI). Each request gets its own state.

**Go (using `context.Context`):**

```go
type ctxKey int
const (
    userKey ctxKey = iota
    tenantKey
)

func WithUser(ctx context.Context, u User) context.Context {
    return context.WithValue(ctx, userKey, u)
}

func User(ctx context.Context) User {
    return ctx.Value(userKey).(User)
}
```

Pass `ctx` through every function call. The Go convention is "context as first parameter."

**Java (using `ThreadLocal`):**

```java
public final class RequestContext {
    private static final ThreadLocal<User> USER = new ThreadLocal<>();
    public static void setUser(User u) { USER.set(u); }
    public static User user() { return USER.get(); }
}
```

In a servlet filter:

```java
RequestContext.setUser(parseUser(req));
try { chain.doFilter(...); }
finally { USER.remove(); }   // critical — clear on response
```

### Result

- No cross-request contamination.
- Each request has its own state, isolated by language-level mechanisms.
- Slightly more boilerplate (context passing) — worth it for correctness.

### Lesson

The Singleton is a fixed-cardinality construct: **exactly one**. The moment you find yourself wanting "one *per request*" or "one *per session*," you have outgrown Singleton. Use:

- `contextvars` (Python)
- `context.Context` (Go)
- `ThreadLocal` (Java) — careful with thread pools, always `remove()`
- DI container with request scope (Spring `@RequestScope`)

This is the most expensive Singleton anti-pattern in real production systems — a security bug waiting to happen.

---

## Optimization Tips

### How to find singleton bottlenecks

1. **Profile.** `pprof` (Go), `async-profiler` (Java), `py-spy` (Python).
2. **Look for time in lock methods.** `RWMutex.RLock`, `synchronized`, `Lock.acquire`.
3. **Look for time in `getInstance()`.** Even when correct, it shouldn't be a bottleneck.
4. **Heap dumps.** Singletons retaining lots of memory? Audit their fields.
5. **GC logs.** Long pauses → check old-gen contents → check singleton-rooted objects.

### Optimization checklist

- [ ] Lock-free hot path (atomic load on the singleton reference)
- [ ] Bounded collections (LRU, TTL, size cap)
- [ ] Lazy init for expensive setup
- [ ] Sharded state for hot mutable singletons
- [ ] Async I/O instead of synchronous, lock-held writes
- [ ] Per-context state separated from process-global state
- [ ] Explicit shutdown / flush

### Anti-optimizations to avoid

- ❌ Premature DCL — use lazy holder or enum.
- ❌ Volatile fields without understanding JMM.
- ❌ Sharding when there's no contention measured.
- ❌ Async logging when sync is fast enough — adds operational complexity.
- ❌ Reactor patterns inside a singleton — singleton's cardinality says "1," reactors say "scale out."

---

← Back to Singleton folder · [↑ Creational Patterns](../README.md) · [↑↑ Roadmap Home](../../../README.md)

**Previous:** [Singleton — Find-Bug](find-bug.md)

---

**Singleton roadmap complete.** All 8 files: [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md) · [interview](interview.md) · [tasks](tasks.md) · [find-bug](find-bug.md) · [optimize](optimize.md).
