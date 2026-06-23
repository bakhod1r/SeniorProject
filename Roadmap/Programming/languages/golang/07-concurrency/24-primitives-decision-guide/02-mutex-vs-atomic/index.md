---
layout: default
title: Mutex vs Atomic
parent: Primitives Decision Guide
grand_parent: Concurrency
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/24-primitives-decision-guide/02-mutex-vs-atomic/
---

# Mutex vs Atomic

[← Back](../)

`sync.Mutex` and `sync/atomic` solve the same problem — preventing data races on shared memory — but they sit at very different levels. A mutex protects an arbitrary critical section: as long as the lock is held, you can read and write any fields, in any order, with any compound logic, and other goroutines wait. An atomic operates on a single machine word, in a single instruction, and never blocks: it either succeeds immediately (a load, store, add) or loops on its own (a CAS retry). The cost of an atomic on amd64 is one `LOCK`-prefixed instruction (~20-30 cycles); the cost of an uncontended mutex is two atomics plus some bookkeeping (~50-80 cycles); the cost of a contended mutex is a futex syscall plus a goroutine park/unpark (~1-3 microseconds). Choosing between them is the most common micro-decision in concurrent Go code, and getting it wrong produces either a data race (atomic when you needed a mutex) or wasted CPU (mutex on a hot counter).

This subsection lays out the rule: **if the invariant fits in one machine word, use atomic; if it spans multiple fields or multiple steps, use a mutex.** It covers every operation `sync/atomic` exposes (Load, Store, Add, CompareAndSwap, Swap on int32/int64/uint32/uint64/uintptr/unsafe.Pointer, plus the Go 1.19 typed atomics `atomic.Int32`, `atomic.Bool`, `atomic.Pointer[T]`, `atomic.Value`), the lock-free patterns that fall out of them (lock-free counter, lock-free pointer publish, RCU-style snapshot, CAS-loop linked-list head insert), and the traps that punish the wrong choice (mixed atomic and non-atomic access to the same word, the 32-bit ARM alignment trap, the ABA problem, lost updates in non-CAS atomic add). By the end you should be able to walk into any concurrent hot path and answer "mutex or atomic?" in seconds, with a defensible argument.

## Sub-pages

- [junior.md](junior.md) — What atomic ops are, the atomic-or-protected rule, single-word vs multi-field invariants, simple counter and flag examples
- [professional.md](professional.md) — Lock-free patterns in production (Prometheus client_golang counters, route-table snapshot updates, RCU), refactoring mutex to atomic for hot paths, cache-line padding
- [specification.md](specification.md) — Go memory model statements on `sync/atomic`, the Go 1.19 typed atomic proposal, alignment rules on 32-bit platforms
- [interview.md](interview.md) — 30+ interview questions on atomic vs mutex, CAS semantics, ABA, alignment, performance trade-offs
- [tasks.md](tasks.md) — Implement a lock-free counter, a CAS-based lock-free stack, benchmark atomic vs mutex on a hot counter
- [find-bug.md](find-bug.md) — Mixed atomic/non-atomic access, 32-bit alignment crashes, ABA in linked-list CAS, lost updates via non-atomic load-modify-store
- [optimize.md](optimize.md) — When to switch mutex to atomic, benchmark methodology, false sharing and cache-line padding around hot atomics
