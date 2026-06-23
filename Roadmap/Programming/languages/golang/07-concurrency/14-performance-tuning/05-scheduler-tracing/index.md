---
layout: default
title: Scheduler Tracing
parent: Performance Tuning
grand_parent: Concurrency
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/14-performance-tuning/05-scheduler-tracing/
---

# Scheduler Tracing

Diagnosing scheduler-induced performance issues with `GODEBUG=schedtrace`, `runtime/trace`, and `runtime/metrics`. When a service has tail-latency spikes, stuck Ps, syscall storms, or netpoller saturation, you do not guess — you trace.

## Levels

- [Junior](junior.md) — `GODEBUG=schedtrace` and `scheddetail`, reading the output, the `runtime/trace` workflow.
- [Middle](middle.md) — `go tool trace` UI tour, scheduler latency view, GC interactions.
- [Senior](senior.md) — custom user regions, tasks, log events, integration with pprof.
- [Professional](professional.md) — trace format internals, continuous tracing in production, sampling design.

## Practice

- [Specification](specification.md) — knobs, environment variables, package APIs.
- [Interview](interview.md) — common questions on scheduler diagnostics.
- [Tasks](tasks.md) — capture-and-analyse exercises.
- [Find the bug](find-bug.md) — broken traces and bad conclusions.
- [Optimize](optimize.md) — reducing scheduler overhead found by tracing.

## See also

- `04-profiling-concurrent` — pprof for concurrent code.
- `10-scheduler-deep-dive/01-gmp-model` — what the trace is showing you.
- `07-goroutine-lifecycle-leaks/04-pprof-tools` — the broader profiling toolkit.
