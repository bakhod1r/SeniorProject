# Supply-Chain Integrity — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Checksum Database as a Transparency Log](#the-checksum-database-as-a-transparency-log)
3. [How `govulncheck` Builds Its Call Graph](#how-govulncheck-builds-its-call-graph)
4. [The OSV Schema and the Go Vuln DB Pipeline](#the-osv-schema-and-the-go-vuln-db-pipeline)
5. [Signing Go Artifacts with cosign / sigstore](#signing-go-artifacts-with-cosign-sigstore)
6. [Provenance Attestations and in-toto](#provenance-attestations-and-in-toto)
7. [A SLSA L3 Pipeline for Go on GitHub](#a-slsa-l3-pipeline-for-go-on-github)
8. [SBOM Generation, Signing, and Attachment](#sbom-generation-signing-and-attachment)
9. [Hermetic Builds: The Full Recipe](#hermetic-builds-the-full-recipe)
10. [Hardening `GOFLAGS` and the Environment](#hardening-goflags-and-the-environment)
11. [Operating a Private Proxy as a Trust Anchor](#operating-a-private-proxy-as-a-trust-anchor)
12. [Policy as Code: Enforcing Supply-Chain Rules](#policy-as-code-enforcing-supply-chain-rules)
13. [Edge Cases and Failure Modes](#edge-cases-and-failure-modes)
14. [Operational Playbook](#operational-playbook)
15. [Summary](#summary)

---

## Introduction

The professional level treats supply-chain integrity as an engineered *system* with cryptographic guarantees, not a checklist of commands. The goal is a pipeline where every artifact carries verifiable, third-party-checkable evidence of its origin and contents, where the build environment itself cannot forge that evidence, and where a consumer — internal or external — can verify the chain end-to-end without trusting your word.

This file is for engineers who own build infrastructure, security tooling, or release engineering for Go at an organization that takes supply-chain assurance seriously. After reading you will:
- Understand the cryptographic structure of the checksum database (a Merkle transparency log)
- Know how `govulncheck` constructs and queries its call graph, and its precise limits
- Read and reason about the OSV schema that powers the Go vuln database
- Sign Go binaries and SBOMs with cosign/sigstore using keyless (OIDC) flows
- Generate and verify SLSA provenance attestations with the in-toto format
- Stand up a SLSA L3 pipeline on GitHub Actions
- Operate a private proxy as a controllable trust anchor with a kill-switch
- Enforce supply-chain policy as code at admission time

The throughline: replace "trust me" with "verify me," cryptographically, at every link.

---

## The Checksum Database as a Transparency Log

`sum.golang.org` is not a simple key-value store of hashes. It is a **verifiable, append-only transparency log** structurally identical to Certificate Transparency, and understanding that structure explains its security properties.

The log is a **Merkle tree**. Each leaf is a record `module@version hash`. Each internal node is the hash of its children. The single root hash commits to the *entire history* of the log. Two cryptographic proofs make it tamper-evident:

- **Inclusion proof.** Given a `module@version hash`, the server returns a short path of sibling hashes proving that record is a leaf under the current root. The client recomputes the root from the leaf and the path; if it matches the signed root, the record is genuinely in the log.
- **Consistency proof.** Given two root hashes from different times, the server proves the later tree is an *append-only extension* of the earlier one — nothing was removed or rewritten. This is what stops the log operator from quietly rewriting history.

The root is **signed** by the log (a Go-managed key, `GONOSUMDB`-overridable). Clients cache observed roots (`$GOCACHE/...`); a divergence between what you saw and what another client saw is detectable.

The practical consequence: an attacker who compromises a *proxy* cannot serve you malicious bytes, because the bytes' hash would have to be in the signed log, and inserting a fake leaf requires either the log's signing key or a fork of the log that fails consistency proofs. To attack a single victim invisibly, the attacker would need to present a *different* signed log to that victim alone — a "split-view" attack — which gossip/auditing of log roots is designed to expose. This is why disabling `GOSUMDB` (rather than scoping `GONOSUMDB` to private modules) is a meaningful downgrade: it removes the global, gossipable witness.

The client side of this protocol is implemented in `golang.org/x/mod/sumdb`; reading it is the fastest way to understand the proof verification concretely.

---

## How `govulncheck` Builds Its Call Graph

`govulncheck`'s precision comes from static analysis, and knowing its mechanics tells you exactly where it is sound and where it is conservative.

The pipeline (in `golang.org/x/vuln/internal`):

1. **Package loading.** It uses `golang.org/x/tools/go/packages` to load the full typed syntax of your module and all dependencies — the same loader `gopls` uses. This requires the code to *compile*.
2. **SSA construction.** It builds SSA (static single assignment) form via `golang.org/x/tools/go/ssa`. SSA makes data and control flow explicit and analyzable.
3. **Call-graph construction.** It builds a call graph, typically with the **VTA** (Variable Type Analysis) algorithm — a precise, type-aware algorithm that resolves interface and dynamic dispatch far better than naive CHA (Class Hierarchy Analysis).
4. **Reachability from entry points.** Starting at `main` and test functions, it computes the set of functions actually reachable.
5. **Vulnerability intersection.** For each OSV entry's affected symbols, it checks membership in the reachable set. Reachable → a *call stack* (witness trace) is produced and the finding is **actionable**; present-but-unreachable → **informational**.

Where it is **sound but conservative** (may over-report): VTA may consider a dispatch target reachable that runtime never hits. Better to warn than miss.

Where it is **unsound** (may under-report) — important to know:
- **Reflection.** A call made purely via `reflect` may not appear in the static call graph.
- **`go:linkname`, cgo, assembly.** Calls crossing these boundaries are partially opaque.
- **Plugins / dynamically loaded code.** Out of scope of static analysis.

For binary mode (`govulncheck -mode=binary ./app`), there is *no source*, so it falls back to **module-level** detection: it reads the embedded `go version -m` data and reports vulnerabilities for the included module versions, *without* reachability. This is coarser (more like other ecosystems' scanners) but works on artifacts you did not build.

The `-scan` flag controls granularity (`symbol`, `package`, `module`); `symbol` is the default and the differentiator.

---

## The OSV Schema and the Go Vuln DB Pipeline

The Go vulnerability database publishes entries in the **OSV** (Open Source Vulnerability) format — a JSON schema shared across ecosystems (npm, PyPI, crates, Go) so that one tool can consume many sources. A Go entry, abridged:

```json
{
  "id": "GO-2023-1840",
  "aliases": ["CVE-2023-29403", "GHSA-..."],
  "summary": "...",
  "affected": [{
    "package": { "name": "github.com/affected/dep", "ecosystem": "Go" },
    "ranges": [{
      "type": "SEMVER",
      "events": [{ "introduced": "0" }, { "fixed": "1.2.1" }]
    }],
    "ecosystem_specific": {
      "imports": [{
        "path": "github.com/affected/dep",
        "symbols": ["Vulnerable", "AlsoVulnerable"]
      }]
    }
  }],
  "database_specific": { "url": "https://pkg.go.dev/vuln/GO-2023-1840" }
}
```

The `ecosystem_specific.imports[].symbols` field is the Go-specific extension that enables symbol-level reachability — most OSV producers omit it; the Go database curates it deliberately.

The pipeline behind it: vulnerabilities are reported (via the Go security team, CVE feeds, GHSA, or direct reports), **triaged and curated by humans** (the affected symbols are determined by reading the code, which is why coverage is high-quality but not instantaneous), assigned a `GO-YYYY-NNNN` ID, and published to `vuln.go.dev` (served as a static index of OSV JSON). `govulncheck` fetches the index, narrows to your modules, and downloads only the relevant entries.

Because it is OSV, you can also consume the Go database with `osv-scanner` (Google's cross-ecosystem scanner) for fleet-level scanning of lockfiles and SBOMs, complementing `govulncheck`'s source-level depth with breadth.

---

## Signing Go Artifacts with cosign / sigstore

Signing answers "who produced this artifact?" — a necessary (not sufficient; see SolarWinds) part of the chain.

**sigstore** modernizes signing by eliminating long-lived private keys. The flagship flow is **keyless signing** with **cosign**:

1. The signer authenticates via **OIDC** (e.g. a GitHub Actions workload identity, or a human via Google/GitHub).
2. **Fulcio** (sigstore's CA) issues a *short-lived* (minutes) signing certificate bound to that OIDC identity.
3. cosign signs the artifact with the ephemeral key.
4. The signature, certificate, and signing event are recorded in **Rekor**, sigstore's public transparency log.
5. The ephemeral key is discarded. There is no key to leak.

Signing and verifying a release binary's digest (via a blob signature):

```bash
# Sign (in CI, identity comes from the OIDC token):
cosign sign-blob --yes app > app.sig
# or with bundle output capturing cert + Rekor entry:
cosign sign-blob --yes --bundle app.bundle app

# Verify, asserting WHO signed it and via which workflow:
cosign verify-blob \
  --bundle app.bundle \
  --certificate-identity-regexp '^https://github.com/acme/repo/.github/workflows/release.yml@.*' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  app
```

The verification asserts not just "this was signed" but "this was signed *by the release workflow of this exact repo*" — binding the artifact to a build identity, which is what makes signatures meaningful rather than ceremonial. The Rekor entry provides a public, timestamped, tamper-evident record that the signing happened, so even a later key/identity compromise cannot retroactively forge a back-dated signature.

For container images, the same `cosign sign` / `cosign verify` flow attaches signatures to the image in the registry (OCI artifacts).

---

## Provenance Attestations and in-toto

A signature says "I vouch for these bytes." A **provenance attestation** says "these bytes were built *this way*." The standard is **in-toto attestations** carrying a **SLSA provenance** predicate:

```json
{
  "_type": "https://in-toto.io/Statement/v1",
  "subject": [{ "name": "app", "digest": { "sha256": "abc123..." } }],
  "predicateType": "https://slsa.dev/provenance/v1",
  "predicate": {
    "buildDefinition": {
      "buildType": "https://github.com/slsa-framework/...",
      "externalParameters": { "source": "git+https://github.com/acme/repo@refs/tags/v1.2.0" },
      "resolvedDependencies": [{ "uri": "...", "digest": { "gitCommit": "..." } }]
    },
    "runDetails": {
      "builder": { "id": "https://github.com/acme/repo/.github/workflows/release.yml@..." },
      "metadata": { "invocationId": "...", "startedOn": "..." }
    }
  }
}
```

The `subject.digest` binds the attestation to a *specific* artifact hash; `builder.id` records *who* built it; `externalParameters.source` records *from what commit*. Signed (via cosign/Fulcio) and logged (Rekor), this is a non-forgeable statement of origin.

Verification with cosign:

```bash
cosign verify-attestation \
  --type slsaprovenance \
  --certificate-identity-regexp '^https://github.com/acme/repo/.*' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  app
```

The crucial property — and the SolarWinds lesson encoded — is that at **SLSA L3** the provenance is generated by the *build platform*, isolated from the build's own steps, so a compromised build step *cannot* forge a provenance claiming clean source. The attestation is only as strong as the isolation of the entity that signs it.

---

## A SLSA L3 Pipeline for Go on GitHub

The **SLSA GitHub generator** (`slsa-framework/slsa-github-generator`) produces L3 provenance for Go builds using a reusable workflow that runs the build in an isolated context the caller cannot tamper with.

```yaml
# .github/workflows/release.yml
name: release
on:
  push:
    tags: ['v*']
permissions: read-all

jobs:
  build:
    permissions:
      id-token: write     # for keyless signing / OIDC
      contents: write     # to upload release assets
      actions: read
    uses: slsa-framework/slsa-github-generator/.github/workflows/builder_go_slsa3.yml@v2.0.0
    with:
      go-version: '1.23'
      # Reproducible, provenance-friendly build flags:
      config-file: .slsa-goreleaser.yml
```

```yaml
# .slsa-goreleaser.yml
version: 1
binary: app
main: ./cmd/app
flags:
  - -trimpath
ldflags:
  - '-s -w'
env:
  - CGO_ENABLED=0
  - GOFLAGS=-mod=mod
```

This single reusable workflow: builds the Go binary with pinned, reproducible flags; generates a signed SLSA L3 provenance attestation bound to the binary's digest and the source tag; and uploads both. Consumers verify with the `slsa-verifier`:

```bash
slsa-verifier verify-artifact app \
  --provenance-path app.intoto.jsonl \
  --source-uri github.com/acme/repo \
  --source-tag v1.2.0
```

The L3 guarantee holds because the build runs inside the generator's isolated job, not in a job your repository's other code controls — so even a malicious `go generate` or a compromised dependency in your build cannot produce a provenance that lies about the source.

---

## SBOM Generation, Signing, and Attachment

A professional release attaches a signed SBOM so consumers can inventory and continuously scan what they received.

```bash
# Generate from the binary (ground truth: what actually shipped):
cyclonedx-gomod bin -json -output app.cdx.json ./app

# Sign and attach as an attestation (binds SBOM to the artifact digest):
cosign attest --yes \
  --predicate app.cdx.json \
  --type cyclonedx \
  app

# Consumer side: verify and extract the SBOM:
cosign verify-attestation --type cyclonedx \
  --certificate-identity-regexp '^https://github.com/acme/repo/.*' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  app
```

Two professional refinements:
- **Generate from the binary, not `go.mod`,** so the SBOM reflects the exact module versions baked in (immune to `go.mod`/build drift).
- **Attach as an *attestation*, not a loose file,** so the SBOM is cryptographically bound to the specific artifact digest and cannot be swapped for another component's bill of materials.

Continuous scanning closes the loop: feed the stored SBOMs to `osv-scanner` (or `grype`) on a schedule so a CVE newly disclosed against an already-shipped version raises an alert without rebuilding.

```bash
osv-scanner --sbom app.cdx.json
```

---

## Hermetic Builds: The Full Recipe

Hermeticity means the build depends only on pinned, declared inputs. The complete Go recipe:

```bash
# Dependencies: pinned source, no network
export GOFLAGS=-mod=vendor          # vendored, pre-verified; OR a sealed module cache
export GOPROXY=off                  # any accidental fetch fails loudly
export GOSUMDB=off                  # safe ONLY because vendor/ was verified offline already

# Toolchain: pinned, no mid-build download
export GOTOOLCHAIN=local            # use the installed Go; do not fetch another

# Build environment: minimize ambient inputs
export CGO_ENABLED=0                # drop the C toolchain as an input where feasible
export SOURCE_DATE_EPOCH=...        # pin any timestamp-sensitive steps

# Reproducible output
go build -trimpath -buildvcs=false -ldflags='-s -w' -o app ./cmd/app
```

Then *prove* it:

```bash
# Reproducibility gate
go build -trimpath -buildvcs=false -o b1 ./cmd/app
go clean -cache
go build -trimpath -buildvcs=false -o b2 ./cmd/app
cmp b1 b2                            # byte-identical or the build is non-deterministic

# Hermeticity gate (run with network disabled at the sandbox level):
GOPROXY=off go build -mod=vendor ./...   # must succeed with zero network
```

Pin the *builder image* by digest (`golang@sha256:...`, not `golang:1.23`) so the toolchain and OS libraries are themselves fixed inputs. A floating tag re-opens the toolchain hole that vendoring and `go.sum` do not cover.

---

## Hardening `GOFLAGS` and the Environment

The Go environment is itself part of the supply chain; misconfiguration silently disables protections.

| Setting | Hardened value | Why |
|---------|----------------|-----|
| `GOPROXY` | `https://proxy.golang.org,direct` or your private proxy | Avoid uncontrolled `direct`-only fetches; a private proxy is a kill-switch. |
| `GOSUMDB` | `sum.golang.org` (default; never `off` globally) | Global tamper-evidence. |
| `GOPRIVATE` | exact private namespaces only | Scope, never `*`. |
| `GONOSUMCHECK` | **unset** | Legacy footgun; disables sum checking. |
| `GOINSECURE` | unset (or one tightly-scoped pattern) | Plain HTTP defeats transport integrity. |
| `GOTOOLCHAIN` | `local` for hermetic builds; pinned version otherwise | Prevent surprise toolchain downloads. |
| `GOFLAGS` | `-mod=readonly` (or `-mod=vendor`) | Fail on unexpected `go.mod` writes; catch drift. |

The most dangerous anti-pattern is the *convenience override*: a developer sets `GOFLAGS=-insecure` or `GONOSUMDB=*` in their shell to unblock one task and forgets it, silently disabling integrity for every build on that machine. Audit effective config in CI:

```bash
go env -json | jq '{GOPROXY,GOSUMDB,GOPRIVATE,GOFLAGS,GOTOOLCHAIN,GONOSUMCHECK,GOINSECURE}'
```

Diff this between developer machines and CI early; divergence here is a frequent root cause of "works for me, fails in CI" *and* of silent security downgrades.

---

## Operating a Private Proxy as a Trust Anchor

For organizations, a private GOPROXY (Athens, Artifactory, GoProxy, JFrog) is the highest-leverage supply-chain investment.

```bash
# Org default: corporate proxy first, fall back to public, then direct
go env -w GOPROXY='https://goproxy.acme.internal,https://proxy.golang.org,direct'
go env -w GOPRIVATE='git.acme.internal,github.com/acme-org/*'
```

What it gives you that the public proxy alone does not:
- **A controllable trust anchor.** You decide which versions exist in your ecosystem.
- **An org-wide kill-switch.** When a version is found malicious, *block it at the proxy* and every build everywhere stops using it immediately — no per-repo coordination.
- **An audit log.** Exactly which `module@version` was ever fetched, by whom, when.
- **Availability.** Builds survive public-proxy outages and upstream takedowns (the proxy caches immutably).
- **Quarantine of new versions.** Configure a hold so a brand-new release is not auto-available until it has aged or been reviewed — defusing the malicious-update vector at the source.

The proxy *complements* the checksum database: keep `GOSUMDB=sum.golang.org` on so cached content is still globally verified. A private proxy that disables sumdb verification is an unverified mirror, which is strictly worse.

---

## Policy as Code: Enforcing Supply-Chain Rules

At scale, rules that live in a wiki are rules that are not enforced. Encode them.

- **Admission control.** Use a policy engine (cosign's policy-controller for Kubernetes, OPA/Gatekeeper, Kyverno) to *refuse to run* an image that lacks a valid signature, a verified SLSA provenance, and a clean SBOM scan. The cluster becomes the enforcement point.

```yaml
# cosign policy-controller ClusterImagePolicy (abridged)
apiVersion: policy.sigstore.dev/v1beta1
kind: ClusterImagePolicy
spec:
  images:
    - glob: "registry.acme.internal/**"
  authorities:
    - keyless:
        identities:
          - issuer: https://token.actions.githubusercontent.com
            subjectRegExp: ^https://github.com/acme/.*/release.yml@.*
```

- **CI templates as policy.** Shared reusable workflows that already include `go mod verify`, `govulncheck`, the tidy check, the reproducibility gate, and SBOM/provenance generation. Teams *inherit* the controls instead of reimplementing (and forgetting) them.
- **Branch protection + required checks.** The supply-chain workflow is a *required* status check; a PR cannot merge while it is red.
- **Dependency-adoption review.** A CODEOWNERS rule routing any change to `go.mod`'s `require` block (or to `vendor/`) to a security/platform reviewer.

The principle: make the secure configuration the *default and the enforced* one, so security does not depend on individual diligence.

---

## Edge Cases and Failure Modes

- **Split-view sumdb attack.** A theoretical attacker presenting different signed logs to different clients. Mitigated by root-hash gossip/auditing; relevant when designing high-assurance environments that monitor `sum.golang.org` roots.
- **`govulncheck` blind to reflection/cgo.** A vulnerable symbol invoked only via `reflect` may be reported as unreachable. For high-assurance code, supplement with binary-mode (module-level) scanning, which does not depend on reachability.
- **Keyless signing identity drift.** If you rename the release workflow or move the repo, existing `--certificate-identity-regexp` verifications break. Version your identity-matching policy alongside the workflow.
- **SBOM/`go.mod` drift.** An SBOM generated from `go.mod` can disagree with the binary if build flags or `replace` directives altered the graph. Always generate from the binary for release artifacts.
- **Toolchain auto-download.** Without `GOTOOLCHAIN=local`, a `go` or `toolchain` directive can trigger Go to fetch a *different* compiler mid-build — an unpinned input. Pin it.
- **Retracted versions still build.** `retract` in upstream `go.mod` warns via `go mod tidy` but does not force an upgrade; a vendored or pinned retracted version keeps building. Add `go list -m -u -retracted all` to a scheduled job.
- **Replace directives bypass provenance expectations.** A `replace` to a local fork vendors *that* source; provenance/SBOM must reflect the fork, not the original path. Audit `replace` directives in release builds.
- **Private proxy without sumdb.** A misconfigured private proxy that also disables `GOSUMDB` serves unverified bytes. Keep global sumdb on.

---

## Operational Playbook

| Scenario | Recipe |
|----------|--------|
| Verify integrity of cached deps | `go mod verify` |
| Scan source for reachable CVEs | `govulncheck ./...` |
| Scan a binary you didn't build | `govulncheck -mode=binary ./app` |
| Inspect what shipped | `go version -m ./app` |
| Prove reproducibility | build twice with `go clean -cache` between; `cmp` |
| Prove hermeticity | `GOPROXY=off go build -mod=vendor ./...` |
| Generate release SBOM | `cyclonedx-gomod bin -json -output sbom.json ./app` |
| Sign a binary (keyless) | `cosign sign-blob --yes --bundle app.bundle app` |
| Verify a signature | `cosign verify-blob --bundle app.bundle --certificate-identity-regexp ... app` |
| Generate SLSA L3 provenance | SLSA GitHub generator reusable workflow |
| Verify provenance | `slsa-verifier verify-artifact ... --source-uri ... --source-tag ...` |
| Audit effective Go config | `go env -json \| jq '{GOPROXY,GOSUMDB,GOPRIVATE,GOFLAGS,GOTOOLCHAIN}'` |
| Block a malicious version org-wide | remove/deny at the private proxy |
| Find retractions | `go list -m -u -retracted all` |
| Continuous SBOM scan | `osv-scanner --sbom sbom.json` on a schedule |

---

## Summary

Professional supply-chain integrity engineers a system of cryptographic, third-party-verifiable evidence around every artifact. The checksum database is a Merkle transparency log whose inclusion and consistency proofs make module substitution globally visible and unforgeable — which is why scoping `GONOSUMDB` to private namespaces beats disabling `GOSUMDB`. `govulncheck` derives its precision from SSA-based, VTA call-graph reachability over the OSV-format Go vuln database, with known, important blind spots (reflection, cgo) that binary-mode scanning partially covers. On top of integrity and vulnerability detection sits the provenance stack: cosign/sigstore keyless signing (Fulcio ephemeral certs, Rekor transparency log) binds artifacts to build identities; in-toto SLSA provenance attestations record how they were built; and at SLSA L3 the build platform — isolated from the build's own steps — generates that provenance so a compromised step cannot forge it. Signed SBOMs generated from the binary, continuously scanned, inventory what shipped; hermetic, reproducible builds with a digest-pinned toolchain remove unpinned inputs and make tampering detectable; a private proxy provides a controllable trust anchor, audit log, and org-wide kill-switch; and policy-as-code at admission turns all of it into enforced default rather than optional diligence. The system never removes trust — it relocates it to well-understood, monitored, cryptographically-anchored points, and replaces "trust me" with "verify me" at every link.
