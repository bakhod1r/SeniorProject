# Working With Legacy Code

> *"Legacy code is code without tests. Code without tests is bad code. It doesn't matter how well written it is; it doesn't matter how pretty or object-oriented or well-encapsulated it is. With tests, we can change the behavior of our code quickly and verifiably. Without them, we really don't know if our code is getting better or worse."* — Michael Feathers

Most of the code you will ever work on already exists, was written by someone else (or by a younger version of you), and has no tests around the part you need to change. This roadmap is about doing that work **safely** — making changes you can trust, in code you don't fully understand, without a green test suite to catch you.

It draws on two canonical books:

- **Michael Feathers — *Working Effectively with Legacy Code*** — the change algorithm, seams, characterization tests, and the dependency-breaking catalog.
- **Kent Beck — *Tidy First?*** — small, safe structural improvements and the economics of deciding when to make them.

---

## The core problem

To change code safely, you want **tests**. But legacy code is usually untestable *as written* — it reaches out to databases, clocks, networks, and globals that you can't stand up in a unit test. To get tests in, you must first **break those dependencies** — and editing code with no tests is exactly the risky act you were trying to avoid.

```
        want to change code
                │
                ▼
     need tests to change safely
                │
                ▼
   code isn't testable as written
                │
                ▼
   must edit code to add tests ──┐
                │                │
                ▼                │
        editing is risky ────────┘   ← the legacy dilemma
```

Every technique in this section exists to break that loop: introduce a **seam** with the *smallest, safest* edit, write a **characterization test** through it, and only then make the real change with a net underneath you.

> **Key idea:** You don't earn the right to refactor legacy code by reading it. You earn it by getting a test around it.

---

## Topics

| # | Topic | What it gives you |
|---|-------|-------------------|
| [01](01-what-is-legacy-code/) | **What Is Legacy Code** | Feathers' actionable definition (code without tests), why legacy ≠ old, and how it differs from technical debt. |
| [02](02-the-legacy-change-algorithm/) | **The Legacy Change Algorithm** | The five-step procedure — identify change points → find test points → break dependencies → write tests → change & refactor — plus Sprout and Wrap as first moves. |
| [03](03-seams-and-enabling-points/) | **Seams and Enabling Points** | The unit of testability: where you can alter behavior *without editing there*. Object, link, and preprocessor seams. |
| [04](04-characterization-tests/) | **Characterization Tests** | Pinning down what the code *actually does* (not what it should), the assert-wrong-and-listen loop, and golden-master / approval testing. |
| [05](05-dependency-breaking-techniques/) | **Dependency-Breaking Techniques** | Feathers' catalog — Extract Interface, Parameterize Constructor, Subclass and Override Method, Adapt Parameter, and the rest — each a small, safe move toward a seam. |
| [06](06-tidy-first-when-and-how/) | **Tidy First — When and How** | Kent Beck's tidyings (guard clauses, explaining variables, cohesion order…) and the discipline of separating structure changes from behavior changes. |
| [07](07-the-economics-of-tidying/) | **The Economics of Tidying** | Why cleanup is an *investment* governed by time value, optionality, and coupling — and when the right answer is "never tidy." |

---

## How the topics fit together

```
01 What Is Legacy Code        ── the problem & vocabulary
        │
02 The Legacy Change Algorithm ── the overall procedure
        │
        ├── 03 Seams           ── WHERE you can intervene
        ├── 05 Dependency-Breaking ── HOW to create a seam safely
        └── 04 Characterization Tests ── the safety net you build through the seam
        │
06 Tidy First                 ── the small structural moves, once it's safe
        │
07 Economics of Tidying       ── WHETHER the cleanup is worth it
```

Read **01** and **02** first — they frame everything. Topics **03–05** are the mechanical core (how to make untestable code testable). Topics **06–07** shift from *can we change it safely* to *should we clean it, and how much*.

---

## Related roadmaps

- [Refactoring](../refactoring/) — once you have tests, this is the catalog of behavior-preserving transformations you apply. Tidyings (topic 06) are "refactoring in the small."
- [Design Principles](../design-principles/) — coupling, cohesion, and dependency inversion are the forces that make code legacy in the first place, and the destination you refactor toward.
- [Design Patterns](../design-patterns/) — Adapter, Factory, and Strategy show up constantly as dependency-breaking targets.
- [Craftsmanship Disciplines](../craftsmanship-disciplines/) — TDD and testing practice; characterization tests are their after-the-fact cousin.
