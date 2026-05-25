# Building Executables — Specification

> **Focus:** Precise reference for the flags, environment, and embedded data that define a Go production binary.
>
> **Sources:**
> - `go help build`, `go help buildmode`, `go help buildflags`, `go help environment`
> - `cmd/link` documentation: https://pkg.go.dev/cmd/link
> - `runtime/debug.BuildInfo`: https://pkg.go.dev/runtime/debug#BuildInfo
> - Modules reference: https://go.dev/ref/mod

---

## 1. Synopsis

```
go build [build flags] [-o output] [packages]
```

A production binary is the file `cmd/link` writes to `-o`, given a `main` package and a set of build flags chosen for size, attribution, portability, and reproducibility.

---

## 2. Common production flag set

```bash
CGO_ENABLED=0 \
go build \
  -trimpath \
  -mod=readonly \
  -buildvcs=true \
  -ldflags="-s -w -X main.version=${VERSION}" \
  -o bin/<name>-<version>-<os>-<arch> \
  ./cmd/<name>
```

| Flag | Purpose |
|------|---------|
| `-o path` | Output file. Required for predictable release naming. |
| `-trimpath` | Removes absolute file system paths from the binary. |
| `-mod=readonly` | Fails if `go.mod`/`go.sum` would need to change. |
| `-buildvcs=true` | Embed VCS info (`vcs.revision`, `vcs.time`, `vcs.modified`). Default on when VCS is detected. |
| `-buildvcs=false` | Disable VCS embedding (e.g., when source ships without `.git`). |
| `-ldflags="..."` | Passes flags to `cmd/link`. See section 3. |
| `-gcflags="..."` | Passes flags to `cmd/compile`. Rarely used for releases. |
| `-tags="a,b"` | Set build constraints (e.g., to exclude debug features). |
| `-buildmode=<mode>` | Choose output kind. See section 4. |
| `-p n` | Number of parallel build/link actions. |
| `-x` | Print every sub-invocation (debug builds). |

---

## 3. `-ldflags` reference

Common flags accepted by `cmd/link`:

| Flag | Effect |
|------|--------|
| `-s` | Omit the symbol table. `go tool nm` no longer works on the binary. |
| `-w` | Omit DWARF debug info. `gdb`/`delve` lose source-level debugging; `pprof` loses source-line accuracy. |
| `-X importpath.name=value` | Set a string `var` at link time. Requires a package-level `var`, not `const`. Full import path required. |
| `-buildid=<id>` | Set or clear (`-buildid=`) the linker build ID. Clear for bit-reproducible builds. |
| `-linkmode=internal\|external` | Choose internal vs external linker. Default `internal` for pure Go; `external` when cgo is used. |
| `-extldflags='...'` | Flags to pass to the external linker (e.g., `-static` for static cgo binaries). |
| `-extld <path>` | Path to the external linker binary (overrides `CC`). |
| `-r <rpath>` | Set ELF rpath. Rarely needed for Go binaries. |
| `-H <header>` | Set executable header type (rarely needed; chosen by GOOS). |
| `-pluginpath <path>` | Used with `-buildmode=plugin`. |

Multiple `-X` flags compose:

```bash
-ldflags="-s -w \
  -X 'main.version=${VERSION}' \
  -X 'main.commit=${COMMIT}' \
  -X 'main.buildDate=${DATE}'"
```

Quoting matters when values contain spaces.

---

## 4. `-buildmode` reference

| Mode | Output | Notes |
|------|--------|-------|
| `exe` | Standard executable (default for `main` packages) | Plain ELF/Mach-O/PE. |
| `pie` | Position-independent executable | Enables ASLR for the executable. ~1–2% runtime cost. |
| `c-archive` | Static archive (`.a`) with C-compatible exports | Embed Go in a C/C++ program. Requires `//export` directives. |
| `c-shared` | Dynamic library (`.so` / `.dylib` / `.dll`) with C-compatible exports | Same use as c-archive, dynamically loaded. |
| `plugin` | Go-loadable plugin via `plugin` package | Linux and macOS only. Brittle (toolchain/version coupling); avoid in new designs. |
| `shared` / `linkshared` | Shared Go library / link against | Experimental; rarely used. |
| `archive` / `default` | Internal modes | Not typically used directly. |

Selection: use `exe` (default) for typical binaries, `pie` for hardened server deployments, `c-archive`/`c-shared` only when interoperating with non-Go runtimes.

---

## 5. Environment variables affecting builds

| Variable | Role |
|----------|------|
| `CGO_ENABLED` | `0` for pure Go (static, internal linker); `1` enables cgo (external linker, dynamic libc by default). |
| `CC`, `CXX` | C/C++ compiler used by cgo and as the external linker. |
| `GOFLAGS` | Default flags applied to every `go` command (e.g., `-mod=readonly -trimpath`). |
| `GOOS`, `GOARCH` | Target OS and architecture. Required for cross-compilation. |
| `GOAMD64`, `GOARM`, `GOARM64`, `GOPPC64` | Microarchitecture level for the target arch. |
| `GOEXPERIMENT` | Enable in-development language/runtime features (production: leave unset). |
| `GOTOOLCHAIN` | Pin/override which Go toolchain the build uses. |
| `GOCACHE` | Build cache location. Cache across CI jobs for speed. |
| `GOMODCACHE` | Downloaded module cache location. |
| `GOPROXY`, `GOSUMDB`, `GONOSUMCHECK` | Module download and verification policy. |
| `GOPRIVATE`, `GONOPROXY`, `GONOSUMDB` | Patterns excluded from proxy / sum DB. |
| `SOURCE_DATE_EPOCH` | Honored by packaging steps (tar, BuildKit) for reproducible mtimes. Not directly used by `go build`. |

---

## 6. `runtime/debug.BuildInfo` schema

```go
type BuildInfo struct {
    GoVersion string         // toolchain version, e.g. "go1.23.4"
    Path      string         // main module's import path
    Main      Module         // info about the main module
    Deps      []*Module      // dependencies
    Settings  []BuildSetting // build flags and VCS info
}

type Module struct {
    Path    string
    Version string
    Sum     string
    Replace *Module
}

type BuildSetting struct {
    Key   string
    Value string
}
```

Commonly populated `Settings` keys:

| Key | Source |
|-----|--------|
| `-buildmode` | `-buildmode` flag |
| `-compiler` | Compiler name (usually `gc`) |
| `-tags` | `-tags` flag |
| `-trimpath` | `true`/`false` |
| `-ldflags` | The exact `-ldflags` string passed to the linker |
| `CGO_ENABLED` | `0` or `1` |
| `CGO_CFLAGS`, `CGO_CPPFLAGS`, `CGO_CXXFLAGS`, `CGO_LDFLAGS` | Cgo env values |
| `GOARCH`, `GOOS`, `GOAMD64` | Build env at compile time |
| `vcs` | `git`, `hg`, etc. |
| `vcs.revision` | Commit hash (when `-buildvcs=true`) |
| `vcs.time` | Commit timestamp (RFC 3339) |
| `vcs.modified` | `true`/`false` for dirty working tree |

Inspect without running the binary:

```bash
go version -m ./api
```

---

## 7. Behavioral guarantees

- `go build` produces a **persistent** file at `-o`, in contrast to `go run`'s temporary binary.
- The output binary is **self-contained** for pure-Go builds (`CGO_ENABLED=0`); no Go runtime install is needed on the target.
- `.gopclntab` (PC→function/line) is **always embedded**, even when `-s -w` strip the symbol table and DWARF. Panic traces and function-level `pprof` therefore keep working.
- `runtime/debug.BuildInfo` is embedded when building via standard `go build` from a module; reading it requires no allocation, no file I/O.
- The build cache (`GOCACHE`) is consulted by content hash; identical inputs yield cache hits.
- With `-trimpath` and `-ldflags="-buildid="` plus a pinned toolchain and locked module graph, the resulting bytes are **reproducible** across machines.
- Signals, stdin/stdout, and exit codes of the built binary at run time are the same as any native executable on the platform; `go build` does not wrap the binary.

---

## 8. Non-goals / limitations

- `go build` does not produce installer packages (`.deb`, `.rpm`, `.msi`, `.dmg`). Use `nfpm`, `goreleaser`, or platform-specific tools.
- It does not sign binaries. Use `cosign`, `codesign`+`notarytool`, or `signtool` per platform.
- It does not generate SBOMs or SLSA provenance. Use `syft` and `slsa-github-generator` separately.
- It does not strip the runtime; even minimal binaries carry the Go runtime (~1–2 MB irreducible).
- `-ldflags="-X"` only sets **string `var`s**. Constants, ints, structs, and unexported variables cannot be set this way.
- `-buildmode=plugin` is fragile (must match toolchain version exactly between plugin and host) and only works on Linux/macOS. Treat as last-resort.
- `go run` is not appropriate for producing release binaries — use `go build` with `-o`.

---

## 9. Related references
- `go help build`, `go help buildmode`, `go help buildflags`, `go help environment`
- `cmd/link`: https://pkg.go.dev/cmd/link
- `runtime/debug`: https://pkg.go.dev/runtime/debug
- Modules reference: https://go.dev/ref/mod
- `goreleaser`: https://goreleaser.com/
- `cosign`: https://docs.sigstore.dev/
- Distroless images: https://github.com/GoogleContainerTools/distroless
- SLSA: https://slsa.dev/
