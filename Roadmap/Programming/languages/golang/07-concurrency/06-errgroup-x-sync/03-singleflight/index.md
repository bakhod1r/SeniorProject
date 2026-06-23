---
layout: default
title: singleflight
parent: errgroup and x/sync
grand_parent: Concurrency
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/06-errgroup-x-sync/03-singleflight/
---

# singleflight

[← Back](../)

The `golang.org/x/sync/singleflight` package gives you one weapon against the cache-stampede / thundering-herd problem: when N goroutines all ask for the same expensive resource at the same time, only one of them actually does the work and the rest receive a copy of the result. The package is small (one struct, three methods) but the semantics it expresses are subtle, and the bugs it introduces — coalesced errors, key collisions, forgotten `Forget` calls — show up in production years after the initial integration. This section unpacks `Group.Do`, `Group.DoChan`, and `Group.Forget`, the `shared` return value, the canonical "TTL cache + singleflight loader" pattern, and the way real systems like groupcache, Kubernetes informers, and the Docker Engine use it under load.

## Sub-pages

- [junior.md](junior.md) — What request coalescing is, the stampede problem, your first `g.Do`, the three return values
- [middle.md](middle.md) — `DoChan`, `Forget`, error coalescing pitfalls, TTL cache integration, panic propagation
- [senior.md](senior.md) — Cancellation strategy, comparison with `LoadOrStore`, real-world usage in groupcache and Kubernetes
- [professional.md](professional.md) — Internals (`Group.m`, `call` struct), production-grade wrappers, observability
- [specification.md](specification.md) — Formal contract of a coalescing group, happens-before edges, error semantics
- [interview.md](interview.md) — Interview questions from junior to staff
- [tasks.md](tasks.md) — Hands-on exercises building loaders, hedged caches, and dedup layers
- [find-bug.md](find-bug.md) — Bug-finding exercises with broken singleflight code
- [optimize.md](optimize.md) — Tuning, allocation reduction, and when to ditch singleflight entirely
