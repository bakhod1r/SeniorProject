---
layout: default
title: Cache Coherence — Junior
parent: Cache Coherence
grand_parent: Memory Ordering Barriers
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/22-memory-ordering-barriers/04-cache-coherence/junior/
---

# Cache Coherence — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use-feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Common Misconceptions](#common-misconceptions)
20. [Tricky Points](#tricky-points)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "Why does my parallel counter run slower on more cores? Why does padding a struct sometimes make my benchmark twice as fast?"

When you read or write a Go variable, your code does not talk to main memory directly. It talks to a chain of caches on the CPU. Each CPU core has its own private cache. The hardware is responsible for making sure that, even though every core has its own copy of recently used data, every core sees a single agreed-upon value for any given memory location. The machinery that makes this true is called **cache coherence**.

Most Go programmers never need to know cache coherence exists — until they write a parallel program that should scale and does not. They add more goroutines, run on more cores, and the program gets slower. They benchmark a tight loop and add a few bytes of padding to a struct and it suddenly runs three times faster. They open a flame graph and see most of the time disappearing inside `runtime.atomic*` or a `sync.Mutex.Lock` that should be uncontended.

In every one of these cases the hidden actor is cache coherence. The CPU is shuffling **cache lines** — typically 64-byte aligned chunks of memory — between the private caches of different cores, and that shuffling has measurable cost. A read out of L1 is roughly one nanosecond; a read that has to pull a line from another core's cache is twenty to thirty times slower, and worse if the cores are on different sockets.

This file is your first contact with the topic. After reading it you will:

- Know what a cache is, what a cache line is, and roughly how big one is on modern hardware
- Understand the difference between an L1, L2, and L3 cache
- Know what it means for a cache line to be **shared**, **exclusive**, or **modified** on a single core
- See, with measurable benchmarks, what **false sharing** looks like in Go
- Be able to use `//go:align` and padding to put hot fields on their own cache line
- Have a feel for why an atomic increment on one variable from many goroutines is far worse than one might assume
- Know which Go tools (`go test -bench`, `perf stat`, `pprof`) you can point at a program to detect coherence problems

You do not need to know the formal MESI state machine, store buffers, or NUMA effects yet. Those come at middle, senior, and professional levels. This file gives you the foundation: caches are real, cache lines are the unit of sharing, and treating them respectfully is the difference between code that scales and code that does not.

---

## Prerequisites

- **Required:** A working Go installation, version 1.21 or newer. Check with `go version`.
- **Required:** Comfort writing benchmarks with the `testing` package: `func BenchmarkXxx(b *testing.B)`.
- **Required:** Familiarity with goroutines, `sync.WaitGroup`, and `sync/atomic.AddInt64`. If those names are new, read the goroutines and atomics sections first.
- **Helpful:** Some exposure to "memory hierarchy" from a hardware or systems class. Not required — we will recap.
- **Helpful:** Awareness that modern CPUs have multiple cores and that L1/L2 caches exist. If you have heard the words "cache miss" before, you are ready.

If `go test -bench=.` runs on your machine and you understand that a goroutine is a small managed thread, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Cache** | A small, fast on-chip memory that holds recently touched bytes from main memory. Reading from L1 cache is roughly 100× faster than reading from main memory. |
| **Cache line** | The fixed-size unit a cache transfers in and out. On x86-64 and most ARM cores it is 64 bytes. Apple M-series cores use 128 bytes. The hardware never moves less than a full line. |
| **L1 / L2 / L3** | Levels of cache. L1 is per-core, smallest (32–64 KB), fastest (~1ns). L2 is per-core, larger (256 KB – 1 MB), slower (~3–4ns). L3 is shared across cores on the same socket (8–64 MB), slower (~10–15ns). |
| **DRAM / main memory** | The big slow memory chips on the board. ~70–100ns for a single random access on a modern desktop. |
| **Cache miss** | A read or write where the line is not in the level being checked, forcing a fetch from the next level down. |
| **Cache coherence** | The hardware-enforced property that all cores see a consistent value for any given memory address even though each core has its own private cache. |
| **MESI** | The four-state coherence protocol: Modified, Exclusive, Shared, Invalid. Most x86 implementations use a variant of MESI. |
| **False sharing** | When two logically unrelated variables sit on the same cache line and updates to one force expensive coherence traffic on the other. The classic invisible scaling killer. |
| **Cache-line bouncing** | A cache line repeatedly migrating between cores' private caches because each core wants exclusive write access. Symptom of contention. |
| **Atomic operation** | A read-modify-write operation (like `atomic.AddInt64`) that appears to happen indivisibly. On most hardware it takes a cache line into the **Modified** state, which costs coherence traffic. |
| **Padding** | Adding unused bytes to a struct so that hot fields land on their own cache lines. Common pattern: `_ [64]byte` between fields. |
| **`//go:align`** | A compiler directive (Go 1.21+) that requests alignment of a global variable. Combined with padding it gives cache-line-sized objects. |
| **`perf`** | A Linux profiler that can read CPU performance counters such as L1 misses and cross-core invalidations. |
| **`pprof`** | Go's built-in profiler. Less precise than `perf` for cache effects but very useful for showing where coherence traffic burns CPU time. |

---

## Core Concepts

### Memory is not flat

A junior programmer often pictures memory as a flat array: index by address, read or write a byte. The CPU sees something very different. It sees a hierarchy:

```
core 0 registers ──► L1d (32KB, ~1ns)  ──► L2 (1MB, ~4ns)  ──┐
                                                              ├──► L3 (32MB, ~12ns) ──► DRAM (~80ns)
core 1 registers ──► L1d (32KB, ~1ns)  ──► L2 (1MB, ~4ns)  ──┘
```

The L1 and L2 caches are **per-core**. Each core has its own. L3 is **per-socket**, shared among all cores on the same chip. DRAM is shared by everything.

Every memory operation walks down this hierarchy. When core 0 reads address `0x1000`, the CPU first looks in core 0's L1. If it finds the byte there, it returns in about a nanosecond. If not — an **L1 miss** — it looks in L2. If it finds it there, three or four nanoseconds. Then L3. Then DRAM. A miss all the way to DRAM is around eighty nanoseconds. Across those layers the cost ranges over almost two orders of magnitude.

### The unit is a 64-byte line, not a byte

A second crucial fact: the cache does not store individual bytes or words. It stores **cache lines**. On x86-64 and most ARM cores, a cache line is **64 bytes**, aligned on a 64-byte boundary. When you read `int64` at address `0x1008`, the hardware fetches the full 64-byte line that contains it — `0x1000` through `0x103F` — and parks it in L1.

This single fact has enormous consequences. The hardware cannot share a byte between cores. It can only share a 64-byte line. If two `int64` variables sit at addresses `0x1000` and `0x1008`, they are on the same cache line, and they are effectively glued together as far as coherence is concerned. Touching one means moving the other.

### Multiple cores, multiple copies

Now imagine two cores. Core 0 reads address `0x1000`. The line containing that address goes into core 0's L1. Core 1 also reads address `0x1000`. The same line goes into core 1's L1. Both cores now have a private copy.

What if core 0 writes to address `0x1000`? Naïvely you might think the write just updates core 0's copy. But then core 1 would read stale data forever. That is the problem cache coherence solves: the hardware **must** make every core agree on the value, even though physically there are two copies.

The simplest correct protocol is: when core 0 wants to write, it sends an **invalidation** to every other core, telling them "drop your copy of the line containing `0x1000`." Core 1's copy is marked invalid. The next time core 1 reads `0x1000`, it gets a miss and fetches the new value — either from core 0's L1 or from a shared cache.

That invalidation is a message that has to travel across the chip. On a single-socket modern x86 it costs perhaps 30–40 cycles. On a multi-socket server it can be 100–300 cycles. A naive scaling argument — "more cores means more throughput" — falls apart the moment those cores fight over the same cache lines, because they spend their time sending invalidations instead of doing work.

### The four basic states

For a junior introduction, it is enough to know that a cache line in a core's cache can be in one of three useful states:

- **Modified (M)** — this core has written to the line and nobody else has a copy. Reading or writing is cheap.
- **Shared (S)** — this core has a copy and at least one other core might also have a copy. Reading is cheap; writing first requires invalidating all other copies.
- **Invalid (I)** — this core does not have a usable copy. Reading or writing requires a fetch.

(The full MESI protocol adds **Exclusive**, which we cover in middle.md.)

Two things follow:

1. **A shared, read-only line is free.** As many cores as you like can hold it in **Shared** state. Reads are L1-fast for everyone.
2. **A line written by multiple cores is brutally expensive.** Every write must transition the line to **Modified**, which means invalidating every other copy. The line bounces from one core's L1 to the next.

That second fact is the entire reason this section exists.

### False sharing — the invisible killer

Here is the worst case. You write what looks like an embarrassingly parallel program:

```go
type Counters struct {
    a int64
    b int64
}

var c Counters

// Goroutine A only updates c.a.
// Goroutine B only updates c.b.
```

Logically, `c.a` and `c.b` are independent. They are never read or written together. Two goroutines on two cores should be able to update them at full speed in parallel.

But they sit eight bytes apart in memory. The line containing them is 64 bytes wide. **Both fields live on the same cache line.** Every time goroutine A writes `c.a`, the hardware invalidates goroutine B's copy of the line. Every time goroutine B writes `c.b`, the hardware invalidates goroutine A's copy. The line ping-pongs between the two cores. The program crawls.

This is **false sharing**: the variables are logically separate, but they share a cache line, and the hardware treats them as one. It is invisible in the source code. The fix is to put them on different cache lines, usually by adding padding bytes.

### Padding — your first weapon

The simplest fix to false sharing is to add padding so each hot field gets its own cache line:

```go
type Counters struct {
    a   int64
    _   [56]byte // pad: 8 (a) + 56 = 64 = cache line
    b   int64
    _   [56]byte
}
```

Now `c.a` and `c.b` are on different lines. Writing one no longer invalidates the other. We will measure this gain shortly.

### What about atomics?

You might think `sync/atomic.AddInt64` magically avoids the problem. It does not. `atomic.AddInt64` is implemented on x86 as a `LOCK XADD` instruction, which forces the cache line into the **Modified** state on the executing core, invalidating every other copy. **Every atomic operation is a coherence event.** When two cores both do `atomic.AddInt64` on the same variable, the line bounces between them just as if it were a plain write.

The lesson: atomics are not free. They make the operation atomic, but they pay the same coherence cost as a contended write — sometimes more, because they often involve a memory fence.

### The rule of thumb

A junior-level rule that will keep you out of trouble 90% of the time:

> If two goroutines write to memory that lives within 64 bytes of each other, you have a performance problem.

The fix is one of:

1. Don't share. Give each goroutine its own variable and aggregate at the end.
2. Pad. Put each frequently-written field on its own 64-byte cache line.
3. Batch. Update a local variable and flush to the shared one infrequently.

---

## Real-World Analogies

### The single whiteboard

Imagine a company where every employee has their own copy of a project status whiteboard at their desk, and there is one master whiteboard in the hall. Every employee sometimes reads the status, sometimes writes a new line. To keep everyone honest, the company has a rule: before you write on your local whiteboard, you must erase the local whiteboards of everybody else who has a copy of that section, so that the next time they want to read it they walk to your desk and copy your version.

If two people are writing on different sections of the whiteboard, that is fine. But if they are both writing on the *same* section, every write forces the other person to throw out their copy and walk over. Productivity collapses.

That is exactly cache coherence. The whiteboard sections are cache lines. Walking over is an invalidation message. False sharing is when two people are writing what looks like different things but they happen to be on the same whiteboard section.

### The shared kitchen counter

Two roommates each have their own counter space (private cache), but they share one giant cutting board (cache line). One is chopping onions on their half; the other is chopping carrots on the other half. Neither cares about the other's food. But every time one of them moves the cutting board to slice, the other has to wait, because the board is one rigid object. Even though they are working on different sides, the shared object glues them together.

That is false sharing. The fix is two cutting boards.

### The library book

Think of a library where a popular reference book can be checked out, but it has only one copy. When student A is reading it, B has to wait. When B finally gets it, then A wants it back. The book bounces between them. The bouncing wastes more time than the actual reading.

That is cache-line bouncing under contention. The fix is either to make many copies (replicate the data, one per core) or to schedule access so that one student finishes a full chunk before handing it over (batch updates).

---

## Mental Models

### Model 1: "A cache line is the unit, not a byte"

When thinking about parallel correctness you think in bytes and words. When thinking about parallel performance you must think in 64-byte chunks. Any two variables within 64 bytes of each other are, from the cache's point of view, *the same thing*.

### Model 2: "Writes are exclusive; reads can be shared"

Many readers, none of whom mutate, is essentially free. Many writers, even to disjoint fields on the same line, is expensive.

### Model 3: "Atomics are not magic — they ride on coherence"

`atomic.AddInt64` does not bypass the cache. It uses the cache. It enforces ordering through coherence. It costs what a contended write costs.

### Model 4: "If a parallel program does not scale, suspect the cache before suspecting the algorithm"

Sometimes the algorithm is wrong. Often the algorithm is fine and the data layout is wrong. Always benchmark, but suspect layout first when you see scaling collapse on shared memory.

---

## Pros & Cons

Cache coherence is not something you choose to opt into. It is the hardware behaviour. The trade-offs here are about the **strategies you use to live with it**.

| Approach | Pros | Cons |
|----------|------|------|
| Padding hot fields | Easy, local fix; well-understood; big wins | Wastes memory; obscures struct layout; only helps if you correctly identify the hot fields |
| Per-goroutine local accumulators | Often the best fix; eliminates contention entirely | Requires algorithmic restructuring; merge step must be careful |
| Sharding (split one shared structure into N) | Scales nearly linearly; well-known pattern | Adds memory cost; requires hashing or partitioning |
| Atomic primitives without padding | Simple code | Bounces the line and silently loses throughput on multi-core |
| Mutex around contended fields | Easy; correct | Worse than a well-designed lock-free approach; often worse than padding |

For most junior-level scenarios — counters, statistics, hit rates — the answer is either pad-and-share or shard.

---

## Use Cases

Real situations where cache coherence shows up:

1. **Per-CPU counters.** A request counter incremented from every request handler. With a single shared variable: serialised by coherence. With sharded counters: nearly linear scaling.
2. **Worker-pool job statistics.** A pool of N workers each updating "jobs done" on a shared struct. If the struct's counters are packed tightly, false sharing collapses throughput.
3. **Concurrent maps.** A hash map with many buckets shares cache lines across buckets unless the buckets are deliberately padded.
4. **Reference counting.** Frequently incremented counters live with the data they describe — often on the same cache line as the data — and become a bottleneck when many cores read the data and bump the count.
5. **`sync.Mutex` itself.** Contention on a mutex is a contention on the underlying state word's cache line. A heavily contended mutex is a cache-line-bouncing mutex.

---

## Code Examples

### Example 1: Measuring false sharing

Save as `falseshare_test.go` and run with `go test -bench=. -benchmem`:

```go
package falseshare

import (
    "sync"
    "sync/atomic"
    "testing"
)

const N = 1_000_000

type packed struct {
    a int64
    b int64
}

type padded struct {
    a int64
    _ [56]byte
    b int64
    _ [56]byte
}

func BenchmarkPackedTwoCores(b *testing.B) {
    var c packed
    for i := 0; i < b.N; i++ {
        var wg sync.WaitGroup
        wg.Add(2)
        go func() {
            defer wg.Done()
            for j := 0; j < N; j++ {
                atomic.AddInt64(&c.a, 1)
            }
        }()
        go func() {
            defer wg.Done()
            for j := 0; j < N; j++ {
                atomic.AddInt64(&c.b, 1)
            }
        }()
        wg.Wait()
    }
}

func BenchmarkPaddedTwoCores(b *testing.B) {
    var c padded
    for i := 0; i < b.N; i++ {
        var wg sync.WaitGroup
        wg.Add(2)
        go func() {
            defer wg.Done()
            for j := 0; j < N; j++ {
                atomic.AddInt64(&c.a, 1)
            }
        }()
        go func() {
            defer wg.Done()
            for j := 0; j < N; j++ {
                atomic.AddInt64(&c.b, 1)
            }
        }()
        wg.Wait()
    }
}
```

On a typical x86 laptop you will see the `Padded` version run **2× to 5×** faster than `Packed`. Both versions are correct. Both increment by `N`. The only difference is whether `a` and `b` share a cache line.

### Example 2: Per-goroutine accumulator (preferred)

Even better than padding is removing the sharing entirely:

```go
package falseshare

import (
    "sync"
    "testing"
)

func BenchmarkLocalAccumulator(b *testing.B) {
    for i := 0; i < b.N; i++ {
        var wg sync.WaitGroup
        results := make([]int64, 2)
        wg.Add(2)
        go func() {
            defer wg.Done()
            var local int64
            for j := 0; j < N; j++ {
                local++
            }
            results[0] = local
        }()
        go func() {
            defer wg.Done()
            var local int64
            for j := 0; j < N; j++ {
                local++
            }
            results[1] = local
        }()
        wg.Wait()
        // results[0]+results[1] is the merged total
    }
}
```

No coherence traffic during the hot loop at all. The `results` slice is written once at the end of each goroutine. This is usually 10× faster than the contended-atomic version.

### Example 3: Detecting a cache line manually

```go
package main

import (
    "fmt"
    "unsafe"
)

type S struct {
    a int64
    b int64
}

func main() {
    var s S
    addrA := uintptr(unsafe.Pointer(&s.a))
    addrB := uintptr(unsafe.Pointer(&s.b))
    fmt.Printf("a at %x\n", addrA)
    fmt.Printf("b at %x\n", addrB)
    fmt.Printf("delta = %d bytes\n", addrB-addrA)
    fmt.Printf("same 64-byte line? %v\n", addrA/64 == addrB/64)
}
```

Run this and you will see that `a` and `b` are 8 bytes apart and on the same 64-byte-aligned line. After padding, they are no longer on the same line.

### Example 4: Sharded counter

```go
package shard

import (
    "runtime"
    "sync/atomic"
)

type ShardedCounter struct {
    shards []paddedCounter
}

type paddedCounter struct {
    value int64
    _     [56]byte
}

func NewShardedCounter() *ShardedCounter {
    return &ShardedCounter{shards: make([]paddedCounter, runtime.NumCPU())}
}

func (s *ShardedCounter) Add(delta int64, shard int) {
    atomic.AddInt64(&s.shards[shard%len(s.shards)].value, delta)
}

func (s *ShardedCounter) Sum() int64 {
    var total int64
    for i := range s.shards {
        total += atomic.LoadInt64(&s.shards[i].value)
    }
    return total
}
```

Each goroutine picks a shard (perhaps by `runtime.NumCPU()` index or by goroutine-local hash) and updates its own padded slot. The hot path never touches another shard's cache line.

### Example 5: Reading raw cache events with `perf`

On Linux, after building your binary:

```
perf stat -e cache-references,cache-misses,L1-dcache-load-misses,LLC-load-misses ./benchmark
```

The interesting counter for false sharing is `cache-misses` together with `LLC-load-misses`. A program with bad coherence behaviour shows L3 misses out of proportion to its working-set size — the misses come from cores invalidating each other, not from memory pressure.

---

## Coding Patterns

### Pattern: pad-the-end

```go
type Stat struct {
    Hits int64
    _    [56]byte // pad so the next Stat in a slice starts on a fresh line
}
```

Useful when you keep an array of independent stats and want each element on its own line.

### Pattern: pad-between

```go
type DualCounter struct {
    A int64
    _ [56]byte
    B int64
    _ [56]byte
}
```

Useful when two hot fields sit inside the same struct.

### Pattern: per-CPU local

```go
type PerCPU[T any] struct {
    slots []paddedSlot[T]
}

type paddedSlot[T any] struct {
    value T
    _     [64 - unsafe.Sizeof(*new(T))%64]byte
}
```

(With Go 1.21+ generics. The actual padding maths is fiddly; libraries like `sync.Pool` and `golang.org/x/sync/syncmap` handle it internally.)

### Pattern: snapshot and reset

```go
var counter int64

func incr() { atomic.AddInt64(&counter, 1) }

func snapshotAndReset() int64 {
    return atomic.SwapInt64(&counter, 0)
}
```

Fewer reader-writer transitions on the line because the snapshot path is rare.

---

## Clean Code

The single biggest readability hazard with cache-line code is opaque padding. Future-you, opening a struct and seeing `_ [56]byte`, must instantly know why.

- Comment every pad with the reason: `// pad to 64-byte cache line — prevents false sharing of A/B`.
- Use a named constant: `const cacheLine = 64`.
- Use struct tags or doc comments to explain the layout invariant.
- For benchmark-driven padding, keep the benchmark file next to the struct. If the layout changes, the benchmark must still pass.

```go
const cacheLine = 64

type Counter struct {
    n int64
    _ [cacheLine - 8]byte // keep Counter on its own line
}
```

This reads like an intent, not a magic number.

---

## Product Use / Feature

When does a junior engineer encounter cache coherence in real product code?

- **Metrics collection.** A service that records "requests per route per second" with a packed struct of counters is a textbook false-sharing victim under load. The performance team will discover this with `perf` and ask you to shard the counters.
- **Worker pools.** Background workers that update shared progress fields slow down past a handful of cores.
- **Concurrent caches.** A hand-rolled in-memory cache (`map` plus mutex plus stats fields) tends to put the stats next to the mutex, doubling the contention cost.
- **High-throughput RPC servers.** Each handler increments per-route counters; without sharding, the server cannot use its cores.

These are not edge cases. Any service with significant goroutine count and meaningful counters will brush this wall sooner or later.

---

## Error Handling

There are no errors to handle. Cache coherence is a performance topic, not a correctness one. The hardware guarantees correctness — your `atomic.AddInt64` will always increment, your mutex will always exclude. The mistake is to assume that *because* it is correct, it is fast.

The only "error" you must handle is the human one: noticing when a benchmark scales sublinearly with cores, or when a flame graph shows huge time in lock or atomic functions, and tracing the cause to cache-line behaviour.

---

## Security Considerations

Cache effects can leak data. The most famous family of attacks — Spectre and Meltdown — exploit the fact that speculative execution leaves footprints in the cache. From a junior Go perspective the relevant takeaway is:

- Do not trust timing-sensitive code to keep secrets. The CPU's cache state can be probed by an attacker to recover bits of data they should not see.
- Crypto libraries (`crypto/aes`, `crypto/elliptic`) take great care to do **constant-time** operations specifically to avoid cache-timing side channels. Do not invent your own.

For most junior work this is mainly a warning: **do not use a hash map keyed by secret data for security checks**, because cache misses leak information about which key you are looking up.

---

## Performance Tips

1. **Suspect padding when scaling collapses.** If `BenchmarkX-1` is 10ns/op and `BenchmarkX-8` is 50ns/op, you almost certainly have a coherence problem.
2. **Measure, do not guess.** Run with `-cpu=1,2,4,8` to see how throughput tracks core count. Linear scaling is the goal; sublinear is the alarm.
3. **Use `perf stat -e cache-misses` on Linux** to confirm coherence pressure. On macOS, `Instruments → Counters` does the same.
4. **Look at `pprof -http=:8080` and check `runtime.atomic*` and `sync.(*Mutex).Lock`** time. High percentages on uncontended-looking code are a red flag.
5. **Add padding around `sync.Mutex` if you keep many mutexes in a slice or map.** Each `sync.Mutex` is small; many of them tile across a cache line and contend among themselves.
6. **Avoid atomics in your hottest loops.** Even uncontended, an atomic costs roughly 10× a regular instruction. Use locals and flush.
7. **Beware `time.Now()`** in hot loops on some hardware — it touches a shared timer page. Cache-resident, but still cross-core synchronised. (Not strictly coherence, but related.)

---

## Best Practices

- Treat every struct with multiple frequently-written fields as a potential false-sharing site.
- When in doubt, pad. The memory cost is trivial; the throughput gain can be huge.
- Prefer "lots of small local accumulators merged at the end" over "one shared atomic counter".
- Document padding with a `// CACHE LINE` comment so a refactor cannot accidentally drop the bytes.
- Use `go test -bench=. -cpu=1,2,4,8` to *prove* your concurrency change scales.
- Read the Go source for `sync/atomic`, `sync.Pool`, and `runtime/mheap` — they are heavily padded and the comments are excellent.

---

## Edge Cases & Pitfalls

- **64-byte assumption breaks on Apple silicon.** M1/M2 cores use 128-byte cache lines. Padding to 56 bytes is no longer enough; you need 120. Use `const cacheLine = 128` for portable code.
- **The struct may not start on a cache-line boundary.** A 64-byte-padded struct embedded inside another struct may not be aligned. Use `//go:align 64` (Go 1.21+) on a global, or allocate via a slice of cache-line-padded wrappers.
- **Inlined padding does not survive struct copy.** A struct passed by value still uses the same cache logic, but a slice of value-typed structs places elements contiguously — adjacent elements may share a cache line. Pad each element.
- **`sync.WaitGroup` itself is shared.** When many goroutines call `Done()`, they pound the same internal counter line. For 10,000+-goroutine fan-outs use a sharded barrier.
- **`atomic.Pointer` on an unaligned address panics on 32-bit ARM.** Always allocate atomic pointers as fields of an aligned struct.

---

## Common Mistakes

1. **Adding padding to a struct that is not actually hot.** Wastes memory, gains nothing.
2. **Padding only half of a struct.** Putting padding between `A` and `B` but not after `B` means the next adjacent allocation may still share a line with `B`.
3. **Using `int32` thinking it is cheaper.** Smaller fields make false sharing *more* likely because more of them fit on a line.
4. **Relying on `atomic.AddInt64` for performance.** Atomics are for correctness, not speed.
5. **Sharing a `*int64` across goroutines instead of sharding.** Same coherence cost, plus indirection.
6. **Ignoring the merge step in a shard.** If you shard counters across 32 slots and the merge happens 10,000 times per second, the merge becomes the new bottleneck.

---

## Common Misconceptions

- **"Cache lines are 32 bytes."** They were on 1990s hardware. Today: 64 bytes on x86 and most ARM, 128 bytes on Apple silicon.
- **"Atomics avoid cache traffic."** They do not. They *use* cache traffic to enforce ordering. They are at best as expensive as a contended write.
- **"A read-mostly variable is free."** A variable that is read by many cores and written by one is roughly free for the readers, but every write costs an invalidation broadcast.
- **"Padding wastes memory and slows the program."** The opposite. The bytes are tiny next to the cache traffic they prevent.
- **"My program runs on the JVM-like garbage collector so this does not apply."** Go's GC moves objects rarely; the layout you wrote is mostly the layout running. Coherence applies as if it were C.

---

## Tricky Points

- **Compiler reorders.** The Go compiler may reorder struct fields slightly — but only when alignment is wrong. With sensible types it preserves source order. Use `unsafe.Offsetof` to check.
- **GC tag bits.** Some Go runtime internals stash metadata in struct headers. This rarely affects user code but it can mean a `[1]byte` field is not as small as you think.
- **NUMA.** On a multi-socket machine, cache coherence crosses sockets and is much more expensive. Padding is still the right move, but pinning goroutines to NUMA nodes (rare in Go) is sometimes needed too.
- **Atomic 64-bit fields on 32-bit platforms.** They must be 8-byte aligned. The Go runtime documents this in `sync/atomic`. On structs, put 64-bit atomics first.

---

## Test

```go
package falseshare_test

import (
    "sync"
    "sync/atomic"
    "testing"
    "unsafe"
)

type packed struct{ a, b int64 }
type padded struct {
    a int64
    _ [56]byte
    b int64
}

func TestPaddingChangesAddress(t *testing.T) {
    var p packed
    da := uintptr(unsafe.Pointer(&p.a)) / 64
    db := uintptr(unsafe.Pointer(&p.b)) / 64
    if da != db {
        t.Fatalf("packed struct unexpectedly straddles a line")
    }
    var q padded
    da = uintptr(unsafe.Pointer(&q.a)) / 64
    db = uintptr(unsafe.Pointer(&q.b)) / 64
    if da == db {
        t.Fatalf("padded struct still on the same line; check alignment")
    }
}

func TestCorrectnessOfContendedIncrement(t *testing.T) {
    var c packed
    var wg sync.WaitGroup
    wg.Add(2)
    go func() {
        defer wg.Done()
        for i := 0; i < 1_000_000; i++ {
            atomic.AddInt64(&c.a, 1)
        }
    }()
    go func() {
        defer wg.Done()
        for i := 0; i < 1_000_000; i++ {
            atomic.AddInt64(&c.b, 1)
        }
    }()
    wg.Wait()
    if c.a != 1_000_000 || c.b != 1_000_000 {
        t.Fatalf("lost increments: a=%d b=%d", c.a, c.b)
    }
}
```

The point of these tests: confirm correctness is unaffected, while a separate benchmark shows the throughput difference.

---

## Tricky Questions

1. **Why does adding padding sometimes make the slow case faster but the fast case the same speed?** Because padding only helps when there is actual cross-core contention. On one core, the same line is reused freely; padding wastes a few bytes.
2. **My struct already has fields aligned 8 bytes apart — surely they are not on the same cache line?** Eight-byte alignment does not save you. Any pair within 64 bytes shares a line.
3. **If atomics are slow, why does Go use them in `sync.Mutex`?** Because correctness comes first. The mutex hot path optimises for the *uncontended* case where the line is in **Modified** state on the locking core; the rare contention case pays the coherence cost.
4. **Why is my benchmark fast at GOMAXPROCS=1 and slow at GOMAXPROCS=8?** GOMAXPROCS=1 means one OS thread, so no real cross-core sharing happens. At higher GOMAXPROCS, multiple cores fight for the same line.
5. **Can I just call `runtime.LockOSThread()` to avoid coherence problems?** No. `LockOSThread` pins a goroutine to a thread but does not pin a thread to a core. And even if it did, the moment two cores touch the same data, coherence applies.

---

## Cheat Sheet

```
cache line size           = 64 B on x86 and most ARM; 128 B on Apple silicon
L1 hit                    ≈ 1 ns
L2 hit                    ≈ 3–4 ns
L3 hit                    ≈ 12 ns
DRAM access               ≈ 80 ns
Cross-core invalidation   ≈ 30 ns (same socket); 100+ ns (cross socket)
atomic.AddInt64           ≈ 6–10 ns uncontended; can exceed 100 ns under bouncing

False sharing fix         = pad to a cache line
Better fix                = per-goroutine local; merge at end
Best detection            = perf stat, pprof, run with -cpu=1,2,4,8
```

---

## Self-Assessment Checklist

- I can define a cache line and state its size on x86 and Apple silicon.
- I can explain why two goroutines writing to neighbouring fields slow down even though they never read each other.
- I can write a benchmark that proves false sharing exists in a given struct.
- I can fix false sharing with padding.
- I can prefer a per-goroutine local accumulator when padding is not enough.
- I know that `sync/atomic` operations are not free and ride on the same coherence machinery as plain writes.
- I know how to point `perf` or `pprof` at a program and get cache-related signal.

---

## Summary

Cache coherence is a hardware contract that keeps every core's view of memory consistent. The unit of sharing is a 64-byte cache line. When two cores write to the same line — even to different bytes within it — the hardware pays a per-write cost to keep them coherent. This is the source of **false sharing**, the single most common reason concurrent Go programs fail to scale. The remedy is layout: pad hot fields, shard counters, prefer per-goroutine locals. Atomics are not magic; they are coherence-bound writes. Padding plus measurement (`perf`, `pprof`, multi-CPU benchmarks) covers the junior-level workflow.

---

## What You Can Build

- A request counter that handles a million RPS on a single box because it shards instead of contends.
- A metrics library where every counter is on its own cache line and adds zero scaling penalty.
- A correct microbenchmark suite that exposes false sharing in arbitrary structs.
- A small library function `func IsOnSameCacheLine(a, b unsafe.Pointer) bool` to assert your assumptions at startup.

---

## Further Reading

- *What every programmer should know about memory* — Ulrich Drepper. The classic deep dive.
- *Computer Architecture: A Quantitative Approach* — Hennessy & Patterson. Chapters on caches and coherence.
- Go source: `sync/pool.go`, `runtime/mheap.go`, `sync/atomic/doc.go`. Real production padding.
- Intel Optimization Reference Manual, sections on cache organisation.
- ARM Architecture Reference Manual, section on memory ordering.

---

## Related Topics

- **02-acquire-release** — How memory ordering interacts with coherence; releases publish coherence updates.
- **03-sequential-consistency** — The strongest ordering model; expensive because every store is a coherence event.
- **05-false-sharing** — A dedicated section drilling deeper into the detection workflow.
- **Goroutines** — The producer of concurrency that interacts with coherence.
- **sync.Mutex** — A coherence-aware primitive whose contended cost is fundamentally coherence cost.

---

## Diagrams & Visual Aids

```
Two cores, one cache line, the bad case:

Core 0 L1: [line A: MODIFIED]   <- writes a
                  |
                  | invalidate
                  v
Core 1 L1: [line A: INVALID]

Then core 1 writes b on the same line:

Core 0 L1: [line A: INVALID]
                  ^
                  | invalidate
                  |
Core 1 L1: [line A: MODIFIED]   <- writes b

Ping. Pong. Ping. Pong. Throughput dies.
```

```
Same scenario, with padding:

Core 0 L1: [line A: MODIFIED  a, pad]
Core 1 L1: [line B: MODIFIED  pad, b]

Both lines independent. No invalidations. Throughput scales.
```

```
The hierarchy a write travels through under contention:

Core writes a contended atomic:
  1. Store buffer holds the write
  2. Core sends Read-For-Ownership to coherence fabric
  3. Coherence fabric invalidates all other copies
  4. Other cores acknowledge (snoop response)
  5. Line state moves to Modified on writer
  6. Store buffer drains into L1
  7. Memory fence (if atomic.Store/Add) waits for global visibility

Each step costs cycles. Each step grows under more contention.
```

---

## Deeper Walkthrough: A Day in the Life of a Cache Line

To make all of this concrete, let us follow one cache line through a realistic Go program. Suppose we have:

```go
type Stats struct {
    Hits   int64
    Misses int64
}
var s Stats
```

`Hits` lives at address `0x1000` and `Misses` lives at address `0x1008`. The cache line that contains both is the 64-byte block from `0x1000` to `0x103F`. The `Stats` struct occupies the first 16 bytes of that line; the remaining 48 bytes belong to whatever happened to be allocated next.

### Phase 1 — Single goroutine warm-up

Goroutine A runs `atomic.AddInt64(&s.Hits, 1)`. The CPU needs to write to `0x1000`.

1. The core checks its L1 data cache. The line is not there — cold miss.
2. The core checks L2. Not there.
3. The core checks L3. Not there.
4. The core sends a **Read-For-Ownership (RFO)** request to main memory.
5. The line arrives. It is installed in L1 in **Modified** state (because we wrote to it).
6. The write completes. The whole sequence took roughly 80 nanoseconds.

For the next million increments, the line stays in L1 in Modified state. Each subsequent `AddInt64` takes about 6–10 nanoseconds. The throughput is bounded by the cost of the `LOCK XADD` instruction itself, not by memory.

### Phase 2 — A second goroutine starts touching Misses

Now goroutine B starts running on a different core and calls `atomic.AddInt64(&s.Misses, 1)`. Its core does not have the line.

1. Core B issues an RFO for address `0x1008`.
2. The coherence fabric sees that core A holds the line in Modified state.
3. Core A's copy must be evicted (or downgraded). The fabric sends a snoop to core A.
4. Core A acknowledges, writes the line back to L3, and marks its own copy **Invalid**.
5. Core B receives the line in Modified state.
6. Core B's write completes.

Now goroutine A wants to increment `Hits` again. Its line is Invalid. The whole dance reverses. The line bounces back to core A. And the moment B writes again, it bounces to B.

Each bounce costs ~30ns on a single socket, ~100ns across sockets. The original ~6ns operation has become ~30ns or worse. If both goroutines are tight-looping, that is the rate at which they fight: the line ping-pongs at roughly the cross-core latency.

### Phase 3 — What does padding actually change?

Insert padding:

```go
type Stats struct {
    Hits   int64
    _      [56]byte
    Misses int64
    _      [56]byte
}
```

Now `Hits` is at `0x1000` and `Misses` is at `0x1040`. They are on different lines. Core A holds the line containing `Hits` in Modified state and never relinquishes it. Core B holds the line containing `Misses` in Modified state and never relinquishes it. Each increment is ~6ns. Throughput scales linearly with cores until you run out of cores.

This is a 5–10× difference in real benchmarks. The cost is sixteen wasted bytes per struct.

### Phase 4 — What about reads from a third goroutine?

A monitoring goroutine periodically calls:

```go
hits := atomic.LoadInt64(&s.Hits)
```

`atomic.LoadInt64` on x86 is a plain `MOV` (loads are already atomic for aligned 8-byte values). The monitor's core needs the line. It issues a **Read** request, not an RFO.

- If core A holds the line in Modified, the fabric routes the line to the monitor in **Shared** state and downgrades core A's copy to **Shared**.
- The monitor reads from its L1.
- The next write from core A requires the fabric to invalidate the monitor's copy and upgrade core A back to Modified.

A periodic monitor adds one extra coherence event per check. Once a second: invisible. Once a microsecond: catastrophic.

### Phase 5 — The whole story in numbers

For a benchmark on a typical 8-core x86 laptop:

| Scenario | ns/op | Throughput |
|----------|-------|-----------|
| Single goroutine, atomic.AddInt64 on `Hits` | 6 | 165M ops/s |
| Two goroutines, atomic.AddInt64 on shared `Hits` | 60 | 16M ops/s combined |
| Two goroutines, atomic.AddInt64, `Hits` vs `Misses`, no padding | 45 | 22M ops/s combined |
| Two goroutines, atomic.AddInt64, padded `Hits` and `Misses` | 7 | 280M ops/s combined |
| Eight goroutines, padded per-core counters | 7 | 1.1B ops/s combined |

The last line is the goal: linear scaling. The third line is the worst-of-all-worlds: looks parallel, behaves serial. The fourth line is what your code *can* look like with one struct change.

---

## Additional Real Hardware Notes

### Why x86 atomics are particularly expensive

On x86, the `LOCK` prefix flushes the store buffer and forces the operation to be globally visible. That is not just a coherence event; it is also a fence. Even an "uncontended" atomic costs ~6ns because the store buffer must drain. By contrast, a plain mov to a Modified-state line costs less than a nanosecond.

This is why people sometimes count `atomic.Load` as nearly free (it is just a load) but `atomic.Store` and `atomic.Add` as expensive (they include the fence).

### Why ARM is different — and Apple silicon especially

ARM uses **load-linked / store-conditional** (LL/SC) for atomic read-modify-write. The store-conditional only succeeds if the line was not invalidated since the load. Under contention, the store fails and you retry. This makes contention even more visible at the instruction level — you can literally see "atomic loop" instructions in a profile.

Apple's M-series cores use 128-byte cache lines. Code padded to 64 bytes still false-shares on these CPUs. Portable code defines:

```go
const CacheLineSize = 128
```

…and accepts a few wasted bytes on x86 in exchange for correctness across platforms. The `golang.org/x/sys/cpu` package exposes `CacheLinePad` defined as `[CacheLinePadSize]byte` for exactly this reason.

### Why store buffers complicate the picture

Even when a line is Modified and resident in L1, a write does not instantly hit L1. It first lands in the **store buffer**, a small per-core queue of recent stores. The store buffer lets the core keep executing while writes drain in the background.

Two consequences:

1. A store followed by an atomic op on the same line is fast (the store and the LOCKed op pair up).
2. A store on core 0 is not immediately visible to core 1, even after coherence has fired. The store buffer must drain. This is the "fences are needed for visibility" story, which junior code typically does not have to think about, but middle.md will go into.

---

## Walkthrough Benchmark and How to Read It

Here is a complete benchmark file you can drop into a fresh module:

```go
package falseshare

import (
    "sync"
    "sync/atomic"
    "testing"
)

const work = 10_000_000

type packed struct {
    a, b, c, d int64
}

type padded struct {
    a int64
    _ [56]byte
    b int64
    _ [56]byte
    c int64
    _ [56]byte
    d int64
    _ [56]byte
}

func runFour(b *testing.B, addA, addB, addC, addD func()) {
    for i := 0; i < b.N; i++ {
        var wg sync.WaitGroup
        wg.Add(4)
        go func() { defer wg.Done(); for j := 0; j < work; j++ { addA() } }()
        go func() { defer wg.Done(); for j := 0; j < work; j++ { addB() } }()
        go func() { defer wg.Done(); for j := 0; j < work; j++ { addC() } }()
        go func() { defer wg.Done(); for j := 0; j < work; j++ { addD() } }()
        wg.Wait()
    }
}

func BenchmarkPacked(b *testing.B) {
    var p packed
    runFour(b,
        func() { atomic.AddInt64(&p.a, 1) },
        func() { atomic.AddInt64(&p.b, 1) },
        func() { atomic.AddInt64(&p.c, 1) },
        func() { atomic.AddInt64(&p.d, 1) },
    )
}

func BenchmarkPadded(b *testing.B) {
    var p padded
    runFour(b,
        func() { atomic.AddInt64(&p.a, 1) },
        func() { atomic.AddInt64(&p.b, 1) },
        func() { atomic.AddInt64(&p.c, 1) },
        func() { atomic.AddInt64(&p.d, 1) },
    )
}
```

Run with:

```
go test -bench=. -benchtime=3s -cpu=4
```

On most machines the `Padded` benchmark beats the `Packed` benchmark by 4–8×. The exact ratio depends on the CPU's coherence latency, but the direction is always the same: **packed is worse**.

To see the underlying coherence cost on Linux:

```
perf stat -e cache-references,cache-misses,LLC-loads,LLC-load-misses ./falseshare.test -test.bench=BenchmarkPacked -test.benchtime=3s
```

You will see `cache-misses` numbers in the tens of millions for the packed test and a fraction of that for the padded test, with the same total work.

---

## Visualising the Sharing Geometry

A clean way to internalise the geometry is to draw structs as bytes on a strip and overlay cache-line boundaries every 64 bytes.

```
Packed struct (32 bytes total), aligned to address 0x1000:

0x1000     0x1008    0x1010   0x1018           0x103F
| a (8B)  | b (8B)  | c (8B) | d (8B) |  ...  |
|---------------- cache line 0 --------------|
```

All four fields are on cache line 0. Four cores contending: one shared line ping-pongs four ways.

```
Padded struct (256 bytes), aligned to 0x1000:

0x1000      0x103F
| a + 56B pad  |  cache line 0
0x1040      0x107F
| b + 56B pad  |  cache line 1
0x1080      0x10BF
| c + 56B pad  |  cache line 2
0x10C0      0x10FF
| d + 56B pad  |  cache line 3
```

Each field has a dedicated line. Four cores never contend.

The picture is the entire reason this section matters.

---

## Mini-Project: Build a False-Sharing Detector

You can build a small reusable detector that warns at startup when two declared variables share a cache line. Here is the sketch:

```go
package detect

import (
    "fmt"
    "unsafe"
)

const cacheLine = 64

// SameLine reports true if the two pointers fall on the same 64-byte cache line.
func SameLine(a, b unsafe.Pointer) bool {
    return uintptr(a)/cacheLine == uintptr(b)/cacheLine
}

// MustNotShareLine panics if a and b are on the same cache line.
// Use in package init() for hot, contended globals.
func MustNotShareLine(name string, a, b unsafe.Pointer) {
    if SameLine(a, b) {
        panic(fmt.Sprintf("%s: hot fields share a cache line at %p / %p", name, a, b))
    }
}
```

Drop calls to `MustNotShareLine` into your `init()` for the structs you most care about. CI will catch accidental refactors that break the layout.

---

## How to Read a `pprof` Trace for Coherence Symptoms

`pprof` is not a hardware profiler — it cannot directly tell you about cache misses. But it does sample on-CPU time, and coherence-bound code spends a lot of its time *waiting* for invalidations to complete, which `pprof` does count.

Typical symptoms:

- Disproportionate time in `runtime/internal/atomic.Xchg64`, `Cas64`, or `Xadd64` for code that looks like it should be cheap.
- High self-time inside `sync.(*Mutex).Lock` even though the mutex looks uncontended.
- A `pprof -web` graph where the hottest function is a function you wrote that just does `*c++` or `atomic.AddInt64`.

When you see this, do not assume the algorithm is wrong. Assume the layout is wrong. Generate a synthetic benchmark of just that code path, run it with `-cpu=1,2,4,8`, and confirm or deny the suspicion.

For the *actual* hardware signal, drop down to `perf` (Linux) or `Instruments → Counters` (macOS) — covered properly in middle.md and beyond.

---

## A Note on Test Stability

Cache-coherence benchmarks are noisy. The same code on the same machine can vary by 30% across runs depending on:

- Which cores the OS picks for your goroutines.
- Whether the cores are on the same CCX (AMD) or cluster (Apple silicon).
- Hyperthreading: two goroutines on the same physical core share a cache and do *not* exhibit false sharing.
- CPU frequency scaling: the first run after idle is often anomalous.

To get reliable numbers:

```
go test -bench=. -count=10 -benchtime=3s -cpu=4 | tee bench.out
benchstat bench.out
```

`benchstat` reports the mean and standard deviation. If padding shows a 3× geomean improvement with confidence, you have the win.

---

## Practising the Skill

A short progression you can do this week:

1. **Reproduce the contended-atomic benchmark.** Two goroutines, one variable, `atomic.AddInt64`. Note ns/op.
2. **Reproduce the false-sharing benchmark.** Same code with two adjacent variables. Note ns/op.
3. **Add padding.** Same code, padded struct. Note ns/op.
4. **Add a third and fourth goroutine.** Watch padded scale linearly and packed scale negatively.
5. **Inspect with `perf stat`.** Get a feel for the `cache-misses` delta.
6. **Read `golang.org/x/sys/cpu`** to see how the standard library structures its `CacheLinePad` type.
7. **Open the `sync` and `sync/atomic` source.** Find every `_ [N]byte` and read the comment explaining why.

After that progression, false sharing will never surprise you again.

---

## Walkthrough: A Realistic Production Scenario

It is one thing to read about coherence in the abstract. It is another to recognise it in a service running in production. Here is a story that plays out routinely.

### The setup

You inherit an HTTP service that records, per request:

```go
type RouteStats struct {
    Count    int64
    Errors   int64
    LatencyMicros int64
}

var routes = map[string]*RouteStats{
    "/login":    {},
    "/checkout": {},
    "/search":   {},
    "/profile":  {},
}

func handle(route string, errored bool, latency int64) {
    rs := routes[route]
    atomic.AddInt64(&rs.Count, 1)
    if errored {
        atomic.AddInt64(&rs.Errors, 1)
    }
    atomic.AddInt64(&rs.LatencyMicros, latency)
}
```

The code looks fine. Atomic operations everywhere, no data races. CI is green. Load tests at 1k RPS pass. The service is deployed.

### The symptom

Production traffic ramps to 50k RPS. CPU usage explodes. You pull a `pprof` profile and the top function is `runtime/internal/atomic.Xadd64`. You scratch your head — the atomic op is supposed to be cheap.

You then notice that on a 16-core box, scaling beyond 4 cores does nothing. You add cores and throughput stays flat. The service is bottlenecked on something that does not look like a bottleneck.

### The diagnosis

Each `RouteStats` is a 24-byte struct allocated on the heap. The Go allocator, by default, places small allocations in size classes that pack them densely. Multiple `RouteStats` structs may sit on the same 64-byte cache line. Even a single `RouteStats` has all three of `Count`, `Errors`, and `LatencyMicros` packed within 24 bytes — guaranteed to share a line.

So even within one route, three different counters share a line. Across routes, multiple route structs share lines. Every increment from any handler triggers cross-core invalidations.

You confirm it with `perf stat -e cache-references,cache-misses`:

```
cache-references:    8,432,991,123
cache-misses:        4,210,005,847   ( 49.93% of all cache refs )
```

Half of all cache references are misses. The CPU is spending most of its time waiting for coherence.

### The fix

Pad the struct and the slot:

```go
const cacheLine = 64

type RouteStats struct {
    Count         int64
    _             [cacheLine - 8]byte
    Errors        int64
    _             [cacheLine - 8]byte
    LatencyMicros int64
    _             [cacheLine - 8]byte
}
```

Now each counter is alone on its line. Three different fields incremented from the same handler do not interfere with each other.

For across-route isolation, the route map should hand out pointers to heap-allocated `RouteStats` that the allocator places far apart. The padding pushes each struct to ~192 bytes; the allocator gives each its own area.

You redeploy. The `pprof` profile is unrecognisable. `runtime/internal/atomic.Xadd64` falls from 35% of CPU to 4%. CPU usage drops by half. Throughput at 16 cores is now 4× the previous peak.

### The lesson

This is not a corner case. Any Go service that:

- has more than a handful of cores,
- and atomically updates per-second counters,
- and runs at meaningful traffic,

…will eventually hit this wall. The fix is always layout-first.

---

## Twenty Concrete Patterns You Will See in Real Codebases

To wrap up the junior level, here are twenty patterns that show up across Go codebases. Recognising them on sight is the difference between "I have read about coherence" and "I think in cache lines."

### Pattern 1 — Anonymous padding fields

```go
type X struct {
    hot int64
    _   [56]byte
}
```

A `_ [N]byte` immediately after a hot field is the universal "I am padding to a cache line" idiom in Go.

### Pattern 2 — Padding via golang.org/x/sys/cpu

```go
import "golang.org/x/sys/cpu"

type X struct {
    hot int64
    _   cpu.CacheLinePad
}
```

`cpu.CacheLinePad` is sized to whatever the package thinks the local cache line is. Less precise than hand-padding but portable.

### Pattern 3 — Per-shard struct

```go
type shard struct {
    mu sync.Mutex
    m  map[string]int
    _  cpu.CacheLinePad
}

type ShardedMap struct {
    shards [256]shard
}
```

The internal map of `sync.Map` and many third-party caches use this shape.

### Pattern 4 — Embedded padding

```go
type counter struct {
    int64
    _ [56]byte
}
```

Slightly less common; only works when the type is `int64` directly.

### Pattern 5 — Padded ring buffer slots

```go
type slot struct {
    seq  uint64
    data unsafe.Pointer
    _    [48]byte
}

var ring [1024]slot
```

LMAX Disruptor-style queues live or die on this layout.

### Pattern 6 — Aligned slice of atomics

```go
type AtomicCounters struct {
    cs [16]struct {
        v uint64
        _ [56]byte
    }
}
```

A common alternative to `[]*int64`.

### Pattern 7 — Channel buffer padding

Go's runtime channels pad internal fields. You will see the comments in `runtime/chan.go` near `hchan`.

### Pattern 8 — `sync.WaitGroup` shape

`sync.WaitGroup` uses a packed counter that aligns on an 8-byte boundary because of 32-bit ARM atomic-alignment rules. This is alignment, not padding, but you will see it.

### Pattern 9 — `sync.Pool` per-P slots

`sync.Pool` keeps a per-P local pool. Each slot is padded so that adjacent Ps do not interfere.

### Pattern 10 — Read-mostly published value

```go
type Snapshot struct {
    Data atomic.Pointer[State]
    _    [56]byte
}
```

The pointer is read by many cores; writes are rare. Padding isolates the publication line.

### Pattern 11 — Per-CPU `runtime.MemStats`-style counters

```go
type pcpu struct {
    counts [128]struct {
        v uint64
        _ [56]byte
    }
}
```

128 slots is overkill for any reasonable CPU count but allows free indexing by `runtime.NumCPU()`.

### Pattern 12 — Sharded mutex registry

```go
type lockShard struct {
    mu sync.Mutex
    _  [56]byte
}

var locks [64]lockShard
```

A locking library indexed by hash. Without padding, many mutexes pack onto one line and contend among themselves.

### Pattern 13 — Pre-padded buffer

```go
type Buffer struct {
    _    [64]byte // leading pad
    head int64
    _    [56]byte
    tail int64
    _    [56]byte
    data [1 << 16]byte
}
```

A leading pad isolates the buffer's start from whatever lives just before it in memory.

### Pattern 14 — Padded result slot

```go
type taskResult struct {
    out interface{}
    err error
    _   [40]byte
}
```

Result slots in worker pools. Each worker writes its own slot; the supervisor reads them. Without padding, all workers fight over one or two lines.

### Pattern 15 — Padded counter wrapped in a type

```go
type Counter struct {
    v atomic.Int64
    _ [56]byte
}

func (c *Counter) Add(x int64) { c.v.Add(x) }
func (c *Counter) Load() int64 { return c.v.Load() }
```

A reusable padded type. Slightly nicer to use than raw struct fields.

### Pattern 16 — Cache-aligned global allocation

```go
//go:align 64
var globalCounter int64
```

Go 1.21+ `//go:align` directive. Combined with following padding, gives a cache-line-aligned global.

### Pattern 17 — `runtime/internal/atomic` style

The runtime defines `atomic.Int64`, `atomic.Uint64`, etc. as struct types specifically so that they can attach alignment and (if needed) padding annotations. Read the source — it is short.

### Pattern 18 — Hot/cold split

```go
type Resource struct {
    // hot — touched on every request
    Counter int64
    _       [56]byte

    // cold — touched only at startup/shutdown
    Name    string
    Created time.Time
}
```

Cold fields can share a line. Only the hot ones need isolation.

### Pattern 19 — Padded reader/writer split

```go
type RingBuffer struct {
    writeIdx atomic.Uint64
    _        [56]byte
    readIdx  atomic.Uint64
    _        [56]byte
    buf      [N]Item
}
```

The classic single-producer-single-consumer ring. Producer touches only writeIdx; consumer touches only readIdx.

### Pattern 20 — Padding with explanatory constants

```go
const (
    cacheLine = 64
    int64Size = 8
)

type X struct {
    a int64
    _ [cacheLine - int64Size]byte
}
```

Self-documenting. A new maintainer can see the math.

Across the Go ecosystem, these twenty shapes cover roughly every padding pattern you will encounter. None of them is mysterious; all of them spring from the same fact: **64 bytes is the unit of sharing, and writes contend.**

---

## A Slow, Careful Re-Read of the Problem

It is worth ending with a slow restatement of the entire problem from the ground up, so that the foundation is unshakeable.

A computer's main memory is slow — about 80 nanoseconds per random read. A CPU running at 3 GHz can execute roughly 240 instructions in that time. So if every load went to main memory, programs would crawl.

The solution is caching: a small fast memory near the CPU that holds recently used data. Each core has its own L1 cache, perhaps 32 KB, accessible in one nanosecond. Each core also has its own L2 cache, perhaps 1 MB, accessible in 3 nanoseconds. All cores on a socket share an L3 cache, perhaps 32 MB, accessible in 12 nanoseconds. Beyond L3 is main memory at 80ns.

The cache stores data in fixed-size lines, typically 64 bytes. When a core reads a byte, it actually pulls in the whole 64-byte line. Subsequent reads of nearby bytes hit the cache and are nearly free.

Multiple cores can have copies of the same line. The hardware must guarantee that all copies agree at any moment that programs can observe. The protocol that does this is called cache coherence. The simplest correct rule is: at most one core can have a writable copy of a line at any time. If a second core wants to write, the first core's copy must be invalidated.

That invalidation is a message — a snoop, a directory probe, depending on the architecture — and it costs time. On the same socket, perhaps 30 cycles. Across sockets, hundreds of cycles. In a program where two cores constantly want to write to the same line, those messages dominate execution.

False sharing is the trap where two logically independent variables, sitting within 64 bytes of each other, become artificially coupled by the cache line they share. Even though no source code mentions them together, the hardware treats them as one. The fix is layout: pad them apart, shard them, or accumulate locally.

Atomic operations in Go (and every other modern language) ride on the same cache-coherence machinery. `atomic.AddInt64` is not magic; it is a write that pays the same coherence cost as a plain write, often with an added memory fence. Under contention, atomics are slow because coherence is slow, not because Go has chosen a slow implementation.

The tools for measuring this in Go are:

- `go test -bench=. -cpu=1,2,4,8` to see scaling.
- `go test -bench=. -benchmem` to see memory effects.
- `pprof` for CPU profiles and flame graphs.
- `perf stat -e cache-misses` on Linux for hardware counters.
- `unsafe.Pointer` arithmetic at startup to assert layout invariants.

The fixes are:

- Pad hot fields.
- Shard contended state per CPU.
- Use local accumulators; merge on a slow path.
- Use `golang.org/x/sys/cpu.CacheLinePad` for portability.

Internalise this and you will write Go that scales the way the marketing says it should.

---

## Closing Thought for the Junior

Cache coherence is the kind of topic that looks intimidating in a textbook and obvious after a single benchmark. Run the false-sharing benchmark on your own laptop. Watch the throughput collapse and then leap back to life. Once you have seen it with your own eyes, you will start spotting the pattern in code reviews, in pull requests, in your own old code. That is the real curriculum. The middle.md file will take you into the MESI state machine and what `LOCK` does at the hardware level. The senior.md file will teach you to design data structures that *cannot* false-share. The professional.md file goes inside the Go runtime.

For now: the cache line is 64 bytes, writes contend, padding is your first weapon, and measurements are the only truth.

---

## Extended Worked Examples

The remainder of this file works through five extended examples in detail. Each starts from naive code, measures the problem, applies a fix, and re-measures. The goal is to make the patterns reflexive.

### Worked Example A — A Hit/Miss Counter Pair

A small in-memory cache library exposes hit and miss counters:

```go
package cache

import "sync/atomic"

type Stats struct {
    Hits   int64
    Misses int64
}

func (s *Stats) RecordHit()  { atomic.AddInt64(&s.Hits, 1) }
func (s *Stats) RecordMiss() { atomic.AddInt64(&s.Misses, 1) }
```

A test driver hammers it with two goroutines:

```go
func BenchmarkStats(b *testing.B) {
    var s Stats
    var wg sync.WaitGroup
    wg.Add(2)
    go func() {
        defer wg.Done()
        for i := 0; i < b.N; i++ { s.RecordHit() }
    }()
    go func() {
        defer wg.Done()
        for i := 0; i < b.N; i++ { s.RecordMiss() }
    }()
    wg.Wait()
}
```

Measurements on a typical x86 box:

```
BenchmarkStats-8        40000000      60 ns/op
```

Sixty nanoseconds per atomic op when each goroutine is doing pure increments. That is approximately the cross-core invalidation latency. Why? Because every Hit increment forces the line to core 0; every Miss increment forces it to core 1. The line is in flight more often than it is at rest.

After padding:

```go
type Stats struct {
    Hits   int64
    _      [56]byte
    Misses int64
    _      [56]byte
}
```

Same benchmark:

```
BenchmarkStats-8       240000000       7 ns/op
```

Nearly a 10× win. Same operations, same correctness, different layout.

The interesting question: at what level of traffic does this matter? At 50k RPS — call it 25k hits per second and 25k misses per second — the difference is 25,000 × (60-7) ns ≈ 1.3ms of wasted CPU per second per pair. That is small in isolation. But multiply by every counter in the service and you are losing percentages of CPU to invalidations.

### Worked Example B — A Per-Goroutine Latency Histogram

Suppose every handler records a latency sample into a shared histogram:

```go
type Histogram struct {
    Buckets [16]int64
}

func (h *Histogram) Observe(latency time.Duration) {
    b := bucketIndex(latency)
    atomic.AddInt64(&h.Buckets[b], 1)
}
```

Sixteen int64 buckets take 128 bytes, exactly two cache lines. Adjacent buckets share a line. A handler that mostly hits bucket 3 and another that mostly hits bucket 5 contend on line 0; one hitting bucket 9 and one hitting bucket 12 contend on line 1.

The fix is to allocate per-CPU histograms:

```go
type Histogram struct {
    perCPU []paddedBucketSet
}

type paddedBucketSet struct {
    Buckets [16]int64
    _       [128 - 128%64]byte
}

func (h *Histogram) Observe(cpu int, latency time.Duration) {
    b := bucketIndex(latency)
    atomic.AddInt64(&h.perCPU[cpu%len(h.perCPU)].Buckets[b], 1)
}

func (h *Histogram) Snapshot() [16]int64 {
    var total [16]int64
    for _, p := range h.perCPU {
        for i := range total {
            total[i] += atomic.LoadInt64(&p.Buckets[i])
        }
    }
    return total
}
```

Now each CPU writes its own 128-byte block. Snapshots are cheap and rare; writes are cheap and frequent. The buckets *within* one CPU's slot still share lines, but only one core writes them, so no contention occurs.

### Worked Example C — A Shared Mutex on Many Resources

A naive resource manager:

```go
type Resource struct {
    mu sync.Mutex
    // ... small fields ...
}

var resources []Resource
```

`sync.Mutex` is 8 bytes on amd64. A slice of 8 resources fits in 64 bytes — one cache line. Eight goroutines, each locking its own resource, **share the same line**. They appear independent but every `Lock()` invalidates everyone else's copy of the same line.

Fix:

```go
type Resource struct {
    mu sync.Mutex
    _  [56]byte
    // ... rest of struct
}
```

Each resource is now on its own line. Independent locks behave independently.

This is a particularly insidious case because the source code looks fine and the bug only appears at scale. Tools like `mutex.Lock` profiling will not flag it — there is no mutex contention. The contention is *below* the mutex, in the cache.

### Worked Example D — A Lock-Free Ring Buffer Slot Layout

Consider an SPSC ring buffer (single producer, single consumer):

```go
type Ring struct {
    write uint64
    read  uint64
    buf   [N]item
}
```

Producer writes `write`. Consumer reads `write` (to check fullness) and writes `read`. Producer reads `read` (to check space) and writes `write`. Both fields, on the same line, are written by both goroutines. Classic ping-pong.

The fix has two parts. First, separate the indices:

```go
type Ring struct {
    write uint64
    _     [56]byte
    read  uint64
    _     [56]byte
    buf   [N]item
}
```

Second, cache each side's view of the other index:

```go
type Ring struct {
    write       uint64
    cachedRead  uint64 // producer's stale view; only it writes this
    _           [48]byte
    read        uint64
    cachedWrite uint64 // consumer's stale view; only it writes this
    _           [48]byte
    buf         [N]item
}
```

Producer reads its own `cachedRead`; only refreshes from `read` when the cache says it is full. Consumer mirrors. The result: under normal flow neither side touches the other side's line at all.

This pattern is the heart of high-performance ring buffers — LMAX Disruptor, DPDK, and many high-frequency-trading queues all use it.

### Worked Example E — Reference Counters

A garbage-collected language like Go does not need explicit reference counters most of the time, but some patterns still need them (think: pinning external resources). Suppose:

```go
type Resource struct {
    refs int64
    data []byte
}

func (r *Resource) Acquire() { atomic.AddInt64(&r.refs, 1) }
func (r *Resource) Release() {
    if atomic.AddInt64(&r.refs, -1) == 0 {
        r.cleanup()
    }
}
```

If 32 goroutines are all calling `Acquire`/`Release` on the same resource, the `refs` field's line pings between cores at the cross-core latency. Worse, the line probably also holds the first bytes of `data`, so reading `data` invalidates the increment line.

Mitigations, from cheap to elaborate:

1. **Pad refs.** Put it on its own line.
2. **Biased reference counting.** A primary holder owns the refs locally; other goroutines decrement on a remote slot that is merged later. (Complex; rare in Go.)
3. **Avoid reference counting.** Use the garbage collector; only refcount external resources.

For most Go code, option 1 is sufficient. Option 2 is real-world important in JVMs and Swift but rare in Go because of GC.

---

## Hands-On Exercise Set

You should not read this file and move on. The skill is in the fingers. Try each exercise.

### Exercise 1 — Reproduce false sharing

Write a benchmark with two `int64` fields in one struct, two goroutines doing `atomic.AddInt64` on the two fields, and a `WaitGroup`. Run with `-cpu=4`. Note the ns/op.

### Exercise 2 — Fix it with padding

Add a `_ [56]byte` between the fields. Rerun. Compute the speedup.

### Exercise 3 — Find the line breakpoint

Sweep padding from 0 to 128 bytes in 8-byte steps. Plot ns/op vs pad size. You should see a step at the cache line boundary.

### Exercise 4 — Detect with perf

On Linux, run both versions under `perf stat -e cache-misses`. Note the ratio.

### Exercise 5 — Inspect runtime padding

Read `runtime/internal/atomic/types.go`. Find an `Int64` type. Note any padding. Read the comment.

### Exercise 6 — Inspect sync/atomic in std lib

Read `sync/atomic/doc.go`. Note its alignment requirements for 64-bit fields on 32-bit platforms.

### Exercise 7 — Pad a real type

Take a struct you have written that is mutated concurrently. Add padding to its hottest fields. Run an existing benchmark; see whether it improved.

### Exercise 8 — Shard a counter

Convert a shared `atomic.Int64` counter into a per-CPU sharded counter. Compare ns/op under load.

### Exercise 9 — Misuse padding deliberately

Add padding to a struct that is never contended. Measure that nothing changes. Internalise that padding is not free.

### Exercise 10 — Read the Go runtime

Open `runtime/proc.go`. Find a `pad` field. Read enough surrounding code to understand why it is there.

---

## Cache-Coherence Vocabulary for a Junior Reading Reviews

Reviewers will use this vocabulary. Understand each phrase:

- "**False sharing on the stats struct**" — two hot fields on one cache line.
- "**Padding to a cache line**" — adding bytes to align hot fields apart.
- "**Cache-line bouncing**" — repeated cross-core invalidation of one line.
- "**RFO storm**" — many cores requesting Read-For-Ownership on the same line.
- "**LLC miss**" — a miss all the way down to last-level cache; usually means a coherence event or a true cold miss.
- "**Hot atomic**" — an atomic operation called from many goroutines concurrently; expensive.
- "**Per-P sharding**" — distributing state across one slot per processor (P) in the Go scheduler.
- "**MESI**" — the four-state coherence protocol; junior knowledge is "states exist."

If a reviewer says "this looks like false sharing," they mean: two fields you wrote are too close together. The fix is layout.

---

## Frequently Asked Questions

### Why doesn't Go's compiler pad automatically?

Because padding has costs (memory, allocator behaviour, cache footprint) that the compiler cannot weigh without knowing how the field will be used. Hot in one program, cold in another. The compiler stays conservative; you pad explicitly when you know.

### Why isn't there a `runtime.PadToCacheLine()` helper?

There is — `cpu.CacheLinePad` from `golang.org/x/sys/cpu`. It is just a `[N]byte` type. Direct padding with `_ [56]byte` is more common because it is more transparent.

### Does the Go GC move padded structs around?

The GC moves objects only when compacting (rare in modern Go; the current GC is non-moving for most allocations). Padding survives.

### Does `runtime.GC()` clear caches?

No. Caches are managed by hardware. The runtime can change which memory is allocated, but it cannot directly flush CPU caches.

### Is `runtime.LockOSThread` related?

Indirectly. It pins a goroutine to one OS thread, which the OS will tend to schedule on the same core (but is free to migrate). It does not pin to a core. For NUMA-aware code on Linux you would combine it with `sched_setaffinity` via cgo. For most code, ignore.

### How do I find the cache line size programmatically?

```go
import "golang.org/x/sys/cpu"
const cls = cpu.CacheLinePadSize
```

That is the package's best guess for your build target. On Apple silicon it is 128.

### Will `go vet` warn about false sharing?

No. False sharing is a layout problem, not a correctness problem. `go vet` is for correctness. Some third-party linters (like `fieldalignment`) detect alignment issues but do not flag false sharing per se.

### Are channels affected by false sharing?

Yes. The `hchan` struct internal to channels has counter fields that are touched by senders and receivers. Go's runtime is careful with this layout. You as a user generally do not need to think about it for channels.

### Are maps affected by false sharing?

Maps are not safe for concurrent writes anyway, so direct write contention is not the issue. But concurrent reads with one writer can experience false sharing on bucket data. `sync.Map` deliberately shards.

### Does `runtime.Gosched()` affect caching?

Indirectly. Yielding may move the goroutine to a different P, possibly a different OS thread, possibly a different core. Each migration is a cold start in the new cache. Frequent migrations are bad for cache locality.

### What about TLB?

The Translation Lookaside Buffer is a different cache, for virtual-to-physical address translation. Coherence on the TLB exists too, but it is rarely a user-visible bottleneck in Go because Go uses few page tables. Out of scope for junior.

### Does Linux's scheduler matter?

Yes. The OS can migrate threads between cores. Each migration is a cache restart. For predictable performance, pin threads to cores (advanced). Go does not expose CPU pinning natively; cgo or `golang.org/x/sys/unix` does.

### What about virtualisation?

VMs add another layer of scheduling. Coherence still works (hardware enforces it), but virtual cores may not map to physical cores 1:1. Benchmarks in VMs are noisier than on bare metal.

### Why is contention bad even when access patterns are "different"?

Because cache lines, not bytes, are the unit. "Different access patterns" on the same line is still contention.

### Does `atomic.Int64.Add` differ from `atomic.AddInt64`?

`atomic.Int64` (Go 1.19+) is a struct wrapper. The struct adds alignment annotations to guarantee 8-byte alignment on 32-bit ARM. Semantics are identical. Use the struct form for new code.

### Can I observe coherence in Go without `perf`?

Indirectly, by benchmarking and varying GOMAXPROCS. The strong signal is "throughput goes down with more cores." Direct observation needs hardware counters.

### Do unbuffered channels false-share?

Each channel allocation is its own object on the heap. Within one channel, the receive/send state may share a line. But two different channels usually live on separate cache lines.

### Is false sharing a security issue?

Generally no. But cache-state observation is a security issue (Spectre family). Padding does not fix Spectre; it just helps performance.

### How do I review code for false sharing?

Ask: is this struct mutated concurrently? Do multiple fields get touched from different goroutines? If yes, are they within 64 bytes? If yes, suspect false sharing. Recommend padding or sharding.

### How big is a typical padded struct in production code?

For a counter, ~64 bytes per counter slot. For a per-CPU sharded structure, ~64–256 bytes per CPU. On a 64-core box that is at most ~16 KB — trivial.

### Will padding break struct serialisation?

Yes, if you serialise the whole struct as bytes. Use field-by-field serialisation (gob, json, protobuf), which ignores unexported padding fields. The `_ [N]byte` fields are unexported and ignored by reflection-based encoders.

---

## A Final Visual Recap

```
Two cores, one shared cache line, three writes:

Time 0   Core A: WRITE x  (line in M on A, I on B)
Time 1   Core B: WRITE y  (snoop, M moves to B, A goes I; ~30ns lost)
Time 2   Core A: WRITE x  (snoop, M moves back to A, B goes I; ~30ns lost)

Same scenario with padding:

Time 0   Core A: WRITE x  (line[x] in M on A, never seen by B)
Time 1   Core B: WRITE y  (line[y] in M on B, never seen by A)
Time 2   Core A: WRITE x  (line[x] still in M on A; ~1ns)
```

```
The hierarchy of fixes:

   Worst → Best

   1. Many writers, one variable, no padding
   2. Many writers, multiple variables sharing one line
   3. Many writers, variables padded to separate lines
   4. Each writer to its own variable, padded
   5. Each writer to its own variable, in its own struct, far apart
```

```
Decision flow for a junior:

   Is this struct mutated by multiple goroutines?
      No  -> Move on. Coherence not your problem.
      Yes -> Are the mutated fields within 64 bytes?
                  No  -> Probably fine. Verify with a benchmark.
                  Yes -> Pad. Or shard. Re-benchmark with -cpu=4,8.
```

This flow plus the worked examples plus a habit of benchmarking with `-cpu` is the entire junior-level skill.

---

## Appendix: Long-Form Case Study — "Why Our Service Stopped Scaling Past 8 Cores"

This appendix walks through a realistic incident from start to finish. Names are changed; the structure is what happens in real teams.

### Context

A team runs a Go service that serves user search requests. Each request consults an in-memory inverted index, scores results, and returns the top-K. Throughput is roughly 30,000 requests per second per host. Latency is 5–8ms at the 99th percentile.

The team buys a new generation of hosts: 32-core CPUs instead of 16-core. They expect to double throughput per host, perhaps more. They roll the new hosts into production and watch.

Throughput rises from 30,000 to 38,000 RPS. CPU utilisation on the new hosts is **higher**, not lower, despite handling fewer requests per core. Latency at the 99th percentile climbs to 14ms.

Something is wrong.

### Profiling

The team takes a `pprof` CPU profile from a production host:

```
go tool pprof -http=:8080 http://host:6060/debug/pprof/profile?seconds=30
```

The top function by `flat` time is `runtime/internal/atomic.Xadd64`, eating 22% of CPU. The team is puzzled. They are not using atomics heavily — at least, not consciously.

`go tool pprof` shows the callers. Many roads lead to `metrics.(*Counter).Inc()`, an in-house metrics library used by every handler to bump per-route counters.

Now the team has a suspect. They look at the library:

```go
type Counter struct {
    value int64
    name  string
}

func (c *Counter) Inc() { atomic.AddInt64(&c.value, 1) }
```

`Counter` is 24 bytes (8 for value, 16 for the string header). Counters are allocated densely on the heap as part of a registry. Multiple counters land on the same cache line. Many handlers, each incrementing their own counter, end up contending on the line, not on the counter.

### Confirmation

The team runs a benchmark mimicking the production pattern: 32 goroutines, each on its "own" counter, all counters allocated back-to-back in a slice.

```
BenchmarkCounters-32   1000000   2400 ns/op
```

2400 nanoseconds per increment. That is 30× worse than a single-goroutine version. The team adds padding:

```go
type Counter struct {
    value int64
    name  string
    _     [40]byte
}
```

Now `Counter` is 64 bytes. Each counter fills exactly one cache line.

```
BenchmarkCounters-32   30000000    90 ns/op
```

27× improvement. The benchmark confirms the suspicion.

### Rollout

The team rolls a patched metrics library. Production throughput climbs from 38,000 RPS to 72,000 RPS. CPU utilisation drops by 35%. 99th-percentile latency falls to 6ms.

The change is sixteen bytes of padding per counter.

### Postmortem lessons

The team writes up the incident. Highlights:

1. **The bug was invisible at 16 cores.** With fewer cores, fewer goroutines contended, and the coherence cost was small enough to hide. The new 32-core hosts exposed it.
2. **The bug was in a library used by everyone.** A correctness-only review would have passed it. A scaling review with hardware counters would have caught it.
3. **The fix was sixteen bytes per counter.** Memory cost: negligible. Throughput cost without the fix: half the machine.
4. **The team adds CI benchmarks.** Now every metrics-library change runs a `-cpu=1,2,4,8,16,32` benchmark. Regressions surface before deploy.

This is the canonical false-sharing story. It happens to many teams. After it happens once, they treat it as a first-class concern. Before, they did not know to.

---

## Appendix: The Hardware Layer in More Depth

For a junior, hardware details are background. But seeing them once helps the rules feel less arbitrary.

### A modern x86 socket

A typical 16-core x86 server CPU looks like:

```
+--------------------------------------------------+
|                                                  |
|   Core 0 — Core 1 — Core 2 — Core 3              |
|     |       |       |       |                    |
|     L1d ┐  L1d ┐  L1d ┐  L1d ┐                   |
|     L1i ┤  L1i ┤  L1i ┤  L1i ┤                   |
|     L2  ┘  L2  ┘  L2  ┘  L2  ┘                   |
|     +-------+-------+-------+                    |
|             |                                    |
|        Shared L3 (32 MB)                         |
|             |                                    |
|        Memory Controller                         |
|             |                                    |
+-------------|------------------------------------+
              |
            DRAM
```

L1d is for data, L1i for instructions. Both are 32–64 KB per core. L2 is 256 KB – 1 MB per core. L3 is shared by all cores on the socket and is 8–64 MB. DRAM is shared across sockets via the memory controller and the inter-socket interconnect.

The coherence protocol runs on the **ring bus** or **mesh** that connects cores. Each core has a snoop interface; the bus carries invalidation and read-request messages.

### Coherence on a multi-socket box

```
Socket 0                          Socket 1
+-----------+                     +-----------+
| Cores 0-7 |                     | Cores 8-15|
|   L3 0    | <---- UPI link ---> |   L3 1    |
+-----------+                     +-----------+
     |                                 |
   DRAM 0                            DRAM 1
```

Two sockets are joined by a high-speed inter-socket interconnect (UPI on Intel, Infinity Fabric on AMD). A cache line owned by socket 0 that is requested by socket 1 must traverse the link. Latency goes from ~30 cycles (same socket) to ~200 cycles (cross socket).

On such machines, a single contended global counter is roughly an order of magnitude worse than on a single-socket box. This is one of the reasons that cloud providers price "many-socket" instances quite differently and recommend NUMA-aware deployments for shared-memory workloads.

For Go: most cloud Go services are on single-socket VMs, so cross-socket coherence rarely bites. But if you ever run on a bare-metal 2P or 4P box, you should pin your service to one socket if your data does not need to span.

### Apple silicon

Apple's M-series CPUs use clusters of cores: performance (P) and efficiency (E). Each cluster has its own L2 (the L1 is per-core as usual). Cache lines are 128 bytes. The interconnect between clusters is fast but not free.

For Go on M-series, double the padding constant and you are fine. The schedule of goroutines between P and E clusters is opaque; do not assume locality across clusters.

### ARM server CPUs

Modern ARM server CPUs (Ampere, AWS Graviton, etc.) use 64-byte lines and are similar to x86 in coherence cost orders of magnitude. ARM's weaker memory model (compared to x86) makes atomics slightly different at the instruction level, but the cache-coherence cost is the same family.

### What the Go runtime knows

The Go runtime does not query the hardware for cache line size. It uses constants set per architecture in `runtime/internal/sys`. These are conservative: 128 on Apple silicon, 64 on most others. User code that wants to be portable should use `cpu.CacheLinePadSize` or define its own constant from build tags.

---

## Appendix: A Glossary of Hardware Terms Junior Readers May See

| Term | Definition |
|------|-----------|
| **Snoop** | A message broadcast to other cores' caches asking about a particular cache line. |
| **RFO (Read-For-Ownership)** | A request that fetches a line in Modified state, suitable for writing. |
| **MOESI** | The five-state coherence protocol (M, O, E, S, I); AMD chips often use this. |
| **MESIF** | A variant with a Forward state; Intel uses this. |
| **Inclusive cache** | A cache where the contents of an outer level (e.g., L2) contain a superset of the inner level (L1). Simplifies snoop filtering. |
| **Exclusive cache** | A cache where each line is in exactly one level. AMD has historically preferred this. |
| **Snoop filter** | A hardware structure that records which cores hold a line, avoiding the need to broadcast snoops to every core. |
| **Directory** | A coherence implementation that keeps a central record of who holds each line. Used in many multi-socket systems. |
| **NUMA** | Non-Uniform Memory Access. Different memory regions have different latencies depending on which socket accesses them. |
| **Prefetcher** | A hardware unit that brings cache lines into the cache before the program asks for them. |
| **Write buffer** | Per-core queue for pending stores. |
| **Store-forwarding** | A core can read its own pending stores directly from the write buffer before they drain. |

You do not need to memorise these. You should recognise them when middle.md, senior.md, or a hardware article mentions them.

---

## Appendix: Reading the Reference

The reference goroutines section ends with a "What you can build" list. Following that style, here are concrete things a junior who has done the exercises can ship:

- A `Counter` package whose top-line struct is one cache line per counter.
- A request-stats sidecar that scales linearly to 32 cores without modification.
- A bench harness that detects false sharing in any struct via the `-cpu` sweep.
- A vet-style linter that flags `int64` fields next to `string` fields next to other `int64` fields without padding, marking them as candidates for review.
- A README for your own team explaining why the metrics library uses 64-byte padding.

The point is: this knowledge does not stop at "I read the section." It lives in code. Apply it.

---

## Appendix: Common Anti-Patterns Reviewed in Detail

### Anti-pattern A — "Wrap everything in atomic and call it concurrent"

Code:

```go
type Service struct {
    Requests int64
    Errors   int64
    Latency  int64
    cache    map[string]Value
    mu       sync.Mutex
}
```

Why bad: `Requests`, `Errors`, `Latency` are on the same line. The `mu` is on or near the same line. Every request mutates all three counters and grabs the mutex. Four invalidations per request.

Fix:

```go
type Service struct {
    Requests int64
    _        [56]byte
    Errors   int64
    _        [56]byte
    Latency  int64
    _        [56]byte
    cache    map[string]Value
    mu       sync.Mutex
    _        [56]byte
}
```

### Anti-pattern B — "Slice of small structs for lock-free queue"

Code:

```go
type SPSCQueue struct {
    slots []slot
    head  uint64
    tail  uint64
}

type slot struct {
    seq  uint64
    data interface{}
}
```

Why bad: `head` and `tail` share a line. Adjacent `slot` entries share a line. The producer and consumer fight on every operation.

Fix: pad `head` and `tail`; pad each slot to 64 bytes; consider a power-of-two size for fast modulo.

### Anti-pattern C — "Many small mutexes packed into one struct"

Code:

```go
type Locks struct {
    mu1, mu2, mu3, mu4, mu5, mu6, mu7, mu8 sync.Mutex
}
```

Why bad: 8 mutexes × 8 bytes = 64 bytes. All eight on one line. Locking any one invalidates the line for the other seven.

Fix: pad each mutex to its own line, or rethink whether you really need eight mutexes.

### Anti-pattern D — "Use a map for counters keyed by goroutine ID"

Code:

```go
var counters = make(map[uint64]int64)
var mu sync.Mutex

func bump(id uint64) {
    mu.Lock()
    counters[id]++
    mu.Unlock()
}
```

Why bad: `sync.Mutex` is a global contention point. Even if the map is huge, the lock serialises all updates.

Fix: shard the map, or use per-P counters (`sync.Pool`-style) and merge.

### Anti-pattern E — "Atomic flag inside a hot struct"

Code:

```go
type Job struct {
    done atomic.Bool
    // ... 200 bytes of frequently-read fields ...
}
```

Why bad: every read of the hot fields shares the line with `done`. Setting `done` invalidates the line for everyone reading the job.

Fix: move `done` to its own padded slot or to a separate struct.

### Anti-pattern F — "Cleanup goroutine reading a counter every microsecond"

Code:

```go
go func() {
    for {
        n := atomic.LoadInt64(&counter)
        if n > threshold { handle() }
    }
}()
```

Why bad: each load forces the line into Shared state, downgrading every writer's Modified copy. The writers must re-acquire Modified on every increment. Throughput on the writers tanks.

Fix: sample less often (every 10ms instead of every microsecond), or use a snapshot-on-tick pattern.

These six anti-patterns cover the bulk of real cases. Internalise them.

---

## Appendix: A Mental Drill for Reviews

When reviewing a PR that touches shared state, run through this checklist:

1. **Which fields are written concurrently?**
2. **Are any of them within 64 bytes of each other?**
3. **Are any of them within 64 bytes of an unrelated frequently-read field?**
4. **Is the surrounding struct laid out so that allocator behaviour predictably places adjacent objects on adjacent lines?**
5. **Is there a benchmark with `-cpu=1,2,4,8` to back any performance claim?**

A "no" to any of 1–4 is fine. A "yes" plus a "missing benchmark" is a comment to leave on the PR.

---

## Appendix: Working with `go test -bench` Productively

A junior who learns to drive `go test -bench` well will out-engineer many seniors who do not. Useful flags:

| Flag | Effect |
|------|--------|
| `-bench=.` | Run all benchmarks. |
| `-bench=BenchmarkFoo` | Run only matching benchmark. |
| `-benchtime=3s` | Run each benchmark for 3 seconds (or `100x` for 100 iterations). |
| `-cpu=1,2,4,8` | Repeat each benchmark with each `GOMAXPROCS` value. |
| `-benchmem` | Print allocations per op. |
| `-count=10` | Run each benchmark 10 times for statistical confidence. |
| `-cpuprofile=cpu.prof` | Write a CPU profile. |
| `-memprofile=mem.prof` | Write a heap profile. |

Combine with `benchstat`:

```
go test -bench=. -count=10 -benchtime=3s -cpu=4 > old.txt
# make changes
go test -bench=. -count=10 -benchtime=3s -cpu=4 > new.txt
benchstat old.txt new.txt
```

`benchstat` reports `delta` with confidence intervals. A 3× improvement with p < 0.01 is a real win. A 1.05× improvement with p > 0.1 is noise.

For false sharing specifically, the `-cpu` sweep is the highest-signal flag. If your benchmark shows similar ns/op at `-cpu=1` and at `-cpu=8` for a parallel test, your code is bottlenecked on something — often coherence.

---

## Appendix: A Final Set of Twenty Drilled Questions

Test yourself. Answer each in a sentence.

1. What is a cache line?
2. What is the cache line size on x86?
3. What is the cache line size on Apple silicon?
4. What does false sharing mean?
5. How do you fix false sharing?
6. Why are atomic operations expensive under contention?
7. What is the difference between `pprof` and `perf`?
8. Why does padding sometimes not help?
9. When does coherence cost cross sockets vs. stay on socket?
10. What does `golang.org/x/sys/cpu.CacheLinePad` provide?
11. Why does `sync.Mutex` benefit from padding in a slice of mutexes?
12. What is a per-CPU sharded counter?
13. Why is a per-goroutine local accumulator usually better than padding?
14. What `perf` counter best indicates coherence pressure?
15. Why is `runtime.LockOSThread` not sufficient for cache locality?
16. How does the Go GC interact with padding? (Hint: it does not.)
17. What does Modified state mean for a cache line?
18. What does Shared state mean for a cache line?
19. Why is `atomic.LoadInt64` cheaper than `atomic.AddInt64`?
20. What is a Read-For-Ownership and when is it issued?

If you can answer each, you have the junior level. If any feels shaky, re-read the relevant section. The middle.md file expects this foundation.

---

## End of File

You now have the foundation. The next file, `middle.md`, takes the MESI state machine apart and explains exactly what happens at the hardware level for each Go operation. Read it when you are ready to think in terms of state transitions.

---

## Appendix: Long-Form Discussion of Padding Costs and Trade-offs

Padding works. Padding is also not free. A thoughtful junior should know both sides.

The cost of one padded 8-byte field is 56 bytes per instance. If you have 10,000 counters, that is 560 KB of overhead — small. If you have 10 million counters, that is 560 MB — large. The vast majority of services are in the first regime and padding is essentially free. A few — analytics platforms, time-series stores, very wide histograms — are in the second and must choose carefully.

There are three forms of cost to weigh:

1. **Memory.** Direct waste. Easy to compute.
2. **Cache footprint.** A padded structure takes more cache lines. Iterating over a padded array of counters means more lines pulled into L1, possibly evicting other useful lines. This is a subtle cost that benchmarks can reveal.
3. **Allocator behaviour.** Larger structs land in different size classes in Go's allocator. This can be either a win or a loss depending on the rest of the program's allocation pattern.

In practice, the way to manage these is:

- Pad only the fields that are demonstrably contended.
- For arrays of contended elements (workers, histograms, per-CPU counters), pad each element to exactly one line (64 bytes on x86).
- For the very rare case of millions of counters, prefer sharding to padding — give one counter per CPU and merge, instead of one counter per logical entity.
- For very wide structures with mixed hot/cold fields, group the cold fields together and let them share lines; pad each hot field individually.

A simple rule: if your struct has more than one hot field, pad between them. If your slice of structs has one hot field each, pad the struct to a line. Otherwise, do nothing.

---

## Appendix: Long-Form Discussion of Sharding vs Padding

Sharding (splitting one shared value into N independent slots) and padding (isolating fields on separate cache lines) often look interchangeable. They are not.

**Padding** addresses the problem at the **layout** level. It does not change the *number* of writes to a given memory location; it just makes adjacent fields' writes independent.

**Sharding** addresses the problem at the **algorithmic** level. It reduces the *number* of writes per location by splitting the work across many locations. Each location then sees less contention even if it is not padded.

A useful matrix:

|                                  | Adjacent fields write to same line? | Same field hot across many cores? |
|----------------------------------|-------------------------------------|-----------------------------------|
| **Padding helps**                | Yes                                 | No                                |
| **Sharding helps**               | No                                  | Yes                               |
| **Both help, combined**          | Yes                                 | Yes                               |

In real services, both situations co-occur. A per-route counter is hot per route (many cores writing the same field) and also packed with other counters on the same line. The fix is both: shard the counter per CPU **and** pad each shard.

---

## Appendix: How Cache Coherence Interacts With the Go Garbage Collector

The Go GC is a tri-colour concurrent mark-and-sweep collector. It walks the heap, marking live objects, and reclaims unmarked ones in a separate sweep phase. Two interactions matter for junior coherence knowledge:

### 1. The write barrier touches every pointer write

When the GC is in the mark phase, every pointer write goes through a write barrier — a small bit of runtime code that records the write so the collector can keep its view of liveness consistent. The write barrier reads and writes runtime metadata. That metadata lives in known locations and is itself subject to coherence.

For ordinary user code, this is invisible. For very pointer-heavy hot loops during GC, you may see a slowdown that is partly due to write barriers and their cache traffic.

### 2. GC pacing and CPU usage

The GC tries to use ~25% of CPU during marking. If your service is CPU-bound on a coherence problem, the GC will appear to slow down — not because the GC is slow, but because every CPU cycle is precious and the GC's share looks larger relatively. Fixing the coherence problem typically also makes GC pause times look better in profiles.

### 3. Padding survives GC

The GC does not collapse `_ [56]byte` padding. The bytes are part of the struct and stay where you put them. You can rely on padding for the lifetime of the struct.

---

## Appendix: A Discussion of `atomic.Int64` vs `int64`

Go 1.19 introduced typed atomics: `atomic.Int64`, `atomic.Uint64`, `atomic.Pointer[T]`, etc. The advantages over raw `int64` plus `atomic.AddInt64`:

1. **Alignment is guaranteed.** On 32-bit ARM, raw `int64` fields may not be 8-byte aligned within an arbitrary struct, and atomic ops require 8-byte alignment. The typed `atomic.Int64` is a struct that the compiler aligns correctly.
2. **You cannot accidentally do a non-atomic read.** You must call `.Load()`, `.Store()`, `.Add()`. A bare `x.value++` does not compile.
3. **The type is self-documenting.** Reading `var counter atomic.Int64` makes the intent clear.

The cache-coherence behaviour is identical. `atomic.Int64.Add(1)` and `atomic.AddInt64(&x, 1)` compile to the same machine code (`LOCK XADD` on x86). Padding considerations are the same.

For new code, prefer the typed atomics. They are safer with no runtime cost.

---

## Appendix: A Discussion of the `runtime.NumCPU()` Pattern

A common pattern for per-CPU sharding:

```go
var slots = make([]paddedCounter, runtime.NumCPU())
```

This is *roughly* right but has subtle issues:

- `runtime.NumCPU()` returns the number of logical CPUs (including hyperthreads), not the number of cores. Hyperthreads share a cache. Two goroutines on the same physical core do not false-share.
- `GOMAXPROCS` may differ from `NumCPU()`. Goroutines run on Ps, not CPUs. There are at most `GOMAXPROCS` Ps active.
- There is no API to ask "which CPU is this goroutine running on" cheaply. Go's runtime does not expose it.

In practice, per-P sharding (one slot per `GOMAXPROCS`) is what you want, indexed by the runtime's P identifier. The Go runtime has internal access to this via `runtime/internal/sys/getcpu`. Most user code approximates by hashing the goroutine ID or by using a random seed once per goroutine.

For a junior, the take-away: shard to `runtime.NumCPU()`-many slots and pick a slot via a fast hash. It is not perfect, but the contention reduction is roughly N-fold.

---

## Appendix: A Discussion of `sync.Pool` and Coherence

`sync.Pool` is a per-P pool of reusable objects. Its design is heavily informed by cache coherence:

- Each P has its own local pool. No coherence traffic for normal puts and gets.
- If the local pool is empty, the goroutine steals from another P. That stealing is a cross-core operation and does cause coherence traffic, but it is rare.
- The runtime periodically drains pools to keep them from growing without bound. The draining is a single coherence event per P, not per object.

`sync.Pool` is one of the cleanest examples of a per-P shape in the standard library. Read its source (`src/sync/pool.go`) to see how the layout is structured. The `poolLocal` type is explicitly padded; the comment says so.

User code does not need to know the internals to use `sync.Pool`, but knowing they exist explains *why* `sync.Pool` is so much faster than a single shared free list with a mutex.

---

## Appendix: A Tiny Reference Implementation of a Cache-Friendly Counter

Putting it all together — here is a complete, working, cache-friendly counter that scales linearly:

```go
package fastcounter

import (
    "runtime"
    "sync/atomic"
)

const cacheLine = 64

type slot struct {
    v atomic.Int64
    _ [cacheLine - 8]byte
}

type Counter struct {
    slots []slot
}

func New() *Counter {
    return &Counter{slots: make([]slot, runtime.NumCPU())}
}

// Inc adds one. The caller passes a hint (e.g. a request ID) to pick a slot.
func (c *Counter) Inc(hint uint64) {
    c.slots[hint%uint64(len(c.slots))].v.Add(1)
}

// Sum returns the current total. It is approximate under load
// (reads are non-atomic with concurrent writes) but eventually accurate.
func (c *Counter) Sum() int64 {
    var total int64
    for i := range c.slots {
        total += c.slots[i].v.Load()
    }
    return total
}
```

Properties:

- Each slot is exactly 64 bytes; pad keeps adjacent slots on separate lines.
- `Inc` does one atomic op per call, on a chosen slot, with no contention if the hint is well-distributed.
- `Sum` is O(N) in the number of slots, fine for occasional metrics export.
- The whole counter is ~64 × NumCPU() bytes. On a 16-core box, ~1 KB.

This is the kind of structure a senior Go engineer would reach for almost reflexively. After this junior file you have the vocabulary and the worked benchmarks to implement, test, and defend such a design.

---

## Appendix: Recap as Q&A

**Q: Why does my parallel program scale sublinearly?**
A: Cache coherence: writes to shared lines force cross-core invalidations.

**Q: What is the unit of sharing in hardware?**
A: A 64-byte cache line (128 on Apple silicon).

**Q: What is false sharing?**
A: Two logically independent variables on the same cache line, both written from different cores, paying the coherence cost without sharing data semantically.

**Q: How do I fix it?**
A: Pad with `_ [56]byte` (or `cpu.CacheLinePad`), or shard the variable per CPU.

**Q: Are atomic operations free?**
A: No. They pay the same coherence cost as a contended write, often plus a memory fence.

**Q: How do I detect it?**
A: Benchmark with `-cpu=1,2,4,8`. Sublinear scaling is the symptom. Use `perf stat` on Linux for the underlying counter signal.

**Q: Does padding hurt performance ever?**
A: Yes, if applied to cold structs in large arrays, the increased cache footprint can hurt. Pad only what is demonstrably hot.

**Q: Does Go's compiler do this automatically?**
A: No. You pad by hand.

**Q: Where in the standard library can I see this pattern?**
A: `sync.Pool`, `sync/atomic`, `runtime` internals — search for `pad` in those packages.

**Q: What is the very first thing I should do when I see scaling collapse?**
A: Run `go test -bench=. -cpu=1,2,4,8`. If padding the suspect struct fixes it, you have your answer.

---

## Appendix: Closing Mantra

> *Cache lines are the unit of sharing. Writes contend. Pad and shard.*

Recite it. It will save you days of profiling.

---

## Appendix: Extended Benchmark Recipes

The benchmarks shown earlier are minimal. Real, defensible measurements need a few additions. Here are recipes you can copy.

### Recipe 1 — Multi-CPU sweep with timestamping

```go
package falseshare

import (
    "sync"
    "sync/atomic"
    "testing"
    "time"
)

const ops = 1_000_000

type Pair struct {
    A, B int64
}

type Padded struct {
    A int64
    _ [56]byte
    B int64
    _ [56]byte
}

func parallelTwo(b *testing.B, addA, addB func()) {
    for i := 0; i < b.N; i++ {
        var wg sync.WaitGroup
        start := time.Now()
        wg.Add(2)
        go func() { defer wg.Done(); for j := 0; j < ops; j++ { addA() } }()
        go func() { defer wg.Done(); for j := 0; j < ops; j++ { addB() } }()
        wg.Wait()
        b.ReportMetric(float64(time.Since(start).Nanoseconds())/(2*ops), "ns/op-real")
    }
}

func BenchmarkPair(b *testing.B) {
    var p Pair
    parallelTwo(b,
        func() { atomic.AddInt64(&p.A, 1) },
        func() { atomic.AddInt64(&p.B, 1) },
    )
}

func BenchmarkPadded(b *testing.B) {
    var p Padded
    parallelTwo(b,
        func() { atomic.AddInt64(&p.A, 1) },
        func() { atomic.AddInt64(&p.B, 1) },
    )
}
```

Run:

```
go test -bench=. -count=10 -benchtime=3s -cpu=2,4,8
```

The custom metric `ns/op-real` reports the real time per increment as observed externally, which is the right unit when you want to talk about scaling.

### Recipe 2 — Sweep padding amount

To find the cache line size empirically, sweep the pad width:

```go
package falseshare

import (
    "sync"
    "sync/atomic"
    "testing"
)

func runWithPad(b *testing.B, pad int) {
    // build a struct of two int64s separated by `pad` bytes,
    // using a slice of bytes as a backing store.
    buf := make([]byte, 8 + pad + 8)
    a := (*int64)(unsafe.Pointer(&buf[0]))
    bb := (*int64)(unsafe.Pointer(&buf[8+pad]))
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        var wg sync.WaitGroup
        wg.Add(2)
        go func() { defer wg.Done(); for j := 0; j < 1_000_000; j++ { atomic.AddInt64(a, 1) } }()
        go func() { defer wg.Done(); for j := 0; j < 1_000_000; j++ { atomic.AddInt64(bb, 1) } }()
        wg.Wait()
    }
}

func BenchmarkPad0(b *testing.B)   { runWithPad(b, 0) }
func BenchmarkPad8(b *testing.B)   { runWithPad(b, 8) }
func BenchmarkPad16(b *testing.B)  { runWithPad(b, 16) }
func BenchmarkPad32(b *testing.B)  { runWithPad(b, 32) }
func BenchmarkPad48(b *testing.B)  { runWithPad(b, 48) }
func BenchmarkPad56(b *testing.B)  { runWithPad(b, 56) }
func BenchmarkPad60(b *testing.B)  { runWithPad(b, 60) }
func BenchmarkPad64(b *testing.B)  { runWithPad(b, 64) }
func BenchmarkPad72(b *testing.B)  { runWithPad(b, 72) }
func BenchmarkPad128(b *testing.B) { runWithPad(b, 128) }
```

(Add `import "unsafe"` at the top.) On a 64-byte-line machine, you will see a clear step between Pad56 and Pad64 — when the two int64s land on different lines. On a 128-byte-line machine the step is between Pad120 and Pad128.

### Recipe 3 — Atomic vs non-atomic single core

To prove that atomics are not free even with no contention:

```go
func BenchmarkPlainAddSingle(b *testing.B) {
    var x int64
    for i := 0; i < b.N; i++ {
        x++
    }
    _ = x
}

func BenchmarkAtomicAddSingle(b *testing.B) {
    var x int64
    for i := 0; i < b.N; i++ {
        atomic.AddInt64(&x, 1)
    }
}
```

Plain increment is around 0.3 ns/op (CPU can pipeline). Atomic is around 6 ns/op (LOCK prefix forces a flush). 20× ratio in the trivial case.

### Recipe 4 — Snapshot consistency under load

Sometimes the question is not "fast" but "correct under contention." A snapshot-of-many-counters routine:

```go
func TestSnapshotConsistency(t *testing.T) {
    type Pair struct {
        A, B int64
    }
    var p Pair
    var stop atomic.Bool
    var wg sync.WaitGroup
    wg.Add(2)
    go func() {
        defer wg.Done()
        for !stop.Load() {
            atomic.AddInt64(&p.A, 1)
            atomic.AddInt64(&p.B, 1)
        }
    }()
    go func() {
        defer wg.Done()
        for !stop.Load() {
            a := atomic.LoadInt64(&p.A)
            b := atomic.LoadInt64(&p.B)
            if a-b > 1 || b-a > 1 {
                // expected: A may briefly differ from B by at most 1
            }
        }
    }()
    time.Sleep(100 * time.Millisecond)
    stop.Store(true)
    wg.Wait()
}
```

This shows what an "atomic but not consistent" snapshot looks like — and explains why some metrics libraries use single-store snapshots instead of multi-field reads.

---

## Appendix: Connection to the Go Memory Model

This file deliberately focuses on **performance**, not **correctness**. The Go memory model is the topic of `02-acquire-release` and `03-sequential-consistency`. But there is an intimate relationship.

Every atomic operation in Go has two facets:

1. **Atomicity:** the read or write is indivisible.
2. **Ordering:** the operation establishes a happens-before edge.

The hardware enforces both via the same coherence machinery. A `LOCK XADD` is atomic *because* the cache line is held in Modified state during the operation; no other core can read or write it. It is ordered *because* the LOCK prefix is a fence — it flushes the store buffer.

For coherence performance reasoning, you can think of every atomic as a "Modified-state acquisition" plus a "fence." Both cost. Padding reduces the Modified-state acquisition cost; nothing reduces the fence cost except using fewer atomics.

This is why per-goroutine accumulators are usually faster than padded atomic counters: they eliminate atomics entirely from the hot loop. The fence cost goes to zero. Only the final merge pays it.

---

## Appendix: When Padding Is Not Enough

Padding fixes false sharing. It does not fix true sharing. If every core wants to write to the same byte, padding does nothing.

Two scenarios where padding does not help:

1. **Reference counter on a shared resource.** Many goroutines acquire/release the same resource. The refcount line bounces. Padding the line only helps if neighbours were sharing with it, which is usually not the case once the resource is a standalone allocation. The fix is biased counting or per-thread sub-counts.

2. **Global feature flag.** One write per minute, but every request reads it. Reads are cheap (Shared state); the rare write briefly invalidates. Padding helps only if the line also holds frequently-written data.

In these cases, the answer is algorithmic: change *who* writes, not *where* they write.

---

## Appendix: One More Visual

```
The complete picture: cores, cache line, and the protocols they speak

       +---------------------------------------+
       |             Coherence Fabric          |
       |   (carries snoops and invalidations)  |
       +--+-----+-----+-----+-----+------------+
          |     |     |     |     |
       Core0 Core1 Core2 Core3 Core4 ...
          |     |     |     |     |
        L1d   L1d   L1d   L1d   L1d
          |     |     |     |     |
        L2    L2    L2    L2    L2
          |     |     |     |     |
       +--+-----+-----+-----+-----+------------+
       |              Shared L3                |
       +-------------------+-------------------+
                           |
                         DRAM

   A write on Core 0 to a contended line:

   1. Core 0 stores into write buffer.
   2. Core 0 sends RFO via fabric.
   3. Fabric routes to all other cores holding the line.
   4. Each core snoops, downgrades to Invalid, ACKs.
   5. Core 0 receives the line in Modified state.
   6. Write buffer drains into L1.

   Steps 2–5 are the coherence cost. They scale with the number of cores
   holding the line; they grow under socket boundaries.

   Padding eliminates the case where this happens for unrelated fields.
   Sharding eliminates the case where this happens for related fields.
```

---

## Appendix: A Final Self-Test

Without re-reading the file, try to write down:

1. The cache line size on your machine.
2. The cost difference between an L1 hit and a DRAM access.
3. One Go struct from your real codebase that you suspect of false sharing.
4. The exact byte pattern (`_ [N]byte`) you would add to fix it.
5. The benchmark command you would run to confirm.

If you have all five, you have internalised the junior level. Go and write the benchmark.

---

## End of Appendices

The file is intentionally long. It is the reference junior engineers come back to when they encounter a scaling problem for the first time. Skim it now, run the benchmarks, and return when production teaches you why each section matters.

---

## Appendix: Glossary, Second Pass — Expanded Definitions

For the terms introduced earlier, here are fuller definitions with examples.

### Cache line — expanded

The cache line is the smallest unit the cache hardware reads from or writes to memory. On x86-64, ARM cortex-A series, and ARM server cores, it is 64 bytes. On Apple's M1/M2/M3 performance cores it is 128 bytes. The line is aligned to its size: a 64-byte line always starts at an address divisible by 64.

When you load an `int32` at address `0x1234`, the hardware does *not* fetch four bytes. It fetches the 64-byte block starting at `0x1200` (the largest multiple of 64 less than or equal to `0x1234`). That block goes into your L1 cache. Subsequent loads from `0x1200`–`0x123F` hit the cache.

The line is the unit of *transfer*, the unit of *eviction*, and crucially the unit of *coherence*. Two variables on the same line are coherence-coupled even if they are logically independent.

### MESI — expanded

MESI names the four states a cache line can be in, in any given core's cache, under one of the standard coherence protocols:

- **M (Modified):** This core has the only valid copy, and it differs from main memory. Reading and writing are local and fast. The core is responsible for writing the line back to memory if it evicts.
- **E (Exclusive):** This core has the only valid copy, and it matches main memory. Reading is local and fast. Writing transitions to Modified silently — no message needed, because no one else has a copy.
- **S (Shared):** This core has a copy, but other cores may have copies too. All copies match main memory. Reading is local and fast. Writing requires sending invalidations to all other holders before transitioning to Modified.
- **I (Invalid):** This core has no usable copy. Reading or writing requires fetching the line.

The state machine has well-defined transitions, but junior knowledge is just: M is fast and exclusive, S is fast for reads but requires invalidation for writes, I means miss.

### Store buffer — expanded

Between the core's execution unit and L1 sits the **store buffer**. Stores enter the store buffer immediately on retirement. They drain into L1 in order, but not necessarily promptly.

The store buffer enables out-of-order execution: a core can finish a load that depends on a store before the store has reached L1. Internally, the core checks the store buffer first ("store forwarding") and only goes to L1 if the address is not pending.

For coherence, the store buffer is important because **stores are not globally visible until they drain**. A `LOCK`-prefixed instruction on x86 flushes the store buffer before completing, ensuring the store is globally visible. This is why atomic operations include a fence.

### Read-For-Ownership (RFO) — expanded

When a core wants to write to a line it does not currently hold in M or E state, it issues an RFO to the coherence fabric. The RFO says "I want this line, in M state." The fabric finds the current holder(s), invalidates them, and gives the line to the requester.

An RFO is more expensive than a plain read because it requires invalidations. Bursty RFOs from many cores are called an "RFO storm" and indicate severe contention.

### Snoop — expanded

A snoop is a message sent from the coherence fabric to a core's cache asking it to look up the state of a particular cache line. The core may respond with the line's data (if Modified), or with an acknowledgement of invalidation. Snoops cost cycles even when they hit nothing — the cache must check.

### Write-back vs write-through — expanded

- **Write-back caches** delay propagating modifications to main memory until the line is evicted. Modern x86 and ARM CPUs use write-back caches.
- **Write-through caches** propagate every store to the next level. Rare in modern CPUs.

Write-back is more efficient but requires the coherence protocol to track which cores have dirty lines.

---

## Appendix: Pointing to Where the Real Work Begins

Junior knowledge is foundation. Middle and senior knowledge is where you start affecting the design of systems. After this file, your homework is to:

1. Pick a service you work on. Identify three structs that are mutated concurrently.
2. Benchmark each in isolation with `-cpu=1,2,4,8`. Find the one whose throughput collapses.
3. Add padding. Re-benchmark. Quantify the win.
4. Open a PR. Defend the change with the numbers.

That cycle is the engine. Run it once and you graduate to middle.

---

## Appendix: Twenty-Five More Practice Snippets

To pad your repertoire with one more sweep of concrete code, here are twenty-five short snippets that show layout patterns side by side. They are not all "correct" or "incorrect" — they are choices, and the comment after each says what choice was made.

### Snippet 1
```go
type S struct { a, b int64 } // packed; bad for concurrent writes to a and b
```

### Snippet 2
```go
type S struct { a int64; _ [56]byte; b int64; _ [56]byte } // padded
```

### Snippet 3
```go
type S struct { a int64; pad [56]byte; b int64; pad2 [56]byte } // named pad fields — exposed, can be checked
```

### Snippet 4
```go
type S struct { a int64; _ cpu.CacheLinePad; b int64; _ cpu.CacheLinePad } // portable
```

### Snippet 5
```go
//go:align 64
var counter int64 // aligned but unpadded; next allocation may share line
```

### Snippet 6
```go
type Counter struct { v atomic.Int64; _ [56]byte } // padded typed atomic
```

### Snippet 7
```go
type Shard [16]struct{ v atomic.Int64; _ [56]byte } // padded slice of counters
```

### Snippet 8
```go
type Resource struct { mu sync.Mutex; _ [56]byte } // pad after mutex
```

### Snippet 9
```go
type Ring struct {
    head atomic.Uint64; _ [56]byte
    tail atomic.Uint64; _ [56]byte
    buf  [1024]item
}
```

### Snippet 10
```go
type Job struct { done atomic.Bool } // hot flag; needs padding in a struct with other hot fields
```

### Snippet 11
```go
type Reader struct {
    seen   atomic.Uint64
    _      [56]byte
    cached atomic.Uint64
}
```

### Snippet 12
```go
type WorkerStats struct {
    JobsDone   int64
    _          [56]byte
    BytesRead  int64
    _          [56]byte
}
```

### Snippet 13
```go
type Histogram struct {
    Buckets [16]int64 // 128 bytes; spans two lines but only one writer
}
```

### Snippet 14
```go
type PerCPUHistogram struct {
    perCPU [8]struct {
        Buckets [16]int64
        _       [128]byte // pad to 256 bytes
    }
}
```

### Snippet 15
```go
type LruEntry struct {
    key   string
    value any
    next  *LruEntry
    prev  *LruEntry // pointers move under writes; consider padding if shared
}
```

### Snippet 16
```go
type Limiter struct {
    tokens atomic.Int64
    _      [56]byte
    lastFill atomic.Int64
    _        [56]byte
}
```

### Snippet 17
```go
type CountMin struct {
    rows [4][1024]atomic.Uint32 // 16KB per row; rows naturally on different pages
}
```

### Snippet 18
```go
type Spinlock struct { state atomic.Uint32 } // contended spinlocks need padding
```

### Snippet 19
```go
type PaddedSpinlock struct { state atomic.Uint32; _ [60]byte }
```

### Snippet 20
```go
type ScheduledTask struct {
    runAt int64
    _     [56]byte
    state atomic.Int32
    _     [60]byte
    fn    func()
}
```

### Snippet 21
```go
type Counter32 struct { v atomic.Int32; _ [60]byte } // 32-bit padded
```

### Snippet 22
```go
type SuperHot struct {
    a, b, c, d, e, f, g, h int64 // 64 bytes packed; nightmare under contention
}
```

### Snippet 23
```go
type Fixed struct {
    a int64; _ [56]byte
    b int64; _ [56]byte
    c int64; _ [56]byte
    d int64; _ [56]byte
    e int64; _ [56]byte
    f int64; _ [56]byte
    g int64; _ [56]byte
    h int64; _ [56]byte
}
```

### Snippet 24
```go
type Wrapper struct {
    cold ColdData     // rarely touched
    _    [64]byte     // explicit boundary
    hot  HotData      // concurrently mutated
    _    [64]byte
}
```

### Snippet 25
```go
type Slot[T any] struct {
    v T
    _ [64 - unsafe.Sizeof(*new(T))%64]byte // padding math
}
```

These twenty-five snippets cover the bulk of patterns you will read in real Go code. Recognise them, copy them, adapt them.

---

## True End

This is the end of the junior file. Run the benchmarks. Open a real codebase. Apply a fix. Then come back for middle.


