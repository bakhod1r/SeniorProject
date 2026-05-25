# Building Executables — Professional

## 1. The pipeline from source to executable

`go build` is a driver. The actual work is done by `cmd/compile` (one invocation per package) and `cmd/link` (one invocation per binary):

```
source files (.go)
   ↓ cmd/compile  → package archives (.a in $GOCACHE)
              ↓
            cmd/link → executable (ELF / Mach-O / PE)
```

`cmd/link` is the part that turns N package archives plus the runtime into one mappable binary. It resolves symbols, lays out sections, generates the `.gopclntab` (Go's program-counter-to-line table), embeds module info, and writes the platform-native object format. Source lives in the Go tree under `src/cmd/link`.

`go build -x` prints every sub-invocation; `go build -ldflags="-v"` makes the linker chatty about which symbols it pulls in.

---

## 2. The build ID

Every Go executable carries a **build ID**: a hash uniquely identifying the inputs (source, flags, toolchain). It serves three purposes:

- Build cache key — Go knows whether to rebuild.
- Identification — `go tool buildid ./api` prints it; tooling correlates a profile or core dump back to a binary.
- Reproducibility check — same inputs → same build ID.

```bash
go tool buildid ./api
# example: kgqL_KZc...123/abc...456
```

The build ID has two parts separated by `/`: the action ID (what went into producing the binary) and the content ID (a hash of the resulting bytes). `-ldflags="-buildid="` clears it — required for bit-identical reproducible builds where different machines must produce identical bytes.

---

## 3. `runtime/debug.BuildInfo` under the hood

`runtime/debug.ReadBuildInfo()` returns module path, main module version, dependency list, and "settings" (build flags, VCS info). The data is embedded by the linker into a dedicated section of the binary, parsed at runtime via `internal/buildinfo`.

```go
info, ok := debug.ReadBuildInfo()
// info.Main.Path, info.Main.Version
// info.Deps      — []*Module with replace info
// info.Settings  — []BuildSetting (key/value pairs)
```

Notable `Settings` keys:

| Key | Source |
|-----|--------|
| `-tags` | `-tags` build flag |
| `-trimpath` | whether `-trimpath` was set |
| `CGO_ENABLED`, `GOARCH`, `GOOS`, `GOAMD64` | env at build time |
| `vcs`, `vcs.revision`, `vcs.time`, `vcs.modified` | from VCS metadata when `-buildvcs=true` |

You can read these out of any Go binary without running it:

```bash
go version -m ./api
```

This is invaluable for incident response — "which commit is in production?" — when nobody remembers what was deployed.

---

## 4. DWARF, the symbol table, and what `-s -w` removes

A non-stripped Go binary contains:

- **Symbol table** — names of functions, types, variables. Used by `go tool nm`, `addr2line`.
- **DWARF debug info** — line numbers, types, scopes. Used by `gdb`, `delve`, `pprof` for source-level reporting.
- **`.gopclntab`** — Go's own PC→line/function table. Used by `runtime` for stack traces and panic output.

Flags:

| Flag | Removes | Side effect |
|------|---------|-------------|
| `-ldflags="-s"` | Symbol table | `go tool nm` no longer works; panics still show function names (from `.gopclntab`); `pprof` symbolization degrades; `delve` cannot resolve symbols. |
| `-ldflags="-w"` | DWARF | No source-level debugging; `pprof` still works at the function level via `.gopclntab`; `gdb`/`delve` lose line info. |

`.gopclntab` is **never stripped** — that is why Go panics always show function names and line numbers even in `-s -w` binaries. This is also why `pprof` profiling of stripped Go binaries works at the function level but not at the line level.

Production trade-off: ship `-s -w` to users (smaller, no internals leaked); keep an unstripped artifact for internal diagnostics, indexed by build ID, so you can re-symbolize profiles after the fact.

---

## 5. ELF, Mach-O, and PE

The three executable formats Go targets:

| Format | OS | Sections you care about |
|--------|------|------------------------|
| ELF | Linux, *BSD, illumos | `.text`, `.rodata`, `.data`, `.gopclntab`, `.go.buildinfo`, `.note.go.buildid` |
| Mach-O | macOS, iOS | `__text`, `__rodata`, `__gopclntab`, `__go_buildinfo`, plus signature in `LC_CODE_SIGNATURE` |
| PE | Windows | `.text`, `.rdata`, `.data`, `.symtab`, plus Authenticode signature directory |

Practical implications:

- **macOS Mach-O** needs `codesign` for any binary with hardened runtime or notarization; the signature lives inside the binary itself.
- **Windows PE** signatures are appended after the section data; `signtool` modifies the binary in place.
- **Linux ELF** has no in-format signature; signing is done out-of-band (cosign signature stored alongside the artifact).

`file`, `objdump -h`, and `otool -l` (macOS) inspect these on the respective platforms.

---

## 6. Position-independent executables (`-buildmode=pie`)

A PIE binary can be loaded at any base address, enabling **ASLR** (Address Space Layout Randomization) for the executable itself, not just shared libraries.

```bash
go build -buildmode=pie -o api ./cmd/api
file ./api
# api: ELF 64-bit LSB pie executable, ...
```

| Buildmode | Output | Use case |
|-----------|--------|----------|
| `exe` (default) | Plain executable | Standard CLI/server binary |
| `pie` | Position-independent executable | Hardened deployments; required on some distros (Ubuntu since 17.10, macOS 10.15+) |
| `c-archive` | `.a` for linking into a C program | Embed Go logic in a C/C++ binary |
| `c-shared` | `.so` / `.dylib` / `.dll` exporting `cgo` functions | Plugin for non-Go hosts |
| `plugin` | Go-loadable plugin (`plugin` package) | Linux/macOS only; brittle — avoid |

`-buildmode=pie` costs ~1–2% runtime on most architectures (extra indirection for global access) and slightly bigger binary. Worth it for production servers; the security gain (each process maps the executable at a different address) is real.

---

## 7. Why stripped binaries break pprof symbolization

When you collect a `pprof` profile from a `-s -w` binary, two things happen:

1. **Function names** still appear because `.gopclntab` holds them.
2. **Source lines** and **inlining info** are degraded because DWARF is gone; flame graphs still render but cannot jump to source.

The fix: collect the profile from production (stripped), then symbolize **with the unstripped binary** of the same build ID:

```bash
# production binary: stripped
pprof -http=:8080 -symbolize=remote http://prod/debug/pprof/profile

# locally: feed the unstripped binary for full source symbolization
pprof -http=:8080 ./api.full ./prod.profile
```

Maintain a "symbol archive": for each release, keep the unstripped binary indexed by build ID. When an incident produces a profile or core dump, you can look up the corresponding unstripped artifact and decode it fully.

---

## 8. Reading the source

The Go source tree itself is the reference when behavior is unclear:

| Path | What it does |
|------|--------------|
| `src/cmd/go/internal/work/build.go` | The `go build` driver |
| `src/cmd/link/internal/ld/main.go` | Linker entry point |
| `src/cmd/link/internal/ld/data.go` | `.gopclntab`, build info layout |
| `src/runtime/debug/mod.go` | `ReadBuildInfo` implementation |
| `src/cmd/internal/buildid` | Build ID computation |

When the documentation is ambiguous (e.g., "what exactly does `-trimpath` rewrite?"), read these. They are short and well-commented relative to most compiler code.

---

## 9. Summary

Under the hood, a Go executable is the work of `cmd/link` stitching together compiled package archives, the runtime, `.gopclntab`, and an embedded `BuildInfo` record. `-s -w` removes the symbol table and DWARF but never `.gopclntab`, which is why panics and function-level `pprof` keep working on stripped binaries. The build ID identifies the inputs and is essential for matching production crashes to source. PIE buildmode hardens server deployments at minimal cost. The format (ELF/Mach-O/PE) dictates how signing works. When the docs are unclear, `src/cmd/link` and `src/runtime/debug/mod.go` are the authoritative answers.

---

## Further reading
- `cmd/link` source: https://github.com/golang/go/tree/master/src/cmd/link
- `runtime/debug.BuildInfo`: https://pkg.go.dev/runtime/debug#BuildInfo
- Build ID format: https://pkg.go.dev/cmd/go/internal/work
- `go tool buildid`, `go tool nm`, `go tool objdump`
- Go buildmodes: https://pkg.go.dev/cmd/go#hdr-Build_modes
