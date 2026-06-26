# Memory Layout — Professional Level
> **Topic:** [Memory Layout](README.md)
> **Focus:** Measured performance engineering — `pahole` for struct holes, `perf c2c` for false sharing, hardware cache-miss counters, and quantifying every layout change before and after.

---

## Table of Contents
- [Introduction](#introduction)
- [Prerequisites](#prerequisites)
- [Glossary](#glossary)
- [Core Concepts](#core-concepts)
- [Mental Models](#mental-models)
- [Code Examples](#code-examples)
- [Pros & Cons](#pros--cons)
- [Use Cases](#use-cases)
- [Coding Patterns](#coding-patterns)
- [Best Practices](#best-practices)
- [Edge Cases & Pitfalls](#edge-cases--pitfalls)
- [Summary](#summary)

---

## Introduction

Everything in the lower tiers was a *hypothesis*: "reorder these fields and the struct shrinks," "split hot from cold and the scan speeds up," "pad this counter and contention disappears." The professional tier is about **proving it with instruments** — and, just as often, discovering that the obvious layout change made no difference (or made things worse) on real hardware.

Memory-layout performance is invisible in source code and counterintuitive in practice. The only honest way to do it is to measure: inspect actual struct layout with `pahole`, attribute slowdowns to specific cache events with hardware performance counters, and pinpoint false sharing with `perf c2c`. This tier is a toolbox and a methodology: change one thing, measure the named counter that should move, keep it only if it did.

---

## Prerequisites

- Senior-tier command of AoS/SoA, pointer chasing, headers, and DOD.
- Comfort on Linux with `perf`, building with debug info (`-g`), and reading disassembly.
- You can write a representative microbenchmark and know its pitfalls (warmup, dead-code elimination, page faults polluting the first run).
- Conceptual grasp of the cache-coherence protocol (MESI/MESIF/MOESI): Modified/Exclusive/Shared/Invalid line states and the transitions that cost cycles.

---

## Glossary

- **`pahole`** (*poke-a-hole*, from the `dwarves` package) — reads DWARF debug info and prints a struct's exact byte layout, marking padding **holes** and the cache-line boundaries crossed.
- **`perf c2c`** (*cache-to-cache*) — a `perf` mode that samples loads/stores via PEBS and reports **HITM** events (a load that Hits a Modified line in *another* core's cache), the fingerprint of false/true sharing, down to the offending cache line and offset.
- **HITM** — *Hit Modified*: a memory access served from a remote core's cache line that was in Modified state. Cross-core HITM is the smoking gun of contention.
- **PEBS** (Intel) / **IBS** (AMD) — Precise Event-Based Sampling: hardware that records the precise instruction and data address of a sampled event, enabling per-line/per-offset attribution.
- **LLC** — Last-Level Cache (usually L3), shared across cores.
- **MPKI** — Misses Per Kilo-Instructions: a normalized cache-miss rate (`misses / instructions * 1000`) for comparing across runs of different length.
- **Cycles stalled on memory** — `cycle_activity.stalls_l3_miss` and kin: the share of cycles the core sat idle waiting on memory, the bottom-line cost of bad layout.

---

## Core Concepts

### 1. See the actual layout: `pahole`

Never reason about padding from your head — extract ground truth from the binary's debug info:

```
$ pahole -C Conn ./myprogram
struct Conn {
        int                fd;                   /*     0     4 */
        /* XXX 4 bytes hole, try to pack */
        uint64_t           bytes_sent;           /*     8     8 */
        uint64_t           bytes_recv;           /*    16     8 */
        char               peer_name[64];        /*    24    64 */
        /* --- cacheline 1 boundary (64 bytes) was 24 bytes ago --- */
        ...
        /* size: 224, cachelines: 4, members: 6 */
        /* sum members: 220, holes: 1, sum holes: 4 */
        /* last cacheline: 32 bytes */
};
```

`pahole` tells you exactly: the size, the **holes** (padding) and their bytes, where **cache-line boundaries** fall (so you see which fields straddle lines), and `sum members` vs `size` (the padding overhead). `pahole --reorganize -C Conn` proposes a reordered layout that minimizes holes. This is the first thing to run on any hot struct — it turns "I think there's padding" into a byte-exact map.

It also exposes the cache-line crossings that matter: a field starting at offset 60 and spanning to 68 straddles a line boundary, costing two fills to read. `pahole` shows the `/* cacheline N boundary */` comments inline.

### 2. Attribute the cost: hardware cache-miss counters

A wall-clock difference doesn't tell you *why*. The CPU's PMU (Performance Monitoring Unit) does. The events you actually use:

```
$ perf stat -e \
    instructions,cycles,\
    cache-references,cache-misses,\
    L1-dcache-loads,L1-dcache-load-misses,\
    LLC-loads,LLC-load-misses,\
    cycle_activity.stalls_l3_miss \
    ./bench
```

Read it as a funnel: `L1-dcache-load-misses` that also miss L2 fall to LLC; `LLC-load-misses` go all the way to DRAM (~200+ cycles each). The decisive number is **`cycle_activity.stalls_l3_miss`** — cycles the core stalled with nothing to do but wait on memory. If your layout change cut LLC misses but `stalls_l3_miss` didn't drop, the misses weren't on the critical path (the prefetcher or out-of-order execution hid them) and your "optimization" bought nothing.

Normalize with **MPKI** so you can compare runs of different instruction counts:

```
MPKI = LLC-load-misses / instructions * 1000
```

A bulk scan over a well-laid-out array should have low MPKI; pointer chasing shows high MPKI and high memory-stall cycles even at the same Big-O.

For pointer chasing specifically, watch **`mem_load_retired.l3_miss`** and the average **memory latency** — chasing is latency-bound (dependent loads), so IPC collapses while the core idles.

### 3. Find false sharing: `perf c2c`

False sharing is the hardest layout bug to find by reading code, because the two contending fields look unrelated. `perf c2c` finds it directly:

```
$ perf c2c record -- ./multithreaded_bench
$ perf c2c report --stdio
```

The report ranks **cache lines** by cross-core contention and, crucially, breaks each hot line down **by offset** — showing which two fields, at which byte offsets, are written by which CPUs. The columns to read:

- **HITM (Rmt/Lcl)** — remote vs. local hit-on-modified counts. High **Rmt HITM** on one line = cores on different sockets/cores fighting over it.
- **Cacheline** address and the **Tot loads/stores** sampled to it.
- The per-offset table: e.g., offset 0x0 stored by CPU 2, offset 0x8 stored by CPU 5 — that's your false-sharing pair.

The workflow: `perf c2c` names the line and the two offsets → map offsets back to fields with `pahole` → pad/separate those fields → re-record and confirm the HITM count collapsed. This loop is how false sharing is fixed in production; it is not guesswork.

> Distinguish **false** from **true** sharing. `perf c2c` shows contention either way. If the two offsets are genuinely the *same* logical datum two threads must coordinate on, that's true sharing — padding won't help; you need an algorithmic change (sharding, per-thread accumulation, a different sync strategy). Only *false* sharing (unrelated fields on one line) is fixed by separation.

### 4. Quantifying AoS→SoA and prefetch behavior

When converting AoS→SoA, the metrics that should move:

- **Cache-line utilization** rises: fewer bytes loaded per useful byte. Estimate as `(bytes you read) / (cache-line bytes touched)`; SoA pushes it toward 1.0 for single-field scans.
- **LLC-load-misses and DRAM bandwidth** fall for the same work (each line is fully consumed).
- **Vectorization** appears: check `perf stat` for higher IPC and inspect the disassembly / compiler vectorization report (`-Rpass=loop-vectorize` in Clang, `-fopt-info-vec` in GCC) to confirm SIMD instructions (`vaddps` etc.) replaced scalar ones.
- **Hardware prefetcher** effectiveness: contiguous SoA arrays trigger the streaming prefetcher; counters like `l2_rqsts.pf_hit` / prefetch-related events confirm lines arrived before use. Pointer chasing shows the opposite — `stalls_l3_miss` dominates because dependent loads can't be prefetched.

DRAM bandwidth itself can be read via `perf stat -e uncore_imc/data_reads/,uncore_imc/data_writes/` (Intel uncore) or tools like `pcm-memory`, `likwid-perfctr`, or Intel VTune's memory-access analysis — essential when you suspect a scan is bandwidth-bound rather than latency-bound.

### 5. Methodology: change one thing, watch the named counter

The professional discipline is hypothesis-driven:

1. **Profile first.** Identify the hot loop and whether it's bandwidth-bound (high DRAM traffic, prefetch working) or latency-bound (high `stalls_l3_miss`, low IPC, dependent loads). The fix differs.
2. **Form a hypothesis** with a *named counter*: "reordering will remove 8 bytes of padding (confirmed by `pahole`), raising line utilization and cutting LLC misses ~15%."
3. **Change exactly one thing.**
4. **Re-measure the same counter.** If it didn't move as predicted, the model was wrong — investigate, don't cargo-cult.
5. **Confirm end-to-end.** Counters can improve while wall-clock doesn't (the bottleneck moved elsewhere). The user-visible metric is the verdict.

---

## Mental Models

- **"`pahole` is ground truth; your mental model is a guess."** Always confirm layout from debug info before optimizing.
- **"Misses you can't see in `stalls_l3_miss` are free."** Out-of-order execution and prefetching hide misses that aren't on the dependency-critical path. Optimizing those wastes effort. Only stalls that block retirement cost wall-clock.
- **"`perf c2c` HITM = the bytes are fighting."** A high remote-HITM line is two cores ping-ponging; check whether it's false (separate fields → pad) or true (same datum → re-architect).
- **"Latency-bound vs. bandwidth-bound is the first fork."** Pointer chasing is latency-bound (fix: flatten, prefetch, fewer hops). Bulk scans are bandwidth-bound (fix: SoA, compression, touch fewer bytes). Different problems, different tools.
- **"Bench the system, trust the counter, ship on the wall-clock."** Three layers of truth; all must agree before you claim a win.

---

## Code Examples

### Confirming a false-sharing fix end-to-end (Go + perf)

```go
// counters_bench.go — toggle PADDED via build tag or const.
package main

import ("runtime"; "sync"; "sync/atomic")

const PADDED = true

type Slot struct {
    n uint64
    _ [56]byte // pad to 64B when PADDED; remove to reproduce false sharing
}

func main() {
    n := runtime.NumCPU()
    slots := make([]Slot, n)
    var wg sync.WaitGroup
    for i := 0; i < n; i++ {
        wg.Add(1)
        go func(p *uint64) {
            defer wg.Done()
            for k := 0; k < 200_000_000; k++ {
                atomic.AddUint64(p, 1)
            }
        }(&slots[i].n)
    }
    wg.Wait()
}
```

```
# Reproduce, then verify the fix:
$ go build -o bench counters_bench.go
$ perf c2c record -- ./bench
$ perf c2c report --stdio | head -40
# Unpadded: one cacheline dominates with high Rmt HITM, multiple CPUs
#           storing to offsets 0x0, 0x40-spaced... (struct < 64B -> shared line)
# Padded:   HITM collapses; each Slot owns its line; near-linear scaling.
```

### Reading `pahole` and applying its suggestion

```
$ pahole --reorganize -C Conn ./myprogram
# /* Saved 8 bytes! */  -- and prints the reordered struct.
# Apply the suggested field order, rebuild, re-run pahole to confirm
# "holes: 0" (or as few as the alignment rules permit).
```

### Confirming vectorization after AoS→SoA (Clang)

```
$ clang -O2 -Rpass=loop-vectorize -Rpass-missed=loop-vectorize step.c
# step.c:12:5: remark: vectorized loop (vectorization width: 8, ...) [SoA win]
# If you instead see "loop not vectorized: cannot prove ... aligned/contiguous",
# the AoS stride or aliasing blocked it — that's the measurable reason SoA helps.
$ perf stat -e instructions,cycles ./step   # IPC should rise post-vectorization
```

---

## Pros & Cons

| Tool | Strength | Limitation |
|------|----------|------------|
| **`pahole`** | Exact byte layout, holes, line crossings, auto-reorg suggestion | Needs DWARF (`-g`); static view — says nothing about runtime access patterns |
| **`perf stat` counters** | Attributes cost to cache levels; MPKI normalizes | Counters are noisy; event availability varies by CPU; must know which event matters |
| **`perf c2c`** | Pinpoints false/true sharing to line + offset + CPU | PEBS-only events; sampling can miss rare contention; can't distinguish false vs. true for you |
| **VTune / `likwid` / `pcm`** | Rich memory/bandwidth/topology view, roofline | Heavier setup; vendor/arch-specific; sometimes needs root/MSR access |

The cost of all this is **time and rigor**. Counters lie if misread; benchmarks lie if unrepresentative. The discipline pays off only when applied to genuinely hot code — profiling tells you where that is.

---

## Use Cases

- **Pre-merge struct audit:** run `pahole` on hot structs in CI; fail the build if padding exceeds a budget or a hot struct grows past a cache-line target.
- **Diagnosing "doesn't scale past N cores":** `perf c2c` on the contended workload almost always reveals false sharing in a shared counter, lock array, or queue index.
- **Validating a SoA migration:** prove LLC misses, DRAM bandwidth, and IPC all moved the right way, not just wall-clock.
- **Latency-bound pointer-chasing investigation:** confirm `stalls_l3_miss` dominates, then prove a flattening/arena change reduced it.

---

## Coding Patterns

- **`pahole` in CI:** scriptable layout regression test (`pahole -C HotStruct | grep -c hole`), gating struct bloat.
- **A/B benchmark harness:** identical binary built two ways (padded/unpadded, AoS/SoA) behind a flag, run under `perf stat`/`perf c2c`, diff the named counters.
- **Software prefetch (last resort):** for unavoidable pointer chasing, `__builtin_prefetch(node->next)` a few hops ahead — measure, because it as often hurts as helps.
- **Layout assertions in code:** `static_assert(sizeof(Hot) <= 64)`, `static_assert(offsetof(S, hot) % 64 == 0)` — encode layout invariants so refactors can't silently break them.
- **Counter-tagged commits:** record the before/after `perf stat` numbers in the commit message of a layout change, so the win (or its later regression) is auditable.

---

## Best Practices

1. **Run `pahole` before touching a struct.** Optimize from the byte-exact map, not intuition; rebuild and re-run to confirm holes closed.
2. **Tie every change to a named counter prediction**, and reject changes whose predicted counter didn't move — that means your model was wrong.
3. **Diagnose latency-bound vs. bandwidth-bound first.** `stalls_l3_miss` + low IPC + dependent loads = latency (flatten/prefetch). High DRAM traffic + working prefetch = bandwidth (SoA/compress/touch less).
4. **Use `perf c2c` for any scalability cliff** before assuming locks or GC; false sharing masquerades as both.
5. **Distinguish false from true sharing** before padding; padding true sharing wastes memory and fixes nothing.
6. **Confirm end-to-end on wall-clock and a representative workload.** Microbenchmarks and counters are necessary but not sufficient; the bottleneck can move.
7. **Pin threads and control frequency scaling** during measurement (`taskset`, `cpupower`), or counter noise will swamp the signal.

---

## Edge Cases & Pitfalls

- **`pahole` with LTO/optimized builds** can show layouts that differ from your source expectation (the compiler may have its own representation); read the actual debug info, and beware stripped binaries (no DWARF, no output).
- **Counter misattribution.** PEBS skid (pre-Adaptive-PEBS) and sampling can attribute an event to a nearby instruction. Cross-check with multiple runs and `:pp` precise modifiers.
- **`perf c2c` needs enough samples.** Rare contention may not surface; lengthen the run or raise the sampling rate, and ensure the workload actually exercises the contended path.
- **Optimizing hidden misses.** Cutting LLC misses that the out-of-order engine already hid yields zero wall-clock gain — always check `stalls_l3_miss`, not just miss counts.
- **NUMA effects masquerade as layout problems.** Cross-socket remote-HITM and remote-DRAM latency can dominate; `perf c2c` shows remote vs. local, and the fix may be NUMA placement (`numactl`, first-touch allocation), not field reordering.
- **128-byte adjacency prefetch.** On CPUs with the L2 adjacent-line/spatial prefetcher, two "separate" 64-byte lines can still be pulled as a 128-byte pair — anti-false-sharing padding sometimes needs 128 bytes (what `crossbeam::CachePadded` does per-arch).
- **Benchmark artifacts.** Dead-code elimination removing your hot loop, first-iteration page faults, turbo/thermal throttling, and a cold cache on run 1 all produce false readings. Warm up, prevent elimination (consume the result), pin, and repeat.
- **Compiler defeats your layout silently.** Auto-vectorization can regress after an unrelated change; gate it with vectorization remarks in CI if it's load-bearing.

---

## Summary

- Professional layout work is **measurement-driven**: hypotheses from the lower tiers must be confirmed (or refuted) with instruments on real hardware.
- **`pahole`** gives the byte-exact struct layout — holes, sizes, cache-line crossings, and an auto-reorganize suggestion. Run it first; it replaces guessing.
- **Hardware counters** (`perf stat`: LLC-load-misses, MPKI, and especially **`cycle_activity.stalls_l3_miss`**) attribute slowdowns to specific cache levels and distinguish **latency-bound** (pointer chasing) from **bandwidth-bound** (bulk scans) problems — which require different fixes.
- **`perf c2c`** pinpoints false (and true) sharing to the cache line, byte offset, and CPU via **remote HITM** events; the fix loop is c2c → `pahole` → pad/separate → re-record to confirm HITM collapsed.
- The methodology is **change one thing, watch the named counter, ship on the wall-clock** — and only do this on code that profiling proved is hot.
- Beware the traps: hidden misses (no wall-clock gain), NUMA masquerading as layout, 128-byte adjacency prefetch, true-vs-false sharing confusion, and benchmark artifacts.

This completes the four learning tiers. See **interview.md** for question practice and **tasks.md** for hands-on exercises that put `pahole`, `perf c2c`, and the AoS/SoA transform into your hands.
