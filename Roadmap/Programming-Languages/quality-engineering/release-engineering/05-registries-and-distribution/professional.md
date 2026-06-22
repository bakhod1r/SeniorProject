# Registries & Distribution — Professional Level

> **Roadmap:** [Release Engineering](../README.md) → Registries & Distribution

*Governance, trusted publishing, provenance programs, and cost at fleet scale — making the whole org's distribution trustworthy, affordable, and auditable.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Distribution as an org-wide platform](#core-concept-1--distribution-as-an-org-wide-platform)
5. [Core Concept 2 — Trusted publishing and the death of long-lived tokens](#core-concept-2--trusted-publishing-and-the-death-of-long-lived-tokens)
6. [Core Concept 3 — Provenance and SBOM as a program](#core-concept-3--provenance-and-sbom-as-a-program)
7. [Core Concept 4 — Policy: only admitted artifacts run](#core-concept-4--policy-only-admitted-artifacts-run)
8. [Core Concept 5 — Cost governance at scale](#core-concept-5--cost-governance-at-scale)
9. [Core Concept 6 — Immutability, retention, and compliance as policy-as-code](#core-concept-6--immutability-retention-and-compliance-as-policy-as-code)
10. [Core Concept 7 — Incident response for a bad or poisoned release](#core-concept-7--incident-response-for-a-bad-or-poisoned-release)
11. [Core Concept 8 — Rollout strategy and migration](#core-concept-8--rollout-strategy-and-migration)
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

> Focus: **At org scale, distribution is a governed platform, not a set of commands. The professional question is how to make every artifact published and consumed by hundreds of engineers trustworthy, affordable, auditable, and recoverable — by policy, not by discipline.**

Senior work made one registry reliable and secure. Professional work makes *the whole organization's* distribution a platform: trusted publishing rolled out everywhere, provenance and SBOMs generated and verified as a program, cost governed and attributed, retention and immutability enforced as code, and a rehearsed plan for the day a poisoned release ships. You are designing the controls that let people move fast safely without relying on everyone remembering to do the right thing.

## Prerequisites

- You can reason about registries as SPOF/supply-chain infrastructure ([senior.md](senior.md)).
- You've operated signing, admission control, and provenance ([Artifact Signing & Provenance](../04-artifact-signing-and-provenance/professional.md)).
- Familiarity with policy-as-code, OIDC/workload identity, and SBOM standards.
- You influence org-wide engineering policy and budgets.

## Glossary

| Term | Meaning |
|------|---------|
| **Trusted publishing** | CI authenticates to a registry via short-lived OIDC; no stored token. |
| **OIDC** | OpenID Connect — federated, short-lived identity tokens from CI to registry. |
| **Provenance** | Signed attestation linking an artifact to its source + build (e.g. SLSA, in-toto). |
| **SBOM** | Software Bill of Materials — the dependency inventory of an artifact. |
| **SLSA** | Supply-chain Levels for Software Artifacts — a provenance maturity framework. |
| **Admission policy** | Cluster gate that admits only artifacts meeting signing/provenance rules. |
| **Policy-as-code** | Retention/immutability/access rules expressed as reviewed, versioned config. |
| **Chargeback / showback** | Attributing (and billing / reporting) registry cost to teams. |
| **Quarantine** | Holding incoming/suspect artifacts out of production until cleared. |

## Core Concept 1 — Distribution as an org-wide platform

A platform team owns "how artifacts are published and consumed here" so product teams don't each reinvent it. The platform provides:

- **One blessed path to publish** (a reusable CI workflow) that signs, attaches provenance + SBOM, publishes by digest, and records the release.
- **One blessed path to consume** (proxies/mirrors with scanning, resolver config that blocks dependency confusion, admission policy in clusters).
- **Golden defaults**: immutable release tags, retention by tag class, OIDC publishing, least-privilege scopes — on by default, hard to misconfigure.
- **Paved road, not a cage**: teams that need an exception go through a documented process, but the default is secure and cheap.

> The platform principle: make the secure, cheap, reproducible path the *easiest* path. If doing it right requires every engineer to remember ten steps, it won't happen at scale. Encode the steps once; everyone inherits them.

## Core Concept 2 — Trusted publishing and the death of long-lived tokens

Long-lived publish tokens are the worst credential class in distribution: broadly scoped (publish under your name), rarely rotated, and catastrophic if leaked — and they leak (CI logs, env dumps, committed `.npmrc`). **Trusted publishing** eliminates them.

The mechanism: your CI provider (GitHub Actions, GitLab) issues a short-lived **OIDC** token asserting "this run is from repo X, workflow Y, branch Z." The registry is configured to *trust* that specific claim and mints a short-lived publish credential — no secret stored anywhere.

```yaml
# PyPI trusted publishing — no API token anywhere
permissions:
  id-token: write          # allow OIDC token issuance
jobs:
  publish:
    steps:
      - uses: pypa/gh-action-pypi-publish@release/v1   # authenticates via OIDC
```
```yaml
# npm provenance + (with org policy) OIDC-based publishing
- run: npm publish --provenance --access public
  env:
    NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}   # or, increasingly, OIDC trusted publishing
```

PyPI and npm both support trusted publishing; container registries support the analogous pattern via cloud workload identity (GitHub OIDC → ECR/GHCR/Artifactory) so no static cloud keys live in CI.

**Rollout as a program:** inventory every place a long-lived publish token exists → enable trusted publishing per package/registry → revoke the old tokens → add a policy check that *fails CI* if a publish step uses a static token. Trusted publishing also strengthens provenance: because the registry verified the OIDC claim, the "published from repo X / workflow Y" statement is trustworthy by construction.

## Core Concept 3 — Provenance and SBOM as a program

One artifact with provenance is a demo. Provenance *as a program* means every artifact, automatically, carries verifiable answers to "where did this come from?" and "what's inside it?"

- **Provenance (SLSA / in-toto)** — a signed attestation: this digest was built from this commit, by this builder, with these inputs. Stored alongside the artifact in the registry (as an OCI referrer / attestation).
- **SBOM (SPDX / CycloneDX)** — the dependency inventory, generated at build, attached to the artifact, queryable when the next Log4Shell-class CVE drops: "which of our 4,000 deployed images contain the vulnerable library?"

```bash
# Generate + attach an SBOM and provenance to an image (cosign + syft style)
syft ghcr.io/acme/api@sha256:9b2c... -o spdx-json > sbom.json
cosign attest --predicate sbom.json --type spdxjson ghcr.io/acme/api@sha256:9b2c...
cosign verify-attestation --type slsaprovenance ghcr.io/acme/api@sha256:9b2c...
```

The registry becomes the **system of record** for trust metadata: artifact + signature + provenance + SBOM, all addressed by the same digest. The professional deliverable is the *pipeline* that produces this for every artifact and the *query capability* to answer audit and incident questions in minutes. Depth lives in [Artifact Signing & Provenance](../04-artifact-signing-and-provenance/professional.md) and [Supply-Chain Security](../09-supply-chain-security/professional.md).

## Core Concept 4 — Policy: only admitted artifacts run

Generating trust metadata is worthless if nothing checks it. The enforcement point is **admission control** in your runtime: an image runs only if it is signed by an approved key, has acceptable provenance (e.g. SLSA level ≥ N), comes from an allowed registry, and passes scan policy.

```yaml
# Sigstore policy-controller (cluster policy): admit only verified images
apiVersion: policy.sigstore.dev/v1beta1
kind: ClusterImagePolicy
spec:
  images:
    - glob: "ghcr.io/acme/**"
  authorities:
    - keyless:
        identities:
          - issuer: https://token.actions.githubusercontent.com
            subjectRegExp: "https://github.com/acme/.*"
```

Policy spectrum (roll out gradually): **audit/warn** (log violations, admit anyway) → **enforce in staging** → **enforce in production**. Going straight to hard-enforce org-wide breaks deploys and burns trust in the program. The professional move is staged rollout with clear dashboards of what *would* be blocked before it *is*.

> The principle: the registry holds the evidence; the admission gate is the judge. No evidence or failing evidence → no run. This closes the loop from "we sign things" to "unsigned things cannot reach production."

## Core Concept 5 — Cost governance at scale

At fleet scale, registry cost is real and usually un-owned: storage grows monotonically, cross-region/cross-cloud egress spikes on every scale event, and nobody's budget is debited. Levers:

- **Retention by tag class, automated.** CI-scratch and PR tags expire in days; release tags persist. This alone often cuts storage by an order of magnitude.
- **Dedup-aware accounting.** OCI layers are shared; report *unique* storage per team, not summed image sizes, or you'll chase phantom costs.
- **Egress reduction.** Regional pull-through caches and CDN-fronted immutable blobs turn N cross-region pulls into one fetch + local serves — frequently the single biggest line item.
- **Showback / chargeback.** Attribute storage and egress to teams via labels. Visibility creates the incentive; teams clean up what they're billed for.
- **Right-size images.** Smaller base images (distroless, multi-stage builds — see the `docker-best-practices` skill) cut storage, egress, *and* pull latency simultaneously. A 1.2 GB image vs a 120 MB one is 10× the bill and 10× the cold-start pull.

```bash
# Surface the cost drivers
# - unique storage per repo (dedup-aware) → chargeback report
# - top egress repos by region → target for regional caching
# - largest images → target for base-image slimming
```

> Cost governance is not penny-pinching; it's making the cheap path the default (slim images, aggressive scratch retention, regional caches) and the expensive path visible (showback) so it self-corrects.

## Core Concept 6 — Immutability, retention, and compliance as policy-as-code

Ad-hoc retention rules and per-repo settings drift and create gaps. Express them as **reviewed, versioned policy-as-code**:

- **Immutable release tags** enforced registry-wide: a `v*` tag, once pushed, can never be repointed (configurable in ECR, Artifactory, GHCR). This makes "deploy by tag" almost as safe as digest and kills tag-mutation attacks.
- **Retention rules in IaC**: lifecycle policies defined in Terraform, reviewed in PRs, applied uniformly — not clicked into a console where they silently differ across 200 repos.
- **Compliance retention**: regulated artifacts (the actual deployed releases, their SBOMs, provenance) may need to be retained for *years* for audit. Encode "release artifacts: retain N years; scratch: 7 days" as policy, and make deletion of compliance-class artifacts require an explicit, audited exception.

```hcl
# Terraform: ECR repo with immutable tags + lifecycle policy as code
resource "aws_ecr_repository" "api" {
  name                 = "api"
  image_tag_mutability = "IMMUTABLE"      # release tags can never be repointed
}
resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name
  policy     = file("${path.module}/lifecycle.json")   # reviewed in PRs
}
```

> Policy-as-code turns "we have a retention policy" (a wiki page nobody enforces) into "retention is enforced identically on every repo and changes go through review." That is what auditors — and incident responders — actually need.

## Core Concept 7 — Incident response for a bad or poisoned release

When a release is bad — regression, leaked secret, or actively malicious — execute a rehearsed playbook, not improvisation. The right action depends on registry semantics ([middle.md](middle.md)) and *whether the bytes are dangerous*.

1. **Contain.** Stop new adoption: yank (crates/PyPI), deprecate (npm), or pull the tag from rotation. Update admission policy to deny the bad digest immediately — admission control is your fastest org-wide kill switch.
2. **Roll forward / back.** Ship a fixed version *now* (immutable registries leave you no other choice; mutable ones still shouldn't overwrite). Deploys pinned by digest roll back deterministically — see [Rollback & Roll-Forward](../07-rollback-and-roll-forward/professional.md).
3. **Decide on deletion.** Only unpublish/delete if the bytes themselves are dangerous *and* you're inside the window (npm 72h). Remember left-pad: deleting bytes others depend on turns your incident into everyone's.
4. **Rotate.** Leaked secret → rotate it; compromised publish credential → revoke (trusted publishing minimizes this surface).
5. **Trace blast radius with the SBOM/provenance program.** "Which deployed images contain the bad artifact?" must be a query, not an archaeology project.
6. **Postmortem → policy.** Feed the gap back into policy-as-code so the class of incident can't recur.

> Professional reality: the registry's *immutability* is your friend in an incident (the good versions are still exactly there to roll back to) and the *deletion* lever is the one you almost never pull. Containment is yank + admission-deny + ship-a-fix, not delete.

## Core Concept 8 — Rollout strategy and migration

Introducing these controls into a live org is itself the hard part — break deploys and the program loses credibility.

- **Sequence:** observability first (inventory tokens, images, egress, what *would* fail policy) → trusted publishing (no breakage, removes credentials) → provenance/SBOM generation (additive) → admission in *audit* mode → enforce in staging → enforce in production.
- **Migrate registries carefully.** Moving from Docker Hub to GHCR/ECR, or consolidating onto Artifactory, means dual-publishing during transition, repointing consumers, and preserving digests (re-pushing an image to a new registry yields the *same* manifest digest if bytes are identical — pins survive if you keep the digest).
- **Measure adoption.** Track % of artifacts signed, % with SBOMs, % of publishes via trusted publishing, % of clusters enforcing admission. A program without metrics stalls — see [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) for framing.
- **Communicate deprecations.** Old publish paths and registries get sunset dates, warnings, and migration guides — you're applying the same yank/deprecate discipline to your *own* internal tooling.

## Real-World Examples

**Example 1 — Killing static tokens.** A platform team finds 140 long-lived publish tokens across repos. They enable PyPI/npm trusted publishing and cloud OIDC for container pushes, migrate per package, revoke all 140, and add a CI lint that fails any publish step using a static token. Credential-leak risk for publishing drops to near zero.

**Example 2 — CVE blast-radius query.** A critical CVE lands in a popular logging library. Because every image carries an attached SBOM, the security team queries the registry's attestations and identifies the 312 affected deployed digests in 20 minutes, then drives targeted rebuilds — instead of weeks of guesswork.

**Example 3 — Staged admission rollout.** Admission policy runs in audit mode for a month; dashboards show 6% of deploys *would* be blocked (unsigned legacy images). Teams fix those, then the policy flips to enforce in staging, then production — with zero surprise outages because nothing newly broke at flip time.

## Mental Models

- **Paved road.** The secure/cheap/reproducible path must be the easiest path; controls live in shared platform tooling, not in individual discipline.
- **Registry = system of record for trust.** Artifact + signature + provenance + SBOM, all keyed by one digest. The admission gate is the consumer of that record.
- **Immutability is your incident ally; deletion is the lever you rarely pull.** The good versions are still there to roll back to; removing bytes harms others (left-pad).
- **Policy-as-code over wiki-as-policy.** If it isn't enforced identically and reviewed in PRs, it isn't a policy — it's a hope.

## Common Mistakes

- **Long-lived publish tokens left in place.** The single highest-value credential to eliminate via trusted publishing.
- **Generating provenance/SBOM but never verifying.** Evidence with no judge changes nothing — wire admission control.
- **Hard-enforcing admission org-wide on day one.** Breaks deploys, kills the program's credibility. Stage it (audit → staging → prod).
- **Un-owned registry cost.** Without retention-as-code and showback, storage and egress grow unbounded.
- **Console-clicked retention/immutability.** Drifts across repos; un-auditable. Use IaC.
- **No rehearsed bad-release playbook.** Improvising yank-vs-delete during an incident causes left-pad-class self-harm.
- **Deleting compliance-class artifacts.** You may lose the exact bytes an audit or rollback needs.

## Test Yourself

1. How does trusted publishing eliminate the worst credential class, and why does it also strengthen provenance?
2. What two questions do provenance and SBOM respectively answer, and why store them in the registry?
3. Why roll out admission control in audit mode before enforcing?
4. Name three levers for registry cost governance and why each works.
5. Why express retention and tag immutability as policy-as-code rather than console settings?
6. In a poisoned-release incident, why is admission-deny often faster than unpublishing?
7. Why does immutability help, not hinder, rollback during an incident?
8. When migrating registries, how can existing digest pins survive the move?

## Cheat Sheet

```yaml
# Trusted publishing (PyPI) — no token
permissions: { id-token: write }
- uses: pypa/gh-action-pypi-publish@release/v1

# Provenance + SBOM, attached and verified by digest
syft IMAGE@sha256:... -o spdx-json | cosign attest --type spdxjson IMAGE@...
cosign verify-attestation --type slsaprovenance IMAGE@sha256:...

# Admission: only signed images from our org (policy-controller)
ClusterImagePolicy { keyless issuer github actions, subject acme/* }

# Immutability + retention as code (ECR/Terraform)
image_tag_mutability = "IMMUTABLE"; lifecycle_policy = file("lifecycle.json")
```

| Goal | Control |
|------|---------|
| Kill leaked-token risk | trusted publishing / OIDC, ban static tokens in CI |
| Answer "what's deployed / what's inside" | provenance + SBOM program, registry as system of record |
| Stop unsigned artifacts running | staged admission control (audit → staging → prod) |
| Bound cost | retention-as-code by tag class, regional caches, slim images, showback |
| Survive a bad release | rehearsed playbook: yank/deprecate + admission-deny + ship-fix |
| Audit & compliance | policy-as-code retention, immutable release tags |

## Summary

At org scale, distribution is a **governed platform**: a paved road that makes the secure, cheap, reproducible path the default. **Trusted publishing** (OIDC) eliminates long-lived publish tokens — the worst credential class — and strengthens provenance by construction. Run **provenance and SBOM as a program** so the registry becomes the system of record for trust, and close the loop with **staged admission control** so unsigned or unverified artifacts cannot run. Govern **cost** with retention-as-code by tag class, regional/CDN caching, slim images, and showback; express **immutability, retention, and compliance** as reviewed policy-as-code, not console clicks. When a bad or poisoned release ships, execute a rehearsed playbook — **yank/deprecate plus admission-deny plus ship-a-fix**, with deletion as the rare last resort (remember left-pad) — and use the SBOM program to scope blast radius in minutes. Roll all of this out in sequence, in audit-before-enforce mode, with adoption metrics. The registry is the one chokepoint every artifact passes through: govern it well and the whole organization ships fast, cheaply, and safely.

## Further Reading

- SLSA framework — provenance levels and requirements
- PyPI / npm — "Trusted publishers" documentation
- Sigstore — cosign, policy-controller; SPDX / CycloneDX SBOM specs
- "Securing the Software Supply Chain" (CISA/NSA guidance)
- The `docker-best-practices`, `cdn-design`, and `caching-strategies` skills

## Related Topics

- [Artifact Signing & Provenance](../04-artifact-signing-and-provenance/professional.md) — the signing and attestation the registry stores.
- [Supply-Chain Security](../09-supply-chain-security/professional.md) — the broader program this feeds.
- [Versioning & SemVer](../01-versioning-and-semver/professional.md) — the immutable coordinates you publish under.
- [Release Automation](../08-release-automation/professional.md) — encoding the paved-road publish path in CI.
- [Rollback & Roll-Forward](../07-rollback-and-roll-forward/professional.md) — incident response using digests and immutability.
