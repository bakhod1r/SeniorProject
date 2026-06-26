# Type Inference — Senior Level

> **Focus:** What breaks Hindley-Milner — subtyping, overloading/typeclasses, higher-rank, polymorphic recursion — and the modern answer: bidirectional type checking, plus how TypeScript actually infers.

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

> Focus: **Why can't real languages just use Hindley-Milner everywhere?** And **what replaced "infer everything" once they couldn't?**

Hindley-Milner is beautiful precisely because it's restricted: parametric polymorphism, rank-1, no subtyping, no overloading. Every feature programmers actually want — interfaces and inheritance (subtyping), `+` working on both ints and strings (overloading), typeclasses, generics that take generic functions (higher-rank) — *breaks* full inference, often making it undecidable. So no industrial language does pure HM. Even Haskell, the flagship, requires annotations the moment you leave the rank-1 core.

The modern answer is **bidirectional type checking**: instead of one global solve, the checker alternates between two modes — **synthesis** ("given this term, what type does it produce?") and **checking** ("given this expected type, does this term fit?"). Type information flows *down* from annotations (checking) and *up* from literals and known functions (synthesis), meeting in the middle. This is how Rust, Scala, TypeScript, Swift, Kotlin, and modern Haskell extensions actually work. It infers less than HM but it composes with subtyping and higher-rank types, gives dramatically better error locality, and is straightforward to implement.

In one sentence: **the senior view of inference is that HM's purity doesn't survive contact with subtyping and overloading, so real languages run a bidirectional checker that infers locally and leans on annotations at the boundaries.**

> 🎓 **Why this matters at the senior level:** You design APIs in languages with *partial* inference. Knowing *which* features defeat inference — subtyping, typeclass ambiguity, higher-rank, polymorphic recursion — tells you exactly where annotations are mandatory versus optional, why TypeScript sometimes infers a maddeningly wide type, and how to write signatures that make the inferencer (and the error messages) work *for* your users instead of against them.

---

## Prerequisites

- **Required:** Middle level — Algorithm W, unification, the occurs-check, generalization, let-polymorphism, principal types, the rank-1 limit.
- **Required:** What *subtyping* is (`Dog <: Animal`) and what *variance* means (covariance/contravariance), at least informally.
- **Required:** What *overloading* and *typeclasses/traits/interfaces* are, and *generics* with bounds.
- **Helpful:** TypeScript or Scala experience; you'll recognize the behaviors immediately.

You do **not** need: a formal metatheory of bidirectional typing or the full constraint-solving internals of a production checker (that's `professional.md`).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Bidirectional type checking** | An inference discipline with two modes: *synthesis* (infer a type from a term) and *checking* (verify a term against an expected type). Modern languages use this. |
| **Synthesis (inference) mode** | "Given this expression, what type does it have?" — flows information *up* from leaves (literals, known functions). |
| **Checking mode** | "Given this expected type, does this expression conform?" — flows information *down* from an annotation or context. |
| **Subtyping** | A relation `S <: T` meaning a value of type `S` is usable where `T` is expected. Breaks HM-style unification (now you need `<:`, not `=`). |
| **Overloading** | One name, multiple type-distinct implementations chosen by argument types (`+`, typeclass methods). Inference must *resolve* which one. |
| **Typeclass / trait constraint** | A predicate on a type variable, e.g. `Num a =>`, `T: Ord`. Inference must collect and discharge these constraints. |
| **Ambiguous type variable** | A constrained variable that appears nowhere in the result, so inference can't determine which instance to use. Requires annotation. |
| **Monomorphism restriction** | A Haskell rule that some unannotated bindings are *not* generalized, to avoid silent re-computation and ambiguity. A classic beginner trap. |
| **Higher-rank polymorphism** | `forall` appearing in argument position (`(forall a. a -> a) -> ...`). Rank-2 and up. Not inferable; needs annotation. |
| **Polymorphic recursion** | A recursive function used at a *different* type inside its own body. Inference of it is undecidable; needs a signature. |
| **Contextual typing** | TypeScript's term for checking mode: an expected type from context guides inference of an expression (e.g. a callback's parameter types). |
| **Best common type** | TypeScript's algorithm for inferring the type of a heterogeneous array/union from its elements. |
| **Local type inference** | Inference confined to expressions/statements with annotated boundaries — the design Pierce & Turner formalized; the basis of Scala/C#/Rust inference. |

---

## Core Concepts

### 1. Why Subtyping Breaks HM

HM's engine is *unification* — making two types **equal** by substitution. Subtyping replaces equality with a *relation*: `Int <: Number`, `Dog <: Animal`. Now when a function expects `Animal` and you pass a `Dog`, you don't want `Dog = Animal` (false) — you want `Dog <: Animal` (true). Inference must solve *subtyping constraints*, which form a lattice, not a simple substitution. The general problem (inferring with subtyping plus polymorphism) is intractable or undecidable in the forms programmers want. This is the deep reason **object-oriented languages have weaker inference than ML**: subtyping is baked into their core, and it poisons the clean unification HM relies on. Languages cope by inferring *locally* and propagating *expected* types, not by globally solving subtype constraints.

### 2. Why Overloading and Typeclasses Need Annotations

`(+)` in Haskell is `Num a => a -> a -> a`. The `Num a =>` is a **constraint**: "for some type `a` that is a number." Inference now does two jobs — solve the types *and* **resolve which instance** satisfies each constraint. Two failure modes appear:

- **Ambiguity.** `show (read s)` — `read :: Read a => String -> a`, `show :: Show a => a -> String`. The intermediate `a` is constrained (`Read`, `Show`) but **never appears in the result**. Inference can't choose the instance. GHC reports *"ambiguous type variable `a`"* and you must annotate: `show (read s :: Int)`.
- **Defaulting.** To stay usable, Haskell *defaults* some ambiguous numeric constraints (`Num` → `Integer`, `Fractional` → `Double`). Convenient, occasionally surprising.

The cost of overloading is that inference stops being purely structural; `::` annotations become a *required* tool, not a nicety.

### 3. The Monomorphism Restriction — The Classic Trap

Haskell has a rule that bites nearly every beginner. A binding like

```haskell
let f = read     -- NO arguments on the left, has a constraint (Read a)
```

is **not** generalized by default — instead of `f :: Read a => String -> a`, the monomorphism restriction forces `f` to a *single* monomorphic type, which inference then can't determine, yielding either an error or a defaulted type frozen at first use. The rationale: generalizing a *value* (not a syntactic function) could silently turn one shared computation into many re-evaluations, and could leave ambiguous constraints. The fix is exactly what the rule pushes you toward: **write a type signature**, or enable `NoMonomorphismRestriction`. It's a textbook case of inference *intentionally* refusing to infer to protect you, and the lesson is the annotation.

### 4. Higher-Rank and Polymorphic Recursion: Inference Gives Up

Two features where inference is provably out of reach:

- **Higher-rank.** `applyTwice :: (forall a. a -> a) -> (Int, Bool)`. The `forall` is in *argument* position (rank-2). Inferring where to place `forall`s is undecidable; GHC requires the signature (with `RankNTypes`).
- **Polymorphic recursion.** A function that calls *itself* at a different type (common with nested datatypes like `data Nested a = Nil | Cons a (Nested [a])`). Type inference for polymorphic recursion is undecidable (Henglein, 1993). You must annotate the recursive function's type; then *checking* it is easy.

The pattern repeats: **inference of these is undecidable, but *checking* them against a written type is decidable.** That asymmetry is the entire justification for bidirectional typing.

### 5. Bidirectional Type Checking — The Modern Engine

Bidirectional typing splits the judgment into two arrows:

- **Synthesis** (`e ⇒ T`): "I can read a type *out* of `e`." Literals, variables, function applications synthesize.
- **Checking** (`e ⇐ T`): "Given expected type `T`, does `e` fit?" Lambdas, `if`-branches, and anything ambiguous are *checked*.

The rule of thumb: **introduction forms are checked, elimination forms synthesize.** A lambda `\x -> body` can't synthesize (what's `x`'s type?) — but if we're *checking* it against `A -> B`, we know `x : A` and check `body ⇐ B`. An *annotation* `(e : T)` is the bridge: it lets you *switch* from checking to synthesis. Information flows down from annotations (checking) and up from leaves (synthesis), and they meet. This:

- **Composes with subtyping** — checking mode just verifies `synthesized <: expected`.
- **Handles higher-rank** — push the `forall` down via the annotation in checking mode.
- **Localizes errors** — a mismatch is reported exactly where synthesized and expected types fail to meet, near your code, not three files away. This is *the* practical win over HM's global solve.

Rust, Scala, Swift, Kotlin, TypeScript, and Haskell's higher-rank extensions are all bidirectional under the hood.

### 6. How TypeScript Actually Infers

TypeScript is the most widely used inferencing type system on Earth, and it is unapologetically *local* and bidirectional:

- **Contextual typing (checking mode).** `arr.map(x => x.length)` — the expected type of the callback comes from `map`'s signature and `arr`'s element type, so `x` is inferred without annotation. Remove the context (`const f = x => x.length;`) and `x` becomes an error (`noImplicitAny`) — there's nothing to check against.
- **Best common type.** `[1, 2, null]` infers `(number | null)[]` by finding a type compatible with all elements (or a union).
- **Generic inference from arguments.** `function id<T>(x: T): T` called as `id(42)` infers `T = number` from the argument. Inference of `T` flows from call arguments and the expected return type.
- **`as const`.** `{ kind: "a" } ` infers `{ kind: string }`; `{ kind: "a" } as const` infers the *literal* `{ readonly kind: "a" }`. A deliberate knob to make inference *narrower*.
- **Limits.** TS can't always infer generics from return position, struggles with higher-order generic flow, and will happily infer a type *wider* than you wanted (widening literals, inferring `string` where you meant a literal union). The fix is the same as everywhere: annotate to anchor.

### 7. Inference Failures and Their Cryptic Errors

The senior skill is reading inference failures:

- **HM/unification:** "couldn't match `Int` with `Bool`" reported at a *use* site, far from the wrong definition. The bug is upstream; the error is downstream.
- **Ambiguity:** "ambiguous type variable `a` arising from a use of `show`" — a constrained variable that never reaches the result. Cure: a type annotation that pins `a`.
- **TypeScript widening:** the dreaded "Type `string` is not assignable to type `"red" | "blue"`" — inference widened your literal. Cure: `as const` or an explicit annotation.
- **Too-wide / too-narrow:** TS infers `string` when you wanted a literal union (too wide), or narrows a `let` to a literal you meant to stay general (rare). Annotate to set the intended width.

The unifying lesson: **annotations are not just documentation; they are error-localization anchors and inference seeds.** A signature on the *right* boundary turns a cascade of confusing errors into one precise one.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Synthesis mode** | A detective deducing facts *from* evidence at the scene (reading upward from clues). |
| **Checking mode** | A teacher grading an answer *against* the known correct answer (a target flows downward). |
| **Annotation as the bridge** | A translator standing between two people who otherwise can't understand each other — it lets one mode hand off to the other. |
| **Subtyping breaking HM** | Switching from "exact change only" (equality) to "any bill ≥ the price" (a relation) — the cashier's logic gets much more complex. |
| **Ambiguous type variable** | Ordering "the usual" at a restaurant you've never visited — the constraint ("the usual") doesn't determine the dish without more context. |
| **Monomorphism restriction** | A library that refuses to issue you a *blank* membership card (could be misused many ways) until you fill in your name (the annotation). |
| **TypeScript widening** | A form that auto-changes your handwritten "blue" to "a color" — helpful, until you needed the exact word. `as const` turns auto-correct off. |

---

## Mental Models

### The "Two Arrows" Model

Hold two arrows in your head: `⇒` (synthesis, type comes *out*) and `⇐` (checking, type goes *in*). Every node in the AST is in one mode. Leaves and applications synthesize; lambdas, branches, and ambiguous literals are checked; annotations flip checking back to synthesis. When you wonder "why does this need an annotation?", the answer is almost always: *the inferencer is in synthesis mode where it can't synthesize* — so give it a checking context (an annotation) and it works.

### The "HM Is the Easy Special Case" Model

Picture a complexity dial. At the simplest setting — parametric polymorphism, rank-1, no subtyping — full inference is decidable and HM nails it. Turn the dial toward subtyping, overloading, higher-rank, polymorphic recursion, and inference degrades from "infer everything" to "infer locally, annotate boundaries," then to "checking only." Real languages sit somewhere in the middle and *choose* where to demand annotations. Knowing the dial tells you where your annotations are obligatory.

### The "Annotation as Seed Crystal" Model

In a supersaturated solution, a tiny seed crystal triggers the whole thing to crystallize. A single, well-placed type annotation does the same to inference: it seeds the solver with a concrete type, and inference precipitates correctly around it — *and* it relocates errors to that crystal's location. Senior engineers don't annotate everything; they place *one seed* at the boundary that matters.

---

## Code Examples

### Ambiguous type variable (Haskell)

```haskell
-- read  :: Read a => String -> a
-- show  :: Show a => a -> String

bad s = show (read s)
-- error: Ambiguous type variable 'a0' arising from a use of 'show'
--   the intermediate 'a0' is Read AND Show, but appears in NO result.

good s = show (read s :: Int)   -- annotation pins a0 = Int. Resolved.
```

### The monomorphism restriction biting a beginner (Haskell)

```haskell
-- Beginner writes:
average = \xs -> sum xs / fromIntegral (length xs)
-- Surprise: the MR + defaulting can freeze the numeric type, or:
let g = read in (g "1" :: Int, g "2.0" :: Double)
-- error: g is monomorphic; can't be both Int-reader and Double-reader.

-- Fix 1: a signature.
average :: [Double] -> Double
average xs = sum xs / fromIntegral (length xs)
-- Fix 2 (file-level): {-# LANGUAGE NoMonomorphismRestriction #-}
```

### Higher-rank: inference can't, checking can (Haskell)

```haskell
{-# LANGUAGE RankNTypes #-}

-- Cannot be inferred — the forall in argument position is rank-2.
runBoth :: (forall a. [a] -> Int) -> ([Int], [Bool]) -> (Int, Int)
runBoth f (xs, ys) = (f xs, f ys)
-- With the signature, CHECKING f xs and f ys is trivial.
```

### Bidirectional flow in Scala / Rust (synthesis up, checking down)

```scala
// Scala: the expected return type (checking) flows INTO the lambda;
// the literals (synthesis) flow OUT.
val f: Int => Int = x => x + 1   // x : Int inferred from the annotated type
List(1,2,3).map(x => x * 2)      // x : Int from List[Int].map's signature
```

```rust
// Rust: return type annotation (checking) lets the body's `?`/collect infer.
fn parse_all(ss: &[&str]) -> Result<Vec<i32>, std::num::ParseIntError> {
    ss.iter().map(|s| s.parse()).collect()
    // collect's target type is inferred FROM the function's return type.
    // Remove the return annotation and `collect` can't pick a container.
}
```

### TypeScript: contextual typing, best common type, `as const`, generic inference

```typescript
// Contextual typing (checking): x inferred from Array<number>.map signature
[1, 2, 3].map(x => x.toFixed(2));   // x: number, no annotation needed

// No context → noImplicitAny error:
// const f = x => x * 2;            // x implicitly 'any' (error under strict)

// Best common type:
const xs = [1, 2, null];            // inferred: (number | null)[]

// Generic inference from arguments:
function first<T>(arr: T[]): T | undefined { return arr[0]; }
const n = first([1, 2, 3]);         // T = number  →  n: number | undefined

// Widening vs. as const:
const a = { kind: "circle" };       // { kind: string }   (widened)
const b = { kind: "circle" } as const; // { readonly kind: "circle" } (literal)
```

### TypeScript inferring a too-wide type, and the fix

```typescript
type Shape = "circle" | "square";

// Inference WIDENS the array's element type to string:
const shapes = ["circle", "square"];     // string[]  — too wide!
function draw(s: Shape) {/*...*/}
// shapes.forEach(draw);                 // error: string not assignable to Shape

// Fix: anchor the intended type.
const shapes2: Shape[] = ["circle", "square"];   // Shape[]
const shapes3 = ["circle", "square"] as const;   // readonly ["circle","square"]
```

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **Bidirectional vs. HM** | Composes with subtyping, overloading, higher-rank; far better error locality. | Infers *less* — you must annotate more boundaries than pure HM would. |
| **Subtyping support** | Enables OO, variance, structural types programmers want. | Globally optimal inference becomes intractable/undecidable; inference is local only. |
| **Overloading/typeclasses** | Ad-hoc polymorphism (`+`, `Ord`, traits) — huge ergonomic win. | Ambiguity and the monomorphism restriction; `::` annotations become mandatory tools. |
| **TypeScript-style inference** | Massive convenience for everyday JS-shaped code; great IDE feedback. | Widening surprises, weak higher-order generic flow, `any` leaks if context is missing. |
| **Annotations** | Documentation + error anchors + inference seeds, all at once. | Effort; over-annotating buries signal in noise. |
| **Decidability** | Checking is always decidable, even where inference is not. | Programmers must *know* where inference stops — a learning cost. |

---

## Use Cases

Design for partial inference deliberately when:

- **You write public library APIs** in Rust/Scala/TS/Swift. Annotate every signature: it anchors inference for *callers*, localizes their errors, and documents intent. The body can stay inferred.
- **You use typeclasses/traits with polymorphic results.** Provide enough annotation (often a return-type or an explicit type argument) to avoid ambiguity for users.
- **You need higher-rank or polymorphic recursion.** Annotate the function — there is no alternative; inference is undecidable there.
- **You hit TypeScript widening at a boundary** (config objects, discriminated unions, tuples). Use `as const` or an explicit type to keep the narrow type you intended.

Lean on inference (don't annotate) when:

- **Inside function bodies**, where bidirectional checking has a context to work from.
- **In callbacks with contextual typing** (TS `.map`/`.filter`, Scala lambdas) — the context already supplies parameter types.
- **For obvious local lets** where the initializer names the type.

---

## Coding Patterns

### Pattern 1: Annotate the signature, infer the body

```rust
pub fn group_by_first<K: Eq + Hash, V>(pairs: Vec<(K, V)>) -> HashMap<K, Vec<V>> {
    let mut out = HashMap::new();          // body fully inferred from the return type
    for (k, v) in pairs { out.entry(k).or_default().push(v); }
    out
}
```

### Pattern 2: Pin ambiguity with a targeted annotation

```haskell
-- Don't annotate everything — annotate the ONE ambiguous spot.
result = sum (map read (words input) :: [Int])
```

### Pattern 3: Use `as const` to stop TypeScript widening

```typescript
const ROUTES = ["home", "about", "contact"] as const;
type Route = typeof ROUTES[number];   // "home" | "about" | "contact"
```

### Pattern 4: Provide a return-type annotation to drive `collect`/`into` inference

```rust
let nums: Vec<i32> = lines.iter().map(|l| l.len() as i32).collect();
// The annotation on `nums` is the checking context collect() needs.
```

### Pattern 5: Break a cryptic error by annotating the boundary, not the leaf

When inference errors cascade, add a signature to the *function* that should own the type. Bidirectional checking then traps the mismatch at that boundary instead of letting it ripple to callers.

---

## Best Practices

- **Annotate public boundaries; infer private bodies.** This is the single highest-leverage inference discipline in any partially-inferring language. Boundaries are documentation *and* error anchors.
- **When you see "ambiguous type variable," look for a constrained var that never reaches the result.** The cure is always a pinning annotation.
- **In Haskell, write top-level signatures** — it sidesteps the monomorphism restriction *and* localizes errors. Treat the MR as the compiler telling you to annotate.
- **In TypeScript, reach for `as const` for literal data** (route tables, action types, tuples) and for explicit types at config boundaries. Don't trust widening to preserve literals.
- **Remember: inference of higher-rank and polymorphic recursion is undecidable.** Don't fight the compiler — annotate and move on. *Checking* will be instant.
- **Use the IDE's "expand/quick info" to see what was actually inferred** before trusting it. TypeScript and rust-analyzer both show the real inferred type; confirm it matches intent.
- **Place one seed annotation, not ten.** Find the boundary that the solver pivots on; annotating there fixes the cascade with minimal noise.

---

## Edge Cases & Pitfalls

- **The error is downstream of the bug (HM/unification).** A wrong type in a definition surfaces at a far-away use. Bisect by annotating intermediate boundaries to pull the error toward the cause.
- **Ambiguous type variables from typeclasses.** `read`/`show` chains, `mempty`, numeric literals in polymorphic contexts. The variable is constrained but invisible in the result; annotate to resolve.
- **The monomorphism restriction freezes a binding.** A point-free or argument-free definition with a constraint silently becomes monomorphic. Symptom: "could not deduce... " or a type frozen at first use. Cure: a signature.
- **TypeScript widening literals.** `const x = "a"` in an object widens to `string`; arrays widen element types; this breaks assignment to literal-union types. Use `as const` or annotate.
- **TypeScript losing context → `any`.** Pull a callback out into a standalone `const` and its parameters lose their contextual types, silently becoming `any` (or erroring under `noImplicitAny`). Keep callbacks inline or annotate.
- **Subtyping + inference yields surprising least-upper-bounds.** `cond ? dog : cat` may infer `Animal` (or a union, or `{}` in TS), not what you expected. Annotate the result if a specific type matters.
- **Generic inference from return position is weak.** Many languages can't infer a type parameter that appears only in the return type; you must supply it explicitly (`collect::<Vec<_>>()`, `id<number>(...)`).
- **Defaulting hides intent.** Haskell defaulting (`Num` → `Integer`) and TS's structural widening both "helpfully" pick a type. Convenient until the picked type is wrong; annotate when the default isn't what you mean.

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│         WHAT BREAKS HM  +  THE BIDIRECTIONAL ANSWER              │
├──────────────────────────────────────────────────────────────────┤
│ Feature              Effect on inference                         │
│   subtyping          unification → subtyping lattice; LOCAL only │
│   overloading/       constraint solving; AMBIGUITY; need ::      │
│     typeclasses                                                  │
│   higher-rank        UNDECIDABLE to infer → annotation required  │
│   polymorphic        UNDECIDABLE to infer → annotation required  │
│     recursion                                                    │
│   monomorphism       refuses to generalize → write a signature   │
│     restriction                                                  │
├──────────────────────────────────────────────────────────────────┤
│ Bidirectional typing — two modes:                                │
│   SYNTHESIS  e ⇒ T   "read the type out" (literals, apps, vars)  │
│   CHECKING   e ⇐ T   "fit against expected" (lambdas, branches)  │
│   annotation (e : T) bridges checking → synthesis                │
│   intro forms are CHECKED; elim forms SYNTHESIZE                 │
├──────────────────────────────────────────────────────────────────┤
│ TypeScript inference knobs:                                      │
│   contextual typing  — params inferred from expected type        │
│   best common type   — union/compatible type of array elems      │
│   generic inference  — T from call arguments (not return pos)    │
│   as const           — keep LITERAL/narrow types (stop widening) │
├──────────────────────────────────────────────────────────────────┤
│ Cryptic errors → cures:                                          │
│   "ambiguous type variable"  → pin it with ::                    │
│   error far from bug         → annotate the boundary, bisect     │
│   "string not assignable to literal" (TS) → as const / annotate  │
├──────────────────────────────────────────────────────────────────┤
│ Rule: annotate BOUNDARIES, infer BODIES.                         │
│       Annotations = docs + error anchors + inference seeds.      │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- **No industrial language uses pure Hindley-Milner**, because the features programmers want — **subtyping, overloading/typeclasses, higher-rank, polymorphic recursion** — each break full inference, often making it undecidable.
- **Subtyping** turns unification's *equality* into a *relation/lattice*; this is the structural reason **OO languages infer less than ML**. **Overloading/typeclasses** add constraint solving, **ambiguous type variables**, and the **monomorphism restriction** — the classic Haskell-beginner trap whose cure is a signature.
- **Higher-rank polymorphism and polymorphic recursion are undecidable to infer but easy to check** — the asymmetry that motivates the modern design.
- That design is **bidirectional type checking**: **synthesis** (type out of a term) and **checking** (term against an expected type), bridged by **annotations**. It composes with subtyping and higher-rank, and — crucially — **localizes errors** near your code instead of HM's far-flung unification failures. Rust, Scala, Swift, Kotlin, TypeScript, and modern Haskell all run it.
- **TypeScript** is local and bidirectional: **contextual typing**, **best common type**, **generic inference from arguments**, and **`as const`** to fight widening. Its limits — widening literals, weak return-position generics, `any` when context is lost — are predictable once you know the model.
- **Inference failures are readable once you know the patterns:** unification errors point downstream of the bug, ambiguity means a constrained-but-invisible variable, TS errors usually mean widening. The cure is the same: **a single seed annotation at the right boundary** — which doubles as documentation and an error anchor.
- The senior discipline across all these languages: **annotate boundaries, infer bodies.**

---

## Further Reading

- *Local Type Inference* — Benjamin Pierce & David Turner, TOPLAS 2000. The foundational paper behind Scala/C#/Rust-style local inference.
- *Bidirectional Typing* — Jana Dunfield & Neel Krishnaswami, ACM Computing Surveys 2021. The definitive modern survey of synthesis/checking.
- *Complete and Easy Bidirectional Typechecking for Higher-Rank Polymorphism* — Dunfield & Krishnaswami, ICFP 2013. How checking handles higher-rank.
- *Type inference for polymorphic recursion is undecidable* — Fritz Henglein, 1993 (and Kfoury, Tiuryn, Urzyczyn). Why you must annotate.
- *A History of Haskell: Being Lazy With Class* — Hudak, Hughes, Peyton Jones, Wadler. Section on typeclasses and the monomorphism restriction.
- *The TypeScript Handbook* — "Type Inference," "Contextual Typing," and the `as const` notes. https://www.typescriptlang.org/docs/handbook/
- *Type Inference in Scala* — Martin Odersky's notes and the Scala 3 reference on local type inference.
- *GHC User's Guide* — sections on the monomorphism restriction, `RankNTypes`, and ambiguity. https://downloads.haskell.org/ghc/latest/docs/users_guide/
