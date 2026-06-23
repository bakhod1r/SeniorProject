# Private Modules — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Environment Variables](#environment-variables)
3. [Glob Pattern Grammar](#glob-pattern-grammar)
4. [GOPROXY Chain Semantics](#goproxy-chain-semantics)
5. [Module Proxy Protocol Summary](#module-proxy-protocol-summary)
6. [Checksum Database Protocol Summary](#checksum-database-protocol-summary)
7. [Authentication Behaviour](#authentication-behaviour)
8. [References](#references)

---

## Introduction

The Go language specification (`go.dev/ref/spec`) does not specify private modules. The authoritative sources are:

1. **Go Modules Reference** at `go.dev/ref/mod` — sections "Module proxies", "Authenticating modules", "Checksum database", "Environment variables".
2. **`go help private`**, **`go help goproxy`**, **`go help goauth`** — terse, command-line oriented documentation built into the toolchain.
3. **Toolchain source** — `cmd/go/internal/modfetch/proxy.go` and `cmd/go/internal/cfg/cfg.go` are the de-facto specification when the reference is silent.

This file paraphrases those sources. Where the reference is silent, the toolchain source is the de-facto specification.

---

## Environment Variables

| Variable | Default | Type | Purpose |
|---|---|---|---|
| `GOPROXY` | `https://proxy.golang.org,direct` | List | Comma- or pipe-separated URLs of module proxies, plus literal `direct` and `off`. |
| `GOSUMDB` | `sum.golang.org` | String | Hostname or `<name>+<key>[ <url>]` triple of the checksum database. `off` disables sumdb. |
| `GOPRIVATE` | unset | List | Glob list of module paths considered private. Implies `GONOPROXY` and `GONOSUMDB`. |
| `GONOPROXY` | inherits `GOPRIVATE` | List | Glob list of module paths fetched via VCS, bypassing `GOPROXY`. |
| `GONOSUMDB` | inherits `GOPRIVATE` | List | Glob list of module paths whose checksums are *not* verified against `GOSUMDB`. |
| `GOINSECURE` | unset | List | Glob list of module paths allowed to be fetched over plain HTTP / with TLS verification disabled. |
| `GOFLAGS` | unset | String | Default flags applied to every `go` invocation. `-insecure` here is broad and discouraged. |
| `GOMODCACHE` | `$GOPATH/pkg/mod` | Path | Directory where modules are cached. |
| `GOFLAGS=-mod=vendor` | | | Build using only the local `vendor/` tree; do not network. |

### Paraphrase from `go help private`

> The `GOPRIVATE` environment variable controls which modules are considered private. It is a comma-separated list of glob patterns matching module path prefixes. Patterns are matched in addition to those in `GONOPROXY` and `GONOSUMDB`. The `go` command will not consult the public proxy or the public checksum database for modules whose paths match. Authentication for fetching private modules is handled outside the `go` command, typically through `git` configuration, SSH keys, or `.netrc`.

### Paraphrase from `go help goproxy`

> The `GOPROXY` environment variable lists module proxies to use, separated by commas or pipes. Each entry is a URL, or one of the special values `direct` and `off`. `direct` causes the `go` command to fetch the module directly from the version control system using `git`, `hg`, etc. `off` disables fetching from any source. Comma-separated entries fall through on `404` and `410` only; pipe-separated entries fall through on any error. The default is `https://proxy.golang.org,direct`.

---

## Glob Pattern Grammar

The pattern syntax is the same as `path.Match`:

```
pattern:
    { term }
term:
    '*'         matches any sequence of non-Separator characters
    '?'         matches any single non-Separator character
    '[' [ '^' ] { character-range } ']'
                character class (must be non-empty)
    c           matches character c (c != '*', '?', '\\', '[')
    '\\' c      matches character c
```

Notes:

- The path separator is `/`. `*` does not cross `/`.
- There is no `**`. To match multiple segments, you must list them: `org/*,org/*/v2`.
- Pattern matching is anchored. `acme-*` does not match `github.com/acme-corp`; you would need `github.com/acme-*`.
- Comma is the only separator between patterns. Whitespace inside a pattern list is treated as part of the pattern (so don't use it).

### Examples

| Pattern | Matches | Does not match |
|---|---|---|
| `github.com/acme/*` | `github.com/acme/foo`, `github.com/acme/bar` | `github.com/acme/foo/v2`, `github.com/acme` |
| `*.acme.io/*` | `git.acme.io/foo`, `gitlab.acme.io/bar` | `acme.io/foo` |
| `gopkg.in/yaml.v?` | `gopkg.in/yaml.v2`, `gopkg.in/yaml.v3` | `gopkg.in/yaml.v10` |

---

## GOPROXY Chain Semantics

`GOPROXY` is a list separated by `,` or `|`:

- `,` — fall through only on HTTP `404` or `410`. Other errors are fatal.
- `|` — fall through on *any* error.

The literal `direct` means "fetch via VCS." The literal `off` means "do not fetch; fail." A chain ending in `off` means "if no earlier entry serves, fail."

Examples:

```
GOPROXY=https://proxy.golang.org,direct
    Try public proxy. If 404/410, fall through to git.

GOPROXY=https://athens.acme.io,direct
    Try internal proxy. If 404/410, fall through to git.

GOPROXY=https://athens.acme.io|direct
    Try internal proxy. On any error (including 5xx), fall through.

GOPROXY=https://athens.acme.io
    Try internal proxy. If anything goes wrong, fail.

GOPROXY=off
    Do not fetch. Used in air-gapped builds with vendoring or pre-warmed cache.
```

`GONOPROXY` (inherited from `GOPRIVATE`) takes precedence: matching paths skip the chain entirely and go straight to `direct`.

---

## Module Proxy Protocol Summary

The protocol is HTTP-based, defined in `go.dev/ref/mod#goproxy-protocol`. All paths are escape-encoded: uppercase ASCII letters become `!` followed by lowercase. Other characters pass through.

| Endpoint | Method | Response | Required? |
|---|---|---|---|
| `<module>/@v/list` | GET | Plain text, newline-separated list of versions | yes |
| `<module>/@latest` | GET | JSON: `{Version, Time}` | optional (toolchain falls back to `@v/list`) |
| `<module>/@v/<version>.info` | GET | JSON: `{Version, Time, ...}` | yes |
| `<module>/@v/<version>.mod` | GET | The module's `go.mod` at that version | yes |
| `<module>/@v/<version>.zip` | GET | Module source as a zip | yes |

### Required response codes

- `200` — success.
- `404` or `410` — not available; client falls through (with `,` separator) to next proxy.
- Anything else — error; client stops (with `,`) or falls through (with `|`).

### Module zip rules

- Top-level prefix: `<module>@<version>/`.
- No symlinks, no devices, no special files.
- File paths case-insensitively unique.
- Total uncompressed size ≤ 500 MB.

These rules are enforced by the toolchain (`cmd/go/internal/modfetch/zip`).

---

## Checksum Database Protocol Summary

Defined in `go.dev/ref/mod#checksum-database`. The DB is an append-only Merkle tree.

| Endpoint | Purpose |
|---|---|
| `lookup/<module>@<version>` | Query the hash for a specific module@version. |
| `tile/<H>/<L>/<K>[.p/<W>]` | Tile of the Merkle tree at level L, height H, index K, optional partial width W. |
| `latest` | Signed tree head — current size and root hash. |

Lookup response format:

```
<tree size>
<module> <version> h1:<hash of zip>
<module> <version>/go.mod h1:<hash of go.mod>

— <name> <signature>
```

The signature is over the preceding bytes; the signing key is configured via `GOSUMDB=name+pubkey[+url]`.

`GOPRIVATE` glob matches → skip the lookup. The lookup is also skipped when `GOSUMDB=off`.

---

## Authentication Behaviour

### Per `go help goauth` (paraphrase)

> The `go` command does not perform authentication itself. It delegates to the version control system (typically `git`) for `direct` fetches, and to the underlying HTTP transport for proxy fetches. For Git over HTTPS, `git`'s credential helpers, URL-embedded credentials, and `~/.netrc` are all consulted in their normal order. For Git over SSH, the user's SSH agent and key configuration are used.

### `.netrc` interaction

The `.netrc` file (`%USERPROFILE%\_netrc` on Windows) is read by `git`'s HTTPS layer when no other credential helper supplies an answer. Entries are matched on hostname; the first match wins. Permissions must be 0600 on Unix.

### Custom proxy auth

A proxy may require authentication. The toolchain uses `git`'s machinery — i.e. the same `.netrc` or credential helper — to authenticate the proxy URL itself.

---

## References

- Go Modules Reference: `go.dev/ref/mod`
  - Section "Environment variables"
  - Section "Module proxies"
  - Section "Authenticating modules"
  - Section "Checksum database"
- Built-in help: `go help private`, `go help goproxy`, `go help goauth`, `go help mod`.
- Toolchain source (read-only reference):
  - `src/cmd/go/internal/modfetch/proxy.go`
  - `src/cmd/go/internal/modfetch/sumdb.go`
  - `src/cmd/go/internal/cfg/cfg.go`
  - `src/cmd/go/internal/modload/init.go`
- Athens project: `github.com/gomods/athens` (canonical open-source proxy).
