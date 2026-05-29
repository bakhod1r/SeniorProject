# Functional Programming Roadmap

> *"Functional programming is to writing programs what classical mechanics is to physics: a beautifully clean abstraction that doesn't quite describe reality, but reality is much more tractable when you start from it."*

This roadmap is about **the functional paradigm** — the body of ideas (purity, immutability, higher-order functions, algebraic data types, effect tracking) that has reshaped how every modern language is designed, including the ones nobody calls "functional."

> Looking for the *Clean Code chapter* on functional style in everyday code? See [Clean Code → Async & Functional](../clean-code/12-async-and-functional/README.md) and [Clean Code → Pure Functions](../clean-code/15-pure-functions/README.md).
>
> Looking for *concurrency* patterns (which borrow heavily from FP)? See [Concurrency](../../language-internals/concurrency-async-parallel/concurrency/README.md).

---

## Why a Dedicated Roadmap

You don't need to write Haskell to benefit from FP — `map` / `filter` / `reduce`, immutable data structures, `Option` / `Result`, and pure-function discipline now live in Go, Rust, Java, Python, JavaScript, and Swift. Studying the paradigm at its source clarifies *why* these features exist and *when* to reach for them.

| Roadmap | Question it answers |
|---|---|
| [Design Patterns](../design-patterns/README.md) | What recurring structures help OO code? |
| [Clean Code](../clean-code/README.md) | How do I write code that doesn't smell? |
| **Functional Programming** (this) | What does it mean to compute by transforming values instead of mutating state? |

---

## Sections

| # | Topic | Focus |
|---|---|---|
| 01 | First-Class & Higher-Order Functions | Functions as values, closures, callbacks, partial application |
| 02 | Pure Functions & Referential Transparency | Determinism, no side effects, equational reasoning |
| 03 | Immutability | Persistent data structures, structural sharing, copy-on-write |
| 04 | Map / Filter / Reduce | The core trio, fusion, lazy vs eager |
| 05 | Composition | `f ∘ g`, pipelines, point-free style, why composition beats inheritance |
| 06 | Algebraic Data Types | Sum types (`enum`, `Either`, `Option`), product types, pattern matching |
| 07 | Currying & Partial Application | `f(a)(b)(c)` vs `f(a,b,c)`, why curry, where it pays off |
| 08 | Recursion & Tail Calls | Recursion as the FP loop, TCO, accumulator pattern |
| 09 | Monads — Plain English | Why `Promise`, `Optional`, `Result`, and `IO` are all instances of one idea |
| 10 | Effect Tracking | Pure core / impure shell, `IO` monad, the functional core / imperative shell pattern |
| 11 | Functional vs OO in Practice | When each paradigm helps, hybrid styles (Scala, Kotlin, modern Java/C#) |
| 12 | Laziness & Streams | Lazy evaluation, infinite sequences, generators, performance trade-offs |

---

## Languages

Examples in **Go** (limited FP, but `slices` / `maps` packages help), **Java** (Streams API, `Optional`, records, sealed classes), **Python** (`functools`, generators, comprehensions), and **Rust** (iterators, `Option` / `Result`, no GC but plenty of FP) — plus brief detours into **Haskell** when a concept needs the "pure" form to make sense.

---

## Status

⏳ **Structure defined; content pending.**

---

## References

- *Structure and Interpretation of Computer Programs* — Abelson & Sussman ("SICP")
- *Functional Programming in Scala* — Chiusano & Bjarnason ("the red book")
- *Why Functional Programming Matters* — John Hughes (1990)
- *Out of the Tar Pit* — Moseley & Marks (2006)

---

## Project Context

Part of the [Senior Project](../../../../index.md) — a personal effort to consolidate the essential knowledge of software engineering in one place.
