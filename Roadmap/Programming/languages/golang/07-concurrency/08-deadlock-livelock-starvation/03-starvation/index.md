---
layout: default
title: Starvation
parent: Deadlock Livelock Starvation
grand_parent: Concurrency
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/08-deadlock-livelock-starvation/03-starvation/
---

# Starvation in Go

> A goroutine is ready to run, willing to run, eligible to run — and never runs. Or runs so rarely that, from outside, it looks broken. Other goroutines monopolise the resource it needs, and the scheduler or the lock implementation keeps choosing them. That is starvation.

Starvation is the quietest failure mode in concurrent programs. Deadlock stops everything. Livelock burns the CPU. Starvation does neither: most of the system works, throughput looks fine, the average latency looks fine. Only the tail — p99, p99.9, the unlucky request that waited a full second behind a flood of luckier ones — reveals that some goroutines are being passed over while their peers race ahead.

This section walks through every flavour of starvation a Go program can hit: unfair lock acquisition, writer starvation under read-heavy RWMutex traffic, biased channel selects, scheduler starvation in tight loops, and priority inversion across mixed-priority work. It also walks through the cures Go's runtime ships out of the box — `sync.Mutex`'s starvation mode (Go 1.9+), async preemption (Go 1.14+), the scheduler's work-stealing — and the cures you have to build yourself.

After this section you will be able to:

- Define starvation precisely and tell it apart from deadlock and livelock.
- Recognise reader-writer-lock writer starvation in profile data and in production symptoms.
- Read `sync.Mutex` source well enough to explain when it switches into starvation mode and why.
- Diagnose long-tail latency and p99 spikes with `pprof` block and mutex profiles.
- Design fair scheduling, bounded queues, anti-starvation priority queues, and read-mostly patterns where RWMutex helps rather than hurts.
- Compare Go's fairness model with the Linux CFS scheduler and explain trade-offs.

Continue to [junior.md](junior.md) for the foundations, or jump straight to [interview.md](interview.md) for senior-level interview prep.
