---
layout: default
title: Index
parent: Timer Leaks
grand_parent: Time-Based Concurrency
ancestor: Go
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/16-time-based-concurrency/03-timer-leaks/
---

# Timer Leaks

[← Back](../)

Timer leaks are one of the quietest, most expensive bugs in long-running Go services. A typical leak does not crash the process, does not show up in test runs, and does not produce a stack trace — yet for every hour the service runs, a few more megabytes of heap, a few more entries in the runtime timer heap, and a few more goroutines slowly accumulate. By the time the operator notices, the cause is buried under months of normal traffic.

The classic culprit is `time.After`. It looks innocuous:

```go
select {
case msg := <-ch:
    handle(msg)
case <-time.After(5 * time.Second):
    return ErrTimeout
}
```

Inside a long-lived loop where `ch` usually wins, this code allocates a new `*time.Timer` on every iteration, drops the reference, and waits for the timer to fire on its own before the runtime can collect it. Multiply by a hot loop, multiply by an inbound RPC, multiply by months of uptime — and you have a leak. Even worse, before Go 1.23 the runtime kept the timer's underlying memory alive through the internal timer heap, so even garbage-collected references could not free the timer body until it had fired or been stopped explicitly.

This subsection unpacks the entire family of timer-related leaks: `time.After` in loops, `time.Tick` (which has no `Stop` at all), `time.NewTicker` left running after a goroutine exits, `time.AfterFunc` callbacks holding closures alive, and the subtle interplay between `Stop`, `Reset`, and a timer that has already fired. We trace the bug from the surface symptom (rising RSS, growing `runtime.MemStats.HeapAlloc`, pprof showing a forest of `time.NewTimer` allocations) all the way down to the runtime's timer wheel and the changes Go 1.23 made to let unreferenced timers be collected like any other object.

## Sub-pages

- [junior.md](junior.md) — The `time.After` leak: what it is, why it leaks, how to fix it with `NewTimer` and `Stop`
- [middle.md](middle.md) — `NewTimer` / `Stop` / `Reset` patterns, the false-leak `default` myth, and `select { case <-time.After(d): }` inside loops
- [senior.md](senior.md) — Internals: the timer heap, pre-1.23 pinning, the Go 1.23 timer GC fix, and reading runtime traces for timer pressure
- [professional.md](professional.md) — Production: pprof heap profiles for timer leaks, `runtime.MemStats` watchpoints, `goleak` integration, telemetry, and real incident postmortems
- [specification.md](specification.md) — Formal spec excerpts: `time.After`, `NewTimer`, `Stop`, `Reset`, `Ticker`, `AfterFunc`, and version differences
- [interview.md](interview.md) — 30–40 interview Q&A from junior to staff
- [tasks.md](tasks.md) — 15–20 hands-on exercises for spotting and fixing timer leaks
- [find-bug.md](find-bug.md) — 10–12 bug-finding snippets across all timer APIs
- [optimize.md](optimize.md) — 8–10 optimization scenarios: convert `time.After` to reusable timers, batch timeouts, and share one timer per workload
