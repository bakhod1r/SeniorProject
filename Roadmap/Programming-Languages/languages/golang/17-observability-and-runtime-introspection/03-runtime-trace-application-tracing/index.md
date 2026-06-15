---
layout: default
title: runtime/trace & Application Tracing
parent: Observability & Runtime Introspection
grand_parent: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/17-observability-and-runtime-introspection/03-runtime-trace-application-tracing/
---

# runtime/trace & Application Tracing

[← Back](../)

We explore Go's **execution tracer** and the `runtime/trace` package. Unlike a CPU profile, which tells you *where* time is spent, the execution trace tells you *when* and *why* every goroutine ran, blocked, or was preempted — scheduler latency, GC pauses, syscalls, and network/sync blocking are all recorded against a precise timeline. We cover capturing traces, viewing them in `go tool trace`, adding user-level tasks/regions/logs, the low-overhead Go 1.21+ tracer, and the Go 1.25 flight recorder.

## Sub-pages

- [junior.md](junior.md) — What the execution tracer is, capturing a trace, and reading `go tool trace`
- [middle.md](middle.md) — User annotations (tasks, regions, logs), the timeline views, capture mechanisms
- [senior.md](senior.md) — The 1.21+ tracer rewrite, the flight recorder, production tracing strategy
- [professional.md](professional.md) — Tracer internals, event format, overhead model, programmatic capture
- [specification.md](specification.md) — `runtime/trace` API surface, trace formats, version differences
- [interview.md](interview.md) — Interview questions and answers from junior to staff
- [tasks.md](tasks.md) — Hands-on exercises (easy → hard)
- [find-bug.md](find-bug.md) — Bug-finding exercises with broken tracing scenarios
- [optimize.md](optimize.md) — Using traces to optimize, and optimizing tracing itself
