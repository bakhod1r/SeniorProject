---
layout: default
title: When to Use sync.Cond
parent: Primitives Decision Guide
grand_parent: Concurrency
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/24-primitives-decision-guide/03-when-to-use-cond/
---

# When to Use sync.Cond

[← Back](../)

`sync.Cond` is the most-criticized primitive in the Go standard library's `sync` package. The Go team has at one point proposed deprecating it. It implements a classical condition variable — a rendezvous point for goroutines waiting on a predicate over shared state — backed by a `sync.Locker` (typically `*sync.Mutex` or `*sync.RWMutex`). The API is three methods: `Wait()` atomically releases the lock and parks the goroutine; `Signal()` wakes one waiter; `Broadcast()` wakes all waiters. It is correct, it is documented, and yet in practice nine out of ten uses are either buggy or would be clearer as a channel. This subsection explains *when* `sync.Cond` is the right tool, why it is so error-prone, and how to replace it with channels when it is not.

## Sub-pages

- [junior.md](junior.md) — What a condition variable is, the wait/signal/broadcast model, simple bounded-buffer example, the `for !cond { c.Wait() }` idiom
- [professional.md](professional.md) — When you would actually reach for Cond in production code, refactoring fragile Cond-based designs to channels, reading `io.Pipe` and `os/exec` source for real-stdlib usage
- [specification.md](specification.md) — `sync.Cond` godoc verbatim, the NoCopy field, Wait/Signal/Broadcast semantics, why Go does not have spurious wakeups but you should still wrap Wait in a loop
- [interview.md](interview.md) — 25+ questions including "when would you choose Cond over a channel" and "what is the difference between Broadcast and Signal"
- [tasks.md](tasks.md) — Implement a bounded buffer with Cond and rewrite with channels, implement once-only initialization with Cond vs `sync.Once`
- [find-bug.md](find-bug.md) — `Wait` without holding the lock, `Wait` without a loop, `Signal` instead of `Broadcast` losing wakeups, copying a Cond
- [optimize.md](optimize.md) — Cond vs channel benchmarks, when removing Cond reduces contention, coarse vs fine-grained Broadcast
