---
layout: default
title: sync/atomic
parent: Sync Package
grand_parent: Concurrency
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/03-sync-package/07-atomic/
---

# sync/atomic

[← Back](../)

`sync/atomic` is the lowest-level synchronisation primitive in the Go standard library. It exposes a small set of operations — `Load`, `Store`, `Add`, `Swap`, `CompareAndSwap` — that the CPU executes as single, indivisible instructions. No goroutine can observe a half-updated value, no instruction reordering can rearrange the access, and no mutex is involved. The cost on modern x86 is roughly 2 nanoseconds for an uncontended atomic, against 10-30 nanoseconds for a mutex acquire/release pair.

This subsection covers the classic free-function API (`atomic.AddInt64`, `atomic.LoadPointer`, and friends), the Go 1.19 typed wrappers (`atomic.Int64`, `atomic.Bool`, `atomic.Pointer[T]`, `atomic.Value`) that finally fixed the alignment footgun and improved readability, and the patterns that build on top: lock-free counters, atomic flags, refcounting, and copy-on-write configuration via `atomic.Value`. We also examine the memory model (Go's atomics are sequentially consistent since Go 1.19), the 32-bit alignment trap for 64-bit values, the ABA problem, and how Go atomics map down to `LOCK CMPXCHG` on x86 and load-linked/store-conditional on ARM.

## Sub-pages

- [junior.md](junior.md) — First contact: why atomics exist, basic `Add`/`Load`/`Store`/`CAS`, the Go 1.19 typed API
- [middle.md](middle.md) — Memory model, alignment, atomic vs mutex vs channel decisions, `atomic.Value`
- [senior.md](senior.md) — Lock-free patterns, ABA problem, refcounting, hazard pointers, race detector interaction
- [professional.md](professional.md) — CPU instructions (`LOCK CMPXCHG`, LL/SC), cache coherence, runtime internals
- [specification.md](specification.md) — Formal API contract, memory-model guarantees, references
- [interview.md](interview.md) — Interview questions from junior to staff level
- [tasks.md](tasks.md) — Hands-on exercises: counters, flags, refcounting, lock-free stacks
- [find-bug.md](find-bug.md) — Bug hunts: mixed atomic/non-atomic access, alignment crashes, ABA, lost wakeups
- [optimize.md](optimize.md) — Reducing contention: per-CPU counters, sharding, batching, choosing the right primitive
