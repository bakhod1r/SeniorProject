# Fragile Base Class Problem — Optimize

> FBCP is a *design hazard*. It interacts with performance in three places: virtual dispatch through deep inheritance chains, class-hierarchy analysis (CHA) and how the JIT specializes monomorphic call sites, and the cost of constructor virtual calls + escape analysis. This file walks ten optimization angles where FBCP and its cures cost or save cycles. All numbers illustrative; verify with JMH.

---

## 1. Dispatch through deep inheritance chains

Each level of inheritance adds entries to the class's *virtual method table* (vtable). HotSpot keeps the table in the `Klass` metadata. A `invokevirtual` instruction does:

1. Load the receiver's class pointer (one cache miss in the cold case).
2. Index into the vtable at the fixed offset for the resolved method.
3. Call the resolved method.

For a 4-level chain, the vtable is larger but the dispatch cost is constant — *one* indirect load, then a direct call. The cost isn't depth per se; it's *megamorphism*: if the call site sees multiple unrelated subclasses, the JIT's type profile is polluted and inlining suffers.

For FBCP-prone codebases with many subclasses of one parent, the call sites become megamorphic. The JIT falls back to a real vtable lookup and stops inlining. Latency rises.

**Inspect:** `-XX:+PrintInlining` shows `(virtual call)` for megamorphic sites, `(inlined)` for monomorphic.

---

## 2. `final` and class-hierarchy analysis (CHA)

A `final` class has *one* concrete type. CHA proves there's no subclass; the JIT inlines every virtual call as if it were a direct call.

```java
public final class JdbcOrderRepository implements OrderRepository {
    public void save(Order o) { /* ... */ }
}

// call site
repo.save(o);              // CHA proves repo is JdbcOrderRepository, inlines
```

For FBCP-mitigated code (default `final`), CHA almost always succeeds. The performance is identical to direct calls.

For FBCP-prone code (open classes with subclasses), CHA is conservative: it tracks every loaded subclass and may invalidate inline decisions when new subclasses load. The hot path can deoptimize.

Mark `final` aggressively when there's no inheritance design. CHA pays you back at runtime.

---

## 3. `sealed` types and dispatch

Sealed types give CHA a closed-world guarantee at compile time. The JIT sees that the set of subclasses is bounded by `permits` and can specialize accordingly.

```java
public sealed interface Op permits Add, Sub, Mul { }

// call site
return op.apply(a, b);      // CHA: at most 3 subclasses
```

For 3 subclasses at one call site, the JIT emits a *tri-morphic* inline (three type checks, each with the inlined body). No vtable lookup, no megamorphic fallback. Faster than the same dispatch through open inheritance.

Pattern-match switches on sealed types are typically equivalent (the JIT lowers them similarly).

For FBCP, sealed types are *both* the design fix (closed contract) *and* the performance fix (specializable dispatch). Modern Java leans into this.

---

## 4. Constructor virtual calls — escape analysis

A virtual call in a constructor (the JLS §12.5 hazard) defeats escape analysis. The compiler can't prove the partially-constructed object doesn't escape:

```java
public class Parent {
    public Parent() { onCreate(); }
    protected void onCreate() { /* default */ }
}

public class Child extends Parent {
    @Override protected void onCreate() {
        System.out.println(this);     // `this` escapes to System.out
    }
}
```

EA gives up because `this` may have escaped during `onCreate`. Any optimizations dependent on EA (stack allocation, scalar replacement) are off.

For FBCP-aware code (no virtual calls in constructors), EA can prove the object doesn't escape until the constructor returns, opening optimization opportunities.

---

## 5. `Object.clone()` and zero-length array overhead

The `Cloneable` protocol — a FBCP trap — also has a small runtime cost: `Object.clone()` uses native code to do a shallow field copy. For modern Java, copy constructors and records eliminate this entirely.

```java
// Cloneable — native method, no inlining of the copy semantics
Dog d2 = (Dog) d.clone();

// Record copy — JIT inlines field-by-field copy
Dog d2 = new Dog(d.name(), d.color());
```

The record copy is JIT-friendly: each field assignment is visible, EA can scalar-replace when applicable, no native boundary crossed.

Avoid `Cloneable` for both FBCP and performance reasons.

---

## 6. Deep hierarchies and metaspace footprint

Each loaded class has a `Klass` structure in metaspace: roughly 1–2 KB plus the size of its vtable. A 6-level inheritance chain stores 6 `Klass` structures, each tracking the cumulative vtable.

For a typical enterprise app:

- 5,000 classes, mostly shallow → ~5 MB metaspace.
- Same app with 10-level inheritance chains → ~8 MB metaspace.

Negligible in absolute terms, but noticeable for startup-sensitive apps (CLI tools, lambda functions, GraalVM native images). Deep hierarchies also slow class loading because each class triggers loading of its ancestors.

For native image, deep hierarchies hurt more: GraalVM's reachability analysis traverses every ancestor, expanding the included class set.

---

## 7. Composition vs inheritance in tight loops

For a tight loop calling a method many times, the choice between inheritance and composition makes a measurable difference only when:

- The call site sees multiple types (megamorphic), and
- The methods can't be inlined.

```java
// Composition (interface + final impl)
OrderRepository repo = new JdbcOrderRepository(ds);
for (Order o : orders) repo.save(o);          // monomorphic, fully inlined

// Inheritance (open class)
class AbstractRepository { public void save(Order o) { ... } }
AbstractRepository repo = ...
for (Order o : orders) repo.save(o);          // open — CHA may pessimize
```

For monomorphic call sites, both shapes inline. For megamorphic sites (many concrete subclasses through one parent), inheritance pessimizes more than composition (the interface field is typed to a single role; the abstract class field is typed to a hierarchy).

FBCP's design-level cost matches its performance-level cost: open inheritance is the harder shape for the JIT.

---

## 8. The "framework class" inheritance tax

Inheriting from a framework class (`HttpServlet`, `JpaRepository`, `AbstractMessageListenerContainer`) often involves:

- Reflection at startup (the framework introspects your subclass).
- Proxy generation (your subclass is wrapped at runtime).
- Lifecycle callbacks during construction.

These costs are amortized over a long-running server but real for startup. GraalVM native image especially struggles with reflection-heavy framework inheritance — reachability analysis can't see what reflection will resolve.

Mitigation: minimize the framework subclass (delegate to composed collaborators); use frameworks designed for native compilation (Quarkus, Micronaut) when startup matters.

---

## 9. Bench — composition chain vs inheritance chain

```java
@State(Scope.Benchmark)
public class DispatchBench {
    static abstract class AbstractAnimal { public abstract void greet(); }
    static final class Dog extends AbstractAnimal { public void greet() { /* ... */ } }
    static final class Cat extends AbstractAnimal { public void greet() { /* ... */ } }
    static final class Cow extends AbstractAnimal { public void greet() { /* ... */ } }

    AbstractAnimal[] animals = { new Dog(), new Cat(), new Cow(), new Dog(), new Cat() };

    @Benchmark public void inheritance() {
        for (AbstractAnimal a : animals) a.greet();    // megamorphic call site
    }
}
```

Typical results on JDK 21 (per iteration of 5 animals):

| Bench                              | ns/op | Notes                                |
|------------------------------------|-------|--------------------------------------|
| One concrete type (monomorphic)    | ~2    | Fully inlined                        |
| Two concrete types (bimorphic)     | ~3    | Two inlined arms                     |
| Three concrete types (megamorphic) | ~8    | Real vtable dispatch                 |
| Sealed types + pattern switch      | ~3    | Same as bimorphic — type check chain |

The headline: when types proliferate at one call site, sealed-type pattern dispatch is consistently faster than open inheritance — because the JIT can lower the switch to a type-check chain, while open inheritance falls back to itable lookup.

---

## 10. Quick rules — performance and FBCP

- [ ] Default `final` on new classes: CHA inlines aggressively.
- [ ] Sealed types are usually faster than open hierarchies for closed variant sets.
- [ ] Never invoke virtual methods from constructors — kills EA *and* opens FBCP.
- [ ] Avoid `Cloneable` — both FBCP risk and native-method overhead.
- [ ] Deep inheritance bloats metaspace and slows class loading.
- [ ] Composition with a `final` interface impl is the JIT's best case for decoupling.
- [ ] Framework-mandated inheritance: minimize the subclass, delegate via composition.
- [ ] Wire chains once at startup, hold in `final` fields, don't reconfigure mid-flight.
- [ ] For native image (GraalVM), shallow inheritance + composition reduces binary size.
- [ ] When profiling shows megamorphic dispatch as a bottleneck, refactor to sealed types or composition.

The general law: FBCP's design fixes — `final`, `sealed`, composition — are also the performance fixes. The JIT rewards code that's easy to reason about; the easiest code to reason about is code without an open inheritance contract. Modern Java has tightened the alignment between maintainability and speed: design well, and the runtime follows.
