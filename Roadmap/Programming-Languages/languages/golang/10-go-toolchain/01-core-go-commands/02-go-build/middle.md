# go build — Middle

## 1. Output control with `-o`

`-o` decides the output name and whether you get one binary or many:

```bash
go build -o app ./cmd/server          # one binary named "app"
go build -o bin/ ./cmd/...            # trailing slash = a directory; one binary per main package
go build -o /dev/null ./...           # compile-check everything, discard output
```

`-o /dev/null` is a common trick to verify the whole module compiles without leaving artifacts.

---

## 2. Build tags

Build tags select which files compile for a given configuration:

```go
//go:build linux && amd64

package platform
```

```bash
go build -tags=integration ./...      # include files gated by //go:build integration
GOOS=linux go build ./...             # files gated //go:build linux are included
```

Files can also be selected by name suffix (`foo_linux.go`, `bar_windows.go`). Use tags for optional features, platform-specific code, and separating slow integration tests from unit tests.

---

## 3. Injecting build metadata with `-ldflags`

`-ldflags="-X importpath.name=value"` sets a string variable at link time:

```go
package main

var (
    version = "dev"
    commit  = "none"
)
```

```bash
go build -ldflags="-X main.version=$(git describe --tags) -X main.commit=$(git rev-parse --short HEAD)" -o app .
```

Two more common linker flags for releases:

```bash
go build -ldflags="-s -w" -o app .    # strip symbol table (-s) and DWARF (-w) → smaller binary
```

`-s -w` reduce binary size but remove debug info, so do this only for release builds.

---

## 4. Reproducible builds with `-trimpath`

By default the binary embeds absolute source paths (e.g., `/Users/you/project/...`). `-trimpath` removes them:

```bash
go build -trimpath -o app .
```

This makes builds reproducible across machines and avoids leaking developer home-directory paths into your binary. It is standard for release pipelines.

---

## 5. Static vs dynamic linking and cgo

`CGO_ENABLED` controls whether C code (and dynamic linking) is involved:

```bash
CGO_ENABLED=0 go build -o app .       # pure-Go static binary (great for containers/scratch images)
CGO_ENABLED=1 go build -o app .       # may dynamically link libc (e.g., for net/os-user with cgo)
```

For minimal Docker images (`scratch`, `distroless/static`), build with `CGO_ENABLED=0` to get a fully static binary with no shared-library dependencies.

---

## 6. Cross-compilation in practice

```bash
GOOS=linux   GOARCH=amd64 go build -o dist/app-linux-amd64 .
GOOS=linux   GOARCH=arm64 go build -o dist/app-linux-arm64 .
GOOS=darwin  GOARCH=arm64 go build -o dist/app-darwin-arm64 .
GOOS=windows GOARCH=amd64 go build -o dist/app-windows-amd64.exe .
```

List all valid combinations:

```bash
go tool dist list
```

Pure-Go cross-compiles need no extra toolchain. cgo cross-compilation needs a matching C cross-compiler and is much harder — another reason `CGO_ENABLED=0` is popular.

---

## 7. Useful diagnostic flags

```bash
go build -v ./...        # print package names as they compile
go build -x .            # print the underlying commands
go build -n .            # print commands without running them (dry run)
go build -a .            # force rebuild of all packages, ignoring the cache
go build -race -o app .  # race-instrumented binary
```

`-a` is occasionally needed to defeat a stale cache, but you rarely should — prefer `go clean -cache` if you suspect cache corruption.

---

## 8. How it fits the dev/build loop

- **Inner loop:** `go build ./...` or `go build -o /dev/null ./...` to fast-check compilation; `go test ./...` to verify behavior.
- **Local binary:** `go build -o bin/app ./cmd/app` then run `bin/app` repeatedly.
- **Release:** `go build -trimpath -ldflags="-s -w -X main.version=$TAG" -o dist/app ./cmd/app`.

A common pattern is a `make build` target that bakes in version, trimpath, and ldflags so every developer produces identical binaries.

---

## 9. Trade-offs

| Choice | Pro | Con |
|--------|-----|-----|
| `-ldflags="-s -w"` | smaller binary | no symbols for debugging/panics |
| `CGO_ENABLED=0` | static, portable | no cgo features (some DNS/user lookup paths differ) |
| `-trimpath` | reproducible, no leaked paths | slightly harder to map paths when debugging |
| `-a` | guarantees fresh build | slow; usually unnecessary |

---

## 10. Summary

`go build` is configurable: `-o` controls output, `-tags` selects files, `-ldflags` injects metadata and shrinks binaries (`-s -w`), `-trimpath` makes builds reproducible, and `GOOS`/`GOARCH`/`CGO_ENABLED` drive cross-compilation and static linking. Standardize these in a Makefile so every build is identical, and reserve `-s -w` and `-trimpath` for release builds.

---

## Further reading
- `go help build`, `go help buildflags`
- Linker flags: https://pkg.go.dev/cmd/link
- `go tool dist list` (platforms): https://pkg.go.dev/cmd/go
