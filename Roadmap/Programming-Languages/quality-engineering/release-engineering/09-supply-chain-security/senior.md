# Supply-Chain Security — Senior Level

> **Roadmap:** [Release Engineering](../README.md) → Supply-Chain Security
>
> *The build is the target. Make it reproducible, isolate it, prove what it produced, and verify that proof before you trust anything.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The build is an attack surface (the SolarWinds lesson)](#core-concept-1--the-build-is-an-attack-surface-the-solarwinds-lesson)
5. [Core Concept 2 — Hermetic, isolated, ephemeral builds](#core-concept-2--hermetic-isolated-ephemeral-builds)
6. [Core Concept 3 — Provenance: prove what was built, from what](#core-concept-3--provenance-prove-what-was-built-from-what)
7. [Core Concept 4 — Verifying at consume time, as a gate](#core-concept-4--verifying-at-consume-time-as-a-gate)
8. [Core Concept 5 — SLSA levels under real constraints](#core-concept-5--slsa-levels-under-real-constraints)
9. [Core Concept 6 — Protecting the build system and its secrets](#core-concept-6--protecting-the-build-system-and-its-secrets)
10. [Core Concept 7 — SSDF, EO 14028, in-toto: the framework map](#core-concept-7--ssdf-eo-14028-in-toto-the-framework-map)
11. [Core Concept 8 — Sequencing a rollout you can defend](#core-concept-8--sequencing-a-rollout-you-can-defend)
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

> Focus: **build integrity — hermetic/ephemeral builds, generating and verifying provenance, applying SLSA/SSDF under real constraints, and protecting the build system itself, which SolarWinds proved is the highest-value target.**

The junior and middle tiers defended the *inputs* to your build (dependencies) and built the *inventory* (SBOMs). The senior tier defends the build *itself*. This matters because the most damaging supply-chain attacks don't tamper with a dependency you'd scan — they compromise the build system, so the malicious artifact is signed, "legitimate," and indistinguishable from a clean release. Pinning, scanning, and SBOMs are all blind to that.

Your job as a senior engineer is to make the build *reproducible and isolated*, *prove* what it produced (provenance), *verify* that proof before admission, and *harden the builder* and its secrets — all while staying shippable. This file defers cryptographic signing mechanics to [Artifact Signing & Provenance](../04-artifact-signing-and-provenance/) and focuses on the chain-integrity and program-design view.

---

## Prerequisites

- Middle tier: SBOMs, the pinning ladder, dependency-review workflow, dependency confusion.
- You own or heavily influence a CI/CD pipeline.
- Familiarity with signing concepts from [Artifact Signing & Provenance](../04-artifact-signing-and-provenance/) (cosign, attestations, SLSA mechanics).
- Working knowledge of container builds (the `docker-best-practices` skill) and CI secret handling (the `secrets-management` skill).

---

## Glossary

| Term | Meaning |
|------|---------|
| **Hermetic build** | A build with no access to anything not declared as an input — no network, no ambient state. Same inputs → same output. |
| **Reproducible build** | Bit-for-bit identical output from the same source, independent of when/where it runs. |
| **Ephemeral runner** | A build environment created fresh per job and destroyed after, leaving no persistent state to compromise. |
| **Provenance** | Signed metadata describing *how* an artifact was built: source, commit, builder, inputs. |
| **Attestation** | A signed statement *about* an artifact (provenance, SBOM, test results) in a standard envelope (in-toto/DSSE). |
| **SLSA** | Supply-chain Levels for Software Artifacts — a graded framework for build integrity (levels 1–3+). |
| **SSDF** | NIST 800-218 Secure Software Development Framework. |
| **in-toto** | A framework for cryptographically attesting each step of the supply chain. |
| **VEX** | Vulnerability Exploitability eXchange — machine-readable "affected / not affected" claims. |
| **Two-person rule** | No single person can push code or trigger a release alone. |

---

## Core Concept 1 — The build is an attack surface (the SolarWinds lesson)

Restate the chain with the senior emphasis: **source → build → publish → consume.** Most defenses target source (review, signed commits) and consume (pinning, scanning). The *build* is the gap, and it is the most valuable target because:

- Whatever it emits is *automatically* trusted — it gets signed and released as a legitimate artifact.
- It has access to source, secrets, signing keys, and the network simultaneously.
- Its output reaches *every* downstream consumer at once (one compromise → fan-out to thousands).

SolarWinds is the canonical case. Attackers didn't tamper with a dependency or with published source; they implanted SUNBURST *during the build*, so Orion updates were compiled with the backdoor and then *correctly signed* with SolarWinds' own key. Customers verified the signature — it was valid — and installed a backdoor. **Signing a compromised build just gives you an authentic lie.** That's why provenance ("this came from *this* source and *this* builder") matters beyond a bare signature, and why the builder itself must be hardened.

The senior reframing: trust isn't a property of the final artifact alone. It's a property of the *whole production process*, and the build step is where production happens.

---

## Core Concept 2 — Hermetic, isolated, ephemeral builds

If a build can reach the network mid-build, pick up undeclared tools, or run on a long-lived machine that the previous job mutated, then "the same source" can produce *different* outputs — and an attacker has surfaces to persist on. Three properties close those gaps:

**Hermetic.** The build sees only its declared inputs: pinned dependencies (from your mirror/lockfile), a pinned toolchain, no arbitrary network fetches. A build that `curl`s a script mid-run is not hermetic — that's the Codecov failure mode. Tools like Bazel enforce hermeticity by construction; in less strict systems you approximate it by pre-fetching all dependencies, disabling network during the build step, and pinning the toolchain.

```dockerfile
# Approximating hermeticity in a container build:
# 1) resolve+fetch deps in a layer that is cached and reviewable
COPY go.mod go.sum ./
RUN GOFLAGS=-mod=readonly go mod download && go mod verify
# 2) build with no further network access; pinned base image by digest
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -o /app ./cmd/server
```

```dockerfile
# Pin the base image by digest, not a mutable tag (see docker-best-practices)
FROM golang:1.22.3@sha256:<digest> AS build
```

**Reproducible.** Same source → bit-for-bit identical artifact, regardless of when or where. Reproducibility is the ultimate audit: an independent rebuild that yields the same hash *proves* the published artifact corresponds to the published source — it would have caught SolarWinds-style implantation. Achieve it by eliminating nondeterminism: pin everything, strip timestamps/paths (`-trimpath`, `SOURCE_DATE_EPOCH`), and avoid embedding build-host state.

**Ephemeral.** Each build runs on a freshly provisioned runner, destroyed afterward. No persistent runner means no place for an attacker to install a persistent implant that taints future builds. GitHub-hosted runners and ephemeral self-hosted runners both achieve this; long-lived shared runners are a standing risk.

Together: hermetic removes *undeclared inputs*, reproducible *proves* the output, ephemeral removes *persistence*. These are the preconditions that make provenance meaningful — provenance about a non-hermetic build on a persistent runner is a claim you can't fully trust.

---

## Core Concept 3 — Provenance: prove what was built, from what

**Provenance** is signed metadata answering: *what* artifact, built from *what* source (repo + commit), by *what* builder, with *what* inputs. It's the antidote to "authentic lie" — a valid signature says "the holder of this key signed it"; provenance says "this artifact came from commit `abc123` of `github.com/yourco/api`, built by GitHub Actions workflow `release.yml`."

Provenance is emitted as an **attestation** — a signed statement *about* an artifact, wrapped in the in-toto/DSSE envelope. The **SLSA provenance** predicate is the standard schema for build provenance. Generating it: many CI systems and the SLSA GitHub generator produce it automatically; `cosign` can attach attestations to an OCI artifact.

```bash
# Inspect/verify a provenance attestation on a container image
# (full mechanics + key/identity setup live in topic 04)
cosign verify-attestation \
  --type slsaprovenance \
  --certificate-identity-regexp '^https://github.com/yourco/.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  ghcr.io/yourco/api@sha256:<digest>
```

The key senior insight is *what to assert in policy*, not how the crypto works (that's [topic 04](../04-artifact-signing-and-provenance/)): you want provenance that ties the artifact to an **expected source repo**, an **expected builder identity**, and ideally an **expected workflow** — so a build produced by anything *other* than your sanctioned pipeline fails verification, even if it's signed.

---

## Core Concept 4 — Verifying at consume time, as a gate

Provenance you generate but never check is decoration. The control is **verify-before-trust**, enforced as a *gate* that blocks anything failing verification:

- **At deploy/admission.** A Kubernetes admission controller (Sigstore policy-controller, Kyverno, or OPA/Gatekeeper) rejects images that lack a valid signature *and* provenance from your expected identity. Mechanics in [topic 04](../04-artifact-signing-and-provenance/); the senior decision is *where the gate lives and what it asserts*.
- **At install (deps).** Verify package signatures/attestations before consuming. PyPI, npm, and others increasingly support signed attestations via **trusted publishing**.
- **In CI, before promote.** A pipeline step that runs `cosign verify-attestation` and refuses to promote build → staging → prod unless provenance matches policy.

```bash
# Gate example: refuse to promote unless provenance verifies
cosign verify-attestation --type slsaprovenance \
  --certificate-identity-regexp '^https://github.com/yourco/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  "$IMAGE" || { echo "provenance verification failed"; exit 1; }
```

The design principle: **the gate must be on the critical path and fail closed.** A verification step that logs a warning and proceeds is theater. The verifier must reject (a) unsigned artifacts, (b) artifacts signed by the wrong identity, and (c) artifacts whose provenance points at the wrong source or builder.

---

## Core Concept 5 — SLSA levels under real constraints

**SLSA** grades build integrity. The mechanics of achieving each level via signing/provenance tooling live in [topic 04](../04-artifact-signing-and-provenance/); here's the senior decision framework — *what each level buys and what it costs*:

| Level | Roughly means | Buys you | Realistic cost |
|-------|---------------|----------|----------------|
| **L1** | Provenance exists, even if unsigned | Basic transparency; you can see how things were built | Cheap — wire your CI to emit provenance |
| **L2** | Signed provenance from a hosted build service | Tamper-evidence; provenance tied to a builder | Moderate — managed signing / OIDC keyless |
| **L3** | Hardened, isolated builder; provenance non-forgeable by build steps | Resistance to a *compromised build step* forging its own provenance | Higher — hermetic/ephemeral builders, isolation |

The senior judgment is **not** "get everyone to L3." It's: *which artifacts warrant which level?* Your internet-facing, widely-distributed release artifact deserves L3-class assurance; an internal cron job's image may be fine at L1–L2. Spend the isolation budget where the blast radius is largest. Under constraints — limited platform support, a build system that can't yet be made hermetic, a team mid-migration — a defensible plan is: L1 everywhere now, L2 on released artifacts this quarter, L3 on the crown-jewel artifacts next, with the gap explicitly tracked as risk. SLSA is a ladder to climb deliberately, not a binary to fail.

---

## Core Concept 6 — Protecting the build system and its secrets

The build holds source, secrets, *and* signing keys at once — so hardening the builder is non-negotiable. The senior checklist:

- **Two-person review on anything that reaches the build.** Require PR review (the two-person rule) on source *and* on the CI/release configuration itself. A pipeline definition that one person can edit and run is a one-person path to a signed malicious release.
- **Least privilege for the runner.** The build needs read on source and write on the artifact registry — rarely more. Scope tokens to exactly that. Don't hand the build broad cloud admin.
- **Short-lived, identity-bound secrets (OIDC).** Replace long-lived publish tokens and cloud keys with OIDC: the runner exchanges a workflow identity for a short-lived credential at job time. There's no long-lived secret to steal, which is the direct countermeasure to the Codecov pattern. (See the `secrets-management` skill.)
- **Pin your CI actions/steps by digest.** A third-party GitHub Action referenced by mutable tag (`@v4`) can be re-pointed at malicious code; pin by commit SHA. Your CI config is *also* a dependency graph.
- **Isolate the signing key.** Signing should happen in the hardened build or a dedicated signer, with keys in an HSM/KMS or keyless (Fulcio/Sigstore). The build step should be able to *request* a signature, not exfiltrate a key. (Encryption and key-management fundamentals: the `encryption-basics` skill; mechanics in [topic 04](../04-artifact-signing-and-provenance/).)
- **Audit and monitor the pipeline.** Log who triggered what, with which inputs; alert on out-of-band builds (a release produced outside the sanctioned workflow should page someone).

The throughline: treat the CI/CD system as **production infrastructure with production-grade access controls** — because in a supply-chain sense, it *is* production.

---

## Core Concept 7 — SSDF, EO 14028, in-toto: the framework map

You'll be asked to align with frameworks. Senior-level: know what each *is for* so you can map controls, not recite acronyms.

- **NIST SSDF (SP 800-218)** — Secure Software Development Framework. A practice catalog grouped into Prepare the Organization, Protect the Software, Produce Well-Secured Software, Respond to Vulnerabilities. It's the "what good looks like" checklist that procurement and auditors map against.
- **Executive Order 14028 (2021)** — drove U.S. federal requirements that software vendors attest to secure development (per SSDF) and provide SBOMs. If you sell to the U.S. government, this is *why* SBOMs and attestations became contractual, not optional.
- **OpenSSF Scorecard** — automated scoring of a repo's security posture (branch protection, signed releases, pinned deps, fuzzing, etc.). Useful both to *measure your own* repos and to *evaluate dependencies*.
- **in-toto** — the framework for attesting *each step* of the chain cryptographically; SLSA provenance is expressed as in-toto attestations. It's the substrate under "prove every link," not a competitor to SLSA.

The map: **SSDF/EO 14028 = the policy "what," SLSA = the build-integrity grading, in-toto = the attestation substrate, Scorecard = the measurement.** They compose; they don't compete.

---

## Core Concept 8 — Sequencing a rollout you can defend

A senior doesn't boil the ocean. Sequence by leverage and blast radius:

1. **Foundation (weeks):** lockfiles enforced, scanning gated in CI, Dependabot/Renovate on, SBOMs generated and stored per release. (Mostly middle-tier, but make it *enforced*, not optional.)
2. **Build integrity (a quarter):** pin base images and CI actions by digest, move runners to ephemeral, adopt OIDC for publish/cloud (kill long-lived tokens), require two-person review on release config.
3. **Provenance (a quarter):** emit SLSA provenance, then add a **fail-closed verification gate** at promote/admission for released artifacts.
4. **Maturity (ongoing):** push crown-jewel artifacts toward L3 (hermetic builds), aim for reproducibility on critical artifacts, formalize SSDF mapping and Scorecard targets, and stand up the incident-response muscle (the professional tier).

At each step, the test is: *does this measurably reduce blast radius, and can I keep shipping?* Controls that block delivery get bypassed; controls that fail closed *and* stay fast survive.

---

## Real-World Examples

- **SolarWinds (2020).** Build-time implantation → validly signed backdoored updates → ~18,000 orgs. The case for hermetic/isolated builds, provenance beyond signatures, and reproducibility as an independent check. A signature alone would (and did) verify successfully.

- **Codecov (2021).** A tampered CI uploader script exfiltrated secrets from thousands of pipelines. The case for hermetic builds (no mid-build script fetch), OIDC short-lived secrets (nothing long-lived to steal), and least-privilege runners.

- **xz/liblzma (2024).** A social-engineered maintainer planted a backdoor *in release tarballs* that differed from the git source — a build/release-artifact discrepancy. Reproducible builds and provenance tying the artifact to reviewed source are exactly the controls that catch "the tarball doesn't match the repo."

- **Dependency confusion (2021).** Resolution preferring a public impostor over a private package. Mitigated by namespacing + private mirrors (middle tier) and verified by provenance at consume time.

- **PyPI / npm trusted publishing (OIDC) rollout.** The ecosystem's move to short-lived, identity-bound publish credentials is the standardized fix for the long-lived-token theft pattern that Codecov-style attacks exploit.

---

## Mental Models

- **A signature proves *who*, provenance proves *what and from where*.** SolarWinds had a valid signature on a malicious artifact; provenance + verification is what distinguishes "signed" from "trustworthy."
- **The build is production.** Give it production access controls, ephemerality, and review — because its output is automatically trusted everywhere.
- **Hermetic + reproducible = an audit you can run anytime.** If an independent rebuild matches the published hash, the build didn't lie.
- **SLSA is a ladder, not a gate.** Climb it where blast radius justifies the cost; track the gap as explicit risk.
- **Verification that fails open is decoration.** A gate must reject, not warn.

---

## Common Mistakes

- **Signing without provenance,** then believing a valid signature means a trustworthy artifact (the SolarWinds trap).
- **Generating provenance but never verifying it** — or verifying it in a step that fails open.
- **Long-lived runners and long-lived tokens** in CI, when ephemeral runners + OIDC eliminate whole attack classes.
- **Pinning deps but not CI actions/base images,** leaving a mutable `@v4` action or `:latest` base as the unpinned door.
- **Letting one person edit and run the release pipeline** — the two-person rule applies to *config*, not just app code.
- **Chasing SLSA L3 everywhere** instead of targeting the high-blast-radius artifacts and tracking the rest as risk.
- **Treating SSDF/EO 14028 as paperwork** rather than mapping real controls to it.

---

## Test Yourself

1. Why did a valid signature fail to protect SolarWinds customers, and what control fills that gap?
2. Define hermetic, reproducible, and ephemeral — and say which attack property each removes.
3. What does provenance assert that a signature doesn't, and what should your verification policy require?
4. Why must a verification gate fail *closed*, and where should it live?
5. Contrast SLSA L1/L2/L3 by what they buy and cost. How do you decide a level per artifact?
6. List five concrete ways to harden the build system itself.
7. Map SSDF, EO 14028, SLSA, in-toto, and Scorecard to their distinct roles.
8. How would reproducible builds + provenance have caught the xz tarball discrepancy?

---

## Cheat Sheet

```bash
# Hermetic-ish build: pre-fetch + verify deps, pin toolchain, no mid-build network
GOFLAGS=-mod=readonly go mod download && go mod verify
go build -trimpath -o /app ./cmd/server     # -trimpath aids reproducibility

# Pin everything by digest (base images, CI actions)
# FROM golang:1.22.3@sha256:<digest>
# uses: actions/checkout@<commit-sha>

# Verify provenance as a fail-closed gate (mechanics: topic 04)
cosign verify-attestation --type slsaprovenance \
  --certificate-identity-regexp '^https://github.com/yourco/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  "$IMAGE" || exit 1

# Measure repo posture
scorecard --repo=github.com/yourco/service
```

| Concern | Senior control |
|---------|----------------|
| Build implantation (SolarWinds) | Hermetic + ephemeral builds; reproducibility; provenance |
| Mid-build script tamper (Codecov) | No network in build step; OIDC short-lived secrets |
| Authentic lie (signed-but-bad) | Provenance + fail-closed verification of source/builder |
| CI as attack surface | Pin actions by SHA, least-privilege tokens, two-person review |
| Compliance mapping | SSDF / EO 14028; SLSA levels; Scorecard targets |

---

## Summary

The senior tier defends the **build**, because the build is the highest-value target: its output is automatically trusted and fans out to everyone, as SolarWinds proved when a *validly signed* update shipped a backdoor. Make builds **hermetic** (only declared inputs), **reproducible** (an audit anyone can run), and **ephemeral** (no persistence for an implant). Emit **provenance** that ties the artifact to an expected source, commit, and builder — and **verify it as a fail-closed gate** at promote/admission, because a signature proves *who* signed, not *what was built*. Climb **SLSA** deliberately, spending isolation budget where blast radius is largest. Harden the builder itself with two-person review on config, least-privilege OIDC secrets, and digest-pinned actions and base images. Map your controls to **SSDF/EO 14028**, express attestations via **in-toto**, and measure with **Scorecard**. Sequence the rollout by leverage, and keep every gate both fail-closed and fast enough that nobody routes around it.

---

## Further Reading

- SLSA specification (slsa.dev) — levels, threats, and the provenance predicate.
- NIST SP 800-218 (SSDF) and Executive Order 14028.
- in-toto specification and the Sigstore project (Fulcio, Rekor, cosign).
- Reproducible Builds project (reproducible-builds.org).
- OpenSSF Scorecard; the SLSA GitHub provenance generator.

---

## Related Topics

- [Artifact Signing & Provenance](../04-artifact-signing-and-provenance/) — the signing, attestation, and SLSA *mechanics* this file defers to.
- [Registries & Distribution](../05-registries-and-distribution/) — admission control, registry policy, and distribution.
- [Release Automation](../08-release-automation/) — embedding build-integrity and verification gates in the pipeline.
- [Build Systems](../../build-systems/) — hermeticity and reproducibility at the build-tool level (e.g. Bazel).
- [Static Analysis](../../static-analysis/) — complementary assurance on your own source.
- Adjacent tiers: [Junior](junior.md) · [Middle](middle.md) · [Professional](professional.md) · [Interview](interview.md).
