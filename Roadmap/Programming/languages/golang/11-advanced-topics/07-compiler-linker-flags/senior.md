# Compiler & Linker Flags — Senior

## 1. The compile→link pipeline

Each Go package goes through:

1. **Parse**: source → AST.
2. **Type-check**: AST → typed AST.
3. **Escape analysis + inlining** (controlled by `-gcflags`).
4. **SSA codegen**: typed AST → SSA → machine instructions.
5. **Object archive** (`.a` file in `$GOCACHE`).

The linker (`cmd/link`) takes archives + the runtime + stdlib + symbols and produces the binary. `-ldflags` apply at this stage.

Knowing where each flag acts lets you predict its effect.

---

## 2. Tracking compiler internals

`-gcflags='-d=<key>=<value>'` sets debug knobs:

| Knob | Effect |
|------|--------|
| `-d=ssa/<pass>/debug=1` | Dump SSA before/after a pass |
| `-d=ssa/check/seed=42` | Seed SSA randomized passes |
| `-d=ssa/print/seed=42` | Print all SSA |
| `-d=checkptr=2` | Stricter unsafe.Pointer checks |
| `-d=initorder` | Print package init order |

These are mostly used by Go contributors but occasionally help when diagnosing a compiler-version-specific bug.

---

## 3. `-S` and `-spectre`

```bash
go build -gcflags='-S' ./...
```

Prints the generated assembly per function. Reading the output is the most reliable way to verify whether the compiler inlined or eliminated bounds checks.

```bash
go build -gcflags='-spectre=all' ./...
```

Adds Spectre v1 mitigation. Slight performance cost. Useful in environments where untrusted code shares the same CPU.

---

## 4. The linker's job in detail

`cmd/link` does:

- Resolves symbol references across packages.
- Decides what to keep (dead code elimination).
- Lays out the binary (text, data, rodata, BSS).
- Embeds metadata (`go version -m` info).
- Optionally strips symbol info.

For static binaries the linker also bundles libc; for cgo, it cooperates with the external linker.

---

## 5. `-X` injection deeply

```go
package main

var (
    version   = "dev"     // injectable
    buildTime = "unknown" // injectable
    Const     = "fixed"   // NOT injectable (it's a constant if compiler proves immutability, even though declared var)
)
```

```bash
go build -ldflags="-X main.version=$(git describe) -X 'main.buildTime=$(date)'"
```

Watch out:

- The variable must be a `var`, not a `const`.
- It must be `string`-typed; non-strings can't be injected.
- The compiler must not prove it's read-only — if so, it might be folded into a constant (rare, but possible).
- Spaces in the value need quoting carefully.

For values you really need, declare them in a package that's used by `main`:

```go
// pkg/buildinfo/buildinfo.go
package buildinfo

var (
    Version   = "dev"
    BuildTime = "unknown"
    GitCommit = "unknown"
)
```

```bash
go build -ldflags="\
  -X 'example.com/proj/pkg/buildinfo.Version=$(VERSION)' \
  -X 'example.com/proj/pkg/buildinfo.BuildTime=$(date)' \
  -X 'example.com/proj/pkg/buildinfo.GitCommit=$(git rev-parse HEAD)'" \
  ./cmd/app
```

---

## 6. `-trimpath` semantics

Without `-trimpath`:

```
panic: foo
goroutine 1 [running]:
main.bar()
    /Users/alice/projects/myapp/cmd/app/main.go:23 +0x42
```

With `-trimpath`:

```
panic: foo
goroutine 1 [running]:
main.bar()
    example.com/myapp/cmd/app/main.go:23 +0x42
```

The full local path is replaced by the canonical import path. For reproducible builds and for not leaking developer paths into binaries, always use `-trimpath` in release builds.

---

## 7. Build IDs and `-buildid`

Each Go binary contains a build ID — a hash of inputs that uniquely identifies the build. Used by:

- The build cache for incremental rebuilds.
- `go version -m` to show what was built.
- OS-level tooling (e.g., `debuginfod` on Linux).

`-ldflags="-buildid=''"` clears it. For reproducible binaries you want this; for production deployments, the build ID is useful to embed.

---

## 8. The external linker pathway

```bash
go build -ldflags='-linkmode=external -extldflags="-static"' ./...
```

Internal linker (Go's own): pure Go, fast, supports all platforms.
External linker (system `gcc -o ...`): required for some cgo cases, static linking, link-time decoration.

When cgo is enabled, `linkmode=external` is the default. For pure Go, the internal linker is preferred (faster, fewer toolchain dependencies).

`-extldflags` lets you pass arbitrary flags to the external linker — `-static`, `-Wl,-rpath=...`, etc.

---

## 9. PGO in detail

Profile collection:

```bash
# From a running service
curl -o cpu.pgo http://localhost:6060/debug/pprof/profile?seconds=60

# From a load test
go test -cpuprofile=cpu.pgo -bench=. ./...
```

Build with the profile:

```bash
go build -pgo=cpu.pgo ./cmd/app
```

Or place `default.pgo` next to `main.go` and use `-pgo=auto`.

The compiler uses the profile to:

- Inline more aggressively in hot paths.
- Devirtualize interface calls when the type is observed dominant.
- Optimize register allocation for hot loops.

Typical real-world gains: 5–10%. Higher (15%+) for heavily polymorphic code that PGO can devirtualize.

PGO profiles are stable across "small" code changes — you don't need to re-profile every commit. Refresh weekly or monthly.

---

## 10. Cross-compilation gotchas

Pure-Go cross-compile: straightforward.

```bash
GOOS=linux GOARCH=arm64 go build .
```

Cgo cross-compile: needs a cross C toolchain.

```bash
GOOS=linux GOARCH=arm64 CC=aarch64-linux-gnu-gcc CGO_ENABLED=1 go build .
```

For typical multi-platform release, easier paths:

- `CGO_ENABLED=0` and accept the pure-Go path.
- Docker buildx for each target image.
- `zig cc` as a universal cross compiler.

---

## 11. Embedding VCS info

Go 1.18+ automatically embeds VCS metadata when building from a clean working tree inside a VCS repo. Visible via:

```bash
go version -m ./binary | grep vcs
```

To disable (e.g., for reproducible builds where the commit shouldn't be embedded):

```bash
go build -buildvcs=false ./...
```

To require it (CI verification):

```bash
go build -buildvcs=true ./...     # fails if VCS info would be missing
```

---

## 12. Race / sanitizer impact

| Mode | Cost | When |
|------|------|------|
| `-race` | 2–20× slower, ~3× memory | Test suites, dev runs |
| `-msan` | ~2× slower, requires cgo, Linux/amd64 or arm64 | Debugging uninit reads |
| `-asan` | ~2× slower, requires cgo | Debugging out-of-bounds |

Never ship sanitizer-instrumented binaries to production. Always run race tests in CI.

---

## 13. Plugin-mode caveats

```bash
go build -buildmode=plugin -o plugin.so ./pkg/plugin
```

Works on Linux/macOS only. Subject to many restrictions:

- Main app and plugins must be built with identical toolchain, flags, and `GOROOT`.
- Plugin types and host types must match exactly (`reflect.TypeOf` identity).
- Plugins can't be unloaded.

See [13-plugin-package](../13-plugin-package/) for the dedicated chapter.

---

## 14. Summary

Senior-level toolchain control comes from knowing which flag acts at which stage: `-gcflags` at compile, `-ldflags` at link, plus top-level options like `-pgo`, `-trimpath`, `-race`, and the `GOOS`/`GOARCH` env vars. Reproducible builds need `-trimpath` plus pinned versions plus stripped build IDs. PGO is a low-effort 5–10% CPU win once your service has a hot path worth profiling.

---

## Further reading
- `cmd/compile` README: https://github.com/golang/go/tree/master/src/cmd/compile
- `cmd/link` source: https://github.com/golang/go/tree/master/src/cmd/link
- PGO design: https://go.dev/doc/pgo
- Reproducible builds: https://reproducible-builds.org/
