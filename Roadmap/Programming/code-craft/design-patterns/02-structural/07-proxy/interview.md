# Proxy — Interview Preparation

> **Source:** [refactoring.guru/design-patterns/proxy](https://refactoring.guru/design-patterns/proxy)

---

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional Questions](#professional-questions)
5. [Coding Tasks](#coding-tasks)
6. [Trick Questions](#trick-questions)
7. [Behavioral / Architectural Questions](#behavioral-architectural-questions)
8. [Tips for Answering](#tips-for-answering)

---

## Junior Questions

### Q1. What is the Proxy pattern?

**A.** A structural pattern that provides a substitute for another object to **control access** to it. The proxy implements the same interface as the real subject; it can decide whether, when, and how the real subject handles a request.

### Q2. Name the common kinds of Proxy.

**A.** **Virtual** (lazy init), **Protection** (security), **Caching** (memoize), **Remote** (RPC), **Smart Reference** (lifecycle / refcount).

### Q3. What's the difference between Proxy and Decorator?

**A.** Same shape — both wrap an object with the same interface. Different intent: Proxy *controls access* (may not forward); Decorator *adds behavior* (always forwards).

### Q4. Give a real-world example.

**A.** Hibernate lazy-loaded entities, gRPC client stubs, Spring's `@Cacheable`, `@Transactional`, JDK dynamic proxies, Mockito mocks, smart pointers in C++.

### Q5. Why does the proxy implement the same interface as the real subject?

**A.** So callers can use the proxy interchangeably — polymorphism keeps the API uniform. Proxy is invisible to callers.

### Q6. When would you use a virtual proxy?

**A.** When the real subject is expensive to construct and not always needed. Loading a 4K image, opening a DB connection, instantiating a heavy object — defer until first use.

### Q7. What's the difference between Proxy and Adapter?

**A.** Adapter changes the interface to fit a different expected one. Proxy preserves the interface and controls access.

### Q8. What's the difference between Proxy and Facade?

**A.** Facade simplifies a *subsystem* (many classes) behind one entry. Proxy stands in for *one* object.

### Q9. When should you NOT use Proxy?

**A.** When you want to add behavior, not control access (Decorator). When the real subject is cheap and always used (no proxy benefit). When you'd hide bugs.

### Q10. What's a dynamic proxy?

**A.** A proxy generated at runtime, not hand-written. Java's `Proxy.newProxyInstance` (JDK), cglib (subclass-based), Python's `__getattr__`. Frameworks like Spring AOP and Mockito use them.

---

## Middle Questions

### Q11. Why is thread safety important in a virtual proxy?

**A.** Two threads can simultaneously see `real == null` and both construct, wasting work or producing inconsistent state. Use double-checked locking, `sync.Once` (Go), or `Lazy<T>` (.NET).

### Q12. What's a cache stampede?

**A.** Many concurrent threads miss the cache for the same key; all trigger the underlying call. The single-call savings turn into N calls. Solutions: single-flight (Go), Caffeine's `getAll`, lock keyed by request.

### Q13. How does Spring's `@Cacheable` work?

**A.** Spring generates a runtime proxy (JDK Proxy or cglib) wrapping the bean. On method invocation, the proxy consults the cache. Cache hit → method skipped. Cache miss → method runs, result cached.

### Q14. What's the self-invocation problem in Spring AOP?

**A.** Calling `this.method()` from inside the same bean bypasses the proxy. So `@Transactional` on `methodB` won't trigger if called from `methodA` of the same class. Workarounds: inject self, restructure across beans, or use AspectJ.

### Q15. How would you implement a TTL-based caching proxy?

**A.** Map of key → (value, expiry). On `get`: check cache; if not expired, return. Else, call real subject; store result with `now + TTL`. Thread-safe map; consider single-flight for stampede.

### Q16. How does ORM lazy loading use Proxy?

**A.** Hibernate generates proxy entities. Accessing a relationship (`user.getOrders()`) triggers a SQL query the first time; subsequent accesses return the loaded list. Proxy looks like the entity; defers DB hits.

### Q17. What's a remote proxy?

**A.** A local stand-in for an object running on another process or machine. Looks like a local call; underneath it serializes, sends over the network, receives, deserializes. gRPC stubs, Java RMI, AWS SDK clients.

### Q18. How do you handle exceptions in a proxy?

**A.** Match the inner's exception types as much as possible — callers should be unaware of the proxy. Add new exception types (e.g., `SecurityException` from a protection proxy) only when access control demands it; document.

### Q19. What's the difference between JDK dynamic proxy and cglib?

**A.** JDK Proxy works only with **interfaces** (creates a class implementing them). Cglib creates a **subclass** of a concrete class. Spring uses JDK for interfaces, cglib for concrete classes.

### Q20. How do you test a proxy?

**A.** Mock the real subject. Assert the proxy's specific behavior (cache hits don't call inner, lazy init defers construction, etc.). Each proxy's tests should be tiny.

---

## Senior Questions

### Q21. How does Proxy relate to AOP?

**A.** AOP is Proxy at a declarative level. Annotations (`@Cacheable`, `@Transactional`) declare cross-cutting concerns; the framework generates proxies. Same intent — control access — different artifacts.

### Q22. When would you choose AspectJ over Spring AOP?

**A.** When per-call proxy overhead matters (AspectJ inlines aspects via bytecode weaving — near-zero overhead). When self-invocation matters (AspectJ catches it; Spring doesn't). Trade: complex build / runtime agent.

### Q23. How does service-mesh fit the Proxy pattern?

**A.** Each service has a sidecar proxy (Envoy). Outgoing calls go through it; incoming arrive via it. The mesh adds TLS, retry, circuit breaker, observability — all without service code changes. Proxy at process level.

### Q24. What's the problem with deep proxy chains?

**A.** Stack traces have many forwarding frames. Performance suffers per call (50-100 ns × N layers). Debugging is harder. Auditing what each layer does requires reading them all.

### Q25. How would you implement single-flight in a caching proxy?

**A.** A map of in-flight requests by key. The first thread that misses the cache starts a computation; subsequent threads with the same key wait for that result. Go has `singleflight.Group` built-in. Caffeine's `getAll(keys, mappingFunction)` does similar.

### Q26. How do remote proxies handle failure?

**A.** Translate network errors into domain errors (timeout, unavailable, unauthorized). Retry on idempotent operations. Use circuit breakers to fail fast. Always set timeouts to avoid hanging.

### Q27. What's the design choice between in-process and out-of-process proxy?

**A.** In-process: lower latency (~50 ns), tied to service deployment, hard to share across services. Out-of-process (sidecar): higher latency (~1-5 ms), independent deployment, shared across services. Balance based on use case.

### Q28. How do you handle cache invalidation in a caching proxy?

**A.** Options: TTL (simple, eventually-consistent); event-driven (subscribe to upstream changes); write-through (proxy intercepts writes too); manual `evict(key)`. Pick based on consistency needs.

### Q29. What's a "transparent proxy"?

**A.** One that always forwards; from the caller's view, it's invisible. Used for instrumentation that shouldn't change behavior (tracing). Note: line with Decorator is fuzzy.

### Q30. How do you measure proxy overhead?

**A.** JMH (Java) / `testing.B` (Go) / `pytest-benchmark` (Python). Compare direct call vs proxy. Warm up to JIT steady state. Realistic workloads (don't benchmark trivial functions). Profiling under load to find dynamic proxy hotspots.

---

## Professional Questions

### Q31. What's the per-call cost of a JDK dynamic proxy?

**A.** ~50-100 ns. Breakdown: method dispatch (~5 ns), `Object[]` allocation for args (~10-20 ns), boxing of primitives (~5-10 ns each), `InvocationHandler.invoke` (~5 ns), `Method.invoke` reflection (~30-50 ns).

### Q32. How does cglib differ from JDK proxy at the bytecode level?

**A.** JDK Proxy generates a class implementing the interface; calls go through `InvocationHandler.invoke` (reflection). Cglib generates a subclass of the target; uses `MethodInterceptor.intercept` with cached `MethodProxy` (avoids reflection). Slightly faster but limited to non-final classes.

### Q33. Why does AspectJ have lower overhead than Spring AOP?

**A.** AspectJ weaves aspects directly into bytecode at compile-time (or load-time via agent). The result is a normal method that's been "modified" — JVM treats it like any other code, inlines aggressively. Spring AOP uses dynamic proxies — reflection per call.

### Q34. What's the JIT story for static proxies?

**A.** HotSpot inlines monomorphic method calls. A static proxy whose body is small inlines into the caller. Combined with `final` classes and CHA, net overhead can be 0 ns after warmup.

### Q35. Why does volatile matter in lazy proxy double-checked locking?

**A.** Without volatile, the JVM may reorder the assignment `real = newReal()`. A reader could see `real != null` before `newReal`'s constructor finishes — observing a partially-constructed object. `volatile` ensures the assignment happens-after the constructor.

### Q36. How does Python's `__getattr__` proxy work?

**A.** When attribute lookup fails on the proxy object itself, Python falls back to `__getattr__`. Returns the resolved attribute. Cost: ~150-300 ns per call. Doesn't intercept dunder methods (`__add__`, `__eq__`) — those bypass `__getattr__`.

### Q37. What's the cost of an HTTP/2 gRPC remote proxy call?

**A.** ~1-10 ms in same data center. Breakdown: marshalling (~50 μs), TLS (cached: ~0; cold: ~2 ms), network round trip (~1-5 ms), unmarshalling (~50 μs). Optimize by reusing connections, batching, gRPC's bidirectional streaming.

### Q38. What's the cost of an Envoy sidecar?

**A.** ~1-5 ms per hop. Optimizations: keep-alive connections, HTTP/2 multiplexing, mTLS session reuse, limited filter chain. For ultra-hot paths, consider direct service-to-service connections bypassing the mesh.

### Q39. How does the JVM specialize hot proxy call sites?

**A.** Inline cache: per call site, JVM tracks the receiver type. Monomorphic (one type) → direct call after inlining. Bimorphic (two types) → small dispatch table. Megamorphic (3+) → vtable lookup. Stable wiring keeps sites monomorphic.

### Q40. What's the overhead of Caffeine's caching proxy?

**A.** ~50-100 ns per get (hash lookup + access reordering for LRU). For computed entries, the loader function dominates. Hit rates above 90% make caching strongly net-positive. Below 50%, profile carefully.

---

## Coding Tasks

### Task 1: Virtual proxy (Go)

```go
type Image interface{ Display() }

type RealImage struct{ filename string }
func NewReal(f string) *RealImage {
    fmt.Printf("loading %s\n", f); return &RealImage{filename: f}
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

### Task 2: Protection proxy (Java)

```java
public class ProtectionProxy implements Document {
    private final Document inner;
    private final User user;

    public String content() { return inner.content(); }

    public void update(String text) {
        if (!user.hasRole("editor")) throw new SecurityException();
        inner.update(text);
    }
}
```

---

### Task 3: Caching proxy with TTL (Python)

```python
import time

class CachingProxy:
    def __init__(self, inner, ttl_seconds=60):
        self._inner = inner
        self._ttl = ttl_seconds
        self._cache = {}

    def get(self, key):
        now = time.monotonic()
        if key in self._cache:
            v, expiry = self._cache[key]
            if now < expiry: return v
        v = self._inner.get(key)
        self._cache[key] = (v, now + self._ttl)
        return v
```

---

### Task 4: Single-flight caching proxy (Go)

```go
import "golang.org/x/sync/singleflight"

type SFCache struct {
    inner Service
    cache sync.Map
    sf    singleflight.Group
}

func (c *SFCache) Get(key string) (Result, error) {
    if v, ok := c.cache.Load(key); ok { return v.(Result), nil }
    val, err, _ := c.sf.Do(key, func() (any, error) {
        v, err := c.inner.Get(key)
        if err == nil { c.cache.Store(key, v) }
        return v, err
    })
    if err != nil { return Result{}, err }
    return val.(Result), nil
}
```

---

### Task 5: JDK dynamic proxy (Java)

```java
public class LoggingHandler implements InvocationHandler {
    private final Object real;
    public LoggingHandler(Object real) { this.real = real; }

    @Override
    public Object invoke(Object proxy, Method m, Object[] args) throws Throwable {
        System.out.println("call " + m.getName());
        try { return m.invoke(real, args); }
        catch (InvocationTargetException e) { throw e.getCause(); }
    }
}

UserService real = new RealUserService();
UserService proxy = (UserService) Proxy.newProxyInstance(
    UserService.class.getClassLoader(),
    new Class<?>[]{UserService.class},
    new LoggingHandler(real));
```

---

## Trick Questions

### Q41. "If a proxy always forwards, is it still a Proxy?"

**A.** Borderline. A "transparent proxy" forwards everything; in practice, the line with Decorator is blurred. The naming reflects intent: if the *purpose* is access control (and the proxy *could* short-circuit), it's Proxy.

### Q42. "Is `requests.get(url)` a Proxy?"

**A.** It's more accurately a Facade or a remote proxy depending on how you frame it. The pattern names overlap; what matters is the intent in your specific code review.

### Q43. "If my proxy doesn't have the same interface, is it still a proxy?"

**A.** No — that's an Adapter or a Facade. The interface preservation is the defining characteristic of Proxy.

### Q44. "Can a proxy have new public methods beyond the interface?"

**A.** It can, but you shouldn't expose them. Doing so couples callers to the proxy class — defeats polymorphism.

### Q45. "Is a smart pointer a Proxy?"

**A.** Yes. C++ `unique_ptr`, `shared_ptr` are smart references that proxy access to a raw pointer with lifecycle management.

---

## Behavioral / Architectural Questions

### Q46. "Tell me about a time you used Proxy."

**A.** *STAR:* Situation (a service had repeated calls to a slow third-party API). Task (cache results without changing call sites). Action (built a `CachingProxy<T>` implementing the same interface; wired via factory). Result (latency dropped 90% on cached endpoints; no callers changed).

### Q47. "How did you decide between Proxy and Decorator?"

**A.** Asked: "does this layer control whether the inner runs, or always forward?" The caching layer might short-circuit on hits — that's Proxy. The metrics layer always forwards — that's Decorator. Named accordingly.

### Q48. "When did you decide *not* to use Proxy?"

**A.** A teammate proposed wrapping a CPU-cheap function in a virtual proxy. Setup cost outweighed any savings; the function ran in 5 ns. We dropped the proxy.

### Q49. "How do you handle Spring AOP self-invocation issues?"

**A.** Either inject self via `@Autowired ApplicationContext`, restructure to call across beans, or use AspectJ. We document the gotcha in our coding standards so engineers don't expect transactional methods called from within the same class.

### Q50. "How would you architect a system that's heavy on remote proxies?"

**A.** Design the interface to batch when possible (`getMany` instead of `get`). Use connection pools. Apply circuit breakers and retries with backoff. Add tracing at the proxy boundary. Ensure timeouts are set everywhere. Co-locate where latency matters.

---

## Tips for Answering

1. **Lead with "controls access to a real subject."** That's the headline.
2. **Distinguish from Decorator.** Senior signal — interviewers love this comparison.
3. **Bring real examples.** Hibernate, Spring AOP, gRPC, smart pointers. Pick one familiar.
4. **Mention Proxy variants** (virtual, protection, caching, remote, smart).
5. **Discuss when NOT to use it.** Knowing failure modes is signal.
6. **Talk about thread safety.** Lazy init is the classic concurrency pitfall.
7. **Code: small proxy, real interface, demonstrate forwarding or short-circuiting.** Show the choice.

---

← Back to Proxy folder · [↑ Structural Patterns](../README.md) · [↑↑ Roadmap Home](../../../README.md)

**Next:** [Proxy — Hands-On Tasks](tasks.md)
