# Decorator — Interview Preparation

> **Source:** [refactoring.guru/design-patterns/decorator](https://refactoring.guru/design-patterns/decorator)

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

### Q1. What is the Decorator pattern?

**A.** A structural pattern that lets you add behavior to an object by wrapping it inside another object that implements the same interface. The wrapper forwards calls to the inner object and adds extra work before, after, or around them.

### Q2. Name the four roles.

**A.** **Component** (interface), **Concrete Component** (the original), **Decorator** (abstract base holding the inner reference), **Concrete Decorator** (specific behavior added on top).

### Q3. Why does the decorator implement the same interface as the wrapped object?

**A.** So the caller can use a decorated object identically to the original. The decorator is "transparent" to the caller — same methods, same signatures, same return types.

### Q4. Give a real-world example.

**A.** Java I/O streams: `BufferedInputStream(GZIPInputStream(FileInputStream))`. Each layer adds behavior — buffering, decompression, file reading — and exposes the same `InputStream` interface.

### Q5. What's the difference between Decorator and Adapter?

**A.** Decorator preserves the interface and adds behavior. Adapter changes the interface to make incompatible classes work together.

### Q6. What's the difference between Decorator and Composite?

**A.** Both build trees. Decorator wraps **one** target with extra behavior (chain). Composite holds **many** children and treats them uniformly (multi-branch tree).

### Q7. Can decorators be stacked?

**A.** Yes — that's their main feature. A logging decorator can wrap a retry decorator can wrap a metrics decorator can wrap the real service.

### Q8. Does order matter?

**A.** Yes. `Logging(Caching(Service))` logs every call, including cache hits. `Caching(Logging(Service))` only logs cache misses. Same components, different behavior.

### Q9. What's the difference between Python's `@decorator` and the OO Decorator pattern?

**A.** Python's `@` is a function decorator: a function that wraps another function. The OO Decorator pattern wraps an *object* with another object. Same intent (add behavior), different artifact.

### Q10. When should you NOT use Decorator?

**A.** When the behavior is universal (just put it in the class), when the chain is fixed and order never varies (one specialized class is simpler), when you'd need to break the interface contract (that's not Decorator anymore).

---

## Middle Questions

### Q11. How do you build a deep stack cleanly?

**A.** Avoid nested constructors past 3 layers. Use:
- **Var-style assignment**: `p = new Real(); p = new A(p); p = new B(p);` (top-down readable).
- **Builder**: `ProcessorBuilder.start(real).with(A::new).with(B::new).build()`.
- **Helper combinator**: `Apply(handler, mw1, mw2, mw3)`.

### Q12. How do you make a stack configurable?

**A.** Conditional decoration based on config or feature flags:

```go
func New(cfg Config) Service {
    var s Service = real
    if cfg.Retry { s = &retry{inner: s} }
    if cfg.Cache { s = &cache{inner: s} }
    return s
}
```

DI containers can do this declaratively (`@Profile`, `@Conditional`).

### Q13. Is HTTP middleware a Decorator?

**A.** Yes. Every middleware is a function/class that wraps the next handler. Express, Django, ASP.NET MVC, Spring filters — all are Decorator stacks in production form.

### Q14. How do you test a single decorator?

**A.** Mock or fake the wrapped Component. Assert the decorator's specific behavior:

```java
Service mockInner = mock(Service.class);
LoggingService logged = new LoggingService(mockInner, mockLogger);
logged.call(req);
verify(mockLogger).info(eq("calling"), any());
verify(mockInner).call(req);
```

Each decorator's tests are tiny and don't depend on others.

### Q15. How do you test the order of a stack?

**A.** Build two stacks with different orderings; assert observable difference. For middleware: an integration test with a recording fake at the bottom verifies request flow order. Documents the order requirement.

### Q16. What's an idempotency-aware retry decorator?

**A.** A retry decorator that generates an idempotency key once per logical attempt and passes it to the wrapped service on every retry. The wrapped service must honor the key (deduplicate). Without this, retries cause duplicate writes.

### Q17. How does Decorator combine with Composite?

**A.** Composite gives you a tree of components; each node can be a decorator. Example: a UI tree where one widget is wrapped with a `Shadow` decorator. The two patterns play well together.

### Q18. How does Decorator differ from inheritance with hooks?

**A.** Inheritance with hooks (template method) bakes behavior into a class hierarchy at compile time. Decorator composes at runtime — different instances can have different decorations. Decorator is more flexible; inheritance is more direct when behavior is universal.

### Q19. What's the impact on stack traces?

**A.** Each decorator adds a frame. A 7-layer stack means traces have 7 forwarding frames before the actual failure. Tools and IDEs can filter pure forwarding frames; teams sometimes set decorator-count limits as a discipline.

### Q20. Can a stateless decorator be shared across threads?

**A.** Yes. Stateless logging, metrics, and validation decorators are safe to share. Stateful ones (caches, rate limiters, counters) must be thread-safe internally.

---

## Senior Questions

### Q21. How does Decorator relate to AOP?

**A.** AOP (Aspect-Oriented Programming) is Decorator scaled up with declarative syntax. `@Cacheable`, `@Retryable`, `@Transactional` annotations declare cross-cutting concerns; the framework wraps the bean in dynamic proxies (Spring AOP) or weaves bytecode (AspectJ) to apply them. Same intent, different artifacts.

### Q22. When would AOP beat explicit Decorator?

**A.** When the same wrapping applies to dozens of services (declarative wins), and your team is comfortable with the magic. Explicit Decorator wins when you want fine-grained control, easier debugging, or you can't afford the AOP performance overhead in hot paths.

### Q23. How does Decorator stack interact with distributed tracing?

**A.** Each non-trivial decorator can emit a span. The span tree mirrors the wrapper stack: caller → metrics span → retry span → real service span. Trace IDs propagate via context; each layer can add tags. Avoid one-span-per-trivial-decorator: noise.

### Q24. How would you handle a 15-layer stack that's slowing things down?

**A.** Profile first. Then:
- **Consolidate.** Merge `Logging` + `Metrics` + `Tracing` into one `Observability` decorator.
- **Move to a faster mechanism.** Code-generated decorators or framework-level interceptors instead of dynamic proxies.
- **Push expensive layers out.** Move auth/rate limit to a sidecar / gateway.
- **Profile-guided removal.** Eliminate decorators whose impact isn't measured.

### Q25. How does Decorator combine with circuit breakers?

**A.** Circuit breaker is a stateful decorator that tracks failure rate and short-circuits when open. Order with retry matters: retry inside CB increments toward the threshold; retry outside CB fights the breaker. Most teams put retry inside CB.

### Q26. How do you avoid hidden state across a decorator stack?

**A.** Make state explicit:
- Inject state via constructors (cache instance, rate limiter).
- Document mutability and thread-safety on each decorator's class doc.
- Provide a `chain()` or `describe()` method to introspect the wrapping at runtime.

### Q27. How do you deal with cancellation through a decorator stack?

**A.** Pass a `Context` (Go), `CancellationToken` (.NET), or use cancellable futures (Java/CompletableFuture). Each layer must respect cancellation: check on entry, propagate to the inner call. Ignoring cancellation leaks resources upstream.

### Q28. What's the cost-benefit of each layer?

**A.** Each decorator should justify its cost: logging (debuggability), retry (resilience), cache (latency), auth (security). Bake into review: "what does this layer give us, and is it worth the per-call cost?" Decorators that don't pull weight should be removed.

### Q29. How do you migrate from inline cross-cutting concerns to decorators?

**A.** One concern at a time:
1. Pick a concern (logging) embedded in many services.
2. Extract one `LoggingDecorator` matching the interface.
3. Wire it via factory at construction; remove inline logging from one service.
4. Verify behavior unchanged; deploy.
5. Repeat per service.

Tests stay green throughout if the decorator faithfully replicates inline behavior.

### Q30. When does Decorator hurt observability?

**A.** When too many trivial decorators flood traces with empty spans. Or when a decorator silently swallows an error (e.g., a logging decorator that fails to log and returns success). Always: errors propagate; traces show meaningful work; logs identify the layer.

---

## Professional Questions

### Q31. How does the JVM handle deep decorator stacks?

**A.** HotSpot inlines monomorphic chains up to `MaxInlineLevel` (default 9). After warmup, a 5-layer stack typically becomes a single inlined sequence — zero call overhead. Sealed types help CHA. Megamorphic sites or reflection (dynamic proxies) prevent deep inlining.

### Q32. What's the cost of Spring AOP per call?

**A.** Roughly 30-50 ns per intercepted call (cglib subclass proxy + reflection plumbing). For request-scoped code, invisible. For inner loops (e.g., per-element processing), measurable. Spring 5+ improved with code generation.

### Q33. How does Go's interface dispatch affect Decorator?

**A.** Each layer is one interface call (~3 ns). Compiler does not inline indirect calls. A 5-layer stack ≈ 15 ns. Pointer receivers + pointer-passed interfaces avoid per-conversion allocation.

### Q34. What's the per-call cost in Python?

**A.** Each layer: ~150-300 ns (LOAD_ATTR + LOAD_METHOD + CALL_METHOD). A 5-layer stack ≈ 1 μs. CPython 3.11+ adaptive interpreter helps via attribute caching but doesn't eliminate the cost.

### Q35. What allocations should I worry about in a decorator?

**A.** Per-call allocations: maps, lists, closures, formatted strings. They add GC pressure proportional to QPS. Mitigations: reusable buffers, pre-formatted patterns, structured logging, primitive return types.

### Q36. How do dynamic proxies compare to compile-time decorators?

**A.** Dynamic proxies (Spring AOP, JDK Proxy) generate proxy classes at runtime — easy to use but slower (reflection cost). Compile-time decorators (annotation processors generating decorator classes) have no runtime overhead but require build-time tooling. Pick based on hot-path needs.

### Q37. How do you measure decorator overhead correctly?

**A.** JMH (Java) / `testing.B` (Go) / `pytest-benchmark` (Python). Compare direct vs decorated; ensure `Blackhole`/sink prevents dead-code elimination; warm up to JIT steady state; benchmark monomorphic and megamorphic separately.

### Q38. What's a typical anti-pattern around stack depth?

**A.** "Add one more decorator for each new concern" without auditing. Eventually 15+ layers, slow stack traces, surprising performance, fragile order dependencies. **Cap** the stack with a code-review rule (e.g., max 7 layers) and revisit when capped.

### Q39. How does escape analysis help decorator performance?

**A.** When a decorator is constructed and used within a single method without escaping, HotSpot can elide the allocation (scalar replacement). The decorator's fields become local stack vars. Brittle (debugger or `synchronized` can disable EA), but powerful for short-lived decorators.

### Q40. How does context propagation through async decorators work?

**A.** In Go, `context.Context` is passed explicitly through every method. In Java with `CompletableFuture`, decorators must propagate context (often via `ContextSnapshot.captureAll().wrap(future)`). Forgetting context propagation breaks tracing, cancellation, and request-scoped values.

---

## Coding Tasks

### Task 1: Coffee with milk and sugar (Go)

```go
type Coffee interface { Cost() int; Description() string }

type Plain struct{}
func (Plain) Cost() int           { return 30 }
func (Plain) Description() string { return "coffee" }

type Milk struct{ inner Coffee }
func (m Milk) Cost() int           { return m.inner.Cost() + 10 }
func (m Milk) Description() string { return m.inner.Description() + " + milk" }

type Sugar struct{ inner Coffee }
func (s Sugar) Cost() int           { return s.inner.Cost() + 5 }
func (s Sugar) Description() string { return s.inner.Description() + " + sugar" }

c := Sugar{inner: Milk{inner: Plain{}}}
fmt.Println(c.Description(), c.Cost())   // coffee + milk + sugar 45
```

---

### Task 2: Logging + Caching service (Java)

```java
public interface UserRepo { User get(String id); }

public class CachingRepo implements UserRepo {
    private final UserRepo inner;
    private final Map<String, User> cache = new ConcurrentHashMap<>();
    public CachingRepo(UserRepo inner) { this.inner = inner; }
    public User get(String id) {
        return cache.computeIfAbsent(id, inner::get);
    }
}

public class LoggingRepo implements UserRepo {
    private final UserRepo inner;
    private final Logger log;
    public LoggingRepo(UserRepo inner, Logger l) { this.inner = inner; this.log = l; }
    public User get(String id) {
        log.info("get({})", id);
        return inner.get(id);
    }
}

UserRepo r = new LoggingRepo(new CachingRepo(real), logger);
```

---

### Task 3: HTTP middleware chain (Go)

```go
type Middleware func(http.Handler) http.Handler

func Logging(l Logger) Middleware {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            start := time.Now()
            next.ServeHTTP(w, r)
            l.Info("http", "path", r.URL.Path, "duration", time.Since(start))
        })
    }
}

func Auth() Middleware { /* ... */ }

handler := Logging(logger)(Auth()(realHandler))
```

---

### Task 4: Idempotent retry (Java)

```java
public class IdempotentRetry implements Service {
    private final Service inner;
    private final int maxTries;

    @Override
    public Result call(Request req) throws Exception {
        var keyed = req.idempotencyKey() != null ? req
            : req.withIdempotencyKey(UUID.randomUUID().toString());
        Exception last = null;
        for (int i = 0; i < maxTries; i++) {
            try { return inner.call(keyed); }
            catch (TransientException e) { last = e; }
        }
        throw last;
    }
}
```

---

### Task 5: Compose multiple wrappers (Python)

```python
def compose(target, *decorators):
    """Apply decorators outward. compose(real, A, B) == A(B(real))."""
    for d in reversed(decorators):
        target = d(target)
    return target

p = compose(StripeProcessor(client),
            CircuitBreaker,
            Retry,
            Metrics)
```

---

## Trick Questions

### Q41. "Is Java's `BufferedReader` a Decorator?"

**A.** Yes — and it's the textbook example. `BufferedReader(InputStreamReader(FileInputStream))` is three Decorators. Each implements `Reader`/`InputStream` and adds behavior.

### Q42. "Can a Decorator add new public methods?"

**A.** It *can*, but you shouldn't. The whole pattern depends on uniformity — clients should be able to use the decorated object identically. New methods couple clients to the concrete decorator class.

### Q43. "If a decorator never delegates to the inner, is it still a Decorator?"

**A.** Borderline. A decorator that short-circuits (e.g., a circuit breaker rejecting calls) is fine — short-circuiting is a form of "before" logic. A decorator that *replaces* the call is closer to a Strategy or Stub.

### Q44. "Can I decorate a Decorator?"

**A.** Of course — that's stacking. `Logging(Caching(Real))` is one decorator wrapping another wrapping the real component.

### Q45. "Why don't I just use a switch statement to enable/disable behaviors?"

**A.** You can — for a small fixed set. Decorators win when (a) combinations are open (not predetermined), (b) per-instance configuration is needed, (c) the cross-cutting concerns are owned by different teams or rotated independently. A switch is a code smell when N grows.

---

## Behavioral / Architectural Questions

### Q46. "Tell me about a time you used Decorator."

**A.** *STAR:* Situation (a payment service that needed retry, metrics, and circuit breaking). Task (add resilience without polluting business logic). Action (extracted three Decorators around the existing `PaymentProcessor`; wired them via factory). Result (each was independently testable; integration test caught a CB-vs-retry order bug; outage tooling improved).

### Q47. "How did you decide the order of decorators in production?"

**A.** Started with a guess based on intuition. Wrote integration tests proving the order. Iterated when a real incident exposed the wrong order (e.g., logging *inside* auth missed unauthorized attempts). Codified the order in a factory method with a comment block explaining each layer's reason.

### Q48. "Your team has a 12-layer middleware stack. What do you do?"

**A.** Audit: profile, list each layer, find unused/unneeded ones. Consolidate (logging+metrics+tracing → one observability layer). Move some to a gateway/sidecar (auth, rate limit). Set a cap (e.g., max 7 in-process layers); justify violations.

### Q49. "When did you choose AOP over explicit Decorators?"

**A.** When 30+ services needed `@Retryable` and `@Transactional` and explicit wrapping was burning hours of boilerplate. Accepted the cost: harder debugging, dynamic-proxy overhead. Documented the wrapped behavior in shared docs to reduce surprise.

### Q50. "Decorator vs. Strategy — when do you pick?"

**A.** Strategy when there's *one slot* and you swap implementations. Decorator when you want to *combine* behaviors. A `PaymentStrategy` (Stripe vs Adyen) is Strategy — you pick one. A `RetryDecorator(StripePayment)` is Decorator — you stack on top.

---

## Tips for Answering

1. **Lead with "wrap to add behavior."** That's the headline.
2. **Bring real examples.** Java I/O, Express middleware, Spring AOP, gRPC interceptors — pick one familiar to the interviewer.
3. **Distinguish from siblings.** Adapter (interface change), Proxy (access control), Composite (multi-branch tree).
4. **Discuss order matter.** That's a senior-level concern; mention it preemptively.
5. **Show the failure modes.** Identity confusion, deep traces, hidden state, performance. Knowing where Decorator hurts is signal.
6. **Be honest about overuse.** "Some teams over-decorate" — show you've seen the dark side.
7. **Code: keep it small.** A single decorator adding logging + a stack of 2-3 is enough to demonstrate understanding.

---

← Back to Decorator folder · [↑ Structural Patterns](../README.md) · [↑↑ Roadmap Home](../../../README.md)

**Next:** [Decorator — Hands-On Tasks](tasks.md)
