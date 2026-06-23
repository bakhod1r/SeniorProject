---
layout: default
title: LockOSThread Performance
parent: Performance Tuning
grand_parent: Concurrency
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/14-performance-tuning/03-lockosthread/
---

# `runtime.LockOSThread` — Performance Tuning

[← Back](../)

This section is the **tuning-focused** counterpart to the semantics covered in [01-goroutines/02-vs-os-threads](../../01-goroutines/02-vs-os-threads/) and the channel-coupling discussion in [09-channel-internals](../../09-channel-internals/). There, we explain *what* `LockOSThread` does, *why* the runtime supports it, and how pinning interacts with the scheduler. Here we focus on **what pinning costs your service**: how a pinned goroutine permanently retires an M, how that interacts with `GOMAXPROCS`, when cache locality and TLS amortisation make pinning a net win, how the runtime grows new Ms to compensate, and how to measure all of it. If you have not read the semantics pages, start there. This page assumes you can already explain G–M–P and you want a measurement playbook for pinning decisions.

## Sub-pages

- [junior.md](junior.md) — What pinning costs, when to use it, a first benchmark of pinned vs unpinned
- [middle.md](middle.md) — Single-owner-goroutine pattern, channel-of-work design, cgo amortisation
- [senior.md](senior.md) — Production architectures: OpenGL, namespace switching, signal owners, capacity planning around pinned Ms
- [professional.md](professional.md) — Runtime mechanics of pinning, `tgkill` preemption cost, M growth, NUMA interaction
- [specification.md](specification.md) — Tuning-relevant guarantees of `LockOSThread`/`UnlockOSThread`
- [interview.md](interview.md) — Pinning-tuning questions and answers
- [tasks.md](tasks.md) — Hands-on benchmarks for pinned vs unpinned, single-owner pools, M-count measurement
- [find-bug.md](find-bug.md) — Performance bugs caused by accidental or excessive pinning
- [optimize.md](optimize.md) — Recipes: cgo amortisation, hot-loop pinning, GPU/OpenGL workers, signal-handler ownership
