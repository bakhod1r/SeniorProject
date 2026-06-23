---
layout: default
title: Concurrent Profiling
parent: Performance Tuning
grand_parent: Concurrency
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/14-performance-tuning/04-profiling-concurrent/
---

# Profiling Concurrent Go Code — Performance Tuning

[← Back](../)

This section is the **concurrency-specific** counterpart to the general pprof coverage in [07-goroutine-lifecycle-leaks/04-pprof-tools](../../07-goroutine-lifecycle-leaks/04-pprof-tools/). The earlier page teaches the tool itself — how to expose endpoints, run `go tool pprof`, read flame graphs, diff profiles. This page focuses on the **three profiles and one trace** that exist specifically to debug parallel workloads: the goroutine, mutex, and block profiles, plus `runtime/trace`. If you cannot already collect a heap profile or read `top` in the REPL, finish the pprof-tools page first. Here we assume that fluency and move directly to finding lock contention, slow channels, scheduler starvation, and serialisation bottlenecks in concurrent code.

## Sub-pages

- [junior.md](junior.md) — The three concurrency profiles, enabling rates, your first contention hunt, basic `runtime/trace`
- [middle.md](middle.md) — Workflow: when to reach for which profile, reading mutex/block output, trace.out navigation, continuous profiling
- [senior.md](senior.md) — `pprof.Do` and goroutine labels, custom trace tasks/regions, diff-profiling lock contention, Pyroscope/Parca/Polar Signals
- [professional.md](professional.md) — Sampler internals, trace event protocol, fleet-wide profiling architecture, profile-guided optimisation
- [specification.md](specification.md) — Sampler contracts and trace event guarantees
- [interview.md](interview.md) — Concurrent-profiling questions for senior performance roles
- [tasks.md](tasks.md) — Hands-on labs: contention hunt, slow channel, trace task instrumentation, label-driven debugging
- [find-bug.md](find-bug.md) — Real bugs found via mutex profile, block profile, and trace
- [optimize.md](optimize.md) — Recipes for removing hot synchronisation, sharding locks, reducing channel cost
