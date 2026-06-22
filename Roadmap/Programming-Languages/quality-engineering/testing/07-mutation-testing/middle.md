# Mutation Testing — Middle Level

> **Roadmap:** [Testing](../README.md) → Mutation Testing
>
> *Learn the operators, read a real PIT report, and understand why mutation score is a different — and harder — number than coverage.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Mutation Operators in Full](#core-concept-1--the-mutation-operators-in-full)
5. [Core Concept 2 — Mutation Score vs Coverage](#core-concept-2--mutation-score-vs-coverage)
6. [Core Concept 3 — Reading a Real PIT Report](#core-concept-3--reading-a-real-pit-report)
7. [Core Concept 4 — Coverage Is a Ceiling on Mutation Score](#core-concept-4--coverage-is-a-ceiling-on-mutation-score)
8. [Core Concept 5 — From Survivor to Assertion](#core-concept-5--from-survivor-to-assertion)
9. [Core Concept 6 — Tools by Ecosystem](#core-concept-6--tools-by-ecosystem)
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

> Focus: **the standard mutation operators, the mutation score, how to read a tool's report, and turning survivors into assertions.**

At the junior tier you saw the core trade: coverage proves execution, mutation proves testing. Now you'll work with the machinery. You'll learn the full set of standard **mutation operators** and what each probes, compute and interpret the **mutation score**, read an actual **PIT** (Java) and **Stryker** (JS/TS) report line by line, and understand the structural fact that **coverage is a hard ceiling on your mutation score**.

The goal at this tier is fluency: given a mutation report with a column of survivors, you can look at each one and immediately know what assertion is missing.

---

## Prerequisites

- Comfortable writing unit tests with strong assertions (see [Unit Testing — Middle](../02-unit-testing/middle.md)).
- You've read a coverage report and understand line vs branch coverage ([Code Coverage](../../code-coverage/)).
- You've done the junior tier: killed vs survived, what a mutant is.
- Basic familiarity with one of: Maven/Gradle (Java), npm (JS/TS), pytest (Python).

---

## Glossary

| Term | Meaning |
|---|---|
| **Mutation operator** | A transformation rule that generates a mutant from source code. |
| **Mutation score** | killed ÷ (total mutants − equivalent mutants). The headline metric. |
| **Test strength** | Stryker's name for mutation score over *covered* code only. |
| **No coverage** | A mutant on a line no test even executes — counts as "not killed." |
| **Timed out** | A mutant that caused an infinite loop; counted as killed (the test "noticed"). |
| **Equivalent mutant** | A mutant whose behavior is identical to the original — impossible to kill (see senior tier). |
| **PIT / Pitest** | The leading JVM mutation-testing tool. |
| **Stryker** | The leading mutation tool for JS/TS, C#, and Scala. |

---

## Core Concept 1 — The Mutation Operators in Full

Mutation operators are deliberately small, because real bugs are small. Each one models a category of human error. Here are the standard families with what each *probes*:

| Operator | Example | What a survivor reveals |
|---|---|---|
| **Conditional boundary** | `a < b` → `a <= b` | You never tested the *edge* of the range (off-by-one). |
| **Negate conditional** | `a == b` → `a != b` | You never exercised *both* branches with distinguishing inputs. |
| **Math / arithmetic** | `a + b` → `a - b`, `*` → `/` | You never checked the *computed value*, only that it returned. |
| **Increment** | `i++` → `i--` | Loop/counter behavior is unverified. |
| **Return value** | `return x` → `return null`/`0`/`""` | The caller never asserts on what comes back. |
| **Void method call removal** | `log.write(e)` → *(deleted)* | A side effect (logging, persisting, notifying) is unverified. |
| **Constant / literal** | `0.9` → `1.0`, `100` → `101` | A magic value isn't pinned by any assertion. |
| **Boolean** | `return true` → `return false` | A flag/predicate result isn't checked. |
| **Negation** | `-x` → `x` | Sign handling is untested. |

PIT groups these into mutator sets: `DEFAULTS` (a safe, low-noise set) and `STRONGER` / `ALL` (more operators, more mutants, more noise). Stryker has a similar configurable mutator list. Starting with defaults keeps the report readable.

A useful habit: when you see a survivor, name its operator. "Surviving boundary mutant" immediately tells you to add an edge-case test; "surviving void-call removal" tells you to assert a side effect.

---

## Core Concept 2 — Mutation Score vs Coverage

The **mutation score** is:

```text
                 mutants killed
score = ───────────────────────────────────
        total mutants − equivalent mutants
```

It looks like a coverage number, but it answers a fundamentally different question.

| | Coverage | Mutation score |
|---|---|---|
| **Measures** | Did the line *execute*? | Would a test *fail* if the line were wrong? |
| **Can be gamed by** | Calling code with no assertions | Almost nothing — you must assert real behavior |
| **A high value means** | Code ran during tests | Code is genuinely protected |
| **Typical "good" value** | 80–90%+ | 60–80% is strong; depends on module |
| **100% is...** | Often achievable | Neither achievable nor the goal (equivalent mutants) |

**Why isn't 100% the goal?** Two reasons. First, **equivalent mutants** can never be killed — they don't change behavior, so no test can distinguish them (senior tier covers this). Second, chasing the last few percent costs enormous effort for tests that may not add real value. A score of 70–80% on a critical module, with the *remaining* survivors reviewed and consciously accepted, beats a meaningless 100% line-coverage badge.

Treat the score as a **diagnostic on important code**, not a number to maximize everywhere. (The Goodhart trap of turning it into a target is covered at the professional tier and in [Engineering Metrics & DORA](../../engineering-metrics-and-dora/).)

---

## Core Concept 3 — Reading a Real PIT Report

Here's an annotated PIT run on a Java method. The code:

```java
public class Pricing {
    public int finalPrice(int base, int qty) {
        int total = base * qty;
        if (qty > 10) {              // bulk discount
            total = total - (total / 10);
        }
        return total;
    }
}
```

The only test:

```java
@Test void computesTotal() {
    assertEquals(50, new Pricing().finalPrice(10, 5)); // qty=5, no discount
}
```

PIT console output:

```text
>> Generated 7 mutations Killed 3 (43%)
>> Ran 7 tests (1.0 tests per mutation)

- Pricing.java
  line 3  Replaced integer multiplication with division   KILLED
  line 3  Replaced integer multiplication with subtraction KILLED
  line 4  changed conditional boundary  (qty > 10 → qty >= 10)  SURVIVED
  line 4  negated conditional           (qty > 10 → qty <= 10)  SURVIVED
  line 5  Replaced integer subtraction with addition            SURVIVED
  line 5  Replaced integer division with multiplication          SURVIVED
  line 7  replaced int return with 0                            KILLED

Mutation score: 43% (3/7)
```

Read it like a checklist of holes:

- **Lines 4 and 5 survive entirely.** The test only uses `qty=5`, so the *discount branch never runs*. Every mutant inside it survives — there's no input that reaches that code. This is the classic "no coverage" signature.
- **Line 3 killed.** The `assertEquals(50, ...)` pins the multiplication, so swapping `*` for `/` or `-` is caught.
- **Line 7 killed.** Returning `0` instead of `total` breaks the assertion.

The report has handed you a precise task: add a test with `qty > 10` and assert the discounted value.

PIT also writes an HTML report (`target/pit-reports/index.html`) that colors source lines green (mutants killed) or red/pink (survived), so you can see the holes against the code.

---

## Core Concept 4 — Coverage Is a Ceiling on Mutation Score

This is the structural relationship to internalize:

> A mutant on a line that **no test executes** can never be killed. So your mutation score can never exceed your coverage.

```text
   uncovered line  →  mutant runs, but no test touches it  →  SURVIVES (always)
   covered line    →  mutant runs; test MAY or MAY NOT notice it
```

In the PIT example, the discount branch had **zero coverage**, so all four of its mutants survived automatically. Coverage capped the score before assertions even entered the picture.

The implication for workflow:

1. **Coverage first, to a point.** You can't kill mutants on code no test reaches. Get the important paths covered.
2. **Then mutation, to harden.** Once covered, mutation tells you whether the *assertions* are strong enough.

Coverage is necessary but not sufficient; mutation score is the sufficiency check on top of it. This is exactly why the [Code Coverage](../../code-coverage/) section and this one are two halves of the same story.

---

## Core Concept 5 — From Survivor to Assertion

Every survivor maps to a concrete fix. The skill is reading the operator and writing the test that distinguishes mutant from original.

Fixing the PIT example — add a discount test:

```java
@Test void appliesBulkDiscountAboveTen() {
    // qty=11 enters the discount branch; total = 110, minus 11 = 99
    assertEquals(99, new Pricing().finalPrice(10, 11));
}

@Test void noDiscountAtExactlyTen() {  // boundary!
    assertEquals(100, new Pricing().finalPrice(10, 10));
}
```

Re-run:

```text
>> Generated 7 mutations Killed 7 (100%)
  line 4  qty > 10 → qty >= 10   KILLED  (qty=10 test now distinguishes them)
  line 4  qty > 10 → qty <= 10   KILLED
  line 5  subtraction → addition KILLED  (expected 99, got 121)
  line 5  division → multiplication KILLED
```

Note the **boundary test at exactly 10** is what kills the `>` → `>=` mutant. Without it, both operators agree for every input you tried. This is mutation testing's superpower: it forces you to test the *edges*, not just the middle.

To turn this into a habit, lean on the **`unit-testing-patterns`** skill for assertion patterns — assert the value, the boundary, and the side effect, not merely that something happened.

---

## Core Concept 6 — Tools by Ecosystem

| Ecosystem | Tool(s) | Notes |
|---|---|---|
| **Java / JVM** | **PIT (Pitest)** | The gold standard. Fast (bytecode mutation), great HTML reports, Maven/Gradle plugins, incremental analysis. |
| **JS / TS / C# / Scala** | **Stryker** | Mature, configurable, "test strength" reporting, IDE and CI integrations. |
| **Python** | **mutmut**, **cosmic-ray** | mutmut is simple and fast to start; cosmic-ray is more configurable/distributed. |
| **Go** | **go-mutesting**, **gremlins** | gremlins is the more actively maintained, with incremental mode. |
| **Rust** | **cargo-mutants** | Integrates with `cargo`; good diff/incremental support. |

A minimal Stryker (JS/TS) report looks like:

```text
#  Mutant status        count
✓  Killed                 142
✗  Survived                18
⏰ Timeout                  4
🚫 No coverage              9

Mutation score: 79.21%   (killed+timeout / total)
Test strength:  88.75%   (killed+timeout / covered mutants only)
```

Two numbers worth distinguishing: **mutation score** (over *all* mutants) and **test strength** (over only *covered* mutants). A big gap between them means you have a coverage problem (the "no coverage" bucket); a low test strength means you have an *assertion* problem.

---

## Real-World Examples

**The branch with no inputs.** A `refund()` path only triggers for orders over $1000. The team's tests never use such an order. PIT shows every mutant in that branch surviving as "no coverage" — a whole feature path silently untested behind 100% *overall* coverage of the cheaper paths.

**The validator that always says yes.** `isValid()` has `return true` mutated to `return false` and it **survives** — meaning no test ever expects `isValid()` to return `true` for a valid input *and* compares against an invalid one. The boolean mutant exposes a validator nobody actually validated.

**Stryker on a date utility.** A `daysBetween(a, b)` function had 100% coverage. Stryker's arithmetic mutants (`b - a` → `a - b`, `+ 1` → `- 1`) survived because tests only checked `daysBetween(d, d) == 0`. Adding asymmetric-date assertions killed them.

---

## Mental Models

- **The score is a smoke detector, not a thermostat.** It tells you something's wrong; it's not a dial you crank to 100.
- **Operator → missing assertion, one-to-one.** Boundary survivor → edge test. Void-call survivor → side-effect assertion. Math survivor → value assertion.
- **Coverage is the floor; mutation is the building inspector.** You need the floor first, but passing inspection is a separate, harder bar.
- **"No coverage" survivors and "covered but survived" mutants are different bugs.** The first is a missing test; the second is a weak assertion.

---

## Common Mistakes

- **Comparing mutation score to coverage as if they're the same scale.** A 70% mutation score is often *stronger* than 95% coverage.
- **Running `ALL` mutators on day one.** The flood of low-value mutants buries the important survivors. Start with defaults.
- **Ignoring the "no coverage" bucket.** Those aren't assertion problems — they're missing tests. Fix coverage first there.
- **Killing a mutant by weakening it (e.g., `--exclude`) instead of adding a test.** That hides the hole instead of closing it.
- **Forgetting the boundary test.** `>` vs `>=` survivors are the most common; only an exact-edge input kills them.

---

## Test Yourself

1. Write the formula for mutation score. Why is the denominator *minus equivalent mutants*?
2. A Stryker report shows 79% mutation score but 89% test strength. What does the gap tell you, and what do you fix?
3. In the PIT example, why did *all* mutants in the discount branch survive before the fix?
4. Which operator's survivor is killed *only* by a boundary-value test? Give the killing input for `qty > 10`.
5. Name the right tool for: a Go service, a TypeScript frontend, a Spring Boot app, a Rust crate.

<details>
<summary>Answers</summary>

1. `killed / (total − equivalent)`. Equivalent mutants can never be killed (identical behavior), so leaving them in the denominator artificially caps the score below 100% for reasons that aren't your tests' fault.
2. The 10-point gap = mutants on *uncovered* code (the "no coverage" bucket). Test strength is measured only over covered mutants. Fix it by adding tests that *reach* the uncovered lines, not by strengthening existing assertions.
3. No test used `qty > 10`, so the branch never executed — zero coverage means mutants there can never be killed.
4. The conditional-boundary operator (`>` → `>=`). Input `qty = 10` kills it: original = no discount, mutant = discount.
5. Go → gremlins (or go-mutesting); TS → Stryker; Spring Boot/JVM → PIT; Rust → cargo-mutants.

</details>

---

## Cheat Sheet

```text
SCORE = killed / (total − equivalent)
COVERAGE caps SCORE: uncovered line ⇒ mutant always survives.

Operators → fix:
  < → <=        boundary    ⇒ add EDGE test
  == → !=       negate      ⇒ test both branches distinctly
  + → -, * → /  math        ⇒ assert the VALUE
  return x → null/0         ⇒ caller must assert result
  foo() removed  void call  ⇒ assert the SIDE EFFECT
  true → false  boolean     ⇒ assert the flag

Buckets:
  KILLED      ✓ good
  SURVIVED    ✗ weak assertion
  NO COVERAGE 🚫 missing test (fix coverage, not assertions)
  TIMEOUT     ⏰ counted as killed (infinite loop = noticed)

Tools: PIT (JVM) · Stryker (JS/TS/C#/Scala) · mutmut/cosmic-ray (Py)
       gremlins/go-mutesting (Go) · cargo-mutants (Rust)

Mutation score ≠ coverage. Don't compare on the same scale.
```

---

## Summary

Mutation operators are small, bug-shaped transformations — boundary, negate, math, return-value, void-call removal, constant, boolean — and each survivor maps directly to a missing or weak assertion. The **mutation score** (`killed / (total − equivalent)`) answers a stricter question than coverage: not "did it run?" but "would a test fail if it were wrong?" Coverage is a hard ceiling on the score, because mutants on unexecuted lines always survive. Reading a PIT or Stryker report is a triage exercise: separate "no coverage" survivors (missing tests) from "covered but survived" ones (weak assertions), then write the value, boundary, and side-effect assertions that kill them. The right tool depends on your stack — PIT for the JVM, Stryker for JS/TS, and so on.

---

## Further Reading

- [Unit Testing — Middle](../02-unit-testing/middle.md) — assertion patterns that kill mutants.
- [Code Coverage — Mutation Coverage](../../code-coverage/) — the relationship between the two metrics in depth.
- [Property-Based Testing](../06-property-based-testing/) — generates the edge inputs mutation testing demands.
- PIT docs (pitest.org) and Stryker docs (stryker-mutator.io) — operator catalogs and report formats.
- The **`unit-testing-patterns`** skill — turning survivors into strong, specific assertions.

---

## Related Topics

- [Unit Testing](../02-unit-testing/) — the suite mutation testing grades.
- [Property-Based Testing](../06-property-based-testing/) — complementary way to find untested behavior.
- [Code Coverage](../../code-coverage/) — the floor beneath your mutation score.
- [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) — why the score must not become a blind target.
