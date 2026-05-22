---
layout: default
title: Decision Tree — Senior
parent: Decision Tree
grand_parent: Primitives Decision Guide
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/24-primitives-decision-guide/04-decision-tree/senior/
---

# Decision Tree — Senior

[← Back](../)

## Table of Contents
1. [What this file is](#what-this-file-is)
2. [From primitive choice to system design](#from-primitive-choice-to-system-design)
3. [Composing primitives across boundaries](#composing-primitives-across-boundaries)
4. [Choosing under measured contention](#choosing-under-measured-contention)
5. [The API consequences of each choice](#the-api-consequences-of-each-choice)
6. [Case study: building a job scheduler](#case-study-building-a-job-scheduler)
7. [Migrating between primitives safely](#migrating-between-primitives-safely)
8. [Backpressure as a design axis](#backpressure-as-a-design-axis)
9. [Anti-patterns at scale](#anti-patterns-at-scale)
10. [Cheat sheet](#cheat-sheet)
11. [Self-assessment checklist](#self-assessment-checklist)
12. [Summary](#summary)
13. [Further reading](#further-reading)

---

## What this file is
The tree picks one primitive for one problem. Real systems have many problems wired together. This file is about the senior skill: composing primitives so each subsystem uses the right one, choosing under real contention data, and understanding how each choice leaks into your public API and your operational story.

---

## From primitive choice to system design
A service is rarely "a mutex" or "a channel." It is channels carrying events *between* subsystems and mutexes/atomics protecting state *inside* each subsystem. The tree applies independently at each boundary:

- **Ingress → processing:** channel (ownership transfer of requests).
- **Processing → shared metrics:** atomic counters or a mutex-protected struct.
- **Config:** `atomic.Pointer[Config]` snapshot, reloaded out of band.
- **Shutdown:** `context.Context` threaded through everything.

Drawing this map first — what crosses each boundary, value or access? — is the senior move. The primitives fall out of the map.

---

## Composing primitives across boundaries
A common, correct composition:

```go
type Service struct {
    in   chan Request          // channel: events in
    cfg  atomic.Pointer[Config] // atomic: read-mostly snapshot
    stat struct {              // mutex: multi-field metrics
        mu              sync.Mutex
        ok, failed      int64
    }
}

func (s *Service) worker(ctx context.Context) {
    for {
        select {
        case <-ctx.Done():
            return                       // context: shutdown
        case r := <-s.in:                // channel: take ownership
            cfg := s.cfg.Load()          // atomic: lock-free config read
            if err := s.handle(r, cfg); err != nil {
                s.stat.mu.Lock(); s.stat.failed++; s.stat.mu.Unlock()
            } else {
                s.stat.mu.Lock(); s.stat.ok++; s.stat.mu.Unlock()
            }
        }
    }
}
```

Four primitives, each on the branch the tree assigns. Swapping any one for another (e.g., a mutex-protected queue instead of `in`) would add code and remove `select`-based shutdown.

---

## Choosing under measured contention
The tree gives a default; contention data overrides it. Process:

1. Ship the obvious choice (usually a mutex for shared state).
2. Profile under realistic load: mutex profile, block profile, flame graph.
3. If a specific lock dominates, apply the targeted upgrade: atomic for one-word state, `atomic.Pointer` snapshot for read-mostly, sharding for write-heavy aggregates.
4. Re-measure to confirm and to ensure you didn't move the bottleneck.

Never invert this order. Premature lock-free code is the most expensive kind of premature optimization because it's the hardest to audit.

---

## The API consequences of each choice
Your concurrency choice becomes a contract the moment it touches the public surface:

- **Returning a channel** commits you to its buffering and close semantics forever. Callers will write `for v := range ch`. Document who closes it (the creator) and never close from the receiver side.
- **Embedding a `sync.Mutex` or atomic in an exported struct** lets callers copy the struct and break synchronization. Expose methods; keep the primitive unexported; document "do not copy" and rely on `go vet`.
- **Accepting a `context.Context`** as the first parameter is the idiomatic cancellation contract; every blocking method on a long-lived component should take one.

The rule: the API exposes *intent* (Push, Lookup, Subscribe), never *mechanism* (the channel, the mutex).

---

## Case study: building a job scheduler
Requirements: accept jobs, run at most N concurrently, support priority, allow graceful shutdown, expose metrics.

- **Accept jobs:** a channel `submit chan Job` (ownership transfer). For priority, multiple channels drained by a `select` that prefers the high-priority case, or a mutex-protected heap if strict ordering is required (heap is multi-field → mutex).
- **Bounded concurrency:** `errgroup.Group` with `SetLimit(N)` — bounds workers and propagates errors.
- **Graceful shutdown:** `context.Context`; `close(submit)` after the last producer, workers drain then exit.
- **Metrics:** `atomic.Int64` counters (each one word, independent).
- **Config (N, timeouts):** `atomic.Pointer[Config]` for hot reload.

Each requirement maps to exactly one branch. The priority requirement is the only judgment call: `select` bias is cheap but not strict; a heap is strict but multi-field (mutex). Choose based on whether strict priority is a real requirement or a nice-to-have.

---

## Migrating between primitives safely
When data shows you must change a primitive:

1. **Keep the public API stable** — if you exposed methods, the swap is invisible to callers.
2. **Land the change behind tests** including `-race` and a contention benchmark.
3. **Change one primitive at a time** and re-measure; don't refactor three subsystems in one commit.
4. **Watch for new invariants** — e.g., switching to `atomic.Pointer` snapshots adds the "never mutate after publish" rule that must be documented and reviewed.

---

## Backpressure as a design axis
The tree's branches differ in how they handle overload:

- **Unbuffered/bounded channels** apply backpressure naturally — a full channel blocks the producer.
- **Unbounded queues** (a mutex-protected growing slice) hide backpressure and risk OOM.
- **Semaphores** bound concurrency but not the queue depth behind them.

Senior design treats backpressure as a first-class concern: prefer bounded channels, make queue limits explicit, and decide what happens on overflow (block, drop, or shed) rather than letting an unbounded structure decide for you.

---

## Anti-patterns at scale
1. **One global mutex** serializing unrelated subsystems — split state, lock narrowly.
2. **Unbounded channels/queues** masking backpressure until OOM.
3. **Lock-free everywhere** without profiles — unauditable, often slower.
4. **Leaking the mechanism** into the API, freezing future refactors.
5. **Refactoring multiple primitives at once** with no per-change measurement.
6. **No context threading**, so shutdown is impossible or leaks goroutines.

---

## Cheat sheet

| Boundary question | Primitive |
|---|---|
| Value crosses boundary | channel |
| Access to shared state inside a subsystem | mutex / atomic |
| Read-mostly config | `atomic.Pointer[T]` |
| Bounded fan-out + errors | `errgroup.SetLimit` |
| Shutdown across the system | `context.Context` |
| One-word hot counter under contention | `atomic` (shard if write-heavy) |
| Public surface | methods only; hide the primitive |

---

## Self-assessment checklist
- [ ] I map subsystem boundaries (value vs access) before choosing primitives.
- [ ] I can compose channel + atomic + mutex + context in one component correctly.
- [ ] I change primitives only when profiles justify it, and re-measure.
- [ ] My APIs expose intent, never the synchronization mechanism.
- [ ] I treat backpressure as an explicit design decision.
- [ ] I can design a bounded, cancellable, observable job scheduler from the tree.

---

## Summary
At system scale the decision tree is applied per boundary, not once. Draw the map of what crosses each boundary — a value (channel) or access to shared state (mutex/atomic) — and the primitives follow. Ship the default, profile under load, and apply targeted lock-free upgrades only where contention is proven, re-measuring each time. Keep the mechanism out of your public API so future migrations stay invisible, thread `context` for shutdown everywhere, and make backpressure an explicit choice rather than an emergent property of an unbounded queue.

---

## Further reading
- "Go Concurrency Patterns: Pipelines and cancellation" — https://go.dev/blog/pipelines
- `golang.org/x/sync/errgroup` — https://pkg.go.dev/golang.org/x/sync/errgroup
- "Context" — https://go.dev/blog/context
- Bryan C. Mills, "Rethinking Classical Concurrency Patterns" (GopherCon 2018)

---

[← Back](../)
