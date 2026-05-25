# Building Executables — Optimization

These exercises reduce build time, binary size, or distribution size. Numbers are illustrative; measure on your binaries with `time`, `du -h`, and `docker image ls`.

---

## Exercise 1: Shrink the binary with `-ldflags="-s -w" -trimpath`

**Before** — default `go build` carries the symbol table, full DWARF, and absolute build paths:

```bash
go build -o api ./cmd/api
du -h api
# 24M
```

**After** — production flags:

```bash
go build -trimpath -ldflags="-s -w" -o api ./cmd/api
du -h api
# 16M
```

| Metric | Default | `-s -w -trimpath` |
|--------|---------|-------------------|
| Binary size | 24 MB | 16 MB |
| Panic traces work? | yes | yes (`.gopclntab` retained) |
| `pprof` function-level | yes | yes |
| `pprof` source-line / `delve` | yes | no |

Trade-off: keep an unstripped artifact archived per release for offline symbolization.

---

## Exercise 2: Drop cgo for portability and speed

**Before** — `CGO_ENABLED=1` (the default when gcc is present) links dynamically against libc and uses the external linker:

```bash
go build -o api ./cmd/api
file api
# dynamically linked, interpreter /lib64/ld-linux-x86-64.so.2
```

**After:**

```bash
CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o api ./cmd/api
file api
# statically linked
```

| Metric | cgo on | cgo off |
|--------|--------|---------|
| Link time | ~2.0s | ~0.7s |
| Binary runs on `scratch` | no | yes |
| `net` resolver | calls glibc `getaddrinfo` | pure-Go resolver |

Pure-Go programs gain nothing from cgo. Disable it unless a specific dependency requires it (e.g., a SQLite driver).

---

## Exercise 3: `upx` for further compression (with strong caveat)

**Before** — stripped binary, ~16 MB.

**After:**

```bash
upx --best --lzma api
du -h api
# 4.5M
```

| Metric | Stripped | `upx --best --lzma` |
|--------|----------|--------------------|
| Binary size | 16 MB | 4.5 MB |
| First start latency | ~5 ms | +50–200 ms (decompress) |
| Memory mapping behavior | shared/text page-cache friendly | each process decompresses into private RW pages |
| AV/EDR false positives | low | high (UPX is malware-coded heavily) |
| Profile / strings inspection | works | requires `upx -d` first |

Use `upx` only when distribution size truly dominates (CLI tool downloaded over slow links). Do **not** use it for long-running servers — you lose the page-cache sharing benefit and pay startup cost. Many AV products flag UPX-packed binaries.

---

## Exercise 4: Persist the build cache across CI jobs

**Before** — every CI job starts with an empty `$GOCACHE` and re-compiles every package:

```yaml
- run: go build -o api ./cmd/api   # ~90s in a cold job
```

**After** — cache `$GOCACHE` and `$GOMODCACHE`:

```yaml
- uses: actions/cache@v4
  with:
    path: |
      ~/.cache/go-build
      ~/go/pkg/mod
    key: go-${{ runner.os }}-${{ hashFiles('**/go.sum') }}
    restore-keys: |
      go-${{ runner.os }}-
- run: go build -o api ./cmd/api   # ~12s on warm cache
```

| Metric | Cold cache | Warm cache |
|--------|-----------|-----------|
| Build wall time | ~90s | ~12s |
| CI cost per PR | high | low |

Key the cache on `go.sum`; restore-keys let you fall back to a near-match when dependencies change slightly.

---

## Exercise 5: Parallel matrix builds

**Before** — sequential cross-compile loop:

```bash
for target in linux/amd64 linux/arm64 darwin/amd64 darwin/arm64 windows/amd64; do
  GOOS=${target%/*} GOARCH=${target#*/} go build ...
done
# ~5 × link time, ~50s total
```

**After** — run the five builds concurrently (a single Go toolchain instance is happy to do this if you have CPUs and the cache is warm):

```bash
for target in linux/amd64 linux/arm64 darwin/amd64 darwin/arm64 windows/amd64; do
  ( GOOS=${target%/*} GOARCH=${target#*/} go build -o "bin/api-${target//\//-}" ./cmd/api ) &
done
wait
# ~15s total on a 4-core machine
```

| Metric | Sequential | Parallel |
|--------|-----------|----------|
| Wall time | ~50s | ~15s |
| Peak CPU | 1 core | ≤ NCPU |

`goreleaser` does this for you. If you script it manually, watch RAM — each `cmd/link` invocation can take 1–2 GB.

---

## Exercise 6: `-buildmode=pie` decision

PIE adds ASLR for the executable image at a small cost:

| Metric | `exe` (default) | `pie` |
|--------|----------------|-------|
| Binary size | baseline | +5–10% |
| Cold start | baseline | +1–2 ms |
| Steady-state CPU | baseline | +1–2% (extra indirection) |
| ASLR for the executable | no | yes |

Rule of thumb: enable `-buildmode=pie` for long-running production servers and any binary you ship to user machines on hardened OSes. Leave it off for CLI utilities where startup latency matters and the security gain is marginal.

```bash
go build -buildmode=pie -trimpath -ldflags="-s -w" -o api ./cmd/api
```

---

## Exercise 7: Reproducible builds with `SOURCE_DATE_EPOCH`

Go itself does not embed wall-clock time, but your **packaging** step (tar, zip, deb, container layers) often does, breaking reproducibility downstream.

**Before** — packaging produces a different tarball each run because file mtimes differ.

**After** — set `SOURCE_DATE_EPOCH` and use packaging tools that respect it:

```bash
export SOURCE_DATE_EPOCH=$(git log -1 --pretty=%ct)

go build -trimpath -ldflags="-s -w -buildid=" -o api ./cmd/api

# tar respects SOURCE_DATE_EPOCH when given --mtime=@$SOURCE_DATE_EPOCH
tar --sort=name --mtime=@${SOURCE_DATE_EPOCH} --owner=0 --group=0 --numeric-owner \
    -czf api.tar.gz api
```

| Metric | Default | With `SOURCE_DATE_EPOCH` |
|--------|---------|--------------------------|
| Tarball SHA-256 stable across rebuilds | no | yes |
| Container layer hash stable | no | yes (with buildkit `SOURCE_DATE_EPOCH`) |

Docker buildx supports `SOURCE_DATE_EPOCH` since BuildKit 0.11; the resulting image layers become hash-stable.

---

## Exercise 8: Multi-arch container layer reuse

**Before** — one Dockerfile built twice for amd64 and arm64 produces two unrelated images; the registry stores duplicate layers.

**After** — use buildx with a multi-platform manifest, and order Dockerfile layers from least to most cache-volatile so dependency layers are shared across architectures and builds:

```dockerfile
FROM --platform=$BUILDPLATFORM golang:1.23 AS build
ARG TARGETOS TARGETARCH
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/api /api
USER nonroot:nonroot
ENTRYPOINT ["/api"]
```

```bash
docker buildx build --platform linux/amd64,linux/arm64 -t ghcr.io/me/api:v1 --push .
```

| Metric | Per-arch ad-hoc builds | Buildx multi-platform |
|--------|-----------------------|----------------------|
| Module download repeated | yes (per arch) | no (cached cross-arch) |
| Registry manifest | two unrelated tags | one multi-arch manifest |
| Consumer pulls correct arch automatically | no | yes |

---

## Measurement checklist
- [ ] Measure binary size before/after with `du -h` and `go build -ldflags="-s -w" -trimpath`.
- [ ] Confirm `CGO_ENABLED=0` produced a static binary (`file ./api`).
- [ ] Reach for `upx` only if distribution size is the bottleneck; never on long-running servers.
- [ ] Cache `$GOCACHE` and `$GOMODCACHE` in CI keyed on `go.sum`.
- [ ] Parallelize matrix builds; cap concurrency to keep RAM under control.
- [ ] Enable `-buildmode=pie` for production servers; leave it off for short-lived CLIs.
- [ ] Set `SOURCE_DATE_EPOCH` for reproducible packages and container layers.
- [ ] Use `docker buildx` multi-platform manifests for cross-arch images.
