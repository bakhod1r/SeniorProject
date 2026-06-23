---
layout: default
title: Index
parent: AfterFunc
grand_parent: Time-Based Concurrency
ancestor: Go
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/16-time-based-concurrency/02-afterfunc/
---

# time.AfterFunc

[← Back](../)

`time.AfterFunc(d, f)` schedules the function `f` to run, **in its own goroutine**, after at least `d` has elapsed on the monotonic clock. It is the simplest "do this thing later" primitive in the Go standard library — no channel, no select, no manual goroutine. The return value, a `*time.Timer`, lets you cancel (`Stop`) or reschedule (`Reset`) the callback before it fires.

It looks trivial. In practice it is the source of an outsized share of production incidents in Go services:

- callbacks that fire **after** the surrounding context has been cancelled,
- `Stop` returning `false` because the timer already fired and the callback is now running on another goroutine,
- `Reset` called on an expired timer leaving a stale callback in flight,
- timers that pin objects in memory because the closure captures a request,
- panics inside the callback that kill the whole process because no one recovers in the spawned goroutine,
- millions of timers in the runtime heap because each request creates one and never stops it.

This subsection is a graded, deep tour of `time.AfterFunc` — from "schedule a thing in five seconds" to "we run ten million live timers per node and here is how we keep the heap quiet." It also covers `context.AfterFunc` (Go 1.21), the modern, well-behaved cousin that fixes most of the leak hazards.

## Learning Objectives

After working through this subsection you will be able to:

- Schedule one-shot callbacks with `time.AfterFunc` and understand exactly *which goroutine* runs the callback.
- Read the return values of `Stop` and `Reset` correctly and write race-free cancellation code.
- Avoid the classic "Stop returned true but the callback is already running" trap.
- Use `Reset` safely: when it is sound, when it returns a meaningless boolean, and the standard pattern for `Stop`-then-`Reset`.
- Recognise leaks: timers that capture large objects, timers that outlive their context, timers in long-running maps.
- Replace ad-hoc `time.After` patterns with `AfterFunc` to cut allocations and goroutines.
- Use `context.AfterFunc` (Go 1.21) for deadline-driven callbacks that are automatically cleaned up.
- Build watchdogs, request deadlines, idle-connection sweepers, and rate-limiter triggers on top of `AfterFunc`.
- Reason about the underlying timer heap (`runtime/time.go`), buckets, and the cost of millions of timers.
- Diagnose production timer issues via heap profiles, `runtime.NumGoroutine`, and `GODEBUG=schedtrace`.

## Sub-pages

- [junior.md](junior.md) — What `AfterFunc` is, the simplest examples, `Stop` basics, and the first wave of mistakes
- [middle.md](middle.md) — `Reset` semantics, callback runs in its own goroutine, racing `Stop` against fire, and `context.AfterFunc`
- [senior.md](senior.md) — Internals: the timer heap, `runtimeTimer`, when the callback is scheduled, `Stop`/`Reset` return value semantics
- [professional.md](professional.md) — Production: deadlines, deferred cleanup, rate-limiter triggers, watchdogs, observability, postmortems
- [specification.md](specification.md) — Reference: API surface, `Stop` semantics, `Reset` semantics, runtime guarantees, `context.AfterFunc`
- [interview.md](interview.md) — 30–40 graded interview questions and answers
- [tasks.md](tasks.md) — 15–20 hands-on exercises
- [find-bug.md](find-bug.md) — 10–12 bug-hunting snippets — `Stop`-vs-fire races, `Reset` leaks, callback panics
- [optimize.md](optimize.md) — 8–10 optimization scenarios — replace ticker+select with `AfterFunc`, batch timers, reduce allocations

## Prerequisites

- Comfort with goroutines (`07-concurrency/01-goroutines`)
- Basic channel use (`07-concurrency/02-channels`)
- Familiarity with `time.Duration`, `time.Time`, and the monotonic clock (`07-concurrency/16-time-based-concurrency/01-timers-and-tickers`)
- Awareness of `context.Context` cancellation

## How to read this subsection

Each file is self-contained. If you are new to `AfterFunc`, start at `junior.md` and read in order. If you already use it in production and only want the internals or the postmortems, jump straight to `senior.md` and `professional.md`. The `specification.md` page is a quick reference you will come back to — bookmark it.

Throughout the subsection, code examples assume Go 1.21 or newer. Where a feature is version-specific (notably `context.AfterFunc`, introduced in 1.21) it is called out.

## Version highlights

A quick orientation on the Go-version landscape:

- **Go 1.0:** `time.AfterFunc`, `Stop`, `Reset` released.
- **Go 1.10:** monotonic clock; wall-clock adjustments no longer perturb timers.
- **Go 1.14:** async preemption; long-running callbacks can be preempted.
- **Go 1.21:** `context.AfterFunc` introduced.
- **Go 1.22:** loop variable scoping fixed (affects closures in for-loops).
- **Go 1.23:** internal timer simplification; `Reset` no longer needs a drain dance for channel timers.
- **Go 1.24:** `testing/synctest` for deterministic time tests.

The bulk of the material in this subsection works on Go 1.18+. Where Go 1.21+ features (`context.AfterFunc`) or 1.22+ semantics (loop variables) appear, the version requirement is noted.

## What you'll *not* find here

This subsection focuses on `time.AfterFunc` and the closely related `context.AfterFunc`. The following are touched on tangentially but covered in their own subsections:

- `time.Ticker` — see `03-tickers`.
- `time.Sleep` and `time.After` — see `01-timers-and-tickers`.
- `context.WithTimeout` and `context.WithDeadline` — see `04-context-with-deadline`.

If your question is "how do I do X with timers?", the right subsection often depends on whether the trigger is a duration, a tick, or a context cancellation.

## Pace recommendation

Junior file: ~3 hours of focused reading + 1 hour of experimentation.
Middle file: ~3 hours + 2 hours of pattern practice.
Senior file: ~4 hours + at least 2 hours of source code reading.
Professional file: ~4 hours + one full incident walk-through.
Specification, interview, tasks, find-bug, optimize: ~2 hours each.

Total: about 30 hours to read everything thoroughly. You don't need to do this in one sitting. Use as a reference.
