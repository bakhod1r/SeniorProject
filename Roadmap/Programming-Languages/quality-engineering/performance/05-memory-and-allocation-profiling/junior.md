# Memory and Allocation Optimization — Junior Level

> **Roadmap:** [Performance](../README.md) → Memory and Allocation Optimization
> *Two programs can use the exact same amount of memory at any instant — and one of them can be three times slower. The difference is not how much memory you hold, but how often you ask for it.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Two Different Numbers: Residency vs Allocation Rate](#core-concept-1--two-different-numbers-residency-vs-allocation-rate)
5. [Core Concept 2 — Stack vs Heap: Where Does It Live?](#core-concept-2--stack-vs-heap-where-does-it-live)
6. [Core Concept 3 — What the Garbage Collector Actually Does](#core-concept-3--what-the-garbage-collector-actually-does)
7. [Core Concept 4 — The Junior Wins: Allocate Less](#core-concept-4--the-junior-wins-allocate-less)
8. [Core Concept 5 — How to SEE Allocations](#core-concept-5--how-to-see-allocations)
9. [Real-World Examples](#real-world-examples)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Why allocating less makes code faster — even when memory looks fine.**

When people think about memory, they think about *running out*: the dreaded out-of-memory crash, the process the OS kills, the "heap size" number on a dashboard. That number — how much memory your program is *holding right now* — is real and it matters. But it is only half the story, and for most everyday performance problems, it is the *less* important half.

The other half is **allocation rate**: how often your program asks the runtime for fresh memory. Every `new`, every slice that grows, every string you build by concatenation, every temporary object inside a loop — each one is a request. And in any garbage-collected language (Go, Java, Python, C#, JavaScript), each request adds to a bill that comes due later: the **garbage collector** has to find and reclaim everything you allocated and stopped using. Allocate a lot, and the collector runs a lot. The collector running is *your program not running*.

So a program can have a tiny, steady heap and still be slow, because it churns through millions of short-lived objects — allocating, discarding, allocating again — keeping the GC permanently busy. This page is about *seeing* that churn and *reducing* it. It is not about the profiler tooling itself (that lives in [01 — Profiling](../01-profiling/01-cpu-profiling/junior.md)); it is about understanding the cost so you know what to act on.

> **The mindset shift:** stop asking only "how much memory am I using?" Start asking "how often am I *allocating*?" The first number predicts whether you crash. The second number predicts how fast you run. Most junior performance wins come from driving the second number down — and you can do it without ever touching the first.

---

## Prerequisites

- **Required:** You can write and run a program with functions, loops, slices/arrays, and maps in at least one language (examples use **Go**, with a little **Java** and **Python**).
- **Required:** You've heard the term "garbage collection" even if you've never thought about what it does.
- **Helpful:** You've seen a benchmark or timing number before and wondered why a "simple" change made code faster or slower.
- **Helpful:** You've watched a memory graph climb in a dashboard or task manager and wondered what was driving it.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Allocation** | Asking the runtime for a fresh block of memory to store something (an object, a slice, a string). |
| **Allocation rate** | How much memory you allocate per unit of work or time — e.g. bytes per request, or `allocs/op`. |
| **Heap** | The pool of memory for things that must outlive the function that created them; managed (and cleaned) by the GC. |
| **Stack** | Fast, per-function scratch memory that's automatically reclaimed when the function returns. No GC involved. |
| **Residency / heap size** | How much memory your program is *holding* at a given instant — the "live" set plus not-yet-collected garbage. |
| **Garbage collector (GC)** | The runtime component that finds memory you no longer use and reclaims it for reuse. |
| **GC pressure** | How hard the GC has to work, driven mostly by *allocation rate*. High pressure = frequent collections. |
| **Escape** | When a value the compiler *would* put on the stack must instead go on the heap (because it outlives the function). |
| **`allocs/op`** | A benchmark metric: the average number of heap allocations per operation. Your primary junior target. |

---

## Core Concept 1 — Two Different Numbers: Residency vs Allocation Rate

These two numbers get conflated constantly, and untangling them is the single most useful thing on this page.

**Residency** (a.k.a. heap size, live set) is a *snapshot*: how much memory is alive right now. Think of it as the water level in a tank.

**Allocation rate** is a *flow*: how fast new memory is being requested over time. Think of it as the rate water pours in — *and* drains out.

A tank can sit at a perfectly stable, low level while a firehose pours in and an equal-sized drain pours out. The level (residency) is small and constant. The *flow* (allocation rate) is enormous. That is the situation that quietly kills performance, because the drain — the garbage collector — is working flat out the whole time.

```
RESIDENCY (snapshot)          ALLOCATION RATE (flow)
"how much is held now"        "how fast new memory is requested"
predicts: OOM / cost          predicts: GC work / speed
measured in: MB held          measured in: MB/s, allocs/op
```

Here's a concrete example of low residency, high allocation rate:

```go
// Processes a million records. At any instant, only ONE record's
// temporary buffer is alive — residency is tiny.
for _, rec := range records {        // a million iterations
    buf := make([]byte, 4096)        // allocate 4 KB... every... iteration
    n := format(buf, rec)
    sink(buf[:n])
}                                    // buf becomes garbage immediately
```

At no point does this hold more than a few kilobytes (low residency). But it allocates **4 GB total** across the loop (a million × 4 KB) — all of it garbage the GC must chase. The fix isn't "use less memory at once"; it's "stop *churning*": allocate the buffer once, outside the loop, and reuse it.

> **Key insight:** A flat memory graph does **not** mean your program is memory-efficient. It can mean you're allocating and discarding at exactly the rate the GC reclaims — a treadmill that looks calm but burns CPU continuously. Always look at *allocation rate*, not just the heap-size line.

---

## Core Concept 2 — Stack vs Heap: Where Does It Live?

Not all memory is equal. There are two places your data can live, and the difference is the difference between *free* and *not free*.

**The stack** is per-function scratch space. When a function is called, it gets a frame; when it returns, the frame vanishes and everything in it is gone — instantly, automatically, at zero cost. No GC is ever involved. Stack memory is the fastest memory there is.

**The heap** is for things that must outlive the function that created them — a value you return a pointer to, something you store in a long-lived map, anything whose lifetime the compiler can't predict. Heap memory is managed by the GC, and *every* heap allocation is work: now, to allocate it, and later, to collect it.

The compiler decides which place each value goes, using **escape analysis**: "does this value *escape* the function?" If it can prove the value never outlives the function, it stays on the stack (free). If the value escapes — leaks out via a returned pointer, a closure, an interface — it must go on the heap.

```go
// Stays on the STACK — never escapes. Effectively free.
func sum(xs []int) int {
    total := 0          // local int, dies with the function
    for _, x := range xs {
        total += x
    }
    return total
}

// ESCAPES to the heap — we return a pointer to a local.
func makePoint(x, y int) *Point {
    p := Point{x, y}    // p must outlive this function...
    return &p           // ...so it escapes → heap allocation
}
```

In Go you can ask the compiler to *show* you its decisions:

```bash
go build -gcflags='-m' .
# ./main.go:14:9: &p escapes to heap
# ./main.go:6:13:  xs does not escape
```

That `escapes to heap` line is the compiler telling you exactly where an allocation will happen. Java and Python don't expose this as cleanly — in Python, essentially *everything* is a heap object — but the principle is universal: values that escape their creating scope cost more.

> **Key insight:** Stack allocation is free; heap allocation is not. The best optimization isn't allocating cleverly — it's *not allocating at all* by keeping values from escaping. "Allocates zero times" beats "allocates efficiently" every time.

---

## Core Concept 3 — What the Garbage Collector Actually Does

To understand why allocating less makes code faster, you need a one-paragraph model of the GC — not the algorithm (that's [Language Internals](../../../language-internals/)), just the *cost*.

The collector's job: periodically scan the heap, find every object that's still reachable (still in use), and reclaim everything else so the memory can be handed out again. To do this safely it needs to know nothing is changing underneath it, so it competes with — and sometimes briefly **pauses** — your actual program. The more you allocate, the sooner the heap fills the trigger threshold, the more often the collector runs, the more total CPU it spends, and the more your program stalls.

```
allocate more  →  GC triggers sooner  →  GC runs more often
              →  more CPU spent collecting  →  less CPU left for YOUR work
              →  more (and sometimes longer) pauses  →  worse latency
```

Concretely, Go's GC aims to keep its overhead modest, but a churn-heavy service can easily spend **20–30% of its CPU** just collecting garbage. That's a third of your machine doing nothing but cleaning up after allocations you didn't need to make. Cut the allocation rate in half and you can hand that CPU back to the work that matters — often a *bigger* win than any algorithmic micro-tweak.

The causal chain is the whole point: **you don't optimize the GC, you optimize the input to the GC.** You can't make collection cheaper, but you can give it less to collect. Less garbage in → less GC out.

> **Key insight:** The GC is a tax on allocation. You can't lower the tax *rate*, but you control the *taxable amount*. Every allocation you avoid is GC work that never happens — that's why "allocate less" is the most reliable performance lever a junior has.

---

## Core Concept 4 — The Junior Wins: Allocate Less

Most allocation waste comes from a handful of patterns. Learn to spot these and you'll fix the majority of real-world churn without any cleverness.

**1. Don't allocate inside hot loops.** Hoist the allocation out and reuse it.

```go
// BAD: allocates a fresh buffer every iteration
for _, rec := range records {
    buf := make([]byte, 0, 256)
    buf = append(buf, rec.Bytes()...)
    write(buf)
}

// GOOD: one buffer, reused; reset length, keep capacity
buf := make([]byte, 0, 256)
for _, rec := range records {
    buf = buf[:0]                     // reset length, keep the backing array
    buf = append(buf, rec.Bytes()...)
    write(buf)
}
```

**2. Preallocate slices and maps with capacity.** A slice that grows by `append` reallocates and copies repeatedly (typically doubling) as it expands. If you know roughly how big it'll get, say so up front.

```go
// BAD: grows from nothing — ~log2(n) reallocations and copies
out := []int{}
for _, x := range src { out = append(out, x*2) }

// GOOD: one allocation, no copies
out := make([]int, 0, len(src))       // capacity hint
for _, x := range src { out = append(out, x*2) }

// Same idea for maps:
m := make(map[string]int, len(src))   // avoids repeated rehashing/growth
```

**3. Build strings without concatenation in loops.** In most languages strings are immutable, so `s = s + x` allocates a *brand-new* string every iteration — O(n²) allocation for n pieces.

```go
// BAD: a new string allocated each loop — quadratic churn
s := ""
for _, p := range parts { s += p }

// GOOD: one growing buffer, then one final string
var b strings.Builder
b.Grow(estimatedSize)                 // optional capacity hint
for _, p := range parts { b.WriteString(p) }
s := b.String()
```

The same trap exists everywhere: in Java use `StringBuilder`, not `+=` in a loop; in Python use `"".join(parts)`, not `s += p`.

**4. Avoid unnecessary copies.** Passing a large struct *by value* copies it; passing a slice already shares its backing array (cheap), but `append`-ing to a shared slice can quietly allocate. Pass big things by pointer/reference when you don't need a copy.

> **Key insight:** None of these are clever. They're the same move four times: *move the allocation out of the repeated path, or size it correctly so it happens once.* "Once, ahead of time" beats "every iteration." Master this one habit and you've captured most of the available memory wins.

---

## Core Concept 5 — How to SEE Allocations

You can't optimize what you can't measure, and you should *never* guess. Go makes the measurement almost trivial with benchmarks.

Write a benchmark, run it with `-benchmem`, and read `allocs/op`:

```go
func BenchmarkJoin(b *testing.B) {
    parts := []string{"a", "b", "c", "d", "e"}
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        _ = strings.Join(parts, "")
    }
}
```

```bash
go test -bench=Join -benchmem
# BenchmarkJoin-8   12000000   95 ns/op   16 B/op   1 allocs/op
```

Read the last three columns:

- **`ns/op`** — time per operation (the speed).
- **`B/op`** — bytes allocated on the heap per operation.
- **`allocs/op`** — *number of heap allocations* per operation. **This is your primary target.**

Now compare the bad string-concat version against the `strings.Builder` version:

```bash
# Naive  s += p in a loop:
BenchmarkConcat-8    900000   1320 ns/op   248 B/op   7 allocs/op
# strings.Builder:
BenchmarkBuilder-8  4200000    280 ns/op    64 B/op   2 allocs/op
```

The numbers tell the whole story: 7 allocs/op → 2 allocs/op, and the time dropped ~4.7×. You didn't *guess* it was faster — you measured fewer allocations and confirmed the speedup. That's the loop: change code, rerun `-benchmem`, watch `allocs/op` fall.

For *where in a running program* the allocations come from — heap profiles, flame graphs, the actual `pprof` mechanics — see [01 — Profiling](../01-profiling/01-cpu-profiling/junior.md). That topic owns the "how to capture" question; this one owns "what the numbers mean and how to bring them down." The junior rhythm is: benchmark first to quantify, profile only when you need to *locate*.

> **Key insight:** `allocs/op` is the number to drive toward zero. It's deterministic, it's cheap to measure, and "this benchmark went from 7 allocs/op to 1" is a concrete, reviewable, regression-checkable win — far more reliable than eyeballing a timing number that wobbles run to run.

---

## Real-World Examples

**1. The log line that doubled GC load.** A service logs one structured line per request via `fmt.Sprintf("%s %d %v", ...)` plus a few string concatenations — about 12 allocations per request. At 5,000 requests/second that's 60,000 allocations/second of pure churn, and GC overhead sat near 28% of CPU. Switching to a zero-allocation logger that writes directly into a reused buffer dropped it to ~1 alloc/request; GC overhead fell to under 8%, and p99 latency improved because of fewer pauses. The *residency* barely moved — the win was entirely in allocation *rate*.

**2. The slice that grew the hard way.** A data-import job built a result slice with `append` starting from `nil`, for ~2 million rows. Because the slice doubled its backing array as it grew, it reallocated and copied roughly 21 times, touching gigabytes of throwaway memory. One line — `make([]Row, 0, expectedRows)` — removed every one of those reallocations. Import time dropped 35% with no algorithm change at all.

**3. The "small heap, slow service" puzzle.** A team chased a latency problem assuming a memory leak, because the service "felt heavy." But the heap graph was flat and low — no leak. The real culprit was allocation rate: a hot JSON-parsing path allocated a fresh map per message. A heap *profile* (captured per [01 — Profiling](../01-profiling/01-cpu-profiling/junior.md)) pointed at the exact line; reusing a pooled map collapsed the allocation rate and the latency followed. Lesson: low residency hid a high-churn problem in plain sight.

---

## Mental Models

- **Water tank vs firehose.** Residency is the water level (a snapshot); allocation rate is the flow through the tank (level in + drain out). A calm, low level can sit atop a torrent. The GC is the drain — the harder the flow, the harder it works.

- **The GC is a tax collector.** You can't negotiate the rate; you can only reduce what's taxable. Every allocation you skip is income the collector never gets to tax with CPU time.

- **Stack is a whiteboard, heap is filing cabinets.** The whiteboard (stack) wipes clean automatically the instant the function returns — free. The filing cabinet (heap) needs a librarian (the GC) to walk through and shred what's no longer referenced — not free.

- **Allocations are like API calls to the runtime.** You wouldn't call a remote service a million times in a loop if you could call it once. Treat `make`/`new` the same way: hoist it, size it, reuse the result.

- **`allocs/op` is a score you can lower.** Like strokes in golf, the goal is fewer. "From 7 to 1" is a real, defensible improvement; a 5% time delta on a noisy benchmark often isn't.

---

## Common Mistakes

1. **Watching heap size and ignoring allocation rate.** A flat memory graph feels safe, but it can hide a treadmill of allocate-and-discard that pins the GC at 25% CPU. The flat line is the *level*; you also need the *flow*.

2. **Allocating inside the hot loop.** `buf := make(...)` *inside* a million-iteration loop is the single most common churn source. Hoist it out and `buf = buf[:0]` to reset — same capacity, zero new allocations.

3. **Growing slices/maps from empty when the size is known.** Starting from `nil`/`{}` forces repeated reallocation and copying. If you can estimate the final size, pass it as a capacity hint and pay for one allocation instead of log(n).

4. **String concatenation in a loop.** `s += x` allocates a whole new string every iteration — quadratic churn. Use `strings.Builder` (Go), `StringBuilder` (Java), or `"".join(...)` (Python).

5. **Guessing instead of measuring.** "This feels faster" is not evidence. Run `go test -bench -benchmem` and compare `allocs/op` before and after. Optimize against the number, not the vibe.

6. **Confusing a leak with high churn.** A *leak* is residency that climbs and never falls (you hold references you shouldn't). High *churn* is a flat-but-busy heap. They look different on a graph and have completely different fixes — don't go hunting for a leak when the problem is allocation rate.

7. **Optimizing allocations that don't matter.** Allocation cost matters in *hot paths*. Removing one allocation from code that runs twice at startup is wasted effort. Measure to find the hot path first.

---

## Test Yourself

1. Two services hold a steady 200 MB heap. Service A allocates 50 MB/s; Service B allocates 5 GB/s. Which one likely has worse latency, and why?
2. What is the difference between *residency* and *allocation rate*? Which one predicts an out-of-memory crash, and which predicts GC overhead?
3. Why is a value that stays on the *stack* essentially free, while a value on the *heap* is not?
4. You have a benchmark reporting `7 allocs/op` for a string-building function. Name two concrete changes that would lower that number.
5. You change one line and a benchmark goes from `5 allocs/op` to `1 alloc/op`, with `ns/op` dropping by 60%. Explain *why* fewer allocations made it faster.
6. A service has a flat, low heap graph but high CPU and bad p99 latency. Is this more likely a memory leak or high allocation churn? How would you tell them apart?

<details>
<summary>Answers</summary>

1. **Service B.** Both hold the same memory, but B allocates 100× faster, so it triggers the GC far more often, spends far more CPU collecting, and pauses more frequently — worse latency. Residency is identical; allocation *rate* is the differentiator.
2. **Residency** = how much memory is held right now (a snapshot); it predicts **OOM**. **Allocation rate** = how fast new memory is requested over time (a flow); it predicts **GC overhead / speed**. They're independent — you can have low residency with a huge allocation rate.
3. Stack memory is reclaimed *automatically and instantly* when the function returns — no bookkeeping, no GC. Heap memory must be tracked and later scanned and reclaimed by the GC, so every heap allocation creates work both now (to allocate) and later (to collect).
4. Any two of: use `strings.Builder` instead of `+=`; preallocate with `b.Grow(n)` / a capacity hint so the buffer doesn't reallocate as it grows; reuse a single buffer across calls instead of allocating fresh each time.
5. Each allocation is heap work *and* future GC work. Cutting from 5 to 1 means less time spent in the allocator and far less garbage for the collector to chase, so more CPU goes to the actual computation — hence both fewer allocs *and* lower time.
6. **High allocation churn**, almost certainly — a leak shows residency *climbing over time*; a flat low graph rules that out. Confirm by measuring allocation rate (e.g. GC stats / `allocs/op` on the hot path) and capturing a heap *profile* (see [01 — Profiling](../01-profiling/01-cpu-profiling/junior.md)) to find the churning allocation site.

</details>

---

## Cheat Sheet

```
THE TWO NUMBERS
  residency  = memory held NOW (snapshot) → predicts OOM / cost
  alloc rate = new memory PER TIME (flow) → predicts GC work / speed
  flat heap graph  ≠  efficient  (could be a high-churn treadmill)

STACK vs HEAP
  stack = per-function scratch, auto-freed on return → FREE
  heap  = outlives the function, managed by GC       → COSTS (now + later)
  goal: keep values from ESCAPING  (go build -gcflags='-m')

THE GC TAX
  allocate more → GC triggers sooner → runs more → more CPU & pauses
  you can't lower the rate; you CAN lower the taxable amount
  churn-heavy service can burn 20-30% CPU on GC

THE JUNIOR WINS
  hot loops      → hoist the allocation OUT; buf = buf[:0] to reuse
  slices/maps    → make([]T, 0, n) / make(map[K]V, n)  (capacity hint)
  strings        → strings.Builder / StringBuilder / "".join  (never += in a loop)
  big values     → pass by pointer/reference, avoid copies

SEE IT
  go test -bench=. -benchmem
  ns/op   = time          B/op = bytes/op
  allocs/op = HEAP ALLOCATIONS PER OP   ← drive this toward 0
  measure → change → rerun → watch allocs/op fall  (never guess)
```

---

## Summary

- There are **two different memory numbers**: **residency** (how much you hold now — predicts OOM) and **allocation rate** (how often you ask for memory — predicts GC work and speed). A flat heap graph is *not* proof of efficiency; it can hide a high-churn treadmill.
- Values live on the **stack** (per-function, auto-freed, *free*) or the **heap** (outlives the function, GC-managed, *not free*). The best optimization is keeping values from **escaping** to the heap at all.
- The **garbage collector** is a tax on allocation: more allocation → more frequent collection → more CPU spent and more pauses. You can't lower the tax rate, only the taxable amount — so **allocate less**.
- The reliable junior wins are all the same move: get allocations *out of repeated paths* and *sized correctly up front* — hoist out of hot loops, preallocate slices/maps with capacity, build strings with a builder, avoid needless copies.
- **Measure, never guess.** `go test -bench -benchmem` reports `allocs/op` — the number to drive toward zero. Change code, rerun, watch it fall.

You now have the core habit: think in *allocation rate*, not just heap size, and reach for "allocate once, reuse" before anything clever. Everything deeper — escape analysis in detail, object pooling, custom allocators, fragmentation, working-set tuning — is about doing this same thing more precisely and at larger scale.

---

## Further Reading

- [*A Guide to the Go Garbage Collector*](https://go.dev/doc/gc-guide) — the official, readable explanation of how allocation drives GC work. Start here.
- [`testing` package docs — benchmarks](https://pkg.go.dev/testing#hdr-Benchmarks) — `b.ReportAllocs`, `b.N`, and what `-benchmem` reports.
- *Systems Performance* — Brendan Gregg — the memory chapters; the vocabulary of residency, working set, and allocation.
- *Java Performance: The Definitive Guide* — Scott Oaks — the GC chapters, for the Java side of the same ideas (allocation rate, generations, pauses).
- The [middle.md](middle.md) of this topic — formalizes escape analysis, object pooling (`sync.Pool`), generational GC, and reading heap profiles.

---

## Related Topics

- [01 — Profiling](../01-profiling/01-cpu-profiling/junior.md) — *how to capture* heap and allocation profiles and read flame graphs; this topic is about *acting on* what they show.
- [04 — CPU-Bound Optimization](../04-cpu-bound-optimization/junior.md) — the other half of "make it fast": when the bottleneck is computation, not allocation.
- [middle.md](middle.md) — escape analysis in depth, `sync.Pool`, generational GC, fragmentation, and working-set tuning.
- [Language Internals › Memory & GC](../../../language-internals/) — what the garbage collector is *actually doing* under the hood.
