# Cross-compilation — Optimization

A release matrix that builds N targets sequentially with a cold cache wastes minutes per push. These exercises cut wall time and artifact size. Numbers are illustrative; measure with `time` on your own program.

---

## Exercise 1: Parallelize target builds

**Before** — a shell loop builds one target after another:

```bash
for t in linux/amd64 linux/arm64 darwin/arm64 windows/amd64; do
  os=${t%/*}; arch=${t#*/}
  CGO_ENABLED=0 GOOS=$os GOARCH=$arch go build -o dist/app-$os-$arch .
done
```

**After** — fan out via `make -j`, GitHub Actions matrix, or `xargs -P`:

```bash
printf '%s\n' linux/amd64 linux/arm64 darwin/arm64 windows/amd64 \
  | xargs -P 4 -I{} bash -c '
      t={}; os=${t%/*}; arch=${t#*/}
      CGO_ENABLED=0 GOOS=$os GOARCH=$arch \
        go build -trimpath -ldflags="-s -w" \
        -o dist/app-$os-$arch .'
```

| Metric | Sequential (4 targets) | Parallel `-P 4` |
|--------|-----------------------|------------------|
| Wall time (small app, warm cache) | ~12s | ~4s |
| CPU usage | 1 core busy | up to 4 cores busy |

Each target gets its own linker process — the work is embarrassingly parallel.

---

## Exercise 2: Share `GOCACHE` and `GOMODCACHE` across targets

**Before** — CI evicts the build cache between jobs; every target downloads modules and recompiles the standard library.

**After** — pin and persist the caches:

```yaml
- uses: actions/cache@v4
  with:
    path: |
      ~/.cache/go-build
      ~/go/pkg/mod
    key: go-${{ runner.os }}-${{ hashFiles('**/go.sum') }}
    restore-keys: go-${{ runner.os }}-
```

Different `GOOS/GOARCH` combinations have *different* cache keys inside `GOCACHE`, but they live in the same directory; one shared cache stores the compiled stdlib for every target you build.

| Metric | No cache | Persisted cache |
|--------|----------|-----------------|
| Stdlib compile per target | repeated every job | once, then reused |
| First-build time | ~40s | ~40s |
| Subsequent-build time | ~40s | ~6s |

---

## Exercise 3: Shrink and stabilize with `-trimpath -buildvcs=false -ldflags="-s -w"`

**Before:**

```bash
go build -o app .
ls -l app   # 12 MB
```

**After:**

```bash
CGO_ENABLED=0 go build \
  -trimpath -buildvcs=false \
  -ldflags="-s -w" \
  -o app .
ls -l app   # 8 MB
```

| Metric | Default flags | `-s -w` + trim |
|--------|---------------|-----------------|
| Binary size | 12 MB | ~8 MB (≈33% smaller) |
| Reproducibility | builder-dependent paths embedded | trimmed |
| Cost | DWARF gone, harder post-mortem on prod cores | acceptable for most services |

For a service deployed to many regions, the size cut directly reduces image-pull time and bandwidth.

---

## Exercise 4: Prefer pure-Go over cgo where possible

**Before** — `CGO_ENABLED=1` (default on Linux/macOS) pulls in cgo for `net` and `os/user`, links via the slower external system linker, and requires a C cross-toolchain to cross-compile.

**After:**

```bash
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o app .
```

| Metric | cgo on | cgo off |
|--------|--------|---------|
| Link time | ~1.2s | ~0.3s |
| Cross-compile setup | needs C cross-compiler | none |
| Runtime DNS resolver | libc / nsswitch | pure-Go resolver |
| Binary deployability | needs target libc | static, drops into `scratch` |

If you must keep cgo on for a real reason (SQLite, OpenSSL, a vendor SDK), at least exclude it from the parts that don't need it.

---

## Exercise 5: `docker buildx` cache reuse for multi-arch

**Before** — multi-arch build redoes everything from scratch each push:

```bash
docker buildx build --platform linux/amd64,linux/arm64 -t app:latest --push .
```

**After** — push and pull a registry cache:

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --cache-to   type=registry,ref=ghcr.io/acme/app:buildcache,mode=max \
  --cache-from type=registry,ref=ghcr.io/acme/app:buildcache \
  -t ghcr.io/acme/app:latest --push .
```

Combine with the `--platform=$BUILDPLATFORM` Go cross-compile pattern (see senior.md §6) so the slow `go build` step runs on the native host and Buildx only needs to assemble the final per-arch layer.

| Metric | No buildx cache | Registry cache |
|--------|-----------------|----------------|
| Unchanged-source rebuild | ~120s | ~15s (manifest update only) |
| New dependency rebuild | ~120s | ~60s (cached stdlib + module download) |

---

## Exercise 6: Only build targets whose inputs changed

**Before** — every push rebuilds all matrix entries even when only docs changed.

**After** — make per-target outputs depend on the right files in Make (or use `dorny/paths-filter` in GitHub Actions to skip the matrix entirely on doc-only changes):

```make
SRC := $(shell find . -name '*.go' -not -path './dist/*') go.mod go.sum
dist/app-%: $(SRC)
	@os=$(word 2,$(subst -, ,$*)); arch=$(word 3,$(subst -, ,$*)); \
	 CGO_ENABLED=0 GOOS=$$os GOARCH=$$arch \
	   go build -trimpath -ldflags="-s -w" -o $@ .
```

`make dist/app-linux-amd64` only rebuilds if a Go file or `go.mod`/`go.sum` is newer than the output.

| Metric | Always rebuild all | mtime-aware |
|--------|--------------------|--------------|
| Docs-only push | 5 builds | 0 builds |
| Single-file change | 5 builds | 5 builds (Go sources affect all targets) |

This wins most on doc/CI/script-only changes — surprisingly common in real repos.

---

## Exercise 7: One build per arch family when ABI is shared

For Linux, `linux/amd64` baseline (`GOAMD64=v1`) and `linux/arm64` are the two arch families most services need. Avoid duplicating builds for `linux/amd64` + `linux/amd64-v3` unless you have a measured performance reason — pick one level per binary and ship it.

**Before** — building `app-linux-amd64` *and* `app-linux-amd64-v3` and `app-linux-amd64-v4`:

| Variant | Built | Used in practice |
|---------|-------|-----------------|
| v1, v2, v3, v4 | 4 binaries | Usually 1 |

**After** — ship `v1` for portability or `v3` for owned hardware, not both. Halve your release matrix; size of `dist/` drops linearly.

If you genuinely need both, gate the higher variant on an explicit deploy target so you do not build it for every release.

---

## Measurement checklist
- [ ] Build targets in parallel (`make -j`, `xargs -P`, CI matrix).
- [ ] Persist `GOCACHE` and `GOMODCACHE` across CI jobs.
- [ ] Always pass `-trimpath -buildvcs=false -ldflags="-s -w"` for release artifacts.
- [ ] Set `CGO_ENABLED=0` unless you have a concrete cgo reason.
- [ ] Use `docker buildx` registry cache for multi-arch images.
- [ ] Skip jobs on doc-only changes via path filters or `make` dependencies.
- [ ] Do not multiply targets by `GOAMD64` levels without a measured win.
