# What is Concurrency — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [The CPU Pipeline and What "Concurrency" Means at Hardware Level](#the-cpu-pipeline-and-what-concurrency-means-at-hardware-level)
3. [Caches, Coherence, and the Cost of Sharing](#caches-coherence-and-the-cost-of-sharing)
4. [False Sharing](#false-sharing)
5. [Memory Ordering and Fences](#memory-ordering-and-fences)
6. [NUMA and Topology](#numa-and-topology)
7. [Context Switch Costs in Detail](#context-switch-costs-in-detail)
8. [Concurrency on Modern Hardware: a Walkthrough](#concurrency-on-modern-hardware-a-walkthrough)
9. [Profiling Concurrent Programs](#profiling-concurrent-programs)
10. [Summary](#summary)

---

## Introduction

So far concurrency has been an abstract property of programs. At the professional level we ground it in the hardware. The CPU is not a single sequential engine; it is itself massively concurrent and parallel — instruction-level pipelining, out-of-order execution, multiple execution units, multi-level caches with coherence protocols, NUMA topology between sockets. The "concurrency" your Go program expresses must cooperate with the concurrency the hardware already has.

This file is not a complete computer-architecture reference. It is a working professional's set of mental models for: why two goroutines on different cores share a cache line and why that hurts, what a memory barrier costs, why even a single-threaded `for` loop is concurrent at the instruction level, and how to read a concurrent profile.

---

## The CPU Pipeline and What "Concurrency" Means at Hardware Level

A single CPU core executes instructions in a pipeline. At any moment, several instructions are in flight at different stages: one being fetched, one being decoded, one being executed, one writing back its result. This is **instruction-level parallelism (ILP)**. Even a "sequential" Go program runs concurrent operations inside the core.

Modern Intel and AMD cores are out-of-order: the CPU may execute instructions in a different order from the source code, as long as the *observable* result is the same. They are also superscalar: multiple instructions per cycle. A typical core has 4–8 issue slots.

What this means for concurrency:

- **A single goroutine on a single core already uses parallelism inside the CPU.** The "core" is itself a parallel machine.
- **Memory barriers serialise instruction ordering.** They tell the CPU "do not reorder loads or stores across this point." This is expensive; an `mfence` on x86 is dozens of cycles.
- **Branch prediction matters.** Concurrent code with many `if`s on shared state suffers prediction misses when the state changes from another core.

The Go runtime and standard library hide most of this. But when contention shows up in benchmarks, the answer often lies at the cache and memory level, not at the goroutine level.

---

## Caches, Coherence, and the Cost of Sharing

A modern CPU has L1, L2, L3 caches. Each core has its own L1 and L2; L3 is shared. The unit of cache transfer is a **cache line**, typically 64 bytes.

When core A modifies a value, the modified cache line lives in A's L1. Core B reading the same variable must either:

1. Snoop core A's cache (MESI protocol — Modified, Exclusive, Shared, Invalid).
2. Wait for A's modification to propagate through L3 or main memory.

The first case takes tens of nanoseconds; the second hundreds. **Concurrent reads of the same variable from different cores are not free.** Concurrent writes are far worse — every write invalidates the line in every other core's cache, forcing a fresh fetch on the next read.

```
Time for a memory access (typical, 2024 Intel):
  L1 hit:                    ~1 ns
  L2 hit:                    ~5 ns
  L3 hit:                   ~25 ns
  Same socket, other core:  ~60 ns (cross-core snoop)
  Other socket (NUMA):     ~150 ns
  Main memory:             ~100 ns
```

A mutex acquisition on a contended lock involves at least one cross-core cache-line transfer. That is why contended mutexes are slow even when the critical section is short.

### Implications for Go code

- A single `atomic.AddInt64(&counter, 1)` from 32 cores in a tight loop saturates the inter-core bandwidth, not the ALUs. Throughput is bounded by L3 / coherence, not by the increment.
- A `sync.RWMutex.RLock` is cheap when uncontended (one atomic increment), expensive when writers exist (acquire-release on the writer side invalidates the reader side).
- Channel sends touch a small struct (the `hchan`). If a channel is contended, the struct's cache line bounces.

---

## False Sharing

The cache line is 64 bytes. Two variables that fit on the same cache line are treated as one unit by the coherence protocol. If one core writes variable X and another core reads variable Y on the same line, the line bounces between them even though no real sharing is happening.

```go
type stats struct {
    a int64 // 8 bytes
    b int64 // 8 bytes
    // both on the same 64-byte cache line
}
```

If goroutine 1 writes `s.a` 1M times while goroutine 2 writes `s.b` 1M times, throughput is much lower than expected because the cache line ping-pongs.

### Fix: pad to a cache line

```go
type stats struct {
    a   int64
    _   [56]byte // pad to 64-byte boundary
    b   int64
    _   [56]byte
}
```

Or wrap each per-CPU counter in its own struct with sufficient padding.

The Go runtime uses this technique internally for per-P counters and for the GMP scheduler's run queues.

### Detecting false sharing

There is no perfect tool. Symptoms include:

- A multi-goroutine benchmark that scales sublinearly despite no obvious lock.
- `perf stat -e cache-misses` showing many last-level cache misses.
- `pprof -mutex` showing low contention but `cpu` showing time in seemingly innocuous code.

Hypothesise; pad; re-benchmark.

---

## Memory Ordering and Fences

The CPU and compiler may reorder reads and writes for performance, as long as the program's *sequential* semantics are preserved. Reorderings show up as surprises across goroutines.

```go
var x, y int
var done bool

// goroutine A
x = 1
y = 2
done = true

// goroutine B
if done {
    fmt.Println(x, y) // may print 0, 0!
}
```

Without synchronisation, B's `done` read may be reordered before x, y are written. Or B's view of `x, y` may not yet reflect A's stores. This is **memory reordering**. The CPU did it; the compiler did it; either way the behaviour is undefined per Go's memory model.

To fix, use a synchronisation primitive that establishes a **happens-before** relationship: `sync.Mutex.Lock()`, channel send/receive, `atomic.Store`/`atomic.Load`, etc. Each carries an implicit fence.

### Fences are not free

An `MFENCE` on x86 takes dozens of cycles. ARM uses `dmb ish` (data memory barrier, inner shareable), similar cost. The Go runtime inserts fences only where the memory model demands them, but contention multiplies their cost.

This is why hot-path atomic operations on a shared variable are expensive: each one is a fence.

### Lock-free programming

Constructing data structures that allow concurrent access without locks is its own art. Go provides `sync/atomic`; the standard library uses it heavily (e.g., `sync.Map`'s read path is lock-free). Designing lock-free structures requires understanding which operations are atomic, which require fences, and how to avoid ABA problems. Most application code should not attempt this; reach for `sync.Mutex` or channels.

---

## NUMA and Topology

Servers with multiple CPU sockets are NUMA (Non-Uniform Memory Access) machines. Each socket has its own memory bank. Memory accesses to local memory are faster than to remote memory.

A typical 2-socket Xeon machine:

- Local memory access: ~100 ns.
- Remote memory access: ~150 ns (1.5x slower).
- Inter-socket cache transfer: ~150 ns.

The Go runtime is NUMA-unaware as of 1.22. It does not pin goroutines to sockets or allocate memory near the running core. For most workloads this is fine; for ultra-low-latency systems (HFT, real-time), people pin OS threads and use `runtime.LockOSThread` plus OS-level affinity tools (`taskset`, `numactl`).

### Practical advice

- For single-socket systems (most cloud VMs), NUMA effects are absent.
- For multi-socket bare-metal or large VMs (e.g., AWS m6i.metal), measure with `numactl --hardware` and consider socket affinity.
- When affinity matters, partition the workload by socket — e.g., one Go process per socket.

---

## Context Switch Costs in Detail

A context switch saves the current task's state and restores the next task's. For OS threads:

- Kernel mode entry / exit: hundreds of cycles.
- Register save / restore: ~50 cycles.
- TLB flush (if process boundary): ~1000 cycles plus refill cost.
- Cache disruption on the new core: variable, often the dominant cost.

Total: 1–5 µs typical for a thread context switch.

For goroutines:

- Stack pointer swap and a few registers: ~10 cycles.
- No kernel transition.
- No TLB flush.
- Same address space, same cache.

Total: ~20–200 ns. Two orders of magnitude faster than thread switching.

This is the core reason Go's M:N scheduler scales: goroutine switches do not pay kernel costs. When a goroutine blocks on a channel or mutex, the runtime swaps in another goroutine on the same OS thread for a few hundred nanoseconds, not microseconds.

### When the OS still pays the bill

Goroutine blocking on a system call (network read, file I/O, syscall) does cost a kernel transition. The runtime hands the OS thread back to the scheduler (`sysmon` may spin up a new thread if the syscall is long). For network I/O on Linux, the runtime uses `epoll` (poller) to avoid blocking the thread at all; for file I/O, there is no such poll mechanism (Linux io_uring partly fixes this, but Go does not yet use it directly).

---

## Concurrency on Modern Hardware: a Walkthrough

Suppose 8 goroutines on 8 cores increment a shared counter. What actually happens?

```go
var counter int64
for i := 0; i < 8; i++ {
    go func() {
        for j := 0; j < 1_000_000; j++ {
            atomic.AddInt64(&counter, 1)
        }
    }()
}
```

Expected: 8 cores in parallel, 8x speedup over a single goroutine. Reality: roughly 1x.

Why? Every `atomic.AddInt64` is a `LOCK XADD` instruction on x86. It acquires exclusive ownership of the cache line containing `counter` (MESI Modified state). The other 7 cores then see their cache line invalidated, and must re-fetch on their next access. They serialise on the cache line.

The 8 cores are *taking turns* owning the line. Inter-core latency is ~60 ns. Eight goroutines doing one `atomic.AddInt64` each, in lockstep, takes ~480 ns per round. With a million rounds per goroutine, that is ~480 ms total — sequential rate.

The fix: per-goroutine counters, combined at the end.

```go
counters := make([]int64, 8)
var wg sync.WaitGroup
for i := 0; i < 8; i++ {
    wg.Add(1)
    go func(i int) {
        defer wg.Done()
        for j := 0; j < 1_000_000; j++ {
            counters[i]++
        }
    }(i)
}
wg.Wait()
var total int64
for _, c := range counters {
    total += c
}
```

But beware false sharing: `counters[0]` through `counters[7]` may all live on the same cache line. Pad them.

```go
type paddedCounter struct {
    n   int64
    _   [56]byte
}
counters := make([]paddedCounter, 8)
```

Now each counter is on its own line. Eight cores run truly in parallel.

This pattern — per-core local accumulation, combine at the end — is the cornerstone of high-performance concurrent code. The Go runtime uses it for the scheduler's run queues, for `sync.Pool` shards, and for GC bookkeeping.

---

## Profiling Concurrent Programs

The standard Go toolchain provides several profile types for concurrent code:

### CPU profile

```bash
go test -cpuprofile cpu.out -bench .
go tool pprof cpu.out
```

Shows where CPU time is spent. Useful when CPU is saturated.

### Goroutine profile

```bash
go tool pprof -alloc_space http://localhost:6060/debug/pprof/goroutine
```

Shows goroutine call stacks. Useful for finding leaks.

### Block profile

```go
runtime.SetBlockProfileRate(1)
```

Records goroutines blocked on synchronisation (mutex, channel, syscall). Useful for finding contention.

### Mutex profile

```go
runtime.SetMutexProfileFraction(1)
```

Records mutex contention specifically. Useful for finding lock contention.

### Trace

```bash
go test -trace trace.out -bench .
go tool trace trace.out
```

A detailed time-series of every goroutine, every scheduler event, every GC pause. The most informative tool for understanding concurrency, with a learning curve.

### Reading a trace

The `go tool trace` UI shows per-P timelines: each row is a logical processor, each block is a goroutine running. Look for:

- **Wide gaps:** P is idle. Are there goroutines runnable elsewhere? If so, work-stealing is failing or scheduler is busy.
- **Many short blocks:** goroutines are switching constantly. Likely too much synchronisation.
- **Long single blocks:** one goroutine monopolising a P, possibly without preemption.
- **STW pauses:** GC stop-the-world events. Long ones indicate large heap or many goroutines.

---

## Summary

Concurrency in Go programs interacts with concurrency in the hardware. A `go f()` is cheap because the runtime avoids kernel transitions, but the hardware costs — cache coherence, memory barriers, NUMA latency — are unavoidable. Lock-free programming is possible but requires care; the standard library's `sync` and `sync/atomic` are tuned for typical workloads.

The professional view treats concurrency as a layered system: application goroutines on top, the Go runtime in the middle, the kernel below, the CPU and memory hierarchy at the bottom. Performance comes from making each layer cooperate. Profile, measure, hypothesise, pad cache lines if needed, and accept that the deepest lessons of concurrency are written in assembly and silicon, not in the language spec.

The next file (`specification`) returns to formal definitions and references.
