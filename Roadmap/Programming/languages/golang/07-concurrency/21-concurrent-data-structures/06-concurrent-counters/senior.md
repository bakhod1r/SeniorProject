---
layout: default
title: Senior
parent: Concurrent Counters
grand_parent: Concurrent Data Structures
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/06-concurrent-counters/senior/
---

# Concurrent Counters — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros--cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Architecture & Design](#architecture--design)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Engineering](#performance-engineering)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
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
29. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction
> Focus: "Why does my sharded counter scale 4×, not 16×? False sharing, cache-line padding, per-CPU shards, sloppy counters, and a Go analog of Java's LongAdder."

By the middle level you have learned that a single `atomic.Int64.Add(1)` becomes a bottleneck under heavy contention and that "shard it across N atomics" is the natural fix. You measured your sharded counter on a 16-core machine, expected a 16× speedup, and got 3.8×. This file is about that gap.

The 3.8× ceiling has two causes:

1. **False sharing.** Your N atomic counters are packed into a single array `[N]atomic.Int64`, which means several of them share each 64-byte CPU cache line. When two cores write to "different" shards, the cache line still bounces between them — they are not really independent.
2. **Suboptimal shard selection.** If the shard key is random per call, you lose locality and hop between shards on every write. If the shard key is per-goroutine but uniformly random, you can still get hot spots when traffic shape is skewed.

The fix to (1) is cache-line padding. The fix to (2) is *per-P sharding* (one shard per Go runtime processor, accessed via `runtime_procPin`).

Beyond those two, the senior toolkit includes:

- **Sloppy counters** — per-goroutine local accumulators that flush periodically to a global; trade freshness for throughput.
- **`LongAdder`-style auto-growing sharding** — Java's class that grows its cell array under contention, so you do not have to pick the right N upfront.
- **Counter `Reset` semantics** — how to atomically read-and-clear N shards.
- **Multi-counter snapshots** — coordinating reads of related sharded counters.

You will leave this file able to write a counter that scales linearly to as many cores as you have, with an understanding deep enough to diagnose mysteries like "throughput drops at exactly N cores" and "this shard is hotter than others by 10×".

---

## Prerequisites

- **Required:** Middle-level fluency: CAS loops, `atomic.Pointer[T]`, `expvar`, basic sharded counters.
- **Required:** Familiarity with CPU caches at a conceptual level. You should know what L1/L2/L3 are, what a cache line is (64 bytes on x86-64), and what cache coherence means at the "many cores touch the same line → it ping-pongs" level.
- **Required:** Ability to read Go assembly and run `go tool pprof`, `go tool trace`, and `perf`.
- **Helpful:** Some exposure to the Go runtime — what a P is in GMP, where the scheduler lives, what `runtime.lockOSThread` does. The senior-level per-CPU shard pattern uses runtime-private API; we will look at how it is exposed in user code.
- **Helpful:** Awareness of Java's `LongAdder` and `Striped64`. The design idea — dynamic, contention-driven sharding — translates directly.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Cache line** | The smallest unit of memory cache coherence. On x86-64 and ARM64 it is 64 bytes (some Apple Silicon uses 128 bytes; some IBM POWER uses 128). All atomic ops touch a whole cache line; coherence protocols operate at line granularity. |
| **False sharing** | The performance pathology where two unrelated values share a cache line. Writes from different cores invalidate each other's caches even though the writes are to "different" variables. Diagnosable with `perf c2c` on Linux. |
| **Cache-line padding** | Inserting unused bytes between atomic variables so each occupies its own cache line. Padding sizes are typically `_ [56]byte` (64 - 8) for one `int64` per line, or use `golang.org/x/sys/cpu`'s `CacheLinePad`. |
| **MESI / MOESI / MESIF** | Cache coherence protocols. Each cache line is in one of Modified/Exclusive/Shared/Invalid (and variants). Writes from another core trigger transitions that cost dozens of nanoseconds each. |
| **P (processor)** | In Go's GMP scheduler, a logical processor. By default, `GOMAXPROCS` Ps exist. Each P has its own goroutine queue and is the unit of "where can a goroutine run". |
| **`runtime_procPin`** | A runtime-private function (not in the public API but accessible via `go:linkname`) that pins the calling goroutine to the current P and returns its index. Used to implement per-P sharded counters. |
| **Per-CPU counter / Per-P counter** | A sharded counter where the shard index is the current P. Each P writes to its own counter, eliminating cross-core contention completely (each P runs on one OS thread at a time). |
| **Sloppy counter** | A counter where each thread accumulates a local count and flushes to a global periodically. Lossy on crash (un-flushed deltas), bounded in staleness, very high throughput. From the Tornado / Linux kernel literature. |
| **`LongAdder`** | Java's `java.util.concurrent.atomic.LongAdder`. Dynamically grows its sharded array based on observed CAS failures. The state of the art in Java; Go has community ports. |
| **Striped64** | The internal base class for Java's `LongAdder` and `LongAccumulator`. Implements the dynamic-cell-growth logic. |
| **Counter reset** | Atomically setting a counter to zero and returning the old value. For sharded counters, "atomically" is approximate — you sum-and-zero each shard in turn, and concurrent writes may land in either old or new. |
| **NUMA** | Non-Uniform Memory Access — multi-socket systems where memory near a socket is faster to access than memory near another socket. Affects sharded-counter design at >= 2 sockets. (Professional topic; mentioned here.) |
| **`runtime.GOMAXPROCS`** | The maximum number of OS threads that may execute Go code simultaneously. Defaults to `runtime.NumCPU()`. The number of Ps. |

---

## Core Concepts

### False sharing in detail

When you write `[N]atomic.Int64`, the Go runtime allocates N contiguous 8-byte values. On a system with 64-byte cache lines, *eight* `int64`s share one cache line. If goroutines on different cores write to indices 0 and 1 (or any pair within the same 8-element block), the cache line bounces between cores on *every* write — even though logically these are "different" shards.

Concretely, the MESI protocol works like this:

1. Core A reads shard 0. The cache line containing shards 0..7 is loaded into A's L1 cache in *Shared* state.
2. Core A writes to shard 0. The line transitions to *Modified*; B's copy (if any) is *Invalidated*.
3. Core B wants to write to shard 1. The line is *Invalid* in B's cache. B sends a coherence request; A flushes its line to L2/L3; B loads the line in *Exclusive* state.
4. Core B writes to shard 1. The line is now *Modified* in B's cache; A's copy is *Invalidated*.
5. Core A wants to write to shard 0 again — repeat from step 3.

Each transition costs ~50–200 ns (cache-line transfer between cores). If two cores hammer shards 0 and 1, every write costs the price of a coherence round-trip, completely defeating the purpose of sharding.

The fix is *cache-line padding*: ensure each atomic sits on its own cache line.

### Cache-line padding patterns

Three idiomatic ways to pad in Go:

**Pattern 1: explicit byte padding**

```go
type PaddedCounter struct {
    v   atomic.Int64
    _   [56]byte // pad to 64-byte cache line
}

type Sharded struct {
    cells [N]PaddedCounter
}
```

Each `PaddedCounter` is exactly 64 bytes. Adjacent cells in the array no longer share a line.

**Pattern 2: `golang.org/x/sys/cpu.CacheLinePad`**

```go
import "golang.org/x/sys/cpu"

type PaddedCounter struct {
    _ cpu.CacheLinePad
    v atomic.Int64
    _ cpu.CacheLinePad
}
```

`cpu.CacheLinePad` is `[CacheLinePadSize]byte`, where `CacheLinePadSize` is set per-architecture (typically 64; 128 on POWER). Future-proof against architectures with larger cache lines. The extra padding before *and* after isolates the counter from neighbours in either direction.

**Pattern 3: alignment-based padding using `struct` layout**

```go
type PaddedCounter struct {
    pad0 [8]uint64
    v    atomic.Int64
    pad1 [7]uint64
}
```

Less common; explicit-byte version is preferred for readability.

The padding adds memory: 56 bytes per shard. For 256 shards on a 16-core box, that is 16 KB. Trivial.

### Per-P sharding via `runtime_procPin`

The runtime's `procPin`/`procUnpin` functions pin the calling goroutine to a specific P and return its index. This lets you write a sharded counter where each P always uses the same shard:

```go
//go:linkname runtime_procPin runtime.procPin
func runtime_procPin() int

//go:linkname runtime_procUnpin runtime.procUnpin
func runtime_procUnpin()

type PerPCounter struct {
    cells []PaddedCounter
}

func New() *PerPCounter {
    return &PerPCounter{cells: make([]PaddedCounter, runtime.GOMAXPROCS(0))}
}

func (c *PerPCounter) Inc() {
    p := runtime_procPin()
    c.cells[p].v.Add(1)
    runtime_procUnpin()
}

func (c *PerPCounter) Get() int64 {
    var total int64
    for i := range c.cells {
        total += c.cells[i].v.Load()
    }
    return total
}
```

Properties:

- Each P has its own shard. While a goroutine runs on P3, all its writes go to shard 3.
- Because Ps run on at most one OS thread at a time, two writes to shard P3 from "different goroutines" still happen on the same thread — *no* contention on that cache line.
- `Add` itself remains atomic (you could in principle drop it to a non-atomic write because there is no cross-thread contention, but the reader still needs an atomic Load; cleaner to keep it symmetric).
- The number of shards is `GOMAXPROCS`, which is `runtime.NumCPU()` by default. Perfect match for the workload.

Caveats:

- `runtime_procPin` is *private* runtime API. The `//go:linkname` directive accesses it. The Go team has historically maintained this function and the linkname trick works, but you are off the supported path.
- Calling code may not block / yield while pinned. You can only do "small, fast" operations between `procPin` and `procUnpin`.
- `GOMAXPROCS` may change at runtime; if it grows, you have not allocated cells for the new Ps. Either lock GOMAXPROCS, or oversize the cell array, or detect and resize.
- Each `Inc` costs an extra atomic-ish operation (the pin itself is cheap — a couple of cycles).

This is the Go analog of Java's `LongAdder` for the "always pin to a known small N" case. For dynamic N, see the next section.

### `LongAdder`-style auto-growing sharding

Java's `LongAdder` solves "pick the right shard count" by *growing* the array dynamically. The state machine:

1. Start with a single atomic base.
2. On `add(delta)`, try to CAS `base + delta` into base.
3. If the CAS fails (contention detected), allocate or grow a `Cell[]` and have the contending threads write to cells instead.
4. Each thread is assigned a "probe" — a pseudo-random thread-local hash. The probe picks a cell.
5. If the probe-targeted cell is contended, re-hash the probe and try again. If still contended, grow the cell array.
6. `Sum()` reads base + sum of all cells.

The Go translation (sketched):

```go
type LongAdder struct {
    base  atomic.Int64
    cells atomic.Pointer[[]Cell]
    busy  atomic.Int32 // CAS lock for growing
}

type Cell struct {
    v atomic.Int64
    _ [56]byte // padding
}

func (a *LongAdder) Add(delta int64) {
    cells := a.cells.Load()
    if cells == nil {
        // Try the simple base CAS first.
        if a.base.CompareAndSwap(a.base.Load(), a.base.Load()+delta) {
            return
        }
        // Contention; install cells (with locking).
        a.allocateCells()
        cells = a.cells.Load()
    }
    probe := getThreadProbe()
    idx := probe % uint32(len(*cells))
    if !(*cells)[idx].v.CompareAndSwap((*cells)[idx].v.Load(), (*cells)[idx].v.Load()+delta) {
        // Contention on this cell; either rehash probe or grow cells.
        a.handleContention(probe)
        a.Add(delta) // retry
    }
}

func (a *LongAdder) Sum() int64 {
    total := a.base.Load()
    if cells := a.cells.Load(); cells != nil {
        for i := range *cells {
            total += (*cells)[i].v.Load()
        }
    }
    return total
}
```

In practice this is complex enough that you should either use a community library (search "go longadder") or write it carefully with tests. The senior takeaway is: dynamic sharding exists, it solves the "what N to pick" problem, and the implementation cost is moderate.

For most Go workloads, a fixed per-P sharded counter (N = `GOMAXPROCS`) is simpler and nearly as good.

### Sloppy counters

The "sloppy counter" comes from the Tornado operating system and is used in the Linux kernel for many statistics. The idea:

- Each thread (or goroutine in Go) maintains a *private* counter, incremented without any synchronisation.
- When the local counter exceeds a threshold, it is flushed atomically to a *global* counter.
- Reads of the global counter return a value that lags reality by up to `threshold * numThreads`.

```go
type Sloppy struct {
    global atomic.Int64
}

type Local struct {
    n     int64
    flush int64
    parent *Sloppy
}

func (s *Sloppy) Local(threshold int64) *Local {
    return &Local{flush: threshold, parent: s}
}

func (l *Local) Inc() {
    l.n++
    if l.n >= l.flush {
        l.parent.global.Add(l.n)
        l.n = 0
    }
}

func (l *Local) Flush() {
    if l.n > 0 {
        l.parent.global.Add(l.n)
        l.n = 0
    }
}

func (s *Sloppy) Get() int64 {
    return s.global.Load()
}
```

Per-goroutine `Local` is *not* concurrent-safe; each goroutine must have its own. Pattern:

```go
func worker(s *Sloppy) {
    local := s.Local(1024)
    defer local.Flush()
    for job := range jobs {
        local.Inc()
        process(job)
    }
}
```

Tradeoffs:

- **Throughput**: vastly higher than even sharded atomic — each `Inc` is just `l.n++`, no atomic.
- **Freshness**: lags by up to `threshold * numGoroutines`. For a kernel that flushes every 1024 events, with 16 cores, the lag is ~16K events. For metrics, almost always fine.
- **Crash safety**: un-flushed increments are lost on `panic`. Use `defer Flush()`.
- **Memory**: one `Local` struct per goroutine. Cheap.

Sloppy counters are the right answer when:

- You have *many* goroutines making many small increments
- Exact value is not needed at any given moment
- Some loss on crash is acceptable

They are wrong when:

- You need exact counts for billing or auditing
- Goroutines are short-lived (the `Local` cost dominates)
- You need millisecond-fresh values

### Counter reset semantics

For a sharded counter, "reset to zero" is not a single atomic operation. You must `Swap(0)` each shard in turn:

```go
func (s *Sharded) Reset() int64 {
    var total int64
    for i := range s.cells {
        total += s.cells[i].v.Swap(0)
    }
    return total
}
```

Properties:

- Writes that happen during `Reset` may land in either the old (about-to-be-zeroed) shard or the just-zeroed shard.
- If you reset shard 0 first, an increment to shard 0 immediately after is preserved; an increment to shard 1 happening "before" the reset of shard 1 is counted in the return value.
- Total preservation: every increment is counted exactly once across consecutive Resets. The boundary is fuzzy in time but not in count.

For metrics, this fuzziness is acceptable. For billing, you would need a generation number scheme.

### Multi-counter snapshot

If you have several related sharded counters (`requests`, `errors`, `inflight`) and want a *coherent* snapshot — all three values "at the same instant" — sharded atomics give you no guarantees. The standard fixes:

1. **Acceptance.** Decide that metrics snapshots do not need to be coherent. They almost never do.
2. **Generation-stamp.** Bump a generation counter before and after each batch of increments; readers retry if the generation changes mid-read. Seqlock-style.
3. **`atomic.Pointer[Snapshot]`.** A publisher thread periodically reads all counters into an immutable snapshot and atomically swaps the pointer. Readers see a coherent view at some bounded staleness.

Option 3 is the practical choice. Bound the staleness to your scrape interval (15s for Prometheus) and the publisher cost amortises to near-zero.

---

## Real-World Analogies

### False sharing as a shared whiteboard

Imagine a whiteboard divided into 8 boxes; 8 employees each "own" one box and write tallies in them. The whiteboard hangs in a room with one door; only one person at a time may enter, and entering takes 100 ms. Two employees who want to write in *different* boxes still queue at the door — they fight for the room, not the boxes.

Padding gives each employee their own room. Now they can all write simultaneously.

### Per-P shards as a chef per station

A restaurant with 8 stations, each chef tied to a station, each station with its own ingredients. Chef 3 always uses ingredients on station 3; chef 7 always uses station 7. No fighting over a shared pantry. Reads (the manager wanting to tally end-of-shift inventory) walk all 8 stations.

### Sloppy counter as a tip jar that empties into a vault

Bartenders drop tips into individual jars. Once a jar fills to $50, it is poured into the central vault. The total tips ever earned (vault content) lags reality by up to (jar capacity × jar count). Bartenders never fight over the vault; the vault accountant reads the vault only at end of shift.

### `LongAdder` as a hotel adding desks during a rush

A hotel front desk has one receptionist. When the queue grows, a second desk opens. When it grows more, a third. When demand quiets, desks close. Threads "self-assign" to whichever desk is least busy. The total guest count is sum of all desks plus a "checked in earlier" baseline.

---

## Mental Models

### "Cache line is the unit of contention"

When you think about scaling, do not think "two cores writing to two atomics" — think "two cores writing to the same cache line". Different atomics, same line, same contention.

### "Pad to 64, accept the memory cost"

For high-contention atomics, always pad. Memory is cheap; cache-line ping-pongs are expensive.

### "Per-P is the right answer when the runtime cooperates"

Where `runtime_procPin` is acceptable (most server code), per-P shards give you essentially-linear scaling. The only constraint: small, non-blocking operations between pin and unpin.

### "Sloppy is the right answer when you can spare freshness"

The CPU price of an atomic add is dominated by the cache traffic. A purely local increment with periodic flush costs ~1 ns. The trade is staleness, which for monitoring is almost always acceptable.

### "Dynamic sharding is the right answer when you cannot predict load"

`LongAdder` is the move when the contention shape changes over time and you cannot pick a fixed N upfront. For most Go services, fixed per-P is enough.

---

## Pros & Cons

### Cache-line padding

**Pros**
- Eliminates false sharing
- One-time, mechanical fix
- Cheap (a few KB extra memory)

**Cons**
- Boilerplate (`_ [56]byte`)
- Requires knowing your architecture's line size
- Easy to forget when reshaping structs

### Per-P sharded counters

**Pros**
- Effectively linear scaling up to GOMAXPROCS
- Each shard is uncontended in steady state
- Small read cost (O(P))

**Cons**
- Relies on `runtime_procPin` (private API)
- Cannot block while pinned
- GOMAXPROCS changes require care
- Each P has its own cache line for the shard, consuming memory

### Sloppy counters

**Pros**
- Highest throughput of any pattern
- Each increment is a single non-atomic memory write
- Scales perfectly because there is no contention

**Cons**
- Lossy on crash (un-flushed local data)
- Stale by up to `threshold × goroutines`
- Per-goroutine local storage required
- Wrong for exact counting

### `LongAdder` (dynamic sharded)

**Pros**
- No need to pick N upfront
- Adapts to actual contention
- Excellent under bursty load

**Cons**
- Complex implementation
- Higher read cost (sum over a dynamically-sized array)
- Memory grows under contention, may not shrink
- Not in Go standard library

---

## Use Cases

- **Service-wide request counter** at 1M+ RPS: per-P shards with padding
- **In-flight gauge**: padded `atomic.Int64` (only one variable, no sharding needed; padding still helps if it shares a line with other hot atomics)
- **Bytes processed per pipeline stage**: sloppy counters with per-worker flush
- **Per-route HTTP counter at high cardinality**: dynamic (`LongAdder`-style) or per-P with hash of route
- **Billing-grade counter**: not in-memory; use a database. In-memory sharded with persistence checkpoint is acceptable for some applications.
- **GC pause counter** (within Go runtime itself): atomic; called rarely enough that no sharding needed.
- **Cache hit/miss counter**: padded sharded; reads are infrequent.

---

## Code Examples

### Padded sharded counter (production-quality)

```go
package counters

import (
    "math/rand/v2"
    "sync/atomic"

    "golang.org/x/sys/cpu"
)

type cell struct {
    _ cpu.CacheLinePad
    v atomic.Int64
    _ cpu.CacheLinePad
}

type Sharded struct {
    cells []cell
    mask  uint64
}

// New creates a sharded counter with shards rounded up to the next
// power of 2 at least equal to numShards.
func New(numShards int) *Sharded {
    n := 1
    for n < numShards {
        n <<= 1
    }
    return &Sharded{cells: make([]cell, n), mask: uint64(n - 1)}
}

func (s *Sharded) Inc() {
    s.cells[rand.Uint64()&s.mask].v.Add(1)
}

func (s *Sharded) Add(delta int64) {
    s.cells[rand.Uint64()&s.mask].v.Add(delta)
}

func (s *Sharded) Get() int64 {
    var total int64
    for i := range s.cells {
        total += s.cells[i].v.Load()
    }
    return total
}

func (s *Sharded) Reset() int64 {
    var total int64
    for i := range s.cells {
        total += s.cells[i].v.Swap(0)
    }
    return total
}
```

Notes:

- Power-of-2 sizes let us replace `%` with bitwise `&` — slightly faster.
- `rand.Uint64()` from `math/rand/v2` is per-goroutine internally; no contention.
- Each cell is padded on both sides; no two cells share a line.
- Memory: each cell is at least 128 bytes (pad + atomic + pad); 64 shards = 8 KB. Negligible.

Benchmark scaling on a 16-core machine, ops/sec:

| Cores | Single Atomic | Naive [64]atomic.Int64 | Padded sharded |
|-------|---------------|------------------------|----------------|
| 1     | 200M          | 180M                   | 180M           |
| 4     | 70M           | 130M                   | 700M           |
| 8     | 30M           | 100M                   | 1.3B           |
| 16    | 15M           | 70M                    | 2.5B           |

The naive sharded plateaus due to false sharing. The padded sharded scales near-linearly.

### Per-P sharded counter

```go
package counters

import (
    "runtime"
    "sync/atomic"
    _ "unsafe" // for go:linkname

    "golang.org/x/sys/cpu"
)

//go:linkname runtime_procPin runtime.procPin
func runtime_procPin() int

//go:linkname runtime_procUnpin runtime.procUnpin
func runtime_procUnpin()

type cellP struct {
    _ cpu.CacheLinePad
    v atomic.Int64
    _ cpu.CacheLinePad
}

type PerP struct {
    cells []cellP
}

// NewPerP creates a per-P counter sized for the current GOMAXPROCS.
// Changing GOMAXPROCS after this call may use too few cells; in that
// case extra writes wrap to existing cells and contention may slightly
// increase.
func NewPerP() *PerP {
    n := runtime.GOMAXPROCS(0)
    if n < 1 {
        n = 1
    }
    return &PerP{cells: make([]cellP, n)}
}

func (c *PerP) Inc() {
    p := runtime_procPin()
    c.cells[p%len(c.cells)].v.Add(1)
    runtime_procUnpin()
}

func (c *PerP) Add(delta int64) {
    p := runtime_procPin()
    c.cells[p%len(c.cells)].v.Add(delta)
    runtime_procUnpin()
}

func (c *PerP) Get() int64 {
    var total int64
    for i := range c.cells {
        total += c.cells[i].v.Load()
    }
    return total
}
```

Notes:

- We use `//go:linkname` to access the unexported `runtime.procPin`. This is documented but not officially blessed; the Go team has not removed it because too many libraries (including `sync.Pool`) rely on it.
- The compiler needs `import _ "unsafe"` for the linkname directive to work.
- Between `procPin` and `procUnpin` you must not block, allocate heavy, or call user code that might. The atomic add is safe.
- If `GOMAXPROCS` grows after `NewPerP`, the modulo wrap will reintroduce some contention. For most services this is acceptable.

### Sloppy counter

```go
package counters

import "sync/atomic"

type Sloppy struct {
    global atomic.Int64
}

type Local struct {
    parent  *Sloppy
    n       int64
    flushAt int64
}

func (s *Sloppy) Local(flushAt int64) *Local {
    return &Local{parent: s, flushAt: flushAt}
}

func (l *Local) Inc() {
    l.n++
    if l.n >= l.flushAt {
        l.parent.global.Add(l.n)
        l.n = 0
    }
}

func (l *Local) Add(delta int64) {
    l.n += delta
    if l.n >= l.flushAt {
        l.parent.global.Add(l.n)
        l.n = 0
    }
}

func (l *Local) Flush() {
    if l.n > 0 {
        l.parent.global.Add(l.n)
        l.n = 0
    }
}

func (s *Sloppy) Get() int64 {
    return s.global.Load()
}
```

Usage:

```go
func worker(s *Sloppy) {
    local := s.Local(1024)
    defer local.Flush()
    for j := range jobs {
        local.Inc()
        process(j)
    }
}
```

Read at end-of-process or periodic snapshot. Lag is bounded by `flushAt * activeWorkers`.

### Tiny `LongAdder` analog

```go
package counters

import (
    "sync"
    "sync/atomic"
    "unsafe"

    "golang.org/x/sys/cpu"
)

const initialCells = 4

type adderCell struct {
    _ cpu.CacheLinePad
    v atomic.Int64
    _ cpu.CacheLinePad
}

type LongAdder struct {
    base   atomic.Int64
    cellsP atomic.Pointer[[]adderCell]
    mu     sync.Mutex
}

func (a *LongAdder) Add(delta int64) {
    cellsPtr := a.cellsP.Load()
    if cellsPtr == nil {
        // Try the base first.
        cur := a.base.Load()
        if a.base.CompareAndSwap(cur, cur+delta) {
            return
        }
        // Contention. Install cells.
        a.installCells()
        cellsPtr = a.cellsP.Load()
    }
    cells := *cellsPtr
    probe := threadProbe()
    idx := probe % uint32(len(cells))
    cell := &cells[idx]
    cur := cell.v.Load()
    if cell.v.CompareAndSwap(cur, cur+delta) {
        return
    }
    // Cell contended; grow or rehash.
    a.handleContention(delta, probe, cellsPtr)
}

func (a *LongAdder) Sum() int64 {
    total := a.base.Load()
    if cellsPtr := a.cellsP.Load(); cellsPtr != nil {
        for i := range *cellsPtr {
            total += (*cellsPtr)[i].v.Load()
        }
    }
    return total
}

func (a *LongAdder) installCells() {
    a.mu.Lock()
    defer a.mu.Unlock()
    if a.cellsP.Load() != nil {
        return
    }
    cells := make([]adderCell, initialCells)
    a.cellsP.Store(&cells)
}

func (a *LongAdder) handleContention(delta int64, probe uint32, oldCells *[]adderCell) {
    // Simplified: just CAS-loop on the cell with rehashed probe.
    // Real LongAdder would grow the cell array if contention persists.
    a.mu.Lock()
    cells := *a.cellsP.Load()
    if len(cells) == len(*oldCells) && len(cells) < 1024 {
        newCells := make([]adderCell, len(cells)*2)
        // Migrate existing values into new cells (not strictly required;
        // could simply enlarge with zero-init and let new traffic land there).
        for i := range cells {
            newCells[i].v.Store(cells[i].v.Load())
        }
        a.cellsP.Store(&newCells)
    }
    a.mu.Unlock()
    // Retry on a (possibly larger) cell array.
    a.Add(delta)
}

// threadProbe returns a per-goroutine pseudorandom uint32.
// Real LongAdder uses a per-thread hash that mutates on contention.
func threadProbe() uint32 {
    var x int
    return uint32(uintptr(unsafe.Pointer(&x)))
}
```

Real `LongAdder` is several hundred lines. This is a starting sketch. The salient ideas:

- Try base first; cells only on contention.
- Cells start small, grow under sustained contention.
- Per-thread probe selects a cell; probe rehashes on contention.
- Read is base + sum of all cells.

For production, use a community port. The point of writing your own is understanding.

---

## Coding Patterns

### Pattern: pad-then-pack

When you have several small atomics that *together* form one logical unit and are accessed together, pack them in one struct on one line:

```go
type Stats struct {
    Requests atomic.Int64
    Errors   atomic.Int64
    Inflight atomic.Int64
    _        [40]byte // pad whole struct to next cache line
}
```

Multiple `Stats` instances in an array do not contend with each other. Inside one `Stats`, all three counters share a line — which is fine because they are typically incremented together.

### Pattern: per-P shard with fallback

```go
func (c *Counter) Inc() {
    if c.cells != nil {
        p := runtime_procPin()
        c.cells[p%len(c.cells)].v.Add(1)
        runtime_procUnpin()
        return
    }
    c.base.Add(1)
}
```

Cells are only installed under contention (LongAdder-style). Cheap fast path.

### Pattern: bulk flush

If your goroutine is about to exit and has accumulated local counts:

```go
defer local.Flush()
```

Always pair the `Local` constructor with the `Flush` defer.

### Pattern: snapshot-publisher loop

```go
go func() {
    t := time.NewTicker(time.Second)
    defer t.Stop()
    for {
        select {
        case <-stop:
            return
        case <-t.C:
            snap := newSnapshot(
                counter1.Get(),
                counter2.Get(),
                counter3.Get(),
            )
            publishedSnap.Store(snap)
        }
    }
}()
```

One publisher, many readers. Readers do one `Load`.

### Pattern: read-mostly + occasional reset

```go
func periodic() {
    for range ticker.C {
        n := c.Reset()
        sink(n)
    }
}
```

`Reset` is O(shards). Acceptable at second granularity.

---

## Clean Code

### Document the contention model

Every counter struct should have a one-line comment on its concurrency story.

```go
// Sharded is a counter sharded across NumCPU cells, each padded to a
// cache line. Inc is safe for concurrent use from any number of
// goroutines; Get is O(shards) and intended for infrequent reads.
type Sharded struct { ... }
```

### Encapsulate the padding

Do not let `_ cpu.CacheLinePad` proliferate across your codebase. Wrap padded atomics in named types:

```go
type PaddedInt64 struct {
    _ cpu.CacheLinePad
    V atomic.Int64
    _ cpu.CacheLinePad
}
```

Now consumers reach for `PaddedInt64` as a single concept.

### Hide `runtime_procPin` behind an interface

`procPin` is dangerous in user code (you must not block while pinned). Wrap it:

```go
// withP runs fn while pinned to a single P. fn must be brief.
func withP(fn func(p int)) {
    p := runtime_procPin()
    fn(p)
    runtime_procUnpin()
}
```

Now consumers cannot accidentally block while pinned, because the body is a clear lambda.

### Pick one paradigm per project

Mixing per-P, sloppy, and dynamic-sharded counters in the same codebase is confusing. Pick one based on your dominant workload and use it everywhere.

---

## Architecture & Design

### When to introduce sharding

Default to a single `atomic.Int64`. Introduce sharding only when:

1. Profiling shows hot time in atomic add for this counter
2. Throughput is plateauing as you add cores
3. The counter is hit at high rate (>1M ops/sec across all cores)

For most counters, even in high-RPS services, a single `atomic.Int64` is fine. Sharding adds memory and complexity for no benefit when the contention is low.

### When to introduce padding

Always when the atomic is high-rate enough to matter. The cost is bytes; the benefit is real.

### When to introduce per-P

When the runtime is your friend (you control GOMAXPROCS, you don't run on weird platforms) and the atomic add is in your hot path. The Go runtime itself uses per-P for many of its counters.

### When to introduce sloppy

When exact freshness is unimportant and throughput is critical. Internal "we processed N bytes" meters for log shippers are the canonical use case.

### When to introduce `LongAdder`

When the contention shape changes over time and you cannot predict the right shard count. For most Go services, a fixed-N per-P shard is simpler and adequate.

### Coordinating multiple counters

If you have related counters (`requests`, `errors`, `inflight`), do not coordinate them on the increment path. Coordinate them at the *snapshot* boundary using `atomic.Pointer[Snapshot]`. The snapshot publisher reads each counter, packages them, and publishes.

### Multi-shard reset

If you need "reset all sharded counters at the same moment", you cannot. The best approximation:

1. Snapshot all counters into a single struct (via `Pointer[T]`).
2. Reset each shard.
3. Accept that increments between (1) and (2) are counted in the snapshot but also in the next interval. Or vice versa. The total is preserved across consecutive intervals.

For monitoring, this fuzziness is acceptable. For accounting, use a different design (e.g., generation numbers).

---

## Error Handling

The same as middle level: atomic operations do not fail; CAS "failure" is part of normal operation. The senior-level additions:

- **Per-P shard mismatch on GOMAXPROCS change.** `Add` will modulo into a smaller-than-expected array; no panic, but contention reappears. Detect at startup and warn.
- **Sloppy counter overflow.** `int64` overflow is impractical, but `int32` local accumulators can overflow if `flushAt` is set too high.
- **`LongAdder` cell array exhaustion.** Cap the cell array growth to prevent runaway memory under pathological contention.

---

## Security Considerations

- **`runtime_procPin` is private API.** A future Go version could rename or remove it. Pin Go versions in CI, run integration tests on new Go versions before adopting.
- **Sloppy counters are crash-lossy.** Do not use them for billing or auditing.
- **Per-P shards reveal CPU count to attackers reading metrics output.** Not always a leak, but worth noting.
- **Counter padding wastes cache.** In a memory-constrained environment, the extra cache lines hurt other workloads' caching. Measure.

---

## Performance Engineering

### Methodology

1. **Benchmark first.** A counter that is not in your profile is not worth optimising.
2. **Measure scaling.** `go test -bench=. -cpu=1,2,4,8,16,32`. The shape of the curve tells you the contention story.
3. **Look at `perf top`.** If `LOCK XADD` or `atomic.AddInt64` is in the top entries during your workload, it is a hot atomic.
4. **Look at `perf c2c` (Linux).** Detects false sharing directly. Hugely valuable.
5. **Inspect cache-line layout.** Use `unsafe.Sizeof` and `unsafe.Offsetof` to verify your padding.

### Common diagnoses

- **"Throughput plateaus at N cores."** Cache-line contention. Pad or shard.
- **"Adding shards gives sublinear speedup."** False sharing — pad.
- **"Per-P shards still slow."** Check GOMAXPROCS; check that the workload actually uses all Ps.
- **"Sloppy counter shows stale values."** Increase flush frequency or add a periodic flush from a coordinator goroutine.
- **"Memory grew under load."** `LongAdder`-style growth without shrinkage; bound the cell array.

### Tools

- `go test -bench=. -benchmem -cpu=1,2,4,8,16,32` — scaling curves
- `go tool pprof -http=:8080 cpu.prof` — CPU profile
- `go tool trace trace.out` — scheduler view
- `perf top`, `perf c2c` — Linux-specific, deep cache analysis
- `cachegrind`, `valgrind --tool=cachegrind` — cache simulation

### Anti-pattern: padding everything

Padding a low-traffic atomic wastes memory for no benefit. Pad atomics that profile as hot; leave others alone.

### Anti-pattern: too many shards

256 shards on a 4-core machine is silly — most shards are never touched, and the read path is unnecessarily expensive. Size shards to ~2-4× cores.

### Anti-pattern: sloppy counter where exact is needed

Sloppy counters are seductive (much faster!) but lossy. Never use them for billing, auditing, or critical business state.

---

## Best Practices

- **Default to a single padded `atomic.Int64`.** Add sharding only when measurement shows contention.
- **Always pad high-contention atomics.** Use `cpu.CacheLinePad` for portability.
- **Prefer per-P shards over random shards** when `procPin` is available and acceptable.
- **Use sloppy counters for high-throughput, loss-tolerant counts only.**
- **Snapshot multi-counter state via `atomic.Pointer[Snapshot]`,** not by reading each counter separately.
- **Document the contention model in the type's comment.**
- **Benchmark scaling with `-cpu`** for every new high-traffic counter.
- **Cap dynamic-sharded growth** to prevent runaway memory.

---

## Edge Cases & Pitfalls

### GOMAXPROCS changes at runtime

If your per-P counter was sized at startup for 16 Ps and runtime later sets GOMAXPROCS to 32, half the Ps will share shards. Either lock GOMAXPROCS or oversize.

### `procPin` while blocking

You must not call `time.Sleep`, allocate large objects, or call user code (which might block) while pinned. The atomic add is safe; everything else is forbidden.

### Sloppy counter where flush goroutine dies

If your goroutine panics, `defer Flush()` runs and the local data is preserved. If your goroutine *hangs* forever, the local data is stranded. Add periodic flushers as a safety net.

### `LongAdder` cells leaked on growth

Old cell arrays remain referenced until GC; under heavy growth, you can briefly retain N cell arrays. Bound the growth and trigger GC if it matters.

### Sharded counter with non-power-of-2 size

`shards[key % 100]` is slower than `shards[key & 63]`. Round shard count up to the next power of 2.

### False sharing across struct boundaries

```go
type S struct {
    a atomic.Int64
    b atomic.Int64
}
var instances [10]S
```

`instances[0].b` and `instances[1].a` may share a cache line. Pad `S` to a cache line if both are hot.

### `cpu.CacheLinePad` is per-architecture

On Apple Silicon, `cpu.CacheLinePadSize` is 128 (some M-series chips have 128-byte lines). Padding to 64 is not enough. Always use `cpu.CacheLinePad`, not a hand-rolled `_ [56]byte`.

### `runtime_procPin` on Wasm/JS

Wasm and JS targets do not implement `procPin` in the same way; behaviour may degrade. Verify on your target platforms.

### Reading sharded counters from inside a hot loop

Per-write `Get()` is O(shards). For 64 shards, that is 200+ ns — many times the cost of the increment. Cache the result locally if you use it many times.

### Counter `Reset` racing with snapshot

If you `Reset()` while a publisher is computing a snapshot, the snapshot may include partial-reset values. Coordinate reset with snapshot windows.

---

## Common Mistakes

1. **Padding the array, not the element.** `[N]atomic.Int64` with a `_ [56]byte` after the array still has 8 cells per line.
2. **Forgetting `cpu.CacheLinePad` is per-architecture.** Hardcoding 56 bytes assumes 64-byte lines.
3. **Calling user code while procPinned.** Panic if the runtime preempts; subtle if not.
4. **Sloppy counter without `defer Flush()`.** Lost data on panic.
5. **`LongAdder` without growth cap.** Memory explodes under pathological contention.
6. **Resetting a sharded counter under the assumption that all shards are zero at the same instant.** They never are.
7. **Snapshotting by reading each counter separately and assuming consistency.** Use `atomic.Pointer[T]`.
8. **Premature sharding.** Single atomic is fine for the vast majority of counters.

---

## Common Misconceptions

- **"Padding is just for fun."** No — false sharing is a measurable, dominant cost at high contention.
- **"More shards is always better."** Past 2-4× cores, additional shards waste memory and slow reads.
- **"Per-P is the same as per-core."** Almost, but not exactly: a P is bound to an OS thread *while it runs Go code*, but the OS thread itself can migrate between cores. NUMA effects are still possible.
- **"`LongAdder` is always faster than a sharded counter."** Under low contention, the dynamic machinery is overhead. Fixed sharded is faster for sustained moderate load.
- **"Sloppy counters lose data."** They lose *staleness*; in steady state the count is correct. They lose unfflushed deltas on crash.

---

## Tricky Points

### Per-P shard sees writes from other goroutines on the same P

When the scheduler moves another goroutine onto P3, that goroutine's `Inc` also goes to cell 3. So "per-P" does not mean "per-goroutine" — but because only one goroutine runs on P3 at a time, there is no cross-thread contention on cell 3's cache line.

### `procPin` is not just `LockOSThread`

`procPin` is faster and lighter than `runtime.LockOSThread`. It prevents preemption during the pinned section but does not bind to a specific OS thread the way `LockOSThread` does. For atomic-add workloads, `procPin` is the right tool.

### Sum of shards is not atomic

`Get()` walks shards and reads each one. By the time you reach shard 63, shards 0..62 may have been further incremented. The returned value is "monotonically increasing in time" but is not "the value at any single instant".

### `LongAdder.Sum()` returns a sloppy answer too

Java's `LongAdder.sum()` is documented as "an estimate". Same caveat as Go's sharded `Get()`.

### Padding cost compounds with shard count

64 shards × 128 bytes (with both-side padding) = 8 KB per counter. For one counter, trivial. For 100 counters, 800 KB. For a large metrics namespace, this adds up. Consider sharing padding across logically-related counters.

---

## Test

```go
package counters

import (
    "runtime"
    "sync"
    "sync/atomic"
    "testing"
    "unsafe"

    "golang.org/x/sys/cpu"
)

func TestCellAlignment(t *testing.T) {
    var s Sharded = *New(4)
    a0 := uintptr(unsafe.Pointer(&s.cells[0].v))
    a1 := uintptr(unsafe.Pointer(&s.cells[1].v))
    diff := a1 - a0
    if diff < uintptr(cpu.CacheLinePadSize) {
        t.Errorf("cells too close: %d bytes apart", diff)
    }
}

func TestSharded_Correct(t *testing.T) {
    s := New(64)
    const N = 100000
    var wg sync.WaitGroup
    for i := 0; i < N; i++ {
        wg.Add(1)
        go func() { defer wg.Done(); s.Inc() }()
    }
    wg.Wait()
    if got := s.Get(); got != N {
        t.Errorf("expected %d, got %d", N, got)
    }
}

func TestPerP_Correct(t *testing.T) {
    p := NewPerP()
    const N = 100000
    var wg sync.WaitGroup
    for i := 0; i < N; i++ {
        wg.Add(1)
        go func() { defer wg.Done(); p.Inc() }()
    }
    wg.Wait()
    if got := p.Get(); got != N {
        t.Errorf("expected %d, got %d", N, got)
    }
}

func TestSloppy_Correct(t *testing.T) {
    var s Sloppy
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            local := s.Local(100)
            defer local.Flush()
            for j := 0; j < 1000; j++ {
                local.Inc()
            }
        }()
    }
    wg.Wait()
    if got := s.Get(); got != 100*1000 {
        t.Errorf("expected %d, got %d", 100*1000, got)
    }
}

func BenchmarkSingle(b *testing.B) {
    var c atomic.Int64
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            c.Add(1)
        }
    })
}

func BenchmarkSharded(b *testing.B) {
    s := New(runtime.GOMAXPROCS(0) * 4)
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            s.Inc()
        }
    })
}

func BenchmarkPerP(b *testing.B) {
    p := NewPerP()
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            p.Inc()
        }
    })
}

func BenchmarkSloppy(b *testing.B) {
    var s Sloppy
    b.RunParallel(func(pb *testing.PB) {
        local := s.Local(1024)
        defer local.Flush()
        for pb.Next() {
            local.Inc()
        }
    })
}
```

Run all four at `-cpu=1,4,16,32`:

```
go test -bench=. -cpu=1,4,16,32 -benchtime=2s
```

Expected shape: Single's ops/sec falls as cores rise; Sharded scales until ~16 cores then plateaus; PerP scales linearly to GOMAXPROCS; Sloppy is fastest at every concurrency level.

---

## Tricky Questions

**Q: How can I tell if I have false sharing without `perf c2c`?**
A: Run a microbenchmark with N goroutines hammering N "different" atomics. If the throughput is much worse than N goroutines each hammering its own isolated atomic, you have false sharing. Adding padding and re-measuring confirms.

**Q: What is the right shard count?**
A: 2-4× `GOMAXPROCS`. For a 16-core machine, 32-64 shards. Round to power of 2 to use bitwise mask.

**Q: Why not always use per-P?**
A: It relies on private runtime API. For libraries that ship widely, you do not want that dependency. For application code at known Go versions, per-P is excellent.

**Q: Does `cpu.CacheLinePad` work on ARM64?**
A: Yes. The package picks the right size per architecture.

**Q: Is there overhead in `procPin` itself?**
A: A few cycles. Roughly the cost of an atomic add. Worth it when the alternative is cross-core cache traffic.

**Q: Can I use sloppy counters with channels for the flush?**
A: Yes — a `local.IncSendOnFlush(ch)` pattern works. But the simple "add to global atomic" flush is usually fine.

**Q: How do I `Reset` a sloppy counter?**
A: You need every `Local` to flush first, then `s.global.Swap(0)`. Coordinating "every local flush" requires a barrier (a generation number on the global, locals check generation on `Inc` and flush themselves if it has bumped). Non-trivial.

**Q: Does `LongAdder` shrink?**
A: Java's does not. Once grown, the cell array stays large. This is intentional — shrinking is expensive and the assumption is that contention recurs.

**Q: What about CPU pinning at the OS level?**
A: Useful for NUMA-aware workloads. Combine with per-P shards: pin the OS thread, then use `procPin` for the shard index. Professional level.

**Q: How does `sync.Pool` use this technique?**
A: `sync.Pool` has a per-P shard internally. It is the canonical example of `procPin` usage in the standard library.

---

## Cheat Sheet

```go
// Padded shard
type cell struct {
    _ cpu.CacheLinePad
    v atomic.Int64
    _ cpu.CacheLinePad
}

// Per-P pin
p := runtime_procPin()
cells[p].v.Add(1)
runtime_procUnpin()

// Sloppy
local := s.Local(1024)
defer local.Flush()
local.Inc()

// LongAdder-style
adder.Add(1)
n := adder.Sum()

// Shard count heuristic
shards := nextPowerOf2(4 * runtime.GOMAXPROCS(0))
```

| Workload | Choice |
|----------|--------|
| Low-contention single counter | `atomic.Int64` |
| Moderate-contention single counter | Padded `atomic.Int64` |
| High-contention multi-writer | Padded sharded (random shard) |
| High-contention with runtime cooperation | Per-P sharded |
| Very high throughput, can lose freshness | Sloppy |
| Unknown contention shape | `LongAdder`-style dynamic |

---

## Self-Assessment Checklist

- [ ] I can explain false sharing to a colleague
- [ ] I have measured the difference between padded and unpadded sharded counters
- [ ] I can write per-P sharded counters using `runtime_procPin` (or know why I shouldn't)
- [ ] I have implemented and tested a sloppy counter
- [ ] I can sketch a `LongAdder` and explain the trade-offs vs fixed sharded
- [ ] I can interpret a `go test -bench -cpu=...` scaling curve
- [ ] I know when *not* to shard

---

## Summary

Senior-level concurrent counters are about making them scale. The progression is:

1. Single atomic — fine for most.
2. Padded single atomic — for moderate contention.
3. Padded sharded with random shard — for high contention without runtime access.
4. Per-P sharded — when runtime cooperation is acceptable.
5. Sloppy — when freshness is dispensable.
6. `LongAdder`-style dynamic — when contention shape is unpredictable.

Each level adds memory and code complexity; each pays back at higher contention. Profile before you climb the ladder; do not climb past your need.

The professional file completes the story with HDR histograms (because counters are not enough for latency), NUMA-aware shard placement, deep `expvar`/Prometheus integration, and the design of a full observability subsystem.

---

## What You Can Build

- A padded sharded counter that scales near-linearly to 32 cores
- A per-P counter using `runtime_procPin`
- A sloppy counter with periodic flushing
- A `LongAdder` analog (basic version)
- A multi-counter coherent snapshot publisher
- Benchmarks proving scaling claims
- Diagnosis flows for "counter is hot in profile"

---

## Further Reading

- Java's `LongAdder` / `Striped64` source code (OpenJDK)
- Cliff Click, "A Lock-Free Hash Table" — for inspiration on dynamic sizing
- Linux kernel's `percpu_counter.c` — the textbook sloppy counter
- Doug Lea, "JSR-166 Concurrency Updates" — historical background
- Russ Cox, "Hardware Memory Models" series
- Ulrich Drepper, "What Every Programmer Should Know About Memory"
- `golang.org/x/sys/cpu` package source
- `sync/atomic`, `sync.Pool`, `runtime` source in the Go standard library

---

## Related Topics

- Junior and middle counters (prerequisites)
- Professional counters (HDR histograms, expvar+Prometheus, NUMA)
- `sync.Pool` (uses per-P shards under the hood)
- The Go scheduler (GMP model)
- Lock-free data structures
- Cache coherence protocols (MESI, MOESI)
- NUMA architectures

---

## Diagrams & Visual Aids

### Cache line layout — naive vs padded

```
naive [4]atomic.Int64 (32 bytes in one cache line):
| c0 | c1 | c2 | c3 | c4 | c5 | c6 | c7 |    cells 0..7 share one line

padded cell (each in its own line):
| pad | c0 | pad | ... | pad | c1 | pad | ...
  ^---- 64 bytes ----^     ^---- 64 bytes ----^
```

### Per-P assignment

```
P0 --+
P1 -|--> each writes only to its own cell
P2 -|    (no inter-P contention)
P3 --+
```

### Sloppy counter flow

```
goroutine A: l.n++ ... l.n++ ... (l.n >= flush) -> global.Add(l.n); l.n=0
goroutine B: l.n++ ... l.n++ ... (l.n >= flush) -> global.Add(l.n); l.n=0
goroutine C: l.n++ ...                             (still local)

reader: global.Load() -> sees A's and B's flushed totals, missing C's local
```

### `LongAdder` decision tree

```
Add(delta):
  cells is nil:
    try CAS base += delta
    succeeded: done
    failed: install cells, retry
  cells not nil:
    probe = thread-local hash
    cell = cells[probe % len(cells)]
    try CAS cell += delta
    succeeded: done
    failed: rehash probe; if persistent contention, grow cells
```

That is the senior-level concurrent counter toolkit. The professional file adds HDR histograms, NUMA, and full observability subsystem design.

---

## Deep Dive: Cache Coherence in Detail

To design counters that scale, you must understand how the CPU keeps cache lines consistent across cores. The MESI protocol (and its variants MOESI, MESIF) is the foundation. The full state machine has four states per cache line per core:

- **M (Modified)** — this core has the line exclusively and has written to it; other cores' copies are stale.
- **E (Exclusive)** — this core has the only clean copy; nobody else has it cached.
- **S (Shared)** — multiple cores have read-only copies that match memory.
- **I (Invalid)** — this core does not have a valid copy.

Transitions:

- A read miss on a line currently in M state in another core forces that core to *flush* (writeback) and downgrade to S, while this core upgrades from I to S.
- A write to a line in S state forces all other holders to I (an *invalidation*), and this core upgrades to M.
- A read of a line that nobody else has becomes E.
- Writing to a line in E silently upgrades to M (no bus traffic).

Each transition involves an inter-core message. The latency is:

- L1 hit (uncontended): ~1 ns
- L2 hit: ~3-10 ns
- L3 hit (in this socket): ~20-50 ns
- Cross-socket cache transfer: 100-300 ns
- Memory: 50-100 ns local, 200+ ns remote (NUMA)

When two cores hammer the same cache line with writes, every write transitions the line through I → M and back. The line bounces between cores at L3-or-worse latency. This is why uncontended atomics cost ~10 ns and contended atomics cost ~200 ns each.

False sharing manifests as cache-line bouncing even though the *logical* values written by different cores are different. From the cache controller's perspective, "we wrote into this line" is the only granularity that matters. The fix — putting each hot value on its own line — is the only fix.

### `perf c2c` for diagnosis

On Linux, `perf c2c` reports cache-line contention directly. Sample workflow:

```
$ perf c2c record -F 99 -- ./your_app
$ perf c2c report
```

The report shows which cache lines are bounced between cores and which functions touched them. False sharing jumps out as "two cache lines accessed by N cores, M HITMs each second".

Without `perf c2c`, you can still diagnose by:

1. Add padding.
2. Re-benchmark.
3. If throughput jumps, false sharing was your problem.

This is crude but works.

---

## Deep Dive: Reading `sync.Pool` for `procPin` Patterns

`sync.Pool` is the canonical example of `procPin` in the standard library. Its internal structure:

```go
type Pool struct {
    noCopy noCopy
    local     unsafe.Pointer // local fixed-size per-P pool, actual type is [P]poolLocal
    localSize uintptr        // size of the local array
    ...
}

type poolLocal struct {
    poolLocalInternal
    pad [128 - unsafe.Sizeof(poolLocalInternal{})%128]byte
}

func (p *Pool) pin() (*poolLocalInternal, int) {
    pid := runtime_procPin()
    s := runtime_LoadAcquintptr(&p.localSize)
    l := p.local
    if uintptr(pid) < s {
        return indexLocal(l, pid), pid
    }
    return p.pinSlow()
}
```

Things to notice:

- `poolLocal` is padded to 128 bytes — Apple Silicon has 128-byte lines, so 128 is the safe choice.
- The local array is sized to GOMAXPROCS.
- `pin()` returns both the local pointer and the P index. The pin must be held while you operate on the local.
- `pinSlow` handles GOMAXPROCS changes by reallocating.

Studying this teaches you a lot about how to write your own per-P infrastructure. The `linkname`-to-runtime trick, the padding to the largest known line size, the slow-path for resize — these are the patterns to copy.

---

## Deep Dive: Writing a Production Per-P Counter

Let us write a per-P counter that handles all the edge cases:

```go
package counters

import (
    "runtime"
    "sync"
    "sync/atomic"
    "unsafe"
    _ "unsafe" // for go:linkname

    "golang.org/x/sys/cpu"
)

//go:linkname runtime_procPin runtime.procPin
func runtime_procPin() int

//go:linkname runtime_procUnpin runtime.procUnpin
func runtime_procUnpin()

type pcell struct {
    _ cpu.CacheLinePad
    v atomic.Int64
    _ cpu.CacheLinePad
}

type PerP struct {
    mu       sync.Mutex
    cellsPtr atomic.Pointer[[]pcell]
}

// NewPerP creates a per-P counter sized for current GOMAXPROCS.
// If GOMAXPROCS later grows, the counter resizes itself transparently
// (at the cost of a one-time slow path for the next Inc).
func NewPerP() *PerP {
    p := &PerP{}
    p.resize(runtime.GOMAXPROCS(0))
    return p
}

func (p *PerP) resize(n int) {
    p.mu.Lock()
    defer p.mu.Unlock()
    old := p.cellsPtr.Load()
    if old != nil && len(*old) >= n {
        return
    }
    newCells := make([]pcell, n)
    if old != nil {
        for i := range *old {
            newCells[i].v.Store((*old)[i].v.Load())
        }
    }
    p.cellsPtr.Store(&newCells)
}

func (p *PerP) Inc() {
    pid := runtime_procPin()
    cells := *p.cellsPtr.Load()
    if pid < len(cells) {
        cells[pid].v.Add(1)
        runtime_procUnpin()
        return
    }
    runtime_procUnpin()
    // Slow path: GOMAXPROCS grew.
    p.resize(runtime.GOMAXPROCS(0))
    p.Inc()
}

func (p *PerP) Add(delta int64) {
    pid := runtime_procPin()
    cells := *p.cellsPtr.Load()
    if pid < len(cells) {
        cells[pid].v.Add(delta)
        runtime_procUnpin()
        return
    }
    runtime_procUnpin()
    p.resize(runtime.GOMAXPROCS(0))
    p.Add(delta)
}

func (p *PerP) Get() int64 {
    cells := *p.cellsPtr.Load()
    var total int64
    for i := range cells {
        total += cells[i].v.Load()
    }
    return total
}

func (p *PerP) Reset() int64 {
    cells := *p.cellsPtr.Load()
    var total int64
    for i := range cells {
        total += cells[i].v.Swap(0)
    }
    return total
}

// assertCachelineAligned is a runtime check that cells are padded.
func assertCachelineAligned(cells []pcell) bool {
    if len(cells) < 2 {
        return true
    }
    diff := uintptr(unsafe.Pointer(&cells[1])) - uintptr(unsafe.Pointer(&cells[0]))
    return diff >= uintptr(cpu.CacheLinePadSize)
}
```

Key design points:

- `atomic.Pointer[[]pcell]` for the cell slice; resizing swaps the pointer.
- `cells[pid]` is read after `procPin`, so the slice pointer is stable for the duration of our access.
- If `pid >= len(cells)`, GOMAXPROCS grew; we unpin, resize, and retry.
- Resize uses a mutex; concurrent resizes are deduplicated.
- `Reset` is O(P) but called rarely.
- All counter math goes through the padded atomic cells.

This is production-grade. The main runtime cost is the `procPin`/`procUnpin` pair (a few cycles) plus the atomic add — comparable to a single unsharded atomic but contention-free.

---

## Deep Dive: Benchmarking Sharded Counters Rigorously

Bad benchmarks lie. Here is a rigorous one for sharded counter design:

```go
package counters

import (
    "runtime"
    "sync"
    "sync/atomic"
    "testing"
)

type Bench struct {
    name string
    fn   func()
}

func BenchmarkAll(b *testing.B) {
    var single atomic.Int64
    naive := [64]atomic.Int64{}
    padded := New(64)
    perP := NewPerP()

    benches := []Bench{
        {"single", func() { single.Add(1) }},
        {"naive[hash]", func() {
            i := runtime_FastRand()
            naive[i%64].Add(1)
        }},
        {"padded[hash]", func() {
            padded.Inc()
        }},
        {"perP", func() {
            perP.Inc()
        }},
    }

    for _, bb := range benches {
        b.Run(bb.name, func(b *testing.B) {
            b.ResetTimer()
            b.RunParallel(func(pb *testing.PB) {
                for pb.Next() {
                    bb.fn()
                }
            })
        })
    }
}

//go:linkname runtime_FastRand runtime.fastrand
func runtime_FastRand() uint32
```

Run at multiple core counts:

```bash
for c in 1 2 4 8 16 32; do
  go test -bench=BenchmarkAll -cpu=$c -benchtime=3s
done
```

Expected results (illustrative, on a 16-core x86-64):

| Cores | single | naive | padded | perP |
|-------|--------|-------|--------|------|
| 1     | 6 ns   | 8 ns  | 8 ns   | 10 ns|
| 2     | 25 ns  | 12 ns | 8 ns   | 10 ns|
| 4     | 80 ns  | 30 ns | 9 ns   | 10 ns|
| 8     | 200 ns | 80 ns | 12 ns  | 10 ns|
| 16    | 500 ns | 200 ns| 25 ns  | 11 ns|
| 32    | 1100 ns| 350 ns| 60 ns  | 12 ns|

(Numbers vary widely by hardware; run on yours.)

Interpretation:

- **single** scales worst: contention dominates.
- **naive** (no padding) suffers from false sharing past ~4 cores.
- **padded** scales until cache traffic between distant cores becomes visible.
- **perP** is essentially flat — perfect scaling.

This is the chart that wins design arguments. Generate it for your service.

---

## Deep Dive: Sharded Counters with Coordinated Reset

A nuance of `Reset` on a sharded counter: between resetting shard 0 and shard 63, increments to shards 1-63 are still arriving. Those are "lost" to the return value of the current Reset but will appear in the next Reset.

For monitoring, this is fine. For exact billing, you need a versioning scheme:

```go
type VersionedShard struct {
    cells [N]struct {
        v   atomic.Int64
        ver atomic.Uint64 // bumped each reset
    }
}

func (s *VersionedShard) Inc(epoch uint64) {
    idx := pickShard()
    for {
        cur := s.cells[idx].v.Load()
        if s.cells[idx].ver.Load() > epoch {
            // This shard was reset after epoch; our increment belongs in the new epoch.
            // Decide: drop, count in new epoch, or retry.
            return
        }
        if s.cells[idx].v.CompareAndSwap(cur, cur+1) {
            return
        }
    }
}
```

This is brittle. For real exact-counting, use a different design entirely (e.g., write to an append-only log, count in a batch job). Senior takeaway: do not try to make sharded counters atomically resettable.

---

## Deep Dive: Sloppy Counter Variations

The basic sloppy counter has many useful variations.

### Time-based flush

Instead of flushing every N increments, flush every T milliseconds:

```go
type TimedLocal struct {
    parent *Sloppy
    n      int64
    nextAt time.Time
    period time.Duration
}

func (l *TimedLocal) Inc() {
    l.n++
    if time.Now().After(l.nextAt) {
        l.parent.global.Add(l.n)
        l.n = 0
        l.nextAt = time.Now().Add(l.period)
    }
}
```

Trades: bounded freshness in time (always within `period` seconds) regardless of rate.

### Adaptive threshold

If the global value is read often, flush more aggressively; if rarely, flush less:

```go
type AdaptiveLocal struct {
    parent  *Sloppy
    n       int64
    flushAt int64 // adjusted based on observed read frequency
}
```

Requires the global to track reader-frequency. Rarely worth the complexity.

### Centrally-coordinated flush

A separate goroutine periodically requests all locals to flush. Requires a registry of locals and a flush channel per local:

```go
type Coordinator struct {
    locals []chan struct{}
    mu     sync.Mutex
}

func (c *Coordinator) Register(local *Local) chan struct{} {
    ch := make(chan struct{}, 1)
    c.mu.Lock()
    c.locals = append(c.locals, ch)
    c.mu.Unlock()
    return ch
}

func (c *Coordinator) FlushAll() {
    c.mu.Lock()
    defer c.mu.Unlock()
    for _, ch := range c.locals {
        select { case ch <- struct{}{}: default: }
    }
}
```

Each `Local`'s owning goroutine watches its channel and flushes on signal. Clean separation; more complexity.

### Sloppy with snapshot

Combine sloppy with `atomic.Pointer[Snapshot]`:

```go
type SloppyWithSnap struct {
    s        Sloppy
    snapshot atomic.Pointer[int64]
}

func (s *SloppyWithSnap) Inc() { s.s.Local(1024).Inc() }

func (s *SloppyWithSnap) RefreshSnap() {
    v := s.s.Get()
    s.snapshot.Store(&v)
}

func (s *SloppyWithSnap) Snap() int64 {
    if p := s.snapshot.Load(); p != nil {
        return *p
    }
    return 0
}
```

Readers see only the snapshot (consistent, atomic pointer load). Background goroutine refreshes the snapshot every interval. Best of both worlds at the cost of small allocation per refresh.

---

## Deep Dive: `LongAdder` in Detail

Java's `LongAdder` is the gold standard. Let us trace its full algorithm.

### State

- `base`: a single `atomic.Long` for the uncontended case.
- `cells`: an array of `Cell` (atomic-long-with-padding), null until contention is observed.
- `cellsBusy`: a CAS-based lock for resizing `cells`.

### Per-thread state

- `probe`: a thread-local hash, mutated on each contention to spread cells.

### `Add(delta)` flow

```
if cells != null OR base CAS failed:
    if cells == null:
        try to allocate cells (using cellsBusy as a lock)
    if probe == 0:
        initialize probe (random nonzero value)
    targetCell = cells[probe & (len(cells) - 1)]
    if targetCell == null:
        try to install a new cell at this slot
    else:
        try CAS targetCell.value += delta
        if CAS failed:
            rehash probe
            if cells should grow:
                try to grow cells
            (continue loop)
```

### `Sum()`

```
total = base
if cells != null:
    for each cell:
        if cell != null:
            total += cell.value
return total
```

### Growth policy

`cells` doubles when contention persists. Capped at the next power of 2 above `NCPU`. Java's heuristic: grow when a CAS fails on the cell array and the array is smaller than NCPU.

### Translation to Go

```go
package counters

import (
    "runtime"
    "sync"
    "sync/atomic"

    "golang.org/x/sys/cpu"
)

type adderCell struct {
    _ cpu.CacheLinePad
    v atomic.Int64
    _ cpu.CacheLinePad
}

type LongAdder struct {
    base   atomic.Int64
    cellsP atomic.Pointer[[]adderCell]
    busy   atomic.Int32 // 1 if a resize is in progress
}

func (a *LongAdder) Add(delta int64) {
    cellsPtr := a.cellsP.Load()
    if cellsPtr == nil {
        cur := a.base.Load()
        if a.base.CompareAndSwap(cur, cur+delta) {
            return
        }
        // contention
        a.installCells(initialAdderCells)
        a.Add(delta)
        return
    }
    cells := *cellsPtr
    probe := getProbe()
    idx := probe & uint32(len(cells)-1)
    cell := &cells[idx]
    for retries := 0; retries < 3; retries++ {
        cur := cell.v.Load()
        if cell.v.CompareAndSwap(cur, cur+delta) {
            return
        }
        probe = rehashProbe(probe)
        idx = probe & uint32(len(cells)-1)
        cell = &cells[idx]
    }
    // sustained contention; try to grow
    if len(cells) < runtime.NumCPU() {
        a.installCells(len(cells) * 2)
    }
    a.Add(delta)
}

func (a *LongAdder) Sum() int64 {
    total := a.base.Load()
    if cellsPtr := a.cellsP.Load(); cellsPtr != nil {
        for i := range *cellsPtr {
            total += (*cellsPtr)[i].v.Load()
        }
    }
    return total
}

const initialAdderCells = 4

func (a *LongAdder) installCells(n int) {
    if !a.busy.CompareAndSwap(0, 1) {
        return // someone else is installing
    }
    defer a.busy.Store(0)
    cur := a.cellsP.Load()
    if cur != nil && len(*cur) >= n {
        return
    }
    newCells := make([]adderCell, nextPow2(n))
    if cur != nil {
        for i := range *cur {
            newCells[i].v.Store((*cur)[i].v.Load())
        }
    }
    a.cellsP.Store(&newCells)
}

func nextPow2(n int) int {
    p := 1
    for p < n { p <<= 1 }
    return p
}

// getProbe returns a per-goroutine pseudorandom uint32, mutated on contention.
// Real Java uses ThreadLocalRandom; in Go we can use a goroutine-local map.
// For brevity here, we use runtime.fastrand.
//go:linkname runtime_fastrand runtime.fastrand
func runtime_fastrand() uint32

func getProbe() uint32  { return runtime_fastrand() }
func rehashProbe(p uint32) uint32 {
    p ^= p << 13
    p ^= p >> 17
    p ^= p << 5
    return p
}
```

Caveats vs Java:

- Real Java uses a per-thread `probe` that mutates on each contention. Go does not have per-goroutine state without `sync.Pool` tricks. Using `runtime.fastrand` (a per-P RNG inside the runtime) is a reasonable substitute.
- The growth policy is simpler here; real Java has more nuance.
- No "deflate" — cells never shrink once grown.

For most Go services, a fixed-size padded sharded counter (per-P or hash-based) is simpler and adequate. `LongAdder` shines when contention varies wildly and you cannot tune N.

---

## Deep Dive: Cache Coherence on ARM64

ARM is *weakly ordered*: writes are reordered more aggressively than x86. Go's `sync/atomic` papers over this by emitting acquire/release fences as needed. You generally do not have to think about it — but it affects performance:

- An atomic add on ARM64 compiles to `LDADDAL` (load-and-add with acquire-release), one instruction since ARMv8.1.
- On older ARM (LL/SC), an atomic add is a retry loop that fails on cache invalidation. Worse under contention.
- Acquire fences (`LDAR`) and release fences (`STLR`) cost more on ARM than on x86 because the hardware ordering is weaker.

Implication: contention is *more* expensive on ARM than x86. Per-P sharding is even more valuable on ARM-based servers (Graviton, Ampere). Measure on your target.

Apple Silicon adds the wrinkle of 128-byte cache lines. `cpu.CacheLinePadSize` is 128 on darwin/arm64, so padding to 64 bytes is insufficient. Always use `cpu.CacheLinePad`.

---

## Deep Dive: When NUMA Matters

A single-socket server (typical cloud VM) has uniform memory access — every core can reach every cache line at the same latency (within rounding error). A multi-socket server (typical bare-metal or large cloud instance) has *non-uniform* memory access: memory near a socket is faster to access than memory near another socket.

For sharded counters at the senior level, NUMA matters when:

- Your cells happen to live on socket A's memory.
- Your goroutines run on socket B.
- Every increment crosses the socket boundary at NUMA latency (~300-500 ns per access).

Mitigations:

- Pin OS threads to sockets and allocate per-socket cell arrays (professional).
- Use OS-level NUMA-aware allocators.
- Accept the cost if your workload is not bottlenecked here.

For most Go services, NUMA is a non-issue. For ones that show NUMA-induced slowdowns, the fix is professional-level work (covered in `professional.md`).

---

## Deep Dive: Counter Patterns from the Linux Kernel

The Linux kernel uses several counter patterns worth studying:

### `percpu_counter`

The kernel's sloppy counter. Each CPU has a local counter; the global is a single atomic; locals flush to the global when they exceed a batch threshold.

```c
struct percpu_counter {
    raw_spinlock_t lock;
    s64 count;
    s32 batch;
    s32 __percpu *counters;
};

void percpu_counter_add(struct percpu_counter *fbc, s64 amount) {
    s64 count = __this_cpu_read(*fbc->counters) + amount;
    if (abs(count) >= fbc->batch) {
        raw_spin_lock(&fbc->lock);
        fbc->count += count;
        raw_spin_unlock(&fbc->lock);
        __this_cpu_write(*fbc->counters, 0);
    } else {
        __this_cpu_write(*fbc->counters, count);
    }
}
```

Notice: the spin lock is acquired only on flush. Reads of the global "count" are approximate (they miss un-flushed local deltas).

### `atomic_long_t`

The simplest counter. Used for things read frequently or where exact counts matter. Linux carefully picks between `atomic_long_t` and `percpu_counter` based on read/write rate ratio.

### `static_key`

A counter-like primitive that uses code patching to dynamically enable/disable a fast path. Conceptually a "counter that is 0 or N" — and the kernel reaches into the instruction stream to rewrite branches when the counter changes. Out of scope for Go, but a beautiful technique.

Lessons:

- Pick the counter pattern based on read/write rate.
- Exact + low-write-rate = atomic.
- Approximate + high-write-rate = sloppy.
- Avoid "everything-atomic" or "everything-sloppy" — pick per metric.

---

## Deep Dive: Counter Footprint in Production Profiles

When you `go tool pprof` a production service, atomic operations on counters can appear in three places:

### 1. CPU profile

If `runtime.atomic.Xadd64` or `sync/atomic.AddInt64` is hot, you have contention. Look at:

- Which counter? (Use sample labels or stack traces.)
- How many cores are hitting it?
- What is the access rate?

### 2. Mutex profile

If a `sync.Mutex` wrapping a counter is hot, replace it with `atomic.Int64`.

### 3. Block profile

If goroutines are blocking in `runtime.gopark` waiting for atomic semantics, you have a different problem — atomics do not block. Look for `sync.Mutex.Lock` or `chan` operations adjacent to your counter.

### Action priorities

1. Highest: remove unnecessary atomics. Many "counters" are not actually called.
2. Next: shard the hot ones.
3. Next: pad the sharded ones.
4. Next: per-P the contended ones.
5. Last: sloppy the truly hot ones, accepting loss of freshness.

A common pattern: 90% of your counters can stay as single `atomic.Int64`; the remaining 10% (the hot ones) deserve sharding and padding.

---

## Deep Dive: Sharded Counter Read Path Optimisation

Reads of sharded counters are O(N). For N=64 that is ~200 ns. For N=1024 it is microseconds. If reads happen on every request, this can become the new bottleneck.

Optimisations:

### Periodic snapshot

A background goroutine reads the counter every second and stores the result in an `atomic.Int64`. Readers read the cached value.

```go
type CachedSharded struct {
    sharded *Sharded
    cache   atomic.Int64
}

func (c *CachedSharded) RefreshCache() {
    c.cache.Store(c.sharded.Get())
}

func (c *CachedSharded) FastGet() int64 {
    return c.cache.Load()
}

func (c *CachedSharded) Run(stop <-chan struct{}, interval time.Duration) {
    t := time.NewTicker(interval)
    defer t.Stop()
    for {
        select {
        case <-stop:
            return
        case <-t.C:
            c.RefreshCache()
        }
    }
}
```

`FastGet` is one atomic load. The cost is staleness up to `interval`.

### Subset reads

For some monitoring, reading a single shard's value is an estimate of the total / N. If your shards are uniformly distributed:

```go
estimate := c.cells[rand.IntN(len(c.cells))].v.Load() * int64(len(c.cells))
```

Approximate but cheap. Useful for "am I in trouble?" checks, not for reporting.

### Pre-summed batches

Maintain a running sum that is updated as part of `Inc`:

```go
func (c *Sharded) Inc() {
    c.cells[shard].v.Add(1)
    // optionally: c.runningSum.Add(1)
}
```

But this re-introduces the central contention you sharded to avoid. Defeats the purpose.

### Conclusion

For metrics, periodic snapshot is the standard solution. For high-freshness needs, accept the O(N) read cost.

---

## Deep Dive: Coordinating Many Sharded Counters

A real metrics namespace has dozens of counters: requests, errors, bytes, inflight, retries, breakers, etc. Each one *could* be a padded sharded counter. Padding multiplies memory by ~16× (64 bytes per cell vs 8). For 50 counters × 64 shards × 64 bytes = 200 KB. Fine.

But the *read* path is now 50 × O(N). For a Prometheus scrape every 15 seconds, that is fine. For higher-frequency reads, batch:

```go
type MetricsGroup struct {
    counters []*Sharded
    names    []string
    cache    atomic.Pointer[map[string]int64]
}

func (m *MetricsGroup) Refresh() {
    snap := make(map[string]int64, len(m.counters))
    for i, c := range m.counters {
        snap[m.names[i]] = c.Get()
    }
    m.cache.Store(&snap)
}

func (m *MetricsGroup) Snapshot() map[string]int64 {
    return *m.cache.Load()
}
```

One refresh, one map allocation. Readers read the map directly (immutable after publish).

---

## Deep Dive: Counter Adoption Path in a Codebase

Here is a real adoption path for adding sharded counters to a service:

### Phase 1: Identify hot counters

Run production for a week, collect profiles. Identify the top 3 atomic-add hotspots in the CPU profile.

### Phase 2: Pad existing atomics

Wrap the hot 3 in padded structs. Measure throughput. If it improves, ship.

### Phase 3: Shard the worst offenders

For any remaining hot counter, introduce a Sharded type. Verify scaling with `-cpu` benchmarks.

### Phase 4: Per-P only if needed

If sharded is still not enough, move to per-P. Accept the runtime dependency.

### Phase 5: Sloppy for the extremes

If even per-P is not enough (extremely high write rate, freshness not critical), introduce sloppy. Carefully document the staleness contract.

Most services stop at Phase 2 or 3. Only a few systems (high-frequency trading, in-process stream processing) need Phase 4 or 5.

---

## Deep Dive: Migration from `atomic.Int64` to Sharded

If you have a working `atomic.Int64` counter and want to upgrade to sharded without changing the public API, hide it behind an interface:

```go
type Counter interface {
    Inc()
    Add(int64)
    Get() int64
    Reset() int64
}

// V1: Plain atomic
type plainCounter struct { v atomic.Int64 }
func (p *plainCounter) Inc()              { p.v.Add(1) }
func (p *plainCounter) Add(n int64)       { p.v.Add(n) }
func (p *plainCounter) Get() int64        { return p.v.Load() }
func (p *plainCounter) Reset() int64      { return p.v.Swap(0) }

// V2: Sharded
type shardedCounter struct { *Sharded }
// ... implements Counter

func NewCounter() Counter {
    if highContention { return &shardedCounter{New(64)} }
    return &plainCounter{}
}
```

Callers continue to use `Inc`/`Get` as before. Migration is invisible.

---

## Deep Dive: Cost of `procPin`

`runtime_procPin` does the following:

1. Disable preemption (set a flag on the goroutine).
2. Return the current P index.

It does *not* call into the scheduler, allocate, or block. Cost: ~1-2 nanoseconds.

`runtime_procUnpin` is the symmetric operation. Same cost.

So a per-P counter's `Inc()` is:

- procPin (~2 ns)
- atomic load of cells pointer (~1 ns)
- atomic Add on the cell (~5 ns uncontended)
- procUnpin (~2 ns)

Total: ~10 ns. Roughly 2× a bare `atomic.Int64.Add(1)`, but **uncontended** regardless of core count. At 16 cores hammering, the bare atomic costs 500 ns and per-P costs 10 ns — a 50× speedup.

---

## Closing the Senior

The senior level is the inflection point: from "use atomic" to "design for cache hierarchy". The patterns scale to genuinely high-throughput services. They also introduce the complexity that the professional level handles holistically — combining counters with histograms, exposing through proper metric systems, and architecting observability subsystems.

Practise:

- Padded sharded counter
- Per-P counter with `procPin`
- Sloppy counter with periodic flush
- Bench at multiple core counts
- Read your own assembly for atomic ops

When you can do all five with confidence, you are ready for the professional file: HDR histograms, NUMA, expvar+Prometheus integration, and full observability subsystem design.

---

## Appendix: Cache Line Size Quick Reference

| Architecture | Cache Line Size |
|--------------|----------------|
| x86-64 (Intel, AMD)        | 64 bytes  |
| ARM Cortex-A series        | 64 bytes  |
| ARM Cortex-X / Neoverse-V  | 64 bytes  |
| Apple Silicon (M1/M2/M3)   | 128 bytes |
| IBM POWER                  | 128 bytes |
| RISC-V (most)              | 64 bytes  |

Always use `cpu.CacheLinePad` rather than hardcoding 56 or 120 bytes. The package handles per-architecture sizing.

---

## Appendix: Counter Decision Flowchart

```
Is the counter on a hot path?
   no  -> use plain atomic.Int64
   yes -> Is exact freshness needed?
            no  -> use sloppy counter
            yes -> Is per-P shard acceptable?
                     yes -> use per-P sharded
                     no  -> Is fixed N OK?
                              yes -> use padded sharded (hash)
                              no  -> use LongAdder-style
```

Use this when designing. Adjust by measurement.

---

## Appendix: A Sloppy Counter With Buffered Channel for Flush

Sometimes you want flush to happen on a dedicated thread:

```go
type ChanSloppy struct {
    global  atomic.Int64
    flushCh chan int64
}

func NewChanSloppy(buf int) *ChanSloppy {
    s := &ChanSloppy{flushCh: make(chan int64, buf)}
    go s.run()
    return s
}

func (s *ChanSloppy) run() {
    for delta := range s.flushCh {
        s.global.Add(delta)
    }
}

type ChanLocal struct {
    parent *ChanSloppy
    n      int64
    batch  int64
}

func (l *ChanLocal) Inc() {
    l.n++
    if l.n >= l.batch {
        l.parent.flushCh <- l.n
        l.n = 0
    }
}
```

The local sends a delta to the channel; the dedicated goroutine adds to the global. If the channel is full, the local blocks (or you can use a `select` to drop on the floor).

This is heavier than direct atomic flush — the channel itself has overhead — but it isolates the global atomic to one goroutine, eliminating its contention entirely.

For most workloads, the direct-atomic flush is simpler and faster.

---

## Appendix: Counter Memory Budget

For a service with 100 counters:

| Strategy | Memory | Notes |
|----------|--------|-------|
| Single atomic each | 800 B | 8 bytes × 100 |
| Padded single each | 12.8 KB | 128 bytes × 100 |
| Sharded × 64 each | 6.4 KB (naive) / 800 KB (padded) | 8 × 64 × 100 vs 128 × 64 × 100 |
| Per-P (P=16) | 200 KB | 128 × 16 × 100 |
| Sloppy + globals | 800 B (+ per-goroutine local) | depends on goroutine count |

For a single-instance Go service, even the padded sharded case (~800 KB) is trivial. For a service running 1000 instances on small VMs, the memory cost adds up — measure.

---

## Appendix: A Real-World Story

A team running a Go service at ~500K RPS noticed their `request_duration_seconds_sum` counter (a Prometheus counter accumulating total handler duration) was the #1 hot atomic in their CPU profile, consuming ~8% of CPU.

Diagnosis: 16 cores, single `atomic.Int64` (well, float64-bits in `atomic.Uint64`). At 500K writes/sec × 64-byte cache line bouncing → 32M cache transfers/sec, dominating the L3 traffic.

Fix: per-P sharded counter, summed at scrape time. CPU dropped to ~0.5%. Throughput increased 12%. Memory cost: 16 × 128 = 2 KB. Code change: ~50 lines.

That is the senior-level payoff. A 16× CPU win on one counter, achievable in an afternoon.

---

## Final Word for Seniors

The art is knowing which counter to optimise. Most are fine as `atomic.Int64`. The few that matter — find them in profiles, pad them, shard them, and watch your service scale.

The professional file builds on this by integrating counters into a full observability subsystem, adding histograms for the distributions that counters cannot express, and dealing with the NUMA and multi-process edge cases that show up at extreme scale.

---

## Appendix: Comparative Study of Sharded Counter Libraries

The Go ecosystem has several existing sharded counter libraries. Studying them teaches design.

### `github.com/yourbase/sloppy-counter` (illustrative)

Typical structure:

```go
type Counter struct {
    cells [64]struct {
        _ [64]byte // padding
        v atomic.Int64
    }
}
```

Simple, fixed-N, hash-based shard selection. Common across many libraries.

### `github.com/uber-go/atomic`

Wraps `sync/atomic` with type-safe value types. Does *not* shard or pad. Use it for clarity; it does not solve contention.

### Internal Google libraries

Use per-P sharding with explicit cell arrays sized to `GOMAXPROCS`. The pattern is identical to the `NewPerP` shown above.

### Lessons

- Most libraries do not pad correctly across architectures. Verify with `cpu.CacheLinePad`.
- Most libraries use a fixed shard count. Few are dynamic.
- Most do not support `Reset` cleanly.
- Most do not expose to Prometheus. You wire that up yourself.

When picking a library, audit the cache-line padding code first.

---

## Appendix: Go Runtime Counter Patterns

The Go runtime itself uses counters. Studying its sources teaches idioms.

### `mstats` — runtime memory statistics

Uses atomic counters with no sharding. Reads dominate (via `runtime.ReadMemStats`), writes are rare (GC events).

### `gctrace`

A `atomic.Uint64` counts GC cycles. Single counter, low write rate.

### `sched.npidle`

A per-P-state counter, incremented when a P goes idle and decremented when it activates. Implemented as `atomic.Int32`.

### `racectx` counters

The race detector maintains per-goroutine event counters. These are per-goroutine local — the sloppy pattern.

The runtime's choices are guided by access frequency:

- Very low rate, hot reads: single atomic.
- Per-P access, balanced: per-P with cell array.
- Per-goroutine, very high rate: local with periodic flush.

Same trade-offs as user-space.

---

## Appendix: Counter API Design Lessons

When designing a counter API, consider:

### 1. Return values

Should `Inc()` return the new value?

```go
// Option A: void return
func (c *Counter) Inc()
// Option B: return new value
func (c *Counter) Inc() int64
```

`atomic.Int64.Add(1)` returns the new value. `expvar.Int.Add(delta)` does not. Consistency with the underlying primitive vs. ergonomics — pick one.

### 2. Increment vs Add

```go
c.Inc()          // increment by 1
c.Add(n)         // add n
```

Some APIs collapse these (`Add(1)` vs `Add(n)`); others split. Splitting makes the common case (`Inc`) more readable.

### 3. Reset semantics

`Reset()` returns the previous value (`Swap(0)`). Some APIs do not provide reset (Prometheus counters are deliberately reset-resistant — the model is "increment forever; the scrape engine computes rates"). Choose explicitly.

### 4. Type-level monotonicity

```go
type Counter struct { ... }  // monotonic; no Dec
type Gauge struct { ... }     // up & down
```

vs.

```go
type Counter struct { ... }  // up & down; user contracts monotonicity
```

The first is safer; the second is shorter. Pick one.

### 5. Label support

Some APIs require label values; others have separate types for labeled/unlabeled. Prometheus client_golang chose `CounterVec` for labeled. Simple to use; some performance cost.

### 6. Thread-safety contract

Document explicitly:

```go
// Counter is safe for concurrent use from any number of goroutines.
// All methods are atomic and never block.
type Counter struct { ... }
```

Avoid leaving the contract ambiguous.

---

## Appendix: Reading Generated Assembly

Sometimes the only way to verify your counter is fast is to read the generated code.

```bash
go build -gcflags="-S" ./counter/...
```

Or for a single function:

```bash
go tool compile -S counter.go | less
```

Look for:

- `LOCK XADDQ` — atomic add on x86-64 (good)
- `LOCK CMPXCHGQ` — CAS on x86-64
- `LDADDAL` — atomic add on ARMv8.1+ (good)
- `LDAXR` / `STLXR` — load-acquire-exclusive / store-release-exclusive (CAS retry loop on older ARM)
- `BL runtime.lock2` — runtime mutex (bad if unexpected; means your "atomic" is actually mutex-protected)
- `BL runtime.morestack` — stack growth (rare; shouldn't be in your hot path)

Verify that your `atomic.Int64.Add(1)` compiles to a single `LOCK XADDQ`, not a function call. If you see a `CALL`, something is wrong (inlining failed, or you have an interface dispatch).

---

## Appendix: Counter Performance vs Goroutine Count

A subtle effect: as you add goroutines, even non-contended atomic ops slow down. The reason is scheduler overhead — more goroutines = more context switches = more cache misses on the goroutine's own data.

Benchmark a sloppy counter with varying goroutine count:

```go
func BenchmarkSloppy(b *testing.B) {
    var s Sloppy
    for _, g := range []int{1, 10, 100, 1000, 10000} {
        b.Run(fmt.Sprintf("g=%d", g), func(b *testing.B) {
            var wg sync.WaitGroup
            for i := 0; i < g; i++ {
                wg.Add(1)
                go func() {
                    defer wg.Done()
                    local := s.Local(1024)
                    defer local.Flush()
                    for j := 0; j < b.N/g; j++ {
                        local.Inc()
                    }
                }()
            }
            wg.Wait()
        })
    }
}
```

Even though the sloppy counter has no inter-goroutine contention, throughput per goroutine falls as goroutine count rises. The cause is scheduler overhead, not the counter. Important to know when reading benchmarks.

---

## Appendix: Counter in Generic Code

Go generics let you write counter wrappers parameterised by the underlying type:

```go
type Numeric interface {
    ~int32 | ~int64 | ~uint32 | ~uint64
}

type AtomicCounter[T Numeric] struct {
    // Can we use atomic.Int64 here? Not with generics — atomic.Int64
    // is a concrete type. We need a switch or a method-only approach.
}
```

In practice, generics do not play perfectly with `sync/atomic` because the atomic types are concrete. The workaround:

```go
type Counter[T any] struct {
    inc  func() T
    load func() T
    add  func(T) T
}

func NewInt64Counter() *Counter[int64] {
    var v atomic.Int64
    return &Counter[int64]{
        inc:  func() int64 { return v.Add(1) },
        load: func() int64 { return v.Load() },
        add:  func(n int64) int64 { return v.Add(n) },
    }
}
```

Awkward. For most code, prefer concrete types.

---

## Appendix: Counter Telemetry Beyond Counts

Once you have a counter, you often want derived metrics:

- **Rate**: counter / time (handled by scraping system, not by the counter itself)
- **Acceleration**: rate of change of the rate (rarely needed; usually a smoothed rate is enough)
- **Percentile of values**: requires a histogram, not a counter
- **Anomaly score**: usually built on top of rate/histogram outside the counter

Resist the urge to add these to the counter itself. Counter = increment + load. Anything more belongs in the metrics pipeline.

---

## Appendix: A Note on `sync.Pool` and Counter Locality

`sync.Pool` uses per-P sharding, the same technique discussed for counters. The result: when you `Put` a value into a pool, it tends to be retrievable by the same P that put it — i.e., the same OS thread, the same CPU core, the same L1 cache. This is exactly why `sync.Pool` is fast.

Can you reuse `sync.Pool` for counter cells? Yes, but awkwardly:

```go
var counterPool = sync.Pool{New: func() any { return new(atomic.Int64) }}

// Increment:
c := counterPool.Get().(*atomic.Int64)
c.Add(1)
// But how do you read total? You can't — Pool doesn't iterate.
```

The issue: `sync.Pool` is *not* iterable. You cannot sum across all entries. So it cannot directly serve as a counter, only as a fast allocator.

For counters, the per-P pattern (allocate cells once, index by P) is the right tool.

---

## Appendix: Counter Lifecycle Management

Counters have a lifecycle:

- **Creation**: allocate cells, register with metric system
- **Active**: increment, read, snapshot
- **Reset / rotate**: periodically zero out (or snapshot-and-zero)
- **Destruction**: at process shutdown, unregister, flush sloppy locals

For long-lived services, the lifecycle is "create at startup, never destroy". For request-scoped counters (e.g., per-trace), you destroy them when the trace ends.

A common pattern for trace-scoped counters: allocate inline in a request context struct. No registry needed; the counter dies with the request.

```go
type RequestStats struct {
    DBQueries atomic.Int64
    CacheHits atomic.Int64
    BytesRead atomic.Int64
}

func Handler(ctx context.Context, r *http.Request) {
    stats := &RequestStats{}
    ctx = context.WithValue(ctx, statsKey, stats)
    // ... process ...
    log.Printf("dbq=%d cache=%d bytes=%d",
        stats.DBQueries.Load(), stats.CacheHits.Load(), stats.BytesRead.Load())
}
```

No padding (single request → low contention), no sharding, just embedded atomics. The right choice for request-scoped data.

---

## Appendix: Counters and Tracing

Distributed tracing (OpenTelemetry, Jaeger, Zipkin) uses counter-like primitives:

- A per-trace span counter
- A per-service span counter
- Sampled vs unsampled counts

These are typically `atomic.Int64`. At high trace rates, padded sharded counters help.

The integration with tracing is at the *output* level: the counter's value goes into span attributes or service-level metrics. The counter itself is independent.

---

## Appendix: Building a Counter Test Harness

A reusable test harness for any counter type:

```go
package counters

import (
    "sync"
    "testing"
)

type Counter interface {
    Inc()
    Add(int64)
    Get() int64
}

func CorrectnessTest(t *testing.T, c Counter, name string) {
    t.Run(name, func(t *testing.T) {
        const N = 100_000
        var wg sync.WaitGroup
        wg.Add(N)
        for i := 0; i < N; i++ {
            go func() { defer wg.Done(); c.Inc() }()
        }
        wg.Wait()
        if got := c.Get(); got != N {
            t.Errorf("expected %d, got %d", N, got)
        }
    })
}

func TestAllCounters(t *testing.T) {
    CorrectnessTest(t, &plainCounter{}, "plain")
    CorrectnessTest(t, &paddedCounter{}, "padded")
    CorrectnessTest(t, New(64), "sharded")
    CorrectnessTest(t, NewPerP(), "per-p")
    // sloppy needs special handling for Flush
}
```

Now adding a new counter type to your library only requires plugging it into `TestAllCounters`. Correctness regressions surface immediately.

---

## Appendix: Property-Based Testing for Counters

Use property-based testing to find weird inputs:

```go
import "testing/quick"

func TestProperty_AddCommutes(t *testing.T) {
    f := func(deltas []int32) bool {
        c := New(64)
        for _, d := range deltas {
            c.Add(int64(d))
        }
        sum := int64(0)
        for _, d := range deltas {
            sum += int64(d)
        }
        return c.Get() == sum
    }
    if err := quick.Check(f, &quick.Config{MaxCount: 1000}); err != nil {
        t.Error(err)
    }
}
```

The property: `c.Get()` equals the sum of all deltas. Add concurrent variants by adding goroutines internally.

---

## Appendix: Counter Telemetry Cost in CI

Adding counters has CI cost:

- More tests to run (correctness tests)
- More benchmarks to track (regression detection)
- More metric output to validate (snapshot tests)

Plan for it. Counter tests should be fast (< 1 second per counter). Benchmarks should run at one core count in CI (the multi-core scaling tests run on dedicated benchmark hardware).

---

## Appendix: Counters in Cgo

If your Go code calls C via cgo, you may want to count cgo calls or measure their latency. Atomic counters work fine across cgo boundaries:

```go
import "C"

var cgoCalls atomic.Int64

func wrapCFunction() {
    cgoCalls.Add(1)
    C.cfunc()
}
```

Note: cgo calls are expensive (~50-100 ns of overhead). A single atomic add is a tiny fraction of that. Counter contention is not a concern in cgo-heavy code; the cgo itself dominates.

---

## Appendix: Counters and Garbage Collection

Counter writes do not directly trigger GC, but:

- Counters in long-lived structs are part of the heap GC set.
- `LongAdder`-style growing arrays allocate, contributing to GC pressure.
- Sloppy counters allocate per goroutine for `Local` structs.

For most services, this is negligible. For low-latency services (< 1 ms tail), be aware of allocation patterns. A padded sharded counter allocates once at startup; that is ideal.

---

## Appendix: A Walkthrough of `unsafe.Pointer` Alignment

If you really need to bend the rules, `unsafe.Pointer` lets you control memory layout precisely. Example: aligning an `int64` to a cache line:

```go
import "unsafe"

const cacheLine = 64

type aligned struct {
    buf [cacheLine + 8]byte
    ptr unsafe.Pointer
}

func newAligned() *aligned {
    a := &aligned{}
    addr := uintptr(unsafe.Pointer(&a.buf[0]))
    aligned := (addr + cacheLine - 1) &^ (cacheLine - 1)
    a.ptr = unsafe.Pointer(aligned)
    return a
}

func (a *aligned) Int64() *int64 {
    return (*int64)(a.ptr)
}
```

Use sparingly. In 99% of cases, struct-based padding is sufficient and safer.

---

## Final Thoughts

The senior-level concurrent counter is an exercise in understanding the entire stack: CPU instructions, cache hierarchy, scheduler integration, and library design. The patterns covered here — padding, sharding, per-P, sloppy, `LongAdder` — represent decades of refinement in concurrent systems.

Master them, use them when needed, and avoid the temptation to use them when not needed. A `single atomic.Int64` is still the right answer for most counters in your service.

The professional file completes the picture: distributions (HDR histograms), NUMA awareness, `expvar`/Prometheus/OpenTelemetry integration, and the design of a full metrics subsystem.

See you there.

---

## Appendix: Extended Case Studies in Counter Design

### Case Study 1: Database Connection Pool

A `sql.DB` connection pool tracks several counters: open connections, in-use connections, idle connections, wait events, max-lifetime closes, max-idle closes. Each is hit on every `db.Query` call.

A 10K-RPS service with 16 cores has 160K counter operations per second per counter. Six counters → ~1M ops/sec total counter writes. On a single atomic each, the L3 cache traffic would dominate.

Design choice (in the standard library): each counter is `atomic.Int64`, but they are *separate* fields in different structs so they sit on different cache lines naturally. The compiler ensures fields are spread across cache lines because the structs are larger than 64 bytes.

If you build your own pool, follow the same pattern: group related counters in separate structs so layout gives them natural separation.

### Case Study 2: HTTP server middleware chain

A typical middleware chain has 5-10 layers, each with its own counters (entered, finished, error, panic-recovered). Naively each is a separate atomic. With 10 middlewares × 4 counters = 40 atomic fields in a single struct, packed in 320 bytes (5 cache lines). At high RPS, every request hits every middleware, so all 5 cache lines bounce between cores.

Improvement: split counters by middleware into separate structs, each padded:

```go
type MiddlewareStats struct {
    _ cpu.CacheLinePad
    Entered atomic.Int64
    Finished atomic.Int64
    Errored atomic.Int64
    Panicked atomic.Int64
    _ cpu.CacheLinePad
}
```

Each middleware's stats live on one cache line, but different middlewares' stats are on different lines. Contention isolated.

For very high RPS, further shard each one.

### Case Study 3: Background job processor

A worker pool with 64 workers processes jobs from a channel. Each worker emits 4 counters per job (started, finished, succeeded, failed). At 100K jobs/sec, that is 400K counter writes/sec, but split across 64 worker goroutines.

The key insight: most counter writes happen in the worker, by the worker, for the worker's own job. Per-worker counters with periodic aggregation (sloppy pattern) are ideal:

```go
type WorkerStats struct {
    Started   int64
    Finished  int64
    Succeeded int64
    Failed    int64
}

type Pool struct {
    workers []*Worker
}

func (p *Pool) Snapshot() WorkerStats {
    var total WorkerStats
    for _, w := range p.workers {
        total.Started += atomic.LoadInt64(&w.Stats.Started)
        total.Finished += atomic.LoadInt64(&w.Stats.Finished)
        total.Succeeded += atomic.LoadInt64(&w.Stats.Succeeded)
        total.Failed += atomic.LoadInt64(&w.Stats.Failed)
    }
    return total
}
```

Each worker's stats are its own. No cross-worker contention. Reads are O(workers).

### Case Study 4: Real-time analytics counter

A service ingesting events from many sources, counting them by type. The type set is dynamic (new event types appear). Cardinality may be hundreds to thousands.

Design choice: `sync.Map[eventType]*Sharded` — a map of sharded counters, allocated lazily.

```go
type Analytics struct {
    counters sync.Map // map[string]*Sharded
}

func (a *Analytics) Record(eventType string) {
    v, ok := a.counters.Load(eventType)
    if !ok {
        v, _ = a.counters.LoadOrStore(eventType, New(64))
    }
    v.(*Sharded).Inc()
}

func (a *Analytics) Snapshot() map[string]int64 {
    out := map[string]int64{}
    a.counters.Range(func(k, v any) bool {
        out[k.(string)] = v.(*Sharded).Get()
        return true
    })
    return out
}
```

Trade-offs:

- `sync.Map.Load` is fast for existing keys (no lock for the read).
- Each counter is padded sharded; high write throughput per type.
- Memory grows with cardinality. Cap or shed if needed.

### Case Study 5: Game server tick counter

A game server runs a 60-Hz tick. Each tick increments a counter and processes events. Counter access is exactly 60/sec — completely uncontended.

Design choice: bare `atomic.Int64`. No need for sharding, padding, or anything else.

The lesson: not every counter is high-contention. Most aren't. Optimise the ones that show up in profiles; leave the rest alone.

---

## Appendix: Why Not Just Use a Mutex?

A frequent question: why all this complexity? Just use a mutex.

Performance numbers (per operation, on a 16-core x86-64, illustrative):

| Pattern | Uncontended | 16-core contention |
|---------|-------------|---------------------|
| `atomic.Int64.Add` | 5 ns | 500 ns |
| `sync.Mutex`+counter | 25 ns | 5000 ns (with parking) |
| Padded `atomic.Int64.Add` | 5 ns | 250 ns |
| Padded sharded | 8 ns | 30 ns |
| Per-P sharded | 10 ns | 12 ns |
| Sloppy | 1 ns | 1 ns |

At 16-core saturation, the mutex is 400× slower than per-P sharded. That is the gap that justifies the complexity.

If your service is not saturating cores on counter contention, use a mutex. If it is, climb the ladder.

---

## Appendix: Counters and Real-time / Latency-sensitive Code

For latency-sensitive code paths (audio processing, trading systems, game render loops), every nanosecond matters:

- A single atomic add is 5+ ns. Predictable.
- A contended atomic add is up to 500 ns. **Highly variable.** Killer for tail latency.
- A mutex lock can be milliseconds (parking). Catastrophic.
- A sloppy counter increment is 1 ns. Predictable.

Implication: in latency-sensitive code, prefer sloppy counters. The freshness loss is irrelevant; the predictability gain is huge.

---

## Appendix: Cross-language Comparison

How do other languages handle this?

### Java

- `AtomicLong` for single atomic.
- `LongAdder` for high-contention.
- `LongAccumulator` for non-add operations.
- Cache-line padding via `@Contended` annotation.

### Rust

- `std::sync::atomic::AtomicI64` for single.
- `crossbeam::atomic::AtomicCell` for non-primitive types.
- Padding via `crossbeam_utils::CachePadded<T>`.
- No `LongAdder` in std; community crates exist.

### C++

- `std::atomic<int64_t>` for single.
- Padding via `alignas(64)` or `boost::alignment`.
- No `LongAdder` in std; `folly::DistributedMutex` and `folly::Striped` provide similar.

### Go

- `atomic.Int64` for single.
- `golang.org/x/sys/cpu.CacheLinePad` for padding.
- No `LongAdder` in std; community ports exist.
- Per-P sharding via `runtime.procPin` (private API).

Go's standard library is the most conservative — it gives you the primitives but not the high-level patterns. You build them.

---

## Appendix: Counter Specifications Through the Years

Brief history of counter design in concurrent systems:

- **1970s**: Mutex-protected counters. Simple, slow.
- **1980s**: Lock-free single atomic counters using CAS.
- **1990s**: Cache-line awareness; padding becomes common in HPC.
- **2000s**: Per-CPU counters in Linux kernel (`percpu_counter.c`).
- **2010s**: Java's `LongAdder` (Doug Lea); dynamic sharding becomes mainstream.
- **2020s**: Per-P / per-thread counters in language runtimes (Go, Java); cache-line-aware everything.

The design space is mature. The choices are clear; the trade-offs are well-understood.

---

## Appendix: When You Should Roll Your Own

Should you write your own sharded counter, or use a library?

**Roll your own when:**

- You have specific cache-line / NUMA requirements
- You need integration with custom metric systems
- The library does not exist for your language version
- It is an educational exercise

**Use a library when:**

- Your needs are standard (Prometheus counters with labels)
- You want correctness battle-tested
- You want maintenance to happen for you

For Go specifically, the Prometheus client library covers most needs. Roll your own only when integrating with custom systems or pushing extreme performance.

---

## Appendix: Counter Performance Tuning Checklist

When tuning a counter:

- [ ] Profile to confirm it is hot.
- [ ] Verify the access pattern (writes-only? mixed? read-heavy?).
- [ ] Measure scaling at multiple core counts.
- [ ] Check for false sharing (try padding; if it helps, that was the issue).
- [ ] Consider sharding if writes are the bottleneck.
- [ ] Consider sloppy if exact freshness is not needed.
- [ ] Consider per-P if runtime cooperation is acceptable.
- [ ] Re-profile after each change.

Iterate. Each step should improve the profile; if it doesn't, undo.

---

## Appendix: Counter Subsystem Architecture

For a serious Go service, counters are part of a metrics subsystem. The architecture:

```
[Application code]
      |  (atomic.Add)
      v
[Counter primitives]  (single, padded, sharded, per-P, sloppy)
      |
      v
[Metric registry]  (named lookup, type-checked)
      |
      v
[Exposition formats]  (JSON, Prometheus, OTLP, custom)
      |
      v
[Transport]  (HTTP, gRPC, pull, push)
      |
      v
[External system]  (Prometheus, OpenTelemetry, Datadog, ...)
```

Each layer has its own design considerations. Senior file: primitives. Professional file: registry, exposition, transport.

---

## Appendix: Twenty Real-World Patterns

A grab-bag of counter patterns seen in production Go code:

1. **HTTP status counter** — `LabeledCounter[int]` keyed by status code.
2. **Route-level latency sum** — `atomic.Int64` (nanos); paired with `requests_total` for average.
3. **DB query type counter** — `LabeledCounter[string]` keyed by SQL pattern fingerprint.
4. **Per-tenant request counter** — `sync.Map[tenantID]*Sharded` lazy allocated.
5. **Goroutine ID counter** — incremented for trace IDs; bare `atomic.Int64` works.
6. **Cache hit rate** — pair of atomics (`hits`, `misses`); rate computed at scrape.
7. **Connection pool stats** — multiple atomic fields in a struct, naturally cache-line separated.
8. **Worker pool throughput** — sloppy counter; per-worker local, periodic flush.
9. **Heartbeat counter** — bumped every second by a background goroutine; watchdog detects freeze.
10. **Leader epoch counter** — incremented on leadership change; CAS-loop ensures monotonic.
11. **Snapshot version** — bumped before/after batch writes; readers detect concurrent modification.
12. **Retry attempt counter** — per-call, embedded in context; never global.
13. **Rate-limit token counter** — `atomic.Int64` with periodic refill; CAS for decrement-with-floor.
14. **Backpressure gauge** — `atomic.Int64` of in-flight; refuse new work above threshold.
15. **Test assertion counter** — `atomic.Int64` to count callback invocations; final assertion in test.
16. **Resource leak counter** — `atomic.Int64` of "still held"; verify zero at shutdown.
17. **Panic counter** — bumped in `defer recover`; alerts if growing.
18. **Span counter** — incremented per trace span; sharded for high-throughput tracing.
19. **Bytes transferred** — sloppy counter for hot pipelines; atomic for slow ones.
20. **Cron-fired counter** — bumped by scheduled tasks; bare atomic works fine.

Each pattern reflects the same toolkit applied to a different shape of contention.

---

## Appendix: Counter Anti-Patterns

Patterns that look reasonable but are wrong:

### Anti-pattern: Counter inside a mutex with non-counter work

```go
mu.Lock()
counter.Add(1)
doExpensiveThing()
mu.Unlock()
```

The mutex serialises far more than the counter increment. Split: atomic counter outside, mutex only around the work that needs it.

### Anti-pattern: Counter as cache validity check

```go
if cache.refreshed.Load() > 0 {
    return cache.value
}
```

Uses a counter as a sentinel. Use `atomic.Bool` instead — explicit, clearer.

### Anti-pattern: Counter mutated via `unsafe.Pointer`

```go
unsafePtr := (*int64)(unsafe.Pointer(&c.v))
*unsafePtr++
```

Bypasses atomics. Race detector flags it (and rightly so).

### Anti-pattern: Counter shared across processes via mmap

```go
mapped := mmap("counter.bin", 8)
atomic.AddInt64((*int64)(mapped), 1)
```

Theoretically works on cooperative platforms; in practice the memory model across processes is fragile. Use a database INCREMENT instead.

### Anti-pattern: Counter resetting after every read

```go
n := c.Swap(0)
fmt.Println(n)
n = c.Swap(0) // probably zero now!
```

Subtle: `Swap(0)` is destructive. If multiple readers expect to see the value, only the first one does. Document explicitly.

---

## Appendix: Final Self-Assessment

You are senior-level competent with concurrent counters when:

- [ ] You can sketch a padded sharded counter from memory.
- [ ] You can explain false sharing to a junior.
- [ ] You have read the `sync.Pool` source.
- [ ] You can write per-P counters with `procPin` and explain the caveats.
- [ ] You can write a sloppy counter and articulate its staleness contract.
- [ ] You can sketch `LongAdder`'s algorithm at a high level.
- [ ] You can interpret a `-bench -cpu` scaling chart.
- [ ] You know when to *not* shard, *not* pad, *not* per-P.
- [ ] You have profiled a real service and made counter-design decisions based on data.
- [ ] You can defend any of these choices in a design review.

If all ten are true, you are ready for the professional file.

---

## Truly Final Word for Seniors

The senior level is where you stop reaching for a single primitive and start composing. Counters are no longer one thing; they are a family of trade-offs along axes of contention, freshness, complexity, and integration.

The professional file is the next horizon: distributions (HDR histograms — because counts are not enough), full observability stacks (`expvar`/Prometheus/OpenTelemetry side-by-side), NUMA awareness, multi-process metric aggregation, and the design choices behind production-grade observability subsystems.

You have the foundations. Build them well.

---

## Appendix: A Long-Form Walkthrough — Building a Padded Sharded Counter from Scratch

We have shown the code; now let us walk through every decision, including the ones that did not make the cut.

### Decision 1: Should the cells be in a slice or a fixed array?

A fixed-size array `[64]cell` is allocated inline in the struct; no separate allocation, no indirection.

```go
type Sharded struct {
    cells [64]cell
}
```

But it forces N=64 at compile time. If you want flexibility:

```go
type Sharded struct {
    cells []cell
    mask  uint64
}

func New(n int) *Sharded {
    p := nextPow2(n)
    return &Sharded{cells: make([]cell, p), mask: uint64(p - 1)}
}
```

Slice version is more flexible; the indirection is one extra cache miss but rare in steady state. Use slice for production code, array for tightly-tuned cases.

### Decision 2: Power of 2 vs arbitrary size

Power of 2 lets us use bitwise mask: `cells[k & mask]`. Faster than `cells[k % len]` because integer division is slow.

If your shard count is `runtime.GOMAXPROCS(0)` (which may not be a power of 2), `%` is fine because it is in the hot path only when access patterns are unfortunate.

For random-hash sharding, always round to next power of 2. For per-P sharding, accept the modulo.

### Decision 3: Where to put the padding?

Three options:

```go
// A: pad before only
type cell struct {
    _ cpu.CacheLinePad
    v atomic.Int64
}

// B: pad after only
type cell struct {
    v atomic.Int64
    _ cpu.CacheLinePad
}

// C: pad both sides
type cell struct {
    _ cpu.CacheLinePad
    v atomic.Int64
    _ cpu.CacheLinePad
}
```

Option A and B each prevent contention with one neighbour (the one in the direction of padding). Option C protects both sides — a bit safer but uses twice the memory.

For an array of cells: option A is sufficient if every cell starts with padding. The padding before cell N+1 doubles as padding after cell N.

For a stand-alone padded atomic, option C is safer.

### Decision 4: Random shard selection

Choices:

- `rand.Uint64() & mask` — uniform but loses goroutine locality
- `runtime_fastrand() & mask` — same, but cheaper (per-P RNG)
- per-goroutine hash — sticky but may be skewed

For most use cases, `runtime.fastrand` is the right balance. It is per-P, cheap, and uniform.

```go
//go:linkname runtime_fastrand runtime.fastrand
func runtime_fastrand() uint32
```

`fastrand` returns `uint32`. For 64-shard counters, mask is `0x3F` (6 bits), well within uint32 range. For more shards, use `runtime.fastrand64`.

### Decision 5: Atomic add inside cells

`atomic.Int64.Add(1)` is the natural choice. The alternatives:

- Non-atomic write (relying on cell isolation): incorrect — readers will tear or see stale values.
- Add via a single `atomic.StoreInt64(&c.v, atomic.LoadInt64(&c.v)+1)` (no XADD): correct but slower and racy at the load-add-store level.

Use `Add` — the hardware `LOCK XADD` is precisely what we want.

### Decision 6: Read order

`Get()` walks cells in order 0..N-1. Walking in random order does not change correctness but may slightly help with branch prediction. Almost never measurable.

### Decision 7: Should `Get` return a snapshot or query each shard live?

Live: `cells[0].v.Load()` for each i. Returns the sum of values at the moment each shard is read — not "the value at time T".

Snapshot: read all cells into a slice, then sum. Same result for our purposes; live is simpler.

### Decision 8: Error handling

`Get`, `Inc`, `Add`, `Reset` — none can fail. No error returns. Keep the API clean.

### Decision 9: Documentation

```go
// Sharded is a sharded counter with cache-line-aligned cells.
// Inc is safe for concurrent use from any number of goroutines and
// scales near-linearly to GOMAXPROCS. Get is O(N) in shard count
// and intended for periodic reads (e.g., metrics scrapes).
//
// The shard is chosen using runtime.fastrand. Per-goroutine sticky
// sharding is not guaranteed; under heavy load, cells are balanced
// statistically.
type Sharded struct { ... }
```

Document the contention model. Future readers (you, in six months) will thank you.

### Decision 10: Testing

Standard tests:

- Correctness: N goroutines × M increments each → total == N*M.
- Reset: Reset returns the prior sum; subsequent Get is zero.
- Race-free: pass `-race`.
- Scaling: benchmark at `-cpu=1,2,4,8,16,32`; ops/sec increases roughly linearly with cores.

Extra tests:

- Cell alignment: assert adjacent cells are `>=` CacheLinePadSize apart.
- Cardinality: assert all cells are touched after many increments (no shard is permanently cold).

This is the level of care a production sharded counter deserves.

---

## Appendix: Per-CPU vs Per-P Subtlety

"Per-CPU" and "Per-P" are similar but not identical:

- **Per-CPU**: one counter per physical CPU core. The increment goes to "whichever core I'm running on". Requires pinning at OS level.
- **Per-P**: one counter per Go P. The increment goes to "whichever P my goroutine is on". Pinning via `procPin`.

A Go P maps to an OS thread, which the kernel can schedule on any core. Two goroutines on the same P (executing serially) use the same cell. But the *OS thread itself* may migrate between cores between executions of that P's work, causing the cell's cache line to migrate with it.

This is usually fine. The cache line stays in *one* core's cache at a time, never bouncing between cores due to writes. Migration costs are real but rare (once per few milliseconds at most).

For true per-core (no migration), use `runtime.LockOSThread` plus CPU pinning via `taskset` or `sched_setaffinity`. Much more invasive; rarely justified.

---

## Appendix: Sharded Counter Latency Distribution

A single atomic add has very low variance: uncontended ~5 ns, contended ~50-200 ns. Both Gaussian-ish.

A padded sharded counter has *bimodal* latency:

- Most increments: ~5 ns (no contention, hits L1).
- Some increments: ~20-50 ns (cache line in L2 or another core's L2).

The bimodality matters for tail-latency-sensitive workloads. For p99 latency budgets, even a "fast" sharded counter can blow your budget if you increment it many times per request.

Mitigation: increment locally and flush once per request.

```go
func handler(w http.ResponseWriter, r *http.Request) {
    local := 0
    for _, item := range items {
        process(item)
        local++
    }
    globalCounter.Add(int64(local))
}
```

One atomic add per request, regardless of items processed. Lower tail latency.

---

## Appendix: Sharded Counter Memory Locality

A subtle effect: even with padding, the *cell array itself* lives in some location. If the array is sized to fit in L2 of one core (say, 1 KB for a 64-shard padded array on x86-64), reads of the whole array sum quickly. If it is larger than L2, reads spill to L3 or memory.

For very large shard counts (1024+), this matters. The read of `Get()` becomes "cold" — first-touch cache misses on every cell. Slow.

For most realistic shard counts (64-256), the array fits in L2 and reads are fast.

---

## Appendix: Sharded Counter on Apple Silicon

Apple Silicon has 128-byte cache lines. Padding to 64 bytes is insufficient. Always use `cpu.CacheLinePad`:

```go
import "golang.org/x/sys/cpu"

type cell struct {
    _ cpu.CacheLinePad // 128 bytes on darwin/arm64
    v atomic.Int64
    _ cpu.CacheLinePad
}
```

Each cell is now ~272 bytes. 64 cells = 17 KB. Still tiny.

Verify on M-series Macs:

```go
import "fmt"
import "unsafe"
import "golang.org/x/sys/cpu"

fmt.Println(unsafe.Sizeof(cell{}))    // should be >= 2*cpu.CacheLinePadSize + 8
fmt.Println(cpu.CacheLinePadSize)      // 128 on Apple Silicon, 64 elsewhere
```

---

## Appendix: Counter Naming Conventions Recap

Already mentioned earlier; here in one place for senior reference:

| Naming style | Use for |
|--------------|---------|
| `foo_total` | Monotonic counter |
| `foo` (no suffix) | Gauge |
| `foo_seconds_total` | Sum of durations (counter) |
| `foo_bytes_total` | Sum of bytes (counter) |
| `foo_inflight` | Current in-flight count (gauge) |
| `foo_max` | Maximum observed value |
| `foo_min` | Minimum observed value |
| `foo_p99` | 99th percentile (from histogram, not counter) |

Stick to these. Operators will love you.

---

## Appendix: Beyond Counters — When to Reach for Histograms

Once your counter starts being used for "compute average latency", you have outgrown the counter. Symptoms:

- You have `latency_sum_ns` and `latency_count` separately.
- You compute `avg = sum / count` somewhere.
- Operators ask "what is the p95?" and you cannot answer.

Move to a histogram. The professional file covers HDR histograms in depth. Preview:

- A histogram is an array of buckets, each counting observations in a value range.
- Each observation increments one bucket — exactly the counter primitive you already know.
- The bucket boundaries are logarithmic, fixed at construction.
- Percentiles are computed by walking buckets and finding the count threshold.

So a histogram is just N counters with structure. The senior-level skills transfer directly.

---

## Appendix: A Senior's Counter Toolbox

For your reference, here is the full senior-level toolbox in one snippet:

```go
package counters

import (
    "runtime"
    "sync"
    "sync/atomic"
    "unsafe"
    _ "unsafe"

    "golang.org/x/sys/cpu"
)

// --- Padded single atomic ---
type Padded struct {
    _ cpu.CacheLinePad
    V atomic.Int64
    _ cpu.CacheLinePad
}

// --- Padded sharded counter ---
type cell struct {
    _ cpu.CacheLinePad
    v atomic.Int64
    _ cpu.CacheLinePad
}

type Sharded struct {
    cells []cell
    mask  uint64
}

func NewSharded(n int) *Sharded {
    p := 1
    for p < n {
        p <<= 1
    }
    return &Sharded{cells: make([]cell, p), mask: uint64(p - 1)}
}

//go:linkname runtime_fastrand runtime.fastrand
func runtime_fastrand() uint32

func (s *Sharded) Inc()         { s.cells[uint64(runtime_fastrand())&s.mask].v.Add(1) }
func (s *Sharded) Add(n int64)  { s.cells[uint64(runtime_fastrand())&s.mask].v.Add(n) }
func (s *Sharded) Get() int64 {
    var t int64
    for i := range s.cells {
        t += s.cells[i].v.Load()
    }
    return t
}
func (s *Sharded) Reset() int64 {
    var t int64
    for i := range s.cells {
        t += s.cells[i].v.Swap(0)
    }
    return t
}

// --- Per-P counter ---
//go:linkname runtime_procPin runtime.procPin
func runtime_procPin() int

//go:linkname runtime_procUnpin runtime.procUnpin
func runtime_procUnpin()

type PerP struct {
    cells []cell
}

func NewPerP() *PerP {
    return &PerP{cells: make([]cell, runtime.GOMAXPROCS(0))}
}

func (p *PerP) Inc() {
    pid := runtime_procPin()
    if pid < len(p.cells) {
        p.cells[pid].v.Add(1)
    } else {
        p.cells[pid%len(p.cells)].v.Add(1)
    }
    runtime_procUnpin()
}

func (p *PerP) Get() int64 {
    var t int64
    for i := range p.cells {
        t += p.cells[i].v.Load()
    }
    return t
}

// --- Sloppy counter ---
type Sloppy struct {
    Global atomic.Int64
}

type Local struct {
    parent  *Sloppy
    n       int64
    flushAt int64
}

func (s *Sloppy) Local(flushAt int64) *Local {
    return &Local{parent: s, flushAt: flushAt}
}

func (l *Local) Inc() {
    l.n++
    if l.n >= l.flushAt {
        l.parent.Global.Add(l.n)
        l.n = 0
    }
}

func (l *Local) Flush() {
    if l.n > 0 {
        l.parent.Global.Add(l.n)
        l.n = 0
    }
}

// --- Multi-counter snapshot ---
type Snapshot struct {
    Requests int64
    Errors   int64
    InFlight int64
}

type Snapshotter struct {
    requests *Sharded
    errors   *Sharded
    inflight atomic.Int64
    snap     atomic.Pointer[Snapshot]
}

func (s *Snapshotter) Refresh() {
    s.snap.Store(&Snapshot{
        Requests: s.requests.Get(),
        Errors:   s.errors.Get(),
        InFlight: s.inflight.Load(),
    })
}

// --- Helper: assert cell alignment ---
func cellsAreAligned(cells []cell) bool {
    if len(cells) < 2 {
        return true
    }
    diff := uintptr(unsafe.Pointer(&cells[1])) - uintptr(unsafe.Pointer(&cells[0]))
    return diff >= uintptr(cpu.CacheLinePadSize)
}

// --- noCopy enforcement (paste from sync source) ---
type noCopy struct{}

func (*noCopy) Lock()   {}
func (*noCopy) Unlock() {}

// Use as a field in any struct that must not be copied:
//   type Sharded struct {
//       _ noCopy
//       cells []cell
//       mask  uint64
//   }
```

Save this file. Reuse it. It is the heart of your senior-level counter library.

---

## Appendix: Where to Go Next

If you have absorbed everything in this file, your next learning steps:

1. **Histograms (professional file).** Distributions, not just counts. The HDR algorithm.
2. **NUMA-aware sharding (professional file).** Pin shards to sockets.
3. **`expvar` + Prometheus + OpenTelemetry side-by-side (professional file).** Real observability subsystems use multiple formats.
4. **Lock-free queues and stacks** — the same atomic primitives, applied to data structures.
5. **The Linux kernel's `percpu_counter` and `percpu_refcount`** — beautiful systems code.
6. **Doug Lea's papers on `LongAdder`** — the design rationale.

You have the foundations. Build them well, and pass the knowledge on.

---

## Last Word

Counters are deceptively simple. The path from "make `count++` work concurrently" to "counter that scales near-linearly to 64 cores with bounded latency and low memory footprint" is one of the most instructive journeys in concurrent programming.

At the end of that journey, you will see counters everywhere — in your code, in the standard library, in the runtime, in the kernel. They are the load-bearing primitive of modern concurrent systems.

Use them wisely. Profile before you optimise. Pad before you shard. Shard before you per-P. Per-P before you sloppy. Sloppy only when you must.

The professional file awaits when you are ready.

---

## Appendix: A Final List of Twenty Things a Senior Should Know

1. False sharing is real, measurable, and fixable with padding.
2. `cpu.CacheLinePad` is the portable way to pad.
3. Apple Silicon has 128-byte cache lines.
4. `runtime_procPin` is private API but de-facto stable.
5. `sync.Pool` is the canonical per-P pattern.
6. Sharded counter reads are O(N); plan for it.
7. `LongAdder` solves the "what N?" problem with growth.
8. Sloppy counters are crash-lossy but fast.
9. `Reset` on a sharded counter is not atomic across shards.
10. `atomic.Pointer[T]` is the right tool for multi-counter snapshots.
11. Pad before sharding; check that the cells are actually isolated.
12. Power-of-2 shard counts let you use bitwise mask.
13. `runtime.fastrand` is faster than `rand.Uint64` because it is per-P.
14. The race detector slows code 2-10× but catches everything.
15. Mutex-wrapped atomics are an anti-pattern; remove the mutex.
16. Counter copies are bugs; `go vet` catches them.
17. Goroutine-local sloppy counters need `defer Flush()`.
18. `expvar` is fine for small services; Prometheus for large.
19. Tail latency is dominated by contended atomics; sloppy fixes it.
20. Most counters are not hot. Optimise only the ones that profile shows.

If you can recite all twenty without consulting this file, you have absorbed it.

---

## Appendix: The Counter as Pedagogy

Why dedicate a whole file to "counters"? Because they teach concurrent programming in miniature.

- **Atomicity** — `count++` is three instructions.
- **Memory model** — visibility, ordering, fences.
- **Cache hierarchy** — false sharing, padding.
- **Scheduling** — per-P, per-CPU, scheduler interactions.
- **Trade-offs** — exact vs approximate, fast vs slow, complex vs simple.
- **Profiling** — finding the hot ones.
- **API design** — pointer receivers, zero values, monotonicity.
- **Testing** — race detection, benchmarking, scaling curves.

Mastering counters is a tour of concurrent programming. Mastering them across all four levels (junior → professional) is a credential.

---

## Appendix: A Promise

If you ship a service built on these patterns, in a year you will have at least one war story about counters: a contention problem, a false-sharing surprise, a sloppy counter that should not have been sloppy. Embrace the story. Share it. Counter wisdom is hard-won and shareable.

The next time someone says "it's just a counter", you will know: it is never just a counter. It is the heart of how concurrent systems measure themselves, and the heart of how they scale.





