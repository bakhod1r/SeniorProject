# Preventing Accumulation — Junior Level

> **Roadmap:** [Technical Debt Management](../README.md) → Preventing Accumulation
> *Paying down debt is the dramatic part — the big refactor, the rewrite, the war room. But the cheapest debt is the debt you never take on. This page is about the small, boring, daily habits that stop the mess from forming in the first place.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — A Real Definition of Done](#core-concept-1--a-real-definition-of-done)
5. [Core Concept 2 — Code Review as a Debt Filter](#core-concept-2--code-review-as-a-debt-filter)
6. [Core Concept 3 — Write the Test as You Go](#core-concept-3--write-the-test-as-you-go)
7. [Core Concept 4 — The Boy Scout Rule & Broken Windows](#core-concept-4--the-boy-scout-rule--broken-windows)
8. [Core Concept 5 — Small Pull Requests](#core-concept-5--small-pull-requests)
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

> Focus: **How do I stop debt from piling up in the first place?**

There are two ways to deal with technical debt. You can let it accumulate and then pay it down later — the subject of [05 — Paying Down Debt](../05-paying-down-debt/junior.md), with its refactors and rewrites and dedicated cleanup sprints. Or you can stop most of it from ever landing. This page is about the second way, and here is the uncomfortable truth: the second way is *far* cheaper, and almost nobody does it well.

Why is prevention cheaper? Go back to the metaphor. Debt charges **interest** — every time you touch tangled code it costs you a little extra, and that little extra compounds for as long as the code lives. Debt you *prevent* never starts charging. You don't pay interest on a loan you didn't take. A messy function caught in code review and fixed in five minutes costs five minutes. The same messy function discovered eighteen months later — after three people built on top of it, after it grew two callers and a subtle bug — costs an afternoon of careful, scared refactoring. Same mess, very different price, and the only difference is *when* you dealt with it.

The good news: prevention is not a heroic act. It's a handful of small habits, repeated. A real Definition of Done so "done" means *done*, not "it ran once on my laptop." A second pair of eyes on every change. A test written *with* the code instead of "later" (which means never). And a shared instinct to leave each file a little cleaner than you found it — because, as we'll see, one tolerated mess quietly invites the next.

> **The mindset shift:** stop asking "how do we clean up this debt?" and start asking "how do we avoid taking it on?" The cheapest debt is the debt you never start paying interest on. Every habit on this page is a way to refuse a loan before it's issued.

---

## Prerequisites

- **Required:** You understand the debt metaphor at a basic level — **principal** (the shortcut you took) vs **interest** (the recurring cost it imposes). If not, read [01 — What Is Technical Debt](../01-what-is-technical-debt/junior.md) first.
- **Required:** You've worked on a shared codebase with at least one other person and opened a pull request (PR).
- **Helpful:** You've experienced the pain — inherited a file nobody wanted to touch, or shipped something that "worked on your machine" and broke elsewhere.
- **Helpful:** You've written at least one automated test, even a trivial one.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Technical debt** | The recurring cost of code that's harder to change than it should be. |
| **Principal** | The original shortcut or messy bit — the "loan." |
| **Interest** | The extra cost you pay *every time* you work near that code. |
| **Definition of Done (DoD)** | The team's shared, written checklist for when a task is truly finished. |
| **Code review** | A teammate reading your change *before* it merges, to catch problems. |
| **Pull request (PR) / merge request** | A proposed change, packaged for review and merging. |
| **Boy Scout Rule** | "Always leave the code cleaner than you found it." |
| **Broken windows** | The idea that one visible, tolerated mess invites more mess. |
| **Test-as-you-go** | Writing the test alongside the code, not "later." |
| **Quality gate** | An automatic check (tests, linter, coverage) a change must pass to merge. |

---

## Core Concept 1 — A Real Definition of Done

Ask five engineers on a team when a task is "done" and you'll often get five answers: *it compiles*, *it works on my machine*, *I pushed it*, *the happy path works*, *I demoed it*. Every gap between those answers is a place for debt to slip in. The fix is a **Definition of Done (DoD)**: one written, shared checklist that the whole team agrees on, so "done" means the same thing for everyone.

A weak, implicit definition of done sounds like this:

```
"Done" = it runs on my machine and I pushed the branch.
```

That definition *manufactures* debt. The error case nobody handled, the test nobody wrote, the `TODO: clean this up` nobody came back to — all of it is now in the codebase, charging interest, because "done" never required dealing with it.

A real DoD makes the invisible requirements explicit. A reasonable starter for a junior team:

```
DEFINITION OF DONE — a change is not "done" until:
  [ ] The code does what the ticket asked (happy path AND the obvious error cases)
  [ ] Automated tests cover the new behavior, and the whole suite passes
  [ ] The linter/formatter passes — no new warnings
  [ ] No leftover debugging junk (print statements, commented-out code, dead branches)
  [ ] A teammate has reviewed and approved it
  [ ] It's documented enough that the next person understands it (a comment, a README line)
```

Notice what this does. It moves cleanup, testing, and error handling from "things I might do if I have time" to "things that are *part of the work*." You wouldn't say a meal is "cooked" if it's still raw in the middle; a real DoD says a feature isn't "done" if it's raw in the middle either.

The DoD is also a kindness to *you*. Without it, "should I write the test?" is a decision you re-litigate every single time, usually under deadline pressure, usually losing. With it, the decision is already made — it's on the checklist — so you just do it and move on. Good habits work best when they're not optional.

> **Key insight:** Most debt isn't created by a dramatic bad decision. It's created by an *unclear* one — by "done" quietly meaning "the happy path runs." A written Definition of Done turns a hundred tiny implicit choices into one explicit standard, and that's where prevention starts.

---

## Core Concept 2 — Code Review as a Debt Filter

You cannot see your own blind spots — that's what makes them blind spots. The shortcut you took at 6 p.m. felt reasonable *to you* at 6 p.m. A teammate reading it fresh the next morning sees instantly that the function is doing three things, that the variable is named `data2`, that the error is being swallowed. **Code review** is a second pair of eyes on every change *before it merges* — and it is one of the cheapest, highest-leverage debt filters a team has.

The key word is *before*. Review catches the shortcut while it's still one small diff that nobody has built on yet. That's the moment fixing it is trivial — the author still has the whole change in their head, no other code depends on it, and "could you split this function in two?" is a five-minute edit. Wait, and that same fix means untangling everything that grew on top.

Good review feedback at this level is concrete and kind:

```
✗ Vague:    "This is messy."
✓ Specific: "handleRequest() is doing validation, the DB write, AND
             formatting the response — three jobs. Could we split out
             validateInput()? It'll be easier to test."

✗ Vague:    "Needs tests."
✓ Specific: "What happens if `user` is nil here? Worth a test for that
             case — looks like it'd panic right now."
```

Review is not a gate where a senior person blocks juniors. It's a **conversation that spreads knowledge**: the author learns a cleaner pattern, the reviewer learns what's changing in the codebase, and the team slowly converges on a shared sense of "how we do things here." Even as a junior, *you* should review other people's code — fresh eyes catch real things, and reading good code is one of the fastest ways to learn.

What review catches that an automatic check can't: a linter can tell you a line is too long, but only a human can tell you the *approach* is going to be painful to extend, that the abstraction is wrong, that there's a much simpler way. That judgment is exactly the kind of debt that's expensive to discover later.

> **Key insight:** The cheapest moment to remove debt is the moment *before it merges*, while it's still one small, isolated diff. Code review is the team's standing appointment with that moment. Skip review and you've removed the one filter that catches the shortcut while it's still cheap to fix.

---

## Core Concept 3 — Write the Test as You Go

Here's a sentence worth memorizing: **untested code is debt.** Not "might become debt" — *is* debt. Code with no test around it can't be changed with confidence, because nothing tells you when you've broken it. So every time someone needs to modify it, they either move slowly and nervously, or they move fast and break something. Both are interest payments. The principal is the missing test.

The cheapest time to write that test is *while you write the code* — when the behavior is fresh in your head, when you still remember the edge cases, when you're already thinking about what the function is supposed to do. The most expensive time is "later," which in practice means **never**, because "later" arrives under a new deadline with the original context long forgotten.

```
"I'll add tests later"  →  later never comes  →  the code ships untested
                        →  untested code is debt  →  interest starts immediately
```

"Test-as-you-go" doesn't require test-driven development or any ceremony. The minimum habit is simply: when you write a function, write a test for it *before you move on to the next thing*. A few small tests for the function you just wrote:

```python
def discount(price, percent):
    if percent < 0 or percent > 100:
        raise ValueError("percent must be 0..100")
    return price * (1 - percent / 100)

# written in the same sitting, while the rules are fresh:
def test_discount_basic():        assert discount(100, 20) == 80
def test_discount_zero():         assert discount(100, 0) == 100
def test_discount_rejects_bad():
    with pytest.raises(ValueError):
        discount(100, 150)
```

That test does three jobs at once, all of them prevention. It **proves** the code works now. It **documents** what the function is supposed to do (the test *is* a usage example). And it **protects** the next person — the moment someone breaks `discount`, a red test tells them, instead of a customer telling them. The test is a tripwire you set for your future self, and it costs almost nothing to set *now*.

> **Key insight:** A test written with the code costs minutes and pays back for the life of the code. A test "added later" usually costs nothing — because it's never written — and the code quietly becomes the thing nobody dares to change. Treat the test as part of writing the function, not a chore after it.

---

## Core Concept 4 — The Boy Scout Rule & Broken Windows

Two famous ideas, and they're two sides of the same coin.

**The Boy Scout Rule** (popularized by Robert C. Martin from the scouting motto) is: *"Always leave the code cleaner than you found it."* Not "rewrite the file." Not "fix everything." Just: when you're in there making a change, leave that corner a *little* better than you found it. Rename one confusing variable. Delete the dead code you noticed. Add the comment that would have saved you ten minutes. Extract the one function that was too long.

```
Touched a file to fix a bug?
  → also: rename `tmp` to `pendingOrders`        (10 seconds)
  → also: delete the commented-out block above it (5 seconds)
  → also: add a test for the bug you just fixed   (2 minutes)
Leave it cleaner than you found it.
```

The magic is in the *math*. No single cleanup is heroic, but the codebase is touched constantly, and tiny improvements compound the same way interest does — except in your favor. A codebase where everyone follows the rule gets *cleaner over time without anyone scheduling a cleanup*. That's prevention turned into a default behavior.

**Broken windows** is the same coin, flipped. The idea (borrowed from a theory about urban decay) is: *one visible, tolerated mess invites the next one.* A building with one broken window left unrepaired soon has more — the broken window signals "nobody cares here, so anything goes." Code works identically. The first `// TODO: hack, fix this` that survives a review tells the next person hacks are acceptable here. The first swallowed error, the first untested module, the first 600-line function — each one lowers the bar for the next, and standards erode quietly until "this is fine" means something much worse than it used to.

```
A tidy codebase:    a mess STANDS OUT  →  people instinctively keep it clean
A messy codebase:   one more mess BLENDS IN  →  why bother? decay accelerates
```

The two rules together form a feedback loop you choose the direction of. Boy Scout Rule pushes *up*: small fixes, constantly, so messes don't survive. Avoiding broken windows keeps the bar *high*: don't tolerate the first mess, because the first one is permission for the rest. Keep the codebase tidy enough that a new mess looks out of place — then your own discomfort does the policing for you.

> **Key insight:** Cleanliness is contagious in both directions. A tidy codebase keeps itself tidy because messes are visible and embarrassing; a messy one rots faster because one more mess doesn't show. You're not just fixing one variable when you follow the Boy Scout Rule — you're keeping the *bar* high enough that everyone else keeps theirs high too.

---

## Core Concept 5 — Small Pull Requests

Almost every prevention habit on this page gets easier — or harder — depending on one variable: **the size of your pull requests.** A small PR is the quiet enabler of all the rest, and a giant PR sabotages every one of them.

Picture the reviewer. Faced with a 40-line PR, they read every line, think hard, and leave real feedback. Faced with a 2,000-line PR, they skim, type "LGTM" (looks good to me), and approve — because reviewing it *properly* would take hours they don't have. The big PR didn't get more scrutiny for being big; it got **less**. Every shortcut buried in those 2,000 lines sailed straight through the one filter meant to catch it.

```
Small PR (≈ tens of lines):
  reviewer reads it all → real feedback → debt caught before merge → safe to revert

Huge PR (thousands of lines):
  reviewer skims → "LGTM" → debt sails through → too scary to ever revert
```

Small PRs help prevention in concrete ways:

- **Review actually works.** A change a person can hold in their head gets read; one they can't gets rubber-stamped. Real review is the debt filter from Concept 2 — small PRs are what keep it functioning.
- **Tests stay focused.** A small change is easy to test thoroughly. A sprawling one tempts you to test "the important parts" and skip the rest — and the skipped rest is debt.
- **Mistakes are cheap to undo.** If a 50-line PR causes a problem, you revert it cleanly. A 2,000-line PR tangled into everything else is too scary to revert, so you patch around the problem — and patching-around is interest.
- **You ship cleaner increments.** Small PRs force you to break work into coherent steps, which tends to produce clearer, more deliberate code than one giant "do everything" dump.

How do you keep PRs small? Break the work down *before* you start coding. Separate refactoring from feature work — if you need to clean something up to make room for a feature, do the cleanup in its *own* PR first ("make the change easy, then make the easy change"). Merge often. A PR that touches one thing, for one reason, is a PR a human can actually review — and reviewable is the whole point.

> **Key insight:** PR size silently controls the quality of your review. A reviewer's attention doesn't scale with diff size — past a point it *collapses*, and the biggest, riskiest changes get the least scrutiny. Small PRs aren't bureaucratic neatness; they're what keep your single best debt filter working.

---

## Real-World Examples

**1. The "I'll add tests later" module that nobody could touch.** A junior ships a payments module fast, under deadline, with a note in the PR: "tests to follow." The PR is approved — everyone's busy. "Later" never comes. Eighteen months on, the module is the most-feared file in the codebase: it handles real money, has zero tests, and three features now depend on it. A one-line change requires a day of manual testing because nothing else can confirm it still works. The principal was a few hours of tests never written; the interest has been paid by every engineer who's touched it since. Test-as-you-go would have cost an afternoon back then and saved years of dread.

**2. The broken window that became a wall.** One PR slips through with a swallowed error: `catch (e) { /* ignore */ }`. It's "just one." Six months later a code search turns up *thirty* of them — every engineer who hit an inconvenient error copied the pattern they'd seen, because the first one made it look acceptable. Debugging anything is now a nightmare; failures vanish silently. The first broken window wasn't expensive on its own. It was expensive because it was *permission*. Refusing that first one in review — "let's at least log this" — would have stopped the whole wall.

**3. The giant PR that got a rubber stamp.** A developer works two weeks on a branch and opens a 3,000-line PR touching forty files. The reviewer glances at it, sees it's enormous, and approves with "LGTM, too big to review in detail 😅." Buried inside: a hard-coded credential, a copy-pasted helper that now exists in four places, and an unhandled edge case. All three were exactly what review exists to catch — and all three merged untouched, because the PR was too big to actually review. Three small PRs over those two weeks would have caught every one of them.

---

## Mental Models

- **Prevention is interest you never start paying.** Paying down debt stops a meter that's already running. *Preventing* debt means the meter never starts. The five-minute fix in review versus the afternoon refactor a year later is the same mess at two prices — and the only variable is *when*.

- **Definition of Done is a contract with your future self.** Without it, "is this really finished?" is a fresh decision every time, made under pressure, usually answered "good enough." With it, the answer is already written down — so you just follow it. Good habits should be defaults, not daily debates.

- **A test is a tripwire for your future self.** You set it cheaply, now, while the context is fresh. It sits silently until someone — maybe you — breaks the behavior, and then it trips. Untested code has no tripwires, so the break is discovered by a user instead of a test.

- **Cleanliness is contagious (both ways).** Boy Scout Rule and broken windows are one feedback loop. Keep things tidy and messes stand out, so people clean them. Let one mess stand and it blends in, so the next one feels fine. You choose which direction the loop spins.

- **PR size is the dial on review quality.** Turn it small and review works — every line gets read. Turn it large and review collapses into a rubber stamp. The riskiest changes get the least scrutiny exactly when they're biggest. Keep the dial low.

---

## Common Mistakes

1. **Saying "I'll add tests later."** Later doesn't come. Untested code *is* debt the moment it merges, and it starts charging interest immediately. Write the test in the same sitting as the code, or accept that you're shipping a loan.

2. **Treating "done" as "it runs on my machine."** The happy path running is the *start* of done, not the end. Error cases, tests, cleanup, and a review are part of the work — a written Definition of Done is what makes that non-negotiable instead of optional.

3. **Rubber-stamping reviews (or skipping them under deadline).** "LGTM" without reading is worse than no review — it gives false confidence that a human checked. Review is your cheapest debt filter; an unread review filters nothing.

4. **Tolerating the first broken window.** "It's just one swallowed error / one TODO / one hack" ignores that the first one is *permission* for the rest. Standards erode from the first tolerated exception. Hold the line early, while it's still one.

5. **Opening giant pull requests.** A PR too big to review properly *will not be* reviewed properly. Past a few hundred lines, reviewer attention collapses. Break work into small, single-purpose PRs that a human can actually read.

6. **Mixing refactoring into a feature PR.** When cleanup and new behavior are tangled in one diff, the reviewer can't tell which lines do what, and both get less scrutiny. Do the cleanup in its own PR first — "make the change easy, then make the easy change."

7. **Thinking prevention is someone else's job.** Prevention isn't owned by seniors or a "quality team." It's a thousand small choices made by whoever is typing — including you, including today. Every habit here is one you can practice on your very next PR.

---

## Test Yourself

1. In one sentence, why is preventing debt cheaper than paying it down later? Use the words *interest*.
2. Your team's Definition of Done is "the code runs and I pushed it." Name two things that definition lets slip through, and how they become debt.
3. Why is the *moment before a PR merges* the cheapest time to remove debt? What makes it more expensive later?
4. A teammate writes "I'll add tests later" on their PR. Why is that risky, and what would you suggest instead?
5. Explain the broken-windows idea in your own words, with one code example of a "first broken window."
6. A colleague opens a 2,500-line PR. Why is this a problem *for prevention specifically* — what does it do to code review?

<details>
<summary>Answers</summary>

1. Prevented debt never starts charging **interest**, while debt paid down later has been charging interest the whole time it sat there — so you avoid not just the principal but every compounding interest payment in between.
2. It lets through (a) **missing tests** — code with no test is debt, because nobody can change it safely later; and (b) **unhandled error cases / leftover debugging junk** — the happy path "runs," so the messy edges and `print` statements merge and start charging interest. (Other valid answers: no review, no documentation.)
3. Before merge, the change is still **one small isolated diff** with nothing built on top of it and the author holding the full context — so a fix is a quick edit. Later, other code depends on it, the author has forgotten the details, and fixing it means untangling everything that grew around it.
4. "Later" almost always means **never** (a new deadline arrives, context is lost), so the code ships untested and becomes the file nobody dares to change. Suggest writing the tests **now, in the same PR**, while the behavior is fresh — test-as-you-go.
5. One visible, tolerated mess signals "standards are low here," which invites more mess until decay accelerates. Example first window: `catch (e) { /* ignore */ }` — a swallowed error that, once it survives review, teaches everyone else that swallowing errors is acceptable here.
6. A 2,500-line PR is too big to review properly, so the reviewer **skims and rubber-stamps it** ("LGTM") instead of reading it. That disables code review — the team's main debt filter — exactly when the change is biggest and riskiest, so any shortcuts inside sail straight through.

</details>

---

## Cheat Sheet

```
WHY PREVENT (not just pay down)
  prevented debt = interest you NEVER START paying
  5-min fix in review  vs  afternoon refactor a year later  = same mess, when differs

DEFINITION OF DONE  — "done" ≠ "runs on my machine"
  [ ] does what the ticket asked (happy path + obvious errors)
  [ ] tests cover new behavior; whole suite passes
  [ ] linter/formatter clean; no new warnings
  [ ] no debug junk / commented-out code / dead branches
  [ ] reviewed & approved by a teammate
  [ ] understandable to the next person (comment / README line)

CODE REVIEW = the debt filter
  catch the shortcut BEFORE merge, while it's one small diff
  feedback: specific + kind  (not "messy" → "split out validateInput()")
  YOU review others too — fresh eyes catch real things

TEST-AS-YOU-GO
  untested code IS debt (not "might be")
  write the test WITH the code; "later" = never
  a test = proof + documentation + tripwire for your future self

BOY SCOUT  ↑   leave each file a little cleaner than you found it (tiny, constant)
BROKEN WINDOWS ↓   one tolerated mess invites the next — hold the line early
  → keep it tidy so a new mess STANDS OUT

SMALL PRs (the enabler of all the above)
  small  → reviewer reads it all → debt caught → easy to revert
  huge   → "LGTM" rubber stamp   → debt sails through → too scary to revert
  separate refactor from feature: make the change easy, THEN make the easy change
```

---

## Summary

- **Prevention beats cure** because prevented debt never starts charging **interest**. The same mess costs five minutes in review or an afternoon a year later — the only variable is *when* you deal with it, and earlier is always cheaper.
- A real **Definition of Done** turns a hundred implicit "is this finished?" decisions into one written standard, so "done" means tested, cleaned-up, reviewed, and documented — not "it ran on my machine."
- **Code review** is the team's cheapest debt filter: a second pair of eyes catches the shortcut *before it merges*, while it's still one small, isolated diff that's trivial to fix.
- **Test-as-you-go** because untested code *is* debt. A test written with the code costs minutes and acts as proof, documentation, and a tripwire for the future; a test "added later" is usually never written at all.
- The **Boy Scout Rule** (leave it cleaner than you found it) and **broken windows** (one mess invites the next) are one feedback loop. Tiny constant cleanups compound upward; one tolerated mess erodes the bar downward. Keep things tidy enough that new messes stand out.
- **Small pull requests** quietly enable everything else — real review, focused tests, cheap reverts. Reviewer attention collapses past a point, so the biggest changes get the least scrutiny. Keep PRs small and single-purpose.

None of these are heroic. They're small habits, repeated — and repeated small habits are exactly what keep a codebase from accumulating the debt that everyone else will spend years paying down.

---

## Further Reading

- *Clean Code* (Robert C. Martin) — the chapter that popularized the **Boy Scout Rule**; short and direct on why small, constant cleanup compounds.
- *The Pragmatic Programmer* (Hunt & Thomas) — the **"Don't Live with Broken Windows"** section; the original software take on the broken-windows idea.
- *Working Effectively with Legacy Code* (Michael Feathers) — defines legacy code as *code without tests*, which is exactly the "untested code is debt" idea from Concept 3.
- "Make the change easy, then make the easy change" — Kent Beck's famous tweet; the one-line case for separating refactoring from feature work in [05 — Paying Down Debt](../05-paying-down-debt/junior.md).
- The [middle.md](middle.md) of this topic, which turns these habits into team-level mechanics — automated quality gates, what to enforce in CI, and how to make "done" machine-checkable.

---

## Related Topics

- [middle.md](middle.md) — the same prevention ideas as enforceable team policy: quality gates, CI checks, fitness functions.
- [senior.md](senior.md) — prevention as culture and economics: a debt budget that holds the line, and getting an org to fund "don't take the loan."
- [05 — Paying Down Debt](../05-paying-down-debt/junior.md) — the other half: what to do about the debt that *did* accumulate.
- [01 — What Is Technical Debt](../01-what-is-technical-debt/junior.md) — the metaphor (principal vs interest) every habit here is built on.
- [03 — The Debt Quadrant](../03-the-debt-quadrant/junior.md) — telling deliberate, prudent debt apart from the reckless kind prevention targets.
- [Code Review](../../code-review/) — the dedicated roadmap for doing the Concept 2 debt filter well.
- [Quality Gates](../../quality-gates/) — automating the Definition of Done so checks run on every change, not just when someone remembers.
