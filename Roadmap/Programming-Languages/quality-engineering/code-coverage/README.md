# Code Coverage Roadmap

> *"When a measure becomes a target, it ceases to be a good measure."* — Goodhart's law

This roadmap is about **measuring which parts of your code your tests actually exercise** — lines, branches, mutations — and, more importantly, knowing what those numbers do and do not tell you. Coverage is a **signal**, not a target: a useful diagnostic for finding the code that nobody tests, and a terrible KPI for declaring your test suite "done."

> Looking for *mutation testing as its own technique*? See [Mutation Testing](../testing/07-mutation-testing/).
>
> Looking for *test discipline and the broader testing taxonomy*? See [Testing](../testing/).
>
> Looking for *the TDD process where coverage is a side effect of writing tests first*? Pair this roadmap with the `test-driven-development` skill.

---

## Why a Dedicated Roadmap

Every team eventually wires a coverage tool into CI, picks a threshold ("80%? 90%?"), and then spends years arguing about what that number means. The honest answer is *almost nothing on its own* — coverage tells you what your tests **did not touch**, never that the code they touched actually works. Treating coverage as a separate discipline forces the distinction between *measurement* (line / branch / mutation), *enforcement* (diff coverage in CI), and *judgment* (which gaps matter).

| Roadmap | Question it answers |
|---|---|
| [Testing](../testing/README.md) | Do my tests assert the right things? |
| [Static Analysis](../static-analysis/README.md) | What can a tool prove about my code without running it? |
| **Code Coverage** (this) | Which lines, branches, and behaviours did my tests actually exercise — and which ones did they miss? |

---

## Sections

| # | Topic | Focus |
|---|---|---|
| [01](01-what-coverage-measures/) | What Coverage Measures | Line, statement, branch, path, function coverage — what each one counts and what each one ignores |
| [02](02-mutation-coverage/) | Mutation Coverage | The only honest signal of test *quality*; `pitest` (Java), Stryker (JS/C#/Scala), `mutmut` / `cosmic-ray` (Python) |
| [03](03-coverage-as-target-antipattern/) | The Coverage-as-Target Anti-pattern | Goodhart's law applied to tests; gaming the number with assertion-free tests and `# pragma: no cover` |
| [04](04-diff-coverage/) | Diff Coverage | Coverage of changed lines only — what most modern CIs actually enforce, and why it's saner than a global threshold |
| [05](05-branch-coverage-in-depth/) | Branch Coverage in Depth | Short-circuit evaluation, exception paths, default branches, the cases line coverage silently hides |
| [06](06-coverage-tools/) | Coverage Tools | JaCoCo (Java), Coverage.py (Python), Go's built-in `-cover`, `llvm-cov` / `grcov` / `tarpaulin` (Rust), `c8` / `nyc` / Istanbul (JS) |
| [07](07-ci-integration/) | CI Integration | Codecov, Coveralls, SonarCloud — PR comments, status checks, merge blockers, and the politics of coverage gates |
| [08](08-what-not-to-cover/) | What NOT to Cover | Generated code, vendored third-party, trivial accessors, `main` glue; intentional exclusion vs sloppy ignoring |
| [09](09-coverage-reports/) | Coverage Reports | HTML drill-down reports, IDE gutter highlights, finding the *one* untested branch in a 50k-line module |
| [10](10-path-coverage-explosion/) | Path Coverage & Combinatorial Explosion | Why true 100% path coverage is mathematically impossible for non-trivial code, and what people mean when they claim it |
| [11](11-async-and-concurrent-coverage/) | Coverage of Async / Concurrent Code | Goroutines, async/await, threads — what coverage tools record, what they miss (race conditions, interleavings, dropped futures) |
| [12](12-antipatterns/) | Anti-patterns | "100% required to merge" gates, coverage-driven test design, `assertTrue(true)`, deleting hard-to-cover branches, hiding behind exclusion lists |

---

## Languages

The roadmap is tool-centric, but examples cover **Go** (`go test -cover`, `-coverprofile`, `-covermode=atomic`), **Java** (JaCoCo, Cobertura), **Python** (Coverage.py, `pytest-cov`), **Rust** (`cargo-tarpaulin`, `grcov` + LLVM source-based coverage), and **JavaScript / TypeScript** (`c8`, `nyc`, Istanbul).

---

## Status

⏳ **Structure defined; content pending.**

---

## References

- *Software Engineering at Google* — Winters, Manshreck, Wright (the coverage chapter, especially on why Google does not enforce a global coverage threshold)
- *TestCoverage* — Martin Fowler (martinfowler.com) — the canonical short essay on coverage as diagnostic, not target
- *Goodhart's Law* — Charles Goodhart (1975); see also Marilyn Strathern's reformulation as it applies to metrics-as-targets
- *pitest* documentation — the reference implementation of mutation testing for the JVM
- *Stryker Mutator* documentation — mutation testing for JavaScript, TypeScript, C#, and Scala
- *An Industrial Evaluation of Mutation Testing* — Petrović & Ivanković (Google, 2018) — the paper that argued mutation results, surfaced as code-review hints, beat coverage percentages as a quality signal

---

## Project Context

Part of the [Senior Project](../../../../index.md) — a personal effort to consolidate the essential knowledge of software engineering in one place.
