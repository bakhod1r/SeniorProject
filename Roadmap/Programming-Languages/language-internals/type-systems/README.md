# Type Systems Roadmap

> *"A type system is the most cost-effective unit test you'll ever write."* — adapted from Benjamin C. Pierce

This roadmap is about **what types actually are**, what guarantees they buy you, and how the major mainstream type systems (Go's, Java's, Python's, Rust's, TypeScript's) compare. It's the bridge between everyday API design and the deeper theory that shaped the languages you already use.

> Looking for the *Clean Code chapter* on practical type expressiveness ("make illegal states unrepresentable")? See [Clean Code → Generics & Types](../../code-craft/clean-code/13-generics-and-types/README.md).
>
> Looking for *Go-specific* generics? See [Golang → Generics](../../languages/golang/04-generics/01-why-generics/junior.md).

---

## Why a Dedicated Roadmap

Every senior engineer eventually hits the wall of "I know how to use generics in language X, but I don't know what variance, kinding, or higher-rank types mean." This roadmap fills that gap **without leaving the languages you use day-to-day** — theory is grounded in Go / Java / Rust / TypeScript code.

| Roadmap | Question it answers |
|---|---|
| [Clean Code](../../code-craft/clean-code/README.md) | How do I write code that doesn't smell? |
| [Design Patterns](../../code-craft/design-patterns/README.md) | What structures recur in OO code? |
| **Type Systems** (this) | What can the compiler prove about my program before it runs? |

---

## Sections

| # | Topic | Focus |
|---|---|---|
| [01](01-what-is-a-type/) | What Is a Type? | Sets of values, tags vs proofs, the Curry–Howard correspondence (briefly) |
| [02](02-static-vs-dynamic/) | Static vs Dynamic | What each style buys you, gradual typing (mypy, TypeScript), hybrid runtimes |
| [03](03-nominal-vs-structural/) | Nominal vs Structural | Java/Rust (nominal) vs Go/TypeScript (structural), pros and cons of each |
| [04](04-sum-product-unit-types/) | Sum, Product, and Unit Types | Records, tuples, tagged unions, why most languages got this half-wrong |
| [05](05-generics-and-parametric-polymorphism/) | Generics & Parametric Polymorphism | Type parameters, monomorphization vs erasure, the cost models |
| [06](06-variance/) | Variance | Covariance, contravariance, invariance — why `List<Dog>` isn't a `List<Animal>` |
| [07](07-bounded-polymorphism/) | Bounded Polymorphism | Constraints (`T: Ord`), Go's `comparable`, Rust traits, Java bounded wildcards |
| [08](08-subtyping-and-liskov/) | Subtyping & Liskov | When inheritance is type-theoretically sound, and when it isn't |
| [09](09-higher-kinded-types/) | Higher-Kinded Types | What Scala/Haskell have and Go/Java don't, and why it matters |
| [10](10-dependent-and-refinement-types/) | Dependent & Refinement Types | A taste of TypeScript template literal types, Idris, F* — types that depend on values |
| [11](11-type-inference/) | Type Inference | Hindley–Milner, Go's limited inference, when inference helps and when it hurts |
| [12](12-practical-patterns/) | Practical Patterns | "Parse, don't validate," newtype/wrapper types, phantom types, the typestate pattern |

---

## Languages

Cross-language comparison is the whole point. Examples in **Go**, **Java**, **Python** (mypy / pyright), **Rust**, and **TypeScript** — the five mainstream type systems that cover most of the design space.

---

## Status

⏳ **Structure defined; 12 sub-folders scaffolded. Per-topic files (junior / middle / senior / professional / interview) pending.**

---

## References

- *Types and Programming Languages* — Benjamin C. Pierce (the canonical text, "TAPL")
- *Programming Language Pragmatics* — Michael L. Scott
- Alexis King — *Parse, Don't Validate* (2019)
- *Type-Driven Development with Idris* — Edwin Brady

---

## Project Context

Part of the [Senior Project](../../../../index.md) — a personal effort to consolidate the essential knowledge of software engineering in one place.
