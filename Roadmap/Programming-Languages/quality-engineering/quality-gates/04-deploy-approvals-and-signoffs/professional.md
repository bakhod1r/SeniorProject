# Deploy Approvals & Sign-offs — Professional Level

> **Roadmap:** [Quality Gates](../README.md) → Deploy Approvals & Sign-offs
> *The senior page taught you the mechanics of an approval gate. This page is about the staff-level tension underneath it: the org demands a human "go" for safety, the DORA evidence says heavyweight approval hurts throughput without improving stability, and your job is to satisfy the real requirement — control, auditability, segregation of duties — while killing the theatre that pretends to deliver it.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Central Staff Problem: Approval Theatre vs. Real Control](#core-concept-1--the-central-staff-problem-approval-theatre-vs-real-control)
5. [Core Concept 2 — The Playbook: Compliance as a Pipeline Byproduct](#core-concept-2--the-playbook-compliance-as-a-pipeline-byproduct)
6. [Core Concept 3 — Risk-Tiered Approvals and the Pre-Approved Standard Change](#core-concept-3--risk-tiered-approvals-and-the-pre-approved-standard-change)
7. [Core Concept 4 — Separation of Duties at Scale (and the Automation-Identity Question)](#core-concept-4--separation-of-duties-at-scale-and-the-automation-identity-question)
8. [Core Concept 5 — Migrating from Manual Go/No-Go to Automated Promotion](#core-concept-5--migrating-from-manual-gono-go-to-automated-promotion)
9. [Core Concept 6 — Freezes, and Measuring Whether the Gate Catches Anything](#core-concept-6--freezes-and-measuring-whether-the-gate-catches-anything)
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

> Focus: **Designing deploy-approval policy across a real organization — especially a regulated one — so that control and auditability are preserved while the throughput cost of human gates is eliminated where it buys nothing.**

The senior page framed approvals as a gate you configure. At the professional level the same gate shows up in a different set of rooms: a Change Advisory Board meeting that has adjourned a release for the third Tuesday running; a GRC analyst asking "where's your evidence of segregation of duties for SOC 2 CC8.1?"; an incident review where the fix sat for forty minutes because the on-call couldn't get a prod approval at 02:00; a VP who believes — sincerely — that a human approval is what stands between the company and an outage.

The staff problem is not "how do I add an approval." It is that the loudest stakeholders want *more* approval and the evidence says heavyweight approval is, at best, neutral on stability and clearly negative on throughput. The 2019 *Accelerate* / State of DevOps research is blunt: external change-approval processes (a separate approval body, a CAB) have **no correlation with lower change-failure rate**, and they **significantly slow delivery**. Peer review and automated checks correlate with high performance; a board that approves changes it didn't write does not.

So the job is judgment, not configuration. You must separate the *requirement* (control, auditability, separation of duties, evidence on demand) from the *implement­ation everyone defaults to* (a meeting and a signature), then re-implement the requirement with peer review, automated policy gates, and immutable audit — making compliance a continuous byproduct of the pipeline rather than a thing you assemble by hand the week before an audit. This page is that playbook.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — manual vs. automated approvals, environment gates, who-approves-what, the mechanics of a sign-off.
- **Required:** You've operated a release process that someone had to approve, and felt the lead-time cost of waiting on it.
- **Helpful:** You've sat through (or run) a Change Advisory Board, or been audited against SOC 2 / SOX / PCI / ISO 27001.
- **Helpful:** You've shipped via progressive delivery (canary / blue-green) and watched an automated promotion decision happen.
- **Helpful:** You've measured lead time and can decompose it into coding, review, wait, and deploy.

---

## Glossary

| Term | Meaning |
|---|---|
| **CAB** | Change Advisory Board — a recurring meeting (ITIL) that reviews and authorizes changes; the classic heavyweight approval. |
| **Standard change** | An ITIL change type that is pre-authorized, low-risk, and repeatable — deployable *without* per-change approval. The escape hatch most orgs forget exists. |
| **Normal / Emergency change** | ITIL's other two types — normal needs assessment/approval; emergency uses an expedited (break-glass) path. |
| **SoD (Separation of Duties)** | A control requiring that no single person can both author and authorize a change; author ≠ approver. |
| **GRC** | Governance, Risk, and Compliance — the function that owns audit obligations and maps regulations to controls. |
| **SOC 2 CC8.1** | The Trust Services criterion covering change management; the one most deploy-approval discussions trace back to. |
| **SOX ITGC** | IT General Controls under Sarbanes-Oxley; "change management" is a core ITGC for financially-relevant systems. |
| **Provenance / attestation** | Signed, machine-verifiable metadata about *how* an artifact was built and approved (e.g., SLSA, in-toto). |
| **Progressive delivery** | Rolling a change out gradually (canary, blue-green, percentage ramps) with automated promotion based on SLOs. |
| **Break-glass** | A documented, audited emergency bypass of normal controls — see [07](../07-break-glass-and-bypass/professional.md). |
| **Blast radius** | How much breaks if a change is bad — the primary input to how much approval it warrants. |

---

## Core Concept 1 — The Central Staff Problem: Approval Theatre vs. Real Control

Every heavyweight approval process is a proxy for a real requirement. The failure mode is that organizations mistake the proxy for the requirement and defend the *meeting* as if it were the *control*.

Disentangle them. The real requirements behind "we need approvals" are almost always some subset of:

1. **Control** — a change to production is a deliberate act, not an accident.
2. **Auditability** — we can prove, later, who changed what, when, and that it was authorized.
3. **Separation of duties** — the person who wrote the change isn't the only person who blessed it.
4. **Risk awareness** — someone competent considered the blast radius of a risky change.

Now look at what a CAB actually delivers against those. The *Accelerate* research (Forsgren, Humble, Kim) measured it: teams using a formal external change-approval process had **change-failure rates statistically indistinguishable** from teams without one, while their **lead time and deployment frequency were materially worse**. A board of people who did not write the change, reviewing a one-line summary days after the work was done, does not meaningfully assess risk (#4) and does nothing for #1–#3 that a code review didn't already do better.

> **The reframe:** the CAB is not a control. It is a *ritual that signals* control to people who can't see the real controls. The staff move is to make the real controls **visible and provable** — peer review, automated gates, immutable audit — so the ritual becomes redundant and can be retired without anyone feeling less safe.

The control that *does* work is **peer review at merge plus automated policy gates plus immutable audit**. Peer review gives you a competent second set of eyes *on the actual diff* by someone who can read it (#4) and enforces author≠reviewer (#3). Automated gates (tests, security scans, policy checks) catch the regressions a human skimming a summary never would (#1). The immutable audit log of who merged, who reviewed, and which gates passed *is* the auditability (#2) — generated for free, continuously, not assembled in a panic before the auditor arrives.

The theatre isn't harmless. Every approval step is wait-time in your lead time, and wait-time that catches nothing is pure waste. Worse, theatre *trains people to rubber-stamp* — and a rubber stamp is more dangerous than no gate, because it manufactures false confidence. The most dangerous approval is the one everyone trusts and nobody reads.

---

## Core Concept 2 — The Playbook: Compliance as a Pipeline Byproduct

The reason CABs survive is that nobody has shown GRC a *better* way to get the evidence they need. So show them. The playbook is to make every deploy **auto-generate the exact evidence auditors ask for**, so compliance stops being an event and becomes a property of the pipeline.

What an auditor actually wants for change management (SOC 2 CC8.1, SOX ITGC) is a small, specific list:

- Changes are **authorized** before they reach production.
- The **author is not the sole approver** (separation of duties).
- There is a **traceable record** linking the change → who approved → what tested → when deployed.
- **Production access** to deploy is controlled.
- The process is **consistently applied** (no untracked changes).

Every item on that list is producible by the pipeline itself. The translation:

| Auditor's requirement | Manual / CAB implementation | Automated control (the byproduct) |
|---|---|---|
| Change is authorized | CAB meeting + signature | Required PR approval from a CODEOWNER, recorded in VCS |
| Author ≠ approver | Roles in a ticketing tool | Branch protection forbidding self-approval; verified in audit log |
| Traceable change record | Manually-filled change ticket | PR ↔ commit ↔ build ↔ deploy linked automatically (ticket ID in commit, deploy tags the SHA) |
| Tested before deploy | "QA signed off" email | CI status checks required to merge; results attached to the build |
| Controlled prod access | Standing admin list reviewed quarterly | Deploy executed only by the pipeline identity; humans have no standing prod push |
| Consistently applied | Hope, plus a quarterly sample | 100% of deploys go through the pipeline; non-pipeline changes are alertable anomalies |

The decisive shift: the auditor samples a *change*, and instead of you opening a ticketing tool and reconstructing a story, you run one command and hand them a complete, signed evidence package.

```bash
# An "evidence package on demand" — generated, not assembled.
# Given a deployed release, produce everything an auditor samples.
$ deploy-evidence --release v2.41.0
release:        v2.41.0
commit:         3f9a1c2  (signed: yes, key: build-ci)
authored_by:    a.rivera           # the change author
approved_by:    j.okafor, l.tan    # CODEOWNER reviews, both != author  ✅ SoD
ci_gates:       unit ✅  integration ✅  sast ✅  license-scan ✅  iac-policy ✅
deployed_by:    pipeline@ci  (no human had prod push access)
deployed_at:    2026-06-18T14:03Z
linked_ticket:  JIRA-4471
provenance:     slsa-l3 attestation attached (in-toto)
```

This is **policy-as-code** doing the GRC translation. Open Policy Agent (OPA) / Conftest, GitHub branch-protection rulesets, and admission controllers let you encode "no merge without two non-author approvals and a green SAST gate" as a *machine-checked, version-controlled* rule. The policy file *is* the documented control. The CI run *is* the evidence of its operation. You have turned a quarterly fire drill into a query.

> **The principle:** *don't prepare for the audit; make the pipeline continuously audit-ready.* If preparing for SOC 2 takes your team a month, you are doing compliance as a project. If it takes an afternoon because every artifact already carries its own provenance, you are doing it as a byproduct — and you've simultaneously made the CAB redundant, because everything it claimed to provide is now generated automatically and more reliably.

---

## Core Concept 3 — Risk-Tiered Approvals and the Pre-Approved Standard Change

"Every change needs human approval" is the cardinal mistake. It applies the cost of the riskiest change to the safest, and it's the reason throughput craters. The staff design is **risk-tiered**: the amount of human judgment scales with blast radius, and the overwhelming majority of changes — which are small, reversible, and routine — get no meeting at all.

ITIL itself blesses this and almost nobody uses it: the **standard change**. A standard change is one that is *pre-authorized* because it's low-risk, well-understood, and repeatable. The authorization happens **once, for the class of change**, when you define it — not per instance. "Deploy a tested, peer-reviewed service through the canary pipeline" is a textbook standard change. Done right, ITIL gives you exactly the auto-deploy you want; done wrong (treating every deploy as a *normal* change requiring a CAB), it gives you the gridlock everyone associates with it.

The tiering:

| Tier | Example | Control | Human in loop? |
|---|---|---|---|
| **Standard / low-risk** | Routine service deploy; config flag flip behind a kill-switch; copy change | Peer review + automated gates + canary | **No** — pre-authorized, auto-deploys |
| **Normal / medium-risk** | New service; cross-team dependency; a migration with a rollback plan | Peer review + gates + named approver acknowledges | Lightweight — async approval, minutes not days |
| **High blast-radius / novel** | DB schema change without a clean rollback; auth/billing change; first-ever multi-region rollout; a kind of change you've never done | Peer review + gates + explicit human **go/no-go** by an accountable owner | **Yes** — genuine judgment call |
| **Emergency** | Mitigating an active incident | Break-glass path, retroactive review | Expedited — see [07](../07-break-glass-and-bypass/professional.md) |

The design discipline is to make the *tier* a property of the change that the pipeline can largely infer or that the author declares and the policy validates — not a human decision made fresh each time:

```yaml
# risk-tiering as policy: the change's properties select the gate
deploy_policy:
  standard:                       # auto-deploys, no human gate
    requires:
      - peer_review: { approvals: 1, non_author: true }
      - gates: [tests, sast, license]
      - canary: { slo_promotion: true }
    forbids:                      # if any of these, escalate the tier
      - touches: ["**/migrations/**", "**/auth/**", "**/billing/**"]
      - infra_change: blast_radius > region

  high_risk:                      # the small minority that earns a human
    requires:
      - peer_review: { approvals: 2, non_author: true }
      - gates: [tests, sast, license, dast]
      - human_approval: { role: service-owner, reason_required: true }
```

The payoff is enormous because of the distribution: in a healthy org the *vast* majority of changes are standard. Auto-deploying them while reserving human judgment for the genuinely novel few both **raises throughput** (most deploys stop waiting) **and raises stability** (the rare risky change now gets *real* scrutiny instead of being lost in a flood of rubber-stamps). You're not removing the human; you're spending the human's attention where it has signal.

> **The litmus test for a standard change:** *if this change is bad, will an automated gate or the canary catch it before meaningful customer impact, and can we roll it back fast?* If yes, a human approval adds latency and catches nothing — make it standard. If no (irreversible, no automated detection, large blast radius), it's a human judgment call. Risk-tiering is just this question applied honestly and encoded once.

---

## Core Concept 4 — Separation of Duties at Scale (and the Automation-Identity Question)

Separation of duties — author ≠ approver — is the one control auditors will not let you drop, and rightly so: it's the cheapest defense against both honest mistakes and a single compromised or malicious account. The staff challenges are *enforcing it mechanically* and answering the question that breaks naïve readings of SoD: **who "approves" a fully automated continuous deployment, where no human touches the change between merge and prod?**

First, enforce it where it's free — at merge:

| SoD enforcement option | How | Strength | Cost |
|---|---|---|---|
| Required PR review, self-approval disabled | Branch protection: ≥1 approval, author can't approve own PR | Strong, automatic, audited | Near-zero |
| CODEOWNERS-gated review | Approval must come from the owning team, not just anyone | Strong + competent reviewer | Low (maintain CODEOWNERS) |
| Signed commits + signed deploys | Cryptographic proof of who authored / who released | Strong, tamper-evident | Moderate (key management) |
| Deploy identity ≠ author identity | Only the pipeline (a service identity) can push to prod; humans can't | Very strong; removes standing prod access | Moderate (pipeline maturity) |
| Two-person rule for prod release | A second human must trigger/approve the *promotion* (for high-risk only) | Strong; reserve for high tier | High latency — don't use as default |

The deepest point: **the strongest separation of duties is making the deploy identity different from any human's identity.** If only the pipeline can deploy, and the pipeline only runs what passed peer review and automated policy, then *no individual* can unilaterally push code to production — the most malicious-insider-resistant posture there is. Standing human prod-push access is the control weakness; removing it is the upgrade.

Now the automation-identity question. In continuous deployment, the "approval" is not a person clicking a button — and trying to insert one re-creates the rubber-stamp problem. The correct framing for auditors: **the approval is the codified policy plus the provenance.** The change was approved by a human (the peer reviewer, recorded), it satisfied the version-controlled deployment policy (machine-verified, recorded), and the resulting artifact carries a signed attestation of that whole chain (SLSA/in-toto). The *authorization* is real and traceable; it simply happened at review-and-policy time, not as a ceremonial gate at deploy time. SoD is preserved: author ≠ reviewer, and the deployer is a non-human identity acting only on policy-satisfying inputs.

> **Small-team exception, stated honestly.** On a three-person team you may not have a non-author reviewer available for every change at 2 a.m. Don't pretend otherwise to an auditor. The accepted compensating controls: (a) *post-hoc* review — deploy now, mandatory review within 24h, logged; (b) automated gates carry more of the weight since fewer humans are available; (c) an explicit, documented, *time-boxed* solo-deploy policy with full audit. The wrong move is a blanket self-approval that's invisible. SoD's intent is "no unchecked unilateral change" — a small team meets the intent with audited post-hoc review, not by faking a second approver.

---

## Core Concept 5 — Migrating from Manual Go/No-Go to Automated Promotion

The end state for standard changes is no human in the deploy loop at all: the change promotes itself through environments based on SLOs (progressive delivery). But you cannot flip from "a human approves every prod deploy" to "the canary decides" overnight — not because the tech is hard but because *trust* is hard, and the org will revolt at the first incident if you skipped the trust-building path.

The migration is a graduated transfer of trust from human judgment to encoded judgment:

| Stage | What the human does | What's automated | What you're proving |
|---|---|---|---|
| 0. Manual go/no-go | Reads dashboards, decides, clicks deploy | Nothing | (baseline) |
| 1. Checklist → automated checks | Clicks deploy *after* CI is green | The checks the human used to do by eye | The gates catch what the human looked for |
| 2. Automated canary, human promotes | Watches the canary, clicks "promote" | Canary deploy + metric collection | The canary surfaces bad deploys reliably |
| 3. Automated canary, **auto-promote on SLO, human can abort** | Watches; intervenes only to *stop* | Promotion decision (error rate, latency, saturation within SLO) | The SLO gate's decision matches the human's |
| 4. Full auto-promote for standard changes | Nothing (gets paged on rollback) | Deploy + promote + rollback | Trust transferred; human reserved for novel changes |

**What to automate first:** the parts where the human was already just *reading a number against a threshold*. "Is the error rate under 1%? Is p99 latency under 300ms? Did the canary's success rate match baseline?" — those are not judgment; they're comparisons a machine does better and never gets tired doing. Automate those, and you'll find the human "go/no-go" was 90% mechanical threshold-checking and 10% genuine judgment. Keep the human for the 10%.

**The trust-building mechanism is shadow-mode:** run the automated promotion *decision* in parallel with the human for a few weeks, log both, and compare. When the SLO gate would have made the same call as the human N times in a row (and ideally would have *caught* a bad deploy the human waved through), you have the evidence to remove the human — and the data to defend the decision to a nervous VP. You are not asking anyone to *believe* the automation is as good; you're *showing* them it agreed with the human every time and was faster.

**What stays human, permanently:** the genuinely ambiguous — a deploy during a partial outage, a change whose canary signal is noisy or absent (a rarely-hit code path the canary can't exercise), a first-of-its-kind change with no baseline, anything where "is this safe?" requires context the metrics don't contain. Automating *those* is how you get an automated bad decision. The goal isn't zero humans; it's humans only where there's actual judgment to exercise.

```yaml
# Stage 3→4: SLO-based auto-promotion (Argo Rollouts / Flagger style)
canary:
  steps:
    - setWeight: 5
    - analysis:                       # the "approval" is now this gate
        metrics:
          - name: error-rate
            threshold: "< 1%"
          - name: p99-latency
            threshold: "< 300ms"
          - name: success-rate-vs-baseline
            threshold: ">= 0.99"
        failureLimit: 1               # any breach → auto-rollback
    - setWeight: 25
    - setWeight: 50
    - setWeight: 100
  # humans get paged on rollback; humans can abort; humans don't approve each step
```

> **The migration principle:** *automate the threshold-checks first, prove the gate's decisions match the human's in shadow mode, then remove the human — and keep them only for the ambiguous calls metrics can't make.* Trust is earned with logged agreement, not asserted. The org accepts the change because you showed it the gate was right every time, not because you told them to relax.

---

## Core Concept 6 — Freezes, and Measuring Whether the Gate Catches Anything

Two staff responsibilities round out the policy: knowing the true cost of a freeze, and answering — with data — the question that retires unnecessary gates: *does this approval actually correlate with fewer incidents?*

**Freezes.** A change freeze (code freeze, deploy freeze — common around peak retail, end-of-quarter for SOX-relevant systems, or a fragile launch) feels like risk reduction. Its real cost is rarely counted:

- **Batch size explodes.** Two weeks of held changes deploy together when the freeze lifts — the single highest-risk deploy of the quarter, because large batches are exactly what *Accelerate* identifies as correlated with failure. The freeze trades a stream of small, safe changes for one big dangerous one.
- **It's a throughput cliff**, not a smooth cost — lead time for anything blocked goes from hours to weeks.
- **It usually targets the wrong risk.** Most incidents aren't caused by *deploys*; freezing deploys does nothing about traffic spikes, dependency failures, or expiring certs — and it removes your ability to *fix* those quickly.

The mature posture: freeze *narrowly* (only the genuinely fragile system, only the genuinely high-risk window), keep low-risk standard changes flowing, and **always pair a freeze with an explicit break-glass** so an incident fix is never blocked by it (this is precisely the emergency path in [07](../07-break-glass-and-bypass/professional.md)). A freeze without a break-glass is how a P1 turns into a P0.

**Measuring approvals.** Two numbers turn approval policy from opinion into evidence:

1. **Approval wait time as a fraction of lead time.** Instrument it. Decompose lead time into coding → review → *approval wait* → deploy. When you find that a deploy approval adds, say, two days to a change that took two hours to write, you have quantified the tax. This feeds directly into the org's DORA lead-time metric — see [Engineering Metrics & DORA](../../engineering-metrics-and-dora/). Wait-time is the most visible, least defensible cost.

2. **The remove-it test: does the gate correlate with fewer incidents?** This is the killer question. Pull the data: of the last N changes that went through this approval, how many did the approval *catch* (rejected/changed because the approver found a real problem)? Cross-reference incidents: did the changes that caused incidents pass the approval anyway? In the overwhelming majority of real audits of this kind, the answer is *the approval caught essentially nothing and the incidents sailed through it* — which is the *Accelerate* finding reproduced in your own house, and the evidence to replace the gate with peer review + automated checks.

| Remove-it test question | If the answer is… | Then |
|---|---|---|
| In the last 50 changes, how many did this approval reject for a real defect? | ~0 | The gate catches nothing — strong remove signal |
| Did the changes that caused incidents pass this approval? | Yes (they passed) | The gate doesn't prevent incidents — remove signal |
| When the approver "reviews," do they see the actual diff/risk, or a summary? | A summary | It can't catch anything a summary hides — it's theatre |
| What's this gate's wait-time contribution to lead time? | Days | High cost — combine with above to justify removal |
| If we removed it, which real requirement (SoD/audit/control) goes uncovered? | None (covered by peer review + automated gate + audit) | Safe to remove — requirement still met |
| | One genuinely isn't covered | Don't remove — re-implement *that* control automatically first |

> **The professional discipline:** *an approval gate is a hypothesis that it prevents bad outcomes — so test the hypothesis with your own incident data.* If it catches nothing and the incidents pass through it, it is cost without benefit, and you now have the evidence (not an opinion) to replace it with controls that actually work. Measure before you defend; measure before you remove.

---

## War Stories

**The CAB that added three days and never caught an incident.** A mid-size fintech routed every production deploy through a weekly Change Advisory Board. Average added wait: three business days; deploys batched up to hit the meeting. A staff engineer pulled twelve months of CAB records against the incident log: the board had **rejected or modified zero changes for a real defect**, and **every** change behind a production incident had been *approved* by it. They replaced the CAB with required CODEOWNER review, an OPA policy gate, and an auto-generated evidence package per deploy. Result: deploy lead time dropped from days to hours, change-failure rate went *down* (smaller batches, real review on the diff), and — the part that sold it — the next audit was *easier*, because evidence was now generated automatically instead of reconstructed in a CAB minute-taker's notes.

**The SOC 2 audit passed in an afternoon.** A team had built deploy approval as pipeline-native from the start: PR review with self-approval disabled, deploy executable only by the CI identity (no human prod push), every release tagged with reviewer, gates, ticket, and a signed provenance attestation. When the SOC 2 CC8.1 sample arrived — "show change authorization and segregation of duties for these fifteen changes" — they ran one command per release and handed over fifteen complete evidence packages before lunch. The auditor's note: "controls are automated and consistently applied." The team had never held a change meeting. Compliance was a *byproduct*, and the audit cost an afternoon instead of the month their peers spent.

**The rubber-stamp that approved a bad deploy.** An org required a "production approval" click before every deploy — satisfied, in practice, by a tech lead who clicked "approve" on a notification without opening the diff, because there were thirty a day. A change with a broken DB migration got the click, deployed, and took down checkout. The post-incident finding wasn't "we need *more* approval" — it was that the approval *was the problem*: it created the appearance of a safety check while providing none, and it had trained everyone to trust a click nobody backed with a look. They replaced the per-deploy click with a required migration-safety gate (automated) plus real peer review on schema changes. The lesson: *a rubber stamp is worse than no gate, because it manufactures false confidence.*

**The regulated team that 10x'd frequency with pre-approved changes.** A team on a SOX-relevant system deployed monthly, gated by a normal-change CAB, because "we're regulated." A staff engineer worked with GRC to define a **standard change**: "a peer-reviewed service deploy through the canary pipeline with automated gates" was pre-authorized *as a class*, once, with the controls documented as policy-as-code. Routine deploys stopped going to the CAB entirely; only schema changes and new integrations did. Deployment frequency went from monthly to multiple times a week — roughly 10x — with *no* loss of control, because the controls (review, gates, audit) were stronger than the meeting they replaced. "Regulated" had never required a meeting; it required *control*, and the pipeline provided more of it.

**The incident the CAB prolonged.** During a P1, the fix was ready in fifteen minutes — and then sat for forty more because production deploys required CAB authorization and it was after hours. The outage was three-quarters waiting for approval. The remediation wasn't to weaken change management; it was to add an explicit, audited **break-glass** path: in a declared incident, an authorized on-call may deploy a fix immediately, with a *mandatory retroactive* review logged within 24h (see [07](../07-break-glass-and-bypass/professional.md)). The control was preserved (every break-glass use is reviewed); the forty-minute self-inflicted extension was eliminated.

---

## Decision Frameworks

**Human approval vs. automated gate vs. auto-deploy — by risk tier:**

| Risk tier | Reversible? | Auto-detectable failure? | Blast radius | → Decision |
|---|---|---|---|---|
| Routine deploy, config flip behind flag | Yes | Yes (gates + canary) | Small | **Auto-deploy** (peer review + gates) |
| New service, cross-team dep | Yes | Mostly | Medium | **Automated gate + async ack** (no meeting) |
| Schema change with clean rollback | Yes | Partially | Medium-large | Gate + **lightweight human ack** |
| Irreversible migration, auth/billing, first-of-kind | No / unclear | No | Large | **Human go/no-go** by accountable owner |
| Incident fix | n/a | n/a | varies | **Break-glass**, retroactive review |

**Replacing the CAB — requirement → automated control:**

| What the CAB *claimed* to provide | Automated control that actually provides it |
|---|---|
| Authorization of changes | Required CODEOWNER PR approval, recorded in VCS |
| Separation of duties | Self-approval disabled; deploy identity ≠ any human |
| Risk assessment | Peer review on the *diff* + automated SAST/policy/test gates |
| Auditability | Immutable VCS + CI log; per-release evidence package |
| Consistency | 100% of deploys via pipeline; non-pipeline changes alertable |
| Emergency handling | Documented break-glass with retroactive review |

**SoD enforcement options (pick by team size + risk):**

| Option | Use when |
|---|---|
| Required review, self-approval off | Always — the floor |
| CODEOWNERS-gated | You want a *competent* second reviewer, not just any |
| Deploy-by-pipeline-identity-only | You can remove standing human prod access — the strongest default |
| Two-person prod promotion | High-risk tier *only*; never as the default |
| Audited post-hoc review | Genuinely small teams; document and time-box it |

**Manual go/no-go → automated canary readiness (are you ready to remove the human?):**

| Checkpoint | Ready to automate when… |
|---|---|
| The human's decision is threshold-checking | The "go" is mostly "is metric X under Y?" |
| Canary surfaces bad deploys | A canary has caught regressions the human would have |
| Shadow-mode agreement | Auto-decision matched the human N times running |
| Rollback is fast + automated | A failed promotion auto-reverts without a human |
| Ambiguous cases are carved out | Outage-time / novel / no-baseline deploys still page a human |

**Is this approval catching anything? (the remove-it test):**

| Signal | Reading |
|---|---|
| Rejected ~0 of last 50 changes for a real defect | Catches nothing → remove |
| Incident-causing changes passed it | Doesn't prevent incidents → remove |
| Approver sees a summary, not the diff | Can't catch anything → theatre |
| Adds days of wait-time | High cost → remove (if requirement covered) |
| Removing it leaves a real control uncovered | Re-implement *that* control automatically *first*, then remove |

---

## Mental Models

- **An approval is a proxy for a requirement, never the requirement itself.** "We need a CAB" really means "we need control / audit / SoD." Re-implement the *requirement* with review + automated gates + immutable audit, and the proxy becomes redundant.

- **Compliance is a byproduct of a good pipeline, not a project before an audit.** If every deploy auto-emits its own SoD + approval + provenance evidence, the audit is a query. If it takes a month, you're doing it by hand.

- **A rubber stamp is worse than no gate.** It manufactures false confidence and trains people not to look. The most dangerous approval is the one everyone trusts and nobody reads.

- **Spend human judgment where there's signal.** Auto-deploy the reversible, auto-detectable majority; reserve humans for the irreversible, novel, large-blast-radius few. That *raises* both throughput and stability.

- **The strongest separation of duties is a non-human deployer.** If only the pipeline can push to prod and it only runs policy-satisfying, peer-reviewed code, no individual can unilaterally change production.

- **A freeze trades many small safe deploys for one big dangerous one.** Batch size is the risk. Freeze narrowly, keep standard changes flowing, and always pair it with break-glass.

- **An approval gate is a testable hypothesis.** It claims to prevent bad outcomes — so check it against your incident data. If it catches nothing and incidents pass through it, it's cost without benefit.

---

## Common Mistakes

1. **Defending the CAB as a control.** It's a ritual that *signals* control. The *Accelerate* data shows external approval boards don't lower change-failure rate and do slow delivery. Make the real controls visible instead, then retire the board.

2. **Requiring human approval for every change.** This applies the riskiest change's cost to the safest and craters throughput. Risk-tier it: standard changes auto-deploy; only high-blast-radius/novel changes get a human go/no-go.

3. **Treating compliance as a pre-audit project.** Reconstructing evidence by hand each cycle is both expensive and fragile. Make every deploy auto-generate SoD/approval/provenance evidence so the audit is a query.

4. **Forgetting the ITIL standard-change escape hatch.** Routing routine deploys through a *normal*-change CAB is the self-inflicted gridlock. Pre-authorize the *class* of safe deploy once; instances need no meeting.

5. **Faking separation of duties on a small team.** A blanket invisible self-approval fails the intent and the audit. Use audited *post-hoc* review and document the time-boxed solo-deploy policy honestly.

6. **Flipping to auto-promotion without the trust path.** Skipping shadow-mode and incremental canary stages gets you a revolt at the first incident. Prove the gate's decisions match the human's, *then* remove the human — and keep them for ambiguous calls.

7. **Freezing broadly and without break-glass.** A wide freeze explodes batch size and blocks incident fixes. Freeze the genuinely fragile thing only, keep standard changes flowing, and always pair with an audited emergency path ([07](../07-break-glass-and-bypass/professional.md)).

8. **Never measuring whether the gate catches anything.** If you don't run the remove-it test, you'll defend a gate on faith. Pull the data: rejections for real defects, and whether incident-causing changes passed it.

---

## Test Yourself

1. A VP insists the CAB is what keeps the company safe. Cite the relevant DORA/*Accelerate* finding and explain what the CAB actually does (and doesn't do) against the four real requirements behind it.
2. An auditor samples fifteen production changes and asks for proof of authorization and separation of duties. Describe how a pipeline-native approach answers this in an afternoon, and name the specific controls that map to SOC 2 CC8.1's expectations.
3. Define the ITIL "standard change" and explain how it lets a *regulated* team auto-deploy routine changes without violating change-management controls.
4. In continuous deployment no human clicks "approve" before prod. How do you explain to an auditor where the *authorization* and *separation of duties* live?
5. You're migrating from manual go/no-go to SLO-based auto-promotion. What do you automate first, how do you build trust before removing the human, and what stays human permanently?
6. Give the "remove-it test" for an approval gate: what data do you pull, and what answers justify removing the gate vs. keeping it?
7. Your org wants a two-week deploy freeze for the holidays. Name three costs that are usually uncounted and the two things you'd insist on if a narrow freeze is genuinely warranted.

<details>
<summary>Answers</summary>

1. *Accelerate* / State of DevOps found external change-approval processes (a separate body / CAB) have **no statistically significant correlation with lower change-failure rate** and **significantly slow delivery**. Against the four real requirements: it does little for **control** (the deploy still happens, just later), little for **auditability** that peer review + VCS doesn't do better, little for **SoD** (a board approving someone else's change is weaker than enforced author≠reviewer), and weak **risk assessment** because it reviews a summary days late, not the diff. The fix is to make the real controls — peer review on the diff, automated gates, immutable audit — visible and provable.

2. Pipeline-native: PR review with self-approval disabled (authorization + SoD), deploy executable only by the CI identity (controlled prod access), each release auto-tagged with reviewer(s), gate results, ticket, and a signed provenance attestation. The auditor's sample becomes one command per release producing a complete evidence package. CC8.1 mappings: required CODEOWNER approval = authorization; self-approval-disabled + non-human deployer = SoD; CI status checks = tested-before-deploy; 100%-via-pipeline = consistently applied; immutable VCS/CI log = traceable record.

3. A **standard change** is an ITIL change type that is *pre-authorized* because it's low-risk, repeatable, and well-understood — authorization happens *once for the class*, not per instance. A regulated team defines "peer-reviewed service deploy through the canary pipeline with automated gates" as a standard change, documents the controls as policy-as-code, and gets GRC sign-off on the *class*. Routine deploys then need no meeting while the (stronger, automated) controls still operate — satisfying change management because control and SoD are enforced, not because a CAB met.

4. The **approval is the codified policy plus the provenance.** A human *did* approve — the peer reviewer, recorded in VCS. The change satisfied the version-controlled deployment policy (machine-verified, recorded). The artifact carries a signed attestation (SLSA/in-toto) of that whole chain. **SoD** holds because author ≠ reviewer and the *deployer* is a non-human pipeline identity acting only on policy-satisfying inputs — so no individual can unilaterally push to prod. The authorization is real and traceable; it happened at review-and-policy time, not as a deploy-time ceremony.

5. **Automate first** the parts that were already threshold-checks (error rate < X, p99 < Y, success-vs-baseline ≥ Z) — comparisons a machine does better. **Build trust** with shadow-mode: run the auto-promotion decision in parallel with the human, log both, and remove the human only after the gate matched (or out-caught) the human N times running — evidence, not assertion. **Stays human permanently:** the genuinely ambiguous — deploys during a partial outage, changes with noisy/absent canary signal, first-of-kind changes with no baseline — anything where safety needs context the metrics don't hold.

6. Pull: (a) of the last ~50 changes through the gate, how many it **rejected/changed for a real defect**; (b) whether the changes that **caused incidents passed** it anyway; (c) whether the approver sees the **diff or just a summary**; (d) its **wait-time** contribution to lead time. **Remove** when it rejected ~0, incidents passed through it, it only sees summaries, and removing it leaves no real control (SoD/audit/control) uncovered. **Keep** (or re-implement automatically first) only if removing it would leave a genuine control gap.

7. Uncounted costs: (a) **batch size explodes** — two weeks of held changes deploy together as the quarter's single riskiest deploy; (b) it's a **throughput cliff** (lead time → weeks for anything blocked); (c) it **targets the wrong risk** — most incidents aren't deploy-caused, and the freeze removes your ability to *fix* the ones that aren't. If a narrow freeze is warranted: insist on (1) **scoping it tightly** (only the fragile system / window, keep standard changes flowing) and (2) an explicit, audited **break-glass** so an incident fix is never blocked.

</details>

---

## Cheat Sheet

```
THE CENTRAL PROBLEM
  Org wants approval for "safety"; DORA: heavyweight approval hurts throughput,
  does NOT improve stability. Satisfy the REQUIREMENT (control/audit/SoD),
  kill the THEATRE (the meeting + signature).

THE REQUIREMENT → THE REAL CONTROL
  authorization   → required CODEOWNER PR review (recorded)
  separation      → self-approval OFF; deploy identity != any human
  risk assessment → peer review on the DIFF + automated gates
  auditability    → immutable VCS/CI log + per-release evidence package
  consistency     → 100% via pipeline; non-pipeline changes alertable
  => CAB becomes redundant

RISK-TIERED APPROVALS
  standard/low   → AUTO-DEPLOY (peer review + gates + canary)  [the majority]
  medium         → gates + async ack (no meeting)
  high/novel     → gates + HUMAN go/no-go by accountable owner
  emergency      → break-glass + retroactive review  (see 07)
  litmus: bad change caught by gate/canary AND fast rollback? → standard

COMPLIANCE AS BYPRODUCT
  policy-as-code (OPA/branch rules) = the documented control
  CI run = evidence of its operation
  audit = a query, not a month-long project   (SOC2 CC8.1 / SOX ITGC)

SoD AT SCALE
  floor: required review, self-approval disabled
  strongest default: only the PIPELINE identity can deploy (no standing prod push)
  automation "approval" = codified policy + signed provenance (SLSA/in-toto)
  small team: AUDITED post-hoc review, time-boxed — never invisible self-approval

MANUAL GO/NO-GO → AUTO-PROMOTE
  automate threshold-checks first → canary catches regressions →
  shadow-mode agreement N× → remove human → keep human for ambiguous only

FREEZES
  cost = batch size explodes (the quarter's riskiest deploy on lift)
  freeze NARROW, keep standard changes flowing, ALWAYS pair w/ break-glass

REMOVE-IT TEST
  rejected ~0 real defects?  incidents passed it?  summary-only?  days of wait?
  + removing it leaves no control gap  → REMOVE
```

---

## Summary

- **The central staff problem** is that the org demands heavyweight human approval for "safety," but the *Accelerate*/DORA evidence shows it doesn't improve stability and clearly hurts throughput. Separate the *requirement* (control, auditability, SoD, risk awareness) from the *default implementation* (a meeting), and re-implement the requirement with peer review + automated gates + immutable audit.
- **Make compliance a pipeline byproduct.** Every deploy auto-generates the exact evidence auditors sample — authorization, SoD, test results, provenance — so SOC 2 CC8.1 / SOX ITGC become a query, not a pre-audit project. Policy-as-code *is* the documented control; the CI run *is* the evidence.
- **Risk-tier approvals.** Auto-deploy the reversible, auto-detectable majority (peer review + gates + canary) via the ITIL **standard change**; reserve human go/no-go for the irreversible, novel, high-blast-radius few. This raises throughput *and* stability.
- **Separation of duties at scale** is enforced mechanically (self-approval disabled, deploy-by-pipeline-identity-only). For continuous deployment, the "approval" is the **codified policy plus signed provenance**; the deployer is a non-human identity, so no individual can unilaterally change prod. Small teams use audited post-hoc review, documented honestly.
- **Migrate to automated promotion gradually:** automate the threshold-checks first, prove the SLO gate's decisions match the human's in shadow mode, then remove the human — keeping them only for the genuinely ambiguous calls.
- **Freezes** trade many small safe deploys for one big dangerous one; freeze narrowly and always pair with break-glass ([07](../07-break-glass-and-bypass/professional.md)). And **measure**: approval wait-time as a fraction of lead time (feeds [DORA](../../engineering-metrics-and-dora/)), plus the remove-it test — if the gate catches nothing and incidents pass through it, you have the evidence to replace it.

You can now design deploy-approval policy across an organization — even a regulated one — that preserves real control while killing the theatre. The remaining tier — [interview.md](interview.md) — consolidates this into the questions that probe whether someone actually understands the throughput-vs-control tension and the playbook for resolving it.

---

## Further Reading

- *Accelerate* (Forsgren, Humble, Kim) and the **State of DevOps** reports — the change-approval research: external approval boards don't lower change-failure rate and do slow delivery; peer review + automated checks correlate with high performance.
- [Google SRE Book — Release Engineering](https://sre.google/sre-book/release-engineering/) and *Site Reliability Workbook* on canarying — automation, hermeticity, and progressive rollout as the control.
- **SOC 2 Trust Services Criteria, CC8.1 (Change Management)** — the criterion most deploy-approval discussions trace back to; map it to automated controls.
- **SOX IT General Controls (ITGC)** change-management guidance — what "authorized, tested, segregated, traceable" means for financially-relevant systems.
- **ITIL 4** change-enablement and the **standard / normal / emergency** change types — the standard-change pattern done right.
- **SLSA framework** and **in-toto** — signed provenance/attestation: how the artifact carries proof of how it was built and approved.
- **Open Policy Agent (OPA) / Conftest**, and **Argo Rollouts / Flagger** docs — policy-as-code gates and SLO-based automated promotion.
- [interview.md](interview.md) — the same material distilled into interview questions and model answers.

---

## Related Topics

- [02 — Branch Protection & Merge Policies](../02-branch-protection-and-merge-policies/professional.md) — where peer review and self-approval-disabled SoD are actually enforced.
- [05 — Gate Design: Speed vs Safety](../05-gate-design-speed-vs-safety/professional.md) — the broader throughput-vs-control tradeoff that approvals are one instance of.
- [07 — Break-glass & Bypass](../07-break-glass-and-bypass/professional.md) — the audited emergency path that every freeze and high-risk gate must pair with.
- [Release Engineering](../../release-engineering/) — progressive delivery, canary, and the deployment machinery automated promotion rides on.
- [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) — lead time, approval wait-time, and the change-approval evidence base.
