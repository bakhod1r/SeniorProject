# Build Constraints — Middle

## 1. The mental model

A build constraint is a predicate. For each `.go` file, the toolchain evaluates the predicate against the current build context (GOOS, GOARCH, tags, Go version, cgo flag, etc.). True → include; false → skip.

A package's source set is the union of files whose predicates are true. The same package may have wildly different content across platforms.

---

## 2. New vs. legacy syntax

```go
//go:build (linux || darwin) && amd64 && !cgo   // Go 1.17+
// +build linux darwin,amd64,!cgo                // legacy (less expressive)
```

The new syntax accepts a full Boolean expression. Legacy syntax uses commas (AND), spaces (OR), and `!` (NOT), and multiple `// +build` lines are AND-ed. Direct translation is mechanical; `gofmt` can do it.

For packages that need to compile with very old Go (pre-1.17), keep both. For everything else, drop the legacy line.

---

## 3. The blank-line rule

```go
//go:build linux
                       // blank line
package mypkg
```

Without the blank line, the comment is treated as a doc comment for `package`, and the constraint is silently ignored. `gofmt` enforces this and will reject files missing the blank line.

---

## 4. Filename suffixes are constraints

```
crypto.go             // always
crypto_amd64.go       //go:build amd64
crypto_arm64.go       //go:build arm64
crypto_amd64_test.go  //go:build amd64; only built with `go test`
```

When *both* a filename suffix and an explicit constraint are present, they're AND-ed. A file `fast_linux.go` with `//go:build amd64` requires both Linux and amd64.

---

## 5. Per-OS files: the unix pattern

Before Go 1.19:

```go
//go:build linux || darwin || freebsd || netbsd || openbsd
```

After 1.19:

```go
//go:build unix
```

`unix` is the meta-constraint. For Windows-specific code, no shorthand; just `//go:build windows`. (`!unix` works for "not unix-like".)

---

## 6. Combining tags

```go
//go:build linux && amd64 && cgo
//go:build (windows || darwin) && go1.20
//go:build !race && !msan
```

Standard Boolean precedence: `!` > `&&` > `||`. Use parentheses for clarity.

Custom tags can be combined too:

```go
//go:build prod && !debug
```

---

## 7. Custom build tags as feature flags

```go
//go:build experimental_caching

package cache

func init() { useExperimentalCaching = true }
```

Build with:

```bash
go build -tags=experimental_caching ./...
```

This bakes the decision into the binary. Useful for:

- A/B-testing two implementations.
- Optional, expensive instrumentation.
- A "debug" build with extra checks.

**Not** a replacement for runtime config — once the binary is built, you can't toggle without rebuilding.

---

## 8. The `gc` vs `gccgo` tag

```go
//go:build gc
package fast
// uses unsafe tricks specific to gc
```

```go
//go:build gccgo
package fast
// pure Go fallback
```

The standard `gc` compiler differs in subtle ways from `gccgo` (older alternative compiler). Most code never needs to discriminate, but performance-critical packages sometimes do.

---

## 9. The Go version tag

```go
//go:build go1.21

package modern
// uses slices.SortFunc, added in 1.21
```

When compiled with Go 1.20, this file is skipped. Pair with a fallback:

```go
//go:build !go1.21

package modern
// hand-rolled sort
```

This is the standard pattern for libraries that support multiple Go versions but want to use newer APIs when available.

---

## 10. Test-only files

A file ending in `_test.go` is built only for `go test`. Inside it, you may have additional build constraints:

```go
//go:build integration

package mypkg

func TestSlowIntegration(t *testing.T) { ... }
```

Run only with the tag:

```bash
go test -tags=integration ./...
```

Common patterns:

- `integration` for tests that hit a real DB.
- `e2e` for end-to-end tests.
- `manual` for tests that must be invoked deliberately.

---

## 11. Race-only or sanitizer-only code

```go
//go:build race

package mypkg

func init() { /* additional debug checks under -race */ }
```

Use sparingly. Most code shouldn't depend on whether the race detector is enabled — but for instrumentation libraries or tests of race-sensitive logic, the `race` tag is useful.

---

## 12. Cross-compilation interactions

```bash
GOOS=linux GOARCH=arm64 go build ./...
```

Build constraints work consistently across cross-compilation. The `GOOS` and `GOARCH` of the *target* drive selection, not the host. This is the standard way to produce Linux binaries from a macOS laptop without changing source.

---

## 13. Debugging which files are included

```bash
# Files actively built
go list -f '{{.GoFiles}}' .

# Files excluded by constraints
go list -e -f '{{.IgnoredGoFiles}}' .

# Files excluded by test mode
go list -e -f '{{.TestGoFiles}}' .
```

If a file isn't being compiled and you expected it to be, this is where to look. Common bug: a tag typo. The toolchain doesn't warn about unknown tags — it just treats them as never satisfied.

---

## 14. Constraints and editor tooling

`gopls` (the language server) needs to know which tags you intend, or it'll show "unused import" errors for files that don't compile with the default tag set.

`.vscode/settings.json`:

```json
{
    "gopls": {
        "build.buildFlags": ["-tags=prod,experimental"]
    }
}
```

For multi-tag projects, you may want multiple workspaces or run separate `gopls` instances with different tags. There's no perfect solution; document the dev setup in the README.

---

## 15. Patterns to remember

| Pattern | Use |
|---------|-----|
| File with `//go:build linux` | Linux-only implementation |
| File with `//go:build !linux` | Fallback for non-Linux |
| Pair of files `_cgo.go` and `_purego.go` | cgo-accelerated path with pure-Go fallback |
| File with `//go:build go1.21 && !go1.22` | Code that only works on a specific Go version |
| Test file with `//go:build integration` | Heavy tests gated behind a tag |

---

## 16. Anti-patterns

- **Tag soup.** A file with 5+ tags is usually a sign of bad factoring. Split.
- **Using `// +build` only** when you don't need to support pre-1.17 Go. Adopt `//go:build`.
- **Custom tags as runtime flags.** Use env vars or config files; tags bake into the binary.
- **Skipping tests with tags** when t.Skip() would do. Tags are for files; Skip is for individual tests.

---

## 17. Summary

Build constraints are file-level predicates that select source files based on platform, version, and custom tags. The new `//go:build` syntax is Boolean and expressive; legacy `// +build` lives on for back-compat. Implicit constraints from filename suffixes (`_linux.go`, `_test.go`) handle the common cases automatically. Use tags for compile-time configuration; use runtime flags for runtime configuration.

---

## Further reading
- `go help buildconstraint`
- `gopls` settings: https://github.com/golang/tools/blob/master/gopls/doc/settings.md
- `go list` reference: https://pkg.go.dev/cmd/go#hdr-List_packages_or_modules
