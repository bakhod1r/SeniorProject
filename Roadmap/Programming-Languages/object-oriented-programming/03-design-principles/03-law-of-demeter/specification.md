# Law of Demeter — Specification Reading Guide

> The Law of Demeter is a *design heuristic*, not a language rule. `javac` will never refuse to compile `a.b().c().d()`. But the JLS and JVMS provide the *machinery* you use to enforce LoD where it matters: access modifiers (§6.6), packages (§7), modules (§7.7), nested classes (§8.1.3), records (§8.10), sealed types (§8.1.1.2), and the four `invoke*` dispatch instructions (JVMS §6.5). This file maps the heuristic to the binding spec text that makes it enforceable.

---

## 1. Where to find the canonical text

| Concept                                       | Authoritative source                              |
|-----------------------------------------------|---------------------------------------------------|
| Access modifiers (`public`, `protected`, package, `private`) | **JLS §6.6**                              |
| Packages                                      | JLS §7                                            |
| Modules and `module-info.java`                | **JLS §7.7**, JEP 261                            |
| Class members and accessibility               | JLS §8.1, §8.2                                    |
| Nested types and package-private inner classes| JLS §8.1.3                                        |
| Records (value carriers)                      | **JLS §8.10** (JEP 395)                          |
| Sealed types (closed families)                | JLS §8.1.1.2, §9.1.1.4 (JEP 409)                  |
| `final` fields and immutability               | JLS §8.3.1.3, §17.5                               |
| Constructors and object publication           | JLS §8.8                                          |
| Method invocation                             | JLS §15.12                                        |
| Method invocation bytecodes                   | **JVMS §6.5** — `invokevirtual`, `invokeinterface`, `invokespecial`, `invokestatic`, `invokedynamic` |
| Strong encapsulation (module exports)         | JEP 261, JEP 396, JEP 403                         |
| Class file `Synthetic` and `Bridge`           | JVMS §4.7.5, §4.7.8 (relevant for accessors)      |

The **JLS** is what `javac` enforces; the **JVMS** is what the JVM enforces. LoD lives one level above both — but each enforcement point has a spec hook.

---

## 2. LoD is not a language rule — what the spec actually offers

`javac` does not implement LoD. The JLS does not contain a `DemeterChecker`. What the spec provides is a set of *features* that let you encode LoD as an *access control* problem:

| LoD concern                                  | Spec mechanism that helps               |
|----------------------------------------------|------------------------------------------|
| Hide internal collaborators                  | `private` (§6.6.1), `private` constructors (§8.8.10) |
| Hide entire aggregate internals from external packages | Package access (§6.6.1), package-private classes (§8.1.1) |
| Hide aggregate internals at deployment scale | Module `exports` (JLS §7.7, JEP 261)     |
| Limit subtype variation                      | `sealed`/`permits` (§8.1.1.2)            |
| Make value carriers exempt from "navigation" | `record` (§8.10) — components are part of the value's meaning |

The spec turns LoD into a structural property of the *types* and *packages* you design.

---

## 3. JLS §6.6 — access control as LoD enforcement

JLS §6.6 defines the visibility rules:

- `public` — visible everywhere (subject to module exports).
- `protected` — visible to subclasses and to the same package.
- *Package* (no modifier) — visible only within the same package.
- `private` — visible only within the same top-level class.

The LoD-relevant fact: *callers cannot navigate through what they cannot see*. A `private` field cannot be reached at all from outside. A package-private class cannot even be *named* by callers in another package.

```java
package com.acme.order;

public final class Order {
    private final List<LineItem> lineItems;       // §6.6.1 — private; unreachable
    public Money total() { /* reads lineItems internally */ }
}

final class LineItem { /* package-private — unnameable outside this package */ }
```

External callers cannot write `order.getLineItems()` (no such method) and cannot write `order.lineItems` (private). Even if `Order` accidentally exposed a getter, callers cannot bind a variable of type `LineItem` because they can't import it. *LoD becomes a compile error*, not a code-review topic.

---

## 4. Module exports (JLS §7.7 / JEP 261) — runtime-enforced LoD

The Java module system (Java 9+) raises access control from compile time to runtime. `module-info.java`:

```java
module com.acme.order {
    exports com.acme.order;            // public surface
    // com.acme.order.internal is NOT exported — strongly encapsulated
}
```

JEP 261 specifies that *non-exported packages* are inaccessible at runtime, even through reflection (unless explicitly opened). The JVM's class loader refuses `Class.forName("com.acme.order.internal.LineItem")` from outside the module.

```java
package com.acme.order.internal;
public final class LineItem { /* ... */ }    // public — but the package is not exported
```

The `public` modifier is now *necessary but not sufficient*. A class is visible only if its package is exported. This is *strong encapsulation*: the LoD seam is enforced even by misbehaving frameworks that try to reach in via reflection.

For LoD, the implications are direct:

- An aggregate's internal entities live in a non-exported package.
- The aggregate root and its value records live in the exported package.
- External code *cannot* walk through internals, regardless of getter design.

---

## 5. Records (JLS §8.10) — values exempt from "navigation"

A record is the spec's blessing for value-style composition. JLS §8.10 specifies:

- Implicit `final` class.
- Private final fields for each component.
- Public accessor methods (named after components).
- Auto-generated `equals`/`hashCode`/`toString` from components.

```java
public record Address(String street, String city, String zip) { }
```

LoD applies differently to records: their components are part of the value's *meaning*. Reading `address.city()` is not navigation through hidden internals — it's reading the value. Two addresses with the same components are equal; the components are public by design.

The spec choice — making accessors public, the class implicitly `final`, no setters — encodes the *value semantics* explicitly. Callers of records aren't "talking to strangers"; they're reading data they're entitled to read.

The corollary: don't put *behavioural collaborators* (other entities) as record components. The moment a record has `Customer customer` as a component, callers will write `record.customer().something()` — and the LoD violation is back, just dressed as a record.

---

## 6. Sealed types (JLS §8.1.1.2) — closed graphs

Sealed types (JEP 409) let an aggregate declare *exactly which subtypes exist*:

```java
public sealed interface PaymentMethod
    permits CardPayment, BankPayment, CryptoPayment { }
```

LoD interacts with sealed types in two ways:

- **Pattern-match dispatch**, not navigation: `switch (paymentMethod) { case CardPayment c -> ...; case BankPayment b -> ...; }` is exhaustive — the compiler enforces every case is handled. The caller doesn't navigate; the compiler routes.
- **Closed knowledge**: callers know the *set* of variants without needing to walk a hierarchy. Adding a new variant is a deliberate spec change, not a silent extension.

The combination of sealed types + pattern matching + records gives you ML-style algebraic data types: navigation is replaced by pattern dispatch, and the dispatch is checked at compile time.

---

## 7. Private constructors (JLS §8.8.10) — guarded creation

A class with only `private` constructors cannot be instantiated outside its own source. Combined with package-private classes, this makes *aggregate internals creatable only by the aggregate*:

```java
package com.acme.order;

public final class Order {
    private final List<LineItem> lineItems;
    public Order(List<LineItem> items) {
        this.lineItems = items.stream().map(LineItem::new).toList();
    }
}

final class LineItem {
    private final Sku sku;
    private final int quantity;
    LineItem(LineItemSpec spec) { /* package-private constructor */ }
}
```

External code cannot create `LineItem`s, cannot import them, cannot bind variables of their type. The aggregate root is the only constructor for its internals. LoD's "external callers don't see internals" becomes a compile-and-runtime property.

---

## 8. JVMS §6.5 — dispatch costs of LoD-respecting chains

When LoD is applied (push the intent to the owning object), the resulting code uses repeated method calls instead of structural navigation. Five bytecodes participate:

```
invokestatic     // class-level method
invokespecial    // <init>, private, super.m()
invokevirtual    // virtual dispatch on a class
invokeinterface  // virtual dispatch via interface
invokedynamic    // bootstrapped call site (lambdas, default methods through indy)
```

A LoD-compliant chain like `order.applyDiscount(d)` (which inside delegates to `lineItems.forEach(li -> li.applyDiscount(d))`) issues:

1. `invokevirtual Order.applyDiscount`
2. `invokevirtual ArrayList.forEach`
3. Per item: `invokeinterface LineItem.applyDiscount` (via lambda)

The original train-wreck chain `order.lineItems().forEach(li -> li.applyDiscount(d))` issues a similar count, but adds:

0. `invokevirtual Order.getLineItems`

The bytecode delta is one method call. The *coupling* delta is one class. For LoD's cost equation, the bytecode is irrelevant; the dependency graph is everything.

The JIT inlines monomorphic LoD-compliant calls fully — push-style code is, in practice, the same speed as walking the structure.

---

## 9. JLS §15.12 — method invocation resolution

The §15.12 rules describe how a method call site resolves: compile-time type, member lookup, applicability, overload resolution. Two of those rules matter for LoD:

- **Compile-time type checks accessibility.** §15.12.2 requires the resolved method to be *accessible* from the call site (§6.6). If the method is package-private and the caller is in a different package, the call site fails to compile. This is the language-level LoD enforcement seam.
- **Static binding vs dynamic dispatch.** §15.12.4 specifies that an `invokeinterface`/`invokevirtual` resolves to the *runtime class's* method, not the compile-time class's. LoD doesn't depend on this — it depends on what the compile-time type allows you to *name*.

The combination: §6.6 (access) + §15.12 (resolution) means LoD is enforced at compile time as a *type-system* property, not at runtime.

---

## 10. JLS §7.7 — modules as LoD's deployment seam

A module's `module-info.java` is the deployment-scale LoD declaration. Three relevant clauses:

- `exports com.acme.order` — only this package is reachable from outside.
- `exports com.acme.order to com.acme.fulfillment` — *qualified* export to a specific module.
- `opens com.acme.order` — open for *reflection* by everyone (rare; reverses strong encapsulation deliberately).

The qualified export is the strongest LoD enforcer: an aggregate's public API is visible *only to specific named consumers*. Other modules can't even compile against it.

```java
module com.acme.order {
    exports com.acme.order to com.acme.checkout, com.acme.fulfillment;
    requires com.acme.shared.api;
}
```

`com.acme.reporting` cannot use `com.acme.order` at all — at the linker level, not just by convention. LoD becomes a *deployment policy*.

---

## 11. JEP references

| JEP            | Feature                              | LoD relevance                            |
|----------------|--------------------------------------|------------------------------------------|
| JEP 261        | Java Platform Module System          | Runtime-enforced LoD seam (strong encapsulation) |
| JEP 396, 403   | Strong encapsulation by default      | Reflection cannot bypass without `opens` |
| JEP 395        | Records                              | Values are LoD-exempt by design          |
| JEP 409        | Sealed classes                       | Pattern dispatch instead of navigation   |
| JEP 406, 441   | Pattern matching for `switch`        | Exhaustive case handling over closed types |

Modern Java's evolution is consistently in the LoD direction: stronger encapsulation, more value-shaped types, more closed-set dispatch. The slogan "don't talk to strangers" is increasingly enforced by the spec itself.

---

## 12. Reading list

1. **JLS §6.6** — Access control. The compile-time LoD enforcement seam.
2. **JLS §7.7** — Module declarations. The deployment-scale seam.
3. **JLS §8.1.3** — Nested types. Inner classes are LoD-relevant — they share the enclosing class's namespace.
4. **JLS §8.10** — Records. The value-carrier exemption.
5. **JLS §8.1.1.2** — Sealed types.
6. **JEP 261** — Module system.
7. **JEP 395** — Records.
8. **JEP 409** — Sealed classes (final).
9. **Karl Lieberherr & Ian Holland** — *Assuring Good Style for Object-Oriented Programs*, IEEE Software 6(5), 1989. The original Law of Demeter paper.
10. **Karl Lieberherr** — *Adaptive Object-Oriented Software: The Demeter Method*, PWS Publishing, 1996. Book-length treatment.
11. **Eric Evans** — *Domain-Driven Design*, Addison-Wesley, 2003. Aggregate boundaries are LoD applied at the design scale.
12. **Joshua Bloch** — *Effective Java*, 3rd ed., items 15 (minimize accessibility), 16 (favour accessor methods over public fields), 18 (favour composition over inheritance). The Java-specific corollaries.

The spec doesn't *teach* LoD — it gives you the vocabulary to enforce it. When a coworker asks "why is this `LineItem` package-private?", you cite §6.6.1. When they ask "why doesn't reflection work?", you cite JEP 261. The spec sections are how the heuristic stops being a slogan and becomes a structural property of your code.
