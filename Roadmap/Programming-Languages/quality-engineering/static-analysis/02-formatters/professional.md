# Formatters — Professional Level

> **Roadmap:** [Static Analysis](../README.md) → Formatters
> *At org scale the formatter is no longer a tool you install — it's a policy you govern. One config, distributed to every repo. One upgrade, coordinated across hundreds of services. One cultural axiom — "style is solved, formatting is not negotiable" — that quietly removes an entire category of human conflict. This page is about owning formatting as platform infrastructure.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Shared Config Across a Monorepo or Org](#core-concept-1--shared-config-across-a-monorepo-or-org)
5. [Core Concept 2 — Governing Formatter Versions at Scale](#core-concept-2--governing-formatter-versions-at-scale)
6. [Core Concept 3 — "Style Is Solved, Formatting Is Not Negotiable"](#core-concept-3--style-is-solved-formatting-is-not-negotiable)
7. [Core Concept 4 — Monorepo Orchestration: Many Languages, One Gate](#core-concept-4--monorepo-orchestration-many-languages-one-gate)
8. [Core Concept 5 — Large-Diff Review Hygiene as Org Policy](#core-concept-5--large-diff-review-hygiene-as-org-policy)
9. [Core Concept 6 — Generated, Vendored, and Polyglot Edge Cases](#core-concept-6--generated-vendored-and-polyglot-edge-cases)
10. [Core Concept 7 — Migrating an Org and Measuring the Win](#core-concept-7--migrating-an-org-and-measuring-the-win)
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

> Focus: **Formatting as governed platform infrastructure — one shared config across many repos, coordinated version upgrades at scale, the cultural axiom that ends style debate org-wide, and orchestrating a polyglot monorepo behind a single gate.**

A senior engineer operates a formatter on one codebase. A staff/principal engineer or platform team operates it across *all* of them — dozens to thousands of repos, multiple languages, hundreds of contributors who have never met. At that scale every problem from the senior page multiplies: a version mismatch isn't one annoyed developer, it's a hundred; a bad upgrade isn't one ugly PR, it's a coordinated migration across every service.

The professional concerns are governance concerns. **Shared config**: how does one canonical formatting policy reach every repo without being copy-pasted and drifting? **Version governance**: how do you roll a Black or Prettier major upgrade across the whole org without each team doing it badly and independently? **Cultural enforcement**: how do you make "the formatter decides" an org-wide axiom rather than a per-team negotiation, so the bikeshedding never even starts? **Monorepo orchestration**: how do many languages sit behind one fast, coherent gate?

The deepest professional insight is that formatting, done right, is *invisible and load-bearing at once* — like the build system or the package registry. Nobody thinks about it, and that's the win. Your job is to build and govern the infrastructure that makes formatting a non-event, then point at the conflict it permanently eliminated as one of the highest-leverage, lowest-cost wins in the whole quality toolchain.

---

## Prerequisites

- **Required:** [Senior Level](senior.md) — CI enforcement, version pinning, legacy adoption, blame hygiene, generated/vendored handling.
- **Required:** You've operated CI/CD and dependency management across more than one repository.
- **Required:** Familiarity with at least one monorepo or multi-repo distribution mechanism (shared config packages, renovate/dependabot, base CI templates).
- **Helpful:** [09 — Static Analysis in CI](../09-static-analysis-in-ci/professional.md) — org-wide gate governance this slots into.
- **Helpful:** Experience driving a cross-team technical migration.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Shared config package** | A versioned, installable package holding the canonical formatter config, consumed by every repo. |
| **Config drift** | Repos slowly diverging because each has its own copy of the config that gets edited locally. |
| **Renovate / Dependabot** | Bots that open PRs to bump pinned dependency versions — including formatters — automatically. |
| **Polyglot** | A codebase with many languages, each needing its own formatter. |
| **Orchestrator** | A tool (Spotless, Trunk, pre-commit, mega-linter) that runs many formatters behind one interface. |
| **Toolchain pin** | Locking the *language toolchain* version (Go, Rust) so the bundled formatter is fixed too. |
| **Governance** | The org process for deciding, distributing, and upgrading the formatting policy. |
| **Annual style migration** | Black's model of batching style changes into a yearly, opt-in release. |

---

## Core Concept 1 — Shared Config Across a Monorepo or Org

The enemy at scale is **config drift**: every repo has its own `.prettierrc`, someone tweaks one, and now your "consistent" org has fifty subtly different styles. The fix is to distribute the config as a *single versioned artifact* that repos *consume* rather than *copy*.

**Prettier** supports this natively — publish a shared config as an npm package and reference it:

```jsonc
// @acme/prettier-config (published package) -> index.json
{ "printWidth": 100, "singleQuote": true, "trailingComma": "all" }
```
```jsonc
// each repo's package.json — consume, don't copy
{ "prettier": "@acme/prettier-config" }
```

Now there is exactly *one* place the org's JS/TS style is defined. Bumping `@acme/prettier-config` updates every repo that picks up the new version. No drift, because no repo holds its own copy.

**Other ecosystems:**
- **Black/Ruff:** distribute a shared `pyproject.toml` fragment or a base config repo; Ruff supports `extend` to inherit from a base config file.
- **clang-format:** a single `.clang-format` at the monorepo root applies to all subtrees; for multi-repo, vendor it via a shared tooling repo or git submodule.
- **gofmt/rustfmt:** little to share (they're option-free), but pin the *toolchain version* org-wide so the bundled formatter is identical everywhere.
- **Spotless (Java/polyglot):** define the formatting config in a shared Gradle convention plugin that every module applies.

```kotlin
// buildSrc convention plugin: every module gets the same Spotless config
spotless {
    java { googleJavaFormat("1.22.0") }   // version pinned centrally
}
```

> **The governance rule:** *config is consumed, never copied.* A grep across the org for hand-edited `.prettierrc` files is a drift audit. Every one you find is a future inconsistency. Centralize the source of truth and make repos reference it by version.

---

## Core Concept 2 — Governing Formatter Versions at Scale

On one repo you pin a version. Across an org you must *roll versions forward coherently*, because a formatter major bump is a synchronized reformat-the-world event — and you don't want a hundred teams each discovering that independently.

The professional pattern has three parts:

**1. Pin centrally, bump centrally.** Because the config (and thus the version) lives in a shared package, you bump the version *once* in the shared artifact. Renovate/Dependabot then opens a version-bump PR in every consuming repo automatically.

```jsonc
// renovate.json — auto-PR formatter bumps, grouped, but NOT auto-merged
{
  "packageRules": [{
    "matchPackageNames": ["@acme/prettier-config", "prettier", "black"],
    "groupName": "formatter upgrades",
    "automerge": false   // formatter bumps reformat code — a human must review
  }]
}
```

**2. Each bump PR is a reformat PR.** Because the new version is a new function, its bump PR will include the reformatting churn for that repo. Each team reviews it the senior way: confirm it's pure formatting (`git diff -w`), confirm CI passes, add the SHA to that repo's `.git-blame-ignore-revs`, merge. The platform team can supply a script that does the reformat + ignore-rev step so teams don't get it wrong.

**3. Time it and communicate it.** Announce the upgrade window. Tell teams with long-lived branches to merge or rebase first (they'll hit conflicts across the reformat). For Black specifically, the **annual style migration** model is a gift — style changes batch into one yearly release you can plan around, rather than dribbling in.

> **The anti-pattern this prevents:** without central governance, repos drift across versions for years. Repo A is on Prettier 2, repo B on Prettier 3, a developer moves a shared file between them, and it reformats on every cross-repo move. Coherent version governance — one pinned version, rolled forward together — keeps the *whole org* at a single fixed point.

---

## Core Concept 3 — "Style Is Solved, Formatting Is Not Negotiable"

This is the cultural keystone, and at the professional level it's an *explicit org axiom*, written down, not just folklore.

The axiom has two halves:

- **"Style is solved"** — the formatter has already decided. There is no open question about layout. New hires don't get a vote; teams don't get a local dialect. The decision was made once, centrally, and it's done.
- **"Formatting is not negotiable"** — the CI gate is non-bypassable for a reason. Formatting is *infrastructure*, like the build passing or the tests being green. You don't argue with a green checkmark; you make it green.

Writing this into the engineering handbook does real work. It preempts the recurring conversations — the new senior hire who "strongly prefers" tabs, the team that wants its own `.prettierrc`, the PR thread relitigating quote style. The answer to all of them is a one-line pointer to the axiom: *style is solved; here's the shared config; the gate is not negotiable.* The conversation ends before it consumes anyone's afternoon.

The payoff to *measure and broadcast* (it justifies the platform team's existence):

- **Zero formatting comments in code review.** Reviewers spend their attention on logic, design, and correctness — never on layout. This is a large, recurring saving across every review in the org.
- **Every diff is pure logic churn.** Because everything is always formatted, no diff ever contains layout noise. Review quality goes up across the board.
- **One fewer axis of conflict.** Formatting wars are a real, recurring source of friction between teams and individuals. Removing the *possibility* of the argument is a morale and velocity win that's hard to overstate and easy to forget you bought.

> **Frame it as a *gift*, not a *mandate*.** "We took away your formatting choices" lands badly. "We permanently ended formatting arguments and gave you back every review minute you ever spent on whitespace" lands as the relief it actually is. The naming-conventions skill covers the *style* decisions that remain genuinely human (and which the formatter does *not* make) — keep that distinction crisp so people don't think the tool decides naming too.

---

## Core Concept 4 — Monorepo Orchestration: Many Languages, One Gate

A real monorepo has Go, TypeScript, Python, protobuf, SQL, Markdown, and YAML in one tree. You don't want seven separate, inconsistently-configured CI jobs. You want **one orchestrator** presenting a single `format` and `format --check` interface across all of them.

Options:

- **`pre-commit` (the framework):** language-agnostic, runs each formatter on its file types, scopes to changed files automatically. The de-facto standard for polyglot local hooks.
- **Trunk / mega-linter:** managed orchestrators that bundle dozens of formatters/linters with version pinning and caching, behind one config.
- **Spotless:** if you're build-centric (Gradle/Bazel), it runs all formatters as a build step with `spotlessCheck`/`spotlessApply`.
- **Make/Just target:** the low-tech option — a single `make fmt` and `make fmt-check` that fans out to each tool.

```yaml
# .pre-commit-config.yaml — one file, every language, scoped to changed files
repos:
  - { repo: https://github.com/psf/black,                rev: 24.4.2,  hooks: [{id: black}] }
  - { repo: https://github.com/astral-sh/ruff-pre-commit, rev: v0.4.4, hooks: [{id: ruff, args: [--fix]}] }
  - { repo: https://github.com/pre-commit/mirrors-prettier, rev: v4.0.0, hooks: [{id: prettier}] }
  - { repo: https://github.com/dnephin/pre-commit-golang, rev: v0.5.1,  hooks: [{id: go-fmt}] }
```

```makefile
# A single check target the CI gate calls — one entry point for the whole tree
fmt-check:
	gofmt -l . | (! grep .)
	ruff format --check .
	prettier --check .
	cargo fmt --check
```

The orchestration goals: **one command for engineers** (`make fmt`), **one gate for CI** (`make fmt-check`), **central version pins** for every tool, and **changed-file scoping** so the monorepo's size doesn't make the gate slow. The CI-side performance and gate-governance details are in [09 — Static Analysis in CI](../09-static-analysis-in-ci/professional.md).

---

## Core Concept 5 — Large-Diff Review Hygiene as Org Policy

The senior page made splitting churn from logic a personal discipline. At the professional level it's an *enforced policy* with tooling support, because at org scale you can't rely on every contributor remembering it.

Codify it:

- **Mark bulk-format PRs.** Require a label like `formatting-only` or a conventional-commit prefix (`chore(format):`) so reviewers and tooling can recognize and fast-track pure-churn PRs.
- **Automate the blame-ignore step.** Provide a script or bot that, when a `formatting-only` PR merges, appends its SHA to `.git-blame-ignore-revs` automatically. Manual steps get forgotten across an org.
- **Collapse generated/format diffs in review.** Use `.gitattributes` (`linguist-generated=true`) and the host's diff-collapse settings so reviewers never wade through machine-owned lines.
- **Make `git diff -w` the standard reviewer move** and document it. Some hosts (GitHub) also offer a "hide whitespace" toggle in the diff UI — point people at it.
- **Forbid drive-by reformatting in feature PRs** via review guidelines. Because the org is fully gated, files are already formatted, so there's nothing to drive-by-format — the policy is mostly self-enforcing once adoption is complete.

> **The reviewability dividend compounds.** Every one of these measures protects the scarcest resource in the org: reviewer attention. A formatting policy that keeps churn out of logic diffs raises the quality of *every* review, on every team, forever. It's one of the highest-leverage process investments available, and it costs almost nothing once the infrastructure exists.

---

## Core Concept 6 — Generated, Vendored, and Polyglot Edge Cases

At org scale the generated/vendored handling from the senior page becomes a set of standardized conventions, plus some genuinely hard polyglot cases.

**Standardize exclusions org-wide.** Ship a canonical ignore list (generated dirs, `vendor/`, `node_modules/`, build outputs) as part of the shared config, so every repo excludes the same things. A repo that forgets to exclude its `generated/` directory creates churn wars; centralizing the exclude list prevents that.

**Generated code that humans read.** The clean rule remains: *the producer owns the formatting.* If protobuf output is reviewed in PRs, run the formatter *inside the codegen step* (`protoc` → `gofmt`), so the committed output is already canonical and your repo-wide gate can safely ignore it. Never let two pipelines (generator and formatter) both own the same file.

**Polyglot edge cases that bite:**
- **Embedded languages.** SQL in Python strings, GraphQL in JS template literals, HTML in components. Prettier has plugins for some embedded formatting; decide deliberately whether to format embedded blocks or leave them, and apply that decision org-wide.
- **Files multiple tools claim.** A `.ts` file with embedded CSS, or a Markdown file with code fences. Decide the owner per file type; don't let two formatters reformat the same bytes.
- **Files no formatter owns.** Bespoke config formats, DSLs. Either accept they're hand-formatted (and *don't* gate them) or write a custom formatter — but don't half-gate them, which just produces confusing failures.

> **The principle that resolves all of these:** *every file has exactly one formatting owner, or none.* One owner = gated and auto-formatted. No owner = explicitly excluded and hand-maintained. The failure mode is *two* owners (a diff war) or an *ambiguous* owner (intermittent CI failures nobody can explain). Make ownership explicit in the config.

---

## Core Concept 7 — Migrating an Org and Measuring the Win

Rolling formatting across an entire org is a migration program, run like one.

**Sequence:**
1. **Decide the canonical tools and config centrally** (one per language). Publish the shared config package.
2. **Pilot on 2–3 willing repos.** Shake out the giant-commit, blame-ignore, and CI-gate playbook on low-risk teams.
3. **Provide a turnkey playbook + script.** Teams should run *one command* to: add the shared config, run the giant format commit, write the blame-ignore SHA, and enable the gate (warn → block). Don't make each team reinvent the senior-level procedure.
4. **Roll out in waves**, not all at once — so support load is manageable and you can fix the playbook between waves.
5. **Flip gates to blocking** per repo as each finishes its giant commit.
6. **Automate ongoing version bumps** via Renovate against the shared config.

**Measure the win** so the program is defensible:
- **Formatting-related review comments → ~0** (sample before/after).
- **CI formatting-gate failure rate** trends down as save/hook adoption rises (a *high* sustained failure rate means editor integration isn't landing — fix the onboarding, not the gate).
- **Whitespace-only diff lines in feature PRs → ~0**, measurable via `git diff -w`.
- **Qualitative:** "we no longer argue about formatting" in developer surveys.

> **What "done" looks like:** formatting is invisible. No one mentions it, no one configures it (it comes from the shared package), no one argues about it (the axiom settled it), and every diff is pure logic. The platform team's success metric is *silence* — the absence of the entire category of problem.

---

## Real-World Examples

**1. Drift discovered by audit.** A platform team grepped the org for hand-edited `.prettierrc` files and found 60+, with 11 distinct configs. They migrated everyone to a single `@acme/prettier-config` npm package, deleted the local copies, and a Renovate rule now keeps every repo on the same version. Cross-repo file moves stopped reformatting.

**2. The coordinated Black 24 upgrade.** Rather than 80 teams each upgrading badly, the platform team bumped the shared config, Renovate opened a grouped, non-automerge PR in each repo, and a supplied script did the reformat + blame-ignore step. The whole org moved to the new style in two weeks with readable blame intact.

**3. The handbook line that ended a quarterly argument.** A staff engineer added "Style is solved; formatting is not negotiable; config lives in `@acme/*`-config; the gate is non-bypassable" to the engineering handbook. The recurring per-team "can we use our own style?" thread stopped appearing — the answer was now a one-line link.

---

## Mental Models

- **Config is a published artifact, not a file.** Repos *consume* a versioned config; they never *own* a copy. Drift is impossible if there's only one source.
- **A version bump is an org-wide event.** One pinned version, rolled forward together, keeps the whole org at one fixed point. Drift across versions is the failure.
- **The axiom does the work.** "Style is solved, formatting is not negotiable" preempts the argument so it never consumes anyone's time.
- **One gate, many languages.** An orchestrator presents `fmt` / `fmt --check` for the whole polyglot tree.
- **Every file has one owner or none.** Two owners = diff war; ambiguous owner = flaky CI. Make ownership explicit.
- **Success is silence.** When formatting is invisible and unmentioned, the platform team has won.

---

## Common Mistakes

- **Copy-pasting config into every repo.** Guarantees drift. Publish and consume a versioned config instead.
- **Letting versions drift across the org.** Cross-repo moves reformat; teams upgrade independently and badly. Govern versions centrally.
- **Treating the cultural axiom as folklore.** Write it in the handbook. Unwritten norms get relitigated by every new hire.
- **Auto-merging formatter version bumps.** They reformat code — a human must review the churn and add the blame-ignore SHA. Never automerge.
- **Seven inconsistent CI jobs in a monorepo.** Use one orchestrator with one `fmt-check` entry point and central pins.
- **Forgetting the blame-ignore step at scale.** Automate it on `formatting-only` merges; manual steps are forgotten org-wide.
- **Ambiguous formatting ownership of a file type.** Two tools fighting, or none and intermittent failures. Assign exactly one owner or explicitly none.
- **Selling it as a mandate.** "We removed your choices" breeds resistance. Frame it as the relief it is: arguments ended, review minutes returned.

---

## Test Yourself

1. How do you distribute one canonical Prettier config to 100 repos without drift? What's the equivalent for Black? For gofmt?
2. Why must org-wide formatter version bumps *not* be auto-merged, even though they're "just a version bump"?
3. State the two halves of "style is solved, formatting is not negotiable" and what each one preempts.
4. You run a polyglot monorepo (Go + TS + Python + proto). Design the single-gate orchestration.
5. A file type has two formatters that both reformat it. What's the principle that resolves this, and the two valid resolutions?
6. What three metrics show your org-wide formatting program succeeded? What does a *high* CI gate-failure rate actually tell you?
7. Why is "success is silence" the right success metric for a formatting platform?

---

## Cheat Sheet

```bash
# --- Shared config: consume, never copy ---
# package.json:  "prettier": "@acme/prettier-config"
# ruff.toml:     extend = "../../shared/ruff-base.toml"
# Spotless:      googleJavaFormat in a buildSrc convention plugin
# gofmt/rustfmt: pin the TOOLCHAIN version org-wide (go.mod, rust-toolchain.toml)

# --- Drift audit ---
# find every hand-rolled local config (each is future drift)
find . -name '.prettierrc*' -not -path '*/node_modules/*'

# --- Governed version bumps (renovate.json) ---
# group formatter bumps, automerge:false (humans review reformatting churn)

# --- One gate, many languages (the entry point CI calls) ---
make fmt-check     # fans out to gofmt -l / ruff format --check / prettier --check / cargo fmt --check

# --- Org migration per repo (turnkey script does all of this) ---
#  add shared config -> giant format commit -> SHA into .git-blame-ignore-revs -> gate warn->block
```

| Scale problem | Professional move |
|---|---|
| Config drift across repos | Published, versioned, consumed config |
| Independent bad upgrades | Central pin + grouped Renovate PRs |
| Recurring style arguments | Written org axiom |
| Polyglot CI sprawl | One orchestrator, one gate |
| Forgotten blame-ignore | Automate on `formatting-only` merge |
| Ambiguous file ownership | Exactly one owner, or explicitly none |
| Proving the win | Zero format comments / pure-logic diffs |

---

## Summary

- At org scale, formatting is **governed platform infrastructure**, not a per-repo tool.
- Distribute **one versioned, consumed config** (npm config package, shared `pyproject`/`ruff` base, central Spotless plugin, pinned toolchains) — *consume, never copy* — to kill drift.
- **Govern versions centrally**: one pin, rolled forward together via grouped, human-reviewed Renovate PRs (never automerge — they reformat code).
- Make **"style is solved, formatting is not negotiable"** a written org axiom; it preempts the entire bikeshed and is best framed as a *gift* (arguments ended, review minutes returned), not a mandate.
- Orchestrate the **polyglot monorepo behind one gate** (`pre-commit`/Spotless/Trunk/Make) with central pins and changed-file scoping.
- Enforce **large-diff review hygiene** as policy: label format-only PRs, automate the blame-ignore step, collapse generated diffs, standardize `git diff -w`.
- Give **every file exactly one formatting owner or none**; resolve generated/vendored/embedded edge cases by making ownership explicit.
- Run org adoption as a **migration program** with a turnkey playbook, and **measure the win** — the ultimate success metric is *silence*.

---

## Further Reading

- [Prettier — Sharing configurations](https://prettier.io/docs/en/configuration.html#sharing-configurations) — the npm-package config-distribution model.
- [Spotless](https://github.com/diffplug/spotless) — multi-language formatting orchestration in the build.
- [pre-commit](https://pre-commit.com/) — the polyglot hook framework and its version-pinning model.
- [Renovate — Automated dependency updates](https://docs.renovatebot.com/) — governing formatter version bumps at scale.
- [Black stability policy & style migrations](https://black.readthedocs.io/en/stable/the_black_code_style/index.html#stability-policy) — the annual-migration governance model.
- The **naming-conventions** skill — for the style decisions that remain genuinely human, which the formatter does not make.

---

## Related Topics

- [09 — Static Analysis in CI](../09-static-analysis-in-ci/professional.md) — org-wide gate governance and CI performance.
- [01 — Linters & Style Checkers](../01-linters-and-style-checkers/professional.md) — governing logic-rule policy alongside formatting.
- [07 — Custom Lint Rules & AST](../07-custom-lint-rules-and-ast/professional.md) — when no formatter owns a file type and you need to build one.
- [Interview Level](interview.md) — the question bank.
