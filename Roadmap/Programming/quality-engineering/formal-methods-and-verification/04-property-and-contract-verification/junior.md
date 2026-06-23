# Property & Contract Verification — Junior Level

> **Roadmap:** [Formal Methods & Verification](../README.md) → Property & Contract Verification
> *An example test says "this one input gives this one answer." A property says "every input must obey this rule" — and a library spends the next half-second hunting for the one input that breaks it.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Example Tests vs Properties](#core-concept-1--example-tests-vs-properties)
5. [Core Concept 2 — Generators: The Library Invents the Inputs](#core-concept-2--generators-the-library-invents-the-inputs)
6. [Core Concept 3 — Shrinking: From a Mess to the Smallest Counterexample](#core-concept-3--shrinking-from-a-mess-to-the-smallest-counterexample)
7. [Core Concept 4 — The Five Property Patterns You'll Actually Use](#core-concept-4--the-five-property-patterns-youll-actually-use)
8. [Core Concept 5 — Design by Contract: Preconditions, Postconditions, Invariants](#core-concept-5--design-by-contract-preconditions-postconditions-invariants)
9. [Core Concept 6 — Properties and Contracts Are the Same Idea](#core-concept-6--properties-and-contracts-are-the-same-idea)
10. [Real-World Examples](#real-world-examples)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How do you check a rule for *all* inputs without proving anything?**

The full formal-methods ladder has some intimidating rungs — model checkers that explore every state, proof assistants that demand machine-checked proofs. This topic is the friendly middle. It is the part of formal thinking a working developer can pick up this afternoon and use tomorrow, at roughly the cost of a normal unit test.

Here is the problem with the tests you write today. Suppose you wrote a `sort` function. Your test probably looks like this:

```python
def test_sort():
    assert sort([3, 1, 2]) == [1, 2, 3]
```

That checks *one* input. It says nothing about `[]`, `[5, 5, 5]`, a list of 10,000 random numbers, or a list with negative values. You picked three numbers you happened to think of. A real bug — say, your sort crashes on duplicates, or drops the last element on lists of even length — sits comfortably in the infinite space of inputs you *didn't* type.

There are two cheap, powerful tools for closing that gap, and they share one idea: **write down a precise rule, then let a machine check it for you.**

1. **Property-based testing (PBT).** Instead of one example, you state a **property** — a rule that must hold for *every* valid input. For sort: *"for any list `xs`, the output is in non-decreasing order, and is a permutation of `xs`."* A PBT library then generates hundreds of random inputs, runs your function on each, and checks the rule. If it finds a failure, it **shrinks** it down to the tiniest input that still breaks — so instead of a 4,000-element list you get `[1, 0]` and the bug is obvious.

2. **Design by Contract (DBC).** A function writes down its **promises**: what the caller must guarantee before calling (the **precondition**), what the function guarantees on return (the **postcondition**), and what stays true about an object the whole time (the **invariant**). A contract is a precise, checkable promise — and you can check it at runtime, or in deeper tiers, have a tool *prove* it.

Both are "specs you can check automatically." Both are far cheaper than a real proof and far stronger than a handful of example tests. Both catch real bugs that example tests routinely miss.

> **Mindset shift:** Stop thinking "I'll write tests for the cases I can imagine." Start thinking **"for all inputs, what must always be true?"** — and then make the machine find the input that breaks your rule. The leap from *example* (`sort([3,1,2]) == [1,2,3]`) to *for-all* (`for any xs, sort(xs) is ordered`) is the single most important idea in this whole topic. It is the gateway from testing into formal thinking, and it costs about the same as the test you'd write anyway.

This page teaches the building blocks — property, generator, shrinking, precondition, postcondition, invariant — with real, runnable code. The deeper machinery (stateful/model-based testing, compile-time contract *proof* with tools like Dafny) waits for later tiers.

---

## Prerequisites

- **Required:** You can write and run an ordinary unit test in some language (examples use **Python** with [Hypothesis](https://hypothesis.readthedocs.io/), plus a little **JavaScript** with fast-check and **Go**). The ideas transfer to any language with a PBT library.
- **Required:** You understand a function has *inputs* and *outputs*, and you've used `assert`.
- **Helpful:** You've been burned by an edge case a test missed — an empty list, a zero, a duplicate, a Unicode string — and wished you'd thought of it.
- **Helpful:** You've heard "this function assumes the list is non-empty" said out loud but never written down. That unwritten assumption is a contract.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Example test** | A test that checks *one* fixed input → output pair (`sort([3,1,2]) == [1,2,3]`). |
| **Property** | A rule that must hold for *every* valid input ("for any `xs`, `sort(xs)` is ordered"). |
| **Property-based testing (PBT)** | Stating a property and letting a library generate many inputs to try to break it. |
| **Generator** | The part of a PBT library that *invents* random inputs of a given shape (ints, lists, strings…). |
| **Shrinking** | After finding a failing input, automatically reducing it to the *smallest* input that still fails. |
| **Counterexample** | A specific input that violates the property — proof your code (or your property) is wrong. |
| **Round-trip** | A property of the form `decode(encode(x)) == x` — go out and come back unchanged. |
| **Idempotence** | `f(f(x)) == f(x)` — applying twice is the same as applying once. |
| **Invariant** | Something that is *always* true (of an input, an output, or an object's state). |
| **Model (oracle)** | A simple, obviously-correct reference implementation you compare your fast one against. |
| **Design by Contract (DBC)** | Writing a function's pre/postconditions and invariants as explicit, checkable promises. |
| **Precondition** | What the *caller* must guarantee before calling (`amount > 0`). The caller's duty. |
| **Postcondition** | What the *function* guarantees on return (`balance == old_balance - amount`). The callee's duty. |
| **`old(x)`** | In a postcondition, the value `x` had *before* the function ran (to talk about change). |

---

## Core Concept 1 — Example Tests vs Properties

An **example test** is a sentence: "this specific input gives this specific output." A **property** is a *rule*: "every input satisfying these conditions must produce an output satisfying that condition." One is a data point; the other is a law.

Take a function `encode`/`decode` pair — say, you serialize an object to JSON and read it back. The example test:

```python
def test_roundtrip_example():
    user = {"name": "Ada", "age": 36}
    assert decode(encode(user)) == user      # checks ONE user
```

That checks one user. The **property** version says the *same thing for everyone*:

```python
from hypothesis import given, strategies as st

@given(st.dictionaries(st.text(), st.integers()))   # "for any dict of text→int…"
def test_roundtrip_property(d):
    assert decode(encode(d)) == d            # …decode(encode(d)) must equal d
```

Read the second one aloud: *"Given any dictionary mapping text to integers, decoding the encoding of it must give back the original."* The `@given(...)` decorator is the **for-all**. Hypothesis will now run this function maybe 100 times, each with a *different* generated dictionary — empty ones, ones with emoji keys, ones with huge integers, ones with keys that look like JSON syntax. If your `encode` mishandles, say, a key containing a quote character, the property finds it. The example test never would, unless you happened to think of that exact key.

> **Key insight:** A property is not "a test with more inputs." It is a *change in what you write down*. You stop enumerating answers (which you can't, for infinite inputs) and start stating the **law the answers must obey**. The library supplies the inputs; you supply the law. That division of labour is the whole trick — and it means a five-line property can out-test fifty example tests.

The cost is almost nothing. A property test is the same shape as a unit test — a function with an assertion — plus a `@given` line saying what kind of input to throw at it. You run it the same way (`pytest`, `go test`, `npm test`). When it passes, you've checked hundreds of cases. When it fails, you get a concrete counterexample, automatically minimized.

---

## Core Concept 2 — Generators: The Library Invents the Inputs

A **generator** (Hypothesis calls them *strategies*) is the piece that knows how to manufacture random values of a particular shape. You never write the inputs; you describe their *type*, and the generator does the rest.

```python
from hypothesis import strategies as st

st.integers()                     # any int: 0, -1, 7, 2**63, ...
st.integers(min_value=0)          # any non-negative int
st.lists(st.integers())           # a list of any ints, any length (including [])
st.text()                         # any string, incl. "", emoji, control chars
st.floats(allow_nan=False)        # any float except NaN
st.dictionaries(st.text(), st.integers())   # dict: text keys, int values
```

The same idea exists everywhere. In **JavaScript** with [fast-check](https://fast-check.dev/):

```js
import fc from "fast-check";

fc.assert(
  fc.property(fc.array(fc.integer()), (xs) => {   // "for any array of ints xs…"
    const out = sort(xs);
    for (let i = 1; i < out.length; i++)
      if (out[i - 1] > out[i]) return false;       // …it must be non-decreasing
    return true;
  })
);
```

And in **Go**, the standard library ships a basic version, `testing/quick`:

```go
func TestReverseTwiceIsIdentity(t *testing.T) {
    f := func(xs []int) bool {
        return reflect.DeepEqual(reverse(reverse(xs)), xs)  // for any xs
    }
    if err := quick.Check(f, nil); err != nil {   // generates many xs, checks f
        t.Error(err)
    }
}
```

(For richer generation and shrinking in Go, the community library [`gopter`](https://github.com/leanovate/gopter) is the usual step up.)

The power of generators is that they deliberately seek out the inputs *you* avoid: the empty collection, the zero, the negative, the maximum integer, the duplicate, the string full of newlines. These are exactly the values where bugs hide, and a human writing example tests almost never includes all of them.

> **Key insight:** You describe the *shape* of valid input (a list of ints, a non-empty string, a positive number), and the generator produces the awkward, adversarial members of that set automatically. You are no longer responsible for *imagining* edge cases — you're responsible for *describing the domain*, and the machine explores its corners.

---

## Core Concept 3 — Shrinking: From a Mess to the Smallest Counterexample

Random inputs have a downside: when one fails, it's usually *huge*. If your property breaks on a 3,000-element list of 12-digit numbers, that failing input is useless for debugging — you can't see what's wrong by reading it.

This is where **shrinking** earns its keep, and it's the feature that makes PBT *pleasant* rather than maddening. When a property fails, the library doesn't just report the random input that broke it. It then **systematically simplifies** that input — dropping elements, lowering numbers toward zero, shortening strings — re-running the property after each reduction, always keeping the *simplest* input that *still fails*. It stops when it can't simplify any further without the failure disappearing.

The result is the **minimal counterexample**. Concretely, suppose you wrote a buggy "remove duplicates" that fails whenever an element appears twice:

```python
@given(st.lists(st.integers()))
def test_dedup_has_no_repeats(xs):
    out = dedup(xs)
    assert len(out) == len(set(out))   # no value should appear twice
```

Hypothesis might *first* trip on a chaotic list like `[492, -17, 492, 0, 88, -17, 7]`. But it won't report that. After shrinking, it tells you:

```
Falsifying example: test_dedup_has_no_repeats(xs=[0, 0])
```

`[0, 0]` — the smallest possible list that exhibits the bug. Now the problem is *obvious*: two equal elements aren't being collapsed. Shrinking turned a debugging chore into a glance.

> **Key insight:** Shrinking is what separates property testing from "just run random inputs." A random failure is noise; a *shrunk* failure is a diagnosis. The library does the tedious bisection — "is it still broken if I remove this element? lower this number?" — that you'd otherwise do by hand for twenty minutes. You get handed the tiny case that goes straight into a regression test.

Hypothesis also *remembers* failing examples between runs (in a local database), so once it finds `[0, 0]`, it tries it first next time — your test fails instantly until you fix the bug, then keeps guarding against its return.

---

## Core Concept 4 — The Five Property Patterns You'll Actually Use

"What property do I even write?" is the question that stops most people. The good news: a small handful of patterns cover the overwhelming majority of real functions. Learn these five and you can write a property for almost anything.

**1. Round-trip (there-and-back).** If you have a pair of inverse operations, going out and back must return the original.

```python
@given(st.binary())
def test_compress_roundtrip(data):
    assert decompress(compress(data)) == data    # encode/decode, serialize/parse,
                                                  # to_json/from_json, escape/unescape
```

This one property catches an astonishing number of serialization, encoding, and parsing bugs.

**2. Invariant (something always holds of the output).** The output obeys a rule regardless of input.

```python
@given(st.lists(st.integers()))
def test_sorted_is_ordered(xs):
    out = sort(xs)
    assert all(out[i] <= out[i + 1] for i in range(len(out) - 1))   # always ordered
    assert sorted(Counter(out).items()) == sorted(Counter(xs).items())  # same multiset
```

Note the *two* properties: ordered **and** a permutation. "Ordered" alone is satisfied by a sort that just returns `[]` — you need the second clause to pin it down. Real specs often need a *pair* of properties to be tight.

**3. Idempotence (applying twice = applying once).** Common for normalizers, sorts, "set" operations.

```python
@given(st.lists(st.integers()))
def test_sort_idempotent(xs):
    assert sort(sort(xs)) == sort(xs)            # also: normalize, dedup, abs, trim
```

**4. Model-based / oracle agreement (matches a simpler reference).** Compare your fast/clever implementation against a slow, obviously-correct one.

```python
@given(st.lists(st.integers()))
def test_my_sort_agrees_with_builtin(xs):
    assert my_fast_sort(xs) == sorted(xs)        # the language's sorted() is the oracle
```

This is gold when you've written something optimized (a custom hash map, a fast parser) — the "model" is a five-line naive version you trust completely.

**5. Symmetry / structural laws.** Operations that should cancel, commute, or preserve structure.

```python
@given(st.lists(st.integers()))
def test_reverse_involution(xs):
    assert reverse(reverse(xs)) == xs            # reverse twice = identity
```

> **Key insight:** You almost never invent a property from scratch. You ask: *Is there an inverse?* (round-trip). *What's always true of the result?* (invariant). *Does doing it twice change anything?* (idempotence). *Is there a dumb-but-correct version to compare against?* (oracle). *Do two operations cancel or commute?* (symmetry). Run a function through that checklist and properties fall out.

> **Junior recipe:** For any pure-ish function, write **two or three** properties from this list — typically a round-trip *or* oracle, plus an invariant. Three small properties usually pin a function down far more tightly than a dozen example tests.

---

## Core Concept 5 — Design by Contract: Preconditions, Postconditions, Invariants

Property testing checks rules from the *outside* (feed inputs, inspect outputs). **Design by Contract** writes the rules *into the function itself*, as explicit promises. The metaphor — coined by Bertrand Meyer — is a legal contract between a function and its caller, with obligations on both sides.

A function makes three kinds of promise:

- **Precondition** — what the *caller* must guarantee *before* calling. The caller's obligation. ("You may only withdraw a positive amount you can afford.")
- **Postcondition** — what the *function* guarantees *on return*, **provided** the precondition held. The function's obligation. ("Your balance will be exactly reduced by that amount.")
- **Invariant** — what stays true about an object across *every* operation. ("An account's balance is never negative.")

Here is a `withdraw` with its contract written out — checked at runtime with plain assertions, which any language supports:

```python
class Account:
    def __init__(self, balance):
        self.balance = balance
        self._check_invariant()

    def _check_invariant(self):
        assert self.balance >= 0, "INVARIANT: balance must never be negative"

    def withdraw(self, amount):
        # --- PRECONDITION: the caller's duty ---
        assert amount > 0,             "PRECONDITION: amount must be positive"
        assert amount <= self.balance, "PRECONDITION: cannot overdraw"

        old_balance = self.balance     # capture old() to talk about change
        self.balance -= amount         # ... the actual work ...

        # --- POSTCONDITION: this function's guarantee ---
        assert self.balance == old_balance - amount, "POSTCONDITION: balance off"
        self._check_invariant()        # the invariant still holds afterwards
        return amount
```

Notice the structure. The **preconditions** sit at the top — they validate the *contract*, and a failure means **the caller broke the deal** (passed a bad argument). The **postconditions** sit at the bottom — they validate *our own work*, and a failure means **we have a bug**. The `old_balance` capture is how a postcondition talks about *change* — many contract systems write this as `old(balance)`, the value *before* the call. The **invariant** is checked after construction and after every mutation, asserting a truth that holds for the object's entire life.

This single habit — writing down what a function *assumes* and what it *promises* — clarifies thinking even before you run anything. Half the time, writing the precondition down reveals you never decided what should happen on an empty input or a negative number.

> **Key insight:** A contract makes the *unwritten assumptions explicit and checkable*. "This function assumes the list is non-empty" stops being tribal knowledge in someone's head and becomes `assert len(xs) > 0` at the top — a promise the program enforces. A precondition failure points at the **caller**; a postcondition failure points at **you**. That split alone makes bugs faster to locate.

A note on *where* contracts get checked: the assertions above run at **runtime** — the cheapest, most universal form, and a direct cousin of the assertion-and-sanitizer techniques in [Dynamic Analysis & Sanitizers](../../dynamic-analysis-and-sanitizers/). Some languages bake contracts in as first-class syntax (Eiffel's `require`/`ensure`/`invariant`, Ada's `Pre`/`Post`, Clojure's `:pre`/`:post`). And in the deeper tiers, tools like **Dafny** take the *same* pre/postconditions and **prove at compile time** that they can never be violated for *any* input — no test run needed. Same contract, three strengths of checking: runtime assertion → many-input property test → machine proof.

---

## Core Concept 6 — Properties and Contracts Are the Same Idea

These two halves of the topic are not separate tools that happen to share a chapter. They are two faces of one idea: **a specification you can check automatically.**

- A **property** is a spec stated from the outside: *"for all inputs, this rule holds."*
- A **contract** is a spec stated from the inside: *"given this precondition, I guarantee this postcondition."*

And they compose beautifully. The most natural way to test a contract is with a property: generate many valid inputs (inputs that *satisfy the precondition*), call the function, and assert the *postcondition* held for every one. The generator supplies the "for all"; the contract supplies the rule.

```python
@given(st.integers(min_value=1), st.integers(min_value=0))
def test_withdraw_contract(start, amount):
    acc = Account(balance=start + amount)        # ensure precondition: affordable
    old = acc.balance
    acc.withdraw(amount + 1)                      # withdraw a positive, affordable amount
    assert acc.balance == old - (amount + 1)     # the POSTCONDITION, checked for all
    assert acc.balance >= 0                       # the INVARIANT, checked for all
```

Here the generator manufactures hundreds of `(start, amount)` pairs that satisfy the precondition, and the assertions check that the postcondition and invariant survive *every* one. That is PBT and DBC working as a single technique.

> **Key insight:** Don't file these under two mental folders. File them under one: **executable specifications.** You write down what must be true (as a for-all property, or as a pre/post contract), and a machine checks it for you — across hundreds of inputs, or on every call at runtime, or (later) by proof. They are cheaper than proofs and stronger than example tests, occupying exactly the sweet spot where most real software lives.

---

## Real-World Examples

**1. The serialization bug that round-trip caught in one line.** A team ships an API that encodes objects to JSON and back. Example tests pass. A property — `decode(encode(x)) == x` over generated objects — fails within seconds: a field containing the string `"null"` was being parsed back as a real `null`. No human writing example tests would have guessed that exact value; the generator produced it on attempt 30-something, and shrinking reduced the failing object to a single field `{"x": "null"}`. One five-line property, a class of bugs gone.

**2. Hypothesis vs a real-world `datetime` library.** Hypothesis is famous for finding bugs in mature libraries by generating dates near boundaries — leap seconds, year 0, daylight-saving transitions, timezone offsets nobody tests. Property: "parsing then formatting a datetime returns the same instant." It surfaces edge cases that survived years of example tests because no human thinks to type "2016-12-31T23:59:60Z."

**3. A precondition that turned a 2 a.m. page into a clear error.** A payment function quietly assumed `amount > 0`. A caller, due to a separate bug, passed `-50`. Without a contract, the negative *credited* the account and corrupted balances silently — discovered days later in reconciliation. With `assert amount > 0` as a precondition, the bad call fails *immediately, at the boundary*, with a message naming the broken promise — pointing straight at the *caller's* bug instead of letting bad data spread.

**4. Oracle testing a hand-rolled data structure.** An engineer writes a custom, cache-friendly ordered map for speed. Is it correct? They keep a five-line "model" — a sorted list of pairs — and a property that performs the *same* random sequence of inserts/deletes/lookups on both, asserting they always agree. Every divergence is a bug in the fast version, found with the failing operation sequence shrunk to its minimum. (This *stateful/model-based* style is developed further in higher tiers.)

---

## Mental Models

- **Example test = one photo; property = the physical law.** A photo shows one moment. A law ("ordered, and a permutation") constrains *every* moment. You can't photograph infinitely many inputs, but you can state the law and let the machine sample the space.

- **The generator is an adversary with a grudge.** Picture a tireless opponent who *wants* your code to fail and will try every cruel input — empty, zero, negative, max-int, duplicate, emoji, `"null"`. A property test hires that adversary. Your job is only to describe the arena (the input type) and the rule of the game (the property).

- **Shrinking is automatic bisection.** The same instinct you use by hand — "does it still break if I delete half the list? lower the number?" — done by the library, fast, until only the essential failing core remains. You get the diagnosis, not the crime scene.

- **A contract is a checkable promise with a blame label.** Precondition broken → *blame the caller* (bad argument). Postcondition broken → *blame the function* (real bug). Invariant broken → the object reached an impossible state. The category of the failure tells you *where to look* before you read a single line of logic.

- **`old(x)` is a time machine for one value.** A postcondition often needs to compare *after* with *before* (`balance == old(balance) - amount`). Capturing the old value is how you state a promise about *change*, not just about the final state.

---

## Common Mistakes

1. **Writing one property that's too weak.** "`sort(xs)` is ordered" is satisfied by a function that returns `[]` every time. Pair it with "is a permutation of `xs`." A single loose property gives false confidence; tight specs usually need *two or three* clauses.

2. **Re-implementing the function inside the property.** If your property for `sum` is `assert mysum(xs) == sum_again(xs)` where `sum_again` is the *same algorithm copy-pasted*, you've tested nothing — both share the bug. Use a *genuinely different* oracle (the language built-in, or a naive version), or an *invariant*, not a clone.

3. **Forgetting the empty / single / zero case is now *included*.** Generators produce `[]`, `0`, `""` by default. People are surprised when the property "fails on empty input" — but that's the point: it found a real gap. Either handle the case or constrain the generator (`st.lists(..., min_size=1)`) and *write down why*.

4. **Confusing precondition with postcondition.** Precondition = the caller's duty *before* (validates the argument). Postcondition = your guarantee *after* (validates your work). Asserting an input check at the *bottom* of the function, or your output guarantee at the *top*, blames the wrong party and checks the wrong thing.

5. **Using a precondition for untrusted external input.** Contracts express assumptions *between trusted parts of your code*. A precondition `assert amount > 0` is for a fellow developer's call — not for sanitizing a value straight from an HTTP request. Untrusted input needs real validation that returns a proper error, not an assertion that can be compiled away. (See [Testing](../../testing/) and input-validation practices.)

6. **Treating a found counterexample as the library's fault.** When PBT hands you `[0, 0]`, the reflex "the test is being pedantic" is wrong. The library found a *real* input your code mishandles. Fix the code (or, occasionally, fix an over-broad property) — don't suppress the case.

7. **Letting flaky properties hide non-determinism.** A property that passes sometimes and fails sometimes means your *code* is non-deterministic (depends on dict order, time, randomness) — the property exposed it. That's a finding, not a nuisance to silence with a retry.

---

## Test Yourself

1. In one sentence each, explain the difference between an *example test* and a *property*.
2. Name the five property patterns from this page, and give the shape of each (e.g. round-trip is `decode(encode(x)) == x`).
3. What is *shrinking*, and why does it make property failures so much easier to debug?
4. The property "`sort(xs)` is in non-decreasing order" passes for a buggy `sort` that always returns `[]`. What second property do you add to rule that out?
5. For `withdraw(amount)`: classify each as precondition, postcondition, or invariant — (a) `amount <= balance`; (b) `balance == old(balance) - amount`; (c) `balance >= 0` at all times.
6. A precondition assertion fails in production. Who is most likely at fault — the function or its caller? What about a *postcondition* failure?
7. Why is `assert mysum(xs) == sum_copy_pasted(xs)` a poor property, and what would you use instead?
8. Name three places a contract can be *checked*, from cheapest to strongest.

<details>
<summary>Answers</summary>

1. An **example test** checks one fixed input→output pair; a **property** states a rule that must hold for *every* valid input, and a library generates many inputs to try to break it.
2. **Round-trip** (`decode(encode(x)) == x`); **invariant** (output always obeys a rule, e.g. `sort(xs)` is ordered); **idempotence** (`f(f(x)) == f(x)`); **oracle / model agreement** (`fast(x) == naive(x)`); **symmetry / structural** (`reverse(reverse(xs)) == xs`).
3. Shrinking automatically reduces a failing input to the *smallest* one that still fails (dropping elements, lowering numbers). It hands you a tiny, readable counterexample (e.g. `[0, 0]`) instead of a 3,000-element mess, turning debugging from a chore into a glance.
4. "`sort(xs)` is a **permutation** of `xs`" (same elements with the same multiplicities). Ordered + permutation together pin the function down; "ordered" alone allows returning `[]`.
5. (a) **precondition** (caller's duty before the call); (b) **postcondition** (the function's guarantee on return); (c) **invariant** (always true of the object).
6. A **precondition** failure most likely blames the **caller** — it passed an argument that broke the contract. A **postcondition** failure blames the **function itself** — its own work didn't meet its guarantee.
7. Because the "oracle" is the same algorithm copy-pasted, so both share any bug and the property proves nothing. Use a *genuinely different* reference (the language built-in, or a slow naive version) or an *invariant* instead.
8. **Runtime assertions** (cheapest, universal) → **property-based tests** (many generated inputs) → **machine proof** at compile time with a tool like Dafny (strongest — covers *all* inputs, no run needed).

</details>

---

## Cheat Sheet

```
PROPERTY-BASED TESTING (PBT)
  example test :  assert f(specific_input) == specific_output   # one data point
  property     :  @given(generator)  →  assert <rule holds>     # a law for ALL inputs
  generator    :  the lib INVENTS inputs of a shape (ints, lists, text, dicts…)
  shrinking    :  on failure, auto-reduce to the SMALLEST failing input
  counterexample: the minimal input that breaks the rule  → straight into a regression test

THE FIVE PROPERTY PATTERNS
  round-trip    decode(encode(x)) == x            # inverse operations cancel
  invariant     all(out[i] <= out[i+1] ...)       # output always obeys a rule
  idempotence   f(f(x)) == f(x)                    # twice == once
  oracle/model  fast(x) == naive_correct(x)        # agrees with a simple reference
  symmetry      reverse(reverse(xs)) == xs         # operations cancel/commute

  TIP: ordered-AND-permutation, not just ordered. Tight specs need 2-3 clauses.

DESIGN BY CONTRACT (DBC)
  precondition   assert <caller's duty>     at TOP    → failure blames the CALLER
  postcondition  assert <our guarantee>     at BOTTOM → failure blames the FUNCTION
  invariant      assert <always true>       after every mutation
  old(x)         the value x had BEFORE the call (to state change)

WHERE CONTRACTS GET CHECKED  (cheap → strong)
  runtime assert  →  property test (many inputs)  →  compile-time PROOF (Dafny)

JUNIOR RECIPE
  pure-ish function? → write 2-3 properties (round-trip/oracle + an invariant)
  function with requirements? → write its pre/postconditions down explicitly
  unsure what property? → ask: inverse? always-true? twice==once? simpler oracle? cancels?
```

---

## Summary

- **Property-based testing** replaces "this input gives this answer" with **"for all inputs, this rule holds."** You state a **property**; a library's **generators** manufacture hundreds of adversarial inputs (empty, zero, negative, duplicate, weird strings) and check the rule on each.
- When a property fails, **shrinking** reduces the failing input to the **smallest counterexample** — `[0, 0]` instead of a 3,000-element mess — turning a debugging marathon into a glance, and it drops straight into a regression test.
- Five patterns cover most functions: **round-trip**, **invariant**, **idempotence**, **oracle/model agreement**, and **symmetry**. Tight specs usually combine two or three (ordered *and* a permutation).
- **Design by Contract** writes a function's promises down explicitly: **preconditions** (the caller's duty *before*), **postconditions** (the function's guarantee *after*, using `old()` to talk about change), and **invariants** (always true of an object). A precondition failure blames the **caller**; a postcondition failure blames the **function**.
- Properties and contracts are **one idea — executable specifications**. The most natural way to test a contract is a property: generate inputs that satisfy the precondition, then assert the postcondition. Contracts can be checked at **runtime** (assertions), via **property tests** (many inputs), or **proven at compile time** (Dafny, deeper tiers) — same spec, three strengths.

You now have the practical, accessible core of formal thinking: write down what must be true, and make a machine check it. It costs about as much as a normal test, catches bugs example tests miss, and is the bridge from "testing" to the heavier methods — model checking and proof — in the rest of this section.

---

## Further Reading

- [Hypothesis documentation](https://hypothesis.readthedocs.io/) — the Python PBT library used here; the "What you can generate" and "Quickstart" pages are the fastest way in.
- *QuickCheck: A Lightweight Tool for Random Testing of Haskell Programs* — Koen Claessen & John Hughes (2000). The original paper that invented property-based testing; short, readable, and the source of every PBT library since.
- *The Pragmatic Programmer* — Hunt & Thomas. The "Design by Contract" topic is the canonical short introduction to preconditions, postconditions, and invariants for working developers.
- [fast-check documentation](https://fast-check.dev/) — the JavaScript/TypeScript equivalent, if that's your stack.
- The [middle.md](middle.md) of this topic, which goes deeper into stateful/model-based testing, writing good generators, measuring coverage of the input space, and where compile-time contract *proof* (Dafny) fits in.

---

## Related Topics

- [01 — Formal Specification](../01-formal-specification/junior.md) — properties and contracts *are* lightweight specs; this is the broader idea of writing precise specifications.
- [02 — Model Checking](../02-model-checking/junior.md) — the heavier sibling: exhaustively explore *every* state instead of sampling inputs.
- [05 — Proof Assistants & Dependent Types](../05-proof-assistants-and-dependent-types/junior.md) — the strongest rung: *prove* a property for all inputs rather than test it.
- [Testing](../../testing/) — where property-based tests sit alongside unit, integration, and example tests.
- [Dynamic Analysis & Sanitizers](../../dynamic-analysis-and-sanitizers/) — runtime assertions and checks, the cheapest place a contract gets enforced.
