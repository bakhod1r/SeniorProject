# `go mod vendor` — Optimization

> Honest framing first: `go mod vendor` is a copy operation. It walks the module graph, materialises the exact files Go needs to compile, and writes them into `vendor/`. The command itself is rarely the bottleneck — the slow part is whatever fetched the modules into the cache in the first place. What is genuinely worth optimizing is the *workflow* around vendoring: when you vendor, how CI consumes `vendor/`, how the `vendor/` tree interacts with Docker layers, how it lands in PR diffs, and whether you should be vendoring at all for this particular project.
>
> Each entry below states the problem, shows a "before" setup, an "after" setup, and the realistic gain. The closing sections cover measurement and the cases where vendoring is the wrong tool.

---

## Optimization 1 — Vendor for hermetic CI builds

**Problem:** Cold-cache CI runners spend tens of seconds (sometimes minutes) on `go mod download`: TLS handshakes to `proxy.golang.org`, sumdb lookups, retries against rate-limited origins. Every job pays this tax even though the dependency set has not changed.

**Before:**
```yaml
- uses: actions/setup-go@v5
  with: { go-version: '1.23' }
- run: go build ./...        # pulls 150 modules from the proxy
```
On a cold runner the network phase dominates wall-clock time.

**After:**
```yaml
- uses: actions/setup-go@v5
  with: { go-version: '1.23' }
- run: go build -mod=vendor ./...
```
With `vendor/` checked in, Go reads dependencies straight off disk. No DNS, no proxy, no sumdb.

**Expected gain:** Cold-cache build phase drops from 30–120 seconds to 0 seconds of network. The remaining time is pure compile, which is what you actually want to measure. Equally important: the build no longer fails when the proxy is down.

---

## Optimization 2 — Combine `-mod=vendor` with Docker build cache

**Problem:** A Dockerfile that runs `go mod download` inside `RUN` invalidates its layer every time `go.sum` changes — and many teams arrange the Dockerfile so that any source change re-downloads modules.

**Before:**
```dockerfile
FROM golang:1.23 AS build
WORKDIR /src
COPY . .
RUN go build -o /app ./cmd/api
```
Any edit to any file busts the cache and re-downloads every module.

**After:**
```dockerfile
FROM golang:1.23 AS build
WORKDIR /src
COPY go.mod go.sum ./
COPY vendor/ ./vendor/
COPY . .
RUN go build -mod=vendor -o /app ./cmd/api
```
The `vendor/` layer is cached as long as `vendor/` itself does not change, and `go build` skips downloads entirely.

**Expected gain:** Image rebuilds on source-only changes go from "download phase + compile" to "compile only." Typical savings: 20–60 seconds per image build, multiplied across every developer push.

---

## Optimization 3 — Cache `vendor/` and `go.sum` together in CI

**Problem:** Some teams vendor but still let CI re-extract `vendor/` from a clean checkout each job, defeating the speed advantage of vendoring on cache hits.

**Before:**
```yaml
- uses: actions/checkout@v4
- run: go mod vendor          # regenerate every job
- run: go build -mod=vendor ./...
```
Regenerating `vendor/` on every CI run defeats the purpose of having it.

**After:**
```yaml
- uses: actions/checkout@v4
- uses: actions/cache@v4
  with:
    path: vendor
    key: vendor-${{ hashFiles('go.sum') }}
- run: test -d vendor || go mod vendor
- run: go build -mod=vendor ./...
```
The cache is keyed on `go.sum`. When dependencies are unchanged, `vendor/` is restored from cache and `go mod vendor` is skipped entirely.

**Expected gain:** CI time on dependency-stable PRs drops to compile-only. Cache hits are nearly instantaneous; cache misses still rebuild deterministically.

---

## Optimization 4 — Layer ordering for multi-stage Dockerfiles

**Problem:** When `vendor/` is copied alongside source code in one big `COPY . .`, Docker invalidates the cached vendor layer on every source edit. The image rebuild re-tars and re-hashes hundreds of MB of third-party code that never changed.

**Before:**
```dockerfile
FROM golang:1.23 AS build
WORKDIR /src
COPY . .
RUN go build -mod=vendor -o /app ./cmd/api
```
Editing `cmd/api/main.go` invalidates the layer that contains both the code and `vendor/`.

**After:**
```dockerfile
FROM golang:1.23 AS build
WORKDIR /src
# Rare changes — cached aggressively
COPY go.mod go.sum ./
COPY vendor/ ./vendor/
# Frequent changes — only the small layer is rebuilt
COPY cmd/    ./cmd/
COPY internal/ ./internal/
COPY pkg/   ./pkg/
RUN go build -mod=vendor -o /app ./cmd/api
```
The `vendor/` layer is reused across thousands of source-only builds.

**Expected gain:** On a vendor of ~80 MB across ~150 modules, layer reuse saves 5–15 seconds per build (filesystem copy + hash) plus push/pull bandwidth on every CI tag. The compounding effect across dev loops is substantial.

---

## Optimization 5 — Skip vendoring on cloud-native CI with a fast proxy

**Problem:** Vendoring is not free. It bloats `git clone`, slows code review, doubles diff churn on dependency bumps, and forces your team to learn one more workflow. On modern CI with module caching and a healthy GOPROXY, the speed argument for vendoring largely evaporates.

**Before:**
```bash
go mod vendor
git add vendor/    # 80 MB committed; clones balloon
```
You pay the vendoring tax even though your CI already caches `GOMODCACHE` and your proxy resolves in milliseconds.

**After:**
```yaml
- uses: actions/setup-go@v5
  with:
    go-version: '1.23'
    cache: true
    cache-dependency-path: go.sum
- run: go build ./...
```
Drop `vendor/` entirely. Rely on `setup-go`'s built-in cache plus the proxy.

**When to vendor anyway:** air-gapped builds, regulated industries that audit shipped bytes, or genuinely flaky network paths to the proxy.

**Expected gain (when you skip vendoring):** smaller repo, smaller PR diffs, no merge conflicts in `vendor/`, faster `git clone`, and one fewer concept for new contributors to learn.

---

## Optimization 6 — Prove offline determinism with `GOPROXY=off`

**Problem:** Teams vendor "for hermetic builds" but never actually verify that the build is hermetic. A stray import can sneak in and quietly fall back to the proxy, defeating the guarantee.

**Before:**
```bash
go build -mod=vendor ./...    # might still hit network for missing deps
```
If `vendor/` is incomplete, Go falls back to fetching from the proxy and the build silently succeeds — masking a vendoring bug.

**After:**
```bash
GOPROXY=off GOFLAGS='-mod=vendor' go build ./...
GOPROXY=off GOFLAGS='-mod=vendor' go test ./...
```
With `GOPROXY=off`, any missing dependency in `vendor/` produces an immediate, loud error. CI then catches incomplete vendoring before it reaches production.

**Expected gain:** A truly hermetic guarantee. The "vendor for offline determinism" promise becomes verifiable rather than aspirational. Bug reports of the form "the build fails on the air-gapped runner" go away.

---

## Optimization 7 — Prune unused-but-listed direct dependencies

**Problem:** `vendor/` size is largely a function of the module graph, but a surprising amount comes from direct imports that you no longer use. They linger in `go.mod`, drag in their transitive tree, and inflate the vendor tree.

**Before:**
```
go.mod  →  require github.com/old/lib v1.4.2  // unused since refactor
vendor/github.com/old/lib/...                   // 12 MB of dead code
```
The dependency was abandoned in code but never removed from `go.mod`.

**After:**
```bash
go mod tidy                    # drops unused requires
go mod why github.com/some/lib # justify each require
go mod vendor                  # rewrites a smaller tree
```
Pair this with a periodic audit: `go list -m all | wc -l` before and after.

**Expected gain:** On many repos `go mod tidy` followed by `go mod vendor` shrinks `vendor/` by 10–30%, and the Docker image and clone times shrink with it. The PR diff also becomes more honest about what the project actually depends on.

---

## Optimization 8 — Sub-module-aware vendoring in monorepos

**Problem:** A single `vendor/` at the root of a monorepo unions every dependency across every service. One service that needs a heavy AWS SDK forces the whole repo to ship it.

**Before:**
```
mono/
  go.mod              // module github.com/acme/all
  vendor/             // 250 MB, includes AWS SDK, GCP SDK, etc.
  cmd/api/
  cmd/cron/
  cmd/cli/            // tiny tool, doesn't need cloud SDKs
```
Every service inherits every transitive dep.

**After (per-service modules, per-service vendor):**
```
mono/
  api/
    go.mod
    vendor/           // only what api uses
  cron/
    go.mod
    vendor/
  cli/
    go.mod            // no vendor needed, tiny dep set
```
Each module owns the tree it actually needs.

**Expected gain:** Smaller per-service Docker images, fewer false-positive CVE alerts (tools scan only what each service ships), and faster per-service CI. Caveat: only worth it once the monorepo is genuinely large; for small repos the operational cost outweighs the savings.

---

## Optimization 9 — Don't re-vendor on every PR

**Problem:** A `make vendor` step in CI that always runs produces a noisy diff on PRs that touch only application code. Reviewers tune it out, real vendor changes hide in the noise, and the PR turns red for the wrong reason.

**Before:** Every PR runs `go mod vendor` and trips a "files changed" check, even when only `cmd/api/handler.go` was edited.

**After (run vendor only when needed):**
```yaml
- name: Detect dependency change
  id: deps
  run: |
    git diff --name-only origin/main... | \
      grep -E '^(go\.mod|go\.sum)$' && echo "changed=true" >> $GITHUB_OUTPUT || true
- name: Re-vendor
  if: steps.deps.outputs.changed == 'true'
  run: go mod vendor
- name: Verify clean
  if: steps.deps.outputs.changed == 'true'
  run: git diff --exit-code -- vendor/
```
Vendor is only revalidated when `go.mod` / `go.sum` actually changed.

**Expected gain:** Faster CI on most PRs (skips the vendor step entirely), cleaner reviews, and a reliable signal when vendor *should* have been updated but was not.

---

## Optimization 10 — Verify vendor consistency in parallel with the build

**Problem:** Verifying vendor (`go mod vendor` then checking for diffs) is sequenced before the build, padding the critical path even though the two steps are independent.

**Before:**
```yaml
jobs:
  build:
    steps:
      - run: go mod vendor
      - run: git diff --exit-code -- vendor/   # 5–10s
      - run: go build -mod=vendor ./...        # 60s
```
Total: vendor-check + build, in series.

**After (matrix):**
```yaml
jobs:
  build:
    steps:
      - run: go build -mod=vendor ./...
  verify-vendor:
    steps:
      - run: go mod vendor
      - run: git diff --exit-code -- vendor/
```
Both jobs run on separate runners and finish in parallel.

**Expected gain:** Wall-clock CI time drops to `max(build, verify)` instead of `build + verify`. Typically saves 5–15 seconds per pipeline; more on busy queues where queueing is the bottleneck.

---

## Optimization 11 — Separate vendor commits from code commits

**Problem:** A PR that bumps a dependency *and* changes code lands as one giant diff. The vendor noise (thousands of files) drowns the actual change. Reviewers cannot separate "did the dependency upgrade introduce a regression" from "did the code change make sense."

**Before:** One commit titled "upgrade lib + refactor handler" with 3,000 changed files in `vendor/` plus 30 lines in `internal/api/`.

**After:**
```bash
# Commit 1: dependency bump + vendor regeneration only
go get github.com/some/lib@v2.0.0
go mod tidy
go mod vendor
git add go.mod go.sum vendor/
git commit -m "deps: bump some/lib to v2.0.0"

# Commit 2: code changes that consume the new API
git add internal/api/
git commit -m "api: switch to lib v2 API surface"
```
Reviewers can fold the first commit's vendor diff away (`git diff -- ':!vendor'`) and focus on real code in the second.

**Expected gain:** Faster, more accurate code review. Bisecting later is also dramatically easier — you can revert a dependency bump independently of the code that consumes it.

---

## Optimization 12 — Surface vendor-only diffs cleanly with git tooling

**Problem:** Reviewers and authors lose minutes scrolling past vendor diffs to find the real change. CI logs that `git diff` everything are unreadable.

**Before:** `git diff main` returns 50,000 lines, 49,500 of them in `vendor/`.

**After (review patterns):**
```bash
# What changed outside vendor/?
git diff main -- ':!vendor'

# What changed *only* inside vendor/?
git diff --stat main -- vendor/

# Show vendor changes summarised, real changes in full
git diff main -- ':!vendor'
git diff --stat main -- vendor/
```
Add a repo-level `.gitattributes` to mark `vendor/` as generated so platforms like GitHub collapse it by default:
```
vendor/** linguist-generated=true
```

**Expected gain:** Faster reviews, less reviewer fatigue, and fewer PRs that get "approved" without anyone actually looking at the substantive diff.

---

## Optimization 13 — For library projects, prefer NOT vendoring

**Problem:** Library authors sometimes commit `vendor/` "to help consumers." Consumers do not benefit — Go ignores a library's `vendor/` when building consuming code. Meanwhile, every consumer pays a clone-size and review-noise tax.

**Before (library `go.mod` + committed `vendor/`):**
```
mylib/
  go.mod
  vendor/         // 40 MB ignored by every consumer
```
Consumers' `go get github.com/acme/mylib` does not use this `vendor/` at all; it just makes the source tarball larger.

**After (no vendor in libraries):**
```
mylib/
  go.mod
  go.sum
  // no vendor/
```
Consumers fetch normally; their own build environment decides whether to vendor.

**When library vendoring is justified:** essentially never. Reproducible test runs in the library's own CI can use `go mod download` plus a cache; no need to commit the tree.

**Expected gain:** Smaller library distribution, faster `go get` for consumers, simpler library CI, and one fewer thing to keep in sync.

---

## Optimization 14 — Re-vendor on a schedule to pick up CVE fixes

**Problem:** A repo that vendored once and never re-vendored is frozen in time. Patch-level CVE fixes in transitive dependencies do not arrive until somebody manually runs `go mod tidy && go mod vendor`. That "somebody" is usually nobody.

**Before:** `vendor/` last regenerated 14 months ago; CVE scanner flags 6 transitive vulnerabilities that have patched releases available.

**After (scheduled refresh):**
```yaml
# .github/workflows/refresh-vendor.yml
on:
  schedule:
    - cron: '0 6 1 * *'      # 06:00 UTC, first of each month
  workflow_dispatch:
jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version: '1.23' }
      - run: |
          go get -u=patch ./...
          go mod tidy
          go mod vendor
      - uses: peter-evans/create-pull-request@v6
        with:
          title: 'deps: monthly patch refresh'
          branch: deps/monthly-refresh
```
A bot opens a PR every month with patch-level upgrades and the regenerated `vendor/` tree.

**Expected gain:** CVE exposure window drops from "whenever someone notices" to roughly 30 days. The PR is small (patch-level only), reviewable, and reversible.

---

## Benchmarking and Measurement

Optimization without measurement is folklore. For vendoring workflows the most useful signals are:

```bash
# How long does generating vendor actually take?
time go mod vendor

# How big is the resulting tree?
du -sh vendor/
find vendor -type f | wc -l

# Verify hermetic / offline-only behaviour:
GOPROXY=off go build -mod=vendor ./...
GOPROXY=off go test  -mod=vendor ./...

# How long does a vendored cold build take vs a non-vendored cold build?
go clean -cache -modcache
time go build -mod=vendor ./...

# Compare against the proxy path
go clean -cache -modcache
time go build ./...

# CI level: track total job wall-clock and Docker layer cache hit rate
# over weeks. A "vendor optimization" that does not move those numbers
# is not an optimization.
```

Track these numbers before and after each change. Pay particular attention to two metrics: cold-cache CI build time (the headline gain from vendoring) and PR review latency on dependency bumps (the headline cost).

---

## When NOT to Vendor

Vendoring is a tool with real costs. It is the wrong default for many projects.

- **Small or solo projects:** the operational overhead — bigger clones, noisier diffs, an extra workflow to learn — outweighs the modest CI speedup. Use the module cache.
- **Library projects:** consumers ignore your `vendor/`. Committing it just bloats your distribution.
- **Cloud-native CI with a healthy proxy:** `actions/setup-go` with `cache: true` plus a fast `GOPROXY` already gives you most of the speed benefit without the diff churn.
- **Teams that will not maintain it:** a stale `vendor/` is worse than no vendor — it freezes you on outdated transitive versions while giving the *appearance* of determinism.
- **Projects on a slow connection but no air-gap requirement:** an internal Athens / JFrog Go proxy mirror solves the same problem without committing megabytes of third-party code.

Vendor when you have a concrete reason: air-gapped builds, regulatory audit of shipped bytes, byte-for-byte reproducibility against a snapshot, or a CI environment where the proxy is genuinely unreliable. Otherwise, lean on the module cache, the proxy, and CI caching — and spend the effort you would have spent maintaining `vendor/` on something else.

---

## Summary

`go mod vendor` is not slow; the workflows around it are. The wins come from treating `vendor/` as a *cache strategy*, not a habit: cache it in CI, layer it correctly in Docker, regenerate it only when dependencies actually change, separate vendor commits from code commits, prove hermeticity with `GOPROXY=off`, and refresh on a schedule for CVE hygiene. The biggest optimization, though, is upstream of all of these: deciding honestly whether your project needs to vendor at all. For most modern Go projects with a working proxy and CI cache, the answer is no — and the best optimization is to not vendor in the first place.
