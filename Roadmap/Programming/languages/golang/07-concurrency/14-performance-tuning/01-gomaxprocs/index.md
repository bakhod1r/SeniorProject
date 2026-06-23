---
layout: default
title: GOMAXPROCS Tuning
parent: Performance Tuning
grand_parent: Concurrency
ancestor: Go
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/14-performance-tuning/01-gomaxprocs/
---

# `GOMAXPROCS` — Performance Tuning

[← Back](../)

This section is the **measurement-driven** counterpart to the scheduler-internals coverage in `10-scheduler-deep-dive/03-gomaxprocs-tuning`. There we explain *what* `GOMAXPROCS` is, how `procresize()` works, and how cgroup detection lands in the runtime. Here we focus on **what to do with it in production**: how to sweep it against a workload, how to interpret the throughput-vs-latency curve, where `automaxprocs` belongs in your deployment, and how to write a fleet policy that catches misconfiguration before it ships. If you have not read the scheduler-internals page yet, start there. This page assumes you can already explain G-M-P and you want a benchmark playbook.

## Sub-pages

- [junior.md](junior.md) — How `GOMAXPROCS` affects throughput and latency, your first sweep, reading the curve
- [middle.md](middle.md) — Sweep methodology, CFS quotas, NUMA basics, when CPU-bound and I/O-bound rules differ
- [senior.md](senior.md) — `automaxprocs` integration, fleet policy, CFS-throttling alerts, NUMA pinning
- [professional.md](professional.md) — Workload-aware autosetting, runtime-level tuning, kernel hooks, cross-runtime comparison
- [specification.md](specification.md) — Tuning-relevant guarantees and measurement contracts
- [interview.md](interview.md) — Tuning questions for performance-focused interviews
- [tasks.md](tasks.md) — Hands-on sweep harnesses, container measurement, autoscaler integration
- [find-bug.md](find-bug.md) — Performance bugs caused by mis-tuned `GOMAXPROCS`
- [optimize.md](optimize.md) — Heavy section: sweep recipes for web, batch, NUMA, co-tenant workloads
