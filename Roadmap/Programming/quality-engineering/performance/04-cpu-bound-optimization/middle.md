# CPU-Bound Optimization — Middle Level

> **Roadmap:** [Performance](../README.md) → CPU-Bound Optimization
> *The junior page taught you to suspect the CPU and to profile before touching anything. This page is what you do once the profile points the finger: how to read it, why a cache miss costs 100 arithmetic ops, and the concrete moves — data layout, fewer allocations, inlining, bounds-check elimination, predictable branches — that turn a hot loop from slow to fast.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Reading a CPU Profile — Flat vs Cumulative](#reading-a-cpu-profile--flat-vs-cumulative)
4. [The Memory Hierarchy — Why Cache Misses Dominate](#the-memory-hierarchy--why-cache-misses-dominate)
5. [Data-Oriented Design — Layout Is Performance](#data-oriented-design--layout-is-performance)
6. [Killing Allocations in Hot Loops](#killing-allocations-in-hot-loops)
7. [Function-Call Overhead and Inlining](#function-call-overhead-and-inlining)
8. [Bounds-Check Elimination and Strength Reduction](#bounds-check-elimination-and-strength-reduction)
9. [Branch-Heavy Code and Predictability](#branch-heavy-code-and-predictability)
10. [Worked Example — Reading `perf stat` Before and After](#worked-example--reading-perf-stat-before-and-after)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **The profiler said this function is hot. Now how do I actually make it faster?**

At the junior level, "CPU-bound" is a diagnosis: the core is pinned, the work is real, and the fix is to do less of it. That's correct, but it stops one step short of the part that pays the bills — the *mechanics*. A hot loop that does the "same" arithmetic can run 5–10× slower or faster depending on how its data is laid out, how many times it crosses a function boundary, whether the branch predictor can guess it, and how many objects it allocates per iteration. None of that shows up in the source as "more work." It shows up as **cycles the CPU spends waiting** — for memory, for a mispredicted branch, for the allocator.

This page is about closing that gap. We'll read a CPU profile precisely (flat vs cumulative, self vs total), then walk the techniques that matter once you know where the time goes — almost all of which reduce to *keeping the CPU fed*: contiguous data so the cache works, fewer allocations so the GC stays quiet, inlined hot functions, eliminated bounds checks, and predictable branches. Every section pairs a before/after with a believable benchmark delta, because "it should be faster" is not a measurement.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can explain why you profile *before* optimising.
- **Required:** You can run a profiler — `go tool pprof`, `perf`, or a JVM equivalent — and find the top function.
- **Helpful:** You've written a microbenchmark (`go test -bench`, JMH) and read its output.
- **Helpful:** A rough mental picture of "the CPU is much faster than RAM."

---

## Reading a CPU Profile — Flat vs Cumulative

A CPU profile is a histogram of where the program was when the profiler sampled the stack — typically ~100 times per second per core. Every profiler, regardless of tool, exposes two numbers per function, and confusing them sends you optimising the wrong code.

- **Flat (self) time** — samples landed *directly inside this function's own instructions*, not in something it called. This is the work the function itself does.
- **Cumulative (total) time** — samples landed in this function *or anything it called, transitively*. This is the cost of the whole subtree rooted here.

```
(pprof) top -cum
  flat  flat%   cum   cum%
 0.05s   1.2%  3.80s  89%   main.processBatch     ← huge cum, tiny flat: just a caller
 2.90s  68.0%  2.90s  68%   main.scoreRecord      ← huge flat: THIS is the hot code
 0.40s   9.4%  0.55s  13%   runtime.mapaccess2    ← map lookups, real self cost
```

`processBatch` has 89% cumulative but 1.2% flat — it's a dispatcher; optimising its body buys nothing. `scoreRecord` has 68% *flat* — the actual work lives there. **Optimise on flat time; navigate with cumulative time.** Cumulative tells you which call path to descend; flat tells you where to stop and start editing.

Two refinements make this sharper. First, use the flame graph (`go tool pprof -http=:8080`) to *see* the call tree — width is cumulative time, and a wide plateau with no children on top of it is pure self time, your prime target. Second, watch for `runtime.*` frames bubbling up: a big `runtime.mallocgc` or `runtime.gcBgMarkWorker` means your "CPU" problem is really an *allocation* problem in disguise (see [05 — Memory & Allocation Profiling](../05-memory-and-allocation-profiling/middle.md)).

> **Key insight:** Flat time is *where the cycles burn*; cumulative time is *the route to get there*. A function can dominate the profile (high cumulative) and contain nothing worth fixing (low flat). Always confirm a function's *own* code is hot before you touch it — otherwise you're polishing a hallway.

---

## The Memory Hierarchy — Why Cache Misses Dominate

Here is the single fact that reframes most CPU optimisation: **the CPU is not waiting on arithmetic — it's waiting on memory.** A modern core executes several integer operations *per nanosecond*, but fetching a value that isn't in cache can stall it for ~100 nanoseconds. The arithmetic was never the bottleneck; the *data movement* was.

Rough latencies, in CPU cycles (≈0.3 ns each on a 3 GHz core):

| Where the data is | Latency (cycles) | Latency (ns) | Relative |
|---|---|---|---|
| Register | ~0 | — | 1× |
| L1 cache | ~4 | ~1.3 | ~4× |
| L2 cache | ~12 | ~4 | ~12× |
| L3 cache | ~40 | ~13 | ~40× |
| Main memory (RAM) | ~200 | ~65 | ~**200×** |

An L1 hit and an `add` are roughly the same cost. A trip to RAM is **~100× a single arithmetic operation.** This is why "reduce the number of operations" is often the *wrong* optimisation and "reduce the number of cache misses" is the right one.

Two hardware behaviours you can exploit:

1. **Cache lines.** Memory moves in 64-byte lines, not single bytes. Touch one `int`, and the 7 neighbours on its line come along free. Lay data so the bytes you use next are *on the same line* and you get those accesses essentially for free.
2. **The hardware prefetcher.** The CPU detects *sequential* access patterns and fetches lines ahead of you. Walk an array forward → the prefetcher hides the latency. Chase pointers to random heap addresses → it can't predict, and you eat the full ~200-cycle miss every time.

> **Key insight:** Count cache misses, not operations. A loop doing twice the arithmetic on contiguous, cache-resident data routinely beats a "cleverer" loop that does half the arithmetic but chases pointers across the heap. Memory access *is* the dominant cost; algorithmic op-counting that ignores the memory hierarchy is counting the wrong thing.

---

## Data-Oriented Design — Layout Is Performance

If cache misses dominate, then **how you arrange data in memory is a first-class performance decision** — often bigger than any algorithmic tweak. The canonical lever is *array-of-structs* (AoS) vs *struct-of-arrays* (SoA).

Suppose you score a million particles using only their `x` and `y`, but each particle also carries 48 bytes of other state:

```go
// Array of Structs (AoS) — the natural OO layout
type Particle struct {
    x, y    float64   // 16 bytes we use
    vx, vy  float64
    mass    float64
    name    string    // 16 bytes
    tags    []string  // 24 bytes ... ~64 bytes total
}
particles := make([]Particle, 1_000_000)

func sumX(ps []Particle) (s float64) {
    for i := range ps { s += ps[i].x }   // we read x; the cache line drags 48 unused bytes
    return
}
```

Each `Particle` is ~64 bytes — one whole cache line. To sum `x`, every iteration loads a full line but uses 8 of its 64 bytes. You're paying a memory miss to fetch mostly garbage. Restructure so the hot fields live contiguously:

```go
// Struct of Arrays (SoA) — hot fields packed together
type Particles struct {
    x, y   []float64   // x[] is dense: 8 used bytes per 8 bytes loaded
    vx, vy []float64
    mass   []float64
    name   []string
}

func sumX(p *Particles) (s float64) {
    for _, v := range p.x { s += v }   // pure sequential scan over packed float64s
    return
}
```

Now one cache line holds 8 `x` values, all of which you use, and the prefetcher sees a perfect sequential stream. Same arithmetic, ~6–8× fewer cache misses on the hot field. A typical measured result: **AoS ~4.1 ms, SoA ~0.6 ms** for the million-element sum — a 6–7× win with zero change to the math.

The deeper principle is **reduce pointer chasing.** A `[]*Node` linked list scatters nodes across the heap; traversing it is a sequence of unpredictable misses. A `[]Node` slice (or an index-based "linked list" inside one array) keeps them contiguous and prefetchable. Prefer indices over pointers and contiguous slices over node graphs whenever you traverse hot data.

> **Key insight:** The compiler optimises your *instructions*; only you can optimise your *data layout*. Group the fields you touch together so a 64-byte cache line carries 64 bytes of *useful* data. AoS→SoA is the highest-leverage CPU optimisation that most code never tries.

---

## Killing Allocations in Hot Loops

Every heap allocation in a hot loop costs three ways: the allocation itself, the eventual garbage-collection cost of reclaiming it, and the cache pollution of touching fresh memory. In Go and Java, an allocation-heavy loop often shows up as "CPU time in `runtime.mallocgc`" or "time in GC" — a CPU symptom with an allocation cause.

The fix is **escape analysis awareness** plus **buffer reuse.** Go's compiler tries to keep allocations on the stack (free) rather than the heap (GC-managed); a value *escapes* to the heap when its lifetime outlives the function. Ask the compiler what it decided:

```bash
go build -gcflags='-m' ./...
# ./score.go:14:13: make([]byte, 256) escapes to heap   ← allocated per call, GC'd later
# ./score.go:22:9:  &buf does not escape                  ← stays on stack, free
```

A classic offender allocates a scratch buffer every iteration:

```go
// BEFORE: allocates a fresh slice every call → 1M heap allocs
func format(rows []Row) []string {
    out := make([]string, 0, len(rows))
    for _, r := range rows {
        buf := make([]byte, 0, 64)          // escapes; heap alloc per row
        buf = strconv.AppendInt(buf, r.ID, 10)
        out = append(out, string(buf))
    }
    return out
}
```

Hoist the buffer out and reuse it; for cross-call reuse, a `sync.Pool` gives each goroutine its own scratch space:

```go
// AFTER: one reusable buffer; allocations drop ~1M → a handful
func format(rows []Row) []string {
    out := make([]string, 0, len(rows))
    buf := make([]byte, 0, 64)              // allocated ONCE
    for _, r := range rows {
        buf = buf[:0]                       // reset length, keep capacity
        buf = strconv.AppendInt(buf, r.ID, 10)
        out = append(out, string(buf))
    }
    return out
}
```

`buf[:0]` keeps the backing array and resets length — no new allocation. Benchmark with `-benchmem` to see it land:

```
BEFORE  1240 ns/op   1056 B/op   17 allocs/op
AFTER    410 ns/op    192 B/op    1 allocs/op
```

A 3× speedup, none of it from changing the algorithm — purely from not asking the allocator and GC to run on the hot path. The same pattern in Java is object pooling or, better, primitive arrays instead of boxed `Integer[]`; in C++ it's reserving `std::vector` capacity and reusing it rather than reallocating per call.

> **Key insight:** Allocation is hidden CPU work. Each `make`/`new` in a hot loop schedules future GC, pollutes cache, and is itself non-trivial. `-gcflags=-m` shows what escapes; reuse buffers (`buf[:0]`, `sync.Pool`, preallocated arrays) to take the allocator off the hot path entirely.

---

## Function-Call Overhead and Inlining

A function call is not free: arguments go into registers or onto the stack, the return address is saved, control jumps, and on return everything unwinds. For a tiny function called millions of times, this prologue/epilogue can rival the body's own work — *and* it blocks other optimisations, because the compiler can't reason across a call boundary it doesn't inline.

**Inlining** is the cure: the compiler copies a small callee's body into the caller, eliminating the call overhead and, crucially, exposing the merged code to further optimisation (constant folding, dead-code elimination, bounds-check removal across the seam). Go inlines automatically based on a function's cost budget; check what it decided with the same flag:

```bash
go build -gcflags='-m' ./...
# ./geo.go:8:6: can inline dist          ← small enough; will be inlined
# ./geo.go:20:6: cannot inline solve: function too complex: cost 213 exceeds budget 80
```

```go
func dist(ax, ay, bx, by float64) float64 {   // tiny → inlined
    dx, dy := ax-bx, ay-by
    return dx*dx + dy*dy
}
```

When `dist` is inlined into a hot loop, the call vanishes *and* the compiler can keep `dx, dy` in registers across what used to be a boundary. The reverse trap: a function that's *almost* small enough but trips the budget (often by containing a `defer`, a closure, or a `panic`/`recover`) silently stops inlining and gets slow. If `-m` says `cannot inline ... too complex`, splitting out the hot path into a separate tiny function can restore inlining.

> **Key insight:** Inlining is worth more than the call overhead it removes — it *unlocks* optimisations across the former boundary. Keep hot leaf functions small and free of `defer`/closures so they stay under the inline budget. Don't manually inline by hand first; check `-gcflags=-m` and only intervene where the compiler refuses.

---

## Bounds-Check Elimination and Strength Reduction

In memory-safe languages, every slice/array index access carries an implicit **bounds check** — a compare-and-branch that traps if the index is out of range. In a tight loop, that's an extra branch per element. The compiler *eliminates* the check when it can prove the index is in range; your job is to write code that makes the proof easy.

```go
// BEFORE: compiler can't easily prove each a[i] is in range
func sum(a []int) (s int) {
    for i := 0; i < len(a); i++ { s += a[i] }   // bounds check per iteration (often)
    return
}

// AFTER: range form, or a single hoisted assertion, lets it drop the checks
func sum(a []int) (s int) {
    for _, v := range a { s += v }              // range over slice: no per-elem check
    return
}
```

The idiomatic `range` form is the most reliable way to get bounds checks removed in Go. When you must index, a single `a = a[:n]` reslice or a `_ = a[n-1]` assertion before the loop can give the compiler the fact it needs to elide every check inside. Inspect what's left:

```bash
go build -gcflags='-d=ssa/check_bce/debug=1' ./...
# ./sum.go:3:20: Found IsInBounds   ← a bounds check survives here
```

**Strength reduction** is the sibling technique: replace expensive operations with cheaper equivalent ones, and hoist redundant work out of the loop.

```go
// BEFORE: division per iteration (10–40 cycles each), repeated multiply
for i := 0; i < n; i++ { out[i] = data[i] / 8 ; idx := i * stride }

// AFTER: shift instead of divide; strength-reduce the multiply to an add
shift := 3                                  // 8 == 1<<3
idx := 0
for i := 0; i < n; i++ { out[i] = data[i] >> shift; _ = idx; idx += stride }
```

Division is one of the slowest integer ops; a power-of-two divide becomes a shift. A loop-variable multiply (`i*stride`) becomes a running addition. Compilers do much of this automatically, but hoisting *invariant* computation (anything not depending on the loop variable) out of the loop is squarely your job — recomputing `len(s)` or a struct-field lookup every iteration is pure waste.

> **Key insight:** Memory-safe languages tax you with a hidden branch per index; write loops the compiler can prove safe (`range`, single hoisted assertion) and that tax disappears. Then strip redundant work: hoist loop invariants, replace divide-by-constant with shifts, and let strength reduction turn multiplies into adds.

---

## Branch-Heavy Code and Predictability

Modern CPUs are deeply pipelined: they guess which way a branch will go and execute ~15–20 instructions ahead *speculatively*. A correct guess is free. A **misprediction** throws away that speculative work and refills the pipeline — a penalty of ~15–20 cycles, comparable to an L3 cache miss. A branch the predictor can't guess is therefore expensive *even though the comparison itself is one instruction*.

The famous demonstration: summing only the values above a threshold runs dramatically faster when the array is *sorted*, because the branch becomes predictable.

```go
func sumAbove(a []int, t int) (s int) {
    for _, v := range a {
        if v >= t { s += v }   // unsorted: ~50% mispredict; sorted: ~always right
    }
    return
}
// unsorted input: ~3.2 ms   |   same data sorted first: ~0.9 ms  (≈3.5× from prediction alone)
```

Two ways to help the predictor:

1. **Make branches predictable** — sort or partition data so the common case dominates, or hoist a condition out of the loop so it's decided once instead of per element.
2. **Make branches disappear (branchless code)** — compute both sides and select arithmetically, so there's no branch to mispredict. This wins *only* when the branch was genuinely unpredictable; for a well-predicted branch, the branchful version is faster because the predictor already made it free.

```go
// branchless max — no misprediction possible, but always does both subtractions
func maxBranchless(a, b int) int {
    d := a - b
    return b + (d & (d >> 63))   // sign trick; profile to confirm it actually wins
}
```

> **Key insight:** A mispredicted branch costs as much as an L3 miss — the comparison is cheap, the *wrong guess* is not. Predictable branches (sorted/partitioned data) are nearly free; only reach for branchless tricks when profiling proves the branch is genuinely 50/50, and always measure, because branchless code does *both* sides every time.

---

## Worked Example — Reading `perf stat` Before and After

`perf stat` gives you the hardware view a flame graph can't: instructions-per-cycle (IPC), cache misses, branch mispredictions. These are the numbers that tell you *which* of the techniques above to reach for. Take the AoS particle sum from earlier and measure it before and after the SoA rewrite.

```bash
# BEFORE — AoS layout: summing one field out of a 64-byte struct
perf stat -e cycles,instructions,cache-references,cache-misses,branch-misses ./sum_aos

#   8,940,231,005   cycles
#   6,210,440,118   instructions          #   0.69  insn per cycle   ← IPC < 1: STALLING
#     412,330,901   cache-references
#     198,774,540   cache-misses          #  48.2% of cache refs     ← memory-bound
#       3,221,114   branch-misses
#         4.12 ms   time elapsed
```

IPC of **0.69** is the headline: less than one instruction retired per cycle means the core spends most of its time *waiting*, and the 48% cache-miss rate says it's waiting on memory. This is not a "do less arithmetic" problem — it's a layout problem. Apply SoA so the hot field is contiguous, then re-measure:

```bash
# AFTER — SoA layout: x[] packed contiguously
perf stat -e cycles,instructions,cache-references,cache-misses,branch-misses ./sum_soa

#   1,310,887,442   cycles
#   5,980,002,771   instructions          #   4.56  insn per cycle   ← IPC > 4: FED
#      54,201,338   cache-references
#       2,910,664   cache-misses          #   5.4% of cache refs     ← prefetcher working
#       3,180,201   branch-misses
#         0.61 ms   time elapsed
```

Almost the *same instruction count* (~6 billion), but **6.8× faster wall time** — entirely because IPC jumped from 0.69 to 4.56 and cache misses fell from 48% to 5%. The CPU was always able to do the work; it was starved for data. This is the central lesson made measurable: **on CPU-bound code, the win usually comes from feeding the CPU, not from reducing its arithmetic.**

The diagnostic loop: low IPC + high cache-misses → fix data layout (SoA, contiguity); high IPC but high branch-misses → fix branch predictability; lots of time in `mallocgc`/GC frames → fix allocations. Read the counters first; they tell you which chapter of this page applies.

---

## Mental Models

- **The CPU is a hungry engine and memory is a slow conveyor belt.** Most "slow code" isn't computing too much — it's starving the engine while it waits for the belt. Optimisation is mostly about keeping the engine fed: contiguous data, prefetchable access, fewer round-trips to RAM.

- **Flat time is the address; cumulative time is the directions.** Cumulative tells you which path leads to the cost; flat tells you which function's *own* code to edit. Optimise where flat is high.

- **A cache line is the real unit of memory, not the byte.** You always pay for 64 bytes. Layout that fills a line with useful data is "free" extra accesses; layout that fills it with skipped fields is waste you pay for on every miss.

- **An allocation is a loan from the GC.** It's cheap to take out and expensive to repay later (collection, cache pollution). On a hot path, stop borrowing: reuse buffers and keep values on the stack.

- **A branch is a bet the CPU places ahead of time.** A predictable bet is free; a coin-flip bet costs a pipeline flush. Make the common case dominant so the CPU wins its bets.

---

## Common Mistakes

1. **Optimising on cumulative time.** A function with 90% cumulative and 2% flat is a dispatcher — editing it does nothing. Confirm *flat* time is high before you touch a function.

2. **Counting operations, ignoring memory.** "I halved the arithmetic" can still be slower if it added pointer chasing. A cache miss is ~100 arithmetic ops; optimise misses, not op-counts.

3. **Keeping the OO/AoS layout on hot data.** A struct with 6 fields where the loop reads 1 wastes 80%+ of every cache line. Split hot fields into their own arrays (SoA) before reaching for cleverer math.

4. **Allocating in the loop body.** A `make`/`new` per iteration turns a CPU problem into a GC problem. Hoist and reuse (`buf[:0]`, `sync.Pool`); confirm with `-benchmem` and `-gcflags=-m`.

5. **Hand-inlining instead of asking the compiler.** Inlining is automatic and budget-driven. Don't manually splice functions together — run `-gcflags=-m`, find what *won't* inline, and fix the cause (drop a `defer`, shrink the function).

6. **Reaching for branchless tricks on predictable branches.** Branchless code does both sides every time. It only wins on genuinely unpredictable (≈50/50) branches; on a well-predicted branch it's *slower*. Measure before converting.

7. **Trusting "it's faster" without re-profiling.** Every change shifts the bottleneck. The thing you optimised may no longer be hot; re-run the profiler and `perf stat` after each round.

---

## Test Yourself

1. In a profile, a function shows 85% cumulative and 3% flat. Is it worth optimising? Why or why not?
2. Roughly how many arithmetic operations does one main-memory cache miss cost, and why does that reframe "do less work"?
3. You sum one `float64` field across a million-element `[]BigStruct`. Why is this slow, and what layout change fixes it?
4. A loop allocates a 64-byte scratch buffer each iteration. Name two ways to remove the per-iteration allocation, and the tool that proves it worked.
5. `go build -gcflags=-m` says `cannot inline f: function too complex`. Give two common reasons a small function fails to inline, and why inlining matters beyond saving the call.
6. The same loop runs 3× faster when the input array is sorted first, with identical arithmetic. What hardware behaviour explains this?
7. `perf stat` shows IPC of 0.6 and 45% cache-misses. Which class of optimisation does this point you toward, and which does it rule out?

<details>
<summary>Answers</summary>

1. **No, not directly.** 3% flat means almost none of the *self* time is spent in its own code — it's a caller. Use the cumulative number to descend into the callee that actually has high flat time, and optimise there.
2. **About 100×** (a RAM access is ~200 cycles vs ~1–2 for an arithmetic op/L1 hit). It means reducing *cache misses* often matters far more than reducing instruction count — a loop doing more arithmetic on cache-resident data can beat one doing less on scattered data.
3. Each `BigStruct` fills a cache line, but you use only 8 of its ~64 bytes — every access is a near-miss that drags in unused fields, and the prefetcher works on padded data. Fix: **struct-of-arrays** — put the hot field in its own contiguous `[]float64` so each line is 100% useful and the access is a perfect sequential scan.
4. (a) Hoist the buffer out of the loop and reset with `buf = buf[:0]`; (b) use a `sync.Pool` (or a preallocated array). Prove it with `go test -bench -benchmem` (watch `allocs/op` drop) and `-gcflags=-m` (confirm it no longer escapes).
5. Common causes: it contains a `defer`, a closure, or a `panic`/`recover`, or it simply exceeds the cost budget. Inlining matters beyond the call overhead because it lets the compiler optimise *across* the former boundary — constant-folding, register allocation, and bounds-check elimination through the merged code.
6. **Branch prediction.** With a sorted array the `if v >= t` branch goes one way for a long run, so the predictor is almost always right (free). With random data it mispredicts ~50% of the time, and each miss flushes the pipeline (~15–20 cycles), even though the comparison itself is unchanged.
7. Low IPC + high cache-misses points to a **data-layout / memory** problem — fix contiguity and locality (SoA, reduce pointer chasing). It *rules out* "reduce arithmetic": the core is stalling on memory, not saturated with compute, so cutting instructions won't help.

</details>

---

## Cheat Sheet

```
READ THE PROFILE
  go tool pprof -http=:8080 cpu.prof   flame graph: width=cumulative, plateau=self
  (pprof) top -cum                     navigate by cumulative...
  (pprof) top                          ...but optimise where FLAT is high
  runtime.mallocgc in profile          → it's an ALLOCATION problem, not pure CPU

MEMORY HIERARCHY (≈3GHz, ~0.3ns/cycle)
  L1 ~4cy   L2 ~12cy   L3 ~40cy   RAM ~200cy   ← a miss ≈ 100 arithmetic ops
  cache line = 64 bytes              prefetcher loves SEQUENTIAL access

DATA LAYOUT
  AoS []Struct  → loads whole struct to use one field   (bad for hot scans)
  SoA struct{[]a; []b}  → hot field contiguous          (prefetchable, ~6-8x)
  prefer indices over pointers; []Node over []*Node

ALLOCATIONS (hot loop)
  go build -gcflags=-m       see what escapes to heap
  buf = buf[:0]              reuse: reset length, keep capacity
  sync.Pool                  per-goroutine scratch reuse
  go test -bench -benchmem   watch B/op and allocs/op

COMPILER LEVERS
  -gcflags=-m                            inlining + escape decisions
  -gcflags=-d=ssa/check_bce/debug=1      surviving bounds checks
  range over slice                       reliably elides per-elem bounds check
  divide-by-2^n → shift; hoist loop invariants

BRANCHES
  mispredict ≈ 15-20 cy (≈ L3 miss)
  predictable (sorted/partitioned) = ~free
  branchless ONLY when branch is ~50/50 — measure

HARDWARE COUNTERS
  perf stat -e cycles,instructions,cache-misses,branch-misses ./bin
  IPC < 1 + high cache-miss   → fix DATA LAYOUT
  IPC ok  + high branch-miss  → fix BRANCH predictability
```

---

## Summary

- A CPU profile gives two numbers per function: **flat** (self time, where cycles burn) and **cumulative** (total subtree time, the route there). Navigate by cumulative, *optimise where flat is high*.
- The dominant cost in CPU-bound code is usually **memory, not arithmetic**: a main-memory miss costs ~200 cycles, roughly 100× an arithmetic op. Count cache misses, not operations.
- **Data layout is a first-class optimisation.** Array-of-structs wastes most of every 64-byte cache line when a loop reads one field; **struct-of-arrays** packs hot data contiguously for the prefetcher — routinely 6–8× on hot scans. Prefer contiguous slices and indices over pointer chasing.
- **Allocations are hidden CPU work** (alloc + GC + cache pollution). Use `-gcflags=-m` to see escapes; reuse buffers (`buf[:0]`, `sync.Pool`, preallocated arrays) to take the allocator off the hot path. Verify with `-benchmem`.
- **Inlining** removes call overhead *and* unlocks cross-boundary optimisation; keep hot leaf functions small and `defer`-free, and check `-gcflags=-m`. Help the compiler **eliminate bounds checks** (`range`, hoisted assertions) and apply **strength reduction** (shift for power-of-two divide, hoist invariants).
- A **mispredicted branch costs ~15–20 cycles**, like an L3 miss. Make branches predictable (sort/partition); reach for branchless code only when profiling proves the branch is genuinely unpredictable.
- **`perf stat` is the hardware view**: low IPC + high cache-misses → fix layout; high branch-misses → fix branches; time in GC frames → fix allocations. Read the counters first, then pick the technique.

---

## Further Reading

- *Systems Performance* — Brendan Gregg. The canonical text on profiling methodology and reading hardware counters; the USE method.
- *What Every Programmer Should Know About Memory* — Ulrich Drepper. The deep treatment of caches, lines, prefetching, and NUMA behind this page.
- *Data-Oriented Design* — Richard Fabian. Why layout beats abstraction on hot paths; AoS vs SoA in depth.
- *Performance Analysis and Tuning on Modern CPUs* — Denis Bakhvalov. IPC, branch prediction, and `perf` workflow at the level a senior engineer needs.
- `go tool pprof` docs and the runtime `pprof`/`benchstat` toolchain — the primary sources for the Go workflow above.

---

## Related Topics

- [junior.md](junior.md) — diagnosing CPU-bound vs other bottlenecks and why you profile first.
- [senior.md](senior.md) — SIMD/vectorization, NUMA, microarchitectural tuning, and when assembly is justified.
- [01 — Profiling](../01-profiling/) — generating and reading CPU/memory profiles and flame graphs across languages.
- [05 — Memory & Allocation Profiling](../05-memory-and-allocation-profiling/middle.md) — when "CPU time" is really allocation/GC pressure, and how to confirm it.
