# Strategy — Optimize

> **Source:** [refactoring.guru/design-patterns/strategy](https://refactoring.guru/design-patterns/strategy)

Each section presents a Strategy that *works* but is wasteful. Profile, optimize, measure.

---

## Table of Contents

1. [Optimization 1: Singleton stateless strategies](#optimization-1-singleton-stateless-strategies)
2. [Optimization 2: Hoist captured lambda](#optimization-2-hoist-captured-lambda)
3. [Optimization 3: Enum-keyed lookup over HashMap](#optimization-3-enum-keyed-lookup-over-hashmap)
4. [Optimization 4: Split megamorphic call site](#optimization-4-split-megamorphic-call-site)
5. [Optimization 5: Replace dispatch with type-specialized branch](#optimization-5-replace-dispatch-with-type-specialized-branch)
6. [Optimization 6: Cache strategy by config key](#optimization-6-cache-strategy-by-config-key)
7. [Optimization 7: Use `final` to enable JIT inlining](#optimization-7-use-final-to-enable-jit-inlining)
8. [Optimization 8: Snapshot reference once per request](#optimization-8-snapshot-reference-once-per-request)
9. [Optimization 9: Drop premature Strategy](#optimization-9-drop-premature-strategy)
10. [Optimization 10: Static dispatch via generics (Rust / C++)](#optimization-10-static-dispatch-via-generics-rust-c)
11. [Optimization Tips](#optimization-tips)

---

## Optimization 1: Singleton stateless strategies

### Before

```java
public Money price(Cart cart, String mode) {
    PricingStrategy s = switch (mode) {
        case "standard" -> new StandardPricing();
        case "student"  -> new StudentPricing();
        case "holiday"  -> new HolidayPricing();
    };
    return s.price(cart);
}
```

Each call allocates a new strategy. Stateless instances are wasted garbage.

### After

```java
public final class PricingStrategies {
    public static final PricingStrategy STANDARD = new StandardPricing();
    public static final PricingStrategy STUDENT  = new StudentPricing();
    public static final PricingStrategy HOLIDAY  = new HolidayPricing();
}
```

```java
public Money price(Cart cart, String mode) {
    PricingStrategy s = switch (mode) {
        case "standard" -> PricingStrategies.STANDARD;
        case "student"  -> PricingStrategies.STUDENT;
        case "holiday"  -> PricingStrategies.HOLIDAY;
    };
    return s.price(cart);
}
```

**Measurement.** Allocation rate drops to zero for these. GC pause frequency goes down in allocation-heavy services.

**Lesson:** Stateless strategies should be singletons. Allocate once, reuse forever.

---

## Optimization 2: Hoist captured lambda

### Before

```java
public List<Order> filterRecent(List<Order> orders, Instant cutoff) {
    return orders.stream()
        .filter(o -> o.createdAt().isAfter(cutoff))   // captures cutoff per call
        .collect(Collectors.toList());
}
```

Each call to `filterRecent` allocates a new lambda capturing `cutoff`.

### After (when the cutoff is fixed)

```java
private static final Instant CUTOFF = Instant.parse("2025-01-01T00:00:00Z");
private static final Predicate<Order> IS_RECENT = o -> o.createdAt().isAfter(CUTOFF);

public List<Order> filterRecent(List<Order> orders) {
    return orders.stream().filter(IS_RECENT).collect(Collectors.toList());
}
```

Or, when you can pass a non-capturing lambda:

```java
orders.stream().filter(Order::isRecent)   // method reference; no capture
```

**Measurement.** Lambda allocation eliminated. In hot paths, GC pressure decreases.

**Lesson:** Non-capturing lambdas / method references are singletons. Capturing lambdas allocate.

---

## Optimization 3: Enum-keyed lookup over HashMap

### Before

```java
private static final Map<String, Strategy> MAP = Map.of(
    "fastest",  new FastestStrategy(),
    "shortest", new ShortestStrategy(),
    "scenic",   new ScenicStrategy()
);

public Strategy of(String key) { return MAP.get(key); }
```

Hot path does a HashMap lookup per request: hash of the string + array probe + equality check.

### After

```java
public enum RouteMode {
    FASTEST(new FastestStrategy()),
    SHORTEST(new ShortestStrategy()),
    SCENIC(new ScenicStrategy());

    private final Strategy strategy;
    RouteMode(Strategy s) { this.strategy = s; }
    public Strategy strategy() { return strategy; }
}
```

```java
public Strategy of(RouteMode m) { return m.strategy(); }
```

**Measurement.** Lookup reduces from ~10-20 ns (HashMap) to a single field read (~1 ns). On hot paths with millions of dispatches, measurable.

**Lesson:** When the strategy set is bounded and known at compile time, enums beat maps.

---

## Optimization 4: Split megamorphic call site

### Before

```java
for (Event e : events) {
    handlerByType.get(e.type()).handle(e);   // 10+ handler types
}
```

The call site sees many handler types → megamorphic; JIT can't inline.

### After

```java
// Group events by type first.
Map<EventType, List<Event>> grouped = events.stream().collect(groupingBy(Event::type));

for (var entry : grouped.entrySet()) {
    EventHandler h = handlerByType.get(entry.getKey());
    for (Event e : entry.getValue()) {
        h.handle(e);   // now monomorphic per inner loop
    }
}
```

**Measurement.** Per-event dispatch cost drops from ~3 ns (megamorphic vtable) to ~0 ns (inlined). In high-throughput dispatchers (e.g., 10M events/s), this is ~30% throughput.

**Lesson:** The JIT loves monomorphic call sites. Splitting one mega site into many mono sites unlocks inlining.

---

## Optimization 5: Replace dispatch with type-specialized branch

### Before

```java
PaymentStrategy s = strategyByType(req.type());
s.pay(req);
```

Megamorphic. Strategy lives behind an interface; JIT can't inline.

### After (when the family is small and stable)

```java
switch (req.type()) {
    case CARD   -> CARD_STRATEGY.pay(req);
    case CRYPTO -> CRYPTO_STRATEGY.pay(req);
    case BANK   -> BANK_STRATEGY.pay(req);
}
```

Each branch is monomorphic. JIT inlines each. The switch itself compiles to a jump table.

**Measurement.** ~2-3 ns saved per call. For a service doing 100K req/s, ~0.2 ms CPU per second per server.

**Trade-off:** The dispatcher now knows the family. Adding a type means editing this switch. Use only when (a) the family is stable, (b) the path is hot.

**Lesson:** Strategy is for flexibility. When that flexibility costs more than it earns, type-specialize.

---

## Optimization 6: Cache strategy by config key

### Before

```java
public Strategy ofConfig(Config cfg) {
    return new ConfiguredStrategy(cfg);   // new instance every call
}
```

Each call allocates and (worse) might re-do expensive setup (parsing rules, opening DB connections).

### After

```java
private final Map<Config, Strategy> cache = new ConcurrentHashMap<>();

public Strategy ofConfig(Config cfg) {
    return cache.computeIfAbsent(cfg, ConfiguredStrategy::new);
}
```

(Requires `Config` to have meaningful `equals` / `hashCode`.)

**Measurement.** Allocation rate drops dramatically; subsequent lookups are ~10 ns. For long-lived strategies with expensive init, the win is bigger.

**Lesson:** If strategy creation is expensive, cache by the parameters.

---

## Optimization 7: Use `final` to enable JIT inlining

### Before

```java
public class FastestStrategy implements RouteStrategy { ... }
public class ShortestStrategy implements RouteStrategy { ... }
```

The JIT, in principle, has to consider that some subclass of `FastestStrategy` might exist. Inlining is harder.

### After

```java
public final class FastestStrategy implements RouteStrategy { ... }
public final class ShortestStrategy implements RouteStrategy { ... }
```

`final` tells the JIT no subclass exists. Inlining decisions are simpler.

**Measurement.** In tight loops, marginal speedup (~5-10% on dispatch). More importantly: cleaner `IllegalAccessException`-style errors when someone subclasses without thinking.

**Lesson:** `final` is a hint to the runtime *and* a discipline. Use it for strategies that aren't designed for inheritance.

---

## Optimization 8: Snapshot reference once per request

### Before

```java
public final class Context {
    private volatile Strategy strategy;

    public Result process(Input a, Input b, Input c) {
        Result r1 = strategy.run(a);
        Result r2 = strategy.run(b);
        Result r3 = strategy.run(c);
        return merge(r1, r2, r3);
    }
}
```

Each `strategy.run(...)` does a `volatile` read. Three reads total. If the strategy changes between calls, results are inconsistent.

### After

```java
public Result process(Input a, Input b, Input c) {
    Strategy local = strategy;          // one volatile read
    Result r1 = local.run(a);           // local field reads
    Result r2 = local.run(b);
    Result r3 = local.run(c);
    return merge(r1, r2, r3);
}
```

**Measurement.** Three volatile reads → one. Per-call cost drops by a few ns. Plus you fix the consistency bug.

**Lesson:** Snapshot once per logical operation. Saves volatile reads and ensures consistent behavior.

---

## Optimization 9: Drop premature Strategy

### Before

```java
public interface DiscountStrategy { Money apply(Money m); }

public class NoDiscount implements DiscountStrategy {
    public Money apply(Money m) { return m; }
}

public final class Cart {
    private DiscountStrategy d = new NoDiscount();
    public Money total() { return d.apply(subtotal()); }
}
```

There is exactly one strategy. The interface, the class, the wiring — all overhead.

### After

```java
public final class Cart {
    public Money total() { return subtotal(); }
}
```

Drop the abstraction. Add it back when a *second* algorithm appears.

**Measurement.** Less code, less indirection, faster.

**Lesson:** Strategy with one implementation is an anti-pattern: the boilerplate of the pattern without any benefit. Add abstractions when needed, not before.

---

## Optimization 10: Static dispatch via generics (Rust / C++)

### Before (dynamic dispatch)

```rust
fn run_strategy(s: &dyn Strategy, input: i32) -> i32 {
    s.compute(input)
}
```

`&dyn Strategy` is a vtable pointer; `compute` is an indirect call. Inlining is impossible.

### After (static dispatch via generics)

```rust
fn run_strategy<S: Strategy>(s: &S, input: i32) -> i32 {
    s.compute(input)
}
```

The compiler monomorphizes: one specialized version per concrete `S`. The call is direct; the body inlines.

**Measurement.** Zero-cost abstraction. The Strategy compiles down to inline code.

**Trade-off:** Code bloat (one specialization per type). Use when dispatch is hot and the family is small.

C++ equivalent:

```cpp
template <typename S>
int run_strategy(S const& s, int input) { return s.compute(input); }
```

Same monomorphization model.

**Lesson:** In statically-dispatched languages, generics turn Strategy from "polymorphic indirect call" into "direct call." Both expressive and fast — but with code-size cost.

---

## Optimization Tips

- **Profile first.** Strategy dispatch is rarely the bottleneck. Don't optimize what hasn't shown up in a flame graph.
- **Stateless = singleton.** Always. No exceptions. No allocations per call.
- **Watch for closure capture.** Capturing lambdas allocate; non-capturing don't. In Java, Kotlin, Go, and JavaScript, it matters.
- **Enum-keyed lookups beat string-keyed.** Compile-time exhaustiveness as a free bonus.
- **`final` helps the JIT.** And documents intent.
- **Megamorphic call sites cost.** Split them by type or input partitioning.
- **Snapshot strategy refs.** Once per operation, not once per call. Saves volatile reads, prevents mid-call swaps.
- **Cache configured strategies.** When `new` is expensive (parsing rules, opening connections), key by config.
- **Drop one-strategy abstractions.** They're pure tax. Re-introduce when a second variant appears.
- **Static vs dynamic dispatch.** In Rust / C++, generics give you Strategy at compile time, free of indirect calls — at the cost of code size.

[← Find Bug](find-bug.md) · [Behavioral patterns home](../README.md)
