# go tool — Specification

> **Focus:** Precise reference for the `go tool` launcher and the standard catalog of helper tools — synopsis, the tool table, locations, environment, version policy, and behavioral guarantees.
>
> **Sources:**
> - `go help tool`
> - cmd/go documentation: https://pkg.go.dev/cmd/go
> - The `src/cmd/<name>/` source tree: https://github.com/golang/go/tree/master/src/cmd

---

## 1. Synopsis

```
go tool                              # list installed tools
go tool name [arguments...]          # run a named tool with arguments
go tool -n name [arguments...]       # print the command line, do not execute
```

`go tool` locates the named helper binary inside `$GOTOOLDIR` and executes it with the remaining arguments. All forwarding is byte-faithful: stdin, stdout, stderr, signals, and exit code propagate as for a direct exec.

---

## 2. Argument forms

| Form | Meaning |
|------|---------|
| (none) | Print the list of available tool names, one per line |
| `name` | Run `$GOTOOLDIR/name` with no extra arguments |
| `name args...` | Run `$GOTOOLDIR/name` with the given arguments |
| `-n name args...` | Print the command line that would run; do not execute |

A tool name with no matching binary returns: `go: no such tool "X"`.

---

## 3. Standard tool catalog (Go 1.21+)

Exact membership varies by release; the table reflects the typical contents.

| Tool | Purpose | Notes |
|------|---------|-------|
| `addr2line` | Map a PC address to `file:line` and symbol | Reads addresses from stdin |
| `asm` | Assemble `.s` files into object files | Driven by `go build` |
| `buildid` | Print (or with `-w`, write) the build ID of a Go object/binary | Identity, not authentication |
| `cgo` | Emit Go/C bridge files for packages using `import "C"` | Driven by `go build` |
| `compile` | Compile Go source into object files | Driven by `go build`; expects `-importcfg` |
| `cover` | Render a coverage profile (`-func`, `-html`) | Consumes profile from `go test -coverprofile` |
| `covdata` | Aggregate/convert profiles from `go build -cover` instrumentation | Added with the integration-coverage rework |
| `dist` | Bootstrap and inspect the toolchain; `dist list` enumerates targets | Self-build tool |
| `fix` | Mechanically rewrite source for API migrations | Used rarely |
| `link` | Link object files into an executable | Driven by `go build`; expects `-importcfg` |
| `nm` | List symbols in a Go object/binary | `-size`, `-sort` for size analysis |
| `objdump` | Disassemble functions inside a Go binary | `-s REGEX` to focus |
| `pack` | `ar`-like archiver for Go package archives | Driven by `go build` |
| `pprof` | Front-end for pprof profiles | Vendored from `github.com/google/pprof` |
| `test2json` | Convert `go test -v` output to a JSON event stream | Used by `go test -json` |
| `trace` | Web UI for the runtime execution tracer | Versioned with the toolchain |

`go tool vet` was removed; modern Go invokes vet via `go vet` and as a subset of `go test`. `go tool yacc` was removed earlier in favor of external `goyacc`.

---

## 4. Locations

| Path | Role |
|------|------|
| `$GOROOT/pkg/tool/<GOOS_GOARCH>/` | Default install location of all tool binaries |
| `$GOTOOLDIR` | Override / authoritative current value (`go env GOTOOLDIR`) |
| `src/cmd/<name>/` | Source of each tool in the Go tree |

Discovery rule: `go tool name` opens `$GOTOOLDIR/name` (or `$GOTOOLDIR/name.exe` on Windows). If the file does not exist, the launcher errors out.

---

## 5. Environment variables

| Variable | Role |
|----------|------|
| `GOROOT` | Where Go is installed; default base for `GOTOOLDIR` |
| `GOTOOLDIR` | Directory of helper binaries; defaults to `$GOROOT/pkg/tool/<host>` |
| `GOTOOLCHAIN` | Pin the toolchain version (e.g., `go1.22.3`); also versions the tool catalog |
| `GOOS`, `GOARCH` | Affect which tool directory is selected when cross-bootstrapping |
| `GOFLAGS` | Applies to `go` invocations; **not** propagated into helper tools directly |
| `GOCACHE` | Build cache used by `compile`/`link` orchestrated through `go build` |

`GOFLAGS` affects what `go build`/`go test` pass to the helpers; it does not magically inject flags into a raw `go tool X` invocation.

---

## 6. Version policy

- The tool catalog and each tool's flags are **versioned with the Go toolchain**. Tools may be added (`covdata`) or removed (`vet`, `yacc`) across releases.
- The output format of analysis tools (`cover`, `pprof`, `trace`, `nm`, `objdump`) is allowed to evolve across minor versions. Pin `GOTOOLCHAIN` for parser-stable output.
- The command line of "build-internal" tools (`compile`, `link`, `asm`, `cgo`, `pack`) is an **internal contract** between `cmd/go` and the toolchain and may change at any release; interception should go through `go build -toolexec=PROGRAM` rather than direct invocation.

---

## 7. Behavioral guarantees

- **Faithful forwarding.** `go tool name args...` execs the tool with `args...` unchanged; stdin/stdout/stderr/signals/exit code propagate.
- **Discovery is filesystem-based.** The set of available tools equals the files in `$GOTOOLDIR`.
- **No implicit flags.** `go tool` itself adds nothing to the tool's argument vector (beyond the program name).
- **Toolchain-coupled.** Each tool binary matches the Go version it was shipped with; mixing tool binaries across versions is unsupported.

---

## 8. Non-goals / limitations

- `go tool` is **not** a plugin system; you cannot register custom tools by dropping binaries into arbitrary directories. (Custom utilities should be installed via `go install` and run by name.)
- `go tool` is **not** a stable contract for "build-internal" tools; do not script around their flags.
- `go tool` does **not** authenticate or sign the artifacts it inspects; `buildid` is content-derived, not cryptographic.
- `go tool` is **not** designed for production deployments — the tool binaries themselves are not meant to ship inside your application image.

---

## 9. Exit codes

| Situation | Exit behavior |
|-----------|---------------|
| Tool name not found | Non-zero from `go`; `go: no such tool "X"` on stderr |
| Tool runs and returns | Propagates the tool's own exit code |
| Tool killed by signal | Signal disposition propagates |

---

## 10. Related references
- `go help tool`
- Source tree of helpers: https://github.com/golang/go/tree/master/src/cmd
- Action graph (`cmd/go/internal/work/exec.go`): https://github.com/golang/go/blob/master/src/cmd/go/internal/work/exec.go
- `cmd/compile`: https://pkg.go.dev/cmd/compile
- `cmd/link`: https://pkg.go.dev/cmd/link
- `cmd/pprof` and upstream: https://github.com/google/pprof
- Coverage for integration tests: https://go.dev/blog/integration-test-coverage
