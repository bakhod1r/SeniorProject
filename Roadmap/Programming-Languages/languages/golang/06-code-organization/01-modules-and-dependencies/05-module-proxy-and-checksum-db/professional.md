# Module Proxy & Checksum Database — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [The GOPROXY Protocol, Byte by Byte](#the-goproxy-protocol-byte-by-byte)
3. [Resolution Algorithm and Fall-Forward Semantics](#resolution-algorithm-and-fall-forward-semantics)
4. [The `h1:` Hash Algorithm in Detail](#the-h1-hash-algorithm-in-detail)
5. [The Checksum Database Protocol (`/sumdb/`)](#the-checksum-database-protocol-sumdb)
6. [Merkle Tree, Tiles, and Signed Tree Heads](#merkle-tree-tiles-and-signed-tree-heads)
7. [Inclusion and Consistency Proof Verification](#inclusion-and-consistency-proof-verification)
8. [The Module Cache as a Servable Proxy](#the-module-cache-as-a-servable-proxy)
9. [Building a Minimal Proxy](#building-a-minimal-proxy)
10. [Programmatic Access: `x/mod`, `go mod download -json`](#programmatic-access-xmod-go-mod-download-json)
11. [Hermetic and Air-Gapped Builds](#hermetic-and-air-gapped-builds)
12. [Performance Profile](#performance-profile)
13. [Edge Cases the Source Reveals](#edge-cases-the-source-reveals)
14. [Operational Playbook](#operational-playbook)
15. [Summary](#summary)

---

## Introduction

The professional level treats the module proxy and checksum database not as services you configure but as protocols you can implement, verify, and operate. The proxy protocol is small enough to serve from a static file tree; the sumdb protocol is a tile-based Merkle transparency log you can verify offline given cached tree state. Misunderstanding either leads to opaque CI failures, broken air-gapped mirrors, or — worse — silently disabled integrity verification.

This file is for engineers who run private proxies, build module-aware tooling, operate hermetic build farms, or own the correctness of supply-chain integrity. After reading you will:

- Know the exact wire format of every proxy endpoint, including escaping.
- Reason about the resolution and fall-forward algorithm precisely.
- Compute and verify the `h1:` hash yourself.
- Understand the sumdb's tile-based log, STHs, and the two proof types.
- Serve the module cache as a proxy and build a minimal one.
- Operate fully hermetic, offline-verifiable builds.

The proxy is "just HTTP GETs returning files." The sumdb is "just a Merkle log." Knowing exactly where the complexity sits — in the hash construction and the proof verification, not in the transport — is the professional insight.

---

## The GOPROXY Protocol, Byte by Byte

A proxy is an HTTP server rooted at some base URL `$GOPROXY`. For a module path `M` and version `V`, all requests are GETs:

```
GET  $base/<esc(M)>/@v/list
GET  $base/<esc(M)>/@v/<esc(V)>.info
GET  $base/<esc(M)>/@v/<esc(V)>.mod
GET  $base/<esc(M)>/@v/<esc(V)>.zip
GET  $base/<esc(M)>/@latest
```

### Escaping (`esc`)

Module paths and versions can contain uppercase ASCII letters, but the protocol must work on case-insensitive filesystems. The encoding: **each uppercase letter `X` is replaced by `!x`** (a bang followed by its lowercase form).

```
github.com/Masterminds/semver/v3   →   github.com/!masterminds/semver/v3
gopkg.in/yaml.v2                   →   gopkg.in/yaml.v2          (no change)
```

The same escaping applies to versions, though versions rarely contain uppercase. This is `module.EscapePath` / `module.EscapeVersion` in `golang.org/x/mod/module`.

### Response formats

| Endpoint | Body | Notes |
|----------|------|-------|
| `list` | One version per line, `\n`-separated, **tagged releases only**. May be empty. Pseudo-versions and `+incompatible` excluded. | Order is unspecified; clients sort. |
| `.info` | JSON object. Minimum: `{"Version":"v1.6.0","Time":"2024-01-12T20:25:00Z"}`. May include `Origin` metadata. | Used to resolve queries (`@latest`, `@v1`, commit hashes). |
| `.mod` | The verbatim `go.mod` file for that version. For modules without a `go.mod` (legacy), a synthesized one. | Hashed into the `/go.mod` `go.sum` line. |
| `.zip` | A zip with a canonical layout: every file under `M@V/...`. | Hashed into the `h1:` `go.sum` line (see below). |
| `@latest` | JSON like `.info`, for the version Go picks when no version is given. | Optional; if absent, Go falls back to `list`. |

### Status codes

- **200** — success.
- **404 / 410** — module or version not found. *Triggers fall-forward* to the next proxy on a comma list.
- **Other (5xx, network, TLS)** — error. On a comma list, **aborts**; on a pipe list, falls forward.

### `.zip` layout requirement

The zip must contain exactly the files of the module, each prefixed with `module@version/`. There are constraints the toolchain enforces: no symlinks, no files outside the module prefix, case-folding collisions rejected, size limits. A proxy that serves a malformed zip will cause the client to reject the module. This canonical layout is what makes the `h1:` hash reproducible regardless of how the zip was produced.

---

## Resolution Algorithm and Fall-Forward Semantics

When the toolchain must resolve `M@query` (where `query` may be an exact version, `latest`, a branch, a commit, or a range):

1. Split `GOPROXY` on `,` and `|`, preserving which separator preceded each entry.
2. For each entry in order:
   - If the entry is `off`: stop. Fail with "module lookup disabled."
   - If the entry is `direct`: resolve via VCS (Git etc.). On VCS "not found," fall forward per the separator.
   - Otherwise (a URL): issue the protocol requests. To resolve a non-exact query, fetch `@latest` and/or `list` + `.info`.
3. On **404/410** from a URL entry: fall forward to the next entry regardless of separator.
4. On **any other error**: if the *next* entry is preceded by `|`, fall forward; if preceded by `,` (or it is the proxy-level default), abort the whole resolution with that error.

The distinction is precise: **commas only forgive "not found"; pipes forgive everything.** This is why a comma-separated governance mirror surfaces its own outages (good for visibility) while a pipe-separated one silently bypasses to the next proxy (good for availability, bad for governance).

`GONOPROXY` (seeded by `GOPRIVATE`) short-circuits all of this: matching modules skip the proxy list entirely and go straight to `direct`.

---

## The `h1:` Hash Algorithm in Detail

The `h1:` hash is **not** SHA-256 of the zip bytes. It is the `dirhash.Hash1` algorithm from `golang.org/x/mod/sumdb/dirhash`. Understanding it lets you verify integrity without the toolchain.

### Algorithm for a module zip (`HashZip` / `Hash1`)

Given the set of files in the canonical zip (paths and contents):

1. For each file, compute `sha256(contents)` as lowercase hex.
2. Form a line: `<hex>  <name>\n` where `<name>` is the in-zip path (`module@version/relpath`). Note **two spaces** between hex and name.
3. Sort all lines by `<name>` (byte order).
4. Concatenate the sorted lines.
5. Compute `sha256` of that concatenation.
6. Base64-encode (standard, with padding) and prefix with `h1:`.

In pseudocode:

```go
func Hash1(files []File) string {
    var lines []string
    for _, f := range files {
        h := sha256.Sum256(f.Contents)
        lines = append(lines, fmt.Sprintf("%x  %s\n", h, f.Name))
    }
    sort.Strings(lines)
    final := sha256.Sum256([]byte(strings.Join(lines, "")))
    return "h1:" + base64.StdEncoding.EncodeToString(final[:])
}
```

### Why a manifest hash, not a raw-zip hash

Zip files are not byte-deterministic: compression level, file ordering, timestamps, and extra fields vary by zip implementation. Hashing a *sorted manifest of per-file content hashes* makes the result depend only on **file paths and contents**, not packaging. Two zips with identical logical contents hash identically. This is what lets independent parties (your machine, the proxy, the sumdb, an auditor) all compute the same `h1:` for the same module version.

### The `/go.mod` hash

The `<module> <version>/go.mod h1:...` line is `Hash1` applied to a single "file" — the `go.mod` contents named `<module>@<version>/go.mod`. Because the module graph is built from `go.mod` files before any zip is fetched, this hash is verified independently and early.

### Verifying by hand

```bash
# Download the zip and compute its h1: with a tiny Go program using dirhash,
# or compare against the cached ziphash:
cat "$(go env GOMODCACHE)/cache/download/github.com/google/uuid/@v/v1.6.0.ziphash"
# h1:NIvaJDMOsjHA8n1jAhLSgzrAzy1Hgr+hNrb57e+94F0=
```

This `.ziphash` file is exactly the `h1:` line value the toolchain compares against `go.sum`.

---

## The Checksum Database Protocol (`/sumdb/`)

The sumdb is reached either directly (`https://sum.golang.org`) or *through a proxy* under the `/sumdb/` path prefix — which is how air-gapped mirrors keep verification working. The endpoints:

| Endpoint | Returns |
|----------|---------|
| `/latest` | The latest signed tree head (STH): a signed note with tree size and root hash. |
| `/lookup/<M>@<V>` | The log record for that module version: the `go.sum` lines plus the leaf's position in the tree, signed. |
| `/tile/<H>/<L>/<K>[.p/<W>]` | A *tile* of the Merkle tree — a chunk of hashes at level `L`, index `K`, hash function height `H`, optionally a partial tile of width `W`. |

When proxied, these appear under `$GOPROXY/sumdb/sum.golang.org/...`. The proxy forwards them; the client still verifies signatures and proofs end-to-end, so a malicious proxy gains nothing.

### The note format

STHs and lookups are signed using the *note* format (`golang.org/x/mod/sumdb/note`): human-readable text followed by one or more Ed25519 signatures keyed by a known public key. The sumdb's public key is baked into the Go toolchain (and `GONOSUMDB`/`GOSUMDB` can name an alternate key for a private sumdb: `GOSUMDB="sum.golang.org+<hash>+<key>"` form).

---

## Merkle Tree, Tiles, and Signed Tree Heads

The sumdb is a **tile-based transparency log** (the design behind `golang.org/x/mod/sumdb/tlog`).

### Structure

- Each `(module, version) → go.sum lines` record is a **leaf**.
- Leaves are hashed; pairs of nodes are hashed up the tree; the **root hash** commits to all leaves.
- A **signed tree head (STH)** = (tree size N, root hash, signature). It is the log's promise: "I have exactly N records, committed to by this root, and I signed it."

### Tiles

Fetching individual tree nodes one at a time would be chatty. Instead the tree is divided into **tiles** — fixed-size (typically 2^8 = 256-wide) subtrees of hashes at each level. A client fetches a handful of tiles to assemble any proof. Tiles are cacheable and content-addressed, so the proxy and the client cache them aggressively under `$GOMODCACHE/cache/download/sumdb/`.

### Client-side state

The `go` command remembers the largest STH it has verified. On each new lookup it:
1. Fetches the current `/latest` STH.
2. Demands a **consistency proof** from its remembered tree to the new one.
3. Demands an **inclusion proof** for the specific record it looked up.

This cached state is why repeated builds do not re-verify the whole log — they only verify the *delta*.

---

## Inclusion and Consistency Proof Verification

The two proofs are what make the log trustworthy without trusting the server.

### Inclusion proof

*Claim:* "Leaf `R` (the hash of the record for `M@V`) is present in the tree of size N with root `H`."

*Proof:* a logarithmic list of sibling hashes along the path from the leaf to the root. The client recomputes the root from the leaf and the siblings; if it equals the signed root `H`, the leaf is genuinely included.

*What it defends:* a man-in-the-middle (or malicious proxy) cannot fabricate a hash for `M@V` on the fly — they would need a valid inclusion proof against a validly signed root, which they cannot forge without the log's private key.

### Consistency proof

*Claim:* "The tree of size N₂ with root H₂ is an append-only superset of the tree of size N₁ with root H₁."

*Proof:* a logarithmic set of node hashes that let the client recompute *both* old and new roots and confirm the old tree is a prefix of the new one.

*What it defends:* the log cannot rewrite or remove history. If it ever presented you a root inconsistent with a root you (or anyone) previously saw, the consistency check fails — exposing equivocation (a split view where you get a different history than everyone else).

### Why this stops split-view attacks

To feed *you* a different hash for `M@V` than the world gets, an attacker must present you a forked tree with a different root. But that root must be consistent with the roots you have already cached and with the roots others observe (gossip). The consistency proof makes the fork detectable. The attacker is not *prevented* from misbehaving — they are *caught*. Same guarantee as Certificate Transparency.

The full algorithms live in `golang.org/x/mod/sumdb/tlog` (`ProveRecord`, `CheckRecord`, `ProveTree`, `CheckTree`). They are a few hundred lines and worth reading once.

---

## The Module Cache as a Servable Proxy

The module cache's `cache/download/` subtree is byte-for-byte the proxy protocol on disk:

```
$GOMODCACHE/cache/download/
└── github.com/google/uuid/@v/
    ├── list
    ├── v1.6.0.info
    ├── v1.6.0.mod
    ├── v1.6.0.zip
    ├── v1.6.0.ziphash
    └── v1.6.0.lock
└── sumdb/sum.golang.org/
    ├── latest
    ├── lookup/...
    └── tile/...
```

This is the single most useful fact for air-gapped operation. To serve it:

```bash
# As a file proxy:
GOPROXY="file://$(go env GOMODCACHE)/cache/download" go build ./...

# Or over HTTP — any static file server works:
cd "$(go env GOMODCACHE)/cache/download" && python3 -m http.server 8080
GOPROXY=http://localhost:8080 GOSUMDB=off go build ./...
```

Because the `sumdb/` tree is also cached there, a sufficiently warmed cache can serve *both* modules and sumdb verification offline (set `GOSUMDB` to proxy through the same base rather than `off` to keep verification).

---

## Building a Minimal Proxy

A read-through proxy is straightforward. The essence:

```go
// Minimal pass-through proxy: serve from a local cache dir, fall back to upstream.
func handler(cacheDir, upstream string) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        local := filepath.Join(cacheDir, filepath.FromSlash(r.URL.Path))
        if f, err := os.Open(local); err == nil {
            defer f.Close()
            io.Copy(w, f)
            return
        }
        // Fetch from upstream, tee to cache, serve.
        resp, err := http.Get(upstream + r.URL.Path)
        if err != nil || resp.StatusCode != http.StatusOK {
            http.Error(w, "not found", http.StatusNotFound)
            return
        }
        defer resp.Body.Close()
        os.MkdirAll(filepath.Dir(local), 0o755)
        tmp, _ := os.CreateTemp(filepath.Dir(local), "tmp")
        io.Copy(io.MultiWriter(w, tmp), resp.Body)
        tmp.Close()
        os.Rename(tmp.Name(), local) // atomic publish
    }
}
```

The real complexity in a production proxy (Athens, Artifactory) is *not* the protocol — it is storage backends, eviction, access control, sumdb proxying, concurrency, and serving `direct` resolution for modules not yet cached. The HTTP surface itself is what you see above.

The serious caveat: a hand-rolled proxy that fabricates `.zip` contents will be caught by the `h1:` hash and the sumdb. A proxy can cache and forward but cannot *alter* without detection — which is exactly the security property that makes a minimal pass-through proxy safe.

---

## Programmatic Access: `x/mod`, `go mod download -json`

When tooling needs proxy/sumdb data without reimplementing the protocol:

### `go mod download -json`

```bash
go mod download -json
```

```json
{
  "Path": "github.com/google/uuid",
  "Version": "v1.6.0",
  "Info":  "/.../cache/download/github.com/google/uuid/@v/v1.6.0.info",
  "GoMod": "/.../cache/download/github.com/google/uuid/@v/v1.6.0.mod",
  "Zip":   "/.../cache/download/github.com/google/uuid/@v/v1.6.0.zip",
  "Dir":   "/.../github.com/google/uuid@v1.6.0",
  "Sum":   "h1:NIvaJDMOsjHA8n1jAhLSgzrAzy1Hgr+hNrb57e+94F0=",
  "GoModSum": "h1:TIyPZe4MgqvfeYDBFedMoGGpEw/LqOeaOT+nhxU+yHo="
}
```

This is the supported way to get cache paths and hashes per module.

### `golang.org/x/mod` packages

| Package | Use |
|---------|-----|
| `module` | Path/version escaping (`EscapePath`, `EscapeVersion`), validation. |
| `sumdb/dirhash` | Compute `h1:` (`Hash1`, `HashZip`, `HashGoMod`). |
| `sumdb` | A sumdb client; verify lookups against a signed log. |
| `sumdb/note` | Parse/verify the signed note format used by STHs. |
| `sumdb/tlog` | The Merkle tree, tiles, and proof algorithms. |
| `modfile` | Parse/edit `go.mod` and `go.sum`. |

These are the *same* packages the toolchain uses, so reusing them yields identical behavior. Reimplementing the `h1:` hash or the proof verification yourself is error-prone — call `x/mod`.

---

## Hermetic and Air-Gapped Builds

A fully hermetic build touches no network and verifies everything from local state.

### The recipe

```bash
# 1. On a connected machine, warm the cache including sumdb tiles:
go mod download all

# 2. Transport $GOMODCACHE/cache/download into the air-gap.

# 3. In the air-gap, serve it and point Go at it:
GOPROXY="file:///srv/goproxy/cache/download"   \
GOSUMDB=sum.golang.org                          \
GONOSUMCHECK=                                   \
GOFLAGS=-mod=readonly                           \
go build ./...
```

If the warmed cache includes the `sumdb/` tiles needed, verification proceeds offline. If not, you must `GOSUMDB=off` and rely on `go.sum` (TOFU-against-cache).

### Verifying hermeticity

```bash
# Prove no network is needed by forbidding it:
GOPROXY=off go build ./...        # must succeed from cache/vendor alone
```

A build that passes `GOPROXY=off` after a clean cache-warm is provably independent of the proxy at build time.

### Toolchain pinning

`GOTOOLCHAIN=local` (Go 1.21+) prevents Go from downloading a newer toolchain mid-build — essential for hermeticity, since the toolchain itself is fetched over the same proxy mechanism if `GOTOOLCHAIN` points to a specific version.

---

## Performance Profile

The proxy/sumdb path is dominated by network and by the first fetch.

| Operation | Cold cache | Warm cache |
|-----------|------------|------------|
| Resolve `@latest` (1 module) | proxy round-trip (10s–100s ms) | cached `list`/`.info`, ~0 |
| Fetch `.mod` (graph build) | per-module round-trip | from cache, ~0 |
| Fetch `.zip` (build source) | bandwidth-bound | from cache, ~0 |
| sumdb lookup + proof (first use) | a few round-trips for tiles | cached tiles, ~0 |
| `go build` (everything cached) | network-free | network-free |

Key levers:
- **Warm `$GOMODCACHE`** in CI to eliminate per-job download cost.
- **A regional/private mirror** reduces latency vs `proxy.golang.org`.
- **`.mod`-before-`.zip`** means graph resolution is cheap; only compiled packages pull zips.
- **sumdb tile caching** means the proof cost is paid once, then amortized.

The `h1:` hashing itself is negligible (a SHA-256 pass over already-downloaded bytes). The cost is the network, which the cache and a nearby mirror eliminate.

---

## Edge Cases the Source Reveals

Reading `cmd/go/internal/modfetch` and `golang.org/x/mod/sumdb` exposes corners:

- **`+incompatible` versions** (v2+ modules without `/v2` paths) are served and hashed normally, but excluded from `list` discovery semantics.
- **Pseudo-versions** are resolved through `.info` with a commit, not via `list`. The proxy synthesizes a `v0.0.0-<timestamp>-<commit>` form.
- **A module with no `go.mod`** (pre-modules code) gets a *synthesized* `go.mod`; its `/go.mod` hash is over that synthesized content, computed deterministically.
- **Case-folding collisions** in a zip (two files differing only in case) are rejected by the client even if the proxy serves them.
- **The sumdb can be a *private* one** via `GOSUMDB=<name>+<keyhash>+<key>` pointing at an internal transparency log — Athens and enterprise tools can host one.
- **`GONOSUMDB`/`GOPRIVATE` matching is prefix-glob**, matched against the *module path*, element by element; `github.com/acme` does not match `github.com/acme-corp` (element boundary).
- **`GOFLAGS=-insecure` and `GOINSECURE`** relax transport but do **not** relax `h1:`/sumdb integrity — content verification still applies unless separately disabled.
- **A 200 response with a malformed zip** is rejected post-download; the proxy cannot cause a bad build, only a failed one.
- **`retract` directives** are read from `.mod` files; the proxy serves the `.mod` faithfully, and `go list -m -retracted` surfaces retraction — independent of the proxy.

These are pointers to reach for the source when something surprising happens; the implementation is tractable.

---

## Operational Playbook

| Scenario | Recipe |
|----------|--------|
| Inspect effective config | `go env GOPROXY GOSUMDB GOPRIVATE GONOSUMDB GOINSECURE GOMODCACHE` |
| Warm the cache | `go mod download all` (or `-x` to see requests) |
| Verify cache integrity | `go mod verify` |
| Repair corrupted cache | `go clean -modcache && go mod download` |
| Serve cache as a proxy | `GOPROXY="file://$(go env GOMODCACHE)/cache/download"` |
| Compute an `h1:` by hand | read `<...>.ziphash`, or use `x/mod/sumdb/dirhash` |
| Proxy the sumdb (air-gap) | point a mirror at `/sumdb/...`; keep `GOSUMDB` on |
| Disable public sumdb (scoped) | `GOPRIVATE=path/*` (preferred) or `GONOSUMDB=path/*` |
| Disable sumdb entirely | `GOSUMDB=off` (blunt; document it) |
| Force offline build | `GOPROXY=off` (+ vendor or warm cache) |
| Use a private sumdb | `GOSUMDB="sumdb.corp+<hash>+<key>"`, proxied via `GOPROXY` |
| Diagnose a 404 fall-forward | inspect `GOPROXY` separators; comma forgives only 404/410 |
| Debug a checksum mismatch | `go clean -modcache`; re-fetch; if persists, investigate upstream tag |
| Prove hermeticity | `GOPROXY=off GOFLAGS=-mod=readonly go build ./...` |

---

## Summary

The module proxy is a minimal HTTP protocol — `list`, `.info`, `.mod`, `.zip`, `@latest`, with `!`-escaped uppercase — walked left-to-right with comma-forgives-404 / pipe-forgives-everything fall-forward. Its bytes are verified, not trusted: the `h1:` hash is `dirhash.Hash1`, a SHA-256 over a *sorted manifest of per-file content hashes*, which makes integrity depend on content rather than packaging and lets every party compute the same value independently.

The checksum database is a tile-based Merkle transparency log. Signed tree heads commit to all records; inclusion proofs verify a record is present; consistency proofs verify the log only ever grew. Together they make the sumdb tamper-evident — it cannot serve a split view without detection — exactly as Certificate Transparency does for TLS certificates. The whole verification runs client-side against cached tree state, so a proxy can forward sumdb traffic (`/sumdb/...`) without weakening the guarantee, which is the basis of air-gapped verification.

Because the module cache's `cache/download/` tree *is* the proxy protocol on disk (including the `sumdb/` tiles), serving a proxy is as simple as a static file server, and hermetic offline builds are a matter of warming, transporting, and serving that tree. Reuse `golang.org/x/mod` for hashing and proof verification rather than reimplementing; use `go mod download -json` for structured data; pin the toolchain with `GOTOOLCHAIN=local`; and prove hermeticity with `GOPROXY=off`. The transport is trivial by design — the engineering substance lives in the hash construction and the Merkle proofs, which are exactly where the integrity guarantees come from.
