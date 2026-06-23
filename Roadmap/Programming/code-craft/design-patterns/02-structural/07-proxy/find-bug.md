# Proxy — Find the Bug

> **Source:** [refactoring.guru/design-patterns/proxy](https://refactoring.guru/design-patterns/proxy)

Each section presents a Proxy that *looks* fine but is broken. Find the bug yourself, then check.

---

## Table of Contents

1. [Bug 1: Non-thread-safe lazy init](#bug-1-non-thread-safe-lazy-init)
2. [Bug 2: Volatile missing in DCL](#bug-2-volatile-missing-in-dcl)
3. [Bug 3: Cache stampede](#bug-3-cache-stampede)
4. [Bug 4: Cache never invalidated](#bug-4-cache-never-invalidated)
5. [Bug 5: Spring AOP self-invocation](#bug-5-spring-aop-self-invocation)
6. [Bug 6: Protection proxy doesn't check on read](#bug-6-protection-proxy-doesnt-check-on-read)
7. [Bug 7: Remote proxy without timeout](#bug-7-remote-proxy-without-timeout)
8. [Bug 8: Exception type leaks across proxy](#bug-8-exception-type-leaks-across-proxy)
9. [Bug 9: Returning a proxy where caller expected real subject](#bug-9-returning-a-proxy-where-caller-expected-real-subject)
10. [Bug 10: Smart-pointer double release](#bug-10-smart-pointer-double-release)
11. [Bug 11: Cache holds stale data after write](#bug-11-cache-holds-stale-data-after-write)
12. [Bug 12: Dynamic proxy doesn't intercept dunder methods (Python)](#bug-12-dynamic-proxy-doesnt-intercept-dunder-methods-python)
13. [Practice Tips](#practice-tips)

---

## Bug 1: Non-thread-safe lazy init

```java
public final class LazyProxy implements Service {
    private Service real;
    private final Supplier<Service> supplier;

    public Service real() {
        if (real == null) {
            real = supplier.get();   // race
        }
        return real;
    }

    public Result call(Request req) { return real().call(req); }
}
```

Under concurrent load, sometimes the supplier is called twice. Sometimes `call` operates on a half-constructed instance.

<details><summary>Reveal</summary>

**Bug:** No synchronization. Two threads can both see `real == null` and both invoke `supplier.get()`. Worse, without `volatile`, the second thread can see a partially-constructed `real` (memory reorder).

**Fix:** double-checked locking with volatile.

```java
private volatile Service real;
private final Object lock = new Object();

public Service real() {
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
```

**Lesson:** Lazy init in concurrent code requires explicit synchronization. The compiler won't save you.

</details>

---

## Bug 2: Volatile missing in DCL

```java
private Service real;       // not volatile

public Service real() {
    if (real == null) {
        synchronized (lock) {
            if (real == null) real = new Service(...);
        }
    }
    return real;
}
```

The supplier is called once correctly. But intermittent `NullPointerException`s appear in production.

<details><summary>Reveal</summary>

**Bug:** Without `volatile`, the JVM can reorder operations. A reader can observe `real != null` but the constructor assignments haven't propagated yet — leading to a partially-constructed object.

**Fix:** add `volatile`.

```java
private volatile Service real;
```

**Lesson:** Double-checked locking without `volatile` was famously broken in Java 1.4. Java 5+ requires `volatile` for safe publication.

</details>

---

## Bug 3: Cache stampede

```python
class CachingProxy:
    def get(self, key):
        if key in self._cache: return self._cache[key]
        v = self._inner.get(key)   # 100 threads can all reach here
        self._cache[key] = v
        return v
```

Backend is overloaded after a cache flush; 100 concurrent users requesting the same key cause 100 backend hits.

<details><summary>Reveal</summary>

**Bug:** No protection against concurrent misses. All threads trigger the inner call simultaneously.

**Fix:** single-flight or lock per key.

```python
import threading

class CachingProxy:
    def __init__(self, inner):
        self._inner = inner
        self._cache = {}
        self._inflight = {}
        self._lock = threading.Lock()

    def get(self, key):
        with self._lock:
            if key in self._cache: return self._cache[key]
            if key in self._inflight:
                event = self._inflight[key]
            else:
                event = threading.Event()
                self._inflight[key] = event
                # this thread is the leader

        if event in self._inflight.values():
            # leader: do the work
            v = self._inner.get(key)
            with self._lock:
                self._cache[key] = v
                del self._inflight[key]
            event.set()
            return v
        else:
            event.wait()
            return self._cache[key]
```

Or use a `cachetools` / `cachebox` library that handles this.

**Lesson:** Caching proxies in concurrent code need single-flight to avoid stampede.

</details>

---

## Bug 4: Cache never invalidated

```python
class CachingProxy:
    def get(self, key): return self._cache.setdefault(key, self._inner.get(key))
    def update(self, key, value): return self._inner.update(key, value)   # no eviction!
```

Test: `proxy.update("alice", "new")` then `proxy.get("alice")` returns the *old* value.

<details><summary>Reveal</summary>

**Bug:** `update` doesn't evict the cache. The cache holds stale data forever.

**Fix:** evict on writes.

```python
def update(self, key, value):
    self._inner.update(key, value)
    self._cache.pop(key, None)
```

**Lesson:** Caching proxies must intercept writes too — otherwise reads serve stale data.

</details>

---

## Bug 5: Spring AOP self-invocation

```java
@Service
public class UserService {
    @Transactional
    public void registerWithVerify(User u) {
        save(u);
        verify(u);                  // calls saveAuditLog inside
    }

    @Transactional(propagation = REQUIRES_NEW)
    public void verify(User u) {
        saveAuditLog(u);
    }
}
```

When `registerWithVerify` is called, `verify`'s `REQUIRES_NEW` doesn't take effect — both run in the same transaction.

<details><summary>Reveal</summary>

**Bug:** Self-invocation in Spring AOP. `this.verify(u)` bypasses the proxy; the `@Transactional(propagation = REQUIRES_NEW)` is ignored.

**Fix:** inject self via `ApplicationContext` (workaround), or split `verify` into a separate bean, or use AspectJ.

```java
@Autowired
private UserService self;   // proxy reference

public void registerWithVerify(User u) {
    save(u);
    self.verify(u);   // through proxy
}
```

Or restructure:

```java
@Service
public class UserVerificationService {
    @Transactional(propagation = REQUIRES_NEW)
    public void verify(User u) { saveAuditLog(u); }
}
```

**Lesson:** Spring AOP doesn't proxy in-class calls. Aware engineers structure code to avoid the trap.

</details>

---

## Bug 6: Protection proxy doesn't check on read

```java
public class ProtectionProxy implements Document {
    public String content() { return inner.content(); }   // ← anyone reads
    public void update(String text) {
        if (!user.hasRole("editor")) throw new SecurityException();
        inner.update(text);
    }
}
```

A confidential document is leaked to all users because the proxy didn't check read access.

<details><summary>Reveal</summary>

**Bug:** Read access wasn't gated. The proxy assumed reads were always public.

**Fix:** gate reads too if the requirement is read access control.

```java
public String content() {
    if (!user.hasRole("reader")) throw new SecurityException();
    return inner.content();
}
```

**Lesson:** Verify the access policy explicitly. "Anyone can read" should be a deliberate decision, not an oversight.

</details>

---

## Bug 7: Remote proxy without timeout

```python
class RemoteUserService:
    def get_user(self, id: str):
        r = self._sess.get(f"{self._base}/users/{id}")   # no timeout
        return r.json()
```

The remote service hangs; the calling thread waits forever; under load, every thread parks.

<details><summary>Reveal</summary>

**Bug:** No timeout. A hung remote service kills the calling service.

**Fix:** always set timeouts.

```python
r = self._sess.get(f"{self._base}/users/{id}", timeout=5)
```

**Lesson:** Every remote call needs an explicit timeout. "Default forever" is choosing failure.

</details>

---

## Bug 8: Exception type leaks across proxy

```java
public class StripePaymentProxy implements PaymentService {
    public Receipt charge(...) {
        return stripeClient.charges().create(...);
        // throws StripeException — vendor type
    }
}
```

Callers wrote `catch (StripeException ...)`. Migration to Adyen requires touching every catch block.

<details><summary>Reveal</summary>

**Bug:** Vendor exception leaks past the proxy. Callers depend on Stripe's type.

**Fix:** translate at the proxy boundary.

```java
public Receipt charge(...) throws PaymentException {
    try {
        return stripeClient.charges().create(...);
    } catch (StripeException e) {
        throw new PaymentException(e);
    }
}
```

**Lesson:** Proxies that wrap third-party services should translate exceptions to domain types — preserves substitutability.

</details>

---

## Bug 9: Returning a proxy where caller expected real subject

```java
@Repository
public class UserRepo {
    public User findById(String id) { return em.find(User.class, id); }  // returns Hibernate proxy
}

User u = repo.findById("alice");
if (u instanceof RealUser real) {                  // false! it's a proxy class
    ...
}
```

The `instanceof` check fails because Hibernate returned a generated proxy class, not `RealUser`.

<details><summary>Reveal</summary>

**Bug:** Caller expected the real class. The ORM's proxy class isn't `RealUser`; type-based branching breaks.

**Fix:** don't type-check across proxy boundaries. Use behavior (interfaces) or `Hibernate.unproxy(u)` to get the real instance.

```java
User u = (User) Hibernate.unproxy(repo.findById("alice"));
```

Or restructure to not depend on concrete types.

**Lesson:** Proxies break `instanceof` and reflection checks. Avoid relying on concrete types when proxies may be involved.

</details>

---

## Bug 10: Smart-pointer double release

```cpp
class SharedRef {
    T* raw;
    int* count;
    ~SharedRef() {
        if (--(*count) == 0) delete raw;
    }
};

SharedRef a(new T());
SharedRef b = a;   // shallow copy: b shares raw and count
// destructors fire: a decrements, b decrements, both reach 0
```

A copy constructor is missing; the default copies pointers without incrementing refcount. Double-free crashes the program.

<details><summary>Reveal</summary>

**Bug:** No proper copy constructor. Both `a` and `b` think they own the resource; both delete.

**Fix:** implement copy constructor that increments refcount.

```cpp
SharedRef(const SharedRef& other) : raw(other.raw), count(other.count) {
    ++(*count);
}

SharedRef& operator=(const SharedRef& other) {
    if (this != &other) {
        if (--(*count) == 0) { delete raw; delete count; }
        raw = other.raw;
        count = other.count;
        ++(*count);
    }
    return *this;
}
```

(Or use `std::shared_ptr`.)

**Lesson:** Smart references need careful copy/move semantics. Refcount must be atomic in multi-threaded contexts.

</details>

---

## Bug 11: Cache holds stale data after write

```java
public class CachingUserProxy implements UserRepository {
    public User find(String id) {
        return cache.computeIfAbsent(id, k -> inner.find(k));
    }

    public void save(User u) {
        inner.save(u);   // forgot to invalidate cache!
    }
}

repo.find("alice");          // caches alice v1
repo.save(alice.withEmail("new"));  // saves to DB; cache untouched
repo.find("alice");          // returns cached alice v1 (old email)
```

<details><summary>Reveal</summary>

**Bug:** Writes don't invalidate the cache. Subsequent reads return stale data.

**Fix:** evict on writes.

```java
public void save(User u) {
    inner.save(u);
    cache.remove(u.getId());
}
```

Or write-through:

```java
public void save(User u) {
    inner.save(u);
    cache.put(u.getId(), u);   // update cache with new value
}
```

**Lesson:** Caching proxies that intercept reads must also intercept writes — to invalidate or update.

</details>

---

## Bug 12: Dynamic proxy doesn't intercept dunder methods (Python)

```python
class Proxy:
    def __init__(self, inner):
        self._inner = inner
    def __getattr__(self, name):
        return getattr(self._inner, name)


real = Number(5)
proxy = Proxy(real)
print(real + 3)        # works (Number defines __add__)
print(proxy + 3)       # TypeError: unsupported operand
```

<details><summary>Reveal</summary>

**Bug:** Python's special method lookup bypasses `__getattr__`. `proxy + 3` looks up `Proxy.__add__` (not defined); it doesn't fall back to `__getattr__`.

**Fix:** explicitly define dunder methods that forward.

```python
class Proxy:
    def __init__(self, inner): self._inner = inner
    def __getattr__(self, name): return getattr(self._inner, name)
    def __add__(self, other): return self._inner + other
    def __eq__(self, other): return self._inner == other
    # ... and so on for each dunder you need
```

**Lesson:** `__getattr__` doesn't handle dunders. Dynamic proxies in Python need explicit dunder forwarding.

</details>

---

## Practice Tips

- Read each snippet, **stop**, predict the failure mode.
- For each bug, ask: "what's the worst production outcome?" Many proxy bugs are silent (stale cache, missing auth, lazy init race).
- After fixing, write a test that *would have caught* the bug. If it's awkward, the fix is incomplete.
- Repeat in a week. Proxy bugs cluster: thread safety, cache invalidation, exception handling, identity.

---

← Back to Proxy folder · [↑ Structural Patterns](../README.md) · [↑↑ Roadmap Home](../../../README.md)

**Next:** [Proxy — Optimize](optimize.md)
