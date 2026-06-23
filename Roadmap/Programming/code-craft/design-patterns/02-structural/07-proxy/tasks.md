# Proxy — Hands-On Tasks

> **Source:** [refactoring.guru/design-patterns/proxy](https://refactoring.guru/design-patterns/proxy)

Each task includes a brief and a reference solution. Try first; check after.

---

## Table of Contents

1. [Task 1: Virtual proxy (lazy image loader)](#task-1-virtual-proxy-lazy-image-loader)
2. [Task 2: Caching proxy with TTL](#task-2-caching-proxy-with-ttl)
3. [Task 3: Protection proxy (RBAC)](#task-3-protection-proxy-rbac)
4. [Task 4: Remote proxy (HTTP client)](#task-4-remote-proxy-http-client)
5. [Task 5: Smart reference (refcount)](#task-5-smart-reference-refcount)
6. [Task 6: JDK dynamic proxy](#task-6-jdk-dynamic-proxy)
7. [Task 7: Single-flight caching proxy](#task-7-single-flight-caching-proxy)
8. [Task 8: Lazy init with double-checked locking](#task-8-lazy-init-with-double-checked-locking)
9. [Task 9: Refactor inline auth into Proxy](#task-9-refactor-inline-auth-into-proxy)
10. [Task 10: Stack of proxies (cache + auth + log)](#task-10-stack-of-proxies-cache-auth-log)
11. [How to Practice](#how-to-practice)

---

## Task 1: Virtual proxy (lazy image loader)

**Brief.** An `Image` interface; load from disk only on first display.

### Solution (Go)

```go
type Image interface{ Display() }

type RealImage struct{ filename string }
func NewReal(f string) *RealImage {
    fmt.Printf("loading %s from disk\n", f)
    return &RealImage{filename: f}
}
func (r *RealImage) Display() { fmt.Printf("display %s\n", r.filename) }

type ImageProxy struct {
    filename string
    real     *RealImage
}

func (p *ImageProxy) Display() {
    if p.real == nil { p.real = NewReal(p.filename) }
    p.real.Display()
}
```

---

## Task 2: Caching proxy with TTL

**Brief.** Cache `WeatherService.get_temperature(city)` results for 60 seconds.

### Solution (Python)

```python
import time

class WeatherService:
    def get_temperature(self, city: str) -> float:
        time.sleep(1.0)
        return 22.5

class CachingProxy:
    def __init__(self, inner, ttl: float = 60):
        self._inner = inner
        self._ttl = ttl
        self._cache: dict[str, tuple[float, float]] = {}

    def get_temperature(self, city: str) -> float:
        now = time.monotonic()
        if city in self._cache:
            v, expires = self._cache[city]
            if now < expires: return v
        v = self._inner.get_temperature(city)
        self._cache[city] = (v, now + self._ttl)
        return v
```

---

## Task 3: Protection proxy (RBAC)

**Brief.** Wrap a `Document` so only users with role `editor` can update.

### Solution (Java)

```java
public final class ProtectionProxy implements Document {
    private final Document inner;
    private final User user;

    public ProtectionProxy(Document inner, User user) {
        this.inner = inner;
        this.user = user;
    }

    public String content() { return inner.content(); }

    public void update(String text) {
        if (!user.hasRole("editor")) {
            throw new SecurityException("editor role required");
        }
        inner.update(text);
    }
}
```

---

## Task 4: Remote proxy (HTTP client)

**Brief.** A local-looking `UserService` that calls a REST endpoint.

### Solution (Python)

```python
import requests

class RemoteUserService:
    """Stand-in for UserService running on another server."""
    def __init__(self, base_url: str):
        self._base = base_url
        self._sess = requests.Session()

    def get_user(self, id: str):
        r = self._sess.get(f"{self._base}/users/{id}", timeout=5)
        r.raise_for_status()
        return r.json()

    def create_user(self, name: str, email: str):
        r = self._sess.post(f"{self._base}/users",
                           json={"name": name, "email": email},
                           timeout=5)
        r.raise_for_status()
        return r.json()
```

---

## Task 5: Smart reference (refcount)

**Brief.** A reference-counted pointer; releases the object when the last reference goes away.

### Solution (Go-like, simplified)

```go
type SharedRef[T any] struct {
    real     *T
    refcount *int32
    cleanup  func(*T)
}

func NewShared[T any](real *T, cleanup func(*T)) *SharedRef[T] {
    rc := int32(1)
    return &SharedRef[T]{real: real, refcount: &rc, cleanup: cleanup}
}

func (s *SharedRef[T]) Clone() *SharedRef[T] {
    atomic.AddInt32(s.refcount, 1)
    return &SharedRef[T]{real: s.real, refcount: s.refcount, cleanup: s.cleanup}
}

func (s *SharedRef[T]) Release() {
    if atomic.AddInt32(s.refcount, -1) == 0 {
        s.cleanup(s.real)
    }
}

func (s *SharedRef[T]) Get() *T { return s.real }
```

Standard `unique_ptr` / `shared_ptr` semantics, hand-written.

---

## Task 6: JDK dynamic proxy

**Brief.** Wrap any interface with logging, without writing a per-interface class.

### Solution (Java)

```java
public class LoggingHandler implements InvocationHandler {
    private final Object real;
    public LoggingHandler(Object real) { this.real = real; }

    @Override
    public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
        System.out.println("call " + method.getName());
        try {
            return method.invoke(real, args);
        } catch (InvocationTargetException e) {
            throw e.getCause();
        }
    }
}

@SuppressWarnings("unchecked")
public static <T> T loggingProxy(T real, Class<T> iface) {
    return (T) Proxy.newProxyInstance(
        iface.getClassLoader(),
        new Class<?>[]{iface},
        new LoggingHandler(real));
}

UserService real = new RealUserService();
UserService logged = loggingProxy(real, UserService.class);
logged.getUser("alice");   // logs and forwards
```

---

## Task 7: Single-flight caching proxy

**Brief.** When N concurrent threads miss the cache for the same key, only one calls the inner; others wait.

### Solution (Go)

```go
import "golang.org/x/sync/singleflight"

type SFCachingProxy struct {
    inner Service
    cache sync.Map
    sf    singleflight.Group
}

func (c *SFCachingProxy) Get(key string) (Result, error) {
    if v, ok := c.cache.Load(key); ok { return v.(Result), nil }
    val, err, _ := c.sf.Do(key, func() (any, error) {
        if v, ok := c.cache.Load(key); ok { return v, nil }
        v, err := c.inner.Get(key)
        if err == nil { c.cache.Store(key, v) }
        return v, err
    })
    if err != nil { return Result{}, err }
    return val.(Result), nil
}
```

Test: spawn 100 goroutines hitting the same uncached key; verify the inner is called exactly once.

---

## Task 8: Lazy init with double-checked locking

**Brief.** Thread-safe lazy init in Java without `sync.Once`.

### Solution

```java
public final class LazyServiceProxy implements Service {
    private volatile Service real;
    private final Object lock = new Object();
    private final Supplier<Service> supplier;

    public LazyServiceProxy(Supplier<Service> supplier) { this.supplier = supplier; }

    private Service real() {
        Service r = real;
        if (r == null) {
            synchronized (lock) {
                r = real;
                if (r == null) {
                    r = supplier.get();
                    real = r;
                }
            }
        }
        return r;
    }

    public Result call(Request req) { return real().call(req); }
}
```

---

## Task 9: Refactor inline auth into Proxy

**Brief.** Take this class:

```java
public class DocumentService {
    public String read(String id, User user) {
        if (!user.hasRole("reader")) throw new SecurityException();
        return repo.find(id).content();
    }
    public void write(String id, String text, User user) {
        if (!user.hasRole("editor")) throw new SecurityException();
        repo.find(id).update(text);
    }
}
```

Refactor authorization into a Proxy.

### Solution

```java
public interface DocumentService {
    String read(String id);
    void write(String id, String text);
}

public class RealDocumentService implements DocumentService {
    public String read(String id) { return repo.find(id).content(); }
    public void write(String id, String text) { repo.find(id).update(text); }
}

public class AuthProxy implements DocumentService {
    private final DocumentService inner;
    private final User user;
    public AuthProxy(DocumentService inner, User user) { this.inner = inner; this.user = user; }

    public String read(String id) {
        if (!user.hasRole("reader")) throw new SecurityException();
        return inner.read(id);
    }
    public void write(String id, String text) {
        if (!user.hasRole("editor")) throw new SecurityException();
        inner.write(id, text);
    }
}

DocumentService svc = new AuthProxy(new RealDocumentService(repo), currentUser);
```

`RealDocumentService` is now pure business logic; auth is a separate concern.

---

## Task 10: Stack of proxies (cache + auth + log)

**Brief.** Combine multiple proxies for a service.

### Solution (Python)

```python
class LoggingProxy:
    def __init__(self, inner, name): self._inner, self._name = inner, name
    def call(self, *args, **kw):
        print(f"[{self._name}] call {args}")
        return self._inner.call(*args, **kw)

class AuthProxy:
    def __init__(self, inner, user, role): self._inner, self._user, self._role = inner, user, role
    def call(self, *args, **kw):
        if self._role not in self._user.roles: raise PermissionError()
        return self._inner.call(*args, **kw)

class CachingProxy:
    def __init__(self, inner, ttl): self._inner, self._ttl = inner, ttl; self._cache = {}
    def call(self, key):
        if key in self._cache: return self._cache[key]
        v = self._inner.call(key)
        self._cache[key] = v
        return v

# Stack: log outside auth outside cache outside real.
svc = LoggingProxy(
    AuthProxy(
        CachingProxy(RealService(), ttl=60),
        user=current_user,
        role="user",
    ),
    name="users",
)
```

Order matters: logging outermost catches denied-by-auth attempts; caching innermost means hits skip auth (faster but possibly insecure depending on requirements).

---

## How to Practice

1. **Try each task.** Don't peek before you have something working.
2. **Test thread safety.** For lazy init / caching, run 100 concurrent threads; assert no duplicate work.
3. **Test cache stampede.** Single-flight should call the inner once for N concurrent misses.
4. **Try dynamic proxy.** `Proxy.newProxyInstance` (Java) or `__getattr__` (Python).
5. **Stack proxies in two orders.** Observe how order changes behavior.
6. **Refactor real code.** Find embedded cross-cutting concerns; extract to proxies.
7. **Profile.** A 5-layer proxy chain in a hot loop — is it measurable? Compare to AspectJ.

---

← Back to Proxy folder · [↑ Structural Patterns](../README.md) · [↑↑ Roadmap Home](../../../README.md)

**Next:** [Proxy — Find the Bug](find-bug.md)
