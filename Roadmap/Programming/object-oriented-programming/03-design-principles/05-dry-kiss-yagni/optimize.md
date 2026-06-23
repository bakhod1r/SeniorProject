# DRY, KISS, YAGNI — Optimize

> The three slogans are design heuristics. Performance interacts with them in three places: layers of speculative abstraction cost dispatches, premature caching adds memory pressure and stale-data hazards, and "configurable" code introduces megamorphic call sites that pessimize the JIT. This file walks ten performance angles where the heuristics save or cost cycles. All numbers illustrative; verify with JMH.

---

## 1. Layers of abstraction — dispatch cost vs JIT inlining

Each YAGNI-driven layer (a factory, a strategy, a registry) is one method call per logical operation. The JIT inlines monomorphic chains for free; the cost appears when the chain is megamorphic or reconfigured per call.

```java
// 5-layer YAGNI chain — each layer was added "for flexibility"
gateway.charge(...)              // GatewayManager
  → strategy.execute(...)        // PaymentStrategy
  → registry.lookup(...)         // ProviderRegistry
  → factory.create(...)          // ProviderFactory
  → stripe.charge(...)           // StripeProvider
```

With one provider, the chain inlines to one direct call. With three providers, the registry lookup becomes a hash-table probe; the factory dispatch becomes bimorphic; the strategy dispatch becomes megamorphic. Each layer's profile pollution cascades.

The KISS shape:

```java
gateway.charge(...) → stripe.charge(...)
```

One call. No registry, no factory, no strategy. The JIT inlines unconditionally. When the second provider arrives, refactor to a two-layer chain — still inlinable.

---

## 2. Premature caching adds memory and staleness

A "performance" cache that wasn't measured to be needed:

```java
public class CountryService {
    private final Map<String, Country> cache = new ConcurrentHashMap<>();
    public Country byCode(String code) {
        return cache.computeIfAbsent(code, this::loadFromDb);
    }
}
```

Costs:

- **Memory** — the cache holds entries indefinitely; no TTL, no eviction.
- **Staleness** — DB updates don't propagate; running JVMs serve old data until restart.
- **Allocation pressure** — each `computeIfAbsent` creates a hash entry; GC sees more long-lived objects.
- **Concurrency** — `ConcurrentHashMap.computeIfAbsent` holds a striped lock during `loadFromDb`; concurrent callers for the same key serialize on it.

The underlying DB lookup is 0.5 ms against a 200-row table. The cache saves nothing measurable and introduces three real problems.

YAGNI applied: remove the cache. Add it back *with* TTL, invalidation, and benchmark proof if profiling later names the query as a bottleneck.

---

## 3. Records eliminate allocation overhead

DRY-via-records is performance-friendly. Compare:

```java
// Pre-record DTO
public final class Address {
    private final String street, city, zip;
    public Address(...) { ... }
    // 30 lines: getters, equals, hashCode, toString
}

// Record
public record Address(String street, String city, String zip) { }
```

Same bytecode in steady state, but:

- The record is implicitly `final` → CHA proves no subclasses → JIT inlines accessors as direct field reads.
- The record's accessors are tiny → escape analysis (EA) sees them as candidates for scalar replacement.
- `equals`/`hashCode` are component-derived → fold cleanly under EA-optimized hot paths.

For DRY value carriers, records are *the* shape. Performance + brevity + safety in one syntax.

---

## 4. Sealed switches vs polymorphic dispatch

Pattern-match switch over sealed types compiles to a fast `typeswitch` bootstrap:

```java
public sealed interface Op permits Add, Sub, Mul { }
public record Add(long a, long b) implements Op { }
public record Sub(long a, long b) implements Op { }
public record Mul(long a, long b) implements Op { }

public long apply(Op op) {
    return switch (op) {
        case Add a -> a.a() + a.b();
        case Sub s -> s.a() - s.b();
        case Mul m -> m.a() * m.b();
    };
}
```

Performance:

- The `permits` clause is a class-file attribute (JVMS §4.7.31); the JIT knows the set is closed.
- The switch lowers to a type-check chain that the JIT often turns into a table jump.
- Each branch inlines its own arithmetic.
- No vtable lookup, no megamorphic profile pollution.

Compared to a polymorphic `op.apply(a, b)` chain with three implementations, sealed-switch is consistently fast regardless of the distribution of variants — because polymorphic falls back to itable lookup when megamorphic, while the switch is a branch chain.

KISS *and* fast — sealed types are an example of modern Java giving you both.

---

## 5. `var` is free

`var` (JLS §14.4) is *purely* compile-time type inference. The bytecode is identical to the long-form declaration:

```java
var list = new ArrayList<String>();
List<String> list2 = new ArrayList<>();   // same bytecode
```

KISS at the local scope costs nothing at runtime. Use freely where the type is obvious from context.

---

## 6. Method references vs explicit lambdas

```java
list.stream().map(o -> o.id()).toList();          // explicit lambda
list.stream().map(Order::id).toList();            // method reference
```

In bytecode, both compile to an `invokedynamic` site that the JIT specializes. The method reference is *not* faster in steady state — but it has two practical advantages:

- It captures fewer variables (no closure over `this` if you're not using one).
- It's clearer for the reader.

KISS again. Method references are usually the right shape; explicit lambdas only when the body does more than a single call.

---

## 7. The "framework everything" trap

A YAGNI failure mode: introduce a framework "to make development easier" — Spring, Quarkus, Micronaut, a custom annotation processor — for a small app.

Costs:

- **Startup time** — Spring's classpath scanning takes ~3 seconds for a non-trivial app. For a CLI tool, that's 3 seconds of user-visible delay.
- **Heap footprint** — a Spring context costs 100+ MB.
- **Native-image friction** — reflection-based frameworks fight with GraalVM's reachability analysis.
- **Mental overhead** — every layer of indirection (`@Component`, `@Autowired`, AOP) is a hop the reader must trace.

For a small service or a CLI, the YAGNI move is to wire dependencies with plain constructors:

```java
public final class App {
    public static void main(String[] args) {
        DataSource ds = new HikariDataSource(/* config */);
        OrderRepository repo = new JdbcOrderRepository(ds);
        OrderService service = new OrderService(repo);
        new ConsoleUI(service).run();
    }
}
```

100ms startup, 30 MB heap, no framework. When the app's complexity *demands* a framework (multiple modules, dynamic config reload, distributed tracing), then introduce one — with measurement justifying the cost.

---

## 8. Stream pipelines vs explicit loops

A KISS judgement at the hot-loop scale:

```java
// Stream — KISS at the cognitive scale
return orders.stream().map(Order::total).reduce(Money.ZERO, Money::plus);

// Explicit loop — KISS at the operational scale (easier to step through)
Money total = Money.ZERO;
for (Order o : orders) total = total.plus(o.total());
return total;
```

Performance-wise: streams have a ~20–50 ns setup cost per pipeline (Spliterator creation, lambda capture, terminal state) plus a small per-element cost from the `Function` indirection. For 10 elements iterated once, the explicit loop is ~3× faster. For 1M elements, the difference vanishes — the work dominates.

KISS at the cognitive scale (streams read like a sentence) often wins. KISS at the operational scale (an explicit loop is debuggable line-by-line) wins for inner loops on small collections that are hot. Both shapes respect KISS; the question is *which kind* of simplicity matters in this context.

---

## 9. Avoiding the "configurable" call site

A KISS-violating shape that costs JIT performance:

```java
public void process(Order o, Map<String, Object> options) {
    boolean cache = (boolean) options.getOrDefault("cache", true);
    int retries = (int) options.getOrDefault("retries", 3);
    String mode = (String) options.getOrDefault("mode", "sync");
    if (cache && mode.equals("async")) { /* ... */ }
    // ...
}
```

Performance costs:

- `getOrDefault` plus `(boolean)` cast plus map lookup — autoboxing for every primitive.
- Conditional branches that the JIT can't simplify because the values are runtime-dependent.
- `String.equals` checks on the mode at every call.

The KISS shape: a method per behaviour, or a typed config record:

```java
public record ProcessOptions(boolean cache, int retries, Mode mode) { }
public void process(Order o, ProcessOptions opts) {
    if (opts.cache() && opts.mode() == Mode.ASYNC) { /* ... */ }
}
```

The boolean is unboxed; the enum comparison is a constant; the JIT sees the structure clearly. KISS at the API surface helps the JIT as much as it helps the reader.

---

## 10. Quick rules — performance and the three slogans

- [ ] YAGNI'd layers of abstraction (factory, registry, strategy) cost only if megamorphic; wire them stable and the JIT inlines.
- [ ] Premature caches add memory, staleness, and contention. Cache only when profiling proves the source is the bottleneck.
- [ ] Records are EA-friendly and CHA-friendly; favour them for value composition.
- [ ] Sealed types + pattern-match switches are usually faster than open polymorphism for closed sets.
- [ ] `var` and method references are free at runtime; use them for cognitive simplicity.
- [ ] Frameworks add startup cost and heap footprint; for small services, plain `main` is cheaper.
- [ ] Streams have a small fixed overhead; for hot loops on tiny collections, explicit loops are measurably faster.
- [ ] `Map<String, Object>`-style config introduces boxing and runtime branches; prefer typed records.
- [ ] The JIT rewards stability — wire chains once, hold in `final` fields, don't reconfigure.
- [ ] Profile before assuming abstraction is slow; modern HotSpot collapses well-designed indirection at zero cost.

The general law: KISS + YAGNI keep the JIT-friendly shape (monomorphic, stable, typed) without effort. DRY applied to *real* shared knowledge — typically through records and sealed types — is a performance positive. The performance cost of the three slogans is overwhelmingly the cost of *violating* them: speculative layers, premature caches, weakly-typed configurability.
