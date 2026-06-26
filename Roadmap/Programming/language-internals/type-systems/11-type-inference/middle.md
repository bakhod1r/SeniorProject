# Type Inference — Middle Level

> **Focus:** How global inference actually works — fresh type variables, constraints, unification, and the let-polymorphism that lets `\x -> x` be reused at every type.

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

> Focus: **How can a language infer types for a *whole program* with no annotations at all?** And **what is the machine that does it?**

At the junior level, inference was "read the value on the right." That only scales to *local* inference — Go `:=`, Java `var`, C++ `auto`. Those languages still make you annotate function signatures. But ML, OCaml, and Haskell can take an entirely unannotated program and figure out every type, including parameter and return types, with no help from you:

```haskell
compose f g x = f (g x)   -- no annotations anywhere
-- inferred: (b -> c) -> (a -> b) -> a -> c
```

That is **global** (whole-program) inference, and it is powered by one of the most elegant algorithms in programming languages: the **Hindley-Milner** type system, implemented as **Algorithm W**. This page demystifies it. The algorithm is not magic and not AI — it's a mechanical four-step process you could do on paper:

1. Give every unknown a **fresh type variable** (a placeholder).
2. Walk the code and, from how things are *used*, generate **constraints** (equations between types).
3. **Unify** — solve those equations by substituting variables, like solving simultaneous equations in algebra.
4. **Generalize** at `let` bindings so a definition can be reused at many types.

In one sentence: **Hindley-Milner treats type inference as solving a system of equations — invent unknowns, collect equations from usage, and solve them.**

> 🎓 **Why this matters at the middle level:** Once you see inference as constraint-solving, three things click: *why* HM gives you the most general type automatically, *why* it produces those famously cryptic errors (a unification clash surfaces wherever the solver hit the contradiction, not where your bug is), and *why* the `let` vs. lambda distinction matters so much. You stop fearing the type checker and start reading it.

---

## Prerequisites

What you should know before reading this:

- **Required:** The junior level of this topic — local inference, the "read the initializer" rule, the edges-vs-insides split.
- **Required:** Comfort reading function types like `a -> b -> c` (a function taking an `a` and a `b`, returning a `c`).
- **Required:** What a *generic* / *parametrically polymorphic* function is — one that works for any type, like `identity`.
- **Helpful but not required:** Any exposure to ML, OCaml, or Haskell syntax. We keep examples small.
- **Helpful but not required:** Having solved simultaneous equations (`x + y = 5; x - y = 1`). Unification is the same idea on types.

You do **not** need:

- The full operational rules of Algorithm W or a proof of soundness (that's `senior.md`).
- Constraint-based reformulations (Algorithm M, HM(X)), or how typeclasses thread through (`senior.md`/`professional.md`).
- Bidirectional checking or higher-rank types (`senior.md`).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Hindley-Milner (HM)** | A type system supporting *parametric polymorphism* with *complete* type inference: every well-typed program has an inferable, most-general type. Used by ML, OCaml, Haskell (its core). |
| **Algorithm W** | The classic procedure (Damas & Milner, 1982) that implements HM inference: fresh variables, constraint generation, unification, generalization. |
| **Type variable** | A placeholder for an unknown type, written `a`, `b`, `t0`, `α`. "I don't know this type yet." |
| **Fresh variable** | A brand-new type variable not used anywhere else, minted whenever the inferencer meets an unknown. |
| **Constraint** | An equation between two type expressions, e.g. `a = Int`, or `t0 -> t1 = Bool -> t2`. Generated from how values are used. |
| **Unification** | Solving a set of type equations by finding a substitution that makes both sides equal. (Robinson, 1965.) |
| **Substitution** | A mapping from type variables to types, e.g. `{a ↦ Int, b ↦ Bool}`. The "answer" unification produces. |
| **Occurs-check** | The rule that forbids unifying `a` with a type *containing* `a` (e.g. `a = a -> b`), which would create an infinite type. |
| **Generalization** | Turning free type variables in a type into a `forall` so the binding can be used at many types. Happens at `let`. |
| **Instantiation** | The reverse: replacing a `forall`-bound variable with a fresh one each time a polymorphic value is *used*. |
| **Let-polymorphism** | HM's rule that `let`-bound definitions are generalized (polymorphic) but lambda parameters are not. The crux of HM. |
| **Principal type** | The single *most general* type of an expression, of which every other valid type is a special case. HM always finds it. |
| **Monomorphic** | Having one fixed type, no `forall`. Lambda parameters are monomorphic within their body. |
| **Rank-1 polymorphism** | All `forall`s sit at the outermost level of a type. HM is exactly rank-1; this is its key limitation. |

---

## Core Concepts

### 1. Step 1 — Fresh Type Variables for Every Unknown

When HM sees something whose type it doesn't yet know — a function parameter, an empty list, the result of a call — it **mints a fresh type variable**:

```haskell
\x -> ...    -- x has type t0 (fresh). We'll find out what t0 is from usage.
```

These are not "any type" in a vague sense; they are *specific unknowns* that the next steps will pin down. Think `t0`, `t1`, `t2`, generated like an auto-incrementing counter.

### 2. Step 2 — Generate Constraints From Usage

Every place a value is *used* tells the inferencer something. Usage produces **constraints** (equations):

```haskell
\x -> x + 1
```

- `x` has fresh type `t0`.
- `1` has type `Int`.
- `(+)` has type `Int -> Int -> Int` (in a monomorphic-`Int` world for simplicity).
- We *apply* `(+)` to `x`, so `x` must be `Int`. Constraint: **`t0 = Int`**.
- The result of `x + 1` is `Int`, so the whole lambda has type `t0 -> Int`.

The inferencer is not guessing — it's reading what each operator and call *demands* of its arguments, and writing those demands down as equations.

### 3. Step 3 — Unification Solves the Equations

**Unification** takes the pile of equations and finds a substitution making both sides of each equal. The rules are simple and mechanical:

- A variable unifies with anything: `t0 = Int` → substitution `{t0 ↦ Int}`.
- Two constructors unify if they match and their parts unify: `t0 -> t1 = Bool -> t2` → unify `t0 = Bool` *and* `t1 = t2`.
- Two *different* constructors clash: `Int = Bool` → **type error** (the famous "couldn't match `Int` with `Bool`").

Applying `{t0 ↦ Int}` to the lambda's type `t0 -> Int` gives `Int -> Int`. Done. Unification is the engine; everything else feeds it equations.

### 4. The Occurs-Check — No Infinite Types

What if usage demands `a = a -> b`? That would mean `a` is a function whose argument type is itself, forever: `((... -> b) -> b) -> b`. An **infinite type**. HM forbids this with the **occurs-check**: before binding a variable `a` to a type `T`, check that `a` does **not occur inside** `T`. If it does, reject.

```haskell
\x -> x x     -- apply x to itself
-- x : t0, and applying it: t0 = t0 -> t1
-- occurs-check FAILS: t0 occurs in (t0 -> t1).  REJECTED.
```

This is why `\x -> x x` (self-application) does not typecheck in ML/Haskell. The occurs-check is the guard that keeps unification terminating and types finite.

### 5. Step 4 — Generalization and Let-Polymorphism

Here is HM's signature move. Consider:

```haskell
let id = \x -> x in (id True, id 0)
```

After inferring `id : t0 -> t0`, HM **generalizes**: the free variable `t0` becomes universally quantified — `id : forall a. a -> a`. Now each *use* of `id` **instantiates** that `forall` with a fresh variable: `id True` uses `id : Bool -> Bool`, `id 0` uses `id : Int -> Int`. One definition, many types. That's **let-polymorphism**.

The critical contrast — generalization happens at `let`, **not** at lambda parameters:

```haskell
-- This FAILS:
\id -> (id True, id 0)
-- id is a lambda PARAMETER → monomorphic → one fixed type t0.
-- id True forces t0 = Bool -> _; id 0 forces t0 = Int -> _.
-- Bool clashes with Int.  TYPE ERROR.
```

A `let`-bound name is generalized and reusable at many types; a lambda parameter is **monomorphic** and locked to one type. This distinction *is* Hindley-Milner. (Why the restriction? Generalizing lambda parameters would require guessing a polymorphic type before seeing the body — undecidable in general. `let` lets HM infer the type *first*, then generalize.)

### 6. Principal Types — Always the Most General

A landmark property: every well-typed HM expression has a **principal type** — a single most-general type from which all its other valid types follow by instantiation. HM's algorithm always *finds* it, with no annotations.

```haskell
\x -> x          -- principal type: forall a. a -> a
const = \x y -> x  -- principal type: forall a b. a -> b -> a
map              -- principal type: forall a b. (a -> b) -> [a] -> [b]
```

You never get a needlessly specific type by accident. If your code permits `forall a. a -> a`, that's exactly what HM gives you. This is why ML/Haskell code is so reusable "for free."

### 7. Why HM Is Decidable, Fast, and Rank-1

HM hits a sweet spot: inference is **decidable** (always terminates with yes/no) and, in practice, near-linear. The price is **rank-1 polymorphism**: every `forall` lives at the *outermost* level of a type. You can have `forall a. a -> a`, but **not** `(forall a. a -> a) -> Int` — a function that takes a polymorphic function as an argument (rank-2). HM cannot infer rank-2 and higher; once you need them, you must annotate. Full type inference for rank-2+ polymorphism is undecidable, which is exactly why Haskell requires a signature for higher-rank functions. The next level (`senior.md`) covers what else breaks HM: subtyping, overloading/typeclasses, and polymorphic recursion.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Fresh type variable** | A blank in a crossword. You don't know the letter yet, but you've reserved the square. |
| **Constraint generation** | Reading the crossword *clues* — each clue constrains what can fill the blanks. |
| **Unification** | Filling the grid so all crossing words agree. A conflict (two clues demand different letters in one square) is a type error. |
| **Occurs-check** | A rule that a clue can't define a word in terms of *itself* — no infinite recursion in the puzzle. |
| **Generalization (`let`)** | Buying a *template* contract you can fill in with any client's name, many times. |
| **Instantiation (use site)** | Each time you actually sign that template for a specific client, filling in their name. |
| **Monomorphic lambda parameter** | A form already filled in with one client's name — you can't reuse it for a different client. |
| **Principal type** | The most general version of a recipe ("works with any flour"), of which "works with wheat flour" is just a special case. |

---

## Mental Models

### The "Simultaneous Equations" Model

Treat the whole program as a system of type equations. Every unknown is a variable; every use of a value adds an equation. **Unification is Gaussian elimination for types.** A solvable system gives you the program's types; an unsolvable one (a contradiction like `Int = Bool`) is a type error. Once you hold this model, "the compiler inferred a type" stops being mysterious — it solved your equations.

### The "Counter of Fresh Variables" Model

Imagine an integer counter starting at 0. Every time the inferencer meets an unknown, it stamps the next `t0`, `t1`, `t2`. By the end, every blank has a number. Unification then collapses many of those numbers into concrete types or into each other (`t3 = t7 = Int`). Watching this counter tick is the most concrete way to "run Algorithm W in your head."

### The "let Generalizes, lambda Doesn't" Model

Picture two kinds of boxes. A `let` box is a **rubber stamp**: stamp it on `True`, on `0`, on `"x"` — it adapts each time (polymorphic). A lambda-parameter box is a **single-use sticker**: the first thing you stick it to fixes its type, and a second, differently-typed use tears it. When inference unexpectedly says two uses "must be the same type," check whether you're inside a lambda parameter rather than a `let`.

---

## Code Examples

### Tracing `\x -> x + 1` by hand

```text
Expression:  \x -> x + 1

1. FRESH:    x : t0
2. CONSTRAINTS from usage of (+):
             (+) : Int -> Int -> Int     (Int-specialized for clarity)
             x used as left arg of (+)   ⇒  t0 = Int
             1 : Int                     ⇒  consistent
             result of (+) : Int
3. UNIFY:    {t0 ↦ Int}
4. RESULT:   \x -> x + 1  :  Int -> Int
```

### Tracing `compose` (`\f g x -> f (g x)`)

```text
Expression:  \f g x -> f (g x)

1. FRESH:    f : t0,  g : t1,  x : t2
2. CONSTRAINTS:
   (g x):   g applied to x  ⇒  t1 = t2 -> t3      (g : t2 -> t3)
   (f _):   f applied to (g x)'s result (t3)
                              ⇒  t0 = t3 -> t4     (f : t3 -> t4)
   whole:   \f g x -> ...   :  t0 -> t1 -> t2 -> t4
3. SUBSTITUTE:  t1 ↦ (t2 -> t3),  t0 ↦ (t3 -> t4)
4. RESULT (rename t2→a, t3→b, t4→c):
   compose : (b -> c) -> (a -> b) -> a -> c
```

No annotations, and HM derived the fully general type. This is the heart of why ML-family code is so concise.

### Let-polymorphism in action (OCaml)

```ocaml
let id = fun x -> x in   (* id : 'a -> 'a  (generalized) *)
let a = id true in        (* instantiate 'a = bool *)
let b = id 0 in           (* instantiate 'a = int  *)
(a, b)                    (* : bool * int  — totally fine *)
```

```ocaml
(* The lambda version FAILS — id is a parameter, monomorphic: *)
let bad = fun id -> (id true, id 0)
(* Error: this expression has type bool but an expression
   was expected of type int — id's single type 'a was fixed
   to (bool -> _) by the first use, clashing with int. *)
```

### The occurs-check, demonstrated (Haskell, in GHCi)

```haskell
> let f = \x -> x x
<interactive>: Occurs check: cannot construct the infinite type:
               t ~ t -> t1
```

GHC literally names the rule. `x x` demands `x`'s type contain itself; the occurs-check rejects it.

### Where HM stops: higher-rank needs an annotation (Haskell)

```haskell
{-# LANGUAGE RankNTypes #-}

-- HM cannot INFER this; you must WRITE the rank-2 type.
applyToBoth :: (forall a. a -> a) -> (Int, Bool)
applyToBoth f = (f 1, f True)

-- Without the signature, GHC would force f to ONE monomorphic
-- type and reject (f 1, f True), exactly like the lambda-id case.
```

The `(forall a. a -> a)` *inside* a parameter position is rank-2. HM is rank-1, so inference can't reach it — the annotation is mandatory.

### Inference flowing backward through usage (Rust, a local-HM-flavored case)

```rust
let mut v = Vec::new();   // v : Vec<?>  — fresh element type
v.push(3u8);              // constraint: element = u8
// v is inferred as Vec<u8> from the LATER push, not the declaration.
```

Rust isn't full HM, but its local inference uses the same "collect constraints from all uses, then unify" idea within a function body.

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **Annotation burden** | Whole programs typecheck with *zero* annotations. Maximum signal-to-noise. | The *absence* of types can hurt readability and makes errors harder to localize. |
| **Generality** | Always finds the *principal* (most general) type — free reusability. | "Most general" can be *too* general; an over-polymorphic type can defer an error to a confusing place. |
| **Performance** | Inference is decidable and near-linear in practice. | Pathological cases (deeply nested `let`s) can be exponential in theory (rare in practice). |
| **Error quality** | Sound: if it typechecks, it's type-safe. | Cryptic errors — unification reports the clash *wherever* it was found, often far from the real bug. |
| **Expressiveness** | Clean for parametric polymorphism. | Rank-1 only. Subtyping, higher-rank, overloading, polymorphic recursion all break or require annotations. |
| **Refactoring** | Change an implementation; types re-flow automatically. | A tiny change can shift an inferred type program-wide, surfacing errors in unrelated files. |

---

## Use Cases

HM-style global inference shines when:

- **You're writing in the ML family** — OCaml, Standard ML, Haskell (core), F#, Elm, ReasonML, parts of Scala/Rust. The model *is* the language.
- **The domain is data transformation** — parsers, compilers, interpreters, type-driven business logic — where parametric polymorphism is everywhere and annotations would be pure noise.
- **You want maximum reuse for free.** Functions get their most general type, so `map`, `fold`, `compose` work across all types without thought.
- **You value "if it compiles, it's probably right."** HM's soundness plus exhaustive pattern checking catches a large class of bugs at compile time.

Lean on explicit annotations even in HM languages when:

- **A function is a public API.** A top-level signature is documentation *and* an error-localization anchor.
- **The inferred type is too general or ambiguous** (often with typeclasses — see `senior.md`).
- **You need a feature beyond rank-1** — higher-rank, polymorphic recursion. Then annotation is mandatory, not optional.

---

## Coding Patterns

### Pattern 1: Write top-level signatures even though inference doesn't need them

```haskell
-- Idiomatic Haskell: annotate every top-level binding.
average :: [Double] -> Double
average xs = sum xs / fromIntegral (length xs)
```

The body is fully inferable; the signature is there for *humans* and for *pinning errors* to this function instead of its callers.

### Pattern 2: Use `let` (not lambda) when you need polymorphic reuse

```ocaml
let twice f x = f (f x)   (* polymorphic; reusable at many types *)
```

If you find yourself wanting one helper used at several types, bind it with `let` so generalization applies.

### Pattern 3: Annotate to *narrow* an over-general inferred type

```haskell
-- read :: Read a => String -> a   — too general; which `a`?
n :: Int
n = read "42"        -- annotation chooses the instance and resolves it
```

### Pattern 4: Add a signature to *move* a confusing error

When an error points deep inside a helper, add a type signature to the *boundary* function. Inference then checks against your signature locally, and the error surfaces at the real mismatch instead of cascading.

---

## Best Practices

- **In HM languages, annotate top-level definitions by convention.** It's not required for the compiler; it's required for the next human and for sane error messages.
- **Reach for `let`/`where` bindings when you need polymorphism;** remember lambda parameters are monomorphic.
- **When an error is cryptic, bisect with annotations.** Add a signature to a sub-expression or helper to force the checker to localize the clash. The error usually jumps to the real culprit.
- **Don't fight the principal type.** If HM infers something more general than you expected, your code genuinely *is* that general — usually a good thing.
- **Know your rank-1 boundary.** The moment you pass a polymorphic function as an argument, expect to write a `forall` annotation; inference can't reach there.
- **Treat a unification "cannot match X with Y" as: two usages disagree.** Find the two places that each demand a type of the same value, and reconcile them.

---

## Edge Cases & Pitfalls

- **The error is reported far from the bug.** Unification finds a contradiction at *some* point in the equation set; that point is often not where you made the mistake. A wrong type in one function can surface as an error in a caller three files away. This is HM's defining frustration.
- **Self-application is rejected (occurs-check).** `\x -> x x` and similar fail with "infinite type." Not a compiler bug — a deliberate guard.
- **Lambda parameters are not polymorphic.** `\f -> (f 1, f True)` fails. People coming from dynamic languages expect `f` to adapt; HM locks it to one type. Use a `let` or a higher-rank annotation.
- **Over-general types defer errors.** A function inferred as `forall a. a -> a` when you *meant* `Int -> Int` will compile, then fail confusingly at a distant call site where the wrong type is finally forced.
- **Numeric literals are themselves polymorphic in Haskell.** `42 :: Num a => a`. This is great until ambiguity strikes (see the monomorphism restriction in `senior.md`) and you must annotate `:: Int`.
- **A small edit can cascade.** Because types flow globally, changing one definition's type can break inference in many places at once — sometimes a flood of errors from one root cause.
- **"It compiled but the type is wrong."** HM guarantees *type safety*, not that the inferred type is the one you *intended*. An overly general inferred type is the usual sign you should have annotated to constrain it.

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│              HINDLEY-MILNER / ALGORITHM W                        │
├──────────────────────────────────────────────────────────────────┤
│ Four steps:                                                      │
│   1. FRESH      mint a type variable t0, t1, ... per unknown     │
│   2. CONSTRAIN  each USE of a value adds an equation             │
│   3. UNIFY      solve the equations → a substitution             │
│   4. GENERALIZE at `let`, turn free vars into `forall`           │
├──────────────────────────────────────────────────────────────────┤
│ Unification rules:                                               │
│   var = T            ⇒ bind {var ↦ T}  (if occurs-check passes)  │
│   A->B = C->D        ⇒ unify A=C and B=D                         │
│   Int = Bool         ⇒ TYPE ERROR (constructor clash)            │
│   a = (a -> b)       ⇒ OCCURS-CHECK FAILS (infinite type)        │
├──────────────────────────────────────────────────────────────────┤
│ let-polymorphism (the crux):                                     │
│   let id = \x->x    ⇒ id : forall a. a -> a   (generalized)      │
│   \id -> ...        ⇒ id : t0  (MONOMORPHIC — one fixed type)    │
├──────────────────────────────────────────────────────────────────┤
│ Principal type: HM always finds the MOST GENERAL type            │
│   \x -> x   :  forall a. a -> a                                  │
├──────────────────────────────────────────────────────────────────┤
│ Limits (need annotations):                                       │
│   rank-2+ polymorphism   (forall in argument position)          │
│   subtyping, overloading/typeclasses, polymorphic recursion     │
├──────────────────────────────────────────────────────────────────┤
│ Errors: reported where the clash is FOUND, not where the bug is │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- **Global (whole-program) inference** is what separates ML/OCaml/Haskell from the local inference of `var`/`auto`/`:=`. It needs *no* annotations, even on function signatures.
- The engine is **Hindley-Milner**, implemented as **Algorithm W**, and it runs in four mechanical steps: **fresh variables** for unknowns, **constraints** from usage, **unification** to solve them, **generalization** at `let`.
- **Unification** is Gaussian elimination for types: bind variables, match constructors, error on clashes. The **occurs-check** forbids infinite types like `a = a -> b`, which is why self-application doesn't typecheck.
- **Let-polymorphism** is the crux: `let`-bound names are generalized to `forall` and reusable at many types; **lambda parameters are monomorphic** and locked to one. `let id = \x->x` works; `\id -> (id True, id 0)` does not.
- HM always finds the **principal (most general) type** — free reusability, no accidental over-specialization.
- HM is **decidable and fast**, but only **rank-1**. Higher-rank polymorphism, subtyping, overloading/typeclasses, and polymorphic recursion all break inference and demand annotations — the subject of `senior.md`.
- The price of "no annotations" is **error localization**: unification reports the clash wherever it's found, often far from the real bug. The cure is to annotate boundaries — which is why idiomatic Haskell still writes top-level signatures.

---

## Further Reading

- *Principal Type-Schemes for Functional Programs* — Luis Damas & Robin Milner, POPL 1982. The original Algorithm W paper.
- *A Machine-Oriented Logic Based on the Resolution Principle* — J. A. Robinson, 1965. The source of unification and the occurs-check.
- *Types and Programming Languages* — Benjamin C. Pierce. Chapter 22, "Type Reconstruction," is the canonical textbook treatment of HM.
- *Write You a Haskell* — Stephen Diehl. Implements Algorithm W from scratch in readable steps. http://dev.stephendiehl.com/fun/
- *The Hindley-Milner type system* — the Wikipedia article is unusually good and includes the inference rules.
- *Real World OCaml* — the chapter on the type system shows let-polymorphism and the value restriction in practice. https://dev.realworldocaml.org/
- *How OCaml type checker works — or what polymorphism and garbage collection have in common* — Oleg Kiselyov. A deep, accessible walkthrough.
