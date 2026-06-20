# Coverage as Signal, Not Target — Junior Level

> **Roadmap:** [Code Coverage](../README.md) → Coverage as Signal, Not Target
> *A coverage number is a flashlight, not a finish line. Point it at the dark corners of your code to find what's untested — the moment you start chasing the number itself, the number starts lying to you.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Goodhart's Law: Why Targets Corrupt Measures](#core-concept-1--goodharts-law-why-targets-corrupt-measures)
5. [Core Concept 2 — How a Coverage Target Gets Gamed](#core-concept-2--how-a-coverage-target-gets-gamed)
6. [Core Concept 3 — Signal vs Target: Two Ways to Hold the Same Number](#core-concept-3--signal-vs-target-two-ways-to-hold-the-same-number)
7. [Core Concept 4 — Read the Red, Don't Chase the Percent](#core-concept-4--read-the-red-dont-chase-the-percent)
8. [Core Concept 5 — A Thoughtful 75% Beats a Gamed 100%](#core-concept-5--a-thoughtful-75-beats-a-gamed-100)
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

> Focus: **How do you use a coverage number wisely instead of being used by it?**

You've run a coverage tool. It printed a number — `74%`, `88%`, whatever — and a report with some lines colored green and some colored red. The obvious next thought is: *"How do I make that number go up?"*

That thought is the trap this entire page exists to disarm.

A coverage percentage is one of the most useful diagnostics in software *and* one of the most dangerous metrics, and which one it is depends entirely on how you treat it. Used as a **signal**, it answers a genuinely valuable question: *which parts of my code did my tests never run?* Used as a **target** — a score you're rewarded for hitting — it quietly stops answering that question and starts measuring something else: *how clever is the team at making the tool report a high number?* Those are not the same thing, and the gap between them is where bad test suites are born.

Here's the part that surprises people: when a team mandates "100% coverage required to merge," test quality often goes *down*. Not because the engineers are lazy or dishonest, but because they're rational — you gave them a number to hit, so they hit it the cheapest way available, and the cheapest ways (tests with no assertions, ignore-this-line annotations, deleting awkward code) all push the number up while pushing real confidence down.

This page teaches the healthy alternative: open the report, look at the **red** lines, and ask one question — *"is anything important untested here?"* Coverage becomes a to-do finder, not a grade. By the end you'll be able to look at a 75% that someone reasoned about and recognize it as *better* than a 100% nobody did, and you'll know exactly why.

> **The mindset shift:** use coverage to *find what to test*, never as a score to *hit*. The number is the start of a conversation ("what's in the red?"), not the end of one ("we hit 90, ship it"). The instant the number becomes the goal, it stops telling you the truth.

---

## Prerequisites

- **Required:** You know roughly what code coverage *is* — that a tool runs your tests, watches which lines execute, and reports the percentage that ran. (If "line vs branch coverage" is new, skim [01 — Line, Branch & Path Coverage](../01-line-branch-path-coverage/junior.md) first.)
- **Required:** You've written at least a few unit tests and have seen a test file with `assert` statements in it.
- **Helpful:** You've seen a coverage report — the kind with green and red lines — even once.
- **Helpful:** You've worked somewhere that had a coverage rule in CI, or argued with someone about "what percentage is enough." (Examples use **Python** and a little **Go** and **JavaScript**, but no concept here is language-specific.)

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Coverage %** | The fraction of your code (lines, or branches) that ran while your tests executed. |
| **Signal** | A measurement you *read* to learn something — here, "which code is untested?" |
| **Target** | A number you're *required to hit* — e.g. "merge is blocked below 90%." |
| **Goodhart's law** | "When a measure becomes a target, it stops being a good measure." |
| **Gaming** | Making the number go up *without* improving the thing it was supposed to reflect. |
| **Vanity metric** | A number that looks impressive but doesn't reflect real value (a gamed 100% is one). |
| **Assertion** | The check in a test that can actually *fail* (`assert result == 5`). No assertion → nothing is verified. |
| **`# pragma: no cover`** | An annotation that tells the coverage tool "ignore this line" — it disappears from the denominator. |
| **Diagnostic** | A tool you consult to investigate a problem (a thermometer), not a goal to optimize. |

---

## Core Concept 1 — Goodhart's Law: Why Targets Corrupt Measures

Start with the one idea everything else hangs on. In 1975 the economist Charles Goodhart observed a pattern that turned out to apply far beyond economics. The popular phrasing (we owe the crisp version to the anthropologist Marilyn Strathern) is:

> **When a measure becomes a target, it ceases to be a good measure.**

Read it slowly, because it's doing a lot of work. A *measure* is something you observe to learn the state of the world. The moment you attach a reward or a requirement to that measure — make it a *target* — people start optimizing the measure directly, and the link between the measure and the real thing it was a proxy for snaps.

A non-software example makes it click. Imagine a call center measures "average call length" and discovers shorter calls correlate with efficiency. Reasonable so far — it's a useful *signal*. Now management makes it a *target*: "keep calls under 3 minutes." What happens? Agents hang up on customers at 2:55 whether or not the problem is solved. Call length plummets — the target is met! — while the actual goal (helping customers) gets *worse*. The measure was a fine signal and a terrible target, and turning it into a target is precisely what destroyed it.

Coverage is the call-center metric of software testing. As a signal it's genuinely informative: code your tests never run is code you have no evidence works. But the proxy is loose — "this line ran" is a long way from "this line is correct." So the moment you make coverage a target, people optimize "this line ran" (cheap) instead of "this line is correct" (the actual goal, expensive), and the number climbs while confidence flatlines or drops.

> **Key insight:** coverage is a *proxy*. "My tests ran this line" is a stand-in for "I have confidence this line works," but it's a *loose* stand-in — running a line proves almost nothing about whether you checked its result. Targets reward optimizing the proxy. Goodhart's law is just the name for what happens next: the proxy goes up, the real thing doesn't follow.

---

## Core Concept 2 — How a Coverage Target Gets Gamed

"Gaming" sounds malicious. It usually isn't. When you tell rational engineers "you cannot merge below 100%," they will find the *cheapest path* to 100%, and the cheapest paths happen to be the worst ones. Here are the three you'll see everywhere — recognize them so you don't write them by reflex.

**Game #1 — Tests with no assertions.** The single most common one. Coverage tools only watch whether a line *executes*; they have no idea whether you *checked the result*. So you can drive any line to "covered" by simply calling it and never asserting anything.

```python
# The function under test
def apply_discount(price, percent):
    if percent < 0 or percent > 100:
        raise ValueError("percent must be 0–100")
    return price * (1 - percent / 100)

# A GAMED test — covers every line, verifies NOTHING
def test_apply_discount_gamed():
    apply_discount(100, 20)          # line runs → "covered" ✅
    try:
        apply_discount(100, 999)     # the raise runs too → "covered" ✅
    except ValueError:
        pass                          # we swallow it; we never check it happened
```

That test gives you **100% line coverage** of `apply_discount`. It also has **zero** ability to catch a bug. If someone changes the formula to `price * percent / 100` (totally wrong), this test still passes — green, 100%, broken. The number is a lie because nothing was ever verified.

Here's the *same coverage*, written as a real test:

```python
def test_apply_discount_real():
    assert apply_discount(100, 20) == 80      # checks the math
    assert apply_discount(50, 0) == 50        # no discount
    with pytest.raises(ValueError):           # checks the guard actually fires
        apply_discount(100, 999)
```

Identical coverage percentage. Wildly different value. The coverage tool **cannot tell these two tests apart** — and that's the whole problem with treating its number as a measure of quality.

**Game #2 — Annotating the problem away.** Hard-to-test line dragging your percentage down? Most tools let you mark it as exempt, and it vanishes from the denominator:

```python
def fetch_config():
    if os.environ.get("OFFLINE"):            # pragma: no cover
        return load_local_fallback()         # pragma: no cover
    return load_from_server()
```

The percentage jumps — not because you tested more, but because you *measured less*. Sometimes excluding a line is legitimate (truly unreachable defensive code). But under a target, the annotation becomes a pressure valve: anything awkward gets a `no cover` until the gate goes green. You've optimized the report, not the suite.

**Game #3 — Deleting the hard branch.** The darkest one. A gnarly error-handling branch is hard to test and keeps showing red. Under deadline pressure to hit the gate, someone *deletes the branch* — removes the `else`, drops the edge-case handling — and the percentage rises because the uncovered code no longer exists. You didn't make the code safer; you removed a safety net *and* got rewarded with a higher score for doing it.

> **Key insight:** every gaming move has the same shape — **the number goes up while quality goes down**. Fake tests raise coverage and lower verification. `no cover` raises coverage by shrinking what's measured. Deleting branches raises coverage by removing the very code most likely to hide bugs. If a change makes the percentage rise but you can't point to a *new thing now verified*, you didn't improve the suite — you gamed the metric.

---

## Core Concept 3 — Signal vs Target: Two Ways to Hold the Same Number

The same `78%` can mean two completely opposite things depending on the question you asked to get there. The number is identical; the *intent behind it* is everything.

**Coverage as a target** sounds like:

- "We need to hit 90% to merge."
- "I added tests until the bar went green."
- "Our coverage went *down* 0.4% — block the PR."
- "What's the minimum I can test to clear the gate?"

In target-mode, the percentage is the **goal**. You work *toward the number*. And because you're optimizing the number directly, Goodhart guarantees you'll eventually optimize it in ways that don't help — assertion-free tests, exemptions, deletions. The number rises; your confidence doesn't.

**Coverage as a signal** sounds like:

- "Let me open the report and see what's in the red."
- "Huh — the entire payment-retry path is untested. *That* matters; let me write a real test."
- "This red block is a trivial getter; not worth a test. Skip."
- "We're at 78%. Is anything *important* in the missing 22%? Let me look."

In signal-mode, the percentage is just the **doorway to the report**. You don't work toward the number; you *read* it, then go investigate the gaps and exercise judgment about which ones deserve a test. The number is a side effect of writing tests that matter — not the thing you chase.

Same tool. Same `78%`. One mindset produces a suite full of hollow tests around a number; the other produces real tests around the *risks the report revealed*. The difference isn't the metric — it's whether the metric is your destination or your map.

> **Key insight:** ask yourself, "am I working *toward* this number, or *reading* it?" Toward = target = Goodhart = eventual gaming. Reading = signal = diagnostic = real tests where they matter. Same percentage, opposite outcomes — and the only difference is which question you asked.

---

## Core Concept 4 — Read the Red, Don't Chase the Percent

Here's the practical heart of the page — the actual workflow of using coverage well. Forget the top-line percentage for a moment. The valuable part of any coverage tool is the **per-line report**: the view that shows you, line by line, what ran (green) and what didn't (red).

Generate it and *open the HTML*, don't just read the summary:

```bash
# Python
pytest --cov=myapp --cov-report=html      # then open htmlcov/index.html

# Go
go test -coverprofile=cover.out ./...
go tool cover -html=cover.out             # opens the colored report in a browser

# JavaScript / TypeScript
npx c8 --reporter=html npm test           # then open coverage/index.html
```

Now drill into a file and read the **red** lines. For each red block, ask a single question:

> **"Is anything important untested here?"**

That question — not the percentage — is the whole job. The red lines fall into a few buckets, and your judgment routes each one:

- **Red on a critical path** (payment, auth, the core algorithm, an error branch that fires in production) → **write a real test.** This is gold. The report just handed you a prioritized to-do list of your scariest untested code.
- **Red on something trivial** (a one-line getter, a `__repr__`, an auto-generated file, glue you'll delete next sprint) → **leave it red.** Testing it adds a test to maintain and buys you nothing. Red is *allowed*. Red is not failure.
- **Red on something you can't easily reach** (an `if __name__ == "__main__"` block, a rare hardware-error branch) → **decide deliberately** — maybe a `no cover` *is* right here, used as an honest "intentionally untested," not as a gate-dodge.

Notice what this workflow *never* does: it never says "the number must reach X." It uses the report as a **to-do finder** — a tool that points a flashlight at code nobody has exercised so *you* can decide, gap by gap, whether that gap is a risk. Some gaps you close. Some you consciously accept. The percentage is just whatever falls out of those decisions.

> **Key insight:** the per-line report is the product; the top-line percentage is the packaging. Reading the red and asking "does this gap matter?" is *using coverage*. Watching the percentage tick toward a goal is *being used by it*. A junior who reads the report and writes three real tests for the scary red paths has done more for quality than one who added ten hollow tests to move the number two points.

---

## Core Concept 5 — A Thoughtful 75% Beats a Gamed 100%

Now the claim that sounds wrong until you've seen both suites: **a thoughtfully-tested 75% is a better suite than a gamed 100%.** Let's make it concrete with two versions of the same project.

**Suite A — gamed 100%.** Every line runs during the test suite, so the report is a wall of green and the badge says `100%`. But a third of those tests have no assertions (Game #1), a couple of awkward branches got `# pragma: no cover` (Game #2), and one nasty error path was deleted to clear the gate (Game #3). The 100% is *real* in the sense that the tool reports it — and *fake* in the sense that it reflects almost no verification. Change the core formula and a worrying number of tests stay green. The badge inspires confidence the suite cannot back up. That's a **vanity metric**: impressive-looking, value-free.

**Suite B — thoughtful 75%.** The team read the report and wrote *real, asserting* tests for everything that matters: the business logic, the auth checks, the error branches that actually fire in production. The remaining red 25% is deliberate — trivial getters, generated code, a `main()` entrypoint, glue scheduled for deletion. Every test that exists can actually *fail* when the code breaks. The 75% is *lower* but *honest*: it accurately says "three-quarters of this code, including all the important parts, is genuinely verified, and we made a conscious call on the rest."

Which suite catches a real bug introduced next Tuesday? **B, easily.** Suite A's number is higher and its protection is thinner. Suite B's number is lower and its protection is real. If you only ever look at the badge, you'd pick A — which is exactly how teams end up with high coverage and frequent production incidents at the same time.

This is why thoughtful engineers, and organizations like Google, **refuse to mandate a single global coverage threshold.** Not because coverage is useless — they use it heavily as a *signal*, surfaced in code review to prompt "should this new code have a test?" — but because a hard global target predictably produces Suite A. The threshold optimizes the number; it does not optimize the testing. (You'll see exactly how teams thread this needle — diff coverage, ratchets, why a global gate backfires — in [04 — Coverage in CI & Diffs](../04-coverage-in-ci-and-diffs/junior.md).)

> **Key insight:** coverage measures *quantity* (how much code ran), never *quality* (whether you checked the result). A high quantity built from low quality is a vanity metric. A modest quantity built from real assertions is genuine protection. When you must choose, choose the honest 75% — and when you must report, report what's *verified*, not what merely *ran*.

---

## Real-World Examples

**1. The mandate that made tests worse.** A team ships a few too many bugs, so a manager decrees: "100% coverage to merge, effective Monday." Within two weeks coverage is a glorious 100% and the engineers are quietly miserable. Why? To clear the gate fast they wrote dozens of assertion-free tests (call the function, assert nothing) and sprinkled `# pragma: no cover` over anything fiddly. The badge says `100%`; production incidents are *unchanged*, because the new tests verify nothing — they just execute lines. The mandate optimized the measure and left the goal untouched. Goodhart, in a sprint. The fix was to drop the global gate and instead surface untested *new* code in code review as a prompt, not a blocker.

**2. The flashlight that found a real bug.** A junior engineer, *not* chasing a number, opens the HTML coverage report out of curiosity and notices the entire `refund_payment()` error-handling branch is red — never tested. That branch handles "the payment provider returned an error mid-refund." She writes a real, asserting test for it and immediately discovers the branch double-refunds on one provider error code. Coverage didn't fix the bug; it *pointed her flashlight at the dark corner where the bug was hiding*. Used as a signal — "what's in the red that matters?" — it did exactly the job it's good at.

**3. The 100% library nobody trusted.** An open-source library proudly displays a `100%` coverage badge. A contributor goes to add a feature, reads the tests, and finds that half of them are of the form `result = parse(x)` with no assertion on `result` — they execute the parser and check nothing. The badge is real; the protection is hollow. The contributor refactors the parser, every test stays green, and a real bug ships. The `100%` was a vanity metric the whole time. The eventual fix: stop celebrating the badge, start auditing whether tests actually *assert* — a thing the percentage can never show.

---

## Mental Models

- **Coverage is a flashlight, not a scoreboard.** A flashlight's job is to show you the dark corners so *you* decide what's worth a closer look. Pointing it around the room (reading the red) is using it well. Trying to make the flashlight's *brightness number* as high as possible misses the entire point of owning a flashlight.

- **The proxy and the prize.** "Lines ran" is the proxy; "code works" is the prize. They're correlated — until you make the proxy a target, at which point people optimize the proxy directly and the correlation breaks. Every gaming move is the proxy detaching from the prize.

- **A thermometer you can't optimize by holding a match to it.** A thermometer tells you the room's temperature — a useful signal. If your *goal* becomes "make the thermometer read 22°," you can hold a lighter to it: the reading hits 22° while the room is freezing. `# pragma: no cover` and assertion-free tests are the lighter. The reading is not the temperature.

- **Quantity vs quality are different axes.** Coverage measures one axis (how much code ran). Whether your tests assert anything measures the other (did you check the result). A test can be high on one and zero on the other — which is exactly the assertion-free test. The percentage only ever moves along the quantity axis.

- **Red is a to-do list, not a report card.** A report card grades you and you feel bad about the low marks. A to-do list just shows you what's left, and you decide which items are worth doing. Treat red lines as the second thing: candidates for your attention, each subject to "does this one matter?"

---

## Common Mistakes

1. **Treating the percentage as the goal.** "We hit 90%, we're done." 90% of *what*, verified *how*? The number is a doorway to the report, not a finish line. Working *toward* a number is the original sin from which every other mistake here follows.

2. **Writing tests with no assertions to move the bar.** Calling a function "covers" it without verifying anything. This is the #1 way coverage lies. If a test can't *fail* when the code breaks, it isn't protecting you — it's decorating the badge. Always ask: "what does this test actually assert?"

3. **Sprinkling `# pragma: no cover` to clear a gate.** Excluding a line raises the percentage by *measuring less*, not testing more. Legitimate occasionally (truly unreachable code); abused constantly under a target. If you're adding `no cover` to hit a number rather than to mark honestly-untestable code, you're gaming.

4. **Deleting hard-to-test branches to raise coverage.** The worst one. You removed a safety net *and* got rewarded with a higher score. The uncovered error branch was the *most* important thing to test, not the thing to delete.

5. **Believing 100% means "fully tested."** 100% line coverage means every line *ran*, not that every line is *correct*, not that every *branch* was hit, and definitely not that you checked the results. A gamed 100% can be near-worthless. (For everything a high number still *doesn't* prove, see [05 — What Coverage Does *Not* Tell You](../05-what-coverage-does-not-tell-you/junior.md).)

6. **Ignoring the per-line report entirely.** Reading only the top-line summary wastes 90% of the tool's value. The percentage is the boring part; the colored, line-by-line report is where the actionable information — *which* code is untested — actually lives.

7. **Thinking coverage measures test quality.** It measures test *reach*, never test *quality*. The honest measure of whether your tests can catch bugs is mutation testing — see [02 — Mutation Coverage](../02-mutation-coverage/junior.md) — which deliberately breaks your code to check your tests notice.

---

## Test Yourself

1. State Goodhart's law in one sentence, and explain in one more why it applies to code coverage specifically.
2. Your teammate wrote a test that calls `process_order()` and has no `assert` of any kind. It pushes a file from 80% to 100% coverage. What's wrong with it, and what does the coverage tool fail to notice?
3. A team mandates "100% coverage to merge." Name two distinct ways engineers will rationally make the number reach 100% *without* improving the test suite.
4. You open a coverage report and a block of red lines is the `handle_payment_failure()` error path. A different block of red is a one-line getter `def name(self): return self._name`. What do you do about each, and why are they different?
5. Suite A has a gamed 100%; Suite B has a thoughtful 75%. A bug is introduced into the core business logic next week. Which suite is more likely to catch it, and what's the underlying reason?
6. Why do thoughtful engineers (and Google) refuse to enforce a single global coverage threshold, even though they still use coverage every day?

<details>
<summary>Answers</summary>

1. **"When a measure becomes a target, it ceases to be a good measure."** It applies to coverage because "lines ran" is only a *loose proxy* for "code works" — so the moment you reward hitting a coverage number, people optimize the proxy (cheaply: assertion-free tests, exclusions, deleting branches) and the proxy detaches from the real goal.
2. The test verifies **nothing** — with no assertion, it can't *fail* when `process_order()` breaks, so it offers zero protection. The coverage tool only watches whether lines *executed*, not whether you *checked the result*, so it counts this hollow test as full coverage and reports a misleading 100%.
3. Any two of: (a) **assertion-free tests** that execute lines without verifying anything; (b) **`# pragma: no cover`** (or equivalent) to exclude awkward lines, shrinking the denominator; (c) **deleting hard-to-test branches** so the uncovered code no longer exists. All raise the number without adding real verification.
4. **`handle_payment_failure()`** → write a *real, asserting* test; it's a critical error path and the red just handed you a high-priority to-do. **The getter** → leave it red; testing a one-line accessor adds a maintenance burden and verifies nothing meaningful. They differ because **red is a to-do list, not a report card** — you judge each gap by whether it's a real risk, and only one of these is.
5. **Suite B (the thoughtful 75%).** Its tests *assert* on real behavior, so a change to the business logic will make a test fail. Suite A's 100% is built largely from hollow/assertion-free tests, so broken logic can stay green. Coverage measures *quantity*, not *quality* — and Suite A is high quantity, low quality.
6. Because a hard global target predictably triggers Goodhart's law — engineers game it (hollow tests, exclusions, deletions) and test *quality* drops even as the number rises. They still use coverage heavily as a **signal** (surfaced in code review to prompt "should this need a test?"), just never as a **target** that blocks merges on a percentage.

</details>

---

## Cheat Sheet

```
GOODHART'S LAW
  "When a measure becomes a target, it ceases to be a good measure."
  coverage = a LOOSE proxy ("lines ran" ≠ "code works")
  → make it a target → people optimize the proxy → number ↑, quality ↓

SIGNAL  vs  TARGET   (same %, opposite outcomes)
  SIGNAL → "what's in the red that matters?"   → read it, write real tests
  TARGET → "how do I hit the number?"          → gaming, eventually

THE THREE WAYS A TARGET GETS GAMED  (all: number ↑, quality ↓)
  1. assertion-free tests   call the line, verify NOTHING        → fake coverage
  2. # pragma: no cover     exclude the line                     → measure LESS
  3. delete the hard branch remove the scary code                → lose the safety net

THE HEALTHY WORKFLOW  (read the red, don't chase the %)
  generate the per-line report:
    pytest --cov=app --cov-report=html        # open htmlcov/index.html
    go test -coverprofile=c.out ./... && go tool cover -html=c.out
    npx c8 --reporter=html npm test
  for each RED block, ask: "Is anything IMPORTANT untested here?"
    critical path / real error branch → write a REAL asserting test
    trivial getter / generated / glue → leave it red (red is OK)
    truly unreachable                 → maybe an HONEST no-cover

THE GOLDEN RULE
  a thoughtful 75% (real assertions) > a gamed 100% (vanity metric)
  coverage measures QUANTITY (code that ran), never QUALITY (results checked)
  if the % rose but nothing NEW is verified → you gamed it, you didn't improve it
```

---

## Summary

- **Goodhart's law** is the core idea: *"when a measure becomes a target, it ceases to be a good measure."* Coverage is a *loose proxy* — "lines ran" stands in for "code works" — so the instant you make it a target, people optimize the proxy and it stops telling the truth.
- A coverage target gets **gamed** three predictable ways, each raising the number while lowering quality: **assertion-free tests** (run the line, verify nothing), **`# pragma: no cover`** (exclude awkward lines, measure less), and **deleting hard branches** (remove the scary code, lose the safety net). None of these are malice — they're the cheapest paths to a number you were told to hit.
- The same percentage means opposite things depending on whether you treat it as a **signal** (read it: "what's in the red that matters?") or a **target** (chase it: "how do I hit the number?"). Reading produces real tests; chasing produces Goodhart.
- The healthy workflow is **read the red, don't chase the percent**: open the per-line report and, for each uncovered block, ask *"is anything important untested here?"* Write real tests for the critical gaps, consciously leave trivial ones red, and let the percentage be a *side effect* of those decisions. The report is a **to-do finder**, not a grade.
- A **thoughtful 75%** built from real, asserting tests beats a **gamed 100%** that's a vanity metric — because coverage measures *quantity* (code that ran), never *quality* (results verified). This is why thoughtful teams, and Google, use coverage as a signal but refuse to enforce a single global threshold.

You now have the most important coverage skill there is: the judgment to *use* the number instead of *serving* it. Everything else in this roadmap — what coverage can't tell you, mutation testing, CI gates — sharpens that same judgment.

---

## Further Reading

- *TestCoverage* — Martin Fowler (martinfowler.com). The canonical short essay: coverage is a tool for finding untested code, "not a stick to beat developers with." Read this one first.
- *Software Engineering at Google* (Winters, Manshreck, Wright) — the testing chapters on why Google deliberately does **not** enforce a global coverage threshold, and uses coverage as a code-review signal instead.
- *Goodhart's Law* — Charles Goodhart (1975), and Marilyn Strathern's crisp reformulation ("when a measure becomes a target…"). Five minutes that reframe every metric you'll ever work with.
- The [middle.md](middle.md) of this topic, which formalizes signal-vs-target into diff coverage, the ratchet, and the politics of gates — how teams operationalize this idea without triggering Goodhart.

---

## Related Topics

- [05 — What Coverage Does *Not* Tell You](../05-what-coverage-does-not-tell-you/junior.md) — the companion page: *why* a high number proves so little (covered ≠ tested, missed edge cases, async blind spots).
- [02 — Mutation Coverage](../02-mutation-coverage/junior.md) — the honest measure of test *quality* that coverage can't give you: it breaks your code on purpose to check your tests notice.
- [04 — Coverage in CI & Diffs](../04-coverage-in-ci-and-diffs/junior.md) — how teams use coverage in CI *without* triggering Goodhart: diff coverage, the ratchet, and why a global gate backfires.
- [middle.md](middle.md) · [senior.md](senior.md) — the same topic at greater depth: operationalizing coverage-as-signal across a team and an organization.
