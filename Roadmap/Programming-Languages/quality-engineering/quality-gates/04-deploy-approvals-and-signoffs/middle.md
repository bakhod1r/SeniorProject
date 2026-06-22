# Deploy Approvals & Sign-offs — Middle Level

> **Roadmap:** [Quality Gates](../README.md) → Deploy Approvals & Sign-offs
> *The junior page asked "who clicks deploy?" This page asks the harder questions: what does the approval mechanism actually enforce, who is allowed to be that person, how do you prove it to an auditor a year later — and which of these approvals are catching anything at all versus just adding a day to lead time?*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Approval Mechanics Across Platforms](#core-concept-1--approval-mechanics-across-platforms)
5. [Core Concept 2 — Environment Promotion and Per-Stage Gates](#core-concept-2--environment-promotion-and-per-stage-gates)
6. [Core Concept 3 — Separation of Duties](#core-concept-3--separation-of-duties)
7. [Core Concept 4 — Audit Trails and Sign-offs](#core-concept-4--audit-trails-and-sign-offs)
8. [Core Concept 5 — The CAB Critique and Manual vs Automated Gates](#core-concept-5--the-cab-critique-and-manual-vs-automated-gates)
9. [Core Concept 6 — Canary Metrics as an Automated Approver](#core-concept-6--canary-metrics-as-an-automated-approver)
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

> Focus: **What does a deploy approval actually enforce, who is allowed to give it, how is it proven afterwards, and when is a human the wrong gate?**

At the junior level, a deploy approval is one button: someone with the right permission clicks "Approve" and the pipeline continues. That button is real, but it is the visible tip of four separate machines. The first is the **approval mechanic** — the platform-specific way a pipeline pauses, waits for a signal, and resumes (and what it gates: secrets, branches, a specific artifact). The second is **separation of duties (SoD)** — the rule that the person who *wrote* the change cannot be the person who *approves shipping* it, which is both an engineering check and a hard compliance requirement under SOC 2, SOX, and PCI. The third is the **audit trail** — the immutable record that, a year from now, answers an auditor's single question: *show me that a separate, authorized person approved this exact production change.* The fourth is the **judgement** behind the gate — whether a human pausing here is catching real defects or just performing change-management theatre.

This page does three things. First, it makes the mechanics concrete across the platforms you will actually meet: GitHub Environments, GitLab protected environments, Argo CD / Argo Rollouts, and Spinnaker. Second, it formalizes SoD and audit so you can pass a compliance review *automatically* instead of by screenshot. Third — and this is the part that separates a senior engineer from a checkbox-filler — it confronts the DORA finding that heavyweight, external change-approval boards correlate with **worse** lead time and **no better** change-fail rate, and gives you the rule for deciding what a human should gate and what an algorithm should.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can explain why a deploy gate is a pipeline *pause*, not a code check.
- **Required:** You understand required status checks and branch protection from [01 — Required CI Checks](../01-required-ci-checks/middle.md) and [02 — Branch Protection & Merge Policies](../02-branch-protection-and-merge-policies/middle.md).
- **Helpful:** You've waited on (or clicked) a deploy approval in GitHub Actions, GitLab, or Argo at least once.
- **Helpful:** You know what a canary release is (covered in [Release Engineering](../../release-engineering/)).

---

## Glossary

- **Deploy approval** — a required human (or automated) sign-off that gates a deployment job, pausing the pipeline until the signal is given.
- **Environment (CD sense)** — a named deploy target (`dev`, `staging`, `production`) with its own protection rules, secrets, and approvers. Not a runtime environment variable.
- **Protection rule** — a per-environment policy: required reviewers, a wait timer, an allowed-branch list, or a gating job that must pass before the environment can be deployed to.
- **Promotion** — advancing the *same already-built artifact* from one environment to the next (`staging` → `production`). Distinct from a redeploy/rebuild.
- **Separation of duties (SoD)** — the control that the author of a change is not its sole approver/deployer; an independent person must sign off.
- **Audit trail** — the immutable, queryable record of *who* approved *which artifact/SHA* into *which environment*, *when*, and *why*.
- **Change Advisory Board (CAB)** — an ITIL committee that reviews and authorizes changes before they go to production.
- **Automated gate** — a machine-decided approval: tests pass, policy evaluates clean, canary metrics stay within SLO. No human in the loop.
- **Canary analysis** — automated promotion/abort of a release based on live SLO metrics from a small slice of traffic (Argo Rollouts `AnalysisRun`, Flagger).
- **Change freeze / deployment window** — a period (e.g. Black Friday, end of quarter) during which non-emergency deploys are blocked.
- **Break-glass** — the audited, time-boxed path to bypass a gate in an emergency (covered in [07 — Break-glass & Bypass](../07-break-glass-and-bypass/middle.md)).

---

## Core Concept 1 — Approval Mechanics Across Platforms

Every platform implements the same underlying model: a deploy job **declares a dependency on a gate**, the runner **pauses** when it reaches that job, and the job **resumes** only when an authorized signal arrives. What differs is *what the gate also protects* and *who can give the signal*. Read each config below as a set of "this deploy cannot proceed unless…" claims.

**GitHub Environments.** Protection lives on the *environment*, not the workflow. A job that targets a protected environment cannot start until its rules clear — and crucially, **environment secrets are unreadable until approval is granted**, so an approval gates not just execution but access to production credentials.

```yaml
# A job pinned to the "production" environment.
# The reviewers/wait-timer/branch-policy are configured ON the
# environment (Settings → Environments), not in this YAML.
jobs:
  deploy-prod:
    runs-on: ubuntu-latest
    environment:
      name: production
      url: https://app.example.com
    steps:
      - uses: actions/checkout@v4
      - run: ./deploy.sh
        env:
          # Only injected AFTER a required reviewer approves.
          DEPLOY_TOKEN: ${{ secrets.PROD_DEPLOY_TOKEN }}
```

The environment itself carries three rules: **required reviewers** (up to 6 users/teams; any one — or all, depending on config — must approve), a **wait timer** (a forced delay, e.g. 30 minutes, before the deploy can even be approved — a cheap canary-soak proxy), and **deployment branch policies** (only `main` or `release/*` may deploy here, so a feature branch can never reach production).

> **Key insight:** On GitHub, the approval gates *the secret*, not just the step. A reviewer who approves a production deploy is implicitly authorizing the release of the production deploy token to that run. That is why the approver list and the secret scope must be governed together.

**GitLab protected environments + deployment approvals.** GitLab attaches approval rules to a *protected environment*. You can require multiple approvers and require they come from specific groups — which is how SoD is encoded directly in the platform.

```yaml
# .gitlab-ci.yml — the job names an environment...
deploy_production:
  stage: deploy
  script: ./deploy.sh
  environment:
    name: production
    deployment_tier: production
  rules:
    - if: '$CI_COMMIT_BRANCH == "main"'
      when: manual          # pause; requires a human to play the job
```

```yaml
# Protected-environment config (Settings → CI/CD → Protected
# environments, or via API). The job above will block until these
# approval rules are satisfied.
protected_environment:
  name: production
  deploy_access_levels: [maintainer]
  approval_rules:
    - group_id: 42           # the "release-managers" group
      required_approvals: 2  # two distinct approvers from that group
```

**Argo CD / Argo Rollouts.** In GitOps, the "deploy" is a sync to the cluster. A **manual sync** (auto-sync disabled) is itself an approval gate: nothing reaches the cluster until an authorized person clicks *Sync*. For progressive delivery, Argo Rollouts adds an explicit `pause` step — a human (or an automated analysis, see Concept 6) must *promote* before the rollout continues.

```yaml
# Argo Rollouts canary: pause indefinitely for a human promotion.
spec:
  strategy:
    canary:
      steps:
        - setWeight: 20
        - pause: {}          # halts here until `kubectl argo rollouts promote`
        - setWeight: 50
        - pause: { duration: 10m }   # automated timed pause
        - setWeight: 100
```

**Spinnaker.** A pipeline is a sequence of stages; a **Manual Judgment** stage halts execution and presents named options (e.g. *Promote* / *Roll back*) to authorized users, and can be restricted to specific roles. It is the same pause/resume model with a richer decision UI.

The unifying abstraction: **an approval is a job dependency whose upstream producer is a person (or a metric).** Everything else — secrets gating, branch policy, multiple approvers — is configuration layered on that one idea.

---

## Core Concept 2 — Environment Promotion and Per-Stage Gates

A mature pipeline is not one gate before production; it is a *staircase* of environments, each with a gate suited to its risk. The canonical shape:

```text
dev ──▶ staging ──▶ production
 │         │            │
 auto     auto-deploy   manual approval (human judgement)
 deploy   + soak time   + automated canary analysis
 on merge + smoke tests
          (automated approval)
```

The discipline that makes this work is **promotion, not rebuild**: the *exact artifact* (the same image digest, the same SHA) that passed `staging` is the one promoted to `production`. If you rebuild between stages, you have invalidated every test that ran in `staging` — you are now shipping an artifact no gate ever evaluated. Promotion preserves the chain of evidence; redeploy/rebuild breaks it.

Most of this staircase should be **automated approvals**. A smoke-test suite passing in `staging` *is* an approval — it is a machine deciding the artifact is fit to advance. A wait timer enforcing a 30-minute soak *is* an approval — it gives slow-burn failures (memory leaks, connection-pool exhaustion) time to surface before promotion. The single human gate sits at the top of the staircase, where the blast radius is largest and judgement is genuinely required.

> **Key insight:** Promotion is the difference between "we tested *something like* this" and "we tested *exactly this*." Re-building per environment quietly converts a gauntlet of gates into theatre, because the thing you ship in the end was never the thing that passed.

---

## Core Concept 3 — Separation of Duties

**Separation of duties (SoD)** is the control that the person who *authored* a change cannot be the *sole* person who approves shipping it to production. Author ≠ approver ≠ (sometimes) deployer.

There are two independent reasons to enforce it:

1. **Engineering.** A second set of eyes that did not write the code is structurally more likely to notice the missing migration, the wrong feature flag, the secret committed by accident. The author has *attentional blindness* to their own work; an independent approver does not.
2. **Compliance — and this one is non-negotiable.** SoD is an explicit control in the frameworks an enterprise is audited against:
   - **SOC 2 — CC8.1** (change management): the org must demonstrate that changes are authorized, tested, and approved *by someone other than the author* before deployment.
   - **SOX** (for public companies): change-management controls require segregation between development and the ability to promote to production — a developer must not be able to unilaterally push to prod.
   - **PCI-DSS** (Req. 6): separation of duties between development/test and production environments and personnel.

Implementing SoD in the pipeline means encoding it where it *cannot be skipped*, not in a policy document:

```yaml
# GitLab: SoD via group-based approval. The pipeline author is in
# "developers"; the approver must come from "release-managers".
# Even an admin developer cannot self-approve into production.
protected_environment:
  name: production
  approval_rules:
    - group_id: 77            # release-managers (author is NOT a member)
      required_approvals: 1
```

On GitHub, the equivalent levers are required reviewers who are *not* the deploy actor and the "prevent self-review/self-approval" posture; some orgs add a policy-as-code check ([06 — Policy as Code](../06-policy-as-code/middle.md)) that fails the deploy if `actor == commit_author`. The principle holds regardless of platform: **the gate must compare identities and refuse a match.** A control the author can satisfy alone is not a control.

> **Key insight:** SoD is not "two people are nicer than one." It is a *structural* property: the approval must be **un-self-grantable**. If the same identity can both produce the change and authorize it, you have a documented intention, not an enforced control — and an auditor will treat it as the latter.

---

## Core Concept 4 — Audit Trails and Sign-offs

A year after a deploy, an auditor (or an incident reviewer) asks one question: *prove a separate, authorized person approved this exact production change.* A good pipeline answers it in seconds, from data it captured automatically; a bad one answers it with a Slack-thread archaeology dig.

The audit record must be **immutable** and must bind together four facts:

| Fact | Where it comes from |
|---|---|
| **Who** approved | The platform's approval event (user identity, not a shared bot account) |
| **What** was approved | The exact artifact **digest** / commit **SHA** — not "the latest build" |
| **When** | Server-side timestamp on the approval event |
| **Why / linkage** | The change record / ticket the deploy traces to (Jira, ServiceNow) |

The linkage is what makes it auditable: **deploy → change → ticket** must form an unbroken chain. The GitHub deployment API, GitLab deployment records, and Spinnaker execution history all persist who triggered and who approved each deployment; the job is to ensure they capture the *digest* (so the approval can't later be claimed to be of a different build) and a link to the change ticket.

```text
Auditor: "Show me that a separate person approved the 2025-11-04
          production change to the payments service."

Good pipeline answers automatically:
  Deployment  #4821  →  service: payments
  Artifact    sha256:9f3c…a1   (immutable digest)
  Commit      e7b21f4  authored-by: a.dev@corp
  Approved-by r.lee@corp   (release-managers group)   ← ≠ author ✓ SoD
  Approved-at 2025-11-04T14:22:07Z
  Change      CHG-10472  (linked)
```

The bad pipeline cannot answer this because it approved "deploy `main`," logged the click under a shared service account, and kept no link to the build. The fix is not more discipline at deploy time — it is capturing the four facts *as a side effect of the gate*, so being compliant is the path of least resistance.

> **Key insight:** An audit trail is only worth anything if it pins the **artifact identity**. "Person X approved a production deploy" proves nothing if you can't show *which* deploy; "person X approved digest `sha256:9f3c…`" is evidence. Approve digests, not branch names.

---

## Core Concept 5 — The CAB Critique and Manual vs Automated Gates

ITIL's **Change Advisory Board (CAB)** is the heavyweight, recurring committee that reviews and authorizes changes before production — often composed of people who did not write the change and meet on a fixed cadence. It is the instinctive answer to "how do we make deploys safe?" and it is, for most software changes, the wrong one.

The data is unambiguous. The DORA / *Accelerate* research (Forsgren, Humble & Kim) studied change-approval processes across thousands of teams and found that **external, heavyweight change-approval boards correlate with worse lead time *and* no improvement — often a slight worsening — in change-fail rate.** Approval by people distant from the change adds delay without adding safety. What *does* correlate with better outcomes is **lightweight, peer review inside the team** — exactly the [02 — Branch Protection & Merge Policies](../02-branch-protection-and-merge-policies/middle.md) model of required review by people who understand the code.

> **Key insight:** A reviewer's value comes from *understanding the change*, not from *authority over it*. A CAB optimizes for authority and distance; that is precisely the wrong axis. The closer the approver is to the work, the more the approval catches; the further away, the more it is a queue.

This drives the central design decision of this entire topic — **automate what is decidable, reserve humans for genuine judgement:**

| Automate it (machine gate) | Keep a human (judgement gate) |
|---|---|
| Tests pass / coverage threshold met | Novel change with a large, unfamiliar blast radius |
| Policy-as-code evaluates clean | Ambiguous canary signal a metric can't adjudicate |
| Security scan / no critical CVEs | Genuine go/no-go on a high-stakes, irreversible action |
| Canary SLO metrics within bounds | A change touching a system with no good rollback |

Everything in the left column is faster, more consistent, and more honest as code than as a meeting. A human gate is justified only where there is *real* judgement that no rule encodes. Anywhere else, a human gate degenerates into a **rubber stamp** — an approval given without inspection because the approver has no context and no time. A rubber stamp is worse than no gate: it adds latency and manufactures false assurance, and an auditor who learns approvals are reflexive will distrust the whole control.

The senior move is therefore to *delete* gates that are theatre and *strengthen* the few that are judgement — not to add a board because something once broke.

---

## Core Concept 6 — Canary Metrics as an Automated Approver

The most common rubber-stamp gate is "a human stares at a dashboard for ten minutes after the canary goes out, sees nothing obviously on fire, and clicks Promote." That human is a slow, inconsistent, easily-distracted metric evaluator. Replace them with an **automated canary analysis** that promotes or aborts on live SLO data — this is the bridge to [Release Engineering](../../release-engineering/).

Argo Rollouts expresses this as an `AnalysisRun`: a query against your metrics provider (Prometheus, Datadog, CloudWatch) with a pass/fail condition. If error rate stays within bounds, the rollout *promotes itself*; if it breaches, it *aborts and rolls back* — no human, no delay, no ambiguity.

```yaml
# AnalysisTemplate: the automated approver. Promotes if the canary's
# success rate stays ≥ 99%; aborts (rolls back) otherwise.
apiVersion: argoproj.io/v1alpha1
kind: AnalysisTemplate
metadata:
  name: success-rate
spec:
  metrics:
    - name: success-rate
      interval: 1m
      count: 5                 # five samples before deciding
      successCondition: result >= 0.99
      failureLimit: 1          # one bad sample aborts the rollout
      provider:
        prometheus:
          address: http://prometheus.monitoring:9090
          query: |
            sum(rate(http_requests_total{service="payments",code!~"5.."}[2m]))
            /
            sum(rate(http_requests_total{service="payments"}[2m]))
```

```yaml
# Wire the analysis into the canary so it gates promotion automatically.
strategy:
  canary:
    steps:
      - setWeight: 20
      - analysis:
          templates: [{ templateName: success-rate }]   # ← the gate
      - setWeight: 50
      - setWeight: 100
```

Flagger implements the same pattern declaratively for Kubernetes service meshes. The point is identical: **a metric the system already collects is a more reliable approver than a person reading the chart that displays it.** Keep the human for the case the metric can't decide — an ambiguous signal, a novel failure mode — not for the case it decides better than they do.

**Deployment windows and freezes.** Orthogonal to *who* approves is *when* deploys are allowed. A **change freeze** (Black Friday, fiscal close) blocks non-emergency deploys for a period; encode it as a gate that fails outside the window rather than a wiki page everyone forgets. The freeze must have an explicit **break-glass** exception for true emergencies — pre-authorized, logged, and time-boxed — covered in [07 — Break-glass & Bypass](../07-break-glass-and-bypass/middle.md). A freeze with no escape valve gets bypassed informally; a freeze with a governed one stays defensible.

---

## Real-World Examples

**1 — The self-approved hotfix that failed the SOC 2 audit.** A team let any maintainer approve their own production deploy "to move fast." It worked until the SOC 2 auditor sampled ten prod changes and found three approved by their own author. CC8.1 failed. The fix was four lines: a GitLab protected-environment rule requiring one approval from a `release-managers` group the authors weren't in. Lead time was unchanged; the control was now *un-self-grantable* and the next audit passed on the data, no screenshots.

**2 — The CAB that shipped slower *and* broke more.** An org routed every change through a weekly CAB of architects who hadn't seen the code. Lead time for changes grew to a week (you waited for Thursday); change-fail rate did *not* improve, because the board approved on a one-line summary and couldn't catch real defects. They replaced it with in-team peer review (required CODEOWNERS approval) plus automated canary analysis. Deploys went daily; change-fail rate dropped. This is the DORA finding reproduced in one team.

**3 — The dashboard-staring promotion.** A release engineer's job was to watch a Grafana board for ten minutes after each canary and click Promote. One Friday they were in a meeting, glanced, saw green (the error spike was on a panel they'd scrolled past), and promoted a build that took down checkout. The postmortem replaced the human with an Argo Rollouts `AnalysisRun` on the exact SLO; the same scenario the next month *auto-aborted* in 90 seconds. The human gate had been a worse version of a query.

**4 — The freeze with no exit.** A retailer froze all deploys for the holidays — including, by accident, the path to ship security fixes. A critical CVE landed mid-freeze and an engineer pushed it manually via direct cluster access, leaving no audit trail. The freeze was reworked: blocked by default, with a pre-authorized break-glass path that logged who, what, why, and SHA. The next emergency was both *fast* and *auditable*.

---

## Mental Models

- **An approval is a job dependency whose producer is a person (or a metric).** The pipeline pauses on the dependency and resumes when it's satisfied. Everything else — secrets gating, multiple approvers, branch policy — is configuration on that one idea.

- **Promotion preserves evidence; rebuild destroys it.** Ship the *same digest* that passed each stage. The moment you rebuild between environments, every gate it cleared was testing a different artifact, and your staircase of gates becomes theatre.

- **SoD is an un-self-grantable property, not a headcount.** The control is "the same identity cannot both produce and authorize." If the author can satisfy the gate alone, it isn't a control — it's a note.

- **Distance from the change is inversely proportional to the value of the approval.** Peer review (close) catches defects; a distant board (far) adds a queue. Optimize approvers for *understanding*, never for *authority*.

- **A human is a metric-evaluator of last resort.** If a rule can decide it (tests, policy, SLO), the rule is faster and more honest. Spend your scarce human gates only where genuine judgement lives.

---

## Common Mistakes

1. **Approving a branch instead of an artifact.** "Deploy `main`" is unauditable — `main` moves. Approve a specific commit SHA / image digest so the record pins exactly what shipped. Auditors and incident reviewers both need the artifact identity.

2. **Letting the author self-approve.** It feels efficient and fails every change-management control (SOC 2 CC8.1, SOX, PCI). Encode SoD in the platform — group-based approval where the author isn't in the approving group — so it cannot be skipped under deadline pressure.

3. **Rebuilding the artifact per environment.** A rebuild between `staging` and `production` invalidates everything `staging` proved. Promote the tested digest; never re-bake it.

4. **Adding a CAB because something broke.** A heavyweight, external board correlates with *worse* lead time and *no better* change-fail rate (DORA). Strengthen in-team peer review and automate the decidable checks instead.

5. **Keeping a human at a decidable gate.** A person watching a canary dashboard is a slow, error-prone `AnalysisRun`. If a metric can adjudicate it, automate it; reserve humans for genuinely ambiguous, high-blast-radius calls.

6. **Logging approvals under a shared bot account.** "deploy-bot approved" identifies no one and proves no SoD. Capture the *human* identity on the approval event, or the audit trail is worthless.

7. **A freeze with no break-glass.** A change freeze that can't be escaped for a real emergency gets bypassed informally and silently — the worst of both worlds. Pair every freeze with a pre-authorized, logged, time-boxed exception.

---

## Test Yourself

1. Across GitHub Environments, GitLab protected environments, and Argo Rollouts, what is the single shared abstraction behind a deploy approval?
2. On GitHub, an approval gates execution *and* one other thing. What is it, and why does that couple the approver list to something else?
3. What is the difference between *promotion* and *redeploy*, and why does promotion matter for the trustworthiness of your gates?
4. State separation of duties precisely. Which named control in SOC 2 requires it, and what does "un-self-grantable" mean in a pipeline?
5. An auditor asks you to prove a separate person approved a specific prod change from a year ago. What four facts must your audit record bind, and which one is most often missing?
6. Summarize the DORA finding on change-approval boards. What kind of approval *does* correlate with better outcomes?
7. Give the rule for deciding between an automated gate and a human gate, with one example of each.

<details>
<summary>Answers</summary>

1. An approval is a **job dependency whose upstream producer is a person (or a metric)**: the pipeline pauses when it reaches the gated job and resumes only when an authorized signal arrives. Secrets gating, multiple approvers, and branch policy are configuration on that one model.
2. It also gates the **environment secrets** — production deploy credentials are not injected into the run until a reviewer approves. So approving a deploy implicitly authorizes releasing the prod token to that run, which is why the approver list and the secret scope must be governed together.
3. **Promotion** advances the *same already-built artifact* (same digest/SHA) to the next environment; **redeploy/rebuild** produces a new artifact. Promotion matters because it preserves the chain of evidence — the thing you ship is the thing every gate evaluated. Rebuilding invalidates all prior testing.
4. SoD: the author of a change cannot be its sole approver/deployer; an independent, authorized person must sign off. **SOC 2 CC8.1** (change management) requires it (also SOX and PCI). "Un-self-grantable" means the same identity *cannot* both produce the change and authorize it — enforced, e.g., by requiring approval from a group the author isn't in.
5. **Who** approved (human identity), **what** (the exact artifact digest/SHA), **when** (server timestamp), and **why/linkage** (the change ticket). The most-often-missing one is the **artifact identity** — records say "approved a prod deploy" but can't show *which*, so they prove nothing.
6. External, heavyweight change-approval boards correlate with **worse lead time** and **no better (often slightly worse) change-fail rate** — approval by people distant from the change adds delay, not safety. **Lightweight, in-team peer review** correlates with better outcomes.
7. **Automate what is decidable** (tests, policy-as-code, canary SLO metrics → automated promotion), e.g. an Argo Rollouts `AnalysisRun` that promotes on success rate ≥ 99%. **Reserve a human** for genuine judgement — a novel change with a large blast radius or an ambiguous canary the metric can't adjudicate.

</details>

---

## Cheat Sheet

```text
THE APPROVAL MODEL
  approval = a job dependency whose producer is a person (or a metric)
  pipeline PAUSES at the gated job, RESUMES on the authorized signal

PLATFORM MECHANICS
  GitHub Environments  required reviewers + wait timer + branch policy
                       └ ALSO gates env secrets (approval = token release)
  GitLab protected env approval_rules: group_id + required_approvals (SoD!)
  Argo CD / Rollouts   manual sync = gate; `pause: {}` = promote gate
  Spinnaker            Manual Judgment stage (role-restricted options)

PROMOTION
  promote the SAME digest dev→staging→prod   (NOT rebuild per env)
  rebuild between stages → every prior gate tested a different artifact

SEPARATION OF DUTIES (must be un-self-grantable)
  author ≠ approver ≠ (deployer)
  required by SOC 2 CC8.1 · SOX · PCI-DSS Req.6
  encode in platform: approval from a group the author is NOT in

AUDIT TRAIL — bind four facts, immutably
  WHO (human id) · WHAT (digest/SHA) · WHEN (server ts) · WHY (ticket)
  approve DIGESTS, not branch names ("main" moves → unauditable)

MANUAL vs AUTOMATED
  automate the decidable: tests · policy · canary SLO → auto-promote
  keep a human for: novel/high-blast-radius · ambiguous canary · go/no-go
  CAB (heavyweight/external): worse lead time, no better fail rate (DORA)
  rubber stamp = theatre → delete it

DEPLOY WINDOWS
  freeze blocks non-emergency deploys → MUST have governed break-glass (07)
```

---

## Summary

- A deploy approval is **a job dependency whose producer is a person (or a metric)**: the pipeline pauses and resumes on an authorized signal. GitHub Environments (required reviewers, wait timers, branch policies — *and gated secrets*), GitLab protected environments (group-based approval rules), Argo CD/Rollouts (manual sync, `pause` steps), and Spinnaker (Manual Judgment) all implement that one model with different configuration.
- Production pipelines are a **staircase** of environments, each with a gate matched to its risk — and the artifact must be **promoted**, not rebuilt, so every gate evaluates the same digest and the chain of evidence holds.
- **Separation of duties** — author ≠ approver — is both an engineering check and a hard compliance control (SOC 2 CC8.1, SOX, PCI). It must be encoded as an **un-self-grantable** property in the platform, not asserted in a document.
- An **audit trail** earns its keep only when it binds *who, what (the digest), when, and why* immutably — captured as a side effect of the gate so passing an audit is automatic. Approve digests, never branch names.
- The DORA evidence is decisive: **heavyweight, external change-approval boards make lead time worse and change-fail rate no better.** Optimize approvers for *closeness to the change*, automate every decidable check, and keep scarce human gates only for genuine, high-stakes judgement — deleting rubber-stamp theatre.
- **Canary metrics are a better approver than a human at a dashboard.** An Argo Rollouts `AnalysisRun` or Flagger promotes/aborts on live SLO data; reserve the human for what the metric can't decide. Pair freezes with a governed break-glass path.

---

## Further Reading

- **GitHub Docs** — *Using environments for deployment* (required reviewers, wait timers, deployment branch policies, environment secrets). The primary source for the GitHub mechanics above.
- **GitLab Docs** — *Protected environments* and *Deployment approvals* (multiple approvers, group-based approval rules).
- *Accelerate* (Forsgren, Humble & Kim) and the **DORA** *"Change Approval Processes"* guidance — the research behind the CAB critique and the case for lightweight peer review.
- **ITIL** change-management / CAB material — read it to understand the model the DORA evidence argues against, not as a prescription.
- **Argo Rollouts** *Analysis & Progressive Delivery* docs and **Flagger** docs — automated canary analysis as an approver.
- *Continuous Delivery* (Humble & Farley) — the deployment pipeline, promotion, and gate placement.
- [senior.md](senior.md) — designing the gate portfolio: deletion criteria, policy-as-code SoD enforcement, regulated-environment audit, and the economics of gate cost vs signal.

---

## Related Topics

- [02 — Branch Protection & Merge Policies](../02-branch-protection-and-merge-policies/middle.md) — the lightweight, in-team peer-review model that DORA shows outperforms distant approval boards.
- [05 — Gate Design: Speed vs Safety](../05-gate-design-speed-vs-safety/middle.md) — the cost/signal framework for deciding which approvals are worth their latency.
- [07 — Break-glass & Bypass](../07-break-glass-and-bypass/middle.md) — the governed exception path for emergencies and freeze windows.
- [Release Engineering](../../release-engineering/) — canary releases, progressive delivery, and rollback that automated approval gates build on.
- [Security](../../../../Security/) — the compliance frameworks (SOC 2, SOX, PCI) and access controls behind separation of duties and audit.
