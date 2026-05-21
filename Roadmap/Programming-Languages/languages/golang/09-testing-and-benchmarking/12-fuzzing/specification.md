---
layout: default
title: Fuzzing — Specification
parent: Native Fuzzing
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/12-fuzzing/specification/
---

# Fuzzing — Specification

[← Back](../)

This page is a reference for the contracts, defaults, and on-disk formats of Go's native fuzz testing. It is descriptive — for tutorial-style explanations see the junior, middle, and senior pages.

## 1. The `testing.F` type

Defined in `src/testing/fuzz.go` (added in Go 1.18). It is the fuzz-mode analog of `testing.T` and `testing.B`. A fuzz function has the signature:

```go
func FuzzXxx(f *testing.F)
```

where `Xxx` begins with an uppercase letter. The function name must start with the prefix `Fuzz` exactly the same way unit tests begin with `Test` and benchmarks with `Benchmark`.

### Members of `*testing.F` used in user code

| Method | Purpose |
|--------|---------|
| `Add(args ...any)` | Adds a seed corpus entry. The number and types of `args` must match the parameters of the function passed to `Fuzz`. |
| `Fuzz(ff any)` | Registers the fuzz function. The argument must be of type `func(*testing.T, ...allowedTypes)`. |
| `Skip(args ...any)` | Marks the fuzz run as skipped from setup (rare). |
| `Fatal(args ...any)` | Aborts setup with a failure. |
| `Log`, `Logf`, `Errorf`, `Helper` | Standard reporting methods, inherited from the common interface. |
| `TempDir()` | Returns a per-test temp directory cleaned up after the run. |
| `Cleanup(func())` | Registers a cleanup function run after the fuzz function exits. |

### Allowed argument types in `Fuzz` and `Add`

Per the Go 1.18 specification ([golang/go#44551](https://github.com/golang/go/issues/44551)), the allowed types are:

- `string`, `[]byte`
- `int`, `int8`, `int16`, `int32`, `int64`
- `uint`, `uint8`, `uint16`, `uint32`, `uint64`
- `bool`
- `float32`, `float64`
- `byte` (alias for `uint8`)
- `rune` (alias for `int32`)

Composite types — structs, maps, slices of non-byte types, channels, interfaces — are not allowed. The compiler enforces this when `f.Fuzz` is called: an invalid signature triggers a runtime panic in the test setup, not a compile-time error, because `Fuzz` takes `any`.

## 2. The `-fuzz` flag

### Syntax

```
-fuzz=<regexp>
```

The argument is a regular expression matched against fuzz function names within the packages being tested. If exactly one fuzz function matches, that function enters fuzz mode. If zero or more than one match, `go test` exits with an error — the engine refuses to fuzz multiple targets simultaneously.

### Mode selection

| Without `-fuzz` | With `-fuzz=...` |
|-----------------|------------------|
| Each `FuzzXxx` runs once on the seed corpus and the saved corpus from `testdata/fuzz/FuzzXxx/`, then exits. | The matching `FuzzXxx` enters mutation mode: seed and saved corpus replay first, then continuous mutation until budget is exhausted or a failure is recorded. |

This dual behavior means a fuzz function is always also a unit-test-equivalent that replays known inputs — so `go test ./...` exercises every saved regression for free.

### Companion flags

| Flag | Default | Meaning |
|------|---------|---------|
| `-fuzztime <duration\|count>` | unlimited | Total fuzz wall time, e.g. `30s`, `10m`, `1h`. Accepts `Nx` to mean N executions, e.g. `100x`. |
| `-fuzzminimizetime <duration\|count>` | `1m` | Per-failure shrinking budget. |
| `-fuzzcachedir <path>` | `$GOCACHE/fuzz` | Override the live working-corpus directory. |
| `-parallel <n>` | `GOMAXPROCS` | Number of concurrent fuzz workers. |
| `-keepfuzzing` | false | Continue fuzzing after the first failure. |
| `-timeout <duration>` | `10m` | Per-input timeout; an input exceeding this is treated as a hang. |

## 3. Corpus storage

### Repository-tracked: `testdata/fuzz/FuzzXxx/`

Each file in this directory is a single saved failing input. The filename is a content-addressed hash and contains no semantically significant information; the file *contents* are the encoded typed arguments.

The on-disk format is text:

```
go test fuzz v1
string("hello")
[]byte("\x00\x01\x02")
int(42)
```

The first line is a versioning sentinel. Subsequent lines are one per fuzz argument, in the same order as the `Fuzz` function's parameters. Strings are double-quoted with Go escape syntax. `[]byte` uses the same syntax. Integers and floats use literal Go notation.

Saved entries are intended to be committed to source control. They serve three purposes:

1. **Regression**: replayed on every `go test`.
2. **Documentation**: a human can read the file to see what triggered a past bug.
3. **Reproduction**: `go test -run=FuzzXxx/<hash>` deterministically replays exactly this entry.

### GOCACHE-resident: `$GOCACHE/fuzz/<module>/<pkg>/FuzzXxx/`

This is the larger working corpus the engine discovers during fuzzing. It is *not* tracked in the repo. It accumulates inputs that hit new coverage edges and is consulted on the next fuzz run to avoid re-discovery. On CI runners without a cache mount, this directory is empty at the start of every run.

### Interaction with `GOCACHE`

- Setting `GOCACHE=off` disables the live working corpus, forcing the engine to start from scratch each run.
- Setting `GOCACHE=<path>` relocates both build cache and fuzz working corpus.
- `go clean -cache` removes the fuzz working corpus along with the build cache.
- `go clean -fuzzcache` removes only the fuzz working corpus.

### Seed corpus from `f.Add`

Seed inputs are stored in source code, not on disk. They are replayed at the start of every fuzz mode and every unit-test mode. They are conceptually part of the test source.

## 4. Failure handling

When the fuzz function emits a failure via `t.Fail`, `t.Fatal`, `t.Error`, or via a panic, the engine:

1. Captures the input that triggered the failure.
2. Attempts to minimize it for up to `-fuzzminimizetime`.
3. Writes the minimized input to `testdata/fuzz/FuzzXxx/<hash>`, where `<hash>` is the SHA-256 of the encoded input bytes.
4. Prints a message of the form:

   ```
   --- FAIL: FuzzXxx (0.42s)
       --- FAIL: FuzzXxx/<hash> (0.00s)
           parse_test.go:42: index out of range
       Failing input written to testdata/fuzz/FuzzXxx/<hash>
       To re-run:
       go test -run=FuzzXxx/<hash>
   ```

5. Exits with non-zero status, unless `-keepfuzzing` is set.

## 5. Coverage instrumentation

The fuzz engine instruments the compiled binary with edge coverage. Instrumentation is added by the Go compiler under the same machinery as `go test -cover`, but the coverage map is consulted at runtime by the mutator to prioritize inputs that hit new edges. The coverage map is not written to disk during a fuzz run; it is internal to the engine.

This is *not* the same instrumentation as `go test -cover -coverprofile=...`. You cannot mix `-fuzz` and `-coverprofile` in the same invocation; the engine will reject the combination.

## 6. Mutation strategy (informative)

The Go runtime does not publicly specify its mutation algorithm, but the implementation in `src/internal/fuzz/` performs the following classes of mutations:

- **Bit flips** of one to several bits in `[]byte` and `string` inputs.
- **Arithmetic offsets** on integer and float arguments.
- **Splice operations** that combine two corpus entries.
- **Byte insertions and deletions** at random offsets.
- **Replacement** of byte ranges with constants drawn from the corpus.

This is a behavioral note, not a contract — future Go versions may change the mutator without notice.

## 7. Worker model

The engine spawns `-parallel` worker processes (not goroutines — separate OS processes). Each worker is sent inputs over a pipe by the coordinator, runs the fuzz body, and reports coverage and outcome back. Process isolation means a panic in one worker does not corrupt the coordinator's state. If a worker hangs past `-timeout`, the coordinator kills it and treats the last input as a failure.

This model has implications:

- Globals in the test binary are per-worker; they are not shared across workers.
- The coordinator-to-worker pipe is the bottleneck on tiny fuzz bodies; very fast bodies (sub-microsecond) may not see linear scaling.
- Worker crashes are detected and reported as "fuzzing process hung or terminated unexpectedly."

## 8. Compatibility and version notes

| Go version | Notable change |
|------------|----------------|
| 1.18 | Native fuzzing introduced. |
| 1.19 | Minor bug fixes in corpus minimization. |
| 1.20 | Improved seed corpus replay performance. |
| 1.21 | Better diagnostic messages on fuzz target signature errors. |
| 1.22 | Coverage map memory reduced for very-large packages. |
| 1.23 | Worker process startup overhead reduced. |

The on-disk corpus format (`go test fuzz v1`) has been stable since 1.18; future versions may bump the version sentinel but will continue to accept v1 files.

## 9. Exit codes

| Code | Meaning |
|------|---------|
| `0` | No failure within the budget; saved corpus replays cleanly. |
| `1` | Failure: a saved corpus entry failed, or a new failure was discovered. |
| `2` | Misuse: invalid flag combination, invalid fuzz signature, ambiguous `-fuzz` regexp. |

CI scripts should distinguish `1` from `2`; `2` is always a user error and not a fuzz finding.

## 10. Interaction with other test flags

- `-run` and `-fuzz` may both be supplied; `-run` filters the *initial replay* phase (seed and saved corpus) before fuzz mode begins, but does not affect the mutation phase.
- `-count=N` is allowed only outside fuzz mode (without `-fuzz`); the seed/saved corpus replay runs N times.
- `-race` works with `-fuzz` and is recommended for the nightly job.
- `-coverprofile`, `-cpuprofile`, `-memprofile`, `-blockprofile` may not be combined with `-fuzz` (the engine rejects them) except `-cpuprofile`, which is accepted but applies only to the coordinator.
- `-short` has no effect on fuzz mode; a fuzz target may itself check `testing.Short()` and skip with `t.Skip` to opt out.

## 11. Authoring contract for `FuzzXxx`

- **Pure-ish**: the fuzz body should depend only on its arguments. Reading process-global state (env vars, current time) leads to non-reproducible failures.
- **Deterministic**: identical arguments must produce identical outcomes. Mutating shared globals between inputs breaks this and breaks single-input reproduction.
- **Fast**: the body should complete in well under a millisecond on typical inputs. Slow bodies starve the search.
- **Tolerant**: gracefully handle the wide range of nonsense the mutator will throw at you. Use `t.Skip()` for inputs that fail an obvious precondition.

## 12. Quick reference card

```
// Declare:
func FuzzParse(f *testing.F) {
    f.Add([]byte("seed1"))
    f.Add([]byte("seed2"))
    f.Fuzz(func(t *testing.T, in []byte) {
        // body
    })
}

// Run for ten minutes:
go test -run=^$ -fuzz=FuzzParse -fuzztime=10m

// Replay one saved failure:
go test -run=FuzzParse/abc123

// Cap workers:
go test -fuzz=FuzzParse -parallel=4

// Clear working corpus only:
go clean -fuzzcache
```

[← Back](../)
