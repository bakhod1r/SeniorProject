# Benchmarking Strategy — Specification

> **Focus:** Precise reference for Go's built-in benchmarking facilities — the `testing.B` API, the `go test -bench` driver, output format, and the `benchstat` companion tool used for statistical comparison.
>
> **Sources:**
> - `testing` package documentation: https://pkg.go.dev/testing
> - `go test` command reference: https://pkg.go.dev/cmd/go#hdr-Testing_flags
> - `benchstat` tool: https://pkg.go.dev/golang.org/x/perf/cmd/benchstat
> - Go blog — testing: https://go.dev/blog/subtests
> - Dave Cheney, *High Performance Go Workshop*: https://dave.cheney.net/high-performance-go-workshop/dotgo-paris.html

---

## 1. What `testing.B` is

A benchmark function has the signature

```go
func BenchmarkXxx(b *testing.B)
```

and lives in a `_test.go` file. The `go test` driver discovers it, invokes it with successively larger values of `b.N`, and measures wall-clock time per operation. The result is reported in **nanoseconds per operation (`ns/op`)** and, when requested, **bytes and allocations per operation**.

Benchmarks share the test binary with `TestXxx` and `ExampleXxx` functions but are **never** run by `go test` alone; they require the `-bench` flag.

---

## 2. The `testing.B` API surface

| Member | Purpose |
|--------|---------|
| `b.N` | The number of iterations the driver wants you to run. Loop body must run `b.N` times. |
| `b.ResetTimer()` | Reset elapsed time, bytes, and alloc counters; use after expensive setup. |
| `b.StartTimer()` | (Re)start the timer (automatic at function entry). |
| `b.StopTimer()` | Pause the timer for setup/teardown inside the loop. |
| `b.ReportAllocs()` | Force `-benchmem` style reporting for this benchmark only. |
| `b.ReportMetric(value, unit)` | Add a custom metric column to the output (e.g., `req/s`, `MB/s`). |
| `b.SetBytes(n)` | Declare bytes processed per op; enables the `MB/s` column. |
| `b.Run(name, fn)` | Sub-benchmark; enables table-driven measurement. |
| `b.RunParallel(fn)` | Distribute `b.N` across goroutines for concurrent benchmarks. |
| `b.SetParallelism(p)` | Multiplier on `GOMAXPROCS` for `RunParallel` (default 1). |
| `b.Loop()` (Go 1.24+) | Idiomatic replacement for `for i := 0; i < b.N; i++`; prevents many footguns. |
| `b.Helper()` | Mark a helper so failures point at the caller's line. |
| `b.Cleanup(fn)` | Run `fn` after the benchmark completes. |
| `b.Fatalf(...)` / `b.Errorf(...)` | Fail the benchmark (still reports partial results). |

---

## 3. Driver flags

| Flag | Effect |
|------|--------|
| `-bench=<regex>` | Run benchmarks whose name matches regex. Use `.` for all. |
| `-benchmem` | Include `B/op` and `allocs/op` columns. |
| `-benchtime=<dur>` | Target wall time per benchmark (e.g., `5s`, `500ms`). Default `1s`. |
| `-benchtime=Nx` | Pin `b.N` to exactly `N` iterations. Useful for deterministic runs. |
| `-count=N` | Repeat each benchmark N times back-to-back; required for `benchstat`. |
| `-cpu=1,2,4` | Run each benchmark for each `GOMAXPROCS` value. |
| `-run=^$` | Skip all `TestXxx`; standard prefix to a `-bench` invocation. |
| `-cpuprofile=cpu.out` | Write a CPU profile during benchmarks. |
| `-memprofile=mem.out` | Write a heap profile after the run. |
| `-blockprofile=block.out` | Write a contention profile. |
| `-mutexprofile=mutex.out` | Write a mutex contention profile. |
| `-trace=trace.out` | Write an execution trace. |
| `-timeout=<dur>` | Per-benchmark timeout; `-bench` runs can be long. |

Canonical invocation for a regression-comparable run:

```bash
go test -run=^$ -bench=. -benchmem -count=10 -benchtime=2s ./... | tee new.txt
```

---

## 4. Output format

```
goos: linux
goarch: amd64
pkg: example.com/mylib
cpu: AMD Ryzen 9 7950X
BenchmarkSum-32         12345678              97.4 ns/op            24 B/op          1 allocs/op
```

| Column | Meaning |
|--------|---------|
| `BenchmarkSum-32` | Benchmark name plus active `GOMAXPROCS`. |
| `12345678` | Final `b.N` reached during scaling. |
| `97.4 ns/op` | Mean wall time per loop iteration. |
| `24 B/op` | Mean heap bytes allocated per op (with `-benchmem`). |
| `1 allocs/op` | Mean heap allocations per op (with `-benchmem`). |

`b.SetBytes(n)` adds an `MB/s` column. `b.ReportMetric(v, "req/s")` adds a custom column.

---

## 5. How the driver picks `b.N`

The driver starts with `b.N = 1`. It runs the benchmark, measures elapsed time, and uses that to estimate how many iterations are needed to fill `-benchtime`. It then multiplies `b.N` by a factor (capped at 100×) and re-runs. The loop continues until elapsed time ≥ `-benchtime` or `b.N` saturates `math.MaxInt32`.

Consequences:

- Each benchmark function is run **multiple times** by the driver during a single `-bench` invocation. Side effects across iterations are forbidden in well-formed benchmarks.
- Setup code at the top of the function executes once per ramp-up iteration, **not** once per `-count`. Use `b.ResetTimer()` to exclude it.
- A pinned run (`-benchtime=10000x`) runs exactly once with `b.N = 10000`.

---

## 6. `benchstat` semantics

`benchstat` is a separate tool that takes two (or more) output files and computes a statistical comparison.

```bash
go install golang.org/x/perf/cmd/benchstat@latest
benchstat old.txt new.txt
```

| Column | Meaning |
|--------|---------|
| `time/op` | Geometric-mean ns/op per file. |
| `delta` | Percent change, sign relative to `old.txt`. |
| `p=` | Two-sample Mann–Whitney U-test p-value. |
| `n=` | Number of samples per file (must match `-count=N`). |
| `±` | Coefficient of variation across samples. |

By default `benchstat` declares a result **significant** only if `p < 0.05`. Differences with `p ≥ 0.05` are printed as `~` (no significant change). It refuses to compare files with `n < 6`; 10 is the conventional minimum.

`benchstat` (post 0.0.0-2023) also accepts `-filter`, `-geomean`, and `-confidence` flags. Pre-0.0.0-2023 versions are stricter and lack a few of these.

---

## 7. Custom metrics with `ReportMetric`

```go
func BenchmarkRouter(b *testing.B) {
    for i := 0; i < b.N; i++ {
        route("/users/42")
    }
    b.ReportMetric(float64(b.N)/b.Elapsed().Seconds(), "req/s")
    b.ReportMetric(0, "ns/op") // suppress the default column
}
```

`ReportMetric(0, "ns/op")` is the documented way to remove the default time column. Custom metrics participate in `benchstat` comparisons the same way `ns/op` does.

---

## 8. Sub-benchmarks (`b.Run`)

```go
func BenchmarkParse(b *testing.B) {
    sizes := []int{16, 256, 4096, 65536}
    for _, n := range sizes {
        b.Run(fmt.Sprintf("size=%d", n), func(b *testing.B) {
            payload := make([]byte, n)
            b.ResetTimer()
            for i := 0; i < b.N; i++ {
                _ = parse(payload)
            }
        })
    }
}
```

Each sub-benchmark gets its own `b.N`, its own output line, and a slash-separated name (`BenchmarkParse/size=4096`). `-bench=BenchmarkParse/size=256$` runs just one.

---

## 9. Parallel benchmarks

```go
func BenchmarkLookup(b *testing.B) {
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            _ = cache.Get("key")
        }
    })
}
```

`RunParallel` spawns `runtime.GOMAXPROCS(0) * b.Parallelism` goroutines, each draining a shared `b.N` budget via `pb.Next()`. Use for code paths where contention is the point (locks, atomics, channel ops). Single-threaded benchmarks should **not** use `RunParallel`.

---

## 10. Avoiding compiler optimization

The compiler may delete a benchmark loop body entirely if the result is unused. Three defenses:

| Technique | When |
|-----------|------|
| Package-level `var sink T` and assign `sink = result` | Most common; works in all versions. |
| `runtime.KeepAlive(x)` | When the optimization is "this allocation has no observable use". |
| `b.Loop()` (Go 1.24+) | The compiler explicitly marks the loop body as having side effects. |

Without these, a benchmark of `1 + 2` reports `0.31 ns/op` — the cost of the loop counter.

---

## 11. The `b.Loop()` form (Go 1.24+)

```go
func BenchmarkFoo(b *testing.B) {
    for b.Loop() {
        _ = expensive()
    }
}
```

`b.Loop()` is equivalent to `for i := 0; i < b.N; i++` but with three improvements:

1. The compiler treats arguments passed to functions inside the loop as escaping, preventing dead-code elimination.
2. Setup before the first `b.Loop()` call is excluded from the timer automatically — no `b.ResetTimer()` needed.
3. The body runs at least once for `b.N == 1` ramp-ups, simplifying the mental model.

Prefer `b.Loop()` in new code targeting Go 1.24+.

---

## 12. Stability requirements

Reliable benchmark numbers require a stable system. Quoting `perflock` documentation:

| Source of noise | Mitigation |
|-----------------|------------|
| CPU frequency scaling | Disable turbo, pin governor to `performance` (Linux) |
| Other processes | `taskset -c 2,3` to pin; `perflock` to serialize benchmark runs |
| Thermal throttling | Run short, give breathing room between runs |
| ASLR / address randomization | Run multiple times (`-count=10`) and use `benchstat` |
| GC | Built into the measurement; do not disable |

Variance under 1% is achievable on a quiet Linux machine with `perflock`; 3–5% is typical on a laptop; 10%+ is normal on CI runners.

---

## 13. Non-goals / limitations

- `testing.B` is **not** a load testing tool; it cannot drive a separate process or simulate users.
- Benchmarks measure CPU-bound microcode well and end-to-end systems poorly.
- The driver does not statistically validate a single run; pair with `-count=10` and `benchstat`.
- `b.SetBytes` does not measure I/O; it asserts a value you supplied.
- Memory metrics under `-benchmem` are only heap allocations; stack allocations are invisible.

---

## 14. Related references

- `testing` package: https://pkg.go.dev/testing
- `go test` flags: https://pkg.go.dev/cmd/go#hdr-Testing_flags
- `benchstat`: https://pkg.go.dev/golang.org/x/perf/cmd/benchstat
- Dave Cheney, benchmarking pitfalls: https://dave.cheney.net/2013/06/30/how-to-write-benchmarks-in-go
- Go 1.24 `b.Loop()` proposal: https://go.dev/issue/61515
