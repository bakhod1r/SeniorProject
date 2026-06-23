---
layout: default
title: Benchmarks — Specification
parent: Benchmarks (testing.B)
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/05-benchmarks/specification/
---

# Benchmarks — Specification

[← Back](../)

This page is the dry reference. It lists, with godoc-style precision, the surface of the `testing.B` API, the `go test` flags that control benchmarks, and the output format consumed by `benchstat`. Use it to look things up; do not read it linearly.

## 1. Source of truth

The authoritative definitions live in two places:

- The standard library package **`testing`** — specifically the `B` type — documented at <https://pkg.go.dev/testing#B>.
- The community tool **`benchstat`**, currently at `golang.org/x/perf/cmd/benchstat` — see <https://pkg.go.dev/golang.org/x/perf/cmd/benchstat>.

If a fact on this page conflicts with godoc, godoc wins.

## 2. The Benchmark function signature

A function is recognised as a benchmark by `go test` if it satisfies all of the following:

1. It lives in a file whose name ends in `_test.go`.
2. Its name begins with the literal prefix `Benchmark`. The next character must be either upper-case ASCII or `_`. `Benchmarkfoo` is **not** recognised; `BenchmarkFoo` and `Benchmark_foo` are.
3. It takes exactly one parameter of type `*testing.B`.
4. It returns nothing.

Formal grammar:

```
BenchmarkDecl = "func" "Benchmark" Suffix "(" "b" "*testing.B" ")" Block .
Suffix        = ( upper_letter | "_" ) { letter | digit | "_" } .
```

## 3. The `B` type — fields and methods used in benchmarks

From `pkg.go.dev/testing#B`, the methods that matter for writing benchmarks:

| Method | Purpose |
|---|---|
| `N int` (field) | The iteration count the framework has chosen. Your loop runs from `0` to `b.N-1`. |
| `ResetTimer()` | Zero the elapsed time and reset memory allocation counters. Does **not** stop the timer. |
| `StartTimer()` | Start timing. Called automatically before the benchmark function runs. |
| `StopTimer()` | Stop timing. Use to exclude expensive setup or teardown inside the `b.N` loop. |
| `ReportAllocs()` | Force allocation reporting for this benchmark (equivalent to `-benchmem` for one benchmark). |
| `ReportMetric(n float64, unit string)` | Emit a custom metric column, e.g. `b.ReportMetric(float64(hits)/float64(b.N), "hits/op")`. Added in Go 1.13. |
| `SetBytes(n int64)` | Declare that each iteration processed `n` bytes; instructs the framework to compute `MB/s`. |
| `SetParallelism(p int)` | Multiplies the number of goroutines used by `RunParallel`. Default `1` means `GOMAXPROCS` goroutines. |
| `Run(name string, f func(b *B)) bool` | Run a sub-benchmark; the framework adjusts `N` independently for each. Returns true if it passed (benchmarks do not fail unless you call `b.Fail`). |
| `RunParallel(body func(pb *PB))` | Spawn `GOMAXPROCS * SetParallelism` goroutines, each pulling iterations from a shared counter via `pb.Next()`. |
| `Helper()` | Mark the caller as a test helper for failure traceback purposes. |
| `Loop() bool` | Go 1.24+ replacement for `for i := 0; i < b.N; i++`. See section 9. |

Inherited from `*common`: `Log`, `Logf`, `Error`, `Errorf`, `Fail`, `FailNow`, `Cleanup`, `Skip`, `Skipf`, `TempDir`, `Setenv`.

## 4. The `PB` type (parallel benchmark)

```go
type PB struct { /* unexported */ }
func (pb *PB) Next() bool
```

`Next` returns `true` while there are iterations left to perform. Each goroutine repeatedly calls `Next` in its inner loop; the framework hands out iterations atomically until `b.N` is reached.

## 5. The `go test -bench` flag

```
go test -bench <regexp> [other flags] [packages]
```

Key behaviours:

- The regexp is matched against the full benchmark name including sub-benchmark suffixes (`BenchmarkAdd/size=10`). A bare `.` matches everything.
- Tests are still **not** run unless you also pass `-run`. By default `-run=^$` is implied along with `-bench`, so tests are skipped. To run tests and benchmarks, pass `-run .`.
- `-bench=^$` runs no benchmarks. `-bench=.` runs all.

### 5.1 Flags that modify benchmark behaviour

| Flag | Meaning |
|---|---|
| `-bench <re>` | Select benchmarks whose name matches `re`. |
| `-benchtime <d>` | Run each benchmark for at least duration `d` (e.g. `1s`, `500ms`). Default `1s`. |
| `-benchtime <N>x` | Instead of duration, run exactly `N` iterations. Forces `b.N=N`. |
| `-benchmem` | Report `B/op` and `allocs/op` columns (same as calling `b.ReportAllocs()`). |
| `-count <n>` | Run each benchmark `n` times (default `1`). Required for `benchstat` to compute stddev. |
| `-cpu <list>` | Comma-separated list of `GOMAXPROCS` values, e.g. `-cpu=1,2,4,8`. Appends `-N` suffix to the benchmark name. |
| `-cpuprofile <file>` | Write CPU profile to `file`. |
| `-memprofile <file>` | Write memory allocation profile to `file`. |
| `-blockprofile <file>` | Write goroutine-block profile. |
| `-mutexprofile <file>` | Write mutex contention profile. |
| `-trace <file>` | Write execution trace. |
| `-timeout <d>` | Overall timeout (default `10m`). Benchmarks can exceed this if `b.N` calibrates high. |
| `-v` | Verbose; prints `--- BENCH: ` lines and intermediate output. |

## 6. The output format

Each benchmark line is whitespace-separated and has the form:

```
BenchmarkName-CPU   Iterations   ns/op   [B/op   allocs/op]   [MB/s]   [custom-metric]
```

Worked example:

```
BenchmarkParseURL-8    1500000   805 ns/op   320 B/op   3 allocs/op
```

Fields:

- `BenchmarkName-CPU` — the benchmark name with `GOMAXPROCS` suffix.
- `Iterations` — the final value of `b.N`.
- `ns/op` — wall-clock nanoseconds per iteration, mean over the run.
- `B/op` — bytes allocated per iteration (rounded). Present iff `b.ReportAllocs` or `-benchmem`.
- `allocs/op` — discrete heap allocations per iteration. Present under the same condition.
- `MB/s` — derived from `SetBytes`. Present iff `b.SetBytes` was called.
- Custom metric columns — present iff `b.ReportMetric` was called.

The format is line-oriented, machine-parseable, and stable across Go versions. `benchstat` consumes this directly.

### 6.1 The header

Before the benchmark lines:

```
goos: linux
goarch: amd64
pkg: example.com/foo
cpu: AMD Ryzen 9 5950X 16-Core Processor
```

The `cpu:` line appeared in Go 1.16.

## 7. `b.N` calibration algorithm

The framework chooses `b.N` adaptively:

1. Run the benchmark with `N = 1`.
2. If the measured time is shorter than `-benchtime` (default 1s), scale `N` up. The new `N` is roughly `target_time / current_time × N`, capped at `1e9`, rounded up to a "nice" number (typically 1, 2, 5 × 10ⁿ).
3. Repeat until the run exceeds `-benchtime`, or `N` saturates.
4. Report the final `N` and the measured `ns/op` for that `N`.

When `-benchtime=Nx` is given, calibration is skipped and `b.N=N` exactly.

## 8. `benchstat` — input and output

`benchstat` (`golang.org/x/perf/cmd/benchstat`) compares benchmark results.

### 8.1 Input

Two or more files whose contents are the raw stdout of `go test -bench ... -count=N`. By convention `N >= 10`.

```
benchstat old.txt new.txt
```

### 8.2 Output (current format, mid-2020s)

```
name      old time/op    new time/op    delta
ParseURL    805ns ± 2%     612ns ± 1%   -23.97%  (p=0.000 n=10+10)
```

Columns:

- `old time/op`, `new time/op` — mean and relative standard deviation.
- `delta` — relative change, with sign.
- `p` — Mann–Whitney U-test p-value. `p < 0.05` is typically called significant.
- `n` — sample counts on each side.

Additional column groups appear for `alloc/op`, `allocs/op`, `MB/s` if those metrics are present.

Special markers:

- `~` — no statistically significant change (`p >= 0.05`).
- `(*)` — flagged as suspect by `benchstat` (e.g. variance too high).

## 9. `b.Loop` — the modern loop (Go 1.24+)

```go
func BenchmarkFoo(b *testing.B) {
    for b.Loop() {
        work()
    }
}
```

Semantics:

- `b.Loop()` returns `true` for the first call (starting the timer if needed), keeps returning `true` for `b.N - 1` more calls, then returns `false`.
- Inside `b.Loop()` the compiler is instructed **not** to perform certain dead-code eliminations that the `for i := 0; i < b.N; i++` form is vulnerable to.
- Use whenever you target Go 1.24 or later.

## 10. Naming conventions for sub-benchmarks

`b.Run(name, ...)` appends `/name` to the parent name, with characters not in `[A-Za-z0-9_/.+-]` percent-encoded. A typical table-driven benchmark name looks like `BenchmarkSort/size=1000/algo=quick-8`.

The regexp passed to `-bench` is matched **per slash-separated component**. To run only the `size=1000` row of `BenchmarkSort`, use `-bench=BenchmarkSort/size=1000`.

## 11. Mandatory pitfalls (codified)

The following behaviours are part of the spec and must be remembered:

1. The benchmark function may be called **more than once** in a single `go test` run during calibration. Anything outside the `b.N` loop runs multiple times.
2. `b.StopTimer()` does **not** stop the GC clock; allocations during stopped time still count toward `B/op` unless you call `b.ReportAllocs` selectively. (Practically: do heavy allocation inside `b.StopTimer` blocks only for setup, not for the measured work.)
3. Output ordering between benchmarks is not stable across `-count` repetitions; do not parse pairwise.
4. With `-cpu=1,2,4`, each benchmark produces three lines, named `BenchmarkX-1`, `BenchmarkX-2`, `BenchmarkX-4`.

## 12. References

- testing package: <https://pkg.go.dev/testing>
- testing.B type: <https://pkg.go.dev/testing#B>
- benchstat: <https://pkg.go.dev/golang.org/x/perf/cmd/benchstat>
- go test command: <https://pkg.go.dev/cmd/go#hdr-Testing_flags>
- Proposal for `b.Loop`: <https://github.com/golang/go/issues/61515>

## 13. Order of operations during a benchmark run

The framework executes a benchmark in roughly the following sequence. This is documented here because subtle bugs come from misunderstanding it.

1. Compile the test binary (`go test` does this; for repeated runs, the build cache may serve a prebuilt one).
2. Print the header lines (`goos`, `goarch`, `pkg`, `cpu`).
3. For each benchmark selected by `-bench`:
   a. Calibrate `b.N`:
      - Call the benchmark function with `b.N = 1`. Measure.
      - If measured time < `-benchtime` and `b.N < 1e9`, increase `b.N` and call again.
      - Repeat until measured time exceeds `-benchtime` or `b.N` saturates.
   b. The *final* call (the one whose `b.N` produced enough wall time) is the one reported.
   c. Print the result line.
   d. If `-count > 1`, repeat (a)-(c) `count` times.
4. Print the trailing `PASS` / `FAIL` and timing summary.

Critical implications:

- The benchmark function body is called **multiple times** during calibration. Anything outside the `b.N` loop runs multiple times too.
- Setup that you want to run once should be done in a package-level `init`, or in `TestMain`, or in a `sync.Once`. Putting it at the top of the benchmark function means it re-runs.
- The reported `ns/op` is from the *final* calibration call, not an average across calibration steps.

## 14. The `b.Elapsed()` method

`b.Elapsed() time.Duration` returns the time since the benchmark started (or since the last `ResetTimer`). Useful for custom metric reporting:

```go
func BenchmarkFoo(b *testing.B) {
    for i := 0; i < b.N; i++ {
        work()
    }
    b.ReportMetric(float64(b.Elapsed().Nanoseconds())/float64(b.N), "myns/op")
}
```

(That example is trivially equivalent to `ns/op`, but `Elapsed` is useful in more sophisticated patterns where you measure only part of the loop.)

## 15. Setting `GOMAXPROCS` from a benchmark

You cannot reliably set `GOMAXPROCS` from inside a benchmark and have the framework respect the new value, because the framework sets `GOMAXPROCS` once at startup. To run a benchmark with a specific `GOMAXPROCS`:

- Use the `-cpu` flag: `go test -bench=. -cpu=2`.
- Or set the environment variable: `GOMAXPROCS=2 go test -bench=.`.

Calling `runtime.GOMAXPROCS(2)` from inside a benchmark changes the runtime's behaviour but does not change the suffix in the output name (which was captured at start).

## 16. The `*testing.B` embeds `*testing.common`

Both `*testing.T` and `*testing.B` embed an unexported `*common`. This is why they share methods: `Log`, `Logf`, `Error`, `Errorf`, `Fail`, `FailNow`, `Cleanup`, `Skip`, `Skipf`, `TempDir`, `Setenv`, `Helper`.

The shared methods behave the same in benchmarks as in tests, with one caveat: `Error`/`Errorf` from a benchmark cause the benchmark to be marked as failed but do not abort the loop. `Fatal`/`Fatalf` abort the current iteration. To exit the entire benchmark immediately, use `FailNow`.

## 17. Output stability guarantees

The Go team commits to keeping the benchmark output format **machine-readable and stable**. New columns may be added at the end of a line; existing columns will not change order or format without a compatibility window. This is what allows `benchstat` to consume output across many years of Go releases without breaking.

The header lines (`goos`, `goarch`, `pkg`, `cpu`) are similarly stable. New `key: value` lines may be added (the `cpu:` line was added in Go 1.16), but the parser format is fixed.

## 18. Discoverability rules — the exact regex

For a function `func Xxx(*testing.B)`:

- It is a benchmark iff `Xxx` matches `^Benchmark[A-Z_]`.
- Lowercase second character (`BenchmarkXxx` vs `Benchmarkxxx`) — only the first form is recognised. The second is silently ignored.
- Numeric second character (`Benchmark1Xxx`) — **not** recognised.
- Underscore second character (`Benchmark_Xxx`) — recognised.

These rules are identical for `Test`, `Benchmark`, `Fuzz`, and `Example`.

## 19. The relationship between `-bench` and `-benchtime=Nx`

If you pass `-bench=. -benchtime=100x`, each benchmark runs with `b.N=100` exactly. There is no calibration. The output `ns/op` is the total time divided by 100.

If you want exactly one trip through the loop (e.g. for an integration-style benchmark): `-benchtime=1x`.

The `Nx` form is incompatible with `-count > 1` only in that each of the `count` runs uses the same fixed `N`; no calibration variability.

## 20. The cost of `b.ReportAllocs`

Calling `b.ReportAllocs()` is essentially free. It sets a boolean on the `*testing.B`. The actual allocation counting happens regardless (the framework tracks `MemStats` deltas), but the columns are suppressed unless the flag is set.

You can call `b.ReportAllocs()` once at the top of the function or inside a sub-benchmark — the effect is local to whichever benchmark's `*testing.B` you called it on.

## 21. Deterministic vs nondeterministic benchmark behaviour

Some aspects of `go test -bench` are deterministic; some are not.

**Deterministic:**
- The benchmark function name matching.
- The `b.N` chosen for a given timing (modulo wall-clock variability in calibration).
- The output format.

**Nondeterministic:**
- The exact wall-clock `ns/op` (varies by machine, load, frequency).
- The order in which benchmarks run when `-count > 1` (interleaved or grouped depending on Go version and shuffling).
- Iteration counts under noisy calibration.

For reproducible numbers, all the non-determinism is in `ns/op`; control it via the senior-page techniques.

## 22. Build tags and conditional benchmarks

Benchmark files participate in the normal `_test.go` build-tag system. Use `//go:build` to gate benchmarks:

```go
//go:build !race
// +build !race

package mypkg

import "testing"

func BenchmarkHotPath(b *testing.B) { ... }
```

This benchmark only runs when the race detector is *not* enabled. Useful because the race detector adds significant overhead that pollutes timing.

Common tag patterns:

- `//go:build !race` — exclude under race detector.
- `//go:build linux` — Linux-only (for `taskset`-dependent benchmarks).
- `//go:build heavy` — opt-in to long-running benchmarks via `go test -tags heavy`.

## 23. The `testing.Verbose()` helper

`testing.Verbose()` returns true if `-v` was passed. Useful for log-rich benchmarks that you do not want printing megabytes of output by default:

```go
if testing.Verbose() {
    b.Logf("detailed: %v", state)
}
```

By default the benchmark is quiet; with `-v` you get the diagnostics.

## 24. Subtests/sub-benchmarks and parallelism

`b.Run` runs sub-benchmarks **serially by default**. Unlike `t.Parallel`, there is no `b.Parallel`. The reason: parallel sub-benchmarks would contend for the same machine resources and produce noisy numbers. Benchmarks are inherently serial.

Within a benchmark, `b.RunParallel` provides goroutine-level parallelism *inside* a single benchmark. But two `b.Run("a", ...)` and `b.Run("b", ...)` always execute one after the other.
