# Cohesion and Coupling — Optimize

> Cohesion and coupling are *design choices*. The JVM is a *runtime*. The two meet at three places: dispatch cost when decoupling adds interface hops, allocation cost when cohesive value types travel as records, and class-loading + JIT compilation cost when decoupling produces many small classes. This file walks ten optimization angles where the heuristics cost cycles — and how to keep them cheap. All numbers illustrative; verify with JMH.

---

## 1. Decoupling and dispatch — `invokeinterface` vs `invokevirtual`

Decoupling through interfaces (the canonical DIP move) uses `invokeinterface` instead of `invokevirtual`. The runtime cost difference:

- `invokevirtual` resolves through a fixed-offset vtable slot — one indirect load.
- `invokeinterface` resolves through an itable lookup keyed by interface — historically a linear scan, in modern HotSpot a hashed lookup with cache. One to three extra loads per uncached call.

For *monomorphic* call sites, the JIT erases both into direct calls. For *megamorphic* (3+ types), `invokeinterface` is slower than `invokevirtual` by ~10–20% in microbenchmarks.

```java
public final class OrderService {
    private final OrderRepository repo;      // interface field
    public void place(Order o) {
        repo.save(o);                        // invokeinterface
    }
}
```

The good news: most decoupled call sites are monomorphic (the production wiring fixes the impl). The JIT inlines aggressively. Decoupling is *free at runtime* in 99% of practical cases.

**Inspect:** `-XX:+UnlockDiagnosticVMOptions -XX:+PrintInlining` shows `(virtual call)` vs `(inline)` decisions.

---

## 2. Cohesion and class-loading cost

A codebase with high cohesion at the class level usually has *more classes* — one purpose per class. Each class costs:

- ~1 KB of metaspace per loaded class.
- One classloader entry, one constant pool, one method table.
- One JIT compilation when methods get hot.

For a typical enterprise app:
- 5,000 classes → ~5 MB metaspace.
- 50,000 classes → ~50 MB metaspace + measurable startup time.

The trade-off: cohesion *adds* class count; coupling *adds* per-class size. The total bytes are roughly similar. The class-loading cost favours fewer classes; the JIT cost favours smaller classes (faster to compile).

For startup-sensitive applications (CLI tools, lambda functions, GraalVM native images), excessive cohesion-driven class proliferation matters. Otherwise, ignore.

---

## 3. Records and escape analysis

A record is the canonical cohesive data type. The JIT's escape analysis (EA) frequently scalar-replaces records that don't escape the method:

```java
public record TaxableSale(Money subtotal, Country country, boolean exempt) { }

public BigDecimal taxFor(TaxableSale sale) { /* ... */ }

// Caller (hot loop)
for (Order o : orders) {
    var sale = new TaxableSale(o.subtotal(), o.country(), o.taxExempt());
    bd = bd.add(taxFor(sale));
}
```

EA looks at `sale` and proves it doesn't escape — the fields are read once, the object is unused after. Scalar-replacement: `sale` never lives on the heap. The two values plus boolean live in registers.

Records cooperate with EA because:

- Implicitly `final` — no subclass can capture `this`.
- Accessors are tiny and inline.
- No mutable fields — no escape via mutation.

**Confirm:** `-XX:+UnlockDiagnosticVMOptions -XX:+PrintEliminateAllocations` lists scalar-replaced records.

For cohesive data passed between methods, prefer records over plain classes. EA does the rest.

---

## 4. Monomorphism and CHA — decoupling that's free

Class-Hierarchy Analysis (CHA): the JIT tracks which classes implement which interfaces. When CHA proves there's *one* concrete implementation reachable through a particular interface type, the JIT can:

- Emit a direct call (no vtable lookup).
- Inline the body unconditionally.

A `final` class implementing an interface, injected via a `final` field, is CHA's best case:

```java
public final class JdbcOrderRepository implements OrderRepository {
    public void save(Order o) { ... }
}

public final class OrderService {
    private final OrderRepository repo;          // CHA observes: only JdbcOrderRepository ever loaded
    public OrderService(OrderRepository r) { repo = r; }
    public void place(Order o) { repo.save(o); } // inlined as direct call
}
```

The cost of decoupling here is *zero*: the `invokeinterface` collapses to a direct call after the JIT learns CHA's truth.

Decoupling becomes measurable only when the call site is megamorphic — usually because multiple concretes share the same interface field across instances. Wire stably (one impl per chain) to keep CHA happy.

---

## 5. Constructor injection cost

Constructor injection with `final` fields:

```java
public final class OrderService {
    private final OrderRepository repo;
    private final Notifier notifier;
    private final Clock clock;
    public OrderService(OrderRepository r, Notifier n, Clock c) {
        this.repo = r; this.notifier = n; this.clock = c;
    }
}
```

Three `putfield` instructions in the constructor, three field reads at use sites. The JIT removes the indirection entirely — the call sites compile as if the fields were `static final` references.

Compared to a singleton lookup pattern (`Singletons.getInstance().repo()`):

- Constructor injection: 0 ns overhead per use after JIT (direct field read).
- Singleton lookup: 1 `invokestatic` + 1 field read, ~1 ns. Plus initialization cost on first call.

Constructor injection is strictly cheaper at runtime *and* better for testability. The myth that "DI is slower" is folklore.

---

## 6. The cost of "decoupling everything"

Excessive decoupling adds layers — each layer is one method call per logical operation:

```java
public final class OrderService {
    public Money totalDue(Order o) { return total.compute(o); }       // layer 4
}
public final class OrderTotalCalculator {
    public Money compute(Order o) { return subtotal.compute(o).plus(tax.compute(o)); }  // layer 3
}
public final class SubtotalCalculator {
    public Money compute(Order o) { return o.lineItems().stream().map(...).reduce(...); }  // layer 2
}
```

Each layer is one virtual call. The JIT inlines monomorphic chains; for 4-layer monomorphic chains, the inliner inlines everything. Cost: zero.

The cost appears when *any layer* becomes megamorphic. A factory that constructs different `OrderTotalCalculator` impls per region, for instance, makes the middle layer bimorphic and breaks inlining at that boundary.

Mitigation: wire one chain per JVM, hold it `final`, don't reconfigure mid-flight.

---

## 7. Cohesion and cache locality

Cohesive value types — records — pack their fields together. Inheritance-based hierarchies scatter fields across memory through subclass headers and references.

```java
public record OrderSummary(long id, BigDecimal total) { }
// Fields packed contiguously; arrays of records have good cache locality
```

vs

```java
public abstract class AbstractEntity { protected long id; }
public class Order extends AbstractEntity { private BigDecimal total; }
// Each Order instance: object header + parent fields + own fields, scattered
```

For 100k-element arrays, the record-shaped version is 1.5–3× faster on sequential scans because each cache line holds more records. With Project Valhalla's value classes, records become *truly* flat — `Point[]` becomes a packed `[x y x y x y ...]`, not an array of references.

Cohesion of data into records pays back in cache performance whenever you iterate over collections.

---

## 8. Service classes and the JIT — sweet spot for inlining

A common cohesion shape — small `final` service classes with one method each — is a JIT sweet spot:

```java
public final class TaxRateLookup {
    private final Map<Country, BigDecimal> rates;
    public TaxRateLookup(Map<Country, BigDecimal> r) { rates = r; }
    public BigDecimal rateFor(Country c) { return rates.getOrDefault(c, BigDecimal.ZERO); }
}
```

- `final` class → CHA proves no subclasses.
- One method → inliner doesn't need to choose; everything inlines.
- `Map.getOrDefault` is monomorphic in production (one `Map` impl) → inlined too.

The whole call site compiles as if it were `inline static BigDecimal rateFor(Country c) { ... }`. Zero abstraction tax.

Compared to a god class with 50 methods sharing 10 fields: CHA still proves monomorphism per call site, but the *method table* is huge, and the inliner has more decisions to make. Smaller, cohesive classes are easier to optimize.

---

## 9. JLink / GraalVM native — coupling drives image size

For ahead-of-time compilation (GraalVM native image) or modular runtime (`jlink`), the *coupling graph* determines image size:

- `jlink` walks `requires` declarations to pick which modules to include.
- GraalVM does reachability analysis from `main`, including all transitively referenced classes.

Tight coupling (one God class imports 50 libraries) → bloated image. Loose coupling (well-isolated modules) → tiny image.

```
Module-info-aware app, hexagonal architecture:
  Domain module: 200 classes
  Web adapter: 100 classes (depends on domain)
  JPA adapter: 150 classes (depends on domain)
  → image: ~30 MB native
```

vs

```
Tightly coupled monolith:
  One package, everything imports everything:
  → image: ~80 MB native
```

For lambda functions, mobile binaries, and edge deployments where image size matters, low coupling pays back in megabytes.

---

## 10. Quick rules — performance and cohesion/coupling

- [ ] Decoupling via interfaces is *free* at runtime for monomorphic call sites. JIT inlines through CHA.
- [ ] Records compose to scalar replacement; favour records over plain classes for cohesive data.
- [ ] Mark service classes `final` and their methods `final` — CHA loves it.
- [ ] Wire one chain per JVM; hold it in `final` fields; don't reconfigure mid-flight.
- [ ] Excessive class count (100k+) hurts startup; modest cohesion-driven class growth is invisible.
- [ ] For hot loops, prefer flat record arrays over hierarchical entity collections (cache locality).
- [ ] Constructor injection is the cheapest DI pattern; singletons add overhead and remove testability.
- [ ] For native-image / `jlink` builds, low coupling reduces binary size measurably.
- [ ] Profile before bending cohesion/coupling for performance; the cost is rarely where intuition predicts.
- [ ] When a hot leaf needs a controlled coupling violation (direct concrete dependency), document why.

The general law: design cohesively and decoupled first, measure, then break the abstraction the profiler names. Modern JITs collapse most well-designed indirection at zero runtime cost. The 1% where it matters is a profile-driven, local decision, not a global stance.
