---
layout: default
title: GOMAXPROCS Tuning
parent: Scheduler Deep Dive
grand_parent: Concurrency
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/10-scheduler-deep-dive/03-gomaxprocs-tuning/
---

# Tuning `GOMAXPROCS`

[← Back](../)

`GOMAXPROCS` is the single most-asked-about scheduler knob and the single most-misconfigured one in production. It sets the number of P structs the runtime allocates — equivalently, the maximum number of OS threads that may run user-level Go code in parallel. Since Go 1.5 the default has been `runtime.NumCPU()`; since 1.16 the runtime started honouring cgroup v1 CPU quotas on Linux; since 1.18 it honours cgroup v2 as well. Yet container deployments still routinely report `GOMAXPROCS=64` inside a pod with `cpu: 500m`, and bare-metal services still hard-code `runtime.GOMAXPROCS(128)` "for headroom". This section is the playbook: when to leave the default alone, when to override, what `procresize()` does at runtime (it is a stop-the-world!), what `go.uber.org/automaxprocs` adds, and how to size against CPU-bound vs I/O-bound workloads, NUMA topologies, and noisy-neighbour shared hosts.

## Sub-pages

- [junior.md](junior.md) — What `GOMAXPROCS` is, the default, how to read and set it, why the default is usually right
- [middle.md](middle.md) — Containers, cgroups, automaxprocs, CPU-bound vs I/O-bound sizing, NUMA basics
- [senior.md](senior.md) — Production policy, observability, autosetting, benchmark-driven tuning across workloads
- [professional.md](professional.md) — `procresize()`, the STW path, sources in `runtime/proc.go`, comparison with Java and Tokio
- [specification.md](specification.md) — Documented behaviour of `runtime.GOMAXPROCS`, env var precedence, cgroup detection rules
- [interview.md](interview.md) — Interview questions covering defaults, container traps, runtime cost of resizing
- [tasks.md](tasks.md) — Hands-on tasks: build a sweep harness, log GOMAXPROCS, write a cgroup detector
- [find-bug.md](find-bug.md) — Bugs caused by mis-tuned GOMAXPROCS in real production code
- [optimize.md](optimize.md) — Benchmark-driven tuning recipes, GOMAXPROCS sweeps on web services, NUMA splits
