---
layout: default
title: Index
parent: When to Use a Pool
grand_parent: Goroutine Pools (3rd-party)
ancestor: Go
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/17-goroutine-pools-3rd-party/04-when-to-use/
---

# When to Use a Pool — Decision Guide

[← Back](../)

A goroutine pool is a tool, not a default. Go was designed so that you can spawn 100,000 goroutines on a laptop and the runtime will keep them happy. That is the *first* lesson of Go concurrency — but the *second* lesson is that "cheap" is not the same as "free." When you cross from a hobby project into a service that handles thousands of requests per second, holds open database connections, talks to rate-limited APIs, or churns gigabytes of memory through CPU-bound work, the unbounded `go f()` pattern starts to fail in subtle ways: OOM kills under load spikes, scheduler thrash from work-stealing across millions of runnable Gs, port exhaustion from unbounded outbound HTTP calls, downstream services flapping because your client refuses to back off.

The Go ecosystem has answered this problem with three families of tools — and the wider community has added a fourth and a fifth. Knowing which one to reach for, and *when not to reach for any of them at all*, is the single most important judgement call in a Go service's concurrency design. This sub-topic exists to give you the decision tree, the comparison data, and the production criteria to make that call confidently.

The five families, ordered from "do nothing special" to "fully featured library":

1. **Raw goroutines** — `go f()` plus `sync.WaitGroup`. Zero dependencies. Unbounded parallelism. Right answer more often than juniors expect.
2. **`golang.org/x/sync/errgroup`** — Bounded errgroup with `SetLimit`. First-class error propagation and context cancellation. The standard library's answer to "give me a pool with sensible defaults."
3. **`golang.org/x/sync/semaphore`** — A weighted semaphore. Lower level than errgroup, lets you express "this task costs 3 slots, that one costs 1."
4. **Third-party pools** — `panjf2000/ants`, `Jeffail/tunny`, `gammazero/workerpool`, `alitto/pond`, and roughly a dozen others. These persist workers across tasks (vs spawn-per-task), offer richer features (resize, metrics, panic recovery, non-blocking submit), and trade simplicity for control.
5. **Custom pool** — A few dozen lines of channel-and-worker code, tailored to one workload. Often the right answer when the workload has special needs (priorities, multiple result types, custom backpressure).

The wrong choice in either direction hurts. Pick a library pool for a workload that needed only `errgroup.SetLimit` and you have added a dependency, a panic recovery story, and a metrics surface for no measurable gain. Pick raw goroutines for a workload that needed a semaphore and you have a service that allocates without bound and gets OOM-killed at the worst moment. Pick `ants` (a non-blocking-task pool) for blocking I/O work and you have built a pool that starves under realistic load.

This subsection teaches you the decision tree from first principles, then walks through real benchmark numbers, library tradeoffs, and the production checklist that turns "I think we need a pool" into "we need this pool, sized this way, with these guardrails, for these specific reasons."

## Sub-pages

- [junior.md](junior.md) — Why pools sometimes, when raw goroutines are fine, a simple decision tree, basic side-by-side examples
- [middle.md](middle.md) — Errgroup vs pool, semaphore vs pool, choosing the pool size, when ants vs tunny vs workerpool fits the workload
- [senior.md](senior.md) — Deep comparison: API ergonomics, locking strategies, allocations per task, scheduling fairness, memory footprint per library
- [professional.md](professional.md) — Production decision criteria: SLA, backpressure, observability needs, third-party risk, dependency audit, build vs adopt
- [specification.md](specification.md) — Cross-library API surface comparison, feature matrix, version compatibility tables
- [interview.md](interview.md) — 30+ Q&A on choosing the right pool, sizing it, justifying the dependency
- [tasks.md](tasks.md) — Benchmarks across libraries, decision-matrix builder, migration exercises
- [find-bug.md](find-bug.md) — Snippets where the pool *choice* is the bug — wrong library, over-engineered, blocking pool used for non-blocking work
- [optimize.md](optimize.md) — Scenarios that get faster by swapping libraries, dropping the pool, or replacing it with `errgroup`

## How to use this guide

Read `junior.md` first even if you already use pools daily — the decision tree at the top will save you a refactor. Then jump to the level that matches the problem in front of you:

- Reviewing a PR that adds `ants`? Go to `senior.md` and `professional.md`.
- Sizing a new service's worker pool? `middle.md` has the sizing math.
- Justifying the dependency to your tech lead? `professional.md` has the audit checklist.
- Migrating a service from raw goroutines to a pool (or off a pool)? `tasks.md` has worked migrations.

The guidance here assumes you have already read `01-overview` (what pools are), `02-ants` (how `ants` works), and `03-tunny` (how `tunny` works) in this same `17-goroutine-pools-3rd-party` topic. If you have not, those pages give you the building blocks; this page gives you the architecture.

## What this sub-topic is not

This is not a tutorial on writing a goroutine pool. The implementation details of `ants`, `tunny`, `workerpool`, and `pond` live in their respective deep-dive topics. This sub-topic is about *choosing* between them and about choosing *whether to use them at all*.

This is also not a benchmark blog post. We will reference real benchmark numbers, but the focus is on the *decision framework* that benchmarks should inform — not on which library "wins" in some abstract sense. Different workloads favour different tools; the framework helps you identify which workload you have.

## A short note on the default tool

Throughout this sub-topic, we will repeatedly come back to one phrase: "default to `errgroup.SetLimit`." This is not because errgroup is best at everything — it is not. It is because:

- It is in `golang.org/x/sync`, effectively part of the standard library.
- It propagates errors and context cancellation natively.
- It is the smallest API for the most common case.
- It is the answer most reviewers will accept without argument.

Reaching past errgroup for a third-party pool should be justified, not assumed. The whole subsection — `junior` through `optimize` — works to give you the language and data to make that justification well.

## Reading order

The files in this subsection are graduated. Read them in order, or skip to the level that matches your role:

- New to pools: read `junior.md` first.
- Choosing for a real workload: read `middle.md`.
- Designing for high scale or operating in prod: `senior.md` and `professional.md`.
- Looking up an API: `specification.md`.
- Preparing for an interview: `interview.md`.
- Practicing: `tasks.md`.
- Code review: `find-bug.md`.
- Looking for improvements: `optimize.md`.

Each file is self-contained but builds on the previous level. Re-read as your understanding deepens; the same words mean more after a few months of practice.


