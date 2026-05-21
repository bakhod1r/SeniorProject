---
layout: default
title: Steady-State
parent: Production Patterns
grand_parent: Concurrency
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/18-production-patterns/06-steady-state/
---

# Steady-State

[← Back](../)

A Go service is in **steady-state** when it can run for hours, days, or weeks without drifting. The resident set does not grow. Goroutine count returns to baseline after every spike. Queues do not creep upward. File descriptors close as fast as they open. Latency at the ninety-ninth percentile does not get worse on day three than it was on day one. Steady-state is the opposite of the slow leak: the kind of failure that does not show up in load tests because load tests are too short. It is the difference between a deploy that survives a week-long traffic ramp and a deploy that quietly drifts toward an out-of-memory crash on a Saturday morning. Steady-state is engineered, not assumed: bounded queues, soft memory caps, goroutine budgets, connection pool sizing, leak budgets, and saturation metrics are the levers that keep a long-running service in equilibrium.

## Sub-pages

- [junior.md](junior.md) — What steady-state means, the simplest bounded-worker example, a primer on `GOMEMLIMIT`, and how to read goroutine and heap numbers in pprof
- [middle.md](middle.md) — Bounded queues with shed-on-full vs block-on-full, per-tenant semaphores, connection pool tuning for `sql.DB`, `http.Transport`, and gRPC `ClientConn`, leak budgets, and accounting
- [senior.md](senior.md) — Architecture: `GOGC` tuning under sustained load, slow-decline failure modes (FD exhaustion, deadline drift, allocator fragmentation), saturation metrics and alerting, building a chaos harness for steady-state
- [professional.md](professional.md) — Production war stories — six-day OOM, queue creeping at 0.1 percent per hour, connection pool fragmenting under failover — plus `GOMEMLIMIT` and cgroup integration, `runtime/metrics` pipelines, and per-shard isolation
- [specification.md](specification.md) — Excerpts and pointers: `runtime/debug.SetMemoryLimit`, `SetGCPercent`, `runtime/metrics`, the `GOMEMLIMIT` proposal (golang/go#48409), and standard-library guidance
- [interview.md](interview.md) — Twenty-five-plus questions from junior to staff: what is `GOMEMLIMIT`, how to bound a hot queue, which metrics indicate drift, and how to design a steady-state contract for a multi-tenant service
- [tasks.md](tasks.md) — Hands-on exercises: write a bounded worker pool with a leak budget, build a `runtime/metrics` instrumentation layer, build a CI-friendly leak detector
- [find-bug.md](find-bug.md) — Eight to ten code snippets with steady-state bugs: unbounded buffers, per-request goroutine spawns with no cap, missing connection close, slow ticker leak, FD drift
- [optimize.md](optimize.md) — Tuning playbook: `GOGC` vs `GOMEMLIMIT` trade-offs, channel buffer sizing under bursty load, queue depth as a control signal, runtime knob priorities

## What You Will Learn

By the end of this section you will be able to:

- Define steady-state in concrete, measurable terms — not as a vague feeling that the service is healthy.
- Set `GOMEMLIMIT` from a cgroup memory limit and pick `GOGC` to match the latency vs cost trade-off.
- Bound any in-process queue with a capacity and a shed-on-full policy.
- Cap goroutine concurrency with a `chan struct{}` semaphore or a worker pool.
- Tune `sql.DB.SetMaxOpenConns`, `http.Transport.MaxIdleConnsPerHost`, and gRPC keepalive so that the connection pool reaches a flat plateau and stays there.
- Distinguish a true leak (unbounded growth) from a leak budget (small, bounded growth that is expected and reset by deploys).
- Use `runtime/metrics`, `pprof`, and OS-level FD counters to build a saturation dashboard.
- Recognise the four classic slow-decline failure modes and design alerts that catch each one before they page anyone.

## How To Use These Pages

The pages are arranged from foundational to deep:

1. Read **junior.md** to see the simplest steady-state example and learn how to read memory and goroutine numbers.
2. Read **middle.md** to apply bounded queues, semaphores, and pool tuning to a real service.
3. Read **senior.md** to design steady-state at the architecture level — saturation metrics, alert thresholds, chaos harnesses.
4. Read **professional.md** for the deepest scenario: post-mortems and the patterns that emerged from them.
5. Use **specification.md** as a quick reference for `runtime/debug` and `runtime/metrics`.
6. Use **interview.md** to test yourself or to prepare for hiring conversations.
7. Use **tasks.md** for hands-on practice.
8. Use **find-bug.md** and **optimize.md** for code-review style exercises.

## Prerequisites

- Go 1.19 or newer for `GOMEMLIMIT` (1.21+ recommended for the broader `runtime/metrics` surface).
- Comfort with goroutines, channels, and `context.Context`.
- Familiarity with `sync.WaitGroup`, `sync.Mutex`, and the basics of the Go memory model.
- Optional: experience with `net/http`, `database/sql`, gRPC, or any production observability stack.

## Why This Pattern Matters

A service that does not enter steady-state is a service that has a hidden countdown. Sometimes the countdown is hours (a leak that crashes the pod overnight), sometimes weeks (drift that crosses an alarm threshold on a quiet Saturday). The cost is invisible until it fires: pages at three in the morning, deploy windows turned into firefighting sessions, customers seeing tail-latency spikes that nobody can reproduce on staging. Steady-state engineering is the discipline that converts these long-tail failure modes into bounded, observable, alertable conditions. A few weeks of design and metrics work pays back across years of clean, boring, predictable production.

## Relationship to Other Production Patterns

Steady-state sits alongside several sibling patterns in this section. Each is a different facet of long-running service correctness:

- **Backpressure** (sibling 04) — the mechanism that lets a slow consumer slow down a fast producer. Steady-state depends on backpressure to keep queues bounded.
- **Drain pattern** (sibling 05) — the wind-down protocol on shutdown. Steady-state and drain share infrastructure: bounded queues, deadlines, graceful close.
- **Retry and circuit breaker** (related sections) — defences against upstream failure. Steady-state requires them to prevent retry storms.
- **Observability** (related sections) — the dashboards and alerts that make steady-state measurable. Without observability, steady-state is unverifiable.

Read these sections together. Each closes one class of failure that the others depend on.

## A Closing Note

Steady-state engineering is one of the quietest disciplines in software. Its product is the absence of incidents, the boredom of the on-call rotation, the deploy that ships without a hiccup. Nothing about it is heroic; everything about it is engineered.

If you are new to long-running services, start with junior. If you are mid-career, the middle and senior pages contain the patterns you most likely already need but have not seen written down. If you are senior or staff, the professional page's war stories will be familiar enough to validate your experience and instructive enough to add to your catalogue.

Pick a service, audit it against these patterns, and ship a calmer system.

Boring is the goal.
