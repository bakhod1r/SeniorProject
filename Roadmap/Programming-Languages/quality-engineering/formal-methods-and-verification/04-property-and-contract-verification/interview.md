# Property & Contract Verification — Interview Level

> **Roadmap:** [Formal Methods & Verification](../README.md) → Property & Contract Verification
> *A verification interview rarely asks "what is a theorem." It asks "write three properties for `sort`," "this property is green but the bug shipped — why?", and "your Dafny method won't verify — what do you try?", and then watches whether you can tell a property from an example, a precondition from a postcondition, and a strong invariant from a tautology. This page is the question bank, with model answers and a note on what each question is really probing.*

---

## Table of Contents

1. [How to Use This Page](#how-to-use-this-page)
2. [Introduction](#introduction)
3. [Prerequisites](#prerequisites)
4. [Property-Based Testing](#property-based-testing)
5. [Contracts & Design by Contract](#contracts--design-by-contract)
6. [Deductive Verification](#deductive-verification)
7. [The Ladder & Judgement](#the-ladder--judgement)
8. [Scenario Exercises](#scenario-exercises)
9. [Rapid-Fire](#rapid-fire)
10. [Red Flags / Green Flags](#red-flags--green-flags)
11. [Cheat Sheet](#cheat-sheet)
12. [Summary](#summary)
13. [Further Reading](#further-reading)
14. [Related Topics](#related-topics)

---

## How to Use This Page

Each question carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). Don't memorize the answers — internalize the *distinctions* they keep returning to:

- **example vs property** (one input you picked vs a law over all inputs)
- **finding a bug vs proving its absence** (testing samples; verification quantifies)
- **precondition vs postcondition vs invariant** (caller's duty vs callee's promise vs always-true fact)
- **the spec vs the code** (a green proof against the wrong spec is still wrong)

Nearly every question in this bank is one of those four distinctions wearing a costume. The candidates who do well *name the distinction* before reaching for a tool, and they treat the property/spec as the artifact under scrutiny — not an afterthought to the implementation.

---

## Introduction

This topic spans a ladder. At the bottom is **property-based testing (PBT)** — you state a law (`reverse(reverse(xs)) == xs`), a framework generates hundreds of inputs trying to break it, and on failure *shrinks* the counterexample to something minimal. One rung up, **contracts** (Design by Contract) attach pre/postconditions and invariants to code, checkable at runtime or statically. At the top of what's interviewed here, **deductive verification** (Dafny, Frama-C, SPARK, Why3, Verus) turns code-plus-spec into proof obligations discharged by an SMT solver — a *proof for all inputs*, no sampling.

Interviewers use this topic to test judgement as much as knowledge: can you write a property that actually constrains behaviour, do you know why a passing test suite still ships bugs, and can you make a verifier that "times out" or says "this might not hold" succeed? The thread tying it together is the **test-oracle problem** — knowing what the *right* answer is without recomputing it — and the answer at every rung is the same shape: state a *checkable property* that is cheaper than, and independent of, the implementation.

---

## Prerequisites

You should be comfortable with:

- **Unit testing and assertions** — what an example-based test is, why coverage ≠ correctness.
- **Basic logic** — implication, quantifiers (∀/∃), and the difference between "for some" and "for all."
- **Function specifications** — the idea that a function has an intended contract, even if only in a docstring.
- **Reading a stack trace / counterexample** — you'll be handed minimized failing inputs and asked to diagnose.

If "for all inputs" feels foreign, start with [junior.md](junior.md). If you want the engineering-economics and rollout view, read [senior.md](senior.md).

---

## Property-Based Testing

### Q: What is property-based testing, and how does it differ from example-based testing?

> **Testing:** The core mental shift — from "input → expected output" to "law over all inputs."

**A.** An example test asserts one concrete pair: `assert add(2, 3) == 5`. A **property** asserts a *law* that must hold for **all** inputs in some domain, and the framework supplies the inputs: `for all integers a, b: add(a, b) == add(b, a)`. Three pieces define PBT:

1. **A `for all` quantifier** — the assertion is universal, not pointwise.
2. **Generated inputs** — the framework produces hundreds or thousands of cases (random, often coverage- or distribution-guided), exploring corners you'd never hand-pick.
3. **Shrinking** — on failure it reduces the counterexample to a minimal one before reporting.

```python
from hypothesis import given, strategies as st

@given(st.lists(st.integers()))
def test_sort_is_idempotent(xs):
    assert sorted(sorted(xs)) == sorted(xs)
```

The mental shift: example tests encode *answers you computed by hand*; properties encode *truths about the function* and delegate input selection to a machine that is better at finding edge cases than you are. PBT doesn't replace examples — a few hand-picked examples document intent and pin known regressions — but it dramatically widens the input space a single test covers.

### Q: Name the classic property patterns. How do you find a property when "I don't know the expected output"?

> **Testing:** Whether you have a *vocabulary* of property shapes — the difference between someone who's read about PBT and someone who writes properties under pressure.

**A.** The named patterns, each a recipe for finding a property without precomputing the answer:

| Pattern | Shape | Example |
|---|---|---|
| **Round-trip** | `decode(encode(x)) == x` | `parse(serialize(obj)) == obj`; `decompress(compress(b)) == b` |
| **Idempotence** | `f(f(x)) == f(x)` | `sort`, `normalize`, `dedupe`, `abs` |
| **Invariant** | a fact true of every output | `sorted(xs)` is ordered and a permutation of `xs` |
| **Commutativity / associativity** | `f(a,b) == f(b,a)` | `add`, set union, `merge` |
| **Model / oracle** | matches a simpler reference | fast impl == naive impl; cache == plain dict |
| **Metamorphic** | relation between *related* inputs/outputs | `sin(x) == sin(x + 2π)`; `len(sort(xs)) == len(xs)`; adding an item only grows a sum |

The **test-oracle problem** is exactly "I don't know the right answer to assert." These patterns solve it by asserting a *relation* instead of a value: round-trip needs no oracle (the input *is* the oracle), a model test borrows a trusted-but-slow oracle, and metamorphic testing asserts how outputs must relate when you perturb the input — useful for the hardest cases (ML models, scientific code, compilers) where no oracle exists at all.

### Q: What is shrinking, and why does it matter so much in practice?

> **Testing:** Whether you understand that a *minimal* counterexample is the product, not the raw failing input.

**A.** When a property fails, the failing input is often huge and noisy — a list of 800 random integers. **Shrinking** automatically searches for a *smaller* input that still fails: drop elements, shrink integers toward zero, simplify strings. You end up with something like `[0, 0]` or `[1, 0]` instead of the 800-element mess.

It matters because **debugging time is dominated by understanding the failure, not finding it.** A minimized counterexample often reveals the bug by inspection — "ah, it breaks with duplicates" or "it breaks on the empty string." Without shrinking, PBT would hand you a haystack and say "there's a needle." With it, you get the needle. A subtlety worth mentioning: shrinking must preserve the input's *validity constraints* (a shrunk input must still satisfy your generator's preconditions), which is why integrated shrinking (Hypothesis, fast-check, proptest) — where the generator knows how to shrink — beats the older type-directed shrinking that could shrink into invalid states.

### Q: What separates a *good* property from a tautological one? Give an example of each.

> **Testing:** The single most important PBT skill — and the answer to "why did a green property still ship a bug?"

**A.** A **good** property constrains behaviour *independently of the implementation*. A **tautological** (weak) property restates the implementation, or is trivially true, so it can never fail no matter how broken the code is.

```python
# WEAK / tautological — reimplements sort, so a bug in BOTH passes;
# and if it just calls the same function, it asserts f(x) == f(x).
@given(st.lists(st.integers()))
def test_sort_bad(xs):
    assert my_sort(xs) == sorted(xs) if xs == sorted(xs) else True  # vacuous branch

# STRONG — two independent facts that pin down "sorted" completely
@given(st.lists(st.integers()))
def test_sort_good(xs):
    out = my_sort(xs)
    assert all(out[i] <= out[i+1] for i in range(len(out)-1))   # ordered
    assert sorted(out) == sorted(xs)                            # same multiset (permutation)
```

The "ordered" check alone is insufficient — `return []` satisfies it. You need *ordered* **and** *a permutation of the input*; together they uniquely characterize sorting. The tells of a weak property: it can't fail (vacuously true, or guarded into a no-op), it duplicates the code's logic (so shared bugs survive), or it only checks a type/shape, not a relationship. Strong properties are **independent**, **complete enough to exclude trivial wrong answers**, and **falsifiable**.

> **Rule of thumb:** before trusting a property, ask "what's the dumbest wrong implementation that still passes this?" If `return []` or `return x` passes, the property is too weak.

### Q: What is stateful (model-based) property testing, and when do you reach for it?

> **Testing:** Whether you can apply PBT to *systems with state*, not just pure functions.

**A.** Pure-function PBT generates *inputs*; **stateful PBT** generates *sequences of operations* and checks that the system under test behaves like a simpler **model** after every step. You define the commands (`put`, `get`, `delete`, `evict`), a model (often a plain dictionary or list), preconditions for when each command is legal, and a postcondition comparing real vs model state. The framework generates random valid command sequences, runs them against both, and **shrinks the failing *sequence*** to the shortest one that diverges.

```python
from hypothesis.stateful import RuleBasedStateMachine, rule, invariant
from hypothesis import strategies as st

class LRUModel(RuleBasedStateMachine):
    def __init__(self):
        super().__init__()
        self.cache = LRUCache(capacity=3)
        self.model = {}            # simplified reference (ignores eviction order)

    @rule(k=st.integers(0, 5), v=st.integers())
    def put(self, k, v):
        self.cache.put(k, v)
        self.model[k] = v

    @rule(k=st.integers(0, 5))
    def get(self, k):
        assert self.cache.get(k) == self.model.get(k, -1)

    @invariant()
    def never_exceeds_capacity(self):
        assert self.cache.size() <= 3
```

You reach for it whenever bugs are about **ordering and interaction** — caches, state machines, allocators, connection pools, parsers with modes, anything where a single call is fine but a *sequence* corrupts state. This is the closest PBT gets to model checking: it's exploring reachable states of a real implementation against a spec, just by sampling rather than exhaustively.

### Q: Which PBT tools should I know, and roughly what's their flavour?

> **Testing:** Breadth — that you know this is an ecosystem, not one library.

**A.** The lineage starts with **QuickCheck** (Haskell, Claessen & Hughes 2000) — the original, type-directed generators with explicit shrinking. The ones to name by ecosystem:

- **Hypothesis** (Python) — integrated shrinking, a database of failing examples (replays last failure first), excellent stateful testing.
- **fast-check** (JS/TS) — the de-facto JS one; integrated shrinking, model-based testing, async support.
- **proptest** / **quickcheck** (Rust) — `proptest` has integrated shrinking and a regression-seed file; `quickcheck` is the simpler classic port.
- **gopter** / `testing/quick` (Go) — `gopter` for full-featured generators and stateful commands; the stdlib `testing/quick` is minimal and largely superseded.
- **ScalaCheck**, **jqwik** (JVM), **Hedgehog** (Haskell/F#, integrated shrinking) round out the field.

The distinction worth knowing: **integrated shrinking** (Hypothesis, Hedgehog, fast-check, proptest) ties shrinking to the generator so shrunk values stay valid; older **type-directed shrinking** (classic QuickCheck) shrinks by type and can produce inputs that violate your generator's constraints. If asked which to pick, the answer is "the idiomatic one for the language, and prefer integrated shrinking."

---

## Contracts & Design by Contract

### Q: Explain preconditions, postconditions, and invariants — and who *owns* each.

> **Testing:** Whether you understand contracts as a *blame-assignment* protocol, not just runtime asserts.

**A.** Design by Contract (Meyer, Eiffel) models a method as a contract between caller and callee:

- **Precondition** (`requires`) — what must be true *on entry*. **The caller owns it.** If it's violated, the *caller* has the bug. ("Don't call `withdraw` with a negative amount.")
- **Postcondition** (`ensures`) — what the method guarantees *on exit*, **given** the precondition held. **The callee owns it.** If the precondition held but the postcondition fails, the *implementation* has the bug. ("After `push`, size increased by one.")
- **Class invariant** — a fact true of every object *between* public method calls (it may be temporarily broken mid-method). **The class owns it collectively.** ("A `Date`'s month is always 1–12"; "balance is never negative.")

The power is in **blame assignment**: when a contract fails, it tells you *which side* is wrong, which is exactly what you can't get from a bare `assert` deep in the code. It also makes specifications *executable and located at the boundary* rather than buried in prose. The precondition/postcondition split is the same `{P} C {Q}` Hoare triple you'll see in deductive verification — contracts are Hoare logic with a runtime fallback.

### Q: What does `old()` mean in a postcondition, and why is it necessary?

> **Testing:** A small but telling detail — whether you've actually written postconditions about *change*.

**A.** `old(e)` refers to the value of expression `e` **as it was on method entry**, evaluated in the pre-state. It's necessary because many postconditions are about a *transition*, not an absolute value, and you need to refer back to the "before" to express the "after."

```dafny
method Push(x: int)
  modifies this
  ensures size == old(size) + 1          // grew by exactly one
  ensures items[old(size)] == x          // the new element landed at the old end
```

Without `old`, you can only say `size == ...some fixed thing...`; you can't say "size increased by one" or "the balance went down by exactly `amount`." It's the contract vocabulary for *deltas*. (In Frama-C/ACSL it's `\old`; in JML it's `\old`; same concept.)

### Q: Runtime-checked contracts vs statically-verified contracts — what's the trade?

> **Testing:** Whether you see contracts as spanning the ladder from cheap to rigorous.

**A.** **Runtime-checked** contracts (Eiffel, Python `assert`/`icontract`, `<cassert>`, Java with a contracts lib) execute the conditions during runs and throw on violation. Cheap, language-agnostic, and they double as oracles for tests — but they only catch violations *on inputs you actually execute*, and they cost runtime, so they're often disabled in production.

**Statically-verified** contracts (Dafny, SPARK, Frama-C, Verus) feed the same pre/postconditions to a verifier that *proves* they hold on **all** inputs, at build time, with zero runtime cost. The price: you must write specs the tool can reason about, supply loop invariants, and sometimes fight solver timeouts.

The clean framing: same contract, two enforcement strategies — **test it (runtime, sampled) or prove it (static, exhaustive).** A mature codebase often writes the contract once and *runtime-checks it in dev/CI while statically verifying the critical core*. Contracts are the shared interface across the whole verification ladder.

### Q: How are contracts "checkable documentation"?

> **Testing:** Why contracts beat prose docstrings.

**A.** A docstring that says "amount must be positive" rots — nothing enforces it, so it drifts from the code and lies. A precondition `requires amount > 0` is the *same statement* but **machine-checked**: it can't be wrong without the tool (or a runtime check) screaming. So contracts are documentation that *cannot silently go stale*, that lives at the call boundary where it's relevant, and that a tool can use to (a) catch misuse, (b) generate test inputs, or (c) prove correctness. The senior point: contracts collapse "the docs," "the validation," and "the spec" into one artifact, removing the gap where the three normally disagree.

---

## Deductive Verification

### Q: What is a Hoare triple, and what does `{P} C {Q}` actually claim?

> **Testing:** The foundational notation of deductive verification.

**A.** A **Hoare triple** `{P} C {Q}` reads: *if* precondition `P` holds before executing command `C`, *then* `Q` holds afterward (for **partial correctness** — assuming `C` terminates). `P` is the precondition, `C` the code, `Q` the postcondition. **Total correctness** additionally requires that `C` *terminates*.

Example: `{ x >= 0 } y := x + 1 { y > 0 }` — if `x` is non-negative going in, `y` is positive coming out. This is the formal core of contracts: `requires` is `P`, `ensures` is `Q`, the method body is `C`. Deductive verification is the activity of *proving* such triples for real code — and the whole game is that the tool reduces the triple to logical formulas it can check, while you supply the reasoning it can't infer (chiefly loop invariants).

### Q: What is the weakest precondition, and why does the verifier care?

> **Testing:** The mechanism that turns code into a formula — senior depth.

**A.** The **weakest precondition** `wp(C, Q)` is the *most permissive* condition on the input such that running `C` is guaranteed to establish `Q`. It's computed *backwards* over the program: assignment substitutes (`wp(x := e, Q) = Q[x := e]`), sequencing composes (`wp(C1; C2, Q) = wp(C1, wp(C2, Q))`), conditionals split on the guard.

The verifier cares because proving `{P} C {Q}` reduces to proving the single implication **`P ⟹ wp(C, Q)`** — a logic formula with no program left in it, which an SMT solver can attempt. So `wp` is the engine that transforms "is this code correct?" into "is this formula valid?" (This is essentially how the **verification condition** is generated; see the next question.) "Weakest" matters because it's the *necessary and sufficient* condition — anything weaker wouldn't guarantee `Q`, anything stronger would reject correct callers.

### Q: Why must *you* supply loop invariants? Why can't the tool figure them out?

> **Testing:** The number-one practical skill in deductive verification — and the most common reason a method won't verify.

**A.** A loop runs an unknown number of times, so `wp` can't simply unfold it — there's no fixed number of iterations to substitute through. The **loop invariant** is a property that (a) holds *before* the loop, (b) is *preserved* by one iteration (if it holds at the top and the guard is true, it holds again at the bottom), and (c) together with the *negated guard* implies the postcondition. Given the invariant, the verifier checks just those three local facts — initialization, preservation, and exit — instead of reasoning about every possible iteration count.

The tool can't always *infer* it because finding a loop invariant is, in general, **undecidable** — it's the creative heart of the proof, equivalent to understanding *why* the loop works. Inference heuristics exist (abstract interpretation, Houdini, interpolation) and handle simple loops, but the moment the invariant involves quantifiers or non-linear facts, you must write it.

```dafny
method Sum(a: array<int>) returns (s: int)
  ensures s == SumTo(a, a.Length)
{
  s := 0;
  var i := 0;
  while i < a.Length
    invariant 0 <= i <= a.Length          // i stays in range
    invariant s == SumTo(a, i)            // s is the sum of the first i elements
    decreases a.Length - i                // termination measure (see below)
  {
    s := s + a[i];
    i := i + 1;
  }
}
```

Without `invariant s == SumTo(a, i)`, the verifier knows nothing about `s` after the loop and the postcondition fails. The invariant is *exactly the knowledge the tool lacks*.

### Q: What is a loop variant / `decreases`, and what does it buy you?

> **Testing:** Termination vs partial correctness — the total-correctness half.

**A.** A **variant** (Dafny's `decreases` clause) is an expression that (a) is bounded below (typically ≥ 0) and (b) **strictly decreases on every iteration**. Since a non-negative integer can't decrease forever, the loop must terminate — that's the proof of **termination**, the missing half of *total* correctness.

In the example above, `decreases a.Length - i`: each iteration increments `i`, so `a.Length - i` strictly drops and is bounded by 0. Without a variant you only get **partial** correctness ("*if* it terminates, the result is right") — a program that infinite-loops trivially satisfies any partial-correctness spec. Variants also justify terminating **recursion** (the recursive call must be on a strictly-smaller variant). When Dafny complains it "can't prove termination," it's asking for a `decreases` clause it can verify.

### Q: How do these tools actually discharge proofs? Where does Z3 fit?

> **Testing:** The pipeline from code to "verified" — that you know there's an SMT solver underneath.

**A.** The pipeline is: **code + specs → verification conditions (VCs) → SMT solver → verified / counterexample.**

1. The verifier computes weakest preconditions / VC generation, turning each method (with its contracts and loop invariants) into a set of **verification conditions** — pure logic formulas whose validity implies the code meets its spec.
2. It hands those VCs to an **SMT solver** (**Z3**, **CVC5**) — a tool that decides satisfiability *modulo theories* like integer/real arithmetic, arrays, bitvectors, and uninterpreted functions.
3. The solver tries to find a model that makes the *negation* of the VC true (a counterexample). **No such model ⟹ the VC is valid ⟹ verified.** A model found ⟹ a concrete counterexample the tool reports back ("this might not hold, e.g. when `x = -1`").

Dafny, Why3, Frama-C/WP, SPARK, and Verus all sit on this architecture — they differ in language and front-end, but Z3/CVC5 is the common engine. The practical consequence: your specs must land in theories the solver handles well; push outside them and you hit timeouts.

### Q: Why does a verifier "time out" or say "this might not hold," and how do you help it?

> **Testing:** The single most-asked scenario for anyone who's used Dafny/Frama-C — turning a stuck proof into a passing one.

**A.** Two distinct failures, with different fixes:

**"This might not hold"** means the solver found (or couldn't rule out) a **counterexample** — the property genuinely doesn't follow from what the tool knows. Either the code is wrong, or — far more often — you haven't *told the tool enough*. Fixes:

- **Strengthen the loop invariant.** The usual culprit: the invariant is true but too weak to imply the postcondition. Add the missing fact.
- **Add intermediate `assert`s.** An assertion is a stepping-stone; proving a hard postcondition often works once you assert the lemma the solver needed in the middle.
- **Add a `lemma` (and call it).** Factor a reusable proof step into a lemma — especially for facts about recursive functions the solver won't unfold on its own.
- **Add ghost code / ghost variables.** Verification-only state (erased at compile time) that records *why* something is true, giving the solver a witness.
- **Check the spec itself.** Sometimes the spec is wrong or vacuous — verify you're proving the thing you mean.

**"Timeout / verification inconclusive"** means the VC is likely valid but the solver got lost in the search space — typically because of **quantifiers** (the solver instantiates them via brittle "triggers" and can diverge) or non-linear arithmetic. Fixes:

- **Reduce quantifier reasoning** — assert specific instances so the solver doesn't have to guess instantiations; add explicit trigger annotations.
- **Break the method up** — smaller methods = smaller VCs = easier solves.
- **Avoid non-linear arithmetic** where possible, or prove the needed facts as separate lemmas.

The mindset: a stuck proof is usually a **communication** failure, not a correctness failure — the tool needs a hint (invariant, assert, lemma) you can see and it can't.

### Q: What does "decidable theory vs quantifiers" mean for what you can verify cheaply?

> **Testing:** Why some proofs are instant and others hang — staff-level intuition.

**A.** SMT solvers are *decision procedures* for certain **decidable theories** — quantifier-free linear integer/real arithmetic, the theory of arrays, bitvectors, equality with uninterpreted functions. Inside those, the solver is fast and *complete*: it always terminates with a definite yes/no. The trouble starts with **quantifiers** (∀/∃ over infinite domains) and **non-linear arithmetic** (multiplying variables) — these are **undecidable** in general, so the solver falls back to *heuristic instantiation* (guessing which terms to plug into a ∀ via syntactic "triggers"). That's where the unpredictability lives: it may find the instantiation instantly or loop forever.

The practical upshot: **specs that stay in decidable, quantifier-free territory verify reliably; the more quantifiers and non-linear math you introduce, the more you must hand-hold the solver** with asserts, lemmas, and triggers. Knowing this tells you *how to write specs that verify* — push the hard reasoning into lemmas, keep the per-method VCs simple.

### Q: What are refinement types, and how do they relate to contracts?

> **Testing:** Knowing the "types as proofs" rung — Liquid Haskell / F* awareness.

**A.** A **refinement type** is a base type *plus a predicate*: `{v: Int | v > 0}` is "positive integers," `{v: [a] | len v == n}` is "lists of length n." The type system, backed by an SMT solver, **proves** the predicates hold — so a precondition becomes part of the *type signature* and is checked at compile time, no separate proof script.

```haskell
{-@ divide :: Int -> {d:Int | d /= 0} -> Int @-}   -- Liquid Haskell: divisor can't be 0
divide x d = x `div` d
```

They relate to contracts as **contracts pushed into the type system**: `{d:Int | d /= 0}` *is* the precondition `requires d != 0`, but enforced by type checking and propagated through the program automatically. **Liquid Haskell** retrofits refinement types onto Haskell; **F\*** and **Dafny** support them too; Rust's type system is a (weaker) cousin. The selling point is **incrementality** — you get lightweight proofs woven into ordinary code, lighter than a full Hoare-logic proof but stronger than runtime contracts. On the ladder, refinement types sit between contracts and full deductive proof.

### Q: Which deductive-verification tools should I be able to name and place?

> **Testing:** Breadth across the verification ecosystem.

**A.**

- **Dafny** (Microsoft) — verification-first language, contracts + loop invariants + `decreases`, Z3 backend; the standard teaching/interview tool.
- **Frama-C** (+ ACSL, WP plugin) — verifies **existing C** by annotation; used in safety-critical/embedded.
- **SPARK** (Ada subset) — industrial deductive verification for high-integrity systems (avionics, rail, defence).
- **Why3** — a verification *platform* / intermediate language many tools (incl. Frama-C) target; multi-prover.
- **Verus** — verifies **Rust** with SMT; brings deductive proof to systems code.
- **Refinement types:** **Liquid Haskell**, **F\*** (used to verify crypto in **HACL\*** / **EverCrypt**, shipped in Firefox).

The grouping interviewers want: *verification-first languages* (Dafny, Verus), *annotate-an-existing-language* (Frama-C for C, SPARK for Ada), *platforms* (Why3), and *type-level* (Liquid Haskell, F\*). One level up are **proof assistants** (Coq/Lean/Isabelle) — covered in [05](../05-proof-assistants-and-dependent-types/interview.md) — which prove *arbitrary* theorems but don't auto-discharge VCs.

---

## The Ladder & Judgement

### Q: Lay out the verification ladder from cheapest to strongest. How do you choose a rung?

> **Testing:** The judgement that separates a tool-collector from an engineer.

**A.** The rungs, increasing in cost and in strength of claim:

1. **Example tests** — "works on the cases I picked." Cheapest, always present.
2. **Property-based testing** — "no counterexample found in N generated inputs satisfying my invariants." Low cost, big coverage jump.
3. **Contracts (runtime)** — "no contract violation on the inputs we ran," plus blame assignment and live documentation.
4. **Refinement types / deductive proof** — "meets its spec on **all** inputs," at build time, zero runtime cost.
5. **Proof assistants** — "machine-checked proof of arbitrary theorems," maximal assurance, maximal effort.

You choose **by matching the rung to the risk**, not by climbing as high as possible. The guiding maxim is **"verify the core, test the rest"**: prove the 5% that is catastrophic-if-wrong (a consensus algorithm, a crypto primitive, an allocator, a billing calculation), property-test the next tier (parsers, serializers, data-structure libraries), and example-test the bulk. Cost rises steeply per rung and the *spec* becomes the dominant artifact (and the dominant risk) at rungs 4–5. The wrong move is uniform treatment — proving glue code, or example-testing a kernel.

### Q: Where does PBT have the best ROI? Where is it a poor fit?

> **Testing:** Concrete judgement about *where* the cheap rung pays.

**A.** **Best ROI** — code with a clear, cheap-to-state property and a wide input space:

- **Round-trip code** — serializers, parsers, encoders, compression. The property writes itself (`decode∘encode == id`) and bugs hide in inputs you'd never pick (empty, unicode, nesting, huge).
- **Data structures / algorithms** — sort, search trees, heaps, caches; check invariants + model equivalence.
- **Stateful systems** with a simple model — caches, allocators, state machines (via stateful PBT).
- **Pure functions with algebraic laws** — math, financial calculations, set/collection ops.

**Poor fit:**

- **No checkable property** — UI layout, "looks right," subjective output (though metamorphic testing can sometimes rescue these).
- **Expensive generators or expensive single runs** — if one case takes seconds, hundreds of cases is a slow suite.
- **Trivial logic** — a getter doesn't need a property.
- **Where you actually need a *proof*** — for the catastrophic core, PBT's "no counterexample *found*" isn't "no counterexample *exists*"; climb the ladder.

The heuristic: **PBT pays most where you can state a law cheaply and the input space is large and adversarial.** That's why round-trips and data structures are the canonical wins.

### Q: A teammate says "we have 95% coverage, we don't need property tests or proofs." Respond.

> **Testing:** Whether you can articulate the limits of coverage and the value-add of each rung.

**A.** Coverage measures **which lines/branches ran**, not **whether they're correct on the inputs that matter**. You can hit 100% coverage with assertions that never actually constrain the output (or with `assert True`), and coverage says nothing about the inputs you *didn't* try — the empty list, the integer overflow, the duplicate key, the 65,535-byte string. PBT *generates* exactly those adversarial inputs and checks a real law, so it finds correctness bugs in *covered* code. Contracts add blame assignment and stop bad inputs at the boundary. And for the genuinely catastrophic core, even exhaustive *testing* is sampling — only a *proof* gives "correct on all inputs."

So the honest answer: 95% coverage is necessary hygiene, not a correctness argument. Keep it, but add property tests where laws are cheap to state, and reserve proof for the parts where a single bug is unacceptable. Coverage tells you *the tests touched the code*; it never tells you *the code is right*.

---

## Scenario Exercises

### Q: Write three properties for `sort(xs)`.

> **Testing:** Can you produce *strong, independent* properties on demand — the canonical exercise.

**A.** The three that *together* characterize sorting (no single one suffices):

```python
@given(st.lists(st.integers()))
def test_ordered(xs):
    out = my_sort(xs)
    assert all(out[i] <= out[i+1] for i in range(len(out)-1))   # 1. output is ordered

@given(st.lists(st.integers()))
def test_permutation(xs):
    assert sorted(my_sort(xs)) == sorted(xs)                    # 2. same multiset as input

@given(st.lists(st.integers()))
def test_idempotent(xs):
    assert my_sort(my_sort(xs)) == my_sort(xs)                  # 3. sorting twice == once
```

The key insight to *say out loud*: **"ordered" alone is satisfied by `return []`** — you need the **permutation** property to forbid dropping/adding/changing elements. Ordered + permutation is the complete spec; idempotence is a bonus consistency check. (If sort is meant to be *stable*, add a fourth: equal keys preserve input order — check by sorting `(key, original_index)` pairs.) Pairing with a model (`my_sort(xs) == sorted(xs)`) is also valid but couples you to a trusted oracle; the invariant-based pair is oracle-free.

### Q: Write properties for a JSON serializer and for an LRU cache.

> **Testing:** Applying the right *patterns* to two different shapes — round-trip and stateful.

**A.** **JSON serializer — round-trip is the headline property:**

```python
@given(st.recursive(
    st.none() | st.booleans() | st.integers() | st.text(),
    lambda children: st.lists(children) | st.dictionaries(st.text(), children)))
def test_json_roundtrip(value):
    assert json.loads(json.dumps(value)) == value             # decode∘encode == id
```

Plus: **idempotence of re-encoding** (`dumps(loads(s))` is stable for canonical `s`), and an **invariant** (output is always valid JSON / parseable). The round-trip needs **no oracle** — the input is the expected output — and it hammers exactly the corners (unicode, nesting, special floats, empty containers) that break serializers.

**LRU cache — this is stateful PBT** (sequences of ops vs a model). Key properties:

- **Model equivalence:** after any sequence of `put`/`get`, a `get(k)` returns what a reference model says (a dict for values; a list for recency).
- **Capacity invariant:** `size() <= capacity` after every operation (an `@invariant`).
- **Eviction policy:** after filling to capacity and accessing key `A`, the *next* eviction is **not** `A` (the least-recently-used goes first). This is the property that actually tests "LRU" rather than "some cache."

The lesson the interviewer wants: **match the pattern to the shape** — round-trip for the serializer, stateful model + invariant + a policy-specific property for the cache.

### Q: This property passes, but bugs still ship. Walk me through the likely causes.

> **Testing:** Diagnosis of *false confidence* — the most important PBT failure mode.

**A.** Green-but-buggy almost always traces to one of four causes:

1. **Weak / tautological property.** It can't fail — vacuously true, guarded into a no-op, or it reimplements the code so a shared bug survives. *Test:* "what's the dumbest wrong implementation that still passes?" If `return []`/`return x` passes, it's too weak.
2. **Bad generators — the input distribution misses the bug.** The bug lives at the empty input, or at duplicates, or at a 50,000-element list, and the generator rarely or never produces those. PBT only finds bugs in inputs it *generates*; skewed generators leave blind spots. *Fix:* widen ranges, add edge cases explicitly, check the generated-value distribution.
3. **Too few examples / shallow search.** Default example counts (often ~100) may not hit a rare path. *Fix:* raise the count for critical properties, seed with known-tricky cases, persist failing examples.
4. **Filtered-away inputs (vacuous testing).** Heavy `assume`/filtering can discard most generated inputs, so the property runs on a tiny, non-representative slice — or hits the "too many filtered" health check and silently tests almost nothing. *Fix:* generate valid inputs *constructively* instead of filtering.

The meta-point: **"the property passed" means "no counterexample was *found*," not "none *exists*."** Confidence depends on the property being strong, the generators covering the space, and the search being deep enough.

### Q: Your Dafny method won't verify. What's your checklist?

> **Testing:** Systematic debugging of a stuck proof — the deductive-verification analogue of "the binary won't link."

**A.** First **classify the message**: "*this might not hold*" (a real or apparent counterexample — missing knowledge) vs "*timeout/inconclusive*" (solver lost in the search space). Then, roughly in order:

1. **Is it a loop?** Almost always the missing piece is the **loop invariant** — and usually it's *too weak* to imply the postcondition. Strengthen it; make sure it captures *every* fact the postcondition needs.
2. **Add `decreases`** if it's complaining about **termination** (or recursion).
3. **Add intermediate `assert`s** between the loop and the postcondition. If an assert *fails*, you've localized the gap; if asserting a lemma makes the postcondition *pass*, the solver just needed that stepping-stone.
4. **Introduce a `lemma`** (and *call* it) for facts about recursive functions or anything the solver won't unfold itself; add **ghost variables** to witness *why* something holds.
5. **Suspect the spec.** Re-read `requires`/`ensures` — is the spec wrong, contradictory, or vacuous (a false `requires` makes everything "verify" for the wrong reason)? Add a tiny test/`assert false` reachability check.
6. **If it's a timeout:** simplify — break the method up, assert specific quantifier instances, fix triggers, avoid non-linear arithmetic, raise the time limit only as a last resort.

The framing to lead with: **a stuck proof is usually a *communication* gap — the tool needs an invariant/assert/lemma I can see and it can't — not necessarily a bug in the code.**

---

## Rapid-Fire

> Short questions to check breadth. One or two sentences each.

- **Q: PBT in one line?** A: State a `for all` law, let the framework generate inputs and shrink counterexamples.
- **Q: What is shrinking?** A: Auto-reducing a failing input to a minimal one so the bug is obvious.
- **Q: Name three property patterns.** A: Round-trip, idempotence, invariant (also commutativity, model/oracle, metamorphic).
- **Q: The test-oracle problem?** A: Knowing the correct answer without recomputing it; round-trip and metamorphic properties sidestep it.
- **Q: One sign of a weak property?** A: `return []` or `return x` still passes it.
- **Q: Precondition — whose fault if violated?** A: The **caller's**.
- **Q: Postcondition — whose fault if violated (given the precondition held)?** A: The **callee/implementation's**.
- **Q: What is `old(x)`?** A: The value of `x` on method entry, for postconditions about change.
- **Q: A Hoare triple `{P} C {Q}`?** A: If `P` holds before `C`, then `Q` holds after (partial correctness).
- **Q: Partial vs total correctness?** A: Total adds **termination**; partial assumes it.
- **Q: What proves termination?** A: A **variant** / `decreases` — a bounded, strictly-decreasing measure.
- **Q: Why supply loop invariants?** A: Inferring them is undecidable; they're the knowledge `wp` can't compute past a loop.
- **Q: What discharges a verification condition?** A: An SMT solver — **Z3** or **CVC5**.
- **Q: Why does a verifier time out?** A: Usually quantifiers or non-linear arithmetic blow up the solver's search.
- **Q: First move on "might not hold"?** A: Strengthen the loop invariant or add an intermediate `assert`.
- **Q: A refinement type?** A: A base type plus an SMT-checked predicate, e.g. `{v:Int | v > 0}`.
- **Q: Name a refinement-typed language.** A: Liquid Haskell or F\*.
- **Q: "Verify the core, test the rest" means?** A: Prove the catastrophic 5%; property/example-test the rest.
- **Q: Where does PBT pay best?** A: Round-trips and data structures — cheap law, large adversarial input space.
- **Q: Stateful PBT tests what?** A: Sequences of operations against a simple model (caches, state machines).

---

## Red Flags / Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**
- Writing a property that just reimplements the function (shared bug survives) or one that can't fail.
- Checking only that `sort` is ordered, forgetting the permutation property.
- Thinking "the property passed" means "no bug exists."
- Confusing who owns a precondition vs a postcondition.
- Believing the verifier *should* infer loop invariants, or not knowing what a loop invariant is.
- Forgetting termination — treating partial correctness as the whole story.
- Reaching straight for a proof assistant when a property test would do, or example-testing a kernel.
- Treating a proof as gospel without questioning the **spec** it was proved against.

**Green flags:**
- Asking "what's the dumbest wrong implementation that still passes?" before trusting a property.
- Producing *independent, complete* properties (ordered **and** permutation) and naming the pattern.
- Naming the distinction (example/property, pre/post/invariant, partial/total) before the tool.
- Treating a stuck proof as a *communication gap* and reaching for invariant → assert → lemma → check-the-spec.
- Knowing the SMT engine underneath (Z3/CVC5) and why quantifiers cause timeouts.
- Framing the ladder by **risk** — "verify the core, test the rest" — not by climbing as high as possible.
- Caveating PBT honestly ("no counterexample *found*, not *proven* absent") and metamorphic testing for no-oracle cases.

---

## Cheat Sheet

| Concept | One-liner |
|---|---|
| **Property vs example** | A law over *all* inputs vs one input/output pair you picked. |
| **Shrinking** | Auto-minimize a failing input so the bug is obvious. |
| **Round-trip** | `decode(encode(x)) == x` — oracle-free. |
| **Idempotence** | `f(f(x)) == f(x)`. |
| **Model/oracle** | Compare against a simpler trusted reference. |
| **Metamorphic** | Relate outputs of *related* inputs when no oracle exists. |
| **Strong property** | Excludes trivial wrong answers; independent of the impl; falsifiable. |
| **Precondition (`requires`)** | Caller's duty; violation = caller's bug. |
| **Postcondition (`ensures`)** | Callee's promise given the precondition; violation = impl bug. |
| **Invariant** | True between public calls; may break mid-method. |
| **`old(e)`** | Value of `e` on entry — for postconditions about change. |
| **Hoare triple `{P}C{Q}`** | If `P` before `C`, then `Q` after (partial). |
| **Total correctness** | Partial + **termination**. |
| **Weakest precondition** | Most permissive `P` guaranteeing `Q`; turns code into a formula. |
| **Loop invariant** | Holds before, preserved each iteration, + ¬guard ⟹ postcondition. |
| **Variant / `decreases`** | Bounded, strictly-decreasing measure ⟹ termination. |
| **VC → SMT** | Verifier emits formulas; Z3/CVC5 prove valid or return a counterexample. |
| **Decidable theory** | Quantifier-free arithmetic/arrays/bitvectors — fast, complete. |
| **Quantifiers / non-linear** | Undecidable in general; cause timeouts; need asserts/lemmas/triggers. |
| **Refinement type** | Base type + SMT-checked predicate, e.g. `{v:Int | v != 0}`. |
| **The ladder** | examples → PBT → contracts → refinement/deductive → proof assistants. |
| **The maxim** | "Verify the core, test the rest." |

---

## Summary

- The bank reduces to four distinctions in costumes: **example vs property**, **finding a bug vs proving absence**, **precondition vs postcondition vs invariant**, **the spec vs the code**. Name the distinction first; the tool follows.
- **PBT** asserts a `for all` law, generates inputs, and **shrinks** failures. Know the patterns (round-trip, idempotence, invariant, commutativity, model, metamorphic), the **test-oracle problem**, and — above all — what makes a property **strong** rather than tautological (`return []` must not pass).
- **Contracts** are Hoare logic with a runtime fallback: **caller owns the precondition, callee owns the postcondition**, the class owns the invariant; `old()` expresses change; they're documentation that can't silently rot.
- **Deductive verification** turns `{P} C {Q}` into verification conditions via weakest preconditions, discharged by **Z3/CVC5**. You supply **loop invariants** (inference is undecidable) and a **`decreases`** variant for termination; a stuck proof is usually a communication gap fixed by stronger invariants, asserts, lemmas, ghost code, or fixing the spec.
- **Refinement types** (Liquid Haskell, F\*) push contracts into the type system — SMT-checked predicates on types, lighter than full proof.
- **Judgement** is the staff-level signal: climb the ladder by **risk**, "**verify the core, test the rest**," and put PBT where laws are cheap and inputs are wide (round-trips, data structures). "The property passed" is "no counterexample found," never "none exists."

---

## Further Reading

- **Claessen & Hughes, "QuickCheck: A Lightweight Tool for Random Testing of Haskell Programs"** (ICFP 2000) — the founding paper; read it for the `for all` + generators + shrinking model in its original form.
- **Hypothesis documentation** — the best modern PBT reference (strategies, integrated shrinking, stateful testing, the example database); transfers directly to fast-check/proptest.
- **K. Rustan M. Leino, *Program Proofs*** (MIT Press) — the definitive hands-on introduction to deductive verification with Dafny: contracts, loop invariants, variants, lemmas, ghost code.
- The [junior](junior.md), [middle](middle.md), [senior](senior.md), and [professional](professional.md) pages of this topic — every answer here is grounded in those.
- *Property-Based Testing with PropEr/Erlang/Elixir* (Hebert) and the **Dafny / Frama-C / Verus** tutorials — primary sources for the tooling the answers reference.

---

## Related Topics

- [01 — Formal Specification](../01-formal-specification/interview.md) — what a spec *is*, and why a green proof against the wrong spec is still wrong.
- [02 — Model Checking](../02-model-checking/interview.md) — exhaustive state exploration; stateful PBT is its sampling-based cousin.
- [05 — Proof Assistants & Dependent Types](../05-proof-assistants-and-dependent-types/interview.md) — the top rung, where proofs are arbitrary theorems, not auto-discharged VCs.
- [Testing](../../testing/) — where example-based and property-based testing live in the broader suite.
- [Dynamic Analysis & Sanitizers](../../dynamic-analysis-and-sanitizers/) — catching violations at runtime rather than proving their absence.
