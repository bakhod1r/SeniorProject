# Build Orchestration & Cache — Professional

This page is about running Go builds at scale: CI pipelines, monorepos,
reproducible release artifacts, and shared/distributed caches. The mechanics
(action graph, content-addressed cache) are from the earlier tiers; here we make
them fast, correct, and reproducible in production.

## 1. Sharing GOCACHE across CI runs (the single biggest win)

A fresh CI container has an **empty** `GOCACHE`, so every job is a cold build
(compiles the std lib + all deps + your code from scratch). Persisting and
restoring `GOCACHE` between runs turns a multi-minute build into a near-instant
one when little changed.

```yaml
# GitHub Actions: actions/setup-go@v5 already caches GOCACHE + the module cache.
- uses: actions/setup-go@v5
  with:
    go-version: '1.25.x'
    cache: true                 # caches GOCACHE and GOMODCACHE keyed on go.sum
```

Manual / other CI: cache the two directories explicitly.

```sh
go env GOCACHE      # build cache  -> persist this between runs
go env GOMODCACHE   # module cache ($GOPATH/pkg/mod) -> persist this too
```

```yaml
# Generic CI cache step (pseudo-config)
key: go-${{ runner.os }}-${{ hashFiles('**/go.sum') }}
paths:
  - <value of `go env GOCACHE`>
  - <value of `go env GOMODCACHE`>
restore-keys: |
  go-${{ runner.os }}-
```

Cache-key guidance:

- Key on `go.sum` **and** the Go toolchain version. A toolchain bump changes the
  compiler hash, so the old build cache is fully invalid — but it's still worth
  restoring (the module cache is reusable, and CI cache restore is cheap).
- Use a `restore-keys` prefix so a partial (older) cache is reused as a baseline
  instead of starting cold when `go.sum` changes by one line.
- Don't cache the **binary output dir** as a "build cache" — cache `GOCACHE`
  itself; let Go decide what's reusable.

> Rule of thumb: a warm `GOCACHE` in CI commonly cuts incremental build time by
> 5–20×. It is the highest-leverage change you can make.

## 2. Reproducible builds with `-trimpath`

By default, compiled archives embed **absolute filesystem paths** (your
`$HOME/project/...` or CI's `/home/runner/work/...`). That means the same source
built on two machines produces *different bytes* — defeating bit-for-bit
reproducibility and polluting the cache key across machines.

```sh
go build -trimpath -ldflags='-s -w -buildid=' -o app ./cmd/app
```

- `-trimpath` removes machine-specific path prefixes from the binary (replacing
  them with the module path). Identical source + toolchain + flags now yields
  identical bytes regardless of where it was built.
- It also makes the **action ID** machine-independent for those packages, so a
  `GOCACHE` produced on a build host is reusable on a developer laptop.
- `-ldflags='-buildid='` clears the per-link build ID for fully deterministic
  output when you compare release artifacts byte-for-byte. (Keep the build id in
  normal CI; only strip it for reproducibility audits.)

For release pipelines also pin `GOFLAGS` and the toolchain:

```sh
export GOFLAGS='-trimpath -mod=readonly'
export CGO_ENABLED=0            # pure-Go: no host C toolchain in the cache key
# go.mod: `go 1.25.3` + `toolchain go1.25.3` pins the exact compiler.
```

## 3. Remote / distributed build caches

Go 1.24+ exposes a **cache program protocol** so an external process can serve
cache reads/writes — the basis for sharing a build cache across a fleet (a
team-wide or CI-wide cache server).

```sh
export GOCACHEPROG='/usr/local/bin/my-cache-proxy --backend s3://team-go-cache'
go build ./...   # cache get/put now go through my-cache-proxy over stdin/stdout
```

`GOCACHEPROG` speaks a small JSON protocol (`get`/`put` requests on stdin,
responses on stdout) defined in `cmd/go/internal/cache` (`prog.go`). Practical
notes:

- The remote cache must be **content-addressed and trustworthy**. Because keys
  are action IDs and values are content-addressed, a poisoned entry can inject a
  wrong (or malicious) compiled object. Lock down write access; treat the cache
  server as part of your supply chain.
- It shines in monorepos and large CI fleets where many machines rebuild the
  same dependency graph. For a single developer the local `GOCACHE` is enough.
- Tools like Bazel's `rules_go` bypass `go build` orchestration entirely and run
  the compiler directly with Bazel's own remote cache/execution — a different
  (heavier) answer to the same problem.

## 4. Monorepo build times

Large repos with thousands of packages stress the orchestrator:

- **Parallelism vs memory.** Default `-p = NumCPU` can OOM a build box because
  each `compile` holds its package's IR. Cap it: `go build -p 8 ./...` on a box
  where higher `-p` triggers the OOM killer (which masquerades as a flaky
  "signal: killed" build failure).
- **Build the minimal target set.** `go build ./...` compiles *every* package
  including tests-only and `internal` tools. Build the specific `main` packages
  you ship; let CI test the rest separately.
- **Tame `go vet`.** `go test` runs `vet` by default (a separate action in the
  graph). `go test -vet=off` removes that work when you vet in a dedicated job.
- **Watch the link tail.** One `main` = one single-threaded `link`. Huge
  binaries (lots of deps, cgo, DWARF) make the link the long pole; `-ldflags='-w'`
  (drop DWARF) speeds links when you don't ship debug info.

## 5. Analyzing the action graph

`-debug-actiongraph` writes the full DAG with per-action timestamps — your
profiler for "why is this build slow?"

```sh
go build -debug-actiongraph=ag.json ./cmd/server
```

Each node has `TimeReady`, `TimeStart`, `TimeDone`. Compute per-action wall time
and find the critical path:

```sh
# Top 15 slowest actions by self time.
jq -r '
  map(select(.TimeStart and .TimeDone)
      | {pkg:.Package, mode:.Mode,
         ms: (((.TimeDone|sub("\\.[0-9]+";"")|fromdate)
              - (.TimeStart|sub("\\.[0-9]+";"")|fromdate)))})
  | sort_by(-.ms)[:15][]
  | "\(.ms)s\t\(.mode)\t\(.pkg)"' ag.json
```

(For sub-second precision use a small Go/Python script that parses the RFC3339
nanoseconds.) Combine with:

```sh
go build -x -v ./cmd/server 2>&1 | tee build.log   # -v lists packages as built
GODEBUG=gocachehash=1 go build ./cmd/server 2>&1   # see what busts the cache
```

If `-debug-actiongraph` shows many `Mode:"build"` actions running on every
identical build, your cache isn't being reused — investigate Section 6.

## 6. Footguns (real cases)

| Footgun | What happens | Fix |
| --- | --- | --- |
| `-a` left in CI | Rebuilds std lib + all deps every run — cold builds forever | Remove `-a`; rely on the cache |
| Per-run `-ldflags` with a timestamp/commit | Link action ID changes every build → final binary never cached (compiles still cached, link reruns — usually fine, but don't put volatile flags on `-gcflags`) | Keep volatile data in `-ldflags` (link only), never in compile flags |
| `CGO_ENABLED=1` + changing C headers | cgo packages depend on system C libs the cache can't hash → stale or surprise rebuilds | Pin the C toolchain image; `go clean -cache` after host lib upgrades; prefer `CGO_ENABLED=0` |
| Different `$HOME`/workdir across CI agents | Absolute paths differ → action IDs differ → cache never hits cross-agent | `-trimpath` to make IDs path-independent |
| Caching `GOCACHE` but not `GOMODCACHE` | Re-downloads modules every run | Cache both dirs |
| `go generate` output not committed | Generated `.go` differs per machine → nondeterministic action IDs | Commit generated code or generate deterministically before build |
| Clock skew / huge `GOCACHE` | Cache grows unbounded on long-lived runners | Go trims old entries automatically, but cap CI cache size and let `restore-keys` rebuild |

A classic real incident: CI was "always slow." `-debug-actiongraph` showed every
package rebuilding. Cause: the cache step keyed on a commit SHA, so the key was
unique per build and never restored. Fixing the key to `hashFiles('**/go.sum')`
made warm builds ~10× faster.

## 7. Summary

- Persisting `GOCACHE` (and `GOMODCACHE`) across CI runs is the biggest build
  speedup; key on `go.sum` + toolchain, use `restore-keys` for partial reuse.
- `-trimpath` (plus pinned toolchain, `CGO_ENABLED=0`, `-mod=readonly`) gives
  reproducible, machine-independent builds and cross-machine cache hits.
- `GOCACHEPROG` enables remote/distributed caches — treat the cache server as
  supply-chain-critical.
- In monorepos, tune `-p` for memory, build only shipped targets, mind the
  single-threaded link tail, and use `-debug-actiongraph` to find the critical
  path.
- The recurring footguns: stray `-a`, cgo defeating the cache, absolute paths
  without `-trimpath`, and CI cache keys that never hit.

## Further reading

- Reproducible builds / `-trimpath`: <https://go.dev/ref/mod#build-commands> and `go help build`
- `GOCACHEPROG` protocol: <https://cs.opensource.google/go/go/+/refs/tags/go1.25.3:src/cmd/go/internal/cache/prog.go>
- `actions/setup-go` caching: <https://github.com/actions/setup-go#caching-dependency-files-and-build-outputs>
- `go help environment` (GOCACHE, GOMODCACHE, GOFLAGS, CGO_ENABLED)
- Go release notes on the cache program protocol (Go 1.24): <https://go.dev/doc/go1.24>
