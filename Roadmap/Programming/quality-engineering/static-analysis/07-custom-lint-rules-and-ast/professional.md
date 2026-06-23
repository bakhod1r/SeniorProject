# Custom Lint Rules & AST — Professional Level

> **Roadmap:** [Static Analysis](../README.md) → Custom Lint Rules & AST
> *Running an internal rules library as a product, executing API migrations across a monorepo with codemods, and defending the ROI of rule-writing as an org-level enforcement strategy.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 -- The Internal Rules Library as a Product](#core-concept-1----the-internal-rules-library-as-a-product)
5. [Core Concept 2 -- Distribution Across Many Repos](#core-concept-2----distribution-across-many-repos)
6. [Core Concept 3 -- The Contribution Model and Rule Lifecycle](#core-concept-3----the-contribution-model-and-rule-lifecycle)
7. [Core Concept 4 -- Large-Scale Codemod Migrations Across a Monorepo](#core-concept-4----large-scale-codemod-migrations-across-a-monorepo)
8. [Core Concept 5 -- OpenRewrite and Semantic Recipes](#core-concept-5----openrewrite-and-semantic-recipes)
9. [Core Concept 6 -- ROI: Rules vs. Architecture vs. Process](#core-concept-6----roi-rules-vs-architecture-vs-process)
10. [Core Concept 7 -- Governance, Ownership, and Avoiding Rule Sprawl](#core-concept-7----governance-ownership-and-avoiding-rule-sprawl)
11. [Core Concept 8 -- Measuring a Rules Program](#core-concept-8----measuring-a-rules-program)
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

> Focus: **treating custom rules and codemods as an org-wide platform — ownership, distribution, contribution, monorepo-scale migrations, and ROI.**

One engineer's clever Semgrep rule is a tool. Fifty rules enforced across forty repositories by three teams is a *product* — with owners, a release cycle, a contribution process, documentation, a deprecation policy, and a budget that must be justified. At this level the AST-matching skill is assumed; the work is organizational. The failure modes are no longer false positives in a single rule but **rule sprawl** (200 rules nobody owns), **fragmentation** (every repo runs a different rule set), and **negative ROI** (more engineer-hours spent maintaining rules than they save).

This page covers building the rules library as a product, distributing and versioning it across many repos, running large API migrations with codemods (jscodeshift, ast-grep, OpenRewrite), and the financial and architectural reasoning that decides *whether the rule should exist at all*.

---

## Prerequisites

**Required**

- Senior level: native analyzers, type-aware rules, testing, warn -> baseline -> error rollout, mechanism selection.
- Experience operating CI gates across multiple repos.
- Familiarity with package distribution in at least one ecosystem (npm, Go modules, Maven).

**Helpful**

- Having owned or used a shared internal tooling library.
- Exposure to a real cross-repo or monorepo API migration.

---

## Glossary

| Term | Meaning |
|---|---|
| Rules library | A versioned, distributed package of an org's custom rules. |
| Shared config | A linter config (e.g. ESLint `extends`, golangci config) consumed by many repos. |
| Codemod | A one-shot AST transform run to migrate code en masse. |
| OpenRewrite | A JVM framework for type-aware "recipes" that refactor code at scale. |
| Recipe | An OpenRewrite/codemod transformation, often composed of smaller ones. |
| Rule sprawl | Uncontrolled growth of low-value, unowned rules. |
| Pinning | Locking a repo to a specific rules-library version. |
| Soak / canary | Running a new rule in report-only mode on real traffic of PRs before enforcing. |
| ROI | Engineer-hours saved (review + bugs prevented) minus hours spent building/maintaining. |

---

## Core Concept 1 -- The Internal Rules Library as a Product

Stop thinking "I'll add a rule"; think "we ship a rules product." A product has:

- **An owner.** A named team (often Developer Productivity / Platform) accountable for the library's quality, not a random author per rule. Unowned rules rot.
- **A repository and release cycle.** Rules live in one versioned repo, released like any package, with a changelog and semver.
- **A test suite.** Every rule has valid/invalid fixtures (`RuleTester`, `analysistest`, Semgrep `--test`); the library's CI runs them all. A rule cannot merge without tests.
- **Documentation per rule.** Each rule's page states the *invariant it protects*, a bad and good example, *why* it exists (the incident or convention behind it), and how to suppress it legitimately. Diagnostics link to this page.
- **A severity and maturity ladder.** Rules carry a status: `experimental` (warn, opt-in), `stable` (warn everywhere), `enforced` (error). Promotion is a deliberate decision, not a default.

The product framing forces the right discipline: a rule with no owner, no test, and no "why" doesn't ship.

---

## Core Concept 2 -- Distribution Across Many Repos

Forty repos must not each copy-paste rules; they consume a versioned dependency. Mechanism per ecosystem:

```text
JS/TS    publish @acme/eslint-config + @acme/eslint-plugin to the registry;
         repos do:  extends: ["@acme"]    (one line, all rules)

Go       publish a golangci-lint config + a module of analyzers;
         repos reference a shared .golangci.yml (or a custom plugin build)

Semgrep  publish rules to a registry / git repo; repos run:
           semgrep --config "git+ssh://.../semgrep-rules"   (or the Semgrep AppSec platform)

Java     publish OpenRewrite recipes / Error Prone checks as Maven artifacts
```

**Centralized vs. pinned** is the core tension:

- **Centralized (rolling):** repos always pull the latest rules. New rules reach everyone instantly — but a bad rule breaks forty builds at once.
- **Pinned (versioned):** repos pin a rules version and upgrade deliberately. Safer, but rules drift; some repo is always two years behind.

The mature answer is **pinned with a fast, automated upgrade path**: a bot (Renovate/Dependabot-style) opens the bump PR everywhere, and new rules land as **warnings** first so an upgrade can't redden a build. You get controlled rollout *and* convergence.

> Monorepos sidestep distribution (one config, one version) but amplify blast radius — a bad rule there breaks *everything* in one commit, so the soak/canary discipline matters even more.

---

## Core Concept 3 -- The Contribution Model and Rule Lifecycle

A rules library that only its owning team can extend becomes a bottleneck; one anyone can extend without review becomes sprawl. The working model is **federated contribution, central curation**:

```text
PROPOSE   author files a short RFC: the invariant, why a RULE (not a type/
          wrapper/doc), bad+good examples, expected false-positive rate.
          Reviewed against the "should this be a rule?" bar (senior page).

BUILD     author writes rule + tests + doc. Owning team reviews for
          correctness, performance, false-positive risk, message quality.

SOAK      ships as `experimental` (warn, often opt-in). Run on real PRs;
          measure firing rate and suppression rate for N weeks.

PROMOTE   if FP rate is low and value is real -> `stable` (warn everywhere).
          Burn down the backlog with a codemod -> `enforced` (error).

DEPRECATE rules expire too: when the underlying API is gone, or the rule's
          superseded by a type/architecture change, remove it. A graveyard
          of dead rules slows every CI run for nothing.
```

The deprecation step is the one most orgs skip and the reason rule sets balloon. Rules have a lifecycle that ends; budget for retirement.

---

## Core Concept 4 -- Large-Scale Codemod Migrations Across a Monorepo

Migrating an API across thousands of files is the headline use of AST transforms at scale. Anatomy of a real migration — say, renaming `oldClient.fetch(url, opts)` to `httpClient.get(url, { ...opts })` across a TS monorepo:

```text
1. SCOPE     count call sites:  ast-grep --pattern 'oldClient.fetch($$$)' --lang ts
             know the blast radius before writing anything.

2. WRITE     a codemod that handles the common shapes; log/skip the weird ones.
             jscodeshift for complex JS/TS; ast-grep for pattern->pattern;
             gofmt -r for simple Go; comby for language-agnostic shapes.

3. DRY-RUN   run without -w; review the diff on a sample of packages.
             measure the un-migrated remainder (the long tail of odd call sites).

4. SHARD     apply per-package / per-team, not one 50k-line PR. One reviewable
             PR per owner; codeowners review their own slice.

5. RESIDUE   hand-fix the long tail the codemod couldn't safely transform.

6. LOCK      ship a lint rule banning oldClient.fetch so it can't come back.
             this is the codemod->rule handoff: migrate the past, guard the future.
```

```js
// jscodeshift: oldClient.fetch(url, opts) -> httpClient.get(url, opts)
module.exports = (file, api) => {
  const j = api.jscodeshift;
  return j(file.source)
    .find(j.CallExpression, {
      callee: { object: { name: "oldClient" }, property: { name: "fetch" } },
    })
    .forEach((p) => {
      p.node.callee.object.name = "httpClient";
      p.node.callee.property.name = "get";
    })
    .toSource();
};
```

```bash
# ast-grep equivalent for the simple case, with a dry run first
ast-grep --pattern 'oldClient.fetch($U, $O)' \
         --rewrite 'httpClient.get($U, $O)' --lang ts        # dry-run (prints diff)
ast-grep --pattern 'oldClient.fetch($U, $O)' \
         --rewrite 'httpClient.get($U, $O)' --lang ts -U      # apply
```

The non-negotiables: **dry-run and review before applying**, **shard into owner-sized PRs**, and **end with a lint rule** so the migration is permanent.

---

## Core Concept 5 -- OpenRewrite and Semantic Recipes

For the JVM, plain pattern codemods aren't enough — Java migrations need *type-aware* transforms (resolve the actual method being called, manage imports, respect generics). **OpenRewrite** is the industry tool: it parses to a Lossless Semantic Tree (preserves formatting *and* carries type info) and applies composable **recipes**.

```bash
# Apply a recipe (e.g. a framework upgrade) via the Maven plugin
mvn org.openrewrite.maven:rewrite-maven-plugin:run \
    -Drewrite.activeRecipes=org.openrewrite.java.migrate.UpgradeToJava21
```

Why it matters at scale: OpenRewrite ships *maintained* recipes for huge migrations (Spring Boot major versions, JUnit 4->5, Java LTS upgrades) that thousands of orgs reuse — you don't hand-write the codemod, you run a vetted recipe and review the diff. It's the difference between a bespoke jscodeshift script and a packaged, type-aware, organization-grade migration. The same lossless-tree idea drives `ast-grep` and `comby` for other languages; OpenRewrite is the most mature *semantic* (type-resolving) variant.

---

## Core Concept 6 -- ROI: Rules vs. Architecture vs. Process

Every rule has an ongoing cost (maintenance, CI time, false-positive friction, cognitive load) and must be justified against alternatives. The senior page asked "can a type make this impossible?"; at this level you quantify it.

```text
ROI(rule) = (review-hours saved + bugs/incidents prevented) - (build + maintain + friction)
```

A rule wins the ROI argument when:

- The violation **recurs often** (high review-hours saved) — a once-a-year mistake isn't worth a rule.
- The violation is **valid code no type/API can forbid** (architecture can't help).
- The **false-positive rate is near zero** (friction stays low).

A rule *loses* to alternatives when:

- **A type/newtype/wrapper makes it impossible** -> architectural enforcement; zero ongoing rule cost, no bypass. Prefer it every time it's feasible.
- **A module-boundary tool already does it** (`depguard`, `import-linter`, Nx boundaries) -> use the off-the-shelf mechanism, don't reinvent.
- **It's truly a one-off** -> a review comment costs nothing; a rule costs forever.

> The org-level mistake is treating rules as free. Forty rules at five minutes of CI and a 3% false-positive rate is a real, recurring tax. The platform team's job is to keep the rule set *as small as possible while covering the invariants that matter* — and to push constraints down into types and APIs wherever they fit, because those are cheaper and unbypassable.

---

## Core Concept 7 -- Governance, Ownership, and Avoiding Rule Sprawl

Sprawl is the dominant failure mode of a successful rules program. Controls that keep it healthy:

- **A bar for admission.** The RFC must show the rule beats a type/wrapper/comment and clears a false-positive threshold. No bar -> 200 pet rules.
- **An owner per rule (or per rule group).** Orphaned rules are deleted on a schedule, not kept "just in case."
- **A suppression budget.** Track suppression rate per rule; anything chronically suppressed is mis-scoped — fix or retire it. High aggregate suppression means the team has learned to ignore the linter, which is worse than no linter.
- **Performance budget.** Total lint time is a CI SLO; a rule that blows it must be optimized or cut.
- **A deprecation policy.** Rules tied to retired APIs are removed; the set is pruned every cycle.
- **Escape hatches with accountability.** `// nolint:rule // reason: <link>` requires a justification; a global disable requires owner sign-off.

The governing principle: **the rule set is a curated product with a quality bar, not an append-only log of everyone's preferences.**

---

## Core Concept 8 -- Measuring a Rules Program

You manage what you measure. The metrics that matter for a rules library:

- **Findings prevented (pre-merge).** Violations caught before merge — the rule's gross value.
- **False-positive / suppression rate per rule.** The health signal; rising = trust eroding.
- **Mean time from incident to enforced rule.** How fast a new class of bug becomes prevented org-wide.
- **Lint wall-clock time** as a share of CI — the cost side.
- **Adoption / version lag.** How many repos run the current rules version (convergence).
- **Codemod coverage on migrations.** % of call sites auto-migrated vs. hand-fixed — measures codemod maturity.

Report these like any platform product. A rule whose findings have dropped to near zero has done its job and may be promoted to a type/architecture constraint or retired; a rule with a climbing suppression rate is failing and needs intervention.

---

## Real-World Examples

- **Airbnb/Meta-scale ESLint configs.** Shared `eslint-config` packages consumed across hundreds of repos via `extends` — distribution as a product.
- **OpenRewrite framework upgrades.** Orgs run packaged recipes to move thousands of services across Spring Boot / Java LTS versions with reviewable, type-aware diffs.
- **Google's Tricorder / Error Prone.** Custom Java checks delivered at monorepo scale with strict false-positive budgets and a "not useful" feedback button feeding rule curation — measurement built into the program.
- **Semgrep AppSec platform.** Central rule management, baselines, and per-repo rollout — the rules-as-product pattern for security, overlapping [SAST Security Scanners](../04-sast-security-scanners/) and [Taint & Dataflow Analysis](../08-taint-and-dataflow-analysis/).

---

## Mental Models

- **Rules are a product, not a pile.** Owner, tests, docs, versioning, deprecation — or it rots.
- **Pinned + auto-bump + warn-first** beats both rolling and frozen distribution.
- **Codemod the past, lint the future.** Every migration ends with a guard rule; every guard rule on a populated codebase starts with a codemod.
- **A type beats a rule; a rule beats a comment.** Push constraints down the cheapness ladder whenever feasible.
- **Sprawl is the enemy of a successful program.** The win condition is the *smallest* rule set covering the invariants that matter.
- **Measure findings prevented and suppression rate.** Value and health, reported like any platform.

---

## Common Mistakes

- **Treating rules as free.** Ignoring CI-time, false-positive friction, and maintenance; ending with 200 unowned rules.
- **Copy-pasting rules per repo.** No shared library, instant fragmentation, no way to fix a rule everywhere.
- **Rolling distribution with no soak.** A bad rule reddens forty builds simultaneously.
- **One giant migration PR.** A 50k-line codemod PR nobody can review; shard by owner.
- **Applying a codemod without a dry-run.** Silent bad rewrites across the monorepo.
- **No deprecation policy.** Dead rules for retired APIs slow every CI run forever.
- **Building a rule a type could enforce.** Paying perpetual rule cost for a compile-time-preventable mistake.
- **No metrics.** Can't tell which rules earn their keep or which the team has quietly started ignoring.

---

## Test Yourself

1. What five things turn "a rule" into "a rules product"?
2. Compare rolling vs. pinned distribution. What hybrid resolves the tension and why?
3. Lay out a monorepo API migration from scope to lock. Why does it end with a lint rule?
4. Why is OpenRewrite preferred over a plain pattern codemod for Java migrations?
5. Write the ROI inequality for a rule and name two cases where a rule loses to architecture.
6. A rules library has grown to 180 rules; CI lint time has doubled and aggregate suppression is 18%. What's wrong and what governance do you introduce?
7. Which metrics tell you a rule has succeeded and should be promoted-out or retired?

---

## Cheat Sheet

```text
RULES LIBRARY AS PRODUCT
  owner + repo + semver + test suite + per-rule doc(why) + maturity ladder
  ladder: experimental(warn,opt-in) -> stable(warn) -> enforced(error) -> deprecated

DISTRIBUTION
  JS:  publish @acme/eslint-config|plugin; repos: extends ["@acme"]
  Go:  shared .golangci.yml + analyzer module
  Semgrep: rules in git/registry; --config git+...
  Java: OpenRewrite recipes / Error Prone as Maven artifacts
  pinned + auto-bump-bot + new-rules-as-WARN   (controlled + convergent)

CONTRIBUTION  propose(RFC: why a rule?) -> build+tests+doc -> soak(experimental)
              -> promote(codemod backlog -> enforced) -> deprecate(retire dead rules)

MONOREPO MIGRATION  scope -> write codemod -> DRY-RUN+review -> shard per owner
                    -> hand-fix residue -> LOCK with a lint rule
  ast-grep --pattern 'old($A)' --rewrite 'new($A)' --lang ts [-U]
  jscodeshift -t t.js src/      gofmt -r 'old(a)->new(a)' -w     comby ...
  OpenRewrite (JVM, type-aware): mvn rewrite:run -Drewrite.activeRecipes=...

ROI  (review-hrs saved + incidents prevented) - (build + maintain + FP friction)
  rule LOSES to: a type/newtype/wrapper (impossible>flagged), depguard, a one-off comment

GOVERNANCE  admission bar | owner per rule | suppression budget | perf budget |
            deprecation policy | accountable escape hatches
METRICS  findings prevented | suppression rate | incident->enforced time |
         lint %CI | version lag | codemod coverage
```

---

## Summary

At org scale, custom rules become a product: owned by a platform team, versioned and distributed (ESLint configs, golangci configs, Semgrep registries, OpenRewrite/Error Prone artifacts), tested and documented per rule, with a maturity ladder and — crucially — a deprecation policy. Distribution favors pinned versions with an automated bump bot and new-rules-as-warnings, getting controlled rollout and convergence. Large API migrations run as codemods (jscodeshift, ast-grep, gofmt -r, comby; OpenRewrite for type-aware JVM recipes): scope, write, dry-run, shard per owner, hand-fix the tail, and lock with a guard rule — codemod the past, lint the future. The financial and architectural reasoning dominates: rules cost CI time, maintenance, and false-positive friction forever, so the platform team keeps the set minimal, pushes constraints down into types and wrapper APIs whenever they make the wrong code impossible rather than merely flagged, governs against sprawl, and measures findings prevented against suppression rate to know which rules earn their keep.

---

## Further Reading

- *OpenRewrite* docs and recipe catalogue (docs.openrewrite.org) — type-aware migrations at scale.
- *Lerna/Nx and shared ESLint config* patterns; *Renovate* for automated rules-version bumps.
- *Google — Lessons from Building Static Analysis Tools at Google* (Tricorder/Error Prone; false-positive budgets, developer feedback).
- *Semgrep AppSec Platform* docs — central rule management and rollout.
- *jscodeshift* and *ast-grep* docs — programmatic and pattern-based codemods.
- The `refactoring-techniques` skill — the catalog of behaviour-preserving transforms underpinning safe codemods.

---

## Related Topics

- [Linters & Style Checkers](../01-linters-and-style-checkers/) — the shared-config delivery layer.
- [SAST Security Scanners](../04-sast-security-scanners/) — security rules managed as the same kind of product.
- [Taint & Dataflow Analysis](../08-taint-and-dataflow-analysis/) — the deeper analyses your platform rules graduate into.
- [Static Analysis in CI](../09-static-analysis-in-ci/) — gating, baselines, and the CI-time budget your rules spend.
- [Dependency & License Scanning](../06-dependency-and-license-scanning/) — another centrally-governed, cross-repo policy program.
