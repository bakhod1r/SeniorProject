# Object-Oriented Programming

> Mastering OOP at senior level is not knowing the four pillars — it is knowing *where each one earns its keep and where it costs you*: when inheritance is a liability, when a method call is a virtual dispatch through a vtable, when an "object" should have been a value, and when the cleanest design is barely object-oriented at all.

> *"The big idea is messaging. The key in making great and growable systems is much more to design how its modules communicate rather than what their internal properties and behaviors should be."* — Alan Kay

---

## Why This Roadmap

OOP is the substrate the rest of code-craft sits on. The [SOLID principles](03-design-principles/01-solid-principles/junior.md) live in **this** roadmap, not in clean-code, because they are statements *about objects* — responsibilities, abstractions, substitutability. The sibling roadmaps build on top:

| Roadmap | Question it answers |
|---|---|
| **Object-Oriented Programming** (this) | What *is* an object, and how do classes, dispatch, and contracts actually work? |
| [Clean Code](../code-craft/clean-code/README.md) | How do I write code — objects included — that doesn't smell in the first place? |
| [Design Patterns](../code-craft/design-patterns/README.md) | What proven object structures should I reach for? |
| [Refactoring](../code-craft/refactoring/README.md) | How do I fix object designs that already smell? |

This roadmap deliberately goes one layer deeper than the others. It does not stop at "prefer composition over inheritance" — it explains the [fragile base class problem](03-design-principles/06-fragile-base-class-problem/junior.md) that makes the advice true, then shows the [JVM method dispatch](06-method-dispatch-and-internals/01-jvm-method-dispatch/junior.md) and [object memory layout](06-method-dispatch-and-internals/04-object-memory-layout/junior.md) that make polymorphism cost what it costs.

---

## Chapters

Examples are primarily Java (the canonical OOP language), with cross-language notes where another language changes the answer.

| # | Chapter | What it covers | Entry point |
|---|---|---|---|
| 01 | Basics of OOP | Classes & objects, attributes/methods, access specifiers, `static`/`final`, nested classes, packages | [Classes & Objects](01-basics-of-oop/01-classes-and-objects/junior.md) |
| 02 | More About OOP | Object lifecycle, inheritance, abstraction, encapsulation, interfaces, enums, records, overloading vs overriding, binding, value vs reference | [Inheritance](02-more-about-oop/02-inheritance/junior.md) |
| 03 | Design Principles | SOLID, composition over inheritance, Law of Demeter, cohesion & coupling, DRY/KISS/YAGNI, the fragile base class problem | [SOLID Principles](03-design-principles/01-solid-principles/junior.md) |
| 04 | Object Contracts & Semantics | `equals`/`hashCode`/`toString`, `Comparable` vs `Comparator`, clone & copy, identity vs equality, immutability & defensive copying | [equals/hashCode/toString](04-object-contracts-and-semantics/01-equals-hashcode-tostring-contracts/junior.md) |
| 05 | Advanced Language Features | Sealed classes & pattern matching, JPMS modules, reflection & annotations, functional interfaces & lambdas, default methods & the diamond problem, class loading | [Sealed Classes & Pattern Matching](05-advanced-language-features/01-sealed-classes-and-pattern-matching/junior.md) |
| 06 | Method Dispatch & Internals | JVM dispatch, vtables & itables, covariant returns & bridge methods, object memory layout, escape analysis | [JVM Method Dispatch](06-method-dispatch-and-internals/01-jvm-method-dispatch/junior.md) |
| 07 | Antipatterns & Code Smells | God class, anemic domain model, feature envy, refused bequest, inappropriate intimacy, shotgun surgery, yo-yo, data clumps, primitive obsession | [God Class](07-antipatterns-and-code-smells/01-god-class/junior.md) |
| 08 | Tactical DDD | Value objects, entities, aggregates, the repository concept, domain services | [Value Objects](08-tactical-ddd/01-value-objects/junior.md) |
| 09 | OO Design & Modeling | GRASP responsibility assignment, OO metrics (CK suite), thread-safe object design, designing for extension — *planned* | *in progress* |

> **Coverage is honest, not aspirational.** Chapters 01–08 are written. Chapter 09 and two later topics — `05/07-traits-mixins-and-multiple-inheritance` and `06/06-multiple-and-double-dispatch` — are currently empty skeletons and intentionally left unlinked until their content lands.

---

## How to Use This Roadmap

Each topic folder is a suite of level-graded files (not a single page). Read top-to-bottom for one topic, or read one level across many topics to match your current depth.

| File | Focus | Audience |
|---|---|---|
| `junior.md` | What the feature is and a clean example | Just learned the language |
| `middle.md` | Why it exists, trade-offs, when the rule bends | 1–3 yr experience |
| `senior.md` | Team-scale design decisions and failure modes | 3–7 yr experience |
| `professional.md` | Runtime cost, JVM/language internals, the exceptions to every rule | 7+ yr / specialist |
| `specification.md` | The precise contract — language-spec guarantees, edge cases, formal rules |
| `interview.md` | Question-and-answer drill for the topic |
| `tasks.md` | Hands-on exercises with solutions |
| `find-bug.md` | Broken snippets to diagnose |
| `optimize.md` | Correct-but-slow code to reconcile with performance |

**Recommended order:** `junior.md` → `middle.md` → `senior.md` → `professional.md` → `specification.md` → practice files → `interview.md` for review.

---

*Curated by Bakhodir Yashin Mansur as part of the Senior Stack roadmap.*
