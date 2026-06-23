# Build Constraints — Interview

Common interview questions on Go build constraints.

---

## Q1. What's the modern syntax for a build constraint?

```go
//go:build linux && amd64

package mypkg
```

Note the lowercase `go:build` (no space) and the required blank line before `package`.

---

## Q2. What's the difference between `//go:build` and `// +build`?

`//go:build` is the new syntax (Go 1.17+) using full Boolean expressions. `// +build` is the legacy syntax using commas (AND) and spaces (OR). New code should use `//go:build`; legacy files often have both for back-compat, kept in sync by `gofmt`.

---

## Q3. Where must `//go:build` appear?

Before the `package` clause, with a single blank line between it and `package`. Only one `//go:build` line per file.

---

## Q4. What's the difference between a build constraint and a runtime `if runtime.GOOS == "linux"` check?

The constraint is evaluated at build time — files are included or excluded from the build. The runtime check happens at execution time and requires the platform-specific code to compile on all platforms.

Use constraints for code that won't even compile on the wrong platform (syscalls, assembly), runtime checks for behavior tweaks where the code is portable.

---

## Q5. Name some common predefined tags.

- OS: `linux`, `darwin`, `windows`, `freebsd`, etc.
- Arch: `amd64`, `arm64`, `arm`, `386`, `wasm`.
- Compiler: `gc`, `gccgo`.
- Features: `cgo`, `race`, `msan`, `boringcrypto`.
- Version: `go1.21`, `go1.22`, etc.
- Meta: `unix` (any unix-like OS).

---

## Q6. What does `//go:build go1.21` mean?

The file is compiled when the toolchain is Go 1.21 or later. Used to gate code on new language features or stdlib APIs while still supporting older Go versions through a parallel file.

---

## Q7. How do filename suffixes work as constraints?

A file named `foo_linux.go` is implicitly constrained to Linux. `foo_linux_amd64.go` is Linux on amd64. `foo_test.go` is only built for `go test`. These work in addition to any explicit `//go:build` line.

---

## Q8. How do you build with a custom tag?

```bash
go build -tags=experimental ./...
go build -tags='integration,experimental' ./...
```

Tags are comma-separated; spaces will misbehave depending on shell quoting.

---

## Q9. Why doesn't my file compile? It has `//go:build linux`.

Common causes:

1. Missing blank line before `package`.
2. Typo in the tag (`osx` instead of `darwin`).
3. The tag isn't set (`-tags=foo` isn't passed).
4. You're building for a different platform.

Diagnose with `go list -e -f '{{.IgnoredGoFiles}}' .`.

---

## Q10. How would you provide a cgo-accelerated path with a pure-Go fallback?

```go
//go:build cgo && !purego
// fast path using cgo
```

```go
//go:build !cgo || purego
// pure Go fallback
```

Callers pass `-tags=purego` to force the fallback.

---

## Q11. How do you support test categorization (unit vs integration)?

```go
//go:build integration

package mypkg

func TestIntegration(t *testing.T) { ... }
```

Run with `go test -tags=integration ./...`. Pair with separate CI jobs to keep the fast tier on every push and slower tiers on PRs.

---

## Q12. What's the `unix` meta-tag?

Introduced Go 1.19. Matches any unix-like OS: Linux, macOS, BSD family, AIX, Solaris. Replaces the older hand-written union like `linux || darwin || freebsd || ...`.

---

## Q13. How would you ensure a binary is fully static?

```bash
CGO_ENABLED=0 go build -tags='netgo,osusergo' -ldflags='-s -w' ./cmd/app
```

`CGO_ENABLED=0` disables cgo. `netgo` and `osusergo` ensure the `net` and `os/user` packages use pure-Go resolvers instead of libc calls.

---

## Q14. What does `-ldflags='-s -w'` do?

`-s` strips the symbol table; `-w` strips DWARF debug info. Together they reduce binary size by ~10-20%. Use in release builds; not in dev builds where you want full stack traces.

---

## Q15. How does the build cache interact with tags?

Each tag combination is a separate cache entry. Switching between `-tags=foo` and `-tags=bar` doesn't share compiled package objects, but each set caches independently. Long-lived projects with many tag combinations need adequate `GOCACHE` size.

---

## Q16. What happens if a `//go:build` expression contains an unknown tag?

The unknown tag evaluates to `false`. The file is skipped, and no diagnostic is emitted. This makes typos silent — always verify with `go list`.

---

## Q17. Why might `go vet` miss issues in some files?

`go vet` runs on the current build context only. Files for other platforms aren't seen. Run vet across all supported `GOOS`/`GOARCH` pairs in CI to cover everything.

---

## Q18. Can a test file have a build constraint?

Yes — both via filename (`_test.go` only built for `go test`) and explicit `//go:build` lines. Common pattern: `//go:build integration` for tests requiring real infrastructure.

---

## Q19. How do you check which Go version your build uses tags from?

`go version -m ./binary` prints embedded metadata including the toolchain version and build settings (with most tags reflected). `go env GOTOOLCHAIN` shows the active toolchain.

---

## Q20. Bonus — how would you migrate a library from old `// +build` to new `//go:build`?

Run `gofmt -w ./...`. `gofmt` recognizes both syntaxes and produces output containing both lines in sync. Once you no longer need to support pre-1.17 Go, you can drop the legacy `// +build` lines manually.

---

## Cheat sheet

- Syntax: `//go:build <expr>` then blank line then `package`.
- Operators: `&&`, `||`, `!`, parentheses.
- Tags: OS, arch, cgo, race, version, custom.
- Custom via `-tags=foo,bar`.
- Filenames: `_linux.go`, `_amd64.go`, `_test.go` are implicit.
- Diagnose with `go list -e -f '{{.IgnoredGoFiles}}'`.

---

## Further reading
- `go help buildconstraint`
- `cmd/go` build constraints reference
