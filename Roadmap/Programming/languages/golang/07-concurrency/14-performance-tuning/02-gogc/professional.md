# GOGC and GOMEMLIMIT — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [The 2022 Pacer Redesign](#the-2022-pacer-redesign)
3. [The Soft-Limit Mathematics](#the-soft-limit-mathematics)
4. [GC CPU Budget and the 50% Cap](#gc-cpu-budget-and-the-50-cap)
5. [Allocator Internals That Touch GC](#allocator-internals-that-touch-gc)
6. [Why Go Is Not Generational](#why-go-is-not-generational)
7. [Pathological Tuning Patterns](#pathological-tuning-patterns)
8. [Frontier Topics](#frontier-topics)
9. [Self-Assessment](#self-assessment)
10. [Summary](#summary)

---

## Introduction

At professional level the question is no longer "what does `GOGC` do?" but "why does the runtime work this way, what failed in the previous designs, and what experiments tell us where it goes next?" This file connects the user-visible knobs to the design papers and source-level data structures behind them.

After reading you will:

- Summarise the 2022 pacer redesign and the four problems it fixed
- Derive the soft-limit equation that the runtime evaluates each cycle
- Explain the 50% CPU cap, its rationale, and its visible signature
- Walk through the size-class allocator and how `mcache`/`mcentral`/`mheap` interact with GC
- Reproduce the historical argument against generational GC for Go
- Identify three pathological tuning patterns from production
- Know where current Go runtime work is heading

This file assumes mastery of the senior file. It is written for engineers who write or review runtime-adjacent code, design language runtimes, or are deep into production Go SRE.

---

## The 2022 Pacer Redesign

Go 1.19 shipped a new pacer designed by Michael Knyszek (Go team) and documented in the proposal `go.dev/issue/44167` and the accompanying internal "Designing Go" notes. The redesign addressed concrete failures of the previous pacer (Go 1.5 through 1.18).

### Problem 1: the trigger-ratio learner was unstable

The classic pacer estimated when to start GC so that mark would *finish* near the heap goal. It learned from history: if last cycle finished too early, start later; if too late, start earlier. The learner used an exponentially-weighted moving average. Under bursty workloads it would oscillate — overshooting one cycle, undershooting the next — producing visible jitter in cycle time and assist load.

### Problem 2: no first-class memory limit

Pre-1.19, `GOGC` was the only steady-state control. To stay under a fixed memory budget you had to lower `GOGC` until empirical measurement showed acceptable peak RSS — but `GOGC` is *ratio-based*, so its effect on absolute peak depended on the live working set you didn't know yet. Operators wanted a number, not a ratio.

### Problem 3: stack scan dominance

Goroutine stacks counted toward mark work but not toward the heap goal. Programs with thousands of goroutines had pacer math that ignored most of the actual cost. The new pacer accounts for stack and global scan time when projecting cycle completion.

### Problem 4: assist time was reactive, not predictive

The old pacer set `assistWorkPerByte` based on a snapshot. As allocation rate spiked, assists spiked with a lag. The new pacer uses a smoother predictive model based on the *piecewise linear* relationship between heap growth and mark progress.

### What changed in the user-visible knobs

- `GOMEMLIMIT` became first-class, documented, and stable.
- `GOGC` semantics did not change for steady-state programs.
- Cycle-to-cycle variance in GC CPU dropped substantially. The death-spiral threshold became sharper but more predictable.
- The 50% CPU cap was introduced.

The relevant academic and engineering references:

- `go.dev/doc/gc-guide` — the official Go GC guide.
- `go.dev/issue/44167` — the soft-memory-limit proposal.
- "A Guide to the Go Garbage Collector" (Knyszek, on the Go blog) — accessible explanation.
- The "Designing Go" memo (internal but referenced in talks at GopherCon 2022) — covers the redesign rationale.

---

## The Soft-Limit Mathematics

The pacer's job each cycle is to pick a heap goal. With the redesign, the formula has two terms.

### `GOGC` term

```
goal_gc = live * (1 + GOGC/100)
```

Same as before. With `GOGC=100` and live=1 GiB, `goal_gc = 2 GiB`.

### `GOMEMLIMIT` term

```
non_heap = stacks + globals + runtime_overhead + ...   (measured)
goal_mem = max(live, GOMEMLIMIT - non_heap)
```

If `GOMEMLIMIT=1.5 GiB`, `non_heap=200 MiB`, `live=400 MiB`:

```
goal_mem = max(400 MiB, 1.5 GiB - 200 MiB) = 1.3 GiB
```

### The actual goal

```
heap_goal = min(goal_gc, goal_mem)
```

In the example above: `min(800 MiB, 1.3 GiB) = 800 MiB`. GOGC wins.

If `live` grows to 800 MiB:

```
goal_gc  = 800 * 2          = 1.6 GiB
goal_mem = max(800 MiB, 1.3 GiB) = 1.3 GiB
heap_goal = min            = 1.3 GiB
```

`GOMEMLIMIT` takes over.

### The trigger

The trigger is set *below* the goal so mark finishes near the goal:

```
trigger = heap_goal - (mark_assist_estimate + buffer)
```

The exact `mark_assist_estimate` is a learned function of recent cycles' mark cost normalised by heap size. The pacer adjusts the trigger so the heap reaches `heap_goal` at the moment mark terminates. If the prediction is off, assist soaks up the slack — which is why high `assist` in gctrace means the pacer is underestimating.

### Why `goal_mem` is clamped to `live`

The runtime cannot meaningfully target a heap goal below the current live size — the program is using that memory. Clamping prevents an absurd math output and forces the runtime to fall back to "GC is going to happen continuously" mode.

---

## GC CPU Budget and the 50% Cap

Go's GC tries to keep its CPU usage modest. The mechanisms:

### Dedicated workers ≤ 25% of `GOMAXPROCS`

By default, the runtime dedicates up to one-quarter of `GOMAXPROCS` to background mark workers. On an 8-core machine, that's 2 dedicated workers. Idle workers fill in if Ps would otherwise be idle.

### Assist on user goroutines absorbs the rest

If mark needs more work than dedicated + idle workers can provide, allocating goroutines are charged assist time to make up the difference. This shifts GC cost into request latency rather than dedicating more CPUs.

### The 50% cap (Go 1.19+)

Total GC CPU is capped at approximately 50% of available CPU. If respecting `GOMEMLIMIT` would require more, the runtime *gives up partial enforcement* — it lets memory rise rather than dedicate >50% of cores to GC.

The rationale: a service that uses 90% of its CPU on GC and 10% on real work is worse than one that uses 50% on GC, 50% on work, and accepts higher RSS. The latter at least makes progress.

### Visible signature

```
gc 100 @60.0s 50%: ...
gc 101 @60.5s 50%: ...
gc 102 @61.0s 50%: ...
```

`P%` glued at 50% across many cycles. Live memory or RSS rising. This is the cap doing its job. Either raise `GOMEMLIMIT`, reduce working set, or accept higher memory.

### Tuning implication

If your service requires more than 50% CPU dedicated to GC under load, you have an allocation problem, not a tuning problem. No knob will fix it. Reduce allocations, redesign hot paths, or scale horizontally.

---

## Allocator Internals That Touch GC

The Go allocator is a size-class slab allocator inspired by TCMalloc. Objects of similar sizes are grouped into spans of pages. The structure is three levels deep.

### `mcache` — per-P, no locking

Each P (processor) has a private `mcache` holding free lists for ~70 size classes (8 B, 16 B, 32 B, ..., up to 32 KiB). Small allocations come from the local mcache without a lock.

### `mcentral` — global, locked

When an mcache runs out of a size class, it refills from the corresponding `mcentral`, which holds spans of free objects of that class. Lock contention here is rare but possible at very high allocation rates.

### `mheap` — global, page-level

When an mcentral runs out, it asks `mheap` for new pages. `mheap` is the page-level allocator backed by the OS. Allocations of large objects (>32 KiB) skip mcache/mcentral and come directly from `mheap`.

### Why this matters for GC

- **Small allocations are nearly free** — local mcache pop.
- **Large allocations are not** — mheap path is slower and produces fragmentation.
- **Sweep happens at mcentral/mheap level** — reclaimed memory rejoins free lists incrementally.
- **Fragmentation affects `Sys`** — heap can hold "freed but unreturned" pages, which count toward `GOMEMLIMIT`.

If your service allocates many large objects, watch for `HeapIdle - HeapReleased` growing — memory the runtime considers free but has not yet returned to the OS. The runtime returns memory to the OS lazily (typically minutes after it becomes idle); `GOMEMLIMIT` aggression speeds this up.

### `runtime.GC()` and `debug.FreeOSMemory()`

`runtime.GC()` runs a full collection. `debug.FreeOSMemory()` runs a GC *and then* forces the runtime to return as much idle memory to the OS as possible. The latter is useful before forking, before a known idle period, or in a test that wants to compare RSS before and after a workload. Both are blocking; both have no place in steady-state code.

---

## Why Go Is Not Generational

The Go team has discussed generational GC repeatedly. The summary of their analysis:

### The classical argument for generational

"Most objects die young." If you scan a young region more often than the old region, you reclaim most garbage with less work. The Java HotSpot collectors are built on this premise.

### The Go-specific counter-argument

1. **Escape analysis already handles short-lived objects.** In Go, most "young, soon-dead" objects never reach the heap — they stay on the stack. The classical generational hypothesis is true *but* the easy wins have been taken by the compiler.

2. **Generational GC requires a write barrier outside mark.** To track pointers from old to young, every pointer write (anywhere) must be barriered, even when GC is not running. Go's current design only pays the barrier cost during mark, which is a small fraction of total time.

3. **Compaction is hard without a moving collector.** Most generational designs move objects to compact the young region. Go is non-moving for cgo compatibility and pointer stability. A non-moving generational design loses much of the locality benefit.

4. **The Go team's measurements** of real workloads showed that current concurrent mark is faster than a hypothetical generational design once the write-barrier overhead and bookkeeping were accounted for.

The decision is revisited periodically. As of 2025-era Go, the answer remains non-generational. Future redesigns (regions, sub-heap arenas) are tracked in the Go issue tracker but have not landed.

---

## Pathological Tuning Patterns

These are real anti-patterns from postmortems, not textbook examples.

### Pattern 1: oscillating `GOGC` via autotuner

A team writes a loop that watches RSS and toggles `GOGC` between 50 and 200. The runtime's pacer learns from history; constantly changing `GOGC` destroys the learner's state. Cycle time becomes erratic. **The pacer is stateful; treat it as such.** If you must auto-tune, change `GOGC` rarely (minutes apart, not seconds) and prefer adjusting `GOMEMLIMIT`.

### Pattern 2: `GOMEMLIMIT` matched to the cgroup limit

A pod with `limits.memory: 1Gi` sets `GOMEMLIMIT=1GiB`. Stacks, runtime, glibc, file caches, and cgo total ~100–150 MiB. The kernel kills at 1 GiB total; Go thinks it has the full GiB. RSS sneaks past 1 GiB and the kernel sends SIGKILL. **Always leave a margin** (10–20%).

### Pattern 3: `runtime.GC()` after RPC responses

A team caches large response objects, calls `runtime.GC()` after each request to "reclaim" them. They have a 99% reduction in cache hit rate (objects evicted), 5x CPU usage, P99 latency through the roof. **`runtime.GC()` in a per-request path is always wrong.**

### Pattern 4: pool of pools

A team builds a `sync.Pool` whose `New` function returns a wrapper around another pool. Each pool clears on GC, so the inner pool is being recreated every GC cycle. No net benefit. **Pool nesting needs justification.** Usually one pool suffices.

### Pattern 5: tuning by superstition

A team reads a 2017 blog post about `GOGC=200`. The post predates Go 1.19. They set `GOGC=200` without `GOMEMLIMIT`. Under load, the heap grows to 6 GiB on a 4 GiB pod. OOM. **GC behaviour has changed across Go versions.** Re-validate every major version (the 1.19 redesign was a watershed).

### Pattern 6: `GOMEMLIMIT` set in `init()` after a large allocation

```go
func init() {
    bigCache = loadCache() // 800 MiB
    debug.SetMemoryLimit(500 << 20) // 500 MiB
}
```

The cache already exceeds the limit when set. The runtime now enters GC death spiral. **Set memory limits before allocations**, ideally via environment variable.

---

## Frontier Topics

Topics actively discussed in the Go community as of late 2025:

### Regions / arenas

The `arena` experimental package (gated behind `goexperiment.arenas`) allows manual region-based allocation: allocate many objects into an arena, free them all at once. This bypasses GC for tightly-scoped workloads (compilers, request handlers). Status: experimental, not in default builds, contention around whether the API is ergonomically right.

### Per-goroutine GC pacing

A proposal floated in 2024: distinguish goroutines that should pay assist from those that should not (e.g., latency-critical request handlers). Status: discussion, no implementation.

### Memory ballast (legacy pattern)

Pre-Go 1.19, a common trick was to allocate a large dummy buffer to make `live` look larger so the pacer would set a higher goal. Example:

```go
var ballast = make([]byte, 1<<30) // 1 GiB ballast
```

This is **obsolete** since `GOMEMLIMIT` exists. Use the limit, not the ballast. Some legacy services still have it; consider removing on Go upgrades.

### Hardware trends

NUMA-aware allocation, multi-tenancy on big machines, and the rise of containerised workloads continue to shape the runtime. Future GC redesigns will likely care more about cache locality and NUMA than about minimising STW (which is already trivial).

---

## Self-Assessment

- I can explain the four problems the 2022 pacer redesign fixed.
- I can derive `heap_goal` from `live`, `GOGC`, `GOMEMLIMIT`, and `non_heap`.
- I can predict, given a cgroup limit and known overheads, what `GOMEMLIMIT` to set.
- I can explain why Go is not generational, citing the trade-off with escape analysis.
- I can identify the 50% CPU cap's signature in `gctrace`.
- I know what `mcache`, `mcentral`, `mheap`, and `HeapIdle` mean.
- I have read at least one Go runtime source file (`mgc.go`, `mgcpacer.go`, `mheap.go`).
- I can review a tuning PR and reject changes that destabilise the pacer.

---

## Summary

Professional-level GC work in Go is half historical (understanding why the runtime is shaped this way) and half forward-looking (knowing what experiments are in flight). The 2022 pacer redesign made `GOMEMLIMIT` a first-class control and tightened the cycle-to-cycle predictability that the older trigger-ratio learner could not provide. The 50% CPU cap protects services from death spirals at the cost of accepting occasional memory overshoot.

The runtime's allocator and collector are inseparable: size-class spans, lazy sweep, and the hybrid write barrier all participate in the cost of running Go. Tuning `GOGC` and `GOMEMLIMIT` is the public face of this machinery, but real performance work happens at the levels above (architecture, allocation patterns) and below (allocator behaviour, escape analysis).

Generational GC remains an open question, with the Go team's consistent answer being "the trade-off does not favour it given Go's existing escape analysis." Future work is more likely to come in the form of regions, NUMA-aware allocation, or specialised GC modes than a generational redesign.
