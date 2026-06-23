---
layout: default
title: Subtests (t.Run)
parent: Testing and Benchmarking
grand_parent: Go
ancestor: Programming Languages
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/07-subtests/
---

# Subtests (t.Run)

[← Back](../)

Subtests structure a single `TestXxx` function into named hierarchical cases via `t.Run(name, func(t *testing.T) {...})`. They unlock targeted `-run` filtering, per-case parallelism, isolated `t.Cleanup` stacks, and clearer `-v` output. This section covers semantics, the Go 1.22 loop scope fix, failure propagation, and trade-offs against separate test functions.

## Sub-pages

- [junior.md](junior.md) — `t.Run` basics, naming, hierarchical names, `-run` regex filtering, simple parallel subtests
- [middle.md](middle.md) — `t.Parallel` inside subtests, the pre-Go 1.22 loop-var capture bug, `t.Cleanup` ordering, skip semantics, failure propagation
- [senior.md](senior.md) — Subtest design at scale, sharing setup across subtests, nested subtests, TestMain interaction, sharing state safely
- [professional.md](professional.md) — Production patterns, CI filtering with `-run`, subtest discoverability, structuring large suites for clarity
- [specification.md](specification.md) — `testing.T.Run` godoc, `-run` regex semantics, Go 1.22 loop scope change (issue 60078)
- [interview.md](interview.md) — 25+ interview questions on subtests and `t.Run`
- [tasks.md](tasks.md) — Hands-on exercises: convert function-per-case to subtest-per-case, write parallel subtests, debug a flaky subtest
- [find-bug.md](find-bug.md) — Common bugs: loop-var capture pre-1.22, shared state, duplicate subtest names, parent-vs-child failure leak
- [optimize.md](optimize.md) — `t.Run` overhead, when to batch into a single Test func, parallel speedup tradeoffs
