---
layout: default
title: Channels vs Mutexes
parent: Primitives Decision Guide
grand_parent: Concurrency
ancestor: Go
nav_order: 1
has_children: true
permalink: /roadmap/programming-languages/golang/07-concurrency/24-primitives-decision-guide/01-channel-vs-mutex/
---

# Channels vs Mutexes

[← Back](../)

Choosing between a channel and a mutex is the single most common decision in everyday Go code. Both can solve the same problems on paper, but they encode very different *intentions* and impose very different costs. A channel is an ownership transfer: data flows from one goroutine to another and the original goroutine forgets about it. A mutex is shared access: many goroutines visit the same in-place memory under the protection of a critical section. The Go proverb "do not communicate by sharing memory; share memory by communicating" is the famous summary — but it is also widely misquoted, and applying it blindly produces code that is slower, more allocation-heavy, and harder to read than the boring `sync.Mutex` it was meant to replace.

This subsection works through the choice from first principles. We benchmark uncontended and contended cases, examine where each primitive belongs (pipelines, worker pools, signalling for channels; hot counters, in-memory caches, configuration for mutexes), look at the hybrid patterns that combine both, and catalogue the anti-patterns — chan-of-1 as a mutex, mutex-protected map where a channel would model the producer/consumer cleaner, `chan struct{}` used to fan out a one-shot signal. By the end you should be able to read any Go file and explain why each `chan` or each `Mutex` is the right primitive for what it guards.

## Sub-pages

- [junior.md](junior.md) — First principles, the proverb in plain English, ownership vs shared access, small runnable examples for every pattern
- [middle.md](middle.md) — Channel patterns (pipelines, worker pools, semaphores, reply chans), mutex patterns (RWMutex, sync.Map), performance comparison
- [senior.md](senior.md) — Production decision frameworks, refactoring case studies, when to combine both, library API design implications
- [professional.md](professional.md) — Real benchmarks, war stories, microbenchmark traps, refactoring case studies, channel internals vs mutex internals
- [specification.md](specification.md) — Go memory model excerpts on channel and mutex semantics, sync package godoc statements, channel semantics from the spec
- [interview.md](interview.md) — 30+ interview questions from junior to staff level
- [tasks.md](tasks.md) — Hands-on exercises: worker pool both ways, semaphore both ways, benchmark and compare
- [find-bug.md](find-bug.md) — Buggy snippets: close-on-send panic, copied mutex, unprotected map, chan-of-1 mutex, etc.
- [optimize.md](optimize.md) — Performance scenarios: atomic > mutex > channel, RWMutex shootouts, sync.Map vs map+mutex
