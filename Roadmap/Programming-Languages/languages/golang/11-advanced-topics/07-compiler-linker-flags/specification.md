# Compiler & Linker Flags — Specification

> **Focus:** Precise reference for `-gcflags`, `-ldflags`, `-asmflags`, `-gccgoflags`, and related toolchain knobs passed via `go build`.
>
> **Sources:**
> - `go help build`, `go help buildflags`
> - `cmd/compile`: https://pkg.go.dev/cmd/compile
> - `cmd/link`: https://pkg.go.dev/cmd/link

---

## 1. The flag families

| Flag | Recipient | Purpose |
|------|-----------|---------|
| `-gcflags` | `cmd/compile` | Per-package or all packages compile flags |
| `-ldflags` | `cmd/link` | Linker flags (final binary) |
| `-asmflags` | `cmd/asm` | Assembler flags |
| `-gccgoflags` | `gccgo` | For the alternate gccgo toolchain |
| `-tags` | (all) | Build constraints |
| `-trimpath` | (all) | Remove file system paths from outputs |
| `-mod` | go cmd | Module resolution mode |
| `-pgo` | go cmd | Profile-guided optimization |

Multiple `-gcflags`/`-ldflags` can be combined with package patterns.

---

## 2. Package patterns

```bash
go build -gcflags='all=-N -l' ./...                 # all packages
go build -gcflags='main=-N -l' ./...                # only main package
go build -gcflags='example.com/...=-m' ./...        # path pattern
go build -gcflags='runtime=-d=foo' ./...            # a specific package
```

The `<pattern>=<flags>` form selects which packages get the flags. Without a pattern, the flags apply to the top-level package being built.

---

## 3. Common compile flags

| Flag | Effect |
|------|--------|
| `-N` | Disable optimizations (useful for debugging) |
| `-l` | Disable inlining (also for debugging) |
| `-m` | Print optimization decisions (escape, inline) |
| `-m=2`, `-m=3` | Increase verbosity |
| `-S` | Print assembly for the function |
| `-B` | Disable bounds checking (DANGEROUS — not recommended) |
| `-d=<key>=<value>` | Compiler debug knobs |
| `-spectre=all` | Enable Spectre mitigations |
| `-shared` | Generate position-independent code |

Combine: `-gcflags='all=-N -l'` is the canonical "build for delve debugging".

---

## 4. Linker flags

```bash
go build -ldflags='-s -w -X main.version=1.2.3' ./...
```

| Flag | Effect |
|------|--------|
| `-s` | Omit symbol table |
| `-w` | Omit DWARF debug info |
| `-X <pkg>.<var>=<value>` | Inject a string into a string variable at link time |
| `-extldflags` | Pass flags to the external linker (used with cgo) |
| `-linkmode=internal\|external` | Pure-Go vs. external linker |
| `-buildid` | Set or remove the build ID |
| `-r <path>` | rpath for dynamic linking |
| `-pluginpath` | Plugin identity (for `-buildmode=plugin`) |

The string injection (`-X`) only works with declared `var` of type `string`. Common pattern:

```go
// main.go
var version = "dev"

func main() { fmt.Println("version:", version) }
```

```bash
go build -ldflags="-X main.version=$(git describe --tags)" ./cmd/app
```

---

## 5. Build modes (`-buildmode`)

| Mode | Output | Use |
|------|--------|-----|
| `exe` (default) | Statically linked executable | Normal builds |
| `c-archive` | `.a` + `.h` | Embed in C programs |
| `c-shared` | `.so`/`.dylib` + `.h` | C-callable shared library |
| `shared` | Shared library | Other Go programs (rare) |
| `pie` | Position-independent executable | Hardened deployments |
| `plugin` | `.so` plugin | `plugin` package |
| `archive` | `.a` archive | Library-like usage |

`c-shared` and `c-archive` are the cgo flip side: Go code called from C.

---

## 6. Profile-guided optimization (`-pgo`)

```bash
go build -pgo=auto ./cmd/app                          # uses default.pgo if present
go build -pgo=/path/to/profile.pb.gz ./cmd/app        # explicit
```

The profile is a `pprof` CPU profile. The compiler uses it to make better inlining and devirtualization decisions. Typical gain: 2–10% CPU.

PGO support is GA in Go 1.21.

---

## 7. `-trimpath`

```bash
go build -trimpath ./...
```

Removes file system paths from the resulting binary. Effects:

- Stack traces show package paths instead of `/Users/alice/work/proj/...`.
- Reproducible builds (same source → same binary across machines).
- DWARF and symbol table use canonical paths.

Almost always desirable for release builds; sometimes annoying for local development (worse "click to file" UX in some tools).

---

## 8. `-race`, `-msan`, `-asan`

```bash
go build -race ./...
go build -msan ./...   # memory sanitizer (Linux/amd64 + Linux/arm64)
go build -asan ./...   # address sanitizer
```

Each instruments the binary differently:

- `-race`: detects data races at runtime; 2–20× slowdown.
- `-msan`: detects use of uninitialized memory; requires cgo.
- `-asan`: detects out-of-bounds and use-after-free; requires cgo.

Test binaries (`go test -race`) is the common use; production builds are typically race-free.

---

## 9. Build cache and flags

The Go build cache keys on:

- Source content.
- Build flags (exact `-gcflags`/`-ldflags`/`-tags`/...).
- Toolchain version.
- Target platform.

Implication: changing flags invalidates the cache for affected packages but uses a separate cache entry, so switching back is fast.

---

## 10. `-x` and `-work`

```bash
go build -x ./...              # print every command go executes
go build -work -x ./...        # print and keep the work directory
```

`-x` shows the underlying compiler/linker invocations. Useful when debugging weird builds or learning how the toolchain assembles a binary.

`-work` keeps the temporary work directory after build. Combined with `-x`, you can inspect intermediate artifacts.

---

## 11. `-buildvcs` (Go 1.18+)

```bash
go build -buildvcs=true ./...    # embed VCS info
go build -buildvcs=false ./...   # don't
```

Embeds git commit hash, dirty flag, etc. into the binary. Visible via `go version -m binary`. Default is `auto` (embed if inside a VCS).

---

## 12. `go env` knobs

Some flags are settable via env vars and persist:

```bash
go env -w GOFLAGS='-trimpath -ldflags=-s\ -w'
```

Affects every subsequent `go build`. Useful for consistent CI defaults; dangerous for shared dev machines where preferences differ.

---

## 13. Important flag combinations

| Use case | Flags |
|----------|-------|
| Release build | `-trimpath -ldflags='-s -w'` |
| Inject version | `-ldflags="-X main.version=v1.2.3"` |
| Debug build | `-gcflags='all=-N -l'` |
| Escape analysis report | `-gcflags='-m=2'` |
| PGO build | `-pgo=auto` |
| Static cgo build | `-ldflags='-linkmode=external -extldflags="-static"'` |
| WASM build | `GOOS=js GOARCH=wasm go build -o app.wasm` |
| Print compiler commands | `-x -v` |
| Reproducible build | `-trimpath -buildvcs=false` |

---

## 14. Inspection tools

| Tool | Purpose |
|------|---------|
| `go version -m binary` | Embedded build metadata |
| `go tool nm binary` | Symbols |
| `go tool objdump -s 'pkg.*' binary` | Disassemble functions |
| `go build -o /dev/null -x ./...` | See what `go build` would do |
| `delve` | Source-level debugger |

---

## 15. Related references

- `go help build`, `go help buildflags`
- `cmd/compile` flags: `go tool compile -h`
- `cmd/link` flags: `go tool link -h`
- PGO docs: https://go.dev/doc/pgo
