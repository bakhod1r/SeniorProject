---
layout: default
title: sync.OnceFunc/OnceValue/OnceValues
parent: Modern Concurrency Features
grand_parent: Concurrency
ancestor: Go
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/25-modern-features/01-sync-oncefunc/
---

# sync.OnceFunc, OnceValue, OnceValues (Go 1.21+)

[← Back](../)

For a decade the canonical way to run something exactly once in Go was the same five-line ritual: declare a `var once sync.Once`, declare the function you actually wanted to call once, and then call `once.Do(func() { realThing() })` at every site that might be first. The pattern works, but it scatters two pieces of state across the file — the `Once` and the function — and every caller has to remember to use `Do`. If the function needs to return a value, you also have to hoist that value into a package-level variable, with all the visibility and zero-value questions that come with it.

Go 1.21 closed this gap with three helpers in `sync`: `OnceFunc(f func()) func()`, `OnceValue[T any](f func() T) func() T`, and `OnceValues[T1, T2 any](f func() (T1, T2)) func() (T1, T2)`. Each one accepts a function and returns a wrapper. The wrapper, when called from any number of goroutines, runs `f` exactly once and caches the result; subsequent calls return the cached value (or, for `OnceFunc`, just return). If `f` panics, every future call re-panics with the same value — a deliberate departure from the older `sync.Once.Do` behavior, which left the `Once` "consumed" but did not propagate the panic to later callers. The wrappers also drop their reference to `f` after the first call, so any state captured in the closure can be garbage-collected.

This subsection covers how the three helpers work, when to use each one, the panic-reuse contract that distinguishes them from raw `sync.Once`, the small allocation cost they trade for the readability win, and the patterns they replace in real codebases. Use these instead of hand-rolled `sync.Once` whenever a function fits the shape "run once, optionally return a value" — which, in practice, is almost every use of `sync.Once` ever written.

## Sub-pages

- [junior.md](junior.md) — Why sync.Once is awkward, how OnceFunc/OnceValue/OnceValues replace the pattern, runnable examples
- [professional.md](professional.md) — Production usage: idempotent cleanup, lazy package init, replacing sync.Once boilerplate, panic semantics
- [specification.md](specification.md) — Godoc verbatim, proposal #56102, panic-reuse contract
- [interview.md](interview.md) — 20+ questions on OnceFunc vs Once, panic behavior, goroutine safety, GC implications
- [tasks.md](tasks.md) — Rewrite sync.Once as OnceFunc, build a lazy config loader, observe panic-reuse behavior
- [find-bug.md](find-bug.md) — Closure return-value pitfalls, reassigned wrappers, broken panic recovery
- [optimize.md](optimize.md) — Allocation overhead of OnceFunc vs hand-rolled sync.Once, benchmarks
