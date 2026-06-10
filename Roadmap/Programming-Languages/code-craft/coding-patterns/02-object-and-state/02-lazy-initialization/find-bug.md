# Lazy Initialization — Find the Bug

> **Category:** [Object & State Patterns](../README.md) — defer creating an expensive value until first use, then cache it.

12 buggy snippets across Go, Java, Python.

---

## Bug 1: Null Marker When the Value Can Be Null (Java)

```java
private User user;          // BUG: lookup may legitimately return null
public User user() {
    if (user == null) user = lookup(id);  // re-runs lookup() forever
    return user;
}
```

**Symptoms:** Every call re-queries when the user doesn't exist. No caching for the null case.

<details><summary>Find the bug</summary>

`null` means both "not computed" and "computed to null." A missing user makes `user` stay `null`, so the guard fires every time.

</details>

### Fix

```java
private User user;
private boolean loaded;
public User user() {
    if (!loaded) { user = lookup(id); loaded = true; }
    return user;
}
```

### Lesson

When the value can legitimately be null/empty, use a separate `loaded` flag (or a sentinel).

---

## Bug 2: Forgot to Cache (Java)

```java
public byte[] thumbnail() {
    return render(path);   // BUG: re-renders every call
}
```

**Symptoms:** Expensive work on every access. CPU profile shows `render` hot.

<details><summary>Find the bug</summary>

No field, no storage. This is just a slow getter, not lazy init.

</details>

### Fix

```java
private byte[] thumbnail;
public byte[] thumbnail() {
    if (thumbnail == null) thumbnail = render(path);
    return thumbnail;
}
```

### Lesson

Lazy init must **store** the result. Computing-on-every-call is not lazy init.

---

## Bug 3: Naive Lazy Singleton Races (Java)

```java
private static Pool instance;
public static Pool getInstance() {
    if (instance == null) instance = new Pool();   // BUG: race
    return instance;
}
```

**Symptoms:** Under load, two `Pool` objects are created; sometimes a thread sees a half-constructed pool.

<details><summary>Find the bug</summary>

Two threads can both pass the `null` check before either assigns. Duplicate construction; and without a barrier, unsafe publication of a half-built object.

</details>

### Fix — holder idiom

```java
private static final class Holder { static final Pool INSTANCE = new Pool(); }
public static Pool getInstance() { return Holder.INSTANCE; }
```

### Lesson

Shared lazy state needs thread safety. The holder idiom is the JVM gold standard.

---

## Bug 4: Double-Checked Locking Without volatile (Java)

```java
private Heavy heavy;        // BUG: not volatile
public Heavy heavy() {
    if (heavy == null) {
        synchronized (this) {
            if (heavy == null) heavy = new Heavy();
        }
    }
    return heavy;
}
```

**Symptoms:** Passes tests; intermittently returns a half-constructed `Heavy` under load.

<details><summary>Find the bug</summary>

The unsynchronized first read has no happens-before edge with the write. The JIT/CPU may publish the reference before the constructor completes; a reader on the fast path sees a non-null but partially-built object.

</details>

### Fix

```java
private volatile Heavy heavy;   // one keyword fixes it
```

### Lesson

DCL is correct **iff** the field is `volatile`. Without it, the pattern is broken — and silently.

---

## Bug 5: Lazy Loading N+1 (Java / JPA)

```java
List<Order> orders = repo.findAll();
long total = 0;
for (Order o : orders) {
    total += o.getItems().stream().mapToLong(LineItem::price).sum(); // BUG: query per order
}
```

**Symptoms:** 1 query for orders + 1 per order. 500 orders → 501 queries; page is slow.

<details><summary>Find the bug</summary>

`getItems()` is a lazy association; touching it in a loop fires a separate `SELECT` each iteration — the N+1 problem.

</details>

### Fix

```java
List<Order> orders = repo.findAllWithItems();  // JOIN FETCH o.items
```

### Lesson

Lazy is the right *default* but the wrong choice on a known iteration path. Eager-fetch (`JOIN FETCH`, `prefetch_related`, `selectinload`).

---

## Bug 6: LazyInitializationException (Java / Hibernate)

```java
@Transactional
Order load(long id) { return repo.find(id); }   // session closes here

// later, outside the transaction
order.getItems().size();   // BUG: throws LazyInitializationException
```

**Symptoms:** `org.hibernate.LazyInitializationException: could not initialize proxy — no Session`.

<details><summary>Find the bug</summary>

The lazy proxy needs a live persistence session to load through. The session closed when the transaction ended; accessing `getItems()` afterward has nothing to query through.

</details>

### Fix

Fetch what you need inside the transaction (eager fetch or map to a DTO/projection before returning):

```java
@Transactional
OrderDto load(long id) {
    Order o = repo.find(id);
    return new OrderDto(o.getId(), o.getItems().size()); // touched while session is open
}
```

### Lesson

Lazy loading hides I/O behind field access. Decide the loading boundary explicitly; don't let a getter cross a closed session.

---

## Bug 7: GIL Assumed to Mean Thread-Safe (Python)

```python
class Cache:
    def __init__(self): self._data = None
    def data(self):
        if self._data is None:        # BUG: not atomic across threads
            self._data = expensive()  # two threads can both run this
        return self._data
```

**Symptoms:** Under threads, `expensive()` runs twice; if it has side effects, they double.

<details><summary>Find the bug</summary>

The check and the assignment span multiple bytecodes. A thread switch between them lets two threads both see `None` and both compute. The GIL does not make multi-step logic atomic.

</details>

### Fix

```python
import threading
class Cache:
    def __init__(self):
        self._lock = threading.Lock(); self._data = None
    def data(self):
        if self._data is None:
            with self._lock:
                if self._data is None:
                    self._data = expensive()
        return self._data
```

### Lesson

The GIL serializes single bytecodes, not your check-then-set. Lock shared lazy init.

---

## Bug 8: cached_property on a __slots__ Class (Python)

```python
import functools
class Point:
    __slots__ = ("x", "y")           # BUG: no __dict__ for the cache
    def __init__(self, x, y): self.x, self.y = x, y

    @functools.cached_property
    def norm(self): return (self.x**2 + self.y**2) ** 0.5

Point(3, 4).norm   # raises TypeError: No '__dict__' attribute ...
```

**Symptoms:** `TypeError: No '__dict__' attribute on 'Point' instance to cache 'norm'`.

<details><summary>Find the bug</summary>

`cached_property` stores its result in the instance `__dict__`, but `__slots__` without `"norm"` (and without `"__dict__"`) removes the dict.

</details>

### Fix

```python
class Point:
    __slots__ = ("x", "y", "norm")   # declare the cached name as a slot
    ...
```

Or drop `__slots__`, or add `"__dict__"` to it.

### Lesson

`cached_property` needs somewhere to write. With `__slots__`, list the cached attribute name.

---

## Bug 9: Caching the Exception Forever (Go)

```go
type Lazy struct {
    once sync.Once
    res  *Resource
    err  error
}
func (l *Lazy) Get() (*Resource, error) {
    l.once.Do(func() { l.res, l.err = dialFlaky() }) // BUG for transient errors
    return l.res, l.err
}
```

**Symptoms:** One transient network blip permanently breaks the resource — every later `Get()` returns the same cached error.

<details><summary>Find the bug</summary>

`sync.Once` runs `f` exactly once. A transient failure is cached and never retried.

</details>

### Fix — retry on failure with a mutex

```go
type Lazy struct {
    mu  sync.Mutex
    res *Resource
}
func (l *Lazy) Get() (*Resource, error) {
    l.mu.Lock(); defer l.mu.Unlock()
    if l.res != nil { return l.res, nil }
    r, err := dialFlaky()
    if err != nil { return nil, err } // not cached → retried next call
    l.res = r
    return r, nil
}
```

### Lesson

`sync.Once` caches failures. For transient errors, use a resettable mutex-guarded init.

---

## Bug 10: Go Closure Captures Loop Variable in Lazy Init (Go)

```go
var inits []func()
for i := 0; i < 3; i++ {
    inits = append(inits, func() { lazyCache[i] = build(i) }) // BUG pre-Go 1.22
}
for _, f := range inits { f() }   // all use i == 3
```

**Symptoms:** All three deferred inits operate on `i == 3` (pre-Go 1.22).

<details><summary>Find the bug</summary>

Before Go 1.22 the loop variable `i` is shared; every closure captures the same `i`, which is `3` after the loop.

</details>

### Fix

```go
for i := 0; i < 3; i++ {
    i := i  // shadow (or upgrade to Go 1.22+, which scopes per-iteration)
    inits = append(inits, func() { lazyCache[i] = build(i) })
}
```

### Lesson

Deferred/lazy closures must capture a per-iteration copy of the loop variable on Go < 1.22.

---

## Bug 11: Lazy Field Mutated Through a Shared Reference (Python)

```python
class Service:
    _DEFAULTS = {}                    # BUG: shared mutable class attribute

    def config(self):
        if not Service._DEFAULTS:
            Service._DEFAULTS = load() # mutates shared dict; all instances/threads see it
        return Service._DEFAULTS
```

**Symptoms:** Two services racing on first call corrupt each other's config; later mutation leaks across instances.

<details><summary>Find the bug</summary>

The lazy value is a *shared, mutable class attribute*. The empty-dict guard also re-runs whenever the loaded config is legitimately empty, and the shared mutability invites cross-instance leaks and races.

</details>

### Fix

```python
import functools
class Service:
    @functools.cached_property
    def config(self):                 # per-instance cache
        return load()
```

### Lesson

Lazy state belongs on the instance (or behind a lock for true singletons), not in a shared mutable class attribute; and use a presence check, not truthiness.

---

## Bug 12: Reentrant Lazy Init Deadlock (Java)

```java
private volatile A a;
public A a() {
    synchronized (this) {
        if (a == null) a = new A(this); // BUG: A's constructor calls a() again
        return a;
    }
}
// A's constructor: this.dep = owner.a();  → re-enters a()
```

**Symptoms:** With a non-reentrant lock it deadlocks; with `synchronized` (reentrant) it returns a *null* `a` to the inner call, then a stack overflow or a partially-wired object.

<details><summary>Find the bug</summary>

The init function reenters the same lazy accessor before the field is assigned. `synchronized` is reentrant so it doesn't deadlock, but the inner `a()` sees `a == null` and recurses / observes incomplete state.

</details>

### Fix

Break the cycle — don't have a lazy value's construction depend on its own accessor. Pass dependencies in, or initialize eagerly:

```java
private final A a = new A(dependencyNotRoutedThroughA());
```

### Lesson

Lazy graphs with cycles deadlock or recurse. Break the dependency cycle or initialize eagerly.

---

## Practice Tips

1. **Run `go test -race`** on every Go lazy accessor.
2. **Write a concurrency stress test:** spawn N threads that all hit first-access simultaneously; assert the init ran exactly once.
3. **Test the null/empty result path** — does the value cache, or recompute?
4. **Test the failure path** — transient error: does it retry or cache?
5. **For ORMs, count queries** in tests to catch N+1; assert the session boundary in integration tests.

---

[← Tasks](tasks.md) · [Object & State](../README.md) · **Next:** [Optimize](optimize.md)
