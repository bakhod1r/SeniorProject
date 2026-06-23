---
layout: default
title: Livelock
parent: Deadlock Livelock Starvation
grand_parent: Concurrency
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/08-deadlock-livelock-starvation/02-livelock/
---

# Livelock in Go

> Goroutines that are not blocked, that burn CPU, that look healthy in every profiler — and that make no real progress. This is livelock.

A **livelock** is the worst kind of "stuck" because it does not announce itself. Your runtime is busy. Your scheduler is busy. Your CPU graphs show 100% load. Nothing is panicking. Nothing is reporting "all goroutines are asleep." And yet, work-per-second is zero. Every goroutine is politely yielding, retrying, backing off, and stepping on every other goroutine's toes, forever.

This section covers livelock in the form Go programs hit it most often: spinning CAS loops on a shared atomic, retry-on-conflict patterns that never break the tie, lock-back-off schemes that resynchronise on every retry, and distributed coordination algorithms where votes never settle.

After this section you will be able to:

- Define livelock precisely and tell it apart from deadlock and starvation.
- Recognise the polite-people analogy and map it to real Go code.
- Build a livelock on purpose with CAS, with retry loops, and with back-off-and-retry mutex schemes.
- Detect livelock with `pprof` CPU profiles and runtime metrics.
- Cure livelock with random jitter, priority, exponential back-off, and algorithm changes.
- Use `github.com/cenkalti/backoff` correctly and write your own jitter primitives.
- Reason about livelock at distributed-systems scale: Paxos contention, snapshot loops, leader thrash.

Continue to [junior.md](junior.md) for the foundations or jump straight to [interview.md](interview.md) if you are preparing for a senior systems interview.
