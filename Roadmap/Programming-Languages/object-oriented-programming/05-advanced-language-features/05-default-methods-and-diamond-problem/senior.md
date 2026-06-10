# Default Methods and the Diamond Problem — Senior

> **What?** The edge cases that matter once you maintain libraries or own a non-trivial type hierarchy: how default methods feed the *Fragile Base Class Problem*, what counts as a binary-compatible change to a default, how defaults interact with records and sealed types, the trap of *generic defaults* with bounded type parameters, `super` chaining across nested sub-interfaces, and the cases where defaults outright lose to composition.
> **How?** Treat each section as a named hazard. Most show up only when a default ships, is consumed by external code, and then changes — the moments where every junior intuition breaks down.

---

## 1. Default methods and the Fragile Base Class Problem

The Fragile Base Class Problem (FBCP) was originally framed for *classes*: changes to a base class can silently break subclasses that depend on overridable methods or internal call-sequences. Default methods bring the same hazard to *interfaces*. Once you ship a default, every implementor of your interface effectively inherits that body — and changes you make are no longer purely additive.

```java
// v1.0 — shipped to users
public interface Cache<K, V> {
    V get(K key);
    void put(K key, V value);

    default V getOrCompute(K key, Function<? super K, ? extends V> f) {
        V existing = get(key);
        if (existing != null) return existing;
        V computed = f.apply(key);
        put(key, computed);
        return computed;
    }
}

// v1.1 — "small refactor"
public interface Cache<K, V> {
    V get(K key);
    void put(K key, V value);

    default V getOrCompute(K key, Function<? super K, ? extends V> f) {
        return computeIfAbsent(key, f);                     // (*)
    }
    default V computeIfAbsent(K key, Function<? super K, ? extends V> f) {
        V existing = get(key);
        if (existing != null) return existing;
        V computed = f.apply(key);
        put(key, computed);
        return computed;
    }
}
```

Looks innocent. It isn't. Any user implementation that had overridden *only* `getOrCompute` now silently breaks when callers reach for `computeIfAbsent`. Worse, an implementation that *overrode* `getOrCompute` but never knew `computeIfAbsent` would exist is now serving callers from the un-overridden default — different semantics from what the implementor thought they had wired in.

This is FBCP in interface form: changes to default bodies (or the *call graph* among defaults) reach silently into every implementor. For the wider treatment of FBCP itself, see [../../03-design-principles/06-fragile-base-class-problem/](../../03-design-principles/06-fragile-base-class-problem/).

**The senior discipline.** Treat the *interaction* between defaults as part of the public API. Document which defaults call which (a one-line `@implSpec` block per default). Never refactor a default body without testing every meaningful implementor downstream, or at minimum publishing the call graph change as a breaking note in release notes.

---

## 2. Binary compatibility of default-method changes

JLS §13 lays out *binary compatibility* — what changes you can make to a published class file without forcing dependent code to be recompiled. Default methods have surprising rules.

**Binary-compatible changes:**

- *Adding* a `default` method to an existing interface. Existing implementors keep working; existing callers keep linking.
- *Adding* a `static` method to an existing interface. Same reasoning.
- *Strengthening* the implementation of a default — same method body changes, same return type, same throws clause. Callers don't see the change.

**Binary-incompatible changes:**

- *Removing* a `default` method. Callers compiled against v1.0 still emit `invokeinterface` to that name; at runtime the JVM throws `AbstractMethodError` or `NoSuchMethodError`.
- *Adding* an abstract method (no `default`) to an existing interface. Implementors that don't override it fail at link time with `AbstractMethodError`.
- *Changing* a default's signature — return type, parameter types, throws clause adding new checked exceptions. Same break as above.
- *Converting* an `abstract` method into a `default` is binary-compatible; *converting* a `default` into an `abstract` is **not**.

A subtle case: *adding* a default that conflicts with another interface implemented by a downstream class triggers a `IncompatibleClassChangeError` at the resolution site:

```java
// v1.0 — works fine
public interface A {
    default void m() { ... }
}
public interface B { }
public class C implements A, B { }   // ok

// v1.1 — library author adds a conflicting default to B
public interface B {
    default void m() { ... }   // BOOM at runtime for class C
}
```

`C` was compiled against v1.0 with only one `m()` visible. At runtime against v1.1, the diamond is now real and `C` never resolved it. The JVM throws `IncompatibleClassChangeError` the first time `m()` is invoked on a `C`.

**Discipline for library authors:** adding a default is *binary-compatible* in isolation but *binary-incompatible by composition* if any downstream class implements both your interface and another with the same method signature. There is no easy way to detect this short of testing downstream code or marking the addition in release notes as "may conflict with implementors of other interfaces".

---

## 3. Default method conflicting with a parent class method

Rule 1 ("classes win") has a hazard that's invisible until it fires:

```java
public abstract class AbstractRepository<T> {
    public void save(T entity) {
        validate(entity);
        insert(entity);
    }
    protected abstract void validate(T entity);
    protected abstract void insert(T entity);
}

public interface Auditable {
    // Library author adds this in v2.0:
    default void save(Object entity) {       // signature does not match T
        System.out.println("auditing save of " + entity);
    }
}

public class OrderRepository
        extends AbstractRepository<Order>
        implements Auditable { }
```

The class `OrderRepository` has both `save(Order)` (from `AbstractRepository`) and `save(Object)` (from `Auditable`). They are *different methods* — different erased signatures. The default isn't conflicting with the class method by Rule 1; it's coexisting with it as an overload. Callers of `OrderRepository.save(order)` hit `AbstractRepository.save(Order)` and never trigger the auditing the library author intended. The default added in v2.0 is *silently dead* for this implementor.

The fix is contractual, not technical: keep generic and raw versions of a method out of the same hierarchy. Or, on the library author's side, name the default differently (`audit` rather than `save`).

The opposite case — class method and default with *exactly* the same erased signature — *does* fire Rule 1:

```java
public class Logger {
    public void log(String msg) { System.out.println("[class] " + msg); }
}
public interface AuditLog {
    default void log(String msg) { System.out.println("[default] " + msg); }
}
public class AuditingLogger extends Logger implements AuditLog { }

new AuditingLogger().log("hi");   // "[class] hi" — Rule 1
```

The auditing default is *unreachable* from `AuditingLogger`. If you ship `AuditLog` expecting implementors to inherit your auditing behaviour, you cannot do that for any implementor that also extends a class with a matching `log(String)`. Composition is the answer.

---

## 4. Records and defaults — accessor always wins

Records (JEP 395) implement interfaces freely and can inherit defaults — but with a subtle precedence: a *record component accessor* always wins over an interface default with the same name.

```java
public interface Named {
    default String name() { return "anonymous"; }
}

public record Person(String name, int age) implements Named { }

new Person("Sam", 30).name();        // "Sam" — record accessor wins
new Person(null, 30).name();         // null   — accessor returns the field, default never called
```

This is Rule 1 in disguise: the record's *implicit* accessor is a class method, and class methods beat interface defaults. The implication is sharp: if you ship `Named` with a "sensible default" of `"anonymous"`, any record that happens to have a `name` component will silently override your default — even though the record author didn't write any code. Their *component* is doing the override.

A second twist: the record's accessor is `public abstract` in the interface sense (the record class implicitly declares it `public`), so the override is type-checked. But if the interface's default has a *different* return type than the record's component, the record fails to compile — record accessors must satisfy any abstract or default method they shadow.

```java
public interface IntId { default long id() { return 0; } }
public record Thing(int id) implements IntId { }
//                       ^ compile error: int id() does not override default long id()
```

**Senior takeaway.** If you ship default methods named `name`, `id`, `value`, `type`, `count`, `key` — any plausible record component name — expect implementors to silently override them. Either pick distinctive method names (`displayName`, `primaryKey`) or document that records may shadow the default.

---

## 5. Generic default methods and type erasure

Defaults can be generic:

```java
public interface Container<T> {
    void add(T value);

    default <U extends T> void addAll(Iterable<U> values) {
        for (U v : values) add(v);
    }
}
```

The `addAll` here is *doubly generic* — both at the interface level (`T`) and at the method level (`U extends T`). The default reads `T add(T)` and the call site is well-typed. This is the pattern in `Collection.addAll(Collection<? extends E>)`.

The hazard comes when the generic default's signature collides with an erased signature on a parent or implementor:

```java
public interface Sink<T> {
    default void accept(T value) { }
}
public class StringSink implements Sink<String> {
    public void accept(Object value) { }   // bridge method — but is it an override?
}
```

Erasure turns `Sink<T>.accept(T)` into `accept(Object)`. The class method `accept(Object)` has the same erased signature, so the compiler generates a *bridge method* and the override resolves correctly — but only if the parameter types align. If the class declared `accept(String)`, the compiler generates a bridge from `accept(Object)` to `accept(String)` and the default is bypassed entirely.

For deeper coverage of erasure-related dispatch bugs, see [../04-functional-interfaces-and-lambdas/](../04-functional-interfaces-and-lambdas/) — `FunctionalInterface` types hit identical traps.

**Rule of thumb:** don't write a default that depends on a generic type parameter unless you've verified the bridge-method behaviour for the implementors you ship to. When in doubt, declare the method abstract and force the implementor to spell out the type.

---

## 6. `super` chaining across nested sub-interfaces

`Interface.super.m()` only reaches a *directly declared* superinterface. Once you have a three-level interface chain, choices become subtle:

```java
public interface Vehicle {
    default String describe() { return "vehicle"; }
}
public interface RoadVehicle extends Vehicle {
    default String describe() { return "road " + Vehicle.super.describe(); }
}
public interface Car extends RoadVehicle {
    default String describe() { return "car (" + RoadVehicle.super.describe() + ")"; }
}
public class Sedan implements Car { }

new Sedan().describe();   // "car (road vehicle)"
```

`Car.describe()` reaches `RoadVehicle.super.describe()`, which in turn reaches `Vehicle.super.describe()`. Each `super` hop is *one level only*. From `Sedan`, you cannot write `Vehicle.super.describe()` — `Sedan` doesn't declare `implements Vehicle` directly, even though it indirectly inherits it. The compile error is "type Vehicle is not a direct superinterface of Sedan".

The workaround if you need it: declare the type explicitly.

```java
public class Sedan implements Car, Vehicle {   // explicit Vehicle in implements
    @Override
    public String describe() {
        return "sedan via " + Vehicle.super.describe();   // now legal
    }
}
```

Adding `Vehicle` to `Sedan`'s `implements` clause is redundant for the type system (`Car` already extends `Vehicle`) but it unlocks `Vehicle.super.describe()` syntactically. Most codebases never need this — but you'll see it occasionally in framework code that wants to reach a far-away default for resilience.

---

## 7. Default methods in sealed types

Sealed interfaces (JEP 409, [../01-sealed-classes-and-pattern-matching/](../01-sealed-classes-and-pattern-matching/)) combine naturally with defaults. The closed permits clause gives the default author *full knowledge* of every implementor.

```java
public sealed interface Shape permits Circle, Square, Triangle {
    double area();

    default boolean isLarge() { return area() > 100.0; }
}
public record Circle(double r)             implements Shape { public double area() { return Math.PI * r * r; } }
public record Square(double s)             implements Shape { public double area() { return s * s; } }
public record Triangle(double b, double h) implements Shape { public double area() { return 0.5 * b * h; } }
```

Because `Shape` is sealed, *no third party can add a new implementor*. The default `isLarge` is therefore safe to evolve — you only need to consider three implementors, all in your codebase. Compare this to an unsealed interface where a downstream codebase might be implementing your interface in ways you've never seen.

Sealed + defaults is the strongest position for an interface author: you get behaviour reuse and the entire implementor set is in front of you. For variant-style domain modelling, prefer sealed types with defaults that derive from abstract methods over open interfaces with defaults that try to anticipate every implementor.

---

## 8. Default methods vs the Liskov Substitution Principle

A default method *is* part of the contract every implementor presents to callers. If you write a default that some implementors can't honour, you've baked an LSP violation into the interface itself.

```java
public interface ReadWrite<T> {
    T read();
    default void write(T value) { throw new UnsupportedOperationException(); }   // smell
}
```

Every caller against `ReadWrite<T>` writes `rw.write(...)` expecting it to work. The interface promises it works (the default body is syntactically valid). Implementations like `ReadOnlyView` that just inherit the default crash at runtime — Bug 1 of `find-bug.md` in interface form. The fix is two interfaces (`Readable<T>` and `Writable<T> extends Readable<T>`), not one with an optional default.

A subtler LSP failure: defaults that read class-owned state through abstract methods *and* assume something about how that state evolves.

```java
public interface Auditable {
    Instant createdAt();
    Instant updatedAt();

    // assumes updatedAt is never before createdAt
    default Duration sinceCreate(Clock c) {
        return Duration.between(createdAt(), c.instant());
    }
    default Duration sinceUpdate(Clock c) {
        return Duration.between(updatedAt(), c.instant());
    }
    default Duration timeInBetween() {
        return Duration.between(createdAt(), updatedAt());   // negative if implementor's invariant breaks
    }
}
```

If an implementor has a bug where `updatedAt < createdAt`, `timeInBetween` returns a negative `Duration`. The default's contract implicitly assumed an invariant the interface didn't declare. The fix is to make the invariant explicit (defensive check, documentation) or remove the default and force implementors to think.

---

## 9. When defaults lose to composition

Defaults are a *type-level* tool. Composition is a *field-level* tool. They solve different problems, but in many cases defaults masquerade as composition and lose at scale.

Symptoms that you've reached the limit of defaults:

- An interface has more than three defaults that all depend on different combinations of abstract methods.
- Defaults call defaults call defaults — a call graph rather than a leaf.
- Multiple unrelated capabilities sit on the same interface because "everyone needs them".
- Implementors override most of the defaults anyway.

When you see these, *replace the interface with a class that holds collaborators*:

```java
// Defaults overreach: trying to be a class via an interface
public interface OrderProcessor {
    Order order();
    default BigDecimal subtotal() { /* sum lines */ }
    default BigDecimal tax()      { /* call subtotal, apply rate */ }
    default BigDecimal shipping() { /* lookup table */ }
    default BigDecimal total()    { return subtotal().add(tax()).add(shipping()); }
    default void send()           { /* email, persist, audit */ }
}

// Composition: collaborators carry behaviour, the class orchestrates
public final class OrderProcessor {
    private final TaxCalculator     tax;
    private final ShippingCalculator shipping;
    private final OrderRepository    repo;
    private final OrderNotifier      notifier;
    /* constructor */
    public BigDecimal total(Order o) {
        BigDecimal subtotal = o.lines().stream().map(Line::amount).reduce(ZERO, BigDecimal::add);
        return subtotal.add(tax.compute(o)).add(shipping.compute(o));
    }
    public void send(Order o) { repo.save(o); notifier.send(o); }
}
```

The class version separates *who computes tax* from *who computes shipping* from *who persists*. Each collaborator is independently swappable, testable, and injectable. The interface version forces every implementor to inherit one specific way of doing all four things — exactly the FBCP shape from section 1, with all of its downstream pain. See [../../03-design-principles/02-composition-over-inheritance/](../../03-design-principles/02-composition-over-inheritance/).

---

## 10. Defaults and immutable wrappers

A common modern pattern: a small interface with one abstract method, a default that builds a derived value, and implementations that are *immutable wrappers*.

```java
public interface Money {
    long cents();
    default Money plus(Money other) { return Money.of(cents() + other.cents()); }
    default Money minus(Money other) { return Money.of(cents() - other.cents()); }
    static Money of(long cents) { return new Concrete(cents); }
    record Concrete(long cents) implements Money { }
}
```

This pattern works because:

1. The default only reads `cents()`, which is owned by the implementor (record component).
2. The static factory returns a *known* implementor — the same logic the JDK uses for `List.of`, `Map.of`, `Optional.of`.
3. The `record Concrete` is *nested in the interface* — implementors can use it directly without exposing extra types.

It's a clean alternative to a class with a public constructor. The downside: any later default you add ripples through every implementor. Use it for *small, stable* domain primitives — not for big domain aggregates.

---

## 11. Quick rules

- [ ] Treat the *call graph between defaults* as public API. Document with `@implSpec`.
- [ ] Adding a default is binary-compatible *in isolation*, binary-incompatible *by composition* — note the conflict risk in release notes.
- [ ] Don't ship a default that throws `UnsupportedOperationException` — split the interface instead.
- [ ] Rule 1 (classes win) is absolute and silent. Use distinctive default method names to avoid shadowing.
- [ ] Records: a component accessor shadows any same-named default. Pick default method names that aren't plausible record components.
- [ ] Generic defaults can be silently bypassed by bridge methods. Verify dispatch with a real implementor.
- [ ] `Interface.super.m()` only reaches *directly declared* superinterfaces.
- [ ] Sealed + defaults is the safest position — you know every implementor.
- [ ] If you have more than three defaults that interdepend, you wanted a class.
- [ ] Defaults give *behaviour*, never *state*. The moment you want a field, you want a class.

---

## 12. What's next

| Topic                                                                       | File              |
| --------------------------------------------------------------------------- | ----------------- |
| Code-review vocabulary, library evolution discipline, ArchUnit, deprecation | `professional.md`  |
| JLS §9.4.3 / §8.4.8 / §9.4.1, JEP 126, JEP 213                              | `specification.md` |
| Ten broken default-method snippets                                          | `find-bug.md`      |
| Bytecode for defaults, `invokeinterface`, JIT inlining                      | `optimize.md`      |
| Hands-on refactors                                                          | `tasks.md`         |
| Interview Q&A                                                               | `interview.md`     |

---

**Memorize this:** default methods are the FBCP applied to interfaces — every body you ship is silently inherited by every implementor, every change to the call graph is a contract change, every "small refactor" can ripple. Rule 1 (classes win) is absolute, so don't name your default after a plausible record component or class method. Defaults are binary-compatible alone but not against composition. Sealed types tame all of this; composition replaces it when defaults grow past a leaf.
