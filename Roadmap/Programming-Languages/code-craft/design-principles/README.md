# Design Principles Roadmap

> *"Principles are the distilled experience of the people who got burned before you. You can relearn them the hard way, or you can read the list."*

This roadmap catalogs the **code-level design principles** that good engineers reach for instinctively — KISS, YAGNI, DRY, low coupling, high cohesion, and the rest. Each is a small, sharp rule of thumb. None is absolute; they sometimes conflict, and part of the skill is knowing which one wins in a given trade-off.

> Looking for *architecture-scale* principles (component cohesion/coupling, the dependency rule)? See [Clean Architecture](../../../Architecture/clean-architecture/).
>
> Looking for named, reusable *structures* (Factory, Observer, Strategy)? Those are patterns, not principles — see [Design Patterns](../design-patterns/README.md).

---

## Principle vs Pattern vs Practice

These three words get used interchangeably and shouldn't be:

| | What it is | Example | Lives in |
|---|---|---|---|
| **Principle** | A rule of thumb that guides decisions | "Keep coupling low" | **this roadmap** |
| **Pattern** | A named, reusable solution structure | Factory Method | [Design Patterns](../design-patterns/README.md) |
| **Practice** | A repeated activity that builds quality | TDD, refactoring | [Craftsmanship Disciplines](../craftsmanship-disciplines/README.md) |

A principle tells you *what to aim for*; a pattern is *one concrete way to get there*; a practice is *the habit that keeps you there*.

---

## Sections

Principles are grouped by the **scope of the decision** they govern — from a single line of code outward to the relationships between whole modules.

### [01 — Generic](01-generic/)
Broad rules that apply to almost any line of code.

| # | Principle | One-liner |
|---|---|---|
| [01](01-generic/01-kiss/) | KISS | The simplest thing that works is usually the right thing. |
| [02](01-generic/02-yagni/) | YAGNI | Don't build it until you actually need it. |
| [03](01-generic/03-separation-of-concerns/) | Separation of Concerns | Each section should address one concern, independently. |
| [04](01-generic/04-code-for-the-maintainer/) | Code For The Maintainer | Write for the person who debugs this at 3 a.m. |
| [05](01-generic/05-avoid-premature-optimization/) | Avoid Premature Optimization | Make it work, make it right, then — only if measured — make it fast. |
| [06](01-generic/06-optimize-for-deletion/) | Optimize for Deletion | Code that's easy to delete is easy to change. |
| [07](01-generic/07-dry/) | DRY | Every piece of knowledge has one authoritative representation. |

### [02 — Coupling & Cohesion](02-coupling-and-cohesion/)
How parts of a system should — and shouldn't — depend on each other.

| # | Principle | One-liner |
|---|---|---|
| [01](02-coupling-and-cohesion/01-minimise-coupling/) | Minimise Coupling | Reduce how much a change in A forces a change in B. |
| [02](02-coupling-and-cohesion/02-maximise-cohesion/) | Maximise Cohesion | Group things that change together; separate things that don't. |
| [03](02-coupling-and-cohesion/03-connascence/) | Connascence | A precise vocabulary for *kinds* and *strengths* of coupling. |
| [04](02-coupling-and-cohesion/04-law-of-demeter/) | Law of Demeter | Don't talk to strangers — only your immediate collaborators. |
| [05](02-coupling-and-cohesion/05-composition-over-inheritance/) | Composition Over Inheritance | Prefer "has-a" over "is-a" for flexibility. |
| [06](02-coupling-and-cohesion/06-orthogonality/) | Orthogonality | Unrelated things should stay unrelated in the system. |
| [07](02-coupling-and-cohesion/07-robustness-principle/) | Robustness Principle | Be strict in what you send, liberal in what you accept. |
| [08](02-coupling-and-cohesion/08-inversion-of-control/) | Inversion of Control | "Don't call us, we'll call you" — let the framework drive. |

### [03 — Module & Class](03-module-and-class/)
Principles that shape the boundary of a single module or class.

| # | Principle | One-liner |
|---|---|---|
| [01](03-module-and-class/01-encapsulate-what-changes/) | Encapsulate What Changes | Find the hotspot of change and hide it behind an interface. |
| [02](03-module-and-class/02-command-query-separation/) | Command Query Separation | A method either does something or answers something — never both. |

### [04 — SOLID](04-solid/)
The five object-oriented design principles that travel together.

| # | Principle | One-liner |
|---|---|---|
| [01](04-solid/01-srp-single-responsibility/) | Single Responsibility | A class should have one, and only one, reason to change. |
| [02](04-solid/02-ocp-open-closed/) | Open/Closed | Open for extension, closed for modification. |
| [03](04-solid/03-lsp-liskov-substitution/) | Liskov Substitution | Subtypes must be substitutable for their base types. |
| [04](04-solid/04-isp-interface-segregation/) | Interface Segregation | Many small client-specific interfaces beat one fat one. |
| [05](04-solid/05-dip-dependency-inversion/) | Dependency Inversion | Depend on abstractions, not concretions. |
| [06](04-solid/06-solid-as-a-whole-and-smells/) | SOLID as a Whole | How the five interlock, and the smells that signal a violation. |

> **Already covered elsewhere** (cross-linked, not duplicated): Boy Scout Rule → [Clean Code → 21](../clean-code/21-boy-scout-rule/); Hide Implementation Details → [Clean Code → 22](../clean-code/22-abstraction-and-information-hiding/); FIRST & Arrange-Act-Assert → [Craftsmanship Disciplines → Test Design](../craftsmanship-disciplines/02-test-design-and-fixtures/).

---

## How to Use Principles

1. **They are heuristics, not laws.** "Higher-ranked principles usually beat lower-ranked ones" — but *usually*, not always.
2. **They conflict.** DRY pushes you to consolidate; Separation of Concerns and "Optimize for Deletion" sometimes push you to keep things apart. Naming the conflict is half the design conversation.
3. **The Rule of Three.** Don't abstract on the first duplication, or even the second. Wait until the pattern is real before paying the cost of DRY.

---

## Status

Skeleton — topic folders are scaffolded; content is written per topic following the Code Craft file convention. All content in **English**.
