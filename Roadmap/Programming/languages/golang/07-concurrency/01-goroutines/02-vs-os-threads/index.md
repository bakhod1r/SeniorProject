---
layout: default
title: Goroutines vs OS Threads
parent: Concurrency
grand_parent: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/01-goroutines/02-vs-os-threads/
---

# Goroutines vs OS Threads

[← Back](../)

A goroutine is a *user-space* unit of execution scheduled by the Go runtime. An OS thread is a *kernel* unit of execution scheduled by the operating system. They are not the same primitive at different sizes — they are different layers of the stack. Go runs many goroutines (`G`) on top of relatively few OS threads (`M`), and the Go scheduler (with `P` contexts) decides which `G` runs on which `M` and when. Understanding the differences in cost, creation, context switch, blocking behaviour, and observability is what turns "I write `go f()`" into "I know what the machine is actually doing."

## Sub-pages

- [junior.md](junior.md) — What a thread is, what a goroutine is, the headline differences, and the first time you ask "why is my Go server so much faster than my Java server?"
- [middle.md](middle.md) — Costs, blocking behaviour, syscall handoff, when threads still matter (`LockOSThread`, cgo, signals), and tuning `GOMAXPROCS`
- [senior.md](senior.md) — Architecture: choosing between a Go service, a thread-pool service, and an event-loop service; cross-language interop; thread vs goroutine in containerised production
- [professional.md](professional.md) — Internals: how the Go runtime asks the kernel for threads, how `M` is created and parked, scheduler integration with the netpoller, signal delivery to threads
- [specification.md](specification.md) — What the Go spec and runtime documentation say (and deliberately do not say) about thread mapping, plus POSIX `pthreads` and Linux `clone(2)` reference details
- [interview.md](interview.md) — Junior through staff interview questions on goroutine vs thread, M:N scheduling, syscall handling, and when to use `LockOSThread`
- [tasks.md](tasks.md) — Hands-on exercises measuring spawn cost, context-switch cost, blocking syscall behaviour, and `GOMAXPROCS` effects
- [find-bug.md](find-bug.md) — Bug-finding exercises around thread-affinity, signal handling, cgo blocking, and OS-resource leaks that wear a goroutine disguise
- [optimize.md](optimize.md) — Optimization exercises: tuning `GOMAXPROCS`, avoiding M creation storms, reducing cgo overhead, and measuring thread count in production
