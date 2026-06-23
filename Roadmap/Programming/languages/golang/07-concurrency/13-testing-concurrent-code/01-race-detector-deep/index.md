---
layout: default
title: Race Detector Deep Dive
parent: Testing Concurrent Code
grand_parent: Concurrency
ancestor: Go
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/13-testing-concurrent-code/01-race-detector-deep/
---

# Race Detector Deep Dive

[← Back](../)

The race detector is the single most valuable tool for verifying concurrent Go code. It is a compile-time instrumentation pass plus a runtime library — Google's ThreadSanitizer (TSan) — wrapped behind one flag: `-race`. When you build with `-race`, every memory access in your program is augmented with a call into the TSan runtime, which tracks happens-before relationships across goroutines using a technique called shadow memory. If two goroutines touch the same address without an ordering edge between them, the runtime prints a report with both stack traces and stops the world long enough for you to read it. This subsection covers what the detector finds, what it deliberately misses, how it works under the hood, what overhead it costs, how to run it in CI, and how to read its output fluently.

## Sub-pages

- [junior.md](junior.md) — What `-race` is, how to run it, sample report, what it does and does not catch
- [middle.md](middle.md) — Integrating `-race` into local workflows and CI, `-count=1`, build tags, race vs deadlock
- [senior.md](senior.md) — Pipeline design, sharded race jobs, race-only test suites, production sampling, halt-on-error
- [professional.md](professional.md) — TSan shadow memory algorithm, vector clocks, compiler instrumentation, runtime ABI
- [specification.md](specification.md) — Exact contract of `-race`: what TSan guarantees, supported platforms, environment variables
- [interview.md](interview.md) — Questions about race semantics, overhead, false positives, and tool comparisons
- [tasks.md](tasks.md) — Hands-on exercises: writing races that the detector catches and races it misses
- [find-bug.md](find-bug.md) — Reading real race reports and tracing them back to the offending line
- [optimize.md](optimize.md) — Reducing overhead, sharding race jobs, sampling, and selective instrumentation
