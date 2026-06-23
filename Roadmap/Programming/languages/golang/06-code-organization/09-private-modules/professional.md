# Private Modules — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [How `cmd/go` Resolves a Module](#how-cmdgo-resolves-a-module)
3. [The Proxy Protocol in Detail](#the-proxy-protocol-in-detail)
4. [The Sumdb Protocol](#the-sumdb-protocol)
5. [Lookup Precedence: GOPROXY × GONOPROXY × GOPRIVATE](#lookup-precedence-goproxy--gonoproxy--goprivate)
6. [Insecure Modes: GOFLAGS=-insecure and GOINSECURE](#insecure-modes-goflags-insecure-and-goinsecure)
7. [GONOSUMCHECK and Friends — What Actually Toggles](#gonosumcheck-and-friends--what-actually-toggles)
8. [Caching and Mutation](#caching-and-mutation)
9. [Security Implications](#security-implications)
10. [Reading the Toolchain Source](#reading-the-toolchain-source)
11. [Summary](#summary)

---

## Introduction
> Focus: "What does the toolchain actually do, byte-for-byte, when it sees a private module path?"

This file follows a single `go get github.com/acme/internal-auth@v0.3.1` from typed command to bytes-on-disk, with the source-of-truth being `cmd/go` itself. Where the Go Modules Reference is silent, the source code is law. We will cover the proxy protocol, sumdb protocol, exact precedence of the env vars, and the security implications that come from each switch.

This is not user-facing documentation; it is the mental model of someone debugging a malfunctioning Athens or writing a custom proxy.

---

## How `cmd/go` Resolves a Module

The high-level state machine for a module fetch:

```mermaid
flowchart TD
    A[input: path@version] --> B[normalize path]
    B --> C[resolve version selector]
    C --> D{path matches GONOPROXY glob?}
    D -- yes --> E[fetcher = direct]
    D -- no --> F[fetcher = GOPROXY chain]
    E --> G[git ls-remote / clone via VCS]
    F --> H[GET proxy/path/@v/list]
    G --> I[bytes ready]
    H --> I
    I --> J{path matches GONOSUMDB glob?}
    J -- yes --> K[skip sumdb verify]
    J -- no --> L[GOSUMDB lookup]
    K --> M[hash recorded in go.sum]
    L --> N{verify match?}
    N -- yes --> M
    N -- no --> O[FAIL: checksum mismatch]
    M --> P[cache in $GOMODCACHE]
```

Each box maps to identifiable code in `cmd/go/internal/modfetch`:

- `coderepo.go` — Git/Mercurial/etc. drivers behind `direct`.
- `proxy.go` — the proxy protocol client.
- `sumdb.go` — sumdb client.
- `cache.go` — `$GOMODCACHE` (a.k.a. `$GOPATH/pkg/mod`) management.
- `module.go` — path validation, escape rules.

### Path normalisation

Paths are case-preserving but case-folded for lookup *only on filesystems that need it*. The proxy protocol uses an explicit *escape* function (`module.EscapePath`) that lower-cases uppercase letters by prefixing them with `!` — `GitHub.com` becomes `!git!hub.com`. This is to avoid case-collisions on case-insensitive filesystems.

You will see this in the cache:

```
$GOPATH/pkg/mod/cache/download/!git!hub.com/acme/internal-auth/@v/v0.3.1.info
```

When you peek under the cache, treat `!X` as "uppercase X."

### Version resolution

For `path@selector`, the toolchain first asks "is this an exact semver?" If not, it queries the proxy:

```
GET https://athens.acme.io/github.com/acme/internal-auth/@v/list
```

The response is a newline-separated list of versions. The selector (`@latest`, `@upgrade`, `@patch`, branch, SHA) is resolved against this list.

For private paths matching `GONOPROXY`, the equivalent of `git ls-remote` produces the list. The toolchain runs (roughly):

```bash
git ls-remote --tags --heads https://github.com/acme/internal-auth.git
```

Tags become version candidates; branch heads become potential pseudo-versions.

---

## The Proxy Protocol in Detail

The Go module proxy protocol is HTTP-based. It is defined in `go.dev/ref/mod#goproxy-protocol`. There are five endpoints, all relative to the proxy URL:

| Endpoint | Purpose |
|---|---|
| `GET <module>/@v/list` | Plain-text list of available versions, newline-separated. |
| `GET <module>/@latest` | JSON describing the latest version. |
| `GET <module>/@v/<version>.info` | JSON metadata: `{Version, Time, ...}`. |
| `GET <module>/@v/<version>.mod` | The `go.mod` of that version. |
| `GET <module>/@v/<version>.zip` | A zip archive of the module at that version. |

The path component is **escaped**: every uppercase ASCII letter becomes `!` followed by the lowercase letter. So `github.com/Acme/Foo` is `!git!hub.com/!acme/!foo` on the wire.

A complete fetch sequence for `github.com/acme/internal-auth@v0.3.1` against `https://athens.acme.io`:

```
GET https://athens.acme.io/github.com/acme/internal-auth/@v/list
→ 200 OK
v0.1.0
v0.2.0
v0.3.0
v0.3.1

GET https://athens.acme.io/github.com/acme/internal-auth/@v/v0.3.1.info
→ 200 OK
{"Version":"v0.3.1","Time":"2025-04-01T08:30:00Z"}

GET https://athens.acme.io/github.com/acme/internal-auth/@v/v0.3.1.mod
→ 200 OK
module github.com/acme/internal-auth

go 1.22

require ...

GET https://athens.acme.io/github.com/acme/internal-auth/@v/v0.3.1.zip
→ 200 OK
<binary>
```

Three observations:

1. **Statelessness.** Each request is independent. The proxy can be a CDN.
2. **Idempotence.** Once a `.info`, `.mod`, or `.zip` is published at a version, it must not change. Proxies enforce this via content-addressed storage.
3. **Auth.** The proxy can require authentication (typically Basic auth with `.netrc`). The toolchain reuses `git`'s credential machinery for this.

### Proxy chain semantics

`GOPROXY=https://a,https://b,direct` means:

1. Try `a`. If 200, use it. If 404 *or* 410, fall through to next.
2. Try `b`. Same rule.
3. Fall through to `direct` (Git clone).

For *any other* HTTP error (500, network timeout), the toolchain **stops** — does not fall through. This is to prevent a transient outage from accidentally bypassing your security model.

You can override fall-through behaviour:

```
GOPROXY=https://a,https://b|direct
```

The pipe (`|`) means "fall through on any error, not just 404/410." Useful for redundancy; dangerous for security.

### What the proxy does for private modules

A proxy like Athens that supports private modules:

1. Receives `GET /github.com/acme/internal-auth/@v/v0.3.1.zip`.
2. Checks its `.netrc` for `github.com` credentials.
3. Runs `git clone --depth 1 --branch v0.3.1 https://x:TOKEN@github.com/acme/internal-auth /tmp/build`.
4. Builds a zip archive that conforms to the spec (specific `module.txt`, exact path layout).
5. Hashes the zip. Stores in S3.
6. Streams the zip back to the requester.

Subsequent requests for the same `@v0.3.1` are served from S3 directly.

### Module zip format

A module zip has a strict layout:

```
github.com/acme/internal-auth@v0.3.1/
github.com/acme/internal-auth@v0.3.1/go.mod
github.com/acme/internal-auth@v0.3.1/auth.go
github.com/acme/internal-auth@v0.3.1/auth_test.go
...
```

The top-level prefix is `<module>@<version>/`. Files outside this prefix, symlinks, files larger than 500MB, file paths with backslashes, etc., are rejected by the toolchain. `cmd/go/internal/modfetch/zip` enforces this.

---

## The Sumdb Protocol

The checksum database is a *transparency log* in the Certificate Transparency tradition. Defined in `go.dev/ref/mod#checksum-database`.

### Lookup

```
GET https://sum.golang.org/lookup/github.com/google/uuid@v1.6.0
```

Response:

```
2185234
github.com/google/uuid v1.6.0 h1:ABCDEF...
github.com/google/uuid v1.6.0/go.mod h1:GHIJKL...

— sum.golang.org Az3hBw...<signature>
```

Three blocks:

- The log's tree size at the time of the answer (`2185234`).
- The actual hashes (`h1:` is `sha256` of the zip contents, plus a `go.mod` hash).
- A signature over the answer, made with the sumdb's signing key.

The toolchain verifies the signature using a hard-coded public key (or one from `GOSUMDB=name+key+url`). It then checks the hash against the bytes it just downloaded. If they disagree, the build fails with "checksum mismatch."

### Tree consistency proofs

The sumdb is *append-only*. Every answer the client receives includes proof that the current tree size is consistent with the previous tree size the client saw. So if `sum.golang.org` ever started lying — serving different hashes to different clients — clients with retained state would catch it.

### Why private paths skip this

`sum.golang.org` cannot answer for paths it cannot fetch. Asking it about a private module returns "not found." Worse: the *act of asking* leaks the path of your private repo to the public sumdb operator. `GONOSUMDB` (set via `GOPRIVATE`) ensures the lookup never happens.

### Running an internal sumdb

The protocol is fully documented; in principle anyone can implement it. In practice, very few do — the cryptographic engineering bar is high, and the value over "trust your `go.sum`" is debatable for most teams. Companies in regulated industries are the main adopters.

---

## Lookup Precedence: GOPROXY × GONOPROXY × GOPRIVATE

The exact precedence, in the order the toolchain checks:

1. **`GONOPROXY`** — does the path match? If yes, fetcher is `direct`; do not consult `GOPROXY`.
2. Otherwise, walk **`GOPROXY`** in order.
3. **`GONOSUMDB`** — does the path match? If yes, do not call sumdb; rely on `go.sum` only.
4. Otherwise, call **`GOSUMDB`**.

Where `GOPRIVATE` enters: if `GONOPROXY` is unset, it inherits from `GOPRIVATE`. Same for `GONOSUMDB`. So setting `GOPRIVATE` alone is equivalent to setting both `GONOPROXY` and `GONOSUMDB` to the same value.

If you set `GONOPROXY` *explicitly*, it overrides the inheritance. Same for `GONOSUMDB`. This is what lets you say "route private paths through an internal proxy *and* skip the public sumdb":

```
GOPROXY=https://athens.acme.io,direct
GOPRIVATE=github.com/acme/*
GONOPROXY=         # empty — do NOT bypass GOPROXY
GONOSUMDB=github.com/acme/*  # but DO bypass public sumdb
```

Now `github.com/acme/*` paths still go through Athens (which authenticates), but don't reach `sum.golang.org`. Athens has the bytes, the toolchain trusts the proxy's TLS certificate, and `go.sum` records the hash on first fetch.

This nuance is the main reason `GONOPROXY` and `GONOSUMDB` exist as separate variables. `GOPRIVATE` is the convenient default; the others are the surgical knobs.

---

## Insecure Modes: GOFLAGS=-insecure and GOINSECURE

The toolchain has two ways to relax TLS verification:

### `GOINSECURE` (Go 1.14+)

A glob list, just like `GOPRIVATE`. Module paths matching `GOINSECURE` are allowed to be fetched over HTTP, with TLS verification disabled.

```
GOINSECURE=internal.acme.io/*
```

When the toolchain hits `internal.acme.io/foo`, it allows `http://internal.acme.io/foo/...` and accepts self-signed certs.

### `GOFLAGS=-insecure`

A historical flag passed to `go get`. Equivalent to "all paths are insecure." Strongly discouraged. Treat as legacy.

### When to use

- **A self-signed internal proxy.** Not really. Issue a real certificate from a private CA and add the CA to your machines' trust stores. `GOINSECURE` is a stopgap, not a solution.
- **Testing on a closed network.** Acceptable, briefly.
- **Production.** Never.

### Risks

- `GOINSECURE` is **per path glob**. It doesn't disable TLS for `proxy.golang.org`, only for paths you opt in to. That bounds the blast radius.
- Without TLS, a network attacker on the path between you and the proxy can substitute bytes. The hash in `go.sum` will still catch tampering on subsequent builds, but the *first* download is at risk.
- Once `go.sum` has the wrong hash, every subsequent build silently uses the malicious code.

---

## GONOSUMCHECK and Friends — What Actually Toggles

There has been a churn of similarly-named environment variables. Here is the current map (Go 1.22+):

| Variable | Purpose | Status |
|---|---|---|
| `GOPRIVATE` | Glob list of private modules. Implies `GONOPROXY` and `GONOSUMDB`. | Current. |
| `GONOPROXY` | Glob list bypassing `GOPROXY`. | Current. |
| `GONOSUMDB` | Glob list bypassing `GOSUMDB`. | Current. |
| `GOSUMDB=off` | Disable sumdb verification entirely. | Current. |
| `GONOSUMCHECK` | Older synonym in some builds; not part of the current toolchain. | Removed/never released — do not rely on it. |
| `GOFLAGS=-insecure` | Force insecure transport for all paths. | Discouraged. |
| `GOINSECURE` | Glob-scoped insecure transport. | Current. |

Some StackOverflow answers mention `GONOSUMCHECK`. It was discussed during early modules design but the released toolchain uses `GOSUMDB=off` (full off) or `GONOSUMDB` (glob-scoped) instead. If your script sets `GONOSUMCHECK`, the toolchain will silently ignore it.

### What `GOSUMDB=off` actually does

It is *much* broader than `GONOSUMDB=*`. `off` short-circuits the sumdb client entirely; even paths not matching any glob are unverified. Only use it inside a fully-controlled environment (your own internal proxy that you trust to enforce hashes).

---

## Caching and Mutation

### Cache layout

```
$GOMODCACHE/
├── cache/
│   ├── download/
│   │   └── github.com/acme/internal-auth/@v/
│   │       ├── v0.3.1.info
│   │       ├── v0.3.1.mod
│   │       ├── v0.3.1.zip
│   │       └── v0.3.1.ziphash
│   └── lock
├── github.com/acme/internal-auth@v0.3.1/   # extracted source, read-only
└── ...
```

`*.ziphash` is the hash of the `.zip` after download. Used to detect cache corruption.

### Cache is supposed to be immutable

The toolchain marks extracted module trees as read-only (`chmod -R a-w`). If you `vim` a file in the cache, you get permission denied — by design. This protects against accidental edits.

### Clean cache

```bash
go clean -modcache
```

Wipes everything. Use when chasing a stale-cache bug. Safe; the cache is a re-derivable artifact.

For surgical clean of one path:

```bash
chmod -R u+w $GOMODCACHE/github.com/acme/internal-auth@v0.3.1
rm -rf $GOMODCACHE/github.com/acme/internal-auth@v0.3.1
rm -rf $GOMODCACHE/cache/download/github.com/acme/internal-auth/@v/v0.3.1.*
```

After this, the next build re-fetches from the proxy.

### What if `go.sum` and the cache disagree?

Cache integrity is checked on every build. If a cached file's hash does not match `go.sum`, the build fails with the same "checksum mismatch" you would see on download. Restoration: clear the cache and refetch.

---

## Security Implications

### Setting `GOPRIVATE` is security-positive *and* security-negative

Positive:

- Stops your private repo paths from leaking to `proxy.golang.org`. (Paths leak; bytes do not, since proxy.golang.org returns 410.)
- Stops the public sumdb from learning about your private versions.

Negative:

- The *first* fetch of every private dep is unverified.
- A compromised PAT lets an attacker mutate `git` history (e.g., re-tag a release with malicious bytes). The next fresh `go.sum` will record the malicious hash.

### `GOSUMDB=off` is security-negative *and* a footgun

Without sumdb, every dep's first fetch is unverified. Combined with no internal proxy, you have no defence against a man-in-the-middle on your network.

In practice, `GOSUMDB=off` should appear only in tightly-controlled CI pipelines that hit a fully-trusted internal proxy.

### Threat models

| Attacker | What `GOPRIVATE` helps with | What it does not |
|---|---|---|
| Public mirror operator (`proxy.golang.org`) | Hides paths and bytes of private code. | Nothing — they were never going to see the code anyway. |
| Network MITM | TLS still applies; `GOPRIVATE` doesn't change that. | TLS is what helps; `GOPRIVATE` is neutral here. |
| Compromised PAT | `GOPRIVATE` can't help; once auth is compromised, attacker can ship malicious bytes through the legitimate channel. | Limit PAT scopes; rotate aggressively; require code review on the upstream. |
| Compromised module proxy | `GOPRIVATE` skips public sumdb, so you trust the proxy. | Run your own proxy; require TLS; consider an internal sumdb. |

### Why pure `GOPRIVATE` is "fine for most teams"

Because the *threat model that justifies expensive infra* (internal sumdb) is one where you cannot trust your own CI, your own reviewers, *and* your own VCS host. If any of those is trustworthy, you don't need the sumdb. Most teams do trust at least their own CI. `GOPRIVATE` + careful PR review of `go.sum` covers them.

---

## Reading the Toolchain Source

If the docs are silent, the source is law. Useful entry points (paths within `https://github.com/golang/go`, but only navigate on a checked-out tree):

- `src/cmd/go/internal/modfetch/proxy.go` — proxy client logic, including the famous fall-through rules.
- `src/cmd/go/internal/modfetch/coderepo.go` — `direct` fetcher; calls into `vcs.go` for Git, Hg, etc.
- `src/cmd/go/internal/modfetch/sumdb.go` — sumdb client and verifier.
- `src/cmd/go/internal/cfg/cfg.go` — environment variable parsing; central place for `GOPROXY`, `GOSUMDB`, etc.
- `src/cmd/go/internal/modload/init.go` — initialisation of the modload subsystem; chooses fetcher based on env.
- `src/golang.org/x/mod/module/module.go` — path escaping and validation.

Reading the proxy client (`proxy.go`) is highly recommended once. It is shorter than you expect, and the fall-through rules are spelled out plainly.

---

## Summary

A private module fetch is just a normal module fetch with three switches flipped: `GONOPROXY` redirects routing to `direct`, `GONOSUMDB` skips public sumdb, and `GOPRIVATE` is the convenient name for setting both. The proxy protocol is five HTTP endpoints, content-addressed and stateless. The sumdb protocol is a Merkle-tree transparency log; private paths skip it because the public DB cannot serve them. Insecure modes (`GOINSECURE`, `GOFLAGS=-insecure`) are local relaxations of TLS verification — bounded but always discouraged. The threat model that `GOPRIVATE` improves is "leak my private path to the public proxy." The threat model it does not improve is "an attacker with a valid PAT publishes malicious bytes." For that, you need code review and short token rotations — neither of which is a Go-toolchain concern.
