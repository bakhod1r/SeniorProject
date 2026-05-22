# go run — Specification

> **Focus:** Precise reference for the `go run` command — synopsis, arguments, flags, environment, exit behavior, and guarantees.
>
> **Sources:**
> - `go help run`, `go help build`, `go help buildflags`
> - cmd/go documentation: https://pkg.go.dev/cmd/go
> - Modules reference: https://go.dev/ref/mod

---

## 1. Synopsis

```
go run [build flags] [-exec xprog] package [arguments...]
go run [build flags] [-exec xprog] gofiles... [arguments...]
go run [build flags] package@version [arguments...]
```

`go run` compiles and runs the named main Go package or list of `.go` source files. The binary is built to a temporary directory and removed on exit.

---

## 2. Argument forms

| Form | Meaning |
|------|---------|
| `package` | An import path or relative path (`.`, `./cmd/x`) to a `main` package |
| `gofiles...` | An explicit list of `.go` files, all in `package main` |
| `package@version` | A versioned import path, resolved in module-aware mode, ignoring the current module's requirements for that package |
| `arguments...` | Everything after the package/files is passed to the running program |

A package path and a file list are mutually exclusive. A file list must include every file of the `main` package needed; it does not auto-include siblings.

---

## 3. Run-specific flags

| Flag | Effect |
|------|--------|
| `-exec xprog` | Run the compiled binary via `xprog` (e.g., an emulator or wasm runner) instead of executing it directly. Used for cross-arch and WASM execution. |

If `-exec` is not given and `GOOS`/`GOARCH` differ from the host, `go run` falls back to direct exec and fails for incompatible binaries (except where the toolchain provides a default runner, e.g., wasm).

---

## 4. Build flags (shared with `go build`)

`go run` accepts all build flags. Common ones:

| Flag | Effect |
|------|--------|
| `-race` | Enable the data race detector |
| `-msan` / `-asan` | Memory / address sanitizer |
| `-tags 'a,b'` | Set build constraints (build tags) |
| `-ldflags '...'` | Pass flags to the linker (e.g., `-X pkg.var=value`) |
| `-gcflags '...'` | Pass flags to the compiler (e.g., `all=-N -l`) |
| `-mod=mod\|readonly\|vendor` | Module download/verification mode |
| `-p n` | Number of programs (compile/link actions) to run in parallel |
| `-x` | Print the commands as they are executed |
| `-work` | Print the temporary work directory and do **not** delete it |
| `-v` | Print package names as they are compiled |
| `-trimpath` | Remove file system paths from the resulting binary |

Build flags MUST appear **before** the package/file argument. Tokens after it go to the program.

---

## 5. Environment variables

| Variable | Role |
|----------|------|
| `GOCACHE` | Location of the build cache; reused across runs |
| `GOTMPDIR` | Where the temporary work directory/binary is created (default: system temp) |
| `GOFLAGS` | Default flags applied to every `go` command (e.g., `-mod=readonly`) |
| `GOOS`, `GOARCH` | Target platform (cross-compile) |
| `CGO_ENABLED` | Whether cgo is enabled (affects linker, speed) |
| `GOMAXPROCS` | Affects the running program; default `-p` derives from CPU count |
| `GOPATH`, `GOMODCACHE` | Module cache location for `@version` resolution |
| `GOPROXY`, `GOSUMDB` | Module download and checksum policy for `@version` |

---

## 6. Exit codes and behavior

| Situation | Exit behavior |
|-----------|---------------|
| Build/compile/link fails | `go run` exits non-zero (typically 1) **before** the program runs; build errors print to stderr |
| Program runs and returns | `go run` exits with the program's exit status (e.g., `os.Exit(n)` → `n`) |
| Program panics | Non-zero exit (panic propagates as the process's status) |
| Signal terminates the program | The signal disposition propagates as for the child |

`go run` forwards stdin, stdout, stderr, and signals to the child process.

---

## 7. Behavioral guarantees

- **No persistent artifact.** The linked executable is created in a temporary directory and removed on exit (unless `-work` is given, which keeps the directory).
- **Build cache shared.** Compiled package objects persist in `GOCACHE`; only the final link is repeated each run.
- **Module-aware.** Resolution uses `go.mod` and the module graph; `package@version` resolves independently of the current module's requirements for that package.
- **CWD = caller's directory.** The program runs with the working directory from which `go run` was invoked, not the source directory.
- **Faithful forwarding.** Program arguments, exit code, and signals pass through unchanged.

---

## 8. Non-goals / limitations

- Not for producing reproducible or deployable artifacts (use `go build -o`).
- Not a debugger-friendly target (temporary, changing binary path).
- Not an interpreter (full compile every invocation).
- Not for production/container entrypoints.

---

## 9. Related references
- `go build`: https://pkg.go.dev/cmd/go#hdr-Compile_packages_and_dependencies
- Build and test caching: https://pkg.go.dev/cmd/go#hdr-Build_and_test_caching
- Build constraints (tags): https://pkg.go.dev/cmd/go#hdr-Build_constraints
- Modules reference: https://go.dev/ref/mod
