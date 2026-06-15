# Module Proxy & Checksum Database — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Where This Is Specified](#where-this-is-specified)
3. [The GOPROXY Protocol: Endpoints](#the-goproxy-protocol-endpoints)
4. [Path and Version Escaping](#path-and-version-escaping)
5. [GOPROXY Configuration Grammar](#goproxy-configuration-grammar)
6. [The Module Cache Layout](#the-module-cache-layout)
7. [The `go.sum` File Format](#the-gosum-file-format)
8. [The `h1:` Hash (Specified)](#the-h1-hash-specified)
9. [The Checksum Database Protocol](#the-checksum-database-protocol)
10. [Environment Variables (Specified)](#environment-variables-specified)
11. [Differences Across Go Versions](#differences-across-go-versions)
12. [References](#references)

---

## Introduction

The Go language specification (`go.dev/ref/spec`) does not specify the module proxy or the checksum database. These are *tooling* concerns. The authoritative reference is the **Go Modules Reference** at `go.dev/ref/mod`, specifically the sections **"Module proxy"**, **"Checksum database"**, and **"Environment variables."**

Sources of truth, in decreasing formality:

1. **Go Modules Reference** — `go.dev/ref/mod`.
2. **`go help goproxy`**, **`go help environment`** — command-line documentation.
3. **`golang.org/x/mod`** — the reference implementation packages (`module`, `sumdb`, `sumdb/dirhash`, `sumdb/note`, `sumdb/tlog`).
4. **Toolchain source** — `cmd/go/internal/modfetch`, `cmd/go/internal/modfetch/codehost`.

This file separates "what the reference specifies" from convention and implementation detail. Where the reference is silent, `x/mod` and the toolchain source are the de-facto specification.

---

## Where This Is Specified

The relevant reference sections:

1. **Go Modules Reference, "Module proxy"** — the GOPROXY HTTP protocol and endpoint semantics.
2. **Go Modules Reference, "Checksum database"** — the sumdb protocol, proofs, and `GOSUMDB`.
3. **Go Modules Reference, "Module cache"** — the on-disk layout and `GOMODCACHE`.
4. **Go Modules Reference, "Environment variables"** — `GOPROXY`, `GOSUMDB`, `GOPRIVATE`, `GONOPROXY`, `GONOSUMDB`, `GOINSECURE`, `GOFLAGS`.
5. **`golang.org/x/mod/sumdb/dirhash`** package docs — the `h1:` algorithm.

---

## The GOPROXY Protocol: Endpoints

Per the reference, a module proxy is an HTTP server serving these GET endpoints, relative to a base URL. `$module` and `$version` are escaped (see next section).

| Endpoint | Response | Required |
|----------|----------|----------|
| `$base/$module/@v/list` | Plain text, one version per line; tagged, non-pseudo versions; may be empty. | Yes |
| `$base/$module/@v/$version.info` | JSON: `{"Version": string, "Time": RFC3339 string}` (additional fields permitted). | Yes |
| `$base/$module/@v/$version.mod` | The `go.mod` file (or a synthesized one for modules lacking it). | Yes |
| `$base/$module/@v/$version.zip` | The module source as a zip with canonical `$module@$version/` prefixed paths. | Yes |
| `$base/$module/@latest` | JSON like `.info`, for the version chosen when no version is specified. | Optional |

Status code semantics:

- `200 OK` — success.
- `404 Not Found` or `410 Gone` — the module or version is unavailable at this proxy; the client falls forward to the next `GOPROXY` entry.
- Any other status, or a transport error — treated as an error; fall-forward depends on the separator (see grammar).

The reference is explicit that proxies must serve **immutable** responses for a given `$module/$version`: once published, the `.info`, `.mod`, and `.zip` for a version must not change.

---

## Path and Version Escaping

To safely map module paths onto case-insensitive filesystems and URLs, the reference specifies an escaping:

- Each **uppercase ASCII letter** in `$module` or `$version` is replaced by an **exclamation mark followed by the lowercase letter**: `B` → `!b`.
- All other characters are used verbatim (module paths are already restricted to a safe character set).

Examples:

```
github.com/Masterminds/semver/v3   →   github.com/!masterminds/semver/v3
example.com/M                      →   example.com/!m
```

This is implemented by `module.EscapePath` and `module.EscapeVersion` in `golang.org/x/mod/module`. The same escaping governs the module cache directory layout.

---

## GOPROXY Configuration Grammar

`GOPROXY` is a list. The reference grammar (informal):

```
GOPROXY   = entry { sep entry }
entry     = proxyURL | "direct" | "off"
sep       = "," | "|"
proxyURL  = an http/https URL, or a file:// URL
```

Semantics:

| Token | Meaning |
|-------|---------|
| `proxyURL` | Fetch via the GOPROXY protocol from this URL. |
| `direct` | Resolve from the module's version-control system directly. |
| `off` | Disallow downloading; resolution stops here and fails if unmet. |
| `,` | Fall forward to the next entry **only** on `404`/`410`. |
| `\|` | Fall forward to the next entry on **any** error. |

Notes:
- The default value is `https://proxy.golang.org,direct`.
- `off` makes all following entries unreachable.
- `file://` URLs point at a local directory laid out per the proxy protocol (e.g. the cache's `cache/download` tree).

---

## The Module Cache Layout

Per the reference, the module cache lives at `$GOMODCACHE` (default `$GOPATH/pkg/mod`). Specified structure:

```
$GOMODCACHE/
├── cache/
│   ├── download/                      ← proxy-protocol mirror of fetched data
│   │   └── $module/@v/
│   │       ├── list
│   │       ├── $version.info
│   │       ├── $version.mod
│   │       ├── $version.zip
│   │       └── $version.ziphash       ← the h1: hash of the zip
│   ├── download/sumdb/                ← cached sumdb tiles, STHs, lookups
│   └── lock
└── $module@$version/                  ← extracted, read-only source tree
```

Properties the reference states:

- Extracted module directories are **read-only**; modifying them is detected.
- The `cache/download` tree is **exactly** the proxy protocol on disk; it may be served via `GOPROXY=file://.../cache/download`.
- `go clean -modcache` removes the entire cache.
- `GOFLAGS=-modcacherw` makes extracted files writable (discouraged).

---

## The `go.sum` File Format

`go.sum` records expected hashes, one per line. Each line:

```
<module> <version> <hash>
<module> <version>/go.mod <hash>
```

- `<module>` — the module path.
- `<version>` — a semantic version (possibly a pseudo-version).
- `<version>/go.mod` form — the hash is of the module's `go.mod` file alone.
- bare `<version>` form — the hash is of the module's full source zip.
- `<hash>` — an algorithm-prefixed hash; currently `h1:` followed by base64.

Each module version typically has **two** lines: one for the zip, one for the `go.mod`. A module that is present only in the module graph (its `go.mod` is read but no package is built) may appear with only the `/go.mod` line.

The file is sorted and machine-maintained by `go mod tidy`, `go get`, and `go mod download`. It must not be hand-edited.

---

## The `h1:` Hash (Specified)

The `h1:` hash is specified by the `golang.org/x/mod/sumdb/dirhash` package as `Hash1`:

1. For each file in the set, compute `SHA-256(contents)`, lowercase hex.
2. Build a line per file: `<hex> + "  " + <name> + "\n"` (two spaces).
3. Sort the lines by `<name>` in byte order.
4. Concatenate; compute `SHA-256` of the concatenation.
5. The result, standard-base64-encoded, prefixed with `h1:`.

For a **module zip** (`HashZip`), `<name>` is the in-zip path `$module@$version/<relpath>`. For a **`go.mod`** (`HashGoMod`), the single `<name>` is `$module@$version/go.mod`.

The hash therefore depends only on file paths and contents, **not** on zip packaging (compression, ordering, timestamps). This makes it reproducible across implementations.

---

## The Checksum Database Protocol

Per the reference, the checksum database is an HTTP server (default `sum.golang.org`) serving:

| Endpoint | Response |
|----------|----------|
| `/latest` | A signed note: the latest signed tree head (tree size + root hash). |
| `/lookup/$module@$version` | A signed record: the `go.sum` lines for that version plus its log position. |
| `/tile/$H/$L/$K[.p/$W]` | A Merkle-tree tile at hash-height `$H`, level `$L`, index `$K`, optional partial width `$W`. |

Specified verification behavior of the `go` client:

1. The sumdb's public key is configured via `GOSUMDB` (default carries the `sum.golang.org` key; a custom form is `name+hash+key`).
2. On looking up a new `$module@$version`, the client fetches `/lookup`, verifies the note signature, and verifies an **inclusion proof** against a signed tree head.
3. The client verifies a **consistency proof** between its cached tree head and the current one, ensuring the log is append-only.
4. The looked-up hash is compared to the downloaded module's `h1:`. On mismatch, the build fails (`SECURITY ERROR`).
5. Verified hashes are written to `go.sum`.

The sumdb may be reached through a proxy: requests are made under `$GOPROXY/sumdb/$sumdb-name/...`. The client still verifies signatures and proofs end-to-end.

The reference frames the guarantee as **tamper-evidence**: the log cannot present inconsistent histories (a "split view") without detection, analogous to Certificate Transparency.

---

## Environment Variables (Specified)

| Variable | Default | Meaning |
|----------|---------|---------|
| `GOPROXY` | `https://proxy.golang.org,direct` | Proxy list; controls where modules are fetched. |
| `GOSUMDB` | `sum.golang.org` | Checksum database name (and optionally key). `off` disables it. |
| `GOPRIVATE` | (empty) | Glob list of module prefixes treated as private; sets defaults for `GONOPROXY` and `GONOSUMDB`. |
| `GONOPROXY` | (inherits `GOPRIVATE`) | Glob list of modules fetched directly from VCS, bypassing the proxy. |
| `GONOSUMDB` | (inherits `GOPRIVATE`) | Glob list of modules not checked against the checksum database (`go.sum` still enforced). |
| `GOINSECURE` | (empty) | Glob list of modules allowed over plain HTTP / without TLS verification. |
| `GOMODCACHE` | `$GOPATH/pkg/mod` | Module cache location. |
| `GOFLAGS` | (empty) | Default flags (e.g. `-mod=readonly`, `-mod=vendor`, `-insecure`). |
| `GONOSUMCHECK` | **removed** | (historical) once disabled all checksum checks; no longer exists. Use `GONOSUMDB`/`GOSUMDB=off`. |

Glob matching for `GOPRIVATE`/`GONOPROXY`/`GONOSUMDB`/`GOINSECURE` is **path-prefix, element-wise**: patterns match whole path elements (`*` does not cross `/`), matched against the module path.

---

## Differences Across Go Versions

- **Go 1.11** — Modules introduced; `GOPROXY` exists (single URL or `direct`/`off` semantics evolving).
- **Go 1.12** — Proxy protocol stabilizing; `go mod download` available.
- **Go 1.13** — **Module mirror and checksum database launched.** `proxy.golang.org` and `sum.golang.org` become the defaults. `GOSUMDB`, `GONOSUMDB`, `GONOSUMCHECK`, `GOPRIVATE` introduced. `go.sum` gains sumdb-backed verification.
- **Go 1.13** — `GONOSUMCHECK` deprecated in favor of `GONOSUMDB`/`GOPRIVATE`; later removed.
- **Go 1.14** — `GOPROXY` comma-vs-pipe fall-forward semantics refined; `GOINSECURE` added.
- **Go 1.15** — `GOMODCACHE` environment variable added (cache location configurable).
- **Go 1.16** — Module mode the default; `-mod=readonly` default; `GOFLAGS` interactions clarified.
- **Go 1.16** — `go.sum` enforcement tightened: missing entries fail builds rather than being auto-added during build.
- **Go 1.21** — `GOTOOLCHAIN` added; toolchain itself fetched via the proxy mechanism (relevant to hermetic builds).
- **Go 1.22+** — Incremental improvements to error messages and proxy/sumdb robustness; core protocol stable.

The proxy and sumdb protocols have been **stable since Go 1.13**. The principal changes since have been environment-variable refinements (`GOMODCACHE`, `GOINSECURE`, `GOTOOLCHAIN`) and stricter `go.sum` enforcement, not protocol changes.

---

## References

- [Go Modules Reference](https://go.dev/ref/mod) — authoritative.
- [Module proxy (reference)](https://go.dev/ref/mod#module-proxy)
- [Checksum database (reference)](https://go.dev/ref/mod#checksum-database)
- [Module cache (reference)](https://go.dev/ref/mod#module-cache)
- [Environment variables (reference)](https://go.dev/ref/mod#environment-variables)
- [`golang.org/x/mod/sumdb/dirhash`](https://pkg.go.dev/golang.org/x/mod/sumdb/dirhash) — the `h1:` algorithm.
- [`golang.org/x/mod/sumdb/tlog`](https://pkg.go.dev/golang.org/x/mod/sumdb/tlog) — the transparency-log proofs.
- ["Go Module Mirror, Index, and Checksum Database"](https://go.dev/blog/module-mirror-launch) — design overview.
- [proxy.golang.org](https://proxy.golang.org/) and [sum.golang.org](https://sum.golang.org/) — the public services.
