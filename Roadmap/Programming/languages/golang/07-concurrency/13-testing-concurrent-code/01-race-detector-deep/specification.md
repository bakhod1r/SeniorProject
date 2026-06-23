# Race Detector Deep Dive — Specification

## Table of Contents
1. [Scope](#scope)
2. [Definitions](#definitions)
3. [Flag Behaviour](#flag-behaviour)
4. [Detection Contract](#detection-contract)
5. [Reporting Contract](#reporting-contract)
6. [Environment Variables](#environment-variables)
7. [Supported Platforms](#supported-platforms)
8. [Interaction With Other Toolchain Features](#interaction-with-other-toolchain-features)
9. [Build-Tag Effects](#build-tag-effects)
10. [Exit Codes](#exit-codes)
11. [Compatibility](#compatibility)
12. [Summary](#summary)

---

## Scope

This document specifies the observable contract of the Go race detector — the `-race` flag of `go build`, `go test`, `go run`, and `go install`, plus the supporting runtime and environment variables. It does not specify TSan internal algorithms (those are in the professional file) or workflow patterns (those are in middle and senior).

The specification applies to Go 1.18 and later. Items added in specific versions are noted.

---

## Definitions

- **Data race.** Two or more memory accesses in different goroutines to the same memory location where (a) at least one is a write, and (b) the Go memory model establishes no happens-before relationship between them.
- **Happens-before.** The partial order defined in the Go memory model (`go.dev/ref/mem`) over memory operations.
- **`-race` build.** A build performed with the `-race` flag passed to a `go` subcommand.
- **Race runtime.** The TSan-derived runtime library statically linked into a `-race` build, residing under `runtime/race` in the standard library.
- **Race report.** The diagnostic text emitted by the runtime when a data race is detected.

---

## Flag Behaviour

### Subcommands that accept `-race`

| Subcommand | Effect |
|---|---|
| `go build -race` | Produces a race-instrumented binary. |
| `go test -race` | Builds and runs tests with the race runtime. |
| `go run -race` | Builds a race-instrumented binary, runs it, deletes it. |
| `go install -race` | Installs a race-instrumented binary into `$GOBIN`. |
| `go get -race` | Pre-Go-1.18; no effect in modern toolchain. |

### Implicit changes when `-race` is set

- The `race` build tag is set. Files with `//go:build race` are compiled; files with `//go:build !race` are excluded.
- The race runtime is linked into the binary.
- The compiler inserts instrumentation calls at every instrumented memory access.
- Default `GOMAXPROCS` semantics are unchanged.
- The cgo flag `-race` is implicitly set; cgo compilation links the C/C++ TSan runtime as needed.

### Diagnostic that `-race` is on at runtime

A program can check whether it was built with `-race`:

```go
import _ "unsafe"

//go:linkname raceEnabled runtime.raceenabled

var raceEnabled bool
```

The standard library does not export a public predicate; the conventional check is the `race` build tag.

---

## Detection Contract

The race runtime detects a data race when:

1. Two memory accesses are observed on the same memory location, **and**
2. The two accesses are made by different goroutines, **and**
3. At least one access is a write, **and**
4. No happens-before edge connects them through the synchronisation primitives the runtime understands.

When all four conditions hold for an executed pair of accesses, the runtime guarantees to emit a race report unless `halt_on_error` has already fired for an earlier race.

### What counts as a memory access

Per the Go memory model:

- Loads and stores of any size that the compiler can instrument.
- Map operations: `map[k]`, `map[k] = v`, `delete(map, k)`.
- Slice element accesses.
- Pointer dereferences.
- Channel send and receive.
- Atomic operations in `sync/atomic`.

### What synchronisation the runtime understands

- Channel send and receive (buffered and unbuffered).
- `close(ch)` followed by a receive that observes the close.
- `sync.Mutex.Lock` / `Unlock`.
- `sync.RWMutex.RLock` / `RUnlock` / `Lock` / `Unlock`.
- `sync.Once.Do`.
- `sync.WaitGroup.Add` / `Done` / `Wait`.
- `sync.Map` internal synchronisation.
- All `sync/atomic` operations.
- Goroutine creation: the `go f()` statement happens-before the first statement of `f`.
- `runtime.Goexit` and goroutine termination ordering with respect to `WaitGroup`.

### What the runtime does *not* understand

- Custom lock-free synchronisation using `unsafe.Pointer` arithmetic.
- Memory accesses inside cgo C code.
- Inter-process synchronisation (file locks, shared memory).

### Determinism

The detector is deterministic for a given execution: the same trace of accesses and synchronisation operations always produces the same report. Because Go's scheduler is nondeterministic, different runs may exercise different schedules and therefore report different races (or none).

---

## Reporting Contract

### Format

A race report consists of:

```
==================
WARNING: DATA RACE
<access type> at <address> by goroutine <id>:
  <stack trace, one frame per line>

Previous <access type> at <address> by goroutine <id>:
  <stack trace, one frame per line>

Goroutine <id> (<state>) created at:
  <stack trace>

Goroutine <id> (<state>) created at:
  <stack trace>
==================
```

The header `WARNING: DATA RACE` and the trailer `==================` are stable across versions. The internal order of accesses (current vs previous) reflects the order TSan observed them.

### `Found N data race(s)` summary

After the test or process exits, if any races were detected, the line:

```
Found <N> data race(s)
```

is printed. This line is part of the contract. CI scripts may grep for it.

### Stream

Reports are written to **standard error** by default. The `log_path` environment variable redirects them.

### Race detection during test pass

When a race is detected during a `go test -race` run, the test is marked failed regardless of whether the test function called `t.Fatal`.

---

## Environment Variables

### `GORACE`

A space-separated list of `key=value` settings. Unknown keys are silently ignored (compatibility guarantee for future additions).

| Key | Type | Default | Meaning |
|---|---|---|---|
| `halt_on_error` | bool | 0 | Exit process on first race. |
| `history_size` | int 0..7 | 1 | Size of access history per goroutine. Larger = better traces for old accesses, more memory. |
| `log_path` | string | "" | If non-empty, write reports to `<log_path>.<pid>`. If empty, write to stderr. |
| `exitcode` | int | 66 | Exit code when `halt_on_error=1` triggers. |
| `strip_path_prefix` | string | "" | Trim this prefix from source paths in reports. |
| `atexit_sleep_ms` | int | 1000 | How long to wait at exit for pending reports. |

Boolean keys accept `0`/`1`. Integer keys accept decimal strings.

### `GODEBUG=asyncpreemptoff=1`

Disables asynchronous preemption. Race detection still works but some scheduler interactions are different. Useful for reproducing scheduler-sensitive races.

### `GOTRACEBACK`

Affects how stack traces are formatted in race reports. Higher values (`crash`, `system`) include more frames; lower values (`none`) suppress traceback in panics but still leave race reports intact.

---

## Supported Platforms

The race detector is supported on the following `GOOS`/`GOARCH` pairs as of Go 1.22:

| GOOS | GOARCH | Status |
|---|---|---|
| `linux` | `amd64` | Supported since Go 1.1. |
| `linux` | `arm64` | Supported since Go 1.16. |
| `linux` | `ppc64le` | Supported since Go 1.18. |
| `linux` | `s390x` | Supported since Go 1.18. |
| `linux` | `riscv64` | Supported since Go 1.22. |
| `darwin` | `amd64` | Supported since Go 1.1. |
| `darwin` | `arm64` | Supported since Go 1.16. |
| `freebsd` | `amd64` | Supported since Go 1.1. |
| `netbsd` | `amd64` | Best-effort. |
| `windows` | `amd64` | Supported since Go 1.6. |

All other combinations (32-bit, mobile, wasm, plan9, etc.) are **not** supported. Attempting `go build -race` on an unsupported platform fails with an error message from the toolchain.

### Memory requirements

The race detector requires a 64-bit address space large enough for the shadow mapping. On Linux amd64 this is roughly 16 TB of virtual address space reserved (lazily faulted). Containers with restrictive virtual-memory limits may fail to allocate this; relax `RLIMIT_AS` if necessary.

---

## Interaction With Other Toolchain Features

### `-race` and cgo

- `-race` enables instrumentation in Go code only.
- C/C++ code compiled via cgo can be instrumented by passing `-fsanitize=thread` in `CGO_CFLAGS` and `CGO_LDFLAGS`.
- Memory shared between Go and C is tracked by Go's TSan on the Go side and (if instrumented) C's TSan on the C side. The two runtimes coordinate when both are linked.

### `-race` and `-cover`

Both are supported simultaneously. Coverage is recorded normally; race detection runs concurrently. Test wall time is the sum of both overheads.

### `-race` and `-msan`

`-msan` is the memory sanitizer for cgo. It can be combined with `-race` only on supported platforms. Most teams choose one or the other.

### `-race` and `-gcflags`

Generally orthogonal. Note that `-gcflags="-N -l"` (disable optimisations and inlining) may produce more frames in race reports and slow execution further.

### `-race` and PIE (position-independent executables)

Supported. The shadow mapping accommodates randomised base addresses.

### `-race` and `-buildmode`

| `-buildmode` | `-race` works? |
|---|---|
| `default` | Yes. |
| `pie` | Yes. |
| `c-archive` | Limited; not all platforms. |
| `c-shared` | Limited; not all platforms. |
| `plugin` | No. |
| `shared` | No. |

---

## Build-Tag Effects

Setting `-race` adds `race` to the build tag set. Conversely, omitting `-race` keeps `!race` true.

```go
//go:build race

// This file compiles only when -race is set.
```

```go
//go:build !race

// This file compiles only when -race is NOT set.
```

This is the mechanism for race-only assertions or stubs.

---

## Exit Codes

| Exit code | Meaning |
|---|---|
| 0 | Process exited normally, no race detected. |
| 66 | At least one race detected. May be overridden by `GORACE=exitcode=N`. |
| Other | Process exited for another reason (panic, signal, normal non-zero exit code). |

`go test -race` uses exit code 1 on test failure including race detection. To distinguish "test failed by race" from "test failed by assertion," parse the `WARNING: DATA RACE` marker in the log.

---

## Compatibility

### Source compatibility

Code compiles the same way under `-race` and without. The detector requires no annotations.

### Binary compatibility

A `-race` build is **not** ABI-compatible with a non-race build. You cannot link race-instrumented `.a` files into non-race binaries or vice versa.

### Version compatibility

The on-disk format of `-race` is internal and may change between Go versions. The user-facing contract (flags, environment variables, exit codes, report format) is stable across minor versions. Breaking changes appear in release notes.

### Forward compatibility

New `GORACE` keys may be added in future Go versions. Unknown keys are ignored. New report fields may be appended; consumers should parse leniently.

---

## Summary

The `-race` flag is a uniform toolchain feature with a precise contract: build with TSan instrumentation, run with the race runtime, emit reports for any executed data race, exit with status 66 on detection. Tunable via `GORACE`. Supported on a defined list of `GOOS`/`GOARCH` pairs, all 64-bit. The detection contract is sound (no false positives in correct code) and precise per execution; coverage of code paths is the user's responsibility. Reports follow a stable format that scripts may parse. The detector composes with coverage, PIE builds, and most build modes; it does not compose with `plugin` or `shared` build modes.
