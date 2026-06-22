# Branch Protection & Merge Policies — Middle Level

> **Roadmap:** [Quality Gates](../README.md) → Branch Protection & Merge Policies
> *The junior page asked "can this branch be pushed to directly?" This page asks the harder question: what is the complete rule set, what does each rule actually enforce, and why does a repo where every PR is green still produce a broken `main`?*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Full Rule Set and Each Rule's Failure Mode](#core-concept-1--the-full-rule-set-and-each-rules-failure-mode)
5. [Core Concept 2 — Merge Strategies and What They Cost You Later](#core-concept-2--merge-strategies-and-what-they-cost-you-later)
6. [Core Concept 3 — CODEOWNERS as a Required Reviewer](#core-concept-3--codeowners-as-a-required-reviewer)
7. [Core Concept 4 — Merge Queues and the Semantic Conflict](#core-concept-4--merge-queues-and-the-semantic-conflict)
8. [Core Concept 5 — Rulesets vs Classic Branch Protection](#core-concept-5--rulesets-vs-classic-branch-protection)
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

> Focus: **What is the full policy surface of a protected branch, and how do these rules interact to keep `main` releasable?**

At the junior level, branch protection is one switch: "you can't push straight to `main`; open a PR." That switch is real, but it's the front door of a building with a dozen rooms. Each protection rule is an independent toggle with its own enforcement mechanism and its own *specific failure mode* — the bad thing that happens when you leave it off.

This page does three things. First, it walks the **complete rule set** and names what each rule actually prevents. Second, it makes the **merge-strategy decision** concrete, because that single dropdown silently determines whether `git bisect`, `git revert`, and "is this commit on `main`?" behave the way your team assumes. Third, it introduces the rule that distinguishes a hobby repo from a high-throughput one: the **merge queue**, the only mechanism that catches the *semantic merge conflict* — two PRs that are each green against `main` and broken the moment they coexist.

By the end you should be able to read a real branch-protection config the way the junior page taught you to read CI output: not as a wall of checkboxes, but as a set of deliberate "this failure is now impossible" claims.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can explain why a protected branch forces changes through PRs.
- **Required:** You understand required status checks and the "branch must be up to date" rule from [01 — Required CI Checks](../01-required-ci-checks/middle.md).
- **Helpful:** You've merged a PR via squash, merge-commit, *and* rebase at least once and noticed the history looked different each time.
- **Helpful:** You've used `git bisect`, `git revert`, or `git blame` in anger on a shared branch.

---

## Glossary

- **Branch protection rule** — a per-branch policy on a repository that constrains how commits reach that branch (who can push, what must pass, what history shape is allowed).
- **Ruleset** — GitHub's newer, layerable replacement for classic branch protection; defined at repo *or org* level, with named bypass lists and a dry-run mode.
- **Required status check** — a CI job whose success is a precondition for merge (covered in topic 01); branch protection decides *which* checks are required and whether the branch must be current.
- **CODEOWNERS** — a file mapping path patterns to owning users/teams; combined with branch protection, it makes the owner a *required* reviewer for changes to their paths.
- **Merge strategy** — how the PR's commits are integrated: merge commit, squash, or rebase. Determines the resulting history shape and commit SHAs.
- **Linear history** — a branch with no merge commits; every commit has exactly one parent. Enforced by requiring squash or rebase merges.
- **Merge queue** — a system that serializes merges, re-testing each PR against the *projected* latest `main` before it lands, to catch conflicts that pairwise testing misses.
- **Semantic merge conflict** — two changes that merge cleanly at the *text* level (no `git` conflict markers) but are logically incompatible, breaking the build or tests once combined.
- **Break-glass / bypass** — a deliberate, audited path to merge while skipping protections, for emergencies (covered in [07 — Break-glass & Bypass](../07-break-glass-and-bypass/middle.md)).

---

## Core Concept 1 — The Full Rule Set and Each Rule's Failure Mode

Branch protection is not one feature; it's a checklist of independent guarantees. The useful way to learn it is to pair each rule with the *exact failure it makes impossible*. Here is the complete set.

| Rule | What it enforces | Failure mode it prevents |
|---|---|---|
| **Require a pull request** | No direct pushes; changes arrive via PR | Unreviewed commit lands silently on `main` |
| **Required approvals (N)** | At least N reviewers approve | One person ships to a shared branch alone |
| **Require review from Code Owners** | The owner of each touched path must approve | A stranger edits the auth module unnoticed |
| **Dismiss stale approvals on push** | New commits void prior approvals | "Approved" PR that was rewritten after review |
| **Require status checks** | Listed CI jobs pass (topic 01) | Merging known-red code |
| **Require branches up to date** | PR must be rebased onto latest `main` | The "green against stale base" gap (topic 01) |
| **Require conversation resolution** | All review threads resolved | Merging over an unanswered "this is a bug" |
| **Require linear history** | No merge commits allowed | Tangled topology that breaks `bisect`/revert |
| **Require signed commits** | Commits carry a verified GPG/SSH/sigstore signature | Unattributable or spoofed authorship |
| **Restrict who can push** | Only listed users/teams/apps may merge | Anyone with write access merges to a release branch |
| **Block force-push** | `--force` to the branch is rejected | History rewrite that loses or hides commits |
| **Block deletion** | The branch cannot be deleted | Someone deletes `main` |
| **Require deployments to succeed** | A successful deploy to env(s) gates merge | Merging before the staging deploy is verified |
| **Lock branch** | Branch is read-only entirely | Accidental writes to an archived/release branch |
| **Do not allow bypassing** | Even admins obey the rules | A privileged user silently skips every gate |

Three of these reward extra attention because teams routinely misconfigure them.

**Dismiss stale approvals on push.** Without it, the sequence is: reviewer approves at commit `A`, author pushes commit `B` (which could be anything), the PR still shows "approved," and it merges. The approval was for code that no longer exists. With the rule on, pushing `B` re-arms the gate. The cost is friction on trivial follow-up commits; the benefit is that "approved" always means "approved as-merged."

**Require signed commits.** This binds each commit to a verified identity (GPG, SSH signing, or keyless sigstore/gitsign). The failure it prevents is *authorship spoofing*: `git` lets anyone set `user.name`/`user.email` to anything, so an unsigned commit's "author" is just a string. Signing turns it into a cryptographic claim. The operational cost is real — every contributor and every bot must have signing configured, or their commits are rejected — so most teams adopt it for high-trust repos rather than universally.

**Do not allow bypassing (the include-administrators decision).** Classic branch protection historically *exempted* admins by default; you had to explicitly opt admins into the rules. The modern, correct default is the opposite: rules apply to everyone, and any exception is an explicit, named entry on a bypass list. Admin bypass is not a convenience — it is a **break-glass path**, and it should be treated like one: rare, audited, and reviewed after the fact (see [07 — Break-glass & Bypass](../07-break-glass-and-bypass/middle.md)).

> **Key insight:** Read each protection rule as a sentence of the form "without this rule, *this specific bad merge* is possible." If you can't name the failure a rule prevents, you can't reason about whether it's safe to turn off — and "turn it off to unblock a deploy" is exactly the moment you need that reasoning.

---

## Core Concept 2 — Merge Strategies and What They Cost You Later

GitHub, GitLab, and friends offer three ways to integrate a PR. The dropdown looks cosmetic. It is not — it decides the *identity and topology* of the commits on your default branch, which in turn decides how three everyday tools behave.

```text
Feature branch:  A───B───C   (3 commits)
main:            M

MERGE COMMIT
  main: M─────────────────X   (X has two parents: M and C)
                 ╲       ╱
                  A─B─C            ← A, B, C kept, with their original SHAs

SQUASH
  main: M───S                      ← S is ONE new commit = A+B+C combined
                                     A, B, C never appear on main (new SHA)

REBASE
  main: M─A'─B'─C'                  ← commits replayed onto M as A', B', C'
                                     linear, but A',B',C' are NEW SHAs ≠ A,B,C
```

| | Merge commit | Squash | Rebase |
|---|---|---|---|
| History shape | Branching (true topology) | Linear | Linear |
| Commits on `main` | All PR commits + a merge node | One per PR | All PR commits (rewritten) |
| Intra-PR history | Preserved | **Lost** | Preserved |
| SHAs of branch commits | **Unchanged** (the real merge base) | New SHA | **New SHAs** |
| `git bisect` granularity | Per original commit | Per whole PR | Per original commit |
| `git revert` of a PR | Revert the merge commit | Revert one commit (clean) | Revert each commit |
| "Is commit X on `main`?" | Yes, same SHA | No — its content is in `S` | No — it's `X'`, not `X` |

The consequences are concrete:

- **`git bisect`** narrows a regression by binary-searching commits. With squash, your finest resolution is "this 600-line PR introduced it" — fast to merge, slow to debug. With merge-commit or rebase, bisect can land on the one 12-line commit at fault. Teams that squash everything trade a tidy log for coarser bisects.
- **`git revert`** is cleanest under squash: one PR is one commit, so backing it out is `git revert <sha>`. Reverting a merge commit requires `-m 1` and is fiddlier; reverting a rebased PR means reverting a *range*.
- **`git blame`** under squash attributes every line of a PR to the single squash commit and its message — you lose the "this specific line came from this specific fix" trail. Under merge/rebase, blame points at the real authoring commit.
- **"Is this commit on `main`?"** trips up release tooling. Squash and rebase both *rewrite SHAs*, so the commit on your feature branch is **not** the commit on `main` — only its content survived. Automation that checks "did SHA `abc123` ship?" will answer "no" even though the change is live. This is the single most common merge-strategy surprise.

Most repos *enforce one strategy* by disabling the others, so history stays consistent and "require linear history" can be satisfied (squash and rebase both produce linear history; merge commits do not).

> **Key insight:** There is no universally correct strategy — there's the strategy whose downstream cost your team can pay. Pick squash if PRs are small and you value a clean log; pick merge/rebase if you bisect and blame at the commit level. What you must *not* do is choose by aesthetics and then act surprised when revert or bisect behaves the way the strategy guaranteed it would.

---

## Core Concept 3 — CODEOWNERS as a Required Reviewer

A `CODEOWNERS` file maps **path patterns to owners**. On its own it only *auto-requests* review from those owners when a PR touches their paths. Wired into branch protection via **"Require review from Code Owners,"** it becomes an enforcement mechanism: a PR touching `services/payments/**` cannot merge until a payments owner approves, no matter how many other approvals it has.

```text
# .github/CODEOWNERS  (committed in the repo; the branch's version is authoritative)

# Syntax:  <path-pattern>   <owner> [<owner> ...]
# Owners are @users or @org/teams. LAST matching pattern wins.

*                       @org/maintainers            # default owner for everything

/docs/                  @org/tech-writers
*.md                    @org/tech-writers

/services/payments/     @org/payments  @alice        # team OR individual can satisfy
/services/auth/         @org/security
/infra/**/*.tf          @org/platform  @org/security # both teams auto-requested

# A more specific later rule overrides an earlier broad one:
/services/payments/docs/  @org/tech-writers          # docs in payments → writers, not payments
```

Two rules govern its behavior, and both bite in practice:

1. **Last match wins.** Patterns are evaluated top to bottom; the *last* one that matches a file determines its owners. This is the reverse of `.gitignore`-style intuition for some, and it means ordering is load-bearing. Put broad defaults at the top and specific overrides below.
2. **Owners must have write access** and the path must match exactly how the tool globs (a trailing `/` matches a directory's contents; `**` spans directories). A pattern that matches *nothing*, or names a team without repo access, silently fails to gate — you get no error, just no protection.

The hard part of CODEOWNERS is not syntax; it's **maintenance**. Owners leave the team, get reorged, or go on leave, and a stale entry means a PR is blocked on someone who can't approve it — or, worse, "owned" by a team that no longer cares. At monorepo scale (thousands of paths, hundreds of teams), CODEOWNERS becomes a living document that needs the same review discipline as code: a CI check that every pattern matches at least one path and every owner still exists is a common safeguard.

> **Key insight:** CODEOWNERS is access control expressed as a file, so it rots exactly like access control does. The file is only as trustworthy as your process for pruning departed owners — an unmaintained CODEOWNERS doesn't just fail to protect, it actively blocks PRs on people who left months ago.

---

## Core Concept 4 — Merge Queues and the Semantic Conflict

This is the concept that separates teams that *understand* merge policy from teams that merely configure it.

Recall from topic 01 the "require branches up to date" rule: a PR must be rebased onto the latest `main` before merging, so it's tested against current reality. That rule closes one gap but reveals a deeper one. Consider two PRs, each rebased and green:

```text
main has:    def total(items):  return sum(i.price for i in items)

PR #1:  renames the function
        def grand_total(items): return sum(i.price for i in items)
        (updates all 4 current call sites)   → green against main ✓

PR #2:  adds a new call site
        receipt = total(cart)                → green against main ✓
        (written before #1 merged; #1's rename isn't on its base yet)
```

Each PR passes CI in isolation. There is **no text conflict** — they touch different lines, so `git` merges them cleanly with no markers. But the instant both land, `main` calls `total()`, which no longer exists. This is a **semantic merge conflict**: clean at the text level, broken at the logic level. "Require up to date" can't catch it, because at the moment each PR ran CI, the *other* PR wasn't on `main` yet.

A **merge queue** fixes this by *serializing* merges and testing each candidate against the **projected** future `main`:

```text
Queue:  [ PR #1 ] [ PR #2 ]

1. Pop #1. Test #1 on top of main.                    → green → merge #1.
2. Pop #2. Test #2 on top of (main + #1).             → RED  (total() is gone)
           → #2 is kicked back to its author; main stays green.
```

The queue never lets an untested combination reach `main`. The naive alternative — "just require up to date" — forces every author to *manually* rebase and re-run CI whenever anyone else merges, which is **O(N) re-pushes** for N concurrent PRs: each merge invalidates everyone else's "up to date" status, triggering a thundering herd of rebases and CI runs. At a few PRs a day that's tolerable; at fifty merges an hour it's a full-time traffic jam. The queue replaces that human coordination with a machine that tests the real merge order exactly once per PR.

To regain throughput, queues **batch and speculate**:

- **Batching:** test PRs #1, #2, #3 *together* on top of `main` in one CI run. If green, merge all three — one CI run instead of three.
- **Optimistic / speculative execution:** start testing batch `[#2, #3]` on top of *projected* `main+#1` *before* #1's own tests finish, betting #1 passes. If the bet holds, the pipeline is already done; if #1 fails, the speculative work is discarded.
- **Bisecting a failed batch:** if batch `[#1, #2, #3]` goes red, the queue doesn't know which PR is the culprit, so it **bisects** — splits the batch (`[#1]`, then `[#2, #3]`) and re-tests to isolate the bad PR, ejecting only that one and letting the innocents through.

```yaml
# .github/workflows/merge-queue.yml — a job that runs for queued PRs.
# The trigger event is what makes this a merge-queue check, not a PR check:
on:
  merge_group:            # fires when GitHub forms a queue group to test
    types: [checks_requested]

jobs:
  required-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: ./run-tests.sh   # runs against the queue's projected-main merge ref
```

```text
# Conceptual queue config (vendor-agnostic — GitHub merge queue, Mergify, Bors all share this shape):
merge_queue:
  required_checks: [build, unit, integration]   # must pass on the GROUP, not just the PR
  batch_size: 5            # test up to 5 PRs together
  batch_wait: 5m           # or flush the batch after 5 minutes
  on_batch_failure: bisect # split-and-retest to find the offender
```

The major implementations are **GitHub merge queue** (native, configured per protected branch/ruleset), **Mergify** (rules-engine queues with rich conditions), and **Bors** (the original "not rocket science" rule: never merge to `main` until the result is tested — born in the Rust project). They differ in ergonomics; they agree on the core invariant.

> **Key insight:** "Every PR is green" and "`main` is green" are *different claims*, and the gap between them is the semantic conflict. Pairwise green doesn't compose. A merge queue is the only branch policy that tests the actual merge *order* rather than each PR against a `main` that no longer exists by the time it lands.

---

## Core Concept 5 — Rulesets vs Classic Branch Protection

GitHub now offers two systems for the same job. Knowing the difference matters because they behave differently when they overlap.

**Classic branch protection** is one rule per branch pattern, per repo, configured in repo settings. It works, but it has limits: rules don't *layer* (the most specific pattern wins, full stop), admin handling is awkward, there's no org-wide application, and no way to preview a rule before it bites.

**Rulesets** are the modern model, and they fix exactly those gaps:

- **Layering, not overriding.** Multiple rulesets can target the same branch; their requirements are *unioned*. An org-level "require signed commits" ruleset and a repo-level "require 2 approvals" ruleset both apply. The effective policy is the sum.
- **Org-level rulesets.** Define a policy once at the organization and apply it across many repos — "every repo's `main` requires a passing `build` check and blocks force-push" — instead of configuring each repo by hand.
- **Named bypass lists.** Instead of the binary "admins are/aren't exempt," a ruleset has an explicit `bypass_actors` list: these specific teams, roles, or apps may bypass, and that's an auditable record (the break-glass path of [07 — Break-glass & Bypass](../07-break-glass-and-bypass/middle.md)).
- **Evaluate ("dry run") mode.** A ruleset can be set to **Evaluate** — it logs what it *would* have blocked without actually blocking anything. You roll out a strict policy in evaluate mode, watch the insights for a week to see who it would have stopped and why, then flip it to **Active**. This turns a risky org-wide policy change into a measured one.

```yaml
# A GitHub ruleset, expressed as its API/JSON shape (paraphrased for readability).
name: protect-main
target: branch
enforcement: active          # active | evaluate (dry-run) | disabled
conditions:
  ref_name:
    include: ["refs/heads/main"]
rules:
  - type: pull_request
    parameters:
      required_approving_review_count: 2
      dismiss_stale_reviews_on_push: true
      require_code_owner_review: true
      required_review_thread_resolution: true
  - type: required_status_checks
    parameters:
      strict_required_status_checks_policy: true   # = "require branches up to date"
      required_status_checks:
        - { context: "build" }
        - { context: "unit-tests" }
  - type: required_linear_history
  - type: non_fast_forward        # blocks force-push
  - type: deletion                # blocks branch deletion
bypass_actors:
  - { actor_type: Team, actor_id: 42, bypass_mode: pull_request }  # explicit, audited
```

**Release branches deserve a stricter, different policy than `main`.** A common split: `main` requires 1–2 approvals and the standard checks; `release/*` adds *restrict who can push* (only the release team), *require signed commits*, and possibly *lock branch* once the release is cut so only cherry-picked hotfixes — themselves PR-gated — can land. Rulesets make this trivially expressible because the `release/*` ruleset *layers on top of* the `main`-style baseline rather than replacing it.

Two policy ideas cut across both systems:

- **Separation of duties** — "the author of a change may not be its sole approver." Required approvals (N ≥ 1 from someone *other* than the author) is the mechanism; for regulated environments it's a hard control, often paired with CODEOWNERS so the approver is also a domain owner. See [04 — Deploy Approvals & Sign-offs](../04-deploy-approvals-and-signoffs/middle.md) for the deploy-time analogue.
- **Auto-merge** — "merge automatically once all required gates pass." The author enables it; the PR sits until checks go green and approvals land, then merges with no human in the loop. It pairs naturally with a merge queue: enable auto-merge, the PR joins the queue when ready, and lands when the queue says it's safe.

> **Key insight:** Classic protection is a flat per-repo switchboard; rulesets are a *composable, org-aware policy layer with a dry-run*. The dry-run alone is the upgrade — it lets you measure a strict policy's blast radius before you inflict it on every engineer, which is the difference between a rollout and an incident.

---

## Real-World Examples

**1. The Friday-evening semantic conflict.** Two engineers, two clean PRs. One renamed `chargeCard` to `capturePayment` and updated all call sites; the other added a new `chargeCard` call in a feature written that morning. Both green, both rebased, both merged within ten minutes. `main` went red — the new call site referenced a function that no longer existed. No `git` conflict was ever shown. The fix wasn't "be more careful"; it was enabling the merge queue, which tested PR #2 against `main+#1` and bounced it before it could land.

**2. The squash that broke the release dashboard.** A team squash-merged everything (clean log, they were proud of it). Their release tool tagged builds by commit SHA and reported "is SHA `abc123` in production?" After a squash merge, the feature-branch SHA `abc123` was *never* on `main` — only its squashed content was. The dashboard reported the fix as un-shipped for a week while it was demonstrably live. The resolution was to query by PR number, not SHA — because the chosen merge strategy *guaranteed* the SHA wouldn't survive.

**3. The CODEOWNERS that blocked the org.** A reorg dissolved `@org/data-eng`. Nobody updated CODEOWNERS, where that team owned `/pipelines/**`. Every PR touching pipelines auto-requested a non-existent team and, under "require code owner review," became unmergeable — review-blocked on a team that didn't exist. A 30-second CODEOWNERS edit unblocked a dozen PRs. The team added a CI check that fails if any CODEOWNERS owner can't be resolved.

**4. The admin who bypassed the gate "just this once."** During an incident, an admin used their bypass to merge a hotfix straight to `main`, skipping checks. The hotfix had a typo; `main` went red for everyone. The bypass worked exactly as designed — it's a break-glass path — but the team had no review-after-the-fact step, so the lesson stuck only because it hurt. They moved admin bypass to a named ruleset bypass list with required post-incident review (see [07 — Break-glass & Bypass](../07-break-glass-and-bypass/middle.md)).

---

## Mental Models

- **A protection rule is a "this failure is now impossible" claim.** The rule set is a list of impossibilities you've purchased. Turning a rule off un-purchases one specific impossibility — so always ask "which bad merge does this re-enable?" before flipping it.

- **The merge-strategy dropdown is a time machine setting.** It doesn't change today's merge; it changes how `bisect`, `revert`, `blame`, and "did this ship?" behave *next month*. You're choosing the shape of your future debugging, not the look of today's log.

- **"Every PR green" is a per-element property; "`main` green" is a property of the whole.** They don't compose for free. The merge queue is the machine that enforces the whole-set property by testing the actual merge order.

- **CODEOWNERS is access control that lives in `git`.** Like all access control, its danger isn't the grants you make — it's the grants you forget to revoke. A stale owner is an outage waiting for the next PR to that path.

- **Rulesets are policy as layered configuration; classic protection is policy as a single switch.** Layering plus dry-run means you can *compose* and *measure* policy instead of just toggling it.

---

## Common Mistakes

1. **Leaving "dismiss stale approvals" off.** The PR gets approved, then rewritten, then merged on a now-meaningless approval. If "approved" doesn't mean "approved as it will merge," the review gate is theater.

2. **Choosing a merge strategy by taste, then being surprised by revert/bisect.** Squash gives a clean log and coarse bisects plus SHA rewrites; merge/rebase give fine bisects and a busier log. Both are fine — picking one and expecting the *other's* behavior is the mistake.

3. **Believing "require up to date" prevents broken `main`.** It only tests each PR against the `main` that existed when CI ran. Two clean-but-incompatible PRs still break `main`. That's what merge queues exist for.

4. **Getting CODEOWNERS pattern order backwards.** Last match wins. A broad rule placed *after* a specific one silently overrides it. And a pattern that matches nothing, or names a team without write access, protects nothing — with no error to tell you.

5. **Exempting administrators by habit.** Admin bypass should be a named, audited break-glass path, not a standing convenience. "The rules apply to everyone, exceptions are explicit and logged" is the safe default ([07 — Break-glass & Bypass](../07-break-glass-and-bypass/middle.md)).

6. **Applying one policy to `main` and release branches alike.** Release branches need stricter rules — restricted pushers, signed commits, often a lock. Rulesets let you layer the stricter policy on `release/*` instead of duplicating config.

7. **Rolling out a strict org policy with no dry-run.** Flipping "require signed commits" org-wide overnight blocks every bot and unconfigured contributor at once. Ship it in **evaluate** mode first, read the insights, *then* enforce.

---

## Test Yourself

1. Name three branch-protection rules and the *specific* bad merge each one prevents.
2. Your team squash-merges everything. A teammate asks `git bisect` to find which commit caused a regression and is frustrated by the resolution. What's going on, and what's the trade-off they accepted?
3. Two PRs are each green and each rebased onto the latest `main`. They touch different files, so there's no text conflict. Why might `main` still break when both merge, and what mechanism prevents it?
4. In CODEOWNERS, which matching pattern wins when several match the same file, and what's a common silent failure of the file?
5. What does a merge queue do when a *batch* of PRs fails as a group, and why doesn't it just reject the whole batch?
6. What does a ruleset's "evaluate" mode do, and why would you use it before enforcing a new org-wide policy?

<details>
<summary>Answers</summary>

1. Examples: **Require a pull request** prevents an unreviewed commit landing directly on `main`. **Dismiss stale approvals on push** prevents merging on an approval given for code that was later rewritten. **Block force-push** prevents a history rewrite that loses or hides commits. (Any rule from the Core Concept 1 table, paired with its named failure mode, is correct.)

2. Squash collapses each PR into one commit, so `git bisect` can only narrow the regression to "this whole PR," not the individual 10-line commit inside it. They accepted coarser bisect resolution (and SHA rewrites) in exchange for a clean, one-commit-per-PR log.

3. A **semantic merge conflict**: e.g., PR #1 renames a function and PR #2 adds a call to the old name. Each was green against the `main` that existed during its CI run, where the other PR's change wasn't yet present. They merge cleanly textually but break logically. A **merge queue** prevents it by testing each PR against the *projected* `main` (including already-queued PRs) before merging.

4. The **last** matching pattern wins (patterns are read top to bottom; specificity is by position, not pattern length). Common silent failures: a pattern that matches no files, or an owner/team that lacks write access — both produce *no* gate and *no* error.

5. It **bisects** the batch — splits it and re-tests the halves to isolate the single offending PR, then ejects only that one and merges the rest. Rejecting the whole batch would punish the innocent PRs and waste their passing CI; bisecting preserves throughput.

6. **Evaluate** (dry-run) mode logs what the ruleset *would* have blocked without actually blocking anything. You use it to measure a strict policy's blast radius — who it would stop and why — before flipping it to **active**, turning a risky org-wide change into a measured rollout.

</details>

---

## Cheat Sheet

```text
THE RULE SET (each = "this bad merge is now impossible")
  require PR ................. no direct push
  required approvals (N) .... not shipped solo
  code-owner review ......... path owner must approve
  dismiss stale on push ..... approval voided when rewritten
  required checks ........... no merging red  (topic 01)
  branches up to date ....... tested vs current main  (topic 01)
  conversation resolution ... no merging over open threads
  linear history ............ no merge commits (needs squash/rebase)
  signed commits ............ verified authorship (GPG/SSH/sigstore)
  restrict push ............. only listed actors merge
  block force-push/delete ... history can't be rewritten/erased
  require deployments ....... env deploy must succeed first
  lock branch ............... read-only
  do-not-bypass ............. admins obey too (bypass = break-glass, topic 07)

MERGE STRATEGY → DOWNSTREAM COST
  merge commit  topology kept | fine bisect | revert -m1   | SHA survives
  squash        linear, clean | COARSE bisect| revert clean | SHA REWRITTEN
  rebase        linear        | fine bisect  | revert range | SHA REWRITTEN
  "is SHA X on main?"  → squash/rebase answer NO (content survived, SHA didn't)

CODEOWNERS
  pattern  owner...   |  LAST match wins  |  owner needs write access
  silent fail: pattern matches nothing, or owner/team doesn't exist → no gate

MERGE QUEUE (catches the SEMANTIC conflict)
  serialize → test each PR vs PROJECTED main (main + already-queued)
  batch to regain throughput | bisect a failed batch to eject one PR
  tools: GitHub merge queue · Mergify · Bors

RULESETS > CLASSIC
  layer (union, not override) | org-level | named bypass list | EVALUATE dry-run
  release/* = stricter ruleset LAYERED on the main baseline
```

---

## Summary

- Branch protection is a **checklist of independent guarantees**, each one making a *specific* bad merge impossible. Learn the rule set by pairing every rule with the failure it prevents; if you can't name the failure, you can't safely turn the rule off.
- **Merge strategy** is not cosmetic. Merge-commit preserves topology and SHAs; squash gives a clean log but coarse bisects and rewritten SHAs; rebase gives linear history with rewritten SHAs. The choice silently decides how `bisect`, `revert`, `blame`, and "did this ship?" behave later.
- **CODEOWNERS** turns path ownership into a required-reviewer gate (last match wins, owners need access) — and rots exactly like access control, blocking PRs on people who've left if you don't prune it.
- The **merge queue** is the headline modern policy: it catches the **semantic merge conflict** (two clean-but-incompatible PRs) that "require up to date" structurally cannot, by serializing merges and testing each PR against the *projected* `main`. Batching and batch-bisection restore throughput.
- **Rulesets** beat classic protection by *layering* (org + repo policies union), supporting org-wide application, named bypass lists, and an **evaluate** dry-run that measures a policy's blast radius before enforcing it. Protect release branches with a stricter ruleset layered on the `main` baseline.

---

## Further Reading

- *GitHub Docs — About protected branches* — the canonical list of classic branch-protection rules and their exact semantics.
- *GitHub Docs — About rulesets* — layering, org-level rulesets, bypass lists, and evaluate mode.
- *GitHub Docs — Managing a merge queue* — how GitHub's native queue batches, tests the merge group, and ejects failures.
- *GitHub Docs — About code owners* — CODEOWNERS syntax, the last-match-wins rule, and required-owner review.
- *GitLab Docs — Merge request approvals & approval rules* — the GitLab analogue: approval rules, code owners, and protected branches.
- *Mergify documentation — Merge queue* and *The Bors / "Not Rocket Science Rule"* writeups — two takes on serialized, always-tested merges.
- [senior.md](senior.md) — merge-queue throughput math at scale, policy-as-code enforcement, multi-repo/org governance, and treating branch policy as an auditable control.

---

## Related Topics

- [01 — Required CI Checks](../01-required-ci-checks/middle.md) — required status checks and the "up to date" rule that branch protection builds on.
- [04 — Deploy Approvals & Sign-offs](../04-deploy-approvals-and-signoffs/middle.md) — separation of duties and approvals applied at deploy time, not just merge time.
- [07 — Break-glass & Bypass](../07-break-glass-and-bypass/middle.md) — admin bypass and the audited emergency path through these protections.
- [Code Review](../../code-review/) — what the required approvals and CODEOWNERS gates are actually gating on: review quality.
- [Release Engineering](../../release-engineering/) — protecting release branches differently and how merge policy feeds the release process.
