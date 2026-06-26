# Type Inference — Professional Level

> **Focus:** Inference as an engineering and design lever — annotation policy across a codebase, error-quality engineering, the `auto`/`var` debates, and diagnosing inference that produced the wrong type or a misleading error.

> **Topic:** [Type Inference](README.md)

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Pros & Cons](#pros--cons)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Best Practices](#best-practices)
12. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)

---

## Introduction

> Focus: **As the person who owns a codebase and a team, what is your *policy* on inference?** And **how do you keep its failures from costing your team hours?**

By this level you know *how* inference works and *where* it breaks. The professional question is different: it's about **judgment and policy across thousands of files and many engineers**. Inference is not a personal taste; it's a property of your codebase's readability, review velocity, error budget, and onboarding cost. Every `var`, `auto`, and unannotated function is a trade between concision and explicitness that the *whole team* lives with.

Three professional realities dominate this page. First, **annotation is documentation, error localization, and an inference anchor simultaneously** — so where you annotate is an architectural decision, not a stylistic one. Second, **inference failures cost real time**: a cryptic Hindley-Milner error whose true cause is in another module, a TypeScript type inferred too wide that silently flows through your app, a Haskell beginner blocked by the monomorphism restriction. The senior engineer's value is turning those into fast diagnoses. Third, the **`auto`/`var` readability debate is real and resolvable** — not with dogma but with a rule the team agrees on and a linter enforces.

In one sentence: **at the professional level, inference is a codebase-wide policy choice whose payoff is concision and whose hidden cost is error-localization and readability — and your job is to set the policy that maximizes the first while paying down the second.**

> 🎓 **Why this matters at the professional level:** You will write the style guide that decides when `var` is allowed, set up the linter that enforces explicit return types on public APIs, and get paged about a production bug that traces to a too-wide inferred type. The difference between a team that loves its inferred language and one that fights it is almost entirely the policy *you* set around annotations and the error-reading skill you spread.

---

## Prerequisites

- **Required:** Senior level — what breaks HM, bidirectional checking (synthesis/checking), TypeScript's inference model, the monomorphism restriction, ambiguity, error-localization theory.
- **Required:** Having owned or reviewed a non-trivial codebase in at least one partially-inferring language (TS, Rust, Scala, Kotlin, Swift, C++) or a fully-inferring one (Haskell, OCaml, F#).
- **Helpful:** Experience writing or maintaining a style guide and CI linting rules.
- **Helpful:** Having debugged a confusing type error whose root cause was nowhere near the reported line.

You do **not** need: to implement a type checker (though `Further Reading` points there).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Annotation policy** | A team's documented rules for where types must be written vs. left to inference (e.g. "explicit return types on all exported functions"). |
| **Error localization** | How close a type error is reported to its actual cause. Inference trades this away; annotations buy it back. |
| **Inference anchor** | An annotation deliberately placed to seed/constrain inference and stop it from drifting wide or cascading errors. |
| **Type widening** | Inference choosing a more general type than the value suggests (TS literal → `string`; `null` → broad union). Often unwanted. |
| **Type narrowing** | Inference (or flow analysis) choosing a more specific type. Desirable when intended; surprising when not. |
| **`noImplicitAny` / `explicit-module-boundary-types`** | TypeScript/ESLint settings that forbid silent `any` and require annotations at module boundaries. The canonical "policy as code." |
| **Public API boundary** | The exported surface of a module/crate/package. The highest-value place to annotate. |
| **Defaulting** | A language picking a concrete type for an otherwise-ambiguous one (Haskell numeric defaulting; TS structural widening). |
| **Type-driven development** | Writing the (annotated) type first and letting it drive and check the implementation — inference assists *within* the stated type. |
| **Diagnostic quality** | The engineering investment a compiler makes in *good* error messages (Elm, Rust) vs. terse unification dumps. |
| **Stability of inference** | Whether a small code change perturbs inferred types widely. Annotated boundaries improve stability. |

---

## Core Concepts

### 1. Annotation Is Three Things at Once

The professional reframes every annotation as serving three jobs simultaneously, and weighs all three:

1. **Documentation.** A signature is the most-read, least-stale form of docs. `fn parse(s: &str) -> Result<Config, Error>` tells a caller everything without a doc comment.
2. **Error localization.** An annotation is a *firewall*. With a written return type, a mistake inside the function is reported *in* the function; without it, the mistake leaks out as a confusing error at every call site. Annotations cut error blast radius.
3. **Inference anchor.** A written type seeds the solver, preventing widening (TS), resolving ambiguity (Haskell), and stabilizing inference against unrelated edits.

Because one keystroke buys all three, the right annotation is rarely "wasteful." The waste is annotating *non-boundaries* — local temporaries whose type is obvious — where you pay verbosity for no localization or documentation benefit.

### 2. The Boundary Principle Is a Cost Model

"Annotate boundaries, infer bodies" isn't a slogan; it's the optimum of a cost model. Boundaries (exported functions, public fields, module interfaces) are:

- **Read the most** (every caller) → documentation payoff is highest.
- **The error firewall** → localization payoff is highest.
- **The inference seed** → anchoring payoff is highest.
- **The stability surface** → annotating them decouples your module's inferred internals from callers, so internal refactors don't ripple type errors outward.

Bodies are read rarely, change often, and their types are usually obvious from context — so inference's concision wins there. Codify this: *required* annotations on exports, *discouraged* annotations on obvious locals.

### 3. The `auto` / `var` Debate, Resolved

This debate consumes endless code-review threads. The resolution is a single testable rule plus a linter:

- **Allow** inference when the type is *manifest on the line*: `var users = userRepo.findAll();`, `auto it = container.begin();`, `let cfg = Config::default();`. The reader sees the type without leaving the line.
- **Forbid** inference when the type is *not* manifest: `var x = process(input);` — the reader must chase `process`'s signature. Write the type.
- **Always** spell out the type when the *specific* type matters and the default would differ: numeric width, owning vs. borrowed (`auto` copies!), nullable vs. not.

The "almost always auto" camp (Herb Sutter) optimizes for not committing to a concrete type and for correctness (no implicit conversions); the "explicit" camp optimizes for diff-readability without an IDE. Both are right in their context — *server code reviewed in plain diffs* leans explicit; *template-heavy generic C++* leans `auto`. The professional move is to pick per-codebase and **enforce it with a linter**, ending the per-PR argument.

### 4. Engineering Error Quality

Inference's worst tax is bad error messages, and this is an *engineering* problem the language and the codebase both influence:

- **Language side:** Elm and Rust invested heavily in diagnostics — Elm rephrases unification failures in human terms; Rust points at both conflicting spans and suggests annotations. Terse compilers (older GHC, raw OCaml) dump unification internals.
- **Codebase side:** *you* improve error quality by annotating boundaries (localization), enabling stricter flags (`-Wall`, `-Werror`, `strict` in TS, `#![deny(warnings)]`), and adding type signatures as "tripwires" around tricky generic code so a mismatch is caught early and locally.

A team that treats "the error pointed at the wrong line" as inevitable is leaving hours on the table. Treat misleading errors as a signal to add an anchoring annotation upstream.

### 5. Diagnosing "Inference Gave the Wrong Type"

A recurring production-grade incident: the code compiled, but inference produced a type you didn't intend, and the bug surfaced far downstream. The professional diagnostic loop:

1. **Observe the actual inferred type.** Use the IDE (hover, rust-analyzer, TS quick-info) or force a deliberate error to make the compiler print it (`let _: () = the_value;`).
2. **Identify the divergence.** Compare inferred vs. intended. Common gaps: TS widened a literal to `string`; an empty container defaulted; a numeric literal took the wrong width; a `?` collapsed two branches to a least-upper-bound.
3. **Find the anchor point.** Where *should* the type have been pinned? Usually the nearest boundary or the literal that widened.
4. **Annotate there, re-check.** A single seed annotation usually both fixes the type and tightens every downstream error.

### 6. Inference and Codebase Stability / Refactorability

Inference is double-edged for large-scale change. **Pro:** change an implementation's internals and inferred local types follow automatically — no churn. **Con:** change a *boundary's* inferred type (because it wasn't annotated) and the new type silently flows to every caller, possibly compiling with subtly different behavior or erupting in errors across the codebase. The professional mitigation is exactly the boundary principle: **annotated public types are a contract that decouples a module's evolution from its consumers.** This is why large TS/Rust codebases enforce explicit boundary types — not for the compiler, but for *change management*.

### 7. Type-Driven Development: Inference as Assistant, Not Author

At scale, the most reliable workflow inverts the junior intuition. Instead of writing code and letting inference name everything, you **write the annotated type first** (the function signature, the data model) and let inference fill the *body* against that fixed target. The type *drives* the implementation; inference *assists within* it. The benefits compound: the boundary is documented and stable from day one, errors are localized from the start, and the body still enjoys concision. This is standard practice in Haskell, idiomatic in Rust and TS for public surfaces, and the discipline that separates "inference as a convenience" from "inference as part of a design method."

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Annotation as firewall** | Fire doors in a building: a mistake (fire) inside one room is contained instead of spreading the whole floor. Boundary types are fire doors for type errors. |
| **Boundary principle** | Labeling the *outside* of warehouse crates (read by everyone) but not every screw inside (read by no one). |
| **`auto`/`var` policy** | A dress code: not "everyone wears the same," but a written rule enforced at the door (linter), ending daily arguments. |
| **Error-quality engineering** | A good error-reporting system in an ops team: the alert points at the root cause, not a random downstream symptom. |
| **Inferred type drifting wide (TS)** | A photocopier that subtly enlarges each copy; after a few generations the document no longer fits the folder (the literal union). |
| **Type-driven development** | An architect's blueprint signed off first; the builders (inference) fill in details *within* the approved plan. |
| **Inference stability** | A contract with a supplier: the *interface* is fixed (annotated), so they can change their factory (body) without breaking you. |

---

## Mental Models

### The "Annotation Budget" Model

Imagine a fixed budget of annotations you're willing to spend for readability's sake. Spending it on **boundaries** buys documentation + localization + anchoring + stability — high return. Spending it on **obvious locals** buys nothing but noise — negative return. Allocate the budget where the return is highest: the exported surface. This reframes "how much to annotate?" from taste into ROI.

### The "Blast Radius" Model

Every unannotated boundary has a *blast radius*: the set of call sites a type error (or a silent type change) can reach. Annotating the boundary shrinks the radius to the function itself. When triaging a confusing error or a risky refactor, ask "what's the blast radius here?" and annotate to shrink it. This is the load-bearing intuition behind boundary policy.

### The "Inference Is a Junior Pairing Partner" Model

Think of inference as a fast, literal-minded pair programmer who fills in obvious types instantly but makes unprincipled choices at ambiguous moments (widening, defaulting) and reports problems in confusing places. You don't fire the partner — you *direct* them with annotations at the points where their judgment is unreliable, and let them run free where it's reliable. Your annotations are the direction; their speed is the value.

---

## Code Examples

### Policy as code: TypeScript module-boundary types (ESLint)

```jsonc
// .eslintrc — enforce the boundary principle in CI
{
  "rules": {
    // Exported functions MUST have explicit param + return types:
    "@typescript-eslint/explicit-module-boundary-types": "error",
    // No silent any (inference's escape hatch) anywhere:
    "@typescript-eslint/no-explicit-any": "error"
  }
}
```

```typescript
// Fails the lint — inferred boundary:
export function load(id) { return db.get(id); }        // ❌

// Passes — annotated boundary, inferred body:
export function load(id: string): Promise<User> {       // ✅
  const row = db.get(id);   // body inferred — fine
  return row.then(toUser);
}
```

### Forcing the compiler to reveal an inferred type (diagnostic trick)

```rust
// Make the compiler print what it inferred, on purpose:
let v = data.iter().map(|x| x.parse()).collect::<Vec<_>>();
let _: () = v;   // error: expected `()`, found `Vec<Result<i32, ...>>`
                 // — now you SEE the inferred type in the message.
```

```typescript
// TS: hover shows it, or trip an error to surface it:
const config = loadConfig();
const _assert: never = config;   // error reveals config's actual type
```

### The `auto`/`var` rule in practice (C++)

```cpp
// ALLOWED — type is manifest on the line:
auto it   = users.find(id);          // iterator — clear from .find
auto user = std::make_unique<User>();// type is in the expression

// DISCOURAGED — type is NOT manifest:
auto x = compute();                  // x is... ? reader must chase compute()
SomeResult x = compute();            // explicit: self-documenting

// REQUIRED explicit — auto would change meaning:
const std::string& name = obj.name();
auto copy = name;        // ⚠ COPY (auto strips &/const) — usually a bug
const auto& ref = name;  // ✅ bind by reference as intended
```

### Diagnosing a too-wide TypeScript inference in real code

```typescript
// Incident: a feature flag check silently never matches.
const FLAGS = { newCheckout: "on" };      // inferred { newCheckout: string }
function isOn(v: "on" | "off") { return v === "on"; }
// isOn(FLAGS.newCheckout)  // compiles? No — string not assignable.
// Worse variant: comparisons against widened strings that "look" fine.

// Fix: anchor the literal so the type matches intent.
const FLAGS2 = { newCheckout: "on" } as const;  // { readonly newCheckout: "on" }
isOn(FLAGS2.newCheckout);                        // ✅ type is "on"
```

### A misleading HM error whose real bug is elsewhere (Haskell)

```haskell
-- The compiler points HERE:
report xs = putStrLn ("total: " ++ show (total xs))
-- error: No instance for (Show ...) / couldn't match ... in `report`

-- ...but the real bug is in a DIFFERENT function:
total :: [Int] -> String     -- BUG: should return Int, not String
total = foldr (\x acc -> show x ++ acc) ""

-- Fix the upstream signature/impl; the downstream error vanishes.
-- Lesson: annotate `total` correctly and the error moves to its true home.
```

### Type-driven development: signature first, body inferred against it

```rust
// 1. Write the contract first (boundary, annotated):
pub fn dedup_sorted<T: Ord + Clone>(items: &[T]) -> Vec<T> {
    // 2. Body filled in; inference works AGAINST the stated return type.
    let mut out: Vec<T> = Vec::new();   // anchor where collect/new is ambiguous
    for x in items {
        if out.last() != Some(x) { out.push(x.clone()); }
    }
    out
}
```

---

## Pros & Cons

| Aspect | Pros (well-governed inference) | Cons (ungoverned inference) |
|--------|-------------------------------|------------------------------|
| **Readability** | Concise bodies; boundaries documented by annotation. | `var x = f()` everywhere → reviewers can't tell types in diffs. |
| **Error localization** | Boundary annotations firewall errors to their function. | Unannotated boundaries leak cryptic errors to all callers. |
| **Refactor safety** | Annotated public types decouple modules; internals refactor freely. | A boundary's inferred type silently changes and flows to consumers. |
| **Onboarding** | New devs read signatures; bodies are obvious. | New devs blocked by widening/MR/ambiguity with no guidance. |
| **Velocity** | Less boilerplate; type-driven design speeds correct code. | Hours lost chasing errors pointed at the wrong line. |
| **Tooling** | Linters enforce policy; IDEs show inferred types. | Without policy, every PR re-litigates `auto`/`var`. |
| **Correctness** | `auto`/inference avoids implicit narrowing conversions. | Wrong-width numerics, accidental copies, widened literals slip through. |

---

## Use Cases

Set explicit-annotation policy for:

- **Every exported/public function and type.** Non-negotiable in shared codebases. Enforce with `explicit-module-boundary-types` (TS), `clippy::missing_docs_in_private_items`/review for Rust pub items, or convention + review for Haskell top-levels.
- **Data models and DTOs at system edges** (API requests/responses, config, serialized formats). Widening and defaulting here cause real bugs; annotate.
- **Performance- or correctness-sensitive numeric code** where the inferred width matters.
- **Generic/`auto`-heavy code where `auto` would copy** instead of borrow (C++ references, Rust `&`).

Let inference run free for:

- **Local temporaries with manifest types** (`var it = map.find(...)`, `let cfg = Config::default()`).
- **Lambda/closure parameters with contextual typing** (`.map`, `.filter`).
- **Iterator/builder chains inside a body**, anchored only at the final `collect`/assignment.

---

## Coding Patterns

### Pattern 1: Encode the boundary principle in CI

Make "annotate exports" a lint error, not a review comment. The argument disappears once the linter owns it.

```jsonc
"@typescript-eslint/explicit-module-boundary-types": "error"
```

### Pattern 2: Seed one anchor to fix a cascade

```rust
// 20 errors at call sites → add ONE return-type-driven anchor:
let parsed: Vec<i32> = raw.iter().map(|s| s.parse().unwrap()).collect();
```

### Pattern 3: `as const` at every literal-data boundary (TS)

```typescript
export const EVENTS = ["click", "hover", "focus"] as const;
export type EventName = typeof EVENTS[number];
```

### Pattern 4: Tripwire annotations around tricky generics

```haskell
-- Put a signature on the helper so a mismatch is caught HERE, not at callers.
combine :: (Semigroup a) => [a] -> Maybe a
combine = foldr (\x acc -> Just (maybe x (x <>) acc)) Nothing
```

### Pattern 5: Reveal-then-fix for wrong inferred types

```typescript
// Force the compiler to print the inferred type, compare to intent, anchor.
const _reveal: never = suspiciousValue;  // read the error, then annotate source
```

---

## Best Practices

- **Make annotation policy explicit and enforced.** Write it in the style guide; encode it in the linter. "Annotate exports, infer locals" is a good default for nearly every team.
- **Treat a misleading error as a missing anchor, not bad luck.** When the compiler points at the wrong line, add a boundary annotation upstream and watch the error relocate to its real home.
- **Never let `auto`/`var` hide a type the reader needs.** The test is "is the type manifest on this line?" If not, write it.
- **Watch for inference that copies or widens.** C++ `auto` strips `&`/`const`; TS widens literals; Haskell defaults numerics. Annotate where the default differs from intent.
- **Adopt signature-first (type-driven) development for public surfaces.** Write the annotated contract, then fill the body. Documentation, localization, and stability come for free.
- **Use the compiler's strict modes.** `strict` (TS), `-Wall -Werror` (Haskell/GCC/Clang), `#![deny(warnings)]` (Rust). They convert silent inference surprises into actionable diagnostics.
- **Teach the team to *read the inferred type* (IDE hover, reveal trick) before trusting it.** Most "the type was wrong" incidents are caught in seconds this way.
- **Prefer languages/tools with good diagnostics for inference-heavy code,** and lean on their suggestions (Rust's "consider giving this a type annotation," Elm's rephrased errors).

---

## Edge Cases & Pitfalls

- **Inferred boundary types are an invisible API.** If a public function's return type is inferred, you can break consumers by a *change that still compiles locally*. Always annotate the public surface; it's a contract.
- **`auto` accidental copies in hot paths.** `for (auto x : bigThings)` copies each element. `for (const auto& x : bigThings)` doesn't. A performance bug born from convenience inference.
- **TS widening at config/edge boundaries.** Feature flags, action types, route tables inferred as `string`/`string[]` instead of literal unions — silent logic bugs. `as const` or annotate.
- **The error points at the wrong function.** HM/unification surfaces the clash at a *use*, often a different module than the buggy definition. Don't trust the line number; trace types, annotate the suspected boundary to relocate the error.
- **A small change floods the codebase with errors.** Editing an unannotated boundary's inferred type ripples to all callers at once. The flood usually has *one* root cause; annotate the boundary to localize it.
- **Defaulting masks intent in subtle ways.** Haskell numeric defaulting and TS structural widening "help" by guessing — until the guess is wrong and the bug is silent. Annotate when the default isn't what you mean.
- **Over-annotation is also a cost.** Annotating every obvious local buries the *meaningful* annotations (the boundaries) in noise and creates churn on refactors. Spend the annotation budget on boundaries.
- **Inference disagreements across compiler versions.** Widening rules, defaulting, and contextual-typing behavior evolve (TS especially). Code that relied on a particular inferred type can break on upgrade. Annotate the load-bearing types so upgrades don't shift them.

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│        TYPE INFERENCE — ENGINEERING POLICY                       │
├──────────────────────────────────────────────────────────────────┤
│ Every annotation buys THREE things at once:                      │
│   1. documentation   (most-read, least-stale)                    │
│   2. error localization (a firewall — shrinks blast radius)      │
│   3. inference anchor (stops widening / resolves ambiguity)      │
├──────────────────────────────────────────────────────────────────┤
│ THE policy:  annotate BOUNDARIES, infer BODIES                   │
│   boundary = exported fn, public field, module interface, DTO    │
│   body     = local temporaries, builder chains, callbacks        │
│   enforce with a LINTER, not a review comment                    │
├──────────────────────────────────────────────────────────────────┤
│ auto/var rule:  is the type MANIFEST on this line?               │
│   yes → infer        no → write it        differs from default → │
│                                            always annotate        │
│   (watch: auto/auto-copy, const&, numeric width)                 │
├──────────────────────────────────────────────────────────────────┤
│ Diagnose "wrong inferred type":                                  │
│   1. reveal it (IDE hover / `let _: () = v;` / `never`)          │
│   2. compare inferred vs intended                                │
│   3. find the anchor point (nearest boundary / widened literal)  │
│   4. annotate there, re-check                                    │
├──────────────────────────────────────────────────────────────────┤
│ Misleading error?  → it's a MISSING ANCHOR upstream.             │
│   add a boundary signature; the error relocates to its cause.    │
├──────────────────────────────────────────────────────────────────┤
│ Strict modes on:  TS strict · -Wall -Werror · deny(warnings)     │
│ Workflow:  signature-first (type-driven), body inferred          │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- At the professional level, inference is a **codebase-wide policy**, not a personal style. Every annotation is **documentation, an error-localization firewall, and an inference anchor** at once — so *where* you annotate is an architectural decision.
- The **boundary principle** ("annotate exports, infer bodies") is the optimum of a real cost model: boundaries are read most, are the error firewall, are the inference seed, and are the stability surface. Encode it in a **linter**, not in review comments.
- The **`auto`/`var` debate resolves to one testable rule** — annotate when the type isn't *manifest on the line*, and always when the default differs (numeric width, `auto`-copies-not-references) — chosen per codebase and enforced automatically.
- **Inference failures cost real time.** Misleading HM errors point downstream of the bug; TS widening silently breaks logic; the monomorphism restriction blocks beginners. The professional skill is the diagnostic loop: **reveal the inferred type, compare to intent, find the anchor, annotate, re-check** — and treat a misleading error as a *missing upstream anchor*.
- **Annotated public types are a contract** that decouples a module's evolution from its consumers — the load-bearing reason large TS/Rust codebases mandate explicit boundary types for *change management*, not the compiler.
- The mature workflow is **type-driven development**: write the annotated contract first, let inference fill the body against it. You get documentation, localization, and stability up front while keeping the body concise.
- Run the compiler's **strict modes**, prefer tools with good **diagnostics**, spend the **annotation budget on boundaries**, and teach the team to **read the inferred type before trusting it.**

---

## Further Reading

- *Style Guidelines for Local Variable Type Inference in Java* — Stuart Marks (Oracle). The definitive professional take on *when* to use `var`. https://openjdk.org/projects/amber/guides/lvti-style-guide
- *Almost Always Auto* — Herb Sutter (GotW #94). The pro-`auto` C++ position; read alongside its critics for the full debate.
- *TypeScript: Do's and Don'ts* and *`tsconfig` `strict` options* — the official guidance on boundary annotations and widening. https://www.typescriptlang.org/docs/
- *typescript-eslint rules* — `explicit-module-boundary-types`, `no-explicit-any`, `no-inferrable-types`. Policy-as-code in practice. https://typescript-eslint.io/rules/
- *Rust API Guidelines* — the sections on naming and on public-type stability. https://rust-lang.github.io/api-guidelines/
- *Compiler Errors for Humans* — Elm's approach to diagnostics; the gold standard for inference error quality. https://elm-lang.org/news/compiler-errors-for-humans
- *Type-Driven Development with Idris* — Edwin Brady. The book-length case for signature-first development.
- *Parse, Don't Validate* — Alexis King. A widely cited essay on letting types (and the inference around them) drive design at boundaries.
