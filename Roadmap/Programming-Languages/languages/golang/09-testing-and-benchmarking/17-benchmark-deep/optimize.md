---
layout: default
title: Benchmark Deep — Optimize
parent: Benchmarking Deep Dive
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/17-benchmark-deep/optimize/
---

# Benchmark Deep — Optimize

[← Back](../)

These exercises hand you a slow benchmark, a confidence interval, and a
budget. Optimize the *measurement* first (so you can trust the numbers),
then optimize the *code*. Always finish with a benchstat comparison and a
written conclusion.

## Exercise 1 — Reduce variance before chasing speed

You inherit a benchmark that reports `12,400 ns/op ±18%`. Before touching
the implementation, drop the ±18% to under 3%. Use any combination of:
`-count`, `-benchtime`, `taskset` pinning, frequency lock, SMT-sibling
isolation, GOGC tuning, `-cpu=1`. Document each change and its effect on
the IQR. Goal: stable enough that a 5% real regression would be detected
at `p < 0.05`.

## Exercise 2 — Hot-path JSON

The following handler is the bottleneck of an HTTP service:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    var in Request
    json.NewDecoder(r.Body).Decode(&in)
    out := process(in)
    json.NewEncoder(w).Encode(out)
}
```

Benchmark it with `httptest.NewRecorder`. Target a 30% reduction in
ns/op. Allowed tools: `encoding/json` is locked, but you may switch to
`encoding/json/v2`, `easyjson`, or hand-written encoders; you may add
`sync.Pool` for decoder/encoder reuse; you may avoid the `Body` round trip
with `io.ReadAll` and a pooled `[]byte`. Report alloc/op too.

## Exercise 3 — Cold-cache vs hot-cache measurement

Build a benchmark that measures the same function in two modes: hot
(working set fits in L1) and cold (working set is 64MiB, exceeds L3).
Use array-of-struct vs struct-of-array layouts. Show with numbers that
the SoA version wins only in the cold case. Use `b.ReportMetric` to add a
"cycles/byte" derived metric using `runtime.GOMAXPROCS` and the CPU
frequency.

## Exercise 4 — PGO win quantification

You apply PGO and the production p95 drops by 9%. Build a microbenchmark
that *predicts* the win, then run it with and without `default.pgo`.
Compare the predicted delta to the production delta. If they disagree by
more than 3pp, explain which environmental factor caused the divergence
(call-graph diversity, GC pressure, branch density, etc).

## Exercise 5 — Memory limit tuning

You are deploying a service with a hard 512MB container limit. Build a
benchmark that runs the typical workload under five different
`GOMEMLIMIT` settings: 256MiB, 384MiB, 448MiB, 480MiB, 512MiB. Plot the
GC overhead (`runtime/metrics` -> `/gc/cpu-time:seconds`) against the
limit. Find the knee of the curve and recommend a setting.

## Exercise 6 — Replace mean with quantiles

The team's benchmark reports `mean = 850 ns/op` and the dashboard shows
the regression as a 4% bump. Production sees a 22% bump in p99. Rebuild
the benchmark to report p50/p95/p99 via `b.ReportMetric` and reproduce
the production observation. Once you can see the p99 bump locally,
optimize: target a return to the pre-regression p99 without losing the
mean improvement.

## Exercise 7 — Inlining experiment

Pick a small function called from many places. Use `-gcflags="-m=2"` to
confirm it inlines, then add `//go:noinline` to force a non-inlined
build. Benchmark both. The delta is the inlining benefit. Then check
whether PGO would have inlined it anyway; if so, remove your manual
attempt.

## Exercise 8 — Long-tail benchmark cleanup

A long-running benchmark (`-benchtime=60s`) shows 8 spikes per minute of
5x normal latency. Pull `runtime/metrics` samples for
`/gc/pauses:seconds`, `/sched/latencies:seconds`,
`/sync/mutex/wait/total:seconds`. Identify the dominant cause of the
spikes. Optimize to remove the worst class. Re-run and confirm with
benchstat that p99 dropped.

## Exercise 9 — Benchmark suite shrink

The team has 312 benchmarks taking 47 minutes to run. Most are redundant.
Define a metric (e.g. coverage of `pprof` hotspots) and prune the suite
to the minimum needed to detect a 2% regression on any function
representing more than 1% of CPU time. Target: ≤ 30 benchmarks, ≤ 5
minutes wall-clock, while preserving regression-detection power. Justify
each kept benchmark.

## Exercise 10 — CI runner cost

Your CI runs all benchmarks on every PR on a noisy shared runner; false
positives have desensitised the team. Design a tiered strategy:
- Per-PR: a 60-second smoke test, no statistical claims.
- Per-merge to main: a 10-minute focused suite on a pinned runner.
- Nightly: the full suite on bare metal with benchstat tracking trend.

Implement the per-PR tier as a `go test -bench` invocation with
appropriate flags and a benchstat threshold. Write the YAML for one
runner (any CI is fine: GitHub Actions, Buildkite, etc.).

## Exercise 11 — False sharing in a counter struct

You have:

```go
type Counters struct {
    A, B, C int64
}
```

Three goroutines each `atomic.AddInt64` one field. Build a benchmark
showing the per-iteration cost. Then pad the fields to occupy
separate cache lines (64-byte alignment) and re-bench. Quantify the
speedup. Report:

- Before / after ns/op with benchstat (p < 0.05).
- Memory waste (extra bytes per struct).
- Conditions under which padding is worth it (estimate the QPS
  threshold at which the perf gain pays for the memory cost in a
  cloud bill).

## Exercise 12 — Struct alignment audit

Run `golangci-lint` with the `fieldalignment` linter over a real Go
codebase. Pick the three biggest fixable structs (most bytes wasted).
For each: bench a slice-of-100k allocation and access pattern before
and after the alignment fix. Show the cache effect with `perf stat`
(`LLC-loads`, `LLC-load-misses`). Conclusion should answer: is the
linter's auto-fix recommendation always a net win, or are there cases
(small slices, hot allocations) where the misalignment is worth
keeping?

## Exercise 13 — Encoding selection

Your service serialises a `Document` struct with 30 fields. You have
three options:

1. `encoding/json` (stdlib).
2. `encoding/json/v2` if available.
3. `vmihailenco/msgpack` or another binary format.

Benchmark all three for: encode time, decode time, alloc/op, encoded
size. Build a decision matrix. Recommend one based on a hypothetical
constraint set: "p99 of full round-trip under 50µs, < 200 bytes on
wire, no schema breakage." Defend your choice with the numbers.

## Exercise 14 — Hashing throughput

Implement a benchmark for hashing 1KB, 1MB, 100MB buffers with:
`crypto/sha256`, `crypto/sha512`, `hash/maphash`, and one third-party
fast hash (e.g. `xxhash`). Report MB/s for each. Use `b.SetBytes`.

Identify the size at which `crypto/sha256` is bandwidth-bound on
your machine (throughput plateaus). Compare to your memory bandwidth
upper bound (use `mbw` or a synthetic memcpy benchmark to measure).

## Exercise 15 — Cold-start budget

Your CLI tool starts up, does one operation, and exits. Cold start is
a known pain point. Measure:

- Time from `exec` to `main`.
- Time inside `main` before the first useful work.
- Total wall time.

Use `-ldflags="-s -w"`, `-trimpath`, and varying init complexity to
see what affects what. Reduce total wall time by 30%. Target: shave
the obvious lazy-init costs without breaking functionality.

## Exercise 16 — Decoder pool tuning

You have a service that decodes 50KB JSON messages at 5000 QPS. Each
request creates a new `*json.Decoder`. The hot path's allocations are
dominated by decoder construction. Introduce a `sync.Pool` of decoders
and benchmark the change:

- Per-request allocations.
- p99 latency.
- GC frequency (`runtime/metrics`).
- Pool steady-state population.

Investigate whether the pool's `New` function is being called more
than expected. If yes, the pool is being drained — diagnose why.
Tune the pool until New is called only at startup.

## Exercise 17 — Eliminate a defer

A function on the hot path uses `defer` for cleanup. The `defer` adds
3-5ns per call. At 100M QPS this is 300-500ms of CPU per second across
the fleet — non-trivial. Rewrite to use explicit cleanup without
`defer`. Bench before/after; confirm correctness is preserved (the
defer ran even on panic paths — your replacement must too, using
explicit panic handling where required).

## Exercise 18 — Replace an interface call

You have a hot loop calling `iface.Method()`. Devirtualise either by:
making the call site take a concrete type, or by trying PGO devirtual-
isation. Bench both. Compare the win. Comment: when is the concrete-
type refactor preferable (clearer code, no PGO dependency)? When is
PGO preferable (preserves polymorphism for future callers)?

## Exercise 19 — Reduce GC scan time

A long-running service has 8GB of resident heap, mostly long-lived
objects. GC scan is 200ms p99. Replace one or more of the long-lived
structures with off-heap (e.g. `mmap`-backed, or pointer-free arrays)
to reduce scan workload. Bench `runtime/metrics`'s `/gc/pauses:seconds`
before and after. Target: cut GC scan p99 by 50%.

## Exercise 20 — Build a regression-detection bot

Write a small Go program that:

1. Reads two benchstat output files.
2. Parses the deltas.
3. Posts a Markdown comment to a GitHub PR with the deltas, colour-
   coded by significance.
4. Exits non-zero if any contract benchmark regressed > 5% with
   `p < 0.05`.

Integrate it into a CI workflow. Test by submitting a deliberately-
regressing PR and confirming the bot flags it.

## Exercise 21 — Reduce the suite wall time

Your bench suite takes 90 minutes. Halve it without losing
regression-detection coverage. Strategies to consider:

- Tier the benches: only contract benches run with `-count=20`; the
  rest with `-count=5`.
- Parallelise across packages (`go test -bench` per package, in
  parallel, on a multi-core runner).
- Move flaky/redundant benches to a "slow" tag run nightly only.

Measure before and after; report the new wall time and the
regression-detection power (false-negative rate on a synthetic
regression of 5%).

## Exercise 22 — A bench-driven refactor

Pick a function in your codebase whose alloc/op is non-zero. Write a
benchmark. Iterate: read the source, hypothesise an alloc cause,
fix it, re-bench. Stop when alloc/op = 0 or when no further fix is
feasible.

Document each step: the source diff, the bench delta, and the
inferred root cause (escape, closure capture, interface boxing,
slice growth, etc). At the end, write a one-paragraph summary of
what kinds of changes had the biggest impact. This becomes a
training doc for juniors.

## Exercise 23 — Cache padding for fan-in counter

You have N producer goroutines incrementing a shared counter at
high rate. The counter is `int64`. Implement three variants:

1. Naive: a single `atomic.Int64`.
2. Padded: an `atomic.Int64` with cache-line padding around it.
3. Striped: `runtime.NumCPU()` separate `atomic.Int64`s, each
   producer hashes to one, reads sum across all.

Bench each with `b.RunParallel` and `-cpu=1,2,4,8,16,32`. Plot
ns/op vs producer count for each variant. Identify the crossover
points where each variant wins. Pick the right one for a fleet
where each machine has 32 cores and producers number 100s.

## Exercise 24 — Memory pool granularity

Your service allocates many small structs of varying sizes. Test
three pooling strategies:

1. One `sync.Pool` per type.
2. One `sync.Pool` with a buffer reused across types.
3. No pool, rely on `mallocgc` directly.

Bench under realistic mixed workload. The right answer is sometimes
"no pool" (`mallocgc` is fast and avoids pool contention). Document
the conditions under which each strategy wins.

## Exercise 25 — A benchmark for the noise floor itself

Build a tool that runs the same trivial benchmark (e.g. an empty
loop) 100 times on your dev machine, records the distribution, and
reports the 5th/50th/95th percentile of inter-run variance. Use this
as the team's official noise-floor reference. Re-run quarterly; any
significant drift is a signal that the runner has changed.

## Exercise 26 — A perf-aware code review template

Draft a checklist for performance-sensitive code reviews:

- Are inputs varied per iteration?
- Is the return captured by a sink?
- Are setup costs outside `b.ResetTimer`?
- Is `b.ReportAllocs` set?
- Is the bench reproducible by a teammate on the pinned runner?
- Does the PR description include the bench fixture and the
  benchstat output?
- Has the reviewer audited the `allocs/op` column?

Apply the checklist to a real PR; document which items the PR
passed and which it failed. Iterate on the checklist until it
captures real defects.

[← Back](../)
