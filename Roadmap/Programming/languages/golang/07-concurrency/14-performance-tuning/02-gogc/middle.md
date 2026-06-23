# GOGC and GOMEMLIMIT — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [The GC Lifecycle in Detail](#the-gc-lifecycle-in-detail)
3. [Reading gctrace=1 Line by Line](#reading-gctrace1-line-by-line)
4. [The Pacer: How GOGC Becomes a Trigger](#the-pacer-how-gogc-becomes-a-trigger)
5. [GOMEMLIMIT Soft-Target Math](#gomemlimit-soft-target-math)
6. [runtime.MemStats Worth Watching](#runtimememstats-worth-watching)
7. [Container-Aware Tuning](#container-aware-tuning)
8. [Tuning Recipes by Workload](#tuning-recipes-by-workload)
9. [Allocation Patterns That Hurt](#allocation-patterns-that-hurt)
10. [Common Failures and Their Signatures](#common-failures-and-their-signatures)
11. [Self-Assessment](#self-assessment)
12. [Summary](#summary)

---

## Introduction

At junior level you know the two knobs. At middle level you know **what changes inside the runtime when you turn them**, and you can read the GC trace lines a production service emits and decide whether to touch the configuration.

After this file you will:

- Understand the four phases of a Go GC cycle and their wall-clock cost
- Read every field of a `gctrace=1` line without consulting documentation
- Know how the pacer turns `GOGC` and `GOMEMLIMIT` into the heap goal each cycle
- Be able to pick a `GOMEMLIMIT` value from a container's memory budget
- Recognise allocation patterns that defeat tuning
- Diagnose three common GC failure modes from logs alone

This file assumes you have read `junior.md` of this section, know what `GOGC=100` means, and have run a Go program with `GODEBUG=gctrace=1` at least once.

---

## The GC Lifecycle in Detail

A Go GC cycle has four phases. The boundaries between them matter when you read a gctrace line — every duration corresponds to a specific phase.

### Phase 1: Sweep Termination (STW)

The collector waits for any in-progress sweeping from the *previous* GC cycle to finish, then briefly stops the world. This phase is typically tens of microseconds. It exists because the runtime needs a consistent boundary between "the old cycle" and "the new cycle."

### Phase 2: Mark (concurrent + assist)

The world resumes. The collector walks reachable objects starting from roots (globals, goroutine stacks, registers). This happens concurrently with your program. Two things make it possible:

- **Write barrier:** when your code writes a pointer into a heap object during mark, the runtime records that write so the GC does not lose track of newly reachable objects.
- **GC assist:** if your goroutines allocate faster than the GC can mark, the runtime steals a slice of allocating goroutines' time to do mark work. The fast allocator is throttled by being made part of the cleanup crew.

Mark is the longest phase wall-clock-wise. It also dominates CPU cost — typically using ~25% of `GOMAXPROCS` cores by default (configurable via `GOGC`'s implicit relationship with the pacer).

### Phase 3: Mark Termination (STW)

The world stops again to finalise marking. This phase used to be expensive in older Go; modern Go (1.14+) reduced it to typically under 100 µs. Goroutine stack rescans are deferred or made concurrent.

### Phase 4: Sweep (concurrent, lazy)

Memory is reclaimed by walking heap spans and freeing dead objects. **In Go, sweep is lazy.** It happens incrementally as the allocator hits a span needing reclaim. The application's allocator pays a tiny per-allocation cost during sweep to advance the work.

You do not wait for sweep to finish before declaring "GC done." From the program's point of view, the cycle is over when mark termination ends.

### Wall-clock summary

For a healthy steady-state program:

```
STW1 (sweep term)     ~10-50 µs
Concurrent mark       ~tens to hundreds of ms (overlaps with program)
STW2 (mark term)      ~10-100 µs
Sweep                 lazy, no perceived cost
-----------------------------------------------
Total STW per cycle:  ~ 20 - 150 µs in good Go services
```

If you see STW totals in the milliseconds, something is unusual: very large stacks, finalizer queue pressure, OS scheduling delay.

---

## Reading gctrace=1 Line by Line

Set `GODEBUG=gctrace=1` and run any Go program. You get lines like:

```
gc 12 @1.234s 3%: 0.018+0.42+0.01 ms clock, 0.14+0.10/0.20/0.40+0.08 ms cpu, 96->100->48 MB, 100 MB goal, 0 MB stacks, 0 MB globals, 8 P
```

Field by field:

```
gc 12               cycle number (12th GC since start)
@1.234s             time since program start
3%                  total program time spent in GC since start

0.018+0.42+0.01 ms clock
                    wall-clock split:
                    STW1 + concurrent mark + STW2

0.14+0.10/0.20/0.40+0.08 ms cpu
                    CPU time split:
                    STW1 CPU  +  assist / background / idle  +  STW2 CPU
                    "assist" = goroutine-time the GC stole
                    "background" = dedicated GC workers
                    "idle" = idle CPUs harnessed for mark

96->100->48 MB      heap-at-start -> heap-at-mark-end -> heap-live
                    96 MB when GC began
                    100 MB at mark termination (allocations during mark)
                    48 MB still reachable

100 MB goal         the heap goal for the NEXT GC

0 MB stacks         total goroutine stack memory at this GC

0 MB globals        total memory for global variables

8 P                 number of P (processors) active = GOMAXPROCS
```

### Reading patterns

#### Healthy steady state

```
gc N @TIMEs P%: a+b+c ms clock, ...   live ratio steady, P% in single digits
```

If `P%` stays around 5–10% and `live` is roughly constant, GC is doing its job. No tuning needed.

#### Throughput-limited

```
gc N @TIMEs 25%: ...
```

GC is using a quarter of CPU. This is the regime where raising `GOGC` (or sometimes `GOMEMLIMIT`) helps — let the heap grow more between collections, do fewer of them.

#### Memory-limited

```
gc N @TIMEs 4%: ...  heap_live close to GOMEMLIMIT
```

GC is firing because memory is hitting the soft ceiling. Either accept it, or reduce live data, or raise `GOMEMLIMIT`.

#### Death spiral

```
gc 100 @5.001s 92%: 0.02+800+0.01 ms clock, ...
gc 101 @5.802s 93%: 0.02+800+0.01 ms clock, ...
gc 102 @6.603s 94%: 0.02+800+0.01 ms clock, ...
```

`P%` climbing toward 90%, cycles back-to-back, no progress. Diagnosis: live data is at or above `GOMEMLIMIT`. The runtime is collecting constantly trying to free memory that is genuinely needed. Raise the limit or reduce live data.

#### Long STW

```
gc N @TIMEs P%: 12.0+200+4.5 ms clock, ...
```

STW1 of 12 ms or STW2 of 4.5 ms is too long. Possible causes: very large goroutine stacks (deep recursion, leaks), heavy finalizer queue, OS scheduling pressure (host CPU steal).

---

## The Pacer: How GOGC Becomes a Trigger

The Go runtime component that decides when GC starts is the **pacer**. It is the layer between "user sets `GOGC=100`" and "the runtime sets a precise number of bytes that triggers GC."

### The classic pacer (pre Go 1.19)

```
heap_goal     = live_heap * (1 + GOGC/100)
trigger_ratio = some value < 1.0
trigger       = heap_marked * (1 + trigger_ratio)
```

The pacer aimed to start GC early enough that mark would finish *before* the heap reached `heap_goal`. The `trigger_ratio` was learned over time — the pacer observed how long mark took and adjusted.

### The Go 1.19 redesign

In Go 1.19, the pacer was redesigned around a piecewise linear model that incorporates `GOMEMLIMIT`. The key paper is "Designing Go" (Knyszek, 2022). The new pacer:

- Computes two goals — `GOGC`-derived and `GOMEMLIMIT`-derived.
- Takes the minimum of the two.
- Uses CPU history to predict how long mark will take.
- Adjusts the trigger so the GC finishes near the goal, not late, not early.

The user does not directly see this — but you do see the consequences when reading gctrace. The new pacer is *much* better at hitting `GOMEMLIMIT` without overshooting.

### CPU budget

The pacer also enforces a CPU budget for GC. By default GC may use up to about 25% of `GOMAXPROCS` for background marking. If allocation outpaces that, GC assist kicks in: the *user* goroutines are charged to make up the shortfall. This is why `gctrace`'s `assist` field rising is a sign of allocation pressure.

---

## GOMEMLIMIT Soft-Target Math

`GOMEMLIMIT` does not magically prevent the heap from growing. It works by tilting the pacer.

### What "soft" means precisely

The runtime aims to keep `runtime.MemStats.Sys - runtime.MemStats.HeapReleased ≤ GOMEMLIMIT`. The quantity being limited is the *non-released* memory: heap, stacks, and runtime overhead that the runtime considers in-use.

### How the runtime reacts as memory rises

As `Sys` approaches `GOMEMLIMIT`, the pacer lowers the GC trigger. The closer to the limit, the more aggressively it tries to free memory.

A simplified mental model:

```
slack = GOMEMLIMIT - non_heap_overhead - live
       |               |                  |
       cushion the     stacks, runtime    last GC's live size
       runtime uses    bookkeeping

heap_goal_from_limit  = live + slack    (clamped to ≥ live)
heap_goal_from_GOGC   = live * (1 + GOGC/100)
heap_goal_actual      = min(heap_goal_from_limit, heap_goal_from_GOGC)
```

When the limit is generous, the GOGC term wins. As the limit tightens, the limit term wins.

### The 50% CPU cap

To prevent the death spiral from being arbitrarily bad, Go 1.19 caps GC at about 50% of CPU. If respecting `GOMEMLIMIT` would require more than that, the runtime gives up *partially* — it allows the limit to be exceeded rather than dedicate >50% of CPU to GC.

You will see this in gctrace as `P%` staying around 50% even though memory keeps climbing. That is the runtime explicitly trading memory for liveness. It is the right call: a service that does not respond at all is worse than one that uses a bit more RAM.

### A worked example

```
container limit:     2 GiB
non-heap overhead:   ~200 MiB (stacks, mspans, gcwork, etc.)
GOMEMLIMIT:          1.8 GiB
GOGC:                100
working live heap:   400 MiB

slack            = 1.8 GiB - 200 MiB - 400 MiB  = 1.2 GiB
heap_goal_limit  = 400 MiB + 1.2 GiB           = 1.6 GiB
heap_goal_GOGC   = 400 MiB * 2                 = 800 MiB
heap_goal_actual = min                          = 800 MiB
```

GOGC wins. Memory limit is not binding. Now suppose allocation grows live to 1.2 GiB:

```
slack            = 1.8 GiB - 200 MiB - 1.2 GiB = 400 MiB
heap_goal_limit  = 1.2 GiB + 400 MiB           = 1.6 GiB
heap_goal_GOGC   = 1.2 GiB * 2                 = 2.4 GiB
heap_goal_actual = min                          = 1.6 GiB
```

Now the limit wins. GC fires before doubling, in deference to the ceiling.

---

## runtime.MemStats Worth Watching

`runtime.MemStats` has dozens of fields. For tuning, these matter most.

| Field | Meaning |
|-------|---------|
| `HeapAlloc` | Bytes of allocated heap objects (live). Updated continuously. |
| `HeapSys` | Bytes of heap memory obtained from the OS. |
| `HeapIdle` | Bytes in spans that are not currently in use; available to be reused or returned. |
| `HeapInuse` | Bytes in spans that are in use. |
| `HeapReleased` | Bytes returned to the OS. |
| `HeapObjects` | Count of allocated objects. |
| `Sys` | Total bytes obtained from the OS (heap, stacks, runtime structures). |
| `NumGC` | Total GC cycles since process start. |
| `PauseNs` | Circular buffer of recent STW pauses in nanoseconds. |
| `PauseTotalNs` | Cumulative STW pause time. |
| `GCCPUFraction` | Fraction of total CPU spent in GC since program start. |

### Quick derived metrics

```go
gcCPUPct := m.GCCPUFraction * 100               // % of CPU in GC
lastPause := m.PauseNs[(m.NumGC+255)%256]       // most recent STW
heapMB := m.HeapAlloc >> 20                     // live heap in MiB
```

If `gcCPUPct` is steadily above 10%, GC is a meaningful contributor to your CPU use. If it is above 25%, you have a tuning problem (raise `GOGC` or reduce allocations). If it is above 50%, you're hitting the cap.

### `runtime/metrics` is the modern path

`runtime/metrics` (Go 1.16+) exposes the same information with better names and lower overhead. For new code, prefer it over `MemStats`.

```go
package main

import (
    "fmt"
    "runtime/metrics"
)

func main() {
    samples := []metrics.Sample{
        {Name: "/gc/heap/live:bytes"},
        {Name: "/gc/cycles/total:gc-cycles"},
        {Name: "/cpu/classes/gc/total:cpu-seconds"},
    }
    metrics.Read(samples)
    for _, s := range samples {
        fmt.Println(s.Name, s.Value)
    }
}
```

---

## Container-Aware Tuning

Modern Go (1.19+) does not automatically read cgroup memory limits. You must set `GOMEMLIMIT` yourself — or use a library like `go.uber.org/automaxprocs` and the increasingly common `GOMEMLIMIT=80%` pattern in Kubernetes manifests.

### The recipe

1. Find the container's memory limit (from cgroup or Kubernetes `limits.memory`).
2. Subtract a safety margin for non-Go memory: about 5–10% for pure Go, more (20%+) if you use cgo.
3. Set `GOMEMLIMIT` to the result.
4. Leave `GOGC` at default unless you have a reason.

### A Kubernetes example

```yaml
resources:
  limits:
    memory: "2Gi"
env:
  - name: GOMEMLIMIT
    value: "1800MiB"
```

That headroom (200 MiB) covers goroutine stacks, the runtime's own structures, glibc/musl overhead, and any cgo allocations.

### Why not just use the cgroup limit?

Two reasons. First, `GOMEMLIMIT` is *soft* — the runtime will sometimes overshoot. You want overshoot to stay below the cgroup limit, otherwise OOM. Second, the runtime's accounting may diverge from the kernel's view by a few percent.

### A library trap

Some teams use `go.uber.org/automemlimit` to read the cgroup limit at startup and call `debug.SetMemoryLimit`. That works, but it does *not* set the safety margin for you — by default it uses the full limit. Configure the multiplier carefully (often 0.9).

---

## Tuning Recipes by Workload

### Recipe: latency-sensitive HTTP API

```
GOGC = 100             (default)
GOMEMLIMIT = ~90% container limit
```

Goal: short, predictable GC. Watch P% in gctrace and STW pauses. If pauses cross 1 ms or P% climbs above 15%, reduce allocations (sync.Pool, escape analysis) before changing the knobs.

### Recipe: batch CPU-bound job

```
GOGC = 200..500
GOMEMLIMIT unset
```

Goal: minimise total GC CPU. Let the heap grow large between collections. Memory is cheap on a batch node. Throughput is what matters.

### Recipe: very small heap, very high request rate

```
GOGC = 50
GOMEMLIMIT = small
```

If your steady-state heap is tiny (a few MB) and you allocate burstily, the default `GOGC=100` means each cycle wastes proportional time on bookkeeping. Lower `GOGC` keeps the heap small and the cycles cheap.

### Recipe: long-lived data structures

```
GOGC = 200..500
GOMEMLIMIT = container limit minus margin
```

If you have a 4 GB cache that lives forever, scanning it on every GC is waste. Raising `GOGC` reduces scan frequency. `GOMEMLIMIT` keeps growth bounded.

### Recipe: tightly packed container

```
GOGC = off
GOMEMLIMIT = container limit * 0.9
```

This is the "GC only when forced" pattern. Use when the working set is well-known and stable; the runtime collects exclusively in response to memory pressure. Risky — needs measurement.

---

## Allocation Patterns That Hurt

Tuning `GOGC` and `GOMEMLIMIT` is futile if your code allocates badly. The patterns below dominate GC cost.

### Pattern: interface boxing in hot paths

```go
func process(v interface{}) { ... }  // every primitive arg escapes to heap
```

A primitive passed via `interface{}` is boxed. If `process` is called millions of times per second, you create millions of small heap objects.

### Pattern: `append` inside loops without preallocation

```go
var out []int
for _, v := range src {
    out = append(out, transform(v))
}
```

This grows the backing array geometrically. Each reallocation is garbage. Preallocate:

```go
out := make([]int, 0, len(src))
```

### Pattern: returning slices that escape

```go
func freshBuffer() []byte {
    return make([]byte, 1024)
}
```

If a caller stores or passes the returned slice somewhere that outlives the call, the allocation lives on the heap. `sync.Pool` (covered in detail at senior level) is the typical fix.

### Pattern: maps with unbounded key churn

A map that constantly inserts and deletes keys never shrinks. The buckets remain allocated. The GC scans them on every cycle. Sometimes the right answer is to periodically rebuild the map.

### Pattern: strings concatenated in loops

```go
s := ""
for _, p := range parts {
    s += p
}
```

Each `+=` allocates a new string. Use `strings.Builder` (which uses an internal byte slice with amortised growth).

### Pattern: deferred functions in hot allocation paths

`defer` itself causes a small allocation in some scenarios (especially before Go 1.14). In a function called billions of times, even cheap-per-call has a price. Profile with `pprof` before "optimising" — modern Go has made defer nearly free for typical cases.

---

## Common Failures and Their Signatures

### Failure 1: OOM kill under load

**Signature.** Process exits with code 137 (or `oom-killed`). RSS climbed past container limit moments before.

**Diagnosis.** `GOMEMLIMIT` not set or too high relative to cgroup limit.

**Fix.** Set `GOMEMLIMIT` to ~90% of the cgroup limit. Add observability (memory metrics) to detect early.

### Failure 2: GC death spiral

**Signature.** `gctrace` shows P% climbing to 50%+ and staying there. Cycles back-to-back. Throughput collapses.

**Diagnosis.** Live data approaches or exceeds `GOMEMLIMIT`.

**Fix.** Raise `GOMEMLIMIT`, or reduce working set, or remove the limit and accept higher RSS.

### Failure 3: long tail latency

**Signature.** Average request latency is fine, P99 has occasional 10+ ms spikes correlating with GC cycles.

**Diagnosis.** Either large STW (stack scan, finalizer queue) or heavy GC assist on long-running requests.

**Fix.** Reduce allocations on hot paths. Watch goroutine count (lots of goroutines means lots of stacks to scan). Consider raising `GOGC` to reduce cycle count and accept slightly more memory.

### Failure 4: high baseline CPU

**Signature.** CPU profile shows 15–30% of samples in `runtime.gcBgMarkWorker`, `runtime.gcAssistAlloc`, `runtime.scanobject`.

**Diagnosis.** Allocation rate is too high.

**Fix.** Find the top allocators in `pprof --alloc_objects` and `pprof --alloc_space`. Reduce them with pooling, preallocation, or algorithmic change.

### Failure 5: memory grows, then plateaus, then climbs again

**Signature.** A staircase pattern in RSS over hours.

**Diagnosis.** A leak — goroutines accumulating, maps growing, caches not bounded.

**Fix.** No amount of GC tuning helps. Find the leak with `pprof --heap` snapshots taken at the start and at peak.

---

## Self-Assessment

- I can name the four phases of a Go GC cycle and their typical durations.
- I can read every field of a `gctrace=1` line.
- I can write down the formula for the heap goal in terms of `GOGC` and live size.
- I can pick a `GOMEMLIMIT` from a container's memory limit and justify the margin.
- I know the 50% CPU cap and what its visible signature is.
- I can describe at least three allocation patterns that dominate GC cost.
- I can diagnose OOM kills, death spirals, and tail latency spikes from logs alone.
- I know when to prefer `runtime/metrics` over `runtime.MemStats`.

---

## Summary

`GOGC` and `GOMEMLIMIT` reach into a single runtime subsystem — the pacer — that computes a heap goal each cycle and triggers GC when the heap crosses it. The pacer takes the minimum of the `GOGC`-derived goal and the `GOMEMLIMIT`-derived goal, then schedules concurrent mark plus brief STW phases so the cycle finishes near the goal.

At middle level, the productive skill is *reading* gctrace and `runtime/metrics`, recognising patterns (steady, throughput-bound, memory-bound, death spiral), and matching them to the right knob change. The container recipe `GOMEMLIMIT ≈ 90% of cgroup limit` covers most production services. The throughput recipe `GOGC=200..500` covers batch jobs. The latency recipe leaves `GOGC` at default and focuses on allocation reduction.

The real lever remains allocation rate. The pacer is sophisticated, but it cannot make a leaky function frugal. Profiling allocators with `pprof` is the next step beyond setting environment variables.
