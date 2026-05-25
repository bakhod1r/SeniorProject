# Compiler & Linker Flags — Find the Bug

Common flag-related bugs with cause and fix.

---

## Bug 1: `-X` injection doesn't work

```go
const version = "dev"   // const, not var
```

```bash
go build -ldflags="-X main.version=1.2.3" ./...
# version is still "dev" at runtime
```

**Cause.** `-X` only works on `var` declarations of type `string`. Constants and other types are ignored.

**Fix.**

```go
var version = "dev"
```

---

## Bug 2: `-X` injection silently misses

```bash
go build -ldflags="-X version=1.2.3" ./...   # missing package
```

**Cause.** The flag's argument must be `<package>.<var>=<value>`. Without the package, the linker can't find the variable.

**Fix.**

```bash
go build -ldflags="-X main.version=1.2.3" ./...
```

For non-main packages: `-X "example.com/pkg/buildinfo.Version=1.2.3"`.

---

## Bug 3: Stripped binary refuses to debug

```bash
go build -ldflags='-s -w' ./...
delve exec ./app   # symbols missing
```

**Cause.** `-s` strips the symbol table; `-w` strips DWARF. Debuggers need both.

**Fix.** Build without stripping for debugging:

```bash
go build ./...     # default keeps everything
delve exec ./app
```

Or use a separate dev build target in your Makefile.

---

## Bug 4: Stale build picks up old code

```bash
go build ./...
# Code unchanged externally; but a flag changed
```

**Cause.** Build cache. Flags are part of the cache key. Changing `-tags`, `-gcflags`, etc., picks the right cache slot. But sometimes the binary is taken from a stale build directory.

**Fix.**

```bash
go clean -cache       # nuclear
go clean              # current package
rm ./binary && go build .
```

Usually the issue is that you're not running the binary you just built — check the path.

---

## Bug 5: `-race` build fails on cross-compile

```bash
GOOS=linux GOARCH=arm64 go build -race ./...
# race detector not supported on this platform
```

**Cause.** Race detector requires platform-specific runtime support; not all combinations are available.

**Fix.** Build `-race` only on the same architecture you'll run it. For CI, use a matching runner OS/arch.

---

## Bug 6: PGO profile mismatched to code

```bash
go build -pgo=old.pgo ./cmd/app
# warning: profile is outdated or doesn't match
```

**Cause.** Profiles capture function names and call patterns. After significant code changes, the profile may reference functions that no longer exist.

**Fix.** Refresh the profile from the current binary running representative load. The compiler still uses what matches and ignores the rest.

---

## Bug 7: Cross-compiled cgo binary fails

```bash
GOOS=linux GOARCH=arm64 go build ./...
# undefined reference to _C__cgo_...
```

**Cause.** Default `CC=gcc` can't cross-compile. cgo packages can't cross-build with the host compiler.

**Fix.** Either:

```bash
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build ./...
```

Or specify a cross-compiler:

```bash
CC=aarch64-linux-gnu-gcc CGO_ENABLED=1 GOOS=linux GOARCH=arm64 go build ./...
```

---

## Bug 8: `-trimpath` confuses an IDE

After building with `-trimpath`, your IDE's "go to source from stack trace" feature stops working.

**Cause.** `-trimpath` replaces local paths with package paths, which the IDE can't resolve to your specific clone.

**Fix.** Don't use `-trimpath` for local dev builds; reserve it for release.

---

## Bug 9: Embedded `default.pgo` not picked up

```bash
go build -pgo=auto ./cmd/app
# but PGO isn't applied
```

**Cause.** `-pgo=auto` looks for `default.pgo` *next to the main package directory*. If your `default.pgo` is at the repo root, it's not found.

**Fix.** Move the file:

```bash
mv default.pgo cmd/app/default.pgo
go build -pgo=auto ./cmd/app
```

Or use an explicit path: `-pgo=./default.pgo`.

---

## Bug 10: `GOFLAGS` interferes

```bash
go env GOFLAGS    # -trimpath -tags=prod
go build ./...
# always builds with -trimpath and prod tag, unexpectedly
```

**Cause.** `go env -w GOFLAGS=...` was set previously and persists.

**Fix.**

```bash
go env -u GOFLAGS    # unset
```

Or override per-invocation:

```bash
GOFLAGS='' go build ./...
```

---

## Bug 11: Static link fails on glibc

```bash
go build -ldflags='-linkmode=external -extldflags="-static"' ./...
# /usr/lib/.../libc.so: error: cannot find -lc
```

**Cause.** Most glibc-based distros don't ship full static libs.

**Fix.** Build inside Alpine (musl) which does:

```bash
docker run --rm -v "$PWD:/src" -w /src golang:1.24-alpine \
  sh -c 'apk add --no-cache build-base && go build -ldflags="-linkmode=external -extldflags=-static" ./...'
```

---

## Bug 12: `-buildvcs` failure in CI

```bash
go build ./...
# error: .git is read-only or VCS info unavailable
```

**Cause.** Some CI environments use shallow clones, detached HEADs, or read-only filesystems. Go's VCS info embedding fails or warns.

**Fix.** Disable explicitly:

```bash
go build -buildvcs=false ./...
```

---

## Bug 13: `-gcflags='-m'` floods output

```bash
go build -gcflags='-m' ./... 2>&1 | wc -l
# 50000 lines
```

**Cause.** `-m` prints for every package in the build, including stdlib.

**Fix.** Constrain with a pattern:

```bash
go build -gcflags='example.com/myproj/...=-m' ./...
```

Now only your packages are reported.

---

## 14. Summary

Flag bugs cluster around: silent failures (typo in `-X` target, missing package prefix), build cache confusion, cross-compilation toolchain mismatches, environment-variable surprises (`GOFLAGS`), and PGO file location. Each is preventable with a clear Makefile and CI configuration.

---

## Further reading
- `go help build`, `go help buildflags`
- `go env`: env-controlled defaults
