# Module Proxy & Checksum Database — Find the Bug

> Each snippet contains a real-world bug related to the module proxy or the checksum database. The `go` command fetches modules through a proxy (`GOPROXY`, default `proxy.golang.org`) over a small HTTP protocol, and verifies their integrity against `go.sum` and the checksum database (`GOSUMDB`, default `sum.golang.org`). Find the bug, explain it, fix it.

---

## Bug 1 — Deleting `go.sum` to silence a checksum error

```bash
$ go build ./...
verifying github.com/foo/bar@v1.2.0: checksum mismatch
	downloaded: h1:AAAA...
	go.sum:     h1:BBBB...
SECURITY ERROR
$ rm go.sum            # "fixed" it
$ go mod tidy
$ go build ./...       # works now
```

**Bug:** Deleting `go.sum` removes the *alarm*, not the *cause*. The mismatch meant the bytes Go downloaded differed from what was previously recorded — corruption, a moved upstream tag, or tampering. Wiping `go.sum` makes Go re-record whatever bytes it now sees (trust-on-first-use again), shipping potentially tampered code without complaint. The `SECURITY ERROR` label exists precisely to stop this reflex.

**Fix:** investigate before overriding. The usual innocent cause is a corrupted cache:

```bash
$ go clean -modcache
$ go mod download
$ go build ./...
```

If the mismatch persists, the upstream version genuinely changed — investigate the dependency, pin a known-good version, and only update `go.sum` deliberately once you trust the new bytes.

---

## Bug 2 — Private module fetched through the public proxy

```bash
$ go get git.acme.internal/team/utils@v1.2.0
go: git.acme.internal/team/utils@v1.2.0: reading
	https://proxy.golang.org/git.acme.internal/team/utils/@v/v1.2.0.info:
	410 Gone
	verifying git.acme.internal/team/utils@v1.2.0: checksum database
	lookup required for non-public module
```

**Bug:** The internal module path was sent to the *public* proxy and checksum database, which cannot see internal hosts. It 410s, and — worse — the internal path `git.acme.internal/team/utils` is now logged by a third party, leaking infrastructure and project names.

**Fix:** mark the namespace private *before* fetching, so Go goes straight to VCS and skips the public sumdb:

```bash
$ go env -w GOPRIVATE='git.acme.internal,*.acme.internal'
$ go get git.acme.internal/team/utils@v1.2.0
```

Ensure VCS credentials exist (netrc/SSH/`.gitconfig` rewrites). `GOPRIVATE` covers both proxy and sumdb exclusion.

---

## Bug 3 — Pipe separator hides a broken governance mirror

```bash
$ go env GOPROXY
https://athens.corp.example.com|https://proxy.golang.org|direct
$ go build ./...       # works, but...
$ # the corporate Athens mirror has been down for a week and nobody noticed
```

**Bug:** The pipe (`|`) separator falls forward to the next entry on *any* error, including the corporate mirror returning 500s or timing out. The build silently bypasses the mirror — and its dependency governance, caching, and audit — going straight to the public proxy. The mirror could be down for weeks while builds keep "working."

**Fix:** use a comma if the mirror is meant to be authoritative, so its failures *surface* instead of being papered over:

```bash
$ go env -w GOPROXY='https://athens.corp.example.com,https://proxy.golang.org,direct'
```

Now a non-404 error from the mirror aborts the build, alerting you that governance is broken. Reserve pipe for cases where availability genuinely trumps governance.

---

## Bug 4 — Following a stale blog: `GONOSUMCHECK`

```bash
$ # from a 2019 StackOverflow answer:
$ export GONOSUMCHECK=1
$ go build ./...
verifying github.com/foo/bar@v1.2.0: checksum mismatch
SECURITY ERROR        # still fails!
```

**Bug:** `GONOSUMCHECK` was a short-lived variable removed around Go 1.13. It does nothing on modern Go, so the checksum error is unaffected. The deeper bug is the *intent* — trying to disable verification to dodge a real signal.

**Fix:** first, investigate the mismatch (likely a corrupted cache: `go clean -modcache`). If you genuinely must scope out a path from the *checksum database* (e.g. a private module), use the modern variables:

```bash
$ go env -w GOPRIVATE='your.private.host/*'      # scoped: skip sumdb for these paths
# or, the blunt machine-wide switch (document it):
$ go env -w GOSUMDB=off
```

`GOSUMDB=off` still leaves `go.sum` enforced; it only skips the *global* log.

---

## Bug 5 — `GOSUMDB=off` mistaken for disabling `go.sum`

```bash
$ go env -w GOSUMDB=off
$ vim "$(go env GOMODCACHE)/github.com/foo/bar@v1.2.0/foo.go"   # hand-edit a dep
$ go build ./...
verifying github.com/foo/bar@v1.2.0: checksum mismatch
	downloaded: h1:...
	go.sum:     h1:...
```

**Bug:** The developer assumed `GOSUMDB=off` turns off *all* checksum verification, so they edited a cached dependency expecting it to build. But `GOSUMDB=off` only disables the *global checksum database* lookup — your local `go.sum` is still enforced on every build. The edit changes the cached bytes, which no longer match `go.sum`, so the build fails.

**Fix:** never edit the module cache (it's read-only by design). To patch a dependency, fork it and use a `replace` directive:

```bash
$ go clean -modcache    # restore the untampered cache
$ go mod edit -replace=github.com/foo/bar=github.com/me/bar-fork@v1.2.0-fix
$ go mod tidy
$ go build ./...
```

The patch then lives in a real module with its own valid hash.

---

## Bug 6 — `GOPROXY=off` in CI without a warm cache

```yaml
# .github/workflows/ci.yml
- run: go env -w GOPROXY=off
- run: go build ./...
```

```
go: github.com/google/uuid@v1.6.0: module lookup disabled by GOPROXY=off
```

**Bug:** `GOPROXY=off` forbids *all* downloads. On a fresh CI runner the module cache is empty, so the very first required module fails. The developer confused `off` ("no network at all") with a way to "use the cache" — but there is no cache yet.

**Fix:** either warm the cache first, or do not set `off` on a runner that needs to fetch:

```yaml
# Option A: warm, then build (still online for the download step)
- run: go mod download
- run: go build ./...

# Option B: if you truly want offline, vendor and use vendor mode
- run: go build -mod=vendor ./...
```

`GOPROXY=off` only makes sense when the cache (or `vendor/`) already contains everything.

---

## Bug 7 — Confusing `direct` with offline

```bash
$ # build server has NO internet, developer wants "no proxy" builds
$ go env -w GOPROXY=direct
$ go build ./...
go: github.com/google/uuid@v1.6.0: ... dial tcp: lookup github.com:
	no such host
```

**Bug:** `direct` does not mean "offline." It means "skip the proxy and fetch from the source VCS *over the network*." On an air-gapped server, `direct` still tries to reach GitHub and fails. The developer wanted hermetic builds and chose the wrong keyword.

**Fix:** for offline builds, use a warm cache (or vendor) with `GOPROXY=off`:

```bash
# On a connected machine: go mod download all, then ship the cache.
$ GOPROXY="file:///srv/modcache/cache/download" GOSUMDB=off go build ./...
# or
$ go build -mod=vendor ./...   # if vendored
```

`direct` = "use VCS"; `off` = "use nothing remote."

---

## Bug 8 — Missing `go.sum` entry after a manual `go.mod` edit

```bash
$ go mod edit -require=github.com/sirupsen/logrus@v1.9.3
$ go build ./...
go: github.com/sirupsen/logrus@v1.9.3: missing go.sum entry;
	to add it: go mod download github.com/sirupsen/logrus
```

**Bug:** `go mod edit -require` writes a `require` line into `go.mod` but does **not** fetch the module or add its `go.sum` hash. Since Go 1.16, builds will not silently add missing `go.sum` entries — they fail, forcing you to record the hash deliberately.

**Fix:** fetch and record the hash, ideally via tidy:

```bash
$ go mod tidy
# or specifically:
$ go mod download github.com/sirupsen/logrus
$ go build ./...
```

`go mod tidy` resolves, fetches, verifies against the sumdb, and writes the `go.sum` lines.

---

## Bug 9 — Uppercase module path 404s due to wrong escaping

```bash
$ curl https://proxy.golang.org/github.com/Masterminds/semver/v3/@v/list
not found: ...
$ # "the proxy doesn't have this module!"
```

**Bug:** The proxy protocol escapes uppercase letters: each uppercase `X` becomes `!x`. The raw URL with `Masterminds` is wrong; the correct path is `!masterminds`. The proxy *does* have the module — the request was malformed. (Note: the `go` command does this escaping automatically; the bug only bites when you `curl` by hand or build tooling.)

**Fix:** escape uppercase letters in hand-built proxy URLs:

```bash
$ curl https://proxy.golang.org/github.com/!masterminds/semver/v3/@v/list
v3.0.0
v3.1.0
...
```

In code, use `golang.org/x/mod/module.EscapePath` rather than hand-rolling.

---

## Bug 10 — Pseudo-version expected in `@v/list`

```bash
$ curl https://proxy.golang.org/github.com/foo/bar/@v/list | \
    grep 'v0.0.0-20240101'
$ # empty! "the proxy lost my commit version"
```

**Bug:** The `/@v/list` endpoint returns only proper *tagged* releases. Pseudo-versions (synthesized versions for untagged commits, like `v0.0.0-20240101000000-abcdef123456`) are **not** listed there. They are resolved on demand through the `.info` endpoint with a commit reference. Grepping `list` for a pseudo-version will always come up empty.

**Fix:** resolve pseudo-versions via `.info` or `go list -m`:

```bash
$ go list -m github.com/foo/bar@abcdef123456
github.com/foo/bar v0.0.0-20240101000000-abcdef123456
# or directly:
$ curl https://proxy.golang.org/github.com/foo/bar/@v/v0.0.0-20240101000000-abcdef123456.info
```

`list` is for tagged releases; `.info` resolves arbitrary versions and commits.

---

## Bug 11 — Editing `go.sum` by hand to "fix" a hash

```bash
$ go build ./...
verifying github.com/foo/bar@v1.2.0: checksum mismatch
	downloaded: h1:NEW...
	go.sum:     h1:OLD...
$ # developer copies the "downloaded" hash into go.sum to make it match
$ sed -i 's#h1:OLD...#h1:NEW...#' go.sum
$ go build ./...    # works now — but unsafe!
```

**Bug:** Hand-pasting the *downloaded* hash into `go.sum` defeats the entire integrity mechanism. You've told Go "whatever bytes I just got are correct" — exactly what an attacker serving tampered bytes wants you to do. The mismatch was a signal; overwriting `go.sum` with the new hash silences it without verifying the new bytes are legitimate.

**Fix:** never hand-edit `go.sum`. Determine *why* the hash changed:

```bash
$ go clean -modcache && go mod download    # rule out cache corruption
```

If the upstream version legitimately changed, verify against the sumdb by letting `go` re-record it cleanly (it cross-checks the global log), or move to a different, known-good version.

---

## Bug 12 — `GOINSECURE` used for a public module

```bash
$ go env -w GOINSECURE='github.com/*'
$ go get github.com/foo/bar@v1.2.0
```

**Bug:** `GOINSECURE` permits fetching matching modules over plain HTTP and skips TLS certificate verification. Applying it to `github.com/*` (public modules over the public internet) opens every GitHub fetch to man-in-the-middle tampering. The setting is meant only for *trusted internal hosts* with self-signed certs — never for public modules.

**Fix:** scope `GOINSECURE` narrowly to the internal host that needs it, and never to public namespaces:

```bash
$ go env -u GOINSECURE
$ go env -w GOINSECURE='git.internal.example.com'   # only the trusted internal host
```

Even then, prefer fixing the host's TLS certificate over using `GOINSECURE`.

---

## Bug 13 — CI re-downloads everything every job

```yaml
# .github/workflows/ci.yml
- uses: actions/checkout@v4
- uses: actions/setup-go@v5
  with: { go-version: '1.23' }
- run: go build ./...      # downloads 150 modules from the proxy, EVERY job
```

**Bug:** Nothing caches the module cache (`$GOMODCACHE`) between jobs, so every CI run re-fetches the entire dependency set from `proxy.golang.org` — slow, and exposed to proxy outages and rate limits.

**Fix:** cache the module cache, keyed on `go.sum`:

```yaml
- uses: actions/setup-go@v5
  with:
    go-version: '1.23'
    cache: true                          # caches $GOMODCACHE keyed on go.sum
    cache-dependency-path: go.sum
- run: go build ./...
```

`setup-go`'s built-in cache (or a manual `actions/cache` on `$(go env GOMODCACHE)`) eliminates the per-job download.

---

## Bug 14 — Sumdb unreachable blocks every build

```bash
$ go build ./...
go: github.com/foo/bar@v1.6.0: verifying module:
	sum.golang.org/lookup/...: dial tcp: i/o timeout
```

```bash
$ # the team disables it globally to "fix" the outage
$ go env -w GOSUMDB=off
```

**Bug:** The *fix* is the bug. The sumdb was unreachable (firewall, outage), which only blocks *first-time* verification of *new* modules — existing `go.sum` entries build fine without it. Globally disabling `GOSUMDB` removes integrity verification for **all** future modules on every project on that machine, far beyond the immediate problem.

**Fix:** for a temporary outage, only existing builds need to work (they do — `go.sum` is local). If you must add new deps during an outage, scope the exception or proxy the sumdb rather than disabling it everywhere:

```bash
# Better: route sumdb through a reachable proxy that mirrors /sumdb/
$ go env -w GOPROXY='https://athens.corp.example.com'
# Athens proxies sum.golang.org under /sumdb/, preserving verification.
```

Only reach for `GOSUMDB=off` as a documented, deliberate decision — not a reflex to an outage.

---

## Bug 15 — `replace` to a private module without credentials in CI

```go.mod
replace github.com/acme/shared => github.com/acme/shared-fork v1.0.0
```

```bash
# CI
$ go mod download
go: github.com/acme/shared-fork@v1.0.0: reading ...:
	fatal: could not read Username for 'https://github.com': terminal prompts disabled
```

**Bug:** `GOPRIVATE` was set (so Go fetches `acme/*` from VCS directly), but the CI runner has no Git credentials for the private fork. `go mod download` tries to clone it and hits an interactive auth prompt, which CI disables — so it dies.

**Fix:** provide non-interactive credentials in CI and ensure `GOPRIVATE` covers the path:

```yaml
env:
  GOPRIVATE: github.com/acme/*
steps:
  - run: git config --global url."https://${TOKEN}@github.com/".insteadOf "https://github.com/"
  - run: go mod download
```

A token-based URL rewrite (or SSH deploy key) lets the runner clone private modules non-interactively.

---

## Bug 16 — Trusting a 200 from a misbehaving proxy

```bash
$ GOPROXY=https://sketchy-mirror.example.com go get github.com/foo/bar@v1.2.0
verifying github.com/foo/bar@v1.2.0: checksum mismatch
	downloaded: h1:TAMPERED...
	sum.golang.org: h1:LEGIT...
SECURITY ERROR
$ # developer switches GOSUMDB=off to make the mirror's bytes "work"
$ GOSUMDB=off GOPROXY=https://sketchy-mirror.example.com go get github.com/foo/bar@v1.2.0
```

**Bug:** The sketchy mirror served *different bytes* than the checksum database attests to — exactly the tampering scenario the sumdb exists to catch. The "fix" of `GOSUMDB=off` disables the very check that detected the attack, then records the tampered hash into `go.sum` as if it were legitimate.

**Fix:** treat a sumdb mismatch from an untrusted proxy as a likely attack. Do **not** disable the sumdb. Stop using the sketchy mirror; fetch from a trusted proxy:

```bash
$ GOPROXY=https://proxy.golang.org,direct go clean -modcache
$ GOPROXY=https://proxy.golang.org,direct go get github.com/foo/bar@v1.2.0   # verifies cleanly
```

The whole point of the sumdb is that a malicious proxy *cannot* feed you bad bytes undetectably — unless you turn it off.

---

## Bug 17 — `GOFLAGS=-insecure` left in the environment

```bash
$ env | grep GOFLAGS
GOFLAGS=-insecure
$ go get github.com/foo/bar@v1.2.0
$ # works, but every fetch on this machine now skips TLS verification
```

**Bug:** A teammate set `GOFLAGS=-insecure` once to work around a corporate TLS-interception proxy and never unset it. Now *every* module fetch on that machine — across all projects, including public ones — skips certificate verification, exposing all of them to MITM.

**Fix:** clear the global flag; handle the TLS-interception problem properly (install the corporate CA, or scope `GOINSECURE` to the specific internal host):

```bash
$ go env -u GOFLAGS         # or unset GOFLAGS in the shell
$ # if a corporate MITM proxy is the issue, trust its CA instead:
$ # add the corporate root CA to the system trust store
```

Audit with `go env GOFLAGS GOINSECURE` and compare dev vs CI early.

---

## Bug 18 — Module path mismatch surfacing during fetch

```bash
$ go get github.com/myfork/cobra@latest
go: github.com/myfork/cobra@v1.8.0: parsing go.mod:
	module declares its path as: github.com/spf13/cobra
	        but was required as: github.com/myfork/cobra
```

**Bug:** Someone forked `spf13/cobra` to `myfork/cobra` but did not change the `module` line in the fork's `go.mod`. The proxy faithfully serves the fork's `go.mod`, which still declares `github.com/spf13/cobra`. Go refuses to use a module under a path it does not claim — an integrity check against accidental or malicious path confusion.

**Fix:** either update the fork's `go.mod` `module` line to the new path, or (to use the fork at the original path) use a `replace` instead of importing it under a new path:

```go.mod
// import as the original path, point at the fork:
require github.com/spf13/cobra v1.8.0
replace github.com/spf13/cobra => github.com/myfork/cobra v1.8.0-fork
```

The fork's `go.mod` must still declare `github.com/spf13/cobra` for the replace to be valid.

---

## Bug 19 — Cache shared between case-sensitive and insensitive filesystems

```bash
# Developer Mac (case-insensitive APFS):
$ go mod download github.com/Sirupsen/logrus@v1.0.0   # old uppercase fork
$ go mod download github.com/sirupsen/logrus@v1.9.3   # canonical lowercase
$ # both seem to coexist on Mac
# Linux CI (case-sensitive):
$ go build ./...
# subtle resolution differences; one path resolves to the wrong cached module
```

**Bug:** Two module paths differing only in case (`Sirupsen` vs `sirupsen`) are *distinct* on case-sensitive filesystems but *collide* on case-insensitive ones. The proxy protocol's `!`-escaping (`!sirupsen` for `Sirupsen`) avoids this in the *download* cache, but mixing the two historical paths in one project still causes confusion and divergent behaviour across OSes.

**Fix:** standardise on the canonical lowercase path everywhere; remove the legacy uppercase import:

```bash
$ go mod edit -droprequire=github.com/Sirupsen/logrus
$ # update all imports to github.com/sirupsen/logrus
$ go mod tidy
$ go clean -modcache && go mod download   # rebuild a clean cache
```

Never depend on two paths that differ only in case.

---

## Bug 20 — Assuming the proxy has a freshly-pushed tag instantly

```bash
$ git tag v1.5.0 && git push origin v1.5.0   # just now
$ go get github.com/myorg/mylib@v1.5.0
go: github.com/myorg/mylib@v1.5.0:
	reading https://proxy.golang.org/.../@v/v1.5.0.info: 404 Not Found
$ # "the proxy is broken!"
```

**Bug:** `proxy.golang.org` serves *cached, immutable* versions. A tag pushed seconds ago has not yet been fetched and cached by the proxy. The 404 is not a proxy failure — it is "I haven't seen this version yet." The proxy typically catches up within minutes (it fetches on first request and caches).

**Fix:** wait briefly and retry, or trigger the proxy to fetch by requesting it, or fall back to `direct` for an immediate fetch:

```bash
# Nudge the proxy to fetch and cache the new version:
$ curl https://proxy.golang.org/github.com/myorg/mylib/@v/v1.5.0.info
# then:
$ go get github.com/myorg/mylib@v1.5.0
# or, for an immediate fetch bypassing the proxy:
$ GOPROXY=direct go get github.com/myorg/mylib@v1.5.0
```

Proxy immutability is a feature (versions never change); the trade-off is a small fetch-and-cache delay for brand-new tags.

---

## Bug 21 — `GOPROXY` with a trailing `off` that's unreachable

```bash
$ go env GOPROXY
https://proxy.golang.org,off,direct
$ go get github.com/some/new-dep@latest
go: github.com/some/new-dep@latest: module lookup disabled by GOPROXY=off
```

**Bug:** `off` is a *terminator*: resolution stops at it and fails if the module wasn't found by an earlier entry. Anything *after* `off` (here, `direct`) is unreachable. When the public proxy 404s a module, Go hits `off` and stops — it never reaches `direct`. The author likely meant the list to end in `direct`.

**Fix:** remove the stray `off`; end the list with `direct` (or `off` only if you truly want to forbid fallback):

```bash
$ go env -w GOPROXY='https://proxy.golang.org,direct'
```

Use `off` only as a deliberate hard stop, and know that it makes every later entry dead.

---

## Bug 22 — Disabling sumdb in a Dockerfile, baked into the image

```dockerfile
FROM golang:1.23
ENV GOSUMDB=off
ENV GOFLAGS=-insecure
WORKDIR /src
COPY . .
RUN go build -o /app ./cmd/api
```

**Bug:** `GOSUMDB=off` and `GOFLAGS=-insecure` are baked into the build image as environment variables. *Every* build using this image — now and forever — skips checksum-database verification and TLS verification, silently weakening the supply-chain integrity of all downstream builds. A future maintainer inherits insecure defaults with no warning.

**Fix:** do not disable verification in a shared base image. Keep the sumdb on and TLS verification intact; if you have a genuine private-module need, scope it:

```dockerfile
FROM golang:1.23
ENV GOPRIVATE=github.com/acme/*      # scoped: only private paths skip the public sumdb
WORKDIR /src
COPY . .
RUN --mount=type=secret,id=netrc,target=/root/.netrc \
    go build -o /app ./cmd/api
```

If the network is the constraint, vendor or warm the cache rather than disabling integrity checks globally.

---

## Summary

The proxy and checksum database look like background plumbing, but they enforce real integrity guarantees — and most bugs come from one of three habits:

1. **Disabling verification to silence a signal.** Deleting `go.sum`, hand-editing hashes, `GOSUMDB=off`, `GONOSUMCHECK`, `GOFLAGS=-insecure`, or `GOINSECURE` on public modules all turn off the mechanism instead of investigating the cause. A `checksum mismatch` is a `SECURITY ERROR` for a reason. Investigate first (usually `go clean -modcache`); never blanket-disable.
2. **Misunderstanding the keywords and env vars.** `off` ≠ `direct` ≠ offline; comma ≠ pipe; `GOSUMDB=off` does not disable `go.sum`; `GONOSUMCHECK` is removed; `GOPRIVATE` (not the public proxy) is how internal modules are fetched. Know exactly what each switch does before reaching for it.
3. **Ignoring the proxy's nature.** It serves *immutable, cached, escaped* versions: brand-new tags lag, uppercase paths are `!`-escaped, `list` omits pseudo-versions, and a 404 means "not cached / not found," not "broken." A misbehaving proxy *cannot* corrupt a build unless you disable the sumdb — so a checksum mismatch from an untrusted mirror is a likely attack, not an inconvenience.

Treat `go.sum` as a security file, `GOPRIVATE` as the switch for internal code, and the sumdb as a tamper-evident guarantee you should keep on. With those three habits, the proxy and checksum database stay invisible — exactly as they should.
