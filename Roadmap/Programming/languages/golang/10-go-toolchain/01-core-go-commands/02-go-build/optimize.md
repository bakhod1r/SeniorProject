# go build — Optimization

Speed up builds and shrink binaries. Numbers are illustrative; measure with `time` and `ls -l`.

---

## Exercise 1: Keep the build cache warm in CI

**Before** — every CI job builds from a cold `GOCACHE`: every package recompiles.

**After** — persist the cache across runs:

```yaml
- uses: actions/cache@v4
  with:
    path: |
      ~/.cache/go-build
      ~/go/pkg/mod
    key: go-${{ hashFiles('**/go.sum') }}
```

| Metric | Cold cache | Warm cache |
|--------|-----------|-----------|
| `go build ./...` | ~90s | ~8s |

The biggest single CI build win for most repos.

---

## Exercise 2: Layer Docker for dependency caching

**Before** — `COPY . .` before `go mod download`, so any source change re-downloads all modules.

**After:**

```dockerfile
COPY go.mod go.sum ./
RUN go mod download        # cached layer unless go.mod/go.sum change
COPY . .
RUN go build -o /app ./cmd/app
```

| Metric | source-only change rebuild | with layering |
|--------|----------------------------|---------------|
| Module download | every build | only on go.sum change |

---

## Exercise 3: Shrink the binary

**Before** — default build embeds the symbol table and DWARF debug info.

**After:**

```bash
go build -trimpath -ldflags="-s -w" -o app .
```

| Metric | default | `-s -w` |
|--------|---------|---------|
| Binary size (typical service) | ~18 MB | ~12 MB |

Optionally pipe through `upx` for further compression (trade: slower startup, antivirus false positives). Reserve stripping for release artifacts.

---

## Exercise 4: Static binary for tiny images

**Before** — cgo-enabled binary on a `debian`-based image: hundreds of MB.

**After:**

```bash
CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o app .
# FROM gcr.io/distroless/static  (a few MB)
```

| Metric | debian + dynamic | distroless/static |
|--------|------------------|-------------------|
| Image size | ~120 MB | ~10 MB |
| Attack surface | large | minimal |

---

## Exercise 5: Compile-check fast instead of building artifacts

**Before** — CI builds full binaries just to verify code compiles, writing files it discards.

**After:**

```bash
go build -o /dev/null ./...
```

| Metric | full build with `-o bin/` | `-o /dev/null` |
|--------|---------------------------|----------------|
| Disk writes | many | none |
| Intent | unclear | "just compile-check" |

Slightly faster and clearly communicates intent.

---

## Exercise 6: Tune parallelism to the CPU quota

**Before** — in a 2-CPU CI container, `go build` defaults `-p` to the host's many cores, oversubscribing.

**After:**

```bash
go build -p 2 ./...     # match the real quota
```

| Metric | default `-p` (oversubscribed) | `-p 2` |
|--------|-------------------------------|--------|
| Build wall time | inflated by context switching | steady |

`GOMAXPROCS` and `-p` should reflect the container's actual CPU limit.

---

## Exercise 7: Avoid `-a`

**Before** — `go build -a ./...` rebuilds the world each run "to be safe."

**After** — rely on the content-addressed cache; clean only when truly corrupt:

```bash
go build ./...           # incremental
go clean -cache          # only if you suspect corruption
```

| Metric | `-a` every build | incremental |
|--------|------------------|-------------|
| Rebuild time | full every time | only changed packages |

---

## Measurement checklist
- [ ] Cache `GOCACHE` + `GOMODCACHE` in CI.
- [ ] Layer Dockerfiles so deps download independently of source.
- [ ] Strip release binaries with `-s -w` (never debug builds).
- [ ] `CGO_ENABLED=0` for static, tiny distroless images.
- [ ] `-o /dev/null` for compile-only checks.
- [ ] Set `-p`/`GOMAXPROCS` to the real CPU quota.
- [ ] Never routinely use `-a`.
