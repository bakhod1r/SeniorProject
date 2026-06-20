# Cyclomatic & Cognitive Complexity — Junior Level

> **Roadmap:** [Code Quality Metrics](../README.md) → Cyclomatic & Cognitive Complexity
> *Every `if`, every loop, every `&&` adds a fork in the road. Complexity metrics just count the forks — because each one is a separate path your code can take, and a separate place a bug can hide.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — What Cyclomatic Complexity Counts](#core-concept-1--what-cyclomatic-complexity-counts)
5. [Core Concept 2 — Counting It by Hand](#core-concept-2--counting-it-by-hand)
6. [Core Concept 3 — The Thresholds](#core-concept-3--the-thresholds)
7. [Core Concept 4 — Cognitive Complexity and Nesting](#core-concept-4--cognitive-complexity-and-nesting)
8. [Core Concept 5 — What to Do About a High Number](#core-concept-5--what-to-do-about-a-high-number)
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

> Focus: **What does it mean to put a *number* on how complicated code is?**

You already have a gut feeling for complicated code. You open a function, scroll, scroll some more, hit a triple-nested `if` buried in a loop, and think *"oh no."* That feeling is real, but it's not something you can put in a code review, a dashboard, or a CI check. A **complexity metric** turns that feeling into a number — something you can measure, track over time, and set a limit on.

The two numbers you'll meet everywhere are **cyclomatic complexity** and **cognitive complexity**. They sound interchangeable; they are not. Cyclomatic complexity counts the number of *independent paths* through a function — roughly, how many distinct ways execution can flow from top to bottom. Cognitive complexity counts how hard the code is for a *human to read*, and it punishes nesting specifically. One predicts *how many tests you need*; the other predicts *how much your head hurts*.

This page teaches you to count both by hand on small functions, where the magic disappears and you can see exactly what each tool is doing. Once you can count it yourself, the number on a dashboard stops being a mysterious grade and becomes what it actually is: a count of *paths* and a measure of *nesting*, pointing you at the functions most likely to hide bugs.

> **The mindset shift:** complexity is not a vague vibe — it's a **count of paths through your code**, and every path is a place a bug can hide. A function with ten branches has at least ten ways to behave, ten things to get right, and ten things to test. The number isn't a grade on your code; it's a count of how many ways the code can go.

---

## Prerequisites

- **Required:** You can read a function in at least one language and recognize `if`, `else`, `for`, `while`, `switch`/`case`, and the boolean operators `&&` and `||` (examples use **Go**, **Python**, and **JavaScript** — all readable without prior experience).
- **Required:** You understand what a function is and that it runs from top to bottom, branching at decisions.
- **Helpful:** You've written at least one test, so "more paths means more tests" lands concretely.
- **Helpful:** You've opened a file and immediately felt it was "too much." We're about to measure that feeling.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Complexity metric** | A number that estimates how complicated a piece of code is. |
| **Cyclomatic complexity** | A count of the independent **paths** through a function ≈ decision points + 1. Also written **V(G)**. |
| **Cognitive complexity** | A count of how hard the code is for a **human to read**, with extra penalty for nesting. |
| **Decision point** | A place where execution can branch: `if`, `for`, `while`, `case`, `&&`, `||`, `?:`, `catch`. |
| **Path** | One possible route execution can take from the start of a function to its end. |
| **Branch** | One of the two-or-more directions a decision point can send execution. |
| **Nesting** | Code inside code: a block inside a block inside a block. Depth = how deep you are. |
| **V(G)** | The classic notation for cyclomatic complexity (V = "complexity," G = the function's flow "graph"). |
| **Threshold** | A line you draw — e.g. "flag anything above 10" — that turns a metric into a check. |

---

## Core Concept 1 — What Cyclomatic Complexity Counts

**Cyclomatic complexity** answers one question: *how many independent paths run through this function?* A path is a distinct route from the function's entry to its exit. A function with no branches has exactly **one** path — start to finish, no choices. Every decision you add creates a fork, and each fork adds a path.

The decisions that create forks are the **decision points**:

- `if` (and `else if` — each one is its own decision)
- `for`, `while`, `do/while` (loop or don't loop — that's a branch)
- `case` in a `switch` (each `case` is a separate route)
- `&&` and `||` (these *short-circuit* — they secretly branch)
- the ternary `? :` and a `catch` clause

The formula you'll use for hand-counting is simple:

```
cyclomatic complexity ≈ (number of decision points) + 1
```

The `+ 1` is the one path a function with zero decisions still has: the straight line through it. Each decision point adds exactly one to the count.

Here's the smallest meaningful example — a function with one decision:

```go
func max(a, b int) int {
    if a > b {        // decision point #1
        return a
    }
    return b
}
```

One decision point (`if`), so complexity = **1 + 1 = 2**. And indeed there are two paths: *a is bigger* (return `a`) and *a is not bigger* (return `b`). The number and the paths match exactly.

Why count paths at all? Because **each path is independent behavior you have to get right and have to test.** A function with complexity 2 needs at least two tests to exercise both routes. A function with complexity 15 has fifteen-ish routes — fifteen things that can individually be wrong, and at least fifteen test cases to cover them all. The metric is, very literally, a lower bound on "how much can go wrong here."

> **Key insight:** Cyclomatic complexity ≈ **decision points + 1**, and that number is *also* roughly the minimum number of tests you need to cover every path. More branches → more paths → more tests → more places to be wrong. The metric isn't judging your style; it's counting your obligations.

---

## Core Concept 2 — Counting It by Hand

You don't need a tool to count cyclomatic complexity on a small function. The procedure is mechanical: **start at 1, then add 1 for every decision point.** Let's do a real one together, slowly.

```python
def classify(n):
    if n < 0:                    # +1  → 2
        return "negative"
    elif n == 0:                 # +1  → 3
        return "zero"
    elif n < 10:                 # +1  → 4
        return "small"
    else:
        return "large"
```

Walk it: start at **1**. The `if` is a decision (**2**). Each `elif` is its own decision — the first `elif` (**3**), the second `elif` (**4**). The final `else` is **not** a decision point; it's the fall-through, the path that's already counted by everything above it. So the total is **4**. Sanity check: there are four possible return values, four routes through the function. Four it is.

Now the part that trips everyone up — **boolean operators count too.** `&&` and `||` short-circuit, which means each one is secretly an `if`:

```javascript
function canVote(person) {
    if (person.age >= 18 && person.isCitizen && !person.isBanned) {
        return true;
    }
    return false;
}
```

Naively you see *one* `if` and guess complexity 2. But that condition has two `&&` operators, and each adds a decision point because the code can stop early: if `age >= 18` is false, it never checks `isCitizen`. So count: start **1**, the `if` (**2**), first `&&` (**3**), second `&&` (**4**). Complexity = **4**, not 2. The compound condition hides three separate decisions inside one line.

Loops count once for the looping decision:

```go
func sumPositives(nums []int) int {
    total := 0
    for _, n := range nums {     // +1  → 2  (loop or stop)
        if n > 0 {               // +1  → 3
            total += n
        }
    }
    return total
}
```

Start **1**, the `for` (**2**), the inner `if` (**3**). Complexity = **3**. The `for` contributes one (the branch "iterate again or exit"), and the `if` inside contributes one more.

> **Key insight:** Count `if`, `else if`/`elif`, `for`, `while`, each `case`, every `&&` and `||`, each `?:`, each `catch` — and add 1. Do **not** count plain `else`, `default`, the function header, or sequential statements — those don't fork; they're on a path that's already counted. The reliable trick: tally the *forks*, never the *joins*.

---

## Core Concept 3 — The Thresholds

A number alone tells you nothing until you know where the danger line is. McCabe (who invented cyclomatic complexity in 1976) and decades of tooling since have settled on rough, widely-used bands. Treat them as a *traffic light*, not gospel:

| Cyclomatic complexity | What it usually means |
|---|---|
| **1–10** | Simple. Easy to understand, easy to test. The goal for most functions. |
| **11–20** | Getting risky. Probably doing several things; worth a look and extra tests. |
| **21–50** | Hard to test and reason about. Strong candidate to refactor. |
| **50+** | Unmaintainable. Almost certainly needs to be broken apart. |

The most-quoted single number is **10**: McCabe's original suggestion for an upper limit per function, and the default that tools like SonarQube, ESLint's `complexity` rule, and `gocyclo` ship with. It's not a law of physics — a flat `switch` over twenty enum cases can hit 20 and be perfectly readable — but as a *default alarm*, "flag functions over 10" catches an enormous amount of genuinely tangled code for almost no false-positive cost.

Two things to hold in your head about thresholds:

**First, the number is a smoke detector, not a fire.** A complexity of 14 doesn't *prove* the function is bad — it tells you to *go look*. The decision the metric should drive is "a human should read this," never "this is automatically wrong." (This is the whole philosophy of [the section README](../README.md): metrics are diagnostics that point at risk, not grades that assign blame.)

**Second, the number is a *minimum test count*.** A function at complexity 12 needs at least twelve test cases to cover every path. If your test suite has three tests for it, you're covering a quarter of its behavior — and the metric just told you so. This is why high complexity and low confidence travel together: the more paths there are, the more of them go untested in practice.

> **Key insight:** **1–10 simple, 10–20 getting risky, 20+ refactor** — the "10" is the famous default limit, but the threshold's real job is to say *"go read this function,"* not to grade it. A high number is the start of a conversation, not the end of one.

---

## Core Concept 4 — Cognitive Complexity and Nesting

Cyclomatic complexity has a blind spot, and it's a big one: **it treats all decisions as equal.** To cyclomatic complexity, three flat `if` statements in a row score the same as three `if`s nested inside each other. But you know from experience those are *not* equally hard to read — the nested version makes your brain hurt far more.

Compare these two functions. Both have the same cyclomatic complexity (three decisions, so 4). But they are not equally readable:

```python
# Version A — flat. Easy to follow.
def describe(n):
    if n < 0:    return "negative"
    if n == 0:   return "zero"
    if n < 10:   return "small"
    return "large"
```

```python
# Version B — nested. Same cyclomatic complexity, much harder to hold in your head.
def process(order):
    if order.is_valid:
        if order.in_stock:
            if order.is_paid:
                ship(order)          # you must track THREE conditions to reach this line
```

In Version B you can't understand the `ship(order)` line without mentally holding *all three* conditions at once. Each level of nesting adds to the mental stack you have to carry. Cyclomatic complexity scores both as 4 and shrugs. That's the gap **cognitive complexity** was invented (by G. Ann Campbell at SonarSource) to fill.

Cognitive complexity scores how hard code is for a **human to read**, using a different rule of thumb:

- **+1** for each break in the linear flow (an `if`, a `for`, a `while`, a `catch`, a `&&`/`||` sequence).
- **+1 extra for each level of nesting** the structure sits inside. A loop at the top level costs 1; an `if` *inside* that loop costs 1 + 1 (one for being an `if`, one for the nesting); an `if` inside *that* costs 1 + 2.

So for Version B, roughly: the outer `if` costs **1**, the second `if` costs **1 + 1 = 2** (nested one deep), the third costs **1 + 2 = 3** (nested two deep). Cognitive complexity ≈ **6**, even though cyclomatic was 4. The metric grew specifically *because* of the nesting — exactly matching your gut.

This is why people often find cognitive complexity matches their feeling better: it penalizes the thing that actually makes code unreadable. **Deep nesting is the enemy.** An `if` inside a loop inside an `if` is genuinely worse than three flat `if`s — and cognitive complexity is the only one of the two metrics that says so.

> **Key insight:** Cyclomatic complexity counts paths (good for *test count*); cognitive complexity counts **reading difficulty and punishes nesting** (good for *"is this hard to understand?"*). Three flat `if`s and three nested `if`s have the *same* cyclomatic complexity but very *different* cognitive complexity — and your brain agrees with the second number.

---

## Core Concept 5 — What to Do About a High Number

When a complexity number is high, it's almost always saying the same thing: **this function is doing too much.** The number is the symptom; "too many responsibilities crammed into one function" is the disease. The cure is usually to *split* — pull the distinct jobs out into their own well-named pieces.

There are three moves that knock complexity down fast, and you'll use the first two constantly:

**1. Extract a function.** Take a chunk that does one identifiable thing and give it a name. The decisions move with it, so they leave the original function's count.

```python
# Before — one function carrying every decision
def checkout(cart, user):
    if cart.items and user.is_active and user.has_payment and not user.is_banned:
        ...   # the four decisions all live here

# After — the decision is named and lives elsewhere
def can_checkout(cart, user):
    return (cart.items and user.is_active
            and user.has_payment and not user.is_banned)

def checkout(cart, user):
    if can_checkout(cart, user):    # checkout now has ONE decision
        ...
```

**2. Flatten nesting with early returns (guard clauses).** Instead of nesting the happy path deeper and deeper, handle the failure cases up front and `return` early. This is the single biggest win for *cognitive* complexity because it removes nesting levels:

```python
# Before — the real work is buried three levels deep
def ship(order):
    if order.is_valid:
        if order.in_stock:
            if order.is_paid:
                do_ship(order)

# After — guard clauses; the happy path is flat and obvious
def ship(order):
    if not order.is_valid:  return
    if not order.in_stock:  return
    if not order.is_paid:   return
    do_ship(order)          # zero nesting — reads top to bottom
```

The cyclomatic complexity is similar, but the *cognitive* complexity drops sharply because nothing is nested anymore. The reader follows a flat list of guards instead of unwrapping three layers.

**3. Replace a long `if/else` chain with a lookup or polymorphism.** A giant `switch` mapping a type to behavior can often become a dictionary or a set of small types — but that's a [middle-tier](middle.md) move; for now, the first two will serve you in almost every case.

> **Key insight:** A high complexity number almost always means **the function is doing too much — split it.** *Extract a function* to move decisions out, and *use early returns* to kill nesting. You don't optimize the *number*; you fix the *design*, and the number follows.

---

## Real-World Examples

**1. The CI check that blocks the merge.** A team adds `gocyclo` to their pipeline with the default limit of 10. A pull request fails: a new `validateRequest` function scores 18. The author didn't write "bad" code on purpose — they just kept adding one more validation `if` to the same function over six commits. The number caught the slow drift that no single commit looked guilty for. They extract three of the checks into `validateHeaders`, `validateBody`, and `validateAuth`; the main function drops to 6 and the build goes green. The metric did its one job: *"go look at this function."*

**2. The bug that lived in an untested path.** A payment function has cyclomatic complexity 22 and exactly four tests. A refund edge case — *negative amount on an already-refunded order* — is one of the eighteen paths nobody tested, and it ships a bug to production. The complexity number had been screaming the whole time: twenty-two paths, four tested, eighteen in the dark. High complexity didn't *cause* the bug, but it predicted exactly where one could hide — in the paths the tests never reached.

**3. Two functions, same cyclomatic score, very different pain.** A reviewer sees two functions both reported at cyclomatic complexity 8. The first is a flat `switch` over eight HTTP status codes — boring, obvious, fine. The second is a single chain of `if`s nested five levels deep. Cyclomatic complexity called them equal; the reviewer's gut (and the *cognitive* complexity score of 15 vs 8) called them anything but. This is the day the reviewer stops trusting cyclomatic complexity alone and starts looking at nesting too.

---

## Mental Models

- **A function is a road map; complexity counts the forks.** A straight road has one path. Every `if`, loop, and `&&` is a fork that doubles the routes a traveler (execution) can take. Cyclomatic complexity is just a count of forks — and every fork is somewhere a wrong turn (a bug) can happen.

- **Each path is a test you owe.** Think of complexity as an invoice. Complexity 12 means "you owe at least twelve test cases to cover me." Looking at the number tells you instantly whether your three tests are paying the bill or ignoring it.

- **Nesting is mental weightlifting.** Every level of nesting is one more condition you must hold in your head to understand the line in front of you. Flat code lets you put each thought down before picking up the next; nested code makes you juggle them all. Cognitive complexity weighs the juggling.

- **The number points; it doesn't judge.** A complexity score is a metal detector going *beep* — it tells you *where to dig*, not that there's definitely treasure (or a bug). The decision it should drive is always "a human reads this next," never "this is automatically bad."

---

## Common Mistakes

1. **Forgetting that `&&` and `||` count.** People see one `if` and report complexity 2, missing that `if (a && b && c)` hides three decision points (short-circuit branches). Compound conditions are where hand-counts go wrong most often. Count every boolean operator.

2. **Counting `else` and `default` as decision points.** They aren't. The `else` is the path already implied by the `if` above it; the fork was the `if`. Count the forks, never the fall-throughs — otherwise you'll over-count every function.

3. **Treating the threshold as a verdict.** "Complexity 11, this code is bad" is wrong. Eleven means *go read it* — a flat `switch` over eleven cases can be perfectly clear. The number opens an investigation; it doesn't close one.

4. **Trusting cyclomatic complexity to measure *readability*.** It measures *paths*, not *how hard code is to read*. Three nested `if`s and three flat `if`s score identically to it, even though one is far worse to read. For readability, look at cognitive complexity (and nesting depth) instead.

5. **"Fixing" the number instead of the design.** Splitting one ugly function into two equally ugly halves just to get under the limit makes both worse. The metric is a proxy for "this does too much" — fix *that* (extract real responsibilities, flatten nesting) and the number drops honestly.

6. **Ignoring nesting because cyclomatic complexity looked fine.** A function can have a modest cyclomatic score and still be a nightmare of five-deep nesting. If it *feels* hard to read but the cyclomatic number is low, trust your gut — that's exactly the case cognitive complexity exists to catch.

---

## Test Yourself

1. In one sentence, what does cyclomatic complexity count, and what's the quick formula for estimating it by hand?
2. Why is high cyclomatic complexity related to "more tests needed"?
3. What's the single most-quoted threshold number, and what does crossing it actually *mean* you should do?
4. Two functions both have cyclomatic complexity 5. One is a flat list of `if`s; one is five-deep nested `if`s. Which has higher *cognitive* complexity, and why?
5. Name the two refactoring moves that most reliably bring complexity down, and say which one mainly helps *cognitive* complexity.
6. **Count the cyclomatic complexity of this function** (show your work):

```javascript
function grade(score, attended) {
    if (score >= 90 && attended) {
        return "A";
    } else if (score >= 80 || bonusWeek) {
        return "B";
    }
    for (let i = 0; i < retries; i++) {
        recheck(score);
    }
    return "F";
}
```

<details>
<summary>Answers</summary>

1. It counts the number of **independent paths** through a function — the distinct routes execution can take. Quick estimate: **decision points (`if`, `for`, `while`, `case`, `&&`, `||`, `?:`, `catch`) + 1**.
2. Each path is independent behavior that must be exercised to be tested. The complexity number is roughly the **minimum number of test cases** needed to cover every path — more paths means more tests to cover them all.
3. **10** — McCabe's classic upper limit and most tools' default. Crossing it means *"a human should go read this function"* (it may be doing too much), **not** "this code is automatically wrong."
4. The **nested** one has higher cognitive complexity. Cyclomatic complexity scores them equally (same number of decisions), but cognitive complexity adds an **extra penalty for each level of nesting**, so the five-deep version scores much higher — matching how much harder it is to read.
5. **Extract a function** (move decisions into a named helper) and **early returns / guard clauses** (handle failures up front to avoid nesting). The **early-returns** move mainly helps *cognitive* complexity because it removes nesting levels.
6. **Work:** start at **1**. `if` (+1 → 2). `&&` (+1 → 3). `else if` (+1 → 4). `||` (+1 → 5). `for` (+1 → 6). The plain `else`/fall-throughs and `return`s don't count. **Cyclomatic complexity = 6.**

</details>

---

## Cheat Sheet

```
WHAT EACH METRIC MEASURES
  cyclomatic complexity → number of independent PATHS through a function
                          ≈ minimum number of tests to cover it
  cognitive complexity  → how hard the code is for a HUMAN to READ
                          (penalizes NESTING specifically)

COUNT CYCLOMATIC BY HAND
  start at 1, then +1 for each:
    if   else if / elif   for   while   do/while
    case (each one)   &&   ||   ?:   catch
  do NOT count:
    plain else   default   the function header   sequential statements
  trick: count the FORKS, never the JOINS

THRESHOLDS (cyclomatic, rough)
  1–10    simple        ← aim for this
  11–20   getting risky ← go look
  21–50   refactor candidate
  50+     unmaintainable
  "10" = the famous default limit (SonarQube, ESLint, gocyclo)

NESTING IS THE ENEMY (cognitive)
  three FLAT ifs        → same cyclomatic, LOW cognitive
  three NESTED ifs      → same cyclomatic, HIGH cognitive
  each nesting level adds an extra cognitive point

WHEN THE NUMBER IS HIGH
  it means: the function does TOO MUCH → split it
  1) extract a function   (moves decisions out)
  2) early returns        (kills nesting → helps cognitive most)
  fix the DESIGN, not the number — the number follows
```

---

## Summary

- **Complexity metrics turn a gut feeling into a number** you can measure, track, and set limits on. The two you'll meet everywhere are *cyclomatic* and *cognitive* complexity, and they measure different things.
- **Cyclomatic complexity** counts the **independent paths** through a function ≈ *decision points + 1*. Count every `if`, `else if`, loop, `case`, `&&`, `||`, `?:`, and `catch`; do **not** count plain `else`, `default`, or sequential statements. The number is also roughly the **minimum tests** you need — more paths, more places to be wrong.
- **Thresholds:** 1–10 simple, 11–20 getting risky, 21+ refactor. The famous default is **10**. Crossing a threshold means *"go read this,"* not *"this is bad."*
- **Cognitive complexity** measures how hard code is for a **human to read** and adds an **extra penalty for nesting** — which is why three nested `if`s score worse than three flat ones even though their cyclomatic complexity is identical. It tends to match your gut better.
- **A high number almost always means the function does too much.** Fix it by **extracting functions** (move decisions out) and **using early returns** (kill nesting). Fix the design, and the number drops honestly.

You can now count both metrics by hand on a small function — which means the numbers on a dashboard are no longer mysterious grades but plain counts of *paths* and *nesting*, pointing you straight at the code most worth a second look.

---

## Further Reading

- Thomas J. McCabe, *"A Complexity Measure"* (IEEE TSE, 1976) — the original paper that defined cyclomatic complexity. Short and surprisingly readable; skim Sections I–III.
- G. Ann Campbell, *"Cognitive Complexity: A new way of measuring understandability"* (SonarSource white paper) — the definitive, free explanation of why nesting is penalized and how the score is built.
- [ESLint `complexity` rule](https://eslint.org/docs/latest/rules/complexity) and `gocyclo` — see the defaults a real tool ships with, and try one on your own code.
- The [middle.md](middle.md) of this topic — formalizes McCabe's V(G) as a control-flow graph (E − N + 2P), the exact cognitive-complexity rules, and how the two metrics behave on real code.

---

## Related Topics

- [middle.md](middle.md) — the graph-theory definition of V(G), basis paths, and the precise cognitive-complexity scoring rules.
- [senior.md](senior.md) — where these metrics mislead, gaming, and wiring them into review and CI without making them a target.
- [02 — Maintainability Index](../02-maintainability-index/junior.md) — how complexity gets folded into a single 0–100 "maintainability" score (and why that's seductive but weak).
- [04 — Code Churn & Hotspots](../04-code-churn-and-hotspots/junior.md) — why *complexity × how often it changes* predicts bugs better than complexity alone.
- [Refactoring](../../../code-craft/refactoring/) — the actual mechanics of extracting functions and flattening nesting once a number tells you to.
- [Technical Debt Management](../../technical-debt-management/) — deciding *which* high-complexity code to fix first, and how to justify the time.
