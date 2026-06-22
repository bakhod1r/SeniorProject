# Versioning & SemVer — Professional Level

> **Roadmap:** [Release Engineering](../README.md) → Versioning & SemVer
> *Versioning as organizational policy: a governed, machine-enforced version contract spanning hundreds of libraries, services, schemas, and platform APIs — and the migration economics behind every MAJOR.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — A Versioning Policy as a Governed Standard](#core-concept-1--a-versioning-policy-as-a-governed-standard)
5. [Core Concept 2 — Enforcing the Contract in the Platform](#core-concept-2--enforcing-the-contract-in-the-platform)
6. [Core Concept 3 — Versioning the Internal Platform: Protos, Schemas, Templates](#core-concept-3--versioning-the-internal-platform-protos-schemas-templates)
7. [Core Concept 4 — Org-Wide Dependency Health and the Diamond at Scale](#core-concept-4--org-wide-dependency-health-and-the-diamond-at-scale)
8. [Core Concept 5 — The Economics of a MAJOR](#core-concept-5--the-economics-of-a-major)
9. [Core Concept 6 — Deprecation Policy and Sunset Governance](#core-concept-6--deprecation-policy-and-sunset-governance)
10. [Core Concept 7 — Versioning, Compliance, and Supply Chain](#core-concept-7--versioning-compliance-and-supply-chain)
11. [Core Concept 8 — Choosing Schemes Across a Heterogeneous Estate](#core-concept-8--choosing-schemes-across-a-heterogeneous-estate)
12. [Real-World Examples](#real-world-examples)
13. [Mental Models](#mental-models)
14. [Common Mistakes](#common-mistakes)
15. [Test Yourself](#test-yourself)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)
18. [Further Reading](#further-reading)
19. [Related Topics](#related-topics)

## Introduction

> Focus: **designing, governing, and automating a version contract for an entire engineering organization — so thousands of artifacts version consistently, breaking changes are predictable, and migrations are economically rational.**

At org scale, versioning stops being a per-package decision and becomes infrastructure. The questions change: not "what bump is this PR?" but "how do I guarantee every one of 800 services classifies bumps the same way, that no MAJOR ships without a funded migration plan, that the internal proto registry can never break a downstream team, and that a CVE in a transitive dependency is patchable across the estate in hours?" This page is about the policy, the platform enforcement, and the economics — the layer a staff/principal engineer or a platform team owns.

## Prerequisites

**Required**
- Senior tier of this topic (API surface, diamond resolution, social-contract failures, API-diff CI, wire versioning).
- Experience owning a shared library, platform API, or schema consumed by multiple teams.
- Familiarity with release automation and policy-as-code (OPA/Conftest or equivalent).

**Helpful**
- Having run or survived a large breaking migration across many teams.
- Exposure to supply-chain controls (SBOM, provenance, vulnerability management).

## Glossary

| Term | Plain-English meaning |
| --- | --- |
| Version contract | The org-wide, written + enforced rules for how versions are assigned. |
| Policy-as-code | Versioning rules encoded as automated checks (e.g. OPA/Rego, Conftest). |
| Conventional Commits | A commit-message convention (`feat:`, `fix:`, `feat!:`) that drives automated bumps. |
| Release-please / semantic-release | Tools that derive version + changelog from commit history. |
| Migration runway | The funded time, tooling, and support window for consumers to adopt a breaking change. |
| Renovate / Dependabot | Bots that open PRs to advance dependency versions across repos. |
| Schema governance | Centralized control over how shared schemas/protos may evolve. |
| Sunset | The committed end-of-life date for a deprecated API version. |
| SBOM | Software Bill of Materials — the inventory of versioned components in an artifact. |
| Floating tag | A non-immutable reference (`latest`, `v1`) that points to a moving target. |

## Core Concept 1 — A Versioning Policy as a Governed Standard

A written policy that nobody enforces is decoration. A professional version policy is a **standard** — versioned itself, owned by a named group, and binding by default. It answers, unambiguously:

- **What schemes are allowed for what artifact classes** (libraries → SemVer; deploy-only services → CalVer or SHA; contracts → SemVer on the contract). No per-team improvisation.
- **The canonical breaking-change definition**, including the edge cases your org has been bitten by (error messages, enum additions, raised runtime minimums, default changes).
- **The source of truth** for each artifact class (tag-derived vs manifest-derived) and the CI assertion that enforces it.
- **The bump-derivation mechanism**: human-declared via Conventional Commits, machine-derived via API diff, or both with the diff as a floor.
- **The minimum deprecation window per artifact class**, and who may grant exceptions.
- **The exception path** — because there is always one, and undocumented exceptions become the norm.

```yaml
# Excerpt of a machine-readable org version policy (consumed by CI lint)
artifact_classes:
  public_library:
    scheme: semver
    source_of_truth: git_tag
    bump_derivation: [conventional_commits, api_diff_floor]
    min_deprecation_window_days: 180
  internal_service:
    scheme: calver_or_sha
    source_of_truth: build
    min_deprecation_window_days: 0      # no importers; deploy-only
  wire_contract:
    scheme: semver
    compatibility: full
    registry_enforced: true
```

The point of encoding it as data: the policy is then *checkable*, not merely *readable*.

## Core Concept 2 — Enforcing the Contract in the Platform

Policy lives in the pipeline, not in a wiki. The professional move is to make the *correct* versioning behavior the path of least resistance and the incorrect behavior impossible to merge.

**Bump derivation, automated.** Conventional Commits feed a release tool that computes the version and the changelog, removing human bump-choice entirely for the common case.

```bash
# Conventional Commits → release-please / semantic-release derive the bump
feat: add streaming API            → MINOR
fix: handle nil session            → PATCH
feat!: drop Node 16 support        → MAJOR   (the ! marks a breaking change)

# The bot opens a release PR with the computed version + generated changelog.
```

**API-diff as a hard gate.** The derived bump is checked against a machine-computed API diff; a PR that adds a breaking change while declaring `fix:` fails CI.

```bash
# CI step (conceptual): diff the public API, fail if declared bump is too small
declared=$(derive-bump-from-commits)         # e.g. PATCH
required=$(gorelease -base "$(git describe --tags --abbrev=0)" | parse-required-bump)
[ "$declared" -ge "$required" ] || fail "Breaking change requires MAJOR; commit declared $declared"
```

**Policy-as-code for the rules that diffs can't see.** OPA/Conftest enforces structural rules: tag matches manifest, `/v2` import path present for `v2+` Go modules, no floating tags in production manifests, deprecation window present in the removal PR.

```rego
# Conftest/OPA: forbid floating image tags in prod deployments
deny[msg] {
  input.kind == "Deployment"
  endswith(input.spec.template.spec.containers[_].image, ":latest")
  msg := "production images must be pinned to an immutable tag or digest"
}
```

This is the same principle as [Quality Gates](../../testing/) applied to versioning: the standard is enforced by the system, so compliance does not depend on diligence.

## Core Concept 3 — Versioning the Internal Platform: Protos, Schemas, Templates

The highest-leverage versioning in a large org is rarely application code — it is the **shared internal contracts** that every team depends on: the proto/IDL repository, the event schemas, the shared base images, the IaC modules, and the pipeline templates. A breaking change to any of these is a fleveraged break across the whole company.

**The central proto/IDL repository.** One source of truth, with compatibility *enforced at publish*:

```bash
# buf — lint + breaking-change detection for protobuf, run in CI on the proto repo
buf breaking --against '.git#branch=main'
#   user.proto:14:3  Field "1" with name "id" changed type from "string" to "int64".
#   FAIL — breaking change against main
```

The proto repo's policy is typically **additive-only on the main line**; a breaking change requires a new package version (`acme.user.v2`) so `v1` consumers are untouched — the proto equivalent of Go's `/v2`.

**Event schemas via a registry with `FULL` or `BACKWARD` compatibility**, so a producer literally cannot publish a schema that breaks a consumer. Versioning becomes a property the platform guarantees rather than a convention teams follow.

**Shared base images, IaC modules, and pipeline templates** must be SemVer'd and pinned by consumers, never floated. A `latest` base image is an un-versioned breaking change waiting to happen; pin to a digest and advance via bot PRs.

```hcl
# Terraform module consumers pin a SemVer range, not "main"
module "vpc" {
  source  = "app.terraform.io/acme/vpc/aws"
  version = "~> 4.2"   # patch + minor of 4.2; never a surprise 5.0
}
```

The governing rule: **a platform contract that thousands depend on may evolve additively without ceremony, but a breaking change is a new versioned namespace plus a migration program — never an in-place edit.**

## Core Concept 4 — Org-Wide Dependency Health and the Diamond at Scale

In a multi-hundred-repo estate, the diamond problem stops being per-build and becomes a *fleet* property. Two capabilities are non-negotiable:

**An estate-wide inventory of who uses what version.** Built from SBOMs and lockfiles, queryable: "which services still run `log4j < 2.17`?" Without this, a CVE is unschedulable.

```bash
# Query the SBOM inventory for a vulnerable transitive version across the fleet
sbom-query 'pkg:maven/org.apache.logging.log4j/log4j-core@<2.17.0'
#   42 services affected; 6 still on 2.14.x
```

**Automated, fleet-wide version advancement.** Renovate/Dependabot open PRs across all repos; the goal is keeping the estate close to the leading edge so the gap to any required upgrade (security or otherwise) is small. A fleet that floats 18 months behind cannot respond to a zero-day in hours.

The diamond at scale also has a **convergence** cost: the more versions of a shared library are live across the fleet, the more compatibility surface the platform team maintains. Professional practice actively *narrows* the spread — campaigns to retire old majors, hard deprecation deadlines, and "version floor" policies ("no service may depend on `auth-lib < 5.0` after Q3").

## Core Concept 5 — The Economics of a MAJOR

A MAJOR version bump is not a number; it is a **bill paid by every consumer**. At org scale this cost is quantifiable, and a professional treats it as a budget to be justified.

```
Cost of a MAJOR ≈ (number of consumers) × (per-consumer migration effort)
               +  platform team support cost during the window
               +  risk cost of consumers who never migrate
```

Implications that drive policy:

- **Breaking changes are amortized by frequency.** Many small, mechanical majors (each migratable with a codemod) are far cheaper in aggregate than one giant manual migration, because per-change effort drops toward zero when you ship the codemod with the release.
- **Ship the migration, not just the break.** A `v2` that includes an automated codemod (`jscodeshift`, `gofmt -r`, `comby`, an OpenRewrite recipe) converts an N-team manual project into an N-team CI run. This is the single biggest lever on MAJOR economics.

```bash
# Ship a codemod alongside the breaking release
npx @acme/migrate-v2 ./src
#   Rewrote 31 call sites: Connect(addr) → NewClient({addr})
```

- **Parallel-run the old major during the window.** `v1` and `v2` coexist (via import path, package namespace, or a compatibility shim) so migration is incremental, not a flag day.
- **A break with no migration plan should not ship.** Policy: a MAJOR PR is blocked until it carries a migration guide, a codemod (where mechanical), and a funded window — turning "I'd like to break this" into "here is the cost and the plan."

This is where the `api-versioning` skill's deprecation and migration strategies become operational policy rather than advice.

## Core Concept 6 — Deprecation Policy and Sunset Governance

Deprecation at org scale needs governance because a deprecation is a *promise* that crosses team boundaries and budget cycles.

- **A central deprecation registry.** Every deprecated symbol/endpoint/schema, its announcement date, its committed sunset date, and its replacement — queryable and reported on. "What sunsets next quarter?" must be answerable.
- **Machine-readable deprecation signals.** For platform APIs, emit `Deprecation` and `Sunset` HTTP headers (RFC 8594) so consumer tooling alerts automatically; for libraries, compiler-visible deprecation annotations that surface in every consumer's build.

```http
HTTP/1.1 200 OK
Deprecation: Sun, 01 Jun 2025 00:00:00 GMT
Sunset: Tue, 01 Dec 2025 00:00:00 GMT
Link: <https://api.acme.com/v2/users>; rel="successor-version"
```

- **Window length scaled to consumer class.** External/partner APIs: often 12+ months and contractually bound. Internal libraries: a quarter or two. Deploy-only services with no importers: effectively zero. The policy states the floor per class.
- **Enforcement at sunset.** When the date arrives, removal proceeds *by default*; an extension requires an explicit, time-boxed exception with an owner. Deprecations that never sunset are how an org accumulates the very legacy it set out to retire.

## Core Concept 7 — Versioning, Compliance, and Supply Chain

Versions are the keys that tie everything else in the release contract together — provenance, SBOMs, vulnerability response, and reproducibility.

- **Immutable version → immutable artifact.** A published version must never be re-pointed. Re-tagging `1.4.1` to new content invalidates every cached SBOM, signature, and provenance attestation. Registries should enforce immutability; floating tags (`latest`, `v1`) are convenience aliases over immutable digests, never the artifact identity itself.
- **Versions index the SBOM.** Vulnerability management is "which *versions* are affected," so the version string must precisely and immutably identify the build it names. This is why pinning to a digest (`@sha256:...`) beats pinning to a tag for security-critical deployments.
- **Yanking, not deleting.** When a published version is found dangerous (a leaked secret, a critical bug), the supply-chain-safe operation is to *yank* (mark unusable for new resolutions while leaving existing pins working), as crates.io and npm support — not to delete and break every lockfile referencing it.

See [Artifact Signing & Provenance](../04-artifact-signing-and-provenance/) and [Supply Chain Security](../09-supply-chain-security/) for the attestation machinery these version guarantees underpin.

## Core Concept 8 — Choosing Schemes Across a Heterogeneous Estate

A real org runs many artifact classes at once; the policy assigns each the scheme whose semantics match its consumers' question.

| Artifact class | Scheme | Why |
| --- | --- | --- |
| Public SDK / library | SemVer | Integrators need a compatibility signal. |
| Internal shared library | SemVer + API-diff CI | Same need, machine-enforced. |
| Proto / IDL package | SemVer on package, additive main, `vN` namespace for breaks | Wire compat across all consumers. |
| Deploy-only microservice | CalVer or `<date>-<sha>` | No importers; only "how new / which commit" matters. |
| End-user app / mobile | CalVer or marketing version | Users care about recency, not API compat. |
| Container base image | SemVer, pinned by digest downstream | Reproducibility + controlled advancement. |
| IaC / pipeline template | SemVer | Consumers pin ranges; breaks must signal. |

The error to avoid is **monoculture by mandate** — forcing SemVer onto deploy-only services produces meaningless `3.0.0` bumps, while forcing CalVer onto libraries strips the compatibility signal integrators need. The policy's sophistication is in matching scheme to artifact class, then enforcing *that* mapping uniformly.

## Real-World Examples

- **Buf-governed proto monorepo.** A company centralizes all protos, runs `buf breaking` in CI against `main`, and mandates `vN`-namespaced packages for breaking changes. Result: a producer team *cannot* merge a wire-breaking change to a live package; breaking evolution is forced into a new, opt-in namespace with a migration. The version contract is enforced by the platform, not trusted to reviewers.
- **Codemod-shipped MAJOR.** A framework team ships `v3` with breaking renames *and* an OpenRewrite recipe. Across 120 internal services, the upgrade is a Renovate PR plus a recipe run; what would have been a multi-quarter manual migration becomes a two-week fleet campaign. The MAJOR's economics were transformed by shipping the migration with the break.
- **Fleet vulnerability response via SBOM + version inventory.** A critical CVE drops in a transitive dependency. Because the org maintains an SBOM-indexed inventory keyed by version and keeps the fleet near the leading edge via Renovate, the affected set is identified in minutes and patched across hundreds of services within the SLA — a capability that only exists because versions are immutable and inventoried.

## Mental Models

- **The version contract is infrastructure, not etiquette.** If correctness depends on engineers remembering rules, it will fail at scale; encode and enforce it.
- **A MAJOR is a tax on your consumers — minimize the rate or subsidize it with codemods.** Either break rarely or make breaking cheap; never break often *and* manually.
- **Platform contracts evolve additively; breaks become new namespaces.** In-place breaking changes to shared protos/schemas/images are the most expensive mistake in the building.
- **Immutability is the keystone.** Signing, SBOMs, provenance, and rollback all assume a version names exactly one artifact forever.
- **Deprecation is a promise with a budget line.** No sunset date and no owner means it never happens.

## Common Mistakes

- **A policy doc with no enforcement.** Without CI/policy-as-code, every team's interpretation drifts.
- **Forcing one scheme across all artifact classes** — meaningless majors for services, lost signal for libraries.
- **Shipping a MAJOR without a codemod or migration plan.** You have exported the cost to every consumer and made the upgrade optional in practice.
- **In-place breaking changes to shared protos/schemas/base images** rather than a new versioned namespace.
- **Floating tags in production** (`:latest`, `v1`) — non-reproducible, unsignable, un-rollback-able.
- **Deprecations with no sunset date or owner** — they accumulate into the legacy you meant to retire.
- **No fleet version inventory** — turning every CVE into an unschedulable scramble.
- **Deleting (not yanking) a bad published version** — breaking every existing lockfile that pins it.

## Test Yourself

1. Your org mandates SemVer everywhere. A platform team complains their deploy-only service produces meaningless `4.0.0` bumps. What is wrong with the mandate and how do you fix it?
2. A framework team wants to ship a breaking `v2`. What three artifacts should policy require before the MAJOR can merge, and why?
3. Why is yanking, not deleting, the correct response to a dangerous published version?
4. How do you make "is this a breaking change?" a machine-checked invariant rather than a reviewer's opinion, and what residual class of breaks does that still miss?
5. A shared proto package needs a field's type changed from `string` to `int64`. The registry/`buf` rejects it. What is the org-correct path, and what makes it cheap for consumers?

<details>
<summary>Answers</summary>

1. The mandate confuses "consistent policy" with "single scheme." A deploy-only service has no importers, so MAJOR/MINOR/PATCH encode nothing. Fix: the policy assigns schemes *per artifact class* — CalVer or `<date>-<sha>` for deploy-only services, SemVer for things others import — and enforces that mapping uniformly.
2. (a) A migration guide, (b) a codemod for the mechanical parts (converting N manual migrations into N CI runs), (c) a funded deprecation/parallel-run window so `v1` keeps working during adoption. Together they convert an externalized, unbounded cost into a bounded, subsidized one.
3. Existing lockfiles and provenance/SBOM records pin the exact version; deleting it breaks every build referencing it and orphans signatures. Yanking blocks *new* resolutions while leaving existing pins functional — safe for the supply chain.
4. Run an API-diff tool (`gorelease`, `cargo-semver-checks`, `japicmp`, `buf breaking`) in CI and fail when the declared bump is smaller than the diff-derived minimum. It misses *behavioral* breaks with no structural change (changed defaults, timing, error semantics) — complement with contract/golden tests and human declaration.
5. A type change is wire-breaking and must not edit the live package. The correct path is a new versioned namespace (`acme.x.v2`) so `v1` consumers are untouched, plus a migration program. It is made cheap by shipping a codemod and parallel-running both versions across a committed window, so consumers migrate incrementally.

</details>

## Cheat Sheet

```
POLICY AS DATA:   per-artifact-class scheme + source-of-truth + window, machine-readable
ENFORCE IN CI:    conventional-commits → derived bump; api-diff as a hard floor;
                  OPA/Conftest for tag==manifest, /v2 path, no floating tags, window present

PLATFORM CONTRACTS (protos/schemas/images/IaC):
  additive on main; breaking → new versioned namespace (acme.x.v2);
  buf breaking / schema-registry FULL|BACKWARD enforced at publish; pin by digest

MAJOR ECONOMICS:  cost ≈ consumers × per-consumer effort → ship a codemod; parallel-run vN;
                  many small mechanical majors > one giant manual one; no plan → no merge

DEPRECATION:      central registry (announce date, sunset date, owner, replacement);
                  Deprecation/Sunset headers (RFC 8594); sunset proceeds by default

SUPPLY CHAIN:     versions immutable; floating tags are aliases over digests;
                  SBOM-indexed fleet inventory; YANK don't DELETE

SCHEME MAP:       lib/SDK→SemVer  service→CalVer/SHA  app→CalVer  proto→SemVer+vN  image→SemVer+digest
```

## Summary

- Treat versioning as a governed, machine-readable standard with per-artifact-class schemes, not per-team improvisation.
- Enforce the contract in the platform: derive bumps from Conventional Commits, gate on API diffs, and use policy-as-code for the structural rules.
- Version internal platform contracts (protos, schemas, base images, IaC) additively, forcing breaks into new versioned namespaces with migration programs.
- Maintain an SBOM-indexed fleet inventory and keep the estate near the leading edge so security upgrades are schedulable in hours.
- Treat a MAJOR as a quantifiable consumer tax — subsidize it with codemods and parallel runs, and block any break without a funded plan.
- Govern deprecations with a registry, machine-readable signals, owners, and default-on sunsets; and keep versions immutable as the keystone of signing, SBOMs, and rollback.

## Further Reading

- "Software Engineering at Google" — chapters on dependency management and large-scale changes (codemods).
- Buf documentation — breaking-change detection and proto package versioning.
- RFC 8594 — the HTTP `Sunset` header; the `Deprecation` header draft.
- OpenRewrite, jscodeshift, comby — codemod tooling for subsidizing migrations.
- release-please / semantic-release — automated bump and changelog derivation from Conventional Commits.

## Related Topics

- [Artifact Signing & Provenance](../04-artifact-signing-and-provenance/) — what version immutability enables.
- [Registries & Distribution](../05-registries-and-distribution/) — yanking, immutability, and floating-tag policy.
- [Release Automation](../08-release-automation/) — wiring bump derivation and gates into the pipeline.
- [Supply Chain Security](../09-supply-chain-security/) — SBOMs and version-indexed vulnerability response.
- [Rollback & Roll-Forward](../07-rollback-and-roll-forward/) — parallel-running majors during migration.
