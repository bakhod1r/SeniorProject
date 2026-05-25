# Build Constraints — Find the Bug

Realistic build-constraint bugs with cause and fix.

---

## Bug 1: Missing blank line

```go
//go:build linux
package mypkg
```

**Symptom.** Build succeeds on macOS even though `mypkg` should be Linux-only.

**Cause.** The `//go:build` line is treated as a doc comment for `package` because there's no blank line between them.

**Fix.**

```go
//go:build linux

package mypkg
```

`gofmt` enforces this — running it would have caught the bug.

---

## Bug 2: Typo in OS name

```go
//go:build osx

package mypkg
```

**Symptom.** File never compiles, no error.

**Cause.** Go uses `darwin`, not `osx`. Unknown tag names are simply treated as false; there's no diagnostic.

**Fix.**

```go
//go:build darwin
```

When in doubt, list ignored files:

```bash
go list -e -f '{{.IgnoredGoFiles}}' .
```

---

## Bug 3: Both implementations included

```go
// crypto_a.go
//go:build linux
package crypto
func Hash(b []byte) []byte { ... }
```

```go
// crypto_b.go
package crypto    // forgot the constraint
func Hash(b []byte) []byte { ... }
```

**Symptom.** Build error: "Hash redeclared".

**Cause.** Both files contribute `Hash` on Linux. The second file has no constraint, so it's always built.

**Fix.** Add `//go:build !linux` to `crypto_b.go`.

---

## Bug 4: Neither implementation included

```go
// crypto_a.go
//go:build linux
package crypto
func Hash() []byte { ... }
```

```go
// crypto_b.go
//go:build windows
package crypto
func Hash() []byte { ... }
```

**Symptom.** "undefined: Hash" when building on macOS.

**Cause.** Neither file's constraint matches on Darwin. The partition isn't complete.

**Fix.** Add a fallback:

```go
// crypto_other.go
//go:build !linux && !windows
package crypto
func Hash() []byte { /* portable */ }
```

Or use `//go:build unix` etc. to widen coverage.

---

## Bug 5: Legacy `+build` out of sync

```go
//go:build linux && amd64
// +build linux,arm64
```

**Symptom.** Code compiles on amd64 with newer Go (which prefers `//go:build`), but on older Go reads the `+build` line and tries to build for arm64.

**Cause.** The two lines disagree. `gofmt` would normally keep them in sync — they likely got out of sync via manual edit.

**Fix.** Drop the `+build` line entirely if pre-1.17 support isn't needed:

```go
//go:build linux && amd64
```

If you must keep both, run `gofmt -w` to align them.

---

## Bug 6: Tag never set

```go
//go:build experimental

package experimental_feature

func DoIt() { ... }
```

**Symptom.** `experimental_feature.DoIt is unused` lint warning. Or worse, callers can't find it.

**Cause.** Nobody runs `go build -tags=experimental`. The file is excluded from all builds.

**Fix.** Either:

- Document the tag clearly in the README ("set `-tags=experimental` to enable").
- Remove the tag if the feature is ready for general use.

---

## Bug 7: Test that never runs

```go
//go:build integration

package mypkg

func TestExpensive(t *testing.T) { ... }
```

**Symptom.** The test never fails because CI never runs it.

**Cause.** No CI job sets `-tags=integration`.

**Fix.** Add a CI job:

```yaml
- run: go test -tags=integration ./...
```

Or remove the tag if the test should run in the default suite.

---

## Bug 8: `runtime.GOOS` instead of build tag

```go
package fs

func Walk(root string) error {
    if runtime.GOOS == "windows" {
        return errors.New("not supported on Windows")
    }
    return unixWalk(root)
}
```

**Symptom.** Compile fails on Windows: "undefined: unixWalk".

**Cause.** Mixing runtime checks with platform-only functions. The Windows build tries to compile `unixWalk` regardless of the runtime check.

**Fix.** Split into files:

```go
// fs_unix.go
//go:build unix
package fs
func Walk(root string) error { return unixWalk(root) }
```

```go
// fs_windows.go
//go:build windows
package fs
func Walk(root string) error { return errors.New("not supported") }
```

---

## Bug 9: Vet skips constrained files

```bash
go vet ./...
# clean
```

But Linux-only files have bugs that aren't reported on macOS.

**Cause.** `go vet` only inspects files in the active build context.

**Fix.** Run vet across all supported platforms in CI:

```bash
for goos in linux darwin windows; do
    GOOS=$goos go vet ./...
done
```

---

## Bug 10: `gopls` errors after switching branches

You switch to a branch that uses different tags. Your editor lights up with red squiggles.

**Cause.** `gopls` is configured for the old tag set.

**Fix.** Update `.vscode/settings.json` or `.gopls/settings.json`:

```json
{
    "gopls": {
        "build.buildFlags": ["-tags=integration,experimental"]
    }
}
```

Restart the language server.

---

## Bug 11: Constraint inside a test file ignored

```go
//go:build slow

// in slow_test.go
package mypkg

func TestSlow(t *testing.T) { ... }
```

`go test ./...` doesn't run `TestSlow`. But neither does `go test -tags=slow ./...`.

**Cause.** The first issue is that there's a missing blank line. The second: the file is still constrained even when tags match — if your `go test` doesn't include the tag, the file is skipped. Tests do **not** run by default just because they're in a `_test.go` file with a `//go:build` line.

**Fix.** Use `t.Skip()` for runtime-dependent skipping; reserve tags for "this file is excluded from the build".

---

## Bug 12: Custom tag picked up unexpectedly

```go
//go:build experimental
package code
```

```bash
go test -tags='integration experimental' ./...
```

You meant `integration` and `experimental` as two tags. Shell quoted, they look like a single space-separated string.

**Cause.** Spaces split `-tags` into multiple tag names. Sometimes the shell or build tool collapses them; sometimes they're parsed as one.

**Fix.** Always use commas:

```bash
go test -tags='integration,experimental' ./...
```

---

## Bug 13: File-name suffix not what you think

```
fastpath_linuxamd64.go
```

**Symptom.** File compiles on all platforms.

**Cause.** `_linuxamd64` isn't a recognized suffix. The runtime recognizes `_GOOS_GOARCH` (with an underscore separator).

**Fix.** Rename:

```
fastpath_linux_amd64.go
```

---

## 14. Summary

Build-constraint bugs cluster around: missing blank lines, OS-name typos, incomplete partitions, mixed runtime/build approaches, untagged CI commands, and editor configuration. The diagnostic tool — `go list -e -f '{{.IgnoredGoFiles}}'` — finds most of them in seconds. CI matrix builds catch the rest.

---

## Further reading
- `go help buildconstraint`
- `gofmt -w` for syncing legacy/modern tags
- `gopls` settings: https://github.com/golang/tools/blob/master/gopls/doc/settings.md
