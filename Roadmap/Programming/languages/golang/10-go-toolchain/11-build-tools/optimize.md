# Build Tools — Optimization

Build orchestration is mostly about **not doing work twice**. These exercises measure the cost of common waste and show the fix. Numbers are illustrative; measure on your own setup with `time`.

---

## Exercise 1: Share `GOCACHE` across Make targets

**Before** — each Make target invokes `go build`/`go test` in a sub-shell that doesn't inherit `GOCACHE`/`GOMODCACHE` consistently, or CI wipes them between jobs.

```makefile
build:
	go build ./...
test:
	go test ./...
```

CI cold cache: ~45s build + 30s test = 75s per pipeline.

**After** — set `GOCACHE` and `GOMODCACHE` to stable paths and persist them across CI jobs:

```makefile
export GOCACHE  ?= $(CURDIR)/.cache/go-build
export GOMODCACHE ?= $(CURDIR)/.cache/go-mod

build:
	go build ./...
test:
	go test ./...
```

```yaml
# .github/workflows/ci.yml
- uses: actions/cache@v4
  with:
    path: |
      .cache/go-build
      .cache/go-mod
    key: go-${{ runner.os }}-${{ hashFiles('go.sum') }}
```

| Metric | Cold | Warm |
|--------|------|------|
| Build wall time | 45s | 4s |
| Test wall time | 30s | 6s |

---

## Exercise 2: `goreleaser --snapshot` for dry runs

**Before** — to "test the release pipeline" the team pushes a real tag, watches CI, deletes the GitHub release on failure, force-pushes. Each iteration takes 5–10 minutes plus pollution.

**After** — run the whole pipeline locally without publishing:

```bash
goreleaser release --snapshot --skip=publish,sign --clean
```

| Metric | Push-tag iteration | `--snapshot` iteration |
|--------|---------------------|------------------------|
| Wall time | 6 min | 90s |
| Side effects | Real (Git tag, GH release) | None (just `dist/`) |
| Safe to repeat | No | Yes |

Use `--snapshot` until the config is right; then push the tag once.

---

## Exercise 3: `ko` layer caching

**Before** — every CI run rebuilds the same base image layers from scratch because `ko` is invoked in a fresh container with no cache.

**After** — share the OCI layout cache directory between CI runs:

```bash
export KO_DATA_DATE_EPOCH=$(git log -1 --format=%ct)
ko build --bare \
  --image-refs=image-refs.txt \
  --tarball=image.tar \
  ./cmd/server
```

```yaml
- uses: actions/cache@v4
  with:
    path: ~/.cache/ko
    key: ko-${{ runner.os }}-${{ hashFiles('go.sum') }}
```

`ko` will reuse cached base image manifests and Go build cache.

| Metric | No cache | With cache |
|--------|----------|------------|
| `ko build` wall time | 35s | 8s |

Bonus: setting `KO_DATA_DATE_EPOCH` to the commit time keeps image timestamps reproducible across rebuilds.

---

## Exercise 4: `mage -compile` to precompile the build binary

**Before** — every `mage <target>` call hashes the magefile sources and re-checks the cache. Cheap, but on a cold cache it compiles the build binary from scratch (~1s).

**After** — precompile and ship the binary, then run it directly:

```bash
mage -compile ./bin/build       # one-time
./bin/build test                # subsequent runs
```

| Metric | `mage test` cold | `./bin/build test` |
|--------|------------------|--------------------|
| Wrapper overhead | ~1.0s | ~5ms |

In CI, precompile once at the start of the job and reuse for every subsequent step. Or check `./bin/build` into the repo for environments where installing `mage` itself is friction.

---

## Exercise 5: Parallel `task` deps

**Before** — a Taskfile lists steps under `cmds:`, forcing sequential execution:

```yaml
ci:
  cmds:
    - task: lint
    - task: test
    - task: build
```

```bash
$ time task ci
# 4s + 12s + 8s = 24s
```

**After** — declare independent steps as `deps:`, which `task` runs in parallel:

```yaml
ci:
  deps: [lint, test, build]
```

```bash
$ time task ci
# max(4, 12, 8) ≈ 12s
```

| Metric | Sequential | Parallel deps |
|--------|------------|---------------|
| Wall time | 24s | 12s |
| CPU utilisation | 1 core | up to N cores |

Only do this for **independent** steps. If `build` depends on `generate`, keep that edge: `build: { deps: [generate] }`.

---

## Exercise 6: Drop `bazel` for a small project

A 5-person Go-only team adopted `bazel rules_go` "for the future" and now spends a noticeable fraction of time fighting `BUILD.bazel` files, broken `gopls`, and CI flakes.

**Before** — `bazel build //... && bazel test //...` runs 1.5 min cold, 25s warm, plus weekly "gazelle didn't pick up my new import" tickets.

**After** — uninstall `bazel`, use `go build ./... && go test ./...` and a 30-line Makefile. Migrate any cross-machine cache benefit to GitHub Actions `actions/cache`.

| Metric | `bazel build` | `go build` |
|--------|---------------|-----------|
| Cold wall | 1.5 min | 35s |
| Warm wall | 25s | 3s |
| `BUILD.bazel` files to maintain | dozens | 0 |
| `gopls` works out of the box | Mostly | Yes |
| Onboarding doc length | 3 pages | 1 paragraph |

The exercise: be willing to **remove** a build tool when its cost no longer matches its benefit. `bazel` is great at giant scale and a tax at small scale.

---

## Exercise 7: Separate `make generate` from `make build`

**Before** — `make build` always runs `buf generate` and `go generate ./...` first, even when no `.proto` or generator source has changed. Adds 4s to every iteration.

```makefile
build: generate
	go build ./...
generate:
	buf generate
	go generate ./...
```

**After** — separate the targets so generators run only when invoked or when their sources actually change. Commit generated files; let CI verify they are in sync.

```makefile
.PHONY: build generate

build:
	go build ./...

generate:
	buf generate
	go generate ./...
```

```yaml
# CI guard
- run: make generate
- run: git diff --exit-code   # fails PR if generated files are stale
```

| Metric | Always-generate | Generate-on-demand |
|--------|-----------------|--------------------|
| Inner-loop `make build` | 6s | 2s |
| Risk of stale generated code | low (always runs) | guarded by CI diff |

---

## Exercise 8: Pin the build tools themselves

**Before** — CI installs `goreleaser`, `ko`, `buf` via `@latest`. Builds drift week to week without any source change.

**After** — pin every tool by version. Use the `tools` directive in `go.mod` (Go 1.24+), a `tools.go` file, or an explicit `go install tool@vX.Y.Z` step in CI.

```bash
go install github.com/goreleaser/goreleaser/v2@v2.5.0
go install github.com/google/ko@v0.17.1
go install github.com/bufbuild/buf/cmd/buf@v1.45.0
```

| Metric | `@latest` | Pinned |
|--------|-----------|--------|
| Build reproducibility across days | Drifts | Stable |
| Surprise CI breakages | "Why did Tuesday's build fail?" | Only when you bump |
| Audit story for compliance | None | Clean |

Bonus: pinning is also a measurable performance improvement — `@latest` re-resolves on every install; pinned versions hit the module cache directly.

---

## Measurement checklist
- [ ] Persist `GOCACHE` and `GOMODCACHE` across CI jobs.
- [ ] Use `goreleaser --snapshot` for iteration; reserve real releases for tags.
- [ ] Cache `~/.cache/ko` and pin base image by digest.
- [ ] Precompile `mage` with `mage -compile`.
- [ ] Declare independent `task` steps as `deps:`, not sequential `cmds:`.
- [ ] Reassess whether `bazel` still earns its keep on your project.
- [ ] Decouple `generate` from `build`; guard staleness in CI.
- [ ] Pin every external build tool by version; never use `@latest` in CI.
