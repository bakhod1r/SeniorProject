# Static Analysis & Linting Roadmap

> *"The cheapest bug to fix is the one your editor underlines before you ever hit save."*

This roadmap is about **tools that read your source code without running it** — linters, formatters, type-checkers, security scanners, and data-flow engines that find bugs, enforce style, surface dead code, and trace tainted input at the speed of a keystroke rather than a test run. It covers what each class of tool can and cannot *prove*, where false positives come from, how to write your own rules, and how to wire all of it into the development loop without drowning the team in noise.

> Looking for *type-system theory* (variance, inference, ADTs, effect systems)? See [Type Systems](../../language-internals/type-systems/README.md).
>
> Looking for *security review* (threat modelling, auth, crypto, hardening)? See the [Security](../../../Security/) section.
>
> Looking for *clean code style rules at the source level* (naming, function shape, comments)? See [Clean Code](../../code-craft/clean-code/README.md).
>
> Looking for *runtime* analysis (sanitizers, fuzzing, Valgrind)? See [Dynamic Analysis & Sanitizers](../dynamic-analysis-and-sanitizers/).

---

## Why a Dedicated Roadmap

Every team adopts a linter, then argues for years about which rules to enable. Understanding static analysis *as a category* — what each class of tool can and cannot prove, where false positives come from, and how to evolve a rule set without breaking the team — turns linting from a religious war into a load-bearing part of the development loop.

| Roadmap | Question it answers |
|---|---|
| [Testing](../testing/) | Does my code work when I run it? |
| [Code Review](../code-review/) | Does another human understand and trust my code? |
| **Static Analysis** (this) | What can I prove about my code without running it? |

---

## Sections

| # | Topic | Focus |
|---|---|---|
| [01](01-linters-and-style-checkers/) | Linters & Style Checkers | What a linter proves vs what it enforces; rule classes, severity, the false-positive budget; ESLint, golangci-lint, Pylint/Ruff, Clippy, Checkstyle |
| [02](02-formatters/) | Formatters | Deterministic rewriting vs lint; gofmt/Prettier/Black/rustfmt; format-on-save, the "no config" philosophy, ending style debates |
| [03](03-type-checkers-and-gradual-typing/) | Type Checkers & Gradual Typing | mypy/pyright, TypeScript, Flow; soundness vs ergonomics, `any` as escape hatch, strictness ratchets, type checking as the cheapest analysis |
| [04](04-sast-security-scanners/) | SAST & Security Scanners | Semgrep, CodeQL, Bandit, gosec; sources/sinks, rule packs, signal-to-noise, where SAST fits in the SDLC |
| [05](05-dead-code-and-complexity/) | Dead Code & Complexity | Unused code/imports, cyclomatic & cognitive complexity, reachability; the reflective-code false-positive problem |
| [06](06-dependency-and-license-scanning/) | Dependency & License Scanning | SCA, CVE matching (OSV/Trivy/Dependabot/Snyk), license compliance, transitive risk; SBOM-adjacent analysis |
| [07](07-custom-lint-rules-and-ast/) | Custom Lint Rules & AST | ASTs and matchers; writing Semgrep rules, ESLint plugins, golangci-lint custom linters; codemods and autofix |
| [08](08-taint-and-dataflow-analysis/) | Taint & Data-Flow Analysis | How interprocedural data-flow works; sources, sinks, sanitizers, propagation; CodeQL queries; the theory under SAST |
| [09](09-static-analysis-in-ci/) | Static Analysis in CI | Editor → pre-commit → CI placement; baselines for legacy code, blocking vs advisory gates, SARIF, suppression discipline |

---

## Tiers

Every topic is written across five tiers, each a standalone page:

| Tier | File | For the reader who… |
|---|---|---|
| **Junior** | `junior.md` | is meeting the tool for the first time and needs the *what*, *why*, and the commands to run it |
| **Middle** | `middle.md` | can run the tools and needs the working policy, the trade-offs, and the false-positive failure modes |
| **Senior** | `senior.md` | owns the rule set and must reason about it under constraints, at scale, and across teams |
| **Professional** | `professional.md` | sets org-wide standards, builds the platform, and weighs signal, cost, and adoption |
| **Interview** | `interview.md` | is preparing to be questioned on it — a question bank with model answers and what each probes |

---

## Languages

The roadmap is tool-centric, but examples cover **Go** (`golangci-lint`, `staticcheck`, `gofmt`), **Java** (Checkstyle, SpotBugs, Error Prone, PMD), **Python** (Pylint, Ruff, `mypy`, Bandit, Black), **Rust** (Clippy, `rustfmt`), and **JS/TS** (ESLint, Prettier, TypeScript, Biome). Different ecosystems make different choices about where to draw the line between "compiler" and "linter," and seeing several side-by-side is the fastest way to understand the design space.

---

## References

- *Software Engineering at Google* — Winters, Manshreck, Wright (the static-analysis chapter on Tricorder and the philosophy of "fix it, don't just report it")
- *The Practice of Programming* — Brian Kernighan & Rob Pike (the original case for spending tooling effort on the developer's inner loop)
- *Semgrep* and *CodeQL* documentation — the two reference points for modern pattern-based and data-flow-based static analysis
- *Compilers: Principles, Techniques, and Tools* — Aho, Lam, Sethi, Ullman (the data-flow analysis foundations under taint tracking)
- *Coders at Work* — Peter Seibel (multiple interviewees on the role of warnings, tools, and discipline)

---

## Project Context

Part of the [Senior Project](../../../../index.md) — a personal effort to consolidate the essential knowledge of software engineering in one place.
