---
layout: default
title: Fuzzing — Specification
parent: Native Fuzzing
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/12-fuzzing/05-specification/
---

# Fuzzing — Specification

[← Back](../)

This page is the normative cheat sheet. Wording is taken from the Go 1.18
release notes, the `testing` package godoc, the `cmd/go` test flag
documentation, and proposal golang/go#44551. Use it as a reference when
writing fuzz tests; the prose pages explain the why.

## Function signature

A fuzz test is any exported function in a `_test.go` file with the
signature:

```go
func FuzzXxx(f *testing.F)
```

`Xxx` must begin with an upper-case letter or digit. The function name
minus the `Fuzz` prefix is what you pass to `-fuzz`. The `f` parameter is
non-nil for the life of the function.

A package can declare any number of `FuzzXxx` functions. At most one of
them runs in fuzz mode per `go test -fuzz=...` invocation. All of them
run in regression mode under plain `go test`.

## Seed corpus registration

```go
func (f *F) Add(args ...any)
```

Rules:

- The number of `args` must match the parameter count of the fuzz target
  excluding the leading `*testing.T`.
- The types of `args` must match the target parameter types exactly.
  Mixing `int` and `int64` is a runtime error: `mismatched types`.
- Each `Add` call is one seed entry.
- `f.Add` may be called before or after `f.Fuzz` — the order does not
  matter; both contribute to the seed corpus.
- Seeds from `testdata/fuzz/FuzzXxx/` are loaded automatically; you do
  not need an `f.Add` call for them.

## Fuzz target

```go
func (f *F) Fuzz(ff any)
```

Rules:

- `ff` must be a function whose first parameter is `*testing.T`.
- The remaining parameters define what the engine mutates. Allowed
  types are:
  - `[]byte`
  - `string`
  - `bool`
  - `byte` (alias for `uint8`)
  - `rune` (alias for `int32`)
  - `int`, `int8`, `int16`, `int32`, `int64`
  - `uint`, `uint8`, `uint16`, `uint32`, `uint64`
  - `float32`, `float64`
- Any other type, including composite types, causes a runtime panic
  from `(*F).Fuzz`.
- Only one `f.Fuzz` call is allowed per `FuzzXxx`. A second call panics
  with `(*F).Fuzz called more than once`.
- The fuzz target must not return a value.

## Methods on *testing.F

| Method | Purpose |
|---|---|
| `Add(args ...any)` | register a seed input |
| `Fuzz(ff any)` | declare the fuzz target |
| `Skip(args ...any)` | skip the entire fuzz function |
| `Skipf(format string, args ...any)` | same with formatting |
| `Fail()` | mark the fuzz function as failed |
| `Fatal(args ...any)` | mark failed and stop the function |
| `Helper()` | mark caller as helper for line attribution |
| `Log(args ...any)` | log if test fails or `-v` is set |

`*testing.F` embeds `testing.TB`, so any `TB` method is available.

## Corpus directories

| Location | Purpose | Committed to VCS? |
|---|---|---|
| `testdata/fuzz/FuzzXxx/` | seed corpus and minimized crashes | yes |
| `$GOCACHE/fuzz/<modpath>/FuzzXxx/` | generated coverage corpus | no |

`$GOCACHE` defaults to:

- `$XDG_CACHE_HOME/go-build` on Linux (typically `~/.cache/go-build`).
- `~/Library/Caches/go-build` on macOS.
- `%LocalAppData%\go-build` on Windows.

You can override it with the `GOCACHE` environment variable. Running
`go env GOCACHE` prints the resolved value.

## Corpus file format

Plain text. The first line is the version header `go test fuzz v1`.
Subsequent lines are Go-syntax literals — one per fuzz target parameter.

Example for a target `(t, []byte, int)`:

```
go test fuzz v1
[]byte("\x00\x01\x02")
int(42)
```

Example for a target `(t, string, bool, float64)`:

```
go test fuzz v1
string("hello\nworld")
bool(true)
float64(3.14)
```

Files are UTF-8. Empty input is allowed: `[]byte("")` or `string("")`.

The hash in the file name (when auto-saved) is a SHA-256 prefix of the
file content. Hand-named files are equally valid.

## Command flags

| Flag | Meaning |
|---|---|
| `-fuzz=Regex` | enable fuzzing on tests matching Regex |
| `-fuzztime=Duration` | total fuzzing time, e.g. `30s`, `10m`, `1h` |
| `-fuzzminimizetime=Duration` | time per failure for minimization |
| `-fuzzcachedir=Dir` | override location of cached fuzz corpus |
| `-parallel=N` | concurrent fuzz workers |
| `-run=FuzzXxx/<hash>` | replay a saved corpus file |
| `-v` | verbose output, prints t.Log messages |

The `-fuzz` regex must match exactly one fuzz target across the package
set. If multiple match, the runtime prints the names and exits.

`-fuzztime` accepts the `time.ParseDuration` syntax: `1ns`, `100ms`,
`1s`, `5m`, `2h`. It also accepts a count form: `1000x` runs exactly
1000 mutations, useful for deterministic CI runs.

`-fuzzminimizetime` defaults to 60 seconds. Setting it to `0s` disables
minimization — useful in CI to fail fast.

## Exit codes

- `0` — no failure within `-fuzztime`.
- `1` — fuzz target panicked or `t.Fail`-ed; minimized input saved.
- `2` — usage error (multiple `Fuzz` matches, invalid type, etc.).

## Subtest naming

When run under `-fuzz=...`, the fuzz target generates subtests
for any failures it discovers. Subtest names follow this format:

```
FuzzXxx/<sha256-prefix>
```

When run without `-fuzz`, every seed (both `f.Add` calls and
`testdata/fuzz/FuzzXxx/` files) becomes a subtest. Names:

| Source | Subtest name |
|---|---|
| `f.Add` (index N) | `FuzzXxx/seed#N` |
| `testdata/fuzz/FuzzXxx/somefile` | `FuzzXxx/somefile` |

The `-run` flag accepts the subtest path:

```bash
go test -run='FuzzXxx/somefile'
go test -run='FuzzXxx/seed#0'
```

## Behaviour without `-fuzz`

`go test` (no `-fuzz`) runs each entry in `testdata/fuzz/FuzzXxx/` and
every `f.Add` seed as a subtest named after the corpus file or `seed#N`.
This turns the corpus into a regression suite. The runtime does not
mutate anything and does not need coverage instrumentation.

Subtest names match the on-disk file names. You can re-run a single
seed with:

```bash
go test -run=FuzzXxx/seed#0
go test -run=FuzzXxx/8a1c91d6c1
```

## Concurrency rules inside the fuzz target

The fuzz target is called concurrently across workers. Each call gets a
fresh `*testing.T`. Workers do not share state. If your code under test
holds shared state (caches, singletons), you must either:

- Synchronize access in the target (slows down exec/s).
- Construct fresh state inside the target.
- Restructure the code to remove the shared state.

The Go race detector (`go test -race -fuzz=...`) runs the target under
the race detector, surfacing data races as they occur.

## Type matrix for `f.Add` and `f.Fuzz`

A reference table for what types are valid:

| Type | f.Add | f.Fuzz target param |
|---|---|---|
| `bool` | yes | yes |
| `byte` (`uint8`) | yes | yes |
| `rune` (`int32`) | yes | yes |
| `int` | yes | yes |
| `int8`, `int16`, `int32`, `int64` | yes | yes |
| `uint` | yes | yes |
| `uint8`, `uint16`, `uint32`, `uint64` | yes | yes |
| `uintptr` | no | no |
| `float32`, `float64` | yes | yes |
| `complex64`, `complex128` | no | no |
| `string` | yes | yes |
| `[]byte` | yes | yes |
| `[]T` for other T | no | no |
| `map[K]V` | no | no |
| struct types | no | no |
| interface types | no | no |
| channel types | no | no |
| function types | no | no |

Anything in the "no" rows produces a runtime error when registered.

## Coverage instrumentation

`go test -fuzz=...` automatically compiles the test binary with coverage
instrumentation equivalent to `-cover -covermode=atomic`. You do not
need to pass these flags. The coverage data is consumed by the engine
internally; it is not written to a file unless you also pass
`-coverprofile=...`.

## Naming rules

Fuzz function names must match the regex `^Fuzz[A-Z]` for the
runtime to recognize them. The first character after `Fuzz` must
be an upper-case letter or a digit (in practice, an upper-case
letter is the convention).

Valid names:

```
FuzzParse
FuzzParseRequest
FuzzRoundTrip
Fuzz1
```

Invalid names (will not run as fuzz tests):

```
fuzzParse        // lowercase first letter
TestParse        // wrong prefix
FuzzParse_test   // not a function name issue, but illegal Go identifier
```

A common typo: `func TestFuzzParse(...)`. This compiles and runs
as a unit test, never as a fuzz test. Watch for this in code
review.

## Test file location

The fuzz function must live in a `_test.go` file in the same
package as the code under test (or in a `_test` external test
package). Build tags and OS-specific suffixes work normally.

The corpus directory `testdata/fuzz/FuzzXxx/` must be in the same
package directory as the test file. The runtime resolves the path
relative to the test file's directory at runtime.

## Interaction with `t.Parallel`

The fuzz target's `*testing.T` supports `t.Parallel()`, but
calling it changes nothing: the workers are already parallel and
the runtime does not nest parallelism inside an individual fuzz
target invocation. Avoid calling `t.Parallel()` inside the fuzz
target body.

## Environment variables that affect fuzzing

A few environment variables influence fuzz behaviour:

| Variable | Effect |
|---|---|
| `GOCACHE` | overrides the cache directory for generated corpus |
| `GOMAXPROCS` | sets the default `-parallel` value |
| `GODEBUG=fuzzdebug=1` | enables verbose engine logging |
| `GOFLAGS` | injects flags into every `go test` invocation |

`GODEBUG=fuzzdebug=1` is occasionally useful for diagnosing why
the engine is not finding new coverage. Output is verbose; do
not enable in production CI.

## Constants and limits

The runtime imposes a few internal limits that are not
documented as part of the public API but matter in practice:

- Maximum input size: bound by available memory; no hard limit.
- Maximum corpus size: bound by available disk; no hard limit.
- Maximum number of workers: bound by `GOMAXPROCS`; configurable
  with `-parallel`.
- Minimization budget per failure: 60 seconds by default;
  configurable with `-fuzzminimizetime`.
- Per-worker memory limit: 2 GB before the worker is killed and
  restarted.
- Worker restart timeout: 5 seconds.

These limits are encoded in `src/internal/fuzz/fuzz.go` and may
change between Go releases. Do not rely on specific values.

## Compatibility guarantees

The `go test fuzz v1` file format is part of the Go 1
compatibility promise. The runtime can read v1 files from any
Go 1.18+ release. Future format versions will be backward-
compatible at the file-format level.

The `testing.F` API is also part of the Go 1 compatibility
promise. Methods may be added but not removed; signatures will
not change.

The cached generated corpus format (under `$GOCACHE/fuzz/`) is
explicitly *not* part of the compatibility promise. The format
may change between Go releases, and stale caches may be silently
discarded.

## Reference list

- Go 1.18 release notes — section "Fuzzing", March 2022.
- testing package godoc — type `F`, methods `Add`, `Fuzz`, `Skip`,
  `Fail`, `Helper`, `Log`.
- cmd/go documentation — `go help testflag`.
- Proposal: cmd/go: add fuzz testing, golang/go#44551.
- "Tutorial: Getting started with fuzzing" — go.dev/doc/tutorial/fuzz.
- Design document: "Native Go Fuzzing", available in
  golang.org/design/draft-fuzzing.
