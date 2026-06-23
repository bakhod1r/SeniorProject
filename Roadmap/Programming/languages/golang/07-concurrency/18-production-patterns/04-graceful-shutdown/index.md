---
layout: default
title: Graceful Shutdown
parent: Production Patterns
grand_parent: Concurrency
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/18-production-patterns/04-graceful-shutdown/
---

# Graceful Shutdown

[← Back](../)

A graceful shutdown is the orderly transition from "serving traffic" to "exited" without dropping in-flight requests, corrupting state, or leaking resources. In a long-lived Go service this means trapping signals (`SIGINT`, `SIGTERM`), propagating cancellation through `context.Context`, calling `http.Server.Shutdown` to drain active requests, releasing dependencies in reverse-startup order, and bounding the whole process with a deadline so a stuck handler cannot block the pod forever. In a Kubernetes deployment it also means cooperating with `terminationGracePeriodSeconds`, `preStop` hooks, and the readiness-probe gate that removes the pod from Service endpoints before traffic stops arriving.

## Sub-pages

- [junior.md](junior.md) — Signals, `context.WithCancel`, `http.Server.Shutdown`, draining one server cleanly
- [middle.md](middle.md) — Multiple goroutines, dependency order, `errgroup`, time budgets, real-world patterns
- [senior.md](senior.md) — Shutdown architecture: phase machines, readiness gates, load balancer drain, observability
- [professional.md](professional.md) — Kernel signals, container runtime behaviour, K8s lifecycle internals, force-kill mechanics
- [specification.md](specification.md) — Normative behaviour of `os/signal`, `net/http.Server.Shutdown`, `context`, K8s lifecycle
- [interview.md](interview.md) — Interview questions from junior to staff
- [tasks.md](tasks.md) — Hands-on exercises for signal handlers, drain loops, K8s probes
- [find-bug.md](find-bug.md) — Buggy shutdown code: missed signals, hung handlers, dropped requests, leaked goroutines
- [optimize.md](optimize.md) — Tuning shutdown latency, ordering, deadlines, and resource release
