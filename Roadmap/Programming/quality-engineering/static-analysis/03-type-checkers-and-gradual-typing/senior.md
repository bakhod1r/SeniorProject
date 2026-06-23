# Type Checkers & Gradual Typing — Senior Level

> **Roadmap:** [Static Analysis](../README.md) → Type Checkers & Gradual Typing

*Rolling out types across a large untyped codebase is a migration program, not a config flag — driven by a strictness ratchet, a type-coverage gate, and a clear-eyed view of soundness trade-offs and where the last 10% stops paying.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Soundness vs ergonomics: what your checker actually guarantees](#core-concept-1----soundness-vs-ergonomics-what-your-checker-actually-guarantees)
5. [Core Concept 2 — The gradual guarantee and where it leaks](#core-concept-2----the-gradual-guarantee-and-where-it-leaks)
6. [Core Concept 3 — The strictness ratchet on legacy code](#core-concept-3----the-strictness-ratchet-on-legacy-code)
7. [Core Concept 4 — Measuring and gating type coverage](#core-concept-4----measuring-and-gating-type-coverage)
8. [Core Concept 5 — Boundaries-first rollout in practice](#core-concept-5----boundaries-first-rollout-in-practice)
9. [Core Concept 6 — Budgeting escape hatches](#core-concept-6----budgeting-escape-hatches)
10. [Core Concept 7 — pyright vs mypy, and stubs](#core-concept-7----pyright-vs-mypy-and-stubs)
11. [Core Concept 8 — The cost/value curve of the last 10%](#core-concept-8----the-costvalue-curve-of-the-last-10)
12. [Real-World Examples](#real-world-examples)
13. [Mental Models](#mental-models)
14. [Common Mistakes](#common-mistakes)
15. [Test Yourself](#test-yourself)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)
18. [Further Reading](#further-reading)
19. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Driving a type-system rollout across a large legacy codebase: ratcheting strictness, gating coverage, reasoning about soundness, and knowing where types stop paying off.**

At this level the questions change from "how do I annotate this?" to "how do I get 600k lines of untyped code under a checker without halting feature work, and how strong do I make the guarantee?" That's a migration program with three pillars: a **strictness ratchet** (flags that only ever tighten), a **type-coverage gate** (a measurable, monotonically improving number in CI), and a **boundaries-first ordering** (type the data edges before the internals).

Underneath those mechanics sits a design decision most teams make implicitly and then regret: how *sound* do you want the checker to be? Practical checkers deliberately trade soundness for ergonomics — TypeScript's bivariant arrays and `any`, mypy's gradual gaps. Knowing exactly where your checker lies to you is what separates "we have types" from "we know what our types prove."

## Prerequisites

- Solid command of gradual typing, `any`/`unknown`, narrowing, and strict flags ([Middle](./middle.md)).
- You've owned or co-owned a real codebase's CI and quality gates.
- Comfortable with generics, variance intuition, and reading checker config.
- You've felt the pain of an untyped legacy module at least once.

## Glossary

| Term | Meaning |
|------|---------|
| **Soundness** | A checker is sound if it never accepts a program that can have the type errors it claims to prevent (no false negatives). |
| **Completeness** | A checker is complete if it never rejects a correct program (no false positives). No useful checker is both. |
| **Gradual guarantee** | Adding/removing type annotations shouldn't change a program's runtime behavior (only which errors are caught statically). |
| **Variance** | How subtyping of parts relates to subtyping of wholes (covariant, contravariant, bivariant). |
| **Strictness ratchet** | A process where checker strictness only ever increases; regressions are blocked in CI. |
| **Type coverage** | % of expressions with a known (non-`any`) type. |
| **Stub / `.pyi`** | A declaration-only file giving types for code that has none (libraries, generated code). |
| **DefinitelyTyped / `@types/*`** | Community type packages for untyped npm libraries. |
| **Bivariance** | Accepting both covariant and contravariant assignment — unsound but ergonomic. |

## Core Concept 1 — Soundness vs ergonomics: what your checker actually guarantees

A **sound** type checker never lets through a program that can exhibit the errors it claims to catch — zero false negatives. Academic type systems aim for soundness. Production checkers for dynamic languages do *not*; they trade soundness for usability, and they do it on purpose.

TypeScript's own design goals state non-goals explicitly: it applies a "sound *or* easy to learn" balance and accepts unsoundness where soundness would be too costly. Concrete unsound spots:

```ts
// 1. any — defeats checking entirely (intentional escape hatch)
const x: any = "hello";
const n: number = x;          // accepted; crashes at runtime use

// 2. Array/method bivariance — unsound but convenient
const dogs: Dog[] = [];
const animals: Animal[] = dogs;  // covariant array assignment
animals.push(new Cat());         // accepted — now dogs contains a Cat

// 3. Type assertions — unchecked
const u = {} as User;            // accepted; u.name is undefined at runtime
```

mypy is closer to sound under `strict`, but gradual typing means any `Any` in the graph is a soundness hole, and certain features (e.g. mutable invariant containers passed covariantly via casts) leak.

The senior takeaway is not "TS/mypy are broken." It's: **know precisely which guarantees your config provides.** When you tell another team "this function takes a `User`," you should know whether the checker *proves* that or merely *suggests* it. The honest answer depends on `any` density, casts, and which strict flags are on.

## Core Concept 2 — The gradual guarantee and where it leaks

The **gradual guarantee** is the formal property gradual type systems aim for: changing a program's annotations (adding or removing them) should only change which errors are caught statically — never the runtime behavior of a previously-working program. It's what makes incremental adoption safe in theory.

In practice it leaks at the typed/untyped boundary, because most production checkers (TS, mypy) are *erasure-based*: types are stripped before runtime and **nothing is checked at the boundary**. A value flowing from untyped code into a typed function carries a type the runtime never verifies.

```python
def process(u: User) -> str:    # promises a User
    return u.name

raw = json.loads(payload)       # raw: Any — untyped region
process(raw)                    # checker is satisfied; raw might not be a User
```

Sound gradual systems insert runtime casts at boundaries (the academic "blame" model); TS and mypy do not — they erase. The senior consequence: **your real boundary safety comes from runtime validation (Zod, Pydantic, schema parsing), not from the type annotation.** Treat the annotation as the static contract and a validator as its runtime enforcement. This is the single most important correction to the naive "the types will protect us" mindset.

## Core Concept 3 — The strictness ratchet on legacy code

You cannot flip `strict: true` on a large legacy codebase — you'll get thousands of errors and block all work. The ratchet makes strictness monotonic: it can only go up, and CI prevents backsliding.

**TypeScript — per-directory / per-file ratchet.** Use project references or multiple tsconfigs so new code is strict while legacy isn't yet:

```jsonc
// tsconfig.json (loose baseline for legacy)
{ "compilerOptions": { "strict": false, "noImplicitAny": false } }

// tsconfig.strict.json (extends baseline, applied to migrated dirs)
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "strict": true },
  "include": ["src/billing/**", "src/auth/**"]   // grows over time
}
```

For file-level granularity, `// @ts-strict-ignore` (via the `ts-strict-plugin`) or comment-based opt-in lets you flip strict per file as you migrate.

**mypy — per-module overrides.** mypy's config supports module-scoped strictness, so the default is strict and legacy modules are explicitly exempted (and the exemption list only shrinks):

```toml
[tool.mypy]
strict = true                        # default for everything

[[tool.mypy.overrides]]
module = ["legacy.reports.*", "legacy.imports.*"]
disallow_untyped_defs = false        # temporary exemption — shrink this list
ignore_errors = false                # never silence; just relax requirements
```

The discipline: the exemption list is a **debt register**. Every PR may remove modules from it; none may add. A simple CI check that the list never grows turns "we'll get to it" into a measurable ratchet.

## Core Concept 4 — Measuring and gating type coverage

"Do we have types?" is unanswerable without a number. **Type coverage** = fraction of expressions whose type is known (not `any`). Make it a CI gate that can only rise.

**TypeScript** — `type-coverage`:

```bash
$ npx type-coverage --detail --strict
3812 / 4001  95.27%
src/legacy/report.ts:42:8 any
src/legacy/report.ts:51:3 any
```

```bash
# CI gate: fail if coverage drops below the current floor
npx type-coverage --at-least 95 --strict
```

**Python** — mypy's own report, plus `mypy --strict` error count as a proxy:

```bash
$ mypy --html-report ./report src/
# report/index.html shows "imprecise" (Any-typed) lines per module
```

The pattern is identical to test-coverage ratchets: pick the current number as the floor, fail CI on regression, and raise the floor as modules migrate. A coverage *number* converts an abstract migration into a tracked, celebrated metric — and exposes the difference between annotated code and *checked* code (a file full of `any`-typed annotations scores low).

## Core Concept 5 — Boundaries-first rollout in practice

The highest-leverage types live where untrusted or cross-module data enters: HTTP handlers, queue consumers, DB rows, config, third-party SDK responses. Type those first; the types then propagate inward through normal data flow, and inference does much of the interior for free.

Concrete ordering for a service:

1. **External inputs** — request/response bodies, webhook payloads. Pair each with a runtime validator so the static type is actually backed.
2. **Data layer** — DB row shapes, repository return types. Generate these from the schema where possible (see [Professional](./professional.md)).
3. **Public module exports** — the functions other teams import. These are your inter-team contracts; type them precisely.
4. **Core domain logic** — usually inferred once its inputs are typed.
5. **Leaf utilities and legacy interiors** — last, lowest value.

```python
# Boundary: typed AND validated
class CreateOrder(BaseModel):     # Pydantic = type + runtime check
    sku: str
    qty: int

@app.post("/orders")
def create(body: CreateOrder) -> OrderId:
    return place_order(body.sku, body.qty)   # interior is now type-safe for free
```

This ordering also maximizes early ROI: a bug in boundary parsing affects every request, so typing the boundary prevents the highest-frequency crashes first.

## Core Concept 6 — Budgeting escape hatches

`any`, casts, and suppressions are sometimes the right call (a genuinely untyped third-party lib, a perf-critical hot path, an in-progress migration). The senior move is to make them **visible, scoped, and budgeted** rather than banned or ignored.

```bash
# Track the escape-hatch budget as a CI metric
$ rg -c "as any|: any|@ts-ignore" src/ | awk -F: '{s+=$2} END{print s}'
57
```

Practical policy:

- **Lint them.** ESLint `@typescript-eslint/no-explicit-any` and `no-unsafe-*` rules; mypy `--warn-unused-ignores` and `--disallow-any-explicit`.
- **Self-expire them.** `@ts-expect-error` over `@ts-ignore`; `# type: ignore[code]` with the specific code.
- **Cap and ratchet.** A budget number in CI that can only decrease, exactly like coverage.
- **Require a reason.** Convention: every escape hatch carries a comment with a ticket link.

The goal isn't zero escape hatches — it's *zero unaccountable* ones.

## Core Concept 7 — pyright vs mypy, and stubs

For Python you'll choose between (or run both) the two main checkers:

- **mypy** — the reference checker, configurable strictness, plugin ecosystem (Django, SQLAlchemy), generally treated as the canonical CI gate.
- **pyright** — much faster, powers VS Code's Pylance, stronger inference and narrowing, supports `# pyright:` per-file controls and "basic" vs "strict" modes. Common setup: pyright for editor speed, mypy as the authoritative CI check (or pyright in CI for monorepos that value speed).

**Stubs** fill the gaps for code that ships no types:

```python
# requests has no inline types historically → install types-requests (a stub pkg)
# pip install types-requests
```

```ini
# A local stub for an internal C extension: stubs/fastthing.pyi
def compute(x: int, y: int) -> float: ...
```

For TypeScript the analogue is **DefinitelyTyped** — `npm i -D @types/lodash` gives you community-maintained `.d.ts` declarations for untyped npm packages. When a dependency has no stubs, you write a minimal local `.d.ts`/`.pyi` covering only the surface you use — far cheaper than typing the whole library.

## Core Concept 8 — The cost/value curve of the last 10%

Type value is steeply front-loaded. The first 60–70% of coverage — boundaries and public APIs — eliminates the overwhelming majority of type bugs. The last 10–20% (exhaustively typing decorators, deep generics, dynamic metaprogramming, legacy interiors that rarely change) costs disproportionately and prevents few real bugs.

Signs you've hit diminishing returns:

- You're writing elaborate conditional/mapped types to satisfy the checker rather than to model the domain.
- Annotations are longer and harder to read than the code they describe.
- The remaining `any`s are in stable, rarely-touched, well-tested code.
- Fully typing a dynamic feature (a generic event bus, a plugin loader) requires type gymnastics that obscure intent.

The senior judgment: **a deliberate, documented `any` with a runtime check beats a baroque type that no one understands.** Set the coverage target where the curve flattens for *your* codebase (often 90–95%, not 100%), and spend the saved effort on validators and tests at the boundaries instead. Knowing where types stop paying is as important as knowing how to write them.

## Real-World Examples

**1. Airbnb / Stripe-style TS migration.** Large JS codebases migrated by renaming files to `.ts` with a loose baseline, adding a strict tsconfig for migrated directories, gating `type-coverage --at-least` in CI, and ratcheting the floor up sprint by sprint. The number — not exhortation — drove the migration.

**2. Dropbox typing Python.** Dropbox annotated millions of lines of Python with mypy, boundaries-first, contributing stubs upstream and treating `Any` density as the headline metric. The migration succeeded because it was incremental and measured, not a big-bang rewrite.

**3. The unsoundness incident.** A team relied on `as User` casts on API responses without runtime validation. A backend field rename passed `tsc` cleanly (the cast suppressed it) and shipped a `undefined.id` crash. The fix wasn't more types — it was Zod validation at the boundary, making the static contract enforceable at runtime.

## Mental Models

- **The checker is a contract you partially trust.** Its guarantee is exactly as strong as your weakest `any` and your strict flags. Map the holes deliberately.
- **Erasure means the type is a promise, not a guard.** Runtime safety at boundaries comes from validators; the annotation is the spec they enforce.
- **Migration is a ratchet, not a flag.** Strictness, coverage, and escape-hatch budgets are monotonic CI numbers that only improve.
- **Value is front-loaded.** Boundaries and public APIs are 80% of the benefit. Chase the curve to where it flattens, then stop.

## Common Mistakes

- **Treating typed boundaries as validated boundaries.** Erasure-based checkers don't verify at runtime; pair boundary types with Zod/Pydantic.
- **Big-bang `strict: true`.** Thousands of errors, blocked work, abandoned migration. Ratchet per-module/dir instead.
- **No coverage number.** Without `type-coverage`/`Any`-density, "we have types" is unfalsifiable and migrations stall.
- **Banning `any` outright.** Drives people to casts (which are *worse*, being unchecked assertions). Budget and account for `any` instead.
- **Chasing 100% coverage.** The last 10% costs the most and prevents the least; over-typing produces unreadable type gymnastics.
- **Ignoring variance/bivariance unsoundness.** Knowing arrays are unsoundly covariant in TS prevents a class of "but the checker said it was fine" surprises.

## Test Yourself

1. Define soundness and completeness; why can't a useful checker have both?
2. Give two concrete examples of TypeScript's intentional unsoundness.
3. What is the gradual guarantee, and why does it leak in erasure-based checkers?
4. Describe a per-module strictness ratchet in mypy and how CI prevents backsliding.
5. How do you gate type coverage in CI for TS and for Python?
6. Where on the cost/value curve should a team stop, and what are the signals?
7. Why is banning `any` often worse than budgeting it?

## Cheat Sheet

```bash
# TypeScript ratchet & gates
npx type-coverage --at-least 95 --strict     # CI gate, monotonic floor
rg -c "as any|: any|@ts-ignore" src          # escape-hatch budget
# tsconfig.strict.json: extends loose baseline, include = migrated dirs
```

```toml
# mypy per-module ratchet
[tool.mypy]
strict = true
[[tool.mypy.overrides]]
module = ["legacy.*"]          # shrinking debt register
disallow_untyped_defs = false
```

| Decision | Senior default |
|----------|----------------|
| Boundary safety | Type + runtime validator (Zod/Pydantic) |
| Strictness | Ratchet per-module; never big-bang |
| `any` policy | Budget + lint + self-expiring suppressions |
| Coverage target | ~90–95% (where curve flattens), not 100% |
| Python checkers | pyright in editor, mypy authoritative in CI |

## Summary

A type rollout on legacy code is a migration program with three monotonic pillars — a strictness ratchet, a type-coverage gate, and an escape-hatch budget — ordered boundaries-first so the highest-frequency bugs go first. Underpinning the mechanics is a soundness judgment: TS and mypy deliberately trade soundness for ergonomics, and because they erase types, your real boundary safety comes from runtime validators, not annotations. Type value is front-loaded; chase the curve to where it flattens (usually 90–95%) and stop, spending the saved effort on validation and tests. Know exactly which guarantees your config provides — that's what makes a type a contract you can offer other teams.

## Further Reading

- *TypeScript* — "TypeScript Design Goals" (the explicit soundness non-goals) and "Type Compatibility".
- Siek & Taha — "Gradual Typing" papers; the gradual guarantee and blame.
- `type-coverage` and `ts-strict-plugin` documentation.
- Dropbox engineering — "Our journey to type checking 4 million lines of Python".
- mypy — "The mypy configuration file" (per-module overrides, strict).

## Related Topics

- [Middle: any/unknown and strict flags](./middle.md) — the building blocks ratcheted here.
- [Professional: org strategy and generated types](./professional.md) — scaling this across many teams.
- [Static Analysis in CI](../09-static-analysis-in-ci/) — wiring coverage and strictness gates.
- [Linters and Style Checkers](../01-linters-and-style-checkers/) — `no-explicit-any` and friends.
- For variance, soundness, and gradual-typing theory, see `../../../language-internals/type-systems/`.
