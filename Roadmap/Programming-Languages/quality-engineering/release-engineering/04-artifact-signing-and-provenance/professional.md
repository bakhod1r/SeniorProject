# Artifact Signing & Provenance — Professional Level

> **Roadmap:** [Release Engineering](../README.md) → Artifact Signing & Provenance

*Org-wide root-of-trust strategy, key/identity lifecycle, a staged enforcement rollout that doesn't break delivery, and the regulatory drivers behind all of it.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Choosing a signing strategy for the whole org](#core-concept-1--choosing-a-signing-strategy-for-the-whole-org)
5. [Core Concept 2 — Root of trust and key/identity lifecycle](#core-concept-2--root-of-trust-and-keyidentity-lifecycle)
6. [Core Concept 3 — Staged enforcement rollout](#core-concept-3--staged-enforcement-rollout)
7. [Core Concept 4 — Break-glass and incident response](#core-concept-4--break-glass-and-incident-response)
8. [Core Concept 5 — Operational cost and the burden ledger](#core-concept-5--operational-cost-and-the-burden-ledger)
9. [Core Concept 6 — Regulatory drivers: EO 14028, SSDF, and attestations](#core-concept-6--regulatory-drivers-eo-14028-ssdf-and-attestations)
10. [Core Concept 7 — Metrics, audit, and proving the program works](#core-concept-7--metrics-audit-and-proving-the-program-works)
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

> Focus: **running signing and provenance as an organizational program — trust architecture, lifecycle, enforcement sequencing, incident response, cost, and the compliance mandates that fund the work.**

By this tier the cryptography is the easy part. The hard parts are organizational: which identities the whole company trusts, how trust roots rotate without a global outage, how to enforce policy without blocking Friday's release, what happens when Sigstore is down at 2am, and how to satisfy an auditor citing Executive Order 14028. This file is about turning a working sign/verify capability into a durable, governed program.

The recurring principle: **sign first, enforce later, and instrument throughout.** You cannot enforce what you cannot measure, and you cannot measure what you have not been signing.

---

## Prerequisites

- Senior level: SLSA levels, threat model, reproducible builds, trust roots, policy-as-code.
- Experience operating a platform/release function across multiple teams.
- Familiarity with the **secrets-management** skill (KMS, HSM concepts) and **encryption-basics**.
- Awareness of compliance/audit processes in regulated environments.

---

## Glossary

| Term | Meaning |
|------|---------|
| Root of trust | The keys/identities everything else's trust derives from. |
| KMS / HSM | Key Management Service / Hardware Security Module — managed/hardware-protected key custody. |
| TUF root | The top-level Sigstore trust metadata, rotatable, distributed securely. |
| Identity strategy | The org's rules for *which* signer identities are valid for *which* artifacts. |
| Break-glass | A controlled, audited bypass for emergencies. |
| EO 14028 | US Executive Order on improving cybersecurity (2021); drove SBOM/provenance mandates. |
| SSDF | NIST Secure Software Development Framework (SP 800-218). |
| SLSA L3 | Hardened, isolated builder producing non-falsifiable provenance. |
| Attestation store | Where signatures/attestations are kept and queried (registry, Rekor, internal). |
| Acceptance policy | The set of identities/provenance constraints a verifier admits. |

---

## Core Concept 1 — Choosing a signing strategy for the whole org

There is no single right answer; there is a decision with explicit trade-offs.

**Keyless (Sigstore public good).** No keys to manage; identity-bound; transparency by default; free.
*Costs:* dependency on external Sigstore availability and OIDC; public Rekor reveals *that* you released (metadata exposure); requires trusting the public trust root.

**Self-hosted Sigstore (private Fulcio/Rekor).** Same model, internal control; works air-gapped; no public metadata leak.
*Costs:* you now operate a CA and a transparency log — real SRE burden, your own root-of-trust to protect.

**Long-lived keys in KMS/HSM.** Familiar; works offline; fine for a small set of high-value, infrequently-rotated release keys (e.g. an OS distro's master key).
*Costs:* the very key-management failure modes Sigstore was built to avoid — rotation, custody, the "who can sign" sprawl. GPG-era pain (lost keys, unverified web-of-trust) is the cautionary history.

A common professional pattern is **hybrid**: keyless (public or private) for the high-volume CI-built artifacts, plus a small number of **KMS-backed keys** for a few sensitive boundaries (e.g. the policy that admits third-party software, signed by a platform-team key). Pin **identities, not key files**, wherever possible — an identity (`release.yml@tag` from the org's IdP) is far harder to misuse than a portable secret.

Decision drivers to write down: air-gap requirement, metadata-exposure tolerance, regulatory scope, team maturity, and acceptable external dependencies.

---

## Core Concept 2 — Root of trust and key/identity lifecycle

Whatever the strategy, define the **root of trust** explicitly and govern its lifecycle.

**For keyless:** the roots are Fulcio's CA, Rekor's key, and your OIDC issuer. Sigstore rotates these via **TUF**; your responsibility is to pin and refresh the TUF root reliably across all verifiers, and to *constrain accepted identities* tightly.

**For self-hosted/KMS:** you own the root. Apply standard high-assurance custody:

- Root key in an **HSM**, offline, with **M-of-N** quorum to use (no single human can sign with it).
- The root signs only **intermediate/signing identities**, rarely; day-to-day signing uses short-lived or scoped keys.
- **Rotation is pre-planned**: publish the new root, allow an overlap window where both are trusted, then retire the old. Never a flag-day swap.

```bash
# KMS-backed signing (no private key on the box)
cosign sign --key awskms:///alias/release-signing IMG@sha256:...
cosign verify --key awskms:///alias/release-signing IMG@sha256:...

# Refresh the (public or mirrored) Sigstore trust root everywhere verification runs
cosign initialize --mirror https://tuf-mirror.internal --root root.json
```

**Identity strategy** is the higher-leverage half. Maintain a governed registry of "who may sign what":

| Artifact class | Required signer identity | Required provenance |
|----------------|--------------------------|---------------------|
| First-party services | `…/release.yml@refs/tags/*` via org IdP | SLSA source = our repo, builder = our generator |
| Internal base images | platform-team workflow identity | SLSA L3 |
| Vetted third-party | platform-team *attestation* identity | re-attested "approved" predicate |

This table *is* your acceptance policy. Changes to it go through review like any production change.

---

## Core Concept 3 — Staged enforcement rollout

The fastest way to discredit a signing program is to switch on hard enforcement and block legitimate deploys. Sequence it.

**Phase 0 — Sign everything (no enforcement).**
Turn on signing + provenance in every pipeline. Nothing is blocked. Goal: achieve *coverage* and find pipelines that cannot yet sign.

**Phase 1 — Observe (audit mode).**
Deploy admission policy in `Audit`/`warn`. Emit metrics: how many workloads *would* be blocked, and why (unsigned, wrong identity, missing provenance). This is your gap list.

**Phase 2 — Enforce on a beachhead.**
Flip `Enforce` for one low-risk namespace/cluster or one mature team. Keep escape hatches and watch closely.

**Phase 3 — Expand by ring.**
Roll enforcement outward ring by ring (dev → staging → prod; team by team), each ring gated on a clean audit signal from the previous.

**Phase 4 — Tighten requirements.**
Only after signature enforcement is stable do you add *provenance* requirements, then *source/builder* constraints. Each is its own audit→enforce cycle.

```yaml
# The single most important rollout lever lives in policy:
spec:
  validationFailureAction: Audit    # Phase 1
  # validationFailureAction: Enforce  # Phase 2+, ring by ring
```

Treat enforcement like a feature flag rollout (see Feature Flags & Progressive Delivery): measurable, reversible, ringed. The **quality-gates** topic covers the gate-design discipline this mirrors.

---

## Core Concept 4 — Break-glass and incident response

Enforcement *will* eventually block a legitimate, urgent deploy — a critical hotfix when Sigstore is degraded, or a pipeline gap during an incident. A program without a sanctioned bypass invites unsanctioned ones (disable the controller cluster-wide), which is far worse.

Design break-glass to be **possible, narrow, loud, and audited**:

- **Possible:** a documented procedure (e.g. an exception annotation/label admitted only by a separate, tightly-scoped policy, or a temporary policy carve-out via PR).
- **Narrow:** scoped to one image digest / one namespace / a time-boxed window, never "disable verification."
- **Loud:** firing an alert and creating a ticket automatically; visible to security in real time.
- **Audited:** who invoked it, for what digest, when, why, and an expiry. Reviewed post-incident.

```yaml
# Example: a narrowly-scoped exception, itself reviewed and time-boxed
metadata:
  annotations:
    policy.acme.io/break-glass: "INC-4821"     # ticket ref, alerts on use
    policy.acme.io/break-glass-expires: "2026-06-23T06:00:00Z"
```

Tie this to the **rollback** plan: if you cannot verify a roll-forward fix in time, rolling back to a *previously verified* digest is often the safer break-glass than admitting an unverified image. See Rollback & Roll-Forward. The **secrets-management** discipline applies to any KMS bypass credentials.

---

## Core Concept 5 — Operational cost and the burden ledger

Sell and run the program with honest numbers. The recurring burdens:

- **Pipeline changes** across every repo (one-time, but broad) — `id-token` perms, signing steps, provenance generators.
- **Verification infrastructure** — admission controllers, their availability, latency budget at admission, and TUF-root/Rekor mirroring.
- **Availability coupling** — verification now depends on Sigstore/OIDC/registry. Budget for caching and a fail stance, or you have added a new outage class.
- **Policy maintenance** — the acceptance registry evolves with every new repo/builder; it needs owners and review.
- **Reproducibility engineering** — if you pursue it, real toolchain work and ongoing drift control.
- **Cognitive load** on developers when a deploy is blocked — invest in *clear failure messages* ("blocked: image not signed by an approved identity; see runbook X").

The payoffs to weigh against this: closed transport/storage attack surface, auditable provenance for compliance, faster incident forensics (Rekor shows exactly what shipped), and a precondition for several regulatory regimes. Make the trade explicit; do not let it be discovered as surprise toil.

---

## Core Concept 6 — Regulatory drivers: EO 14028, SSDF, and attestations

Much of this work is funded by compliance, and a professional should map controls to mandates.

- **Executive Order 14028 (2021)** directed US federal agencies to require secure software practices from suppliers, catalyzing SBOMs and provenance.
- **NIST SSDF (SP 800-218)** is the framework EO 14028 points to; its practices include producing and verifying provenance, protecting build environments, and archiving artifacts and their attestations.
- **CISA Secure Software Development Attestation Form** asks vendors to *attest* (literally) that they follow SSDF practices — produced provenance, hardened builds, etc.
- **SLSA** is the de facto technical yardstick procurement and auditors reference for "build integrity level."

Practically, this means your signing/provenance program should be able to **produce evidence**: "every prod artifact in scope has a SLSA L3 provenance attestation, signed by an approved builder identity, recorded in Rekor, retained for N years." Design the attestation store and retention to answer auditor questions directly, and align your control descriptions to SSDF practice IDs so the mapping is mechanical, not narrative.

---

## Core Concept 7 — Metrics, audit, and proving the program works

Instrument the program as a product. Useful indicators:

| Metric | Why it matters |
|--------|----------------|
| Signing coverage (% artifacts signed) | Phase-0 progress; gaps = blind spots. |
| Provenance coverage (% with SLSA L3) | Maturity beyond bare signatures. |
| Audit-mode block rate & reasons | The gap list before you enforce. |
| Enforcement violations (post-cutover) | Should trend to ~zero; spikes = a real attempt or a broken pipeline. |
| Break-glass invocations | Each is a story; rising count = a policy or availability problem. |
| Verification availability / p99 latency | Have you added an outage/latency class? |

```bash
# Spot-audit: prove a running prod digest is signed + attested by an approved identity
DIGEST=ghcr.io/acme/app@sha256:5d41402abc...
cosign verify --certificate-identity-regexp='^https://github.com/acme/' \
  --certificate-oidc-issuer=https://token.actions.githubusercontent.com "$DIGEST"
cosign verify-attestation --type slsaprovenance \
  --certificate-identity-regexp='^https://github.com/acme/' \
  --certificate-oidc-issuer=https://token.actions.githubusercontent.com "$DIGEST"

# Query the transparency log for everything an identity ever signed (forensics)
rekor-cli search --email release@acme.io
```

These numbers drive the rollout (when to enforce the next ring), justify the spend, and produce the audit evidence in Concept 6. A signing program you cannot measure is one you cannot defend in a review or an incident.

---

## Real-World Examples

- **Kubernetes & CNCF projects.** Org-wide cosign signing + SLSA provenance with published verification instructions; a template for a large multi-repo program.
- **Major OS distributions.** Long-lived HSM-protected master keys with quorum and planned rotation — the KMS/HSM end of the spectrum.
- **US federal software procurement.** Vendors submitting CISA attestation forms mapped to SSDF, with SLSA provenance as evidence.
- **Large enterprises adopting Kyverno/policy-controller.** Multi-quarter audit→enforce rollouts ringed by environment, with documented break-glass.
- **Internal Sigstore deployments.** Banks/regulated orgs running private Fulcio/Rekor to avoid public metadata exposure and external dependencies.

---

## Mental Models

- **Sign first, enforce later, measure always.** Coverage precedes enforcement; metrics gate every tightening step.
- **Identity registry = acceptance policy.** "Who may sign what" is a governed table, reviewed like prod code.
- **Break-glass is a designed feature, not a failure.** If you don't build a narrow, loud bypass, people build a wide, silent one.
- **Compliance buys the budget; engineering earns the trust.** Map controls to SSDF/EO to fund the work; deliver real attack-surface reduction to justify it.
- **Verification availability is now production.** Caching and a fail stance are not optional once you enforce.

---

## Common Mistakes

- **Flag-day enforcement.** Turning on `Enforce` org-wide blocks legitimate deploys and burns trust. Ring it.
- **No break-glass.** Leads to ad-hoc, unaudited bypasses (disabling the controller) — worse than the original risk.
- **Unbounded identity policy.** Accepting "any identity from our org" lets any workflow sign release artifacts. Constrain to specific workflows.
- **Ignoring availability coupling.** Verification depending on un-cached Sigstore/OIDC becomes a new outage source.
- **Treating it as a tooling project, not a program.** No owners for the acceptance registry, no metrics, no retention → it rots.
- **Mistaking attestation paperwork for security.** A signed SSDF form over a weak build process is compliance theater; pair attestation with real L3/reproducibility.
- **Reinventing GPG key sprawl.** Long-lived portable keys per team recreate exactly the failures keyless was meant to fix.

---

## Test Yourself

1. Compare keyless public, self-hosted Sigstore, and KMS/HSM keys on three explicit trade-offs each.
2. How do you rotate a self-owned root of trust without a flag-day outage?
3. Lay out the staged rollout from "no signing" to "enforce source+builder provenance." What gates each step?
4. Design a break-glass mechanism: list its four required properties and how you'd implement each.
5. Map three of your controls to EO 14028 / SSDF expectations.
6. Which metrics tell you it is safe to enforce the next ring, and which signal a problem after cutover?

---

## Cheat Sheet

```bash
# KMS-backed signing/verification
cosign sign   --key awskms:///alias/release-signing IMG@sha256:...
cosign verify --key awskms:///alias/release-signing IMG@sha256:...

# Trust-root refresh (mirrored)
cosign initialize --mirror https://tuf-mirror.internal --root root.json

# Forensics / audit
rekor-cli search --email release@acme.io
cosign verify-attestation --type slsaprovenance --certificate-identity-regexp='...' --certificate-oidc-issuer='...' IMG@sha256:...
```

| Phase | Policy setting | Exit criterion |
|-------|----------------|----------------|
| 0 Sign all | none | high signing coverage |
| 1 Observe | `Audit` | gap list addressed |
| 2 Beachhead | `Enforce` (1 ns) | clean signal |
| 3 Expand | `Enforce` (rings) | each ring clean |
| 4 Tighten | + provenance/source | audit→enforce per requirement |

---

## Summary

- Pick a signing strategy by **explicit trade-offs** (keyless public/private vs KMS/HSM); hybrids are common, and pinning **identities beats portable keys**.
- Define and govern the **root of trust**: TUF for keyless, HSM + quorum + overlap-window rotation for self-owned. The **identity registry is your acceptance policy**.
- Roll out enforcement in **stages** — sign, audit, beachhead, ring-expand, tighten — each gated on metrics; never a flag day.
- Build **break-glass** that is possible, narrow, loud, and audited, integrated with rollback.
- Account for **operational cost and availability coupling** honestly; verification is now production infrastructure.
- **EO 14028 / SSDF / SLSA** drive funding and shape the evidence your attestation store must produce; pair compliance with real build hardening.

---

## Further Reading

- NIST SP 800-218 (SSDF) and the CISA Secure Software Development Attestation Form.
- Executive Order 14028 and follow-on OMB memoranda (M-22-18, M-23-16).
- Sigstore self-hosting / TUF root rotation docs.
- Kyverno and Sigstore policy-controller production deployment guides.
- SLSA specification — verification and provenance requirements.

---

## Related Topics

- [Supply-Chain Security](../09-supply-chain-security/) — SBOMs, dependency and source controls, the full program.
- [Registries & Distribution](../05-registries-and-distribution/) — attestation storage, mirroring, air-gap.
- [Feature Flags & Progressive Delivery](../06-feature-flags-and-progressive-delivery/) — the ringed-rollout pattern enforcement borrows.
- [Rollback & Roll-Forward](../07-rollback-and-roll-forward/) — verified rollback as a break-glass option.
- [Release Automation](../08-release-automation/) — embedding signing, provenance, and verification in pipelines.
