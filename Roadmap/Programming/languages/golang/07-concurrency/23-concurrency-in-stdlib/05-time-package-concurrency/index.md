---
layout: default
title: time Package Concurrency
parent: Concurrency in Stdlib
grand_parent: Concurrency
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/23-concurrency-in-stdlib/05-time-package-concurrency/
---

# time Package Concurrency

[← Back](../)

The `time` package is one of the most concurrency-heavy corners of the Go standard library. Every `time.Sleep`, every `time.After`, every `<-ticker.C` parks a goroutine on a runtime-managed timer heap, gets woken by a dedicated scheduler hook, and competes with every other timer in the program for OS resources. Behind a one-line call like `time.Sleep(time.Second)` sits a small state machine in `runtime/time.go`, a per-P timer heap reorganised on every wake, a `gopark` into the scheduler, and a platform-specific sleep primitive (`futex` on Linux, `kevent` on Darwin, `WaitForMultipleObjects` on Windows).

This subsection traces all of it. We cover what `time.Sleep` *actually* does, how `time.NewTimer`, `time.NewTicker`, and `time.AfterFunc` differ underneath, the per-P timer heap that Go 1.14 introduced to kill global-heap contention, the timer status state machine that prevents Reset/Stop races, and the Go 1.23 redesign that finally made `Reset` and `Stop` race-free in the common case and stopped timers from pinning their channels in GC roots. We end with the production patterns — leak-free tickers, replacing `time.After` in hot select loops, custom clocks for testing, monotonic-vs-wall-clock pitfalls — that every Go service eventually needs.

## Sub-pages

- [junior.md](junior.md) — `time.Sleep`, `time.After`, `time.NewTimer`, channels and goroutines for delayed work, the well-known `time.Tick` leak, basic patterns
- [middle.md](middle.md) — Walking `runtime/time.go` and `time/sleep.go`: per-P timer heaps, timer status states, `addtimer`/`deltimer`/`modtimer`, Reset/Stop semantics with real `file:line` references
- [senior.md](senior.md) — Timer heap performance, monotonic vs wall clock, `context.WithTimeout` internals (post Go 1.21 `time.AfterFunc` implementation), the Go 1.23 timer redesign, OS-level sleep precision (`futex`, `nanosleep`, `clock_nanosleep`)
- [professional.md](professional.md) — Production patterns: replacing `time.After` in hot select loops, leak-free ticker idioms, debugging time-related concurrency bugs with pprof and trace, custom clock interfaces for deterministic tests
- [specification.md](specification.md) — Normative excerpts from the `time` and `context` godocs, runtime timer comments, monotonic clock specification, Go 1.14 and Go 1.23 release notes for timers
- [interview.md](interview.md) — 30+ interview questions from junior to staff on timer mechanics, leaks, and the Go 1.23 changes
- [tasks.md](tasks.md) — Hands-on exercises: leak a ticker and find it with pprof, write a clock interface for tests, measure timer precision, benchmark `time.After` vs reused `*Timer`
- [find-bug.md](find-bug.md) — Buggy snippets: leaked ticker, `time.After` in hot loop, Reset race, ignored Stop return value, drifting ticker
- [optimize.md](optimize.md) — Performance: `time.After` vs reused `Timer`, batching ticker work, monotonic vs wall clock perf, choosing timer resolution, avoiding the timer-heap fast path
