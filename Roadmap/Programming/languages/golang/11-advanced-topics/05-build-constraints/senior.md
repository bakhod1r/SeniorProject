# Build Constraints — Senior

## 1. Constraints as an architecture tool

Build constraints aren't just for "Linux vs Windows". A mature codebase uses them for:

- **Compile-time feature selection** (pure-Go vs cgo crypto).
- **Platform-specific syscall wrappers** (file system, network, signals).
- **Architecture-specific fast paths** (SIMD on amd64, NEON on arm64, portable Go on others).
- **Build-time configuration** (prod vs staging keys, feature gates).
- **Toolchain version gating** (use newer stdlib APIs when available).

The pattern: a "neutral" API in `pkg.go`, then platform/arch-specific implementations in `pkg_<tag>.go` files.

---

## 2. The standard library uses constraints extensively

```
src/runtime/
  os_linux.go        //go:build linux
  os_darwin.go       //go:build darwin
  os_windows.go      //go:build windows
  asm_amd64.s        //go:build amd64
  ...
```

Grep `//go:build` in `$GOROOT/src` for examples of every pattern. It's the most reviewed code base of build-constraint patterns.

---

## 3. The "trampoline" pattern

```go
// pkg.go
package mypkg

func Compress(data []byte) []byte {
    return compress(data)  // dispatched to platform-specific implementation
}
```

```go
// pkg_amd64.go
//go:build amd64

package mypkg

func compress(data []byte) []byte { /* SIMD-accelerated */ }
```

```go
// pkg_generic.go
//go:build !amd64

package mypkg

func compress(data []byte) []byte { /* portable */ }
```

Three rules:

1. Every platform must define `compress`.
2. The set of tags across the files must be a **partition** (exactly one matches per build).
3. The public API (`Compress`) is in the neutral file.

Failing rule 2 produces "undefined: compress" or "duplicate function" errors.

---

## 4. Verifying the partition

For a non-trivial package, write a test that fails to compile if the partition is wrong:

```go
// partition_check_test.go
package mypkg

import "testing"

func TestPartition(t *testing.T) {
    // This file always compiles. If it can call `compress`, the partition has at least one match.
    _ = compress
}
```

For deeper verification, build for every supported `GOOS`/`GOARCH` pair in CI.

---

## 5. CI matrix testing

```yaml
strategy:
  matrix:
    goos: [linux, darwin, windows]
    goarch: [amd64, arm64]
    exclude:
      - goos: windows
        goarch: arm64    # if not supported
```

Each row builds; missing files surface as compile errors. This is the only reliable way to catch a stale tag.

---

## 6. The "purego" tag convention

Many libraries support a `purego` tag:

```go
//go:build !purego && cgo
package fast
// cgo-accelerated path
```

```go
//go:build purego || !cgo
package fast
// pure Go path
```

Callers force the pure-Go path with `-tags=purego`. Standard convention used by `golang.org/x/sys/cpu`, `klauspost/compress`, others.

---

## 7. The Go version tag, deep

`//go:build go1.X` matches Go 1.X **or later**. So:

```go
//go:build go1.21
// uses slices.SortFunc
```

This file is included on 1.21 and 1.22+. To require *exactly* one version, combine:

```go
//go:build go1.21 && !go1.22
```

Used by library authors who need to ship multiple versions of the same file for the same package across different toolchains.

---

## 8. `go:build` vs runtime checks

```go
//go:build linux

func mountFilesystem() { /* Linux mount syscall */ }
```

vs

```go
package mypkg

func mountFilesystem() {
    if runtime.GOOS != "linux" {
        panic("Linux only")
    }
    // ...
}
```

The build-constraint version:

- Doesn't ship the Linux code on Windows.
- Catches the platform error at compile time.
- Avoids any `runtime.GOOS` check at runtime.

The runtime check ships everything everywhere and crashes late. Prefer constraints whenever the answer is known at build time.

---

## 9. Constraints in vendored / replaced modules

`go mod vendor` copies all source files, including platform-specific ones. The build still respects constraints — files for other platforms are vendored but skipped at compile time. This is correct but increases vendor directory size; for very large modules, use `go mod tidy` to drop unused.

---

## 10. Constraints and test files

```go
//go:build integration

package mypkg_test

func TestIntegration(t *testing.T) { ... }
```

Convention: `integration`, `e2e`, `slow` are common gates for tests that need real infrastructure or take a long time.

Run separately in CI:

```bash
go test ./...                            # unit
go test -tags=integration -run=Integration ./...   # integration
```

---

## 11. Constraints and `go generate`

`go generate` uses the current build context. To generate code for multiple platforms, you may need to invoke it multiple times:

```bash
GOOS=linux go generate ./...
GOOS=darwin go generate ./...
```

Or write generator scripts that produce all variants at once and let `go:build` select.

---

## 12. The "dummy package" trick

Sometimes you want a file that compiles on all platforms but only contains a build-tagged stub. Common idiom:

```go
//go:build linux

package syscaller

// LinuxOnlyFn does X. On other platforms, this function doesn't exist;
// callers must handle that via type assertion or constraint themselves.
func LinuxOnlyFn() { ... }
```

For callers who don't want to constrain themselves, expose a no-op shim:

```go
//go:build !linux

package syscaller

func LinuxOnlyFn() { panic("not implemented on this platform") }
```

Or return `errors.ErrUnsupported` (Go 1.21+) for graceful failure.

---

## 13. Vet, lint, and constraints

`go vet` runs against the active build context only. To vet all platforms:

```bash
for goos in linux darwin windows; do
    for goarch in amd64 arm64; do
        GOOS=$goos GOARCH=$goarch go vet ./...
    done
done
```

`golangci-lint`'s `-build-tags` flag includes additional tags in its analysis context. Without it, lint may miss issues in tag-gated files.

---

## 14. Common bugs

| Bug | Effect |
|-----|--------|
| Tag typo | File silently never compiled |
| Missing `&& !cgo` in pure-Go path | Two implementations both built — link error |
| `+build` line out of sync with `//go:build` | One is wrong; behavior depends on Go version |
| Constraint after the package clause | Ignored |
| Custom tag with no `-tags` invocation | File never compiled, no warning |

`go list -e -f '{{.IgnoredGoFiles}}'` is the diagnostic.

---

## 15. Summary

Senior build-constraint usage is about partitioning your package's source into clean, non-overlapping platform-specific implementations behind a neutral API, then verifying the partition is correct via CI matrix builds and vet sweeps. Tags are also the right tool for build-time feature selection and gating new language features. Avoid runtime checks when the answer is knowable at build time.

---

## Further reading
- Standard library `runtime/os_*.go` — many examples
- `klauspost/compress` — `purego` tag pattern
- `golang.org/x/sys/unix` — heavy use of file naming + constraints
