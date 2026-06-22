# What to Look For & In What Order — Junior Level

> **Roadmap:** [Code Review](../README.md) → What to Look For & In What Order
> *A pull request is not an essay to read top-to-bottom and annotate. It's a problem to triage: figure out what could go wrong, in order of how much it matters, and stop wasting the first comment on a misplaced semicolon.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — What Review Is For (and What It Isn't)](#core-concept-1--what-review-is-for-and-what-it-isnt)
5. [Core Concept 2 — The Order of Operations](#core-concept-2--the-order-of-operations)
6. [Core Concept 3 — Read the Tests First](#core-concept-3--read-the-tests-first)
7. [Core Concept 4 — The Diff Lies; Read the Change](#core-concept-4--the-diff-lies-read-the-change)
8. [Core Concept 5 — Severity: Blocker vs Nit](#core-concept-5--severity-blocker-vs-nit)
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

> Focus: **When a PR lands in your queue, what do you actually look at, and in what order?**

You've been added as a reviewer on a pull request. Forty files, six hundred lines of red and green. The instinct — the one almost everyone starts with — is to read it from the top, and the moment something looks off, leave a comment. By line 30 you've flagged a variable name you don't love. By line 200 you've forgotten what the change was even *for*. You approve, because it "looked fine," and three days later it breaks in production on an empty-list input nobody checked.

That failure isn't a knowledge gap. You *could* have caught it. It's a **method** gap: nobody taught you that reviewing is an ordered process, not a linear read. A good review answers a specific sequence of questions — *Is this the right change? Does it actually work? Is it built sensibly? Do the tests prove it? Can the next person read it?* — and it answers them **in that order**, because a problem at the top makes the problems at the bottom irrelevant. If the change solves the wrong problem, who cares about the variable name.

This page teaches that order as a checklist a junior can literally follow. It also teaches the two tricks that catch the most bugs for the least effort — read the tests first, and don't trust the diff — and how to label your comments so the author knows what's a must-fix versus a take-it-or-leave-it.

> **Mindset shift:** A review is **triage by importance**, not a top-to-bottom read. You are not proofreading the file; you are ranking what could go wrong and spending your attention where the risk is. Catch the production bug first, the missing test second, the naming nit last — and be at peace with leaving some nits unsaid.

---

## Prerequisites

- **Required:** You've opened a pull request on GitHub, GitLab, or similar, and you can see a diff (the red/green view of what changed).
- **Required:** You can read the programming language of the code you'll review well enough to follow the logic. (Examples here use **Go**, but the method is language-agnostic.)
- **Helpful:** You've *written* a PR and received review comments — so you know what it feels like on the other side.
- **Helpful:** Your team runs a linter or formatter (e.g., `gofmt`, ESLint, Black) in CI. If it doesn't, that's worth fixing, because half of what untrained reviewers comment on is the linter's job.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Pull request (PR)** | A proposed change to the codebase, packaged up for review before it's merged. Called a "merge request" (MR) on GitLab. |
| **Diff** | The red/green view: lines removed (red) and added (green). What changed — *not* the whole file. |
| **Reviewer** | You — the person asked to read the PR and approve, request changes, or comment. |
| **Author** | The person who wrote the PR and is waiting on your review. |
| **Approve / LGTM** | "Looks Good To Me" — your sign-off that the change is safe to merge. |
| **Request changes** | A formal "no, not yet" — the PR shouldn't merge until something is fixed. |
| **Blocker** | A comment that *must* be resolved before merge. A real defect, a missing test for risky code, a broken contract. |
| **Nit** (short for *nitpick*) | A tiny, optional suggestion. The author can take it or ignore it. Always labelled `nit:`. |
| **Edge case** | An unusual but valid input the code must handle: empty list, zero, negative number, `null`, max value. |
| **Contract** | What a function *promises*: given these inputs, it returns/does that. Tests are the contract written down. |
| **Scope** | What the PR is *supposed* to change — and, just as importantly, what it should leave alone. |

---

## Core Concept 1 — What Review Is For (and What It Isn't)

Before the *how*, the *why* — because the purpose decides what you look for.

Code review exists to do four things:

1. **Find defects** before they reach users — bugs, missing edge cases, security holes.
2. **Keep the design coherent** — make sure the change fits the codebase instead of bolting on a fifth way to do the same thing.
3. **Spread knowledge** — now two people understand this code, not one. The author learns from your questions; you learn the part of the system you reviewed.
4. **Create shared ownership** — once you approve, it's *the team's* code, not "Priya's code." Nobody is the single point of failure.

And it is emphatically **not** for:

- **Policing style.** Tabs vs spaces, import order, line length — that's the **formatter's** job and the **linter's** job, run automatically in CI. If you're typing a comment a tool could have typed, stop and go configure the tool.
- **Gatekeeping or showing off.** Review is not a hazing ritual or a chance to prove you're the smartest person on the thread.
- **Rewriting the code your way.** If the code is correct, clear, and fits the codebase, "I would have used a map here" is not a reason to block it. There are many right answers. Yours is one of them.

> **Key insight:** The goal of a review is to **improve the codebase's health over time** while letting good changes ship. Google's engineering practices state it directly: a reviewer should approve a PR once it *definitely improves the overall code health*, even if it isn't perfect. "Not how I'd do it" is not "not good enough." Perfection is the enemy of merged.

A quick gut-check before you type any comment: *Is this about whether the code is correct, well-designed, tested, and readable — or is it about my personal taste?* If it's taste, either drop it or mark it `nit:` and move on.

---

## Core Concept 2 — The Order of Operations

Here is the whole method. Six steps, top of the list to bottom, **most important first**. You answer each before moving on, because a failure high up cancels everything below it.

```text
1. GOAL         → Is this even the right change? (read the description + linked issue)
2. CORRECTNESS  → Does it actually do what it claims? Edge cases? Errors?
3. DESIGN       → Is it built in a sensible shape that fits the codebase?
4. TESTS        → Do they prove it works and cover the risky parts?
5. READABILITY  → Can the next person understand it in six months?
6. STYLE        → Leave it to the formatter/linter. Last, and mostly automated.
```

Walk through each.

**1. Understand the GOAL first.** Read the PR description and the linked issue *before* you read a single line of code. What problem is this solving? Is *this* the right way to solve it? Sometimes the best review comment is "this works, but issue #412 asked for X and this does Y" — and you've saved everyone from shipping the wrong thing. You cannot judge whether code is correct until you know what "correct" *means* for this change.

**2. CORRECTNESS.** Does the code do what the description says? Now hunt the edge cases — the inputs that break naive code:

```go
func Average(nums []int) int {
    sum := 0
    for _, n := range nums {
        sum += n
    }
    return sum / len(nums)   // what if nums is empty? → divide by zero → panic
}
```

The happy path (a list of numbers) works. The empty-list path crashes. **Correctness review is mostly the discipline of asking "what about the empty / zero / null / negative / huge / concurrent case?"** A good comment here:

```text
What happens when nums is empty? len(nums) is 0, so this panics on
divide-by-zero. Should it return 0, or an error?
```

**3. DESIGN.** Step back from the lines and look at the shape. Is this function in the right place? Does it duplicate something that already exists three folders over? Does it fit the patterns the codebase already uses, or invent a new one for no reason? Design problems are more expensive than bugs because they spread — but you can only see them once you stop reading line-by-line and look at the structure.

**4. TESTS.** Do tests exist for this change? Do they cover the *risky* parts (the edge cases from step 2), not just the happy path? A PR that adds logic but no tests is a yellow flag; a PR that *changes* logic and touches no tests is a red one. (More on this in the next concept.)

**5. READABILITY.** Forget yourself — you have all the context right now. Will the person who opens this file in six months, with none of that context, understand it? Confusing name, a clever one-liner that takes five minutes to decode, a missing comment on a *why* that isn't obvious from the *what* — those are legitimate.

**6. STYLE — last, and barely.** Formatting, spacing, import order. If CI runs a formatter, you should be writing approximately **zero** style comments, because the tool already fixed it. Style is at the bottom of the list on purpose: it matters least and a machine does it better.

> **Key insight:** The order is **load-bearing**, not decorative. If the change solves the wrong problem (step 1), nothing about its naming (step 5) matters — it shouldn't merge at all. Reviewing in order means you find the expensive problems first and never waste a careful naming critique on code that's about to be rewritten.

---

## Core Concept 3 — Read the Tests First

The single highest-leverage trick in this whole page: **read the test file before the implementation.**

Why? Because tests answer the two questions you most need answered, faster than the code can:

1. **What did the author *intend*?** A test is the author saying, in executable form, "here is exactly what this code should do." `TestAverage_EmptyList_ReturnsZero` tells you the *intended* contract in one line — before you've read the function.
2. **What's the contract?** The set of tests *is* the specification. Reading them tells you the inputs that matter and the expected outputs, which is exactly the map you need to then check correctness.

So the move is: open the test file, read the test names and assertions, and *build a mental model of what this is supposed to do*. Then go read the implementation and check whether it actually delivers that — and whether the tests missed anything.

Two specific red flags to train your eye on:

**Missing tests for risky code.** New logic with no test is a gap. Say so plainly:

```text
There's no test for the empty-input case here, which is exactly the
path most likely to break. Can we add one?
```

**A test that asserts nothing.** This is worse than no test, because it gives false confidence — it's green, so people trust it, but it proves nothing:

```go
func TestAverage(t *testing.T) {
    result := Average([]int{2, 4, 6})
    _ = result   // ← computed a value, asserted NOTHING. This test is a lie.
}
```

That test passes whether `Average` returns `4`, `0`, or `9999`. It tests that the function *doesn't crash*, and nothing more. Flag it:

```text
This test calls Average but never asserts on the result, so it'd pass
even if the math were wrong. Should assert result == 4.
```

> **Key insight:** Tests are the author's intent made executable. **Reading them first turns a wall of unfamiliar code into a checklist** — you know what it's supposed to do before you judge whether it does. And two test smells matter most at any level: *missing* tests on the risky paths, and tests that *assert nothing* (green, but proving zero). A test that can't fail is not a test; it's decoration.

---

## Core Concept 4 — The Diff Lies; Read the Change

The diff is a trap. That neat red/green view shows you the *lines that changed* — but a change is not its lines. A change is what those lines *do* in the context of everything around them, and the diff deliberately hides that context.

Consider this innocent-looking diff:

```diff
  func (a *Account) Withdraw(amount int) error {
-     if amount > a.balance {
+     if amount >= a.balance {
          return ErrInsufficientFunds
      }
      a.balance -= amount
      return nil
  }
```

One character changed: `>` became `>=`. The diff makes it look trivial. But now withdrawing your *entire* balance fails — `amount >= a.balance` is true when they're equal, so emptying the account is suddenly an error. Is that intentional? You **cannot tell from the diff alone.** You'd have to look at the surrounding code, the tests, and maybe the issue to know whether this is a bug fix or a brand-new bug.

The lesson: when a diff doesn't give you enough to judge correctness, **go get more context.** Concretely:

- **Open the surrounding file** (most tools let you expand the lines above and below, or view the whole file). A three-line change can break a function thirty lines up.
- **Pull the branch and read it locally** in your editor, with jump-to-definition, when the change spans many files and the web diff isn't enough.
- **Actually run it** when behavior is hard to read from code — especially **UI changes**. A diff of CSS or a React component tells you almost nothing about whether the button is now centered or off-screen. Check it out, run it, look at it.

```bash
# When the diff isn't enough — pull the PR branch and see for yourself
git fetch origin pull/482/head:review-482
git checkout review-482
go test ./...        # do the tests actually pass?
go run ./cmd/app     # for UI/behavior, look at it with your own eyes
```

> **Key insight:** The diff shows **what lines changed**; your job is to understand **what behavior changed** — and those are not the same thing. A one-character diff can be a one-character bug. When the little red/green view can't answer "is this correct?", expand the context, pull the branch, or run it. Reviewing UI from a diff alone is reviewing blind.

---

## Core Concept 5 — Severity: Blocker vs Nit

Not every comment carries the same weight, and if you leave thirty comments with no indication of which ones *matter*, the author has to guess — and they'll guess wrong, either blocking on your trivial preference or merging past your real concern.

So **label every comment by severity.** At junior level, two buckets are enough:

- **Blocker (must fix).** The PR should not merge until this is resolved. A real defect, a missing test on a risky path, a broken contract, a security hole. State it as such, plainly.
- **Nit (optional).** A small suggestion the author is free to ignore. A nicer name, a tidier line, a personal preference. Prefix it literally with `nit:` so it's unmistakable.

```text
BLOCKER:
  This panics on empty input (divide-by-zero). Needs a guard or an
  error return before this can merge.

NIT:
  nit: `n` could be `count` for readability — not blocking, your call.
```

The `nit:` prefix is a real, widely-used convention. It does two jobs: it tells the author "you may ignore this freely," and it tells *you* "if all I have left are nits, this PR is basically done — approve it." A pile of nits is not a reason to request changes.

Many teams add finer labels later — `suggestion:`, `question:`, `praise:`, even formal severities like P0/P1/P2. You'll meet those at the next tier. For now, the discipline that matters is simply **separating the must-fix from the nice-to-have**, every single time.

> **Key insight:** An unlabelled comment is an ambiguous comment. **Mark what blocks merge and what doesn't** — the author shouldn't have to reverse-engineer how serious you are. And the corollary: *if your only remaining comments are nits, approve the PR.* Don't hold good work hostage to your preferences.

A word on **review fatigue**, gently: you genuinely cannot review 1,000 lines well in one sitting. Attention drops, and past a few hundred lines reviewers start rubber-stamping — eyes glazing, "LGTM" with no real inspection. This is why **small PRs get better reviews** and big ones get waved through. As a reviewer, it's fair to ask an author to split a giant PR. As an author, keep them small. (The whole topic of right-sizing is [02 — PR Scope & Size](../02-pr-scope-and-size/junior.md).)

---

## Real-World Examples

**1. The top-to-bottom review that missed the bug.** A reviewer reads a 400-line PR linearly, leaves eight comments — six of them about naming and formatting — and approves. The change shipped a divide-by-zero on empty input that any *correctness-first* pass would have caught in the first two minutes. The reviewer spent all their attention on step 5 and 6 of the order and never really did steps 1–4. The lesson isn't "read more carefully"; it's "read in the right order."

**2. The tests-first save.** Reviewing an unfamiliar payments module, a junior opens the test file first. The test names describe refunds, partial refunds, and currency conversion — but there's *no* test for a refund larger than the original charge. They go to the implementation: sure enough, an over-refund isn't guarded, and the account could go negative. One comment — *"no test for over-refund; the code doesn't guard it either"* — catches a money bug, found by reading tests, not code.

**3. The diff that hid a UI disaster.** A CSS change looked fine in the diff: a few property tweaks, all reasonable in isolation. The reviewer approved on the diff alone. On staging, the change had pushed the checkout button off the bottom of the mobile viewport — invisible, unclickable. A diff cannot show you a rendered page. Pulling the branch and looking at it on a phone-sized window would have caught it in ten seconds.

**4. The nit that wasn't labelled.** A reviewer left a comment — "I'd extract this into a helper" — with no `nit:` and no "non-blocking." The author read it as a blocker, spent an hour on a refactor the reviewer didn't actually need, and the PR slipped a day. Two characters (`nit:`) would have prevented the whole thing.

---

## Mental Models

- **Review is triage, not proofreading.** A medic in a busy ER doesn't treat patients in the order they walked in; they treat the most life-threatening first. Same here: address the production bug before the awkward variable name. The order of importance *is* the method.

- **The order of operations is a waterfall — water at the top can't be saved by the bottom.** If the change solves the wrong problem (step 1), perfect naming (step 5) is irrelevant. Answer the top questions first; a "no" up high ends the review early and cheaply.

- **Tests are the spec written in code.** Don't reverse-engineer the author's intent from the implementation — read the tests, where they already wrote it down. Then check whether the code keeps the promise the tests describe.

- **The diff is a keyhole, not the room.** You're looking at the change through a narrow slot. Sometimes the keyhole is enough; often you have to open the door — expand the file, pull the branch, run it — to see what the change really did.

- **`nit:` is a pressure-release valve.** It lets you voice a small preference *without* turning it into a demand. Use it generously, and let the author ignore them freely.

---

## Common Mistakes

1. **Reading top-to-bottom and commenting on whatever catches your eye.** You'll burn your attention on cosmetics and miss the bug. Follow the order: goal → correctness → design → tests → readability → style.

2. **Skipping the description and the linked issue.** Then you're judging whether code is "correct" without knowing what correct *means* for this change. Read the *why* before the *what*.

3. **Commenting on style a linter should catch.** If you're typing "add a space here" or "imports out of order," stop — that's the formatter's job. Configure CI to do it and spend your review on things a tool can't.

4. **Approving without checking the risky paths.** "It looked fine" is not a review. The bug lives in the empty list, the zero, the null, the concurrent call — the cases happy-path reading skips right over.

5. **Trusting the diff for behavior — especially UI.** A clean-looking diff can hide a one-character bug or an off-screen button. When the diff can't answer "is this correct?", pull the branch and *look*.

6. **Leaving comments without severity.** An unlabelled remark forces the author to guess if it's a blocker. Mark must-fixes as such; prefix optional ones with `nit:`.

7. **Blocking a PR over nits / perfectionism.** If the change improves the codebase and your only remaining comments are preferences, approve it. "Not how I'd do it" is not a valid block.

8. **Trying to review 1,000 lines in one sitting.** Your attention is gone by line 300 and the rest is a rubber stamp. Ask for a split, or review in focused chunks.

---

## Test Yourself

1. List the six steps of the review order of operations, in order, in a few words each.
2. Why must you understand the *goal* of a PR before you start reading the code?
3. Name two things code review **is for** and two things it is **not** for.
4. What's the value of reading the tests *before* the implementation? Name the two questions tests answer for you.
5. A test calls a function and computes a result but never asserts on it. Why is that worse than having no test at all?
6. A diff shows one character changed: `>` became `>=`. Why can't you judge correctness from the diff alone, and what would you do next?
7. What does the `nit:` prefix communicate — to the author, and to you?
8. Your only remaining comments on a PR are three nits. Approve, or request changes? Why?

<details>
<summary>Answers</summary>

1. **Goal** (is this the right change?), **Correctness** (does it work, edge cases, errors?), **Design** (sensible shape that fits the codebase?), **Tests** (do they prove it and cover the risk?), **Readability** (can the next person understand it?), **Style** (leave it to the linter — last).
2. Because you can't judge whether code is *correct* until you know what "correct" means for this change. You might also catch that it solves the wrong problem entirely — the most valuable comment you can leave.
3. **For:** finding defects, keeping the design coherent, spreading knowledge, shared ownership (any two). **Not for:** policing style (linter's job), gatekeeping/showing off, rewriting the code your way (any two).
4. Tests show the author's **intent** and the **contract** in executable form, so reading them first turns unfamiliar code into a checklist. The two questions: *what did the author intend?* and *what's the contract (which inputs/outputs matter)?*
5. Because it gives **false confidence**: it's green, so people trust it, but it proves nothing — it'd pass even if the logic were completely wrong. No test is at least honestly empty; an assertion-free test is a lie.
6. The diff hides context: `>=` makes withdrawing the *entire* balance fail, and whether that's intended depends on surrounding code, tests, and the issue. Next step: expand the surrounding file, check the tests, and/or pull the branch to understand the real behavior.
7. To the **author**: "this is optional, you may ignore it freely — not a blocker." To **you**: "if all I have left are nits, this PR is essentially done; approve it."
8. **Approve.** Nits are optional by definition; if the change improves the codebase and nothing blocks merge, holding it hostage to preferences is perfectionism, not review.

</details>

---

## Cheat Sheet

```text
THE ORDER OF OPERATIONS (most important first)
  1. GOAL        read description + linked issue — is this the RIGHT change?
  2. CORRECTNESS does it work? edge cases: empty / zero / null / negative / huge / concurrent
  3. DESIGN      sensible shape? fits the codebase? duplicates something?
  4. TESTS       exist? cover the RISKY paths? assert real values?
  5. READABILITY will the next person understand it in 6 months?
  6. STYLE       LAST — leave it to the formatter/linter

REVIEW IS FOR / NOT FOR
  FOR     → find defects · keep design coherent · spread knowledge · shared ownership
  NOT FOR → policing style (linter's job) · gatekeeping/showing off · rewriting it your way

TWO HIGH-LEVERAGE TRICKS
  READ TESTS FIRST   → tests = the author's intent + the contract, in code
  DON'T TRUST DIFF   → expand the file · pull the branch · RUN it (esp. UI)

TEST RED FLAGS
  no test on a risky path        → ask for one
  test that asserts nothing      → it's a lie; green but proves zero

SEVERITY — label EVERY comment
  BLOCKER (must fix)  → defect, missing test on risk, broken contract, security
  nit: (optional)     → naming, tidiness, preference — author's call
  RULE: if only nits remain → APPROVE

FATIGUE
  can't review ~1000 lines well in one sitting → small PRs review better → ask to split
```

---

## Summary

- **Reviewing is triage, not a top-to-bottom read.** Rank what could go wrong by importance and spend your attention there.
- Know **what review is for** — find defects, keep the design coherent, spread knowledge, build shared ownership — and what it is **not** for: policing style (the linter's job), gatekeeping, or rewriting the code your way. Approve when the change *improves the codebase*, even if it isn't how you'd have written it.
- Follow the **order of operations**, most important first: **goal → correctness → design → tests → readability → style.** The order is load-bearing — a problem at the top makes the ones below it irrelevant.
- **Read the tests first.** They are the author's intent and the contract made executable, and they turn unfamiliar code into a checklist. Watch for two smells: *missing* tests on risky paths, and tests that *assert nothing*.
- **Don't trust the diff.** It shows the lines that changed, not the behavior that changed. When it can't answer "is this correct?", expand the file, pull the branch, or run it — especially for UI.
- **Label every comment by severity.** Mark blockers as must-fix; prefix optional suggestions with `nit:`. If only nits remain, approve. And respect review fatigue: small PRs get real reviews, big ones get rubber-stamped.

The junior recipe, start to finish: **read the description → check it does the right thing correctly → read the tests → check the design → leave style to the linter → label your comments by how much they matter.** Do that, in that order, and you'll catch the bugs that matter while letting good work ship.

---

## Further Reading

- [Google Engineering Practices — *How to do a code review*](https://google.github.io/eng-practices/review/reviewer/) — the reviewer's guide; short, concrete, and the source of "approve once it improves code health."
- [Google Engineering Practices — *What to look for in a code review*](https://google.github.io/eng-practices/review/reviewer/looking-for.html) — a checklist that maps almost one-to-one onto the order of operations above.
- *Software Engineering at Google* (Winters, Manshreck, Wright) — the **Code Review** chapter, on why Google reviews, what it optimizes for, and the human side of the process.
- The [middle.md](middle.md) of this topic, which adds a sharper severity taxonomy (`P0/P1/P2`, `question:`, `suggestion:`), a risk-based reading order for large diffs, and how to review what *isn't* in the diff.

---

## Related Topics

- [02 — PR Scope & Size](../02-pr-scope-and-size/junior.md) — why small PRs get real reviews and giant ones get rubber-stamped; how to right-size a change.
- [03 — Correctness & Design Review](../03-correctness-and-design-review/junior.md) — going deep on steps 2 and 3: hunting edge cases and judging the shape of a change.
- [05 — Giving & Receiving Feedback](../05-feedback-giving-and-receiving/junior.md) — how to *phrase* the comments this page tells you to leave, kindly and clearly.
- [Static Analysis & Linting](../../static-analysis/) — the tools that own "style last," so you never have to comment on formatting again.
- [Soft-Skills → Code Review](../../../../Soft-Skills/code-review/) — the human, communication, and team-dynamics side of reviewing.
