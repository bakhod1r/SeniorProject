---
layout: default
title: Preventing Goroutine Leaks
parent: Goroutine Lifecycle and Leaks
grand_parent: Concurrency
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/07-goroutine-lifecycle-leaks/03-preventing-leaks/
---

# Preventing Goroutine Leaks

[Back](../)

Detection finds leaks after they happen. Prevention makes them impossible in the first place. The previous section showed how to spot a leaking goroutine in production; this section is about the design choices, patterns, and review habits that mean the leak never ships. Every goroutine needs an articulated exit story: who owns it, what signals it to stop, what does it do on cancellation, and how does its caller know it has stopped. When those four answers are written down — in code, not in folklore — leaks become a rare incident rather than a weekly fire.

## Sub-pages

- [junior.md](junior.md) — The five leak patterns and their canonical fixes, the owner rule, basic `context` discipline
- [middle.md](middle.md) — Structured concurrency with `errgroup`, the Start/Stop struct pattern, lifecycle testing with goleak
- [senior.md](senior.md) — Library design so leaks are impossible, code review checklist, real-world examples (HTTP shutdown, Kafka consumer group)
- [professional.md](professional.md) — Architectural patterns: supervisors, lifecycle managers, audit at scale
- [specification.md](specification.md) — What Go guarantees about cancellation, channel close, and exit semantics
- [interview.md](interview.md) — Interview questions on preventing leaks and designing leak-free APIs
- [tasks.md](tasks.md) — Exercises: refactor leaky code, build a leak-proof worker, add goleak to a project
- [find-bug.md](find-bug.md) — Bugged programs where prevention failed; diagnose, fix, and harden
- [optimize.md](optimize.md) — Reduce shutdown latency, minimise cancellation overhead, fast leak triage

See also: [02-detecting-leaks](../02-detecting-leaks/), [04-pprof-tools](../04-pprof-tools/), [01-goroutines/05-best-practices](../../01-goroutines/05-best-practices/).
