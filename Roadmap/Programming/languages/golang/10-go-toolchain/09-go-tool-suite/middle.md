# go tool — Middle

## 1. The full catalog

This is the standard set of binaries `go tool` exposes in Go 1.21+ (exact contents vary by release). Each is a real executable in `$GOROOT/pkg/tool/<OS_arch>/`.

| Tool | One-line purpose |
|------|------------------|
| `addr2line` | Translate a program-counter address into `file:line` and symbol |
| `asm` | The Go assembler; turns `.s` files into object files |
| `buildid` | Print (or rewrite) the build-id of a Go object or executable |
| `cgo` | Generate the glue files that bridge Go and C |
| `compile` | The Go compiler proper (`*.go` → object file `*.o`) |
| `cover` | Convert a coverage profile into HTML / per-function summary |
| `covdata` | Combine and analyze profiles produced by `-cover` instrumentation |
| `dist` | Build the Go toolchain itself; also exposes useful queries like `dist list` |
| `fix` | Mechanically rewrite old Go source for API changes |
| `link` | The Go linker; combines object files into an executable |
| `nm` | List symbols (functions, variables) inside a Go object/binary |
| `objdump` | Disassemble functions inside a Go binary |
| `pack` | A tiny `ar`-like archiver for `.a` packages |
| `pprof` | Front-end for analyzing pprof profiles (CPU, heap, block, …) |
| `test2json` | Convert `go test -v` output into a JSON event stream |
| `trace` | Web UI for the execution tracer |
| `vet` (legacy) | The static analyzer; modern Go invokes it via `go vet`, not `go tool vet` |

Knowing the *purpose* of each is more useful than memorising flags — you can always read `go tool <name> -h`.

---

## 2. Two categories: "build-internal" vs "user-facing"

A useful mental split:

| Category | Tools | When you call them |
|----------|-------|--------------------|
| Build-internal | `asm`, `cgo`, `compile`, `link`, `pack`, `dist`, `fix`, `buildid` | Normally invoked by `go build`/`go install` for you |
| User-facing | `pprof`, `trace`, `cover`, `nm`, `objdump`, `addr2line`, `test2json`, `dist list` | You run these directly during development and CI |

Build-internal tools are usable directly (some debugging requires it), but they expect specific input layouts (`-importcfg`, archive directories, …) that `go build` normally fills in.

---

## 3. Coverage workflow with `cover`

The pair is `go test -coverprofile=...` then `go tool cover`:

```bash
go test -coverprofile=cover.out ./...

# Per-function summary
go tool cover -func=cover.out
# pkg/strings/strings.go:25:    Trim    100.0%
# pkg/strings/strings.go:73:    Split    87.5%
# total:                        (statements)    91.4%

# Annotated HTML report
go tool cover -html=cover.out -o coverage.html
```

`go tool cover` only consumes a profile — it does not collect one. The collection happens during `go test -cover...`.

For multi-binary integration tests, `go build -cover` plus `go tool covdata` merges profiles from many runs.

---

## 4. Listing supported build targets

```bash
go tool dist list                  # GOOS/GOARCH pairs
go tool dist list -json            # machine-readable form
go tool dist list -json | jq '.[] | select(.CgoSupported)'
```

This is the authoritative answer to "can I cross-compile to X?" for *this* toolchain version. Older toolchains may not list newer platforms.

---

## 5. Inspecting binaries with `nm`

```bash
go build -o app ./cmd/server
go tool nm app | head
# 0000000001034000 T main.main
# 0000000001034200 T main.run
# 0000000001100000 D runtime.buildVersion
```

The middle column is the symbol type: `T`/`t` text, `D`/`d` data, `B`/`b` bss, `R`/`r` read-only data. Use `-size` to see how much each symbol weighs:

```bash
go tool nm -size app | sort -k2 -nr | head
```

A common use: find what is making your binary big.

---

## 6. Disassembling one function with `objdump`

```bash
go tool objdump -s '^main\.greet$' app
# TEXT main.greet(SB) /tmp/hello/hello.go
#   hello.go:5     0x10a1234 ...   MOVQ ...
```

`-s` takes a Go regexp matched against fully-qualified symbol names (`pkg.Func`). Without `-s`, it disassembles everything, which is usually overwhelming. Pair with `addr2line` to map specific PCs back to source.

---

## 7. Build-id checks with `buildid`

Every Go object embeds a content-derived ID. Comparing two artifacts is a one-liner:

```bash
go tool buildid release-1.bin
go tool buildid release-2.bin
# different IDs → different inputs (source, flags, deps, toolchain)
```

CI pipelines use this to assert that a re-build of the same commit with the same flags produces the same bytes (reproducibility checks).

---

## 8. `test2json` for structured test output

`go test -json` is the everyday command; under the hood it uses `test2json`:

```bash
go test -json ./...                # idiomatic; produces JSON events
go test -v ./... | go tool test2json   # convert plain -v output later
```

Each event is one JSON object per line: `{"Time":..., "Action":"run", "Package":"foo", "Test":"TestX"}`. CI dashboards (gotestsum, ci-frameworks) consume this stream directly.

---

## 9. `pprof` and `trace` are launchers, too

```bash
go tool pprof cpu.out                 # interactive
go tool pprof -http=:8080 cpu.out     # web UI
go tool pprof http://localhost:6060/debug/pprof/heap  # live profile
```

```bash
go tool trace trace.out               # opens browser UI
```

These two are thin wrappers around well-known open-source tools (the Google `pprof` and the Go runtime trace viewer). You can also install standalone `pprof`; behavior is the same.

---

## 10. Reading help

Every tool has its own `-h`:

```bash
go tool nm -h
go tool objdump -h
go tool buildid -h
go tool pprof -h
```

The help output is the source of truth — the published web docs lag behind individual tool flags.

---

## 11. Summary

The `go tool` catalog splits into build-internal tools that `go build` drives for you (`compile`, `link`, `asm`, `cgo`, `pack`, `dist`, `fix`, `buildid`) and user-facing tools you invoke daily (`pprof`, `trace`, `cover`, `nm`, `objdump`, `addr2line`, `test2json`, `dist list`). Pair `go test -coverprofile` with `go tool cover -html`, use `nm -size` to chase binary bloat, `objdump -s` to disassemble one function, and `buildid` to verify artifact identity.

---

## Further reading
- `go help tool`
- `cmd/cover`, `cmd/nm`, `cmd/objdump`, `cmd/pprof`, `cmd/trace`: https://pkg.go.dev/cmd
- pprof: https://github.com/google/pprof
