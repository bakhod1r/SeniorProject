# Singleton — Hands-On Tasks

> **Source:** [refactoring.guru/design-patterns/singleton](https://refactoring.guru/design-patterns/singleton)
> **Format:** Practical exercises with full solutions in Go, Java, Python.

Each task includes the problem statement, constraints, test cases, full solutions in all three languages, and discussion of tradeoffs.

---

## Table of Contents

1. [Task 1: Basic Logger Singleton](#task-1-basic-logger-singleton)
2. [Task 2: Thread-Safe Lazy Counter](#task-2-thread-safe-lazy-counter)
3. [Task 3: Configuration Manager](#task-3-configuration-manager)
4. [Task 4: Connection Pool Singleton](#task-4-connection-pool-singleton)
5. [Task 5: Singleton with Initialization Parameters](#task-5-singleton-with-initialization-parameters)
6. [Task 6: Resettable Singleton for Tests](#task-6-resettable-singleton-for-tests)
7. [Task 7: Singleton with Mutable State (Cache)](#task-7-singleton-with-mutable-state-cache)
8. [Task 8: Multiton — One per Key](#task-8-multiton-one-per-key)
9. [Task 9: Serialization-Safe Singleton (Java)](#task-9-serialization-safe-singleton-java)
10. [Task 10: Refactor Singleton to DI](#task-10-refactor-singleton-to-di)

---

## Task 1: Basic Logger Singleton

### Statement

Implement a `Logger` Singleton that:
- Has a method `log(level, message)` printing `[LEVEL] message` to stdout.
- Returns the same instance from every call to `getInstance()` (or equivalent).
- Has a private constructor.

### Constraints

- Single-threaded is fine.
- No locks needed.

### Test cases

```
GetLogger() == GetLogger()  // true
log("INFO", "hello")         // prints "[INFO] hello"
```

### Solution — Go

```go
package logger

import "fmt"

type Logger struct{}

var instance = &Logger{}

func Get() *Logger { return instance }

func (l *Logger) Log(level, msg string) {
    fmt.Printf("[%s] %s\n", level, msg)
}
```

### Solution — Java

```java
public final class Logger {
    private static final Logger INSTANCE = new Logger();
    private Logger() {}
    public static Logger getInstance() { return INSTANCE; }
    public void log(String level, String msg) {
        System.out.printf("[%s] %s%n", level, msg);
    }
}
```

### Solution — Python

```python
# logger.py
class Logger:
    def log(self, level: str, msg: str) -> None:
        print(f"[{level}] {msg}")

# Module-level singleton.
logger = Logger()
```

### Discussion

Eager initialization is the simplest correct Singleton. No locks, no races. The cost (always allocating the instance even if unused) is negligible for a logger.

---

## Task 2: Thread-Safe Lazy Counter

### Statement

Implement a `Counter` Singleton with:
- `Increment()` — atomic increment.
- `Get()` — returns current value.

The counter must be created lazily (on first call) and remain thread-safe under heavy concurrent access.

### Constraints

- Must pass `go test -race` / equivalent.
- Reads should be lock-free.

### Test

```go
// 1000 goroutines, each incrementing 1000 times → final value = 1_000_000
```

### Solution — Go

```go
package counter

import (
    "sync"
    "sync/atomic"
)

type Counter struct {
    n atomic.Int64
}

var (
    instance *Counter
    once     sync.Once
)

func Get() *Counter {
    once.Do(func() { instance = &Counter{} })
    return instance
}

func (c *Counter) Increment() { c.n.Add(1) }
func (c *Counter) Value() int64 { return c.n.Load() }
```

### Solution — Java

```java
import java.util.concurrent.atomic.AtomicLong;

public final class Counter {
    private final AtomicLong n = new AtomicLong();
    private Counter() {}

    private static class Holder { static final Counter INSTANCE = new Counter(); }
    public static Counter getInstance() { return Holder.INSTANCE; }

    public void increment() { n.incrementAndGet(); }
    public long value() { return n.get(); }
}
```

### Solution — Python

```python
import threading

class Counter:
    _instance = None
    _lock = threading.Lock()
    _ctr_lock = threading.Lock()

    def __init__(self):
        self._n = 0

    @classmethod
    def get(cls) -> "Counter":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    def increment(self) -> None:
        with self._ctr_lock:
            self._n += 1

    def value(self) -> int:
        return self._n
```

### Discussion

- Go: `sync.Once` for init + `atomic.Int64` for the counter — fully lock-free reads.
- Java: lazy holder + `AtomicLong` — same properties.
- Python: must lock the increment because `_n += 1` is multi-bytecode and not GIL-atomic.

---

## Task 3: Configuration Manager

### Statement

A `Config` Singleton that loads `config.json` once at startup and exposes typed accessors:
- `GetString(key) string`
- `GetInt(key) int`
- `GetBool(key) bool`

Loading errors should be reported, not silently ignored.

### Constraints

- Loading happens lazily on first access.
- All subsequent accesses are read-only.

### Solution — Go

```go
package config

import (
    "encoding/json"
    "fmt"
    "os"
    "sync"
)

type Config struct {
    data map[string]any
}

var (
    instance *Config
    loadErr  error
    once     sync.Once
)

func Load() (*Config, error) {
    once.Do(func() {
        f, err := os.Open(os.Getenv("CONFIG_PATH"))
        if err != nil { loadErr = err; return }
        defer f.Close()
        var data map[string]any
        if err := json.NewDecoder(f).Decode(&data); err != nil {
            loadErr = err; return
        }
        instance = &Config{data: data}
    })
    return instance, loadErr
}

func (c *Config) GetString(key string) string {
    s, _ := c.data[key].(string); return s
}

func (c *Config) GetInt(key string) int {
    f, _ := c.data[key].(float64); return int(f)
}

func (c *Config) GetBool(key string) bool {
    b, _ := c.data[key].(bool); return b
}
```

### Solution — Java

```java
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;

public final class Config {
    private final Map<String, Object> data;
    private Config() throws Exception {
        ObjectMapper m = new ObjectMapper();
        this.data = m.readValue(Files.readAllBytes(Path.of(System.getenv("CONFIG_PATH"))), Map.class);
    }

    private static class Holder {
        static final Config INSTANCE;
        static {
            try { INSTANCE = new Config(); }
            catch (Exception e) { throw new ExceptionInInitializerError(e); }
        }
    }
    public static Config getInstance() { return Holder.INSTANCE; }

    public String getString(String k) { return (String) data.get(k); }
    public int getInt(String k) { return ((Number) data.get(k)).intValue(); }
    public boolean getBool(String k) { return (Boolean) data.get(k); }
}
```

### Solution — Python

```python
# app/config.py
import json
import os
from typing import Any

class Config:
    def __init__(self) -> None:
        with open(os.environ["CONFIG_PATH"]) as f:
            self._data: dict[str, Any] = json.load(f)

    def get_string(self, key: str) -> str: return str(self._data[key])
    def get_int(self, key: str) -> int: return int(self._data[key])
    def get_bool(self, key: str) -> bool: return bool(self._data[key])

# Module-level singleton.
config = Config()
```

### Discussion

The Java version captures load errors in `ExceptionInInitializerError` — once thrown, the class is permanently un-loadable. Acceptable for fatal config errors. Go captures the error so callers can report it without panic.

---

## Task 4: Connection Pool Singleton

### Statement

A `DBPool` Singleton wrapping a database connection pool. Must:
- Initialize lazily on first `Borrow()`.
- Provide `Borrow()` and `Return(conn)` (or use a `defer`/try-with-resources pattern).
- Provide `Close()` for graceful shutdown.

### Solution — Go (using `database/sql`)

```go
package db

import (
    "database/sql"
    "os"
    "sync"
    _ "github.com/jackc/pgx/v5/stdlib"
)

var (
    instance *sql.DB
    once     sync.Once
)

func Pool() *sql.DB {
    once.Do(func() {
        db, err := sql.Open("pgx", os.Getenv("DB_URL"))
        if err != nil { panic(err) }
        db.SetMaxOpenConns(20)
        instance = db
    })
    return instance
}

func Close() error {
    if instance == nil { return nil }
    return instance.Close()
}
```

### Solution — Java (HikariCP)

```java
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import java.sql.Connection;
import java.sql.SQLException;

public final class DbPool {
    private final HikariDataSource ds;
    private DbPool() {
        HikariConfig cfg = new HikariConfig();
        cfg.setJdbcUrl(System.getenv("DB_URL"));
        cfg.setMaximumPoolSize(20);
        ds = new HikariDataSource(cfg);
    }
    private static class Holder { static final DbPool INSTANCE = new DbPool(); }
    public static DbPool get() { return Holder.INSTANCE; }
    public Connection borrow() throws SQLException { return ds.getConnection(); }
    public void close() { ds.close(); }
}
```

### Solution — Python (SQLAlchemy)

```python
# db.py
import os
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine

engine: Engine = create_engine(
    os.environ["DB_URL"],
    pool_size=20,
    max_overflow=10,
)
```

### Discussion

In all three languages, the underlying driver already implements pooling — the Singleton just exposes the one shared pool. Closing on shutdown is critical to release DB-side resources.

---

## Task 5: Singleton with Initialization Parameters

### Statement

A `Service` Singleton that needs configuration on first creation (e.g., an API key). Subsequent calls should return the existing instance — but how do we handle multiple `Init()` calls with **different** parameters?

### Constraints

- First `Init(key)` succeeds.
- Subsequent `Init(differentKey)` should error or be ignored.
- `Get()` after `Init` returns the configured instance.

### Solution — Go

```go
package service

import (
    "errors"
    "sync"
)

type Service struct{ apiKey string }

var (
    instance *Service
    once     sync.Once
    initOK   bool
)

func Init(apiKey string) error {
    var initErr error
    once.Do(func() {
        if apiKey == "" { initErr = errors.New("apiKey required"); return }
        instance = &Service{apiKey: apiKey}
        initOK = true
    })
    if !initOK && initErr == nil {
        return errors.New("service already initialized")
    }
    return initErr
}

func Get() (*Service, error) {
    if instance == nil { return nil, errors.New("service not initialized") }
    return instance, nil
}
```

### Solution — Java

```java
public final class Service {
    private static volatile Service INSTANCE;
    private final String apiKey;
    private Service(String apiKey) { this.apiKey = apiKey; }

    public static synchronized void init(String apiKey) {
        if (INSTANCE != null) throw new IllegalStateException("already init");
        if (apiKey == null || apiKey.isEmpty()) throw new IllegalArgumentException("apiKey");
        INSTANCE = new Service(apiKey);
    }

    public static Service get() {
        Service s = INSTANCE;
        if (s == null) throw new IllegalStateException("call init() first");
        return s;
    }
}
```

### Solution — Python

```python
class Service:
    _instance: "Service | None" = None

    def __init__(self, api_key: str) -> None:
        if not api_key:
            raise ValueError("api_key required")
        self.api_key = api_key

    @classmethod
    def init(cls, api_key: str) -> None:
        if cls._instance is not None:
            raise RuntimeError("Service already initialized")
        cls._instance = cls(api_key)

    @classmethod
    def get(cls) -> "Service":
        if cls._instance is None:
            raise RuntimeError("call init() first")
        return cls._instance
```

### Discussion

This is "explicit two-phase init" — separating construction from initialization. Useful when configuration must be loaded before any access. Pitfall: forgetting to call `Init()` causes runtime errors at first access. Mitigation: do it as the first thing in `main`/`__main__`.

---

## Task 6: Resettable Singleton for Tests

### Statement

Add a `__reset()` method to a Singleton, callable only from test code. The method clears the instance so the next `getInstance()` returns a fresh one.

### Solution — Go

```go
package counter

// Production code: same as Task 2

// In counter_internal_test.go (note: same package, _test.go file):
package counter

func resetForTest() {
    once = sync.Once{}
    instance = nil
}
```

Used in `_test.go`:

```go
func TestCounter_FreshState(t *testing.T) {
    t.Cleanup(resetForTest)
    c := Get()
    c.Increment()
    if c.Value() != 1 { t.Fatal("expected 1") }
}
```

### Solution — Java (with @VisibleForTesting)

```java
import com.google.common.annotations.VisibleForTesting;

public final class Counter {
    private static volatile Counter INSTANCE;
    private long n = 0;

    public static synchronized Counter getInstance() {
        if (INSTANCE == null) INSTANCE = new Counter();
        return INSTANCE;
    }

    public synchronized void increment() { n++; }
    public synchronized long value() { return n; }

    @VisibleForTesting
    static synchronized void __reset() { INSTANCE = null; }
}
```

### Solution — Python

```python
# counter.py
class Counter:
    _instance = None
    def __init__(self): self.n = 0
    @classmethod
    def get(cls):
        if cls._instance is None: cls._instance = cls()
        return cls._instance
    @classmethod
    def _reset_for_test(cls): cls._instance = None
```

In tests (pytest):

```python
@pytest.fixture(autouse=True)
def reset_counter():
    yield
    Counter._reset_for_test()
```

### Discussion

`reset()` is a **pragmatic** solution. The principled fix is DI — but `reset()` is acceptable while migrating, especially in test-only contexts. Always document its test-only nature.

---

## Task 7: Singleton with Mutable State (Cache)

### Statement

An `ApiCache` Singleton with `Get(key)` and `Set(key, value, ttl)`. Must:
- Be thread-safe.
- Support TTL expiry.
- Bound size (LRU eviction at 1000 entries).

### Solution — Go

```go
package cache

import (
    "container/list"
    "sync"
    "time"
)

type entry struct {
    key   string
    value any
    exp   time.Time
}

type Cache struct {
    mu    sync.Mutex
    m     map[string]*list.Element
    ll    *list.List
    cap   int
}

var (
    instance *Cache
    once     sync.Once
)

func Get() *Cache {
    once.Do(func() {
        instance = &Cache{m: map[string]*list.Element{}, ll: list.New(), cap: 1000}
    })
    return instance
}

func (c *Cache) Set(k string, v any, ttl time.Duration) {
    c.mu.Lock(); defer c.mu.Unlock()
    if e, ok := c.m[k]; ok {
        e.Value.(*entry).value = v
        e.Value.(*entry).exp = time.Now().Add(ttl)
        c.ll.MoveToFront(e)
        return
    }
    e := c.ll.PushFront(&entry{k, v, time.Now().Add(ttl)})
    c.m[k] = e
    if c.ll.Len() > c.cap {
        old := c.ll.Back()
        c.ll.Remove(old)
        delete(c.m, old.Value.(*entry).key)
    }
}

func (c *Cache) Lookup(k string) (any, bool) {
    c.mu.Lock(); defer c.mu.Unlock()
    e, ok := c.m[k]
    if !ok { return nil, false }
    en := e.Value.(*entry)
    if time.Now().After(en.exp) {
        c.ll.Remove(e); delete(c.m, k); return nil, false
    }
    c.ll.MoveToFront(e)
    return en.value, true
}
```

### Solution — Java (using Caffeine — battle-tested)

```java
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import java.time.Duration;

public final class ApiCache {
    private final Cache<String, Object> cache = Caffeine.newBuilder()
        .maximumSize(1000)
        .expireAfterWrite(Duration.ofMinutes(5))
        .build();

    private static class Holder { static final ApiCache INSTANCE = new ApiCache(); }
    public static ApiCache get() { return Holder.INSTANCE; }

    public Object lookup(String key) { return cache.getIfPresent(key); }
    public void set(String key, Object value) { cache.put(key, value); }
}
```

### Solution — Python (using `cachetools`)

```python
# api_cache.py
from cachetools import TTLCache

cache = TTLCache(maxsize=1000, ttl=300)
```

### Discussion

Mutable Singleton state is the most common source of test pollution. Solutions:

1. **Use a battle-tested library** (Caffeine, cachetools) instead of rolling your own.
2. **Provide a `clear()`** method for tests.
3. **Move to DI** if the project is large — pass the cache around explicitly.

---

## Task 8: Multiton — One per Key

### Statement

A `RegionPool` registry where `RegionPool.Get(region)` returns one `Pool` per region (`us-east`, `eu-west`, etc.). Pools are lazy and shared.

### Solution — Go

```go
package regionpool

import (
    "sync"
)

type Pool struct{ region string }

func (p *Pool) Region() string { return p.region }

var (
    pools = map[string]*Pool{}
    mu    sync.RWMutex
)

func Get(region string) *Pool {
    mu.RLock()
    if p, ok := pools[region]; ok { mu.RUnlock(); return p }
    mu.RUnlock()

    mu.Lock(); defer mu.Unlock()
    if p, ok := pools[region]; ok { return p }
    p := &Pool{region: region}
    pools[region] = p
    return p
}
```

### Solution — Java

```java
import java.util.concurrent.ConcurrentHashMap;

public final class RegionPool {
    private static final ConcurrentHashMap<String, RegionPool> INSTANCES = new ConcurrentHashMap<>();
    private final String region;
    private RegionPool(String r) { this.region = r; }

    public static RegionPool get(String region) {
        return INSTANCES.computeIfAbsent(region, RegionPool::new);
    }

    public String region() { return region; }
}
```

### Solution — Python

```python
import threading

class RegionPool:
    _instances: dict[str, "RegionPool"] = {}
    _lock = threading.Lock()

    def __init__(self, region: str): self.region = region

    @classmethod
    def get(cls, region: str) -> "RegionPool":
        if region in cls._instances: return cls._instances[region]
        with cls._lock:
            if region not in cls._instances:
                cls._instances[region] = cls(region)
            return cls._instances[region]
```

### Discussion

Java's `ConcurrentHashMap.computeIfAbsent` is the cleanest expression. Go's read-then-write-with-recheck is the idiomatic pattern. Python uses double-checked locking with the GIL providing partial protection.

**Watch:** unbounded growth. Consider an LRU bound or eviction if region count is unbounded.

---

## Task 9: Serialization-Safe Singleton (Java)

### Statement

A `Java Singleton` that implements `Serializable`. Without protection, deserialization creates a new instance, breaking the singleton guarantee. Make it serialization-safe.

### Solution — Approach 1: `readResolve`

```java
import java.io.*;

public final class Logger implements Serializable {
    private static final long serialVersionUID = 1L;
    private static final Logger INSTANCE = new Logger();
    private Logger() {}
    public static Logger getInstance() { return INSTANCE; }

    /** Called by Java serialization — returns the canonical instance. */
    private Object readResolve() { return INSTANCE; }
}
```

Test:

```java
ByteArrayOutputStream bos = new ByteArrayOutputStream();
new ObjectOutputStream(bos).writeObject(Logger.getInstance());
Logger deserialized = (Logger) new ObjectInputStream(new ByteArrayInputStream(bos.toByteArray())).readObject();
assert deserialized == Logger.getInstance();   // true thanks to readResolve
```

### Solution — Approach 2: Enum (preferred)

```java
public enum Logger {
    INSTANCE;
    public void log(String msg) { /* ... */ }
}
```

Default enum serialization preserves identity by name — no `readResolve` needed.

### Discussion

For Java code that must implement `Serializable`, prefer enum. If enum is impossible (need to extend a class, or for legacy compat), implement `readResolve`. Forgetting this method silently breaks the singleton property — a notorious Java interview gotcha.

---

## Task 10: Refactor Singleton to DI

### Statement

Given this legacy code:

```java
class UserService {
    public void create(String name) {
        Logger.getInstance().info("creating " + name);
        Database.getInstance().insert("INSERT ...", name);
    }
}
```

Refactor to dependency injection without breaking existing callers.

### Solution

```java
// Step 1 — extract interfaces
interface ILogger { void info(String msg); }
interface IDatabase { void insert(String sql, Object... args); }

class Logger implements ILogger { ... }   // existing
class Database implements IDatabase { ... }   // existing

// Step 2 — refactor UserService
class UserService {
    private final ILogger log;
    private final IDatabase db;

    /** Default constructor — uses singletons. Legacy callers continue to work. */
    public UserService() { this(Logger.getInstance(), Database.getInstance()); }

    /** Test/explicit constructor — injects dependencies. */
    public UserService(ILogger log, IDatabase db) {
        this.log = log;
        this.db  = db;
    }

    public void create(String name) {
        log.info("creating " + name);
        db.insert("INSERT INTO users(name) VALUES (?)", name);
    }
}
```

Now you can write tests:

```java
@Test
void create_logsAndInserts() {
    ILogger mockLog = mock(ILogger.class);
    IDatabase mockDb = mock(IDatabase.class);

    new UserService(mockLog, mockDb).create("Alice");

    verify(mockLog).info("creating Alice");
    verify(mockDb).insert(eq("INSERT INTO users(name) VALUES (?)"), eq("Alice"));
}
```

After all callers migrate to passing dependencies, remove the no-arg constructor.

### Discussion

The trick is the **two-constructor** transition: legacy code keeps working, new code uses DI, tests are immediately enabled. Once migration is complete, remove the legacy path. This pattern (sometimes called "poor man's DI") avoids a full DI container migration and is the lowest-friction path off Singleton.

---

## How to Practice

1. **Pick one task per language per day.** Don't rush all three at once.
2. **Type the code yourself.** Don't copy-paste — muscle memory matters.
3. **Run the tests under `-race` (Go) or with multi-threaded JUnit / pytest-xdist.**
4. **Profile.** Run a benchmark, check `pprof`/`async-profiler`/`cProfile` output.
5. **Reverse-engineer:** look at how popular libraries implement Singleton (`net/http.DefaultClient`, Spring's `@Singleton`, Django's settings).

---

← Back to Singleton folder · [↑ Creational Patterns](../README.md) · [↑↑ Roadmap Home](../../../README.md)

**Previous:** [Singleton — Interview](interview.md) | **Next:** [Singleton — Find-Bug](find-bug.md)
