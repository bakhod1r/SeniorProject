# Build Constraints — Specification

> **Focus:** Precise reference for Go build constraints (a.k.a. build tags) — the syntax, the semantics, and the inputs that determine whether a file is part of a build.
>
> **Sources:**
> - `go help buildconstraint`
> - `cmd/go` build constraints: https://pkg.go.dev/cmd/go#hdr-Build_constraints
> - Go 1.17 design: https://go.dev/design/draft-build-constraints

---

## 1. What a build constraint is

A build constraint is a line in a Go source file that tells the toolchain *under which conditions* the file should be compiled. If the constraint is false, the file is treated as if it didn't exist.

Two syntaxes:

```go
//go:build linux && amd64    // (Go 1.17+, preferred)

// +build linux,amd64         // legacy
```

Modern Go uses `//go:build`; the legacy `// +build` form is still accepted and `gofmt` keeps both in sync if both appear.

---

## 2. Placement rules

- Must appear *before* the `package` clause.
- Separated from the `package` clause by exactly one blank line.
- Each constraint line is processed independently.
- A file may contain at most one `//go:build` line.

Example:

```go
//go:build linux && amd64

package mypkg
```

`gofmt` enforces the blank line.

---

## 3. Expression grammar

`//go:build` expressions are Boolean expressions with:

- Identifiers: tag names (`linux`, `amd64`, `cgo`, custom tags).
- Operators: `&&`, `||`, `!`, parentheses.

```go
//go:build (linux || darwin) && amd64 && !cgo
```

Legacy `// +build` uses different syntax:

- Comma is `AND`.
- Space is `OR`.
- `!` prefix is `NOT`.
- Multiple `// +build` lines are AND-ed.

Translation example: `// +build linux,!cgo` becomes `//go:build linux && !cgo`.

---

## 4. Predefined tags

Build constraints can reference:

| Category | Examples |
|----------|----------|
| OS (`GOOS`) | `linux`, `darwin`, `windows`, `freebsd`, `wasip1`, `js`, `plan9` |
| Architecture (`GOARCH`) | `amd64`, `arm64`, `arm`, `386`, `wasm`, `ppc64le` |
| Compiler | `gc`, `gccgo` |
| Cgo | `cgo` |
| Race | `race` |
| Mutex profiling | `msan`, `asan` |
| Go version | `go1.20`, `go1.21`, `go1.22` (matches the current build's version *or later*) |
| Boring crypto | `boringcrypto` |

A complete list lives in `go/build`'s `Default.ReleaseTags`.

---

## 5. File-name implicit constraints

Filenames ending in `_GOOS.go`, `_GOARCH.go`, or `_GOOS_GOARCH.go` carry implicit constraints based on the suffix:

```
fastpath_linux.go       → //go:build linux
fastpath_linux_amd64.go → //go:build linux && amd64
fastpath_test.go        → only built for `go test`
```

These take effect **in addition** to any explicit `//go:build` line.

---

## 6. Test file conventions

| Filename | Built when |
|----------|------------|
| `foo_test.go` | `go test`; not in regular builds |
| `foo_linux_test.go` | `go test` on Linux |
| `example_test.go` | Same as `*_test.go` |

The `_test` suffix is a sharper constraint than any tag — tests never appear in `go build`.

---

## 7. Custom tags

You can define arbitrary tags:

```go
//go:build prod
package config
```

Then build:

```bash
go build -tags=prod ./...
go build -tags='prod,debug' ./...
```

`-tags` accepts a comma-separated list. Use sparingly — feature flags as build tags lock behavior into the binary; runtime flags or env vars are usually better.

---

## 8. Multiple files for the same package

A package may contain files with different constraints:

```
mypkg/
  api.go                // common
  api_linux.go          // Linux only
  api_windows.go        // Windows only
  api_unix.go           // //go:build unix
```

`unix` is a meta-tag (Go 1.19+) that matches Linux, macOS, BSD families.

Each file is independently selected. The package is the union of files whose constraints pass.

---

## 9. Build cache interaction

Build caches are keyed by:

- Go source content
- Build tags (the exact `-tags` set)
- Target platform (`GOOS`, `GOARCH`)
- Toolchain version
- A few env vars (`CGO_ENABLED`, `CC`, etc.)

So `go build` and `go build -tags=foo` use disjoint cache entries. Switching frequently between tag sets keeps multiple sets warm.

---

## 10. `go list` interactions

```bash
go list -f '{{.GoFiles}}' ./...                 # files in the default build
go list -tags=prod -f '{{.GoFiles}}' ./...      # files in the prod build
go list -e -f '{{.IgnoredGoFiles}}' ./...       # files excluded by constraints
```

Useful for verifying which files contribute to a given build, especially when debugging "why isn't my code being compiled?" issues.

---

## 11. Constraint inheritance into vet, lint, generate

| Tool | Respects constraints? |
|------|-----------------------|
| `go build` | Yes |
| `go test` | Yes |
| `go vet` | Yes |
| `go generate` | Yes (uses the current `GOOS`/`GOARCH`) |
| `golangci-lint` | Yes (with `-build-tags`) |
| `goimports` | Yes |
| Editor LSP (`gopls`) | Yes (with `build.buildFlags`) |

For a multi-platform package, configure your editor's gopls to include multiple tag sets, or you'll get spurious "unused import" warnings.

---

## 12. Negative constraints

```go
//go:build !cgo
```

The file is built only when cgo is disabled. Useful for providing a pure-Go fallback alongside a cgo-accelerated path:

```
crypto_cgo.go    //go:build cgo
crypto_purego.go //go:build !cgo
```

---

## 13. The `unix` meta-constraint

```go
//go:build unix
```

Matches `linux`, `darwin`, `freebsd`, `netbsd`, `openbsd`, `aix`, `dragonfly`, `solaris`. Introduced Go 1.19. Replaces the older hand-written union.

---

## 14. Version constraints

```go
//go:build go1.21
```

The file is built when compiling with Go 1.21 or later. This is the standard way to gate code on a new language feature or stdlib API. For an older toolchain, the file is skipped entirely.

`go1.X` does not match Go releases *before* `1.X`; the comparison is `>=`.

---

## 15. Common pitfalls

| Pitfall | Symptom |
|---------|---------|
| No blank line before `package` | Constraint is ignored |
| `//go:build` in middle of file | Ignored |
| Forgetting `+build` legacy line on older Go versions | File missing on old toolchains |
| Tag typo (e.g., `darwin` vs `osx`) | File never built |
| Build cache mismatches across tag sets | Mysterious "stale" builds |

---

## 16. Related references

- `go help buildconstraint`
- `go/build` documentation: https://pkg.go.dev/go/build
- Go 1.17 release notes (`//go:build` introduction)
- Cross-compilation: [10-go-toolchain](../../10-go-toolchain/)
