---
layout: default
title: Benchmarks (testing.B)
parent: Testing and Benchmarking
grand_parent: Go
ancestor: Programming Languages
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/05-benchmarks/
---

# Benchmarks (`testing.B`)

[Back to Testing and Benchmarking](../)

This section covers Go's built-in microbenchmarking facility — `testing.B` — and the toolchain that surrounds it. The same `go test` binary that runs your unit tests can also run **benchmarks**: functions that loop `b.N` times while the framework auto-calibrates `N` until the measured wall time is stable.

A real benchmark is not just a `for` loop wrapped in a timer. It is a controlled experiment. You decide what is timed (`b.ResetTimer`, `b.StopTimer`), what is measured (`b.ReportAllocs`, `b.SetBytes`), and how the result is compared to a baseline (`benchstat`). You also have to know the traps — the dead-code-elimination trap, the setup-included trap, the wall-clock-noise trap — that make naive numbers misleading.

## What you will learn

- The basic shape `func BenchmarkXxx(b *testing.B)` and the `b.N` loop.
- How Go calibrates `b.N` until the run stabilises.
- `b.ReportAllocs()`, `b.SetBytes()`, sub-benchmarks via `b.Run`.
- Parallel benchmarks with `b.RunParallel` and `pb.Next`.
- Reading the columns `ns/op`, `B/op`, `allocs/op`.
- Comparing two implementations with `benchstat` from `golang.org/x/perf`.
- Production-grade benchmark stability: pinning cores, disabling turbo, running multiple `-count` rounds.
- The classic traps: compiler-eliminated work, setup time included in the measurement, `ResetTimer` in the wrong place.

## Levels

- **junior** — your first benchmark, reading the output, `b.N` intuition.
- **middle** — sub-benchmarks, table-driven, `ResetTimer`, `SetBytes`, `RunParallel`.
- **senior** — statistical analysis, `benchstat`, noise budget, rigorous comparisons.
- **professional** — CI regression testing, taskset pinning, `GOMAXPROCS=1` for deterministic runs.
- **specification** — `testing.B` godoc, `-bench` flag semantics, `benchstat` output format.
- **interview** — 25+ questions.
- **tasks** — write, table-driven, compare with `benchstat`, spot a trap.
- **find-bug** — broken benchmarks to debug.
- **optimize** — making benchmark numbers reproducible.
