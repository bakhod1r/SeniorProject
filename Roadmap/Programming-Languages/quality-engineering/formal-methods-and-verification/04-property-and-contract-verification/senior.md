# Property & Contract Verification — Senior Level

> **Roadmap:** [Formal Methods & Verification](../README.md) → Property & Contract Verification
> *The middle page showed you contracts and `quickcheck`. This page is about the machinery underneath: how a verifier turns `requires`/`ensures` into logical formulas, why a loop needs an invariant the tool cannot guess, what the SMT solver actually decides, and why the same pre/postcondition can be checked three different ways — at runtime, by random sampling, or by proof.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Hoare Logic and the Triple](#core-concept-1--hoare-logic-and-the-triple)
5. [Core Concept 2 — Weakest Preconditions and VC Generation](#core-concept-2--weakest-preconditions-and-vc-generation)
6. [Core Concept 3 — Loop Invariants and Variants](#core-concept-3--loop-invariants-and-variants)
7. [Core Concept 4 — The SMT Solver and Why Verification Times Out](#core-concept-4--the-smt-solver-and-why-verification-times-out)
8. [Core Concept 5 — Framing, the Heap, and Separation Logic](#core-concept-5--framing-the-heap-and-separation-logic)
9. [Core Concept 6 — Property-Based Testing as the Cheap "For All"](#core-concept-6--property-based-testing-as-the-cheap-for-all)
10. [Core Concept 7 — Refinement Types and the Contract Spectrum](#core-concept-7--refinement-types-and-the-contract-spectrum)
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

> Focus: **The theory and tooling that turn a contract into a proof — and the engineering judgement about when to prove, when to test, and when to assert.**

By the middle level you can write a contract — a precondition, a postcondition, an invariant — and you can throw a property-based tester at code to hunt counterexamples. That is already a senior-adjacent skill. The senior jump is understanding what a contract *means* formally and what it takes to discharge it as a theorem rather than a probability.

There is a single idea connecting everything on this page: the **Hoare triple** `{P} C {Q}` — "if `P` holds before command `C` runs and `C` terminates, then `Q` holds after." A contract is a Hoare triple in disguise. A property test is a Monte-Carlo approximation of the `∀` hidden in that triple. A verifier like Dafny is a machine that *proves* the triple by reducing it to logical formulas and handing them to an SMT solver. Once you see that the runtime assertion, the random test, and the formal proof are three checks of *the same specification*, you can choose the right one per situation — and you can read a verifier's "this might not hold" the way a senior reads a linker error: as a precise statement about where the proof broke, not a mystery.

This page is that layer: the proof theory (Hoare logic, weakest preconditions), the pipeline (annotated code → verification conditions → SMT), the human's irreducible job (invariants and variants), and the complement that ships in every real codebase (property-based testing).

---

## Prerequisites

- **Required:** You've internalized [middle.md](middle.md) — contracts (pre/post/invariant), assertions, and the basics of property-based testing (generators, shrinking, the `∀` framing).
- **Required:** Comfort reading first-order logic: `∀`, `∃`, `⇒`, substitution, and quantifiers over arrays/integers.
- **Helpful:** You've debugged a flaky property test or a contract that fired in production, and felt the gap between "tested" and "proven."
- **Helpful:** Any exposure to a verifier (Dafny, Frama-C, Why3, Verus) or a refinement-typed language (Liquid Haskell, F\*).

---

## Glossary

| Term | Meaning |
|---|---|
| **Hoare triple** `{P} C {Q}` | If precondition `P` holds and `C` terminates, postcondition `Q` holds. |
| **Partial correctness** | The triple *assuming* termination. Says nothing if `C` loops forever. |
| **Total correctness** `[P] C [Q]` | Partial correctness **plus** termination. |
| **wp(C, Q)** | Weakest precondition: the *least* restrictive `P` guaranteeing `Q` after `C`. |
| **Verification condition (VC)** | A pure logical formula whose validity implies the program meets its spec. |
| **Loop invariant** | A predicate true before the loop and preserved by every iteration. |
| **Variant / ranking function** | A value in a well-founded order that strictly decreases each iteration ⇒ termination. |
| **SMT** | Satisfiability Modulo Theories — SAT extended with theories (arithmetic, arrays, …). |
| **Trigger / pattern** | A syntactic hint telling the solver when to instantiate a `∀`. |
| **Ghost code** | Specification-only code (variables, lemmas) erased before compilation. |
| **Frame / modifies** | The set of locations a command may change; everything else is preserved. |
| **Separation logic** | A logic with `∗` (separating conjunction) for reasoning about disjoint heap regions. |
| **Refinement type** | A base type plus a predicate, e.g. `{v:Int | v > 0}`, discharged by SMT. |

---

## Core Concept 1 — Hoare Logic and the Triple

**Hoare logic** (Tony Hoare, 1969) is a deductive system for proving programs correct. Its unit is the triple `{P} C {Q}`, read: *if the assertion `P` is true before executing `C`, and `C` terminates, then `Q` is true afterward.* `P` is the precondition, `Q` the postcondition. The whole edifice of contract verification is built from a handful of inference rules — one per syntactic construct of the language.

The most surprising rule is the **assignment axiom**, because it runs backward from intuition:

```
───────────────────────  (assignment)
 {Q[e/x]}  x := e  {Q}
```

`Q[e/x]` means "`Q` with every free `x` replaced by `e`." To make `Q` hold *after* `x := e`, require that the version of `Q` with `e` substituted for `x` holds *before*. Example: to prove `{?} x := x + 1 {x > 0}`, substitute `x+1` for `x` in `x > 0`, giving the precondition `x + 1 > 0`, i.e. `x ≥ 0`. The axiom is exact, not approximate.

The other rules compose triples:

```
 {P} C1 {R}   {R} C2 {Q}              {P ∧ b} C1 {Q}   {P ∧ ¬b} C2 {Q}
──────────────────────────  (seq)    ──────────────────────────────────  (if)
     {P} C1; C2 {Q}                     {P} if b then C1 else C2 {Q}

      P ⇒ P'   {P'} C {Q'}   Q' ⇒ Q
     ──────────────────────────────  (consequence)
                {P} C {Q}
```

The **rule of consequence** is the glue: you may always *strengthen the precondition* (assume more) and *weaken the postcondition* (promise less). It is what lets a programmer-supplied invariant connect to the mechanically-derived condition — the gap between "what the tool computed" and "what I claimed" is bridged by an implication the solver must check.

> **Key insight:** A contract *is* a Hoare triple. `requires P` is the precondition, `ensures Q` is the postcondition, and the method body is `C`. Everything a verifier does is mechanize the proof of `{P} body {Q}` using these rules — there is no extra magic, only bookkeeping over substitutions and implications.

There are two flavours. **Partial correctness** `{P} C {Q}` promises `Q` *only if `C` terminates* — a program that loops forever satisfies *every* partial-correctness triple vacuously. **Total correctness** `[P] C [Q]` additionally requires termination. The distinction is not pedantic: a verifier that only checks partial correctness will happily "prove" a function that never returns. Termination is a separate obligation, handled by variants (Concept 3).

---

## Core Concept 2 — Weakest Preconditions and VC Generation

Proving triples by hand with the rules above is tedious. Dijkstra's **weakest precondition calculus** mechanizes it. `wp(C, Q)` is the *weakest* (least restrictive, most permissive) predicate `P` such that `{P} C {Q}` holds. "Weakest" matters: it captures *exactly* the states from which `C` is guaranteed to establish `Q`, no more, no less. The triple `{P} C {Q}` is valid **iff** `P ⇒ wp(C, Q)`.

The calculus is a recursive function over the program's structure:

| Command `C` | `wp(C, Q)` |
|---|---|
| `x := e` | `Q[e/x]` (the assignment axiom, run as a transformer) |
| `C1; C2` | `wp(C1, wp(C2, Q))` (push `Q` back through `C2`, then `C1`) |
| `if b then C1 else C2` | `(b ⇒ wp(C1, Q)) ∧ (¬b ⇒ wp(C2, Q))` |
| `assert R` | `R ∧ Q` |
| `assume R` | `R ⇒ Q` |
| `while b inv I … {body}` | (special — needs the invariant; see Concept 3) |

Sequencing is the heart of it: you take the postcondition `Q`, push it backward through the *last* statement, then the previous one, all the way to the top. What lands at the top is the formula the precondition must imply. Worked example for `s := x; s := s + y` with desired post `s = x + y`:

```
wp(s := s + y, s = x + y)  =  (s + y = x + y)    =  s = x
wp(s := x,     s = x)      =  (x = x)            =  true
```

So `wp(C, s = x + y) = true` — the postcondition holds unconditionally. The verifier just *computed* the proof.

**VC generation** is how a tool turns annotated source into work for a solver. The verifier (Dafny, Why3, Frama-C) computes, per method, the formula `precondition ⇒ wp(body, postcondition)` — a **verification condition (VC)**: a pure first-order formula, no program left in it, whose **validity** means the method satisfies its contract. Real verifiers don't hand-roll wp on raw source; they lower to an **intermediate verification language** first:

```
  Annotated source (Dafny, Frama-C/ACSL, Rust+Verus)
            │  desugar, encode the heap, thread the contracts
            ▼
  Intermediate Verification Language  (Boogie, or Why3's WhyML)
            │  wp / VC generation
            ▼
  Verification Conditions  (pure FOL formulas)
            │  negate each VC, ask "is the negation SAT?"
            ▼
  SMT solver  (Z3, CVC5)  →  UNSAT = proved  |  SAT = counterexample  |  unknown = ???
```

Dafny compiles to **Boogie**; Frama-C and many others target **Why3/WhyML**. Boogie and Why3 are deliberately tiny imperative languages whose *only* job is to be a clean substrate for VC generation. This factoring is why a dozen front-end verifiers can share one back-end and one solver. The solver is asked the dual question: to prove VC is *valid*, it checks whether `¬VC` is *satisfiable*. **UNSAT** (no model for the negation) means the VC is valid — proved. **SAT** means there's a model — a concrete counterexample the verifier can sometimes reconstruct into "here's an input where your postcondition fails."

> **Key insight:** Verification reduces program correctness to *logical validity*, and validity to *unsatisfiability of the negation*. The program disappears entirely at the VC boundary — from there on it is pure logic, which is exactly why the SMT solver, not the verifier, is where proofs succeed or die.

---

## Core Concept 3 — Loop Invariants and Variants

Loops are where automation hits its wall. A loop runs an unknown number of times, so wp cannot simply unfold it. The verifier needs a **loop invariant** `I` — a predicate that (a) holds when the loop is first reached, (b) is *preserved* by one arbitrary iteration, and (c) together with the negated guard implies what you need after the loop. The `while` rule:

```
   P ⇒ I          (establishment: invariant holds on entry)
   {I ∧ b} body {I}   (preservation: each iteration keeps it true)
   (I ∧ ¬b) ⇒ Q   (the invariant + exit condition give the postcondition)
 ─────────────────────────────────────────────────────────────────────
              {P} while b do body {Q}     (partial correctness)
```

Notice the rule says *nothing* about how many times the loop runs — induction over iterations is exactly what the invariant encodes. The verifier generates three VCs from it: establishment, preservation, and the exit implication. If any fails, the proof fails *at that VC*, which tells you precisely whether your invariant is too weak (doesn't imply `Q`), not initially true, or not preserved.

The hard, irreducible part: **the tool generally cannot infer the invariant for you.** Invariant inference is undecidable in general; verifiers do *some* inference (abstract interpretation, simple heuristics) but for any non-trivial loop the human supplies it. This is the central skill of deductive verification — finding the invariant is genuinely the creative act, the program-proof analog of finding the right induction hypothesis.

For **total correctness** you also need a **variant** (ranking function, `decreases` clause): an expression that maps the loop state into a **well-founded order** (one with no infinite descending chains — e.g. the naturals, or lexicographic tuples of naturals) and that *strictly decreases* on every iteration. A value that can't decrease forever proves the loop terminates. For a loop counting `i` up to `n`, the variant is `n - i`: bounded below by 0, decreasing each step.

```dafny
method SumTo(n: int) returns (s: int)
  requires n >= 0
  ensures s == n * (n + 1) / 2
{
  s := 0;
  var i := 0;
  while i < n
    invariant 0 <= i <= n                  // i stays in range  (establishment + preservation)
    invariant s == i * (i + 1) / 2         // running sum equals the closed form so far
    decreases n - i                        // variant: strictly decreases, bounded below ⇒ terminates
  {
    i := i + 1;
    s := s + i;
  }
}
```

Walk the preservation VC by hand. Assume the invariant and the guard: `s == i*(i+1)/2` and `i < n`. After `i := i + 1` the counter is `i+1`; after `s := s + (i+1)` the sum is `i*(i+1)/2 + (i+1)`. We must show this equals `(i+1)*(i+2)/2` — the invariant with `i+1` for `i`. Algebra: `i*(i+1)/2 + (i+1) = (i+1)·(i/2 + 1) = (i+1)(i+2)/2`. ✓ Preservation holds. On exit `¬(i < n)` and `i ≤ n` give `i == n`, so `s == n*(n+1)/2`, which is the postcondition. ✓ And `decreases n - i` shrinks each step and the invariant keeps it ≥ 0, so the loop terminates. Every VC discharged — Dafny verifies this in milliseconds.

> **Key insight:** The verifier automates the *bookkeeping* (substitutions, VC generation, discharging) but not the *insight*. The loop invariant and the variant are the two things a human almost always has to supply, and they map exactly to the two halves of a termination-aware proof: induction over iterations (invariant) and a measure that descends (variant).

---

## Core Concept 4 — The SMT Solver and Why Verification Times Out

Every VC ends up at an **SMT solver** — Z3 (Microsoft Research) or CVC5 are the workhorses. SMT = **Satisfiability Modulo Theories**: a SAT solver for Boolean structure, augmented with decision procedures for *theories* that give meaning to symbols like `+`, `<`, arrays, and bitvectors. The solver answers SAT / UNSAT / unknown for a formula over those theories.

The theories that matter for verification, and crucially their **decidability**:

| Theory | Examples | Status |
|---|---|---|
| Linear integer/real arithmetic (LIA/LRA) | `2*x + y <= 5` | **Decidable**, efficient |
| Arrays (select/store) | `a[i := v][j]` | **Decidable** (quantifier-free) |
| Bitvectors | `x & (x-1)`, overflow | **Decidable** (but can blow up — bit-blasting) |
| Datatypes | lists, options, records | **Decidable** (quantifier-free) |
| Uninterpreted functions (EUF) | `f(x) == f(y)` from `x == y` | **Decidable** (congruence closure) |
| **Nonlinear** arithmetic | `x * y`, `x * x` | **Undecidable** over integers |
| **Quantifiers** (`∀`/`∃`) | `∀i. 0<=i<n ⇒ a[i] > 0` | **Undecidable** in general |

The quantifier-free combination of the decidable theories is exactly what makes verifiers feel magical — they discharge thousands of arithmetic-and-array VCs instantly. The trouble starts with the last two rows, which are the *common* sources of "verification timed out" and "postcondition might not hold":

- **Quantifiers.** Most interesting specs have `∀` (e.g. "every element is sorted"). First-order logic with quantifiers is undecidable, so the solver doesn't *decide* — it **instantiates**. It guesses ground terms to plug into the `∀`, guided by **triggers / patterns**: syntactic shapes that, when they appear in the proof state, fire an instantiation. Good triggers ⇒ the right facts get instantiated and the proof closes. Bad or missing triggers ⇒ either the solver never instantiates the fact you needed (spurious "might not hold") or it instantiates a *matching loop* and times out. This is why two logically-equivalent specs can have wildly different verification times.

- **Nonlinear arithmetic.** `x * y` where both vary is undecidable over the integers; Z3 falls back to incomplete heuristics. Multiplying two variables, integer division, modular arithmetic — these routinely make a proof flaky or push it over the time limit.

The senior's toolkit for *guiding* the solver, in increasing power:

```dafny
// 1. assert a stepping-stone fact: it becomes a sub-goal the solver proves,
//    then can REUSE — often the difference between timeout and instant.
assert s == i * (i + 1) / 2;

// 2. ghost code & ghost variables: spec-only state, erased at compile time,
//    used to express invariants the runtime doesn't carry.
ghost var seen: set<int> := {};

// 3. a lemma: a proven theorem (itself a verified method) you invoke to
//    inject a quantified or inductive fact the solver won't find alone.
lemma DistributeMul(a: int, b: int, c: int)
  ensures a * (b + c) == a * b + a * c { }   // by Dafny's arithmetic; now callable

// 4. {:trigger ...} annotations to control quantifier instantiation explicitly.
```

> **Key insight:** "Dafny can't prove this" almost never means "this is false." It usually means the solver didn't instantiate the right quantifier or stumbled on nonlinear arithmetic. The fix is rarely changing the *code* — it's adding `assert`s, lemmas, ghost state, or triggers to *route the solver to the proof*. Reading a verification failure is debugging the solver's search, not the program.

---

## Core Concept 5 — Framing, the Heap, and Separation Logic

Hoare logic as presented assumes simple variables. The real world has a **heap**: pointers, arrays, mutable objects, aliasing. This breaks the clean assignment axiom, because `x := e` no longer changes only `x`. Write through a pointer `*p := 5` and you've potentially changed `*q` too — if `p` and `q` alias. The verifier can no longer assume "everything I didn't name is unchanged," which is the **frame problem**.

Verifiers tame it with **modifies clauses** (frame conditions): a method declares the set of heap locations it may change, and the verifier proves the method touches nothing else *and* lets callers assume everything outside that set is preserved.

```dafny
class Counter {
  var count: int
  method Increment()
    modifies this              // "I may change fields of `this`, and nothing else"
    ensures count == old(count) + 1   // `old(e)` = value of e in the pre-state
  { count := count + 1; }
}
```

`old(e)` references the *pre-state* value — the bridge between before and after across a mutating call. The `modifies this` clause is what lets a caller holding *another* `Counter` know its own `count` is untouched.

This scales badly with aliasing, which is why **separation logic** (O'Hearn, Reynolds) exists. Its key connective is the **separating conjunction** `P ∗ Q`: "the heap splits into two *disjoint* parts, one satisfying `P`, the other `Q`." Disjointness is *built into the logic*, so the **frame rule** becomes almost free:

```
        {P} C {Q}
 ───────────────────────  (frame rule)   — if C only touches P's footprint,
   {P ∗ R} C {Q ∗ R}                        any disjoint R is automatically preserved
```

You reason about a data structure's *footprint* in isolation and the logic guarantees everything separate is untouched — no manual modifies-bookkeeping for the disjoint part. This is the foundation of modern heap verifiers (VeriFast, Viper, Iris).

The most elegant practical move: **let the type system establish disjointness for free.** Rust's **borrow checker** already proves, at compile time, that a `&mut T` is the *unique* mutable reference — no aliasing. Verus, Prusti, and Creusot exploit exactly this: because Rust's ownership guarantees `&mut` is unaliased, the verifier gets separation-logic-style framing *from the borrow checker* rather than from explicit annotations. Aliasing is the enemy of automated verification; ownership is a pre-existing, compiler-checked proof that aliasing is absent.

> **Key insight:** Aliasing is what makes heap verification hard, because it destroys "I only changed what I named." Modifies clauses state the frame manually; separation logic makes disjointness a logical primitive; Rust's borrow checker *gives you* disjointness as a free compile-time theorem — which is why the most ergonomic verifiers in the 2020s are built on ownership.

---

## Core Concept 6 — Property-Based Testing as the Cheap "For All"

Proof is expensive. **Property-based testing (PBT)** — QuickCheck (Claessen & Hughes, 2000) and descendants (Hypothesis, fast-check, proptest) — is the cheap approximation of the same `∀`. Instead of *proving* `∀x. P(x)`, you *sample*: generate hundreds of random `x`, check `P(x)` on each, and on failure **shrink** the counterexample to something minimal. It doesn't prove the universal — it *refutes* it cheaply when it's false, which is most of what testing is for.

A senior treats the parts as engineering problems, not magic:

**Generators and the coverage problem.** A generator is a recipe for random values. *Free* generation (any value of the type) is easy but wasteful when the property has a sparse precondition. The naïve fix — generate then filter (`assume`/`==>`) — has a **coverage failure mode**: if the precondition is rarely true, you discard most cases and effectively test almost nothing.

```python
# BAD: filtering. If sorted lists are rare among random lists, almost every
# case is discarded — you "ran 100 examples" but tested a handful.
@given(st.lists(st.integers()))
def test_search(xs):
    assume(xs == sorted(xs))           # throws away most inputs
    ...

# GOOD: constrained construction — generate a list, then SORT it.
# Every generated case is valid; zero waste; full coverage of the real domain.
@given(st.lists(st.integers()).map(sorted))
def test_search(xs):
    for v in xs:
        assert binary_search(xs, v) is not None
```

Constrained construction (build values that are *valid by construction*) beats generate-and-filter whenever the precondition is selective. This is the single biggest lever on property-test quality.

**Shrinking algorithms.** A raw counterexample (`[847, -3, 12, 999, ...]`) is useless; the value of PBT is the *minimal* one (`[1, 0]`). Two families:

- **Type-directed / external shrinking** (classic QuickCheck): each type ships a `shrink` function producing "smaller" candidates; the framework greedily retries until none fails. Powerful but couples shrinking to the generator and struggles with `map`/`filter`.
- **Integrated / internal shrinking** (Hypothesis, `hedgehog`): the generator draws from an underlying **choice sequence** (a stream of random bytes/decisions). Shrinking operates on *that sequence* — make the choices "simpler" (smaller ints, shorter draws) and re-run the generator. Because every value flows from the same byte source, *any* generator (even one built with `map`/`filter`) shrinks automatically, and shrinking respects invariants for free. Hypothesis's engine is essentially **delta-debugging over the choice sequence**.

**Measuring and improving property quality.** A property that passes proves nothing if it never exercised the interesting region. Seniors *measure*:

- **Coverage / classification** (`label`, `classify`, `collect`) — bucket inputs and confirm the hard cases actually occur (e.g. "did we ever test an empty list? a duplicate key?").
- **Coverage-guided / `target()`-guided PBT** — Hypothesis's `target()` and fuzzers like AFL steer generation toward maximizing a metric (code coverage, a numeric objective), turning blind sampling into guided search.
- **Mutation testing the properties** — inject bugs into the *code under test*; if your property suite still passes, the property is too weak. This tests the tests.

**Stateful / model-based testing** generalizes PBT to *sequences* of operations. You define an abstract **model** (a simple reference implementation) and let the framework generate random command sequences, asserting the real system and the model stay in agreement. This is, in effect, a **poor man's refinement check**: you're testing that the implementation refines the model — the same relation a proof assistant would establish formally, approximated by sampling.

> **Key insight:** PBT is the cheapest `∀` you can buy, but it *samples* — it can refute, never prove. Its quality is entirely in the generators (constrained construction over filtering), the shrinker (integrated shrinking gives minimal counterexamples for free), and *measuring* coverage. A green property suite with unmeasured coverage is theater; a measured, coverage-guided, mutation-tested suite is genuine assurance — just not a proof.

---

## Core Concept 7 — Refinement Types and the Contract Spectrum

The **type system** end of the same idea is **refinement types**: a base type sharpened with a logical predicate, with the obligations discharged by — once again — an SMT solver. **Liquid Haskell**, **F\***, and dependent-ish languages put the contract *in the type*, checked statically at every use site.

```haskell
-- Liquid Haskell: a refinement type is "base type | predicate"
{-@ type Pos = {v:Int | v > 0} @-}

{-@ divide :: Int -> Pos -> Int @-}      -- the divisor's type FORBIDS zero
divide :: Int -> Int -> Int
divide x y = x `div` y                    -- no runtime check: the SMT solver proved y /= 0 at each call

{-@ head' :: {xs:[a] | len xs > 0} -> a @-}   -- non-empty by type ⇒ head is total
```

The precondition `y > 0` becomes part of `divide`'s *type*; every caller must prove their argument satisfies it, and the solver checks the implication at compile time. This is contracts and verification fused into type checking — no separate proof phase, no runtime cost.

That unifies the page's central theme: **the same pre/postcondition can be enforced at three points on a spectrum.**

| Mechanism | When checked | Guarantee | Cost | Cross-reference |
|---|---|---|---|---|
| **Runtime contract / assertion** | Execution | This *run*, on this input | Runtime overhead; finds bugs late | [Dynamic Analysis & Sanitizers](../../dynamic-analysis-and-sanitizers/) |
| **Property-based test** | Test time | Sampled inputs (probabilistic) | Cheap; refutes, doesn't prove | this page, Concept 6 |
| **Static proof / refinement type** | Compile/verify time | *All* inputs (for all time) | Expensive (invariants, solver); zero runtime | Dafny, Liquid Haskell, Verus |

The exact same predicate `0 < y` can be (a) an `assert(y > 0)` that fires on a bad run, (b) a generator constraint a property tester samples around, or (c) a refinement type `{v:Int | v > 0}` the SMT solver proves can never be violated. Choosing among them is a senior cost/assurance decision, and they compose: **gradual verification** proves the critical core and falls back to runtime checks at the boundary; **assume-guarantee** reasoning lets a module *assume* a callee's contract (proved or merely asserted) while *guaranteeing* its own.

> **Key insight:** Contracts, property tests, and proofs are not rival techniques — they are the same specification enforced at increasing strength and cost. The senior skill is placing each predicate at the right point on the runtime ⇄ tested ⇄ proven spectrum: prove the invariants whose violation is catastrophic, property-test the rest, and assert at the trust boundaries.

---

## Real-World Examples

**1 — Dafny in production: AWS encryption and authorization.** Amazon's cryptography teams use Dafny to *prove* the core of libraries like the AWS Encryption SDK and the Cedar authorization engine, then compile the verified Dafny to several target languages. The contracts (no key reuse, correct authorization decisions) are discharged once as theorems; the compiled code carries no proof overhead. This is the gradual-verification pattern at scale — prove the security-critical kernel, ship it everywhere.

**2 — seL4: total functional correctness of an OS kernel.** The seL4 microkernel was proven correct down to its C implementation — a refinement proof that the C code implements an abstract specification with *no* unhandled cases. It used a proof assistant (Isabelle) rather than pure SMT, but the skeleton is identical: Hoare-style triples, invariants, refinement. It stands as the existence proof that whole-program functional correctness is achievable for systems software.

**3 — Hypothesis finding real bugs via integrated shrinking.** Hypothesis's choice-sequence shrinker routinely reduces a thousand-element failing input to a two-element minimal reproducer automatically, which is why teams adopt it over example-based tests for serializers, parsers, and numeric code. Its `target()`-guided mode has surfaced floating-point and performance edge cases that uniform random sampling never reached.

**4 — Rust verification riding the borrow checker.** AWS and Microsoft research groups verify Rust with **Verus** and **Creusot**, leaning on ownership so that `&mut` aliasing is *already* excluded by the compiler. The borrow checker supplies the separation-logic framing for free, which is why Rust verification reaches further with fewer annotations than equivalent C verification, where the engineer must spell out every `modifies`/separation fact by hand.

---

## Mental Models

- **A contract is a Hoare triple; a verifier is a triple-prover.** `requires`/`ensures`/body = `{P} C {Q}`. Everything else — wp, VCs, the solver — is mechanization of the proof of that one triple. When confused, rewrite the contract as `{P} C {Q}` and ask which inference rule applies.

- **wp pushes the postcondition backward through the code.** Verification isn't forward simulation; it's running the postcondition *up* the program via substitution until a formula lands at the top that the precondition must imply. Loops are the one place this can't proceed without a human-supplied invariant.

- **The program disappears at the VC boundary.** Once VC generation runs, there is no code left — only logic. Success or failure is the SMT solver's, not the verifier's. "It won't verify" is a statement about a *formula's provability*, usually a quantifier-instantiation or nonlinear-arithmetic problem.

- **Invariant : loop :: induction hypothesis : recursion.** Finding the invariant is the creative act, isomorphic to choosing the right induction hypothesis. The variant is the well-founded measure that does for termination what the invariant does for the postcondition.

- **PBT is Monte-Carlo `∀`; proof is the real `∀`.** Same specification, different epistemics. PBT buys cheap refutation by sampling; proof buys certainty at the price of invariants and a solver. Pick per stakes.

- **Aliasing is the enemy; ownership is a free proof against it.** Heap verification is hard exactly because writes can alias. Rust's borrow checker pre-proves non-aliasing, handing the verifier separation-logic framing without annotations.

---

## Common Mistakes

1. **Confusing partial and total correctness.** A partial-correctness proof says nothing about termination — a function that loops forever satisfies it vacuously. If "it always returns" matters, you need a `decreases`/variant clause, not just an invariant.

2. **Expecting the verifier to find the loop invariant.** Invariant inference is undecidable; for non-trivial loops you supply it. Blaming the tool for "not figuring it out" misunderstands the division of labor — the insight is yours, the bookkeeping is the tool's.

3. **Reading "might not hold" as "this is false."** It usually means the SMT solver didn't instantiate the right quantifier or hit nonlinear arithmetic. The fix is `assert`s, lemmas, ghost code, or triggers — not changing correct code.

4. **Generate-and-filter when the precondition is selective.** `assume(xs == sorted(xs))` over random lists discards almost everything; you "ran 100 examples" but tested nearly none. Build valid values by construction (`.map(sorted)`), don't filter for them.

5. **Trusting a green property suite without measuring coverage.** A property that never exercises the empty list, the duplicate key, or the boundary proves nothing about them. Use `classify`/`label`/`target()` and mutation-test the properties to confirm they'd catch real bugs.

6. **Forgetting `modifies`/frame conditions and fighting phantom aliasing.** Without a declared frame, the verifier can't assume unrelated heap is preserved — and over-broad `modifies` lets too much change. State the footprint precisely (or use an ownership-based verifier that derives it).

7. **Trying to verify nonlinear arithmetic head-on.** `x * y` with both variable is undecidable; the proof goes flaky. Introduce lemmas (`DistributeMul`-style), bound the values, or restructure to keep VCs in linear arithmetic.

8. **Treating proof, test, and assertion as mutually exclusive.** They're one spec at three strengths. The mistake is proving everything (too expensive) or proving nothing (too weak). Prove the catastrophic invariants, property-test the rest, assert at boundaries — gradual verification.

---

## Test Yourself

1. State the Hoare triple `{P} C {Q}` in words, and explain the difference between partial and total correctness.
2. Compute `wp(x := x + 1, x > 5)`. Then compute `wp(y := x; y := y * 2, y > 10)`.
3. Give the three conditions a loop invariant must satisfy, and explain what the *variant* (`decreases` clause) adds and why.
4. A Dafny method verifies with `invariant` but you remove the `decreases` clause and it still "verifies." What exactly are you no longer guaranteed?
5. Your VC times out. Name two likely root causes inside the SMT solver and the corresponding tools you'd reach for to fix it.
6. Why does constrained construction (`.map(sorted)`) beat generate-and-filter (`assume(...)`) for property tests with selective preconditions?
7. Explain how Rust's borrow checker gives a verifier separation-logic-style framing "for free."
8. The predicate `0 < balance` can be enforced three ways across the contract spectrum. Name them, when each is checked, and what each guarantees.

<details>
<summary>Answers</summary>

1. `{P} C {Q}`: *if `P` holds before `C` executes and `C` terminates, then `Q` holds afterward.* **Partial** correctness makes no claim when `C` fails to terminate (a non-terminating program satisfies every partial triple vacuously). **Total** correctness `[P] C [Q]` additionally requires that `C` *does* terminate.
2. `wp(x := x+1, x>5) = (x+1 > 5) = x > 4`. For the sequence, push back through the *last* statement first: `wp(y := y*2, y>10) = (y*2 > 10) = y > 5`; then `wp(y := x, y > 5) = x > 5`. So the answer is `x > 5`.
3. (a) **Establishment** — the invariant holds when the loop is first reached (`P ⇒ I`); (b) **preservation** — one arbitrary iteration keeps it true (`{I ∧ b} body {I}`); (c) **exit** — invariant plus negated guard implies the postcondition (`(I ∧ ¬b) ⇒ Q`). The **variant** is a value in a well-founded order that strictly decreases each iteration; it adds **termination**, upgrading partial to total correctness — without it the loop could run forever and the postcondition is only conditional.
4. You lose the **termination** guarantee — you've dropped from total to partial correctness. Dafny still proves the postcondition *if* the loop terminates, but no longer that it does. (Dafny often infers a trivial variant, which is why it may still pass; on a loop where it can't, removing `decreases` makes it fail.)
5. Likely causes: (a) **quantifier instantiation** — a `∀` whose trigger never fires (spurious failure) or fires in a matching loop (timeout); reach for `assert` stepping-stones, explicit `{:trigger}`s, or a `lemma` that supplies the instance. (b) **Nonlinear arithmetic** — `x*y`/division is undecidable; reach for lemmas that rewrite it into linear form, value bounds, or restructuring to keep the VC linear.
6. With a selective precondition, *random* values rarely satisfy it, so `assume`/filter **discards most generated cases** — you nominally run 100 examples but effectively test a handful (the coverage failure). `.map(sorted)` makes *every* generated value valid by construction, so all cases count and the real domain is covered. As a bonus, integrated shrinking still works through `map`.
7. Heap verification is hard because writes can **alias**, breaking "I only changed what I named." Rust's borrow checker proves at compile time that a `&mut T` is the **unique** mutable reference — no aliasing. So a verifier (Verus/Prusti/Creusot) gets the disjointness that separation logic's `∗` provides *from the type system*, obtaining the frame rule without explicit `modifies`/separation annotations.
8. (a) **Runtime contract/assertion** — checked during execution, guarantees only *this run on this input* (overhead, late detection). (b) **Property-based test** — checked at test time over *sampled* inputs, a probabilistic guarantee (cheap, refutes but doesn't prove). (c) **Static proof / refinement type** — checked at verify/compile time, guarantees *all* inputs for all time (expensive in invariants/solver effort, zero runtime cost).

</details>

---

## Cheat Sheet

```
HOARE LOGIC
  {P} C {Q}        if P before C and C terminates, then Q after
  [P] C [Q]        total correctness = partial + termination
  assignment       {Q[e/x]} x:=e {Q}          (substitute e for x in Q)
  consequence      strengthen P, weaken Q       (the glue rule)

WEAKEST PRECONDITION (push Q backward)
  wp(x:=e, Q)      = Q[e/x]
  wp(C1;C2, Q)     = wp(C1, wp(C2, Q))
  wp(if b…, Q)     = (b ⇒ wp(C1,Q)) ∧ (¬b ⇒ wp(C2,Q))
  VC               = precondition ⇒ wp(body, postcondition)   (pure FOL)
  valid VC  ⟺  ¬VC is UNSAT   (proved)   |   SAT = counterexample

PIPELINE
  source → IVL (Boogie / Why3) → VCs → SMT (Z3 / CVC5)
  UNSAT=proved  SAT=counterexample  unknown=timeout/incomplete

LOOPS (the human's job)
  invariant I:  P⇒I  ∧  {I∧b} body {I}  ∧  (I∧¬b)⇒Q
  decreases m:  m in a well-founded order, strictly ↓ each iter ⇒ terminates
  tools when stuck:  assert (stepping stone) · lemma · ghost code · {:trigger}

SMT THEORIES
  decidable (qf):   LIA/LRA, arrays, bitvectors, datatypes, EUF
  undecidable:      quantifiers (instantiate via triggers), NONLINEAR (x*y)

HEAP / FRAMING
  modifies S       method changes only S; caller assumes rest preserved
  old(e)           pre-state value of e
  P ∗ Q            separating conjunction (disjoint heaps) → frame rule free
  Rust &mut        borrow checker ⇒ no aliasing ⇒ framing for free (Verus/Prusti)

PROPERTY-BASED TESTING (cheap ∀, samples — never proves)
  generators       constrained construction  >>  generate-and-filter
  shrinking        integrated (choice-sequence/Hypothesis) > type-directed
  measure          classify/label/target()-guided; mutation-test the properties
  stateful/MBT     real vs model = poor-man's refinement check

CONTRACT SPECTRUM (same predicate, 3 strengths)
  assert/contract  runtime    this run        (../../dynamic-analysis-and-sanitizers/)
  property test    test time  sampled inputs  (probabilistic)
  proof / refine   verify     all inputs      (Dafny, Liquid Haskell, Verus)
```

---

## Summary

- A **contract is a Hoare triple** `{P} C {Q}`. Hoare logic's inference rules — the backward **assignment axiom** `{Q[e/x]} x:=e {Q}`, sequence, conditional, and the **consequence** rule — are the entire deductive basis a verifier mechanizes.
- **Weakest preconditions** push the postcondition backward through the code; a verifier computes `precondition ⇒ wp(body, postcondition)` as a **verification condition**, lowering through an **intermediate verification language** (Boogie, Why3) before handing pure logic to an SMT solver. Validity is checked as **unsatisfiability of the negation**.
- **Loops** are the wall: the **invariant** (true on entry, preserved each iteration, implies the postcondition on exit) and the **variant/`decreases`** (a well-founded measure that descends ⇒ termination) are the two things a human almost always supplies. Invariant : loop :: induction hypothesis : recursion.
- The **SMT solver** decides the quantifier-free combination of arithmetic, arrays, bitvectors, datatypes, and EUF instantly — but **quantifiers** (instantiated via triggers) and **nonlinear arithmetic** are undecidable and the usual cause of timeouts. "Might not hold" is a solver-search problem; fix it with `assert`s, lemmas, ghost code, and triggers, not by changing correct code.
- **Framing** the heap is hard because of aliasing; **modifies** clauses state the footprint manually, **separation logic**'s `∗` makes disjointness a primitive, and Rust's **borrow checker** hands ownership-based verifiers framing for free.
- **Property-based testing** is the cheap `∀` — constrained-construction generators over filtering, integrated (choice-sequence) shrinking for minimal counterexamples, and *measured* coverage (classify/`target()`/mutation testing). It samples, so it refutes but never proves.
- The same predicate lives on a **runtime ⇄ tested ⇄ proven** spectrum: assert it at boundaries, property-test the bulk, and prove the catastrophic invariants. **Refinement types** (Liquid Haskell, F\*) fuse the proof into the type system; **gradual verification** and **assume-guarantee** let proof and test coexist.

You now reason about verification as a pipeline from contract to theorem, know exactly where the human's insight is irreducible, and can place each specification at the right cost/assurance point. The next layer — [professional.md](professional.md) — is about operating verification and property testing across a team and a codebase, in CI, under real deadlines.

---

## Further Reading

- *An Axiomatic Basis for Computer Programming* — C. A. R. Hoare (1969). The origin of the triple and the inference rules; still worth reading in the original.
- *A Discipline of Programming* — Edsger W. Dijkstra (1976). The weakest-precondition calculus and the philosophy of deriving programs together with their proofs.
- *Program Proofs* — K. Rustan M. Leino (2023), and the Dafny documentation/tutorials. The definitive modern, hands-on treatment of deductive verification with a real tool.
- *QuickCheck: A Lightweight Tool for Random Testing of Haskell Programs* — Koen Claessen & John Hughes (2000). The paper that started property-based testing.
- *Z3: An Efficient SMT Solver* — Leonardo de Moura & Nikolaj Bjørner (2008), plus the CVC5 papers. How the engine under every verifier actually works.
- *Separation Logic* — Peter O'Hearn (CACM, 2019) and Reynolds's original papers, for the heap/framing story; the Verus and Creusot papers for ownership-based verification.

---

## Related Topics

- [01 — Formal Specification](../01-formal-specification/senior.md) — writing the pre/postconditions and invariants that this page turns into proofs.
- [02 — Model Checking](../02-model-checking/senior.md) — the *automatic, exhaustive* sibling of deductive verification, with no invariants to supply but a state-space ceiling.
- [05 — Proof Assistants & Dependent Types](../05-proof-assistants-and-dependent-types/senior.md) — when SMT isn't enough and you write the proof by hand (Coq/Lean/Isabelle, seL4-style).
- [Testing](../../testing/) — where property-based testing lives in the broader test strategy.
- [Dynamic Analysis & Sanitizers](../../dynamic-analysis-and-sanitizers/) — the runtime end of the contract spectrum: assertions and contracts checked while the program runs.
