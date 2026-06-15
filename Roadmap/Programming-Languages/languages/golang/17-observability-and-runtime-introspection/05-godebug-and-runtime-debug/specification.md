# GODEBUG & `runtime/debug` — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Where These Are Specified](#where-these-are-specified)
3. [GODEBUG: Definition and Syntax](#godebug-definition-and-syntax)
4. [GODEBUG Default Resolution (Go 1.21+)](#godebug-default-resolution-go-121)
5. [The `//go:debug` and `godebug` Directives](#the-godebug-and-godebug-directives)
6. [Selected GODEBUG Settings](#selected-godebug-settings)
7. [The `runtime/debug` API Surface](#the-runtimedebug-api-surface)
8. [`BuildInfo` and `BuildSetting`](#buildinfo-and-buildsetting)
9. [Non-Default-Behavior Metrics](#non-default-behavior-metrics)
10. [Differences Across Go Versions](#differences-across-go-versions)
11. [References](#references)

---

## Introduction

The Go language specification (`go.dev/ref/spec`) does not specify `GODEBUG` or `runtime/debug`. Both are part of the *runtime and tooling*, not the language. The authoritative references are the **GODEBUG documentation** (`go.dev/doc/godebug`), the **`runtime` package** environment-variable documentation, and the **`runtime/debug` package** API documentation.

Sources of truth, in decreasing formality:

1. **`go.dev/doc/godebug`** — what GODEBUG is, the compatibility system, and the *history table* of every compatibility setting and its per-`go`-line default.
2. **`pkg.go.dev/runtime/debug`** — the package API.
3. **`pkg.go.dev/runtime`** (Environment Variables section) — `GODEBUG`, `GOGC`, `GOMEMLIMIT`, `GOTRACEBACK` definitions.
4. **Toolchain source** — `src/internal/godebug`, `src/runtime/debug`, `src/runtime/mgc*.go` — the de-facto spec where prose is silent.

This file separates "what the references state" from convention and implementation detail.

---

## Where These Are Specified

| Mechanism | Primary reference |
|-----------|-------------------|
| `GODEBUG` (compatibility) | `go.dev/doc/godebug` |
| `GODEBUG` (diagnostic settings) | `runtime` package env-var docs; `go.dev/doc/diagnostics` |
| `GOGC`, `GOMEMLIMIT` | `runtime` package env-var docs; GC Guide |
| `runtime/debug` functions | `pkg.go.dev/runtime/debug` |
| `//go:debug`, `godebug` go.mod directive | `go.dev/doc/godebug`; `go.dev/ref/mod` |
| Non-default-behavior metrics | `pkg.go.dev/runtime/metrics` |

---

## GODEBUG: Definition and Syntax

`GODEBUG` is an environment variable. Its value is a comma-separated list of `name=value` pairs:

```
GODEBUG=name1=value1,name2=value2
```

Specified properties:

- The runtime parses `GODEBUG` **once, at program startup**. Later changes to the environment do not affect already-resolved settings.
- **Unknown names are ignored**, with no diagnostic.
- For settings the environment names, the environment value **overrides** the binary's embedded default; settings not named retain their embedded defaults.
- Values are setting-specific strings; most compatibility settings use `1` (old behavior) versus unset/`0` (new behavior), and most diagnostic settings use a flag (`1`) or a numeric interval.

---

## GODEBUG Default Resolution (Go 1.21+)

Per `go.dev/doc/godebug`, the *default* value of each compatibility setting is resolved at build time from, in increasing precedence:

1. **The main module's `go` directive.** It selects the default-behavior baseline for that Go version. A `go.mod` with `go 1.N` yields the Go 1.N defaults for all compatibility settings.
2. **`godebug` directives in `go.mod`** (Go 1.23+). They override the `go`-line defaults for the named settings, module-wide.
3. **`//go:debug` directives in `package main`.** They override the above for that executable.

The `GODEBUG` environment variable (read at runtime) overrides all of the above.

The reference states the guarantee explicitly: upgrading the Go toolchain does **not** change a program's gated behavior; only changing the `go` line (or an explicit override) does. This is what makes the toolchain upgrade compatible by construction.

---

## The `//go:debug` and `godebug` Directives

### `//go:debug` (build directive)

Per `go.dev/doc/godebug`:

- Form: `//go:debug name=value`, in a comment immediately preceding the `package` clause.
- Permitted **only in `package main`** of an executable. Use elsewhere is an error.
- Sets the default for `name` in the built executable, overridable by the `GODEBUG` environment variable.

### `godebug` directive (go.mod, Go 1.23+)

Per the modules reference:

```
godebug (
    name1=value1
    name2=value2
)
```

or single-line `godebug name=value`. Sets module-wide defaults, overriding the `go`-line baseline, overridable by `//go:debug` and the environment.

---

## Selected GODEBUG Settings

The following are representative; the **authoritative, version-current list is the history table at `go.dev/doc/godebug`** and the runtime env-var docs. Settings are added and removed over time.

### Diagnostic settings (runtime behavior / tracing)

| Setting | Effect |
|---------|--------|
| `gctrace=1` | One summary line per GC cycle to stderr. |
| `schedtrace=N` | Scheduler summary every `N` ms. |
| `scheddetail=1` | Per-P/M/G detail (with `schedtrace`). |
| `inittrace=1` | Per-package `init` timing and allocation. |
| `allocfreetrace=1` | Stack trace at every allocation and free (very verbose). |
| `madvdontneed=1` | Use `MADV_DONTNEED` instead of `MADV_FREE` (Linux) for eager OS return. |
| `cgocheck=0|1|2` | cgo pointer-passing check level. |
| `http2debug=1|2` | HTTP/2 verbose logging in `net/http`. |

### Compatibility settings (gated behavior changes)

| Setting | Restores old behavior of |
|---------|--------------------------|
| `panicnil=1` | Allowing `panic(nil)` to deliver `nil` to `recover` (changed in Go 1.21). |
| `tlsrsakex=1` | RSA key-exchange TLS cipher suites in `crypto/tls`. |
| `x509sha1=1` | SHA-1 signature acceptance in certificate verification. |
| `httplaxcontentlength=1` | Lax `Content-Length` parsing in `net/http`. |
| `execerrdot=1` | `os/exec` resolving relative paths from `PATH`. |

The diagnostic settings are stable conveniences; the compatibility settings each correspond to a documented, dated behavior change and a planned removal window in the history table.

---

## The `runtime/debug` API Surface

Per `pkg.go.dev/runtime/debug`:

### GC and memory

| Function | Signature | Meaning |
|----------|-----------|---------|
| `SetGCPercent` | `func(percent int) int` | Set GC target ratio (`GOGC`); returns previous. `-1` disables GC. |
| `SetMemoryLimit` | `func(limit int64) int64` | Set soft memory limit in bytes (`GOMEMLIMIT`); returns previous. `math.MaxInt64` = no limit; negative = query only. |
| `FreeOSMemory` | `func()` | Force a GC and return freed memory to the OS. |
| `ReadGCStats` | `func(stats *GCStats)` | Fill GC statistics. |
| `SetMaxStack` | `func(bytes int) int` | Max single-goroutine stack; returns previous. |
| `SetMaxThreads` | `func(threads int) int` | Max OS threads; returns previous. Exceeding aborts. |
| `SetPanicOnFault` | `func(enabled bool) bool` | Make unexpected faults panic (per-goroutine); returns previous. |

### Diagnostics

| Function | Signature | Meaning |
|----------|-----------|---------|
| `Stack` | `func() []byte` | Current goroutine's stack trace. |
| `PrintStack` | `func()` | Write `Stack()` to stderr. |
| `WriteHeapDump` | `func(fd uintptr)` | Write a runtime-format heap dump. |
| `SetTraceback` | `func(level string)` | Crash traceback verbosity (`none`/`single`/`all`/`system`/`crash`). |
| `SetCrashOutput` | `func(f *os.File, opts CrashOptions) error` | Additional sink for crash output (Go 1.23). |

### Build info

| Function | Signature | Meaning |
|----------|-----------|---------|
| `ReadBuildInfo` | `func() (*BuildInfo, bool)` | Read embedded build metadata; `ok=false` if absent. |
| `ParseBuildInfo` | `func(data string) (*BuildInfo, error)` | Parse build-info text. |

Note `SetMemoryLimit` with a negative argument is a **query** (returns the current limit without changing it) — a specified convenience for reading the limit.

---

## `BuildInfo` and `BuildSetting`

Per `pkg.go.dev/runtime/debug`:

```go
type BuildInfo struct {
    GoVersion string         // toolchain version
    Path      string         // main package path
    Main      Module         // main module
    Deps      []*Module      // dependency modules
    Settings  []BuildSetting // key/value build settings
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

Specified `Settings` keys include the VCS stamps `vcs`, `vcs.revision`, `vcs.time`, `vcs.modified`; build configuration `GOOS`, `GOARCH`, `CGO_ENABLED`, `-ldflags`, `-tags`, `-buildmode`, `-trimpath`; and `DefaultGODEBUG` (the resolved GODEBUG defaults, when non-empty). `BuildInfo.String()` renders the `go version -m` format.

The VCS stamps are populated by `go build`/`go install` from a VCS checkout when `-buildvcs` is enabled (default `auto`). `ReadBuildInfo` returns `ok=false` when no build info is embedded (e.g., `go run` in some modes).

---

## Non-Default-Behavior Metrics

Per `pkg.go.dev/runtime/metrics`, the runtime exposes:

```
/godebug/non-default-behavior/<setting>:events
```

Specified properties:

- One counter per setting that has an instrumented non-default code path.
- Cumulative `uint64` event count from process start; **monotonic**, per-process.
- Incremented each time code takes the **non-default** (old/compatibility) behavior for `<setting>`.
- The set of available counters is version-dependent; enumerate via `metrics.All()`.

These are the only specified, stable way to observe reliance on compatibility behaviors (the `gctrace` text format is explicitly **not** a stable API).

---

## Differences Across Go Versions

- **Go 1.5** — `GODEBUG=gctrace=1` and scheduler traces established; `runtime/debug` GC controls present.
- **Go 1.12** — `madvdontneed` introduced as `MADV_FREE` became default on Linux.
- **Go 1.16** — `inittrace=1` added.
- **Go 1.18** — `ReadBuildInfo` gains VCS stamps (`vcs.revision`, `vcs.time`, `vcs.modified`); build settings recorded.
- **Go 1.19** — `SetMemoryLimit` and `GOMEMLIMIT` (soft memory limit) added.
- **Go 1.21** — GODEBUG **compatibility system** formalised; `//go:debug` directive; defaults derived from the `go` line; `panic(nil)` change gated by `panicnil`; `/godebug/non-default-behavior/*` metrics.
- **Go 1.23** — `godebug` directive in `go.mod`; `runtime/debug.SetCrashOutput` added.

The `runtime/debug` GC/diagnostic surface has been stable for years; the major additions are the soft memory limit (1.19), the compatibility system (1.21), and crash output / go.mod `godebug` (1.23).

---

## References

- [GODEBUG documentation & history table](https://go.dev/doc/godebug) — authoritative for the compatibility system.
- [`runtime/debug` package](https://pkg.go.dev/runtime/debug) — the API.
- [`runtime` package — Environment Variables](https://pkg.go.dev/runtime#hdr-Environment_Variables) — `GODEBUG`, `GOGC`, `GOMEMLIMIT`, `GOTRACEBACK`.
- [`runtime/metrics` package](https://pkg.go.dev/runtime/metrics) — non-default-behavior counters.
- [A Guide to the Go Garbage Collector](https://go.dev/doc/gc-guide) — `GOGC`/`GOMEMLIMIT`/`gctrace`.
- [Diagnostics](https://go.dev/doc/diagnostics) — diagnostic GODEBUG settings overview.
- [Go Modules Reference — `godebug` directive](https://go.dev/ref/mod) — go.mod directive.
- [Source: `src/internal/godebug`](https://cs.opensource.google/go/go/+/refs/tags/master:src/internal/godebug/) — setting registry.
