# Mutation Testing — Junior Level

> **Roadmap:** [Testing](../README.md) → Mutation Testing
>
> *Code coverage tells you a line ran. Mutation testing tells you a line was actually tested. Those are not the same thing.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Coverage Lies, and Here's the Proof](#core-concept-1--coverage-lies-and-heres-the-proof)
5. [Core Concept 2 — What a Mutant Is](#core-concept-2--what-a-mutant-is)
6. [Core Concept 3 — Killed vs Survived](#core-concept-3--killed-vs-survived)
7. [Core Concept 4 — Your First Survived Mutant](#core-concept-4--your-first-survived-mutant)
8. [Core Concept 5 — Killing the Mutant](#core-concept-5--killing-the-mutant)
9. [Core Concept 6 — Reading a Mutant Line by Line](#core-concept-6--reading-a-mutant-line-by-line)
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

> Focus: **understanding that running a line is not the same as testing it — and seeing your first mutant get killed or survive.**

You wrote some tests. The coverage report says **100%**. Green badge on the README. Done, right?

Not quite. Coverage measures one thing: *did this line of code execute while the tests ran?* It does **not** measure whether any test would have **noticed** if that line were wrong. You can call a function, run every line in it, and assert nothing meaningful about the result. Coverage still says 100%.

Mutation testing is the honest check. It takes your working code, makes a small deliberate change to it — a **mutant**, like flipping `<` to `<=` or `+` to `-` — and then runs your tests again. The question is simple:

> When I break the code on purpose, does at least one test **fail**?

If a test fails, the mutant is **killed** — good, your tests are watching that behavior. If every test still **passes** even though the code is now wrong, the mutant **survived** — that's a hole. Your tests run that code but don't actually verify it.

That is the entire idea. The rest is detail.

---

## Prerequisites

- You can write and run unit tests in at least one language (see [Unit Testing](../02-unit-testing/)).
- You have seen a code-coverage report (line or branch coverage). If not, skim [Code Coverage](../../code-coverage/).
- You understand `if` conditions, comparison operators (`<`, `<=`, `==`), and basic arithmetic.
- Helpful: you've felt the false confidence of a green coverage badge at least once.

---

## Glossary

| Term | Meaning |
|---|---|
| **Coverage** | Whether a line/branch *executed* during the test run. Says nothing about whether it was *checked*. |
| **Mutant** | A copy of your code with one small deliberate fault injected. |
| **Mutation operator** | The rule that creates a mutant (e.g. `<` → `<=`, `+` → `-`, `return x` → `return null`). |
| **Killed mutant** | A mutant that made at least one test fail. Good — your suite caught the bug. |
| **Survived mutant** | A mutant where all tests still passed. Bad — your suite didn't notice the bug. |
| **Mutation score** | killed ÷ total mutants. A measure of how good your tests are at catching faults. |
| **Test suite** | The full set of tests run against the code. |

---

## Core Concept 1 — Coverage Lies, and Here's the Proof

Let's make this concrete. Here is a tiny function and a test for it.

```python
# discount.py
def apply_discount(price, is_member):
    if is_member:
        return price * 0.9   # members get 10% off
    return price
```

```python
# test_discount.py
def test_member_gets_discount():
    result = apply_discount(100, is_member=True)
    assert result is not None   # <-- weak assertion!
```

Run coverage:

```text
Name          Stmts   Miss  Cover
---------------------------------
discount.py       4      0   100%
```

**100% coverage.** Every line ran. The test passes. Looks done.

But the test only checks that the result is *not None*. It never checks the result is `90`. If someone changed `0.9` to `0.5`, or deleted the discount entirely, this test would **still pass**. Coverage gave you a green light on code that isn't really tested.

This is the gap mutation testing exposes. Coverage = **executed**. Mutation = **tested**.

---

## Core Concept 2 — What a Mutant Is

A **mutant** is your program with one tiny fault planted in it. The tool generates these automatically by applying **mutation operators** — simple find-and-replace rules that mimic the bugs humans actually write.

A few of the common ones:

| Original | Mutated | Operator name |
|---|---|---|
| `a < b` | `a <= b` | conditional boundary |
| `if (cond)` | `if (!cond)` | negate condition |
| `a + b` | `a - b` | math operator swap |
| `return x` | `return null` / `return 0` | return-value mutation |
| `foo()` | *(call removed)* | void method call removal |
| `x = 5` | `x = 0` | constant replacement |
| `return true` | `return false` | boolean swap |

Each operator probes a different kind of mistake. The boundary mutant (`<` → `<=`) checks whether you tested the *edge* of a range. The negate-condition mutant checks whether you tested *both* branches. The math swap checks whether you verified the actual computed value, not just "it returned something."

The tool makes one mutant at a time, re-runs your tests against it, records killed-or-survived, then throws that mutant away and makes the next one.

---

## Core Concept 3 — Killed vs Survived

There are exactly two outcomes that matter for each mutant:

```text
Mutant injected  →  run tests
                       │
        ┌──────────────┴───────────────┐
   a test FAILS                  all tests PASS
        │                              │
     KILLED                        SURVIVED
  (good — tests                (bad — tests ran the
   caught the bug)              code but didn't check it)
```

- **Killed** means a test *failed* when the code was broken. That's the result you *want* — a broken behavior was noticed. (Yes, the failing test is the success here.)
- **Survived** means every test *passed* even though the code is now wrong. Your tests touched that code but asserted nothing that depended on it being correct.

Every survived mutant is a concrete sentence: *"If this exact bug shipped, none of your tests would catch it."* That is far more useful than a coverage percentage.

---

## Core Concept 4 — Your First Survived Mutant

Back to our discount function. Run a mutation tool (`mutmut` for Python) on it:

```text
$ mutmut run

⠏ Generating mutants
⠹ Running tests on 3 mutants

Killed 0 out of 3 mutants

Surviving mutants:
  discount.py:3   price * 0.9   →   price / 0.9
  discount.py:3   price * 0.9   →   price * 1.0  (constant 0.9 → 1.0)
  discount.py:2   if is_member  →   if not is_member
```

Three mutants, **zero killed**. Every one survived. The tool changed multiplication to division, changed the discount rate, and even flipped the membership check — and the test never complained.

Why? Because the test only asserts `result is not None`. None of these mutations make the result `None`, so the test stays green. The mutation report just proved, mutant by mutant, that this code is effectively untested despite "100% coverage."

---

## Core Concept 5 — Killing the Mutant

Fix the test by asserting the actual behavior:

```python
def test_member_gets_ten_percent_off():
    assert apply_discount(100, is_member=True) == 90

def test_non_member_pays_full_price():
    assert apply_discount(100, is_member=False) == 100
```

Run again:

```text
$ mutmut run

Killed 3 out of 3 mutants  🎉

  discount.py:3  price * 0.9 → price / 0.9   KILLED (test expected 90, got 111.1)
  discount.py:3  price * 0.9 → price * 1.0   KILLED (test expected 90, got 100)
  discount.py:2  if is_member → if not...    KILLED (test expected 90, got 100)
```

Same coverage as before — still 100%. But now the tests **mean** something. The lesson: a survived mutant points you at a **specific missing or weak assertion**. You don't guess what's under-tested; the tool tells you exactly where and how.

---

## Core Concept 6 — Reading a Mutant Line by Line

When a tool reports a survivor, it tells you three things: the **file and line**, the **original code**, and the **mutation it applied**. Read it as a sentence.

```text
discount.py:2   if is_member  →   if not is_member   SURVIVED
└── file:line   └── original      └── the mutant     └── outcome
```

Translate it: *"On line 2, I flipped the membership check, and not one test failed."* That immediately tells you no test distinguishes a member from a non-member by the actual price. The fix writes itself — assert that a member gets `90` and a non-member gets `100`, so the two branches produce *different* results a test can see.

The habit to build: never just look at the score. Read each survivor line, say it out loud as a sentence, and the missing assertion becomes obvious.

---

## Real-World Examples

**The "asserts nothing" test.** A teammate's test calls `processOrder(order)` and asserts `assertNotNull(result)`. Coverage: 100% on `processOrder`. Mutation testing kills *zero* mutants inside it — proof the test verifies nothing about how the order was processed.

**The off-by-one that hid.** A function `is_eligible(age)` uses `age >= 18`. The only test passes `age = 25`. The boundary mutant `>= 18` → `> 18` **survives**, because 25 is true under both. The mutation report flags it; you add a test at `age = 18`, and now the boundary is pinned.

**The forgotten log-or-side-effect.** A method calls `auditLog.record(event)`. A "remove void call" mutant deletes that line and **survives** — no test checks the audit log was written. The report reveals a behavior nobody verifies.

---

## Mental Models

- **Coverage is "did the light turn on." Mutation is "does the light actually work."** Flipping the switch (executing the line) proves the wire is connected, not that the bulb lights.
- **Mutation testing tests your tests.** Normal tests check the code. Mutation checks the tests. It's one level up.
- **A survived mutant is a TODO with an address.** It tells you the file, the line, and the exact bug your suite would miss.
- **A failing test during mutation is a win.** "Killed" sounds violent but it's the good outcome — your tests did their job.

---

## Common Mistakes

- **Trusting coverage as "tested."** Coverage is a *floor*, not proof. 100% coverage with weak assertions kills no mutants.
- **Writing `assertNotNull` / `assert result` as the whole test.** These run the code without checking it. Mutation testing eats them alive.
- **Panicking at a low score the first time.** It's normal. The score is a diagnostic, not a grade. Start by killing the scariest survivors.
- **Running mutation testing on everything at once.** It's slow (you'll learn why in the middle tier). Start with one important function.
- **Thinking "killed" is bad.** Killed = caught = good. Survived = missed = bad.

---

## Test Yourself

1. A line shows 100% coverage but a mutant on it survives. What does that tell you?
2. What's the difference between a **killed** and a **survived** mutant — and which one do you want?
3. The test `assert apply_discount(100, True) is not None` gives 100% coverage. Name one mutant it would *not* kill.
4. Turn `age >= 18` into a mutant using the **conditional boundary** operator. What test input kills it?
5. Why is "killed" the good outcome even though it means a test failed?

<details>
<summary>Answers</summary>

1. The line *executed* but no test *checks* its behavior — there's a missing or weak assertion there.
2. Killed = a test failed when the code was broken (good, caught it). Survived = all tests passed despite the bug (bad, missed it). You want **killed**.
3. Almost any — e.g. `0.9 → 1.0` (returns 100, still not None), or `* → /` (returns 111.1, still not None). The `is not None` assertion can't distinguish them.
4. `age >= 18` → `age > 18`. The input `age = 18` kills it: original returns eligible (true), mutant returns not-eligible (false).
5. Because the *point* is to break the code and confirm a test notices. A test failing on broken code means the test works.

</details>

---

## Cheat Sheet

```text
COVERAGE  = was the line EXECUTED?     (necessary, not sufficient)
MUTATION  = was the line TESTED?       (the honest answer)

For each mutant:
  test FAILS  → KILLED   (good — your suite caught it)
  test PASSES → SURVIVED (bad  — your suite missed it)

MUTATION SCORE = killed / total mutants

A survived mutant = a specific missing/weak assertion.
Fix it by asserting the actual value, not "not null".

First operators to know:
  <  → <=   (boundary)        + → -   (math swap)
  if c → if !c (negate)       return x → return null/0
  true → false (boolean)      foo() → removed (void call)
```

---

## Summary

Coverage tells you a line **ran**; it cannot tell you the line was **tested**. Mutation testing closes that gap: it injects small, deliberate faults (**mutants**) into your code and reruns the tests. If a test fails, the mutant is **killed** — your suite is doing its job. If all tests still pass, the mutant **survived** — you have a real, located hole where a bug could ship unnoticed. The most common cause of survivors is a weak assertion like `assertNotNull`. The fix is to assert the *actual* behavior. Mutation testing doesn't replace coverage — it tells you whether your covered code is genuinely protected.

---

## Further Reading

- [Unit Testing — Junior](../02-unit-testing/junior.md) — write the strong assertions that kill mutants.
- [Code Coverage](../../code-coverage/) — what coverage measures, and where it stops.
- The **`unit-testing-patterns`** skill — patterns for assertions worth more than `assertNotNull`.
- `mutmut` (Python) and Stryker (JS/TS) — beginner-friendly tools to try the examples above.

---

## Related Topics

- [Unit Testing](../02-unit-testing/) — mutation testing is only as good as the unit tests it grades.
- [Property-Based Testing](../06-property-based-testing/) — another way to find behaviors your examples miss.
- [Code Coverage](../../code-coverage/) — the metric mutation testing complements (and corrects).
- [Test Strategy & the Pyramid](../01-test-strategy-and-the-pyramid/) — where this fits in your overall testing.
