---
layout: default
title: Ticker
parent: Time-Based Concurrency
grand_parent: Go
ancestor: Concurrency
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/16-time-based-concurrency/01-ticker/
---

# time.Ticker

[← Back](../)

A `time.Ticker` delivers a value on a channel at a steady interval. It is the canonical Go primitive for periodic work: heartbeats every five seconds, telemetry flushes every minute, polling a database every two hundred milliseconds, garbage-collecting an in-memory cache every hour. On the surface it is a three-line API — `NewTicker`, `Stop`, and the receive-only channel `C`. Underneath sits the runtime timer heap, monotonic clocks, the post-Go 1.23 GC semantics, and a long list of subtle traps: a forgotten `Stop` leaks a goroutine, a slow consumer silently drops ticks, a `Reset` race can deliver a stale value, and naive use of `time.After` inside a `select` allocates a fresh timer every loop iteration.

This subsection takes the ticker apart from the surface API down to the runtime four-heap timer implementation. By the end you should be able to use `Ticker` correctly in any production code base, reason about its delivery semantics under load, and choose between `Ticker`, `time.AfterFunc`, `time.NewTimer`, and an external scheduler when the trade-offs matter.

## Sub-pages

- [junior.md](junior.md) — `NewTicker`, the `C` channel, why `Stop` is mandatory, the simple `for { select { case <-t.C: ... } }` loop, common first-time mistakes.
- [middle.md](middle.md) — `Reset` semantics from Go 1.15 onwards, monotonic clock guarantees, the difference between drift and jitter, dynamic intervals, integration with `context.Context`.
- [senior.md](senior.md) — Runtime internals: the four-heap timer scheduler, `runtimeTimer` struct layout, channel-buffer change in Go 1.23, edge cases of `Reset`/`Stop`, why `time.After` in a loop is wrong.
- [professional.md](professional.md) — Production patterns: heartbeats, telemetry pipelines, jittered ticks for thundering-herd avoidance, backpressure when consumers are slow, observability and metrics, real incidents and post-mortems.
- [specification.md](specification.md) — Reference: full API surface, runtime guarantees, memory-model rules around `t.C`, Go 1.23 timer GC behaviour, source-level pointers into the standard library.
- [interview.md](interview.md) — 30+ graded interview questions covering semantics, traces, design, and debugging.
- [tasks.md](tasks.md) — Hands-on exercises for building tickers, jittered tickers, drift-corrected loops, and adaptive intervals.
- [find-bug.md](find-bug.md) — Broken ticker snippets: forgotten `Stop`, `Reset` race, slow consumer, leaked goroutine, miscalculated drift.
- [optimize.md](optimize.md) — Scenarios for reducing wakeups, batching ticks, replacing tickers with one-shot `AfterFunc`, and consolidating multiple periodic jobs.

## Learning Objectives

After working through every file in this subsection you should be able to:

- Explain what a `time.Ticker` is, when to use it, and when it is the wrong tool.
- Write a correct ticker loop that respects cancellation, never leaks, and tolerates slow consumers.
- Choose between `NewTicker`, `time.Tick`, `time.AfterFunc`, and `time.NewTimer` based on lifetime requirements.
- Use `Reset` safely after Go 1.15, and describe what changed in Go 1.23 around channel buffering and GC.
- Distinguish *drift* (cumulative timing error over many ticks) from *jitter* (random variance per tick), and decide when either matters.
- Recognise the monotonic-clock guarantees the runtime provides and why `Ticker` is immune to wall-clock jumps.
- Avoid the textbook pitfalls: ticker started before consumer, slow consumer dropping data, ticker stored in a long-lived struct without `Stop` on disposal, `time.After` in a loop.
- Design jittered tickers to avoid thundering-herd behaviour in distributed systems.
- Read pprof and runtime metrics to verify a ticker is not leaking.
- Read the relevant parts of `runtime/time.go` and `time/tick.go` confidently.

## Prerequisites

- Comfort with goroutines, channels, and `select`. Start with [`/Roadmap/.../07-concurrency/01-goroutines/01-overview/`](../../01-goroutines/01-overview/) and [`/Roadmap/.../07-concurrency/03-channels/`](../../03-channels/) if these feel hazy.
- Familiarity with the `context.Context` cancellation pattern. Tickers almost always live inside a context-aware loop.
- Basic understanding of `time.Duration`, `time.Now`, and the difference between wall-clock and monotonic time. The [`time` package overview](../../../09-stdlib/01-time/) covers this.
- A Go installation, version 1.20 or newer for `Reset` examples, version 1.23 or newer for the channel-buffer semantics that change behaviour at edge cases.

If you can write a goroutine that consumes from a channel until a `done` channel closes, you have everything you need to begin.

## How To Read This Subsection

The files are graded. Each one assumes the previous level's material is internalised but it does not duplicate it. If you are completely new to periodic work in Go, read in order:

1. `index.md` (this file).
2. `junior.md` to learn the surface API and the simplest correct loop.
3. `middle.md` to add `Reset`, drift, jitter, and dynamic intervals.
4. `senior.md` to understand the runtime implementation and reason about edge cases.
5. `professional.md` for production patterns and incident stories.
6. `specification.md` as a reference.
7. `interview.md`, `tasks.md`, `find-bug.md`, `optimize.md` for active practice.

If you only need a refresher, jump to `specification.md` or to the cheat-sheet at the end of `professional.md`. If you are debugging a real ticker bug, start with `find-bug.md` — the bug you are chasing is almost certainly one of the twelve listed there.

## Related Topics

- [`02-afterfunc`](../02-afterfunc/) — `time.AfterFunc` for one-shot delayed callbacks without a ticker.
- [`03-timer-leaks`](../03-timer-leaks/) — Common leak shapes for both `Timer` and `Ticker`, plus detection techniques.
- [`04-exponential-backoff`](../04-exponential-backoff/) — Variable-interval scheduling on top of `time.Timer`.
- [`05-debounce-throttle`](../05-debounce-throttle/) — Throttling event streams with tickers and `select`.
- [`../../11-context/`](../../11-context/) — `context.Context` cancellation, the standard companion to any long-lived ticker loop.
- [`../../03-channels/`](../../03-channels/) — Buffered and unbuffered channels, the substrate `Ticker.C` builds on.

## A Short Working Example

If you want to see the whole shape on one screen before diving in:

```go
package main

import (
    "context"
    "fmt"
    "time"
)

func heartbeat(ctx context.Context, interval time.Duration) {
    t := time.NewTicker(interval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case now := <-t.C:
            fmt.Println("alive at", now)
        }
    }
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
    defer cancel()
    heartbeat(ctx, 500*time.Millisecond)
}
```

That snippet contains every rule worth memorising: `NewTicker`, `defer Stop()`, `select` with `ctx.Done()` first, and a single receive from `t.C`. Everything else in this subsection explains why each line is the way it is, and what happens when you deviate.
