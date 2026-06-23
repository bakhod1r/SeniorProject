# Supply-Chain Security — Middle Level

> **Roadmap:** [Release Engineering](../README.md) → Supply-Chain Security
>
> *An inventory you can query, dependencies you can defend, and a review workflow that scales past "trust me."*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — SBOMs: an inventory you can query](#core-concept-1--sboms-an-inventory-you-can-query)
5. [Core Concept 2 — Generating and using an SBOM](#core-concept-2--generating-and-using-an-sbom)
6. [Core Concept 3 — Pinning vs ranges, and what hashes really buy](#core-concept-3--pinning-vs-ranges-and-what-hashes-really-buy)
7. [Core Concept 4 — A dependency review workflow that scales](#core-concept-4--a-dependency-review-workflow-that-scales)
8. [Core Concept 5 — Private mirrors, allowlists, and dependency confusion](#core-concept-5--private-mirrors-allowlists-and-dependency-confusion)
9. [Core Concept 6 — Where verification fits at consume time](#core-concept-6--where-verification-fits-at-consume-time)
10. [Real-World Examples](#real-world-examples)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **SBOMs as a queryable inventory, the precise mechanics of pinning vs version ranges, and a dependency-review workflow (scan, review, mirror, allowlist) that holds up across a real team.**

The junior tier covered the threat model and the basic hygiene: lockfiles and scanning. At the middle tier the question changes from "is this one dependency safe?" to "can I answer questions about *all* of them, quickly?" When the next Log4Shell drops at 2 a.m. and someone asks **"are we affected, and where?"**, the difference between a five-minute answer and a five-day audit is whether you built the inventory and the review workflow *before* the incident.

This file covers SBOMs (the inventory), pinning mechanics (the controls), the review workflow (the process), and where consume-time verification slots in — deferring signing mechanics to [Artifact Signing & Provenance](../04-artifact-signing-and-provenance/).

---

## Prerequisites

- Junior tier: the chain, lockfiles, and basic scanning.
- Comfort with CI pipelines (you can add a step that runs a tool and fails the build).
- Familiarity with at least one package ecosystem's lockfile format.
- Helpful: read [Artifact Signing & Provenance](../04-artifact-signing-and-provenance/) for the signing/attestation mechanics this file references.

---

## Glossary

| Term | Meaning |
|------|---------|
| **SBOM** | Software Bill of Materials — a structured, machine-readable list of every component in an artifact, with versions and (ideally) licenses + hashes. |
| **SPDX** | An SBOM format and ISO standard (ISO/IEC 5962), Linux Foundation. |
| **CycloneDX** | An SBOM format from OWASP, popular in security tooling, with strong vulnerability/VEX support. |
| **PURL** | Package URL — a canonical identifier like `pkg:npm/lodash@4.17.21` that uniquely names a component across tools. |
| **syft** | A tool (Anchore) that generates SBOMs from source trees and container images. |
| **VEX** | Vulnerability Exploitability eXchange — a statement that a CVE *does* or *does not* affect you. |
| **Pinning** | Locking a dependency to an exact version or hash. |
| **Vendoring** | Committing dependency *source* into your own repo. |
| **Allowlist** | An explicit set of approved packages/registries; everything else is blocked. |
| **Private mirror** | A proxy registry you control that caches/curates upstream packages. |

---

## Core Concept 1 — SBOMs: an inventory you can query

An **SBOM** is a structured manifest of everything inside an artifact: every direct and transitive component, its version, ideally its license and a hash, each named with a stable identifier (a PURL). Think of it as the ingredients label on a food package — except machine-readable, so a tool can answer questions about it instantly.

Two formats dominate, and good tools speak both:

- **SPDX** — Linux Foundation, an ISO standard, strong on licensing and broad ecosystem adoption. Often required by procurement and government (see EO 14028).
- **CycloneDX** — OWASP, security-first, with first-class support for vulnerabilities and **VEX** (statements about whether a CVE actually applies to you).

The whole *point* of an SBOM is the queries it unlocks:

- **"Am I affected by CVE-X?"** — match the CVE's affected PURLs against your SBOM. Minutes, not days.
- **License audit** — "do we ship any GPL/AGPL code we shouldn't?" — answerable from the license field.
- **Drift detection** — diff today's SBOM against last release's: what changed, and why?
- **Reachability triage** — combine the SBOM with a scanner to see *which* components have known vulns.

Crucially: **an SBOM is an inventory, not a guarantee.** It tells you what's *in* the box; it says nothing about whether those components are safe, whether the build that produced them was clean, or whether the SBOM itself is accurate (a generator that misses a component produces a confidently wrong inventory). The SBOM is the *map* — it makes the incident-response question answerable. It does not, by itself, prevent the incident.

---

## Core Concept 2 — Generating and using an SBOM

`syft` generates SBOMs from a source tree or a container image:

```bash
# From a directory (reads lockfiles, manifests, installed packages)
syft dir:. -o spdx-json=sbom.spdx.json
syft dir:. -o cyclonedx-json=sbom.cdx.json

# From a built container image (sees the actual installed layers)
syft myorg/api:1.4.2 -o cyclonedx-json=sbom.cdx.json
```

**When you generate matters.** Generating from source reflects what you *declared*; generating from the built image reflects what actually *shipped* (including OS packages baked into the base image — see the `docker-best-practices` skill). The image-level SBOM is closer to truth for "what's running in production." Best practice is to generate at build time and attach the SBOM to the artifact as an attestation (mechanics: [Artifact Signing & Provenance](../04-artifact-signing-and-provenance/)).

Then *use* it. `grype` consumes an SBOM directly, so you separate "what's in the artifact" (slow, do once at build) from "what's now known-vulnerable" (fast, re-run continuously as the advisory DB updates):

```bash
# Scan the SBOM, not the filesystem — re-runnable as new CVEs land
grype sbom:sbom.cdx.json

# The 2 a.m. question, answered from a stored SBOM:
grep -i "log4j" sbom.cdx.json
osv-scanner --sbom=sbom.cdx.json
```

This separation is the operational payoff: store the SBOM per release, and when a new CVE drops you re-scan the *stored* SBOMs of every deployed version without rebuilding anything.

---

## Core Concept 3 — Pinning vs ranges, and what hashes really buy

A **version range** (`^1.2.0`, `>=2,<3`, `~=1.4`) delegates the choice of exact version to resolution time. Convenient — you get patches automatically — but it means a *new, unreviewed* release can enter your build the next time you resolve. That is precisely the channel event-stream used.

**Pinning** fixes the exact version. **Hash pinning** goes further: it fixes the exact *content*, so even the same version number can't be swapped for tampered bytes.

The ladder, weakest to strongest:

| Level | Example | What it stops |
|-------|---------|---------------|
| Range | `"lodash": "^4.17.0"` | Nothing — any matching release flows in. |
| Pinned version | `"lodash": "4.17.21"` | Surprise *version* bumps. Not content swaps. |
| Lockfile (version + hash) | `package-lock.json` `integrity` | Content tampering for the locked version. |
| Hash-pinned manifest | `pip --require-hashes`, Go `go.sum` | Content tampering, verified on every install. |
| Vendoring | `vendor/` committed to repo | Registry availability *and* tampering — you own the bytes. |

What `go.sum` actually protects, precisely: it stores a hash of each module's files (`h1:`) and of its `go.mod`. On build, Go fetches the module (via the proxy and, by default, verifies against the **checksum database** `sum.golang.org`), then checks the bytes against `go.sum`. If anyone — the author, the proxy, a MITM — alters the module after the line was written, the hash mismatches and the build **fails**:

```bash
go mod verify        # re-verify the module cache against go.sum
GOFLAGS=-mod=readonly go build ./...   # fail if go.mod/go.sum would change
```

Say it once more because teams get it wrong: **a hash guarantees the bytes are identical to what was approved. It does not guarantee the bytes are good.** A backdoored module with a stable `go.sum` line sails through. Hash pinning defends against *tampering in transit and surprise updates* — not against an upstream that was malicious from the start. That residual risk is what review, scanning, and provenance (next concepts) address.

**Vendoring** trades repo size and noisier diffs for two real wins: your build no longer depends on registry uptime (the left-pad failure mode disappears), and dependency *changes* show up as reviewable diffs in PRs. `go mod vendor`, `npm`'s offline mirror, or `cargo vendor` all support it.

---

## Core Concept 4 — A dependency review workflow that scales

"Be careful" doesn't scale. A real workflow turns dependency changes into reviewable, gated events:

**1. Automated update PRs.** Dependabot or Renovate watch your manifests and open PRs for updates and — higher priority — security advisories. Renovate adds grouping, scheduling, and auto-merge policies (e.g. auto-merge patch-level dev-dependency bumps that pass CI; require human review for anything else).

**2. Scan on every PR, gate the merge.** Run a scanner against the *changed* lockfile and fail on new high-severity findings:

```yaml
# CI step (illustrative)
- run: osv-scanner --lockfile=package-lock.json --fail-on-vuln
```

GitHub's **dependency-review-action** is purpose-built for this: it diffs the PR's dependency changes and flags newly introduced vulnerable or badly-licensed packages *before* merge.

**3. Review what's actually new.** The reviewable unit is the *added or changed* dependency, not the whole tree. For a new direct dependency, a reviewer should glance at: download/usage popularity, recency of maintenance, number of maintainers, presence of install scripts, and the transitive deps it drags in. OpenSSF **Scorecard** automates much of this — it scores a repo on signals like branch protection, signed releases, and fuzzing:

```bash
scorecard --repo=github.com/some/dependency
```

**4. Triage findings, don't drown in them.** Not every CVE is reachable or relevant. Record a decision (fix now / fix by date / not-affected-because-X) — ideally as a **VEX** statement so the "not affected" verdict is machine-readable and survives the next scan. The goal is a *short, justified* list of accepted risks, not an ignored 400-line report.

---

## Core Concept 5 — Private mirrors, allowlists, and dependency confusion

By default your package manager fetches from the public internet and, given a name, will often prefer the highest version it can find *anywhere*. That default is exactly what **dependency confusion** (Birsan, 2021) exploited: publish a public package with your private package's name and a huge version number, and the resolver pulls the attacker's copy into your build.

Three controls, increasingly strict:

- **Scope/namespace your internal packages** so they can't collide with public names (`@yourco/auth` on npm; a private module path in Go) and **explicitly route** those names to your registry. Never let a private name be resolvable from the public registry.
- **Private mirror / proxy** (Artifactory, Nexus, Verdaccio, a Go `GOPROXY`). All installs go through a registry *you* control, which caches upstream packages, can enforce policy, and removes the public registry as a direct runtime dependency. This is also where you can pin which upstream versions are even *visible*.
- **Allowlist.** The proxy serves only an explicitly approved set of packages/versions. Maximum control, real curation cost — appropriate for high-assurance environments.

```bash
# Pin Go's module fetch + checksum verification explicitly
go env -w GOPROXY=https://proxy.yourco.internal,direct
go env -w GOSUMDB=sum.golang.org      # keep checksum DB verification on

# npm: route a scope to your private registry
npm config set @yourco:registry https://npm.yourco.internal
```

The principle: **decide where your dependencies come from, on purpose.** Names alone are not identity; the source is part of the identity.

---

## Core Concept 6 — Where verification fits at consume time

Pinning and scanning answer "is this the right, known-good version?" **Provenance verification** answers a different question: *"was this artifact actually built from the source it claims, by the build system it claims?"* That's the gap SolarWinds drove a truck through — the source was fine, the *build* was subverted.

At the consume side, the middle-tier awareness is:

- **SLSA provenance** is a signed statement describing how an artifact was built (source repo, commit, builder identity). You can *verify* it before you install or admit an artifact.
- **Trusted publishing (OIDC)** lets CI publish to a registry using a short-lived, identity-bound token instead of a long-lived secret — so there's no publish token to steal (the channel Codecov-style attacks abuse). PyPI, npm, and others support it.
- You **verify before you trust**: check the signature/attestation as a gate, not after the fact.

The actual commands — `cosign verify`, `cosign verify-attestation`, SLSA verifier — and the cryptography behind them live in [Artifact Signing & Provenance](../04-artifact-signing-and-provenance/). Here, just internalize the *shape*: at consume time you add a verification gate that rejects artifacts lacking valid, expected provenance, and you prefer publish flows that have no long-lived secret to steal. (See also the `secrets-management` skill.)

---

## Real-World Examples

- **Log4Shell (CVE-2021-44228).** The defining "are we affected, and where?" event. Teams *with* SBOMs grepped for `log4j-core` and had an answer in minutes; teams without spent days manually auditing builds. This single incident is the strongest argument for generating and storing SBOMs.

- **Dependency confusion (Birsan, 2021).** Public packages impersonating private names executed inside Apple, Microsoft, Shopify, and others. The fix is the Concept 5 toolkit: namespacing, explicit routing, and private mirrors.

- **event-stream (2018).** A malicious *transitive* dependency entered via a maintainer handoff and a version range. Hash pinning + a review gate on new dependencies would have surfaced the change as a reviewable event instead of a silent install.

- **Codecov (2021).** Attackers tampered with Codecov's bash uploader script in CI; it exfiltrated environment variables — including secrets — from thousands of customer pipelines. The lessons: protect CI scripts and secrets, and prefer OIDC/short-lived tokens over long-lived ones.

- **SolarWinds (2020).** Malicious code (SUNBURST) was injected during the *build*, so signed, "legitimate" updates shipped a backdoor to ~18,000 organizations. No amount of dependency pinning helps when the build itself is the attacker — which is why provenance and build integrity (senior tier) exist.

---

## Mental Models

- **SBOM = the map; scanner = the search over the map.** Build the map once at build time; search it continuously as new CVEs land.
- **A range is a standing invitation.** It says "let any matching future release in, unreviewed." A pin revokes the invitation.
- **Hash = identity, not virtue.** Same bytes, proven. Whether the bytes are good is a separate question.
- **Names aren't identity; source is.** Dependency confusion is what happens when you trust a name without controlling where it resolves from.

---

## Common Mistakes

- **Generating an SBOM and never querying it.** An SBOM nobody scans or stores is compliance theater. The value is the *fast answer* during an incident.
- **Trusting ranges in production builds** while believing the lockfile makes it fine — until someone runs `npm install` and re-resolves.
- **Treating every CVE as a fire drill.** Without triage/VEX, real findings drown in noise and people stop looking.
- **Letting private package names resolve from the public registry.** This is the dependency-confusion door, left open.
- **Storing long-lived publish tokens in CI** when OIDC trusted publishing is available.
- **Generating the SBOM from source only,** missing OS-level packages that the built image actually ships.

---

## Test Yourself

1. What questions does an SBOM let you answer quickly, and what does it explicitly *not* guarantee?
2. Contrast SPDX and CycloneDX. When might procurement require one specifically?
3. Walk the pinning ladder from version range to vendoring; say what each level stops.
4. Precisely: what does `go.sum` verify, and what attack does it *not* stop?
5. Describe a four-step dependency-review workflow that gates merges.
6. How do namespacing + private mirrors defeat dependency confusion?
7. What question does provenance verification answer that pinning cannot — and which incident proves the need?

---

## Cheat Sheet

```bash
# Generate an SBOM (prefer build-time / image-level)
syft dir:. -o cyclonedx-json=sbom.cdx.json
syft myorg/api:1.4.2 -o spdx-json=sbom.spdx.json

# Scan the SBOM (re-runnable as advisories update)
grype sbom:sbom.cdx.json
osv-scanner --sbom=sbom.cdx.json

# Pin hard / verify integrity
go mod verify
pip install --require-hashes -r requirements.txt
GOFLAGS=-mod=readonly go build ./...

# Control where deps come from
go env -w GOPROXY=https://proxy.yourco.internal,direct
npm config set @yourco:registry https://npm.yourco.internal

# Score a dependency's hygiene
scorecard --repo=github.com/some/dependency
```

| Goal | Tool / control |
|------|----------------|
| Queryable inventory | `syft` SBOM (SPDX/CycloneDX), stored per release |
| Stop surprise updates | Pin versions + commit lockfile |
| Stop content tampering | Hashes (`go.sum`, `--require-hashes`) |
| Stop dependency confusion | Namespacing + private mirror/allowlist |
| Gate risky deps at PR | dependency-review-action, OSV-Scanner, Scorecard |
| Verify build origin | SLSA provenance (mechanics in topic 04) |

---

## Summary

At the middle tier, supply-chain security becomes a *system*, not a habit. Generate an **SBOM** at build time and store it so the "are we affected by CVE-X?" question takes minutes — but remember it's an inventory, not a guarantee. Climb the **pinning ladder** deliberately: ranges invite unreviewed code, pins stop version surprises, hashes stop content tampering, vendoring removes registry dependence. Run a **review workflow** that turns every dependency change into a scanned, gated, reviewable PR — with triage/VEX so real findings don't drown. **Control where dependencies resolve from** (namespacing + private mirrors) to shut the dependency-confusion door. And know the shape of **consume-time verification** (SLSA provenance, OIDC publishing) even though the mechanics live in topic 04 — because pinning can't tell you whether the *build* was honest, and SolarWinds proved the build is a target.

---

## Further Reading

- CycloneDX and SPDX specifications; CISA's SBOM resources and minimum-elements guidance.
- Anchore — `syft` and `grype` documentation; "SBOM at build time" patterns.
- OpenSSF Scorecard — checks and scoring methodology.
- Alex Birsan — "Dependency Confusion" (2021).
- GitHub — dependency-review-action and Dependabot docs; Renovate documentation.

---

## Related Topics

- [Artifact Signing & Provenance](../04-artifact-signing-and-provenance/) — the signing/attestation/SLSA mechanics this file defers to.
- [Registries & Distribution](../05-registries-and-distribution/) — private mirrors, registry configuration, and distribution.
- [Release Automation](../08-release-automation/) — wiring SBOM generation and scan gates into the pipeline.
- [Static Analysis](../../static-analysis/) — complementary scanning of your own code.
- [Build Systems](../../build-systems/) — how artifacts are produced; build-time SBOM generation.
- Adjacent tiers: [Junior](junior.md) · [Senior](senior.md) · [Professional](professional.md) · [Interview](interview.md).
