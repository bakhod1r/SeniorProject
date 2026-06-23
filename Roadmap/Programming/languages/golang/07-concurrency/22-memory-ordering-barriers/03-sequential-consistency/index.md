---
layout: default
title: Sequential Consistency
parent: Memory Ordering Barriers
grand_parent: Concurrency
ancestor: Go
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/22-memory-ordering-barriers/03-sequential-consistency/
---

# Sequential Consistency

[← Back](../)

Sequential consistency (SC) is the strongest, most intuitive memory model: every operation appears to execute one at a time, in some global total order that is consistent with each goroutine's program order. Go's revised memory model (Go 1.19+) commits to **SC for data-race-free programs** (SC-DRF) and gives `sync/atomic` operations sequentially-consistent semantics — a stronger guarantee than C/C++'s relaxed, acquire-release, or seq-cst opt-in levels. This subsection explores Lamport's original definition, the happens-before relation that derives SC, why Go chose SC over weaker models, and what that means for atomics, fences, and barrier-free code.

## Sub-pages

- [junior.md](junior.md) — What SC means intuitively, simple counter examples, and why "what you wrote is what happens" only holds for race-free code
- [middle.md](middle.md) — SC-DRF in Go 1.19, sync/atomic guarantees, comparison with relaxed and acquire-release, when SC actually costs you
- [senior.md](senior.md) — Formal model: Lamport SC, happens-before, total orders, store buffer effects on x86/ARM/RISC-V, and how SC is implemented under the hood
- [professional.md](professional.md) — Compiler-level enforcement, fence emission strategy, contrasts with Java/C++/Rust memory models, and TSO/PSO/RMO hardware mappings
- [specification.md](specification.md) — Verbatim Go memory model excerpts, atomic operation guarantees, and language-lawyer text
- [interview.md](interview.md) — Interview questions from junior to staff on SC, ordering, and atomic semantics
- [tasks.md](tasks.md) — Hands-on exercises building SC-dependent algorithms (Dekker, Peterson, store-buffer litmus tests)
- [find-bug.md](find-bug.md) — Bug-finding exercises with subtle reordering, missing fences, and false SC assumptions
- [optimize.md](optimize.md) — Optimization exercises measuring SC cost and choosing weaker primitives where safe
