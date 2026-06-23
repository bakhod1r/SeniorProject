# GOGC and GOMEMLIMIT — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Concurrent Tri-Colour Mark and the Write Barrier](#concurrent-tri-colour-mark-and-the-write-barrier)
3. [GC Assist Accounting](#gc-assist-accounting)
4. [Interaction with sync.Pool](#interaction-with-syncpool)
5. [Escape Analysis as a First-Order Tuning Lever](#escape-analysis-as-a-first-order-tuning-lever)
6. [The Pacer Internals — Beyond the Black Box](#the-pacer-internals--beyond-the-black-box)
7. [Reading gctrace at the Senior Level](#reading-gctrace-at-the-senior-level)
8. [Operational Anti-Patterns](#operational-anti-patterns)
9. [Designing Services Around the GC](#designing-services-around-the-gc)
10. [Self-Assessment](#self-assessment)
11. [Summary](#summary)

---

## Introduction

At senior level the question shifts from "how do I tune `GOGC`?" to "how do I design a service so that `GOGC` rarely needs to be touched?" The answers come from understanding the algorithm itself — concurrent tri-colour mark, write barriers, GC assist accounting — and from making architectural choices (pooling, slab reuse, immutable shared structures) that keep allocation rate low and heap shape friendly.

After this file you will:

- Walk through Go's concurrent mark algorithm and explain why it needs a write barrier
- Reason about GC assist debits and credits and predict when assist will dominate latency
- Design and review `sync.Pool` usage with full awareness of how the pool interacts with each GC cycle
- Use escape analysis to push allocations off the heap entirely
- Read the pacer's source-level signals (`triggerRatio`, scannable bytes, mark assist ratio)
- Recognise anti-patterns at the service-design level, not just the line-of-code level

The middle file teaches you to read the trace. The senior file teaches you to predict the trace.

---

## Concurrent Tri-Colour Mark and the Write Barrier

Go uses a **tri-colour, concurrent, non-moving, non-generational mark-and-sweep** collector. Each adjective matters.

### Tri-colour

At any moment during mark, every heap object is one of three colours:

- **White** — not yet visited. Candidate for collection.
- **Grey** — visited, but its outgoing pointers not yet scanned.
- **Black** — visited *and* all pointers scanned.

The mark phase starts with all objects white and a worklist of grey roots (globals, goroutine stacks). It pops greys, blackens them, and pushes their pointed-to children as new greys. Mark ends when the worklist is empty. Anything still white is unreachable and will be swept.

The classical safety invariant: **no black object may point directly to a white object**. If it did, the white object would never be discovered before sweep frees it.

### Concurrent

Concurrent mark means the mutator (your program) runs at the same time. That risks violating the invariant: your program could create a pointer from a black object to a white one, and the GC would miss the white object.

### The write barrier

The fix is the **write barrier**: a tiny piece of code injected at every pointer write during the mark phase. Go uses a **hybrid write barrier** (since Go 1.8) that combines two classical techniques (Dijkstra and Yuasa):

```
// Conceptual write barrier (not literal Go code):
writePointer(slot *Pointer, new *Object) {
    if isMarking {
        shade(new)          // mark new as grey (Dijkstra-style)
        shade(*slot)        // mark old as grey (Yuasa-style)
    }
    *slot = new
}
```

The "shading" means: if not already black or grey, mark grey and add to worklist. The hybrid barrier lets Go skip a final stack rescan that older designs required, dropping STW2 to sub-millisecond.

### Why the barrier matters for tuning

Every pointer write during mark pays a small cost: a branch, sometimes an atomic. Most code does very few pointer writes per nanosecond, so the cost is invisible. But code that bulk-copies structures (`copy([]ptr, ...)`, large struct assignments holding pointer fields) can amplify barrier cost. If you see anomalous CPU spikes during GC mark, the write barrier on a hot pointer-update path is a candidate.

### Non-moving and non-generational

Go does *not* relocate objects. Pointers are stable across GC cycles, which simplifies cgo interop and lets the runtime hand out direct addresses. The trade-off: no compaction, so fragmentation matters. The allocator (size-class spans) is designed to limit fragmentation cost.

Go is also non-generational. Most collectors observe that "most objects die young" and partition the heap into young/old generations, scanning young more often. The Go team has analysed this trade-off repeatedly and found that the cost of generational bookkeeping (especially the necessary write barrier on every pointer write to old, even outside mark phase) is not worth it for typical Go workloads. The decision is revisited periodically; as of Go 1.21 the answer remained "no generations."

---

## GC Assist Accounting

GC assist is the mechanism that keeps allocation rate from outpacing mark rate. Without it, a runaway allocator could push the heap past the goal before mark finishes, breaking the invariant that mark completes before the heap reaches its limit.

### The debit/credit model

Every byte allocated during the mark phase incurs a **GC debit**: a small amount of mark work the allocator must "pay" before its allocation succeeds. The runtime pre-credits each goroutine with some slack so most allocations are free. When credit runs out, the allocating goroutine is parked into the mark queue and forced to scan objects until its debit is repaid.

The math:

```
gcController.assistWorkPerByte =
    (heap to scan) / (heap to allocate before goal)
```

If a lot of heap remains to scan and not much allocation budget is left before the goal, `assistWorkPerByte` is high, and allocations pay heavily. If mark is mostly done and there's plenty of room before the goal, `assistWorkPerByte` is low, and allocations sail through.

### Visible signature

GC assist time shows up in two places:

- **`gctrace` line:** the `assist` value in the CPU breakdown rises.
- **`runtime/pprof` CPU profile:** samples in `runtime.gcAssistAlloc`.

A request that suddenly takes 50 ms instead of 5 ms because it had to mark a couple of MB of heap on the side is the canonical pattern. The latency leaks *into* the request handler.

### Why GC assist matters for SLOs

If your tail latency budget is 100 ms and a single request can be assigned 30 ms of GC assist work, every cycle is a roulette spin for that request. The mitigations are:

1. **Reduce allocation rate.** Less debit per request.
2. **Raise `GOGC` so fewer cycles happen.** Each cycle costs assist time on whoever is unlucky.
3. **`GOMEMLIMIT` tightening can backfire.** The tighter the ceiling, the larger the per-byte assist when the runtime is racing the limit.
4. **Avoid allocations in the critical section of a request.** Pool buffers up front.

### Idle workers and dedicated workers

The runtime starts each cycle with two kinds of mark workers:

- **Dedicated workers** — pinned to mark for the duration of the cycle (up to 25% of `GOMAXPROCS`).
- **Fractional / idle workers** — fill in when a P would otherwise be idle.

If your service has many cores but is not CPU-bound, idle workers do most of the marking for free. If your service is fully CPU-bound on every core, only dedicated workers contribute, and the rest spills into assist on user goroutines.

This is why a service running at 30% CPU often shows tiny GC overhead, while the same service at 95% CPU appears to "discover" GC pain — the idle channel for marking disappears.

---

## Interaction with sync.Pool

`sync.Pool` is the most important user-facing tool for reducing GC pressure. The two interact in specific ways that you must understand to design pools well.

### What the pool does on GC

Each `sync.Pool` is purged at the start of every GC cycle. Items move from the *main pool* to the *victim cache* (added in Go 1.13). The *victim cache* survives one more cycle, then is dropped. Effective rule: **an item lives in the pool for at most one full GC cycle.**

This is why pooling does not hide a memory leak. Whatever is in the pool will be released by the next-but-one collection unless someone takes it out and puts it back.

### Why this matters for GC tuning

A `sync.Pool` makes allocation rate look smaller (because reused buffers don't allocate). This in turn keeps the heap goal small (live heap stays small), which keeps the heap goal small (the cycle pulse shortens slightly). But because the pool itself is dropped each cycle, **its contents return to the heap goal calculation** between cycles in a way that surprises people.

Concretely: a pool holding 100 buffers of 64 KiB caches 6.4 MiB of allocation cost. At the next GC, that 6.4 MiB is freed back. So the "savings" are real per-request but bounded per-cycle.

### Pool sizing relative to GC cycle time

If GC fires every 2 seconds and your service handles 10,000 req/s, then per cycle the pool sees ~20,000 `Get`/`Put` operations. The hit rate depends on whether the pool retains enough items between cycles. A pool with capacity ~`req/s × cycle_seconds × concurrency_factor` is roughly right.

### When pooling hurts

- **Tiny objects.** Pooling a 16-byte struct costs more in pool bookkeeping than the allocation saves.
- **Variable-size buffers.** A pool of `[]byte` with hugely varying sizes either wastes memory (always allocate worst-case) or fragments (some buffers always too small). Two-pool or size-class schemes are usually better.
- **Pointer-heavy structures.** Each pooled item adds to the mark workload. A small win on allocation can be a small loss on mark scan.

### Pool with bounded GC overhead

```go
package main

import (
    "sync"
)

const bufSize = 64 * 1024

var bufPool = sync.Pool{
    New: func() any {
        b := make([]byte, bufSize)
        return &b
    },
}

func getBuf() []byte {
    p := bufPool.Get().(*[]byte)
    return (*p)[:bufSize]
}

func putBuf(b []byte) {
    if cap(b) < bufSize {
        return // drop weird buffers, don't pollute pool
    }
    b = b[:bufSize]
    bufPool.Put(&b)
}
```

Two senior-level details: pool a pointer to a slice (avoids the small allocation of the slice header on `Get`), and validate size on `Put` so a caller cannot poison the pool with shrunken buffers.

---

## Escape Analysis as a First-Order Tuning Lever

The cheapest allocation is the one that does not happen. Go's compiler runs **escape analysis** to decide which values stay on the goroutine stack and which "escape" to the heap. Stack allocations cost effectively nothing and are reclaimed automatically at function return. Heap allocations enter the GC's accounting.

### Inspecting escapes

Use the compiler's reporting:

```sh
go build -gcflags='-m -l' ./...
```

This prints lines like:

```
./foo.go:12:6: &User{...} escapes to heap
./foo.go:23:13: leaking param: name
./foo.go:31:9: ... argument does not escape
```

`leaking param` means a parameter escapes via a pointer that outlives the call.

### Common escape causes

1. **Returning a pointer.** `return &x` makes `x` escape.
2. **Storing a pointer in a heap value.** Putting a pointer into a slice or map that outlives the call.
3. **Interface conversion.** `var i interface{} = x` where `x` is a non-pointer often escapes `x`.
4. **Calling a function via interface where the implementation captures the receiver.**
5. **Large stack frames.** Some compilers move very large locals to the heap.

### Refactoring to keep values on the stack

```go
// Escapes:
func newPoint() *Point {
    return &Point{X: 1, Y: 2}
}

// Stays on stack at call site:
func makePoint() Point {
    return Point{X: 1, Y: 2}
}
```

Returning a value instead of a pointer is sometimes the right call — the copy cost is far less than an allocation plus the GC bookkeeping later.

### Mixing escape analysis with GOGC tuning

If 80% of your allocations come from one function returning a pointer that didn't need to be a pointer, no `GOGC` value will save you. Fix the escape first, then re-measure.

---

## The Pacer Internals — Beyond the Black Box

The pacer lives in `runtime/mgcpacer.go`. You do not need to read every line, but a few quantities are worth knowing.

### `gcController.heapLive`

Bytes currently in live heap objects, updated as allocations happen. The pacer compares this to `heapGoal` to decide when to start the next cycle.

### `gcController.heapGoal`

The target heap size for the *next* GC trigger, derived from `GOGC`, `GOMEMLIMIT`, and the previous live size.

### `gcController.triggerRatio`

A learned value: how much before `heapGoal` the runtime should start GC so that mark finishes at the right time. If past cycles consistently finished early, the trigger ratio rises (start later, save CPU). If they finished late and forced assists, it falls.

### `gcController.assistWorkPerByte`

The "tax rate" on allocations during mark. Determined dynamically based on remaining work and remaining budget.

### `gcController.scannableBytes`

The amount of *scannable* heap — bytes inside heap objects that *could* contain pointers. Not all heap bytes are scannable (a `[]byte` has no pointers; a `[]*User` does). This is the actual workload of mark.

### How to read pacer behaviour from `runtime/metrics`

```go
package main

import (
    "fmt"
    "runtime/metrics"
)

func dump() {
    names := []string{
        "/gc/heap/live:bytes",
        "/gc/heap/goal:bytes",
        "/gc/scan/heap:bytes",
        "/gc/scan/globals:bytes",
        "/gc/scan/stack:bytes",
        "/gc/cycles/total:gc-cycles",
        "/cpu/classes/gc/total:cpu-seconds",
        "/cpu/classes/gc/mark/assist:cpu-seconds",
    }
    samples := make([]metrics.Sample, len(names))
    for i, n := range names {
        samples[i].Name = n
    }
    metrics.Read(samples)
    for _, s := range samples {
        fmt.Println(s.Name, s.Value)
    }
}
```

The ratio of `mark/assist` to `total` GC CPU tells you how much GC cost is leaking into user goroutines as assist debt. If that fraction is high, your allocation rate is fighting the runtime.

---

## Reading gctrace at the Senior Level

At middle level you decode the fields. At senior level you correlate them with system state.

### Detecting an assist-heavy cycle

```
0.018+0.42+0.01 ms clock, 0.14+2.40/0.20/0.40+0.08 ms cpu
                            ^^^^
                            assist CPU
```

That `2.40 ms` is the time stolen from user goroutines for marking. If it's much larger than `background/idle`, your users are paying the GC.

### Detecting stack scan dominance

A line where `stacks` MB is comparable to the heap is a tell that goroutine count is high or per-goroutine stacks are huge:

```
... 96->100->48 MB, 100 MB goal, 200 MB stacks, ...
```

200 MB of stacks indicates either lots of goroutines (thousands of long-running ones) or deep recursion. Each goroutine costs stack memory that mark must scan.

### Detecting a recovery-after-spike pattern

After a burst, you may see a cycle like:

```
gc 50 @60.1s 5%: ... 100->500->100 MB, 200 MB goal
                            ^^^
                            big growth during mark
```

The `100 -> 500 -> 100` means 100 MB at start, 500 MB at mark termination, 100 MB live. A burst allocation phase happened during mark itself. The next cycle will set a goal of 200 MB (`100 * 2`), but for one cycle the heap ballooned. Watch RSS; with `GOMEMLIMIT` this scenario triggers tighter pacing.

### Detecting CPU-cap clamp

```
gc N @TIMEs 50%: ...   while heap continues to grow
```

`50%` consistent across cycles, no improvement in live size, RSS climbing. This is the runtime's CPU cap kicking in: it would prefer to dedicate more CPU but refuses to go above ~50%. Either raise `GOMEMLIMIT` or reduce working set.

---

## Operational Anti-Patterns

### Anti-pattern: synchronous `runtime.GC()` after every request

A web service calls `runtime.GC()` in a deferred handler "to keep memory low." Every request becomes a synchronous global GC — throughput collapses, P99 goes vertical. **`runtime.GC()` is never appropriate in a per-request path.**

### Anti-pattern: pooling everything

A team reads "sync.Pool reduces GC" and pools every struct, including 24-byte option structs. The pool bookkeeping costs more than the allocation. Benchmark before pooling.

### Anti-pattern: `GOMEMLIMIT` set without a margin

A pod with `limits.memory: 512Mi` and `GOMEMLIMIT=512MiB`. The kernel limit accounts for everything — stacks, runtime overhead, file caches. The Go limit accounts only for what `MemStats.Sys` sees. The 10–20% gap is non-negotiable.

### Anti-pattern: tuning before profiling

A team raises `GOGC=300` because a blog post said so. They never profiled. Their actual problem was a leaking goroutine pool, and the leak now eats memory faster because GC runs less often.

### Anti-pattern: `GOGC=off` plus a generous `GOMEMLIMIT`

In theory: GC only when forced by memory pressure. In practice: long, jagged pauses, terrible tail latency. This works in batch contexts and almost nowhere else.

### Anti-pattern: chasing `gctrace` percentages

A team sees "GC is 8% of CPU" and tunes until it reads "3%." The user-visible latency does not change. They have optimised the wrong number. The right metrics are P99 latency and throughput; GC% is only useful as a hint.

---

## Designing Services Around the GC

Senior-level GC work is mostly architecture, not configuration.

### Principle 1: separate hot paths from allocations

Allocate buffers, slices, maps, decoder state up front. Reuse them. The request handler should ideally allocate nothing on the happy path.

### Principle 2: keep working set predictable

A cache that grows to 1 GiB and stays at 1 GiB is friendlier to the GC than one that oscillates between 500 MiB and 1.5 GiB. Steady state lets the pacer settle into a low-CPU regime.

### Principle 3: prefer value types over pointer types

A `map[K]V` with value types is one allocation. A `map[K]*V` is two — and the GC scans every pointer on every cycle. The trade-off (more copy, sometimes more memory) is often worth it.

### Principle 4: bound everything

Unbounded caches, queues, and goroutine pools eventually push memory past `GOMEMLIMIT`. Use bounded structures and a clear eviction policy. The GC is not a substitute for bookkeeping.

### Principle 5: amortise the cost of large structures

If you must keep a large structure (say, an in-memory index), build it once, freeze it, and share immutable references. The GC scans it every cycle; immutability lets you keep it small and contiguous.

### Principle 6: choose your concurrency profile carefully

Many short-lived goroutines means many stack scans. A pool of worker goroutines that consume from a channel scales better than `go handle(req)` for high-rate services. Stack accounting shows up directly in gctrace.

### Principle 7: design for shedding under pressure

When `GOMEMLIMIT` is tight and CPU is climbing because of GC, your service should shed load rather than collapse. Implement load-shedding admission control that watches `runtime.MemStats` or `runtime/metrics` and returns 503 when GC fraction exceeds a threshold.

---

## Self-Assessment

- I can explain the tri-colour invariant and why a write barrier is necessary for concurrent mark.
- I can trace why a request that allocates heavily can have its latency dominated by GC assist.
- I can size a `sync.Pool` for a given request rate and GC cycle length.
- I can find allocations that escape to the heap and rewrite them to stay on the stack.
- I can correlate `runtime/metrics` numbers to pacer behaviour without reading runtime source.
- I can review service code for GC-friendliness at the architecture level.
- I know when *not* to use `sync.Pool` and can justify the decision.

---

## Summary

Concurrent GC in Go is a careful dance between the pacer (deciding when to mark), the write barrier (preserving correctness during mark), and GC assist (preventing the allocator from outrunning the marker). Tuning `GOGC` and `GOMEMLIMIT` moves the dance's tempo, but the choreography is set by the application's allocation rate and heap shape.

Senior-level optimisation is mostly architectural: reduce allocations through `sync.Pool` and escape analysis, keep working set predictable, prefer values to pointers, and bound everything that can grow. With those in place, the runtime's defaults often suffice, and `GOMEMLIMIT` serves as a safety net rather than a daily tuning knob.

The diagnostic vocabulary — write barrier cost, assist debit, scannable bytes, stack scan share, CPU cap — turns gctrace from a mysterious log line into a precise diagnostic. At this level you do not so much *tune* GC as *design with it in mind*.
