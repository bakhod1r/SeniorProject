# PR Scope & Size — Middle Level

> **Roadmap:** [Code Review](../README.md) → PR Scope & Size
> *The junior page said "keep PRs small." This page makes "small" precise — the LOC where defect detection collapses, the cardinal rule that separates a refactor from a behaviour change, and the three techniques (splitting, feature flags, stacked diffs) that let you ship a large change as a sequence of small, individually-reviewable ones.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Size→Quality Curve, With Numbers](#core-concept-1--the-sizequality-curve-with-numbers)
5. [Core Concept 2 — Size→Latency→WIP, the Second-Order Cost](#core-concept-2--sizelatencywip-the-second-order-cost)
6. [Core Concept 3 — The Cardinal Rule: Separate Refactor From Behaviour](#core-concept-3--the-cardinal-rule-separate-refactor-from-behaviour)
7. [Core Concept 4 — Splitting Techniques](#core-concept-4--splitting-techniques)
8. [Core Concept 5 — Feature Flags: the Enabler of Small PRs](#core-concept-5--feature-flags-the-enabler-of-small-prs)
9. [Core Concept 6 — Stacked PRs / Stacked Diffs](#core-concept-6--stacked-prs--stacked-diffs)
10. [Core Concept 7 — Scope Discipline and the Author's Contract](#core-concept-7--scope-discipline-and-the-authors-contract)
11. [Real-World Examples](#real-world-examples)
12. [Mental Models](#mental-models)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How big is "too big," why, and what do I do about a change that genuinely is large?**

At the junior level "small PRs are better" is a slogan you accept on faith. This page turns it into an engineering claim with a measured shape: defect-finding effectiveness does not decline gently with size — it **falls off a cliff**. Past a few hundred changed lines a reviewer stops finding bugs not because the bugs aren't there but because human attention is exhausted. The slogan is really a statement about the limits of human working memory applied to diffs.

But knowing the limit is useless if your change is legitimately a thousand lines. The other half of this page is the *craft of decomposition* — how to take one large change and ship it as a sequence of small, independently-correct, individually-reviewable pieces. Three techniques carry almost all the weight: **separating refactors from behaviour changes**, **hiding incomplete work behind feature flags**, and **stacking dependent PRs**. Master those and "this change is too big to review" stops being a tradeoff you're forced to make and becomes a workflow problem you've already solved.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and know *why* a small PR is easier to review than a large one.
- **Required:** Comfortable with `git` branches, `git rebase`, and resolving a merge conflict.
- **Helpful:** You've reviewed at least one PR that was too large to review honestly — and felt yourself stop reading.
- **Helpful:** A working notion of trunk-based development and long-lived feature branches (we contrast them here).

---

## Glossary

| Term | Meaning |
|---|---|
| **LOC / changed lines** | Lines added + deleted in a diff. The crude-but-predictive size proxy in the review-effectiveness data. |
| **Defect density** | Defects found per unit of code reviewed (e.g. per KLOC). The metric that collapses as PR size grows. |
| **CL** | *Changelist* — Google's term for one unit of review (≈ one PR). The "small CLs" doctrine is about these. |
| **Vertical slice** | A thin change that touches every layer (UI → API → DB) to deliver one end-to-end behaviour. |
| **Horizontal layer** | A change confined to one layer (e.g. "all the DB migrations") across many features. |
| **Feature flag** | A runtime toggle that lets incomplete or risky code merge to trunk while staying *off* in production. |
| **Stacked PR / stacked diff** | A chain of dependent PRs where each builds on the previous, reviewed and merged in order. |
| **Preparatory refactoring** | Refactoring done *first* to make a subsequent behaviour change small — Kent Beck's "make the change easy." |
| **Drive-by fix** | An unrelated small fix bundled into a PR ("while I was here…"). Acceptable when tiny and obvious; otherwise its own PR. |
| **WIP** | Work in progress — open, unmerged changes. Large PRs inflate WIP and the rebase/conflict cost that rides on it. |

---

## Core Concept 1 — The Size→Quality Curve, With Numbers

The foundational data is the **SmartBear / Cisco** study — a review of ~2,500 reviews across ~3.2 million lines of code at Cisco Systems, the largest published code-review study of its kind. Its findings about size are blunt and repeatable:

- **Defect density is highest in small reviews and collapses as size grows.** Reviews under ~200 changed LOC find proportionally far more defects per line than larger ones. The reviewer's eye is still resolving individual lines, not skimming blocks.
- **~200 LOC is the sweet spot; ~400 LOC is the practical ceiling.** Beyond ~400 changed lines the ability to find defects drops sharply. The study also found reviewer effectiveness drops after about **60 minutes** of review and at review rates above roughly **500 LOC/hour** — three different framings of the same exhaustion limit.
- **Beyond ~400–500 LOC, review quality effectively collapses.** Not "declines" — *collapses*. The reviewer is no longer finding bugs; they're pattern-matching for obvious mistakes and approving on trust. A 1,500-line PR does not get 3× the scrutiny of a 500-line one; it gets *less* total scrutiny because attention runs out partway through.

```text
defect detection effectiveness (schematic, from SmartBear/Cisco)

 high │■■■■■■■■■■■■
      │           ■■■■■■■■
      │                   ■■■■■
      │                        ■■■
      │                          ■■
  low │                            ■■■■■■■■■■■■■■■■■■■■■
      └────┬─────────┬─────────┬─────────┬─────────────►
          ~200      ~400      ~600      ~800     changed LOC
       sweet spot   ceiling    review degrades to rubber-stamp
```

This is why **Google's engineering practices codify "small CLs"** as a first-class doctrine. Their guide states the optimal CL is *as small as it can be while still being a complete, self-contained, reviewable unit* — small enough that a reviewer can hold the whole change in their head, large enough that it stands alone and doesn't break the build. The reasoning is identical to the data above: small CLs are reviewed faster, reviewed more thoroughly, and roll back cleanly when wrong.

> **Key insight:** The size→quality relationship is not linear and not a matter of taste — it's a cliff driven by human working-memory limits. Past roughly 400 changed lines a reviewer's defect-finding ability doesn't taper, it falls off. "Make it smaller" is therefore not a style preference; it is the single highest-leverage thing an author can do to make review actually work.

---

## Core Concept 2 — Size→Latency→WIP, the Second-Order Cost

Size hurts in a second, less obvious way: **big PRs sit longer**, and everything that rides on review latency gets worse.

The mechanism is a feedback loop:

1. A large PR is intimidating, so reviewers defer it ("I'll do this when I have a proper block of time").
2. While it waits, `main` moves on. The branch drifts, accumulating conflicts.
3. The author rebases, which invalidates parts of the prior review (the reviewer must re-read changed sections).
4. More waiting → more drift → more rebases → more WIP held open → more context-switching for the author.

A small PR short-circuits the loop: it's reviewed in one sitting, merges before `main` drifts far, and never accumulates the conflict tax. Two small PRs that each merge same-day beat one large PR that sits for a week — even though the large PR is "one review event" on paper.

| | Large PR | Two small PRs |
|---|---|---|
| Time-to-first-review | Long (reviewers defer it) | Short (low-effort to start) |
| Rebase/conflict cost | High (sits while `main` drifts) | Low (merges before drift) |
| Re-review after rebase | Likely, and expensive | Rare |
| Rollback blast radius | Whole change reverts together | Revert just the bad slice |
| WIP held open | High | Low |

This connects directly to [07 — Review Metrics & Tempo](../07-review-metrics-and-tempo/middle.md): time-to-first-review and review latency are flow metrics, and PR size is one of their biggest upstream drivers. You cannot fix latency purely by nagging reviewers to be faster if authors keep sending 900-line PRs.

> **Key insight:** PR size has a first-order cost (defects missed) *and* a second-order cost (latency, rebases, WIP, blast radius). The second-order cost is why the "but more small PRs means more review overhead" objection is weaker than it sounds — small PRs reclaim more time in avoided rebases and faster turnaround than they spend in extra review events.

---

## Core Concept 3 — The Cardinal Rule: Separate Refactor From Behaviour

If you internalize one splitting rule, make it this: **never mix a refactor with a behaviour change in the same PR.** This is the single most valuable decomposition in code review, and it works because of *what each kind of change lets a reviewer do*.

- **A pure refactor is mechanically verifiable.** "Rename `getUser` to `fetchUser` everywhere," "extract this block into a method," "move this file." The reviewer's job is to confirm *no behaviour changed* — and tools help: the test suite should pass untouched, and the diff should be structure-only. A reviewer can approve a 600-line *pure rename* far faster than a 100-line behaviour change, because they're checking a single invariant.
- **A behaviour change is small and visible.** "Add retry on 503," "fix the off-by-one in pagination." When this arrives *alone*, the behaviour delta is the entire diff. The reviewer looks exactly at what changed and asks "is this correct?"

Now mix them. A 50-line behaviour fix buried inside a 500-line refactor is **invisible**. The reviewer scrolls through hundreds of moved-but-unchanged lines, attention draining, and the five lines that actually change what the program *does* slide past unexamined. You have used the refactor as camouflage — usually unintentionally, which is worse, because nobody chose to hide it.

```diff
# ❌ One PR: refactor + behaviour mixed. Where is the real change?
- def charge(user, amount):
-     if user.balance >= amount:
-         user.balance -= amount
-         return Receipt(user, amount)
-     raise InsufficientFunds()
+ def charge(account: Account, cents: int) -> Receipt:   # renamed, retyped
+     if account.balance_cents >= cents:                  # renamed fields
+         account.balance_cents -= cents
+         _audit_log.record(account, cents)               # ← BEHAVIOUR CHANGE, hidden
+         return Receipt(account, cents)
+     raise InsufficientFunds()
```

```diff
# ✅ PR 1 — pure refactor: rename + retype, NO behaviour change. Tests unchanged.
- def charge(user, amount):
-     if user.balance >= amount:
-         user.balance -= amount
+ def charge(account: Account, cents: int) -> Receipt:
+     if account.balance_cents >= cents:
+         account.balance_cents -= cents
          return Receipt(...)

# ✅ PR 2 — pure behaviour change: the whole diff IS the new behaviour.
  def charge(account: Account, cents: int) -> Receipt:
      if account.balance_cents >= cents:
          account.balance_cents -= cents
+         _audit_log.record(account, cents)   # reviewer sees exactly this
          return Receipt(...)
```

> **Key insight:** Mixing refactor and behaviour change is the most common way a real bug ships through review — not because reviewers are careless, but because the behaviour delta is hidden in mechanical noise. Splitting them turns one un-reviewable PR into a *trivially* reviewable refactor and a *small, focused* behaviour change. This is the highest-leverage split you will ever make.

---

## Core Concept 4 — Splitting Techniques

Once you accept that large changes must be decomposed, the question is *how to cut*. Four techniques, roughly in order of how often you'll reach for them.

**1. Separate refactor from behaviour** — covered above; the cardinal cut. Always look for it first.

**2. Vertical slices over horizontal layers.** A *vertical slice* delivers one thin end-to-end behaviour through every layer (a single new field: migration + model + API + UI for *that field only*). A *horizontal layer* ships one layer across all features ("all the migrations," then "all the API," then "all the UI"). Prefer vertical: each slice is independently testable, independently shippable, and delivers user-visible value. Horizontal layering forces reviewers to approve a DB schema with no caller — they can't judge whether it's *right* because nothing uses it yet, and it can't ship until the whole stack lands.

```text
HORIZONTAL (avoid)              VERTICAL (prefer)
PR1: all DB migrations          PR1: field A — migration + API + UI  (ships, usable)
PR2: all API endpoints          PR2: field B — migration + API + UI  (ships, usable)
PR3: all UI                     PR3: field C — migration + API + UI  (ships, usable)
→ nothing works until PR3       → each PR is end-to-end and shippable
```

**3. Split by commit, then by PR.** While building, keep commits clean and atomic — one logical step each. A well-curated commit history is a *pre-made splitting plan*: you can often lift commit boundaries straight into separate PRs (`git rebase` to reorder/squash, then branch each cluster). Authors who commit carefully rarely struggle to split later.

**4. Preparatory refactoring first** — Kent Beck's *"make the change easy, then make the easy change"* (often paired with his warning that "the second part can be hard"). If the codebase makes your intended change awkward, do a **preparatory refactor PR** that reshapes the code so the real change becomes a small, obvious diff — *then* a second PR that makes the now-easy change. This is the cardinal rule applied proactively: you split *before* writing the behaviour change, not after.

> **Key insight:** Splitting is not "chop the diff into N equal pieces." It's finding the *seams* — the refactor/behaviour boundary, the vertical slice, the atomic commit, the preparatory step — where each piece is independently correct and reviewable. A good split makes each PR *easier* to reason about than the whole; a bad split (arbitrary line cuts) makes each PR *impossible* to reason about because the context lives in a sibling.

---

## Core Concept 5 — Feature Flags: the Enabler of Small PRs

The objection to small PRs is "but my feature isn't done — I can't merge half of it." The answer is **feature flags**: merge incomplete or risky code to trunk *with the new path turned off*, then ship small increments continuously instead of holding a long-lived branch open for weeks.

```python
# Each small PR adds a piece behind the flag. main always builds; users see nothing yet.
if feature_flags.enabled("new_checkout_flow", user):
    return new_checkout(cart)      # merged incrementally across many small PRs, flag OFF
else:
    return legacy_checkout(cart)   # the live path, untouched
```

This is the mechanism that makes **trunk-based development** practical (small changes landing on `main` continuously, behind flags, instead of long-lived branches). Instead of a six-week `feature/checkout-v2` branch that becomes an un-reviewable 4,000-line merge and a rebase nightmare, you land twenty small PRs over six weeks — each reviewed in one sitting, each safe because the flag is off — and flip the flag when the feature is complete and tested.

Flags carry a lifecycle obligation:

1. **Introduce** the flag (default off).
2. **Build** behind it across many small PRs.
3. **Roll out** gradually (percentage / cohort) once complete.
4. **Clean up** — *delete the flag and the dead `else` branch* once the new path is fully live. Stale flags are technical debt: every un-removed flag doubles the code paths a future reviewer must reason about. A flag without a removal plan is a permanent fork in the codebase.

> **Key insight:** Feature flags decouple *deploy* from *release*. That decoupling is what lets a large feature ship as a stream of small PRs rather than one giant merge — you get continuous integration and small reviews *because* incomplete work can safely live in production while switched off. The cost is flag hygiene; the discipline is to schedule the cleanup PR the moment the rollout completes.

---

## Core Concept 6 — Stacked PRs / Stacked Diffs

Some changes can't be flagged into independence — later steps genuinely depend on earlier ones. **Stacked PRs** (a.k.a. *stacked diffs*) handle this: a chain of small, dependent PRs where each branches off the previous, and each is reviewed individually.

```text
main
 └─ PR1  add Account type + migration         (review & merge first)
     └─ PR2  port charge() to Account          (depends on PR1)
         └─ PR3  add audit logging to charge() (depends on PR2)
             └─ PR4  wire audit log into UI    (depends on PR3)

Reviewers see four small, focused diffs — not one 700-line PR.
```

The workflow:

- Each PR's diff shows **only its own change** layered on the one below — so a reviewer reads PR3 as "the audit-logging change," not "everything since `main`."
- Review and merge **bottom-up**: PR1 lands, the stack rebases onto the new `main`, PR2 lands, and so on. When PR1 changes during review, you **rebase the whole stack** to propagate the edit — the part that tooling exists to automate.
- The trade-off is **tooling complexity vs review quality**: stacks are fiddly to maintain by hand (rebasing four branches, keeping bases correct), so they pay off most with tool support.

Tooling, because **GitHub's native stacking support is weak** (it has no first-class concept of a dependent-PR chain — a stacked PR shows the cumulative diff unless you manually retarget bases):

| Tool | Model | Notes |
|---|---|---|
| **Graphite** | Stacks on top of GitHub | Most popular GitHub-native stacking UX; CLI + web; auto-rebases the stack |
| **ghstack** | Meta's tool, one PR per commit | Used heavily on PyTorch; opinionated, commit-driven |
| **Phabricator / `arc`** | Stacked diffs were the native unit | The original mainstream stacked-diff workflow (now sunset, but the model that inspired the rest) |
| **Gerrit** | Relation chains | Each commit is a change; dependent commits form a chain natively |
| **git-branchless** | Local stack management | `git` plugin for rebasing and navigating stacks without a service |

> **Key insight:** Stacking gives you the review quality of small PRs *for changes that are inherently sequential* — the case feature flags can't solve. The price is real tooling and rebase discipline; on GitHub specifically you need a tool (Graphite/ghstack) because the platform's native support is thin. Reach for stacking when the change is large *and* its steps are genuinely dependent; reach for flags when the steps can be made independent.

---

## Core Concept 7 — Scope Discipline and the Author's Contract

Size is *how much*; **scope** is *how many different things*. A PR should do **one logical change**. Even a small PR with three unrelated changes is harder to review (three contexts to load) and harder to revert (you can't undo one without the others).

**Scope creep** is the slow death of a focused PR. It starts coherent, then "while I'm in here…" accumulates until it's un-reviewable. The reviewer's most common scope-creep prompt — *"could you also…"* — should almost always become **"good idea, filed as a follow-up"**, not more commits on the open PR. Growing a PR to satisfy a review comment is how a clean change becomes a mess.

**Drive-by fixes** are the calibrated exception. A typo in a comment you're already editing — fine, fold it in. Fixing an unrelated bug you noticed three files away — *separate PR*: it deserves its own review, its own description, and its own revertability. The rule of thumb: *small + obvious + adjacent* → fold in with a note; *larger or unrelated* → its own PR.

**Draft PRs** are the tool for early feedback without claiming "ready to merge." Open a draft to get directional feedback on an approach *before* you've polished it — cheaper than discovering after 500 lines that the design was wrong. Mark ready only when you mean "please review to merge."

The **author's contract** — what a reviewer is entitled to expect from every PR:

- **Small** — one logical change, sized to be reviewable in one sitting.
- **A clear description** — *what* changed and *why*, not *how* (the *how* is the diff). State the problem, the approach, and what you deliberately left out. A reviewer should understand the change before reading a line of code.
- **Self-reviewed** — you read your own diff first and removed the debris (stray logs, commented-out code, the accidental file). Self-review is the cheapest defect filter there is — see [05 — Giving & Receiving Feedback](../05-feedback-giving-and-receiving/middle.md).

> **Key insight:** Small size and tight scope are an author's *gift to the reviewer's attention* — and the description is half the gift. A reviewer's working memory is the scarce resource the whole process runs on; a small, single-purpose, well-described, self-reviewed PR spends that budget on finding real problems instead of reconstructing what the change even is.

---

## Real-World Examples

**1. The "quick fix" that became a 1,400-line PR.** An engineer set out to fix a pagination off-by-one. Along the way they renamed the paginator, retyped its parameters, and reformatted the module. The behaviour fix — three lines — landed inside a 1,400-line diff. Two reviewers approved; the off-by-one *shipped unchanged* because nobody could see it. The fix: split into a pure-rename PR (mechanically verified, approved in minutes) and a 3-line behaviour PR (where the bug was immediately obvious and caught). This is Core Concept 3 in the wild.

**2. Trunk-based migration via flags.** A team replacing a payments provider faced a 5,000-line change. Instead of a quarter-long branch, they wrapped the new provider in `if flags.enabled("payments_v2")`, merged ~30 small PRs over two months (each reviewed same-day, flag off), ran both providers in shadow mode behind the flag, then ramped `payments_v2` from 1% → 100%. The cleanup PR deleting the old provider and the flag landed two weeks after 100%. No long-lived branch, no merge-day rebase nightmare.

**3. A stacked refactor on a service team.** Migrating a service from a global DB handle to injected dependencies was inherently sequential: you must introduce the new type before porting callers. The author used Graphite to stack five PRs (introduce type → port module A → port module B → port module C → delete global). Each PR was 80–150 lines and reviewed in isolation. When review of PR1 forced a rename, `gt restack` propagated it through the stack automatically — the workflow that makes stacking viable on GitHub.

**4. "Could you also…" deferred correctly.** During review of a small caching PR, the reviewer noticed the eviction policy could be improved. Instead of asking the author to expand the PR, they wrote: *"Not blocking — the eviction tuning is a separate concern. Filed #4821 so we don't lose it."* The caching PR merged that afternoon; the eviction work got its own focused review later. Scope held; nothing was lost.

---

## Mental Models

- **The reviewer's attention is a fixed battery.** It drains as the diff grows and is dead by ~400 lines. Everything in this page — splitting, flags, stacks, scope — is about spending that battery on finding real bugs instead of on reconstructing context. A big PR doesn't get more review; it runs the battery flat before the end.

- **Refactor PRs prove a negative; behaviour PRs prove a positive.** A refactor's claim is *"nothing changed"* (verify against the test suite). A behaviour change's claim is *"this changed, and it's correct"* (verify the delta). Mixing them forces the reviewer to prove both at once over the same diff — which they can't, so they prove neither.

- **A feature flag is a clutch.** It disengages *deployed* from *released* so you can change gears (ship code) without lurching the car (affecting users). The skill is remembering to remove the clutch once you're in gear — a flag left in is a permanent extra gear nobody asked for.

- **A stack is a ladder, climbed bottom-up.** You can only stand on a rung if the one below is solid; you build and merge from the bottom. Pull out a lower rung (change PR1) and every rung above must be reseated (rebase the stack) — which is exactly the chore the tooling automates.

---

## Common Mistakes

1. **Treating "small PR" as a style preference.** It's a defect-detection mechanism with measured data behind it. Past ~400 lines, review effectiveness collapses — that's a finding, not an aesthetic.

2. **Mixing a refactor with a behaviour change.** The most common way a real bug ships past review: the behaviour delta hides in mechanical noise. Split them — always.

3. **Slicing horizontally.** "All the migrations, then all the API, then all the UI" forces reviewers to approve code with no caller and ships nothing until the last PR. Slice vertically — each PR end-to-end and shippable.

4. **Long-lived feature branches instead of flags.** A six-week branch becomes an un-reviewable merge and a rebase nightmare. Merge incrementally behind a flag; flip when done.

5. **Forgetting to remove a feature flag.** Every stale flag permanently doubles the code paths a future reviewer must reason about. Schedule the cleanup PR when the rollout starts.

6. **Hand-rolling stacked PRs on GitHub.** Without tooling you'll show cumulative diffs and mis-target bases. Use Graphite/ghstack/branchless — or don't stack.

7. **Letting "could you also…" grow the PR.** Scope creep turns a focused change un-reviewable. File a follow-up; keep the PR doing one thing.

8. **Shipping a large PR with a one-line description.** Size and a thin description compound: the reviewer must both wade through the diff *and* reverse-engineer the intent. The description is half the author's contract.

---

## Test Yourself

1. Per the SmartBear/Cisco data, roughly where is the "sweet spot" for PR size, where is the practical ceiling, and what happens beyond it?
2. Name two *second-order* costs of a large PR (beyond "bugs get missed").
3. Why is mixing a refactor with a behaviour change the most dangerous kind of large PR — and what's the split?
4. What's the difference between a vertical slice and a horizontal layer, and why prefer vertical?
5. How do feature flags let a large feature ship as many small PRs, and what's the obligation they create?
6. What problem do *stacked PRs* solve that feature flags don't, and why do you usually need a tool on GitHub?
7. A reviewer says "could you also add metric X while you're here?" What's the disciplined response and why?

<details>
<summary>Answers</summary>

1. Sweet spot ~**200** changed LOC; practical **ceiling ~400**; beyond ~400–500 review quality **collapses** — the reviewer stops finding defects and approves on trust, because attention (and the ~60-minute / ~500-LOC-per-hour limits) runs out.
2. Any two of: longer time-to-first-review (reviewers defer big PRs); more rebases/conflicts as `main` drifts while it waits; re-review cost after each rebase; larger rollback blast radius; more WIP held open and more author context-switching.
3. The behaviour delta hides inside hundreds of mechanically-changed but behaviourally-identical lines, so the reviewer scrolls past the lines that actually change what the program does. Split into a **pure refactor PR** (verify "nothing changed," tests untouched) and a **small behaviour PR** (the whole diff *is* the new behaviour).
4. A **vertical slice** delivers one thin behaviour through every layer (migration + API + UI for one field); a **horizontal layer** ships one layer across all features. Prefer vertical because each slice is independently testable, shippable, and user-visible — horizontal forces approving code with no caller and ships nothing until the last PR.
5. Merge incomplete/risky code to trunk with the new path **behind a flag, off in production**, landing many small PRs continuously instead of one long-lived branch (enables trunk-based dev). The obligation is **flag lifecycle/cleanup** — delete the flag and the dead branch once the rollout is complete, or it becomes permanent debt.
6. Stacks solve **inherently sequential** changes where later steps depend on earlier ones — which flags can't make independent. You need a tool (Graphite/ghstack/git-branchless) because **GitHub has no first-class dependent-PR chain**: native stacked PRs show cumulative diffs and require manual base retargeting and stack rebasing.
7. *"Good idea — not part of this change; filed as a follow-up (#NNNN)."* Growing the PR to satisfy the comment is scope creep that turns a focused, reviewable change un-reviewable; a follow-up preserves the idea without inflating the current PR.

</details>

---

## Cheat Sheet

```text
THE SIZE DATA (SmartBear/Cisco)
  ~200 LOC   sweet spot — highest defect density found
  ~400 LOC   practical ceiling — effectiveness drops sharply
  >400-500   review COLLAPSES — rubber-stamp territory
  ~60 min / ~500 LOC-per-hr   the same exhaustion limit, reframed
  Google: "small CLs" = as small as possible while still complete & self-contained

SPLITTING (find the seam, don't chop evenly)
  1. Refactor  ≠  behaviour   ← the cardinal cut, do this first
  2. Vertical slice (end-to-end) over horizontal layer (one layer, all features)
  3. Clean atomic commits → lift commit boundaries into separate PRs
  4. Preparatory refactor first  ("make the change easy, then the easy change")

FEATURE FLAGS  (enabler of small PRs / trunk-based dev)
  merge incomplete code OFF in prod → ship increments, no long-lived branch
  lifecycle: introduce → build → roll out → DELETE flag + dead branch

STACKED PRs  (for inherently-dependent steps)
  chain of small dependent PRs, reviewed individually, merged bottom-up
  rebase the whole stack when a lower PR changes
  GitHub native = weak → use Graphite / ghstack / Gerrit / git-branchless

SCOPE
  one logical change per PR
  "could you also…"  → file a follow-up, don't grow the PR
  drive-by: small+obvious+adjacent → fold in; larger/unrelated → own PR
  draft PR for early/directional feedback

AUTHOR'S CONTRACT
  small  +  clear description (what & why, not how)  +  self-reviewed
```

---

## Summary

- The size→quality relationship is a **cliff, not a slope**: per the SmartBear/Cisco data, defect detection is best around ~200 LOC, degrades past ~400, and **collapses** beyond ~400–500. Google codifies this as the "small CLs" doctrine. Smallness is a defect-detection mechanism, not a style choice.
- Large PRs also carry **second-order costs** — longer latency, more rebases/conflicts, re-review churn, bigger rollback blast radius, more WIP — which is why "more small PRs = more overhead" is a weaker objection than it sounds.
- The **cardinal split is refactor-vs-behaviour**: a pure refactor is mechanically verifiable, a behaviour change is small and visible, and mixing them hides the real change in mechanical noise. Beyond it: vertical slices over horizontal layers, atomic commits as a splitting plan, and preparatory refactoring first.
- **Feature flags** decouple deploy from release, letting a large feature ship as a stream of small PRs (trunk-based development) — at the cost of a flag-cleanup obligation.
- **Stacked PRs** give small-PR review quality to inherently sequential changes; GitHub's native support is weak, so reach for Graphite / ghstack / Gerrit / git-branchless.
- **Scope discipline** keeps a PR to one logical change: defer "could you also…" to follow-ups, keep drive-bys tiny, use draft PRs for early feedback. The author's contract is *small + clear description + self-reviewed* — a gift to the reviewer's finite attention.

---

## Further Reading

- **Google Engineering Practices — "Small CLs"** (google.github.io/eng-practices, *Code Review Developer Guide*) — the canonical case for small changelists and how small is small enough.
- **SmartBear / Cisco — *Best Kept Secrets of Peer Code Review*** — the source of the ~200/~400 LOC, ~60-minute, and ~500-LOC/hour findings; the largest published code-review study.
- **Kent Beck — "make the change easy, then make the easy change"** (and his note that "the second part can be hard") — the preparatory-refactoring principle in one sentence.
- **Graphite — stacked-diffs docs** (graphite.dev) — the workflow, tooling, and rationale for stacking PRs on top of GitHub; compare with **ghstack** (Meta) and **git-branchless**.
- *Software Engineering at Google* (Winters, Manshreck & Wright) — the code-review chapters on CL size, attention to the author, and review tempo.
- [senior.md](senior.md) — splitting genuinely entangled changes, stacking at scale, flag platforms and debt, and the org-level economics of small PRs.

---

## Related Topics

- [01 — What to Look For & In What Order](../01-what-to-look-for-and-order/middle.md) — a small, single-purpose PR is what makes the order-of-operations review actually tractable.
- [05 — Giving & Receiving Feedback](../05-feedback-giving-and-receiving/middle.md) — self-review first, and how to defer "could you also…" without losing the idea.
- [07 — Review Metrics & Tempo](../07-review-metrics-and-tempo/middle.md) — PR size as an upstream driver of review latency and WIP.
- [08 — Review Anti-patterns](../08-review-anti-patterns/middle.md) — scope creep via "could you also…" and the rubber-stamp failure mode of oversized PRs.
- [Quality Gates](../../quality-gates/) — the policy layer (required approvals, CODEOWNERS, merge queues) that small, frequent PRs flow through.
