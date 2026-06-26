# Dependent & Refinement Types — Middle Level

> **Topic:** [Dependent & Refinement Types](README.md)
> **Focus:** How these types actually *work* — Pi and Sigma types, how refinement predicates get discharged by an SMT solver, and the precise machinery of `Vec n a` and length-indexed programming.

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
14. [Further Reading](#further-reading)

---

## Introduction

> Focus: **The junior tier gave you the intuition. Now we open the box: the type-theory primitives (Pi, Sigma), and the two checking strategies (manual proof vs. SMT discharge).**

At the junior level you learned the slogan: refinement types are "a base type plus a predicate," dependent types are "a type that mentions a value." That's true, but it's a black box. This tier explains the *mechanism*.

There are two big things to understand:

1. **The type-theory core.** Dependent types are built from two primitives that generalize the function type and the pair type you already know. The *dependent function type* (the **Pi type**, `Π`) generalizes `A -> B` to the case where the *return type depends on the argument value*. The *dependent pair type* (the **Sigma type**, `Σ`) generalizes the pair `(A, B)` to the case where the *type of the second component depends on the first*. Almost everything in a dependently typed language is one of these two, and once you see them, `Vec n a` and friends stop being magic.

2. **The two checking regimes.** When a type carries a proposition ("this index is in range," "this vector has length n+m"), *something* has to verify it. There are two strategies, and the whole engineering character of a tool depends on which it uses:
   - **Manual / interactive proof** (Idris, Agda, Coq, Lean): you, the programmer, supply evidence the checker validates. Maximal power, real effort.
   - **Automatic SMT discharge** (Liquid Haskell, F\*, Dafny): the tool emits a logical *verification condition* and hands it to an SMT solver (typically Z3), which says "valid" or "here's a counterexample." Less manual labor, but bounded by what the solver can decide.

This tier makes both concrete. We'll trace how a refinement like `{v: Int | 0 <= v < len arr}` becomes a logical formula the solver checks, and how `append : Vec n a -> Vec m a -> Vec (n+m) a` forces the *implementation* to be length-correct.

> 🎓 **Why this matters at the middle level:** You can't choose the right tool — or read its error messages — without knowing whether it proves things by SMT or by hand. "Liquid Haskell rejected my code" and "Agda rejected my code" are *very* different situations requiring different fixes. This tier gives you the vocabulary to tell them apart.

---

## Prerequisites

- **Required:** The junior tier of this topic — refinement vs. dependent, `Vec n a`, the basic examples.
- **Required:** Comfort with generics / parametric polymorphism (`forall a. List a -> List a`).
- **Required:** Familiarity with algebraic data types (sum and product types) and pattern matching.
- **Helpful:** Basic propositional and first-order logic notation (`∀`, `∃`, `∧`, `=>`). We'll keep it light.
- **Helpful:** Having written a recursive function over a list. Length-indexed code is recursion with the lengths tracked.

You do **not** need: a course in type theory, the internals of Z3, or the Curry–Howard correspondence in full (that's `senior.md`).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Pi type (`Π`, dependent function)** | A function type `(x : A) -> B(x)` where the **return type `B` depends on the argument value `x`**. Generalizes `A -> B`. |
| **Sigma type (`Σ`, dependent pair)** | A pair type `(x : A) ** B(x)` where the **type of the second component depends on the first value `x`**. Generalizes `(A, B)`. |
| **Index (of a type)** | A value parameter that varies the type, e.g. the `n` in `Vec n a`. The type is *indexed by* `n`. |
| **Parameter (of a type)** | A value/type the family is fixed over, vs. an index that varies per constructor. `a` in `Vec n a` is a parameter; `n` is an index. |
| **Verification condition (VC)** | A logical formula a tool generates whose validity implies the program is safe. Fed to the SMT solver. |
| **SMT solver** | "Satisfiability Modulo Theories" — e.g. Z3, CVC5. Decides validity of formulas over arithmetic, arrays, etc. |
| **Decidable theory** | A logic fragment the solver can always answer (e.g. linear integer arithmetic). Predicates here are "SMT-friendly." |
| **Discharge** | To prove a verification condition (usually automatically, via the solver). |
| **Refinement** | `{ v: b \| p }` — base type `b` plus predicate `p` over `v`. The set of `b`-values satisfying `p`. |
| **Subtyping (refinement)** | `{v:b \| p}` is a subtype of `{v:b \| q}` when `p => q`. The solver checks the implication. |
| **Type family** | A type parameterized by indices, like `Vec : Nat -> Type -> Type`. `Vec 3 Int` is one member. |
| **`Nat` / `S` / `Z`** | Natural numbers built as `Z` (zero) and `S k` (successor of `k`). `3` is `S (S (S Z))`. |
| **Erasure** | Removing index/proof information before runtime, so dependent types cost nothing at runtime. |
| **Totality** | A function that is defined on all inputs and provably terminates (covered fully in senior). |

---

## Core Concepts

### 1. The Pi type: dependent functions

You know the ordinary function type `A -> B`: give an `A`, get a `B`, and `B` is fixed regardless of *which* `A` you passed. The **Pi type** relaxes that: the result type may *depend on the input value*.

Notation (Idris-ish): `(x : A) -> B x`. Read: "for an `x` of type `A`, return something of type `B x`," where `B x` can be a *different type for different `x`*.

The canonical example:

```idris
-- replicate n x : a vector of length n, all equal to x.
-- The RETURN TYPE Vec n a depends on the ARGUMENT VALUE n.
replicate : (n : Nat) -> a -> Vec n a
replicate Z     x = []
replicate (S k) x = x :: replicate k x
```

Here `n` is a *value* argument, and the return type `Vec n a` *mentions* that value. `replicate 3 'a'` has type `Vec 3 Char`; `replicate 5 'a'` has type `Vec 5 Char`. **Different argument values produce different return types.** That is exactly what an ordinary `A -> B` cannot express, and exactly what makes the type dependent.

The ordinary function type `A -> B` is just the special case of a Pi type where `B` happens not to mention `x`. So `Π` *generalizes* `->`; it doesn't replace your intuition, it extends it.

### 2. The Sigma type: dependent pairs

You know the pair `(A, B)`: a value of type `A` and a value of type `B`, independent. The **Sigma type** relaxes that: the *type* of the second component may depend on the *value* of the first.

Notation (Idris-ish): `(x : A ** B x)`. Read: "a pair where the first is an `x : A`, and the second has type `B x`."

The killer use: **packaging a value with a type that depends on it.** Suppose you want a function that filters a vector but can't know the output length statically — the length depends on the data. You return a Sigma:

```idris
-- Return SOME length k, paired with a vector of exactly that length.
filterVec : (a -> Bool) -> Vec n a -> (k : Nat ** Vec k a)
```

The result is a pair: a number `k` (the resulting length) and a `Vec k a` (a vector of exactly that length). The vector's *type* depends on the *value* `k` sitting next to it. This is how dependently typed code handles "length not known until runtime" — it pairs the unknown length with a vector indexed by it.

Sigma also encodes **existence**: "there exists an `x` such that `P x`" is exactly a pair of an `x` and evidence of `P x`. That bridge to logic is the senior tier's Curry–Howard story.

### 3. Indices vs. parameters

In `Vec n a`, both `n` and `a` decorate the type, but they play different roles:

- `a` is a **parameter**: every constructor of `Vec` uses the *same* `a`. The family is uniform in `a`.
- `n` is an **index**: different constructors give *different* `n`. The empty constructor produces `Vec 0 a`; `cons` produces `Vec (S k) a` from a `Vec k a`.

```idris
data Vec : Nat -> Type -> Type where
  Nil  : Vec Z a                       -- constructs length 0
  (::) : a -> Vec k a -> Vec (S k) a   -- constructs length k+1 from length k
```

Read the constructors as *facts about lengths*. `Nil` is the only way to make a `Vec Z`, and `(::)` is the only way to grow the length by one. So when you pattern-match a `Vec (S k)`, the type system *knows* it can't be `Nil` — the `Nil` case is impossible and you don't have to handle it. **That impossibility is the whole safety mechanism for `head`.**

### 4. How a refinement type gets checked: the VC pipeline

Refinement types don't ask you to prove anything by hand. Here's the actual pipeline (Liquid Haskell / F\* / Dafny all follow this shape):

1. **You annotate.** You write `{-@ get :: a:Array b -> {i:Int | 0 <= i && i < alen a} -> b @-}`.
2. **The tool walks your code** and, at each point where a refined value is *used* or *produced*, generates a **verification condition** — a logical formula that must be valid for the program to be safe.
3. **The VC is shipped to an SMT solver** (Z3). For a call `get arr j`, the VC is roughly: *given everything known about `j` at this point, does `0 <= j && j < alen arr` hold?*
4. **The solver answers** `valid` (✅ safe) or `invalid` with a **counterexample** (❌, e.g. "consider `j = alen arr`").

The crucial property: **subtyping is logical implication, checked by the solver.** `{v | p}` can be used where `{v | q}` is expected exactly when `p => q` is valid. So flowing a `{v | v > 5}` into a slot wanting `{v | v > 0}` works because `v > 5 => v > 0` — and the solver confirms it. No proof from you.

This is why refinement types feel "automatic": you describe *what* must hold, and the solver does the *reasoning*. The price is that the solver only reasons within **decidable theories** — linear integer arithmetic, equality, arrays, uninterpreted functions. Step outside (nonlinear arithmetic, unbounded quantifiers) and it may time out or fail on facts that are actually true.

### 5. How a dependent type gets checked: definitional equality

In a full dependent language, there's no SMT solver doing arithmetic for you. Instead the checker relies on **computation and definitional equality**. When you write `append : Vec n a -> Vec m a -> Vec (n + m) a`, the checker must confirm that the *result* of your implementation has length `n + m`. It does this by *reducing* type-level expressions:

```idris
append : Vec n a -> Vec m a -> Vec (n + m) a
append []        ys = ys           -- here n = 0, so n+m reduces to m; ys : Vec m a ✅
append (x :: xs) ys = x :: append xs ys
  -- here n = S k. The recursive call : Vec (k + m) a.
  -- (::) makes it Vec (S (k + m)) a.
  -- Required: Vec (S k + m) a. And S k + m REDUCES to S (k + m). ✅
```

The checker *computes* `S k + m` using the definition of `+` and finds it equal to `S (k + m)`. That equality is *definitional* — it falls out of evaluation. When the two sides reduce to the same normal form, the type checks. When they don't reduce to the same thing automatically (e.g. you need `n + m = m + n`, which is *not* definitional), you must supply a **proof** — and that's where dependent typing gets laborious. The senior tier covers writing such proofs.

**This is the core contrast.** Refinement: VC → SMT solver → automatic. Dependent: type-level computation + (when needed) hand-written proofs. The first is more automatic but bounded by the solver; the second is unbounded in power but bounded by your patience.

### 6. Erasure: dependent types are (mostly) free at runtime

A natural worry: if `Vec 3 Int` carries the number `3`, does that `3` cost memory and CPU at runtime? Usually **no**. The index `n` is used only by the *type checker*; once checking succeeds, the compiler **erases** it. A `Vec 3 Int` runs as a plain array; the length proof has no runtime footprint. (Idris is explicit about erasure; you can mark arguments erased.) So you pay at compile time, not at run time — which is exactly the trade you want.

---

## Real-World Analogies

**Pi type = a vending machine whose output slot reshapes itself.** A normal machine always dispenses a can-shaped thing. A "dependent" machine reads your selection (a *value*) and the *shape of the output slot itself changes* to match — pick "umbrella" and an umbrella-shaped slot appears. The output *type* depends on the input *value*.

**Sigma type = a labeled evidence bag.** You bag an item *together with* the paperwork proving a fact about it. The paperwork's content depends on the item: a "weight ≤ 5kg" certificate only makes sense alongside the specific package it certifies. Inseparable pair: value + value-dependent evidence.

**SMT discharge = an automated building inspector.** You file a permit stating "this beam holds 2 tons." An automated inspector checks the structural math and stamps APPROVED or hands back a specific load case that fails. You didn't compute the structural analysis; you *stated the claim* and the inspector *verified* it — within the building codes it knows. Outside those codes (an exotic material), it shrugs.

**Definitional equality = a calculator that simplifies both sides.** To check `2 + 3 = 5` you don't prove it; you *evaluate* both sides and see `5 = 5`. The dependent checker does the same with type-level arithmetic — when both sides compute to the same normal form, done. When they don't auto-simplify (like `n + m` vs `m + n`), you must show your work.

---

## Mental Models

**1. Π generalizes `->`, Σ generalizes `(,)`.** Don't memorize new things — *extend* the two you know. A Pi type is "a function whose return type can read the argument's value." A Sigma type is "a pair whose second type can read the first value." Every dependent type you meet is built from these.

**2. Constructors are facts; pattern-matching unlocks them.** `Nil : Vec Z a` is the fact "Nil has length 0." When you match and see `(::)`, the checker *learns* the length is `S k`, and that learned fact rules out impossible cases. Dependent matching is a conversation where each branch teaches the type checker something.

**3. Two engines, two failure modes.** SMT engine fails with "couldn't prove this VC; here's a counterexample (or a timeout)." Definitional-equality engine fails with "these two types don't reduce to the same thing; give me a proof." Knowing which engine you're fighting tells you whether to *strengthen a refinement* or *write a proof term*.

**4. The index lives at compile time and dies at erasure.** Think of `n` in `Vec n a` as a ghost the checker sees and the runtime doesn't. It guides verification, then vanishes. Correctness without runtime cost.

**5. Refinement = set comprehension on types.** `{v: Int | p}` is literally "the subset of `Int` where `p` holds." Subtyping is subset inclusion, and the solver decides inclusion via implication. If you think "sets and implications," refinement typing demystifies.

---

## Code Examples

### Example 1: A safe `index` via Pi + a bound (Idris)

```idris
-- Fin n : a number STRICTLY LESS THAN n. Its type guarantees in-range-ness.
-- index takes a Fin n, so it can NEVER be out of bounds for a Vec n a.

index : Fin n -> Vec n a -> a
index FZ     (x :: xs) = x
index (FS k) (x :: xs) = index k xs
-- No Nil cases needed: a Fin n requires n >= 1, so the vector is non-empty.

v : Vec 3 Int
v = [10, 20, 30]

-- 0,1,2 are valid Fin 3 values; there is NO Fin 3 value equal to 3.
x = index 2 v        -- ✅ 30
-- index 3 v          -- ❌ no such Fin 3; out-of-bounds is unconstructable
```

`Fin n` is a dependent type encoding "a valid index into something of size `n`." Out-of-range indexing isn't checked at runtime — it can't be *written*.

### Example 2: A Sigma to return a runtime-determined length (Idris)

```idris
-- filter can't know the output length statically, so it returns it in a Sigma.
filter : (a -> Bool) -> Vec n a -> (k ** Vec k a)
filter p [] = (0 ** [])
filter p (x :: xs) =
  let (k ** rest) = filter p xs in
  if p x then (S k ** x :: rest)   -- length grew by 1, tracked in the type
         else (k    ** rest)

-- Caller pattern-matches to recover both the length and the vector:
demo : (k ** Vec k Int)
demo = filter (> 1) [1, 2, 3]      -- yields (2 ** [2, 3])
```

### Example 3: Refinement subtyping discharged by SMT (Liquid Haskell)

```haskell
{-@ type Pos = {v:Int | v > 0} @-}
{-@ type Nat = {v:Int | v >= 0} @-}

{-@ usePos :: Pos -> Int @-}
usePos x = x

{-@ p :: Pos @-}
p = 7

-- Pos is a subtype of Nat because (v > 0) => (v >= 0), which Z3 confirms:
{-@ asNat :: Nat @-}
asNat = p                  -- ✅ implication holds

{-@ bad :: Pos @-}
bad = 0                    -- ❌ Z3 refutes 0 > 0
```

### Example 4: A refinement that constrains a relationship (Liquid Haskell)

```haskell
-- The output's refinement RELATES to the input — a richer VC for Z3.
{-@ incr :: x:Int -> {v:Int | v = x + 1} @-}
incr :: Int -> Int
incr x = x + 1             -- ✅ Z3 checks (x + 1) = (x + 1)

{-@ bug :: x:Int -> {v:Int | v = x + 1} @-}
bug x = x + 2              -- ❌ Z3 refutes (x + 2) = (x + 1)
```

### Example 5: Where definitional equality runs out — needing a `rewrite` (Idris, sketch)

```idris
-- reverse on vectors: appending in the recursive step yields n + 1,
-- but the spec wants 1 + n. These are NOT definitionally equal for variable n,
-- so the programmer must REWRITE using a proof that n + 1 = 1 + n.

reverse : Vec n a -> Vec n a
reverse []        = []
reverse (x :: xs) = rewrite plusCommutative ... in (reverse xs ++ [x])
-- The `rewrite` injects a proof to make the lengths line up.
-- This is the manual-proof cost that refinement types avoid.
```

This is the line where dependent typing stops being free: the checker couldn't auto-prove the length arithmetic, so *you* had to hand it a proof. An SMT-based refinement tool would have handled `n + 1 = 1 + n` automatically.

---

## Pros & Cons

### Pros

| Benefit | Why it matters |
|---------|----------------|
| **Pi/Sigma unify a lot** | Functions, pairs, existentials, and indexed data all come from two primitives. |
| **SMT discharge is hands-off** | For arithmetic/array predicates, you state and the solver proves. |
| **Erasure = zero runtime cost** | Indices and proofs vanish after checking; runtime is plain data. |
| **Precise specs as types** | `Vec (n+m)` and `{v | v=x+1}` are machine-checked contracts. |
| **Impossible cases drop out** | Indexed matching removes branches you'd otherwise have to handle. |

### Cons

| Cost | Why it hurts |
|------|--------------|
| **SMT is bounded** | Outside decidable theories it times out or fails on true facts. |
| **Definitional equality runs out** | Non-trivial arithmetic identities need hand-written `rewrite`/proofs. |
| **VC blowup** | Rich refinements can generate large, slow-to-solve VCs. |
| **Two skill sets** | Refinement debugging ≠ proof debugging; you must know which engine you face. |
| **Erasure subtleties** | Getting "free at runtime" right sometimes needs explicit erasure annotations. |

---

## Use Cases

- **Provably in-range indexing** with `Fin n` (dependent) or `{i | 0 <= i < len}` (refinement).
- **Length-preserving / length-relating operations** (`map`, `zip`, `append`, `reverse`) with the relationship in the type.
- **Boundary refinement of parsed input** so downstream code is guarded automatically.
- **Returning runtime-sized results safely** via Sigma types (filter, partition, decode).
- **Verification of arithmetic-heavy code** (offsets, sizes, capacities) where SMT shines.

---

## Coding Patterns

**1. Index your data structures.** Reach for `Vec n a`, `Fin n`, length-indexed trees when the size relationships are the source of bugs.

**2. Sigma at the dynamic boundary.** When a length is only known at runtime, pair it (`(k ** Vec k a)`) and pattern-match to recover both pieces.

**3. State relational refinements, not just unary ones.** `{v | v = x + 1}` (relates output to input) catches more than `{v | v > 0}` and is still SMT-friendly.

**4. Keep predicates in the decidable fragment.** Prefer linear arithmetic, equalities, and array axioms; avoid multiplication of two variables and nested quantifiers when you can.

**5. Reach for proofs only at the equality gap.** When the checker won't auto-reduce two type expressions, that's the signal to write a `rewrite`/lemma — not before.

---

## Best Practices

- **Pick the tool by checking regime.** Need heavy arithmetic with little manual proof? Refinement (Liquid Haskell, F\*, Dafny). Need to express and prove deep invariants? Dependent (Idris, Agda, Coq, Lean).
- **Make refinements as tight as the property, no tighter.** Over-strong refinements create VCs the solver can't discharge and friction you don't need.
- **Read counterexamples literally.** When Z3 says "consider `i = len arr`," it's handing you the exact missing precondition.
- **Localize proof obligations.** Push `rewrite`/lemmas to small helper functions so the rest of the code stays readable.
- **Trust erasure but verify it.** If runtime performance matters, confirm indices/proofs are actually erased, not accidentally retained.
- **Specify the relationship, then implement.** Write the Pi/Sigma signature first; let it drive (and check) the body.

---

## Edge Cases & Pitfalls

- **Definitionally-equal vs. propositionally-equal.** `2 + 3` and `5` are *definitionally* equal (auto). `n + m` and `m + n` are only *propositionally* equal (needs a proof). Confusing the two is the #1 source of "why won't this typecheck?"
- **SMT timeouts masquerade as errors.** A failing VC might be *true* but outside the solver's reach. Reformulate into linear arithmetic, or add an intermediate assertion to guide it.
- **Refinement laundering.** Casting a refined value through an unrefined type (e.g. via a generic container) drops the guarantee silently.
- **Index erasure gotchas.** If you actually *need* the length at runtime (`replicate n`), it can't be erased — it must be a genuine runtime argument, not just an index.
- **VC explosion from inlining.** Highly polymorphic or higher-order refined code can produce VCs the solver chokes on; sometimes you must annotate intermediate steps.
- **Pattern-match coverage with indices.** When the index rules out a constructor, some tools require you to *acknowledge* the impossible case (`impossible` in Idris) rather than silently omit it.
- **A precise wrong spec.** SMT and proofs verify code against *types*; if the refinement encodes the wrong invariant, you've precisely enforced a bug.

---

## Summary

Dependent types are built from two primitives that generalize tools you already know: the **Pi type** (`(x:A) -> B x`) is a function whose *return type depends on the argument value*, and the **Sigma type** (`(x:A ** B x)`) is a pair whose *second type depends on the first value*. From these come `replicate`, `Fin n`, length-indexed `Vec`, and the ability to return runtime-sized results. **Indices** (like `n` in `Vec n a`) vary the type per constructor, so pattern-matching *learns facts* and impossible cases drop out — that's why `head`/`index` can't go out of bounds. The two checking regimes define the engineering experience: **refinement types** emit **verification conditions** to an **SMT solver** (automatic but bounded by decidable theories), while **dependent types** rely on **definitional equality** (type-level computation) plus **hand-written proofs** when the checker can't auto-reduce two types. Indices are **erased** before runtime, so the safety is free at execution time. The recurring tension: SMT is hands-off but limited; proofs are unlimited but laborious — and choosing a tool means choosing which of those you'll live with.

---

## Further Reading

- *Type-Driven Development with Idris* — Brady; the clearest treatment of `Vec`, `Fin`, Pi, and Sigma.
- The Liquid Haskell tutorial — the VC/SMT pipeline made hands-on.
- *Programming Language Foundations in Agda* — Pi and Sigma from first principles.
- Z3 guide and SMT-LIB primer — to understand what "the solver can decide."
- The F\* tutorial — refinement + dependent in one language, with SMT discharge.
- Edwin Brady, *"Idris, a General Purpose Dependently Typed Programming Language"* — design rationale, including erasure.
