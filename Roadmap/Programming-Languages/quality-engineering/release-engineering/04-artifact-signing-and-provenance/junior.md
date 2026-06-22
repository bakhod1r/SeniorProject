# Artifact Signing & Provenance — Junior Level

> **Roadmap:** [Release Engineering](../README.md) → Artifact Signing & Provenance

*Proving that the artifact you downloaded is the real one — and that nobody tampered with it on the way to you.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The trust problem](#core-concept-1--the-trust-problem)
5. [Core Concept 2 — Hashes prove integrity](#core-concept-2--hashes-prove-integrity)
6. [Core Concept 3 — Signatures prove origin](#core-concept-3--signatures-prove-origin)
7. [Core Concept 4 — Your first signature with cosign](#core-concept-4--your-first-signature-with-cosign)
8. [Core Concept 5 — Verifying before you trust](#core-concept-5--verifying-before-you-trust)
9. [Real-World Examples](#real-world-examples)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **why a downloaded artifact cannot be trusted by default, and how a hash plus a signature lets you verify it independently of where it came from.**

When you `docker pull`, `npm install`, or download a release binary, the bytes travel through machines you do not control: a registry, a CDN, a mirror, your company proxy. Any one of them could be compromised and hand you a modified file. The download "succeeding" tells you nothing about *what* you got.

Artifact signing solves this. The publisher attaches cryptographic proof to the artifact. You — the consumer — check that proof locally. If it passes, you know two things: the artifact came from the claimed publisher (**origin**) and it has not been altered since it was signed (**integrity**). This works even if every machine in the middle is hostile.

This file covers the ground floor: the problem, hashes, signatures, and your first sign-and-verify cycle with `cosign`.

---

## Prerequisites

- Comfort with the command line and running tools like `docker`, `curl`, `sha256sum`.
- Basic idea of what a container image and a registry are (see the **docker-best-practices** skill).
- A rough mental picture of public-key cryptography: a **private key** signs, a matching **public key** verifies. The **encryption-basics** skill covers this.
- You do *not* need to manage keys yet — we will use keyless signing.

---

## Glossary

| Term | Meaning |
|------|---------|
| Artifact | A built thing you ship: container image, binary, jar, npm tarball, zip. |
| Digest | A `sha256:...` hash that uniquely identifies exact bytes. Change one bit, the digest changes. |
| Hash / checksum | The output of a hash function (e.g. SHA-256). Same input → same hash, always. |
| Signature | Proof, made with a private key, that a specific publisher vouched for specific bytes. |
| Public key | The half of a key pair anyone can use to *verify* a signature. |
| Private key | The secret half used to *create* a signature. Must never leak. |
| Integrity | "These bytes were not changed." |
| Origin / provenance | "These bytes came from this publisher / this build." |
| cosign | A tool for signing and verifying container images and other artifacts. |
| Keyless signing | Signing tied to your identity (e.g. a Google/GitHub login) instead of a long-lived key file. |

---

## Core Concept 1 — The trust problem

Imagine you run `docker pull registry.example.com/app:1.4.0`. The image arrives. Should you run it?

The honest answer is: you have no idea who built it or whether it is the same image the author published. Consider what sits between the author and you:

- **The registry** could be breached, and an attacker could replace `1.4.0` with a backdoored image under the same tag.
- **A CDN or mirror** could serve a cached, tampered copy.
- **Your own proxy** could be misconfigured or compromised.
- The **tag** `1.4.0` is just a mutable pointer — anyone with push access can move it to different bytes.

The key insight: **transport security (HTTPS) only protects bytes in motion between two hops.** It does not tell you the *source* was honest or the *storage* was untouched. TLS proves you are talking to `registry.example.com`; it does not prove `registry.example.com` is serving the author's real image.

Signing flips the model. Instead of trusting the channel, you trust a **cryptographic proof attached to the artifact itself**. The proof is verified on your machine, so a compromised middle box cannot fake it.

---

## Core Concept 2 — Hashes prove integrity

A cryptographic hash function (SHA-256) turns any bytes into a fixed-length fingerprint:

```bash
# Hash a file
sha256sum app-1.4.0-linux-amd64
# a1b2c3...e9f0  app-1.4.0-linux-amd64
```

Two properties make this useful:

1. **Deterministic** — the same bytes always produce the same hash.
2. **Tamper-evident** — flip a single bit and the hash changes completely. You cannot feasibly craft different bytes with the same SHA-256.

So if a project publishes the expected hash on a trusted page, you can verify what you downloaded:

```bash
# Verify a downloaded file against a published checksum file
sha256sum -c SHA256SUMS
# app-1.4.0-linux-amd64: OK
```

Container images use the same idea. A tag is mutable, but a **digest** is not:

```bash
# Pin to immutable bytes, not a movable tag
docker pull registry.example.com/app@sha256:5d41402abc4b2a76b9719d911017c592...
```

But a hash alone is weak as *origin* proof. If the attacker controls both the artifact and the page listing its checksum, they can publish a matching hash for their tampered file. A hash answers "did the bytes change since this hash was taken?" — it does **not** answer "who took it?" For that you need a signature.

---

## Core Concept 3 — Signatures prove origin

A signature binds a hash to an **identity** using a private key. The flow:

1. The publisher hashes the artifact.
2. The publisher signs that hash with their **private key**.
3. You receive the artifact, the signature, and the publisher's **public key**.
4. You verify the signature against the public key. If it checks out, only the holder of the private key could have produced it.

The classic tool is GPG (GNU Privacy Guard):

```bash
# Publisher signs (creates a detached .sig file)
gpg --detach-sign --armor app-1.4.0-linux-amd64
# produces app-1.4.0-linux-amd64.asc

# Consumer verifies
gpg --verify app-1.4.0-linux-amd64.asc app-1.4.0-linux-amd64
# gpg: Good signature from "Release Bot <release@example.com>"
```

A signature gives you what a hash alone cannot: **assurance about the source**. But it raises a hard question — how do you get the *right* public key, and trust it belongs to the real publisher? GPG made this painful: developers lost keys, forgot passphrases, or signed with keys nobody had verified. Keyless signing (next concept) was invented largely to fix this human problem.

---

## Core Concept 4 — Your first signature with cosign

`cosign` (part of the Sigstore project) lets you sign without managing a long-lived key file. Instead, you authenticate with an identity provider (Google, GitHub, Microsoft) and Sigstore issues a **short-lived certificate** tied to your identity. This is **keyless signing**.

Install and sign an image you have pushed:

```bash
# Install (Homebrew shown; see Sigstore docs for other platforms)
brew install cosign

# Sign an image by its digest (keyless — opens a browser to log in)
cosign sign registry.example.com/app@sha256:5d41402abc4b2a76b9719d911017c592...
```

What happens under the hood:

1. cosign gets a token proving *who you are* from your identity provider (OIDC).
2. Sigstore's CA (**Fulcio**) issues a certificate valid for a few minutes, stamped with your identity (e.g. `release@example.com`).
3. cosign signs the image digest with the key in that short-lived cert.
4. The signature is recorded in a public **transparency log** (**Rekor**) so anyone can later see that this signature was made, by whom, and when.
5. The signature is stored alongside the image in the registry.

You never created, stored, or rotated a key file. The "key" lived for minutes and is gone. What persists is the *record* of who signed what, when.

> You will go deeper on Fulcio and Rekor at the **Middle** level. For now: keyless = "log in, sign, the proof is public."

---

## Core Concept 5 — Verifying before you trust

Signing is only half the job. The value appears at **consume time**, when you verify before using the artifact.

```bash
# Verify a keyless signature: you must state WHO you expect signed it
cosign verify \
  --certificate-identity=release@example.com \
  --certificate-oidc-issuer=https://accounts.google.com \
  registry.example.com/app@sha256:5d41402abc4b2a76b9719d911017c592... | jq .
```

Two flags carry the real meaning:

- `--certificate-identity` — the identity you *require* to have signed (an email or a CI workflow URL).
- `--certificate-oidc-issuer` — *which* login provider must have vouched for that identity.

If you omit these, you only learn "*someone* signed this," which is nearly worthless — an attacker can sign their own malicious image too. **The point is to demand a specific, expected signer.**

For GPG-signed downloads, verification is symmetric: you import the publisher's known public key, then `gpg --verify`. The hard part is getting that key from a trustworthy source in the first place.

> Critical caveat for every tier: a valid signature proves *who* and *unchanged*. It does **not** prove the artifact is safe, bug-free, or non-malicious. A compromised-but-authentic build will still sign perfectly. Authentic ≠ safe.

---

## Real-World Examples

- **Homebrew / GitHub release binaries.** Many projects publish a `SHA256SUMS` file plus a `.sig`. Users verify the checksum file's signature, then check each binary against it.
- **npm provenance.** Packages published from GitHub Actions can carry Sigstore-backed provenance. `npm audit signatures` checks that what you installed was signed.
- **Docker Official Images & cosign.** A growing number of base images are cosign-signed so platforms can refuse unsigned images.
- **The SolarWinds attack (2020).** A trusted vendor's *build system* was compromised and shipped malicious-but-signed updates — the cautionary tale that authentic does not mean safe, and that you must also trust the *build*, not just the signature.

---

## Mental Models

- **Wax seal on a letter.** Anyone can carry the envelope (the registry). The intact seal stamped with the sender's signet (the signature) tells you it came from them and was not opened.
- **Tamper-evident packaging.** A broken seal does not stop you from opening the box — it just makes tampering *visible* so you can refuse it.
- **ID check at the door.** A hash says "this is the same item." A signature says "and here is who vouched for it." Verifying with a *specific* expected identity is checking the name on the ID, not just that an ID exists.

---

## Common Mistakes

- **Trusting the tag.** `app:1.4.0` can be re-pointed. Sign and verify by **digest**.
- **Verifying without an identity.** `cosign verify` *with no* `--certificate-identity` accepts any signer. Always pin who you expect.
- **Confusing HTTPS with provenance.** TLS secures the pipe, not the source or the storage.
- **Treating a passing signature as a safety guarantee.** It proves origin and integrity only.
- **Publishing the checksum on the same untrusted surface as the artifact.** If an attacker can change both, the hash is meaningless. Sign the checksum, or use a transparency-logged signature.

---

## Test Yourself

1. Why is `docker pull` succeeding not evidence that the image is genuine?
2. What does a SHA-256 digest prove, and what does it *not* prove?
3. In keyless cosign signing, what plays the role of the "key," and how long does it live?
4. Why must `cosign verify` be given `--certificate-identity` and `--certificate-oidc-issuer`?
5. Give one thing a valid signature does **not** guarantee.

---

## Cheat Sheet

```bash
# Hashing
sha256sum file                       # compute a digest
sha256sum -c SHA256SUMS              # verify files against a checksum list

# GPG detached signatures
gpg --detach-sign --armor file       # sign -> file.asc
gpg --verify file.asc file           # verify

# cosign keyless
cosign sign IMAGE@sha256:...         # sign (browser login)
cosign verify \
  --certificate-identity=ID \
  --certificate-oidc-issuer=ISSUER \
  IMAGE@sha256:...                    # verify with a required signer
```

| Question | Tool |
|----------|------|
| Did the bytes change? | hash / digest |
| Who vouched for them? | signature |
| Sign without managing keys? | cosign keyless |
| Refuse if not signed by *X*? | `cosign verify --certificate-identity=X ...` |

---

## Summary

- You cannot trust an artifact just because the download worked; the transport and storage are out of your control.
- A **hash** proves integrity (unchanged bytes); a **signature** adds origin (who vouched).
- **cosign keyless** signing replaces fragile long-lived keys with a short-lived, identity-bound certificate and a public transparency-log record.
- Verification only matters if you demand a **specific expected identity** — otherwise any signer passes.
- A signature proves *authentic and unchanged*, never *safe*. Keep that distinction in mind at every level.

---

## Further Reading

- Sigstore documentation — cosign quickstart and keyless signing.
- GnuPG handbook — detached signatures and key verification.
- The `docker-best-practices`, `encryption-basics`, and `secrets-management` skills for adjacent fundamentals.

---

## Related Topics

- [Registries & Distribution](../05-registries-and-distribution/) — where artifacts and their signatures live.
- [Supply-Chain Security](../09-supply-chain-security/) — the bigger picture signing fits into.
- [Versioning & SemVer](../01-versioning-and-semver/) — pinning by digest vs tag.
- [Release Automation](../08-release-automation/) — signing as a pipeline step.
