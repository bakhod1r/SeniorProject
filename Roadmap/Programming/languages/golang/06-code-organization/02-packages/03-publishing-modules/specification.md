# Publishing Modules — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Semver Reference for Go Modules](#semver-reference-for-go-modules)
3. [Tag Format](#tag-format)
4. [The Major Version Suffix Rule (`/vN` for N >= 2)](#the-major-version-suffix-rule-vn-for-n-2)
5. [Pseudo-Version Format](#pseudo-version-format)
6. [Multi-Module Repos: Tag Prefixes](#multi-module-repos-tag-prefixes)
7. [The `retract` Directive](#the-retract-directive)
8. [Vanity Import Paths: `go-import` Meta Tag](#vanity-import-paths-go-import-meta-tag)
9. [The Module Proxy Protocol](#the-module-proxy-protocol)
10. [Checksum Database: How Inclusion Works](#checksum-database-how-inclusion-works)
11. [What Publishing Does NOT Require](#what-publishing-does-not-require)
12. [Differences Across Go Versions](#differences-across-go-versions)
13. [References](#references)

---

## Introduction

There is no `go publish` command. In Go, "publishing a module" means making a tagged commit reachable from a public (or private) VCS URL that satisfies the module path. The Go language specification (`go.dev/ref/spec`) does not address publishing at all; the authoritative reference is the **Go Modules Reference** at `go.dev/ref/mod`.

Within that reference, the publishing-relevant sections are:

- *Versions* — defines the version syntax accepted by the toolchain.
- *Major version suffixes* — the `/vN` rule for N >= 2.
- *Pseudo-versions* — synthetic versions for untagged commits.
- *Module proxy* — the HTTP protocol used to fetch modules.
- *Checksum database* (sumdb) — the transparent log used to verify module hashes.
- *retract directive* — the in-`go.mod` mechanism for withdrawing versions.
- *Vanity import paths* — the `<meta name="go-import">` redirection mechanism.

Publishing is therefore mostly Git plus convention. This file documents the formal rules each of those subsystems imposes.

References:
- [Go Modules Reference](https://go.dev/ref/mod)
- [Versions](https://go.dev/ref/mod#versions)
- [Module proxy protocol](https://go.dev/ref/mod#module-proxy)
- [Checksum database](https://go.dev/ref/mod#checksum-database)

---

## Semver Reference for Go Modules

The Go module system uses **Semantic Versioning 2.0.0** (`semver.org/spec/v2.0.0.html`) with one strict addition: the version string in tags and in `go.mod` must always begin with the literal letter `v`.

A semver-compatible Go version string has the form:

```
v MAJOR . MINOR . PATCH [ - PRE-RELEASE ] [ + BUILD-METADATA ]
```

Semantic rules from SemVer 2.0.0 that the Go toolchain enforces:

1. `MAJOR`, `MINOR`, `PATCH` are non-negative integers without leading zeros (except `0` itself).
2. Pre-release identifiers may not be empty and must consist of `[0-9A-Za-z-]+`, separated by dots; numeric identifiers must not have leading zeros.
3. Build metadata is parsed but **ignored** for ordering and equality of module versions.
4. Precedence is computed first by `MAJOR.MINOR.PATCH`, then by pre-release identifiers, with absent pre-release being higher than present.

Go-specific deviations:

- The `v` prefix is mandatory. `1.2.3` (no leading `v`) is rejected by `golang.org/x/mod/semver.IsValid`.
- The Go module proxy will not serve a tag without the `v` prefix.

---

## Tag Format

The complete grammar for a publishable Go version tag:

```
Tag        = "v" Major "." Minor "." Patch [ "-" Pre ] [ "+" Build ] .
Major      = "0" | "1"..."9" { Digit } .
Minor      = Digit { Digit } .
Patch      = Digit { Digit } .
Pre        = PreId { "." PreId } .
PreId      = AlphaNum { AlphaNum | "-" } .
Build      = BuildId { "." BuildId } .
BuildId    = AlphaNum { AlphaNum | "-" } .
AlphaNum   = Letter | Digit .
Letter     = "a"..."z" | "A"..."Z" .
Digit      = "0"..."9" .
```

Compact regular-expression form (matches `golang.org/x/mod/semver`):

```
^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$
```

Examples:

| Tag | Valid? | Notes |
|-----|--------|-------|
| `v1.0.0` | yes | release |
| `v0.1.0` | yes | unstable, no `/v0` suffix |
| `v2.0.0` | yes only with `/v2` path suffix | see next section |
| `v1.0.0-rc.1` | yes | pre-release |
| `v1.0.0+meta` | yes | build metadata ignored for ordering |
| `1.0.0` | no | missing `v` |
| `v01.0.0` | no | leading zero |
| `v1.0` | no | missing patch |

Authoritative spec: [Go Modules Reference — Versions](https://go.dev/ref/mod#versions).

---

## The Major Version Suffix Rule (`/vN` for N >= 2)

For any module whose `MAJOR` is 2 or greater, the module path itself must end with `/vN` where `N` equals that major version. This is the **import compatibility rule**:

> Two modules with the same import path must be backwards compatible.

Formal restatement:

```
If MAJOR(version) >= 2, then ModulePath = Prefix "/v" itoa(MAJOR) .
```

Consequences for publishing:

1. The `module` directive in `go.mod` on the `vN` branch (or the subdirectory `vN/`) must be `<prefix>/vN`.
2. Tags are still of the form `vN.M.P`; the `/vN` lives in the path, not the tag.
3. `v0` and `v1` use no suffix. `v0.x.y` is treated as unstable; semver does not grant compatibility guarantees.
4. Downgrading the major version requires forking the import path or repeating the suffix bump.

Two physical layouts are spec-equivalent:

- **Branch layout.** A `v2` Git branch contains a `go.mod` with `module example.com/lib/v2`.
- **Subdirectory layout.** A `v2/` directory at repo root contains its own `go.mod` with `module example.com/lib/v2`. Tags become `v2/v2.0.0`.

---

## Pseudo-Version Format

For untagged commits (or for commits not yet visible from a release tag), the toolchain synthesises a **pseudo-version** of the form:

```
v MAJOR . MINOR . PATCH - yyyymmddhhmmss - abbrevhash
```

where `yyyymmddhhmmss` is the commit's UTC timestamp and `abbrevhash` is the first 12 hex characters of the commit hash.

The Go Modules Reference defines exactly three forms:

1. **No release tag yet.**
   ```
   v0.0.0-yyyymmddhhmmss-abbrevhash
   ```
   Used when no semver-valid tag is reachable from the commit.

2. **Pre-release tag is reachable.**
   ```
   vX.Y.Z-pre.0.yyyymmddhhmmss-abbrevhash
   ```
   Used when the commit derives from a pre-release tag `vX.Y.Z-pre`. The literal `.0` is appended to keep the new pseudo-version higher than the tag.

3. **Mainline release reachable.**
   ```
   vX.Y.(Z+1)-0.yyyymmddhhmmss-abbrevhash
   ```
   Used when the commit derives from a mainline release `vX.Y.Z`. The patch is incremented and `-0.` precedes the timestamp.

Pseudo-versions are not user-publishable; the toolchain mints them on demand. They are valid input wherever a normal version is expected.

---

## Multi-Module Repos: Tag Prefixes

A single repository may host multiple modules. The convention, codified by the proxy protocol, is that the tag for a sub-module is **prefixed by the directory** of that module's `go.mod` relative to the repo root.

Example. A repo `github.com/example/repo` with layout:

```
repo/
  go.mod          // module github.com/example/repo
  api/
    go.mod        // module github.com/example/repo/api
  cli/
    go.mod        // module github.com/example/repo/cli
```

Tag forms:

- `v1.2.3` — root module.
- `api/v1.2.3` — the `api` sub-module.
- `cli/v0.4.0` — the `cli` sub-module.

The proxy resolves a request for `github.com/example/repo/api@v1.2.3` by looking for the tag `api/v1.2.3`, then loading `api/go.mod` from the corresponding commit.

For `/vN` sub-module paths (e.g. `api/v2`), the tag is `api/v2.0.0`.

---

## The `retract` Directive

The `retract` directive in `go.mod` (added in Go 1.16) marks one or more previously published versions as withdrawn. Withdrawn versions remain downloadable for reproducibility but are excluded from automatic version resolution.

Grammar:

```
RetractStmt    = "retract" RetractTarget [ Comment ] .
RetractTarget  = Version
               | "[" Version "," Version "]"
               | "(" { RetractTarget } ")" .
Version        = "v" Major "." Minor "." Patch [ "-" Pre ] [ "+" Build ] .
```

Forms:

```go
// Single version
retract v1.2.0

// Closed range
retract [v1.2.0, v1.2.5]

// Block of multiple
retract (
    v1.0.1
    v1.0.2
    [v1.1.0, v1.1.3]
)
```

Mechanics:

- A `retract` directive must appear in a `go.mod` of a **later** version than the one being retracted; the toolchain reads the retraction from the highest available `go.mod`.
- Retractions are advisory: `go get example.com/lib@v1.2.0` still works if explicitly requested, but `go get example.com/lib` will skip retracted versions.
- A `// comment` (using a Go-style line comment) on the same line is conventionally used to explain the retraction; `go list -m -retracted` surfaces it.

---

## Vanity Import Paths: `go-import` Meta Tag

A *vanity* path lets a module live at a friendly URL (`example.com/lib`) while being hosted on a different VCS (`github.com/alice/lib`). The toolchain performs a single HTTP `GET` to the import path with the query `?go-get=1` and parses the response HTML.

The required meta tag:

```html
<meta name="go-import" content="<importprefix> <vcs> <repoURL>">
```

Where:

- `<importprefix>` — the module path prefix the meta tag describes (must be a prefix of the requested import path).
- `<vcs>` — one of `git`, `hg`, `svn`, `bzr`, `fossil`, or `mod` (mod = static module proxy).
- `<repoURL>` — the URL of the underlying repository.

Optional companion tag for documentation tooling:

```html
<meta name="go-source" content="<importprefix> <home> <directory> <file>">
```

`go-source` is consumed by `pkg.go.dev` and by `godoc` to construct browse links; it is not required by `go get`.

The HTTP fetch is performed once per *prefix* per build; the toolchain caches the result for the duration of the invocation.

---

## The Module Proxy Protocol

The Go module proxy protocol (`go.dev/ref/mod#module-proxy`) is an HTTP+TLS protocol with five `GET` endpoints. From the publish-relevant view, the publisher does nothing here directly — the proxy mirrors the public VCS — but the contract is what consumers see.

Endpoints (relative to a proxy base URL):

| Endpoint | Returns |
|----------|---------|
| `$base/<module>/@v/list` | newline-separated list of known versions |
| `$base/<module>/@v/<version>.info` | JSON metadata (Version, Time) |
| `$base/<module>/@v/<version>.mod` | the `go.mod` file |
| `$base/<module>/@v/<version>.zip` | the module source tree as a zip |
| `$base/<module>/@latest` | JSON for the latest version |

Module-path encoding: each ASCII uppercase letter is replaced by `!` followed by its lowercase counterpart (so `Sirupsen` becomes `!sirupsen`). Versions are encoded the same way.

Authentication for **private** modules:

- The proxy URL may use HTTPS basic auth: `https://user:pass@proxy.corp/...`.
- Credentials may be stored in `~/.netrc` (or `_netrc` on Windows). The toolchain reads `netrc` for `https://` proxy URLs.
- `GONOPROXY`, `GOPRIVATE`, and `GONOSUMCHECK` direct the toolchain to bypass the public proxy/sumdb for matching paths.

The default public proxy is `https://proxy.golang.org`, configured via the `GOPROXY` environment variable.

---

## Checksum Database: How Inclusion Works

The Go checksum database (sumdb), at `sum.golang.org`, is a **transparent log** built on the `tlog` protocol (`research.swtch.com/tlog`). Each entry is a signed (module, version, hash) triple. The default client trusts the public key embedded in the toolchain.

Inclusion mechanics, as relevant to publishers:

1. The publisher pushes a tag to public Git.
2. The first `go get` of that version causes the proxy to fetch the source, compute the `h1:` hash, and submit the entry to the sumdb.
3. The sumdb verifies, signs, and adds the entry to its append-only log.
4. Subsequent clients fetch a signed *inclusion proof* and verify the hash matches before adding to their local `go.sum`.

What this means for publishing:

- **There is no submit step.** First-fetcher triggers inclusion.
- **Tag immutability matters.** Re-tagging an existing version after sumdb inclusion will produce a hash mismatch on every other client.
- **`GONOSUMCHECK` / `GOSUMDB=off` / `GOPRIVATE`** disable verification on the *consumer* side; they do not affect what is stored in the public log.

---

## What Publishing Does NOT Require

There is no central registry for Go modules. Specifically, publishing requires **none** of:

- Creating an account on `go.dev`, `pkg.go.dev`, or `proxy.golang.org`.
- Pushing to any registry.
- Filing a manifest.
- Running a "publish" command.
- Authoring a license, README, or CHANGELOG (recommended, not required).

The minimum sufficient act of publishing is: **push a Git commit and a semver tag to a URL the module path resolves to.** Discovery — by `pkg.go.dev`, by the proxy, by sumdb — happens automatically the first time anyone runs `go get` against that path.

Conversely, the toolchain does enforce:

- Tag must match `^v\d+\.\d+\.\d+(-[A-Za-z0-9.-]+)?(\+[A-Za-z0-9.-]+)?$`.
- For major >= 2, the module path must carry the `/vN` suffix and the `go.mod` must declare it.
- The `go.mod` must be parseable and self-consistent.
- VCS URL must be reachable (or a vanity redirect must serve a `go-import` meta tag).

---

## Differences Across Go Versions

- **Go 1.11** — Modules introduced. Semver tags become the primary version mechanism; pseudo-versions defined.
- **Go 1.13** — Module proxy (`proxy.golang.org`) and checksum database (`sum.golang.org`) introduced and on by default for new projects.
- **Go 1.14** — `vendor/` auto-detected; no change to publishing mechanics.
- **Go 1.16** — `retract` directive added.
- **Go 1.17** — Lazy module loading; `go.mod` may carry indirect requirements explicitly.
- **Go 1.18** — Workspaces (`go.work`) introduced; not used in published modules (workspace files are conventionally not committed).
- **Go 1.21** — `toolchain` directive added: a published module may now require a specific minimum toolchain version, distinct from the language version in the `go` directive.
- **Go 1.22** — `for`-loop variable semantics keyed off the `go` directive, affecting forward-compatibility of published code.
- **Go 1.23** — `range`-over-func iterators keyed off the `go` directive.

The act of publishing — push tag, done — has not changed since Go 1.11. What evolves is the set of invariants the toolchain enforces on the `go.mod` it reads back.

---

## References

- [Go Modules Reference](https://go.dev/ref/mod) — authoritative.
- [Versions](https://go.dev/ref/mod#versions)
- [Major version suffixes](https://go.dev/ref/mod#major-version-suffixes)
- [Pseudo-versions](https://go.dev/ref/mod#pseudo-versions)
- [Module proxy protocol](https://go.dev/ref/mod#module-proxy)
- [Checksum database](https://go.dev/ref/mod#checksum-database)
- [`retract` directive](https://go.dev/ref/mod#go-mod-file-retract)
- [Vanity import paths](https://go.dev/ref/mod#vcs-find)
- [SemVer 2.0.0 specification](https://semver.org/spec/v2.0.0.html)
- [Transparent log design (`tlog`)](https://research.swtch.com/tlog)
- [Source: `cmd/go/internal/modload/init.go`](https://cs.opensource.google/go/go/+/refs/tags/master:src/cmd/go/internal/modload/init.go)
- [Publishing a module (tutorial)](https://go.dev/doc/modules/publishing)
