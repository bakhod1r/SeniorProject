---
layout: default
title: hchan Struct
parent: Channel Internals
grand_parent: Concurrency
ancestor: Go
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/09-channel-internals/01-hchan-struct/
---

# The `hchan` Struct

[← Back](../)

When you write `make(chan T, N)` the compiler does not invent a new language primitive — it allocates a plain Go struct named `hchan` defined in `src/runtime/chan.go`. Every channel in every Go program in the world is a pointer to one of these structs. The struct carries the ring buffer, the two wait queues of parked goroutines, the closed flag, the element type descriptor, and the runtime spin-mutex that protects all of them. Once you know the layout of `hchan` you can answer almost every "what really happens when I send or receive" question without guessing.

## Sub-pages

- [junior.md](junior.md) — A friendly first tour of `hchan` and what `make(chan T, N)` actually allocates
- [middle.md](middle.md) — Field-by-field walk-through, the ring buffer, and how `chansend`/`chanrecv` use them
- [senior.md](senior.md) — `waitq`, `sudog`, the runtime mutex, cache-line concerns, and compiler lowering
- [professional.md](professional.md) — Walk the real `runtime/chan.go` source: `makechan`, `chansend`, `chanrecv` line by line
- [specification.md](specification.md) — The invariants `hchan` maintains and the contract `make`, `<-`, and `close` must honor
- [interview.md](interview.md) — Internal-mechanism interview questions from junior to staff level
- [tasks.md](tasks.md) — Exercises that reproduce parts of `hchan` from scratch
- [find-bug.md](find-bug.md) — Bugs that only appear when you understand the struct
- [optimize.md](optimize.md) — Performance work informed by `hchan` layout and the spin-mutex
