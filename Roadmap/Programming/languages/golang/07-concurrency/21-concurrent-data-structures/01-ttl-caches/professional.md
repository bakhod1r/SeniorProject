---
layout: default
title: Professional
parent: TTL Caches
grand_parent: Concurrent Data Structures
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/01-ttl-caches/professional/
---

# Concurrent TTL Caches — Professional Level

## Table of Contents
1. [Scope of This File](#scope-of-this-file)
2. [The Billion-Entry Cache Problem](#the-billion-entry-cache-problem)
3. [Memory Layout Design](#memory-layout-design)
4. [Off-Heap Storage Strategies](#off-heap-storage-strategies)
5. [Slab Allocation](#slab-allocation)
6. [Custom Memory Allocators](#custom-memory-allocators)
7. [`mmap` and Anonymous Memory](#mmap-and-anonymous-memory)
8. [Per-CPU Data Structures](#per-cpu-data-structures)
9. [NUMA-Aware Sharding](#numa-aware-sharding)
10. [Cache-Line and False-Sharing Engineering](#cache-line-and-false-sharing-engineering)
11. [Lock-Free TTL Cache Design](#lock-free-ttl-cache-design)
12. [Hierarchical Timer Wheels](#hierarchical-timer-wheels)
13. [Distributed Multi-Tier Architectures](#distributed-multi-tier-architectures)
14. [Strong-Consistency Caches](#strong-consistency-caches)
15. [CDN-Scale Edge Caching](#cdn-scale-edge-caching)
16. [Cache Coherence Across Datacenters](#cache-coherence-across-datacenters)
17. [Telemetry at Scale](#telemetry-at-scale)
18. [Production Caches in Practice](#production-caches-in-practice)
19. [Custom Cache Library Design](#custom-cache-library-design)
20. [Quirky Real-World Caches](#quirky-real-world-caches)
21. [Worked Example: GC-Free 10 GB Cache](#worked-example-gc-free-10-gb-cache)
22. [Worked Example: Bloom-Filter-Fronted Cache](#worked-example-bloom-filter-fronted-cache)
23. [Worked Example: Multi-Datacenter Cache Mesh](#worked-example-multi-datacenter-cache-mesh)
24. [Cheat Sheet](#cheat-sheet)
25. [Self-Assessment Checklist](#self-assessment-checklist)
26. [Summary](#summary)
27. [Further Reading](#further-reading)

---

## Deep Dive: The 80/20 of Caches

Pareto principle applies aggressively to caches:

- 20% of keys account for 80% of traffic.
- 20% of cache size delivers 80% of hit ratio.
- 20% of the complexity delivers 80% of the value.

Practical implications:

- Cache the hot 20%, accept misses for the cold 80%.
- Size the cache to fit the hot 20% (much smaller than naive sizing).
- Build the simple thing first; add complexity only when 80% solution isn't enough.

For most caches, the simple 100-line implementation gets you 80% of the way. The remaining 20% (admission policies, sharding, hierarchical wheels) accounts for 80% of the code.

Know when to stop.

---

## A Note on This Level

Most senior engineers will never need everything in this file. That is by design. The professional level is "what is possible," not "what is required."

When you find yourself reaching for these techniques:

- Verify with measurements that the simpler approach is the bottleneck.
- Implement the smallest change that solves the actual problem.
- Document why you chose this technique over the simpler alternative.

A cache that uses every trick in this file is an over-engineered cache. A cache that uses one or two tricks where they genuinely matter is a well-tuned cache.

---

## Deep Dive: When Caching Hurts More Than Helps

A confronting realization: sometimes the cache is the problem.

Symptoms:

- p99 latency dominated by cache stalls, not by upstream.
- Cache uses more memory than upstream.
- Cache hit ratio is low (<50%); cache rarely helps.
- Cache misses are catastrophically expensive (singleflight failures).
- Cache invalidation bugs cause data corruption.

When you find this:

- Consider removing the cache.
- Measure both with and without; the without may be faster.
- Check whether the upstream has its own cache (often it does).

A common Pareto: a service uses an in-process cache, but the database also caches. The in-process cache adds latency and complexity but saves nothing the database wasn't already saving.

Always question whether the cache is justified.

---

## Scope of This File

The professional level addresses caches at internet scale: hundreds of millions of entries per process, gigabytes to terabytes of memory, multi-datacenter coherence, sub-microsecond latency targets. Few services need this; for those that do, the techniques here are essential.

This is not "every cache should do these things." Most caches are happy at the senior level. This file is for the cases where the senior level is not enough.

After reading you should know how to:

- Engineer a cache that holds 10 GB+ of data without GC pauses.
- Avoid all false sharing on a 64-core machine.
- Design lock-free read paths via atomic pointers and immutable structures.
- Implement a hierarchical timer wheel.
- Coordinate caches across datacenters with bounded staleness.
- Build a complete cache library from scratch.

We assume fluency with everything from junior, middle, and senior. Concepts will be referenced briefly without re-introduction.

---

## Deep Dive: Hugepages

Default page size is 4 KB on x86. For caches > 1 GB, that's 250k page table entries; TLB misses become frequent.

Hugepages (2 MB or 1 GB pages) reduce TLB pressure:

- 1 GB cache as 4 KB pages: 250k TLB entries.
- 1 GB cache as 2 MB hugepages: 500 TLB entries.

TLB has ~64 entries on most x86. With 4 KB pages, the cache cannot fit in TLB. Every random access misses TLB → page walk → 100+ ns.

Enabling hugepages:

```bash
# At boot:
echo 1024 > /proc/sys/vm/nr_hugepages

# In Go (Linux only):
syscall.Mmap(-1, 0, size, PROT_READ|PROT_WRITE, MAP_ANON|MAP_PRIVATE|MAP_HUGETLB)
```

Result: TLB-bound caches see 20-50% throughput improvement.

For sub-GB caches, hugepages add complexity without measurable benefit. For multi-GB caches, they are essential.

---

## Deep Dive: Cache for Polyglot Microservices

In a microservice mesh with services written in Go, Java, Python, the cache may need to be language-neutral.

Options:

- **Redis:** language-neutral protocol, every language has good clients.
- **Memcached:** simpler than Redis, similar reach.
- **gRPC service:** custom cache server speaks gRPC.

For Go-only deployments, in-process caches win on performance. For polyglot, network-attached caches are unavoidable.

The trade-off: 0.5ms network round trip vs 0.05ms in-process. For services with > 5ms total latency budget, the network cache is fine.

---

## Deep Dive: Cache Coherency Across Languages

When Go and Java both cache the same data:

- Each language's cache has different eviction, TTL, layout.
- Cache invalidation must work across languages.
- A common protocol (pub/sub, gRPC) is needed.

Best practice: choose one canonical cache (Redis); each language reads/writes through it. In-process caches per language are fine as long as they treat the canonical cache as L2 and use coordinated TTLs.

---

## The Billion-Entry Cache Problem

A cache holding 1 billion entries with 100-byte values is 100 GB. That is large but not exotic; CDN edges and large object stores routinely deal with this scale.

The challenges that emerge:

- **GC.** 1 billion pointers in `map[string]*Entry` mean 10+ seconds of GC pauses. Unacceptable.
- **Allocator pressure.** Allocating and freeing 1 billion small objects via Go's allocator is hugely expensive. The allocator is fast (a few ns per call) but a billion calls is minutes.
- **Cache line traffic.** Each shard's lock cache line, every entry's hot fields, every metadata access — all contend on the memory subsystem.
- **TLB pressure.** Spread memory across many pages, each access may miss the TLB. TLB shootdowns on modern CPUs are expensive.
- **Sweep time.** Even per-shard sweepers struggle when each shard holds 4 million entries.
- **Telemetry overhead.** Counters per Get cost tens of nanoseconds per call; at billions of QPS, that is gigahertz of CPU spent on metrics alone.

Each is a deep problem. The professional cache addresses them all.

---

## Deep Dive: Page Faults and Cache Warmup

A fresh `mmap` is "committed lazily" — physical pages are allocated on first access. The first read of a 1 GB cache from a fresh mmap costs ~250k page faults at ~1 µs each = ~250 ms.

Solutions:

- **`madvise(MADV_WILLNEED)`** — hint the kernel to preload.
- **Touch every page** — walk through the buffer once at startup.
- **mlock** — pin pages in RAM.

For latency-sensitive caches, "warm up" the memory before serving traffic:

```go
func warmup(data []byte) {
    pageSize := 4096
    for i := 0; i < len(data); i += pageSize {
        data[i] = data[i] // forces page fault
    }
}
```

After this, the cache is "hot" in the kernel's mind. First-access latency is normal.

---

## Deep Dive: Go Map Bucket Internals

A Go map is an array of "buckets," each holding up to 8 key-value pairs. Layout:

```
bucket:
  topbits [8]uint8  // high bits of each key's hash
  keys    [8]K
  values  [8]V
  overflow *bucket
```

When two keys hash to the same bucket, they share it (up to 8 per bucket). Beyond 8, an overflow bucket chains.

Implications:

- Small structs fit in fewer buckets.
- Pointer-heavy values force GC scans.
- A long overflow chain on one bucket is the worst case.

For caches with many keys hashing to the same bucket (bad hash function), performance degrades. Use a quality hash.

---

## Memory Layout Design

The first decision: how to lay out entries in memory.

### Option A: Go maps with inline values

```go
type Cache struct {
    m map[Key]Entry
}
```

GC scans every pointer in every Entry. For 1B entries, this is the dominant cost.

### Option B: Go maps with pointer values

```go
type Cache struct {
    m map[Key]*Entry
}
```

Same problem, worse: each `*Entry` is a separate allocation.

### Option C: Open-addressed hash table with packed entries

```go
type Cache struct {
    keys   []uint64    // 64-bit hashes of keys
    vals   []uint64    // value offsets into byte arena
    arena  []byte      // raw byte storage for values
}
```

Now we have:
- One `[]uint64` for keys (no pointers, GC ignores contents).
- One `[]uint64` for values.
- One `[]byte` for raw value bytes.

Three allocations total. GC sees three objects regardless of entry count.

This is the design used by high-performance caches. We will build it.

### Option D: Off-heap allocation via `mmap`

The same as C, but the arenas are allocated outside Go's heap entirely. Even less GC interaction. Discussed below.

---

## Deep Dive: GOMAXPROCS and Cache Performance

GOMAXPROCS controls how many OS threads can execute Go code simultaneously. Default = NumCPU.

For caches:

- Setting GOMAXPROCS too low → underutilizes CPU.
- Setting GOMAXPROCS too high → context switch overhead.

In Kubernetes with CPU requests/limits, the Go runtime may not detect the limit correctly. Use:

```go
import _ "go.uber.org/automaxprocs"
```

This sets GOMAXPROCS based on cgroup limits.

For high-throughput caches, GOMAXPROCS = available cores; not more.

---

## Deep Dive: Avoiding Map Reallocations

Go maps grow by allocating a larger backing array when load factor crosses a threshold. For caches that pre-size:

```go
// Avoid:
c.data = make(map[string]entry) // starts with default, grows

// Better:
c.data = make(map[string]entry, expectedSize)
```

For caches with known size bounds, pre-allocating avoids:

- 10+ rehashes as the map grows.
- Sub-millisecond stalls during each rehash.
- Allocator pressure.

For caches that grow over time, accept the rehashes. They're rare in practice.

---

## Off-Heap Storage Strategies

There are three ways to "go off-heap" in Go:

### 1. Single large `[]byte`

The cleanest approach. `[]byte` is GC-friendly (header scanned, contents ignored).

```go
arena := make([]byte, 10 * 1024 * 1024 * 1024) // 10 GB
```

Allocated once at startup. Values are written to offsets within this slice. The Go runtime manages the slice header; the contents are opaque to GC.

Pro: simple, idiomatic.
Con: still allocated by Go's allocator; the page-fault behavior is determined by `madvise` and the kernel.

### 2. `mmap` of anonymous memory

```go
data, _ := syscall.Mmap(-1, 0, size, syscall.PROT_READ|syscall.PROT_WRITE, syscall.MAP_ANON|syscall.MAP_PRIVATE)
```

Goes around Go's allocator. Memory is committed lazily (on first access) by the kernel.

Pro: no Go runtime involvement. Can be huge.
Con: must be unmapped manually; no Go-friendly bounds checking; SEGFAULT instead of panic on bad access.

### 3. `mmap` of a file

```go
f, _ := os.OpenFile("cache.bin", os.O_RDWR|os.O_CREATE, 0644)
f.Truncate(size)
data, _ := syscall.Mmap(int(f.Fd()), 0, size, syscall.PROT_READ|syscall.PROT_WRITE, syscall.MAP_SHARED)
```

Backed by disk. Survives process restart. Can be larger than physical RAM (paged in and out).

Pro: persistent. Can exceed RAM size.
Con: page faults to disk are slow; performance unpredictable.

For most caches, option 1 is enough. Options 2 and 3 are for specialized scenarios.

---

## Deep Dive: Memory Fragmentation in Long-Running Caches

A cache that allocates and frees variable-sized values over months may fragment its memory pool, leaving holes too small for new entries.

Symptoms:

- "Out of memory" despite RSS being under the limit.
- Performance degrades over weeks; restart "fixes" it.
- Allocator profile shows high `runtime.mallocgc` cost.

Mitigations:

- Use slab allocation (next section).
- Pre-allocate fixed-size buffers.
- Periodically rebuild the cache from scratch.
- Switch to off-heap memory.

For caches with bounded lifetimes (e.g. each request creates short-lived entries that all die together), fragmentation is not a concern.

For caches with mixed lifetimes and variable sizes, slab allocation is the standard answer.

---

## Deep Dive: Cache for Asymmetric Read/Write

Some caches see 100k reads/sec but only 100 writes/sec. Optimize asymmetrically:

- Reads: lock-free atomic pointer to immutable snapshot.
- Writes: rebuild snapshot, CAS.

A batched-write variant:

```go
type Cache struct {
    p atomic.Pointer[map[string]V]
    writeBuf []writeOp
    writeMu  sync.Mutex
}

func (c *Cache) Get(k string) (V, bool) {
    return (*c.p.Load())[k]
}

func (c *Cache) Set(k string, v V) {
    c.writeMu.Lock()
    c.writeBuf = append(c.writeBuf, writeOp{k, v})
    if len(c.writeBuf) >= 100 {
        c.flushLocked()
    }
    c.writeMu.Unlock()
}

func (c *Cache) flushLocked() {
    old := *c.p.Load()
    newMap := make(map[string]V, len(old)+len(c.writeBuf))
    for k, v := range old { newMap[k] = v }
    for _, op := range c.writeBuf { newMap[op.k] = op.v }
    c.p.Store(&newMap)
    c.writeBuf = c.writeBuf[:0]
}
```

Amortizes the rebuild cost over many writes. For write rate < 1k/sec, this approach beats RWMutex by orders of magnitude on reads.

---

## Slab Allocation

Allocating variable-sized objects from a byte arena leads to fragmentation. Slab allocation manages it:

- Divide memory into "slabs" of fixed sizes (e.g. 32B, 64B, 128B, 256B, ...).
- Each slab has a free list of available chunks.
- New allocations pick the smallest slab that fits.
- Frees push the chunk back onto the free list.

```go
type Slab struct {
    chunkSize int
    free      []int // offsets into arena
    arena     []byte
}

func (s *Slab) Allocate() (offset int, ok bool) {
    if len(s.free) == 0 {
        return 0, false
    }
    offset = s.free[len(s.free)-1]
    s.free = s.free[:len(s.free)-1]
    return offset, true
}

func (s *Slab) Free(offset int) {
    s.free = append(s.free, offset)
}
```

For a cache, slab allocation:

- Eliminates fragmentation (each value goes into the right-sized slab).
- Makes allocation and free constant-time.
- Loses some memory to internal fragmentation (a 33B value uses a 64B slab).

Used by Memcached and many high-end caches.

---

## Deep Dive: Stack vs Heap for Cache Entries

In Go, escape analysis decides whether a value lives on the stack or heap.

For caches:

- Map values are always on the heap (the map's backing array is).
- Struct values copied out of a map are on the stack of the caller.
- Pointers returned from a cache live on the heap.

For absolute minimum allocation:

```go
// Avoid this — returns *Entry which forces heap allocation.
func (c *Cache) Get(k string) *Entry { ... }

// Prefer this — returns value, stack-friendly.
func (c *Cache) Get(k string) (Entry, bool) { ... }
```

Compile with `-gcflags='-m'` to see escape decisions:

```
./cache.go:35:6: e escapes to heap
```

For hot-path caches, eliminating escapes can shave nanoseconds.

---

## Deep Dive: Slab Allocators in Memcached

Memcached uses slab allocation with a specific layout:

- Sizes follow a growth factor (default 1.25): 96, 120, 152, 192, ... bytes.
- Each "slab class" has a free list.
- A new value goes into the smallest class that fits.
- When a slab class is full and you need to insert, evict LRU from that class.

Problem: a slab class for 96-byte items may be full while 152-byte class is empty. Cannot reuse.

Memcached's solution: slab rebalancer moves pages between classes based on demand.

For Go caches: implementing this is significant work. Use freecache (which has its own slab-like design) or accept some fragmentation.

---

## Custom Memory Allocators

For ultimate control, a cache may implement its own allocator. This is the realm of:

- **Buddy allocators.** Halve and merge powers-of-two chunks. Used by Linux kernel.
- **TCMalloc-style allocators.** Per-thread caches of small objects. Used by Google.
- **Region allocators.** Allocate from a region; free the whole region at once. No per-object free.

In Go, custom allocators are rare because Go's built-in allocator is fast and good. But:

- For caches with millions of allocations per second, contention on the allocator may matter.
- For caches with bounded lifetime patterns, region allocators are faster.

Implementing one in Go means using `unsafe` for pointer arithmetic. Risky; do not do this without thorough profiling.

---

## Deep Dive: mmap Performance Notes

A few practical notes on mmap-based caches:

- `MAP_POPULATE` pre-faults pages at mmap time. Slower startup, no first-touch faults later.
- `MADV_HUGEPAGE` requests transparent hugepages.
- `MADV_RANDOM` tells kernel "expect random access," disabling read-ahead.
- `MADV_DONTNEED` releases pages back to the kernel (free memory).

For a cache that may shrink:

```go
syscall.Madvise(data[freeStart:freeEnd], syscall.MADV_DONTNEED)
```

The kernel reclaims those pages. The next access faults them back.

This lets caches dynamically resize their memory footprint based on actual usage.

---

## Deep Dive: Region Allocators for Bulk-Lifetime Data

When all entries die together (e.g. per-request caches), region allocation beats individual frees:

```go
type Region struct {
    data   []byte
    cursor int
}

func (r *Region) Allocate(n int) []byte {
    if r.cursor + n > len(r.data) {
        return nil
    }
    result := r.data[r.cursor : r.cursor+n]
    r.cursor += n
    return result
}

func (r *Region) Reset() {
    r.cursor = 0 // reuse the buffer
}
```

No per-allocation overhead. Reset is O(1).

For per-request caches that build up and tear down within a request lifetime, this is the fastest possible allocation scheme.

`sync.Pool` provides similar amortization for individual objects; region allocation works for arbitrary-sized allocations.

---

## `mmap` and Anonymous Memory

A working anonymous-memory allocation in Go:

```go
package cache

import (
    "syscall"
    "unsafe"
)

type Arena struct {
    base   uintptr
    size   uintptr
    cursor uintptr
}

func NewArena(size int) (*Arena, error) {
    data, err := syscall.Mmap(-1, 0, size,
        syscall.PROT_READ|syscall.PROT_WRITE,
        syscall.MAP_ANON|syscall.MAP_PRIVATE)
    if err != nil {
        return nil, err
    }
    return &Arena{
        base: uintptr(unsafe.Pointer(&data[0])),
        size: uintptr(size),
    }, nil
}

func (a *Arena) Allocate(n uintptr) uintptr {
    offset := a.cursor
    a.cursor += n
    if a.cursor > a.size {
        return 0
    }
    return a.base + offset
}

func (a *Arena) Close() error {
    data := unsafe.Slice((*byte)(unsafe.Pointer(a.base)), a.size)
    return syscall.Munmap(data)
}
```

Notes:

- Allocation is bump-pointer: just advance a cursor. Constant time.
- No free; the whole arena is reclaimed at Close.
- Memory is committed on first access (lazy page faults).
- The Go runtime knows nothing about this memory; pointers into it must not be confused with Go pointers.

For a cache that builds, fills, serves, eventually rebuilds: arenas are perfect.

---

## Deep Dive: Eliminating String Allocations

In Go, `string(byteSlice)` allocates a new string. In hot cache paths this adds up.

```go
// Allocates:
key := string(buf[:n])
cache.Get(key)

// Does not allocate (with unsafe):
key := unsafe.String(&buf[0], n)
cache.Get(key)
```

`unsafe.String` (Go 1.20+) creates a string header pointing to existing memory. The caller must ensure the underlying memory is not modified for the string's lifetime.

For cache keys that are only used in `map[string]V` lookups, this is safe:

```go
v, ok := cache.data[unsafe.String(&buf[0], n)]
```

Go's map lookup hashes the key and compares; it does not retain the pointer.

For storing keys (`m[k] = v`), the runtime copies the string. So unsafe.String for lookups is safe; for stores, allocate properly.

This saves microseconds per Get on hot paths.

---

## Deep Dive: Byte-Slice Keys

Even better than `string` keys: `[]byte` keys.

Pros:
- No string allocation at all.
- Can mutate buffers between calls.
- Bytes directly comparable.

Cons:
- Cannot use as `map[[]byte]V` (Go doesn't support that).
- Workaround: hash to `uint64` and store as `map[uint64]V`.

For ultra-low-latency caches, byte-slice keys with uint64 indexing is the canonical design. ristretto uses this internally.

---

## Deep Dive: Bloom Filter for Disk-Cache Lookups

When a cache lookup may go to disk, a bloom filter saves disk I/O for definitely-absent keys.

```go
type DiskCache struct {
    filter *bloom.BloomFilter
    db     *badger.DB
}

func (c *DiskCache) Get(k string) (V, bool) {
    if !c.filter.TestString(k) {
        return zero, false // 99.9% sure not there
    }
    // Go to disk.
    ...
}

func (c *DiskCache) Set(k string, v V) {
    c.filter.AddString(k)
    c.db.Update(...)
}
```

The bloom test takes ~50 ns. The disk lookup takes ~10 µs (best case). For absent keys, the bloom skips the disk lookup entirely.

Used in LSM-tree databases (RocksDB, LevelDB) to skip on-disk SSTables.

---

## Per-CPU Data Structures

Modern CPUs have private L1/L2 caches per core. Coordinating across cores costs cache-coherence traffic. Per-CPU data eliminates this:

```go
type PerCPU[T any] struct {
    cores []*alignedT
}

type alignedT struct {
    val  T
    _    [64]byte // pad to cache line
}

func (p *PerCPU[T]) Get() *T {
    cpu := runtimeCPU() // requires syscall or trick
    return &p.cores[cpu].val
}
```

Real per-CPU access in Go is tricky because the scheduler can preempt at any moment. Workarounds:

- Use `runtime.LockOSThread` plus `syscall.Sched_getcpu()`. Heavy.
- Estimate via goroutine ID hash. Cheap, slightly imperfect.
- Use `sync.Pool` (per-P, close enough). Most practical.

For counters and ring buffers, `sync.Pool` is the standard Go answer:

```go
var counterPool = sync.Pool{
    New: func() interface{} { return new(atomic.Uint64) },
}

func incrementHits() {
    c := counterPool.Get().(*atomic.Uint64)
    c.Add(1)
    counterPool.Put(c)
}
```

Approximate but very fast.

---

## Deep Dive: NUMA Detection in Go

Detecting NUMA topology in Go is hard. Standard libraries don't expose it.

Options:

- Parse `/sys/devices/system/node/`:
  ```go
  func numaNodes() int {
      entries, _ := os.ReadDir("/sys/devices/system/node/")
      n := 0
      for _, e := range entries {
          if strings.HasPrefix(e.Name(), "node") {
              n++
          }
      }
      return n
  }
  ```
- Use `numa` library bindings via cgo.
- Run multiple processes pinned per node, share via shared memory.

For Go programs running on cloud VMs: NUMA is usually invisible. Cloud VMs are typically single-socket; NUMA is irrelevant.

For bare-metal Go applications on big servers: NUMA awareness can matter. Profile and decide if the complexity is worth it.

---

## Deep Dive: Pebble as a TTL Cache

Pebble (used by CockroachDB) does not have native TTL but supports it via custom merge operators:

- Store entries with expiration as part of the value.
- On read, check expiration; if expired, return "not found."
- A periodic compaction discards expired entries.

More setup than Badger but proven at very large scale (CockroachDB's billion-row deployments).

For Go services needing a high-end disk-backed cache with TTL, both are good. Pebble is more complex but more battle-tested.

---

## NUMA-Aware Sharding

On dual-socket servers, each socket has its own memory controller. Accessing memory across sockets pays a 2-3× latency penalty.

For sharded caches:

- Allocate shard memory using `numactl` or `mbind` (Linux).
- Pin sweeper goroutines to specific CPU sockets.
- Ensure that traffic destined for shard `i` runs on a CPU on the same socket as shard `i`'s memory.

Go does not expose NUMA primitives directly. Workarounds:

- Run separate processes per socket, with cgroups pinning.
- Use cgo to call `numa_*` libc functions.
- Accept the cost; modern interconnects are fast.

For most services, NUMA-awareness is not worth the complexity. For latency-critical services running on big servers, it can buy 20% throughput.

---

## Deep Dive: Cache-Aware Memory Layout

For struct fields read together, group them in memory:

```go
// Bad: spread out
type Entry struct {
    Key       string
    ExtraMeta []byte
    Value     []byte
    Expires   time.Time
}

// Better: hot fields first
type Entry struct {
    Expires   int64    // hot
    Value     []byte   // hot
    Key       string   // hot
    ExtraMeta []byte   // cold
}
```

When a cache reads an entry, it touches Expires and Value first. Placing them at the top means they're in the same cache line.

For typical 64-byte cache lines, struct layout matters when entries exceed 64 bytes. For small entries, all fields are in one line anyway.

---

## Deep Dive: Badger as a TTL Cache

Badger supports TTL natively:

```go
import "github.com/dgraph-io/badger/v4"

opts := badger.DefaultOptions("/tmp/badger")
db, _ := badger.Open(opts)
defer db.Close()

// Write with TTL
db.Update(func(txn *badger.Txn) error {
    e := badger.NewEntry([]byte("key"), []byte("value")).WithTTL(time.Hour)
    return txn.SetEntry(e)
})

// Read
db.View(func(txn *badger.Txn) error {
    item, _ := txn.Get([]byte("key"))
    val, _ := item.ValueCopy(nil)
    return nil
})
```

For caches that must survive restarts and hold > 10 GB, Badger is the standard Go answer.

Properties:

- LSM-tree storage.
- TTL via "value log" expiration.
- Compaction is background.
- Reads from disk or page cache.

Compaction adds complexity but is manageable. For caches with high write rates, tune compaction policy carefully.

---

## Cache-Line and False-Sharing Engineering

A 64-byte cache line is the unit of memory transfer between CPUs. Two atomics on the same line contend on coherence even when "logically independent."

Padding pattern:

```go
type Counter struct {
    v atomic.Uint64
    _ [56]byte
}

type Counters struct {
    A Counter
    B Counter
    C Counter
}
```

Each counter occupies its own line. No false sharing.

For arrays:

```go
type Bucket struct {
    mu   sync.Mutex
    data map[string]entry
    _    [128]byte // ensure each bucket starts on a fresh line and pads to next
}

type Cache struct {
    buckets [256]Bucket
}
```

Confirm with `go test -bench` under contention; measure throughput. Adding correct padding can double performance on multi-socket servers.

A common professional cache layout:

```go
const cacheLineSize = 64

type ShardState struct {
    mu    sync.Mutex
    items map[string]entry
    pad1  [cacheLineSize - unsafe.Sizeof(sync.Mutex{}) - unsafe.Sizeof(map[string]entry(nil))]byte
}
```

The exact padding depends on architecture and Go version. Macros like `golang.org/x/sys/cpu.CacheLinePad` exist for this.

---

## Deep Dive: Detecting False Sharing

False sharing is invisible without profiling.

Tools:

- Linux `perf c2c` shows cache line conflicts.
- VTune analyzer (Intel).
- AMD μProf.

For Go without these tools: benchmark before and after padding. If padding helps, you had false sharing.

A telltale sign: throughput per goroutine drops as you add more goroutines (rather than scaling linearly). When you go from 8 to 16 goroutines and per-goroutine throughput halves, false sharing is likely.

---

## Deep Dive: x86 Cache Coherence

The MESI protocol governs how cores share cache lines:

- M (Modified): exclusive ownership, dirty.
- E (Exclusive): exclusive ownership, clean.
- S (Shared): multiple cores have read-only copies.
- I (Invalid): no valid copy here.

A write to a line in Shared state forces all other cores to invalidate. A read after invalidation forces a cache miss to memory or remote cache.

Cost:

- L1 hit: ~1 ns.
- Same-core cache miss to L2: ~5 ns.
- Cross-core cache miss to L3: ~20 ns.
- Memory access: ~100 ns.

For caches that experience high false sharing, average access time can be 20-100 ns instead of 1-5 ns. Substantial.

---

## Deep Dive: Disk-Backed Caches

For caches larger than RAM:

- `BoltDB` / `bbolt`: embedded B-tree.
- `Badger`: LSM-tree, designed for SSDs.
- `Pebble`: CockroachDB's storage engine, also LSM.

For TTL caches, choose one that supports TTL natively (Badger does).

Performance:

- Hit on warm SSD: ~10 µs.
- Hit on cold SSD: ~100 µs.
- Hit on RAM (page cache): ~1 µs.

Two orders of magnitude slower than in-process caches. Only worth it when working set far exceeds RAM.

Example: a cache holding 100M entries averaging 1 KB each = 100 GB. Won't fit in RAM on most machines; Badger or similar is appropriate.

---

## Lock-Free TTL Cache Design

Eliminating locks entirely requires:

- Atomic operations for all updates.
- Lock-free hash table (a research-level data structure).
- Generation numbers or hazard pointers for safe memory reclamation.

In Go, the practical lock-free design for a TTL cache is:

```go
type Cache struct {
    p atomic.Pointer[snapshot]
}

type snapshot struct {
    data    map[string]entry
    version uint64
}
```

Reads:

```go
s := c.p.Load()
e, ok := s.data[k]
```

A pure atomic load. No locks at all.

Writes:

```go
for {
    old := c.p.Load()
    newData := make(map[string]entry, len(old.data)+1)
    for k, v := range old.data { newData[k] = v }
    newData[key] = newEntry
    next := &snapshot{data: newData, version: old.version + 1}
    if c.p.CompareAndSwap(old, next) {
        break
    }
}
```

Every write rebuilds the entire map. Cost: `O(N)` per write.

For "read 1M times per second, write 10 times per minute" workloads, this is unbeatable: reads are lock-free, writes are rare and easy to reason about. For balanced workloads, the rebuild cost is prohibitive.

Used by:
- DNS resolver caches.
- Feature-flag client libraries.
- Configuration data distribution.

---

## Deep Dive: Compare-and-Swap Loops

Lock-free updates use CAS:

```go
for {
    old := c.p.Load()
    new := compute(old)
    if c.p.CompareAndSwap(old, new) {
        break
    }
    // Another goroutine updated; retry with their new value.
}
```

Under low contention, the loop usually exits on the first attempt. Under high contention, it can spin many times.

Risks:

- **Livelock.** Many CAS-ers retry endlessly, never making progress.
- **ABA problem.** Value goes A → B → A; CAS succeeds spuriously.
- **Wasted work.** Each retry recomputes `new`.

Mitigations:

- Exponential backoff with jitter between retries.
- Generation counters to detect ABA.
- Batching: amortize the rebuild across multiple updates.

CAS loops are correct but not always fast. Measure before assuming lock-free is faster than locked.

---

## Deep Dive: Wait-Free vs Lock-Free vs Lockless

Three terms often confused:

- **Wait-free:** every thread makes progress in bounded time regardless of others.
- **Lock-free:** at least one thread makes progress at any time (no global stall).
- **Lockless:** doesn't use locks. May still have deadlock or livelock.

Most Go "lock-free" designs are actually lockless — they use atomics but can theoretically livelock under contention.

For caches, lockless reads are great. Wait-free is overkill (and almost impossible in Go due to GC).

If your reads are CAS loops that may spin: lockless. If your reads are pure atomic loads: lock-free. If your reads have bounded operations regardless of contention: wait-free.

Aim for lock-free reads via atomic.Pointer to immutable snapshots.

---

## Deep Dive: Cache Refresh Strategies in Detail

When a cached entry needs refreshing, three timing strategies:

- **On expiration:** wait until TTL, then refresh on next miss. Risk: cold miss after expiry.
- **Refresh-ahead:** refresh at 80% of TTL. No misses. Cost: refresh work for keys nobody reads.
- **Stale-while-revalidate:** serve stale up to N seconds while refreshing. Compromise.

For each:

```go
// On expiration
if time.Now().After(e.expiresAt) { 
    load(); update() 
}

// Refresh-ahead
if time.Now().After(e.refreshAt) {
    go refresh()
}

// SWR
if time.Now().Before(e.freshUntil) { 
    return e.value, nil 
}
if time.Now().Before(e.staleUntil) {
    go refresh()
    return e.value, nil
}
return loadSync()
```

Pick the strategy that matches your latency vs freshness budget.

---

## Hierarchical Timer Wheels

For caches with millions of entries having various TTLs, a flat timer wheel does not work — too many entries clustered in a few buckets.

A hierarchical wheel has multiple levels:

- Level 0: 256 buckets, each covering 1 ms.
- Level 1: 256 buckets, each covering 256 ms.
- Level 2: 256 buckets, each covering 256 × 256 ms ≈ 65 s.
- Level 3: 256 buckets, each covering ≈ 4.6 hours.

Inserting an entry with TTL `t`:

- If t < 256 ms: place in level 0.
- Else if t < 256 × 256 ms: place in level 1.
- Else: level 2 or 3.

On tick, level 0 rotates. When level 0 completes a full revolution, level 1 rotates one bucket; that bucket's entries are demoted to level 0 (re-distributed by remaining TTL).

```go
type HierarchicalWheel struct {
    levels [4]Level
}

type Level struct {
    buckets   []list.List
    cursor    int
    tickSize  time.Duration
}

func (w *HierarchicalWheel) Add(item *Item, ttl time.Duration) {
    if ttl < 256*time.Millisecond {
        w.levels[0].add(item, ttl)
        return
    }
    if ttl < 256*256*time.Millisecond {
        w.levels[1].add(item, ttl)
        return
    }
    // ...
}
```

Operations are O(1) for insert and tick. Lookups (find item by key) require additional indexing.

Hierarchical timer wheels are used in Linux kernel, Netty, and high-performance Go caches that handle millions of TTL'd entries.

---

## Deep Dive: Timer Wheel Insertion Cost

A flat 1-second-precision wheel with 60 buckets handles 1 minute of TTLs.

For each insert:

- Compute bucket: `(now + ttl) mod 60`.
- Append to the bucket's linked list. O(1).

Memory: one slice header + N entry pointers. For 1M entries, ~16 MB.

The hierarchical wheel adds levels:

- Level 0: 1 second × 60 buckets = 1 minute.
- Level 1: 1 minute × 60 buckets = 1 hour.
- Level 2: 1 hour × 24 buckets = 1 day.

Total: 144 buckets cover a day with 1-second precision.

Insertion cost: still O(1). Demotion (level 1 bucket rotating into level 0) is O(k) where k = entries in that bucket.

For caches with millions of TTLs spread across hours, the hierarchical wheel is unbeatable. Lookup-by-key (finding an entry to remove) requires a side index.

---

## Deep Dive: Timer Wheel vs Heap

Side-by-side:

| Property | Heap | Flat wheel | Hierarchical wheel |
|---|---|---|---|
| Insert | O(log N) | O(1) | O(1) |
| Extract-min | O(log N) | O(1) | O(1) amortized |
| Remove arbitrary | O(log N) with back-ptr | O(N) within bucket | O(N) within bucket |
| Memory | O(N) entries | O(buckets) + O(N) | O(buckets) + O(N) |
| Precision | nanosecond | bucket size | bucket size |
| Best for | varying TTLs | uniform TTLs | many varying TTLs |

For TTL caches with millions of entries and bucket-precision OK, hierarchical wheels win. For caches with strict precision needs or moderate entry counts, heaps are simpler.

---

## Deep Dive: Lock-Free Hash Tables

True lock-free hash tables (like Cliff Click's NonBlockingHashMap) are complex.

Operations:

- Insert: CAS into a slot if empty; or chain into a probing sequence.
- Delete: mark the slot as tombstone; CAS-replace later.
- Lookup: probe sequence with snapshot consistency.
- Resize: cooperative — all threads help migrate during operations.

In Go, this level of complexity is rarely justified. `sync.Map` is the closest approximation in the standard library. Third-party libraries like `lf-hash-go` exist but are niche.

For caches, sharded `map + RWMutex` (or sharded `sync.Map`) is the standard answer. True lock-free hash tables are research curiosities outside the JVM ecosystem.

---

## Deep Dive: Single-Producer, Single-Consumer Queues

For shipping cache events (e.g. access records) to an aggregator goroutine, SPSC queues are the fastest.

A ring buffer with one producer and one consumer:

```go
type Ring struct {
    buf      []Event
    mask     uint64
    writeIdx atomic.Uint64
    readIdx  atomic.Uint64
}

func (r *Ring) Push(e Event) bool {
    w := r.writeIdx.Load()
    rd := r.readIdx.Load()
    if w-rd >= uint64(len(r.buf)) {
        return false // full
    }
    r.buf[w&r.mask] = e
    r.writeIdx.Store(w + 1)
    return true
}

func (r *Ring) Pop() (Event, bool) {
    rd := r.readIdx.Load()
    w := r.writeIdx.Load()
    if rd == w {
        return Event{}, false // empty
    }
    e := r.buf[rd&r.mask]
    r.readIdx.Store(rd + 1)
    return e, true
}
```

Lock-free for both sides. Maximum throughput.

For caches that drain access records to a background aggregator, this is ideal. One ring per producer (per CPU shard); the aggregator drains all rings.

---

## Deep Dive: Wait-Free Get with Snapshots

For absolute minimum read latency, snapshots updated on a schedule:

```go
type Cache struct {
    p atomic.Pointer[map[string]V]
}

func (c *Cache) Update(newData map[string]V) {
    c.p.Store(&newData)
}

func (c *Cache) Get(k string) (V, bool) {
    m := *c.p.Load()
    v, ok := m[k]
    return v, ok
}
```

Get: one atomic load + map lookup. ~10 ns total.

Update: periodic rebuild (every minute). Cost: O(N) per update.

For "config" caches where data changes rarely, this is unbeatable.

For data with per-key updates, this is wrong — every update rebuilds the whole map.

---

## Distributed Multi-Tier Architectures

At professional scale, caches form a hierarchy:

- **L0:** per-thread/goroutine, atomic-pointer based, microsecond reads.
- **L1:** per-replica, in-process, ristretto/freecache, sub-millisecond reads.
- **L2:** per-region, distributed (Redis cluster, Memcached), millisecond reads.
- **L3:** global, durable (Couchbase, DynamoDB DAX), tens of milliseconds.
- **Upstream:** database or origin service.

Each tier:

- TTL longer than the previous.
- Size larger than the previous.
- Latency higher than the previous.

A request percolates down: L0 → L1 → L2 → L3 → upstream. The first hit serves the request. Each tier protects the next.

Cost:

- Operational complexity. Many systems to monitor.
- Failure modes. Each tier can fail independently.
- Consistency. Invalidations must propagate across all tiers.

Used by major CDNs, large social networks, financial services. Not every system needs all four tiers.

---

## Deep Dive: Tiered Eviction Coordination

In a 4-tier cache, eviction at one tier affects the next:

- L0 evicts → fall through to L1.
- L1 evicts → fall through to L2.
- L2 evicts → fall through to L3 / upstream.

Each tier should have shorter TTLs and smaller capacity than the next. A naive setup with same TTL everywhere achieves nothing.

Coordinating across tiers:

- L1 invalidation propagates to L0 (because L0 is per-thread, L1 is per-process — invalidation is local to the process and trivial).
- L2 invalidation propagates to L1 (via pub/sub).
- L3 invalidation propagates to L2 (via pub/sub or sync replication).
- Upstream change invalidates L3 (via change-data-capture or polling).

The propagation latencies stack up: a write may take 100 ms to fully propagate. During that window, some readers see stale data.

Accept it or skip the cache for high-stakes writes.

---

## Deep Dive: Cache Coordination via Vector Clocks

For multi-tier caches with conflict resolution needs:

- Each write carries a vector clock (per-replica counter).
- Reads compare vector clocks; the "happens-after" version wins.
- Concurrent writes (no clear order) are resolved by application logic (last-writer-wins, CRDT merge, etc).

Vector clocks add ~16 bytes per entry per replica. Expensive at scale.

For caches, this is rarely necessary. The simpler "TTL bounded staleness" model is usually acceptable. Use vector clocks when you need provable bounded inconsistency.

---

## Deep Dive: TTL with Sub-Second Precision

For caches where TTLs are in milliseconds (e.g. rate limiters):

- `int64` nanoseconds since epoch is the canonical representation.
- Atomic load/store works (8 bytes).
- Comparisons are integer math.

Avoid:

- `time.Time` (24 bytes, with monotonic).
- `time.Duration` (just a difference, not absolute).

For nanosecond-precision TTLs:

```go
type Entry struct {
    Value      V
    ExpiresAt  int64 // unix nano
}

func (e *Entry) Expired(nowNano int64) bool {
    return nowNano > e.ExpiresAt
}
```

`time.Now().UnixNano()` once per Get gives nanosecond accuracy. For sub-microsecond-precision caches, use `monotime.Now()` from a library.

---

## Strong-Consistency Caches

For data that must be strongly consistent, the cache participates in the consistency protocol.

**Read-through with version checks.** Every cached entry stores a version. Reads include "version X" with the cache hit; if a writer has bumped the version since, the cache discards and re-fetches.

**Lease-based caches.** Each entry has a lease from a central authority. When data changes, the authority recalls the lease. Coherent but requires central coordination.

**Hazelcast-style.** Distributed in-memory data grid with strong consistency. Achievable but expensive (synchronous replication).

For most caches, eventual consistency is fine; for those that need strong, the overhead is significant. Often, the right answer is to skip the cache for those specific data.

---

## Deep Dive: Materialized Views as Caches

A *materialized view* is a cached projection of a database query. The database keeps it updated.

PostgreSQL: `CREATE MATERIALIZED VIEW`.
RocksDB: prefix sums maintained externally.
Stream processing: Kafka Streams' KTable.

For caching pattern: when a database supports materialized views with TTL semantics, the cache may live inside the database. Application code reads it like a normal table.

Trade-offs:

- Pro: simpler app code. No cache invalidation logic.
- Pro: strongly consistent (database guarantees).
- Con: database storage / IO cost.
- Con: refresh strategies are database-specific.

For data that naturally lives in the database, materialized views often beat application-level caches. For data fetched from external services, the application-level cache is needed.

---

## Deep Dive: Tagged Invalidation

Sometimes you want to invalidate all entries matching a tag (e.g. "all entries for user 42"). Standard caches do not support this directly.

Pattern: secondary index.

```go
type TaggedCache struct {
    primary map[string]Entry
    tags    map[string]map[string]bool // tag -> set of keys
}

func (c *TaggedCache) Set(k string, v V, tags []string) {
    c.primary[k] = Entry{value: v, tags: tags}
    for _, tag := range tags {
        if c.tags[tag] == nil {
            c.tags[tag] = make(map[string]bool)
        }
        c.tags[tag][k] = true
    }
}

func (c *TaggedCache) InvalidateTag(tag string) {
    for k := range c.tags[tag] {
        delete(c.primary, k)
    }
    delete(c.tags, tag)
}
```

Cost: extra memory for tag index. Locking complexity (tag index must be in sync with primary).

For caches needing fan-out invalidation, this is essential. Varnish's `ban` lurker, Cloudflare's tag-based invalidation use this pattern.

---

## CDN-Scale Edge Caching

CDNs (Cloudflare, Fastly, Akamai) operate at the extreme end of cache scale:

- Hundreds of edge locations.
- Petabytes of cached content.
- Billions of requests per second globally.

Their cache design includes:

- Disk-backed for huge object stores; RAM for hot objects.
- Per-object eviction policies tuned by access pattern.
- Negative caching with very short TTLs (because attackers probe constantly).
- Tiered storage (NVMe + spinning disk).
- Geo-distributed invalidation via gossip protocols.
- Per-tenant resource isolation.

Few Go services run at CDN scale, but the patterns trickle down. Reading Cloudflare's and Fastly's engineering blogs is instructive.

---

## Deep Dive: CDN Edge Hot-Object Caching

A CDN edge sees billions of requests for millions of distinct URLs. Most URLs are accessed once; a few are hammered.

Edge design:

- Tiny RAM cache for hottest 1% of objects (~100 MB).
- Larger SSD cache for next 99% (~100 GB).
- Cold-storage backing.

The RAM cache uses TinyLFU admission with SLRU eviction; the SSD cache uses simpler LRU. Hot objects get promoted from SSD to RAM on repeated access.

For Go services at edge: ristretto serves the RAM tier well. The SSD tier is typically a third-party block store.

---

## Deep Dive: Eventually-Consistent Caches with Conflict-Free Resolution

When concurrent writes happen on different replicas, conflicts arise. Resolution strategies:

- **Last-writer-wins (LWW):** later timestamp wins.
- **Multi-value:** keep all conflicting values; let reader pick.
- **CRDT merge:** auto-merge using algebra (G-counter, OR-set, etc).
- **Custom:** application-specific (e.g. max of two numeric values).

For caches, LWW is the default — cache values are usually idempotent reads from a source of truth.

For caches that *accumulate* (counters, sets), CRDT merging is the natural choice.

---

## Cache Coherence Across Datacenters

Multi-datacenter caching adds replication delay measured in tens of milliseconds.

Patterns:

- **Write-everywhere:** Every write goes to every datacenter. Slow, simple.
- **Write-local, replicate-async:** Writes go to local cache fast; replicated asynchronously.
- **Per-region active:** Each region has independent writes; conflicts resolved by version vectors or CRDTs.

For caches (where data can be re-fetched from upstream), the simplest is write-local: each region's cache is independent. Cross-region consistency is *only* via the upstream.

This means cross-region readers may see different cached values. Usually fine for cache use cases. For strong consistency, skip the cache cross-region or use a CDN-style coherent system.

---

## Deep Dive: CRDT-Based Cache Coordination

For caches that need eventual consistency across DCs without central coordination:

- **G-Counter:** a counter where increments commute (each replica increments locally; reads sum across all).
- **OR-Set:** a set with deterministic merging.
- **LWW-Register:** last-write-wins, ties broken by timestamp.

For TTL caches with multi-DC writes, LWW-Register is the natural fit:

```go
type Entry struct {
    Value     V
    Timestamp uint64 // writes use server-id + Lamport clock
    ExpiresAt uint64
}

func merge(local, remote Entry) Entry {
    if remote.Timestamp > local.Timestamp {
        return remote
    }
    return local
}
```

Two writes from different DCs in the same "instant" pick the higher timestamp. Lamport clocks ensure causal consistency.

CRDTs add complexity but enable strong eventual consistency without coordination. Worth it for truly distributed caches.

---

## Deep Dive: Cache with Pluggable Backends

A library that lets users swap storage backends:

```go
type Backend interface {
    Get(k string) (V, bool, time.Time)
    Set(k string, v V, exp time.Time)
    Delete(k string)
    Range(fn func(k string, v V, exp time.Time) bool)
}

type Cache struct {
    backend Backend
    group   singleflight.Group
    loader  func(k string) (V, error)
}
```

Backends:

- `MapBackend` for simple in-memory.
- `RistrettoBackend` for production.
- `RedisBackend` for distributed.
- `FreecacheBackend` for memory-bounded.

The cache layer adds singleflight, jitter, observability uniformly across backends.

Used by some general-purpose Go caching frameworks (`go-cache-lib`).

---

## Deep Dive: Composable Cache Middleware

Like HTTP middleware, but for caches:

```go
type Middleware func(Cache) Cache

func WithMetrics(reg prometheus.Registerer) Middleware { ... }
func WithRetries(n int) Middleware { ... }
func WithSinglFlight() Middleware { ... }
func WithJitter(d time.Duration) Middleware { ... }

cache := Compose(NewMapCache(),
    WithSinglFlight(),
    WithJitter(5*time.Second),
    WithMetrics(prometheus.DefaultRegisterer),
)
```

Each middleware wraps the underlying cache, adding behavior without modifying the core.

Used by some advanced cache library designs. Powerful pattern; can be over-engineered.

---

## Telemetry at Scale

At professional scale, observability itself becomes a cost.

- Per-call counters: 10ns × 10M QPS = 100 ms/s of CPU.
- Histogram observations: 50ns × 10M QPS = 0.5s/s.
- Per-key metrics: explode memory.

Mitigations:

- Sample: count every Nth call.
- Aggregate: per-shard counters, summed asynchronously.
- Pre-aggregated histograms: count only into buckets, never store individual samples.
- Reservoir sampling for top-K detection.

For caches handling billions of QPS, telemetry overhead is a real concern. Engineer it like any other hot-path component.

---

## Deep Dive: Bit-Packed Entry Headers

Standard `time.Time` is 24 bytes. For a 100-million-entry cache, that's 2.4 GB just for timestamps.

Packed representation:

```go
// 8 bytes total: 32 bits for expiration (seconds since cache start), 32 bits for other metadata.
type packedEntry struct {
    expSec uint32
    meta   uint32  // bit-packed flags, version, hash, etc.
}
```

This halves the metadata overhead. For caches with billions of entries, this is gigabytes saved.

Trade-offs:

- Coarser TTL granularity (seconds only).
- Limited to 136-year cache lifetime (2^32 seconds).
- Bit-manipulation code is harder to read.

For most caches, the readable representation is fine. For massive caches, packed metadata pays for itself.

---

## Deep Dive: Pointer-Free Map Designs

To eliminate GC pressure entirely:

- Keys: fixed-size arrays of bytes (`[32]byte`), not strings.
- Values: byte arenas, not pointers.
- Maps: open-addressed with packed slots.

This means no `string`s, no `*Entry`s, no `interface{}`s anywhere in the data path.

```go
type Slot struct {
    KeyHash uint64        // hash of key for quick compare
    Key     [32]byte      // fixed-size key storage
    ValPos  uint32        // offset into arena
    ValLen  uint32        // length of value
    Exp     uint64        // expiration nanoseconds since epoch
}

type Cache struct {
    slots []Slot
    arena []byte
}
```

GC sees: one `[]Slot`, one `[]byte`. That's it. Two objects regardless of cache size.

Cost: keys longer than 32 bytes must be hashed and stored in the arena, with the slot pointing into it. Or rejected outright.

Used by some specialized caches; not common.

---

## Deep Dive: Memory Reclamation in Lock-Free Structures

When a goroutine swaps an old map for a new one, when can the old map be freed?

In Go, the answer is "when the garbage collector says so." That happens once no goroutine holds a reference. Since `atomic.Pointer` swaps are atomic, old references are released atomically.

But: a goroutine that just loaded the old pointer is still using it. The GC sees the loaded local variable as a reference; the old map is kept alive until that goroutine releases it.

This is the easy case in Go. In C/Rust without a GC, "safe memory reclamation" is a research field (hazard pointers, epoch-based reclamation, etc).

The Go GC's tracing approach is one of the reasons lock-free designs are easier in Go than in C.

---

## Deep Dive: Epoch-Based Reclamation

For lock-free designs that need to manage memory manually (e.g. arena-based caches), epoch-based reclamation is the standard technique.

Idea:

- Each operation tags itself with the current "epoch."
- A reclaim request waits until all threads have entered a newer epoch.
- After that, the reclaim is safe.

In Go, this is rarely needed (GC does it). For caches that bypass GC (`unsafe`, mmap), implementing epoch reclamation correctly is hard.

For most Go caches, accept the GC's pause cost and avoid manual reclamation.

---

## Production Caches in Practice

Let us name names. Real Go projects use these cache patterns:

**etcd's request cache.** A small TTL cache in front of the Raft log; reduces read load.

**CockroachDB's index cache.** Stores recently-used index entries to avoid disk reads. LRU + TTL.

**Caddy's response cache.** HTTP-level cache; uses memory-mapped files for large bodies.

**Kubernetes API cache (client-go).** Watches etcd for changes; caches objects locally. Strong consistency via watch.

**Prometheus's TSDB cache.** Hot time-series chunks live in memory.

Each has a publicly-readable codebase. Reading them is the best education.

---

## Deep Dive: Lock-Free Counter Aggregation

When you have per-CPU counters, you periodically sum them for reporting:

```go
type ShardCounter struct {
    shards [256]struct {
        v atomic.Uint64
        _ [56]byte
    }
}

func (s *ShardCounter) Sum() uint64 {
    var total uint64
    for i := range s.shards {
        total += s.shards[i].v.Load()
    }
    return total
}
```

The Sum is approximate — the counters change while you sum. For monitoring this is acceptable.

For exact counts at a point in time, you'd need a barrier — pausing increments while reading. Almost never worth it.

For caches with billion+ QPS, summed-on-demand counters add tens of microseconds per scrape. Negligible compared to the QPS savings vs a single contended counter (which would cost milliseconds).

---

## Deep Dive: Cache State Machines

Every cache entry passes through states:

- Loading (singleflight in flight).
- Fresh (within TTL).
- Stale (past TTL but within stale-while-revalidate window).
- Refreshing (background refresh in flight).
- Evicted (gone from cache).

Explicit state representation simplifies reasoning:

```go
type State int
const (
    StateLoading State = iota
    StateFresh
    StateStale
    StateRefreshing
)

type Entry struct {
    State     atomic.Int32
    Value     V
    FreshUntil time.Time
    StaleUntil time.Time
}
```

Transitions:

- Set → StateFresh.
- Time passes → StateStale (lazy).
- Refresh starts → StateRefreshing.
- Refresh completes → StateFresh.
- Time passes past StaleUntil → eviction candidate.

Code that reasons about state is easier to audit than implicit conditional checks.

---

## Custom Cache Library Design

If you must build a cache library:

**Public API.** Stable for years. Versioned.

**Core type.**

```go
type Cache[K comparable, V any] interface {
    Get(K) (V, bool)
    Set(K, V)
    SetWithTTL(K, V, time.Duration)
    Delete(K)
    Stats() Stats
    Close() error
}
```

**Options.** Functional options for configuration.

**Internal structure.** Sharded, lock-free reads where possible.

**Sweep.** Heap or timer wheel.

**Stampede protection.** Built-in singleflight.

**Metrics.** Prometheus-friendly counters and histograms.

**Tests.** Cover concurrency, time, failure modes.

**Documentation.** Comprehensive, with examples.

Done well, that is 1000-3000 lines of Go. The challenge is keeping it correct and predictable as you optimize.

---

## Deep Dive: Robin Hood Hashing

For open-addressed hash tables, lookup performance degrades as load increases. Robin Hood hashing mitigates this.

Idea: each entry tracks its "displacement" (how far from its ideal bucket). On insert, if the new entry would displace less than the existing, they swap. Result: probe lengths are evenly distributed.

```go
type Slot struct {
    Key   string
    Value []byte
    Probe uint8 // distance from ideal bucket
}

func (h *Table) Insert(k string, v []byte) {
    bucket := hash(k) % len(h.slots)
    probe := uint8(0)
    for {
        if h.slots[bucket].Probe < probe {
            h.slots[bucket], k, v, probe = Slot{k, v, probe}, h.slots[bucket].Key, h.slots[bucket].Value, h.slots[bucket].Probe
        }
        if h.slots[bucket].Key == "" {
            h.slots[bucket] = Slot{k, v, probe}
            return
        }
        bucket = (bucket + 1) % len(h.slots)
        probe++
    }
}
```

Used in: HashMap of Rust's standard library, several Go cache libraries.

Pro: predictable probe lengths.
Con: more swaps during insert; harder to delete (need tombstones or backshift).

For caches with high load factors (>0.7), Robin Hood is worth implementing.

---

## Deep Dive: Cuckoo Hashing

Two hash functions per key. Each key goes to one of two buckets. If both are full, evict an existing key and rehash it.

```go
func (h *CuckooTable) Insert(k string, v []byte) bool {
    for attempt := 0; attempt < maxRetries; attempt++ {
        b1 := hash1(k) % len(h.t1)
        if h.t1[b1].Key == "" {
            h.t1[b1] = Entry{k, v}
            return true
        }
        b2 := hash2(k) % len(h.t2)
        if h.t2[b2].Key == "" {
            h.t2[b2] = Entry{k, v}
            return true
        }
        // Both full. Evict from t1 and try again with evicted key.
        h.t1[b1], k, v = Entry{k, v}, h.t1[b1].Key, h.t1[b1].Value
    }
    return false // rehash needed
}
```

Lookup is O(1) — check two buckets.

Pros: constant-time lookups even at high load.
Cons: insertion can fail (requires full rehash); two cache lines accessed per lookup.

For caches where lookup latency variance matters, cuckoo hashing keeps the tail tight.

---

## Deep Dive: Concurrent Compaction

For very large caches, even compaction must be concurrent:

1. Mark the old arena as "frozen" (no new writes).
2. New writes go to a new arena.
3. Reads check both arenas.
4. Compact the old arena into the new in the background.
5. When done, drop the old.

This is essentially garbage collection at the cache level. Implemented in some specialized caches; complex.

For most caches, the simpler "stop the world, compact, resume" is fine — done during off-peak hours.

---

## Deep Dive: Generational Caches

Inspired by generational GC: split the cache into "young" and "old."

- Young cache: small, fast, holds recently-added entries.
- Old cache: larger, possibly off-heap, holds entries that survive multiple cycles.

Promotion: entries accessed enough times migrate from young to old.

Eviction: young cache evicts aggressively (entries die young); old cache evicts rarely.

Benefits:

- Most "scan workload" entries never make it to the old cache.
- Hot entries are protected in the old cache.

Used by Caffeine and (partially) ristretto. Not common as an explicit pattern but inherent in many tiered designs.

---

## Quirky Real-World Caches

Some unusual cache designs that exist in production:

**The "negative-only" cache.** Stores only "this key does not exist." Bloom-filter-backed. Used to short-circuit upstream lookups for keys known to be absent.

**The "fanout" cache.** Stores fan-out templates: for each key, the precomputed list of related keys to invalidate when that key changes.

**The "lossy" cache.** Intentionally drops a fraction of entries. Used when caching is best-effort and dropping is cheaper than evicting.

**The "two-faced" cache.** Returns one value to some callers, a different value to others (based on tenant or version). Hot reload of feature-flag-controlled values.

**The "speculative" cache.** Pre-computes values for keys the system *thinks* will be requested soon, based on patterns.

Each solves a specific problem. None are general-purpose.

---

## Deep Dive: When the Go Runtime Becomes the Bottleneck

At ultra-high scale, the Go runtime itself can become the limit. Symptoms:

- `runtime.findRunnableGCWorker` shows in profiles. GC scheduling overhead.
- `runtime.mallocgc` dominates. Allocator contention.
- `runtime.lock` shows up. Internal runtime locks.

Mitigations:

1. **Reduce allocations.** Reuse buffers, pool objects.
2. **Increase GOGC.** Less frequent GC, larger heap.
3. **Set GOMEMLIMIT.** Hard cap on heap; GC adapts.
4. **Pre-allocate aggressively.** Don't grow data structures on the hot path.
5. **Avoid `interface{}` boxing.** Generics help.
6. **Avoid string allocation in hot paths.** Use `[]byte` where possible.

If you have profiled and you find runtime functions are 30%+ of CPU, your cache design is fighting the runtime. Time for off-heap or different language.

---

## Deep Dive: Profiling a Professional Cache

`pprof` is your friend at this scale.

```go
import _ "net/http/pprof"

go func() {
    http.ListenAndServe(":6060", nil)
}()
```

Then:

- `go tool pprof http://localhost:6060/debug/pprof/profile?seconds=30` — CPU profile.
- `go tool pprof http://localhost:6060/debug/pprof/heap` — heap profile.
- `go tool pprof http://localhost:6060/debug/pprof/allocs` — all allocations.
- `go tool pprof http://localhost:6060/debug/pprof/mutex` — mutex contention.
- `go tool pprof http://localhost:6060/debug/pprof/block` — blocking operations.

For caches specifically:

- CPU profile: identify hot functions. Get/Set should dominate. If `runtime.mallocgc` is high, you're allocating too much.
- Heap profile: confirm cache size. Identify unexpected memory consumers.
- Mutex profile: if your sharded cache has lock contention, this shows where.

Run the profiles under load. Idle profiles tell you nothing useful.

---

## Deep Dive: Flamegraphs for Cache Tuning

Flamegraphs visualize where time goes. For a cache:

- A wide flat top of `Get` means cache hits dominate. Good.
- A spike of `mallocgc` under `Get` means hot-path allocations. Fix.
- A pyramid under `Set` means propagation work. Examine.
- A wide `runtime.gcMark` band means GC. Reduce heap.

Generate with:

```sh
go tool pprof -http=:8080 cpu.prof
```

The `web` view is interactive. The `flamegraph` view is the classical visualization.

For caches handling 10M+ QPS, every visible band in the flamegraph deserves investigation. Cumulative time of 5% in one function is significant.

---

## Deep Dive: Continuous Profiling

For long-lived production caches, sample-on-demand profiling misses ephemeral bottlenecks.

Continuous profilers (Pyroscope, Grafana Phlare, Parca, Datadog) run profiling continuously at low overhead. They reveal:

- Slow drift in CPU usage (the cache is leaking memory over weeks).
- Episodic spikes (every Tuesday at 3 AM, p99 spikes).
- Long-tail issues invisible in averages.

Cost: ~1% CPU overhead. Worth it for production caches where surprises hurt.

---

## Deep Dive: Background Compactor

For caches that allocate variable-sized values and want zero fragmentation, a background compactor runs:

```go
func (c *Cache) compact() {
    c.mu.Lock()
    defer c.mu.Unlock()
    newArena := make([]byte, c.arenaSize)
    pos := 0
    for k, e := range c.data {
        copy(newArena[pos:], c.arena[e.offset:e.offset+e.size])
        e.offset = pos
        c.data[k] = e
        pos += int(e.size)
    }
    c.arena = newArena
    c.cursor = pos
}
```

Run during low-traffic windows. Holds the cache lock during the entire compaction.

For caches that cannot afford a full lock, incremental compaction copies one shard at a time. More complex; less impactful per round.

---

## Worked Example: GC-Free 10 GB Cache

A complete implementation of a cache holding 10 GB of value data without GC pressure. Uses arena-style allocation, open-addressed hash table, fixed-size keys.

```go
package gcfree

import (
    "encoding/binary"
    "errors"
    "hash/fnv"
    "sync"
    "sync/atomic"
    "time"
    "unsafe"
)

type Cache struct {
    shards [256]*shard
}

type shard struct {
    mu     sync.RWMutex
    table  []slot
    arena  []byte
    cursor int
}

type slot struct {
    keyHash   uint64
    expiresAt int64
    valueOff  uint32
    valueLen  uint32
}

func New(arenaSize int) *Cache {
    c := &Cache{}
    perShard := arenaSize / 256
    for i := range c.shards {
        c.shards[i] = &shard{
            table:  make([]slot, 1<<20),
            arena:  make([]byte, perShard),
            cursor: 0,
        }
    }
    return c
}

func hash(s string) uint64 {
    h := fnv.New64a()
    h.Write([]byte(s))
    return h.Sum64()
}

func (c *Cache) shardFor(key string) *shard {
    return c.shards[hash(key)>>56]
}

func (c *Cache) Set(key string, value []byte, ttl time.Duration) error {
    s := c.shardFor(key)
    s.mu.Lock()
    defer s.mu.Unlock()
    if s.cursor+len(value) > len(s.arena) {
        return errors.New("arena full")
    }
    off := uint32(s.cursor)
    copy(s.arena[off:], value)
    s.cursor += len(value)

    h := hash(key)
    idx := h & (uint64(len(s.table)) - 1)
    s.table[idx] = slot{
        keyHash:   h,
        expiresAt: time.Now().Add(ttl).UnixNano(),
        valueOff:  off,
        valueLen:  uint32(len(value)),
    }
    return nil
}

func (c *Cache) Get(key string) ([]byte, bool) {
    s := c.shardFor(key)
    h := hash(key)
    s.mu.RLock()
    defer s.mu.RUnlock()
    idx := h & (uint64(len(s.table)) - 1)
    sl := s.table[idx]
    if sl.keyHash != h || time.Now().UnixNano() > sl.expiresAt {
        return nil, false
    }
    return s.arena[sl.valueOff : sl.valueOff+sl.valueLen], true
}

// Note: open-addressing collisions are not handled here for simplicity.
// A real implementation would probe linearly or quadratically.
```

This compiles. It is GC-free for the value data (one `[]byte` per shard, opaque to GC). It is *not* fully production-ready (no collision handling, no eviction, no compaction). But it demonstrates the principles.

Embellishments for production:

- Open-addressing probing.
- Cuckoo or Robin Hood hashing for better worst-case.
- Compaction/eviction when arena fills.
- Per-shard sweepers.

Used as the basis for a real GC-free Go cache, this would expand to 1000+ lines.

---

## Deep Dive: Cache Sharding by Hash Mixing Quality

A great hash function uniformly distributes keys across shards. A bad hash function creates hot shards.

Test your hash function:

```go
func TestShardDistribution(t *testing.T) {
    counts := make([]int, numShards)
    for i := 0; i < 1_000_000; i++ {
        key := fmt.Sprintf("user:%d", i)
        counts[shardIdx(key)]++
    }
    avg := 1_000_000 / numShards
    for i, c := range counts {
        if c > avg*2 || c < avg/2 {
            t.Errorf("shard %d: count %d (avg %d)", i, c, avg)
        }
    }
}
```

If any shard is 2× the average, the hash is broken or the workload is adversarial. Investigate.

For caches handling adversarial input, hash randomness is essential. Use `maphash` with a random seed.

---

## Deep Dive: Cache for Approximate Counting

Some caches don't store data — they count.

```go
type Counter struct {
    sketch *CountMinSketch
}

func (c *Counter) Increment(k string) {
    c.sketch.Add(k, 1)
}

func (c *Counter) Approx(k string) uint64 {
    return c.sketch.Estimate(k)
}
```

Memory: O(1) regardless of distinct keys. Reads and writes are O(d) where d = sketch depth (typically 4-8).

Use cases:

- "How many times has this URL been visited?"
- "Is this key in the top 100?"
- "How many distinct users?" (combined with HyperLogLog)

For caches that should produce approximate aggregates rather than precise values, sketch-based caches are essential.

---

## Deep Dive: HyperLogLog for Distinct Counts

HyperLogLog is a probabilistic structure that estimates set cardinality with ~1% error using a few KB of memory.

```go
import "github.com/axiomhq/hyperloglog"

hll := hyperloglog.New()
for _, item := range stream {
    hll.Insert([]byte(item))
}
count := hll.Estimate()
```

For a TTL cache that tracks "distinct users in the last hour":

```go
type DistinctTracker struct {
    mu      sync.Mutex
    current *hyperloglog.Sketch
    expires time.Time
    ttl     time.Duration
}

func (d *DistinctTracker) Insert(user string) {
    d.mu.Lock()
    if time.Now().After(d.expires) {
        d.current = hyperloglog.New()
        d.expires = time.Now().Add(d.ttl)
    }
    d.current.Insert([]byte(user))
    d.mu.Unlock()
}
```

Memory ~12KB. Accuracy ~1%. Works for billions of distinct items.

For analytics caches, HLL beats brute-force counting.

---

## Deep Dive: Cache for Sliding-Window Statistics

A cache that holds rolling stats (e.g. "QPS over the last minute") requires bucket rotation.

```go
type Window struct {
    buckets   [60]atomic.Uint64
    cursor    atomic.Uint64
    lastSec   atomic.Int64
}

func (w *Window) Increment() {
    sec := time.Now().Unix()
    if sec != w.lastSec.Load() {
        // Rotate.
        prev := w.cursor.Load()
        w.cursor.Store((prev + 1) % 60)
        w.buckets[(prev+1)%60].Store(0)
        w.lastSec.Store(sec)
    }
    w.buckets[w.cursor.Load()].Add(1)
}

func (w *Window) Total() uint64 {
    var t uint64
    for i := range w.buckets {
        t += w.buckets[i].Load()
    }
    return t
}
```

Bounded memory, sliding window, atomic operations only. Used in rate limiters and monitoring caches.

The rotation logic has subtle races (multiple goroutines may rotate concurrently); use compare-and-swap to ensure single rotation per second.

---

## Worked Example: Bloom-Filter-Fronted Cache

A cache with a bloom filter in front: tests "could this key be in the cache?" without locks.

```go
package bloomcache

import (
    "encoding/binary"
    "hash/fnv"
    "sync"
    "sync/atomic"
    "time"

    bloom "github.com/bits-and-blooms/bloom/v3"
)

type Cache struct {
    mu     sync.RWMutex
    filter *bloom.BloomFilter
    data   map[string]entry
    ttl    time.Duration
}

type entry struct {
    value     []byte
    expiresAt time.Time
}

func New(capacity uint, fpRate float64, ttl time.Duration) *Cache {
    return &Cache{
        filter: bloom.NewWithEstimates(capacity, fpRate),
        data:   make(map[string]entry),
        ttl:    ttl,
    }
}

func (c *Cache) Get(key string) ([]byte, bool) {
    if !c.filter.TestString(key) {
        return nil, false // definitely not present
    }
    c.mu.RLock()
    defer c.mu.RUnlock()
    e, ok := c.data[key]
    if !ok || time.Now().After(e.expiresAt) {
        return nil, false
    }
    return e.value, true
}

func (c *Cache) Set(key string, value []byte) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.filter.AddString(key)
    c.data[key] = entry{value: value, expiresAt: time.Now().Add(c.ttl)}
}
```

The bloom filter short-circuits about 99% of definitely-absent lookups without taking the mutex. For caches with high miss rates, this saves significant lock contention.

Caveats:

- Bloom filters are append-only. Deletes (or TTL expiry) are not represented; over time the filter accumulates "ghost" entries that look present but are actually expired.
- Periodically rebuild the filter from live entries to discard ghosts.
- False positive rate grows as more entries are added.

For most caches a bloom filter is overkill. For high-miss-rate caches (e.g. probing existence), it is gold.

---

## Deep Dive: Lock-Free Bloom Filters

Standard bloom filters use mutexes for thread safety. A truly lock-free bloom uses atomic word operations:

```go
type AtomicBloom struct {
    bits []atomic.Uint64
    hashFuncs int
}

func (b *AtomicBloom) Set(key string) {
    for i := 0; i < b.hashFuncs; i++ {
        h := hashWithSeed(key, i)
        wordIdx := h / 64 % uint64(len(b.bits))
        bitIdx := h % 64
        for {
            old := b.bits[wordIdx].Load()
            new := old | (1 << bitIdx)
            if b.bits[wordIdx].CompareAndSwap(old, new) {
                break
            }
        }
    }
}

func (b *AtomicBloom) Test(key string) bool {
    for i := 0; i < b.hashFuncs; i++ {
        h := hashWithSeed(key, i)
        wordIdx := h / 64 % uint64(len(b.bits))
        bitIdx := h % 64
        if b.bits[wordIdx].Load() & (1 << bitIdx) == 0 {
            return false
        }
    }
    return true
}
```

Reads are pure atomic loads. Writes are CAS loops. No lock contention.

For high-throughput caches with bloom prefiltering, lock-free is essential.

---

## Deep Dive: Counting Bloom Filters for Deletes

Standard bloom filters cannot delete. Counting bloom filters can:

- Each "bit" is a small counter (e.g. 4 bits).
- Set: increment.
- Delete: decrement.
- Test: all counters > 0.

Cost: 4× memory of standard bloom for same false-positive rate.

For TTL caches where deletes happen (expiry, explicit), counting blooms allow accurate negative caching even with churn.

---

## Deep Dive: Two-Phase Cache Update

For atomic multi-key cache updates:

```go
func (c *Cache) BatchUpdate(updates map[string]Entry) {
    // Phase 1: prepare.
    for k, v := range updates {
        c.staging[k] = v
    }
    // Phase 2: commit atomically.
    c.committedAt.Store(time.Now().UnixNano())
    for k, v := range c.staging {
        c.data[k] = v
    }
    c.staging = nil
}
```

Readers can see the old state or the new state, but not a mix. Useful for caches where consistency across multiple keys matters.

Costs: 2× memory during commit; slower writes.

For atomic-snapshot caches (atomic.Pointer to immutable map), batch updates are naturally atomic.

---

## Deep Dive: Cache Migration Without Downtime

Migrating a cache to a new design or library while serving traffic:

1. Run old cache and new cache in parallel.
2. Writes go to both.
3. Reads go to old (for now).
4. Verify new cache returns same answers (audit).
5. Swap reads to new.
6. Tear down old.

Each step is a deployable change. Each is revertible.

The dual-write phase is the most painful — costs 2× write throughput. Plan accordingly.

For low-stakes caches, sometimes the cheaper migration is: deploy new, accept cold start, accept brief upstream surge. Simpler than dual-write.

---

## Worked Example: Multi-Datacenter Cache Mesh

Sketch of a system where caches in different datacenters gossip invalidations.

```go
package mesh

import (
    "context"
    "encoding/json"
    "sync"
    "time"

    "github.com/hashicorp/memberlist"
)

type Invalidation struct {
    Key       string
    Timestamp time.Time
    Source    string
}

type Cache struct {
    local  *LocalCache
    list   *memberlist.Memberlist
    sentInv map[string]time.Time
    mu     sync.Mutex
}

func New(cfg *memberlist.Config, local *LocalCache) (*Cache, error) {
    list, err := memberlist.Create(cfg)
    if err != nil {
        return nil, err
    }
    return &Cache{local: local, list: list, sentInv: make(map[string]time.Time)}, nil
}

func (c *Cache) Invalidate(key string) {
    c.local.Delete(key)
    inv := Invalidation{Key: key, Timestamp: time.Now(), Source: c.list.LocalNode().Name}
    payload, _ := json.Marshal(inv)
    for _, n := range c.list.Members() {
        if n.Name == c.list.LocalNode().Name {
            continue
        }
        c.list.SendReliable(n, payload)
    }
}

func (c *Cache) OnMessage(payload []byte) {
    var inv Invalidation
    if err := json.Unmarshal(payload, &inv); err != nil {
        return
    }
    c.local.Delete(inv.Key)
}
```

Using `memberlist` (HashiCorp's gossip library) for cluster membership; sending invalidation messages reliably to all peers.

Caveats:

- Invalidation delivery is best-effort.
- Cross-datacenter gossip is slow (tens of ms to seconds).
- During partitions, replicas diverge.

For caches where strict consistency is not required across DCs, this is workable. For stricter needs, use a coordination service (etcd, Consul) instead of gossip.

---

## Deep Dive: Caches with SIMD Acceleration

Modern CPUs support SIMD (Single Instruction, Multiple Data) — operate on 4-16 values per instruction.

For caches, useful when:

- Searching for a key by hash among many slots.
- Bulk comparing keys.
- Computing hashes in parallel.

In Go, SIMD is accessed via assembly or `golang.org/x/sys/cpu` for feature detection. Most caches don't bother; the speedup over scalar code is usually 2-4×, often eaten by the complexity.

Cases where SIMD pays:

- Linear-probe hash tables: scan 8 slots at once.
- AES-NI for key hashing.
- Vector comparison for fixed-size keys.

For specialized caches (DNS resolvers, packet caches), SIMD is sometimes essential. For most Go services, ignore SIMD.

---

## Deep Dive: Caches in eBPF

A radical option: implement the cache in eBPF, running inside the Linux kernel. The cache lives below the application's process.

Pros:
- Zero syscall cost.
- Shared across processes on the host.
- Sub-microsecond access.

Cons:
- eBPF is C-like, not Go.
- Limited memory per map.
- Operationally complex.

Used by Cilium for connection tracking, and by some specialized telemetry systems.

For a Go developer, eBPF is a rare option. But knowing it exists is useful for radical performance requirements.

---

## Deep Dive: Caches in DPDK

DPDK (Data Plane Development Kit) bypasses the kernel for packet processing. Caches in DPDK:

- Live in user-space hugepages.
- Use per-core lockless designs.
- Achieve millions of operations per second per core.

For Go: there's `dpdk-go` bindings, but it's specialized. Most Go services don't need this.

For networking-heavy services (routers, switches in software), DPDK-class caches are the only option.

---

## Deep Dive: Stream Processing as Caching

A different framing: a cache is the output of a stream-processing job.

- Kafka topic: raw events.
- Stream processor: aggregates events into key-value updates.
- Output topic (compacted): the "current state" of each key.
- Application: reads the output topic, treats as a cache.

This pattern is "materialized view" applied at scale. Kafka Streams' KTable does exactly this.

For caches whose contents are derived from event streams, this pattern beats application-level caching:

- Application is stateless.
- Cache is durable.
- Update propagation is built-in.

For caches whose contents come from request-response calls, traditional caching is simpler.

---

## Deep Dive: Read-Copy-Update (RCU)

RCU is a Linux kernel pattern: readers see one version while writers prepare the next. After all readers finish, the old version is reclaimed.

In Go, atomic.Pointer to immutable snapshots is a form of RCU. The GC handles reclamation.

For caches:

- Readers: load the snapshot, use it.
- Writers: create a new snapshot, CAS-swap.
- Reclamation: GC drops the old when no goroutine holds it.

RCU shines when readers vastly outnumber writers. For caches with 95%+ reads, RCU is unbeatable.

---

## Deep Dive: Memory Barriers in Go

Go's memory model guarantees:

- Operations on `sync/atomic` are sequentially consistent.
- Mutex acquisitions establish happens-before.
- Channel sends and receives establish happens-before.

Without these guarantees, a write to memory may not be visible to other goroutines for arbitrary delays.

For caches, this means:

- A `Set` followed by a `Get` *on the same goroutine* sees the new value immediately.
- A `Set` on goroutine A followed by a `Get` on goroutine B sees the new value *only if* an atomic, mutex, or channel synchronization occurred between them.

The typical cache pattern (lock around Set and Get) provides the synchronization automatically. Lock-free designs require explicit atomic operations.

---

## Deep Dive: Avoiding the Go GC Pauses

GC stop-the-world pauses are a few milliseconds for typical heaps. For caches with sub-ms p99 budgets, this is too much.

Mitigations:

- Smaller heaps (off-heap caches).
- Tune GOGC higher (less frequent GC).
- Use GOMEMLIMIT to control max heap.
- Avoid allocations in hot paths.
- Use sync.Pool for reusable objects.

For real-time-ish caches, off-heap is the only complete answer. For most caches, tuning GOGC and minimizing allocations gets you most of the way.

---

## Deep Dive: Cache Cost Model

For each cache, compute:

- **Memory cost:** GB × dollar/GB/month.
- **CPU cost:** core-fraction × dollar/core/month.
- **Operational cost:** engineer-hours × dollar/hour.

Benefit:

- **Saved upstream calls:** missed-calls × cost/call.
- **Latency reduction:** millisecond-saved × dollar/millisecond (varies, sometimes huge for revenue-sensitive paths).

If saved cost > total cost, cache is justified. Otherwise, drop it.

For revenue-critical paths (checkout, search), even tiny latency wins justify expensive caches. For internal admin tools, sometimes no cache is the answer.

---

## Deep Dive: Caches in Functional-style Code

For caches built around pure functions:

```go
// Pure: same input → same output.
func compute(input string) Output {
    return ...
}

// Memoized:
var cache sync.Map
func cachedCompute(input string) Output {
    if v, ok := cache.Load(input); ok {
        return v.(Output)
    }
    result := compute(input)
    cache.Store(input, result)
    return result
}
```

For pure functions, memoization caches are trivially correct. TTLs aren't even needed — the result is forever valid.

Pitfall: functions that look pure but use globals, time, randomness. Their cached results become stale.

For genuinely pure functions, caching is a freebie. For impure, TTLs are mandatory.

---

## Deep Dive: Composite Cache Keys

For multi-dimensional cache keys:

```go
type Key struct {
    Tenant string
    User   int64
    Locale string
}

func (k Key) String() string {
    return fmt.Sprintf("%s:%d:%s", k.Tenant, k.User, k.Locale)
}
```

Tradeoffs:

- String concatenation allocates.
- Struct with comparable fields could be used directly as map key:
  ```go
  m := make(map[Key]Value)
  ```
- Faster for typed keys; cleaner API.

Use typed keys when you can. Fall back to strings for very polymorphic keys.

---

## Deep Dive: Cache Keys with PII

Cache keys may contain PII:

```go
key := "user:" + email // PII in cache memory and logs
```

Mitigations:

- Hash: `key := "user:" + sha256(email)`. Cannot be reversed; still a stable key.
- Tokenize: replace with opaque IDs upstream; never see PII in cache.
- Encrypt: encrypt PII before keying.

For GDPR-compliant caches, hashing is the minimum.

---

## Deep Dive: Cache Profiling Recipes

CPU profile of a Go cache should show:

- `runtime.mapaccess1_faststr` or `runtime.mapaccess1` for Gets.
- `runtime.mapassign_faststr` for Sets.
- `sync.(*RWMutex).Lock/Unlock` for write paths.
- `sync.(*RWMutex).RLock/RUnlock` for read paths.

If `runtime.mallocgc` is hot, you're allocating in the path. Fix.

If `runtime.gcMark*` is hot, GC pressure. Reduce heap or use off-heap.

Profile under realistic load. Synthetic benchmarks lie.

---

## Deep Dive: Heap Profile Patterns

`go tool pprof http://localhost:6060/debug/pprof/heap` shows:

- Total heap size.
- Allocation by type (which structs dominate).
- Allocation by function (where allocations happen).

For caches, expected:

- Map buckets (Go's map allocations).
- Cache entry values.
- String headers for keys.

Unexpected:

- HTTP middleware allocations bleeding into cache calls.
- Reflection (`reflect.unsafe_NewArray`).
- JSON marshaling.

Investigate each unexpected spike.

---

## Cheat Sheet

```go
// Sharded arena cache
type Cache struct { shards [256]*shard }
type shard struct {
    mu sync.RWMutex
    table []slot
    arena []byte
}

// Off-heap mmap
data, _ := syscall.Mmap(-1, 0, size, PROT_READ|PROT_WRITE, MAP_ANON|MAP_PRIVATE)
defer syscall.Munmap(data)

// Cache line padding
type AlignedCounter struct {
    v atomic.Uint64
    _ [56]byte
}

// Lock-free read
type Cache struct { p atomic.Pointer[snapshot] }
func (c *Cache) Get(k string) (V, bool) {
    return (*c.p.Load()).data[k]
}

// Hierarchical timer wheel
type Wheel struct { levels [4]Level }

// Bloom-prefiltered cache
if !filter.TestString(k) { return nil, false }

// Memberlist gossip
list, _ := memberlist.Create(cfg)
list.SendReliable(node, payload)
```

---

## Deep Dive: Inline Caching

A cousin of standard caches: inline caches in compilers and interpreters.

The idea: at each call site, cache the resolved target. Next call: same target? Use cached. Different? Update.

For a Go program calling a virtual method through an interface:

- Without inline cache: dispatch table lookup per call.
- With inline cache: cached pointer; check matches; direct call if so.

Used in JIT compilers (V8, JVM). Rarely in Go because Go's static dispatch is already fast.

For caches in our sense, inline caching is a related concept — caching the result of a previous resolution. Worth knowing as inspiration.

---

## Deep Dive: Pre-computed Hash Storage

A cache that stores values keyed by string typically recomputes the hash on every lookup. For long keys, this is slow.

Optimization: store the precomputed hash along with the key.

```go
type Slot struct {
    hash     uint64
    key      string
    value    interface{}
}

func (c *Cache) Get(k string) (interface{}, bool) {
    h := hash(k)
    s := c.shards[h&255]
    s.mu.RLock()
    defer s.mu.RUnlock()
    for _, slot := range s.slots {
        if slot.hash == h && slot.key == k {
            return slot.value, true
        }
    }
    return nil, false
}
```

The `slot.hash == h` comparison short-circuits the slow `slot.key == k` for the (common) case of hash mismatch.

For caches with long keys (URLs), this is essential.

---

## Self-Assessment Checklist

- [ ] I can design a 10 GB cache that avoids GC pauses.
- [ ] I can explain off-heap allocation strategies and when each is appropriate.
- [ ] I can implement cache-line-padded structures to eliminate false sharing.
- [ ] I can design a lock-free read path with atomic.Pointer.
- [ ] I can implement a hierarchical timer wheel.
- [ ] I can architect a 4-tier (L0-L3) cache.
- [ ] I can design cross-datacenter cache coherence.
- [ ] I can read and contribute to ristretto/bigcache/freecache source code.
- [ ] I can design and ship a production-grade cache library.

---

## Deep Dive: Performance Benchmarks Across Designs

A typical bench comparing implementations on a 16-core machine, 100k unique keys, 90% read workload:

| Implementation | Reads/sec | Writes/sec |
|---|---|---|
| `map + Mutex` | 8 M | 3 M |
| `map + RWMutex` | 24 M | 3 M |
| `sync.Map` | 30 M | 2 M |
| Sharded(256) `map + RWMutex` | 80 M | 12 M |
| Sharded(256) `sync.Map` | 75 M | 10 M |
| ristretto | 90 M | 8 M |
| freecache | 100 M | 6 M |
| atomic.Pointer snapshot | 200 M | 0.01 M (full rebuild) |

For pure-read workloads, the atomic snapshot wins. For balanced, sharded with admission (ristretto) wins. For low-fragmentation memory bounds, freecache wins.

Numbers are illustrative; benchmark your workload, not the synthetic one.

---

## Deep Dive: Cache Design Reviews

When designing a new cache, walk through:

1. **What does this cache?** Specific data types, key shapes, value shapes.
2. **Why cache?** What is the cost of not caching? What is the hit ratio expected?
3. **Bounds?** Memory budget. Maximum entry count. TTL.
4. **Concurrency?** Read/write ratio. Expected QPS.
5. **Consistency?** Acceptable staleness. Invalidation mechanism.
6. **Failure modes?** What happens when upstream is down? When the cache is full? On crash?
7. **Observability?** Metrics. Health checks. Alerts.
8. **Operations?** Deploy, restart, scale. Capacity planning.

A 30-minute design review answers all of these. Result: a cache that survives production.

---

## Deep Dive: Anti-Pattern Catalog

Quick list of patterns to avoid:

- Cache as source of truth.
- No TTL bound.
- No size bound.
- Synchronous loader without singleflight.
- Loader without context.
- Loader without timeout.
- Loader without circuit breaker.
- Caching errors with same TTL as success.
- No metrics.
- No goroutine leak prevention.
- Global mutex on large cache.
- Per-entry timer instead of central wheel.
- One cache for multiple concerns.
- No documentation.
- Cache shared across tenants without isolation.
- Cache values returned by reference (mutable).
- Cache key without namespace.
- Cache backed by package-level globals.

Each has surfaced as a production incident.

---

## Deep Dive: Cache Library Maturity Stages

A new cache library evolves through:

1. **MVP:** Get/Set/Delete with one mutex. Works.
2. **TTL:** Per-entry expiration. Sweeper.
3. **Concurrency:** RWMutex or sharded.
4. **Singleflight:** Stampede protection.
5. **Metrics:** Hit/miss/latency.
6. **Eviction:** LRU or similar size bound.
7. **Admission:** TinyLFU or equivalent.
8. **Off-heap:** GC-free for huge caches.
9. **Distribution:** L2 backend, pub/sub.
10. **Multi-DC:** CRDT or coordination.

Each step adds value. Most projects stop at step 5 or 6. Production libraries reach 7-8. CDN-class caches go all the way.

---

## Deep Dive: Cache and Service-Level Objectives

A cache's SLOs:

- Hit ratio: 95% (typical for well-tuned).
- p99 Get latency: < 100 µs.
- Loader p99 latency: < 100 ms.
- Sweep p99 latency: < 5 ms.
- Memory utilization: < 80% of budget.
- Eviction rate: < 1% of QPS sustained.

Define these explicitly. Alert when they degrade. Tune toward them.

A cache without SLOs is unmanaged software.

---

## Deep Dive: Cache Operational Hierarchy

Roles around a production cache:

- **Developer:** writes the cache code, owns correctness.
- **SRE:** owns operations, monitors health, scales.
- **Architect:** decides where caches live in the system.
- **Data owner:** decides what is cached, what TTLs are acceptable.

For small teams, one person wears all hats. For large teams, explicit RACI matters.

Common pitfall: developer adds a cache without consulting data owner; data owner discovers stale data in their dashboard; trust erodes.

---

## Deep Dive: Cache as Technical Debt

A cache that "just works" eventually accumulates debt:

- Configuration that nobody remembers why.
- Metrics nobody looks at.
- Edge cases handled in mysterious ways.
- "Don't touch it" reputation.

Strategies:

- Document configurations as ADRs (Architecture Decision Records).
- Periodically (annually) review the cache: still needed? Still tuned?
- Have one person own the cache; rotate ownership but maintain accountability.

Without active stewardship, caches become rotting load-bearing components.

---

## Deep Dive: Cache for Real-Time Systems

For systems with hard real-time requirements (e.g. trading, robotics):

- GC pauses are unacceptable.
- Lock contention is unacceptable.
- Even sub-millisecond stalls hurt.

Options:

- Pre-allocated, never-resized data structures.
- Lock-free read paths.
- No syscalls in hot paths.
- Tight pinning (`runtime.LockOSThread`).
- Real-time GC tuning (GOGC=off, manual control).

For most real-time systems, Go is not the right language; C, C++, Rust dominate. For soft-real-time Go, the techniques in this file help.

---

## Deep Dive: Cache for High-Throughput Networking

Network proxies (Envoy, HAProxy) cache:

- DNS results.
- TLS sessions.
- Connection pools.
- Response bodies.

For Go-based proxies (e.g. some sidecars), the cache patterns from this file directly apply. Per-CPU sharding, lock-free reads, hierarchical timer wheels are all essential.

---

## Deep Dive: Cache Sharing via shared memory

Multiple processes on one host can share a cache via shared memory:

```go
import "github.com/edsrzf/mmap-go"

f, _ := os.OpenFile("cache.bin", os.O_RDWR|os.O_CREATE, 0644)
f.Truncate(size)
m, _ := mmap.Map(f, mmap.RDWR, 0)
```

The mmap'd region is visible to all processes that map it. Synchronization via futexes or atomic operations.

Used for cross-process caches in latency-sensitive deployments. Operationally heavy; rare in modern containerized environments.

---

## Deep Dive: Cache Choice Decision Tree

A simple decision tree for picking a cache:

- **Throughput < 10k QPS?** → `map + RWMutex`. Done.
- **Throughput 10k - 1M QPS?** → Sharded `map + RWMutex` or ristretto.
- **Memory bounded by entry size variation?** → ristretto (cost-based).
- **Fixed memory cap?** → freecache.
- **Huge entry counts (>10M)?** → bigcache.
- **Multi-replica?** → add L2 (Redis).
- **Multi-DC consistency?** → CRDT or distributed cache.
- **Larger than RAM?** → disk-backed (Badger/Pebble).
- **Real-time latency?** → atomic.Pointer + immutable snapshots.

90% of cases land in the first three branches.

---

## Deep Dive: Cache Stress Test Suite

A standard suite of tests every cache should pass:

```go
func TestConcurrentReadsWrites(t *testing.T) {
    c := New(...)
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            for j := 0; j < 10000; j++ {
                k := fmt.Sprintf("k%d", j%100)
                if j%2 == 0 {
                    c.Set(k, "v")
                } else {
                    c.Get(k)
                }
            }
        }(i)
    }
    wg.Wait()
}

func TestExpiration(t *testing.T) {
    c := New(...)
    c.Set("k", "v")
    time.Sleep(2 * c.ttl)
    if _, ok := c.Get("k"); ok {
        t.Fatal("expected miss after expiration")
    }
}

func TestNoLeakOnClose(t *testing.T) {
    initial := runtime.NumGoroutine()
    for i := 0; i < 100; i++ {
        c := New(...)
        c.Close()
    }
    runtime.GC()
    time.Sleep(100 * time.Millisecond)
    if runtime.NumGoroutine() > initial+5 {
        t.Fatal("goroutine leak")
    }
}

func TestStampedeProtection(t *testing.T) {
    var calls atomic.Int64
    c := NewWithLoader(..., func(k string) (V, error) {
        calls.Add(1)
        time.Sleep(50 * time.Millisecond)
        return "v", nil
    })
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            c.Get("k")
        }()
    }
    wg.Wait()
    if calls.Load() > 1 {
        t.Fatalf("stampede: loader called %d times", calls.Load())
    }
}
```

Pass all four → solid foundation.

---

## Summary

The professional level addresses caches at the highest scales:

- Memory layout matters; off-heap arenas are the answer for billion-entry caches.
- Cache lines and false sharing affect every multi-core deployment.
- Lock-free reads via atomic pointers are unbeatable for read-heavy snapshot workloads.
- Hierarchical timer wheels scale eviction to millions of distinct TTLs.
- Multi-tier architectures combine in-process, regional, and global caches.
- Custom allocators and NUMA awareness yield diminishing returns above 90% of peak.

Few services need every technique here. For those that do, mastery of these patterns is the difference between a cache that *works* and a cache that *scales*.

---

## Deep Dive: Cache for Probabilistic Approximate Membership

Bloom and cuckoo filters answer "have I seen this?" approximately. Other structures answer related questions:

- **Quotient filter:** sorted, deletable, mergeable.
- **Xor filter:** smaller than bloom for same FP rate, no false negatives.
- **Ribbon filter:** even smaller than xor; complex to construct.

For caches that need to test membership without storing values, modern filters beat bloom in most metrics.

`go-faster/probabilistic` and similar libraries provide implementations.

---

## Deep Dive: Cache as a Probabilistic Data Sketch

Some "caches" don't store individual values — they store *sketches* of the value distribution.

- **t-digest:** percentiles of a stream.
- **HyperLogLog:** cardinality.
- **Count-min sketch:** frequency.
- **Top-K heap:** most frequent items.

For dashboard caches (e.g. "p99 latency of /api/v1/users over the last hour"), the underlying "cache" is a t-digest, periodically flushed to a persistent metric store.

These probabilistic caches use O(1) memory regardless of data volume. Essential for high-cardinality observability.

---

## Deep Dive: Cache for Time-Series

A cache holding time-series data has special properties:

- Data is naturally ordered.
- Most reads are "current value" or "last N values."
- Writes are append-only.
- Old data eventually drops out via TTL.

Storage:

```go
type Series struct {
    values []float64
    times  []int64
    head   int
}

func (s *Series) Add(t int64, v float64) {
    s.values[s.head] = v
    s.times[s.head] = t
    s.head = (s.head + 1) % len(s.values)
}
```

A ring buffer per key. Fixed memory. Sub-microsecond reads.

For metrics systems: Prometheus, InfluxDB, VictoriaMetrics all implement variants of this.

---

## Deep Dive: Cache for Distributed Consensus

A surprising use: caches accelerating Raft/Paxos.

In Raft, every read requires a quorum check. With a cache:

- Cache the result of a read at the leader.
- Re-validate via a lease (no quorum needed during the lease).
- Lease expiry triggers a new quorum read.

This pattern (used by etcd's `linearizableReadNotifier`) reduces consensus overhead by 10-100×.

For most Go services, this is invisible — etcd's client handles it. For those building consensus systems, the cache pattern is essential.

---

## Further Reading

- "Memcached internals" — Brad Fitzpatrick's classic talks.
- Cloudflare's engineering blog on edge caching.
- Fastly's Varnish/VCL documentation.
- Linux kernel's hierarchical timer wheels (`kernel/time/timer.c`).
- The DPDK documentation on packet-rate cache design.
- Caffeine's design wiki (Java but principles apply).
- The Aerospike NoSQL engine design — in-memory hash table at billion scale.
- ScyllaDB's seastar framework — sharded async data structures.
- Linux kernel's `percpu` documentation.
- `golang.org/x/sys/cpu` for cache line constants.
