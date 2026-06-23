# Building Executables — Junior

## 1. What is a "production binary"?

A **production binary** is a Go executable you intend to ship: to a server, a Docker image, a release page, or a customer's machine. It is fundamentally the same kind of file `go build` produces during development, but it is built with deliberate flags so that it is:

- **Versioned** — you can ask the running binary which release it is.
- **Reproducible** — the same source produces the same bytes.
- **Self-contained** — it does not need Go installed on the target.
- **Right-sized** — it is not carrying debug junk you do not need in production.

`go run` is for the inner loop. `go build` is for shipping. A production binary is what `go build` produces when you take the artifact seriously.

---

## 2. Debug build vs release build

| Aspect | Debug build (`go build`) | Release build |
|--------|--------------------------|---------------|
| Symbols / DWARF | Included (helps debuggers and `pprof`) | Often stripped (`-ldflags="-s -w"`) |
| Build paths | Embedded (your home directory leaks) | Removed (`-trimpath`) |
| Version variable | Default `"dev"` | Injected via `-ldflags="-X main.version=..."` |
| Size | Bigger | Smaller |
| Goal | Easy to debug locally | Small, portable, attributable |

The distinction is not about a flag named "release" — Go has no such mode. A release build is just a debug build minus the developer-friendly noise plus deliberate metadata.

---

## 3. The minimal production build

```bash
go build -o app .
./app
```

This produces a real file `app` in the current directory and runs it. The file is yours to ship, copy into a container, or upload to a release.

If your binary lives under `cmd/<name>` (the standard layout):

```
myproj/
  go.mod
  cmd/
    api/
      main.go
  internal/
    ...
```

build it explicitly:

```bash
go build -o bin/api ./cmd/api
```

The `cmd/<name>` convention means one repository can produce several binaries (`cmd/api`, `cmd/worker`, `cmd/migrate`) without colliding.

---

## 4. Naming and versioning the output

The default output name comes from the package's directory (or the module path's last segment). Override it with `-o`:

```bash
go build -o bin/api ./cmd/api
```

A common convention for release artifacts encodes the version and target platform in the name:

```
api-v1.2.3-linux-amd64
api-v1.2.3-darwin-arm64
api-v1.2.3-windows-amd64.exe
```

This lets you upload all of them to one releases page without overwrites.

---

## 5. Embedding a version variable

The classic pattern: declare a package-level variable, then overwrite it at link time.

```go
package main

import "fmt"

var version = "dev"

func main() {
    fmt.Println("api version:", version)
}
```

Build with the version injected:

```bash
go build -ldflags="-X main.version=v1.2.3" -o api ./cmd/api
./api
# api version: v1.2.3
```

Without the `-ldflags`, the same binary prints `version: dev`. The variable must be:

- a **package-level** `var` (not a constant — constants are inlined),
- a **string** (the `-X` flag only sets strings),
- referenced by its **full import path** (`main.version`, `github.com/me/proj/internal/build.Version`, etc.).

You usually compute the version from git:

```bash
VERSION=$(git describe --tags --always --dirty)
go build -ldflags="-X main.version=${VERSION}" -o api ./cmd/api
```

---

## 6. A typical small release script

```bash
#!/usr/bin/env bash
set -euo pipefail

VERSION=$(git describe --tags --always --dirty)
OUT="bin/api-${VERSION}-$(go env GOOS)-$(go env GOARCH)"

go build \
  -ldflags="-X main.version=${VERSION}" \
  -o "${OUT}" \
  ./cmd/api

echo "built ${OUT}"
```

Now `bin/` ends up with one neatly named file per build, and the binary itself knows what version it is.

---

## 7. Checking what you built

```bash
file ./api          # tells you the binary format (ELF/Mach-O/PE), arch, dynamic vs static
./api --version     # if your program prints the version variable
go version ./api    # which Go toolchain built it
```

`go version ./api` is the easy sanity check: it confirms the binary is a Go binary and prints which toolchain compiled it.

---

## 8. Things to avoid as a beginner

- **Building from `main.go` only** (`go build main.go`) in a multi-file `main` package — you get "undefined" errors. Build the package: `go build ./cmd/api`.
- **Using a `const` for the version** — `-X` cannot set constants. Use `var`.
- **Forgetting `-o`** — without it, the output filename is derived from the package directory and may collide with sources.
- **Hardcoding the version in source** — easy to forget to bump; let your build system inject it.
- **Shipping the default debug build** without thinking about version, paths, or size.

---

## 9. Summary

A production binary is just `go build` taken seriously. Put your entry point under `cmd/<name>/main.go`, build with `-o` to control the filename, name release artifacts with version and platform, and inject a `main.version` string with `-ldflags="-X ..."` so the binary can report which release it is. Everything else in this chapter — stripping, trimming, signing, packaging — builds on this foundation.

---

## Further reading
- `go help build`
- `cmd/link` documentation: https://pkg.go.dev/cmd/link
- Standard project layout: https://github.com/golang-standards/project-layout
