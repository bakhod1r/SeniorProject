---
layout: default
title: Cooperative vs Forced
parent: Cancellation Deep
grand_parent: Cancellation Deep
ancestor: Go
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/20-cancellation-deep/01-cooperative-vs-force/
---

# Cooperative vs Forced Cancellation

[← Back](../)

Go has no `Thread.kill`, no `goroutine.Cancel`, no preemptive abort. Every goroutine must agree to die: the cancellation model is **cooperative**, mediated through `context.Context`, channel signals, and an unwritten contract that long-running work checks for "is it still worth doing this?" at safe points. Forced cancellation is reserved for unusual cases — OS-thread signals, process termination, CGO state machines — and each escape hatch comes with its own trapdoor.

## Sub-pages

- [junior.md](junior.md) — What "cooperative" means in practice, how context cancellation flows, and why goroutines cannot be killed from outside
- [middle.md](middle.md) — Cancellation patterns, propagating `ctx.Done()` through layers, channel-based stop signals, and bounding worker lifetime
- [senior.md](senior.md) — Designing cancellable subsystems, escape hatches via `runtime.LockOSThread` and signals, CGO cancellation pitfalls, structured shutdown
- [professional.md](professional.md) — Runtime internals: why preemption is not cancellation, how the scheduler interacts with blocking syscalls, signal-based forced cancellation, and the boundary with the kernel
- [specification.md](specification.md) — Normative references on `context`, signal semantics, and runtime documentation
- [interview.md](interview.md) — Cancellation questions from junior to staff
- [tasks.md](tasks.md) — Exercises for building cancellable workers, bounded subsystems, and forced-stop fallbacks
- [find-bug.md](find-bug.md) — Bug-finding exercises in cancellation propagation, leaked workers, and CGO cleanup
- [optimize.md](optimize.md) — Optimization of cancellation paths: fast-path checks, batched polling, and avoiding lock contention on stop
