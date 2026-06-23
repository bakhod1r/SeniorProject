---
layout: default
title: WaitGroups
parent: sync Package
grand_parent: Concurrency
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/03-sync-package/02-waitgroups/
---

# WaitGroups

[← Back](../)

We explore Go's `sync.WaitGroup`: a counting barrier used to wait for a fleet of goroutines to finish. We cover the `Add`/`Done`/`Wait` triplet, the rule that `Add` must run before the goroutine starts, why a `WaitGroup` must never be copied, the panics that follow a negative counter, and how it compares with `errgroup.Group`, channels, and `sync.Once`.

## Sub-pages

- [junior.md](junior.md) — First contact: Add, Done, Wait, the `defer wg.Done()` reflex, and pointer rule
- [middle.md](middle.md) — Add-before-go pattern, struct embedding, error handling, dynamic spawn, reuse rules
- [senior.md](senior.md) — Memory model guarantees, errgroup, context cancellation, fan-out/fan-in
- [professional.md](professional.md) — Internals: state word, semaphore, race detector hooks, runtime cost
- [specification.md](specification.md) — Formal API contract from the standard library
- [interview.md](interview.md) — Interview questions and answers from junior to staff
- [tasks.md](tasks.md) — Hands-on exercises with WaitGroups
- [find-bug.md](find-bug.md) — Bug-finding exercises: copy, missing Done, racing Add, negative counter
- [optimize.md](optimize.md) — Replacing WaitGroups with channels, errgroup, batched submission
