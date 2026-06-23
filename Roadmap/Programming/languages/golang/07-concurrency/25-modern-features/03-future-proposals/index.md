---
layout: default
title: Future Concurrency Proposals
parent: Modern Concurrency Features
grand_parent: Concurrency
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/25-modern-features/03-future-proposals/
---

# Future Concurrency Proposals

Go's concurrency model is mature but not frozen. A steady stream of proposals — some
experimental, some accepted, some rejected, some still under discussion — shapes the next
decade of concurrent Go code.

This subsection surveys the proposals that have a real chance of changing how you write
goroutines, channels, and synchronization in production: `testing/synctest` (experimental in Go
1.24, expected stable in Go 1.25, issue [#67434](https://go.dev/issue/67434)) for deterministic
concurrency tests; `iter.Pull`/`iter.Pull2` and the `runtime.coro` mechanism (Go 1.23) that
quietly introduced user-mode coroutines as the backing for range-over-func iterators;
`weak.Pointer` and `runtime.AddCleanup` (Go 1.24, issues
[#67552](https://go.dev/issue/67552) and [#67535](https://go.dev/issue/67535)) for safer cache
and finalizer patterns; atomic vector op proposals (issue family around
[#50860](https://go.dev/issue/50860)); automatic `GOMAXPROCS` detection from cgroup quotas
(issue [#33803](https://go.dev/issue/33803) and friends); discussions around goroutine-local
storage (long-standing [#21355](https://go.dev/issue/21355)); and structured concurrency
primitives where `go` statements would block until children finish (issues
[#40221](https://go.dev/issue/40221) and [#61888](https://go.dev/issue/61888)).

For each proposal you'll learn the status (experimental, proposed, declined), the motivation,
the design sketch, the expected impact on your code, and an honest view on whether it will
land.

Because much of this material is speculative, you won't find a senior or middle tier here. The
split is just junior (survey of the proposals) and professional (how to prepare codebases
today), plus the usual specification, interview, tasks, find-bug, and optimize files.

Treat code samples as "what it might look like" rather than "what to ship": APIs marked
experimental can and do change between Go releases, and proposals can be declined years after
they look settled. The goal is to make you legible to architects who plan two Go versions
ahead and to senior engineers who need to decide whether to write a polyfill, wait, or
refactor pre-emptively.

## Sub-pages

- [junior.md](junior.md) — Survey of upcoming proposals, what each tries to solve, simple
  before/after sketches
- [professional.md](professional.md) — Production impact, polyfill strategies, how to write
  code that will migrate cleanly
- [specification.md](specification.md) — Summaries and excerpts of the actual proposal docs,
  accepted/declined/experimental status
- [interview.md](interview.md) — Forward-looking interview questions on future Go concurrency
- [tasks.md](tasks.md) — Try out `testing/synctest`, write a weak-pointer polyfill, build a
  coroutine with `iter.Pull`
- [find-bug.md](find-bug.md) — Common mistakes when adopting experimental features early
- [optimize.md](optimize.md) — Performance implications of upcoming features
