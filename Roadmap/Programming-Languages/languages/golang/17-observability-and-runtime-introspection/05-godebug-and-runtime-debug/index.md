---
layout: default
title: GODEBUG & runtime/debug
parent: Observability & Runtime Introspection
grand_parent: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/17-observability-and-runtime-introspection/05-godebug-and-runtime-debug/
---

# GODEBUG & runtime/debug

[← Back](../)

We explore the two complementary mechanisms Go gives you to observe and steer the runtime: the `GODEBUG` environment variable, which sets startup-time knobs on the runtime and standard library (and, since Go 1.21, gates backward-incompatible behavior changes), and the `runtime/debug` package, which exposes the same surface programmatically — GC and memory-limit controls, goroutine stack dumps, heap dumps, build-info extraction, and crash-output hooks. `GODEBUG` is the external, no-recompile dial; `runtime/debug` is the in-process API.

## Sub-pages

- [junior.md](junior.md) — What GODEBUG is, reading `gctrace`/`schedtrace`, and first `runtime/debug` calls
- [middle.md](middle.md) — The Go 1.21 GODEBUG compatibility system, `//go:debug`, `SetMemoryLimit` vs `SetGCPercent`
- [senior.md](senior.md) — Operating GODEBUG/runtime/debug in production: memory limits, crash output, rollout strategy
- [professional.md](professional.md) — How the settings are wired internally; non-default-behavior metrics; build provenance
- [specification.md](specification.md) — Authoritative reference: the GODEBUG history table, `runtime/debug` API surface
- [interview.md](interview.md) — Interview questions and answers from junior to staff
- [tasks.md](tasks.md) — Hands-on exercises (easy → hard)
- [find-bug.md](find-bug.md) — Bug-finding exercises with GODEBUG and runtime/debug misuse
- [optimize.md](optimize.md) — Using these knobs to tune GC, memory, and diagnostics workflows
