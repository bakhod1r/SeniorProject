# PR Scope & Size — Junior Level

> **Roadmap:** [Code Review](../README.md) → PR Scope & Size
> *The single most effective thing you can do to get faster, kinder, more useful reviews has nothing to do with your code. It's the size of the box you put that code in.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Why Small PRs Win](#core-concept-1--why-small-prs-win)
5. [Core Concept 2 — Scope: One Logical Change Per PR](#core-concept-2--scope-one-logical-change-per-pr)
6. [Core Concept 3 — Separate the Refactor From the Behavior Change](#core-concept-3--separate-the-refactor-from-the-behavior-change)
7. [Core Concept 4 — How to Split a Big Change](#core-concept-4--how-to-split-a-big-change)
8. [Core Concept 5 — Feature Flags, Drafts, and Stacked PRs](#core-concept-5--feature-flags-drafts-and-stacked-prs)
9. [Core Concept 6 — The Author's Responsibility](#core-concept-6--the-authors-responsibility)
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

> Focus: **Why small, focused pull requests get reviewed faster and catch more bugs — and how to make yours that way.**

You finished a feature. It touched twelve files, added a helper, fixed a bug you noticed along the way, and renamed a confusing variable. You open one **pull request** (PR) with all of it, hit "Request review," and wait. And wait. Two days later a reviewer leaves one comment — `looks fine, I guess?` — and approves. Nobody really read it. The diff was too big to hold in one head.

That outcome is not bad luck, and it is not a lazy reviewer. It is the predictable result of a **big PR**. A reviewer can give a 50-line change real attention in a few minutes. A 1,500-line change is a different thing entirely: it sits in their queue because they're dreading it, and when they finally open it their focus drains long before the end. The back half gets skimmed. Bugs slip through. Then it sits in *merge limbo* long enough to collect conflicts with everyone else's work.

The fix is almost embarrassingly simple, and it's entirely in your hands as the author: **keep your PRs small and focused.** One logical change. A clear description. Self-reviewed before you ask anyone else to look. Do that, and reviews get faster, bugs get caught, and your changes merge while they're still relevant.

> **Mindset shift:** A small PR is a *gift* — to your reviewer *and* to your future self. To your reviewer, because it's a few minutes of focused attention instead of an hour of dread. To your future self, because when something breaks in production at 2 a.m. and the team has to `git revert`, a small, single-purpose PR is one clean undo — not a tangle of three unrelated changes you now have to untwist under pressure. You are not "splitting work to make more PRs." You are packaging your change so it can actually be reviewed well.

---

## Prerequisites

- **Required:** You've opened a pull request (or merge request) before — on GitHub, GitLab, Bitbucket, or similar — and know it's a request to merge your branch into the main one.
- **Required:** You can use basic git: create a branch, make commits, push.
- **Helpful:** You've had a PR sit unreviewed for days, or gotten a rubber-stamp approval that missed a bug. (We'll explain *why* that happens.)
- **Helpful:** You've hit a merge conflict and didn't enjoy it.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Pull request (PR)** | A request to merge your branch's changes into the main branch, where teammates review it first. (GitLab calls it a *merge request*.) |
| **Diff** | The set of lines added and removed — what the reviewer actually reads. "PR size" usually means *lines changed in the diff*. |
| **Scope** | *What* a PR is allowed to change. "In scope" = part of this one change. "Out of scope" = a different change that belongs in its own PR. |
| **Logical change** | One coherent thing: *fix this bug*, *add this endpoint*, *rename this class*. Not "everything I did this week." |
| **Refactor** | Restructuring code *without changing what it does* — renaming, moving, extracting. Same behavior, different shape. |
| **Behavior change** | Code that does something *new or different* — a feature, a bug fix, a changed output. The thing tests and users notice. |
| **Feature flag** | An on/off switch in code that lets you merge unfinished work *turned off*, so it's in main but not yet active. |
| **Draft PR** | A PR explicitly marked "not done yet" — open for early feedback, not for merging. |
| **Stacked PRs** | A chain of small, dependent PRs that together build one big feature; each is reviewed on its own. |
| **Scope creep** | The slow expansion of a PR beyond its one job — "while I'm in here, let me also fix…" |
| **Rubber-stamp** | Approving a PR without really reading it — the failure mode big PRs cause. |

---

## Core Concept 1 — Why Small PRs Win

Small PRs aren't a style preference. They beat big ones on four things you actually care about: **speed, bugs caught, revertability, and merge pain.**

**1. They get reviewed faster.** A reviewer's willingness to start is inversely related to size. A 50-line PR is a "I'll knock that out before my next meeting" task. A 1,500-line PR is a "I need to block out an afternoon" task — so it slides to tomorrow, then the day after. The smaller the PR, the sooner someone opens it.

**2. They catch more bugs.** This is the big one, and it's measurable. Human review attention is a limited budget. On a small diff, the reviewer reads every line. On a large diff, focus collapses — they read the start carefully, skim the middle, and start *rubber-stamping* the end just to be done. There's a well-known rough rule from review research:

```text
REVIEW EFFECTIVENESS vs PR SIZE  (rough, but directionally true)

  defects found
  per hour
     ▲
     │  ███
     │  ███ ███
     │  ███ ███ ███
     │  ███ ███ ███ ▓▓▓
     │  ███ ███ ███ ▓▓▓ ░░░ ░░░  ← past here, reviewers skim & approve
     └──────────────────────────────►  lines changed
       <100  ~200  ~400  600  1000+

  Sweet spot: under ~200–400 lines. Past ~400, defect-catching
  drops sharply — not because the bugs aren't there, but because
  the reviewer stops really looking.
```

Treat ~200 lines as comfortable and ~400 as a soft ceiling. Past that, you're not getting a *worse* review — you're getting *less of one per line*.

**3. They're easy to revert.** When a change breaks production, the fastest fix is often "undo it" — `git revert`. If the broken behavior lives in a small, single-purpose PR, the revert is one clean operation and nothing else comes back with it. If it's buried in a 1,500-line PR that *also* contained three good changes, reverting throws out the good with the bad, and now you're doing surgery under pressure.

**4. They merge faster with fewer conflicts.** A PR that lives for five days is a PR that diverges from `main` for five days. Every teammate who merges in that window is a potential conflict you'll have to resolve. Small PRs merge in hours, not days, so they conflict with almost nothing.

> **Key insight:** The reviewer's attention is a budget, not a constant. A big PR doesn't get *more* review — it gets the *same* finite attention spread thin, so the per-line quality drops and the back half gets rubber-stamped. Small PRs spend that budget where it works.

---

## Core Concept 2 — Scope: One Logical Change Per PR

**Size** is how *many* lines. **Scope** is how *many different things* those lines do. The second one matters even more.

The rule: **one logical change per PR.** A PR should answer one question — *what does this do?* — with one sentence. If your honest answer needs the word "and" three times, you have three PRs.

Here's the classic anti-pattern. You set out to add a feature, and along the way you also fix a bug and tidy some code. One PR:

```text
PR #482: "Add CSV export + fix date bug + cleanup"  (847 lines)

  ✗ new feature:   CSV export endpoint + button        (520 lines)
  ✗ bug fix:       off-by-one in date range filter      (12 lines)
  ✗ refactor:      rename `usr` → `user` everywhere     (315 lines)
```

Now put yourself in the reviewer's chair. A test breaks. **Which of the three changes caused it?** They can't tell — the diff mixes a behavior change, a bug fix, and a mechanical rename into one wall of lines. The rename's 315 lines of noise bury the 12 lines that actually matter for the bug fix. Everything is harder than it needs to be.

The same work, scoped:

```text
PR #482: "Fix off-by-one in date range filter"   (12 lines)  ← merges in minutes
PR #483: "Rename `usr` → `user` for clarity"      (315 lines, all mechanical) ← skim & approve
PR #484: "Add CSV export endpoint + button"       (520 lines, the real feature) ← gets real attention
```

Three PRs, each with a one-sentence purpose. The bug fix merges and ships *today* instead of waiting on the feature. The rename is boring on purpose — a reviewer can approve 315 lines of pure renaming in two minutes *because there's nothing else hiding in it*. The feature gets the focused review it deserves, undiluted.

> **Key insight:** When a PR does one thing, a failing test points straight at the cause. When it does three things, every problem becomes a "which of these is it?" investigation. Scope isn't about being tidy — it's about keeping cause and effect legible.

---

## Core Concept 3 — Separate the Refactor From the Behavior Change

This is the single most important scoping habit, so it gets its own concept. **Never mix a refactor and a behavior change in the same PR.**

Recall the definitions:

- A **refactor** changes the *shape* of code but not what it *does*. Rename a variable, move a function to another file, extract a helper. If you did it right, every test passes unchanged, because behavior is identical.
- A **behavior change** makes the code *do something different* — a new feature, a bug fix, a changed output.

When you mix them, you destroy the reviewer's most powerful tool. Normally a reviewer thinks: *"Did the tests change? If not, and this is a refactor, behavior is preserved — I can review lightly. If behavior changed, I focus hard on exactly those lines."* Mix the two and that reasoning collapses. A 400-line diff where 380 lines are a rename and 20 lines secretly change behavior is *dangerous* — the 20 important lines are camouflaged by 380 boring ones, and that's precisely where bugs sneak through.

The fix: **two PRs, refactor first.**

```bash
# PR #1 — pure refactor. NO behavior change. Tests pass UNCHANGED.
#   Extract the tangled price logic into its own function, as-is.
git switch -c refactor/extract-price-calc
# ...move code into calculatePrice(), change nothing about the math...
git commit -m "refactor: extract price logic into calculatePrice() (no behavior change)"
# Reviewer can approve fast: same tests, same behavior, just reshaped.

# PR #2 — the actual change, on top of the clean structure.
git switch main && git pull
git switch -c feat/apply-bulk-discount
# ...now ADD the bulk-discount rule to the freshly-extracted function...
git commit -m "feat: apply 10% bulk discount for orders over 50 units"
# Reviewer focuses on the small, real behavior change — no rename noise.
```

The order matters: refactor *first*, on its own, proving behavior is unchanged; then build the new behavior on the clean base. The reviewer of PR #1 verifies "nothing changed." The reviewer of PR #2 sees a tiny, focused diff and knows *exactly* what's new.

> **Key insight:** A reviewer's confidence comes from being able to say "this part can't have changed behavior." Mixing a refactor into a behavior change takes that certainty away from every single line. Keep them apart and you hand it back.

---

## Core Concept 4 — How to Split a Big Change

"Keep PRs small" sounds great until you have a genuinely big feature. The skill is **splitting** one big change into a sequence of small, independently reviewable PRs. Three reliable ways:

**1. Split by layer (bottom-up).** Most features touch several layers — database, business logic, API, UI. Each layer can often be its own PR, merged in order:

```text
Feature: "User profile avatars"
  PR 1: DB migration — add `avatar_url` column          (small, safe, mergeable alone)
  PR 2: storage — upload-to-S3 helper + tests           (no UI yet, fully testable)
  PR 3: API — POST /profile/avatar endpoint             (uses PR 2's helper)
  PR 4: UI — avatar upload widget                        (uses PR 3's endpoint)
```

Each PR is small, has its own tests, and merges on its own. Earlier ones are useful even before later ones land.

**2. Split by step.** When a change is a sequence — *prepare, then migrate, then clean up* — make each step a PR. A common shape: add the new path (off), switch traffic to it, then delete the old path. Three small PRs instead of one scary one.

**3. Split by vertical slice.** Instead of "all the layers for all the cases," ship one *thin end-to-end slice* first — the narrowest version that works front-to-back — then widen it:

```text
Feature: "Search"
  PR 1: search by exact title only, DB→API→UI, end to end   (works, just limited)
  PR 2: add fuzzy matching
  PR 3: add filters (date, author)
  PR 4: add pagination
```

PR 1 is a complete, shippable, *reviewable* feature — just a small one. Each later PR adds capability on a foundation that already works.

> **Key insight:** "I can't make this small, it's one big feature" almost always means "I haven't found the seam yet." Big changes are made of small ones stacked together. Your job as the author is to find the seams — by layer, by step, or by slice — *before* you open the PR, not after a reviewer asks you to.

---

## Core Concept 5 — Feature Flags, Drafts, and Stacked PRs

Three tools make small PRs practical even for work that isn't finished or can't ship yet.

**Feature flags — merge unfinished work safely.** A feature flag is an on/off switch in code. You merge incomplete work into `main` *with the switch off*: the code is there, integrated, but inactive. This lets you ship many small PRs toward a big feature without ever exposing a half-built feature to users.

```python
# The half-finished feature is merged into main, but OFF.
# Users never see it; reviewers review small pieces as they land.
if feature_flags.enabled("new_checkout"):
    new_checkout_flow()      # built up over several small, merged PRs
else:
    old_checkout_flow()      # everyone still gets the old, working path
```

Without flags, you'd be forced to keep a giant feature branch open for weeks (diverging, conflicting) and ship it as one terrifying mega-PR. Flags let you merge small and often, then flip the switch on once it's all in.

**Draft PRs — open early for feedback.** A **draft PR** is one explicitly marked "not ready to merge." You open it early — when you've got the shape but not the polish — to get direction *before* you've sunk hours into a wrong approach. It's a conversation starter, not a merge request:

```bash
gh pr create --draft --title "WIP: payment retry logic" \
  --body "Early look — does this retry approach seem right before I add tests + edge cases?"
```

Catching "actually, do it the other way" at the draft stage costs you an afternoon. Catching it after you've polished and "finished" costs you a rewrite.

**Stacked PRs — a chain of small dependent PRs.** Sometimes PR #2 genuinely needs PR #1's code to exist first. Instead of one big PR, you build a *stack*: each PR branches off the previous one, so each diff shows *only its own* changes, and each is reviewed on its own.

```text
main
  └─ PR #1: add Money value type                 ← reviewed on its own (small)
       └─ PR #2: use Money in pricing engine      ← diff shows only the pricing change
            └─ PR #3: expose Money in the API      ← diff shows only the API change

Together they ship one big feature; separately, each is a small, focused review.
```

The catch to know: when PR #1 changes after review, you have to update PR #2 and #3 on top of it (a *rebase*), which is fiddly by hand. Tools like **Graphite** (and `git`'s own machinery) automate restacking the chain so the manual pain mostly disappears. You don't need stacking on day one — but know it exists, so "this depends on that" never becomes your excuse for one giant PR.

> **Key insight:** "It's not done" and "it depends on other work" are the two excuses behind most oversized PRs. Feature flags kill the first (merge it off). Stacked PRs and drafts kill the second (chain small pieces, get feedback early). There's almost always a way to stay small.

---

## Core Concept 6 — The Author's Responsibility

A reviewable PR doesn't happen by accident — the *author* makes it reviewable. Three duties, all yours, all before you click "Request review."

**1. Keep it small and focused.** Everything above. One logical change, ideally under ~400 lines of diff.

**2. Write a clear description: what + why.** The diff shows *what changed*; only you can explain *why*. A reviewer who knows the intent reviews far better than one reverse-engineering your goal from the code. A good description is short and answers two questions:

```text
## What
Adds a 10% bulk discount for orders of 50+ units.

## Why
Sales asked for it (TICKET-1234). Wholesale customers were
manually requesting discounts via support; this automates it.

## Notes for the reviewer
- Discount logic lives in calculatePrice() (extracted in #483).
- Edge case: exactly 50 units DOES qualify — see the test.
```

That takes ninety seconds to write and saves the reviewer ten minutes of guessing.

**3. Self-review first.** Before you ask a human, **read your own diff** in the PR view — not your editor, the actual diff. You'll catch a stray `console.log`, a commented-out block, a leftover TODO, a file you didn't mean to commit. Reading the diff as if you were the reviewer is the single highest-value minute you can spend. Never make a teammate find what one glance at your own diff would have caught.

And the discipline that ties it together — **resist scope creep.** Scope creep is the "while I'm in here, let me also fix…" temptation. You're editing a file for your bug fix, you spot an unrelated mess, and you want to fix it *right now*. Don't. That instinct is how a 12-line PR becomes a 300-line one with three purposes. The fix exists — it's just a *different PR*:

```bash
# You're in user_service.py fixing the date bug.
# You notice an unrelated, ugly retry loop. The urge: "I'll just fix it too."
# Instead — capture it, stay focused:
gh issue create --title "Refactor messy retry loop in user_service.py" \
  --body "Spotted while fixing TICKET-1234. Out of scope there; fix separately."
# Now your PR stays 12 lines and one-purpose. The mess is logged, not lost.
```

The unrelated improvement is real and worth doing — *later*, in its own small PR. Filing an issue (or a TODO) means you don't lose it *and* you don't derail the PR in front of you.

> **Key insight:** "Reviewable" is something you build, not something you hope for. Small + clear description + self-reviewed + scope-disciplined turns review from a slog into a quick yes. The reviewer's job gets easy because *you* did the packaging.

---

## Real-World Examples

**1. The mega-PR that sat for a week.** A junior spends four days on a feature and opens one PR: 1,400 lines across 22 files, mixing the feature, two drive-by bug fixes, and a sweeping rename. It sits. No reviewer wants to start. When one finally does, they skim, leave `seems ok`, and approve — and a bug in the back third ships. Postmortem lesson: the same work as five small PRs (one bug fix each, one rename, one feature, in a stack) would each have merged in under a day and gotten real eyes. The size *caused* the rubber-stamp and the missed bug.

**2. The refactor that hid a behavior change.** A 350-line PR titled "cleanup" renamed a function and moved it — *and* quietly changed a `<` to `<=` in the moved code, altering behavior. The reviewer, seeing "cleanup" and 348 lines of mechanical moves, approved fast. The off-by-one shipped. Had the refactor (rename + move, tests unchanged) and the behavior change (the comparison) been *two PRs*, the second would have been a 1-line diff impossible to miss. Mixing them is what hid the bug.

**3. Feature flags that kept a big feature shippable.** A team rebuilds checkout — weeks of work. Instead of one long-lived branch, they merge ~15 small PRs into `main` over three weeks, all behind `feature_flags.enabled("new_checkout")` (off). Each PR is small and reviewed properly; `main` stays releasable the whole time because the flag is off. When the last piece lands, they flip the flag on for 5% of users, watch metrics, then ramp to 100%. No mega-PR, no weeks-long branch, no big-bang risk.

**4. The stacked chain that stayed reviewable.** A senior introduces a `Money` type across the codebase. As one PR it'd be 900 lines touching everything. As a Graphite stack — `add Money type` → `use it in pricing` → `use it in the API` → `use it in reports` — each PR is 150–250 focused lines, each reviewed by the right person (pricing owner reviews the pricing one), each merged as it's approved. The big change shipped as a series of small, confident yeses.

---

## Mental Models

- **A PR is a unit of attention, not a unit of work.** You don't size a PR by "how much I did." You size it by "how much a reviewer can hold in their head at once." Anything bigger than that overflows and gets skimmed.

- **The diff is the menu the reviewer orders from.** They read the diff, not your intentions. A clean, small, single-purpose diff with a clear description is an easy order. A giant mixed diff is a buffet they'll grab a few items from and call it lunch.

- **Refactor and behavior change are oil and water — keep them in separate bottles.** Pour them together and you can't tell which is which. In separate PRs, the reviewer always knows whether to ask "did anything change?" (it shouldn't) or "what changed?" (and exactly where).

- **A feature flag is a dimmer switch for unfinished code.** The wiring (your code) can be fully installed in the wall (merged to main) while the light stays off (flag disabled). You don't need the room lit to safely run the wires.

- **Scope creep is a snowball.** "While I'm in here" starts small and picks up mass as it rolls. The only reliable stop is to not start it — log the side-quest as an issue and walk back to your one job.

---

## Common Mistakes

1. **One PR for "everything I did."** Feature + bug fix + refactor + rename in a single PR. The reviewer can't isolate cause from effect, the diff is huge, and the whole thing rubber-stamps. Split by logical change.

2. **Mixing a refactor with a behavior change.** The most bug-prone mistake. Real behavior changes hide among mechanical edits. Refactor in one PR (tests unchanged), change behavior in another.

3. **Treating "it's not finished" as a reason to go big.** You don't have to finish before merging. Merge small pieces behind a feature flag (off), then flip it on at the end.

4. **No description, or a useless one.** `"updates"` or `"fixes stuff"` tells the reviewer nothing about *why*. Two sentences of what + why turns a slow, guessing review into a fast one.

5. **Skipping self-review.** Asking a human before reading your own diff. They'll find the stray `console.log` and the leftover TODO that one glance from you would have caught — wasting a review round-trip.

6. **Giving in to scope creep.** "While I'm in here, let me also fix this unrelated thing." That's how a 12-line PR becomes 300 lines and three purposes. File an issue; stay on task.

7. **Avoiding the split because it "feels like more work."** Five small PRs feel like more overhead than one big one. They aren't: they review faster, merge faster, conflict less, and revert cleanly. The big PR's "savings" are an illusion you pay back with interest in review delay and risk.

---

## Test Yourself

1. A reviewer gives your 1,200-line PR a fast `looks good` and approves in two minutes. Why is that *bad* news, not good news?
2. Roughly past how many lines does review effectiveness drop off sharply — and *why* does it drop (what runs out)?
3. You're adding a feature and you rename a confusing variable in the same files. Should those be one PR or two? Why?
4. Define a *refactor* vs a *behavior change* in one sentence each, and explain why mixing them in one PR is dangerous.
5. You have a big feature that isn't finished, but you don't want a giant long-lived branch. What tool lets you merge the unfinished pieces into `main` safely, and how does it work?
6. While fixing a bug, you spot an unrelated ugly function you'd love to clean up. What should you do — and what's the name for the temptation to fix it now?
7. Name two of the three author responsibilities that make a PR reviewable, beyond keeping it small.

<details>
<summary>Answers</summary>

1. A 1,200-line diff is too big for anyone to truly review in two minutes — a fast approval means it was **rubber-stamped**, not read. Bugs in it almost certainly went unexamined. Fast approval on a *small* PR is good; on a huge one it's a red flag.
2. Sharply past **~400 lines** (comfortable is under ~200). What runs out is the **reviewer's attention budget** — on a big diff they read the start, skim the middle, and rubber-stamp the end, so per-line defect-catching collapses.
3. **Two PRs.** The rename is a refactor (no behavior change); the feature is a behavior change. Separating them lets the reviewer approve the rename quickly *and* focus on the small, real feature diff — instead of the feature hiding among rename noise.
4. **Refactor:** changes code's shape but not what it does (tests pass unchanged). **Behavior change:** makes the code do something new or different. Mixing them is dangerous because the few behavior-changing lines get camouflaged by many mechanical lines, so the reviewer's "did anything actually change?" certainty is lost and bugs slip through.
5. **Feature flags.** You merge the unfinished code into `main` with the flag **off** — the code is integrated but inactive, so users never see it and `main` stays releasable. You ship many small PRs, then flip the flag on once everything's in.
6. **File a separate issue (or TODO) and stay on your current task** — fix it later in its own small PR. The temptation is **scope creep** ("while I'm in here…").
7. Any two of: **write a clear description (what + why)**; **self-review your own diff first**; **resist scope creep**. (Plus the small + focused requirement itself.)

</details>

---

## Cheat Sheet

```text
SIZE
  comfortable PR     ≈ under 200 lines of diff
  soft ceiling       ≈ 400 lines  (past here, reviewers skim → rubber-stamp)
  rule of thumb      smaller = reviewed sooner, more bugs caught, reverts clean,
                     fewer conflicts

SCOPE
  one logical change per PR
  if the description needs "and … and …" → split it
  failing test on a 1-purpose PR → cause is obvious
  failing test on a 3-purpose PR → "which one was it?" investigation

THE GOLDEN RULE
  separate the REFACTOR from the BEHAVIOR CHANGE
    PR 1: refactor   → no behavior change, tests pass UNCHANGED   (fast approve)
    PR 2: behavior   → small, focused diff on the clean base      (real review)

HOW TO SPLIT A BIG CHANGE
  by layer    DB → logic → API → UI            (each its own PR)
  by step     add new path → switch → delete old path
  by slice    thin end-to-end first, then widen

TOOLS FOR STAYING SMALL
  feature flag   merge unfinished work OFF in main; flip on when ready
  draft PR       open early for direction before you polish
  stacked PRs    chain of small dependent PRs (Graphite restacks them for you)

AUTHOR'S JOB (before "Request review")
  [ ] small + one logical change
  [ ] clear description: WHAT + WHY
  [ ] self-reviewed the diff (no stray logs / TODOs / junk files)
  [ ] resisted scope creep — side-quests → file an issue, not this PR
```

---

## Summary

- **Small, focused PRs win** on the things that matter: they're reviewed sooner, catch more bugs, revert cleanly, and merge with fewer conflicts. A reviewer's attention is a fixed budget — a big PR spreads it thin and the back half gets *rubber-stamped*.
- Aim for **under ~200 lines**, treat **~400 as a soft ceiling**; defect-catching drops sharply past it.
- **Scope = one logical change per PR.** If your description needs "and" three times, you have three PRs. One purpose means a failing test points straight at the cause.
- **The golden rule: separate the refactor from the behavior change.** Refactor first (no behavior change, tests unchanged, fast approval), then build the new behavior on the clean base. Mixing them camouflages the dangerous lines.
- **Split big changes** by layer, by step, or by vertical slice — find the seam *before* you open the PR.
- **Feature flags** let you merge unfinished work safely (off in `main`). **Draft PRs** get you early feedback. **Stacked PRs** turn a dependent chain into small independent reviews (Graphite automates the rebasing).
- **The author makes a PR reviewable:** small, a clear *what + why* description, self-reviewed first — and **resist scope creep** by filing side-quests as separate issues.

A small PR is a gift to your reviewer and your future self. Package your change so it can be reviewed well, and the whole team moves faster.

---

## Further Reading

- [Google Engineering Practices — *Small CLs*](https://google.github.io/eng-practices/review/developer/small-cls.html) — from the Code Review Developer Guide. The definitive, opinionated case for small changes, with concrete guidance on what "one thing" means and how to split.
- [Google Engineering Practices — *The CL Author's Guide*](https://google.github.io/eng-practices/review/developer/) — the rest of the author's responsibilities: writing descriptions, handling reviewer comments, self-review.
- **SmartBear, *Best Kept Secrets of Peer Code Review*** — the Cisco/SmartBear study behind the "effectiveness drops past ~200–400 lines" rule. Search for the SmartBear code review study or report for the data.
- [Graphite — *Stacked diffs / stacked PRs*](https://graphite.dev/guides/stacked-diffs) — a clear intro to stacking a chain of small dependent PRs and the tooling that makes it painless.
- The [middle.md](middle.md) of this topic, which goes deeper on sizing heuristics, splitting strategies for legacy code, branch-by-abstraction, and measuring PR size on a real team.

---

## Related Topics

- [01 — What to Look For & In What Order](../01-what-to-look-for-and-order/junior.md) — once a PR is the right size, *this* is how the reviewer reads it.
- [05 — Giving & Receiving Feedback](../05-feedback-giving-and-receiving/junior.md) — small PRs make feedback specific and easy to act on.
- [07 — Review Metrics & Tempo](../07-review-metrics-and-tempo/junior.md) — how PR size shows up in cycle-time and review-latency numbers.
- [08 — Review Anti-patterns](../08-review-anti-patterns/junior.md) — the mega-PR and the rubber-stamp as named anti-patterns to avoid.
- [Quality Gates](../../quality-gates/) — the automated checks (CI, tests, linters) that run on every PR before a human looks.
