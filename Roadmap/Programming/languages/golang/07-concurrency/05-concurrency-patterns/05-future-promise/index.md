---
layout: default
title: Future / Promise Pattern
parent: Concurrency Patterns
grand_parent: Concurrency
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/05-concurrency-patterns/05-future-promise/
---

# Future / Promise Pattern

[← Back](../)

We explore the future/promise pattern in Go: a placeholder for a value that will arrive later. Go has no built-in future type by design — instead you build one with a goroutine and a buffered channel of capacity one. We cover the canonical result-channel idiom, a generic `Future[T]` type using Go 1.18+ generics, deferred promises, error propagation, fan-in combinators (`AwaitAll`, `AwaitAny`), composition (map, flat-map, chain), comparison with JavaScript Promises, Java `CompletableFuture`, Rust `Future`, and C++ `std::future`, and the reason Go's designers preferred explicit goroutines plus channels over implicit async/await.

## Sub-pages

- [junior.md](junior.md) — What a future is, the result-channel idiom, capacity-1 buffering, your first async call
- [middle.md](middle.md) — Generic `Future[T]`, error pairs, `AwaitAll`, `AwaitAny`, cancellation, `errgroup`
- [senior.md](senior.md) — Memoization, deferred execution, composition, cross-language comparison, design judgement
- [professional.md](professional.md) — Production future systems: API aggregators, RPC fan-out, request hedging, cache stampede control
- [specification.md](specification.md) — Formal contract of a future, happens-before edges, idempotence rules
- [interview.md](interview.md) — Interview questions and answers from junior to staff
- [tasks.md](tasks.md) — Hands-on exercises for writing, fixing, and composing futures
- [find-bug.md](find-bug.md) — Bug-finding exercises with broken future code
- [optimize.md](optimize.md) — Reducing allocations, fast paths, pool-backed futures, batching
