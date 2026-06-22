# Quality Gates

> *"A gate is a promise that something will not pass without being looked at — and every gate you cannot defend will eventually be removed at 3 a.m."*

This roadmap is about **the policy layer that decides whether a change is allowed to advance**: required CI checks, branch protection and merge policies, coverage and quality thresholds, deploy approvals and sign-offs, the explicit negotiation between speed and safety, codifying all of it as policy-as-code, and the break-glass path for when you must bypass a gate safely. Gates are treated here as a **design problem** — each with an owner, a cost, a signal, and an escape hatch — not as an accumulation of accidental rules.

> Looking for *how to design the CI/CD pipeline itself*? Pair this with the `ci-cd-pipeline-design` skill and [Release Engineering](../release-engineering/).
>
> Looking for *code review as a gate*? See [Code Review](../code-review/) (this roadmap covers the *policy* that requires review; that one covers *how to review well*).
>
> Looking for *release-time gating specifically* (canaries, freezes, rollback)? See [Release Engineering](../release-engineering/).

---

## Why a Dedicated Roadmap

Most teams accumulate quality gates by accretion — a bug shipped, so a check was added; nobody removed it when it stopped catching anything. The result is a slow, theatre-laden pipeline whose required checks no one can justify, and whose only escape valve is an undocumented "admin merge" at 3 a.m. Treating gates as first-class design objects — each with an **owner, a cost in cycle time, a signal it actually catches, and a defensible bypass path** — is what separates an engineering organization from a compliance organization. This roadmap also draws the line every senior engineer must hold: a gate that fires constantly without catching real defects isn't safety, it's [Goodhart's law](../engineering-metrics-and-dora/) wearing a hi-vis vest.

| Roadmap | Question it answers |
|---|---|
| [Testing](../testing/) | Does my code work? |
| [Code Review](../code-review/) | Is this change well-made, by human judgement? |
| [Release Engineering](../release-engineering/) | How do I get a working artifact safely to production? |
| **Quality Gates** (this) | *Who decides this change is allowed to advance, on what evidence, and how is that policy enforced and overridden?* |

---

## Sections

Each topic ships the full five-tier set — **junior / middle / senior / professional / interview**.

| # | Topic | Focus |
|---|---|---|
| [01](01-required-ci-checks/) | Required CI Checks | Status checks as the green-build contract; required vs advisory; build/test/lint/type/SAST/secret-scan as gates; pre-commit vs CI; flaky required checks |
| [02](02-branch-protection-and-merge-policies/) | Branch Protection & Merge Policies | Branch protection rules, required reviews & CODEOWNERS, linear history, merge queues (GitHub/Mergify), protected branches, who can push |
| [03](03-coverage-and-quality-thresholds/) | Coverage & Quality Thresholds | Diff vs absolute coverage gates, complexity/duplication/perf-regression thresholds, ratchets, and the Goodhart trap of threshold-as-target |
| [04](04-deploy-approvals-and-signoffs/) | Deploy Approvals & Sign-offs | Manual approvals, environment protection rules, change advisory boards, separation of duties, audit trails, manual-vs-automated judgement |
| [05](05-gate-design-speed-vs-safety/) | Gate Design: Speed vs Safety | The core trade-off — where to place gates, fast feedback vs thoroughness, gate cost/signal, telemetry, and how flaky or pointless gates erode trust |
| [06](06-policy-as-code/) | Policy as Code | OPA/Rego, Conftest, Gatekeeper/admission control, codifying gate rules as versioned, testable, reviewable policy instead of clicked-in settings |
| [07](07-break-glass-and-bypass/) | Break-glass & Bypass | Emergency override paths done right: pre-authorized, logged, time-boxed, after-the-fact justification, audit — the gate you can defend at 3 a.m. |

---

## Languages

This section is mostly language-agnostic — gates live in CI configuration and platform policy, not in the source. Examples focus on tooling: **GitHub Actions** required checks plus branch protection and environments, **GitLab CI** `rules` and merge-request approvals, **Buildkite** pipelines with branch policies, **Bazel** test target tagging (`manual`, `exclusive`, size tags), the `pre-commit` framework for local hooks, merge-queue tools (**Mergify**, native **GitHub merge queue**), and **policy-as-code** engines (**OPA/Rego**, **Conftest**, **Gatekeeper**).

---

## Sources & Vocabulary

Grounded in: **Humble & Farley** — *Continuous Delivery* (the canonical text on the deployment pipeline and gate placement); **Forsgren, Humble & Kim** — *Accelerate* / DORA (deployment frequency vs change failure rate — the speed/safety tension quantified); **Kim, Humble, Debois & Willis** — *The DevOps Handbook*; **Goodhart's law** and **surrogation** (why a threshold becomes a target); the **Open Policy Agent** / Rego ecosystem; **GitHub/GitLab** branch-protection, environments, and merge-queue documentation; SRE practice on **error budgets** as deploy gates.

---

## Status

✅ **Content-complete.** All 7 topics are written across the full five-tier set (junior / middle / senior / professional / interview): 35 topic files in total.

---

## Project Context

Part of the [Senior Project](../../../../index.md) — a personal effort to consolidate the essential knowledge of software engineering in one place. Sits in [Quality Engineering](../) as the policy layer over [Testing](../testing/), [Code Coverage](../code-coverage/), [Static Analysis](../static-analysis/), and [Code Review](../code-review/); pairs with [Release Engineering](../release-engineering/) for deploy-time gating and feeds [Engineering Metrics & DORA](../engineering-metrics-and-dora/) for measuring gate cost.
