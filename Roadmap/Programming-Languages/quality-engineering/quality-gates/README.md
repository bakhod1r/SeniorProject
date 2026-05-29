# Quality Gates Roadmap

> *"A gate is a promise that something will not pass without being looked at — and every gate you cannot defend will eventually be removed at 3 a.m."*

This roadmap is about **the policy layer that decides whether a change is allowed to advance**: required CI checks, branch protection, deploy approvals, manual sign-offs, and the explicit negotiation between speed and safety. Gates are treated here as a design problem, not an accumulation of accidental rules.

> Looking for *how to design the CI/CD pipeline itself*? Pair this with the `ci-cd-pipeline-design` skill.
>
> Looking for *code review as a gate*? See [Code Review](../code-review/).
>
> Looking for *release-time gating specifically* (canaries, freezes, rollback)? See [Release Engineering](../release-engineering/).

---

## Why a Dedicated Roadmap

Most teams accumulate quality gates by accretion — a bug shipped, so a check was added; nobody removed it when it stopped catching anything. The result is a slow, theatre-laden pipeline whose required checks no one can justify. Treating gates as first-class design objects (each with an owner, a cost, a signal, and a bypass path) is what separates engineering organizations from compliance organizations.

| Roadmap | Question it answers |
|---|---|
| [Testing](../testing/) | Does my code work? |
| [Release Engineering](../release-engineering/) | How do I get a working artifact safely to production? |
| **Quality Gates** (this) | Who decides this change is allowed to advance, and on what evidence? |

---

## Sections

| # | Topic | Focus |
|---|---|---|
| [01](01-what-is-a-quality-gate/) | What Is a Quality Gate | Explicit rule that blocks progress until a condition is met; gates vs implicit conventions |
| [02](02-pre-commit-gates/) | Pre-commit Gates | What runs locally before commit; the `pre-commit` framework; fast-feedback principle |
| [03](03-pr-gates/) | PR Gates | Required status checks, review approvals, branch protection rules, merge queues |
| [04](04-pre-deploy-gates/) | Pre-deploy Gates | Staging soak, canary metrics, manual approvals, change advisory boards |
| [05](05-test-selection/) | Test Selection | Which tests *must* pass before merge vs which can fail and be triaged |
| [06](06-coverage-gates/) | Coverage Gates | Diff coverage threshold, absolute vs relative, and the Goodhart trap |
| [07](07-security-gates/) | Security Gates | SAST findings, dependency vulnerabilities, secret scanning, license checks |
| [08](08-performance-gates/) | Performance Gates | Regression thresholds in CI, `benchstat` comparisons, the noise problem |
| [09](09-manual-vs-automated-gates/) | Manual vs Automated Gates | When human judgement is the right gate, when it's just bureaucracy |
| [10](10-gate-bypass/) | Gate Bypass | Emergency override paths, after-the-fact justification, audit trail |
| [11](11-gate-telemetry/) | Gate Telemetry | Measuring how often gates fire, what they catch, what they cost in cycle time |
| [12](12-anti-patterns/) | Anti-patterns | "Every check is required," theatre approvals nobody reads, missing rollback gate, gates without owners |

---

## Languages

This section is mostly language-agnostic — gates live in CI configuration and platform policy, not in the source. Examples focus on tooling: **GitHub Actions** required checks plus branch protection, **GitLab CI** rules and merge-request approvals, **Buildkite** pipelines with branch policies, **Bazel** test target tagging (`manual`, `exclusive`, size tags), the `pre-commit` framework for local hooks, and merge queue tools (**Mergify**, **MergeQueue**, native **GitHub merge queue**).

---

## Status

⏳ **Structure defined; content pending.**

---

## References

- *Accelerate* — Forsgren, Humble, Kim (the four key metrics, especially deployment frequency vs change failure rate)
- *The DevOps Handbook* — Kim, Humble, Debois, Willis (the deployment pipeline and the role of gating)
- *Continuous Delivery* — Humble & Farley (the canonical text on the deployment pipeline and gate placement)
- [GitHub merge queue documentation](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)

---

## Project Context

Part of the [Senior Project](../../../../index.md) — a personal effort to consolidate the essential knowledge of software engineering in one place.
