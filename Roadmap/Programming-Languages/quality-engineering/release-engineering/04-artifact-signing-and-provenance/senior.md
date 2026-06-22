# Artifact Signing & Provenance — Senior Level

> **Roadmap:** [Release Engineering](../README.md) → Artifact Signing & Provenance

*SLSA levels as an attack-defeat ladder, reproducible builds as a trust primitive, and a clear-eyed threat model of what signing does and does not buy you.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — SLSA Build levels as defeated-attack ladder](#core-concept-1--slsa-build-levels-as-defeated-attack-ladder)
5. [Core Concept 2 — The threat model: what signing does NOT protect against](#core-concept-2--the-threat-model-what-signing-does-not-protect-against)
6. [Core Concept 3 — Reproducible builds as a trust primitive](#core-concept-3--reproducible-builds-as-a-trust-primitive)
7. [Core Concept 4 — Hardened, isolated builders](#core-concept-4--hardened-isolated-builders)
8. [Core Concept 5 — Verification policy as code](#core-concept-5--verification-policy-as-code)
9. [Core Concept 6 — Trust roots and revocation under keyless](#core-concept-6--trust-roots-and-revocation-under-keyless)
10. [Core Concept 7 — Designing the verification gate under constraints](#core-concept-7--designing-the-verification-gate-under-constraints)
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

> Focus: **mapping SLSA levels to concrete attacks they defeat, treating reproducible builds as independent verification, and reasoning precisely about the residual risk signing leaves behind.**

A senior engineer is expected to answer "is this secure enough?" with a *threat model*, not a tool list. Signing and provenance are powerful but bounded controls. This file gives you the framework: which attacks each SLSA level stops, why reproducible builds are the only thing that lets a *third party* verify your binary, and the uncomfortable cases — malicious-but-authentic builds, compromised builders, trusted insiders — that no signature catches.

The governing truth, restated for this tier: **a signature establishes integrity and origin; it makes no claim about intent or safety.** Everything below is about pushing the boundary of *origin* assurance outward (toward the source and the build) and being explicit about where it stops.

---

## Prerequisites

- Middle level: Fulcio/Rekor, CI keyless signing, attestations, admission policy.
- Comfort reading a threat model and reasoning about adversary capabilities.
- Familiarity with build systems and sources of non-determinism (timestamps, paths, parallelism).
- Awareness of the **secrets-management** and **encryption-basics** skills for key/root-of-trust context.

---

## Glossary

| Term | Meaning |
|------|---------|
| SLSA Build L1–L3 | Levels describing increasing build-integrity guarantees. |
| Hermetic build | A build with no network/ambient inputs; all dependencies declared and pinned. |
| Reproducible build | Same sources + recorded environment → bit-for-bit identical output. |
| Non-determinism | Build inputs (time, paths, ordering) that vary run to run and change output bytes. |
| Builder | The platform that executes the build and (at L2+) issues provenance. |
| Trust root | The set of keys/identities a verifier ultimately trusts (Fulcio root, TUF root). |
| TUF | The Update Framework; how Sigstore distributes and rotates its trust root securely. |
| Threat model | Explicit statement of which adversaries and capabilities a control addresses. |
| Malicious-but-authentic | A genuinely-signed artifact whose contents are harmful. |
| SOURCE_DATE_EPOCH | A standard env var build tools honor to fix embedded timestamps. |

---

## Core Concept 1 — SLSA Build levels as defeated-attack ladder

SLSA's value is that each level is defined by the *attacks it forecloses*. Reason about it as a ladder, not a score.

**Build L1 — provenance exists, build is scripted.**
The build runs from a script (no manual `docker build` on a laptop) and emits provenance describing how. Defeats: *"nobody knows how this was built."* It gives you a record. It does **not** stop tampering — the provenance can be forged because nothing authoritative signs it.

**Build L2 — provenance is signed by a hosted build service.**
A hosted, version-controlled build platform generates and *signs* provenance. The provenance is now authenticated, tied to a builder identity. Defeats: *forged provenance* and *"I built it on my machine and lied about it."* It does **not** stop a build that is itself influenced by the thing being built (a malicious `Makefile`, a poisoned dependency executing at build time).

**Build L3 — hardened, isolated builder; non-falsifiable provenance.**
The builder runs each build in isolation so one build cannot influence another or forge another's provenance; secret material used to sign provenance is inaccessible to user-defined build steps. Defeats: *cross-build contamination*, *provenance forgery by the build itself*, *exfiltration of the provenance-signing key by build code.* This is the level where provenance becomes genuinely *non-falsifiable by the user*.

```bash
# Verify you actually received L3-grade, builder-signed provenance
slsa-verifier verify-image ghcr.io/acme/app@sha256:5d41402abc... \
  --source-uri github.com/acme/app \
  --builder-id "https://github.com/slsa-framework/slsa-github-generator/.github/workflows/generator_container_slsa3.yml@refs/tags/v2.0.0"
```

What *no* Build level addresses: a compromised **source repo** (the commit itself is malicious) and a malicious **dependency** pulled in legitimately. Those are different threat surfaces — see Supply-Chain Security.

---

## Core Concept 2 — The threat model: what signing does NOT protect against

State the boundary explicitly. Signing + provenance defeats:

- A compromised **registry/CDN/mirror** swapping bytes (integrity).
- An attacker **publishing a lookalike** artifact under your namespace (origin, via pinned identity).
- **Forged build metadata** (at L2/L3).

It does **not** defeat:

| Threat | Why signing misses it |
|--------|-----------------------|
| Malicious-but-authentic build | The harmful artifact is signed correctly by your real workflow. Authentic ≠ safe. |
| Compromised source commit | Provenance faithfully records the source — including the attacker's commit. |
| Poisoned dependency | The dep is genuinely part of the declared build; provenance vouches for it. |
| Compromised builder (full takeover) | If the builder is owned, it signs whatever the attacker wants, truthfully. |
| Trusted insider with signing identity | They are, by definition, an allowed signer. |
| A *bug* you shipped | Signing has no opinion on correctness. |

The SolarWinds attack is the canonical illustration: the *build system* was subverted, so malicious updates were *correctly signed* and passed every signature check downstream. The defense there is not "more signatures" — it is **L3 builder hardening, reproducible builds, and source controls**, narrowing how the build can be subverted in the first place.

Senior takeaway: present signing as **one layer**. It collapses the "transport and storage" attack surface to near zero and makes provenance auditable, but the *source → build* surface needs separate controls.

---

## Core Concept 3 — Reproducible builds as a trust primitive

A signature says "*I* built these bytes." A **reproducible build** says "*anyone* can rebuild the same bytes from the same source and check." That is qualitatively stronger: it converts trust in *you* into independently verifiable fact.

A build is reproducible when identical sources plus a recorded environment yield **bit-for-bit identical output**. The enemy is non-determinism. The usual sources and fixes:

- **Embedded timestamps** → honor `SOURCE_DATE_EPOCH`.
- **Absolute build paths** baked into binaries → strip/remap (`-ffile-prefix-map`, Go's `-trimpath`).
- **Non-deterministic ordering** (map iteration, parallel output, archive member order) → sort; use deterministic archivers.
- **Locale / timezone / hostname / `umask`** leaking in → pin in the build environment.
- **Unpinned dependencies** → lockfiles + content-addressed fetches.

```bash
# Go: trim paths and pin the build timestamp
export SOURCE_DATE_EPOCH=$(git log -1 --format=%ct)
go build -trimpath -buildvcs=false -o app ./cmd/app
sha256sum app   # should match an independent rebuild on the same toolchain
```

```bash
# Reproducibility check: build twice, compare digests
sha256sum app && (cd /tmp/clean && go build -trimpath -o app2 ./cmd/app && sha256sum app2)
# diffoscope shows WHAT differs if they don't match
diffoscope app app2
```

Reproducibility lets a verifier rebuild and compare, turning "trust the publisher" into "verify the publisher." It is the trust primitive behind Debian's reproducible-builds effort and a strong complement to SLSA: provenance says *how* it was built; reproducibility lets you *check the claim*.

---

## Core Concept 4 — Hardened, isolated builders

Build L3 demands a builder where:

- Each build is **isolated** — no shared mutable state, no ability to read or tamper with another build.
- The **provenance-signing material is unreachable** from user build steps. If `make` could read the signing key, malicious build code could mint false provenance.
- The build definition is **version-controlled and immutable** for a given run.

Practical realizations: GitHub Actions reusable workflows used via the SLSA generator (the signing happens in a context the job's own steps cannot touch), Google Cloud Build with provenance, Tekton Chains with isolated task pods. The common thread is **separation between "code under build" and "the authority that signs the provenance."**

Pair this with **hermetic builds** — no network during the build, all inputs pinned and content-addressed — so the build cannot pull in unrecorded, mutable inputs. Hermeticity is what makes provenance *complete*; isolation is what makes it *trustworthy*.

---

## Core Concept 5 — Verification policy as code

At scale, verification rules live in version control and are enforced by an engine, not by tribal command-line knowledge. Kyverno expresses rich policy:

```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: require-signed-and-attested
spec:
  validationFailureAction: Audit   # flip to Enforce after a soak period
  webhookTimeoutSeconds: 30
  rules:
    - name: verify-acme
      match:
        any:
          - resources: { kinds: [Pod] }
      verifyImages:
        - imageReferences: ["ghcr.io/acme/**"]
          failurePolicy: Fail
          attestors:
            - entries:
                - keyless:
                    subject: "https://github.com/acme/app/.github/workflows/release.yml@*"
                    issuer: "https://token.actions.githubusercontent.com"
                    rekor:
                      url: https://rekor.sigstore.dev
          attestations:               # require SLSA provenance too, not just a signature
            - type: https://slsa.dev/provenance/v1
              attestors:
                - entries:
                    - keyless:
                        subject: "https://github.com/acme/app/.github/workflows/release.yml@*"
                        issuer: "https://token.actions.githubusercontent.com"
              conditions:
                - all:
                    - key: "{{ regex_match('^github.com/acme/app$', '{{ buildDefinition.externalParameters.source.uri }}') }}"
                      operator: Equals
                      value: true
```

Policy-as-code gives you review, diff, rollout staging (`Audit` → `Enforce`), and a single source of truth. Treat the policy repo like any other production code: PRs, tests against known-good and known-bad images, and a break-glass path (see Professional level and the **quality-gates** topic).

---

## Core Concept 6 — Trust roots and revocation under keyless

Keyless removes per-publisher keys but does not remove *trust roots*. A verifier ultimately trusts:

- **Fulcio's root CA** — to mean its certificates are legitimately identity-bound.
- **Rekor's key** — to mean log entries are authentic.
- The **OIDC issuer** — to mean an identity assertion is real.

Sigstore distributes and rotates these via **TUF (The Update Framework)**, which provides secure, rotatable, replay-resistant root distribution. `cosign initialize` fetches/refreshes the TUF root; air-gapped or high-assurance orgs may run their **own Sigstore stack** (private Fulcio/Rekor) and pin their own root.

```bash
# Refresh the trust root (public good instance)
cosign initialize

# Or pin a private/own trust root bundle
cosign verify --trusted-root=trusted_root.json ...
```

**Revocation** works differently than with long-lived keys. There is no "revoke this key" because the key lived minutes. Instead you respond by **tightening verification policy**: if a workflow or identity is compromised, you stop *accepting* its signatures (narrow the allowed identity/issuer, or cut off a time window using Rekor timestamps). The Rekor log is also how you *audit* what a compromised identity signed and when. This is a different operational mindset — you manage *acceptance policy*, not key lifecycles.

---

## Core Concept 7 — Designing the verification gate under constraints

Real gates run under constraints: latency budgets, registry availability, air-gap, false-positive tolerance.

- **Availability of Sigstore services.** Verification touches Rekor/Fulcio roots. Cache the TUF root, consider an internal Rekor mirror, and decide your **fail-open vs fail-closed** stance per environment (fail-closed in prod; perhaps fail-open with alerting in a low-risk dev cluster).
- **Latency at admission.** Image verification adds time to pod admission. Pre-verify in the pipeline and **resolve tags to digests at deploy**, so admission verifies a digest you already proved, not a re-resolved tag.
- **Air-gapped environments.** Mirror signatures and attestations alongside images; run a private Sigstore or pre-verify at import and re-sign with an internal identity.
- **Third-party images.** You often *cannot* require *your* identity. Strategy: re-verify the vendor's signature at import, then **re-attest with your own identity** ("we vetted this"), and have prod require *your* attestation. This gives a uniform internal trust root.
- **Gradual tightening.** Start by requiring a signature; add provenance; then add source/builder constraints. Each step is a separate, measurable rollout.

The senior skill is choosing *where in the lifecycle* verification happens (build, import, admission, runtime) and *what to require at each*, balancing assurance against availability and operational cost.

---

## Real-World Examples

- **SolarWinds (2020).** Subverted build pipeline produced correctly-signed malicious updates — the textbook case for L3 + reproducible builds over "just sign it."
- **Debian Reproducible Builds.** A large-scale effort proving the published binaries match the source, independently of the maintainers.
- **Chainguard / Wolfi.** Images shipped with SLSA provenance and SBOM attestations, built on hardened builders.
- **Kubernetes project signing.** Release artifacts are cosign-signed and provenance-attested; consumers can verify with `slsa-verifier`.
- **Go module checksum database.** A transparency-log model (`sum.golang.org`) ensuring everyone sees the same module bytes — provenance thinking applied to dependencies.

---

## Mental Models

- **SLSA is a ladder of removed assumptions.** Each rung deletes a "you just have to trust us" — L1 records, L2 authenticates, L3 isolates.
- **Reproducibility converts trust into verification.** Signing asks you to trust the builder; reproducibility lets you *check* the builder.
- **Signing shrinks the attack surface; it does not eliminate it.** It collapses transport/storage risk and makes provenance auditable — the source/build surface remains.
- **Keyless trades key management for policy management.** You no longer rotate keys; you curate *who you accept* and audit via Rekor.
- **Verify the claim where it is cheapest and earliest.** Resolve to digests early; verify digests, not re-resolved tags, at admission.

---

## Common Mistakes

- **Selling signing as "now we are secure."** It is one layer; name the residual threats (malicious-but-authentic, compromised source/builder, insiders).
- **Requiring provenance but not constraining its contents.** Demand the *source URI* and *builder ID*, not merely "some provenance exists."
- **Ignoring builder isolation.** L1/L2 provenance from a builder where build steps can reach the signing key is forgeable.
- **Assuming reproducibility for free.** Timestamps, paths, and ordering silently break it; you must engineer determinism and *test* it (build twice, diffoscope).
- **No fail-open/fail-closed decision.** Treating Sigstore availability as guaranteed makes verification a new outage source.
- **Forgetting revocation is policy, not keys.** When an identity is compromised, you tighten acceptance and audit Rekor — there is no key to revoke.

---

## Test Yourself

1. For each SLSA Build level, name one attack it defeats and one it does not.
2. Why is a reproducible build a stronger trust statement than a signature alone?
3. Explain precisely why SolarWinds-style attacks pass signature verification.
4. Under keyless signing, how do you respond to a compromised signing identity if there is no key to revoke?
5. Where in the deploy lifecycle should verification run to avoid a tag-vs-digest gap, and why?
6. List three sources of build non-determinism and the fix for each.

---

## Cheat Sheet

```bash
# Provenance verification pinned to builder + source
slsa-verifier verify-image IMG@sha256:... \
  --source-uri github.com/acme/app \
  --builder-id "https://github.com/slsa-framework/.../generator_container_slsa3.yml@refs/tags/v2.0.0"

# Reproducibility hygiene
export SOURCE_DATE_EPOCH=$(git log -1 --format=%ct)
go build -trimpath -o app ./cmd/app
diffoscope app app2          # explain any divergence

# Trust root management
cosign initialize                          # refresh TUF root
cosign verify --trusted-root=root.json ... # pin a private root
```

| Concern | Lever |
|---------|-------|
| Forged provenance | SLSA L2+ (builder-signed) |
| Build influencing build | SLSA L3 (isolation) |
| "Trust us" on binaries | reproducible builds |
| Compromised identity | tighten acceptance policy + audit Rekor |
| Sigstore outage | cache TUF root, mirror Rekor, set fail stance |

---

## Summary

- SLSA Build **L1→L3** is a ladder that progressively removes "trust us" assumptions: record → authenticate → isolate.
- Signing defeats transport/storage tampering and lookalikes but **not** malicious-but-authentic builds, compromised source/builders, or insiders. State this boundary.
- **Reproducible builds** turn trust into independent verification; engineer away non-determinism and test it.
- **Builder hardening + hermeticity** are what make provenance trustworthy and complete.
- Keyless shifts you from **key lifecycle management to acceptance-policy management**, with Rekor as the audit trail; manage trust roots via TUF.
- Design the gate deliberately: verify digests early, decide fail-open/closed, handle third-party and air-gap cases.

---

## Further Reading

- SLSA specification — Build track levels and requirements.
- reproducible-builds.org — sources of non-determinism and tooling (diffoscope).
- Sigstore architecture — Fulcio, Rekor, TUF trust root.
- CISA / NIST analyses of the SolarWinds compromise.

---

## Related Topics

- [Supply-Chain Security](../09-supply-chain-security/) — source integrity, SBOMs, dependency threats signing does not cover.
- [Registries & Distribution](../05-registries-and-distribution/) — storing/mirroring signatures and attestations, air-gap.
- [Release Automation](../08-release-automation/) — building hermetic, reproducible, attested pipelines.
- [Rollback & Roll-Forward](../07-rollback-and-roll-forward/) — verifying the target of a rollback.
