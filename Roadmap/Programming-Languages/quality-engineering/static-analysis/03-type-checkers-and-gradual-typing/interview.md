# Type Checkers & Gradual Typing — Interview Level

> **Roadmap:** [Static Analysis](../README.md) → Type Checkers & Gradual Typing

*A question bank for interviews where type checking, gradual typing, soundness, and large-scale rollout come up — with what each question is really probing and a model answer.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Fundamentals](#fundamentals)
4. [Technique](#technique)
5. [Soundness & Escape Hatches](#soundness--escape-hatches)
6. [Scenarios](#scenarios)
7. [Rapid-Fire](#rapid-fire)
8. [Red Flags / Green Flags](#red-flags--green-flags)
9. [Cheat Sheet](#cheat-sheet)
10. [Summary](#summary)
11. [Further Reading](#further-reading)
12. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Answering type-checking and gradual-typing questions the way a senior engineer would — connecting the tool to the bug class it eliminates, the soundness it does and doesn't provide, and how you'd roll it out at scale.**

Type-checking questions appear in three guises: as a static-analysis topic ("what's the highest-value analysis you can run?"), as a language question ("explain `any` vs `unknown`"), and as a system/process question ("how would you add types to a million-line untyped codebase?"). Strong candidates connect all three: a type checker is a static analyzer that *proves* the absence of a bug class, gradual typing is how you adopt it incrementally, and soundness trade-offs plus a ratcheted rollout are how you make it real. Weak candidates recite syntax. This page drills the senior framing.

## Prerequisites

- The [Junior](./junior.md) through [Professional](./professional.md) pages on this topic.
- Hands-on with at least one checker (`tsc`, `mypy`, `pyright`) on real code.
- Basic vocabulary: inference, narrowing, `any`/`unknown`, strict flags, soundness.

## Fundamentals

**Q1. In one sentence, what is a type checker, and why is it considered the highest-leverage static analysis in a dynamic language?**
*What's really being tested: do you see types as static analysis, not just syntax?*
**A.** A type checker is a static analyzer that, without running the code, *proves* the absence of a whole class of bugs — wrong-type calls, missing fields, null dereferences — at every call site at once. It's the highest leverage in a dynamic language because those bugs are the most common runtime crashes, and the checker converts them from production incidents into instant file-and-line errors at the keyboard, on every save, for the whole codebase.

**Q2. How does a type checker differ from a linter?**
*Probing: proof vs heuristic.*
**A.** A linter flags patterns that *look* risky — heuristics, often with false positives, no guarantee. A type checker tracks the type of every value through the program and *proves* consistency: for the bug classes it covers, if it passes, those bugs are genuinely impossible, not merely unlikely. Linters say "this looks wrong"; type checkers say "this is wrong, here's the proof."

**Q3. What is gradual typing?**
*Probing: do you understand incremental adoption, not just "add types"?*
**A.** Gradual typing is a type discipline designed so typed and untyped code interoperate, letting you add static types to a dynamic language incrementally rather than all at once. Untyped code stays valid; the checker enforces types where they exist and treats untyped values as "could be anything." It's what makes TypeScript-over-JS, Python hints + mypy/pyright, Flow, and Sorbet adoptable on existing codebases. The standard strategy is *types at the boundaries first*, propagating inward.

**Q4. Explain `any` vs `unknown` in TypeScript.**
*Probing: the single most common practical type question.*
**A.** `any` disables checking — anything is assignable to it *and from it*, so it silently spreads type-blindness downstream and is effectively an opt-out. `unknown` is the safe top type: anything is assignable *to* it, but you must *narrow* (via `typeof`, `instanceof`, a check) before using it. Use `unknown` for genuinely unknown data — parsed JSON, `catch` clauses — and narrow before use. Python's `Any` is the `any` analogue; `object` is the rough `unknown` analogue.

**Q4b. Why are Python type hints "not enforced at runtime," and is that a problem?**
*Probing: do you understand the static-only nature of the tool?*
**A.** CPython ignores annotations during execution — they're stored as metadata and never checked, so passing the wrong type still "runs" until something downstream breaks. That's by design: hints are for the *static* checker (mypy/pyright) and tooling, not the interpreter. It's only a problem if you mistake the annotation for a runtime guard. At trust boundaries (incoming requests, deserialized data) you add a runtime validator like Pydantic, which uses the same type information to actually check values. The hint is the spec; the validator enforces it.

## Technique

**Q5. What is narrowing, and why does it matter?**
*Probing: do you understand flow-sensitive checking?*
**A.** Narrowing is the checker refining a value's type based on control flow. Given `value: string | number`, inside `if (typeof value === "number")` the checker knows `value` is `number`; in the `else`, it's `string`. Python does the same with `isinstance`. It matters because it makes typed code natural instead of adversarial: you handle null/impossible cases first (early return), and the checker rewards you by *knowing* the remaining type is safe — so you write less defensive code, not more.

**Q6. Walk me through the strict flags you'd enable, and which matters most.**
*Probing: do you know that lenient defaults under-deliver?*
**A.** In TS: `strict: true` bundles `noImplicitAny` (no silent `any` on parameters), `strictNullChecks`, `strictFunctionTypes`, and more; I'd add `noUncheckedIndexedAccess`. In mypy: `strict = true`, `disallow_untyped_defs`, `no_implicit_optional`. The single most valuable is `strictNullChecks` — without it, `null`/`undefined` are assignable to every type and the checker can't catch null-deref bugs *at all*, which is the largest bug class. A type checker without null checking is doing a fraction of its job.

**Q7. How do you measure whether a codebase "really" has types?**
*Probing: annotated ≠ checked.*
**A.** With type coverage — the fraction of expressions whose type is known (not `any`). In TS, `type-coverage --strict` reports a percentage and the `any` locations; in Python, mypy's HTML report shows imprecise (`Any`-typed) lines, and `Any` density is the headline metric. A codebase can be fully annotated yet have low coverage if `noImplicitAny` is off or it's riddled with `any`/casts — annotations everywhere, protection nowhere. The number is what you gate in CI.

**Q7b. A function takes `string | number`. How would you make exhaustive handling checker-enforced?**
*Probing: discriminated unions and exhaustiveness checking — a senior TS idiom.*
**A.** Narrow each case, then add an exhaustiveness check that the compiler enforces. For a discriminated union, the trick is the `never` assertion in the default branch:

```ts
type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number };
function area(s: Shape): number {
  switch (s.kind) {
    case "circle": return Math.PI * s.r ** 2;
    case "square": return s.side ** 2;
    default: const _exhaustive: never = s; return _exhaustive;
  }
}
```

If someone adds a new `kind`, the assignment to `never` fails to compile — the checker forces you to handle the new case. Python's analogue is `typing.assert_never` (3.11+). This turns "did I handle every case?" from a runtime hope into a compile-time guarantee.

## Soundness & Escape Hatches

**Q8. What does "sound" mean, and is TypeScript sound?**
*Probing: the core theory question; do you know your checker lies?*
**A.** A type checker is *sound* if it never accepts a program that can exhibit the type errors it claims to prevent — zero false negatives. TypeScript is deliberately *not* sound; its design goals state it balances correctness against usability and accepts unsoundness where soundness would hurt ergonomics. Concrete unsound spots: `any` (defeats checking), array/method bivariance (`Dog[]` assignable to `Animal[]`, then you `push` a `Cat`), and type assertions (`x as User` is unchecked). mypy under `strict` is closer to sound but any `Any` in the graph is a hole. The senior point: know precisely which guarantees your config actually provides.

**Q9. The type checker passes, but a typed API boundary still crashes at runtime with a wrong shape. How?**
*Probing: the erasure trap — the most important practical soundness lesson.*
**A.** Because TS and mypy are *erasure-based*: types are stripped before runtime, and nothing is checked at the typed/untyped boundary. `function f(u: User)` promises a `User`, but if you call it with `JSON.parse(...)` (type `any`) or assert `data as User`, the runtime never verifies the shape. The annotation is a static promise, not a runtime guard. The fix is runtime validation at boundaries — Zod (TS) or Pydantic (Python) — so the static contract is actually enforced when data crosses the wire. "The types will protect us" is wrong at boundaries unless backed by a validator.

**Q10. What's the gradual guarantee?**
*Probing: depth on gradual-typing theory.*
**A.** The gradual guarantee is the formal property that adding or removing type annotations should only change *which errors are caught statically* — never the runtime behavior of a previously-working program. It's what makes incremental adoption safe in principle. In erasure-based checkers it leaks at the typed/untyped boundary, since they don't insert the runtime casts that sound gradual systems (the academic blame model) use to preserve it.

**Q11. How should a team govern escape hatches like `any`, `@ts-ignore`, and `# type: ignore`?**
*Probing: pragmatism over purism.*
**A.** Make them visible, scoped, and budgeted — not banned. Prefer self-expiring forms: `@ts-expect-error` (errors when the underlying issue is fixed) over `@ts-ignore`, and `# type: ignore[code]` scoped to a specific error. Lint them (`no-explicit-any`, `no-unsafe-*`, mypy `--warn-unused-ignores`). Track the count as a CI budget that only decreases. Banning `any` outright backfires — it pushes people to casts, which are *worse* because they're unchecked assertions. The goal is zero *unaccountable* escape hatches, not zero escape hatches.

## Scenarios

**Q12. You inherit a 500k-line untyped JavaScript app. How do you add types without halting feature work?**
*Probing: can you run a real migration?*
**A.** As a ratcheted migration, not a big bang:
1. Set a loose baseline tsconfig so the codebase compiles, with `allowJs` so `.ts` and `.js` coexist.
2. Add a strict tsconfig that `include`s only migrated directories; new code is strict from day one.
3. Type *boundaries first* — HTTP handlers, API responses, DB rows — and back each with runtime validation (Zod), since erasure means types alone don't guard boundaries.
4. Gate `type-coverage --at-least N --strict` in CI as a monotonic floor that only rises; do the same for the `any`/escape-hatch budget.
5. Each sprint, migrate a directory into the strict include list and raise the floor.
Crucially, the *number* drives the migration — coverage and budget gates — not exhortation. And I'd stop around 90–95% where the cost/value curve flattens, not chase 100%.

**Q13. Two teams own services that exchange an `Order`. How do you keep their type definitions in sync?**
*Probing: types as cross-team contracts.*
**A.** Don't hand-maintain the shape in both places — that drifts. Make the contract a single source of truth in a schema (protobuf/OpenAPI/GraphQL) and generate types for both sides from it in CI; a schema change that isn't regenerated fails the build, so drift is caught structurally. Review the schema like an API, because it is one. For the runtime HTTP boundary, add consumer-driven contract tests (Pact) so a producer change that breaks a consumer goes red in CI rather than in production. A contract that isn't checked in CI is just a convention.

**Q14. Your CI type check takes 9 minutes and engineers are starting to skip it locally. What do you do?**
*Probing: enforcement = performance.*
**A.** Treat speed as an enforcement problem, because a slow check gets bypassed. Split the build with TS project references and run `tsc --build --incremental` so only changed projects recheck; use a monorepo tool (Nx/Turborepo/Bazel) for remote caching and affected-only checks in PR CI, with a full check nightly as a backstop. For Python, use mypy's daemon (`dmypy`) or switch the CI gate to pyright/Pyre for incrementality. Also ensure editor and CI checker versions match so local red squiggles are trustworthy. Fast checks stay enabled; that's the whole game.

**Q15. When would you tell a team to *stop* adding types?**
*Probing: judgment about diminishing returns.*
**A.** When the cost/value curve flattens. Stop when: the annotation is harder to read than the code it describes; you're writing elaborate conditional/mapped types to satisfy the checker rather than model the domain; the remaining `any`s are in stable, well-tested, rarely-touched code; or fully typing a dynamic feature (plugin loader, generic event bus) needs type gymnastics that obscure intent. A deliberate, documented `any` plus a runtime check beats a baroque generic no one understands. The org should write down where types are mandatory (boundaries, contracts, money/PII) vs optional — appropriate coverage is the goal, not 100%.

## Rapid-Fire

**Q16. `any` vs `unknown` in one line each?** *`any` = checking off, spreads downstream; `unknown` = safe, must narrow before use.*

**Q17. Most valuable single strict flag?** *`strictNullChecks` — without it, null-deref bugs are uncatchable.*

**Q18. `@ts-ignore` vs `@ts-expect-error`?** *`@ts-expect-error` self-expires (errors when the problem is fixed); prefer it.*

**Q19. Python `Optional[str]` means?** *`str | None` — you must handle `None` before using it as a `str`.*

**Q20. `TypedDict` vs `Protocol`?** *`TypedDict` types a dict's keys/values; `Protocol` is structural ("anything with these methods").*

**Q21. Why do erasure-based types fail at runtime boundaries?** *Types are stripped before runtime; nothing checks incoming shapes — back them with a validator.*

**Q22. mypy vs pyright?** *mypy = configurable reference checker, common CI gate; pyright = faster, powers Pylance, strong inference — often editor + CI.*

**Q23. What are `@types/*` / `.pyi` stubs for?** *Declaration-only files providing types for code that ships none (libraries, generated, C extensions).*

**Q24. How do you measure type adoption?** *Type coverage (% non-`any` expressions); gate it as a monotonic CI floor.*

**Q25. Highest-leverage typing at org scale?** *Generating types from one schema (protobuf/OpenAPI) so the same shape can't drift across languages/services.*

## Red Flags / Green Flags

**Red flags**
- Describes types as "for documentation" or "for autocomplete" only — misses the bug-prevention proof.
- Thinks Python hints are enforced at runtime, or that `tsc`-passing code can't crash on bad input.
- Reaches for `any`/casts to silence errors; can't explain `unknown`.
- Proposes big-bang `strict: true` on a legacy codebase.
- Believes TypeScript is sound, or can't name an unsound spot.
- "We'll just type everything to 100%."

**Green flags**
- Frames a type checker as a static analyzer that *proves* a bug class absent.
- Knows the erasure trap and pairs boundary types with runtime validation.
- Talks ratchets, coverage gates, and escape-hatch budgets for rollout.
- Names concrete TS unsoundness (bivariance, `any`, assertions) and accepts it as a deliberate ergonomics trade-off.
- Treats cross-team types as generated contracts with CI-enforced drift checks.
- Has a defensible answer for where types stop paying off.

## Cheat Sheet

| Question type | One-liner to anchor your answer |
|---------------|---------------------------------|
| What is it | Static analyzer that *proves* absence of wrong-type/missing-field/null bugs |
| Gradual typing | Typed + untyped coexist; boundaries-first, incremental |
| `any` vs `unknown` | `any` = off + spreads; `unknown` = safe, must narrow |
| Strict flags | `strictNullChecks` is the one that matters most |
| Soundness | TS unsound on purpose (bivariance, `any`, casts) for ergonomics |
| Erasure trap | Types stripped at runtime → validate boundaries (Zod/Pydantic) |
| Rollout | Ratchet strictness + coverage gate + budget `any`; boundaries first |
| Org scale | Generate types from one schema (SSOT); contracts checked in CI |
| When to stop | ~90–95% where curve flattens; type boundaries, not gymnastics |

## Summary

Strong interview answers treat a type checker as a static analyzer that *proves* the absence of a bug class, position gradual typing as incremental boundaries-first adoption, and stay honest about soundness — production checkers like TypeScript are unsound on purpose, and because they erase types, runtime boundary safety comes from validators, not annotations. For rollout, lead with a ratchet: monotonic strictness, a type-coverage gate, and a budgeted `any` policy. At org scale, types are generated contracts from a single schema, checked in CI to prevent drift. And the senior signal throughout is judgment — knowing `strictNullChecks` is the flag that matters, why `unknown` beats `any`, and where on the cost/value curve to stop.

## Further Reading

- *TypeScript Handbook* — Narrowing, `unknown`, Type Compatibility; "TypeScript Design Goals" (soundness non-goals).
- *mypy* / *pyright* documentation — strict mode, configuration, structural typing.
- Siek & Taha — Gradual Typing and the gradual guarantee.
- Zod / Pydantic — runtime validation paired with static types.
- `type-coverage` documentation.

## Related Topics

- [Junior](./junior.md) / [Middle](./middle.md) / [Senior](./senior.md) / [Professional](./professional.md) — the full depth ladder behind these answers.
- [Static Analysis in CI](../09-static-analysis-in-ci/) — gating type checks and coverage.
- [Linters and Style Checkers](../01-linters-and-style-checkers/) — type-aware lint rules.
- For soundness, variance, and gradual-typing theory, see `../../../language-internals/type-systems/`.
