---
layout: default
title: Mocking Time
parent: Testing Concurrent Code
grand_parent: Concurrency
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/13-testing-concurrent-code/04-mocking-time/
---

# Mocking Time

[← Back](../)

Time is the silent dependency that ruins concurrent tests. Code that calls `time.Sleep`, `time.After`, `time.Tick`, `time.AfterFunc`, or `time.Now` directly is bound to the wall clock, so its tests pay real seconds for every retry, every TTL, every backoff. The fix is structural: factor time behind a small `Clock` interface, use a real implementation in production and a fake implementation in tests, and step the fake clock forward explicitly. The Go ecosystem offers two mature libraries — `github.com/jonboulle/clockwork` and `github.com/benbjohnson/clock` — and Go 1.24 added `testing/synctest`, which makes real `time` calls fake inside a bubble. This subsection covers the interface pattern, every library worth knowing, and the worked examples that come up daily: TTL caches, token-bucket limiters, schedulers, and retry loops.

## Sub-pages

- [junior.md](junior.md) — Why we mock time, the Clock interface, first test with `clockwork.NewFakeClock`, common pitfalls
- [middle.md](middle.md) — `BlockUntil`, `AfterFunc`, `clockwork` vs `benbjohnson/clock`, `testing/synctest` (Go 1.24+)
- [senior.md](senior.md) — Designing testable time-driven systems: schedulers, retry loops, rate limiters, distributed clock skew
- [professional.md](professional.md) — Building your own fake clock, `synctest` internals, monkey-patching trade-offs, library comparisons
- [specification.md](specification.md) — Exact `Clock` contract, `clockwork.Clock` interface, `synctest` bubble semantics
- [interview.md](interview.md) — Questions on injection design, `Advance` vs `BlockUntil`, fake-time pitfalls
- [tasks.md](tasks.md) — Hands-on exercises: TTL cache, token bucket, scheduler, retry with backoff, all under fake time
- [find-bug.md](find-bug.md) — Diagnosing flaky time-dependent tests, missing `Advance`, leaked goroutines that read real time
- [optimize.md](optimize.md) — Cutting test suite wall time from minutes to milliseconds with fake clocks
