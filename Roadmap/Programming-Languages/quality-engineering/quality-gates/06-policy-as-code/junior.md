# Policy as Code — Junior Level

> **Roadmap:** [Quality Gates](../README.md) → Policy as Code
> *A rule that lives in someone's head gets broken. A rule that lives in a wiki gets ignored. A rule written as code gets enforced on every single change, forever, whether anyone remembers it or not.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — What "Policy as Code" Actually Means](#core-concept-1--what-policy-as-code-actually-means)
5. [Core Concept 2 — OPA and Rego: input → allow/deny](#core-concept-2--opa-and-rego-input--allowdeny)
6. [Core Concept 3 — Conftest: Checking Config Files in CI](#core-concept-3--conftest-checking-config-files-in-ci)
7. [Core Concept 4 — Admission Control: Rejecting Bad Resources Before They Exist](#core-concept-4--admission-control-rejecting-bad-resources-before-they-exist)
8. [Core Concept 5 — Why Code Beats Clicked Settings](#core-concept-5--why-code-beats-clicked-settings)
9. [Real-World Examples](#real-world-examples)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What is policy as code, and why is it better than a rule everyone "just knows"?**

Every team has rules. *"Don't deploy on Fridays." "All Docker images must come from our own registry." "No S3 bucket may ever be public." "Every pull request has to link a ticket."* The question is never whether the rules exist — it's **where they live**.

Most rules live in the worst possible place: a person's memory, a Slack message from eight months ago, a wiki page nobody opens, or a checkbox someone clicked once in a web console and then forgot. Rules in those places **drift**. A new hire never saw the Slack message. The wiki says one thing and reality does another. The person who clicked the checkbox left the company, and now nobody knows if it's still set or why it was set in the first place.

**Policy as code** moves the rule out of human memory and into a file — actual code, kept in git, reviewed in a pull request, and run automatically against every change. Now the rule "no public S3 bucket" isn't a thing people *try* to remember. It's a program that inspects every change and **blocks** the ones that would create a public bucket. It can't be forgotten, it can't drift, and you can read its history to see exactly *why* it was added.

This page teaches you the core idea and the common tools — **Open Policy Agent (OPA)**, its rule language **Rego**, the CI tool **Conftest**, and Kubernetes **admission control** — at a gentle, define-everything level. You'll see tiny rules that take some JSON describing a thing and return **allow** or **deny**. By the end, "policy as code" will stop sounding like jargon and start sounding like the obvious way to enforce a rule.

> **Mindset shift:** stop thinking "the rule is that we shouldn't do X, and everyone knows it." Start thinking "the rule is a piece of code that automatically rejects X, and I can read it, test it, and see who changed it and when." A rule you can run can't drift; a rule in someone's head already has.

---

## Prerequisites

- **Required:** You can read **JSON** and **YAML** (you've seen a `kubernetes` manifest, a `docker-compose.yml`, or a config file). You don't need to write them well — just read them.
- **Required:** You know roughly what **CI** is — an automated job that runs on every push or pull request and can pass or fail.
- **Helpful:** You've used **git** and opened a **pull request**, so "version-controlled" and "reviewed" mean something concrete.
- **Helpful:** You've hit a rule at work that someone enforced by hand ("you forgot the owner label again") and wished it were automatic. It can be.
- **Not required:** Any prior exposure to OPA, Rego, or policy engines. Every term is defined here.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Policy** | A rule about what is or isn't allowed (e.g. "no `:latest` image tags"). |
| **Policy as code** | Writing that rule as a file — version-controlled, reviewed, testable — instead of a wiki line or a clicked setting. |
| **OPA (Open Policy Agent)** | A popular open-source engine that evaluates policies. You feed it data and a rule; it answers. |
| **Rego** | OPA's rule language. You write your policies in Rego (`.rego` files). |
| **Input** | The JSON/YAML thing being checked — a config file, a deployment, a pull request — handed to the policy. |
| **Allow / deny** | The two answers a policy gives: let it through, or block it (usually with a message saying why). |
| **Conftest** | A tool that runs OPA/Rego policies against config files (YAML, JSON, Dockerfile, Terraform) in CI. |
| **Admission control** | A checkpoint in Kubernetes that inspects a resource *before* it's created and can reject it. |
| **Gatekeeper** | The popular OPA-based admission controller for Kubernetes. |
| **Drift** | When the real state slowly diverges from the intended rule (the bane of "everyone knows the rule"). |

---

## Core Concept 1 — What "Policy as Code" Actually Means

Picture a concrete rule your company cares about:

> *"Every Docker image we run must come from our own registry, `registry.mycorp.com`. Never pull a random image off the public internet."*

There are three places that rule can live.

**Place 1 — in people's heads.** Someone explains it during onboarding. Six months later a tired engineer copy-pastes `image: nginx:latest` from a tutorial. Nobody catches it. The rule was real, but nothing *enforced* it.

**Place 2 — a clicked setting in a web UI.** Maybe your registry tool has a checkbox: "only allow internal images." Someone ticked it once. But you can't see *when* it was ticked, *who* ticked it, *why*, or whether it's still ticked today. And if you have ten clusters, you'd have to tick it ten times and hope you didn't miss one.

**Place 3 — code in a file.** You write the rule as a small program:

```
input: a description of the thing being deployed (as JSON)
rule:  if the image does not start with "registry.mycorp.com/", DENY it
       with the message "image must come from registry.mycorp.com"
```

That file goes in git. Changing the rule means opening a **pull request** — which means someone reviews it, and the change is recorded forever with a reason. The rule runs automatically on every change, on every cluster, identically. Nobody has to remember it.

That third place is **policy as code**: the rule is a *testable, version-controlled, automatically-enforced file* instead of tribal knowledge or a checkbox.

> **Key insight:** the value of policy as code isn't that it can do something a human can't — a human *could* check every image by hand. The value is that the file **can't forget, can't get tired, can't quit, and can't drift**, and you can read its git history to learn *why each rule exists*. That last part — "why" — is something a clicked checkbox can never tell you.

---

## Core Concept 2 — OPA and Rego: input → allow/deny

The most common tool for policy as code is **OPA — the Open Policy Agent**. OPA is a small engine with one job: you give it (1) some **input** — a JSON description of a thing — and (2) a **policy** written in a language called **Rego**, and OPA tells you whether the input is **allowed** or should be **denied**, often with a message explaining why.

Think of OPA as a referee and Rego as the rulebook. The referee doesn't care *what* the thing is — a Kubernetes pod, a Terraform plan, a pull request — it only cares about the JSON you hand it and the rules you wrote.

Here's the smallest useful example. The rule: **deny a Kubernetes pod that runs as the root user.** First, the **input** — a tiny slice of a pod, as JSON:

```json
{
  "kind": "Pod",
  "spec": {
    "securityContext": { "runAsUser": 0 }
  }
}
```

`runAsUser: 0` means "run as root," which is dangerous. Now the **policy** in Rego:

```rego
package main

# A "deny" rule. If its body is true, this message is added to the deny set.
deny[msg] {
    input.spec.securityContext.runAsUser == 0
    msg := "pod must not run as root (runAsUser 0)"
}
```

Read it line by line:

- `package main` — just a namespace; ignore it for now, it groups your rules.
- `deny[msg] { ... }` — this defines a rule named `deny`. The `[msg]` means "collect any messages produced." If the stuff inside `{ }` is **true**, the `msg` gets added to a set of denials.
- `input.spec.securityContext.runAsUser == 0` — reach into the input JSON and check: is `runAsUser` equal to `0`? With the input above, **yes**.
- `msg := "pod must not run as root (runAsUser 0)"` — set the explanation.

Because the condition is true, `deny` produces the message `"pod must not run as root (runAsUser 0)"`. A non-empty `deny` set means **blocked**. If the input had `runAsUser: 1000`, the condition would be false, `deny` would be empty, and the pod would be **allowed**.

The mental shape of *every* Rego policy is the same: **reach into `input`, check a condition, and if it's bad, add a deny message.** Here's a second example — the registry rule from Concept 1:

```rego
package main

deny[msg] {
    image := input.spec.containers[_].image          # for each container's image...
    not startswith(image, "registry.mycorp.com/")    # ...if it's NOT from our registry...
    msg := sprintf("image '%s' is not from registry.mycorp.com", [image])
}
```

The `[_]` means "loop over every container" — if *any* image fails the check, that image's message lands in `deny`. `sprintf` just builds a string with the offending image name in it, so the error tells you *which* image is wrong.

> **Key insight:** Rego flips the usual way you'd write a check. You don't write "if everything is fine, return allow." You write the rules for what is **bad**, and each bad thing adds a message. **Empty deny set = allowed; any messages = denied.** Once that clicks, most real-world policies are just a handful of small `deny` blocks stacked in one file.

---

## Core Concept 3 — Conftest: Checking Config Files in CI

OPA on its own is an engine. To use it on the config files in your repo — your Kubernetes YAML, your Dockerfile, your Terraform — the friendly wrapper is **Conftest**. Conftest reads a config file, hands it to your Rego policies as `input`, and **fails the command** (exit code 1) if any `deny` fires. That non-zero exit is what makes your **CI build go red**, blocking the change.

Suppose you have this Kubernetes deployment, `deployment.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  template:
    spec:
      containers:
        - name: web
          image: nginx:latest        # <-- two problems: ':latest' AND not our registry
```

And a policy file, `policy/deny.rego`:

```rego
package main

# Rule 1: forbid the ':latest' tag — it makes deploys unreproducible.
deny[msg] {
    image := input.spec.template.spec.containers[_].image
    endswith(image, ":latest")
    msg := sprintf("image '%s' uses ':latest' — pin a real version", [image])
}

# Rule 2: require our own registry.
deny[msg] {
    image := input.spec.template.spec.containers[_].image
    not startswith(image, "registry.mycorp.com/")
    msg := sprintf("image '%s' must come from registry.mycorp.com", [image])
}
```

Run Conftest against the file:

```bash
conftest test deployment.yaml --policy policy/
```

Both rules fire, so you get:

```
FAIL - deployment.yaml - main - image 'nginx:latest' uses ':latest' — pin a real version
FAIL - deployment.yaml - main - image 'nginx:latest' must come from registry.mycorp.com

2 tests, 0 passed, 2 failures
```

Conftest exits non-zero, so in CI the job fails and the pull request can't merge until the YAML is fixed. Wire it into a CI step like any other check:

```yaml
# In a CI pipeline, this step fails the build if any policy denies.
- name: Check Kubernetes config against policy
  run: conftest test deployment.yaml --policy policy/
```

That's the whole loop: **config file → Conftest → your Rego rules → pass or fail the build.** The same pattern checks Dockerfiles ("no `ADD` from a URL"), Terraform plans ("no public S3 bucket"), and plain JSON.

> **Key insight:** Conftest turns a policy into a **required CI check** — the same gate that runs your tests now also runs your rules. A developer doesn't need to *remember* "don't use `:latest`"; if they do, the build goes red and tells them exactly why, in seconds, before the bad config ever reaches a cluster. The rule enforces itself.

---

## Core Concept 4 — Admission Control: Rejecting Bad Resources Before They Exist

Conftest catches problems in CI, before anything is deployed — that's the *early* gate. But what about resources created *directly* against a live system, bypassing CI? In Kubernetes, there's a second, deeper checkpoint: **admission control**.

When anyone asks Kubernetes to create a resource (a pod, a service, anything), the request passes through an **admission controller** *before* the resource is actually created. The controller inspects the request and can **reject** it. It's a bouncer at the door: the resource doesn't get a "sorry, that was wrong" *after* it's running — it never gets created at all.

The popular OPA-based admission controller is **Gatekeeper**. You install it, give it your policies, and from then on every resource that violates a policy is **refused at creation time**:

```bash
kubectl apply -f bad-pod.yaml
# Error from server (Forbidden): admission webhook "validation.gatekeeper.sh" denied the request:
# pod must not run as root (runAsUser 0)
```

Notice this is the *same kind* of rule from Concept 2 — "deny a root pod" — just enforced at a different point. That's the key idea: the **same policy** can run as an **early gate** (Conftest in CI, catching it in the pull request) *and* a **last-line gate** (Gatekeeper in the cluster, catching anything that slipped past CI). Belt and suspenders.

You don't need to write Gatekeeper policies yet — that's middle/senior material. What matters now is the *concept*:

- **Conftest** = check config files **before** deploy, in CI. Cheap, fast, catches mistakes early.
- **Admission control (Gatekeeper)** = reject bad resources **at the moment of creation**, in the live cluster. Catches anything that didn't go through CI.

> **Key insight:** there are two good places to enforce a policy — **before** the change reaches the system (CI / Conftest) and **at the boundary** of the system (admission control). Early gates give fast, friendly feedback to developers; boundary gates guarantee that *nothing* gets in without passing, no matter how it was submitted. Strong setups use both, and reuse the same rule in each.

---

## Core Concept 5 — Why Code Beats Clicked Settings

This is the core junior lesson, so let's make it explicit. Why is a rule-as-code better than the same rule clicked in a web UI or written on a wiki? Five concrete reasons.

**1. Versioned.** The rule lives in git. You can run `git log` on the policy file and see every change, when it happened, and the commit message saying *why*. A checkbox in a console has no history — it's either ticked or not, with no story.

**2. Reviewable.** Changing a rule means opening a pull request, which a teammate reviews before it merges. Loosening a security rule gets *seen and discussed*, not quietly toggled by one person at 5pm.

**3. Testable.** Because the policy is code, you can write **unit tests** for it — feed it a known-bad input and assert it's denied, feed it a known-good input and assert it's allowed. OPA has a built-in test runner:

```rego
package main

# A test: a root pod MUST be denied.
test_root_pod_denied {
    deny[_] with input as {"spec": {"securityContext": {"runAsUser": 0}}}
}
```

```bash
opa test . -v
# PASS: test_root_pod_denied
```

You can be *confident* the rule works, the same way you trust tested code. You cannot unit-test a checkbox.

**4. Consistent — no drift.** The same policy file applies everywhere automatically: every repo, every cluster, every pull request, identically. With clicked settings, cluster A might have the box ticked and cluster B might not, and you'd never know until something leaks. Code can't drift because there's one source of truth.

**5. Auditable.** When an auditor (or your future self) asks "what are our rules and how do we enforce them?", the answer is "read this folder of `.rego` files and the CI config that runs them." It's all in one place, in plain text, with history. "Someone clicked some boxes somewhere" is not an answer an auditor accepts.

| | Rule in a head / wiki | Clicked setting in a UI | Policy as code |
|---|---|---|---|
| History of *why* | None | None | `git log` |
| Reviewed before change | No | Rarely | Yes (pull request) |
| Can be unit-tested | No | No | **Yes** |
| Applies everywhere identically | No (drifts) | Often missed on some envs | **Yes** |
| Easy to audit | No | Hard | **Yes (read the files)** |

> **Key insight:** every advantage of policy as code comes from one root fact — **it's just code in git**. Code gets review, tests, history, and a single source of truth *for free*, because that's how we already manage code. Policy as code simply says: your rules deserve the same treatment as your software, because a broken rule is just as costly as a broken function.

---

## Real-World Examples

**1. The public S3 bucket that policy caught.** A team writes Terraform to provision a storage bucket and, by accident, leaves the access setting public. Before, this would have shipped and exposed customer files until someone noticed. Now a Conftest policy — `deny[msg] { input.acl == "public-read"; msg := "buckets must not be public" }` — runs against the Terraform plan in CI. The pull request goes red with the message "buckets must not be public." The mistake is fixed in five minutes, in review, and never reaches production. The rule did what a tired reviewer might have missed.

**2. "PR must link a ticket."** A team's rule is that every pull request references a tracking ticket (so work is traceable). It used to be enforced by a maintainer eyeballing each PR and sometimes forgetting. They turned it into policy: a check inspects the PR's title/body as `input` and denies if no ticket ID matches the expected pattern. Now the check is automatic, runs on every PR, and tells the author "link a ticket" instantly — no maintainer attention required, no exceptions slipping through.

**3. "Every resource must have an `owner` label."** A platform team kept finding orphaned cloud resources with no idea who owned them — nobody to ask before deleting, nobody to bill. They wrote one Gatekeeper policy: deny any resource missing an `owner` label. Overnight, *every new resource* was forced to declare an owner at creation time, with a clear error if it didn't. The rule that "everyone was supposed to follow" became a rule that *couldn't* be skipped — because the cluster itself refused resources without it.

---

## Mental Models

- **Policy as code is "the rule has a home, and the home is git."** A rule with no home drifts and dies. A rule that lives in a reviewed, tested, version-controlled file enforces itself and explains itself. The format barely matters; the *home* is the whole point.

- **OPA is a referee; Rego is the rulebook; input is the play.** The referee (OPA) doesn't invent rules and doesn't care what sport it is — it reads the rulebook (your Rego) and judges the play (the JSON input) as allow or deny. Swap the rulebook, swap the rules; swap the input, judge a different thing.

- **Write the bad, not the good.** In Rego you list what's *forbidden* — each `deny` block describes one bad situation and the message it produces. No denials means it's fine. You're describing the things that should set off the alarm, not the things that shouldn't.

- **Two gates: the doorbell and the bouncer.** Conftest in CI is the doorbell — it warns you *before* you arrive ("hey, this would be rejected"). Admission control is the bouncer at the door — it physically *won't let bad things in*, no matter how they got there. Best clubs have both, checking the same dress code.

- **A clicked checkbox is a rule with amnesia.** It can't tell you when it was set, by whom, or why — and it might be set here but not there. Code remembers everything, applies everywhere, and explains itself. That memory and reach *is* the upgrade.

---

## Common Mistakes

1. **Leaving rules as tribal knowledge.** "Everyone knows we don't use `:latest`" is not enforcement — it's a wish. If the rule matters, write it as code that fails the build. A rule nobody enforces is a rule that's already being broken somewhere.

2. **Thinking allow vs deny is "return true for good."** In Rego you usually do the opposite: you write `deny` rules for *bad* inputs, and an **empty** deny set means allowed. Writing it backwards ("allow if good") is a common first-day confusion that makes policies behave strangely.

3. **Forgetting to actually *fail the build*.** Running Conftest but ignoring its exit code (or not wiring it into a required CI check) means the policy reports problems that everyone scrolls past. A policy only enforces anything if a violation *blocks the merge or deploy*.

4. **Not testing the policy.** A policy is code, and untested code has bugs. A rule that's silently broken — denies nothing, or denies everything — is worse than no rule, because you *think* you're protected. Write `opa test` cases for at least one bad and one good input.

5. **Checking only in CI, or only at the boundary.** CI-only misses resources created directly against the cluster; boundary-only gives slow, unfriendly feedback. For important rules, run the same policy in **both** places.

6. **Forgetting the deny *message*.** A bare `deny` with no helpful message leaves the developer staring at "FAIL" with no idea what to fix. Always include a `msg` that says what's wrong *and ideally how to fix it* ("use a pinned version, not `:latest`").

---

## Test Yourself

1. In one sentence each, give two reasons a rule written as code beats the same rule written on a wiki.
2. In Rego, what does an **empty** `deny` set mean — allowed or denied? What does a deny set with one message mean?
3. What is the **input** to an OPA policy, and what are the two possible outcomes a policy expresses?
4. What does **Conftest** do, and why does its exit code matter for CI?
5. What is **admission control** in Kubernetes, and how is it different from running Conftest in CI? Why might you want both?
6. You wrote a policy that's supposed to deny pods running as root, but you're not sure it works. What's the policy-as-code way to gain confidence *before* relying on it?

<details>
<summary>Answers</summary>

1. Any two of: **versioned** (git history shows *why* the rule exists and who changed it), **reviewable** (changes go through a pull request), **testable** (you can unit-test it), **consistent** (applies everywhere identically, no drift), **auditable** (all rules in one readable place). A wiki has none of these — it drifts and can't be tested or enforced.
2. **Empty deny set = allowed.** A deny set with a message = **denied**, and the message says why. Rego policies collect reasons something is *bad*; no reasons means it's fine.
3. The **input** is a JSON/YAML description of the thing being checked (a pod, a config file, a pull request). The two outcomes are **allow** or **deny** (usually deny carries a message explaining why).
4. **Conftest** runs your OPA/Rego policies against config files (YAML, Dockerfile, Terraform, JSON) and **exits non-zero if any policy denies**. That non-zero exit makes the CI job fail, which blocks the bad change from merging or deploying.
5. **Admission control** is a Kubernetes checkpoint that inspects a resource *at creation time* and can **reject** it before it ever exists (Gatekeeper is the common OPA-based one). Conftest checks files *earlier*, in CI, before deploy. You want **both** because CI gives fast, friendly feedback to developers, while admission control guarantees nothing gets into the live cluster without passing — even if it bypassed CI.
6. **Write tests for it.** Because the policy is code, feed it a known root-pod input and assert it's denied, and a known non-root input and assert it's allowed (e.g. `opa test`). Passing tests give you confidence the rule actually works before you depend on it.

</details>

---

## Cheat Sheet

```
THE BIG IDEA
  policy as code = a rule written as a tested, version-controlled, auto-enforced FILE
                   (not tribal knowledge, not a wiki line, not a clicked checkbox)

THE TOOLS
  OPA      = the engine that evaluates policies
  Rego     = the language you write policies in (.rego files)
  Conftest = run Rego policies against config files in CI (fails the build on a deny)
  Gatekeeper = OPA-based admission control: reject bad K8s resources at creation

THE REGO SHAPE (write the BAD, not the good)
  deny[msg] {
      <reach into input and check a condition>   # if TRUE...
      msg := "what is wrong (and how to fix it)" # ...add this message
  }
  empty deny set  = ALLOWED
  any messages    = DENIED

RUN IT
  conftest test deployment.yaml --policy policy/   # check a config file in CI
  opa test .                                       # unit-test your policies

TWO PLACES TO ENFORCE
  CI / Conftest      = BEFORE deploy → fast, friendly, catches it in the PR
  admission control  = AT creation   → last line, nothing gets in without passing
  important rules → do BOTH, reusing the same policy

WHY CODE > CLICKED SETTINGS
  versioned (git log) · reviewable (PR) · testable (opa test)
  consistent (no drift) · auditable (read the files)
```

---

## Summary

- **Policy as code** means writing your rules as actual files — version-controlled, reviewed, and tested — instead of leaving them in someone's head, on a wiki, or as a checkbox clicked once in a web UI. A rule with a home in git can't drift and can explain *why* it exists.
- **OPA** is the engine and **Rego** is its language. A policy takes some **input** (a JSON/YAML description of a thing) and answers **allow** or **deny**, usually with a message. In Rego you write the *bad* cases as `deny` blocks: **empty deny set = allowed; any messages = denied.**
- **Conftest** runs your Rego policies against config files (YAML, Dockerfile, Terraform) in CI and **fails the build** when a rule is violated — turning a policy into a required check that gives instant feedback in the pull request.
- **Admission control** (e.g. **Gatekeeper** in Kubernetes) enforces the *same kind* of rule at a deeper point: it **rejects bad resources at creation time**. Early gates (CI) and boundary gates (admission control) complement each other — strong setups use both with the same policy.
- **Code beats clicked settings** for five concrete reasons: it's **versioned, reviewable, testable, consistent (no drift), and auditable** — all of which come free from the simple fact that it's just code in git.

You now have the core idea: rules deserve the same care as software. Next, [middle.md](middle.md) goes deeper into writing real Rego (helper rules, data, packages), structuring and testing a policy library, and where policy gates fit across the whole delivery pipeline.

---

## Further Reading

- [Open Policy Agent — official documentation](https://www.openpolicyagent.org/docs/) — start with "Introduction" and "Policy Language" for Rego basics. The clearest source for everything OPA.
- [Conftest documentation](https://www.conftest.dev/) — how to run policies against YAML, Dockerfile, Terraform, and more, and wire it into CI.
- [The Rego Playground](https://play.openpolicyagent.org/) — paste input + a policy and see allow/deny live in the browser. The fastest way to *feel* how Rego works.
- [OPA — "Policy as Code" overview](https://www.openpolicyagent.org/docs/latest/policy-language/) — the OPA project's own framing of why rules belong in code.
- The [middle.md](middle.md) of this topic, which formalizes Rego, policy testing, and where gates sit in the delivery pipeline.

---

## Related Topics

- [01 — Required CI Checks](../01-required-ci-checks/junior.md) — the gate that *runs* a Conftest policy and turns a violation into a red build.
- [02 — Branch Protection & Merge Policies](../02-branch-protection-and-merge-policies/junior.md) — making a policy check *required* before a pull request can merge.
- [07 — Break-glass & Bypass](../07-break-glass-and-bypass/junior.md) — what to do when a policy *must* be overridden in an emergency, safely and on the record.
- [Security](../../../../Security/) — many policies exist to enforce security rules (no public buckets, no root containers, no hardcoded secrets).
- [Release Engineering](../../release-engineering/) — where policy gates sit in the path from commit to production.
