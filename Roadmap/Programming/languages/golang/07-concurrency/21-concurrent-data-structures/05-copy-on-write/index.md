---
layout: default
title: Copy-on-Write
parent: Concurrent Data Structures
grand_parent: Concurrency
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/05-copy-on-write/
---

# Copy-on-Write

[← Back](../)

Copy-on-write (COW) is a concurrency pattern that turns a mutable shared structure into a sequence of immutable snapshots linked by a single atomic pointer. Readers grab the current snapshot with one wait-free load and traverse it without any locking, ever. Writers serialize on a writer lock, build a new snapshot off to the side, and publish it with one atomic compare-and-swap or store. Because the old snapshot is never mutated, in-flight readers continue safely; the garbage collector reclaims it when the last reader is done. In Go this pattern is realized through `sync/atomic.Value` (Go 1.4+) and the typed `sync/atomic.Pointer[T]` (Go 1.19+), and it underpins production patterns like RCU-style updates, hot-reloadable configuration, lock-free service registries, and the `crypto/tls.Config` snapshot model.

The trade-off is the inverse of what locks give you. A `sync.RWMutex` makes reads cheap *enough* (a couple of atomic operations) and writes ordinary; COW makes reads as cheap as a single atomic load, but pays for each write with a full structural rebuild and pressure on the garbage collector. This is the right trade when read traffic outnumbers writes by orders of magnitude — configuration loaded once per second served to every request, routing tables read on every packet, feature flags consulted on every API call. It is the wrong trade for a write-heavy hash table, a per-request counter, or any structure where the writer cannot tolerate the latency of rebuilding a snapshot.

The pattern looks deceptively simple — "swap a pointer" — but the surface contains real subtleties: the snapshot must be *fully* immutable (publishing a header that points to a still-mutable slice silently breaks the guarantee), the writer must coordinate with itself (concurrent writers must serialize or use a CAS loop), `atomic.Value` requires a single concrete dynamic type across all `Store` calls, and lost updates appear the moment a writer reads, modifies, and writes without holding either a mutex or a CAS retry. These pitfalls are the recurring theme of this section.

This sub-section sits inside the broader **Concurrent Data Structures** track. It assumes you have already met `sync.Mutex`, `sync.RWMutex`, `sync.Map`, and the basic operations of `sync/atomic` (`Load`, `Store`, `CompareAndSwap`). It builds on that foundation by treating *the snapshot itself*, not a critical section, as the unit of concurrency.

## What you will learn

- The mental model of "immutable snapshot + atomic pointer" and why it is wait-free for readers
- How to build COW configuration, COW maps, COW slices, and persistent structures (tries, finger trees) in idiomatic Go
- When COW outperforms `sync.RWMutex` and `sync.Map` — and when it does not
- The full memory-ordering story behind `atomic.Value` and `atomic.Pointer[T]`
- How RCU (read-copy-update) differs from naive COW and how to approximate it in Go
- How structural sharing keeps the per-write cost from blowing up
- How the garbage collector interacts with retained snapshots, and how to avoid accidental leaks
- The bugs unique to COW: snapshot mutation, lost updates, type panics on `atomic.Value.Store`, ABA, and snapshot fan-out

## Sub-pages

- [junior.md](junior.md) — What copy-on-write is, why it works, the simplest `atomic.Value` and `atomic.Pointer` examples, the first traps
- [middle.md](middle.md) — Practical COW maps and slices, when COW beats `sync.RWMutex` and `sync.Map`, snapshot semantics, write amplification
- [senior.md](senior.md) — Architecture: persistent data structures, structural sharing, RCU-style updates, generational COW, memory cost modelling
- [professional.md](professional.md) — Internals: memory ordering, `atomic.Pointer` codegen, GC interaction with retained snapshots, RCU quiescence, lock-free design constraints
- [specification.md](specification.md) — Go spec and memory-model excerpts on atomic operations, `sync/atomic.Value` / `atomic.Pointer` guarantees, happens-before edges
- [interview.md](interview.md) — Interview questions and answers from junior to staff on COW patterns and trade-offs
- [tasks.md](tasks.md) — Hands-on exercises: build a COW config, a COW slice, an RCU-style registry, a persistent trie
- [find-bug.md](find-bug.md) — Bug-finding exercises with snapshot mutation, lost updates, leaks, type confusion, and stale-snapshot races
- [optimize.md](optimize.md) — Optimization exercises: reducing copy cost, batching writes, structural sharing, snapshot pooling

## When COW is the right answer

- A **read-mostly** workload with a write-to-read ratio of 1:1000 or worse.
- The snapshot fits comfortably in memory — usually under a few hundred MB.
- Readers must not block on writers, and writers may tolerate slightly higher latency.
- Per-read latency variance must be low (no risk of an RWMutex writer stalling readers).
- The data has a clean immutability boundary (it can be deep-copied or built incrementally).

## When COW is the wrong answer

- Writes are frequent or come from many concurrent writers.
- The structure is multi-gigabyte and full copies would dominate latency and GC.
- Readers need a transactional, multi-key consistent view across multiple atomic loads.
- The structure is mutated in place by external libraries you do not control.
- You need linearizable read-modify-write semantics — use a mutex or a CAS loop on a smaller value instead.

## Position in the Go ecosystem

`atomic.Value` was added in Go 1.4 and is the historical foundation of the pattern. The typed `atomic.Pointer[T]`, `atomic.Int64`, and friends arrived in Go 1.19 and are the modern recommendation: zero boxing, zero `interface{}` overhead, no possibility of storing the wrong type. The standard library uses COW heavily — `net/http.ServeMux`, `crypto/tls.Config`, `expvar`, the runtime's PC-to-line table, and the trace buffer all use snapshot-and-publish patterns under the hood. Outside the standard library, `prometheus/client_golang`, `etcd`, `go-redis`, and most service-discovery clients rely on COW for their routing and registry layers.
