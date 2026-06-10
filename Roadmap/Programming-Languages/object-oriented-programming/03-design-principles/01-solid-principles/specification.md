# SOLID Principles — Specification Reading Guide

> SOLID is a *design* discipline, not a language rule. Robert C. Martin's five letters describe *what good OO code should look like*; none of them appear in the Java Language Specification by name. But the JLS and JVMS provide the *machinery* that lets you enforce SOLID at compile time and trust it at runtime: overriding rules (§8.4.8), sealed hierarchies (§8.1.1.2), final fields (§8.3.1.3), interface evolution (§9), the module system (§7.7), and the four `invoke*` dispatch instructions (JVMS §6.5). This file maps each letter to the binding spec text that makes it real in Java.

---

## 1. Where to find the canonical text

| Concept                                       | Authoritative source                              |
|-----------------------------------------------|---------------------------------------------------|
| Overriding, hiding, behavioural compatibility | **JLS §8.4.8** — *Inheritance, Overriding, Hiding* |
| Covariant return types                        | JLS §8.4.5                                        |
| Throws clause restrictions on overrides       | JLS §8.4.6.4                                      |
| Sealed classes and `permits`                  | **JLS §8.1.1.2**                                  |
| Final classes and final methods               | JLS §8.1.1.2, §8.4.3.4                            |
| Final fields and immutable publication        | JLS §8.3.1.3, §17.5                               |
| Constructors                                  | JLS §8.8                                          |
| Interfaces, default methods, sealed interfaces| **JLS §9**, esp. §9.1.1.4, §9.4.3                 |
| Modules and `module-info.java`                | **JLS §7.7**, JEP 261, JEP 396                    |
| `invokevirtual` / `invokeinterface` / `invokespecial` / `invokestatic` / `invokedynamic` | **JVMS §6.5** |
| Records (value-carrier SRP)                   | JLS §8.10 — JEP 395                               |
| Pattern matching for `switch`                 | JLS §14.11, §15.28 — JEP 406, JEP 441             |
| Sealed classes JEP                            | JEP 360 (preview), JEP 409 (final)                |

The **JLS** is what `javac` enforces; the **JVMS** is what the JVM enforces. SOLID lives one level above both — but each letter has a spec hook you can point to when arguing about a design.

---

## 2. Where SOLID lives in the spec — the honest answer

SOLID is not normative. You will not find a `SingleResponsibilityChecker` in `javac`. What the spec provides is a set of *features* that make SOLID enforceable or cheap:

| Letter | Spec machinery that supports it                                   |
|--------|-------------------------------------------------------------------|
| S      | None directly — judged by stakeholders, not the compiler          |
| O      | `sealed`/`final` (§8.1.1.2, §8.4.3.4), `abstract` (§8.1.1.1)      |
| L      | Override rules (§8.4.8), covariant returns (§8.4.5), throws (§8.4.6.4) |
| I      | Interfaces (§9), default methods (§9.4.3), sealed interfaces (§9.1.1.4) |
| D      | Final fields (§8.3.1.3), constructors (§8.8), interfaces (§9)     |

SRP is the only letter with no language hook. The other four can each be tightened into a *compile error* when you choose the right keywords.

---

## 3. LSP and JLS §8.4.8 — the override contract

JLS §8.4.8 defines when a subclass method *overrides* a superclass method. The rules are exactly what LSP requires of a substitutable subtype:

- **Same erased signature.** A method in `S` overrides a method in `C` only if it has the same name and erased parameter types (§8.4.2).
- **Return type (§8.4.5).** The override's return type must be *return-type substitutable* — either the same type or a subtype (covariant return). You cannot return a *wider* type than the parent declared.
- **Throws clause (§8.4.6.4).** The override may declare *fewer or narrower* checked exceptions than the parent, never more or wider.
- **Access (§8.4.8.3).** The override must be at least as accessible as the parent. A `public` method cannot be overridden by a `protected` one.
- **`final`/`static` (§8.4.8.4).** A `final` method cannot be overridden at all; a `static` method is *hidden*, not overridden, and is therefore not polymorphic.

```java
class Parent {
    public Number compute() throws IOException { return 0; }
}

class Child extends Parent {
    @Override
    public Integer compute() throws FileNotFoundException { return 1; }   // OK
    // public Object compute() throws Exception { ... }                   // compile error
}
```

These rules are LSP at the *signature* level. The `Child.compute()` here returns *something more specific* and throws *something narrower* — so any caller written against `Parent` keeps working. The compiler enforces this side of the contract; the *behavioural* side (postconditions, invariants) is still the programmer's job.

---

## 4. ISP and JLS §9 — interfaces as the unit of role

JLS §9 governs interface declarations. Several of its rules are the spec backing for ISP:

- **Multiple inheritance of types (§9.1.3).** A class may implement many interfaces. This means you can compose narrow roles instead of inheriting one fat type.
- **Default methods (§9.4.3).** Since Java 8, interfaces may carry method bodies. This lets you split an existing fat interface *without breaking implementers* — provide a default for the methods you split out, then deprecate them.
- **Sealed interfaces (§9.1.1.4).** Since Java 17, an interface may declare `sealed` and a `permits` clause. The set of implementers is closed at compile time:

```java
public sealed interface Result<T>
    permits Result.Success, Result.Failure {

    record Success<T>(T value)        implements Result<T> {}
    record Failure<T>(Throwable cause) implements Result<T> {}
}
```

Sealing an interface gives ISP a hard edge: only the named types may pose as a `Result`. Combined with pattern `switch` (§15.28), the compiler proves exhaustiveness — adding a new variant becomes a deliberate, reviewed change rather than a silent extension.

A *narrow* interface plus `default` evolution is the spec's gift to ISP. The price of a wide interface — every implementer being forced to implement every method — is exactly what §9 lets you avoid.

---

## 5. OCP and JLS §8.1.1.2 / §8.4.3.4 — closed on purpose

OCP says: open for extension, closed for modification. The "closed" half is a *positive* statement — you must mark what is *not* allowed to change, so callers can rely on it.

JLS provides three closure mechanisms:

- **`final` class (§8.1.1.2).** No subclasses. The class's behaviour is frozen. `String`, `Integer`, every record (§8.10) are final by spec.
- **`final` method (§8.4.3.4).** Subclasses inherit but cannot override. The implementation is part of the type's contract.
- **`sealed` class (§8.1.1.2).** A class may declare `sealed permits A, B, C` — the set of direct subclasses is fixed at compile time. Each permitted subclass must declare exactly one of `final`, `sealed` (with its own `permits`), or `non-sealed`.

```java
public sealed abstract class PaymentMethod
    permits CardPayment, BankPayment, CryptoPayment {

    public abstract void charge(BigDecimal amount);
}

public final class CardPayment   extends PaymentMethod { /* ... */ }
public final class BankPayment   extends PaymentMethod { /* ... */ }
public final class CryptoPayment extends PaymentMethod { /* ... */ }
```

`PaymentMethod` is *open for extension* — any of the three permitted subclasses adds new behaviour through polymorphism. It is *closed for modification* — a fourth subclass cannot be added without editing `permits`. The compiler protects the extension axis you designed for, and refuses the ones you didn't.

Before sealed classes existed (pre-Java 17), the only way to express "closed" was `final` (no extension) or convention (a comment saying "do not subclass"). JEP 409 made the design intent enforceable.

---

## 6. DIP and JLS §8.3.1.3 / §8.8 — immutability and constructor injection

DIP says high-level policy depends on abstractions; details depend on abstractions. The Java idiom — *constructor injection of an interface, stored in a final field* — uses three spec features:

- **`final` field (§8.3.1.3, §16).** The field must be definitely assigned exactly once before the constructor returns. After that, it cannot be reassigned.
- **Constructor (§8.8).** The single point where the field is assigned.
- **`final` field publication (§17.5).** If `this` does not escape the constructor, every thread that observes the constructed reference is guaranteed to see the correct `final` field values *without synchronization*.

```java
public interface OrderRepository { void save(Order o); }

public final class OrderService {
    private final OrderRepository repo;

    public OrderService(OrderRepository repo) {       // injection point
        this.repo = Objects.requireNonNull(repo);     // §8.8 — runs before publication
    }

    public void place(Order o) { repo.save(o); }
}
```

Three things to notice:

1. `repo` is declared as the interface, not as the concrete `PostgresOrderRepository`. The dependency arrow points from `OrderService` to *the abstraction*, never to a detail.
2. `final` makes the field unchangeable after construction (§8.3.1.3) and gives the publication guarantee (§17.5). DIP plus safe immutability for free.
3. The constructor is the only mutation site. No setter exists, so no caller can swap the repository mid-flight.

Field injection by reflection (`@Autowired` on a non-final field) breaks the safe-publication guarantee. The spec rewards constructor injection.

---

## 7. SRP — the letter without a spec hook

SRP is the one principle the spec cannot help you with. "One reason to change" is a *stakeholder concept* — who edits this class, which department's requests force a recompile? `javac` has no view of stakeholders.

What the spec *can* do:

- **Records (§8.10).** A record's only job is to be a value carrier. Putting business logic in a record stretches its responsibility — pulling it out is mechanical.
- **Module exports (§7.7).** A module can hide everything except the surface it exports. A package whose one job is to provide one abstraction is a literal manifestation of SRP at the boundary.

SRP violations show up as long files, fat constructors, and many imports — but no compile error will fire. It is reviewed by humans or by lint tooling (Checkstyle, ArchUnit, PMD), not by the spec.

---

## 8. JEP references and SOLID

| JEP            | Feature                              | SOLID letter it supports                 |
|----------------|--------------------------------------|------------------------------------------|
| JEP 360, 397, 409 | Sealed classes (preview → final)  | O (closure), I (sealed interfaces), L    |
| JEP 395        | Records                              | S (single value responsibility)          |
| JEP 406, 420, 427, 441 | Pattern matching for `switch`| O + I (exhaustive dispatch over sealed types) |
| JEP 286, 323   | `var` for local-variable type inference | D (encourages naming the interface in fields, the implementation in `var` locals) |
| JEP 261        | Java Platform Module System          | All five at boundary level               |
| JEP 401 (preview) | Value classes                     | S (identity-free value carriers)         |

Modern Java is closer to a SOLID-friendly language than Java 7 was. Sealed types + pattern matching let you write OCP-respecting code without an inheritance tree; records make SRP-shaped value classes a one-liner; modules push DIP across packaging boundaries.

---

## 9. JVMS §6.5 — dispatch instructions behind LSP

The five method invocation bytecodes implement the runtime side of LSP:

```
invokestatic     // §6.5.invokestatic    — class-level method, no receiver
invokespecial    // §6.5.invokespecial   — <init>, private, super.m()
invokevirtual    // §6.5.invokevirtual   — virtual dispatch on a class type
invokeinterface  // §6.5.invokeinterface — virtual dispatch via interface
invokedynamic    // §6.5.invokedynamic   — bootstrapped call site (lambdas, etc.)
```

The polymorphic dispatch that makes LSP and OCP work at runtime is `invokevirtual` and `invokeinterface`. Both look up the *actual* receiver's method using its class's method resolution table (vtable / itable):

```
0: aload_1                                   ; load PaymentMethod ref
1: invokeinterface #4, 1   // charge:(...)   ; resolve at call site
```

The JVM finds `charge` on the *runtime class* of the receiver, not the compile-time type. This is what makes "depend on the abstraction" cheap — the call site references the interface; the JIT specializes once it observes the actual receiver types.

`invokespecial` is the exception: it dispatches *statically* and is used for constructors, `private` methods, and explicit `super.m()` calls. That is why `super.m()` always means "the parent's exact implementation" and cannot be re-routed by a deeper subclass.

`invokedynamic` (JVMS §6.5.invokedynamic) is the modern call site — used by `lambda` (JEP 181) and by `String` concatenation (JEP 280). It lets the JVM choose the implementation at first call and cache it. Functional interfaces are an ISP-friendly type (one method, one role) and pay for themselves through `invokedynamic`.

---

## 10. JLS §7.7 — the module system as boundary-level SOLID

The module system (introduced by Java 9, JEP 261) raises SOLID from the class level to the *deployment* level. A `module-info.java` declares:

```java
module com.example.orders {
    requires com.example.payments;       // I depend on this abstraction
    exports  com.example.orders.api;     // this is my public contract
    // everything else is invisible to the outside world
}
```

How modules support each letter:

- **S** — a module declares a single purpose. The `exports` list is the surface area; anything not exported is *strongly* encapsulated (the runtime, not just the compiler, enforces it).
- **O** — `exports` is a closed set. Adding a new exported package is a deliberate change, like adding a `permits` entry.
- **L** — modules version their public API. A consumer module's `requires` clause names what it expects; the contract is testable at link time (`jlink`).
- **I** — `exports … to module.X` lets you expose narrow interfaces to specific consumers — ISP at the module boundary.
- **D** — `requires com.example.payments.api` (an *interface-only* module) keeps the dependency arrow on abstractions. Implementation modules are loaded via `ServiceLoader` (`uses` / `provides`).

```java
module com.example.orders {
    requires com.example.payments.api;     // depend on abstraction
    uses     com.example.payments.api.PaymentGateway;   // ServiceLoader hook
}
module com.example.payments.stripe {
    requires com.example.payments.api;
    provides com.example.payments.api.PaymentGateway
        with com.example.payments.stripe.StripeGateway;
}
```

The runtime wires the implementation at startup. The orders module never names `StripeGateway`. This is DIP enforced by the runtime linker.

---

## 11. Reading list

1. **JLS §8.4** — Methods. Read §8.4.5 (covariant returns), §8.4.6 (throws), §8.4.8 (override rules). These are the LSP backbone.
2. **JLS §8.1.1.2** — Sealed and final class modifiers. The closure side of OCP.
3. **JLS §9** — Interfaces. §9.4.3 (default methods) and §9.1.1.4 (sealed interfaces) are the ISP machinery.
4. **JLS §17.5** — Final field semantics. The publication guarantee that makes constructor injection thread-safe.
5. **JLS §7.7** — Module declarations. SOLID at the boundary.
6. **JVMS §6.5** — Method invocation instructions. The runtime mechanics behind LSP.
7. **JEP 360 / 397 / 409** — Sealed classes, from preview to final.
8. **JEP 395** — Records.
9. **JEP 406 / 441** — Pattern matching for `switch`, exhaustiveness over sealed types.
10. **Robert C. Martin** — *Design Principles and Design Patterns* (objectmentor.com, 2000) — the original SOLID essay. *Agile Software Development: Principles, Patterns, and Practices* (Prentice Hall, 2002) — book-length treatment. *Clean Architecture* (Prentice Hall, 2017) — SOLID at the architecture level.
11. **Barbara Liskov, Jeannette Wing** — *A Behavioral Notion of Subtyping*, TOPLAS 16(6), 1994 — the formal LSP paper.
12. **Bertrand Meyer** — *Object-Oriented Software Construction* (Prentice Hall, 1997) — the source of "open/closed" (Meyer's original, contract-by-design version, slightly different from Martin's).

The spec sections do not *teach* SOLID — they give you the vocabulary to point at when you say "this design relies on §8.4.8 holding". When a coworker says "but my subclass works", you cite the rule. When a reviewer says "this is too coupled", you reach for `sealed` (§8.1.1.2) or a narrower interface (§9.1.1.4). SOLID is judgement; the spec gives you the levers.
