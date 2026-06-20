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

Each topic ships the full five-tier set — **junior / middle / senior / professional / interview**.

| # | Topic | Focus |
|---|---|---|
| [01](01-line-branch-path-coverage/) | Line, Branch & Path Coverage | What each metric counts and ignores — statement/line, branch/decision, condition, MC/DC, path; the subsumption hierarchy; why 100% line ≠ 100% branch; path explosion; how instrumentation works |
| [02](02-mutation-coverage/) | Mutation Coverage | The only honest signal of test *quality* — mutants, operators, mutation score, killed vs survived, equivalent mutants; `pitest` (Java), Stryker (JS/C#/Scala), `mutmut`/`cosmic-ray` (Python), `go-mutesting`; making it practical on diffs |
| [03](03-coverage-tooling-per-language/) | Coverage Tooling per Language | Go `-cover`/`-covermode`, JaCoCo, Coverage.py, `c8`/`nyc`/Istanbul/V8, gcov/lcov/llvm-cov, tarpaulin/grcov; report formats (lcov, cobertura, clover); HTML drill-down, IDE gutters, merging reports |
| [04](04-coverage-in-ci-and-diffs/) | Coverage in CI & Diffs | Diff/patch coverage (Codecov, Coveralls, SonarCloud), project vs patch coverage, the ratchet, PR status checks & merge blockers, combining parallel shards, flaky coverage, the politics of gates |
| [05](05-what-coverage-does-not-tell-you/) | What Coverage Does *Not* Tell You | Covered ≠ tested (no assertions/oracle), missed requirements & edge cases, async/concurrent blind spots (races, interleavings), what *not* to cover (generated/vendored/trivial), false confidence |
| [06](06-coverage-as-signal-not-target/) | Coverage as Signal, Not Target | Goodhart's law in practice, gaming the number (assertion-free tests, `pragma: no cover`, deleting hard branches), the 80%/100% debate, Google's no-global-threshold stance, coverage as diagnostic not KPI |

---

## Languages

The roadmap is tool-centric, but examples cover **Go** (`go test -cover`, `-coverprofile`, `-covermode=atomic`), **Java** (JaCoCo, Cobertura), **Python** (Coverage.py, `pytest-cov`), **Rust** (`cargo-tarpaulin`, `grcov` + LLVM source-based coverage), and **JavaScript / TypeScript** (`c8`, `nyc`, Istanbul).

---

## Status

✅ **Content-complete.** All 6 topics are written across the full five-tier set (junior / middle / senior / professional / interview): 30 topic files in total.

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
