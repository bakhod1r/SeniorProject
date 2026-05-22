# go build — Specification

> **Focus:** Precise reference for `go build` — synopsis, flags, environment, outputs, exit behavior, and guarantees.
>
> **Sources:**
> - `go help build`, `go help buildflags`
> - cmd/go documentation: https://pkg.go.dev/cmd/go
> - `cmd/link`: https://pkg.go.dev/cmd/link

---

## 1. Synopsis

```
go build [-o output] [build flags] [packages]
```

Compiles the named packages and their dependencies. For `main` packages, writes an executable; for non-`main` packages, compiles to check for errors and discards the result (writes no file).

---

## 2. Package arguments

| Form | Meaning |
|------|---------|
| (none) | The package in the current directory |
| `.` / `./cmd/x` | Relative path to a package |
| `import/path` | A package by import path |
| `./...` | All packages under the current directory, recursively |
| `pkg@version` | Versioned package (module-aware), independent of current requirements |

---

## 3. Output and key build flags

| Flag | Effect |
|------|--------|
| `-o output` | Write to `output`. Trailing slash or existing dir → write binaries *into* that directory (one per main package). |
| `-tags 'a,b'` | Set build constraints (build tags) |
| `-ldflags '...'` | Pass flags to the linker (`-s`, `-w`, `-X importpath.name=value`, `-buildid=`) |
| `-gcflags '[pattern=]...'` | Pass flags to the compiler (`-N -l`, `-m`); `all=` applies to all deps |
| `-asmflags`, `-trimpath` | Assembler flags; strip file system paths from the binary |
| `-race`, `-msan`, `-asan` | Enable race / memory / address sanitizers |
| `-mod=mod\|readonly\|vendor` | Module download/verification mode |
| `-buildmode=...` | Output type: `exe`, `c-shared`, `c-archive`, `pie`, `plugin`, `archive`, etc. |
| `-buildvcs=true\|false\|auto` | Whether to stamp VCS metadata into the binary |
| `-p n` | Parallel build/link actions |
| `-a` | Force rebuild of all packages (ignore cache) |
| `-v`, `-x`, `-n` | Print package names / commands / commands without executing |
| `-cover`, `-covermode`, `-coverpkg` | Build with coverage instrumentation |

Flags must precede the package arguments.

---

## 4. Environment variables

| Variable | Role |
|----------|------|
| `GOOS`, `GOARCH` | Target platform (cross-compilation) |
| `CGO_ENABLED` | Enable/disable cgo; `0` yields static, pure-Go binaries |
| `CC`, `CXX` | C/C++ compilers used when cgo is enabled |
| `GOCACHE` | Build cache location |
| `GOMODCACHE`, `GOPATH` | Module cache location |
| `GOFLAGS` | Default flags applied to every `go` command |
| `GOPROXY`, `GOSUMDB`, `GONOSUMCHECK` | Module download and verification policy |
| `GOTOOLCHAIN` | Toolchain selection/version policy |
| `GOAMD64`, `GOARM`, etc. | Micro-architecture level selection |

---

## 5. Build cache semantics

A compiled package is keyed by a hash of: source contents, the import graph, build/link flags, build tags, the toolchain version, and target environment (`GOOS`, `GOARCH`, `CGO_ENABLED`, `CC`). A matching key is reused; any change invalidates it. The build cache lives at `GOCACHE` and persists across invocations.

---

## 6. Exit codes

| Situation | Exit |
|-----------|------|
| Successful build | 0 |
| Compile/link/type error | non-zero (typically 1 or 2), diagnostics to stderr |
| Invalid flags/usage | 2 |

`go build` does not run anything, so there is no program exit code to propagate.

---

## 7. Behavioral guarantees

- **Deterministic from inputs.** With pinned toolchain, dependencies, and flags (and `-trimpath`/`-buildid=`), output is reproducible.
- **Library packages write no file.** Only `main` packages produce executables.
- **Test files ignored.** `_test.go` files are not compiled by `go build` (use `go test`/`go vet`).
- **VCS stamping.** From a clean repo, VCS metadata is embedded (controllable via `-buildvcs`); read with `go version -m`.
- **No execution.** `go build` never runs the program.

---

## 8. `-buildmode` summary

| Mode | Output |
|------|--------|
| `exe` (default) | Standalone executable |
| `pie` | Position-independent executable |
| `c-shared` | C-callable shared library (`.so`/`.dll`/`.dylib`) |
| `c-archive` | C-callable static archive (`.a`) |
| `archive` | Go static library archive |
| `plugin` | Go plugin (`plugin` package) |
| `shared` | Shared library of Go packages |

---

## 9. Related references
- Build and test caching: https://pkg.go.dev/cmd/go#hdr-Build_and_test_caching
- Build constraints: https://pkg.go.dev/cmd/go#hdr-Build_constraints
- Linker flags: https://pkg.go.dev/cmd/link
- Modules reference: https://go.dev/ref/mod
