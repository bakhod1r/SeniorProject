# go build — Find the Bug

Each scenario looks fine but misbehaves. Find the defect, explain it, fix it.

---

## Bug 1 — No binary appears

```bash
$ go build ./internal/calc
$ ls
# no executable
```

**Bug:** `internal/calc` is a library package (`package calc`), not `package main`. `go build` type-checks it but writes no binary.
**Fix:** build the `main` package (`go build ./cmd/app`), or `-o /dev/null ./...` if you only wanted a compile check.

---

## Bug 2 — `-o` placed after the package

```bash
$ go build . -o app
# named files must be .go files: -o
```

**Bug:** `-o` is a build flag and must come before the package path; here Go treats `-o`/`app` as inputs.
**Fix:** `go build -o app .`.

---

## Bug 3 — Static image crashes at runtime

```dockerfile
RUN go build -o /app ./cmd/server      # CGO_ENABLED defaults to 1 here
FROM scratch
COPY --from=build /app /app
```

```
exec /app: no such file or directory
```

**Bug:** the binary dynamically links libc (cgo on), but `scratch` has no libc, so it cannot load.
**Fix:** build statically: `CGO_ENABLED=0 go build -o /app ./cmd/server`.

---

## Bug 4 — cgo cross-compile fails

```bash
$ GOOS=linux GOARCH=arm64 go build .
# gcc: error: unrecognized command-line option '-arch'... / cgo: C compiler not found
```

**Bug:** `CGO_ENABLED=1` (default on the host) needs a Linux/arm64 C cross-compiler, which is absent.
**Fix:** `CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build .` (if no cgo is required), or install/configure a cross C toolchain.

---

## Bug 5 — Build fails in Docker with VCS error

```
error obtaining VCS status: exit status 128
```

**Bug:** Go tries to stamp VCS info but the build context has no `.git` directory.
**Fix:** `go build -buildvcs=false ...`, or `COPY .git` into the build context if you want the stamp.

---

## Bug 6 — Version shows "dev" despite ldflags

```bash
go build -ldflags="-X version=1.2.3" -o app .   # var is main.version
```

**Bug:** the `-X` target must be the **fully qualified** `importpath.name`. `version` alone does not match `main.version`.
**Fix:** `go build -ldflags="-X main.version=1.2.3" -o app .`. For a non-main package: `-X example.com/app/build.Version=1.2.3`.

---

## Bug 7 — Panic stack traces have no symbols

```bash
go build -ldflags="-s -w" -o app .   # shipped as the debug build
```

**Bug:** `-s -w` strip the symbol table and DWARF; debugging and symbol-aware profiling are crippled. Fine for release, wrong for a build you need to debug.
**Fix:** build debug artifacts without `-s -w` (and add `-gcflags="all=-N -l"` for delve).

---

## Bug 8 — `-o dir` with one main, expecting a file

```bash
$ go build -o dist ./cmd/app && ./dist
# "dist" might be a directory or file depending on trailing slash and existence
```

**Bug:** ambiguity between file and directory output. With `-o dist/` (trailing slash) Go writes a binary *inside* `dist/`; without it, `dist` is the file name — but if `dist/` already exists as a directory, behavior surprises people.
**Fix:** be explicit: `-o dist/app` for a named file in a directory you control, and create the directory first.

---

## Bug 9 — Rebuild "fixes" a stale result via `-a`

```bash
go build -a ./...   # used routinely "to be safe"; CI now takes 10x longer
```

**Bug:** `-a` forces rebuilding every package every time, defeating the cache. It is almost never necessary.
**Fix:** rely on the cache. If you suspect corruption, `go clean -cache` once, not `-a` on every build.

---

## How to approach these
1. No binary? → is it `package main`?
2. Flag ignored/errored? → flags go before the package; `-X` needs `importpath.name`.
3. Crashes in a minimal image? → `CGO_ENABLED=0` for static linking.
4. Fails in CI/Docker? → check `-buildvcs` and the C toolchain for cgo.
5. Slow CI? → stop using `-a`; cache instead.
