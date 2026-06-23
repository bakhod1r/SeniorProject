---
layout: default
title: Structured Concurrency
parent: Modern Concurrency Features
grand_parent: Concurrency
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/25-modern-features/02-structured-concurrency/
---

# Structured Concurrency

Structured concurrency is the principle that the lifetime of a concurrent task is
bound to a syntactic scope. When the scope exits, every goroutine launched inside it
has finished, succeeded, failed, or been cancelled. There are no orphans, no
forgotten background workers, no goroutines that outlive the function that started
them. Go does not have structured concurrency baked into the language the way
Kotlin, Swift, or Python's Trio do, but the `golang.org/x/sync/errgroup` package and
careful use of `context.Context` give us a workable approximation that the rest of
this section explores in depth.

## Sub-pages

- [Junior](./junior/) — what "structured" means, the bare-`go` problem, first taste of `errgroup`.
- [Middle](./middle/) — `errgroup` source walk-through, `WithContext`, `SetLimit`, `TryGo`, cross-language framing.
- [Senior](./senior/) — designing a structured-concurrency scope, cancellation propagation, the "go expression" proposals.
- [Professional](./professional/) — production rules: never bare `go`, panic-safe goroutines, supervision trees.
- [Specification](./specification/) — `errgroup` godoc excerpts, source pointers, Russ Cox notes, cross-language references.
- [Interview](./interview/) — 25+ questions and answers on the topic.
- [Tasks](./tasks/) — build a scope, rewrite bare-`go` code, leak-test with `goleak`.
- [Find the Bug](./find-bug/) — diagnose leaks, missing cancellation, races, unrecovered panics.
- [Optimize](./optimize/) — `errgroup` vs hand-rolled `WaitGroup`, `SetLimit` semantics, when to pick what.
