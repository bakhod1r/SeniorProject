# What to Look For & In What Order — Senior Level

> **Roadmap:** [Code Review](../README.md) → What to Look For & In What Order
> *The middle page gave you a checklist. This page is about the discipline behind it: review is defect detection under a finite, decaying attention budget, so the order is an optimization — front-load the defects that are severe, hard to catch, and expensive to fix, and the only way to catch them is to reconstruct context the diff threw away.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Attention Budget and the Inspection-Rate Data](#core-concept-1--the-attention-budget-and-the-inspection-rate-data)
5. [Core Concept 2 — The Order Is an Expected-Value Optimization](#core-concept-2--the-order-is-an-expected-value-optimization)
6. [Core Concept 3 — The Layers of Understanding](#core-concept-3--the-layers-of-understanding)
7. [Core Concept 4 — Context Reconstruction: Reading Beyond the Diff](#core-concept-4--context-reconstruction-reading-beyond-the-diff)
8. [Core Concept 5 — The Behavioral Change With No Local Diff](#core-concept-5--the-behavioral-change-with-no-local-diff)
9. [Core Concept 6 — Read the Tests First as Spec Reconstruction](#core-concept-6--read-the-tests-first-as-spec-reconstruction)
10. [Core Concept 7 — Move Design Review Left](#core-concept-7--move-design-review-left)
11. [Core Concept 8 — Severity, the Cost of a Comment, and Calibration](#core-concept-8--severity-the-cost-of-a-comment-and-calibration)
12. [Core Concept 9 — Reviewing What You Cannot Read Line-by-Line](#core-concept-9--reviewing-what-you-cannot-read-line-by-line)
13. [Real-World Examples](#real-world-examples)
14. [Mental Models](#mental-models)
15. [Common Mistakes](#common-mistakes)
16. [Test Yourself](#test-yourself)
17. [Cheat Sheet](#cheat-sheet)
18. [Summary](#summary)
19. [Further Reading](#further-reading)
20. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Review as a disciplined defect-detection process — what a finite attention budget should be spent on, in what order, and how to reconstruct the context the diff destroyed.**

By the middle level you have a checklist: correctness, then design, then tests, then readability, with style left to tooling. That checklist is correct, and it is not enough. It tells you *what* the categories are; it does not tell you *why* that order, *when* to abandon it, or *what to do* when the most important defect in a change leaves no visible mark in the diff.

The senior jump is to stop treating review as "read the code and comment on it" and start treating it as an **optimization problem under a hard constraint**. The constraint is your attention: it is finite per session and it decays fast — the data says defect-detection efficiency collapses past roughly 400–500 lines of code and roughly 60 minutes. Given that constraint, the order is not a style preference. It is the allocation of a scarce resource to maximize expected defects caught, weighted by their severity and by how expensive they are to fix later. You front-load the classes that are high-severity, hard to catch by machine, and expensive to fix on a finished PR — correctness, concurrency, design/architecture, security — and you push the cheap, automatable classes (formatting, import order, lint) onto tools so they never touch your budget at all.

The other half of the senior skill is **context reconstruction**. A diff is a lossy, decontextualized view: it shows you changed lines, not the system those lines live in. The defect that bites in production is frequently the one with no local diff — a flipped condition upstream, a removed guard, a changed default — where the dangerous code is the code that *didn't* change but now runs in a new world. Catching that requires reading the callers, the type's other methods, the deleted code, and the invariants the diff silently broke, and knowing *when* that effort is worth it. This page is that layer.

---

## Prerequisites

- **Required:** You've internalized [middle.md](middle.md) — the review pass order (correctness → design → tests → readability → style-to-tooling) and how to leave a non-blocking, kind, specific comment.
- **Required:** You've reviewed enough real PRs to have approved one that later broke production, and sat with *why you missed it*.
- **Helpful:** You've authored a large or contentious PR and felt the cost of a reviewer's nitpicks burying their one important comment.
- **Helpful:** A working sense of your own codebase's invariants — the things that are true everywhere and never written down.

---

## Glossary

- **Attention budget** — the finite, decaying amount of focused scrutiny a reviewer can apply in one session before defect-detection efficiency falls off a cliff. The central constraint of this page.
- **Inspection rate** — lines of code reviewed per hour. The single strongest predictor of defect-detection efficiency in the inspection literature; high rates mean rubber-stamping.
- **Defect-detection efficiency** — the fraction of latent defects a review actually finds. Falls sharply as inspection rate and session length rise.
- **Context reconstruction** — the work of rebuilding the change's real meaning by reading beyond the diff: callers, siblings, deleted code, invariants.
- **Behavioral change with no local diff** — a change in runtime behavior caused by code that *wasn't* modified, triggered by something that was (a flipped flag, removed guard, changed default).
- **Spec reconstruction** — inferring what the code is *supposed* to do by reading its tests as the executable specification.
- **Severity** — the cost if a defect ships, combining blast radius and likelihood. Distinct from how *visible* or *easy-to-comment-on* the issue is.
- **Shift-left (for review)** — moving the most expensive feedback ("wrong approach") earlier — to design docs and draft PRs — where redirecting costs hours, not a rewritten week.

---

## Core Concept 1 — The Attention Budget and the Inspection-Rate Data

Everything on this page descends from one empirical finding: **review quality is governed by how fast and how long you review, not by how hard you try.**

The numbers are unusually consistent across decades and methodologies. Michael Fagan's original IBM inspection work (1976) established that formal inspections found defects at a rate that collapsed when reviewers went too fast or sat too long, and recommended an inspection rate well under 200 lines per hour for the formal process. The largest modern dataset — SmartBear's study at Cisco of ~2,500 reviews across ~50 developers — found the same shape with concrete thresholds:

| Variable | Threshold past which detection collapses | Source |
|---|---|---|
| Lines of code per review | **~200–400 LOC** (efficiency drops sharply past 400; near zero past ~800) | SmartBear/Cisco |
| Inspection rate | **~300–500 LOC/hour** (faster → defects missed) | SmartBear/Cisco; Fagan |
| Session duration | **~60 minutes** (attention and detection fall after) | SmartBear/Cisco |
| Defect density found | Highest in **small** reviews; falls as size grows | SmartBear/Cisco |

The mechanism is not laziness. It is that scrutiny is cognitively expensive and the supply is fixed. Past ~60 minutes or ~400 lines, you are still moving your eyes over code, but you have stopped *finding* things — you are pattern-matching and approving. The dangerous part is that the reviewer doesn't feel the cliff; the comments keep coming, they're just increasingly about whitespace and decreasingly about defects, because the cheap-to-spot issues are all that's left within the depleted budget.

```
DEFECT-DETECTION EFFICIENCY vs. CHANGE SIZE  (schematic, from inspection data)

  efficiency
    high |■■■■■■■
         |       ■■■■■
         |            ■■■■
         |                ■■■
         |                   ■■■
     low |                      ■■■■■■■■■■■■■■■■■■■■■■
         +----------------------------------------------
           100   200   400   600   800  1000   LOC reviewed
                       ^cliff
```

> **Key insight:** The attention budget is the *only* reason review order matters. If scrutiny were infinite, you could read everything with equal care in any sequence and miss nothing. Because it is finite and decaying, every minute you spend on something a linter could have caught is a minute stolen from the concurrency bug — and the concurrency bug is what wakes you at 3 a.m. Order is triage for a depleting resource.

The first, highest-leverage move is therefore not about order at all: it's about **protecting the budget**. Every class of issue you can hand to a machine — formatting, import sorting, lint rules, type checks, dead-code detection — must be handed to a machine, in CI, before a human ever opens the diff. A reviewer who is commenting on formatting is a reviewer who has been handed a job that a `gofmt`/`prettier`/`ruff` invocation does perfectly and for free, and who is now spending finite attention on it. See [Static Analysis & Linting](../../static-analysis/) — that section exists precisely so this one doesn't have to.

---

## Core Concept 2 — The Order Is an Expected-Value Optimization

Given a finite budget, the order to spend it in falls out of a simple expected-value calculation. For each class of issue, weigh:

- **Severity** — what it costs if it ships (blast radius × likelihood).
- **Detectability-by-human** — how much it *needs* a human; can a tool catch it instead?
- **Cost-to-fix-late** — how expensive it is to fix once the PR is merged or, worse, in production.

You spend your freshest attention where `severity × cost-to-fix-late` is high *and* a machine can't help. That ranking is stable across almost every codebase:

| Pass | Class | Severity | Tool can catch? | Cost to fix late | Budget priority |
|---|---|---|---|---|---|
| 1 | **Correctness** (logic, edge cases, data loss, error paths) | High | Rarely | High | **First — freshest attention** |
| 2 | **Concurrency / ordering / idempotency** | Very high | Almost never | Very high (heisenbugs) | First |
| 3 | **Design / architecture / API shape** | Very high | No | **Highest** (rewrite) | First — but see Concept 7 |
| 4 | **Security** (authz, injection, secrets, SSRF) | Very high | Partly (SAST) | Very high | First |
| 5 | **Tests** (do they exist and constrain behavior?) | High | No | Medium-High | Early |
| 6 | **Maintainability / readability / naming** | Medium | Partly | Low (cheap later) | After the above |
| 7 | **Style / formatting / lint** | Low | **Yes — fully** | Trivial | **Never (CI does it)** |

The non-obvious consequences of reading this as a budget allocation, not a checklist:

1. **Style is not "last," it's "never."** If it reaches a human, the pipeline is broken.
2. **Design can't always go "first within the PR" — it has to go *earlier than the PR*.** A finished PR with the wrong approach is the single most expensive failure mode in review (Concept 7), because the cost-to-fix-late is a full rewrite. The fix is to spend design attention before code exists.
3. **The order is also a *stopping rule*.** If pass 1 finds a correctness bug that invalidates a whole function, you do not then spend budget on that function's variable names. You surface the big thing and stop; commenting on the names of code that's about to be deleted is pure waste — and it actively buries the important comment.

> **Key insight:** Reviewers reliably invert this ranking under time pressure, and it's a predictable failure of the budget model. Cheap-to-spot, low-severity issues (a misaligned brace, a slightly-off name) are *easy* and produce the comforting sensation of "I reviewed this." Expensive-to-spot, high-severity issues (a race, a missing rollback path) are *hard* and require sustained thought. A depleting budget naturally flows toward the easy issues — which is exactly backwards. The discipline is to spend the first, freshest minutes on the hardest, most severe class *on purpose*, before fatigue makes that impossible.

---

## Core Concept 3 — The Layers of Understanding

A reviewer doesn't evaluate code directly; they build understanding in layers, and each layer is a prerequisite for judging the next. Skipping a layer doesn't speed you up — it makes every later judgment unreliable.

```
INTENT          what is this change trying to do?          (description, issue, design doc)
   ↓            — you cannot judge "correct" without knowing "correct for what"
CONTRACT        what does it promise?                      (signatures, types, public API, tests)
   ↓            — the interface it offers the rest of the system
CORRECTNESS     does the implementation honor the          (read every path against the contract)
   ↓            contract on ALL paths?
FIT             does it cohere with the system?            (patterns, layering, duplication, deps)
   ↓            — locally correct but globally wrong is still wrong
MAINTAINABILITY can the next person change it safely?      (names, structure, tests, docs)
```

The layers are strictly ordered because **each is the standard against which the next is judged**:

- You cannot assess **correctness** without the **contract**, and you cannot infer the contract's *purpose* without **intent**. "Is this `if` right?" is unanswerable until you know what the function promises and why it exists. This is why a PR with an empty description is so much slower to review well — the bottom layer is missing, so every judgment above it is guesswork.
- You cannot assess **fit** without correctness — there's no point checking whether correct code matches the system's patterns if it isn't correct yet.
- **Maintainability** sits on top because it's about the *next* change, which only matters once this one works and fits.

The senior move is to make the bottom layers explicit before reading code. Read the PR description, the linked issue, and the design doc *first*. If intent isn't stated, that is itself the first finding — and it's a high-value one, because a change whose author can't articulate its intent is a change whose author may not know whether it's correct.

> **Key insight:** Most "I reviewed it and it still broke" stories are a layer-skip. The reviewer read the changed lines (jumped straight to correctness) without establishing intent and contract, so they verified that the code *does what it does*, not that it does *what it should*. Tautological correctness — "yes, this line assigns that value" — feels like reviewing and catches nothing. Always anchor on intent before you judge a single line.

---

## Core Concept 4 — Context Reconstruction: Reading Beyond the Diff

The diff is a lossy projection. It shows added and removed lines with a few lines of surrounding context, and it deliberately hides everything else — the callers, the rest of the type, the invariants, the parts of the function that didn't change. Reviewing "the diff as presented" means reviewing that projection, and the most dangerous defects live in what the projection dropped.

**Context reconstruction** is the deliberate act of rebuilding the real change. The senior skill is not "always read the whole file" (that doesn't scale and burns budget) — it's knowing *which* surrounding context a given change makes load-bearing, and reading exactly that.

What to reconstruct, and the trigger that makes it necessary:

| Reconstruct… | Because… | Trigger to do it |
|---|---|---|
| **Callers** of a changed function | The diff shows the new behavior, not whether 30 call sites still hold | Signature, return semantics, error contract, or nullability changed |
| **The deleted code** | A removed guard/check is invisible if you only read what's added | Any non-trivial deletion; net-negative diffs are *not* automatically safe |
| **The type's other methods** | An invariant maintained elsewhere may now be broken | A field's lifecycle or mutation rules changed |
| **The invariant the diff breaks** | Invariants are rarely written down; the diff won't announce it | "Is something that was always true here no longer true?" |
| **The default / config** | A flipped default changes behavior with no logic diff | A default value, feature flag, or constant moved |

Concretely — a diff that looks trivially safe:

```diff
  func (c *Cache) Get(key string) (*Entry, error) {
-     c.mu.RLock()
-     defer c.mu.RUnlock()
      e, ok := c.entries[key]
      if !ok {
          return nil, ErrNotFound
      }
      return e, nil
  }
```

The added lines are *nothing* — the change is a **deletion**. Reading only the green lines, you see an unremarkable map lookup and approve. Reconstructing the deleted code, you see that the read lock was removed, and now `Get` races with any concurrent `Set`. The defect is entirely in the red lines, has no replacement in green, and is a data race that may pass every test run and corrupt memory in production. *Net-negative diffs are where guards go to die.*

When reading cannot establish correctness at all, **stop reading and run it.** Reconstruction has a ceiling: for some changes, no amount of staring at the diff tells you whether it's correct, and pretending otherwise is how you approve broken UI and corrupt data. Pull the branch and run it when the change is:

- **UI / rendering** — you cannot review pixels, focus order, or layout shift from a JSX diff. Build it and look.
- **Data migrations** — run it against a realistic copy; verify the down-migration; check row counts and a sample. A migration reviewed only by reading is a migration reviewed by hope.
- **Concurrency** — run it under the race detector / TSan with load; a clean read is necessary but never sufficient for a race.
- **Anything where the diff is a generated artifact** of something else (Concept 9).

> **Key insight:** The question that separates a senior reviewer is not "is this diff correct?" but "**what did this diff change that the diff doesn't show?**" The diff is the *symptom* of a change; the change itself lives in the system. Reviewing the symptom and trusting it is the root cause of the entire category of bugs in the next concept.

---

## Core Concept 5 — The Behavioral Change With No Local Diff

The purest expression of "read beyond the diff" is the change whose dangerous effect appears in code that *wasn't modified*. The diff is small, local, and obviously correct; the bug is somewhere the diff doesn't touch, activated by what the diff did.

**Example A — a flipped default.** The diff changes one line in a config struct:

```diff
  type ServerConfig struct {
      MaxConnections int
-     ReuseSockets   bool   // default false
+     ReuseSockets   bool   // default true
  }
```

The diff is one comment and a default. There is no logic change *in the diff*. But somewhere in unchanged code, `if cfg.ReuseSockets { ... }` now takes a branch it never took in production, exercising a connection-reuse path that was dead code for two years and was never load-tested. The entire risk of this PR is in code with no diff, reachable only by asking "what previously-dead path does this default switch on?"

**Example B — a removed guard upstream.** A diff removes an early-return validation in `handleRequest`. Three layers down, `processPayment` was written assuming the request had already been validated — it never re-checks because it "couldn't" receive an invalid one. The diff to `handleRequest` is small and looks like a reasonable simplification. The defect is a now-reachable unvalidated path in `processPayment`, which has *no diff at all*.

**Example C — a flipped condition that inverts a downstream branch.** A diff changes `if err != nil` to `if err == nil` in a helper that decides whether to retry. The helper's diff is one character. Downstream, an unchanged retry loop now retries on *success* and gives up on *failure* — an inversion with catastrophic behavior and a one-character, easy-to-miss diff.

The defense is a habitual question on every non-trivial change:

> *"This diff changes behavior. Where does the new behavior actually execute, and is that place in the diff?"*

If the answer is "the affected code is **not** in the diff," you have found exactly the situation where reviewing the diff-as-presented fails, and you must reconstruct the affected sites yourself. Tools help — "find usages," "git blame," running the test that exercises the path — but the *trigger* is a mental discipline, not a tool.

> **Key insight:** A small diff is not a small change. Diff size measures *edit* magnitude; risk is a property of *behavioral* magnitude, and the two are uncorrelated. The one-character `==`→`!=` and the one-line default flip are the smallest possible diffs and among the highest-risk changes you will ever review. Calibrate scrutiny to behavioral blast radius, never to line count.

---

## Core Concept 6 — Read the Tests First as Spec Reconstruction

Tests are the executable specification. Reading them first is the fastest way to reconstruct the contract layer (Concept 3) — they tell you, in concrete cases, what the author believes the code should do. But the senior skill is not "check that tests exist." It's **judging whether the tests actually constrain behavior** — because a test that passes regardless of whether the code is correct provides exactly zero defect-detection, while costing the budget to read and lending false confidence.

The failure modes, each of which looks like coverage and provides none:

- **Assertion-free tests.** The test calls the function, no error is thrown, the test passes. It asserts *nothing* about the result. It catches only "it didn't crash."

```python
def test_calculate_discount():
    result = calculate_discount(cart, coupon)   # no assertion at all
    # passes whether result is 0.10, 0.90, or None
```

- **Testing the mock.** Everything the function touches is mocked, and the assertions check that the mocks were called. The test verifies the function calls what the author *wrote it to call* — a tautology that passes for any implementation that makes the same calls, including a wrong one.

```python
def test_charges_customer():
    gateway = Mock()
    service = PaymentService(gateway)
    service.charge(order)
    gateway.charge.assert_called_once_with(order.total)   # only checks "we called the mock"
    # no assertion that order is marked paid, that partial failures roll back, etc.
```

- **Over-mocking.** So much is replaced by test doubles that the test exercises no real logic — it confirms the doubles do what they were configured to do. (See [mocking-strategies] in the [Testing](../../testing/) section for the over-mocking smell.)
- **Snapshot rubber-stamp.** A snapshot is committed and "updated" whenever it changes. If reviewers approve snapshot updates without reading them, the snapshot constrains nothing — it just records whatever the code currently produces, bug included.

The most valuable test-related finding, though, is the test that *isn't there*. A **missing test is the highest-signal design smell** in a PR, for two compounding reasons:

1. **It's an uncovered behavior** — the obvious cost.
2. **It's frequently a *design* signal.** If a behavior is hard to test, the design is usually hard to use: hidden dependencies, no seam to inject a fake, time/IO/global state baked into the logic. "Why is this hard to test?" surfaces design problems that a pure logic read misses. The absence of a test for the error path often means the author never thought about the error path — which is also the bug.

> **Key insight:** "Has tests" and "is tested" are different claims, and reviewers routinely accept the first as the second. Read the assertions, not the test count. Ask of each test: *if I introduced the most likely bug in this code, would this test fail?* If the honest answer is no, the test is theater — and worse than no test, because it converts the budget you spent reading it into false confidence. A green suite over assertion-free tests is more dangerous than a red one.

---

## Core Concept 7 — Move Design Review Left

The most expensive feedback a reviewer can give is "**this is the wrong approach**" on a finished PR. The author has spent days; the diff is large; the tests are written; the change *works*. Asking for a fundamentally different design now costs a rewrite, and it costs morale — which is why reviewers so often *don't*, and instead approve a design they'd never have chosen, letting the wrong shape calcify into the codebase forever.

The cost-to-fix-late curve makes the conclusion unavoidable: design feedback gets exponentially more expensive the later it lands. So the senior moves it left, off the PR entirely where possible:

```
COST TO REDIRECT  vs.  WHEN DESIGN FEEDBACK LANDS

  cost
  high |                                              ■  "wrong approach"
       |                                         ■        on a finished PR
       |                                    ■             (full rewrite + morale)
       |                              ■
       |                       ■
       |               ■
   low |  ■    ■                                      
       +------------------------------------------------
        idea  design  draft   early   "done"   merged
              doc     PR      PR
        ^------- review design HERE -------^
```

What "left" looks like in practice:

- **Design docs and RFCs** — for anything non-trivial, the right shape is debated in a doc before code exists, where redirecting is a comment, not a rewrite. [Documentation › ADRs/RFCs] covers the format.
- **Draft / WIP PRs** — open the PR early, explicitly "is this the right shape?", before the implementation is polished. Feedback at 20% done costs 20% of the rework.
- **An early ping** — a 10-minute "I'm about to build X this way, sound right?" message can save a week. This is the highest-ROI review activity that doesn't look like reviewing.

And **the order within a single PR** follows from the same logic: surface the big thing first. If the whole approach is wrong, do not leave thirty inline nits on the functions inside it. Those comments are about code that's about to be deleted; they waste the author's time, waste your budget, and — worst of all — *bury* the one comment that matters under a pile of noise, so the author fixes the brace alignment and misses that you said the design is wrong. Lead with the architectural call, in the summary, clearly, and hold the line-level feedback until the shape is agreed.

> **Key insight:** If you are routinely giving "wrong approach" feedback on finished PRs, the defect isn't in the PRs — it's in *when your team reviews design*. The PR is the wrong venue for the most expensive class of feedback, because by the time a PR exists the expensive thing is already built. Reviewing the design at PR time is reviewing it too late by construction. Push it upstream to docs and drafts, and reserve PR review for "is this implemented correctly," which is what PR review is actually good at.

---

## Core Concept 8 — Severity, the Cost of a Comment, and Calibration

A comment is not free. It costs the author's time to read, evaluate, possibly argue with, and act on; it can derail a thread into bikeshedding; and in aggregate, comment volume trains authors either to dread review or to tune it out. So a senior reviewer **calibrates each comment to its impact** and is deliberate about which ones block.

A practical taxonomy, made explicit so author and reviewer share a vocabulary:

| Prefix | Meaning | Blocks merge? |
|---|---|---|
| **`blocking:`** | Must be addressed before merge (correctness, security, data loss, API mistake) | Yes |
| **`(no prefix)`** | Normal suggestion; author should consider and respond | Author's judgment |
| **`nit:`** | Minor/optional; preference or polish | No |
| **`question:`** | Genuine question; the answer may or may not need a change | No |
| **`fyi:` / `praise:`** | Information, or pointing out something done well | No |

The discipline this enforces:

- **Most comments are not blocking.** Reserve blocking for things that are actually wrong, not things you'd have done differently. "I'd structure this differently" is a `nit:` or a non-blocking suggestion unless the author's structure is *wrong*, not merely *not yours*.
- **Prefer "approve with comments" over a round-trip.** If your remaining comments are nits and small suggestions, approve and trust the author to apply them. A blocking re-review for cosmetic issues spends two engineers' time to enforce a preference. (Google's guidance: lean toward approval; don't hold a CL hostage to perfection — "LGTM with comments" is a feature.)
- **The cost of a comment scales with the thread it spawns.** A vague comment ("this feels off") spawns a clarification thread; a specific one with a suggestion ("`blocking:` this misses the empty-slice case; want `if len(xs) == 0 { return 0 }`") resolves in one turn. Specificity is budget-saving for *both* people.

**Calibration across reviewers** is the team-level version of this. If reviewer A blocks on missing tests and reviewer B never mentions them, authors learn that the standard is "who reviewed me," not "the bar." Consistency comes from a shared, written standard (a review guide, agreed severity prefixes) so that the same change gets substantially the same feedback regardless of who's assigned. Inconsistent standards are a tax: authors optimize for the lenient reviewer, and the strict reviewer becomes "the blocker" rather than "the bar."

Finally — **review for the author's growth, not just the code's correctness.** Google's *Code Review Developer Guide* makes this explicit: a review is an opportunity to teach and to learn, and the author is part of what you're optimizing. A comment that explains *why* ("this allocation is in a hot loop, so X") builds the author so the next PR doesn't need the comment; a terse "change this" fixes one line and teaches nothing. The growth lens also tempers the cost-of-a-comment calculus: a well-placed teaching comment can be worth its cost even when the issue is minor, *if* it transfers a durable skill. The anti-pattern is the reviewer who treats every PR as a place to prove they're smarter than the author — which is expensive, demoralizing, and the fastest way to make people stop sending you their hard changes.

> **Key insight:** Every comment is a small withdrawal from the author's time and the team's goodwill, and a large pile of low-value comments can bankrupt both — the author stops reading carefully, and your one critical comment drowns. Spend comments where they buy correctness, safety, or a durable skill; let tooling and the author's own judgment cover the rest. A review with three high-value comments beats one with thirty mixed ones, every time.

---

## Core Concept 9 — Reviewing What You Cannot Read Line-by-Line

Sometimes a PR is genuinely too large to read line-by-line and *shouldn't* be split: a mechanical mass rename, a generated-client regeneration, a framework codemod, a 4,000-line data migration. The middle-level rule ("small PRs") still holds for hand-written change — but for *mechanical* change, splitting is busywork and reading every line is both impossible and pointless. The senior skill is **how to review what you can't read.**

The technique is **trust, but verify the transformation, not the output**:

1. **Separate the mechanical from the meaningful.** A good PR (and a good author) isolates the generated/mechanical change into its own commit or PR, distinct from any hand-written change. Your *entire* line-by-line attention goes to the hand-written part; the mechanical part gets a different kind of review. If the two are mixed, that's your first finding — ask the author to split them, because a hand-written bug hidden in 4,000 generated lines is invisible.

2. **Verify the generator/command, not every line of output.** For generated code: review the *spec* or the *command* that produced it (the proto file, the OpenAPI spec, the codemod script, the migration generator config), and confirm you can regenerate the same output. The output is a *function* of the input; review the input and the function, and the output follows. You are reviewing `f(x)` by reviewing `f` and `x`.

3. **Spot-check the mechanical transformation.** For a mass rename or codemod, you can't read 800 sites, but you *can* read a representative sample across the variety of contexts — the simple case, the edge case (the rename inside a string? a comment? a generated file?), and the one place you suspect the tool got wrong. If the sample is correct and the transformation is uniform, the population is very likely correct.

4. **Lean on the diff's *shape*, not its contents.** A mechanical change should produce a *uniform* diff — the same transformation everywhere. Scan for the line that *doesn't* match the pattern: in a rename of `getUser` → `fetchUser`, the one hunk that also changed an argument is the hand-edit hiding in the mechanical change, and it's exactly where a bug lives. Your eye is good at spotting the irregular row in a regular table; use that.

5. **Demand and run the verification.** For migrations: the down-migration, the row-count assertions, the dry-run output against a prod-shaped dataset. For codemods: the test suite, green, before and after. You are not certifying every line; you are certifying that the *process* that produced the lines is sound and its output is validated.

> **Key insight:** For mechanical change, the unit of review is the **transformation**, not the lines. Reading 4,000 generated lines is not more rigorous than reviewing the spec and spot-checking — it's *less* rigorous, because no human reads 4,000 lines carefully, so "I read it all" means "I rubber-stamped it all." Verify the function and its inputs, spot-check the output, look for the irregular hunk, and run the verification. That is a *more* reliable review than a heroic, doomed line-by-line read.

---

## Real-World Examples

### Annotated senior review of a non-trivial PR

A PR titled *"Add caching to the user-permissions service"*: ~350 lines, touching `PermissionService`, a new `permissionCache` type, config, and tests. Here is the order a senior works it, and why.

**Step 0 — Intent & contract, before any code.** Read the description and linked issue. Intent: cut p99 latency on the permission check, which is on the hot path of every request. Immediately this tells me the *risk profile*: a cache on an authorization decision means **stale permissions are a security bug** — a revoked admin who stays admin until the TTL expires. That single inference, drawn from intent before reading a line, becomes the spine of the review.

**Step 1 — Design shape, surfaced first.** Skim the structure: is this a read-through cache, write-through, or cache-aside? It's cache-aside with a 5-minute TTL and *no invalidation on permission change*. That's the big thing, and it goes in the summary first:

> `blocking:` (design) This caches authz decisions with a 5-min TTL and no invalidation on revoke, so a revoked user keeps access for up to 5 minutes. For permissions that's a security regression. Can we invalidate on the permission-change event, or is the staleness window acceptable to security? Let's settle this before I review the implementation details — it may change the shape.

I do **not** now leave fifteen nits on the cache's internals. The design call may delete or reshape them; commenting on them buries the one comment that matters.

**Step 2 — Correctness & concurrency (freshest attention spent here).** Assuming the design holds, read the cache implementation against its contract on all paths. The cache is a `map` with a `sync.RWMutex`. Reconstruct: is every read under `RLock`, every write under `Lock`? Is there a check-then-act race on miss (two goroutines both miss, both compute, both write — tolerable here, but is the *computation* idempotent)? **This is where I pull the branch** and run the permission tests under `-race` with concurrency, because no amount of reading proves the absence of a data race.

**Step 3 — The behavioral-change-with-no-diff check.** The PR also flips a config default: `PermissionCacheEnabled: true`. That one-line default means a previously-dead caching path is now live for *every* request in production, never load-tested. I check what that path does on cache-miss-storm at startup (thundering herd against the permission DB) — a risk entirely in code the diff barely touches.

**Step 4 — Tests as spec.** Read the assertions. There's a test `TestCacheHit` — does it assert the *returned permissions*, or just that the cache was called? It asserts the latter (testing the mock). And there is **no test for invalidation** (because there's no invalidation — the missing test *is* the design bug from Step 1, confirmed from a second angle). Findings:

> `blocking:` `TestCacheHit` asserts `cache.Get` was called but not that the returned permission set is correct — it'd pass with a cache that returns the wrong perms. Assert the actual returned value.
> The absence of an invalidation test is the same gap as the design comment above — once we decide on invalidation, we'll need a test that a revoke is reflected within the agreed window.

**Step 5 — Maintainability, briefly, only if Steps 1–4 are resolved.** Names, the one function that's doing two things, a missing doc comment on the exported `permissionCache`. All `nit:`-level. If the design is getting reworked, I hold these entirely.

The shape of the whole review: **one blocking design comment surfaced first, one blocking correctness/test comment, a branch pull for the race, a no-diff risk flagged — and the nits held until the big things land.** Total comments that matter: three. That is a senior review.

### A "small" PR that wasn't

A one-line PR: change a feature flag's default from `false` to `true`. Diff: one line. The temptation is an instant LGTM — it's *one line*. The senior question — "where does the new behavior execute, and is it in the diff?" — reveals that flipping the flag activates a 1,200-line feature path that was merged behind the flag months ago and *never enabled in production*. The real change isn't the one line; it's 1,200 lines of newly-live code. The right review is "let's verify this path is actually load-tested and monitored before we flip it," not LGTM. Diff size lied; behavioral size told the truth.

---

## Mental Models

- **Review is triage for a depleting resource.** You have a finite, decaying attention budget; the order is how you allocate it to maximize `expected defects caught × severity`. Spend the freshest minutes on the hardest, most severe, least-automatable class — correctness, concurrency, design, security — and let machines have everything they can do.

- **Understanding is built in layers, bottom-up.** Intent → contract → correctness → fit → maintainability. Each layer is the standard for the next; skip one and every judgment above it is guesswork. "Is this line right?" is unanswerable without "right for what?"

- **The diff is the symptom; the change is in the system.** A diff is a lossy projection that hides callers, deletions, siblings, and invariants. Ask not "is this diff correct?" but "what did this diff change that the diff doesn't show?" — because the worst bugs have no local diff.

- **Small diff ≠ small change.** Edit size and behavioral blast radius are uncorrelated. The one-character `==`→`!=` and the flipped default are the smallest diffs and the highest risks. Calibrate scrutiny to behavior, not to line count.

- **"Has tests" ≠ "is tested."** Read assertions, not test counts. Ask: would this test fail if I introduced the most likely bug? A green suite over assertion-free tests is more dangerous than a red one. The missing test is the highest-signal design smell.

- **Design feedback is exponentially cheaper earlier.** "Wrong approach" on a finished PR is the most expensive feedback there is. Move it left — to docs, RFCs, and draft PRs — and within a PR, surface the big thing first and hold the nits.

- **A comment is a withdrawal.** It costs author time and team goodwill; a pile of low-value comments bankrupts both and buries your critical one. Spend comments where they buy correctness, safety, or a durable skill.

---

## Common Mistakes

1. **Letting style and formatting reach a human.** Every minute spent commenting on whitespace is stolen from the concurrency bug. Automate formatting, imports, and lint in CI so they never touch the budget. If a human is commenting on it, the pipeline is broken.

2. **Inverting the severity order under time pressure.** Fatigue flows attention toward easy, low-severity issues (naming, braces) and away from hard, high-severity ones (races, missing rollback). Spend the *first* minutes on the hardest class on purpose, before fatigue makes it impossible.

3. **Reviewing the diff-as-presented.** Reading only the changed lines and trusting them misses the removed guard, the broken invariant, the affected caller with no diff. Reconstruct the context a change makes load-bearing; treat net-negative diffs as suspect, not safe.

4. **Tautological correctness.** Verifying that code does what it does ("yes, this assigns that") instead of what it *should* (anchored on intent). Feels like reviewing; catches nothing. Establish intent and contract before judging a line.

5. **Approving snapshot updates and assertion-free tests as "coverage."** A test that passes regardless of correctness provides zero detection and false confidence. Read the assertions; ask whether the test would fail on the most likely bug.

6. **Giving "wrong approach" feedback on a finished PR.** By PR time the expensive thing is built; redirecting costs a rewrite, so reviewers cave and the wrong shape calcifies. Move design review to docs and draft PRs; the PR is the wrong venue for the most expensive feedback.

7. **Burying the critical comment under nits.** Thirty inline nits on functions inside a wrong-approach PR waste the author's time and hide the one comment that matters. Surface the big thing first, in the summary; hold line-level feedback until the shape is agreed.

8. **Trying to read a generated/mechanical PR line-by-line.** No one reads 4,000 generated lines carefully, so "I read it all" means "I rubber-stamped it all." Review the spec/command, spot-check a representative sample, look for the irregular hunk, and run the verification.

9. **Blocking on preference.** Reserving `blocking:` for things that are *wrong*, not things you'd have done differently. "Not how I'd do it" is a `nit:`. Inconsistent blocking across reviewers teaches authors to optimize for the lenient one.

---

## Test Yourself

1. State the inspection-rate finding in numbers. Past roughly what change size, inspection rate, and session length does defect-detection efficiency collapse — and what's the *mechanism*?
2. Why is the review order (correctness/design/security first, style last) an *optimization* rather than a style preference? What two factors per issue-class determine where it sits?
3. List the layers of understanding in order. Why can't you assess correctness without the layer below it?
4. You're reviewing a net-negative diff (only deletions). Why is "fewer lines = safer" exactly wrong here, and what do you reconstruct?
5. Give a concrete example of a behavioral change with no local diff. What's the one question that catches the whole category?
6. A PR has 90% test coverage and all tests pass. Name three ways those tests could still constrain nothing, and the question you'd ask of each test.
7. Why is "wrong approach" feedback on a finished PR the most expensive class, and where should that feedback have happened instead?
8. You're handed a 4,000-line PR that regenerates a gRPC client from an updated proto. You cannot read it line-by-line. What do you actually review?

<details>
<summary>Answers</summary>

1. Detection collapses past roughly **400–500 LOC per review**, an inspection rate past **~300–500 LOC/hour**, and a session past **~60 minutes** (SmartBear/Cisco; Fagan). The mechanism is that scrutiny is cognitively expensive and finite: past the cliff you keep moving your eyes but stop *finding* defects — you pattern-match and approve. The reviewer doesn't feel the cliff, which is what makes it dangerous.

2. Because attention is a finite, decaying budget, so the order is an allocation of a scarce resource to maximize `expected defects caught × severity`. Each class sits by **severity × cost-to-fix-late** (high → first) and **detectability-by-machine** (machine-catchable → off the human's budget entirely). Style is "never," not "last," because a tool does it perfectly; design is "earlier than the PR" because its cost-to-fix-late is a rewrite.

3. **Intent → contract → correctness → fit → maintainability.** Correctness is "does the implementation honor the contract on all paths," so without the **contract** (what it promises) there's no standard to check against — and the contract's *purpose* needs **intent**. "Is this line right?" is unanswerable without "right for what?"

4. The change is entirely in the *removed* lines, so reading only the (empty) additions shows nothing. "Fewer lines = safer" is wrong because a deletion can remove a guard, lock, or validation — e.g. a dropped `RLock` introduces a data race with no replacement line. Reconstruct: the deleted code itself, the invariant it maintained, and the now-unguarded paths/callers.

5. Examples: a flipped config **default** that switches on a previously-dead code path; a removed upstream **guard** that exposes an unvalidated path in unchanged downstream code; a one-character `==`→`!=` that **inverts** an unchanged downstream branch (e.g. retry-on-success). The catching question: *"This diff changes behavior — where does the new behavior actually execute, and is that place in the diff?"* If the affected code isn't in the diff, reconstruct it.

6. (a) **Assertion-free** — calls the function, asserts nothing; catches only "didn't crash." (b) **Testing the mock** — asserts a mock was called, not that the real outcome is correct; passes for any impl making the same calls. (c) **Over-mocked / snapshot rubber-stamp** — exercises no real logic, or records whatever output the code produces (bug included) and is "updated" unread. The question for each: *if I introduced the most likely bug, would this test fail?* If no, it's theater.

7. Because by the time a finished PR exists, the expensive thing — the implementation — is already built, so redirecting the design costs a full rewrite plus morale, which is why reviewers cave and the wrong shape calcifies. It should have happened **left of the PR**: a design doc/RFC, a draft/WIP PR, or an early "is this the right shape?" ping, where redirecting is a comment, not a rewrite.

8. Review the **transformation, not the lines**: (a) confirm the generated change is isolated from any hand-written change (ask to split if not); (b) review the *input* — the updated proto — and confirm you can **regenerate identical output** (you're reviewing `f` and `x`, not `f(x)`); (c) **spot-check** a representative sample of the output; (d) scan the diff's *shape* for the irregular hunk that signals a hand-edit hiding in the mechanical change; (e) run the test suite green. That's more reliable than a doomed line-by-line read.

</details>

---

## Cheat Sheet

```
THE BUDGET (why order exists)
  detection collapses past ~400-500 LOC, ~300-500 LOC/hr, ~60 min  (SmartBear/Cisco, Fagan)
  finite + decaying attention → order = allocate to max (defects × severity)
  protect the budget: automate style/format/lint/types in CI → never reaches a human

ORDER = expected-value (severity × cost-to-fix-late, minus what machines catch)
  1 correctness   2 concurrency   3 design   4 security   5 tests
  6 maintainability   7 style→CI (NEVER a human)
  stopping rule: found a big one? surface it, STOP nitting code that may be deleted

LAYERS OF UNDERSTANDING (bottom-up; each is the next one's standard)
  intent → contract → correctness → fit → maintainability
  no intent stated = first finding (can't judge "correct" without "correct for what")

CONTEXT RECONSTRUCTION (read beyond the diff)
  changed signature? → read the CALLERS
  net-negative diff? → read the DELETED code (guards die here)
  changed field/default? → read the TYPE's other methods + the dead path it wakes
  ask: "what did this diff change that the diff doesn't SHOW?"
  PULL & RUN when reading can't establish correctness: UI, migrations, concurrency(-race)

BEHAVIORAL CHANGE, NO LOCAL DIFF
  flipped default · removed guard upstream · inverted condition (==/!=)
  small diff ≠ small change — calibrate to behavioral blast radius, not line count

TESTS AS SPEC (read assertions, not counts)
  smells: assertion-free · testing-the-mock · over-mocked · snapshot rubber-stamp
  ask each test: would it FAIL on the most likely bug? no → theater (worse than none)
  missing test = highest-signal DESIGN smell (hard to test ⇒ hard to use)

DESIGN LEFT
  "wrong approach" on a finished PR = most expensive feedback (= rewrite)
  move it to: design doc / RFC → draft PR → early "right shape?" ping

COST OF A COMMENT (calibrate; most are NOT blocking)
  blocking: (wrong) | nit: (optional) | question: | fyi:/praise:
  prefer "LGTM with comments" over a round-trip for nits
  specific + suggested fix = 1 turn; vague = a thread.  review for author's growth too

CAN'T READ LINE-BY-LINE (generated/codemod/migration)
  review the TRANSFORMATION not the lines: spec/command + regenerate + spot-check
  + scan for the IRREGULAR hunk (hand-edit hiding in mechanical change) + run verification
```

---

## Summary

- Review is **defect detection under a finite, decaying attention budget**. The inspection-rate data is unambiguous: efficiency collapses past ~400–500 LOC, ~300–500 LOC/hour, and ~60 minutes (SmartBear/Cisco; Fagan). The reviewer doesn't feel the cliff, which is why discipline beats effort.
- Because the budget is scarce, **the order is an expected-value optimization**: spend the freshest attention where `severity × cost-to-fix-late` is high and a machine can't help — correctness, concurrency, design, security — and push style/format/lint entirely onto CI so it never costs a human a second.
- Understanding is built in **layers** — intent → contract → correctness → fit → maintainability — and each is the standard for the next. Anchor on intent before judging a line, or you get tautological correctness that catches nothing.
- The diff is a **lossy projection**; the change lives in the system. Reconstruct callers, deletions, siblings, and broken invariants, and ask "what did this change that the diff doesn't show?" — because the worst defects (flipped defaults, removed guards, inverted conditions) have **no local diff**, and small diff ≠ small change.
- **Read the tests first as spec**, but judge whether they *constrain* behavior — assertion-free, testing-the-mock, over-mocked, and snapshot-rubber-stamp tests provide zero detection and false confidence. The missing test is the highest-signal design smell.
- **Move design review left** (docs, RFCs, draft PRs) because "wrong approach" on a finished PR is the most expensive feedback there is; within a PR, surface the big thing first and hold the nits. **A comment is a withdrawal** from the author's time and team goodwill — calibrate it, reserve blocking for what's wrong, and review for the author's growth.
- For changes you **can't read line-by-line** (generated code, codemods, migrations), review the *transformation*: the spec/command, a regenerated diff, a spot-check, the irregular hunk, and the verification run — which is more reliable than a doomed heroic read.

You now treat review as a process with a measurable constraint and a defensible order, and you reconstruct the context the diff destroyed. The next layer — [professional.md](professional.md) — is about operating that discipline across a team and an organization: SLAs, review load, consistency at scale, and the culture that keeps review fast *and* rigorous.

---

## Further Reading

- *Software Engineering at Google* — Chapter 9, "Code Review." The definitive treatment of review at scale: why reviews are small, the LGTM-with-comments norm, and attention on the author as well as the code.
- *Design and Code Inspections to Reduce Errors in Program Development* — Michael Fagan (IBM Systems Journal, 1976). The origin of inspection rate as the governing variable, and the data behind the attention-budget model.
- [SmartBear / Cisco code-review study](https://smartbear.com/learn/code-review/best-practices-for-peer-code-review/) — the ~2,500-review dataset behind the 400-LOC / 60-minute / 500-LOC-per-hour thresholds.
- [Google's *Code Review Developer Guide*](https://google.github.io/eng-practices/review/) — the reviewer and author guides: standard of review, what to look for, how to write and respond to comments, and speed-vs-thoroughness tradeoffs.
- *Working Effectively with Legacy Code* — Michael Feathers. The seams-and-testability lens behind "hard to test ⇒ hard to use" and the missing-test-as-design-smell heuristic.
- The next tier in this topic: [professional.md](professional.md) — review as a team-scale, organizational discipline.

---

## Related Topics

- [02 — PR Scope & Size](../02-pr-scope-and-size/senior.md) — how to keep changes inside the attention budget, and how to handle the large/mechanical PRs you can't shrink.
- [03 — Correctness & Design Review](../03-correctness-and-design-review/senior.md) — going deep on the first and most expensive passes: logic on all paths, and the design-shape call.
- [04 — Security & Performance Review](../04-security-and-performance-review/senior.md) — the high-severity, hard-to-catch classes that earn the freshest attention.
- [Testing](../../testing/) — what makes a test actually constrain behavior, and the over-mocking smell behind testing-the-mock.
- [Static Analysis & Linting](../../static-analysis/) — the tooling that takes style, formatting, and whole classes of defects off the human reviewer's budget entirely.
