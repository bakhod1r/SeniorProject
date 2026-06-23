# Build Orchestration & Cache — Optimize

A playbook for fast, reproducible Go builds. Each section is a lever; the
checklist at the end is the order to pull them. Measure first — the action graph
and `time` tell you where the seconds go.

## 1. Measure before you optimize

You can't speed up what you don't measure. Three tools:

```sh
# Cold vs warm wall time.
go clean -cache && time go build ./cmd/server   # cold
time go build ./cmd/server                       # warm

# Which packages built, in order.
go build -x -v ./cmd/server 2>&1 | tee build.log

# The full DAG with per-action timings.
go build -debug-actiongraph=ag.json ./cmd/server
```

Find the slow actions from the graph (self time = `TimeDone - TimeStart`):

```sh
jq -r 'map(select(.TimeStart and .TimeDone)) | length' ag.json   # how many actions ran
# Then sort by duration with a small script for nanosecond precision.
```

If warm time ≈ cold time, your **cache isn't being reused** — fix that before
anything else (Section 2). If warm is already fast, optimize cold builds and CI.

## 2. Warm the cache in CI (the biggest lever)

A persisted `GOCACHE` turns most CI builds incremental. This single change
typically dwarfs every other optimization.

```yaml
- uses: actions/setup-go@v5
  with:
    go-version: '1.25.x'
    cache: true          # persists GOCACHE + GOMODCACHE keyed on go.sum
```

Manual CI: persist both `go env GOCACHE` and `go env GOMODCACHE`, key on
`hashFiles('**/go.sum')` plus the toolchain version, and add a `restore-keys`
prefix so a near-match cache is restored instead of starting cold.

Validate: after the change, a warm CI run's `-debug-actiongraph` should show few
`Mode:"build"` actions actually executing.

## 3. Maximize useful parallelism

```sh
go build ./...                 # default -p = NumCPU (good default)
go build -p "$(nproc)" ./...   # explicit
go build -p 8 ./...            # cap to avoid OOM on memory-bound CI boxes
```

- The graph is wide at the leaves (parallel) and narrow at the top (the single
  `link`). More cores help the middle, not the link tail.
- On memory-constrained runners, *lowering* `-p` can be faster overall by
  avoiding swap/OOM-kills. Tune to the box.

## 4. Build fewer things

Less work beats faster work.

```sh
go build -o bin/server ./cmd/server   # only what you ship — not ./...
go test -vet=off ./...                # skip the vet action if vet is a separate job
```

- Avoid `./...` in the build stage; it compiles test-only and tool packages you
  never deploy.
- Trim the **dependency graph**: fewer/lighter imports = fewer leaf actions and
  a smaller link. A heavy transitive dep (large crypto, cgo wrappers) inflates
  both cold-build and link time for every consumer.
- Prefer `CGO_ENABLED=0` where you don't need cgo: it removes the C toolchain
  from the picture, simplifies the cache key, and speeds the link.

## 5. Don't bust the cache

Every input change re-keys an action. Keep volatile data **out of compile
inputs**.

| Do | Don't |
| --- | --- |
| Put `$BUILD_ID`/SHA in `-ldflags -X` (link only) | Bake volatile values into `-gcflags`/source (recompiles everything) |
| Use the built-in `-trimpath` flag | Hand-roll path-dependent compile flags |
| Keep a stable set of build `-tags` | Flip `-tags` per build (separate cache variants) |
| Remove stray `-a` | Leave `-a` in Makefiles/CI |
| Run coverage/profile in a dedicated uncached job | Add `-coverprofile` to the fast inner loop (disables test cache) |

## 6. Prebuilt standard library & toolchain pinning

- The std lib is cached in `GOCACHE` like any package; after the first build
  it's reused. A persisted CI cache keeps it warm across runs.
- A **toolchain upgrade** invalidates the entire cache (the compiler hash is in
  every key). Pin the toolchain so upgrades are intentional, not incidental:

```text
// go.mod
go 1.25.3
toolchain go1.25.3
```

- Use a CI image with the exact Go version preinstalled so you're not
  downloading/extracting the toolchain on every run.

## 7. Reproducibility with `-trimpath`

Reproducible builds also *improve caching* (machine-independent action IDs ⇒
cross-machine cache hits).

```sh
export GOFLAGS='-trimpath -mod=readonly'
go build -ldflags='-s -w' -o app ./cmd/app       # smaller binary, faster link
go build -trimpath -ldflags='-buildid=' -o app ./cmd/app  # byte-for-byte audits
```

`-ldflags='-w'` drops DWARF (smaller, faster link) when you don't ship debug
info; `-s` strips the symbol table too.

## 8. Distributed cache (large teams/monorepos)

When a single machine's cache isn't enough, share one:

```sh
export GOCACHEPROG='/usr/local/bin/go-cache-proxy --backend s3://team-cache'
go build ./...
```

A `GOCACHEPROG` backend lets a whole fleet reuse each other's compiled objects.
Pair with `-trimpath` (so keys match across machines) and lock down write access
(the cache is supply-chain-critical). For a single dev, the local cache suffices.

## 9. Worked example: cutting a CI build from 4m to 25s

1. **Measure.** `-debug-actiongraph` shows ~1,800 `build` actions every run →
   cache cold.
2. **Cache.** Add `setup-go` `cache: true`. Warm runs now run ~40 `build`
   actions (only changed subtree). → 4m to ~45s.
3. **Trim targets.** Replace `go build ./...` with the three shipped `main`s.
   → ~45s to ~30s.
4. **Reproducible.** Add `GOFLAGS=-trimpath`; cross-runner cache hits improve.
   → ~30s to ~25s.
5. **Pin toolchain** in `go.mod` so a stray minor bump doesn't silently cold the
   cache.

## 10. Checklist

- [ ] `GOCACHE` **and** `GOMODCACHE` persisted in CI, keyed on `go.sum` +
      toolchain, with `restore-keys`.
- [ ] No stray `-a`; no volatile values in `-gcflags`/source.
- [ ] Volatile stamping only in `-ldflags -X`.
- [ ] `-trimpath` set (via `GOFLAGS`) for reproducibility + cross-machine cache.
- [ ] Toolchain pinned in `go.mod` (`go` + `toolchain`).
- [ ] Build only shipped `main`s; `./...` left to test/vet stages.
- [ ] `-p` tuned to the box (memory-bound? lower it).
- [ ] `CGO_ENABLED=0` where cgo isn't needed.
- [ ] Coverage/profiling in a separate, deliberately-uncached job.
- [ ] Measured cold vs warm; confirmed warm reuse via `-debug-actiongraph`.

## Summary

The fast-build hierarchy: **persist the cache** (CI) → **build fewer things** →
**stop busting the cache** → **parallelize/pin/trim**. Always measure with
`time`, `-x -v`, and `-debug-actiongraph` before and after, and verify that warm
builds actually reuse cached actions.

## Further reading

- `go help build`, `go help cache`, `go help environment`
- `actions/setup-go` caching: <https://github.com/actions/setup-go#caching-dependency-files-and-build-outputs>
- Reproducible builds: <https://go.dev/ref/mod#build-commands>
- `GOCACHEPROG`: <https://cs.opensource.google/go/go/+/refs/tags/go1.25.3:src/cmd/go/internal/cache/prog.go>
