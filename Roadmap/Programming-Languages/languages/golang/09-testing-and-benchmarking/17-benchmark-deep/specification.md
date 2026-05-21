---
layout: default
title: Benchmark Deep — Specification
parent: Benchmarking Deep Dive
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/17-benchmark-deep/specification/
---

# Benchmark Deep — Specification

[← Back](../)

This page distils the contracts and invariants that distinguish a *measurement* from a *guess*. Where the Go language specification or a published standard nails something down, this page quotes it; everything else is a community-accepted convention with a citation.

## 1. The `testing.B` contract

The `testing` package documents `B` as a struct that *the runner mutates* before invoking the benchmark function. The benchmark MUST:

- Iterate from `0` to `b.N`, inclusive of side effects but exclusive of `b.N` itself.
- Treat `b.N` as opaque. The framework chooses it; the function does not read it for purposes other than the loop bound.
- Not call `t.Fail`, `t.Skip`, or any `B.Fatal*` from a goroutine other than the one that received `b`.
- Tolerate being invoked many times (warmup + measurement). Side effects on package globals are forbidden unless re-initialised each call.

Citation: `pkg.go.dev/testing#B` and the `cmd/go` testing source.

## 2. Reported metrics

`go test -bench` emits exactly one line per finished benchmark, of the form:

```
BenchmarkX-8     12345     97.6 ns/op   0 B/op   0 allocs/op
```

The columns are positional. `benchstat` matches on the leading column (name + GOMAXPROCS suffix `-N`). Adding `b.ReportMetric(v, "unit")` appends extra columns; the unit string must not contain `/op` if you want benchstat to treat it as a per-op rate, and *must* contain `/op` if you do. The `/op` token is the parser's signal to divide by `b.N`.

## 3. Statistical contract (benchstat)

`benchstat` (`golang.org/x/perf/cmd/benchstat`) makes these guarantees:

- Inputs are line-oriented; each file is one *sample group*.
- Within a group, the same benchmark name may appear multiple times — each occurrence is one sample.
- The comparison test is Mann–Whitney U by default, with two-sided p-value.
- A delta is *reported as significant* only if `p < α` AND `|effect| ≥ threshold`. Defaults: `α = 0.05`, `threshold = 0%` (any positive effect).
- `~` in the delta column means "no significant change at the chosen α/threshold".
- The displayed central tendency is the median, not the mean.

## 4. Build flag contract

The flags that affect benchmark numbers (and that you MUST record alongside any reported figure) are:

| Flag | Effect on numbers |
|------|-------------------|
| `-gcflags="all=-N -l"` | Disables optimisation and inlining; numbers are debugger-friendly, not production-relevant. |
| `-gcflags="-m=2"` | Print-only; no numerical effect. |
| `-ldflags="-s -w"` | Strips symbols; affects binary size and cold-start, not steady state. |
| `-pgo=auto` or `-pgo=path.pprof` | Enables PGO; can change inlining choices. |
| `-tags` | Compile-time feature flags; numbers depend on which tags are set. |
| `-cpu=1,2,4` | Re-runs benchmarks at different `GOMAXPROCS`. |
| `-benchtime` | Target wall time per sample. |
| `-count` | Number of samples per benchmark. |

Reproducibility rule: a benchmark report MUST cite the Go version, hardware (CPU model, freq lock state, SMT state), kernel/OS, and the full set of build flags. Without these, the numbers are anecdotes.

## 5. Stability contract (machine)

For the numbers to be reproducible the machine MUST be:

- Frequency-locked (no turbo, no scaling governor): `cpupower frequency-set --governor performance`.
- SMT disabled or the sibling vacated.
- The benchmark process pinned with `taskset` / `cpuset`.
- Not running competing CPU- or memory-bound work.
- ASLR consistency considered (re-running the binary changes layout; for ultra-precise work, disable ASLR).

These are the conditions under which the *machine* is a deterministic substrate. Deviation must be reported.

## 6. `runtime/metrics` contract

The `runtime/metrics` package exposes a stable set of names with versioned semantics. The relevant ones for benchmarking are:

| Name | Kind |
|------|------|
| `/sched/latencies:seconds` | histogram |
| `/gc/pauses:seconds` | histogram |
| `/gc/cycles/total:gc-cycles` | counter |
| `/gc/heap/allocs:bytes` | counter |
| `/gc/cpu-time:seconds` | counter |
| `/sync/mutex/wait/total:seconds` | counter |

A reading is `runtime/metrics.Read([]Sample)`. The package guarantees:

- Names are stable across patch releases.
- Histograms expose cumulative buckets; subtracting before/after gives the per-interval distribution.
- Sampling is wait-free; calling Read does not stop the world.

Citation: `pkg.go.dev/runtime/metrics`.

## 7. PGO contract

A PGO build with `-pgo=default.pgo` uses the profile to bias:

- Inlining decisions (hot calls promoted past the cost budget).
- Branch layout (likely-taken branches placed for fall-through).
- Devirtualisation of interface calls (Go 1.21+).

The contract is that PGO *never makes correct code incorrect*. It does NOT guarantee monotonic perf improvement; a profile collected under load A may slow down workload B.

## 8. Output reproducibility

A benchmark run is reproducible if and only if:

- Same Go version.
- Same source tree (`git rev-parse HEAD`).
- Same build flags.
- Same machine state (per section 5).
- Same `GOGC` and `GOMEMLIMIT` env.
- Same `default.pgo` file (or none).

These eight invariants are the minimum *bench fixture*. Any benchmark posted to a public issue tracker should declare all eight.

## 9. The `b.Run` sub-benchmark contract

`b.Run(name, f)` creates a sub-benchmark with the given name. The full name is `Parent/Child`. Sub-benchmarks share the parent's pool of `b.N` budget — actually they do *not*, each `b.Run` runs an independent `b.N` selection. The parent function executes once; each child function executes multiple times.

Rules:

- Names must not contain `/`, which is reserved as the parent/child separator.
- Names with spaces are allowed; benchstat preserves them.
- Sub-benchmarks can nest arbitrarily deep.
- `b.SetParallelism`, `b.SetBytes`, `b.ResetTimer` inside a sub-benchmark affect only that sub-benchmark.

## 10. The `b.ReportMetric` contract

`b.ReportMetric(value float64, unit string)`. The framework guarantees:

- `unit` containing `/op` triggers division by `b.N` for display.
- `unit` containing `/sec` triggers division by elapsed seconds.
- Other units are reported as-is.
- A metric with `unit == "ns/op"` *replaces* the default ns/op column.
- A metric with `unit == "B/op"` or `"allocs/op"` *replaces* those columns.

Useful pattern: report your own ns/op so the framework cannot accidentally divide by a wrong `b.N`:

```go
b.ReportMetric(float64(elapsed.Nanoseconds())/float64(b.N), "ns/op")
```

## 11. The `b.SetBytes` contract

`b.SetBytes(n)` declares that each iteration processes `n` bytes. The framework reports MB/s by dividing `n * b.N` by elapsed seconds.

Use cases:

- Codec benchmarks (encode/decode of a fixed-size buffer).
- Hashing benchmarks (per-byte rate is the natural metric).
- File-format parsers (lines per second is also useful but not built-in).

If your benchmark processes variable-size inputs per iteration, do not call `SetBytes`; report your own `B/sec` via `ReportMetric` to avoid confusion.

## 12. PGO contract — extended

A PGO build with `-pgo=default.pgo` uses the profile to bias:

- Inlining decisions (hot calls promoted past the cost budget).
- Branch layout (likely-taken branches placed for fall-through).
- Devirtualisation of interface calls (Go 1.21+).
- Function ordering in the text section (for I-cache locality).

PGO does NOT:

- Change algorithmic complexity.
- Reorder fields.
- Vectorise code.
- Affect escape analysis.

The contract is that PGO *never makes correct code incorrect*. It does NOT guarantee monotonic perf improvement; a profile collected under load A may slow down workload B.

## 13. The `go test -bench` exit code contract

`go test -bench=.` exits with:

- 0 if all benchmarks completed without `b.Fatal`.
- 1 if any benchmark called `b.Fatal` or `b.Error`.
- 2 on usage errors (bad flag, missing package).

This is the same as `go test` for unit tests. CI gates that rely on exit codes can treat bench failures as test failures.

Note: a benchmark that runs slowly does NOT fail the build. Slowness produces a number; the gate is on the *delta* via benchstat, not on the absolute number unless you `b.Fatal` based on a threshold.

## 14. The community conventions

Beyond the framework contract there is a set of conventions Go authors expect:

- One bench file per package, named `pkg_bench_test.go`.
- Benchmarks named after the public function they exercise: `BenchmarkParse`, not `BenchmarkMyParser`.
- A package-level `var sink T` for the type returned by the function under test.
- `b.ReportAllocs()` set explicitly or `-benchmem` always in the run command.
- Sub-benchmarks parametrise on size, not on implementation choice (implementations get their own top-level bench).

A bench file that violates these is not *wrong* but will read as foreign to Go-trained reviewers.

## 15. The benchstat output schema

A benchstat report is a stable, line-oriented format:

```
name           old time/op    new time/op    delta
BenchmarkA-8   100ns ± 2%     85ns ± 3%      -15.00% (p=0.000 n=10+10)
BenchmarkB-8   200ns ± 5%     200ns ± 5%     ~       (p=0.578 n=10+10)
```

Columns:

- `name` — benchmark name with GOMAXPROCS suffix.
- `old time/op` — old median ± relative spread.
- `new time/op` — new median ± relative spread.
- `delta` — percentage change, or `~` for no significant change.
- `p` — p-value of the U-test.
- `n` — sample counts on each side.

Additional `name old X/op new X/op delta` blocks appear for each
non-time metric: `alloc/op`, `allocs/op`, custom `b.ReportMetric`
units.

Tools that parse benchstat output should rely on the column headers,
not on whitespace alignment, since benchstat may emit varying
widths.

## 16. Reserved env vars

The Go runtime honours these env vars; bench fixtures must capture
them:

- `GOGC` — GC trigger ratio (default 100).
- `GOMEMLIMIT` — soft heap limit (default off, since Go 1.19).
- `GODEBUG` — many comma-separated knobs, e.g. `GODEBUG=schedtrace=1000` enables scheduler tracing.
- `GOMAXPROCS` — number of OS threads for goroutines.
- `GOAMD64` — x86 baseline (v1/v2/v3/v4).
- `GOARCH`, `GOOS` — target arch/OS (compile-time).
- `GOTRACEBACK` — panic verbosity.

Any of these set differently between runs invalidates comparison.
Production fixtures should match the production values.

## 17. The `runtime.MemStats` legacy contract

`runtime.MemStats` predates `runtime/metrics`. Its contract:

- `Alloc` — currently allocated bytes.
- `TotalAlloc` — cumulative allocated bytes since start.
- `Sys` — total bytes obtained from OS.
- `Mallocs` / `Frees` — cumulative counts.
- `HeapAlloc` / `HeapInuse` — heap-only variants.
- `GCCPUFraction` — fraction of CPU time in GC since start.
- `NumGC` — number of GC cycles.

`ReadMemStats` stops the world for hundreds of microseconds. Prefer
`runtime/metrics` for any periodic sampling. `MemStats` is still
useful for one-shot before/after deltas in tests because of its
clear name semantics.

## 18. The `b.Cleanup` contract

`b.Cleanup(func())` registers a function to run after the benchmark
finishes. Useful for tearing down fixtures (closing files, stopping
servers). Cleanups run in reverse registration order. They run even
if the benchmark calls `b.Fatal`.

A pattern:

```go
func newTestServer(b *testing.B) *Server {
    srv := startServer()
    b.Cleanup(func() { srv.Close() })
    return srv
}
```

Cleanup is part of the API contract: a benchmark that leaks a
resource because it forgot to clean up is a *bench bug* that may
make subsequent benchmarks flaky.

## 19. The `testing.B.Loop` future-direction

A proposal under active discussion (as of the time of writing) is
`for b.Loop()` as an alternative to `for i := 0; i < b.N; i++`. The
goals:

- Discourage misuse of `b.N` (e.g. as a size parameter).
- Make the loop self-explanatory.
- Allow the framework to control loop body more tightly (potentially
  preventing dead-code elimination).

The proposal is not stable yet; treat it as forthcoming. The
existing `for ... b.N` form remains supported.

## 20. The compatibility contract

The Go testing/benchmarking framework follows the standard Go 1
compatibility promise:

- The exported API of `testing.B` will not break.
- Default flag behaviour may evolve (e.g. `-benchtime` default may
  change).
- Output format is *not* covered by the promise. Tools parsing
  bench output must accommodate format changes between releases.

In practice the output format is very stable; benchstat works
unchanged across years of Go releases.

## 21. The `b.Elapsed()` contract

`b.Elapsed()` returns a `time.Duration` representing the elapsed
timer value at the call point. The contract:

- Returns 0 before the first iteration.
- Excludes time spent between `b.StopTimer()` and `b.StartTimer()`.
- Accumulates monotonically across the benchmark.
- Useful for computing custom per-iteration metrics.

## 22. The threading contract

Benchmarks run on goroutines. The framework guarantees:

- One goroutine calls the bench function (unless `RunParallel`).
- The bench function's `*B` is not shared with other goroutines
  unless the user passes it.
- `b.Fatal` from the wrong goroutine panics.
- `b.Helper` and `b.Cleanup` are goroutine-safe.

For benchmarks using `RunParallel`, the contract is different: many
goroutines share a `*B`, but `pb.Next()` is the only safe coordination
primitive. The bench function should not assume serial execution.

[← Back](../)
