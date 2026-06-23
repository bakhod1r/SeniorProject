# Lazy Initialization — Practice Tasks

> **Category:** [Object & State Patterns](../README.md) — defer creating an expensive value until first use, then cache it.

10 practice tasks with full Go, Java, Python solutions.

---

## Table of Contents

1. [Task 1: Lazy Getter with a Null Marker](#task-1-lazy-getter-with-a-null-marker)
2. [Task 2: Lazy Getter When the Value Can Be Null](#task-2-lazy-getter-when-the-value-can-be-null)
3. [Task 3: Reusable Lazy Value Holder](#task-3-reusable-lazy-value-holder)
4. [Task 4: Thread-Safe Lazy Singleton](#task-4-thread-safe-lazy-singleton)
5. [Task 5: sync.Once Accessor in Go](#task-5-synconce-accessor-in-go)
6. [Task 6: cached_property in Python](#task-6-cached_property-in-python)
7. [Task 7: Double-Checked Locking Done Right](#task-7-double-checked-locking-done-right)
8. [Task 8: Lazy Init with Error Caching](#task-8-lazy-init-with-error-caching)
9. [Task 9: Virtual Proxy](#task-9-virtual-proxy)
10. [Task 10: Refactor Eager → Lazy Without Touching Callers](#task-10-refactor-eager--lazy-without-touching-callers)

---

## Task 1: Lazy Getter with a Null Marker

**Goal:** Render a thumbnail only on first access.

### Java

```java
public final class Image {
    private final String path;
    private byte[] thumbnail;        // null = not rendered

    public Image(String path) { this.path = path; }

    public byte[] thumbnail() {
        if (thumbnail == null) thumbnail = render(path);
        return thumbnail;
    }
    private static byte[] render(String p) { return new byte[]{1, 2, 3}; }
}
```

### Python

```python
class Image:
    def __init__(self, path: str) -> None:
        self.path = path
        self._thumbnail: bytes | None = None

    def thumbnail(self) -> bytes:
        if self._thumbnail is None:
            self._thumbnail = self._render()
        return self._thumbnail

    def _render(self) -> bytes:
        return b"\x01\x02\x03"
```

### Go

```go
type Image struct {
    path      string
    thumbnail []byte // nil = not rendered (single-threaded only!)
}

func (im *Image) Thumbnail() []byte {
    if im.thumbnail == nil {
        im.thumbnail = render(im.path)
    }
    return im.thumbnail
}
func render(p string) []byte { return []byte{1, 2, 3} }
```

> Single-threaded only. For concurrent use, see Task 5.

---

## Task 2: Lazy Getter When the Value Can Be Null

**Goal:** Cache a lookup whose result may legitimately be `null`/`None`. Use a flag.

### Java

```java
public final class UserCache {
    private final int id;
    private User user;          // may be null even when loaded
    private boolean loaded;

    public UserCache(int id) { this.id = id; }

    public User user() {
        if (!loaded) { user = lookup(id); loaded = true; }
        return user;            // returns null without re-querying
    }
    private static User lookup(int id) { return null; }
}
```

### Python

```python
_SENTINEL = object()

class UserCache:
    def __init__(self, uid: int) -> None:
        self.uid = uid
        self._user = _SENTINEL          # sentinel, not None

    def user(self):
        if self._user is _SENTINEL:
            self._user = self._lookup()
        return self._user               # may be None, computed once
    def _lookup(self): return None
```

---

## Task 3: Reusable Lazy Value Holder

**Goal:** Wrap any deferred computation in a generic holder.

### Java

```java
import java.util.function.Supplier;

public final class Lazy<T> {
    private final Supplier<T> supplier;
    private T value;
    private boolean computed;

    public Lazy(Supplier<T> s) { this.supplier = s; }

    public T get() {
        if (!computed) { value = supplier.get(); computed = true; }
        return value;
    }
}

// Usage
Lazy<Config> cfg = new Lazy<>(() -> parseConfig());
cfg.get(); // parses once
```

### Python

```python
from typing import Callable, Generic, TypeVar
T = TypeVar("T")
_MISSING = object()

class Lazy(Generic[T]):
    def __init__(self, factory: Callable[[], T]) -> None:
        self._factory = factory
        self._value: object = _MISSING

    def get(self) -> T:
        if self._value is _MISSING:
            self._value = self._factory()
        return self._value  # type: ignore[return-value]
```

### Go

```go
type Lazy[T any] struct {
    once  sync.Once
    val   T
    init  func() T
}

func NewLazy[T any](f func() T) *Lazy[T] { return &Lazy[T]{init: f} }
func (l *Lazy[T]) Get() T {
    l.once.Do(func() { l.val = l.init() })
    return l.val
}
```

---

## Task 4: Thread-Safe Lazy Singleton

**Goal:** One instance, built on first use, safe under concurrency. Use the holder idiom in Java.

### Java (holder idiom — preferred)

```java
public final class Registry {
    private Registry() { /* expensive */ }

    private static final class Holder {
        static final Registry INSTANCE = new Registry();
    }
    public static Registry getInstance() { return Holder.INSTANCE; }
}
```

### Python (module-level — preferred)

```python
# registry.py — built once, on first import, thread-safely
class _Registry: ...
REGISTRY = _Registry()
```

### Go (sync.Once)

```go
var (
    registryOnce sync.Once
    registry     *Registry
)
func GetRegistry() *Registry {
    registryOnce.Do(func() { registry = newRegistry() })
    return registry
}
```

---

## Task 5: sync.Once Accessor in Go

**Goal:** Lazily dial a connection, safe for all goroutines, caching the error.

### Go

```go
type Service struct {
    addr string
    once sync.Once
    conn *Conn
    err  error
}

func (s *Service) Conn() (*Conn, error) {
    s.once.Do(func() { s.conn, s.err = dial(s.addr) })
    return s.conn, s.err
}
func dial(addr string) (*Conn, error) { return &Conn{}, nil }
type Conn struct{}
```

> `sync.OnceValue` (Go 1.21+) is cleaner when there's no error:
> ```go
> var loadConfig = sync.OnceValue(parseConfig)
> ```

---

## Task 6: cached_property in Python

**Goal:** A computed attribute that runs once.

### Python

```python
import functools

class Report:
    def __init__(self, rows: list[int]) -> None:
        self.rows = rows

    @functools.cached_property
    def total(self) -> int:
        return sum(self.rows)        # computed once, then stored in __dict__

r = Report([1, 2, 3])
r.total   # 6, computed
r.total   # 6, cached (no recompute)
del r.__dict__["total"]   # invalidate if needed
```

> With `__slots__`, declare the cached name as a slot or `cached_property` fails.

---

## Task 7: Double-Checked Locking Done Right

**Goal:** Per-instance lazy field, lock only on first init, then lock-free reads.

### Java (volatile DCL)

```java
public final class HeavyHolder {
    private volatile Heavy heavy;   // volatile is mandatory

    public Heavy heavy() {
        Heavy local = heavy;        // read volatile once
        if (local == null) {
            synchronized (this) {
                local = heavy;
                if (local == null) {
                    local = new Heavy();
                    heavy = local;  // publish via volatile write
                }
            }
        }
        return local;
    }
}
```

### Python (lock + DCL)

```python
import threading

class HeavyHolder:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._heavy = None

    def heavy(self):
        if self._heavy is None:           # fast path, no lock
            with self._lock:
                if self._heavy is None:   # re-check under lock
                    self._heavy = Heavy()
        return self._heavy
```

---

## Task 8: Lazy Init with Error Caching

**Goal:** If init fails, decide whether to retry or fail-fast forever.

### Java (retry on failure — no caching of the error)

```java
public final class RetryingLazy {
    private volatile Resource resource;

    public Resource get() throws IOException {
        Resource local = resource;
        if (local == null) {
            synchronized (this) {
                if (resource == null) {
                    resource = open();   // throws on failure → field stays null → retried
                }
                local = resource;
            }
        }
        return local;
    }
    private Resource open() throws IOException { return new Resource(); }
}
```

### Go (cache the error — fail fast forever)

```go
type CachingLazy struct {
    once sync.Once
    res  *Resource
    err  error
}
func (c *CachingLazy) Get() (*Resource, error) {
    c.once.Do(func() { c.res, c.err = open() }) // error cached; never retried
    return c.res, c.err
}
```

> Pick deliberately: retry for transient failures, cache for permanent ones.

---

## Task 9: Virtual Proxy

**Goal:** A stand-in that defers loading the real object until a method is called.

### Java

```java
interface Image { void render(); }

final class RealImage implements Image {
    RealImage(String path) { loadFromDisk(path); }   // expensive
    public void render() { /* draw */ }
    private void loadFromDisk(String p) { /* slow */ }
}

final class ProxyImage implements Image {
    private final String path;
    private RealImage real;
    ProxyImage(String path) { this.path = path; }     // cheap
    public void render() {
        if (real == null) real = new RealImage(path); // load on first render
        real.render();
    }
}
```

### Python

```python
class RealImage:
    def __init__(self, path: str) -> None:
        self._load(path)          # expensive
    def render(self) -> None: ...
    def _load(self, p: str) -> None: ...

class ProxyImage:
    def __init__(self, path: str) -> None:
        self.path = path
        self._real: RealImage | None = None
    def render(self) -> None:
        if self._real is None:
            self._real = RealImage(self.path)
        self._real.render()
```

---

## Task 10: Refactor Eager → Lazy Without Touching Callers

**Goal:** An eager field becomes lazy; no call site changes because reads already go through an accessor.

### Java — Before (eager)

```java
public final class SearchService {
    private final Index index = buildIndex();   // slow, in constructor
    public List<Doc> search(String q) { return index.find(q); }
}
```

### Java — After (lazy, self-encapsulated)

```java
public final class SearchService {
    private volatile Index index;               // built on first search

    private Index index() {
        Index local = index;
        if (local == null) {
            synchronized (this) {
                local = index;
                if (local == null) index = local = buildIndex();
            }
        }
        return local;
    }
    public List<Doc> search(String q) { return index().find(q); } // unchanged signature
}
```

### Python — Before / After

```python
# Before
class SearchService:
    def __init__(self) -> None:
        self._index = build_index()      # eager
    def search(self, q): return self._index.find(q)

# After
class SearchService:
    @functools.cached_property
    def _index(self):                    # built on first search, cached
        return build_index()
    def search(self, q): return self._index.find(q)  # call site unchanged
```

---

## Practice Tips

1. **Use a flag (or sentinel) when the value can be null/empty.**
2. **For shared state, make it thread-safe:** holder idiom (JVM static), `volatile` DCL (per-instance), `sync.Once` (Go), `Lock` (Python).
3. **Decide your failure policy** (retry vs cache) explicitly and test it.
4. **Keep the accessor signature identical to a plain getter** so laziness stays invisible.
5. **Run `go test -race`** on Go lazy code; write a concurrent test that hammers first access from N threads.

---

[← Interview](interview.md) · [Object & State](../README.md) · **Next:** [Find-Bug](find-bug.md)
