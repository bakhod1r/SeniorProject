# Policy as Code — Middle Level

> **Roadmap:** [Quality Gates](../README.md) → Policy as Code
> *The junior page argued that rules belong in version control instead of a settings panel. This page makes that real: Rego you can actually write, Conftest wired as a required check, OPA Gatekeeper rejecting bad resources at the cluster door, and the habit that separates amateurs from professionals — unit-testing your policies like any other code.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Rego, Properly](#core-concept-1--rego-properly)
5. [Core Concept 2 — The Deny-by-Default Collection Pattern](#core-concept-2--the-deny-by-default-collection-pattern)
6. [Core Concept 3 — Conftest as a CI Gate](#core-concept-3--conftest-as-a-ci-gate)
7. [Core Concept 4 — Testing Policies Like Code](#core-concept-4--testing-policies-like-code)
8. [Core Concept 5 — Gatekeeper & Admission Control](#core-concept-5--gatekeeper--admission-control)
9. [Core Concept 6 — IaC & Supply-Chain Policy](#core-concept-6--iac--supply-chain-policy)
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

> Focus: **How do I write, test, and enforce policy as real code — in CI and at the Kubernetes admission boundary?**

At the junior level, "policy as code" is a slogan: rules live in git, not in a clicked checkbox. True, but a slogan can't be reviewed, tested, or run. This page turns it into machinery.

You'll learn enough **Rego** — the language behind Open Policy Agent — to write policies a reviewer would approve, not just copy. You'll wire **Conftest** as a *required check* so a misconfigured manifest fails the PR ([01 — Required CI Checks](../01-required-ci-checks/middle.md)) rather than the incident. You'll put **OPA Gatekeeper** (or Kyverno) at the cluster's admission webhook so a non-compliant Pod is *rejected at apply time*, not discovered three weeks later in an audit. And — the habit that distinguishes a professional — you'll **unit-test the policies themselves**, because an untested policy is just a confidently-worded guess that might `deny` everything or nothing.

The throughline is the shift the junior page promised, now with teeth: from *"the platform team clicks the same setting in 200 repos and prays it doesn't drift"* to *"one tested, reviewed, versioned policy, applied everywhere."*

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can say *why* a rule in git beats a rule in a UI.
- **Required:** You can read YAML — Kubernetes manifests, GitHub Actions workflows.
- **Required:** Comfortable in CI: you know what a *required status check* is ([01 — Required CI Checks](../01-required-ci-checks/middle.md)).
- **Helpful:** You've written a Terraform plan or a Dockerfile and know roughly what's in them.
- **Helpful:** A passing familiarity with admission webhooks (or just the idea that Kubernetes asks "should I allow this?" before storing a resource).

---

## Glossary

| Term | Meaning |
|---|---|
| **OPA** | Open Policy Agent — a general-purpose policy engine; evaluates Rego against JSON input. |
| **Rego** | OPA's declarative policy language. You describe *what is allowed/denied*, not *how to check*. |
| **`input`** | The JSON document being evaluated (a manifest, a plan, a PR payload). The one global every policy reads. |
| **Conftest** | A CLI that runs Rego policies against config files (YAML/JSON/Dockerfile/HCL). The CI-friendly face of OPA. |
| **Gatekeeper** | OPA packaged as a Kubernetes admission controller via `ConstraintTemplate` + `Constraint` CRDs. |
| **Kyverno** | A Kubernetes-native policy engine using YAML rules (no Rego). The common alternative to Gatekeeper. |
| **Admission control** | The webhook Kubernetes calls to *validate* (or *mutate*) a resource before persisting it. |
| **Sentinel** | HashiCorp's proprietary policy-as-code language, embedded in Terraform Cloud/Enterprise. |
| **Checkov / tfsec / KICS** | Rule-based IaC scanners with large built-in rule sets (no policy language to write). |

---

## Core Concept 1 — Rego, Properly

Rego looks alien for about an hour, then clicks. The trick is to stop reading it as imperative code. A Rego rule is a *definition*: "this value holds **when** these conditions all hold."

**The shape of a rule.** A rule has a head and a body. Every expression in the body is implicitly ANDed; the rule's value is defined only if the whole body succeeds.

```rego
package main

# allow is true WHEN the method is GET AND the path starts with /public
allow if {
    input.method == "GET"
    startswith(input.path, "/public")
}
```

> **Key insight:** Inside one rule body, lines are joined by **AND**. Across multiple rules *with the same name*, definitions are joined by **OR**. So you express "allowed if A, or if B" by writing `allow` twice with different bodies — not with an `||`. This single fact explains most Rego that confuses newcomers.

```rego
allow if { input.role == "admin" }        # admin ⇒ allowed
allow if { input.role == "auditor"; input.method == "GET" }  # OR auditor doing a GET
```

**Variables, `some`, `every`, `in`.** `input` is your data. Iterate with `some` (there exists) or `every` (for all). Membership is `in`; `contains` builds a *set-valued* rule.

```rego
import rego.v1

# does ANY container run as root? (existential)
some_container_runs_as_root if {
    some c in input.spec.containers
    c.securityContext.runAsNonRoot == false
}

# do ALL containers set a CPU limit? (universal)
all_have_cpu_limits if {
    every c in input.spec.containers {
        c.resources.limits.cpu
    }
}
```

**Comprehensions** build collections — the workhorse for "give me every X that violates Y":

```rego
# the names of every container missing a memory limit
bad := [c.name | some c in input.spec.containers; not c.resources.limits.memory]
```

**Helper rules and defaults** keep policies DRY and safe. `default` gives a rule a value when nothing else defines it — and the *only* safe default for an `allow` is `false`:

```rego
default allow := false   # fail closed: undefined ⇒ denied

is_production if { input.metadata.labels.env == "prod" }   # reusable helper
```

That's 80% of the Rego you'll write. The remaining 20% is the standard library (`startswith`, `endswith`, `regex.match`, `count`, `sprintf`), learned on demand.

---

## Core Concept 2 — The Deny-by-Default Collection Pattern

Real-world policies rarely compute a single `allow` boolean. They **collect every reason a thing is non-compliant** so a developer sees *all* the problems at once, not one-per-rerun. The convention is a set-valued `deny` (or `violation`) rule: each matching body contributes one message to the set.

```rego
package kubernetes.security
import rego.v1

# Deny a Pod whose container runs as root.
deny contains msg if {
    some c in input.spec.containers
    c.securityContext.runAsNonRoot != true
    msg := sprintf("container '%s' must set runAsNonRoot: true", [c.name])
}

# Deny a container with no memory limit (OOM risk → noisy-neighbour incidents).
deny contains msg if {
    some c in input.spec.containers
    not c.resources.limits.memory
    msg := sprintf("container '%s' must set resources.limits.memory", [c.name])
}

# Deny the ':latest' tag — unpinned images make deploys non-reproducible.
deny contains msg if {
    some c in input.spec.containers
    endswith(c.image, ":latest")
    msg := sprintf("container '%s' must not use the ':latest' tag", [c.name])
}
```

Three rules, same name, OR'd together. Each *adds* a string to the `deny` set when its body holds. An empty `deny` set means "compliant." The runner (Conftest, Gatekeeper) treats a non-empty `deny`/`violation` as a failure and prints every message.

> **Key insight:** A policy that returns a *set of human-readable reasons* is dramatically more useful than one that returns `false`. The author of a bad manifest gets a checklist — "fix these four things" — instead of a binary rejection they have to reverse-engineer. Design every policy to explain itself.

Gatekeeper uses the near-identical `violation` form (it expects `violation[{"msg": ...}]` records); Conftest defaults to `deny`/`warn`/`allow`. Same pattern, two spellings.

---

## Core Concept 3 — Conftest as a CI Gate

Conftest runs your Rego against config files and exits non-zero on any `deny`. That non-zero exit is the entire integration story for CI: a failing policy fails the job, and a failing job blocks the merge once you mark it required ([01 — Required CI Checks](../01-required-ci-checks/middle.md)).

```bash
# Policies live in ./policy/*.rego by convention.
conftest test deployment.yaml
# FAIL - deployment.yaml - container 'api' must set resources.limits.memory
# FAIL - deployment.yaml - container 'api' must not use the ':latest' tag
# 2 tests, 0 passed, 0 warnings, 2 failures
# (exit code 1)
```

Conftest doesn't care *what* the YAML/JSON is — it parses the file into `input` and runs Rego. That means the *same* tool gates wildly different artifacts:

```bash
conftest test k8s/*.yaml                 # Kubernetes manifests
conftest test Dockerfile                 # Dockerfiles (parsed into instructions)
conftest test docker-compose.yml         # Compose
terraform show -json plan.bin > plan.json
conftest test plan.json                  # a Terraform PLAN, as JSON
```

That last pair is the high-value move: you policy-check the Terraform **plan**, so you reject a public S3 bucket *before* `apply` ever runs.

**Wiring it as a required check:**

```yaml
# .github/workflows/policy.yml
name: policy
on: pull_request
jobs:
  conftest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: open-policy-agent/conftest@v0   # provides the binary
      - run: conftest test k8s/ --policy policy/ --output github
```

Then in branch protection, mark `policy / conftest` a **required** status check ([02 — Branch Protection & Merge Policies](../02-branch-protection-and-merge-policies/middle.md)). Now the rule isn't advice; it's a wall.

A few operational details that matter in practice:

- **Exit codes:** `0` = clean, `1` = a `deny`/failure, `2` = a usage/parse error. CI keys off the `1`.
- **Output formats:** `--output github` annotates the PR diff; `table`, `json`, `tap`, and `junit` feed dashboards and test reporters.
- **`warn` vs `deny`:** rules named `warn` print but *don't* fail the build — the lever for gradual rollout (see Real-World Examples).
- **Bundles:** publish shared policies to an OCI registry (`conftest push`/`pull`) so 200 repos consume one versioned policy bundle instead of copy-pasting Rego — the DRY payoff made literal.

---

## Core Concept 4 — Testing Policies Like Code

Here is the habit that separates engineers who *write* policy from engineers who *ship* it: **policies are code, so they get unit tests.** An untested `deny` rule has two failure modes that are equally disastrous and equally invisible — it denies *nothing* (a typo in a field path → the body never matches → false sense of safety) or it denies *everything* (an inverted condition → every deploy blocked). Only tests catch these before they reach the gate.

OPA ships a test runner. Tests live in `*_test.rego`, are rules named `test_...`, and feed the policy a **mock `input`** via the `with` keyword:

```rego
package kubernetes.security
import rego.v1

# A Pod that violates two rules ⇒ deny set must contain both messages.
test_denies_root_and_latest if {
    deny[_] with input as {
        "spec": {"containers": [
            {"name": "api", "image": "app:latest",
             "securityContext": {"runAsNonRoot": false}}
        ]}
    }
}

# A clean Pod ⇒ deny must be EMPTY (this is the test people forget).
test_allows_compliant_pod if {
    count(deny) == 0 with input as {
        "spec": {"containers": [
            {"name": "api", "image": "app:1.4.2",
             "resources": {"limits": {"memory": "256Mi"}},
             "securityContext": {"runAsNonRoot": true}}
        ]}
    }
}
```

Run them, and measure coverage just like application code:

```bash
opa test policy/ -v                 # run all test_ rules, verbose
opa test policy/ --coverage         # which Rego lines did tests exercise?
```

> **Key insight:** The most important policy test is the *negative* one — "a compliant input produces an **empty** deny set." Without it, a policy that accidentally denies everything still "passes" your positive tests (it certainly denies the bad input too). Always test both that bad input is caught **and** that good input sails through.

This is the same discipline as any [unit-testing practice](../../code-coverage/): arrange a known input, assert the policy's output, and fail the policy's *own* CI job if the assertion breaks. A policy guarding 200 repos deserves at least the test rigor of a single feature.

---

## Core Concept 5 — Gatekeeper & Admission Control

CI catches what flows through CI. But someone with cluster access can `kubectl apply` a non-compliant Pod directly, bypassing every pipeline. The defense is to move policy to the **admission boundary** — the point where Kubernetes asks an external webhook "should I allow this resource?" *before* writing it to etcd.

**OPA Gatekeeper** does exactly this. You install two kinds of objects:

1. A **`ConstraintTemplate`** — the reusable *rule* (Rego), defining a new constraint *kind*.
2. A **`Constraint`** — an *instance* of that template with parameters, scoped to certain resource kinds.

```yaml
# 1. The template: the policy, parameterized.
apiVersion: templates.gatekeeper.sh/v1
kind: ConstraintTemplate
metadata:
  name: k8srequiredlabels
spec:
  crd:
    spec:
      names:
        kind: K8sRequiredLabels
      validation:
        openAPIV3Schema:
          type: object
          properties:
            labels:
              type: array
              items: { type: string }
  targets:
    - target: admission.k8s.gatekeeper.sh
      rego: |
        package k8srequiredlabels
        violation[{"msg": msg}] {
          required := input.parameters.labels
          provided := {k | some k; input.review.object.metadata.labels[k]}
          missing := required[_]
          not provided[missing]
          msg := sprintf("missing required label: %v", [missing])
        }
```

```yaml
# 2. The constraint: apply that template to Pods, requiring an 'owner' label.
apiVersion: constraints.gatekeeper.sh/v1beta1
kind: K8sRequiredLabels
metadata:
  name: pods-must-have-owner
spec:
  enforcementAction: deny          # deny | dryrun | warn
  match:
    kinds:
      - apiGroups: [""]
        kinds: ["Pod"]
  parameters:
    labels: ["owner"]
```

Now `kubectl apply` of an unlabeled Pod is **rejected by the API server** with your message. Note the lever every team needs: `enforcementAction: dryrun` lets you observe violations without blocking — the rollout ramp from *warn* to *enforce*. And Gatekeeper's **audit** mode periodically scans *already-running* resources, so you discover the violations that predate the policy (you can't break-glass the past, but you can list it).

**Kyverno** is the popular alternative: same admission-webhook idea, but policies are **plain YAML** — no Rego. For teams that find Rego a tax, this lowers the barrier:

```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata: { name: disallow-latest-tag }
spec:
  validationFailureAction: Enforce       # Audit | Enforce
  rules:
    - name: require-image-tag
      match: { any: [{ resources: { kinds: ["Pod"] } }] }
      validate:
        message: "Using ':latest' or an untagged image is not allowed."
        pattern:
          spec:
            containers:
              - image: "!*:latest"
```

> **Key insight:** Admission control is **validating** (accept/reject) *or* **mutating** (rewrite the resource — e.g. inject a default `securityContext`). Both Gatekeeper and Kyverno can validate; Kyverno's mutation is especially ergonomic. Prefer *validating* policy for safety gates (it's auditable and predictable); use *mutating* policy sparingly and visibly, because a webhook that silently changes resources is a debugging trap.

CI policy and admission policy are **complementary, not redundant**: CI gives developers fast feedback in the PR; admission is the backstop that catches anything that skips CI. Run both, ideally from the *same* Rego bundle.

---

## Core Concept 6 — IaC & Supply-Chain Policy

Infrastructure and the software supply chain are where policy-as-code pays for itself, because a single misconfiguration here is a breach, not a bug.

**Terraform via OPA/Conftest.** Convert the plan to JSON and assert on `resource_changes`:

```rego
package terraform.s3
import rego.v1

# Deny any planned S3 bucket that is publicly readable.
deny contains msg if {
    some r in input.resource_changes
    r.type == "aws_s3_bucket_acl"
    r.change.after.acl == "public-read"
    msg := sprintf("S3 bucket '%s' must not be public-read", [r.address])
}

# Deny an EBS volume created without encryption.
deny contains msg if {
    some r in input.resource_changes
    r.type == "aws_ebs_volume"
    r.change.after.encrypted != true
    msg := sprintf("EBS volume '%s' must be encrypted", [r.address])
}
```

**The IaC landscape**, so you choose deliberately:

| Tool | Style | Best for |
|---|---|---|
| **OPA/Conftest** | Write Rego against plan JSON | Custom, org-specific rules; one language across K8s + IaC |
| **HashiCorp Sentinel** | Proprietary language, in TF Cloud/Enterprise | Teams already on TFC who want native gates |
| **Checkov / tfsec / KICS** | Rule-based scanners, huge built-in rule sets | Fast wins — broad coverage with *zero* policy to author |

The honest split: **scanners** (Checkov/tfsec/KICS) give you hundreds of best-practice checks for free — start there. **Rego/Sentinel** is for the rules *only your org* has ("every bucket must carry a `cost-center` tag," "no resource outside `eu-west-1`"). Most mature setups run both: a scanner for breadth, custom policy for the specifics.

**Supply-chain / signed images.** A powerful admission policy is *"refuse to run a container image unless it carries a valid signature."* With Cosign/Sigstore, the image is signed at build time; an admission policy (Kyverno's `verifyImages`, or Gatekeeper's image-verification provider) rejects unsigned or untrusted images at apply time — closing the door on "someone pushed a tampered image to the registry." This is where policy-as-code meets [Security](../../../../Security/); treat image-signature verification as the canonical supply-chain gate.

---

## Real-World Examples

**1. PR hygiene as policy (policy over a CI/PR JSON).** Policy doesn't only guard infra. Feed the PR payload (via the GitHub API or `gh pr view --json`) into Rego and require process discipline:

```rego
package pr.hygiene
import rego.v1

deny contains "PR description must not be empty" if {
    count(trim_space(input.body)) == 0
}

deny contains "PR must link an issue (e.g. 'Closes #123')" if {
    not regex.match(`(?i)(closes|fixes|resolves)\s+#\d+`, input.body)
}
```

Wire it as a check and you've encoded "every change is traceable to a reason" — a rule that used to live in a wiki nobody reads, now enforced.

**2. Gradual enforcement, the only safe rollout.** You never flip a policy from off to *enforce* across 200 repos in one PR — you'd block every team at once. The ramp:

1. **Dry-run / warn:** `warn` rules in Conftest, `enforcementAction: dryrun` in Gatekeeper. Violations are *reported*, builds stay green. Measure the blast radius.
2. **Audit:** Gatekeeper audit lists existing violators; teams fix on their schedule.
3. **Enforce:** flip `deny` / `enforcementAction: deny`. By now the count of violations is near zero, so the switch is a non-event.

**3. One policy, many clusters — the anti-drift win.** A `disallow-latest-tag` `ConstraintTemplate` lives in one git repo and is `kubectl apply`-ed (via GitOps) to dev, staging, and prod. There is no "someone forgot to set it on the prod cluster," because the policy *is* the same file, applied everywhere — the literal answer to the junior page's "platform team clicks settings in 200 places" problem.

**4. A lighter built-in: GitHub repository rulesets.** Not every org wants OPA. GitHub **repository rulesets** (and **org-level rules**) are policy-as-code's lightweight cousin: branch/tag protection, required checks, required reviews — expressed as JSON, version-controllable, and *applicable across all repos in an org from one place*. They support an **evaluate** (dry-run) mode before **active** enforcement — the same warn-then-enforce ramp. Reach for rulesets when your policy is "how PRs and branches behave"; reach for OPA when it's "what's *inside* the YAML."

---

## Mental Models

- **A Rego rule is a definition, not a procedure.** It says "this value exists *when* the body holds." Lines in a body are AND; repeated rule names are OR. Once you read Rego as *math* ("there exists a container such that…") instead of *steps*, it stops fighting you.

- **`deny` is a growing pile of receipts.** Each violation drops one receipt (a message) on the pile. An empty pile means compliant; the runner just checks "is the pile empty?" Design policies to drop *descriptive* receipts.

- **CI is the front door; admission is the side door.** CI gives fast feedback to people who use the pipeline. Admission control catches everyone who walks around it. Lock both. A gate with an unlocked side door is decoration.

- **An untested policy is a loaded gun pointing at your own deploys.** It can silently allow everything (typo'd field path) or block everything (inverted condition). The test that proves a *clean* input yields an *empty* deny set is the safety catch — never ship without it.

- **Scanners give breadth; Rego gives specificity.** Checkov knows the 300 generic mistakes. Only your Rego knows *your* org's rules. They're additive, not competing.

---

## Common Mistakes

1. **Defaulting `allow` to anything but `false`.** A policy that fails *open* — allows when undefined — is worse than no policy, because it advertises safety it doesn't provide. Always `default allow := false`.

2. **No negative test.** Testing only that bad input is denied. A policy that denies *everything* passes that test perfectly. You must also assert a compliant input produces an empty `deny` set.

3. **Confusing AND with OR in Rego.** Writing two conditions on two lines (AND) when you meant "either" (which needs two rule definitions), or vice-versa. This produces a policy that's silently too strict or too loose.

4. **Policy-checking applied infra instead of the plan.** Scanning live resources is *audit*; the gate must run on the **plan** (Terraform `show -json`) so it blocks *before* `apply`. Catching the public bucket after it exists is an incident report, not a gate.

5. **Mutating admission as a habit.** A webhook that silently rewrites resources makes "what I applied ≠ what's running" — a maddening debugging trap. Prefer *validating* (reject + explain) for safety gates; mutate only when the change is obvious and documented.

6. **Skipping the gradual rollout.** Flipping a brand-new policy straight to `enforce` org-wide blocks every team simultaneously and gets your policy effort reverted by Friday. Always warn → audit → enforce.

7. **Copy-pasting Rego into 200 repos.** That re-creates the drift problem policy-as-code was supposed to kill. Publish a versioned **bundle** (OCI registry, or a `ConstraintTemplate` via GitOps) and consume it everywhere.

---

## Test Yourself

1. In a single Rego rule body with three lines, are the conditions combined with AND or OR? How do you express OR?
2. Why is `default allow := false` the only safe default, and what does "failing open" mean?
3. What's the difference between Conftest's `deny` and `warn` rules, and how does each affect a CI job's exit code?
4. You want to policy-check Terraform *before* anything is created. What artifact do you feed Conftest, and how do you produce it?
5. Name the two objects OPA Gatekeeper needs and what each one is for. What does `enforcementAction: dryrun` buy you?
6. What is the single most important *negative* test for any `deny` policy, and why do positive tests alone hide a catastrophic bug?
7. When would you choose Checkov/tfsec over writing your own Rego — and when is the reverse true?

<details>
<summary>Answers</summary>

1. **AND** — every expression in one body must hold for the rule to be defined. You express OR by writing the rule *multiple times* with the same name and different bodies; the definitions are OR'd together.
2. Because an undefined result then evaluates to `false` (denied) — the policy **fails closed**. "Failing open" means an undefined/error result is treated as *allowed*, so a typo or missing data silently grants access — worse than no policy, since it implies safety it doesn't deliver.
3. `deny` failures make Conftest exit non-zero (`1`), failing the CI job. `warn` prints the message but exits `0`, so the build stays green — the lever for gradual rollout.
4. The **plan as JSON**: `terraform plan -out plan.bin && terraform show -json plan.bin > plan.json`, then `conftest test plan.json`. Asserting on `input.resource_changes` blocks bad resources *before* `apply`.
5. A **`ConstraintTemplate`** (the reusable Rego rule, defining a new constraint kind) and a **`Constraint`** (an instance with parameters, scoped to resource kinds). `dryrun` reports violations *without* blocking applies — letting you measure blast radius before enforcing.
6. That a **compliant input yields an empty `deny` set**. Positive tests only prove bad input is caught — but a policy that denies *everything* also catches the bad input, so it passes every positive test while silently blocking all deploys. The negative test is the only thing that detects it.
7. Choose **scanners** (Checkov/tfsec/KICS) for breadth — hundreds of generic best-practice checks with zero authoring. Write **Rego/Sentinel** for rules unique to your org (specific tags, regions, naming). Mature setups run both: scanner for coverage, custom policy for the specifics.

</details>

---

## Cheat Sheet

```
REGO ESSENTIALS
  rule head if { body }     body lines = AND
  rule X if {..} ; rule X   same name across rules = OR
  input                     the JSON being evaluated (manifest/plan/PR)
  default allow := false    FAIL CLOSED — the only safe default
  some c in coll            ∃  (exists)        every c in coll {..}  ∀ (forall)
  x in set / contains       membership / set-valued rule
  [v | cond]                comprehension (collect matches)

DENY PATTERN (Conftest)            VIOLATION PATTERN (Gatekeeper)
  deny contains msg if {             violation[{"msg": msg}] {
    <bad condition>                    <bad condition>
    msg := sprintf(...)                msg := sprintf(...)
  }                                  }
  empty deny set ⇒ compliant

CONFTEST IN CI
  conftest test deployment.yaml      exit 0 ok / 1 deny / 2 error
  conftest test plan.json            policy-check the TF PLAN, not live infra
  --output github|json|junit|table   PR annotations / dashboards / reporters
  warn rules ⇒ don't fail build      (gradual rollout)
  conftest push/pull (OCI)           share ONE versioned bundle, not copies

TEST YOUR POLICIES (the pro habit)
  *_test.rego, rules named test_...
  deny[_] with input as {...}        positive: bad input IS denied
  count(deny)==0 with input as {...} NEGATIVE: clean input ⇒ empty (don't skip!)
  opa test policy/ -v --coverage

ADMISSION CONTROL
  Gatekeeper = ConstraintTemplate (rule) + Constraint (instance)
  enforcementAction: deny | dryrun | warn   ;  audit = scan existing
  Kyverno = YAML rules, no Rego ; validate vs MUTATE (mutate sparingly)

IaC / SUPPLY CHAIN
  Checkov/tfsec/KICS  breadth, zero authoring   → start here
  OPA/Sentinel        your org's specific rules → custom
  cosign + verifyImages  reject unsigned images at admission

ROLLOUT:  warn/dryrun → audit → enforce        (never straight to enforce)
LIGHT OPTION: GitHub repository rulesets (evaluate → active)
```

---

## Summary

- **Rego** is declarative: a rule defines a value *when* its body holds. Body lines are **AND**; repeated rule names are **OR**. `input` is the document under test; `default allow := false` makes it fail closed.
- Real policies use the **deny-by-default collection pattern** — a set-valued `deny`/`violation` that accumulates one human-readable message per problem, so authors get a full checklist, not a binary rejection.
- **Conftest** runs Rego against any config (YAML, Dockerfile, Compose, **Terraform plan JSON**) and exits non-zero on failure — wire that exit into CI and mark it a **required check** ([01](../01-required-ci-checks/middle.md), [02](../02-branch-protection-and-merge-policies/middle.md)) to turn advice into a wall.
- **Test the policies themselves** with `opa test` and `*_test.rego`. The non-negotiable test is the *negative* one: a compliant input must yield an **empty** deny set, or a policy that blocks everything will pass unnoticed.
- **Admission control** (OPA Gatekeeper's `ConstraintTemplate` + `Constraint`, or Kyverno's YAML) is the backstop that rejects non-compliant resources at `apply` time, catching what bypasses CI. Validate by default; mutate sparingly; ramp `dryrun → audit → enforce`.
- **IaC & supply-chain:** scanners (Checkov/tfsec/KICS) for free breadth, Rego/Sentinel for org-specific rules, and signed-image verification (cosign) as the canonical supply-chain admission gate.
- The payoff, concretely: policy that is **versioned** (git history is the "why"), **testable**, **reviewable** (you PR a policy), **consistent** across every repo and cluster (no clicked-setting drift), **auditable**, and **DRY** — one policy, applied everywhere. Continue to [senior.md](senior.md) for policy at organizational scale: distribution, decision logging, performance, and exemptions without holes.

---

## Further Reading

- *Open Policy Agent — Policy Language (Rego)* — the official Rego reference; the primary source for everything in Core Concept 1.
- *OPA Rego Style Guide* — the community conventions for readable, maintainable policy (rule naming, package layout, the `deny`/`violation` idioms).
- *Conftest Documentation* — running policies against config, output formats, bundles, and the OCI registry workflow.
- *OPA Gatekeeper Documentation* — `ConstraintTemplate`/`Constraint` CRDs, enforcement actions, and audit mode.
- *Kyverno Documentation* — YAML-based validating/mutating policies and `verifyImages` for signed-image enforcement.
- [senior.md](senior.md) — policy-as-code at scale: bundle distribution, decision logs, performance, exemption workflows, and the org-wide rollout playbook.

---

## Related Topics

- [01 — Required CI Checks](../01-required-ci-checks/middle.md) — how a failing Conftest job becomes a merge-blocking required check.
- [02 — Branch Protection & Merge Policies](../02-branch-protection-and-merge-policies/middle.md) — marking the policy check required, and GitHub rulesets as lightweight policy-as-code.
- [04 — Deploy Approvals & Sign-offs](../04-deploy-approvals-and-signoffs/middle.md) — admission and approval gates working together on the path to production.
- [Security](../../../../Security/) — supply-chain hardening, image signing (cosign/sigstore), and the threats admission policy defends against.
- [Release Engineering](../../release-engineering/) — where policy gates sit in the deploy pipeline and how they interact with promotion.
