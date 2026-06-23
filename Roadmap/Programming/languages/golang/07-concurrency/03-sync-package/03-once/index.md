---
layout: default
title: sync.Once
parent: Sync Package
grand_parent: Concurrency
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/03-sync-package/03-once/
---

# sync.Once

[← Back](../)

`sync.Once` is the smallest synchronisation primitive in the standard library that solves the biggest problem in concurrent initialisation: "run this function exactly once, no matter how many goroutines race to call it." It is the engine behind lazy singletons, on-first-use caches, deferred package setup, and the new Go 1.21 helpers `OnceFunc`, `OnceValue`, and `OnceValues`.

This subsection covers the API, the happens-before guarantee that makes lazy reads safe, the implementation (atomic fast path plus mutex slow path), and the most common anti-pattern — using `Once` to retry on failure. Then we look at when `Once` is the wrong tool: when package `init()` would be cleaner, when a `sync.Map` already gives you per-key initialisation, and when you should reach for `atomic.Pointer` instead.

## Sub-pages

- [junior.md](junior.md) — First contact: `Do`, lazy singletons, why `defer once.Do` is wrong
- [middle.md](middle.md) — `OnceFunc`, `OnceValue`, `OnceValues` from Go 1.21, error handling, panic recovery
- [senior.md](senior.md) — Comparison with `init()`, `sync.Map`, `atomic.Pointer`, design trade-offs
- [professional.md](professional.md) — Internals: `done uint32`, atomic load fast path, mutex slow path, memory model
- [specification.md](specification.md) — Formal API contract, happens-before guarantees, references
- [interview.md](interview.md) — Interview questions and answers from junior to staff
- [tasks.md](tasks.md) — Hands-on exercises: singletons, lazy caches, OnceValue, deadlock avoidance
- [find-bug.md](find-bug.md) — Bug hunts: panicking init, retry-after-failure, copied Once, recursive Do
- [optimize.md](optimize.md) — Replacing `Once` with `atomic.Pointer`, double-checked locking, when to skip it
