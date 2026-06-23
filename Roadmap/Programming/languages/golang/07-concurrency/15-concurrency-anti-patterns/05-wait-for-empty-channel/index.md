---
layout: default
title: Wait-for-Empty-Channel
parent: Concurrency Anti-Patterns
grand_parent: Concurrency
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/15-concurrency-anti-patterns/05-wait-for-empty-channel/
---

# Wait-for-Empty-Channel Anti-Pattern

> Polling `len(ch) > 0` to "wait until everyone is done" is the channel equivalent of `time.Sleep` for synchronisation: it almost works, until it does not — and when it does not, the bug is always a race.

This subsection collects every variant of the pattern: spinning on `len(ch)`, polling with `cap(ch)`, busy-waiting with `select`/`default`, and the assumption that an empty channel means "work finished." None of these compose. All of them have a correct replacement: `close` + `for range`, a `done` channel, or `sync.WaitGroup`.

Read [junior.md](junior.md) first for the full 29-section catalogue with refactor playbook. The other files go deeper:

- [middle.md](middle.md) — the formal race, memory model implications, and four production case studies.
- [senior.md](senior.md) — designing systems that never need `len(ch)`: ownership, lifecycles, structured shutdown.
- [professional.md](professional.md) — auditing legacy codebases, migration strategy, performance impact at scale.
- [specification.md](specification.md) — language specification quotes, what `len` and `cap` actually return, why they cannot synchronise.
- [interview.md](interview.md) — 40 interview questions across four bands.
- [tasks.md](tasks.md) — 30 exercises from "spot the polling loop" to "refactor a 600-line legacy worker pool."
- [find-bug.md](find-bug.md) — 25 broken programs.
- [optimize.md](optimize.md) — 12 performance comparisons: busy-wait vs `range`, CPU and latency numbers.

If you only remember one thing from this subsection: **`len(ch)` is a debug aid, not a synchronisation primitive.**
