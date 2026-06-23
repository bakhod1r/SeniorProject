# `go mod init` — Optimization

> Honest framing first: `go mod init` itself writes a single tiny `go.mod` file in well under one millisecond. There is essentially nothing to micro-optimize at the command level — no algorithm to tune, no allocations to shave, no syscalls to batch. Trying to "make `go mod init` faster" is a non-problem.
>
> What *is* worth optimizing is everything the command sets in motion: the module boundary you pick, the import path you commit to, the CI cache around the module, the proxy you point Go at, the layout that `go list ./...` has to walk, and the path from `go mod init` to your developer's first successful compile. Those decisions, made in the first sixty seconds of a project, often dominate build and CI time for years afterward.
>
> Each entry below states the problem, shows a "before" setup, an "after" setup, and the realistic gain.

---

## Optimization 1 — Choose a module boundary that does not require constant re-splitting

**Problem:** Running `go mod init github.com/acme/everything` at the repo root and dumping all services, libraries, and tools into a single module is the most common mistake. Every `go build ./...` and `go test ./...` then compiles every package in the world — even when you changed one line in one service.

**Before:**
```
acme/
  go.mod                  // module github.com/acme/everything
  cmd/api/
  cmd/worker/
  cmd/cli/
  internal/...            // 1200 packages
```
A trivial change in `cmd/cli` forces the test cache to consider the whole tree.

**After (multi-module monorepo when scale demands it):**
```
acme/
  api/      go.mod        // module github.com/acme/api
  worker/   go.mod        // module github.com/acme/worker
  shared/   go.mod        // module github.com/acme/shared
```
CI per service touches only its own module. Cold `go build ./...` time on a large repo can drop from minutes to seconds for the changed module.

**Caveat:** Do *not* split prematurely. A single module is correct until you actually feel the pain. The optimization is "pick a boundary you can defend," not "always split."

---

## Optimization 2 — Pick a stable, tooling-friendly module path on day one

**Problem:** Renaming a module path later means every importer must update. A path with uppercase letters, unusual TLDs, or a vanity domain you do not control is a tax on every consumer.

**Before:**
```bash
go mod init github.com/Acme-Corp/MyProject_v2
```
Capitalised host segments work but confuse case-insensitive filesystems; underscores and the `_v2` suffix collide with Go's `/v2+` major-version convention; the path is hard to type.

**After:**
```bash
go mod init github.com/acme/myproject
```
Lowercase, short, no surprises. When v2 ships, the path becomes `github.com/acme/myproject/v2`, which Go recognises automatically.

**Gain:** Avoids a future repo-wide find-and-replace and a coordinated version bump from every downstream user.

---

## Optimization 3 — Cache the module download cache in CI

**Problem:** A fresh CI runner re-downloads every dependency on every build. For a medium project with ~150 transitive modules, that is tens of seconds to minutes per job, repeated thousands of times per week.

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
    cache: true                  # caches GOMODCACHE + build cache
    cache-dependency-path: go.sum
- run: go test ./...
```
`setup-go` keys on `go.sum`, so the cache is reused until dependencies actually change.

**Gain:** Typical CI job shrinks by 30–90 seconds on cache hit. On a busy repo this is the single highest-impact change you can make on day one.

---

## Optimization 4 — Point `GOPROXY` at a fast, geographically close mirror

**Problem:** The default `GOPROXY=https://proxy.golang.org,direct` is fine globally, but on a slow link or in a region with high latency to Google's proxy, cold downloads dominate first-build time. `direct` fallback can also hit GitHub rate limits.

**Before:**
```bash
# default — fine, but not always optimal
unset GOPROXY
```

**After (corporate / regional mirror):**
```bash
export GOPROXY=https://goproxy.example-corp.internal,https://proxy.golang.org,direct
export GOSUMDB=sum.golang.org
```
For an air-gapped CI environment, run an internal Athens or JFrog Go proxy that mirrors and caches modules.

**Gain:** First `go mod download` on a fresh machine often drops from 30+ seconds to a few seconds. Also stabilises CI against external proxy outages.

---

## Optimization 5 — Use `internal/` aggressively to limit the dependency blast radius

**Problem:** Every exported package is a public API. The more you export, the more downstream code can import internal helpers, the harder it becomes to refactor without breaking changes — which slows every future release.

**Before:**
```
mymod/
  utils/        // exported, importable by anyone
  helpers/
  parser/
```
A casual consumer imports `mymod/utils.StringMap`, and now you cannot rename it without a major version bump.

**After:**
```
mymod/
  internal/utils/
  internal/helpers/
  parser/        // genuinely public
```
The compiler enforces that only code under `mymod/...` can import `internal/...`.

**Gain:** Refactor freely without breaking external users. Smaller stable surface = fewer `/v2`, `/v3` migrations later. The optimization is on *future engineering time*, not CPU.

---

## Optimization 6 — Pick a `go` directive that balances features against consumer reach

**Problem:** Setting `go 1.23` on a library forces every consumer onto Go 1.23+. Setting `go 1.18` denies you generics ergonomics, range-over-func, structured logging, etc. Mismatched directives cause `go: module requires Go 1.23` errors in downstream CI.

**Before (library `go.mod`):**
```
module github.com/acme/lib
go 1.23
```
Locks out anyone still on 1.21 LTS-ish corporate stacks.

**After (library):**
```
module github.com/acme/lib
go 1.21
```
Plus a `toolchain go1.23.0` line if you want the *build* to use a newer toolchain while keeping the *language version* at 1.21 for consumers.

**Caveat:** For applications (not libraries), use the newest stable Go you can. The tension exists only for code others import.

**Gain:** Wider adoption, fewer upgrade-blocked consumers, fewer support tickets.

---

## Optimization 7 — Vendor only when you actually need the determinism

**Problem:** `go mod vendor` adds a `vendor/` tree that bloats the repo, slows clones, and forces every dependency update to produce a giant diff. People reach for it reflexively, often without need.

**Before:**
```bash
go mod init github.com/acme/svc
go mod vendor
git add vendor/
# 80 MB of third-party code in the repo
```

**After (no vendor, rely on module cache + checksums):**
```bash
go mod init github.com/acme/svc
# go.sum protects against tampering; CI cache handles speed
```

**When to keep vendoring:**
- Air-gapped builds with no proxy access.
- You need byte-for-byte reproducibility against a specific snapshot.
- Regulated environments that audit every shipped byte.

**Gain (when you skip it):** smaller repo, faster `git clone`, smaller PR diffs on dependency bumps, less merge conflict surface.

---

## Optimization 8 — Keep `go list ./...` fast by pruning the walk

**Problem:** Many tools (linters, codegen, IDEs) shell out to `go list ./...`. On a large monorepo with thousands of packages and large `testdata/` trees, this becomes the bottleneck.

**Before:**
```
mymod/
  cmd/...
  internal/...
  testdata/                  // huge fixture tree
  third_party/               // unused vendored experiments
```
`go list ./...` happily descends into both `testdata/` (it skips it for packages, but still stats files) and `third_party/`.

**After:**
- Keep `testdata/` directories small or move large fixtures into a separate, gitignored cache.
- Remove `third_party/` if unused; otherwise put it in its own module so `./...` does not cross it.
- Avoid deeply nested package trees where the same logic could live in three packages instead of thirty.

**Gain:** `go list ./...` time on a 2k-package repo can drop from several seconds to under a second, which compounds across every editor save and every CI step.

---

## Optimization 9 — Parallelise tests per module in a multi-module CI

**Problem:** A monolithic `go test ./...` in a multi-module repo serialises all tests, even when modules are independent.

**Before (`.github/workflows/test.yml`):**
```yaml
- run: |
    for mod in api worker shared; do
      (cd $mod && go test ./...)
    done
```
Sequential. One slow module blocks the rest.

**After (matrix):**
```yaml
strategy:
  matrix:
    module: [api, worker, shared]
steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-go@v5
    with: { go-version: '1.23', cache: true, cache-dependency-path: ${{ matrix.module }}/go.sum }
  - run: cd ${{ matrix.module }} && go test ./...
```
Each module runs on its own runner with its own cache key.

**Gain:** Wall-clock CI time drops to the slowest single module instead of the sum.

---

## Optimization 10 — Use `GOFLAGS` to set sticky build settings instead of repeating them

**Problem:** Every developer typing `go build -mod=mod -trimpath -ldflags=...` by hand is friction, and each mistyped flag causes inconsistent local vs CI behaviour.

**Before:**
```bash
go build -trimpath -mod=readonly ./...
go test  -mod=readonly -count=1 ./...
```
Repeated, easy to drift.

**After (`.envrc`, Makefile, or per-repo `go.env`):**
```bash
export GOFLAGS='-mod=readonly -trimpath'
```
Now `go build` and `go test` inherit consistent flags, and CI uses the same env.

**Gain:** Fewer "works on my machine" reports, deterministic builds, and `-mod=readonly` catches accidental `go.mod` mutations during normal builds.

---

## Optimization 11 — Optimise the path from `go mod init` to first compile

**Problem:** A new contributor clones the repo, runs `go mod init`-adjacent commands or `go build`, and waits. If their first build takes minutes, you have lost momentum on every onboarding.

**Before:**
- No `Makefile` or task runner.
- No documented `go.work` for multi-module repos.
- Dependencies not tidied; `go mod tidy` produces a diff on first run.

**After:**
```
repo/
  Makefile             # `make bootstrap` warms caches, runs go mod download
  go.work              # so `go build ./...` works across modules out of the box
  README.md            # one command to first green build
```
A `make bootstrap` target that runs `go mod download` and `go build ./...` once primes the build cache so subsequent edit-compile cycles are incremental.

**Gain:** First-build time is paid once, openly, instead of being amortised painfully across the contributor's first hour.

---

## Optimization 12 — Tidy and verify on every dependency change, not at release time

**Problem:** Letting `go.mod` and `go.sum` drift means a future `go mod tidy` produces a noisy, hard-to-review diff mixed with the actual change.

**Before:** A PR adds one dependency; six months later someone runs `go mod tidy` and the diff touches 40 unrelated lines.

**After (CI check):**
```yaml
- run: go mod tidy
- run: git diff --exit-code go.mod go.sum
```
Force every PR to land with a tidy module file. Optionally add `go mod verify` to catch checksum mismatches.

**Gain:** Dependency diffs stay surgical and reviewable. No "tidy day" cleanup PRs that no one wants to review.

---

## Optimization 13 — Avoid `replace` directives in published libraries

**Problem:** `replace` directives in a library's `go.mod` are ignored by consumers but still waste your time locally and confuse newcomers reading the file. In an application they are a useful tool; in a library they are a smell.

**Before (library `go.mod`):**
```
module github.com/acme/lib

require github.com/acme/dep v1.2.3
replace github.com/acme/dep => ../dep
```
Consumers see the `require` but never the `replace`, so behaviour silently differs between your machine and theirs.

**After:**
- Use `go.work` for local multi-module development.
- Remove `replace` from library `go.mod` before publishing.

```
// go.work at the repo root
go 1.23
use (
  ./lib
  ./dep
)
```

**Gain:** Local ergonomics without polluting the published module file. Consumers get exactly what was tested in CI.

---

## Optimization 14 — Pin a fast, deterministic toolchain with `toolchain`

**Problem:** "It built fine yesterday" with a different Go version. The Go 1.21+ `toolchain` directive lets you pin the exact Go used for builds, independent of what's on `PATH`.

**Before:**
```
module github.com/acme/svc
go 1.21
```
Any `go` on PATH is used; CI and local can diverge.

**After:**
```
module github.com/acme/svc
go 1.21
toolchain go1.23.2
```
Anyone with Go ≥ 1.21 will auto-fetch `go1.23.2` and use it for the build.

**Gain:** Deterministic build behaviour without forcing every contributor to manage Go versions manually. Especially useful in CI matrices.

---

## Benchmarking and Measurement

Optimization without measurement is folklore. For module-related work the most useful signals are:

```bash
# How long does a cold build actually take?
go clean -cache -modcache
time go build ./...

# How big is the dependency graph?
go list -m all | wc -l
go mod graph | wc -l

# How long does discovery take?
time go list ./... > /dev/null

# CI-level: track total job time and cache hit rate over weeks.
```

Track these numbers before and after each change. If a "fix" does not move them measurably, it was not a fix.

---

## When NOT to Optimize

- **Brand-new prototype:** ship single-module, default everything. Re-evaluate when the project has a heartbeat.
- **Solo project, small repo:** vendoring, multi-module splits, and proxy tuning are pure overhead at this scale.
- **Library with three users:** module path elegance matters; CI parallelism does not yet.
- **Anything `go mod init` itself does:** the command is already free. Optimize the world around it.

---

## Summary

`go mod init` is a one-shot setup command with no perf knobs. Its real cost is not the millisecond it takes to write `go.mod` — it is every decision you bake in at that moment: the module path, the boundary, the directive, the layout, the proxy, the cache strategy, the vendoring choice, the CI shape. Get those right early and the rest of the project compiles fast, tests fast, and refactors cheaply. Get them wrong and you pay a tax on every build, forever. Optimize the workflow, not the command.
