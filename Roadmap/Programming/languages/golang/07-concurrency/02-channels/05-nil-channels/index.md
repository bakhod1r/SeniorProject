---
layout: default
title: Nil Channels
parent: Channels
grand_parent: Concurrency
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/02-channels/05-nil-channels/
---

# Nil Channels

[← Back](../)

A `nil` channel is the zero value of any channel type — `var ch chan int` gives you one. Sends and receives on it block **forever**, and closing it **panics**. That looks like a footgun and often is — but the same property turns nil channels into a precision tool inside `select`: assign `nil` to a case's channel and the runtime stops considering it, giving you a clean way to "disable" a branch without restructuring the loop. This subsection covers the surface semantics, the runtime's view (`chansend`/`chanrecv` short-circuits), the intentional "off switch" pattern, and the bugs that follow from accidentally-nil channels.

## Sub-pages

- [junior.md](junior.md) — What a nil channel is, why it blocks, close-panic, first uses in `select`
- [middle.md](middle.md) — The "disable this case" pattern, comparison with closed channels, dispatcher loops
- [senior.md](senior.md) — Architectural use: pipelines that disable upstreams, fan-in shutdown, backpressure modulation
- [professional.md](professional.md) — `chansend`/`chanrecv` source paths, `gopark(WaitReasonChanNil)`, runtime invariants
- [specification.md](specification.md) — Formal Go spec excerpts: zero value of channels, send/receive on nil, `close` on nil
- [interview.md](interview.md) — Interview Q&A from junior to staff on nil channels
- [tasks.md](tasks.md) — Hands-on exercises: build a select-disable loop, fan-in with shutdown, periodic publisher
- [find-bug.md](find-bug.md) — Bug hunts: forgotten initialisations, leak via nil receive, close-on-nil panics
- [optimize.md](optimize.md) — Replace flag-driven `select` branches with nil-channel disabling, prune dead receive cases
