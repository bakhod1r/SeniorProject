# Policy as Code — Professional Level

> **Roadmap:** [Quality Gates](../README.md) → Policy as Code
> *The senior page taught you Rego, OPA, and Gatekeeper — the syntax of a single policy. This page is about running policy-as-code as an org-wide program: one policy library enforced across hundreds of repos and clusters, where shipping a bad rule can freeze every deploy, where teams will demand exceptions you have to govern, and where an auditor wants to see every admission decision you made last quarter.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Platform-Team Leverage Play](#core-concept-1--the-platform-team-leverage-play)
5. [Core Concept 2 — The Rollout That Doesn't Cause a Riot](#core-concept-2--the-rollout-that-doesnt-cause-a-riot)
6. [Core Concept 3 — Exceptions and Waivers as Code](#core-concept-3--exceptions-and-waivers-as-code)
7. [Core Concept 4 — Governing the Policy Repo Itself](#core-concept-4--governing-the-policy-repo-itself)
8. [Core Concept 5 — Fail-Open vs Fail-Closed at Org Scale](#core-concept-5--fail-open-vs-fail-closed-at-org-scale)
9. [Core Concept 6 — Decision Logs as the Compliance Backbone](#core-concept-6--decision-logs-as-the-compliance-backbone)
10. [Core Concept 7 — Measuring the Program](#core-concept-7--measuring-the-program)
11. [War Stories](#war-stories)
12. [Decision Frameworks](#decision-frameworks)
13. [Mental Models](#mental-models)
14. [Common Mistakes](#common-mistakes)
15. [Test Yourself](#test-yourself)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)
18. [Further Reading](#further-reading)
19. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Standing up and operating policy-as-code as an org-wide program, where a policy change is a production change and an exception is a governed, expiring artifact.**

The senior page framed policy-as-code as a tool: write a Rego rule, wire it into Gatekeeper or Conftest, block the bad config. At the professional level the rule is the easy part. The hard parts show up in different meetings: a platform team that owns one policy library consumed by 300 application teams; a rollout where a new rule shipped straight to enforce and blocked every deploy in the cluster; a backlog of one-off exceptions that quietly became permanently-disabled rules; a SOC2 auditor asking "show me every admission decision and who could have bypassed it."

None of these are new *concepts* — they're the policy engine you already know, now multiplied by hundreds of consumers, a change-management process, and a regulator. The skill here is judgment at scale: knowing that you *never* ship a new policy in enforce mode, that exceptions must be codified and expiring rather than ad-hoc bypasses, that a policy change can take down every deploy and therefore deserves the same caution as a prod change, and that the decision log is the asset that makes the whole program auditable. This page is the pragmatic, run-the-program layer.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — Rego basics, OPA, Gatekeeper/Conftest, admission control, writing and testing a single policy.
- **Required:** You've operated a multi-team platform or shared CI/CD system and felt the pull of "we need to enforce X everywhere."
- **Helpful:** You've owned an admission webhook, an OPA deployment, or a shared policy library in production.
- **Helpful:** You've been through an audit (SOC2, PCI, FedRAMP, ISO 27001) and had to produce evidence that a control was actually enforced.

---

## Glossary

- **Policy library:** the centrally-owned set of policies (Rego/Kyverno/etc.) that the platform team maintains and ships to consumers — the single source of truth that replaces tribal knowledge.
- **Admission webhook:** the Kubernetes `ValidatingWebhookConfiguration` (or mutating) that the API server calls before persisting an object; Gatekeeper and Kyverno run as admission webhooks.
- **Dry-run / audit mode:** a policy evaluated for *reporting* only — violations are recorded, nothing is blocked. Gatekeeper's `enforcementAction: dryrun` and its background audit are the canonical examples.
- **Enforce mode:** the policy actually denies the request (CI fail, admission deny). The terminal state of a staged rollout, never the starting one.
- **Waiver / exception:** a codified, reviewed, owned, *expiring* exemption from a policy for a specific scope — the governed alternative to disabling a rule.
- **Constraint / ConstraintTemplate:** Gatekeeper's CRDs — the template holds the Rego, the constraint binds it to a scope (namespaces, kinds) with parameters and an enforcement action.
- **Fail-open / fail-closed:** what the webhook does when the policy engine is unreachable or times out — allow the request (open, availability-first) or deny it (closed, security-first).
- **Decision log:** the durable record of every policy evaluation — input, result, the policy version that decided — used for audit, debugging, and metrics.
- **SCP / Azure Policy / AWS Config:** cloud-native guardrails that enforce policy at the control-plane level (organization, subscription) rather than via an in-cluster webhook.

---

## Core Concept 1 — The Platform-Team Leverage Play

The reason policy-as-code is a *program*, not a feature, is leverage. Before it, "every pod must set resource limits," "no `:latest` image tags," "all S3 buckets encrypted," and "production deploys need two approvals" live in three places: a wiki nobody reads, settings someone clicked in a console once, and the heads of the three engineers who remember. That state drifts the moment those engineers leave or someone clicks differently in a new account.

One policy repo, enforced across hundreds of repos and clusters, collapses all three into a single reviewed, versioned, testable artifact. The platform/governance team **owns the library**; application teams **consume and extend** it. That ownership split is the whole game:

```
governance team OWNS:                application teams CONSUME + EXTEND:
─────────────────────────           ──────────────────────────────────
the policy library (Rego/CRDs)       enable the library in their cluster/CI
the rollout schedule + mode          file waivers (in git, reviewed)
the waiver process + expiry loop      add team-local policies on top
the decision-log pipeline            remediate violations they own
the fail-open/closed posture
```

The anti-pattern this replaces is **per-team reinvention**: 40 teams each writing their own slightly-wrong "no privileged containers" check, 40 different bypass mechanisms, 40 blind spots. Centralizing means one correct implementation, one place to fix a CVE-driven rule, one audit story.

```rego
# A library policy, owned by platform, distributed to every cluster.
# Application teams don't edit this — they consume it and file waivers.
package library.kubernetes.require_resource_limits

import future.keywords.in

violation[{"msg": msg}] {
    container := input.review.object.spec.containers[_]
    not container.resources.limits.memory
    msg := sprintf("container %q must set resources.limits.memory", [container.name])
}
```

> **The professional reality:** the value of policy-as-code is not the Rego — it's the *org-wide consistency and the elimination of drift*. A single library enforced everywhere is what turns "we think we're compliant" into "we can prove it for every cluster, in git history." If every team can still hand-roll its own checks and its own bypasses, you have policy-as-suggestion, not policy-as-code.

---

## Core Concept 2 — The Rollout That Doesn't Cause a Riot

The single most expensive mistake in this entire domain is shipping a new policy straight to **enforce** mode. A rule that looks obviously-correct in review — "every namespace must have a cost-center label" — meets a fleet where half the existing namespaces don't have it, and now every deploy to those namespaces is blocked. You didn't enforce a standard; you caused an outage and a pager storm, and you taught every team that the platform group breaks things.

**Never ship enforce first.** The staged path:

| Stage | What it does | Who sees it | Exit criterion |
|---|---|---|---|
| **Dry-run / monitor** | Evaluate, record violation count; block nothing | Platform team's dashboard | You know the true violation count and its distribution |
| **Warn / annotate** | Surface a warning on the PR/`kubectl apply`; still allow | The submitting engineer | Teams are aware; warning volume is dropping |
| **Audit / report** | Periodically scan *existing* resources and report violators by team | Team leads, via a report | Existing violations have owners and a remediation plan |
| **Enforce (scoped)** | Actually deny — but per-namespace/per-team, not all at once | The newly-onboarded scope | Scope is green; expand to the next scope |

Gatekeeper makes the first and last stages first-class:

```yaml
# Stage 1: dry-run. The constraint evaluates and the audit records
# violations, but admission is NOT blocked. This is how you discover
# the real violation count BEFORE you ever block anything.
apiVersion: constraints.gatekeeper.sh/v1beta1
kind: K8sRequiredLabels
metadata:
  name: require-cost-center
spec:
  enforcementAction: dryrun        # warn | deny are the other values
  match:
    kinds:
      - apiGroups: [""]
        kinds: ["Namespace"]
  parameters:
    labels: ["cost-center"]
```

```yaml
# Stage 4: enforce, but SCOPED to teams that are already green.
# You flip to deny one namespace-set at a time, never cluster-wide on day one.
spec:
  enforcementAction: deny
  match:
    namespaceSelector:
      matchLabels:
        policy-tier: enforced       # only namespaces opted-in to enforcement
```

Two non-negotiables wrap the stages:

- **A grace period with migration support.** When you announce enforcement, you give a date *and* help: a report of each team's current violations, example fixes, office hours. "This will start blocking on 2026-09-01" with a self-serve violation report is a program; a surprise `deny` is sabotage.
- **Per-team / per-namespace scoping.** Use `namespaceSelector` / labels / CI repo-allowlists so a policy goes live for early-adopter teams first, then expands. Big-bang enforcement across the whole org is how you get a riot and a rollback.

> **The professional reality:** the rollout *is* the program. The Rego took an afternoon; getting 300 teams from "violating, unaware" to "compliant, enforced" without an outage takes a quarter and a communication plan. Dry-run → warn → audit → enforce, scoped and dated, is the only path that doesn't burn your credibility on the first rule.

---

## Core Concept 3 — Exceptions and Waivers as Code

Here is the org problem that sinks most policy-as-code programs: **teams will need exceptions, and how you handle them determines whether the program survives.** A legitimate exception always exists — a legacy service that genuinely can't set a security context yet, a vendor image you can't rebuild, a migration mid-flight. If your only tools are "comply" or "we'll disable the rule for you," you will end up with a policy library full of rules that are off "temporarily" and never come back on. Within a year your enforced policy set is a fiction.

The fix is to treat exceptions exactly like the policies themselves: **codified, in git, reviewed, with an owner, a reason, and — critically — an expiry.**

```yaml
# waivers/payments-legacy.yaml — a waiver as a reviewed, expiring artifact.
# This lives in the policy repo, goes through PR review, and EXPIRES.
- policy: require-non-root
  scope:
    namespace: payments-legacy
    resource: deployment/legacy-gateway
  owner: team-payments               # who is accountable
  reason: "vendor image runs as root; rebuild tracked in PAY-4821"
  ticket: PAY-4821
  approved_by: platform-security
  expires: 2026-09-30                # NOT optional. No expiry = not approved.
```

The policy engine consults the waiver list as data and exempts only the named scope. The exemption is therefore *visible, reviewable, and time-boxed* — the opposite of someone editing the rule or adding an undocumented bypass annotation.

```rego
# The policy reads waivers as data and skips a violation only if a
# valid, unexpired waiver covers this exact resource.
violation[{"msg": msg}] {
    some i
    container := input.review.object.spec.containers[i]
    container.securityContext.runAsNonRoot != true
    not waived(input.review.object)             # honor a valid waiver
    msg := sprintf("container %q must run as non-root", [container.name])
}

waived(obj) {
    w := data.waivers[_]
    w.policy == "require-non-root"
    w.scope.namespace == obj.metadata.namespace
    time.parse_rfc3339_ns(sprintf("%sT00:00:00Z", [w.expires])) > time.now_ns()  # not expired
}
```

The piece everyone skips and everyone regrets: **the waiver-expiry review loop.** A waiver with an expiry date that nobody checks is just a slow-motion permanent bypass. You need a recurring job that:

1. Reports waivers expiring in the next 30 days to their owners.
2. Fails CI / opens an issue when a waiver is past its expiry (the rule re-applies; the team must renew with fresh justification or fix the violation).
3. Surfaces the total waiver count and median age as a program health metric (Core Concept 7).

This is distinct from **break-glass / emergency bypass** — the "I need to deploy *right now* during an incident, audit it after" path — which is its own controlled mechanism covered in [07 — Break-glass & Bypass](../07-break-glass-and-bypass/professional.md). Waivers are *planned, reviewed, expiring* exemptions; break-glass is *emergency, logged, alarmed* override. Conflating them — using break-glass for routine exceptions, or routine waivers for emergencies — corrupts both.

> **The professional reality:** an exception system without enforced expiry isn't an exception system — it's a graveyard of disabled rules. The expiry date and the loop that enforces it are what keep "temporary" honest. The day you make waivers expire and renew, your enforced policy set becomes true again.

---

## Core Concept 4 — Governing the Policy Repo Itself

A policy that can block every deploy in the org is, operationally, production infrastructure — and a bad change to it is a production incident. So the policy repo needs the same rigor you'd apply to any prod system, plus a layer most teams forget: **policy on the policy.**

**Who can change policy.** Not everyone. The policy library needs `CODEOWNERS` so that platform/governance reviews every rule change, and ideally a separation between "propose a policy" (any team) and "approve and merge a policy" (governance). This is itself a meta-policy — the rules about who can change the rules — and it belongs in the same reviewed, versioned place.

```
# CODEOWNERS in the policy repo — changes to enforcement require platform-security
/policies/                @org/platform-security
/waivers/                 @org/platform-security @org/team-leads
/policies/library/**      @org/platform-security     # the shared library is tightly held
```

**Testing and CI for the policy repo.** Policies are code; untested code that can block all deploys is reckless. The repo runs its own gate:

```bash
# The policy repo's own CI — test BEFORE a rule reaches any cluster.
opa test policies/ -v                    # unit tests: known-good and known-bad inputs
conftest verify --policy policies/       # contract tests against fixtures
gator test --filename constraints/       # Gatekeeper's offline constraint tester
```

```rego
# Every policy ships with tests asserting BOTH that bad input is caught
# AND that good input passes (the second is what prevents over-blocking).
package library.kubernetes.require_resource_limits_test

test_denies_missing_memory_limit {
    count(violation) == 1 with input as {"review": {"object": {"spec":
        {"containers": [{"name": "app", "resources": {}}]}}}}
}
test_allows_with_memory_limit {
    count(violation) == 0 with input as {"review": {"object": {"spec":
        {"containers": [{"name": "app", "resources": {"limits": {"memory": "256Mi"}}}]}}}}
}
```

**Versioning and safe rollout of policy *changes*.** A policy change is a fleet-wide change. Version the bundle (OPA bundles are versioned and served over HTTP); roll new policy versions out the same staged way you roll out new rules — to a canary cluster or namespace set first, watch the decision logs, then expand. A `deny` rule that's accidentally too broad must be caught on the canary, not on the whole fleet. Keep the previous bundle one rollback away.

> **The professional reality:** treat policy changes like production changes — reviewed, tested, canaried, reversible. The blast radius of a bad policy is *every deploy that policy touches*, which at org scale is everything. The team that learns this the easy way writes `opa test` and canaries bundles; the team that learns it the hard way ships a typo'd `deny` and freezes the company's CD for an hour.

---

## Core Concept 5 — Fail-Open vs Fail-Closed at Org Scale

When the policy engine is unreachable — the OPA pods are down, the webhook times out, the bundle server is unavailable — the admission webhook must decide: allow the request through (**fail-open**) or reject it (**fail-closed**)? At org scale this is one of the sharpest availability-vs-security tradeoffs you'll make, and the failure modes are severe in *both* directions.

- **Fail-closed admission webhook outage = cluster-wide deploy outage.** If the webhook's `failurePolicy: Fail` and the policy engine goes down, the API server can't get an admission decision, so *every* create/update is rejected. Your security posture is intact and nobody can deploy anything — including the fix for the policy engine itself. A fail-closed webhook turns a policy-engine blip into a cluster-wide CD outage.
- **Fail-open during the outage = a security gap.** With `failurePolicy: Ignore`, requests sail through unvalidated while the engine is down. Availability is preserved; for that window, your guardrails are off, and a non-compliant or malicious workload can land.

There is no universally-correct answer — the right choice is **per-gate**, and the real engineering is in *mitigating* the tradeoff so you rarely have to live with either bad outcome:

```yaml
# The webhook config is where this decision becomes concrete.
webhooks:
  - name: validation.gatekeeper.sh
    failurePolicy: Fail            # Ignore (fail-open) | Fail (fail-closed)
    timeoutSeconds: 3              # short timeout: don't let a slow engine stall the API server
    namespaceSelector:            # SCOPE: exempt kube-system so a bad webhook can't brick the cluster
      matchExpressions:
        - key: admission.gatekeeper.sh/ignore
          operator: DoesNotExist
```

The mitigations that let you fail-closed safely:

- **HA policy engine.** Run multiple OPA/Gatekeeper replicas across nodes/zones with a PodDisruptionBudget so a single failure never takes the webhook down. Most fail-closed outages are really *non-HA* outages.
- **Short, deliberate timeouts.** A 30-second timeout means a slow engine stalls every API call for 30 seconds; 2–3 seconds bounds the blast radius of slowness.
- **Scope the webhook.** Exempt `kube-system` and the policy engine's own namespace from the webhook so an engine outage doesn't block the very pods that would recover it. Forgetting this is the classic "the webhook blocked its own recovery" deadlock.
- **Choose per-gate.** Security-critical, high-blast-radius gates (no privileged containers, no public S3) may justify fail-closed *with HA*. Lower-stakes hygiene gates (a label convention) can fail-open — a missing label for one outage window is cheap.

> **The professional reality:** fail-closed is a security stance that's only safe when the engine is genuinely HA and the webhook is scoped to never block its own recovery. Fail-open is honest about availability but leaves a window. The mature posture is *fail-closed on the few gates that matter, behind an HA engine with tight timeouts and a self-exemption, and fail-open on the rest* — and to have *tested* what happens when the engine dies, before it dies in production.

---

## Core Concept 6 — Decision Logs as the Compliance Backbone

The asset that makes a policy-as-code program *auditable* is the **decision log**: a durable, queryable record of every policy evaluation — the input, the decision (allow/deny), the policy version that made it, and when. OPA emits these natively; you ship them to a sink (Kafka, S3, a SIEM, an OTLP collector) and they become the backbone of your audit, debugging, and metrics story.

```json
// One OPA decision-log entry — the unit of compliance evidence.
{
  "decision_id": "9b1e...",
  "path": "kubernetes/admission/deny",
  "input": { "review": { "object": { "kind": "Pod", "metadata": {"namespace": "payments"} } } },
  "result": ["container must run as non-root"],
  "timestamp": "2026-06-22T14:03:11Z",
  "bundles": { "policy": { "revision": "v2026.06.20-3" } }   // which policy version decided
}
```

This is exactly what auditors for SOC2, PCI-DSS, and FedRAMP want, because the recurring audit question is not "do you have a policy?" but **"show me that it was actually enforced — every decision, for this period."** A wiki page describing a control proves nothing; a decision log proving that every production deployment in Q2 was evaluated against the control, with the denials and their waivers, *is* the evidence.

```bash
# "Show every DENY in the payments namespace last quarter" — a query, not an archaeology dig.
jq 'select(.result != [] and .input.review.object.metadata.namespace == "payments")' decisions.log
# "Show every admission decision against the require-non-root policy" — for the auditor.
```

What makes the decision log load-bearing:

- **It's the audit trail.** Pair it with the waiver records (who was exempted, why, until when) and you can answer "was this control enforced, and where wasn't it, and was that approved?" for any window.
- **It's the debugging tool.** "Why did this deploy get blocked at 2am?" is a `decision_id` lookup, not a re-creation of the cluster state.
- **It's the metrics source.** Violation trends, time-to-remediate, and policy-caused denials (Core Concept 7) are all derived from the log.
- **It must be tamper-evident and retained.** Ship it off the cluster to append-only storage with the retention your compliance regime requires (often 1 year+). A decision log a cluster admin can edit isn't evidence.

> **The professional reality:** without decision logs, an audit is a scramble to *reconstruct* what your controls did. With them, "show every admission decision and who could bypass it" is a query you run in the meeting. The log is the difference between *claiming* compliance and *demonstrating* it — and it's nearly free if you turn it on from day one and expensive to backfill if you don't.

---

## Core Concept 7 — Measuring the Program

A policy-as-code program you can't measure is a program you can't defend in a budget review or steer toward impact. The metrics fall out of the decision logs and the waiver records, and four of them tell you whether the program is healthy or rotting:

| Metric | What it tells you | Healthy signal |
|---|---|---|
| **Violation trend** (count over time, by policy/team) | Are things getting better as you enforce? | Trending down after each rollout |
| **Time-to-remediate** (violation first seen → fixed) | Are teams actually fixing, or ignoring warnings? | Falling median; few long-stuck violations |
| **Exception count + age** (open waivers, median/oldest) | Is the waiver system a release valve or a graveyard? | Low count, low age; old waivers closing on expiry |
| **Policy-caused incidents** (deploys blocked by bad policy) | Is the program *itself* a source of outages? | Near zero; each one drives a postmortem |

The two that most reveal the truth are **exception age** and **policy-caused incidents**. Rising exception age means waivers aren't expiring — the disabled-rule graveyard from Core Concept 3 is forming. Any nonzero policy-caused-incident count is a signal that your rollout discipline (Core Concept 2) or your repo governance (Core Concept 4) has a gap — a rule reached enforce without enough dry-run, or a bad bundle reached the fleet without a canary.

> **The professional reality:** report violation trend and exception age to leadership; report policy-caused incidents to yourself, ruthlessly. The first proves the program is reducing risk; the second keeps the program honest about the risk *it* introduces. A program that blocks bad configs but periodically freezes all deploys hasn't earned its keep.

---

## War Stories

**The Gatekeeper policy that froze every deploy.** A platform engineer wrote a clean constraint — "every pod must have a `team` label" — tested the Rego, and applied it with `enforcementAction: deny` straight to the production cluster. Within minutes every deploy was rejected: most existing workloads predated the convention and had no `team` label, and the constraint matched updates to them too. CD was frozen org-wide until someone flipped the action back to `dryrun` and the team scrambled to label thousands of resources. Nothing was wrong with the *policy*; everything was wrong with shipping it to `deny` without a `dryrun` stage that would have shown the violation count first. This single failure is *why* the staged dry-run → warn → audit → enforce path is non-negotiable.

**The fail-closed webhook that locked out its own recovery.** A team set their Gatekeeper webhook to `failurePolicy: Fail` for security, with a single OPA replica and no namespace exemptions. A node drain killed the lone replica; the webhook now failed closed on *every* admission request — including the new OPA pod the scheduler was trying to create to recover. The cluster couldn't deploy anything, and couldn't deploy the thing that would fix it. They broke the deadlock by deleting the `ValidatingWebhookConfiguration` by hand. The fixes were structural: HA replicas with a PDB, a short timeout, and a `kube-system`/gatekeeper-namespace exemption so the engine can always recover itself. Fail-closed was defensible; fail-closed *without HA and a self-exemption* was an outage waiting for a node drain.

**The exception list that became a permanent off-switch.** A program launched with a waiver mechanism but no expiry enforcement — waivers had an `expires` field, but nothing ever checked it. Eighteen months later, an audit found that 60% of the "enforced" security policies were waived for one team or another, most for problems long since fixed; the waivers had simply never been revisited. The enforced policy set was fiction. The remediation was the expiry loop: a weekly job that re-applies any rule whose waiver has lapsed and pings the owner. Within two months the waiver count dropped by 70% as stale exemptions either closed or got renewed with real justification. The lesson: a waiver without an enforced expiry is just a disabled rule with extra steps.

**The rollout that killed drift across 300 repos — and passed the audit in an afternoon.** A platform team replaced a wiki full of "remember to encrypt your buckets / pin your images / set resource limits" with a single OPA policy library, rolled out the staged way (dry-run for a quarter, scoped enforcement after) and wired to decision logs from day one. When the SOC2 audit came, the auditor's "show me that image-signing and encryption were enforced on every production deploy this period" was answered with a decision-log query in the room. Config drift that used to surface as incidents simply stopped, because non-compliant config never got admitted. The leverage of *one owned library enforced everywhere* turned both drift and audit prep from chronic pain into a non-event.

**The Rego policy that timed out CI on big Terraform plans.** A team enforced a policy over `terraform plan` JSON with Conftest. It worked fine on small stacks, then started timing out CI on the monorepo's largest plans — tens of thousands of resources, and a policy with an accidental O(n²) comprehension that iterated all resources for each resource. The gate that was supposed to *speed up* safe merges was now the slowest, flakiest step, and teams started asking to skip it. The fix was to profile the Rego (`opa eval --profile`), replace the nested iteration with indexed lookups, and cap evaluation time so a pathological plan fails fast with a clear message instead of hanging. The broader lesson: at org scale a policy runs against inputs far larger than your test fixtures, and a slow policy gets *disabled*, which is worse than no policy.

---

## Decision Frameworks

**OPA/Gatekeeper vs Kyverno vs cloud-native vs commercial — which engine?**

| | OPA / Gatekeeper | Kyverno | Cloud-native (SCP, Azure Policy, AWS Config) | Commercial (Styra, Snyk IaC) |
|---|---|---|---|---|
| Language | Rego (general, powerful, a learning curve) | YAML/CRD policies (K8s-native, low curve) | Provider DSL/JSON | Wraps OPA + UI/management |
| Scope | K8s admission + CI + anything (general policy) | Kubernetes-centric (admission, mutation, generation) | The cloud control plane (org/account/subscription) | Org-wide policy management on top of OPA |
| Best when | You need one engine for K8s *and* Terraform/CI/app authz | You're K8s-only and want low-friction adoption | You want guardrails *above* the cluster, provider-enforced | You want a managed program: distribution, decision logs, UI, RBAC out of the box |
| Mutation | Limited (separate mutation feature) | First-class (mutate + generate) | N/A (preventive at control plane) | Via OPA |
| Cost / ops | Self-hosted; you run it | Self-hosted; you run it | Included with the cloud; no engine to run | License cost; less to operate |

> Rule of thumb: **cloud-native for control-plane guardrails you want enforced even outside the cluster; Kyverno for low-friction K8s-only; OPA/Gatekeeper when you need one policy language across K8s + IaC + app authz; commercial when the *program* (distribution, decision logs, governance UI) is the hard part and you'd rather buy than build it.** These compose — SCPs *and* Gatekeeper *and* Conftest is a common, healthy stack.

**Policy rollout stages (dry-run → enforce):**

| Stage | Action | Blocks? | Use until |
|---|---|---|---|
| Dry-run / monitor | Record violations | No | You know the real violation count |
| Warn / annotate | Surface warning on PR/apply | No | Teams are aware; warnings declining |
| Audit / report | Scan existing resources, report by team | No | Existing violations have owners + plan |
| Enforce (scoped) | Deny, per-namespace/team | Yes (scoped) | Scope green; expand to next scope |
| Enforce (fleet) | Deny everywhere | Yes | (terminal) |

**Exception / waiver lifecycle:**

| Phase | What happens | Required artifact |
|---|---|---|
| Request | Team needs an exemption | PR to `waivers/` with owner, reason, ticket |
| Review | Governance approves the *scope* and *expiry* | `approved_by`, bounded `expires` (no expiry → reject) |
| Active | Policy honors the waiver for the named scope only | Waiver visible in git; decision log notes it |
| Pre-expiry | 30-day warning to owner | Automated reminder |
| Expiry | Rule re-applies; renew with fresh justification or fix | CI fails / issue opened on lapse |

**Fail-open vs fail-closed by gate:**

| Gate type | Posture | Why | Required mitigation |
|---|---|---|---|
| Security-critical (privileged containers, public buckets, unsigned images) | Fail-closed | A gap here is a real breach risk | HA engine + PDB, short timeout, self-namespace exemption |
| Compliance-attested control | Fail-closed | Must be provably always-on | Same + decision logging |
| Hygiene/convention (labels, naming) | Fail-open | A one-window gap is cheap; availability wins | Short timeout; alert on engine down |
| CI/IaC checks (Conftest) | Fail-closed (CI fails) | No availability concern; just fail the build | Fast eval; bounded timeout per plan |

**What belongs in policy-as-code vs elsewhere:**

| Belongs in policy-as-code | Belongs elsewhere |
|---|---|
| Declarative, evaluable invariants (no `:latest`, must set limits, must be signed) | Imperative remediation logic → controllers/operators |
| Org-wide standards enforced across many repos/clusters | One-off team preferences → team-local lint config |
| Admission/CI gates with a clear allow/deny | Subjective design review → human PR review |
| SLSA/supply-chain attestation checks (signature, provenance) | Generating the signatures/SBOMs themselves → the build (see Security) |
| Compliance controls that need a decision-log trail | Documentation of *why* a standard exists → the docs/ADR |

---

## Mental Models

- **The leverage is the library, not the language.** One owned policy library enforced across hundreds of repos/clusters is what kills drift and tribal knowledge. The Rego is a means; org-wide consistency you can prove is the end.

- **Never ship a policy in enforce mode.** Dry-run → warn → audit → enforce, scoped and dated, is the only path that doesn't cause an outage and a riot. The rule that looks obviously-correct meets a fleet full of pre-existing violations.

- **An exception without an expiry is a disabled rule.** Waivers must be codified, owned, reviewed, and *expiring*, with a loop that re-applies the rule on lapse. The expiry date is what keeps "temporary" honest and your enforced set real.

- **A policy change is a production change.** It can freeze every deploy. Review it, test it (`opa test`), canary the bundle, keep a rollback. Same caution as shipping to prod, because its blast radius *is* prod.

- **Fail-closed is only safe behind HA and a self-exemption.** A fail-closed webhook with one replica and no `kube-system` exemption turns an engine blip into a cluster that can't even recover itself. Choose per-gate; mitigate before you commit.

- **The decision log is the program's memory.** It's the audit evidence, the debugger, and the metrics source. "Show every admission decision" is a query if you logged from day one, and archaeology if you didn't.

---

## Common Mistakes

1. **Shipping a new policy straight to enforce.** The fleet is full of pre-existing violations you didn't measure; you freeze deploys and burn credibility. Always start in dry-run, measure the count, then stage warn → audit → enforce, scoped and dated.

2. **Letting every team hand-roll its own checks and bypasses.** That's policy-as-suggestion. Centralize in one owned library; teams consume and extend it and file *waivers*, they don't fork the rule or invent a bypass.

3. **Exceptions without enforced expiry.** Waivers with an `expires` field that nobody checks become permanent disabled rules — within a year your enforced set is fiction. Build the expiry loop *first*; an unenforced expiry is no expiry.

4. **Treating the policy repo casually.** A typo'd `deny` can block all deploys. Gate the repo with `opa test`/`gator test` and `CODEOWNERS`, version bundles, canary new policy versions, and keep a rollback. It's prod.

5. **Fail-closed without HA or a self-exemption.** One OPA replica, no `kube-system` exemption, `failurePolicy: Fail` — a node drain locks out the cluster *and* its own recovery. HA + PDB + short timeout + self-namespace exemption, or don't fail-closed.

6. **Not shipping decision logs off-cluster from day one.** Without them, an audit is a reconstruction project and a 2am "why was this blocked?" is unanswerable. Turn on decision logging, ship to append-only storage, retain per your compliance regime.

7. **Ignoring policy performance at scale.** A policy that's fine on test fixtures times out on the monorepo's biggest Terraform plan, and a slow gate gets disabled. Profile (`opa eval --profile`), avoid O(n²) comprehensions, cap evaluation time, fail fast with a clear message.

8. **Conflating waivers with break-glass.** Routine exemptions are planned, reviewed, expiring waivers; emergencies are logged, alarmed [break-glass](../07-break-glass-and-bypass/professional.md). Using one for the other corrupts both the audit trail and the emergency path.

---

## Test Yourself

1. A colleague writes a correct "every pod needs a `team` label" Gatekeeper constraint, tests the Rego, and applies it with `enforcementAction: deny` to the prod cluster. Predict what happens and explain the staged path that would have prevented it.
2. Why must a waiver have an *expiry*, and what specifically goes wrong if the expiry exists in the YAML but nothing enforces it?
3. A fail-closed Gatekeeper webhook with a single OPA replica is in a cluster where a node gets drained. Walk through the failure, including why it can be self-deadlocking, and list the mitigations that make fail-closed safe.
4. An auditor asks, "Show me that image-signing was enforced on every production deploy in Q2, and every exception that was granted." What two artifacts let you answer this in the meeting, and what happens if you don't have them?
5. You're choosing between Gatekeeper, Kyverno, and an AWS SCP for "no public S3 buckets." Give the tradeoffs and when each is the right pick.
6. Name the four program-health metrics and explain why *exception age* and *policy-caused incidents* are the two that most reveal whether the program is healthy or rotting.
7. A Conftest policy over `terraform plan` JSON passes on small stacks but times out CI on the largest one. Diagnose the likely cause and give the fix, plus the broader lesson about policies at org scale.

<details>
<summary>Answers</summary>

1. Most existing pods predate the convention and lack the `team` label; the constraint matches updates to them too, so **every deploy is rejected** and CD freezes org-wide. The fix is the staged path: **dry-run** (record the true violation count without blocking), then **warn** (annotate PRs), then **audit** (report existing violators to owners), then **enforce scoped** per-namespace for green teams before fleet-wide — with a grace period, a dated cutover, and a self-serve violation report.
2. The expiry is what keeps a *legitimate temporary* exemption from becoming a *permanent disabled rule*. Without enforcement, waivers accumulate and never get revisited; within months a large fraction of your "enforced" policies are quietly waived and your enforced set is fiction. You need the **expiry loop**: warn owners 30 days out, re-apply the rule (fail CI / open an issue) on lapse, and report waiver count and median age as a health metric.
3. The drain kills the only OPA replica; with `failurePolicy: Fail`, the webhook now denies *every* admission request because the API server can't get a decision — including the scheduler's attempt to create the replacement OPA pod, so the cluster **can't recover itself** (self-deadlock). Mitigations: **HA replicas + PodDisruptionBudget**, a **short timeout** (2–3s) so slowness is bounded, and a **`kube-system`/gatekeeper-namespace exemption** so the engine can always be recovered. Then fail-closed is defensible.
4. The **decision logs** (every admission decision, with the policy version and result, shipped to append-only storage) and the **waiver records** (who was exempted, by whom, why, until when, in git). With both, the question is a query in the room. Without them, the audit becomes a reconstruction project — you can't prove the control was actually enforced, only assert it.
5. **AWS SCP**: enforced at the org/account control plane, so it applies even outside any cluster and can't be bypassed by a cluster admin — best for a hard cloud guardrail. **Gatekeeper**: if you want one policy language across K8s admission *and* Terraform/CI, and the bucket is provisioned via K8s. **Kyverno**: K8s-only, lowest adoption friction if buckets are managed via K8s CRDs. Often you use **SCP for the control-plane guarantee and Conftest/Gatekeeper to catch it in CI/IaC before it ever reaches the account** — defense in depth.
6. **Violation trend**, **time-to-remediate**, **exception count + age**, **policy-caused incidents**. *Exception age* rising means waivers aren't expiring — the disabled-rule graveyard is forming. *Policy-caused incidents* being nonzero means the program itself is causing outages — a gap in rollout discipline or repo governance. Together they reveal whether the program is reducing risk without becoming a new source of it.
7. The policy likely has an O(n²) pattern — a comprehension iterating all resources for each resource — that's invisible on small fixtures and explodes on a plan with tens of thousands of resources. Fix: profile with `opa eval --profile`, replace nested iteration with indexed lookups, and cap evaluation time so a pathological input fails fast with a clear message. Lesson: at org scale a policy runs against inputs far larger than your fixtures, and a **slow gate gets disabled** — worse than no gate.

</details>

---

## Cheat Sheet

```
THE LEVERAGE PLAY
  one OWNED policy library enforced across all repos/clusters
  platform OWNS the library; teams CONSUME + EXTEND + file waivers
  kills: wiki + clicked settings + tribal knowledge + drift

ROLLOUT (never ship enforce first)
  dry-run  → record violations, block nothing   (measure the count)
  warn     → annotate PR/apply, still allow
  audit    → report existing violators by team
  enforce  → deny, SCOPED per-namespace/team, dated, with grace period
  Gatekeeper: enforcementAction: dryrun | warn | deny

WAIVERS AS CODE (the killer org problem)
  in git, reviewed, OWNER + REASON + TICKET + EXPIRES (no expiry = reject)
  expiry loop: warn 30d out → re-apply rule on lapse → report count + age
  NOT break-glass (that's emergency/alarmed → 07-break-glass)

GOVERN THE POLICY REPO (it's prod)
  CODEOWNERS on /policies; opa test / gator test in CI
  version bundles; CANARY new policy versions; keep a rollback
  a typo'd deny can freeze ALL deploys

FAIL-OPEN vs FAIL-CLOSED (per gate)
  fail-closed: failurePolicy: Fail   → engine down = ALL deploys blocked
  fail-open:   failurePolicy: Ignore → engine down = security gap
  safe fail-closed = HA replicas + PDB + short timeout + self-namespace exempt
  security gates fail-closed (w/ HA); hygiene gates fail-open

DECISION LOGS = COMPLIANCE BACKBONE
  every decision: input + result + policy VERSION + timestamp
  ship off-cluster, append-only, retain per regime (SOC2/PCI/FedRAMP)
  "show every admission decision" = a query, not archaeology

MEASURE THE PROGRAM
  violation trend ↓  | time-to-remediate ↓
  exception count + AGE (graveyard detector) | policy-caused incidents ≈ 0
```

---

## Summary

- **The leverage is one owned policy library enforced everywhere.** It collapses the wiki, the clicked settings, and the tribal knowledge into a single reviewed, versioned, testable artifact, and it kills config drift across hundreds of repos. The platform team owns it; teams consume, extend, and file waivers against it.
- **Never ship a policy in enforce mode.** The staged path — dry-run → warn → audit → enforce, scoped per-team and announced with a date and a grace period — is the only rollout that doesn't freeze deploys and start a riot. Gatekeeper's `enforcementAction` makes the first and last stages first-class.
- **Exceptions are codified, owned, expiring waivers** — in git, reviewed, with an owner, reason, and a hard expiry, plus a loop that re-applies the rule on lapse. An exception system without enforced expiry is a graveyard of disabled rules. This is distinct from emergency [break-glass](../07-break-glass-and-bypass/professional.md).
- **A policy change is a production change.** Gate the policy repo with `opa test`/`gator test` and `CODEOWNERS`, version and canary bundles, and keep a rollback, because a bad policy can block every deploy in the org.
- **Fail-open vs fail-closed is a per-gate availability/security decision.** Fail-closed protects the guardrail but, without HA and a self-exemption, turns an engine blip into a cluster-wide deploy outage that can't recover itself; fail-open preserves availability at the cost of a gap. Fail-closed the few gates that matter behind an HA engine; fail-open the rest.
- **Decision logs are the compliance backbone** — every admission decision with its policy version, shipped to append-only storage. Paired with waiver records they answer "show me it was enforced, and every exception" as a query. Measure the program with violation trend, time-to-remediate, exception age, and policy-caused incidents.

You can now stand up and run policy-as-code as an org-wide program — the rollout, the waivers, the governance, the fail posture, and the audit trail — not just write a rule. The remaining tier — [interview.md](interview.md) — consolidates the topic into the questions that probe whether someone has actually run a program at this scale.

---

## Further Reading

- [OPA Gatekeeper documentation](https://open-policy-agent.github.io/gatekeeper/website/docs/) — ConstraintTemplates, `enforcementAction` (dryrun/warn/deny), audit, and `gator` testing.
- [Open Policy Agent — decision logs and bundles](https://www.openpolicyagent.org/docs/latest/management-decision-logs/) — the decision-log format and bundle distribution that underpin audit and safe rollout.
- [Styra DAS / OPA adoption guides](https://www.openpolicyagent.org/docs/latest/) — running OPA as a managed org-wide program: distribution, decision logs, and governance.
- [Kyverno documentation](https://kyverno.io/docs/) — the K8s-native, low-friction alternative and its mutate/generate model.
- [SLSA framework](https://slsa.dev/) and [sigstore](https://www.sigstore.dev/) — supply-chain provenance and image signing that policy-as-code admits (SLSA-level and signature gates).
- [AWS Config / SCPs](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html) and [Azure Policy](https://learn.microsoft.com/en-us/azure/governance/policy/overview) — cloud-native, control-plane guardrails that compose with in-cluster policy.
- The next tier: [interview.md](interview.md) — the questions that probe real program-running judgment.

---

## Related Topics

- [01 — Required CI Checks](../01-required-ci-checks/professional.md) — policy-as-code is often the CI check; the staged rollout and fail-fast discipline mirror this.
- [02 — Branch Protection & Merge Policies](../02-branch-protection-and-merge-policies/professional.md) — repo-level guardrails that policy-as-code generalizes across the whole org.
- [07 — Break-glass & Bypass](../07-break-glass-and-bypass/professional.md) — the emergency override path that complements planned, expiring waivers.
- [Security](../../../../Security/) — supply-chain attestation, image signing, and the threats the security-critical policies defend.
- [Release Engineering](../../release-engineering/) — where admission and policy gates sit in the deploy pipeline and incident response.
