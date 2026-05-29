# Quality Engineering

The disciplines that turn _code that compiles_ into _code that survives production_. Language-agnostic, applies across the [languages/](../languages/) tracks.

---

## Sections

### The three pillars

- **[Testing](testing/)** — taxonomy (unit / integration / contract / E2E / property / fuzz / mutation / load / snapshot), test doubles, coverage, flakiness, fixtures, TDD/BDD.
- **[Performance](performance/)** — measurement, profiling (CPU / memory / allocation / flame graphs), benchmarking, latency budgets, memory, concurrency overhead, regression detection.
- **[Build Systems](build-systems/)** — dependency management, reproducible builds, CI build optimisation, caching, supply-chain hardening, cross-compilation.

### Code-level quality signals

- **[Static Analysis & Linting](static-analysis/)** — linters, formatters, type-checkers, SAST; what can be proved without running the code.
- **[Code Coverage](code-coverage/)** — line / branch / mutation coverage; the diagnostic value vs the "coverage as KPI" trap.
- **[Code Review](code-review/)** — the engineering side: what to look for, in what order, how to give technically useful feedback (the soft-skills / communication side lives in [Soft-Skills](../../Soft-Skills/code-review/)).

### Release & operational quality

- **[Release Engineering](release-engineering/)** — versioning (semver / calver), changelogs, RC / GA flow, artifact signing, SBOMs, rollback, deprecation policy.
- **[Quality Gates](quality-gates/)** — the policy layer that decides "is this change allowed to merge / deploy?"; required CI checks, branch protection, merge queues, deploy gates.
- **[Documentation Quality](documentation-quality/)** — Diataxis, API docs, runbooks, ADRs, doc-as-code, doc testing.

---

## Related

- **[Code Craft](../code-craft/)** — the design side; this section is the verification and operational side.
- **[Diagnostics](../diagnostics/)** — what to do when quality fails in production.
- **[Language Internals › Concurrency](../language-internals/concurrency-async-parallel/concurrency/)** — substrate for performance work.
- **[Soft-Skills › Code Review](../../Soft-Skills/code-review/)** — the communication side of code review (this section covers the engineering side).
- **[Security](../../Security/)** — security review and hardening; complements [Static Analysis](static-analysis/)'s SAST coverage and [Quality Gates](quality-gates/)'s security-gate coverage.
- **[DevOps](../../DevOps/)** — deployment is the next step after Build & Release.
