# Designing for Extension & Polymorphism — Find the Bug

Each snippet has an extensibility defect: a rigid/repeated conditional, a leaky abstraction, an unsafe-for-subclassing base class, a wrong-closure decision, or a broken seam evolution. Read, diagnose, then check the reveal.

---

## Bug 1 — The conditional that re-opens on every feature

```java
class Discount {
    Money apply(Cart cart, String code) {
        if (code.equals("SUMMER"))        return cart.total().times(0.90);
        else if (code.equals("VIP"))      return cart.total().times(0.80);
        else if (code.equals("BLACKFRI")) return cart.total().times(0.50);
        else                              return cart.total();
    }
}
```
**What's wrong?**

<details><summary>Reveal</summary>

`apply` is **closed to extension, open to modification**: every new promo re-opens this tested method, risking the cases that already work. The same `code` branching will reappear wherever discounts are described (a label method, an analytics tag) and drift out of sync.

**Fix:** a `DiscountRule` seam — `interface DiscountRule { boolean matches(String code); Money apply(Money total); }` — one implementation per promo, resolved from a registry/map. Adding a promo is a new class; `Discount` is never reopened. (Replace Conditional with Polymorphism, Fowler ch. 10.)
</details>

---

## Bug 2 — Leaky abstraction

```java
interface ReportExporter {
    GZIPOutputStream export(Report r);   // returns a concrete implementation type
}
```
**What's wrong?**

<details><summary>Reveal</summary>

The "abstraction" leaks its implementation: `GZIPOutputStream` welds every implementer to gzip. A plain or zstd exporter cannot satisfy this contract honestly, and callers now depend on a specific compression class too.

**Fix:** return the *domain/standard* type — `OutputStream export(Report r)`, or better `void export(Report r, OutputStream sink)` so the caller owns the stream. A seam must mention only stable, abstract types.
</details>

---

## Bug 3 — Overridable call in the constructor

```java
public class Widget {
    public Widget() { render(); }              // calls an overridable method
    protected void render() {}
}
public class LabeledWidget extends Widget {
    private final String label = "OK";
    @Override protected void render() {
        System.out.println(label.toUpperCase());
    }
}
// new LabeledWidget();
```
**What's wrong?**

<details><summary>Reveal</summary>

`new LabeledWidget()` throws **NullPointerException**. `super()` runs `Widget()`, which calls the overridden `render()` *before* `LabeledWidget`'s `label` field is initialized (JLS §12.5) — so `label` is `null`. Bloch Item 19: never invoke an overridable method from a constructor.

**Fix:** don't call overridable methods during construction. Do explicit post-construction initialization, or make `render` non-overridable (`final`/`private`), or use a factory that constructs first, then renders.
</details>

---

## Bug 4 — Undocumented self-use (fragile base class)

```java
public class AuditList<E> extends ArrayList<E> {
    private int writes = 0;
    @Override public boolean add(E e)                        { writes++; return super.add(e); }
    @Override public boolean addAll(Collection<? extends E> c){ writes += c.size(); return super.addAll(c); }
    public int writeCount() { return writes; }
}
```
**What's wrong?**

<details><summary>Reveal</summary>

`addAll` **double-counts**: `ArrayList.addAll` internally calls `add` per element, so each element bumps `writes` twice — once in the override of `addAll`, once via the inherited self-use of `add`. The subclass's correctness depends on `ArrayList`'s undocumented internal call pattern (the fragile base class problem). If the JDK rewrites `addAll` to `arraycopy`, the count silently changes again.

**Fix:** **compose** instead of extend — hold a `private final List<E> backing`, forward only the methods you mean to expose, count exactly once. The wrapped list's internal self-use can't reach your counters. See [../../03-design-principles/06-fragile-base-class-problem/](../../03-design-principles/06-fragile-base-class-problem/).
</details>

---

## Bug 5 — Sealed the plugin point

```java
// In a published library that customers extend:
public sealed interface PaymentGateway permits StripeGateway, PaypalGateway { }
public final class StripeGateway implements PaymentGateway { }
public final class PaypalGateway implements PaymentGateway { }
```
**What's wrong?**

<details><summary>Reveal</summary>

This is a **plugin/SPI point** sealed shut. A customer who needs `AdyenGateway` *cannot* add it — `permits` excludes them and they're in a different module. You closed the exact axis the abstraction exists to open. Sealing is for *complete, known* domain sets you own, not for outsider extension.

**Fix:** make it a plain (non-sealed) interface, discover providers via `ServiceLoader`/DI. Reserve `sealed` for things like `Result = Ok | Err` where the set is genuinely complete.
</details>

---

## Bug 6 — Adding an abstract method breaks implementers

```java
// v1, implemented by 5 external teams:
public interface MetricSink { void record(String name, double value); }

// v2 — "just one more method":
public interface MetricSink {
    void record(String name, double value);
    void flush();                       // new ABSTRACT method
}
```
**What's wrong?**

<details><summary>Reveal</summary>

Adding an `abstract` method is **binary-incompatible for implementers** (JLS §13). Every external `MetricSink` no longer satisfies the interface — compile error on recompile, `AbstractMethodError` at link time. You broke five teams.

**Fix:** add it as a `default` with a safe body — `default void flush() {}` — which *is* binary-compatible (§13.5.6). If `flush` is genuinely mandatory, version the SPI (`MetricSinkV2 extends MetricSink`) and migrate deliberately. Adding methods breaks implementers, not callers.
</details>

---

## Bug 7 — Polymorphism where a value-check belongs

```java
abstract class Account { abstract double interestRate(); }
class PositiveBalanceAccount extends Account { double interestRate() { return 0.02; } }
class NegativeBalanceAccount extends Account { double interestRate() { return 0.00; } }
// ...elsewhere, the program must REPLACE the object's class each time
// the balance crosses zero — swapping PositiveBalanceAccount <-> NegativeBalanceAccount
```
**What's wrong?**

<details><summary>Reveal</summary>

The variation is over a **value** (sign of the balance), not a stable *type*. Modeling it as subclasses means an account must *change its class* when the balance crosses zero — impossible in Java without recreating the object, and it scatters identity. This is over-engineering: a class hierarchy for an `if`.

**Fix:** one `Account` with `double interestRate() { return balance >= 0 ? 0.02 : 0.00; }`. Polymorphism replaces *type* switches, not arithmetic on changing values.
</details>

---

## Bug 8 — Repeated type-switch drifting out of sync

```java
String icon(Node n) {
    return switch (n.type()) { case FILE -> "📄"; case DIR -> "📁"; case LINK -> "🔗"; };
}
long size(Node n) {
    return switch (n.type()) { case FILE -> n.bytes(); case DIR -> n.childBytes(); };
    // LINK case forgotten — compiles because enum switch isn't exhaustive-checked the same way
}
```
**What's wrong?**

<details><summary>Reveal</summary>

The *same* `type()` branching is duplicated across `icon` and `size`, and `size` silently **omits `LINK`** — the duplication let the two switches drift. Each new `Node` kind forces edits to every switch, and nothing forces them to stay complete.

**Fix:** make behaviour live with the type. If the set is open/growing, use polymorphism: `Node.icon()` and `Node.size()` per subtype. If the set is closed and the operations external, make `Node` a **sealed** type and use exhaustive `switch` (no `default`) so a missing `LINK` case is a *compile error*.
</details>

---

## Bug 9 — Too many tiny hooks freeze the implementation

```java
public abstract class HttpClient {
    public final Response get(URI uri) {
        var conn   = openSocket(uri);        // hook
        var hdrs   = buildHeaders(uri);      // hook
        var raw    = writeRequestLine(conn); // hook
        var status = readStatusLine(conn);   // hook
        var body   = readBody(conn);         // hook
        return assemble(status, hdrs, body); // hook
    }
    protected abstract Socket openSocket(URI uri);
    protected abstract Map<String,String> buildHeaders(URI uri);
    protected abstract Object writeRequestLine(Socket s);
    protected abstract String readStatusLine(Socket s);
    protected abstract byte[] readBody(Socket s);
    protected abstract Response assemble(String s, Map<String,String> h, byte[] b);
}
```
**What's wrong?**

<details><summary>Reveal</summary>

Every internal step is a `protected abstract` hook, so the *entire* HTTP implementation is now frozen public API. You can never refactor `get`'s internals (merge steps, reorder, change a signature) without breaking every subclass. The seam granularity is far too fine — these are implementation steps, not decision points.

**Fix:** expose *few, meaningful* hooks at real decision points (e.g. `authenticate(req)`, `onRetry(attempt)`), keep the wire mechanics `private`. Prefer composing a `Transport` strategy over subclassing the whole client. Each `protected` member is a forever-promise — spend them sparingly.
</details>

---

## Bug 10 — `instanceof` ladder that should be exhaustive

```java
sealed interface Shape permits Circle, Square, Triangle {}
double area(Shape s) {
    if (s instanceof Circle c)        return Math.PI * c.r() * c.r();
    else if (s instanceof Square q)   return q.side() * q.side();
    else                              return 0;   // catch-all "else"
}
```
**What's wrong?**

<details><summary>Reveal</summary>

The type is `sealed` — the compiler *could* prove exhaustiveness — but the `else { return 0; }` **throws that guarantee away**. `Triangle` falls into the catch-all and silently returns `0`. Adding a 4th variant also silently hits `else`. The whole benefit of sealing (compiler-checked completeness) is lost.

**Fix:** use an exhaustive pattern `switch` with **no `default`**:
```java
double area(Shape s) {
    return switch (s) {
        case Circle c   -> Math.PI * c.r() * c.r();
        case Square q   -> q.side() * q.side();
        case Triangle t -> 0.5 * t.base() * t.height();
    };                                  // missing a case = compile error
}
```
Now omitting `Triangle` won't compile, and a new variant produces an error at every switch. See [../../05-advanced-language-features/01-sealed-classes-and-pattern-matching/](../../05-advanced-language-features/01-sealed-classes-and-pattern-matching/).
</details>

---

## Bug 11 — Non-final class with a `protected` field, no design

```java
public class RateLimiter {
    protected long tokens;                     // exposed mutable internal
    protected long capacity;
    public boolean tryAcquire() { if (tokens > 0) { tokens--; return true; } return false; }
}
```
**What's wrong?**

<details><summary>Reveal</summary>

`RateLimiter` is implicitly open to subclassing and exposes `tokens`/`capacity` as `protected` mutable fields — accidental, undesigned inheritance surface. A subclass can corrupt the invariant (`tokens <= capacity`), and you can never change the internal representation (e.g. to a timestamp-based algorithm) without breaking subclasses. This is fragile-base-class bait.

**Fix:** mark the class `final` (the default for an ordinary class, Bloch Item 19) and make the fields `private`. If extension is genuinely needed, *design* it: a documented `protected` hook, `private` state, documented self-use — not raw exposed fields.
</details>

---

## Bug 12 — The "flexible" config seam nobody uses

```java
public interface IdGenerator { String next(); }
public final class UuidIdGenerator implements IdGenerator {
    public String next() { return UUID.randomUUID().toString(); }
}
// ...wired through 30 classes via constructor injection.
// There is exactly ONE implementation and no plan for another.
```
**What's wrong?**

<details><summary>Reveal</summary>

This is **speculative generality**: a seam with a single implementation, no second on the roadmap, threaded through 30 constructors. It adds indirection, a wider surface, and reading cost while protecting *nothing* — OCP protects callers from *variation that exists*, and there is none. (Protected Variations requires *predicted* variation, not imagined.)

**Fix:** inline it — call `UUID.randomUUID().toString()` (or a static helper) directly. Introduce the `IdGenerator` seam *when* a real second generator appears; the refactor is cheap with tests. "We might need it" is not evidence.
</details>

---

### How to practice

For each bug, before reading the reveal, name (a) the defect category — rigid conditional / leaky abstraction / unsafe inheritance / wrong closure / bad seam evolution / speculative seam — and (b) the *axis of change* it gets wrong. That two-part diagnosis is exactly what a senior reviewer produces in seconds.
