---
layout: default
title: Preemption
parent: Scheduler Deep Dive
grand_parent: Concurrency
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/10-scheduler-deep-dive/02-preemption/
---

# Goroutine Preemption

How the Go runtime takes the CPU back from a running goroutine. Pre-1.14 Go relied on **cooperative** preemption — the compiler inserted a stack-bound check at every function prologue, and a long-running goroutine without function calls could hang the world. Go 1.14 introduced **asynchronous** preemption: `sysmon` notices a goroutine has held a P for more than 10 ms and sends `SIGURG` to the thread, the signal handler rewrites the saved PC to land on `asyncPreempt`, and on resume the goroutine yields to the scheduler.

This subsection covers both mechanisms in depth: the prologue check, the morestack path, the signal-based trampoline, safe-points, and the explicit `runtime.Gosched` / `runtime.Goexit` API.

## Levels

| File | Focus |
|---|---|
| [junior.md](junior.md) | What preemption is, why it matters, `runtime.Gosched` |
| [middle.md](middle.md) | Cooperative vs async preemption side by side |
| [senior.md](senior.md) | Safe-points, GC preemption, write-barrier interaction |
| [professional.md](professional.md) | `asyncPreempt` assembly trampoline, sysmon path, per-arch signals |
| [specification.md](specification.md) | Proposal 24543, runtime files, ABI contracts |
| [interview.md](interview.md) | Common questions and crisp answers |
| [tasks.md](tasks.md) | Hands-on exercises |
| [find-bug.md](find-bug.md) | Diagnose preemption-related stalls |
| [optimize.md](optimize.md) | Tune programs around preemption costs |

## Key takeaway

Preemption is the answer to the question *"who decides when my goroutine stops running?"* Before 1.14, the goroutine itself did, at function-call boundaries. After 1.14, the runtime can interrupt at almost any instruction. Knowing which mechanism is in play — and what disables it — is the difference between debugging a stall and staring at it.
