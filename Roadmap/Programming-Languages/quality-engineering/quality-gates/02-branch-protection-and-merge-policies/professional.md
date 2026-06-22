# Branch Protection & Merge Policies — Professional Level

> **Roadmap:** [Quality Gates](../README.md) → Branch Protection & Merge Policies
> *The senior page taught you which checkboxes to tick on one repo. This page is about ticking them — provably, identically, and auditably — across four hundred repos owned by sixty teams, where a single unprotected branch is a SOC2 finding, an over-zealous CODEOWNERS rule blocks a release, and the answer to "who can force-push main?" had better be a query against Terraform state, not a shrug.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Platform Baseline as Code](#core-concept-1--the-platform-baseline-as-code)
5. [Core Concept 2 — Drift, Silent Weakening, and the Audit Trail](#core-concept-2--drift-silent-weakening-and-the-audit-trail)
6. [Core Concept 3 — The Merge Queue Adoption Decision](#core-concept-3--the-merge-queue-adoption-decision)
7. [Core Concept 4 — History-Model Policy Across the Org](#core-concept-4--history-model-policy-across-the-org)
8. [Core Concept 5 — CODEOWNERS Governance and Review Fatigue](#core-concept-5--codeowners-governance-and-review-fatigue)
9. [Core Concept 6 — Compliance, Separation of Duties, and the Bypass Surface](#core-concept-6--compliance-separation-of-duties-and-the-bypass-surface)
10. [War Stories](#war-stories)
11. [Decision Frameworks](#decision-frameworks)
12. [Mental Models](#mental-models)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Governing branch protection and merge policy as a fleet-wide control, where each setting is a security, compliance, and developer-flow concern simultaneously.**

The senior page framed protections as per-repo configuration: require a review, require CI to pass, restrict who pushes. At the professional level those same settings show up in different meetings. An auditor asks "demonstrate that no engineer can merge their own code without independent review — across every repo that touches the cardholder environment." A platform team is paged because `main` broke three times this week from PRs that were *both green at merge time*. A release manager is blocked because one team's CODEOWNERS entry made them the required approver on forty unrelated PRs, and two of them are on PTO. A staff engineer is asked to explain why the company standardized on squash merges and whether that's why the last backport was a four-hour reconstruction.

None of these are new *mechanics* — they're the senior-tier settings, now multiplied by a fleet, a regulator, and a developer population that will route around any control that costs them more than it's worth. The skill here is judgment under those constraints: knowing that protections-as-code is the only defense against silent weakening, that a merge queue is a real cost you pay only when broken-main frequency justifies it, that the *consistency* of your history model matters more than which model you picked, and that every bypass you allow is a surface an auditor — or an attacker — will eventually find. This is the pragmatic, battle-tested layer.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — required status checks, required reviews, CODEOWNERS basics, linear-history vs merge-commit, the mechanics of GitHub branch protection and rulesets.
- **Required:** You've operated a repo (or a fleet) where a broken `main` blocked other people, not just you.
- **Helpful:** You've owned an org's GitHub/GitLab configuration, written Terraform, or sat through a SOC2 / ISO 27001 / SLSA audit.
- **Helpful:** You've been the person a release was blocked on because of a review or merge-policy rule.

---

## Glossary

- **Ruleset** — GitHub's successor to classic branch protection: a named, org- or repo-level policy that targets branches/tags by pattern, composes rules (required checks, required reviews, signed commits, linear history…), and supports layering and bypass lists. The unit you manage as code.
- **Platform baseline** — the minimum set of protections every repo gets by default, owned centrally and applied as code, on top of which teams may add but not subtract.
- **Drift** — the gap between the protections declared in code and the protections actually live on the platform, usually caused by a manual click in the UI.
- **Merge queue** — a serializing mechanism that tests each PR against the *result of the PRs ahead of it* before merging, eliminating the "two green PRs that conflict semantically" class of broken-main.
- **Speculative execution (merge queue)** — testing several queued PRs in parallel as optimistic batches to keep latency low at high volume, at the cost of extra CI for batches that get invalidated.
- **CODEOWNERS** — a file mapping path globs to owning teams/users; combined with "require review from Code Owners," it turns ownership into a gating control.
- **Separation of duties (SoD)** — the compliance principle that the person who authors a change cannot be the sole person who approves/merges it (author ≠ approver).
- **Include administrators / enforce admins** — the setting that determines whether org/repo admins are also subject to the protections, or can bypass them. The break-glass surface.
- **Verified history** — commits cryptographically signed (GPG/SSH/Sigstore) and shown as `Verified`, used as tamper-evidence and provenance.

---

## Core Concept 1 — The Platform Baseline as Code

At one repo, branch protection is a settings page. At four hundred repos, a settings page is a liability: nobody can answer "are they all configured correctly?", every new repo starts unprotected, and any setting can be silently changed by anyone with admin. The professional model is **protections-as-code with a centrally-owned baseline**, applied identically to every repo by machinery rather than by humans clicking.

The mechanism on GitHub is **org-level rulesets** plus the **Terraform GitHub provider**. The baseline lives in version control, gets reviewed like any other change, and is reconciled continuously:

```hcl
# Platform baseline applied to EVERY repo's default branch, org-wide.
# Teams may layer ADDITIONAL rules on top; they cannot remove these.
resource "github_organization_ruleset" "default_branch_baseline" {
  name        = "platform-baseline-default-branch"
  target      = "branch"
  enforcement = "active"

  conditions {
    ref_name {
      include = ["~DEFAULT_BRANCH"]   # every repo's default branch
      exclude = []
    }
  }

  rules {
    deletion         = true            # no deleting the default branch
    non_fast_forward = true            # no force-push to it
    required_signatures = true         # verified history (compliance evidence)

    pull_request {
      required_approving_review_count = 1
      require_code_owner_review       = true
      dismiss_stale_reviews_on_push   = true
      require_last_push_approval      = true   # author≠approver on the final state
    }

    required_status_checks {
      strict_required_status_checks_policy = true   # branch must be up to date
      required_check { context = "ci/required" }    # the one aggregating gate
    }
  }

  # Break-glass is a SHORT, named, audited list — not "all admins, always".
  bypass_actors {
    actor_type  = "Team"
    actor_id    = data.github_team.platform_oncall.id
    bypass_mode = "pull_request"   # even bypassers go through a PR; logged
  }
}
```

The two design decisions that matter more than the HCL:

- **Baseline + additive autonomy, not central control of everything.** The platform team owns the *floor* (the rules every repo must have); teams own the *ceiling* (stricter rules they choose — two reviewers, extra checks, signed-commit enforcement earlier). Rulesets *layer* — the most restrictive applicable rule wins — so a team can only ever make their repo *safer* than baseline, never weaker. This is the line that keeps platform from becoming a bottleneck and teams from becoming a liability.

- **The baseline targets `~DEFAULT_BRANCH`, not a hardcoded `main`.** Repos that still use `master`, or release branches named `release/*`, are covered by pattern, not by someone remembering to add them. The single most common gap in hand-rolled protection is the repo whose default branch isn't named what the policy assumed.

> **The professional reality:** the value of protections-as-code is not the automation — it's that *weakening a protection now requires a reviewed pull request*. The attack (and the accident) you're defending against is someone quietly unticking "require review" at 6pm to ship a fix. When that setting lives in Terraform, that action becomes a diff someone has to approve, with their name on it. This is the same machinery [06 — Policy as Code](../06-policy-as-code/professional.md) generalizes; branch protection is its most load-bearing instance.

---

## Core Concept 2 — Drift, Silent Weakening, and the Audit Trail

Protections-as-code only protects you if the code is the *source of truth* — if the live platform state can drift away from the declaration, you have the worst of both worlds: a Terraform file that lies and a UI that's actually in charge. **Drift detection** closes this loop.

There are two failure modes, and they need different controls:

1. **Accidental drift** — someone clicks the UI to fix something urgently and forgets to fold it back into code. The live state and the declared state diverge silently.
2. **Deliberate silent weakening** — someone with admin disables a check to merge a blocked PR, then re-enables it (or doesn't). Without detection, this leaves no durable trace beyond the audit log nobody reads.

The control is a **scheduled `terraform plan`** that fails loudly on any diff, plus alerting on the org audit log for protection-changing events:

```bash
# Runs on a schedule (e.g. hourly) in CI, NOT just on PR.
# A non-empty plan against prod means the live state drifted from code.
terraform plan -detailed-exitcode -lock=false
# exit 0 = no drift; exit 2 = drift detected → page the platform on-call
```

```bash
# Belt-and-suspenders: alert on the events themselves, in near-real-time.
# GitHub audit-log streaming → SIEM → alert on these actions:
#   protected_branch.policy_override
#   repository_ruleset.update / .destroy
#   protected_branch.update (required_status_checks, required_reviews changed)
gh api /orgs/$ORG/audit-log \
  --jq '.[] | select(.action | test("protected_branch|ruleset"))'
```

The combination matters: `terraform plan` tells you *that* state drifted but runs on a schedule; audit-log streaming tells you *the moment* a protection changed and *who* did it, in real time. One catches the slow leak, the other catches the deliberate act.

> **The principle:** a protection you cannot *prove* is currently in force is a protection you don't have. "We require reviews" is a claim; "here is the Terraform state, the last plan showing zero drift, and the audit-log stream showing no overrides in 90 days" is evidence. The gap between those two sentences is the entire difference between security theatre and a control an auditor will accept — and it's the same gap [06 — Policy as Code](../06-policy-as-code/professional.md) exists to close across every other policy you run.

---

## Core Concept 3 — The Merge Queue Adoption Decision

A merge queue is the answer to one specific, expensive problem: **two pull requests that are each green on their own branch but break `main` when both land**, because CI tested each against a stale `main` that didn't include the other. The classic case is PR-A deletes a function and PR-B adds a new caller of it; both pass, both merge, `main` is red. "Require branches to be up to date before merging" (strict status checks) fixes this *by forcing serialization manually* — every PR must rebase on the latest `main` and re-run CI before merging — which at volume becomes the **"update branch" thrash**: by the time your PR is current and green, someone else merged, and you're stale again.

A merge queue automates that serialization: it tests each PR against the *projected result* of everything ahead of it in the queue, and only merges if that combined state is green. No human rebases; no thrash.

**But it is not free.** The cost is **extra CI for speculative batches**: to keep latency acceptable at high volume, the queue tests several PRs in parallel as optimistic batches (PR-1, PR-1+2, PR-1+2+3…). If PR-1 fails, every speculative batch built on it is discarded and re-run — you've spent CI minutes on batches that never merge. The throughput/latency trade-off is the tuning knob: larger batches = higher throughput but more wasted CI when one fails; smaller batches = less waste but more end-to-end latency per PR.

So the adoption decision is a function of **merge volume × broken-main rate × CI cost**:

```
Cheap heuristic for "do we need a merge queue?"

  broken_main_per_week  ≥ 1   AND   merges_per_day ≥ ~10–15
  OR
  devs routinely "update branch" 3+ times to land one PR (visible thrash)
      → adopt a queue.

  Low volume (a few merges/day, main rarely breaks from interaction)
      → strict status checks ("require up to date") is enough; a queue is overhead.
```

The **migration story** is the part people underestimate. You don't flip a queue on for the whole org overnight:

1. **Instrument first** — measure broken-main frequency and "update branch" clicks. Adopt on evidence, not vibes.
2. **Pilot on the one or two highest-volume repos** — the monorepo, the busiest service — where the pain is real and the win is measurable.
3. **Tune batch size to your CI budget** — start conservative, watch the wasted-CI metric and the merge-latency p50/p95, adjust.
4. **Make the queue the *only* merge path** for that branch (remove the direct "merge" button via ruleset) so people can't bypass it back into thrash.
5. **Roll out to the next tier of repos only as their volume justifies it.** Most repos in a fleet will *never* need a queue, and putting one on a low-volume repo just adds latency.

> **The professional reality:** a merge queue is a throughput instrument, not a safety blanket. On a repo with five merges a day, it adds latency and CI cost to solve a problem you don't have. On the monorepo with two hundred merges a day, it's the difference between a `main` that's green and a `main` that's a perpetual incident. Adopt it where the broken-main rate and thrash *prove* you need it — and measure the wasted-CI cost so the cure stays cheaper than the disease.

---

## Core Concept 4 — History-Model Policy Across the Org

Squash vs merge-commit vs rebase is the topic where teams burn the most energy on the wrong axis. At the senior level it's a per-repo taste decision. At the professional level the load-bearing insight is: **consistency across the org matters more than which model you pick**, because every tool, runbook, and muscle-memory that reads history — `git bisect`, `git revert`, backport scripts, changelog generators, the on-call's mental model during an incident — assumes *one* shape of history. A fleet where half the repos squash and half merge-commit means every cross-repo operation has to ask "what shape is *this* repo's history?" first.

The trade-offs that actually drive the standard:

| Concern | Squash | Merge-commit | Rebase (linear, no merge commit) |
|---|---|---|---|
| **`git bisect`** | Excellent — one commit per PR, every commit on `main` is a tested unit | Murky — merge commits and intermediate WIP commits are bisect noise | Good — linear, but intermediate commits may be untested |
| **`git revert`** | Trivial — revert the one squash commit, the whole PR is undone | `revert -m` of the merge commit; usually works but mainline-parent subtlety | Must revert a range; fiddlier |
| **Backport / cherry-pick** | Clean — one commit cherry-picks to the release branch | Cherry-picking a merge needs `-m`; can drag unintended history | Clean per-commit, but multiple commits per change |
| **Granular history / blame** | Lost — the PR's internal commits vanish | Preserved — full authored history retained | Preserved — full history, replayed linearly |
| **Monorepo concerns** | Strongly preferred — keeps `main` readable at PR granularity, bisect tractable across thousands of commits | History explodes; bisect across a busy monorepo becomes painful | Linear helps, but commit count still high |

The defensible org standards, by repo type:

- **Application / service repos and monorepos → squash.** One commit per PR makes `main` a clean sequence of tested, revertible, bisectable units. This is why the largest monorepos overwhelmingly mandate squash: at that scale, bisect tractability and clean revert dominate, and nobody bisects to an intermediate "fix typo" commit.
- **Libraries with meaningful multi-commit changesets, or repos where authored history is the product → merge-commit (or rebase-merge).** When a PR is a coherent series of well-crafted commits (a refactor in reviewable steps), squashing destroys real information.

The point is not to win the religious war. It's to **pick a default, enforce it with `allowed_merge_types` in the ruleset, document the rationale, and grant exceptions deliberately** rather than letting it vary by whoever set up the repo.

```hcl
# Enforce ONE history model org-wide; deviations are explicit exceptions.
resource "github_repository" "service" {
  # ...
  allow_merge_commit = false
  allow_rebase_merge = false
  allow_squash_merge = true     # the org default for service repos
  squash_merge_commit_title   = "PR_TITLE"
  squash_merge_commit_message = "PR_BODY"   # PR description → commit body, kept searchable
}
```

> **The hard-won lesson:** the worst history-model outcome isn't squash *or* merge-commit — it's *inconsistency*. A backport that's trivial in a squash repo and a multi-commit cherry-pick archaeology dig in the merge-commit repo next door means your release process can't have one runbook. Standardize, enforce in the ruleset, and treat the choice as "what's the org default" — the specific model is a footnote next to the consistency.

---

## Core Concept 5 — CODEOWNERS Governance and Review Fatigue

`CODEOWNERS` plus "require review from Code Owners" is how you make ownership a gate: changes to `payments/**` *must* be approved by the payments team. It is also, ungoverned, one of the most reliable ways to grind a fast org to a halt. Three failure modes dominate, and all of them are governance problems, not config problems.

**1. The "one team owns everything" bottleneck.** A broad early entry — `* @platform-team` or a catch-all near the top — means every PR in the repo requires that team's review. Forty PRs queue behind one over-subscribed team; the gate meant to ensure quality becomes the thing blocking the release. CODEOWNERS is **last-match-wins** per path, so a too-broad rule high up, or a catch-all at the bottom, silently makes one team the approver of last resort for changes they have no context on.

**2. Bus-factor and stale-owner rot.** An entry points at `@alice` who changed teams eight months ago, or `@legacy-team` that was reorganized out of existence. Now PRs touching that path are blocked on a review that *can never come*, and the break-glass to unblock them quietly trains everyone to bypass CODEOWNERS. Ownership decays the moment the org chart moves; the file does not update itself.

**3. Required-review fatigue.** When *everything* requires owner review and owners are spread thin, reviews become rubber stamps — the LGTM-in-90-seconds that satisfies the gate without the scrutiny it was meant to provide. A gate that's always-on for low-risk changes trains reviewers to approve without looking, which is *worse* than no gate because it manufactures false assurance.

The governance practices that keep CODEOWNERS healthy:

- **Own at the right granularity — teams, not individuals; directories, not files.** Never name a person; name a team alias (so departures don't break the gate). Own meaningful boundaries (`services/payments/**`), not every file, so the gate fires on changes that genuinely need that team's eyes.
- **Validate ownership in CI.** Lint the file on every change: every referenced team/user still exists, every path still resolves, no orphaned globs. Tools and a quick `gh api` check catch the stale-owner rot before it blocks a release.
- **Run periodic ownership reviews.** Quarterly, reconcile CODEOWNERS against the current org chart and against *who's actually merging changes to each path* (the audit log knows). Paths whose owners never review them are either mis-assigned or candidates for a broader, more honest owner.
- **Reserve required-owner-review for genuinely sensitive paths.** Make owner review *required* for `payments/**`, `auth/**`, infra, and migrations — and *advisory* (auto-requested, not blocking) elsewhere. This is the single biggest lever against review fatigue: the gate is meaningful precisely because it's not everywhere.

```bash
# CI lint: every CODEOWNERS team/user must still exist (catches stale-owner rot)
grep -oE '@[A-Za-z0-9_/-]+' CODEOWNERS | sort -u | while read owner; do
  gh api "/orgs/$ORG/teams/${owner#@org/}" >/dev/null 2>&1 \
    || echo "STALE OWNER: $owner no longer resolves"
done
```

> **The professional reality:** CODEOWNERS rot is invisible until a release is blocked on a review from a team that no longer exists, or one team is the silent bottleneck for forty PRs they don't understand. Govern it like the production control it is — teams not individuals, validated in CI, reviewed quarterly, required only where the risk earns it. See [Code Review](../../code-review/) for the human side of making those required reviews actually worth the wait.

---

## Core Concept 6 — Compliance, Separation of Duties, and the Bypass Surface

For any org under SOC2, ISO 27001, PCI-DSS, or pursuing SLSA, branch protection stops being a quality nicety and becomes the *evidence* that satisfies controls about who can change production code. The auditor's questions are specific, and the right answers are artifacts, not assurances.

**Separation of duties — author ≠ approver.** The control is "no engineer can merge their own change without independent review." The mechanism is required reviews where the author's own approval doesn't count, plus `require_last_push_approval` so that pushing a new commit after approval re-requires sign-off (closing the "approve, then sneak in a change" gap). The *evidence* is the PR record: every merged PR shows an approving review from someone other than the author, and the protection that enforced it lives in Terraform.

**Verified history.** `required_signatures` in the ruleset rejects any commit that isn't cryptographically signed (GPG/SSH/Sigstore). This gives you tamper-evidence — every commit on `main` is provably authored by a known identity — which is both SLSA provenance and the answer to "prove no unauthorized code entered the trunk."

**Immutable audit of who-merged-what.** The org audit log records every merge, every approval, every protection change, every override — streamed to a SIEM/object store where it can't be edited. This is the SOC2/SLSA evidence: not "we have a process," but "here is the immutable log of every change to protected branches for the audit period."

The thing that turns this from process theatre into a control auditors accept is that **it's all derivable from protections-as-code plus logs**, with no human in a checklist:

> **The audit reality:** the failing answer is "we ask engineers to get reviews and we trust admins not to bypass." The passing answer is "separation of duties is enforced by a Terraform-managed ruleset (here's the code), signed commits are required (here's the config), and every merge, approval, and override is in an immutable audit stream (here are 12 months of it)." The first is a promise; the second is evidence. Auditors accept evidence.

**The admin-bypass decision as org policy.** `include administrators` / the bypass-actor list is the single most consequential setting in this whole topic, because it's the one that decides whether your protections are *real* or *optional for the powerful*. As an org policy:

- **Default: no standing bypass.** Admins are subject to the protections. The whole point of protections-as-code is that even an admin can't quietly weaken them.
- **Break-glass, not bypass.** A genuine emergency (the gate itself is broken; a security fix must land while CI is down) needs an escape hatch — but it must be **named, narrow, logged, and rare**. A short on-call team in the bypass-actor list, every use of it alerting the SIEM, and a written justification expected after the fact.
- **Forbid silent, standing admin bypass.** "All admins can always bypass" is the configuration that turns into the force-push that wipes a day of `main`. If bypass is possible, it must be *observable* — an alert fires, a record exists, someone reviews it.

This is the break-glass surface that [07 — Break-glass & Bypass](../07-break-glass-and-bypass/professional.md) covers in depth. The branch-protection job is to make sure the surface is *minimal, logged, and exceptional* — never the everyday path.

> **The principle:** every bypass you allow is a hole an auditor will find and an attacker will look for. The goal is not zero bypass (a totally locked-down repo with a broken CI gate and no escape hatch is its own incident). The goal is bypass that's *rare, named, and loud* — so the audit log can prove it was used twice in a year, by the on-call, with a reason, and not silently by whoever had admin and a deadline.

---

## War Stories

**The admins who bypassed until a force-push wiped a day of main.** A repo had branch protection, but `include administrators` was off and half the senior engineers were admins. Bypassing the gate to "just merge this real quick" was routine — nobody thought twice. Then an admin doing a `git push --force` to fix a botched rebase targeted the wrong remote and overwrote `main`, wiping a day of merged work that hadn't yet propagated to anyone's local. The protection that would have rejected the force-push (`non_fast_forward`) *existed* — admins were just exempt from it. The fix was one line: enforce protections on admins, move the escape hatch to a narrow, logged break-glass on-call list. The lesson: a protection that the powerful routinely bypass isn't a protection, it's a suggestion — and the day someone fat-fingers the bypass, it's an incident.

**Two green PRs that broke main every week until a merge queue fixed it.** A busy service repo (≈ 80 merges/day) had `main` go red roughly once a week, always from the same pattern: two PRs that each passed CI against a `main` that didn't include the other — one renamed a function, the other added a caller. "Require branches to be up to date" had been tried and abandoned because the constant rebase-and-wait thrash was worse than the occasional breakage. Adopting a merge queue eliminated the class entirely: each PR was tested against the projected result of everything ahead of it. Broken-main from PR interaction went to zero. The cost was real — wasted CI on speculative batches when one PR failed — but at that volume it was a fraction of the engineer-hours previously lost to a red `main` blocking everyone. The lesson: the queue solved a problem that *volume* created; the same queue on a five-merge-a-day repo would have been pure overhead.

**The CODEOWNERS bottleneck that blocked 40 PRs.** A platform team, trying to ensure quality, added `* @platform-team` near the top of a shared monorepo's CODEOWNERS. Because owner review was required, *every* PR in the monorepo now needed a platform-team approval — including hundreds of changes to application code the platform team had no context on. Within days, ~40 PRs were queued on a six-person team, the team was drowning in review requests for code they didn't own, and release velocity cratered. The fix was to scope ownership to the paths platform *actually* owned (`infra/**`, `ci/**`, `tooling/**`) and make owner review required only there. The lesson: CODEOWNERS granularity is a throughput decision — a too-broad rule turns the team it names into the bottleneck for the entire repo.

**The squash-vs-merge backport nightmare.** An org had no history-model standard; repos varied by whoever set them up. A critical fix needed backporting to three release branches. In the squash repos it was a clean three-way `git cherry-pick` of one commit each. In the merge-commit repo, the fix was buried in a feature PR's merge commit; cherry-picking it required `-m` parent selection, dragged in unintended sibling commits, produced conflicts that took hours to untangle, and the on-call wasn't sure the result was correct. A four-hour backport that should have been twenty minutes. The aftermath was an org-wide history-model standard (squash for services, enforced in rulesets) — not because squash is universally superior, but because *one consistent shape* meant the backport runbook worked everywhere. The lesson: inconsistency, not the choice itself, is what makes history operations expensive.

**The compliance audit passed because protections were Terraform-managed.** During a SOC2 Type II audit, the assessor asked the standard battery: prove no engineer merges their own code unreviewed, prove no unauthorized changes reached production branches, prove admin overrides are controlled. The team that had hand-configured protections via the UI spent a week screenshotting settings across repos and couldn't prove the settings hadn't changed *during* the audit period. The team whose protections were in Terraform answered in an hour: here's the ruleset code (separation of duties, signed commits, restricted bypass), here's the scheduled `terraform plan` history showing zero drift, here's the audit-log stream showing every merge had an independent approval and the bypass was used once, by the on-call, with a documented reason. They passed that section with no findings. The lesson: protections-as-code plus immutable logs *is* the audit evidence — the same controls, expressed as artifacts instead of screenshots, turn a week of scramble into an hour of `terraform show`.

---

## Decision Frameworks

**Merge strategy by repo type. Default to:**

| Repo type | Strategy | Why |
|---|---|---|
| Service / application repo | **Squash** | One tested, revertible, bisectable commit per PR on `main` |
| Monorepo | **Squash (mandate)** | Bisect tractability and clean revert across thousands of commits dominate |
| Library with crafted multi-commit changesets | **Merge-commit or rebase-merge** | Authored history is real information; squashing destroys it |
| Repo where every PR is a single logical change | **Squash** | Granular history adds nothing; clean `main` wins |
| Release/long-lived branches needing backports | **Match the source repo's model** | Consistency makes cherry-pick predictable |

**Do we need a merge queue? (volume × broken-main rate):**

| Merges/day | Broken-main from PR interaction | "Update branch" thrash | Verdict |
|---|---|---|---|
| < ~10 | Rare | Rare | **No** — strict status checks ("require up to date") is enough |
| ~10–30 | Occasional (≈ monthly) | Some | **Maybe** — try strict checks first; queue if thrash is real |
| 30–100 | ≥ weekly | Frequent | **Yes** — pilot a queue on this repo |
| > 100 (busy monorepo) | Routine without serialization | Constant | **Yes, and make it the only merge path** |

**Per-repo vs org-ruleset governance:**

| Setting | Owned by | Mechanism |
|---|---|---|
| Baseline floor (no force-push, no deletion, ≥1 review, required CI, signed commits) | **Platform, org-wide** | Org ruleset, applied to `~DEFAULT_BRANCH`, in Terraform |
| Stricter additions (2 reviewers, extra checks) | **Team, per-repo** | Repo ruleset layered on top (most-restrictive wins) |
| History model default | **Platform standard** | `allowed_merge_types` enforced; exceptions explicit |
| CODEOWNERS contents | **Owning teams** | In-repo file, linted in CI, reviewed quarterly |
| Bypass-actor list | **Platform, org-wide** | Narrow break-glass team, in Terraform, logged |

**Admin bypass: allow / log / forbid:**

| Scenario | Policy |
|---|---|
| Standing "all admins can always bypass" | **Forbid** — this is the force-push-wipes-main configuration |
| Routine merges by admins | **Forbid bypass** — admins go through the same PR + checks |
| Genuine emergency (gate broken, security fix while CI down) | **Allow via narrow break-glass** — named on-call team, alert on every use, justification after |
| Any bypass that does happen | **Log, always** — audit-log stream → SIEM → reviewed |

**CODEOWNERS granularity:**

| Question | Guidance |
|---|---|
| Own by individual or team? | **Always team alias** — individuals leave; gates break |
| Own files or directories? | **Meaningful directories** (`services/payments/**`), not every file |
| Owner review required or advisory? | **Required only for sensitive paths** (payments, auth, infra, migrations); advisory elsewhere — kills review fatigue |
| Catch-all `*` rule? | **Avoid** — it makes one team the approver of last resort for code they don't own |
| How to keep it healthy? | **Lint in CI** (owners resolve) + **quarterly review** against org chart and actual reviewers |

---

## Mental Models

- **Protections-as-code makes weakening a protection a reviewed pull request.** The accident and the attack you're defending against is someone quietly unticking a checkbox at 6pm. When the checkbox lives in Terraform, that becomes a diff with their name on it.

- **A protection you can't prove is currently in force is a protection you don't have.** "We require reviews" is a claim; Terraform state + zero-drift plan + a clean audit-log stream is evidence. The gap between them is theatre vs control.

- **A merge queue is a throughput instrument, not a safety blanket.** It earns its CI cost only where volume × broken-main rate prove you need it. On a quiet repo it adds latency to solve a problem you don't have.

- **History-model consistency beats the choice itself.** A backport that's trivial in one repo and a four-hour archaeology dig next door means your release process can't have one runbook. Standardize and enforce; the specific model is a footnote.

- **CODEOWNERS granularity is a throughput decision.** Too broad and one team becomes the bottleneck for the whole repo; required everywhere and reviews become rubber stamps. Scope to real ownership; require only where risk earns it.

- **Every bypass is a hole someone will find.** The goal isn't zero bypass — it's bypass that's rare, named, and loud, so the audit log proves it was used twice in a year by the on-call, with a reason, not silently by whoever had admin and a deadline.

---

## Common Mistakes

1. **Configuring protections in the UI, per repo, by hand.** You can't prove they're consistent, new repos start unprotected, and anyone with admin can silently change them. Manage the baseline as code (org rulesets + Terraform); make weakening a reviewed PR.

2. **Code as source of truth, but no drift detection.** A Terraform file that lies is worse than no file. Run a scheduled `terraform plan` that fails on any diff, *and* stream the audit log for protection-changing events — one catches the slow leak, the other catches the deliberate act.

3. **Adopting a merge queue because it's best practice, not because volume demands it.** On a low-volume repo it's pure latency and wasted CI. Adopt on evidence (broken-main rate, visible thrash); pilot on the busiest repo; measure the speculative-batch cost.

4. **Letting the history model vary by whoever set up the repo.** Inconsistency makes every cross-repo bisect, revert, and backport ask "what shape is this one?" first. Pick an org default, enforce `allowed_merge_types`, grant exceptions deliberately.

5. **A broad CODEOWNERS rule that makes one team the bottleneck.** `* @platform` plus required review queues forty PRs on one team for code they don't own. Scope ownership to real boundaries; require owner review only on sensitive paths.

6. **Never reconciling CODEOWNERS against the org chart.** Stale owners (departed individuals, dissolved teams) block PRs on reviews that can never come, training everyone to bypass the gate. Lint in CI; review quarterly.

7. **Standing admin bypass / `include administrators` off.** The configuration where the powerful routinely skip the gate is the one where a fat-fingered force-push wipes `main`. Enforce on admins; reserve a narrow, logged break-glass for genuine emergencies.

8. **Treating compliance as process, not evidence.** "We ask for reviews and trust admins" fails an audit. Separation of duties enforced in a ruleset, signed commits required, and an immutable merge/override log *is* the evidence — the same controls as artifacts instead of promises.

---

## Test Yourself

1. You have four hundred repos and need every default branch protected identically, with teams able to add stricter rules but never remove the baseline. Describe the mechanism and the one targeting detail that catches repos whose default branch isn't named `main`.
2. Your protections live in Terraform. Why is that *insufficient* on its own, and what two controls together close the loop on drift and silent weakening?
3. A service repo merges ~80 PRs/day and `main` breaks roughly weekly from pairs of green PRs that conflict semantically. Is a merge queue justified? What is the queue's main cost, and what's the tuning knob?
4. Your org has no history-model standard and a critical fix needs backporting to three release branches. Explain why a squash repo and a merge-commit repo give wildly different backport experiences, and what the *real* lesson is.
5. A platform team adds `* @platform-team` to a monorepo's CODEOWNERS with owner review required. Predict what happens within a week and give the fix.
6. An auditor asks you to prove that no engineer merges their own code without independent review, across every repo in the cardholder environment. What's the failing answer, and what artifacts make up the passing one?
7. What is the org-policy default for admin bypass, when is an exception legitimate, and what makes that exception acceptable rather than a hole?

<details>
<summary>Answers</summary>

1. **Org-level rulesets applied via the Terraform GitHub provider**, with a baseline ruleset (`enforcement = active`) that teams can *layer on top of* but not subtract from — rulesets compose, most-restrictive-wins, so teams can only make a repo safer. The targeting detail: target **`~DEFAULT_BRANCH`** (the pattern for every repo's default branch), not a hardcoded `main`, so repos still on `master` or with renamed defaults are covered automatically. The most common gap in hand-rolled protection is exactly the repo whose default isn't named what the policy assumed.
2. Terraform is only the source of truth if the live state can't drift away from it; otherwise you have a file that lies and a UI that's actually in charge. Close the loop with **(a) a scheduled `terraform plan -detailed-exitcode` that fails on any diff** (catches the slow accidental leak) and **(b) audit-log streaming on protection-changing events** (`protected_branch.policy_override`, `repository_ruleset.update`) to a SIEM, alerting in near-real-time (catches the deliberate act and records *who*). One is periodic, the other is immediate; you need both.
3. **Yes** — at ~80 merges/day with weekly broken-main from PR interaction, you're well past the threshold (≥1 broken/week and ≥10–15 merges/day). The queue tests each PR against the *projected result* of everything ahead of it, eliminating the class. **Main cost:** extra CI for **speculative batches** — when an early PR in an optimistic batch fails, every batch built on it is discarded and re-run. **Tuning knob:** batch size — larger = higher throughput but more wasted CI on failure; smaller = less waste but more per-PR latency. Make the queue the only merge path so people can't thrash back to manual rebasing.
4. In a **squash** repo each PR is one commit, so the fix is a clean `git cherry-pick` of a single commit to each release branch. In a **merge-commit** repo the fix is buried inside a feature PR's merge commit; cherry-picking needs `-m` parent selection, can drag in unintended sibling commits, and produces conflicts that take hours. The real lesson is **not** that squash is superior — it's that **inconsistency** is the cost: without one standard, your backport runbook can't work everywhere. Standardize and enforce; the specific model is secondary.
5. Because owner review is required and the rule is last-match-wins (and broad/high), **every** PR in the monorepo now needs platform-team approval — including app code they don't own. Within a week ~40 PRs queue on a small team, the team drowns in review requests for unfamiliar code, and velocity craters. **Fix:** scope CODEOWNERS to the paths platform actually owns (`infra/**`, `ci/**`, `tooling/**`) and require owner review only there; everywhere else, advisory at most.
6. **Failing answer:** "we ask engineers to get reviews and trust admins not to bypass" — a process claim with no proof, especially that settings didn't change during the audit period. **Passing answer (artifacts):** the **Terraform ruleset** enforcing required reviews with author's approval excluded + `require_last_push_approval` (separation of duties as code), **`required_signatures`** for verified history, the **scheduled `terraform plan` history** showing zero drift over the period, and the **immutable audit-log stream** showing every merge had an independent approving review and every bypass (if any) who/when/why. Controls as evidence, not promises.
7. **Default: no standing bypass** — admins are subject to the protections (`include administrators` on / no broad bypass actors). A **legitimate exception** is a genuine emergency: the gate itself is broken, or a security fix must land while CI is down. It's acceptable rather than a hole when it's **narrow** (a named break-glass on-call team, not "all admins"), **logged** (every use alerts the SIEM and leaves an immutable record), and **rare with a justification** expected after. The audit log should be able to show it was used a handful of times, by the on-call, with reasons.

</details>

---

## Cheat Sheet

```
PLATFORM BASELINE (protections-as-code)
  org ruleset → target ~DEFAULT_BRANCH (not hardcoded "main")
  enforcement = active; teams LAYER on top, can't subtract (most-restrictive wins)
  baseline floor: no force-push, no deletion, ≥1 review (author≠approver),
                  required CI, required_signatures
  manage in Terraform → weakening = a reviewed PR with a name on it

DRIFT (code must be source of truth)
  terraform plan -detailed-exitcode   scheduled; exit 2 = drift → page
  audit-log stream → SIEM             real-time on policy_override / ruleset.update
  RULE: a protection you can't PROVE is in force, you don't have

MERGE QUEUE (do you need one?)
  < ~10 merges/day, main rarely breaks  → NO; strict "require up to date" is enough
  ≥1 broken-main/week AND ≥10-15/day    → YES; pilot on busiest repo
  cost: wasted CI on speculative batches when an early PR fails
  knob: batch size  (bigger = throughput + more waste; smaller = less waste + latency)
  make the queue the ONLY merge path so people can't thrash back

HISTORY MODEL (consistency > the choice)
  service/app/monorepo → SQUASH   (one tested, revertible, bisectable commit/PR)
  crafted multi-commit lib        → merge-commit / rebase-merge
  enforce allow_squash_merge only; exceptions explicit
  WORST outcome = inconsistency (backport runbook can't work everywhere)

CODEOWNERS (governance, not config)
  teams not individuals; directories not files; last-match-wins
  required owner review ONLY on sensitive paths (payments/auth/infra/migrations)
  lint in CI (owners resolve) + quarterly review vs org chart
  avoid `*` catch-all → makes one team approver of last resort

COMPLIANCE / BYPASS
  SoD: author≠approver + require_last_push_approval   (evidence: PR records)
  required_signatures = verified history              (SLSA provenance)
  immutable audit log of every merge/approval/override (SOC2 evidence)
  admin bypass: DEFAULT none → break-glass = named, narrow, LOGGED, rare
```

---

## Summary

- **Manage protections as code with a centrally-owned baseline** (org rulesets + Terraform GitHub provider) targeting `~DEFAULT_BRANCH`. Teams layer stricter rules on top but can't subtract; weakening a protection becomes a reviewed pull request. This is the most load-bearing instance of [06 — Policy as Code](../06-policy-as-code/professional.md).
- **Code is only the source of truth if it can't drift.** Pair a scheduled `terraform plan` (catches the slow leak) with audit-log streaming on protection-changing events (catches the deliberate act, in real time). A protection you can't *prove* is in force is one you don't have.
- **A merge queue is a throughput instrument**, justified by volume × broken-main rate, not by best-practice instinct. It eliminates the "two green PRs break main" class at the cost of extra CI for speculative batches; tune batch size, pilot on the busiest repo, and make it the only merge path.
- **History-model consistency matters more than the choice.** Standardize (squash for services and monorepos; merge-commit for crafted-history libraries), enforce `allowed_merge_types`, and grant exceptions deliberately — inconsistency is what makes backports and bisects expensive.
- **Govern CODEOWNERS like a production control:** teams not individuals, directories not files, linted in CI, reviewed quarterly, and required *only* on sensitive paths — so the gate stays meaningful instead of becoming a bottleneck or a rubber stamp.
- **Compliance is satisfied by evidence, not process.** Separation of duties enforced in a ruleset, signed commits, and an immutable merge/override log *are* the SOC2/SLSA evidence. Default to no standing admin bypass; reserve a narrow, logged, rare break-glass — the surface [07 — Break-glass & Bypass](../07-break-glass-and-bypass/professional.md) governs in depth.

You can now operate branch protection and merge policy as a fleet-, compliance-, and developer-flow concern. The remaining tier — [interview.md](interview.md) — consolidates the entire topic into the questions that probe whether someone actually understands all of this.

---

## Further Reading

- [GitHub — About rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets) — org/repo rulesets, layering, bypass actors; the modern successor to classic branch protection.
- [GitHub — Managing a merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue) — speculative batches, the throughput/latency model, and when to adopt.
- [GitHub — About code owners](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners) — syntax, last-match-wins, and required-owner-review semantics.
- [Terraform GitHub provider — `github_organization_ruleset`](https://registry.terraform.io/providers/integrations/github/latest/docs/resources/organization_ruleset) — protections-as-code at org scale.
- [SLSA framework](https://slsa.dev/) — provenance, two-person review, and verified history as supply-chain controls your branch policy provides evidence for.
- [GitHub — Streaming the audit log](https://docs.github.com/en/organizations/keeping-your-organization-secure/managing-the-audit-log-for-your-organization/streaming-the-audit-log-for-your-organization) — the immutable who-merged-what evidence auditors accept.
- [interview.md](interview.md) — the same material distilled into interview questions and the answers that distinguish operators from checkbox-tickers.

---

## Related Topics

- [01 — Required CI Checks](../01-required-ci-checks/professional.md) — the status checks that branch protection makes required, and the aggregating gate the merge queue tests against.
- [04 — Deploy Approvals & Sign-offs](../04-deploy-approvals-and-signoffs/professional.md) — separation of duties and gated promotion extended from merge to deploy.
- [06 — Policy as Code](../06-policy-as-code/professional.md) — the general machinery that branch-protection-as-code is the most load-bearing instance of.
- [07 — Break-glass & Bypass](../07-break-glass-and-bypass/professional.md) — governing the admin-bypass surface this topic deliberately keeps minimal, logged, and rare.
- [Code Review](../../code-review/) — the human side of the required reviews that make CODEOWNERS and separation-of-duties gates worth the wait.
