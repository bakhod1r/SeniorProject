# Deploy Approvals & Sign-offs — Interview Level

> **Roadmap:** [Quality Gates](../README.md) → Deploy Approvals & Sign-offs
> *A deploy-approval interview rarely asks "should prod have an approval." It asks "your CAB is adding three days to every release — defend it or kill it," and then watches whether you can separate accountability from control, evidence from theatre, and the gates that catch something from the ones that only feel safe. This page is the question bank, with model answers and a note on what each question is really probing.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [How to Use This Page](#how-to-use-this-page)
4. [Fundamentals](#fundamentals)
5. [Separation of Duties & Audit](#separation-of-duties--audit)
6. [CAB & the DORA Evidence](#cab--the-dora-evidence)
7. [Manual vs Automated](#manual-vs-automated)
8. [Scale & Scenarios](#scale--scenarios)
9. [Rapid-Fire](#rapid-fire)
10. [Red Flags / Green Flags](#red-flags--green-flags)
11. [Cheat Sheet](#cheat-sheet)
12. [Summary](#summary)
13. [Further Reading](#further-reading)
14. [Related Topics](#related-topics)

---

## Introduction

Deploy approvals are where governance meets the pipeline. They are also where most engineering organizations accumulate their most expensive cargo cult: a heavyweight Change Advisory Board that adds days of lead time, catches nothing the automated gates missed, and survives only because "the auditor wants it" — a claim that almost never survives a careful read of the actual control objective.

This page treats deploy approval as a design problem with a sharp empirical edge. The *Accelerate* / DORA research is unusually direct here: external, heavyweight change approval is **negatively correlated with software delivery performance and has no measurable benefit to change-fail rate**. That single finding is the difference between a candidate who recites "all changes need approval" and one who can walk into a regulated shop and replace a CAB with something that is *both* faster *and* more defensible to an auditor. The strongest answers keep returning to one distinction: **accountability** (a recorded, attributable decision) is cheap and valuable; **control by people distant from the change** is expensive and mostly theatre.

## Prerequisites

You'll get the most from this page if you're comfortable with:

- **CI/CD pipeline stages** — what a promotion between environments (`dev → staging → prod`) physically is, and where a gate sits in it.
- **Branch protection and code review** — peer review is the approval that the evidence *does* support; see [02 — Branch Protection & Merge Policies](../02-branch-protection-and-merge-policies/interview.md).
- **Basic compliance vocabulary** — SOC 2, SOX, PCI-DSS, "separation of duties," "audit trail." You don't need to be an auditor; you need to know what control objective each gate is *claiming* to satisfy.
- **Deployment strategies** — canary, blue-green, progressive delivery — because the most defensible "approval" is often an automated SLO check, not a human.

---

## How to Use This Page

Each question carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). Don't memorize the answers — internalize the *distinctions* they keep returning to:

- **accountability vs control** (a recorded, attributable decision vs a human standing in the path)
- **author vs approver** (separation of duties — the one approval compliance genuinely cares about)
- **evidence vs theatre** (a gate that catches a real class of defect vs one that only feels safe)
- **decidable vs judgment** (work a machine should own vs the residue that needs a human)

Nearly every question in this bank is one of those four distinctions wearing a costume. The candidates who do well name the distinction *before* reaching for a tool or a policy.

---

## Fundamentals

### Q: What is a deploy approval / sign-off, and how is it different from code review?

> **Testing:** Whether you separate the merge-time gate from the release-time gate, and know they answer different questions.

**A.** A deploy approval is a **recorded decision to promote a specific artifact into a specific environment** — typically the human (or automated) gate in front of production. It's distinct from code review: code review asks *"is this change correct and safe to merge?"* at merge time, against a diff; deploy approval asks *"is **now** a safe time to release **this build** to **this environment**?"* at release time, against a fully-built, already-tested artifact.

The two answer different questions and fail differently. Code review can't know that there's an active incident, a marketing-driven traffic spike, or a change freeze in effect — those are release-time facts. Conversely, a deploy approval that re-litigates the diff is just doing code review badly and late. A clean design uses peer review for *correctness* and reserves the deploy gate for *timing, blast-radius, and accountability* — ideally most of which a machine can evaluate.

### Q: Walk me through promotion across environments and where approvals sit.

> **Testing:** Do you have a mental model of the promotion pipeline, or do you think "deploy" is one step?

**A.** A typical promotion path is `dev → staging/pre-prod → production`, where the **same immutable artifact** moves forward — you don't rebuild per environment, you re-deploy the build that already passed the gates behind it. Approvals are tiered by blast radius:

- **dev** — usually no approval; fast feedback is the whole point.
- **staging/pre-prod** — automated gates (tests, integration, smoke), rarely a human.
- **production** — this is where a *recorded* approval usually lives, because prod is the environment with real users, real money, and real audit scope.

The key design principle: **the gate weight should track the blast radius.** Gating dev deploys with a human is pure friction; gating prod deploys with *only* a human (and no automated checks) is misplaced trust. The artifact being identical across environments is what makes the staging signal meaningful — if you rebuild for prod, staging didn't actually test what you're shipping.

### Q: How do you implement a required approval on GitHub or GitLab?

> **Testing:** Concrete tooling knowledge, not just theory.

**A.** On **GitHub**, you use **Environments** with **required reviewers**. You define an environment (e.g. `production`), attach a protection rule listing the approvers, and reference it in the job. The job pauses and waits for one of the named reviewers before it runs:

```yaml
jobs:
  deploy-prod:
    runs-on: ubuntu-latest
    environment:
      name: production        # protection rules attach here
      url: https://app.example.com
    steps:
      - uses: actions/checkout@v4
      - run: ./deploy.sh
```

The protection rule (set in repo settings) holds the reviewer list, an optional wait timer, and which branches may deploy. On **GitLab**, the equivalent is **protected environments**: you mark an environment as protected and specify who is **allowed to deploy** and, separately, who must **approve** the deployment job before it runs.

> The important thing an interviewer wants to hear: the approval is **enforced by the platform and recorded**, not a Slack "lgtm" someone screenshots. The recording — *who approved, which SHA/artifact, when* — is the whole point.

### Q: Why does production so often require a recorded human approval at all?

> **Testing:** Whether you can name the *real* reason (accountability + audit) instead of vaguely invoking "safety."

**A.** Two reasons, and it's worth separating them because they justify *different* designs.

The defensible reason is **accountability and audit**: regulated environments (SOC 2, SOX, PCI) require that production changes be **attributable** — a durable record of who authorized this change, against which artifact, at what time. That's a cheap, valuable property and it doesn't require a human to *block* anything; it requires the decision to be *recorded*.

The often-undefensible reason is **control** — the belief that a human reviewer at the gate catches bad changes. The DORA evidence says this mostly doesn't hold for approvers distant from the change. So the strong answer is: prod needs **recorded accountability**, which can frequently be satisfied by an *automated* approval (a green canary analysis logged with the deploying identity) — it does *not* automatically need a human standing in the path. Conflating "we need an audit trail" with "we need a person to click approve" is the root of most over-heavy gates.

---

## Separation of Duties & Audit

### Q: What is separation of duties, and why must author ≠ approver?

> **Testing:** The one approval control that's genuinely load-bearing for compliance.

**A.** Separation of duties (SoD) means **no single person can both make a change and authorize it into production unchecked**. The author of a change cannot be its sole approver. The control objective is fraud and error prevention: a developer shouldn't be able to silently push code that, say, moves money or exfiltrates data without a second party in the loop. This is the spirit behind SOX's segregation requirements and SOC 2's change-management criteria, and it maps cleanly onto something engineers already do — **peer review**.

The crucial nuance for an interview: SoD is satisfied by a *second competent party*, and that party is best positioned **close to the change** (a peer reviewer who understands the diff), not by a remote board. So "author ≠ approver" is the part of approval governance that the DORA evidence *supports* — when it's peer review. The failure mode is interpreting SoD as "needs a manager three levels up to sign," which adds the cost without the benefit. Same control objective, far worse implementation.

### Q: What does a good deploy audit trail actually contain, and how do you produce it without manual work?

> **Testing:** Whether you know what auditors want and how a pipeline generates it for free.

**A.** An audit trail for a deployment is the answer to **who authorized what, when, against which artifact** — and ideally *why* and *under which approval policy*. Concretely:

- **Who** — the authenticated identity that approved (and, separately, the identity that triggered the deploy).
- **What** — the exact artifact: a content-addressed digest (`sha256:…`), not "the latest build" or a mutable tag.
- **When** — a timestamp from the system of record, not a human's recollection.
- **Linkage** — the change (PR/commit), the ticket, the approval event, and the resulting deployment, all cross-referenced.

The professional point is that **the pipeline produces this automatically** as a byproduct of running. GitHub's deployment + environment events, GitLab's deployment records, and the platform audit logs already capture identity, SHA, and timestamp. You don't ask engineers to fill in a change record; you make the *pipeline* the system of record and export its events. A trail assembled by hand after the fact is exactly the kind of evidence that's both expensive to maintain and unconvincing to an auditor, because it can be edited. An **immutable, automatically-emitted** trail is cheaper *and* more credible.

### Q: Who is the "approver" when an automated pipeline does the deploy? Doesn't that break separation of duties?

> **Testing:** The automation-identity question — subtle, and a real audit sticking point.

**A.** This is the question that trips people up, and the answer reframes it. When a pipeline deploys, the **decision** was already made by humans upstream — the peer reviewer who approved the merge, and whoever approved the *policy* that says "merged, gated, green builds auto-promote." The pipeline is the **executor**, not the decision-maker, and it should run under a **distinct, non-human identity** (a service account / OIDC-federated workload identity) whose actions are logged separately from any individual.

So SoD is preserved like this: the **change** was authored by A and approved by B (peer review); the **deployment** is executed by an automation identity under a **pre-approved policy** that B's organization signed off on. No single human both wrote and unilaterally released the change. The thing auditors actually want — *no unchecked self-authorization, full attribution* — is intact. The anti-pattern is a pipeline running under a *named human's* personal credentials, which both muddies attribution and creates a standing privilege. Use a workload identity, scope it tightly, and log it as its own actor.

### Q: An auditor says "every production change needs an approval." How do you satisfy that without a human clicking approve on every deploy?

> **Testing:** Translating a control objective into a control, rather than taking the literal wording.

**A.** I'd start by reading the **control objective**, not the sentence. "Approval" in a controls framework means *authorized and attributable*, not *a human pressed a button*. So I'd satisfy it with a **pre-approved standard change**: the organization formally approves, once, a *class* of low-risk changes and the *automated criteria* that admit a deploy into that class (passed tests, peer-reviewed, within the change window, canary SLOs green). Each deploy that meets the criteria is then **authorized by that standing approval** and recorded with full attribution — identity, SHA, timestamp, policy version.

This is exactly the ITIL **standard change** pattern, and most auditors accept it readily because it's *more* rigorous than a human rubber-stamp: the criteria are explicit, uniformly enforced, and logged, instead of depending on whether a tired reviewer looked carefully. Changes that *don't* meet the standard-change criteria (schema migrations, anything touching auth or payments) fall back to a heavier path with an explicit human approver. You've satisfied the control, kept velocity for the 90% of changes that are routine, and concentrated human judgment where it's warranted.

---

## CAB & the DORA Evidence

### Q: What is a Change Advisory Board, and what is it supposed to do?

> **Testing:** Baseline literacy before you critique it.

**A.** A **Change Advisory Board (CAB)** is a group — typically cross-functional, often including people outside the delivery team — that reviews and authorizes changes before they go to production. It comes from ITIL's change-management practice. The intent is reasonable on paper: a forum to assess risk, surface conflicts between concurrent changes, and create an accountable authorization point. In practice it usually means a **scheduled meeting** (weekly, sometimes less frequent) where change requests are presented and approved or deferred.

I want to be fair to it before I criticize it: a CAB's *goals* — risk assessment, conflict detection, accountability — are legitimate. The problem is almost entirely in the **implementation**: batching changes into a periodic meeting reviewed by people distant from the work. That's what the evidence indicts, and it's worth being precise that the critique is of *heavyweight, external, batched* approval, not of the goals a CAB claims to serve.

### Q: What does the DORA / Accelerate research actually say about change approval? Be specific.

> **Testing:** The differentiator. Whether you can cite the finding precisely instead of vibing about "bureaucracy bad."

**A.** The finding from *Accelerate* and the State of DevOps research is specific and counterintuitive: **external, heavyweight change-approval processes (a CAB-style separate body approving changes) are negatively correlated with software delivery performance** — they slow down lead time and deploy frequency — **while having no statistically significant effect on change-fail rate.** They make you slower without making you safer.

By contrast, the research finds that **peer review and lightweight, team-based change approval** *do* correlate with better outcomes. The takeaway DORA draws explicitly is to **move approval closer to the work**: a peer reviewer who understands the change is effective; a board that doesn't is not. The way I'd phrase the punchline in an interview: **"approval by people distant from the change is risk theatre"** — it produces the *feeling* of control and an artifact for the auditor, but the data says it doesn't change the failure rate. That single result is what justifies replacing CABs with automated gates plus peer review, and it's the empirical backbone of the whole modern position on deploy approvals.

### Q: If a CAB doesn't reduce change-fail rate, why do organizations cling to it?

> **Testing:** Whether you understand the human and institutional reasons, so you can actually change it.

**A.** A few reasons, and naming them is how you dislodge it:

1. **Misread compliance.** Someone believes the auditor requires a CAB. Usually the auditor requires *attributable authorization and SoD* — which a CAB is one (poor) implementation of, not the only one.
2. **Loss aversion and accountability diffusion.** A CAB feels like a safety net, and after an incident, "we'll add it to the CAB" is the reflexive, visible response. Removing a control feels riskier than keeping a useless one, even when the data says it's useless.
3. **It's where bad changes used to be caught** — because the *upstream* gates (tests, peer review, progressive delivery) were weak. The CAB was compensating for missing automation.

That third point is the lever. You don't win the argument by quoting DORA at people who are scared; you win it by **building the automated gates that make the CAB redundant** — strong tests, enforced peer review, canary analysis with auto-rollback, an immutable audit trail — and *then* showing that the CAB now only adds latency. Replace the function before you remove the form.

### Q: What is a "pre-approved standard change," and why is it the key to replacing a CAB?

> **Testing:** The concrete pattern that resolves the velocity-vs-compliance tension.

**A.** A **standard change** (ITIL term) is a change that's **been risk-assessed and pre-authorized as a class**, so individual instances don't need a fresh approval meeting — they just need to **prove they belong to the class**. You define, once, the criteria for "routine, low-risk deploy" (peer-reviewed, all required checks green, no schema or auth/payment changes, within the change window, canary SLOs holding), the CAB or change authority approves *those criteria*, and from then on any deploy meeting them is authorized automatically and logged.

This is the key because it **decouples the authorization decision from the deployment event**. The CAB's legitimate job — risk assessment — happens *once, at the policy level*, instead of *repeatedly, per change*. Velocity comes back for the routine majority; the human judgment is preserved and concentrated on the genuinely novel or high-risk changes that *fail* the standard-change criteria. It satisfies the auditor (explicit, enforced, logged criteria are *stronger* than ad-hoc meeting minutes) and it gives the risk-averse a real answer to "but what about dangerous changes" — those still get a human. It's the single most useful pattern for the "CAB is killing us" scenario.

---

## Manual vs Automated

### Q: How do you decide what should be a human approval versus an automated gate?

> **Testing:** The decidable-vs-judgment distinction — the core of good gate design.

**A.** The rule I use: **automate every check that has an objective pass/fail, and reserve humans for genuine judgment.** Most of what people put a human on is actually decidable by a machine and is therefore *better* automated, because a machine never gets tired, never rubber-stamps, and always logs:

- **Decidable → automate.** Tests pass, coverage threshold met, security scan clean, artifact signed and provenance verified, canary error rate and latency within SLO, deploying within the change window. These have a correct answer; a human adds latency and inconsistency, not value.
- **Judgment → human.** "Is *now* a wise time given the business context?" (a product launch, a customer escalation), "this is a one-way-door migration with no clean rollback," "this touches an area with known fragility the automation can't assess." These need a person.

The failure mode in both directions: putting a human on decidable checks (slow, inconsistent, invites rubber-stamping) *and* automating away decisions that genuinely needed human context (a freeze during a critical sales event). A senior answer states the principle and then admits the boundary moves with the blast radius — the higher the risk, the more you're willing to pay a human's judgment tax.

### Q: How can a canary or SLO analysis *be* the approval?

> **Testing:** Whether you know progressive delivery turns "approval" into a measured, automated decision.

**A.** Progressive-delivery tooling — **Argo Rollouts**, **Flagger** — replaces the human go/no-go with a **measured one**. You release to a small slice of traffic, the controller queries your metrics provider (Prometheus, Datadog, CloudWatch) against an **analysis template** defining the success criteria, and it **promotes automatically if the metrics hold and rolls back automatically if they don't**:

```yaml
# Argo Rollouts AnalysisTemplate (sketch)
metrics:
  - name: error-rate
    interval: 1m
    successCondition: result < 0.01      # <1% errors
    failureLimit: 3
    provider:
      prometheus:
        query: |
          sum(rate(http_requests_total{job="app",status=~"5.."}[1m]))
          / sum(rate(http_requests_total{job="app"}[1m]))
```

This is a *better* approval than a human for the thing it covers: it's based on **real production behavior of this exact build**, it's consistent, it's fast, and it produces an audit record ("promoted at T because error rate stayed below 1% across N intervals"). It doesn't replace *all* judgment — it can't know about a business-context reason to hold — but for the question "is this build behaving acceptably in prod," an SLO gate beats a person staring at a dashboard and guessing. The strongest framing: this turns "approval" from an *opinion* into a *measurement*.

### Q: What's wrong with a "rubber-stamp" approval, and how do you detect one?

> **Testing:** Whether you can recognize theatre and have a way to measure it.

**A.** A rubber-stamp approval is one where the approver **can't or doesn't actually evaluate** the change but clicks approve anyway — the gate exists, but it's not exercising judgment. It's worse than no gate in one specific way: it **manufactures false assurance** and a misleading audit trail. The org believes there's a control; there's only a ritual. After an incident, "but it was approved!" obscures that the approval meant nothing.

You detect it with data. Signals: **approval latency near zero** (approved seconds after the deploy was requested — no time to review), one person approving everything regardless of domain, a 100% approval rate (a gate that *never* says no isn't deciding anything), and approvers who can't, when asked, say what they checked. The fix is not "tell people to look harder" — it's to **ask what this gate is supposed to catch, and whether a human is the right detector.** If the thing is decidable, automate it and delete the human gate. If it genuinely needs judgment, make sure the approver has the *context and time* to exercise it, and route only the changes where their judgment applies. A gate that catches nothing should be *removed*, not performed.

### Q: What is artifact-level approval, and how do provenance and signing fit in?

> **Testing:** Whether you approve *a specific verifiable thing* versus a vague "the release."

**A.** Artifact-level approval means the approval (and the deploy) is bound to a **specific, immutable, content-addressed artifact** — `myapp@sha256:abcd…` — not a branch, a tag, or "tonight's build." This matters because mutable references can change *after* approval: approving "the `release` tag" is meaningless if the tag can be moved to point at different bytes afterward. You approve a digest, and that exact digest is what deploys.

**Provenance and signing** make this verifiable end to end. **SLSA** provenance is signed metadata attesting *how* the artifact was built (which source commit, which builder, which steps), so a verifier can confirm the thing you're approving came from the pipeline you trust and wasn't swapped. **Sigstore / cosign** signs the artifact (and its provenance), and the deploy gate **verifies the signature and the provenance policy before admitting it** — e.g. an admission controller that refuses any image not signed by your CI's identity with provenance from `main`. So "approval" becomes: *this exact digest, built by our trusted pipeline from this commit, signed, and meeting policy.* That's a control with teeth, and it closes the supply-chain gap a human "approve" click never could — the human never re-hashed the bytes; the verifier does.

---

## Scale & Scenarios

### Q: How do you design risk-tiered approvals so routine changes are fast and dangerous ones get scrutiny?

> **Testing:** Whether you can make the gate proportional instead of one-size-fits-all.

**A.** I tier by **blast radius and reversibility**, and the tier determines the gate:

| Tier | Examples | Gate |
| --- | --- | --- |
| **Standard (low risk)** | config flag flip, stateless service deploy, docs | Pre-approved standard change: peer review + automated checks + canary; **no human gate** |
| **Normal (medium risk)** | new feature, dependency bump, infra change | Peer review + checks + canary + **one team-local approver** |
| **High risk / one-way door** | schema migration, auth/payment changes, irreversible data ops | Peer review + checks + **named approver with domain context** + extra verification (migration dry-run, backup confirmed) |

The principle: **the gate weight tracks risk, and risk is mostly about reversibility.** A change you can roll back in 30 seconds with a canary catching it doesn't need a human; a change that drops a column does. The classification should itself be **automated where possible** (detect schema files in the diff, detect changes under `auth/`) so the *tier* isn't a judgment call that can be gamed. This keeps the velocity tax off the routine majority while genuinely concentrating scrutiny where a mistake is expensive and hard to undo.

### Q: A regulated org has a CAB that's adding three days to every release. Compliance insists it stays. What do you propose?

> **Testing:** The flagship scenario — turning the DORA evidence into an actual migration that satisfies auditors.

**A.** I don't open by attacking the CAB; I open by separating **what the auditor requires** from **how it's currently implemented.** The requirement is almost always *attributable authorization + separation of duties*, not "a weekly meeting." So my proposal is a phased replacement that delivers the control objective more rigorously:

1. **Strengthen the upstream gates first.** Enforced peer review (SoD satisfied close to the change), comprehensive automated tests and security scans, signed artifacts with provenance, and progressive delivery with automated rollback. This is the work that makes the CAB redundant — you can't remove the form until something does the function.
2. **Define standard changes.** With the change authority, agree the criteria for a pre-approved low-risk class and get *those criteria* approved once. Now routine deploys are authorized by standing policy, fully logged.
3. **Make the pipeline the system of record.** Auto-emit the immutable audit trail (who/SHA/when/policy) so the evidence is *better* than meeting minutes — explicit, uniform, tamper-evident.
4. **Reserve the CAB (or a lighter async review) for the residue** — changes that fail the standard-change criteria.
5. **Bring the data.** Show lead time before/after and change-fail rate holding flat, and cite the DORA finding that heavyweight approval didn't move CFR. Auditors respond to *stronger, demonstrable controls*, and most are satisfied that automated, enforced, logged criteria beat a discretionary meeting.

The framing that lands: *"I'm not removing the control — I'm replacing a discretionary, unevenly-applied gate with an explicit, uniformly-enforced, fully-audited one, and recovering three days of lead time while I do it."*

### Q: Design a production approval flow for a regulated fintech.

> **Testing:** Synthesis — can you assemble accountability, SoD, automation, and break-glass into one coherent design?

**A.** I'd build it around *attribution everywhere, human judgment only where it pays*:

- **Merge gate:** required peer review (SoD), all checks green, branch protection. This is the approval DORA endorses.
- **Build:** produce an **immutable, signed artifact** with **SLSA provenance**; nothing deploys that isn't signed by CI's identity from `main`.
- **Promotion to prod:** deploy gate **verifies signature + provenance**, then runs **progressive delivery** (canary with SLO analysis, auto-rollback). For **standard changes**, the green canary *is* the approval, recorded under the automation identity against the digest.
- **High-risk tier** (auth, payments, schema, money movement): an **explicit named human approval** via GitHub Environments / GitLab protected environments, with the diff, the provenance, and a required reason — concentrated exactly where regulators and reversibility demand it.
- **Audit trail:** the pipeline auto-emits who/what-digest/when/policy to an **immutable, exportable** store; the pipeline *is* the change-management system of record.
- **Change windows + break-glass:** automated freeze enforcement, plus a **documented, logged, alerting break-glass path** for emergencies that bypasses the *queue* but never the *recording* (more below).

The thread: every action is attributable, SoD holds via peer review and a distinct automation identity, the routine path is fast because it's automated, and human judgment is spent only on irreversible, high-blast-radius changes. That's defensible to an auditor and it doesn't crush delivery.

### Q: An approver rubber-stamped a bad deploy that caused an incident. How do you fix the *process* — not blame the person?

> **Testing:** Systems thinking. Whether you fix the gate or punish the human (the latter guarantees recurrence).

**A.** Blaming the approver is the wrong move and a guaranteed repeat — if the process *invites* rubber-stamping, anyone in that seat does the same. I'd run a blameless review and ask the diagnostic question: **what was this gate supposed to catch, and was a human the right detector?**

- If the thing was **decidable** (a check that should have been automated — a test, a scan, an SLO), the fix is to **automate it and remove the human gate.** The human was being asked to do a machine's job and predictably did it poorly. Add the missing automated check; delete the theatre.
- If it **genuinely needed judgment** but the approver **lacked context or time**, fix the *conditions*: give the approver the diff, the provenance, the blast-radius summary, and route only changes where their judgment applies — don't flood them with deploys they can't meaningfully assess.
- Regardless, **add a detection/recovery layer** so a bad deploy doesn't depend on the gate being perfect: canary analysis with **auto-rollback** means the *system* catches the regression even when the human misses it. Defense in depth beats a single human chokepoint.

The principle to state explicitly: **a rubber-stamp is a signal the gate is mis-designed, not that the person is careless.** Fix the gate. And measure approval latency afterward to confirm the new gate is actually being exercised, not performed.

### Q: How do you move an org from manual go/no-go to automated promotion?

> **Testing:** Migration sequencing — you can't flip the switch; you earn the trust.

**A.** Incrementally, building evidence at each step so the org *trusts* the automation before you remove the human:

1. **Make the human decision's inputs explicit.** Whatever the human checks at the go/no-go — tests, error rates, "did staging look ok" — write it down. You can't automate a decision you can't articulate.
2. **Automate those checks as *advisory* first.** Run the canary analysis and SLO checks alongside the human gate and surface their verdict. Let people compare the machine's call to theirs for a few weeks. This builds trust and exposes gaps.
3. **Flip low-risk changes to automated promotion** (standard changes) once the advisory signal has proven reliable. Keep the human only for higher tiers.
4. **Add auto-rollback** so the safety net doesn't depend on the gate. This is what makes risk-takers comfortable removing the human — the system self-heals.
5. **Widen the automated tier** as confidence grows, measuring change-fail rate to prove safety isn't degrading.

The sequencing point: you **earn** the removal of the human gate by first showing the automation makes the *same or better* call, *and* by adding rollback so a miss is cheap. Ripping out the human on day one — before the automated checks are trusted and before rollback exists — is how you get an outage and a mandate to put the CAB back. Go advisory, prove it, then promote.

### Q: How do you reason about change freezes and break-glass without creating a new bottleneck or an audit hole?

> **Testing:** Whether you handle the exceptions coherently — freezes and emergencies are where gates get bypassed badly.

**A.** **Freezes** (e.g. a holiday code freeze, a freeze during a critical event) should be **enforced automatically by the pipeline**, not by email and hope — the gate checks the freeze calendar and blocks promotion. But a blanket freeze is a blunt instrument; the better version freezes the *risky tiers* and still allows *standard changes* and, critically, *fixes*, because freezing emergency patches is how a freeze turns a small incident into a big one.

**Break-glass** is the emergency override for when the normal gate (or the freeze) can't wait — a sev-1 fix at 3 a.m. The design rule: **break-glass bypasses the *queue and the wait*, never the *recording*.** It must be a documented, deliberately-distinct path that (a) requires a stated reason, (b) **fires an alert** so it can't be used quietly, (c) is fully logged with the same who/what/when attribution, and (d) triggers a **mandatory after-the-fact review**. That way you get speed in a genuine emergency *without* an audit hole — every break-glass use is loud, attributable, and reviewed. The anti-patterns are equal and opposite: a freeze so rigid it blocks the fix for the incident, and a break-glass so quiet it becomes the *normal* way to skip the gate. (Both are explored in depth in [07 — Break-glass & Bypass](../07-break-glass-and-bypass/interview.md).)

### Q: How do you measure whether your approval gates are worth their cost?

> **Testing:** Staff-level — treating the gate itself as something to be measured and justified, not assumed.

**A.** I measure two things: the **cost** of the gate and whether it **catches anything**.

- **Cost** is **approval wait time** as a component of lead time. If a gate adds a day of waiting, that day is a real, recurring tax on every change — and it shows up in your DORA lead-time metric. I'd track time-in-approval explicitly.
- **Effectiveness** is the rejection-with-cause rate: **how often does this gate actually stop a bad change for a real reason?** A gate with a ~100% approval rate and near-zero approval latency is catching nothing — it's pure cost. A gate that *does* reject changes for substantive reasons is earning its keep.

Then I put them together: if a gate adds a day of lead time and has never rejected anything for cause, it's a strong candidate for deletion or automation. The staff-level framing: **every gate must justify its existence against the lead-time it costs**, and the DORA finding gives me the prior — heavyweight external approval costs lead time without improving change-fail rate, so the burden of proof is on *keeping* such a gate, not on removing it. "Does this gate catch anything?" is the question that should be asked of *every* approval, periodically, with data.

---

## Rapid-Fire

> Short questions to check breadth. One or two sentences each.

- **Q: Deploy approval vs code review?** A: Code review asks "is this diff correct to merge"; deploy approval asks "is now a safe time to release this artifact to this environment."
- **Q: The one DORA finding to know?** A: Heavyweight external (CAB-style) approval hurts lead time with **no** improvement in change-fail rate; peer review helps.
- **Q: Why author ≠ approver?** A: Separation of duties — prevents unilateral, unchecked self-authorization (SOX/SOC 2); best satisfied by peer review close to the change.
- **Q: GitHub mechanism for a prod approval?** A: Environments with required reviewers; the job pauses until a named reviewer approves, and it's recorded.
- **Q: GitLab equivalent?** A: Protected environments — specify who may deploy and who must approve the deployment job.
- **Q: What is a standard change?** A: A pre-approved *class* of low-risk change; instances that meet the criteria deploy without a fresh approval, fully logged.
- **Q: What must an audit trail contain?** A: Who authorized, what artifact (a digest), when, linked to the change/ticket/deployment — auto-emitted by the pipeline.
- **Q: Who's the approver when a pipeline deploys?** A: The humans upstream (peer review + policy approval); the pipeline executes under a distinct automation identity.
- **Q: A canary that auto-promotes on green SLOs — is that an approval?** A: Yes — a *measured* one; better than a human for "is this build behaving acceptably in prod."
- **Q: Tools for SLO-based automated promotion?** A: Argo Rollouts, Flagger, with analysis against Prometheus/Datadog.
- **Q: How do you spot a rubber-stamp gate?** A: Near-zero approval latency, ~100% approval rate, one person approving everything — it catches nothing.
- **Q: Approve a tag or a digest?** A: A digest (content-addressed) — tags are mutable and can change after approval.
- **Q: What do SLSA and cosign add?** A: SLSA attests *how* the artifact was built; cosign signs it; the gate verifies both before admitting it.
- **Q: Break-glass — what may it bypass?** A: The queue and the wait, never the recording — it must alert, log attribution, and trigger a post-review.
- **Q: A gate adds a day of lead time and has never rejected anything?** A: Delete it or automate it — it's pure cost; the burden is on keeping it.
- **Q: "The auditor requires a CAB" — true?** A: Almost never — auditors require attributable authorization + SoD, which standard changes satisfy more rigorously.

---

## Red Flags / Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**

- "All production changes need a human approval" — stated as dogma, with no mention of accountability vs control or the DORA evidence.
- Defending CABs on instinct, or assuming "the auditor requires it" without examining the control objective.
- Conflating *audit trail* (recording) with *human approval* (a person blocking) — they justify different designs.
- Treating separation of duties as "needs a manager to sign" rather than "needs a second competent party," i.e. peer review.
- Putting humans on decidable checks (tests, scans, SLOs) and calling it a gate.
- Approving a mutable tag or "the latest build" instead of a specific signed digest.
- No notion that rubber-stamping is a *design* failure of the gate, not a *character* failure of the approver.
- Break-glass with no logging/alert, or a freeze so rigid it blocks the incident fix.

**Green flags:**

- Naming the distinction first — accountability vs control, decidable vs judgment — before reaching for a policy or tool.
- Citing the DORA finding precisely: heavyweight external approval hurts lead time, doesn't improve change-fail rate; peer review helps.
- Reaching for **pre-approved standard changes** to resolve the velocity-vs-compliance tension.
- Framing the audit trail as an automatic byproduct of the pipeline, with who/digest/when/policy.
- Treating a green canary / SLO analysis as a *better* approval than a human for the thing it covers.
- Insisting on artifact-level approval with signing + provenance (SLSA/cosign).
- Asking "what does this gate catch, and what does it cost in lead time?" of *every* approval.
- Handling exceptions coherently: freezes enforced automatically but allowing fixes; break-glass that's loud, logged, and reviewed.

---

## Cheat Sheet

| Concept | One-line answer |
| --- | --- |
| **Deploy approval** | A recorded decision to promote a specific artifact to a specific environment. |
| **vs code review** | Review = "correct to merge?"; approval = "safe to release *now*?" |
| **The DORA finding** | Heavyweight external approval: −lead time, **no** change-fail benefit; peer review helps. |
| **Separation of duties** | Author ≠ approver; best satisfied by peer review close to the change. |
| **Audit trail** | Who / what-digest / when / policy — auto-emitted, immutable, pipeline = system of record. |
| **Automation identity** | Pipeline executes under a distinct service/workload identity; humans decided upstream. |
| **CAB critique** | Goals fine, implementation (batched, distant, periodic) is the problem. |
| **Standard change** | Pre-approve a *class* once; instances meeting criteria deploy without fresh approval. |
| **Decidable → automate** | Tests, scans, SLOs, provenance — machine checks, no human. |
| **Judgment → human** | Timing, one-way doors, known-fragile areas — reserve humans here. |
| **Canary as approval** | Progressive delivery (Argo Rollouts/Flagger) auto-promotes on green SLOs, auto-rolls back. |
| **Rubber-stamp tell** | ~0 latency, ~100% approval rate, one approver — catches nothing. |
| **Artifact-level** | Approve a signed **digest** + provenance (SLSA/cosign), not a mutable tag. |
| **Risk-tiered** | Gate weight tracks blast radius and reversibility. |
| **Break-glass** | Bypass the wait, never the recording; alert + log + post-review. |
| **Gate ROI test** | Approval wait time (cost) vs reject-with-cause rate (value). |

---

## Summary

- The bank reduces to four distinctions in costumes: **accountability vs control**, **author vs approver**, **evidence vs theatre**, **decidable vs judgment**. Name the distinction first; the policy follows.
- **Fundamentals:** a deploy approval is a *recorded decision to promote a specific artifact to a specific environment* — distinct from code review (correctness at merge) by being about *timing, blast radius, and accountability* at release. Prod needs **recorded accountability**, which is not the same as a human in the path.
- **Separation of duties** is the one approval control that's genuinely load-bearing — and it's best satisfied by **peer review close to the change**, not a remote board. The audit trail (who/digest/when/policy) should be an **automatic byproduct of the pipeline**, with deployments executed under a **distinct automation identity** so SoD survives automation.
- **The DORA evidence is the differentiator:** heavyweight external approval **hurts lead time with no improvement in change-fail rate**, while peer review helps. "Approval by people distant from the change is risk theatre." The **pre-approved standard change** is the pattern that replaces a CAB while satisfying — even strengthening — the controls auditors actually require.
- **Manual vs automated:** automate the decidable (tests, scans, SLOs, provenance), reserve humans for judgment. A green **canary / SLO analysis** is a *better* approval than a human for behavior-in-prod; **rubber-stamps** are theatre you detect with latency/approval-rate data; approve a **signed digest with provenance** (SLSA/cosign), never a mutable tag.
- **Scale & judgment:** tier gates by blast radius and reversibility; measure every gate against the **lead time it costs** and whether it **catches anything**; enforce freezes automatically (but allow fixes); make break-glass loud, logged, and reviewed. Fix rubber-stamps by fixing the *gate*, not blaming the person — and add auto-rollback so safety never depends on a single human chokepoint.

---

## Further Reading

- *Accelerate: The Science of Lean Software and DevOps* (Forsgren, Humble, Kim) — the change-approval chapter is the primary source for the CAB / lead-time / change-fail-rate finding cited throughout this page.
- **DORA / State of DevOps reports** and the DORA "Streamlining change approval" capability guide — the ongoing research behind "move approval closer to the work."
- **GitHub Docs — Environments, deployment protection rules, and required reviewers**; **GitLab Docs — Protected environments and deployment approvals** — primary sources for the platform mechanisms.
- **Argo Rollouts** and **Flagger** documentation — analysis templates and automated, metric-driven promotion/rollback.
- **SLSA framework** and **Sigstore / cosign** docs — artifact provenance and signature verification as a deploy gate.
- The [junior.md](junior.md) and [senior.md](senior.md) pages of this topic — the conceptual grounding and the deep, scaled treatment that this question bank sits between.

---

## Related Topics

- [02 — Branch Protection & Merge Policies](../02-branch-protection-and-merge-policies/interview.md) — the merge-time gate and peer review, the approval the DORA evidence *supports*.
- [05 — Gate Design: Speed vs Safety](../05-gate-design-speed-vs-safety/interview.md) — the broader framework for making any gate proportional to risk.
- [07 — Break-glass & Bypass](../07-break-glass-and-bypass/interview.md) — emergencies, freezes, and how to bypass the wait without an audit hole.
- [Release Engineering](../../release-engineering/) — promotion pipelines, progressive delivery, and where these gates live end to end.
- [Security](../../../../Security/) — separation of duties, supply-chain provenance, and the controls these approvals enforce.
