# Mutation Testing — Interview Level

> **Roadmap:** [Testing](../README.md) → Mutation Testing
>
> *A question bank that separates people who recite "code coverage" from people who understand whether tests actually test anything.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Fundamentals](#fundamentals)
4. [Technique](#technique)
5. [Score & Cost](#score--cost)
6. [Scenarios](#scenarios)
7. [Rapid-Fire](#rapid-fire)
8. [Red Flags / Green Flags](#red-flags--green-flags)
9. [Cheat Sheet](#cheat-sheet)
10. [Summary](#summary)
11. [Further Reading](#further-reading)
12. [Related Topics](#related-topics)

---

## Introduction

> Focus: **answering mutation-testing questions the way a senior engineer would — leading with the "coverage = executed, mutation = tested" distinction and reasoning about cost, equivalents, and Goodhart.**

Mutation testing comes up in interviews for two reasons: it tests whether you actually understand what coverage does *not* measure, and it's a strong signal of testing maturity. The wrong answer is "it's coverage but better." The right answer always routes through one idea — **coverage proves a line ran; mutation proves a line is tested** — and then handles the practical realities (cost, equivalent mutants, where it's worth running).

Each question below gives the **Q**, *what's really being tested*, and a model **A** you can adapt.

---

## Prerequisites

- You can explain code coverage and its limits ([Code Coverage](../../code-coverage/)).
- You've written unit tests with real assertions ([Unit Testing](../02-unit-testing/)).
- You've at least read the junior–senior tiers of this topic.

---

## Fundamentals

**Q1. What is mutation testing, in one breath?**
*Tests whether you can state the core idea crisply.*
**A.** It tests your tests. The tool injects a small deliberate fault into the code — a *mutant*, like changing `<` to `<=` — reruns the test suite, and checks whether a test fails. If a test fails, the mutant is *killed* (good — your tests caught the bug). If all tests pass, the mutant *survived* (bad — your tests run that code but don't actually verify it). It's the honest answer to "would my tests catch a bug here?"

**Q2. How is it different from code coverage?**
*The central question. Everything hinges on this.*
**A.** Coverage measures whether a line *executed* during the tests. Mutation testing measures whether a test would *fail* if that line were wrong. You can have 100% coverage with a test that asserts nothing meaningful — every line runs, but break any of them and no test notices. Coverage is necessary but not sufficient; mutation is the sufficiency check. Put bluntly: **coverage = executed, mutation = tested.**

**Q3. Give a concrete example where 100% coverage hides an untested behavior.**
*Can you produce the canonical worked example?*
**A.**
```python
def apply_discount(price, is_member):
    return price * 0.9 if is_member else price

def test_discount():
    assert apply_discount(100, True) is not None   # weak!
```
This is 100% coverage. But mutate `0.9` → `1.0`, or `*` → `/`, and the test still passes — `is not None` can't tell the difference. Mutation testing flags all those survivors. Fix: `assert apply_discount(100, True) == 90`. Same coverage, but now the behavior is actually tested.

**Q4. Why is a *killed* mutant the good outcome, even though it means a test failed?**
*Checks you understand the inverted semantics.*
**A.** The whole point is to break the code on purpose and confirm a test *notices*. A test failing on deliberately-broken code means the test works. "Killed" = caught = good. "Survived" = all tests passed on broken code = a hole.

---

## Technique

**Q5. Name the standard mutation operators and what each probes.**
*Depth check — do you know the mechanics?*
**A.**
- Conditional boundary (`<` → `<=`) — probes off-by-one / edge testing.
- Negate conditional (`==` → `!=`) — probes whether both branches are distinctly tested.
- Math/arithmetic (`+` → `-`, `*` → `/`) — probes whether the computed *value* is asserted.
- Return-value (`return x` → `return null`/`0`) — probes whether the caller checks the result.
- Void method-call removal (delete `log.write(e)`) — probes whether side effects are verified.
- Constant replacement (`0.9` → `1.0`) — probes whether magic values are pinned.
- Boolean (`true` → `false`) — probes whether a flag/predicate is checked.
Each survivor maps one-to-one to a missing assertion.

**Q6. A boundary mutant (`x > 10` → `x >= 10`) survives. What does that mean and how do you kill it?**
*The single most common survivor — do you know the killing input?*
**A.** It means no test uses the exact boundary value. For every input you tried, `>` and `>=` agreed. You kill it with a test at exactly `x = 10`: the original and mutant disagree there (one includes 10, one doesn't). This is mutation testing forcing you to test edges, not just the middle.

**Q7. Which tools would you reach for, by ecosystem?**
*Practical familiarity.*
**A.** PIT/Pitest for the JVM (the gold standard — fast bytecode mutation, great reports). Stryker for JS/TS, C#, Scala. mutmut or cosmic-ray for Python. gremlins or go-mutesting for Go. cargo-mutants for Rust.

**Q8. Walk me through reading a survived mutant in a report.**
*Can you triage?*
**A.** For each survivor I classify it: (1) *weak assertion* — covered but nothing distinguishes the bug → add the value/boundary/side-effect assertion; (2) *no coverage* — the line never runs in any test → add a test that reaches it; (3) *equivalent mutant* — behavior truly unchanged, unkillable → suppress with a reason comment; (4) *not worth it* — trivial/defensive code → consciously accept and document. The skill is that 3 and 4 are explicit, reviewed decisions, not silent.

---

## Score & Cost

**Q9. What's the mutation score, and what's a "good" one? Why isn't 100% the goal?**
*Checks you won't naively chase a number.*
**A.** Score = `killed / (total − equivalent mutants)`. 60–80% is strong on a real module; the right number is module-dependent. 100% isn't the goal because (a) equivalent mutants can never be killed, so there's a noise floor, and (b) chasing the last few percent costs huge effort for tests that may encode no real spec. It's a diagnostic, not a target.

**Q10. What is the equivalent-mutant problem?**
*The classic theory question.*
**A.** Some mutants change the source but not the behavior — there's no input that distinguishes them from the original, so no test can ever kill them. They show as "survived" forever and depress the score for no real reason. Worse, detecting them automatically is *undecidable* in general (it reduces to the halting problem). Tools catch some heuristically; the rest you triage by hand and suppress with a justification. This is why the score is approximate and 100% isn't meaningful.

**Q11. Mutation testing is expensive. Why, and how do you make it usable?**
*The most important practical question.*
**A.** Cost ≈ `(number of mutants) × (test-suite runtime per mutant)` — naively thousands of mutants times a multi-minute suite is hours to days. Mitigations: (1) **test selection** — run only the tests that cover the mutated line (PIT does this by default; biggest win); (2) **incremental/diff-based** — mutate only changed lines in CI (Stryker `--since`, PIT history); (3) **parallelization** — mutants are independent, shard them; (4) **sampling/operator-pruning** — a random subset or fewer operators for huge legacy. In practice: test selection always on, diff-scope per PR, full-repo parallel nightly.

**Q12. Why is coverage a ceiling on mutation score?**
*Tests the structural relationship.*
**A.** A mutant on a line that no test executes can never be killed — no test reaches it. So mutation score can't exceed coverage. Practically: get the important paths *covered* first (you can't kill what isn't run), then use mutation to check the assertions are strong. Coverage is the floor; mutation is the sufficiency check on top.

---

## Scenarios

**Q13. Your team wants to gate PRs on mutation score across the whole repo. Good idea?**
*Goodhart awareness — senior signal.*
**A.** Not as a global target. A hard global mutation-score gate invites gaming — mass suppression, tautological tests, narrowing the mutated surface. That's textbook Goodhart. Better: gate the **diff** (new/changed lines must be, say, 85% killed), tier the surface so only load-bearing modules are mutated, make suppressions reviewed and budgeted, set the threshold from an observed baseline, and pair it with code review. The score routes attention; humans judge whether an assertion is real. Never make it a cross-team OKR or a performance metric.

**Q14. You're about to refactor a critical module. How does mutation testing help, and when do you run it?**
*High-value senior use.*
**A.** Before touching the code, I mutation-test the *existing* suite on the unchanged module. That tells me the real strength of my safety net — a green run only proves tests pass, not that they'd catch a regression. If the score is low, the suite isn't a safe net, so I strengthen it (kill survivors) *first*, on the original behavior. Then I refactor, with a suite proven to pin behavior. After, I re-run and expect the score to hold with only known equivalents surviving.

**Q15. Where would you NOT run mutation testing?**
*Cost judgment.*
**A.** On DTOs, getters/setters, trivial glue, generated code, simple delegation — high mutant count, near-zero value. And not the whole repo indiscriminately — cost explodes and the real survivors drown. It's a scalpel for load-bearing correctness (pricing, billing, auth, validation, complex algorithms), not a floodlight.

**Q16. How does mutation testing relate to property-based testing?**
*Connects two advanced techniques.*
**A.** PBT widens the input space against an invariant; mutation testing checks whether those invariants are *strong enough* to catch faults. If a mutant survives your property suite, the property is too weak — it asserts something true but unhelpful. So you can run mutation testing over your PBT suite to find weak invariants. They compound: PBT generates the edges, mutation grades whether your assertions catch them.

---

## Rapid-Fire

**Q.** Killed or survived — which is good? **A.** Killed.
**Q.** Coverage measures? **A.** Execution.
**Q.** Mutation measures? **A.** Whether a test would fail if the code were wrong.
**Q.** Score formula? **A.** `killed / (total − equivalent)`.
**Q.** Gold-standard JVM tool? **A.** PIT/Pitest.
**Q.** JS/TS tool? **A.** Stryker.
**Q.** Rust tool? **A.** cargo-mutants.
**Q.** Biggest cost lever? **A.** Test selection (run only covering tests).
**Q.** Cheapest CI form? **A.** Diff-scoped mutation on changed lines.
**Q.** Why not 100%? **A.** Equivalent mutants + diminishing value.
**Q.** Equivalent-mutant detection is? **A.** Undecidable in general.
**Q.** Boundary mutant killed by? **A.** A test at the exact edge value.
**Q.** Coverage relationship to score? **A.** Coverage is a ceiling on it.
**Q.** Gate on diff or repo? **A.** Diff.
**Q.** Main risk of a score gate? **A.** Goodhart (gaming the number).
**Q.** A survivor means? **A.** A specific missing or weak assertion.

---

## Red Flags / Green Flags

**Red flags (in a candidate's answers):**
- "It's just better code coverage." (Misses the executed-vs-tested distinction entirely.)
- Thinks "killed" is the bad outcome.
- Wants to gate the whole repo on a global mutation score with no Goodhart awareness.
- Never mentions cost, equivalent mutants, or where it's *not* worth running.
- Believes 100% mutation score is achievable and desirable.
- Can't produce the "100% coverage, survived boundary mutant" example.

**Green flags:**
- Leads with "coverage = executed, mutation = tested."
- Names operators and maps each survivor to a specific assertion.
- Brings up cost unprompted and lists test selection + diff-scoping.
- Knows equivalent mutants are undecidable and treats the score as a diagnostic.
- Suggests diff-gating + reviewed suppressions, cites Goodhart.
- Mentions the validate-the-suite-before-a-refactor use case.

---

## Cheat Sheet

```text
ONE-LINER:  coverage = line EXECUTED.  mutation = line TESTED.

MUTANT outcome:  test fails → KILLED (good) · all pass → SURVIVED (hole)
SCORE = killed / (total − equivalent).  100% not the goal (equivalents).

OPERATORS → fix:
  < → <=  boundary  ⇒ edge test    + → -  math ⇒ assert VALUE
  == → != negate    ⇒ both branches  return x → null ⇒ assert result
  foo() removed     ⇒ assert side effect   true → false ⇒ assert flag

COST = mutants × suite-time. Levers:
  test selection (run covering tests) · diff-scope · parallelize · sample
COVERAGE caps SCORE (unrun line ⇒ unkillable mutant).

GATING: gate the DIFF, not repo · suppress with reasons · baseline threshold
        score routes attention, humans judge · never a global OKR (Goodhart)

USES: audit weak suites · validate suite BEFORE a refactor · harden Tier-A code
TOOLS: PIT(JVM) Stryker(JS/TS/C#) mutmut/cosmic-ray(Py) gremlins(Go) cargo-mutants(Rust)
```

---

## Summary

Every strong mutation-testing answer routes through one sentence: **coverage proves a line executed; mutation testing proves a line is actually tested.** From there, demonstrate mechanics (operators map one-to-one to missing assertions; the boundary mutant is killed only by an exact-edge test), the honest score (`killed / (total − equivalent)`, never 100% because of undecidable equivalent mutants), and — most important for seniority — the practical realities: cost is `mutants × suite-time`, mitigated by test selection, diff-scoping, and parallelization; gate the *diff* not the repo to avoid Goodhart; and aim the tool at load-bearing code, especially to validate a suite before a refactor or audit a legacy suite. Candidates who think "killed" is bad, want a global score OKR, or never mention cost are the red flags.

---

## Further Reading

- [Code Coverage](../../code-coverage/) — the executed-vs-tested contrast, in depth.
- [Unit Testing — Interview](../02-unit-testing/interview.md) — assertion quality that kills mutants.
- [Property-Based Testing — Interview](../06-property-based-testing/interview.md) — the complementary technique.
- [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) — Goodhart's law for the score-as-gate question.
- The **`unit-testing-patterns`** skill — the assertion patterns behind every kill.

---

## Related Topics

- [Unit Testing](../02-unit-testing/) — the suite under test.
- [Property-Based Testing](../06-property-based-testing/) — invariants, graded by mutation.
- [Code Coverage](../../code-coverage/) — the metric mutation testing corrects.
- [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) — why the score must stay a diagnostic.
