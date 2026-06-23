# Traits, Mixins and Multiple Inheritance — Optimize

> **What?** "Optimize" here is mostly a *design-quality* question — when does the mixin-by-interface approach beat composition/delegation, and at what cost in coupling, clarity, and a little runtime — with a few genuine micro-benchmark points where dispatch actually matters. The measurable goal: minimize coupling and surprise per unit of reuse, and know when the cheaper-to-write mixin is the more-expensive-to-own choice.
> **How?** We compare the two ways to give a class a reusable capability — (a) interface + default methods, (b) composition + delegation — on five axes (state, runtime, testability, evolution, conflict-safety), then look at the small dispatch differences with JMH framing.

---

## 1. The two designs, side by side

The capability: every domain object can report its *age* from a creation timestamp.

**(a) Mixin by interface + default methods**

```java
public interface Timestamped {
    Instant createdAt();
    default Duration age()            { return Duration.between(createdAt(), Instant.now()); }
    default boolean olderThan(Duration d) { return age().compareTo(d) > 0; }
}
public record Order(String id, Instant createdAt) implements Timestamped { }
```

**(b) Composition + delegation**

```java
public final class Timestamps {                 // the collaborator holds the logic (and could hold state)
    private final Instant createdAt;
    public Timestamps(Instant createdAt) { this.createdAt = createdAt; }
    public Duration age()                { return Duration.between(createdAt, Instant.now()); }
    public boolean olderThan(Duration d) { return age().compareTo(d) > 0; }
}
public final class Order {
    private final String id;
    private final Timestamps ts;
    public Order(String id, Instant createdAt) { this.id = id; this.ts = new Timestamps(createdAt); }
    public Duration age()                { return ts.age(); }          // delegate
    public boolean olderThan(Duration d) { return ts.olderThan(d); }   // delegate
}
```

(a) is *concise* — zero boilerplate, the record gets `age()`/`olderThan()` free. (b) is *verbose* — a class plus delegating forwarders. The question is what each costs over the lifetime of the code.

---

## 2. The decision axes

| Axis                | Mixin (interface + defaults)                            | Composition (delegation)                          |
| ------------------- | ------------------------------------------------------- | ------------------------------------------------- |
| **State**           | **none possible** — §9.3 forbids instance fields        | full — the collaborator holds fields              |
| **Boilerplate**     | minimal — defaults inherited automatically              | one forwarder per exposed method                  |
| **Runtime cost**    | `invokeinterface` (one extra step vs `invokevirtual`)   | `invokevirtual` to the field + the target call    |
| **Testability**     | hard to substitute — behavior is welded into the type   | easy — inject a different collaborator / mock      |
| **Runtime swap**    | impossible — behavior fixed at compile time             | trivial — change the field                         |
| **Conflict-safety** | two mixins can collide on a signature (must override)   | no collisions — collaborators are independent fields |
| **Evolution**       | great for *adding* methods to a published interface     | great for *changing* the capability's internals    |

The two clear-cut rules fall straight out of the table:

- **Need state, runtime substitution, or mockability? → composition.** A mixin physically cannot hold state, and you cannot swap a welded-in default at runtime.
- **Stateless, derivable from a small hook, and a real *is-a*? → mixin.** Composition's boilerplate buys you nothing here.

---

## 3. The runtime difference is real but usually negligible

Default methods dispatch via `invokeinterface`; a direct class method uses `invokevirtual`. `invokeinterface` does slightly more work (it searches the receiver's *itable* rather than indexing a fixed vtable slot), so an un-inlined interface call is marginally costlier.

```
// Timestamped.age() compiles at the call site to:
invokeinterface #N, 1   // InterfaceMethod Timestamped.age:()Ljava/time/Duration;

// Order (composition).age() to:
invokevirtual   #M      // Method Timestamps.age:()Ljava/time/Duration;
```

A JMH sketch to measure it honestly:

```java
@BenchmarkMode(Mode.AverageTime)
@OutputTimeUnit(TimeUnit.NANOSECONDS)
@State(Scope.Benchmark)
public class DispatchBench {
    Timestamped mixin = new Order("o", Instant.now());
    OrderC      comp  = new OrderC("o", Instant.now());   // composition variant

    @Benchmark public Duration viaMixin()       { return mixin.age(); }
    @Benchmark public Duration viaComposition()  { return comp.age();  }
}
```

What you will actually observe: with a **monomorphic** call site (one implementing type seen), the JIT *devirtualizes and inlines* both forms, and the difference collapses to noise — the `Instant.now()` and `Duration.between` dominate by orders of magnitude. The `invokeinterface` penalty only surfaces at **megamorphic** sites (many implementing types through the same interface variable), where the inline cache thrashes. **Rule: pick the design for clarity and coupling; the dispatch cost is a tie-breaker only in a hot megamorphic loop, and even then measure before believing.**

---

## 4. The coupling cost of the mixin is the hidden price

The concise mixin has a cost that doesn't show up in a benchmark: **welded coupling**. Because the behavior is part of the type, you cannot:

- give two instances of `Order` *different* timestamp logic (e.g. a frozen clock in tests) without subclassing or overriding;
- mock `age()` in isolation — it's not a seam, it's intrinsic;
- evolve the capability's *internals* without touching the interface every implementor depends on.

Composition makes the capability a *value you hold*, so all three become trivial. This is the real optimization when the capability is non-trivial: composition trades a few forwarder lines for a *seam*, and seams are where testability and runtime flexibility live. The "optimization" of fewer lines (mixin) can be a pessimization of the property that actually costs money to lack (a seam).

---

## 5. Conflict cost: N mixins is O(N²) collision surface

Each additional behavior-only interface a class implements adds to the chance two of them declare the same signature, forcing a manual override. Compose three behavior interfaces and you may owe three `X.super.m()` resolutions; the surface grows with pairs. Composition has *zero* collision surface — two collaborator fields named `audit` and `cache` never clash because they're distinct members, not merged into the type. When you find yourself implementing four or five behavior interfaces and writing override-resolutions, the mixin design is *over budget* and composition is the cheaper owner.

---

## 6. Where the mixin is genuinely optimal

Don't over-correct into composition everywhere — it has its own boilerplate tax. The mixin wins decisively for:

- **Library evolution.** Adding `default Stream<E> stream()` to a published `Collection`-like interface is *binary-compatible* and costs implementors nothing. Composition can't retrofit a method onto types you don't control.
- **Tiny stateless derivations.** `default boolean isEmpty() { return size() == 0; }` — the forwarder version is pure ceremony.
- **Sealed hierarchies sharing behavior.** A closed set of records implementing a sealed interface with a shared default has bounded fragile-base risk and zero substitution need — the mixin is both concise *and* safe. See [../01-sealed-classes-and-pattern-matching/](../01-sealed-classes-and-pattern-matching/).

In these cases the mixin's "weld" is a non-issue because there's nothing to substitute and no state to hold.

---

## 7. A measurable decision procedure

Score the capability; the higher the total, the more composition pays:

| Question                                                | If yes |
| ------------------------------------------------------- | ------ |
| Does it need its own per-instance state?                | +3 (composition) |
| Do you need to swap/mock it at runtime or in tests?     | +2 (composition) |
| Will its *internals* change more than its signature?    | +2 (composition) |
| Do 3+ behavior interfaces already pile onto this class? | +1 (composition) |
| Is it a stateless one-liner derived from one hook?      | +2 (mixin) |
| Are you evolving a *published* interface?               | +3 (mixin) |
| Is the implementor set sealed/closed?                   | +1 (mixin) |

Sum the composition column vs the mixin column. A clear lead either way is your answer; a near-tie means default to the *simpler to write* (mixin) but leave a comment so the next person knows it was a deliberate close call.

---

## 8. Before/after: a mixin that outgrew its budget

**Before** — a `Cacheable` "trait" that secretly carries state (the §6 find-bug pattern):

```java
interface Cacheable {
    Map<Object,Object> CACHE = new ConcurrentHashMap<>();   // global, shared across all implementors
    default Object cached(Object k, Supplier<Object> s) { return CACHE.computeIfAbsent(k, x -> s.get()); }
}
```

Problems: one shared cache for every implementor (a correctness bug, not just a smell), no per-instance sizing, untestable eviction. **After** — composition:

```java
final class Cache {                                  // real per-instance state, configurable, mockable
    private final Map<Object,Object> map = new ConcurrentHashMap<>();
    Object get(Object k, Supplier<Object> s) { return map.computeIfAbsent(k, x -> s.get()); }
}
final class PriceService {
    private final Cache cache = new Cache();
    Object price(Object sku, Supplier<Object> compute) { return cache.get(sku, compute); }
}
```

The measurable wins: per-instance cache (correct), injectable for tests, swappable for an LRU/eviction policy later — none possible with the interface version, because state on an interface is always the one global slot §9.3 gives you. This is the canonical "the concise mixin was the expensive choice" case.

---

**Memorize this:** the mixin (interface + defaults) is *concise*; composition is *flexible*. The runtime gap (`invokeinterface` vs `invokevirtual`) is real only at megamorphic call sites and otherwise inlined away — never the deciding factor. The decision is **coupling and state**: choose the mixin for stateless one-line derivations, library evolution, and sealed hierarchies; choose composition the moment you need state, a test seam, runtime substitution, or you're stacking 3+ behavior interfaces. The trap is reading "fewer lines" as "cheaper" — a stateful "trait" forced onto an interface is a shared global (§9.3) and the most expensive choice of all.
