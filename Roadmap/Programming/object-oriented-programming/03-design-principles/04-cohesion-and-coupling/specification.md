# Cohesion and Coupling — Specification Reading Guide

> Cohesion and coupling are *design heuristics*; neither term appears in the Java Language Specification. The JLS instead gives you the *machinery* to enforce them: access modifiers (§6.6), packages (§7), modules and `module-info.java` (§7.7), interfaces (§9), the four `invoke*` dispatch instructions (JVMS §6.5), and the class file's dependency-relevant attributes (`Module`, `ModulePackages`, `BootstrapMethods` — JVMS §4.7). This file maps each heuristic to the binding spec text that makes it enforceable.

---

## 1. Where to find the canonical text

| Concept                                       | Authoritative source                              |
|-----------------------------------------------|---------------------------------------------------|
| Access modifiers (`public`, `protected`, package, `private`) | **JLS §6.6**                              |
| Packages                                      | JLS §7                                            |
| Modules and `module-info.java`                | **JLS §7.7**, JEP 261                            |
| Class declarations                            | JLS §8.1                                          |
| Nested types and inner classes                | JLS §8.1.3                                        |
| Interfaces and default methods                | **JLS §9**, esp. §9.1.1.4, §9.4.3                 |
| Records                                       | JLS §8.10                                         |
| Sealed types                                  | JLS §8.1.1.2, §9.1.1.4                            |
| Method invocation                             | JLS §15.12                                        |
| Method invocation bytecodes                   | **JVMS §6.5**                                     |
| Class file structure                          | JVMS §4                                           |
| Strong encapsulation, JPMS                    | JEP 261, 396, 403                                 |
| Module attribute in class file                | JVMS §4.7.25                                      |
| ModulePackages attribute                      | JVMS §4.7.26                                      |
| Constant pool                                 | JVMS §4.4                                         |

The **JLS** is what `javac` enforces; the **JVMS** is what the JVM enforces. Cohesion lives in the *shape of types* you design; coupling lives in the *dependencies* between those types — both expressible through the spec features above.

---

## 2. Cohesion and coupling are not language rules — what the spec offers

The JLS does not contain `LCOMChecker` or `MaximumFanOutChecker`. What it provides is a set of *features* that let cohesion and coupling be enforced as *access-control* and *dependency-graph* properties:

| Heuristic concern                          | Spec mechanism that helps                                |
|--------------------------------------------|---------------------------------------------------------|
| Hide implementation details (raise cohesion) | `private` (§6.6.1), `private` constructors (§8.8.10) |
| Hide aggregate internals from other packages | Package access (§6.6.1), package-private classes (§8.1.1) |
| Hide aggregate internals from other modules  | Module `exports` (JLS §7.7, JEP 261)                  |
| Decouple via interfaces                      | Interfaces (§9), constructor injection (§8.8)          |
| Direction of dependency                     | Module `requires` (§7.7) — explicit, declared        |
| Limit subtype variation                     | `sealed`/`permits` (§8.1.1.2)                          |
| Prevent inheritance abuse                   | `final` class/method (§8.1.1.2, §8.4.3.4)              |

Coupling and cohesion become structural properties of the code, enforced at compile time and (with JPMS) at runtime.

---

## 3. JLS §6.6 — access control as decoupling

JLS §6.6 defines the four levels: `public`, `protected`, package, `private`. The decoupling-relevant fact: *callers cannot depend on what they cannot see*. A `private` field cannot be referenced from outside its class. A package-private class cannot be *imported* from outside its package.

```java
package com.acme.order;

public final class Order {
    private final List<LineItem> lineItems;      // §6.6.1 — private, unreachable
}

final class LineItem { /* package-private; unimportable from outside this package */ }
```

External callers cannot bind a variable of type `LineItem` — their `import com.acme.order.LineItem;` fails. The aggregate's *internal coupling* (Order ↔ LineItem) is preserved, but no external module gains coupling through it.

This is the language-level enforcement of *high cohesion inside the package, low coupling across packages*. The compiler refuses to compile cross-boundary couplings to internals.

---

## 4. JLS §7.7 — modules as the coupling boundary

The Java module system raises decoupling from compile-time to runtime. `module-info.java`:

```java
module com.acme.order {
    requires com.acme.payments;       // outgoing coupling — declared explicitly
    exports  com.acme.order.api;      // incoming coupling surface
    // anything else is invisible to outside the module
}
```

JEP 261 specifies that *non-exported packages* are inaccessible at runtime, even through reflection (unless explicitly opened with `opens ...`). The JVM's class loader refuses to load a class from a non-exported package on behalf of an outside module.

For cohesion and coupling:

- **`requires` declares fan-out** at the module scale, explicit in the source.
- **`exports` declares fan-in surface** — the only places other modules can hook into.
- **Strong encapsulation** means coupling cannot leak through reflection.
- **Qualified exports** (`exports x to module.Y`) cap fan-in to specific consumers — the strongest decoupling.

```java
module com.acme.order {
    requires com.acme.shared.api;
    exports com.acme.order.api;
    exports com.acme.order.internal to com.acme.audit;   // qualified; only audit can use
}
```

The module's coupling graph is now visible in one file. ArchUnit-level rules become spec-level guarantees.

---

## 5. JLS §9 — interfaces as the decoupling tool

JLS §9 defines interfaces. Several rules support decoupling:

- **Multiple-inheritance of type (§9.1.3).** A class may implement many interfaces. Callers can depend on the narrowest role they need (ISP-aligned).
- **Default methods (§9.4.3).** Interfaces may carry method bodies. Lets you add behaviour without forcing implementors to change.
- **Sealed interfaces (§9.1.1.4).** A `sealed` interface lists permitted implementations. Coupling is closed at compile time.

```java
public interface OrderRepository { void save(Order o); }       // narrow role, depends on Order only
public interface CustomerRepository { Customer load(long id); } // separate role

public final class OrderService {
    private final OrderRepository orders;     // depends on abstraction, not concrete
    private final CustomerRepository customers;
    public OrderService(OrderRepository o, CustomerRepository c) { orders = o; customers = c; }
}
```

`OrderService`'s coupling is to *two interfaces*, both narrow. Replacing either implementation requires zero changes to `OrderService`.

---

## 6. JLS §8.10 — records as cohesion units

A `record` is the JLS's blessing for *cohesive data*: a value carrier whose components belong together by purpose, with auto-generated `equals`/`hashCode`/`toString` from those components.

```java
public record Address(String street, String city, String zip, Country country) { }
```

JLS §8.10 specifies:

- Implicit `final` class.
- Private final fields per component.
- Public accessors.
- Implicit canonical constructor.

For cohesion, records say: "these components are *one value*, not separate fields". For coupling, records reduce *parameter stamp coupling* — instead of `(String street, String city, String zip, Country c)`, you pass one `Address`.

```java
public Money taxFor(Money subtotal, Address address) { /* ... */ }  // data coupling on address
// vs
public Money taxFor(Money subtotal, String street, String city, String zip, Country c) { /* stamp + scattered */ }
```

The record-shaped argument is *cohesive data passed as one unit*. The method's signature is shorter and its argument is meaningful.

---

## 7. JLS §8.1.1.2 — `final` and `sealed` for low coupling

`final` and `sealed` close the inheritance graph:

- **`final` class** — no subclasses can exist. The class's behaviour is fixed; downstream code can't extend it. *Reduces fan-in* through inheritance to zero.
- **`final` method** — subclasses (if any) cannot override. The method's contract is binding.
- **`sealed` class/interface** — the set of permitted subclasses is fixed at compile time.

```java
public sealed interface PaymentMethod permits Card, Bank, Crypto { }
public final class Card   implements PaymentMethod { ... }
public final class Bank   implements PaymentMethod { ... }
public final class Crypto implements PaymentMethod { ... }
```

Coupling to `PaymentMethod` is closed: callers can pattern-match exhaustively, and the addition of a new variant is a *spec-level change* (modifying `permits`) — not a silent extension by downstream code.

For decoupling, `sealed` lets you offer *substitutability without unbounded extension*: the consumer doesn't need to worry about subclasses they don't know about.

---

## 8. JVMS §6.5 — dispatch costs of decoupled code

The five method invocation bytecodes:

```
invokestatic     // class-level method
invokespecial    // <init>, private, super.m()
invokevirtual    // virtual dispatch on a class
invokeinterface  // virtual dispatch via interface
invokedynamic    // bootstrapped call site (lambdas)
```

Decoupling via interfaces uses `invokeinterface`. Sealed-types-and-pattern-match uses `invokevirtual` plus a typecheck chain. Both are *fast when monomorphic*: HotSpot inlines through them at the call site.

A `final` field holding an interface (the canonical injection pattern) is the JIT's best case for both:

```java
public final class OrderService {
    private final OrderRepository repo;       // final field, interface-typed
    public OrderService(OrderRepository r) { repo = r; }
    public void place(Order o) { repo.save(o); }   // invokeinterface, monomorphic, inlined
}
```

The JIT proves `repo` has one concrete type (CHA), devirtualizes, and inlines. Decoupling is *free at runtime* when monomorphic. See [`optimize.md`](optimize.md).

---

## 9. JLS §15.12 — method invocation and accessibility

JLS §15.12 describes how `javac` resolves a method call: compile-time type, member lookup, applicability, overload resolution. For decoupling, two rules matter:

- **§15.12.2 accessibility.** The resolved method must be *accessible* (§6.6) from the call site. Package-private methods can't be called from outside their package — a *compile-time* decoupling enforcement.
- **§15.12.4 dynamic dispatch.** `invokevirtual` / `invokeinterface` resolve to the runtime class's method, not the compile-time class's. This is the substrate that makes "depend on the abstraction" work.

The combination: accessibility (compile-time) plus dynamic dispatch (run-time) means decoupling is enforced as a *type-system* property, with no runtime overhead beyond the dispatch.

---

## 10. JVMS §4.7.25 — the Module attribute

A modular class file contains a `Module` attribute (JVMS §4.7.25) describing:

- The module's name.
- Its dependencies (`requires`).
- The exported packages.
- The opened packages.
- Service uses and provides.

```
Module:
  com.acme.order
  requires:
    java.base
    com.acme.payments  // explicit fan-out, in the bytecode
  exports:
    com.acme.order.api
```

The bytecode records *exact dependency intent*. JLink can analyze this to produce a minimal runtime image; the JVM uses it for accessibility checks at class load time. Coupling is no longer a code-review artefact — it's machine-readable.

---

## 11. JEP references

| JEP            | Feature                              | Cohesion/coupling relevance              |
|----------------|--------------------------------------|------------------------------------------|
| JEP 261        | Java Platform Module System          | Module-level decoupling                  |
| JEP 396, 403   | Strong encapsulation by default      | Reflection cannot bypass module boundaries|
| JEP 395        | Records                              | Cohesive data, reduced stamp coupling    |
| JEP 409        | Sealed classes                       | Closed inheritance — bounded coupling    |
| JEP 406, 441   | Pattern matching for `switch`        | Decoupling via dispatch over closed types|
| JEP 181        | Lambda expressions                   | Smallest possible interface for decoupling |
| JEP 401 (preview) | Value classes                     | Identity-free composition — no coupling via identity |

Modern Java's evolution is consistently in the cohesion-and-decoupling direction: stricter visibility, more value-shaped types, more bounded extension.

---

## 12. Reading list

1. **JLS §6.6** — Access control. Compile-time decoupling at the class level.
2. **JLS §7.7** — Modules. The strongest decoupling seam in the language.
3. **JLS §8.1.1.2** — `final` and `sealed` modifiers. Bounded coupling.
4. **JLS §8.10** — Records. Cohesive value types.
5. **JLS §9** — Interfaces. The decoupling abstraction.
6. **JVMS §4.7.25, §4.7.26** — Module attributes. Coupling in the class file.
7. **JVMS §6.5** — Method dispatch. Runtime cost of decoupling.
8. **Larry Constantine & Glenford Myers** — *Structured Design*, Prentice Hall, 1979. The original cohesion and coupling treatment.
9. **Meilir Page-Jones** — *What Every Programmer Should Know About Object-Oriented Design*, Dorset House, 1995. The connascence taxonomy.
10. **Robert C. Martin** — *Clean Architecture*, Prentice Hall, 2017. Cohesion and coupling at the architectural level.
11. **Joshua Bloch** — *Effective Java*, 3rd ed., items 15 (minimize accessibility), 16 (favour accessor methods), 64 (refer to objects by their interfaces). The Java-specific corollaries.
12. **Karl Lieberherr & Ian Holland** — *Law of Demeter* paper, 1989. LoD is a coupling minimizer.

The spec sections don't *teach* cohesion or coupling — they give you the vocabulary to enforce them. When a reviewer says "this class has too many reasons to change", you reach for `final` and split. When they say "this depends on too much", you reach for interfaces and constructor injection. When they say "the package boundary is leaking", you reach for module-info and qualified exports. The spec is the lever; the heuristic is the judgement.
