# Mutation Coverage — Junior Level

> **Roadmap:** [Code Coverage](../README.md) → Mutation Coverage
> *Line coverage tells you a line of code ran. It says nothing about whether your test would notice if that line were wrong. Mutation coverage is how you find out — by deliberately breaking the code and seeing if your tests scream.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Test That Asserts Nothing](#core-concept-1--the-test-that-asserts-nothing)
5. [Core Concept 2 — A Mutant Is a Tiny Deliberate Bug](#core-concept-2--a-mutant-is-a-tiny-deliberate-bug)
6. [Core Concept 3 — Killed vs Survived](#core-concept-3--killed-vs-survived)
7. [Core Concept 4 — Mutation Score, the Honest Number](#core-concept-4--mutation-score-the-honest-number)
8. [Core Concept 5 — A Full Worked Example](#core-concept-5--a-full-worked-example)
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

> Focus: **The idea that exposes useless tests.**

Here is a uncomfortable fact that nobody tells you when you first learn about test coverage: a test can run every single line of a function, report **100% coverage**, and still be completely worthless. It can pass even if the code it "tests" is wrong.

How? By executing the code but never **checking the result**. Coverage tools measure one thing only — *was this line reached while the tests ran?* They have no idea whether the test actually *looked* at what the code produced. A test that calls a function and then throws the answer away is, to a coverage tool, indistinguishable from a test that carefully verifies every output. Both light up the same green lines.

This is the single biggest lie in the coverage world, and it is everywhere. Teams proudly hit "90% coverage" with suites that would not catch a function returning the wrong answer, the wrong sign, or nothing at all.

**Mutation testing** is the technique that calls the bluff. The idea is almost cheeky: take your working code, deliberately introduce a small bug — change a `+` to a `-`, a `>` to a `>=`, a `true` to a `false` — and re-run your tests. If your tests were doing their job, at least one of them should now **fail**, because the code is now wrong. If every test still **passes** despite the broken code, your tests cannot tell correct code from broken code. That is the whole game.

Each deliberately broken version of your code is called a **mutant**. If a test fails on a mutant, you **killed** it (good — your suite noticed the bug). If all tests pass, the mutant **survived** (bad — your suite is blind to that bug). The percentage of mutants killed is your **mutation score**, and it is a far more honest measure of test quality than any line-coverage number.

> **The mindset shift:** line coverage asks *"did this code run?"* Mutation coverage asks *"would my tests catch a bug here?"* The first is about *reaching* code; the second is about *checking* it. Only the second tells you whether your tests are actually protecting you.

---

## Prerequisites

- **Required:** You can write a unit test in some language and run a test suite (examples use **JavaScript** and **Python**, with a nod to **Java**).
- **Required:** You understand what an **assertion** is — `assert`, `expect(x).toBe(y)`, `assertEquals` — the line in a test that actually *checks* a value.
- **Helpful:** You've seen a line-coverage report (the green/red gutter in your editor, or an HTML report). If you've ever celebrated a coverage percentage, even better — this page is about to complicate that feeling.
- **Helpful:** You've read [01 — Line, Branch & Path Coverage](../01-line-branch-path-coverage/junior.md), so you know what coverage measures *before* you learn what it misses.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Mutant** | A copy of your code with one small deliberate bug introduced (e.g. `>` changed to `>=`). |
| **Mutation operator** | The *rule* used to make a mutant — "replace `+` with `-`", "replace `true` with `false`", "delete this line". |
| **Killed** | A mutant that caused at least one test to **fail**. Your tests caught the bug. *Good.* |
| **Survived** | A mutant that left **all tests passing**. Your tests didn't notice the bug. *Bad — a gap.* |
| **Mutation score** | `killed ÷ total mutants × 100`. The percentage of injected bugs your suite catches. |
| **Equivalent mutant** | A mutant that changes the code but *not its behaviour*, so no test could ever catch it (a known nuisance). |
| **Assertion** | The line in a test that actually checks a value. No assertion → nothing can be killed. |

---

## Core Concept 1 — The Test That Asserts Nothing

Before we break any code, let's see *why* line coverage can't be trusted. Here is a function and a test.

```js
// price.js
function applyDiscount(price, isMember) {
  if (isMember) {
    return price * 0.9;   // members get 10% off
  }
  return price;
}
```

```js
// price.test.js
test("applyDiscount runs for members", () => {
  applyDiscount(100, true);   // call it... and that's it.
});
```

Run a coverage tool on this. The test calls `applyDiscount(100, true)`, which enters the `if`, executes the `return price * 0.9` line, and returns. **Both the `if` branch is taken and the discount line runs.** The coverage report will show this function as well-covered — green lines, a healthy percentage.

But look at the test again. It **never checks the result.** It calls the function and discards the answer. This test would pass if `applyDiscount` returned `price * 0.9`, or `price * 0.5`, or `price`, or `42`, or `undefined`. It would pass if you deleted the discount logic entirely. It asserts *nothing*.

> **Key insight:** Coverage measures *execution*, not *verification*. A line being green means "a test ran this line," not "a test would notice if this line were wrong." The gap between those two things is exactly where bugs hide — and it is invisible to every coverage percentage you will ever see.

This is not a contrived edge case. Assertion-free or assertion-weak tests creep into real suites constantly: a test that calls a setup function "just to cover it," a test whose assertions check the wrong thing, a test someone wrote to push a number over a CI threshold. Line coverage rewards all of them with green. Mutation testing is how you catch them.

---

## Core Concept 2 — A Mutant Is a Tiny Deliberate Bug

A **mutant** is your program with exactly one small change — a deliberately introduced bug. The change is made by a **mutation operator**: a mechanical rule for breaking code in a realistic way. You don't write mutants by hand; a tool generates dozens or hundreds of them automatically.

The operators mimic the kinds of mistakes humans actually make. A starter set:

| Operator | Original | Mutant | The real bug it imitates |
|---|---|---|---|
| Relational | `a > b` | `a >= b` | The classic off-by-one boundary error. |
| Arithmetic | `a + b` | `a - b` | Wrong operator. |
| Boolean | `return true` | `return false` | Inverted logic / wrong constant. |
| Conditional negation | `if (x)` | `if (!x)` | Flipped condition. |
| Constant | `limit = 100` | `limit = 0` (or `101`) | Wrong magic number. |
| Statement deletion | `total += item;` | *(line removed)* | Forgotten / dropped logic. |

Take our discount function. A mutation tool might generate these mutants, among others:

```js
// Mutant A — relational operator (irrelevant here, but shows the idea elsewhere)
// Mutant B — arithmetic: 0.9 multiplication left intact, but...
function applyDiscount(price, isMember) {
  if (isMember) {
    return price * 1.0;   // MUTANT: changed 0.9 → 1.0  (discount silently removed)
  }
  return price;
}
```

```js
// Mutant C — conditional negation
function applyDiscount(price, isMember) {
  if (!isMember) {        // MUTANT: condition flipped
    return price * 0.9;
  }
  return price;
}
```

Each mutant is a small, *plausible* bug — exactly the sort of thing a tired developer might introduce. The tool now runs your existing test suite against each mutant, one at a time, and records what happens.

> **Key insight:** Mutants are not random noise — they are *plausible bugs*. Each one asks a sharp question: *"If a developer made exactly this mistake, would your tests catch it?"* A surviving mutant is a real bug your suite is provably blind to.

---

## Core Concept 3 — Killed vs Survived

When the tool runs your tests against a mutant, exactly one of two things happens:

- **Killed** — at least one test **fails**. The mutant broke the code, and your tests *noticed*. This is the outcome you want. Your suite proved it can distinguish this correct behaviour from this broken behaviour.
- **Survived** — **all tests still pass**. The mutant broke the code, and your tests *didn't notice*. This is a gap: there is a real bug your suite cannot see.

Let's run our assertion-free test against Mutant B (`0.9 → 1.0`, discount silently removed):

```js
test("applyDiscount runs for members", () => {
  applyDiscount(100, true);   // calls the MUTANT, gets 100 instead of 90... and ignores it.
});
```

The mutant returns `100` instead of `90`. The discount is gone — the code is genuinely broken. But the test never checked the return value, so it **passes anyway**. The mutant **survives**.

Now imagine a *real* test — one that actually asserts:

```js
test("members get 10% off", () => {
  expect(applyDiscount(100, true)).toBe(90);   // checks the result!
});
```

Against Mutant B, this test computes `applyDiscount(100, true)` = `100`, compares it to the expected `90`, and **fails**. The mutant is **killed**. The difference between surviving and killed was a single line: the assertion.

> **Key insight:** A mutant survives *only* when no test can distinguish the mutated code from the original. The two reasons that happens: (1) **no test exercises that code at all** — a coverage gap line coverage already shows you; or (2) **a test exercises it but never asserts on the affected result** — a gap line coverage is utterly blind to. Mutation testing is the only metric that catches the second kind.

---

## Core Concept 4 — Mutation Score, the Honest Number

Once the tool has run every mutant, it tallies the results into a single number:

```
                 mutants killed
mutation score = ----------------  × 100
                 total mutants
```

If the tool generated 40 mutants and your tests killed 34 of them, your mutation score is `34 / 40 = 85%`. The 6 survivors are a precise, actionable to-do list: each one is a specific bug your suite cannot detect, pointing at a specific line.

Why is this more honest than line coverage? Compare what each number can survive:

- You can hit **100% line coverage** with tests that assert nothing (Concept 1). The number is high; the suite is worthless.
- You **cannot** get a high **mutation score** with tests that assert nothing — every mutant would survive, and your score would crater toward 0%. To kill a mutant, a test *must* assert on the affected behaviour. Mutation score is, in effect, **a measure of how much your tests actually check.**

That is the crux. Line coverage measures the code; mutation score measures the *tests*. A mutation score of 85% means "85% of plausible bugs in this code would be caught by your suite" — a statement about protection, not about which lines happened to run.

> **Key insight:** Line coverage has an easy ceiling — you can reach 100% and still be unprotected. Mutation score does not — to move it up, you are forced to write tests that genuinely verify behaviour. That is precisely why it is harder to game, and precisely why it is a more trustworthy signal of quality.

One honest caveat, so you're not surprised later: some mutants are **equivalent mutants** — they change the code's text but not its behaviour, so *no possible test* could kill them. (For example, changing `i < 10` to `i != 10` in a loop that only ever increments by 1 — same behaviour, different text.) These inflate the "survived" count without representing a real gap, and deciding which survivors are equivalent is a known, sometimes tedious, part of the practice. For now, just know that 100% mutation score is rarely the realistic goal — the goal is to *examine the survivors* and kill the ones that represent real, catchable bugs.

---

## Core Concept 5 — A Full Worked Example

Let's put it all together with a function that *needs* careful testing: a boundary check. Imagine a rule — *an order qualifies for free shipping if its total is over $50.*

```python
# shipping.py
def qualifies_for_free_shipping(total):
    return total > 50
```

Now the lazy test. It checks one obviously-true case and one obviously-false case:

```python
# test_shipping.py
def test_free_shipping():
    assert qualifies_for_free_shipping(100) == True    # clearly over
    assert qualifies_for_free_shipping(10)  == False   # clearly under
```

**Line coverage: 100%.** The single line in the function runs both times. Branch coverage is happy too — the comparison evaluates both `True` and `False`. By every coverage metric, this function is "fully tested." A dashboard would show all green.

Now bring in the mutants. A tool like **mutmut** would generate several, including this critical one:

```python
# Mutant — relational operator: > becomes >=
def qualifies_for_free_shipping(total):
    return total >= 50    # MUTANT: now $50 exactly ALSO qualifies
```

This mutant changes the behaviour at exactly one input: `total == 50`. Originally `50 > 50` is `False` (an order of exactly $50 does *not* get free shipping). The mutant makes `50 >= 50` return `True`. **This is a real bug** — the boundary moved.

Run the lazy test against this mutant:

- `qualifies_for_free_shipping(100)` → mutant returns `True`, test expects `True`. **Pass.**
- `qualifies_for_free_shipping(10)` → mutant returns `False`, test expects `False`. **Pass.**

Both assertions pass. The mutant **survives.** Despite 100% line coverage, the test suite cannot tell the correct rule (`> 50`) from the broken one (`>= 50`), because it never tests the one input where they differ: the boundary itself, `50`.

This is the entire lesson in one example. **100% coverage, and a mutant survived.** The coverage number told you the line ran; mutation testing told you the test would miss a real boundary bug.

The fix is obvious once the survivor names the gap — test the boundary:

```python
def test_free_shipping_boundary():
    assert qualifies_for_free_shipping(50) == False   # exactly $50 — does NOT qualify
    assert qualifies_for_free_shipping(51) == True    # one cent over — qualifies
```

Now re-run the mutant. `qualifies_for_free_shipping(50)` returns `True` (mutant) but the test expects `False` → **fail**. The mutant is **killed.** And notice: the very *act* of killing the mutant forced you to write the test you should have had all along — the boundary test. Mutation testing didn't just measure your suite; it *told you the exact test you were missing.*

> **Key insight:** Boundaries (`>`, `>=`, `<=`, `<`, `==`) are where off-by-one bugs live, and they are exactly what relational mutants probe. A test suite that never tests *at* the boundary will get full coverage and still let boundary bugs through. Mutation testing drags that gap into the light every time.

---

## Real-World Examples

**1. The "90% coverage" suite that caught nothing.** A team enforces 90% line coverage in CI and feels safe. A new mutation-testing run reports a mutation score of 41% — well over half of injected bugs survive. Digging in, they find dozens of tests that call functions inside a `try` block "to cover" them but never assert on the output. The coverage was real; the *checking* was not. The mutation score exposed in an afternoon what the coverage number had hidden for a year.

**2. A relational mutant finds a real production bug.** A pagination function uses `if (page > totalPages)` to clamp out-of-range requests. A surviving relational mutant (`>` → `>=`) reveals that no test covers the case where `page` *equals* `totalPages` — the last page. The team adds the test, and in doing so discovers the real code had an off-by-one that hid the last page of every result set. The mutant didn't just measure the suite; it pointed straight at a live bug.

**3. Mutation testing on the diff, not the whole repo.** Running every mutant against a large legacy codebase can take *hours* — far too slow for every pull request. So teams run mutation testing only on the **lines changed in the PR** (its "diff"). Tools support this directly: **Stryker** for JavaScript/TypeScript and **pitest** for Java both have an "incremental" or changed-files mode. You get the honest signal exactly where it matters — the new code — without waiting for the whole suite to mutate. This "mutation on the diff" pattern is what makes the technique practical day to day.

---

## Mental Models

- **Mutation testing is testing your tests.** Normal tests check your code. Mutation testing checks whether your *tests* would notice if the code broke. It's a quality check one level up — the auditor who audits the auditor.

- **A mutant is a sabotage drill.** Imagine an instructor quietly breaking one thing in the system to see if the alarms go off. Killed = the alarm sounded (good). Survived = the sabotage went unnoticed (your alarms have a blind spot). A high mutation score means your alarms cover the building.

- **Coverage is "did the guard walk past the door?" Mutation is "would the guard notice the door is unlocked?"** A guard can patrol every hallway (100% coverage) while never checking a single lock (0 mutants killed). You want a guard who *checks*, not one who merely *passes by*.

- **Every survivor is a free to-do item.** You don't have to imagine what your tests might miss — the surviving mutants hand you a precise list: *"this exact line, this exact change, no test would catch it."* Killing survivors is the most directed test-writing you'll ever do.

---

## Common Mistakes

1. **Believing high line coverage means good tests.** It means lines *ran*, not that anything was *checked*. A 100%-coverage suite with no assertions catches nothing. This is the misconception mutation testing exists to destroy.

2. **Writing tests with no (or weak) assertions.** A test that calls a function but never checks the result is theatre. It moves the coverage number and protects you from nothing. If you can delete every `assert`/`expect` from a test and it still passes, the test was always empty.

3. **Chasing 100% mutation score.** Equivalent mutants (text changed, behaviour unchanged) can't be killed by *any* test, so 100% is usually unrealistic and not worth the effort. The goal is to *review the survivors* and kill the ones that represent real, catchable bugs — not to grind the number to 100.

4. **Running full mutation testing on every commit.** Mutating a whole codebase is slow — often minutes to hours. Doing it on every push will make people hate it and turn it off. Run it on the **diff** (changed lines) in CI, and do full runs occasionally or nightly.

5. **Treating a surviving mutant as automatically "a bad test."** Sometimes it is; sometimes it's an *equivalent mutant* (no behaviour change) or it's pointing at code that genuinely doesn't matter. Read each survivor and decide. The value is in the *investigation*, not in blindly driving the score up.

6. **Confusing mutation *coverage* with mutation *testing as a discipline*.** This page treats it as a coverage signal — a number that tells you test quality. The broader technique (operator design, performance tricks, equivalent-mutant detection) is a whole topic of its own: see [Mutation Testing](../../testing/07-mutation-testing/).

---

## Test Yourself

1. In one sentence, what does line coverage measure, and what does it *fail* to measure?
2. A test calls `calculateTax(100)` but has no assertion. It reports 100% coverage of `calculateTax`. Why is this test worthless, and what would mutation testing report?
3. Define **killed** and **survived**. Which one is the good outcome, and why?
4. A function is `return age >= 18`. A mutant changes it to `return age > 18`. Your tests check `age = 25` (expect `True`) and `age = 10` (expect `False`). Does the mutant survive or get killed? What single test input would change the answer?
5. Why is a high mutation score harder to fake than a high line-coverage percentage?
6. Your mutation tool reports a survived mutant on a line your team agrees is correct and behaviourally identical to the mutant. What is this called, and what should you do?

<details>
<summary>Answers</summary>

1. Line coverage measures whether each line was **executed** during the tests; it does **not** measure whether any test would **notice** if that line produced a wrong result (i.e. whether the test asserts on the behaviour).
2. The test never checks the return value, so it would pass even if `calculateTax` returned the wrong number (or nothing) — it verifies nothing. Mutation testing would report that **every mutant of `calculateTax` survives**, giving a mutation score near 0% and exposing the gap that coverage hid.
3. **Killed** = at least one test failed on the mutant (your tests caught the injected bug). **Survived** = all tests passed despite the bug (your tests are blind to it). **Killed is the good outcome**, because it proves your suite can distinguish correct code from broken code.
4. The mutant (`>=` → `>`) differs from the original only at `age == 18`. The tests use `25` and `10`, neither of which is the boundary, so both assertions still pass and the mutant **survives**. Testing `age = 18` (expect `True`) would make the original pass and the mutant fail — **killing** it.
5. To raise a mutation score you must write tests that actually **assert on behaviour** — that's the only way to kill mutants. Line coverage can be pushed to 100% with assertion-free tests, so it's trivially gameable; mutation score is not.
6. It's an **equivalent mutant** — the code changed but the behaviour didn't, so no test could ever kill it. The right move is to **mark/ignore it** (or accept it as an unkillable survivor), not to contort a test trying to catch a difference that doesn't exist.

</details>

---

## Cheat Sheet

```
THE BIG LIE
  100% line coverage  ≠  good tests
  coverage = "did the line RUN?"   (execution)
  mutation = "would a bug be CAUGHT?" (verification)

MUTANT = your code + one tiny deliberate bug (made by a mutation OPERATOR)
  >    → >=        (relational / off-by-one)
  +    → -         (arithmetic)
  true → false     (boolean / constant)
  if(x)→ if(!x)    (conditional negation)
  stmt → (deleted) (statement deletion)

OUTCOMES (run your tests against each mutant)
  KILLED   = a test FAILED   → tests caught the bug   → GOOD
  SURVIVED = all tests PASSED → tests blind to the bug → GAP

WHY A MUTANT SURVIVES
  1. no test runs that code     (coverage already shows this)
  2. a test runs it but never ASSERTS on the result
                                (coverage is BLIND to this — mutation's killer feature)

MUTATION SCORE = killed / total × 100
  hard to fake: you MUST assert to kill mutants

GOTCHAS
  equivalent mutant = text changed, behaviour unchanged → unkillable, ignore it
  full runs are SLOW → run mutation on the DIFF in CI

TOOLS
  JS / TS / C# / Scala ........ Stryker
  Java ........................ pitest
  Python ...................... mutmut (also cosmic-ray)
```

---

## Summary

- **Coverage measures execution, not verification.** A test can run every line of a function (100% coverage) and still assert *nothing* — it would pass even if the code were wrong. This is the gap mutation testing exists to expose.
- **A mutant is a tiny, deliberate, plausible bug** — `>` → `>=`, `+` → `-`, `true` → `false` — generated automatically by a **mutation operator**. The tool injects each one and re-runs your tests.
- **Killed vs survived** is the whole game. *Killed* = a test failed (your suite caught the bug — good). *Survived* = all tests passed despite the bug (your suite is blind to it — a gap). A mutant survives either because no test runs the code, or — the case coverage can't see — because a test runs it but never asserts on the result.
- **Mutation score** = `killed ÷ total × 100`. Unlike line coverage, you *cannot* push it up without writing tests that genuinely check behaviour, which makes it a far more honest signal of test quality and much harder to game.
- **In practice:** review the survivors (some are *equivalent mutants* you can't kill), don't chase 100%, and run mutation testing on the **diff** rather than the whole repo to keep it fast enough for CI. Tools: **Stryker** (JS/TS/C#/Scala), **pitest** (Java), **mutmut** (Python).

The next time someone shows you a coverage badge, you'll know the real question isn't "what's the coverage?" — it's "would these tests catch a bug?" Mutation testing is how you answer it.

---

## Further Reading

- *TestCoverage* — Martin Fowler (martinfowler.com) — the canonical short essay on why coverage is a diagnostic, not a target; the perfect companion to this page.
- *An Industrial Evaluation of Mutation Testing* — Petrović & Ivanković (Google, 2018) — the paper that argued surfacing surviving mutants as code-review hints beats coverage percentages as a quality signal.
- [Stryker Mutator documentation](https://stryker-mutator.io/) — the reference mutation-testing tool for JavaScript/TypeScript; the "Getting started" page is genuinely beginner-friendly.
- [pitest documentation](https://pitest.org/) — the reference mutation-testing tool for the JVM; read "Basic concepts" for a second take on mutants and operators.
- The [middle.md](middle.md) of this topic, which goes deeper into mutation operators, equivalent-mutant detection, performance, and wiring mutation testing into a real CI pipeline.

---

## Related Topics

- [01 — Line, Branch & Path Coverage](../01-line-branch-path-coverage/junior.md) — what coverage *does* measure; read this first to understand exactly what mutation testing improves on.
- [05 — What Coverage Does *Not* Tell You](../05-what-coverage-does-not-tell-you/junior.md) — the broader catalogue of coverage's blind spots; "covered ≠ tested" is the same insight generalized.
- [06 — Coverage as Signal, Not Target](../06-coverage-as-signal-not-target/junior.md) — Goodhart's law and why gaming a coverage number (e.g. assertion-free tests) is so easy — and so dangerous.
- [Testing](../../testing/) — the broader testing discipline: where assertions, test design, and the testing taxonomy live.
- [Mutation Testing](../../testing/07-mutation-testing/) — mutation testing treated as a full technique in its own right (operator design, tooling internals, performance), beyond the coverage-signal lens of this page.
