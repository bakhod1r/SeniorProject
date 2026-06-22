# Policy as Code — Interview Level

> **Roadmap:** [Quality Gates](../README.md) → Policy as Code
> *A policy-as-code interview rarely asks "what is OPA." It asks "a new admission policy just blocked every deploy across the cluster — what went wrong, and how do you roll out safely next time," and then watches whether you separate the decision from the enforcement, whether you reach for fail-open or fail-closed on instinct, and whether you treat exceptions as code or as a kill switch.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [How to Use This Page](#how-to-use-this-page)
4. [Fundamentals](#fundamentals)
5. [Rego & Testing](#rego--testing)
6. [Architecture (PDP/PEP)](#architecture-pdppep)
7. [Admission Control](#admission-control)
8. [Rollout & Scenarios](#rollout--scenarios)
9. [Rapid-Fire](#rapid-fire)
10. [Red Flags / Green Flags](#red-flags--green-flags)
11. [Cheat Sheet](#cheat-sheet)
12. [Summary](#summary)
13. [Further Reading](#further-reading)
14. [Related Topics](#related-topics)

---

## Introduction

Policy as code turns the rules a platform team enforces — "no `:latest` images," "no public S3 buckets," "every Deployment carries an owner label," "only signed images run in prod" — into versioned, reviewable, testable artifacts instead of clicked settings in a console or paragraphs in a wiki. Interviewers probe it because it sits at the seam where governance meets engineering: the moment a policy stops being advisory and starts *blocking* a `terraform apply` or a `kubectl apply`, it becomes production infrastructure with its own blast radius, rollout discipline, and failure modes.

This page is a question bank from junior through staff. The strong candidates share a habit: they keep the **decision** (what the policy concludes) separate from the **enforcement** (who acts on it), they default to deny-by-default but roll out in stages, and they treat exceptions as owned, expiring code rather than as "turn the rule off." Everything below returns to those instincts.

---

## Prerequisites

You'll get more from this page if you're comfortable with:

- **Quality gates in general** — what it means for a check to *block* a merge or a deploy versus merely report ([Quality Gates README](../README.md)).
- **CI fundamentals** — pull-request checks, required status checks, the difference between a warning and a hard failure ([01 — Required CI Checks](../01-required-ci-checks/interview.md)).
- **Kubernetes basics** — what `kubectl apply` does, what a Deployment/Pod is, and roughly what the API server is. The admission-control questions assume this.
- **The mental model of this topic** — if any term below is unfamiliar, read [junior.md](junior.md) first; the staff-level scenarios build on [senior.md](senior.md).

---

## How to Use This Page

Each question carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). Don't memorize the answers — internalize the *distinctions* they keep returning to:

- **decision vs enforcement** (the policy engine concludes; something else acts — PDP vs PEP)
- **policy vs data vs input** (the rule, the context it reads, the thing being judged)
- **dry-run vs warn vs enforce** (the same policy at three rollout stages with different blast radius)
- **exception-as-code vs disabling-the-rule** (a scoped, owned, expiring waiver vs weakening the control for everyone)
- **fail-open vs fail-closed** (when the policy engine is unreachable, do you admit or reject?)

Nearly every question in this bank is one of those five distinctions wearing a costume. Candidates who do well *name the distinction* before reaching for a tool.

---

## Fundamentals

### Q: What is "policy as code," and why is it better than configuring rules in a console or writing them in a wiki?

> **Testing:** Whether you can articulate the concrete wins, not just say "it's in Git."

**A.** Policy as code expresses governance rules as source files that live in version control and run through an engine, instead of being clicked into a cloud console or described in prose. The wins are specific:

- **Versioned** — every rule change is a commit with an author, a timestamp, and a diff. You can answer "when did we start requiring signed images, and who approved it?"
- **Reviewable** — a policy change goes through the same pull-request review as application code. A human approves *the rule*, not just the resource.
- **Testable** — you can write unit tests that assert "this manifest is denied, that one is allowed" and run them in CI before the policy ships.
- **Consistent / no drift** — the same policy file enforces identically across every cluster, account, and pipeline. Clicked settings drift between environments; a wiki rule is enforced only as well as humans remember it.
- **Auditable** — the policy *and* its decisions are records. You can prove to an auditor both what the rule was and that it was applied.

A wiki rule ("please don't use `:latest`") is a *suggestion* enforced by vigilance. Policy as code is a *control* enforced by a machine, and the control itself is engineered.

### Q: What are OPA, Rego, and Conftest, and how do they relate?

> **Testing:** Whether you know the building blocks or just the buzzwords.

**A.** **OPA** (Open Policy Agent) is a general-purpose policy *engine* — a CNCF-graduated project. You give it policy and some JSON input, and it returns a decision. It's domain-agnostic: the same engine evaluates Kubernetes manifests, Terraform plans, API requests, or CI metadata.

**Rego** is the declarative language you write OPA policies in. You describe *what* makes input acceptable or unacceptable; OPA evaluates it.

**Conftest** is a thin CLI wrapper around OPA's engine aimed at the developer/CI loop: point it at structured config files (YAML, JSON, HCL, Dockerfile) and a directory of Rego policies, and it returns pass/fail. It's the easy on-ramp for "run policy in the pipeline" without standing up a server.

So: Rego is the language, OPA is the engine, Conftest is a convenient front door to that engine for config files.

### Q: Explain allow-based vs deny-based policy and the deny-by-default posture.

> **Testing:** Whether you understand default posture as a security decision, not a style choice.

**A.** An **allow** rule states the conditions under which something is *permitted* — the default is reject, and you must affirmatively allow. A **deny** rule states the conditions under which something is *forbidden* — the default is permit, and you collect reasons to reject. Conftest and Gatekeeper conventionally express **deny** rules (each violated rule contributes a message), which reads naturally for "linting" config.

**Deny-by-default** is the safer posture for authorization: if no rule explicitly allows an action, it's denied. The reason is that the failure mode of "forgot to write a rule" should be *too strict* (something gets blocked, someone complains, you fix it) rather than *too permissive* (something dangerous slips through silently). For a *config-validation* gate, the framing flips slightly — you start permissive and accumulate deny rules — but the principle holds: design so that the gap in your rules fails toward safety, not toward exposure.

### Q: Give me three real policies you'd enforce and why each matters.

> **Testing:** Whether your knowledge is concrete or abstract.

**A.** Plenty to choose from; here are four with the reason each exists:

- **No `:latest` image tags.** `:latest` is mutable — the same manifest can pull different code on two nodes or two days apart, destroying reproducibility and making rollbacks meaningless. Require a pinned tag or, better, a digest.
- **No public S3 buckets / no `0.0.0.0/0` ingress.** The single most common cloud breach is an accidentally public storage bucket or a security group open to the world. A policy makes "public" require an explicit, reviewed exception.
- **Required labels** (e.g. `owner`, `team`, `cost-center`). Untagged resources are unattributable — you can't page the owner, bill the team, or clean up orphans. The policy refuses the resource until it carries its provenance.
- **Only signed images from our registry.** Combined with admission control, this ensures every running container traces to an artifact your pipeline built and signed — the foundation of supply-chain integrity.

Each one converts an implicit "we should" into an enforced "we do."

---

## Rego & Testing

### Q: Walk me through the `deny[msg]` pattern. What does this rule actually do?

> **Testing:** Whether you can read Rego, not just name it.

**A.** The canonical Conftest/Gatekeeper shape collects violation messages into a set. Consider:

```rego
package main

deny[msg] {
    input.kind == "Deployment"
    some i
    image := input.spec.template.spec.containers[i].image
    endswith(image, ":latest")
    msg := sprintf("container %v uses mutable tag ':latest'", [image])
}
```

`deny` is a **partial set rule** — it can produce zero, one, or many values. The body is a conjunction: *every* line must hold for a given binding. OPA iterates the containers (the `some i` / `containers[i]` iteration), and for each container whose image ends in `:latest`, it adds a message to the `deny` set. If no container violates, `deny` is empty and the resource passes. The enforcement point's contract is simple: **if `deny` is non-empty, reject, and show the messages.** The messages matter as much as the decision — a good denial tells the developer exactly what to fix.

### Q: What's the difference between `input` and `data` in Rego?

> **Testing:** The single most common Rego confusion.

**A.** **`input`** is the thing being judged *right now* — the Kubernetes manifest, the Terraform plan, the API request. It's per-evaluation and supplied by the caller. **`data`** is everything else OPA knows: the loaded policies plus any external context you've pushed in — a list of approved base images, a registry allowlist, an org chart, a CMDB export. `data` is comparatively static and shared across evaluations; `input` is the specific case.

The practical pattern: keep the *rule* in policy, keep the *facts it consults* in `data`, and keep the *case* in `input`. For example, "is this image's registry in our allowlist?" — the allowlist is `data.registries.allowed`, the image is `input...image`. This lets you update the allowlist without touching policy logic.

### Q: How do you test a policy, and why do you test it at all?

> **Testing:** Whether you treat policy as code or as config you eyeball.

**A.** You test it the same way you test any code, because a policy *is* code that makes binary decisions about production changes — a wrong policy either blocks legitimate work or waves through the thing it was meant to stop. OPA ships a test runner: write `_test.rego` files using the `test_` naming convention, and run `opa test`.

```rego
package main

test_denies_latest_tag {
    deny[_] with input as {
        "kind": "Deployment",
        "spec": {"template": {"spec": {"containers": [
            {"image": "app:latest"}
        ]}}},
    }
}

test_allows_pinned_tag {
    count(deny) == 0 with input as {
        "kind": "Deployment",
        "spec": {"template": {"spec": {"containers": [
            {"image": "app:1.4.2"}
        ]}}},
    }
}
```

The `with input as {...}` clause **mocks** the input for that test — you feed a hand-built case and assert the policy reaches the right verdict. You write tests for both the violating case (it denies) *and* the compliant case (it stays silent), because a policy that denies everything also "passes" the first test. Then `opa test` runs in CI on the policy repo, so a broken policy is caught before it can break anyone's deploy.

### Q: What is a partial rule, and how is it different from a complete rule?

> **Testing:** Depth of Rego understanding beyond copy-paste.

**A.** A **complete rule** produces a single value (or is undefined): `allow = true { ... }`. A **partial rule** builds up a *set* (`deny[msg] { ... }`) or an *object* (`labels[key] = value { ... }`) by collecting every binding for which the body holds. `deny` is partial precisely because one resource can have many independent problems — three containers on `:latest`, a missing label, and a public port — and you want *all* of them reported in one pass, not just the first. Partial rules are how Rego expresses "for each X that satisfies these conditions, contribute a result," which is the natural shape of config linting.

### Q: How do you mock external data in a test, and why does `with` matter?

> **Testing:** Whether you can test policies that depend on `data`, not just `input`.

**A.** The same `with` keyword that overrides `input` also overrides `data`. If a policy consults `data.registries.allowed`, a test pins both:

```rego
test_rejects_unapproved_registry {
    deny[_] with input as {"image": "docker.io/evil:1.0"}
               with data.registries.allowed as ["registry.internal"]
}
```

`with` matters because it makes policy tests **hermetic** — they don't depend on whatever `data` happens to be loaded in the live system. You assert "given *this* allowlist and *this* image, the verdict is deny." That isolation is what lets you test policy logic and the context it reads independently, and it's the difference between a test that documents behavior and one that's coupled to a live bundle.

---

## Architecture (PDP/PEP)

### Q: Explain PDP versus PEP. Why is keeping them separate the whole point?

> **Testing:** The architectural distinction that separates people who've operated policy at scale.

**A.** The **PDP** (Policy Decision Point) *decides*: it takes input plus policy and returns a verdict — allow/deny plus reasons. OPA is a PDP. The **PEP** (Policy Enforcement Point) *enforces*: it's the place in the system that asks the PDP and then *acts* on the answer — admits or rejects the request, fails or passes the CI step, returns 403 or proceeds. A CI job, a Kubernetes admission webhook, and API middleware are all PEPs.

Separating them is the core idea because it **decouples the rule from every place the rule is enforced.** One OPA policy ("only images from our registry") can be enforced by a CI step (catch it early, cheap feedback), an admission webhook (catch it at deploy, authoritative), and an API gateway (catch it at runtime) — all consulting the *same* decision logic. You write and test the policy once; each PEP is a thin adapter that knows how to *act* in its context. It also means you can change *where* you enforce (add a new PEP, move from advisory to blocking) without touching the policy, and change the policy without re-implementing enforcement everywhere.

### Q: What are decision logs and why do they matter for audit?

> **Testing:** Whether you think past the decision to the record of it.

**A.** A **decision log** is OPA emitting a structured record of every decision it made: the input, the policy result, the timestamp, which policy version was loaded. They matter because the *decision* is the audit-relevant event. "We have a policy requiring signed images" is a claim; "here are 4 million logged admission decisions over the quarter, N of which were denials, with the inputs that triggered them" is *evidence*. Decision logs let you answer compliance questions retroactively ("prove no unsigned image ran in prod in Q2"), debug "why was this rejected?" with the exact input, and detect drift between intended and actual enforcement. A policy without decision logging enforces silently — you can't prove what it did.

### Q: What's a bundle in OPA, and what problem does it solve?

> **Testing:** How policy gets distributed to many enforcement points.

**A.** A **bundle** is a packaged, versioned set of policies and data that an OPA instance pulls from a central server on a schedule. The problem it solves is *distribution at scale*: you have OPA running as a PDP next to dozens or hundreds of PEPs (a sidecar per cluster, per service), and you need every one of them to converge on the same, current policy without manually deploying to each. Bundles give you a single source of truth — push a new bundle, and every OPA fetches it and starts enforcing the new version, with the version recorded in decision logs so you know exactly which policy made which call. It turns "deploy the policy to 100 places" into "publish one bundle."

### Q: Where would you put the enforcement point — CI, admission, or runtime — and why not just one?

> **Testing:** Defense in depth and the shift-left/shift-right tradeoff.

**A.** Ideally more than one, because each catches a different escape:

- **CI (shift-left):** cheapest feedback, runs on the pull request before anything is applied. But CI can be bypassed — someone applies manifests by hand, or a pipeline is misconfigured. CI is advisory-grade unless it's the *only* path to deploy.
- **Admission (authoritative):** the API server is the chokepoint every change flows through, so an admission webhook is the *enforceable* gate — nothing reaches the cluster without passing it. This is where the binding decision belongs.
- **Runtime/API (shift-right):** middleware that checks each request catches things that are only knowable at runtime (this caller, this data) and things that drifted after admission.

The reason for layering: CI gives fast feedback but isn't a true control; admission is the real control but gives feedback late (at deploy); runtime catches what the earlier gates can't see. Same policy, three PEPs — fast feedback *and* an unbypassable backstop.

---

## Admission Control

### Q: What is a Kubernetes admission webhook, and where does it sit?

> **Testing:** Whether you understand the chokepoint that makes admission control authoritative.

**A.** Every change to the cluster — `kubectl apply`, a controller creating a Pod, anything — goes through the **API server**. Admission controllers are a stage in that request path, *after* authentication and authorization but *before* the object is persisted to etcd. A **validating admission webhook** is an external HTTPS service the API server calls at that stage: it sends the object, your service returns "allowed" or "denied with a reason," and the API server enforces that verdict. Because the API server is the single door into the cluster, a validating webhook is an *unbypassable* gate — there's no way to create a resource that skips it. That chokepoint property is exactly why admission control is the authoritative PEP for Kubernetes, in contrast to a CI check that a determined user can route around.

### Q: Mutating vs validating webhooks — what's the difference and the ordering?

> **Testing:** Whether you know admission has two distinct phases.

**A.** A **mutating** webhook can *change* the object — inject a sidecar, add default labels, set `imagePullPolicy`, rewrite an image reference to a digest. A **validating** webhook can only *accept or reject* — it never modifies. The ordering is fixed and important: **mutating runs first, validating second.** That's deliberate — mutators bring the object into compliance (e.g., add the required label), and then validators check the *final* form. If validation ran first, a mutator could change the object into something that should have been rejected. So: mutate to fix, then validate to enforce, on the post-mutation object.

### Q: Compare Gatekeeper and Kyverno.

> **Testing:** Whether you can choose tools on real axes, not preference.

**A.** Both are Kubernetes-native policy engines that run as admission webhooks and also do background **audit** (scanning *existing* resources for violations, not just new ones).

- **Gatekeeper** is OPA/Rego under the hood, wrapped in two CRDs: a **ConstraintTemplate** defines the Rego logic and a parameter schema; a **Constraint** instantiates it with specific parameters and scope. The pull is that it's OPA — the same Rego you'd use for Terraform or CI, full programmability for complex logic, and you can reuse policy skills across domains. The cost is learning Rego.
- **Kyverno** is Kubernetes-native: policies are *YAML*, no new language. For "require this label," "disallow `:latest`," "mutate to add a sidecar," the YAML is concise and readable to anyone who knows Kubernetes. The cost is that very complex logic gets awkward in YAML where Rego stays expressive.

The honest split: **Kyverno** when your policies are Kubernetes-shaped and you want your whole team to read and write them without learning Rego; **Gatekeeper/OPA** when you want one policy language across Kubernetes *and* CI *and* cloud, or your logic is complex enough that Rego earns its keep. Many shops standardize on Kyverno for K8s and OPA for everything else.

### Q: Fail-open vs fail-closed for an admission webhook — and why can a broken webhook take down a cluster?

> **Testing:** The judgment question that most directly maps to a real outage.

**A.** The webhook's `failurePolicy` decides what the API server does when it *can't reach* your webhook (it's down, slow, or its cert expired). **`Fail` (fail-closed)** means the API server *rejects* the request — nothing is admitted while the webhook is unreachable. **`Ignore` (fail-open)** means the API server *admits* the request anyway, skipping the policy.

Here's the trap, and why a broken webhook can take down a cluster: with `failurePolicy: Fail` and a broad scope, if your webhook pods are unhealthy, the API server can no longer admit *anything that matches the webhook* — including, potentially, the very Pods needed to bring your webhook back, or core controllers' objects. You've wedged the cluster: it can't self-heal because every healing action is being rejected by a policy gate that's down. The standard mitigations are: **scope the webhook narrowly** (`namespaceSelector` / `objectSelector`, and exclude `kube-system` and your own policy namespace), set a **short `timeoutSeconds`**, run the webhook **highly available**, and think hard about whether *this* policy is critical enough to justify fail-closed. Security-critical gates (signed images, no privileged containers) often warrant `Fail`; conventions (labels) often don't. The point is it's a *deliberate* choice per webhook, with the cluster-wedge scenario explicitly in mind.

### Q: What does Gatekeeper's audit feature do that admission alone doesn't?

> **Testing:** Whether you know enforcement has a "what about what's already running?" gap.

**A.** Admission only sees *new or changed* resources — it's a gate at the door. Anything already running when you introduce a policy, and anything admitted under an older/looser policy, is invisible to admission. **Audit** periodically scans the *existing* cluster state against the constraints and reports violations (on the Constraint's status) without blocking anything. This matters for two reasons: rollout (audit shows you how many existing resources *would* violate a new policy *before* you turn on enforcement) and ongoing compliance (it surfaces resources that predate the rule or were admitted when the webhook was fail-open). Admission prevents new violations; audit finds the ones already inside.

---

## Rollout & Scenarios

### Q: Should you ever ship a new policy straight to "enforce"? Walk me through a safe rollout.

> **Testing:** Whether you treat a policy as a code deploy with blast radius — the staff-level instinct.

**A.** No — shipping a blocking policy straight to enforce across a fleet is how you cause an outage where there wasn't a vulnerability. A policy that *blocks* is production infrastructure, and you roll it out in stages of increasing teeth:

1. **Dry-run / audit.** Deploy the policy in a non-blocking mode (Gatekeeper `enforcementAction: dryrun`, or audit-only). It *logs* what it *would* reject but admits everything. Now you have real numbers: how many existing and incoming resources violate it.
2. **Warn.** Surface the violation to developers (Kyverno `Audit`+warning, or a CI warning) so they see it on their PR/deploy but aren't blocked. This drives remediation while the gate is still soft.
3. **Enforce, scoped.** Turn on blocking for a *small* scope first — one namespace, one non-critical team — and watch.
4. **Enforce, fleet-wide.** Expand once the violation count has drained to near zero and you trust the policy.

The thread running through it: you go from *observe* to *block* gradually, you measure the would-be impact before you have real impact, and at every stage you can roll back by lowering the enforcement action without redeploying the policy. "Dry-run → warn → audit → enforce" is the muscle memory.

### Q: A new Gatekeeper policy was pushed straight to enforce and blocked every deploy across the cluster. What went wrong, and how should it have been rolled out?

> **Testing:** Incident reasoning plus the rollout discipline from the previous question — applied.

**A.** What went wrong is almost always one of: the policy logic was **too broad** (a `deny` that fires on far more than intended — e.g., a missing-label check that didn't account for a label set by a mutating webhook that runs in a different order, so it rejected everything), or the **scope** was the whole cluster with no namespace exclusions (so it caught `kube-system` and core controllers too), or it was simply shipped at full `enforcementAction: deny` with **no dry-run**, so the first time anyone saw the blast radius was in production.

**Immediate fix:** flip the constraint's `enforcementAction` from `deny` to `dryrun` (or delete the Constraint — *not* the ConstraintTemplate) to unblock deploys instantly, then diagnose with audit results and decision logs to see *what* it was matching.

**How it should have gone:** dry-run first to measure impact, scope out system namespaces, warn developers, enforce on one namespace, *then* expand — exactly the staged rollout. And the policy change itself should have had **tests** (`opa test`) asserting both the deny and the allow cases, which would likely have caught the over-broad logic before it ever shipped. The root cause is usually process (no staged rollout, no tests), not a clever bug.

### Q: A team needs an exception to a policy. How do you handle it without weakening the policy for everyone?

> **Testing:** The exception-as-code vs disabling-the-rule distinction — a top differentiator.

**A.** The wrong move is to relax or delete the rule, or add a blanket `if namespace == "team-x"` carve-out that quietly never expires — that weakens the control for everyone and rots. The right move is an **exception as code**: a scoped, owned, expiring waiver that is itself reviewed and version-controlled.

Concretely:
- The exception is a **data record** (or a Gatekeeper `Constraint` exclusion, or a Kyverno policy exception) that names *exactly* what's exempt — this resource/namespace, this specific rule — not "turn off the check."
- It has an **owner** and a **justification** in the record, so there's accountability for why the risk was accepted.
- It has an **expiry date**. The policy checks the expiry; past it, the exception stops applying and the resource is blocked again. This is the crucial part — exceptions that never expire become permanent holes.
- It goes through **the same review** as any policy change (a PR, an approval), so granting an exception is a deliberate, auditable act.

So the policy stays strict for everyone; the exception is a narrow, logged, time-boxed, owned grant that the *policy itself* enforces the boundaries of. "Exceptions are data with an owner and an expiry, reviewed like code" — versus "someone disabled the rule," which is how controls die by a thousand carve-outs.

### Q: Enforce "all images must come from our registry" across 50 clusters. How?

> **Testing:** Whether you think in terms of one policy, central distribution, staged rollout, and the right PEP.

**A.** The shape of the answer matters more than the exact tool:

1. **One policy, centrally distributed.** Write the rule *once* (Rego/OPA constraint or a Kyverno policy: the image registry prefix must be in an allowlist). Don't hand-maintain 50 copies. Distribute it via a **bundle** (OPA) or GitOps (Argo/Flux syncing the Constraint/Policy CRDs to every cluster) so all 50 converge on the same version, and decision logs record which version each cluster ran.
2. **Enforce at admission** — the authoritative, unbypassable PEP — so no Pod with a foreign image is admitted, *and also* run it in **CI** for fast developer feedback. Same policy, two PEPs.
3. **Stage the rollout across the fleet.** Dry-run on all 50 first to measure violations, then enforce on a canary cluster or a few non-critical namespaces, then expand. Use **audit** to find images already running that violate, so you don't discover them by breaking a redeploy.
4. **Handle the allowlist as data**, not as policy edits — the set of approved registries lives in `data` (or a Constraint parameter) so updating it doesn't require touching policy logic or re-reviewing the rule.
5. **Exceptions as code** for the inevitable "we need this one third-party image" — scoped, owned, expiring.

The keywords interviewers listen for: *single source of truth*, *bundle/GitOps distribution*, *admission as the real PEP*, *dry-run before enforce*, *audit for existing state*, *allowlist as data*.

### Q: Should the admission webhook fail open or fail closed? How do you decide?

> **Testing:** Whether you reason about it per-policy with the cluster-availability tradeoff in view, rather than picking one globally.

**A.** It's not a global answer — it's **per webhook, by criticality**. The question is: "if this gate is down, is it worse to admit something unchecked, or to block everything it covers?"

- **Fail-closed (`Fail`)** for **security-critical** gates: signed-images-only, no-privileged-containers, no-public-LoadBalancer. If the gate is down, you'd rather block than let an unsigned or privileged workload through — the security guarantee is the point, and a brief inability to deploy is preferable to a hole.
- **Fail-open (`Ignore`)** for **convention/hygiene** gates: required labels, naming standards. If the label-checker is down, blocking every deploy in the cluster over a missing label is a self-inflicted outage far worse than a temporarily unlabeled resource.

And regardless of choice, you reduce *how often* the choice bites: scope webhooks narrowly, exclude system namespaces, run the webhook HA with a tight timeout, so "webhook unreachable" is rare. The mature answer names the tradeoff explicitly — *availability of deploys vs strength of the guarantee* — and ties the decision to what the specific policy protects, while flagging the cluster-wedge risk of a broad fail-closed webhook.

### Q: How does signed-image / SLSA admission fit into this?

> **Testing:** Whether you connect policy as code to supply-chain security.

**A.** Signing closes the loop between "we built and approved this artifact" and "this is what's running." With **Sigstore/cosign**, your pipeline signs each image (ideally keylessly, tied to the CI identity) and can attach **attestations** — provenance (how/where it was built, the SLSA framework's focus), an SBOM, scan results. Then an **admission policy** verifies, at the cluster door, that every image carries a valid signature from your pipeline's identity and meets the required attestations *before* it's allowed to run. This is policy as code enforcing supply-chain integrity: the same PDP/PEP split (a verifier as the decision logic, the admission webhook as the enforcement) and the same staged rollout (dry-run → enforce). It's the strongest form of "only our artifacts run here," because it checks cryptographic provenance, not just a registry prefix that an attacker could push to.

### Q: OPA/Gatekeeper vs Kyverno vs cloud-native policy (AWS SCPs, Azure Policy) — when each?

> **Testing:** Whether you place policy tools by domain and reach, not fashion.

**A.** They cover different *territories*:

- **Cloud-native** (AWS Service Control Policies / Config rules, Azure Policy, GCP Org Policy) enforces at the **cloud control plane** — they can *prevent* a non-compliant resource from being created in the account at all, which is a guarantee no in-cluster tool can match for *cloud* resources. Use these for cloud-account guardrails ("no public buckets," "no untagged resources," "only these regions").
- **Kyverno** for **Kubernetes** policy when you want YAML-native, K8s-shaped rules your team writes without learning Rego.
- **OPA/Gatekeeper** for Kubernetes *and* when you want **one policy language across domains** — the same Rego validating Terraform plans in CI, Kubernetes manifests at admission, and even API requests at runtime.

The judgment: enforce cloud guardrails at the cloud control plane (closest to the resource, can't be bypassed), enforce Kubernetes policy in-cluster (Kyverno or Gatekeeper by your Rego appetite), and reach for OPA when consistency *across* CI, K8s, and cloud-plan validation is worth a single language. They're complementary layers, not competitors — most mature platforms run cloud-native guardrails *and* an in-cluster engine.

---

## Rapid-Fire

> Short questions to check breadth. One or two sentences each.

- **Q: PDP vs PEP in one line?** A: The PDP decides (OPA returns a verdict); the PEP enforces (the CI step, webhook, or middleware that acts on it).
- **Q: `input` vs `data`?** A: `input` is the thing being judged now; `data` is the policies plus external context (allowlists, facts) shared across evaluations.
- **Q: What does a non-empty `deny` set mean?** A: At least one rule was violated; the enforcement point rejects and shows the messages.
- **Q: Mutating or validating first?** A: Mutating first (fix the object), validating second (check the final form).
- **Q: What does `failurePolicy: Fail` do?** A: The API server rejects the request when the webhook is unreachable (fail-closed).
- **Q: Why can a fail-closed webhook wedge a cluster?** A: If it's down and broadly scoped, the API server can't admit anything it matches — including the objects needed to recover.
- **Q: Gatekeeper's policy CRDs?** A: ConstraintTemplate (the Rego + schema) and Constraint (an instance with parameters and scope).
- **Q: How do you mock input in an OPA test?** A: `with input as {...}` (and `with data.x as ...` for external data).
- **Q: Default safe posture?** A: Deny-by-default — an unhandled case fails toward "blocked," not "allowed."
- **Q: First thing to do when a policy blocks all deploys?** A: Flip the constraint to `dryrun` (or delete the Constraint, not the Template) to unblock, then diagnose.
- **Q: What's a bundle?** A: A versioned package of policy + data that OPA instances pull centrally, so the whole fleet converges on one version.
- **Q: What does Gatekeeper *audit* find that admission can't?** A: Violations in *already-running* resources, not just new/changed ones.
- **Q: What tool signs container images for admission verification?** A: Sigstore/cosign; SLSA describes the provenance attestations you attach.
- **Q: Exception done right vs wrong?** A: Right: a scoped, owned, expiring waiver reviewed like code. Wrong: disabling the rule or a never-expiring carve-out.
- **Q: Why test policies?** A: A policy is code that blocks production changes; a wrong one either blocks legit work or lets the bad thing through.

---

## Red Flags / Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**
- Conflating the policy engine with the enforcement point — no sense that OPA *decides* and something else *enforces*.
- Shipping a blocking policy straight to "enforce" with no dry-run or staged rollout.
- Handling an exception by disabling the rule or adding a permanent, unowned carve-out.
- Picking fail-open or fail-closed as a blanket global default with no per-policy reasoning, and not knowing a broad fail-closed webhook can wedge a cluster.
- Treating policies as config you eyeball — no mention of `opa test` or testing the allow case as well as the deny case.
- "We document the rule in the wiki / Confluence" offered as equivalent to enforcing it.
- Maintaining 50 copies of a policy by hand instead of central distribution.

**Green flags:**
- Naming the *distinction* (PDP/PEP, input/data, dry-run/enforce, exception-as-code) before reaching for a tool.
- Defaulting to deny-by-default *and* a staged rollout in the same breath.
- Reaching for decision logs and audit as the *evidence* and *blast-radius preview*, unprompted.
- Reasoning about fail-open/closed per-policy by criticality, with the cluster-wedge scenario in mind.
- Treating exceptions as owned, expiring, reviewed data rather than a kill switch.
- Connecting "only our images" to signing/SLSA, not just a registry prefix.
- Framing the platform-team leverage: one tested policy, centrally distributed, enforced at the authoritative chokepoint.

---

## Cheat Sheet

| Concept | One-line answer |
|---|---|
| **Policy as code** | Versioned, reviewable, testable, auditable rules-as-files vs clicked settings / wiki prose. |
| **OPA / Rego / Conftest** | OPA = engine; Rego = the language; Conftest = CLI wrapper for config files in CI. |
| **PDP vs PEP** | PDP decides (OPA); PEP enforces (CI step, admission webhook, API middleware). |
| **`input` vs `data`** | `input` = the case being judged; `data` = policies + shared facts/allowlists. |
| **`deny[msg]`** | Partial *set* rule; non-empty ⇒ reject, with the messages as the fix list. |
| **Testing** | `opa test` + `_test.rego`; `with input/data as ...` to mock; test deny *and* allow. |
| **Mutating vs validating** | Mutating (changes object) runs first; validating (accept/reject) runs on the result. |
| **Gatekeeper** | OPA-based; ConstraintTemplate (Rego) + Constraint (params/scope) + audit. |
| **Kyverno** | Kubernetes-native YAML policies; easier for K8s-shaped rules, no Rego. |
| **failurePolicy** | `Fail` = fail-closed (reject if webhook down); `Ignore` = fail-open (admit). |
| **Fail-open vs closed** | Closed for security-critical gates; open for convention; decide per policy. |
| **Rollout** | Dry-run → warn → audit → enforce-scoped → enforce-fleet; never straight to enforce. |
| **Audit** | Scans *existing* resources for violations; admission only sees new/changed. |
| **Exception-as-code** | Scoped, owned, **expiring**, reviewed waiver — not "turn the rule off." |
| **Bundle** | Versioned policy+data OPA pulls centrally so the fleet converges on one version. |
| **Decision logs** | Structured record of every decision = the audit evidence. |
| **Signing / SLSA** | cosign signs images + provenance; admission verifies before running. |

---

## Summary

- The bank reduces to five distinctions in costumes: **decision vs enforcement (PDP/PEP)**, **policy/data/input**, **dry-run/warn/enforce**, **exception-as-code vs disabling-the-rule**, and **fail-open vs fail-closed**. Name the distinction first; the tool follows.
- **Fundamentals:** policy as code beats clicked settings and wiki rules because it's versioned, reviewable, testable, drift-free, and auditable. OPA is the engine, Rego the language, Conftest the CI front door. Default to deny-by-default so gaps fail toward safety.
- **Rego & testing:** `deny[msg]` is a partial set rule; `input` is the case, `data` is the context; you test policy like code with `opa test`, mocking via `with`, asserting both the deny and the allow case.
- **Architecture:** keep the PDP (OPA decides) separate from every PEP (CI, admission webhook, API middleware) so one tested policy is enforced everywhere; decision logs are the audit evidence; bundles distribute policy to the fleet.
- **Admission control:** the API server is the unbypassable chokepoint; mutating runs before validating; Gatekeeper (Rego CRDs) vs Kyverno (YAML) by your Rego appetite; `failurePolicy` decides fail-open vs fail-closed, and a broad fail-closed webhook can wedge a cluster.
- **Rollout & judgment:** never ship straight to enforce — dry-run → warn → audit → enforce, scoped then fleet-wide; handle exceptions as owned, expiring, reviewed code; verify signatures/SLSA at admission; layer cloud-native guardrails, in-cluster engines, and CI checks rather than picking one.

---

## Further Reading

- **OPA documentation** (openpolicyagent.org/docs) — the engine, decision logs, and bundles; the canonical source.
- **Rego language reference and the OPA Policy Testing guide** — partial rules, `input`/`data`, and `opa test` / `with` mocking.
- **Conftest documentation** — running Rego against config files in CI.
- **Gatekeeper documentation** (open-policy-agent.github.io/gatekeeper) — ConstraintTemplates, Constraints, audit, and `enforcementAction`.
- **Kyverno documentation** (kyverno.io) — YAML policies, mutation, and policy exceptions.
- **Kubernetes Admission Controllers reference** — validating vs mutating webhooks and `failurePolicy`.
- **Sigstore/cosign and the SLSA framework** (sigstore.dev, slsa.dev) — image signing, provenance attestations, and admission-time verification.
- The [junior.md](junior.md) and [senior.md](senior.md) pages of this topic — every answer here is grounded in those, from the first Rego rule to operating policy across a fleet.

---

## Related Topics

- [01 — Required CI Checks](../01-required-ci-checks/interview.md) — the CI step as a policy enforcement point and the gate-vs-warning distinction.
- [02 — Branch Protection & Merge Policies](../02-branch-protection-and-merge-policies/interview.md) — policy as code applied to the merge gate, the sibling control.
- [07 — Break-glass & Bypass](../07-break-glass-and-bypass/interview.md) — the disciplined counterpart to exceptions: how a control is *deliberately* bypassed under audit.
- [Security](../../../../Security/) — supply-chain integrity, signing, and the threat models these policies defend against.
- [Release Engineering](../../release-engineering/) — where admission gates and signed-image verification sit in the path to production.
