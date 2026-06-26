# Generics & Parametric Polymorphism — Senior Level

> **Topic:** [Generics & Parametric Polymorphism](README.md)
> **Focus:** *Parametricity* — the theorem that makes parametric polymorphism a reasoning tool, not just a reuse tool. Why a fully-parametric `T -> T` can only be the identity, what "theorems for free" buys you, where parametricity leaks (reflection, `null`, side effects), and the harder corners: rank-1 vs. higher-rank polymorphism, specialization for performance, and the expression problem.

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
13. [Summary](#summary)

---

## Introduction

> Focus: **Parametric polymorphism is not only about reuse — it is about *ignorance as a guarantee*.** Because a fully-parametric function *cannot inspect* the types it's given, the type signature alone constrains — sometimes *determines* — what the function can do. This is the deepest and most beautiful idea in the topic: **the type tells you the behavior.**

A junior learns generics as "write it once for all types." A middle engineer learns *how* the compiler delivers that across erasure and monomorphization. A senior learns to *reason* with parametricity: to read a polymorphic type signature and derive, for free, theorems about every possible implementation — what it must preserve, what it cannot fabricate, what laws it automatically obeys.

The canonical example: consider a function with signature

```text
f : forall T. T -> T
```

— fully parametric, no constraints, no reflection, no side effects. **There is exactly one thing `f` can do: return its argument unchanged.** It cannot construct a `T` (it doesn't know `T`'s constructors), cannot inspect a `T` (it can't branch on a value of unknown type), cannot fetch a `T` from anywhere else (there is no other `T` in scope). The *only* `T` it can return is the one it was handed. The type `forall T. T -> T` **forces** `f` to be the identity function. We didn't read the body. We didn't run a test. The type *proved* it.

This is **parametricity** (Reynolds, 1983) and its practical face, **"theorems for free"** (Wadler, 1989): from a polymorphic type you can mechanically derive a theorem that *every* implementation of that type must satisfy. `map : (A -> B) -> List<A> -> List<B>` must satisfy `map(f) . map(g) = map(f . g)` *for free* — the type guarantees it. `head : forall T. List<T> -> T` must return an element that was *in* the list — it can't conjure a new one. A function `forall T. List<T> -> List<T>` can only *rearrange and drop* elements (reverse, take, filter-by-position) — it cannot duplicate by value-inspection or insert new elements, because it can't see what the elements *are*.

The power and the price are the same fact: **parametric code is blind, and blindness is a contract.** This page makes that contract precise, shows how to *use* free theorems in real engineering (correctness arguments, API design, fewer tests), shows exactly where parametricity **leaks** in real languages (reflection, `instanceof`, `null`, exceptions, mutation, `unsafe`), and then handles the senior-level structural topics: **rank-1 vs. higher-rank** polymorphism (why `(forall T. T -> T) -> ...` is strictly more expressive and why most languages restrict to rank-1), **specialization** for performance (`@specialized`, Rust monomorphization, profile-guided), and the **expression problem** — the deep tension generics participate in but do not alone solve.

---

## Prerequisites

- **Required:** Middle level — the four polymorphisms, monomorphization vs. erasure vs. reified vs. Go's hybrid, dictionaries.
- **Required:** Comfort reading polymorphic type signatures (`forall T. ...`, `map : (a -> b) -> [a] -> [b]`).
- **Required:** Functional basics: higher-order functions, function composition (`f . g`).
- **Helpful:** Exposure to Haskell or another language with serious parametric polymorphism (System F lineage).
- **Helpful:** A sense of why side effects and `null` complicate equational reasoning.

You do **not** need:

- Category theory or the relational definition of parametricity in full formal detail (we give the operational intuition; the math is optional).
- Production performance/binary engineering at scale (`professional.md`).
- Variance or higher-kinded types in depth (sibling topics; touched here).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Parametricity** | The theorem (Reynolds) that polymorphic functions behave uniformly: they map *related* inputs to *related* outputs, regardless of the type instantiated. Formalized via *logical relations*. |
| **Theorems for free** | (Wadler) The practice of deriving a theorem that every implementation of a polymorphic type must satisfy, purely from the type. |
| **Free theorem** | A specific such theorem (e.g. the naturality law of `map`). |
| **Uniformity** | A parametric function does the same thing for all type instantiations; it cannot branch on the type. |
| **Naturality** | A free-theorem form: a polymorphic function "commutes" with mapping a function over its inputs (`g . f = f' . map g` style laws). |
| **Rank-1 polymorphism** | All `forall` quantifiers are at the outermost position of a type (`forall T. T -> T`). The default in most languages; supports full inference (Hindley–Milner). |
| **Higher-rank polymorphism** | A `forall` appears to the *left* of an arrow / nested inside (`(forall T. T -> T) -> (Int, Bool)`). More expressive; breaks full inference; needs annotations. |
| **System F** | The polymorphic lambda calculus underlying parametric polymorphism; supports arbitrary-rank quantification. |
| **Logical relation** | The proof technique behind parametricity: relate two instantiations and show the function preserves the relation. |
| **Specialization** | Generating an optimized concrete version of a generic for a specific type to remove boxing/dispatch (Scala `@specialized`, Rust mono, .NET value-type JIT). |
| **Expression problem** | The challenge of adding both new types *and* new operations to a datatype without modifying existing code or losing type safety. |
| **Parametricity leak** | A language feature (reflection, `instanceof`, `null`, exceptions, mutation, `unsafe`) that lets polymorphic code *observe* or *fabricate* type information, breaking free theorems. |
| **Bottom (`⊥`)** | Non-termination or error (exception, infinite loop). Its existence weakens free theorems ("up to bottom"). |
| **Relational parametricity** | The formal statement: instantiating a polymorphic term at two related types yields related results. |

---

## Core Concepts

### 1. Parametricity: Ignorance Is a Contract

A parametric function is given values of a type it *cannot name*. It has no constructors for that type, no way to inspect or compare its values, no other values of that type lying around. So everything it can *output* of that type must be traceable to an *input* of that type. This is the operational heart of parametricity: **outputs are plumbed from inputs; nothing of the unknown type can be invented.**

Formally (Reynolds), pick any *relation* `R` between two types `T1` and `T2`. A parametric function instantiated at `T1` and at `T2` maps `R`-related inputs to `R`-related outputs. The function "can't tell" which side of `R` it's on, so it must treat them uniformly. From this single principle, every free theorem follows. You don't need the full machinery day-to-day; you need the consequence: **the type pins down the structure of the behavior.**

### 2. The Classic Catalogue of Free Theorems

Reading types as constraints:

- **`forall T. T -> T`** → **identity**. Only the input `T` is available to return.
- **`forall T. T -> T -> T`** → returns the first *or* the second argument (two total functions: `const` and `flip const`). It cannot do anything else with two opaque `T`s. Combined with the value, just "pick one."
- **`forall A B. A -> B -> A`** → **`const`** — must return the `A`; there's no way to produce a `B` it wasn't given except by returning the `B` argument, but the result type is `A`, so it must be the first argument.
- **`forall T. List<T> -> T`** (total) → returns an element *that was in the list*; can't fabricate a new `T`. (If the list can be empty it must be partial — a leak via `⊥`, see below.)
- **`forall T. List<T> -> List<T>`** → can only **permute and drop** elements (reverse, tail, take, dedup-by-position-not-value). It can't insert new elements (can't make a `T`) and can't filter by *value* (can't inspect a `T`) — only by *position/length*.
- **`forall A B. (A -> B) -> List<A> -> List<B>`** (i.e. `map`) → satisfies **naturality**: `map f . rearrange = rearrange . map f` for any structural rearrangement; concretely `map f . map g = map (f . g)`. The *only* freedom in implementing `map` is which input elements end up where in the output; applying `f` is forced.
- **`forall A. (A -> Bool) -> List<A> -> List<A>`** (i.e. `filter`) → the output is a sublist of the input (order-preserving subset), and which elements are kept depends only on the predicate's verdicts — never on the elements' concrete identities.

These are *theorems*, provable from the type, holding for *every* correct implementation. That is an extraordinary amount of certainty extracted from a signature.

### 3. Using Free Theorems in Real Engineering

This is not academic. Practical leverage:

- **Fewer tests, sharper tests.** If `dedupe : forall T. Eq T => List<T> -> List<T>` is parametric in `T` (only using `Eq`), you needn't test it for `Int`, `String`, `User` separately — its behavior is uniform; testing one representative type plus the *law* (output is a subsequence, no element value the input lacked) covers all types. Property-based testing leans directly on this.
- **API design as proof.** Choosing the *most* polymorphic type for a function maximizes what callers can rely on and minimizes what the implementer can secretly do. A logging callback typed `forall T. T -> T` is provably a pass-through (good for an interceptor that must not alter the value); typed `Object -> Object` it could do anything.
- **Refactoring safety.** A free theorem tells you a generalization is behavior-preserving. If you widen `process(List<User>)` to `process<T>(List<T>)` and the body still compiles, parametricity guarantees you didn't add type-specific behavior — there's nowhere to hide it.
- **Reasoning about third-party generics.** Seeing `Cache<K, V>` with a method `get : K -> Option<V>` that's parametric in `V` tells you the cache can't *inspect or transform* your values — only store and return them. The type is documentation you can trust.

### 4. Where Parametricity Leaks (and Why You Must Know)

Free theorems hold in an *idealized* parametric language. Real languages add escape hatches that let polymorphic code *peek* at or *fabricate* types, invalidating the theorems. A senior must know exactly where the contract breaks:

- **Reflection / `instanceof` / `typeof(T)`.** The moment code can ask "is `T` actually an `Int`?", it can branch on the type — destroying uniformity. A C# `forall T. T -> T` could `if (typeof(T) == typeof(int)) return default; else return x;` — *not* the identity. Reflection is the biggest leak.
- **`null` and `⊥` (bottom).** In languages with `null` or unrestricted non-termination/exceptions, `forall T. T -> T` could be `\x -> null` or `\x -> throw` or `\x -> loop`. So the theorem becomes "identity *or bottom*." This is why Haskell states free theorems "up to bottom," and why a `null`-free, total language (or an effect-tracked one) gives *stronger* free theorems.
- **Side effects / mutation.** A parametric function that can perform I/O or mutate shared state can *observe* order, count, or external data, smuggling non-uniformity in through the effect rather than the value. Pure parametric code has the strongest theorems; effectful code weakens them. (This is a major argument for purity and effect tracking.)
- **`unsafe` / pointer casts.** Rust `unsafe`, C-style casts, `unsafeCoerce` — bypass the type system entirely; no free theorem survives.
- **Runtime type information by design (reified generics).** C#'s very strength (knowing `T` at runtime) is a parametricity *weakness*: its generics are *not* fully parametric, so you cannot rely on free theorems for arbitrary C# generic code the way you can for (pure) Haskell.

The practical rule: **free theorems are exactly as strong as your language is parametric.** Haskell (pure, no reflection on type variables) ≈ very strong. Java/C#/Go (reflection, `null`, effects) ≈ weak — treat free theorems as *design guidance and likely-true*, not as guarantees, unless you've audited the body for leaks.

### 5. Rank-1 vs. Higher-Rank Polymorphism

Where the `forall` sits matters enormously.

**Rank-1** (the default in Java, C#, Go, Rust surface syntax, ML/Haskell without extensions): all quantifiers are outermost.

```text
forall T. T -> T                    -- rank-1: the forall is at the very top
```

The caller picks `T` once, at the call site. This is what Hindley–Milner type inference can fully infer with no annotations — a huge ergonomic win, and the reason rank-1 dominates.

**Higher-rank** (rank-2 and beyond): a `forall` appears to the *left* of an arrow, i.e. nested inside an argument's type.

```text
(forall T. T -> T) -> (Int, Bool)   -- rank-2: the function ARGUMENT is itself polymorphic
```

Here the *callee* receives a still-polymorphic function and may instantiate it at *several* types internally:

```haskell
applyTwice :: (forall a. a -> a) -> (Int, Bool)
applyTwice f = (f 3, f True)     -- f used at Int AND at Bool inside the body
```

A rank-1 type `(a -> a) -> (Int, Bool)` *cannot* express this — once `a` is fixed by the caller, `f` can't be both `Int -> Int` and `Bool -> Bool`. Higher-rank is strictly more expressive (it's full System F), enabling patterns like the ST monad's `runST :: (forall s. ST s a) -> a` (the rank-2 `forall s` is what makes mutable state *safely escape-free*), and certain encodings of existentials and continuations.

The cost: **type inference becomes undecidable in general for arbitrary-rank System F.** So languages that allow it (Haskell with `RankNTypes`, Scala, OCaml in places) require *explicit type annotations* at higher-rank uses. Most mainstream languages restrict to rank-1 precisely to keep inference automatic. Knowing the distinction explains *why* you can't pass a "truly generic" function as an argument in Java/Go and must instead pass an interface/functional object that's monomorphic at the boundary.

### 6. Specialization: Reclaiming Performance Without Losing Polymorphism

Parametric code in erased/uniform runtimes pays the boxing/dispatch tax (middle level). **Specialization** is the targeted antidote: generate optimized concrete versions for chosen types while keeping the polymorphic source.

- **Rust / C++** specialize *everything* by default (monomorphization) — already covered; the senior nuance is *deliberately erasing* hot-but-huge generics via `dyn`/virtual to control bloat, trading the specialization back for code size.
- **Scala `@specialized`** asks the compiler to emit primitive-specialized variants of a generic (e.g. an `Array[Int]` path with no boxing) alongside the generic one — opt-in monomorphization on the JVM, fighting erasure's boxing for numeric code. It multiplies bytecode, so you specialize *selectively*.
- **.NET** JIT-specializes value-type instantiations automatically (reified), so the senior lever there is mostly about *avoiding accidental boxing* at interface boundaries.
- **Profile-guided / partial specialization**: specialize only the type arguments that profiling shows are hot, leaving the rest erased — capturing most of the speedup for a fraction of the bloat.

The senior framing: specialization is the knob that lets you *slide along the monomorphization↔erasure spectrum per call site*, instead of accepting your language's global default. Parametric polymorphism gives you the freedom to *write once*; specialization gives you the freedom to *compile selectively*.

### 7. The Expression Problem (and Generics' Role in It)

The **expression problem** (Wadler's name for a classic tension): you have a datatype with several *variants* and several *operations*. You want to add **new variants** *and* **new operations** later, without recompiling/modifying existing code and without losing static type safety. The two dominant styles each handle one axis well and the other badly:

- **OOP / subtype polymorphism** makes adding **variants** easy (new subclass implements the interface) but adding **operations** hard (you must touch every existing class to add a method).
- **Functional / pattern matching** makes adding **operations** easy (a new function pattern-matches all variants) but adding **variants** hard (you must edit every existing function's match).

**Generics participate but don't single-handedly solve it.** Parametric polymorphism abstracts over *types of data*, but the expression problem is about extensibility along *two axes simultaneously*. Solutions combine generics with other machinery: **typeclasses/traits** (Haskell, Rust — open both axes via dictionaries and orphan-rule-bounded coherence), **the visitor pattern + generics** (OOP, partially), **tagless-final** and **finally-tagless encodings**, **object algebras** (Oliveira & Cook — generics + interfaces giving genuine two-axis extension), and **multimethods/protocols** (Clojure, Julia). The senior takeaway: when you feel an API straining to be extended in *both* directions, you've met the expression problem, and the fix is rarely "more generics" alone — it's choosing an encoding (typeclasses, object algebras, tagless-final) that opens both axes. Recognizing the problem by name is half the battle.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Parametricity (ignorance as contract)** | A bonded courier in a sealed-envelope service. They *cannot* open the envelope, so you *know* the contents arrive unaltered — their ignorance is your guarantee. |
| **Free theorem** | A delivery receipt you can fill in *before* the courier even leaves, because the service's rules force the outcome: "contents unchanged, delivered as-is." |
| **`forall T. T -> T` is identity** | Hand the sealed courier one envelope; the only envelope they can give back is the one you handed them. |
| **Parametricity leak (reflection)** | A courier with an X-ray machine: now they *can* peek inside and treat "documents" differently from "jewelry." The guarantee evaporates. |
| **Leak via `null`/`⊥`** | A courier allowed to "lose" the package (return nothing / never arrive). The receipt now reads "unchanged *or* lost." |
| **Rank-1 polymorphism** | You choose the envelope size once, at the counter, before handing it over. |
| **Higher-rank polymorphism** | You hand the clerk a *magic resizer* that *they* can apply to several different parcels inside the back room — strictly more capable, but the counter clerk needs written instructions to use it. |
| **Specialization** | Pre-printing optimized forms for your *most common* shipment types while keeping the general form for the rest. |
| **Expression problem** | A product catalog where you want to add both new *products* and new *attributes* without reprinting the whole catalog each time. |

---

## Mental Models

### The "Type Is a Proof Obligation" Model

Stop reading a polymorphic signature as documentation and start reading it as a *constraint solver's output*. `forall T. List<T> -> List<T>` isn't "some list transformation" — it's "the set of all functions that rearrange-and-drop, and *nothing else*." The narrower (more polymorphic) the type, the smaller that set, often down to a single function. Designing APIs is choosing how small to make that set.

### The Leak Audit

Whenever you want to *rely* on a free theorem, run a mental audit of the body (or the language): does it use reflection / `instanceof` / `typeof`? Can it return `null` or throw or loop forever? Does it perform effects? Does it use `unsafe`? Each "yes" weakens or voids the theorem. Free theorems are a *property of pure, total, non-reflective parametric code*; everything else is "probably true, verify."

### The Two-Axis Grid (Expression Problem)

Draw a table: rows = data variants, columns = operations. OOP fills it row-by-row (easy new rows, painful new columns). FP fills it column-by-column (easy new columns, painful new rows). The expression problem asks for *both* directions cheap. Keep this grid in mind whenever an interface or sum type starts resisting extension — it tells you which axis is fighting you and which encoding (typeclasses, object algebras) restores it.

### Polymorphism Recursion Down the Rank Ladder

Rank counts how *deeply nested* the `forall` is. Rank-1: caller fixes the type. Rank-2: callee can use a polymorphic argument at many types. Higher: arbitrary nesting (full System F). Expressiveness climbs; inference degrades; annotation burden rises. Most languages stop at rank-1 on purpose.

---

## Code Examples

### Deriving identity from the type, then watching a leak void it

```haskell
-- In pure Haskell, this type has exactly ONE total inhabitant: id.
ident :: a -> a
ident x = x          -- the type forces this; no other total definition exists
                     -- (modulo bottom: `ident _ = undefined` also "type-checks")
```

```csharp
// In C#, the SAME signature does NOT force identity, because reflection leaks.
static T Ident<T>(T x) {
    if (typeof(T) == typeof(int)) return default(T);  // type-specific branch!
    return x;                                          // not the identity for int
}
// The free theorem holds only as strongly as the language is parametric.
```

### A free theorem for `map`, demonstrated

```haskell
-- map's type guarantees naturality: map f . map g == map (f . g)
-- This holds for EVERY correct map, derived from the type alone — no proof of the body needed.
naturality :: (b -> c) -> (a -> b) -> [a] -> Bool
naturality f g xs = (map f . map g) xs == map (f . g) xs
-- True for all f, g, xs. The type (a->b) -> [a] -> [b] leaves map no room to violate it.
```

### `forall T. List<T> -> List<T>` can only permute/drop — shown by exhaustion

```haskell
-- Every total, pure function of this type is some combination of selecting positions.
rev   :: [a] -> [a];  rev   = reverse        -- legal: pure rearrangement
tl    :: [a] -> [a];  tl xs = drop 1 xs      -- legal: pure drop
-- impossible :: [a] -> [a]
-- impossible xs = xs ++ [headOfWhat?]       -- ILLEGAL: cannot fabricate a new `a`
-- impossible xs = filter (> 5) xs           -- ILLEGAL: cannot inspect a value of type `a`
```

### Higher-rank polymorphism: the `runST` pattern (rank-2 forall as a safety device)

```haskell
{-# LANGUAGE RankNTypes #-}
-- The rank-2 `forall s` makes the mutable state region UNABLE to escape:
-- runST :: (forall s. ST s a) -> a
-- Because `s` is quantified INSIDE the argument, no STRef tagged with this `s`
-- can leak out (its type would mention the bound `s`, which isn't in scope outside).
-- This is parametricity used as a *capability boundary* — rank-1 cannot express it.

applyAtTwoTypes :: (forall a. a -> a) -> (Int, Bool)
applyAtTwoTypes f = (f 3, f True)    -- needs the polymorphic f; rank-1 (a->a) can't do this
```

### Scala specialization: fighting erasure's boxing for numerics

```scala
// Without @specialized, Container[Int] boxes every Int (JVM erasure).
class Container[@specialized(Int, Long, Double) T](val value: T)
// The compiler emits primitive-specialized variants (Container$mcI$sp, etc.),
// so Container[Int] stores a raw int with no boxing — opt-in monomorphization
// layered on top of an erased runtime. Multiplies bytecode; use selectively.
```

### The expression problem, both axes, via typeclasses (Haskell sketch)

```haskell
-- Data variants are open: anyone can add a new type and make it an instance.
class Shape s where area :: s -> Double          -- an OPERATION as a typeclass
data Circle = Circle Double
data Square = Square Double
instance Shape Circle where area (Circle r) = pi * r * r
instance Shape Square where area (Square s) = s * s
-- Add a NEW VARIANT (Triangle) without touching Circle/Square:  ✅
-- Add a NEW OPERATION (perimeter) as a new class without touching the data:  ✅
class Perimeter s where perimeter :: s -> Double
-- Both axes open — generics (the polymorphic `area :: s -> Double`) PLUS typeclass
-- dictionaries solve what neither plain OOP nor plain pattern matching solves alone.
```

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **Parametricity as reasoning** | Derive correctness theorems from types alone; fewer/sharper tests; trustworthy APIs; safe generalizations. | Only as strong as the language is parametric — reflection/`null`/effects void it. Requires discipline (purity, totality) to fully exploit. |
| **Maximally polymorphic APIs** | Smaller behavior set → stronger guarantees for callers; self-documenting. | Can be *too* restrictive — sometimes you *want* the implementer to inspect types (then use ad-hoc/bounds). |
| **Higher-rank polymorphism** | Strictly more expressive (System F); enables `runST`-style capability boundaries, polymorphic arguments. | Breaks full inference → explicit annotations; harder to teach; absent in most mainstream languages. |
| **Specialization** | Reclaims monomorphization speed for chosen hot types without abandoning polymorphic source. | Code/bytecode bloat; must be applied selectively; adds build complexity (`@specialized`, PGO). |
| **Generics + expression problem** | With typeclasses/object algebras, opens *both* extension axes. | Generics *alone* don't solve it; choosing the right encoding is subtle and easy to get wrong. |

---

## Use Cases

- **Designing libraries you want callers to trust.** Type a transformation `forall T. ...` rather than `Object -> Object` so callers *know* it can't tamper with their data — parametricity makes the guarantee, not the docs.
- **Property-based testing of generic code.** Lean on free theorems to test one representative type plus the law, instead of per-type test suites. The uniformity is the justification.
- **Capability/region safety via higher-rank types.** `runST`-style APIs, scoped resources, and "this token can't escape this scope" patterns use rank-2 `forall` as an enforcement mechanism.
- **Numeric/performance-critical generic code on erased runtimes.** Apply `@specialized` (Scala) or drop to monomorphized paths (Rust) for hot type arguments; keep the polymorphic source for the rest.
- **Extensible interpreters / DSLs / plugin systems.** When you need to add both cases and operations over time, recognize the expression problem and reach for typeclasses, tagless-final, or object algebras — generics as one ingredient, not the whole recipe.
- **Auditing third-party generics for safety.** Read their signatures: a parametric `V` in `Cache<K,V>` *can't* inspect your values; a reflective body *can* — the type plus a leak audit tells you which.

---

## Coding Patterns

### Pattern 1: Pick the Most Polymorphic Type That Still Compiles

Generalize a function's type until the body stops compiling; the most polymorphic type that still works gives callers the strongest free theorem and the implementer the least room to surprise them. Stop when you genuinely need a capability (then add a *minimal* bound).

### Pattern 2: Use Parametricity to Justify Refactors

When widening a concrete function to a generic one (`f(List<User>)` → `f<T>(List<T>)`), if it still compiles unchanged, parametricity certifies you added no type-specific behavior. Use this as a *proof*, not just a hope.

### Pattern 3: Make `null`/Effects Explicit to Strengthen Theorems

Prefer `Option<T>`/`Result<T,E>` over `null`, and isolate effects, so your parametric functions are *total and pure* — which is exactly the condition under which free theorems hold strongly. The theorem strength is a *reward* for purity.

### Pattern 4: Reach for Rank-2 as a Safety Fence (where available)

When you need "this value must not escape this scope," a rank-2 `forall` on an argument (`(forall s. ...) -> r`) enforces it at the type level. Recognize the pattern even in languages that can't express it — it tells you what guarantee you're missing.

### Pattern 5: Specialize the Hot Few, Erase the Cold Many

Profile, identify the handful of type arguments dominating runtime, specialize *those* (`@specialized`, explicit mono), and leave the rest in the shared/erased path. Most of the speedup, a fraction of the bloat.

---

## Best Practices

- **Treat polymorphic types as theorems, not just signatures.** Before trusting a free theorem, *audit for leaks*: reflection, `instanceof`/`typeof`, `null`, exceptions, mutation, `unsafe`. The theorem is exactly as strong as the code is parametric.
- **Maximize polymorphism in API design to maximize caller guarantees.** A narrower (more abstract) type means a smaller set of possible behaviors — often the security/correctness property you want.
- **Keep parametric code pure and total** to get the strongest theorems and the easiest reasoning. `Option`/`Result` over `null`; effects at the edges.
- **Restrict to rank-1 unless you have a concrete reason** for higher-rank — and when you go higher-rank, *annotate explicitly* and document why (usually a capability/escape boundary).
- **Specialize selectively and by measurement**, never globally "to be fast." Specialization is a bloat-for-speed trade; pay it only where profiling proves it earns out.
- **Name the expression problem when you hit it** and choose an encoding (typeclasses, object algebras, tagless-final) deliberately, rather than bolting on more generics or copy-pasting visitor boilerplate.
- **Don't claim a free theorem in a leaky language as a guarantee.** In Java/C#/Go, present it as strong design guidance you've verified by inspecting the body — not as a proof.

---

## Edge Cases & Pitfalls

- **Believing free theorems in reflective/`null`/effectful code.** The single most common senior mistake: reasoning "this `T -> T` must be identity" in a language where it can reflect, return `null`, or throw. Always void the theorem if the language or body leaks.
- **Bottom weakens every theorem.** Even in pure Haskell, `forall T. T -> T` is "identity *or* `⊥`." Total-language reasoning is stronger; account for non-termination and partiality.
- **Higher-rank inference failures look like type errors.** When `RankNTypes` (or Scala's equivalent) can't infer, you get confusing errors; the fix is an explicit `forall` annotation, not a code change. Recognize the symptom.
- **`@specialized` bloat surprises.** Scala specialization can multiply generated classes combinatorially across multiple type parameters (`@specialized` on `K` *and* `V` → a grid of variants). Specialize the minimum set.
- **Expression-problem "solutions" that secretly require editing existing code.** Many naive fixes (downcasting visitors, `instanceof` chains) *appear* extensible but break type safety or force edits to existing classes. Verify the solution opens *both* axes *without* touching closed code.
- **Confusing parametric with ad-hoc when a bound is present.** `<T: Ord>` is parametric *structure* over an ad-hoc *operation*. Free theorems still apply to the structure, but the `Ord` calls are type-specific — don't over-claim uniformity for the bounded part.
- **Variance interactions void naive theorems.** A free theorem assumes the obvious functorial structure; covariant/contravariant positions and mutable containers change which transformations are legal. (Variance is its own topic; just know it interacts.)
- **Reified generics silently are not parametric.** C# code *looks* parametric but can branch on `typeof(T)`; never import Haskell-grade free-theorem confidence into C#/.NET without checking.

---

## Summary

- **Parametricity** turns parametric polymorphism from a reuse mechanism into a *reasoning* mechanism: because fully-parametric code *cannot inspect* its type variables, the **type signature constrains — often determines — the behavior**. Ignorance is a contract.
- **Theorems for free** (Wadler) derive, from a polymorphic type alone, a theorem every implementation must satisfy: `forall T. T -> T` *is* identity; `map`'s type *forces* naturality; `forall T. List<T> -> List<T>` can only **permute and drop**, never fabricate or value-inspect elements.
- These theorems pay off in engineering: **fewer/sharper tests, trustworthy APIs, safe refactors, and reliable reasoning about third-party generics.**
- Free theorems hold only as strongly as the language is parametric. **Leaks** — reflection/`instanceof`/`typeof`, `null`/`⊥`, side effects, `unsafe`, reified generics — weaken or void them. Pure, total, non-reflective code (Haskell-style) gets the strongest theorems; Java/C#/Go give *design guidance, verify by audit*.
- **Rank-1 polymorphism** (forall outermost; caller fixes the type) is the inferable default everywhere. **Higher-rank** (forall nested left of an arrow) is strictly more expressive (full System F), enables capability boundaries like `runST :: (forall s. ST s a) -> a`, but breaks full inference and demands annotations — which is why most languages stop at rank-1.
- **Specialization** (Rust/C++ mono, Scala `@specialized`, .NET value-type JIT, profile-guided) reclaims monomorphization speed for chosen hot types without giving up the polymorphic source — a per-call-site slider on the monomorphization↔erasure spectrum.
- The **expression problem** — adding new variants *and* new operations without editing closed code or losing type safety — is a tension generics *participate in but don't solve alone*; the real solutions combine generics with typeclasses/traits, object algebras, or tagless-final encodings. Recognizing it by name is half the fix.
- Senior mantra: **read the type as a theorem, audit for leaks, prefer the most polymorphic type that compiles, keep it pure to keep the theorem strong, and specialize only where measurement demands.**
