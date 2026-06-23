# Policy as Code — Senior Level

> **Roadmap:** [Quality Gates](../README.md) → Policy as Code
> *The middle page showed you how to write a `deny` rule and run `conftest`. This page is about the engine and the architecture: how Rego actually evaluates a query against a document, where the decision is made versus where it is enforced, what really happens inside a Kubernetes admission webhook, and why a single misconfigured `failurePolicy` can take down a cluster that was working perfectly five minutes ago.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Rego Is a Query Language Over a Document](#core-concept-1--rego-is-a-query-language-over-a-document)
5. [Core Concept 2 — Unification, Assignment, and Variable Safety](#core-concept-2--unification-assignment-and-variable-safety)
6. [Core Concept 3 — Iteration as Existential Quantification](#core-concept-3--iteration-as-existential-quantification)
7. [Core Concept 4 — The PDP/PEP Model: `input` vs `data`](#core-concept-4--the-pdppep-model-input-vs-data)
8. [Core Concept 5 — Bundles, Decision Logs, and the Management API](#core-concept-5--bundles-decision-logs-and-the-management-api)
9. [Core Concept 6 — Admission Control Internals](#core-concept-6--admission-control-internals)
10. [Core Concept 7 — `failurePolicy`: Fail-Open vs Fail-Closed](#core-concept-7--failurepolicy-fail-open-vs-fail-closed)
11. [Core Concept 8 — Testing Policy Before It Blocks Prod](#core-concept-8--testing-policy-before-it-blocks-prod)
12. [Core Concept 9 — Exceptions and Waivers as Code](#core-concept-9--exceptions-and-waivers-as-code)
13. [Core Concept 10 — Supply Chain: Provenance and Signatures at Admit Time](#core-concept-10--supply-chain-provenance-and-signatures-at-admit-time)
14. [Real-World Examples](#real-world-examples)
15. [Mental Models](#mental-models)
16. [Common Mistakes](#common-mistakes)
17. [Test Yourself](#test-yourself)
18. [Cheat Sheet](#cheat-sheet)
19. [Summary](#summary)
20. [Further Reading](#further-reading)
21. [Related Topics](#related-topics)

---

## Introduction

> Focus: **The engine semantics and the enforcement architecture a senior engineer reasons about when policy stops being a CI lint and becomes load-bearing infrastructure.**

By the middle level you can author a `deny` rule, mock `input`, and wire `conftest` into a pipeline. That makes you productive. The senior jump is different: you now own the *engine* and the *enforcement topology*. You decide whether policy runs as a sidecar PDP or compiles into Gatekeeper CRDs; whether your admission webhook fails open or closed; whether a rule that's quadratic on a 4,000-object cluster gets shipped; and whether your supply-chain gate actually verifies a signature or just checks that an annotation exists.

Each of those choices has second-order effects on cluster availability, mean-time-to-bypass during an incident, the audit trail your compliance team relies on, and the blast radius of a buggy policy. To choose well you have to understand Rego at the level of *unification and the virtual document*, the Policy Decision Point / Policy Enforcement Point split, and the exact ordering of the Kubernetes admission chain — because that is where the failures actually live. This page is that layer.

---

## Prerequisites

- **Required:** You've internalized [middle.md](middle.md) — writing `deny`/`violation` rules, `input`, running `opa eval` and `conftest`, the gate-as-CI-step idea.
- **Required:** You can read JSON/YAML fluently and reason about a Kubernetes object's `spec`/`metadata`.
- **Helpful:** You've debugged a webhook timeout or a `CrashLoopBackOff` and felt how a control-plane component failing differs from an app failing.
- **Helpful:** A working memory of declarative-vs-imperative thinking — Rego rewards giving up "do this then that" for "this is true when."

---

## Glossary

| Term | Meaning |
|---|---|
| **Rego** | OPA's declarative query language; evaluates rules against a JSON document model to produce a decision. |
| **PDP** | Policy Decision Point — the engine (OPA) that evaluates `policy + data + input → decision`. Makes no enforcement. |
| **PEP** | Policy Enforcement Point — the component that *calls* the PDP and acts on the result (CI step, admission webhook, API middleware, Envoy `ext_authz`). |
| **`input`** | The document representing *the thing being decided* — the query (a K8s object, a Terraform plan, an HTTP request). |
| **`data`** | External context loaded into OPA — config, allow-lists, synced cluster state — available to every query. |
| **Partial / complete rule** | A partial rule builds up a set or object across many bindings; a complete rule assigns a single value (often a default). |
| **Unification (`=`)** | Two-way "make these structurally equal by binding variables," not assignment. |
| **Bundle** | A versioned, optionally signed tarball of policy + data that OPA pulls from a server. |
| **Decision log** | The structured record OPA emits for every decision — input, result, policy version. |
| **Gatekeeper** | OPA-based Kubernetes admission controller; `ConstraintTemplate` → CRD, `Constraint` → instance. |
| **`failurePolicy`** | Webhook setting deciding what happens when the policy server is unreachable: `Fail` (closed) or `Ignore` (open). |
| **Provenance / attestation** | Signed metadata (in-toto/SLSA) describing how an artifact was built. |

---

## Core Concept 1 — Rego Is a Query Language Over a Document

The single most clarifying fact about Rego: it is **not** an imperative scripting language with funny syntax. It is a declarative query language whose entire world is one big JSON document. `input` and `data` are sub-trees of that document; your rules define *additional* sub-trees — a **virtual document** — computed on demand. Evaluating policy means *querying* that combined document and asking "what is the value of `data.main.deny`?"

Rules come in two shapes, and the distinction governs everything downstream.

A **complete rule** assigns a single value. It's the form you use for a default or a scalar decision:

```rego
package main
import rego.v1

default allow := false                      # complete rule with a default

allow if {                                  # ...overridden to true when the body holds
    input.user.role == "admin"
}
```

A **partial rule** incrementally *builds up* a set or object from every binding that satisfies its body. This is the form behind every `deny`/`violation` you've written — each violating case contributes one element to a growing set:

```rego
# partial SET rule: deny is a set[string]
deny contains msg if {
    input.spec.containers[i].securityContext.privileged
    msg := sprintf("container %v is privileged", [input.spec.containers[i].name])
}

# partial OBJECT rule: a map keyed by container name
violation_by_container[name] := reason if {
    c := input.spec.containers[i]
    c.securityContext.privileged
    name := c.name
    reason := "privileged"
}
```

The PEP then asks for `data.main.deny` and gets the *whole set* — empty means allow, non-empty means a list of reasons to reject. That "empty set = allow" convention is the heart of the model, and also the heart of one of its sharpest foot-guns (see Common Mistakes): if a rule's body silently never matches, the set is empty, and an empty set reads as **allow**.

> **Key insight:** Rego doesn't "run" top to bottom and "return." It *defines* virtual documents and you *query* them. A `deny` rule isn't a function that returns a list — it's the definition of a set, and the engine materializes exactly the slice you query. Internalizing "everything is a document, rules extend it, evaluation is a query" is the difference between fighting Rego and thinking in it.

---

## Core Concept 2 — Unification, Assignment, and Variable Safety

Three operators look interchangeable and are not. Getting them wrong is the source of most "why is my rule always true / never true" confusion.

- **`:=` assignment** — binds a local variable to a value, exactly once, in this scope. Re-assigning is a compile error. Use it almost everywhere; it's unambiguous.
- **`==` comparison** — a pure boolean test. Both sides must already be ground (no unbound variables). Use it in rule bodies to *check* equality.
- **`=` unification** — the subtle one. It makes the two sides *structurally equal*, binding any unbound variables on either side to whatever makes them match. It is bidirectional.

```rego
x := 1            # assignment: x is now 1
x == 1            # comparison: true
[a, 2] = [1, b]   # unification: binds a=1 and b=2 simultaneously
```

Unification is powerful for destructuring — `{"kind": k, "metadata": {"name": n}} = input` pulls fields out in one line — but it's why beginners write `=` expecting a test and accidentally introduce a fresh binding that's always satisfiable.

**Variable safety** is the related compile-time guarantee. A variable is *safe* only if it appears in a position that can *bind* it (an iteration, an assignment, a unification against ground data). A variable that appears only in a negative or comparison position is **unsafe**, and OPA refuses to compile:

```rego
# UNSAFE: `port` is never bound — only compared. Compile error.
deny contains msg if {
    port != 443
    msg := sprintf("bad port %v", [port])
}

# SAFE: `port` is bound by iterating input first, then compared.
deny contains msg if {
    port := input.spec.ports[_].containerPort
    port != 443
    msg := sprintf("bad port %v", [port])
}
```

This is a *feature*: the safety checker prevents whole classes of accidental "matches everything" rules at compile time. `import rego.v1` (and OPA's v1 default) tightens this further — `if` and `contains` become mandatory keywords, which removes the historic ambiguity between "a complete rule whose value is a set" and "a partial set rule."

> **Key insight:** `:=` is assignment, `==` is a test, `=` is bidirectional unification. Reach for `:=` and `==` by default; use `=` deliberately for destructuring. And treat a "variable X is unsafe" error as the compiler doing you a favor — it caught a rule that would otherwise have a meaningless or always-true result.

---

## Core Concept 3 — Iteration as Existential Quantification

Rego has no `for` loop. Iteration happens through *implicit existential quantification*: a free variable (or `_`, the don't-care) in an array/object reference means "there exists some index for which the body holds."

```rego
# "there EXISTS a container that is privileged"  → deny fires once per such container
deny contains msg if {
    some i
    input.spec.containers[i].securityContext.privileged
    msg := sprintf("%v is privileged", [input.spec.containers[i].name])
}
```

`some i` declares `i` as a local iteration variable (best practice — it scopes the variable and avoids accidentally referencing an outer binding). The engine tries *every* value of `i`; each one that satisfies the body contributes a `msg` to the `deny` set. That's how one rule generates N violations.

The dual — **universal quantification**, "for *all* elements" — is exactly the case people get wrong, because the naive translation inverts the meaning. "All containers must set `runAsNonRoot`" is *not* `input.spec.containers[_].securityContext.runAsNonRoot` (that's "there exists one that does"). Rego provides `every` for the universal case:

```rego
# CORRECT: deny if NOT every container runs as non-root
deny contains "all containers must set runAsNonRoot=true" if {
    not all_nonroot
}

all_nonroot if {
    every c in input.spec.containers {
        c.securityContext.runAsNonRoot == true
    }
}
```

Before `every` existed, you expressed "for all" as "not exists a counterexample," which is the same logic and still worth being able to read:

```rego
# Equivalent classic form: deny if THERE EXISTS a container that is NOT non-root
deny contains msg if {
    c := input.spec.containers[_]
    not c.securityContext.runAsNonRoot == true
    msg := sprintf("%v must runAsNonRoot", [c.name])
}
```

> **Key insight:** A bare free variable means *there exists*. The classic Rego bug is writing an existential where you meant a universal — `containers[_].x == true` is satisfied by *one* good container even if the rest are bad. When the requirement is "all," reach for `every`, or invert to "deny if there exists a counterexample." Get the quantifier right and the rule is correct; get it wrong and it passes exactly the inputs it should reject.

**Performance corollary.** Iteration is also where Rego performance dies. OPA builds **rule indexes** so that lookups keyed on a literal (e.g. `input.kind == "Pod"`) prune the search instead of scanning, but a nested iteration with no indexable handle is genuinely O(n²) — the canonical example being "no two ingresses share a host," which compares every object against every other. `walk(input, [path, value])` recursively visits *every* node in a document and is convenient but can be brutally expensive on large inputs. **Partial evaluation** (`opa eval --partial`) is the senior's escape hatch: OPA specializes a policy against the known `data` ahead of time, collapsing constant work so the per-request evaluation is small — the technique behind OPA-in-Envoy at request rates where full evaluation per call would never keep up.

---

## Core Concept 4 — The PDP/PEP Model: `input` vs `data`

The most important architectural idea in policy-as-code is the separation between *deciding* and *enforcing*. OPA is a **Policy Decision Point (PDP)**: it takes a policy, some context, and a query, and returns a decision. It enforces *nothing*. The **Policy Enforcement Point (PEP)** is whatever calls the PDP and acts on the answer — a CI step that exits non-zero, a Kubernetes admission webhook that returns `allowed: false`, an API gateway that returns `403`, an Envoy sidecar doing `ext_authz`.

```
              ┌─────────── PEP (enforces) ───────────┐
  request ──▶ │ admission webhook / CI step / Envoy   │
              │        │ query (input)        ▲        │
              │        ▼                      │ decision│
              │   ┌──────────── PDP ──────────┴───┐    │
              │   │ OPA: policy + data → decision  │    │
              │   └────────────────────────────────┘    │
              └───────────────────────────────────────┘
```

This split is the source of policy-as-code's leverage: the *same* PDP and even the *same* rules serve many PEPs. The two inputs to the PDP have distinct roles:

- **`input`** is *the thing being decided* — supplied per query. The Pod spec being admitted, the Terraform plan JSON, the HTTP request's method/path/headers/token. It changes every call.
- **`data`** is *external context* — loaded into OPA out of band and available to every query. Allow-listed registries, the org's tier-to-namespace map, a list of approved base images, or *synced cluster state*. It changes rarely relative to `input`.

Putting context in `data` instead of inlining it in the policy is what makes the same rule reusable across environments — you ship one policy and different `data` per cluster. It is also what enables *cross-object* rules: a single object's `input` can't know about its siblings, so "this ingress host must be unique" only works if all ingresses are synced into `data` (exactly what Gatekeeper's replication does, Core Concept 6).

```rego
package main
import rego.v1

# `data.config.allowed_registries` comes from external context, not the query.
deny contains msg if {
    some c in input.review.object.spec.containers
    not registry_allowed(c.image)
    msg := sprintf("image %q is from an untrusted registry", [c.image])
}

registry_allowed(image) if {
    some reg in data.config.allowed_registries
    startswith(image, reg)
}
```

> **Key insight:** OPA decides; it never enforces. Every real outage and every real bypass happens at the **PEP**, not the PDP — a webhook that fails open, a CI step whose exit code is ignored, an Envoy filter in permissive mode. When you reason about a policy's *safety*, reason about the enforcement point's behavior on the unhappy path, not just the rule's logic on the happy one.

---

## Core Concept 5 — Bundles, Decision Logs, and the Management API

A PDP is only as good as its distribution and its audit trail. OPA's **management API** provides both, and they're what turn a pile of `.rego` files into operable infrastructure.

**Bundles** are how policy and data reach a running OPA. A bundle is a gzipped tarball of `.rego` files plus a `data.json`, served from an HTTP endpoint (an OPA bundle server, an S3 bucket, an OCI registry). OPA polls, downloads, activates atomically, and reports its bundle revision. Crucially, bundles can be **signed**: OPA verifies a JWT-based signature over the bundle's file hashes before activation, so a tampered or unauthorized bundle is rejected — the policy itself becomes a supply-chain-controlled artifact.

```yaml
# opa config: pull a signed bundle, ship decision logs, expose status
services:
  policy_server: { url: https://bundles.internal.example.com }
bundles:
  authz:
    service: policy_server
    resource: bundles/authz.tar.gz
    polling: { min_delay_seconds: 30, max_delay_seconds: 60 }
    signing: { keyid: prod-2026, scope: write }     # reject unsigned/wrong-key bundles
decision_logs:
  service: policy_server
  reporting: { min_delay_seconds: 5, max_delay_seconds: 10 }
status:
  service: policy_server                              # bundle revision, activation health
```

**Decision logs** are the underrated half. OPA can emit a structured record of *every* decision — the `input`, the result, the policy bundle revision, the timestamp, a decision ID — to a remote endpoint. This is a compliance and forensics goldmine: "prove no Pod without an owner label was admitted last quarter" becomes a query over decision logs, and "why was this request denied at 02:14" becomes a single lookup. You can mask sensitive fields (`decision_logs.mask`) so secrets in `input` never reach the log sink.

> **Key insight:** Bundles make policy a *signed, versioned, atomically-distributed artifact* — not files copied onto a box. Decision logs make every decision *auditable after the fact*. Together they're what let you answer the auditor's two questions — "what policy was in force?" and "what did it decide?" — with data instead of a shrug. A policy system without decision logs is enforcing in the dark.

---

## Core Concept 6 — Admission Control Internals

Kubernetes admission is the highest-stakes PEP because the policy server sits *in the path of every write to the cluster*. Understanding the exact flow is what separates "I wrote a Gatekeeper constraint" from "I know why my constraint didn't fire and why the cluster wedged."

The API request lifecycle, in order:

```
kubectl apply ──▶ kube-apiserver
   │  authn ─▶ authz ─▶ MUTATING admission webhooks (can change the object)
   │                  ─▶ object schema validation
   │                  ─▶ VALIDATING admission webhooks (accept or reject; no changes)
   │                  ─▶ persisted to etcd
```

Mutating webhooks run **first** and may patch the object (inject a sidecar, add a default label). Validating webhooks run **after** and may only accept or reject. Both are HTTP callouts the apiserver makes to *your* webhook server, sending an `AdmissionReview` and expecting one back. This ordering matters: a validating policy sees the object *after* mutation, so "every Pod must have a sidecar" can be satisfied by a mutating webhook that injects it, then confirmed by a validating one.

**Gatekeeper** is the OPA-based implementation, and its architecture is worth knowing precisely:

- A **`ConstraintTemplate`** carries the Rego (a `violation` rule) and a parameters schema; Gatekeeper compiles it into a new **CRD**. The template defines the *kind of check*.
- A **`Constraint`** is an instance of that CRD that *parameterizes and scopes* it — which resources it matches, which namespaces, what limits. One template, many constraints.
- The **audit controller** periodically re-evaluates *existing* cluster objects against all constraints and writes violations to each constraint's `status`. This is how you find resources that were created *before* a policy existed — admission only guards *new* writes.
- The **sync** configuration replicates chosen object kinds into OPA's `data.inventory`, so a constraint can reason across objects. "Ingress hosts must be unique" is impossible from a single object's `input`; it works only because every Ingress is synced into `data`.

```yaml
# 1) Template: the reusable check (Rego inside a CRD definition)
apiVersion: templates.gatekeeper.sh/v1
kind: ConstraintTemplate
metadata: { name: k8suniqueingresshost }
spec:
  crd:
    spec:
      names: { kind: K8sUniqueIngressHost }
  targets:
    - target: admission.k8s.gatekeeper.sh
      rego: |
        package k8suniqueingresshost
        identical(obj, review) {
          obj.metadata.namespace == review.object.metadata.namespace
          obj.metadata.name == review.object.metadata.name
        }
        violation[{"msg": msg}] {
          input.review.object.spec.rules[_].host == host
          # cross-object: scan ALL ingresses synced into data.inventory
          other := data.inventory.namespace[ns][_]["networking.k8s.io/v1"]["Ingress"][name]
          other.spec.rules[_].host == host
          not identical(other, input.review)
          msg := sprintf("ingress host %q already in use", [host])
        }
---
# 2) Sync config: replicate Ingresses into data.inventory so the above can see them
apiVersion: config.gatekeeper.sh/v1alpha1
kind: Config
metadata: { name: config, namespace: gatekeeper-system }
spec:
  sync:
    syncOnly:
      - { group: "networking.k8s.io", version: "v1", kind: "Ingress" }
---
# 3) Constraint: instantiate + scope the template
apiVersion: constraints.gatekeeper.sh/v1beta1
kind: K8sUniqueIngressHost
metadata: { name: unique-ingress-host }
spec:
  enforcementAction: deny            # deny | dryrun | warn  (gradual rollout)
  match:
    kinds: [{ apiGroups: ["networking.k8s.io"], kinds: ["Ingress"] }]
    excludedNamespaces: ["kube-system", "gatekeeper-system"]
```

**Kyverno** is the main alternative and trades engine power for accessibility: policies are *YAML*, not Rego, with `validate`/`mutate`/`generate` rule types (the `generate` capability — auto-creating a NetworkPolicy when a namespace appears — has no clean OPA analog). The trade-off is real: Kyverno is far gentler to onboard and excellent for the common 80%, but YAML pattern-matching hits a ceiling on genuinely complex logic where Rego's full language wins. Choosing between them is an org-level decision about who writes policy and how gnarly the rules get.

> **Key insight:** Admission has two phases in a fixed order — *mutating then validating* — and Gatekeeper layers *three* roles on top: templates compile to CRDs, constraints instantiate and scope them, and a separate audit controller catches pre-existing violations that admission never saw. Cross-object rules exist only because cluster state is *synced into `data`*; a constraint that "should" check uniqueness but has no sync config silently checks nothing.

---

## Core Concept 7 — `failurePolicy`: Fail-Open vs Fail-Closed

Here is the setting that has caused more cluster outages than any Rego bug: what happens when the apiserver calls your webhook and the webhook *doesn't answer* — it's down, overloaded, or its TLS cert expired?

A `ValidatingWebhookConfiguration` has a `failurePolicy`:

- **`failurePolicy: Ignore`** — *fail open*. If the webhook is unreachable, the apiserver admits the request anyway. Availability is preserved; the policy is silently *not enforced* during the outage.
- **`failurePolicy: Fail`** — *fail closed*. If the webhook is unreachable, the apiserver **rejects** the request. The policy is never bypassed; but now your policy server is a hard dependency of *every matching write to the cluster*.

The trap is fully general and worth stating plainly: **a fail-closed webhook whose server is down can take down your cluster.** If your policy webhook matches `pods` with `failurePolicy: Fail`, and the webhook pods crash, then *no Pod can be created* — including the replacement webhook pods. You've built a deadlock: the thing that must run to fix the cluster can't be admitted by the cluster. This is a real, recurring outage class.

```yaml
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingWebhookConfiguration
metadata: { name: image-policy }
webhooks:
  - name: validate.images.example.com
    failurePolicy: Fail               # security posture — but a liability if abused
    timeoutSeconds: 3                  # keep SMALL; apiserver waits this long per call
    matchPolicy: Equivalent
    namespaceSelector:                 # SCOPE OUT the control plane to avoid deadlock
      matchExpressions:
        - { key: kubernetes.io/metadata.name, operator: NotIn,
            values: ["kube-system", "gatekeeper-system"] }
    rules:
      - apiGroups: ["apps"]
        apiVersions: ["v1"]
        operations: ["CREATE", "UPDATE"]
        resources: ["deployments"]    # scope NARROWLY, not "*"
    clientConfig: { service: { name: gatekeeper-webhook, namespace: gatekeeper-system, port: 443 } }
```

The senior discipline that makes fail-closed survivable:

1. **Exclude the control plane.** `kube-system` and the policy controller's own namespace must be in `excludedNamespaces` / a `namespaceSelector`, so a broken webhook can never block its own recovery.
2. **Run the webhook HA** with a `PodDisruptionBudget` and anti-affinity, so it isn't all on one node.
3. **Keep `timeoutSeconds` small** (1–3s). The apiserver blocks for this long on *every* matching request; a slow webhook with a generous timeout degrades the whole API.
4. **Scope `rules` narrowly.** Match only the resources you actually gate, not `"*"` — every matched resource pays the round-trip.

> **Key insight:** `failurePolicy` is the security-vs-availability dial, and there is no free setting. `Ignore` means your control is off exactly when your policy server is unhealthy (often *during* an incident — the worst time). `Fail` means your policy server is now part of the cluster's critical path and can deadlock it. The right answer for high-stakes gates is `Fail` *plus* the discipline above — HA webhook, tiny timeout, narrow scope, and the control plane excluded — so the gate holds without becoming a single point of failure.

---

## Core Concept 8 — Testing Policy Before It Blocks Prod

Policy that gates production *is* production code, and the cardinal sin is shipping an untested rule straight to `enforce`. Rego is testable to a degree most YAML-config systems aren't, and the senior treats a policy repo like any other service: versioned, tested, CI'd, released as an artifact.

`opa test` runs `_test.rego` files. The killer feature is `with`, which **mocks `input` and `data`** so you can drive a rule through every case without a live cluster:

```rego
# image_policy_test.rego
package main
import rego.v1

test_denies_untrusted_registry if {
    deny["image \"evil.io/x:1\" is from an untrusted registry"] with input as {
        "review": {"object": {"spec": {"containers": [{"image": "evil.io/x:1"}]}}}
    } with data.config.allowed_registries as ["gcr.io/myorg/"]
}

test_allows_trusted_registry if {
    count(deny) == 0 with input as {
        "review": {"object": {"spec": {"containers": [{"image": "gcr.io/myorg/app:1"}]}}}
    } with data.config.allowed_registries as ["gcr.io/myorg/"]
}
```

```bash
opa test . -v                     # run all *_test.rego
opa test . --coverage --format=json | jq '.coverage'   # which rules/lines were exercised
opa fmt -w . && opa check .       # format + type/safety check in CI
conftest verify                   # conftest's wrapper around opa test for policy bundles
```

Coverage matters here in a way it rarely does elsewhere: an *uncovered* branch of a `deny` rule is a path that has never been proven to fire, and "the rule that was supposed to block X but had a typo" is the classic untested-policy incident. **Golden/contract tests** — a directory of real manifests with expected allow/deny outcomes — catch regressions when you refactor a rule.

The deployment discipline mirrors a feature flag rollout. Gatekeeper's `enforcementAction` and Kyverno's `validationFailureAction` both support a graduated path:

```
dryrun / audit  →  warn  →  deny
   (logs only)     (admits   (rejects)
                    + warns)
```

You ship a new constraint as `dryrun`, watch the audit `status` for how many *existing* objects it would flag, fix or exempt them, flip to `warn` so authors see the message without being blocked, and only then `enforce`. Combined with per-namespace scoping you can roll a policy out to one team's namespace first. The drift to watch for: a rule that behaves differently in `dryrun` than `enforce` because dry-run runs against synced state while enforce runs against the live admission `input` — verify the *same* decision in both modes before flipping.

> **Key insight:** "Test the policy before it blocks prod" is not a slogan — it's a `opa test --coverage` gate in the policy repo's own pipeline, plus a `dryrun → warn → enforce` rollout that lets you see a rule's blast radius before it can reject anything. A policy shipped straight to `enforce` is an outage waiting for its first false positive.

---

## Core Concept 9 — Exceptions and Waivers as Code

Every real policy meets a legitimate exception: a legacy namespace that can't yet comply, a vendor image from an un-allow-listed registry, a deadline that justifies temporary risk. The amateur move is to *disable the rule* — and now it's off for everyone, forever, because nobody re-enables a thing that's working. The senior move is to make the **exception itself a codified, owned, expiring artifact**, which is exactly the discipline [07 — Break-glass & Bypass](../07-break-glass-and-bypass/senior.md) generalizes.

Two patterns, both keeping the rule on:

**Scoped exclusion** at the constraint level — narrow, explicit, reviewable in a PR:

```yaml
spec:
  match:
    excludedNamespaces: ["legacy-billing"]   # this namespace, this constraint, in git
```

**Data-driven waivers** — the powerful form, because it carries *ownership and expiry* and is evaluated by the policy itself:

```rego
package main
import rego.v1

# A deny is suppressed only by a NON-EXPIRED, OWNED waiver in data.
deny contains msg if {
    some c in input.review.object.spec.containers
    not registry_allowed(c.image)
    not waived(c.image)
    msg := sprintf("untrusted image %q (no valid waiver)", [c.image])
}

waived(image) if {
    some w in data.waivers
    w.image == image
    time.parse_rfc3339_ns(w.expires) > time.now_ns()   # expired waivers do NOT suppress
}
```

```json
// data/waivers.json — reviewed, owned, time-boxed; ships in the signed bundle
[
  { "image": "vendor.io/scanner:4.2", "owner": "team-sec",
    "reason": "JIRA-4821 vendor allow-listing in progress", "expires": "2026-09-01T00:00:00Z" }
]
```

The properties that matter: every waiver has an **owner** (someone is accountable), a **reason** (an audit trail / ticket), and an **expiry** (it self-revokes, so risk doesn't accumulate silently). Because the waiver list lives in the bundle's `data`, granting one is a *reviewed pull request*, it's captured in decision logs, and it expires on its own.

> **Key insight:** The difference between an exception and a bypass is *governance*. Turning off a rule is a bypass — silent, permanent, blast radius unknown. A data-driven waiver with owner, reason, and expiry is an exception — reviewed, scoped, auditable, and self-revoking. Build the waiver mechanism *into* the policy so the only way to grant relief is the governed path.

---

## Core Concept 10 — Supply Chain: Provenance and Signatures at Admit Time

The frontier of policy-as-code is enforcing *supply-chain* properties at admission: not just "is this Pod configured safely," but "was this image *built by our pipeline*, signed, and free of disqualifying vulnerabilities." This is where policy meets [Security](../../../../Security/) and SLSA.

The building blocks:

- **Signing** — `cosign` signs an image and stores the signature in the registry (keyless signing ties it to an OIDC identity via Fulcio/Rekor — no long-lived keys).
- **Attestations** — in-toto/SLSA *provenance* documents, also signed, describing *how* the artifact was built (source repo, builder identity, build parameters). SLSA defines levels; "built by a trusted, tamper-resistant builder with provenance" is the goal.
- **Admission verification** — at admit time, the policy verifies the signature and inspects the attestation, rejecting unsigned images or those whose provenance doesn't meet the bar.

Two implementations. The sigstore **policy-controller** does signature/attestation verification natively:

```yaml
apiVersion: policy.sigstore.dev/v1beta1
kind: ClusterImagePolicy
metadata: { name: require-signed-prod }
spec:
  images: [{ glob: "gcr.io/myorg/**" }]
  authorities:
    - keyless:                                  # verify keyless signatures from our CI identity
        identities:
          - issuer: https://token.actions.githubusercontent.com
            subject: https://github.com/myorg/build/.github/workflows/release.yml@refs/heads/main
  policy:                                        # additionally require an in-toto SLSA attestation
    type: cue
    data: |
      predicateType: "https://slsa.dev/provenance/v1"
```

Or, keeping everything in OPA, verify a *cosign-produced attestation* whose payload has been fetched into `input` (e.g. by the webhook or a pre-step):

```rego
package main
import rego.v1

# Reject unless a valid SLSA provenance attestation names our trusted builder.
deny contains msg if {
    some c in input.review.object.spec.containers
    not has_trusted_provenance(c.image)
    msg := sprintf("%q lacks SLSA provenance from a trusted builder", [c.image])
}

has_trusted_provenance(image) if {
    att := data.attestations[image]                       # verified payloads, synced in
    att.predicateType == "https://slsa.dev/provenance/v1"
    att.predicate.builder.id == "https://github.com/myorg/build/.github/workflows/release.yml@refs/heads/main"
}
```

The senior subtlety: *verifying a signature* and *checking that an annotation claims it's signed* are worlds apart. A policy that only asserts `metadata.annotations["signed"] == "true"` enforces nothing — the attacker sets the annotation. Real enforcement means cryptographic verification of a signature chained to an identity you trust, against an attestation you can't forge.

> **Key insight:** The same admission machinery that checks `runAsNonRoot` can require *cryptographic provenance* — and that's where quality gates and software-supply-chain security converge. But the gate is only real if it *verifies the signature*, not if it trusts a self-asserted label. "Reject unsigned images, built anywhere but our pipeline" is the modern admission control most teams under-implement.

---

## Real-World Examples

**1. One engine, five PEPs.** A platform team writes one OPA-based decision service. The *same* engine evaluates: CI config (a `conftest` step lints `.github/workflows`), IaC (Terraform `plan` exported to JSON, denied if an S3 bucket is public), Kubernetes admission (Gatekeeper, no privileged Pods), API authorization (Envoy `ext_authz` calls OPA per request for fine-grained RBAC), and data filtering (OPA returns *which rows* a user may see). The leverage is the entire point: one mental model, one test harness, one audit story across the whole stack.

**2. The fail-closed cluster outage.** A team sets `failurePolicy: Fail` on a webhook matching `pods` with `resources: ["*"]` and no `kube-system` exclusion. A node upgrade evicts both webhook replicas at once; they can't be rescheduled because *creating their replacement Pods requires the webhook to admit them*. The cluster wedges — no new Pods anywhere. Recovery requires manually deleting the `ValidatingWebhookConfiguration`. The fix shipped afterward: HA with a PDB, anti-affinity, `excludedNamespaces: [kube-system, gatekeeper-system]`, `timeoutSeconds: 2`, and narrow `rules`.

**3. The untested rule that allowed everything.** A `deny` rule referenced `input.spec.securityContext.runAsNonRoot`, but the real field for Pods is `input.spec.securityContext.runAsNonRoot` *only at the pod level* — the team's workloads set it per-container. The rule's body never matched, the `deny` set was always empty, and for three weeks every privileged container sailed through a gate everyone believed was enforcing. An `opa test --coverage` run would have shown the rule's body at 0% coverage. The lesson hardened into a CI gate: no policy merges below a coverage threshold with golden allow/deny fixtures.

**4. Waivers with teeth.** A scanner image from an un-allow-listed vendor registry needs to run for a 6-week vendor evaluation. Instead of editing the registry allow-list (which would whitelist *all* vendor images), the security team merges a single entry into `data/waivers.json` with `owner: team-sec`, a ticket, and `expires` six weeks out. It ships in the next signed bundle, appears in decision logs, and self-revokes when the evaluation ends — no follow-up cleanup ticket needed, because the policy itself enforces the expiry.

---

## Mental Models

- **Everything is one document; rules extend it; evaluation is a query.** `input` and `data` are sub-trees; your rules define a *virtual document* computed on demand. You don't "run" a policy — you *query* `data.main.deny`. Every "why is this true/false" question resolves by asking what the document looks like at that path.

- **Empty set means allow.** A partial `deny` rule that never matches yields an empty set, and empty reads as *permit*. The dangerous failure mode of Rego is silent under-enforcement: a typo'd field path doesn't error, it just stops contributing violations. Coverage is your defense.

- **OPA decides; the PEP enforces.** The engine is pure — same inputs, same decision, no side effects. Every outage and every bypass lives at the enforcement point, on the unhappy path. Reason about the webhook's behavior when the server is *down*, not just the rule's logic when it's up.

- **A free variable means "there exists."** Iteration is implicit existential quantification. The classic bug is writing an existential where you meant a universal — use `every` (or "deny if a counterexample exists") when the requirement is "all."

- **`failurePolicy` is a dial with no free setting.** `Ignore` turns your control off during incidents; `Fail` makes the policy server a critical-path dependency that can deadlock the cluster. High-stakes gates choose `Fail` *and* pay the HA/scope/timeout/exclusion tax that makes it survivable.

- **An exception is a governed artifact; a bypass is the absence of one.** Disabling a rule is a permanent, silent, unbounded bypass. A waiver with owner, reason, and expiry is an exception — reviewed, auditable, self-revoking.

---

## Common Mistakes

1. **Treating Rego as imperative.** Expecting top-to-bottom execution and `return` leads to fighting the language. Rego defines documents and you query them; partial rules accumulate sets, and order within a body is logical conjunction, not sequence.

2. **The empty-result-allows trap.** A `deny` whose body never matches (a typo'd field, a wrong nesting level) produces an empty set, which reads as *allow*. The rule looks present and enforces nothing. Catch it with `opa test --coverage` and golden deny fixtures, not by reading the rule and assuming.

3. **Existential where you meant universal.** `containers[_].securityContext.runAsNonRoot == true` is satisfied by *one* compliant container even if the rest are root. Use `every`, or invert to "deny if a non-compliant container exists."

4. **Confusing `=`, `:=`, and `==`.** Using `=` (bidirectional unification) where you wanted `==` (a test) can introduce a fresh always-satisfiable binding. Default to `:=` and `==`; reserve `=` for deliberate destructuring.

5. **Fail-open by accident, or fail-closed without the guardrails.** `failurePolicy: Ignore` silently disables the gate during the policy server's own outage. `failurePolicy: Fail` without excluding the control plane, running HA, a tiny timeout, and narrow rules can deadlock the cluster. Pick deliberately and pay the corresponding tax.

6. **Shipping straight to `enforce`.** Skipping `dryrun`/`warn` means the first false positive is a production rejection. Always roll out `dryrun → warn → enforce`, watching audit status for blast radius, and scope to one namespace first.

7. **Disabling the rule instead of waiving the case.** Turning a policy off for an exception removes it for everyone, permanently. Use scoped exclusions or expiring, owned, data-driven waivers so the rule stays on and relief is governed.

8. **Quadratic policy on large inputs.** Cross-object rules and `walk` on big documents are O(n²)/O(nodes) and will time out the webhook on a large cluster. Use indexable handles, partial evaluation, or push the comparison into synced `data` with the right structure.

9. **"Signed" by annotation, not by signature.** Checking `annotations["signed"] == "true"` enforces nothing — the attacker writes the annotation. Real supply-chain gates *cryptographically verify* the signature/attestation against a trusted identity.

---

## Test Yourself

1. Distinguish a *complete* rule from a *partial* rule in Rego, and explain why a `deny` rule that never matches results in an *allow*.
2. You have three operators: `=`, `:=`, `==`. Which is bidirectional unification, which is assignment, which is a boolean test — and what's a concrete bug from confusing the first two?
3. "All containers must run as non-root." Why is `containers[_].securityContext.runAsNonRoot == true` the *wrong* encoding, and what are two correct ones?
4. In the PDP/PEP model, what is the role of `input` versus `data`, and why does a cross-object rule like "ingress hosts must be unique" require `data`?
5. Trace a `kubectl apply` through the admission chain. Where do mutating vs validating webhooks run relative to each other and to etcd?
6. Explain `failurePolicy: Fail` vs `Ignore`. Describe the exact mechanism by which a fail-closed webhook can take down a cluster, and three mitigations.
7. What does `with input as {...}` do in an `opa test`, and why is coverage especially important for policy compared to ordinary code?
8. Contrast disabling a rule with a data-driven waiver. What three properties should a codified waiver carry?

<details>
<summary>Answers</summary>

1. A **complete** rule assigns a single value (often with a `default`); a **partial** rule (`contains` / `[key]`) incrementally builds a *set* or *object* from every satisfying binding. A `deny` is a partial set rule; if its body never matches it contributes nothing, yielding an **empty set**. The PEP treats empty-deny as **allow**, so a never-matching rule silently permits everything.

2. `=` is **bidirectional unification** (binds unbound variables on either side to make the structures equal); `:=` is **assignment** (bind a local once); `==` is a **boolean comparison** (both sides must be ground). Bug: writing `port = 443` expecting a test actually *binds* `port` to 443 (always satisfiable), so the rule matches when you intended it to filter. Use `==` to test.

3. `containers[_].securityContext.runAsNonRoot == true` is *existential* — it's satisfied if **at least one** container is non-root, even if others are root. Correct: (a) `every c in input.spec.containers { c.securityContext.runAsNonRoot == true }`, or (b) deny if a counterexample exists: `c := containers[_]; not c.securityContext.runAsNonRoot == true`.

4. `input` is *the thing being decided* (per-query: the object, the plan, the request); `data` is *external context* (loaded out of band, shared across queries: allow-lists, config, **synced cluster state**). A single object's `input` can't see its siblings, so uniqueness across all ingresses is only possible if every Ingress is replicated into `data` (Gatekeeper's `sync` into `data.inventory`).

5. authn → authz → **mutating** webhooks (may patch the object) → schema validation → **validating** webhooks (accept/reject only) → persist to **etcd**. Mutating runs first so validating sees the post-mutation object; both are HTTP callouts the apiserver makes to your webhook server via `AdmissionReview`.

6. `Fail` = fail **closed**: an unreachable webhook causes the apiserver to **reject** the request (never bypassed, but the server becomes critical-path). `Ignore` = fail **open**: an unreachable webhook causes the request to be **admitted** (available, but unenforced). Deadlock: if the webhook matches `pods` with `Fail` and its pods crash, no Pod can be created — *including the replacement webhook pods* — so it can't self-heal. Mitigations: exclude `kube-system`/the controller's namespace; run HA with a PDB + anti-affinity; tiny `timeoutSeconds`; narrow `rules`.

7. `with input as {...}` (and `with data.x as {...}`) **mocks** the `input`/`data` documents for that test expression, letting you drive a rule through every case with no live cluster. Coverage matters because an *uncovered* `deny` branch is one never proven to fire — and Rego fails *silently* (a typo'd path stops contributing instead of erroring), so 0%-covered rules are the classic "gate that enforced nothing" bug.

8. Disabling a rule turns it off for **everyone, permanently, silently** (a bypass). A data-driven waiver keeps the rule on and suppresses one case via reviewed `data`. It should carry an **owner** (accountability), a **reason/ticket** (audit trail), and an **expiry** (self-revokes so risk doesn't accumulate).

</details>

---

## Cheat Sheet

```
REGO SEMANTICS
  default allow := false        complete rule (single value + default)
  deny contains msg if {...}    partial SET rule (accumulates; empty = ALLOW)
  obj[k] := v if {...}          partial OBJECT rule
  :=  assignment   ==  test     =  bidirectional unification (destructuring)
  some i;  arr[i]               existential — "there EXISTS i"
  every x in arr {...}          universal — "for ALL x"
  import rego.v1                if/contains mandatory; safe defaults

EVALUATION & PERF
  opa eval -d p.rego -i in.json 'data.main.deny'   query the virtual document
  opa eval --partial            specialize policy vs data (Envoy-scale)
  avoid walk() on big inputs; cross-object compare = O(n^2) without indexing

PDP / PEP
  PDP = OPA (decides)           PEP = webhook/CI/Envoy (enforces)
  input = the query (per call)  data = external context (allow-lists, synced state)

DISTRIBUTION & AUDIT
  bundles  = signed, versioned policy+data tarball (verify before activate)
  decision_logs = every decision (input+result+revision) → audit goldmine

ADMISSION (Kubernetes)
  authn→authz→MUTATING→schema→VALIDATING→etcd
  Gatekeeper: ConstraintTemplate→CRD ; Constraint=instance+scope ;
              audit controller=pre-existing violations ; sync→data.inventory
  enforcementAction: dryrun → warn → deny   (gradual rollout)

failurePolicy (the outage dial)
  Fail = closed (reject if webhook down; can DEADLOCK cluster)
  Ignore = open (admit if down; control OFF during incidents)
  safe fail-closed: exclude kube-system + HA + timeoutSeconds:2 + narrow rules

TESTING & WAIVERS
  opa test . --coverage         prove every deny branch can fire
  with input as {...} with data.x as {...}   mock the documents
  waiver in data: {owner, reason, expires}   governed, expiring exception

SUPPLY CHAIN
  cosign verify / policy-controller ClusterImagePolicy   verify SIGNATURE
  require SLSA provenance attestation (in-toto) at admit time
  NEVER trust annotations["signed"]=="true" — verify cryptographically
```

---

## Summary

- **Rego is a query language over one JSON document.** `input` and `data` are sub-trees; rules define a *virtual document*; evaluation queries it (e.g. `data.main.deny`). **Complete** rules give one value; **partial** rules accumulate sets/objects — and an empty `deny` set reads as **allow**, the language's sharpest foot-gun.
- The operators are distinct: `:=` assigns, `==` tests, `=` is **bidirectional unification**. Iteration is implicit **existential** quantification; use `every` for the universal case. Variable-safety errors are the compiler catching always-true/meaningless rules.
- **OPA decides (PDP); something else enforces (PEP).** `input` is the per-query subject, `data` is shared context — and cross-object rules exist only because cluster state is *synced into `data`*. Every real outage and bypass lives at the enforcement point, not the engine.
- **Bundles** make policy a signed, versioned, atomically-distributed artifact; **decision logs** make every decision auditable. Together they answer the auditor's "what policy?" and "what decision?".
- **Admission** runs *mutating then validating* webhooks before etcd. **Gatekeeper** compiles templates to CRDs, instantiates them as scoped constraints, audits pre-existing violations, and syncs state for cross-object rules. **`failurePolicy`** is the security-vs-availability dial — `Fail` can deadlock a cluster, so high-stakes gates pay the HA/scope/timeout/exclusion tax.
- Treat policy as production code: `opa test --coverage` with `with`-mocked documents, golden allow/deny fixtures, and a `dryrun → warn → enforce` rollout. Make exceptions **governed, expiring, owned waivers in `data`**, never disabled rules. The same engine that checks `runAsNonRoot` can require *cryptographically verified* SLSA provenance at admit time.

You now reason about policy-as-code as an *engine plus an enforcement topology* with measurable second-order effects on availability, auditability, and supply-chain integrity. The next layer — [professional.md](professional.md) — is about operating a policy program across an organization: governance, ownership, exception SLAs, and policy at fleet scale under real failure.

---

## Further Reading

- [Open Policy Agent documentation](https://www.openpolicyagent.org/docs/latest/) and the [Rego Policy Reference](https://www.openpolicyagent.org/docs/latest/policy-reference/) — the authoritative treatment of rules, evaluation, and built-ins.
- [OPA Gatekeeper documentation](https://open-policy-agent.github.io/gatekeeper/website/docs/) — ConstraintTemplates, constraints, audit, sync, and enforcement actions.
- [Kyverno documentation](https://kyverno.io/docs/) — the YAML-native alternative; validate/mutate/generate and its trade-offs vs Rego.
- [sigstore](https://www.sigstore.dev/) (cosign, Fulcio, Rekor, policy-controller) and the [SLSA framework](https://slsa.dev/) — signing, keyless attestations, provenance, and SLSA levels.
- [The Rego Style Guide](https://github.com/StyleGuide/rego-style-guide) (and Styra's guidance) — idioms, `some`/`every` usage, package layout, and testing conventions.
- *Kubernetes Admission Control* — the official [Dynamic Admission Control](https://kubernetes.io/docs/reference/access-authn-authz/extensible-admission-controllers/) reference, especially `failurePolicy`, `timeoutSeconds`, and matching.
- Continue to [professional.md](professional.md) — operating policy-as-code as an organizational program.

---

## Related Topics

- [01 — Required CI Checks](../01-required-ci-checks/senior.md) — the CI-step PEP where `conftest`/`opa test` gate config and IaC before merge.
- [02 — Branch Protection & Merge Policies](../02-branch-protection-and-merge-policies/senior.md) — policy enforced at the VCS layer, complementary to admission-time enforcement.
- [07 — Break-glass & Bypass](../07-break-glass-and-bypass/senior.md) — the governed-exception discipline that waivers-as-code generalize.
- [Security](../../../../Security/) — supply-chain security, signing, SLSA, and the threat model behind admission-time verification.
- [Release Engineering](../../release-engineering/) — where signed provenance is produced and the pipeline identity that admission policies trust originates.
