# Code Craft

The craft side of programming-language work — how to **shape, polish, and evolve** code regardless of the language it's written in. These chapters are language-agnostic; the actual `golang/`, `java/`, `python/` etc. sections live under [languages/](../languages/).

---

## Sections

- **[Clean Code](clean-code/)** — meaningful names, small functions, comments, formatting, error handling, boundaries, unit tests, classes, emergence, concurrency, and beyond. Robert C. Martin's _Clean Code_ rebuilt with modern angles (async/functional, generics, immutability, pure functions, defensive vs offensive, code reviews, logging, cognitive load).
- **[Design Patterns](design-patterns/)** — the GoF 23 (creational · structural · behavioral) with per-level walkthroughs (junior / middle / senior / professional / optimize / find-bug / interview / tasks).
- **[Refactoring](refactoring/)** — code smells (bloaters, OO abusers, change preventers, dispensables, couplers) and the corresponding refactoring techniques (composing methods, moving features, organizing data, simplifying conditionals, simplifying method calls, dealing with generalization).
- **[Anti-Patterns](anti-patterns/)** — what _not_ to do, organized by phase: development, design, concurrency, async.
- **[Functional Programming](functional-programming/)** — pure functions, immutability, higher-order functions, composition; cross-language take.

---

## How the levels work

Most leaf pages follow a stepped-difficulty layout:

| Level             | Audience                        | Depth                                         |
| ----------------- | ------------------------------- | --------------------------------------------- |
| **junior**        | New engineer, ~0–2 yrs          | "What is this and why does it exist?"         |
| **middle**        | Comfortable, ~2–5 yrs           | Trade-offs, when to apply, when to skip.      |
| **senior**        | Lead, ~5–10 yrs                 | System-level consequences, edge cases.        |
| **professional**  | Staff / principal               | Cross-team patterns, evolution, deprecation.  |
| **optimize**      | Performance angle               | Hot paths, memory, allocation, profiling.     |
| **find-bug**      | Debugger's seat                 | Realistic broken code + the fix.              |
| **interview**     | Hiring-bar prep                 | The conversation, the follow-ups.             |
| **tasks**         | Hands-on practice               | Exercises with grading criteria.              |

Not every section has every file — early/incomplete sections will fill in as the Roadmap grows.

---

## Related

- **[Languages](../languages/)** — concrete language tracks (Go, Java, Python, Rust, SQL) that apply these crafts.
- **[Quality Engineering](../quality-engineering/)** — testing, performance, build systems — the other half of the engineering discipline.
- **[Diagnostics](../diagnostics/)** — debugging, logging, error handling at the system level.
