# DDD Tactical: Domain Services — Optimize

> **What?** Domain Services are usually *not* the bottleneck — entities, queries, and network round-trips are. But because Domain Services are stateless and pure (or close to it), they enable a set of JVM-level optimisations that other code shapes can't take advantage of: singleton sharing, JIT inlining of pure methods, escape analysis on small inputs, result caching, batching across many invocations, and parallel computation over independent work items.
> **How?** Treat each optimisation as a *conditional* technique — apply it only when profiling shows the service is hot. Premature optimisation of a Domain Service is worse than premature optimisation of an entity, because the service often sits inside a tight loop in an application service or a batch job, and any complexity you add there will be felt for years.

---

## 1. Stateless services as singletons

A Domain Service holds no mutable state. One instance per JVM suffices; Spring instantiates `@Service` beans as singletons by default. Don't fight it.

```java
@Configuration
public class DomainConfig {
    @Bean
    TransferService transferService(ExchangeRatePolicy rates) {
        return new TransferService(rates);     // one instance, shared
    }
}
```

Two consequences worth naming:

- **Zero allocation cost per call.** No `new TransferService(...)` inside hot paths.
- **Thread-safe by construction**, because there's no state to race on. This is a real win — the alternative (per-request services) wastes the JVM's escape-analysis budget on a class that doesn't need it.

Bench reality: for trivial services, the difference between singleton and per-call is sub-microsecond. For services with non-trivial constructors (regex compilation, table lookups), the singleton can be 10x–100x faster on a hot path.

---

## 2. JIT inlining of pure service methods

The HotSpot JIT inlines small methods aggressively. A Domain Service method whose body is a few arithmetic operations and a delegation to an entity is a prime candidate. Two practices help the JIT:

- Mark service classes `final`. The JIT can then devirtualise calls without speculation.
- Mark methods that won't be subclassed `final` as well. Doesn't matter on `final` classes, but consistency is cheap.
- Keep hot methods short (Hotspot's default inlining threshold is 35 bytecodes; FreqInlineSize is 325). A 1000-byte method won't inline.

```java
public final class PricingService {
    public final Money price(Basket basket, PricingRules rules) {
        return basket.lines().stream()
            .map(rules::priceLine)
            .reduce(Money.zero(basket.currency()), Money::plus);
    }
}
```

The body delegates to lambdas the JIT can inline through. After warm-up, the entire pipeline often collapses into a tight loop with no virtual dispatch.

---

## 3. Escape analysis on small inputs

When a method allocates a value object that doesn't escape (no reference leaves the method or is stored on the heap), HotSpot's *escape analysis* (EA) can elide the allocation entirely — the object lives on the stack or in registers.

Domain Services that take and return value objects are EA-friendly *if* the intermediate VOs are short-lived:

```java
public Money price(Basket basket) {
    Money running = Money.zero(basket.currency());
    for (Line line : basket.lines()) {
        Money lineTotal = new Money(line.price().value().multiply(line.qty().value()),
                                    line.price().currency());   // may be EA-eliminated
        running = running.plus(lineTotal);
    }
    return running;
}
```

`lineTotal` is created inside the loop and never escapes; on a hot path, EA can scalarise it. To check, pass `-XX:+UnlockDiagnosticVMOptions -XX:+PrintEscapeAnalysis` (debug builds) or use JITWatch.

The trap: storing the intermediate `Money` in a field or passing it to a non-inlineable virtual call defeats EA. Keep hot loops tight.

---

## 4. Caching pure computations

A pure Domain Service whose result depends only on the inputs is a candidate for caching — but caching belongs *outside* the service.

```java
// Bad: caching inside the domain
public final class PricingService {
    private final Map<Basket, Money> cache = new ConcurrentHashMap<>();   // hidden state
    public Money price(Basket b) { return cache.computeIfAbsent(b, this::computePrice); }
}

// Good: cache port, infrastructure implementation
public interface PricingCache {
    Optional<Money> get(BasketHash key);
    void put(BasketHash key, Money value);
}

public final class PricingService {
    private final PricingCache cache;
    public Money price(Basket b) {
        BasketHash key = b.hash();
        return cache.get(key).orElseGet(() -> {
            Money p = computePrice(b);
            cache.put(key, p);
            return p;
        });
    }
}
```

The domain stays stateless; the cache lives in infrastructure (Caffeine, Redis). The service is still trivially testable with a stub cache.

Cache-key design matters: hash the *content* of the basket, not its identity. Two structurally identical baskets must hit the same key.

---

## 5. Batching to amortise fixed costs

When a Domain Service is called inside a loop, and each call does a constant amount of fixed setup (e.g., consulting a port that talks to a database or an external system), batching cuts the cost dramatically.

```java
// Per-item: N calls to the rates port
public Money totalConverted(Collection<Line> lines, Currency target) {
    return lines.stream()
        .map(l -> rates.convert(l.amount(), target))   // N calls
        .reduce(Money.zero(target), Money::plus);
}

// Batched: one call to the rates port
public interface ExchangeRatePolicy {
    Money convert(Money amount, Currency target);
    Map<Currency, BigDecimal> ratesTo(Currency target);    // batch capability
}

public Money totalConverted(Collection<Line> lines, Currency target) {
    Map<Currency, BigDecimal> table = rates.ratesTo(target);
    return lines.stream()
        .map(l -> new Money(l.amount().value().multiply(table.get(l.amount().currency())), target))
        .reduce(Money.zero(target), Money::plus);
}
```

Batching often requires a richer port API. Worth it when the port crosses a network boundary; usually overkill in-process.

---

## 6. Parallel streams for embarrassingly parallel work

A pure Domain Service applied to N independent items is parallelisable. `Collection.parallelStream()` is the easiest lever:

```java
public Money priceAll(List<Basket> baskets, PricingRules rules) {
    return baskets.parallelStream()
        .map(b -> pricer.price(b, rules))
        .reduce(Money.zero(baskets.get(0).currency()), Money::plus);
}
```

Caveats:

- `parallelStream` uses the common ForkJoinPool. If the host application also uses it, you get contention. Configure a dedicated pool when this matters.
- The work per item must be substantial — splitting a list of 10 items into parallel chunks costs more than running them sequentially.
- The reduction function (`Money::plus`) must be associative.
- The service and its ports must be thread-safe (and a pure Domain Service is, by Property 1).

Benchmark before committing — for sub-microsecond work, parallelism is a net loss.

---

## 7. Avoid micro-services posing as Domain Services

A "Domain Service" that calls another Domain Service that calls another, each across an RPC boundary, isn't a Domain Service architecture — it's a microservice graph dressed up. Each network hop adds milliseconds and a failure mode. If you find yourself building one, step back: are these really separate bounded contexts, or did the modular monolith get fragmented prematurely?

Cheap rule: collapse Domain Services that always co-execute and never need independent deployment into the same context. Distributed boundaries cost real money.

---

## 8. Avoid boxing in hot loops

Domain primitives wrap `BigDecimal`, `long`, `int`. Inside a tight Domain Service loop, unwrapping to the primitive can win significantly:

```java
// Slow: BigDecimal arithmetic per iteration
BigDecimal total = BigDecimal.ZERO;
for (Line l : lines) total = total.add(l.amount().value());

// Faster when scale is known and fits in long
long totalMinor = 0;
for (Line l : lines) totalMinor += l.amount().minorUnits();
return Money.ofMinor(totalMinor, currency);
```

The `BigDecimal` versions involve allocation per operation; the `long` version is one register. Use only when the financial scale tolerates it (e.g., cents fit comfortably in `long`).

---

## 9. Method-handle and `MethodHandle` exotica

Rarely worth it for Domain Services. The JIT already handles the common shapes (interface dispatch on small implementations, lambda invocation) within an order of magnitude of hand-optimised method handles. Reach for `MethodHandle.invokeExact` only after profiling shows interface dispatch as the bottleneck — almost never the case in domain code.

---

## 10. Measuring — JMH, not stopwatches

Every claim above must be backed by a JMH benchmark before you ship it. A typical setup:

```java
@State(Scope.Benchmark)
public class PricingBenchmark {

    private PricingService service;
    private Basket basket;
    private PricingRules rules;

    @Setup public void setUp() {
        service = new PricingService();
        basket  = sampleBasketWith(100);
        rules   = sampleRules();
    }

    @Benchmark
    public Money price() { return service.price(basket, rules); }
}
```

Run with `@Fork(2) @Warmup(5) @Measurement(10) @BenchmarkMode(Mode.AverageTime)` and read the histograms before drawing conclusions. Aaronson's law applies: *intuition about JVM performance is almost always wrong*.

---

## 11. Quick rules

- [ ] Make Domain Services singletons; never new them per call.
- [ ] Mark service classes `final` to help the JIT devirtualise.
- [ ] Keep hot methods small (< 325 bytecodes) and EA-friendly.
- [ ] Cache pure results via a port; never inside the service.
- [ ] Batch when the port crosses a network boundary; ignore otherwise.
- [ ] Parallelise only after profiling and only when work per item is substantial.
- [ ] Profile with JMH; do not trust stopwatch numbers.
- [ ] Don't fragment a logical Domain Service into multiple RPC-bound microservices.

---

## 12. What's next

| Topic                                       | File           |
| ------------------------------------------- | -------------- |
| Hands-on exercises                          | `tasks.md`     |
| Interview Q&A                               | `interview.md` |

Related: [`../01-value-objects/optimize.md`](../01-value-objects/optimize.md), [`../02-entities/optimize.md`](../02-entities/optimize.md), [`../03-aggregates/optimize.md`](../03-aggregates/optimize.md), [`../04-repository-concept/optimize.md`](../04-repository-concept/optimize.md).

---

**Memorize this:** A Domain Service is *already* JVM-friendly — it is stateless, singleton-safe, and inlineable. Most "optimisations" you'll be tempted by are either redundant (the JIT already does it) or actively harmful (caching state inside the service breaks Property 1). Profile first; the changes that pay off are singleton sharing, batching across network ports, and parallel streams over independent work.
