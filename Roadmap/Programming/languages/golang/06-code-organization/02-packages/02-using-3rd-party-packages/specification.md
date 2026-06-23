# `go get` — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Synopsis](#synopsis)
3. [Version Selectors](#version-selectors)
4. [Pseudo-Version Format](#pseudo-version-format)
5. [Major Version Suffixes Recap](#major-version-suffixes-recap)
6. [The `-u` and `-u=patch` Flags](#the-u-and-upatch-flags)
7. [Module Proxy Protocol](#module-proxy-protocol)
8. [Checksum Database Interaction](#checksum-database-interaction)
9. [GOPROXY, GOPRIVATE, GONOPROXY, GONOSUMCHECK, GOSUMDB](#goproxy-goprivate-gonoproxy-gonosumcheck-gosumdb)
10. [What `go get` Does NOT Do (Per Reference)](#what-go-get-does-not-do-per-reference)
11. [Differences Across Go Versions](#differences-across-go-versions)
12. [References](#references)

---

## Introduction

The Go language specification (`go.dev/ref/spec`) does not specify `go get`. The command is part of the *tooling*, not the language. The authoritative sources of truth are:

1. **Go Modules Reference** at `go.dev/ref/mod` (sections "Module-aware commands", "Module proxy", "Pseudo-versions", "Authenticating modules").
2. **`go help get`** — terse, command-line oriented documentation built into the toolchain.
3. **Toolchain source** — `cmd/go/internal/modget/get.go` is the de-facto specification when the reference is silent on edge cases.

This file separates "what the modules reference says" from convention and tooling behaviour. Where the reference is silent, the toolchain source code is the de-facto specification.

---

## Synopsis

```
go get [-d] [-t] [-u] [-v] [build flags] [pkg@version]...
```

**Paraphrase of `go help get` (not a verbatim quote):**

`go get` resolves its command-line arguments to versions of modules, then updates the current module's `go.mod` (and `go.sum`) so that the requested versions are selected. Each argument is either a package path or a module path, optionally suffixed with `@version` to request a specific version. Without `@version`, the selector defaults to `@latest` (or `@upgrade` when an existing requirement is present). Since Go 1.17, `go get` no longer builds or installs packages — it only modifies the dependency graph. Use `go install pkg@version` to install a binary.

Common flags:

- `-d` — download only; do not build. (Default behaviour since Go 1.17; flag retained for compatibility.)
- `-t` — also consider modules needed to build tests of packages on the command line.
- `-u` — update the named packages and their dependencies to newer minor or patch releases.
- `-u=patch` — update only to newer patch releases.
- `-v` — verbose; print package names as they are resolved.

Exit code 0 on success; non-zero on resolution, network, or checksum failure.

---

## Version Selectors

The token after `@` in `pkg@version` is the **version selector**. The Go Modules Reference enumerates the legal forms:

| Selector              | Meaning                                                                |
|-----------------------|------------------------------------------------------------------------|
| `@vX.Y.Z`             | Exact released version (semantic version tag).                         |
| `@vX.Y.Z-pre`         | Exact pre-release version.                                             |
| `@<pseudo-version>`   | A specific commit, named by pseudo-version (see next section).         |
| `@latest`             | Highest released version (excluding pre-releases unless none exist).   |
| `@upgrade`            | Highest released version, but no lower than the currently required version. |
| `@patch`              | Highest patch release of the current minor version.                    |
| `@none`               | Remove the requirement on this module entirely.                        |
| `@<branch>`           | The current commit on the named branch (e.g. `@main`, `@master`).      |
| `@<commit-hash>`      | The named commit; resolved to a pseudo-version.                        |
| `@<tag>` (non-SemVer) | Resolved to a pseudo-version that includes the commit timestamp.       |

The toolchain canonicalises every selector to either an exact released version or a pseudo-version before writing to `go.mod`. Branch names and bare commit hashes never appear in `go.mod`.

---

## Pseudo-Version Format

A **pseudo-version** is a synthetic semantic version that names a specific commit which has no SemVer tag. The grammar (per `go.dev/ref/mod#pseudo-versions`):

```
PseudoVersion = "v" Major "." Minor "." Patch
                "-" [ PreRelease "." ]
                Timestamp "-" CommitHash .

Timestamp  = 14*DIGIT          ; YYYYMMDDHHMMSS in UTC
CommitHash = 12HEXDIG          ; first 12 hex digits of the VCS commit
```

There are **three forms**, distinguished by whether a base SemVer tag exists in the ancestry of the commit:

1. **No base tag.** The pseudo-version uses major.minor.patch `v0.0.0` and no pre-release prefix:
    ```
    v0.0.0-20240115093015-abcdef012345
    ```
2. **Base tag is a release (`vX.Y.Z`).** The next patch version is used, with the pre-release marker `0`:
    ```
    vX.Y.(Z+1)-0.YYYYMMDDHHMMSS-COMMITHASH
    ```
    Example: base tag `v1.4.2` → `v1.4.3-0.20240115093015-abcdef012345`.
3. **Base tag is a pre-release (`vX.Y.Z-pre`).** The pre-release identifier is extended:
    ```
    vX.Y.Z-pre.0.YYYYMMDDHHMMSS-COMMITHASH
    ```
    Example: base tag `v1.5.0-rc1` → `v1.5.0-rc1.0.20240115093015-abcdef012345`.

The timestamp is the commit timestamp converted to UTC. The commit hash is exactly the first 12 hexadecimal characters; it must match the underlying VCS commit. The toolchain rejects pseudo-versions whose timestamp or hash disagrees with the resolved commit.

Pseudo-versions sort below their base tag's next release but above the base tag itself, by the standard SemVer pre-release ordering rules.

---

## Major Version Suffixes Recap

A module declared at major version 2 or higher must have a `/vN` suffix on its module path. This is the **import compatibility rule** (`go.dev/ref/mod#major-version-suffixes`).

| Major version       | Required path suffix |
|---------------------|----------------------|
| `v0.x.x` or `v1.x.x` | none                 |
| `v2.x.x`            | `/v2`                |
| `v3.x.x`            | `/v3`                |
| `vN.x.x` (N ≥ 2)    | `/vN`                |

`go get example.com/lib/v2@v2.3.0` and `go get example.com/lib@v2.3.0` are different requests. The first requires that the module's path is `example.com/lib/v2`. The second is valid only for `v0` or `v1` releases of `example.com/lib`. `/v0` and `/v1` are forbidden suffixes; `/v2` is the smallest legal one.

When a project's tag is `v2.0.0` but its `go.mod` does not declare the `/v2` suffix, `go get` resolves the request to a pseudo-version under the legacy "v2 without modules" rule (sometimes called "+incompatible").

---

## The `-u` and `-u=patch` Flags

The `-u` flag governs the upgrade behaviour for **transitive dependencies** as well as the named packages.

- **`-u`** — for each package on the command line and each of its transitive dependencies, select the highest released minor-or-patch version. Major version is never upgraded by `-u`; the user must explicitly request `pkg/vN+1@vN+1.0.0`.
- **`-u=patch`** — for each such module, select the highest released *patch* version of the currently selected minor. Minor and major are not changed.
- **(no `-u`)** — only the modules named on the command line are considered. Their transitive dependencies are kept at their currently required versions, except as needed to satisfy the new requirements.

The mechanism is described in the modules reference under "Updating dependencies". Internally, the toolchain runs Minimum Version Selection (MVS) on the augmented requirement graph; `-u` and `-u=patch` modify the upper bounds fed into MVS.

---

## Module Proxy Protocol

`go get` retrieves modules through the **module proxy protocol** (`go.dev/ref/mod#module-proxy`), an HTTP GET-only protocol. Given a module path `M` and version `v`, the proxy is queried at the following endpoints:

| Endpoint                              | Purpose                                                            |
|---------------------------------------|--------------------------------------------------------------------|
| `GET $GOPROXY/M/@v/list`              | Newline-separated list of available released versions.             |
| `GET $GOPROXY/M/@v/<v>.info`          | JSON metadata: `{"Version":"v...","Time":"..."}`                   |
| `GET $GOPROXY/M/@v/<v>.mod`           | The `go.mod` file of `M` at version `v`.                           |
| `GET $GOPROXY/M/@v/<v>.zip`           | The source archive of `M` at version `v` (only when needed).       |
| `GET $GOPROXY/M/@latest`              | JSON metadata for the latest release; used by `@latest`.           |

The module path `M` is **case-encoded** before being placed into the URL: each uppercase letter `X` is replaced by `!x`. Example: `github.com/Masterminds/semver` becomes `github.com/!masterminds/semver`.

`go get` may resolve a module path through several proxies in sequence (per `GOPROXY`); each proxy is tried until one returns success or all return a "not found" status (HTTP 404 or 410).

---

## Checksum Database Interaction

When `go get` resolves a new module version that is not already pinned in `go.sum`, it consults the **checksum database** (default `sum.golang.org`) to obtain a notarized hash, then verifies that the bytes received from the proxy match. The protocol is described in `go.dev/ref/mod#checksum-database`.

Sequence (when `GOSUMDB` is enabled and the module is not exempted):

1. Compute the H1 hash of the module's `.zip` and of its `.mod` file.
2. Query `GET $GOSUMDB/lookup/M@v` to obtain the signed hashes recorded by the database.
3. Verify the database's signature against the trusted public key.
4. Compare the signed hash to the locally computed hash.
5. On match, append the entries to `go.sum` and proceed. On mismatch, abort with a security error.

If the module path matches `GONOSUMCHECK` (or the older `GOINSECURE` for transport, or `GOPRIVATE` for both proxy and sum-DB), the database is **not consulted** and `go.sum` entries are recorded based purely on the bytes received from the proxy. The user has accepted the trust trade-off.

---

## GOPROXY, GOPRIVATE, GONOPROXY, GONOSUMCHECK, GOSUMDB

These environment variables, listed in `go.dev/ref/mod#environment-variables`, control the network behaviour of `go get`:

| Variable        | Default                              | Meaning                                                               |
|-----------------|--------------------------------------|-----------------------------------------------------------------------|
| `GOPROXY`       | `https://proxy.golang.org,direct`    | Comma- or pipe-separated list of proxies. `direct` means VCS fetch.   |
| `GOSUMDB`       | `sum.golang.org`                     | Notary URL plus public key. `off` disables checksum-DB lookup entirely. |
| `GOPRIVATE`     | empty                                | Glob list. Modules matching skip both proxy and sum-DB.               |
| `GONOPROXY`     | inherits `GOPRIVATE`                 | Glob list. Modules matching skip the proxy and are fetched directly.  |
| `GONOSUMCHECK`  | inherits `GOPRIVATE`                 | Glob list. Modules matching skip sum-DB lookup (must already be in `go.sum`). |
| `GOINSECURE`    | empty                                | Glob list. Modules matching may use plaintext transport.              |

**Glob syntax.** Each entry is a glob in the style of `path.Match`, with `,` separating entries. A path matches if it equals or has a prefix that matches one of the entries. Example: `GOPRIVATE=*.corp.example.com,github.com/acme/*`.

**Precedence rules.**

1. `GONOPROXY` and `GONOSUMCHECK`, if set, override the corresponding aspect of `GOPRIVATE`.
2. If `GOPRIVATE` is set and neither override is, both proxy and sum-DB are skipped for matching modules.
3. `GOPROXY=off` blocks all proxy access; only modules already in cache are usable.
4. `GOPROXY=direct` forces VCS fetches.
5. The value of `GOPROXY` is processed left-to-right; `,` means "fall through on 404/410", `|` means "fall through on any error".

---

## What `go get` Does NOT Do (Per Reference)

The Go Modules Reference is explicit about the boundaries of `go get`'s responsibility:

- **It does not install binaries.** Since Go 1.17, `go get` no longer builds or writes binaries to `$GOBIN`. The replacement is `go install pkg@version`.
- **It does not change source code.** No `.go` file is created, edited, or deleted by `go get`.
- **It does not remove unused dependencies.** Removing requirements that are no longer needed is the job of `go mod tidy`. `go get` adds and adjusts; it does not prune unrelated entries.
- **It does not run tests.** Even with `-t`, the flag only widens the set of modules considered; tests are not executed.
- **It does not update `vendor/`.** After `go get`, the user must run `go mod vendor` if a vendor tree is in use.
- **It does not initialize a module.** A `go.mod` must already exist (since Go 1.16, running `go get` outside a module is an error).
- **It does not update the `go` directive.** Only `go mod tidy` and `go mod edit` change the `go` directive.

Conversely, behaviours that `go get` *does* spec out:

- Resolution of arguments to module versions via the proxy.
- Verification of downloaded content against the checksum database.
- Updates to `go.mod` (the `require` block) and `go.sum`.
- MVS recomputation across the dependency graph.

---

## Differences Across Go Versions

The behaviour of `go get` has changed substantially across releases:

- **Go 1.11** — `go get` introduced for modules behind `GO111MODULE=on`. Outside modules, the legacy GOPATH `go get` still applies.
- **Go 1.13** — Module proxy and checksum database introduced. `GOPROXY=https://proxy.golang.org,direct` becomes the default.
- **Go 1.14** — `go.sum` is verified even when modules come from a local replacement.
- **Go 1.16** — Modules become the default. **`go get` outside a module is an error**; the `GO111MODULE=auto` fallback no longer creates an implicit module.
- **Go 1.17** — Major change: `go get -d` is the default; `go get` no longer installs binaries. `go install pkg@version` is the replacement for installing tools. Documentation calls this "`go get` is for dependency management; `go install` is for binaries."
- **Go 1.18** — Workspaces (`go.work`) introduced. When inside a workspace, `go get` updates the requirements of the **module containing the working directory**, not the workspace itself.
- **Go 1.19** — Improvements to error reporting on proxy failures.
- **Go 1.20** — `GOTOOLCHAIN` environment variable affects which toolchain is used; `go get` may switch toolchains transparently.
- **Go 1.21** — `toolchain` directive in `go.mod` interacts with `go get`. If a fetched module declares a `go` line newer than the running toolchain, `go get` may auto-download a matching toolchain (subject to `GOTOOLCHAIN`).
- **Go 1.22 / 1.23** — Minor refinements; the contract from 1.17 (no binary install) and 1.21 (toolchain interaction) is stable.

The mechanical command — `go get pkg@version` updates `go.mod` and `go.sum` — has been stable in shape since Go 1.11. The *side effects* (binary install in pre-1.17, toolchain switching in post-1.21) have grown and shrunk.

---

## References

- [Go Modules Reference](https://go.dev/ref/mod) — authoritative.
- [Module proxy protocol](https://go.dev/ref/mod#module-proxy)
- [Pseudo-versions](https://go.dev/ref/mod#pseudo-versions)
- [Major version suffixes](https://go.dev/ref/mod#major-version-suffixes)
- [Authenticating modules (sum DB)](https://go.dev/ref/mod#authenticating)
- [Environment variables](https://go.dev/ref/mod#environment-variables)
- [`go help get`](https://pkg.go.dev/cmd/go#hdr-Add_dependencies_to_current_module_and_install_them)
- [`go help install`](https://pkg.go.dev/cmd/go#hdr-Compile_and_install_packages_and_dependencies)
- [Source: `cmd/go/internal/modget/get.go`](https://cs.opensource.google/go/go/+/refs/tags/master:src/cmd/go/internal/modget/get.go)
- [Go 1.17 release notes — `go get` change](https://go.dev/doc/go1.17#go-command)
- [Go 1.16 release notes — modules default](https://go.dev/doc/go1.16#modules)
