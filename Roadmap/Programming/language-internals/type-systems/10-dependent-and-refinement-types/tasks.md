# Dependent & Refinement Types — Hands-On Tasks

> **Topic:** [Dependent & Refinement Types](README.md)

---

## Introduction

This file is a structured set of exercises that take you from "I can read a
refinement annotation" to "I can write length-indexed code, prove a small
theorem by induction, and reason about where verification pays." The tasks
build on each other. Several can be done on paper or in a playground; the
ones marked **(tooling)** are best run in a real checker (Liquid Haskell,
Idris/Agda, Dafny, F\*, the TypeScript/Rust compilers).

How to use this file: read the task, attempt it *before* opening the hints,
run it under a checker whenever one is suggested, and tick the self-check
boxes only when you can *explain* the result to someone else — not merely
when it compiles. Sample solutions are intentionally sparse; they appear
only where the canonical answer teaches more than your first attempt would.

## Table of Contents

- [Warm-Up](#warm-up)
- [Core](#core)
- [Advanced](#advanced)
- [Capstone](#capstone)

---

## Warm-Up

These rebuild the mental model. Short, but each introduces a primitive or
failure mode reused later.

### Task 1: Spot the coarse type

**Problem.** For each signature, name the bug the *type* permits and write
the refinement or dependent type that would forbid it:

```text
a) divide   : Int -> Int -> Int
b) head     : List a -> a
c) get      : Array a -> Int -> a
d) sqrtInt  : Int -> Int        -- integer square root, defined for n >= 0
```

**Hints (try without first).**
- Each coarse type *includes* a value that breaks the function.
- The fix is a predicate (`{v | ...}`) or an index (`Vec (S n) a`, `Fin n`).

**Self-check.**
- [ ] You named the offending value for each (e.g. `0` for divide).
- [ ] You can read each refinement aloud as an English sentence.

<details><summary>Sparse solution</summary>

```text
a) divide : Int -> {v:Int | v /= 0} -> Int
b) head   : Vec (S n) a -> a          (or: NonEmptyList a -> a)
c) get    : (arr:Array a) -> {i:Int | 0 <= i && i < len arr} -> a
d) sqrtInt: {v:Int | v >= 0} -> Int
```
</details>

---

### Task 2: Refinement vs. dependent — classify

**Problem.** For each, state whether it's fundamentally a **refinement** type
or a **dependent** type, and why:

```text
a) {v:Int | v > 0}
b) Vec n a
c) {s:String | length s > 0}
d) (n : Nat) -> Vec n a
e) (k : Nat ** Vec k a)
```

**Hints (try without first).**
- Refinement = base type + predicate. Dependent = type mentions a value.
- (d) and (e) are Pi and Sigma — both dependent.

**Self-check.**
- [ ] You can explain why `Vec n a` is dependent but `{v:Int | v>0}` is refinement.
- [ ] You identified (d) as a Pi type and (e) as a Sigma type.

---

### Task 3: Read a Liquid Haskell error **(tooling, optional)**

**Problem.** Write (in Liquid Haskell, or on paper) the refinement
`{-@ divide :: Int -> {v:Int | v /= 0} -> Int @-}` and the call
`divide 10 0`. Predict the exact verification condition the tool generates
and what Z3 reports.

**Hints (try without first).**
- The VC asks: "is `0 /= 0` valid?" Z3 will refute it.
- The error names the predicate that failed and (often) the offending value.

**Self-check.**
- [ ] You wrote the VC as a logical formula.
- [ ] You can state why this is a *compile-time* rejection, not a runtime one.

---

## Core

These are the heart of the file: length-indexed programming and the
mechanics of checking.

### Task 4: Implement length-indexed `append` **(tooling)**

**Problem.** In Idris (or Agda), define `Vect` and implement
`append : Vect n a -> Vect m a -> Vect (n + m) a`. Then *intentionally*
introduce an off-by-one bug (e.g. drop the head in the cons case) and
observe the type error.

**Constraints.**
- The correct version must typecheck with no `believe_me`/`assert_total`.
- Capture the exact error message from the buggy version.

**Hints (try without first).**
- Base case `append [] ys = ys` requires `Vect (0 + m) a = Vect m a`, which
  reduces definitionally.
- The cons case needs `Vect (S k + m) a`, which reduces to `Vect (S (k + m)) a`.
- The off-by-one breaks the length arithmetic; the error mentions a length
  mismatch, not a runtime fault.

**Self-check.**
- [ ] The correct version typechecks.
- [ ] You can explain *why* the buggy version fails at the type level.
- [ ] You can identify which step uses *definitional* equality.

---

### Task 5: Safe indexing with `Fin n` **(tooling)**

**Problem.** Implement `index : Fin n -> Vect n a -> a` and demonstrate that
indexing past the end is *unconstructable* (you cannot even write the call),
not merely runtime-checked.

**Hints (try without first).**
- A `Fin n` value of `0..n-1` exists; there is no `Fin 3` equal to `3`.
- `index` needs no `Nil` case — `Fin n` forces `n >= 1`, so the vector is
  non-empty. Some checkers want an explicit `impossible`.

**Self-check.**
- [ ] You can explain why no out-of-bounds runtime check is needed.
- [ ] You understand why the `Nil` case is impossible here.

---

### Task 6: Return a runtime length with a Sigma type **(tooling)**

**Problem.** Implement `filterVect : (a -> Bool) -> Vect n a -> (k ** Vect k a)`.
Then write a caller that pattern-matches to recover *both* the resulting
length and the vector, and prints them.

**Hints (try without first).**
- The output length isn't known statically, so it must be packaged with the
  vector — that's exactly what Sigma is for.
- In the keep branch, the length is `S k`; in the drop branch, `k`.

**Self-check.**
- [ ] You can explain why an ordinary `Vect ? a` return type is impossible here.
- [ ] You recovered the length by matching the dependent pair.

---

### Task 7: Prove `n + 0 = n` by induction **(tooling)**

**Problem.** In Idris/Agda (or Coq/Lean if you prefer), prove
`plusZeroRight : (n : Nat) -> n + 0 = n`. Then try to prove it with a single
`Refl` and explain why that fails.

**Hints (try without first).**
- `Refl` works for the base case (`0 + 0` reduces to `0`).
- The step case needs the inductive hypothesis transported through `S`
  (e.g. `cong S`).
- A bare `Refl` fails because `n + 0` is *stuck* for variable `n` — `+`
  recurses on its first argument.

**Self-check.**
- [ ] Your proof is total / structurally recursive.
- [ ] You can explain why `0 + n = n` *does* work with `Refl` but `n + 0` doesn't.

<details><summary>Sparse solution (Idris)</summary>

```idris
plusZeroRight : (n : Nat) -> n + 0 = n
plusZeroRight Z     = Refl
plusZeroRight (S k) = cong S (plusZeroRight k)
```
</details>

---

### Task 8: Trace a verification condition by hand

**Problem.** For the refined `slice`:

```text
slice :: xs:[a]
      -> lo:{v:Int | 0 <= v && v <= len xs}
      -> hi:{v:Int | lo <= v && v <= len xs}
      -> [a]
slice xs lo hi = take (hi - lo) (drop lo xs)
```

write, in logical form, the verification condition that guarantees
`hi - lo >= 0` and that `drop lo`/`take (hi-lo)` stay in bounds. State which
SMT theory (linear integer arithmetic, arrays, ...) discharges it.

**Hints (try without first).**
- From the refinements you know `0 <= lo <= hi <= len xs`.
- `hi - lo >= 0` follows by linear arithmetic from `lo <= hi`.

**Self-check.**
- [ ] You wrote the VC as an implication from the refinements.
- [ ] You named the decidable theory (linear integer arithmetic).

---

## Advanced

### Task 9: Verify binary search in Dafny **(tooling)**

**Problem.** Write `BinarySearch(a: array<int>, key: int) returns (index: int)`
in Dafny with `requires` (sorted), `ensures` (found ⟹ correct index; not
found ⟹ key absent), and the loop `invariant`s needed to make it verify.
Deliberately introduce an off-by-one in the loop bounds and watch Dafny
reject it.

**Hints (try without first).**
- Invariant: `0 <= lo <= hi <= a.Length`, plus "key not in `[0,lo)` and
  `[hi,Length)`."
- Use `mid := lo + (hi - lo) / 2` (the overflow-safe form) and reason about
  why `lo + (hi-lo)/2` differs from `(lo+hi)/2`.

**Self-check.**
- [ ] The correct version verifies; the off-by-one is rejected.
- [ ] You can articulate which invariant the buggy version violates.

---

### Task 10: Find where definitional equality runs out **(tooling)**

**Problem.** Attempt `reverseVect : Vect n a -> Vect n a`. Implement it using
`++` in the cons case and observe that the length doesn't line up
automatically. Then fix it with a `rewrite` using `plusCommutative` (or the
appropriate lemma).

**Hints (try without first).**
- The recursive step produces a length like `k + 1`, but the spec wants
  `1 + k` (or vice versa) — *not* definitionally equal for variable `k`.
- The `rewrite` injects a proof of the arithmetic identity to realign the types.

**Self-check.**
- [ ] You can point to the exact spot where the checker couldn't auto-reduce.
- [ ] You can explain why an SMT-based refinement tool would *not* have needed
      a manual rewrite here.

---

### Task 11: Refine at the boundary (smart constructor)

**Problem.** In any language with a refinement flavor (Liquid Haskell, or
TypeScript branded types, or a Haskell newtype + smart constructor), design a
`PositiveInt` (or `ValidatedEmail`) such that the *only* way to construct it
establishes the invariant. Then show that downstream functions taking the
refined type need no runtime guard.

**Hints (try without first).**
- The constructor returns `Maybe`/`Option` (or null) — it can fail.
- Once constructed, the invariant is carried by the type, so consumers trust it.

**Self-check.**
- [ ] No code path can construct an invalid value.
- [ ] You can explain why refining *at the boundary* minimizes scattered checks.

---

### Task 12: Mainstream slivers — type-state in Rust **(tooling)**

**Problem.** Implement a `File<Open>` / `File<Closed>` type-state so that
calling `.read()` after `.close()` is a *compile error*. Use a phantom type
parameter and a by-value `close`.

**Hints (try without first).**
- `read` lives only in `impl File<Open>`.
- `close(self) -> File<Closed>` consumes the open handle.

**Self-check.**
- [ ] `read` after `close` does not compile.
- [ ] You can explain how this is a sliver of dependent thinking (state in the type).

---

### Task 13: Break a "proof" with non-termination (thought experiment)

**Problem.** Explain, with a concrete pseudo-snippet, how a non-terminating
function `loop : False` would let you "prove" any proposition, and therefore
why totality checking is required for soundness. Then state what the totality
checker does to reject `loop`.

**Hints (try without first).**
- From `False`, `exFalso : False -> a` produces a value of any type.
- `loop = loop` never returns but typechecks if totality is off.

**Self-check.**
- [ ] You connected non-termination to inhabiting `False` to proving anything.
- [ ] You named *both* totality requirements (termination and coverage).

---

## Capstone

### Task 14: Build a tiny verified stack module **(tooling)**

**Problem.** In Idris/Agda (dependent) *or* Liquid Haskell/Dafny (refinement),
implement a fixed-capacity stack where:
- `push` is only callable when the stack is **not full**,
- `pop` is only callable when the stack is **not empty**,
- the type/refinement tracks the current size relative to capacity.

Choose the *dependent* version if you want size in the type
(`Stack n cap a`); choose the *refinement* version if you want SMT to track
`0 <= size <= cap`. Then write a short paragraph comparing the experience:
which obligations were automatic, which needed manual work?

**Hints (try without first).**
- Dependent: index the stack by current size and capacity; `push` maps
  `Stack n cap` to `Stack (S n) cap` with a proof `n < cap`.
- Refinement: carry `{size : Int | 0 <= size && size <= cap}`; `push` requires
  `size < cap`, `pop` requires `size > 0`; Z3 discharges the arithmetic.

**Self-check.**
- [ ] Overfull push and empty pop are compile errors, not runtime checks.
- [ ] Your write-up correctly identifies where SMT helped vs. where you proved
      by hand.

---

### Task 15: Make the verification call (design exercise)

**Problem.** You're handed three components and a fixed budget. For each,
decide *which rung* of the verification gradient it deserves
(ordinary-types+tests / illegal-states-unrepresentable / branded+type-state /
surgical SMT refinement / full proof) and justify it by blast radius and
defect probability:

```text
a) An internal admin dashboard's pagination logic.
b) A TLS record-layer parser handling untrusted bytes from the network.
c) A constant-time AES implementation shipping in millions of devices.
```

**Hints (try without first).**
- Size the *consequence of a defect* first; that sets the ceiling.
- (a) is low blast radius; (c) is catastrophic and the spec is precise.

**Self-check.**
- [ ] You assigned a defensible rung to each and named the deciding factor.
- [ ] You can argue why *over*-verifying (a) would be a misallocation.

<details><summary>Sparse solution (sketch)</summary>

```text
a) Rung 1–2: ordinary types + tests; maybe a branded `PageSize`. Low blast
   radius — full proof would be a waste.
b) Rung 4: surgical refinement (Liquid Haskell / F* / Dafny) on the parser.
   Untrusted input + security relevance, but a whole-system proof is overkill.
c) Rung 5: full verification (F*/HACL*-style) — catastrophic blast radius,
   precise math spec, properties (correctness + constant-time) that map onto
   what verification proves; cost amortized across millions of devices.
```
</details>

---

### Task 16: Audit a verification claim (review exercise)

**Problem.** A teammate's PR says "this module is formally verified correct."
Write the checklist of questions you'd ask before trusting that claim in
production, and explain what each one protects against.

**Hints (try without first).**
- Think TCB, spec, scope, and escape hatches.
- "Verified" against *what*, trusting *what*, proving *which* property?

**Self-check.**
- [ ] Your checklist covers: which spec (and is it right), which property
      (memory safety ≠ functional correctness ≠ side channels), the TCB
      (kernel, axioms, extraction/compiler), and any open `admit`/`sorry`/`assume`.
- [ ] You can explain why a passing proof against a wrong spec is worthless.

---

## Closing note

If you completed the tooling tasks, you've now felt both checking regimes
first-hand: the SMT solver silently discharging arithmetic (Tasks 8, 9, 14)
and the manual proof you had to write when definitional equality ran out
(Tasks 7, 10). The design tasks (15, 16) are the ones you'll actually use most
in industry — knowing *which rung a problem deserves* and *how to interrogate a
verification claim* matters far more, day to day, than writing Agda. Keep the
gradient in mind: harvest the cheap ideas everywhere, deploy the expensive ones
surgically.
