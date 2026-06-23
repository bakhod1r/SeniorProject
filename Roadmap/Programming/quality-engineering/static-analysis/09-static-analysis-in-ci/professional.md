# Static Analysis in CI — Professional Level

> **Roadmap:** [Static Analysis](../README.md) → Static Analysis in CI
> *Designing the organization's static-analysis-in-CI program as a paved road: shared reusable workflows, a disciplined advisory→baseline→block rollout, governance of what's mandatory, and metrics that prove the program earns its keep.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 -- The Paved Road](#core-concept-1----the-paved-road)
5. [Core Concept 2 -- Reusable Workflows and Centralized Config](#core-concept-2----reusable-workflows-and-centralized-config)
6. [Core Concept 3 -- The Rollout Sequence](#core-concept-3----the-rollout-sequence)
7. [Core Concept 4 -- Governance of Mandatory Checks](#core-concept-4----governance-of-mandatory-checks)
8. [Core Concept 5 -- Measuring the Program](#core-concept-5----measuring-the-program)
9. [Core Concept 6 -- Relationship to Quality Gates and Required Checks](#core-concept-6----relationship-to-quality-gates-and-required-checks)
10. [Core Concept 7 -- Centralized Reporting at Scale](#core-concept-7----centralized-reporting-at-scale)
11. [Core Concept 8 -- The Economics and the Anti-Goals](#core-concept-8----the-economics-and-the-anti-goals)
12. [Real-World Examples](#real-world-examples)
13. [Mental Models](#mental-models)
14. [Common Mistakes](#common-mistakes)
15. [Test Yourself](#test-yourself)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)
18. [Further Reading](#further-reading)
19. [Related Topics](#related-topics)

---

## Introduction

> Focus: **the org-level program — a paved road of shared workflows and configs, a rollout that doesn't revolt the org, governance of what's mandatory, and metrics that show the program is worth its cost.**

A senior engineer can make static analysis work for one repo. The professional question is different: *how does a 300-engineer, 200-repo organization get consistent, trusted static analysis without each team reinventing it badly?* The answer is a **paved road** — a centrally owned, well-lit, easy default path that teams adopt because it's less work than rolling their own, not because a mandate forces them. Around it you need a rollout sequence that respects existing code, governance that decides what's mandatory and how exceptions work, and a metrics program that justifies the investment and catches the program decaying. This level is about platform strategy, not YAML.

---

## Prerequisites

**Required**

- Senior level: the ratchet, SARIF/aggregation, suppression discipline, CI-time budgets.
- Experience operating CI for multiple repos/teams.
- Familiarity with required status checks / branch protection and [Quality Gates](../../quality-gates/).

**Helpful**

- Exposure to platform-engineering / "paved road" thinking.
- Having driven a tooling rollout that touched many teams.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| Paved road | A supported, easy-default path teams adopt because it's the least-effort option. |
| Reusable workflow | A CI workflow defined once centrally and called by many repos. |
| Golden config | A canonical, versioned analyzer config the org distributes. |
| Rollout sequence | The staged path: advisory → baseline → block. |
| Mandatory check | A check the org requires across repos (vs. team-opt-in). |
| Exception process | The governed way to get a time-boxed waiver from a mandatory check. |
| Pre-merge catch rate | Share of findings caught before merge vs. escaping to main/prod. |
| Suppression growth | Rate at which in-code suppressions accumulate org-wide. |
| Time budget SLO | The agreed maximum CI analysis duration. |
| Drift | Repos diverging from the golden config / shared workflow. |

---

## Core Concept 1 -- The Paved Road

A mandate without a paved road produces malicious compliance: teams copy-paste a broken workflow, disable the rules that annoy them, and technically "have static analysis." A paved road inverts the incentive — the central, supported path is *easier* than rolling your own, so teams choose it.

A paved road for static-analysis-in-CI consists of:

- **A one-line opt-in.** A repo gets the full analyzer suite by *calling a reusable workflow*, not by maintaining 200 lines of YAML.
- **Golden configs** for each analyzer, versioned and distributed, so "what counts as a finding" is consistent org-wide.
- **Sensible, fast defaults** — diff-aware, cached, parallelized — so the road is *fast*, removing the main reason teams go off-road.
- **An escape hatch with guardrails** — teams can extend or, with justification, override, but overrides are visible and reviewed (governance, Concept 4).
- **An owner.** A platform/DevEx team owns the road, fixes it when it breaks, and absorbs the maintenance teams would otherwise duplicate.

The test of a paved road: *is the supported path the path of least resistance?* If doing the right thing is more work than doing the wrong thing, the road has failed regardless of policy.

---

## Core Concept 2 -- Reusable Workflows and Centralized Config

Concretely, the paved road is a **reusable workflow** that repos call:

```yaml
# org/.github/workflows/static-analysis.yml  (the paved road, owned centrally)
on:
  workflow_call:
    inputs:
      languages: { type: string, default: 'go' }

jobs:
  analyze:
    runs-on: ubuntu-latest
    permissions: { security-events: write, contents: read }
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }          # full history → merge-base diff
      - name: Diff-aware lint (ratchet)
        run: |
          BASE=$(git merge-base origin/${{ github.base_ref || 'main' }} HEAD)
          golangci-lint run --new-from-rev="$BASE" --out-format=sarif > out.sarif || true
      - uses: github/codeql-action/upload-sarif@v3
        with: { sarif_file: out.sarif }
```

A consuming repo's entire static-analysis setup becomes:

```yaml
# any-repo/.github/workflows/ci.yml
name: ci
on: [pull_request]
jobs:
  static-analysis:
    uses: org/.github/.github/workflows/static-analysis.yml@v3   # pinned version
    with: { languages: 'go' }
```

Two professional details:

- **Version the road.** Repos pin `@v3`; you ship `@v4` and migrate consumers deliberately. An un-versioned shared workflow that changes under everyone breaks the whole org at once.
- **Distribute golden configs** the same way — a versioned `.golangci.yml` / `ruff.toml` pulled from a central source (a config repo, a published package, or baked into the workflow), so config drift is detectable and correctable. Drift is the slow death of consistency: measure it (Concept 5).

This is the same machinery `ci-cd-pipeline-design` describes for pipelines generally — applied to the analysis stage specifically.

---

## Core Concept 3 -- The Rollout Sequence

You cannot flip strict blocking on across an org overnight; you'll trigger a revolt and the program gets rolled back. The proven sequence, per check:

1. **Advisory (observe).** Run the check, report findings (SARIF/annotations), but **never block**. Goal: measure the noise and the false-positive rate on real code *before* anyone is blocked. Time-box this — advisory-forever is the failure mode from the middle level.
2. **Baseline (grandfather).** Snapshot existing findings; switch to diff-aware so only *new* findings would block. Now the gate is *achievable* — clean PRs pass, the backlog is grandfathered.
3. **Block (enforce).** Make the diff-aware check a **required status check**. New findings now stop merges; old code is untouched until edited.
4. **Pay down (optional, ongoing).** Chip at the baseline opportunistically (boy-scout rule: clean the file you touch) or with funded campaigns for high-value rules.

The discipline is to move *one check at a time* through this sequence, watch the metrics at each step, and never skip step 1 — advisory-first is how you discover a rule is too noisy *before* it blocks anyone and burns trust. A check that goes straight to blocking and turns out to have a 30% false-positive rate will poison the whole program's credibility.

---

## Core Concept 4 -- Governance of Mandatory Checks

Not every check should be org-mandatory, and "mandatory" needs a defined meaning. Governance answers four questions:

- **Which checks are mandatory vs. recommended vs. team-discretion?** Typically: secrets detection, critical-severity SAST, and known-critical CVEs are *mandatory everywhere*; formatting and language linting are *strongly recommended*; project-specific rules are *team discretion*. Write this down — an undocumented mandate is unenforceable and unfair.
- **Who owns the list and changes it?** A named group (a guild, a platform team, a security org) with a lightweight RFC process to add/remove a mandatory check. Adding a mandatory org-wide check is a *change with blast radius*; it deserves review.
- **How do exceptions work?** There must be a **governed, time-boxed exception process** — a way for a team with a legitimate reason to get a waiver that *expires* and is *visible*, not a silent config override. An exception nobody can see and that never expires is just a hole in the policy.
- **What's the break-glass?** A documented, audited path to bypass a required check in a genuine emergency (production incident hotfix), with after-the-fact review. The detailed mechanics of required checks, exceptions, and break-glass live in [Quality Gates](../../quality-gates/) — the professional job here is ensuring static-analysis checks plug into that existing governance rather than inventing a parallel one.

---

## Core Concept 5 -- Measuring the Program

A program you can't measure is one you can't defend at budget time or notice decaying. Track a small, honest set:

| Metric | What it tells you | Watch for |
|---|---|---|
| **Pre-merge catch rate** | Share of findings caught before merge vs. escaping to `main`/prod | Falling → checks aren't running early enough |
| **CI analysis time (p50/p95)** | Whether you're inside the time-budget SLO | p95 creeping up → a check is too expensive |
| **Suppression count & growth** | Whether teams satisfy gates or route around them | Growth outpacing code growth → gates being bypassed in-code |
| **Baseline burn-down** | Whether legacy debt is shrinking | Flat forever → the ratchet holds but debt never paid |
| **False-positive / waiver rate** | Whether a check is trusted | High → the check is noisy; demote to advisory and fix |
| **Adoption / config drift** | % of repos on the paved road & golden config | Drift rising → road isn't easy enough |
| **Flaky-failure rate** | Spurious reds per 100 runs | Any sustained level → credibility erosion |

Beware Goodhart: optimize "finding count = 0" and you'll get a tidal wave of suppressions, not clean code (cross-ref engineering-metrics-and-dora). The metrics that matter measure the *health and trust* of the program — catch rate, false-positive rate, suppression growth — not a vanity zero. Report these on a dashboard the org can see; a program operating in the dark is a program that quietly rots.

---

## Core Concept 6 -- Relationship to Quality Gates and Required Checks

Static-analysis-in-CI **produces** the signals; [Quality Gates](../../quality-gates/) **decides what to do** with them. Keeping the boundary clean avoids duplicated, conflicting policy:

- **This topic owns:** *where* analyzers run (the spectrum), *how* they run (jobs, caching, diff-aware), *what* they report (SARIF, annotations), and the *quality of the signal* (suppression discipline, flakiness).
- **Quality Gates owns:** *which* status checks are required, branch-protection policy, coverage thresholds, deploy approvals, exception and break-glass processes.

A static-analysis check becomes a *gate* only when Quality Gates marks it required. The professional designs the analysis program so its outputs slot cleanly into the existing gate framework — one set of required checks, one exception process, one break-glass path. Don't build a second governance system inside your analysis tooling; feed the one the org already has. Likewise, the "new-code" philosophy here (ratchet on the diff) mirrors the "new-code coverage" gate in [Code Coverage](../../code-coverage/) — present them to teams as one coherent *new-code-must-be-clean* policy, not two unrelated rules.

---

## Core Concept 7 -- Centralized Reporting at Scale

At 200 repos, per-repo dashboards don't give leadership or security a coherent picture. Centralize:

- **One ingestion format.** Mandate SARIF (or the aggregator's native ingestion) so every repo's findings land in one system regardless of language or tool.
- **One pane of glass.** GitHub code scanning org-wide, or a SonarQube/aggregator instance, gives security and platform teams a cross-repo view: which repos have unaddressed critical findings, where suppression debt concentrates, which repos drifted off the paved road.
- **Trend over snapshot.** Leadership cares about *direction* — is critical-finding count falling quarter over quarter? — more than today's absolute number.
- **Routing, not just reporting.** A finding that nobody owns is noise. Pipe critical findings to the owning team's workflow (issue, alert) with clear ownership, so reporting drives *action*, not a dashboard nobody opens.

Keep the authoritative *gate* singular (Concept 6) even as reporting is centralized: the central dashboard is for visibility and trend; the merge-blocking decision stays in the repo's required checks.

---

## Core Concept 8 -- The Economics and the Anti-Goals

The program exists to **move findings left on the cost curve** — from incidents (expensive) to CI (a context switch) to the editor (free). Every design choice serves that: the paved road makes left-shift the default; diff-aware keeps it fast so people don't route around it; suppression discipline keeps the signal honest.

Equally important are the **anti-goals** — what the program must *not* become:

- **Not a bureaucracy.** If adding a check requires a committee and three months, security debt outruns the process. Make the common case easy and the rollout sequence the heavy machinery.
- **Not a noise machine.** A program that cries wolf gets muted, and then it's worse than nothing — engineers tune out *real* findings too.
- **Not a vanity metric.** Zero findings via mass suppression is a lie. Measure trust and catch rate, not a cosmetic zero.
- **Not a parallel governance.** Plug into Quality Gates; don't fork it.

The professional's deliverable is a program that engineers experience as *help* — fast, accurate, early — and that leadership experiences as *control* — measurable, governed, trending the right way. When those two perceptions hold simultaneously, the road is paved.

---

## Real-World Examples

**Reusable workflow + golden config rollout.** A platform team ships a versioned `static-analysis.yml` and golden `.golangci.yml`. Adoption goes from 30% to 90% of repos in a quarter — not by mandate but because it's a 4-line opt-in that's faster (cached, diff-aware) than what teams had. Config drift becomes a tracked metric; out-of-date repos get nudged automatically.

**Advisory-first saves the program.** A security org wants a new SAST rule blocking org-wide. They run it advisory for three weeks; the false-positive rate is 25%. They tune the rule and re-measure (8%), *then* baseline and block. Had they gone straight to blocking, the 25% noise would have burned trust in every SAST check.

**Suppression-growth alarm.** The program dashboard shows suppression count growing 3× faster than code. Investigation: one org-wide mandatory rule was too strict, so teams blanket-suppressed it. Fix: refine the rule via the governance RFC and re-baseline. The vanity "low finding count" had hidden a real bypass.

---

## Mental Models

- **Pave the road.** Make the right path the easy path; mandates without ease produce malicious compliance.
- **One check, one ramp.** Each check walks advisory → baseline → block; never skip advisory.
- **Produce signals here, decide policy in Quality Gates.** One governance system, fed by your analysis.
- **Measure trust, not vanity.** Catch rate, false-positive rate, and suppression growth — not a cosmetic zero.
- **Anti-goals are design constraints.** Not bureaucracy, not noise, not vanity, not a parallel governance.

---

## Common Mistakes

- **Mandate without a paved road** — teams comply maliciously; consistency is fiction.
- **Un-versioned shared workflow** — one change breaks every repo simultaneously.
- **Skipping advisory** — a noisy check goes straight to blocking and poisons trust in the whole program.
- **No exception process** — teams route around mandatory checks with invisible config overrides.
- **Optimizing finding count** — Goodhart kicks in; you get suppressions, not clean code.
- **Parallel governance** — a second required-checks/exception system inside the analysis tooling, conflicting with Quality Gates.
- **Reporting without routing** — a beautiful dashboard nobody acts on.
- **No program metrics** — the road silently rots; you find out at the next incident.

---

## Test Yourself

1. What makes something a "paved road" rather than a mandate, and why does the distinction matter?
2. Describe the advisory → baseline → block sequence. Why is skipping advisory dangerous?
3. Which static-analysis checks would you make mandatory org-wide, and how should exceptions work?
4. Name four program metrics and the decay each one detects. How does Goodhart's law threaten the metrics?
5. Draw the boundary between this topic and Quality Gates. What does each own?
6. Suppression count is growing 3× faster than code despite a clean finding count. Diagnose and remediate.

---

## Cheat Sheet

```yaml
# Consume the paved road (a whole repo's setup)
jobs:
  static-analysis:
    uses: org/.github/.github/workflows/static-analysis.yml@v3   # pinned
    with: { languages: 'go' }
```

```
Rollout per check:  advisory  →  baseline  →  block  →  pay down
                    (observe)    (grandfather) (required)  (boy-scout)
```

| Layer | Owns |
|---|---|
| Static Analysis in CI | Where/how analyzers run, what they report, signal quality |
| Quality Gates | Which checks are required, exceptions, break-glass |
| Aggregator/dashboard | Cross-repo visibility & trends (not the gate) |

| Metric | Decay it catches |
|---|---|
| Pre-merge catch rate ↓ | Checks running too late |
| CI p95 time ↑ | A check too expensive |
| Suppression growth ↑ | Gates bypassed in-code |
| False-positive rate ↑ | An untrusted, noisy check |
| Config drift ↑ | Paved road not easy enough |

---

## Summary

- Build a **paved road**: a versioned reusable workflow + golden configs that make the supported path the path of least resistance, owned by a platform team.
- Roll out **one check at a time** through **advisory → baseline → block → pay down**; never skip advisory, or a noisy check will poison program trust.
- **Govern** what's mandatory (secrets, critical SAST/CVE everywhere; lint/format recommended), with a named owner, an RFC to change the list, and a visible, time-boxed **exception** and **break-glass** process — plugged into Quality Gates, not a parallel system.
- **Measure** pre-merge catch rate, CI time SLO, suppression growth, baseline burn-down, false-positive rate, and config drift; optimize for *trust*, not a vanity zero (beware Goodhart).
- This topic **produces signals**; [Quality Gates](../../quality-gates/) **decides policy**; an aggregator provides cross-repo **visibility**. Keep one authoritative gate.
- Hold the **anti-goals**: not a bureaucracy, not a noise machine, not a vanity metric, not a parallel governance. The program should feel like *help* to engineers and *control* to leadership at once.

---

## Further Reading

- Netflix / platform-engineering writing on the "paved road" model.
- GitHub reusable workflows; org-level code scanning configuration.
- *Accelerate* and DORA / SPACE — measuring engineering programs without Goodharting.
- SonarQube org-level dashboards and quality-gate governance docs.
- The `ci-cd-pipeline-design` skill — central pipeline and shared-workflow patterns.

---

## Related Topics

- [Quality Gates](../../quality-gates/) — required checks, exceptions, break-glass; where policy lives.
- [Code Coverage](../../code-coverage/) — the new-code coverage gate that pairs with the ratchet.
- [SAST Security Scanners](../04-sast-security-scanners/) and [Dependency & License Scanning](../06-dependency-and-license-scanning/) — the mandatory-check candidates.
- [Linters & Style Checkers](../01-linters-and-style-checkers/) and [Formatters](../02-formatters/) — the recommended-tier checks on the road.
- Interview level of this topic — the question bank covering this whole spectrum.
