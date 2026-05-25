# Building Executables — Middle

## 1. The production build flag set

For day-to-day release builds, three flag groups matter:

```bash
go build \
  -trimpath \
  -ldflags="-s -w -X main.version=${VERSION}" \
  -mod=readonly \
  -o bin/api ./cmd/api
```

| Flag | What it does |
|------|--------------|
| `-trimpath` | Removes file system paths from the binary (no `/home/alice/...` leaks). |
| `-ldflags="-s -w"` | Strips the symbol table (`-s`) and DWARF debug info (`-w`) → smaller binary. |
| `-ldflags="-X pkg.var=value"` | Sets a string variable at link time (version, commit, build date). |
| `-mod=readonly` | Fails the build if `go.mod`/`go.sum` would have to change — protects CI from silent drift. |
| `-buildvcs=true` | Embeds VCS info (commit, dirty flag) in `runtime/debug.BuildInfo`. Default on with VCS detected. |
| `-buildvcs=false` | Disables VCS embedding (useful when source ships without `.git`). |

These five cover 90% of production builds. Add `CGO_ENABLED=0` and you have a fully portable static binary on Linux.

---

## 2. Embedding build metadata properly

You can stop wiring up multiple `-X` flags by using `runtime/debug.BuildInfo`, which Go embeds automatically when you build with `go build` from a module:

```go
package main

import (
    "fmt"
    "runtime/debug"
)

var version = "dev" // overridden via -ldflags

func main() {
    fmt.Println("version:", version)
    if info, ok := debug.ReadBuildInfo(); ok {
        fmt.Println("module:", info.Main.Path, info.Main.Version)
        for _, s := range info.Settings {
            if s.Key == "vcs.revision" || s.Key == "vcs.time" || s.Key == "vcs.modified" {
                fmt.Printf("%s=%s\n", s.Key, s.Value)
            }
        }
    }
}
```

`vcs.revision`, `vcs.time`, and `vcs.modified` come from `-buildvcs=true` and require the build to happen inside a VCS checkout. `info.Main.Version` will be `(devel)` for local builds and the module's tagged version when consumers `go install ...@v1.2.3`.

Combine: inject your semantic `version` via `-X`, let Go embed the commit info via VCS metadata. You then expose both via `--version` or a `/healthz` endpoint.

---

## 3. Static linking on Linux

By default, on Linux with cgo dependencies (e.g., `net` resolver, `os/user`), the binary may be dynamically linked against `libc`. That breaks on Alpine images and other minimal targets. Disable cgo:

```bash
CGO_ENABLED=0 go build -o api ./cmd/api
file ./api
# api: ELF 64-bit LSB executable, x86-64, statically linked, ...
```

`CGO_ENABLED=0` switches to the pure-Go `net` resolver and `os/user` implementations and uses the internal linker — the result is a single statically linked file you can drop into `scratch` or `distroless/static`.

Caveats:

- Some packages (SQLite drivers, certain crypto bindings) require cgo. You must keep `CGO_ENABLED=1` for them.
- If you keep cgo, use `-extldflags='-static'` together with a static libc (musl) in your build image to produce a static cgo binary. This is fiddlier.

---

## 4. Reproducible builds

A reproducible build means: same source + same toolchain + same flags → byte-identical binary. Required ingredients:

```bash
go build \
  -trimpath \
  -ldflags="-s -w -buildid=" \
  -o api ./cmd/api
```

- `-trimpath` removes paths.
- `-ldflags=-buildid=` clears the link-time build ID so it does not vary across machines.
- Pin the **toolchain version** (`go.mod`'s `go 1.23.4` directive or a `GOTOOLCHAIN` setting). Different toolchains produce different binaries.
- Build at a fixed **module graph** (`-mod=readonly`, identical `go.sum`).
- Use `SOURCE_DATE_EPOCH` if your packaging step embeds timestamps (Go itself does not stamp the binary with wall-clock time).

A reproducible build lets two independent rebuilds of the same release verify each other — the basis of supply-chain attestations.

---

## 5. Picking a GOAMD64 microarchitecture

`GOAMD64` lets you target newer x86-64 instruction sets:

| Level | Required CPU features (roughly) |
|-------|--------------------------------|
| `v1` (default) | Baseline x86-64; runs on any 64-bit x86 CPU |
| `v2` | Includes SSE4, POPCNT (CPUs ~2009+) |
| `v3` | Includes AVX, AVX2, BMI (CPUs ~2013+) |
| `v4` | Includes AVX-512 (modern server CPUs) |

```bash
GOAMD64=v3 go build -o api ./cmd/api
```

Trade-off: higher levels run faster (better codegen, vectorized stdlib) but refuse to start on older CPUs (`SIGILL`). For internal infrastructure where you control the hardware, `v3` is a safe modern choice. For binaries shipped to unknown customers, stay at `v1`.

`GOARM` (for 32-bit ARM) and `GOARM64`, `GOPPC64` analogues exist with similar trade-offs.

---

## 6. Output naming convention

Pick one convention for release artifacts and stick to it:

```
<name>-<version>-<os>-<arch>[.exe]
```

Examples:

```
api-v1.2.3-linux-amd64
api-v1.2.3-linux-arm64
api-v1.2.3-darwin-arm64
api-v1.2.3-windows-amd64.exe
```

A shell helper:

```bash
out_name() {
  local ext=""
  [ "$(go env GOOS)" = "windows" ] && ext=".exe"
  echo "api-${VERSION}-$(go env GOOS)-$(go env GOARCH)${ext}"
}
go build -o "bin/$(out_name)" ./cmd/api
```

This convention prevents the classic mistake of building several targets to `bin/api` and overwriting each one.

---

## 7. Packaging into a tarball

For Unix releases:

```bash
TARGET="api-${VERSION}-linux-amd64"
mkdir -p "dist/${TARGET}"
cp "bin/${TARGET}" "dist/${TARGET}/api"
cp README.md LICENSE "dist/${TARGET}/"
tar -C dist -czf "dist/${TARGET}.tar.gz" "${TARGET}"
sha256sum "dist/${TARGET}.tar.gz" > "dist/${TARGET}.tar.gz.sha256"
```

A few rules to internalize:

- One archive per (OS, arch) tuple.
- Include a `LICENSE` and a `README` next to the binary.
- Publish a checksum file (`.sha256`) for each archive.
- For Windows, ship a `.zip` instead of `.tar.gz`.

You will replace this hand-rolled script with `goreleaser` later (Senior level), but knowing the moving parts means you can read and debug what goreleaser produces.

---

## 8. Putting it together

```bash
#!/usr/bin/env bash
set -euo pipefail

VERSION=$(git describe --tags --always --dirty)
GOOS=${GOOS:-$(go env GOOS)}
GOARCH=${GOARCH:-$(go env GOARCH)}
EXT=""; [ "$GOOS" = "windows" ] && EXT=".exe"
OUT="bin/api-${VERSION}-${GOOS}-${GOARCH}${EXT}"

CGO_ENABLED=0 GOOS="$GOOS" GOARCH="$GOARCH" \
go build \
  -trimpath \
  -mod=readonly \
  -ldflags="-s -w -X main.version=${VERSION}" \
  -o "${OUT}" \
  ./cmd/api

echo "built ${OUT} ($(du -h "${OUT}" | cut -f1))"
```

Run it once per target you support. The output is small, static, attributable, and reproducible — the four properties a "good" release binary has.

---

## 9. Summary

A middle-level production build is: `-trimpath` to scrub paths, `-ldflags="-s -w -X main.version=..."` to shrink and stamp, `-mod=readonly` to lock dependencies, `CGO_ENABLED=0` for a static Linux binary, an explicit `GOAMD64` choice if you target modern CPUs, a strict `name-version-os-arch` filename, and a tarball with a checksum. Combine `-X` with `runtime/debug.BuildInfo` so the binary can introspect its own version and commit.

---

## Further reading
- `go help build`, `go help buildmode`
- `cmd/link` flags: https://pkg.go.dev/cmd/link
- `runtime/debug.BuildInfo`: https://pkg.go.dev/runtime/debug#BuildInfo
- GOAMD64: https://go.dev/wiki/MinimumRequirements#amd64
