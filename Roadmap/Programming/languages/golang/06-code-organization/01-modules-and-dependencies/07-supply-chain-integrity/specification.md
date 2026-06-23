# Supply-Chain Integrity — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Where Supply-Chain Integrity Is Specified](#where-supply-chain-integrity-is-specified)
3. [`go.sum` Format (Specified)](#gosum-format-specified)
4. [The Checksum Database Protocol](#the-checksum-database-protocol)
5. [Environment Variables: `GOSUMDB`, `GOPROXY`, `GOPRIVATE`, and Friends](#environment-variables-gosumdb-goproxy-goprivate-and-friends)
6. [`go mod verify` and `go mod download` (Specified Behavior)](#go-mod-verify-and-go-mod-download-specified-behavior)
7. [`govulncheck` Interface and Exit Codes](#govulncheck-interface-and-exit-codes)
8. [The OSV Schema (Go Ecosystem)](#the-osv-schema-go-ecosystem)
9. [`go version -m` Embedded Build Info Format](#go-version--m-embedded-build-info-format)
10. [SLSA Build Levels (Specified)](#slsa-build-levels-specified)
11. [SBOM Formats: CycloneDX and SPDX](#sbom-formats-cyclonedx-and-spdx)
12. [Differences Across Go Versions](#differences-across-go-versions)
13. [References](#references)

---

## Introduction

"Supply-chain integrity" is not one specification but a stack of them. The Go language specification (`go.dev/ref/spec`) says nothing about it — these are *tooling*, *protocol*, and *ecosystem* specifications. The authoritative sources, in decreasing formality:

1. **Go Modules Reference** (`go.dev/ref/mod`) — `go.sum`, the checksum database, `GOSUMDB`/`GOPROXY`/`GOPRIVATE`, `go mod verify`.
2. **Go security documentation** (`go.dev/security/`, `go.dev/doc/security/vuln/`) — `govulncheck`, the vuln database.
3. **OSV schema** (`ossf.github.io/osv-schema/`) — the vulnerability data format.
4. **SLSA specification** (`slsa.dev/spec`) — build levels and provenance.
5. **CycloneDX** (`cyclonedx.org`) and **SPDX** (`spdx.dev`) — SBOM formats.

This file separates "what each spec mandates" from convention and implementation. Where a spec is silent, the toolchain source is the de-facto reference.

---

## Where Supply-Chain Integrity Is Specified

| Concern | Authoritative source |
|---------|----------------------|
| `go.sum` format and verification | Go Modules Reference §"go.sum files" |
| Checksum database protocol | Go Modules Reference §"Checksum database"; `golang.org/x/mod/sumdb` |
| `GOSUMDB`/`GOPROXY`/`GOPRIVATE` | Go Modules Reference §"Environment variables"; `go help environment` |
| `go mod verify` | `go help mod verify`; Modules Reference |
| `govulncheck` behavior | `go.dev/doc/security/vuln/`; `golang.org/x/vuln` docs |
| Vuln data format | OSV Schema spec |
| Embedded build info | `runtime/debug.BuildInfo`; `go help version` |
| Build provenance levels | SLSA specification |
| SBOM | CycloneDX spec; SPDX spec |

---

## `go.sum` Format (Specified)

Per the Go Modules Reference, `go.sum` contains lines of the form:

```
<module> <version> <hash>
<module> <version>/go.mod <hash>
```

- `<module>` — the module path.
- `<version>` — a canonical semantic version (or pseudo-version).
- `<hash>` — an algorithm prefix and base64 digest, currently `h1:` (SHA-256 over a deterministic tree hash of the file list and their hashes).

Two lines per version are required:
1. The `/go.mod` line — a hash of *only* that module version's `go.mod` file. Used during module-graph construction, before downloading full content.
2. The plain line — a hash of the module's full file tree (the `.zip` content), computed via the `dirhash` algorithm (`golang.org/x/mod/sumdb/dirhash`).

Specified properties:
- Every module version used by a build must have **both** hashes present and matching, or the build fails.
- The file is **append-only in practice** but may contain entries for versions no longer needed (until `go mod tidy` prunes them).
- Verification is mandatory and on by default; there is no per-build flag to skip an existing `go.sum` entry's check (only environment-level disabling of the *database*, not local `go.sum`).

The `h1:` hash is defined as `SHA-256` of the sorted list of `SHA-256(file)  filename` lines for every file in the module zip — making it independent of zip metadata and reproducible.

---

## The Checksum Database Protocol

The checksum database (`GOSUMDB`, default `sum.golang.org`) is specified as a **signed, append-only, Merkle-tree transparency log**. The client protocol (Modules Reference §"Checksum database", implemented in `golang.org/x/mod/sumdb`):

- **Endpoints** (relative to the database URL):
  - `/latest` — a signed tree head (the current Merkle root and tree size).
  - `/lookup/<module>@<version>` — returns the `go.sum` lines for that version, plus its leaf index, signed.
  - `/tile/...` — Merkle tree tiles for constructing inclusion/consistency proofs.
- **Signed note format.** Tree heads are signed using the *note* format (`golang.org/x/mod/sumdb/note`): the message plus one or more `— <key-name> <base64-signature>` lines.
- **Inclusion proof.** On first lookup of a version, the client obtains the leaf and verifies it is included under a signed root.
- **Consistency proof.** The client verifies any new root is an append-only extension of previously observed roots.
- **Caching.** Verified results are stored in the module cache (`$GOMODCACHE/cache/download/sumdb/`) so the database is contacted only on first encounter of a version.

A `GOSUMDB` value may include a public key (`sum.golang.org+<hash>+<key>`) and an optional URL, allowing alternative or mirrored databases with explicit key pinning.

When a module matches `GONOSUMDB` (or `GOPRIVATE`/`GONOSUMCHECK`), the database is **not** consulted for it; the local `go.sum` is still enforced if an entry exists.

---

## Environment Variables: `GOSUMDB`, `GOPROXY`, `GOPRIVATE`, and Friends

Specified in the Modules Reference and `go help environment`:

| Variable | Default | Specified meaning |
|----------|---------|-------------------|
| `GOPROXY` | `https://proxy.golang.org,direct` | Comma/pipe-separated proxy list. `direct` = fetch from VCS. `off` = disallow downloads. `,` falls through on 404/410; `\|` falls through on any error. |
| `GOSUMDB` | `sum.golang.org` | Checksum database name (optionally `+key+url`). `off` disables database verification entirely. |
| `GOPRIVATE` | (empty) | Glob patterns of private modules. Sets the *default* for `GONOPROXY` and `GONOSUMDB`. |
| `GONOPROXY` | (`GOPRIVATE`) | Patterns fetched `direct`, bypassing `GOPROXY`. |
| `GONOSUMDB` | (`GOPRIVATE`) | Patterns not verified against `GOSUMDB`. |
| `GOINSECURE` | (empty) | Patterns allowed over HTTP / without TLS verification. |
| `GOFLAGS` | (empty) | Default flags applied to `go` commands (e.g. `-mod=readonly`). |
| `GOTOOLCHAIN` | `auto` | `local` = never download a toolchain; `path`/version = selection policy. |

Pattern matching uses `path.Match`-style globs against module paths, matched per path element. `GONOSUMCHECK` is a legacy/obsolete control that disabled all sum checking; it is **not** a documented modern variable and should be avoided.

Precedence: an explicit `GONOPROXY`/`GONOSUMDB` overrides the value `GOPRIVATE` would otherwise imply.

---

## `go mod verify` and `go mod download` (Specified Behavior)

**`go mod verify`** (per `go help mod verify`): checks that dependencies stored in the module cache have not been modified since download, by re-hashing them and comparing to the recorded `go.sum`. On success it prints `all modules verified`; on failure it reports each module whose cached files differ. It verifies the **cache**, not `vendor/` and not your source.

**`go mod download`** (per `go help mod download`): downloads the named modules (or the build list) into the cache, applying `go.sum` verification and, for first encounters, checksum-database verification. With `-x` it prints the commands; with `-json` it emits structured records (`Path`, `Version`, `Zip`, `Dir`, `Sum`, `GoModSum`, `Error`). It does not modify `go.mod` unless adding missing `go.sum` entries is required and permitted by the current `-mod` mode.

Both commands honor `GOPROXY`, `GOSUMDB`, and the private-module variables.

---

## `govulncheck` Interface and Exit Codes

`govulncheck` is distributed at `golang.org/x/vuln/cmd/govulncheck` (not in the standard toolchain; installed via `go install`). Specified surface (per its documentation):

```
govulncheck [flags] [patterns]
```

- **`patterns`** — Go package patterns (`./...`) for source mode, or with `-mode=binary`, a path to a compiled binary.
- **`-mode`** — `source` (default; full call-graph reachability, requires compilable code) or `binary` (module-level detection from embedded build info).
- **`-scan`** — `symbol` (default), `package`, or `module`; controls reachability granularity.
- **`-format`** — `text` (default), `json`, or `sarif`.
- **`-show`** — additional output controls (e.g. `traces`, `color`, `version`, `verbose`).
- **`-db`** — vulnerability database URL (default `https://vuln.go.dev`).
- **`-C dir`**, **`-tags`**, **`-test`** — directory, build tags, and whether to include test code.

**Exit codes** (text mode): non-zero when one or more *actionable* vulnerabilities are found or an error occurs; zero when no actionable vulnerabilities are found. This makes a bare `govulncheck ./...` a valid CI gate. (In `-json`/`-sarif` modes the exit code may be zero regardless; callers parse the structured output to apply policy.)

Output sections: actionable findings (with call-stack traces) and an "Informational" section for vulnerabilities present but not reachable from a called function.

---

## The OSV Schema (Go Ecosystem)

The Go vulnerability database publishes **OSV**-schema JSON (`ossf.github.io/osv-schema`). Required/relevant fields for the Go ecosystem:

- `id` — `GO-YYYY-NNNN`.
- `aliases` — related `CVE-...` / `GHSA-...` identifiers.
- `affected[]` — per affected package:
  - `package.ecosystem` — `"Go"`.
  - `package.name` — module path.
  - `ranges[].type` — `"SEMVER"`; `ranges[].events[]` with `introduced`/`fixed` versions.
  - `ecosystem_specific.imports[]` — the Go-specific extension: per import `path`, the list of affected `symbols` (functions/methods). This field powers `govulncheck`'s symbol-level reachability.
- `database_specific.url` — `https://pkg.go.dev/vuln/GO-YYYY-NNNN`.

The `symbols` extension is what distinguishes the Go database from minimal OSV producers and enables call-graph filtering. Versions in `events` are canonical semver; `introduced: "0"` means "from the beginning."

---

## `go version -m` Embedded Build Info Format

Every Go binary (since Go 1.13, expanded over time) embeds build information accessible via `runtime/debug.ReadBuildInfo()` and printed by `go version -m <binary>`. The line format:

```
<binary>: <go-version>
        path    <main package import path>
        mod     <main module>   <version>   <hash>
        dep     <module>         <version>   <hash>
        =>      <replacement>    <version>   <hash>     # if replaced
        build   <key>=<value>                            # build settings
```

- `mod` — the main module.
- `dep` — each dependency module baked into the binary, with version and `h1:` hash.
- `=>` — a replacement (from a `replace` directive), recorded on the line after the replaced `dep`.
- `build` — settings such as `-trimpath=true`, `CGO_ENABLED=...`, `vcs.revision=...`, `vcs.time=...`, `vcs.modified=...`, `GOARCH`, `GOOS`.

This embedded data is the ground-truth inventory of what shipped and is the input consumed by `govulncheck -mode=binary`, `cyclonedx-gomod bin`, and `syft`.

---

## SLSA Build Levels (Specified)

Per the SLSA specification (`slsa.dev/spec`, v1.0 "Build" track):

| Level | Requirement (paraphrased) |
|-------|---------------------------|
| **Build L0** | No guarantees. |
| **Build L1** | The build process produces **provenance** describing how the artifact was built. Provenance may be unsigned. |
| **Build L2** | The build runs on a **hosted build platform** that generates and **signs** the provenance, so it is authenticated and not forgeable by the package's own developers locally. |
| **Build L3** | The build platform is **hardened**: builds run in isolated environments, and provenance is generated by the platform in a way the build's own steps cannot influence or forge. Resists tampering by a compromised build step. |

Provenance is expressed as an **in-toto attestation** (`in-toto.io/Statement/v1`) carrying the SLSA provenance predicate (`slsa.dev/provenance/v1`), binding an artifact digest (`subject`) to a builder identity (`runDetails.builder.id`) and build parameters (`buildDefinition`).

SLSA is a framework; it does not mandate specific tools. The Go ecosystem realizes it via the SLSA GitHub generator, cosign/sigstore signing, and reproducible builds.

---

## SBOM Formats: CycloneDX and SPDX

Two specified, interoperable SBOM formats apply to Go:

- **CycloneDX** (`cyclonedx.org`, ECMA-driven, OWASP) — JSON/XML; `components[]` with `purl` (Package URL, e.g. `pkg:golang/github.com/google/uuid@v1.6.0`), `hashes`, `licenses`, and dependency graph. Security-oriented; supports `vulnerabilities[]`. Generated for Go by `cyclonedx-gomod`.
- **SPDX** (`spdx.dev`, ISO/IEC 5962:2021, Linux Foundation) — tag-value or JSON; `packages[]` with `SPDXID`, `versionInfo`, `licenseConcluded`, `checksums`, and `relationships`. License/compliance-oriented. Generated for Go by `syft -o spdx-json`.

Both can be produced from a Go module's graph or, preferably for release artifacts, from the **compiled binary's** embedded build info, ensuring the SBOM reflects exactly what shipped. The **Package URL (purl)** `pkg:golang/...` is the cross-format canonical identifier for a Go module version.

---

## Differences Across Go Versions

- **Go 1.11** — Modules introduced; `go.sum` appears.
- **Go 1.13** — Checksum database (`GOSUMDB`, `sum.golang.org`) and module proxy (`GOPROXY`) become defaults; `GOPRIVATE`, `GONOSUMDB`, `GONOPROXY`, `GOINSECURE` introduced. Binaries begin embedding module info.
- **Go 1.16** — `-mod=readonly` becomes the default; module mode on by default (`GO111MODULE=on`).
- **Go 1.18** — `go version -m` build settings expanded (VCS info: `vcs.revision`, `vcs.time`, `vcs.modified`); `-buildvcs` flag.
- **Go 1.20–1.21** — `govulncheck` matures; symbol-level analysis and binary mode stabilized (`govulncheck` itself versioned independently under `golang.org/x/vuln`). `GOTOOLCHAIN` and the `toolchain` directive introduced (1.21), relevant to pinning the toolchain as a supply-chain input.
- **Go 1.21+** — Reproducible-build ergonomics and `-trimpath` remain stable; `govulncheck` adds SARIF output and richer modes via the `x/vuln` module.

The core integrity primitives — `go.sum`, the checksum database, and the private-module variables — have been stable since Go 1.13. The principal additions since are the vulnerability tooling (`govulncheck`, the vuln DB), richer embedded build info, and toolchain pinning.

---

## References

- [Go Security](https://go.dev/security/) — authoritative hub.
- [Go Modules Reference](https://go.dev/ref/mod) — `go.sum`, checksum database, environment variables.
- [Module checksum database](https://go.dev/ref/mod#checksum-database)
- [Private modules](https://go.dev/ref/mod#private-modules)
- [Vulnerability Management for Go](https://go.dev/doc/security/vuln/)
- [Govulncheck blog](https://go.dev/blog/govulncheck)
- [Go vulnerability database](https://vuln.go.dev)
- [OSV Schema](https://ossf.github.io/osv-schema/)
- [SLSA specification](https://slsa.dev/spec/v1.0/)
- [CycloneDX specification](https://cyclonedx.org/specification/overview/)
- [SPDX specification](https://spdx.dev/specifications/)
- [Source: `golang.org/x/mod/sumdb`](https://pkg.go.dev/golang.org/x/mod/sumdb)
- [Source: `golang.org/x/vuln`](https://pkg.go.dev/golang.org/x/vuln)
