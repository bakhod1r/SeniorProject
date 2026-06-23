---
layout: default
title: Deterministic Testing
parent: Testing Concurrent Code
grand_parent: Concurrency
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/13-testing-concurrent-code/02-deterministic-testing/
---

# Deterministic Testing

[← Back](../)

Concurrent tests are flaky by default because the Go scheduler picks a different interleaving every run. A test that passes 99 times in a row and fails on the 100th is not a stable test — it is a slow-motion outage. Deterministic testing is the discipline of writing concurrent tests that produce the same result on every machine, every CPU count, and every load. The toolbox covers explicit synchronisation barriers, fake clocks instead of real time, single-goroutine drivers, the new `testing/synctest` package introduced in Go 1.24, repeat-runs (`-count=N`) for flake detection, and a hard rule: never `time.Sleep` inside a test. This subsection takes you from rewriting your first flaky test to building a CI pipeline that catches non-determinism before it ships.

## Sub-pages

- [junior.md](junior.md) — Why concurrent tests flake, the no-`time.Sleep` rule, channels and WaitGroups as test barriers, first flaky-test rewrite
- [middle.md](middle.md) — `testing/synctest` (Go 1.24+), fake clocks, dependency-injecting `time.Now`, quiescent-state testing
- [senior.md](senior.md) — Designing testable concurrent APIs, deterministic-testing patterns across goroutines, fuzz seeds, CI flake budgets
- [professional.md](professional.md) — `synctest` internals, scheduler bubble semantics, building your own deterministic harness
- [specification.md](specification.md) — Exact contract of `testing/synctest`, `Run`, `Wait`, time isolation rules
- [interview.md](interview.md) — Questions on flakiness sources, `synctest` semantics, when to use fake clocks
- [tasks.md](tasks.md) — Hands-on exercises: rewriting flaky tests, building barriers, using `synctest`
- [find-bug.md](find-bug.md) — Diagnosing real flaky tests and tracing the root cause to a scheduler assumption
- [optimize.md](optimize.md) — Speeding deterministic tests up: virtual time, fewer goroutines, parallel `synctest` bubbles
