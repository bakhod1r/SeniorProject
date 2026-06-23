# Composition Over Inheritance — Optimize

> *Composition* is a design choice. The JVM is a runtime. The two meet at three places: virtual dispatch (one indirection per layer), allocation (each composed object is a header plus fields), and class-hierarchy assumptions the JIT uses to devirtualize. This file walks ten optimization angles where the heuristic costs cycles, and how to keep them cheap. All numbers are illustrative; verify in your environment with JMH.

---

## 1. Dispatch cost: `invokevirtual` vs `invokeinterface` vs `final`

The most common composition shape is *constructor-inject an interface, call its method*. That call goes through `invokeinterface`. The most common inheritance shape is *override a non-final method on a non-final class*. That call goes through `invokevirtual`. The third option — a `final` class with `final` methods — gets the JIT to emit a direct call.

| Style                                             | Bytecode         | Best-case (monomorphic, JIT inlined) | Worst-case (megamorphic) |
|---------------------------------------------------|------------------|--------------------------------------|--------------------------|
| `final` class, `final` method (no override)       | `invokevirtual`  | ~0 ns (inlined)                      | ~0 ns (still inlined)    |
| Composed interface field, monomorphic             | `invokeinterface`| ~0 ns (inlined)                      | ~1–2 ns                  |
| Open class with overridable method                | `invokevirtual`  | ~0 ns (inlined)                      | ~5–10 ns                 |
| Composed interface field, megamorphic call site   | `invokeinterface`| —                                    | ~10–15 ns                |

The headline: *for monomorphic call sites, composition and inheritance cost the same — both inline*. The cost difference shows up only when the call site sees three or more types and the JIT falls back to a real itable/vtable lookup. Composition tends toward more interfaces, and interfaces dispatch slower than classes at the megamorphic case.

**Inspect:** `-XX:+UnlockDiagnosticVMOptions -XX:+PrintInlining` shows `(inlined)`, `(bimorphic)`, `(virtual call)` at each call site.

---

## 2. Wrapper layers and indirection chains

A composition pattern that bites:

```java
PaymentGateway g = new RetryingGateway(
                       new LoggingGateway(
                           new TimingGateway(
                               new StripeGateway())));
g.charge(req);  // four method calls per logical call
```

Four layers means four `invokeinterface` calls per logical `charge`. The JIT's job is to *prove* each call site is monomorphic — i.e., the `delegate` field of `RetryingGateway` is always a `LoggingGateway`, the `delegate` of `LoggingGateway` is always a `TimingGateway`, etc. — and inline through all four.

Two conditions help:

- **Each wrapper is a `final` class with a `final` field.** The JIT knows the field can't be reassigned.
- **Wire once, at startup, hold in a `final` field.** No per-request reconfiguration. The whole tower collapses to one fused call.

When the chain is rebuilt per request — or the same wrapper class wraps different concretes at different call sites — the JIT can't specialize. The cost grows linearly with depth.

**Mitigation:**

- Collapse cross-cutting wrappers into a single dispatcher when they exceed three layers.
- For very hot paths, hoist the chain into a `static final` field so the entire dispatch is monomorphic from JIT warmup.

---

## 3. Records and escape analysis

Records are the spec-blessed shape for value-composition (§8.10). They are *also* one of the friendliest shapes for the JIT's escape analysis (EA).

```java
public record Money(long cents, Currency currency) {
    public Money plus(Money other) {
        if (!currency.equals(other.currency)) throw new IllegalArgumentException();
        return new Money(cents + other.cents, currency);
    }
}
```

Inside a hot loop, `plus(...)` allocates an intermediate `Money` per iteration:

```java
Money total = Money.ZERO;
for (Money m : prices) total = total.plus(m);
```

That looks expensive. EA frequently proves the intermediate never escapes the loop, then *scalar-replaces* it: the two fields (`cents`, `currency`) live in registers, no heap allocation occurs.

EA likes records because:

- They are implicitly `final` — no subclass can capture `this` and leak the reference.
- Their accessors are tiny and inline.
- They have no mutable fields — no later method can mutate and escape.

**Confirm:** `-XX:+UnlockDiagnosticVMOptions -XX:+PrintEliminateAllocations` lists scalar-replaced allocations.

Composition of records is essentially free in tight loops. Inheritance of mutable classes is the opposite — EA gives up the moment a non-final subclass *could* exist.

---

## 4. `final` and class-hierarchy analysis (CHA)

The JIT's class-hierarchy analysis tracks which classes implement which interfaces and which methods are overridden. When CHA proves a method has *one* implementation reachable through a particular type, the JIT can:

- Emit a direct call (no vtable lookup).
- Inline the body unconditionally.

`final` classes and `final` methods are CHA's friends. They guarantee no subclass will ever appear; the inlining decision is permanent.

```java
public final class JdbcOrderRepository implements OrderRepository {
    public Order load(OrderId id) { ... }
}

// Composition: one implementation, JIT sees CHA proof of monomorphism
public final class OrderService {
    private final OrderRepository repo;          // observed type: JdbcOrderRepository
    public Order get(OrderId id) { return repo.load(id); }   // inlined as direct call
}
```

Composition without `final` works against CHA: if another `OrderRepository` could be loaded into the same field, the JIT pessimistically keeps a virtual call (which it still inlines at the bimorphic case, just less aggressively).

**Rule:** mark composed implementations `final` unless they're explicitly designed for extension. CHA pays you back in better inlining.

---

## 5. Sealed types + pattern matching — the JIT-friendly OCP

When the closed set is known, sealed types deliver inheritance with composition-like dispatch performance.

```java
public sealed interface Op permits Add, Sub, Mul {}
public record Add(long a, long b) implements Op {}
public record Sub(long a, long b) implements Op {}
public record Mul(long a, long b) implements Op {}

public static long apply(Op op) {
    return switch (op) {
        case Add a -> a.a() + a.b();
        case Sub s -> s.a() - s.b();
        case Mul m -> m.a() * m.b();
    };
}
```

The `permits` clause is a class-file attribute (`PermittedSubclasses`, §4.7.31). C2 knows the receiver belongs to a finite, compile-time-known set. The pattern-match `switch` lowers to a `typeswitch` bootstrap that C2 specializes into a type-check chain or, when shapes align, a table jump.

Performance characteristics:

- **No vtable.** The dispatch is a series of `instanceof`-style type tests on `Object` headers (or, for sealed records, a flag on the synthetic `typeswitch` indy).
- **Each arm inlines its own arithmetic.** No interface call inside the branch.
- **No allocation when the records' fields are scalar-replaced.**

In a microbenchmark, sealed-switch is typically *faster than* polymorphic interface dispatch when the same call site sees multiple types (because polymorphic falls back to itable lookup; sealed-switch is a branch chain the predictor learns).

---

## 6. Composition vs decorator-cost in tight loops

In a hot loop, every wrapper layer is one method call worth of cost. The pragmatic threshold:

- **1–2 layers:** invisible. JIT inlines through both.
- **3–4 layers:** measurable if the call is the loop body — a few percent at most.
- **5+ layers:** real cost, especially with `invokeinterface` and any per-request configuration.

```java
// Hot loop in a batch processor
for (Order o : orders) {
    gateway.charge(o.payment());     // 5-layer composition above this call
}
```

If profiling shows `gateway.charge` dominating, options:

1. **Hoist the chain.** If the layers don't need per-order state, the layers can be computed once outside the loop.
2. **Collapse the chain.** A single wrapper that knows it does retry+log+time+audit in one method body avoids three dispatches.
3. **Specialize the loop.** Two loops, one per concrete branch; dispatch once before the loop.
4. **Direct call.** If profiling justifies it, hold a concrete `StripeGateway` in this one place and accept the composition violation for the hot path.

Each option is local — the rest of the code keeps the composition design. SRP is intact; the hot loop is faster.

---

## 7. Class-loader and footprint differences

Inheritance:

```java
class A { ... }                          // 1 class, 1 vtable
class B extends A { ... }                // 1 class, vtable inherits A's slots + adds B's
class C extends B { ... }                // 1 class, vtable inherits B's + adds C's
```

Three classes loaded. Each class has its method table; each table is incrementally extended.

Composition (equivalent functionality):

```java
class A { ... }                          // 1 class
class B { A a; ... }                     // 1 class, holds an A
class C { B b; ... }                     // 1 class, holds a B
```

Same class count. *But*: each composed object now has an additional object header per layer. For a deeply composed value, that's measurable:

- One object header is 12–16 bytes on a 64-bit HotSpot (compressed oops vs not).
- Three layers = three headers = ~36–48 bytes of pure overhead per instance.

For a `final class Address { String street; String city; String zip; }` used as a record-style value, composition through three wrappers triples the per-instance footprint.

**Mitigation:**

- Use records — same value-semantics, single instance.
- Value classes (Project Valhalla, JEP 401) eliminate the header per layer for flat composition. The "use records, let EA/Valhalla catch up" advice strengthens.

---

## 8. Project Valhalla — flat composition

Valhalla's value classes eliminate the dual cost of composition: indirection and allocation overhead.

```java
public value record Point(double x, double y) implements Comparable<Point> {
    public int compareTo(Point o) { /* ... */ }
}
```

- **No identity.** No header. No object pointer.
- **Flat arrays.** `Point[]` becomes `[x y x y x y ...]` instead of an array of pointers to heap objects.
- **Flat fields.** A class holding a `Point` field stores the two doubles inline, not a reference.

Composition that today incurs a heap allocation per intermediate value will, with value classes, incur zero. The composition heuristic survives Valhalla unchanged — it just gets cheaper.

Design with records as if Valhalla were imminent: implicitly `final`, no identity, no mutation. The shape that helps EA today benefits doubly when value classes ship.

---

## 9. Microbenchmark — composition layers vs inheritance

A worked JMH harness comparing three styles for the same dispatch.

```java
@BenchmarkMode(Mode.AverageTime)
@OutputTimeUnit(TimeUnit.NANOSECONDS)
@State(Scope.Benchmark)
@Fork(value = 2, jvmArgsAppend = "-XX:+UseSerialGC")
@Warmup(iterations = 5, time = 1)
@Measurement(iterations = 10, time = 1)
public class DispatchBench {

    interface Adder { long add(long a, long b); }

    static final class DirectAdder implements Adder {
        public long add(long a, long b) { return a + b; }
    }
    static final class LoggedAdder implements Adder {
        private final Adder delegate;
        LoggedAdder(Adder d) { delegate = d; }
        public long add(long a, long b) { return delegate.add(a, b); }
    }
    static final class TimedAdder implements Adder {
        private final Adder delegate;
        TimedAdder(Adder d) { delegate = d; }
        public long add(long a, long b) { return delegate.add(a, b); }
    }

    static abstract class AbstractAdder {
        public long add(long a, long b) { return a + b; }
    }
    static final class InheritedAdder extends AbstractAdder { }

    Adder direct  = new DirectAdder();
    Adder twoLayer  = new LoggedAdder(new DirectAdder());
    Adder threeLayer = new TimedAdder(new LoggedAdder(new DirectAdder()));
    AbstractAdder inherited = new InheritedAdder();

    @Benchmark public long direct()       { return direct.add(1L, 2L); }
    @Benchmark public long twoLayer()     { return twoLayer.add(1L, 2L); }
    @Benchmark public long threeLayer()   { return threeLayer.add(1L, 2L); }
    @Benchmark public long inherited()    { return inherited.add(1L, 2L); }
}
```

Typical results on a modern x64 JDK 21:

| Bench         | Throughput | Notes                                                |
| ------------- | ---------- | ---------------------------------------------------- |
| `direct`      | ~1.0 ns/op | One layer, JIT inlines fully                         |
| `twoLayer`    | ~1.0 ns/op | Two layers, both inlined (monomorphic CHA)           |
| `threeLayer`  | ~1.0 ns/op | Three layers, all inlined                            |
| `inherited`   | ~1.0 ns/op | Same — `AbstractAdder.add` is monomorphic via CHA    |

The headline: in the monomorphic case, *composition costs nothing*. The cost only appears when the same call site sees multiple concretes (megamorphic), and the JIT loses CHA.

Run with two different concretes plugged in to the same chain and the picture changes:

| Bench (megamorphic)      | Throughput | Notes                                              |
| ------------------------ | ---------- | -------------------------------------------------- |
| `twoLayer` (2 types)     | ~3 ns/op   | Bimorphic, two inlined arms                        |
| `threeLayer` (3 types)   | ~8 ns/op   | Megamorphic, real itable lookup                    |

The takeaway: composition is free when call sites are stable; expensive when reconfigured per call.

---

## 10. Quick rules — performance and composition

- [ ] **Profile says so.** Don't denormalize composition without a flame graph.
- [ ] **Mark composed implementations `final`.** CHA pays it back in inlining.
- [ ] **Wire once at startup.** Per-request reconfiguration kills the JIT's specialization.
- [ ] **Records for value composition.** Free `equals`/`hashCode`, EA-friendly, Valhalla-ready.
- [ ] **Sealed types for closed families.** Inheritance with composition-like dispatch performance.
- [ ] **Collapse deep chains.** Five-plus layers of cross-cutting decorators usually compress to one dispatcher.
- [ ] **Hoist out of loops.** Composition decisions belong outside hot iterations.
- [ ] **Avoid mutable wrappers.** Mutability blocks EA and pessimizes CHA.
- [ ] **Document deliberate violations.** A comment `// concrete on purpose: profile X` keeps the next maintainer honest.

The general law: design with composition first, measure, then break the abstraction the profiler points at. Most production code never reaches the threshold where composition cost matters. For the 1% that does, the techniques in sections 5 (sealed), 6 (collapse), 7 (records), and 8 (Valhalla) buy back most of the loss without abandoning the heuristic wholesale.
