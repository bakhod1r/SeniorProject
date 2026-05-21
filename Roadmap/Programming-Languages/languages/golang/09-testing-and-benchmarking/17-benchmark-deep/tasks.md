---
layout: default
title: Benchmark Deep — Tasks
parent: Benchmarking Deep Dive
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/17-benchmark-deep/tasks/
---

# Benchmark Deep — Tasks

[← Back](../)

These tasks are deliberately under-specified. Half of benchmarking skill is
choosing the right shape of measurement; the other half is reading the
numbers. For each task write the code, run with `-count=10`, compare against
the baseline with `benchstat`, and write a one-paragraph conclusion. Cite
`golang.org/x/perf/cmd/benchstat` and `runtime/metrics` where applicable.

## Task 1 — Defeat the dead-code-elimination ghost

Write a benchmark for the following function:

```go
func square(x int) int { return x * x }
```

You will find that a naive benchmark reports `0.30 ns/op` regardless of
input. That is the noise floor of an empty loop — the compiler eliminated
the call. Rewrite the benchmark so that the result actually feeds a sink
variable, the input changes per iteration, and the compiler cannot fold the
multiplication. Then run with `-gcflags="-m=2"` and paste the inlining
decisions in your write-up. Target: a non-zero, repeatable `ns/op`.

## Task 2 — Build a microbenchmark harness with per-iteration timing

The standard `b.N` loop reports an averaged figure. Build a wrapper that
also records p50, p95, p99 by sampling `time.Now()` deltas and calling
`b.ReportMetric`. Apply it to `bytes.Buffer.Write` of a 4KiB payload. Show
that p99 is at least 3x p50 on your laptop. Discuss why.

## Task 3 — Benchstat two algorithms

Implement two versions of word-frequency counting: one with `map[string]int`
and one with a sorted `[]string` + linear scan. Run benchmarks on inputs of
1k, 10k, 100k words. Pipe results into two text files and run
`benchstat old.txt new.txt`. Identify the crossover input size where the
slice version stops winning and explain why with reference to cache lines
and CPU branch prediction.

## Task 4 — GOGC sweep

Pick a benchmark that allocates (e.g. JSON unmarshal of a 1MB document).
Run it under `GOGC=50,100,200,400,off` and `GOMEMLIMIT=64MiB,256MiB,1GiB`
combinations. Produce a CSV and a small ASCII table in your report.
Conclusion should answer: for *this* workload, which combination minimises
p99 latency? Which minimises total throughput? Are they the same?

## Task 5 — Cross-version comparison

Install Go 1.21, 1.22, 1.23, 1.24 with `go install golang.org/dl/go1.X@latest && go1.X download`.
Run the same benchmark suite under each toolchain. Report the deltas with
benchstat. Pick one regression and one improvement and dig: read the
1.X release notes and identify the runtime or compiler change that caused
it.

## Task 6 — Pinned vs unpinned

On Linux: run a CPU-bound benchmark twice, once as `go test -bench .` and
once as `taskset -c 3 go test -bench .`. Compare with `benchstat`. Then run
with the noisy neighbour `stress-ng --cpu 8 &` in the background and repeat.
Quantify the noise reduction from pinning. Report which percentiles improve
the most and which are unchanged.

## Task 7 — PGO end-to-end

Take any non-trivial program (suggest a small HTTP server returning JSON).
Run it under load, collect a `cpu.pprof`, save as `default.pgo`. Rebuild
with PGO. Benchmark the same hot path before and after. Use `-gcflags="-m"`
to see which functions were promoted to inline. Comment on the relationship
between PGO inlining and your microbenchmark numbers — do they predict the
PGO win, or do they overestimate it?

## Task 8 — runtime/metrics integration

Write a benchmark that runs a steady-state workload for 5 seconds, sampling
`/sched/latencies:seconds` (a histogram) every 50ms via `runtime/metrics`.
At the end, report the histogram p50/p99 via `b.ReportMetric`. Discuss why
this is a better signal than `ns/op` for a service that processes many
small requests.

## Task 9 — Detect a 5% regression

Write two implementations of a function that differ by exactly 5% on your
machine. Build a CI-style script that runs both 20 times, applies benchstat
with `-threshold=2%`, and exits non-zero if the regression is real. Then run
the same script on a busy laptop and confirm it produces false positives.
Discuss mitigation strategies (pinning, isolated runner, longer benchtime).

## Task 10 — Long-tail benchmarks

Pick a benchmark with high variance (something that touches the network, or
calls `runtime.GC()`). Run `-benchtime=1s -count=10` and `-benchtime=30s -count=10`.
Compare the median and the IQR of the two configurations. Argue, with
numbers, when longer `-benchtime` is worth the wall-clock cost and when it
just hides variance behind a longer average.

## Task 11 — Branch prediction experiment

Sort an array of 1M random ints, then benchmark a loop that sums elements
greater than 128. Repeat on an unsorted array. The sorted case should be
~3x faster on x86 because the branch is predictable. Reproduce this in Go,
report the numbers, and verify with `-cpuprofile`.

## Task 12 — Stripped binary cold start

Build the same program with and without `-ldflags="-s -w"`. Measure cold-
start time (kernel exec to `main` reached). Use `time ./prog` or a small
wrapper. Discuss whether the smaller binary measurably reduces startup
latency on a cold page cache.

## Task 13 — Sliding-window histogram

Build a benchmark harness that maintains a sliding-window histogram of
per-iteration latency over a 1-second window. Report the p50/p95/p99 of
the most recent window via `b.ReportMetric`, every second of bench time,
to a log file. Useful for catching transient slowdowns (e.g., GC pauses)
in a long-running bench. Discuss the trade-offs vs reporting only the
overall p50/p95/p99.

## Task 14 — runtime/metrics histogram extraction

Write a helper that snapshots `/sched/latencies:seconds` before and
after a benchmark, computes p99 of the delta histogram, and reports it
via `b.ReportMetric`. The delta histogram is what your bench induced;
the absolute histogram includes the process lifetime. Apply this to a
goroutine-heavy benchmark and confirm the p99 you see is plausible
given GOMAXPROCS and the bench's parallelism.

## Task 15 — Hot-path measurement on an HTTP handler

Take an HTTP handler from any open-source Go project (e.g. a
`net/http` example or a small microservice). Build a `httptest`-based
benchmark that exercises it under realistic load (vary the body size
and the URL path). Use `b.ReportMetric` to report p99 and total
allocations per request. Profile the handler and identify the top two
hotspots. Hypothesise an optimisation for each; bench the change; show
the macro p99 delta with benchstat.

## Task 16 — sync.Pool warmup behaviour

Write two benchmarks: one that uses a package-level `sync.Pool` (warm
across iterations) and one that allocates a fresh pool inside `b.Run`
each iteration (cold). Compare. Explain in your write-up why the warm
case shows `< 1 allocs/op` while the cold case shows the expected
allocation count.

## Task 17 — GOMAXPROCS sweep on a contended mutex

Write a contended-mutex benchmark using `b.RunParallel`. Run with
`-cpu=1,2,4,8,16`. Plot the per-iteration time vs GOMAXPROCS. Identify
the inflection point where contention dominates. Compare with the same
benchmark using `sync.RWMutex` and `atomic.Int64`.

## Task 18 — Inline budget exploration

Find three functions in the standard library that *almost* inline but
fail (cost just over 80). Use `-gcflags="all=-m=2"`. For each, propose
a refactor that would make it inline-eligible. Bench the difference (if
you can — for stdlib you may need to vendor and patch).

## Task 19 — Build a noise-floor measurement script

Write a shell script that runs the same benchmark twice in a row and
reports the largest delta from benchstat. Capture the output to a
file named with the date. Run it daily for a week. Plot the noise
floor over time. Discuss any trend you observe (warmer machine? CI
neighbours? thermal aging?) and what it implies for your gate
threshold.

## Task 20 — Stable iteration-count harness

Replace the framework's `b.N` selection with your own: a wrapper that
runs the body for exactly `1000 * 2^k` iterations and reports a sorted
slice of per-iteration times. Implement `b.ReportMetric` for p50, p95,
p99. Compare the result with the standard framework's output. Discuss
which is more useful for which kind of bench (microbench vs steady-
state vs tail-sensitive).

## Task 21 — Bench replay via captured trace

Capture a `go tool trace` of a real service under load. Identify the 10
most frequent goroutine entries. Build a benchmark that re-executes
those 10 paths in the proportion seen in the trace. Compare the result
with a uniform mix. Conclusion: how much does input distribution
matter for the headline metric?

## Task 22 — Cross-architecture comparison

If you have access to both x86 and ARM machines (e.g. a server and an
Apple Silicon laptop), run the same benchmark suite on both. benchstat
will refuse to merge because the GOARCH differs. Instead compare the
*ratios* between two implementations across arches. Identify any
implementation whose ratio differs materially. Investigate: is it
SIMD, branch behaviour, or memory bandwidth that explains the
difference?

## Task 23 — Build the variance budget dashboard

Pick a Go project with at least 50 benchmarks. Run the suite nightly
for two weeks. Compute, per benchmark, the median and IQR over the
nightly runs. Build a CSV with one row per benchmark showing the IQR
percentage. Flag any row above 5%. For each flagged row, investigate
the root cause (noisy fixture? legitimate flakiness? wrong runner?).

## Task 24 — PGO win attribution

You apply PGO and see a 7% improvement in a benchmark. Use
`-gcflags="-m=2"` with and without `-pgo=` to compare inlining
decisions. Identify the functions whose inlining changed because of
the profile. Hypothesise which of those changes account for the 7%.
Verify by manually adding `//go:noinline` to one of them and re-
running with PGO; the win should shrink by the predicted amount.

## Task 25 — Compare benchstat against benchcmp

For one benchmark run two comparisons: `benchcmp old.txt new.txt`
and `benchstat old.txt new.txt`. Note the differences in output. In
particular: does `benchcmp` report a delta where `benchstat` says
`~`? When and why? Use this as a teaching example for why
`benchcmp` is deprecated.

## Task 26 — Implement a benchstat-compatible CSV exporter

Write a Go program that reads `go test -bench` output and writes a
CSV with columns `benchmark, samples, mean_ns, median_ns, p99_ns,
allocs_per_op, bytes_per_op`. Feed the CSV into a spreadsheet for
ad-hoc analysis. Compare your output against `benchstat -csv` to
verify correctness.

## Task 27 — A bench for `runtime.Stack`

`runtime.Stack(buf, all)` is sometimes called for diagnostics
(panic, profiler). It is not on a hot path but its cost surprises
people. Build a benchmark for it with `all=false` and `all=true`,
under varying goroutine counts (10, 1k, 10k). Quantify the cost
growth. Discuss when calling `runtime.Stack` in production is safe.

## Task 28 — The async preempt experiment

Disable async preemption with `GODEBUG=asyncpreemptoff=1`. Run a
CPU-bound benchmark with tight loops. Compare against the default.
Quantify the difference. The takeaway: async preempt has a small
cost in tight loops but is necessary for the scheduler to be
responsive. Production keeps it on; understanding the cost is
useful for diagnostics.

## Task 29 — Confidence interval bootstrap

Write a Go program that reads a list of bench samples (numbers, one
per line) and computes a 95% bootstrap CI for the median by
resampling 10000 times. Compare your CI against benchstat's
±X% spread. Discuss when each summary is more informative.

## Task 30 — Variance reduction by warmup

Take a benchmark and three different warmup strategies:
(a) no warmup, (b) one pass of `b.N` iterations as warmup,
(c) `runtime.GC()` + 100 iterations as warmup. Measure the IQR of
`-count=20` runs for each. Identify which warmup minimises IQR. The
goal is reducing the noise floor before any code change.

## Task 31 — Implement a tiered CI script

Write a shell script that implements the three-tier perf CI from
the professional page: smoke (fast, no claims), focused (gated,
benchstat with p<0.05 and threshold=5%), trend (nightly, store
results). The script should:

- Take a tier name as argument.
- Run the right `go test -bench` invocation for that tier.
- For focused: compare against a baseline file and exit non-zero on
  regression.
- For trend: append results to a date-stamped output directory.

## Task 32 — runtime/metrics export endpoint

Add an HTTP endpoint to a Go service that exposes `runtime/metrics`
as Prometheus-format text. Scrape it from a local Prometheus
instance. Plot the GC pause histogram. Run a load test; confirm
that the histogram changes shape under load. Use this setup as
the basis for a production-grade perf dashboard.

## Task 33 — Profile diff workflow

Pick a real or synthetic regression. Collect profiles before and
after with `-cpuprofile`. Use `go tool pprof -base before.pprof after.pprof`.
Identify the top three growing functions. For each, write a single
sentence explaining the regression: "function X grew because Y".
This is the standard regression-investigation workflow; practising
it is invaluable.

## Task 34 — A benchmark for `b.RunParallel`

Build a benchmark that uses `b.RunParallel` with a synthetic shared
counter. Run at `-cpu=1,2,4,8,16`. Compute the per-iteration time
as a function of GOMAXPROCS. Plot it. Identify the inflection point
where contention dominates. Discuss how this curve would inform a
service's sizing decisions (how many cores per pod?).

[← Back](../)
