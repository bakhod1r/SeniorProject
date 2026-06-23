---
layout: default
title: Sleep for Synchronization
parent: Concurrency Anti-Patterns
grand_parent: Concurrency
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/15-concurrency-anti-patterns/06-sleep-for-sync/
---

# Sleep for Synchronization

[← Back](../)

`time.Sleep` is not a synchronization primitive. Using `go work(); time.Sleep(100 * time.Millisecond); assert(...)` to wait for a goroutine to finish is the single most common cause of flaky concurrent Go tests, and the source of subtle production bugs whenever an engineer types `time.Sleep` instead of reaching for a channel, a `WaitGroup`, or a `context.Context`. The chosen duration is always wrong: it is either too short (test fails on slow CI), too long (test wastes wall-clock time and CPU), or both at once (flaky and slow). This subsection takes the anti-pattern apart, shows why sleep-based "synchronization" cannot be made correct by tuning, and walks through the deterministic replacements — `sync.WaitGroup`, channels, `context.Context`, `errgroup`, mocked clocks, and `testing/synctest` — that should replace every `time.Sleep` in your test suite.

## Sub-pages

- [junior.md](junior.md) — The anti-pattern, why arbitrary durations are wrong, "never `time.Sleep` in tests" mantra, first replacements
- [middle.md](middle.md) — The full replacements playbook: WaitGroup, channels, context, errgroup, fake clocks, polling helpers
- [senior.md](senior.md) — Architecture-level consequences, observable quiescence, structured concurrency, eradication strategies for legacy suites
- [professional.md](professional.md) — Scheduler interaction, virtual time inside `testing/synctest`, runtime cost of sleep in hot paths
- [specification.md](specification.md) — What the language and runtime guarantee about `time.Sleep`, monotonic clock, and timer accuracy
- [interview.md](interview.md) — Questions from "what is wrong with this test" to "rewrite a flaky retry test without `time.Sleep`"
- [tasks.md](tasks.md) — Hands-on exercises: convert sleep-based tests to deterministic equivalents
- [find-bug.md](find-bug.md) — Twenty-plus broken programs and tests where `time.Sleep` hides the bug
- [optimize.md](optimize.md) — Optimization exercises: cut suite runtime by eliminating sleep, measure flakiness reduction
