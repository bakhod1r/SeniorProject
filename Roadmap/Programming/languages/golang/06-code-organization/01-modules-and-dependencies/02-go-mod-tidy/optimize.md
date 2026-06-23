# `go mod tidy` — Optimization

> Honest framing first: `go mod tidy` is not free. Unlike `go mod init`, which writes a single tiny file in well under a millisecond, `tidy` walks every package in the module, resolves the full transitive import graph, talks to the proxy and checksum database, and then rewrites `go.mod` and `go.sum`. On a small project that costs a few hundred milliseconds. On a large monorepo with hundreds of indirect dependencies, a cold tidy on a fresh CI runner can easily take 60 seconds or more.
>
> Worse, `tidy` runs in CI on every PR, often on every push, and is one of the most common reasons developers stare at a green-bar build for longer than they should. The diffs it produces are noisy, the network it uses is flaky, and the cost compounds across every contributor and every job.
>
> The optimizations below target the real performance and ergonomic surface around `go mod tidy`: the module cache, the proxy, the CI shape, the flags, the cadence, and the workflow. Each entry states the problem, shows a "before" setup, an "after" setup, and the realistic gain.

---

## Optimization 1 — Cache the module cache in CI keyed by `go.sum`

**Problem:** A fresh CI runner has no `GOMODCACHE`, so `go mod tidy` re-downloads every dependency from the proxy. For a project with 150–500 transitive modules, that is 30–90 seconds of pure network on every job, every PR, every push.

**Before (GitHub Actions):**
```yaml
- uses: actions/setup-go@v5
  with: { go-version: '1.23' }
- run: go mod tidy
- run: git diff --exit-code go.mod go.sum
```
No cache key, no restore. Cold every time.

**After:**
```yaml
- uses: actions/setup-go@v5
  with:
    go-version: '1.23'
    cache: true
    cache-dependency-path: '**/go.sum'
- run: go mod tidy
- run: git diff --exit-code go.mod go.sum
```
`setup-go` keys the module cache on a hash of `go.sum`. Tidy then resolves entirely from local disk except when dependencies actually changed.

**Gain:** A 60-second cold tidy becomes a 1–3 second warm tidy. On a busy repo this is the highest-impact change you can make.

---

## Optimization 2 — Use a fast, regional `GOPROXY` for cold-cache scenarios

**Problem:** Even with caching, cold misses happen — new dependencies, cache evictions, fresh runners. The default `proxy.golang.org` is fine globally but can be slow from some regions and rate-limits aggressive `direct` fallbacks against GitHub.

**Before:**
```bash
# default
unset GOPROXY
```
Cold tidy fetches from the public proxy, sometimes falls back to `direct`, occasionally hits GitHub's anonymous rate limit, and stalls.

**After (corporate / regional mirror):**
```bash
export GOPROXY=https://goproxy.example-corp.internal,https://proxy.golang.org,direct
```
Run an internal Athens, JFrog Artifactory, or Sonatype Nexus Go proxy that mirrors and caches modules close to the build farm.

**Gain:** Cold `go mod tidy` time often drops from 30–60 seconds to a few seconds. Also stabilises CI against external proxy outages and rate limits.

---

## Optimization 3 — Run tidy in parallel across a multi-module monorepo

**Problem:** A monorepo with 10–30 modules running tidy sequentially serialises an inherently parallel task. Each module's tidy is independent — there is no reason they cannot run together.

**Before:**
```bash
for mod in $(find . -name go.mod -not -path '*/vendor/*'); do
  (cd "$(dirname $mod)" && go mod tidy)
done
```
30 modules × 2 seconds each = 60 seconds wall clock.

**After (local, with `xargs -P`):**
```bash
find . -name go.mod -not -path '*/vendor/*' \
  | xargs -n1 -P8 -I{} sh -c 'cd "$(dirname {})" && go mod tidy'
```

**After (CI, matrix):**
```yaml
strategy:
  matrix:
    module: [api, worker, shared, cli, tools]
steps:
  - uses: actions/setup-go@v5
    with: { go-version: '1.23', cache: true,
            cache-dependency-path: ${{ matrix.module }}/go.sum }
  - run: cd ${{ matrix.module }} && go mod tidy
  - run: cd ${{ matrix.module }} && git diff --exit-code go.mod go.sum
```

**Gain:** Wall-clock tidy time drops to the slowest single module instead of the sum. On an 8-core machine with 30 small modules, expect a 4–6× speedup.

---

## Optimization 4 — Skip tidy in CI when no Go file changed

**Problem:** Running `go mod tidy && git diff --exit-code` on a PR that only touched `README.md` is pure waste. It eats CI minutes and queues up runners behind it.

**Before:**
```yaml
on: [pull_request]
jobs:
  tidy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: go mod tidy
      - run: git diff --exit-code go.mod go.sum
```
Runs unconditionally on every PR.

**After (path filter):**
```yaml
on:
  pull_request:
    paths:
      - '**/*.go'
      - '**/go.mod'
      - '**/go.sum'
      - '.github/workflows/tidy.yml'
```
Only runs the tidy job when something that could affect tidy actually changed.

**Gain:** Removes 100% of the tidy cost on docs-only and config-only PRs. On a repo where half of PRs are non-Go, that is a 50% reduction in tidy CI minutes.

---

## Optimization 5 — Use `-compat` to avoid pulling in extra transitive entries

**Problem:** Without a `-compat` flag, recent `go mod tidy` versions add `go.sum` entries needed for the previous Go release's tidy to remain idempotent. If you support only one Go version, those entries are dead weight that slow downloads and bloat the diff.

**Before:**
```bash
go mod tidy
# go.sum grows by dozens of extra hashes per indirect dep
```

**After (state your real minimum):**
```bash
go mod tidy -compat=1.21
```
Where `1.21` is the actual minimum Go version your `go.mod` declares.

**Gain:** Smaller `go.sum`, faster checksum verification on every build, smaller cache, smaller diff. On a repo with 200 indirect dependencies the file can shrink by 20–40%.

**Caveat:** If your library is consumed by older Go versions, leave the default. `-compat` is a tightening, not a free lunch.

---

## Optimization 6 — Pre-warm the module cache in a "primer" CI job

**Problem:** Multiple CI jobs (lint, vet, test, build, tidy-check) each start with a cold module cache, each waste time downloading the same modules, each compete for proxy bandwidth.

**Before:** Five jobs, five cold caches, five duplicate downloads.

**After (primer pattern):**
```yaml
jobs:
  primer:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version: '1.23', cache: true,
                cache-dependency-path: '**/go.sum' }
      - run: go mod download

  test:
    needs: primer
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version: '1.23', cache: true,
                cache-dependency-path: '**/go.sum' }
      - run: go test ./...
  # lint, vet, tidy-check follow the same pattern
```
The primer job populates the GitHub Actions cache; downstream jobs restore from it.

**Gain:** Cold downloads happen exactly once per `go.sum` change instead of N times. Save 30–60 seconds per downstream job on first runs.

---

## Optimization 7 — Disable sumdb for private modules with `GOPRIVATE`

**Problem:** When `go mod tidy` encounters a private module, it still tries to verify it against `sum.golang.org` by default, which either fails noisily, falls back slowly, or leaks module names to the public sumdb.

**Before:**
```bash
go mod tidy
# tidy stalls trying to talk to sum.golang.org for github.com/acme-corp/internal-lib
```

**After:**
```bash
export GOPRIVATE=github.com/acme-corp/*,gitlab.internal.example.com/*
# optionally also:
export GONOSUMCHECK=github.com/acme-corp/*
export GONOPROXY=github.com/acme-corp/*
```
Better still, set this in CI environment and in each developer's `~/.netrc`-driven shell.

**Gain:** Eliminates a 5–15 second remote round-trip per private module on every cold tidy, plus removes a class of intermittent failures and accidental information leaks.

---

## Optimization 8 — Vendor and use `-mod=vendor` for offline-deterministic CI

**Problem:** In environments where determinism matters more than disk size — air-gapped builds, regulated industries, very large CI fleets — running tidy in CI is both unnecessary and a source of flakiness.

**Before:**
```yaml
- run: go mod tidy
- run: go test ./...
```
Each CI job touches the proxy network. Outages break builds.

**After:**
```bash
# locally, when adding/updating a dep:
go mod tidy
go mod vendor
git add go.mod go.sum vendor/
```
```yaml
# CI:
- run: go test -mod=vendor ./...
```
Tidy is now a *human* command, not a CI command. CI becomes pure offline replay.

**Gain:** Eliminates network from the hot CI path. Builds are reproducible byte-for-byte from a single git SHA. Tradeoff: larger repo, larger diffs on dep bumps. Reach for this only when determinism is the priority.

---

## Optimization 9 — Periodically prune indirect bloat

**Problem:** Over time the `// indirect` section of `go.mod` accumulates dependencies of dependencies that you no longer actually need (because direct deps were removed but their transitive parents remain pinned). Tidy keeps them honest, but a dep that pulls in twenty indirects costs build time forever.

**Before:**
```
require (
    github.com/heavy/framework v1.4.0  // pulls in 80 indirects
    ...
)
require (
    // indirect block: 200+ entries
)
```

**After:**
- Periodically audit with `go mod why <dep>` to confirm each indirect is justified by some direct dep.
- Replace heavyweight libraries with smaller alternatives where the value is low (e.g. swap `github.com/sirupsen/logrus` for `log/slog` from stdlib).
- Re-run `go mod tidy` and observe `go.sum` shrink.

**Gain:** Smaller download set, faster cold tidy, smaller binaries, fewer CVE notifications to triage.

---

## Optimization 10 — Use `-mod=readonly` in CI; only `-mod=mod` when intentional

**Problem:** A misconfigured CI that runs builds with `-mod=mod` may silently rewrite `go.mod` and `go.sum` mid-build, producing flaky behaviour and hiding tidy problems until much later.

**Before:**
```bash
export GOFLAGS=-mod=mod
go test ./...
```
Builds quietly mutate the module file. Tidy errors become invisible.

**After:**
```bash
export GOFLAGS=-mod=readonly   # default in modern Go, but be explicit
go test ./...
# Separately, in a single dedicated step:
go mod tidy
git diff --exit-code go.mod go.sum
```
Builds fail fast if the module file would need to change; tidy is the only step allowed to rewrite it.

**Gain:** Tidy errors surface immediately at the dedicated step instead of being masked. No silent drift between local and CI. Faster diagnosis when something is wrong.

---

## Optimization 11 — Put `GOMODCACHE` on a fast disk for build farms

**Problem:** On shared build farms, `GOMODCACHE` defaults to `$HOME/go/pkg/mod`, which often lives on slow network storage. Every `go mod tidy` then walks thousands of small files over NFS.

**Before:**
```bash
# default GOMODCACHE on networked $HOME
go mod tidy   # 45 seconds
```

**After:**
```bash
export GOMODCACHE=/local/ssd/gomodcache   # ramdisk or NVMe
mkdir -p "$GOMODCACHE"
go mod tidy   # 5 seconds
```
On Kubernetes runners, mount an `emptyDir` with `medium: Memory`, or a node-local NVMe `hostPath`.

**Gain:** Tidy and download steps become I/O-bound on a fast medium instead of bottlenecking on the network filesystem. Realistic 5–10× speedup on multi-tenant farms.

---

## Optimization 12 — Use `go mod tidy -v` locally to find slow modules

**Problem:** "Tidy is slow" is not actionable. You need to know *which* modules are slow so you can pin, replace, or proxy-warm them.

**Before:**
```bash
time go mod tidy
# real 0m48.3s
# now what?
```

**After:**
```bash
GOFLAGS=-x time go mod tidy -v 2>&1 | tee tidy.log
# inspect proxy traffic and per-module work
grep 'GET ' tidy.log | sort | uniq -c | sort -rn | head
```
The `-v` flag prints removed modules; `-x` shows the underlying commands and HTTP traffic from the build system. Together they reveal which dependencies dominate the cost.

**Gain:** Turns "tidy is slow" into a list of three or four offenders you can fix specifically — usually one mis-tagged repo, one slow `direct` fallback, one accidentally-unused direct dep.

---

## Optimization 13 — Do not run tidy in tight pre-commit hooks

**Problem:** Pre-commit hooks should be sub-second. Running `go mod tidy` in a hook punishes every commit on every developer machine, especially on cold caches and large modules.

**Before (`.git/hooks/pre-commit`):**
```bash
#!/bin/sh
go mod tidy
git diff --exit-code go.mod go.sum
```
Every commit pays 5–60 seconds.

**After:**
```bash
#!/bin/sh
# fast checks only
go vet ./... || exit 1
gofmt -l . | tee /dev/stderr | (! grep .) || exit 1
# tidy is enforced in CI, not on every commit
```
Or, if a tidy-style check is genuinely required pre-commit:
```bash
# cheap version: just verify go.sum has not been hand-edited inconsistently
go mod verify
```

**Gain:** Commits stay snappy. Tidy correctness still gets enforced — just at the pull request boundary, where 60 seconds is acceptable, instead of inside the developer's flow.

---

## Optimization 14 — Sub-module-aware CI: run tidy only for touched modules

**Problem:** In a 30-module monorepo, running tidy for all 30 modules on every PR is wasteful when only one module changed. Even with parallelism, this multiplies CI cost and queue time.

**Before:**
```yaml
# matrix over all modules, always
strategy:
  matrix:
    module: [api, worker, shared, cli, tools, ...]
```
30 jobs spin up for a one-line change in `api`.

**After (compute the matrix dynamically):**
```yaml
jobs:
  changed:
    runs-on: ubuntu-latest
    outputs:
      modules: ${{ steps.detect.outputs.modules }}
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - id: detect
        run: |
          base=${{ github.event.pull_request.base.sha }}
          changed=$(git diff --name-only "$base"...HEAD \
            | awk -F/ '{print $1}' | sort -u \
            | jq -R . | jq -s -c .)
          echo "modules=$changed" >> "$GITHUB_OUTPUT"

  tidy:
    needs: changed
    if: needs.changed.outputs.modules != '[]'
    strategy:
      matrix:
        module: ${{ fromJson(needs.changed.outputs.modules) }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version: '1.23', cache: true,
                cache-dependency-path: ${{ matrix.module }}/go.sum }
      - run: cd ${{ matrix.module }} && go mod tidy
      - run: cd ${{ matrix.module }} && git diff --exit-code go.mod go.sum
```

**Gain:** A typical PR touches 1–2 modules. CI runs 1–2 tidy jobs instead of 30. Massive reduction in queue time, runner usage, and cost.

---

## Measurement

Optimization without measurement is folklore. For `go mod tidy` the most useful signals are:

```bash
# Cold tidy (clears caches first; will be slow):
go clean -modcache
time go mod tidy

# Warm tidy (typical CI path with cache restored):
time go mod tidy

# Where is tidy spending its time? Show the underlying tool calls and
# proxy traffic:
GOFLAGS=-x go mod tidy -v 2>&1 | tee tidy.log
grep -c '^GET '   tidy.log    # number of proxy round-trips
grep '^# get '    tidy.log    # high-level fetch operations

# How big is the dependency surface that tidy has to consider?
go list -m all | wc -l
go mod graph    | wc -l

# Track CI tidy step duration over time. If the median creeps up week
# over week, something is rotting — usually a new heavyweight indirect.
```

For monorepos, also measure tidy time per module separately. The slowest module dominates the parallel matrix wall clock and is where you should look first.

Track these numbers before and after each change. If a "fix" does not move them measurably, it was not a fix.

---

## When NOT to Optimize

- **Small projects (< 50 transitive deps):** tidy already runs in well under a second. Caching, proxy tuning, and dynamic matrices are pure overhead at this scale.
- **Single-module repos with low PR volume:** optimisation 14 (touched-module detection) is unnecessary; just run tidy unconditionally.
- **Solo / hobby projects:** running an internal Athens proxy or pinning `GOMODCACHE` to NVMe is over-engineering.
- **One-off experimental modules:** they will be deleted before optimisation pays off.
- **Everything to do with `go mod init` itself:** that command is free; optimise tidy, build, test, and the cache strategy instead.

---

## Summary

`go mod tidy` is one of the few module-system commands with real performance surface. The cost is dominated by the network (proxy and sumdb traffic) and the I/O around `GOMODCACHE`, not by the algorithm. The wins come from caching aggressively in CI, choosing a fast proxy, parallelising across modules, skipping tidy on PRs that cannot affect it, pruning indirect bloat, and keeping the slow path out of developer pre-commit hooks. None of these optimisations are needed on a small project — but on a busy monorepo they collectively turn a flaky 60-second step into a deterministic 2-second step, and that compounds across every contributor and every build for the lifetime of the repository.
