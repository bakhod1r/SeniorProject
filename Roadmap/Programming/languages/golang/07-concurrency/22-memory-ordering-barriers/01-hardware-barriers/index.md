---
layout: default
title: Hardware Barriers
parent: Memory Ordering Barriers
grand_parent: Concurrency
ancestor: Go
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/22-memory-ordering-barriers/01-hardware-barriers/
---

# Hardware Memory Barriers

[← Back](../)

Hardware memory barriers (also called *fences*) are CPU instructions that constrain the order in which a processor and its caches make memory operations visible to other cores. They are the lowest layer beneath every higher-level synchronization primitive: a Go `sync.Mutex`, a `sync/atomic.Store`, a channel send — at the bottom they all compile into some combination of barrier-bearing instructions (`MFENCE`, `XCHG`, `LOCK`-prefixed RMW on x86; `DMB ISH`, `LDAR`, `STLR` on ARM; `fence rw,rw` on RISC-V). Without these, store buffers, invalidate queues, and out-of-order execution would reorder loads and stores in ways that break every concurrent algorithm you have ever written.

This subsection explains, step by step, what a memory barrier actually *is* at the silicon level, how the major architectures (x86-TSO, ARMv8, RISC-V WMO, POWER) differ, and how the Go runtime — in particular `sync/atomic` and `runtime/internal/atomic` — picks the right barrier on each platform. By the end you should be able to read a `go tool objdump` of an atomic call and explain exactly which microarchitectural buffer is being drained.

## Sub-pages

- [junior.md](junior.md) — What a barrier is, why reordering happens, the four fence types (LL/LS/SL/SS), simple x86 and ARM examples, store buffers and invalidate queues
- [middle.md](middle.md) — x86-TSO formal model, ARMv8 acquire/release loads and stores, `MFENCE` vs `LOCK` prefix, `runtime/internal/atomic` mapping, false sharing and cache-line ping-pong
- [senior.md](senior.md) — Memory consistency models compared (SC, TSO, PSO, RMO, WMO, RC), RISC-V `RVWMO`, the cumulative `fence` instruction, MESI/MOESI protocol interactions, Linux kernel barrier macros and how Go mirrors them
- [professional.md](professional.md) — Microarchitectural deep dive: load/store queues, memory order buffer (MOB), TSO replays, write combining, non-temporal stores, RDTSC fencing, formal verification with Herd7 and the cat models, designing fence-free fast paths
- [specification.md](specification.md) — Normative excerpts from Intel SDM Volume 3A §8, ARM ARM §B2, RISC-V ISA Manual §A, the Go memory model on hardware mapping
- [interview.md](interview.md) — 30+ interview questions from junior to staff
- [tasks.md](tasks.md) — Hands-on exercises with `go test -race`, `go tool objdump`, and `perf` counter analysis
- [find-bug.md](find-bug.md) — Snippets where missing or wrong barriers cause subtle bugs visible only on weakly-ordered CPUs
- [optimize.md](optimize.md) — Scenarios where replacing a strong barrier with a weaker one (or eliminating it entirely) yields measurable speedup
