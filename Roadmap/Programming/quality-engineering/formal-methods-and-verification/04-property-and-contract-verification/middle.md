# Property & Contract Verification — Middle Level

> **Roadmap:** [Formal Methods & Verification](../README.md) → Property & Contract Verification
> *The junior page sold the pitch: assert properties, let a generator hunt counterexamples. This page is the working engineer's toolkit — the property *classes* that catch real bugs, how shrinking turns a 4,000-element failure into a 2-element one, stateful testing against a model, and the rung-by-rung ladder from a property test up to a machine-checked proof.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Property Classes Worth Memorizing](#core-concept-1--the-property-classes-worth-memorizing)
5. [Core Concept 2 — Generators You Compose](#core-concept-2--generators-you-compose)
6. [Core Concept 3 — Shrinking, and Why Two Tools Disagree About It](#core-concept-3--shrinking-and-why-two-tools-disagree-about-it)
7. [Core Concept 4 — Stateful / Model-Based PBT](#core-concept-4--stateful--model-based-pbt)
8. [Core Concept 5 — Design by Contract](#core-concept-5--design-by-contract)
9. [Core Concept 6 — Refinement Types](#core-concept-6--refinement-types)
10. [Core Concept 7 — Deductive Verification, in One Dafny Method](#core-concept-7--deductive-verification-in-one-dafny-method)
11. [Core Concept 8 — The Assurance Ladder](#core-concept-8--the-assurance-ladder)
12. [Real-World Examples](#real-world-examples)
13. [Mental Models](#mental-models)
14. [Common Mistakes](#common-mistakes)
15. [Test Yourself](#test-yourself)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)
18. [Further Reading](#further-reading)
19. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What are the techniques, and where on the cost/assurance spectrum does each one sit?**

The junior page gave you the move: state a property that should hold for *all* inputs, hand it to a generator, and let it search for a falsifying example. That move is the foundation, but on its own it leaves three questions unanswered. *Which* properties actually catch bugs, when "for all `x`, `f(x)` is correct" is too vague to write down? *How* do you generate something more structured than an integer — a balanced tree, a valid order, a sequence of API calls? And what lies *past* testing — when a property test that passed a million times still isn't enough?

This page answers all three. The first half is property-based testing as a craft: the recurring **property classes** (round-trip, idempotence, invariants, model-based, metamorphic), **composable generators**, **shrinking**, and **stateful** testing. The second half climbs the ladder — **contracts** that check pre/postconditions, **refinement types** that push predicates into the type system, and a first taste of **deductive verification** where an SMT solver *proves* your code meets its spec. The thread tying them together: property-based testing is the bridge. It teaches you to think in properties — the exact mental discipline that formal methods then make airtight.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can write a basic property test with a generator and an assertion.
- **Required:** Comfortable with a typed language's generics/parametric types (you can read `List[int]`, `{v: Int | ...}`).
- **Helpful:** You've written unit tests and felt the pain of picking example inputs by hand.
- **Helpful:** A rough sense of what an SMT solver does — "decides whether a logical formula is satisfiable." Topic [01 — Formal Specification](../01-formal-specification/middle.md) covers the specification side.

---

## Glossary

| Term | Meaning |
|---|---|
| **Property** | A statement that holds for *all* inputs in a domain, e.g. `decode(encode(x)) == x`. |
| **Generator** | A recipe that produces random (and shrinkable) values of a type for the test runner. |
| **Shrinking** | Automatically minimizing a failing input to the smallest example that still fails. |
| **Model** | A simple, obviously-correct reference implementation the system under test is checked against. |
| **Metamorphic relation** | A known relationship between outputs of *related* inputs, used when no oracle exists. |
| **Contract** | Machine-checkable pre/postconditions and invariants attached to code. |
| **Refinement type** | A base type narrowed by a predicate, e.g. `{v: Int \| v > 0}`, checked by the compiler/SMT. |
| **Verification condition (VC)** | A logical formula whose validity implies the code meets its contract. |
| **SMT solver** | A tool (Z3, CVC5) that decides validity/satisfiability of formulas over theories (ints, arrays…). |

---

## Core Concept 1 — The Property Classes Worth Memorizing

The hardest part of PBT isn't the tooling — it's answering "what property *is* there?" The good news: real-world properties cluster into a handful of recurring shapes. Learn the shapes and you stop staring at a blank test file.

**Round-trip / inverse.** If two functions are inverses, composing them is identity. This is the highest value-per-line property in existence; every serializer, parser, encoder, and codec has one.

```python
from hypothesis import given, strategies as st

@given(st.text())
def test_json_roundtrip(s):
    assert json.loads(json.dumps(s)) == s     # decode(encode(x)) == x
```

**Idempotence.** Applying twice equals applying once — true of `sort`, `normalize`, `dedupe`, `abs`, and most "clean this up" functions.

```python
@given(st.lists(st.integers()))
def test_sort_idempotent(xs):
    assert sorted(sorted(xs)) == sorted(xs)
```

**Invariants.** Some fact must hold of the *output* regardless of input. A sort's output is a permutation of its input and is ordered; a balanced tree stays balanced after insert.

```python
@given(st.lists(st.integers()))
def test_sort_invariants(xs):
    out = sorted(xs)
    assert all(out[i] <= out[i+1] for i in range(len(out)-1))   # ordered
    assert sorted(out) == sorted(xs) and len(out) == len(xs)    # permutation
```

**Commutativity / algebraic laws.** Order-independence (`a+b == b+a`), associativity, distributivity — anywhere you've implemented an operation that *claims* to be a monoid, group, or lattice, the laws are free tests.

**Oracle / model-based.** When a slow-but-obviously-correct reference implementation exists, assert the fast one *agrees* with it. Your hand-rolled cache should agree with a plain `dict`; your bit-twiddling `popcount` should agree with `bin(x).count("1")`.

```python
@given(st.integers(min_value=0))
def test_popcount_matches_model(n):
    assert fast_popcount(n) == bin(n).count("1")   # agrees with reference
```

**Metamorphic relations.** The subtlest and most powerful class: used when you have *no* oracle and can't state the exact output, but you *do* know how the output should change when the input is transformed. `f(transform(x))` relates to `f(x)` in a known way.

```python
@given(st.lists(st.floats(allow_nan=False, allow_infinity=False)))
def test_sum_shift_invariant(xs):
    # No oracle for the "right" sum, but adding 1 to each element
    # must raise the total by exactly len(xs).
    assert sum(x + 1 for x in xs) == pytest.approx(sum(xs) + len(xs))
```

Metamorphic testing is how people test machine-learning models, optimizers, and numerical code where the "correct answer" is unknown: a search engine's results for "car" must be a superset of results for "red car"; rotating an image must not change a classifier's label.

> **Key insight:** You almost never need to express the *exact* correct output to test something. Round-trip, idempotence, invariants, model agreement, and metamorphic relations let you pin down *correctness from the side* — by stating relationships the output must satisfy — even when stating the output directly is impossible. This sideways thinking is the skill that transfers straight into formal specification.

---

## Core Concept 2 — Generators You Compose

A generator (Hypothesis calls them *strategies*; QuickCheck calls them `Gen`) is not just "random data" — it's a *composable* value-builder that the framework can also *shrink*. The leverage comes from combinators.

**`map` — transform a value.** Build a generator for a derived type from a simpler one.

```python
even_ints = st.integers().map(lambda n: n * 2)     # always even
```

**`filter` — keep only some values.** Convenient but dangerous: if it rejects too much, the runner gives up. Prefer `map` into the valid space over `filter` out of the invalid space.

```python
positives = st.integers().filter(lambda n: n > 0)         # works, but...
positives = st.integers(min_value=1)                      # better: no rejection
```

**`flatMap` / chaining — when one value's range depends on another.** Generate a length, *then* a list of that length; generate a list, *then* a valid index into it.

```python
@st.composite
def list_and_index(draw):
    xs = draw(st.lists(st.integers(), min_size=1))
    i  = draw(st.integers(min_value=0, max_value=len(xs) - 1))
    return xs, i        # index is guaranteed in-bounds
```

**`frequency` / weighting — bias the distribution.** Pure uniform randomness wastes effort; you often want mostly-valid input with occasional edge cases.

```python
# Haskell QuickCheck idiom: 90% small, 10% pathological
genSize = frequency [ (9, choose (0, 100))
                    , (1, choose (10^6, 10^9)) ]
```

**Sized generation — grow with the budget.** Frameworks pass a *size* parameter that grows over a run, so early cases are tiny (fast, easy to shrink) and later cases stress depth and length. Recursive generators (trees, ASTs) **must** consult the size to avoid generating an infinite structure.

```python
trees = st.recursive(
    st.integers(),                                   # leaves
    lambda children: st.tuples(children, children),  # nodes
    max_leaves=20,                                   # the size bound
)
```

> **Key insight:** Build generators by *constructing valid values*, not by *filtering out invalid ones*. `map`/`flatMap` keep every generated value useful and shrinkable; heavy `filter` throws away work and degrades shrinking. The discipline of "make a generator that can only produce well-formed data" is itself a precise specification of what *well-formed* means — another quiet bridge to formal thinking.

---

## Core Concept 3 — Shrinking, and Why Two Tools Disagree About It

When a property fails, the *first* failing input the generator found is usually noise — a 4,000-element list of huge random integers. Useless for debugging. **Shrinking** is the framework automatically searching for the *smallest, simplest* input that still triggers the failure. A good shrinker turns that 4,000-element list into `[0, 0]` or `[1]` — a counterexample you can reason about in seconds.

The mechanism is a local search: given a failing value, propose "smaller" candidates (drop list elements, shrink integers toward 0, simplify strings), re-run the property, and if a candidate *still* fails, recurse from there. It stops at a *local minimum*: a value where no smaller candidate fails.

There are two architectures for *how* shrinking knows what "smaller" means, and the distinction explains why your experience differs across tools:

| Approach | How it shrinks | Tools | Trade-off |
|---|---|---|---|
| **Type-based shrinking** | Each generator carries an explicit `shrink :: a -> [a]` function | Haskell **QuickCheck**, Scala **ScalaCheck** | Full control, but custom generators need a matching shrinker or you get *no* shrinking |
| **Integrated / internal shrinking** | The framework shrinks the *random byte stream* that drove generation, then re-runs the generator on it | Python **Hypothesis**, Rust **proptest**, Haskell **Hedgehog** | Shrinking is automatic for *any* generator, including composed ones; you rarely write a shrinker |

The practical consequence is large. In classic QuickCheck, a generator built with `fmap`/`>>=` does **not** automatically get a sensible shrinker — you often see a 4,000-element counterexample because the default shrinker doesn't understand your custom type. Hypothesis shrinks the underlying *choice sequence* (the bytes it fed to your generator), so even an elaborately-composed generator shrinks well for free. This is why Hypothesis-style "integrated shrinking" (pioneered as *internal shrinking*) is now the dominant design in newer libraries.

> **Key insight:** Shrinking is what makes PBT *practical*, not just *powerful*. Without it you'd get random haystacks; with it you get the needle. When you choose a PBT library, the shrinking architecture matters more than the generator syntax — integrated shrinking means your custom generators shrink automatically, while type-based shrinking means you may have to write (and maintain) a `shrink` function or accept unreadable counterexamples.

---

## Core Concept 4 — Stateful / Model-Based PBT

Everything so far tests a *pure function* on *one* input. But the bugs that hurt most live in *stateful* systems — caches, connection pools, file handles, data structures, anything where the result of an operation depends on the history of prior operations. Stateful PBT generates not a value but a **sequence of operations**, runs them against both the real system and a simplified **model**, and asserts the two stay in sync after every step.

The model is deliberately dumb. Testing an LRU cache? The model is a plain dict plus a list tracking recency — obviously correct, no performance concerns. The framework generates a random program (`put`, `get`, `evict`, `clear`…), drives both the cache and the model through it, and after each operation checks they agree. When they diverge, shrinking minimizes the *operation sequence* to the shortest script that breaks it.

```python
from hypothesis.stateful import RuleBasedStateMachine, rule, invariant
from hypothesis import strategies as st

class LRUCacheMachine(RuleBasedStateMachine):
    def __init__(self):
        super().__init__()
        self.cache = LRUCache(capacity=3)   # system under test
        self.model = {}                     # the simple reference model

    @rule(key=st.integers(0, 5), value=st.integers())
    def put(self, key, value):
        self.cache.put(key, value)
        self.model[key] = value
        if len(self.model) > 3:             # mirror eviction in the model
            self.model.pop(next(iter(self.model)))

    @rule(key=st.integers(0, 5))
    def get(self, key):
        # Real and model must agree on every lookup.
        assert self.cache.get(key) == self.model.get(key)

    @invariant()
    def never_exceeds_capacity(self):
        assert self.cache.size() <= 3        # checked after EVERY operation

TestLRUCache = LRUCacheMachine.TestCase
```

This single class explores thousands of distinct operation sequences. A bug like "evicting the wrong entry after a `get` that should have refreshed recency" is nearly impossible to find with hand-written examples but falls out of stateful PBT in seconds — and shrinks to a minimal `put / put / put / get / put` script. Stateful testing is the technique behind QuickCheck's famous real-world finds (file systems, distributed databases, telecom protocols); fast-check, ScalaCheck, proptest, and rapid all ship equivalents.

> **Key insight:** Stateful PBT reframes "test a system" as "check the system never disagrees with a model of itself." You no longer enumerate scenarios — you specify *what correct behavior means* (the model) and *what's invariably true* (the invariants), then let the machine generate the scenarios. That is the same shape as a formal specification, run as a test.

---

## Core Concept 5 — Design by Contract

A **contract** attaches a machine-checkable specification directly to a function: what it *requires* of its caller (**preconditions**), what it *guarantees* in return (**postconditions**), and what stays true of an object across its lifetime (**invariants**). The idea comes from Eiffel; today it appears as language features (Ada, D), libraries, or verification annotations.

```python
def withdraw(account, amount):
    # PRECONDITION — caller's obligation
    assert amount > 0, "amount must be positive"
    assert account.balance >= amount, "insufficient funds"

    old_balance = account.balance          # capture pre-state
    account.balance -= amount

    # POSTCONDITION — function's guarantee
    assert account.balance == old_balance - amount
    assert account.balance >= 0
```

Two ideas make contracts more than fancy assertions:

**Referring to the pre-state with `old()`.** A postcondition often needs the value a variable had *on entry* — "the balance decreased by exactly `amount`." Contract systems provide `old(expr)` (Eiffel/Dafny) or `\old(expr)` (ACSL) to name the pre-execution value. Above we capture it manually as `old_balance`; a contract-aware tool gives it to you syntactically.

**The same contract can be *checked* or *verified*.** This is the pivotal distinction:

- **Checked at runtime** — the contract becomes an assertion that fires when violated *during execution*. Cheap, requires no solver, but only catches violations on inputs you actually run. This is the bridge to [Dynamic Analysis & Sanitizers](../../dynamic-analysis-and-sanitizers/): a contract is a precise, self-documenting runtime check.
- **Verified statically** — a tool *proves* the contract holds for *all* inputs before the code ever runs (the next two concepts). Expensive, needs annotations and a solver, but the guarantee is total.

> **Key insight:** A contract is one specification with two possible enforcement strengths. Run it as an assertion and you get a cheap, partial safety net that catches violations on the paths you exercise. Hand the *same* contract to a verifier and you get a total proof. Writing the contract is the shared cost; choosing runtime-check vs static-proof is choosing your rung on the ladder.

---

## Core Concept 6 — Refinement Types

A **refinement type** narrows an ordinary type with a logical predicate, and the compiler — backed by an SMT solver — *checks the predicate everywhere the value flows*. The type `{v: Int | v > 0}` is "an `Int` that is also positive," and any attempt to put a possibly-non-positive value there is a *compile-time* error.

```haskell
-- Liquid Haskell: refinement annotations on ordinary Haskell
{-@ type Pos = {v:Int | v > 0} @-}

{-@ divide :: Int -> Pos -> Int @-}
divide :: Int -> Int -> Int
divide n d = n `div` d        -- divide-by-zero is now UNREPRESENTABLE:
                              -- the type forbids passing 0 as the divisor
```

Because the predicate lives in the type, the checker propagates it. A function that returns `{v: [a] | sorted v}` *proves* its output is sorted; a caller can then rely on sortedness without re-checking. Liquid Haskell and Microsoft's **F\*** are the flagship examples; refinement types also appear in research languages and are creeping into mainstream tooling.

What makes this a *lightweight on-ramp to proof*: you don't write a separate proof or learn a proof assistant. You annotate types you were already writing, and the SMT solver discharges the obligations silently in the background. When it can't (the predicate is too hard, or your code is actually wrong), it reports exactly where. The cost is much lower than full deductive verification, and the payoff — whole *classes* of bug made unrepresentable, checked statically — is substantial.

> **Key insight:** Refinement types fold the specification *into the type system*, so the same machinery that already checks `Int` vs `String` now also checks `positive` vs `possibly-zero` and `sorted` vs `arbitrary`. You get a sliver of formal verification at roughly the ergonomic cost of normal typing — which is why refinement types are the natural first step *past* contracts and *toward* full proof.

---

## Core Concept 7 — Deductive Verification, in One Dafny Method

**Deductive verification** is the rung where a tool *proves* your code meets its contract for all inputs. You annotate the code with pre/postconditions (and, for loops, **loop invariants**); the tool generates **verification conditions** — logical formulas whose validity implies correctness — and an SMT solver (Z3, CVC5) discharges them. If every VC is valid, the code is proven correct *with respect to its spec*. If one isn't, the tool points at the failing condition.

Here is a complete, self-contained example in **Dafny**, a verification-aware language:

```dafny
method Max(a: array<int>) returns (m: int)
  requires a.Length > 0                          // precondition
  ensures forall i :: 0 <= i < a.Length ==> m >= a[i]   // m is an upper bound
  ensures exists i :: 0 <= i < a.Length && m == a[i]    // m is actually present
{
  m := a[0];
  var k := 1;
  while k < a.Length
    invariant 1 <= k <= a.Length                 // loop invariant: k in range
    invariant forall i :: 0 <= i < k ==> m >= a[i]   // m bounds all seen so far
    invariant exists i :: 0 <= i < k && m == a[i]    // m is one of the seen elems
  {
    if a[k] > m { m := a[k]; }
    k := k + 1;
  }
}
```

Dafny *proves* — before this ever runs — that for **every** non-empty array, `Max` returns an element that is both present and maximal. No test executes; Z3 discharges the VCs. The `requires`/`ensures` lines are the contract; the `invariant` lines are the hint the solver needs to reason about the unbounded loop. Get the invariant wrong (say, drop the "is present" clause) and Dafny refuses to verify, naming the unproven postcondition.

The tool landscape, by language:

| Tool | Target | Style |
|---|---|---|
| **Dafny** | its own language | Verification-aware language; learn-by-doing |
| **Frama-C / ACSL** | C | Annotate existing C with `\requires`/`\ensures` in comments |
| **SPARK / Ada** | Ada subset | Industrial (avionics, rail); proves absence of runtime errors |
| **Why3** | intermediate / multi-backend | A verification platform many other tools target |
| **Verus / Prusti / Creusot** | Rust | Bring deductive verification to safe Rust |

> **Key insight:** Deductive verification replaces "I ran a million inputs and none failed" with "no input *can* fail, and here is the machine-checked argument." The price is the annotation burden — especially **loop invariants**, which are the genuinely hard part because you must articulate what stays true across every iteration. Property tests *sample* the input space; deductive verification *quantifies over all of it*.

---

## Core Concept 8 — The Assurance Ladder

The techniques on this page aren't competitors — they're **rungs**, each buying more assurance at more cost. Picture them as one ladder:

```
                                            assurance ↑   cost ↑
  5  Proof assistants (Coq/Lean/Isabelle)   ██████████   ██████████   total, machine-checked
  4  Refinement types / deductive verif.    ████████     ███████      proven for all inputs (auto SMT)
  3  Contracts, checked at runtime          █████        ███          caught on executed paths
  2  Property-based tests                    ████         ██           sampled across many inputs
  1  Example-based tests                     ██           █            the cases you thought of
```

Reading the ladder:

- **Rung 1 — example tests.** Pin down the cases you anticipated. Cheap, but blind to inputs you didn't imagine.
- **Rung 2 — property tests.** Sample thousands of inputs against a property. Catches the cases you *didn't* imagine, but coverage is still probabilistic.
- **Rung 3 — contracts (runtime).** Precise, self-documenting checks that fire on real executions. Total within the paths you run; silent on the rest.
- **Rung 4 — refinement types / deductive verification.** A solver proves the property for *all* inputs. The assurance jumps from "sampled" to "total"; so does the cost (annotations, invariants).
- **Rung 5 — proof assistants.** Human-guided, machine-checked proofs for the hardest guarantees — covered in [05 — Proof Assistants & Dependent Types](../05-proof-assistants-and-dependent-types/middle.md).

The genius of property-based testing is its position. It sits on rung 2, cheap and CI-friendly, but it *teaches you to write the properties* that rungs 3–5 then enforce ever more strongly. A round-trip *property test* and a round-trip *postcondition* and a round-trip *theorem* are the same idea at three assurance levels. PBT is where most engineers first think in properties — which is exactly why it's the bridge from testing to formal methods.

> **Key insight:** Don't ask "tests or formal methods?" Ask "which rung does *this* code deserve?" A logging helper lives on rung 1. A parser earns rung 2 (a round-trip property). A money-moving function deserves rung 3 contracts. A consensus algorithm or a crypto primitive may justify rung 4–5. The ladder lets you spend assurance budget where the blast radius is largest — see [06 — When Formal Methods Pay Off](../06-when-formal-methods-pay-off/middle.md).

---

## Real-World Examples

**A round-trip property in fast-check (TypeScript).** The single most common real property — your serializer's inverse — written in the JS/TS ecosystem's PBT library:

```typescript
import fc from "fast-check";

test("base64 round-trips", () => {
  fc.assert(
    fc.property(fc.string(), (s) => {
      return atob(btoa(s)) === s;        // decode(encode(x)) === x
    })
  );
});
```

**A model-based stateful test in fast-check.** fast-check ships first-class commands for stateful testing; this checks a custom list against a plain array model — the same pattern as the Hypothesis LRU example, in another language:

```typescript
class PushCommand implements fc.Command<number[], MyList> {
  constructor(readonly value: number) {}
  check = () => true;
  run(model: number[], real: MyList) {
    real.push(this.value);
    model.push(this.value);
    expect(real.toArray()).toEqual(model);   // real must equal the model
  }
}
```

**Metamorphic testing of a search service.** No oracle for "the right results," but a known relation: results for a *more specific* query must be a subset of results for the *general* one. Hypothesis generates query pairs; the property asserts the subset relation — catching ranking bugs that have no ground truth.

**AWS proving cryptographic and storage code.** AWS uses Dafny and SAW to *prove* properties of security-critical code (parts of the s2n TLS implementation, authorization logic), because for that blast radius "we tested it" isn't enough — they want "it cannot be wrong." This is rung 4 chosen deliberately for the highest-stakes code, exactly as the ladder prescribes.

**Hypothesis finding stdlib bugs.** Hypothesis's integrated shrinking has surfaced real bugs in Python's own standard library and major scientific packages, where the *shrunk* counterexample — a tiny `Decimal` or a 2-element array — made the root cause obvious. The find was the property; the *fix-ability* was the shrinking.

---

## Mental Models

- **Properties pin down correctness from the side.** You rarely need to state the exact right output. State a relationship it must satisfy — round-trip, idempotence, an invariant, agreement with a model, a metamorphic relation — and you've specified correctness without computing it.

- **A generator is a constructor of valid values, not a filter of invalid ones.** Build well-formed data with `map`/`flatMap`; reach for `filter` only when rejection is rare. The generator *is* a specification of "well-formed."

- **Shrinking is the search for the needle after PBT found the haystack.** The first failure is noise; the shrunk failure is the bug. Integrated shrinking gives you this for free on any generator; type-based shrinking makes you earn it.

- **Stateful PBT = "the system never disagrees with a model of itself."** Write a dumb-but-correct model, let the machine generate operation sequences, assert they stay in sync. You specify *meaning*; the framework invents *scenarios*.

- **A contract is one spec with a strength dial.** The same `requires`/`ensures` can be a runtime assertion (cheap, partial) or a discharged proof obligation (expensive, total). Writing it is the shared cost.

- **The ladder is a budget allocator.** Each rung multiplies assurance and cost. Match the rung to the blast radius: most code earns rung 1–2; only the dangerous code earns rung 4–5.

---

## Common Mistakes

1. **Reasserting the implementation as the property.** Writing `assert my_sort(xs) == my_sort(xs)` (or restating the algorithm) tests nothing. The property must be *independent* of how the function works — round-trip, invariant, or a *separate* model.

2. **Drowning the generator in `filter`.** `st.integers().filter(is_prime)` will mostly reject and may exhaust the runner. Generate into the valid space (`map`, `flatMap`, bounded ranges) instead of filtering out of the invalid one.

3. **Custom generator, no shrinker — in a type-based tool.** In QuickCheck/ScalaCheck a hand-built generator without a matching `shrink` yields giant, unreadable counterexamples. Either provide the shrinker or use an integrated-shrinking library (Hypothesis, proptest, Hedgehog).

4. **Treating a passing property test as a proof.** A million green inputs is rung 2 — *sampled*, not *total*. It does not cover the input you didn't generate. If you need "for all inputs," you need rung 4+, not more PBT runs.

5. **Contracts with side effects, or that lie.** A precondition that mutates state, or a postcondition that's quietly false on edge cases, is worse than none — it gives false confidence. Contracts must be pure observations and *actually true*.

6. **Forgetting the loop invariant in deductive verification.** Beginners write `requires`/`ensures`, omit the loop `invariant`, and are baffled when the prover fails. The solver can't reason about an unbounded loop without you stating what holds across every iteration — the invariant is *the* hard, essential part.

7. **Over-verifying low-stakes code.** Proving a CLI flag parser in Dafny is effort spent on the wrong rung. Reserve rungs 4–5 for code whose failure is catastrophic; everything else lives happily on rungs 1–3.

---

## Test Yourself

1. Name five property classes and give a one-line example of each.
2. Why prefer `map`/`flatMap` over `filter` when building a generator?
3. What problem does shrinking solve, and how does *integrated* shrinking differ from *type-based* shrinking?
4. In stateful PBT, what is the "model," and what exactly is checked against it?
5. The *same* contract can provide two very different levels of assurance. What are they, and what does each cost?
6. What is a refinement type, and why is it called a "lightweight on-ramp to proof"?
7. In a Dafny method with a loop, why is the loop invariant required, and what role does the SMT solver play?
8. Place these on the assurance ladder, lowest to highest: deductive verification, example test, runtime contract, property test, proof assistant.

<details>
<summary>Answers</summary>

1. **Round-trip** (`decode(encode(x)) == x`), **idempotence** (`sort(sort(x)) == sort(x)`), **invariant** (sort output is ordered and a permutation), **model-based** (fast impl agrees with a reference `dict`/slow version), **metamorphic** (results for "red car" ⊆ results for "car").
2. `filter` *rejects* generated values; if it rejects too many, the runner wastes work or gives up, and shrinking degrades. `map`/`flatMap` *construct* only valid values, so every draw is useful and shrinks well.
3. Shrinking minimizes a failing input to the smallest example that still fails, turning a random haystack into a readable needle. **Type-based** shrinking needs an explicit `shrink` per generator (full control, but custom generators may shrink poorly). **Integrated** shrinking minimizes the underlying random byte/choice stream and re-runs the generator, so *any* composed generator shrinks automatically.
4. The model is a simple, obviously-correct reference implementation (e.g. a plain `dict` for a cache). The framework generates a sequence of operations, drives both the real system and the model through it, and asserts they *agree* after each operation (plus any invariants).
5. **Runtime-checked:** the contract is an assertion that fires on violation during execution — cheap, no solver, but only catches violations on inputs you actually run. **Statically verified:** a tool proves the contract for *all* inputs before running — total guarantee, but costs annotations and an SMT solver.
6. A refinement type is a base type narrowed by a predicate (`{v: Int | v > 0}`), checked by the compiler/SMT wherever the value flows. It's a lightweight on-ramp because you annotate ordinary types you were already writing — no separate proof, no proof assistant — and the solver discharges the obligations automatically.
7. The solver cannot reason about an unbounded loop directly; the loop invariant states what holds *before and after every iteration*, giving the solver an inductive hypothesis. The tool generates verification conditions from the contract + invariant, and the SMT solver (Z3/CVC5) decides their validity — proving the postcondition without running the code.
8. example test → property test → runtime contract → deductive verification → proof assistant.

</details>

---

## Cheat Sheet

```
PROPERTY CLASSES (what to test when output is hard to state)
  round-trip      decode(encode(x)) == x        serializers, codecs, parsers
  idempotence     f(f(x)) == f(x)               sort, normalize, dedupe
  invariant       P(f(x)) holds always          sorted output, balanced tree
  algebraic       a+b == b+a, assoc, distrib    monoids/groups you implemented
  model/oracle    fast(x) == reference(x)        cache vs dict, popcount vs bin
  metamorphic     f(transform(x)) ~ f(x)         ML, search, numeric (no oracle)

GENERATOR COMBINATORS
  map        derive a value          ints.map(*2) → evens
  filter     keep some (use sparingly — heavy reject hurts shrinking)
  flatMap    dependent values        len → list-of-len; list → valid index
  frequency  weight the distribution  mostly-small, occasionally-pathological
  sized      grow with budget         REQUIRED for recursive (tree/AST) gens

SHRINKING
  type-based   per-generator shrink fn   QuickCheck, ScalaCheck (control; manual)
  integrated   shrinks the byte stream   Hypothesis, proptest, Hedgehog (automatic)

STATEFUL PBT
  generate operation SEQUENCES vs a simple MODEL; assert in-sync each step;
  shrink minimizes the operation script.   (caches, pools, data structures)

CONTRACTS
  requires   precondition  (caller's obligation)
  ensures    postcondition (function's guarantee)
  old()/\old refer to the PRE-state in a postcondition
  → runtime-checked (cheap, partial)   OR   statically-verified (total, costly)

THE LADDER (assurance ↑ cost ↑)
  1 example tests      cases you thought of
  2 property tests     sampled across inputs        ← PBT lives here, the bridge
  3 contracts (runtime) caught on executed paths
  4 refinement types / deductive verif. proven for ALL inputs (auto SMT)
  5 proof assistants   human-guided, machine-checked

TOOLS BY LANGUAGE
  PBT:    Haskell QuickCheck · Python Hypothesis · JS/TS fast-check
          Scala ScalaCheck · Go gopter/rapid · Rust proptest · Java jqwik
  Deductive: Dafny · Frama-C/ACSL (C) · SPARK/Ada · Why3 · Verus/Prusti (Rust)
  Refinement: Liquid Haskell · F*
```

---

## Summary

- Real properties cluster into a few **classes** — round-trip, idempotence, invariants, algebraic laws, model-based, metamorphic. They let you pin down correctness *from the side*, without stating the exact output.
- **Generators** are composable value-builders. Construct valid data with `map`/`flatMap` and weighting; lean on `filter` only when rejection is rare; recursive generators must respect the size budget.
- **Shrinking** turns a random failure into a minimal, readable counterexample. **Integrated** shrinking (Hypothesis, proptest) minimizes the choice stream and works for any generator; **type-based** shrinking (QuickCheck, ScalaCheck) needs a per-generator `shrink`.
- **Stateful PBT** generates operation *sequences* and checks the system never disagrees with a simple **model** — the technique behind PBT's most famous real-world finds.
- **Contracts** attach pre/postconditions and invariants to code, with `old()` to name the pre-state. The *same* contract can be checked at runtime (cheap, partial) or verified statically (total, costly).
- **Refinement types** push predicates into the type system (`{v: Int | v > 0}`), SMT-checked by the compiler — a lightweight on-ramp to proof.
- **Deductive verification** (Dafny, Frama-C, SPARK, Verus) generates verification conditions an SMT solver discharges, proving code meets its contract for *all* inputs; **loop invariants** are the hard, essential part.
- The **ladder** — example tests → property tests → runtime contracts → refinement types / deductive verification → proof assistants — trades increasing cost for increasing assurance. PBT sits on rung 2 and is the bridge: it teaches you to think in the properties the higher rungs enforce.

---

## Further Reading

- *QuickCheck: A Lightweight Tool for Random Testing of Haskell Programs* — Claessen & Hughes. The paper that started property-based testing; short and foundational.
- **Hypothesis documentation** — the "What you can generate and how" and stateful-testing guides; the clearest practical introduction to strategies and integrated shrinking.
- *Program Proofs* — K. Rustan M. Leino, and the **Dafny** tutorial/reference. The on-ramp to deductive verification, `requires`/`ensures`, and loop invariants by the author of Dafny.
- **Liquid Haskell documentation** and the *Programming with Refinement Types* tutorial — refinement types worked from `{v:Int | v>0}` up to verified data structures.
- *Find More Bugs with QuickCheck!* and the John Hughes talks on **stateful/model-based testing** — how property testing scales to real, stateful systems.
- [senior.md](senior.md) — counterexample-minimization internals, fuzzing/PBT convergence, invariant inference, and choosing the right rung at scale.

---

## Related Topics

- [01 — Formal Specification](../01-formal-specification/middle.md) — writing the specs that properties, contracts, and refinement types are checked against.
- [05 — Proof Assistants & Dependent Types](../05-proof-assistants-and-dependent-types/middle.md) — rung 5: human-guided, machine-checked proofs beyond automated SMT.
- [06 — When Formal Methods Pay Off](../06-when-formal-methods-pay-off/middle.md) — choosing the right rung for the blast radius; the cost/assurance decision.
- [Testing](../../testing/) — where property-based testing fits in the broader test strategy.
- [Dynamic Analysis & Sanitizers](../../dynamic-analysis-and-sanitizers/) — runtime-checked contracts and assertions as the dynamic-analysis counterpart to static verification.
