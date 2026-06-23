# Module Proxy & Checksum Database — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [The GOPROXY Protocol (HTTP Endpoints)](#the-goproxy-protocol-http-endpoints)
3. [How `go` Resolves a Module Through a Proxy](#how-go-resolves-a-module-through-a-proxy)
4. [GOPROXY Configuration: Comma vs Pipe, `direct`, `off`](#goproxy-configuration-comma-vs-pipe-direct-off)
5. [The Module Cache (`$GOMODCACHE`)](#the-module-cache-gomodcache)
6. [The Checksum Database and `go.sum`](#the-checksum-database-and-gosum)
7. [The `h1:` Hash: What It Actually Hashes](#the-h1-hash-what-it-actually-hashes)
8. [GOPRIVATE, GONOSUMDB, GONOPROXY, GOINSECURE](#goprivate-gonosumdb-gonoproxy-goinsecure)
9. [GONOSUMCHECK (Deprecated) and Why It's Gone](#gonosumcheck-deprecated-and-why-its-gone)
10. [Verifying and Repairing: `go mod verify`, `go mod download`](#verifying-and-repairing-go-mod-verify-go-mod-download)
11. [Common Proxy/Sumdb Errors and Their Real Causes](#common-proxysumdb-errors-and-their-real-causes)
12. [Configuring for Private and Corporate Environments](#configuring-for-private-and-corporate-environments)
13. [Best Practices](#best-practices)
14. [Pitfalls You Will Meet in Real Projects](#pitfalls-you-will-meet-in-real-projects)
15. [Self-Assessment](#self-assessment)
16. [Summary](#summary)

---

## Introduction

You already know that Go fetches dependencies from a proxy and verifies them against `go.sum` and the checksum database. The middle-level question is *what the protocol actually looks like over the wire*, *how the `go` command walks the proxy list*, *where the cache lives and how it is laid out*, and *exactly which environment variables turn each piece on and off*.

This file moves from "the defaults work" to "I can read the HTTP requests, configure a proxy chain for a corporate network, exclude private modules correctly, and diagnose a checksum failure from first principles."

After reading this you will:
- Know every endpoint of the GOPROXY protocol and what each returns
- Trace how `go` picks a proxy and falls forward on failure
- Read the module cache layout on disk
- Explain how `go.sum` is built and verified, line by line
- Configure `GOPRIVATE`, `GONOPROXY`, `GONOSUMDB`, and `GOINSECURE` correctly
- Diagnose every common proxy and checksum error

---

## The GOPROXY Protocol (HTTP Endpoints)

A module proxy is just an HTTP (or HTTPS) server that answers a fixed set of GET requests. There is no authentication scheme baked into the protocol, no POST, no websockets — only GETs that return files. This simplicity is deliberate: you can serve a proxy from a static file tree, an S3 bucket, or `python3 -m http.server`.

For a module with path `M` and version `V`, the endpoints are:

| Endpoint | Returns | Content-Type |
|----------|---------|--------------|
| `$base/<M>/@v/list` | Newline-separated list of known *tagged* versions (no pseudo-versions). | `text/plain` |
| `$base/<M>/@v/<V>.info` | JSON metadata: `{"Version": "...", "Time": "..."}`. | `application/json` |
| `$base/<M>/@v/<V>.mod` | The raw `go.mod` file for version `V`. | `text/plain` |
| `$base/<M>/@v/<V>.zip` | The module source, zipped, with a canonical layout. | `application/zip` |
| `$base/<M>/@latest` | JSON metadata for the version Go considers "latest" (used when no version is given). | `application/json` |

A worked example with `curl` against the public proxy:

```bash
base=https://proxy.golang.org

curl "$base/github.com/google/uuid/@v/list"
# v1.0.0
# v1.1.0
# ...
# v1.6.0

curl "$base/github.com/google/uuid/@v/v1.6.0.info"
# {"Version":"v1.6.0","Time":"2024-01-12T20:25:00Z"}

curl "$base/github.com/google/uuid/@v/v1.6.0.mod"
# module github.com/google/uuid
# ...

curl -sO "$base/github.com/google/uuid/@v/v1.6.0.zip"

curl "$base/github.com/google/uuid/@latest"
# {"Version":"v1.6.0","Time":"2024-01-12T20:25:00Z"}
```

### Case encoding

Module paths can contain uppercase letters, but many filesystems are case-insensitive. The proxy protocol therefore **escapes uppercase letters** with a `!` prefix and a lowercase letter. `github.com/Masterminds/semver` becomes `github.com/!masterminds/semver` in proxy URLs and in the on-disk cache. You will see this encoding when debugging real fetches.

```bash
curl "https://proxy.golang.org/github.com/!masterminds/semver/v3/@v/list"
```

### `.info` and pseudo-versions

The `.info` endpoint also answers for *pseudo-versions* — synthesized versions for untagged commits, like `v0.0.0-20240101000000-abcdef123456`. The `list` endpoint, however, returns only proper tagged releases; pseudo-versions are resolved on demand through `.info`.

---

## How `go` Resolves a Module Through a Proxy

When the toolchain needs `M@V`, the sequence is:

1. **Determine the proxy list** from `GOPROXY` (split on `,` and `|`).
2. **For the first proxy**, request the metadata: usually `.info` (and `list` if it needs to resolve a query like `@latest` or `@>=v1.2.0`).
3. **Fetch the `.mod`** for the resolved version (needed for the module graph even if the zip is not yet required).
4. **Fetch the `.zip`** when source is actually needed for a build.
5. **Verify** the downloaded bytes against `go.sum` and, on first use, against the checksum database.
6. **Store** the verified module in the cache.

If a proxy returns **404 Not Found** or **410 Gone**, Go treats that as "this proxy does not have it" and *falls forward* to the next entry in the list (the comma separator controls this — see below). Any other error (500, network timeout) is fatal for that proxy and, depending on the separator, may or may not fall forward.

The `.mod`-before-`.zip` ordering matters: Go builds the *module graph* from `.mod` files alone, which is much cheaper than downloading every zip. It only downloads zips for packages it actually compiles.

---

## GOPROXY Configuration: Comma vs Pipe, `direct`, `off`

`GOPROXY` is a list of entries separated by either `,` or `|`. The separator changes the fall-forward semantics:

| Separator | Meaning |
|-----------|---------|
| `,` (comma) | Fall forward to the next entry **only on 404 or 410** (module genuinely not found). Any other error stops the whole resolution. |
| `\|` (pipe) | Fall forward to the next entry **on any error** (including 500, timeout, TLS failure). More permissive. |

Two special keywords may appear in the list:

- **`direct`** — not a URL but an instruction: "bypass proxies and fetch from the source repository's version-control system (Git, Mercurial, etc.) directly." Usually the last entry.
- **`off`** — "stop here; do not download anything. Fail if the module is not already available." Anything after `off` is unreachable.

### Examples

```bash
# The default: public proxy, then fall back to direct VCS on "not found"
GOPROXY=https://proxy.golang.org,direct

# Corporate proxy first, then public, then direct
GOPROXY=https://goproxy.corp.example.com,https://proxy.golang.org,direct

# Only the corporate proxy; if it fails for ANY reason, give up
GOPROXY=https://goproxy.corp.example.com

# Permissive: try corporate, on any failure try public, then direct
GOPROXY=https://goproxy.corp.example.com|https://proxy.golang.org|direct

# Fully offline: never touch the network
GOPROXY=off
```

The comma-vs-pipe distinction is subtle but important: with a comma, a transient 500 from your corporate proxy aborts the build (you find out it is broken); with a pipe, the same 500 silently falls through to the public proxy (your build succeeds but bypasses your corporate controls). Choose deliberately.

---

## The Module Cache (`$GOMODCACHE`)

Downloaded modules are stored in the module cache, by default at `$GOPATH/pkg/mod`, overridable via `GOMODCACHE`:

```bash
go env GOMODCACHE
# /Users/you/go/pkg/mod
```

### Layout

```
$GOMODCACHE/
├── cache/
│   ├── download/                         ← raw proxy responses, mirrors the protocol
│   │   └── github.com/google/uuid/@v/
│   │       ├── list
│   │       ├── v1.6.0.info
│   │       ├── v1.6.0.mod
│   │       ├── v1.6.0.zip
│   │       ├── v1.6.0.ziphash            ← the h1: hash of the zip
│   │       └── v1.6.0.lock
│   └── lock
└── github.com/google/uuid@v1.6.0/        ← the EXTRACTED, read-only source tree
    ├── LICENSE
    ├── uuid.go
    └── ...
```

Two parts matter:

- **`cache/download/`** mirrors the proxy protocol exactly. `go` can act as a proxy *serving from this directory* — that is the basis of `GOPROXY=file:///...` and `GOFLAGS=-modcacherw`.
- **`<module>@<version>/`** is the extracted source, made **read-only** so accidental edits are caught.

### Important properties

- The cache is **shared across every project and user** on the machine. Two repos using `uuid@v1.6.0` download it once.
- Files are read-only by default. Set `GOFLAGS=-modcacherw` (or `go env -w GOFLAGS=-modcacherw`) if a tool needs writable cache files (rarely a good idea).
- Wipe it with `go clean -modcache`. This forces a full re-download next build. Reserve for corruption or disk pressure.
- `cache/download/<M>/@v/<V>.ziphash` stores the `h1:` hash so Go can verify cache integrity without re-hashing the whole zip every time.

### Serving the cache as a proxy

Because `cache/download/` is exactly the proxy protocol on disk, you can point another machine at it:

```bash
GOPROXY="file://$(go env GOMODCACHE)/cache/download" go build ./...
```

This is the simplest possible "private proxy" — a directory served over `file://`.

---

## The Checksum Database and `go.sum`

`go.sum` is the per-module record of expected hashes. The checksum database (`sum.golang.org`) is the global record that bootstraps and cross-checks it.

### How a `go.sum` entry is created

When Go fetches a version it does not yet have a `go.sum` entry for:

1. It downloads the `.zip` and `.mod` from the proxy.
2. It computes the `h1:` hash of each.
3. **If `GOSUMDB` is set and the module is not private**, it asks the checksum database for the official hash and verifies the download matches.
4. It writes the verified hashes into `go.sum`.

After that, the entry in `go.sum` is the authority. On every subsequent build, Go re-hashes the cached bytes and compares to `go.sum` — the sumdb is not consulted again for that version.

### What `go.sum` protects against

- **Cache or download corruption** — bit-flips, truncated files.
- **A proxy serving different bytes** than what was originally recorded.
- **An upstream author silently changing a published version** (moving a Git tag).
- **A man-in-the-middle** swapping module contents.

It does **not** protect against:
- Malicious-but-consistent code (the hash is valid; the code is still hostile).
- Choosing the wrong version in the first place.

### The lifecycle

```
go get M@V  ──►  download .zip/.mod
                       │
                       ├─► sumdb verify (first time only) ──► go.sum entry written
                       │
go build    ──►  read cache, re-hash, compare to go.sum ──► match? build : SECURITY ERROR
```

---

## The `h1:` Hash: What It Actually Hashes

The `h1:` prefix names the *hashing scheme*, version 1. It is **not** a plain SHA-256 of the zip file. Computing it correctly is what makes the hash stable across different zip implementations.

The algorithm (paraphrased):

1. For the module zip, list every file path inside it with its SHA-256.
2. Produce lines of the form `<sha256-hex>  <filepath>\n`, sorted by file path.
3. Take the SHA-256 of that *entire listing*.
4. Base64-encode it and prefix with `h1:`.

This means the `h1:` hash is a **hash of a sorted manifest of per-file hashes**, not a hash of the raw zip bytes. The benefit: two zips with identical file contents but different compression or ordering produce the *same* `h1:` hash. Integrity is about content, not packaging.

For the `/go.mod` line, the scheme hashes the single `go.mod` file the same way (a one-entry manifest).

So each module version has two `go.sum` lines:

```
github.com/google/uuid v1.6.0 h1:NIvaJDMOsjHA8n1jAhLSgzrAzy1Hgr+hNrb57e+94F0=
github.com/google/uuid v1.6.0/go.mod h1:TIyPZe4MgqvfeYDBFedMoGGpEw/LqOeaOT+nhxU+yHo=
```

- The first hashes the *zip's file manifest* (the whole source tree).
- The second hashes only the *`go.mod`* (used during module-graph construction, before any zip is fetched).

The `/go.mod` hash exists separately because Go reads `go.mod` files to build the dependency graph long before it downloads source. It needs to verify those `go.mod` files independently.

---

## GOPRIVATE, GONOSUMDB, GONOPROXY, GOINSECURE

These four variables control *which modules bypass the public infrastructure* and *how*. They take comma-separated glob patterns matched against module path prefixes.

| Variable | Effect |
|----------|--------|
| `GONOPROXY` | Modules matching these patterns are fetched **directly from VCS**, never through a proxy. |
| `GONOSUMDB` | Modules matching these patterns are **not** checked against the checksum database. (`go.sum`, if present, is still enforced.) |
| `GOPRIVATE` | A convenience: sets the **default** for both `GONOPROXY` and `GONOSUMDB`. The single setting most people use. |
| `GOINSECURE` | Modules matching these patterns may be fetched over **plain HTTP** and skip TLS certificate validation. Use only for trusted internal hosts. |

### The key relationship

`GOPRIVATE` does not do anything itself — it *provides the default value* for `GONOPROXY` and `GONOSUMDB`. So:

```bash
go env -w GOPRIVATE='github.com/yourco/*,git.internal.example.com/*'
```

is equivalent (in effect) to setting both `GONOPROXY` and `GONOSUMDB` to that pattern. If you set `GONOPROXY` or `GONOSUMDB` explicitly, they override the `GOPRIVATE`-derived default for their respective concern.

### Why you need it

Private modules are invisible to the public proxy and sumdb. Without `GOPRIVATE`:

- Go asks `proxy.golang.org` for your internal module → 404/410, or it leaks the path.
- Go asks `sum.golang.org` for a hash → fails, because the sumdb has never seen your private code.

`GOPRIVATE` tells Go: "for these paths, go straight to the VCS and do not consult the public checksum database."

### Subtle but important

- `GONOSUMDB` disables the *checksum database* lookup, **not** `go.sum` verification. Your `go.sum` is still enforced for private modules. You are still protected against your *own* cache changing — you are only skipping the *global* log (which could not help anyway).
- `GOINSECURE` is the most dangerous of the four. It permits unencrypted, unauthenticated fetches. Reserve it for internal hosts you fully control.
- `GONOSUMCHECK` (note: **not** `GONOSUMDB`) is a deprecated, removed variable — see below.

---

## GONOSUMCHECK (Deprecated) and Why It's Gone

`GONOSUMCHECK` was an early, blunt environment variable that disabled **all** checksum verification — both the sumdb lookup *and* `go.sum` enforcement. It existed briefly during the module-system rollout (around Go 1.12–1.13) and was **removed** before the modern system stabilized.

It was replaced by a more precise set:

- `GONOSUMDB` (now usually set via `GOPRIVATE`) — skip only the *checksum database*, keep `go.sum`.
- `GOFLAGS=-insecure` / `GOINSECURE` — relax transport security narrowly.
- `GONOSUMDB`/`GOPRIVATE` for path-scoped exclusions instead of a global off-switch.

The lesson: do not reach for an old `GONOSUMCHECK` tip you find in a stale blog post. It does nothing on modern Go. If you genuinely need to disable the global checksum database, set `GOSUMDB=off` (machine-wide, blunt) or, far better, scope it with `GOPRIVATE`/`GONOSUMDB`.

### Quick disambiguation

| Name | Status | What it does |
|------|--------|--------------|
| `GONOSUMCHECK` | **Removed** | (historical) disabled all checksum checks |
| `GONOSUMDB` | Active | skip the *checksum database* for matching paths; `go.sum` still enforced |
| `GOSUMDB=off` | Active | disable the checksum database entirely, machine-wide |
| `GONOPROXY` | Active | fetch matching paths directly from VCS, skip the proxy |
| `GOPRIVATE` | Active | sets defaults for both `GONOPROXY` and `GONOSUMDB` |
| `GOINSECURE` | Active | allow HTTP / skip cert checks for matching paths |

---

## Verifying and Repairing: `go mod verify`, `go mod download`

Two commands cover most cache and integrity operations.

### `go mod download`

Populates the cache with everything `go.mod` requires (or a specific module), without building. Use it to warm caches in CI and before offline work:

```bash
go mod download              # all required modules
go mod download github.com/google/uuid
go mod download -x           # show the HTTP requests
go mod download -json        # machine-readable output (paths, hashes, errors)
```

`-json` is especially useful in tooling: it emits the cache path, the zip path, the `Sum`, and any `Error` per module.

### `go mod verify`

Re-checks that the modules **in the cache** still match their recorded `go.sum` hashes:

```bash
go mod verify
# all modules verified
```

If a cached module was tampered with or corrupted, `go mod verify` reports it. Note: it verifies the *cache against `go.sum`*; it is not the same as the on-the-fly verification that happens during every build.

### Repair recipe

```bash
go clean -modcache     # drop the (possibly corrupt) cache
go mod download        # re-fetch and re-verify everything
go mod verify          # confirm clean
```

---

## Common Proxy/Sumdb Errors and Their Real Causes

A field guide.

### `checksum mismatch ... SECURITY ERROR`

```
verifying github.com/foo/bar@v1.2.0: checksum mismatch
	downloaded: h1:AAA...
	go.sum:     h1:BBB...
```

The downloaded bytes do not match `go.sum`. Causes, in order of likelihood:
1. Corrupted cache → `go clean -modcache && go mod download`.
2. Upstream author moved a tag (changed published bytes) → investigate; update or pin a clean version.
3. A malicious or misconfigured proxy serving different bytes → take seriously; never just delete `go.sum`.

### `missing go.sum entry for ...`

You imported a package whose hash is not recorded. Fix: `go mod tidy` or `go mod download <module>`.

### `... 404 Not Found` / `... 410 Gone`

The proxy cannot resolve the module/version. Causes: typo, unpublished version, or a private module that needs `GOPRIVATE`.

### `verifying ...: checksum database disabled by GOSUMDB=off`

Informational — you (or your environment) turned the sumdb off. New modules are recorded in `go.sum` without a global cross-check (TOFU with weaker guarantees).

### `module declares its path as X but was required as Y`

Not a proxy error per se, but surfaces during fetch. The `go.mod` inside the module declares a different module path than you imported. Cause: a fork without a path update, or a vanity-import mismatch. Fix the import path or use a `replace`.

### `dial tcp ... connect: connection refused` / TLS errors

Network/firewall problem reaching the proxy. Fix: confirm the proxy URL, check corporate proxy/VPN, or fall back to a reachable proxy.

---

## Configuring for Private and Corporate Environments

A realistic enterprise setup combines several settings.

### Private modules on an internal Git host

```bash
go env -w GOPRIVATE='git.corp.example.com/*,github.com/yourco/*'
```

This makes Go fetch those paths directly from VCS and skip the public sumdb. You still need *credentials* — typically via `~/.netrc` (HTTPS) or SSH config, plus a `GONOSUMCHECK`-free `.gitconfig` rewrite:

```
# ~/.gitconfig
[url "git@git.corp.example.com:"]
    insteadOf = https://git.corp.example.com/
```

### Routing everything through a corporate proxy

```bash
go env -w GOPROXY='https://goproxy.corp.example.com'
go env -w GOSUMDB='off'                       # if the corp proxy serves its own checks
go env -w GONOSUMDB='*'                        # or scope it
```

Many corporate proxies (Athens, Artifactory) mirror both public and private modules and can serve a sumdb of their own. In that case you point `GOPROXY` at the mirror and let it handle upstream.

### A common, balanced configuration

```bash
GOPROXY=https://goproxy.corp.example.com,https://proxy.golang.org,direct
GOPRIVATE=github.com/yourco/*
GOSUMDB=sum.golang.org
```

Read as: try the corporate mirror first, then the public proxy, then direct; treat `yourco` paths as private (skip proxy + public sumdb); keep the public checksum database for everything public.

---

## Best Practices

1. **Leave `GOPROXY`/`GOSUMDB` at defaults** unless you have a corporate mirror or private modules.
2. **Set `GOPRIVATE` for all internal paths** — one setting, applied globally with `go env -w`.
3. **Prefer comma (`,`) over pipe (`|`) in `GOPROXY`** so transient proxy failures surface instead of silently falling through corporate controls.
4. **Commit `go.sum`** and never hand-edit it.
5. **Use `go mod download -json` in tooling** for structured cache/hash data.
6. **Cache `$GOMODCACHE` in CI** to avoid re-downloading every job.
7. **Reserve `GOINSECURE` for trusted internal hosts**; never use it for public modules.
8. **Treat `checksum mismatch` as a security event**, not an annoyance.
9. **Understand the comma/pipe and direct/off keywords** before composing a proxy chain.

---

## Pitfalls You Will Meet in Real Projects

### Pitfall 1 — Pipe separator hiding a broken corporate proxy

`GOPROXY=https://corp|https://proxy.golang.org` silently falls through to the public proxy when the corporate one errors. Builds "work," but your dependency governance is bypassed. Use a comma if the corporate proxy is meant to be authoritative.

### Pitfall 2 — `GOPRIVATE` set but credentials missing

`GOPRIVATE` tells Go to fetch from VCS directly, but it does not provide auth. The fetch fails with a Git authentication error. Fix `~/.netrc`, SSH keys, or `.gitconfig` URL rewrites.

### Pitfall 3 — `GONOSUMDB` confused with `GONOSUMCHECK`

`GONOSUMCHECK` is removed and does nothing. Use `GONOSUMDB` (or `GOPRIVATE`) for path-scoped exclusions, or `GOSUMDB=off` for the blunt machine-wide switch.

### Pitfall 4 — Case-encoding surprises

Debugging `github.com/Masterminds/...` fetches and seeing `!masterminds` in URLs and cache paths is correct, not a bug. Uppercase letters are `!`-escaped.

### Pitfall 5 — Wiping the cache to "fix" an unrelated issue

`go clean -modcache` forces a full re-download. It fixes corruption but is otherwise a slow no-op. Do not make it a habit.

### Pitfall 6 — Assuming `GOSUMDB=off` disables `go.sum`

It does not. `GOSUMDB=off` only skips the *global* checksum database. Your local `go.sum` is still enforced on every build. To skip `go.sum` too you would need `GOFLAGS=-mod=mod` plus the absence of an entry — and you almost never want that.

### Pitfall 7 — Forgetting that `list` omits pseudo-versions

`/@v/list` returns only tagged releases. If you are looking for a commit-based pseudo-version, query `.info` with the commit or use `go list -m M@<commit>`.

### Pitfall 8 — Trusting a stale blog's `GONOSUMCHECK` advice

Old tutorials suggest `GONOSUMCHECK=1` to bypass checksum errors. It is removed. Worse, the underlying error is usually real. Do not chase removed env vars.

---

## Self-Assessment

You can move on to [senior.md](senior.md) when you can:

- [ ] Name and describe all five GOPROXY endpoints (`list`, `.info`, `.mod`, `.zip`, `@latest`)
- [ ] Explain the comma-vs-pipe fall-forward semantics and `direct`/`off`
- [ ] Describe the module cache layout and the role of `cache/download/`
- [ ] Explain how a `go.sum` entry is created and verified, including the sumdb step
- [ ] Describe what the `h1:` hash actually hashes (a manifest, not raw zip bytes)
- [ ] Distinguish `GOPRIVATE`, `GONOPROXY`, `GONOSUMDB`, `GOINSECURE`, and the removed `GONOSUMCHECK`
- [ ] Explain why `GOPRIVATE` implies `GONOPROXY` + `GONOSUMDB`
- [ ] Repair a corrupted cache with `go clean -modcache` + `go mod download`
- [ ] Configure a corporate proxy chain plus private-module exclusions
- [ ] Diagnose every error in the "Common Errors" section from a one-line message

---

## Summary

The GOPROXY protocol is a tiny, readable HTTP surface: `list`, `.info`, `.mod`, `.zip`, and `@latest`, with uppercase letters `!`-escaped. The `go` command walks the `GOPROXY` list left to right, falling forward on 404/410 (comma) or any error (pipe), with `direct` meaning "use VCS" and `off` meaning "no network." Downloaded modules land in the shared `$GOMODCACHE`, whose `cache/download/` subtree is itself the proxy protocol on disk — which is why a directory can serve as a `file://` proxy.

Integrity rests on the `h1:` hash — a SHA-256 of a *sorted per-file manifest*, not of raw zip bytes — recorded twice per version in `go.sum` (once for the zip, once for `go.mod`). The checksum database (`GOSUMDB`, default `sum.golang.org`) cross-checks the *first* download against a global log; `go.sum` enforces every later use locally. Private code bypasses this public infrastructure via `GOPRIVATE` (which seeds `GONOPROXY` + `GONOSUMDB`), with `GOINSECURE` for trusted-internal HTTP hosts. The old `GONOSUMCHECK` is removed — use the precise modern variables instead. Master these and you can configure Go for any network, from the open internet to a locked-down corporate mirror, and diagnose a checksum failure without panicking or deleting your `go.sum`.
