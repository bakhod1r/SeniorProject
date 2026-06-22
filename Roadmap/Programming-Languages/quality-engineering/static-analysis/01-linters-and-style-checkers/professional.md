# Linters & Style Checkers — Professional Level

> **Roadmap:** [Static Analysis](../README.md) → Linters & Style Checkers
> *Governing linting across an organization: shared configs at scale, a rule lifecycle with owners and RFCs, measuring rule value as a product metric, and keeping the linter a tool rather than a weapon.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 -- Rule-Set Governance: Owner, Process, RFC](#core-concept-1----rule-set-governance-owner-process-rfc)
5. [Core Concept 2 -- Shared Configs Across Many Repos](#core-concept-2----shared-configs-across-many-repos)
6. [Core Concept 3 -- Measuring Rule Value as a Product Metric](#core-concept-3----measuring-rule-value-as-a-product-metric)
7. [Core Concept 4 -- Rolling Out a Rule Across an Org](#core-concept-4----rolling-out-a-rule-across-an-org)
8. [Core Concept 5 -- The Linter-as-Moral-Authority Anti-Pattern, Institutionalized](#core-concept-5----the-linter-as-moral-authority-anti-pattern-institutionalized)
9. [Core Concept 6 -- Performance and Cost at Org Scale](#core-concept-6----performance-and-cost-at-org-scale)
10. [Core Concept 7 -- Deprecating and Removing Rules](#core-concept-7----deprecating-and-removing-rules)
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

> Focus: **the linter as a governed, organization-wide system — who owns the rules, how they change, how their value is measured, and how to scale a config across hundreds of repos without it becoming either chaos or tyranny.**

In one repo, the rule set is a config file. Across an organization of fifty teams and three hundred repos, it's a *product*: it has maintainers, a release cadence, a change-management process, customers (every engineer whose PR it can block), a support burden (every false positive is a ticket), and a value story you must defend to leadership when someone asks why the platform team spends time on lint configs.

The failure modes scale too. A bad rule in one repo annoys one team; a bad rule in the shared config annoys everyone simultaneously and erodes org-wide trust in static analysis. This page is about operating that system: governance, distribution, measurement, rollout, and the human politics that determine whether the linter helps or becomes a weapon.

---

## Prerequisites

**Required**

- You can reason about a rule set as a system: decidability, TPR, gating, placement (see [Senior](./senior.md)).
- You've owned linting for at least one team and felt the false-positive budget bite.

**Helpful**

- Experience with internal tooling distribution (private package registries, monorepo tooling).
- Familiarity with how engineering metrics are gathered and (mis)used; see the warnings about Goodhart's law in the metrics sections.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| Shared config | A versioned, published rule set many repos extend. |
| Rule lifecycle | The path a rule takes: proposed → advise → gate → (maybe) removed. |
| RFC | A written, reviewable proposal for a rule change. |
| Config owner | The person/team accountable for the shared rule set. |
| TPR (true-positive rate) | Real problems ÷ firings; the core value metric per rule. |
| Adoption rate | Fraction of repos on the current shared config version. |
| Rollout cohort | A staged group of repos a change reaches at one time. |
| Override | A repo's documented, scoped deviation from the shared config. |
| Drift | Repos diverging from the shared config over time. |
| Deprecation | The managed removal of a rule that no longer earns its keep. |

---

## Core Concept 1 -- Rule-Set Governance: Owner, Process, RFC

An ungoverned shared rule set decays predictably: anyone with commit access adds their preferences, nobody removes anything, and the config becomes a fossil record of past arguments. Governance turns it into a maintained asset.

**Three non-negotiables:**

1. **A named owner.** A specific team (often a platform/DevEx team) is accountable for the shared config — its quality, its release notes, and the support load it generates. "Everyone owns it" means no one does.
2. **A change process proportional to blast radius.** Adding an *advisory* (`warning`) rule can be a lightweight PR. Adding a *gating* (`error`) rule to the org-wide config — something that can block every team's PRs — requires an RFC.
3. **A bar every rule must clear**, written down, so decisions are about evidence not seniority.

A minimal **rule-change RFC** template:

```markdown
# RFC: Enable `no-floating-promises` org-wide (gate)

## Problem
Unawaited promises caused 2 P1 incidents (links). Code review misses them.

## Rule
@typescript-eslint/no-floating-promises (type-aware).

## Evidence
Ran in advise mode across 40 repos for 3 weeks.
Firings: 612.  Sampled 50: 46 real (TPR 92%).  False positives: 4 (all in test setup).

## Cost
Lint time +35% on TS repos (type-aware). Mitigation: scope to src/, cache.

## Rollout
Advise (already done) -> gate, cohort by cohort, baseline existing.

## Exit / removal criteria
Revisit if TPR drops below 80% or suppression density spikes.
```

The RFC forces the proposer to bring *evidence* (TPR, incidents, cost), not taste. It also creates a record so that two years later, "why is this rule on?" has an answer. The exit criteria matter as much as the entry criteria — a rule with no removal condition is a rule that lives forever regardless of value.

---

## Core Concept 2 -- Shared Configs Across Many Repos

The mechanism that lets governance scale is a **published, versioned shared config** that repos extend rather than copy.

**ESLint** — publish an internal package:

```js
// @acme/eslint-config/index.js  (published to the private registry)
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { rules: { "@typescript-eslint/no-floating-promises": "error" } },
];
```

```js
// consuming repo: eslint.config.js
import acme from "@acme/eslint-config";
export default [
  ...acme,
  // repo-local, scoped, documented override:
  { files: ["scripts/**"], rules: { "no-console": "off" } }, // CLI scripts
];
```

**Go** — a canonical `.golangci.yml` distributed via a template repo or a generator, plus a CI step that checks repos haven't drifted from it.

**Python** — a base `ruff.toml` extended via `extend`:

```toml
# repo ruff.toml
extend = "//configs/base-ruff.toml"   # or a path to the shared file
[lint]
extend-ignore = ["B008"]   # documented: FastAPI Depends() pattern
```

Operating principles:

- **Version it and pin it.** Repos pin a version (`@acme/eslint-config@3`) so a config change is an *intentional upgrade*, not a surprise that breaks CI overnight. Treat config releases like any dependency: semver, changelog, migration notes.
- **Make overrides explicit and reviewable.** A repo may deviate, but the deviation lives in code with a reason and is visible to the config owner. Silent forks are how drift becomes unmanageable.
- **Measure adoption.** Track which repos are on which version. A change you shipped that 60% of repos haven't adopted hasn't really happened.
- **Provide a migration path, not a mandate.** Each major config version ships with `--fix` guidance and a baseline strategy so teams can upgrade without a wall-of-errors crisis.

---

## Core Concept 3 -- Measuring Rule Value as a Product Metric

At org scale you can — and must — answer "is this rule worth it?" with data, because the config owner's time and the org's trust are finite.

**The core metric is per-rule true-positive rate**, sampled honestly:

```bash
# Aggregate firings of one rule across the org (illustrative)
golangci-lint run --out-format json ./... \
  | jq '[.Issues[] | select(.FromLinter=="errcheck")] | length'
```

Then sample firings and have humans label them. A dashboard worth maintaining tracks, per rule:

| Metric | What it tells you | Action threshold |
|---|---|---|
| TPR (sampled) | Is the rule mostly right? | < 80% on a gate → demote or tune |
| Firing volume | How much it touches developers | high + low TPR = trust hazard |
| Suppression density | Are teams routing around it? | rising → revisit the rule |
| Time-to-fix | Cost per finding | high → maybe not worth gating |

**Beware Goodhart's law.** The moment "lint findings fixed" or "zero warnings" becomes a target teams are judged on, you get gaming: blanket suppressions, rules turned off locally, `--no-verify`. The metric to optimize is *bugs prevented per unit of developer friction*, not raw finding counts. Surface that framing explicitly, or your own dashboard will be turned into the thing it measures. (The metrics sections cover this trap in depth; the linting-specific version is that "green CI" can be bought with suppressions, not with quality.)

The honest value story to leadership is incident-linked: *"these N gated rules each correspond to a class of incident we've shipped before; in the last year they fired M times with ~90% precision, catching the same class pre-merge."* That's defensible. "We fixed 10,000 lint warnings" is not — it might be pure churn.

---

## Core Concept 4 -- Rolling Out a Rule Across an Org

Flipping a new `error` rule org-wide in one commit is how you take down everyone's CI simultaneously and burn org trust in one afternoon. Roll out in stages, every time.

The standard pipeline, mapping onto the per-repo adoption pattern from [Middle](./middle.md) but at org scale:

1. **Advise everywhere.** Ship the rule as `warning` in the shared config. It's now visible org-wide, blocking nothing. This *is* your measurement phase — collect firings and TPR.
2. **Autofix what's mechanical.** Where the rule has a safe fix, provide and run a codemod/`--fix` pass per repo, landed as a labeled, blame-ignored commit.
3. **Baseline the rest.** Each repo records existing violations (`new-from-rev`, betterer, ratchet) so only *new* code must comply. Nobody faces a 6,000-error wall.
4. **Gate by cohort.** Promote to `error` for a pilot cohort (a few willing teams), watch the support load, then expand cohort by cohort. Never all-at-once.
5. **Burn down the baseline** opportunistically — often as a "boy scout" rule (fix violations in files you touch) rather than a dedicated project.

Each stage has an off-ramp: if TPR or support load is bad, you stop at advise and re-tune rather than forcing the gate. The rollout *is* the safety mechanism; skipping it trades a week of staging for an org-wide outage and a permanent dent in how seriously people take the linter.

---

## Core Concept 5 -- The Linter-as-Moral-Authority Anti-Pattern, Institutionalized

At the org level the moral-authority trap (introduced at [Senior](./senior.md)) becomes structural and more dangerous, because one config owner's preferences now bind everyone and hide behind "the standard."

How it manifests institutionally:

- **Preference laundering.** Someone's personal style becomes a gating org rule via config access, then is defended as "the company standard" — a standard nobody agreed to.
- **Frozen by fear.** Rules accumulate because removing one feels like "lowering standards," even when its TPR is 30%. The set only grows.
- **Review-comment weaponization.** "This violates our standards" used to shut down design discussion, when the "standard" is a contestable convention rule.
- **Style smuggled as correctness.** Aesthetic rules shipped at `error` so they can't be argued with — when a formatter should own them entirely (see [Formatters](../02-formatters/)).

The structural antidotes are the governance mechanisms above, used deliberately:

- **Evidence bar for gates.** No rule becomes a gate without measured TPR and, ideally, an incident link. "Best practice" is not evidence.
- **Removal is normal, not a defeat.** A documented deprecation process (Core Concept 7) makes cutting a low-value rule routine, breaking the ratchet-up-only dynamic.
- **Separate taste from defect.** Style → formatter (deterministic, undebatable). Convention → discussed, documented, usually `warning`. Defect → gate with evidence. Keeping these lanes separate stops one person's taste from riding in as everyone's blocker.
- **The owner serves users.** The config owner's job is preventing defects at acceptable friction — not enforcing a personal vision. Their performance is the org's TPR and trust, not the rule count.

The single sentence to keep: *the linter has exactly the authority its config owner is willing to justify with evidence — and no more.*

---

## Core Concept 6 -- Performance and Cost at Org Scale

Lint time multiplied across thousands of CI runs a day is real money and real developer latency.

- **Centralize caching.** A shared remote cache (or each tool's persisted cache) so common files aren't re-linted from cold every run.
- **Changed-files everywhere.** Standardize "lint the diff" in the shared CI templates; full-repo lint becomes a periodic/scheduled job, not per-PR.
- **Standardize on fast tools.** An org-wide move from Pylint to Ruff, or consolidating ad-hoc per-team Go linters under one cached golangci-lint config, can reclaim thousands of CI-minutes daily. Tool choice dominates config tuning for wall-clock.
- **Budget type-aware rules deliberately.** They're powerful and slow; the shared config should enable them only where the org has decided the bug class justifies the latency, with the cost documented in the RFC.
- **Watch the p95, not the mean.** A rule slow only on the biggest repos still ruins those teams' experience. Track lint latency per repo size class.

Treat lint latency as an SLO the config owner is on the hook for. Deep CI orchestration (parallelism, required checks, fail-fast) lives in [Static Analysis in CI](../09-static-analysis-in-ci/); the org-config concern is keeping the *default* fast so teams don't fork the config to escape slowness.

---

## Core Concept 7 -- Deprecating and Removing Rules

The hardest governance discipline is *removal*, because every removal feels like lowering the bar and no one wants that on their record. Without a removal process, the rule set ratchets up forever and slowly fills with noise.

A managed deprecation:

1. **Trigger.** A rule's TPR drops below the bar, its suppression density spikes, the formatter now subsumes it, or the bug class it guarded is gone (e.g., a framework migration made it irrelevant).
2. **Demote first.** Move `error` → `warning` for a period; confirm nothing breaks and no incidents follow.
3. **Announce with rationale.** A short note in the config changelog: which rule, why, what (if anything) replaces it.
4. **Remove and clean up.** Delete the rule and, in the same change, run `--report-unused-disable-directives` / `RUF100` so now-dead suppressions for that rule get cleaned out rather than lingering as confusing clutter.

```bash
# After removing a rule, clean its stale suppressions org-wide
eslint . --fix --report-unused-disable-directives
ruff check . --fix --extend-select RUF100
```

Make removal *culturally* normal: celebrate cutting a low-value gate the way you'd celebrate adding a high-value one. A rule set that shrinks when rules stop earning their keep is a sign of a *healthy* governance process, not a falling bar.

---

## Real-World Examples

**The shared config that broke 200 repos.** A platform team shipped a new `error` rule directly to `@acme/eslint-config@latest` with no version pin and no rollout. Every repo on `latest` went red within an hour. The postmortem produced the now-standard pipeline: advise → measure → baseline → cohort gate, plus mandatory version pinning. The rule was fine; the rollout was the incident.

**Ruff consolidation saved a CI bill.** An org with ~300 Python repos each running Pylint + flake8 + isort moved to a single shared Ruff config. CI Python-lint minutes dropped ~95%, local runs became instant, and one config replaced three per-repo toolchains — a measurable infra-cost and DevEx win with no loss of real coverage.

**The rule nobody could remove.** A `max-lines-per-function` rule sat at 30% TPR for two years; everyone agreed it was noise, but removing it "felt like lowering standards." Instituting an explicit deprecation process broke the deadlock: demote, announce, remove, clean suppressions. Suppression density across the org fell noticeably afterward.

**Evidence ended a style war.** Two senior engineers fought for months over a naming convention rule, each invoking "best practice." The config owner required an RFC with TPR data; the rule turned out to fire mostly on legitimate domain terms (TPR ~35%). It went to the formatter's domain where it belonged, and the argument ended — settled by data, not seniority.

---

## Mental Models

- **The shared config is a product** with versions, customers, a changelog, and a support load — operate it like one.
- **Governance is the immune system.** Owner + process + evidence bar is what keeps the rule set from being colonized by preference.
- **Rollout is the safety device.** Advise → measure → baseline → cohort gate. Skipping it is skipping the seatbelt.
- **Removal is health, not retreat.** A set that can shrink is a set that's governed.
- **Goodhart watches your dashboard.** Optimize bugs-prevented-per-friction, not finding counts, or the metric gets gamed into meaninglessness.
- **Authority is borrowed.** The linter speaks only with the config owner's evidence behind it.

---

## Common Mistakes

- **Shipping a gate to `latest` with no pin and no rollout** — the classic org-wide CI outage.
- **A config with no owner**, so it grows by accretion and is maintained by no one.
- **No removal process**, so the rule set ratchets up forever and silts up with low-TPR noise.
- **Measuring finding counts** instead of TPR and bugs-prevented — inviting Goodhart gaming.
- **Silent per-repo forks** of the shared config, so drift becomes invisible and unmanageable.
- **Letting one person's taste become an org `error` rule** under cover of "the standard."
- **Ignoring lint latency** until teams fork the config purely to escape its slowness.

---

## Test Yourself

1. What three things must a governed shared rule set have, and why does "everyone owns it" fail?
2. Write the entry *and exit* criteria for adding a gating rule via RFC. Why do both matter?
3. Why pin the shared config version per repo instead of tracking `latest`?
4. Give the five-stage org rollout for a new `error` rule and the off-ramp at each stage.
5. Why is "10,000 lint warnings fixed" a weak value story to leadership, and what's a strong one?
6. How does the moral-authority anti-pattern get *worse* at org scale than in one repo?
7. Describe a clean rule-deprecation, including what you do about the now-stale suppressions.

---

## Cheat Sheet

```
Governance:   owner + change-process(by blast radius) + evidence bar + RFC for gates
Distribution: publish versioned shared config; pin per repo; overrides scoped+documented
Measure:      per-rule TPR (sampled), firing volume, suppression density, time-to-fix
Rollout:      advise -> autofix -> baseline -> cohort gate -> burn down  (off-ramp each stage)
Remove:       trigger -> demote -> announce -> delete + clean stale suppressions
```

```js
// Consume + override the shared config (ESLint flat)
import acme from "@acme/eslint-config";   // pinned: @acme/eslint-config@3
export default [...acme, { files:["scripts/**"], rules:{ "no-console":"off" } }];
```

| Anti-pattern | Antidote |
|---|---|
| Org-wide flip to `error` | staged cohort rollout |
| Rule set only grows | deprecation process |
| Finding-count metric | TPR + incident linkage |
| Taste as "the standard" | evidence-bar RFC, style → formatter |

---

## Summary

- At org scale the rule set is a **product**: versioned shared config, owner, changelog, customers, support load.
- **Govern it**: a named owner, a change process scaled to blast radius, an evidence bar, and RFCs for gating rules with both entry *and* exit criteria.
- **Distribute** via a published, version-pinned shared config repos extend; make overrides scoped and visible; measure adoption and drift.
- **Measure rule value** as per-rule TPR and incident linkage — not finding counts, which invite Goodhart gaming.
- **Roll out** every new gate in stages (advise → autofix → baseline → cohort gate → burn down), with an off-ramp at each.
- Keep lint **latency** an SLO and **removal** a normal, healthy act.
- Resist the institutionalized **moral-authority** trap: the linter has only the authority its owner justifies with evidence.

---

## Further Reading

- ESLint — *Shareable Configs* and flat-config composition.
- Ruff — config `extend` and org-wide configuration patterns.
- golangci-lint — distributing a canonical config; `new-from-rev` for org rollouts.
- *Software Engineering at Google* (Winters, Manshreck, Wright) — chapters on static analysis at scale (Tricorder) and large-scale change.
- Goodhart's law and metric-gaming literature, applied to engineering dashboards.

---

## Related Topics

- [Static Analysis in CI](../09-static-analysis-in-ci/) — the gating and orchestration mechanics this governance rides on.
- [Custom Lint Rules & AST](../07-custom-lint-rules-and-ast/) — building the org-specific rules your shared config ships.
- [Formatters](../02-formatters/) — the home for every style rule governance refuses to gate.
- [Type Checkers & Gradual Typing](../03-type-checkers-and-gradual-typing/) — another org-wide static-analysis program with the same rollout challenges.
- [Code Quality Metrics](../../code-quality-metrics/) — the measurement discipline (and Goodhart warnings) behind rule-value dashboards.
- [Code Review](../../code-review/) — the human gate the linter offloads work from, and where moral-authority dynamics also play out.
