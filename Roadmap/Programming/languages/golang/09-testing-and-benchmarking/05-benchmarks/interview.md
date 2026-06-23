---
layout: default
title: Benchmarks — Interview
parent: Benchmarks (testing.B)
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/05-benchmarks/interview/
---

# Benchmarks — Interview

[← Back](../)

A mix of warm-up, conceptual, and senior-grade questions on Go benchmarks. Each comes with a brief reference answer; the goal is to be able to *explain*, not just recite.

## Warm-up (1–8)

### 1. What is the signature of a Go benchmark function?

`func BenchmarkXxx(b *testing.B)`. Lives in a `_test.go` file. Name must start with `Benchmark` followed by an upper-case letter or underscore.

### 2. What does `b.N` represent?

The number of iterations the framework decided to run. Your loop is `for i := 0; i < b.N; i++ { ... }` (or `for b.Loop()` on Go 1.24+). The framework picks `N` adaptively, aiming for at least `-benchtime` of measured wall time.

### 3. How do you run benchmarks?

```
go test -bench=.
```

`-bench=<regexp>` selects which benchmarks. A bare `.` matches all. By default `-run=^$` is implied so tests do **not** run alongside.

### 4. What does `-benchmem` do?

Adds `B/op` (bytes allocated per iteration) and `allocs/op` (heap allocations per iteration) columns to the output. Equivalent to calling `b.ReportAllocs()` inside every benchmark.

### 5. What does `b.ResetTimer()` do?

Resets the elapsed time *and* the allocation counters to zero. Used after setup so setup time is not included in the per-op average. It does **not** stop the timer.

### 6. Difference between `b.StopTimer` and `b.ResetTimer`?

`StopTimer` pauses; `StartTimer` resumes. `ResetTimer` zeroes the accumulated elapsed time without changing the running/paused state.

### 7. What is `b.Run`?

Defines a sub-benchmark. Same role as `t.Run` for tests. Used for table-driven benchmarks where each row gets its own `b.N` calibration.

### 8. Read this line: `BenchmarkAdd-8   500000000   3.40 ns/op`. What do the parts mean?

- `BenchmarkAdd` — benchmark name.
- `-8` — `GOMAXPROCS=8`.
- `500000000` — final `b.N` chosen by calibration.
- `3.40 ns/op` — average wall time per iteration.

## Conceptual (9–18)

### 9. Why does Go calibrate `b.N` instead of letting you pick?

A fixed iteration count is meaningless without knowing how long the work takes. Adaptive `N` ensures the measured run is long enough (≥ `-benchtime`) to amortise timer resolution and reduce noise, regardless of whether the operation costs 2 ns or 2 ms.

### 10. What is the "dead-code elimination" trap?

If your benchmark computes a value but never observes it, the compiler may delete the work entirely. Result: `0.30 ns/op` regardless of complexity. Fix: assign to a package-level variable, pass to `runtime.KeepAlive`, or use `for b.Loop()` on Go 1.24+.

### 11. What does `b.SetBytes` do?

Declares that each iteration processed `N` bytes. The framework then reports `MB/s` (megabytes per second of throughput). Used for compression, hashing, parsing, encoding — anything where "operations per second" alone is uninformative.

### 12. When should you use `b.RunParallel`?

When measuring code under contention: mutexes, atomic counters, sharded caches, lock-free data structures. Each spawned goroutine pulls iterations from a shared `pb.Next()` counter. The default goroutine count is `GOMAXPROCS`.

### 13. What's the difference between `-benchtime=1s` and `-benchtime=1000x`?

`1s` means "calibrate `N` so that the run lasts ≥ 1 s". `1000x` means "set `b.N = 1000` exactly, skip calibration". The latter is useful for tests where every iteration is expensive and you want deterministic count.

### 14. Why do practitioners recommend `-count=10` or more?

A single run is one sample. Variance estimation needs ≥ 2 samples; statistical comparison via `benchstat` works best with ≥ 10. `-count=10` gives `benchstat` enough data to estimate stddev and run the Mann–Whitney U-test.

### 15. What does `benchstat` give you that the raw output does not?

Mean, standard deviation, percentage delta vs baseline, and a p-value for the change. It tells you not just "this is faster" but "this is faster with statistical significance, despite the noise".

### 16. Why is laptop benchmarking unreliable?

Frequency scaling (turbo boost), thermal throttling, background processes, hyper-threading, OS scheduling jitter, and laptop power management policies all introduce >5% noise routinely. A 3% improvement is invisible in this noise.

### 17. What is `runtime.KeepAlive` and when do you need it in a benchmark?

`runtime.KeepAlive(x)` is a no-op marker that prevents the compiler/runtime from considering `x` unreachable before that point. In benchmarks, you use it (or a sink variable) to keep computed values "live" so the work is not optimised away.

### 18. How do you collect a CPU profile from a benchmark?

```
go test -bench=BenchmarkFoo -cpuprofile=cpu.out
go tool pprof cpu.out
```

`-memprofile`, `-blockprofile`, `-mutexprofile`, `-trace` work analogously.

## Senior (19–28)

### 19. You see `BenchmarkX-8 1000 5000000 ns/op` and the same code at `BenchmarkX-1 1000 1000000 ns/op`. What happened?

At `GOMAXPROCS=1` the code runs faster per op. This suggests *negative scaling* — likely contention on a shared resource (mutex, atomic, false sharing). Run a mutex profile or check for unintentional sharing.

### 20. Why might `b.StopTimer` give misleading allocation numbers?

`B/op` and `allocs/op` are derived from the heap delta over the *entire* benchmark, divided by `b.N`. Allocations done during `StopTimer` blocks still count. To exclude allocator pressure from setup, put expensive setup outside the loop entirely, not inside a `StopTimer` block.

### 21. A colleague's benchmark shows `0.27 ns/op`. What's your first question?

"Did the compiler delete your work?" 0.3 ns is roughly one CPU cycle on a modern x86 — only loop bookkeeping. Their function call has likely been inlined to nothing, with the result unused. Ask to see the benchmark body; check for a sink.

### 22. Explain "noise budget".

The smallest improvement you can reliably detect given your benchmark's variance. If `benchstat` reports `± 4%` on stddev, anything < 4% improvement is in the noise. You either improve the benchmark (more `-count`, more pinning) or write off small wins.

### 23. How does CPU frequency scaling poison benchmarks?

Modern CPUs raise core frequency under load (turbo) and lower it when idle or hot. A benchmark run early gets high frequency; a later run during thermal throttling gets lower frequency. The "regression" is in the silicon, not your code. Fix: set governor to `performance`, disable turbo, run on a server with stable frequency.

### 24. What does it mean to "pin" a benchmark to a core, and why?

Bind the benchmark process to a specific CPU core via `taskset -c 3 go test -bench=...` (Linux) so the OS scheduler does not migrate it mid-run. Migration trashes the L1/L2 cache and increases per-op variance. Combine with `isolcpus` for production-grade isolation.

### 25. Why `GOMAXPROCS=1` for some benchmark suites?

Single-threaded execution removes scheduler-induced noise and contention artefacts. Useful for microbenchmarks of pure computation. Not useful for benchmarks of concurrent data structures, where you specifically want to measure contention.

### 26. How would you build a CI step that fails on a performance regression?

1. Store a baseline benchmark file (`baseline.txt`) in the repo (or a separate artifact store).
2. On each PR, run `go test -bench=. -count=10 -benchmem > new.txt` on a dedicated, stable runner.
3. `benchstat baseline.txt new.txt | tee report.txt`.
4. A script parses `report.txt`, fails if any benchmark shows a regression > X% with `p < 0.05`.
5. Promote baselines on main-branch merges.

### 27. Why is `MB/s` more useful than `ns/op` for a JSON parser benchmark?

A parser's `ns/op` scales with input size. Comparing `200 ns/op on 100-byte input` to `2000 ns/op on 1 KB input` is misleading. `MB/s` normalises by data volume, making different-sized inputs directly comparable, and lets you compare to memcpy as a lower bound.

### 28. You wrote a benchmark and `benchstat` says `(*) too variable`. Now what?

`benchstat` flagged variance as too high to draw conclusions. Causes:

- Co-tenant load (close Chrome, kill cron jobs).
- Background GC (your benchmark is allocation-heavy; consider tuning `GOGC` for the run).
- Insufficient `b.N` (increase `-benchtime`).
- Hyper-threading interference (pin to non-SMT siblings or disable HT).

Re-run after addressing the most likely cause.

## Bonus (29–30)

### 29. What does `b.Loop()` (Go 1.24+) buy you?

Two things: (a) less risk of dead-code elimination because the compiler treats the loop body as having unknown side-effects, and (b) a cleaner idiom than `for i := 0; i < b.N; i++`. It is the recommended form when you can require Go 1.24.

### 30. When is a microbenchmark the wrong tool?

When the answer you need is end-to-end latency under realistic load. A microbenchmark times an isolated function. It cannot tell you whether your service meets a p99 latency SLO, because that depends on GC pauses, scheduler queueing, network I/O, cache state, and request shape — none of which a microbenchmark captures. For those questions, use load tests against a real server.

## Deep dives (31-40)

### 31. How does Go's escape analysis affect benchmark results?

Escape analysis decides whether a value lives on the stack (free) or the heap (one allocation, GC pressure). A change that makes a value escape silently bumps `allocs/op`. A change that prevents escape can dramatically improve performance. Inspect with `go build -gcflags='-m'`. Watch for "escapes to heap" lines on hot paths.

### 32. Why might `BenchmarkX-1` and `BenchmarkX-8` have very different `ns/op`?

`-1` means `GOMAXPROCS=1` — single-threaded. `-8` means `GOMAXPROCS=8`. If the benchmark uses `b.RunParallel` or otherwise spawns goroutines, more parallelism *should* increase contention, slowing per-op. If it's a single-threaded benchmark, `ns/op` should be similar across `-cpu` values (small differences from scheduler interactions).

### 33. What does it mean if `ns/op` decreases but `B/op` increases?

The code got faster but allocates more. Net effect depends on workload. At high request rates, more allocations increase GC pressure, which can slow *other* code paths. Trade-off requires production telemetry to evaluate.

### 34. Explain `b.SetParallelism(p)`.

Multiplies the number of goroutines used by `RunParallel`. With `GOMAXPROCS=8` and `SetParallelism(10)`, you get 80 goroutines hammering the body. Useful for stress-testing contention beyond what natural goroutine counts allow.

### 35. What's the difference between `runtime.GC()` before a benchmark and `GOGC=off`?

`runtime.GC()` triggers one GC cycle then continues normally — the benchmark may experience GC during its run. `GOGC=off` disables GC entirely for the process; no GC cycles will run. The second is more invasive; use only for diagnosis.

### 36. How do you benchmark a function that depends on external state (DB, network)?

You generally do not, with `testing.B`. Use a separate macro-benchmark / load-test setup. If you must, isolate the external state in a mock that is fast and deterministic, and acknowledge the benchmark measures something other than reality.

### 37. What is "false sharing" and how would a benchmark detect it?

False sharing: two goroutines update variables that *happen* to live on the same cache line. Cache coherence forces synchronisation as if they shared a variable. Detect: a `RunParallel` benchmark with adjacent atomic counters in a struct will scale negatively; the same counters with `[64]byte` padding will scale better.

### 38. When should you use `b.RunParallel` vs a manual `sync.WaitGroup`?

`b.RunParallel` integrates with the framework's `b.N` calibration. Manual goroutine management does not — you would need to do your own calibration or use `-benchtime=Nx`. Always prefer `RunParallel` for parallel benchmarks.

### 39. What is the purpose of `runtime.KeepAlive`?

It is a no-op marker that prevents the runtime from considering a value unreachable before that point. In benchmarks, you use it to keep a computed value "live" when you cannot easily route it to a package-level sink. Example: `runtime.KeepAlive(result)` after a loop body forces `result` to remain reachable.

### 40. How do you reproduce a perf claim from a blog post or paper?

Clone the repository at the cited commit; run with the cited `go` version; run on similar hardware. Use `go test -bench` with the same flags. Run `-count=10` minimum. Compare with `benchstat`. If the cited methodology omits `-count` or hardware details, the claim is not reproducible; treat it as folklore.

## Trick / depth (41-50)

### 41. Why might `b.Loop()` give different numbers than `for i := 0; i < b.N; i++`?

`b.Loop()` instructs the compiler to treat the loop body as having unknowable side effects, suppressing some dead-code-elimination paths. Code that previously had work silently dropped will now actually run, producing slower (correct) numbers.

### 42. What's the difference between `b.Cleanup` and `defer`?

`b.Cleanup` registers cleanup at the *benchmark* level — runs after the benchmark (including all sub-benchmarks) completes, and is excluded from the timer. `defer` runs at the *function* level — within the deferred function's scope, and is included in timing if not paired with `b.StopTimer`.

### 43. If a benchmark's `ns/op` is dominated by `time.Now()`, what do you do?

`time.Now()` itself has overhead (~20 ns on Linux). If you call it inside the loop (e.g. for per-iteration timing), you measure `time.Now()` more than your work. Batch iterations: time outside the loop, divide. Or use `b.Elapsed()` once after the loop.

### 44. What's `goroutine-leak` and how can a benchmark detect it?

A goroutine that never terminates. A benchmark that creates goroutines without joining them leaks them; subsequent runs accumulate. Detect by capturing `runtime.NumGoroutine()` before and after the benchmark; if it grows, you have a leak.

### 45. Explain "fundamentally allocation-bound" vs "fundamentally CPU-bound".

Allocation-bound: the bottleneck is the allocator and GC. Fix by reducing allocations. CPU-bound: the bottleneck is computation. Fix with algorithmic improvements. Diagnose by comparing `B/op` (high → allocation-bound) and CPU profile (hot function → CPU-bound).

### 46. What does `-benchtime=1x` measure exactly?

Exactly one iteration of your `for i := 0; i < b.N; i++` loop. `b.N` is 1. Useful for setup-heavy benchmarks where you do not want calibration. The reported `ns/op` is exactly the cost of one iteration plus minor framework overhead.

### 47. How does GOMEMLIMIT interact with benchmarks?

`GOMEMLIMIT` sets a soft memory cap for the runtime. If your benchmark allocates near the cap, GC runs more frequently to keep memory below the limit. This affects `ns/op` significantly. Either set `GOMEMLIMIT` explicitly for reproducibility, or run with the default and document.

### 48. Why might two consecutive `-count=10` runs give different means?

Drift: machine state, background processes, thermal conditions. With `-count=10` you have 10 samples per side; the mean is still subject to noise. The senior practice is to use `-count=20+` and run benchmarks within a short window so drift is minimal.

### 49. Is a benchmark's `B/op` always equal to bytes allocated by the function?

Approximately. `B/op` is `mallocgc` bytes per iteration, including overhead the allocator rounds up to size classes. A `make([]byte, 30)` might report 32 (the nearest size class). Stack allocations are not counted; only heap.

### 50. Explain why you cannot benchmark a function that takes `time.Sleep` as part of its work.

`time.Sleep(t)` makes `ns/op` exactly `t` plus negligible overhead. The benchmark measures the sleep, not the computation. To measure sleep-heavy code, use macro-benchmarks (e.g. `wrk`, `hey`) that count completed requests in wall time rather than per-iteration latency.

## Final five (51-55)

### 51. How do you write a benchmark that warms up before measuring?

Before the `b.ResetTimer` call, do some unmeasured iterations to warm caches/pools:

```go
for i := 0; i < 100; i++ {
    _ = work(input)
}
b.ResetTimer()
for i := 0; i < b.N; i++ {
    _ = work(input)
}
```

`go test`'s calibration also provides implicit warm-up (multiple small runs); explicit warm-up matters when first iterations are dramatically slower.

### 52. What is "benchmark drift" and how do you detect it?

Drift: the same code benchmarks differently over time. Causes: machine accumulating state, hardware degradation, firmware updates, kernel changes. Detect: a canary benchmark run daily; track its mean over time; trends indicate drift.

### 53. Why might `-cpu=4 vs -cpu=8` matter for a non-parallel benchmark?

Even without `b.RunParallel`, `GOMAXPROCS` affects: the GC's parallelism, the scheduler's housekeeping overhead, the timer thread, network poll threads. Effects are usually small but non-zero. For ultra-stable microbenchmarks, fix `GOMAXPROCS=1`.

### 54. What does it mean if `BenchmarkX` produces different numbers on amd64 vs arm64?

Different ISAs have different instruction throughput, cache hierarchies, memory models. A benchmark fast on amd64 might be slow on arm64 (or vice versa). The `goarch:` header line tells you. Always run on the architecture you deploy to.

### 55. Final question: what's the single most important habit for benchmark hygiene?

`-count=10` plus `benchstat`. The combination of multiple runs and statistical comparison defeats more bad benchmarks than any other practice. Build the habit; it pays for itself within a week.

## Bonus interview challenges (56-60)

### 56. Walk through a CI workflow that gates PRs on perf regressions.

1. PR opened.
2. Self-hosted bare-metal runner picks up the job.
3. Sanity-check the runner: governor=performance, turbo off, low load.
4. Fetch baseline (latest main-branch benchmark output) from S3.
5. Run `go test -bench=. -count=10 -benchmem` pinned to a dedicated core.
6. `benchstat baseline.txt new.txt` produces a comparison.
7. A small Go tool parses the report; for each row, applies thresholds (e.g., regression > 5 % with p<0.05 fails the build); emits markdown.
8. Comment posted to PR with results.
9. On merge to main, the merged commit's output overwrites the baseline.

### 57. Design a benchmark for a hash function.

```go
func BenchmarkHash(b *testing.B) {
    for _, size := range []int{16, 256, 4096, 1<<20} {
        input := make([]byte, size)
        rand.Read(input)
        b.Run(fmt.Sprintf("size=%d", size), func(b *testing.B) {
            b.SetBytes(int64(size))
            b.ReportAllocs()
            for i := 0; i < b.N; i++ {
                _ = Hash(input)
            }
        })
    }
}
```

Key choices: multiple sizes (hash performance scales with input size); `SetBytes` for MB/s; random input (not all-zeros which would over-test the easy path); sink-free because the function returns a value (but consider adding `var sink uint64; sink = Hash(...)` if DCE is suspected).

### 58. How would you benchmark startup time of a Go binary?

`testing.B` is wrong for this — the test harness adds startup overhead. Use `hyperfine` or a small shell script timing `time ./mybin` repeatedly. Capture multiple runs, compute mean. For per-component startup measurement, instrument the binary itself with timing logs.

### 59. A benchmark depends on a goroutine starting up. How do you handle the startup time?

Start the goroutine in setup, signal readiness via a channel, wait, then `b.ResetTimer`:

```go
func BenchmarkX(b *testing.B) {
    ready := make(chan struct{})
    work := make(chan task)
    go func() {
        close(ready)
        for t := range work { process(t) }
    }()
    <-ready
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        work <- task{}
    }
    close(work)
}
```

The goroutine startup is excluded; you measure only the channel-send + process cost.

### 60. Final challenge: a colleague's benchmark improvement does not show up in production. Diagnose.

Hypothesis tree:

1. **Benchmark input differs from production.** Verify the corpus is representative.
2. **The function is not the bottleneck.** Profile production; check what fraction of CPU it consumes. A 30 % improvement on 2 % of CPU is 0.6 % total — within noise.
3. **Allocation effects.** The benchmark improvement was in `ns/op` but `B/op` worsened; production GC absorbs the speed gain.
4. **Cache effects.** Production data is cold; benchmark data was hot.
5. **Concurrency interaction.** Production has contention the microbenchmark missed.

Investigate top-down: profile production, identify the actual bottleneck, write benchmarks that target it. If the benchmarks still claim improvements production does not see, the benchmarks are wrong — they do not represent the workload.
