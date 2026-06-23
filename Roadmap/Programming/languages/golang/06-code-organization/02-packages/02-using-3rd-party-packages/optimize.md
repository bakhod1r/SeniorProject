# Using Third-Party Packages — Optimization

> Honest framing first: pulling in a third-party package is a one-line edit to `go.mod` plus a download. The command itself has nothing to optimize. What deserves attention is everything that flows from that decision: the size of the resulting binary, the speed of the next cold build, the time spent on dependency upgrades, the security review surface, and the cost of every CI run that has to fetch and link those modules.
>
> Each entry below states the problem, shows a "before" setup, an "after" setup, and the realistic gain. The goal is not to forbid third-party code — Go's ecosystem is one of its strengths — but to spend the dependency budget intentionally instead of by accident.

---

## Optimization 1 — Replace heavyweight libraries with stdlib equivalents

**Problem:** Reaching for `gin`, `echo`, `gorilla/mux`, or `chi` for every HTTP service has become reflexive. For a small API with a handful of routes and standard JSON I/O, you are pulling in tens of thousands of lines (and dozens of transitive deps) to replace what `net/http` and `http.ServeMux` already do — especially since Go 1.22's pattern-matching mux landed.

**Before (`go.mod`):**
```
require (
    github.com/gin-gonic/gin v1.10.0
    // pulls in validator, sse, ugorji/go, bytedance/sonic, ...
)
```
A "hello world" service compiles 70+ extra packages.

**After:**
```go
mux := http.NewServeMux()
mux.HandleFunc("GET /users/{id}", getUser)
mux.HandleFunc("POST /users",     createUser)
http.ListenAndServe(":8080", mux)
```
Zero new modules. Same routing semantics for most use cases.

**Gain:** Cold-build time on a small service drops from 6–10 s to under 2 s. Binary shrinks by 3–6 MB. Fewer transitive CVEs to track.

---

## Optimization 2 — Use a regional or private GOPROXY for faster cold-cache resolution

**Problem:** The default `proxy.golang.org` is global and reliable, but in some regions or behind a corporate egress proxy the latency on a cold module fetch dominates first-build time. CI runners that always start cold suffer the most.

**Before:**
```bash
# default
unset GOPROXY
```
A fresh CI runner pulls every module across the public internet.

**After (corporate / regional mirror):**
```bash
export GOPROXY=https://goproxy.eu-central.acme.internal,https://proxy.golang.org,direct
export GOSUMDB=sum.golang.org
```
For air-gapped environments, run an internal Athens, JFrog, or Sonatype Go proxy that mirrors and caches modules close to the runners.

**Gain:** First `go mod download` in a fresh container drops from 30–60 s to a few seconds. Also stabilises CI against external proxy outages and rate limits.

---

## Optimization 3 — Cache the module cache in CI, keyed by `go.sum`

**Problem:** A fresh CI runner re-downloads every dependency on every build. With ~150 transitive modules, that is tens of seconds per job, repeated thousands of times per week — pure waste when `go.sum` has not changed.

**Before (GitHub Actions):**
```yaml
- uses: actions/setup-go@v5
  with: { go-version: '1.23' }
- run: go test ./...
```
No cache key, no restore — every job pulls from the proxy.

**After:**
```yaml
- uses: actions/setup-go@v5
  with:
    go-version: '1.23'
    cache: true                       # caches GOMODCACHE + build cache
    cache-dependency-path: '**/go.sum'
- run: go test ./...
```
The cache is keyed on the hash of `go.sum` and reused until dependencies actually change.

**Gain:** Typical CI job shrinks by 30–90 s on cache hit. On a busy repo this is the single highest-impact change to make on day one.

---

## Optimization 4 — Use `go install pkg@version` for tools, not deps in `go.mod`

**Problem:** Listing build tools (`golangci-lint`, `mockgen`, `protoc-gen-go`, `goimports`) as `require` entries in your application's `go.mod` is a well-meaning mistake. Their transitive dependencies leak into your module graph, slow `go mod tidy`, and can create version conflicts that have nothing to do with your runtime code.

**Before (`tools.go` pattern):**
```go
//go:build tools
package tools

import (
    _ "github.com/golangci/golangci-lint/cmd/golangci-lint"
    _ "go.uber.org/mock/mockgen"
)
```
These imports drag hundreds of transitive packages into `go.sum`.

**After (Go 1.16+):**
```bash
go install github.com/golangci/golangci-lint/cmd/golangci-lint@v1.59.1
go install go.uber.org/mock/mockgen@v0.4.0
```
Pin versions in a `Makefile` or `tools/install.sh` so every contributor and CI runner installs the same binary, but keep them out of `go.mod`.

**Gain:** Application `go.mod` shrinks dramatically; `go mod tidy` no longer churns over tool dependencies; production builds are not influenced by linter version bumps.

---

## Optimization 5 — Pre-warm the module cache in a primer CI job

**Problem:** In a multi-job CI pipeline (lint, test, build, integration), every job hits a cold cache independently and races to fetch the same modules. The first job to run pays the download cost; the others sometimes still re-download because cache restore happens in parallel.

**Before:**
```
lint        ── fetches modules
test        ── fetches modules
build       ── fetches modules
integration ── fetches modules
```
Four fetches for the same `go.sum`.

**After:**
```
primer      ── runs `go mod download` and uploads cache
  └── lint, test, build, integration  (depend on primer, restore cache)
```
The primer job downloads once and seeds the shared cache. Downstream jobs `needs: primer` and restore from it.

**Gain:** Removes redundant fetches, smoothes proxy load, and makes downstream job timing predictable. On wide pipelines this saves 30–120 s per run.

---

## Optimization 6 — Use `replace` for a tiny local fork instead of waiting on upstream

**Problem:** Upstream has a one-line bug or a missing `if err != nil`. You file an issue, send a PR, and now you are blocked on a maintainer who is on holiday. Forking the whole project and rewriting imports is overkill for a two-character patch.

**Before:** A `// TODO: waiting for upstream PR #482` comment, plus a fragile workaround in your own code.

**After (`go.mod`):**
```
require github.com/upstream/lib v1.4.2

replace github.com/upstream/lib => github.com/acme/lib v1.4.2-acme.1
```
Push the patched fork to your own org, tag a pseudo-version, and `replace` it in. When upstream merges, drop the `replace` and bump the version.

**Caveat:** `replace` directives in *libraries* are ignored by consumers, so this is appropriate in applications and final binaries, not in modules others import.

**Gain:** Unblocks shipping immediately without owning a full fork. The `replace` line documents exactly what you swapped, so reverting is a one-line PR later.

---

## Optimization 7 — Reduce binary size by avoiding heavy transitive deps

**Problem:** Importing a single helper from `k8s.io/client-go`, `aws-sdk-go-v2`, or `google.golang.org/api` can pull in hundreds of MB of transitive code and balloon your binary. Many CLIs ship at 80–150 MB for no good reason.

**Before:**
```go
import "k8s.io/client-go/kubernetes"
// just to read one field from a kubeconfig
```
Binary: 95 MB. Build: 40 s cold.

**After:**
```go
import "k8s.io/client-go/tools/clientcmd"
// or even: parse the kubeconfig YAML yourself with sigs.k8s.io/yaml
```
Or for AWS: prefer `aws-sdk-go-v2/service/<just-the-one>` over the umbrella SDK; for Google, prefer the specific generated client over `google.golang.org/api`.

Inspect what you actually pull in:
```bash
go build -o app ./cmd/app
go tool nm -size app | sort -k1 -h | tail -50
go mod why -m k8s.io/api
```

**Gain:** Trimming a single umbrella SDK can cut binary size by 30–70% and shave seconds off cold builds. Smaller images mean faster pulls in Kubernetes, which compounds across every pod start.

---

## Optimization 8 — Bulk-upgrade quarterly to amortise migration cost

**Problem:** Letting dependencies drift for a year, then doing a panic upgrade because of a CVE, is the worst of all worlds: a giant diff, multiple breaking changes interleaved, and no time to test any of them carefully.

**Before:** "We'll upgrade when we have time." Two years later, jumping `gorm` v1 → v2 plus `prometheus/client_golang` plus `grpc-go` in one PR.

**After (scheduled upgrade window, every quarter):**
```bash
go get -u ./...
go mod tidy
go test ./...
go vet ./...
govulncheck ./...
```
Land the resulting PR with full attention. Triage breaking changes one at a time. Tag a release.

**Gain:** Each quarterly upgrade touches a small, manageable set of changes. CVE response becomes a normal-day activity instead of a fire drill.

---

## Optimization 9 — Use Renovate or Dependabot for small, frequent dep PRs

**Problem:** Manual upgrades batch many changes together. Even quarterly windows can produce 40-line `go.mod` diffs that no one wants to review carefully.

**Before:** Engineers click "Update all" once per quarter and approve a wall of yellow.

**After (`renovate.json`):**
```json
{
  "extends": ["config:base"],
  "packageRules": [
    { "matchUpdateTypes": ["patch"], "automerge": true },
    { "matchUpdateTypes": ["minor"], "automerge": false, "groupName": "minor deps" }
  ],
  "schedule": ["before 6am on monday"]
}
```
Each direct dependency gets its own PR. Patch versions auto-merge once CI is green; minors are reviewed weekly.

**Gain:** Reviewers see one library at a time, with a focused changelog link. Regressions are bisected to a specific PR instead of a megabundle. Mean-time-to-patch on CVEs drops from weeks to days.

---

## Optimization 10 — Use `govulncheck -mode=binary` on built artifacts

**Problem:** Running `govulncheck ./...` on source is great in CI but slow on large monorepos because it re-analyses every package. For release-time scanning of already-built binaries, source mode is wasted work.

**Before (CI release stage):**
```bash
govulncheck ./...
# re-analyses every package, every time
```

**After:**
```bash
go build -trimpath -o ./bin/app ./cmd/app
govulncheck -mode=binary ./bin/app
```
Binary mode looks at the symbols actually linked into the artifact and reports only vulnerabilities in *reachable* code paths.

**Gain:** Faster scan, lower false-positive rate, and the report describes exactly what shipped — not what *could* have shipped if every package were imported.

---

## Optimization 11 — Pin tools via `Makefile + go install`, not at runtime

**Problem:** A `make generate` step that runs `go install some/heavy/tool@latest` on every invocation re-downloads and re-builds the tool every time, often pulling a different version because `@latest` drifts.

**Before (`Makefile`):**
```make
generate:
	go install github.com/swaggo/swag/cmd/swag@latest
	swag init
```
Slow, non-deterministic, network-bound.

**After:**
```make
SWAG := $(shell go env GOPATH)/bin/swag
SWAG_VERSION := v1.16.3

$(SWAG):
	go install github.com/swaggo/swag/cmd/swag@$(SWAG_VERSION)

generate: $(SWAG)
	$(SWAG) init
```
The tool is installed once at the pinned version and reused until you bump it.

**Gain:** Repeat `make generate` calls drop from 15–30 s to under a second. Builds become reproducible across machines.

---

## Optimization 12 — Eliminate transitively-pulled major-version pairs

**Problem:** When two of your dependencies pull `foo v1` and `foo/v2`, both end up linked into your binary. This is legal in Go's module system but wastes binary space and can hide subtle bugs where state from "the same library" is actually two parallel universes.

**Before:**
```bash
$ go mod graph | grep 'github.com/foo'
yourapp github.com/foo v1.8.0
yourapp github.com/bar v0.5.0
github.com/bar v0.5.0 github.com/foo/v2 v2.1.0
```
Both major versions are compiled in.

**After:** Identify duplicates with:
```bash
go list -m all | awk '{print $1}' | sed 's,/v[0-9]*$,,' | sort | uniq -d
go mod graph | grep ' v2 '   # quick eyeball
```
Then either upgrade your direct dependency to use v2, or downgrade the indirect dependency, or open a PR upstream to align versions.

**Gain:** Smaller binary, simpler debugging, fewer "why is the cache empty" mysteries caused by two copies of the same library holding separate state.

---

## Optimization 13 — Vendor only when offline determinism is genuinely required

**Problem:** `go mod vendor` is reflexively turned on by teams who do not actually need it. The `vendor/` tree bloats the repo, slows clones, makes every dep upgrade a giant diff, and creates merge conflicts on third-party code you never wrote.

**Before:**
```bash
go mod vendor
git add vendor/
# 80 MB of third-party code committed
```

**After (no vendor; rely on cached proxy + `go.sum`):**
```bash
# go.sum + GOSUMDB protect against tampering
# CI cache (Optimization 3) handles speed
```

**When to keep vendoring:**
- Air-gapped builds with no proxy access at all.
- Regulated environments that audit every shipped byte.
- You need byte-for-byte reproducibility against a tagged snapshot of every dep.

**Gain (when you skip it):** smaller repo, faster `git clone`, smaller PR diffs on dep bumps, less merge conflict surface, and `go mod download` from a cached proxy is already deterministic for practical purposes.

---

## Benchmarking and Measurement

Optimization without measurement is folklore. For third-party-package work, the most useful signals are:

```bash
# Cold build time after wiping caches
go clean -cache -modcache
time go build ./...

# Size of the module graph
go list -m all | wc -l
go mod graph | wc -l

# Final binary size (and what is in it)
go build -trimpath -ldflags='-s -w' -o ./bin/app ./cmd/app
ls -lh ./bin/app
go tool nm -size ./bin/app | sort -k1 -h | tail -30

# Why is this dep here?
go mod why -m github.com/some/lib

# Vulnerability scan time
time govulncheck ./...
time govulncheck -mode=binary ./bin/app
```

Track these numbers before and after each change. If a "fix" does not move them measurably, it was not a fix — it was a vibe.

---

## When NOT to Optimize

- **Prototype or spike:** Use whatever library gets you to a working demo fastest. Re-evaluate when the project has a heartbeat.
- **Single small binary, run once a day:** A 50 MB binary that runs as a cron is not worth a week of dependency surgery.
- **Library with three users:** Worry about your own surface area and stability before policing your transitive graph.
- **Already meets its budget:** If cold build is 4 s, binary is 12 MB, and CVE response is < 24 h, stop. Move on to a real problem.
- **You are about to rewrite the service anyway:** Don't shave grams off something you're about to throw away.

---

## Summary

Adding a third-party package is one of the cheapest decisions a Go developer makes — and one of the most expensive over time. Each `require` entry pays interest in cold-build seconds, binary megabytes, CVE noise, and migration churn. The optimizations above are not about avoiding dependencies; they are about spending the dependency budget where it actually buys leverage (a battle-tested driver, a real cryptographic primitive) and refusing to spend it where stdlib or a fifty-line helper would do. Measure before, measure after, and keep `go.mod` honest.
