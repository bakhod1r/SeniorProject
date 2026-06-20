# What Coverage Does Not Tell You — Junior Level

> **Roadmap:** [Code Coverage](../README.md) → What Coverage Does Not Tell You
> *A green "100% coverage" badge feels like a finish line. It isn't even a starting line. It tells you every line ran during your tests — and says nothing about whether a single one of them is correct.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Covered ≠ Asserted](#core-concept-1--covered--asserted)
5. [Core Concept 2 — Covered ≠ Correct](#core-concept-2--covered--correct)
6. [Core Concept 3 — The Test You Didn't Write](#core-concept-3--the-test-you-didnt-write)
7. [Core Concept 4 — One Line ≠ All Inputs](#core-concept-4--one-line--all-inputs)
8. [Core Concept 5 — The Blind Spots](#core-concept-5--the-blind-spots)
9. [Real-World Examples](#real-world-examples)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What can a coverage number actually promise you — and what can it never promise?**

Coverage tools answer exactly one question: *while my tests ran, which lines (or branches) of code executed at least once?* That's it. A line goes from "red" to "green" the instant the test runner steps through it — whether or not the test looked at the result, whether or not the result was right, whether or not the test even has a single check in it.

This is the most misunderstood number in software. People read "92% coverage" as "92% of my code is tested and working." It means nothing of the sort. It means 92% of your lines *ran* during the test suite. The 8% that didn't run is genuinely, provably untested — that part is useful. But the 92% that *did* run could be flawless, or it could be a minefield of bugs that no test would ever catch, and **the coverage number cannot tell the two apart.**

This page is about that gap. By the end you'll be able to look at a "100%" report and ask the right follow-up question — *but did the tests check anything?* — instead of trusting the colour green.

> **The mindset shift:** coverage is a **lower bound on what's untested**, not an **upper bound on quality**. It can only ever tell you *"you definitely did not test this."* It can never tell you *"what you tested is right."* Read it as a list of gaps to investigate, never as a grade on your work.

---

## Prerequisites

- **Required:** You've written at least a handful of unit tests in some language (examples use **Python** and a little **Go**), and you know what an *assertion* is — `assert`, `expect(...).toBe(...)`, `if got != want { t.Errorf(...) }`.
- **Required:** You've seen a coverage report or a coverage badge (the percentage, the red/green lines).
- **Helpful:** You've read [01 — Line, Branch & Path Coverage](../01-line-branch-path-coverage/junior.md), so you know what "covered" counts (a line *ran*) and what it doesn't.
- **Helpful:** You've at least once felt the false comfort of a high coverage number. You're about to learn why it was false.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Coverage** | The percentage of your code that *ran* while the tests executed. Nothing more. |
| **Covered line** | A line that executed at least once during the test run. "Green." |
| **Assertion** | A check inside a test that *fails the test* if a value is wrong (`assert x == 5`). The part that actually tests. |
| **Oracle** | The thing that decides "right or wrong." In a test, the oracle *is* the assertions. No assertion → no oracle → nothing is being judged. |
| **Edge case** | An unusual input that breaks naive code: empty list, zero, negative, `null`, the boundary value. |
| **Happy path** | The normal, everything-works input. The easy case tests usually cover. |
| **Error path** | The code that runs when something fails (an exception, a bad input). Often hard to trigger from a test. |
| **Requirement** | What the code is *supposed* to do. Coverage measures the code that exists, never the requirement you forgot to implement. |
| **False confidence** | Believing your code works because a number is high, when the number measured the wrong thing. |

---

## Core Concept 1 — Covered ≠ Asserted

Here is the single most important idea on this page, and the one that surprises almost everyone the first time they see it. **A test can run a line of code — covering it — without checking the result at all.**

Coverage is recorded by *execution*. The tool watches which lines the CPU steps through. It has no idea whether your test then looked at the output. So a test with **zero assertions** still moves lines from red to green.

Consider this function and its "test":

```python
# code under test
def divide(a, b):
    return a / b

# the "test"
def test_divide():
    divide(10, 2)      # the line runs → divide() is now 100% covered
                       # ...but we never checked that the answer is 5
```

Run a coverage tool on this and `divide` reports **100% covered**. The report is technically true: every line of `divide` executed. But the test asserts *nothing*. It could return `5`, `500`, or `"banana"` and the test would still pass. You have 100% coverage and a function that is, in every meaningful sense, **completely untested**.

Now scale that up. Imagine an entire test suite written like this — every function called, no value ever checked:

```python
def test_everything():
    divide(10, 2)
    parse_user("alice")
    calculate_invoice(order)
    send_email(msg)
    # not a single assert in sight
```

This suite would happily report **100% coverage of the whole program** and would pass even if every one of those functions were broken. The coverage badge would be a bright, confident, completely meaningless green.

> **Key insight:** Coverage measures whether code *ran*, not whether anything *checked the result*. A test with no assertions is not a test — it's a *smoke test at best, a lie at worst* — yet it counts toward coverage exactly the same as a rigorous one. **The number cannot distinguish a real test from an assertion-free one.** That's the whole problem in one sentence.

---

## Core Concept 2 — Covered ≠ Correct

The previous concept was about tests with *no* assertions. This one is sneakier: even a test *with* assertions, covering a line, doesn't prove the line is **correct**. Coverage knows the line *ran*. It has no opinion on whether the line does the *right thing*.

Watch a line stay green while the code is flatly wrong:

```python
# the code has a bug: it should be a + b
def add(a, b):
    return a - b        # BUG: subtraction, not addition

def test_add():
    assert add(5, 0) == 5   # passes! 5 - 0 == 5, and 5 + 0 == 5
```

`add` reports **100% covered**, and the test **passes**. The line ran, an assertion checked it, green all around. But `add` is *broken* — it subtracts. The test happened to pick `b = 0`, the one input where subtraction and addition give the same answer. Coverage saw the line execute and reported success. It cannot see that the logic is wrong, because **coverage is not a correctness checker — it's an execution counter.**

This is the trap behind "we have high coverage, so we're in good shape." High coverage means the lines *ran under test*. It says nothing about:

- whether the assertions were strong enough to catch a wrong answer (above, the assertion was real but the *input* was too weak),
- whether the expected value in the assertion was itself correct (people copy a buggy output into `assert x == <buggy value>` all the time),
- whether the code does the right thing for inputs the test didn't try.

> **Key insight:** Coverage tells you a line **executed**, never that it executed **correctly**. "Correct" is a question about behaviour for *all* relevant inputs; coverage is a fact about *one* execution. A green line is a line that *ran while you weren't necessarily looking closely* — it is not a line that *works*.

---

## Core Concept 3 — The Test You Didn't Write

Coverage can only measure the code that **exists** and the tests that **exist**. It is structurally incapable of telling you about:

1. **The test you forgot to write** — the edge case nobody thought of.
2. **The requirement you never coded** — the behaviour that's missing entirely.

Both are invisible to coverage, and both are where the worst bugs hide.

**The missing edge case.** Suppose you wrote and tested this:

```python
def first_item(items):
    return items[0]

def test_first_item():
    assert first_item([10, 20, 30]) == 10   # 100% covered, passing
```

`first_item` is **100% covered**. But what happens on an *empty* list? `first_item([])` throws `IndexError` and crashes. The coverage report is a serene 100% — because the *line* `return items[0]` ran, and coverage counts lines, not *inputs*. The empty-list case isn't a red line you forgot to cover; **there's no line for it at all.** The bug lives in a test that was never written, and coverage has no way to point at a test that doesn't exist.

**The missing requirement.** This one is even more invisible. Say the spec says "passwords must be at least 8 characters," but the developer simply *forgot* to write that check:

```python
def is_valid_password(pw):
    return pw != ""        # checks "not empty" — but the length rule is MISSING
```

You can hit **100% coverage** of this function easily. Every line runs; every test passes. But the code is *wrong by omission* — an entire requirement (the 8-character minimum) was never written down as code, so there's nothing for coverage to measure. **Coverage grades the code that's there. It is silent about the code that should have been there but isn't.**

> **Key insight:** Coverage can only ever talk about code that *exists*. The most dangerous bugs are **absences** — the edge case you didn't test, the rule you didn't implement. By definition, an absence has no line to colour, so coverage will report 100% over a program that's missing half its job. *A perfect coverage score over an incomplete program is still a perfect score.*

---

## Core Concept 4 — One Line ≠ All Inputs

When a coverage tool marks a line "covered," it means that line ran for **at least one** input. One. It does **not** mean the line was tested for *every* input that matters — and the bugs almost always live in the inputs you skipped.

A single line can behave correctly for one value and explode on another:

```python
def average(numbers):
    return sum(numbers) / len(numbers)

def test_average():
    assert average([2, 4, 6]) == 4    # the line is now "covered" ✓
```

That line is **100% covered**. It works for `[2, 4, 6]`. But the *same line*, the one already painted green, crashes on:

- `average([])` → `ZeroDivisionError` (empty list, `len` is 0),
- and depending on the language, surprises with negative numbers, huge numbers that overflow, or `NaN`.

Coverage saw the line run *once*, ticked the box, and moved on. It has no concept of "this line should be tried with an empty list, a single element, negatives, and a giant list." The classic bug families all hide inside already-covered lines:

| The bug | The line that hides it | The input you skipped |
|---|---|---|
| Off-by-one | `for i in range(len(a))` / `a[i+1]` | the *last* index, the boundary |
| Null / `None` | `user.name` | `user` is `None` |
| Empty collection | `items[0]`, `sum(x)/len(x)` | the empty list / string |
| Overflow / precision | `a + b`, `a * b` | the value near the limit |

Every one of these can sit behind a 100%-covered line. The line ran for the *easy* input; the *hard* input was never tried; coverage cannot tell the difference because **it counts executions of lines, not the variety of inputs through them.**

> **Key insight:** "Covered" means **"ran for ≥ 1 input,"** not **"correct for all inputs."** A line covered once with the happy-path value is, from coverage's point of view, identical to a line stress-tested with empty, null, negative, and boundary inputs. The off-by-one and the null-pointer crash live *inside green lines*, which is exactly why a high number doesn't protect you from them.

---

## Core Concept 5 — The Blind Spots

Some categories of bug are not just *missed* by coverage — they're nearly *invisible* to it, because the metric isn't built to see them. Two big ones at this level:

**1. Concurrency and async code.** Coverage tells you a line *ran*. It does **not** tell you the line ran *safely when two things happened at once*. The most painful concurrency bugs — **race conditions** — depend on the *timing* of execution, not just *whether* a line executed.

```python
balance = 100

def withdraw(amount):
    global balance
    if balance >= amount:        # two threads can both pass this check...
        balance -= amount        # ...then both subtract — balance goes negative
```

A test that calls `withdraw` once will mark both lines **100% covered**. But the *bug* only appears when two threads run `withdraw` *at the same time* and interleave between the check and the subtraction. Coverage saw the lines execute; it has no notion of "did these lines execute *concurrently* in the dangerous order?" The interleaving that triggers the bug is exactly what coverage doesn't measure. (This is a major theme at higher tiers — see [middle.md](middle.md).)

**2. Error and failure paths.** Coverage can *see* an error-handling branch is uncovered (that's useful — it'll show red), but the realistic versions are hard to drive from a test, so they often sit untested even when the headline number looks fine:

```python
try:
    data = fetch_from_network()
except TimeoutError:
    return cached_value()        # how often is THIS line tested?
```

Triggering a *real* network timeout in a test is awkward, so this branch is commonly skipped — meaning the very code that's supposed to save you in a crisis is the *least* tested code you have. A high overall percentage can quietly coexist with completely untested failure handling.

> **Key insight:** Coverage measures *that a line ran*, in *one* timing, on *one* path. Bugs that depend on **timing** (races, interleavings) or on **rare failure conditions** (the timeout, the disk-full, the malformed response) live outside what a single execution can reveal. A green line in concurrent or error-handling code is the *least* trustworthy green there is.

---

## Real-World Examples

**1. The 100%-covered service that shipped a broken calculation.** A billing team enforced "100% coverage or the build fails." Under deadline pressure, a developer hit the target with tests that called every function but asserted almost nothing — the classic assertion-free pattern from Concept 1. Coverage: 100%, build green, shipped. A tax-rounding function was off by a cent on certain totals. Every line of it had run under test; not one test had *checked the output*. Customers found the bug before the test suite ever could. The number was 100% and the code was wrong — because **coverage measured execution, and nobody had measured correctness.**

**2. The empty-list crash behind a green report.** A search feature reported 100% coverage and passed CI for months. Then a user ran a query that matched *nothing*, the results page called `results[0]` to show a preview, and the whole page 500'd. The line `results[0]` had been *covered* the entire time — every test used a query that returned results. The empty case (Concept 4) was an input nobody tested, behind a line that was always green. Coverage pointed at *nothing*, because there was no uncovered line to point at.

**3. The missing requirement no metric could catch.** A signup form was supposed to reject disposable email domains (a written product requirement). The developer never implemented the check. Tests were thorough *for the code that existed* — valid emails accepted, malformed emails rejected — and coverage was high. But disposable-email rejection was an *absent* requirement (Concept 3): there was no code, so there was nothing to cover and nothing to test. Spam poured in. No coverage tool on earth could have flagged a rule that was never written.

---

## Mental Models

- **Coverage is a smoke detector, not a building inspector.** A smoke detector tells you *where there's no detector at all* (the uncovered rooms). It says nothing about whether the wired rooms are actually safe. Green rooms might be fine — or full of problems the detector can't sense. Use it to find *unmonitored* areas, never to certify the monitored ones.

- **Covered means "the light turned on," not "the room is clean."** Walking into a room and flipping the switch (running the line) proves the wiring works. It tells you nothing about the state of the room. A test with no assertion is someone who flips every switch and leaves without looking inside.

- **Coverage answers "did it run?" — testing answers "is it right?"** These are different questions with different tools. Coverage is execution accounting. *Assertions* are the thing that actually tests. A high coverage number with weak assertions is a full attendance sheet for a class where nobody learned anything.

- **A 100% score over a buggy program is still 100%.** The number doesn't get *smaller* when your code is wrong. It only gets smaller when lines *don't run*. Wrong-but-running code keeps the number high — which is precisely why the number can't be a measure of quality.

---

## Common Mistakes

1. **Reading "100% coverage" as "100% tested."** It means 100% of lines *ran* during tests. The result may have been checked rigorously, weakly, or not at all. Coverage cannot tell you which — always ask "but do the tests *assert* anything meaningful?"

2. **Trusting the green and skipping the assertion review.** A green report can sit on top of assertion-free tests. The colour comes from *execution*, not from *checking*. Read the tests, not just the badge.

3. **Assuming a covered line is a correct line.** Coverage saw it run once, on one input. The off-by-one, the `None`, the empty list, the wrong operator — all live happily inside green lines (Concepts 2 and 4).

4. **Believing high coverage means "no missing tests."** Coverage can only flag *uncovered existing code*. The edge case you never tested and the requirement you never coded have **no line to colour**, so they stay invisible at any coverage percentage (Concept 3).

5. **Treating 100% as the goal instead of a diagnostic.** The moment "hit the number" becomes the objective, people hit it the cheap way — assertion-free tests, excluding hard code from the report — and coverage stops measuring anything real. (This is its own topic: [06 — Coverage as Signal, Not Target](../06-coverage-as-signal-not-target/junior.md).)

6. **Expecting coverage to catch concurrency or failure bugs.** Races depend on *timing*; failure paths depend on *rare conditions*. A single test execution reveals neither, even while marking the lines green (Concept 5).

7. **Ignoring the one thing coverage *is* good for.** Low or zero coverage on a function is a *real, trustworthy* signal: that code is definitely untested. Don't swing so far into skepticism that you waste the genuinely useful half of the metric — the *uncovered* half.

---

## Test Yourself

1. A function reports **100% coverage** and its test passes. Name *two* different ways the function could still be completely broken.
2. What does a coverage tool actually measure when it marks a line "covered"? Answer in one precise sentence.
3. Write (in words or code) a test that achieves 100% coverage of `def square(x): return x * x` but does *not* actually test that `square` is correct.
4. `def first(items): return items[0]` shows 100% coverage and a passing test. What input crashes it, and why didn't coverage warn you?
5. A spec says "reject passwords under 8 characters," but the developer never wrote that check. The code is at 100% coverage. Why can't coverage catch this?
6. Coverage is genuinely useful for *one* kind of conclusion. What is the one thing a coverage number can tell you with confidence?

<details>
<summary>Answers</summary>

1. (a) **The test has no assertion** — it called the function but never checked the result, so any return value passes (Concept 1). (b) **The test asserts, but on a weak input** — e.g. checking `add(5,0)` when the code subtracts; the one input where the bug doesn't show (Concept 2). (Also acceptable: it's correct for the tested input but wrong for an *untested* input — Concept 4.)
2. It means **that line executed at least once during the test run** — nothing about whether the result was checked or correct.
3. `def test_square(): square(4)` — the line `return x * x` runs (100% covered), but there is **no assertion**, so `square` could return anything and the test would still pass.
4. **An empty list, `first([])`**, throws `IndexError`. Coverage didn't warn you because the line `return items[0]` *ran* for the non-empty input you tested — coverage counts *lines that ran*, not *inputs you tried*, and there's no separate line for the empty case (Concept 4).
5. Because the rule was **never written as code**. Coverage can only measure code that *exists*; a missing requirement has **no line to cover**, so the program is "100% covered" while being incomplete (Concept 3).
6. It can tell you, reliably, **which code your tests did *not* run** — the uncovered (red) parts are *definitely* untested. It can *never* tell you that the covered parts are correct.

</details>

---

## Cheat Sheet

```
WHAT COVERAGE MEANS
  "covered" line  = it RAN ≥ 1 time during tests.  That's ALL.
  It does NOT mean: asserted, correct, tested for all inputs, or safe.

THE FOUR GAPS
  covered ≠ asserted  → a test with NO assertion still hits 100% (counts execution, not checking)
  covered ≠ correct   → a wrong line runs green (subtract-vs-add passes when b==0)
  covered ≠ complete  → missing edge case / missing requirement has NO line to colour
  one line ≠ all inputs→ green = ran for ONE input; off-by-one/null/empty hide inside green

BLIND SPOTS (least trustworthy green)
  concurrency / async → bug is in the TIMING, not whether the line ran
  error / failure paths→ hard to trigger, so often untested even at high %

THE ONLY HONEST READING
  coverage = LOWER BOUND on what's UNTESTED   (uncovered = definitely untested ✓ useful)
  coverage ≠ UPPER BOUND on QUALITY           (covered ≠ working ✗ don't trust)

THE ONE QUESTION TO ALWAYS ASK
  "100%? Great — but do the tests ASSERT anything meaningful?"
```

---

## Summary

- A coverage tool measures exactly one thing: **which lines ran during your tests**. It is an execution counter, not a correctness checker.
- **Covered ≠ asserted.** A test with *zero assertions* still drives lines to 100% covered. Coverage counts execution, not checking — so a green report can sit on top of tests that verify nothing.
- **Covered ≠ correct.** A line can run green while the logic is wrong (subtraction instead of addition, passing only because the input was too weak to expose it). Coverage sees the line execute; it has no opinion on whether it executed *right*.
- **Covered ≠ complete.** Coverage can only measure code that *exists*. The edge case you forgot to test and the requirement you never coded have *no line to colour*, so a 100% score sits happily over an incomplete program.
- **One line ≠ all inputs.** "Covered" means "ran for at least one input." The off-by-one, the `None`, the empty list — all hide inside already-green lines, because coverage counts line executions, not input variety.
- **Blind spots:** concurrency bugs (timing, not execution) and failure paths (rare, hard to trigger) are the *least* trustworthy green lines you have.

The honest reading, every time: coverage is a **lower bound on what you did not test** — useful, because uncovered code is *definitely* untested. It is **never an upper bound on quality** — a green 100% does *not* mean your code is right. Use it to find the gaps; never let it tell you the gaps are gone.

---

## Further Reading

- *TestCoverage* — Martin Fowler (martinfowler.com). The canonical short essay: coverage is a way to find *untested* code, useless as a target. Read it once at every level of your career.
- *Software Engineering at Google* — Winters, Manshreck, Wright. The testing chapters on why Google does **not** enforce a global coverage threshold — directly because of the gaps on this page.
- [02 — Mutation Coverage](../02-mutation-coverage/junior.md) — the technique that *directly* attacks the "covered ≠ asserted / correct" problem by deliberately breaking your code to see if any test notices.
- The [middle.md](middle.md) of this topic — formalizes the *oracle problem*, concurrency/interleaving blind spots, and what is and isn't worth covering.

---

## Related Topics

- [01 — Line, Branch & Path Coverage](../01-line-branch-path-coverage/junior.md) — what "covered" counts in the first place; the foundation this page critiques.
- [02 — Mutation Coverage](../02-mutation-coverage/junior.md) — the honest answer to "but do my tests actually *check* anything?"
- [06 — Coverage as Signal, Not Target](../06-coverage-as-signal-not-target/junior.md) — what happens when a team turns this number into a goal, and how they game it.
- [Testing](../../testing/) — the broader discipline: how to write tests whose assertions actually *test*, so your coverage means something.
