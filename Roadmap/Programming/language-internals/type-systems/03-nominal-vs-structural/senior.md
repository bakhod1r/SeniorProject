# Nominal vs Structural Typing — Senior Level

> **Topic:** [Nominal vs Structural Typing](README.md)
> **Focus:** The formal machinery — subtyping rules, variance, row polymorphism, function-parameter soundness — and how a compiler actually *implements* nominal vs structural compatibility checks, with the consequences for API evolution and large-scale code.

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

> Focus: **What is the formal subtyping relation each model defines, where is it sound or unsound, and what does the compiler do mechanically to answer `S <: T`?**

A senior engineer should be able to derive the corner cases rather than memorize them. That requires three things: (1) the *typing rules* for nominal and structural subtyping written as inference rules, (2) **variance** — how subtyping propagates through generics, functions, and mutable containers, where most real soundness bugs live, and (3) an understanding of the *implementation*: a nominal check is essentially a label comparison plus an ancestry walk (O(1)–O(depth)), while a structural check is a potentially expensive recursive, coinductive comparison that compilers must *memoize* to terminate on recursive types.

The payoff is practical. Variance explains why `List<Dog>` is not a `List<Animal>` in a sound language, why TypeScript's array and method-parameter handling is deliberately unsound, and why structural function compatibility uses contravariant parameters. Row polymorphism explains how OCaml objects and "open record" types achieve "this row plus extra fields" without losing precision. And the implementation view explains the cost models — why structural type-checking of deeply recursive types needs cycle detection, and why nominal systems give O(1) "same type?" comparisons that structural systems can't.

> 🎓 **Why this matters at the senior level:** You design the type-level contracts a team builds on for years. Choosing nominal vs structural (or where to brand) determines whether API evolution is *enforced* or *silent*, whether refactors are *checked* or *trust-based*, and whether your hot type-checking path is cheap (nominal) or needs memoization (structural). You also need to know exactly where each system is unsound so you don't lean on a guarantee the compiler never actually made.

This page covers: subtyping as inference rules, width/depth formalized, variance (co/contra/in/bivariance) with the function and array cases, row polymorphism, structural recursion and coinduction, how compilers implement each check, and the API-evolution and performance consequences.

---

## Prerequisites

- **Required:** Middle-tier content — subtyping `S <: T`, width/depth, method sets, newtypes, branded types.
- **Required:** Generics and parametric polymorphism in a real language.
- **Required:** The idea that a function type is `(Args) -> Ret`.
- **Helpful:** Having reasoned about covariance/contravariance even informally ("arrays of subtypes").
- **Helpful:** Exposure to OCaml objects/polymorphic variants or Scala structural types.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Subtyping rule** | An inference rule of the form "premises ⊢ `S <: T`" defining when subtyping holds. |
| **Covariance** | Subtyping preserved: if `A <: B` then `F<A> <: F<B>`. Safe for read-only/output positions. |
| **Contravariance** | Subtyping flipped: if `A <: B` then `F<B> <: F<A>`. Correct for input/parameter positions. |
| **Invariance** | Neither direction; `F<A> <: F<B>` only if `A = B`. Required for mutable containers. |
| **Bivariance** | Both directions allowed — generally **unsound**; TS uses it in places for ergonomics. |
| **Variance position** | Where a type appears (return = covariant/output, parameter = contravariant/input) determining required variance. |
| **Row polymorphism** | Typing "a record with these fields *and possibly more*" via a row variable, giving precise open records. |
| **Coinductive subtyping** | Subtyping over (possibly infinite/recursive) types proven by assuming the goal and checking for contradiction — needs cycle detection. |
| **Coherence** | The property that there is at most one way a type satisfies a constraint/trait (relevant to nominal trait systems). |
| **Liskov Substitution Principle (LSP)** | Behavioral substitutability; subtyping's semantic counterpart. |
| **Nominal opacity** | A nominal type can *hide* its representation; structural types expose it (the shape *is* the interface). |

---

## Core Concepts

### 1. Subtyping as Inference Rules

Reflexivity and transitivity hold in both systems:

```
———————  (S-Refl)        S <: U   U <: T
T <: T                   ————————————————  (S-Trans)
                             S <: T
```

**Nominal subtyping** adds exactly one source of new edges — declaration:

```
class S extends T   (or S implements T, impl T for S)
———————————————————————————————————————————————  (S-Nom)
                  S <: T
```

There is *no other rule*. If `S <: T` cannot be derived from S-Refl, S-Trans, and the declared S-Nom edges, it does not hold. That's why structurally identical, undeclared types are incompatible.

**Structural subtyping** for records adds width and depth as rules:

```
{ l_i : T_i  (i ∈ 1..n+k) }  <:  { l_i : T_i  (i ∈ 1..n) }     (S-Width)

for each i:  S_i <: T_i
———————————————————————————————————————————  (S-Depth)
{ l_i : S_i }  <:  { l_i : T_i }
```

Width says "more fields is a subtype"; depth says "pointwise-subtype fields is a subtype." A structural system has these rules *instead of* (or in addition to) declaration edges.

### 2. Variance: Where Soundness Lives

Variance governs how subtyping moves through type constructors. Get it wrong and the type system lies.

**Functions are contravariant in parameters, covariant in returns:**

```
T1 <: S1     S2 <: T2
—————————————————————————  (S-Fn)
(S1 -> S2)  <:  (T1 -> T2)
```

Read it carefully: a function is a subtype if it accepts *more* (its parameter type is a *supertype*) and returns *less* (its return type is a *subtype*). A `(Animal) -> Dog` is a subtype of `(Dog) -> Animal`: it handles any `Dog` you pass (since it handles all `Animal`s) and its `Dog` result is a valid `Animal`. This contravariant-parameter rule is *the* place structural function compatibility is subtle.

**Mutable containers must be invariant.** If `Array<Dog> <: Array<Animal>` were allowed, you could write a `Cat` into an `Array<Animal>` alias of an `Array<Dog>` — a heap corruption. Sound languages make mutable generics invariant (Java arrays are a famous unsound exception: covariant arrays throw `ArrayStoreException` at *runtime* to patch the hole). TypeScript deliberately makes arrays covariant and method parameters bivariant for ergonomics, accepting unsoundness.

### 3. Row Polymorphism: Precise Open Records

Plain width subtyping loses information: once you up-cast `{x, y}` to `{x}`, you've forgotten `y`. **Row polymorphism** keeps it with a *row variable* `ρ` standing for "the rest of the fields":

```
{ x : int | ρ }
```

A function `fun r -> r.x` can be typed `{ x : int | ρ } -> int` for *any* `ρ`, so it accepts any record containing an `int x` *and preserves* the other fields in the result type. OCaml objects, PureScript records, and Elm extensible records use this. It's the principled foundation under structural typing: structural subtyping is roughly row polymorphism with the row existentially hidden. Senior insight: row polymorphism is often *more* expressive than subtyping because it never throws away the extra fields.

### 4. Structural Checks Are Coinductive

Consider mutually recursive structural types:

```
type A = { next: B }
type B = { next: A }
```

Checking `A <: A'` for similarly-shaped `A'`/`B'` requires checking `B <: B'`, which requires `A <: A'` again — an infinite regress under naive induction. The correct treatment is **coinductive**: assume `A <: A'` while proving it, and only fail on an actual mismatch. Implementations realize this with a *memo set* of "currently assumed" pairs; revisiting a pair means "assume true." Without this, the checker loops forever on recursive types. Nominal checks don't face this because the answer is a finite ancestry walk on declared edges.

### 5. How Compilers Implement Each Check

**Nominal.** Each type carries a stable identity (a symbol/handle) and a precomputed set or chain of ancestors. `S <: T` is: pointer-equal identities, or `T` ∈ ancestors(`S`). This is O(1) with a precomputed superclass bitset (or a few pointer hops). "Are these the same type?" is a pointer comparison. Subtype tests can be made O(1) with techniques like Cohen's display or interval/relative numbering of the inheritance tree.

**Structural.** `S <: T` recursively compares members, recursing into field/param/return types, with the coinductive memo set above. Cost is proportional to the size of the types compared, and pathological generic instantiations can blow up — which is why TypeScript caches relation results aggressively and has instantiation-depth limits to keep the checker from hanging. There is no O(1) "same type" — identity itself is structural.

**Consequence:** nominal systems get cheap identity and cheap subtype tests; structural systems pay with recursive comparison and need memoization/caching to stay tractable and even to terminate.

### 6. Nominal Opacity vs Structural Transparency

A nominal type can be **opaque**: `newtype UserId = UserId Int` hides that it's an `Int`; clients can't rely on the representation, so you can change it later. A structural type is **transparent**: its shape *is* its interface, so the representation is part of the public contract and harder to evolve. This is a deep API-design lever — nominal opacity buys you representation independence; structural transparency buys you instant interoperability. Branded types in TS are an attempt to buy opacity back inside a transparent system.

---

## Real-World Analogies

**Contravariant parameters = "a more capable contractor."** A contractor who can repair *any* vehicle is a valid substitute for one hired to repair *only sedans* (accepts more — contravariant input), and if they always deliver a *premium* finish, that's a fine substitute for "any finish" (covariant output).

**Invariant mutable box = "a labeled storage bin."** A bin labeled "dogs only" can't be relabeled "animals" and shared, or someone drops a cat in and the dog-only invariant breaks. Mutability forces invariance.

**Row variable = "and the rest."** A form that says "fill in your name, plus keep whatever else is on the page" — it processes the field it needs while preserving everything else untouched. That "whatever else" is the row variable.

**Memoized coinduction = "assume the loop closes."** Proving two infinite mirror-corridors match: you assume they match, walk one step, and only stop if you ever see a difference — otherwise the assumption stands.

---

## Mental Models

**Model 1 — "Variance is positional."** Output positions (returns, read-only fields) are covariant; input positions (parameters, write targets) are contravariant; read-write positions are invariant. Read a type signature and tag each position; that predicts legal assignments.

**Model 2 — "Structural identity is recursive; nominal identity is a pointer."** This single fact explains the cost models, the recursion/termination concerns, and why nominal gives free fast equality.

**Model 3 — "Row polymorphism > width subtyping when you must preserve the rest."** If a function should pass through unknown fields, you want a row variable, not an up-cast that forgets them.

**Model 4 — "Soundness holes are deliberate ergonomics."** TS covariant arrays, TS bivariant method params, Java covariant arrays — each trades a soundness guarantee for convenience, paying with a runtime check or a silent risk. Know which guarantee you *don't* have.

---

## Code Examples

### Variance you can feel (Scala, declared variance)

```scala
class Box[+A](val value: A)          // +A: covariant (read-only ⇒ safe)
val dogBox: Box[Dog]    = new Box(new Dog)
val animalBox: Box[Animal] = dogBox  // ✅ covariance: Box[Dog] <: Box[Animal]

// A mutable cell must be invariant:
class Cell[A](var value: A)          // invariant
val dc: Cell[Dog] = new Cell(new Dog)
// val ac: Cell[Animal] = dc         // ❌ rejected — would allow writing a Cat
```

### Function contravariance in a structural system (TypeScript)

```typescript
type Handler<T> = (x: T) => void;

let handleAnimal: Handler<Animal> = (a) => {};
let handleDog: Handler<Dog>;

handleDog = handleAnimal;   // ✅ (Animal)->void <: (Dog)->void  (contravariant param)
// handleAnimal = handleDog; // strictFunctionTypes: ❌ a Dog handler can't take any Animal
```

With `strictFunctionTypes`, TS uses proper contravariance for standalone function types — but *method* syntax remains bivariant for legacy reasons (next section).

### The bivariance soundness hole (TypeScript)

```typescript
interface EventSource<T> {
    handle(cb: (e: T) => void): void;   // METHOD syntax → bivariant params
}
declare let animalSrc: EventSource<Animal>;
let dogSrc: EventSource<Dog> = animalSrc;   // ✅ allowed (bivariant) but UNSOUND:
// dogSrc.handle expects (Dog)=>void, but animalSrc may invoke cb with any Animal
```

This is accepted for ergonomic reasons and is genuinely unsound; standalone function-typed properties (not method shorthand) get the sound contravariant check under `strictFunctionTypes`.

### Row polymorphism (OCaml objects)

```ocaml
(* Accepts ANY object with an x:int method, returns it unchanged.
   The '..' is the row variable: "x:int and possibly more". *)
let get_x (o : < x : int; .. >) = o#x

let p = object method x = 3 method y = 4 end
let _ = get_x p   (* ✅ p has x (and y); the row absorbs y *)
```

### Coinductive structural check (illustration)

```typescript
// Mutually recursive structural types — the checker assumes the goal
// while proving it, using a memo set, to avoid infinite recursion.
type Node = { value: number; next: Node | null };
type Link = { value: number; next: Link | null };

declare const n: Node;
const l: Link = n;   // ✅ structurally identical; proven coinductively
```

### Nominal opacity enabling representation change (Haskell)

```haskell
newtype UserId = UserId Int          -- representation hidden behind the constructor
-- Later you can change it to:
-- newtype UserId = UserId Text
-- ...without breaking clients that only use the exported smart constructor/getters.
```

---

## Pros & Cons

### Nominal (formal/implementation lens)

| Pros | Cons |
|------|------|
| O(1) identity and fast subtype tests (ancestry walk / bitset). | Expressiveness recovered only via generics + bounds + variance annotations. |
| Representation opacity → safe API evolution. | Declaration overhead; no retroactive conformance. |
| No recursion/termination concerns in the checker. | Variance often must be declared explicitly (Scala `+/-`, C# `in/out`). |
| Coherence achievable (one canonical conformance). | Adapters needed to bridge foreign types. |

### Structural (formal/implementation lens)

| Pros | Cons |
|------|------|
| Width/depth + row polymorphism → precise, flexible, retroactive. | Recursive, coinductive checking; needs memoization to terminate and stay fast. |
| No identity bookkeeping; types are their shapes. | No O(1) identity; relation caching essential at scale. |
| Foreign types conform for free. | Representation is the contract → harder to evolve safely. |
| Natural fit for data/JSON and open records. | Soundness corners (bivariance, covariant arrays) leak in for ergonomics. |

---

## Use Cases

- **Variance-correct generic APIs.** A producer (`Iterator<+T>`/`out T`) is covariant; a consumer (`Comparator<-T>`/`in T`) is contravariant. Designing these correctly is senior-level type design.
- **Row-polymorphic middleware.** Functions that augment a context object (`{ ...ctx, user }`) while preserving unknown fields want row types, not lossy up-casts.
- **Opaque domain types.** Wrap representations (money, IDs, tokens) nominally so you can change the internal format without breaking clients.
- **Performance-sensitive type-checking.** Massive structural codebases (large TS monorepos) rely on relation caching; understanding the cost model guides how you structure types to keep builds fast.

---

## Coding Patterns

**Pattern: declare variance explicitly where the language allows it** (`out T`/`in T` in C#, `+A`/`-A` in Scala) so the compiler enforces safe substitution.

**Pattern: prefer row polymorphism / generics-with-rest over width up-casts** when downstream code must retain unknown fields.

**Pattern: opaque module boundary (nominal).** Export a type and constructors but not its representation, so clients are structurally blind to internals and you keep evolution freedom.

```typescript
// opaque-id.ts
declare const tag: unique symbol;
export type Id = string & { [tag]: "Id" };   // representation hidden from importers
export const Id = (s: string): Id => s as Id;
```

**Pattern: structural assertion at boundaries, nominal core.** Validate/parse untyped input structurally at the edge, then brand into nominal domain types for the interior.

---

## Best Practices

1. **Annotate variance deliberately.** Default to invariance for anything mutable; make pure producers covariant and pure consumers contravariant.
2. **Don't trust a soundness guarantee the language doesn't make.** Know that TS arrays are covariant and method params bivariant; Java arrays are covariant with runtime checks.
3. **Use opacity for evolvability.** If a type's representation might change, hide it behind a nominal/opaque boundary now.
4. **Prefer row polymorphism for pass-through.** It preserves precision that width subtyping discards.
5. **Structure types to keep structural checking cheap.** Avoid gratuitously deep/recursive generic instantiations that stress the relation cache; name and reuse types so the checker memoizes them.
6. **Make conformance explicit even in structural Go** (`var _ Iface = (*T)(nil)`) so API evolution breaks loudly.
7. **Treat representation changes of a structural public type as breaking.** Its shape is its contract.

---

## Edge Cases & Pitfalls

**1. Covariant-array unsoundness.** `Animal[] a = dogArray; a[0] = new Cat();` compiles in Java/TS. Java throws `ArrayStoreException` at runtime; TS silently corrupts. The variance hole is patched (Java) or unpatched (TS).

**2. Method-bivariance hole in TS.** Method-shorthand parameters are compared bivariantly even under `strict`, so a `EventSource<Dog>` can alias a `EventSource<Animal>` unsoundly. Use function-property syntax to get the sound contravariant check.

**3. Infinite structural recursion without memoization.** A naive structural checker on mutually recursive types loops forever. Real compilers memoize "assumed" pairs; if you write your own type comparison, you must too.

**4. Width subtyping discards information.** Up-casting `{a, b}` to `{a}` forgets `b`; a later down-cast can't recover it soundly. Where pass-through matters, you needed a row variable, not a subtype.

**5. Structural equality of generics is by instantiation, not declaration.** `Box<string>` and an identical structural `Container<string>` may be interchangeable structurally even though they're "different" generics — surprising if you expected nominal separation.

**6. Coherence vs. structural multiplicity.** Nominal trait systems can enforce a single canonical conformance (coherence); structural systems can't easily say "there's one true way `T` is a `Monoid`," which matters for typeclass-style abstractions (expanded in `professional.md`).

**7. Opacity leaks through inference.** A branded/opaque type can leak its base representation through type inference or `typeof` in subtle ways; verify the boundary actually hides what you think it does.

---

## Summary

- Subtyping is defined by **inference rules**: nominal adds edges *only* via declaration (S-Nom); structural adds **width** and **depth** rules over members.
- **Variance** is where soundness lives: functions are **contravariant in parameters, covariant in returns**; mutable containers must be **invariant**. TS arrays (covariant) and TS method params (bivariant) are deliberate, documented soundness holes; Java arrays are covariant with runtime `ArrayStoreException`.
- **Row polymorphism** gives precise open records ("these fields and possibly more") and is often more expressive than width subtyping because it never discards the rest.
- Structural subtyping over recursive types is **coinductive** and requires a memo set to terminate; nominal checks are a finite ancestry walk.
- **Implementation:** nominal = O(1) identity + cheap ancestry subtype tests; structural = recursive member comparison needing aggressive relation caching to stay tractable.
- **Nominal opacity** enables safe API evolution (hide the representation); **structural transparency** makes the shape the public contract, easing interop but constraining evolution.

The professional tier turns this into real-codebase engineering: Rust trait coherence and orphan rules, hybrid system design, migration strategies, and choosing the model (and where to brand) for a long-lived system.
