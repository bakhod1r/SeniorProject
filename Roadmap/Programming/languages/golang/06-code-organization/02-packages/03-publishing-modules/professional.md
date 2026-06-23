# Publishing Modules — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [What Happens When a Consumer Runs `go get`](#what-happens-when-a-consumer-runs-go-get)
3. [Module Proxy Internals and Caching](#module-proxy-internals-and-caching)
4. [The Checksum Database (sum.golang.org) and Inclusion Proofs](#the-checksum-database-sumgolangorg-and-inclusion-proofs)
5. [Vanity Import Paths: Setup and Operation](#vanity-import-paths-setup-and-operation)
6. [pkg.go.dev Indexing Pipeline](#pkggodev-indexing-pipeline)
7. [Release Automation (GitHub Actions, GoReleaser)](#release-automation-github-actions-goreleaser)
8. [Release Engineering for Multi-Module Monorepos](#release-engineering-for-multi-module-monorepos)
9. [Reproducible Releases and Source Tarballs](#reproducible-releases-and-source-tarballs)
10. [Signing Releases (Sigstore, cosign)](#signing-releases-sigstore-cosign)
11. [Pre-Release and RC Workflows](#pre-release-and-rc-workflows)
12. [Retraction Mechanics: How Consumers See It](#retraction-mechanics-how-consumers-see-it)
13. [CI Gates Before Tagging](#ci-gates-before-tagging)
14. [Edge Cases the System Reveals](#edge-cases-the-system-reveals)
15. [Operational Playbook](#operational-playbook)
16. [Summary](#summary)

---

## Introduction

The professional level treats *publishing a module* as the act of injecting an immutable artefact into a global, append-only distribution system. The visible step is `git tag v1.2.3 && git push --tags`, but everything that matters happens afterwards: the proxy fetches and freezes a zip, the checksum database notarises its hash, pkg.go.dev indexes its docs, and consumers around the world begin pulling identical bytes through `go get`.

Once you understand that publishing is *not* a push to a registry but a *signal* that triggers a pull-through cache, the operational model becomes clear. You cannot un-publish, only retract. You cannot replace bytes, only tag a new version. You cannot rename, only deprecate-and-redirect.

This file is for engineers who own the release process for a Go library, run release engineering across a fleet of modules, or are responsible for the supply-chain posture of code others will depend on.

After reading this you will:
- Trace exactly what happens between a consumer's `go get` and the proxy's response
- Reason about proxy caching as an immutable global ledger
- Operate vanity import paths and migrate module identities without breaking consumers
- Set up reproducible, signed releases with Sigstore-backed provenance
- Run multi-module monorepo releases with prefix-tagged versions
- Diagnose pathological publishing problems by reading the proxy and sumdb logs

---

## What Happens When a Consumer Runs `go get`

A consumer types `go get example.com/lib@v1.2.3`. The toolchain performs an ordered, mostly-network-bound dance:

1. **Parse the import path.** Validate it conforms to module-path rules (`module.CheckPath`). Determine the major-version suffix, if any.
2. **Resolve `GOPROXY`.** A comma-separated list. Each entry is tried in order until one succeeds or the list is exhausted. `direct` at the end means fall back to talking to the VCS.
3. **Construct proxy URLs.** Given module path `M` and version `V`:
    - `<proxy>/<M>/@v/list` — known versions
    - `<proxy>/<M>/@v/<V>.info` — JSON: `{"Version":"v1.2.3","Time":"2025-..."}`
    - `<proxy>/<M>/@v/<V>.mod` — the dependency's own `go.mod`
    - `<proxy>/<M>/@v/<V>.zip` — the source archive
4. **Fetch metadata first.** `.info` and `.mod` are tiny and arrive quickly. If `@latest` was requested, `<proxy>/<M>/@latest` returns the proxy's view of the highest release version.
5. **Resolve transitively.** The fetched `.mod` may declare its own `require` set. For each, repeat from step 2. This is MVS unrolling.
6. **Consult the checksum database.** For every `(M, V)` pair the toolchain has not previously seen, it asks `sum.golang.org` for the hash. The response is signed. The toolchain verifies the signature against a baked-in public key.
7. **Compare with the bytes on hand.** If `go.sum` has an entry, it must agree with what the proxy delivered and what sum DB asserts. Mismatch → hard error.
8. **Cache locally.** Write to `$GOPATH/pkg/mod/cache/download/<M>/@v/`. Mark files read-only.
9. **Extract and place under `pkg/mod/<M>@<V>/`.** Source code, ready to compile.
10. **Update consumer's `go.mod` and `go.sum`.** Add `require` lines and the two-per-dependency hash lines.

The consumer never talks to your VCS. The bytes they receive are bytes the proxy holds, and the proxy holds whatever was first served when *anyone* — possibly years ago — first asked for that version.

### Implication

Publishing means: produce an artefact that, when first requested, becomes the canonical bytes for that version *forever*. You are not pushing to a registry. You are publishing a tag and trusting the proxy to canonicalise the resulting zip.

---

## Module Proxy Internals and Caching

`proxy.golang.org` is a Google-operated, write-once, read-mostly cache.

### The fetch flow inside the proxy

When a request arrives for `(M, V)` not yet cached:

1. Resolve `M` to a VCS URL (using `?go-get=1` discovery if it is not a well-known host).
2. Clone the repo at the tag (or commit) corresponding to `V`.
3. Run the **module zip algorithm**: produce a zip file whose internal layout, file modes, and ordering are deterministic given the source tree.
4. Compute the `h1:` hash over the zip contents.
5. Submit the hash to the checksum database.
6. Wait for sumdb to acknowledge inclusion.
7. Cache the zip, the `go.mod`, and the `.info`.
8. Serve them.

### Once cached, immutable

After step 7, the bytes for `(M, V)` are frozen. Even if you:
- Force-push the tag to a different commit
- Delete the tag from the remote
- Delete the entire repository
- Move the module to a new host

…the proxy will keep serving the original bytes until Google force-purges, which is rare and reserved for legal/security incidents.

This is **the central guarantee** of the Go module system. It enables reproducible builds across years and across machines that have never seen the source repo.

### Cache lifetime

Effectively forever. There is no documented TTL. Old versions of long-defunct modules are still served. This means:

- A typo'd, premature tag is *permanent* in the public cache. The fix is to retract and tag again.
- A leaked secret committed in a tagged version is permanent. The fix is to rotate the secret; you cannot scrub the proxy.
- A licensed-changed-after-publish concern: consumers on the old version are unaffected; the proxy keeps serving the old terms' source.

### Private proxies

Athens, JFrog Artifactory, GitLab module registry, and Google Cloud Artifact Registry implement the same protocol. The pattern most companies use:

```
GOPROXY=https://athens.corp/proxy,https://proxy.golang.org,direct
```

The corp proxy caches both private and public modules. It enforces auth on private paths and proxies-through public ones. If the corp proxy is down, the toolchain falls back to the public proxy for non-private paths.

---

## The Checksum Database (sum.golang.org) and Inclusion Proofs

`sum.golang.org` is a **transparency log**: an append-only Merkle tree, signed at the root by Google's well-known key.

### What the log stores

Each entry: `<module> <version> h1:<base64-of-sha256>`. Two lines per release: one for the zip, one for the `go.mod`.

### Why a Merkle log

A signed flat list would let Google equivocate: serve client A one log and client B a different one. A Merkle log makes equivocation detectable. Auditors and bilateral consistency checkers can verify that what client A saw is a prefix of what client B saw.

### Inclusion proofs

When a client asks for a hash, sumdb returns:
- The hash itself.
- A Merkle inclusion proof: a chain of sibling hashes that, when combined, recompute the signed tree root.
- The signed root.

The client recomputes the root locally and verifies the signature using the embedded public key. Without a valid inclusion proof, the toolchain refuses to build.

### Public keys

`sum.golang.org`'s public key is built into the Go toolchain. There is no PKI dance, no key rotation ceremony for consumers — your toolchain is wrong if it does not trust sumdb, full stop.

For private modules, set `GOSUMDB=off` (per `GONOSUMCHECK` paths) and rely on `go.sum` plus your private proxy's auth.

### Consequence for publishers

The first time *anyone* in the world runs `go get example.com/lib@v1.2.3`, the proxy fetches your tag, hashes the resulting zip, and submits that hash to sumdb. From that moment on, any consumer's `go get` will demand bytes matching that hash. If your VCS later serves different bytes (force-push, history rewrite), no consumer will accept them.

Effectively: **sumdb freezes your release the first time anyone fetches it, and there is no undo.**

---

## Vanity Import Paths: Setup and Operation

A vanity path lets you publish a module under a domain you own (`go.example.com/lib`) while hosting the source on a third-party VCS (`github.com/example/lib`).

### How the toolchain discovers the mapping

When asked to fetch `go.example.com/lib`, the toolchain:

1. HTTPS GETs `https://go.example.com/lib?go-get=1`.
2. Parses the returned HTML for a `<meta>` tag of the form:
   ```html
   <meta name="go-import" content="go.example.com/lib git https://github.com/example/lib">
   ```
3. Reads the three space-separated fields: import path prefix, VCS, repo URL.
4. Uses that to clone or to construct further proxy requests.

### Static hosting

The HTML is mostly static. A common pattern: serve a single file from S3 + CloudFront, or from GitHub Pages, that contains the meta tag plus a redirect to documentation.

A minimal implementation:

```html
<!DOCTYPE html>
<html>
<head>
  <meta name="go-import" content="go.example.com/lib git https://github.com/example/lib">
  <meta http-equiv="refresh" content="0; url=https://pkg.go.dev/go.example.com/lib">
</head>
</html>
```

This same file at the URL `https://go.example.com/lib` answers both the toolchain (sees the meta tag) and a human (gets redirected to documentation).

### Operating concerns

- **TLS is mandatory.** The `?go-get=1` fetch requires HTTPS. A self-signed or expired cert breaks `go get`.
- **The vanity path is forever.** If you ever need to redirect, the meta tag must keep working until every consumer migrates.
- **Domain renewals are part of release engineering.** Lapse the domain and downstream builds break.

### Why publishers do this

Vanity paths decouple the module identity from the host. If you migrate from GitHub to Gitea, or from a personal account to an org, the vanity path stays. Consumers do not see the move.

---

## pkg.go.dev Indexing Pipeline

`pkg.go.dev` is the canonical browse-and-search face of the Go module ecosystem. It does not host modules; it indexes them.

### Pipeline

1. **Pulls from sumdb.** pkg.go.dev tails the sumdb log. New entries are new module versions.
2. **Fetches via the proxy.** It treats itself as a regular consumer.
3. **Runs godoc generation.** Parses every `.go` file with `go/doc` to produce HTML.
4. **Scans for license files.** Heuristically detects SPDX identifiers and full license text. Modules without a recognised license are flagged "license not detected" — consumers may treat that as blocking.
5. **Detects deprecation.** A `// Deprecated:` comment on the package declaration in `doc.go`, or a `retract` block in `go.mod`, both surface in the UI.
6. **Computes import counts.** A popularity signal used in search ranking. Higher import counts → higher search rank.
7. **Renders examples.** `Example` functions in `_test.go` become runnable snippets.

### Latency

Typical lag from `git push --tags` to pkg.go.dev visibility: minutes to a few hours. The bottleneck is sumdb propagation and the indexer's processing queue.

### Ranking signals

Search rankings draw on:
- Import count (how many other modules `require` this one).
- Has a license.
- Has a `README.md`.
- Has examples.
- Module path is canonical (matches the repo URL).
- Recently released.

A polished release page on pkg.go.dev requires no special work beyond following Go conventions: keep `doc.go`, examples, license, and `README.md` up to date.

### Forcing a refresh

Visit `https://pkg.go.dev/<module>@<version>` and pkg.go.dev will queue a fetch if it has not yet seen the version. Useful immediately after tagging.

---

## Release Automation (GitHub Actions, GoReleaser)

Manual releases are error-prone. Automated releases are the norm.

### GoReleaser

`goreleaser` is the de facto release tool for Go projects. A `goreleaser.yaml` declaratively specifies:
- Which binaries to build, for which OS/arch matrix.
- Archive format (tar.gz, zip).
- Checksums file (SHA-256 of every artefact).
- GitHub release: title template, changelog source, draft vs published.
- Docker image build and push.
- Homebrew tap update.
- Linux package builds (deb, rpm, apk).

A typical `goreleaser.yaml`:

```yaml
project_name: lib
builds:
  - main: ./cmd/lib
    goos: [linux, darwin, windows]
    goarch: [amd64, arm64]
    ldflags:
      - -s -w
      - -X main.version={{.Version}}
      - -X main.commit={{.Commit}}
archives:
  - format: tar.gz
    name_template: "{{ .ProjectName }}_{{ .Version }}_{{ .Os }}_{{ .Arch }}"
checksum:
  name_template: "checksums.txt"
release:
  github:
    owner: example
    name: lib
  draft: false
```

### GitHub Actions trigger

```yaml
name: release
on:
  push:
    tags: ["v*"]
permissions:
  contents: write
  id-token: write
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-go@v5
        with: { go-version-file: go.mod }
      - uses: goreleaser/goreleaser-action@v6
        with:
          args: release --clean
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

The trigger is the tag push. The workflow has write access only because of the tag — no human ever touches the release page.

### What this does *not* solve

GoReleaser builds binaries for human consumers. It does **not** affect what `go get` returns — `go get` always pulls a source zip from the proxy, regardless of GoReleaser. Releases for `go get` consumers are the *git tag itself*. Binary releases via GoReleaser are an additional, parallel artefact stream for distributing CLIs.

---

## Release Engineering for Multi-Module Monorepos

Many repos contain multiple modules: `api/`, `client/`, `cli/`, each with its own `go.mod`.

### Tag format

For a module rooted at `<repo>/sub/path`, the tag is:

```
sub/path/v1.2.3
```

The proxy's prefix-routing parses the tag: the `sub/path/` prefix is the module subdirectory, the trailing `v1.2.3` is the semver version.

Example: `cli/v0.4.0` releases the module at `<repo>/cli`, version `v0.4.0`.

### Operational consequences

- **Every module has its own tag stream.** `api/v1.2.3` and `client/v1.2.3` are independent and can be tagged at different commits.
- **CI must scope releases to one module at a time.** A push of `cli/v0.4.0` should only release `cli/`, not the other modules.
- **GoReleaser config can live per module.** Or a single config can `monorepo: true` and project-name-template the artefacts.

### Workflow for releasing one of N modules

```bash
git tag api/v1.2.3
git push origin api/v1.2.3
```

The tag push triggers a CI workflow that filters by tag prefix:

```yaml
on:
  push:
    tags: ["api/v*"]
jobs:
  release-api:
    ...
```

Each module gets its own workflow, its own GoReleaser config (or sub-config), and its own release page on GitHub.

### Versioning across modules

Independent semver streams. `api/v2.0.0` can be released years before `cli/v2.0.0`. Consumers only consume what they import.

The exception: when modules in the same monorepo `require` each other. Then bumping one means rev'ing the other.

---

## Reproducible Releases and Source Tarballs

A release is *reproducible* if the `.zip` the proxy serves is byte-identical to a `.zip` produced from any clone of the tagged commit.

### The Go module zip algorithm

Specified in `golang.org/x/mod/zip`. Properties:
- **Sorted entry order.** Files appear in lexicographic order regardless of filesystem.
- **Fixed timestamps.** All entries get a fixed time (zero or the commit time, depending on tool).
- **Fixed file modes.** Normalized to 0644 / 0755.
- **No empty directories.**
- **Path prefix.** All paths inside the zip are prefixed with `<module>@<version>/`.

If you produce a zip by following this algorithm against a clone of the same commit, you get byte-identical bytes — and therefore the same `h1:` hash that sumdb has recorded.

### Verifying reproducibility

```bash
git clone <repo>
cd <repo>
git checkout v1.2.3
go mod download -x example.com/lib@v1.2.3
# the cached zip is what proxy serves

# now produce a fresh zip from source
go run golang.org/x/mod/zip/cmd/gozip -o mine.zip .

sha256sum mine.zip $GOPATH/pkg/mod/cache/download/example.com/lib/@v/v1.2.3.zip
```

Both should match. If they do not, something non-deterministic crept in — usually a `replace` directive pointing at a local path, or a generated file that varies.

### What breaks reproducibility

- Generated files that include timestamps (e.g., embedded build dates).
- A `go generate` step run during release that varies output.
- A `replace` to a local path, since the proxy resolves replacements before zipping.
- Files with non-portable permissions.

### Why it matters

Auditors, distros, and supply-chain tooling want to verify that proxy-served bytes correspond to the source. Reproducibility makes that mechanical.

---

## Signing Releases (Sigstore, cosign)

`go get` itself does not verify signatures — sumdb fills that role for source. But binaries distributed via GoReleaser benefit from cryptographic signatures.

### Sigstore + cosign

Sigstore is a free, public infrastructure for signing artefacts using ephemeral keys backed by an OIDC identity (e.g., a GitHub Actions workflow's identity). `cosign` is the CLI.

A typical signing flow inside a GitHub Actions workflow:

```yaml
- name: Sign with cosign
  env:
    COSIGN_EXPERIMENTAL: "1"
  run: |
    for f in dist/*.tar.gz; do
      cosign sign-blob --yes --output-signature "$f.sig" "$f"
    done
```

The signature is uploaded to the public Rekor transparency log. Consumers can verify with:

```bash
cosign verify-blob \
  --certificate-identity-regexp "https://github.com/example/lib/.*" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  --signature lib_v1.2.3_linux_amd64.tar.gz.sig \
  lib_v1.2.3_linux_amd64.tar.gz
```

### SBOM generation

`syft` produces an SPDX or CycloneDX SBOM. `cosign attest` attaches it as a signed attestation:

```bash
syft dist/lib_v1.2.3_linux_amd64.tar.gz -o spdx-json > sbom.json
cosign attest --predicate sbom.json --type spdx dist/lib_v1.2.3_linux_amd64.tar.gz
```

Increasingly, downstream consumers (especially regulated ones) require an attached SBOM as a release-acceptance gate.

### Relation to `go get`

None directly. `go get` continues to use sumdb. Signing is for binary consumers, container-image consumers, and SBOM-driven compliance.

---

## Pre-Release and RC Workflows

Semver allows pre-release suffixes: `v1.0.0-rc.1`, `v1.0.0-beta.2`, `v2.0.0-alpha.20250101`. The MVS comparator orders them correctly: `v1.0.0-rc.1 < v1.0.0`.

### When to use RCs

- Preparing a v1.0.0 of a long-lived v0 module — give consumers a chance to integrate against `v1.0.0-rc.1` and report problems.
- Preparing a major-version bump — `v2.0.0-rc.1` lets consumers test `module/v2` paths.
- Long-running pre-release branch for unstable APIs.

### Consumer behaviour

`go get example.com/lib` (no version) defaults to `@latest`, which **excludes pre-releases**. Consumers must explicitly opt in:

```
go get example.com/lib@v1.0.0-rc.1
```

This is the protective default that lets you publish RCs without disturbing main consumers.

### Tag and CI

The same release pipeline tags and pushes. GoReleaser detects the pre-release suffix and marks the GitHub release as "pre-release" automatically.

### The `+incompatible` corner

For modules that pre-date Go modules and are tagged at v2+ without a `/v2` suffix, the proxy serves them under `<module>@v2.0.0+incompatible`. New modules should never use this — adopt SIV (semantic import versioning) from day one.

---

## Retraction Mechanics: How Consumers See It

A bad release is permanent on the proxy. The mechanism for marking it bad is `retract`.

### How to retract

Edit `go.mod` of the *latest* version:

```
module example.com/lib

go 1.22

retract (
    v1.2.3 // contains a critical security regression
    v1.2.4 // build broken on Windows
)
```

Tag a new version (`v1.2.5`) and push.

### What consumers see

- `go get example.com/lib@latest` skips retracted versions and resolves to the highest *non-retracted* release.
- `go list -m -u all` displays a retraction notice for any module already pinned to a retracted version.
- `go get example.com/lib@v1.2.3` (explicit) still works — retraction is a *signal*, not a *block*.
- The retraction comment appears on pkg.go.dev's version list.

### What retraction does *not* do

- Does not remove the version from the proxy. The bytes are still served.
- Does not retroactively break consumers pinned to that version.
- Does not propagate without a *newer* release. Consumers must `go get -u` (or otherwise refresh) to learn about the retraction.

### Self-retracting the latest

If `v1.2.3` is the highest release and you want to retract it, you must publish *something newer* (`v1.2.4`) whose `go.mod` retracts `v1.2.3`. The retraction directive must live on a more recent release for consumers to discover it.

---

## CI Gates Before Tagging

Releases are cheap to make and impossible to take back. CI gates before tagging are the safety net.

### Mandatory checks

- **Unit and integration tests pass** on the supported Go-version matrix (typically the two newest minor versions).
- **`go vet ./...` clean.**
- **`go mod tidy`** produces no diff.
- **`govulncheck ./...` clean.** Catches use of stdlib or dependency functions with known CVEs.
- **License check.** Confirm a recognised license file is present and unchanged from previous release (or that any change was approved).
- **Godoc render check.** Run `pkgsite` locally and confirm doc pages render without errors.
- **Static analysis.** `staticcheck` or equivalent.

### Recommended for v1.x

- **Breaking-change scan.** Tools like `gorelease` or `apidiff` compare exported APIs against the previous release. For a v1 module, *any* breaking change should block the release.
- **Example execution.** `go test ./... -run Example` runs `Example` functions; ensure they all pass.

### A skeleton workflow

```yaml
name: pre-release-gate
on:
  push:
    branches: [main]
jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version-file: go.mod }
      - run: go mod tidy && git diff --exit-code go.mod go.sum
      - run: go vet ./...
      - run: go test -race ./...
      - run: go install golang.org/x/vuln/cmd/govulncheck@latest
      - run: govulncheck ./...
      - run: go install golang.org/x/exp/cmd/gorelease@latest
      - run: gorelease -base=$(git describe --tags --abbrev=0)
```

A green run on the commit you intend to tag is the precondition for `git tag`.

### The cultural rule

**Never tag a commit whose CI is red.** Once tagged, the proxy will pick it up and the bytes are forever.

---

## Edge Cases the System Reveals

Reading the proxy and sumdb specs surfaces edges most users never hit:

- A tag pushed without a corresponding `go.mod` (e.g., a v0 repository without modules) is still cached if anyone fetches it; the proxy synthesises a `go.mod` on the fly.
- Force-pushing a tag does *not* update the proxy. Consumers continue to receive the original bytes. To "fix" a release, retract and tag a new one.
- A module path that 404s the `?go-get=1` discovery cannot be fetched at all — even direct VCS access requires the meta tag for non-well-known hosts.
- A module published with mixed-case path components is technically allowed but causes problems on case-insensitive filesystems; the convention is all lowercase.
- The proxy normalises CR/LF in text files inside the zip; do not rely on line-ending preservation through publication.
- A go.mod with `go 1.99` (a future version) will be rejected by older toolchains; use a conservative `go` directive on libraries.
- The sumdb has a roughly 30-second propagation window after a fresh release; immediately-after `go get` may briefly fail, then succeed on retry.
- Vanity paths whose HTML returns gzip-compressed content without `Content-Encoding: gzip` confuse the toolchain — serve plain text.
- `+incompatible` modules can never tag a `v2.0.0` properly; adopting SIV requires path renaming.
- Retracting *every* released version of a module makes `@latest` resolve to nothing. Consumers see "no matching versions"; the only fix is to release a non-retracted version.

---

## Operational Playbook

A condensed reference for common release-engineering scenarios.

| Scenario | Recipe |
|----------|--------|
| First public release of a v0 library | Tag `v0.1.0`; push; verify on pkg.go.dev within an hour |
| Cut a v1.0.0 from a stable v0 | Tag `v1.0.0-rc.1` first; collect feedback; then tag `v1.0.0` |
| Introduce a breaking change | Bump major: rename module path to `<module>/v2`; rewrite imports; tag `v2.0.0` |
| Take back a bad release | Add `retract` to current `go.mod`; tag a new patch |
| Migrate from GitHub host to vanity path | Set up vanity HTML; release new module path; deprecate old in `go.mod` doc |
| Release a single module in a monorepo | Tag `<subdir>/v<x.y.z>`; ensure CI filter matches the prefix |
| Make releases reproducible | Eliminate generated artefacts from the tagged tree; pin Go version with `toolchain` |
| Sign release binaries | Add `cosign sign-blob` step in GoReleaser workflow; require keyless OIDC |
| Generate SBOM | Run `syft` on dist artefacts; attach via `cosign attest` |
| Tag a pre-release | Use suffix: `v1.0.0-rc.1`; consumers must opt-in explicitly |
| Force pkg.go.dev to refresh | Visit `https://pkg.go.dev/<module>@<version>` |
| Audit what consumers fetch | Run a private proxy with logging; route org `GOPROXY` through it |
| Verify a release is reproducible | Diff `gozip`-produced zip against proxy-served zip |
| Block direct VCS fetches | Set `GOPROXY=https://proxy.golang.org` (no `direct` fallback) |

---

## Summary

Publishing a Go module is signalling, not pushing. A `git tag` followed by `git push --tags` is the entire publish action; everything that matters happens in the systems the tag triggers. The proxy fetches and freezes a source zip, sumdb notarises its hash into an append-only Merkle log, pkg.go.dev queues an indexing pass, and consumers' `go get` calls begin pulling identical bytes. The artefact you publish is *immutable in practice*: even a force-pushed tag does not change what the proxy serves, and even a deleted repository does not erase the cached zip.

The professional engineer's understanding of publishing wraps the entire surrounding system: the consumer's `go get` flow that pulls metadata, hash, and zip; the proxy's caching guarantees that make builds reproducible across years; the sumdb that makes hash equivocation globally detectable; the vanity-path mechanism that decouples module identity from VCS host; the pkg.go.dev pipeline that surfaces docs and deprecation; the CI gates that protect against bad releases entering an unforgiving global cache; the retraction mechanism that signals (without erasing) bad versions; the multi-module monorepo tag conventions; the reproducibility requirements; and the Sigstore-based signing that increasingly accompanies binary distribution.

Master those layers and you can publish modules confidently — knowing that what leaves your repo will reach consumers byte-identically, that bad releases can be retracted without panic, that breaking changes are properly versioned, and that the supply-chain posture of your code holds up to scrutiny.

The simplicity of `git tag` is by design: complexity lives in the distribution layer, not the publish layer. Knowing that boundary is itself the senior insight.
