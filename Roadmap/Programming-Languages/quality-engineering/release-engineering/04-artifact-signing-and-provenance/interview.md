# Artifact Signing & Provenance — Interview Level

> **Roadmap:** [Release Engineering](../README.md) → Artifact Signing & Provenance

*A question bank that separates "I ran cosign once" from "I can reason about trust boundaries, SLSA levels, and what signing does not buy."*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Fundamentals](#fundamentals)
4. [Technique](#technique)
5. [SLSA & Threat Model](#slsa--threat-model)
6. [Scenarios](#scenarios)
7. [Rapid-Fire](#rapid-fire)
8. [Red Flags / Green Flags](#red-flags--green-flags)
9. [Cheat Sheet](#cheat-sheet)
10. [Summary](#summary)
11. [Further Reading](#further-reading)
12. [Related Topics](#related-topics)

---

## Introduction

> Focus: **answering signing/provenance questions the way a strong candidate does — precise about the trust model, explicit about boundaries, fluent with cosign/SLSA, and never overselling what a signature guarantees.**

Interviewers probe one fault line repeatedly: do you understand that **authentic ≠ safe**, and can you reason about *who* and *from what* an artifact came, independent of the transport? The questions below use **Q** / *what's really being tested* / **A** format. Answer with the boundary, not just the happy path.

---

## Prerequisites

- The junior–senior content of this topic (hashes, cosign keyless, attestations, SLSA, threat model).
- Comfort discussing CI/CD, registries, and Kubernetes admission at a conceptual level.
- Be ready to whiteboard a sign→verify→enforce flow end to end.

---

## Fundamentals

**Q1. Why isn't HTTPS enough to trust an artifact you pulled from a registry?**
*Tests: transport vs origin/integrity distinction.*
**A.** TLS protects bytes *in motion between two hops* and authenticates the *server you're talking to*. It says nothing about whether that server's stored copy is genuine or whether the publisher was honest. A compromised registry, CDN, mirror, or proxy can serve tampered bytes over a perfectly valid TLS connection. Signing moves trust from the channel to a cryptographic proof attached to the artifact and verified locally — so even a hostile middlebox can't fake it.

**Q2. What's the difference between a hash and a signature?**
*Tests: integrity vs origin.*
**A.** A hash (sha256 digest) proves **integrity** — these are the same bytes, unchanged. But if an attacker controls both the artifact and the page listing its hash, the hash is worthless as origin proof. A **signature** binds that hash to an **identity** via a private key, adding **origin**: only the key/identity holder could have produced it. You need the signature to answer "who vouched for this," not just "did it change."

**Q3. What does a valid signature NOT guarantee?**
*Tests: the central caveat — authentic ≠ safe.*
**A.** It does not guarantee the artifact is safe, correct, or non-malicious. A malicious-but-authentic build — code legitimately built and signed by the real pipeline — passes verification perfectly. SolarWinds is the canonical case: the build system was subverted, so backdoored updates were correctly signed. Signing proves *origin and integrity*, never *intent or quality*.

**Q4. Why did classic GPG/PGP signing fail in practice?**
*Tests: understanding the human/key-management problem.*
**A.** The cryptography was fine; the *key management* failed. Developers lost private keys, forgot passphrases, signed with keys nobody had verified, and the web-of-trust model meant consumers rarely had a trustworthy path to the right public key. Long-lived portable keys leak and sprawl. Sigstore's keyless model was designed largely to remove that human burden: no long-lived key to manage, identity-bound short-lived certs instead.

---

## Technique

**Q5. Walk me through keyless signing with cosign. What are Fulcio and Rekor?**
*Tests: understanding the Sigstore mechanism, not just the command.*
**A.** cosign generates an ephemeral key pair in memory and presents an **OIDC identity token** (from Google/GitHub/etc.). **Fulcio**, Sigstore's CA, exchanges that token for a short-lived (~10 min) certificate embedding the signer's identity. cosign signs the artifact's digest, then discards the ephemeral private key. The signature and certificate are recorded in **Rekor**, an append-only transparency log, which timestamps the entry — crucial because the cert expires in minutes, and Rekor's countersignature proves the signature was made while the cert was valid. Trust chain: OIDC issuer → Fulcio (identity→cert) → Rekor (timestamp + non-repudiation).

```bash
cosign sign --yes IMAGE@sha256:...
cosign verify \
  --certificate-identity-regexp='^https://github.com/acme/' \
  --certificate-oidc-issuer=https://token.actions.githubusercontent.com IMAGE@sha256:...
```

**Q6. What's wrong with `cosign verify IMAGE` and nothing else?**
*Tests: verification must state expectations.*
**A.** Without `--certificate-identity`/`--certificate-identity-regexp` and `--certificate-oidc-issuer`, you only learn "*someone* signed this" — and an attacker can sign their own malicious image too. The security comes entirely from *requiring a specific expected identity and issuer*. Verification without expectations is theater.

**Q7. How do you sign from CI with no stored secret?**
*Tests: workload identity / OIDC in pipelines.*
**A.** Use the CI's OIDC token as the identity. In GitHub Actions, grant `permissions: id-token: write`, install cosign, and `cosign sign --yes <digest>`. The certificate's identity becomes the workflow URL, e.g. `https://github.com/acme/app/.github/workflows/release.yml@refs/tags/v1.4.0`. Consumers then require *that* identity — pinning not just the org but the specific release workflow and ref, which a leaked laptop can't reproduce.

**Q8. Difference between `cosign sign` and `cosign attest`?**
*Tests: signed vs provenance.*
**A.** `cosign sign` produces a signature over the artifact's bytes — integrity + a voucher. `cosign attest` attaches a **signed statement *about* the artifact** (an in-toto attestation with a typed predicate: SLSA provenance, SBOM, vuln scan). A signature says "X vouches for these bytes"; an attestation says "here is the verifiable build story / bill of materials." Production wants both.

---

## SLSA & Threat Model

**Q9. Explain SLSA Build L1, L2, L3 by the attacks each defeats.**
*Tests: levels as a defeat-ladder, not a score.*
**A.**
- **L1** — scripted build that emits provenance. Defeats "nobody knows how this was built." Provenance is forgeable (not authoritatively signed).
- **L2** — provenance signed by a hosted build service. Defeats forged provenance and "I built it on my laptop and lied." Doesn't stop a build influencing itself (malicious Makefile, build-time dependency).
- **L3** — hardened, **isolated** builder; signing material unreachable from build steps. Defeats cross-build contamination and provenance forgery by the build itself. This is where provenance becomes non-falsifiable by the user.
None of the Build levels fix a malicious *source commit* or a poisoned *dependency* — those are separate surfaces.

**Q10. A registry is fully compromised. What does signing protect, and what doesn't it?**
*Tests: precise threat boundary.*
**A.** Protects: integrity (tampered bytes fail verification) and origin (a lookalike under your namespace fails identity check), because verification happens on the consumer with expected identity/issuer pinned — the registry can't forge a Fulcio-issued, Rekor-logged signature for your identity. Doesn't protect: a malicious-but-authentic build (signed correctly by your real pipeline), a compromised source/builder, or insiders with a valid signing identity.

**Q11. Why are reproducible builds a stronger trust primitive than signing alone?**
*Tests: independent verifiability.*
**A.** A signature asks you to *trust the builder*. A reproducible build — same source + recorded environment → bit-for-bit identical output — lets *anyone independently rebuild and verify* the binary matches the source. It converts trust into checkable fact. Sources of non-determinism (timestamps, absolute paths, ordering, locale) must be engineered away: `SOURCE_DATE_EPOCH`, `-trimpath`/`-ffile-prefix-map`, sorted/deterministic archives, pinned environments. Then build twice and `diffoscope` to confirm.

**Q12. How does revocation work under keyless signing?**
*Tests: keyless mental-model shift.*
**A.** There's no long-lived key to revoke — it lived minutes. You respond by **tightening acceptance policy**: stop accepting signatures from the compromised identity/issuer, or cut off a time window using Rekor timestamps, and **audit Rekor** to see exactly what that identity signed and when. You manage *acceptance policy and trust roots* (rotated via TUF), not key lifecycles.

---

## Scenarios

**Q13. Design a gate so a Kubernetes cluster only runs images your release pipeline produced.**
*Tests: end-to-end enforcement design.*
**A.** (1) In CI, build, push by digest, `cosign sign` keyless and `cosign attest` SLSA provenance (ideally via the SLSA L3 generator). (2) Deploy an admission policy (Sigstore policy-controller or Kyverno `verifyImages`) requiring a keyless signature whose `issuer` is the GitHub Actions OIDC issuer and `subject` matches your specific `release.yml` workflow, plus a SLSA provenance attestation whose `source.uri` equals your repo and `builder.id` equals your trusted generator. (3) Resolve tags→digests at deploy and verify the digest. (4) Roll out in **Audit mode first**, fix the gap list, then `Enforce` ring by ring. (5) Add a narrow, audited break-glass.

**Q14. Your enforcement just blocked an urgent prod hotfix because Sigstore was degraded. What do you do, and how do you prevent it?**
*Tests: availability coupling + break-glass + rollback.*
**A.** Immediate: prefer **rolling back to a previously-verified digest** (the safest "bypass"); if a roll-forward is mandatory, use a *narrow, loud, audited* break-glass scoped to one digest/namespace with an expiry and an auto-filed ticket — never disable verification cluster-wide. Prevent: cache the TUF root, mirror Rekor internally, decide a per-environment fail-open/fail-closed stance, and pre-verify in the pipeline so admission checks a digest you already proved rather than reaching out live.

**Q15. A vendor ships an image you can't require *your* identity for. How do you bring it under your trust model?**
*Tests: third-party strategy.*
**A.** Verify the vendor's own signature/provenance at **import time**, then **re-attest with your own platform-team identity** ("we vetted this"), and have prod require *your* attestation. This unifies everything under one internal trust root and lets you express "approved third-party software" as policy.

**Q16. Leadership wants signing enforced org-wide by next week. Push back constructively.**
*Tests: rollout maturity.*
**A.** Flag-day enforcement blocks legitimate deploys and discredits the program. Propose: Phase 0 sign everything (coverage), Phase 1 audit mode (build the gap list with metrics), Phase 2 enforce on one low-risk beachhead, Phase 3 expand by ring, Phase 4 tighten to provenance/source constraints — each gated on clean metrics, with break-glass and clear failure messages. Same discipline as a feature-flag rollout.

---

## Rapid-Fire

**Q17. Tag or digest — what do you sign and verify?**
**A.** Digest. Tags are mutable pointers.

**Q18. What does `id-token: write` enable in GitHub Actions?**
**A.** The job to request an OIDC token, the identity keyless signing uses.

**Q19. What's in an in-toto attestation?**
**A.** A `subject` (artifact by digest) and a typed `predicate` (e.g. SLSA provenance, SBOM).

**Q20. Why is builder-generated provenance better than build-script-generated?**
**A.** A build script that writes its own provenance is only as trustworthy as the (possibly malicious) artifact; the builder is an independent authority.

**Q21. What does Rekor provide that a bare signature doesn't?**
**A.** A public, append-only, timestamped record — non-repudiation and proof the signature happened while the short-lived cert was valid.

**Q22. Name two regulatory drivers.**
**A.** US Executive Order 14028 and NIST SSDF (SP 800-218); SLSA is the de facto technical yardstick.

**Q23. `npm audit signatures` checks what?**
**A.** That installed packages carry valid Sigstore-backed signatures/provenance.

**Q24. What does Maven Central require for publishing?**
**A.** PGP-signed artifacts.

**Q25. One-line: signed vs provenance?**
**A.** Signed = integrity + a voucher; provenance = the verifiable story of what built it, from which source, on which builder.

---

## Red Flags / Green Flags

**Red flags**
- "If it's signed, it's safe." Conflates authentic with safe.
- Runs `cosign verify` with no identity/issuer and calls it secure.
- Thinks HTTPS gives provenance.
- Treats SLSA as a single score, can't name attacks per level.
- Proposes long-lived per-team GPG keys without seeing the key-management trap.
- Would enforce org-wide on day one; no audit phase, no break-glass.
- No notion that verification adds an availability/latency dependency.

**Green flags**
- Leads with the trust boundary: integrity + origin, *not* safety.
- Always pins expected identity and issuer when verifying.
- Distinguishes signature from provenance/attestation cleanly.
- Maps SLSA L1/L2/L3 to specific defeated attacks and names what's still uncovered (source, deps, insiders).
- Brings up reproducible builds as independent verification.
- Describes a staged audit→enforce rollout with break-glass and metrics.
- Knows keyless replaces key-revocation with acceptance-policy tightening + Rekor audit.

---

## Cheat Sheet

```bash
# Sign + attest (keyless)
cosign sign --yes IMG@sha256:...
cosign attest --yes --type slsaprovenance --predicate prov.json IMG@sha256:...

# Verify WITH expectations (the part that matters)
cosign verify \
  --certificate-identity-regexp='^https://github.com/acme/app/' \
  --certificate-oidc-issuer=https://token.actions.githubusercontent.com IMG@sha256:...

# Provenance against source + builder
slsa-verifier verify-image IMG@sha256:... \
  --source-uri github.com/acme/app --builder-id "https://github.com/slsa-framework/...@v2.0.0"
```

| Probe | One-liner answer |
|-------|------------------|
| HTTPS enough? | No — channel, not source/storage. |
| Hash vs signature | integrity vs origin. |
| Signature guarantees safety? | No — authentic ≠ safe. |
| Fulcio / Rekor | identity→short cert / transparency log + timestamp. |
| SLSA L1/L2/L3 | record / authenticate / isolate. |
| Reproducible build | independent verification of the binary. |
| Keyless revocation | tighten acceptance policy + audit Rekor. |
| Rollout | sign → audit → enforce by ring + break-glass. |

---

## Summary

- The interview fault line is **authentic ≠ safe**: signing proves origin and integrity, never intent or quality.
- Be fluent in the **keyless mechanism** (OIDC → Fulcio cert → Rekor log) and always **verify with pinned identity + issuer**.
- Distinguish **signed** (integrity + voucher) from **provenance/attestation** (the build story), and map **SLSA L1/L2/L3** to defeated attacks.
- Know what signing *doesn't* cover (malicious-but-authentic, source/dep/builder/insider) and bring up **reproducible builds** as the independent-verification primitive.
- Show operational maturity: **staged audit→enforce rollout**, break-glass, availability coupling, and the EO 14028 / SSDF drivers.

---

## Further Reading

- Sigstore docs — cosign, Fulcio, Rekor; SLSA specification.
- in-toto attestation framework; `slsa-verifier`.
- NIST SSDF (SP 800-218); Executive Order 14028.
- reproducible-builds.org.

---

## Related Topics

- [Supply-Chain Security](../09-supply-chain-security/) — the broader chain signing is part of.
- [Registries & Distribution](../05-registries-and-distribution/) — where signatures/attestations live.
- [Release Automation](../08-release-automation/) — wiring sign/attest/verify into pipelines.
- [Rollback & Roll-Forward](../07-rollback-and-roll-forward/) — verified rollback as break-glass.
