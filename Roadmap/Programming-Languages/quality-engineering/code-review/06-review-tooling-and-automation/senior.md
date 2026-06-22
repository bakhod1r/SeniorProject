# Review Tooling & Automation — Senior Level

> **Roadmap:** [Code Review](../README.md) → Review Tooling & Automation
> *The middle page showed you the bots and the config. This page is about the system: where each class of defect is cheapest to catch, why a single noisy bot can poison every gate you own, how AI review actually behaves when you measure it, and how to arrange all of it so the human's scarce attention lands only on judgment.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Automation as a Signal-to-Noise System](#core-concept-1--automation-as-a-signal-to-noise-system)
5. [Core Concept 2 — The Automation Hierarchy](#core-concept-2--the-automation-hierarchy)
6. [Core Concept 3 — The Noise Budget and the Boy-Who-Cried-Wolf Failure](#core-concept-3--the-noise-budget-and-the-boy-who-cried-wolf-failure)
7. [Core Concept 4 — Inline Annotations vs Comment Spam (reviewdog / Danger)](#core-concept-4--inline-annotations-vs-comment-spam-reviewdog--danger)
8. [Core Concept 5 — CODEOWNERS and Routing at Scale](#core-concept-5--codeowners-and-routing-at-scale)
9. [Core Concept 6 — AI-Assisted Review, Measured](#core-concept-6--ai-assisted-review-measured)
10. [Core Concept 7 — Workflow Tooling: Stacks, Queues, Auto-Merge](#core-concept-7--workflow-tooling-stacks-queues-auto-merge)
11. [Core Concept 8 — Async vs Sync as a Latency Decision](#core-concept-8--async-vs-sync-as-a-latency-decision)
12. [Core Concept 9 — The Metrics the Tooling Must Expose](#core-concept-9--the-metrics-the-tooling-must-expose)
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

> Focus: **Review automation as a system that maximizes the human reviewer's signal-to-noise and throughput — not a pile of bots that each seemed like a good idea.**

By the middle level you can wire up a formatter, a linter, a CI gate, and a CODEOWNERS file, and you know which bots exist. That makes you productive on one repo. The senior jump is different: you now own *the policy for where defects get caught*. You decide which class of issue belongs to a formatter, which to a linter in CI, which to sanitizers and fuzzing, which to tests, and — the residual — which is left for a human. You decide which bots are allowed to comment, how their output is severity-tagged and batched, whether an LLM reviewer runs before or after the human, and what evidence would let you turn it off.

Each of those decisions has a second-order effect on the one resource the whole system exists to protect: a senior engineer's reading attention. Spend it on formatting nits and you have a slow, demoralized review culture that catches nothing important. Spend it only on design, intent, and novel correctness — because everything mechanical was caught upstream and routed correctly — and review becomes the leverage point it is supposed to be. The organizing principle of this page is one sentence: **every comment a human makes that a tool could have made is a process defect.** This page is how you drive that number toward zero without drowning everyone in tool output instead.

---

## Prerequisites

- **Required:** You've internalized [middle.md](middle.md) — formatters, linters, CI checks, CODEOWNERS basics, what the common bots do.
- **Required:** You've felt review latency as a real cost — a PR that sat a day waiting for first response, or a thread that took six round-trips to resolve.
- **Helpful:** You've configured a CI pipeline and a required status check, and watched a flaky one get ignored.
- **Helpful:** You've used or evaluated at least one AI review tool and have an opinion you can defend with more than vibes.

---

## Glossary

- **Signal-to-noise (S/N):** the ratio of comments/checks worth a reviewer's attention to total comments/checks produced. The quantity all review automation either raises or destroys.
- **Noise budget:** the finite tolerance a team has for low-value automated output before it starts ignoring *all* of it. A shared, depletable resource.
- **Automation hierarchy:** the ordered set of catch points (formatter → linter/type/SAST → sanitizers/fuzzing → tests → human), each defined by where a class of issue is cheapest and most reliably caught.
- **Process defect:** any human review comment that a tool could have produced deterministically. A signal that a rule should be automated.
- **Inline annotation:** a bot comment attached to a specific line/range (GitHub Checks annotations, reviewdog), as opposed to a top-level comment. The actionable, low-noise form.
- **reviewdog:** a tool that takes arbitrary linter output and posts it as inline review annotations, only on the changed lines (the diff), suppressing pre-existing issues.
- **Danger:** a bot framework (`Dangerfile`) that runs *policy* checks on a PR's metadata and diff (e.g., "PR touches schema but not migrations") and fails/warns with messages.
- **CODEOWNERS:** a file mapping path globs to owning users/teams; integrates with required reviews to auto-request and gate. Last-match-wins per file.
- **Merge queue:** a system that serializes merges, re-testing each PR against the actual post-merge tree to prevent semantic merge conflicts ("two greens that break when combined").
- **Stacked diffs:** a workflow where one logical change is split into a chain of small, individually-reviewable, dependent PRs (Graphite, Gerrit, Sapling).
- **Precision / false-positive rate:** of the issues a tool (or AI reviewer) flags, the fraction that are real. The single number that determines whether people trust it.
- **Action rate:** the fraction of a bot's comments that result in a code change. The empirical measure of an automated reviewer's value.

---

## Core Concept 1 — Automation as a Signal-to-Noise System

The naïve framing of review automation is "add tools that catch bugs." That framing produces the pathology every large org has lived through: twelve bots, four overlapping linters, an AI reviewer, three required checks of dubious provenance — and reviewers who skim past all of it because somewhere in the wall of output is the one comment that matters and they can't find it.

The correct framing is information-theoretic. A reviewer has a fixed attention budget per PR — call it a few minutes of genuine focus. Every automated comment and every check consumes some of that budget *whether or not it's useful*, because the human still has to read it to decide it's useless. So the value of an automation isn't "does it ever catch something"; it's **does it raise the signal-to-noise of the PR as the human experiences it.** A check that's right 99% of the time raises S/N. A check that's right 30% of the time *lowers* it — it costs more attention than it returns — even though it occasionally catches a real bug.

This reframing is what separates senior tooling decisions from junior ones. The junior question is "can we detect X?" The senior questions are: *Where is X cheapest to detect? What's the false-positive rate at that point? What does surfacing it cost the reviewer's attention? Is that trade positive?* Tools are not free just because they're automated; they spend the reviewer's attention, which is the most expensive resource in the system.

> **Key insight:** The job of review automation is not to catch the most bugs. It is to deliver the human reviewer a PR where their scarce, expensive judgment is the only thing left to apply. A tool that catches a real bug 30% of the time while burying it in false positives can be *worse than no tool*, because it taxes the attention you were trying to conserve.

---

## Core Concept 2 — The Automation Hierarchy

Every class of issue has a *cheapest reliable catch point* — the earliest place in the pipeline where it can be detected deterministically, with low false positives, and without a human. Putting each class at its right level is the core design act. Below it, the catch is impossible (the information isn't there yet); above it, you're wasting a more expensive resource on something a cheaper one could have handled.

| Issue class | Best caught by | Where | Human involvement | False positives |
|---|---|---|---|---|
| Formatting, import order, whitespace | **Formatter** (gofmt, Prettier, black, clang-format) | pre-commit + CI | **Zero** | None (deterministic) |
| Style rules, unused vars, simple bug patterns | **Linter** (golangci-lint, ESLint, ruff, clippy) | CI / inline | Zero | Low (tunable) |
| Type errors, null/undefined, contract mismatch | **Type checker** (tsc, mypy, the compiler) | CI | Zero | Very low |
| Known vuln patterns, injection, secrets, taint | **SAST / secret scanner** (CodeQL, Semgrep, gitleaks) | CI | Triage only | Medium (needs tuning) |
| Memory safety, UB, data races, leaks | **Sanitizers + fuzzing** (ASan/TSan/UBSan, libFuzzer) | CI / nightly | Zero | None (real or nothing) |
| Behavioral correctness, regressions | **Automated tests** | CI | Write/maintain | None |
| Architectural fit, intent, naming, novel correctness, security model | **The human reviewer** | review | **All of it** | N/A — judgment |

Read this table top-to-bottom as a *delegation order*. Formatting is the canonical example: it is the most-argued-about and least-important review topic, and it has a deterministic tool. The moment a human types "nit: missing space here," the system has failed — that comment is a process defect. The fix is never "remind people to format"; it is **run the formatter in pre-commit and reject unformatted code in CI**, so the comment becomes impossible. The same logic walks down the table. A reviewer flagging an unused import? Add the lint rule. A reviewer spotting a SQL string built by concatenation? That's a Semgrep/CodeQL rule. A reviewer catching a use-after-free by reading carefully? That's ASan's job (see [Dynamic Analysis & Sanitizers](../../dynamic-analysis-and-sanitizers/) for why a sanitizer finds it deterministically and a human won't).

What's left at the bottom is the *irreducible* human work: does this design fit the system, is the abstraction right, is the intent clear, is this novel logic actually correct, does it open a hole the model didn't anticipate. No tool produces those. That's the entire point of pushing everything else down — to clear the human's view so they see *only* that.

> **Key insight:** Automate the rule, not the reminder. Any class of issue that a human can catch by following a deterministic procedure belongs to a tool, and every human comment of that class is a bug report against your pipeline. "Be more careful about X in review" is the symptom; "add the check that makes X impossible to merge" is the cure.

The hierarchy also explains a subtle failure: catching something *too high*. Running a slow whole-program SAST as a blocking pre-merge check when it has a 40% false-positive rate doesn't belong at the gate — it belongs as a triaged, async signal a security team curates. Level matters in both directions.

---

## Core Concept 3 — The Noise Budget and the Boy-Who-Cried-Wolf Failure

Here is the failure mode that destroys more review-automation programs than any technical limitation: **a single noisy bot trains humans to ignore all bot output.** This is the exact same pathology as the flaky test gate ([Quality Gates](../../quality-gates/)) and the alert that pages too often — once a signal has cried wolf enough times, the rational human response is to stop reading it. And crucially, humans don't stop reading *just that bot* — attention is coarse-grained, so they start skimming past *every* automated comment, including the good ones from your well-tuned linter.

This means the noise budget is a **shared, depletable resource across all your automation**. A new bot doesn't just have to be net-positive on its own; it has to be net-positive against the attention it draws away from everything else. A spammy dependency-bump bot that opens 40 comments a week can single-handedly destroy the credibility of a high-precision SAST tool sharing the same comment stream.

The senior disciplines for protecting the budget:

- **Curate which bots may comment.** Not every tool gets a voice in the PR thread. Low-precision tools post to a dashboard or a non-blocking summary, not inline. Earning comment rights is a privilege a tool keeps only while its precision stays high.
- **Severity-tag everything.** A bot comment must carry whether it's an `error` (blocks), `warning` (consider), or `info` (FYI). Reviewers filter on severity; mixing a blocking security finding with a style suggestion in the same undifferentiated voice forces the human to re-triage every line.
- **Batch, don't spray.** One summary comment with a collapsed list beats forty inline comments. Forty inline comments from a bot is indistinguishable from an attack on the author's morale.
- **Diff-scoped, not whole-repo.** Only comment on lines the PR *changed*. Surfacing 200 pre-existing lint violations on a 10-line PR is the single fastest way to get a bot muted org-wide. (This is reviewdog's central design choice — see next section.)
- **Make comments dismissable and actionable.** Every bot comment should be resolvable, and ideally carry a suggested fix or a one-click suppression with a reason. A comment the human can't act on or close is pure noise.
- **Measure action rate and cut the dead weight.** If a bot's comments are actioned <X% of the time, it is consuming budget it isn't earning. Turn it off or fix it. (This is the same evaluation you'll apply to AI review.)

> **Key insight:** The noise budget is shared across every automated voice in the PR. One low-precision bot doesn't just waste its own attention — it teaches reviewers to ignore the whole channel, including your good tools. Curate ruthlessly: comment rights are earned by precision and revoked when precision drops, exactly like a flaky gate loses its right to block.

---

## Core Concept 4 — Inline Annotations vs Comment Spam (reviewdog / Danger)

The delivery mechanism for automated findings matters as much as the findings. The two dominant good patterns are *inline annotations on the diff* and *policy checks on PR metadata* — reviewdog and Danger respectively.

**reviewdog** solves the "linter output is a wall of text in CI logs nobody reads" problem. It takes any tool's output (via a defined format or regex), intersects it with the PR's diff, and posts the *new* violations as inline review annotations — not the pre-existing ones. The diff-scoping is the whole point: it makes adopting a new linter on a legacy codebase painless, because the bot only ever nags about lines you actually touched.

```yaml
# .github/workflows/review.yml — reviewdog posting golangci-lint inline, diff-only
name: reviewdog
on: [pull_request]
jobs:
  golangci-lint:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write   # to post review comments
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: reviewdog/action-golangci-lint@v2
        with:
          reporter: github-pr-review      # inline comments on the diff
          filter_mode: added              # ONLY lines this PR added/changed
          level: warning                  # severity tag → reviewers can filter
          fail_on_error: false            # advisory, not a hard gate (tune per-tool)
```

The `filter_mode: added` line is the noise-budget discipline made concrete: a 10-line PR will never be buried under the repo's historical debt. `level: warning` is the severity tag. `fail_on_error: false` keeps a still-maturing linter advisory until its precision earns it the right to block.

**Danger** operates one layer up — on *policy* rather than code style. A `Dangerfile` encodes the checklist items a human used to type by hand, turning "did you remember to…?" comments into automated, consistent ones:

```ruby
# Dangerfile — policy checks that used to be human review comments
# 1. Big PRs need a heads-up (links to PR-size discipline)
warn("This PR is #{git.lines_of_code} lines. Consider splitting for reviewability.") if git.lines_of_code > 500

# 2. Schema change without a migration is almost always a mistake
schema_changed   = git.modified_files.grep(/db\/schema/).any?
migration_added  = git.added_files.grep(/db\/migrate/).any?
fail("Schema changed but no migration was added.") if schema_changed && !migration_added

# 3. Public API touched → require a CHANGELOG entry
api_changed       = git.modified_files.grep(/^api\//).any?
changelog_touched = git.modified_files.include?("CHANGELOG.md")
fail("Public API changed — add a CHANGELOG entry.") if api_changed && !changelog_touched

# 4. New code should arrive with tests
has_app_changes  = git.modified_files.grep(/^src\//).any?
has_test_changes = git.modified_files.grep(/_test\.|\.test\./).any?
warn("App code changed without test changes — intentional?") if has_app_changes && !has_test_changes
```

Every one of those rules replaces a category of comment a senior reviewer was previously typing by hand, inconsistently, and forgetting half the time. That is the automation hierarchy applied to *process* checks: the checklist becomes a tool, the human stops being the checklist, and the human's attention returns to judgment. The distinction between `warn` and `fail` is the severity tag — `fail` blocks merge, `warn` is advisory — and getting that split right is most of what makes Danger helpful rather than hated.

> **Key insight:** *How* a finding is delivered determines whether it costs or saves attention. The same lint result is noise as a CI-log wall and signal as a diff-scoped inline annotation. reviewdog makes findings cheap by scoping them to changed lines; Danger makes the review *checklist* a tool instead of a thing humans forget. Both convert "things a careful human would say" into "things the system says consistently and for free."

---

## Core Concept 5 — CODEOWNERS and Routing at Scale

Getting the right *human* on a PR is itself an automation problem, and at monorepo scale it's a non-trivial one. CODEOWNERS maps path globs to owning teams and integrates with required reviews so the right people are auto-requested and the merge is gated on their approval.

```
# CODEOWNERS — order matters: LAST matching pattern wins per file
*                           @org/eng-leads          # fallback owner
/services/payments/         @org/payments-team
/services/payments/*.proto  @org/payments-team @org/api-review   # protos need API review too
/infra/                     @org/platform
/infra/terraform/prod/      @org/platform @org/sre  # prod infra: platform AND sre
*.md                        @org/docs               # docs anywhere, unless overridden below
/services/payments/README.md @org/payments-team     # this beats *.md (later line)
```

The senior-relevant mechanics and failure modes:

- **Last-match-wins, per file.** Unlike `.gitignore`'s cumulative semantics, CODEOWNERS uses the *last* matching pattern for each file. A late broad pattern (`*.md`) can silently steal ownership from an earlier specific one — order your file specific-to-general carefully, or you'll route docs PRs to the wrong team.
- **Monorepo performance.** On a repo with hundreds of thousands of files and a deep CODEOWNERS file, matching every changed path against every glob is real work; pathological patterns slow PR creation. Keep patterns anchored (`/services/...`) rather than unanchored globs that must scan everything.
- **The stale-owner / bus-factor problem.** Ownership-as-code rots. A team that reorganized, a person who left, a directory nobody owns anymore — these turn required-review gates into *blocked* PRs waiting on a phantom reviewer. Audit CODEOWNERS for ghost teams and single-person ownership (bus factor of one) the way you audit dependencies for staleness.
- **Required-review integration is the teeth.** CODEOWNERS without "require review from code owners" branch protection is just a suggestion. With it, it's a gate — which means its correctness is now load-bearing for *every* merge in those paths.
- **Routing vs reviewing.** CODEOWNERS routes *correctness of ownership*; it does not load-balance. Auto-assignment of which *individual* on a team reviews (round-robin, load-aware) is a separate concern handled by the platform or a reviewer-assignment bot — otherwise the same two senior engineers absorb every request and become the bottleneck (a tempo problem; see [07 — Review Metrics & Tempo](../07-review-metrics-and-tempo/senior.md)).

> **Key insight:** CODEOWNERS is ownership-as-code, and like all code it has semantics that bite (last-match-wins), performance characteristics at scale, and rot. A stale CODEOWNERS doesn't fail loudly — it silently routes to ghosts and blocks merges, which is why ownership needs the same staleness auditing you give dependencies.

---

## Core Concept 6 — AI-Assisted Review, Measured

LLM-based reviewers are the loudest new entry in the tooling space, and they are best understood not as a new category but as *another automated reviewer subject to the same noise-budget and precision discipline as every other bot.* The mechanics are straightforward: the tool takes the diff plus some retrieved context (surrounding files, sometimes the PR description and linked issue), and emits a summary and a set of comments. What's worth a senior's attention is *where this genuinely helps, where it reliably fails, and how to integrate it so the failures don't cost you trust.*

**Where LLM review genuinely helps:**

- **PR summarization / orientation.** A concise "what changed and why" generated from the diff genuinely lowers the human's ramp-up cost on a large PR. Low-risk: a wrong summary is caught immediately by the human reading the actual diff.
- **First-pass nit and obvious-bug triage.** Off-by-one in a loop bound, a swapped argument, an unhandled error path, a forgotten null check — LLMs catch a real fraction of these *before* a human looks, and the author can fix them first.
- **Test-gap suggestions.** "This new branch has no test covering the error case" is a pattern LLMs surface reasonably well, and it's actionable.
- **Boilerplate / checklist enforcement.** Same role as Danger, but for things that need a little judgment ("this exported function lacks a doc comment explaining the units").
- **Lowering reviewer load on routine PRs.** For mechanical, low-novelty changes, an AI first pass plus a light human confirmation is a legitimate throughput win.

**Where LLM review reliably fails:**

- **No real system context.** It doesn't know your invariants, your deployment model, the incident this code is working around, or why the "obviously redundant" check is load-bearing. It reviews the diff, not the system.
- **Hallucinated issues.** It confidently flags bugs that aren't bugs, suggests "fixes" that break behavior, and cites APIs that don't exist. Every false positive spends noise budget.
- **Confident-but-wrong on novel logic.** On exactly the code that most needs careful review — genuinely new, tricky correctness — it is least reliable and most confident. It pattern-matches; novel logic has no pattern.
- **Trust erosion.** A stream of plausible-but-wrong comments trains reviewers to ignore the AI, and (per the shared noise budget) to skim other automation too.
- **The deskilling risk.** The "LGTM, the AI said it's fine" failure: humans defer their judgment to a tool that has none of the system context that makes the judgment necessary. This is the most dangerous outcome, because it removes the irreducible human work the whole hierarchy exists to protect.
- **Security / privacy.** Sending proprietary source to a third-party model is a data-governance decision, not a developer convenience. Know where the code goes, what's retained, and whether that's allowed before you turn it on.

**The integration patterns that work** all share one rule: **AI is pre-human triage, never an approver.**

- **AI runs first; the author addresses its comments before requesting human review.** This puts the AI's value (catching the obvious) ahead of the human and makes its false positives the *author's* cheap problem to dismiss, not the reviewer's expensive one.
- **AI summary orients the human;** it does not replace reading the diff.
- **AI cannot satisfy a required approval.** It has no accountability and no system context; an approval is a human taking responsibility. Wiring an AI as an approving reviewer is the architectural version of the deskilling failure.

**Evaluating an AI reviewer — treat it like any other gate.** You would never adopt a SAST tool without measuring its false-positive rate; the same standard applies here, and "it feels smart" is not a metric.

| Metric | What it tells you | Healthy direction |
|---|---|---|
| **Precision** of its comments | fraction of flagged issues that are real | high; a low-precision AI reviewer is a noise generator |
| **% actioned** (action rate) | fraction of comments that led to a code change | high; the empirical proof it's earning attention |
| **False-positive rate** | fraction of comments dismissed as wrong | low; this is what burns the noise budget |
| **Catch rate on seeded bugs** | of known bugs, how many it finds | informative, but secondary to precision |
| **Reviewer trust / opt-out rate** | are humans muting or ignoring it | the lagging indicator of the above |

```yaml
# Integration shape: AI as a pre-human triage gate, NOT an approver
on: pull_request
jobs:
  ai-triage:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: AI review (advisory, author-addressed first)
        uses: <ai-review-action>
        with:
          mode: comment            # post comments + summary
          require_approval: false  # MUST be false — AI never satisfies a required review
          severity_label: ai       # tag so humans can filter AI vs tool vs human
          fail_on_error: false     # advisory; CODEOWNERS humans are the real gate
# Branch protection: required reviewers = CODEOWNERS humans only. The AI is never on that list.
```

> **Key insight:** An AI reviewer is a bot, and the bot rules apply unchanged: measure its precision and action rate, give it comment rights only while they stay high, and revoke them when they drop. Its right place is *pre-human triage the author fixes first* — never an approver. The moment "the AI approved it" substitutes for human judgment, you've automated away the one thing in the hierarchy that was never automatable.

---

## Core Concept 7 — Workflow Tooling: Stacks, Queues, Auto-Merge

Beyond catching issues, tooling shapes the *flow* of changes through review. Four pieces matter at scale.

**Stacked diffs** (Graphite, Gerrit, Sapling) split one logical change into a chain of small, dependent, individually-reviewable PRs. The motivation is the PR-size discipline: small PRs get faster, better reviews, but real features are big. Stacking lets you keep each *unit* small while expressing the dependency, so the reviewer reads a 100-line PR with clear intent instead of an 1,100-line one — without you having to wait for each layer to merge before building the next. (The change-decomposition reasoning lives in [02 — PR Scope & Size](../02-pr-scope-and-size/senior.md); here the point is that *tooling* is what makes small-PR discipline survive real feature work.)

**Merge queues** solve the "two greens that break together" problem — semantic merge conflicts. PR A and PR B each pass CI against `main`, but combined they break, because neither was tested against the other. A merge queue serializes merges and re-runs tests against the *actual* tree each PR will produce, catching the interaction before it lands on `main`. This is a [Quality Gates](../../quality-gates/) concern at heart — it's the gate that defends the trunk's green state under concurrency.

**Auto-merge-when-green** removes the human from the *final* mechanical step: once approvals and required checks pass, the PR merges itself. This is pure attention conservation — the senior who approved shouldn't have to come back twenty minutes later to click merge after CI finishes. It composes with the merge queue: approve, mark auto-merge, walk away; the queue lands it safely when it's that PR's turn and the tree is still green.

**Review load-balancing / auto-assignment** distributes review requests across a team rather than letting them pile on the two most senior people. Round-robin is the floor; load-aware assignment (accounting for current review queue depth, time zone, and expertise) is better. Without it, CODEOWNERS routes everything to a team and the team's informal "whoever's free" degrades into "the same two people always," which is a tempo and burnout problem ([07 — Review Metrics & Tempo](../07-review-metrics-and-tempo/senior.md)).

> **Key insight:** Workflow tooling doesn't catch bugs — it removes latency and mechanical steps so the human's involvement is *only* the judgment. Stacks keep PRs small under real feature pressure; merge queues defend green under concurrency; auto-merge and auto-assignment delete the clicks and the bottlenecks around the actual review.

---

## Core Concept 8 — Async vs Sync as a Latency Decision

Review defaults to asynchronous, and for good reason: it respects focus time and doesn't require two calendars to align. But async has a cost that tooling can't fully erase — **round-trip latency.** Each comment-reply cycle is a context switch and a wall-clock delay (often hours, given time zones), and a thread that takes six round-trips to converge can stretch a 20-minute conversation across three days.

The senior skill is recognizing when to *escalate to sync* — when the round-trip cost of async exceeds the coordination cost of a call:

- **High back-and-forth.** Once a thread passes ~3 round-trips without converging, the async medium is the bottleneck, not the disagreement. Get on a call; resolve in ten minutes; post a summary comment back for the record.
- **Design disagreement, not line-level.** Async excels at "this line has a bug." It's terrible at "I think this whole approach is wrong" — that's a conversation, and forcing it through PR comments is slow and adversarial-feeling.
- **High-context or sensitive feedback.** Significant rework or anything that could read as harsh is better delivered synchronously, where tone is legible (a [feedback](../05-feedback-giving-and-receiving/senior.md) concern).

And **pair/mob programming is continuous synchronous review** — the round-trip latency goes to zero because review happens *as the code is written*. For the highest-stakes or highest-novelty changes (exactly the code where async review is slowest and AI review is least reliable), pairing collapses the entire review loop into the authoring loop. It trades two people's time for near-zero defect-to-feedback latency — sometimes the right trade, sometimes not, but a deliberate one.

> **Key insight:** Async vs sync is a latency optimization, not a culture preference. Async is the efficient default for low-round-trip, line-level feedback; the moment a thread is converging slowly or the topic is design-level, the round-trip cost dominates and you escalate to sync. Pairing is the limiting case — continuous review with zero feedback latency, reserved for changes where that latency matters most.

---

## Core Concept 9 — The Metrics the Tooling Must Expose

You cannot tune a system you can't see, and the whole point of this page — driving human-catchable-by-tool comments to zero while protecting the noise budget — requires measurement. The tooling must expose at least these (they feed directly into [07 — Review Metrics & Tempo](../07-review-metrics-and-tempo/senior.md) and the broader engineering-metrics picture):

- **Time-to-first-review (TTFR).** The latency from "PR ready" to "first human response." The dominant driver of cycle time and author frustration. If TTFR is high, the answer is usually routing/load-balancing and auto-assignment, not exhortation.
- **Bot-comment action rate.** Per bot: what fraction of its comments led to a change. This is the single most important automation-health metric — it's how you find the noise-budget thieves. A bot below threshold gets fixed or muted.
- **Automated-vs-human catch ratio.** Of all defects caught during review, how many were caught by tools vs humans. A *rising* automated share (for mechanical defect classes) is the goal — it means the hierarchy is working and human comments are shifting toward judgment. A high human share of *mechanical* catches is a backlog of process defects waiting to be automated.
- **Review round-trips per PR.** High average round-trips flags either unclear PRs (a [scope/size](../02-pr-scope-and-size/senior.md) problem) or threads that should have escalated to sync.
- **AI reviewer precision / action rate.** Tracked exactly like any other bot, because it *is* one.

> **Key insight:** The metric that tells you whether the automation hierarchy is working is the **automated-vs-human catch ratio for mechanical defects** — when humans are still catching formatting, lint, and known-pattern issues, each one is a process defect and an unautomated rule. Drive that human share down by adding the tool; let the rising automated share clear the human's view for judgment, which no metric can capture and no tool can do.

---

## Real-World Examples

**1. Google's analysis platform (Tricorder) and the "automate the rule" doctrine.** Google's static-analysis program is built on the explicit finding that *developers ignore tools with high false-positive rates*, and that the way to keep analyzers trusted is to gate them on a measured "not useful" feedback rate — analyzers whose findings get dismissed too often are removed from the critical path. Their *Code Review Developer Guide* codifies the cultural half: reviewers are told not to nit on things tooling should own, and the platform exists to keep those things off the human's plate. This is the entire automation-hierarchy + noise-budget thesis, validated at scale: precision is the currency, and a tool that spends it carelessly loses its right to interrupt humans.

**2. The dependency-bot that ate the noise budget.** A team adds an automated dependency-update bot. It opens 30–50 PRs and posts dozens of comments a week, most of them trivial patch bumps. Within a month, reviewers are auto-skimming everything from bots — and the high-precision CodeQL findings sharing that comment stream start getting ignored too. The fix isn't removing dependency updates; it's *batching* them (one weekly grouped PR), severity-tagging (security bumps inline, routine bumps to a dashboard), and restoring the distinction between "a bot found a real security issue" and "a patch version exists." Action rate on the security findings recovers once the noise around them is cleared. The lesson: the offending bot's individual value was real; its cost to the *shared* budget was the problem.

**3. AI review adopted, measured, repositioned.** A company turns on an LLM reviewer as an approving reviewer on routine PRs. Within weeks, two things happen: a few real bugs get caught early (good), and a "LGTM, AI approved" culture starts forming on changes the AI had no context to judge (bad). They measure: precision ~55%, action rate ~30% — meaning most of its comments were dismissed. They reposition it: AI now runs *pre-human*, the author addresses its comments first, it can no longer satisfy a required review, and its summary is used to orient the human. Same tool, different place in the hierarchy — now a genuine throughput aid instead of a deskilling risk, and the false positives are the author's cheap problem instead of the reviewer's expensive one.

**4. CODEOWNERS rot blocks a release.** A monorepo team relies on required-code-owner review. A reorg dissolves `@org/legacy-billing`, but the CODEOWNERS lines pointing at it remain. A hotfix to a billing path is now *unmergeable* — it's waiting on approval from a team that no longer exists, and nobody notices until the release is blocked at 11pm. The fix is immediate (reassign the paths) but the real fix is process: a scheduled CI job that validates every CODEOWNERS entry resolves to a live team with more than one member, treating ownership staleness exactly like a stale dependency.

---

## Mental Models

- **Attention is the budget; tools spend it.** Every check and comment costs the human reading attention whether or not it's useful, because they must read it to dismiss it. The value of an automation is its effect on signal-to-noise *as the human experiences the PR*, not whether it ever catches anything.

- **Every defect has a cheapest catch point — find it and put the catch there.** Formatting → formatter, patterns → linter/SAST, memory safety → sanitizers, behavior → tests, judgment → human. Catching something one level too high wastes a more expensive resource; one level too low is impossible.

- **A human comment a tool could've made is a bug report against your pipeline.** Don't fix it with a reminder; fix it by adding the tool/rule that makes the comment impossible. Automate the rule, not the reminder.

- **The noise budget is shared and depletable.** One low-precision bot teaches humans to ignore the whole automated channel, including your good tools. Comment rights are earned by precision and revoked when it drops — same logic as a flaky gate losing its right to block.

- **AI review is just another bot.** Measure its precision and action rate, place it as pre-human triage the author fixes first, and never let it approve. "The AI said it's fine" is the deskilling failure — it delegates the one job that was never delegable.

- **The end state is a clean view.** The human should open a PR that's already formatted, linted, type-checked, tested, green, AI-triaged, and routed to the right owner — so their scarce judgment lands on design, intent, and novel correctness and nothing else.

---

## Common Mistakes

1. **Humans commenting on things a tool owns.** "nit: spacing," "unused import," "use const here" — every one is a process defect. The fix is the formatter in pre-commit and the lint rule in CI, not a more diligent reviewer. If a human is typing it, a tool should be.

2. **Adding a bot without measuring its action rate.** A bot that's actioned 15% of the time is a noise-budget thief, however clever it is. Without the action-rate metric you can't tell your good automation from your bad, and the bad poisons the good.

3. **Letting one noisy bot run unbatched.** Forty inline comments from a dependency bot trains reviewers to ignore *all* bot output. Batch into one summary, severity-tag, push low-value findings off the inline channel — protect the shared budget.

4. **Surfacing whole-repo findings on a small PR.** Posting 200 historical lint violations on a 10-line change is the fastest way to get a tool muted. Always diff-scope (reviewdog's `filter_mode: added`) — comment only on lines the PR touched.

5. **Wiring an AI reviewer as an approver.** It has no system context and no accountability; an approval is a human taking responsibility. AI belongs *before* the human, as triage the author addresses first — never as a substitute for the required human review.

6. **Trusting an AI reviewer without evaluating it.** You'd measure a SAST tool's false-positive rate; do the same here. "It feels smart" is not precision. Track precision and action rate and pull its comment rights if they fall — and know where your source code is being sent.

7. **CODEOWNERS that's never audited.** Last-match-wins silently re-routes; ghost teams silently block merges. Stale ownership doesn't fail loudly — it fails at 11pm before a release. Audit it for live, multi-member owners on a schedule, like dependencies.

8. **Treating async as sacred.** A thread on its sixth round-trip isn't thorough review — it's the medium being the bottleneck. Escalate design disagreements and slow-converging threads to a call; post a summary back. Async is a default, not a religion.

---

## Test Yourself

1. State the organizing principle of review automation in one sentence, and explain what it implies you should do when a senior reviewer keeps commenting on formatting.
2. Define the "noise budget" and explain why a single low-precision bot can degrade the value of a *different*, high-precision tool.
3. Walk the automation hierarchy: name the best catch point for (a) import ordering, (b) a SQL injection pattern, (c) a data race, (d) whether an abstraction fits the system. Why does the last one stay with the human?
4. What is reviewdog's `filter_mode: added` for, and why does diff-scoping matter to the noise budget?
5. List two places an LLM reviewer genuinely helps and two where it reliably fails. What's the one integration rule that follows from the failures?
6. You're evaluating an AI reviewer that "feels useful." What two numbers do you measure, and what would make you revoke its right to comment?
7. CODEOWNERS uses last-match-wins. Give a concrete way that bites, and name the staleness failure that blocks merges silently.
8. A review thread is on its sixth back-and-forth. What does that tell you about the medium, and what do you do?

<details>
<summary>Answers</summary>

1. **"Every comment a human makes that a tool could have made is a process defect."** It implies you should never respond to repeated formatting nits with a reminder to be careful — you add the formatter to pre-commit and reject unformatted code in CI, making the comment *impossible*. Automate the rule, not the reminder.

2. The **noise budget** is the finite tolerance a team has for low-value automated output before it starts ignoring *all* of it. Attention is coarse-grained: when one bot cries wolf enough, humans don't mute just that bot — they start skimming the entire automated-comment channel, so a high-precision tool sharing that channel loses its audience too. The budget is shared and depletable across all automation.

3. (a) **Formatter** (deterministic, zero human, no false positives). (b) **SAST / Semgrep / CodeQL** rule in CI (taint pattern; triage the findings). (c) **Sanitizers + fuzzing** (TSan; deterministic detection a human reading the diff won't reliably make). (d) **The human** — no tool has the system context to judge whether an abstraction fits the architecture, the intent, and the invariants; it's irreducible judgment, which is exactly what pushing everything else down is meant to free up.

4. `filter_mode: added` posts annotations **only on lines the PR changed**, suppressing pre-existing violations. It matters because surfacing the repo's whole historical backlog on a small PR floods the reviewer, burns the noise budget, and gets the tool muted org-wide. Diff-scoping keeps each finding cheap and relevant.

5. **Helps:** PR summarization/orientation; first-pass nit/obvious-bug triage (also: test-gap suggestions, checklist enforcement). **Fails:** no real system context (doesn't know your invariants/incidents); confident-but-wrong on novel logic (and hallucinated issues). The rule: **AI is pre-human triage the author addresses first, never an approver.**

6. **Precision** (fraction of its comments that are real) and **action rate** (fraction that led to a code change). You revoke its comment rights when those fall below threshold — exactly as you'd mute any noisy bot or pull a flaky gate. ("It feels useful" is not a metric.)

7. Last-match-wins: a late broad pattern like `*.md` placed *after* a specific `/services/payments/` line will steal ownership of markdown files in that path, routing docs PRs to the wrong team — order specific-to-general. The silent staleness failure: a **ghost owner** (team that was dissolved/renamed) still listed in CODEOWNERS makes PRs to those paths *unmergeable*, waiting on approval from a team that no longer exists — and it surfaces only when something is blocked.

8. The **medium is now the bottleneck**, not the disagreement — six async round-trips means hours/days of latency on what's really a conversation. Escalate to **sync**: get on a call, resolve it in minutes, then post a summary comment back to the PR for the record.

</details>

---

## Cheat Sheet

```
ORGANIZING PRINCIPLE
  Every human comment a tool COULD have made = a process defect → add the tool.
  Automate the rule, not the reminder. Drive tool-catchable human comments → 0.

AUTOMATION HIERARCHY (cheapest reliable catch point)
  formatting              → formatter (gofmt/Prettier/black)   pre-commit + CI, zero human
  style / simple bugs     → linter (golangci-lint/ESLint/ruff) CI / inline
  type / null / contract  → type checker (tsc/mypy/compiler)   CI
  injection / secrets     → SAST + secret scan (CodeQL/Semgrep/gitleaks)  CI, triage
  memory-safety / races   → sanitizers + fuzzing (ASan/TSan/UBSan)        CI/nightly
  behavior / regressions  → tests                              CI
  design/intent/novel-correctness → THE HUMAN                  review (irreducible)

NOISE BUDGET (shared, depletable across ALL bots)
  curate who may comment      low-precision → dashboard, not inline
  severity-tag (error/warn/info)   reviewers filter
  batch, don't spray          one summary > 40 inline comments
  diff-scope only             reviewdog filter_mode: added
  measure action rate         < threshold → fix or mute the bot

REVIEWDOG / DANGER
  reviewdog → inline lint annotations on the DIFF (new violations only)
  Danger    → policy on PR metadata (schema-without-migration, no-tests, size)

CODEOWNERS (at scale)
  last-match-wins per file    order specific → general
  anchor patterns (/svc/...)  unanchored globs scan everything (slow)
  audit for ghost teams + bus-factor-1   stale owner = silent unmergeable PR
  required-review = the teeth  routes ownership, NOT load (use auto-assign)

AI REVIEW = JUST ANOTHER BOT
  helps:  summary/orientation, nit+obvious-bug triage, test-gap, checklists
  fails:  no system context, hallucinations, confident-wrong on novel logic
  rule:   pre-human triage the AUTHOR fixes first — NEVER an approver
  measure: precision, % actioned, FP rate → revoke comment rights if they drop
  privacy: know where your source code is sent

WORKFLOW / LATENCY
  stacked diffs → small PRs under real feature pressure (Graphite/Gerrit/Sapling)
  merge queue   → re-test against post-merge tree (defends green under concurrency)
  auto-merge-when-green + auto-assign → delete clicks, kill the 2-person bottleneck
  async = default for line-level;  escalate to SYNC at ~3+ round-trips / design dispute
  pair/mob = continuous review, zero feedback latency (highest-novelty changes)

METRICS THE TOOLING MUST EXPOSE
  time-to-first-review · bot-comment action rate · automated-vs-human catch ratio
  round-trips/PR · AI precision + action rate
```

---

## Summary

- Review automation is a **signal-to-noise system**, not a bug-catching pile. Tools spend the human's attention whether or not they're useful, so the metric that matters is each tool's effect on the PR's S/N as the human experiences it — a low-precision tool can be worse than no tool.
- The **automation hierarchy** assigns each defect class to its cheapest reliable catch point: formatting→formatter, patterns→linter/SAST, memory-safety→sanitizers, behavior→tests, and judgment→human. Every human comment a tool could have made is a **process defect**; the fix is the tool, not a reminder.
- The **noise budget is shared and depletable**: one low-precision bot trains humans to ignore the whole automated channel. Protect it by curating comment rights, severity-tagging, batching, diff-scoping (reviewdog), and cutting bots whose action rate is too low.
- **CODEOWNERS** is ownership-as-code with real semantics (last-match-wins), real scale costs, and real rot — audit it for ghost teams and bus-factor-one or it will silently block merges.
- **AI review is just another bot**: measure its precision and action rate, place it as pre-human triage the author fixes first, never let it approve, and know where your code is sent. "The AI said it's fine" is the deskilling failure.
- **Workflow tooling** (stacks, merge queues, auto-merge, auto-assignment) and the **async/sync** decision are latency optimizations that remove mechanical steps and round-trips. The end state: the human opens a PR that's already formatted, linted, tested, green, AI-triaged, and routed — so their scarce judgment lands entirely on design, intent, and novel correctness.

You now reason about review tooling as a system that protects a single scarce resource — human judgment — by catching everything else at its cheapest point without drowning anyone in the catching. The next layer — [professional.md](professional.md) — is about rolling this out across an organization: migrating a legacy codebase onto the hierarchy, building the precision-feedback loop that keeps tools trusted, and governing AI review as policy.

---

## Further Reading

- [Google Engineering Practices — *Code Review Developer Guide*](https://google.github.io/eng-practices/review/) — the canonical statement that reviewers shouldn't nit on what tooling owns, and how to keep review focused on judgment.
- *Lessons from Building Static Analysis Tools at Google* (Sadowski et al., CACM) — the empirical case that **false-positive rate, not cleverness, decides whether a tool is trusted**, and the feedback-gated platform (Tricorder) built around it. The intellectual foundation of the noise-budget idea.
- [reviewdog documentation](https://github.com/reviewdog/reviewdog) — diff-scoped inline annotations from arbitrary linter output; the canonical low-noise delivery pattern.
- [Danger documentation](https://danger.systems/) — encoding review *policy* (the human checklist) as automated, consistent PR checks.
- A rigorous, data-backed evaluation of an AI code reviewer (precision / action-rate / false-positive analysis) — read at least one that reports *numbers*, not vibes, and apply its methodology to any tool you adopt.
- [GitHub CODEOWNERS reference](https://docs.github.com/en/repositories/managing-your-repos-settings-and-features/customizing-your-repository/about-code-owners) and your platform's merge-queue / required-review docs — the precise semantics (last-match-wins) and the gate integration.
- Pointer onward: [professional.md](professional.md) — operating this system across an organization, under real migration and governance pressure.

---

## Related Topics

- [01 — What to Look For & In What Order](../01-what-to-look-for-and-order/senior.md) — the *human* half of the hierarchy: what's left for judgment once tooling clears the mechanical layers.
- [07 — Review Metrics & Tempo](../07-review-metrics-and-tempo/senior.md) — time-to-first-review, bot action rate, and the automated-vs-human catch ratio that tell you whether the automation is working.
- [Static Analysis & Linting](../../static-analysis/) — the linter/type/SAST layers of the hierarchy in depth, and how to tune them for precision.
- [Quality Gates](../../quality-gates/) — merge queues, required checks, and the flaky-gate failure that the noise budget mirrors exactly.
- [Dynamic Analysis & Sanitizers](../../dynamic-analysis-and-sanitizers/) — why memory-safety, UB, and races belong to sanitizers and fuzzing, not to a human reading the diff.
