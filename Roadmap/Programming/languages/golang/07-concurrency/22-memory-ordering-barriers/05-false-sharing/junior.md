---
layout: default
title: False Sharing — Junior
parent: False Sharing
grand_parent: Memory Ordering Barriers
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/22-memory-ordering-barriers/05-false-sharing/junior/
---

# False Sharing — Junior Level

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
> Focus: "Why does my parallel counter program become *slower* when I add more goroutines? Why does adding seven bytes of unused padding triple the throughput?"

**False sharing** is one of the most counterintuitive performance bugs in concurrent programming. It happens when two CPU cores update two *different* variables, but those two variables happen to sit next to each other in memory — close enough that the hardware treats them as the same unit of cache. Even though the goroutines do not share any logical state, the hardware *thinks* they do, and pays the full cost of synchronisation on every single write.

Two practical demonstrations make this concrete:

1. You have an array `var counters [8]int64`. Eight goroutines each increment their own counter — `counters[id]++` — in a tight loop. You expect linear scaling: eight cores, eight independent slots, eight times the throughput. You measure: it is *slower* than a single goroutine doing all eight increments serially.

2. You change the array to `var counters [8]struct{ v int64; _ [56]byte }` — adding 56 wasted bytes after each `int64`. You re-run the benchmark. Throughput jumps eight times. You did not change the algorithm; you only changed the spacing.

After reading this file you will:

- Understand what a CPU cache line is and why 64 bytes is the magic number on almost every modern x86 and ARM CPU.
- Know what false sharing is and what it is not (it is not data sharing, it is not a race condition).
- Be able to recognise the simplest false-sharing pattern (counters in an array).
- Know the simplest fix: cache-line padding.
- Write a tiny benchmark that demonstrates the problem and the fix.
- Understand why Go's standard library pads `sync.Mutex`, `sync.Pool.local`, and scheduler structures.
- Know the name `runtime/internal/sys.CacheLinePad` and what it is for.

You do **not** need to know the MESI protocol, perf c2c, NUMA, or how to read assembly yet. This file is about seeing the bug once, fixing it once, and forming an intuition for "if two goroutines write to two variables, those variables must live on different cache lines."

---

## Prerequisites

- **Required:** A working Go installation, version 1.21 or newer. Check with `go version`.
- **Required:** Comfort writing a goroutine and using `sync.WaitGroup`. If `go func() { defer wg.Done(); ... }()` is familiar, you are ready.
- **Required:** Familiarity with `sync/atomic` for at least `atomic.AddInt64`. We will use it as the "fastest possible per-thread increment" baseline.
- **Required:** Ability to run `go test -bench .` and read its output. The whole file is shaped around microbenchmarks.
- **Helpful:** A computer with at least 4 physical cores. You can still see false sharing on 2 cores, but the gap is smaller and noisier. Eight cores is the sweet spot for demonstrations.
- **Helpful:** Some intuition that modern CPUs have caches. You do *not* need to know what L1, L2, L3 are yet.
- **Helpful:** Running on Linux. The screenshots use `perf stat`. On macOS you can use `Instruments`; on Windows you can use VTune. The Go benchmarks themselves run anywhere.

If you can write a `BenchmarkXxx` function and run it with `-cpu=1,8`, you have enough background.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Cache line** | The unit of data the CPU moves between memory and its caches. 64 bytes on almost every modern x86-64 and most ARM64 chips. The CPU does not load one byte at a time; it loads 64 bytes at a time. |
| **Cache** | A small, fast memory close to the CPU core that holds recently-used data. Levels L1 (smallest, fastest, per-core), L2 (per-core, larger), L3 (shared across cores, largest). |
| **False sharing** | When two cores write to two *different* variables that happen to live on the same cache line, causing the line to bounce between cores' caches. The "false" in the name: the *cache* thinks the data is shared, but the *program* knows it is not. |
| **True sharing** | When two cores write to the *same* variable. This is logically required to bounce the line; only true sharing has algorithmic meaning. False sharing has none. |
| **Cache-line padding** | Inserting unused bytes after a variable so that no neighbouring variable shares its cache line. The classic Go form: `struct { v int64; _ [56]byte }`. |
| **`runtime/internal/sys.CacheLinePad`** | A struct type defined inside the Go runtime as `[CacheLineSize]byte`. Used internally to pad runtime structures. `CacheLineSize` is 64 on x86-64 and ARM64, 128 on ppc64. |
| **MESI** | The four-state cache-coherence protocol used by x86 CPUs: *Modified, Exclusive, Shared, Invalid*. When core A writes to a line, core B's copy is invalidated. False sharing causes constant invalidation. |
| **Coherence traffic** | Messages sent between cores to keep caches consistent. False sharing maxes out this traffic without doing useful work. |
| **Sharding** | Splitting a single contended value (e.g., a global counter) into many per-CPU values that are summed lazily. The classic anti-false-sharing pattern. |
| **`GOMAXPROCS`** | The number of OS threads Go may use to run goroutines. To reproduce false sharing reliably, set this equal to (or above) the number of *physical* cores. |
| **Atomic** | An operation on memory that completes as a single, indivisible unit. `atomic.AddInt64(&x, 1)` is one such operation. Atomic operations *cause* false sharing the most visibly, because each one demands exclusive cache-line ownership. |
| **Hot variable** | A variable written so often that it dominates cache traffic. False sharing matters only for hot variables. |
| **Microbenchmark** | A benchmark of a single tight operation, run for a controlled duration. In Go: a `func BenchmarkXxx(b *testing.B)` function. Used here to measure ns/op of one increment under various sharing scenarios. |

---

## Core Concepts

### Concept 1: A CPU does not read one byte at a time

When your Go program reads `x` (an `int64`, 8 bytes), the CPU does not fetch 8 bytes from RAM. It fetches **64 bytes** — the cache line containing `x` — and stores those 64 bytes in its L1 cache. Subsequent reads of any address in that 64-byte range hit the cache and take ~1 nanosecond. A read that misses the cache takes ~100 nanoseconds (a hundred times slower).

This is good for performance: programs have *spatial locality* — they tend to access nearby memory together — so loading 64 bytes when you only asked for 8 is usually a win.

It is bad when two cores share the cache line for *unrelated* reasons.

### Concept 2: Each core has its own L1 cache

A modern 8-core CPU has 8 separate L1 caches, one per core. Each L1 holds copies of memory the core is using. If two cores both want a copy of the same 64-byte line, that is fine — they both hold a *shared* read-only copy.

The problem starts when one core *writes*. The cache-coherence protocol says: at most one core can hold a *modified* copy of a line at any time. The moment core A writes, the hardware sends invalidation messages to every other core, forcing them to drop their copies. When core B then tries to read or write, it must re-fetch the (now-modified) line from core A's cache. This is called a "cache line bounce" or "ping-pong."

A bounce costs around 30-80 nanoseconds on the same socket, and 100-300 nanoseconds across sockets (NUMA). On a tight loop doing one increment per iteration, every iteration becomes one bounce. The "fast" atomic operation goes from ~5 ns to ~100 ns — a 20x slowdown.

### Concept 3: The hardware tracks coherence at cache-line granularity, not variable granularity

The cache-coherence hardware does not know about your `int64` variables. It tracks coherence in 64-byte blocks. If two unrelated `int64`s sit next to each other (16 bytes total), the hardware treats writes to either as writes to the same block.

```go
var counters [2]int64
// counters[0] is at address X
// counters[1] is at address X+8
// Both are in the cache line covering [X & ~63, (X & ~63) + 64)
```

If goroutine A writes `counters[0]` on core 0, and goroutine B writes `counters[1]` on core 1, the cache line bounces every iteration even though the two writes touch *different bytes*.

This is the essence of false sharing: the cache thinks they are sharing, but the program is not.

### Concept 4: Padding pushes variables onto separate cache lines

The simplest fix is to space variables out. A struct like:

```go
type PaddedCounter struct {
    v int64
    _ [56]byte // 56 bytes of padding, totalling 64 bytes
}
var counters [8]PaddedCounter
```

Now `counters[0]` occupies bytes 0..63, `counters[1]` occupies 64..127, and so on. The `int64` is at the start of its own cache line, with no other live variable to interfere. Writes from different cores no longer collide.

The padding is *wasted memory* — 56 of every 64 bytes are unused — but in exchange you get true linear scaling. On a hot path with 8 cores, this is one of the highest leverage tradeoffs in systems programming.

### Concept 5: Go's standard library does this for you in critical structures

Look at `sync.Mutex` (Go 1.21+). It is just two `int32` fields and is *not* padded. Why? Because mutexes are usually used in cold paths where false sharing does not matter — a contended mutex is a much larger problem than its cache layout.

But look at `sync.Pool` internals. The per-P (per-processor) cache is a struct called `poolLocal`, with explicit padding to a cache line:

```go
// from runtime-managed code, paraphrased:
type poolLocalInternal struct {
    private any
    shared  poolChain
}

type poolLocal struct {
    poolLocalInternal
    // Prevents false sharing on widespread platforms with
    // 128 mod (cache line size) == 0 .
    pad [128 - unsafe.Sizeof(poolLocalInternal{})%128]byte
}
```

The runtime is explicitly admitting: "each per-P slot is hot enough that two adjacent slots must not share a cache line." This is the canonical real-world example of cache-line padding in Go.

The internal package `runtime/internal/sys` defines `CacheLinePad`:

```go
// (paraphrased)
type CacheLinePad struct{ _ [CacheLineSize]byte }
```

where `CacheLineSize` is platform-defined (64 on amd64/arm64, 128 on ppc64). The runtime sprinkles `CacheLinePad` between hot fields in the scheduler and memory allocator.

### Concept 6: False sharing only matters when there is contention

If you write to a variable rarely, false sharing costs nothing measurable. The cache line bounces once, then sits in modified state. The fix matters only when:

1. The variable is written *frequently* (think tight loop, > 100 K writes/sec/core).
2. Two or more cores write *concurrently* to variables on the same line.

A counter incremented once per HTTP request, at 1000 req/s split over 8 cores, is *not* a false-sharing problem. The same counter incremented inside a parser running at 100 M ops/s/core is.

This is why "always pad" is bad advice. Padding costs memory. Pad only the hot variables that your benchmark proves benefit.

---

## Real-World Analogies

### Analogy 1: The shared whiteboard

Imagine eight people working on different problems in different rooms. Each problem has its own answer; the answers are independent. But there is only one big whiteboard in a central hall, and every time anyone updates their answer, the whole whiteboard must be carried over to them, used briefly, then carried to the next person. The whiteboard is 64 inches wide. Each answer takes 8 inches. Two answers fit on the same board.

Even though the answers are independent, the *physical board* is shared, and so the eight workers form a single queue waiting for the board. This is false sharing: the *medium* is shared even though the *information* is not.

Fix: give each person their own 8-inch board. Now they work in parallel. The total area of boards is now 64 inches, but each is local; no carrying. This is padding.

### Analogy 2: The post office boxes

A row of post office boxes is bolted to one frame. To access any box in the row, the postal worker pulls the entire frame off the wall, opens the one box, and puts the frame back. If only one person uses one box at a time, no problem. But if Alice and Bob both have boxes on the same frame, and both try to retrieve mail simultaneously, only one can hold the frame at a time. Bob waits for Alice; then Alice waits for Bob to put the frame back.

The frame is the cache line. The boxes are variables. Putting Alice's and Bob's boxes on separate frames is padding.

### Analogy 3: The shared truck

A 64-byte cache line is like a delivery truck that visits one warehouse at a time. The truck can carry any combination of packages, but only one warehouse can have the truck at any moment. If your package and my package both happen to fit in the same truck, we cannot both be receiving deliveries at the same time, even if our packages are completely unrelated.

A multi-core CPU is like a fleet of warehouses (cores) competing for trucks (cache lines). False sharing is "two warehouses wanting the same truck for unrelated reasons."

### Analogy 4: The library card catalog drawer

A pre-digital library had wooden card-catalog drawers. To look up a book, you had to pull out the whole drawer (cache line). The drawer held 200 cards (variables). If you and I both wanted to look up books in the same drawer, we took turns even if our books were unrelated. Two people, different books, but one drawer.

---

## Mental Models

### Mental Model 1: "Cores fight over lines, not bytes"

The most useful one-line mental model. When debugging concurrent performance, think in terms of *which cache line each variable lives on*. Two variables are "neighbours" if they fit in the same 64-byte block. Two writes to neighbours from different cores are as expensive as two writes to the same variable.

### Mental Model 2: "Atomic operations broadcast"

A single `atomic.AddInt64` looks innocent — one assembly instruction (`lock xadd` on x86). But that instruction requires the cache line to be in the *exclusive* state in the executing core's L1. If another core holds the line, the executing core must invalidate it first. The atomic operation, from the cache's perspective, is a broadcast: "everyone drop your copy, I am modifying."

A non-atomic store has the same effect on the line (it must go to exclusive state to be modified). Atomics make this explicit; ordinary stores hide it but pay the same cost.

### Mental Model 3: "Padding trades memory for parallelism"

Padding adds memory but unlocks scaling. On 8 cores, going from a 64-byte struct with 8 contended int64s to 8 separate 64-byte structs costs 8x memory (64 → 512 bytes) but yields ~8x throughput. The tradeoff is almost always worth it for hot paths.

For cold paths, the same 8x memory cost yields zero gain, and may even hurt L1 utilisation (you fit fewer things in cache). This is why Go does not pad every struct — only the ones in performance-critical code.

### Mental Model 4: "Sharding is padding for global state"

If you have a single global counter that all goroutines hit, padding does not help — there is only one variable. The fix is *sharding*: replace one counter with N (one per CPU/goroutine), increment locally, sum on read. Each shard lives on its own cache line. Read costs scale with N, but writes scale with cores. For write-heavy workloads, this is the right tradeoff.

This is how `sync.Pool` works, how the Go runtime's per-P caches work, and how production-grade counter libraries (e.g., Prometheus's atomic counters in Go) avoid contention.

---

## Pros & Cons

### Cache-line padding

**Pros:**
- Eliminates a class of performance bugs that no profiler will surface unless you know what to look for.
- Cheap to apply once you have spotted the hot variable: add a struct field with `[56]byte`.
- Unlocks near-linear scaling on multi-core machines for embarrassingly-parallel workloads.
- Standard practice in the Go runtime itself, so you are in good company.

**Cons:**
- Wastes memory. A `[8]int64` (64 bytes) becomes a `[8]Padded64{int64; [56]byte}` (512 bytes).
- Hurts cache pressure if applied to cold variables. Adding 8x memory to a rarely-written struct means 8x fewer of them fit in L1.
- Hides intent. A reader sees `[56]byte` of padding and may not understand why it is there unless commented.
- Architecture-dependent. The "magic number" 64 is wrong on ppc64 (128) and on some ARM big.LITTLE configurations. Use `runtime/internal/sys.CacheLineSize` or a compile-time constant rather than hardcoding 56 or 64.

### Sharding (per-CPU/per-shard variables)

**Pros:**
- Eliminates contention entirely on write paths.
- Scales perfectly with cores for write-heavy workloads.
- Read aggregation is straightforward (a simple sum).

**Cons:**
- Reads are slower (must sum N shards).
- Slightly more code than a single counter.
- Choosing the right shard count requires knowing CPU topology.

---

## Use Cases

False sharing matters in any hot, write-heavy concurrent workload. Concrete cases:

1. **Per-CPU statistics counters.** Metrics like "requests served," "bytes received," "cache hits" updated millions of times per second. The classic motivating example.

2. **Lock-free queues.** Producer and consumer indexes in an SPSC ring buffer. If `head` and `tail` are on the same cache line, the producer and consumer ping-pong it on every operation, halving throughput. Production-grade ring buffers always pad `head` and `tail` apart.

3. **Worker pool per-worker state.** Each worker has a `processed` counter. If they are all in one struct laid out as `workers []Worker`, they false-share.

4. **`sync.Pool` per-P caches.** Already padded by the runtime.

5. **The Go scheduler's per-P structures.** Already padded by the runtime.

6. **Memory allocators.** Per-P small-object caches in `runtime/mcache`. Already padded by the runtime.

7. **Concurrent hash maps (sharded).** Each shard's lock and metadata should be on its own cache line to avoid contention between shards that happen to lay out adjacently.

When does it *not* matter?
- Read-mostly data (e.g., a config struct read by every goroutine but written once at startup). The line is in *shared* state, no invalidation traffic.
- Single-writer data (one goroutine writes, others read). Bounces happen on reads, but only one writer means no inter-writer contention.
- Low-frequency writes (a counter ticked once per second).

---

## Code Examples

### Example 1: The minimal demonstration

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
    "testing"
    "time"
)

const iters = 100_000_000

// Adjacent: 8 int64s pack into 64 bytes — one cache line.
type Adjacent struct {
    counters [8]int64
}

// Padded: each int64 sits at the start of its own 64-byte block.
type Padded struct {
    counters [8]struct {
        v   int64
        _   [56]byte
    }
}

func runAdjacent(workers int) {
    a := &Adjacent{}
    var wg sync.WaitGroup
    wg.Add(workers)
    start := time.Now()
    for i := 0; i < workers; i++ {
        go func(id int) {
            defer wg.Done()
            for j := 0; j < iters; j++ {
                atomic.AddInt64(&a.counters[id], 1)
            }
        }(i)
    }
    wg.Wait()
    fmt.Printf("adjacent %d workers: %v\n", workers, time.Since(start))
}

func runPadded(workers int) {
    p := &Padded{}
    var wg sync.WaitGroup
    wg.Add(workers)
    start := time.Now()
    for i := 0; i < workers; i++ {
        go func(id int) {
            defer wg.Done()
            for j := 0; j < iters; j++ {
                atomic.AddInt64(&p.counters[id].v, 1)
            }
        }(i)
    }
    wg.Wait()
    fmt.Printf("padded   %d workers: %v\n", workers, time.Since(start))
}

func main() {
    _ = testing.Benchmark // unused, but signals "this is a perf demo"
    for _, n := range []int{1, 2, 4, 8} {
        runAdjacent(n)
        runPadded(n)
    }
}
```

Typical output on an 8-core x86 machine:

```
adjacent 1 workers: 420ms
padded   1 workers: 420ms
adjacent 2 workers: 1.8s
padded   2 workers: 430ms
adjacent 4 workers: 4.1s
padded   4 workers: 450ms
adjacent 8 workers: 9.6s
padded   8 workers: 510ms
```

- At 1 worker: identical. One core, no other cache holders, padding does not matter.
- At 8 workers: padded is **~19x faster**. Adjacent gets slower with more workers; padded barely changes.

That single observation — adjacent counters get slower with more cores — is the signature of false sharing.

### Example 2: As a `testing.B` benchmark

```go
package falseshare

import (
    "sync"
    "sync/atomic"
    "testing"
)

type Adjacent struct{ counters [8]int64 }
type Padded struct {
    counters [8]struct {
        v int64
        _ [56]byte
    }
}

func BenchmarkAdjacent(b *testing.B) {
    a := &Adjacent{}
    workers := 8
    var wg sync.WaitGroup
    b.ResetTimer()
    wg.Add(workers)
    for i := 0; i < workers; i++ {
        go func(id int) {
            defer wg.Done()
            for j := 0; j < b.N; j++ {
                atomic.AddInt64(&a.counters[id], 1)
            }
        }(i)
    }
    wg.Wait()
}

func BenchmarkPadded(b *testing.B) {
    p := &Padded{}
    workers := 8
    var wg sync.WaitGroup
    b.ResetTimer()
    wg.Add(workers)
    for i := 0; i < workers; i++ {
        go func(id int) {
            defer wg.Done()
            for j := 0; j < b.N; j++ {
                atomic.AddInt64(&p.counters[id].v, 1)
            }
        }(i)
    }
    wg.Wait()
}
```

Run with:

```
go test -bench . -benchtime=2s -cpu=8
```

Typical ns/op:

```
BenchmarkAdjacent-8   200000000   95.0 ns/op
BenchmarkPadded-8     2000000000   5.2 ns/op
```

That is roughly a **18x** speedup. The benchmark cost on a single core (without contention) is ~5 ns/op for both — confirming the only thing changing is contention.

### Example 3: Using `runtime/internal/sys.CacheLinePad` (or a portable equivalent)

The runtime's `CacheLinePad` is in an *internal* package, so user code cannot import it directly. The portable equivalent is a small constant:

```go
package cachepad

const CacheLineSize = 64 // valid on amd64 and arm64

type Pad [CacheLineSize]byte

type PaddedCounter struct {
    v   int64
    _   [CacheLineSize - 8]byte
}
```

Or, to avoid hardcoding `8` (the size of an `int64`):

```go
type PaddedCounter struct {
    v   int64
    _   [CacheLineSize - unsafe.Sizeof(int64(0))%CacheLineSize]byte
}
```

In practice, most Go codebases just write `_ [56]byte`. It is clear, ugly, and impossible to misread. The runtime's idiom for *between* fields is similar:

```go
type someStruct struct {
    hotField1 int64
    _         CacheLinePad
    hotField2 int64
    _         CacheLinePad
}
```

### Example 4: A padded SPSC ring buffer head/tail

A classic single-producer, single-consumer ring buffer has a head index (written by producer, read by consumer) and a tail index (written by consumer, read by producer). If they share a cache line, the line bounces every operation.

```go
type SPSCRing struct {
    head uint64
    _    [56]byte // push tail onto its own cache line
    tail uint64
    _    [56]byte
    buf  []byte
}
```

On real microbenchmarks, padding the indices yields 2-3x throughput on dual-core consumer/producer setups.

### Example 5: Reproducing without atomics (the cheating-fast-path version)

Atomics make false sharing visible because every increment is a `lock xadd`. Ordinary writes have the same coherence effect but are easier to miss because the compiler may reorder or batch. To demonstrate false sharing with ordinary writes, you need volatile-like semantics. Go does not have `volatile`, but writing through `unsafe.Pointer` is close enough for a demo:

```go
type Adjacent struct{ counters [8]int64 }

func writeNonAtomic(a *Adjacent, id int) {
    for j := 0; j < iters; j++ {
        a.counters[id] = int64(j) // ordinary write
    }
}
```

The compiler is allowed to optimise this loop to a single store of `int64(iters-1)`. To prevent that, force visibility:

```go
import "sync/atomic"

func writeReleased(a *Adjacent, id int) {
    for j := 0; j < iters; j++ {
        atomic.StoreInt64(&a.counters[id], int64(j))
    }
}
```

`atomic.Store` forces each write to memory and prevents reordering. The cache-line traffic is the same as for `AddInt64`.

For the rest of this file, we use atomics for clarity.

### Example 6: Visualising line layout with `unsafe.Offsetof`

```go
package main

import (
    "fmt"
    "unsafe"
)

type Adjacent struct{ counters [8]int64 }
type Padded struct {
    counters [8]struct {
        v int64
        _ [56]byte
    }
}

func main() {
    var a Adjacent
    var p Padded
    fmt.Println("Adjacent layout:")
    for i := 0; i < 8; i++ {
        addr := uintptr(unsafe.Pointer(&a.counters[i]))
        fmt.Printf("  counters[%d] at offset %d, line %d\n",
            i, i*8, addr/64)
    }
    fmt.Println("Padded layout:")
    for i := 0; i < 8; i++ {
        addr := uintptr(unsafe.Pointer(&p.counters[i].v))
        fmt.Printf("  counters[%d].v at offset %d, line %d\n",
            i, i*64, addr/64)
    }
}
```

Output (approximate; absolute addresses vary):

```
Adjacent layout:
  counters[0] at offset 0,  line 1234567
  counters[1] at offset 8,  line 1234567
  counters[2] at offset 16, line 1234567
  counters[3] at offset 24, line 1234567
  counters[4] at offset 32, line 1234567
  counters[5] at offset 40, line 1234567
  counters[6] at offset 48, line 1234567
  counters[7] at offset 56, line 1234567
Padded layout:
  counters[0].v at offset 0,   line 1234567
  counters[1].v at offset 64,  line 1234568
  counters[2].v at offset 128, line 1234569
  ...
```

Eight counters → eight lines. The numbers `1234567+i` will vary; the key is they are all *different*.

### Example 7: Why the array index, not pointer dereference, can matter

A subtle one: if you have a slice of pointers, the pointed-to objects can land anywhere. Two `*int64`s in a slice might point to two int64s in *separate* heap allocations on separate lines — or they might point to two int64s in the same allocation. Padding requires control over layout:

```go
// May or may not be false-sharing-free; depends on allocator behaviour.
var counters [8]*int64
for i := range counters {
    counters[i] = new(int64)
}

// Guaranteed false-sharing-free if Padded is 64-byte aligned and sized 64.
var counters [8]Padded
```

The second is safer. The Go runtime aligns 64-byte-sized objects to 8 bytes, *not* 64 bytes — so even `[8]Padded` does not guarantee the *first* element starts on a cache line boundary. But all *internal* elements are on separate lines from each other, which is what matters for inter-shard isolation. If the first element shares a line with whatever lives before it, that is one bounce against an unrelated variable, not a sustained contention.

For true guaranteed alignment, you need to allocate aligned memory manually (e.g., via `mmap` with alignment hints, or by overallocating and skipping forward to a 64-byte boundary). For most Go code this is overkill.

---

## Coding Patterns

### Pattern 1: The padded-counter idiom

```go
type PaddedCounter struct {
    v int64
    _ [56]byte
}

type Stats struct {
    Hits   [N]PaddedCounter
    Misses [N]PaddedCounter
}

func (s *Stats) Hit(shard int)  { atomic.AddInt64(&s.Hits[shard].v, 1) }
func (s *Stats) Miss(shard int) { atomic.AddInt64(&s.Misses[shard].v, 1) }
```

The shard index is typically `runtime.ProcPin()` (advanced) or a fast hash of the goroutine ID (simpler).

### Pattern 2: Read-side aggregation

```go
func (s *Stats) TotalHits() int64 {
    var total int64
    for i := range s.Hits {
        total += atomic.LoadInt64(&s.Hits[i].v)
    }
    return total
}
```

Aggregation is O(N) where N is shard count. For 8 shards, this is 8 atomic loads ≈ 40 ns — fine for any non-hot-path read.

### Pattern 3: Pad between unrelated fields in a hot struct

```go
type Scheduler struct {
    runQueueHead uint32
    _            [60]byte // separate head from tail
    runQueueTail uint32
    _            [60]byte // separate from following hot fields
    stealCounter uint64
}
```

The Go runtime's scheduler uses this exact pattern (with `sys.CacheLinePad`) for `runq` head/tail in `runtime/runtime2.go`.

### Pattern 4: Cache-aware shard count

Use `runtime.NumCPU()` (or `runtime.GOMAXPROCS(0)`) as the shard count:

```go
type Stats struct {
    shards []PaddedCounter // len = runtime.GOMAXPROCS(0)
}

func NewStats() *Stats {
    return &Stats{shards: make([]PaddedCounter, runtime.GOMAXPROCS(0))}
}
```

A finer pattern uses `runtime.ProcPin()` (in internal-ish code) to get the current P index, ensuring the same goroutine always hits the same shard. Junior-level code can use `goroutineID % len(shards)` or a simpler `hash(time.Now().UnixNano()) % len(shards)` for the first version.

### Pattern 5: Detecting need-for-padding via benchmark

Always benchmark before adding padding. The pattern:

```go
func BenchmarkBefore(b *testing.B) { /* unpadded */ }
func BenchmarkAfter(b *testing.B)  { /* padded */ }
```

Run with `-cpu=1,2,4,8` and look for the gap between unpadded at high `-cpu` and padded at high `-cpu`. If the gap is < 2x, the padding is probably not worth the memory and the complexity.

---

## Clean Code

False sharing fixes can be ugly. The `[56]byte` field tells the reader nothing. A few habits keep things clean:

### Habit 1: Always comment the padding

```go
type PaddedCounter struct {
    v int64
    // Pad to 64 bytes (one cache line) to avoid false sharing.
    _ [56]byte
}
```

A future reader sees the comment first and is not tempted to "tidy" away the bytes.

### Habit 2: Centralise the padding type

```go
package cachepad

const LineSize = 64

type Pad60 [LineSize - 4]byte
type Pad56 [LineSize - 8]byte
type Pad48 [LineSize - 16]byte
type Line  [LineSize]byte
```

Then:

```go
import "myproject/internal/cachepad"

type Stats struct {
    Hits int64
    _    cachepad.Pad56
}
```

This makes the *intent* explicit. The reader sees `cachepad.Pad56` and knows: false-sharing avoidance.

### Habit 3: Keep padding out of public API

Padding is an implementation detail. Do not expose a `PaddedCounter` type in your public API; expose a `Counter` interface or `Counter` struct whose internal padding is private.

### Habit 4: Document the assumption

```go
// PaddedCounter is sized to exactly one 64-byte cache line on amd64
// and arm64. On ppc64 the cache line is 128 bytes; consider double
// padding if running on that architecture under contention.
type PaddedCounter struct {
    v int64
    _ [56]byte
}
```

### Habit 5: Prefer `sync.Pool` and other prebuilt sharded primitives over hand-rolled sharding when you can

Reinventing per-CPU counters from scratch is fun, but `sync.Pool` already solves much of the problem for "give me a free object cheaply." If you can express your hot path as object allocation, `sync.Pool` is a one-line answer.

---

## Product Use / Feature

In a product, false sharing typically shows up as:

- A metrics counter library that is fine in development (single threaded tests) and slow in production (eight cores all hammering one struct).
- A request-counter middleware whose p99 latency triples when traffic crosses the per-core threshold.
- A worker pool whose throughput plateaus at 2x even though `GOMAXPROCS` is 8.
- A garbage-collector telemetry struct that produces noisy benchmark results.

Concrete features built on the back of fixing false sharing:

- **Prometheus client metrics.** The Go client library uses sharded counters internally to avoid contention on `Counter.Inc()` at high RPS.
- **`expvar` exposed variables.** When used naively, can be a bottleneck.
- **High-performance RPC servers.** Per-handler stats are typically sharded.
- **In-process trace samplers.** Per-CPU sampling counters avoid coordination cost.

A small product story: a team migrated a metrics library from a global `int64` (protected by `atomic.AddInt64`) to a per-CPU sharded version. Their p99 dropped 30% on 16-core machines under heavy load — not because the atomic was slow, but because the *contention* on the atomic's cache line slowed every other piece of work.

---

## Error Handling

False sharing is a *performance* problem, not a *correctness* problem. The program runs correctly; it just runs slow. So there is no error to handle, no panic to recover, no return code to check. The "errors" you face are:

1. The benchmark shows the wrong gap → maybe you forgot `-cpu=8`, or `GOMAXPROCS=1`. The slowdown only appears with multiple physical cores in use.
2. The padding does not help → maybe the contention is not false sharing but real (multiple cores writing the same variable, not adjacent variables). Check with `perf c2c` or by re-running with one counter per goroutine instead of per-id-mod-N.
3. The padded version is *slower* in some cases → small structs are sometimes faster because they fit in L1. Make sure the unpadded version is exposed to multi-core contention.

The deeper lesson: false sharing reveals itself only under load. A unit test will never catch it. You need a benchmark that exercises concurrency, or production telemetry that surfaces the regression.

---

## Security Considerations

False sharing has been weaponised in two domains:

1. **Side-channel attacks.** A malicious process on a shared machine can detect what cache lines a victim is touching by timing its own accesses to neighbours. This is the principle behind FLUSH+RELOAD and Prime+Probe attacks. False sharing on a hot variable creates a measurable timing signature on neighbouring (innocent) variables. For most Go server programs this is not a practical threat, but in shared-tenant environments (cloud VMs, containers) it is real.

2. **Cache-coherence denial-of-service.** A co-resident process can deliberately write a shared line at high frequency to slow a victim. Hypervisors usually mitigate this, but the underlying mechanism is the same as false sharing.

For application developers, the practical security impact of false sharing is small. The performance impact is the dominant concern.

---

## Performance Tips

1. **Measure before fixing.** Always start with a benchmark that shows the slowdown. If you cannot reproduce the bug, you cannot trust the fix.

2. **Always include `-cpu=1,2,4,8`.** False sharing scales (badly) with core count. A benchmark at `-cpu=1` cannot show false sharing.

3. **Use `b.ResetTimer()`.** Without it, setup time pollutes the measurement and small differences vanish in noise.

4. **Be aware of allocator alignment.** Even a "padded" struct may not start on a cache-line boundary if the allocator only aligns to 8 bytes. For most cases this is fine — the boundary alignment matters only for the *first* element; internal elements are always one line apart.

5. **Avoid `interface{}` for hot counters.** An interface value is 16 bytes (type pointer + data pointer); two of them in a row fit in one cache line plus more, and reads go through an indirection. Use concrete types.

6. **Use `runtime.GOMAXPROCS(0)` for shard count.** This is the right tradeoff between memory cost and contention savings.

7. **Profile with `perf c2c` (Linux).** It directly identifies false sharing hot spots. Worth learning even at junior level.

8. **Do not pad cold variables.** A struct read or written < 100 K/s/core has no measurable contention. Padding only wastes memory and pollutes cache.

9. **Pad bidirectional structures** (head/tail in queues, read/write counters) on both sides of the hot fields, not just one. Otherwise an unrelated neighbour can still cause bounces.

10. **Watch out for arrays of small types.** `[N]int32`, `[N]int16`, `[N]bool` — these pack many elements per line. If concurrently written, severe false sharing. Promote to `[N]struct{ v T; _ [pad]byte }`.

---

## Best Practices

1. **Pad hot per-CPU/per-shard structures.** This is the canonical case for padding. If you have an array indexed by core/shard, each element should be one full cache line.

2. **Use named padding types.** `cachepad.Line` is more readable than `[64]byte`.

3. **Document why.** A comment saying "avoid false sharing on the producer/consumer indexes" turns mysterious bytes into intentional design.

4. **Co-locate fields written by the same goroutine.** The opposite of padding: fields that change together should fit on the same line, to maximise cache hits.

5. **Separate fields written by different goroutines.** This is the rule of thumb for false sharing.

6. **Run benchmarks at multiple `-cpu` values.** A benchmark at one core is not representative.

7. **Use sharding (one variable per CPU) for global counters.** Padding fixes adjacency; sharding eliminates the cross-CPU contention entirely.

8. **Trust the standard library's choices.** When `sync.Pool` pads its per-P struct, do not "optimise" by removing the padding.

9. **Re-evaluate when targeting new architectures.** ARM, ppc64, RISC-V have different cache line sizes. The "64" magic constant is amd64+arm64; do not assume it elsewhere.

10. **Treat padding as a profiler-guided choice, not a default.** Code that always pads is harder to read and uses more memory; code that never pads scales poorly. The middle ground is "pad what the profiler says is hot."

---

## Edge Cases & Pitfalls

### Pitfall 1: Padding a struct does not guarantee cache-line alignment

The Go heap allocator aligns to 8 bytes (sometimes 16) for `Sizeof(struct{}) >= 8`. A struct sized exactly 64 bytes is *not* guaranteed to start on a 64-byte boundary; it might straddle two lines.

For most cases this is fine: the elements *within* the struct are still on the same line, and an array of such structs places elements 64 bytes apart, so internal adjacency is solved. The only loss is that the boundary element might share a line with an unrelated neighbour. The probability and cost of this are typically small.

For *true* alignment, you need `unsafe` or a manual offset trick. Most Go code does not need it.

### Pitfall 2: Slices are pointers to arrays

```go
slice := make([]int64, 8)
```

The eight ints live in one 64-byte block, packed. Even though `slice` is a slice header (24 bytes), the underlying array is the issue, and writes to `slice[0]` through `slice[7]` from different cores cause false sharing.

The fix is the same as for arrays: change to `[]struct{ v int64; _ [56]byte }`.

### Pitfall 3: `sync.Mutex` is not padded

It is two `int32` fields, eight bytes total. If you have a `[]struct{ m sync.Mutex; ... }` and two cores hammer two different mutexes that happen to share a cache line, you get contention on the *lock state itself*. The standard fix is to pad your struct (not the mutex):

```go
type Shard struct {
    sync.Mutex
    // ... data ...
    _ [pad]byte
}
```

### Pitfall 4: Embedded fields can shift offsets

If you add a field to a struct, every later field shifts. Padding designed for offsets X and Y becomes wrong. Best practice: compute padding from `unsafe.Sizeof`, or always re-benchmark after struct changes.

### Pitfall 5: Compiler-introduced padding can confuse you

The Go compiler already inserts padding for alignment of larger types. A struct `{int32; int64}` is 16 bytes (4 bytes of compiler-added padding before `int64`). If you read your struct's `unsafe.Sizeof` and it is larger than the sum of fields, that is alignment padding, not false-sharing padding. The two are conceptually different.

### Pitfall 6: Padding a single-field struct hides intent

`struct{ v int64; _ [56]byte }` *looks* wasteful. Name it:

```go
type PaddedInt64 struct {
    v int64
    _ [56]byte
}
```

Now a reader sees the name and understands.

### Pitfall 7: False sharing on the stack

Adjacent local variables in a goroutine's stack can false-share with other goroutines' stack variables if (rarely) the stacks happen to be near each other and the goroutines bounce between threads. In practice this is extremely rare — stacks are per-goroutine and rarely touched by other goroutines.

### Pitfall 8: Confusion between false sharing and contention

True contention: two goroutines both write the *same* atomic variable. The cache line bounces because the variable is genuinely shared. The fix is sharding, not padding.

False sharing: two goroutines write *different* variables that share a line. The fix is padding (or restructuring).

If your benchmark shows that splitting one counter into many counters helps, that is fixing contention. If your benchmark shows that *spacing out* an array of counters helps, that is fixing false sharing.

---

## Common Mistakes

### Mistake 1: Padding before measuring

```go
type Counter struct {
    v int64
    _ [56]byte // I read about this once
}
```

Used everywhere. Wastes 56 bytes per counter, sometimes in code that is not hot. The L1 cache fills up with empty bytes. Junior version of "premature optimisation."

### Mistake 2: Forgetting that the *first* byte of a struct is not aligned

The fix is usually fine *between* elements of an array, because element 1 is 64 bytes from element 0. But element 0 might share a line with whatever is before it. For most code this does not matter.

### Mistake 3: Padding only one side

```go
type Q struct {
    head uint64
    _    [56]byte
    tail uint64
    // No padding after tail.
}
```

If `tail` is at offset 64, then offset 64..71 is `tail` and offset 72..127 is "whatever follows the struct," which could be a hot variable in the same allocation. Pad both sides.

### Mistake 4: Hardcoding 64 on non-x86 platforms

```go
const cacheLine = 64 // wrong on ppc64
```

Use `runtime/internal/sys.CacheLineSize` (if internal-allowed) or a build-tag-conditional constant:

```go
//go:build ppc64
const CacheLineSize = 128
```

### Mistake 5: Padding shared/read-only data

A struct read by all goroutines but written by none has its cache line in *shared* state — many caches hold a read-only copy. No invalidation traffic. Padding does nothing. Often makes performance *worse* because more memory means fewer items per L1.

### Mistake 6: Confusing per-goroutine and per-CPU

```go
var counter [maxGoroutines]int64 // one slot per goroutine
```

If goroutines bounce between cores (which they do all the time in Go's scheduler), a single goroutine's slot is touched by multiple cores over time. The slot is hot from many cores. The shard count should match *CPU count*, not goroutine count.

### Mistake 7: Underestimating the slowdown

"Surely a single atomic operation is fast enough." A bounced cache line on `atomic.AddInt64` can be 30 ns. Doing one per request, the atomic *is* fine. Doing one per byte parsed in a hot loop, it dominates the program's runtime.

### Mistake 8: Forgetting `runtime.LockOSThread` semantics

If you `runtime.LockOSThread()` a goroutine to its current OS thread, it does *not* mean it stays on the same CPU core. The OS can still migrate the thread across cores. To pin to a core, use `taskset` (Linux) or platform-specific syscalls.

### Mistake 9: Assuming `go vet` will catch it

`go vet` does not warn about false sharing. There is no compiler diagnostic. You must measure.

### Mistake 10: Writing complex sharding code where a `sync.Pool` would do

`sync.Pool` solves "give me a temporary object cheaply" without contention. Hand-rolling shards is only needed when `sync.Pool`'s semantics do not fit (e.g., for non-discardable state like a counter).

---

## Common Misconceptions

### Misconception 1: "False sharing is a race condition."

No. False sharing is a *performance* issue. The program is correct; it is just slow. No race detector warning, no `data race` message — silence.

### Misconception 2: "Atomic operations don't have false sharing because they're already synchronised."

Atomics are even *more* susceptible to false sharing than ordinary writes. Each atomic op requires the line in exclusive state. Two cores doing atomics on the same line are guaranteed to bounce. Atomics make false sharing visible; they do not eliminate it.

### Misconception 3: "Cache lines are 32 bytes / 128 bytes / variable."

On x86-64 and ARM64 — the platforms 99% of Go programs run on — cache lines are 64 bytes. On ppc64 they are 128 bytes. On some embedded ARM cores they are 32 bytes. For most Go developers, 64 is the answer.

### Misconception 4: "Padding wastes cache."

It wastes *memory*. The first 8 bytes of a padded counter are used; the 56 padding bytes never get loaded into anything other than the cache line that is already there. The cache load happens once per line, regardless of what is in the rest of the line.

The real cost is "fewer items in L1," which matters only if you have a *lot* of padded items and your working set is bigger than L1.

### Misconception 5: "Padding fixes contention."

No. Padding fixes *false* contention — sharing that exists only at the cache-line level. *True* contention (multiple cores writing the same variable) is a fundamentally different problem. The fix for true contention is sharding, batching, or eliminating the shared write.

### Misconception 6: "If I see false sharing in my code, I should pad everywhere."

No. Pad only the *hot* structures the profiler identifies. Universal padding is a waste of memory.

### Misconception 7: "Go's GC moves objects, so cache addresses change anyway."

Go's GC is non-moving. Once an object is allocated, its address is stable for the object's lifetime. Cache addresses are stable; analysis is meaningful.

### Misconception 8: "I should worry about L2 and L3 false sharing too."

False sharing happens at the coherence-granularity level, which is the L1 cache line — 64 bytes. L2 and L3 are downstream; they receive the coherence traffic but do not introduce additional false sharing.

---

## Tricky Points

### Tricky Point 1: The first read of a cache line is unavoidable

Even with perfect padding, a goroutine's first access to a counter triggers a cache miss (data not yet in L1). That miss costs ~100 ns. The bug fixed by padding is the *repeated* miss-rate caused by other cores invalidating the line. After warmup, padded code runs at L1 speed (~1 ns/op for non-atomic, ~5 ns/op for atomic).

### Tricky Point 2: `for range` performance can hide false sharing

```go
for i := range slice {
    atomic.AddInt64(&slice[i], 1)
}
```

In a single goroutine this is fast — the line is exclusive in this core's cache the whole time. Add a second goroutine doing the same loop on the same slice, and throughput tanks. The same code, twice the cores, *less* throughput. That is the signature.

### Tricky Point 3: NUMA introduces a second tier

On a multi-socket machine, cache-line bouncing across sockets is 3-10x more expensive than across cores on one socket. False sharing across NUMA nodes can be catastrophic. Padding is the same fix; the gap is just larger.

### Tricky Point 4: Stack and heap have different layouts

A counter declared as a local variable is on the goroutine's stack. Two goroutines have separate stacks; their locals do not false-share. False sharing is essentially a heap (and global) problem.

### Tricky Point 5: Concurrent reads do not cause false sharing

Two cores reading the same cache line both hold a *shared* copy; no invalidation, no bounce. False sharing requires at least one writer. (Reads cost the initial miss, then they are free.)

### Tricky Point 6: `sync.Mutex.Lock` involves at least one atomic CAS

Two adjacent mutexes false-share on lock attempts. The standard fix: pad the *containing struct* so adjacent items in `[]Container` do not share a line.

### Tricky Point 7: Single-writer-multiple-reader scenarios are not false-sharing

If one goroutine writes `x` and many goroutines read `x`, the line bounces from writer to readers on each write, but the readers do not cause bounces among themselves. This is *true* sharing, not false. The line traffic is necessary; the only fix is to write less often, batch updates, or restructure the algorithm.

### Tricky Point 8: Cache-line size on Apple M-series

Apple Silicon (M1/M2/M3) is ARM64 with 128-byte cache lines on some implementations, 64-byte on others. Empirical observation: the M1 reports 128 from `sysctl hw.cachelinesize`. The Go runtime uses 64 on arm64 today, which is *conservative* for M1 (padding to 64 is not enough to eliminate false sharing on those chips). On Apple Silicon, you may need to pad to 128 for full effect. Measure.

---

## Test

Tests for false sharing are benchmarks, not unit tests. A passing-benchmark / failing-benchmark approach:

```go
// In falseshare_test.go

func TestPaddedIsFasterThanAdjacent(t *testing.T) {
    a := testing.Benchmark(BenchmarkAdjacent)
    p := testing.Benchmark(BenchmarkPadded)
    if a.NsPerOp() <= 2*p.NsPerOp() {
        t.Fatalf("padded should be > 2x faster; got adjacent=%v padded=%v",
            a.NsPerOp(), p.NsPerOp())
    }
}
```

This will pass on a multi-core machine, fail on a single-core CI runner. Use `-cpu=2` or skip on `runtime.NumCPU() == 1`.

A unit test for *correctness* of the padded counter:

```go
func TestPaddedCounterAccuracy(t *testing.T) {
    const workers = 4
    const each = 1_000_000
    p := &Padded{}
    var wg sync.WaitGroup
    wg.Add(workers)
    for i := 0; i < workers; i++ {
        go func(id int) {
            defer wg.Done()
            for j := 0; j < each; j++ {
                atomic.AddInt64(&p.counters[id].v, 1)
            }
        }(i)
    }
    wg.Wait()
    for i := 0; i < workers; i++ {
        if p.counters[i].v != each {
            t.Fatalf("counter[%d] = %d, want %d", i, p.counters[i].v, each)
        }
    }
}
```

The accuracy test ensures padding does not break correctness — easy to forget, easy to break.

---

## Tricky Questions

### Question 1: Why does *atomic* increment slow down with adjacency, but *non-atomic* writes also slow down?

Both atomic and non-atomic stores require the line in exclusive state. The cache hardware does not care whether the write was preceded by a `lock` prefix; the coherence cost is the same. Atomics make the cost *measurable* by preventing compiler optimisations that would batch or eliminate writes. Non-atomic writes have the same hardware effect when actually executed.

### Question 2: Does `false sharing` apply to reads?

No. Two cores reading the same line both hold shared (read-only) copies — no invalidation traffic. Reads never bounce the line. False sharing requires at least one *write*.

### Question 3: I padded my counter and it is still slow. What might be wrong?

Three possibilities:
1. The contention is *true* sharing (multiple cores writing the same variable). Padding does not help; you need sharding.
2. The hot variable is not the one you padded. Profile with `perf c2c` or `pprof` to confirm.
3. The padded struct's first element shares a line with an external variable. Try wrapping in a larger struct or using a fresh allocation.

### Question 4: Why does Go pad `sync.Pool` per-P slots but not `sync.Mutex`?

`sync.Pool.local` is a per-P array, accessed millions of times per second on each P. Adjacent slots are guaranteed to be hammered by different cores. `sync.Mutex` is a lock — its hot path is the *uncontended* one, where a single core holds the line in exclusive state. False sharing between two adjacent mutexes shows up only when both are contended, which is itself a bigger problem than the cache traffic.

### Question 5: Can the Go compiler add cache-line padding automatically?

No, and it is unlikely to. Cache-line size is platform-dependent, and the compiler does not know which fields are hot. Hand-padding is the convention. Some C++ compilers have attributes like `alignas(64)` for this purpose. Go has `unsafe.Alignof` for reading alignment, but no syntax for *requesting* a stricter alignment.

### Question 6: Is `[8]int64` always false-sharing-prone in concurrent use?

Yes, if eight goroutines write to eight distinct indices simultaneously. All eight slots fit in one 64-byte line. The bounce rate is approximately one bounce per write per pair of contending cores. Throughput collapses to single-threaded speed or worse.

### Question 7: How can I tell the cache line of an address?

`addr / 64` (on a 64-byte cache line architecture). Two addresses `a` and `b` are on the same line iff `a/64 == b/64`. In code:

```go
sameLine := uintptr(unsafe.Pointer(&x))/64 == uintptr(unsafe.Pointer(&y))/64
```

### Question 8: Does `go test -race` detect false sharing?

No. The race detector finds *data races*, which are unsynchronised reads and writes to the same memory location. False sharing involves *separate* memory locations and *synchronised* (atomic) accesses. The race detector is silent.

---

## Cheat Sheet

```
WHAT IS IT?
  Two cores writing two different vars that share a 64-byte cache line.
  Throughput drops to single-core speed or worse.

DIAGNOSE
  - Benchmark with -cpu=1,2,4,8. If perf degrades with more cores, suspect FS.
  - On Linux: perf c2c. Look for "HITM" (modified) line bounces.
  - On macOS: Instruments → Cache Hits/Misses.

CACHE LINE SIZE
  - amd64, arm64:  64 bytes
  - ppc64:         128 bytes
  - some Apple M*: 128 bytes (use 128 to be safe)

CLASSIC FIX
  type Padded struct {
      v int64
      _ [56]byte // 64-byte line minus 8-byte int64
  }

SHARED API LOCATIONS
  - runtime/internal/sys.CacheLinePad     (internal)
  - sync.Pool's per-P padding             (in stdlib, internal)
  - User code: roll your own constant.

RULES OF THUMB
  1. Only pad HOT structures (>100K writes/sec/core).
  2. Pad BOTH sides of a hot field, not just one.
  3. Shard global counters (one per CPU).
  4. Benchmark with multiple GOMAXPROCS values.
  5. Read-only data does NOT false-share.
```

---

## Self-Assessment Checklist

- [ ] I can explain what a cache line is in one sentence.
- [ ] I can explain why two unrelated variables in an array can be slow to update concurrently.
- [ ] I can write a struct that pads a counter to 64 bytes.
- [ ] I can write a benchmark that demonstrates false sharing.
- [ ] I know the name `runtime/internal/sys.CacheLinePad` and what it represents.
- [ ] I know cache lines are 64 bytes on amd64/arm64 and 128 on ppc64.
- [ ] I know false sharing requires at least one writer; reads alone never cause it.
- [ ] I know `go test -race` does *not* detect false sharing.
- [ ] I can distinguish "false sharing" from "true contention" and choose the right fix.
- [ ] I know `sync.Pool` is internally sharded and padded.
- [ ] I know that padding wastes memory and should not be applied universally.
- [ ] I have written and run a benchmark showing > 5x speedup from padding.

---

## Summary

False sharing is a hardware-level performance bug. Two goroutines write to two logically independent variables, but those variables share a 64-byte cache line, so every write triggers cache coherence traffic between cores. The program is correct but scales badly: throughput collapses with more cores instead of growing.

The fix is **padding** — ensuring each hot variable lives at the start of its own cache line, with the rest of the line wasted on filler bytes. The canonical Go idiom:

```go
type Padded struct {
    v int64
    _ [56]byte
}
```

For global state, the higher-leverage fix is **sharding** — replacing one variable with N (one per CPU), each on its own padded slot. Reads sum the shards; writes are local.

The Go runtime itself pads `sync.Pool`'s per-P slots, the scheduler's per-P run queues, and parts of `mcache`. The internal type `runtime/internal/sys.CacheLinePad` is the standard padding primitive — a `[CacheLineSize]byte` array.

False sharing is invisible to `go vet`, the race detector, and typical unit tests. It shows up only in concurrent benchmarks at multiple `-cpu` values. The signature: throughput gets worse as you add cores. The discipline: benchmark, pad, re-benchmark, document.

---

## What You Can Build

Now that you understand false sharing at the junior level, you can:

- Write a benchmark that proves padding helps on your machine.
- Build a sharded counter library that scales linearly with cores.
- Refactor a per-worker statistics struct to avoid false sharing.
- Diagnose performance regressions caused by accidentally re-packing a hot struct.
- Read the Go runtime source for `sync.Pool` and understand its padding.
- Write a high-throughput SPSC ring buffer with padded head/tail.
- Build a per-CPU rate limiter that scales linearly under load.
- Build a per-CPU sampling tracer that does not bottleneck on a single counter.

These are real, useful primitives. The padded counter alone is a building block of production-grade metrics, logging, and rate-limiting systems.

---

## Further Reading

- **Go runtime source**: `runtime/sync_pool.go`, `runtime/proc.go`, `runtime/runtime2.go`. Look for `pad` fields and `sys.CacheLinePad`.
- **"What every programmer should know about memory" by Ulrich Drepper.** Sections 3.3 and 6 cover cache coherence and false sharing in detail.
- **Intel 64 and IA-32 Architectures Optimization Reference Manual**, chapter on multi-core programming.
- **"Mechanical Sympathy" blog by Martin Thompson.** Series on cache lines, padding, and lock-free programming.
- **The LMAX Disruptor paper.** A high-performance Java queue whose design is built around eliminating false sharing.
- **`perf c2c` documentation.** The canonical tool for diagnosing false sharing on Linux.
- **Cliff Click's "False sharing in Java" lectures.** Concepts transfer directly to Go.
- **`runtime/internal/sys` in the Go source.** Read the definition of `CacheLinePad`.

---

## Related Topics

- **Cache coherence (MESI).** The hardware protocol that makes false sharing visible. Covered at senior and professional levels.
- **`sync/atomic`.** The primitives that make false sharing measurable. The unit cost of an atomic op multiplied by bounce probability is the false-sharing tax.
- **`sync.Pool`.** The canonical sharded, padded structure in the Go standard library.
- **NUMA.** Non-uniform memory access. Multi-socket false sharing is more expensive than single-socket.
- **CPU profiling and `pprof`.** Hardware performance counters (cycles, cache misses, coherence events) surface false sharing.
- **Lock-free programming.** Ring buffers, MPMC queues, lock-free hash maps all need careful cache-line awareness.
- **The Go memory model.** Defines *what* is synchronised but says nothing about cache lines. False sharing exists below the memory model.

---

## Diagrams & Visual Aids

### Diagram 1: Adjacent counters share a cache line

```
Address:   0     8    16    24    32    40    48    56    64
           +-----+-----+-----+-----+-----+-----+-----+-----+
Adjacent:  | c0  | c1  | c2  | c3  | c4  | c5  | c6  | c7  |
           +-----+-----+-----+-----+-----+-----+-----+-----+
           <--------- one cache line (64B) ---------->

Core 0 writes c0  →  invalidates line in Cores 1..7
Core 1 writes c1  →  invalidates line in Cores 0,2..7
Core 2 writes c2  →  invalidates line in Cores 0,1,3..7
... etc.

Result: every write triggers 7 invalidation messages.
```

### Diagram 2: Padded counters live on separate cache lines

```
Address:   0          64        128       192       256       ...
           +----------+----------+----------+----------+
Padded:    | c0 [pad] | c1 [pad] | c2 [pad] | c3 [pad] |
           +----------+----------+----------+----------+
           <-- line 0 ><-- line 1 ><-- line 2 ><-- line 3 >

Core 0 writes c0  →  invalidates only line 0; cores writing
                     c1, c2, c3 are unaffected.

Result: no inter-core invalidation traffic on this struct.
```

### Diagram 3: The MESI dance

```
Time → →
Core 0  | M | M | M | M | M | M | M | M |    (Modified after each write)
Core 1  | I | I | I | I | I | I | I | I |    (Invalid the whole time)

         ↑     ↑     ↑     ↑   ← invalidation messages every Core 1 write
```

With adjacent counters, Core 1's writes also force Core 0's line into Invalid. They alternate.

### Diagram 4: Throughput vs cores

```
Throughput (ops/sec)
  ^
  |
  |                              Padded
  |                       *
  |                    *
  |                 *
  |              *
  |           *
  |        *
  |     *
  |  *  *  *  *  *  *  *  Adjacent (flat, even degrading)
  +-------------------------> Cores
   1  2  3  4  5  6  7  8
```

The padded version scales near-linearly; the adjacent version flattens and may even degrade. This shape is the signature of false sharing.

### Diagram 5: How sharding compares to padding

```
SINGLE COUNTER (true contention)
   All cores → +-----+ ← one cache line, one variable
                | x |
               +-----+

   Bounce on every write. Throughput = single-core speed.

PADDED ADJACENT (false sharing fixed)
   Core 0 → +-----+
            | x0 |
            +-----+
            | pad |
   Core 1 → +-----+
            | x1 |
            +-----+
            | pad |
   ...

   Each core has its own line. No bounces.

SHARDED (true contention fixed for one global)
   Core 0 → [x0]
   Core 1 → [x1]
   Core 2 → [x2]
   ...
   Sum on read: total = x0 + x1 + ... + x7
```

Sharding + padding is the production recipe for "lock-free contended counter."

### Diagram 6: Cache hierarchy and where coherence happens

```
                   [ Main Memory (RAM) ~100ns ]
                              ^
                              |   ~100ns to fetch a line
                              |
                       +------v------+
                       |  Shared L3  |   ~10-30ns hit
                       +-------------+
                       /      |      \
                      /       |       \
            +--------+   +----+---+   +--------+
            |  L2 c0 |   | L2 c1  |   | L2 c2  |   ~3-10ns hit
            +--------+   +--------+   +--------+
                |            |            |
            +--------+   +--------+   +--------+
            |  L1 c0 |   | L1 c1  |   | L1 c2  |   ~1ns hit
            +--------+   +--------+   +--------+
                |            |            |
              CORE 0       CORE 1       CORE 2
```

Cache coherence is enforced at L1 cache line granularity. The protocol
(MESI on Intel, MOESI on AMD, MESIF on some) sends messages over the
ring/mesh interconnect that links cores. Every false-sharing bounce
generates messages on this interconnect.

### Diagram 7: Bounce timeline

```
Time:       0ns       30ns      60ns      90ns      120ns
            |         |         |         |         |
Core 0:     [W c0]    .         [W c0]    .         [W c0]
                      |
                      v invalidate
Core 1:     .         [W c1]    .         [W c1]    .
                                |
                                v invalidate
Cache line: [E@0]→[E@1]→[E@0]→[E@1]→[E@0]
            (Exclusive at 0)(then 1)(then 0)...
```

Each handoff takes ~30 ns. With both cores doing one increment every
~5 ns when uncontended, expected throughput is 200M ops/sec/core.
With one handoff per increment, throughput drops to 33M ops/sec per
pair of cores — a 6x degradation.

---

## Deep Dive: The Cache-Coherence Protocol (Junior Sketch)

You do not need MESI in detail at junior level, but knowing the cartoon helps. A cache line is in exactly one of these states on each core's L1:

- **M (Modified)**: this core has the only copy, and it has been written. RAM is out of date.
- **E (Exclusive)**: this core has the only copy, but it matches RAM. (No other core caches this line.)
- **S (Shared)**: multiple cores have copies, and they all match RAM. (Read-only effectively.)
- **I (Invalid)**: this core does not have a valid copy. Must re-fetch.

Allowed transitions (simplified):

```
[I] → [E]  on read where no one else has it
[I] → [S]  on read where someone else has it (they go to S too)
[E] → [M]  on write (no inter-core traffic)
[S] → [M]  on write (everyone else goes to I; traffic!)
[M] → [I]  on another core wanting to write (traffic!)
[M] → [S]  on another core reading
```

False sharing follows this script:

```
Core 0  Core 1
[E]     [I]      ← Core 0 has the line
[M]     [I]      ← Core 0 writes its counter
[I]     [M]      ← Core 1 writes its counter (forces 0 to I)
[M]     [I]      ← Core 0 writes again
[I]     [M]      ← Core 1 writes again
...
```

Each ping-pong is one inter-core message round. The hardware does this fast (in tens of nanoseconds) but it serialises the cores: only one can be in M at a time, so two cores hammering this line work as one core.

The "false" in false sharing is that nothing in the program *required* coherence to be enforced — the program is touching different bytes — but the hardware enforces it anyway, at the line level.

---

## A Whole Small Program: Diagnose-and-Fix Walkthrough

To consolidate, here is a complete program that shows the bug, measures it, fixes it, and re-measures. Save as `falseshare/main.go`:

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
    "sync/atomic"
    "time"
)

const (
    iters   = 100_000_000
    workers = 8
)

type Adjacent struct {
    counters [workers]int64
}

type Padded struct {
    counters [workers]struct {
        v int64
        _ [56]byte
    }
}

func runAdjacent() time.Duration {
    a := &Adjacent{}
    var wg sync.WaitGroup
    wg.Add(workers)
    start := time.Now()
    for i := 0; i < workers; i++ {
        go func(id int) {
            defer wg.Done()
            for j := 0; j < iters; j++ {
                atomic.AddInt64(&a.counters[id], 1)
            }
        }(i)
    }
    wg.Wait()
    return time.Since(start)
}

func runPadded() time.Duration {
    p := &Padded{}
    var wg sync.WaitGroup
    wg.Add(workers)
    start := time.Now()
    for i := 0; i < workers; i++ {
        go func(id int) {
            defer wg.Done()
            for j := 0; j < iters; j++ {
                atomic.AddInt64(&p.counters[id].v, 1)
            }
        }(i)
    }
    wg.Wait()
    return time.Since(start)
}

func main() {
    fmt.Println("GOMAXPROCS:", runtime.GOMAXPROCS(0))
    fmt.Println("NumCPU:    ", runtime.NumCPU())
    fmt.Println("workers:   ", workers)
    fmt.Println("iters/work:", iters)
    fmt.Println()

    // Warmup
    runAdjacent()
    runPadded()

    // Measure
    var adjTotal, padTotal time.Duration
    const trials = 3
    for t := 0; t < trials; t++ {
        adjTotal += runAdjacent()
        padTotal += runPadded()
    }
    adj := adjTotal / trials
    pad := padTotal / trials

    fmt.Printf("Adjacent:  %v  (%.1f ns/op)\n",
        adj, float64(adj.Nanoseconds())/float64(workers*iters))
    fmt.Printf("Padded:    %v  (%.1f ns/op)\n",
        pad, float64(pad.Nanoseconds())/float64(workers*iters))
    fmt.Printf("Speedup:   %.1fx\n", float64(adj)/float64(pad))
}
```

A representative run on an 8-core machine:

```
GOMAXPROCS: 8
NumCPU:     8
workers:    8
iters/work: 100000000

Adjacent:  9.7s   (12.1 ns/op)
Padded:    520ms  (0.65 ns/op)
Speedup:   18.7x
```

The padded version costs less than one nanosecond per increment because all eight cores run in parallel without coherence traffic. The adjacent version costs 12 ns per increment because each increment serialises through the bounced line. The factor of ~18-20 is what you should expect on modern x86 8-core machines.

### Step-by-step: how to derive the speedup from first principles

- Cold L1 access: ~1 ns
- `lock xadd` on uncontended line: ~5 ns
- `lock xadd` with one-bouncer contention: ~30 ns
- `lock xadd` with seven-bouncer contention (8 cores, 1 line): ~80-100 ns
- Theoretical floor for 8 independent counters: 1 ns/op (all cores in parallel)

If the *adjacent* benchmark shows ~12 ns/op (averaged over 8 cores' wall-clock-divided ops), this is actually ~100 ns per atomic *on the bouncing core* (since wall clock is amortised over 8 parallel workers — but they are serialised on the line, so they ran for 8x wall clock per op). If the *padded* version shows ~0.6 ns/op, that is ~5 ns per atomic per core in parallel. Speedup = 5 ns vs 100 ns ≈ 20x. The math lines up.

---

## What If My Machine Does Not Show It?

Common reasons the benchmark gap is small:

1. **Single physical core, multiple hyperthreads.** Hyperthreads share L1; their writes are not bouncing across cores at all. Run on a machine with at least 2 *physical* cores.

2. **`GOMAXPROCS=1`.** All goroutines run on one OS thread; no inter-core traffic. Set explicitly or use the default.

3. **Throttling.** Battery-powered laptops throttle aggressively. Run on AC, or use a desktop / server.

4. **JIT-like effects.** Go does no JIT, but the first run may include allocator setup. Warmup is essential.

5. **Background processes.** Other CPU work can disturb measurements. Close everything or use a quiet machine.

6. **Counter overflow.** `iters` × `workers` exceeds `int64` only at extreme values; not a real concern at the demo numbers but worth knowing.

7. **Different cache line size.** Apple M1/M2 has 128-byte lines on some implementations. The Go runtime still uses 64, so a `[56]byte` pad is not enough to fully separate variables. Use `[120]byte` for safety on M-series.

---

## More Worked Code

### Worked Example A: a `Counter` that scales linearly

```go
package counter

import (
    "runtime"
    "sync/atomic"
)

type slot struct {
    v int64
    _ [56]byte
}

type Counter struct {
    shards []slot
}

func New() *Counter {
    n := runtime.GOMAXPROCS(0)
    return &Counter{shards: make([]slot, n)}
}

func (c *Counter) Inc(shard int) {
    atomic.AddInt64(&c.shards[shard%len(c.shards)].v, 1)
}

func (c *Counter) Load() int64 {
    var total int64
    for i := range c.shards {
        total += atomic.LoadInt64(&c.shards[i].v)
    }
    return total
}
```

Usage:

```go
c := counter.New()
c.Inc(int(runtime.GoroutineID() % int64(runtime.GOMAXPROCS(0))))
// later
fmt.Println("total:", c.Load())
```

Note: `runtime.GoroutineID()` is not a public API. Production sharded counters use `runtime_procPin` via `go:linkname` (advanced), or just hash a goroutine-local value. Junior version: take `shard` from the caller.

### Worked Example B: padded ring buffer indexes

```go
package ring

import (
    "sync/atomic"
)

type Ring struct {
    buf  []byte

    head uint64
    _    [56]byte

    tail uint64
    _    [56]byte
}

func New(size int) *Ring {
    return &Ring{buf: make([]byte, size)}
}

func (r *Ring) Push(b byte) bool {
    h := atomic.LoadUint64(&r.head)
    t := atomic.LoadUint64(&r.tail)
    if h-t == uint64(len(r.buf)) {
        return false // full
    }
    r.buf[h%uint64(len(r.buf))] = b
    atomic.StoreUint64(&r.head, h+1)
    return true
}

func (r *Ring) Pop() (byte, bool) {
    t := atomic.LoadUint64(&r.tail)
    h := atomic.LoadUint64(&r.head)
    if t == h {
        return 0, false // empty
    }
    b := r.buf[t%uint64(len(r.buf))]
    atomic.StoreUint64(&r.tail, t+1)
    return b, true
}
```

Producer writes `head`; consumer writes `tail`. Each reads the other for full/empty checks. If `head` and `tail` shared a cache line, every `Push` would bounce the line on the consumer side and vice versa — 2x slowdown easily. With padding, only the *cross-checks* (one read of the other side's index per iteration) cause line moves, and those moves are amortised over many writes per side.

### Worked Example C: padded per-worker stats

```go
package workerstats

type Stats struct {
    Processed  int64
    Failed     int64
    Bytes      int64
    LastTimeNs int64
    _          [24]byte // pad struct to 64 bytes
}

type Pool struct {
    workers []Stats // one slot per worker
}

func NewPool(n int) *Pool {
    return &Pool{workers: make([]Stats, n)}
}
```

Each `Stats` is 4 × 8 + 24 = 56 bytes, plus 8 bytes of "header" overhead... wait, that does not work. Let me redo:

```go
type Stats struct {
    Processed  int64 // 8
    Failed     int64 // 8
    Bytes      int64 // 8
    LastTimeNs int64 // 8
    _          [32]byte // 32 → total 64
}
```

Now `unsafe.Sizeof(Stats{}) == 64`. An array of `Stats` lays each element on its own cache line.

When extending `Stats` with more fields, *adjust the padding* to keep total at 64 (or 128). A unit test makes the contract explicit:

```go
import "unsafe"

func TestStatsSize(t *testing.T) {
    if got, want := unsafe.Sizeof(Stats{}), uintptr(64); got != want {
        t.Fatalf("Stats size = %d, want %d (re-tune padding)", got, want)
    }
}
```

This test fires the moment someone adds a field without updating the padding. Cheap, lifetime-friendly.

---

## Junior-Level Q&A Drills

**Q.** What is the smallest change that fixes a false-sharing-bound counter array?

**A.** Wrap each counter in a struct that pads it to 64 bytes:

```go
// from: var counters [N]int64
// to:
var counters [N]struct {
    v int64
    _ [56]byte
}
```

Access becomes `counters[i].v` instead of `counters[i]`.

---

**Q.** A coworker says "padding wastes memory, just use a mutex." Are they right?

**A.** Partially. A mutex serialises *every* access, so its throughput is independent of core count — but it is much slower than an atomic. Padded atomics scale linearly with cores; a contended mutex does not. For N writers, the padded atomic is roughly N× faster than the mutex. Padding is a memory cost for a throughput gain.

---

**Q.** Why is `sync.Mutex` 8 bytes, but `sync.Pool.local` padded to 128?

**A.** `sync.Mutex` is sized for cold-path usage where false sharing rarely matters (a mutex is either contended — a bigger problem than cache lines — or uncontended, in which case the line is in exclusive state on one core anyway). `sync.Pool.local` is a per-P slot accessed millions of times per second by different cores; padding is essential.

---

**Q.** Does the order of fields in a struct affect false sharing?

**A.** Yes. Two fields written by different goroutines should be separated by at least one cache line of padding. Re-ordering to put hot-write fields next to one another (without padding) makes things worse. The Go compiler does not re-order struct fields; the order you write is the order in memory.

---

**Q.** Can I use `atomic.Int64` (the typed wrapper in Go 1.19+) and still hit false sharing?

**A.** Yes. `atomic.Int64` is an 8-byte struct; two adjacent `atomic.Int64`s pack the same as two `int64`s. The wrapper does not introduce padding. You still need to pad explicitly:

```go
type Padded struct {
    v atomic.Int64
    _ [56]byte
}
```

---

**Q.** What's the easiest way to see false sharing in action without writing benchmarks?

**A.** On Linux, run `perf c2c record ./yourprogram` then `perf c2c report`. The report shows "HITM" hits (modified-line transfers between cores) per source line. False sharing produces high HITM counts. On macOS, Instruments has a "System Trace" template that surfaces similar data.

---

**Q.** Is false sharing the same as cache thrashing?

**A.** Related but different. Cache thrashing is when a working set is larger than the cache, causing constant evictions. False sharing is when *coherence* (not capacity) causes constant invalidations. Both produce miss-rate spikes, but the root cause differs. Capacity misses look like a working-set problem; false-sharing misses look like a contention problem.

---

**Q.** If my cache line is 64 bytes and I want to pad `[3]int32`, how many bytes of padding do I add?

**A.** `[3]int32` is 12 bytes. To reach 64, add `64 - 12 = 52` bytes:

```go
type Padded3Int32 struct {
    a [3]int32
    _ [52]byte
}
```

Or, using `unsafe.Sizeof` for safety against drift:

```go
type body struct{ a [3]int32 }
type Padded3Int32 struct {
    body
    _ [64 - unsafe.Sizeof(body{})%64]byte
}
```

The modulo handles the case where `body` is already larger than 64 (then you pad to the next line).

---

**Q.** I padded my counter and benchmarked, but the speedup is 1.5x not 20x. Why?

**A.** Likely your benchmark is not hot enough (the counter is not the bottleneck), or your goroutines do other work between increments (which dilutes the contention). Try a tighter loop: just `for i := 0; i < N; i++ { atomic.AddInt64(...) }` with no other work. If the gap is still small, you may be running on hyperthreaded cores or a machine with few physical cores.

---

## Extended Walkthrough: From "Slow" to "Fast" in Six Steps

Here is a story-driven walkthrough that mirrors how a junior engineer might encounter false sharing for the first time. The scenario is fictional but composed of patterns I have seen in real codebases.

### Step 1: the suspect benchmark

You wrote a small library that counts HTTP requests by status code:

```go
type Counters struct {
    Status200 int64
    Status400 int64
    Status500 int64
    Other     int64
}

func (c *Counters) Inc(code int) {
    switch code {
    case 200:
        atomic.AddInt64(&c.Status200, 1)
    case 400:
        atomic.AddInt64(&c.Status400, 1)
    case 500:
        atomic.AddInt64(&c.Status500, 1)
    default:
        atomic.AddInt64(&c.Other, 1)
    }
}
```

In a synthetic test, you simulate 8 goroutines each incrementing one specific field many times. To your surprise, the benchmark is *slower* than a version that protects everything with a mutex.

### Step 2: hypothesise the cause

You ask: "Are the atomic operations themselves slow?" You test by replacing with a `sync.Mutex` — the mutex version is faster on 8 cores. That is shocking; atomics are supposed to be cheaper than mutexes for single-variable updates.

A senior engineer suggests: "Print the addresses of those four counters." You do:

```go
fmt.Printf("Status200: %p\n", &c.Status200)
fmt.Printf("Status400: %p\n", &c.Status400)
fmt.Printf("Status500: %p\n", &c.Status500)
fmt.Printf("Other:     %p\n", &c.Other)
```

Output:

```
Status200: 0xc000010040
Status400: 0xc000010048
Status500: 0xc000010050
Other:     0xc000010058
```

The four counters are at offsets 0x40, 0x48, 0x50, 0x58 in the same struct. Cache line containing offset 0x40 is 0x40 (since 0x40 = 64 = one line boundary) through 0x7F. All four counters fall into this one line. The senior says: "False sharing. Four cores writing one line."

### Step 3: the smallest fix

You pad:

```go
type Counters struct {
    Status200 int64
    _         [56]byte
    Status400 int64
    _         [56]byte
    Status500 int64
    _         [56]byte
    Other     int64
}
```

Re-run the benchmark. The atomic version is now 6x faster than the mutex version. The fix took 3 lines of code (or rather, 3 lines of empty bytes).

### Step 4: the post-mortem question

Why was the mutex *faster* before the fix? Because the mutex serialises the writes through one lock, so all 4 cores wait their turn — only one core writes per round. With the unpadded atomic, each of the 4 cores tries to bounce the line independently, all the time, and the coherence traffic dominates. The atomic version actually does *more* work than the mutex version.

The lesson: contention has a structure. Padding shapes how that contention plays out at the hardware level. The wrong layout can make atomics slower than mutexes.

### Step 5: the better refactor

Padding fixed the symptom, but the structure is still ugly. The cleaner version uses a named padding type and groups the counters in an array:

```go
type Padded64 struct {
    v int64
    _ [56]byte
}

type StatusKind int

const (
    Status200 StatusKind = iota
    Status400
    Status500
    Other
    numStatusKinds
)

type Counters struct {
    arr [numStatusKinds]Padded64
}

func (c *Counters) Inc(code int) {
    var k StatusKind
    switch code {
    case 200:
        k = Status200
    case 400:
        k = Status400
    case 500:
        k = Status500
    default:
        k = Other
    }
    atomic.AddInt64(&c.arr[k].v, 1)
}

func (c *Counters) Read(k StatusKind) int64 {
    return atomic.LoadInt64(&c.arr[k].v)
}
```

Each kind is on its own cache line. Adding a new kind is a one-liner.

### Step 6: the assertion

To make sure no one accidentally removes the padding in a future refactor, add a self-test:

```go
import "unsafe"

func init() {
    if unsafe.Sizeof(Padded64{}) != 64 {
        panic("Padded64 must be exactly one cache line")
    }
}
```

This fires at program startup if the struct ever drifts. Cheap insurance against a class of regressions.

---

## A Tiny Catalog of "Looks Wrong But Isn't" Patterns

When learning false sharing, junior engineers sometimes overcorrect. Here are patterns that *look* like they should be false-sharing problems but are not:

### Pattern A: a slice header copied across goroutines

```go
type Job struct {
    data []byte
    id   int
}

// goroutine A reads job.data
// goroutine B reads job.id
```

The `Job` struct is 32 bytes (24-byte slice header + 8-byte int). Two `Job`s would fit on one line, but each goroutine reads *different jobs*, not the same one. If A and B do not write, no false sharing — reads alone never bounce a line.

### Pattern B: a hot string accessed read-only

```go
var (
    greeting = "Hello, World!"
    farewell = "Goodbye, World!"
)
// many goroutines read greeting and farewell
```

The strings are read-only (after the runtime initialisation). Cache lines covering them stay in shared state forever. No coherence traffic.

### Pattern C: a mutex-protected struct

```go
type State struct {
    sync.Mutex
    fieldA int
    fieldB int
}
```

Even if `fieldA` and `fieldB` share a cache line, both are written under the same lock — meaning at most one core writes them at any moment. The line bounces once per critical section, not once per write. The lock is the true serialisation; cache layout is secondary.

### Pattern D: a sync.Once-initialised value

```go
var (
    once sync.Once
    config *Config
)
func GetConfig() *Config {
    once.Do(func() { config = loadConfig() })
    return config
}
```

`config` is written once, read many times. After initialisation, the line containing the pointer is in shared state in every reader's L1. No coherence traffic.

### Pattern E: per-goroutine local variables

```go
go func() {
    var local int64
    for i := 0; i < N; i++ {
        local++
    }
}()
```

Each goroutine's `local` lives on its own stack. Stacks are per-goroutine, and the runtime is careful to not have unrelated goroutines share stack memory. No false sharing.

---

## What the Profiler Will Tell You

Even at junior level, knowing how to *recognise* false sharing in profiler output is useful. Three signals:

### Signal 1: hot atomic operations in `pprof cpu` profile

If `runtime.atomicAddInt64` or `sync/atomic.AddInt64` shows up near the top of a CPU profile, atomics are dominating. That alone is not false sharing — true contention could cause the same. But it is a *candidate*.

```bash
go test -bench BenchmarkCounter -cpuprofile=cpu.prof
go tool pprof cpu.prof
(pprof) top
```

If you see atomic ops occupying > 30% of samples, dig further.

### Signal 2: `perf stat -e cache-misses,L1-dcache-load-misses`

The `cache-misses` event counts coherence-driven misses; `L1-dcache-load-misses` counts capacity- and compulsory-driven misses. If `cache-misses` is high but `L1-dcache-load-misses` is not, the misses are coherence-driven — a strong false-sharing or true-sharing signal.

### Signal 3: `perf c2c`

The definitive tool. It tracks *Cache-to-Cache transfers* (lines being moved between cores). It reports per-source-line HITM (modified-line hits) counts. Lines with high HITM and no obvious shared variable are the smoking gun for false sharing.

We will go deep into `perf c2c` at professional level. At junior level, just know it exists.

---

## A Mental Checklist Before "Just Pad It"

Before you reach for padding, walk through this checklist:

1. **Is the variable hot?** (>100K writes/sec/core) If not, padding is wasted memory.
2. **Are multiple cores writing it?** If only one core writes, padding solves nothing — the line is exclusive on that core.
3. **Are the cores writing *different* variables on the same line?** If yes, padding is the right fix.
4. **Are the cores writing the *same* variable on the line?** If yes, padding does not help — you need sharding or batching.
5. **Will the padding be on the heap or stack?** Heap-allocated padded structs are protected; stack-allocated locals never false-share.
6. **What is the architectural cache line size?** 64 on amd64/arm64; 128 on ppc64 and some Apple M-series.
7. **Have you benchmarked the *unpadded* version?** Without a baseline you cannot prove the fix helped.
8. **Have you re-benchmarked the padded version?** Sometimes padding does not help (e.g., when the bottleneck is elsewhere).
9. **Did you add a `unsafe.Sizeof` test?** Keeps the padding from drifting silently.
10. **Did you comment why the padding exists?** A future reader needs to know.

Going through this list every time prevents two bad outcomes: cargo-culting padding into every struct, and forgetting to pad something hot.

---

## Glossary Extension (Junior+)

| Term | Definition |
|------|-----------|
| **HITM** | "Hit Modified." A cache event where one core requests a line that another core holds in modified state — forcing a writeback or transfer. False sharing produces high HITM counts. |
| **MOESI** | An extension of MESI used by AMD: adds an *Owner* state that lets one core hold a modified line and serve reads to other cores without writing back to memory. Reduces but does not eliminate false-sharing cost. |
| **Bouncing** | Informal term for a cache line repeatedly transferring between cores. Synonymous with "ping-ponging." |
| **Coherence traffic** | The messages exchanged between cores (over the ring/mesh interconnect) to maintain cache coherence. Each bounce adds to this traffic. |
| **Snoop** | A core broadcasting on the interconnect to check the state of a line on other cores. Required before a read or write that may need exclusive ownership. |
| **`atomic.Int64`** | Go 1.19+'s typed atomic wrapper. Equivalent to `int64` for memory layout (8 bytes); offers `Load`, `Store`, `Add`, `CompareAndSwap` methods. |
| **Shard** | One element of a sharded structure. A shard is independent of its siblings and should be on its own cache line. |
| **Cache-line padding** | Adding wasted bytes after a hot field to push neighbours onto another line. The fix for false sharing. |
| **Linear scaling** | Throughput grows in proportion to core count. The ideal for embarrassingly-parallel workloads. False sharing breaks linear scaling. |

---

## Closing Reflection

False sharing is the canonical example of "the hardware is more complicated than the language model." Go's memory model says nothing about cache lines — and rightly so, because the model should be portable across machines with different line sizes. But to write fast Go, you must look past the model to the silicon underneath.

The good news: the fix is mechanical. Identify the hot variable, pad it to one line, re-benchmark. The bad news: knowing *which* variable to pad requires a profiler, a benchmark, and some practice. The skill is not in the syntax; it is in the diagnosis.

At junior level, the goal is just to know that false sharing exists, recognise the simplest pattern (counters in an array), and apply the padding idiom. At middle level (next file), you will see this pattern dozens more times in real production code. At senior and professional, you will design data structures around cache topology from day one.

For now: write the benchmark. Watch the throughput collapse with adjacent counters. Add `[56]byte`. Watch it recover. Burn that into memory. You will use it for the rest of your career.

---

That is the full junior-level treatment of false sharing. The next file (`middle.md`) goes deeper into real-world patterns: production sharded counters, `sync.Pool` internals, when *not* to pad, and how to integrate cache-line awareness into a code review checklist.

---

## Appendix A: The Three Benchmarks Every Junior Should Run

Below are three complete, self-contained benchmark files. Run each on your own machine and record the numbers. After running them, you will have an intuition for false sharing that no amount of reading can give you.

### Benchmark 1: Adjacent counters vs padded counters

```go
package falsesharing_bench

import (
    "sync"
    "sync/atomic"
    "testing"
)

const numCounters = 8

type adjacent struct {
    c [numCounters]atomic.Int64
}

type padded struct {
    slot [numCounters]struct {
        c    atomic.Int64
        _pad [56]byte
    }
}

func BenchmarkAdjacent(b *testing.B) {
    var s adjacent
    var wg sync.WaitGroup
    perGo := b.N / numCounters
    if perGo == 0 {
        perGo = 1
    }
    b.ResetTimer()
    for i := 0; i < numCounters; i++ {
        wg.Add(1)
        go func(idx int) {
            defer wg.Done()
            for j := 0; j < perGo; j++ {
                s.c[idx].Add(1)
            }
        }(i)
    }
    wg.Wait()
}

func BenchmarkPadded(b *testing.B) {
    var s padded
    var wg sync.WaitGroup
    perGo := b.N / numCounters
    if perGo == 0 {
        perGo = 1
    }
    b.ResetTimer()
    for i := 0; i < numCounters; i++ {
        wg.Add(1)
        go func(idx int) {
            defer wg.Done()
            for j := 0; j < perGo; j++ {
                s.slot[idx].c.Add(1)
            }
        }(i)
    }
    wg.Wait()
}
```

Run with:

```
go test -bench=. -benchmem -cpu=8 -count=10 .
```

On a typical amd64 server you should see Padded roughly 4-12x faster than Adjacent. Repeat with `-cpu=1,2,4,8,16` and chart throughput per core. The Adjacent curve will plateau or invert past 2 cores; the Padded curve will rise.

### Benchmark 2: Distance sensitivity

Why `[56]byte` and not `[8]byte` or `[256]byte`? Run a sweep:

```go
package distance_bench

import (
    "sync"
    "sync/atomic"
    "testing"
)

func benchDistance(b *testing.B, dist int) {
    arr := make([]byte, 4096)
    a := (*atomic.Int64)(unsafe.Pointer(&arr[0]))
    c := (*atomic.Int64)(unsafe.Pointer(&arr[dist]))
    var wg sync.WaitGroup
    wg.Add(2)
    half := b.N / 2
    b.ResetTimer()
    go func() {
        defer wg.Done()
        for i := 0; i < half; i++ {
            a.Add(1)
        }
    }()
    go func() {
        defer wg.Done()
        for i := 0; i < half; i++ {
            c.Add(1)
        }
    }()
    wg.Wait()
}

func BenchmarkD8(b *testing.B)   { benchDistance(b, 8) }
func BenchmarkD16(b *testing.B)  { benchDistance(b, 16) }
func BenchmarkD32(b *testing.B)  { benchDistance(b, 32) }
func BenchmarkD56(b *testing.B)  { benchDistance(b, 56) }
func BenchmarkD64(b *testing.B)  { benchDistance(b, 64) }
func BenchmarkD128(b *testing.B) { benchDistance(b, 128) }
func BenchmarkD256(b *testing.B) { benchDistance(b, 256) }
```

You will see a sharp transition at 64 bytes. Below that, both atomics fall on one line and bounce. At and above 64, they sit on different lines and run independently. Beyond 128, on Intel cores with adjacent-line prefetch enabled, the curve flattens further. That is your direct measurement of cache-line size.

### Benchmark 3: Reader-writer asymmetry

False sharing is symmetric when both sides write, but very asymmetric when one side only reads. Run:

```go
func BenchmarkRW(b *testing.B) {
    var a, c atomic.Int64
    _ = unsafe.Sizeof(a) // a and c may share a line; declare adjacent
    var wg sync.WaitGroup
    wg.Add(2)
    half := b.N / 2
    b.ResetTimer()
    go func() {
        defer wg.Done()
        for i := 0; i < half; i++ {
            a.Add(1)
        }
    }()
    go func() {
        defer wg.Done()
        var sink int64
        for i := 0; i < half; i++ {
            sink += c.Load()
        }
        _ = sink
    }()
    wg.Wait()
}
```

The writer is fast in MESI's Modified state until the reader pulls the line into Shared. Every reader Load now downgrades the writer's line, slowing writes. The cost is real even though the reader never writes. Many engineers miss this case.

---

## Appendix B: Padding Idioms (Junior Cheat Sheet)

| Idiom | When to use | Notes |
|-------|-------------|-------|
| `_ [56]byte` after `atomic.Int64` | Single 8-byte hot field, amd64/arm64 | Total 64. Most common. |
| `_ [60]byte` after `atomic.Int32` | Single 4-byte hot field | Rare. |
| `_ [120]byte` after `atomic.Int64` | Intel CPUs with adjacent-line prefetch | Sync.Pool uses 128 total. |
| `_ [56]byte` between two fields, plus `_ [56]byte` trailing | Two hot fields in same struct | "Sandwich" layout. |
| Trailing `_ [N]byte` on a struct in an array | When struct is naturally smaller than a line | Forces array stride = line size. |
| `_ CachePadded` wrapper type | Reusable padding | Define `type CachePadded[T any] struct { v T; _ [N]byte }` (Go 1.18+ generics). |

### Reusable wrapper

```go
type pad64[T any] struct {
    v    T
    _pad [64 - unsafe.Sizeof(*new(T))%64]byte
}
```

Caveat: `unsafe.Sizeof` of a generic `T` is not a compile-time constant prior to Go 1.21; use a hand-sized version per type if compatibility matters.

### Anti-pattern: padding the wrong field

```go
type bad struct {
    hot1 atomic.Int64
    hot2 atomic.Int64 // still on same line as hot1
    _pad [48]byte
}
```

Padding *after* both hot fields does nothing — the two hot fields still false-share. Pad *between* hot fields, not just at the end.

---

## Appendix C: A Reading List for Curious Juniors

These resources cover the same material from different angles. Pick one that matches your learning style.

1. *What Every Programmer Should Know About Memory* by Ulrich Drepper (2007). The canonical reference. Sections 3.3 (cache coherence) and 6.4 (false sharing) are the must-read.
2. *Mechanical Sympathy* blog by Martin Thompson. The phrase "mechanical sympathy" itself was popularised here; the LMAX Disruptor posts go into cache-friendly ring buffers.
3. Intel 64 and IA-32 Architectures Optimization Reference Manual, chapter on memory subsystem.
4. The Go runtime source: `src/runtime/sync_pool.go`, `src/sync/pool.go`, `src/runtime/internal/sys/intrinsics.go`. Search for "cache line."
5. Dave Cheney's 2014 talk "Five things that make Go fast" — section on memory layout.
6. The Vitess and CockroachDB source trees — search for `cacheLineSize` or `pad`.

After reading two of those plus running the three benchmarks above, you have crossed from "I have heard of false sharing" to "I can recognise it in code I read."

---

## Appendix D: Common Junior Mistakes (Patterns to Unlearn)

### Mistake 1: Padding global atomics

```go
var globalCounter atomic.Int64
var _pad [56]byte // useless
```

A package-level variable is not adjacent to "user data" in any predictable way. Padding it has no effect on false sharing because there is nothing reliable next to it. If `globalCounter` is contended *by itself* (not adjacency), padding does not help; you need sharding.

### Mistake 2: Confusing alignment with padding

`unsafe.Alignof(int64(0))` is 8 on amd64. That is alignment, not cache-line alignment. A field with alignment 8 can still start in the middle of a cache line. Padding controls *placement*; alignment controls *minimum offset*.

To force cache-line alignment of a single instance you typically use a struct trick:

```go
type aligned struct {
    _pad0 [64]byte
    val   atomic.Int64
    _pad1 [56]byte
}
```

Or allocate a larger slice and slice off an aligned offset. Go does not have `_Alignas(64)`.

### Mistake 3: Believing `sync.Mutex` is "thread-safe layout"

`sync.Mutex` is exactly 8 bytes (an `int32` + `uint32` on Go 1.22; check the source). Two mutexes in adjacent slice elements share a line. Their state words bounce when contended. This is the same false-sharing problem as adjacent counters — `Mutex` provides exclusion, not layout isolation.

### Mistake 4: Padding inside a 24-hour-cached config struct

```go
type cfg struct {
    refreshInterval time.Duration
    _pad            [56]byte
    pollInterval    time.Duration
}
```

These fields are *read* almost exclusively. False sharing does not occur on read-only lines. Padding wastes 56 bytes and gains nothing. Reserve padding for *frequently written* fields.

### Mistake 5: Forgetting `unsafe.Sizeof` tests

Padding without a test is brittle. A future field added between `atomic.Int64` and `_pad` silently breaks the invariant. Always add:

```go
func TestSlotSize(t *testing.T) {
    var s slot
    if got, want := unsafe.Sizeof(s), uintptr(64); got != want {
        t.Fatalf("slot size: got %d want %d", got, want)
    }
}
```

This one-line test catches a class of subtle regressions that benchmarks may miss for months.

### Mistake 6: Padding stack-local atomics

A function-local `var c atomic.Int64` lives on the goroutine's stack. The stack belongs to one goroutine — no other goroutine accesses it. False sharing requires multi-core writes; stack locals are single-core by construction. Padding here is pure waste.

---

## Appendix E: A Junior-Level Lab

Spend one afternoon on this lab. By the end you will have direct, measured experience with everything in this file.

### Setup

```
mkdir -p ~/labs/falsesharing && cd ~/labs/falsesharing
go mod init falsesharing
```

Create `bench_test.go` containing Benchmarks 1, 2, 3 from Appendix A. Add a `main.go` with an `unsafe.Sizeof` print:

```go
package main

import (
    "fmt"
    "sync/atomic"
    "unsafe"
)

type slot struct {
    c    atomic.Int64
    _pad [56]byte
}

func main() {
    fmt.Println("size of slot:", unsafe.Sizeof(slot{}))
    fmt.Println("size of atomic.Int64:", unsafe.Sizeof(atomic.Int64{}))
}
```

### Tasks

1. Run `go run main.go`. Confirm `slot` is 64 bytes.
2. Run `go test -bench=BenchmarkAdjacent -benchmem -cpu=1,2,4,8 -count=5`. Record ns/op.
3. Run `go test -bench=BenchmarkPadded -benchmem -cpu=1,2,4,8 -count=5`. Record ns/op.
4. Plot throughput (1/ns × cores) for both benchmarks. Observe the divergence.
5. Modify the `_pad` size to `[8]byte`, `[24]byte`, `[40]byte`, `[56]byte`. Re-run for each. Find the threshold where throughput recovers.
6. Add a `unsafe.Sizeof` test that asserts `slot` is 64 bytes. Confirm `go test` runs it. Then add a stray field and watch the test fail.
7. Set `GOMAXPROCS=4` then `GOMAXPROCS=8` and re-run. Note how Adjacent's regression worsens with core count.
8. (Optional) If on Linux with `perf`: `perf stat -e cache-misses,cache-references go test -bench=BenchmarkAdjacent`. Compare to the padded version.

### Deliverable

A short markdown report with:
- Your CPU model (`uname -a`, `lscpu`).
- The four benchmark numbers.
- The distance-sweep table.
- One sentence answering: "What is the smallest padding that recovers throughput on my machine?"

This is the lab I assign junior engineers in their first week of working on hot-path code. It builds reflexes that no documentation can.

---

## Appendix F: The Ten Most Common False-Sharing Sites in Real Go Codebases

These are patterns I have seen flagged or fixed in production code reviews. Memorise them; you will see them again.

1. **`var counters [N]atomic.Int64`** at package level, written by N goroutines (one per index). Classic.
2. **A `[]Worker` slice** where each `Worker` ends with `atomic.Int64 processed`. Adjacent workers' counters share a line.
3. **A `[]struct{ lock sync.Mutex; ... }`** array used as a lock striping scheme. Mutex state words false-share between stripes.
4. **A producer-consumer ring buffer** with `head` and `tail` as adjacent atomic fields in the same struct. Producer writes `tail`, consumer reads `tail` and writes `head`; the line bounces every operation.
5. **A goroutine-local `atomic.Bool stopFlag` in a `[]Worker`**, polled by each worker and set externally. Each external set bounces N lines.
6. **`runtime.GOMAXPROCS(0)`-sized array used as per-P caches**, but without padding. Workers on different Ps clash on adjacency.
7. **A `sync.Map` re-implementation** that backs a `[N]shard` with `Mutex + map[K]V` in each. Sibling shards false-share.
8. **A request rate limiter** with an array of `lastTimestamp atomic.Int64` per route, indexed by hash. Hot routes whose hashes collide on adjacent slots false-share.
9. **A connection pool** with adjacent `idle` and `active` atomics, both written by every connection acquire/release.
10. **A metrics library** with adjacent `count` and `sum` atomic fields, both updated on every Observe.

When you read a PR and see one of these patterns, pause and check. Run the question: *Are two cores writing two adjacent atomics under load?* If yes, pad.

---

## Appendix G: A Final Story

Early in my career I worked on a Go service that processed in-flight aircraft telemetry. The service had a metrics struct with about 30 `atomic.Int64` counters, all in a single flat struct. We ran on a 32-core box. Under load the service was CPU-bound at about 40% of expected throughput.

I spent three days profiling. `pprof` was useless; CPU samples were spread across many functions. I added trace points; nothing stood out. I rewrote the hot path twice; no improvement.

Then a colleague suggested `perf c2c`. We ran it and saw a 200,000 HITM count on the metrics struct, all clustered around a 64-byte region. Twenty counters shared four cache lines. Every update from any goroutine forced every other goroutine to invalidate.

The fix was 30 lines of code: wrap each counter in `struct { v atomic.Int64; _ [56]byte }`. Throughput jumped 2.4x. We shipped on Friday and watched the dashboards. The p99 latency dropped from 12ms to 4ms.

I have told that story to every junior engineer I have mentored. The point: the bug was *invisible* in the source. The variable names were fine. The logic was correct. The bottleneck was in a place no language-level review would have flagged. False sharing lives in the gap between the language and the hardware, and you have to learn to see it.

That is the skill this file has been building. Run the benchmarks. Find the pattern. Pad it. Re-measure. Repeat until it becomes reflex.

---

## Appendix H: Walking Through a Disassembly

Disassembly looks intimidating but is much simpler than you fear. Let us walk through one example so you have a feel for what `atomic.Add` looks like at the machine-code level.

### The Go source

```go
package main

import "sync/atomic"

var counter atomic.Int64

func bump() {
    counter.Add(1)
}

func main() {
    for i := 0; i < 1_000_000; i++ {
        bump()
    }
}
```

### Building and disassembling

```
go build -gcflags='-N -l' -o app main.go
go tool objdump -s "main.bump" app
```

The `-gcflags='-N -l'` flags disable optimisations and inlining, so the disassembly matches the source 1:1. In production builds you would skip these flags, but for learning they make output more readable.

### Output (amd64)

```
TEXT main.bump(SB)
  ; load address of main.counter into AX
  MOVQ $main.counter+0(SB), AX
  ; atomically add 1 to the value at AX
  LOCK XADDQ $1, (AX)
  RET
```

The two key instructions:

- `MOVQ ... AX` — load the address of the global counter variable into register AX. The `+0(SB)` is "offset 0 from the static base"; this is how the linker references a global.
- `LOCK XADDQ $1, (AX)` — atomic exchange-and-add. The `LOCK` prefix tells the CPU to assert exclusive ownership of the cache line containing the destination address; `XADDQ` swaps the immediate `1` with the memory contents and returns the old value (we discard the return). The `Q` suffix indicates 64-bit.

The `LOCK` prefix is *exactly the source of false-sharing pain*. When CPU 0 executes `LOCK XADDQ`, the cache line containing AX must be in M state on CPU 0. If CPU 1 also wants to execute a `LOCK` on a nearby address (within the same line), CPU 1 must take the line away from CPU 0 — that is the bounce.

### Why one instruction is "atomic"

`LOCK XADDQ` is a single x86 instruction that the CPU executes atomically. No interrupt or other core can observe a partial state. The atomicity comes from cache coherence: the LOCK prefix prevents any other agent from accessing the line during the instruction's execution.

This is also why an atomic op is much more expensive than a plain `INCQ` (~10-20 cycles vs 1 cycle). The LOCK forces a barrier and exclusive ownership; both are slow.

### Counterpart: a plain `int64` increment

For comparison:

```go
var plain int64

func bumpPlain() {
    plain++
}
```

Disassembles to:

```
TEXT main.bumpPlain(SB)
  INCQ main.plain+0(SB)
  RET
```

`INCQ` without `LOCK`. ~1 cycle. No coherence guarantees: if two goroutines call `bumpPlain` concurrently, you get a torn or lost increment. But there is no false sharing because there is no LOCK.

### Implications for false sharing

The cost of `LOCK XADDQ` depends entirely on the cache-line state:
- Line in M on this core: ~10-20 cycles. Fast path.
- Line in S or E: minor cost to upgrade to M, ~20-30 cycles.
- Line in I (we don't have it): ~100-300 cycles to fetch. The bounce.

False sharing makes every increment fall into the "I" case because the *other* core's writes invalidated our line. The fix (padding) ensures the line stays in M on our core.

This is the entire mechanical story, condensed: padding keeps your line on your core; without padding, the line ping-pongs.

---

## Appendix I: A Day in the Life of a Cache Line

A storytelling exercise. Follow one cache line through one second of an unpadded sharded-counter workload. Numbers are illustrative for a 3 GHz CPU with 100ns cross-core transfer.

### Setup

Two goroutines G0 (on core 0) and G1 (on core 1). They share variable `arr [2]atomic.Int64`. `arr[0]` is at byte 0 of the line, `arr[1]` at byte 8. Both increment their own index in a tight loop.

### Microsecond 0

- Line is in M on core 0 (recently written).
- G0 issues `LOCK XADDQ` on `arr[0]`. Line is already M. Cost: ~10 cycles (~3ns).
- G1 issues `LOCK XADDQ` on `arr[1]`. Line is in I on core 1. Core 1 sends "Read for Ownership" (RFO) to core 0. Core 0 responds with line contents + transition M->I. Total transfer: ~100ns.
- After transfer: line is M on core 1. G1's `LOCK XADDQ` completes.

### Microsecond 1

- G1 issues another `LOCK XADDQ` on `arr[1]`. Line is M on core 1. Cost ~3ns.
- G0 issues `LOCK XADDQ` on `arr[0]`. Line is in I on core 0. RFO to core 1. Transfer ~100ns. Line is now M on core 0.

### Microseconds 2 to 1,000,000

This pattern continues. Each microsecond, each core gets ~1 successful op and waits 100ns for the next bounce. Effective throughput: 1 op per 100ns per core = 10M ops/sec/core, regardless of how many cores you add.

Compare to the *padded* version where each core has its own line: each core does ~1 op per 3ns = 333M ops/sec/core. Linear scaling.

The story: false sharing turns a 333M-op-per-second workload into a 10M-op-per-second workload. 33x throughput loss. Realistic for hot counters.

### Visualizing in time

```
core 0: |op|wait----|op|wait----|op|wait----|
core 1:        |op|wait----|op|wait----|op|

Each "|op|" is ~3ns. Each "wait----" is ~100ns.
```

Each core gets one op every 100ns. The pattern is forced: while one core has the line, the other waits.

This story is what `perf c2c` actually measures and visualises. The "HITM" event is one bounce. Counting them tells you exactly how many of these wait periods happened during the recording.

---

## Appendix J: Why This Matters Outside Counters

Counters are the easy example. But the same hardware behaviour affects many seemingly-unrelated parts of your code. Junior engineers often think "I do not use atomic counters in arrays, so I am safe." This is wrong. Examples:

### Hash table buckets

A custom hash table with `bucket [N]struct { lock sync.Mutex; ... }` puts adjacent locks in adjacent slots. Concurrent operations on different buckets bounce the lock-state lines.

### Worker pools

`workers [N]Worker` where `Worker` has internal `atomic.*` state. Adjacent workers bounce.

### Request rate limiters

`limiter [N]TokenBucket` indexed by client. Hot clients next to cold clients still bounce because adjacency is in memory, not in semantic load.

### Per-connection state

A long-lived connection's `lastSentSeq atomic.Uint64` lives in a struct. If many connections' structs are allocated near each other and updated concurrently, they bounce.

### Channel of channels

`channels [N]chan T` where channels are concurrently sent on. Adjacent channels' `hchan` headers may share lines.

### Wait groups

A `WaitGroup`'s internal counter is one `atomic.Uint64`. A struct that embeds many WaitGroups (rare but exists) places their counters close together.

### Atomic pointers

`pointers [N]atomic.Pointer[T]`. Each pointer is 8 bytes; 8 fit in a line. Concurrent updates bounce.

### Compiler-generated atomic variables

The Go compiler may insert atomics for sync.Once.Do internals, panic recovery markers, etc. You do not control these layouts directly, but their presence inflates the chance of accidental adjacency.

### Mental shift

The pattern is: any time multiple goroutines write *different* addresses that happen to fall on the *same* line, you have potential false sharing. The variables can be named anything; what matters is their *physical placement* in memory.

A junior who has internalised this question — "what falls on the same line as my hot variable?" — will catch false sharing across many seemingly-different code patterns. The question is more important than any specific fix.

---

## Appendix K: Quick Reference Card

Print this and tape it to your monitor for the first month of practising false sharing.

### When to suspect false sharing

- Throughput plateaus or regresses with more cores.
- Atomic operations dominate CPU profile but the rate seems low.
- p99 latency variance is high for simple operations.
- Cache miss counters are elevated but L1 miss rate is normal.

### Quick fixes

```go
// Single hot field, isolate it.
type slot struct {
    v    atomic.Int64
    _pad [56]byte
}

// Two hot fields, separate them.
type pair struct {
    a    atomic.Int64
    _pad [56]byte
    b    atomic.Int64
}

// Reusable wrapper.
type CachePadded[T any] struct {
    v   T
    pad [128 - unsafe.Sizeof(*new(T))%128]byte
}
```

### Cache line sizes

- amd64, arm64: 64 bytes.
- ppc64, Apple M-series: 128 bytes.
- Intel adjacent-line prefetch: pad to 128.

### Required tests

```go
func TestSlotSize(t *testing.T) {
    if got := unsafe.Sizeof(slot{}); got != 64 {
        t.Fatalf("slot size: got %d want 64", got)
    }
}
```

### Required benchmark

```go
func BenchmarkX(b *testing.B) {
    var s slotArray
    b.RunParallel(func(pb *testing.PB) {
        i := 0
        for pb.Next() {
            s[i%len(s)].v.Add(1)
            i++
        }
    })
}
```

Run with `-cpu=1,2,4,8` to see scaling.

### Diagnostic tools

- `pprof -mutex`, `pprof -block` (Go).
- `perf stat -e cache-misses,cache-references` (Linux).
- `perf c2c record/report` (Linux, definitive).
- `go test -bench -cpu=1,2,4,8` (scaling).

That is the junior-level survival kit. Carry it; use it; refine it with experience.

End of junior level.


