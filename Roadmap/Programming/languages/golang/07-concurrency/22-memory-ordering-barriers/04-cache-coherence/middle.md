---
layout: default
title: Cache Coherence — Middle
parent: Cache Coherence
grand_parent: Memory Ordering Barriers
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/22-memory-ordering-barriers/04-cache-coherence/middle/
---

# Cache Coherence — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [The MESI State Machine in Depth](#the-mesi-state-machine-in-depth)
5. [Store Buffers and Invalidation Queues](#store-buffers-and-invalidation-queues)
6. [What `LOCK` Actually Does on x86](#what-lock-actually-does-on-x86)
7. [ARM Load-Linked / Store-Conditional](#arm-load-linked--store-conditional)
8. [How `sync/atomic` Maps to Hardware](#how-syncatomic-maps-to-hardware)
9. [How `sync.Mutex` Uses Coherence](#how-syncmutex-uses-coherence)
10. [Real Measurement Techniques](#real-measurement-techniques)
11. [Case Studies in Depth](#case-studies-in-depth)
12. [Code Examples](#code-examples)
13. [Coding Patterns](#coding-patterns)
14. [Best Practices](#best-practices)
15. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
16. [Common Mistakes](#common-mistakes)
17. [Common Misconceptions](#common-misconceptions)
18. [Tricky Points](#tricky-points)
19. [Test](#test)
20. [Tricky Questions](#tricky-questions)
21. [Cheat Sheet](#cheat-sheet)
22. [Self-Assessment Checklist](#self-assessment-checklist)
23. [Summary](#summary)
24. [What You Can Build](#what-you-can-build)
25. [Further Reading](#further-reading)
26. [Related Topics](#related-topics)
27. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "I know cache lines exist and false sharing is a thing. Now I want to know exactly what the hardware is doing on each atomic op, and why the same Go code performs differently on x86, ARM, and Apple silicon."

The junior file teaches the *rule of thumb*: 64-byte cache line, writes contend, pad to fix. The middle level teaches the *machinery underneath the rule of thumb*. We are going to spend most of this document inside the MESI state machine and the half-dozen hardware structures (store buffer, invalidation queue, snoop filter) that interact to make Go's atomic operations behave the way they do.

If you are a middle-level Go engineer designing real systems, this knowledge does three things for you:

1. **It demystifies benchmarks.** When `BenchmarkX-2` is 60 ns/op and `BenchmarkX-1` is 6 ns/op, you can name the precise hardware events that caused the difference.
2. **It guides design.** You stop guessing whether to pad or shard and start computing it from first principles: which cores will write, how often, and what state the line will be in.
3. **It surfaces bugs.** Some "bugs" are not race conditions but memory-ordering surprises: a goroutine reads a stale value because a fence was missing or a store buffer had not drained. Knowing the protocol shows you where.

By the end of this file you will be able to:

- Draw the MESI state machine and walk a line through it under any access pattern.
- Explain why an `atomic.Store` on x86 needs `MFENCE` only sometimes, but always pays a store-buffer flush.
- Explain why ARM atomic operations use `LDXR`/`STXR` (load-exclusive/store-exclusive) and what that means for contention.
- Read a `perf stat -e l2_rqsts.code_rd_miss,l1d.replacement,offcore_response.demand_rfo.l3_miss.local_dram` output and tell the story.
- Decide whether a particular Go data structure deserves padding, sharding, or a redesign.
- Recognise when a "scaling problem" is a coherence problem versus a true contention problem versus an algorithmic problem.

This file assumes you have read junior.md and have working knowledge of `sync/atomic`, `sync.Mutex`, `sync.RWMutex`, and `sync.Pool`.

---

## Prerequisites

- **Required:** Junior-level cache coherence knowledge: cache lines, false sharing, padding.
- **Required:** Comfort writing benchmarks and reading flame graphs.
- **Required:** Familiarity with `sync/atomic` and `sync.Mutex` APIs.
- **Helpful:** Some assembly reading ability. We will look at `LOCK XADD`, `MFENCE`, `LDXR`/`STXR`. The reader does not need to write assembly, only to recognise it in `go tool objdump` output.
- **Helpful:** Awareness of multi-socket NUMA systems. We will mention NUMA but defer deep treatment to senior.md.

---

## Glossary

| Term | Definition |
|------|-----------|
| **MESI** | Cache coherence protocol with states Modified, Exclusive, Shared, Invalid. |
| **MOESI** | Variant with an Owned state used to delay write-back. AMD chips use MOESI. |
| **MESIF** | Variant with a Forward state for read-fast-from-peers. Intel uses MESIF. |
| **Store buffer** | Per-core queue holding stores that have committed in program order but not yet drained to L1. |
| **Invalidation queue** | Per-core queue holding invalidations received from other cores that have not yet been applied to L1. |
| **Memory barrier / fence** | Instruction that constrains the reordering of memory operations. `MFENCE` on x86, `DMB`/`DSB` on ARM. |
| **Read-For-Ownership (RFO)** | Coherence message that grants exclusive (Modifiable) access to a line. |
| **Snoop** | Coherence message asking other cores about the state of a line. |
| **Snoop filter** | Hardware structure that records which cores hold each line, so snoops can be targeted. |
| **`LOCK` prefix** | x86 instruction prefix that makes a read-modify-write atomic and acts as a full memory barrier. |
| **`LL/SC` (LDXR/STXR)** | ARM's load-linked / store-conditional pair used for atomic read-modify-write. |
| **Strong memory model** | Architecture where most reorderings are not allowed (x86 is strong). |
| **Weak memory model** | Architecture where many reorderings are allowed without explicit fences (ARM, POWER). |
| **Store-forwarding** | Optimisation: a load can read its own pending store from the store buffer without going to L1. |
| **Coherence latency** | Time for a coherence operation to complete; varies from ~10 cycles (same L3) to hundreds (cross socket). |

---

## The MESI State Machine in Depth

Let us walk every transition.

### The four states recapped

| State | Other cores have copy? | Line matches memory? | Local reads | Local writes |
|-------|-----------------------|----------------------|-------------|--------------|
| **M (Modified)** | No | No (dirty) | Fast | Fast (no message) |
| **E (Exclusive)** | No | Yes (clean) | Fast | Fast; silent transition to M |
| **S (Shared)** | Maybe | Yes | Fast | Slow (must invalidate others) |
| **I (Invalid)** | — | — | Miss (fetch needed) | Miss (RFO needed) |

### Transitions, with the messages

```
Starting state: I (this core has no copy)

  Local READ on I:
    1. Issue BusRead. Memory and other caches respond.
    2. If any other core has the line in M, that core writes it back and downgrades to S.
    3. If any other core has it in S or E, they downgrade to S.
    4. This core receives the line in S (or E, if no other core has it).
    -> New state: S (or E)

  Local WRITE on I:
    1. Issue BusReadX (Read-For-Ownership).
    2. All other cores invalidate their copies (M cores write back first).
    3. This core receives the line in M.
    -> New state: M

  Local READ on S/E/M:
    Fast L1 hit. State unchanged.

  Local WRITE on S:
    1. Issue BusUpgrade (or BusReadX). Invalidate all other copies.
    2. Transition to M.
    -> New state: M

  Local WRITE on E:
    Silent transition to M. No message — no one else has a copy to invalidate.
    -> New state: M

  Local WRITE on M:
    Just write. State unchanged.

  Remote READ (snoop):
    If we are in M, write back to memory and transition to S.
    If we are in E, transition to S.
    If we are in S, no change.
    If we are in I, no change.

  Remote WRITE (snoop with invalidation):
    Transition to I regardless of starting state.
```

The cost asymmetry is striking:

- A read on a line in S costs zero coherence traffic.
- A write on a line in M costs zero coherence traffic.
- A write on a line in S costs an invalidation broadcast plus acknowledgements.
- A write on a line in I (cold or invalidated) costs a full RFO round trip.

This asymmetry drives every design decision in cache-friendly code.

### The Exclusive state is the silent hero

Many MESI primers focus on M, S, and I and treat E as a detail. But the E state is what makes single-threaded code fast on multi-core hardware. When one core touches a line that no one else cares about, the line lives in E. Writes silently upgrade to M. No broadcasts. No invalidations. Programs that look threaded but mostly operate on private data benefit enormously from E.

Padding works because it keeps lines in E (or M) on one core. Without padding, the line would be in S across cores, and every write would require an invalidation.

### The cost of "S → M"

A line in S being written is the *most surprising* cost in MESI. You read the variable: line goes to S. You read it again: still S. You write it: now you must invalidate every other core's copy.

If you read once and write often, this is fine — first write takes the invalidation cost, then the line sits in M. But if you read-then-write in a tight loop and another core also reads, you bounce between S and M, paying the invalidation each time.

This is one reason `atomic.LoadInt64` followed by `atomic.CompareAndSwapInt64` on a shared variable is expensive: the Load brings the line into S; the CAS must upgrade it to M with an invalidation.

---

## Store Buffers and Invalidation Queues

MESI alone is too slow for real CPUs. If every store had to wait for invalidation acknowledgements before retiring, single-threaded code would crawl. Two structures fix this:

### Store buffer

Each core has a small queue (typically 32–64 entries on modern x86) of stores that have retired in program order but not yet drained to L1. The core can keep executing while the store buffer drains in the background.

Consequences:

- A store followed by a load to the same address is fast: store-forwarding reads from the buffer.
- A store followed by a load to a different address can be reordered (the load is performed before the store drains). This is the **StoreLoad** reordering that x86's TSO model permits and that requires `MFENCE` to prevent.
- Stores are not globally visible until they drain. A core can have a store in its buffer while another core, reading the same address, sees the old value.

### Invalidation queue

Symmetrically, when a core receives an invalidation snoop, it does not always apply it immediately. It queues the invalidation. The core can ACK the invalidation right away (so the sender thinks it is done) while postponing the actual L1 update.

Consequences:

- A core may briefly read stale data even after another core has "completed" its store.
- A read barrier instructs the core to drain its invalidation queue before continuing.

### Why this matters for Go atomics

`atomic.Store` on x86 is implemented as a regular `MOV` followed by `MFENCE` only when needed. `atomic.Add` uses `LOCK XADD`, which (a) is atomic and (b) acts as a full memory barrier — flushing the store buffer.

Two consequences:

1. An "uncontended" atomic still costs roughly 6ns because the store buffer flush is not free.
2. A "contended" atomic on a line in S costs the buffer flush *plus* the invalidation round trip — easily 30ns or more.

Atomics are slow because of these structures, not because Go is slow. Every language doing atomic ops on the same hardware pays the same.

---

## What `LOCK` Actually Does on x86

The `LOCK` prefix on x86 (used in instructions like `LOCK XADD`, `LOCK CMPXCHG`, `LOCK INC`) has three effects:

1. **Atomicity.** The read-modify-write executes as a single indivisible operation with respect to other cores. No core sees a half-updated value.
2. **Cache line ownership.** The line is forced into M state for the duration. No other core can read or write it.
3. **Full memory barrier.** The store buffer is flushed. All prior loads and stores are globally visible before the locked op completes. All subsequent loads and stores happen after.

The first two are what most people mean by "atomic." The third is often forgotten and is the reason atomics on x86 are roughly an order of magnitude slower than plain ops, even uncontended.

### Cycle cost breakdown of an uncontended `LOCK XADD`

On a modern Intel core with the line already in M state:

```
1. Decode the LOCK XADD instruction
2. Store buffer flush                  ~10 cycles
3. Line lookup in L1 (hit, M state)    ~1 cycle
4. Atomic read-modify-write           ~3 cycles
5. Commit, mark line dirty             ~1 cycle
6. Resume pipeline                     ~5 cycles (refill)
Total: ~20 cycles ≈ 6ns at 3GHz
```

If the line is in S (because another core read it), step 3 becomes:

```
3a. Invalidate other copies            ~20 cycles
3b. Wait for ACKs                      ~15 cycles
3c. Upgrade to M                       ~1 cycle
```

Total now ~60 cycles or more. Under heavy contention, when the line is bouncing, every op pays this cost.

### `MFENCE` vs `LOCK`

`MFENCE` is x86's explicit memory barrier. It flushes the store buffer and waits for all prior memory ops to globally complete. It is roughly the same cost as a `LOCK` prefix without the atomic op.

Modern Go uses `MFENCE` rarely; the compiler prefers `LOCK`-prefixed dummy ops because they are slightly faster on most microarchitectures. You can see this with `go tool objdump`:

```
$ cat foo.go
package main

import "sync/atomic"

var x int64

func add() { atomic.AddInt64(&x, 1) }
```

```
$ go build -gcflags=-S foo.go
...
LOCK XADDQ AX, x(SB)
...
```

`atomic.LoadInt64` compiles to a plain `MOVQ` because x86 already provides acquire semantics for aligned 8-byte loads:

```
$ go build -gcflags=-S
...
MOVQ x(SB), AX
...
```

That is why loads are cheap and writes are expensive on x86.

---

## ARM Load-Linked / Store-Conditional

ARM uses a different mechanism for atomic RMW: load-linked / store-conditional (LL/SC), implemented as `LDXR` and `STXR`.

### How it works

```
loop:
    LDXR  Wt, [Xn]        ; load value, mark address "exclusive" for this core
    ADD   Wt, Wt, #1      ; modify
    STXR  Ws, Wt, [Xn]    ; try to store; sets Ws=0 on success, 1 on failure
    CBNZ  Ws, loop        ; retry if failed
```

The CPU tracks an "exclusive monitor" for each core. When `LDXR` reads a line, the monitor remembers the address. If another core writes to that line before this core's `STXR`, the monitor is cleared and `STXR` fails. The code retries.

### Implications for contention

Under heavy contention, ARM's LL/SC can livelock — multiple cores keep trying and failing. ARM v8.1 added LSE (Large System Extensions) which provides direct atomic instructions (`LDADD`, `CAS`) as an alternative. Modern ARM server CPUs prefer LSE.

For Go on ARM:

- `sync/atomic` operations compile to LSE instructions on Go 1.21+ when the build target supports them (server-class ARMv8.1+).
- Older or embedded ARM targets may use the LL/SC loop.
- Under contention, ARM atomics can be *more* expensive than x86 because of retries.

### Comparison

| Feature | x86 | ARMv8 |
|---------|-----|--------|
| Memory model | TSO (strong) | Weak |
| Atomic RMW | `LOCK XADD` | `LDADD` (LSE) or LL/SC loop |
| Default load ordering | Acquire | Relaxed |
| Default store ordering | Release | Relaxed |
| Fences needed for sequential consistency | StoreLoad only (`MFENCE`) | All four (`DMB ISH`) |

The practical consequence: a Go program that "happens to work" on x86 because of TSO may have subtle bugs on ARM. Go's memory model abstracts this — if you use the `sync/atomic` package correctly, both work. But hand-rolled lock-free code can break.

---

## How `sync/atomic` Maps to Hardware

A walkthrough of each function:

### `atomic.LoadInt64`

x86:
```
MOVQ x(SB), AX  ; plain load; x86 loads are acquire by default
```

ARM:
```
LDAR Xt, [Xn]   ; load-acquire; ensures no later op is reordered before
```

Both are cheap (~1 cycle on hit) but the line must be in S, E, or M. If in I, a cold miss.

### `atomic.StoreInt64`

x86:
```
MOVQ AX, x(SB)
MFENCE             ; ensure global visibility before next load
```

(Modern Go uses `XCHG` for stores because `XCHG` is implicitly locked and avoids the explicit `MFENCE`. Faster on most chips.)

ARM:
```
STLR Xt, [Xn]   ; store-release
```

Cost: ~6ns uncontended because of the fence/store-buffer flush.

### `atomic.AddInt64`

x86:
```
LOCK XADDQ AX, x(SB)
```

ARM (LSE):
```
LDADD Xt, Xt, [Xn]
```

ARM (LL/SC fallback):
```
loop: LDXR  Xt, [Xn]
      ADD   Xt, Xt, #1
      STXR  Ws, Xt, [Xn]
      CBNZ  Ws, loop
```

Cost: ~6ns uncontended on x86 with line in M; can exceed 100ns under heavy contention.

### `atomic.CompareAndSwapInt64`

x86:
```
LOCK CMPXCHGQ DX, x(SB)
```

ARM (LSE):
```
CAS Xs, Xt, [Xn]
```

Same cost profile as Add.

### `atomic.SwapInt64`

x86: `XCHGQ` (implicitly locked).

ARM: `SWP` (LSE) or LL/SC loop.

### `atomic.Pointer` variants

Same as 64-bit integer operations on amd64 and arm64 (both 64-bit pointers). On 32-bit platforms, pointer atomics use 32-bit ops.

### Summary

Every atomic in `sync/atomic` translates to one of: a plain MOV (loads), a LOCK-prefixed RMW (writes/RMW), or an LL/SC loop / LSE op (ARM). The cost story is consistent: loads are cheap, writes cost the line and the fence.

---

## How `sync.Mutex` Uses Coherence

Go's `sync.Mutex` is more than a state word. Its internals (in `runtime/sema.go` and `sync/mutex.go`) include:

- A 32-bit state word containing flags: locked, woken, starving, waiter count.
- A semaphore queue (`runqueue` of waiters) maintained by the runtime.

The hot path (uncontended `Lock`):

```go
// Lock locks m.
func (m *Mutex) Lock() {
    if atomic.CompareAndSwapInt32(&m.state, 0, mutexLocked) {
        return
    }
    m.lockSlow()
}
```

That CAS is a single LOCK CMPXCHG. If the state word's cache line is in M on this core (because we just unlocked here, or no one has touched it), the CAS takes ~6ns. If the line is in S (another goroutine on another core has read or tried to lock recently), the CAS pays the upgrade cost.

The slow path (`lockSlow`) involves spinning briefly, then parking the goroutine. Each spin is a CAS, each CAS is a coherence event.

### Cache effects on a contended mutex

When N goroutines on N cores all spin on `Lock`:

1. Each spin issues a `LOCK CMPXCHG`.
2. Each CAS forces the line into M on the spinning core.
3. The line bounces N ways.
4. Eventually the runtime parks the goroutines and the line is "owned" by the lock holder.

Spinning is brief by design — the Go runtime parks goroutines after a few iterations — but during the spin, the line bounces. This is why heavily contended mutexes are expensive: the cache traffic dominates.

### Padding considerations

A single `sync.Mutex` does not need padding. But a struct containing one with other hot fields might:

```go
type Bad struct {
    counter int64       // hot
    mu      sync.Mutex  // hot; on same line as counter
}
```

Every `Lock` invalidates the counter line. Every counter update invalidates the lock line. Worse than each on its own.

Fix:

```go
type Good struct {
    counter int64
    _       [56]byte
    mu      sync.Mutex
    _       [56]byte
}
```

---

## Real Measurement Techniques

### `perf` events for coherence

On Linux, the most useful events for diagnosing coherence:

```
perf stat -e \
  L1-dcache-loads,L1-dcache-load-misses,\
  l2_rqsts.code_rd_miss,\
  LLC-loads,LLC-load-misses,\
  offcore_response.demand_rfo.l3_miss.local_dram,\
  cycle_activity.stalls_l3_miss \
  ./binary
```

Interpretation:

- `L1-dcache-load-misses` high → cold or false-sharing pressure.
- `LLC-load-misses` high → coherence traffic crossing sockets or going to DRAM.
- `offcore_response.demand_rfo.l3_miss.local_dram` is the gold standard for "RFOs that missed all caches and went to DRAM." Big number = severe coherence pressure.
- `cycle_activity.stalls_l3_miss` shows cycles stalled waiting for L3 misses; relates wall-time to coherence.

### `perf c2c` — the killer feature

`perf c2c` (Cache-to-Cache) is a Linux profiler designed specifically to find false sharing:

```
sudo perf c2c record -F 4000 -a -- sleep 30
sudo perf c2c report
```

It produces a report listing cache lines hit by multiple cores, with the function and source line for each access. False-sharing lines show up at the top with high HITM (Hits with Modified) counts.

If your environment supports `perf c2c`, it is the single most efficient way to find false sharing in production.

### `pprof` for coherence

`pprof` cannot directly measure coherence, but it counts CPU time. Coherence stalls show up as time inside atomic and lock functions. The pattern is:

- Flat-mode shows `runtime/internal/atomic.Xadd64` (or similar) at the top.
- Source view shows the calling line as your atomic op.
- The actual cost is coherence, not the atomic instruction itself.

### Custom benchmarks

For Go specifically, the most reliable way to confirm a coherence problem:

1. Write a benchmark that exercises the suspect code.
2. Run with `-cpu=1,2,4,8` and compare.
3. Add padding to the suspect struct.
4. Repeat. Compare with `benchstat`.

If padding closes the gap, you found the coherence problem.

---

## Case Studies in Depth

### Case Study 1 — A high-throughput RPC counter

A service maintains per-method counters:

```go
type MethodStats struct {
    Calls   int64
    Errors  int64
    Bytes   int64
    Latency int64
}

var stats = map[string]*MethodStats{...}
```

At 100k RPS across 64 cores, 25% of CPU goes to `atomic.AddInt64`. `perf c2c` flags the `MethodStats` allocations as hot.

Diagnosis: `MethodStats` is 32 bytes. All four fields share a line. Across methods, structs land on the same lines because the allocator packs small objects.

Fix: pad each field and ensure each struct lands on its own line:

```go
type MethodStats struct {
    Calls   int64
    _       [56]byte
    Errors  int64
    _       [56]byte
    Bytes   int64
    _       [56]byte
    Latency int64
    _       [56]byte
}
```

Result: throughput doubles; CPU usage drops by 35%.

### Case Study 2 — A read-heavy global flag

A service checks a feature flag on every request:

```go
var enabled atomic.Bool

func handle() {
    if enabled.Load() {
        // ...
    }
}
```

Reads scale fine. But there is a goroutine that updates `enabled` once per minute, and another goroutine that updates a counter on the same struct:

```go
type Flag struct {
    enabled atomic.Bool
    updates atomic.Int64
}
```

Every minute, the updater bumps `updates` and toggles `enabled`. The line invalidates on every reader.

The fix is to recognise that *the counter is the problem*, not the flag. The flag is read-mostly; the counter is write-frequently. They should not be on the same line:

```go
type Flag struct {
    enabled atomic.Bool
    _       [63]byte
    updates atomic.Int64
    _       [56]byte
}
```

After the fix, the flag line stays in S across cores; the counter line stays in M on one core.

### Case Study 3 — `sync.Map` vs hand-rolled

A team rolls their own concurrent map:

```go
type SyncMap struct {
    mu sync.RWMutex
    m  map[string]any
}
```

Under heavy load, the `RWMutex` becomes the bottleneck. They switch to `sync.Map`.

`sync.Map` internally shards by key hash and uses per-shard locks, padded to cache lines. Throughput jumps 10×. The change is one import.

The lesson: standard-library concurrent primitives often have years of cache-aware tuning that hand-rolled ones miss.

### Case Study 4 — A channel that does not scale

A worker pool with a single channel of jobs:

```go
jobs := make(chan Job, 1000)
for i := 0; i < 64; i++ {
    go worker(jobs)
}
```

Throughput at 64 workers is only 2× the throughput at 8 workers. Profiling shows time in `runtime.chanrecv`.

The channel's internal `hchan` struct has indices and counters that all 64 workers' receives mutate. The cache line containing those indices bounces 64 ways.

Fix: shard the channel.

```go
const shards = 8
jobs := make([]chan Job, shards)
for i := range jobs { jobs[i] = make(chan Job, 1000) }

for i := 0; i < 64; i++ {
    go worker(jobs[i%shards])
}
```

Each shard handles 8 workers. Less contention per channel. Throughput climbs.

### Case Study 5 — Atomic counter near string fields

A logging library:

```go
type Logger struct {
    Name  string
    Count atomic.Int64
}
```

`Name` is set once at construction. `Count` is incremented on every log. But the `string` header (16 bytes) plus the atomic int (8 bytes) plus alignment puts them on the same line.

In production, every Logger.Count.Add(1) invalidates the line for whoever is reading `Name` to format the log prefix. The whole line bounces.

Fix: pad between or rearrange so the read-mostly field is on a different line.

---

## Code Examples

### Example 1 — Walking the MESI states with two goroutines

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
    "sync/atomic"
    "time"
)

var x int64

func writer() {
    for i := 0; i < 1_000_000; i++ {
        atomic.AddInt64(&x, 1)
    }
}

func reader() {
    var sum int64
    for i := 0; i < 1_000_000; i++ {
        sum += atomic.LoadInt64(&x)
    }
    _ = sum
}

func main() {
    runtime.GOMAXPROCS(2)
    var wg sync.WaitGroup
    wg.Add(2)
    start := time.Now()
    go func() { defer wg.Done(); writer() }()
    go func() { defer wg.Done(); reader() }()
    wg.Wait()
    fmt.Println(time.Since(start))
}
```

Under the hood: writer keeps the line in M. Reader's `Load` snoops, downgrading the line to S. Writer's next Add must upgrade S back to M, paying invalidation. The pattern repeats per op.

### Example 2 — Visualising padding effects in assembly

```go
package padcheck

import "sync/atomic"

type Packed struct {
    a, b int64
}

type Padded struct {
    a int64
    _ [56]byte
    b int64
    _ [56]byte
}

var p Packed
var q Padded

func IncPackedA() { atomic.AddInt64(&p.a, 1) }
func IncPackedB() { atomic.AddInt64(&p.b, 1) }
func IncPaddedA() { atomic.AddInt64(&q.a, 1) }
func IncPaddedB() { atomic.AddInt64(&q.b, 1) }
```

```
go tool objdump -s IncPackedA padcheck.test
```

The disassembly will show `LOCK XADDQ` against `p+0(SB)` and `p+8(SB)` — both on the same line. Compare to `q+0(SB)` and `q+64(SB)` — different lines.

### Example 3 — A custom benchmark that prints `perf c2c`-friendly addresses

```go
package falseshare

import (
    "fmt"
    "sync/atomic"
    "unsafe"
)

type Pair struct {
    a, b int64
}

func ReportAddresses() {
    var p Pair
    fmt.Printf("a: %p (line %x)\n", &p.a, uintptr(unsafe.Pointer(&p.a))/64)
    fmt.Printf("b: %p (line %x)\n", &p.b, uintptr(unsafe.Pointer(&p.b))/64)
    atomic.AddInt64(&p.a, 1)
    atomic.AddInt64(&p.b, 1)
}
```

Run with `perf c2c record` and the report will name those exact addresses.

### Example 4 — Per-P sharded counter using runtime trick

```go
package perp

import (
    _ "unsafe" // for go:linkname
    "sync/atomic"
)

//go:linkname runtime_procPin runtime.procPin
func runtime_procPin() int

//go:linkname runtime_procUnpin runtime.procUnpin
func runtime_procUnpin()

type PerP struct {
    slots []paddedInt64
}

type paddedInt64 struct {
    v atomic.Int64
    _ [56]byte
}

func New(n int) *PerP { return &PerP{slots: make([]paddedInt64, n)} }

func (p *PerP) Add(delta int64) {
    pid := runtime_procPin()
    p.slots[pid%len(p.slots)].v.Add(delta)
    runtime_procUnpin()
}

func (p *PerP) Sum() int64 {
    var s int64
    for i := range p.slots {
        s += p.slots[i].v.Load()
    }
    return s
}
```

`procPin` prevents the current G from being moved between Ps, so the chosen slot is the correct one. `procUnpin` releases the pin. This is exactly how `sync.Pool` works internally.

Caveat: `go:linkname` to private runtime functions is fragile across Go versions; use it only when you really need per-P routing.

### Example 5 — Demonstrating the StoreLoad reordering on x86

```go
package reorder

import (
    "sync"
    "sync/atomic"
)

var x, y int32
var seen sync.Map

func Try() {
    for i := 0; i < 1_000_000; i++ {
        atomic.StoreInt32(&x, 0)
        atomic.StoreInt32(&y, 0)
        var wg sync.WaitGroup
        wg.Add(2)
        var r1, r2 int32
        go func() {
            defer wg.Done()
            x = 1
            r1 = y
        }()
        go func() {
            defer wg.Done()
            y = 1
            r2 = x
        }()
        wg.Wait()
        seen.Store([2]int32{r1, r2}, true)
    }
}
```

Without explicit `MFENCE` or sequentially-consistent atomics, you may observe `r1 == r2 == 0` — the StoreLoad reordering on x86 allows both stores to be reordered after both loads. This is the canonical demonstration. Go's `sync/atomic.Store` prevents it.

This example is a bit subtle and is more in the territory of `02-acquire-release` than coherence per se, but it illustrates that coherence and ordering are related.

---

## Coding Patterns

### Pattern: read-mostly cache with rare updates

```go
type Config struct {
    snapshot atomic.Pointer[ConfigSnapshot]
    _        [56]byte
}

func (c *Config) Get() *ConfigSnapshot { return c.snapshot.Load() }

func (c *Config) Update(s *ConfigSnapshot) { c.snapshot.Store(s) }
```

Readers load a pointer (cheap, line in S). Writer updates the pointer (rare; invalidates briefly). Padding ensures the snapshot pointer is alone on its line.

### Pattern: per-P sharded counters

Already covered. Used internally by `sync.Pool` and `runtime/metrics`.

### Pattern: batched flush

```go
type Counter struct {
    local int64
    sink  *atomic.Int64
}

func (c *Counter) Bump() {
    c.local++
    if c.local%1000 == 0 {
        c.sink.Add(c.local)
        c.local = 0
    }
}
```

99.9% of increments stay local. The flush hits the shared atomic rarely. Throughput scales nearly linearly with cores.

### Pattern: hot/cold split

```go
type Worker struct {
    // hot — touched on every job
    JobsDone atomic.Int64
    _        [56]byte

    // cold — touched at startup/shutdown
    Name     string
    Created  time.Time
}
```

Keep hot fields padded; let cold fields share lines.

### Pattern: aligned ring buffer

```go
type Ring struct {
    head  atomic.Uint64
    _     [56]byte
    tail  atomic.Uint64
    _     [56]byte
    cells [N]Cell
}
```

Producer touches head; consumer touches tail. Padding isolates them.

---

## Best Practices

- **Pad every field that is mutated by a goroutine other than the one that mutates the surrounding struct.**
- **Use `cpu.CacheLinePad` for portability across x86 and Apple silicon.**
- **Sharding plus padding for counters; aim for one slot per `GOMAXPROCS`.**
- **Read the standard library.** Particularly `sync.Pool`, `sync.Map`, `runtime/internal/atomic`. The patterns there are battle-tested.
- **Benchmark with `-cpu=1,2,4,8,16`** and use `benchstat`. Never make a coherence claim without numbers.
- **On Linux, use `perf c2c`** to find false sharing in production code paths.
- **Document padding.** Comments are essential because the `_ [56]byte` looks like dead code to a reader who does not know.
- **Distinguish padding from sharding.** Padding fixes layout; sharding fixes contention. Use both when both are present.
- **Avoid hand-rolled lock-free algorithms** unless you have measured and understood the coherence cost; usually `sync.Mutex` plus good layout is faster than a "lock-free" algorithm with bad layout.
- **Watch for hidden globals.** A package-level variable updated in `init` is shared by every importer; if it is updated post-init by anything, it is contended.

---

## Edge Cases & Pitfalls

- **64-byte vs 128-byte cache lines.** Apple silicon uses 128. Code padded to 56 false-shares on M1.
- **The struct may not start on a cache-line boundary.** Even if you pad fields, the struct itself can begin mid-line. Use `cpu.CacheLinePad` at the *start* of the struct or allocate via a slice of `[64]byte`-aligned wrappers.
- **The Go GC compacts rarely but may move objects in some experimental modes.** Modern Go is non-moving, so padding survives.
- **64-bit atomics on 32-bit platforms require 8-byte alignment.** The struct layout must put them first or use `atomic.Int64` typed wrappers.
- **`sync.WaitGroup` is itself shared.** Many goroutines calling `Done` pound the same counter. For 10k-fan-out, use a sharded barrier.
- **`time.Now()` reads a shared timer page.** It is cache-resident but cross-core synchronised on some platforms. Avoid in hot loops.
- **`runtime.Gosched` migrates goroutines.** Each migration is a cold start in a new core's cache. Frequent migrations hurt locality.
- **The Go scheduler aggressively load-balances.** Goroutines move between Ps and threads. There is no goroutine pinning in user code.
- **`unsafe.Pointer` arithmetic for padding** must respect alignment. If you cast around, verify with `unsafe.Alignof`.

---

## Common Mistakes

1. **Padding only the "hot" field, leaving adjacent allocations to share.** A padded struct followed by another packed struct may have its tail field share a line with the next struct's head. Pad after every hot field.
2. **Confusing logical "atomic" with hardware "fast."** Atomics are atomic, not fast.
3. **Sharding without padding.** Each shard slot must be its own line; otherwise neighbouring shards false-share.
4. **Using `RWMutex` instead of fixing layout.** `RWMutex` adds overhead. Often the real fix is padding plus a regular `Mutex`.
5. **Spinning on a contended atomic.** Spin loops on a contended atomic generate huge cache traffic. Park (use a mutex) instead.
6. **Forgetting that channels have internal cache lines.** A heavily contended channel is a coherence problem inside `hchan`.

---

## Common Misconceptions

- "Atomics avoid the cache." No, they use the cache. They cost coherence traffic plus a fence.
- "`sync.RWMutex` is always better than `sync.Mutex` for read-heavy workloads." Often the opposite — `RWMutex` writes to its own state on every RLock and RUnlock, and that state's line bounces.
- "Compiler escape analysis fixes false sharing." No; escape analysis moves variables to the heap or stack but does not change layout of adjacent fields.
- "Padding wastes a lot of memory." Per struct, 56 bytes. Per million structs, 56MB. Often that is acceptable; weigh against the throughput gain.
- "I can hand-tune for my CPU's specific line size." You can, but the gain over `cpu.CacheLinePad` is rarely worth the lost portability.

---

## Tricky Points

- **NUMA effects** can dwarf coherence effects on multi-socket machines. A cross-socket invalidation is ~10× the cost of same-socket. Sticky CPU pinning matters for these cases.
- **Snoop filters** mean that snoops are not always broadcasts. Modern chips track which cores hold each line. This makes "padding" sometimes more impactful — by avoiding sharing entirely, you remove the line from the filter for other cores.
- **Some atomic instructions are sequentially consistent on x86 but not on ARM.** Code that relies on TSO ordering may need explicit fences on ARM. Go's atomics handle this; raw assembly does not.
- **`sync.Once`** uses an atomic CAS plus a mutex; the CAS path is hot for repeated calls, but the line stays in S for readers once Once has run. After completion it is essentially free.

---

## Test

```go
package middle_test

import (
    "sync"
    "sync/atomic"
    "testing"
    "time"
    "unsafe"
)

type packed struct{ a, b int64 }

type padded struct {
    a int64
    _ [56]byte
    b int64
    _ [56]byte
}

func benchTwo(b *testing.B, addA, addB func()) {
    for i := 0; i < b.N; i++ {
        var wg sync.WaitGroup
        wg.Add(2)
        go func() { defer wg.Done(); for j := 0; j < 1_000_000; j++ { addA() } }()
        go func() { defer wg.Done(); for j := 0; j < 1_000_000; j++ { addB() } }()
        wg.Wait()
    }
}

func BenchmarkPacked(b *testing.B) {
    var p packed
    benchTwo(b,
        func() { atomic.AddInt64(&p.a, 1) },
        func() { atomic.AddInt64(&p.b, 1) },
    )
}

func BenchmarkPadded(b *testing.B) {
    var p padded
    benchTwo(b,
        func() { atomic.AddInt64(&p.a, 1) },
        func() { atomic.AddInt64(&p.b, 1) },
    )
}

func TestLayout(t *testing.T) {
    var p padded
    aLine := uintptr(unsafe.Pointer(&p.a)) / 64
    bLine := uintptr(unsafe.Pointer(&p.b)) / 64
    if aLine == bLine {
        t.Fatalf("padded struct shares a line; layout broken")
    }
}

func TestCorrectnessUnderLoad(t *testing.T) {
    var p packed
    var wg sync.WaitGroup
    const N = 100_000
    wg.Add(2)
    start := time.Now()
    go func() { defer wg.Done(); for i := 0; i < N; i++ { atomic.AddInt64(&p.a, 1) } }()
    go func() { defer wg.Done(); for i := 0; i < N; i++ { atomic.AddInt64(&p.b, 1) } }()
    wg.Wait()
    elapsed := time.Since(start)
    if p.a != N || p.b != N {
        t.Fatalf("lost increments")
    }
    t.Logf("elapsed: %v", elapsed)
}
```

---

## Tricky Questions

1. **Why is `atomic.LoadInt64` cheap and `atomic.StoreInt64` expensive on x86?** Because loads are acquire by default on x86; stores require a fence to enforce release/acquire across the store buffer.

2. **Why does ARM's LL/SC sometimes outperform x86's LOCK under low contention?** Because LDXR is a normal load with extra tracking; STXR is a normal store with a check. No bus locking. Under low contention, the retry rate is low. Under high contention, x86 wins because it does not retry.

3. **What is the difference between a snoop and an invalidation?** A snoop is a query — "do you have this line, and in what state?" An invalidation is a command — "drop your copy of this line." Snoops are issued during reads; invalidations during writes.

4. **Why does `sync.Pool` use per-P slots instead of per-goroutine slots?** Because goroutines come and go cheaply; tracking state per goroutine would explode. Per-P matches the scheduler's natural granularity and persists across goroutine creation/destruction.

5. **Why does Go's `sync.Mutex` not pad its state word?** Because it is a single 32-bit field. The struct as a whole is 8 bytes (counting Go's internal alignment). The padding decision belongs to the embedding code, not the mutex.

6. **Why do read-heavy workloads sometimes benefit from `sync.RWMutex` and sometimes not?** Because `RWMutex` has its own internal state that is written on every RLock and RUnlock. Under heavy read contention, that state's line bounces. The pattern often called "RWMutex contention" is really RWMutex cache traffic.

7. **What is the cost of `runtime.Gosched`?** Functionally, it yields. From a cache perspective, the goroutine may resume on a different P and a different OS thread; the cache state from its previous run is gone. Frequent Gosched is bad for locality.

8. **Why is `time.Now` sometimes slow under load?** On some kernels (Linux without `vDSO`-fast paths, or virtualised environments), `time.Now` traps into the kernel. Even with vDSO, it reads a shared page that has its own coherence dynamics. In tight loops, prefer monotonic deltas.

9. **What does `MFENCE` actually do?** Flushes the store buffer and stalls until all prior memory ops are globally visible. No ordering across MFENCE.

10. **How does `LOCK CMPXCHG` interact with the cache?** It atomically reads, compares, and possibly writes the line. The line must be in M for the duration. If in S or I, it must be upgraded or fetched first.

---

## Cheat Sheet

```
MESI states:
   M = Modified (only this core, dirty)
   E = Exclusive (only this core, clean)
   S = Shared (other cores may have)
   I = Invalid (no usable copy)

Costs (approximate, 3GHz x86):
   L1 hit:                       ~1 ns
   L2 hit:                       ~4 ns
   L3 hit:                      ~12 ns
   DRAM:                        ~80 ns
   Same-socket invalidation:    ~30 ns
   Cross-socket invalidation:  ~200 ns
   atomic.AddInt64 uncontended:   6 ns (line in M)
   atomic.AddInt64 contended:   30-200 ns (line bouncing)

Hardware structures:
   Store buffer  — pending stores; flushed by LOCK or MFENCE
   Invalidation queue — pending invalidations; flushed by read barrier
   Snoop filter — tracks which cores hold each line

Go atomics:
   Load    -> MOV (x86) / LDAR (ARM)              cheap, acquire
   Store   -> XCHG (x86) / STLR (ARM)             expensive, release
   Add     -> LOCK XADD / LDADD                   expensive, full fence
   CAS     -> LOCK CMPXCHG / CAS                  expensive, full fence
```

---

## Self-Assessment Checklist

- I can draw the MESI state machine and label every transition with its message and cost.
- I can explain why `atomic.Store` on x86 needs a store buffer flush.
- I can name three reasons Go's `sync.Pool` is faster than a mutex-protected free list.
- I can read a `perf stat` output for a coherence-bound program and identify the symptoms.
- I can use `perf c2c` to find false sharing.
- I can write a benchmark that demonstrates a coherence issue and a fix that resolves it.
- I can explain why ARM LL/SC under heavy contention sometimes outperforms x86 LOCK and sometimes does not.
- I can design a per-P sharded data structure.
- I can name the standard library types whose internals use cache-line padding (Pool, Map, atomic.Int64-aligned structs).

---

## Summary

The MESI state machine plus store buffers plus invalidation queues plus a snoop filter is the machinery underneath every shared memory operation in Go. Cache lines move between states; atomic operations and fences impose constraints; padding and sharding minimise coherence traffic. Loads are cheap; writes cost a fence and possibly an invalidation; contended writes bounce the line. Padding fixes layout (false sharing); sharding fixes contention (true sharing). Tools: `perf stat`, `perf c2c`, `pprof`, custom benchmarks with `-cpu` sweeps. The standard library has the patterns; copy them. Hand-rolled lock-free is usually slower than well-laid-out mutex-based code.

---

## What You Can Build

- A profiling helper that runs a workload and prints `perf c2c`-style summaries of hot cache lines.
- A package whose every public type uses `cpu.CacheLinePad` correctly for cross-platform performance.
- A custom benchmark harness that reports ns/op for `-cpu=1,2,4,8,16` and flags sublinear scaling automatically.
- A wrapper around `sync.Mutex` that exposes lock-acquisition latency for monitoring.
- A per-P counter library matching the design of `sync.Pool`.

---

## Further Reading

- Paul McKenney, *Is Parallel Programming Hard, And, If So, What Can You Do About It?* — the bible.
- Intel Optimisation Reference Manual, vol. 1, chapters on caches and atomics.
- ARM Architecture Reference Manual ARMv8, sections on memory ordering and exclusives.
- *Memory Barriers: a Hardware View for Software Hackers* by Paul McKenney.
- Go source: `src/sync/pool.go`, `src/sync/map.go`, `src/runtime/internal/atomic/`.

---

## Related Topics

- **02-acquire-release** — memory ordering semantics, which sit on top of coherence.
- **03-sequential-consistency** — the strongest ordering; expensive because every store is a coherence event.
- **05-false-sharing** — applied false-sharing detection.
- **sync.Pool** — production-grade per-P pattern.
- **sync.Mutex** — coherence-aware spin-then-park.

---

## Diagrams & Visual Aids

```
MESI state machine, simplified:

                +---+  local read   +---+
                | I | ------------> | S |
                +-+-+                +-+-+
                  |                    |
       local write|         local write|
                  v                    v
                +---+ <--------------+---+
                | M | <----E (silent)| E |
                +---+                +---+

Edges with remote actions:
   remote read on M:  M -> S (write back)
   remote read on E:  E -> S
   remote write on any: -> I (and writer's line -> M)
```

```
Store buffer interaction with coherence:

  Core 0:                            Core 1:
   exec X = 1   ->  [SB: X=1]
                                       load X -> returns OLD VALUE
   drain SB    ->  L1 M state
                                       load X -> snoop -> Core 0 SHARES -> NEW VALUE

Without a fence, Core 1 may see X=0 even after Core 0 "stored" X=1.
With a fence (LOCK or MFENCE), Core 0 waits for SB to drain before continuing.
```

```
The full picture under contention:

  Core 0           Coherence Fabric         Core 1
    |                    |                    |
    |--LOCK XADD-------->|                    |
    |                    |--Invalidate------->|
    |                    |<--ACK--------------|
    |<--Line in M--------|                    |
    |    (do op)         |                    |
    |    (write back)    |                    |
    |                    |                    |
    |                    |<------LOCK XADD----|
    |<--Invalidate-------|                    |
    |--ACK-------------->|--Line in M-------->|
    |                    |                    |

Every op is a full round trip across the fabric.
```

---

## Deep Dive: Cache Coherence Across Multiple Sockets

Most servers are single-socket. But the cloud has multi-socket boxes (large memory-optimised instances) and bare-metal servers in datacentres often have two or four sockets. On such machines, cache coherence becomes a topic with much sharper edges.

### Inter-socket interconnect

Two sockets are joined by a high-speed serial link. On Intel: UPI (Ultra Path Interconnect), formerly QPI. On AMD: Infinity Fabric. On ARM server (Ampere, Graviton): proprietary fabrics with similar characteristics.

The link runs at tens of gigabytes per second, but the latency per coherence message is dominated by the serial nature of the link and the multi-hop routing. Numbers:

- Same-socket invalidation: ~30 cycles ≈ 10 ns.
- Cross-socket invalidation: ~150–300 cycles ≈ 50–100 ns.

A contended line bouncing across sockets is roughly an order of magnitude worse than same-socket contention. A Go service whose hot counter happens to be on a line shared across sockets can lose 30–50% of its CPU to coherence.

### NUMA — Non-Uniform Memory Access

Each socket has its own memory controller and its own DRAM. Memory allocated by a process running on socket 0 typically goes to socket 0's DRAM. If a thread on socket 1 reads that memory, the request travels over UPI to socket 0's memory controller, then back. Latency is ~2× a local access.

For Go, this matters in two cases:

1. **A long-lived shared structure allocated by an `init()` call** ends up on whichever socket happened to be running the init. Threads on the other socket pay the NUMA premium forever.
2. **Cross-socket cache invalidations** are slower than same-socket. A counter shared by all 64 threads on a 2P box bounces between sockets if the OS schedules threads on both.

The fix on Linux is `numactl` to pin a process to one node, or per-socket sharding inside the application (allocate one shard per NUMA node).

For most cloud Go workloads on single-socket VMs, NUMA is invisible. For bare-metal HPC or memory databases, it dominates.

### Coherence directories at scale

A single-socket CPU can broadcast invalidations to all cores cheaply. A multi-socket system cannot — broadcasting across UPI would saturate the link. Instead, modern multi-socket coherence uses **directories**: each socket has a table recording which cores hold each line. Invalidations are sent only to the cores known to hold the line.

For software, this means:

- A line touched by only one socket pays only same-socket coherence costs.
- A line shared across sockets pays cross-socket costs.
- Detecting cross-socket sharing requires hardware counters (`offcore_response.*` events on Intel) or `perf c2c` reports.

### Practical recommendations

If you operate on multi-socket hardware:

1. Pin processes to NUMA nodes where possible.
2. Allocate per-CPU or per-socket data structures.
3. Use `perf c2c` to find cross-socket false sharing — usually the worst kind.
4. Be wary of any global atomic that all cores touch; redesign as sharded.

For single-socket cloud users: relax. Just pad and shard normally.

---

## Deep Dive: How Snoop Filters Change the Game

In the simplest MESI implementation, a write to a Shared line requires broadcasting an invalidation to *every* other core. This does not scale. Modern CPUs use **snoop filters** — hardware tables that track which cores hold each line — to send invalidations only to the cores that actually need them.

### How a snoop filter works

Each socket maintains a directory or filter, often integrated into the L3 cache:

- For each cache line currently held by any core, the filter records which cores hold it.
- When a core requests RFO, the filter looks up the line and sends invalidations only to the listed cores.
- When a line is fully evicted (no core holds it), the filter entry is removed.

The filter is finite. Modern Intel Xeon has filter capacity for tens of millions of lines; AMD EPYC has similar. When the filter overflows, snoops fall back to broadcast — and performance suddenly degrades.

### Implication: false sharing has cascading costs

Without snoop filters, an unpadded struct that all cores touch causes a broadcast per write. With snoop filters, the broadcast is replaced by targeted snoops, so the cost scales with the number of touching cores rather than the total number of cores. Still bad — but bounded by the actual sharing degree.

When you pad and confine a line to one core, you remove the filter entry entirely for other cores' purposes. The next time someone needs the line, it is a fresh miss.

### Filter overflow

If a process touches millions of lines very quickly (large working set + many cores), the filter can overflow. Symptoms:

- Sudden drop in throughput at a certain load level.
- High `LLC-load-misses` even for "local" workloads.
- `offcore_response.demand_data_rd.snoop_hit_with_fwd` rising.

The fix is to reduce working-set size or sharing degree. This is rare in user Go code but can happen in databases or in-memory caches.

---

## Deep Dive: The `sync/atomic` Package Source

Reading the standard library teaches more than any tutorial. A walkthrough of `sync/atomic`:

### `src/sync/atomic/doc.go`

The package-level docs spell out:

- The 64-bit alignment requirement on 32-bit ARM.
- That `LoadInt64` and `StoreInt64` are atomic but **not** ordering primitives (use higher-level synchronisation for happens-before).
- That `Pointer[T]` wraps `unsafe.Pointer` atomic ops with type safety.

### `src/sync/atomic/value.go`

`atomic.Value` allows atomic assignment of any `interface{}` value. Internally it stores `[2]unsafe.Pointer` (type pointer + data pointer) and uses an extra atomic to atomically install both. The implementation is a small masterclass in two-word atomic updates.

### `src/sync/atomic/asm_amd64.s`

The amd64-specific implementations. You will see:

```
TEXT ·AddInt64(SB),NOSPLIT,$0-24
    MOVQ    addr+0(FP), BX
    MOVQ    delta+8(FP), AX
    MOVQ    AX, CX
    LOCK
    XADDQ   AX, 0(BX)
    ADDQ    CX, AX
    MOVQ    AX, ret+16(FP)
    RET
```

A single `LOCK XADDQ` is the entire implementation. The `LOCK` prefix turns the instruction into an atomic RMW with full memory-barrier semantics on x86.

### `src/sync/atomic/asm_arm64.s`

The ARM64 implementation. Older Go versions used LL/SC; modern versions use LSE when available. The build system picks at compile time.

### `src/sync/atomic/type.go`

Defines `atomic.Int32`, `atomic.Int64`, `atomic.Uint32`, etc. as struct wrappers around the primitive types. The structs have a hidden `noCopy` field to make `go vet` flag mistaken copies. They guarantee alignment.

### Take-aways

- `sync/atomic` is a thin wrapper over architecture-specific assembly.
- All the magic is the `LOCK` prefix (x86) or LSE / LL/SC (ARM).
- Padding is up to you; the package does not add padding to atomic types.
- Use the typed atomics for new code; they are safer.

---

## Deep Dive: How `sync.Pool` Achieves Lock-Free Allocation

`sync.Pool` is the production-grade per-P data structure in the Go standard library. It is worth studying in detail.

### Layout

From `src/sync/pool.go`:

```go
type Pool struct {
    noCopy noCopy

    local     unsafe.Pointer // local fixed-size per-P pool, actual type is [P]poolLocal
    localSize uintptr        // size of the local array

    victim     unsafe.Pointer
    victimSize uintptr

    New func() interface{}
}

type poolLocalInternal struct {
    private interface{}     // can be used only by the respective P.
    shared  poolChain       // local P can pushHead/popHead; any P can popTail.
}

type poolLocal struct {
    poolLocalInternal

    // Prevents false sharing on widespread platforms with
    // 128 mod (cache line size) = 0 .
    pad [128 - unsafe.Sizeof(poolLocalInternal{})%128]byte
}
```

The `poolLocal` struct is padded to 128 bytes — accommodating Apple silicon's 128-byte lines while being safe on x86's 64. Each P has its own `poolLocal`, so the Get/Put hot path touches only its own slot. No coherence traffic during ordinary operation.

### Hot path

```go
func (p *Pool) Get() interface{} {
    l, pid := p.pin()    // pin to current P, get pointer to poolLocal
    x := l.private
    l.private = nil
    if x == nil {
        // fall through to shared queue or victim cache
        x, _ = l.shared.popHead()
        if x == nil {
            x = p.getSlow(pid)
        }
    }
    runtime_procUnpin()
    if x == nil && p.New != nil {
        x = p.New()
    }
    return x
}
```

The `pin` and `Unpin` calls disable preemption so the chosen `poolLocal` is correct for the duration. The fast path is two writes (one to consume `private`, one to mark) and never touches another P's data.

### Sweep coordination

When the GC runs, `sync.Pool` clears the victim cache and moves the current pools to victim. This coordination is via a runtime hook, not via locks. The moves themselves do cause coherence traffic, but they happen once per GC cycle — rare.

### Take-aways for designers

- Per-P slots are the canonical "no contention" pattern.
- 128-byte padding covers all common platforms.
- Pin/Unpin is the way to access the current P's slot safely.
- A two-tier (local + victim) cache amortises GC cost.

---

## Deep Dive: A Tour of `runtime/internal/atomic`

The runtime has its own atomics package, separate from `sync/atomic`. Why?

- It cannot import `sync/atomic` (cyclic dependency).
- It needs slightly different ABI guarantees.
- Some operations are runtime-private optimisations.

Reading `runtime/internal/atomic/types.go`:

```go
type Int64 struct {
    noCopy noCopy
    _      align64
    value  int64
}
```

The `align64` field is a sentinel type that the compiler aligns to 8 bytes — essential on 32-bit ARM. Notice no cache-line padding by default; that is left to embedding code.

The runtime uses these atomics extensively in scheduler internals. Read `runtime/proc.go` to see where they appear; you will see them around the GMP scheduler's shared queues and around the network poller.

---

## Deep Dive: Memory Ordering and the Go Memory Model

This file is primarily about cache coherence (a performance topic), but it cannot avoid memory ordering (a correctness topic). They are not the same, but they share machinery.

### What coherence guarantees

Coherence promises: **for any single memory location, all cores eventually agree on a single sequence of values**. This is per-location.

### What coherence does not guarantee

Coherence does **not** promise that the *order of operations across different locations* is the same across cores. Core 0 may write A=1 then B=2. Core 1 may observe B=2 before A=1.

This is what memory ordering addresses. Memory models (Go's, x86's, ARM's) specify which reorderings are allowed.

### Go's memory model in one paragraph

Go promises that a `sync/atomic` operation establishes a happens-before edge: if you store with atomic and another goroutine loads the same variable atomically and sees the new value, then all writes that happened-before the store are visible to the loader. Without atomic ops, the only happens-before guarantees come from channel ops, mutexes, and the runtime's `go` statement.

### Why this matters for coherence reasoning

When you write a lock-free algorithm, you need both:

- The line to be in the right coherence state (performance).
- The fences to establish happens-before (correctness).

Padding handles the first. The `sync/atomic` primitives handle the second. Skip either and you have a bug.

A common subtle bug: using a plain `*int` instead of an atomic for a shared counter. The hardware coherence still moves the line correctly; the value is correct *for any single line*. But the compiler may reorder accesses around it; the read may be hoisted out of a loop. Use `atomic.LoadInt64` or the typed `atomic.Int64`.

---

## Deep Dive: When the Same Line Hosts a Mutex and Its Protected State

A common mistake: putting a mutex right next to the data it protects.

```go
type Stats struct {
    mu      sync.Mutex
    counter int64
}
```

Two reasons it is bad:

1. **Lock/unlock writes to `mu`.** The mutex state line goes to M on the locker's core.
2. **The protected write writes to `counter`.** Same line. Same M state.
3. **An unlocker's atomic CAS** writes to `mu` again. Same line again.

So you have three writes to the same line per critical section. If two goroutines on two cores compete for the lock, each cycle bounces the line three times.

The fix is to separate them:

```go
type Stats struct {
    mu      sync.Mutex
    _       [56]byte
    counter int64
    _       [56]byte
}
```

Or — better — separate them only when both are hot:

- If the critical section is short and lockless reads of `counter` are common, padding helps.
- If the critical section is long (more than a few cache misses), the coherence is dwarfed by the work; do not bother.

Profile to decide. The rule: pad when measurements show a problem.

---

## Deep Dive: Profiling a Real Coherence Problem

Walk through a complete diagnosis.

### Step 1: Suspect from symptoms

A service runs at 80% CPU at 30k RPS. Adding more cores (16 → 32) bumps RPS to 33k. The team suspects scaling problem.

### Step 2: pprof CPU profile

```
go tool pprof -http=:8080 http://service:6060/debug/pprof/profile?seconds=60
```

Top function: `sync/atomic.AddInt64` at 18% flat. Caller: `metrics.(*Counter).Inc`.

### Step 3: Hypothesis

A heavily contended counter or false-sharing on the counter struct.

### Step 4: Confirm with bench

```go
func BenchmarkCounter(b *testing.B) {
    var c metrics.Counter
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            c.Inc()
        }
    })
}
```

Run with `-cpu=1,8,32`. If ns/op rises sublinearly (i.e., total throughput plateaus), it is contended/coherent.

### Step 5: `perf c2c` if Linux

```
sudo perf c2c record -F 4000 -a -- ./service-bench
sudo perf c2c report
```

The report lists hot cache lines with source-level annotation. Likely shows the counter line with high HITM (Hit-Modified) counts.

### Step 6: Apply fix

Either pad the counter to a line (if it shares with neighbours) or shard it per CPU (if it is the only field but many cores write).

### Step 7: Re-bench

Run the same benchmark. Padded/sharded version should scale linearly to at least the number of cores.

### Step 8: Deploy and observe

Throughput in production should track benchmark expectations. If not, there may be additional bottlenecks (mutex elsewhere, channel contention).

---

## Deep Dive: A Lock-Free Queue, Examined for Coherence

A bounded MPMC queue (multi-producer, multi-consumer) using atomics:

```go
type MPMCQueue struct {
    head    atomic.Uint64
    _       [56]byte
    tail    atomic.Uint64
    _       [56]byte
    cells   []cell
    mask    uint64
}

type cell struct {
    seq  atomic.Uint64
    data unsafe.Pointer
}
```

Each `cell` should be a full cache line (or two on Apple silicon). Otherwise multiple cells share a line and one producer's write to cell `i` invalidates the line containing cell `i+1` for the next producer.

The pad inside `cell`:

```go
type cell struct {
    seq  atomic.Uint64
    data unsafe.Pointer
    _    [48]byte
}
```

64 bytes total. One cell per line. Each enqueue touches one cell; each dequeue touches one cell. With sufficient queue size, producers and consumers rarely touch adjacent cells in the same window.

The `head` and `tail` indices: padded separately, as shown. Otherwise producers (which read head, write tail) and consumers (which read tail, write head) would bounce.

This is roughly the design of LMAX Disruptor, DPDK queues, and many other high-performance shared-memory queues. The geometry is everything.

---

## Deep Dive: When `atomic.Value` is the Right Answer

`atomic.Value` (and `atomic.Pointer[T]`) lets you atomically swap an interface or a pointer. Use it when:

- You have a snapshot of state.
- Readers should see a consistent snapshot.
- Writes are rare.

Typical pattern:

```go
type Config struct {
    snapshot atomic.Pointer[Snapshot]
    _        [56]byte
}

func (c *Config) Get() *Snapshot { return c.snapshot.Load() }
func (c *Config) Update(s *Snapshot) { c.snapshot.Store(s) }
```

Readers do a single pointer load — cheap, line in S. Writer does a single pointer store — invalidates briefly but rarely. Padding isolates the snapshot line from neighbouring fields.

If `Snapshot` itself is small and read frequently, the readers may still pay the L1 cost of fetching it; consider embedding the most-hit fields directly in `Config` with padding.

---

## Deep Dive: Channel Internals and Coherence

Go channels have surprisingly complex internals. The `hchan` struct in `runtime/chan.go`:

```go
type hchan struct {
    qcount   uint           // total data in queue
    dataqsiz uint           // size of the circular queue
    buf      unsafe.Pointer // points to an array of dataqsiz elements
    elemsize uint16
    closed   uint32
    elemtype *_type
    sendx    uint    // send index
    recvx    uint    // receive index
    recvq    waitq   // list of recv waiters
    sendq    waitq   // list of send waiters
    lock     mutex
}
```

This struct fits in one or two cache lines. Every send and recv touches `qcount`, `sendx` or `recvx`, and `lock`. Under heavy use, this whole structure bounces between cores.

Go's runtime cannot pad an `hchan` arbitrarily — the layout is internal. But for *user* code that uses many channels in parallel, the implication is:

- A single channel is a single coherence hotspot under heavy parallel traffic.
- Sharding into multiple channels reduces this hotspot's heat.

A common pattern in high-throughput Go services:

```go
type WorkerPool struct {
    channels []chan Job
}

func (p *WorkerPool) Submit(j Job) {
    shard := hashShard(j)
    p.channels[shard%len(p.channels)] <- j
}
```

Sharded channels mean each channel's `hchan` is hot only on a subset of cores.

---

## Deep Dive: Reading Go Assembly for Cache Behaviour

`go tool objdump` reveals what the compiler generated. Useful for confirming that your padding actually changed the layout.

```bash
go build -o myprog .
go tool objdump -s "main\..*" myprog | less
```

Look for:

- `LOCK XADDQ` — atomic add.
- `LOCK CMPXCHGQ` — atomic CAS.
- `XCHGQ` — atomic swap (implicitly locked).
- `MOVQ` for atomic loads.
- `LFENCE`, `SFENCE`, `MFENCE` — explicit fences (rare in user code).

For ARM, the equivalents are:

- `LDADD` — LSE atomic add.
- `LDAR` — load-acquire.
- `STLR` — store-release.
- `LDXR` / `STXR` — LL/SC pair.
- `DMB ISH` — data memory barrier, inner shareable.

A common surprise: a "simple" Go function like `mutex.Lock()` is dozens of instructions when you trace it. Most of those instructions are the slow path (spin loop, park). The fast path (one CAS) is what runs uncontended.

---

## Deep Dive: NUMA on Cloud VMs

Most cloud VMs are configured to hide NUMA from guests. AWS, GCP, Azure all run on multi-socket hardware but partition VMs to fit within a single NUMA node when possible.

The exceptions:

- Very large memory-optimised instances (1TB+) often span sockets.
- Bare-metal instances expose full hardware topology.
- Some "dense compute" instances span sockets even at moderate sizes.

For a Go service:

- Default VMs: ignore NUMA.
- Bare-metal or 1TB+ memory VMs: consider `numactl` or per-socket sharding.
- Production: check `lscpu` to see the topology.

```
$ lscpu | grep NUMA
NUMA node(s):                       2
NUMA node0 CPU(s):                  0-31,64-95
NUMA node1 CPU(s):                  32-63,96-127
```

If you see two NUMA nodes, your service may benefit from explicit affinity. If one node, do not bother.

---

## Deep Dive: Hyperthreading and Coherence

Hyperthreading (Intel) and SMT (AMD/ARM) put two or more hardware threads on a single physical core. The threads share L1 and L2 cache.

Implication: two goroutines pinned to two hyperthreads of the same core **do not false-share** with each other. They share the cache. Coherence traffic between them is essentially free.

This is why benchmarks sometimes look weird at `-cpu=N` where N exceeds physical cores: the extra threads share caches and the false-sharing penalty disappears artificially.

Reality check: in production, the Go scheduler does not control which hyperthread a goroutine runs on. The OS decides. Often the OS prefers physical cores first, then fills hyperthreads — but it can move threads around.

A more reliable benchmark: pin to specific cores with `taskset`:

```
taskset -c 0,1 ./bench    # cores 0 and 1, hopefully physical
taskset -c 0,32 ./bench   # core 0 and its hyperthread (depends on layout)
```

For pure false-sharing demos, taskset to physical cores. For real-world numbers, run unpinned and report distributions.

---

## Deep Dive: Atomic-Free Patterns

The fastest atomic is the one you do not execute. Patterns that avoid atomics entirely:

### Pattern: thread-local accumulator with rare flush

```go
type Counter struct {
    local int64
    flush func(int64)
}

func (c *Counter) Inc() {
    c.local++
    if c.local >= 1000 {
        c.flush(c.local)
        c.local = 0
    }
}
```

Local increments are plain `INC`. The flush is a rare atomic add to a shared accumulator. Throughput is ~1000× the contended case.

### Pattern: lockless when single-writer-multi-reader

```go
type View struct {
    current atomic.Pointer[Snapshot]
}

// Writer:
view.current.Store(&newSnapshot)

// Readers:
s := view.current.Load()
// read s.* without atomics — it is immutable
```

Once a snapshot is published, it never changes. Readers can chase fields freely. Only the pointer load is atomic.

### Pattern: copy-on-write

```go
type Map struct {
    m atomic.Pointer[map[string]string]
}

func (m *Map) Set(k, v string) {
    for {
        old := m.m.Load()
        next := make(map[string]string, len(*old)+1)
        for k2, v2 := range *old { next[k2] = v2 }
        next[k] = v
        if m.m.CompareAndSwap(old, &next) { return }
    }
}
```

Readers see a stable map; writers swap a new map in. Throughput for readers is excellent; writers pay a copy on each update. Good for read-heavy workloads with rare updates (DNS-style).

### Pattern: epoch-based reclamation

For very hot data structures, epoch-based reclamation (EBR) lets readers proceed without atomics for most accesses, deferring memory reclamation to a quieting protocol. Rare in pure Go; common in C++ databases.

---

## Deep Dive: When `sync.RWMutex` Beats `sync.Mutex` and When It Does Not

`sync.RWMutex` allows many readers or one writer. Sounds great. Often slower than `sync.Mutex`.

The reason: `RWMutex` has more state. Every `RLock` and `RUnlock` does an atomic update to the reader counter. The reader counter's cache line bounces among the readers.

For read-heavy workloads with few writes:

- If the critical section is **long** (microseconds): RWMutex wins. The lock-acquisition overhead is amortised over the work.
- If the critical section is **short** (nanoseconds): Mutex often wins. The reader-counter coherence cost exceeds the gain.

For write-heavy or balanced workloads: RWMutex is consistently slower than Mutex.

The benchmark to run before committing to RWMutex:

```go
func BenchmarkMutex(b *testing.B)   { ... } // your workload with Mutex
func BenchmarkRWMutex(b *testing.B) { ... } // same workload with RWMutex
```

Cycle through `-cpu=1,2,4,8,16`. If RWMutex is faster across the board, use it. If not, use Mutex and look at other optimisations.

---

## Deep Dive: The `runtime/metrics` Package

The `runtime/metrics` package exposes runtime counters. It is read by monitoring code. The internal representation is heavily sharded and padded — read the source.

Of interest:

- Per-goroutine metrics are not tracked (too expensive).
- Per-P counters are tracked and padded.
- The export API allocates fresh slices per call, avoiding shared mutable state.

For your own metrics library, copy these patterns.

---

## Deep Dive: A Tour of `golang.org/x/sys/cpu`

The `golang.org/x/sys/cpu` package exposes CPU feature detection and the `CacheLinePad` type.

```go
import "golang.org/x/sys/cpu"

type X struct {
    hot int64
    _   cpu.CacheLinePad
}
```

`CacheLinePad` is sized at build time:

- 64 bytes on most architectures.
- 128 bytes on Apple silicon.
- Adjustable by build constraints.

Use it for portable code. For pure x86 code, hand-padding with `_ [56]byte` is slightly more efficient (less memory waste). For multi-platform binaries, `cpu.CacheLinePad` is the right answer.

---

## Deep Dive: A Subtle Bug — Padding That Did Not Work

A team adds padding:

```go
type Counter struct {
    v atomic.Int64
    _ [56]byte
}

var counters [1024]Counter
```

Expected: each counter on its own line. Reality: `atomic.Int64` is itself 8 bytes plus alignment metadata, totalling 16 bytes on amd64 (due to `noCopy` marker). The 8-byte pad assumption is off.

After investigation, the team uses `unsafe.Sizeof` to verify:

```go
fmt.Println(unsafe.Sizeof(Counter{})) // expects 64; got 72
```

Each `Counter` is actually 72 bytes. Counter 0 occupies bytes 0–71. Counter 1 occupies bytes 72–143. The first 8 bytes of Counter 1 fall on the same line as the last 8 bytes of Counter 0. False sharing remains.

Fix: pad to the actual size:

```go
type Counter struct {
    v atomic.Int64
    _ [64 - unsafe.Sizeof(atomic.Int64{})]byte
}
```

Or use `cpu.CacheLinePad`:

```go
type Counter struct {
    v atomic.Int64
    _ cpu.CacheLinePad
}
```

(`CacheLinePad` is sized to push to a full line.)

Always verify with `unsafe.Sizeof` and `unsafe.Offsetof` after padding.

---

## Deep Dive: Visualising Cache Effects with Flame Graphs

`pprof -web` produces an SVG flame graph. Coherence symptoms in a flame graph:

- A wide block labelled `runtime/internal/atomic.Xadd64` or `Cas64`, called from many places.
- A wide block labelled `sync.(*Mutex).Lock` even though the mutex looks uncontended.
- A wide block labelled `sync.(*RWMutex).RLock`.
- A wide block labelled `runtime.lock2` (the runtime mutex).

If you see these, suspect coherence. Run a `-cpu` sweep to confirm scaling collapse. Apply layout fixes. Re-profile.

---

## Deep Dive: A Pre-Mortem Template

Before deploying a high-throughput service, do a coherence pre-mortem:

1. List every struct that holds mutable shared state.
2. For each, list the goroutines that mutate which fields.
3. For each goroutine pair touching the same struct, ask: are the fields on the same line?
4. For each case where the answer is yes, decide: pad, shard, or accept.

Document the decisions. After deploy, monitor `pprof` for the atomics and mutex functions. If they exceed a few percent of CPU at scale, revisit.

---

## Final Mental Image

A modern multi-core CPU is a tiny distributed system. Each core is a node. The coherence fabric is the network. Cache lines are messages. Padding and sharding are the message-reduction strategies. Latency dominates throughput. Locality is everything.

Hold this image in your head while writing Go that shares memory. It will guide you to the right designs.

---

## Closing Thought

Middle-level cache coherence knowledge gives you the vocabulary to debug scaling problems and the mental model to design data structures that scale. Senior knowledge adds NUMA, hardware counters, and full data-structure-design depth. Read senior.md when you are responsible for a system at scale; read professional.md when you are inside the runtime or contributing to high-performance libraries.

---

## Extended Section: Forty Real-World Examples Catalogued

To round out middle.md, here are forty short scenarios with the coherence diagnosis and prescription. Read them in sequence to build pattern recognition.

### Scenario 1
**Problem:** A counter shared by 32 goroutines hits 18M ops/sec; a single-goroutine version hits 165M ops/sec.
**Diagnosis:** Hot atomic. Line bounces 32 ways.
**Prescription:** Shard the counter.

### Scenario 2
**Problem:** Two structs in a slice ping-pong cache lines even though each goroutine touches one struct.
**Diagnosis:** Adjacent structs share lines.
**Prescription:** Pad each struct to one line.

### Scenario 3
**Problem:** Read-heavy `RWMutex` underperforms plain `Mutex`.
**Diagnosis:** RWMutex's reader counter bounces among readers.
**Prescription:** Use `Mutex`, or use a sharded read-mostly cache.

### Scenario 4
**Problem:** Channel send/recv dominates CPU at 100k ops/sec across 64 cores.
**Diagnosis:** Channel's `hchan` is hot.
**Prescription:** Shard the channel.

### Scenario 5
**Problem:** `time.Now()` shows up in pprof at 5% of CPU.
**Diagnosis:** Some platforms read a shared clock page.
**Prescription:** Cache time per-loop; use monotonic deltas.

### Scenario 6
**Problem:** `sync.WaitGroup` Done shows up at 8% of CPU on a fan-out of 50,000 goroutines.
**Diagnosis:** WaitGroup counter line bounces.
**Prescription:** Sharded barrier or batched Done.

### Scenario 7
**Problem:** Latency p99 spikes when the GC runs.
**Diagnosis:** Possibly write barriers contending on a write-barrier buffer line.
**Prescription:** Reduce pointer mutation in hot paths; benchmark.

### Scenario 8
**Problem:** A 32-bucket histogram does not scale beyond 8 cores.
**Diagnosis:** Adjacent buckets share lines.
**Prescription:** Per-CPU histograms, merged on snapshot.

### Scenario 9
**Problem:** A pool of 64 `sync.Mutex` shows surprising contention.
**Diagnosis:** Eight mutexes per cache line; locking any invalidates all.
**Prescription:** Pad each mutex to a line.

### Scenario 10
**Problem:** A reference count protects a resource read by 32 goroutines.
**Diagnosis:** Refcount line bounces 32 ways.
**Prescription:** Pad the count to its own line; consider epoch-based reclamation.

### Scenario 11
**Problem:** A "lock-free" SPSC queue underperforms a mutex queue.
**Diagnosis:** head and tail share a line.
**Prescription:** Pad head and tail apart.

### Scenario 12
**Problem:** A "lock-free" MPMC queue underperforms a mutex queue.
**Diagnosis:** Cells share lines; CAS retries on contention.
**Prescription:** Pad each cell.

### Scenario 13
**Problem:** A counter near a `string` field has slow Inc.
**Diagnosis:** String header writes and counter writes share line.
**Prescription:** Move string elsewhere or pad between.

### Scenario 14
**Problem:** A worker stat struct of 24 bytes scales poorly.
**Diagnosis:** Three int64s in one line.
**Prescription:** Pad to 192 bytes (three lines).

### Scenario 15
**Problem:** A feature flag read on every request shows in pprof.
**Diagnosis:** Flag line is in S; writes to neighbouring counter invalidate it.
**Prescription:** Pad the flag.

### Scenario 16
**Problem:** A per-route counter map ends with allocator-packed structs sharing lines.
**Diagnosis:** Small allocations pack densely.
**Prescription:** Pad the per-route struct to a line.

### Scenario 17
**Problem:** A spin-wait on an atomic burns CPU and slows other goroutines.
**Diagnosis:** Spin issues RFOs that invalidate other cores.
**Prescription:** Park instead of spin.

### Scenario 18
**Problem:** A "concurrent map" using global mutex tops out at 10M ops/sec.
**Diagnosis:** Global mutex's line is hot.
**Prescription:** Switch to `sync.Map` or shard.

### Scenario 19
**Problem:** `time.AfterFunc` calls show in pprof.
**Diagnosis:** Internal heap touches shared state.
**Prescription:** Use per-P timer wheels (advanced).

### Scenario 20
**Problem:** A pool of buffers has high allocation cost.
**Diagnosis:** Per-call allocation; pool not used.
**Prescription:** `sync.Pool`. Already padded internally.

### Scenario 21
**Problem:** An atomic that should be cheap (1 writer, many readers) is expensive.
**Diagnosis:** Readers' atomic.Load brings line to S; writer's next Add must invalidate.
**Prescription:** Reduce read frequency; or accept the S↔M cost.

### Scenario 22
**Problem:** GC frequency surges under load.
**Diagnosis:** Allocator pressure; not directly coherence.
**Prescription:** Reduce allocations. Not a coherence problem.

### Scenario 23
**Problem:** A `sync.Pool` Get is slow.
**Diagnosis:** Local slot empty; victim cache hit costs.
**Prescription:** Tune pool size; ensure Put after each Get.

### Scenario 24
**Problem:** A `sync.Once` is hot.
**Diagnosis:** First call CASes the done flag; subsequent calls are atomic loads.
**Prescription:** If hot after init, fine; if hot in init, fewer Once calls.

### Scenario 25
**Problem:** A `select` with many channels is slow.
**Diagnosis:** select touches each channel's lock to register.
**Prescription:** Reduce select-arm count; or use a single channel with a tag.

### Scenario 26
**Problem:** Many goroutines do `runtime.Gosched()` in a hot loop.
**Diagnosis:** Frequent migration kills cache locality.
**Prescription:** Restructure; avoid Gosched.

### Scenario 27
**Problem:** A `chan struct{}` notification mechanism is slow at scale.
**Diagnosis:** Channel itself is hot.
**Prescription:** Use `sync.Cond` or per-receiver channels.

### Scenario 28
**Problem:** A pool of N goroutines, each updating its own stat, false-shares.
**Diagnosis:** Stats are in an array of small structs.
**Prescription:** Pad each entry.

### Scenario 29
**Problem:** A `RWMutex.RLock` cost is high despite read-heavy workload.
**Diagnosis:** RLock writes to RWMutex's reader counter.
**Prescription:** Snapshot pattern with `atomic.Pointer`.

### Scenario 30
**Problem:** A circular buffer's writer index is updated atomically; reader also reads it.
**Diagnosis:** Reader's atomic Load brings the line to S; writer's next Store must invalidate.
**Prescription:** Reader caches writer-index for amortised reads; reads global only when local cache stale.

### Scenario 31
**Problem:** Two goroutines on adjacent cores (hyperthreads) do not show false sharing.
**Diagnosis:** Hyperthreads share L1.
**Prescription:** Pin to physical cores for benchmarks. In production, this is a happy accident.

### Scenario 32
**Problem:** A counter on a NUMA-pinned process is contended.
**Diagnosis:** All cores on one socket; coherence is same-socket, faster but not free.
**Prescription:** Per-CPU shard within the socket.

### Scenario 33
**Problem:** A two-socket box runs Go service; throughput unexpectedly low.
**Diagnosis:** Cross-socket coherence on global counters.
**Prescription:** numactl or per-socket sharding.

### Scenario 34
**Problem:** A 64-byte-padded counter false-shares on Apple silicon.
**Diagnosis:** M-series uses 128-byte lines.
**Prescription:** Pad to 128 bytes or use `cpu.CacheLinePad`.

### Scenario 35
**Problem:** A long-running daemon's memory grows over time.
**Diagnosis:** Maybe a goroutine leak; possibly per-P pool growth.
**Prescription:** Profile with `pprof.HeapProfile`.

### Scenario 36
**Problem:** A read-mostly map cache uses CAS on every read.
**Diagnosis:** CAS forces line to M.
**Prescription:** Use `atomic.Pointer` for snapshot; readers do plain pointer load.

### Scenario 37
**Problem:** Custom semaphore implementation underperforms `sync.WaitGroup`.
**Diagnosis:** Custom semaphore lacks padding; WaitGroup is tuned.
**Prescription:** Use WaitGroup or sharded semaphore.

### Scenario 38
**Problem:** A goroutine pool's job queue is slow at 1000 workers.
**Diagnosis:** Single channel, all workers receive.
**Prescription:** Multiple channels; hash jobs to channels.

### Scenario 39
**Problem:** `atomic.Pointer[T]` Store is slow.
**Diagnosis:** Same coherence cost as atomic Int64 store; fence + RFO.
**Prescription:** Reduce update frequency; pad.

### Scenario 40
**Problem:** Two goroutines pipeline: producer writes data, consumer reads. Consumer is slow.
**Diagnosis:** Consumer's read brings line to S; producer's next write must invalidate.
**Prescription:** Batch — producer writes N items, then signals; consumer reads N at once.

---

## Extended Section: A Mini-Benchmark Library

A small library you can drop in to characterise any struct for false sharing. The interface:

```go
package coherence

import (
    "sync"
    "sync/atomic"
    "testing"
    "unsafe"
)

// MeasureFalseSharing runs N writers on N int64-sized fields of a struct
// and reports ns/op. Use with various struct designs to compare.
func MeasureFalseSharing(b *testing.B, n int, writeField func(i int)) {
    for i := 0; i < b.N; i++ {
        var wg sync.WaitGroup
        wg.Add(n)
        for j := 0; j < n; j++ {
            j := j
            go func() {
                defer wg.Done()
                for k := 0; k < 1_000_000; k++ {
                    writeField(j)
                }
            }()
        }
        wg.Wait()
    }
}

// CheckSameLine returns true if two addresses share a 64-byte cache line.
func CheckSameLine(a, b unsafe.Pointer) bool {
    return uintptr(a)/64 == uintptr(b)/64
}

// MustBeOnDifferentLines panics if a and b share a cache line.
// Use in init() for hot fields.
func MustBeOnDifferentLines(name string, a, b unsafe.Pointer) {
    if CheckSameLine(a, b) {
        panic(name + ": fields share a cache line")
    }
}
```

Usage:

```go
type Packed struct{ a, b, c, d int64 }
type Padded struct {
    a int64; _ [56]byte
    b int64; _ [56]byte
    c int64; _ [56]byte
    d int64; _ [56]byte
}

func BenchmarkPacked(b *testing.B) {
    var p Packed
    refs := []*int64{&p.a, &p.b, &p.c, &p.d}
    MeasureFalseSharing(b, 4, func(i int) {
        atomic.AddInt64(refs[i], 1)
    })
}

func BenchmarkPadded(b *testing.B) {
    var p Padded
    refs := []*int64{&p.a, &p.b, &p.c, &p.d}
    MeasureFalseSharing(b, 4, func(i int) {
        atomic.AddInt64(refs[i], 1)
    })
}
```

---

## Extended Section: A Memory-Ordering Stress Test

For middle-level confidence in the relationship between coherence and ordering, run this stress test:

```go
package memorder

import (
    "runtime"
    "sync"
    "sync/atomic"
    "testing"
)

func TestReorderingPossible(t *testing.T) {
    runtime.GOMAXPROCS(2)
    seen := map[[2]int32]int{}
    var mu sync.Mutex
    for trial := 0; trial < 1_000_000; trial++ {
        var x, y int32
        var wg sync.WaitGroup
        var r1, r2 int32
        wg.Add(2)
        go func() {
            defer wg.Done()
            x = 1
            r1 = atomic.LoadInt32(&y)
        }()
        go func() {
            defer wg.Done()
            y = 1
            r2 = atomic.LoadInt32(&x)
        }()
        wg.Wait()
        mu.Lock()
        seen[[2]int32{r1, r2}]++
        mu.Unlock()
    }
    t.Logf("%v", seen)
}
```

This is technically about ordering, not coherence, but the same store buffer that makes atomic ops slow also enables the reordering. The reordering is invisible on x86 due to TSO unless the loads are non-atomic plain reads — try changing `atomic.LoadInt32` to bare `y`/`x` reads and run on ARM to see reorderings.

---

## Closing Note for Middle Level

Middle-level mastery means: you can take a struct, predict its coherence behaviour, run a benchmark that confirms or denies your prediction, and propose a fix that you can defend with numbers. You understand the MESI states well enough to walk a cache line through any scenario.

Senior-level mastery (next file) extends this to multi-socket NUMA, hardware counters, and large-scale data structure design. Read it when you are responsible for the architecture of a multi-core Go service.

---

## Extended Section: A Step-by-Step Guide to Reading `perf c2c` Output

`perf c2c` is Linux-only and arguably the most powerful tool for diagnosing false sharing. A guided walk-through.

### Collection

```bash
sudo perf c2c record -F 4000 -a -- sleep 30
```

`-F 4000` sets sample rate to 4000 Hz; `-a` profiles all CPUs; `sleep 30` is the duration. You can replace `sleep 30` with the actual workload to profile.

### Report

```bash
sudo perf c2c report --stdio --full-symbols
```

The output has several sections. The most important:

```
=================================================
   Shared Data Cache Line Table
=================================================
#
#                   ----- HITM -----      Total      ----- Stores -----
# Index             Total      LclHitm    Records    L1Hit      L1Miss
#
#       0            5023        4218       8211      1234       2317
#       1             821         512       1455       234        654
```

Each row is a cache line. The "HITM" columns (Hit-Modified) count cases where one core read a line that another core had in Modified state — i.e., the protocol fetched the line from another core's cache. **High HITM means false sharing.**

The full report shows the source line for each access. Look for the cache lines with the highest HITM and follow them to Go source.

### Interpreting the source view

```
   ------ Load Hitm -----
   Total     LclHitm
    5023        4218       ./mypkg/counter.go:42  *(*int64)(addr) += 1
```

Line 42 of counter.go is the access. Now you know:

- A cache line is being shared by multiple cores.
- One core's writes are forcing other cores to fetch from M state.
- The fix is at line 42, in counter.go.

### What is *not* false sharing

`perf c2c` will also flag legitimate sharing — cases where multiple cores genuinely need the same data. Distinguish by asking: are the fields the cores touch logically independent? If yes, false sharing — fix layout. If no, true sharing — fix algorithm.

### Practical tips

- Run on a representative workload at meaningful traffic.
- Compare before and after a layout change; HITM should drop dramatically.
- For Go programs, ensure symbols are present (build with debug info).
- `perf c2c` does not require root in all configurations; check `/proc/sys/kernel/perf_event_paranoid`.

---

## Extended Section: Cache-Aware Data Structure Design

A short catalog of patterns for designing data structures with coherence in mind.

### The "read mostly + atomic pointer swap" pattern

When state is read overwhelmingly more than written, build immutable snapshots and swap a pointer.

```go
type Service struct {
    config atomic.Pointer[Config]
}

func (s *Service) Reload(c *Config) {
    s.config.Store(c)
}

func (s *Service) Read() *Config {
    return s.config.Load()
}
```

Readers see a stable Config and can traverse it freely without atomics. Writer pays a single atomic Store, and the new Config is published.

### The "per-CPU shard with merge" pattern

When state must be incremented from many cores, shard it.

```go
type Counter struct {
    shards []paddedInt64
}

type paddedInt64 struct {
    v atomic.Int64
    _ cpu.CacheLinePad
}

func New(n int) *Counter { return &Counter{shards: make([]paddedInt64, n)} }

func (c *Counter) Add(slot int) { c.shards[slot%len(c.shards)].v.Add(1) }

func (c *Counter) Sum() int64 {
    var s int64
    for i := range c.shards {
        s += c.shards[i].v.Load()
    }
    return s
}
```

### The "single producer, single consumer" pattern

For pipelines, dedicated channels per direction. Producer touches one set of lines; consumer touches another.

```go
type Pipeline struct {
    in  chan Item
    out chan Item
}
```

Each direction's channel hot lines are owned by one goroutine, kept in M state.

### The "bounded local cache" pattern

When you want some sharing but not all-the-time sharing, give each worker a local cache and flush periodically.

```go
type Worker struct {
    local  [16]int64
    global *atomic.Int64
}

func (w *Worker) Inc(idx int) {
    w.local[idx]++
    if w.local[idx]%1000 == 0 {
        w.global.Add(w.local[idx])
        w.local[idx] = 0
    }
}
```

### The "epoch" pattern

For reclamation, use epoch counters that are sharded per worker.

```go
type Epoch struct {
    workers []paddedInt64
}

func (e *Epoch) Enter(worker int) { e.workers[worker].v.Add(1) }
func (e *Epoch) Exit(worker int)  { e.workers[worker].v.Add(1) }
```

(In real epoch reclamation, you read all workers' epoch values to determine "safe to reclaim" — that's the rare merge step.)

### Anti-pattern: the "central registry"

Avoid:

```go
type Registry struct {
    mu sync.Mutex
    m  map[string]Service
}
```

Every operation grabs `mu`. Use `sync.Map` or sharded design.

### Anti-pattern: the "global atomic flag"

```go
var globalEnabled atomic.Bool
```

Every read is fine on its own, but combined with a write goroutine — even a rare one — the line bounces. Fine if reads are infrequent; problematic if reads are on every request and writes happen during health-checks. Move it inside a padded struct.

---

## Extended Section: The Cost of `sync.Mutex` vs `sync.Spinlock`

Go's standard library does not export a spinlock. The runtime uses internal spinlocks for very short critical sections. User code that "rolls its own" spinlock often falls into a coherence trap.

A naive spinlock:

```go
type Spin struct {
    state atomic.Uint32
}

func (s *Spin) Lock() {
    for !s.state.CompareAndSwap(0, 1) { /* spin */ }
}

func (s *Spin) Unlock() {
    s.state.Store(0)
}
```

Under contention, every spinning core does a CAS that requires the line in M. The line bounces among all spinners. The lock holder also experiences slowdown because its Store fights for the line.

Better:

```go
func (s *Spin) Lock() {
    for {
        if s.state.CompareAndSwap(0, 1) { return }
        for s.state.Load() != 0 { runtime.Gosched() }
    }
}
```

The "test-then-CAS" pattern: only one core CASes; the others just Load (which is cheap). Plus Gosched yields.

For most user code, `sync.Mutex` is better than any custom spinlock. The runtime's internal spinlocks are for very short locks (a few cycles).

---

## Extended Section: A Quick Sketch of Cross-Architecture Differences

A summary table for middle-level reference:

| Aspect | x86-64 | ARMv8 (LSE) | ARMv8 (LL/SC) | Apple Silicon |
|--------|--------|-------------|---------------|---------------|
| Cache line | 64 B | 64 B | 64 B | 128 B |
| Memory model | TSO (strong) | Weak | Weak | Weak |
| Atomic add | `LOCK XADD` | `LDADD` | LDXR/STXR loop | LDADD |
| Atomic CAS | `LOCK CMPXCHG` | `CAS` | LDXR/STXR loop | CAS |
| Atomic load | `MOV` (acquire) | `LDAR` | `LDAR` | LDAR |
| Atomic store | `XCHG` or MOV+`MFENCE` | `STLR` | `STLR` | STLR |
| Full fence | `MFENCE` | `DMB ISH` | `DMB ISH` | DMB ISH |
| Uncontended atomic cost | ~6 ns | ~8 ns | ~10 ns | ~8 ns |

Go abstracts these. Your `sync/atomic.Int64` works the same way logically. The hardware story differs.

---

## Extended Section: A Personal Workflow for Cache-Tuning a Go Service

How a middle-level engineer might approach a coherence-bound service. Numbered for repeatability.

### Step 1 — Establish baseline

```
go test -bench=. -count=10 -cpu=1,2,4,8,16
benchstat -delta-test=none baseline.out
```

Note ns/op for each `-cpu` value. Sublinear scaling is the alarm.

### Step 2 — Profile production

```
go tool pprof -http=:8080 http://prod-host:6060/debug/pprof/profile?seconds=60
```

Look for atomics, mutexes, channel ops at the top.

### Step 3 — Hypothesise

Identify the data structure suspected of false sharing or contention. Read the struct definition. Count fields, alignments, sizes.

### Step 4 — Verify with `unsafe`

At program startup, print addresses of suspect fields. Check whether they share lines.

```go
fmt.Printf("a at %p (line %x), b at %p (line %x)\n",
    &s.a, uintptr(unsafe.Pointer(&s.a))/64,
    &s.b, uintptr(unsafe.Pointer(&s.b))/64)
```

### Step 5 — Reproduce in a benchmark

Write a minimal benchmark mimicking the workload. Confirm scaling collapse.

### Step 6 — Apply fix

Pad, shard, or both. Re-benchmark.

### Step 7 — Hardware-counter verify

If on Linux:

```
perf stat -e cache-misses,LLC-load-misses ./bench-old
perf stat -e cache-misses,LLC-load-misses ./bench-new
```

The new version should show dramatically fewer misses.

### Step 8 — Deploy and observe

Roll out. Monitor pprof for the previously-hot functions. They should drop in cost.

### Step 9 — Document

Write a one-page memo explaining the fix and the measurements. Link from the PR. Future maintainers will thank you.

### Step 10 — Add CI benchmark

Lock the gain in by adding a CI benchmark that fails if ns/op regresses past a threshold. The benchmark runs at `-cpu=N`; a regression in scaling shows up as ns/op rising at higher N.

---

## End of Extended Sections

Middle.md ends here. You now have the hardware-level understanding to design and diagnose cache-aware Go code, plus the pattern catalogue and workflow to apply it consistently. Senior.md extends this to multi-socket systems, full data-structure-design depth, and operational scale.

---

## Quick Reference: Twenty-Five Middle-Level Questions Answered Tersely

1. **What is the MESI protocol?** Four-state coherence: Modified, Exclusive, Shared, Invalid.
2. **What is MOESI?** MESI plus Owned state; delays write-back. AMD chips use it.
3. **What is MESIF?** MESI plus Forward state; Intel.
4. **What is a store buffer?** Per-core queue of pending stores.
5. **What is an invalidation queue?** Per-core queue of pending invalidations.
6. **What does `LOCK` do on x86?** Atomic RMW + full memory barrier.
7. **What does `LDADD` do on ARM?** Atomic add (LSE extension).
8. **What is LL/SC?** Load-linked / store-conditional pair for atomic RMW.
9. **Why are loads cheap on x86?** Plain MOV is acquire by default in TSO.
10. **Why are stores expensive?** Store buffer flush plus possible invalidation.
11. **What is a snoop?** Coherence query from one core to others about a line.
12. **What is a snoop filter?** Hardware table tracking which cores hold each line.
13. **What is NUMA?** Memory access cost varies by socket.
14. **What is UPI?** Intel's inter-socket interconnect.
15. **What is Infinity Fabric?** AMD's inter-socket interconnect.
16. **What is Apple silicon's cache line size?** 128 bytes.
17. **What is `cpu.CacheLinePad`?** Portable cache-line-sized padding.
18. **What is per-P sharding?** One slot per scheduler P; touched only by goroutines pinned to that P.
19. **What does `procPin` do?** Prevents goroutine migration; used in `sync.Pool`.
20. **Why does `sync.RWMutex` sometimes slow things down?** Reader counter line bounces.
21. **What is `perf c2c`?** Linux tool to find false sharing via HITM counts.
22. **What is store-forwarding?** A load reads its own pending store from the store buffer.
23. **What is the cost of `atomic.AddInt64` uncontended on x86?** ~6 ns.
24. **What is the cost under heavy contention?** Can exceed 100 ns.
25. **What is the single best fix for false sharing?** Pad hot fields to one cache line each.

---

## Final Visual Summary

```
THE COMPLETE PICTURE

  +-------------------------------------------------------------+
  |                                                             |
  |                Coherence Fabric / Bus                       |
  |   (carries reads, writes, snoops, invalidations, RFOs)      |
  |                                                             |
  +-+---------------+--------------+---------------+------------+
    |               |              |               |
   Core0           Core1          Core2           Core3
    |               |              |               |
   SB,IQ          SB,IQ          SB,IQ           SB,IQ
    |               |              |               |
   L1d             L1d            L1d             L1d
    |               |              |               |
   L2              L2             L2              L2
    |               |              |               |
    +---------------+---------------+--------------+
                          |
                     Shared L3
                          |
                 Memory Controller
                          |
                        DRAM

  Every shared write travels through this hierarchy.
  Padding keeps writes local. Sharding reduces sharing.
  Per-P slots use the natural locality of the Go scheduler.
```

```
TIMELINE OF AN UNCONTENDED ATOMIC ADD ON LINE-IN-M:

  t=0     decode LOCK XADD
  t=1     flush store buffer        (-> some cycles)
  t=10    line in L1 (M)
  t=11    perform RMW
  t=14    commit, mark dirty
  t=15    pipeline refill
  t=20    next instruction starts
                          (~6 ns at 3 GHz)

TIMELINE OF A CONTENDED ATOMIC ADD ON LINE-IN-S:

  t=0     decode LOCK XADD
  t=1     flush store buffer
  t=10    line in L1 (S)
  t=11    issue invalidation
  t=11    other cores receive snoop
  t=20    other cores ACK, downgrade to I
  t=30    this core's line transitions to M
  t=31    perform RMW
  t=34    commit, mark dirty
  t=35    pipeline refill
  t=40    next instruction starts
                          (~13 ns at 3 GHz)

TIMELINE UNDER BOUNCING:

  t=0     this core does AddInt64
  t=30    completes (was in M)
  t=30    other core does AddInt64
  t=30    snoop arrives at this core
  t=40    this core downgrades to I
  t=60    other core gets line in M
  t=63    other core completes
  ...
  effective rate: one op per ~30 ns
```

This is the visualisation worth memorising. Coherence is the system. Layout is the lever.

---

## Truly the End

Middle.md is complete. Apply what you learned. Run benchmarks. Read the standard library source. Then graduate to senior.md when you are ready to design data structures at architecture scale.

---

## Appendix: Annotated Tour of `sync.Map`

`sync.Map` is the standard library's coherence-aware concurrent map. A walkthrough of `src/sync/map.go`:

```go
type Map struct {
    mu Mutex

    read atomic.Pointer[readOnly]

    dirty map[any]*entry

    misses int
}
```

The `read` is an atomically-swappable read-only snapshot. Readers do an atomic pointer load (cheap, line in S) and then a regular map lookup. No mutex acquisition on the hot read path. This is the snapshot pattern at scale.

The `dirty` map holds entries that have been added but not yet promoted into `read`. The `mu` serialises updates to `dirty`. When `misses` exceeds a threshold, `dirty` is promoted to a new `read`, atomic-swapped, and the old `read` is discarded.

Key coherence properties:

- Reads hit the `read` snapshot — atomic Load only, no writes, no invalidations on the reader's side.
- Writes go through `mu` and `dirty` — coherence on the dirty path is more expensive but rare.
- The promotion is atomic and infrequent.

This is the canonical pattern: snapshots for reads, mutex for writes, atomic pointer swap for promotion.

When to use `sync.Map`:

- Read-mostly workloads.
- Keys that are stable; the set of keys does not grow indefinitely.
- Concurrent access from many cores.

When **not** to use it:

- Write-heavy workloads (a plain `map` + `sync.Mutex` may be faster).
- Strictly typed keys/values needed (the API is `interface{}`).

Read the source. The patterns are reusable for any read-mostly state.

---

## Appendix: A Quick Word on Generics and Padding

Go 1.18 added generics. Padding generic types is slightly more involved because `unsafe.Sizeof(T{})` is not a compile-time constant for type parameters.

A workaround:

```go
type PaddedCounter[T comparable] struct {
    v T
    _ [128]byte // assume max size; over-padding is OK
}
```

Or use `cpu.CacheLinePad` after a normal field:

```go
type PaddedCounter[T any] struct {
    v T
    _ cpu.CacheLinePad
}
```

If `T` is small (an int64, a pointer), `CacheLinePad` plus the field exceeds one line. For tighter packing, specialise per type.

In practice: do not use generics for cache-aware code unless you must. Specialised types with hand-tuned padding are clearer and tighter.

---

## Appendix: A Final Sanity Test

Run this at startup of any cache-sensitive package:

```go
func init() {
    cl := cpu.CacheLinePadSize
    if cl < 64 {
        panic("unexpected cache line size; check x/sys/cpu")
    }
}
```

And at struct construction:

```go
func NewCounter() *Counter {
    c := &Counter{}
    a := uintptr(unsafe.Pointer(&c.value))
    if a%uintptr(cpu.CacheLinePadSize) != 0 {
        // Not aligned; padding may not work as intended.
        // Either reallocate or accept the cost.
    }
    return c
}
```

These cheap checks catch surprises early. A misaligned struct produces silently slow code. A loud init-time panic produces obvious code.

---

## End for Real

Done with middle.md. Read senior.md next when ready.

---

## Appendix: Pop Quiz

Test middle-level understanding without re-reading:

1. What states does MESI have, and which are "fast read" states?
2. Why is `atomic.Store` more expensive than `atomic.Load` on x86?
3. What is the role of the store buffer?
4. When does a snoop filter help?
5. What is `perf c2c` used for?
6. What is the cost of a cross-socket invalidation versus same-socket?
7. Why does `sync.RWMutex` sometimes underperform `sync.Mutex`?
8. What is per-P sharding and where does Go use it?
9. What is the cache line size on Apple silicon?
10. Why does `LDADD` outperform LL/SC under high contention?
11. What is `cpu.CacheLinePad` and what does it expand to?
12. Name three patterns for avoiding atomic contention.
13. What does `runtime.procPin()` do?
14. What is the difference between snoops and invalidations?
15. What is RFO and when is it issued?

If you can answer all fifteen confidently, you are middle-level. Move on to senior.

---

## Appendix: A Tiny Final Quote

> The cache line is the unit. The protocol is the language. Padding is grammar. Sharding is style. Measurement is truth.

Hold this in your head when designing concurrent Go.

---

## Appendix: An Even Closer Look at `LOCK XADD`

The single most consequential instruction in this whole topic. A microscope view.

```
LOCK XADD [mem], reg
```

What happens, cycle by cycle, on an Intel Skylake-class core, with the line in M state on this core:

1. **Decode** (1 cycle): the instruction enters the reservation station.
2. **Dispatch**: the LOCK prefix marks this op as needing memory ordering.
3. **Address generation** (1 cycle): compute `[mem]`.
4. **Store buffer drain**: any pending stores ahead of this op must drain. Could be 0 cycles if buffer is empty; up to ~10 if full.
5. **L1 lookup**: line in M, hit.
6. **Read old value**: 1 cycle.
7. **Compute new value**: register + memory; 1 cycle.
8. **Write back to L1**: 1 cycle.
9. **Mark line as dirty (still M)**.
10. **Pipeline barrier**: subsequent loads/stores serialize.
11. **Retire**: ~5 cycles of pipeline refill.

Total: ~20 cycles ≈ 6.5 ns at 3 GHz.

When the line is in S (another core has read), step 5 becomes:

5a. **Issue invalidation**: send RFO to fabric. ~5 cycles to dispatch.
5b. **Snoop responses**: other cores receive snoop, downgrade to I, ACK. ~20 cycles for fastest core, more for slower ones.
5c. **Line transitions to M**: ~1 cycle.

Total now ~45 cycles ≈ 15 ns.

When the line is in I (cold or bounced):

5a. **Issue RFO**: ~5 cycles.
5b. **L3 lookup**: ~10 cycles.
5c. **L3 hit**, fetch line, mark S in other cores invalid: ~10 cycles.
5d. **Line into L1 as M**: ~5 cycles.

Total ~50 cycles ≈ 17 ns. If L3 misses, add ~70 ns for DRAM.

Under sustained contention, each core's increments take roughly the cross-core latency, which is ~30 cycles on a single socket — so ~10 ns per op. Multiply by N cores, divide by N, you get total throughput of perhaps 100 M ops/s across the chip, regardless of how many cores you throw at it.

This is the entire scaling story. Padding eliminates steps 5a-5d for the common case. Sharding distributes the load so no one line is hot.

---

## Truly, Truly the End

Now read senior.md.

---

## One Last Thought

The hardware does not lie. The protocol does not negotiate. The cost is mechanical, repeatable, and visible if you look. Look. Measure. Lay out your code with the hardware's grain. Your Go will scale, and you will know exactly why.

The end.

---

## Closing Notes

Middle-level material complete. Key takeaways:

1. MESI explains every coherence event.
2. Store buffers and invalidation queues hide latency at the cost of memory ordering.
3. `LOCK` on x86 and LSE/LL/SC on ARM implement atomic RMW.
4. Go's `sync/atomic` operations compile to the right primitives.
5. `sync.Mutex` is a spin-then-park lock with starvation prevention.
6. `sync.Pool` uses per-P slots padded to 128 bytes.
7. `sync.Map` uses snapshot reads and mutex writes.
8. `perf c2c` is the killer false-sharing diagnostic on Linux.
9. Padding fixes false sharing; sharding distributes contention.
10. Production discipline (CI benchmarks, postmortems) prevents regression.

The next file (senior.md) extends this to system design at scale.

End.

---

## Final Closing

Read senior.md next.

End.

---

## A Final Footnote

Cache coherence is more than a technical topic. It is a way of thinking about parallel computation. Once you see the hardware as a small distributed system with messages flying between caches, you cannot unsee it. Every concurrent Go program you write will reveal its coherence shape.

Embrace the perspective. Build cache-aware code. Iterate.

End.

---

## Truly Final

The middle file is complete.

End.



