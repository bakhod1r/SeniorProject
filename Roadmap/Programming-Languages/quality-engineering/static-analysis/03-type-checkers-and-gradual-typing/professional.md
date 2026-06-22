# Type Checkers & Gradual Typing — Professional Level

> **Roadmap:** [Static Analysis](../README.md) → Type Checkers & Gradual Typing

*At org scale, types stop being a per-repo concern and become infrastructure: generated from schemas, gated by policy, traded between teams as contracts, and governed by a deliberate stance on where they stop paying.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Types as cross-team contracts](#core-concept-1----types-as-cross-team-contracts)
5. [Core Concept 2 — Generated types: the single source of truth](#core-concept-2----generated-types-the-single-source-of-truth)
6. [Core Concept 3 — Org-wide strictness policy and the ratchet at scale](#core-concept-3----org-wide-strictness-policy-and-the-ratchet-at-scale)
7. [Core Concept 4 — `any` policy as governance](#core-concept-4----any-policy-as-governance)
8. [Core Concept 5 — Performance, monorepos, and checker infrastructure](#core-concept-5----performance-monorepos-and-checker-infrastructure)
9. [Core Concept 6 — Where types stop paying off](#core-concept-6----where-types-stop-paying-off)
10. [Core Concept 7 — Choosing and governing the checker stack](#core-concept-7----choosing-and-governing-the-checker-stack)
11. [Real-World Examples](#real-world-examples)
12. [Mental Models](#mental-models)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Type checking as organizational infrastructure — generated types from schemas, cross-team contracts, org-wide policy and ratchets, and a principled stance on where types stop paying.**

A single team can succeed with types through discipline. An organization needs *systems*, because discipline doesn't scale across dozens of repos and hundreds of engineers with different incentives. The professional questions are structural: How do two teams agree on the shape of data crossing a service boundary — and how do you stop one team's change from silently breaking another? Where do types come from when the same data shape exists in five languages? What's the org default for strictness, and who's allowed to break it? When does the org *decide* to stop typing something?

The throughline: **a type is a contract.** Inside a module it's a contract with future-you. Across a service boundary it's a contract between teams. At the org level your job is to make those contracts *generated, enforced, and governed* rather than hand-maintained and hope-based.

## Prerequisites

- You've driven a real type rollout: ratchets, coverage gates, escape-hatch budgets ([Senior](./senior.md)).
- Experience with CI/CD platform policy, monorepos or multi-repo coordination.
- Familiarity with at least one schema/IDL: protobuf, OpenAPI, GraphQL, JSON Schema, or DB schema.
- You think about quality at the level of incentives and policy, not just code.

## Glossary

| Term | Meaning |
|------|---------|
| **IDL** | Interface Definition Language (protobuf, OpenAPI, GraphQL SDL) — a language-neutral schema. |
| **Codegen** | Generating typed code (structs, interfaces, clients) from a schema. |
| **Contract** | An agreed, enforced interface shape between two parties (teams, services). |
| **Single source of truth (SSOT)** | One authoritative definition from which all representations are derived. |
| **Policy-as-code** | Encoding org rules (strictness, `any` budgets) as enforced config/CI checks. |
| **Distributed build / cache** | Sharing type-check results across machines to keep large checks fast. |
| **Project references** | TS feature splitting a codebase into incrementally-buildable units. |
| **Federation / contract testing** | Verifying that producer and consumer agree on a schema over time. |
| **Drift** | Divergence between a schema and the code that implements/consumes it. |

## Core Concept 1 — Types as cross-team contracts

Inside a process, a type checker proves callers and callees agree. Across a network boundary, the checker on each side knows nothing about the other — yet teams still depend on data shapes. The professional move is to make the *boundary* the typed contract, so a producer's change that breaks a consumer fails a check, not production.

Three patterns, by coupling:

- **Shared typed package.** A `@org/contracts` package (TS) or a published stub package (Python) holds the canonical types; producer and consumer both depend on it. A breaking change forces a version bump and surfaces in consumers' type checks.
- **Schema-derived types (preferred at scale).** The contract lives in an IDL; both sides generate types from it (next concept). The schema, not a hand-written package, is the SSOT.
- **Contract testing.** For runtime/HTTP boundaries, tools like Pact verify producer and consumer expectations against each other in CI, catching drift the static checker can't see across the wire.

The principle: **a contract that isn't checked in CI is a comment.** If team B can break team A without a red build, you don't have a contract — you have a convention.

## Core Concept 2 — Generated types: the single source of truth

The same data shape — an Order, a User — often exists in a DB schema, an API contract, a frontend, and three backend services in three languages. Hand-typing it N times guarantees drift. The fix is one schema and codegen everywhere.

**protobuf → typed code in every language:**

```proto
// order.proto — the single source of truth
message Order {
  string id = 1;
  string sku = 2;
  int32 quantity = 3;
}
```

```bash
protoc --ts_out=./gen --python_out=./gen --go_out=./gen order.proto
# every service imports generated, mutually-consistent types
```

**OpenAPI → TypeScript client and server types:**

```bash
npx openapi-typescript api.yaml -o src/api-types.ts
# components.schemas.Order is now a real TS type, derived from the spec
```

**DB schema → types:**

```bash
# Prisma generates TS types from the DB schema
npx prisma generate
# Python: sqlacodegen / SQLAlchemy 2.0 typed models from the schema
```

```bash
# GraphQL → typed operations
npx graphql-codegen   # typed hooks/resolvers from the SDL + queries
```

Rules that make codegen pay off:

1. **Generated files are read-only and committed** (or built in CI) — never hand-edited.
2. **The generator runs in CI**; a schema change that isn't regenerated fails the build (no drift).
3. **The schema is reviewed like an API**, because it is one — schema review *is* contract review.

Generated types are the highest-leverage typing an org can do: one definition eliminates an entire class of cross-service mismatch bugs, in every language at once.

## Core Concept 3 — Org-wide strictness policy and the ratchet at scale

A per-repo ratchet ([Senior](./senior.md)) doesn't compose across 50 repos with 50 opinions. You need a default and a mechanism.

- **Shared base config.** Publish `@org/tsconfig-base` and `@org/mypy-base` (or a `pyproject` snippet) encoding the org's strictness floor. Repos `extends` it; they may be *stricter*, never looser.
- **New-repo default is strict.** Greenfield starts at `strict: true` / `mypy --strict`. There is no migration debt to ratchet — only legacy repos carry exemptions.
- **Policy-as-code in CI.** A reusable CI workflow enforces: type-coverage floor met, escape-hatch budget not exceeded, base config not weakened. Encoding the policy as a shared workflow makes it the path of least resistance, which is the only way org policy actually holds.

```yaml
# Reusable org workflow consumed by every repo
jobs:
  types:
    steps:
      - run: tsc --noEmit                              # must pass
      - run: npx type-coverage --at-least ${{ inputs.floor }} --strict
      - run: ./scripts/check-any-budget.sh             # budget not exceeded
```

The governance insight: **strictness is a paved road, not a mandate.** Make the strict path the default scaffold, the shared config, the green CI — and most teams take it without being told. Mandates without tooling produce `// @ts-nocheck` at the top of files.

## Core Concept 4 — `any` policy as governance

`any` is where type guarantees go to die at scale, so the org needs an explicit, enforced stance — not a vibe.

A workable org policy:

- **`any` is allowed but accountable.** Every explicit `any`/`Any` is lintable, budgeted, and ideally carries a reason/ticket comment.
- **`unknown` is the default for genuinely-unknown data;** linters flag `any` and steer toward `unknown`.
- **Boundaries must be validated, not asserted.** Org convention bans bare `as`/`cast` on external data; require a validator (Zod/Pydantic) — this is the enforceable version of the [Senior](./senior.md) erasure lesson.
- **Budgets ratchet down.** The org-wide count of escape hatches is tracked and trends to zero in actively-developed code.

```jsonc
// @org/eslint-config — shipped to every TS repo
{
  "rules": {
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-unsafe-assignment": "error",
    "@typescript-eslint/no-unsafe-member-access": "error"
  }
}
```

```toml
# @org mypy base
[tool.mypy]
disallow_any_explicit = true
warn_unused_ignores = true
```

This connects directly to design discipline: a function that accepts `any` has no contract, the way a class that violates the interface-segregation idea (see the **solid-principles** skill) offers no real abstraction. The `any` policy is, at bottom, a policy about whether your interfaces mean anything.

## Core Concept 5 — Performance, monorepos, and checker infrastructure

At scale, type checking is a build-system problem. A 2-million-line TS check that takes 8 minutes blocks every PR; engineers will disable it. Keeping the check *fast* is what keeps it *enforced*.

**TypeScript:**

```jsonc
// Project references split the graph into cacheable units
{ "references": [{ "path": "./packages/core" }, { "path": "./packages/api" }] }
```

```bash
tsc --build --incremental        # only rechecks changed projects
# Monorepo tools (Nx, Turborepo, Bazel) cache & distribute tsc across CI
```

**Python:** mypy's incremental cache and the daemon (`dmypy`) avoid full rechecks; pyright is fast enough that many large monorepos run it directly in CI. For very large Python codebases, Meta's **Pyre** offers incremental, watch-mode checking designed for monorepo scale.

Infrastructure decisions that matter:

- **Affected-only checks** in CI (check what the PR touches plus dependents), with a full nightly check as a backstop.
- **Remote build cache** so a clean check on CI reuses results — type checking parallelizes and caches well.
- **Editor parity.** The editor checker (Pylance/pyright, tsserver) must agree with the CI checker, or engineers learn to distrust red squiggles. Standardize versions.

If the check is slow, it gets bypassed; performance work *is* enforcement work.

## Core Concept 6 — Where types stop paying off

A senior reasons about the cost/value curve for a codebase. A professional sets *org policy* on it, so hundreds of engineers don't each relitigate "should I fully type this?"

Document an org stance such as:

- **Always type:** public API boundaries, service contracts, money/PII-bearing fields, data-layer models, anything generated from a schema.
- **Type pragmatically:** internal business logic (lean on inference), shared libraries (their consumers benefit most).
- **Don't over-type:** one-off scripts, test fixtures, throwaway prototypes, deeply dynamic metaprogramming (plugin loaders, generic event buses) where the type gymnastics obscure intent more than they help.
- **Hard stop signals:** the annotation is harder to read than the code; you're encoding business logic in conditional types; a deliberate, documented `any` + runtime check is clearer than a baroque generic.

The org-level payoff of writing this down: it kills two failure modes at once — the team that types *nothing* ("dynamic is faster") and the team that types *everything* (weeks lost to type puzzles that prevent no real bugs). The professional position is that **100% type coverage is not a goal; appropriate coverage is** — and "appropriate" is a written, defensible org decision, not per-engineer taste.

## Core Concept 7 — Choosing and governing the checker stack

Org-level checker choices, made once and standardized:

- **Python:** pyright for editor + fast CI, mypy as the authoritative gate (or pyright-only for speed in large monorepos; Pyre for Meta-scale incrementality). Pick one *authoritative* checker so "passes types" has a single meaning org-wide.
- **TypeScript:** `tsc` is the source of truth; `@typescript-eslint` adds the lint-style type rules (`no-floating-promises`, `no-unsafe-*`) that `tsc` doesn't cover. Standardize TS versions — type-checking behavior changes between minor releases.
- **Ruby:** Sorbet (gradual, with runtime `sig` checks) where Ruby services need contracts. **JS-without-TS:** Flow still exists but TS has won the ecosystem; new work standardizes on TS.
- **Stub governance:** maintain an internal registry/policy for `@types/*` and `types-*` packages and internal `.pyi`/`.d.ts` for shared internal libraries, so every consumer gets the same types for the same dependency.

Standardization is the point: a heterogeneous checker stack means "the build is green" means different things in different repos, and contracts can't be trusted across them.

## Real-World Examples

**1. Schema-first org (Google/protobuf-style).** Service contracts live in `.proto` files in a central repo, reviewed like APIs; every service generates types from them in every language. A field's type can't drift between Go, Python, and TS services because all three derive from one definition — eliminating an entire class of cross-service bugs structurally.

**2. Stripe / Sorbet.** Stripe drove Ruby type adoption org-wide with Sorbet, a shared strictness ladder (`# typed: false/true/strict`) per file, and tooling that made stricter levels the paved road — a per-file ratchet at company scale with runtime `sig` enforcement closing the erasure gap.

**3. The frontend/backend contract via OpenAPI.** A backend publishes an OpenAPI spec; the frontend generates its client types from it in CI. A backend field rename without a spec update fails the backend's own validation; with the update, the frontend's type check goes red on the next pull — the breaking change is caught at build time on both sides instead of as a production 500.

## Mental Models

- **A type is a contract; codegen makes it a *single* contract.** One schema, N derived representations, zero drift — the highest-leverage typing an org can do.
- **Policy is a paved road, not a wall.** Default-strict scaffolds and shared configs get adopted; mandates without tooling get `@ts-nocheck`-ed around.
- **Enforcement requires speed.** A slow check is a disabled check. Performance work and governance are the same work.
- **Appropriate coverage, not maximal.** The org decides, in writing, where types stop paying — preventing both the type-nothing and type-everything failure modes.

## Common Mistakes

- **Hand-maintaining the same type in N languages/repos.** Guarantees drift; generate from one schema instead.
- **Unenforced contracts.** A shared types package no one's CI checks against, or a schema that can change without regen, is a comment with extra steps.
- **Mandating strictness without paving the road.** No shared config, no default scaffold → teams route around the mandate.
- **Letting the check get slow.** Multi-minute checks get bypassed; invest in incremental/affected/cached checking.
- **No org `any` policy.** `any` density grows unbounded; "we have types" becomes meaningless across repos.
- **Pursuing 100% coverage as policy.** Burns senior time on type puzzles that prevent no real bugs; set appropriate, written targets.
- **Heterogeneous authoritative checkers.** "Green build" means different things per repo; contracts can't be trusted across the org.

## Test Yourself

1. What makes a cross-team type a *contract* rather than a convention?
2. Why are schema-generated types the highest-leverage typing at org scale? Name two codegen pipelines.
3. How do you prevent schema/code drift in CI?
4. Describe an org strictness policy that scales across 50 repos without a mandate.
5. Why is type-checker performance an enforcement issue?
6. State a defensible org policy on where types stop paying off.
7. Why standardize on a single authoritative checker per language?

## Cheat Sheet

```bash
# Generate types from the single source of truth
protoc --ts_out --py_out --go_out order.proto    # protobuf, all langs
npx openapi-typescript api.yaml -o api-types.ts   # OpenAPI → TS
npx prisma generate                               # DB schema → TS
npx graphql-codegen                               # GraphQL SDL → types
```

```jsonc
// Org paved road
// @org/tsconfig-base : strict floor, repos extend (may tighten, not loosen)
// @org/eslint-config : no-explicit-any, no-unsafe-* = error
// reusable CI: tsc --noEmit + type-coverage --at-least + any-budget
```

| Concern | Org default |
|---------|-------------|
| Cross-team shape | Generate from one schema (SSOT) |
| Strictness | Shared base config; new repos strict |
| `any` | Allowed, accountable, budgeted to zero |
| Speed | Incremental + affected + remote cache |
| Coverage target | Appropriate (written), not 100% |
| Authoritative checker | One per language, version-pinned |

## Summary

At organizational scale, type checking is infrastructure. A type is a contract: inside a module with future-you, across a boundary between teams. The highest-leverage move is to make those contracts *generated* from a single schema (protobuf/OpenAPI/GraphQL/DB), so the same shape can't drift across languages and repos — drift is caught structurally in CI. Strictness, `any` budgets, and coverage become org policy delivered as a paved road (shared configs, default-strict scaffolds, reusable CI workflows), because mandates without tooling get bypassed. Keep the check fast — slow checks get disabled — and standardize one authoritative checker per language so "green build" means one thing. Finally, write down where types stop paying: appropriate coverage is the goal, not maximal, and that judgment is an org decision, not per-engineer taste.

## Further Reading

- protobuf, OpenAPI, GraphQL Code Generator, Prisma — codegen documentation.
- Pact / consumer-driven contract testing documentation.
- Stripe engineering — "Sorbet: A type checker for Ruby" and the gradual `# typed:` ladder.
- Meta — Pyre (incremental Python type checking at scale).
- *TypeScript* — project references and `--build` mode; `@typescript-eslint` type-aware rules.

## Related Topics

- [Senior: legacy rollout, soundness, coverage gates](./senior.md) — the per-team mechanics scaled here.
- [Static Analysis in CI](../09-static-analysis-in-ci/) — reusable workflows, affected-only checks, caching.
- [Linters and Style Checkers](../01-linters-and-style-checkers/) — `@typescript-eslint` type-aware rules.
- The **solid-principles** skill — interfaces and contracts that `any` policy ultimately protects.
- For IDLs, structural typing, and gradual-typing theory, see `../../../language-internals/type-systems/`.
