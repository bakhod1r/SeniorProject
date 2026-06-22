# Review Tooling & Automation — Middle Level

> **Roadmap:** [Code Review](../README.md) → Review Tooling & Automation
> *The junior page listed the tools. This page formalizes them into a layered stack with one organizing principle — shift the mechanical left so the scarcest resource, a reviewer's attention, is spent only on what a machine can't judge — then adds the infrastructure (CODEOWNERS, Danger, reviewdog), the honest role of AI review, and the choice between async and synchronous review.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Layered Automation Stack](#core-concept-1--the-layered-automation-stack)
5. [Core Concept 2 — Shift the Mechanical Left](#core-concept-2--shift-the-mechanical-left)
6. [Core Concept 3 — Review Infrastructure (CODEOWNERS, Templates, Suggestions)](#core-concept-3--review-infrastructure-codeowners-templates-suggestions)
7. [Core Concept 4 — Codifying Review Rules (reviewdog & Danger)](#core-concept-4--codifying-review-rules-reviewdog--danger)
8. [Core Concept 5 — AI-Assisted Review as a Triage Layer](#core-concept-5--ai-assisted-review-as-a-triage-layer)
9. [Core Concept 6 — Async vs Synchronous Review](#core-concept-6--async-vs-synchronous-review)
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

> Focus: **What should a machine do before a human looks, and how do I spend that automation to protect the reviewer's attention?**

At the junior level, tooling is a list: a formatter, a linter, CI, maybe a coverage bot. Each is useful on its own, but the list has no shape — nothing tells you *why* the formatter must run before review rather than during it, or *what* you should still pay a human to do once all the machines have spoken.

This page gives the list a shape. Review automation is a **stack of layers**, and each layer exists to *remove a category of work from human review*: formatters remove layout debates, linters and type-checkers remove mechanical defects, tests and coverage bots remove "does it run," and only what remains — design, correctness on novel logic, intent — reaches a person. The organizing principle is **shift the mechanical left**: the reviewer's time is the scarcest resource in the pipeline, so you spend cheap automation to protect it. From there we cover the **infrastructure** that routes and structures review (CODEOWNERS, PR templates, suggested changes, auto-assignment), the tools that **codify review rules as code** (reviewdog, Danger), the honest place of **AI-assisted review** (good as a first-pass triage, dangerous as a noisy oracle), and the underrated choice of **async vs synchronous** review — knowing when to abandon a circular comment thread and just get on a call.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can name a formatter, a linter, and a CI check.
- **Required:** You've opened a pull request that ran CI and seen checks pass or fail on it.
- **Helpful:** You've reviewed a PR where half your comments were about formatting — and felt the waste.
- **Helpful:** You've used or seen a pre-commit hook, even just a formatter-on-save in your editor.

---

## Glossary

- **Pre-commit hook** — a script that runs on `git commit` (or on save) to catch issues before they ever leave the developer's machine; the [pre-commit](https://pre-commit.com) framework manages these declaratively.
- **CI check** — an automated job (lint, type-check, test, SAST) run on the PR by the CI system, reported as a pass/fail status that a [quality gate](../../quality-gates/) can require.
- **SAST** — Static Application Security Testing; security-focused [static analysis](../../static-analysis/) run as a check (e.g. CodeQL, Semgrep).
- **CODEOWNERS** — a file mapping repository paths to owning teams/people, so the right reviewers are auto-requested and (with branch protection) *required*.
- **Suggested change / code suggestion** — an inline review comment containing exact replacement code the author can apply with one click.
- **reviewdog** — a tool that takes any linter's output and posts it as **inline PR comments** on the changed lines, so tool findings live where the author is looking.
- **Danger** — a tool that runs in CI and **codifies team review rules** ("a PR must update the CHANGELOG", "warn on >500-line PRs") as executable checks that comment on the PR.
- **Preview / review environment** — an ephemeral deployment spun up *per PR* so reviewers can click through the change instead of imagining it.
- **AI review (LLM reviewer)** — an automated reviewer (GitHub Copilot code review, CodeRabbit, Graphite Reviewer, Qodo) that reads the diff and posts comments/summaries.
- **Async review** — written, deferred review via PR comments (the default); **synchronous review** — real-time, on a call or over the shoulder.
- **Stacked diffs** — a chain of small dependent PRs reviewed independently (tooling: Graphite) — see [02 — PR Scope & Size](../02-pr-scope-and-size/middle.md).

---

## Core Concept 1 — The Layered Automation Stack

A mature review pipeline is not one thing checking the code — it is **four layers**, each catching a category of problem and *removing it from the layer above*. The point of drawing them as a stack is that each layer should catch its category so completely that the next layer never has to think about it.

| Layer | Runs where / when | Owns (removes from review) | Tools |
|---|---|---|---|
| **1. Format on save / pre-commit** | Developer machine, on save or `git commit` | Layout, whitespace, import order, quote style | Prettier, gofmt, Black, `clang-format`; the [pre-commit](https://pre-commit.com) framework |
| **2. Lint / type-check / SAST** | CI, on every push to the PR | Mechanical defects, type errors, known bug patterns, security smells | ESLint, `go vet`, `golangci-lint`, mypy, CodeQL, Semgrep |
| **3. Tests + coverage / bundle bots** | CI, on every push | "Does it run? Did coverage drop? Did the bundle balloon?" | The test suite, Codecov, bundle-size bots |
| **4. The human reviewer** | The PR, after layers 1–3 are green | Design, correctness on novel logic, intent, naming, trade-offs | A person — the only layer that judges *whether this is the right change* |

Layers 1–3 are the **mechanical** layers: every finding is objective and reproducible. Layer 4 is the **judgment** layer, and it is the only one a machine cannot do. The stack works because each layer is *cheaper and earlier* than the one above it — fixing a format issue on save costs zero attention; fixing it in a review costs a round-trip and a reviewer's focus.

```yaml
# .pre-commit-config.yaml — Layer 1: layout & mechanical fixes never reach review
repos:
  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v4.6.0
    hooks:
      - id: trailing-whitespace
      - id: end-of-file-fixer
      - id: check-merge-conflict
  - repo: https://github.com/psf/black
    rev: 24.4.2
    hooks:
      - id: black            # formats Python on commit — no style comments ever
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.4.4
    hooks:
      - id: ruff             # fast linter; --fix auto-repairs the trivial findings
        args: [--fix]
```

> **Key insight:** The right question for any review comment is not "is this true?" but "which layer should have caught this?" If the answer is "a lower one," the fix is to move that check left — not to keep paying a human to make the same comment. A reviewer typing "run the formatter" is a *bug in your pipeline*, not a contribution.

---

## Core Concept 2 — Shift the Mechanical Left

"Shift left" means moving a check **earlier** in the lifecycle — toward the developer's keyboard and away from the reviewer's inbox. The deeper principle behind the whole stack is a resource argument: in the path from idea to merged code, **the scarcest, most expensive, least parallelizable resource is the reviewer's attention.** Machines scale; senior reviewers do not.

So the strategy is to spend the cheap, infinitely-scalable thing — automation — to protect the expensive, finite thing — human focus. Concretely:

- A **formatter** is cheaper than a formatting comment. The comment costs a reviewer's attention, an author's round-trip, and a re-review. The formatter costs nothing per run.
- A **linter rule** is cheaper, more consistent, and never-forgets compared to a human remembering to check the same thing on every PR. Machines don't get tired at PR #11 ([07 — Review Metrics & Tempo](../07-review-metrics-and-tempo/middle.md) covers the fatigue ceiling).
- A **CI gate** that blocks merge on a failing type-check means the reviewer *never sees* type-broken code — the change is simply not reviewable until it's green.

The failure mode this prevents is the most common review anti-pattern: humans spending their scarce attention on what a machine should own — bikeshedding style while the concurrency bug sails through ([08 — Review Anti-patterns](../08-review-anti-patterns/middle.md)). Every mechanical thing a human reviews is attention *not* spent on design and correctness.

```yaml
# CI: Layer 2 gate — code is not reviewable until the machine is happy
name: pr-checks
on: pull_request
jobs:
  static:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
      - run: go vet ./...
      - run: golangci-lint run        # lint + a dozen analyzers, fails the check
      - run: go test -race -cover ./...  # tests + coverage + race detector
```

> **Key insight:** Automation does not *replace* review — it *raises its floor*. When layers 1–3 guarantee the code is formatted, typed, linted, tested, and security-scanned, every human comment is, by construction, about something only a human could have caught. That is the entire return on the investment: not fewer reviews, but reviews that are exclusively about judgment.

---

## Core Concept 3 — Review Infrastructure (CODEOWNERS, Templates, Suggestions)

Beyond the analysis layers sits the **infrastructure** that routes review to the right people and gives them context. These are not checks — they are the plumbing that makes review fast and well-aimed.

**CODEOWNERS** — a single file mapping paths to owners. Open a PR touching a path, and its owners are auto-requested as reviewers; combined with branch protection, their approval becomes *required* ([Quality Gates → branch protection](../../quality-gates/)). It is the difference between "someone reviews this" and "the person who understands this code reviews this."

```text
# .github/CODEOWNERS — path → owner routing
*                       @org/eng-leads          # fallback owner for everything
/api/                   @org/backend-team
/api/billing/           @org/payments-team       # more specific wins
/web/                   @org/frontend-team
*.tf                    @org/platform-team       # all Terraform, anywhere
/docs/                  @org/tech-writers @org/backend-team
```

The last-match-wins rule means you layer general → specific. A PR touching `/api/billing/charge.go` requests `@org/payments-team`, not the broader backend team.

**PR templates** — a `.github/pull_request_template.md` that pre-fills the description with the context a reviewer needs: what changed, why, how it was tested, and the linked issue. This shifts *context-gathering* left, off the reviewer's plate.

**Suggested changes (code suggestions)** — instead of "rename this to `userCount`," the reviewer writes a `suggestion` block with the exact code; the author applies it with one click and one commit. This collapses the round-trip for small fixes from minutes to seconds (it's the mechanism behind the `suggestion:` label in [05 — Giving & Receiving Feedback](../05-feedback-giving-and-receiving/middle.md)).

**Auto-assignment / load-balancing** — round-robin or CODEOWNERS-based assignment spreads review load so it doesn't all land on the one senior everyone @-mentions. **Draft PRs** signal "in progress, don't review yet," saving reviewers from reviewing a moving target. **Preview environments** deploy the branch per-PR so reviewers can *click the feature*, not imagine it — invaluable for UI changes, where a screenshot or live URL beats reading JSX. **Visual-regression** and **semantic-diff** tools raise the signal of the diff itself: the former flags pixel changes, the latter ignores pure reformatting so the reviewer sees only the behavioral delta.

> **Key insight:** Infrastructure decides *who reviews* and *with how much context* — and those two factors swing review quality more than the reviewer's skill does. A brilliant reviewer with no context, reviewing code they don't own, loses to an average reviewer who owns the path and got a filled-in template and a live preview.

---

## Core Concept 4 — Codifying Review Rules (reviewdog & Danger)

Some review rules are mechanical but *project-specific* — too bespoke for a linter, too repetitive for a human. Two tools turn these into code so they're enforced automatically and uniformly.

**reviewdog** takes the output of *any* tool — a linter, a type-checker, a custom script — and posts it as **inline comments on the exact changed lines** of the PR, filtered to only the lines the PR touched. The win is placement: instead of a reviewer copying a CI log line into a comment, the finding appears where the author is already looking, on the line that caused it.

```yaml
# reviewdog: surface golangci-lint findings as inline PR comments
- name: golangci-lint via reviewdog
  uses: reviewdog/action-golangci-lint@v2
  with:
    reporter: github-pr-review   # inline comments on changed lines
    filter_mode: added           # only comment on lines this PR added/changed
    fail_on_error: true          # also fail the check, so it's a real gate
```

**Danger** runs in CI and lets you write **your team's review conventions as executable rules** that comment on (or block) the PR. The rules that every team re-types into review comments — "you didn't update the CHANGELOG," "no tests in this PR," "this PR is huge" — become code that runs every time, for free, without a human remembering.

```ruby
# Dangerfile — codify the review rules humans keep re-typing
# 1. A user-facing change must update the changelog.
has_app_changes = !git.modified_files.grep(/^src/).empty?
no_changelog    = !git.modified_files.include?("CHANGELOG.md")
if has_app_changes && no_changelog
  warn("This PR changes `src/` but doesn't update CHANGELOG.md.")
end

# 2. No PR without tests (warn, don't block — let humans judge exceptions).
has_test_changes = !git.modified_files.grep(/(test|spec)/).empty?
if has_app_changes && !has_test_changes
  warn("App code changed but no tests were added or modified. Intentional?")
end

# 3. Big PRs review badly — nudge toward splitting (see PR Scope & Size).
if git.lines_of_code > 500
  warn("This PR is #{git.lines_of_code} lines. Large PRs get worse reviews — can it be split?")
end

# 4. Hard rule: never merge a debugging leftover.
fail("Remove the `binding.pry` before merging.") if `grep -rn binding.pry src`.length > 1
```

The distinction matters: **reviewdog** surfaces findings from existing tools *in the right place*; **Danger** lets you *invent* project-specific rules. Both shift mechanical-but-bespoke checks left, off the human, and — crucially — apply them *uniformly*, so the rule doesn't depend on which reviewer happened to be assigned or whether they remembered it today.

> **Key insight:** Any review comment you find yourself typing on more than three PRs is a rule waiting to be codified. If it's about code patterns, it's a linter rule (reviewdog surfaces it inline); if it's about the PR as an artifact — its description, its tests, its size — it's a Danger rule. Encode it once and stop spending attention on it forever.

---

## Core Concept 5 — AI-Assisted Review as a Triage Layer

LLM-based reviewers — GitHub Copilot code review, CodeRabbit, Graphite Reviewer, Qodo — read a diff and post comments and summaries. Used well, they are a genuine new layer between automation and the human. Used naively, they are a noise generator that erodes trust in the entire review process. The balanced view turns on knowing *what they're good and bad at*.

**What AI review is good at:**

- **First-pass nits** — unhandled errors, an off-by-one, a missing null check, an obvious resource leak — the patterns it has seen a million times.
- **Boilerplate and convention checks** — "this new endpoint is missing the rate-limit middleware the others have."
- **Summarizing a large PR** — a paragraph of "here's what this 40-file PR does" genuinely speeds a human's first orientation.
- **Suggesting tests** — "you didn't cover the empty-input case" is often correct and useful.

**What AI review is bad at:**

- **Deep design, context, and intent** — it doesn't know your architecture, your roadmap, or *why* this trade-off was made. It cannot judge whether this is the *right* change.
- **Correctness on novel logic** — on genuinely new code (not a known pattern), its confidence is unwarranted; it will assert bugs that aren't and miss bugs that are.
- **Noise** — it generates *many* low-value comments. Ten "consider adding a docstring" comments bury the one real bug, and after a week of low-value comments, **humans tune out** — the same trust-erosion that kills any too-noisy check ([08 — Review Anti-patterns](../08-review-anti-patterns/middle.md)).

The correct framing is **augmentation, not replacement**: AI is a **triage layer** that runs *before* the human, clears the obvious first-pass nits, and summarizes the change — so the human starts from a higher floor and spends their attention on design and intent. It is not a reviewer of record. It does not approve. A human still owns the judgment layer.

```yaml
# AI review as a triage layer that runs BEFORE the human is requested
name: ai-triage
on: pull_request
jobs:
  ai-first-pass:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: AI first-pass review (nits + summary, non-blocking)
        uses: coderabbitai/ai-pr-reviewer@latest   # posts summary + inline nits
        # NOTE: comments are advisory. It does NOT count as an approval and
        # does NOT gate merge — a CODEOWNERS human review is still required.
```

The **noise-management** discipline is what separates teams that benefit from AI review from teams that disable it in a month: tune it down hard. Restrict it to high-confidence categories, suppress style comments the linter already owns, and treat a flood of low-value comments as a bug in the tool's configuration — not as "thorough review."

> **Key insight:** AI review's value is bounded by trust, and trust is destroyed by noise. One hallucinated or trivial comment is cheap; a *pattern* of them teaches humans to scroll past *all* of them, including the occasional real find. Configure AI review for precision over recall — better five high-confidence comments than fifty that train your team to ignore the bot.

---

## Core Concept 6 — Async vs Synchronous Review

All the tooling above assumes the default mode of review: **asynchronous and written** — the author opens a PR, reviewers comment when they can, the author responds. It's the default for good reasons, but it's not the only mode, and knowing when to switch is a senior skill.

| Mode | How it works | Strengths | Weaknesses |
|---|---|---|---|
| **Async (written)** | PR comments, replied to over hours/days | Scalable, **documented** (a searchable record), timezone-friendly, lets the reviewer think | Slow round-trips; **tone is lost** in text; threads can spiral |
| **Pair / mob programming** | Continuous review *while* writing | No handoff, no separate review step, instant knowledge transfer | Expensive (two+ people, same time); doesn't scale to every change |
| **Synchronous walkthrough** | Author walks reviewer through it on a call / over the shoulder | High-bandwidth, fast for complex changes, great for onboarding | Not documented unless you write it up; needs everyone present at once |

**Async is the right default** because it scales and leaves a record — the PR thread becomes documentation of *why* the code is the way it is. But it has two failure modes: it is **slow** (each round-trip is hours), and **text loses tone** (a terse comment reads as hostile when it wasn't).

**Switch to synchronous** when async is the wrong tool:

- The change is **big, complex, or cross-team** — a 20-minute walkthrough beats fifty comments trying to convey the same shape.
- **Onboarding** — pairing or a walkthrough teaches a new hire far faster than written nits.
- **The thread is going in circles** — this is the most important trigger. When an async thread has gone back and forth several times without converging, *stop typing and get on a call*. A common rule: **after N round-trips (often 3) on the same point, switch to synchronous** ([05 — Giving & Receiving Feedback](../05-feedback-giving-and-receiving/middle.md) covers this escalation). Five minutes of conversation resolves what fifteen comments couldn't, because tone and back-and-forth are exactly what text is worst at.

**Pair/mob programming** is review taken to its limit — *continuous* review with no separate step and no handoff latency. It's the highest-bandwidth review there is, but it's expensive (two engineers, one keyboard), so teams reserve it for the highest-stakes or highest-learning work rather than every PR.

For chains of dependent changes, **stacked-diff tooling** (Graphite) is the structural answer: instead of one giant async PR, you stack small ones, each reviewed independently and fast ([02 — PR Scope & Size](../02-pr-scope-and-size/middle.md)).

> **Key insight:** Async vs sync is a *bandwidth* choice, not a virtue. Async is low-bandwidth and high-record; sync is high-bandwidth and low-record. Match the channel to the change: async for the routine, sync the moment a thread reveals that the disagreement is about *understanding* (which text conveys badly) rather than a *fact* (which text conveys fine).

---

## Real-World Examples

**1. The team that ended style comments overnight.** A backend team's reviews were 60% formatting and import-order nits. They added a `pre-commit` config (Black + Ruff) and a CI gate that *failed* on unformatted code. Within a week, style comments dropped to near zero — not because reviewers got disciplined, but because unformatted code could no longer reach review. The reviewers' freed attention went to design, and a class of `nil`-deref bugs that had been slipping through started getting caught. The lesson is structural: they didn't ask humans to do better, they removed the work.

**2. CODEOWNERS that stopped the wrong reviews.** A payments change kept getting reviewed by generalists who didn't know the billing invariants, and a double-charge bug shipped. The team added a `/api/billing/ @org/payments-team` line to CODEOWNERS and made it a required reviewer via branch protection. Now no billing PR merges without a billing expert. The fix wasn't a smarter reviewer — it was *routing the PR to the right one automatically*.

**3. The AI bot that got muted.** A team enabled an LLM reviewer with default settings. It posted 30+ comments per PR — docstring suggestions, style nits the linter already owned, and the occasional hallucinated "bug." Within two weeks, authors and reviewers were collapsing the bot's comments unread, and it missed the *one* real concurrency issue it flagged because nobody read its output anymore. They re-scoped it to first-pass nits and PR summaries only, suppressed everything the linter covered, and made it non-blocking. Comment volume dropped 80% and trust returned. Noise had destroyed the signal.

**4. The thread that should have been a call.** Two senior engineers spent three days and twenty comments arguing the shape of an API in an async thread, each convinced the other had misunderstood. A lead read the thread, saw it wasn't converging, and called a 15-minute sync. They discovered they'd been agreeing the whole time and arguing about a naming ambiguity that text had obscured. Decision made, written up in one summary comment for the record. After N round-trips, the tool was wrong — not the people.

---

## Mental Models

- **The stack is a series of nets with shrinking holes.** Each layer catches a category and lets the rest fall through to the next. Format catches layout; lint catches mechanical defects; tests catch "doesn't run"; the human catches "wrong idea." A finding caught by the wrong (higher, more expensive) net means a lower net has a hole — patch the *net*, not the finding.

- **Reviewer attention is the bottleneck resource.** Everything else — CPU for CI, the bot's comments, the formatter — is cheap and scalable. The whole strategy is spending the cheap, scalable things to protect the one expensive, unscalable thing. Optimize the pipeline around the bottleneck, not around the parts that are already cheap.

- **Codify the third repetition.** The first time you make a review comment, it's a comment. The third time you make the *same* comment, it's a missing rule. reviewdog and Danger exist to retire repeated comments into code so a human never has to think about that class again.

- **AI review is an intern, not an oracle.** Useful for the obvious and the boring, confidently wrong on the novel and the subtle. You'd let an intern flag missing null checks; you wouldn't let one approve your architecture. Treat the bot's output the same way: a helpful first pass to be checked, never the final word.

- **Async is mail; sync is a phone call.** Mail scales, leaves a record, and is fine for facts. A phone call is for when the back-and-forth itself is the point — when the thing being negotiated is *understanding*, which text conveys worst. Reach for the phone the moment the thread stops converging.

---

## Common Mistakes

1. **Reviewing what a machine should own.** Commenting on formatting, import order, or style the linter could catch is the cardinal waste — it spends the scarce resource (human attention) on the cheap problem. Move it left into pre-commit or a CI gate and stop commenting on it.

2. **Adding checks without making them gates.** A linter that runs but doesn't *fail* the PR is advisory, and advisory checks get ignored. If a category matters, make the check block merge ([Quality Gates](../../quality-gates/)); if it doesn't matter enough to block, ask why it runs at all.

3. **Treating AI review as a reviewer of record.** Letting an LLM's approval substitute for a human's is the dangerous over-trust. AI triages; it doesn't judge design, context, or intent, and it doesn't approve. A human still owns the judgment layer.

4. **Not managing AI-review noise.** Enabling an LLM reviewer at default verbosity floods the PR with low-value comments, and the team learns to ignore *all* of them — burying the rare real find. Tune for precision: high-confidence categories only, suppress what the linter owns, keep it non-blocking.

5. **Staying async when the thread is circling.** Grinding through a tenth round-trip on a point that text keeps obscuring wastes everyone's time. After a few round-trips, switch to a call — the disagreement is probably about understanding, which a conversation resolves in minutes.

6. **No CODEOWNERS, so review lands on the wrong people.** Without path→owner routing, PRs get reviewed by whoever's free, not whoever knows the code. Map the paths and make the owner a required reviewer, so domain-critical changes always reach a domain expert.

7. **A PR template nobody fills in (or none at all).** An empty description forces every reviewer to reconstruct context from scratch. A template that prompts for *what / why / how-tested / linked-issue* shifts that work onto the author, once, instead of onto every reviewer.

---

## Test Yourself

1. Name the four layers of the review automation stack and the category each one removes from human review.
2. What is the single organizing principle behind the stack, and what is the scarce resource it's protecting?
3. What does CODEOWNERS do, and how does it combine with branch protection to change review?
4. What's the difference in purpose between reviewdog and Danger?
5. AI review is "good at X, bad at Y." Give two of each, and state the role it should play.
6. What is the most important trigger for abandoning async review and switching to a synchronous call?

<details>
<summary>Answers</summary>

1. **(1)** Format on save / pre-commit — removes layout/whitespace/import-order. **(2)** Lint / type-check / SAST in CI — removes mechanical defects, type errors, security smells. **(3)** Tests + coverage/bundle bots — removes "does it run / did coverage drop." **(4)** The human — owns design, correctness on novel logic, intent. Each lower layer is cheaper and earlier, so the human only sees what only a human can judge.
2. **Shift the mechanical left** — move checks toward the developer's keyboard. The scarce resource is the **reviewer's attention**: machines scale, senior reviewers don't, so you spend cheap automation to protect expensive human focus.
3. CODEOWNERS maps repository paths to owning teams/people, so the right reviewers are auto-requested. With branch protection requiring CODEOWNERS approval, that owner's review becomes *mandatory* — domain-critical paths can't merge without a domain expert.
4. **reviewdog** surfaces the output of *existing tools* (linters, type-checkers) as inline comments on the changed lines — it's about *placement*. **Danger** lets you *invent* project-specific rules about the PR as an artifact ("must update CHANGELOG," "no PR without tests," "warn on big PRs") and run them in CI.
5. **Good at:** first-pass nits (missing null checks, off-by-one), boilerplate/convention checks, summarizing big PRs, suggesting tests. **Bad at:** deep design/context/intent, correctness on novel logic, and managing its own noise (floods of low-value comments). Role: an **augmentation / triage layer** that runs before the human and clears the obvious — *not* a reviewer of record, and it doesn't approve or gate merge.
6. **When the async thread stops converging** — after several round-trips on the same point. That signals the disagreement is about *understanding* (which text conveys badly), not a fact, and a short call resolves it far faster. (Other valid triggers: big/complex/cross-team changes, onboarding.)

</details>

---

## Cheat Sheet

```text
THE STACK (each layer removes work from the one above)
  1. format on save / pre-commit   layout, imports        → never reaches review
  2. lint / type-check / SAST (CI) mechanical defects      → not reviewable till green
  3. tests + coverage / bundle     "does it run?"          → posted on the PR
  4. the human                     design / correctness / intent  ← the scarce resource

ORGANIZING PRINCIPLE
  shift the mechanical LEFT — spend cheap automation to protect the
  reviewer's attention (the bottleneck). A "run the formatter" comment
  is a bug in your pipeline, not a contribution.

INFRASTRUCTURE
  CODEOWNERS      path → owner routing (+ branch protection = required reviewer)
  PR template     what / why / how-tested / linked issue — context, shifted left
  suggestions     inline replacement code, one-click apply — collapse the round-trip
  draft PRs       "don't review yet"   auto-assign   spread load (round-robin)
  preview env     deploy-per-PR — click the feature, don't imagine it
  visual-diff / semantic-diff   raise the signal of the diff itself

CODIFY REPEATED COMMENTS (the 3rd time = a missing rule)
  reviewdog   any tool's output → inline PR comments on changed lines
  Danger      team rules as code: CHANGELOG / no-tests / big-PR / no debug leftovers

AI REVIEW  =  triage layer, NOT a reviewer of record
  good: first-pass nits, boilerplate checks, PR summaries, test suggestions
  bad:  deep design/intent, novel-logic correctness, NOISE
  rule: precision over recall, non-blocking, suppress what the linter owns

ASYNC vs SYNC  (a bandwidth choice, not a virtue)
  async = mail   scalable, documented, but slow + tone-loss      ← default
  sync  = call   high-bandwidth, for big/complex/onboarding
  SWITCH TO SYNC after ~N round-trips that aren't converging
  pair/mob = continuous review, highest bandwidth, expensive
  stacked diffs (Graphite) = many small async PRs instead of one giant one
```

---

## Summary

- Review automation is a **four-layer stack**: format/pre-commit, lint/type-check/SAST, tests/coverage, and the human. Each layer removes a category of work from the layer above; a finding caught by too-high a layer means a lower one has a hole.
- The organizing principle is **shift the mechanical left** — spend cheap, scalable automation to protect the scarce, unscalable resource: the reviewer's attention. Every mechanical thing a human reviews is attention not spent on design and correctness.
- **Infrastructure** routes and contextualizes review: CODEOWNERS (path→owner, required reviewers with branch protection), PR templates (context, shifted left), suggested changes (one-click round-trip collapse), draft PRs, auto-assignment, and preview environments.
- **reviewdog** surfaces existing tools' findings as inline PR comments; **Danger** codifies team-specific rules as executable checks. Any comment you type a third time is a rule to encode.
- **AI review** is a **triage layer**, not a reviewer of record — good at first-pass nits, boilerplate, and summaries; bad at design, novel-logic correctness, and noise. Tune it for precision, keep it non-blocking, and never let it replace human judgment.
- **Async** written review is the scalable, documented default; **synchronous** review is the high-bandwidth tool for big/complex/cross-team changes, onboarding, and — most importantly — the moment an async thread stops converging after a few round-trips.

---

## Further Reading

- [GitHub Docs — About code owners (CODEOWNERS)](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners) — the routing syntax and required-reviewer integration.
- [GitHub Docs — Incorporating feedback with suggested changes](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/incorporating-feedback-in-your-pull-request) — one-click code suggestions.
- [Danger — Systematise your team's conventions](https://danger.systems/) — codifying review rules as CI checks; the Dangerfile reference.
- [reviewdog](https://github.com/reviewdog/reviewdog) — turning any linter's output into inline PR comments.
- [pre-commit](https://pre-commit.com) — the framework for managing format/lint hooks at the keyboard (Layer 1).
- *On AI code review, balanced* — read a vendor-neutral piece (e.g. a "what AI code review is and isn't good at" engineering blog) alongside a tool's own docs; weigh the triage-layer framing against the noise-management problem before adopting.
- [senior.md](senior.md) — designing the whole review pipeline as a system: gate policy, merge queues, custom analyzers, and the economics of where to spend automation.

---

## Related Topics

- [05 — Giving & Receiving Feedback](../05-feedback-giving-and-receiving/middle.md) — the human craft the tooling exists to protect; severity labels, suggestions, and the switch-to-sync escalation.
- [01 — What to Look For & In What Order](../01-what-to-look-for-and-order/middle.md) — what a human should review once the machines have spoken.
- [Static Analysis & Linting](../../static-analysis/) — Layer 2 in depth: the linters, type-checkers, and SAST tools that run before a human looks.
- [Quality Gates](../../quality-gates/) — the policy layer that turns a CI check into a *required* gate and CODEOWNERS approval into a *mandatory* one.
- [Testing](../../testing/) — Layer 3: the test suite and coverage signals the bots post on the PR.
