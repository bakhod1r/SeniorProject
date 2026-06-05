# The Linker — Find the Bug

Fourteen real-world linker traps. For each: the **code/command**, the
**symptom**, the **cause**, and the **fix**. Cover the `-X` family, stripping
side effects, cgo/static linking, plugins, deadcode + reflection, buildinfo, and
reproducibility. Read the symptom first and try to diagnose before peeking.

---

## Bug 1 — `-X` sets a `const`, version stays "dev"

```go
const version = "dev"   // ← const!
```
```bash
go build -ldflags="-X main.version=1.4.2" -o app .
./app   # prints "dev"
```

**Symptom:** No error, but the value never changes.
**Cause:** `-X` only patches package-level **`var` of type `string`**. A `const`
is folded into the code by the compiler; the linker has nothing to overwrite and
**silently ignores** the flag.
**Fix:** make it a `var`.

```go
var version = "dev"
```

---

## Bug 2 — Wrong import path in `-X`

```bash
# main.go is in package main, but the var lives in internal/build
go build -ldflags="-X build.Version=1.4.2" -o app ./cmd/app
```

**Symptom:** Value unchanged; no error.
**Cause:** The path must be the **full import path**, not the short package name.
`build.Version` doesn't identify a real symbol.
**Fix:**

```bash
go build -ldflags="-X github.com/you/app/internal/build.Version=1.4.2" -o app ./cmd/app
```

Verify with `go version -m app | grep ldflags`.

---

## Bug 3 — Spaces in `-X` value break the build

```bash
go build -ldflags="-X main.banner=Hello World -X main.v=1.0" .
```

**Symptom:** `banner` becomes `Hello`, and `World` is parsed as a stray flag →
error or garbage.
**Cause:** `-ldflags` splits on spaces; the value `Hello World` isn't quoted.
**Fix:** quote the individual `-X` argument:

```bash
go build -ldflags="-X 'main.banner=Hello World' -X main.v=1.0" .
```

---

## Bug 4 — `-X` on a non-string var

```go
var buildNumber int   // int, not string
```
```bash
go build -ldflags="-X main.buildNumber=42" .
```

**Symptom:** `buildNumber` stays 0.
**Cause:** `-X` only works on **strings**. Non-string targets are ignored.
**Fix:** stamp a string, convert in code.

```go
var buildNumberStr = "0"
var buildNumber, _ = strconv.Atoi(buildNumberStr)
// -ldflags="-X main.buildNumberStr=42"
```

---

## Bug 5 — `strip` run on a Go binary kills stack-trace names

```bash
go build -o app .
strip app          # the system strip, not -ldflags
./app              # panic shows  pc=0x... with no function names
```

**Symptom:** Panics/`runtime.Callers` lose function names and line numbers.
**Cause:** External `strip` removed `.gopclntab` (or corrupted it). Unlike
`-s -w`, the runtime *needs* pclntab.
**Fix:** never run system `strip` on Go binaries. Strip at link time:

```bash
go build -ldflags="-s -w" -o app .   # keeps .gopclntab; names still print
```

---

## Bug 6 — Expecting `dlv` to work after `-s -w`

```bash
go build -ldflags="-s -w" -o app .
dlv exec ./app
```

**Symptom:** `could not open debug info` / no source-level debugging.
**Cause:** `-w` stripped DWARF, `-s` stripped the symbol table. Delve needs
DWARF.
**Fix:** build a separate **debug** binary without `-s -w` for debugging; ship
the stripped one. Don't mix the two goals in one artifact.

---

## Bug 7 — cgo forces external link; static build fails

```bash
CGO_ENABLED=1 go build -ldflags='-extldflags=-static' -o app .
# /usr/bin/ld: cannot find -lpthread: No such file or directory
```

**Symptom:** Host-linker error about missing static C libraries.
**Cause:** `-extldflags=-static` asks the **host** linker for a fully static
binary, but the static versions of `libc`/`libpthread` aren't installed.
**Fix:** either install static libs (`glibc-static`/musl static), or drop cgo:

```bash
CGO_ENABLED=0 go build -o app .   # pure-Go static, no host linker needed
```

---

## Bug 8 — Alpine binary won't start (glibc vs musl)

```dockerfile
FROM golang:1.22 AS build
RUN go build -o /app .            # CGO_ENABLED=1 by default here
FROM alpine
COPY --from=build /app /app
CMD ["/app"]                      # "/app: not found"
```

**Symptom:** `not found` even though the file exists.
**Cause:** Default cgo build dynamically linked against **glibc**; Alpine ships
**musl**. The dynamic loader can't satisfy it.
**Fix:**

```dockerfile
RUN CGO_ENABLED=0 go build -o /app .   # portable static binary
```

(or use a glibc base like `debian:slim`/`distroless`.)

---

## Bug 9 — Plugin version skew

```bash
# host built with go1.22.3, dep x v1.2.0
# plugin built later with go1.22.5, dep x v1.3.0
```
```go
p, _ := plugin.Open("handler.so")  // panics at Open
```

**Symptom:** `plugin was built with a different version of package x` (or of the
Go runtime).
**Cause:** Plugins require **byte-compatible** runtime + every shared
dependency. Any version/flag/GOOS/GOARCH skew is rejected.
**Fix:** build host and plugin in the **same CI job**, same Go toolchain, same
`go.sum`, same flags. Pin `GOTOOLCHAIN`. Consider replacing plugins with
subprocess+RPC.

---

## Bug 10 — Deadcode drops a reflectively-used method

```go
type Handler struct{}
func (Handler) Serve() {}      // only ever called via reflection

v := reflect.ValueOf(Handler{})
m := v.MethodByName("Serve")   // panics: method not found, or works only sometimes
```

**Symptom:** `MethodByName("Serve")` returns a zero Value / "method not found",
or fails only in the optimized release build.
**Cause:** If `Handler` is never boxed into an interface and `Serve` is never
called directly, the linker may **eliminate** it — *unless* it detects
reflection keeping methods alive. In trimmed builds, methods reachable only by
name can be dropped.
**Fix:** ensure the linker sees the method as needed — e.g. reference it (assign
the type to an interface that has the method, or keep an explicit reference), or
rely on the fact that calling `MethodByName` anywhere flips the
reflect-keeps-methods flag. The robust fix is to avoid name-only liveness:

```go
var _ interface{ Serve() } = Handler{}   // forces the method set to stay live
```

---

## Bug 11 — `-trimpath` missing → non-reproducible / leaked paths

```bash
go build -ldflags="-s -w" -o app .
go version -m app | grep -i path
# embeds /home/ci-runner-7/go/src/...  (leaks layout, differs per machine)
```

**Symptom:** Two CI machines produce different binaries; panics show the build
host's directory.
**Cause:** Without `-trimpath`, absolute paths are embedded in
pclntab/buildinfo.
**Fix:**

```bash
go build -trimpath -ldflags="-s -w" -o app .
```

---

## Bug 12 — `vcs.modified=true` in a "clean" release

```bash
go version -m app | grep vcs
#   build  vcs.modified=true
```

**Symptom:** Release stamped as dirty even from a tagged commit.
**Cause:** The build tree had **uncommitted changes** (often a generated file or
`go.sum` touched), or CI checked out without a clean working tree.
**Fix:** ensure a clean checkout before building; add generated files to
`.gitignore` or commit them; verify `git status` is clean in CI before
`go build`.

---

## Bug 13 — `-buildvcs` fails the build in a container without `.git`

```bash
go build -o app .
# error obtaining VCS status: exit status 128 ... use -buildvcs=false
```

**Symptom:** Build error referencing VCS status.
**Cause:** Since Go 1.18 the toolchain tries to stamp VCS info, but the build
context (e.g. a Docker `COPY` without `.git`) has no git metadata, and Go
refuses to silently skip.
**Fix:** either include `.git` in the build context, or disable stamping:

```bash
go build -buildvcs=false -o app .
```

---

## Bug 14 — `//go:linkname` reference breaks on newer Go

```go
//go:linkname secret runtime.someInternal
func secret()
```
```bash
go build .
# link: missing function body / disallowed by checklinkname (Go 1.23+)
```

**Symptom:** Link fails referencing a runtime-internal symbol that used to work.
**Cause:** Go 1.23 tightened `//go:linkname` — pulling private runtime symbols
that aren't on the allowlist is now blocked by the linker
(`-checklinkname`).
**Fix:** stop relying on internal symbols (use a public API). As a temporary
escape hatch only:

```bash
go build -ldflags=-checklinkname=0 .
```

This is a smell — the real fix is to not depend on unexported runtime internals.

---

## Summary

| # | Trap | One-line fix |
| --- | --- | --- |
| 1 | `-X` on `const` | use a `var` |
| 2 | wrong `-X` path | full import path |
| 3 | spaces in `-X` | quote the `-X` arg |
| 4 | `-X` on non-string | stamp string, convert in code |
| 5 | system `strip` | strip via `-ldflags=-s -w` |
| 6 | `dlv` after `-s -w` | keep a separate debug binary |
| 7 | static cgo missing libs | `CGO_ENABLED=0` or install static libs |
| 8 | Alpine glibc/musl | `CGO_ENABLED=0` or glibc base |
| 9 | plugin skew | identical toolchain/deps/flags |
| 10 | deadcode drops method | force method set live via interface |
| 11 | no `-trimpath` | add `-trimpath` |
| 12 | `vcs.modified` | clean checkout |
| 13 | `-buildvcs` no `.git` | include `.git` or `-buildvcs=false` |
| 14 | `//go:linkname` blocked | use public API (last resort `-checklinkname=0`) |

The through-line: the linker silently ignores some misuses (`-X` on
const/non-string), so always **verify** with `go version -m` and `go tool nm`
instead of trusting that a flag "took."

---

## Further reading

- [`cmd/link` flags](https://pkg.go.dev/cmd/link)
- [`plugin` caveats](https://pkg.go.dev/plugin)
- [Go 1.23 `//go:linkname` restrictions](https://go.dev/doc/go1.23)
- [Reproducible builds / `-trimpath`](https://go.dev/blog/rebuild)
- [`debug/buildinfo`](https://pkg.go.dev/debug/buildinfo)
