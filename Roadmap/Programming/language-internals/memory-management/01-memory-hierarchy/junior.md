# The Memory Hierarchy — Junior Level

> **Topic:** [The Memory Hierarchy](README.md)
> **Focus:** Build a clear mental picture of the storage pyramid — registers, caches, RAM, disk — and why "where data lives" decides how fast your program runs.

---

## Table of Contents

- [Introduction](#introduction)
- [Prerequisites](#prerequisites)
- [Glossary](#glossary)
- [Core Concepts](#core-concepts)
- [The Latency Pyramid With Real Numbers](#the-latency-pyramid-with-real-numbers)
- [Real-World Analogies](#real-world-analogies)
- [Mental Models](#mental-models)
- [Code Examples](#code-examples)
- [Pros & Cons of Each Level](#pros--cons-of-each-level)
- [Use Cases](#use-cases)
- [Best Practices](#best-practices)
- [Edge Cases & Pitfalls](#edge-cases--pitfalls)
- [Summary](#summary)

---

## Introduction

When you write `x = arr[i]`, you imagine the CPU just "reading memory." In reality, the value might come from a tiny register inside the CPU, from a cache a few nanometers away, from a DRAM chip on a stick across the motherboard, or from an SSD a thousand times slower. These are not interchangeable. Reading the same byte can take **less than a nanosecond or tens of microseconds** depending on where it currently sits.

The **memory hierarchy** is the layered arrangement of these storage levels, ordered from tiny-fast-expensive at the top to huge-slow-cheap at the bottom. Understanding it is the single most useful piece of hardware knowledge for writing fast software, because almost every performance problem in modern code is really a *data-movement* problem in disguise.

This file gives you the foundations: what the levels are, how slow each one is, and the one idea — **locality** — that lets the fast levels do most of the work.

---

## Prerequisites

- You know what a variable and an array are.
- You know roughly that a CPU executes instructions one after another.
- You have seen the units: a **byte** (8 bits), **KB / MB / GB**, and the time units **ns** (nanosecond, one billionth of a second) and **µs** (microsecond, one millionth).

That's it. No assembly, no operating-system theory.

---

## Glossary

- **CPU register** — a handful of named storage slots *inside* the processor core, each holding one word (e.g. 8 bytes). The fastest storage that exists.
- **Cache** — small, fast memory built into the CPU that keeps recently/likely-used data close. Comes in levels: **L1**, **L2**, **L3**.
- **RAM / DRAM / main memory** — the gigabytes of working memory on the memory sticks. Volatile (lost on power off).
- **SSD / disk / storage** — persistent storage. Survives power off, but far slower than RAM.
- **Latency** — how long *one* access takes (the wait).
- **Bandwidth** — how much data you can move *per second* (the pipe width).
- **Cache line** — the fixed-size chunk (typically **64 bytes**) the CPU actually transfers between RAM and cache. You never load just one byte.
- **Locality** — the tendency of programs to reuse the same data (temporal) or nearby data (spatial) soon.

---

## Core Concepts

### Why there is a hierarchy at all

Engineers would love one memory that is **fast, huge, and cheap**. Physics and economics forbid it:

- **Fast memory is expensive and small.** The circuits that respond in under a nanosecond (SRAM, used for caches) cost far more per byte and draw more power than the dense DRAM used for main memory.
- **Slow memory is cheap and huge.** Disk storage is pennies per gigabyte but takes thousands of times longer to reach.

So instead of one perfect memory, machines stack several imperfect ones and try to keep the data you need *now* in the fast ones. The hierarchy is a compromise that *behaves* almost as fast as the top level while being *almost as big and cheap* as the bottom level — **as long as your access pattern cooperates.**

### The levels, top to bottom

1. **Registers** — dozens of them per core, each 8 bytes. Sub-nanosecond. The CPU computes directly on these.
2. **L1 cache** — ~32–64 KB per core. About **1 ns** (~4 cycles). Split into instruction and data caches.
3. **L2 cache** — ~256 KB–1 MB per core. About **4 ns**.
4. **L3 cache** — a few to tens of MB, *shared* by all cores. About **12–40 ns**.
5. **Main memory (DRAM)** — gigabytes. About **60–100 ns**.
6. **SSD / NVMe** — hundreds of GB to TB. About **10–100 µs** — *thousands* of times slower than DRAM.
7. **Network / spinning disk** — milliseconds. A *million* times slower than a register.

### The crucial idea: it moves data for you automatically

You do **not** write code that says "copy this into L2." The hardware does it. When the CPU needs a byte that isn't in cache (a **cache miss**), it fetches the whole 64-byte cache line containing it from the next level down and keeps it around, betting you'll want it (or its neighbors) again soon. Your job is not to control the cache directly — it's to **write code whose access pattern makes those bets pay off.**

---

## The Latency Pyramid With Real Numbers

These are approximate, order-of-magnitude numbers for a typical modern server CPU. Memorize the *shape*, not the exact digits.

```
Level            Typical size      Latency        "If 1 cycle = 1 second"
---------------------------------------------------------------------------
Register         ~dozens × 8B      < 0.5 ns       instant
L1 cache         32–64 KB          ~1 ns          a few seconds
L2 cache         256 KB–1 MB       ~4 ns          ~15 seconds
L3 cache         8–32 MB           ~12–40 ns      ~1 minute
DRAM (RAM)       8–256 GB          ~60–100 ns     a few minutes
NVMe SSD         256 GB–4 TB       ~10–100 µs      hours to a day
Network (LAN)    —                 ~0.1–1 ms       a week+
```

The last column rescales time so one CPU cycle feels like one second. On that scale, going to RAM feels like waiting minutes, and going to SSD feels like waiting a *day*. This is why a single unnecessary trip to disk can dwarf millions of in-cache operations.

---

## Real-World Analogies

**The desk, the drawer, the basement.**

- **Registers** = the few items in your hands right now.
- **L1/L2 cache** = the things on your desk — instantly grabbable.
- **L3 cache** = the desk drawer — one reach away.
- **RAM** = the bookshelf across the room — you have to get up.
- **SSD** = the storage boxes in the basement — a real trip.
- **Network/disk** = ordering the item from another city.

You don't move your whole library onto the desk; you keep the few things you're *using* there, and fetch from the basement only when you must. A good worker (and good code) arranges their work so most reaches are to the desk.

**The cache line as a six-pack.** When you go to the fridge for one soda, you grab the whole six-pack on the shelf, not a single can. RAM works the same way: ask for one byte, get the surrounding 64. If you then drink the other five (use nearby data), the trip was cheap *per item*. If you take one sip and walk away, you wasted the trip.

---

## Mental Models

- **"RAM is the new disk."** To a modern CPU, main memory is *slow*. The caches are the real fast memory. Treating DRAM as "instant" is the beginner's mistake.
- **You pay per cache line, not per byte.** Cost is dominated by how many *distinct 64-byte lines* you touch, not how many bytes. Touching 64 bytes packed in one line is roughly the cost of touching one byte.
- **Sequential is cheap, scattered is expensive.** Walking through memory in order lets the hardware prefetch ahead and reuse lines. Jumping around defeats both.

---

## Code Examples

### Row-major vs column-major traversal (the classic demo)

A 2D array in C, Go, or Java is stored **row by row** in memory. Reading it in row order touches consecutive addresses; reading it column-first jumps by a whole row each step.

```c
#define N 4096
int a[N][N];

// FAST: walks memory in order — each cache line fully used.
long sum = 0;
for (int i = 0; i < N; i++)
    for (int j = 0; j < N; j++)
        sum += a[i][j];

// SLOW: jumps N ints between accesses — one line per access, mostly wasted.
long sum2 = 0;
for (int j = 0; j < N; j++)
    for (int i = 0; i < N; i++)
        sum2 += a[i][j];
```

The two loops compute the same answer with the same number of additions. The second is commonly **5–10× slower** purely because it ignores the cache line. *Nothing in the language tells you this — it's all in the hierarchy.*

### The same pattern in Go

```go
const N = 4096
var a [N][N]int32

var sum int64
for i := 0; i < N; i++ {
    for j := 0; j < N; j++ {
        sum += int64(a[i][j]) // contiguous — cache-friendly
    }
}
```

Swap the loop order and Go suffers exactly the same slowdown. The hierarchy doesn't care which language emitted the loads.

---

## Pros & Cons of Each Level

| Level | Pro | Con |
|---|---|---|
| Registers | Fastest possible; no addressing | Almost none; compiler-managed |
| L1/L2 | ~1–4 ns, per-core | Tiny; thrashes if working set too big |
| L3 | MBs, shared across cores | Slower; contended by all cores |
| DRAM | Gigabytes, cheap | ~100 ns — a stall the CPU hates |
| SSD | Persistent, large | Microseconds; thousands× DRAM |
| Network/disk | Effectively unlimited capacity | Milliseconds; treat as a different planet |

---

## Use Cases

- **Choosing a data structure.** An array of numbers you scan in order will fly through cache. A linked list with the same numbers scattered across the heap can be many times slower for the same scan, because each node may be a fresh cache miss.
- **Sizing a hot working set.** If the data you touch in a tight loop fits in L2 (a megabyte or so), the loop runs near peak speed. Exceed it and you fall to DRAM speed.
- **Understanding "why is this slow?"** When a profiler shows time vanishing into a simple-looking loop, the answer is usually cache misses, not the arithmetic.

---

## Best Practices

1. **Prefer contiguous, sequential access.** Arrays scanned front-to-back are the gold standard.
2. **Keep hot data small and together.** The less memory a loop touches, the more of it stays in fast cache.
3. **Don't fight the hardware.** You rarely "place" data in a cache; you *arrange access patterns* so the automatic machinery wins.
4. **Measure, don't guess.** Two loops with identical logic can differ 10× — you can't see that by reading the source.

---

## Edge Cases & Pitfalls

- **"It's all RAM, so it's all the same speed."** False. A cache hit and a cache miss to the same array can differ by ~100×.
- **Counting operations instead of accesses.** Beginners optimize the number of `+` operations; the hierarchy cares about the number of distinct cache lines touched.
- **Assuming small inputs reveal the truth.** A 1,000-element array fits entirely in L1, so a bad access pattern looks free. The penalty only appears when the data outgrows the cache — exactly when it matters in production.
- **Forgetting persistence is a level too.** A program that re-reads a file from SSD inside a loop pays microseconds *every iteration*; caching it in RAM once can be thousands of times faster.

---

## Summary

- Memory is a **pyramid**: registers → L1 → L2 → L3 → DRAM → SSD → network, getting bigger, cheaper, and *much* slower as you descend.
- The hierarchy exists because no single memory is fast, huge, and cheap at once.
- Hardware moves data between levels **automatically**, in **64-byte cache lines**, betting on **locality**.
- Your performance is decided mostly by **how many distinct lines you touch and in what order**, not by raw operation counts.
- The headline rule: **sequential access through contiguous memory is fast; scattered access is slow** — and the gap is often 5–100×.

Everything else in memory management builds on this picture. Get it solid now.
