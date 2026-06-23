# Concurrent Fuzzing — Specification

> Precise contract of the `testing.F` API and the `go test -fuzz` flags. What is guaranteed, what is implementation-defined, what is platform-specific.

## Table of Contents

1. [`testing.F` API contract](#testingf-api-contract)
2. [`go test -fuzz` flags](#go-test--fuzz-flags)
3. [Corpus encoding format](#corpus-encoding-format)
4. [Filesystem layout](#filesystem-layout)
5. [Worker process contract](#worker-process-contract)
6. [Race detector composition](#race-detector-composition)
7. [Platform support](#platform-support)
8. [Versioning and stability](#versioning-and-stability)

---

## `testing.F` API contract

### Methods

```go
type F struct { /* unexported */ }

// Add seeds the corpus with one entry. The argument types must match across all
// calls to Add for the same F and must match the parameter types (after *testing.T)
// of the function passed to Fuzz.
//
// Supported types: []byte, string, bool, byte, rune, all int and uint variants,
// float32, float64.
//
// Calling Add after Fuzz panics. Calling Add with mismatched types panics when
// the fuzz target starts.
func (f *F) Add(args ...any)

// Fuzz registers the fuzz function. The argument must be a function whose first
// parameter is *testing.T and whose remaining parameters match the types supplied
// to Add. Fuzz returns once seeding and (if -fuzz is set) mutation are complete,
// or when the test fails.
//
// Calling Fuzz more than once on the same F panics.
func (f *F) Fuzz(ff any)

// Skip marks the entire fuzz target as skipped. Equivalent to calling SkipNow.
func (f *F) Skip(args ...any)
func (f *F) Skipf(format string, args ...any)
func (f *F) SkipNow()

// Standard logging and failure methods, inherited from *testing.common semantics.
func (f *F) Fatal(args ...any)
func (f *F) Fatalf(format string, args ...any)
func (f *F) Error(args ...any)
func (f *F) Errorf(format string, args ...any)
func (f *F) Log(args ...any)
func (f *F) Logf(format string, args ...any)
func (f *F) Helper()
func (f *F) Cleanup(fn func())
func (f *F) TempDir() string
```

### Function-shape contract

The function passed to `Fuzz` must:

- Be a function value, not nil.
- Take `*testing.T` as its first parameter.
- Take zero or more additional parameters of supported types.
- Match, in shape and order, the arguments passed to every `f.Add` call.

Violations cause `f.Fuzz` to call `f.Fatal` (typically) or panic, terminating the fuzz target.

### Concurrent calls

`*testing.F` is *not* safe for concurrent use by multiple goroutines. The framework calls fuzz functions from a single goroutine per worker process. User code inside the fuzz function may spawn its own goroutines freely.

### Lifecycle ordering

1. `go test` discovers the fuzz target.
2. The seed corpus is built: `f.Add` calls + files in `testdata/fuzz/FuzzXxx/` + (if `-fuzz` matches) files in `$GOCACHE/fuzz/.../FuzzXxx/`.
3. Each seed is run once by the parent process under regular test rules. Failures here halt the run.
4. If `-fuzz` is set and seeds pass, the coordinator launches workers and begins mutation.
5. Workers run until `-fuzztime` expires, a failure occurs, or the parent is interrupted.

---

## `go test -fuzz` flags

### `-fuzz <regexp>`

Selects the fuzz target. The regexp is matched against the function name. Exactly one match is required; if multiple fuzz targets match, `go test` errors out.

```
go test -fuzz=FuzzParse
go test -fuzz=^FuzzParse$
go test -fuzz="^FuzzParse$|^FuzzDecode$"  # ERROR — must match exactly one
```

### `-fuzztime <duration|count>`

How long to fuzz. Accepts:
- Duration strings: `30s`, `5m`, `2h`.
- Iteration counts with the `x` suffix: `100000x`, `1000x`.

Default: no limit. The fuzzer runs until interrupted or until it finds a failure.

`-fuzztime=10000x` is *total* iterations across all workers, not per worker.

### `-fuzzminimizetime <duration|count>`

Maximum time spent minimising a failing input. Same format as `-fuzztime`. Default: `60s`.

`-fuzzminimizetime=0x` disables minimisation entirely (you get the un-minimised input as the reproducer).

### `-fuzzcachedir <path>`

Override the location of the generated corpus. Default: `$GOCACHE/fuzz/<module>/<package>/<target>`.

The directory is created if missing. The framework owns the directory contents; do not store unrelated files there.

### `-parallel <n>`

Number of fuzz worker processes. Default: `GOMAXPROCS`.

Note: this is workers per process, not total parallelism across CI shards. To shard across CI nodes, run multiple `go test` invocations.

### `-test.fuzzworker` (internal)

Set by the coordinator when launching a worker. End users do not pass it.

### `-run <regexp>`

Standard test flag. When fuzzing, you typically pass `-run=^$` to skip ordinary tests so the run focuses on fuzzing.

### Interaction with other flags

- `-race`: compose freely. Coverage and TSan instrumentation both active.
- `-cpu`: respected by workers. `-cpu=4` sets `GOMAXPROCS` inside each worker.
- `-count`: ignored under `-fuzz`. The fuzzer drives iteration count itself.
- `-short`: respected by the fuzz function body if it checks `testing.Short()`. Does not change fuzzer behaviour.
- `-timeout`: applies to the entire `go test` invocation. The fuzzer respects it as an outer bound.
- `-coverprofile`: writes a profile of the seed corpus run. Mutation iterations do not contribute (avoiding contention on the profile file).

---

## Corpus encoding format

Files under `testdata/fuzz/FuzzXxx/` use the `go test fuzz v1` text format.

### Header

```
go test fuzz v1
```

Exact bytes. The framework rejects files with a different header.

### Value lines

One line per fuzz function parameter (excluding `*testing.T`), in order. Each line has the form `<type>(<literal>)`:

```
go test fuzz v1
[]byte("\x00\x01\xff")
string("hello")
int(42)
uint64(18446744073709551615)
float64(+Inf)
bool(true)
rune(0x4e2d)
```

Type names match Go syntax. Literals use Go syntax with Go-style escapes inside string literals.

### `[]byte` literals

Escape rule: bytes outside the printable ASCII range are written as `\xNN`. The decoder accepts standard Go escapes.

### Float literals

Special values are encoded as `+Inf`, `-Inf`, `NaN`. Subnormals are encoded in decimal.

### Round-trip guarantee

The framework promises: reading and re-writing a corpus file produces byte-identical output. Hand-editing must preserve this; use the format the framework writes.

### Generated corpus format

Files under `$GOCACHE/fuzz/` use the same `go test fuzz v1` text format. Filenames are the hex SHA-256 of contents, possibly truncated.

---

## Filesystem layout

```
<module-root>/
  <package>/
    fuzz_test.go               # contains FuzzXxx
    testdata/
      fuzz/
        FuzzXxx/
          <hash-or-name>       # committed reproducers
          <another>            # additional seeds

$GOCACHE/
  fuzz/
    <module-path>/
      <package-import-path>/
        FuzzXxx/
          0/                   # generated corpus, possibly partitioned per-worker
          1/
          2/
          ...
```

The framework creates and manages all of the above except `testdata/fuzz/FuzzXxx/` seeds, which the developer commits.

### Discovery rules

- `testdata/fuzz/FuzzXxx/*` files are loaded as seeds on every `go test`.
- Subdirectories under `testdata/fuzz/FuzzXxx/` are *not* recursively scanned.
- The cache directory is scanned on `go test -fuzz` runs.

---

## Worker process contract

### Spawn

The coordinator launches workers by re-executing its own binary with internal flags including `-test.fuzzworker`. Workers do not run user code that is not part of the fuzz target.

### Protocol

Workers communicate with the coordinator over OS pipes (anonymous on Unix, named on Windows). The protocol is binary, internal, and not stable across Go versions. End users do not interact with it.

### Lifetime

Workers exit when:

- The coordinator sends a shutdown message.
- The fuzz function panics or detects a race (worker exits with non-zero).
- The worker exceeds the per-iteration timeout (default 10s, killed by the coordinator).
- An internal protocol error occurs.

The coordinator restarts workers as needed up to the `-fuzztime` budget.

### Crash isolation

A crash in a worker does not propagate to the coordinator. The input that caused the crash is preserved (the worker sent it to the coordinator before invoking the fuzz function).

---

## Race detector composition

Building with `-race` enables TSan instrumentation. The fuzzer composes with `-race` as follows:

- Coverage instrumentation and TSan instrumentation coexist.
- TSan halts the program with exit code 66 on a detected race.
- The coordinator interprets exit code 66 as a worker failure and treats the offending input as a reproducer.
- `GORACE` environment variables (e.g. `GORACE=halt_on_error=1`) apply to all workers.

### `halt_on_error`

Without `halt_on_error=1`, TSan reports races and continues. With it, the first race halts the process. For fuzzing, the default is fine: each iteration is short, and a race in the middle of an iteration still triggers worker exit at iteration end. For long-running concurrent harnesses inside the fuzz body, set `halt_on_error=1` to surface races immediately.

### Exit codes

| Code | Meaning |
|------|---------|
| 0    | Success / no failure |
| 1    | Test failure (panic, `t.Fatal`, etc.) |
| 2    | Build or invocation error |
| 66   | Race detector halt |

---

## Platform support

Native fuzzing is supported on Linux, macOS, and Windows from Go 1.18.

The race detector is supported on:

- linux/amd64, linux/arm64, linux/ppc64le
- darwin/amd64, darwin/arm64
- freebsd/amd64
- netbsd/amd64
- windows/amd64

Other GOOS/GOARCH combinations either skip fuzzing (older Go) or cannot use `-race` (still allowing `-fuzz` without race detection).

Check `go env GOOS GOARCH` and the build matrix at `go/src/internal/race/race.go` for current support.

---

## Versioning and stability

### Stable

- The `testing.F` API surface (methods listed above).
- The `go test -fuzz`, `-fuzztime`, `-fuzzminimizetime`, `-fuzzcachedir` flag names and semantics.
- The `go test fuzz v1` corpus file format.
- The `testdata/fuzz/FuzzXxx/` directory convention.

### Implementation-defined

- The coverage instrumentation algorithm and counter layout.
- The mutator's heuristics and operator weights.
- The worker protocol over pipes.
- The default `-parallel` value (currently `GOMAXPROCS`, may change).

### Not stable

- The exact iteration rate per worker.
- The order in which inputs are mutated.
- The exact minimised reproducer (different runs may produce slightly different minimisations).
- The contents of `$GOCACHE/fuzz/` (clear with `go clean -fuzzcache` when upgrading Go).

### Forward compatibility

The Go team has committed to backward compatibility of the `testing.F` API. The `v1` corpus format has not been replaced; a future `v2` format, if introduced, must read old `v1` files. Committed `testdata/fuzz/FuzzXxx/` reproducers from 2022 still work in 2026.

---

## Summary

The `testing.F` API is small and stable: `Add` to seed, `Fuzz` to register, the usual failure methods inherited from `*testing.common`. The `go test -fuzz` flags govern run duration (`-fuzztime`), minimisation (`-fuzzminimizetime`), and corpus location (`-fuzzcachedir`). Corpora are persisted in two places — committed reproducers in `testdata/fuzz/` and the generated corpus in `$GOCACHE/fuzz/` — both using the `go test fuzz v1` text format. The race detector composes cleanly with the fuzzer; the worker process model isolates crashes. Platform support is broad on `linux/darwin/windows` for fuzzing; `-race` is more restricted. The user-facing contract is stable; internal mechanics (mutator heuristics, worker protocol, corpus directory layout details) are implementation-defined and may evolve.
