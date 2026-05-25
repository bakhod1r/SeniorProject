# Cross-compilation — Specification

> **Focus:** Precise reference for Go's `GOOS`/`GOARCH` cross-build behavior — invocation, environment, supported targets, interaction with the build cache, and guarantees.
>
> **Sources:**
> - `go help build`, `go help environment`, `go help buildconstraint`
> - `cmd/go` documentation: https://pkg.go.dev/cmd/go
> - `go tool dist list -json`
> - `src/cmd/dist/build.go` (port table)

---

## 1. Synopsis

```
GOOS=<os> GOARCH=<arch> [GOARM=...] [GOAMD64=...] [CGO_ENABLED=0|1] \
  go build [build flags] [-o output] [packages]
```

Producing an executable for a target other than the host. The same form applies to `go install`, `go test -c`, and (with caveats) `go run`.

---

## 2. The two required variables

| Variable | Meaning | Example |
|----------|---------|---------|
| `GOOS` | Target operating system | `linux`, `darwin`, `windows`, `freebsd`, `js`, `wasip1`, ... |
| `GOARCH` | Target CPU architecture | `amd64`, `arm64`, `arm`, `386`, `riscv64`, `ppc64le`, `wasm`, ... |

If unset, both default to `runtime.GOOS` / `runtime.GOARCH` of the host. The full list of valid pairs is enumerated by:

```bash
go tool dist list           # one per line, GOOS/GOARCH
go tool dist list -json     # structured, including FirstClass
```

---

## 3. Sub-architecture variables

| Variable | Applies to GOARCH | Values | Default | Effect |
|----------|------------------|--------|---------|--------|
| `GOARM` | `arm` (32-bit) | `5`, `6`, `7` | platform-dependent (`7` on most builds) | Soft-float vs VFPv2 vs VFPv3 |
| `GOAMD64` | `amd64` | `v1`, `v2`, `v3`, `v4` | `v1` | Minimum x86-64 microarchitecture level |
| `GOMIPS` | `mips`, `mipsle` | `hardfloat`, `softfloat` | `hardfloat` | Whether FPU instructions are emitted |
| `GOMIPS64` | `mips64`, `mips64le` | `hardfloat`, `softfloat` | `hardfloat` | Same, for 64-bit MIPS |
| `GOPPC64` | `ppc64`, `ppc64le` | `power8`, `power9`, `power10` | `power8` | Minimum POWER ISA level |
| `GOWASM` | `wasm` | comma-separated of `satconv`, `signext` | empty | Required Wasm extensions to emit |
| `GORISCV64` | `riscv64` (Go 1.23+) | `rva20u64`, `rva22u64` | `rva20u64` | Minimum RISC-V profile |

Mismatch between a sub-arch level and the actual CPU yields `SIGILL` at the first unsupported instruction.

---

## 4. cgo-related variables

| Variable | Default | Effect |
|----------|---------|--------|
| `CGO_ENABLED` | `1` if a C compiler is found on the host, else `0` | Whether cgo and the external linker are used |
| `CC` | host `cc` | C compiler used for cgo (must target `GOOS/GOARCH`) |
| `CXX` | host `c++` | C++ compiler used for cgo |
| `AR` | host `ar` | Archive tool used for cgo objects |
| `CGO_CFLAGS`, `CGO_CPPFLAGS`, `CGO_CXXFLAGS`, `CGO_FFLAGS`, `CGO_LDFLAGS` | empty | Flags passed to C/C++/Fortran compilers and the linker for cgo translation units |
| `PKG_CONFIG` | `pkg-config` | Tool used to resolve `#cgo pkg-config:` directives |

`CGO_ENABLED=0` is the canonical setting for pure-Go cross-builds: it makes the toolchain use Go-only implementations of `net`, `os/user`, and friends, links with the internal linker, and removes the need for any C cross toolchain.

---

## 5. Supported target combinations

A condensed view (run `go tool dist list` for the authoritative current set).

**First-class ports** (full test coverage, regressions block releases):

| GOOS | GOARCHes |
|------|----------|
| `linux` | `amd64`, `arm64` |
| `darwin` | `amd64`, `arm64` |
| `windows` | `amd64` |

**Other supported (port-class) targets** include but are not limited to:

| GOOS | GOARCHes |
|------|----------|
| `linux` | `386`, `arm`, `ppc64`, `ppc64le`, `mips`, `mipsle`, `mips64`, `mips64le`, `riscv64`, `s390x`, `loong64` |
| `windows` | `386`, `arm`, `arm64` |
| `freebsd` | `amd64`, `arm64`, `386`, `arm`, `riscv64` |
| `openbsd` | `amd64`, `arm64`, `386`, `arm`, `ppc64`, `riscv64` |
| `netbsd` | `amd64`, `arm64`, `386`, `arm` |
| `dragonfly` | `amd64` |
| `solaris` | `amd64` |
| `illumos` | `amd64` |
| `aix` | `ppc64` |
| `plan9` | `amd64`, `386`, `arm` |
| `android` | `amd64`, `arm64`, `arm`, `386` |
| `ios` | `amd64` (simulator), `arm64` |
| `js` | `wasm` |
| `wasip1` | `wasm` |

Use `go tool dist list -json | jq '.[] | select(.FirstClass==true)'` to filter the first-class set programmatically.

---

## 6. Interaction with the build cache

- `GOCACHE` is a content-addressed cache keyed by all build inputs, including `GOOS`, `GOARCH`, `CGO_ENABLED`, sub-arch variables, and build flags.
- A `linux/amd64` build and a `linux/arm64` build produce **different** cache entries; they coexist in the same `GOCACHE` directory and do not invalidate each other.
- A change to any tracked input (source content, flag, env variable, toolchain version, target triple) is a cache miss; an unchanged target is a hit even after switching back from another target.
- `GOMODCACHE` (default `$GOPATH/pkg/mod`) holds downloaded modules and is target-independent — shared across all builds.
- `-trimpath`, `-buildvcs`, `-ldflags`, `-gcflags`, `-tags`, and other build flags participate in the cache key.

---

## 7. Behavioral guarantees

- **Pure-Go cross-compile needs nothing extra.** With `CGO_ENABLED=0`, a stock Go installation can build for any pair listed by `go tool dist list` without installing additional toolchains.
- **One toolchain, many targets.** The same `go` binary, `cmd/compile`, `cmd/asm`, and `cmd/link` produce ELF, PE, Mach-O, and Wasm outputs; target selection is by argument, not by separate executables.
- **`runtime.GOOS` / `runtime.GOARCH` reflect the target**, evaluated at compile time. They are constants for a given binary; they do not detect the host the program is running on (which equals the target for a successfully-running binary).
- **Build constraints select files per target.** Filename suffixes (`_linux.go`, `_windows_amd64.go`) and `//go:build` lines determine which files compile for which target. Build tags `unix`, `goexperiment.*`, and user tags via `-tags` participate.
- **`go run` cross-compiles but does not cross-execute.** Setting `GOOS`/`GOARCH` produces a foreign binary that `go run` then attempts to execute on the host, failing with "exec format error" unless `-exec` supplies a runner (e.g., `wasmtime`, `qemu`, the wasm exec script).
- **Reproducibility requires explicit flags.** `-trimpath -buildvcs=false -ldflags="-buildid="` plus a pinned toolchain are required for byte-identical output across hosts; `-ldflags="-s -w"` removes symbol/DWARF for smaller, more stable binaries.
- **Output file extension is the caller's job.** The toolchain does not append `.exe` for Windows targets automatically; specify it via `-o app.exe`.

---

## 8. Build flags relevant to cross-compilation

| Flag | Effect |
|------|--------|
| `-o file` | Write the binary to `file` (use to include `-<goos>-<goarch>` suffixes) |
| `-trimpath` | Remove host filesystem paths from the binary (reproducibility) |
| `-buildvcs=false` | Do not embed VCS state (reproducibility) |
| `-ldflags '...'` | Pass flags to `cmd/link`; common: `-s -w`, `-buildid=`, `-X pkg.var=value`, `-H windowsgui` |
| `-gcflags '...'` | Pass flags to `cmd/compile`; e.g. `all=-N -l` for debug builds |
| `-tags 'a,b'` | Set custom build tags; participates in cache key |
| `-p n` | Number of parallel build actions (defaults to GOMAXPROCS) |
| `-x` | Print the underlying commands; useful to see per-target invocations |
| `-work` | Keep the temporary work directory |

All build flags must appear **before** the package argument.

---

## 9. Non-goals / limitations

- Not a substitute for a target C/C++ toolchain when cgo is required.
- Does not produce signed/notarized binaries; signing is a separate step (cosign, codesign + notarytool, signtool).
- Does not bundle resources (icons, manifests) — use external tools (`rsrc`, `goversioninfo`) for Windows assets.
- Does not provide an emulator; running a cross-built binary on the host requires QEMU, Docker, or a real target machine.
- Does not auto-detect the safe `GOAMD64`/`GOARM` level for the deployment fleet; that is an operations decision.
- Does not guarantee that every (`GOOS`, `GOARCH`) pair listed by `dist list` is first-class; check `FirstClass` for production readiness.

---

## 10. Related references
- `go help build`, `go help environment`, `go help buildconstraint`
- `cmd/go` driver: https://pkg.go.dev/cmd/go
- `cmd/link`: https://pkg.go.dev/cmd/link
- Installing Go from source: https://go.dev/doc/install/source
- Build constraints: https://pkg.go.dev/cmd/go#hdr-Build_constraints
- Reproducible builds in Go: https://go.dev/blog/rebuild
- `GOAMD64` levels: https://go.dev/wiki/MinimumRequirements#amd64
