# What to Look For & In What Order — Middle Level

> **Roadmap:** [Code Review](../README.md) → What to Look For & In What Order
> *The junior page gave you the order and the reasons. This page formalizes why that order is the optimal one, hands you the full checklist as a working tool, and teaches the two judgments that separate a glance from a review: read the tests first, and never trust the diff.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Order Is Defect-Yield Optimization](#core-concept-1--the-order-is-defect-yield-optimization)
5. [Core Concept 2 — The Full "What to Look For" Checklist](#core-concept-2--the-full-what-to-look-for-checklist)
6. [Core Concept 3 — Read the Tests First](#core-concept-3--read-the-tests-first)
7. [Core Concept 4 — The Diff Is Not the Change](#core-concept-4--the-diff-is-not-the-change)
8. [Core Concept 5 — Severity Discipline and Labeled Comments](#core-concept-5--severity-discipline-and-labeled-comments)
9. [Core Concept 6 — Time-Boxing and the Fatigue Ceiling](#core-concept-6--time-boxing-and-the-fatigue-ceiling)
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

> Focus: **Why is the review order optimal, and what are the two judgments that make a review more than a glance?**

At the junior level you learned the order — correctness, design, tests, readability, style — and the one-line reason for each. That model is correct but incomplete. It tells you *what* to do without proving *why* it's the right allocation of effort, and it leaves two skills unstated that quietly decide whether your review finds the expensive bug or rubber-stamps it.

This page closes those gaps. First, it reframes the order as an **optimization problem**: reviewer attention is finite and decays, so the order exists to maximize defect yield per minute of a possibly-interrupted review. Second, it gives you the **full checklist** as a tool you can run down, drawn from Google's Code Review Developer Guide and expanded with the judgment behind each item. Third, it teaches the two techniques that distinguish reviewers: **read the tests first** (they encode the author's contract) and **the diff is not the change** (the unified diff is a lossy view that hides the most dangerous edits). It closes with **severity discipline** — labeling each comment so the author knows what blocks merge — and the **fatigue ceiling** that caps how much you can review well in one sitting.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can name the review order and why correctness comes before style.
- **Required:** You've submitted and reviewed at least a handful of small pull requests.
- **Helpful:** You've been bitten once by a change that "looked fine in the diff" and broke a caller you never saw.
- **Helpful:** Your team runs a linter and formatter in CI, so you've seen style enforced by machine.

---

## Glossary

- **Defect yield** — bugs caught per unit of reviewer effort. The order is designed to front-load high-yield checks.
- **Diff (unified diff)** — the `+`/`-` view of what lines changed. A *view*, not the change itself; it omits everything you didn't edit but affected.
- **The change** — the actual behavioral delta the PR introduces, including effects on un-edited callers, config, and data.
- **Tautological test** — a test that always passes regardless of the code's behavior (asserts nothing meaningful, or asserts on the mock).
- **Blocking comment** — feedback that must be resolved before merge. Everything else is non-blocking.
- **Conventional Comments** — a labeling convention (`nit:`, `suggestion:`, `question:`, `issue:`, `praise:`) that states a comment's severity and intent up front.
- **Time-box** — a fixed maximum duration (or LOC count) for a single review session, set because review quality decays with fatigue.

---

## Core Concept 1 — The Order Is Defect-Yield Optimization

The junior page said: review in importance order. Here is the argument for *why* that's not just tidy but optimal.

Treat a review as a budget problem. You have a finite, decaying resource — **attention** — and a set of checks of wildly different value and cost:

| Check | Cost to perform | Yield (impact × likelihood) | Reversible cheaply later? |
|---|---|---|---|
| Correctness / logic | High (must reason) | Very high — wrong output, data loss | No — ships as a bug |
| Design / fit | High (must hold the system in your head) | Very high — shapes future work | No — expensive to undo |
| Tests | Medium | High — guards against regressions | Hard to retrofit |
| Naming / readability | Low–medium | Medium — compounding maintenance | Yes |
| Style / formatting | ~Zero (automated) | Low — cosmetic | Yes, trivially |

Now apply two facts. **One: attention decays** — your scrutiny is sharpest in the first 10–20 minutes and degrades from there. **Two: reviews get interrupted** — a meeting, a production page, end of day. Under both, the value-maximizing strategy is identical to greedy scheduling: **do the highest-value, hardest-to-reverse work while your attention is freshest**, so that even a review that gets cut short has already captured the expensive bugs.

If you start with style, you spend peak attention on the cheapest, most-reversible, lowest-yield items — and if you're interrupted, you've inspected the cosmetics of a function whose logic is wrong. Reversed: lead with correctness and design, and a half-finished review still caught the thing that would have caused an incident.

> **Key insight:** The review order is greedy optimization under a decaying budget. You spend your sharpest, most expensive attention on the checks that are highest-yield *and* hardest to fix after merge — correctness and design — so that the value of a partial review is still high. Style goes last not because it's worthless but because it's near-zero cost (a machine does it) and trivially reversible.

This also explains why **style should be automated, not reviewed**. A formatter and linter perform the lowest-yield check at zero human attention. Every style nit a human types is peak attention spent on a job a machine does better — and worse, it *crowds out* the high-yield checks and trains authors to treat all your comments as bikeshedding. Push style to CI; spend your budget where the machine can't go.

---

## Core Concept 2 — The Full "What to Look For" Checklist

Google's Code Review Developer Guide enumerates what a reviewer should examine. Here it is as a working checklist, ordered by the optimization above and expanded with the judgment each line needs. Run down it top to bottom; stop spending time the moment a higher item is broken (a logic bug makes the naming debate moot).

| # | Look at | The real question | Smell that it's wrong |
|---|---|---|---|
| 1 | **Design** | Does this change belong *here*? Does it integrate with the existing system, and is *now* the right time to add it? | New code that duplicates an existing abstraction; a feature wedged into the wrong layer |
| 2 | **Functionality** | Does it do what the author intended — including edge cases — and is that what the *user/caller* actually needs? | Happy-path only; off-by-one at boundaries; "works" but solves the wrong problem |
| 3 | **Complexity** | Is it more complex than it needs to be? Over-engineered for imagined futures? Could a *future* developer understand it quickly? | Speculative generality, deep nesting, a clever one-liner that takes five minutes to read |
| 4 | **Tests** | Are there tests? Are they correct, meaningful, and do they *fail when the code is wrong*? | No tests for new logic; tests that assert nothing; tests of the mock |
| 5 | **Naming** | Do names clearly say what the thing is/does, without being needlessly long? | `data`, `tmp`, `handle()`, `flag2`; a name that lies about behavior |
| 6 | **Comments** | Do comments explain *why*, not restate *what*? Are they necessary and clear? | `// increment i` ; missing the *why* behind a non-obvious workaround |
| 7 | **Consistency** | Does it follow the existing codebase's patterns and conventions? | A new HTTP client style in a codebase that has one already |
| 8 | **Documentation** | Are user-facing docs, READMEs, or runbooks updated to match the change? | New flag with no docs; changed behavior, stale README |
| 9 | **Style** | Does it match the style guide? | (Should be machine-checked — see Concept 1) |

Two notes on using this as a tool, not a ritual:

- **The order is the point.** Items 1–4 are where bugs and expensive mistakes live; 5–9 are maintenance and polish. If you only have fifteen minutes, you get 1–4. The checklist is sorted so that "as far as I got" is always "the most important part."
- **"Does the user actually need this?" outranks "does it work?"** Functionality includes judging the change against the *caller's* perspective, not just the author's stated intent. Code that flawlessly implements the wrong thing is a defect — caught at item 2, not in QA.

> **Key insight:** The checklist is not a gate you tick off bottom-up; it's a *priority queue*. You always pull from the top. The discipline isn't completing the list — it's spending your attention on the highest unresolved item and refusing to descend to naming while a design or correctness question is open.

---

## Core Concept 3 — Read the Tests First

Here is a technique that reorders how you *enter* a PR: before reading the implementation, read the tests.

A test suite is the author's own statement of what the code is *supposed to do*. It encodes the contract — the inputs they considered, the outputs they expect, the edge cases they thought about. Reading it first does three things at once:

1. **It frames the whole review.** You learn the intended behavior from the author's perspective before the implementation can bias you. Then you read the code asking "does this satisfy the contract the tests describe?" instead of reverse-engineering intent from the implementation.
2. **It surfaces gaps immediately.** The cases the tests *don't* cover are the edge cases the author didn't think about — exactly where bugs hide. A missing test is a question you now know to ask.
3. **It catches the most insidious defect: tests that lie.** A weak or absent test suite is itself a design smell, and some tests are worse than none because they create false confidence.

Watch for these "tests that lie":

```python
# 1. Asserts nothing meaningful — always passes
def test_process():
    result = process(order)
    assert result is not None          # would pass even if process() is broken

# 2. Tests the mock, not the code
def test_charges_card():
    payments = Mock()
    checkout(cart, payments)
    payments.charge.assert_called_once()   # asserts you CALLED the mock —
                                           # proves nothing about real behavior

# 3. Tautological — restates the implementation
def test_discount():
    assert apply_discount(100, 0.1) == 100 - (100 * 0.1)   # if the code is
                                           # wrong, the expectation is wrong the
                                           # same way. Hardcode 90.
```

The reviewer's question for every test is the one that matters: **would this test fail if the code were wrong?** If you can imagine a broken implementation that still passes, the test is decorative. A test of the mock proves the author wrote a call, not that the call does the right thing. A tautological expectation re-derives the bug. These pass CI green and catch nothing — and they're common in over-mocked code, where so much is stubbed that the test exercises the test harness rather than the system.

> **Key insight:** Tests are the author's encoded understanding of the contract. Read them first and the review reframes from "what does this code do?" to "does this code do what its own tests claim, and do those tests actually check it?" Missing tests are unasked edge-case questions; lying tests are false confidence — both are findings, and both are easier to see *before* the implementation anchors you.

---

## Core Concept 4 — The Diff Is Not the Change

This is the most important judgment on the page. The unified diff — the green-and-red view your tool shows — is a **lossy projection** of the actual change. Like the build's translation unit hiding cross-file effects, the diff hides exactly the edits most likely to break in production.

What the diff *cannot* show you:

- **Callers you didn't touch but affected.** You changed a function's behavior (not its signature). Every caller now behaves differently — and none of them appear in the diff. The diff shows the *cause*; the bug lives in the *unchanged* callers.
- **Behavior changes with no diff at all.** A config value, a feature flag, a data migration, an environment default — these change runtime behavior with little or no code in the diff. The most impactful line might be a one-character config edit.
- **Removed code whose absence matters.** A deleted line is a red `-`, but its *consequences* — a now-missing null check, a dropped retry, a removed log line you'll wish you had during an incident — are invisible. Deletions deserve as much scrutiny as additions.
- **Cross-file coupling.** Method A in one file and method B in another must stay in sync (e.g., a serializer and its deserializer). The diff touches A; whether B still agrees is off-screen.

```diff
# The diff you're shown — looks like a trivial, safe change:
  func GetUser(id string) (*User, error) {
-     return db.Query(id)
+     return cache.Get(id)        // ← one line. LGTM?
  }
```

```text
What the diff hides — the actual change:
  • Every caller of GetUser now reads from cache → stale data is possible.
    None of those callers are in the diff.
  • cache.Get returns a different error type on miss → error handling
    upstream may now take the wrong branch. Not in the diff.
  • The old db.Query enforced row-level auth; cache.Get does not.
    A SECURITY regression — and there is no red line to point at.
```

So the core skill is **knowing when the diff suffices and when to go deeper.** Escalate your inspection method to match the risk:

| The change is… | Inspect by… |
|---|---|
| A small, local edit; logic visible in the hunk | **Reading the diff** — with a little expanded context |
| Touching a shared function, or behavior with off-screen callers | **Expanding context / opening the full files** in the review tool |
| Non-trivial, multi-file, or hard to reason about statically | **Pulling the branch** and reading it in your IDE (jump to definition, find all callers) |
| A UI change, a DB migration, a complex flow, anything stateful | **Running it** — check out, build, exercise the actual behavior |

The last row is where juniors stop and seniors don't. For a UI tweak, a schema migration, or a gnarly async flow, **you cannot review what you only read.** Pull it and run it.

One more axis: **commit-by-commit vs the squashed diff.** A well-structured PR tells a story in its commits — "extract helper," then "fix the bug it exposed," then "add tests." Reviewing commit-by-commit lets you follow the author's reasoning and review a refactor separately from a behavior change. The squashed diff collapses that story into one wall of changes where a mechanical rename and a subtle logic fix are indistinguishable. Read the commits when the history is clean; ask the author to split when it isn't.

> **Key insight:** The diff is a *view* of the change, not the change. It systematically hides the highest-risk edits: affected-but-unchanged callers, behavior shifts with no code, the consequences of deletions, and cross-file coupling. Your job is to match inspection depth to risk — read the diff for local edits, but expand context, pull the branch, or *run it* the moment the change can reach beyond what the hunk shows.

---

## Core Concept 5 — Severity Discipline and Labeled Comments

A review with ten comments and no severity labels forces the author to guess which ones block merge. They'll guess wrong — either treating a blocking bug as optional or rewriting the world over a stylistic preference. The fix is two-tiered and cheap.

**First, every comment is blocking or non-blocking.** Blocking means "merge must not happen until this is resolved": correctness bugs, security holes, design problems that will be expensive to undo. Non-blocking is everything else — preferences, ideas, questions, praise. Make the split explicit so the author can act without mind-reading.

**Second, label the *kind* of each comment up front.** [Conventional Comments](https://conventionalcomments.org/) is the lingua franca here:

```text
nit: prefer `userCount` over `n` here          → trivial, non-blocking
suggestion: this could use the existing retry   → optional improvement
              helper in util/retry.go
question: is this path reachable when the cache  → asking, not demanding;
            is cold? I might be missing it           may surface a real bug
issue (blocking): this overwrites the caller's   → MUST fix before merge
            slice — aliasing bug, see line 40
praise: clean separation here, easy to follow    → reinforces good patterns
```

The labels do real work. `nit:` tells the author "ignore this if you disagree, it won't block you" — which means you can mention small things *without* weighing down the review. `question:` lets you flag a possible bug without accusing; often the answer *is* the bug. `issue (blocking):` is unambiguous: this stops the merge. And `praise:` is not filler — it tells the author which patterns to repeat, and it balances a review so it doesn't read as pure criticism.

> **Key insight:** Severity is information the author needs and can't infer. Label every comment with its kind and whether it blocks. The payoff is twofold — you can raise small ideas without derailing the merge (because `nit:` defuses them), and the author spends effort proportional to impact instead of guessing.

---

## Core Concept 6 — Time-Boxing and the Fatigue Ceiling

There is a measured ceiling on how much code a human reviews well, and ignoring it turns a careful reviewer into a rubber stamp.

The numbers, from inspection research (notably the SmartBear/Cisco study) and widely echoed in practice:

- **Defect-detection collapses past ~400 lines** in one sitting. Below ~200–400 LOC you find most findable defects; above it, your hit rate falls off a cliff.
- **Effectiveness drops after ~60 minutes** of continuous review. Attention is the decaying resource from Concept 1, and it runs out.

Two operational rules follow:

1. **Time-box the session.** Review for ~60 minutes, then stop. If the PR is bigger than that, review it in chunks across sessions, or — better — push back on the size (see [02 — PR Scope & Size](../02-pr-scope-and-size/middle.md)). A 2,000-line PR doesn't get a real review; it gets a tired skim and an "LGTM" that means "I gave up."
2. **Gather context before you comment.** Don't fire off the first comment until you understand the PR's *goal*. A comment written from a misreading of intent is noise the author must rebut, and it burns trust. Read the description, read the tests (Concept 3), skim the whole change, *then* engage. Understanding-first is also faster overall — you stop chasing non-issues.

This loops back to the optimization: the fatigue ceiling is *why* the order matters so much. Your effective budget is roughly the first hour and the first few hundred lines. Spend it top-of-checklist first, and a budget that runs out has still bought the expensive bugs.

> **Key insight:** Reviewer attention has a hard ceiling — roughly one hour and a few hundred lines before defect detection falls apart. Time-box to stay inside it, gather context before commenting so you don't spend the budget on misreadings, and keep the change small enough that one focused session can actually review it.

---

## Real-World Examples

**Annotated walkthrough — attacking a PR in order.** A PR lands: "Add per-user rate limiting to the API." Here is the sequence a disciplined reviewer follows, mapping to the checklist.

```text
0. CONTEXT (before any comment)
   Read the description + linked ticket. Goal: cap each user at N req/min.
   Skim the file list: middleware/ratelimit.go, config.yaml, one test file.

1. TESTS FIRST  (checklist #4, done early as a framing technique)
   ratelimit_test.go covers: under-limit passes, over-limit gets 429.
   MISSING: what happens at exactly N? concurrent requests from one user?
   limit reset after the window? → three edge-case questions, noted.

2. DESIGN  (#1)
   It's middleware — right layer. But the counter is a plain in-process
   map. Behind 4 replicas, each sees 1/4 the traffic → real limit is 4N.
   → issue (blocking): design doesn't hold under horizontal scaling.

3. FUNCTIONALITY + COMPLEXITY  (#2, #3)
   The map is never evicted → unbounded memory growth (a slow leak).
   → issue (blocking). Logic is otherwise simple; no over-engineering.

4. THE DIFF IS NOT THE CHANGE  (Concept 4)
   config.yaml adds `rate_limit: 60`. One line — but it's now applied to
   EVERY route, including the health check the load balancer hits.
   Not visible as logic. → question: should /healthz be exempt?

5. NAMING / COMMENTS / CONSISTENCY  (#5-7)
   `n` should be `requestsPerMinute`. → nit. Otherwise consistent.

6. STYLE  (#9)
   Skipped — CI's linter owns it.

Outcome: 2 blocking issues, 1 blocking-via-question, 1 nit — surfaced in
~25 minutes, with the two expensive bugs found before naming was discussed.
```

Notice what the order bought: the two findings that would cause an incident (a limiter that doesn't limit, and a memory leak) were found in the first half of the review. Had the reviewer started at naming, a mid-review interruption would have shipped both.

**The deletion that wasn't in the spotlight.** A PR titled "clean up logging" removes a dozen `log.Debug` lines. The diff is a clean block of red — looks like pure noise reduction, trivially approvable. But one removed line logged the external request ID on every outbound call. Three weeks later, during an incident, the on-call engineer can't correlate the service's calls with the vendor's logs because the correlation ID is gone. The diff showed a deletion; the *consequence* of the deletion — debuggability in production — was off-screen. A reviewer asking "what does the absence of each of these lines cost?" catches it.

**Pull-and-run beats read-and-approve.** A PR adds a database migration that adds a column with a default and backfills it. It reads fine. A reviewer who has been burned before checks out the branch and runs the migration against a copy of production-sized data — and finds it takes a full-table lock for 40 seconds on a 50M-row table, which would be an outage. No amount of *reading* the SQL surfaced the lock duration; *running* it did. Migrations, UI, and stateful flows are the rows in the escalation table where reading is not reviewing.

---

## Mental Models

- **Review is greedy scheduling under a decaying budget.** Attention is finite and runs down; do the highest-value, hardest-to-reverse work first so a partial review still bought the expensive bugs. The checklist is sorted so "as far as I got" is always "the most important part."

- **The checklist is a priority queue, not a punch list.** You always pull from the top. You don't descend to naming while a correctness or design question is open — a logic bug makes the naming debate moot.

- **Tests are the author's contract, written down.** Read them first to learn intended behavior before the implementation biases you; the cases they miss are the edge cases the author missed, and tests that can't fail are false confidence.

- **The diff is a lossy projection.** Like a translation unit hiding cross-file effects, the diff hides affected-but-unchanged callers, behavior shifts with no code, and the consequences of deletions. Match inspection depth to risk: read, expand, pull, or *run*.

- **Severity is information, not decoration.** Label every comment with its kind and whether it blocks. `nit:` lets you mention small things without weighing the review down; `issue (blocking):` tells the author exactly what stops the merge.

---

## Common Mistakes

1. **Spending peak attention on style.** Leading with formatting nits burns your sharpest minutes on the lowest-yield, most-automatable check — and trains the author to dismiss all your comments as bikeshedding. Automate style; spend your budget on correctness and design.

2. **Reviewing the diff and calling it the change.** Approving a one-line edit that changes the behavior of a shared function — without checking the callers that aren't in the diff — is the single most common way real bugs pass review. Expand context or pull the branch when the change can reach off-screen.

3. **Trusting green tests without reading them.** "Tests pass" is meaningless if the tests assert nothing, test the mock, or restate the implementation. Read the tests and ask: would this fail if the code were wrong?

4. **Not labeling severity.** A pile of unlabeled comments forces the author to guess what blocks merge. They'll rewrite the world over a `nit:` or ship past a real bug. Label every comment blocking/non-blocking and state its kind.

5. **Reviewing past the fatigue ceiling.** Pushing through a 1,500-line PR in one sitting produces a tired skim, not a review. Past ~60 minutes / ~400 LOC your defect detection collapses — time-box, chunk it, or push back on the size.

6. **Commenting before understanding the goal.** Firing off the first comment from a misreading of intent creates noise the author must rebut and erodes trust. Gather context — description, tests, a full skim — *then* engage.

7. **Ignoring deletions.** A red `-` block looks safe, but a removed null check, retry, or log line is a real change whose consequences are invisible in the diff. Ask what the absence of each removed line costs.

---

## Test Yourself

1. State the review order as an optimization. What resource is being optimized, and why does that imply correctness/design first and style last?
2. Why should style be automated rather than reviewed by a human? Frame it in terms of the budget.
3. You read a PR's tests first and find they all pass but you can imagine a broken implementation that would still pass them. What's the name for this, and what's the one question that catches it?
4. Give three things the unified diff *cannot* show you about a change.
5. A PR changes a function's behavior but not its signature. Where does the resulting bug live, and why won't the diff point at it?
6. When is reading the diff insufficient, and what are your escalation options?
7. What does the `nit:` label buy you that an unlabeled comment doesn't?
8. What are the rough numeric ceilings on a single review session, and what two operational rules follow from them?

<details>
<summary>Answers</summary>

1. The order optimizes **reviewer attention** — a finite, decaying resource — for **defect yield per minute**. Because attention is sharpest early and reviews get interrupted, you do the highest-value, hardest-to-reverse checks (correctness, design) first, so even a partial review captures the expensive bugs. Style is last: near-zero cost (automatable) and trivially reversible, so it's the cheapest thing to defer.

2. A linter/formatter performs the lowest-yield check at zero human attention. Every style nit a human types is peak attention spent on a job a machine does better, and it crowds out high-yield checks while training authors to dismiss your comments. Automating style spends the human budget where machines can't go.

3. A **tautological** (or otherwise lying) test — it can't fail. The catching question: **would this test fail if the code were wrong?** If you can imagine a broken implementation that still passes, the test is decorative.

4. Any three of: callers you didn't edit but whose behavior changed; behavior changes with no code in the diff (config/flags/data/migrations); the *consequences* of deleted code; cross-file coupling where the file you changed must stay in sync with one you didn't.

5. The bug lives in the **unchanged callers**, which now behave differently. The diff shows only the *cause* (the edited function); the callers — where the wrong behavior actually surfaces — aren't in the diff because you didn't edit them.

6. The diff is insufficient the moment the change can reach beyond the hunk. Escalate: expand context / open the full files; pull the branch and read it in your IDE (jump to definition, find callers); or **run it** — mandatory for UI, DB migrations, and complex stateful flows.

7. `nit:` signals "trivial, non-blocking, ignore if you disagree." It lets you raise small improvements *without* weighing the review down or making the author guess whether it blocks merge — so you can mention them at all without derailing things.

8. Roughly **~60 minutes** and **~200–400 LOC** per session before defect detection collapses. Rules: (1) time-box the session and chunk or push back on oversized PRs; (2) gather context and understand the goal before commenting, so the budget isn't spent on misreadings.

</details>

---

## Cheat Sheet

```text
THE ORDER (why: greedy scheduling under decaying attention)
  1 Correctness/logic   ─┐ high yield, hard to reverse → spend peak attention
  2 Design / fit        ─┘ a partial review here still caught the costly bugs
  3 Tests               ── do they fail when the code is wrong?
  4 Complexity          ── simpler than this? over-engineered?
  5 Naming / readability
  6 Comments (WHY not what) / consistency / docs
  7 Style               ── AUTOMATE IT, don't review it

FULL CHECKLIST (Google) — a priority queue, pull from the top
  design · functionality(edge cases + caller's need) · complexity ·
  tests · naming · comments · consistency · documentation · style

READ TESTS FIRST
  encode the author's contract → frame the review before code biases you
  missing tests = unasked edge cases   lying tests = false confidence
  watch: asserts-nothing · tests-the-mock · tautological/over-mocked

THE DIFF IS NOT THE CHANGE  (it's a lossy view — hides:)
  affected-but-unchanged callers · behavior change with no code (config/data)
  consequences of deletions · cross-file coupling
  escalate by risk:  read diff → expand context → pull branch → RUN IT
                     (run it for: UI, DB migrations, stateful/complex flows)

SEVERITY — label every comment
  issue (blocking): MUST fix    suggestion: optional    nit: trivial
  question: maybe a bug         praise: repeat this

TIME-BOX
  ~60 min / ~200-400 LOC ceiling → past it, detection collapses
  understand the GOAL before commenting · push back on oversized PRs
```

---

## Summary

- The review **order is defect-yield optimization**: attention is finite and decaying, so you spend your sharpest, most expensive effort on the highest-yield, hardest-to-reverse checks (correctness, design) first — making even a partial review valuable. Style goes last because it's near-zero cost and trivially reversible; automate it.
- The **full checklist** (design → functionality → complexity → tests → naming → comments → consistency → documentation → style) is a **priority queue**, not a punch list. You pull from the top and don't descend while a higher item is open. Functionality includes the *caller's* real need, not just the author's intent.
- **Read the tests first.** They encode the author's contract; reading them frames the review, exposes missing edge cases, and reveals tests that lie (assert nothing, test the mock, tautological). The test is the question: *would this fail if the code were wrong?*
- **The diff is not the change.** It's a lossy view that hides affected-but-unchanged callers, behavior shifts with no code, the consequences of deletions, and cross-file coupling. Match inspection depth to risk — read, expand context, pull the branch, or *run it*.
- **Severity discipline:** label every comment as blocking/non-blocking and by kind (Conventional Comments). `nit:` lets you raise small things without derailing; `issue (blocking):` says exactly what stops the merge.
- **Respect the fatigue ceiling** (~60 min / ~200–400 LOC). Time-box, gather context before commenting, and push back on PRs too big for one focused session.

---

## Further Reading

- *Code Review Developer Guide* (Google, eng-practices) — the canonical "What to look for in a code review" checklist and the philosophy behind ordering it.
- *Software Engineering at Google*, Chapter 9 ("Code Review") — why reviews exist, what they optimize for, and how the order serves those goals at scale.
- Michael Lynch, *How to Do Code Reviews Like a Human* — practical severity-labeling and feedback discipline from the reviewer's side.
- [Conventional Comments](https://conventionalcomments.org/) — the labeling convention (`nit:`, `suggestion:`, `issue:`, `question:`, `praise:`) used throughout this page.
- SmartBear/Cisco code review study — the source of the ~400-LOC / ~60-minute defect-detection ceilings.
- [senior.md](senior.md) — review at scale: calibration across reviewers, review as design conversation, and what to *stop* looking for as a system matures.

---

## Related Topics

- [02 — PR Scope & Size](../02-pr-scope-and-size/middle.md) — the lever that keeps a change inside the fatigue ceiling so a real review is possible.
- [03 — Correctness & Design Review](../03-correctness-and-design-review/middle.md) — going deep on items 1–2, the highest-yield part of the checklist.
- [05 — Giving & Receiving Feedback](../05-feedback-giving-and-receiving/middle.md) — the human side of severity labels and blocking-vs-non-blocking comments.
- [Static Analysis & Linting](../../static-analysis/) — the machines that own style (item 9) so your attention doesn't have to.
- [Testing](../../testing/) — what "good tests" means when you read the tests first.
