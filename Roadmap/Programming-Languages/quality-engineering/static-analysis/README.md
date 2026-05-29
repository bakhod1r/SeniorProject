# Static Analysis & Linting Roadmap

> *"The cheapest bug to fix is the one your editor underlines before you ever hit save."*

This roadmap is about **tools that read your source code without running it** — linters, formatters, type-checkers, and security scanners that find bugs, enforce style, and surface dead code at the speed of a keystroke rather than a test suite.

> Looking for *type-system theory* (variance, inference, ADTs, effect systems)? See [Type Systems](../../language-internals/type-systems/README.md).
>
> Looking for *security review* (threat modelling, auth, crypto, hardening)? See the [Security](../../../Security/) section.
>
> Looking for *clean code style rules at the source level* (naming, function shape, comments)? See [Clean Code](../../code-craft/clean-code/README.md).

---

## Why a Dedicated Roadmap

Every team adopts a linter, then argues for years about which rules to enable. Understanding static analysis *as a category* — what each class of tool can and cannot prove, where false positives come from, and how to evolve a rule set without breaking the team — turns linting from a religious war into a load-bearing part of the development loop.

| Roadmap | Question it answers |
|---|---|
| [Testing](../testing/README.md) | Does my code work when I run it? |
| [Code Review](../code-review/README.md) | Does another human understand and trust my code? |
| **Static Analysis** (this) | What can I prove about my code without running it? |

---

## Sections

| # | Topic | Focus |
|---|---|---|
| [01](01-why-static-analysis/) | Why Static Analysis | Catch bugs before runtime, cheaper than tests, the IDE feedback loop, why "compile-time" beats "test-time" |
| [02](02-linters-formatters-type-checkers/) | Linters vs Formatters vs Type-Checkers | Three different jobs often conflated — what each one can prove and what it can't |
| [03](03-style-vs-substance/) | Style vs Substance | When a lint rule prevents real bugs (e.g. `==` vs `===`) versus when it only enforces taste |
| [04](04-type-checking/) | Type Checking as Static Analysis | `mypy`, `pyright`, TypeScript, Flow — gradual typing, soundness vs ergonomics, `any` as escape hatch |
| [05](05-sast/) | SAST (Security Static Analysis) | Semgrep, CodeQL, Bandit, gosec — taint analysis, data-flow tracking, modelling sources and sinks |
| [06](06-custom-rules/) | Custom Rules | Writing project-specific lint rules — Semgrep patterns, ESLint plugins, `golangci-lint` custom linters |
| [07](07-autofix-vs-report/) | Auto-fix vs Report-only | Formatters always rewrite; lints sometimes; the safety tradeoff between convenience and a surprising diff |
| [08](08-precommit-and-ci/) | Pre-commit / CI Integration | The `pre-commit` framework, GitHub Actions, husky — where in the loop each tool belongs (editor, commit, CI) |
| [09](09-dead-code/) | Dead Code & Unused Imports | `unused`, `deadcode`, `ts-prune` — the real value, and the cost of false positives on reflective code |
| [10](10-suppression-discipline/) | Suppression Discipline | `// nolint`, `# type: ignore`, `@SuppressWarnings` — when a suppression is honest, when it's a code smell |
| [11](11-polyglot-analysis/) | Polyglot Static Analysis | SonarQube, Semgrep cross-language — running consistent checks across a repo with five languages |
| [12](12-anti-patterns/) | Anti-patterns | "Lint everything to zero," bikeshedding on style, ignoring warnings until the buffer fills, treating the linter as a moral authority |

---

## Languages

The roadmap is tool-centric, but examples cover **Go** (`golangci-lint`, `staticcheck`, `gofmt`), **Java** (Checkstyle, SpotBugs, ErrorProne, PMD), **Python** (Pylint, Ruff, `mypy`, Bandit, Black), **Rust** (Clippy, `rustfmt`), and **JS/TS** (ESLint, Prettier, TypeScript, Biome). Different ecosystems make different choices about where to draw the line between "compiler" and "linter," and seeing several side-by-side is the fastest way to understand the design space.

---

## Status

⏳ **Structure defined; content pending.**

---

## References

- *Software Engineering at Google* — Winters, Manshreck, Wright (the linting and static-analysis chapter on Tricorder and the philosophy of "fix it, don't just report it")
- *The Practice of Programming* — Brian Kernighan & Rob Pike (the original case for spending tooling effort on the developer's inner loop)
- *The Art of Readable Code* — Boswell & Foucher (where style rules earn their keep and where they don't)
- *Semgrep* and *CodeQL* documentation — the two reference points for modern pattern-based and data-flow-based static analysis
- *Coders at Work* — Peter Seibel (multiple interviewees on the role of warnings, tools, and discipline)

---

## Project Context

Part of the [Senior Project](../../../../index.md) — a personal effort to consolidate the essential knowledge of software engineering in one place.
