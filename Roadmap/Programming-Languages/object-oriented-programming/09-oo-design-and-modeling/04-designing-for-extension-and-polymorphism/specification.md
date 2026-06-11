# Designing for Extension & Polymorphism — Specification Reading Guide

> "Design for extension" is a *design principle*, not a language rule — neither the JLS nor the JVMS names the Open/Closed Principle. But the spec supplies every enforcement lever: `abstract` and `final` (JLS §8.1.1.1–§8.1.1.2), `sealed`/`permits` (§8.1.1.2, §9.1.1.4), method overriding and `invokevirtual`/`invokeinterface` dispatch (§8.4.8, JVMS §6.5), `default` methods for compatible evolution (§9.4.3), `ServiceLoader` and module `provides`/`uses` (§7.7), and binary-compatibility rules (§13). This file maps the principle to the canonical *literature* (Meyer, Martin, Bloch, GoF, Larman) and the binding spec text.

---

## 1. Where the principle is defined — the literature

The Open/Closed Principle and its design vocabulary are *literature*, not spec. Cite the source:

| Concept | Authoritative source |
| --- | --- |
| Open/Closed Principle (original) | **Bertrand Meyer**, *Object-Oriented Software Construction*, 1988/1997 — §3.4 "The Open-Closed Principle" |
| OCP (polymorphic, modern form) | **Robert C. Martin**, *Agile Software Development: Principles, Patterns, and Practices* (2002), ch. 9; *Clean Architecture* (2017), ch. 8 |
| Protected Variations (GRASP) | **Craig Larman**, *Applying UML and Patterns*, 3rd ed. (2004), §26.x — Protected Variations |
| Strategy, Template Method, Abstract Factory | **Gamma, Helm, Johnson, Vlissides (GoF)**, *Design Patterns* (1994) — pp. 315 (Strategy), 325 (Template Method), 87 (Abstract Factory) |
| "Favor composition over inheritance" | GoF, p. 20 |
| Design for inheritance or prohibit it | **Joshua Bloch**, *Effective Java*, 3rd ed. (2018), **Item 19** |
| Prefer interfaces to abstract classes | Bloch, **Item 20** |
| Design interfaces for posterity (`default`) | Bloch, **Item 21** |
| Use interfaces only to define types | Bloch, **Item 22** |
| Prefer class hierarchies to tagged classes | Bloch, **Item 23** (the "replace conditional with polymorphism" case) |
| Replace Conditional with Polymorphism (refactoring) | **Martin Fowler**, *Refactoring*, 2nd ed. (2018), ch. 10 |
| The Expression Problem | **Philip Wadler**, "The Expression Problem" (1998, email/note); **Torgersen**, "The Expression Problem Revisited" (ECOOP 2004) |
| Fragile Base Class hazard | **Mikhajlov & Sekerinski**, "A Study of the Fragile Base Class Problem", ECOOP 1998 |

---

## 2. Meyer's OCP vs Martin's OCP — read both, they differ

The two canonical formulations are *not the same idea*, and conflating them causes confusion in design debates.

- **Meyer (1988):** "A module should be open for extension but closed for modification." Meyer's mechanism was **implementation inheritance** — you extend a class by *subclassing*, leaving the original untouched. In Eiffel this was natural.
- **Martin (1996/2002):** reframes OCP around **abstraction and polymorphism**, not subclassing-for-reuse. You depend on an *abstract interface*; new behaviour is a new *implementation* of that interface. This is the form practitioners mean today, and it aligns with "favor composition over inheritance".

Read Meyer for the origin and the *why*; read Martin for the *how* you'll actually apply. When someone cites "OCP" in 2020s Java, they mean Martin's polymorphic form: stable abstractions, swappable implementations.

---

## 3. `abstract` and `final` (JLS §8.1.1.1, §8.1.1.2) — the openness switches

JLS §8.1.1.1 defines `abstract` classes (cannot be instantiated; may declare `abstract` methods — the *required* seams). §8.1.1.2 defines `final` classes (cannot be extended — extension *prohibited*).

```java
public abstract class ReportGenerator {     // §8.1.1.1 — open for extension via subclass
    protected abstract String body();        // §8.4.3.1 — abstract method = required seam
    public final String generate() { ... }   // §8.4.3.4 — final method = closed step
}
public final class Money { ... }            // §8.1.1.2 — extension prohibited (Bloch 19)
```

These are the two ends of the openness spectrum the spec gives you:

- `abstract` method → a seam the subclass *must* fill (Template Method's required step).
- `final` method → a step subclasses *cannot* touch (the fixed skeleton).
- `final` class → no inheritance at all (the Bloch Item 19 default).

A class that is neither `final` nor designed (no documented self-use) is *accidentally* open — the spec permits it, but the literature (Bloch 19) forbids it.

---

## 4. `sealed` / `permits` (JLS §8.1.1.2, §9.1.1.4) — closing extension precisely

Sealed types (JEP 409, final in Java 17) let you declare a *complete, closed* set of permitted subtypes:

```java
public sealed interface Shape permits Circle, Square, Triangle { }   // §9.1.1.4
public final class Circle   implements Shape { }
public final class Square   implements Shape { }
public non-sealed class Triangle implements Shape { }               // re-opened branch
```

JLS rules (§8.1.1.2):

- `permits` lists the *exact* permitted direct subtypes.
- Each permitted subtype must be `final`, `sealed` (with its own `permits`), or `non-sealed`.
- Permitted subtypes must be in the same module (or same package if the unnamed module).
- The compiler verifies closure at compile time.

The payoff for extension design is **exhaustiveness** (JLS §14.11.1.1, §6.5.6): a `switch` over a sealed type needs no `default`, and adding a variant makes every such switch a *compile error* until handled. This is the spec mechanism behind "operations-grow → sealed + switch" (the Expression Problem). The class file records the `PermittedSubclasses` attribute (JVMS §4.7.31); the verifier rejects unlisted extenders.

---

## 5. `default` methods (JLS §9.4.3) — compatible seam evolution

JLS §9.4.3 defines `default` methods: an interface method with a body, inherited by implementers that don't override it. This is the spec basis for Bloch **Item 21** ("design interfaces for posterity"):

```java
public interface PaymentGateway {
    PaymentResult charge(Money amount, Card card);
    default boolean supportsRefund() { return false; }   // added without breaking implementers
}
```

Adding a `default` method is **binary-compatible** (JLS §13.5.6) — existing implementers keep compiling and running. Adding an `abstract` method is **binary-incompatible** for implementers (they no longer satisfy the interface; at runtime, `AbstractMethodError`). Conflict resolution: if a class inherits two unrelated `default`s of the same signature, it must override (§8.4.8.4, §9.4.1.3). This is the language-level tool for evolving a published SPI.

---

## 6. Dispatch — JVMS §6.5 — what polymorphism compiles to

The choice between polymorphism and a conditional bottoms out in these bytecodes:

```
invokevirtual    // §6.5 — virtual dispatch on a class type (polymorphism via class)
invokeinterface  // §6.5 — virtual dispatch via interface type (Strategy / SPI calls)
invokespecial    // §6.5 — super.m(), <init>, private — STATIC dispatch (Template super-calls)
invokestatic     // §6.5 — no receiver
invokedynamic    // §6.5 — bootstrapped; backs lambdas (cheap Strategy) and switch patterns
```

Relevant facts:

- **Method resolution (JVMS §5.4.5)** picks the override based on the receiver's *runtime* class — the substrate of polymorphic extension.
- **`invokespecial`** dispatches statically, which is why `super.step()` in a Template Method always calls the parent's exact body.
- **Lambdas** (Strategy values) compile to `invokedynamic` + a bootstrap (JLS §15.27, JVMS §5.4.3.6) — no class-per-strategy needed.
- **`switch` over sealed patterns** compiles (recent Java) to `invokedynamic` against `SwitchBootstraps.typeSwitch` — exhaustiveness checked by the compiler, dispatch by an indy call site.

The JIT inlines monomorphic/bimorphic sites (HotSpot CHA + inline caches), so polymorphism's dispatch cost is near-zero except at megamorphic sites. See [`optimize.md`](optimize.md) and [../../02-more-about-oop/11-static-vs-dynamic-binding/](../../02-more-about-oop/11-static-vs-dynamic-binding/).

---

## 7. `ServiceLoader` and modules (JLS §7.7, `java.util.ServiceLoader`) — the SPI mechanism

The plugin/SPI seam is specified by `java.util.ServiceLoader` and the module system. JLS §7.7.1–§7.7.4 define `provides … with …` and `uses` directives:

```java
module com.acme.imaging {
    exports com.acme.imaging.spi;            // publish the SPI type
    uses    com.acme.imaging.spi.ImageCodec; // I will ServiceLoader.load() it
}
module com.acme.webp {
    requires com.acme.imaging;
    provides com.acme.imaging.spi.ImageCodec with com.acme.webp.WebpCodec;  // a provider
}
```

`ServiceLoader.load(ImageCodec.class)` discovers providers via these directives (or, on the classpath, `META-INF/services/`). This is Open/Closed at the deployment boundary: the consuming module is *closed* (compiled, shipped) yet *open* to providers it never named. A module *cannot extend* another module — modules compose, never inherit (deliberate spec choice; §7.7). See [../../05-advanced-language-features/02-jpms-modules/](../../05-advanced-language-features/02-jpms-modules/) and [../../05-advanced-language-features/03-reflection-and-annotations/](../../05-advanced-language-features/03-reflection-and-annotations/).

---

## 8. Binary compatibility (JLS §13) — the rulebook for evolving seams

JLS §13 is the precise definition of which seam changes break existing implementers/callers:

| Change to a published interface/class | Effect |
| --- | --- |
| Add a `default` method | binary-compatible (§13.5.6) |
| Add an `abstract` method | breaks implementers (`AbstractMethodError`) |
| Remove a method | breaks callers (`NoSuchMethodError`, §13.4.12) |
| Add `final` to a method | breaks overriders (§13.4.17) |
| Narrow access (`public`→`protected`) | breaks external callers/subclasses (§13.4.7) |
| Add a permitted subtype to a `sealed` type | breaks exhaustive switches (source) until handled |

`japicmp` and `revapi` mechanize §13. For any seam outsiders implement, these rules are the contract you must not violate without a major version. This is the spec backing for `professional.md` §7 (SPI governance).

---

## 9. Constructor self-use hazard (JLS §12.5)

JLS §12.5 fixes instance-initialization order: the superclass constructor runs *before* the subclass's fields are initialized. So a designed-for-inheritance base class that calls an overridable method from its constructor invokes the subclass override against an uninitialized subclass — Bloch Item 19's "never call an overridable method from a constructor". The spec doesn't forbid it (it's well-defined), which is exactly why it's a *design* rule, not a compile error. Same applies to `clone` and `readObject`. See [../../03-design-principles/06-fragile-base-class-problem/](../../03-design-principles/06-fragile-base-class-problem/) and [../../02-more-about-oop/01-object-lifecycle/](../../02-more-about-oop/01-object-lifecycle/).

---

## 10. JEP references

| JEP | Feature | Relevance to extension design |
| --- | --- | --- |
| JEP 360, 397, 409 | Sealed classes | Close a complete set; exhaustive switching |
| JEP 406, 420, 427, 441 | Pattern matching for `switch` | Operations-grow axis; exhaustiveness over sealed types |
| JEP 395 | Records | Implicitly `final` variants of a sealed family |
| JEP 261 | Module system | `provides`/`uses` — SPI at the deployment boundary |
| JEP 126/dynamic | Lambdas / `invokedynamic` | Strategy as a value, no class-per-strategy |

---

## 11. Reading list

1. **Bertrand Meyer** — *Object-Oriented Software Construction*, 2nd ed., §3.4. The original Open/Closed Principle.
2. **Robert C. Martin** — *Agile Software Development*, ch. 9 (OCP); *Clean Architecture*, ch. 8. The polymorphic OCP you actually apply.
3. **Joshua Bloch** — *Effective Java*, 3rd ed., **Items 19–23**. Design-for-inheritance-or-prohibit, interfaces over abstract classes, interface evolution, tagged-class → hierarchy. The core of this topic.
4. **GoF** — *Design Patterns*, Strategy (p. 315), Template Method (p. 325), Abstract Factory (p. 87), and "favor composition" (p. 20).
5. **Craig Larman** — *Applying UML and Patterns*, 3rd ed. — Protected Variations (the GRASP generalization of OCP).
6. **Martin Fowler** — *Refactoring*, 2nd ed., ch. 10 — Replace Conditional with Polymorphism, Replace Type Code with Subclasses.
7. **Philip Wadler** — "The Expression Problem" (1998); **Torgersen**, "The Expression Problem Revisited" (2004). Why polymorphism vs switch is an axis choice.
8. **JLS §8.1.1.1–§8.1.1.2** — `abstract`, `final`, `sealed`. The openness switches.
9. **JLS §9.4.3, §13.5.6** — `default` methods and their binary compatibility.
10. **JLS §13** — Binary compatibility. The seam-evolution rulebook.
11. **JLS §12.5** — Initialization order. The constructor self-use hazard.
12. **JVMS §6.5, §5.4.5** — Dispatch instructions and method resolution.
13. **`java.util.ServiceLoader` Javadoc + JLS §7.7** — The SPI mechanism and module directives.

The spec doesn't *teach* Open/Closed — it gives you the levers (`abstract`/`final`/`sealed`/`default`/`provides`) to make "open here, closed there" a *structural, compiler-checked* property. When a reviewer asks "why is this `final`?", cite §8.1.1.2 + Bloch 19. "Why a `default` and not abstract?" — §13.5.6 + Bloch 21. "Why sealed?" — §8.1.1.2 + the exhaustiveness rule §14.11. The literature supplies the principle; the spec supplies the enforcement.
