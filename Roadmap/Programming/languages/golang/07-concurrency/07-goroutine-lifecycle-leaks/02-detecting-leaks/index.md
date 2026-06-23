---
layout: default
title: Detecting Goroutine Leaks
parent: Goroutine Lifecycle and Leaks
grand_parent: Concurrency
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/07-goroutine-lifecycle-leaks/02-detecting-leaks/
---

# Detecting Goroutine Leaks

[← Back](../)

A goroutine leak is a goroutine that is started but never returns. It silently retains its stack, captured variables, channels, mutexes, file descriptors, and any heap objects reachable from its frames. Single leaks rarely crash a program; thousands or millions of them do. Detection is the first half of the fight — once you can see a leak, you can fix it. This subsection covers the full detection toolbox: in-process counters, `pprof` endpoints, the `goleak` test library, programmatic profile dumps, the `gops` agent, Delve, and `runtime/trace`. It also covers the production side: emitting goroutine metrics to Prometheus or OpenTelemetry, cross-checking with heap profiles, and reading stack traces grouped by frame.

## Sub-pages

- [junior.md](junior.md) — What a leak is, `runtime.NumGoroutine`, `net/http/pprof`, `goleak` in tests
- [middle.md](middle.md) — `pprof goroutine` workflow, stack-trace grouping, label-based filtering, false positives
- [senior.md](senior.md) — Production monitoring with Prometheus and OpenTelemetry, memory cross-checks, alerting
- [professional.md](professional.md) — Runtime internals of goroutine profiling, `runtime.Stack`, schedtrace, scheduler-level diagnostics
- [specification.md](specification.md) — Exact semantics of `runtime.NumGoroutine`, pprof profile format, `goleak` contract
- [interview.md](interview.md) — Interview questions on leak detection, false positives, and tool selection
- [tasks.md](tasks.md) — Hands-on detection exercises with `goleak`, pprof, and live process inspection
- [find-bug.md](find-bug.md) — Reading real stack traces and identifying which goroutine leaks and why
- [optimize.md](optimize.md) — Reducing detection overhead, sampling profiles, and integrating leak gates in CI
