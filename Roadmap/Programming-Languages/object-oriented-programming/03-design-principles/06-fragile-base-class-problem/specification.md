# Fragile Base Class Problem — Specification Reading Guide

> FBCP is a *design hazard*; the JLS doesn't name it but provides every tool to mitigate it: `final` classes and methods (§8.1.1.2, §8.4.3.4), `sealed`/`permits` (§8.1.1.2, §9.1.1.4), override rules (§8.4.8), the `@Override` annotation (§9.6.4.4), constructors and instance-initialization order (§12.5), and the JVMS Method Resolution rules (§5.4.5). This file maps the hazard to the binding spec text and explains where FBCP becomes an enforceable property.

---

## 1. Where to find the canonical text

| Concept                                       | Authoritative source                              |
|-----------------------------------------------|---------------------------------------------------|
| Class modifiers (`final`, `sealed`, `abstract`) | **JLS §8.1.1.2**                                |
| `final` methods                               | JLS §8.4.3.4                                      |
| Method overriding                             | **JLS §8.4.8** (and §8.4.8.1 — §8.4.8.4)          |
| Covariant return types                        | JLS §8.4.5                                        |
| Throws clause restrictions on overrides       | JLS §8.4.6.4                                      |
| Access modifiers and inheritance              | JLS §6.6.4                                        |
| Sealed classes / interfaces                   | JLS §8.1.1.2, §9.1.1.4 (JEP 409)                  |
| `@Override` annotation                        | JLS §9.6.4.4                                      |
| Instance initialization order                 | **JLS §12.5**                                     |
| Constructors                                  | JLS §8.8                                          |
| Method invocation bytecodes                   | **JVMS §6.5** (invokevirtual, invokespecial, etc.)|
| Method resolution at runtime                  | JVMS §5.4.5                                       |
| Class loading and linking                     | JVMS §5                                           |
| Binary compatibility                          | **JLS §13** — *Binary Compatibility*              |

The **JLS** is what `javac` enforces; the **JVMS** is what the JVM enforces. FBCP lives one level above both; the spec features above either prevent it (sealed, final) or constrain it (override rules, binary compatibility).

---

## 2. JLS §8.4.8 — the override contract

JLS §8.4.8 defines when a subclass method overrides a superclass method. The rules are exactly what FBCP needs to manage:

- **Same erased signature.** A method in `S` overrides a method in `C` only if it has the same name and erased parameter types (§8.4.2).
- **Return type substitutability (§8.4.5).** Covariant return types are allowed; a subtype return is fine. A wider return type isn't.
- **Throws clause (§8.4.6.4).** The override may declare *fewer or narrower* checked exceptions, never more or wider.
- **Access (§8.4.8.3).** The override must be at least as accessible as the parent.
- **`final` (§8.4.8.4).** A `final` method cannot be overridden; trying to declare an override is a compile error.

These rules close *some* FBCP forms but not all:

- Form 1 (self-use change) is *not* a JLS violation — the parent can change its self-use freely. The subclass's override fires or doesn't based on what the parent now calls.
- Form 2 (accidental override) is partially caught by `@Override`: if the subclass annotates a method intending to override and there's no matching parent method, compile error.
- Form 3 (removed `super.x()` call) is caught at compile time if the parent's method is removed; not caught if the method is left in place but no longer called by the workflow.

---

## 3. `final` (JLS §8.1.1.2, §8.4.3.4) — the strongest FBCP mitigation

A `final` class cannot be extended; a `final` method cannot be overridden. JLS §8.1.1.2 spells out the compile error for extending a `final` class; §8.4.3.4 for overriding a `final` method. Both are *compile-time* checks — `javac` refuses bad code.

```java
public final class Money { /* no subclasses */ }
public sealed class Result permits Success, Failure { /* closed extension */ }
```

For FBCP:

- A `final` class has zero FBCP exposure — no subclass exists.
- A class with `final` methods has FBCP exposure only on its overridable methods. Marking *non-hook* methods `final` shrinks the contract.

Joshua Bloch's *Effective Java* item 17: "Minimize mutability." Item 19: "Design and document for inheritance or else prohibit it." The latter is *spec-enforced* via `final`.

---

## 4. `sealed` (JLS §8.1.1.2, §9.1.1.4) — closed-world FBCP

Sealed types (JEP 409, final in Java 17) declare exactly which classes may extend:

```java
public sealed class Account permits CheckingAccount, SavingsAccount, LoanAccount { }
public final class CheckingAccount extends Account { }
public final class SavingsAccount extends Account { }
public final class LoanAccount extends Account { }
```

JLS §8.1.1.2 specifies:

- The `permits` clause lists the *exact* set of permitted direct subclasses.
- Each permitted subclass must declare exactly one of `final`, `sealed` (with its own `permits`), or `non-sealed`.
- Permitted subclasses must be in the same module (or same package, if unnamed module).
- The compiler verifies the closure at compile time.

JVMS §4.7.31 records the `PermittedSubclasses` attribute in the class file. The verifier refuses classes that try to extend a sealed type without being in the `permits` list.

For FBCP:

- A sealed hierarchy's subclasses are *all under your control*. You can update them in lockstep with the parent.
- A consumer adding their own subclass is a compile error.
- Pattern-match switches on sealed types are exhaustive — adding a variant forces every consumer to handle it.

`sealed` is FBCP made manageable: the contract is between *known* parties.

---

## 5. JLS §12.5 — instance initialization order

The initialization order during `new` is where FBCP can bite via *virtual calls in constructors*:

1. Allocate memory; all fields zero/null.
2. Invoke the superclass constructor (via `super(...)`).
3. Initialize instance variables and execute instance initializers (in textual order).
4. Execute the body of the constructor.

The hazard: if the *superclass constructor* invokes a virtual method (one that subclasses might override), the override fires *before* the subclass's own fields are initialized.

```java
public class Parent {
    public Parent() { onConstruct(); }              // virtual call in constructor
    protected void onConstruct() { /* default */ }
}

public class Child extends Parent {
    private final String name;
    public Child(String n) {
        super();                                    // Parent() runs, calls onConstruct()...
        this.name = n;
    }
    @Override
    protected void onConstruct() {
        System.out.println(name.length());          // NPE: name is null!
    }
}
```

JLS §12.5 makes this behaviour exact: at the time `onConstruct()` runs (during `super()`), `Child`'s constructor body hasn't executed yet, so `this.name` is still `null`.

The JLS doesn't forbid the pattern (Java's design lets you), but it's the FBCP form most subtly hard to debug. Bloch's *Effective Java* item 19 recommends: *never invoke an overridable method from a constructor*. Designed-for-inheritance classes should be explicit about which methods are safe to call from constructors (typically: none).

---

## 6. JLS §13 — binary compatibility

JLS §13 specifies which changes to a class are *binary-compatible*: callers compiled against the old version continue to work without recompilation when linked against the new version.

For FBCP, the relevant rules:

- **Adding a method** to a class is binary-compatible *for callers* but can break subclasses (accidental override if the new method matches a subclass's signature).
- **Removing a method** is binary-incompatible: callers throw `NoSuchMethodError` at link time.
- **Changing a method's return type** is binary-incompatible.
- **Adding `final` to a method** is source-compatible for callers, *binary-incompatible* for subclasses that override.
- **Changing the access modifier from `protected` to `package-private`** breaks subclasses in other packages.

`japicmp` and `revapi` implement these rules mechanically. A binary-incompatible change to a published library is FBCP made concrete: subclass authors *will* have their code break.

```java
// Detect binary-incompatible changes
$ japicmp -o old.jar -n new.jar --html-file report.html
```

The JLS gives you the precise rulebook; the tools apply it.

---

## 7. `@Override` annotation (JLS §9.6.4.4)

`@Override` is a *compile-time check*: if the annotated method doesn't override a superclass method, the compile fails.

```java
public class Repository {
    public void save(Object entity) { /* ... */ }
}

public class CachingRepository extends Repository {
    @Override public void Save(Object entity) { ... }   // compile error: typo
}
```

Without `@Override`, the misspelled `Save` would silently become a *new* method on `CachingRepository`, and the parent's `save` would still be called through inheritance. The override-by-typo bug is exactly FBCP form 2.

The annotation catches:

- Typos in method names.
- Subclass methods that no longer override after a parent rename.
- Subclass methods that *accidentally* match a newly-added parent method (the subclass author marked it `@Override` only when intentional).

Use `@Override` on every override. Modern IDE templates and Sonar rules enforce this.

---

## 8. JVMS §5.4.5 — method resolution at runtime

When `invokevirtual` runs, the JVM resolves the method against the *runtime class* of the receiver, not the static type. JVMS §5.4.5 defines the search:

1. Start at the receiver's runtime class.
2. Look for a method matching the resolved name and signature.
3. If not found, continue up the superclass chain.
4. Stop at `java.lang.Object` (or throw `AbstractMethodError`).

This is the substrate of polymorphic dispatch. For FBCP, it means: *every virtual call site potentially binds to any subclass's override*. The JIT can specialize (via CHA) when only one subclass exists, but the language semantics require this lookup.

`invokespecial` (used for `super.x()` calls, constructors, and `private` methods) bypasses this: it dispatches *statically* to the exact resolved method. That's why `super.method()` always means "the parent's exact implementation".

For FBCP form 1 (self-use change), the resolution rules are exactly what makes the hazard happen: the parent's `invokevirtual` of `this.x()` dispatches to the subclass's override. Changing the parent's source to call `x()` differently changes the dispatch differently.

---

## 9. JEPs that reduce FBCP

| JEP            | Feature                              | FBCP mitigation                          |
|----------------|--------------------------------------|------------------------------------------|
| JEP 360, 409   | Sealed classes                       | Closed-world inheritance — managed FBCP  |
| JEP 395        | Records                              | Implicitly `final`; no FBCP exposure     |
| JEP 261        | Module system                        | Internals not exported → no external extension |
| JEP 396, 403   | Strong encapsulation                 | Reflection can't bypass module boundaries |
| JEP 401 (preview) | Value classes                     | Identity-free, implicitly `final`        |

Modern Java has trended toward making FBCP a managed property: more `final`, more `sealed`, less reflective exposure.

---

## 10. Reading list

1. **JLS §8.4.8** — Methods: overriding, hiding. The override contract.
2. **JLS §8.1.1.2** — Class modifiers. `final` and `sealed`.
3. **JLS §8.4.3.4** — Final methods.
4. **JLS §12.5** — Instance initialization order. The constructor hazard.
5. **JLS §13** — Binary compatibility. What changes break callers.
6. **JLS §9.6.4.4** — `@Override`.
7. **JVMS §5.4.5** — Method resolution. The dispatch substrate.
8. **JVMS §6.5** — `invokevirtual` vs `invokespecial`.
9. **JEP 409** — Sealed classes (final).
10. **Joshua Bloch** — *Effective Java*, 3rd ed., items 17 (minimize mutability), 18 (favour composition), 19 (design and document for inheritance or prohibit it). The canonical FBCP discussion.
11. **Leonid Mikhajlov & Emil Sekerinski** — *A Study of the Fragile Base Class Problem*, ECOOP 1998. The original academic treatment of the term.
12. **Erich Gamma et al.** — *Design Patterns: Elements of Reusable Object-Oriented Software*, 1994. "Favour object composition over class inheritance" (p. 20) — the headline preventive guidance.

The spec doesn't *teach* FBCP — it gives you the levers to prevent it. When a reviewer asks "why mark this `final`?", you cite §8.4.3.4. When they ask "why sealed?", you cite §8.1.1.2 + JEP 409. When they ask "is this binary-compatible?", you cite §13 and run `japicmp`. The spec turns the design hazard into a set of enforceable, measurable properties.
