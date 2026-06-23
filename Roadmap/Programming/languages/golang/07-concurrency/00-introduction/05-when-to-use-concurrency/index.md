---
layout: default
title: When to Use Concurrency
parent: Concurrency
grand_parent: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/00-introduction/05-when-to-use-concurrency/
---

# When to Use Concurrency

[← Back](../)

Concurrency is a tool, not a goal. The first four subsections of this introduction taught you what concurrency is, how Go's CSP model expresses it, how the GMP scheduler executes it, and what the memory model guarantees. This subsection answers a different question: *should you use concurrency at all*?

The honest answer for most code is "no." Concurrency adds complexity, bugs, and overhead. It pays off only when the workload has parallel opportunity (CPU-bound on multi-core) or hidden waiting (I/O-bound). For tight CPU loops on a single core, small workloads, and request-handling code that is already concurrent at the framework level, adding more goroutines hurts. This subsection gives you a decision framework: read the workload, identify whether concurrency helps, choose the right pattern, and stop adding goroutines past the point of diminishing returns.

## Sub-pages

- [junior.md](junior.md) — Decision framework, I/O-bound vs CPU-bound, when concurrency helps and when it hurts
- [middle.md](middle.md) — Amdahl applied, sizing pools, choosing patterns, recognising overengineering
- [senior.md](senior.md) — Architectural decisions, deadline-driven design, system-level trade-offs
- [professional.md](professional.md) — Quantitative analysis, latency tail dynamics, profiling-driven optimisation
- [specification.md](specification.md) — Bibliography of canonical references on concurrent design
- [interview.md](interview.md) — Interview questions about concurrency decision-making
- [tasks.md](tasks.md) — Hands-on decision exercises with worked examples
- [find-bug.md](find-bug.md) — Bug-finding exercises rooted in misapplied concurrency
- [optimize.md](optimize.md) — Optimization exercises that remove unnecessary concurrency
