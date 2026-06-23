# Build Tags — Middle

## 1. Why build tags exist

A build tag answers one question: *should this file be part of the build?* Go uses this single mechanism for three different jobs:

1. **Per-platform code** — different `syscall` implementations for `linux`, `darwin`, `windows`.
2. **Per-architecture code** — `amd64` vs `arm64` assembly or intrinsics.
3. **Optional features** — gate experimental code, integration tests, dev tools, cgo paths.

The alternative is a runtime `if runtime.GOOS == "linux"` check, but that compiles all variants into the binary even when only one is reachable. Build tags drop the unused ones at the source level — smaller binary, cleaner code, and you can use platform-specific imports without "imported and not used" errors on the wrong OS.

---

## 2. Boolean expressions in `//go:build`

A constraint is a Boolean expression of identifiers joined with `&&`, `||`, `!`, and parentheses:

```go
//go:build linux && amd64
//go:build linux || darwin
//go:build !windows
//go:build (linux || darwin) && !arm64
//go:build cgo && (linux || darwin)
```

Operator precedence is the usual one (`!` > `&&` > `||`), and parentheses are honoured. This is significantly more readable than the legacy form, where space meant OR and comma meant AND inside a single line, with separate lines acting as additional ANDs:

```go
// +build linux darwin             // means: linux OR darwin
// +build amd64,!cgo              // means: amd64 AND NOT cgo
// +build linux                    // an extra line ANDs with the above
// +build amd64
```

That two-axis grammar is the main reason Go 1.17 introduced `//go:build`. New code should use the modern form; only touch the old syntax to migrate it.

---

## 3. Custom tags

Any identifier you make up becomes a tag you can pass with `-tags`:

```go
//go:build integration

package mypkg
```

```bash
go test -tags=integration ./...    # this file is now included
go test ./...                       # this file is excluded
```

By default no custom tags are set, so the file is excluded. Common conventions:

| Tag | Conventional meaning |
|-----|----------------------|
| `integration` | Tests that hit a real database or network |
| `e2e` | End-to-end browser/HTTP tests |
| `experimental` | Code not yet ready for default builds |
| `enterprise` / `pro` | Closed-source or paid features in a dual-build repo |

You can pass multiple at once: `-tags=integration,e2e`. The list is comma-separated for the flag, but inside `//go:build` you still use `&&` / `||`.

---

## 4. File-name suffix vs `//go:build` tag

The suffix and the explicit constraint do the same job, but with different ergonomics:

| Mechanism | Best for | Limitations |
|-----------|----------|-------------|
| `foo_linux.go` (file-name suffix) | One constraint on `GOOS`/`GOARCH` only | Cannot express `||`, custom tags, or `cgo` |
| `//go:build linux \|\| darwin` | Anything beyond a single OS/arch | Slightly more visual noise |

Rule of thumb: if your file is *just* for one OS or one arch, the suffix is shorter and the convention is obvious to readers. If you need OR, NOT, a custom tag, or `cgo`, use `//go:build`. You can also combine them — the file-name suffix is implicitly ANDed with the `//go:build` line.

---

## 5. Predefined tags

The Go tool sets a fixed set of tags for every build. The most useful:

| Tag | Meaning |
|-----|---------|
| `linux`, `darwin`, `windows`, `freebsd`, `openbsd`, `netbsd`, `dragonfly`, `solaris`, `plan9`, `js`, `wasip1`, ... | one tag per supported `GOOS` |
| `amd64`, `arm64`, `arm`, `386`, `mips64`, `riscv64`, ... | one tag per supported `GOARCH` |
| `cgo` | set when `CGO_ENABLED=1` and a cgo toolchain is available |
| `gc` / `gccgo` | which compiler is being used |
| `unix` | umbrella tag for Unix-like systems (Go 1.19+) |
| `boringcrypto` | the BoringSSL-backed build of Go |
| `go1.21`, `go1.22`, `go1.23`, ... | every released minor version up to and including the current toolchain |

The Go-version tags are stackable: a file with `//go:build go1.21` compiles on Go 1.21, 1.22, 1.23, and so on. Use them to opt into features available only in newer toolchains.

---

## 6. Multiple constraints in one file

`//go:build` allows a single Boolean line per file. To say "AND" with another condition, write the conjunction inside that one line:

```go
//go:build linux && amd64 && !cgo

package mypkg
```

Beginners coming from the old syntax sometimes try two `//go:build` lines, expecting them to be ANDed. They are not — only the first one counts; the second is just a comment. One constraint line per file.

---

## 7. The legacy form and why `gofmt` rewrites it

`gofmt` (and `go fix`) will, when run on a file containing `// +build`, automatically prepend an equivalent `//go:build` line above it. The output looks like this:

```go
//go:build linux && amd64
// +build linux,amd64

package mypkg
```

Both forms remain, and they must be **consistent**. If they disagree, `go vet` and modern `go` versions report an error. The legacy form will eventually be dropped, but as of Go 1.21+ both are still recognized.

When migrating an old repo: run `gofmt -w .` once, commit the result, then delete the `// +build` lines in a follow-up commit. The two-step keeps reviews readable.

---

## 8. A realistic example: optional integration tests

```go
// integration_test.go
//go:build integration

package billing

import "testing"

func TestStripeChargeReal(t *testing.T) {
    // hits a real Stripe sandbox account
}
```

```bash
go test ./...                       # fast: integration test skipped
go test -tags=integration ./...     # slow: includes the real-network test
```

This is the canonical pattern: regular `go test` stays fast for the inner loop, and CI explicitly opts into the slow tier with `-tags=integration`. No `t.Skip()` runtime check needed — the test file simply isn't compiled.

---

## 9. Tags and the `-tags` flag form

```bash
go build -tags=integration .
go test -tags="integration e2e" ./...   # space-separated also works in quotes
go build -tags=integration,e2e .         # comma-separated
GOFLAGS=-tags=integration go build .     # via env
```

`GOFLAGS` is useful in CI: set it once per job and every `go` command inherits it. Be careful, though — a globally set `-tags` can hide files you forgot you wrote, so prefer per-command flags during development.

---

## 10. Summary

Build tags are a Boolean condition over identifiers (`linux`, `cgo`, `amd64`, `integration`, ...) that decides whether the Go tool compiles a file. Use the modern `//go:build` form with `&&`, `||`, `!`; reach for file-name suffixes for the simple `GOOS`/`GOARCH` case. Predefined tags cover platforms, compiler, cgo, the `unix` umbrella, and per-version `go1.X`; custom tags let you gate integration tests, experimental features, or enterprise builds via `-tags=...`. The legacy `// +build` form is still accepted and `gofmt` keeps the two in sync during migration.

---

## Further reading
- `go help buildconstraint`
- Go 1.17 release notes (build constraint syntax): https://go.dev/doc/go1.17#build-constraints
- The `unix` build tag proposal: https://github.com/golang/go/issues/20322
