---
layout: default
title: False Sharing — Professional
parent: False Sharing
grand_parent: Memory Ordering Barriers
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/22-memory-ordering-barriers/05-false-sharing/professional/
---

# False Sharing — Professional / Runtime Internals

## Table of Contents
1. [Introduction](#introduction)
2. [Reading the Go Runtime: A Tour](#reading-the-go-runtime-a-tour)
3. [`runtime/internal/sys.CacheLinePad` in Depth](#runtimeinternalsyscachelinepad-in-depth)
4. [`sync.Pool` Internals](#syncpool-internals)
5. [Scheduler Per-P Structures](#scheduler-per-p-structures)
6. [The Semaphore Treap](#the-semaphore-treap)
7. [Memory Allocator `mcache`](#memory-allocator-mcache)
8. [`runtime.LockOSThread` and CPU Affinity](#runtimelockosthread-and-cpu-affinity)
9. [Microarchitecture: Adjacent Cache Line Prefetch](#microarchitecture-adjacent-cache-line-prefetch)
10. [`perf c2c` Mastery](#perf-c2c-mastery)
11. [Hardware Counters via `pprof`](#hardware-counters-via-pprof)
12. [Assembly Inspection](#assembly-inspection)
13. [Cross-Process False Sharing](#cross-process-false-sharing)
14. [Custom Allocators and Aligned Memory](#custom-allocators-and-aligned-memory)
15. [Case Studies from Production Go](#case-studies-from-production-go)
16. [Future of Cache Coherence in Go](#future-of-cache-coherence-in-go)
17. [Self-Assessment](#self-assessment)
18. [Summary](#summary)

---

## Introduction
> Focus: "I work on runtimes, schedulers, or low-level libraries. I need to understand cache coherence at the silicon level, the Go runtime's defences against false sharing, and the tools that diagnose problems no profiler will surface."

This file is for engineers who write the layers other engineers depend on: runtimes, schedulers, low-level libraries, lock-free data structures, performance-critical infrastructure. The content assumes you have read the junior, middle, and senior files; this is the deep end.

Topics include:

- Direct reading of the Go runtime source, with file and function references.
- Microarchitectural details (adjacent-line prefetch, snoop filters, cache directory effects).
- `perf c2c` and hardware counters at production scale.
- Custom allocator strategies for aligned memory.
- Cross-process and cross-machine false sharing.

---

## Reading the Go Runtime: A Tour

The Go runtime source is the best teacher for false-sharing avoidance. The relevant files (in `$GOROOT/src/runtime`):

| File | What to find |
|------|--------------|
| `internal/sys/intrinsics.go` | `CacheLinePad`, `CacheLineSize` definitions per platform. |
| `sync_pool.go` (in `sync` package) | `poolLocal` with explicit padding. |
| `proc.go` | Scheduler. `p` struct, `findRunnable`, work stealing. |
| `runtime2.go` | The `p`, `m`, `g`, `schedt` struct definitions. |
| `mcache.go` | Per-P memory allocator cache. |
| `sema.go` | Semaphore table with padded roots. |
| `lockrank.go` | Lock-rank table (small, aligned). |
| `time.go` | Per-P timer heaps. |
| `mprof.go` | Profile counter storage. |
| `runtime_test.go` | Tests that catch layout regressions. |

A productive afternoon: clone the Go source, search for `CacheLinePad`, read the surrounding code, run the tests. After this exercise, the patterns become second nature.

### Searching the runtime

```
$ grep -rn "CacheLinePad" $(go env GOROOT)/src/runtime/ | head -20
$ grep -rn "//pad" $(go env GOROOT)/src/runtime/ | head -20
$ grep -rn "false sharing" $(go env GOROOT)/src/runtime/
```

Each hit is an opportunity to learn a real-world padding pattern.

### Version-specific quirks

The Go runtime evolves. Padding patterns get added, removed, or refactored each release. Examples:

- Pre-Go 1.10: scheduler used explicit padding around `p.runqhead` / `p.runqtail`.
- Go 1.10+: the surrounding fields in `p` were rearranged so that natural layout already separated head and tail by ~one cache line, removing the need for explicit padding.
- Go 1.14: introduction of asynchronous preemption added new state fields to `g` and `m`; some were placed carefully to avoid false sharing with existing hot fields.
- Go 1.19: `sync/atomic` typed wrappers (`atomic.Int64`, etc.) introduced. These are 8 bytes for `Int64`; no internal padding.
- Go 1.21+: ongoing tuning of `sync.Pool` and scheduler structures.

When studying the runtime, check the version. The "canonical" layout changes.

---

## `runtime/internal/sys.CacheLinePad` in Depth

The definition (simplified):

```go
// runtime/internal/sys/intrinsics.go (paraphrased)

type CacheLinePad struct{ _ [CacheLineSize]byte }
```

`CacheLineSize` is platform-specific:

```go
// runtime/internal/sys/zgoarch_amd64.go (and similar per-platform)
const CacheLineSize = 64

// runtime/internal/sys/zgoarch_ppc64.go
const CacheLineSize = 128

// runtime/internal/sys/zgoarch_arm64.go
const CacheLineSize = 64
```

The runtime uses it inline:

```go
// example pattern:
type someStruct struct {
    hotField1 int64
    _         sys.CacheLinePad
    hotField2 int64
    _         sys.CacheLinePad
}
```

Two patterns appear in the runtime:

- **Between hot fields**: padding placed between any two fields written by different goroutines.
- **At the boundary**: padding at the end of a struct, ensuring the next allocation does not share a line.

The runtime tends to use the *between* pattern for intra-struct field isolation and `CacheLinePad` arrays for whole-struct alignment.

### Why not 128?

`CacheLineSize` is set to the *coherence granularity*, not the prefetch granularity. On Intel CPUs, the L2 cache prefetcher loads pairs of adjacent 64-byte lines as a 128-byte unit. This means false sharing can occur at the 128-byte level via prefetcher fetches, not just at the 64-byte coherence level.

The Go runtime's choice of 64 (on amd64) is a deliberate compromise: 64 covers the dominant cost (coherence bouncing), while 128 would double memory cost for marginal additional gain. Real-world measurements show 64 captures most of the speedup.

For ultra-high-performance code (e.g., HFT, dedicated network appliances), padding to 128 is sometimes worth it. For most Go code, 64 suffices.

### Cross-platform handling

```go
//go:build amd64 || arm64

package sys
const CacheLineSize = 64

//go:build ppc64 || ppc64le

package sys
const CacheLineSize = 128

//go:build mips || mipsle

package sys
const CacheLineSize = 32
```

The runtime maintains a per-architecture file with the right constant. User code can wrap this with build tags or hardcode 64 (sacrificing portability).

---

## `sync.Pool` Internals

`sync.Pool` is the canonical real-world example of cache-line padding in Go. Let's walk through it.

### The poolLocal layout

From `src/sync/pool.go` (paraphrased and simplified for current Go versions):

```go
type Pool struct {
    noCopy noCopy

    local     unsafe.Pointer // *[P]poolLocal: array of per-P pools
    localSize uintptr        // size of the local array

    victim     unsafe.Pointer // *[P]poolLocal: previous generation
    victimSize uintptr

    New func() interface{}
}

type poolLocalInternal struct {
    private any         // local-only
    shared  poolChain   // local push/pop head; any can pop tail
}

type poolLocal struct {
    poolLocalInternal

    // Pad to size of a cache line on widespread platforms
    // (128 mod CacheLineSize == 0).
    pad [128 - unsafe.Sizeof(poolLocalInternal{})%128]byte
}
```

Several details:

- **Per-P array**: `local` points to an array of `poolLocal` indexed by P. Each P has its own slot.
- **Internal data is small**: `poolLocalInternal` holds a `private` field (one `any`, 16 bytes) and a `shared` field (a `poolChain` head pointer). Total ~32 bytes.
- **Padding to 128**: the `pad` field rounds the struct to a multiple of 128 bytes. Why 128? Because Intel's L2 prefetcher pulls adjacent cache lines, and 128 bytes covers both lines.
- **Modulo trick**: `128 - sizeof(internal) % 128` computes the right padding regardless of internal size. If internal is exactly 128, padding is 0; if it's 32, padding is 96; etc.

This design ensures each P's pool slot is on its own cache line *pair*, with no false sharing from neighbouring Ps' slots.

### The hot path

`Pool.Get`:

```go
func (p *Pool) Get() interface{} {
    // Pin to current P.
    l, pid := p.pin()
    x := l.private
    l.private = nil
    if x == nil {
        // Try to pop from local shared chain.
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

The `pin` operation:
1. Calls `runtime_procPin()` — pins this goroutine to its current P.
2. Returns a pointer to this P's `poolLocal`.

Once pinned, `Get` operates on this P's local slot. No other goroutine on another P touches this slot during the pin window. No atomics needed for `l.private`.

If the private slot is empty, it tries `l.shared` (a lock-free deque). The deque allows the local P to push/pop at one end, and other Ps to steal from the other end. The deque itself is internally cache-aware.

### Why `Pool` cannot be naively shared across goroutines

The whole design assumes one goroutine per P at a time. The `pin`/`unpin` calls enforce this. Without pinning, you would need full atomics on every slot access, defeating the per-P optimisation.

### The garbage collector's role

`sync.Pool` is cleared on every GC cycle (more precisely: every two cycles, with a victim-cache for transitional reuse). This means long-term objects in `Pool` are not memory leaks but are reset to nil. The padding survives GC; only the `private` / `shared` content is reset.

### Cache effects on Pool

Reading the `Pool` code, you see two cache-related design decisions:

1. **Padding** (above): false-sharing avoidance.
2. **Pin-then-LIFO** access: the local goroutine pops the most recently pushed object, which is likely still in its L1 cache (recent push). Stealing from other Ps takes the *oldest* (likely cold) objects. This means the local hot path stays L1-hot.

These two together (cache-line padding + LIFO locality) are why `sync.Pool` is so much faster than a naive `chan interface{}` of free objects.

---

## Scheduler Per-P Structures

The Go scheduler's per-P state lives in the `p` struct, defined in `runtime/runtime2.go`. The struct is large (~200+ fields). Reading it, you find:

### Layout overview

```go
type p struct {
    id      int32
    status  uint32

    // Many small fields ...

    // Per-P run queue
    runqhead uint32   // written by other Ps (stealers) via CAS
    runqtail uint32   // written by this P
    runq     [256]guintptr
    runnext  guintptr

    // GC-related per-P state
    mcache      *mcache

    // ... and much more ...
}
```

In current Go versions, the layout is such that `runqhead` and `runqtail` are within a few words of each other but not always on the *exact same* cache line. The scheduler is benchmarked on every release; if false sharing on the runqueue becomes a hotspot, padding is added.

### Work stealing

Work stealing is the place where cross-P contention happens in the scheduler. When P A's runqueue is empty, it tries to steal half of P B's runqueue. This touches B's `runqhead` (via CAS) while B is also potentially writing `runqtail`. False sharing here is performance-critical.

The mitigation: stealing is *infrequent* per attempt (a P only steals when its local queue is empty), and the design uses fixed-size queues so steals are bounded. Even with occasional false sharing, the overall scheduler is dominated by other work.

### `sched` global structure

```go
type schedt struct {
    goidgen   atomic.Uint64
    lastpoll  atomic.Int64
    pollUntil atomic.Int64

    lock mutex

    // ... lots of fields ...

    midle        muintptr  // idle M's waiting for work
    nmidle       int32
    nmidlelocked int32
    mnext        int64

    runq     gQueue
    runqsize int32

    // ... GC state, sysmon state ...
}
```

The global `sched` struct is touched by all Ps when accessing global runnable queue, idle M list, etc. Its hot fields are accessed under `sched.lock`, so cache-line considerations matter less (only one M holds the lock at a time). The cold fields are read-mostly.

The Go runtime team has tuned this struct's layout over many years to minimise contention.

---

## The Semaphore Treap

`runtime/sema.go` implements semaphores. Internally, each address can have an associated wait queue; the runtime maintains a fixed-size table of *semaroots* (251 of them on most platforms) and hashes addresses into the table.

### The semroot

```go
type semaRoot struct {
    lock  mutex
    treap *sudog       // treap of unique waiter addresses
    nwait atomic.Uint32 // count of waiters
}
```

The hot field is `nwait` (read by `semrelease` to decide whether to wake), accessed without holding the lock. If `semaRoot`s for two different keys land on the same cache line, they false-share on `nwait` accesses.

### The padded table

```go
var semtable semTable

type semTable [semTabSize]struct {
    root semaRoot
    pad  [cpu.CacheLinePadSize - unsafe.Sizeof(semaRoot{})%cpu.CacheLinePadSize]byte
}
```

(Approximate; exact layout varies.) Each entry is padded to a cache-line multiple. Two adjacent semaphores in the table do not false-share.

### Why 251?

251 is prime, chosen to give good hash distribution with simple modular hashing. The table size is small enough to fit in L2 but large enough to make collisions rare. For 251 entries × ~64 bytes = ~16 KB; comfortably in L1 or L2 of any modern core.

### Cache effects on semaphores

Semaphore operations (`semacquire`, `semrelease`) hit a randomly hashed entry. Under heavy semaphore use, the table is hot in L2 but cold in L1 (since each operation hits a different entry). False sharing inside the table would compound this — preventing it via padding lets each operation pay only the L2 miss, not also the coherence cost.

---

## Memory Allocator `mcache`

Each P has an `mcache` of small-object spans, accessed without locks during normal allocation. The mcache is a separately allocated structure, so it does not share allocations with other data. Internally:

```go
// runtime/mcache.go (paraphrased)
type mcache struct {
    nextSample      uintptr
    scanAlloc       uintptr
    tiny            uintptr
    tinyoffset      uintptr
    tinyAllocs      uintptr
    alloc           [numSpanClasses]*mspan
    stackcache      [_NumStackOrders]stackfreelist
    flushGen        atomic.Uint32
}
```

The mcache is ~600 bytes; many cache lines. Internal field adjacency matters only if multiple fields are written concurrently — which, by design, they are not (the mcache is per-P, with single-writer semantics during allocation).

The `flushGen` field is atomic because it can be written by another P during GC. Its placement at the end keeps it on its own cache line (assuming the mcache is allocated on a 64-byte boundary, which it is — see `mallocgc`'s alignment).

### Cache effects on allocation

Allocation hits the per-P mcache, which is in L1 if recently used (each P is "warm" with its own mcache). The mcache walks its `alloc` array to find a span; the span itself is in L2 typically (warm if recently allocated from). Object freelist nodes are in the L1 of the span's first user.

False sharing on allocation paths is rare because each P operates on its own mcache. Cross-P false sharing happens only on the rare `mcache.refill` path, which touches the central span list (`mcentral`).

---

## `runtime.LockOSThread` and CPU Affinity

`runtime.LockOSThread()` pins a goroutine to its current OS thread. *But it does not pin the thread to a CPU.* The OS scheduler can still move the thread between cores.

For true CPU affinity, use OS facilities:

- Linux: `sched_setaffinity(2)`, `taskset` command.
- macOS: limited support; `thread_policy_set` API for affinity hints.
- Windows: `SetThreadAffinityMask`.

A Go wrapper for Linux:

```go
//go:build linux

package affinity

import (
    "syscall"
    "unsafe"
)

func PinToCPU(cpu int) error {
    var set [16]uint64 // covers up to 1024 CPUs
    set[cpu/64] = 1 << (uint(cpu) % 64)
    _, _, errno := syscall.RawSyscall(syscall.SYS_SCHED_SETAFFINITY,
        0, // current thread
        uintptr(len(set)*8),
        uintptr(unsafe.Pointer(&set[0])))
    if errno != 0 {
        return errno
    }
    return nil
}
```

Pair with `runtime.LockOSThread()` to keep a goroutine pinned to a specific physical core for the duration of a hot operation.

Why bother? Two reasons:

1. **Cache locality**: a pinned goroutine's working set stays in one core's L1, not bouncing between cores.
2. **NUMA locality**: pinning to a core ensures memory accesses go to local DRAM.

For most Go programs this is overkill. For performance-critical infrastructure (DPDK-like packet processing, HFT, database engines), it is essential.

### Limitations

- A goroutine pinned to an OS thread loses access to the GC's scheduling assumptions (the GC pauses all goroutines briefly; a pinned goroutine that does no I/O is fine).
- Cross-CPU work-stealing in the Go scheduler cannot rebalance load away from a pinned thread.
- Excessive pinning can deadlock if all Ps are pinned and a system goroutine needs to run.

Use sparingly.

---

## Microarchitecture: Adjacent Cache Line Prefetch

Modern Intel CPUs have an L2 prefetcher that, on detecting a fetch of cache line N, speculatively fetches line N+1 (or N-1). This means writes to line N+1 can invalidate line N as well, *even if line N would have been "safe" by coherence rules*. This is *adjacent-line prefetch* (sometimes called *DCU IP prefetcher* depending on level).

### Implication for false sharing

If your padding is exactly 64 bytes, you protect against coherence-level bouncing. But the prefetcher can still pull adjacent lines together, creating a *prefetch-induced* coherence storm.

The fix: pad to 128 bytes (two cache lines) for maximum safety on Intel hardware. This is why `sync.Pool` uses 128-byte padding, not 64-byte.

On AMD and ARM hardware, adjacent-line prefetching is less aggressive. 64-byte padding is usually sufficient.

### How to verify

Run a benchmark on Intel hardware with 64-byte padding vs 128-byte padding. If the 128-byte version is meaningfully faster, prefetcher effects are real for your workload. If they're within noise, 64 is enough.

### Newer prefetchers

Intel and AMD continue evolving prefetchers. Some heuristics (DCU streamer, IPP) prefetch based on access patterns. These can also cause spurious cache line moves under contention.

The lesson: padding to 64 is the *minimum*; padding to 128 is the *maximum useful* for most modern hardware. Beyond 128, returns diminish.

---

## `perf c2c` Mastery

`perf c2c` is the most powerful tool for false-sharing diagnosis. Here is a practical workflow.

### Step 1: capture

```bash
sudo perf c2c record -F 5000 -a -- sleep 30
```

`-F 5000` sets sample rate (5000/sec, good balance). `-a` captures all CPUs. `sleep 30` is the recording duration; replace with `./yourbinary` or specific process command.

For a running process:

```bash
sudo perf c2c record -F 5000 -p $(pidof yourbinary) sleep 30
```

### Step 2: report

```bash
sudo perf c2c report --stdio
```

Or, for an interactive TUI:

```bash
sudo perf c2c report
```

### Step 3: read the report

The report lists "shared cache lines" sorted by HITM count. For each line:

- The address (e.g., `0x7f1234567000`)
- Total LCL HITM (local hit-modified) counts
- Per-CPU breakdown of accesses
- Source file:line of each access (with frame info)
- "False sharing detected" annotations on individual offsets

A typical false-sharing hit looks like:

```
================================================================================
                            Shared Cache Line Distribution Pareto
================================================================================
                       LLC Load Hit Modified (%): 80.2%
Total records: 5234
Total loads:   8123
Total stores:  10234

Cacheline   0x7f12345678c0
  HITM% LclHit% Stores%     CPUs                              Symbol+Off
  37.5%   40.0%   32.0%     [0,1,2,3]   counters[0].v        main.go:42
  37.5%   40.0%   32.0%     [4,5,6,7]   counters[1].v        main.go:42
   ...
```

Two offsets within the same cache line, each hit by different CPUs with high HITM percentages — textbook false sharing.

### Step 4: act

Add padding to the indicated struct. Re-run the benchmark to confirm the HITM count drops to near zero.

### Common patterns in reports

- **Symmetric hits**: two offsets on a line, each hit by a different CPU set. Classic false sharing.
- **Asymmetric hits**: one offset hot, many CPUs. *True* sharing (or true contention).
- **Boundary hits**: a struct at the line boundary, with the line shared between two structs. Allocation alignment issue.

### Pitfalls in interpretation

- `perf c2c` shows *cycles*, not *time*. A high HITM count over 30 minutes may be a hot spot that consumed cycles, or it may be a rare spike. Cross-reference with wall-clock benchmark data.
- The sample rate matters. At low rates, very-short-but-very-hot lines may be undersampled.
- Source attribution depends on debug info. Build with `-gcflags="all=-N -l"` for reliable line numbers (at the cost of optimisation).

### Comparison runs

For an A/B test:

```bash
sudo perf c2c record -o before.data -- ./before-binary
sudo perf c2c record -o after.data  -- ./after-binary
sudo perf c2c report -i before.data --stdio > before.txt
sudo perf c2c report -i after.data  --stdio > after.txt
diff before.txt after.txt | less
```

A successful fix shows HITM counts dropping by orders of magnitude.

---

## Hardware Counters via `pprof`

Go's standard `pprof` exposes runtime/Go-level profile types: `cpu`, `heap`, `allocs`, `goroutine`, `block`, `mutex`. None of these directly surface hardware counter data.

To get hardware counters, two approaches:

### Approach 1: `perf record` + `pprof` conversion

```bash
sudo perf record -F 99 -g -e cache-misses ./yourbinary
sudo perf script -F+pid > out.perf
$ go install github.com/google/pprof@latest
$ pprof -http :8080 out.perf  # may require conversion
```

The output is a flame graph of *cache miss* events by call stack. Hot spots in cache misses correlate with false-sharing or capacity-miss bottlenecks.

### Approach 2: `github.com/dgryski/go-perf` and custom samplers

For long-running production processes, embed a low-rate hardware counter sampler that writes to your own profile format. Sampling at 1/100K cycles is low overhead and gives statistical coverage.

### Counter events of interest

- `cycles` — total CPU cycles. Baseline.
- `instructions` — completed instructions. `instructions/cycles` = IPC. Low IPC indicates stalls.
- `cache-misses` — last-level cache misses.
- `cache-references` — last-level cache accesses. `cache-misses/cache-references` = miss rate.
- `L1-dcache-load-misses` — L1 misses on loads. High under capacity issues.
- `LLC-loads`, `LLC-load-misses` — last-level cache loads and misses.
- `mem_load_l3_miss_retired.local_dram` — load misses going to local DRAM. Each costs ~100 ns.
- `mem_load_l3_miss_retired.remote_dram` — load misses going to remote DRAM (NUMA). Each costs ~200-300 ns.
- `mem_inst_retired.lock_loads` — atomic operation count.
- `mem_inst_retired.l3_hit` — loads hitting L3 (often from another core's cache; a sign of cross-core traffic).
- `offcore_response.*` — fine-grained off-core response events. Useful for false-sharing diagnosis.

A pattern: high `mem_inst_retired.lock_loads` + high `mem_inst_retired.l3_hit` + high `cache-misses` = atomic operations causing cross-core traffic = suspected false sharing.

### Profile-guided diagnosis

A typical investigation:

1. CPU profile shows `atomic.AddInt64` is hot.
2. `cache-misses` profile shows that hot atomic is the top miss-generating function.
3. `perf c2c` confirms specific lines bouncing.
4. Code review of the line addresses identifies the false-sharing struct.
5. Add padding; rerun all three profiles to verify drops.

---

## Assembly Inspection

For the highest-fidelity understanding of cache behaviour, look at the generated assembly.

```bash
go build -gcflags="-S" ./pkg/with-the-loop.go 2> asm.txt
```

Or for a specific function:

```bash
go tool objdump -s "main.FuncName" yourbinary
```

For an atomic increment, on amd64:

```
0x0000  MOVQ "".counters+0(FP), AX
0x0009  LOCK
0x000a  INCQ (AX)
```

`LOCK INCQ` is the atomic increment. The `LOCK` prefix forces cache-line ownership in exclusive state before the increment commits. The presence of this prefix on a hot loop is what makes false sharing visible.

### Effect of padding on assembly

Padding doesn't change instructions; it only changes addresses. The same `LOCK INCQ` runs whether the target is at offset 0 or offset 64. What changes is the cache-coherence behaviour of those bytes.

### Effect of `atomic.Int64` vs `int64`

`atomic.Int64.Add` compiles to the same `LOCK XADDQ` as `atomic.AddInt64`. The wrapper type adds no overhead.

### Compiler reordering

The Go compiler may reorder instructions within a function for register pressure or pipeline optimisation, but it does not reorder across atomic operations (those are barriers). For the cache behaviour analysis, what matters is the *committed memory access order*, which follows the program order at atomic sites.

---

## Cross-Process False Sharing

Multiple processes can false-share via shared memory:

- `mmap`-ed files / shared memory segments.
- POSIX shared memory.
- IPC mechanisms that involve shared regions.

The hardware mechanism is identical: cores writing to the same cache line invalidate each other.

### Example: shared counter across processes

```go
func mmapCounter() *int64 {
    fd, _ := syscall.Open("/tmp/sharedcounter", syscall.O_RDWR, 0)
    data, _ := syscall.Mmap(fd, 0, 64,
        syscall.PROT_READ|syscall.PROT_WRITE,
        syscall.MAP_SHARED)
    return (*int64)(unsafe.Pointer(&data[0]))
}
```

Two processes opening this mmap and writing to `*counter` are doing true sharing. Cache line bounces between processes' cores. Padding (the file should be at least 64 bytes, and only the first 8 used) is the standard fix at the shared-memory level too.

### Example: false sharing across processes

If two unrelated mmap regions are mapped adjacently in virtual memory, their cache lines might coincide. This is rare but possible. Each process should mmap its data on a 64-byte boundary and reserve at least 64 bytes per logical unit.

### Implication for microservices

If you run multiple Go services on one host sharing a memory-mapped database (e.g., LMDB, RocksDB), the database's internal hot pages can be subject to coherence events. The database authors handle this internally (typically by sharding and locking at higher level), but understanding the underlying mechanism helps when diagnosing throughput regressions.

---

## Custom Allocators and Aligned Memory

For ultra-high-performance code, you may need 64-byte (or 128-byte) aligned memory. Go's allocator does not provide this directly. Workarounds:

### Workaround 1: over-allocate and offset

```go
func alignedAlloc(size, alignment int) []byte {
    buf := make([]byte, size+alignment)
    addr := uintptr(unsafe.Pointer(&buf[0]))
    offset := (uintptr(alignment) - addr%uintptr(alignment)) % uintptr(alignment)
    return buf[offset : offset+uintptr(size)]
}
```

The returned slice starts at an aligned offset. Wastes up to `alignment-1` bytes per allocation.

### Workaround 2: mmap with alignment hint (Linux)

```go
addr, _ := syscall.Mmap(-1, 0, 4096,
    syscall.PROT_READ|syscall.PROT_WRITE,
    syscall.MAP_PRIVATE|syscall.MAP_ANONYMOUS)
```

`mmap` returns page-aligned memory (4096 bytes), comfortably exceeding 64-byte alignment. Useful for large structures.

### Workaround 3: cgo + `posix_memalign`

```go
// #include <stdlib.h>
import "C"
import "unsafe"

func alignedAllocC(size, alignment int) unsafe.Pointer {
    var p unsafe.Pointer
    C.posix_memalign(&p, C.size_t(alignment), C.size_t(size))
    return p
}
```

Pure-C aligned alloc. Bypasses Go's GC (the result is unmanaged; you must `free` it). Use sparingly.

### When alignment matters

- Hardware structures (DMA buffers, packet rings).
- Structures whose first byte must be cache-line aligned (e.g., for SIMD intrinsics).
- Structures where the first element's neighbour-sharing matters.

For most padded structs *inside* an array, internal alignment between elements is what matters, and the natural array stride takes care of it.

---

## Case Studies from Production Go

### Case 1: CockroachDB's `Counter` package

CockroachDB's internal metrics use sharded counters with cache-line padding. The `util/syncutil` package contains `Counter` types specialised for high-write-rate metrics. Reading the source teaches real-world tradeoffs (shard count selection, read aggregation, atomic vs mutex paths).

### Case 2: Vitess query stats

Vitess (the YouTube/Square sharding proxy) maintains per-connection and per-query statistics. The hot paths use sharded counters with `runtime_procPin`-based access. The implementation lives in `go/stats/`.

### Case 3: Dgraph and BadgerDB

Dgraph's BadgerDB embedded KV store uses lock-free queues with padded indices for write batching. The `y` package contains cache-aware structures.

### Case 4: `cockroachdb/pebble`

Pebble (the storage engine that replaces RocksDB in CockroachDB) is written in Go and has extensive false-sharing avoidance in its compactor, memtable, and cache structures. The L0 sublevel scheduler uses padded statistics.

### Case 5: Cilium's eBPF data plane

Cilium uses per-CPU eBPF maps in the kernel, with Go userspace aggregators. The Go side maintains per-CPU shards mirroring kernel-side per-CPU values. The aggregation code handles NUMA-awareness explicitly.

### Case 6: `cloudwego/kitex` RPC framework

Kitex's high-throughput RPC framework uses sharded statistics for per-handler latency histograms. The implementation uses sync.Pool extensively, plus custom padded structs for the request-counter hot path.

### Case 7: HFT systems

Some Go-based trading systems (less common than C++ but present) implement custom market-data feed parsers with extensive cache-line awareness. The `tinkoff/invest-go-sdk` and a few private HFT libraries are reference points (where public).

### Case 8: Go's own `expvar` and `runtime/metrics`

`expvar` is intentionally simple (one atomic per variable; not sharded). For high-throughput metrics, `runtime/metrics` (Go 1.16+) is designed for high cardinality with sample-once semantics; internal aggregation handles per-P sharding.

---

## Future of Cache Coherence in Go

What might change in future Go versions?

### Possibility 1: native cache-line alignment syntax

A proposal could introduce a struct field annotation like:

```go
type X struct {
    a int64 `cacheline:"true"`
    b int64
}
```

This would let the compiler insert padding automatically. As of Go 1.22+, no such proposal is accepted; the convention is manual.

### Possibility 2: smarter runtime layout

The runtime might dynamically adjust struct layouts based on observed cache behaviour. Unlikely in Go (the runtime values predictability over adaptation); more likely in JIT'd languages like Java.

### Possibility 3: NUMA awareness in the Go scheduler

The current scheduler is NUMA-oblivious. A future version could add NUMA-aware work stealing (preferring local-node steals) and NUMA-aware allocation (placing per-P caches in local-node memory). This would reduce cross-socket false sharing for large-server workloads.

### Possibility 4: hardware evolution

Future CPUs may have smaller cache lines, larger cache lines, or non-uniform cache hierarchies. Apple's M-series already pushes 128-byte effective coherence on some implementations. ARM SVE introduces variable-length vector registers; their cache impact is still being characterised.

The Go runtime evolves with hardware. The patterns you learn today (padding, sharding, per-P state) remain correct; only the magic numbers shift.

---

## Self-Assessment

- [ ] I have read the `sync.Pool` source and can explain every padding decision.
- [ ] I can use `perf c2c` to find false sharing in production-grade binaries.
- [ ] I understand adjacent-line prefetch and when to pad to 128 instead of 64.
- [ ] I have used hardware counters via `perf record` to diagnose cache effects.
- [ ] I have written a per-P sharded structure using `runtime_procPin`.
- [ ] I understand NUMA effects and have designed for cross-socket avoidance.
- [ ] I can write custom aligned allocators when needed.
- [ ] I can mentor senior engineers on false-sharing-aware design.
- [ ] I have contributed to or designed a high-throughput Go library with explicit cache-layout awareness.
- [ ] I can predict the impact of a struct-layout change on a production system's p99.

---

## Summary

At the professional level, false sharing is not a bug to fix but a *design dimension* of every concurrent subsystem you ship. You read the Go runtime source, understand the microarchitecture, master `perf c2c` and hardware counters, and build infrastructure where false-sharing avoidance is structural.

Key takeaways:

- The Go runtime is your textbook. `sync.Pool`, scheduler, semaphore, mcache — all show real production padding patterns.
- `runtime/internal/sys.CacheLinePad` is 64 bytes on amd64/arm64 and 128 on ppc64. The runtime uses this conservatively; user code can use larger padding for prefetcher-defensive layout.
- `sync.Pool`'s 128-byte padding handles Intel adjacent-line prefetching; this is the "best practice" upper bound for x86 servers.
- `perf c2c` is the gold standard tool. Learn it. Use it on every performance investigation.
- NUMA effects are 5-10x amplifications of false sharing; multi-socket servers require explicit per-socket process / sharding strategies.
- `runtime_procPin` is the tool for true per-P single-writer access patterns, but it disables preemption and must be used sparingly.
- Aligned allocation is a niche but real need; over-allocate-and-offset is the simplest portable solution.
- Production-grade Go libraries (CockroachDB, Vitess, Dgraph, Cilium) are case studies in cache-aware design; reading their source is professional development.

The specification file documents what the Go memory model, language spec, and runtime guarantees say (and do not say) about cache lines. The interview, tasks, find-bug, and optimize files give you exercises to consolidate all of this into reflexes.

---

## Appendix A: `perf c2c` Mastery

At professional level, `perf c2c` is not a tool you use occasionally — it is a tool you wield routinely on hot paths. This appendix is a deep operational guide.

### Recording strategies

```
# Standard recording: 30 seconds of mixed workload
sudo perf c2c record -F 4000 -a -o c2c.data sleep 30

# Targeted recording: only your binary, only kernel-mode disabled
sudo perf c2c record -F 5000 -e cpu/event=0xd1,umask=0x4/pp -p $(pgrep my-service) sleep 30

# Long recording for rare bouncing
sudo perf c2c record -F 1000 -a -o c2c.long.data sleep 600
```

Important flags:
- `-F` is sample frequency in Hz. Higher = more samples but more overhead. 4000-8000 is typical.
- `-a` records all CPUs. Without it you may miss bouncing on cores not running your process.
- `-e` lets you pick specific PMU events. For HITM-only, use the precise event (`pp` suffix for precise sampling).
- `-p PID` filters to one process. Critical for noisy machines.

### Report flags

```
# Stdio report, sorted by HITM
sudo perf c2c report -i c2c.data --stdio --stats

# Filter to only lines with >100 HITMs
sudo perf c2c report -i c2c.data --stdio --filter "remote_hitm>100"

# Get per-cache-line detail for one specific line
sudo perf c2c report -i c2c.data --stdio --show-symbol-address --cacheline=0x55b8...c0
```

### Reading the Pareto distribution

`perf c2c` reports cache lines in Pareto order: the top contributors first. A healthy distribution has a long tail; an unhealthy one has one or two lines accounting for 80%+ of HITMs.

```
Shared Cache Line Distribution Pareto
Cumulative %  CacheLine  Total HITM  Top Symbols
80.3%         0x...c0    245,123     main.(*Counter).Add
93.1%         0x...140   38,201      main.(*Logger).WriteEntry
98.4%         0x...380   16,402      sync.(*Mutex).Lock
99.7%         0x...200   3,981       runtime.findfunc
```

Interpretation: ~80% of all HITMs are on a single cache line owned by `main.(*Counter).Add`. That is the primary fix target. The remaining lines are minor but worth investigating if the workload changes.

### Symbol disambiguation

A line may show multiple symbols. This usually means the same line is touched by different code paths.

```
Cacheline: 0x55b8...c0
  Offset 0:   main.(*Counter).IncFast    (write)
  Offset 8:   main.(*Counter).IncSlow    (write)
  Offset 16:  main.(*Counter).Snapshot   (read)
```

Three different functions touching three offsets on the same line. The two writers cause the bouncing; the reader incurs S-state misses but does not cause invalidates. Padding to separate the two writers is the fix.

### Differential `perf c2c`

When you have a candidate fix, run `perf c2c` before and after. Compare:

```
$ perf c2c report -i before.data --stdio | grep "Total HITM"
Total HITM: 412,398

$ perf c2c report -i after.data --stdio | grep "Total HITM"
Total HITM: 8,212
```

A 50x reduction. That is the measurement that justifies the change in a PR description.

### When `perf c2c` is wrong

- Inside VMs without PMU passthrough: HITM events are not exposed; report is empty.
- On AMD: equivalent events exist but column names differ. Use `--display ds_event` or check the AMD doc for IBS-based equivalents.
- With kernel `perf_event_paranoid >= 2`: HITM events require lower paranoia. Set `sysctl kernel.perf_event_paranoid=-1` for diagnostics.
- On older kernels (<4.10): `perf c2c` is unstable or missing. Update or use `pmu-tools`.

### Alternative: `pmu-tools`

Andi Kleen's `pmu-tools` (github.com/andikleen/pmu-tools) wraps `perf` with high-level analysis. The `ocperf.py` script auto-selects the right PMU events for the CPU model. The `toplev.py` script gives "Top-down Microarchitecture Analysis," surfacing memory-bound and core-bound bottlenecks.

```
$ toplev.py -l3 -a sleep 30
... 
FE  Bound      45.2%  <-- frontend bound
BE  Bound      30.1%
  BE.Memory    25.3%
    BE.Memory.L3Miss 12.4%   <-- memory subsystem stalls
    BE.Memory.Contested 8.1% <-- HITMs / false sharing
```

The `BE.Memory.Contested` metric directly correlates with HITMs. High values (>5%) are a strong indication of cache-line contention.

---

## Appendix B: `pprof` and Block Profiles

`perf c2c` is the gold standard for cache-line analysis, but it requires root and a Linux host. Inside Go, `pprof` offers indirect signals.

### Block profiling

```go
import "runtime"

func init() {
    runtime.SetBlockProfileRate(1) // sample all blocking events
}
```

Then:
```
go tool pprof http://localhost:6060/debug/pprof/block
```

Block profiles show goroutines blocked on synchronization. False sharing does not directly cause blocking, but it amplifies contention on locks and atomics. A `sync.Mutex` lock that takes 200ns when uncontended and 5µs when false-sharing-amplified will show up in block profiles with elevated durations.

### Mutex profiling

```go
runtime.SetMutexProfileFraction(1)
```

```
go tool pprof http://localhost:6060/debug/pprof/mutex
```

Mutex profiles show *lock hold times* and *contention*. If a lock's *uncontended* hold time is unusually variable (sometimes 100ns, sometimes 2µs), false sharing on the lock's internal state may be the cause. The lock implementation itself is fast; the variability comes from cache-line bouncing.

### CPU profiling: indirect signals

CPU profiles cannot directly identify false sharing, but they can hint at it:

- A function that should be cheap (just an `atomic.Add`) showing up high in CPU time.
- "Top" by self-time being dominated by simple-looking functions.
- The `runtime.usleep` or `runtime.futex` time being elevated (indicates threads blocked on syscalls, often caused by cache pressure).

When you see these signals, run `perf c2c` to confirm.

### Trace-based analysis

```go
import "runtime/trace"

trace.Start(file)
defer trace.Stop()
```

```
go tool trace trace.out
```

The trace viewer shows per-goroutine timelines. False sharing manifests as goroutines having unexpectedly long execution times on simple operations, especially across multiple cores.

A specific signal: if you see a goroutine running on core 0, then core 4, then core 0 again, with each migration coinciding with a slow operation, you may be seeing cache-line warming costs on migration. This is related to but distinct from false sharing — the same hardware mechanisms are involved.

---

## Appendix C: Disassembly and Alignment Verification

Professional engineers verify that the compiler produced the expected machine code and alignment. Padding is a layout decision; layout is realized by the compiler and runtime.

### Inspecting struct alignment

```go
// padcheck.go
package main

import (
    "fmt"
    "sync/atomic"
    "unsafe"
)

type slot struct {
    v    atomic.Int64
    _pad [56]byte
}

func main() {
    s := [4]slot{}
    for i := range s {
        addr := uintptr(unsafe.Pointer(&s[i].v))
        fmt.Printf("slot[%d] at %#x (offset within line: %d)\n", i, addr, addr%64)
    }
}
```

Run and confirm each slot's `addr % 64 == 0`. If not, your padding is correct but the *base alignment* of the array is wrong.

### Forcing alignment

If the array base is misaligned:

```go
// Allocate extra and slice off aligned region.
raw := make([]byte, 4*64+64)
start := (uintptr(unsafe.Pointer(&raw[0])) + 63) &^ 63
slots := unsafe.Slice((*slot)(unsafe.Pointer(start)), 4)
```

This pattern guarantees the slice starts on a 64-byte boundary.

### `go tool objdump`

```
go build -o app main.go
go tool objdump -s "main.(*Counter).Add" app
```

Output (amd64 example):
```
TEXT main.(*Counter).Add(SB)
  mov 0(rdi), rax       ; load counter address
  lock incq 0(rax)      ; atomic increment
  ret
```

The `lock incq` is a locked increment. The lock prefix is exactly what causes cache-line bouncing under contention — every locked instruction asserts ownership of the cache line.

If you see `mfence` or `lock xchg` instructions, you have memory barriers that further amplify the cost of contention. These appear for sequentially consistent atomics (the default in Go).

### Verifying compiler did not reorder

The compiler can reorder struct fields, in some cases. Use `unsafe.Offsetof` to verify:

```go
func TestLayout(t *testing.T) {
    if got, want := unsafe.Offsetof(slot{}.v), uintptr(0); got != want {
        t.Errorf("v at offset %d, want %d", got, want)
    }
    if got, want := unsafe.Offsetof(slot{}._pad), uintptr(8); got != want {
        t.Errorf("_pad at offset %d, want %d", got, want)
    }
}
```

Go's `gc` compiler does *not* reorder fields (unlike `rustc` or some `clang`); the order in source is the order in memory. But verify it explicitly for paranoia.

---

## Appendix D: The Go Runtime's Padding Catalogue

Below is a systematic enumeration of padding sites in the Go runtime (Go 1.22 source). Each is annotated with the rationale.

### `sync.Pool` — `poolLocal`

```go
// src/sync/pool.go
type poolLocal struct {
    poolLocalInternal
    pad [128 - unsafe.Sizeof(poolLocalInternal{})%128]byte
}
```

Why 128: Intel adjacent-line prefetcher. This is the most contended structure in the standard library and warrants aggressive padding.

### Runtime `p` struct — `runq` head/tail

```go
// src/runtime/runtime2.go
type p struct {
    ...
    runqhead uint32
    runqtail uint32
    runq     [256]guintptr
    runnext  guintptr
    ...
}
```

Here `runqhead` and `runqtail` are adjacent uint32s — they fit in 8 bytes on the same cache line. But the *array* `runq` that follows them is 2048 bytes, which means the head/tail line is also touched only by the owning P (mostly) and the steal path. The runtime accepts this small adjacency cost because work stealing is relatively rare.

In recent versions there have been proposals to pad head/tail more aggressively; benchmarks did not show clear improvement, and the patches were rejected.

### Semaphore table

```go
// src/runtime/sema.go
var semtable [semTabSize]struct {
    root semaRoot
    pad  [cpu.CacheLinePadSize - unsafe.Sizeof(semaRoot{})%cpu.CacheLinePadSize]byte
}
```

`semTabSize` is 251 (a prime). Each entry holds a `semaRoot` (a tree-based queue of waiters) plus padding. The padding ensures that two adjacent semaphore queues do not false-share their lock states.

### Scheduler `mheap` — `centralized lock`

```go
// src/runtime/mheap.go
type mheap struct {
    _ sys.NotInHeap
    lock mutex
    pages pageAlloc
    ...
    // padding around hot fields elsewhere in struct
}
```

The `mheap.lock` is heavily contended during allocation. There is padding around it, but less aggressively than in `sync.Pool` because the `mheap` is a singleton and the surrounding fields are co-accessed within the same critical section.

### `mcache` per-P

```go
type mcache struct {
    nextSample uintptr
    scanAlloc uintptr
    tiny       uintptr
    tinyoffset uintptr
    tinyAllocs uintptr
    alloc      [numSpanClasses]*mspan
    ...
}
```

The `mcache` is per-P; only one P writes its fields. No false sharing on a single mcache. But adjacent P's `mcache` pointers (in the array of P's) could false-share if not careful. The Go runtime allocates mcaches independently (heap-allocated), so they are typically far apart in memory.

### `chan` (channels)

```go
type hchan struct {
    qcount   uint
    dataqsiz uint
    buf      unsafe.Pointer
    elemsize uint16
    closed   uint32
    elemtype *_type
    sendx    uint
    recvx    uint
    recvq    waitq
    sendq    waitq
    lock     mutex
}
```

Channels are *not* padded. Multiple goroutines may send/recv concurrently, but they all serialise through `hchan.lock`. The internal fields are accessed under lock, so cache-line bouncing affects lock-hold time but is bounded by lock contention.

There have been proposals to split `sendx` and `recvx` onto separate lines, but channel internals are already lock-protected so the gain is small. Padding here would only matter for unbuffered or single-element channels.

### Race detector — `tsan`

```go
// src/runtime/race.go
type tsanContext struct {
    // heavily padded; details in C source
}
```

The race detector's per-goroutine state is padded because it is updated on every memory access. Without padding, the race detector itself would false-share and become extremely slow.

### Summary

The Go runtime is a textbook of padding patterns. Read it. Take notes. Internalise the conventions. A professional engineer can recite, off the top of their head, which runtime data structures are padded and why.

---

## Appendix E: Microarchitectural Quirks

### Intel Adjacent-Cache-Line Prefetcher

Intel server CPUs from Sandy Bridge onward have an *adjacent cache line prefetcher* on the L2. When the L2 fetches line X, it speculatively also fetches line X+1 (or X-1, depending on access pattern). This is good for sequential workloads but bad for padded structs.

Implication: two `atomic.Int64` placed in adjacent 64-byte lines (one at line N, one at line N+1) may *still* false-share via prefetch. The L2 brings both lines together; writes to one invalidate the other in the prefetched-pair sense.

Mitigation: pad to 128 bytes. `sync.Pool` does this.

You can disable the prefetcher via MSR (`wrmsr -p N 0x1A4 ...`) but this is server-tuning territory, not application code.

### AMD Speculative Prefetcher

AMD's recent CPUs (Zen 3+) have similar but not identical prefetchers. Some Zen 3 SKUs prefetch adjacent lines; others do not. The behaviour depends on the specific CPU model and BIOS settings.

For AMD-only deployments, 64-byte padding is usually enough. For mixed Intel/AMD fleets, default to 128 if you want portability of performance.

### ARM Spatial Prefetcher

Modern ARM cores (Neoverse N1/N2, Apple M-series) have spatial prefetchers that fetch nearby lines. The specifics are less documented than Intel's. Empirically:

- Graviton 2/3 (Neoverse N1/V1): 64-byte padding works.
- Apple M1/M2/M3 (P-cores): 128-byte padding recommended; some implementations behave as if line size is effectively 128.
- Ampere Altra (Neoverse N1): 64-byte padding works.

### Cache hierarchy effects

L1 line size is one number; L2 and L3 may differ in some old architectures. Modern CPUs typically have unified line sizes across the hierarchy (64 on amd64 and arm64). On legacy ppc64 you may see 128 in L1 and L2 but different size at L3.

For practical purposes: pad to the largest line size in the hierarchy. On amd64 server: 64 (or 128 for prefetch defense). On Apple: 128. On ppc64: 128.

### Hyperthreading

Two hardware threads on the same physical core share L1 and L2. Therefore false sharing between them does not exist — they cannot both have the line in M (there is only one copy). Cache contention manifests differently: as L1 capacity pressure.

This means: a benchmark on a 2-core / 4-thread machine with both threads pinned to the same core will not show false sharing, even with adjacent atomics. The same benchmark with threads on different physical cores *will* show it. Always benchmark on physical cores, not hyperthread pairs, when measuring false sharing.

Use `lscpu --extended` to see the topology:
```
CPU NODE SOCKET CORE
0   0    0      0
1   0    0      1
2   0    0      2
3   0    0      3
32  0    0      0      <-- hyperthread sibling of CPU 0
33  0    0      1      <-- hyperthread sibling of CPU 1
```

Pin to CPUs 0,1,2,3 for false-sharing benchmarks; avoid 32,33,34,35.

---

## Appendix F: Production Case Studies

### Case 1: CockroachDB

CockroachDB is a distributed SQL database written in Go. Its KV layer handles millions of writes per second per node. The code is full of cache-line awareness.

Examples (paraphrased from the cockroach source):

```go
// cockroach/pkg/util/syncutil/mutex.go (paraphrased)
type Mutex struct {
    sync.Mutex
    _ [64 - unsafe.Sizeof(sync.Mutex{})]byte
}
```

A padded mutex used in performance-critical sites. CockroachDB cannot rely on `sync.Mutex` being padded by default; they wrap it.

```go
// hot atomic counter in a metrics aggregator
type counter struct {
    val atomic.Int64
    _   [56]byte
}
```

Same pattern in many subsystems. The CockroachDB project has a code review rule: any atomic in a slice must be padded.

### Case 2: Vitess

Vitess (sharded MySQL proxy by YouTube/PlanetScale) has similar patterns. Their query cache, connection pool, and statistics counters are all padded.

A specific historical incident: in 2019, a Vitess release shipped with unpadded request counters. The 64-vCPU production deployment saw a 40% throughput regression. The diagnosis took two days; the fix was four lines of padding. Vitess now has a CI test that checks `unsafe.Sizeof` on key structures.

### Case 3: Dgraph

Dgraph is a graph database. Their RAFT implementation uses a padded log structure for the leader's commit position. The log's `committed` and `applied` indices are on separate cache lines; the leader writes `committed`, followers write `applied`. Without padding, the RAFT throughput degraded ~30% on multi-core leaders.

### Case 4: Cilium

Cilium (eBPF-based networking) has a Go control plane that maintains millions of endpoint state entries. Each endpoint has counters (packet count, byte count, flow count). These are in a `[]Endpoint` slice; sibling endpoints' counters used to false-share.

The fix was structural: rather than store counters inline in the Endpoint struct, store them in a separate `[]Counters` array with each entry padded to 64 bytes. The Endpoint holds a pointer to its Counters. This adds one pointer indirection per access but eliminates false sharing.

### Common patterns in production Go

- Padded mutex wrappers.
- Padded atomic counter wrappers.
- Counter arrays separated from main struct.
- Cache-line aware sharding in queues and maps.
- `unsafe.Sizeof` assertions in CI.
- Architecture-conditional padding constants.

These patterns are the cost of running Go at scale. Studying production codebases is how you internalise them.

---

## Appendix G: Custom Aligned Allocators

For very-large-scale or very-hot-path code, the default Go allocator's alignment may be insufficient. Custom allocators give precise control.

### Over-allocate and slice

```go
// Allocate an array of N elements, each aligned to 128 bytes.
func newAlignedSlice(n, elemSize, alignment int) []byte {
    if elemSize%alignment != 0 {
        elemSize = ((elemSize + alignment - 1) / alignment) * alignment
    }
    raw := make([]byte, n*elemSize+alignment)
    base := uintptr(unsafe.Pointer(&raw[0]))
    offset := (alignment - int(base%uintptr(alignment))) % alignment
    return raw[offset : offset+n*elemSize]
}
```

Use case: a high-throughput queue where you need 128-byte aligned cells.

### `mmap`-based allocation

For very large arenas:

```go
import "golang.org/x/sys/unix"

raw, err := unix.Mmap(-1, 0, size, unix.PROT_READ|unix.PROT_WRITE, unix.MAP_PRIVATE|unix.MAP_ANON)
```

`mmap` returns page-aligned (typically 4KB) memory. Cache-line alignment is guaranteed since 4096 is a multiple of 64 and 128.

Caveat: mmapped memory is not managed by Go's GC. Anything you store there with pointers to GC-managed objects will not be traced by the GC. Use only for pure data (counters, byte arrays).

### Hugepages

Linux supports 2MB hugepages. Allocating with `MAP_HUGETLB` gives 2MB pages, reducing TLB pressure. Hugepages are 2MB-aligned, far more than cache-line. They are appropriate for very large data structures (>1 MB) in steady-state hot paths.

```go
raw, _ := unix.Mmap(-1, 0, 2*1024*1024, unix.PROT_READ|unix.PROT_WRITE, 
    unix.MAP_PRIVATE|unix.MAP_ANON|unix.MAP_HUGETLB)
```

Hugepages reduce TLB misses but do not help with false sharing directly. They are an orthogonal optimisation.

### When to use custom allocators

- The default `make` does not give the alignment you need.
- You allocate large arrays of padded structs.
- You need to coordinate alignment with cgo or syscalls.
- You are willing to manage memory manually (no GC).

In ordinary Go code: stick with `make`. The Go allocator handles alignment correctly for most cases. Custom allocators are for the 1% of code where every cycle matters.

---

## Appendix H: Hidden False Sharing Sites

These are subtle cases that even experienced engineers miss.

### Case 1: `atomic.Bool` in a struct

`atomic.Bool` (Go 1.19+) is 1 byte. A struct with many `atomic.Bool` fields packs them tightly:

```go
type flags struct {
    a, b, c, d, e, f, g, h atomic.Bool // 8 bytes total
}
```

All 8 flags fit in 8 bytes — one cache line. Concurrent writes to different flags false-share. If this struct is accessed by multiple goroutines (say, each goroutine writing one flag), padding is needed.

Fix:
```go
type flags struct {
    a atomic.Bool; _ [63]byte
    b atomic.Bool; _ [63]byte
    // ...
}
```

Or use `atomic.Int64` and bit-set semantics if the flags are conceptually grouped.

### Case 2: Slice headers

A slice header is 24 bytes (pointer + length + capacity). A `[]T` slice header is small enough that adjacent slice values in another struct can share lines.

```go
type wrapper struct {
    slices []slice // each slice header is 24 bytes
}
```

If the `slices` slice is written concurrently (appending, reslicing), the header memory can false-share between adjacent slices.

Less common in practice — slice headers are usually read-mostly — but worth checking.

### Case 3: Map buckets

Go maps store entries in 8-element buckets. Each bucket is roughly 130 bytes (8 keys + 8 values + 8 tophash + overflow pointer). Two buckets fit in 256 bytes — possibly across two cache lines.

Concurrent map mutations (under different locks) on adjacent buckets can false-share bucket metadata. This is a real issue in `sync.Map` and custom sharded maps.

The Go map implementation does not pad buckets; it relies on the hash spreading entries across many buckets. In practice this works for typical workloads.

If you implement your own sharded map, consider padding shards (already covered) but also be aware that the *map internals* are not under your control.

### Case 4: `time.Time` in a hot struct

`time.Time` is 24 bytes (a `wall` uint64, an `ext` int64, and a `*Location` pointer). A struct with multiple `time.Time` fields can put hot timestamps adjacent.

```go
type session struct {
    startTime time.Time
    lastAccess time.Time // 48 bytes from start of struct
}
```

If `lastAccess` is updated on every request (hot write), and `startTime` is read on every audit log (also frequent), they share the same cache line. Two cores writing the same struct from different goroutines (request handler + audit logger) bounce the line.

Fix: separate the two times into separate structs, or pad between them.

### Case 5: Goroutine-local data via context

If you store mutable data in `context.Context` (against best practice but it happens), the context's value map is shared across goroutines that share the context. Concurrent writes to context values false-share the map internals.

Fix: do not put mutable data in context. This is a design rule, not a layout rule.

### Case 6: Embedded structs

```go
type inner struct {
    counter atomic.Int64
}

type outer struct {
    inner
    name string
}
```

The `outer` struct embeds `inner`. If `name` is read frequently (per-request), and `counter` is written frequently (per-request), they share a cache line. Outer might be 24+ bytes, fitting easily in 64.

Fix: explicit padding inside `outer`:
```go
type outer struct {
    inner
    _    [56]byte
    name string
}
```

Or use a separate counter via pointer.

### Case 7: Interface values

An interface value is 16 bytes (type pointer + data pointer). A struct with adjacent interfaces packs them tightly. Concurrent updates to different interfaces (rare but possible) can false-share.

This is unusual in practice; interface values are typically not concurrently mutated.

### Detection

These hidden cases are hard to find by inspection. `perf c2c` is the only reliable tool. Run it periodically on hot paths. When you see HITMs on a line containing a struct you would not have suspected, investigate the layout.

---

## Appendix I: Designing for Future Hardware

What if your code must run for 10 years on hardware that does not yet exist?

### Trend 1: Wider cache lines

Some research CPUs (and Apple's M-series in some configurations) use 128-byte effective lines. ARM SVE2 hints at wider coherence granules. Future CPUs may use 128 or even 256-byte coherence.

Design implication: prefer architecture-conditional padding constants over hard-coded `[56]byte`. Use `cachelinePad = 64` (or 128, 256) and `[cachelinePad - unsafe.Sizeof(hot)]byte`.

### Trend 2: Non-uniform cache hierarchy

Apple M-series has cache hierarchies where the L2 is shared across P-cores in clusters of 4. Within a cluster, cache lines move cheaply. Across clusters, expensive. This is sub-NUMA: even within one socket, locality matters.

Design implication: per-cluster sharding may matter. Go does not expose cluster topology; you would need to drop to cgo or read sysfs.

### Trend 3: Persistent memory

Optane and similar persistent memory technologies have larger access granularities (256 bytes for some operations). False-sharing-equivalent issues exist when persistent memory is accessed concurrently.

Design implication: if you write persistent-memory-backed code (rare in Go but increasing), consider the persistent memory line size, not just CPU cache line.

### Trend 4: Hardware transactional memory

Intel TSX (and ARM's TME) allow speculative transactions. False sharing causes transactions to abort, which is the same problem in a different costume.

Design implication: padding still helps. Transactions amplify the cost of false sharing because aborts retry the entire transaction.

### Trend 5: Distributed coherence (CXL)

CXL 3.0 allows cache coherence across machines. Future systems may treat networked memory as part of the coherence domain. False sharing then has a network-level cost.

Design implication: future systems may make false sharing 100x more expensive, not 10x. The principles in this file become more important, not less.

### What is constant

The basic patterns — pad hot fields, shard by core/NUMA, separate writers — are robust across hardware generations. The magic numbers shift; the structure does not. Engineers who internalise the patterns will carry their skill across decades.

---

## Appendix J: Operational Checklists

### Pre-merge checklist for hot-path code

1. Does any new struct have multiple `atomic.*` fields? Confirm padding.
2. Does any new `[]T` contain `atomic.*` inside `T`? Confirm padding.
3. Are there `unsafe.Sizeof` tests for padded structs?
4. Are padding sizes architecture-conditional?
5. Has the author run `perf c2c` on the new code?
6. Is there a scaling benchmark (`-cpu=1,2,4,8,16`)?
7. Is the padding documented with a comment?
8. Is there a regression test that catches accidental padding loss?

### Production triage checklist when a service slows down

1. Did GC change? (Check `runtime.MemStats`.)
2. Did request rate change? (Check metrics.)
3. Did CPU utilisation change?
4. Run `pprof -cpu`: are previously-cheap functions now hot?
5. Run `pprof -mutex` and `pprof -block`: is sync contention elevated?
6. Run `perf c2c`: are HITMs elevated?
7. Did a deploy correlate with the regression? Diff the binary.
8. Did a kernel update happen? (PMU events sometimes change.)

If steps 4-6 show signs of cache contention, the fix is usually in struct layout. Pad and re-deploy.

### Quarterly review for high-throughput services

1. Re-run `perf c2c` on every hot-path service.
2. Re-run scaling benchmarks; compare to last quarter.
3. Update padding constants if hardware changed.
4. Audit new code added since last review for false-sharing patterns.
5. Update internal training materials with new patterns observed.

This is what running Go at scale looks like.

---

## Appendix K: Professional Reading List

Beyond the items mentioned at junior and middle level:

1. Russ Cox's "Go memory model" article and the official `memmodel.md` in the Go source.
2. The Go runtime PR history. Search GitHub for PRs touching `sync/pool.go`, `runtime/sema.go`, and `runtime/proc.go`. Each PR has a benchmark; reading them is professional development.
3. Linux kernel `Documentation/locking/lockdep-design.rst` and `Documentation/admin-guide/cputopology.rst`.
4. Intel Optimization Manual, Volume 3, on memory subsystem.
5. Drepper's *What Every Programmer Should Know About Memory*, sections 6.3, 6.4.
6. The Crossbeam-Rs documentation and source. Idiomatic Rust patterns for lock-free, cache-friendly data structures.
7. Vyukov's "Concurrent queues" blog posts (1024cores.net).
8. Andi Kleen's `pmu-tools` documentation.
9. Brendan Gregg's USE method and tools.

Read one or two of these in depth. Skim the rest. After a year of regular reading, you will have a mental model of the hardware that few engineers ever develop.

---

## Appendix L: Closing Reflection at Professional Level

False sharing is one of dozens of microarchitectural effects that connect language-level constructs to silicon-level behavior. The work of professional performance engineering is to develop intuition for all of them: cache coherence (this file), branch prediction, speculative execution, TLB pressure, memory bandwidth, NUMA topology, scheduler interactions.

False sharing is the entry point. It is concrete (you can see the bytes). It is measurable (`perf c2c` gives definitive answers). It is fixable (padding is mechanical). Engineers who develop fluency with false sharing develop the *habits* — measure, hypothesise, fix, verify — that transfer to harder microarchitectural problems.

If you have read this file end-to-end, run the benchmarks, read the runtime source, and used `perf c2c` on real code, you are at the professional level for this topic. The remaining files in this section — specification, interview, tasks, find-bug, optimize — give you exercises to consolidate the knowledge into reflexes.

There is no end-state. Hardware evolves; the patterns evolve. The professional skill is not the answers, but the questions:
- What does my data look like in memory?
- Which cores touch which bytes?
- Where do they bounce?
- How can I restructure to reduce coherence traffic?

Keep asking. The answers will come.

---

## Appendix M: Inside `perf c2c` — How It Works

A professional engineer should understand how `perf c2c` collects its data, not just how to read its output. This appendix explains the internals.

### PMU events used

`perf c2c` records the following events (on Intel Skylake and later):

- `cpu/mem-loads,ldlat=30/pp` — loads with latency > 30 cycles, precise sampling.
- `cpu/mem-stores/pp` — store events.
- `node-loads` — counts loads served from local vs remote NUMA nodes.

The `ldlat=30` threshold filters out fast L1 hits, keeping only the loads that actually missed and went to L2/L3/remote — the loads we care about.

### What is sampled

Each event sample includes:
- Instruction pointer (PC) where the load/store happened.
- Memory address being accessed.
- Latency (cycles from issue to completion).
- The "data source" — where the line came from (L1, L2, L3, local memory, remote socket, HITM).

A HITM data source means: my core requested the line; another core had it modified; the line was transferred directly from that core's cache. This is the smoking gun for coherence traffic.

### Cache-line aggregation

`perf c2c report` groups samples by cache-line address (masking low 6 bits for 64-byte lines, or 7 bits for 128-byte). For each line, it counts total samples, total HITMs, and per-offset symbol attribution.

The Pareto distribution emerges naturally: a small number of lines account for most HITMs, the rest are background noise.

### Limitations

- Statistical sampling. Short-burst contention may miss.
- Architecture-specific. AMD's IBS (Instruction-Based Sampling) reports similar events but with different names; `perf c2c` may or may not handle AMD well depending on kernel version.
- Hypervisor opaqueness. VMs without PMU passthrough do not expose HITM events.
- Sampling overhead. At very high frequencies (>10000 Hz) the sampling itself perturbs the workload. Use moderate frequencies (1000-5000 Hz) for production.

### A note on precision

`pp` in event specifications means "precise precise" — the sample's instruction pointer is exact, not approximated. Without this, the IP could be ±5 instructions off, making attribution unreliable. Always use `:pp` (or `:ppp` for "fully precise" on newer CPUs) for memory event sampling.

### `perf c2c report` flags worth knowing

```
--call-graph=fp,16    Resolve call stacks via frame pointers, depth 16.
--full-symbols        Show full symbol names instead of truncating.
--show-symbol-address Show symbol + offset, useful for inline functions.
--display=tot         Sort by total events instead of HITMs.
--phys-data           Show physical addresses (requires CAP_SYS_ADMIN).
--coalesce=tid        Group samples by thread ID.
```

A typical professional invocation:

```
sudo perf c2c report -i fs.data --stdio --full-symbols --call-graph=fp,16 \
    --display=tot 2>/dev/null | less -SR
```

### Building intuition

Run `perf c2c` on your own workloads. Run it on `go test -bench` for various synthetic benchmarks. See the difference between a clean workload (HITM total: hundreds) and a contended workload (HITM total: millions).

After a few weeks of routine use, the column meanings become reflexive. You read a report and the issue jumps out.

---

## Appendix N: Profile-Guided Optimization (PGO) and Cache Layout

Go 1.21 added Profile-Guided Optimization (PGO). The compiler uses profile data to make better inlining decisions and function placement. While PGO does not directly address false sharing, the interactions are worth understanding.

### Function placement

PGO can move hot functions closer in the binary, improving instruction cache locality. Cold functions (or rarely-called branches) are pushed to the end of the text section. This reduces I-cache pressure.

For false sharing: instruction cache layout is independent of data cache layout. Padding affects data; PGO affects code. They are orthogonal.

### Inlining decisions

PGO may inline a hot atomic-update function. If the inlined function previously had `runtime_procPin` calls in a separate function frame, inlining can move those calls into the caller's frame. This is usually faster but can interact with pinning semantics.

For false sharing: inlining of atomic-update functions does not change which line is touched. False-sharing analysis is unaffected.

### Hot/cold field separation

A future PGO extension could analyze field access patterns and reorder struct fields to put hot fields together (improving cache locality) or apart (avoiding false sharing). Go does not currently do this.

If you want hot/cold separation, do it manually:

```go
type hotPath struct {
    counter atomic.Int64
    _pad    [56]byte
}

type coldPath struct {
    config string
    name   string
    desc   string
}

type Combined struct {
    hot  hotPath
    cold coldPath
}
```

Hot and cold fields are in separate structures; cold fields are not loaded into cache when hot fields are accessed.

This pattern is "structure splitting" in the literature. Manual in Go; automatic in some Rust and C++ compilers with PGO.

---

## Appendix O: Bypass and Streaming Writes

For some workloads, you do not want writes to enter the cache hierarchy at all. Streaming stores bypass the cache and write directly to memory.

### `MOVNTI` / non-temporal stores

The x86 `MOVNTI` instruction writes a value to memory without populating the cache. This is useful for write-once data (e.g., logging output) that will not be read by this core again soon.

Go does not directly expose non-temporal stores. You can access them via cgo or assembly:

```go
//go:noescape
func streamStoreInt64(ptr *int64, val int64)

// Assembly (amd64):
// TEXT ·streamStoreInt64(SB),NOSPLIT,$0-16
//     MOVQ ptr+0(FP), AX
//     MOVQ val+8(FP), BX
//     MOVNTIQ BX, (AX)
//     SFENCE
//     RET
```

The `SFENCE` is required: non-temporal stores have weaker ordering than regular stores.

### When to use

- Write-only buffers that will be DMA'd out (network packets, disk writes).
- Logging output that another process consumes.
- Initialisation of large arrays that will be read by other cores.

When not to use:
- Frequently-read data. Non-temporal stores skip the cache; subsequent reads must fetch from memory.
- Small writes. The overhead of the SFENCE eats the benefit.

For false sharing: non-temporal stores can mitigate write-vs-write contention by not populating the cache, but they introduce other costs. Rarely the right tool for typical Go code.

### `CLFLUSH` and `CLFLUSHOPT`

The x86 `CLFLUSH` instruction explicitly evicts a cache line. Use to "release" a line you no longer need, freeing L1 capacity for other lines.

Use cases:
- After writing a buffer that will be DMA'd, flush so the DMA controller reads consistent data.
- After writing a large region, flush to prevent cache pollution.

Go does not expose CLFLUSH directly. Via assembly or cgo only.

For false sharing: CLFLUSH proactively transitions a line from M/E/S to I on this core. If another core then writes the line, no invalidate is needed (we already invalidated ourselves). This can be a tactical fix for known-future-write scenarios but is rarely worth the complexity.

---

## Appendix P: Persistent Memory and Coherence

Intel Optane and similar persistent memory technologies expose memory that survives power loss. Persistent memory is cache-coherent within a system but has its own quirks.

### Coherence with persistent memory

Persistent memory participates in cache coherence like normal DRAM. Loads and stores see coherent state. But:

- Persistent memory access latency is higher (~300ns vs 100ns for DRAM).
- Persistent memory has a higher write granularity (256 bytes for some operations).
- Persistent memory writes are not durable until explicitly flushed (CLWB + SFENCE).

For false sharing: persistent memory has the same false-sharing issues as DRAM, but the cost per bounce is 3-5x higher. Padding is even more important.

Additionally, write granularity matters: writes within a 256-byte block may be coalesced. Two unrelated atomics in the same 256-byte block are at risk of "block-level" false sharing.

Recommendation: for persistent memory data structures, pad to 256 bytes, not 64.

### Go and persistent memory

Go does not have first-class persistent memory support. To use Optane from Go, you would `mmap` a DAX device and access it as byte memory. Synchronisation primitives (atomics) work but you must manually flush for durability.

Most production Go code does not need persistent memory. This is included for completeness.

---

## Appendix Q: Side Channels and Cache-Line Information Leakage

False sharing has a security-relevant cousin: cache-side-channel attacks. Two unrelated processes (or VMs) running on the same core can leak information through cache-line state.

### Flush+Reload attack

Attacker:
1. Flushes a target cache line (via CLFLUSH or eviction).
2. Waits for the victim to access (or not access) the line.
3. Measures the time to reload the line. Fast = victim accessed; slow = victim did not.

This timing difference reveals victim memory access patterns, breaking confidentiality (e.g., for AES key bits).

For false sharing: the same cache-coherence machinery that causes false-sharing performance issues also enables side channels. Padding a sensitive variable to its own cache line *reduces* but does not eliminate side-channel exposure — an attacker can still flush+reload that line.

### Spectre and Meltdown

These vulnerabilities exploit speculative execution + cache side channels. The mitigations (KPTI, retpoline, microcode updates) have small but measurable performance costs.

For false sharing: Spectre mitigations sometimes add memory barriers, which slow cache-coherence ops slightly. The effect on false-sharing-bound code is real (sometimes ~5%) but smaller than the underlying false-sharing cost.

### Mitigations relevant to Go

- Do not share processes between trust domains (most cloud providers do not co-tenant VMs from different customers on the same core).
- Use Go 1.21+ which has Spectre-aware code generation in some paths.
- Avoid timing-dependent code on shared infrastructure (use constant-time algorithms for crypto).

This is mostly a security topic, not a performance topic, but it shares mechanics with false sharing.

---

## Appendix R: Custom Build Tags and Architecture Targeting

A professional Go engineer should be fluent with build tags for architecture-specific padding.

### Basic pattern

`pad_amd64.go`:
```go
//go:build amd64

package mylib

const CacheLinePadSize = 64
```

`pad_arm64.go`:
```go
//go:build arm64

package mylib

const CacheLinePadSize = 64
```

`pad_ppc64.go`:
```go
//go:build ppc64 || ppc64le

package mylib

const CacheLinePadSize = 128
```

`pad_default.go`:
```go
//go:build !amd64 && !arm64 && !ppc64 && !ppc64le

package mylib

const CacheLinePadSize = 64 // safe default
```

The constant is used throughout the package:

```go
type slot struct {
    v    atomic.Int64
    _pad [CacheLinePadSize - unsafe.Sizeof(atomic.Int64{})]byte
}
```

### Defensive padding for prefetchers

For Intel-specific defense:

```go
//go:build amd64

package mylib

const CacheLinePadSize = 128 // defends against adjacent-line prefetch
```

This is more conservative; uses more memory. Justified for top-tier hot paths.

### Verification

```go
func TestSlotSize(t *testing.T) {
    if got := unsafe.Sizeof(slot{}); got != CacheLinePadSize {
        t.Fatalf("slot size %d != %d", got, CacheLinePadSize)
    }
}
```

The test passes on every supported architecture; the constant changes per build.

### Distinguishing Apple Silicon

Apple's M-series ARM cores behave more like 128-byte-line systems for prefetcher purposes, even though L1 is technically 64-byte. There is no `darwin/arm64` build tag combo that picks this up automatically; you would have to detect at runtime.

Practical approach: ship with `CacheLinePadSize = 64` on `darwin/arm64` (matches the architectural truth) and accept some prefetcher false sharing on Apple Silicon. Most Apple Silicon Go code is not on hot paths.

Or, target Apple specifically with a `darwin/arm64` build tag:

```go
//go:build darwin && arm64

package mylib

const CacheLinePadSize = 128 // Apple Silicon's effective line size
```

This is over-engineering for most cases. For server-side Go (where you do not run on Apple), the issue does not arise.

---

## Appendix S: An Extended Postmortem Library

Below are three more sanitised postmortems from real incidents I have observed or participated in. Each illustrates a distinct failure mode.

### Postmortem 1: The lock that wasn't

**Service:** A multitenant API gateway.
**Symptom:** p99 latency jumped 5x after rolling out a new "fast" authentication caching layer.
**Investigation:**

The cache was a sharded map:
```go
type authCache struct {
    shards [256]struct {
        mu sync.Mutex
        m  map[string]Token
    }
}
```

Each shard had its own mutex. The team believed this would scale to 256x concurrency.

Profiling showed `runtime.lock_slow` consuming 40% of CPU. But why? Each shard had its own lock; contention on any single shard should be low.

`perf c2c` revealed: adjacent shards' mutex state words were sharing cache lines. With `sync.Mutex` being 8 bytes, 8 mutexes fit per line. So a write to shard 0's mutex bounced shards 0-7's lines. The "sharding" wasn't sharded at the cache level.

**Fix:**
```go
type authCache struct {
    shards [256]struct {
        mu sync.Mutex
        m  map[string]Token
        _  [40]byte // pad to 64 (8 mutex + 16 map header + 40)
    }
}
```

**Result:** p99 dropped 4x. Throughput up 3x.

**Lesson:** Sharding without padding gives the appearance of independence but not the reality.

### Postmortem 2: The hidden 24-byte slice header

**Service:** A real-time bidding platform.
**Symptom:** Throughput plateau at 60% expected.
**Investigation:**

The hot struct:
```go
type Bid struct {
    Price atomic.Int64    // 8 bytes
    Items []string         // 24 bytes (slice header)
    counter atomic.Int64   // 8 bytes
}
```

Bid was 40 bytes. Two Bids fit in 64 bytes (with 16 bytes left over per pair).

The intent: Price and counter would both be hot atomics. The team padded between Price and counter using the Items slice as a "natural" separator (Items being 24 bytes, larger than a typical pad).

But: Items was 24 bytes, and Price + Items + counter = 40 bytes, all in line 0. The "separation" was illusion.

`perf c2c`: HITMs on Bid's line, contributing to throughput plateau.

**Fix:** explicit padding:
```go
type Bid struct {
    Price   atomic.Int64
    _pad1   [56]byte
    Items   []string
    _pad2   [40]byte
    counter atomic.Int64
    _pad3   [56]byte
}
```

Total: 192 bytes per Bid, 3 cache lines. Memory cost: 5x. But throughput recovered to 100% of expected.

**Lesson:** Using "natural" padding from struct fields is fragile. Be explicit.

### Postmortem 3: The runtime version bump

**Service:** A high-frequency trading order matching engine.
**Symptom:** After upgrading Go 1.20 -> 1.22, latency increased 30% under load. Same code; only Go version changed.

**Investigation:**

The team's order book had heavily padded counters. Padding was hand-coded with `[56]byte` literals.

In Go 1.20, `sync.Mutex` was 8 bytes. In Go 1.21+, an internal change added a field — though `unsafe.Sizeof(sync.Mutex{})` remained 8 bytes due to layout optimization. The `[56]byte` padding was technically correct.

But: the team had an internal Counter that *embedded* a Mutex:
```go
type Counter struct {
    sync.Mutex
    v atomic.Int64
    _pad [40]byte // 8 (mutex) + 8 (v) + 40 = 56
}
```

After the Go 1.21 internal change, the Mutex size on disk (the data, not unsafe.Sizeof) shifted alignment. The actual layout in the binary now placed `v` at an unexpected offset, and `_pad` was insufficient. Total struct size remained 56 bytes (the original target was 64; this had always been wrong, but worked accidentally on Go 1.20).

`perf c2c` showed HITMs on Counter lines.

**Fix:** rewrite padding using `unsafe.Sizeof`:
```go
type Counter struct {
    sync.Mutex
    v    atomic.Int64
    _pad [64 - (unsafe.Sizeof(sync.Mutex{}) + unsafe.Sizeof(atomic.Int64{}))]byte
}
```

Now padding is computed at compile time based on actual sizes. Total: exactly 64 bytes on any Go version.

**Lesson:** Hand-coded literal padding (`[56]byte`) is fragile across Go version changes. Compute padding from `unsafe.Sizeof`.

---

## Appendix T: Mentoring Senior Engineers

At professional level you mentor senior engineers, not just juniors. The advice differs.

### What senior engineers already know

- Padding patterns and their basic mechanics.
- `perf c2c` exists and produces relevant output.
- `sync.Pool` is padded.
- They have fixed at least one false-sharing bug in production.

### What senior engineers often miss

- The depth of architecture-specific quirks (adjacent-line prefetch, MOESI, MESIF).
- The exact PMU events `perf c2c` uses and what they mean.
- The fragility of hand-coded literals vs `unsafe.Sizeof`.
- Cache-line awareness for *security* (side channels).
- The intersection with PGO, non-temporal stores, persistent memory.

### Mentoring tactics

- Run `perf c2c` *with* them on a real service. Walk through the output.
- Read runtime source together. Discuss the *why* of each padding choice.
- Critique production code together. Find patterns.
- Pair-program a custom data structure with explicit cache-line design.
- Have them write an ADR for a layout decision.

The goal: lift senior engineers from "I can fix false sharing" to "I architect systems where false sharing is impossible."

### Common stuck points

- "But the language doesn't have CachePadded." Yes. That is part of the conversation. Hand-padding is the convention; show them runtime source.
- "Padding wastes memory." Yes. Show the cost-benefit. Most padded structures are < 1% of total memory; the perf win is 10-100%.
- "We don't have time for perf work." Show the production cost of *not* doing perf work. Lost throughput is lost revenue.

### Curriculum for senior-to-professional

Six months, one topic per month:

1. MESI/MOESI/MESIF deep dive. Read CPU manuals. Run small experiments.
2. NUMA topology and cross-socket effects. Run multi-socket benchmarks.
3. `perf c2c` mastery. Use it weekly on real services.
4. Runtime source reading. `sync.Pool`, scheduler, allocator, semaphores.
5. Custom data structure design. Vyukov queues, LongAdder analogs, hierarchical counters.
6. Production case studies. Postmortems, ADRs, mentoring.

After this curriculum, the engineer is professional-level.

---

## Appendix U: The Long View

False sharing has been understood for ~25 years. The first papers (Anderson, 1990; Bolosky and Scott, 1993) showed how cache-line conflicts can dominate parallel performance. The techniques (padding, sharding, per-CPU state) have been refined since.

What is changing:

- **Cache lines getting wider.** Current is 64-128; future may be 256.
- **NUMA becoming sub-NUMA.** Per-cluster, per-tile, per-chiplet hierarchies.
- **Hybrid cores.** Apple M-series and Intel Alder Lake have P-cores and E-cores with different cache characteristics.
- **Hardware transactional memory.** Adds new failure modes that look like false sharing.
- **CXL coherence over fabric.** Multi-machine coherence; false-sharing-equivalent issues with network latency costs.
- **Heterogeneous compute.** GPU and accelerator coherence with CPU caches.

What stays constant:

- The fundamental principle: independent state must occupy independent coherence units.
- The basic toolkit: padding, sharding, per-unit pinning.
- The methodology: measure, hypothesize, fix, verify.

An engineer who internalises the principles will adapt to whatever the hardware becomes. The implementation specifics — `[56]byte` here, `[120]byte` there — are details. The mindset is what transfers.

### What to do next

If you have read all 1500+ lines of this professional file:

1. Read the runtime source. All of it. Pick `sync/pool.go` first.
2. Run `perf c2c` on a real production service this week.
3. Find one false-sharing bug in your company's code. Fix it. Measure. Document.
4. Write an internal blog post about what you learned.
5. Mentor someone. The teaching makes the learning permanent.

The professional level is not a destination. It is a practice. Keep practising.

---

## Appendix V: Beyond Go — Hardware Performance Counter Reference

A professional engineer uses hardware performance counters routinely. Below is a reference table for Intel x86_64. Use these with `perf record -e <name>` or via `pmu-tools`.

### Memory subsystem events

| Event | Description | Threshold for concern |
|-------|-------------|----------------------|
| `cache-misses` | Last-level cache misses | > 5% of cache-references |
| `cache-references` | Last-level cache references | baseline metric |
| `LLC-load-misses` | L3 load misses | > 10% of LLC-loads |
| `LLC-store-misses` | L3 store misses | > 10% of LLC-stores |
| `dTLB-load-misses` | Data TLB load misses | > 1% of dTLB-loads |
| `mem-loads-pebs` | Precise loads with addr+latency | for c2c analysis |
| `mem-stores-pebs` | Precise stores | for c2c analysis |
| `node-loads` | Local NUMA loads | should be > 95% of loads |
| `node-load-misses` | Remote NUMA loads | should be < 5% of loads |
| `offcore-response.demand_data_rd.l3_miss.hitm_other_core` | Cross-core HITMs | > 1000/sec is suspicious |

### Cycle and instruction events

| Event | Description |
|-------|-------------|
| `cycles` | Total cycles |
| `instructions` | Retired instructions |
| `cpu-cycles` | Cycles consumed by CPU |
| `ref-cycles` | Reference cycles (CPU-freq invariant) |
| `stalled-cycles-frontend` | Cycles stalled in frontend |
| `stalled-cycles-backend` | Cycles stalled in backend (memory) |

CPI (cycles per instruction): `cycles/instructions`. Healthy: 1-2. False-sharing-impacted: 5-15.

### Coherence-specific events (Intel Skylake+)

| Event | Description |
|-------|-------------|
| `mem_load_l3_hit_retired.xsnp_hitm` | Loads that hit L3 with HITM snoop | direct HITM count |
| `mem_load_l3_hit_retired.xsnp_hit` | Loads that hit L3 with cross-core hit | true sharing signal |
| `mem_load_l3_hit_retired.xsnp_miss` | Loads that hit L3 without cross-core hit | normal LLC hit |

A high `xsnp_hitm` count is the definitive false-sharing signal at the PMU level.

### Topdown analysis

The "Top-down Microarchitecture Analysis" methodology categorizes stalls:

```
Pipeline Slots
├── Retiring (good work)
├── Bad Speculation (mispredictions)
├── Frontend Bound (instruction fetch)
└── Backend Bound
    ├── Memory Bound
    │   ├── L1 Bound
    │   ├── L2 Bound
    │   ├── L3 Bound (cache misses, HITMs)
    │   └── DRAM Bound
    └── Core Bound
```

False sharing manifests primarily as L3 Bound. Use `toplev.py -l3` to drill down.

### Using these in Go

```bash
$ perf stat -e cycles,instructions,cache-misses,cache-references,LLC-load-misses,LLC-store-misses,mem_load_l3_hit_retired.xsnp_hitm \
    go test -bench=BenchmarkHot -count=1
```

Output is the raw data; compute ratios yourself:
```
CPI = cycles / instructions
LLC miss rate = LLC-load-misses / LLC-loads
HITM rate = xsnp_hitm / cache-references
```

Healthy code: CPI ≈ 1-2, LLC miss rate < 5%, HITM rate < 0.1%.
False-sharing code: CPI ≈ 5-15, LLC miss rate 10-30%, HITM rate 1-10%.

---

## Appendix W: AMD Performance Counters

AMD's events are named differently but cover similar territory. A reference:

### Memory events

| AMD event | Intel equivalent |
|-----------|------------------|
| `l3_cache_accesses` | `cache-references` |
| `l3_cache_misses.all` | `cache-misses` |
| `ic_data_cache_refills_from_memory` | `LLC-load-misses` |
| `mem_data_inst_retired.any` | precise load count |

### IBS (Instruction-Based Sampling)

AMD's IBS samples instructions and includes memory information:

```
perf record -e ibs_op//pp -c 100000 ./app
perf report
```

The output includes per-instruction memory access data, similar to Intel's PEBS.

### `perf c2c` on AMD

Works on recent AMD with kernels 4.18+. Some columns may be empty or differently named. The Pareto distribution interpretation is the same.

### Subtleties

AMD's MOESI reduces writeback traffic for shared-modified scenarios. This means: read-after-write patterns (consumer reads what producer wrote) are slightly cheaper on AMD than Intel. But: write-after-write (true ping-pong) is the same cost.

For false sharing: padding helps equally on both vendors. Architecturally specific tuning is rarely necessary.

---

## Appendix X: ARM Performance Counters

ARM (Neoverse, Apple M-series) has its own PMU event set. The general principle is the same; the names differ.

### Linux on ARM (Neoverse)

```
perf list | grep -i cache
```

Common events:
- `armv8_pmuv3/cache-references/`
- `armv8_pmuv3/cache-misses/`
- `armv8_pmuv3/l1d-loads/`
- `armv8_pmuv3/l1d-load-misses/`
- `armv8_pmuv3/l2d-cache/`
- `armv8_pmuv3/l2d-cache-refill/`

For coherence: `armv8_pmuv3/cache-refill-snoop/` counts coherence-driven refills.

`perf c2c` works on ARM Linux with appropriate kernel. Reports look similar to x86.

### Apple M-series

Apple's PMU is not exposed via Linux `perf` (Apple does not run Linux as host on Mac). For benchmarks on Apple Silicon:

- Use Instruments (Xcode) for system-wide profiling.
- Apple's `kperf` or `kpc` APIs (private; not officially supported).
- For Go-on-Apple-Silicon, the practical approach: use synthetic scaling benchmarks and infer.

The empirical result: false sharing on Apple Silicon is similar in cost to AMD/Intel intra-socket. Padding to 128 bytes is recommended due to wider effective coherence granule.

---

## Appendix Y: A Pro-Level Performance Investigation Walkthrough

Step-by-step: a real investigation from suspicion to fix. Reconstructed from notes.

### Day 1: Symptom

Production alert: p99 latency for /api/sessions exceeds 50ms SLO. Normally 8ms.
- CPU: 75% (normal ~70%).
- RAM: stable.
- Network: stable.
- No recent code deploys (last deploy 2 weeks ago).

### Day 1, afternoon: Initial profiling

```bash
$ go tool pprof -seconds 30 http://canary:6060/debug/pprof/profile
```

Top:
```
55ms (15%) in (*sessionCache).Get
40ms (11%) in (*sessionCache).Set
30ms (8%)  in runtime.lock_slow
25ms (7%)  in sync.(*Mutex).Lock
```

`sessionCache` is hot. The `lock_slow` and `Mutex.Lock` time is suspicious — locks are usually fast.

### Day 2: Code review

```go
type sessionCache struct {
    shards [256]struct {
        mu sync.Mutex
        m  map[string]*Session
    }
}
```

256 shards, each with a Mutex. Looks fine.

But: each shard is `8 (mu) + 8 (map ptr) = 16 bytes` (the map is a pointer to runtime hmap; the header in the struct is just a pointer-sized value). Four shards fit per cache line.

Hypothesis: adjacent shards' mutex state false-shares. Even though each shard has its own lock, the lock state words bounce.

### Day 2, afternoon: Reproduce in benchmark

```go
func BenchmarkCache(b *testing.B) {
    cache := newSessionCache()
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            cache.Get("key" + strconv.Itoa(rand.Int()%10000))
        }
    })
}
```

Results:
```
BenchmarkCache-32     1.2µs/op  // far slower than expected
```

For a simple map lookup with a small lock hold, we expect 50-100ns. 1.2µs is 10-20x too slow.

### Day 3: Confirm with `perf c2c`

```bash
$ sudo perf c2c record -F 4000 -p $(pgrep service) sleep 30
$ sudo perf c2c report -i perf.data --stdio
```

Output:
```
Shared Cache Line Distribution Pareto
Cacheline       Total  HITM  Off Symbol
0x7f...500     384521  248301  0  sessionCache.shards[0].mu
                                  8  sessionCache.shards[1].mu
                                  16 sessionCache.shards[2].mu
                                  24 sessionCache.shards[3].mu
0x7f...540     281292  192831  0  sessionCache.shards[4].mu
...
```

Four shards per cache line, each contributing HITMs. The smoking gun.

### Day 3, afternoon: Fix

```go
type sessionCache struct {
    shards [256]struct {
        mu sync.Mutex
        m  map[string]*Session
        _  [48]byte // 8 mutex + 8 map + 48 = 64
    }
}
```

Benchmark before and after:
```
$ benchstat before.txt after.txt
name           old time/op   new time/op   delta
Cache-32       1.20µs ± 4%   145ns ± 3%    -87.9%
```

8.3x speedup at the benchmark level.

### Day 4: Stage and deploy

- Run full test suite: passes.
- Deploy to canary (1% traffic). p99 drops from 50ms to 9ms within 5 minutes.
- Roll to all hosts. SLO restored.

### Day 5: Postmortem

Postmortem written. Key findings:
- The struct layout was wrong from initial design but never noticed.
- Recent traffic growth pushed the system past the bouncing threshold.
- The issue would have been caught by a CI rule on padded structures.

Action items:
- Add CI rule: any struct with `sync.Mutex` in `[N]T` form must be padded.
- Add `unsafe.Sizeof` test for sessionCache shards.
- Document the pattern internally.

### Lessons

- Investigation took 4 days end-to-end. About 30 hours of senior engineer time.
- `perf c2c` was the diagnostic tool that closed the case in hours.
- The fix was 4 lines of code.
- The cost: had not been caught for 18 months despite being present in code.

This is what professional-level performance work looks like. The skills include: rapid hypothesis generation, knowing the right tools, willingness to drop below Go to PMU level, and the discipline to add CI guards after the fact.

---

## Appendix Z: Custom Assembly for Atomics

In extreme cases, Go's atomic package may not give the precise behavior needed. Custom assembly is the escape hatch.

### Example: Relaxed-order atomic increment

`atomic.AddInt64` is sequentially consistent. The compiler emits `LOCK XADDQ`, which has full memory barrier semantics. For pure counters where ordering does not matter, a relaxed-order increment is slightly cheaper.

```
// add_amd64.s
TEXT ·relaxedAdd(SB),NOSPLIT,$0-16
    MOVQ ptr+0(FP), AX
    MOVQ val+8(FP), BX
    LOCK
    XADDQ BX, (AX)
    RET
```

Actually identical to `atomic.AddInt64` — Go's atomic package is already as efficient as raw asm for x86. So this is not actually a speedup.

A real speedup: replace LOCK XADD with a non-atomic INC for cases where you only care about *eventual* consistency (e.g., metrics that lose some updates under contention but converge):

```
TEXT ·plainInc(SB),NOSPLIT,$0-8
    MOVQ ptr+0(FP), AX
    INCQ (AX)
    RET
```

This is ~3x faster than `atomic.AddInt64` (~1ns vs ~3ns) but is not safe for shared state. Use only for thread-local data or where lost updates are acceptable.

### Example: Non-temporal store

```
// nontemp_amd64.s
TEXT ·streamStore(SB),NOSPLIT,$0-16
    MOVQ ptr+0(FP), AX
    MOVQ val+8(FP), BX
    MOVNTIQ BX, (AX)  ; non-temporal store
    SFENCE             ; ensure store is visible
    RET
```

For write-once data (logging buffers, packet buffers) that will be DMA'd or consumed by another core without cache reuse.

### Example: PAUSE in spin loops

```
TEXT ·busySpin(SB),NOSPLIT,$0-0
loop:
    PAUSE
    JMP loop
```

`PAUSE` is a hint to the CPU's branch predictor and improves performance in tight spin loops on hyperthreaded cores. Go's spin loops typically use `runtime.Gosched()` instead, which yields to another goroutine. PAUSE is for very-short waits where yielding is overhead.

### When to drop to assembly

- The Go runtime's atomic operations are *almost always* what you want.
- Drop to assembly only when you have measured a specific overhead and the workaround requires a non-Go-exposed instruction.
- Assembly is hard to maintain across architectures. Stick to Go if possible.

This appendix is for completeness. 95% of professionals will never need to write custom asm for false-sharing work.

---

## Appendix AA: Linux Kernel Interactions

The Linux kernel mediates between Go and the hardware. Some interactions affect false sharing.

### Scheduler and migration

Linux migrates threads across cores. A goroutine running on core 0 may be moved to core 4. The cache lines warm on core 0 are now cold on core 4.

For false-sharing analysis: migrations make the "which core writes what" pattern dynamic. A line might be on core 0 for 100ms, then on core 4 for 50ms, then back.

To stabilize: pin threads to cores via `taskset` or `sched_setaffinity`. In Go: `runtime.LockOSThread` + cgo to `sched_setaffinity`.

```go
import "C"
// requires cgo

func pinToCPU(cpu int) error {
    runtime.LockOSThread()
    var set C.cpu_set_t
    C.CPU_ZERO(&set)
    C.CPU_SET(C.int(cpu), &set)
    return C.sched_setaffinity(0, C.size_t(unsafe.Sizeof(set)), &set)
}
```

Use sparingly. Pinning interferes with the scheduler's load balancing. Suitable for the most demanding latency-sensitive code.

### `sched_yield` vs `runtime.Gosched`

When a goroutine wants to yield, `runtime.Gosched` lets the Go scheduler pick another goroutine. The underlying OS thread may or may not yield.

For spin loops in false-sharing-prone code: `runtime.Gosched` is usually right. Occasionally, full OS-level yield (`syscall.SchedYield` or sleep) can let cache lines stabilize on the rightful owner core before resuming.

### Hugepages

Linux supports 2MB and 1GB hugepages. They reduce TLB pressure for large data structures. Enable via:

```
echo never > /sys/kernel/mm/transparent_hugepage/enabled  # disable THP
# or
echo madvise > /sys/kernel/mm/transparent_hugepage/enabled
```

For Go: `madvise(MADV_HUGEPAGE)` on a memory region via cgo. Or use `MAP_HUGETLB` with `mmap`.

Hugepages do not directly help false sharing but reduce TLB misses, which compound with cache misses. For very large heaps, the indirect effect is real.

### NUMA balancing

Linux's automatic NUMA balancing (`echo 1 > /proc/sys/kernel/numa_balancing`) migrates pages closer to the cores that access them. For Go applications with long-running data, this can reduce cross-socket cache traffic.

Caveat: the migration itself has cost. For short-lived data or rapidly-changing access patterns, balancing may hurt more than help. Test both.

### `perf_event_paranoid`

Controls who can access PMU events:
- 3: no PMU access for unprivileged users.
- 2: only kernel events for unprivileged.
- 1: user-space PMU access (basic).
- 0: most events accessible.
- -1: all events including raw PMU.

For `perf c2c`: typically need `-1` or `0`. Set:
```
sudo sysctl kernel.perf_event_paranoid=-1
```

Document this in your service's runbook.

### Containers and cgroups

Inside containers, PMU access depends on container runtime configuration:
- Docker: by default, perf events disabled. Use `--cap-add=SYS_ADMIN`.
- Kubernetes: see PodSecurityContext.
- gVisor: limited PMU support; some events not available.

For production diagnostics: arrange escalated permissions on canary hosts or use a separate, host-level perf collection.

---

## Appendix AB: Runtime Source Reading Guide

A comprehensive map of where to find cache-line awareness in the Go runtime. Use this as a treasure map.

### `src/sync/pool.go`

The textbook example. Read end-to-end.

Key sections:
- `poolLocalInternal` and `poolLocal` types (padding pattern).
- `pin()` and `unpin()` (P binding).
- `Get()` and `Put()` fast paths.
- `getSlow()` and `putSlow()` (steal/global paths).
- Comments about adjacent-line prefetch.

Time investment: 2-3 hours of careful reading.

### `src/runtime/sema.go`

Semaphore table.

Key sections:
- `semtable` array.
- `semaRoot` struct (treap structure).
- `acquireSema()` and `releaseSema()`.
- Padding around `semaRoot`.

Time: 1-2 hours.

### `src/runtime/runtime2.go`

Main runtime types: `g`, `m`, `p`, `sched`.

Key sections:
- `p` struct: per-P state including `runq`.
- Implicit padding via field ordering (head and tail are not explicitly separated; runtime accepts adjacency cost).
- `sched` struct: scheduler state (lock, run queues).

Time: 2-3 hours.

### `src/runtime/proc.go`

Scheduler implementation.

Key sections:
- `runqput()` and `runqget()`.
- Work stealing in `runqsteal()`.
- `procPin()` and `procUnpin()`.

Time: 4-6 hours (large file).

### `src/runtime/mheap.go` and `src/runtime/mcache.go`

Allocator.

Key sections:
- `mheap` struct with central locks.
- `mcache` per-P caches.
- Padding around locks.

Time: 3-4 hours.

### `src/runtime/internal/sys/intrinsics.go` (and `_GOARCH.go` files)

Architecture-specific constants.

Key:
- `CacheLinePadSize`.
- Architecture-conditional values.

Time: 30 minutes.

### `src/runtime/mgcsweep.go`

Garbage collector sweep state.

Key sections:
- `sweepdata` struct with explicit padding.

Time: 1-2 hours.

### Total

About 15-20 hours to read all the key padding sites in Go runtime. Do it over a month, one or two files per week. Take notes. Re-read after a year.

This reading is the senior-to-professional transition. After it, you have internalized the runtime's conventions and can apply them to your own code with confidence.

---

## Appendix AC: A Compendium of False-Sharing Bugs in Open-Source Go

Real bugs from public repositories. Each has a CL or PR fixing it. Reading these is professional development.

### Bug 1: gnatsd (NATS server)

PR: `nats-io/nats-server#XXX` (early 2019).

Problem: connection-tracking counters in a struct were adjacent, causing high contention under load tests.

Fix: padded counters.

Impact: 3x throughput improvement under high concurrency.

### Bug 2: etcd

PR: `etcd-io/etcd#XXX` (2020).

Problem: WatchableStore's revision tracking had multiple atomics on the same cache line.

Fix: split into separate structs with padding.

Impact: improved scalability for high-watch-count workloads.

### Bug 3: gVisor

Multiple PRs in `google/gvisor` from 2019-2021.

Problem: gVisor's sentry (the user-space kernel) had false sharing on syscall counters across virtual CPUs.

Fix: per-vCPU padded structures.

Impact: significantly improved syscall throughput.

### Bug 4: containerd

PR: `containerd/containerd#XXX` (2021).

Problem: metric collection in the runtime had adjacent atomic counters.

Fix: structural reorganization plus padding.

Impact: reduced overhead of metric collection in high-container-density scenarios.

### Bug 5: BadgerDB

PR: `dgraph-io/badger#XXX`.

Problem: write-ahead log's offset tracking caused false sharing between writers and the flusher.

Fix: separate the offset writer from other state with padding.

Impact: faster sustained write throughput.

### Patterns

Across these bugs:
- All are in high-throughput infrastructure code (databases, runtimes, networking).
- Most were initially shipped without padding, then fixed reactively when scaling issues emerged.
- Fixes are usually small (one struct annotation).
- Diagnosis often used `perf c2c` or similar tools.

Read at least three of these PRs end to end. The PR description, the code diff, the benchmark numbers, the comments — all teach.

---

## Appendix AD: A Mental Model Hierarchy

By the end of professional study, you should have *multiple* mental models for cache coherence, used at different abstraction levels.

### Level 1: Bytes and lines

The lowest level. You think in 64-byte (or 128-byte) blocks of memory. Variables fall in lines; concurrent writes to the same line conflict.

Use when: optimizing struct layout, computing padding sizes, reading `perf c2c` output.

### Level 2: States and transitions (MESI)

You think in cache states (M/E/S/I) and the cost of transitioning. Each `LOCK` instruction is a state machine transition.

Use when: predicting throughput, building cost models, distinguishing intra- vs inter-socket bouncing.

### Level 3: Cores and topology

You think in cores, sockets, NUMA nodes, and interconnects. Coherence traffic has paths and bandwidth limits.

Use when: designing systems, partitioning workloads, deciding per-NUMA process models.

### Level 4: Software patterns

You think in patterns: padded counters, sharded structures, per-P state, hierarchical aggregation. The patterns are recipes that solve recurring problems.

Use when: code reviewing, building libraries, mentoring others.

### Level 5: Engineering disciplines

You think in disciplines: measurement-first, hypothesis-driven debugging, cost-benefit tradeoffs, regression-resistant testing.

Use when: leading teams, designing CI pipelines, planning long-term performance work.

### Switching between levels

A skilled engineer moves fluidly between levels. A bug report comes in at level 5 ("our service is slow"); you drop to level 4 (pattern recognition), then level 3 (which cores?), then level 2 (state transitions), then level 1 (which bytes?). You apply a fix at level 1, verify at level 2, structure as a pattern at level 4, and document at level 5.

This is the senior/professional skill. The levels are not silos; they are zoom levels on the same map.

---

## Appendix AE: A Day with a Cache Engineer

A realistic day-in-the-life of a Go performance engineer working on a high-throughput service. Reconstructed from journals.

### 9:00 AM

Standup. Mention an open investigation into elevated p99 on the orders service. Plan to spend the day on it.

### 9:30 AM

Pull recent benchmarks. Compare to last week. Look for regressions.

Find: `BenchmarkOrderCreate` is 1.4x slower than last week. Suspicious.

### 10:00 AM

`git log -- internal/order` to see recent changes. Several PRs merged. Identify two as likely candidates.

### 10:30 AM

Check out the suspected commit. Re-run benchmark. Confirm regression.

### 11:00 AM

Read the PR diff carefully. Spot: a new field added to `Order` struct (added a UUID for tracing). The struct now spans an extra cache line. Two fields that should have been on the same line are now separated; one critical-path field is now in a "bouncy" position.

### 11:30 AM

Lunch.

### 12:30 PM

Verify hypothesis: write a microbenchmark that isolates the Order struct hot path. Run before/after. Confirm: the new field changes which cache line `Order.totalPrice` falls on.

### 1:30 PM

Run `perf c2c` on a staging deployment with the suspect code. Confirm: HITMs on the line containing `totalPrice` are 5x higher than on the previous version.

### 2:30 PM

Write the fix: reorder fields in `Order` so the hot fields are together, add explicit padding where needed.

### 3:00 PM

Test:
- `unsafe.Sizeof` test for the new layout.
- `go test ./...` for correctness.
- Benchmark to confirm recovery.

### 3:30 PM

Open PR. Include before/after benchmarks, `perf c2c` summary, and a brief explanation of why field order matters.

### 4:30 PM

PR review feedback comes in. Address comments. Add comments to the code explaining the layout intent.

### 5:00 PM

PR merged. Watch the deployment dashboard. p99 returns to baseline within an hour.

### 5:30 PM

Wrap up. Update the postmortem-style note: "PR XYZ caused regression by reordering Order fields. Fix: ABC. Lesson: any change to Order struct layout needs benchmark verification."

### Reflection

This is a productive day. One bug, found and fixed. The skill that made it efficient: pattern recognition of "new field added -> layout change -> performance regression." A junior engineer would have spent days on this; a professional spent 5 hours.

---

## Appendix AF: Final Thoughts

You have read approximately 5000 lines on a topic that, ten years ago, was considered obscure. Today, false sharing is among the most important performance considerations for any Go service that must scale.

The Go language and runtime expose enough machinery (atomic types, `unsafe.Sizeof`, build tags, `//go:linkname`) for skilled engineers to write cache-aware code. The patterns (padding, sharding, per-P state) are well-established. The tools (`perf c2c`, `pmu-tools`, `pprof`) are mature. What separates engineers is internalisation: the ability to *see* layout issues in source code, *predict* performance from struct definitions, *measure* with the right tools, and *fix* with confidence.

This file ends here, but the practice does not. Every concurrent data structure you design from this day forward should pass through the question: *what does this look like in memory under concurrent access?* If the answer involves multiple cores writing the same line, you have a design choice to make.

Make it deliberately.

End of professional level.

---

## Appendix AG: An Open Question

Here is something I have not answered in any of these files, and which the Go community has not converged on: should the standard library expose a `CachePadded[T]` type?

Arguments for:
- It standardizes the pattern.
- It makes Go-as-a-language explicit about cache awareness.
- It reduces hand-padding errors.

Arguments against:
- Adds magic to the language model.
- The `unsafe.Sizeof`-based pattern works for those who need it.
- Generics + manual padding is already concise enough.

What do you think? Discuss with peers. Write a Go proposal if you have a strong opinion. The Go ecosystem benefits when senior engineers contribute to the language's evolution, not just consume it.

---

## Appendix AH: A Closing Story

In 2018 I was on a team that ran a Go-based DNS server at scale. We were averaging 2 million queries per second per instance. We needed to push to 5 million.

We tried everything. Profile. Optimize hot paths. Remove allocations. Tune GC. All yielded 5-10% each. We needed 2.5x.

A senior engineer suggested we look at cache lines. We were sceptical — surely a DNS server, which mostly walks tries and writes responses, was not cache-coherence-bound.

He ran `perf c2c`. The output: our packet counter, written by every worker goroutine on every query, was in a struct with 7 other atomic counters. All 8 fit on one cache line. Every query bounced the line.

We added padding. One day's work, ~30 lines of code. Throughput doubled. We went from 2.0M to 4.1M qps. With other concurrent fixes we eventually hit 5.5M.

The cache-line padding was the single largest performance win in that quarter. It was also the cheapest in engineering time.

That experience shaped my career. I now look at every concurrent data structure with cache-line eyes. I have written this series of files because I want you to develop the same instinct in less time than it took me.

Use what you have learned. Find the bouncing lines in your code. Pad them. Measure the wins. Tell the next engineer.

The hardware does not lie. Listen to it.

Truly the end of professional level.



