# Deploy Approvals & Sign-offs — Senior Level

> **Roadmap:** [Quality Gates](../README.md) → Deploy Approvals & Sign-offs
> *The middle page showed you how to wire a manual approval step. This page is about the decision underneath it: what the DORA data actually says about human approval, which judgements you can automate away, how compliance becomes a byproduct of the pipeline instead of a meeting, and how to build approval gates that catch real risk instead of manufacturing latency and false audit comfort.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The DORA Evidence on Human Approval](#core-concept-1--the-dora-evidence-on-human-approval)
5. [Core Concept 2 — The Decision Hierarchy: Automate the Decidable](#core-concept-2--the-decision-hierarchy-automate-the-decidable)
6. [Core Concept 3 — Compliance-as-Code and Continuous Compliance](#core-concept-3--compliance-as-code-and-continuous-compliance)
7. [Core Concept 4 — Separation of Duties and the Automation-Identity Problem](#core-concept-4--separation-of-duties-and-the-automation-identity-problem)
8. [Core Concept 5 — Automated Judgement: Progressive Delivery as the Modern Approval](#core-concept-5--automated-judgement-progressive-delivery-as-the-modern-approval)
9. [Core Concept 6 — Artifact-Level Gating and the Supply Chain](#core-concept-6--artifact-level-gating-and-the-supply-chain)
10. [Core Concept 7 — Risk-Tiered Approval and Deployment Windows](#core-concept-7--risk-tiered-approval-and-deployment-windows)
11. [Real-World Examples](#real-world-examples)
12. [Mental Models](#mental-models)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Designing approval as a control system — where humans add judgement, where automation decides, and where the evidence is generated as a side effect rather than chased after the fact.**

By the middle level you can configure a GitHub Environment with required reviewers, gate a production deploy behind a manual approval, and explain why author-approves-own-deploy is a red flag. That makes you operationally competent. The senior jump is different: you decide *whether a given approval should exist at all*, and if it does, *who or what* should make it.

That decision is not a matter of taste — there is data. The DORA program (the research behind *Accelerate* and the annual *State of DevOps* reports) measured change-approval processes across thousands of organizations and found that heavyweight, external, distant human approval — the classic Change Advisory Board — does **not** improve change-fail rate and significantly *hurts* throughput and lead time. That single finding should reshape how you build approval gates: the default human approval is often risk theatre, and your job is to replace it with controls that actually move the needle — peer review, automated checks, and progressive delivery that promotes or rolls back on real signal.

This page is that reframe, made concrete. We will look at the evidence, the decision hierarchy it implies, how to turn separation-of-duties and change-management requirements into automated evidence-generating controls (so an audit is a *query*, not a scramble), and how canary analysis turns "metrics are the approver" from a slogan into an `AnalysisTemplate` that promotes a release on its SLOs.

---

## Prerequisites

- **Required:** You've internalized [middle.md](middle.md) — GitHub Environments, required reviewers, deployment protection rules, the author≠approver principle.
- **Required:** You understand SLOs, error budgets, and basic statistical comparison (percentiles, a two-sample test) well enough to reason about [05 — Gate Design](../05-gate-design-speed-vs-safety/senior.md).
- **Helpful:** You've sat in (or run) a real change-approval meeting and felt the gap between the ceremony and the risk it claimed to manage.
- **Helpful:** Working familiarity with a progressive-delivery controller (Argo Rollouts, Flagger, or Spinnaker) and a container registry with digests.

---

## Glossary

| Term | Meaning |
|---|---|
| **CAB** | Change Advisory Board — a heavyweight, often cross-team body that reviews and approves changes before release. The thing DORA measured and found wanting. |
| **SoD** | Separation (Segregation) of Duties — no single person controls a sensitive process end-to-end; the classic instance is *author ≠ approver/deployer*. |
| **Compliance-as-code** | Encoding regulatory/control requirements (SoD, required approvals, provenance) as automated, evidence-generating checks rather than manual procedures. |
| **ITGC** | IT General Controls — the control family auditors test for SOX, covering change management, access, and operations. |
| **Provenance / attestation** | Cryptographically signed metadata about *how* and *from what* an artifact was built (SLSA, in-toto), binding the approved thing to the deployed thing. |
| **ACA / canary analysis** | Automated Canary Analysis — promoting or rolling back a release by statistically comparing the canary's metrics against a baseline. |
| **Error budget** | The allowable amount of SLO violation over a window; the quantitative input that lets metrics, not a human, gate a promotion. |
| **Break-glass** | A pre-planned, audited emergency path that bypasses normal approval (covered in depth in [07](../07-break-glass-and-bypass/senior.md)). |

---

## Core Concept 1 — The DORA Evidence on Human Approval

Start with the data, because it overturns the intuition most approval processes are built on.

The DORA research program (Forsgren, Humble, Kim; *Accelerate*, 2018, and the subsequent *State of DevOps* reports) studied change-approval processes as a predictor of software-delivery performance. The headline finding is blunt:

- **External approval of changes** — a separate body (a CAB) or a senior manager outside the team approving each change — had **no correlation with lower change-fail rate**. In the analysis it trended *slightly negative*: heavyweight approval was associated with *higher* failure rates, not lower.
- It had a **clear negative correlation with throughput and lead time.** Changes waited for the meeting; batches grew; deployments got rarer and bigger; each one carried more risk.
- The processes that *did* correlate with both stability and speed were **peer review** (a teammate reviews the change at PR time) and **automated checks** (tests, scans, policy) — lightweight, close to the change, and fast.

The mechanism is not mysterious. A reviewer who is distant from the change — different team, days later, dozens of changes in the queue — has neither the context to spot a real defect nor the incentive to block a green-looking change. So they approve. The approval adds latency without adding signal. Worse, it adds *false confidence*: the organization believes the gate is catching risk, so it under-invests in the controls (tests, canaries, observability) that actually would.

> **Key insight:** The DORA data says distant human approval is risk theatre. It reliably *costs* you lead time and throughput, and it does *not* buy you stability. Any approval gate you keep has to justify itself against that null result — "we've always required it" and "it makes auditors comfortable" are not justifications, they are the failure mode the data is describing.

This does not mean *no* human ever approves *anything*. It means the burden of proof flips. The senior question becomes: **for this specific change, does a human looking at it add judgement that automation cannot supply?** Sometimes yes — a one-way-door architectural change, a data migration with no clean rollback, a regulated change where a named human accountability is legally required. Far more often, no — and those are the approvals to delete or automate.

---

## Core Concept 2 — The Decision Hierarchy: Automate the Decidable

The reframe DORA forces is a triage. Every gate in front of a deploy is answering some question; sort those questions by who is best placed to answer them.

| Question the gate asks | Best decider | Why |
|---|---|---|
| Do the tests pass? Is the artifact signed? Is coverage above threshold? | **Automation** | Decidable, objective, repeatable. A human adds only latency and transcription error. |
| Does this code do the right thing? Is the design sound? | **Peer review** (PR) | Needs context and judgement; the author's teammate has both, *now*, while the change is small. |
| Is the canary healthy — latency, error rate, saturation within SLO? | **Automation (canary analysis)** | A metric comparison is a statistics problem, not an opinion. Faster and more consistent than a human staring at a dashboard. |
| Is this a genuinely irreversible / high-blast-radius change that warrants a named accountable owner? | **A human, deliberately** | Judgement and accountability are the actual product here — this is where human approval earns its cost. |
| Did the right people approve, in the right separation, with evidence? | **Policy-as-code** | A control assertion, machine-checkable — see [06 — Policy-as-Code](../06-policy-as-code/senior.md). |

The design rule that falls out: **automate the decidable, reserve humans for genuine judgement, and make the compliance record a byproduct of both.** A pipeline built this way has *fewer* human approvals than a naive one, and the ones it keeps are meaningful — which, not coincidentally, is what makes people actually read them instead of rubber-stamping.

> **Key insight:** "More approvals" is not "more safety." Each gate has a cost (lead time, batch size, attention) and a benefit (risk caught). DORA shows distant-human gates are nearly all cost. The senior move is to *subtract* low-signal approvals and *add* high-signal automated ones — and to be able to defend each remaining gate by what it has actually caught (see the metrics in [Core Concept 7](#core-concept-7--risk-tiered-approval-and-deployment-windows)).

---

## Core Concept 3 — Compliance-as-Code and Continuous Compliance

The single biggest objection to deleting approvals is "but the auditors require sign-off." Understanding what auditors *actually* require dissolves most of that objection — and turns compliance from a meeting into a query.

Read what the controls say, not what folklore says they say:

- **SOC 2, CC8.1 (Change Management):** the entity *authorizes, designs, develops, tests, approves, and implements* changes through a defined process. It demands a *process* with evidence — it does not mandate a CAB meeting or a manual signature. An automated, logged, segregated pipeline satisfies it.
- **SOX ITGC (change management):** controls must ensure changes are authorized, tested, and approved before production, with *segregation of duties* between development and deployment. Again: authorization + segregation + evidence. The control is satisfied by a pipeline that enforces author≠deployer and records who approved what.
- **PCI-DSS v4.0, Requirement 6.x:** change-control procedures, separation of dev/test from production, and review of significant changes. Same shape.
- **ISO 27001 (Annex A change-management controls):** changes to systems are subject to change-management procedures.

Every one of these wants the same three things: the process is **repeatable**, **evidenced**, and **segregated**. None of them asks for a human bottleneck. What they ask for is *proof*. So generate the proof automatically:

1. **Immutable deploy records** — for every production deploy, an append-only entry: *who* triggered it, *what* (the exact artifact digest and source SHA), *when*, *which approver(s)* satisfied policy, and *which checks* passed.
2. **Automated SoD enforcement** — the pipeline mechanically refuses author-as-approver and author-as-deployer (next section), so segregation is a property of the system, not a thing humans remember.
3. **Traceability** — a queryable chain: deploy → artifact digest → PR → linked ticket → approval. The auditor asks "show me the authorization for the change deployed at 14:32 on the 3rd," and you run a query.

```json
// deploy-record-2026-06-22T14:32Z.json — emitted by the pipeline, written to an append-only store (e.g., object lock / WORM bucket)
{
  "deploy_id": "dpl_9f3a21",
  "environment": "production",
  "service": "checkout-api",
  "artifact": "registry.example.com/checkout-api@sha256:8b2f...c4",
  "source_commit": "df36432a...",
  "pull_request": "https://github.com/acme/checkout/pull/4821",
  "linked_issue": "JIRA-7781",
  "triggered_by": "deploy-bot[automation]",
  "approvals": [
    { "actor": "alice", "role": "service-owner", "at": "2026-06-22T14:28:11Z", "method": "github-environment-review" }
  ],
  "separation_of_duties": { "author": "bob", "approver": "alice", "ok": true },
  "checks_passed": ["unit", "integration", "sast", "image-signature-verify", "policy-gate"],
  "provenance": "https://attest.example.com/checkout-api/sha256:8b2f...c4",
  "timestamp": "2026-06-22T14:32:04Z"
}
```

> **Key insight:** Auditors want *repeatable + evidenced + segregated*, not *slow*. When SoD and approval are enforced in code and every deploy emits an immutable record, "the audit" stops being a quarterly fire drill where engineers reconstruct who-approved-what from Slack scrollback, and becomes a `SELECT` over your deploy records. That is the entire promise of continuous compliance: compliance is a *byproduct* of the pipeline, not a separate activity bolted on top. The policy that enforces it lives in [06 — Policy-as-Code](../06-policy-as-code/senior.md).

---

## Core Concept 4 — Separation of Duties and the Automation-Identity Problem

SoD is the control that survives the DORA critique, because it's about *accountability and fraud resistance*, not about a distant reviewer guessing whether code is good. The core instance: the person who **authored** a change cannot be the only person who **approves** or **deploys** it. One compromised or careless account should not be able to ship arbitrary code to production unobserved.

Enforcing it mechanically (GitHub Environments + branch protection) looks like this:

```yaml
# .github/environments — conceptual; configured via repo settings / API
production:
  deployment_branch_policy:
    protected_branches: true          # only protected branches can deploy here
  reviewers:
    - type: Team
      id: service-owners              # a TEAM, not one person — kills the bus-factor of a single approver
  prevent_self_review: true           # the actor who triggers cannot be the approver  (author ≠ approver)
```

```yaml
# branch protection on main — the upstream half of SoD
required_pull_request_reviews:
  required_approving_review_count: 1
  require_code_owner_reviews: true
  dismiss_stale_reviews: true
require_signed_commits: true          # ties the author identity to a key (see Security)
```

`prevent_self_review` plus "approver is a team, not a person" gives you author≠approver *and* removes the single-approver bottleneck in one move. (See [02 — Branch Protection](../02-branch-protection-and-merge-policies/senior.md) for the merge-time half.)

Then comes the genuinely hard part, the one that trips up teams modernizing past manual gates: **who approves an automated deploy?** Continuous deployment means a *bot* pushes to production with no human in the loop at deploy time. The naive reaction is "then there's no separation of duties." That's the wrong frame. The resolution:

> **Key insight:** When deployment is automated, **the policy is the approver, and provenance is the signature.** The "approval" is no longer a human clicking a button; it is the satisfied set of controls — peer-reviewed-and-merged-by-someone-else, all checks green, artifact signed, built by a trusted pipeline from a known SHA — recorded immutably. Separation of duties is preserved because the *author* still cannot unilaterally ship: the change had to pass a reviewer (a different human) and a non-bypassable pipeline (a different *system*) before the bot deployed it. The automation identity has *no authority of its own*; it only executes what the policy already authorized.

This reframing is what lets a SOX-regulated shop run continuous deployment with a straight face. The controls to make it real:

- **Distinct, least-privilege automation identities.** The CI identity that *builds and signs* is not the CD identity that *deploys*; the deploy identity can deploy but cannot, say, alter the audit log or grant itself permissions. A compromised build identity can't deploy; a compromised deploy identity can't forge provenance.
- **Provenance signing.** The pipeline signs the artifact and emits a SLSA-style attestation (next section). The deploy gate verifies the signature, so "the policy approved this" is cryptographically checkable — the bot can only deploy artifacts that the *build* system vouched for.
- **The small-team tension, named honestly.** On a two-person team, strict author≠approver can mean nobody can ship when one person is out. Don't pretend the risk is the same as at a bank. Compensating controls: require a second approver *only* for production and high-risk tiers; allow self-merge to lower environments; and rely on the *automated* gates (tests, canary) plus an immutable record as the primary control, with the human second-set-of-eyes as a goal rather than a hard block. The honest senior position is that SoD is a spectrum priced to the actual fraud/error risk, not a binary you either pass or fail.

---

## Core Concept 5 — Automated Judgement: Progressive Delivery as the Modern Approval

Here is where "delete the human gate" becomes constructive rather than merely subtractive. The thing a careful operator was *trying* to do with a manual go/no-go — "ship a bit, watch it, promote only if it looks healthy" — is exactly what progressive delivery automates, and does better, because a controller watches metrics more consistently and reacts faster than a human staring at Grafana at 2 a.m.

The model is **canary analysis**: deploy the new version to a small slice of traffic, compare its metrics against a baseline, and *promote or roll back automatically* based on whether it stays within SLO and error budget. The metrics are the approver.

Two controllers dominate the Kubernetes world — **Argo Rollouts** (with `AnalysisTemplate`) and **Flagger** — and both express the same idea: a set of metric queries with pass/fail thresholds gating each promotion step. Here is an Argo Rollouts `AnalysisTemplate` that promotes a canary only if its success rate and latency hold:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: AnalysisTemplate
metadata:
  name: canary-slo-gate
spec:
  args:
    - name: service-name
  metrics:
    - name: success-rate
      interval: 1m
      count: 5                       # five measurements → resists a single noisy sample
      successCondition: "result[0] >= 0.99"   # ≥ 99% success keeps the canary alive
      failureLimit: 1                # one breach aborts and rolls back
      provider:
        prometheus:
          address: http://prometheus.monitoring:9090
          query: |
            sum(rate(http_requests_total{service="{{args.service-name}}",code!~"5.."}[2m]))
            /
            sum(rate(http_requests_total{service="{{args.service-name}}"}[2m]))
    - name: p99-latency-ms
      interval: 1m
      count: 5
      successCondition: "result[0] <= 300"    # SLO: p99 ≤ 300ms
      failureLimit: 1
      provider:
        prometheus:
          address: http://prometheus.monitoring:9090
          query: |
            histogram_quantile(0.99,
              sum(rate(http_request_duration_seconds_bucket{service="{{args.service-name}}"}[2m])) by (le)
            ) * 1000
```

```yaml
# the Rollout wires the template into a staged promotion — each pause is an automated gate, not a human one
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata: { name: checkout-api }
spec:
  strategy:
    canary:
      steps:
        - setWeight: 5
        - pause: { duration: 10m }            # SOAK / bake window — let real traffic exercise it
        - analysis:
            templates: [{ templateName: canary-slo-gate }]
            args: [{ name: service-name, value: checkout-api }]
        - setWeight: 25
        - pause: { duration: 10m }
        - analysis:
            templates: [{ templateName: canary-slo-gate }]
            args: [{ name: service-name, value: checkout-api }]
        - setWeight: 100                        # full promotion only after every gate passed
```

A few senior nuances the YAML encodes:

- **Bake / soak windows (`pause`)** exist because some failures only appear under sustained real traffic — memory leaks, cache cold-start effects, slow connection-pool exhaustion. A naive canary that promotes in 30 seconds catches none of these. The window is the price of catching slow failures; tune it to the failure modes you actually see.
- **`count` and `failureLimit`** are the difference between a robust gate and a flaky one. A single bad sample shouldn't roll back a good release (false positive → people stop trusting the gate), and one good sample shouldn't promote a bad one. This is a statistics problem, and treating it like one is the whole game.

That last point is where **statistical canary analysis** comes in. Netflix's **Kayenta** (the engine behind Spinnaker's Automated Canary Analysis) doesn't just threshold a single number — it runs a **Mann-Whitney U test** on the *distributions* of canary vs baseline metric streams, producing a per-metric pass/marginal/fail and an aggregate score. The Mann-Whitney choice is deliberate: it's a non-parametric test, so it doesn't assume the latency distribution is normal (it isn't — latency is heavy-tailed), and it compares *canary vs a baseline of the same code/version* rather than canary vs the old production version, which controls for "this hour is just busier than last hour." That apples-to-apples baseline (deploy a second copy of the *current* version as the control) is the subtle part teams miss.

> **Key insight:** Progressive delivery is the *modern form* of deploy approval: the handoff is from "a human decides go/no-go from a dashboard" to "an SLO/error-budget gate decides, with statistics, and rolls back automatically." It's not just faster — it's *more rigorous*, because a Mann-Whitney test on a metric distribution is a better detector of a regression than a tired human eyeballing a graph, and it never forgets to check. Where the manual gate produced latency and false confidence, the automated canary produces an actual decision backed by data — and an immutable record of that decision for the audit.

The honest boundary: automated canary analysis catches what your *metrics* can see. It will not catch a correctness bug that doesn't move latency/error rate, a data-corruption bug that surfaces days later, or a security regression. So canary gates *complement* peer review and pre-deploy checks; they don't replace them. The full speed-vs-safety tradeoff of *how aggressive* to make these gates is the subject of [05](../05-gate-design-speed-vs-safety/senior.md).

---

## Core Concept 6 — Artifact-Level Gating and the Supply Chain

A subtle but critical flaw lurks in naive approval flows: people approve a *branch* or a *pull request*, but they deploy an *artifact* — and between "approve `main`" and "deploy," `main` may have moved, the build may be non-deterministic, or a compromised CI step may have swapped the bits. The approval and the deployed thing have drifted apart. The fix is to **approve a specific immutable artifact by digest, and cryptographically bind the approved thing to the deployed thing.**

Concretely: gate on `registry.example.com/checkout-api@sha256:8b2f...c4`, never on `checkout-api:latest` or "whatever main builds to." A digest is content-addressed and immutable; a tag is a mutable pointer that an attacker (or a careless `:latest` push) can move out from under your approval.

Binding the approved artifact to its origin is the job of **provenance and attestation**, the supply-chain layer:

- **SLSA** (Supply-chain Levels for Software Artifacts) defines provenance: signed, tamper-evident metadata describing *what built this artifact, from what source, with what builder*. Higher SLSA levels require the provenance to be generated by a trusted, isolated build service that the developer can't tamper with — so the attestation actually means something.
- **in-toto** is the framework for attesting each step of the supply chain (build, test, scan), so you can verify the artifact passed each required step *in order*.
- **cosign** (Sigstore) signs artifacts and attestations and stores the signatures alongside the image, so verification is a single command.

```bash
# build → sign → attest the EXACT artifact (by digest), in CI under the build identity
DIGEST=$(crane digest registry.example.com/checkout-api:build-4821)
cosign sign registry.example.com/checkout-api@${DIGEST}                 # keyless, OIDC-backed
cosign attest --predicate slsa-provenance.json --type slsaprovenance \
  registry.example.com/checkout-api@${DIGEST}                           # bind provenance to the digest
```

Then the deploy gate *refuses to deploy anything that isn't signed and attested* — enforced at admission, so it's not bypassable by a hand-rolled `kubectl apply`:

```yaml
# Kyverno ClusterPolicy — admission gate: only signed, attested images run in production
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata: { name: require-signed-attested-images }
spec:
  validationFailureAction: Enforce
  rules:
    - name: verify-signature-and-provenance
      match:
        any: [{ resources: { kinds: [Pod], namespaces: ["production"] } }]
      verifyImages:
        - imageReferences: ["registry.example.com/checkout-api*"]
          attestors:
            - entries: [{ keyless: { issuer: "https://token.actions.githubusercontent.com" } }]
          attestations:
            - predicateType: https://slsa.dev/provenance/v1
              conditions:
                - all:
                    - key: "{{ regex_match('^refs/heads/(main|release/.*)$', '{{ source_ref }}') }}"
                      operator: Equals
                      value: true        # only artifacts built from main/release branches may run
```

> **Key insight:** Approve the *digest*, not the branch — and use provenance so the thing approved is provably the thing deployed. Without artifact-level gating, your careful approval secures a *pointer*, and pointers move. With signing + attestation + an admission policy, the chain is closed: a deploy can only happen for an artifact that a trusted builder produced from an authorized source, that passed the required steps, and that someone (or some policy) approved — and that's verifiable after the fact. This is where deploy approval meets [Security](../../../../Security/); the two are the same control viewed from two angles.

---

## Core Concept 7 — Risk-Tiered Approval and Deployment Windows

One-size-fits-all approval is the other half of the DORA failure: if *every* change needs the heavyweight gate, you've maximized latency to protect against the rare dangerous change, and taught everyone to rubber-stamp the common safe one. The senior design is **risk-tiered**: the gate is a function of the change's blast radius and reversibility.

| Change type | Reversibility | Appropriate gate |
|---|---|---|
| Feature-flag flip, config value | Instant (flip back) | Automated checks + canary; no human approval |
| Code change behind a flag | Easy (disable flag) | Peer review + automated canary |
| Stateless service deploy | Easy (roll back image) | Peer review + canary analysis |
| Database schema migration | Hard / one-way | Peer review **+ named human approval** + expand-contract plan + tested rollback |
| Change during a freeze window | n/a | Blocked by policy; needs break-glass ([07](../07-break-glass-and-bypass/senior.md)) |

A config flag flip and a destructive schema migration are not the same risk and must not face the same gate. Encode the tier as policy (link to [06](../06-policy-as-code/senior.md)) so the gate is selected mechanically from the change's properties, not negotiated per-change.

**Deployment windows and freezes** are themselves a form of approval policy — "no deploys during the Black Friday freeze," "no Friday-afternoon deploys to payments." Encode them as policy, not as a tribal rule someone forgets. But every freeze *must* ship with a designed **break-glass** path, because the freeze must not block *incident remediation* — the situation where you most urgently need to deploy is precisely a production incident during a freeze. A freeze with no break-glass is a freeze that turns an incident into an outage. (The break-glass mechanism — pre-authorized, audited, time-boxed — is the whole subject of [07](../07-break-glass-and-bypass/senior.md).)

**Metrics — does the gate catch anything?** A senior treats approval gates as hypotheses to be tested, not articles of faith:

- **Approval wait time is part of lead time.** Instrument it. The interval from "ready to deploy" to "approved" is pure latency you're adding; if it's large and the gate rarely blocks anything, you have quantified the DORA finding in your own org. (Feeds directly into engineering-metrics / DORA lead-time tracking.)
- **Approval → incident correlation.** Of the changes a gate *blocked or flagged*, how many would have caused an incident? Of the incidents you had, how many slipped through an approval that said "go"? If a gate approves everything and still rides alongside incidents, it is catching nothing — it's the rubber stamp the data warned about, and you should replace it with an automated control that *can* catch something.

> **Key insight:** Measure your gates. An approval that has never blocked a bad change, sitting in the lead-time path of every deploy, is not a safety control — it's latency with a false-confidence surcharge. The risk-tiered design keeps human judgement where it pays (irreversible, high-blast-radius changes) and removes it where it's theatre (reversible, flag-guarded, canary-covered changes). And every freeze is a deploy-approval policy that is incomplete until it has a break-glass.

---

## Real-World Examples

**1. The CAB that approved everything.** A large enterprise ran a twice-weekly CAB; every production change waited for it. An internal audit of a year of CAB decisions found it had rejected ~0.4% of changes, and several incidents that year came from changes the CAB had approved. Lead time for a one-line config change was *days* — the time to the next meeting. This is the DORA null result lived in miniature: maximal latency, negligible risk caught, real false confidence. The fix was to replace the CAB for standard changes with peer review + automated canary, reserve a lightweight async review for the (rare) high-risk tier, and emit an immutable deploy record for the auditors — who, it turned out, were satisfied by evidence and segregation, not by the meeting.

**2. Argo Rollouts as the approver at scale.** A team running dozens of services replaced their manual "deploy to prod, then watch the dashboard for 15 minutes" ritual with Argo Rollouts canary analysis on success-rate and p99 latency. Bad releases now roll back automatically in minutes — faster than the on-call engineer used to notice — and good releases promote without anyone waiting. The manual go/no-go didn't get *automated*; it got *replaced* by a more rigorous control. Their deploy-approval record for the audit is the Rollout's analysis result, captured immutably.

**3. The moved tag.** A team approved `service:release-candidate` and deployed it. A separate CI job re-pushed `release-candidate` between approval and deploy, so production ran an unreviewed build. No malice — just a mutable tag. After the incident they moved to digest-pinned approvals and cosign verification at admission; the approved artifact and the deployed artifact became provably identical.

**4. The freeze that became an outage.** A retailer instituted a hard deploy freeze for the holiday period with no break-glass path. Mid-freeze, a payment bug appeared; the fix was ready in twenty minutes but couldn't be deployed because the freeze was enforced and no one had pre-authorized an exception. The outage lasted hours — not for lack of a fix, but for lack of a *path*. The lesson, now encoded: every freeze ships with a pre-planned, audited break-glass ([07](../07-break-glass-and-bypass/senior.md)).

---

## Mental Models

- **The data flipped the burden of proof.** The default is *no* distant human gate; each one you keep must justify itself by judgement it adds and risk it has demonstrably caught. "We've always required it" is the failure mode, not a reason.

- **Automate the decidable; reserve humans for judgement.** Tests, signatures, thresholds, metric comparisons → machines. "Is this design sound / is this one-way door worth walking through" → humans. Sort every gate by who is actually best placed to answer its question.

- **The policy is the approver.** For an automated deploy, the "approval" is the satisfied set of controls (reviewed-by-another, green, signed, from a known SHA), recorded immutably. The automation identity has no authority of its own; it executes what policy already authorized.

- **Compliance is a byproduct, not a meeting.** Auditors want repeatable + evidenced + segregated. Enforce SoD in code and emit immutable deploy records, and the audit becomes a query. Chasing evidence after the fact is the smell that you didn't build the control in.

- **Metrics are the approver.** Progressive delivery is the modern go/no-go: a canary promoted or rolled back by an SLO/error-budget gate (ideally a Mann-Whitney test on distributions) is faster *and* more rigorous than a human at a dashboard — and it never forgets to look.

- **Approve the digest, not the branch.** An approval secures whatever it points at; tags move, digests don't. Provenance closes the gap so the thing approved is provably the thing deployed.

---

## Common Mistakes

1. **Keeping a CAB (or distant-manager sign-off) and believing it improves stability.** The DORA data says it doesn't — it costs lead time and throughput and buys no reduction in change-fail rate. Replace it with peer review + automated checks + canary; keep a lightweight gate only for the genuinely high-risk tier.

2. **Treating "more approvals" as "more safety."** Each gate is latency with a risk-caught benefit; low-signal human gates are nearly all cost. Subtract the theatre, add automated gates that can actually catch something, and *measure* whether each gate has ever blocked a bad change.

3. **Rubber-stamp approvals presented as a real control.** An approval no one reads adds latency and *false audit comfort* — it makes the org under-invest in the controls that would actually catch risk. A gate that approves everything is catching nothing.

4. **The single-approver bottleneck / bus factor.** Requiring one named person blocks deploys when they're out and concentrates risk. Require a *team* (any-of), and use `prevent_self_review` for author≠approver.

5. **Approvals that block incident remediation.** A freeze or required approval with no break-glass turns an incident into an outage. Pre-plan an audited, time-boxed break-glass path for every freeze ([07](../07-break-glass-and-bypass/senior.md)).

6. **Approving a branch/tag instead of a digest.** `main` and mutable tags move between approval and deploy. Gate on the immutable artifact digest, and verify provenance so the approved bits are the deployed bits.

7. **Concluding automated deploys can't satisfy separation of duties.** They can: the author still can't unilaterally ship (a different human reviewed; a different non-bypassable system gated). The policy is the approver, provenance is the signature, and the deploy bot has no authority of its own.

8. **One-size-fits-all gates.** A config flip and a schema migration facing the same heavyweight approval maximizes latency *and* trains rubber-stamping. Tier the gate to blast radius and reversibility, selected by policy from the change's properties.

---

## Test Yourself

1. Summarize the DORA finding on external/heavyweight change approval. What *did* correlate with both stability and speed, and what does that imply for how you design gates?
2. A regulated org says "the auditors require manual sign-off on every deploy." What do SOC 2 CC8.1 / SOX ITGC actually require, and how would you satisfy them without a human bottleneck?
3. With fully automated continuous deployment and no human at deploy time, how is separation of duties preserved? Who or what is the "approver"?
4. Explain how an Argo Rollouts `AnalysisTemplate` turns a manual go/no-go into an automated approval. Why do `count`/`failureLimit` and the bake window matter? What can this gate *not* catch?
5. Why does Kayenta use a Mann-Whitney U test against a *baseline of the current version* rather than thresholding canary-vs-old-production?
6. Why approve an artifact digest rather than a branch, and what role do SLSA provenance and cosign play in making the approval meaningful?
7. You inherit a pipeline where every change — config flip to schema migration — needs the same VP approval. Redesign it. Name the tiers and the gate for each, and the two metrics you'd track to prove the redesign is safe.

<details>
<summary>Answers</summary>

1. Heavyweight/external approval (a CAB or distant manager approving each change) showed **no improvement** in change-fail rate — trending slightly *negative* — while significantly hurting throughput and lead time. **Peer review** and **automated checks** correlated with *both* stability and speed. Implication: the default should be no distant-human gate; automate the decidable, use peer review for judgement, and make each remaining human gate justify itself by risk it actually catches.
2. They require the change process to be **authorized, tested, approved, and segregated**, *with evidence* — not a CAB meeting or a manual signature. Satisfy them with: automated SoD enforcement (author≠approver/deployer in code), an immutable deploy record per release (who/what-digest/when/approver/checks), and queryable traceability deploy→artifact→PR→ticket. The audit becomes a query, not a scramble.
3. SoD is preserved because the *author* still can't unilaterally ship: the change had to pass a **different human** (peer review/merge) and a **different non-bypassable system** (the pipeline's checks). The "approver" is the **policy** — the satisfied set of controls (reviewed-by-another, all green, signed artifact, known SHA) recorded immutably; **provenance is the signature**. The deploy bot has no authority of its own and runs least-privilege.
4. The template encodes metric queries (success rate, p99 latency) with pass/fail thresholds; the Rollout pauses at each traffic weight and runs the analysis, promoting only if it passes and rolling back automatically if not — the metrics are the approver. `count`/`failureLimit` make the decision robust to a single noisy sample (avoiding false rollbacks/promotions); the **bake/soak window** catches failures that only appear under sustained traffic (leaks, pool exhaustion, cold caches). It **cannot** catch correctness/data bugs that don't move the metrics, delayed data corruption, or security regressions — so it complements, not replaces, review and pre-deploy checks.
5. Mann-Whitney is **non-parametric**, so it doesn't assume a normal distribution — latency is heavy-tailed, so a mean/threshold comparison is misleading. Comparing canary against a **baseline running the same current version** (a control copy) instead of against old production controls for confounders like "this hour is just busier," isolating the effect of the *new code* rather than of ambient load.
6. A branch/tag is a **mutable pointer** that can move between approval and deploy (a re-push, a non-deterministic build), so approving it secures the wrong thing. A **digest** is immutable/content-addressed. **SLSA provenance** (a signed attestation of what built the artifact, from what source, by what builder) plus **cosign** signatures, verified at admission, prove the deployed artifact is exactly the approved one and came from a trusted build of an authorized source.
7. Tier by blast radius/reversibility: **config flip / flag** → automated checks + canary, no human; **code behind a flag / stateless deploy** → peer review + automated canary; **schema migration / one-way change** → peer review + a named human approval + expand-contract + tested rollback; **during a freeze** → blocked, needs break-glass. Select the tier from the change's properties via policy. Track **approval wait time** (as part of lead time) and **approval→incident correlation** (does the gate block changes that would have failed / do incidents slip past approvals that said "go") to prove the lighter gates didn't raise change-fail rate.

</details>

---

## Cheat Sheet

```
THE EVIDENCE (DORA / Accelerate)
  external/heavyweight approval (CAB)  → NO ↓ change-fail; ↓↓ throughput & lead time
  peer review + automated checks       → ↑ stability AND ↑ speed
  rule: automate the decidable; humans only where judgement adds value

WHO DECIDES WHAT
  tests/signature/coverage/metric     → automation
  "is this code/design right?"         → peer review (PR)
  canary health (SLO/error budget)     → canary analysis (metrics are the approver)
  irreversible / high-blast-radius     → a human, deliberately (accountability)

COMPLIANCE-AS-CODE  (SOC2 CC8.1 / SOX ITGC / PCI 6.x / ISO 27001)
  auditors want: repeatable + evidenced + segregated   (NOT slow)
  emit immutable deploy record: who / what-DIGEST+SHA / when / approver / checks
  enforce SoD in code: author ≠ approver ≠ deployer; approver = a TEAM
  traceability: deploy → digest → PR → ticket → approval   (audit = a query)

SEPARATION OF DUTIES
  GitHub Env: prevent_self_review + reviewers=Team
  automated deploy → "policy is the approver, provenance is the signature"
  distinct least-priv identities: build/sign ≠ deploy
  small teams: tier SoD to real risk; don't fake a bank's controls

AUTOMATED JUDGEMENT (progressive delivery)
  Argo Rollouts AnalysisTemplate / Flagger → promote/rollback on SLO metrics
  bake/soak window catches slow failures; count/failureLimit resist noise
  Kayenta/ACA: Mann-Whitney on distributions, vs same-version baseline
  catches metric-visible regressions only — NOT correctness/data/security

SUPPLY CHAIN
  approve the DIGEST, never :latest / a branch
  cosign sign + cosign attest (SLSA provenance, in-toto steps)
  admission policy (Kyverno) → only signed+attested+authorized-source runs

RISK TIERS & WINDOWS
  flag flip < stateless deploy < schema migration  → different gates
  freezes are policy; EVERY freeze needs a break-glass (→ 07)
  METRICS: approval wait time (part of lead time); approval→incident correlation
```

---

## Summary

- The **DORA evidence** is the senior's starting point: external, heavyweight, distant human approval (the CAB) shows **no improvement** in change-fail rate — trending slightly negative — while significantly hurting lead time and throughput. **Peer review + automated checks** outperform. Distant human approval is risk theatre; every gate you keep must justify itself against that null result.
- The design rule: **automate the decidable, reserve humans for genuine judgement, and make compliance a byproduct.** Sort each gate by who is best placed to answer its question, and *subtract* low-signal gates as readily as you add high-signal automated ones.
- **Compliance-as-code** turns SOC 2 / SOX / PCI / ISO change-management controls into automated, evidence-generating controls. Auditors want *repeatable + evidenced + segregated*, not slow — so enforce SoD in code, emit immutable deploy records, and traceability makes the audit a query.
- **Separation of duties** survives the DORA critique because it's about accountability, not guessing whether code is good. For automated deploys, **the policy is the approver and provenance is the signature**; the deploy identity has no authority of its own. Price SoD strictness to actual risk on small teams.
- **Progressive delivery is the modern approval.** Canary analysis (`AnalysisTemplate`/Flagger) promoting or rolling back on SLO + error-budget metrics — ideally a Mann-Whitney test on distributions vs a same-version baseline — is faster *and* more rigorous than a human go/no-go. It catches metric-visible regressions only, so it complements review and pre-deploy checks.
- **Approve the artifact digest, not the branch**, and use SLSA provenance + cosign + an admission policy so the thing approved is provably the thing deployed. **Tier the gate to risk**, encode freezes as policy with a mandatory break-glass, and *measure* your gates — approval wait time as part of lead time, and approval→incident correlation to prove the gate catches anything at all.

You now reason about deploy approval as a control system, grounded in evidence about what human approval does and doesn't buy. The next layer — [professional.md](professional.md) — is about rolling these controls out across an organization, negotiating them with auditors and leadership, and operating them under real production failure.

---

## Further Reading

- *Accelerate: The Science of Lean Software and DevOps* — Forsgren, Humble, Kim. The change-approval research, including the CAB null result, in its primary form.
- The annual *State of DevOps* / DORA reports and the DORA "Change approval" capability write-up — the ongoing evidence base and the case for peer review over external approval.
- [Argo Rollouts — Analysis & Progressive Delivery](https://argo-rollouts.readthedocs.io/) and the [Flagger docs](https://docs.flagger.app/) — `AnalysisTemplate`/metric-driven canary promotion in practice.
- [Netflix Kayenta / Automated Canary Analysis](https://github.com/spinnaker/kayenta) and the Netflix tech-blog posts on ACA — Mann-Whitney-based statistical canary analysis and baseline design.
- [SLSA](https://slsa.dev/), [in-toto](https://in-toto.io/), and [Sigstore/cosign](https://docs.sigstore.dev/) — provenance, attestation, and artifact signing for binding the approved artifact to the deployed one.
- SOC 2 (CC8.1), SOX ITGC, PCI-DSS v4.0 §6, and ISO/IEC 27001 change-management control texts — read the controls directly; they ask for evidence and segregation, not meetings.

---

## Related Topics

- [02 — Branch Protection & Merge Policies](../02-branch-protection-and-merge-policies/senior.md) — the merge-time half of separation of duties: required reviews and author≠approver before code ever reaches a deploy.
- [05 — Gate Design: Speed vs Safety](../05-gate-design-speed-vs-safety/senior.md) — how aggressive to tune canary thresholds, bake windows, and which gates to keep on the critical path.
- [07 — Break-glass & Bypass](../07-break-glass-and-bypass/senior.md) — the pre-planned, audited emergency path every freeze and required approval must ship with.
- [Release Engineering](../../release-engineering/) — deployment strategies, release trains, and the mechanics behind progressive delivery and rollback.
- [Security](../../../../Security/) — supply-chain integrity, signing, and admission control: artifact-level gating viewed from the security angle.
