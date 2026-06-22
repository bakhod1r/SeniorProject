# Property-Based Testing — Junior Level

> **Roadmap:** [Testing](../README.md) → Property-Based Testing

*Stop hand-picking a handful of examples. State a rule that must hold for **all** inputs, and let the machine hunt for the case that breaks it.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Example tests vs. property tests](#core-concept-1--example-tests-vs-property-tests)
5. [Core Concept 2 — Your first property with `@given`](#core-concept-2--your-first-property-with-given)
6. [Core Concept 3 — What a generator is](#core-concept-3--what-a-generator-is)
7. [Core Concept 4 — Shrinking: the minimal counterexample](#core-concept-4--shrinking-the-minimal-counterexample)
8. [Core Concept 5 — The round-trip property](#core-concept-5--the-round-trip-property)
9. [Core Concept 6 — Reading a failure and reproducing it](#core-concept-6--reading-a-failure-and-reproducing-it)
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

> Focus: **moving from "I tested the three cases I thought of" to "I stated a rule the framework checks against hundreds of inputs."**

When you write a normal unit test, you do three things by hand: pick an input, compute the answer you expect, and assert they match. That works, but it has a blind spot — you can only test the cases *you* thought of. The bug usually lives in the case you *didn't* think of: the empty list, the negative number, the string with an emoji in it, the duplicate key.

Property-based testing (PBT) flips the script. Instead of "for input `5`, output should be `25`," you state a **property** — a rule that should hold for *every* input — and a framework generates many inputs (often hundreds), feeds each one to your code, and checks the rule. When it finds a failure, it doesn't just report it; it *simplifies* the failing input down to the smallest version that still breaks (this is **shrinking**, the killer feature). You read the report and immediately see the heart of the bug.

This level gets you writing your first property and reading your first shrunk counterexample. Deeper patterns, generators, and stateful testing come in the higher tiers.

---

## Prerequisites

- You can write and run a basic unit test (see `../02-unit-testing/`). PBT is a *style* of unit test, not a replacement.
- You understand functions: input in, output out.
- A test runner installed: `pytest` + `hypothesis` (Python) is the gentlest on-ramp. The `property-based-testing` skill walks through setup.

---

## Glossary

| Term | Meaning |
|------|---------|
| **Example-based test** | A test that asserts a specific input produces a specific expected output. |
| **Property** | A rule that must hold for *all* valid inputs (e.g., "sorting never changes the length"). |
| **Generator (strategy / arbitrary)** | Code that produces random structured inputs of a given type. |
| **Counterexample** | An input that makes the property fail. |
| **Shrinking** | Automatically reducing a failing input to the smallest one that still fails. |
| **Seed** | The number that drives the random generator; replaying it reproduces the same inputs. |
| **Round-trip** | A property of the form `decode(encode(x)) == x`. |
| **Invariant** | Something that stays true no matter what the operation does (e.g., output is always sorted). |

---

## Core Concept 1 — Example tests vs. property tests

Here is an example-based test for a `sort` function:

```python
def test_sort_examples():
    assert my_sort([3, 1, 2]) == [1, 2, 3]
    assert my_sort([]) == []
    assert my_sort([5]) == [5]
```

This passes if `my_sort` handles *these three lists*. But what about `[1, 1, 1]`? Negative numbers? A 10,000-element list? A list with `None` in it? You'd have to write each one out, and you'd still miss some.

The property-based mindset asks a different question: **what is always true about the output of a correct sort, regardless of the input?**

1. The output has the **same length** as the input.
2. The output is **ordered** (each element ≤ the next).
3. The output is a **permutation** of the input (same elements, possibly reordered).

If all three hold for *any* list you can throw at it, the function sorts correctly. We don't need to know the expected answer in advance — we describe what a right answer *looks like*.

---

## Core Concept 2 — Your first property with `@given`

In Python's **Hypothesis**, `@given` decorates a test and supplies generated inputs:

```python
from hypothesis import given
from hypothesis import strategies as st

@given(st.lists(st.integers()))
def test_sort_length_is_preserved(xs):
    assert len(my_sort(xs)) == len(xs)

@given(st.lists(st.integers()))
def test_sort_output_is_ordered(xs):
    result = my_sort(xs)
    assert all(result[i] <= result[i + 1] for i in range(len(result) - 1))

@given(st.lists(st.integers()))
def test_sort_is_a_permutation(xs):
    from collections import Counter
    assert Counter(my_sort(xs)) == Counter(xs)
```

`st.lists(st.integers())` is the generator: "lists of integers, any length, any values." Run this and Hypothesis will execute each test function ~100 times with different lists — empty ones, huge ones, all-negative ones, all-duplicates ones — and only pass if the property held every single time. You wrote three rules; the framework wrote the test cases.

The same idea in **fast-check** (JavaScript/TypeScript):

```javascript
import fc from 'fast-check';

test('sort preserves length', () => {
  fc.assert(
    fc.property(fc.array(fc.integer()), (xs) => {
      return mySort(xs).length === xs.length;
    })
  );
});
```

`fc.array(fc.integer())` is the generator; `fc.assert(fc.property(...))` runs it many times.

---

## Core Concept 3 — What a generator is

A **generator** (Hypothesis calls them *strategies*, jqwik calls them *Arbitraries*, fast-check calls them *arbitraries*) is just a recipe for producing random values of some shape. The framework ships with generators for the basics:

```python
st.integers()                      # any int
st.integers(min_value=0)           # non-negative ints
st.text()                          # any unicode string (yes, emoji and control chars)
st.booleans()
st.lists(st.integers())            # list of ints
st.lists(st.text(), max_size=5)    # short lists of strings
st.dictionaries(st.text(), st.integers())   # dict[str, int]
```

You compose them like Lego: `st.lists(st.lists(st.integers()))` is "a list of lists of integers." The generator is *the reason* PBT finds weird inputs — `st.text()` will happily hand you `"\x00"` or `"💩"` or a 4,000-character string, exactly the cases a human writing examples skips. You'll learn to build custom generators for your own types at the middle level.

---

## Core Concept 4 — Shrinking: the minimal counterexample

This is the feature that makes PBT *worth it*. Suppose we have a buggy `my_sort` that mishandles negative numbers. The raw failing input Hypothesis first stumbles on might be:

```
[847, -12, 0, 9931, -4, 22, -4, 100000, -7771, 6, ...]   # 60 elements
```

Useless to debug. But Hypothesis doesn't stop there. Once it finds *any* failure, it **shrinks**: it repeatedly tries simpler versions of the input — shorter lists, smaller numbers, values closer to zero — and keeps whichever still fails. It walks that 60-element monster down to:

```
Falsifying example: test_sort_output_is_ordered(xs=[-1, 0])
```

Two elements. Now the bug is obvious: the function doesn't order `-1` before `0`. A failing property doesn't just tell you *that* you're wrong — after shrinking, it tells you *the simplest way* you're wrong. That report is the single most valuable thing PBT gives a junior engineer: an unambiguous, minimal reproduction handed to you for free.

The mechanism (intuitively): "can I make the list shorter and still fail? can I make these numbers smaller and still fail? can I move them toward zero and still fail?" — repeat until nothing simpler fails.

---

## Core Concept 5 — The round-trip property

The single easiest property to find is the **round-trip**: if you transform data one way and then back, you should get the original. Encoding/decoding, serializing/parsing, and compress/decompress are all round-trips.

```python
import json
from hypothesis import given
from hypothesis import strategies as st

# A generator for "JSON-able" values
json_values = st.recursive(
    st.none() | st.booleans() | st.integers() | st.text(),
    lambda children: st.lists(children) | st.dictionaries(st.text(), children),
)

@given(json_values)
def test_json_round_trips(value):
    assert json.loads(json.dumps(value)) == value
```

This one test exercises nested lists, dicts, unicode keys, deeply nested structures — thousands of shapes you'd never enumerate by hand. If your serializer ever loses data, round-trip catches it. In fast-check:

```javascript
fc.assert(
  fc.property(fc.jsonValue(), (value) => {
    return _.isEqual(JSON.parse(JSON.stringify(value)), value);
  })
);
```

Round-trip is your first reflex whenever you see a *pair* of inverse functions.

---

## Core Concept 6 — Reading a failure and reproducing it

When a property fails, Hypothesis prints a focused report — learn to read it:

```
Falsifying example: test_sort_output_is_ordered(
    xs=[-1, 0],
)
```

Three things to notice:

1. **The test name** tells you *which* property broke — here, "output is ordered," so the bug is about ordering, not length or element loss.
2. **The shrunk input** (`xs=[-1, 0]`) is the minimal case. You don't debug the original random monster; you debug this.
3. **It's reproducible.** PBT is random, but every run is driven by a **seed**. Hypothesis remembers the last failing example in a local `.hypothesis/` folder and replays it *first* on the next run, so once you've seen a failure it keeps failing until you fix it — no "it passed on my machine" surprise.

The first move after a failure is almost always: copy the shrunk input into a plain example test so it's checked forever, even after you fix the bug.

```python
from hypothesis import example

@given(st.lists(st.integers()))
@example([-1, 0])                      # the counterexample PBT just found
def test_sort_output_is_ordered(xs):
    result = my_sort(xs)
    assert all(result[i] <= result[i + 1] for i in range(len(result) - 1))
```

`@example([-1, 0])` forces that exact input to run alongside the generated ones — a permanent regression guarding against the bug coming back. The higher tiers go deep on seeds and reproducibility; for now, just remember: a PBT failure is a gift, and you pin it with `@example`.

---

## Real-World Examples

- **URL encoding.** `decode(encode(s)) == s` for any string `s`. PBT finds the space, the `+`, the `%`, the emoji that your three hand-written examples missed.
- **A `parse` / `format` pair for money.** `parse(format(amount)) == amount`. Catches rounding bugs around `0.10`, negative zero, very large values.
- **Reversing a list twice.** `reverse(reverse(xs)) == xs` — trivial but a real smoke test that your reverse handles empty and single-element lists.
- **Set operations.** `len(union(a, b)) <= len(a) + len(b)` — an invariant that holds for any two sets.

---

## Mental Models

- **"Describe the answer, don't compute it."** Example tests need you to know the expected output. Properties only need you to know what a *correct* output looks like.
- **The framework is an adversary.** It is actively trying to break your code with the nastiest inputs in its reach. That's a feature.
- **Shrinking is a debugger you didn't write.** It hands you the minimal reproduction automatically.

---

## Common Mistakes

- **Re-implementing the function inside the property.** `assert my_sort(xs) == sorted(xs)` only tests that you have `sorted`. Prefer structural properties (length, ordered, permutation) unless `sorted` is a trusted *oracle* (middle level).
- **Properties that are accidentally always true.** `assert len(my_sort(xs)) >= 0` passes for everything, including a broken sort. A property that can't fail tests nothing.
- **Forgetting edge generators.** `st.integers()` includes `0` and negatives; `st.text()` includes empty and unicode. Don't restrict the generator just to make the test pass — that hides the bug.
- **Treating PBT as a replacement for all unit tests.** It complements example tests; keep a few readable examples as documentation.

---

## Test Yourself

1. Why can an example-based test miss a bug that a property test catches?
2. Write the three properties of a correct `sort`.
3. What does shrinking do, and why does it make a failing test more useful?
4. Give the round-trip property for a base64 encoder.
5. Why is `assert len(result) >= 0` a bad property?

---

## Cheat Sheet

```python
from hypothesis import given, strategies as st

@given(st.lists(st.integers()))      # generator supplies inputs
def test_property(xs):
    assert P(xs)                     # rule that must hold for ALL xs

# Common strategies
st.integers(), st.text(), st.booleans(), st.floats()
st.lists(st.integers()), st.dictionaries(st.text(), st.integers())

# Property reflexes
# round-trip:    decode(encode(x)) == x
# invariant:     output stays ordered / same length / same elements
```

---

## Summary

Example tests check the inputs you thought of; property tests state a rule and let the framework check inputs you'd never write. You declare a **property**, a **generator** supplies many inputs, and on failure **shrinking** reduces the input to a minimal counterexample you can debug instantly. Start with **round-trip** properties (`decode(encode(x)) == x`) and the structural properties of sorting (length, ordered, permutation). Next, the middle level covers the full catalogue of property patterns, building your own generators, and how shrinking works in depth.

---

## Further Reading

- Hypothesis documentation — "Quick start" and "What you can generate."
- fast-check documentation — "Getting started."
- The `property-based-testing` skill (concepts and worked examples).

---

## Related Topics

- [Unit Testing](../02-unit-testing/) — PBT is a style of unit test; master example tests first.
- [Property-Based Testing — Middle](./middle.md) — patterns, generators, and shrinking in depth.
- [Mutation Testing](../07-mutation-testing/) — checks whether your tests (PBT included) actually catch bugs.
- [Flaky Tests and Reliability](../12-flaky-tests-and-reliability/) — keeping randomized tests deterministic.
