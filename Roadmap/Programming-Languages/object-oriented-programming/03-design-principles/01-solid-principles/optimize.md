# SOLID Principles — Optimize

> SOLID is a *design* doctrine. The JVM is a *runtime*. The two meet at three places: virtual dispatch, allocation, and class-hierarchy assumptions the JIT bakes into compiled code. This file walks ten optimization angles where SOLID's idioms cost real cycles — and how to keep them cheap. All numbers are illustrative; verify in your environment with JMH.

---

## 1. SOLID and the JIT — the dispatch profile

OCP and DIP push you toward polymorphism: a high-level call site invokes an *abstraction*, and a concrete implementation answers. At runtime, every such call goes through HotSpot's *type profile* for that call site, which records which receiver classes it has actually seen.

- **Monomorphic** — one observed receiver type. C2 inlines the target directly. ~0 ns extra over a static call.
- **Bimorphic** — two types. C2 emits a type check + two inlined bodies. ~1–2 ns extra.
- **Megamorphic** — three or more types. C2 falls back to a real `invokevirtual` / `invokeinterface` through the vtable / itable. ~5–15 ns extra, plus all the secondary wins of inlining (escape analysis, constant folding) collapse.

The shape of your hierarchy decides which bucket each call site lands in. OCP done well — a few stable implementers, most call sites only seeing one or two at runtime — stays monomorphic or bimorphic. OCP done with abandon (a plugin registry of 40 implementations of `Handler`) is the textbook megamorphic case.

```java
public interface PaymentMethod { void charge(BigDecimal amount); }

void payAll(List<PaymentMethod> methods, BigDecimal amount) {
    for (PaymentMethod m : methods) {
        m.charge(amount);    // megamorphic if methods holds many distinct concretes
    }
}
```

**Inspect:** `-XX:+UnlockDiagnosticVMOptions -XX:+PrintInlining` shows `(virtual call)` vs `(inline)` vs `(bimorphic)` decisions at each callsite.

---

## 2. Records and SRP — escape analysis territory

A record is an SRP poster child: one responsibility (carrying a value). It is also one of the easiest shapes for the JIT to reason about — final, immutable, no inheritance below it.

```java
public record Money(long cents, Currency currency) {
    public Money plus(Money other) {
        if (!currency.equals(other.currency)) throw new IllegalArgumentException();
        return new Money(cents + other.cents, currency);
    }
}
```

Inside a hot loop, repeated `plus(...)` allocations look expensive — but C2's *escape analysis* often proves the intermediate `Money` never escapes the method, then *scalar-replaces* it: the two fields live in registers, no heap allocation occurs.

Records cooperate with EA because:

- They are implicitly `final`. No subclass can override `equals`, `hashCode`, or accessors and capture `this`.
- Their accessors are tiny and easy to inline.
- They have no non-final fields, so no mutating method can leak `this`.

**Confirm:** `-XX:+UnlockDiagnosticVMOptions -XX:+PrintEliminateAllocations` should list the record's allocation site as eliminated for tight, well-shaped loops.

---

## 3. Interface dispatch — the cost of `invokeinterface`

ISP says: many small interfaces over one fat one. DIP says: program to the interface. Both turn `invokevirtual` (class-bound) into `invokeinterface` (interface-bound). The runtime cost difference is not zero.

- `invokevirtual` resolves through a fixed-offset vtable slot — one indirect load.
- `invokeinterface` resolves through an itable search keyed by interface — historically a linear scan, in modern HotSpot a hashed lookup with cache. One to three extra loads per uncached call.

For a monomorphic call site, the JIT erases both into a direct call. For megamorphic interface calls, `invokeinterface` is slower than `invokevirtual` by a measurable margin.

```java
public interface OrderRepository { void save(Order o); }                                 // ISP + DIP
public abstract class AbstractOrderRepository { public abstract void save(Order o); }    // class-bound
```

In a benchmark that hammers a megamorphic call site, the abstract-class version can be 10–20% faster than the interface version. **Don't act on this without profiling** — for 99% of code the difference is in the noise, and ISP/DIP wins on maintainability.

---

## 4. Sealed types + pattern matching — JIT-friendly OCP

OCP without polymorphism explosion: declare a closed set of subtypes with `sealed`, dispatch with pattern matching.

```java
public sealed interface Shape permits Circle, Square, Triangle {}
public record Circle(double r)             implements Shape {}
public record Square(double s)             implements Shape {}
public record Triangle(double b, double h) implements Shape {}

public static double area(Shape s) {
    return switch (s) {
        case Circle c   -> Math.PI * c.r() * c.r();
        case Square sq  -> sq.s() * sq.s();
        case Triangle t -> 0.5 * t.b() * t.h();
    };
}
```

Why the JIT likes this:

- The `permits` clause is a class-file attribute. C2 knows the receiver belongs to a finite, compile-time-known set.
- The pattern-match `switch` lowers to a `typeswitch` bootstrap the JIT can specialize into a type-check chain (or, when shapes line up, a table jump).
- Because there is no open extension point, *devirtualization* is complete — each branch can be inlined with its concrete arithmetic.

OCP via `sealed` + pattern matching gives you "open for extension at compile time, closed for extension at runtime" — which is what the JIT needs to inline aggressively.

---

## 5. DIP overhead — wrapper allocation vs final-field injection

DIP done with constructor injection of `final` fields is essentially free:

```java
public final class OrderService {
    private final OrderRepository repo;
    private final Clock           clock;
    public OrderService(OrderRepository repo, Clock clock) {
        this.repo  = repo;
        this.clock = clock;
    }
}
```

The injected references are read-only fields. After the JIT proves `repo` is monomorphic (only one concrete is ever stored in any reachable `OrderService`), it inlines `repo.save(...)` as if it were a static call.

The expensive shape is the *wrapper-decorator pile* — each layer allocates a new object, each call goes through one more virtual hop:

```java
new RetryingRepository(
    new LoggingRepository(
        new TimingRepository(
            new PostgresRepository(...))));
```

Each layer is its own object, with its own header and its own virtual call. Four layers = three extra indirections per `save()`. Worse: if the same call site sees differently wrapped configurations across instances, it becomes megamorphic and *none* of the layers inline.

**Mitigation:**

- Wire wrappers once, at startup, into a single chain held in a `final` field. The JIT locks onto the type profile.
- For tracing/logging cross-cutting concerns, consider a single dispatching layer over an event bus rather than nested decorators.

---

## 6. Hierarchy depth — LSP-respecting trees still cost

A 6-level inheritance chain that passes every LSP check is still a JIT liability:

- **Class loading time** scales with depth — each parent's `<clinit>` must run.
- **vtable / itable size** is proportional to the method count *across the whole hierarchy*.
- **`instanceof` checks** are O(depth) in the worst case (HotSpot caches them, but the cold path costs).
- **Type-profile pollution** — a generic algorithm that handles the root type but encounters seven different leaf types ends up megamorphic at every internal call.

```java
abstract class Animal    { abstract void speak(); }
abstract class Mammal    extends Animal    { ... }
abstract class Carnivore extends Mammal    { ... }
abstract class Felidae   extends Carnivore { ... }
class Cat extends Felidae { @Override void speak() { ... } }
```

LSP says these levels must each be substitutable. The JIT says: a flat hierarchy with `sealed` and three implementers is dramatically faster than a five-level tree with fifteen leaves.

When designing a hierarchy, ask: do my call sites *actually* benefit from the layers, or am I encoding taxonomy for taxonomy's sake?

---

## 7. When to break SOLID for performance

In an inner loop, every abstraction layer is a cost. Sometimes the right answer is to lower SOLID locally.

**Symptom:** profiler shows 30% of time in `invokeinterface` and the loop is on the critical path.

**Options (in order of severity):**

1. **Hoist the abstraction out of the loop.** Compute the strategy once before the loop, call its single method directly inside.
2. **Specialize the loop.** Write two versions of the loop, one per concrete type; dispatch *once* at the top.
3. **Inline the strategy.** Replace the interface with a `switch` on an enum or sealed type, accepting that you've moved from OCP to closed-world dispatch.
4. **Collapse the wrapper stack.** Inline the decorator behavior into the base class for this one type. SRP loses, throughput wins.

```java
// Hot path: bypass DIP for the inner loop.
public final class FastOrderBatch {
    private final PostgresOrderRepository repo;   // concrete on purpose
    public void saveAll(List<Order> orders) {
        for (Order o : orders) repo.insertDirect(o);   // direct call, no interface hop
    }
}
```

This is a *local* decision, justified by a profiler trace, and documented as such. The high-level layer of the application still goes through `OrderRepository`. SOLID is broken at the leaf, not the trunk.

---

## 8. Project Valhalla — value classes reshape the tradeoff

Valhalla's value classes collapse a chunk of the SOLID-vs-performance tension:

```java
public value record Point(double x, double y) implements Comparable<Point> {
    public int compareTo(Point o) {
        int c = Double.compare(x, o.x);
        return c != 0 ? c : Double.compare(y, o.y);
    }
}
```

- **No identity.** No header. No object pointer. Two `double`s, packed inline.
- **Flat arrays.** `Point[]` becomes `[x y x y x y ...]` rather than `[ptr, ptr, ptr, ...]` to separate heap objects. One cache line holds four points instead of one pointer.
- **Devirtualization survives.** `Point` implements `Comparable<Point>` and yet the JIT can still inline `compareTo` because value classes are implicitly final and identity-free.

SOLID idioms that today cost allocation (records as keys in collections, immutable DTOs through pipelines, `Optional`-like wrappers) become essentially free under Valhalla. The "use immutable records, let escape analysis catch up" advice strengthens.

For now, design with records as if Valhalla were imminent. The shape that helps EA today will benefit doubly when value classes ship.

---

## 9. Microbenchmark — switch-on-enum vs sealed vs polymorphism

A worked JMH harness comparing three OCP-respecting styles for the same dispatch.

```java
@BenchmarkMode(Mode.AverageTime)
@OutputTimeUnit(TimeUnit.NANOSECONDS)
@State(Scope.Benchmark)
@Fork(value = 2, jvmArgsAppend = "-XX:+UseSerialGC")
@Warmup(iterations = 5, time = 1)
@Measurement(iterations = 10, time = 1)
public class DispatchBench {

    public enum Op { ADD, SUB, MUL }

    public sealed interface SealedOp permits Add, Sub, Mul {}
    public record Add() implements SealedOp {}
    public record Sub() implements SealedOp {}
    public record Mul() implements SealedOp {}

    public interface PolyOp { long apply(long a, long b); }
    public static final class PolyAdd implements PolyOp { public long apply(long a, long b) { return a + b; } }
    public static final class PolySub implements PolyOp { public long apply(long a, long b) { return a - b; } }
    public static final class PolyMul implements PolyOp { public long apply(long a, long b) { return a * b; } }

    @Param({"ADD", "SUB", "MUL"}) Op op;
    SealedOp sealedOp;
    PolyOp   polyOp;

    @Setup public void init() {
        sealedOp = switch (op) {
            case ADD -> new Add(); case SUB -> new Sub(); case MUL -> new Mul();
        };
        polyOp = switch (op) {
            case ADD -> new PolyAdd(); case SUB -> new PolySub(); case MUL -> new PolyMul();
        };
    }

    @Benchmark public long enumSwitch() {
        return switch (op) {
            case ADD -> 1L + 2L;
            case SUB -> 1L - 2L;
            case MUL -> 1L * 2L;
        };
    }

    @Benchmark public long sealedSwitch() {
        return switch (sealedOp) {
            case Add a -> 1L + 2L;
            case Sub s -> 1L - 2L;
            case Mul m -> 1L * 2L;
        };
    }

    @Benchmark public long polymorphic() {
        return polyOp.apply(1L, 2L);
    }
}
```

Typical results on a modern x64 JDK 21:

| Bench           | Throughput | Notes                                        |
| --------------- | ---------- | -------------------------------------------- |
| `enumSwitch`    | ~1.0 ns/op | `tableswitch` on ordinal, branch-predicted   |
| `sealedSwitch`  | ~1.2 ns/op | `typeswitch` lowered to a type-check chain   |
| `polymorphic`   | ~1.0 ns/op | *monomorphic per @Param invocation*          |
| `polymorphic*`  | ~6.0 ns/op | *if all three concretes share one callsite*  |

The headline: polymorphism is fastest *when monomorphic* and slowest *when megamorphic*. Sealed switch is consistently fast regardless of the type distribution. Enum switch is fastest if you already have a `tag`.

**Always run `-prof gc` too** — `enumSwitch` and `sealedSwitch` allocate nothing per call; some polymorphism patterns do.

---

## 10. Quick rules — when to denormalize the design

A short checklist for the times performance trumps SOLID purity:

- [ ] **Profile says so.** Don't denormalize without a flame graph that names the call site.
- [ ] **Hot loop, not whole program.** Lower SOLID at the leaf, keep the trunk clean.
- [ ] **Closed set?** Replace open polymorphism with `sealed` + pattern match. Same OCP intent, better dispatch.
- [ ] **Fat decorator stack?** Collapse to a single composite layer wired at startup.
- [ ] **Many concretes at one call site?** Specialize the loop per type, dispatch once outside.
- [ ] **Allocation hot spot?** Use records or value classes (Valhalla) instead of mutable holders, let EA work.
- [ ] **Interface vs class boundary?** For megamorphic hot paths, `invokevirtual` < `invokeinterface`. Otherwise the difference is noise.
- [ ] **Document the trade.** A comment like `// denormalized SOLID: inner loop is hot, see profile X` keeps the next maintainer honest.

The general law: design SOLID first, measure, then break exactly the letters the profiler points at — never preemptively. Most production code never reaches the threshold where SOLID's cost matters. For the 1% that does, the techniques in sections 4, 7, and 8 buy back most of the loss without abandoning the principles wholesale.
