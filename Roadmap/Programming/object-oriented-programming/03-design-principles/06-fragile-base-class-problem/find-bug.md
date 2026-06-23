# Fragile Base Class Problem — Find the Bug

> 10 buggy snippets where inheritance's open contract causes silent failures. For each: read the code, decide which FBCP form is in play (self-use change, accidental override, removed call, constructor virtual call, binary incompatibility), identify the *runtime symptom*, and write the fix.

---

## Bug 1 — Self-use change silently kills the override

```java
// Parent v1
public class Account {
    public void deposit(BigDecimal amount) {
        balance = balance.add(amount);
        notifyChange();
    }
    protected void notifyChange() { /* default no-op */ }
}

// Subclass — pre-existing
public class AuditedAccount extends Account {
    @Override protected void notifyChange() {
        super.notifyChange();
        audit.record("balance changed");
    }
}
```

Parent v2 refactors to publish to an event bus:

```java
public class Account {
    public void deposit(BigDecimal amount) {
        balance = balance.add(amount);
        events.publish(new BalanceChanged(id, amount));      // <-- new
        // notifyChange() removed
    }
    @Deprecated protected void notifyChange() { /* still here, but unused */ }
}
```

**Symptom.** `AuditedAccount` continues to compile. `deposit()` runs cleanly. But `audit.record(...)` never fires — the override is on a method that's no longer called from the workflow. The audit team discovers missing entries three months later during a compliance review.

**Violation.** FBCP form 1. The parent's *self-use* changed; the subclass's override is orphaned.

**Fix.** Two-pronged:

- **Parent side:** before removing the self-use, deprecate `notifyChange` with `@Deprecated(since = "5.0", forRemoval = true)` for a full release cycle. Subclasses get a compile warning.
- **Subclass side:** subscribe to `BalanceChanged` events instead of overriding `notifyChange`. Composition over inheritance for cross-cutting auditing.

```java
public final class AuditingSubscriber {
    @EventListener public void onBalanceChanged(BalanceChanged event) {
        audit.record("balance changed for " + event.accountId());
    }
}
```

---

## Bug 2 — Subclass accidentally overrides a new parent method

```java
// Parent v1
public class Repository {
    public void save(Object entity) { /* ... */ }
}

// Subclass
public class CachingRepository extends Repository {
    protected void invalidate(String key) { cache.remove(key); }   // protected helper
    @Override public void save(Object entity) {
        super.save(entity);
        invalidate(keyOf(entity));
    }
}

// Parent v2 — adds invalidate as a public hook
public class Repository {
    public void save(Object entity) { /* ... */ }
    public void invalidate(String key) { /* default: log only */ }
}
```

**Symptom.** `CachingRepository.invalidate` (a private helper, now accidentally an override of the parent's new public method) is silently exposed. A caller that does `repo.invalidate("user_123")` invokes the cache eviction — but for *every* `Repository` instance, not just `CachingRepository`. Calls on plain `Repository` instances also hit the cache logic somehow (no, they don't; they hit the parent's default — but the *signature* clash means the subclass's `invalidate` is now part of the public API it never meant to be).

Worse: subclass's `protected` becomes `public` accidentally (overrides must be *at least as accessible* per JLS §8.4.8.3, but the access modifier remains `protected` on the override — there's a compile failure only if the parent is `public`).

**Violation.** FBCP form 2. The subclass's helper accidentally collided with a new parent method.

**Fix.** Always use `@Override` on intentional overrides; without it, the helper would have remained a separate method. Renaming the subclass's helper to a more specific name (`evictFromCache`) avoids the collision.

```java
public class CachingRepository extends Repository {
    private void evictFromCache(String key) { cache.remove(key); }  // unique name
    @Override public void save(Object entity) {
        super.save(entity);
        evictFromCache(keyOf(entity));
    }
}
```

---

## Bug 3 — Virtual call in constructor sees null fields

```java
public class Parent {
    public Parent() {
        announce();         // virtual call in constructor
    }
    protected void announce() {
        System.out.println("parent constructed");
    }
}

public class Child extends Parent {
    private final String greeting;
    public Child(String g) {
        super();
        this.greeting = g;
    }
    @Override
    protected void announce() {
        System.out.println(greeting.toUpperCase());   // NPE
    }
}
```

**Symptom.** `new Child("hello")` throws NullPointerException. The stack trace:

```
Exception in thread "main" java.lang.NullPointerException
    Cannot invoke "String.toUpperCase()" because "this.greeting" is null
    at com.acme.Child.announce(Child.java:6)
    at com.acme.Parent.<init>(Parent.java:3)
    at com.acme.Child.<init>(Child.java:4)
```

**Violation.** JLS §12.5 initialization order: `super()` runs before subclass fields are assigned. The parent's virtual call dispatches to the subclass's override, which reads `this.greeting` — still `null`.

**Fix.** Never invoke overridable methods from constructors. Apply one of three remediations:

```java
// (a) Make announce non-virtual — final method
public final void announce() { ... }   // parent must do its own work

// (b) Use an initialization method called after construction
public class Child {
    public static Child create(String g) {
        Child c = new Child();
        c.greeting = g;
        c.announce();
        return c;
    }
    // ...
}

// (c) Use composition; the construction lifecycle is the constructor of the wrapper, not the wrapped
public final class Announcer {
    private final Child child;
    public Announcer(Child child) { this.child = child; this.child.announce(); }
}
```

---

## Bug 4 — Removed superclass method silently breaks the subclass

```java
// Parent v1
public class Service {
    protected void preProcess() { /* validation */ }
    public void run() { preProcess(); doWork(); }
    protected void doWork() { /* ... */ }
}

// Subclass
public class AuditedService extends Service {
    @Override protected void preProcess() {
        super.preProcess();
        audit.record("pre");
    }
}
```

Parent v2 — `preProcess` is now a no-op:

```java
public class Service {
    @Deprecated protected void preProcess() { /* now does nothing */ }
    public void run() {
        validator.validate(this);    // moved to a separate validator
        doWork();
    }
    protected void doWork() { /* ... */ }
}
```

**Symptom.** `AuditedService.run()` still calls (an empty) `preProcess` *through inherited code* — except the parent's `run` no longer calls `preProcess`. The audit step is silently skipped. Tests for `AuditedService` were green only because they were stubbing the parent.

**Violation.** FBCP form 3 (combined with form 1). The parent removed the self-use call; the subclass's override never fires.

**Fix.** Subscribe to a dedicated lifecycle event, not to an internal hook. Or fail loudly during the parent's transition by removing `preProcess` entirely so the subclass fails to compile (a managed migration via `@Deprecated(forRemoval=true)`).

---

## Bug 5 — Subclass calls `super.equals` that returns the wrong answer

```java
public class Point {
    int x, y;
    @Override public boolean equals(Object o) {
        if (!(o instanceof Point)) return false;
        Point p = (Point) o;
        return x == p.x && y == p.y;
    }
}

public class ColoredPoint extends Point {
    Color color;
    @Override public boolean equals(Object o) {
        if (!(o instanceof ColoredPoint)) return false;
        ColoredPoint cp = (ColoredPoint) o;
        return super.equals(cp) && color.equals(cp.color);
    }
}
```

**Symptom.**

```java
Point p = new Point(1, 2);
ColoredPoint cp = new ColoredPoint(1, 2, RED);
p.equals(cp);    // true — Point.equals accepts the subclass
cp.equals(p);    // false — ColoredPoint.equals rejects non-ColoredPoint
```

A `HashSet<Point>` containing `p` and queried with `cp` finds `p`; containing `cp` and queried with `p` doesn't find `cp`. Symmetry is broken; container behaviour becomes implementation-dependent.

**Violation.** FBCP at the equality protocol. Inheritance can't preserve the symmetry/transitivity required of `equals` when the subclass adds state.

**Fix.** Compose, don't extend.

```java
public final class ColoredPoint {
    private final Point point;
    private final Color color;
    @Override public boolean equals(Object o) {
        return o instanceof ColoredPoint c && c.point.equals(point) && c.color.equals(color);
    }
}
```

A `ColoredPoint` is not a `Point`; it *has* a point. The equality protocol is preserved because there's no inheritance to break it.

---

## Bug 6 — `final` added in a minor version breaks subclasses

A library's v5.0 release:

```java
// v4.x
public class TextNormalizer {
    public String normalize(String input) { ... }
}

// v5.0 — author adds final
public class TextNormalizer {
    public final String normalize(String input) { ... }
}
```

**Symptom.** Every consumer who extended `TextNormalizer` to specialize `normalize` fails to compile after upgrading. The library author thought the change was "internal hardening".

**Violation.** Binary incompatibility (JLS §13). Adding `final` is source-compatible for *callers* but binary-incompatible for *subclasses* — `NoSuchMethodError` at link time, or compile error on recompile.

**Fix.** The library should:

1. Run `japicmp` in CI; the build would have flagged this.
2. Deprecate first: in v5.0, mark `normalize` `@Deprecated` with a note "non-overridable in next major"; in v6.0, add `final`.
3. Or accept the binary-incompat and bump the major version (v6.0 instead of v5.0), making the breakage expected.

---

## Bug 7 — Deep inheritance chain hides which method runs

```java
abstract class BaseProcessor {
    public final void process() { before(); doWork(); after(); }
    protected void before()    { System.out.println("base before"); }
    protected void after()     { System.out.println("base after"); }
    protected abstract void doWork();
}
abstract class AbstractDomainProcessor extends BaseProcessor {
    @Override protected void before() { super.before(); System.out.println("domain before"); }
}
abstract class AbstractCommandProcessor extends AbstractDomainProcessor {
    @Override protected void before() { super.before(); System.out.println("command before"); }
}
public class OrderProcessor extends AbstractCommandProcessor {
    @Override protected void doWork() { System.out.println("order work"); }
}
```

**Symptom.** A new developer wants to know "what happens when I call `new OrderProcessor().process()`?". The answer requires reading four files. A bug in `AbstractDomainProcessor.before` reaches *all* leaf processors silently — and the developer has no idea which inherited "before" added the bug.

**Violation.** FBCP scaled: each level multiplies the surface where a change to a parent (any of the three) breaks all leaves.

**Fix.** Flatten by composition.

```java
public final class OrderProcessor {
    private final AuditLogger audit;
    private final TransactionManager tx;
    public OrderProcessor(AuditLogger a, TransactionManager t) { this.audit = a; this.tx = t; }

    public void process() {
        audit.before("order");
        tx.run(this::doOrderWork);
        audit.after("order");
    }
    private void doOrderWork() { /* place order */ }
}
```

The workflow is one method, readable top-to-bottom. The two cross-cutting behaviours (audit, transaction) are composed. No inheritance.

---

## Bug 8 — Subclass adds field; parent's `clone()` doesn't copy it

```java
public class Animal implements Cloneable {
    String name;
    @Override public Animal clone() throws CloneNotSupportedException {
        return (Animal) super.clone();           // shallow copy of declared fields
    }
}

public class Dog extends Animal {
    Color color;
    // forgot to override clone()
}
```

**Symptom.**

```java
Dog d = new Dog();
d.name = "Rex";
d.color = Color.BROWN;
Dog d2 = (Dog) d.clone();
d2.color = Color.WHITE;
// d.color is still BROWN — wait, no...
// Actually, Object.clone() does a shallow copy of ALL fields, including subclass ones.
// But if Dog HAD overridden clone() partially, that's where bugs come in.
```

The *actual* bug: when `Dog.clone()` is overridden to *not* call `super.clone()` (or to manually create a `Dog`), it loses the parent's field copies.

**Violation.** `Cloneable` is the canonical FBCP minefield in the JDK. Bloch's *Effective Java* item 13 covers this in detail. The protocol depends on every level of the hierarchy implementing `clone()` *correctly* — a contract no compiler enforces.

**Fix.** Don't use `Cloneable`. Use copy constructors or static factory methods.

```java
public final class Dog {
    private final String name;
    private final Color color;
    public Dog(String name, Color color) { this.name = name; this.color = color; }
    public Dog withColor(Color c) { return new Dog(name, c); }
}
```

Records make this even shorter. No `Cloneable`, no FBCP risk.

---

## Bug 9 — Spring proxies bypass inherited `@Transactional`

```java
public abstract class BaseService {
    @Transactional public void save(Object entity) { ... }
}

public class OrderService extends BaseService {
    public void process(Order o) {
        validate(o);
        save(o);              // intra-class call — bypasses Spring's proxy
    }
}
```

**Symptom.** `process()` is called; `save()` runs but *without* a transaction. Database writes are committed individually; a mid-flow failure leaves partial state. The `@Transactional` annotation on the parent looks like it covers `save()`, but the proxy mechanism intercepts only *external* calls.

**Violation.** A framework-level FBCP: Spring's proxy-based AOP requires the call to go through the proxy reference. Inherited `@Transactional` methods called via `this.method()` don't fire the aspect.

**Fix.** Compose the transactional unit as a separate bean.

```java
public final class OrderService {
    private final TransactionalSaver saver;
    public OrderService(TransactionalSaver s) { this.saver = s; }
    public void process(Order o) { validate(o); saver.save(o); }
}

@Component
final class TransactionalSaver {
    @Transactional public void save(Object entity) { /* ... */ }
}
```

The transaction boundary is a component boundary — exactly what Spring's proxy intercepts.

---

## Bug 10 — JPA's `@MappedSuperclass` and the `equals` cascade

```java
@MappedSuperclass
public abstract class BaseEntity {
    @Id Long id;
    @Override public boolean equals(Object o) {
        return o instanceof BaseEntity be && Objects.equals(id, be.id);
    }
    @Override public int hashCode() { return Objects.hashCode(id); }
}

@Entity
public class Order extends BaseEntity { /* ... */ }

@Entity
public class Customer extends BaseEntity { /* ... */ }
```

**Symptom.**

```java
Order o = new Order(); o.id = 1L;
Customer c = new Customer(); c.id = 1L;
o.equals(c);            // true — different entities, same id, accidental equal
```

Plus: `o` is in a `HashSet<Order>`; an accidental `set.contains(c)` (a `Customer` cast to `BaseEntity`) returns true. Bugs cascade through any code that uses entity equality.

**Violation.** Inheritance of `equals` across unrelated entity types. The shared parent makes them equal by id, ignoring their actual types.

**Fix.** Override `equals` per entity, using `getClass()` comparison:

```java
@Entity
public final class Order extends BaseEntity {
    @Override public boolean equals(Object o) {
        return o != null && getClass() == o.getClass() && Objects.equals(id, ((Order) o).id);
    }
}
```

Or — better — don't put `equals` in the `@MappedSuperclass`. Each entity owns its own equality. FBCP via shared `equals` is one of the most-cited JPA traps.

---

## Pattern summary

| Bug | FBCP form                                                        | Fix                                                |
|-----|-------------------------------------------------------------------|----------------------------------------------------|
| 1   | Self-use change orphans the override                             | Event subscription / deprecation cycle              |
| 2   | Subclass helper accidentally overrides new parent method         | `@Override`, unique names                           |
| 3   | Virtual call in constructor sees uninitialized field             | No virtual calls in `<init>`; static factory        |
| 4   | Parent's self-use removed silently                                | Lifecycle event; deprecation                        |
| 5   | `equals` symmetry broken by subclass adding state                 | Composition, not extension                          |
| 6   | Adding `final` is binary-incompatible for subclasses              | `japicmp` in CI; deprecation cycle                  |
| 7   | Deep inheritance chain — change ripples to all leaves             | Flatten by composition                              |
| 8   | `Cloneable` contract relies on every level being correct          | Copy constructor / record / `withX` method          |
| 9   | Spring proxy bypassed by intra-class `super.method()`             | Move `@Transactional` to a composed bean            |
| 10  | `@MappedSuperclass equals` makes unrelated entities equal         | Per-entity `equals` with `getClass()` check         |

Each bug compiles cleanly. Each looks like working code in review. The lessons cluster: every `extends` is a contract with the parent's *implementation*, not just its API; even seemingly "internal" parent changes can silently break subclasses; the JDK and major frameworks contain FBCP traps you must learn to spot.
