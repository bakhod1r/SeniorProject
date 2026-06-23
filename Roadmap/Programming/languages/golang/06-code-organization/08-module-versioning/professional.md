# Module Versioning — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Minimum Version Selection (MVS) Algorithm](#minimum-version-selection-mvs-algorithm)
3. [The Module Graph as a Data Structure](#the-module-graph-as-a-data-structure)
4. [Pseudo-Version Anatomy](#pseudo-version-anatomy)
5. [The Module Proxy Protocol](#the-module-proxy-protocol)
6. [The Checksum Database](#the-checksum-database)
7. [GOMODCACHE Layout](#gomodcache-layout)
8. [`go.sum` Computation](#gosum-computation)
9. [Version String Comparison Rules](#version-string-comparison-rules)
10. [The `go` Directive and Toolchain Selection](#the-go-directive-and-toolchain-selection)
11. [Lazy Loading and `go.mod` Pruning](#lazy-loading-and-gomod-pruning)
12. [Diagnostics and `cmd/go` Internals](#diagnostics-and-cmdgo-internals)
13. [Summary](#summary)
14. [Related Topics](#related-topics)

---

## Introduction

This file is for engineers who need to debug version-resolution edge cases, build module-aware tooling, or contribute to `cmd/go` itself. The mental model becomes: every step in resolving a build is a small, decidable transformation on a graph, and every artifact (pseudo-version string, `go.sum` line, cache path) has a precise, reproducible derivation.

After reading you will:
- State the MVS algorithm in pseudocode
- Decode any pseudo-version into its three constituent parts and explain how the toolchain assembled it
- Walk through the proxy protocol HTTP request/response flow
- Locate any cached module on disk and explain its layout
- Compute a `go.sum` line by hand (in principle) given a module's bytes
- Diagnose `inconsistent module graph` and similar errors

---

## Minimum Version Selection (MVS) Algorithm

MVS is the resolution algorithm used by `cmd/go`. It is deterministic, single-pass over a graph, and free of backtracking. The full algorithm in pseudocode:

```
function MVS(rootModule):
    selected = {}                     # module path -> version
    queue   = [rootModule]
    while queue is not empty:
        m = pop(queue)
        if m.path in selected and selected[m.path] >= m.version:
            continue
        selected[m.path] = max(selected[m.path], m.version)
        for each (p, v) in requirements(m.path, m.version):
            queue.append((p, v))
    return selected
```

In English:

1. Start with the main module.
2. For each module-version pair you encounter, record it as the highest version required for that module.
3. For each newly-recorded version, fetch its `go.mod` and add its requirements to the queue.
4. Continue until the queue is empty.

The result: a flat map from module path to version. Build that map's modules; you have the complete dependency closure.

### Why "minimum"

Each requirement in a `go.mod` is a *floor* — "at least this version." MVS picks the smallest version that satisfies all floors. Because the floors come from independent modules, the smallest satisfying version is the largest floor — i.e., the highest version anyone in the graph required.

### Worked example

```
main:
  require A v1.2.0
  require B v1.0.0

A v1.2.0:
  require C v1.5.0

B v1.0.0:
  require A v1.1.0
  require C v1.4.0
```

Trace:

| Step | Queue | Selected |
|------|-------|----------|
| 0 | `[main]` | `{main}` |
| 1 | `[(A, v1.2.0), (B, v1.0.0)]` | `{main}` |
| 2 | `[(B, v1.0.0), (C, v1.5.0)]` | `{main, A=v1.2.0}` |
| 3 | `[(C, v1.5.0), (A, v1.1.0), (C, v1.4.0)]` | `{main, A=v1.2.0, B=v1.0.0}` |
| 4 | `[(A, v1.1.0), (C, v1.4.0)]` | `{main, A=v1.2.0, B=v1.0.0, C=v1.5.0}` |
| 5 | `[(C, v1.4.0)]` | unchanged (`A v1.1.0` skipped because already at v1.2.0) |
| 6 | `[]` | unchanged (`C v1.4.0` skipped because already at v1.5.0) |

Result: `A=v1.2.0`, `B=v1.0.0`, `C=v1.5.0`. The build links exactly these versions.

### Why MVS does not backtrack

In Cargo or npm, the resolver may try one version, find it conflicts with another constraint, and backtrack. MVS cannot — its only operation is "raise the floor," and floors only ever go up. There is no decision to undo.

This guarantees `O(N)` resolution time where N is the number of edges in the requirement graph, and produces a unique result for any valid graph.

### `replace`, `exclude`, and `retract` in MVS

- `replace`: applied *only from the main module's `go.mod`*. Before MVS picks a version, the requirement is rewritten through the replace map.
- `exclude`: filters out forbidden versions during graph traversal.
- `retract`: read from the *latest* version of each module to inform `go list -u`. Does not change MVS output for already-pinned versions.

---

## The Module Graph as a Data Structure

Internally, `cmd/go` represents the requirement graph as a sparse map keyed by `(module path, version)`. Each key maps to a list of edges (its requirements).

A simplified Go-ish representation:

```go
type ModuleVersion struct {
    Path    string
    Version string
}

type Graph struct {
    nodes map[ModuleVersion]*Node
}

type Node struct {
    GoMod        string             // raw go.mod text
    Requirements []ModuleVersion    // direct requirements
    Replace      *ModuleVersion     // optional
}
```

Nodes are loaded lazily — only when MVS reaches them. With Go 1.17+'s lazy module graph, the loader can skip portions of the graph that are not relevant to the current build target.

### Pruned graph (Go 1.17+)

Before Go 1.17, MVS loaded the *entire* transitive `go.mod` graph. After Go 1.17, with `go 1.17` (or newer) declared in the main module's `go.mod`, the graph is *pruned*: only the `go.mod`s of direct dependencies and their declared `require` lines (which include all needed indirects under 1.17+) are loaded.

The flag in `go.mod`:

```
go 1.17
```

versus

```
go 1.16
```

changes the loader's behaviour. With `go 1.17+`, you will see *more* `// indirect` lines in `go.mod` because indirect requirements must now be explicit.

---

## Pseudo-Version Anatomy

A pseudo-version is composed mechanically. Three forms:

```
v0.0.0-<timestamp>-<hash[:12]>                     # no preceding tag
v<X.Y.Z+1>-0.<timestamp>-<hash[:12]>               # preceding tag is vX.Y.Z (no pre-release)
v<X.Y.Z>-<pre>.0.<timestamp>-<hash[:12]>           # preceding tag has pre-release suffix
```

### Example trace

Given a repo where the latest tag *before* commit `abc123def4567890` (timestamp `2024-06-12T10:35:15Z`) is `v1.5.0`:

- Base: `v1.5.1` (the patch+1 of the preceding tag).
- Pre-release marker: `0` (constant, indicates this is a pseudo-version).
- Timestamp: `20240612103515` (UTC, no separators).
- Hash: `abc123def456` (first 12 hex chars).

Final string: `v1.5.1-0.20240612103515-abc123def456`.

### Why the `+1` in the patch

So that pseudo-versions sort *after* the base tag. `v1.5.0 < v1.5.1-0.<ts> < v1.5.1`. Picking `v1.5.0+1.0...` would not work because semver does not allow `+1` in this position; the `0.` pre-release marker plus PATCH+1 is the canonical workaround.

### Hash format

Always the first 12 hexadecimal characters of the commit SHA, lowercase. Even though Git commit SHAs are 40 hex characters, the pseudo-version uses 12. This is enough to disambiguate any reasonable repo.

### Timestamp format

`YYYYMMDDHHMMSS` in UTC, taken from the *commit* timestamp (not the local clock when `go get` runs). Two pseudo-versions on the same commit are bit-identical.

### Constructing one by hand

```bash
TS=$(git log -1 --format=%cd --date=format-local:%Y%m%d%H%M%S TZ=UTC)
HASH=$(git rev-parse --short=12 HEAD)
TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo v0.0.0)
# Bump PATCH, append the pseudo suffix
echo "${TAG%.*}.$(($(echo $TAG | rev | cut -d. -f1 | rev) + 1))-0.${TS}-${HASH}"
```

(Approximate — the real algorithm handles pre-release tags too.)

---

## The Module Proxy Protocol

`proxy.golang.org` (and any Go-compatible proxy) speaks a small HTTP protocol. Every endpoint is a GET request returning either content or 404.

| Endpoint | Returns |
|----------|---------|
| `/{module}/@v/list` | List of available semver versions, newline-separated. |
| `/{module}/@v/{version}.info` | JSON: `{"Version": "...", "Time": "..."}` |
| `/{module}/@v/{version}.mod` | The `go.mod` of that version. |
| `/{module}/@v/{version}.zip` | The full source as a deterministic zip. |
| `/{module}/@latest` | JSON for the latest version. |

Module paths are *escaped*: capital letters become `!lowercase`. Example: `github.com/Foo/Bar` becomes `github.com/!foo/!bar` in URLs.

### Example request

```
GET https://proxy.golang.org/github.com/google/uuid/@v/list
v1.0.0
v1.1.0
v1.2.0
v1.3.0
v1.4.0
v1.5.0
v1.6.0
```

```
GET https://proxy.golang.org/github.com/google/uuid/@v/v1.6.0.info
{"Version":"v1.6.0","Time":"2024-01-22T19:00:00Z"}
```

### Caching

The proxy caches every successful fetch indefinitely. A version published once is available forever — even if the upstream Git repo is deleted. This is a deliberate design choice (preventing left-pad-style incidents) and means publishers cannot un-publish.

### `GOPROXY`

The environment variable `GOPROXY` is a comma-separated list of proxies tried in order. The default is `https://proxy.golang.org,direct`. Other common values:

- `direct` — clone the source from the Git host directly. Slower, no checksum benefits.
- `off` — refuse network access; use cache only.
- A private proxy URL — e.g., for monorepos using Athens or JFrog Artifactory.

### `GOPRIVATE` and `GONOPROXY`

`GOPRIVATE=*.corp.example.com` tells Go to skip proxy and sumdb for matching paths (treat as private). `GONOPROXY` is the same for proxy only.

---

## The Checksum Database

`sum.golang.org` is a transparent log of `(module, version) -> hash` mappings. It is append-only and cryptographically verifiable.

### What it stores

For every module version ever requested through the public proxy, two hashes:

- `h1:<base64>` — the hash of the module's contents (the zip).
- `h1:<base64>` for the `go.mod` separately.

### Why a transparency log

Append-only means a malicious operator cannot rewrite history. Clients can audit by comparing a hash they computed locally to what the log says.

### `go.sum` and `sum.golang.org`

When `go mod tidy` adds a new module, the toolchain:

1. Downloads the module bytes.
2. Computes the hash locally.
3. Queries `sum.golang.org` for the published hash.
4. Compares. If they disagree, refuses to write `go.sum`.
5. Writes the hash to `go.sum`.

After this, every subsequent `go build` re-checks the local cache against `go.sum` (not against `sum.golang.org`).

### `GOSUMDB`

Controls the checksum database. Default: `sum.golang.org`. Common values:

- `off` — skip verification (not recommended for public modules).
- A private sumdb URL.

### `GONOSUMCHECK` (rare)

For specific modules, skip sumdb. `GONOSUMCHECK=*.corp.example.com` tells Go not to consult sumdb for matching paths. Combined with `GOPRIVATE`, used for internal modules.

---

## GOMODCACHE Layout

The module cache lives under `$GOPATH/pkg/mod/` (or `$GOMODCACHE` if set). Layout:

```
$GOMODCACHE/
├── cache/
│   ├── download/
│   │   └── github.com/
│   │       └── google/
│   │           └── uuid/
│   │               └── @v/
│   │                   ├── list
│   │                   ├── v1.6.0.info
│   │                   ├── v1.6.0.mod
│   │                   ├── v1.6.0.zip
│   │                   └── v1.6.0.ziphash
│   └── lock
├── github.com/
│   └── google/
│       └── uuid@v1.6.0/      ← extracted source, read-only
│           ├── LICENSE
│           ├── uuid.go
│           └── ...
└── cache/sumdb/
    └── sum.golang.org/
        └── lookup/
            └── github.com/google/uuid@v1.6.0
```

Two regions:

- **`cache/download/...`** — the canonical artefacts (`.info`, `.mod`, `.zip`, `.ziphash`). Written once, read many.
- **`<module>@<version>/`** — extracted source on disk, read-only (`chmod 0444`). The build reads from here.

The cache is shared across all Go projects on the machine. The lock file (`cache/lock`) coordinates concurrent writers.

### Capital-letter encoding

Recall that paths with uppercase letters are escaped: `github.com/Foo/Bar` becomes `github.com/!foo/!bar`. The cache uses the escaped form on disk.

### `go clean -modcache`

Clears the entire cache. The next build re-downloads from the proxy. Use only when you suspect cache corruption.

---

## `go.sum` Computation

A `go.sum` line looks like:

```
github.com/google/uuid v1.6.0 h1:NIvaJDMOsjHA8n1jAhLSgzrAzy1Hgr+hNrb57e+94F0=
github.com/google/uuid v1.6.0/go.mod h1:TIyPZe4MgqvfeYDBFedMoGGpEw/LqOeaOT+nhxU+yHo=
```

Two lines per (module, version) pair: one for the full module zip (`h1:`), one for the `go.mod` only (`/go.mod h1:`).

### `h1:` algorithm

The `h1:` hash is computed as:

1. Build a list of `(filename, sha256(file contents))` for every file in the module zip.
2. Sort by filename.
3. Concatenate `f"{path}  h1:{base64(sha256(contents))}\n"` for each.
4. SHA256 of that concatenation, base64-encoded.
5. Prefixed with `h1:`.

This yields a hash that is:
- Independent of zip compression details (uses file contents directly).
- Stable across operating systems (assuming consistent file-system semantics).
- A canonical fingerprint of the module's source tree.

### Why two lines

The full module hash (for the source zip) and the `go.mod`-only hash exist separately. The `go.mod`-only hash is needed to verify a module's `go.mod` *before* downloading the full zip — useful for traversing the requirement graph during MVS without fetching every module's source.

### Implication

If a maintainer force-pushes a tag (illegal but technically possible), the `h1:` hash changes. Existing builds that pinned the original `h1:` will refuse to use the new bytes. New builds without a `go.sum` entry will fetch the new bytes and compare against `sum.golang.org`. Mismatch — refuses to build.

### `go mod verify`

Re-hashes every module in the cache and compares against `go.sum`. If anything differs, a tamper has happened locally (corrupted disk, tampered cache, or someone modified a "read-only" cache file).

---

## Version String Comparison Rules

Implemented in `golang.org/x/mod/semver`. Algorithm for comparing `vA` and `vB`:

1. Strip the `v` prefix.
2. Split into `MAJOR`, `MINOR`, `PATCH`, optional `PRE`, optional `BUILD`.
3. Compare `MAJOR`, then `MINOR`, then `PATCH` numerically.
4. If all equal so far:
    - If neither has `PRE`, equal.
    - If only one has `PRE`, the one with `PRE` is *less*.
    - Otherwise, compare `PRE` element-by-element (numeric < alphanumeric; numerics numeric; alphanumerics lex).
5. `BUILD` does not affect ordering.

### Edge cases

- `v1.0.0` vs `v1.0.0+meta`: equal in ordering, but Go treats them as the same version.
- `v1.0.0-alpha` vs `v1.0.0-alpha.1`: the second is greater (more elements, all initial elements equal).
- `v2.0.0+incompatible` vs `v2.0.0`: equal in ordering; the `+incompatible` is metadata.
- Pseudo-versions with the same base sort by timestamp.

---

## The `go` Directive and Toolchain Selection

The `go 1.X` line in `go.mod` declares:

1. The *minimum language version* the code requires.
2. The *minimum toolchain version* that should build the module.
3. Implicit lazy-loading behaviour (`go 1.17+` activates the pruned graph).

Since Go 1.21, an additional `toolchain` directive can pin a specific toolchain:

```
go 1.21
toolchain go1.22.3
```

When run with `go1.21`, the toolchain auto-downloads `go1.22.3` and re-execs with it. This is `cmd/go`'s built-in version manager.

Environment variables:

- `GOTOOLCHAIN=auto` (default) — automatic downloads as above.
- `GOTOOLCHAIN=local` — never auto-download; use the binary on PATH.
- `GOTOOLCHAIN=go1.23` — pin a specific version.

---

## Lazy Loading and `go.mod` Pruning

### Eager (Go ≤ 1.16)

The build loaded every transitive `go.mod` to compute MVS. A 200-deep graph meant 200 file fetches.

### Lazy (Go 1.17+)

If the main module declares `go 1.17` or later, the loader assumes:

- The main module's `go.mod` lists *every* module that contributes to the build (direct + transitive).
- Transitive `go.mod`s only need to be loaded if a not-yet-listed module is encountered.

In practice, `go mod tidy` ensures the main `go.mod` lists every dependency, and the build skips deep loading.

Result: 10x to 100x fewer proxy round-trips on cold caches for large dependency graphs.

The trade-off: `go.mod` becomes longer (more `// indirect` lines), but resolution is dramatically faster.

---

## Diagnostics and `cmd/go` Internals

### `go mod why <pkg>`

Prints the shortest path from the main module to the given package. Useful for "why is this dep in my graph?":

```
$ go mod why github.com/google/btree
# github.com/google/btree
github.com/example/foo
github.com/example/bar
github.com/google/btree
```

### `go list -m -json all`

Dumps the full resolved module graph as JSON. Useful for tooling that needs to parse the build's dependencies.

### `go mod graph`

Outputs the requirement graph as edges:

```
$ go mod graph | head
example.com/myapp github.com/foo/bar@v1.2.3
example.com/myapp github.com/baz/qux@v0.7.0
github.com/foo/bar@v1.2.3 github.com/baz/qux@v0.6.0
```

Each line is `from to`. Useful for visualising the requirement graph.

### `inconsistent module graph`

Error from MVS when a `go.mod` requires a version of a module that does not exist (deleted tag) or two requirements lead to incompatible majors. Resolution: `go mod tidy` to repair.

### `GOFLAGS=-mod=readonly` vs `-mod=mod`

- `-mod=readonly` (default since 1.16) — `go build` may not modify `go.mod`/`go.sum`. Errors instead of silent edits. Good for CI.
- `-mod=mod` — old behaviour: edit `go.mod`/`go.sum` as needed.
- `-mod=vendor` — read from `vendor/`.

### Module loading inside `go build`

A simplified call sequence:

```
go build
  ↓
modload.LoadModFile()        // parse go.mod
  ↓
modload.LoadModGraph()       // run MVS (lazy if go ≥ 1.17)
  ↓
modload.LoadPackages(...)    // resolve import paths to module versions
  ↓
modfetch.Download(...)       // fetch missing modules from proxy
  ↓
modfetch.checkMod(...)       // verify against go.sum
  ↓
[compile and link as before]
```

Each stage is independently traceable with `GODEBUG=gocachehash=1,modulehash=1` and similar flags for deeper diagnostics.

---

## Summary

Versioning at the professional level is the meeting point of three formal systems: the semver string algebra, the MVS graph algorithm, and the module-fetching state machine (proxy + sumdb + cache). All three are deterministic; all three are simple in isolation; all three interact in ways that produce most "I don't understand why my build picked that version" bugs.

Master the trio and `go.mod`, `go.sum`, the cache, and the proxy stop being magic. They become four small, inspectable files connected by HTTP and a graph walk.

---

## Related Topics

- [middle.md](middle.md) — pseudo-versions and resolution from the user's perspective
- [senior.md](senior.md) — major-version strategy
- [specification.md](specification.md) — formal grammar for versions and pseudo-versions
- [6.2.2 Using 3rd Party Packages — Professional](../02-packages/02-using-3rd-party-packages/professional.md) — proxy internals from the consumer side
- The `cmd/go` source under `src/cmd/go/internal/modload` and `modfetch` in the Go repo
