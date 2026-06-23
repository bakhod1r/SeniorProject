---
layout: default
title: pprof and Profiling Tools
parent: Goroutine Lifecycle and Leaks
grand_parent: Concurrency
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/07-goroutine-lifecycle-leaks/04-pprof-tools/
---

# pprof and Profiling Tools

The `pprof` toolchain is Go's built-in answer to the question "what are my goroutines doing right now?" It combines a runtime sampler, on-disk profile files, an HTTP endpoint that exposes them live, and a powerful CLI and web UI that turn raw samples into flame graphs, call trees, source-annotated listings, and per-label breakdowns. For goroutine lifecycle work it is the most direct way to see leaks, contention, and stuck stacks in a running process.

This section covers:

- `runtime/pprof` for programmatic profile collection from inside the program.
- `net/http/pprof` for live HTTP endpoints, including the three debug levels of `goroutine?debug=0|1|2`.
- The full set of available profile types: goroutine, heap, allocs, mutex, block, threadcreate, profile (CPU), and trace.
- `go tool pprof` CLI commands — `top`, `list`, `web`, `peek`, `traces` — and the interactive `-http` web UI.
- Goroutine labels via `pprof.SetGoroutineLabels` and `pprof.Do`, plus `-tagfocus` filtering.
- `runtime/trace` for execution traces with goroutine-level scheduling detail.
- Reading flame graphs and call graphs to find leaks, lock contention, and blocking I/O.
- Continuous profiling with Pyroscope, Parca, Polar Signals, and Google Cloud Profiler.
- Production hardening: keeping pprof off the public internet without losing visibility.

Read `junior.md` first for a hands-on tour, then move through `middle.md`, `senior.md`, and `professional.md` for progressively deeper analysis workflows. `tasks.md`, `find-bug.md`, and `optimize.md` give you exercises with concrete pprof commands and expected outputs.
