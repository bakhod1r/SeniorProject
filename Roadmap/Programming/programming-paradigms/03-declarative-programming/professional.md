# Declarative Programming — Professional Level

> **Roadmap:** [Programming Paradigms](../README.md) → Declarative Programming
> *At architecture scale, declarative stops being a coding style and becomes an operating model: you declare the desired state of the world, and a control loop spends forever making reality match it.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Desired State vs Imperative Orchestration](#desired-state-vs-imperative-orchestration)
4. [The Reconciliation Loop](#the-reconciliation-loop)
5. [Infrastructure as Code: Terraform](#infrastructure-as-code-terraform)
6. [Kubernetes: Declarative Control Loops](#kubernetes-declarative-control-loops)
7. [Drift, Convergence, and Eventual Consistency](#drift-convergence-and-eventual-consistency)
8. [GraphQL: Declarative Data Fetching](#graphql-declarative-data-fetching)
9. [Config-as-Data and Policy-as-Code](#config-as-data-and-policy-as-code)
10. [Testing and Validating Declarative Systems](#testing-and-validating-declarative-systems)
11. [Failure Modes at Scale](#failure-modes-at-scale)
12. [Mental Models](#mental-models)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How does this work at architecture scale, across teams and systems?**

At the senior level, declarative was a property of code you wrote — a query, a stylesheet, a build file. At the professional level, declarative becomes the **operating model of entire systems**. The largest and most reliable infrastructure platforms in the world — Kubernetes, Terraform, AWS CloudFormation, GitOps pipelines — are built on a single idea you already know from the junior page, scaled up:

> **You declare the desired state of the world. A control loop runs forever, continuously comparing reality to your declaration and acting to close the gap.**

This is the junior-level *idempotence* and *desired state* ideas, industrialized. "I want 3 replicas" is no longer a one-shot config; it's a standing invariant that a controller *defends* against node failures, crashes, and human mistakes — re-creating a killed pod, rolling back drift, converging toward your declaration every few seconds, forever.

Understanding this shift is the difference between *using* `kubectl apply` and *operating* a platform. The professional questions are: how does reconciliation actually work? What happens when reality and the declaration disagree (drift)? How do you test a declarative system whose behavior is "an engine converges toward a spec"? When does desired-state break down and imperative orchestration win? This page is about declarative programming as **systems architecture**.

> **The mindset shift:** stop thinking "I run commands to change the system." Start thinking "I edit a *specification of the system*, and a reconciler makes it so — and keeps it so." The unit of work is no longer an action; it's a desired state.

---

## Prerequisites

- **Required:** The [senior level](senior.md) — the leverage/control trade-off, hinting engines, the rule of least power, escape hatches.
- **Required:** Hands-on exposure to at least one of: Terraform, Kubernetes, CloudFormation, or a GitOps tool (Argo CD / Flux).
- **Helpful:** Familiarity with eventual consistency, control theory intuition (feedback loops), and CI/CD.
- **Helpful:** [System Design](../../../Architecture/system-design/) for where these declarative platforms sit in a real architecture.

---

## Desired State vs Imperative Orchestration

The fundamental fork in operations and infrastructure is between two models:

| | Imperative orchestration | Declarative desired-state |
|---|---|---|
| **You specify** | the *steps* to change the system | the *end state* the system should be in |
| **Example** | `aws ec2 run-instances ...`, an Ansible playbook of tasks, a deploy script | a Terraform/K8s manifest describing resources |
| **Re-running** | repeats actions (often *not* idempotent) | converges to the same state (idempotent) |
| **Drift handling** | none — it ran once, then forgot | the loop detects and corrects drift continuously |
| **Source of truth** | the sequence of commands you ran (ephemeral) | the declared spec (durable, version-controlled) |
| **Failure recovery** | re-run from scratch, hope it's safe | re-converge from current state toward the spec |

The decisive advantage of desired-state is that it answers a question imperative orchestration can't: **"is the system how it's supposed to be *right now*?"** With imperative scripts, the only way to know is to remember every command ever run and reconstruct the state — impossible at scale. With desired-state, the answer is "diff the declared spec against reality," which a tool can compute on demand (`terraform plan`, `kubectl diff`).

This is why the industry moved decisively toward declarative infrastructure: **the declaration is a durable, version-controlled source of truth**, and reconciliation makes the system *self-healing* against the inevitable drift of a chaotic production environment. Imperative orchestration still has its place — genuine one-time procedures, complex stateful migrations, ordered cutover sequences — but the steady-state shape of modern infrastructure is desired-state.

> Imperative says *"do these steps."* Declarative says *"this is how the world should be."* The second is more powerful at scale precisely because it can be re-evaluated, diffed, and continuously enforced — it's a standing assertion, not a fired-and-forgotten command.

---

## The Reconciliation Loop

The engine behind every desired-state system is the **reconciliation loop** (control loop). It's a simple, profound pattern borrowed from control theory:

```
  ┌──────────────────────────────────────────────────┐
  │                                                    │
  │   observe  →  diff  →  act  →  (wait)  ──────────┐ │
  │   actual      desired  reconcile                 │ │
  │   state       vs       toward                    │ │
  │               actual   desired                   │ │
  │      ▲                                            │ │
  │      └────────────────────────────────────────────┘ │
  └──────────────────────────────────────────────────┘
            (runs forever, every few seconds)
```

Each cycle:

1. **Observe** the actual state of the world (query the cloud API, list running pods).
2. **Diff** it against the declared desired state.
3. **Act** to reduce the difference — create what's missing, delete what's extra, update what's wrong.
4. **Wait** a short interval, then repeat.

The genius is what this gives you almost for free:

- **Self-healing.** A pod dies → next cycle observes it's missing → recreates it. You declared "3 replicas"; the loop *defends* that number against reality.
- **Idempotence by construction.** Each cycle is "make reality match the spec"; running it again when already matched is a no-op. There's no "I already did this" bookkeeping — the comparison *is* the bookkeeping.
- **Crash safety.** If the reconciler crashes mid-action, the next cycle simply observes the current (partial) state and continues converging. There's no fragile "resume from step 7"; every cycle starts from "where are we now vs where should we be."
- **Drift correction.** Someone manually changes a resource → next cycle observes the divergence → reverts it toward the spec.

This loop is the imperative engine of declarative infrastructure — the SQL planner's cousin, written once, operating forever. (Note the kinship with [Make's DAG](middle.md): both derive actions from a declared end-state rather than a command sequence; the loop just *never stops*.)

---

## Infrastructure as Code: Terraform

Terraform is the canonical declarative IaC tool. You declare resources in HCL; Terraform reconciles cloud reality to your declaration.

```hcl
# You DECLARE the resources that should exist — not the API calls to create them.
resource "aws_s3_bucket" "assets" {
  bucket = "myapp-assets-prod"
}

resource "aws_instance" "web" {
  count         = 3                    # "there should be 3 of these"
  ami           = "ami-0abc123"
  instance_type = "t3.medium"
  tags = { Name = "web-${count.index}" }
}
```

The desired-state mechanics that make this work:

- **State file.** Terraform records what it *believes* exists (`terraform.tfstate`). The reconciler diffs three things: your **config** (desired), the **state** (last-known), and **reality** (live cloud). This three-way diff is what lets it detect both your changes *and* out-of-band drift.
- **Plan before apply.** `terraform plan` shows the diff the reconciler *intends* to execute — create/update/destroy — before touching anything. Reading this plan is non-negotiable: the engine does *exactly* what your spec implies, including destroying resources if your declaration no longer mentions them.
- **Dependency graph.** Terraform builds a DAG from resource references (the `web` instance depends on a subnet you referenced) and orders create/destroy accordingly — the same dependency-DAG pattern as Make, applied to cloud resources.

```bash
terraform plan      # show the intended diff — ALWAYS read this
terraform apply      # reconcile reality to the declared state
terraform plan      # run again: now a no-op (idempotent) if nothing drifted
```

The professional discipline: **the declared config is the source of truth, lives in version control, and is changed only through reviewed pull requests** — never by clicking in a console. The moment someone changes infrastructure out-of-band, you have *drift*, and the whole model depends on driving all change through the declaration.

---

## Kubernetes: Declarative Control Loops

Kubernetes is reconciliation as an entire platform. You submit declarative manifests; a fleet of **controllers** runs reconciliation loops to make the cluster match them.

```yaml
# You DECLARE the desired state of a workload. You never say "start a container."
apiVersion: apps/v1
kind: Deployment
metadata: { name: web }
spec:
  replicas: 3                 # desired: exactly 3 pods
  selector:
    matchLabels: { app: web }
  template:
    metadata:
      labels: { app: web }
    spec:
      containers:
        - name: web
          image: myapp:1.4.2
          ports: [{ containerPort: 8080 }]
```

What happens after `kubectl apply`:

1. The manifest is stored in **etcd** as the *desired state* — the API server is just a declarative datastore with validation.
2. The **Deployment controller** observes desired (3 replicas of `myapp:1.4.2`) vs actual (0), and creates a ReplicaSet.
3. The **ReplicaSet controller** reconciles toward 3 pods; the **scheduler** assigns each to a node; the **kubelet** on each node reconciles "run this container."
4. Forever after, every controller's loop *defends* its slice of the spec: a pod dies → recreated; you change the image → a rolling update reconciles toward the new version; a node fails → pods reschedule elsewhere.

This is declarative programming as a *distributed operating model*: **dozens of independent control loops, each owning one invariant, collectively converging the cluster toward a declared state.** It's also the purest production example of the rule of least power — you declare *what* the workload should be, and an entire ecosystem of engines figures out *how* to place, run, heal, and scale it. When the built-in resources don't fit, you write a **custom controller (operator)** — an imperative reconciler that *provides a new declarative resource*, the escape-hatch pattern at platform scale.

---

## Drift, Convergence, and Eventual Consistency

Three concepts define the lived reality of operating declarative systems.

**Drift** is divergence between the declared state and the actual state, caused by anything the reconciler didn't do: a manual console change, an external process, a partial failure. Drift is *inevitable* in any real environment; the declarative model's job is not to prevent it but to *detect and correct* it.

```bash
terraform plan     # if this shows changes you didn't make, that's DRIFT
kubectl diff -f deployment.yaml   # same idea: declared vs live
```

**Convergence** is the process of the reconciler driving actual state toward desired state over successive cycles. Well-designed reconcilers are **convergent**: from *any* starting state, repeated reconciliation reaches the desired state and stays there. (A buggy reconciler can *oscillate* — fighting itself or another controller, flapping a resource forever — which is the declarative analogue of an infinite loop.)

**Eventual consistency.** Because reconciliation is a loop that runs periodically and acts asynchronously, declarative infrastructure is *eventually consistent*, not immediately consistent. `kubectl apply` returns instantly — but the cluster reaches the declared state *some time later*, after the loops run. This is a crucial operational truth: **"applied" ≠ "reconciled."** Professionals wait for and verify convergence (readiness probes, `kubectl rollout status`, Terraform's post-apply state) rather than assuming the declaration took effect the instant they submitted it.

> The mental shift: you don't *make changes*, you *declare intentions* and *wait for convergence*. The system is a feedback loop seeking your declared setpoint — and like any feedback system, it has settling time, can overshoot, and can be driven unstable by competing controllers.

---

## GraphQL: Declarative Data Fetching

GraphQL brings the declarative model to the client-server data boundary. Instead of the server defining fixed endpoints (imperative: "call `/users`, then `/users/:id/orders`"), the *client declares exactly the data shape it wants*, and the server's engine resolves it:

```graphql
# The client DECLARES the desired data shape. One round-trip, no over/under-fetching.
query {
  user(id: "42") {
    name
    orders(last: 3) {
      total
      items { sku }
    }
  }
}
```

The client never says *how* to fetch — which tables, which joins, which services. It declares the *shape of the result*, and the server's **resolvers** (the engine) figure out the fetching. This solves REST's over-fetching/under-fetching by making the response shape declarative and client-driven.

But GraphQL is a sharp lesson in the [leaky abstraction](middle.md): the declarative surface hides that each nested field may trigger a separate fetch — the **N+1 problem** at the API layer. The standard fix, **DataLoader** (batching + caching resolvers), is an imperative engine layer that restores efficiency under the declarative surface — the same surface/engine split, the same leak at performance, the same "you must look underneath." It also relocates the senior-level concern: query *cost control* (depth limits, complexity analysis) becomes essential, because a client can now declare an arbitrarily expensive query. (Reactive declarative UIs that consume this data live in [05 — Reactive Programming](../05-reactive-programming/).)

---

## Config-as-Data and Policy-as-Code

Two professional patterns extend declarative thinking beyond infrastructure.

**Config-as-data** treats configuration as structured, declarative *data* (YAML/JSON/Protobuf) that tools read, validate, diff, and template — rather than as imperative setup scripts. The whole GitOps movement rests on this: the desired state of a system lives as declarative data in Git, and a reconciler (Argo CD, Flux) continuously applies it. Git becomes the source of truth; `git revert` becomes rollback; pull requests become the change-control mechanism for production. The benefits are exactly the declarative benefits — auditability, diffability, idempotence — applied to the *entire delivery pipeline*.

**Policy-as-code** declares *rules the system must satisfy*, and an engine enforces them. Open Policy Agent (OPA) and its language Rego are the standard:

```rego
# Declare a RULE: deny any pod that runs as root. You state WHAT is forbidden;
# OPA's engine evaluates it against every resource — no imperative checking loop.
package kubernetes.admission

deny[msg] {
  input.request.kind.kind == "Pod"
  some c
  input.request.object.spec.containers[c].securityContext.runAsNonRoot == false
  msg := "containers must not run as root"
}
```

This is declarative governance: you *declare the constraints* (no root, must have resource limits, only approved registries), and the policy engine evaluates them against every change — at admission time in Kubernetes, at plan time in Terraform (`conftest`/`Sentinel`), in CI. The win is the same as all declarative code: the rules are *data the engine reasons over*, so they're auditable, testable, and uniformly enforced — far more reliable than scattered imperative `if` checks. (This is the rule of least power applied to compliance: declare the constraint, let a solver-like engine enforce it — a cousin of [constraint programming](../13-constraint-programming/).)

---

## Testing and Validating Declarative Systems

Testing declarative systems is genuinely different, because there's no imperative code path to unit-test — there's a *spec* and an *engine that interprets it*. The validation pyramid:

1. **Static validation / linting.** Catch malformed declarations before any engine runs them: `terraform validate`, `kubeval`/`kubeconform` for K8s schemas, `yamllint`, JSON Schema. Cheapest, fastest layer — purely structural.
2. **Policy / constraint checks.** Run policy-as-code (OPA/`conftest`, Terraform Sentinel, `checkov`) against the *declared* spec in CI, before apply. Catches "valid but forbidden" (public S3 bucket, root container) without provisioning anything.
3. **Plan diffing.** Generate and review the engine's intended actions (`terraform plan`, `kubectl diff`, `helm template`). This is the most important pre-apply check: it shows what the reconciler will *actually do*, including destructive changes. Automate "fail the build if the plan destroys a stateful resource."
4. **Ephemeral environment / integration tests.** Apply the declaration to a throwaway environment and assert the *resulting reality* (Terratest spins up real infra and tests it; `kuttl` tests K8s reconciliation). The only layer that tests the engine's actual behavior, not just the spec.
5. **Drift detection in production.** Continuously diff declared vs actual (Argo CD's sync status, scheduled `terraform plan`) and alert on divergence — testing that *never stops*, because reality keeps drifting.

> The throughline: because you can't step through the engine, you **shift validation onto the *declaration* and the *plan*.** Validate the spec statically, enforce policy on it, diff the intended actions, then test the converged result. The plan-diff is the declarative system's most powerful test — it lets you inspect the engine's intended behavior before it touches anything real.

---

## Failure Modes at Scale

Declarative infrastructure has its own catalog of failures, distinct from imperative bugs:

- **Drift you can't see.** Out-of-band changes accumulate until a reconcile suddenly reverts something critical, or the plan shows a terrifying diff. Mitigation: drift detection on a schedule; forbid console changes.
- **Reconciler oscillation / fighting controllers.** Two controllers (or a controller and a human) with conflicting desired states flap a resource forever, burning API quota and never converging. Mitigation: single source of truth per resource; ownership boundaries.
- **Destructive plans.** A subtle spec change (a renamed resource, a changed immutable field) makes the reconciler *destroy and recreate* — sometimes a database. Mitigation: read every plan; `prevent_destroy`/`lifecycle` guards; policy checks that block destruction of stateful resources.
- **The complexity clock, industrialized.** Helm templates and Jsonnet metastasize into an unmaintainable, untestable, Turing-complete config language with no debugger. Mitigation: when config grows real logic, move to a typed general-purpose IaC (Pulumi, CDK) where you get types, tests, and a debugger back.
- **"Applied ≠ reconciled" incidents.** Treating `apply` as synchronous, declaring victory before convergence, and shipping on a half-rolled-out state. Mitigation: gate on convergence (`rollout status`, health checks), not on submission.

---

## Mental Models

- **Declaration as a standing assertion.** A desired-state spec isn't a command you run; it's an *invariant a control loop defends forever*. "3 replicas" is enforced against every failure, not set once.
- **The thermostat, at platform scale.** Reconciliation is a feedback loop seeking a setpoint. It self-heals, it's idempotent, it has settling time, and — like any feedback system — competing controllers can drive it unstable.
- **Git as the source of truth (GitOps).** The declared state lives in version control; the reconciler makes reality match Git. Rollback is `git revert`; change control is pull requests; the audit log is the commit history.
- **Plan-diff is your test and your safety.** You can't step through the engine, so the diff of intended actions is both your most powerful test and your last line of defense against a destructive apply. Read it every time.
- **Applied is not reconciled.** Submitting a declaration starts convergence; it doesn't complete it. Wait for and verify the loop to settle before trusting the new state.

---

## Common Mistakes

- **Treating `apply` as the end.** Declaring victory at submission instead of convergence. The loop hasn't run yet; "applied ≠ reconciled." Gate on health/rollout status.
- **Skipping the plan.** Running `terraform apply` or a K8s change without reading the intended diff. The reconciler does *exactly* what the spec implies — including destroying stateful resources. The plan is the only warning you get.
- **Allowing out-of-band changes.** Clicking in the console "just this once" creates drift the reconciler will eventually fight or revert, often at the worst moment. All change goes through the declaration.
- **Letting config grow into a program.** Loops, conditionals, and deep templating in YAML/Helm. Past the complexity clock, move to typed IaC with tests and a debugger — *more* declarative tooling won't save unmaintainable declarative config.
- **Ignoring the leak.** Trusting GraphQL/ORM/reconciler abstractions without checking generated queries, plan diffs, or reconcile loops. N+1 and drift live exactly where you stopped looking.
- **No drift detection.** Going declarative and never diffing declared-vs-actual in production, so drift accumulates silently until it bites. Continuous reconciliation is testing that must never stop.

---

## Test Yourself

1. Contrast imperative orchestration with declarative desired-state. What question can desired-state answer that imperative scripts fundamentally cannot?
2. Walk through one cycle of a reconciliation loop. Name three properties it gives you "for free" and *why* each falls out of the loop structure.
3. What is *drift*, why is it inevitable, and what does the declarative model do about it instead of preventing it?
4. Explain "applied ≠ reconciled." What's the operational consequence of forgetting it?
5. GraphQL makes data fetching declarative — what classic leaky abstraction reappears, and what imperative layer fixes it?
6. How do you *test* a declarative system when there's no imperative code path to unit-test? List the validation layers from cheapest to most realistic.

<details>
<summary>Answers</summary>

1. **Imperative orchestration** specifies the *steps* to change a system (often non-idempotent, fire-and-forget); **declarative desired-state** specifies the *end state* and a loop converges to it (idempotent, self-healing). Desired-state can answer *"is the system how it's supposed to be right now?"* by diffing the declared spec against reality — imperative scripts can't, because they'd require reconstructing state from every command ever run.
2. **Observe** actual state → **diff** vs desired → **act** to close the gap → **wait** → repeat. Free properties: **self-healing** (a missing resource is observed and recreated next cycle), **idempotence** (each cycle is "match the spec"; re-running when matched is a no-op — the comparison is the bookkeeping), and **crash safety** (every cycle starts from "current vs desired," so a crash mid-action just resumes converging next cycle).
3. **Drift** = divergence between declared and actual state from anything the reconciler didn't do (manual changes, external processes, partial failures). It's inevitable in any chaotic real environment. The model doesn't prevent drift — it *detects and corrects* it each reconcile cycle, reverting actual state toward the declaration.
4. `apply` submits the desired state and *starts* convergence; the loop reaches it *later*, asynchronously — declarative infra is eventually consistent. Consequence of forgetting: shipping on a half-reconciled state (e.g., a half-rolled-out deploy), since "applied" doesn't mean "running as declared." Gate on convergence (rollout/health status).
5. The **N+1 problem** reappears at the API layer — each nested field can trigger a separate fetch. The fix is **DataLoader** (batching + caching resolvers), an imperative engine layer under the declarative surface — same surface/engine split, same leak at performance. Plus query cost limits, since clients can now declare expensive queries.
6. (1) **Static validation/linting** (`terraform validate`, `kubeconform`); (2) **policy/constraint checks** (OPA/`conftest`, `checkov`) on the spec; (3) **plan diffing** (`terraform plan`, `kubectl diff`) to inspect intended actions; (4) **ephemeral-environment integration tests** (Terratest, `kuttl`) asserting the converged reality; (5) **production drift detection** (Argo CD sync, scheduled plans). You shift validation onto the *declaration* and the *plan* because there's no imperative path to step through.

</details>

---

## Summary

- At architecture scale, declarative becomes an **operating model**: you declare the **desired state** of the world, and a **reconciliation loop** runs forever — observe, diff, act, wait — driving reality toward your declaration. Self-healing, idempotence, and crash safety fall out of that loop structure for free.
- **Desired-state beats imperative orchestration** at scale because the declaration is a durable, version-controlled source of truth that can be diffed against reality on demand — answering "is the system how it should be *right now*?", which fired-and-forgotten scripts cannot. Imperative orchestration survives for genuine one-time, ordered, stateful procedures.
- **Terraform** (three-way diff of config/state/reality, plan-before-apply, dependency DAG) and **Kubernetes** (etcd as a declarative datastore, dozens of controllers each defending one invariant) are the canonical platforms; the **operator pattern** is the escape hatch — an imperative controller that *provides* a new declarative resource.
- **Drift** (inevitable divergence) is detected and corrected by reconciliation, not prevented; **convergence** drives any starting state toward the spec; and declarative infra is **eventually consistent**, so **"applied ≠ reconciled"** — verify convergence, don't assume it.
- **GraphQL** makes data fetching declarative (and re-springs the N+1 leak, fixed by DataLoader); **config-as-data / GitOps** make Git the source of truth; **policy-as-code** (OPA/Rego) declares constraints an engine enforces uniformly.
- **Testing shifts onto the declaration and the plan**: static validation → policy checks → plan-diff (the most powerful pre-apply test) → ephemeral-env integration tests → continuous drift detection. You can't step through the engine, so you validate the spec and inspect its intended actions.
- This completes the declarative arc: a coding style (junior), a surface over an engine (middle), a control trade-off (senior), and a systems operating model (professional). See [`interview.md`](interview.md) to consolidate.

---

## Further Reading

- *Kubernetes Patterns* — Bilgin Ibryam & Roland Huß — the controller/reconciliation patterns, deeply.
- *Terraform: Up & Running* — Yevgeniy Brikman — desired-state IaC, state management, and the plan/apply discipline.
- Kelsey Hightower et al. — talks and writing on declarative infrastructure and GitOps as an operating model.
- *Open Policy Agent* docs and the *Rego* language — policy-as-code in practice.
- *Site Reliability Engineering* (Google) — reconciliation, convergence, and operating systems that defend invariants.
- Martin Fowler / Weaveworks, *GitOps* writings — Git as the declarative source of truth.

---

## Related Topics

- [`senior.md`](senior.md) — the control trade-off, escape hatches, and the rule of least power these platforms embody.
- [`interview.md`](interview.md) — consolidate the whole topic for interviews.
- [05 — Reactive Programming](../05-reactive-programming/) — declarative UIs that react to the data GraphQL declaratively fetches.
- [13 — Constraint Programming](../13-constraint-programming/) — policy/constraint engines taken to their logical extreme.
- [System Design](../../../Architecture/system-design/) — where Terraform, Kubernetes, and GraphQL sit in a real architecture, and SQL query-optimization at scale.
- [Infrastructure as Code](../../../Architecture/system-design/) — the IaC mechanics referenced throughout (state, drift, modules).
