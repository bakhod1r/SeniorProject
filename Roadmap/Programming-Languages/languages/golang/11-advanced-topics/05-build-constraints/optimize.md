# Build Constraints — Optimize

## 1. Compile-time selection beats runtime checks

```go
// Pattern A: runtime check
func compress(data []byte) []byte {
    if runtime.GOARCH == "amd64" { return compressSIMD(data) }
    return compressGeneric(data)
}

// Pattern B: build-tagged files
// compress_amd64.go (//go:build amd64)
//   func compress(data []byte) []byte { return compressSIMD(data) }
// compress_other.go (//go:build !amd64)
//   func compress(data []byte) []byte { return compressGeneric(data) }
```

Pattern B is faster (no branch per call), smaller (the unused path isn't shipped), and statically obvious. Use it whenever the selection is platform/architecture-driven.

---

## 2. Architecture-specific SIMD

```go
//go:build amd64

package fast

// uses Plan 9 assembly: src/fast/fast_amd64.s with SSE/AVX
func dotProduct(a, b []float32) float32
```

```go
//go:build !amd64

package fast

func dotProduct(a, b []float32) float32 {
    var s float32
    for i := range a { s += a[i] * b[i] }
    return s
}
```

The portable fallback ensures the package compiles everywhere. SIMD gives 3–10× speedup on supported hardware; everywhere else, you still work.

---

## 3. The `purego` tag and binary size

A pure-Go build with `-tags=purego` and `CGO_ENABLED=0`:

- Drops the cgo runtime and the C bridging code.
- Drops glibc/musl as a deployment dependency.
- Produces ~5–10% smaller binaries.
- Cross-compiles trivially.

For libraries that offer a cgo-accelerated path, supporting `purego` is a feature: users running in distroless containers depend on it.

---

## 4. Cgo and `netgo` / `osusergo`

```bash
go build -tags='netgo,osusergo' -ldflags='-s -w' ./cmd/app
```

| Tag | Effect |
|-----|--------|
| `netgo` | `net` package uses pure-Go DNS resolver, skipping `cgo`'s `getaddrinfo` |
| `osusergo` | `os/user` uses pure-Go user database lookup, skipping `getpwnam` |

Required for a fully static binary. Slightly worse DNS performance on some systems (the system resolver is faster on cache hits), but predictable and dependency-free.

---

## 5. Stripping with `-ldflags`

```bash
go build -ldflags='-s -w' -trimpath ./cmd/app
```

| Flag | Effect | Cost |
|------|--------|------|
| `-s` | Omit symbol table | Profiling harder |
| `-w` | Omit DWARF debug info | Stack traces less helpful (still readable) |
| `-trimpath` | Remove file system paths from binary | Reproducible builds, slightly less debug info |

Combined: ~10–20% binary size reduction. Don't use in dev builds where you want full stack traces; use in release builds where size matters.

---

## 6. Conditional code via Go-version tags

```go
//go:build go1.21
package mypkg

import "slices"

func sortStrings(s []string) { slices.Sort(s) }
```

```go
//go:build !go1.21
package mypkg

import "sort"

func sortStrings(s []string) { sort.Strings(s) }
```

When the build is Go 1.21+, the faster, generic version is used. Older builds fall back. Cost: two files; benefit: lib supports both Go versions optimally.

---

## 7. The "fast file" pattern

For very hot paths:

```go
// fastmath.go — neutral entry point
package fastmath

func Sum(xs []float64) float64 { return sumImpl(xs) }
```

```go
// fastmath_amd64.go
//go:build amd64 && !purego

package fastmath

func sumImpl(xs []float64) float64
```

```go
// fastmath_amd64.s
//go:build amd64 && !purego

TEXT ·sumImpl(SB), NOSPLIT, $0-...
    // SIMD code
```

```go
// fastmath_generic.go
//go:build !amd64 || purego

package fastmath

func sumImpl(xs []float64) float64 {
    var s float64
    for _, x := range xs { s += x }
    return s
}
```

This is the canonical four-file pattern used by `klauspost/compress`, `golang.org/x/crypto`, and others.

---

## 8. Skipping cgo where it's not needed

If your dependency tree pulls in cgo just for one obscure feature, isolating it behind a tag can save build time and binary size:

```go
//go:build cgo

package mypkg

// import "github.com/some/lib_that_needs_cgo"
```

```go
//go:build !cgo

package mypkg

// stub implementation; functionality degraded
```

Document the trade-off so users know what they're giving up.

---

## 9. Build cache and tag combinations

Each tag set is a separate cache entry. `go build` and `go build -tags=foo` don't share cached package objects. Implication:

- Switching between tag sets often re-pays compile cost (until the cache warms again).
- CI matrices with many tag combinations need adequate cache size.

For a developer who routinely toggles between two tag sets, increasing `GOCACHE` size and using a SSD-backed cache directory pays off.

---

## 10. Reducing test runs

```bash
# Fast unit tests only — runs in seconds
go test ./...

# Heavier integration suite — runs in minutes
go test -tags=integration -timeout=15m ./...
```

Tagging tests by cost lets CI run the cheap tier on every push and the expensive tier on PRs. The total CI time drops significantly while coverage remains.

---

## 11. Specific stdlib tags worth knowing

| Tag | Effect |
|-----|--------|
| `netgo` | Pure-Go DNS resolver |
| `osusergo` | Pure-Go user database |
| `timetzdata` | Embed tz data; otherwise loads from `/usr/share/zoneinfo` |
| `dynamic` | (gccgo) link dynamically |
| `boringcrypto` | (Google) use the BoringSSL crypto fork |
| `gccgo` | The gccgo compiler |
| `gc` | The standard gc compiler |

`timetzdata` is especially useful for distroless containers, which lack tzdata files.

---

## 12. Inspecting the result

```bash
go build -o app
ls -lh app                       # size
file app                         # static or dynamic
ldd app                          # libraries (Linux)
otool -L app                     # libraries (macOS)
go version -m app                # tags, settings
```

A 20 MiB binary vs 14 MiB after `-ldflags='-s -w'` is a real and measurable change. Add a size check to CI if release artifacts have a size budget.

---

## 13. Cross-compile + sanity check loop

```bash
for goos in linux darwin windows; do
    for goarch in amd64 arm64; do
        GOOS=$goos GOARCH=$goarch go build -o /tmp/check ./cmd/app
        echo "$goos/$goarch: $(stat -f%z /tmp/check 2>/dev/null || stat -c%s /tmp/check)"
    done
done
```

Confirms every combination compiles and shows the binary size. Trends in size across releases are a useful signal — a 30% size jump usually means a new heavy dependency.

---

## 14. Summary

Build-constraint optimization is mostly architectural: compile-time selection beats runtime branches, SIMD-fast paths gated by arch tags, pure-Go fallbacks for distroless deployments, and Go-version tags for using newer APIs. The toolkit (`netgo`, `osusergo`, `purego`, `timetzdata`, `-ldflags='-s -w'`, `-trimpath`) lets you produce small, static, portable binaries when you want them. Measure binary size and build time, and document tag conventions for the team.

---

## Further reading
- Standard library tags: `go doc cmd/go buildconstraint`
- `klauspost/compress` SIMD patterns
- Distroless static images
