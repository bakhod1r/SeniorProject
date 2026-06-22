# Required CI Checks — Professional Level

> **Roadmap:** [Quality Gates](../README.md) → Required CI Checks
> *The senior page taught you how to make a check required on one repo. This page is about governing the required set across a thousand repos, where a renamed job silently un-gates 300 of them, a 45-minute pipeline quietly tanks your deploy frequency, and a flaky E2E suite trains a whole org to blind-retry until "required" means nothing — and where the required set is a platform SLO, an audit artifact, and a budget line, not a checkbox.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Governance: From Clicked Branch-Protection to Org-Wide Policy](#core-concept-1--governance-from-clicked-branch-protection-to-org-wide-policy)
5. [Core Concept 2 — The Flaky Tax, Quantified](#core-concept-2--the-flaky-tax-quantified)
6. [Core Concept 3 — The Speed Budget as a Platform SLO](#core-concept-3--the-speed-budget-as-a-platform-slo)
7. [Core Concept 4 — Rolling Out Security Gates Without Drowning Teams](#core-concept-4--rolling-out-security-gates-without-drowning-teams)
8. [Core Concept 5 — The Required-Set Review Cadence](#core-concept-5--the-required-set-review-cadence)
9. [Core Concept 6 — Standardization vs Team Autonomy, and the Audit Dividend](#core-concept-6--standardization-vs-team-autonomy-and-the-audit-dividend)
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

> Focus: **Owning the required set across an org, where every gate is a tax on every PR, a trust contract with every developer, and a line item in the CI bill — and where the failure modes are organizational, not technical.**

The senior page framed required checks as a per-repo configuration choice: which jobs block merge, how status checks map to branch protection, what "required" means mechanically. At the professional level the mechanics are assumed. The hard problems move to different meetings: a platform review where someone asks "why do our PR checks take 45 minutes and why is deploy frequency dropping?"; a post-incident where a critical CI job was renamed six months ago and silently stopped gating 300 repos; a security initiative to roll out SAST across the org without generating ten thousand ignored findings; a SOC 2 audit that asks "prove that every production change passed your required checks."

None of these are new *concepts* — they're the same status-check-blocks-merge fundamentals, now multiplied by a thousand repos, a finance team watching the runner bill, and a developer population that will route around any gate they stop trusting. The skill here is judgment at scale: knowing that an unowned required set rots, that a flaky required check is worse than no check because it teaches the org to ignore red, that speed is a feature you have to fund, and that the consistency of your required set is the difference between a clean audit and a quarter of evidence-gathering. This is the governance-and-economics layer.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — status checks, branch protection mapping, required vs optional jobs, merge queues, the mechanics of making a check block.
- **Required:** You've operated CI for more than a handful of repos and felt the pain of inconsistency.
- **Helpful:** You've owned a platform/DevEx team baseline, or been the person teams complain to about slow or flaky CI.
- **Helpful:** You've sat through an audit (SOC 2, ISO 27001, FedRAMP-adjacent) where "change control evidence" was a line item.

---

## Glossary

- **Required check / required status check:** A CI result that must be green (or a ruleset condition that must be satisfied) before a PR can merge. The unit you're governing.
- **Ruleset (GitHub) / Compliance framework (GitLab):** Org- or enterprise-level policy that applies branch protection and required checks to many repos by pattern, rather than per-repo clicks.
- **Flaky check:** A check that passes and fails non-deterministically on the same code. The single biggest threat to a trusted required set.
- **Quarantine:** Moving a flaky test/check out of the blocking set (to advisory/non-required) while its owner fixes it, so it stops spuriously blocking merges without being silently deleted.
- **Merge queue / merge train:** A serialization mechanism that re-tests each PR against the latest `main` before merging. Required checks run *in* the queue; flaky checks cause queue *thrash* (re-runs, evictions).
- **Test Impact Analysis (TIA):** Running only the tests affected by a diff, derived from a code-to-test dependency map. The primary lever for cutting required-check latency without cutting coverage.
- **Speed budget:** A platform SLO on required-check duration (e.g., p95 ≤ 10 min for service repos). A funded target, not an aspiration.
- **Dry-run / advisory / enforce:** The three-stage rollout posture for a new gate — runs and reports nothing-blocking, runs and warns, runs and blocks.
- **Diff-scoping:** Limiting a security/quality gate to *new* findings introduced by the PR rather than the entire (pre-existing) backlog.
- **Waiver / exception as code:** A reviewed, expiring, version-controlled suppression of a specific finding or a specific repo from a gate — the auditable alternative to "click the admin-merge button."

---

## Core Concept 1 — Governance: From Clicked Branch-Protection to Org-Wide Policy

At ten repos, branch protection is a thing you click. At a thousand repos, "clicked" is a liability: nobody knows which repos have which required checks, the set drifts as people copy-paste, new repos start with *nothing* required, and there is no audit trail for who changed what. The professional move is to make the required set **consistent, version-controlled, and auditable** — policy, not a per-repo toggle.

The three mechanisms you'll actually use:

- **GitHub repository rulesets / org rulesets.** Rulesets apply branch protection and required status checks across many repos by name pattern (`~ALL`, `team-*`, `service-*`), defined once at the org or enterprise level. Unlike legacy per-branch protection, rulesets are layered (org baseline + repo extensions), have explicit bypass lists, and emit audit-log events on change.
- **GitLab compliance frameworks / push rules.** A compliance framework attaches a required pipeline and MR approval policy to every project labeled with it, enforced centrally so a project owner can't quietly remove it.
- **Terraform-managed repo config** (`github_repository_ruleset`, `github_branch_protection`). The repo's protection *is* code: reviewed in a PR, diffed, applied by CI, with a history. This is where governance meets [policy as code](../06-policy-as-code/professional.md) — the required set lives in a repo, reviewed like any other change.

The operating model that scales is **platform-owns-the-baseline, teams-extend**:

```hcl
# Platform-owned org baseline (one place, applies to ~ALL repos)
resource "github_organization_ruleset" "baseline" {
  name        = "org-baseline"
  target      = "branch"
  enforcement = "active"

  conditions {
    ref_name { include = ["~DEFAULT_BRANCH"]; exclude = [] }
    repository_name { include = ["~ALL"]; exclude = ["sandbox-*"] }
  }

  rules {
    pull_request { required_approving_review_count = 1 }
    required_status_checks {
      # The non-negotiable org-wide set. Names are a CONTRACT (see War Stories).
      required_check { context = "ci/lint" }
      required_check { context = "ci/unit" }
      required_check { context = "security/secret-scan" }
    }
    non_fast_forward = true
  }

  bypass_actors {
    actor_id    = data.github_team.release_eng.id
    actor_type  = "Team"
    bypass_mode = "pull_request"   # even bypass is reviewable, not a silent override
  }
}
```

Teams then *add* repo-specific required checks (their E2E suite, their contract tests) in their own repo's ruleset, on top of the baseline they cannot remove. The platform team owns *consistency and the floor*; teams own *their domain-specific ceiling*.

**Exceptions and waivers as code.** The thing that quietly kills governance is the unlogged exception — the admin who clicks "merge without passing checks." Replace it with reviewed, expiring waivers: a file in the policy repo (`waivers.yaml`) that lists `repo`, `check`, `reason`, `owner`, `expires`, applied by the same pipeline that applies the baseline. Now an exception is a PR with an approver and an expiry, and "show me every active exception and why" is a `cat` and a `git log`, not a tribal-knowledge interview.

> **The professional reality:** the goal is not "more locked down." It's that the required set is **knowable, reviewable, and reversible org-wide**. Per-repo clicking fails all three: you can't enumerate it, you can't review a change to it, and you can't roll it back. The day an auditor or an incident asks "what was required on this repo on this date?", policy-as-code answers in `git log` and clicked config answers with a shrug.

---

## Core Concept 2 — The Flaky Tax, Quantified

A flaky required check is not a minor annoyance — it is the single fastest way to destroy the trust that makes a required set worth having. The mechanism is simple and brutal: if a check fails on ~2% of green code, then a PR touching code that triggers it sees a spurious red 2% of the time. Stack `k` independent flaky checks and the probability the suite is spuriously red on a correct PR is `1 − (1 − p)^k`. Ten checks at 2% flake each ≈ **18% of correct PRs blocked by noise**. The org learns one lesson: **red doesn't mean broken — just retry.** Once that belief sets in, your required set has stopped catching real failures, because nobody reads them anymore.

**Quantify it, because "flaky is bad" doesn't get budget — a number does.** The flaky tax has measurable components:

- **Developer-hours lost to spurious red:** `(PRs/day) × P(spurious red) × (minutes to notice + re-run wait + context-switch)`. For an org doing 500 PRs/day with 15% spurious-red and ~15 min lost per incident, that's ~19 engineer-hours/day — over two full-time engineers, every day, burned on retrying CI.
- **Merge-queue thrash:** in a merge queue, a flaky failure evicts the PR, re-tests the rest, and re-runs CI — so one flake costs *N* re-runs, not one. Flake plus merge queue is multiplicative on both wall-clock and CI spend.
- **CI spend on re-runs:** every blind retry is paid runner minutes. At scale this is a five- or six-figure annual line item that buys nothing.

The **deflake program** that actually works treats flakes as production defects with owners and SLOs, not as a backlog nobody touches:

```
1. DETECT   Re-run-on-fail telemetry + a "flaky" classifier (passed-on-retry,
            or failed historically on unchanged code). Feed a flaky dashboard.
2. RANK     Sort by spurious-failure count × blast radius (how many PRs it hit).
            The top 1% of tests usually cause the majority of the pain.
3. QUARANTINE  Automation moves a test over threshold OUT of the required set
            (→ advisory) and FILES A TICKET to the owning team automatically.
            It stops blocking merges but is NOT silently deleted.
4. OWN      Each quarantined test has an owner and an SLA (e.g., fix or delete
            in 14 days). A quarantine budget caps how much can be parked at once.
5. CLOSE    Fixed → returns to required. Past SLA with no fix → it gets DELETED
            (a test you won't fix is a test that's lying to you).
```

The cultural fight is the real work. Teams want to quarantine *aggressively* (so their PRs go green) and fix *never* (so they ship features). Without a quarantine *budget* and a deletion deadline, quarantine becomes a graveyard and coverage silently erodes. Without a flaky *dashboard* and owner SLAs, the program is just vibes. The platform team's job is to make the flaky tax **visible and attributed** — "your service's E2E suite cost the org 40 engineer-hours of spurious red this month" — so fixing it competes fairly with feature work.

> **The non-negotiable principle:** a required check must be near-deterministic, or it must not be required. A flaky required check is *worse* than no check, because it actively trains the org to ignore red — and a trained-to-ignore population will sail right past the *real* failure the gate existed to catch. Trust in the required set is the asset; flake is the thing that spends it.

---

## Core Concept 3 — The Speed Budget as a Platform SLO

Every required check is a tax on every PR, paid in the most expensive currency there is: a blocked engineer waiting to merge. At org scale, required-check latency is not a per-repo annoyance — it's a **platform SLO directly tied to developer productivity and, downstream, to deploy frequency** (one of the [DORA](../../engineering-metrics-and-dora/) four). The death spiral is well documented: checks creep from 8 minutes to 20 to 45; engineers stop waiting and start batching changes into giant PRs (because the per-PR tax is fixed and they want to amortize it); big PRs are riskier and slower to review; review latency rises; people context-switch away while waiting and lose flow; deploy frequency drops; and the org concludes "we need *more* gates" — which makes it worse.

**Make speed a tracked metric, not a vibe.** The number that matters is **required-check p95 wall-clock** (p50 lies; the tail is what people feel), sliced by repo tier. Put it on a dashboard next to PR throughput and deploy frequency so the connection is undeniable.

The levers, roughly in ROI order at scale:

- **Remote build caching** (Bazel remote cache, Gradle/Turborepo remote cache, sccache). The single highest-leverage investment for large monorepos: unchanged targets are *fetched, not rebuilt*. A cold 30-minute build becomes a 3-minute cache-mostly-hit build. The ROI math is direct: `(minutes saved per PR) × (PRs/day) × (loaded engineer cost/min)` vs the cache infrastructure spend, and it is almost always lopsided in favor of the cache.
- **Test Impact Analysis.** Run only the tests a diff can affect, from a code-to-test dependency graph (Bazel's query, or commercial TIA). This is the lever that turns "run all 40,000 tests on every PR" into "run the 300 that touch this change" — and it's frequently the difference between a 45-minute and a 6-minute required suite.
- **Runner fleet investment.** Parallelism is money: bigger/more runners, test sharding, ephemeral runners that scale with PR volume. There's a real ROI curve here — past a point, more runners stop helping because the critical path is one slow serial job, not capacity. Find the critical path before buying more iron.
- **Tiering the gate by stage.** Fast, cheap, high-signal checks (lint, type-check, unit, secret-scan) are *required on PR*. Slow, expensive checks (full E2E, load, cross-browser) move to the merge queue, to `main` post-merge, or to a nightly — required to stay green but not blocking every PR's inner loop.

```yaml
# The shape of a tiered required set: fast gate on PR, heavy gate off the inner loop
on_pull_request:        # REQUIRED — must be fast (target p95 ≤ 10 min)
  - lint                # seconds
  - typecheck           # ~1 min
  - unit (TIA-scoped)   # only affected tests
  - secret-scan (diff)  # diff-scoped, fast

in_merge_queue:         # REQUIRED to merge, but runs once per train, not per push
  - integration
  - e2e-smoke           # the critical-path subset, NOT the whole E2E zoo

post_merge / nightly:   # REQUIRED to stay green; breakage pages the owner
  - full-e2e
  - load / soak
  - full-matrix browsers
```

> **The professional reality:** "our PR checks take 45 minutes" is not a CI problem, it's a *deploy-frequency* problem wearing a CI costume, and you climb out with **remote caching + TIA + gate tiering**, measured by required-check p95. The teams that win treat the inner-loop speed budget as a funded SLO with an owner — not as something that "got slow" by accident and that everyone just endures. Speed is a feature, and features get budget.

---

## Core Concept 4 — Rolling Out Security Gates Without Drowning Teams

Introducing SAST, secret scanning, dependency/SCA, and license gates org-wide is where good intentions go to die. Flip a SAST gate to *blocking* across a thousand repos on day one and you produce a tidal wave of pre-existing findings — most of them low-severity or false-positive — that blocks every PR for code nobody touched. The org's response is predictable and fatal: they demand a blanket bypass, you grant it, and you've built "the security gate everyone ignores." The gate now produces noise, dashboards full of un-triaged findings, and a false sense of coverage.

The rollout that *works* is staged and scoped:

- **Dry-run → advisory → enforce.** Stage 1, the gate runs and reports to a dashboard, blocking nothing — you're measuring the true finding volume and false-positive rate. Stage 2, it comments on PRs (advisory) so teams see findings in context without being blocked. Stage 3, it blocks — but only after the noise is understood and the backlog has a plan. Skipping straight to enforce is the classic failure.
- **Diff-scoping is the unlock.** Block (or warn on) only findings *introduced by the PR*, not the pre-existing backlog. "Don't make it worse" is enforceable on day one and politically survivable; "fix everything that was ever wrong" is neither. Most modern scanners (CodeQL, Semgrep, GitLab SAST) support new-vs-existing diffing — use it.
- **Central triage, not per-team drowning.** A security/platform team triages findings centrally first, tunes out the false-positive-heavy rules, and sets per-severity policy before teams ever see a block. Teams should receive *signal*, not raw scanner exhaust.
- **Waivers as expiring, reviewed code.** A finding can be suppressed — but via a reviewed, expiring waiver with a reason and an owner, not a silent inline `# nosec` that lives forever. This keeps the gate honest *and* gives an auditor a clean trail.

Severity-routing makes the gate proportionate instead of all-or-nothing:

| Finding | Posture | Rationale |
|---|---|---|
| **Secret in diff** (live credential) | **Block (push protection)** | Cheap to fix, catastrophic to merge; near-zero false positives on high-entropy patterns |
| **Critical/High SAST in new code** | Block | New, high-severity, diff-scoped — defensible and rare enough not to drown |
| **Medium/Low SAST** | Advisory / warn | High false-positive rate; blocking trains people to bypass |
| **Dependency CVE — critical, fix available** | Block | Actionable; there's a version to bump to |
| **Dependency CVE — no fix / transitive** | Advisory + ticket | Blocking on something you can't fix just teaches bypass |
| **License violation (copyleft in proprietary)** | Block | Legal, binary, not a judgment call |

Secret scanning deserves special mention because its ROI is the clearest in the whole security-gate portfolio: **push protection** rejects a commit *containing a detected secret before it ever lands*, which is qualitatively better than detecting it after — because a secret that reached the remote, even briefly, must be treated as compromised and rotated. The false-positive rate on high-entropy provider patterns (AWS keys, GitHub tokens, Stripe keys) is low enough to block by default on day one, unlike SAST.

> **The professional reality:** the goal is a security gate the org *trusts and acts on*, which means it must be **high-signal from day one and proportionate to severity**. Dry-run to learn the volume, diff-scope so you're enforcing "don't make it worse," triage centrally so teams get signal not noise, and reserve hard blocks for the cheap-to-fix, high-consequence, low-false-positive cases (secrets, criticals in new code). A gate that drowns teams in low-severity noise doesn't make you more secure — it produces a bypass culture and a dashboard nobody reads. See [gate design](../05-gate-design-speed-vs-safety/professional.md) for the speed-vs-safety calculus behind which findings earn a block.

---

## Core Concept 5 — The Required-Set Review Cadence

A required set is not a write-once artifact — it's a portfolio that must be **actively curated**, or it rots in both directions. Left alone, it accumulates gates that never catch anything (dead weight that taxes every PR for no value) *and* fails to add gates for new classes of failure (so the same incident recurs). The professional discipline is a **scheduled review cadence** with two symmetric questions.

**Prune gates that don't pay rent.** A required check that hasn't caught a real defect in two quarters is not free — it costs latency, flake surface, and maintenance on every PR, and its presence implies a value it isn't delivering. Instrument every gate with the data to make this call: *catch rate* (real defects blocked), *spurious-failure rate* (flake), and *override/bypass rate* (how often humans route around it — a signal nobody trusts it). A gate with low catch rate and high override rate is a candidate for deletion or demotion to advisory.

```
For each required check, quarterly:
  catch_rate     = real defects blocked / total failures        # is it earning its slot?
  flake_rate     = spurious failures / total runs               # is it eroding trust?
  override_rate  = manual bypasses / total invocations          # does anyone trust it?
  p95_added      = wall-clock it adds to the required path       # what does it cost?

  KEEP      high catch, low flake, low override
  FIX/QUAR  low catch BUT high flake          → deflake or quarantine
  DEMOTE    low catch, low flake, low cost     → advisory (keep the signal, drop the block)
  DELETE    low catch, high override           → it's theater; remove it
```

**Add gates for new incident classes.** The other half of the cadence is post-incident: when an incident exposes a *class* of failure a gate could have caught (not a one-off), the remediation should frequently be a new required check — a regression test promoted to required, a new lint rule, a new policy check. This is how the required set *learns*. The discipline is restraint: add a gate for a *class*, not for every individual postmortem, or you'll "everything-required" your way into the flaky-tax death spiral (see War Stories). The bar for *adding* a required gate is the same inclusion test you use everywhere (Decision Frameworks): deterministic, fast enough, actionable, and catching a real, recurring class.

> **The professional reality:** the required set is a living portfolio with a **review cadence**, not a monument. Gates that never catch anything get removed (they tax every PR and erode trust by implying value they don't deliver); new incident *classes* earn new gates. The two failure modes are symmetric and both common: the museum of dead gates nobody dares delete, and the static set that keeps letting the same incident recur. Curate against both. See [gate design](../05-gate-design-speed-vs-safety/professional.md) for the design side of this loop.

---

## Core Concept 6 — Standardization vs Team Autonomy, and the Audit Dividend

The central organizational tension in governing required checks is **standardization vs team autonomy**. Push too far toward standardization and you get a rigid one-size-fits-all set that's wrong for half your repos — a data-pipeline repo and a customer-facing service have genuinely different risk profiles — and teams resent and route around it. Push too far toward autonomy and you get a thousand snowflakes, no consistency, repos with *nothing* required, and an audit that takes a quarter because every repo is different.

The resolution is the **paved-road / baseline-plus-extensions** model from Core Concept 1, applied as an org principle: the platform team owns a *small, defensible, non-negotiable baseline* (lint, unit, secret-scan, one review) that every repo gets for free and cannot remove; teams own *everything above the floor* — their E2E suite, their contract tests, their stricter coverage thresholds. Standardize the floor and the *shape* (how checks are declared, how waivers work, how the dashboard reports); let teams own the *ceiling*. The baseline is small precisely so it's defensible org-wide; the extension mechanism is what preserves autonomy.

**The audit dividend.** A consistent, policy-as-code required set is not just an engineering nicety — it's a direct, dollar-valued **compliance asset**. SOC 2, ISO 27001, and FedRAMP-adjacent frameworks all require *evidence of change control*: that production changes are reviewed and pass defined quality gates. When your required set is:

- **Consistent** across repos (the same baseline everywhere, by ruleset/framework),
- **Version-controlled** (the policy is in git, with history),
- **Auditable** (the audit log shows every change to the required set; the merge log shows every PR passed it),

then "prove every production change passed required checks" is a *query*, not a quarter of screenshotting per-repo settings. The org-wide ruleset *is* the control; the audit log and merge history *are* the evidence. Teams with clicked, per-repo, inconsistent protection turn each audit into an archaeology project; teams with policy-as-code required sets hand the auditor a generated report.

> **The professional reality:** the answer to standardization-vs-autonomy is **a small standardized floor plus team-owned extensions**, expressed as code. That single design choice resolves the cultural tension (teams keep their ceiling), delivers consistency (everyone gets the floor), *and* turns compliance from a recurring fire drill into a generated report. The required set is simultaneously a quality control, a developer-experience surface, and an audit artifact — govern it as all three.

---

## War Stories

**The renamed job that un-gated 300 repos.** A platform team renamed a shared CI job from `test` to `ci/test` to namespace it. Branch protection on hundreds of repos still required the status context named `test` — which no longer reported, because the job was now `ci/test`. GitHub's required-status-check matching is *by exact context name*: a required check that never reports is, by default, simply *absent* from the merge gate rather than a hard block. So for ~300 repos the test gate silently evaporated. Nobody noticed until a PR that broke the build sailed straight into `main` because "required tests" weren't actually required anymore. The lesson burned into the team: **status-check names are a contract**, renaming one is a breaking change to every consumer's branch protection, and you migrate it like an API — add the new name as required *alongside* the old, cut over, then remove — and you *alert on required checks that stop reporting*, because silent absence is the default failure mode.

**The flaky E2E suite that normalized admin-merge.** A team's required end-to-end suite flaked on roughly one run in eight. Re-running took 25 minutes. Rational engineers did the rational thing: when it went red and they were "sure" their change was fine, they used admin-merge to bypass it. Within a quarter, admin-merge was the *normal* way to merge, not the exception — the required E2E gate had trained the team to ignore it. Then a genuinely broken change went out via the now-reflexive admin-merge and caused an incident. The fix wasn't "tell people to stop bypassing" — it was to *quarantine* the flaky tests out of the required set (advisory + owner SLA), shrink the blocking E2E to a deterministic smoke subset, and remove admin-merge as an option. The deeper lesson: **a flaky required check doesn't just fail to add safety, it actively manufactures a bypass culture** that then defeats the gates that *do* work.

**The 45-minute pipeline that tanked deploy frequency.** A monorepo's required PR pipeline grew, one well-meaning gate at a time, to 45 minutes. Engineers stopped waiting; they batched changes into large PRs to amortize the tax, which made reviews slower and riskier, and deploy frequency quietly fell by more than half over two quarters. Leadership's instinct was to add *more* checks ("quality is slipping"). The actual fix was the opposite: **Test Impact Analysis** (run only tests the diff affects) plus a **remote build cache** cut the required path from 45 minutes to ~6, and slow suites moved to the merge queue and nightly. Deploy frequency recovered within a quarter. The lesson: **"our checks are slow" is a deploy-frequency problem in disguise**, and the lever is caching + TIA + tiering, not exhortation — and not more gates.

**The push-protection rollout that caught a live AWS key.** A platform team enabled secret-scanning *push protection* org-wide — rejecting any push containing a detected high-entropy credential *before it lands on the remote*. There was the usual grumbling about friction. Three weeks in, push protection blocked a commit containing a *live, active AWS access key* a developer was about to push to a repo with external collaborators. Because it was caught pre-push, the key never reached the remote, so it never had to be treated as compromised and rotated under incident pressure — the developer just moved it to a secrets manager and re-pushed. One prevented leak paid for the entire rollout's friction. The lesson: **secret scanning's ROI lives in *push protection*, not detection** — a secret that reaches the remote, even for a minute, is a rotation incident; one that's blocked pre-push is a non-event.

**The "everything required" repo that trained blind retries.** A high-stakes repo, in an admirable but misguided effort to be safe, made *everything* required: a dozen-plus independent checks, several with a few percent flake each. The compound spurious-red rate (`1 − (1 − p)^k`) sat around 20% — one in five correct PRs blocked by pure noise. The org adapted exactly as the math predicts: they stopped reading CI failures and developed a reflex to **blind-retry until green**. At that point the required set was decorative — nobody was reading the results it produced, including the *real* failures. The fix was to *prune and tier*: a small deterministic blocking set on PR, the rest demoted to advisory or moved off the inner loop. The lesson: **"required" has a budget**, and spending it on flaky or low-value checks doesn't buy safety — it buys a population trained to ignore the very signal the gates exist to send.

---

## Decision Frameworks

**Required vs advisory — the inclusion test.** A check earns *required* (blocking) status only if it passes *all four*. Fail any one, and it belongs in advisory.

| Test | Question | If "no" → advisory |
|---|---|---|
| **Deterministic** | Same code → same result, every time? | Flaky check trains the org to ignore red |
| **Fast enough** | Within the repo tier's speed budget? | A slow gate taxes every PR and pushes toward big-batch PRs |
| **Actionable** | Can the author *fix it themselves* from the failure? | A gate you can't act on just teaches bypass |
| **High-value** | Catches a real, recurring class of defect? | A gate that never catches anything is dead weight |

**Block vs warn for security findings.** Proportionality beats all-or-nothing.

| Finding class | Default | Why |
|---|---|---|
| Secret in diff (live credential) | **Block (push protection)** | Cheap to fix, catastrophic to leak, low false-positive |
| Critical/High SAST in *new* code (diff-scoped) | Block | New, severe, scoped — defensible and rare |
| Medium/Low SAST | Warn / advisory | High false-positive rate; blocking → bypass culture |
| Dependency CVE — critical, fix available | Block | Actionable: there's a version to bump |
| Dependency CVE — no fix / transitive | Warn + ticket | Can't fix it → blocking only teaches bypass |
| License violation (copyleft in proprietary) | Block | Legal, binary, not a judgment call |
| Pre-existing backlog findings | Warn (never block) | "Don't make it worse" is enforceable; "fix history" is not |

**Per-repo vs org-ruleset governance.** Where should this control live?

| Situation | Choose | Rationale |
|---|---|---|
| Non-negotiable org floor (lint, unit, secret-scan, 1 review) | **Org ruleset / compliance framework** | Consistency + audit; teams can't silently remove it |
| Domain-specific gate (this service's E2E, contract tests) | Per-repo ruleset (extends baseline) | Team owns the ceiling; floor stays intact |
| Compliance-mandated control across all repos | Org ruleset, Terraform-managed | The ruleset *is* the control; audit log *is* the evidence |
| One repo needs a temporary exception | Waiver-as-code (expiring, reviewed) | Auditable, reversible — not a silent admin-merge |
| Experiment / sandbox repos | Exclude from baseline by pattern | Don't tax throwaway work; keep the floor for real repos |

**Flaky check — retry vs quarantine vs delete.** Match the action to the test's value and flake severity.

| Situation | Action | Rationale |
|---|---|---|
| Rare flake, high-value test, root cause known & fixable now | **Fix it** | The only true resolution; everything else is a holding action |
| Flake under threshold, transient infra cause | Bounded auto-retry (1–2×) | Cheap masking for genuine infra noise — *not* a substitute for fixing real flake |
| Over flake threshold, valuable test, no immediate fix | Quarantine (→ advisory) + owner + SLA | Stops blocking merges without losing the test or silently dropping coverage |
| Past quarantine SLA, still unfixed | **Delete it** | A test you won't fix is lying to you; it's net-negative |
| Low-value test that's also flaky | Delete now | Not worth the deflake cost; remove the noise |

**Required-check speed budget by repo tier.** Set the p95 SLO by what the repo costs to get wrong.

| Repo tier | Required-check p95 target | What's required on PR | What moves off the inner loop |
|---|---|---|---|
| Tier-1 service (customer-facing, frequent deploys) | **≤ 10 min** | lint, type, unit (TIA), secret-scan, integration-smoke | full E2E, load → merge queue / nightly |
| Tier-2 service (internal, moderate deploys) | ≤ 15 min | lint, type, unit, secret-scan | E2E, contract → merge queue |
| Library / SDK (correctness-critical, infrequent) | ≤ 20 min | lint, type, full unit, API-compat, secret-scan | cross-version matrix → nightly |
| Data pipeline / batch (no live traffic) | ≤ 25 min | lint, unit, schema-check, secret-scan | full-data integration → scheduled |
| Sandbox / experiment | best-effort | secret-scan only | everything else optional |

---

## Mental Models

- **"Required" is a budget, and flake spends it.** Every blocking check taxes every PR and stakes some of the org's trust. Spend the budget on deterministic, high-value checks; spend it on flaky or pointless ones and you buy a population trained to ignore red.

- **A flaky required check is worse than no check.** No check is honest about its absence. A flaky required check actively teaches the org that red doesn't mean broken — and that lesson defeats the gates that *do* work. Near-deterministic, or not required.

- **Status-check names are an API.** Branch protection matches required checks by exact context name, and a required check that never reports silently *vanishes* from the gate. Rename a job like you'd rename a public endpoint: dual-publish, cut over, retire — and alert when a required check stops reporting.

- **Speed is a feature you have to fund.** "Our checks are slow" is a deploy-frequency problem wearing a CI costume. p95 of the required path is a platform SLO; remote caching, TIA, and gate tiering are the investments that defend it. It doesn't get fast by accident.

- **Platform owns the floor; teams own the ceiling.** A small non-negotiable baseline everywhere, plus team-owned extensions, resolves standardize-vs-autonomy — and as a side effect turns the audit into a generated report.

- **Roll security gates out in three gears.** Dry-run to learn the volume, advisory to build context, enforce once it's high-signal and diff-scoped. Jumping straight to enforce builds the gate everyone ignores.

- **The required set is a portfolio, not a monument.** Review it on a cadence: prune gates that never catch anything, add gates for new incident *classes*. Both the museum-of-dead-gates and the never-learns-from-incidents failure modes are common.

---

## Common Mistakes

1. **Per-repo clicked branch protection at org scale.** Unknowable, un-reviewable, un-rollback-able, and an audit nightmare. Move the required set to org rulesets / compliance frameworks / Terraform so it's consistent, version-controlled, and auditable — the foundation for [policy as code](../06-policy-as-code/professional.md).

2. **Tolerating flaky required checks.** A flaky required check is worse than none — it trains the org to blind-retry and ignore red, defeating the gates that work. Run a real deflake program: dashboard, quarantine automation, owner SLAs, a quarantine budget, and a deletion deadline.

3. **Letting the required path grow unbounded.** The 45-minute pipeline pushes engineers toward big-batch PRs and tanks deploy frequency. Track required-check p95 as an SLO; invest in remote caching, TIA, and gate tiering. Speed is funded, not hoped for.

4. **Flipping security gates straight to enforce, org-wide.** A wave of pre-existing low-severity findings blocks everyone and breeds a bypass culture — the gate everyone ignores. Stage it: dry-run → advisory → enforce, diff-scope to new findings, triage centrally, severity-route the blocks.

5. **Treating status-check names as cosmetic.** Renaming a required job silently un-gates every repo that required the old name. Names are a contract: dual-publish on rename, and alert when a required check stops reporting (silent absence is the default failure).

6. **Never reviewing the required set.** Gates that never catch anything become dead weight that taxes every PR and erodes trust; missing gates let the same incident recur. Run a quarterly cadence: prune low-catch/high-override gates, add gates for new incident *classes* — see [gate design](../05-gate-design-speed-vs-safety/professional.md).

7. **One-size-fits-all required sets.** A rigid org-wide set is wrong for half your repos and gets routed around. Standardize a small floor; let teams extend per tier. Floor for consistency, ceiling for autonomy.

8. **Exceptions via silent admin-merge.** Unlogged bypasses are invisible to incident response *and* to auditors. Make exceptions waivers-as-code: reviewed, expiring, attributed.

---

## Test Yourself

1. A required CI job is renamed from `test` to `ci/test`. Explain precisely why this can silently un-gate hundreds of repos, and describe the safe migration plus the alarm you'd add.
2. Ten independent required checks each flake at 2%. What fraction of *correct* PRs gets a spurious red, and what behavior does that train in the org? Give the formula.
3. Quantify the flaky tax for an org doing 500 PRs/day with a 15% spurious-red rate and ~15 minutes lost per incident. What program turns that number down, and what two governance mechanisms keep quarantine from becoming a graveyard?
4. Your monorepo's required PR pipeline takes 45 minutes and deploy frequency is falling. Diagnose the causal chain and name the three highest-ROI levers to climb out, in order.
5. You're rolling SAST out to a thousand repos. Describe the staged rollout and the *one* scoping decision that makes "enforce" survivable on day one.
6. Give the four-part inclusion test that decides whether a check is *required* vs *advisory*, and explain why a flaky-but-high-value check fails it.
7. Why is a consistent, policy-as-code required set a *compliance* asset and not just an engineering nicety? What specifically becomes a query instead of a fire drill?
8. Secret scanning *detection* vs *push protection*: why is the ROI argument for push protection categorically stronger?

<details>
<summary>Answers</summary>

1. Branch protection matches required status checks **by exact context name**. After the rename, repos still require the context `test`, but nothing reports `test` anymore (the job now reports `ci/test`). GitHub's default behavior for a required check that never reports is to treat it as *absent* from the gate rather than a hard block — so the gate silently evaporates for every repo that required the old name. **Safe migration:** add `ci/test` as required *alongside* `test`, let both report through a cutover window, then remove `test` — i.e., treat the name like a public API and dual-publish. **Alarm:** monitor required checks for *non-reporting* and alert when one stops appearing, because silent absence is the default failure mode.
2. `1 − (1 − 0.02)^10 ≈ 0.183` → about **18% of correct PRs** get a spurious red. It trains the org that **red doesn't mean broken — just retry**, so people stop reading CI failures (including the real ones), and the required set becomes decorative.
3. `500 × 0.15 × 15 min = 1125 min/day ≈ 18.75 engineer-hours/day` — over two FTEs burned daily on retrying CI. A **deflake program** turns it down: detect (flaky telemetry/dashboard) → rank by spurious-failures × blast radius → quarantine over-threshold tests to advisory with an auto-filed ticket → owner + fix-or-delete SLA → return-to-required or delete. The two mechanisms that stop quarantine becoming a graveyard: a **quarantine budget** (cap on how much can be parked) and a **deletion deadline** (past SLA → deleted), plus attribution so the cost competes fairly with feature work.
4. **Chain:** 45-min tax → engineers stop waiting and batch into big PRs to amortize it → big PRs are slower/riskier to review → review latency and context-switching rise → deploy frequency falls → org adds *more* gates → worse. **Levers, in order:** (1) **remote build cache** (fetch unchanged targets instead of rebuilding), (2) **Test Impact Analysis** (run only tests the diff affects), (3) **tier the gate** (fast checks required on PR; heavy E2E/load to merge queue/nightly). Measure with required-check **p95**.
5. **Staged:** dry-run (report to dashboard, block nothing — learn the volume and false-positive rate) → advisory (comment on PRs for context) → enforce (block). **The scoping decision:** **diff-scope to *new* findings** — block only what the PR introduces, never the pre-existing backlog. "Don't make it worse" is enforceable and politically survivable on day one; "fix all history" is neither. Also triage centrally and severity-route the blocks.
6. **Deterministic, Fast-enough, Actionable, High-value** — all four required for *required* status. A flaky-but-high-value check fails **Deterministic**: even though it catches real bugs, its spurious reds train the org to ignore red, which defeats *every* gate. Quarantine it (advisory) and fix it; don't keep it blocking.
7. SOC 2 / ISO 27001 / FedRAMP-adjacent frameworks require **evidence of change control** — that production changes are reviewed and pass defined gates. A required set that is consistent (same baseline everywhere via ruleset), version-controlled (policy in git with history), and auditable (audit log shows changes to the required set; merge log shows every PR passed it) makes "prove every production change passed required checks" a **generated report / query**. With clicked per-repo config it's a quarter of per-repo screenshotting — a fire drill.
8. **Detection** finds a secret *after it's reached the remote* — at which point the credential must be treated as compromised and **rotated under incident pressure**, regardless of cleanup. **Push protection** rejects the commit *before it lands*, so the secret never reaches the remote and never becomes a rotation incident — a non-event instead of an incident. Plus the false-positive rate on high-entropy provider patterns (AWS/GitHub/Stripe) is low enough to block by default, so the friction is minimal. Prevention of an incident beats detection of one.

</details>

---

## Cheat Sheet

```
GOVERNANCE (consistent, version-controlled, auditable)
  org ruleset / compliance framework   one baseline → ~ALL repos, by pattern
  Terraform repo config                protection IS code: reviewed, diffed, history
  model: platform owns FLOOR, teams extend CEILING
  exceptions = waivers-as-code         reviewed, expiring, attributed (NOT admin-merge)

FLAKY TAX  (a flaky required check is WORSE than no check)
  P(spurious red) = 1 − (1 − p)^k      10 checks @ 2% ≈ 18% of correct PRs blocked
  cost/day = PRs × P(red) × min_lost   put a $ on it → it gets budget
  program: detect → rank → quarantine(+owner+SLA) → fix-or-DELETE
  guards: quarantine BUDGET + deletion DEADLINE (else it's a graveyard)

SPEED BUDGET (a platform SLO, tied to deploy frequency)
  track: required-check p95 (not p50) by repo tier
  levers (ROI order): remote cache > Test Impact Analysis > runner fleet > TIER the gate
  tier: fast(lint/type/unit-TIA/secret) on PR | heavy(E2E/load) → merge queue / nightly
  "45-min checks" = a deploy-frequency problem in disguise

SECURITY GATES (high-signal or ignored)
  rollout: dry-run → advisory → enforce
  diff-scope: block NEW findings, never the backlog ("don't make it worse")
  triage centrally; severity-route; waivers expiring + reviewed
  BLOCK: secret-in-diff (push protection), critical/new SAST, fixable critical CVE, license
  WARN : medium/low SAST, unfixable/transitive CVE, pre-existing backlog

REVIEW CADENCE (portfolio, not monument) — quarterly
  per gate: catch_rate, flake_rate, override_rate, p95_added
  KEEP high-catch/low-flake | DEMOTE low-catch/low-cost | DELETE low-catch/high-override
  ADD a gate per new incident CLASS (not per postmortem)

NAMES ARE AN API
  required checks match by EXACT context name; non-reporting = silently absent
  rename → dual-publish → cut over → retire; ALERT on required checks that stop reporting

AUDIT DIVIDEND
  consistent + version-controlled + auditable required set
  → "prove every prod change passed required checks" = a query, not a quarter
```

---

## Summary

- **Govern the required set as policy, not clicks.** Org rulesets / compliance frameworks / Terraform make it **consistent, version-controlled, and auditable**; the platform owns a small non-negotiable floor and teams extend the ceiling; exceptions are reviewed, expiring **waivers-as-code**, not silent admin-merges — the bridge to [policy as code](../06-policy-as-code/professional.md).
- **The flaky tax is real, large, and quantifiable.** `1 − (1 − p)^k` spurious-red compounds fast; put engineer-hours and dollars on it. Run a deflake program (dashboard, quarantine automation, owner SLAs) with a **quarantine budget** and a **deletion deadline** — a flaky required check is *worse* than no check because it trains the org to ignore red.
- **Speed is a platform SLO tied to deploy frequency.** Track required-check **p95** by repo tier; climb out of the 45-minute death spiral with **remote caching + Test Impact Analysis + gate tiering**. Slow checks aren't a CI annoyance — they're a deploy-frequency problem you have to fund your way out of (see [engineering metrics](../../engineering-metrics-and-dora/)).
- **Roll out security gates so the org trusts them.** Dry-run → advisory → enforce, **diff-scope to new findings**, triage centrally, severity-route the blocks (secrets via push protection and criticals-in-new-code block; low-severity warns). The failure mode is the gate everyone ignores — see [gate design](../05-gate-design-speed-vs-safety/professional.md).
- **Curate the required set on a cadence.** Prune gates that never catch anything (dead weight that erodes trust); add gates for new incident *classes*. It's a living portfolio, not a monument.
- **Standardize the floor, let teams own the ceiling** — and bank the **audit dividend**: a consistent, policy-as-code required set turns "prove every production change passed required checks" from a quarter-long fire drill into a generated report.

You can now govern the required set across an org as a quality control, a developer-experience surface, an economic decision, and an audit artifact at once. The remaining tier — [interview.md](interview.md) — consolidates the topic into the questions that probe whether someone has actually run a required set at scale.

---

## Further Reading

- [GitHub repository rulesets and organization rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets) — org-wide required checks, layering, bypass, and the audit log that backs governance.
- [GitHub secret scanning push protection](https://docs.github.com/en/code-security/secret-scanning/push-protection-for-repositories-and-organizations) — blocking secrets before they reach the remote, and why that's the ROI win.
- [Google's "Flaky Tests at Google and How We Mitigate Them"](https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html) and the broader Google Testing Blog — quarantine, detection, and the engineering economics of flake.
- Uber, Dropbox, and Spotify engineering posts on flaky-test programs and Test Impact Analysis at scale — concrete deflake automation and TIA case studies.
- *Accelerate* (Forsgren, Humble, Kim) and the DORA reports — the empirical link between **fast feedback / lead time** and delivery performance that justifies the speed budget.
- [`interview.md`](interview.md) — the questions that probe whether someone has truly governed a required set across many repos, not just configured one.

---

## Related Topics

- [02 — Branch Protection & Merge Policies](../02-branch-protection-and-merge-policies/professional.md) — the merge-gate mechanics and merge-queue behavior that required checks plug into.
- [05 — Gate Design: Speed vs Safety](../05-gate-design-speed-vs-safety/professional.md) — the design calculus behind which checks block, which warn, and the review cadence.
- [06 — Policy as Code](../06-policy-as-code/professional.md) — expressing the required set, baselines, and waivers as version-controlled, auditable policy.
- [Security](../../../../Security/) — the SAST/secret/dependency/SCA gates whose org rollout this page governs.
- [Testing](../../testing/) — the test suites (unit, integration, E2E) whose speed, flake, and tiering define the required set.
