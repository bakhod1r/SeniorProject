# GRASP — Optimize (Reduce Coupling, Raise Cohesion)

> For a design topic, "optimize" doesn't mean shaving nanoseconds — it means lowering the *cost of change*. This file gives measurable before/after refactors driven by GRASP, using concrete metrics (CBO, LCOM4, fan-out, change-fan-out) as the optimization target. Each section states the metric, shows the move, and quantifies the improvement so the gain is defensible, not aesthetic. The last section covers the one place GRASP *does* touch runtime cost: indirection layers.

---

## 1. The optimization target: change cost, measured

You can't optimize what you don't measure. The proxies for GRASP's two evaluators:

| Optimize | Metric | What "better" looks like |
| --- | --- | --- |
| Low Coupling | **CBO** (coupling between objects) | fewer distinct collaborator classes per class |
| Low Coupling | **fan-out** | fewer outgoing dependencies |
| High Cohesion | **LCOM4** (lack of cohesion of methods) | → 1 (all methods connected via shared fields) |
| High Cohesion | **WMC** (weighted methods per class) | redistributed, no single god class |
| Change cost | **change-fan-out** | files touched when requirement X changes |

The deep treatment of these is in [../02-oo-metrics-ck-suite/](../02-oo-metrics-ck-suite/). Here they're the *scoreboard* for GRASP refactors. Tools: `ckjm` (CK metrics from bytecode), IntelliJ *Metrics Reloaded*, SonarQube.

---

## 2. Split a god service — LCOM4 and WMC, measured

**Before:** one `OrderService` doing pricing, persistence, notification, audit, and validation.

```java
class OrderService {
    private final DataSource ds;
    private final SmtpClient smtp;
    private final AuditLog audit;

    BigDecimal total(Order o)        { /* uses none of the fields */ }
    void validate(Order o)           { /* uses none of the fields */ }
    void save(Order o)               { /* uses ds */ }
    void notify(Order o)             { /* uses smtp */ }
    void record(Order o)             { /* uses audit */ }
}
```

**Metric before (illustrative `ckjm` run):** `WMC ≈ 18`, `CBO ≈ 11`, **`LCOM4 = 4`** — four disjoint method groups (the methods cluster around *different* fields, or none), the textbook cohesion failure.

**After:** apply Information Expert (pricing/validation → `Order`), Pure Fabrication (persistence → `OrderRepository`, notify → `Notifier`, audit → `AuditLog`).

```java
class OrderPlacer {                       // pure orchestration
    private final OrderRepository repo;
    private final Notifier notifier;
    private final AuditLog audit;
    void place(Order order) {             // every method uses the fields
        repo.save(order);
        notifier.notify(order);
        audit.record(order);
    }
}
```

**Metric after:** `OrderPlacer` has **`LCOM4 = 1`** (every method touches the injected collaborators — connected), `WMC` redistributed (pricing/validation moved to `Order`, ~3 methods each across four classes), and *no single class* carries the original `CBO = 11`. **The improvement is the LCOM4 drop from 4 → 1 and the elimination of any class with the original coupling.** That's a quantified cohesion win, not a vibe.

---

## 3. Cut domain→infrastructure coupling — CBO, measured

**Before:** the domain entity imports JDBC.

```java
class Invoice {            // CBO counts: java.sql.Connection, DriverManager, PreparedStatement, ...
    void save() { try (var c = DriverManager.getConnection(URL)) { /* ... */ } }
}
```

`Invoice`'s CBO includes 3–4 `java.sql` types *plus* its domain collaborators. Worse, the coupling is to *unstable* infrastructure.

**After:** Pure Fabrication + Indirection.

```java
class Invoice { /* zero infrastructure imports */ }
interface InvoiceRepository { void save(Invoice i); }
class JdbcInvoiceRepository implements InvoiceRepository { /* the java.sql coupling lives HERE */ }
```

**Measured win:** `Invoice`'s CBO drops by the count of `java.sql` types it referenced (typically 3–5), and — the part metrics undersell — those couplings move from a *high-churn* class (the domain entity, edited for every business rule) to a *low-churn* class (the repository, edited only when persistence changes). The right metric here is **change-fan-out**: "change the database" now touches *one* file (`JdbcInvoiceRepository`) instead of recompiling the entity and everything depending on it.

---

## 4. Replace a type-switch — measure the change-fan-out

The Polymorphism refactor's payoff isn't CPU; it's the *blast radius of adding a type*.

**Before (switch):** adding a new shape edits `area()`, `perimeter()`, `draw()`, `boundingBox()` — every method that switches on the type. **Change-fan-out to add a type = N methods.**

**After (sealed + polymorphism):** adding a shape adds *one class* implementing the interface; the compiler's exhaustiveness check flags anything missed. **Change-fan-out to add a type = 1 class, 0 edits to existing code.**

```java
public sealed interface Shape permits Circle, Square, Triangle {
    double area(); double perimeter();   // exhaustiveness enforced at compile time
}
public record Triangle(double base, double height, double a, double b, double c)
        implements Shape {                // the ONLY file you add
    public double area()      { return 0.5 * base * height; }
    public double perimeter() { return a + b + c; }
}
```

**Measured win:** change-fan-out for "add a shape" goes from *O(number of operations)* to *O(1)*. For a `Shape` with 6 operations, that's a 6× reduction in files touched per new type — the OCP dividend, quantified.

---

## 5. The runtime cost of Indirection — the one place to benchmark

Indirection and Protected Variations *do* add runtime cost: an extra virtual call through an interface. This is where you should actually reach for JMH before deciding.

```java
@State(Scope.Thread)
public class DispatchBench {
    interface Op { int apply(int x); }
    static final Op iface = x -> x + 1;            // invokeinterface
    static int direct(int x) { return x + 1; }     // invokestatic, inlinable

    @Benchmark public int viaInterface() { return iface.apply(7); }   // indirection
    @Benchmark public int viaDirect()    { return direct(7); }        // no indirection
}
```

**What you'll measure:** with a *monomorphic* call site (the JIT sees one implementation), the interface call is inlined and the two are *indistinguishable* — the indirection is free at runtime. The cost appears only at *megamorphic* call sites (the JIT sees 4+ implementations and can't inline), where `invokeinterface` falls back to a vtable/itable lookup, costing a few nanoseconds per call.

**The optimization rule:** Indirection's runtime cost is *zero* in the common (mono/bi-morphic) case and *negligible* even when megamorphic. So the real cost of indirection is **cognitive**, not runtime — which means you optimize it the same way: add interfaces for genuine variation, not on spec. Don't let "virtual calls are slow" justify removing a justified abstraction; the JIT erases that cost. (Dispatch internals: [../../06-method-dispatch-and-internals/](../../06-method-dispatch-and-internals/) if populated.)

---

## 6. Don't over-optimize the design — the cohesion-of-the-whole metric

A subtle failure: you can drive every *class's* metrics to perfection and end up with a *system* that's harder to change because one CRUD operation now spans ten micro-classes. GRASP's evaluators apply at the *package/module* level too.

**Symptom:** to add one field to an order, you edit `Order`, `OrderDto`, `OrderEntity`, `OrderMapper`, `OrderRepository`, `OrderService`, `OrderValidator`, `OrderController`, `OrderResponse` — **change-fan-out of 9 for a one-field change.** Each class is individually cohesive and uncoupled; the *whole* is over-decomposed.

**The optimization:** measure change-fan-out for *representative changes*, not just per-class metrics. If adding a field touches nine files, your decomposition is too fine — collapse layers (e.g., let the entity *be* the domain object; drop the redundant mapper). The right target is **minimal change-fan-out for the changes you actually make**, which sometimes means *fewer*, more capable classes — the opposite of "extract everything."

---

## 7. Before/after summary — what to measure and report

| Refactor | Pattern | Metric to report | Typical win |
| --- | --- | --- | --- |
| Split god service | Expert + Pure Fabrication + High Cohesion | LCOM4 | 4 → 1 |
| Decouple domain from DB | Pure Fabrication + Indirection | CBO of entity; change-fan-out | −3 to −5 CBO; change-fan-out → 1 |
| Replace type-switch | Polymorphism | change-fan-out to add a type | O(ops) → O(1) |
| Restore Expert (Move Method) | Information Expert | LCOM4; Demeter chain length | LCOM down; chains shortened |
| Remove unearned interface | (anti-Indirection) | class count; runtime (JMH) | fewer classes; 0 runtime change |
| Collapse over-decomposition | High Cohesion at package level | change-fan-out per field add | 9 → 2–3 |

---

## 8. Quick rules

- [ ] Optimize *change cost*, not nanoseconds — the metrics are LCOM4, CBO, and change-fan-out.
- [ ] Splitting a god class should drive LCOM4 toward 1 and leave no class with the original CBO.
- [ ] Decoupling the domain from infrastructure is measured by the entity's CBO drop *and* by who churns: coupling should sit in low-churn classes.
- [ ] The Polymorphism refactor's payoff is change-fan-out for adding a type: O(operations) → O(1).
- [ ] Indirection's runtime cost is ~0 (the JIT inlines mono/bimorphic call sites); its real cost is cognitive — so add it for real variation only.
- [ ] Measure change-fan-out at the *package* level too — a one-field change touching nine files means you over-decomposed.

---

**Memorize this:** GRASP optimization means lowering the *cost of change*, and that cost is measurable — LCOM4 toward 1 (cohesion), CBO down and concentrated in low-churn classes (coupling), and change-fan-out per realistic edit (the bottom line). The Polymorphism refactor turns "add a type" from O(operations) edits to O(1). And the runtime cost of all this indirection? The JIT inlines it to zero in the common case — so optimize indirection for *readability*, never for speed.
