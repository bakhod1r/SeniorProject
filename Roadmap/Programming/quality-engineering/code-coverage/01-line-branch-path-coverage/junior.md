# Line, Branch & Path Coverage — Junior Level

> **Roadmap:** [Code Coverage](../README.md) → Line, Branch & Path Coverage
> *Coverage is the report that tells you which lines your tests ran. It feels like a grade on your test suite. It is not — it is a map of the rooms you never walked into.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Line Coverage: Which Lines Ran](#core-concept-1--line-coverage-which-lines-ran)
5. [Core Concept 2 — Branch Coverage: Did Both Sides Run](#core-concept-2--branch-coverage-did-both-sides-run)
6. [Core Concept 3 — The Trap: 100% Line ≠ 100% Branch](#core-concept-3--the-trap-100-line--100-branch)
7. [Core Concept 4 — Path Coverage and Why You Can't Test It All](#core-concept-4--path-coverage-and-why-you-cant-test-it-all)
8. [Core Concept 5 — Reading a Coverage Report](#core-concept-5--reading-a-coverage-report)
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

> Focus: **What does a coverage number actually measure?**

You write some tests, run a coverage tool, and it prints `78.4%`. What is that number? Most people guess "78% of my code is tested." That guess is wrong in a way that matters, and clearing it up is the whole point of this page.

A coverage tool does one mechanical thing: while your tests run, it **counts which parts of your code executed**. Then it divides — parts that ran, over parts total — and prints a percentage. That's it. It is bookkeeping about *execution*, nothing more. It does not read your assertions. It does not check whether the code that ran produced the right answer. It cannot tell a test that carefully verifies the result from a test that calls the function and throws the result away.

So the number is real, but it answers a much narrower question than people think. It answers: *"Which code did my tests cause to run, and which code did they never reach?"* The code your tests never reached is, by definition, code no test could possibly be checking. That is the genuine, useful thing coverage gives you — a list of the untested rooms.

The most important upgrade you'll learn here is the jump from **line** coverage (did this line run?) to **branch** coverage (did *both* directions of this `if` run?). It is entirely possible to run every single line of a function while only ever testing *half* of its decisions — and a line-coverage report will happily show you 100% while half your logic is unverified. Once you see that gap, you stop trusting the headline percentage and start reading the report the way it's meant to be read.

> **The mindset shift:** coverage tells you what you did **not** test. It never tells you that what you *did* test actually works. A red (uncovered) line is a fact — "no test touched this." A green (covered) line is only a possibility — "a test touched this; whether it *checked* anything is a separate question."

---

## Prerequisites

- **Required:** You can write a function and a basic test for it in at least one language (examples use **Go** and **Python**).
- **Required:** You understand `if` / `else` and what it means for a condition to be true or false.
- **Helpful:** You've run a test suite and seen it pass, and you've wondered "but did I test *enough*?"
- **Helpful:** You've seen a coverage percentage in CI or a pull request and weren't sure what it really meant.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Coverage** | A measurement of which parts of your code ran while tests executed. |
| **Line / statement coverage** | The fraction of lines (or statements) that ran at least once. |
| **Branch / decision coverage** | The fraction of decision *outcomes* (each `if`'s true and false side) that ran. |
| **Branch** | One direction out of a decision — the "true" path or the "false" path of an `if`. |
| **Path** | One complete route through a function, from entry to exit, across all its decisions. |
| **Covered** | Ran at least once during the test run (often shown green). |
| **Uncovered** | Never ran during the test run (often shown red). |
| **Instrumentation** | The tool's bookkeeping that counts which lines/branches executed. |
| **Coverage report** | The output — a percentage plus a per-line covered/uncovered breakdown. |

---

## Core Concept 1 — Line Coverage: Which Lines Ran

**Line coverage** (also called **statement coverage**) is the simplest and most common metric. It asks one question of every line of your code: *did this line run at least once while the tests were running?* Count the lines that ran, divide by the total number of runnable lines, and you have your percentage.

Take this small Go function and one test:

```go
func Abs(n int) int {
    if n < 0 {        // line A
        return -n     // line B
    }
    return n          // line C
}
```

```go
func TestAbs(t *testing.T) {
    if Abs(-5) != 5 {
        t.Fatal("want 5")
    }
}
```

We call `Abs(-5)`. Because `-5 < 0` is true, execution runs line A, then line B (`return -n`). It never reaches line C. So three runnable lines exist, two of them ran:

```
Abs: lines covered = A, B   (2 of 3)   →   line coverage ≈ 67%
```

The report would mark line C (`return n`) as **uncovered** — no test ever sent a non-negative number, so that line never executed. That's the useful signal: it's pointing at a real, untested branch of behaviour. Add a test that calls `Abs(5)`, and line C runs too, taking you to 100% line coverage.

> **Key insight:** line coverage is binary and crude — a line is either "ran" or "didn't run." It does not care *how many times* a line ran, *with what inputs*, or *whether you checked the result*. It only knows the line was reached. That crudeness is exactly why a high line-coverage number can hide so much, which is the heart of the next two concepts.

A subtle but important detail: what counts as a "line" depends on the tool. Most tools count *statements*, not physical text lines, so a blank line or a line with only a `}` usually isn't counted at all. This is why two tools can report slightly different percentages for the same code — they're dividing by slightly different totals. Don't chase the last decimal point; it's often just a counting convention.

---

## Core Concept 2 — Branch Coverage: Did Both Sides Run

Line coverage asks "did this line run?" **Branch coverage** asks a sharper question: at every decision point, *did each possible outcome happen?* Every `if` has two branches — the path taken when the condition is true, and the path taken when it's false. Branch coverage demands that **both** of them run at least once.

Why is this a real upgrade? Because a bug very often lives on the side of a decision you didn't think to test. Consider a discount function:

```python
def final_price(price, is_member):
    discount = 0
    if is_member:            # decision: is_member true? false?
        discount = 0.10
    return price * (1 - discount)
```

```python
def test_member_gets_discount():
    assert final_price(100, True) == 90
```

With only this one test, `is_member` is always `True`. The **true branch** of the `if` runs. The **false branch** — the case where a non-member should pay full price — *never runs in any test*. Branch coverage catches this immediately:

```
final_price: branches covered = 1 of 2   →   branch coverage = 50%
```

Half of your decision outcomes are untested. To reach 100% branch coverage you need a second test where `is_member` is `False`:

```python
def test_non_member_pays_full():
    assert final_price(100, False) == 100
```

Now both the true and false outcomes have run, and branch coverage hits 100%. Notice what just happened: the second test is the one that would actually catch a bug like `discount = 0.10` accidentally being applied to everyone. Branch coverage *pushed you toward the test that matters.*

> **Key insight:** branch coverage is strictly stronger than line coverage. Anything line coverage notices, branch coverage notices too — plus the decisions line coverage is blind to. When a project says "we measure coverage," always ask *which* coverage. Branch (or "decision") coverage is the one worth the headline number; line coverage alone is the one that lulls you to sleep.

A note on terminology you'll meet later: there's an even finer metric called **condition coverage** that looks *inside* a compound condition like `if a and b`, checking that `a` and `b` were each individually true and false. You don't need it yet — just know branch coverage treats the whole `if (...)` as one decision with two outcomes, and that's the right level to start at.

---

## Core Concept 3 — The Trap: 100% Line ≠ 100% Branch

Here is the single most important thing on this page, and the reason "we have 100% coverage" is a sentence senior engineers distrust. **You can run every line of code while testing only half of its branches.** A 100% *line*-coverage report can sit on top of code where 50% of the *decisions* are unverified.

The trap springs cleanly on a one-line `if` — an `if` with no `else`:

```go
func ApplyDiscount(price int, isMember bool) int {
    if isMember {
        price = price - 10   // the ONLY line inside the decision
    }
    return price
}
```

```go
func TestApplyDiscount(t *testing.T) {
    if ApplyDiscount(100, true) != 90 {
        t.Fatal("member should pay 90")
    }
}
```

Run that single test and look at line coverage. The `if` line runs. The `price = price - 10` line runs (member is `true`). The `return` line runs. **Every line executed.** Line coverage proudly reports **100%**.

But branch coverage tells the truth:

```
LINE   coverage: 100%   ← every line ran
BRANCH coverage:  50%   ← the "isMember == false" path NEVER ran
```

The false branch — what happens to a *non-member* — was never exercised by any test. If someone later breaks the non-member path (say, `price = price - 10` accidentally moved *outside* the `if`, charging everyone the discount), this test suite would not notice, and the line-coverage number would still read a confident 100%.

The reason the trap works: when an `if` has no explicit `else`, the "do nothing" false case has **no line of its own to be marked red**. Line coverage can only flag lines that exist. The missing branch is invisible to it precisely because it isn't a line. Branch coverage, which counts *outcomes* rather than lines, sees it immediately.

> **Key insight:** "100% line coverage" and "we've tested everything" are not the same claim, and the gap between them is exactly the set of `if`s without `else`s — which is most of them. Whenever you see a coverage number, your first question should be: *is that line coverage or branch coverage?* The honest version of the metric is branch.

---

## Core Concept 4 — Path Coverage and Why You Can't Test It All

If branch coverage is good, surely testing *every combination* of branches is better? That idea is **path coverage**: a **path** is one complete route through a function from start to finish, and path coverage asks that *every distinct route* be exercised. It is the most thorough coverage metric — and also the one you almost never fully achieve, for a reason that's worth understanding so you stop chasing it.

The problem is combinations. Each independent `if` doubles the number of routes:

```python
def handle(a, b, c):
    if a: ...    # 2 choices
    if b: ...    # × 2 choices
    if c: ...    # × 2 choices
    # → 2 × 2 × 2 = 8 distinct paths
```

Three simple `if`s already produce **8 paths**. Ten produce **1,024**. Twenty produce over a **million**. This is called **path explosion**: the number of paths grows *exponentially* with the number of decisions, so for any non-trivial function, full path coverage requires an astronomical number of tests. And that's *before* loops — a loop that can run 0, 1, 2, ... times multiplies the paths further, often without a finite bound.

So you cannot, in practice, test all paths, and you shouldn't try. The realistic goal is **branch coverage** — exercise each decision's true and false sides — which catches the great majority of "I forgot a case" bugs at a *linear* cost (roughly, you need enough tests to flip each decision both ways) rather than an exponential one.

> **Key insight:** there's a strict hierarchy of thoroughness — **path** coverage is stronger than **branch** coverage, which is stronger than **line** coverage. But strength costs tests, and path coverage's cost is exponential and usually infeasible. The sweet spot the industry settled on is branch coverage: nearly all the bug-catching value of paths, at a cost you can actually pay.

You'll still reason about *specific* important paths by hand — the unusual combination that handles a payment failure during a retry, say. But you target those deliberately, one at a time, rather than expecting a tool to enumerate them all.

---

## Core Concept 5 — Reading a Coverage Report

A coverage report has two layers, and beginners stare only at the first. The first layer is the **headline percentage** — one number for a file or the whole project. The second, far more useful layer is the **per-line breakdown** — which exact lines were covered (green) and which were not (red). The percentage tells you *how much*; the breakdown tells you *where*, and *where* is what you act on.

Let's generate a real one. With Go's built-in tooling:

```bash
go test -coverprofile=cover.out ./...
go tool cover -func=cover.out
```

You get a per-function summary like:

```
billing/price.go:12:   ApplyDiscount     50.0%
billing/price.go:20:   Refund            100.0%
total:                 (statements)      71.4%
```

Then open the visual, line-by-line view in a browser:

```bash
go tool cover -html=cover.out
```

This colours each line: **green** lines ran, **red** lines never did. (Python's Coverage.py does the same with `coverage html`, producing an HTML report where uncovered lines are highlighted.) Reading it is simple and powerful: scan for the red. Each red line is a concrete, specific piece of behaviour that *no test exercised*. That non-member branch from Concept 3? It shows up as a red region you can point at.

> **Key insight:** read the report *backwards* from how people instinctively do. Don't look at the 71.4% and feel a feeling. Look at the **red lines** and ask, for each one, "is this behaviour I actually care about being correct?" If yes, it needs a test. If no (it's a trivial getter, generated code, an unreachable defensive branch), leave it — and the *percentage will be lower than 100%, which is fine.* The percentage is a by-product of that judgment, not the goal.

A high-level word on **how the numbers are collected**, because it demystifies the whole thing. Before running your tests, the tool **instruments** your code — it quietly inserts tiny counters, conceptually a `count[thisLine]++` at each line or each branch. Your tests run the instrumented code, the counters tick up for everything that executes, and afterward the tool reads the counters: any line whose counter is still zero never ran (red); anything above zero ran (green). That's the entire mechanism — it's just counting execution, which is why coverage can only ever tell you what *ran*, never what was *correct*.

---

## Real-World Examples

**1. The "100% covered" service that shipped a bug.** A team enforces "100% coverage" in CI and is proud of it — but it's *line* coverage. A function `if user.IsAdmin { grantAccess() }` has one test, for an admin user. Every line runs; the report says 100%. Nobody ever tested the non-admin path, where access should be *denied*. A refactor accidentally moves `grantAccess()` outside the `if`, granting everyone admin rights. Tests still pass; coverage still reads 100%. Switching the gate to *branch* coverage would have flagged the untested false branch the day the test was written.

**2. The red line that found the real gap.** A developer writes a JSON parser and runs Coverage.py. The headline is a comfortable 92%. But the HTML report shows one red region: the `except json.JSONDecodeError:` block — the error-handling path. Every test fed *valid* JSON, so the failure path never ran. The red line was pointing directly at the most important untested behaviour: what the code does with bad input. One test with malformed JSON turned it green *and* caught a bug where the error was swallowed silently.

**3. Why a team gave up on 100%.** A new engineer tries to push a 78% module to 100% and discovers the remaining 22% is defensive code — branches like `if err != nil { panic("unreachable") }` and getters generated by a code generator. Forcing tests onto them adds noise without adding safety. The team adopts branch coverage on *meaningful* code and explicitly accepts that the global number sits in the 80s. The percentage went *down* on paper and the suite got *better* — the first lesson that coverage is a diagnostic, not a score to maximize.

---

## Mental Models

- **Coverage is a map of unvisited rooms, not a grade.** Imagine your code as a house. Coverage shows which rooms a test walked into. The red rooms — never entered — are the real signal. But "walked into a room" says nothing about whether the visitor *inspected* anything; that's the assertion's job, which coverage can't see.

- **Line coverage = "the light turned on." Branch coverage = "you opened every door."** A line running is a light flicking on as you pass. But a room with two doors (an `if`) needs *both* doors opened. Line coverage is satisfied by the light; branch coverage insists on every door.

- **The `if` without an `else` is a trapdoor with no visible floor.** Line coverage can only flag lines that exist. An `if` with no `else` has no line for the false case, so line coverage literally cannot mark it red. Branch coverage counts the missing door directly.

- **Paths are a combination lock.** Each decision is a dial; flipping it doubles the combinations. Branch coverage checks each dial moves both ways (cheap, linear). Path coverage checks every full combination (exponential, hopeless past a handful of dials). Test the dials, not the combinations.

---

## Common Mistakes

1. **Treating the coverage percentage as a quality score.** It measures *execution*, not *correctness*. A test that calls a function and asserts nothing raises coverage by the same amount as a thorough one. High coverage with weak assertions is *worse* than honest medium coverage, because it looks safe.

2. **Quoting "100% coverage" without saying which kind.** 100% *line* coverage can hide 50% untested *branches* (the no-`else` trap). Always specify, and prefer branch/decision coverage for the headline number.

3. **Chasing 100% for its own sake.** The last 10–20% is usually defensive code, generated code, or genuinely unreachable branches. Forcing tests onto them adds maintenance noise without adding safety. Aim coverage at behaviour you care about, and let the percentage land where it lands. (More in [06 — Coverage as Signal, Not Target](../06-coverage-as-signal-not-target/junior.md).)

4. **Trying to achieve full path coverage.** Path explosion makes it exponential and infeasible for any real function. Target branch coverage; reason about a few critical *specific* paths by hand.

5. **Reading the number and ignoring the red lines.** The percentage tells you *how much*; the per-line breakdown tells you *where*. The red lines are the actionable part — scan them and ask "do I care if this is correct?"

6. **Believing a covered line is a tested line.** "Covered" means *ran*, not *verified*. The deep version of this — covered code with no assertion checking it — is its own subject: [05 — What Coverage Does *Not* Tell You](../05-what-coverage-does-not-tell-you/junior.md).

---

## Test Yourself

1. In one sentence, what does a coverage tool actually measure — and what does it *not* measure?
2. A function has one `if` with no `else`, and your single test exercises the true side. Your tool reports **100% line coverage**. What is your **branch coverage**, and why the difference?
3. What is the difference between a *branch* and a *path*? Which coverage metric is stronger?
4. A function has 4 independent `if` statements and no loops. Roughly how many distinct paths does it have? Why is full path coverage usually infeasible?
5. You open an HTML coverage report and see a red `except` block. What does red mean, and what should you do?
6. You're told a service has "high coverage" but it still shipped a logic bug on an untested branch. How is that possible if coverage was high?

<details>
<summary>Answers</summary>

1. It measures **which lines/branches of your code executed while tests ran** (and divides to a percentage). It does **not** measure whether the code that ran produced the correct result — it never reads your assertions.
2. **Branch coverage is 50%.** The true side of the `if` ran (so every *line* ran → 100% line coverage), but the false side ("non-member"/"not-admin") never executed. Line coverage can't flag it because a no-`else` `if` has no line for the false case; branch coverage counts the missing *outcome* directly.
3. A **branch** is one direction out of a single decision (the true or false side of one `if`). A **path** is one complete route through the whole function across *all* its decisions. **Path coverage is stronger** than branch coverage (which is stronger than line coverage).
4. About **2⁴ = 16 paths**. Full path coverage is infeasible because paths grow *exponentially* with the number of decisions (path explosion) — 10 `if`s give ~1,024, 20 give over a million — and loops can multiply it without bound. Branch coverage gives most of the value at linear cost.
5. **Red means that line never ran during any test** — here, the error-handling path was never exercised (every test fed valid input). Add a test that triggers the error case; it will turn the block green and, often, reveal a real bug in the rarely-run path.
6. **Coverage measures execution, not correctness.** The buggy branch was either never run (high *line* coverage hid a missing *branch* via the no-`else` trap) or it ran but no assertion checked its result. "Covered" ≠ "tested."

</details>

---

## Cheat Sheet

```
WHAT COVERAGE MEASURES
  which lines/branches RAN during tests, as a %
  it does NOT read assertions → never tells you the code is CORRECT
  red line = no test ran it (a FACT) ; green line = a test ran it (only a possibility)

THE METRICS (weakest → strongest)
  LINE / STATEMENT   did this line run at least once?
  BRANCH / DECISION  did BOTH the true AND false side of each if run?   ← use this one
  PATH               did every full route through the function run?     ← usually infeasible

THE TRAP (memorize this)
  if x {           one test with x==true →
      doThing()      LINE coverage   = 100%  (every line ran)
  }                  BRANCH coverage =  50%  (x==false NEVER ran)
  // a no-else if has no line for the false case → line coverage can't see the gap

PATH EXPLOSION
  N independent ifs  →  2^N paths
  3 ifs = 8 ,  10 ifs = 1024 ,  20 ifs = 1_000_000+   (loops make it worse)
  → don't chase path coverage; target BRANCH coverage

READING A REPORT
  1. note the % (how MUCH)         2. scan the RED lines (WHERE)
  3. for each red line ask: "do I care this is correct?" yes → test it ; no → leave it
  % is a by-product of that judgment, not the goal

HOW IT'S COLLECTED
  tool instruments code (inserts count[line]++), runs tests, reads counters
  counter == 0 → red (never ran) ; counter > 0 → green (ran)

GO QUICK START
  go test -coverprofile=cover.out ./...
  go tool cover -func=cover.out       # per-function %
  go tool cover -html=cover.out       # green/red line view
```

---

## Summary

- A coverage tool **counts which lines/branches of your code executed while tests ran**, then divides to a percentage. It is bookkeeping about *execution* — it never reads your assertions and so can never tell you the code is *correct*.
- **Line (statement) coverage** asks "did this line run?" It's crude: a line is either reached or not, regardless of inputs or whether you checked the result.
- **Branch (decision) coverage** asks "did *both* sides of each `if` run?" — a strict upgrade that pushes you toward the tests that actually catch "I forgot a case" bugs.
- The critical trap: **100% line coverage can hide 50% untested branches**, because an `if` with no `else` has no line for the false case to be flagged red. Always ask *which* coverage a number refers to; prefer branch.
- **Path coverage** (every full route through a function) is the strongest metric but suffers **path explosion** — paths grow exponentially with decisions — so it's almost never feasible. Branch coverage is the practical sweet spot.
- **Read a report backwards:** ignore the headline feeling, scan the **red lines**, and for each ask "do I care this is correct?" The percentage is a by-product of that judgment, not the target.

You now know what the number means and, more importantly, what it doesn't. Everything else in this roadmap — mutation testing, per-language tooling, CI gates — builds on this one foundation: *coverage shows you what you didn't test; it is a signal, never a guarantee.*

---

## Further Reading

- *TestCoverage* — Martin Fowler (martinfowler.com). The canonical short essay on coverage as a diagnostic, not a target. Read it once a year.
- *Software Engineering at Google* — Winters, Manshreck & Wright. The coverage discussion, especially why Google does **not** enforce a single global threshold.
- [Go blog — *The cover story*](https://go.dev/blog/cover) — how `go test -cover` instruments code and generates the green/red report, explained by the Go team.
- [Coverage.py documentation — Branch coverage](https://coverage.readthedocs.io/en/latest/branch.html) — Python's clear write-up of why branch coverage finds what line coverage misses.
- The [middle.md](middle.md) of this topic, which formalizes the **subsumption hierarchy** (statement → branch → condition → MC/DC → path) and shows real instrumentation in detail.

---

## Related Topics

- [middle.md](middle.md) — the formal subsumption hierarchy, condition and MC/DC coverage, and how instrumentation really works.
- [senior.md](senior.md) — choosing a coverage target per codebase, the cost curve, and where each metric earns its keep.
- [02 — Mutation Coverage](../02-mutation-coverage/junior.md) — the metric that *does* probe test quality, by checking whether your tests would notice a deliberately broken line.
- [05 — What Coverage Does *Not* Tell You](../05-what-coverage-does-not-tell-you/junior.md) — covered ≠ tested: the assertion-free test problem and other blind spots.
- [06 — Coverage as Signal, Not Target](../06-coverage-as-signal-not-target/junior.md) — Goodhart's law, gaming the number, and the 80%/100% debate.
- [Testing](../../testing/) — the broader testing discipline that coverage is a diagnostic *for*, not a substitute for.
