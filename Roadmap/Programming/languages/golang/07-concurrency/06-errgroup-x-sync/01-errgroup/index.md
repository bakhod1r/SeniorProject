---
layout: default
title: errgroup
parent: errgroup and x/sync
grand_parent: Concurrency
ancestor: Go
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/06-errgroup-x-sync/01-errgroup/
---

# errgroup

`golang.org/x/sync/errgroup` is the canonical structured-concurrency helper for Go. It bundles three responsibilities that every "do N things in parallel and collect the error" code path has to solve: spawn a fixed group of goroutines, wait for all of them, and propagate the first non-nil error while cancelling the rest. Without it, every project ends up re-implementing the same `sync.WaitGroup + chan error + context.CancelFunc` dance — usually with a leak or a race the first few times.

This section is the deep dive. We cover the four public methods (`Go`, `TryGo`, `Wait`, `SetLimit`), the `WithContext` constructor that ties cancellation to the first error, the patterns it enables (fetch-all, parallel-map, fan-out/fan-in), and the anti-patterns it does *not* automatically prevent (loop-variable capture, ignored `ctx.Done()`, post-`Wait` use of the derived context). We also dissect the internal struct so you understand exactly why "first error wins" and why `SetLimit` interacts with `TryGo`.

| File | Audience | Focus |
|------|----------|-------|
| `junior.md` | First exposure | What errgroup is, why it beats manual `WaitGroup+chan`, the four methods, the `WithContext` pattern |
| `middle.md` | Production use | `SetLimit`, `TryGo`, context cancellation semantics, error wrapping, common patterns |
| `senior.md` | Production design | Bounded fan-out, partial-failure policies, integration with `semaphore` and `singleflight`, testing |
| `professional.md` | Source-level | The actual struct fields, `sync.Once` + cancel-func mechanics, race semantics, comparison with `conc.WaitGroup` |
| `specification.md` | Reference | Method-by-method contract, version history, type signatures |
| `interview.md` | Hiring | Conceptual and code questions you should be able to answer fluently |
| `tasks.md` | Practice | Exercises from "convert this WaitGroup code" up to "build a bounded crawler" |
| `find-bug.md` | Pattern recognition | Twenty broken snippets, find the bug, explain the fix |
| `optimize.md` | Performance | Limit tuning, cancellation propagation cost, allocation profile, when *not* to use errgroup |
