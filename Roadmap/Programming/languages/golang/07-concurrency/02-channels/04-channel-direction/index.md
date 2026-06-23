---
layout: default
title: Channel Direction
parent: Channels
grand_parent: Concurrency
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/02-channels/04-channel-direction/
---

# Channel Direction

[← Back](../)

We narrow channels at the type level. A bidirectional `chan T` can be implicitly converted to a send-only `chan<- T` or a receive-only `<-chan T`, never the other way. Direction is enforced by the compiler, not the runtime, and it is the cheapest, loudest way to express a contract: "this function only produces values" or "this function only consumes them." Get this right and whole categories of bugs disappear before the program ever runs.

## Sub-pages

- [junior.md](junior.md) — Syntax, `chan<- T`, `<-chan T`, function signatures, first patterns, closing rules
- [middle.md](middle.md) — Pipeline stages, producer/consumer separation, conversion rules, signature design
- [senior.md](senior.md) — API contracts at module boundaries, generics, ownership models, refactoring playbooks
- [professional.md](professional.md) — Compiler enforcement, type-system internals, `reflect.ChanDir`, codegen
- [specification.md](specification.md) — Formal Go spec excerpts: channel types, assignability, conversions, close rules
- [interview.md](interview.md) — Interview questions from junior to staff on directional channels
- [tasks.md](tasks.md) — Hands-on exercises for pipelines, fan-out, function signature refactors
- [find-bug.md](find-bug.md) — Bug hunts: silent type widening, illegal closes, broken contracts
- [optimize.md](optimize.md) — Optimisations: zero-cost direction, type-system as design tool, generic helpers
