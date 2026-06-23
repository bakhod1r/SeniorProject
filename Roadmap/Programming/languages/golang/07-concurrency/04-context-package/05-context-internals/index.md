---
layout: default
title: Context Internals
parent: Context Package
grand_parent: Concurrency
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/04-context-package/05-context-internals/
---

# Context Internals

[← Back](../)

We open the `context` package and read every line that matters: the four-method interface, the six concrete types in `src/context/context.go`, the singleton roots, the `cancelCtx` workhorse with its children map and `propagateCancel` watcher, the `timerCtx` extension, the linear `valueCtx` lookup, and the Go 1.21+ additions `withoutCancelCtx`, `afterFuncCtx`, and `stopCtx`. We trace where allocations happen, when goroutines are spawned, why `Value` is O(n) and `Err` is O(1), and how the package compares to futures in C++, Java, and Rust.

## Sub-pages

- [junior.md](junior.md) — A friendly first tour of the interface and the four context shapes
- [middle.md](middle.md) — The `cancelCtx` struct, `propagateCancel`, `removeChild`, lazy `Done` allocation
- [senior.md](senior.md) — `timerCtx`, `valueCtx`, Go 1.21 additions, `AfterFunc`, `WithoutCancel` internals
- [professional.md](professional.md) — Walk the full source: every type, every method, allocation accounting
- [specification.md](specification.md) — The formal contract every implementation must obey
- [interview.md](interview.md) — Internal-mechanism interview questions from junior to staff level
- [tasks.md](tasks.md) — Exercises reproducing context internals from scratch
- [find-bug.md](find-bug.md) — Bugs that only appear when you understand the internals
- [optimize.md](optimize.md) — Performance work informed by knowing the data structures
