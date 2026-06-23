---
layout: default
title: WaitGroup in Tests
parent: Testing Concurrent Code
grand_parent: Concurrency
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/13-testing-concurrent-code/03-waitgroup-in-tests/
---

# WaitGroup in Tests

[← Back](../)

A test that fires off goroutines and then asserts on shared state is, by default, a coin flip. The runtime is free to schedule the spawned goroutine after the assertion has already run, after the test function has returned, or — worst of all — after the next test has started. The cure is a synchronisation barrier inside the test itself: a `sync.WaitGroup`, a `done` channel guarded by `select` with a timeout, a `t.Cleanup` that drains live workers, or a `goleak.VerifyNone(t)` defer that fails the test if any goroutine is still alive at the end. This subsection covers the standard `wg.Add / wg.Done / wg.Wait` pattern, a reusable `WaitTimeout` helper that turns a hung Wait into a clean test failure, the start-barrier pattern that maximises contention for race-detector runs, the `time.Sleep` antipattern that produces flaky CI, and the small set of WaitGroup bugs — missing `Add`, `Wait` before `Add`, double `Done` — that show up almost exclusively in test code.

## Sub-pages

- [junior.md](junior.md) — Why tests need barriers, basic `wg` pattern, `t.Cleanup`, no-`time.Sleep` rule (~1000+ lines)
- [middle.md](middle.md) — `WaitTimeout` helper, channels with timeout, fan-out test pattern, `goleak` integration (~600 lines)
- [senior.md](senior.md) — Start-barrier for race testing, deterministic ordering, helpers across test packages (~600 lines)
- [professional.md](professional.md) — Library internals, `testify/assert/wait`, `quicktest` patterns, harness design (~400 lines)
- [specification.md](specification.md) — Formal contract of `WaitGroup` and the testing helpers we build on top (~300 lines)
- [interview.md](interview.md) — Questions on synchronising tests, WaitGroup races, goleak (~400 lines)
- [tasks.md](tasks.md) — Hands-on exercises: rewriting sleep-based tests, building helpers, leak detection (~600 lines)
- [find-bug.md](find-bug.md) — Diagnosing missing `Add`, double `Done`, and `Wait`-before-`Add` failures in test code (~600 lines)
- [optimize.md](optimize.md) — Cutting test latency: parallel sub-tests, sized barriers, helper inlining (~500 lines)

## Related Topics

- [02-deterministic-testing](../02-deterministic-testing/) — `synctest` and the broader determinism toolbox
- [04-mocking-time](../04-mocking-time/) — Replacing real timers in tests
- [../../03-sync-package/02-waitgroups/](../../03-sync-package/02-waitgroups/) — The `WaitGroup` primitive itself
- [../../05-context-package/](../../05-context-package/) — `context.WithTimeout` as an alternative deadline source
