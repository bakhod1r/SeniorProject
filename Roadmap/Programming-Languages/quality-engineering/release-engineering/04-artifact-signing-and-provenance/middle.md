# Artifact Signing & Provenance — Middle Level

> **Roadmap:** [Release Engineering](../README.md) → Artifact Signing & Provenance

*From "I signed an image" to a real workflow: keyless signing in CI, attestations, and admission policies that reject anything unproven.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Inside Sigstore: Fulcio and Rekor](#core-concept-1--inside-sigstore-fulcio-and-rekor)
5. [Core Concept 2 — Signing from CI with workload identity](#core-concept-2--signing-from-ci-with-workload-identity)
6. [Core Concept 3 — Signed vs provenance: attestations](#core-concept-3--signed-vs-provenance-attestations)
7. [Core Concept 4 — SLSA provenance in practice](#core-concept-4--slsa-provenance-in-practice)
8. [Core Concept 5 — Verifying signatures and attestations](#core-concept-5--verifying-signatures-and-attestations)
9. [Core Concept 6 — Enforcing at admission](#core-concept-6--enforcing-at-admission)
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

> Focus: **building an end-to-end keyless signing and attestation pipeline, and a verification gate that admits only signed, attested artifacts from a trusted builder.**

At the junior level you signed and verified one image by hand. In a real org the signer is **CI, not a human**, and the consumer is an **admission controller, not a person reading output**. This file connects those ends: how Sigstore issues identity-bound signatures with no stored keys, how to emit *provenance* describing the build (not just a signature over the bytes), and how to make a cluster refuse anything that does not meet your policy.

The mental upgrade here is the difference between **"signed"** (someone vouched for these exact bytes) and **"provenance"** (here is the verifiable story of *what built this, from which source, on which builder*). You need both.

---

## Prerequisites

- Junior level of this topic (hashes, signatures, keyless cosign, authentic ≠ safe).
- Working knowledge of a CI system, ideally GitHub Actions (OIDC tokens) or GitLab CI.
- Basic Kubernetes: what an admission controller is, what a pod spec references.
- Familiarity with JSON and digests. The **docker-best-practices** and **secrets-management** skills help.

---

## Glossary

| Term | Meaning |
|------|---------|
| Fulcio | Sigstore's certificate authority; trades an OIDC identity token for a short-lived signing certificate. |
| Rekor | Sigstore's public, append-only transparency log of signatures and attestations. |
| OIDC | OpenID Connect; the protocol that lets a CI job prove "I am workflow X in repo Y." |
| Attestation | A signed statement *about* an artifact (its provenance, SBOM, vuln scan), not just a signature over its bytes. |
| in-toto | A framework/format for signed software-supply-chain statements; the envelope cosign attestations use. |
| Predicate | The typed payload of an attestation (e.g. a SLSA provenance document). |
| SLSA | "Supply-chain Levels for Software Artifacts"; a framework of build-integrity levels. |
| Provenance | Verifiable metadata: source, build steps, builder identity, parameters. |
| Admission controller | A Kubernetes component that can accept or reject workloads before they run. |
| policy-controller | Sigstore's admission controller that enforces signature/attestation policy. |

---

## Core Concept 1 — Inside Sigstore: Fulcio and Rekor

Keyless signing has two pillars.

**Fulcio** is a certificate authority that does not care about long-lived keys. cosign generates an *ephemeral* key pair in memory, presents your OIDC identity token, and Fulcio returns an X.509 certificate that:

- is valid for roughly 10 minutes, and
- embeds your identity (email, or for CI, the workflow URL) in the certificate's SAN extension.

cosign signs with the ephemeral private key, then throws it away. There is no key to leak, rotate, or revoke.

**Rekor** is an append-only **transparency log**. Every signature and attestation is recorded with a timestamp and the signing certificate. This gives two things:

1. **Non-repudiation** — there is a public, tamper-evident record that identity X signed digest D at time T.
2. **Timestamping** — because the cert lived only minutes, you need proof the signature was made *while the cert was valid*. Rekor's countersignature provides that, so verification still works long after the cert expired.

```bash
# Inspect what was logged for an image
cosign tree registry.example.com/app@sha256:5d41402abc...
# shows signatures and attestations attached to the digest
```

The chain of trust becomes: *I trust the OIDC issuer to identify the signer → Fulcio to bind that identity into a cert → Rekor to prove the signature happened in-window.*

---

## Core Concept 2 — Signing from CI with workload identity

In production the signer is a pipeline. GitHub Actions can mint an OIDC token that *is* the build's identity — no secret stored anywhere.

```yaml
# .github/workflows/release.yml
name: release
on:
  push:
    tags: ['v*']

permissions:
  id-token: write        # REQUIRED: lets the job request an OIDC token
  packages: write        # push to GHCR
  contents: read

jobs:
  build-sign:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: sigstore/cosign-installer@v3

      - name: Build & push
        id: build
        run: |
          IMAGE=ghcr.io/acme/app
          docker build -t $IMAGE:${GITHUB_REF_NAME} .
          docker push $IMAGE:${GITHUB_REF_NAME}
          DIGEST=$(docker inspect --format='{{index .RepoDigests 0}}' $IMAGE:${GITHUB_REF_NAME})
          echo "digest=$DIGEST" >> "$GITHUB_OUTPUT"

      - name: Sign (keyless, identity = this workflow)
        env:
          COSIGN_EXPERIMENTAL: "1"
        run: cosign sign --yes ${{ steps.build.outputs.digest }}
```

The resulting certificate's identity is not a person — it is the workflow, e.g.:

```
https://github.com/acme/app/.github/workflows/release.yml@refs/tags/v1.4.0
```

That string is what consumers will later *require*. It pins not just "acme signed this" but "acme's *release* workflow, from a tag, signed this." A leaked developer laptop cannot reproduce it.

---

## Core Concept 3 — Signed vs provenance: attestations

A plain signature answers: *did the holder of identity X vouch for digest D?* It says nothing about *how* D came to exist.

An **attestation** is a signed statement *about* the artifact. It uses the **in-toto** envelope: a `subject` (which artifact, by digest) plus a typed `predicate` (the claim). Common predicate types:

- **SLSA provenance** — what built this and from where.
- **SBOM** — the software bill of materials (dependencies).
- **Vulnerability scan** — results at build time.

```bash
# Attach an SBOM as a signed attestation
cosign attest --yes \
  --predicate sbom.spdx.json \
  --type spdxjson \
  registry.example.com/app@sha256:5d41402abc...
```

The distinction to internalize:

- **Signed** = integrity + a voucher. "These bytes weren't changed and X stands behind them."
- **Provenance/attestation** = a verifiable build story. "This came from commit `abc123` of `acme/app`, built by GitHub Actions workflow `release.yml`, with these parameters."

You want both because a signature alone cannot tell a malicious-but-authentic build from a clean one — provenance lets a verifier insist the artifact came from an *expected source and builder*.

---

## Core Concept 4 — SLSA provenance in practice

SLSA provenance is a standardized predicate describing the build. The cleanest way to produce trustworthy provenance is to let the **build platform** generate it, so the values are not self-asserted by the thing being built. The SLSA project ships reusable GitHub Actions generators:

```yaml
# Use the SLSA generator to build + emit provenance for a container
jobs:
  provenance:
    permissions:
      id-token: write
      packages: write
      actions: read
    uses: slsa-framework/slsa-github-generator/.github/workflows/generator_container_slsa3.yml@v2.0.0
    with:
      image: ghcr.io/acme/app
      digest: ${{ needs.build.outputs.digest }}
```

The provenance predicate (abbreviated) records:

```json
{
  "buildType": "https://github.com/slsa-framework/...",
  "builder": { "id": "https://github.com/acme/app/.github/workflows/release.yml@refs/tags/v1.4.0" },
  "invocation": {
    "configSource": {
      "uri": "git+https://github.com/acme/app@refs/tags/v1.4.0",
      "digest": { "sha1": "abc123..." }
    }
  }
}
```

Now a verifier can demand: this image must have provenance whose **source repo** is `acme/app` and whose **builder** is our trusted workflow. That defeats "attacker pushed a lookalike image" because the attacker cannot produce provenance signed by *your* builder pointing at *your* source.

---

## Core Concept 5 — Verifying signatures and attestations

Verification escalates from "is it signed" to "is it signed *and* does its provenance match what I require."

```bash
# 1. Verify the signature, pinning the CI identity
cosign verify \
  --certificate-identity-regexp='^https://github.com/acme/app/' \
  --certificate-oidc-issuer=https://token.actions.githubusercontent.com \
  ghcr.io/acme/app@sha256:5d41402abc... | jq .

# 2. Verify a SLSA provenance attestation exists and matches
cosign verify-attestation \
  --type slsaprovenance \
  --certificate-identity-regexp='^https://github.com/acme/app/' \
  --certificate-oidc-issuer=https://token.actions.githubusercontent.com \
  ghcr.io/acme/app@sha256:5d41402abc...
```

For artifacts built with the SLSA generator, `slsa-verifier` checks the provenance against expected source and builder in one step:

```bash
slsa-verifier verify-image ghcr.io/acme/app@sha256:5d41402abc... \
  --source-uri github.com/acme/app \
  --source-tag v1.4.0
```

Note how every verify command states **expectations** (identity, issuer, source, tag). Verification with no expectations is theater; the security comes from what you *require*.

---

## Core Concept 6 — Enforcing at admission

Manual verification does not scale. You push enforcement to the place where artifacts are *used*. In Kubernetes, Sigstore's **policy-controller** (or **Kyverno**) rejects pods whose images do not meet policy.

```yaml
# Sigstore policy-controller: only admit images signed by our release workflow
apiVersion: policy.sigstore.dev/v1beta1
kind: ClusterImagePolicy
metadata:
  name: require-acme-signature
spec:
  images:
    - glob: "ghcr.io/acme/**"
  authorities:
    - keyless:
        url: https://fulcio.sigstore.dev
        identities:
          - issuer: https://token.actions.githubusercontent.com
            subjectRegExp: "^https://github.com/acme/app/.github/workflows/release.yml@.*$"
```

A pod referencing an unsigned or wrong-identity image is denied before it ever runs. Beyond container platforms, the same principle shows up across ecosystems: `npm audit signatures` checks installed packages' Sigstore signatures, and **Maven Central requires PGP-signed artifacts** for publication.

> Rollout wisdom: deploy in **warn/audit mode first**, watch what *would* be blocked, fix the gaps, then flip to **enforce**. Turning on hard enforcement blind will block legitimate deploys and erode trust in the control. More on sequencing at the Senior level.

---

## Real-World Examples

- **GitHub Actions + npm provenance.** Publishing with `--provenance` generates Sigstore-backed SLSA provenance; the npm registry shows a "provenance" badge and `npm audit signatures` verifies it.
- **Kubernetes with Kyverno.** Many platform teams run a Kyverno `verifyImages` rule requiring a specific keyless identity, in audit mode for weeks before enforcing.
- **Distroless / Chainguard images.** Shipped with cosign signatures and SBOM attestations consumers can verify.
- **Tekton Chains.** Automatically signs and emits provenance for artifacts built in Tekton pipelines.

---

## Mental Models

- **Signature = sealed envelope; attestation = notarized affidavit inside.** The seal proves it is unopened; the affidavit describes who made the contents and how.
- **Rekor is a public ledger.** Like a blockchain of "X signed Y at time T" — append-only, independently auditable, the reason expired short-lived certs still verify.
- **Verification is a contract, not a checkbox.** You are not asking "is it signed?" You are asking "is it signed by *exactly who I expect*, built from *exactly what I expect*?"
- **Audit before enforce.** A policy in audit mode is a smoke detector; in enforce mode it is a locked door. Install the detector first.

---

## Common Mistakes

- **`cosign verify` without identity flags.** Accepts any Sigstore signer, including an attacker's. Always pin identity *and* issuer.
- **Confusing signed with provenance.** A signed image can still be a malicious authentic build; require provenance pinned to source + builder.
- **Self-asserted provenance.** Provenance generated *by the build artifact itself* is only as trustworthy as the artifact. Prefer builder-generated (SLSA generator, Tekton Chains).
- **Forgetting `id-token: write`.** Without it the CI job cannot get an OIDC token and keyless signing fails.
- **Enforcing on day one.** Hard-blocking before measuring breaks legitimate workloads. Audit first.
- **Pinning identity by tag only.** `subjectRegExp` should constrain the workflow path, not just the org, or any workflow in the org can sign.

---

## Test Yourself

1. What does Fulcio give cosign, and how long is it valid? Why does that make Rekor necessary?
2. State the difference between a signature and a SLSA provenance attestation in one sentence each.
3. Why is builder-generated provenance more trustworthy than provenance the build script writes itself?
4. Write the two `cosign verify` flags that pin *who* signed and *which* login provider.
5. Why deploy an admission policy in audit mode before enforce mode?

---

## Cheat Sheet

```bash
# Sign + attest from CI (keyless)
cosign sign --yes IMAGE@sha256:...
cosign attest --yes --type slsaprovenance --predicate prov.json IMAGE@sha256:...

# Verify with expectations
cosign verify \
  --certificate-identity-regexp='^https://github.com/acme/app/' \
  --certificate-oidc-issuer=https://token.actions.githubusercontent.com IMAGE@sha256:...

cosign verify-attestation --type slsaprovenance \
  --certificate-identity-regexp='...' --certificate-oidc-issuer='...' IMAGE@sha256:...

# slsa-verifier
slsa-verifier verify-image IMAGE@sha256:... --source-uri github.com/acme/app --source-tag v1.4.0

# Inspect transparency record
cosign tree IMAGE@sha256:...
```

| Need | Reach for |
|------|-----------|
| Sign in CI, no stored key | keyless cosign + `id-token: write` |
| Describe how it was built | SLSA provenance attestation |
| Trust the provenance | builder-generated (SLSA generator) |
| Block unproven images | policy-controller / Kyverno |

---

## Summary

- Keyless signing rests on **Fulcio** (identity → short-lived cert) and **Rekor** (append-only log + timestamp), removing long-lived keys entirely.
- In CI, the *signer is the workflow*; its OIDC identity is what consumers later require.
- **Signed** proves integrity + a voucher; **provenance** proves the build story. Production needs both.
- Trustworthy provenance is **builder-generated** and verified against expected source + builder, defeating lookalike artifacts.
- Enforcement belongs at **admission/consume time** via policy engines — rolled out in **audit mode first, enforce later**.

---

## Further Reading

- Sigstore docs — Fulcio, Rekor, cosign attest/verify-attestation.
- SLSA specification and `slsa-github-generator`, `slsa-verifier`.
- in-toto attestation framework and predicate types.
- npm provenance docs; Maven Central PGP requirements.

---

## Related Topics

- [Supply-Chain Security](../09-supply-chain-security/) — SBOMs, dependency integrity, the full chain.
- [Registries & Distribution](../05-registries-and-distribution/) — where signatures and attestations are stored.
- [Release Automation](../08-release-automation/) — wiring signing into the pipeline.
- [Rollback & Roll-Forward](../07-rollback-and-roll-forward/) — verifying the artifact you roll back *to*.
