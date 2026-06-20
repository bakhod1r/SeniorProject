# Mutation Coverage — Middle Level

> **Roadmap:** [Code Coverage](../README.md) → Mutation Coverage
> *Line coverage asks "did a test execute this line?" Mutation coverage asks the only question that matters: "if this line were wrong, would a test notice?" This page is the machinery — the operators that break your code on purpose, the run loop that grades your suite, and why one category of mutant can never be killed no matter how good your tests are.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Mutation Operators — How Code Gets Broken on Purpose](#mutation-operators--how-code-gets-broken-on-purpose)
4. [The Run Loop — Generate, Run, Grade](#the-run-loop--generate-run-grade)
5. [Mutant Statuses — Killed, Survived, and the Rest](#mutant-statuses--killed-survived-and-the-rest)
6. [Mutation Score and Why It Beats Line Coverage](#mutation-score-and-why-it-beats-line-coverage)
7. [The Equivalent Mutant Problem](#the-equivalent-mutant-problem)
8. [The Cost Problem and How Teams Tame It](#the-cost-problem-and-how-teams-tame-it)
9. [Running It — Tools per Language](#running-it--tools-per-language)
10. [Worked Example — Kill a Survived Mutant](#worked-example--kill-a-survived-mutant)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How does mutation testing actually work, and how do I run it?**

The junior page sold you the idea: deliberately corrupt your code, see if the tests catch it. That's the *what*. This page is the *how* — concrete enough that you can run a tool today, read its report, and act on a single survived mutant.

The mechanism has three moving parts. **Operators** are the rules that produce broken versions of your code (`<` becomes `<=`, `+` becomes `-`, `return x` becomes `return null`). The **run loop** applies one operator at a time to make a *mutant*, runs your whole test suite against it, and records whether the suite noticed. The **score** is the fraction of mutants your suite caught — and unlike line coverage, that number actually correlates with whether your tests would catch a real regression.

The catch is two costs, one conceptual and one computational. The conceptual cost is the **equivalent mutant**: a mutation that changes the code's text but not its behaviour, so no test can possibly distinguish it — undecidable in general and the main source of noise in any report. The computational cost is brutal: every mutant means another full (or partial) test run, so naïve mutation testing is *N times slower* than your suite. This page covers both, plus the four mainstream tools — `pitest`, Stryker, `mutmut`/`cosmic-ray`, `go-mutesting` — that make it all push-button.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can explain "killed vs survived" in one sentence.
- **Required:** You understand line and branch coverage ([01 — Line, Branch & Path Coverage](../01-line-branch-path-coverage/middle.md)) — mutation testing builds directly on coverage data.
- **Required:** You have a real test suite that passes green. Mutation testing grades the suite; it needs one to grade.
- **Helpful:** You've used a coverage tool in CI ([04 — Coverage in CI & Diffs](../04-coverage-in-ci-and-diffs/middle.md)), since the practical wins come from running mutation analysis on diffs.

---

## Mutation Operators — How Code Gets Broken on Purpose

A **mutation operator** is a transformation rule: a small, well-defined edit that mimics a *plausible bug a human would write*. The tool walks your AST (or bytecode), and everywhere an operator matches, it emits one mutant with that single edit applied. The operator catalogue *is* the test of your test suite — a mutant only exists if some operator knew how to create it.

The standard operator sets across `pitest`, Stryker, and the others overlap heavily. Here are the ones that earn their keep:

**Conditionals Boundary** — flip a relational operator at the boundary. This is the single highest-value operator, because off-by-one is the most common real bug.

```java
if (x > limit)   →   if (x >= limit)     // > becomes >=
while (i < n)    →   while (i <= n)       // < becomes <=
```

**Negate Conditionals** — invert the whole condition.

```java
if (a == b)      →   if (a != b)
if (user.isAdmin())  →  if (!user.isAdmin())
```

**Math (Arithmetic Operator Replacement)** — swap a binary arithmetic operator.

```java
int total = a + b   →   int total = a - b     // + becomes -
double r = x * y    →   double r = x / y       // * becomes /
```

**Increments** — flip `++`/`--`, or change `+=` to `-=`.

```java
count++          →   count--
sum += value     →   sum -= value
```

**Return Values** — replace a return value with a degenerate one of the same type. The exact substitution depends on type:

```java
return true      →   return false
return x         →   return 0          // for an int-returning method
return obj       →   return null       // for an object-returning method
return list      →   return Collections.emptyList()
```

**Void Method Calls** — *remove* a call to a `void` method entirely. This is sneaky and powerful: it catches tests that never verify a side effect happened.

```java
logger.info("saved");   →   /* call removed */
cache.invalidate(key);  →   /* call removed */     // does any test check the cache was cleared?
```

**Remove Conditionals (Conditionals Negation / "make condition always true")** — force a branch to always (or never) execute.

```java
if (shouldRetry)  →   if (true)      // the guard is now dead — does a test cover the "false" path?
```

In Stryker the same families appear under JS-flavoured names — `ArithmeticOperator`, `EqualityOperator`, `ConditionalExpression`, `BooleanLiteral`, `StringLiteral` (mutate `"foo"` to `""`), `OptionalChaining`, `ArrayDeclaration` (`[1,2]` to `[]`). The categories are universal; only the syntax differs.

> **Key insight:** Each operator targets a *class of bug a programmer actually makes*. A surviving "conditionals boundary" mutant doesn't mean "your code is wrong" — it means *"if you ever made an off-by-one error right here, nothing would catch you."* The operator set is a map of the mistakes your suite is blind to. That's why the choice of operators is the choice of which bugs you care about.

---

## The Run Loop — Generate, Run, Grade

Mutation testing is a nested loop. The outer loop walks mutants; the inner loop is your entire test suite.

```
1. Run the test suite once, unmutated.        → must be GREEN. If red, abort: garbage in, garbage out.
2. Collect per-test coverage.                 → which tests touch which lines (so we can skip irrelevant tests later).
3. For each mutant M (one operator, one location):
      a. Apply M to the code/bytecode.
      b. Run the tests that cover M's line.
      c. If ANY test now FAILS  → M is KILLED   (good: the suite noticed the bug).
         If ALL tests still PASS → M is SURVIVED (bad: the bug slipped through).
      d. Revert M.
4. score = killed / (total mutants − non-viable)
```

Two details make this efficient rather than absurd. First, **coverage-directed test selection**: if a mutant lives on line 40 and only `testFoo` and `testBar` execute line 40, there is no point running the other 900 tests — they can't possibly observe this mutant. Step 2 builds that map. Second, **fail-fast**: the inner loop stops the instant one test fails, because one failure already means *killed*; there's no need to run the rest.

Tools differ in *where* they mutate. `pitest` mutates **JVM bytecode** at runtime — no recompilation per mutant, which is the main reason it's fast enough to be usable. Stryker and `mutmut` mutate **source code** (AST or text) and re-run, which is simpler but slower. The grading logic is identical regardless.

> **Key insight:** "Killed" is defined by the suite *failing*, not by it "detecting" anything intelligent. A mutant is killed iff at least one assertion (or an uncaught exception, or a timeout) turns the suite red. This is why a test with **no assertions** kills almost nothing — it runs the mutated code and shrugs. Mutation score is, precisely, a measure of whether your assertions are load-bearing.

---

## Mutant Statuses — Killed, Survived, and the Rest

A real report has more than two outcomes. Knowing each status is how you read the noise correctly.

| Status | Meaning | What it tells you |
|---|---|---|
| **Killed** | A test failed when the mutant ran. | Good. The suite catches this bug class here. |
| **Survived** | All tests passed despite the mutation. | A real gap — write a test, or the code is untested behaviour. |
| **No Coverage** | No test even executes the mutated line. | A *line-coverage* hole, surfaced for free. Lower-priority than survived (it's a weaker signal — you already knew that line was untested). |
| **Timeout** | The mutant caused the suite to hang. | Counts as **killed** — a mutation that turns a loop infinite (e.g. `i++` → `i--`) is "caught" because the test would never have passed. The runner uses a time budget to detect it. |
| **No Coverage** vs **Survived** | both mean "not killed" | but *survived* is worse: a test ran the code and *still* didn't notice. That's a missing assertion, not just a missing test. |
| **Runtime Error / Non-Viable** | The mutant didn't compile or threw before any assertion (e.g. an infinite-loop guard the tool itself rejects). | Excluded from the score denominator. Not your suite's fault. |

The distinction between **Survived** and **No Coverage** is the one juniors miss. *No coverage* says "you have no test here at all" — fixable by adding any test that runs the line. *Survived* says "you have a test that runs this exact line and your mutation still got past it" — that's a missing or weak **assertion**, a deeper problem. Triage survived mutants first.

---

## Mutation Score and Why It Beats Line Coverage

The headline metric:

```
mutation score = mutants killed / (total mutants − equivalent/non-viable)
```

A score of 80% means your suite caught 80% of the deliberately-injected bugs it had a chance to catch. Compare the two metrics on the same code:

```java
int max(int a, int b) {
    return a > b ? a : b;
}

@Test void testMax() {
    max(3, 1);              // calls it... asserts nothing
}
```

**Line coverage: 100%.** The single line ran. Green, shippable, done — says the coverage gate.

**Mutation score: 0%.** Every mutant survives. Change `>` to `>=` — survives (the test asserts nothing). Change `>` to `<` — survives. Replace the return with `return 0` — survives. The mutation report screams what line coverage whispered nothing about: *this test verifies nothing.*

That gap is the entire argument. **Line/branch coverage measures whether code was executed; mutation score measures whether it was actually tested.** Coverage can be gamed by a test that runs everything and asserts nothing (and that exact gaming happens constantly under coverage mandates — see [06 — Coverage as Signal, Not Target](../06-coverage-as-signal-not-target/middle.md)). Mutation score cannot be gamed that way: an assertion-free test kills no mutants, so its mutation score is honest where its line coverage lies.

> **Key insight:** High line coverage with low mutation score is the signature of a suite that *exercises* code without *checking* it — the most dangerous kind of test suite, because it produces a green dashboard and false confidence. If you measure one quality number, mutation score is strictly more informative than coverage percentage.

---

## The Equivalent Mutant Problem

Here is the thorn in the technique. An **equivalent mutant** is a mutation that changes the source but produces a program with *identical observable behaviour for every possible input*. No test can kill it, because there is no input that distinguishes it from the original — and that's not a gap in your suite, it's a property of the mutation.

A clean example:

```java
int i = 0;
while (i < 10) {           // mutate < to !=  →  while (i != 10)
    System.out.println(i);
    i++;
}
```

The mutant `i != 10` behaves *exactly* like `i < 10`: `i` starts at 0 and increments by 1, so it reaches 10 hitting every value, and the loop exits at the same point. There is no input that makes the two differ. It will show up as **survived** forever, and writing a test to "kill" it is impossible — the two programs are the same program.

Another common shape — a mutation guarded by a dominating condition:

```python
if x > 0 and x > -5:    # mutate > -5 to >= -5
    do_something()
```

When `x > 0` is already true, `x > -5` is *always* true too, so changing it to `>= -5` never affects the result. Equivalent.

Why it's fundamental: **deciding whether two programs are behaviourally equivalent is undecidable in general** (it reduces to the halting problem). No tool can reliably flag equivalent mutants for you. So every mutation report contains some survived mutants that are *not* gaps — they're equivalent — and the only way to tell is human judgement. This is the main reason teams don't chase 100% mutation score: the last few percent are often equivalent mutants you literally cannot kill. Practically, you mark them as `ignored`/`equivalent` in config so they stop nagging, and you accept a "real" target well under 100%.

> **Key insight:** A survived mutant is a *question*, not a verdict. Most are genuine gaps you should close. Some are equivalent mutants that no test can ever kill. Distinguishing the two is irreducibly human — which is exactly why mutation testing surfaces results as *review hints* rather than as a hard pass/fail gate.

---

## The Cost Problem and How Teams Tame It

The arithmetic is unforgiving. If your suite has 5,000 mutants and takes 30 seconds per run, naïve mutation testing is 5,000 × 30s ≈ **42 hours**. Even with per-mutant test selection it's often hours. You cannot run full mutation analysis on every commit. The practical techniques all attack the `mutants × test-runs` product:

1. **Mutate only changed code (diff-based / incremental).** Don't analyse the whole repo — analyse the lines in the pull request's diff. This is the single biggest win and the one that makes mutation testing viable in CI. `pitest` ships this as `scmMutationCoverage` (mutate only files changed vs `git` HEAD); Stryker has `--since` / `--incremental`. You go from "the whole codebase" to "the 40 lines this PR touched."

2. **Coverage-based test selection.** Already in the run loop: only run tests that cover the mutated line. A mutant on line 200 doesn't trigger tests that never reach line 200. This is on by default in `pitest`.

3. **Incremental analysis (caching).** Cache the kill/survive result per mutant and reuse it for mutants whose code and covering tests are unchanged since last run. `pitest`'s `withHistory` and Stryker's incremental mode store this, so a re-run only re-evaluates what actually changed.

4. **Operator sampling / reduced operator sets.** Run a representative subset of operators rather than all of them, or sample a fraction of mutants. You trade completeness for speed; the score becomes an estimate but a fast one.

5. **Parallelism.** Mutants are embarrassingly parallel — each is independent. Run them across cores (`pitest` `threads=N`) or shard across CI machines.

The standard production pattern combines #1 and #3: **diff-based mutation testing with caching, run as a PR check.** Full-repo analysis becomes a slow nightly or weekly job, not a per-commit gate. ([04 — Coverage in CI & Diffs](../04-coverage-in-ci-and-diffs/middle.md) covers wiring diff-based checks into pipelines.)

> **Key insight:** Whole-repo mutation testing is a *batch* job; diff-based mutation testing is an *interactive* one. The technique only became mainstream once "mutate the diff" made the cost proportional to the change, not to the codebase. If a colleague says mutation testing is "too slow to use," they're picturing the whole-repo run — point them at `--since`.

---

## Running It — Tools per Language

The technique is the same everywhere; the tooling is per-ecosystem.

| Language | Tool | Mutates | Notes |
|---|---|---|---|
| **Java / JVM** | **pitest** (PIT) | bytecode | The reference implementation; fast because no recompile per mutant. Gradle/Maven plugins. |
| **JS / TS / C# / Scala** | **Stryker** | source AST | Per-language: StrykerJS, Stryker.NET, Stryker4s. Rich HTML report. |
| **Python** | **mutmut**, **cosmic-ray** | source | `mutmut` is the simple/fast default; `cosmic-ray` is more configurable and distributed. |
| **Go** | **go-mutesting**, **gremlins** | source | `gremlins` is the more actively maintained modern option. |

A `pitest` Maven config — note `targetClasses` (what to mutate) and `targetTests` (what to grade with):

```xml
<plugin>
  <groupId>org.pitest</groupId>
  <artifactId>pitest-maven</artifactId>
  <version>1.15.0</version>
  <configuration>
    <targetClasses><param>com.example.billing.*</param></targetClasses>
    <targetTests><param>com.example.billing.*Test</param></targetTests>
    <mutators><mutator>DEFAULTS</mutator></mutators>   <!-- or STRONGER for more operators -->
    <threads>4</threads>
    <mutationThreshold>75</mutationThreshold>           <!-- fail the build below 75% -->
  </configuration>
</plugin>
```

Run it and read the console output. A real `pitest` report line looks like this:

```
>> Generated 142 mutations Killed 118 (83%)
>> Ran 401 tests (2.82 tests per mutation)

com.example.billing.Invoice
  Invoice.java:27  KILLED    changed conditional boundary → SURVIVING tests: 0
  Invoice.java:31  SURVIVED  Replaced integer addition with subtraction
  Invoice.java:44  NO_COVERAGE  removed call to logAudit()
  Invoice.java:52  TIMED_OUT changed increment (counted as killed)

================================================================================
- Statistics
================================================================================
>> Line Coverage: 91% (203/223)
>> Mutation Score: 83% (118/142)
```

The story in that output is the whole point of this page: **line coverage 91%, mutation score 83%.** The two numbers disagree, and the gap is your real test debt. The `SURVIVED` line at `Invoice.java:31` is the one to fix next; the `NO_COVERAGE` at line 44 is a weaker signal you can address after.

Stryker produces the equivalent for JS/TS. A minimal `stryker.config.json`:

```json
{
  "packageManager": "npm",
  "testRunner": "jest",
  "mutate": ["src/**/*.ts", "!src/**/*.spec.ts"],
  "thresholds": { "high": 80, "low": 60, "break": 50 },
  "incremental": true
}
```

Its summary table mirrors `pitest`'s statuses (`Killed`, `Survived`, `NoCoverage`, `Timeout`) and reports a **mutation score** with a colour-coded HTML drill-down so you can click a survived mutant and see the exact source diff that lived.

---

## Worked Example — Kill a Survived Mutant

A small discount function. We have a test, and it's green.

```java
// Pricing.java
int discountedPrice(int price, boolean isMember) {
    if (isMember) {
        return price - 10;
    }
    return price;
}

// PricingTest.java
@Test void memberGetsDiscount() {
    assertEquals(90, discountedPrice(100, true));
}
```

Run `pitest`. The report:

```
Pricing.java:3  KILLED    negated conditional (isMember)
Pricing.java:4  SURVIVED  Replaced integer subtraction with addition
>> Mutation Score: 50% (1/2)
```

Read it. The `KILLED` mutant at line 3 negated `if (isMember)` — our test caught that, because with the condition flipped, a member would get no discount and `assertEquals(90, ...)` would fail. Good.

The `SURVIVED` mutant at line 4 is the lesson. It changed `price - 10` to `price + 10`. Our test still passed — wait, why? Because... it didn't. Let's look again: `discountedPrice(100, true)` with `+ 10` returns `110`, and we assert `90`, so this *should* fail. The fact that `pitest` reports it `SURVIVED` tells us something subtle is wrong — and in the real version of this bug, the surviving mutant is the *math operator*, surfacing that we never test the boundary of the discount itself. Let's make the gap unambiguous with a function where it genuinely survives:

```java
int discountedPrice(int price, boolean isMember) {
    int discount = isMember ? 10 : 0;
    return price - discount;        // mutant: price + discount
}

@Test void memberGetsDiscount() {
    int result = discountedPrice(100, true);
    assertTrue(result < 100);        // weak assertion: 90 < 100 ✓, but 110 < 100 ✗... 
}
```

With the assertion `assertTrue(result < 100)`, the `+` mutant returns `110`, and `110 < 100` is false, so it *is* killed. The genuinely surviving case is a **too-loose assertion**:

```java
@Test void memberGetsDiscount() {
    int result = discountedPrice(100, true);
    assertNotNull(result);     // ← this is the bug: asserts the wrong thing
}
```

Now the `+` mutant returns `110`, `assertNotNull(110)` passes, and the mutant **survives**. The report's `SURVIVED Replaced integer subtraction with addition` is pointing at a test that runs the code but checks nothing meaningful about the result. The fix is the missing *value* assertion:

```java
@Test void memberGetsDiscount() {
    assertEquals(90, discountedPrice(100, true));   // exact value — kills the + mutant
}
```

Re-run: `Mutation Score: 100% (2/2)`. The loop you just performed — *run → find the survived mutant → see it's a weak assertion → tighten the assertion → re-run* — is the entire day-to-day practice of mutation testing. You are not chasing a number; you are letting the tool point at the one test that lies.

---

## Mental Models

- **The operator set is a list of bugs you're auditing for.** Each operator ("flip `<` to `<=`", "drop the `void` call") is a specific mistake a human makes. A survived mutant means *"that exact mistake, right here, would go undetected."* You're not testing the code; you're testing the test suite's eyesight.

- **Killed = your suite turned red.** Nothing more clever than that. No assertions → almost nothing kills → low score. Mutation score is a direct measurement of whether your assertions are doing work.

- **A survived mutant is a question, not a failure.** Usually it's a real gap (write/strengthen a test). Sometimes it's an equivalent mutant no test can kill. The tool can't tell which; you can. That's why it's a review aid, not a gate.

- **Mutation testing is coverage with a conscience.** Line coverage asks "did it run?" Mutation asks "would a bug here be caught?" The second subsumes the spirit of the first: a mutant that survives on an *executed* line is a missing assertion; a mutant with *no coverage* is a missing test.

- **Cost scales with mutants × test-runs — so shrink both.** Mutate only the diff (fewer mutants), run only covering tests (fewer test-runs), cache unchanged results. That product, not the raw codebase size, is what you're paying for.

---

## Common Mistakes

1. **Running mutation testing on a suite with no assertions and expecting a high score.** It will be near zero — *correctly*. The low score is the finding, not a tool malfunction. Fix the assertions, not the tool.

2. **Treating every survived mutant as a bug to fix.** Some are equivalent mutants that *cannot* be killed. Burning an afternoon trying to write a test for one is the classic newcomer time-sink. Recognise the pattern, mark it `ignored`, move on.

3. **Confusing "No Coverage" with "Survived."** *No coverage* = no test runs the line (add any test). *Survived* = a test runs the line and still misses the mutation (add/strengthen an assertion). They demand different fixes; survived is the deeper problem.

4. **Running whole-repo mutation testing on every commit, then declaring it "too slow."** It *is* too slow that way. Run it on the diff (`--since` / `scmMutationCoverage`) as a PR check and full-repo as a nightly job. The cost should track the change size.

5. **Setting a 100% mutation-score gate.** Equivalent mutants make 100% generally unreachable, so the gate becomes a source of permanent CI failures and `ignore` spam. Pick a realistic threshold (commonly 70–85%) or, better, gate only on *new* survived mutants in the diff.

6. **Skipping the green-suite precondition.** If your suite is failing or flaky *before* mutation, every result is garbage — the tool can't tell a mutation-induced failure from a pre-existing one. Get to a stable green baseline first.

---

## Test Yourself

1. Name four mutation operators and give a one-line code example of each.
2. A mutant is reported as `SURVIVED`. A different one is `NO_COVERAGE`. Which do you fix first, and what *kind* of fix does each need?
3. Why does a test suite with 100% line coverage sometimes have a 0% mutation score? What does that gap reveal?
4. What is an equivalent mutant, why can't a tool flag them automatically, and what do you do with one in a report?
5. Naïve mutation testing is N× slower than your test suite. List three techniques that make it usable, and say which single one matters most in CI.
6. Why does a `TIMED_OUT` mutant count as *killed*?

<details>
<summary>Answers</summary>

1. Any four, e.g.: **Conditionals boundary** `x > y` → `x >= y`; **Negate conditionals** `a == b` → `a != b`; **Math** `a + b` → `a - b`; **Return values** `return true` → `return false` (or `return obj` → `return null`); **Void method call** `cache.clear();` → call removed; **Increments** `i++` → `i--`.
2. Fix the **SURVIVED** one first. It needs a stronger/new **assertion** (a test runs that line but doesn't notice the change). **NO_COVERAGE** needs *any* test that executes the line at all — a weaker, lower-priority signal you already had from line coverage.
3. Because line coverage only requires the code to *execute*; a test with no (or trivial) assertions runs every line yet verifies nothing, so every mutant survives. The gap reveals tests that exercise code without checking it — green coverage, zero real protection.
4. An equivalent mutant changes the source but produces *identical observable behaviour for all inputs*, so no test can distinguish it. Detecting equivalence is undecidable (reduces to the halting problem), so no tool can reliably flag them. In a report you inspect it, confirm it's equivalent, and mark it `ignored`/`equivalent` so it stops counting against your score.
5. Three of: **mutate only the diff** (incremental/`--since`), **coverage-based test selection** (run only tests covering the mutant), **caching/incremental analysis** (reuse unchanged results), **operator sampling**, **parallelism**. The one that matters most in CI is **diff-based / mutate-only-changed-code** — it makes cost proportional to the change, not the codebase.
6. Because a mutation that makes the suite hang (e.g. `i++` → `i--` turning a loop infinite) means the test would never have passed — the suite *did* detect that something is wrong. The runner uses a time budget to catch this and scores it as killed.

</details>

---

## Cheat Sheet

```
THE OPERATORS (standard pitest/Stryker set)
  conditionals boundary   >  → >=     <  → <=        ← highest value (off-by-one)
  negate conditionals     == → !=     if(c) → if(!c)
  math                    +  → -      *  → /
  increments              ++ → --     += → -=
  return values           true→false  return x→0/null/empty
  void method calls       foo();      → (call removed)
  remove conditionals     if(c)       → if(true)

THE RUN LOOP
  0. suite must be GREEN          (else: garbage in, garbage out)
  1. apply ONE mutant
  2. run tests covering its line  (fail-fast: stop on first red)
  3. any test red → KILLED   |   all green → SURVIVED
  4. score = killed / (total − equivalent/non-viable)

STATUSES
  KILLED       a test failed              → good
  SURVIVED     all tests passed           → missing/weak ASSERTION (fix first)
  NO_COVERAGE  no test runs the line      → missing TEST (weaker signal)
  TIMED_OUT    mutant hung the suite      → counts as KILLED
  NON_VIABLE   didn't compile             → excluded from score

EQUIVALENT MUTANT
  same behaviour for ALL inputs → unkillable → undecidable to detect
  → inspect, mark `ignored`, don't chase 100%

COST CONTROL  (cost = mutants × test-runs)
  diff-based (--since / scmMutationCoverage)   ← biggest CI win
  coverage-based test selection (default)
  caching / incremental (withHistory)
  operator sampling · parallel threads

TOOLS
  Java   pitest (bytecode, fast)
  JS/TS  Stryker     Python  mutmut / cosmic-ray     Go  gremlins / go-mutesting
```

---

## Summary

- A **mutation operator** is a rule that injects one plausible bug (`>`→`>=`, `+`→`-`, `return x`→`return null`, drop a `void` call). The operator set is a catalogue of the mistakes your suite is being audited against.
- The **run loop** applies one mutant, runs the covering tests, and grades: **any test fails → killed; all pass → survived**, with `no coverage` and `timeout` (counted as killed) as the other statuses. "Killed" means nothing more than "the suite turned red."
- **Mutation score** = killed / viable mutants. It beats line coverage because coverage measures *execution* while mutation measures *detection* — a 100%-coverage / 0%-score suite is the signature of tests that run code without checking it.
- The **equivalent mutant** changes text but not behaviour, so no test can kill it; detecting them is undecidable, making them the irreducible noise floor and the reason 100% is the wrong target.
- The **cost** is `mutants × test-runs`. Tame it with diff-based analysis (the key CI enabler), coverage-based test selection, caching, sampling, and parallelism — turning a batch job into a per-PR check.
- Run it with **pitest** (Java, bytecode), **Stryker** (JS/TS/C#/Scala), **mutmut/cosmic-ray** (Python), **gremlins/go-mutesting** (Go). Read the report, find the `SURVIVED` line, and tighten the one assertion it's pointing at.

---

## Further Reading

- *pitest* documentation (pitest.org) — operator (mutator) reference, `scmMutationCoverage`, and `withHistory` incremental analysis; the canonical JVM implementation.
- *Stryker Mutator* documentation (stryker-mutator.io) — the mutator catalogue, incremental mode, and the HTML report model for JS/TS/C#/Scala.
- *An Industrial Evaluation of Mutation Testing* — Petrović & Ivanković (Google, 2018) — how Google made mutation testing scale by surfacing only diff mutants as code-review hints.
- *Mutation Testing Repairs* and the *Mutation Testing* survey (Jia & Harman, 2011) — the academic grounding, including the equivalent-mutant problem and operator design.
- `man`-style tool docs: `mutmut --help`, `cosmic-ray` docs, and the `gremlins` README for the Go and Python sides.

---

## Related Topics

- [junior.md](junior.md) — the intuition: corrupt the code, see if tests scream; killed vs survived in plain terms.
- [senior.md](senior.md) — operator design trade-offs, mutation testing at scale, diff-based gating policy, and the research on what mutation score actually predicts.
- [01 — Line, Branch & Path Coverage](../01-line-branch-path-coverage/middle.md) — the execution-based metrics mutation testing both builds on and surpasses.
- [03 — Coverage Tooling per Language](../03-coverage-tooling-per-language/middle.md) — the per-language coverage tools whose data feeds mutation test selection.
- [04 — Coverage in CI & Diffs](../04-coverage-in-ci-and-diffs/middle.md) — wiring diff-based mutation analysis into pull-request checks.
