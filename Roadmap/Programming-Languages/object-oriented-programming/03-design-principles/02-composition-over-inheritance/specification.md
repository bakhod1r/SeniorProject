# Composition Over Inheritance — Specification Reading Guide

> *Composition over inheritance* is a *design heuristic*, not a language rule. Neither the JLS nor the JVMS mentions it. But the spec provides every lever you need to enforce it: `final` (§8.1.1.2, §8.4.3.4), `sealed`/`permits` (§8.1.1.2, §9.1.1.4), `private` constructors (§8.8.10), default methods (§9.4.3), records (§8.10), and the four `invoke*` dispatch instructions (JVMS §6.5). This file maps the heuristic to the binding spec text that makes it enforceable.

---

## 1. Where to find the canonical text

| Concept                                       | Authoritative source                              |
|-----------------------------------------------|---------------------------------------------------|
| Class modifiers (`final`, `sealed`, `abstract`) | **JLS §8.1.1**                                  |
| `final` methods                               | JLS §8.4.3.4                                      |
| Constructors and `private` constructors       | JLS §8.8, §8.8.10                                 |
| `final` fields and safe publication           | **JLS §8.3.1.3**, §17.5                           |
| Interfaces and default methods                | **JLS §9**, esp. §9.4.3, §9.1.1.4 (sealed)        |
| Records (compact, immutable composition)      | **JLS §8.10** (JEP 395)                           |
| Inheritance and method override               | JLS §8.4.8                                        |
| `private` members, package visibility         | JLS §6.6                                          |
| Module exports and encapsulation              | JLS §7.7                                          |
| Method invocation instructions                | **JVMS §6.5** — `invokevirtual`, `invokeinterface`, `invokespecial`, `invokestatic`, `invokedynamic` |
| `final`-method devirtualization               | JVMS §5.4.5, JIT-level (HotSpot inlining policy) |
| Class file inheritance hierarchy              | JVMS §4.1 `super_class`                           |

The **JLS** is what `javac` enforces; the **JVMS** is what the JVM enforces. The composition heuristic uses both to make inheritance an explicit, opt-in cost.

---

## 2. `final` class (JLS §8.1.1.2) — closing the door on subclassing

A `final` class cannot be extended. The spec wording is unambiguous: *"It is a compile-time error if a class is declared `final` and is extended by some other class."*

```java
public final class Money { ... }

public class FastMoney extends Money { ... }   // compile error
```

`final` is the strongest enforcement of composition. A reader sees the keyword and knows: no surprises, no subclass overrides, no fragile-base risk. Joshua Bloch's *Effective Java* item 19 reads in spec terms: "use `final` to *prohibit* inheritance unless you've designed for it."

Three corollaries the JIT cares about:

- **Devirtualization.** A `final` class's methods cannot be overridden. The JIT replaces `invokevirtual` calls with direct calls at compile time.
- **Class-hierarchy analysis (CHA).** Even a non-final method on a `final` class has at most one implementation reachable through that exact type — CHA makes inlining trivial.
- **Smaller vtables.** No reservation for unknown subclass methods.

Records (§8.10) are *implicitly* `final` — a side benefit of using them as composition building blocks.

---

## 3. `sealed` classes (JLS §8.1.1.2) — closed extension by design

Since Java 17 (JEP 409), a class may declare `sealed permits A, B, C`. Three rules of the spec:

- Each `permits` entry must be a class or interface in the same module (or, if the sealed type is unnamed-module, the same package).
- Each permitted direct subclass must declare exactly one of `final`, `sealed` (with its own `permits`), or `non-sealed`.
- The compiler verifies the closure at compile time.

```java
public sealed interface PaymentMethod
    permits CardPayment, BankPayment, CryptoPayment { }

public final class CardPayment   implements PaymentMethod { ... }
public final class BankPayment   implements PaymentMethod { ... }
public final class CryptoPayment implements PaymentMethod { ... }
```

`sealed` is *inheritance done right*: substitutability without open extension. The implementor of `PaymentMethod` cannot be a class you don't know about. This is the composition heuristic's permitted form of inheritance — a closed family of variants with exhaustive `switch` (§14.11).

```java
double rate(PaymentMethod m) {
    return switch (m) {                              // compiler proves exhaustiveness
        case CardPayment   c -> 0.029;
        case BankPayment   b -> 0.008;
        case CryptoPayment p -> 0.015;
    };
}
```

In the JVMS, sealed types appear in the `PermittedSubclasses` class-file attribute (§4.7.31). The verifier rejects classes that try to extend a sealed type without being in the `permits` list.

---

## 4. `private` constructors (JLS §8.8.10) — composition by gatekeeper

A class with only `private` constructors cannot be subclassed *and* cannot be instantiated by callers. Combined with static factory methods, this enforces composition at the construction boundary:

```java
public final class OrderId {
    private final UUID value;
    private OrderId(UUID value) { this.value = value; }          // §8.8 — private only

    public static OrderId fresh()              { return new OrderId(UUID.randomUUID()); }
    public static OrderId parse(String text)   { return new OrderId(UUID.fromString(text)); }
}
```

A subclass cannot call `super()` because no superclass constructor is reachable. JLS §8.8.7.1 (constructor body) requires the first statement of every constructor body to be either an explicit constructor invocation or — implicitly — a call to the immediate superclass constructor. With all constructors `private`, that call is impossible from outside the class.

The pattern is the canonical *value object*: clients use it by composition (`Order` holds an `OrderId`), never by extension.

---

## 5. `final` fields and `final` parameters (JLS §8.3.1.3, §16) — composition's immutability backbone

The composition idiom is *constructor injection of a `final` field*. Three spec features make it both expressible and safe:

- **Definite assignment (JLS §16).** A `final` instance field must be assigned exactly once in the constructor or initializer.
- **No reassignment (§8.3.1.3).** Once assigned, the field cannot be changed.
- **Safe publication (§17.5).** If `this` does not escape the constructor, every thread observing the reference sees the correct `final` field values without explicit synchronization.

```java
public final class CheckoutFlow {
    private final OrderRepository repo;
    private final PaymentGateway gateway;

    public CheckoutFlow(OrderRepository repo, PaymentGateway gateway) {
        this.repo    = Objects.requireNonNull(repo);
        this.gateway = Objects.requireNonNull(gateway);
    }
}
```

The composition relationship is now an immutable property of the instance. Removing `final` lets a setter swap the dependency at runtime — which breaks both the testability guarantee (you'd need to mock the setter sequence) and the safe-publication guarantee (other threads might see the old reference).

---

## 6. Records (JLS §8.10) — composition as a one-liner

A record is the spec's shortest path to a *composed value*. JLS §8.10 defines:

- An implicit `final` class declaration.
- An implicit `private final` field per component.
- An implicit canonical constructor.
- Implicit `equals`, `hashCode`, `toString` derived from components.
- Implicit accessor methods (`x()`, not `getX()`).

```java
public record Address(String street, String city, String zip) { }
```

That single line is the spec replacing fifty lines of "DTO" boilerplate. Critically, a record:

- **Cannot be extended.** §8.10.1 — records are implicitly `final`.
- **Cannot be a subclass.** §8.10.2 — a record may not have an `extends` clause; its only superclass is `java.lang.Record`.
- **Can implement interfaces.** §8.10.3 — composition via type, not extension.

Records are the spec's blessing for value-composition: identity by content, behaviour added through interface implementation, never by class extension.

---

## 7. Default methods (JLS §9.4.3) — composition through interface contracts

A default method (`default void method() { ... }`) on an interface provides shared behaviour without class inheritance. JLS §9.4.3 specifies:

- The method body lives on the interface.
- The method is *inherited* by implementing classes.
- Classes may override; if not, the default applies.
- Conflict resolution (§8.4.8.4): if a class implements two interfaces with the same default, the class must override explicitly.

```java
public interface Resilient {
    int attempts();
    default <T> T withRetries(Supplier<T> work) {
        RuntimeException last = null;
        for (int i = 0; i < attempts(); i++) {
            try { return work.get(); } catch (RuntimeException e) { last = e; }
        }
        throw last;
    }
}
```

Defaults are mixins — they look like inheritance but ride on interface implementation rather than class extension. The composition-friendly half: a class may `implements` many interfaces (§8.1.5), so default methods compose horizontally instead of inheriting vertically.

The composition-hostile half: a change to the default method body is *binding on every implementor*. Treat default-method bodies as part of the published API.

---

## 8. JLS §8.4.8 — what inheritance actually inherits

The composition heuristic exists because Java inheritance carries more than callers usually realize. JLS §8.4.8 spells it out:

- **All non-private members of the superclass are inherited.** Methods, fields, nested types — they appear on the subclass's API.
- **Constructors are not inherited.** §8.8.9 — each class defines its own.
- **`static` members are inherited but hidden, not polymorphic.** §8.4.8.2.
- **`private` members are not inherited.** §6.6 — they're inaccessible from the subclass.

A class `extends ArrayList<T>` inherits every public method on `ArrayList`. That's the spec saying *the API surface of the parent becomes part of the API surface of the child, by language design*. There is no way to opt out except by overriding to throw — which JLS §8.4.6.3 permits at compile time but violates LSP semantically.

The composition equivalent: a field of type `ArrayList<T>` is *encapsulated* by the access modifier you choose. `private final ArrayList<T> list` exposes exactly what your forwarders expose. The compiler doesn't make the choice for you.

---

## 9. JVMS §6.5 — dispatch costs of inheritance vs interface

Five method invocation bytecodes:

```
invokestatic     // §6.5.invokestatic    — class-level method, no receiver
invokespecial    // §6.5.invokespecial   — <init>, private, super.m()
invokevirtual    // §6.5.invokevirtual   — virtual dispatch on a class type
invokeinterface  // §6.5.invokeinterface — virtual dispatch via interface type
invokedynamic    // §6.5.invokedynamic   — bootstrapped call site (lambdas)
```

The composition heuristic interacts with this in two ways:

- **`invokevirtual` (inheritance dispatch).** Resolves through a fixed-offset vtable slot. One indirect load per call.
- **`invokeinterface` (interface dispatch).** Resolves through an itable lookup keyed by interface; modern HotSpot caches the result. One to three loads on a cache miss.

For *monomorphic* call sites (one observed receiver type), the JIT inlines both into direct calls. For *megamorphic* (3+ types), `invokeinterface` is measurably slower than `invokevirtual`.

The composition root design (one chain, wired once, held in a `final` field) keeps call sites monomorphic — so the dispatch cost of "composition over inheritance" is effectively zero in practice. See [`optimize.md`](optimize.md) §3 for measurements.

---

## 10. JLS §7.7 — modules and the composition boundary

The Java module system raises the composition heuristic from the class level to the deployment level. `module-info.java`:

```java
module com.acme.checkout {
    requires com.acme.payments;            // composition: I depend on this module
    exports  com.acme.checkout.api;        // my public surface
    // everything else is invisible
}
```

A module *cannot extend* another module — modules compose, never inherit. The spec made this choice deliberately: the alternative (module inheritance) would propagate breakage across the dependency graph in ways the runtime can't undo.

Within a module, the spec lets you keep extension `private`. A `final` class in a `non-exported` package cannot be extended by any external code. Combined with sealed types, this gives you *deployment-level composition* — extensibility is a property of the module's API design, not a property the runtime accidentally allows.

---

## 11. JEP references

| JEP            | Feature                              | Why composition cares                    |
|----------------|--------------------------------------|------------------------------------------|
| JEP 360, 397, 409 | Sealed classes                    | Inheritance done right — closed families |
| JEP 395        | Records                              | Composition as a one-liner               |
| JEP 406, 420, 427, 441 | Pattern matching for `switch`| Exhaustive dispatch over sealed types    |
| JEP 286, 323   | `var` (local-variable type inference)| Encourages naming the interface in fields, the implementation in `var` locals |
| JEP 261        | Module system                        | Composition at the deployment boundary   |
| JEP 401 (preview) | Value classes                     | Identity-free composition, no allocation cost |
| JEP 181        | Lambda expressions                   | Function values as ultra-cheap composition |

Modern Java is a composition-friendly language. Sealed types replace open inheritance for closed families; records replace DTO base classes; lambdas replace single-method interface inheritance for behaviour parameterization.

---

## 12. Reading list

1. **JLS §8.1.1** — Class modifiers. `final` and `sealed` are your composition tools.
2. **JLS §8.4.8** — Inheritance, overriding, hiding. What `extends` actually buys.
3. **JLS §8.8** — Constructors. Why composition lives in the constructor argument list.
4. **JLS §8.10** — Records.
5. **JLS §9.4.3** — Default methods.
6. **JLS §17.5** — Final-field semantics, safe publication.
7. **JLS §7.7** — Module declarations.
8. **JVMS §6.5** — Method invocation instructions.
9. **JEP 409** — Sealed classes (final).
10. **JEP 395** — Records.
11. **Joshua Bloch** — *Effective Java*, 3rd ed., items 18–22 (favor composition, design and document for inheritance, prefer interfaces, …). The canonical treatment.
12. **Erich Gamma et al.** — *Design Patterns: Elements of Reusable Object-Oriented Software*, 1994. The first design-pattern book; the slogan "favor composition over inheritance" appears on page 20.

The spec doesn't *teach* the heuristic — it gives you the vocabulary to enforce it. When a coworker asks "why is this class `final`?", you cite §8.1.1.2. When they ask "why a record?", you cite §8.10. When they ask "why an interface?", you cite §9. The spec sections are how the heuristic stops being a slogan and becomes a structural property of your code.
