# Lock-Free Data Structures — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Vyukov's Bounded MPMC Queue](#vyukovs-bounded-mpmc-queue)
3. [Click's Non-Blocking Hash Map](#clicks-non-blocking-hash-map)
4. [Lock-Free Skip List](#lock-free-skip-list)
5. [Wait-Free Atomic Counters and Statistics](#wait-free-atomic-counters-and-statistics)
6. [Memory Reclamation: Hazard Pointers](#memory-reclamation-hazard-pointers)
7. [Memory Reclamation: Epoch-Based Reclamation](#memory-reclamation-epoch-based-reclamation)
8. [When Lock-Free Wins, When It Loses](#when-lock-free-wins-when-it-loses)
9. [Production Diagnostics](#production-diagnostics)
10. [Reading Published Lock-Free Code](#reading-published-lock-free-code)
11. [Summary](#summary)

---

## Introduction

At junior and middle level we built the textbook designs: Treiber stack, Michael-Scott queue, Harris linked list, SPSC and MPSC ring buffers. They all share an unspoken assumption — that Go's garbage collector cleans up after us. Take that crutch away and the structures look very different. C and C++ versions of these algorithms carry roughly two-thirds of their complexity in memory reclamation. Hazard pointers, epoch-based reclamation, reference counting variants, RCU — there is a whole sub-field about how to free a node nobody else might still be reading.

This file covers the structures that the textbook designs build up to: Vyukov's bounded multi-producer multi-consumer queue, Cliff Click's non-blocking hash map, the lock-free skip list. We then look at memory reclamation in earnest, because at senior level the GC is no longer an excuse to skip the topic. Finally, we discuss when lock-free wins in production and the more interesting question of when it loses — because that is the question that decides whether you should ship one.

The honest framing, repeated from middle.md and elaborated here: lock-free is hard, lock-free is rarely faster than a well-tuned mutex, and lock-free code is much harder to debug. Reach for it only when you have profiling evidence that says you must.

---

## Vyukov's Bounded MPMC Queue

Dmitry Vyukov's bounded multi-producer multi-consumer queue (2009, posted on `1024cores.net`) is one of the most copied lock-free designs in the industry. It powers parts of the Rust crossbeam library, Boost.Lockfree, and several language runtimes. It is bounded (fixed capacity), array-backed, and supports arbitrary numbers of concurrent producers and consumers.

### Core idea

Each cell of the backing array has a sequence number. The sequence numbers tell each operation whether a cell is ready for it and detect the ABA-like cases that would otherwise need version counters.

- Cell `i` starts with `seq = i`.
- A producer enqueueing at logical position `pos` waits until `cell.seq == pos`, writes the value, and sets `cell.seq = pos + 1`.
- A consumer dequeueing at logical position `pos` waits until `cell.seq == pos + 1`, reads the value, and sets `cell.seq = pos + capacity`.

The atomic counters `enqPos` and `deqPos` advance monotonically; each operation picks its slot by CASing the position counter. The sequence-number protocol decouples slot ownership from slot readiness.

### Implementation

```go
package mpmc

import (
    "runtime"
    "sync/atomic"
)

type cell[V any] struct {
    seq atomic.Uint64
    val V
}

type Queue[V any] struct {
    buf     []cell[V]
    mask    uint64
    _pad1   [56]byte
    enqPos  atomic.Uint64
    _pad2   [56]byte
    deqPos  atomic.Uint64
}

func NewQueue[V any](capPow2 int) *Queue[V] {
    if capPow2 < 2 || capPow2&(capPow2-1) != 0 {
        panic("capacity must be a power of two >= 2")
    }
    q := &Queue[V]{
        buf:  make([]cell[V], capPow2),
        mask: uint64(capPow2 - 1),
    }
    for i := range q.buf {
        q.buf[i].seq.Store(uint64(i))
    }
    return q
}

func (q *Queue[V]) Enqueue(v V) bool {
    var c *cell[V]
    pos := q.enqPos.Load()
    for {
        c = &q.buf[pos&q.mask]
        seq := c.seq.Load()
        diff := int64(seq) - int64(pos)
        switch {
        case diff == 0:
            if q.enqPos.CompareAndSwap(pos, pos+1) {
                c.val = v
                c.seq.Store(pos + 1)
                return true
            }
        case diff < 0:
            return false // full
        default:
            pos = q.enqPos.Load()
        }
    }
}

func (q *Queue[V]) Dequeue() (V, bool) {
    var zero V
    var c *cell[V]
    pos := q.deqPos.Load()
    for {
        c = &q.buf[pos&q.mask]
        seq := c.seq.Load()
        diff := int64(seq) - int64(pos+1)
        switch {
        case diff == 0:
            if q.deqPos.CompareAndSwap(pos, pos+1) {
                v := c.val
                var z V
                c.val = z // help GC for pointer payloads
                c.seq.Store(pos + uint64(len(q.buf)))
                return v, true
            }
        case diff < 0:
            return zero, false // empty
        default:
            pos = q.deqPos.Load()
        }
    }
}

// Backoff hook for very-high-contention deployments.
func gosched() { runtime.Gosched() }
```

### Why the sequence number trick works

The sequence number is the single source of truth for cell readiness. Three observations make the algorithm correct:

1. **Position counters are monotonic.** Each successful CAS advances `enqPos` or `deqPos` by exactly one. They never go backwards.
2. **Each cell goes through a strict state machine.** From `seq = i`, the cell transitions to `i + 1` after a write, then to `i + capacity` after a read, then to `i + capacity + 1` after the next write, and so on. The sequence number monotonically increases by exactly one per state transition.
3. **The diff test distinguishes ready, not-ready-yet, and full/empty.** `diff == 0` means the cell is ready for this position. `diff < 0` means we have lapped the cell (full from the producer's view, empty from the consumer's). `diff > 0` means the cell is ahead — another producer or consumer already used this position, so we must reread the position counter.

ABA is impossible because the sequence number, not the value, drives the protocol. By the time a cell could be reused at the same logical position, the sequence would have advanced by a full capacity, making the diff non-zero.

### Performance characteristics

Benchmarks on a modern x86 (8 cores, 2 sockets, no SMT) for a 1024-cell queue:

| Configuration              | ns/op (Vyukov) | ns/op (channel) | ns/op (mutex + slice) |
|----------------------------|----------------|-----------------|------------------------|
| 1 producer, 1 consumer     | ~25            | ~80             | ~120                   |
| 4 producers, 4 consumers   | ~70            | ~250            | ~400 (contended)       |
| 16 producers, 16 consumers | ~180           | ~900            | ~1500 (cliff)          |

The win grows with contention. Below 4 cores it is essentially a tie with a buffered channel; above 8 cores it pulls ahead by 3-5x. For most application workloads, a channel is good enough. The Vyukov queue earns its keep in trading systems, packet processors, and high-throughput log aggregators where the channel becomes the bottleneck.

### Caveats

- **Bounded only.** When full, `Enqueue` returns `false`. The caller must decide: spin, drop, or fall back to a slow path. No version of this design is unbounded.
- **Producers and consumers do not see each other's sizes accurately.** `Len()` is at best `enqPos - deqPos`, which can be racy and even negative if observed mid-op. Treat it as approximate.
- **Padding matters.** The two position counters must be on separate cache lines or producer-consumer false sharing destroys the design's advantage. The `_pad` fields in the struct above are not decorative.

---

## Click's Non-Blocking Hash Map

Cliff Click presented his non-blocking hash map at JavaOne 2007 (paper: *A Lock-Free Wait-Free Hash Table*). The design influenced every major JVM concurrent map, and it remains the reference implementation for production-grade lock-free hash tables. It is open-addressed, resizable, and supports arbitrary numbers of concurrent readers and writers.

We will not write a full implementation here — that takes 1000+ lines and is an undertaking — but we will trace the structure so you can read the paper and existing implementations productively.

### The state machine per slot

Each slot has two atomic words: the key and the value. Both are tagged with sentinel values to encode the slot's state:

- `K = nil, V = nil`: empty slot.
- `K = key, V = nil`: claim-in-progress (a writer is committing).
- `K = key, V = value`: normal entry.
- `K = key, V = TOMBSTONE`: deleted entry.
- `K = key, V = PRIME(value)`: this slot's data has been copied to a new table during resize; readers should redirect.

A `Get` walks the probe sequence, reading each slot. Encountering `K = nil` means the key is absent (open addressing terminator). Encountering a matching `K` returns the `V` — or, if `V` is primed, restarts the lookup in the new table.

A `Put` walks the probe sequence finding an empty slot or matching key, CASes `K = nil -> key`, then CASes `V = old -> new`.

### Resize and the `PRIME` state

When the load factor crosses a threshold, a writer allocates a new table of double the size and starts moving entries. Movement is incremental: each writer that touches the old table during the resize also helps copy a few buckets to the new table. When all entries are copied, the old table is retired.

A reader, on encountering a `PRIME`, knows the entry has moved. It re-runs its lookup in the new table. The new table is reachable via an atomic pointer in a shared `tableRef` structure.

The clever insight: every concurrent op can help the resize finish. Resize is not a stop-the-world operation. Under sustained writes, the new table fills before the old table is fully retired, and the algorithm gracefully chains resizes.

### Why a clean Go implementation is hard

Two reasons make a clean Go port hard:

1. **Sentinel values.** Java uses object identity for `TOMBSTONE` and `PRIME`. In Go with generics, you cannot easily make a sentinel `V` that is distinguishable from a real `V`. The workaround is to box every entry in a small struct with a tag byte, doubling the per-entry footprint.
2. **Padding and false sharing.** The slot array is the heart of the structure; getting cache-line layout right takes deliberate work that the JVM hides for you.

The most cited Go-style attempt is `github.com/cornelk/hashmap`. Read its source; it is well-commented and exposes most of the trade-offs.

### When to use it

- You have a read-heavy concurrent map.
- You have measured `sync.Map` and found it insufficient (rare).
- You have measured `sync.RWMutex + map` and found writer contention a problem.

If you cannot tick all three, use `sync.Map` or `sync.RWMutex + map`. The Click hash map's complexity is justified only for workloads that have outgrown the standard library.

---

## Lock-Free Skip List

A skip list is a probabilistic balanced search structure: an ordered linked list with random shortcuts that give it `O(log n)` expected search time. Lock-free skip lists are due to Maurice Herlihy, Yossi Lev, and Nir Shavit (2007), with significant variants by Keir Fraser (2004) and Sundell-Tsigas (2003).

The core idea: a skip list is a stack of Harris-style lock-free lists. Each level is its own list, with sparser nodes higher up. Search descends from the top level, narrowing the range, and on each level applies the Harris mark-then-unlink protocol for deletes.

### Why it matters

The lock-free skip list is the lock-free analog of `std::map` or a B-tree. It is the only widely-adopted lock-free *ordered* container. Java's `ConcurrentSkipListMap` is a direct application. Rocksdb's memtable is a (locking) skip list precisely because the lock-free version is reachable from there.

### Sketch of the structure

```go
const maxLevel = 32

type slNode[K comparable, V any] struct {
    key   K
    val   V
    next  [maxLevel]atomic.Pointer[markableRef[K, V]]
    topLevel int
}

type markableRef[K comparable, V any] struct {
    next    *slNode[K, V]
    deleted bool
}

type SkipList[K comparable, V any] struct {
    head *slNode[K, V]
    cmp  func(a, b K) int
}
```

Insert: roll a random level `L`, find predecessors and successors at each level from `L` down to 0, link the new node bottom-up (so it is visible at level 0 first, then progressively at higher levels). The bottom-level link is the linearization point; the higher links are search optimisations.

Delete: mark the node at every level from top to bottom (using the Harris mark), then help physical unlink. A node is logically deleted as soon as its level-0 next pointer is marked.

Search: descend level by level. At each level, walk forward until the next key is `>=` the target, then drop down. If you encounter a marked node, help unlink and continue.

### Implementation cost

A full lock-free skip list in Go runs to 600-800 lines. The subtleties:

- Generating a random level fairly without contending on a shared RNG.
- Handling the `markableRef` allocations efficiently (they otherwise dominate the per-op cost).
- Choosing a top-level cap that balances memory and performance.

For most production needs, a `sync.RWMutex` wrapping a `github.com/google/btree` is simpler, more debuggable, and competitive on throughput unless you are doing millions of writes per second from dozens of cores.

---

## Wait-Free Atomic Counters and Statistics

The simplest lock-free data structure is a single atomic counter. It is also one of the few lock-free designs that is uncontroversially worth using in production. A modern x86 atomic `Add` on an L1-resident cache line takes ~5 ns. Wrapping it in a mutex adds ~30 ns plus contention overhead.

### When `atomic.Add` is wait-free

`atomic.Int64.Add` compiles to `LOCK XADD` on x86. The instruction completes in a bounded number of cycles regardless of contention — it locks the cache line, performs the add, releases the lock. Every caller makes progress in `O(1)`. This is wait-free in the strict sense.

On ARM, the lowering is a LL/SC loop, which can in principle retry under contention. In practice, on modern ARM (v8.1+) there is `LDADD` which is the same single-instruction approach. So on both major architectures, `atomic.Add` is effectively wait-free.

### Sharded counters revisited

Middle level introduced sharded counters. At senior level, two refinements matter:

1. **Per-P sharding.** Use the goroutine's current `P` (processor) as the shard index. Go does not expose this directly, but the `runtime_procPin` and `runtime_procUnpin` private functions do, and packages like `github.com/puzpuzpuz/xsync` use linkname to reach them. Per-P sharding eliminates inter-core contention entirely on a steady workload.
2. **Read fairness.** The naive `Sum()` reads each shard sequentially. Under heavy increments, the first shard's read may see an older value than the last shard's. For metrics this is fine. For correctness-sensitive code (transactional counters), you need a snapshot scheme: pin the goroutine, read all shards, unpin. This is a soft barrier, not a hard one.

```go
//go:linkname runtime_procPin runtime.procPin
func runtime_procPin() int

//go:linkname runtime_procUnpin runtime.procUnpin
func runtime_procUnpin()

type PerPCounter struct {
    shards []paddedCounter
}

type paddedCounter struct {
    n atomic.Int64
    _ [56]byte
}

func NewPerPCounter() *PerPCounter {
    return &PerPCounter{shards: make([]paddedCounter, runtime.GOMAXPROCS(0))}
}

func (c *PerPCounter) Add(delta int64) {
    p := runtime_procPin()
    c.shards[p].n.Add(delta)
    runtime_procUnpin()
}

func (c *PerPCounter) Sum() int64 {
    var s int64
    for i := range c.shards {
        s += c.shards[i].n.Load()
    }
    return s
}
```

`linkname` is unstable and breaks across Go versions. Use it only with eyes open.

### Statistics: histograms

A wait-free histogram is several atomic counters in an array, one per bucket. Increment by bucket index. Sum is a snapshot read. This is how Prometheus exposes histograms internally for high-frequency call sites.

The only subtlety is bucket assignment: `math.Log` is not free. Pre-computed bucket boundaries plus a binary search per `Observe` is the standard pattern. For very hot paths, a bit-trick on the IEEE 754 representation of a float64 gives `O(1)` bucket assignment.

---

## Memory Reclamation: Hazard Pointers

In garbage-collected Go, you rarely think about freeing nodes. In C, C++, Rust, and embedded systems, every pop of a node from a lock-free queue raises the question: when is it safe to free? You cannot free immediately — another thread may still be reading the node. You cannot delay forever — memory grows.

Hazard pointers, proposed by Maged Michael (2002), are the canonical solution.

### The protocol

Each reader thread reserves a small array of hazard-pointer slots. Before dereferencing a node `p` it has read from a shared location, it publishes `p` to one of its hazard slots and then re-reads the shared location to confirm `p` is still there. If yes, the hazard slot guarantees `p` will not be reclaimed.

When a writer wants to free a node `p`, it adds `p` to a per-thread retire list. Periodically, the writer scans every reader's hazard slots; any retired pointer that no reader has published can be freed.

### Why this is hard to do well

- **Scanning cost.** With `N` threads and `K` hazard slots each, a scan costs `O(N * K)` and must happen often enough to free memory.
- **Reordering hazards.** The publication of the hazard pointer must be globally ordered with the re-read of the shared location. In Go this requires sequential consistency, which atomics provide.
- **Per-thread state.** Hazard pointers need a thread-local registry. Goroutines do not have stable identities, so this is awkward in Go — you typically pin a goroutine to a P for the duration of an op.

### When you need them in Go

You need hazard pointers (or epochs, below) in Go when:

- You are wrapping unsafe.Pointer-based structures over off-heap memory (e.g. shared memory IPC).
- You are interoping with C lock-free libraries.
- You are writing a userspace database engine and the GC is the bottleneck.

For Go-managed memory, the GC already provides safe reclamation. The cost is GC overhead, not correctness. For most lock-free Go code, this is the right trade-off.

### Sketch

```go
type hpRegistry struct {
    slots []atomic.Pointer[byte]
}

type hpThread struct {
    reg    *hpRegistry
    mySlot *atomic.Pointer[byte]
    retire []unsafe.Pointer
}

func (t *hpThread) Protect(load func() unsafe.Pointer) unsafe.Pointer {
    for {
        p := load()
        t.mySlot.Store((*byte)(p))
        if load() == p {
            return p
        }
    }
}

func (t *hpThread) Retire(p unsafe.Pointer) {
    t.retire = append(t.retire, p)
    if len(t.retire) > 64 {
        t.scan()
    }
}

func (t *hpThread) scan() {
    inUse := make(map[unsafe.Pointer]struct{})
    for _, s := range t.reg.slots {
        if p := s.Load(); p != nil {
            inUse[unsafe.Pointer(p)] = struct{}{}
        }
    }
    kept := t.retire[:0]
    for _, p := range t.retire {
        if _, used := inUse[p]; used {
            kept = append(kept, p)
        } else {
            // free(p) -- in Go, drop the reference and let GC handle it.
        }
    }
    t.retire = kept
}
```

This sketch elides crucial details: barrier placement, thread registration, retire-list bounds. Read Michael's paper and the implementation in `folly` before shipping anything based on this.

---

## Memory Reclamation: Epoch-Based Reclamation

Epoch-based reclamation (EBR), due to Keir Fraser (2004), is the other canonical scheme. It is simpler and often faster than hazard pointers, at the cost of a weaker progress guarantee.

### The protocol

There is a global epoch counter `E`. Each thread maintains its current epoch (initially 0) and a pinned flag. When entering a critical section, a thread reads the global epoch and stores it locally — this "pins" the thread. When leaving, it clears the pinned flag.

Retired nodes are bucketed by the epoch in which they were retired. A node retired in epoch `E` can be freed only after every thread has been seen in epoch `>= E + 2`. (The `+2` accounts for a thread that reads epoch `E`, pauses, and resumes when the counter is `E + 1`.)

Periodically a writer attempts to advance the global epoch. The advance succeeds if every thread is either unpinned or pinned in the current epoch. After advance, the writer can free everything in the `E - 2` bucket.

### Why EBR wins for performance

- **Reader fast path.** Pinning is one atomic load and one store. No re-read loop. No per-pointer protection.
- **Batch reclamation.** Freeing is amortised — many nodes are freed together.
- **No per-pointer scan.** A single check per thread, not per hazard slot.

### Why EBR is less safe than hazard pointers

A thread that pins itself and then blocks (e.g. on a syscall) blocks epoch advance for the entire program. Memory grows. In a real-time system or a long-running daemon, this is a serious failure mode. Hazard pointers do not have this problem — a stalled reader pins exactly the pointers it has published, not the entire epoch.

For a userspace process with bounded critical sections (no syscalls inside the pin), EBR is the right default. For more pathological workloads, hazard pointers.

### EBR in Go

The `github.com/scylladb/scylla-go-driver` and `github.com/puzpuzpuz/xsync` libraries embed EBR-like schemes. They work because they pin the goroutine to a P (via `runtime.procPin`) so that the "thread" identity is stable for the duration of a critical section.

### Hazard pointers vs EBR — picking one

- Latency-bounded critical sections: EBR.
- Critical sections that may block: hazard pointers.
- Code that lives inside Go's GC: neither. Let the GC do it.

---

## When Lock-Free Wins, When It Loses

This is the section that decides whether you should ship a lock-free design.

### Lock-free wins

- **Wait-free atomic counters.** A `LOCK XADD` is faster than a mutex by a factor of 5-10 even uncontended. Sharding extends the win to many-core machines.
- **SPSC ring buffers.** Single producer, single consumer, bounded queue. Wait-free on both sides, no CAS. Standard in audio pipelines and packet processing.
- **MPSC queues for log aggregation.** Vyukov's intrusive MPSC matches or beats buffered channels under heavy producer load.
- **Read-mostly maps with rare writes.** `sync.Map` and Click's hash map. The lock-free path is essentially free for reads.
- **Real-time / signal-safe contexts.** Where a thread holding a mutex cannot be tolerated.

### Lock-free loses

- **MPMC queues under low contention.** A buffered channel is simpler and within 20-30% on throughput.
- **General-purpose ordered maps.** A `sync.RWMutex` plus a B-tree is more debuggable and competitive up to dozens of cores.
- **Stacks with rare contention.** A `sync.Mutex` with a slice is faster than a Treiber stack at 1-2 cores, ties at 4, loses at 8+. Many workloads stay below 4 cores per data structure.
- **Anything where the data structure is not the bottleneck.** Profile first. If the lock is at <5% of CPU time, lock-free will not help.
- **Anything with complex invariants.** A lock-free B-tree is a research problem. A locking B-tree is a library.

### The decision tree

1. Profile the workload. Is the lock the bottleneck? If not, stop.
2. Is the workload SPSC? Use an SPSC ring buffer.
3. Is the workload MPSC? Try a buffered channel first; fall back to Vyukov's intrusive MPSC if profiling demands.
4. Is the workload a counter? Use `atomic.Add`, sharded if >8 cores.
5. Is the workload a read-mostly map? Use `sync.Map` or `sync.RWMutex + map`.
6. Otherwise? Use a mutex. Revisit only if a profile shows it failing.

If you reach a custom lock-free MPMC queue or a custom hash map, you are stepping into research territory. Have a colleague review the code. Have benchmarks at 1, 2, 4, 8, and 16 cores. Have memory-reclamation testing under load.

---

## Production Diagnostics

When a lock-free structure misbehaves, the symptoms can be hard to diagnose.

### Symptom: occasional element loss

Possible causes:

- ABA on a non-version-tagged structure under `unsafe.Pointer`.
- Race between `Pop` and a concurrent `Push` that finds the head non-nil but then sees it changed.
- Sequence number wrap-around (Vyukov's queue with `uint32` instead of `uint64`).

Diagnosis: run under `-race`. Then add a per-op invariant check (count pushed minus count popped should match `Len()` at quiescence).

### Symptom: throughput collapse at N cores

Possible causes:

- False sharing on adjacent fields.
- Excessive backoff making the structure slower than a mutex.
- Cache-line bouncing on a single hot counter.

Diagnosis: `perf c2c` on Linux, or `pprof --diff_base` comparing 2-core and N-core runs. Look for an op that scales sublinearly.

### Symptom: memory growth under sustained load

Possible causes (when GC is involved):

- Long-running readers pinning the queue's old nodes via stack references.
- The stub node in Vyukov MPSC leaking via re-enqueue.
- Hazard-pointer retire lists never being scanned.

Diagnosis: heap profile under sustained load. If a node type's instance count grows without bound, you have a reclamation bug.

### Symptom: livelock

Possible causes:

- A "help" routine that itself triggers more help, in a loop.
- Backoff that scales worse than contention.

Diagnosis: CPU profile showing 100% in the CAS loop with zero application work. The lock-free design has degenerated to busy-wait.

### Tooling

- `go test -race -count=10000 -timeout=10m ./...` to flush rare races out.
- `go test -bench=. -benchtime=10s -cpu=1,2,4,8,16 -count=5` to validate scaling claims.
- `pprof` for CPU and memory.
- `perf c2c` for cache-line analysis on Linux.

If your project lacks any of these, you are not ready to maintain a lock-free data structure in production.

---

## Reading Published Lock-Free Code

The published implementations are the best teachers. A reading list:

- **Go runtime.** `runtime/sema.go`, `runtime/proc.go` for lock-free schedulers; `runtime/mcache.go` for per-P caching. The Go authors write the most readable lock-free code in the language.
- **`sync.Map`.** `src/sync/map.go`. Read-then-promote pattern, dirty-map fallback.
- **`sync.Pool`.** `src/sync/pool.go`. Per-P shared pool with steal-from-victim semantics.
- **`github.com/puzpuzpuz/xsync`.** Concurrent map and counter. Uses linkname for procPin.
- **`github.com/cornelk/hashmap`.** A Click-style hash map in Go.
- **`github.com/cespare/xxhash`** combined with `github.com/dgraph-io/ristretto`. The latter's locked but interesting design.
- **`crossbeam` in Rust.** Not Go, but the cleanest production lock-free code in any language. Read crossbeam-epoch and crossbeam-deque.

Reading patterns matter as much as writing. You will not write a Click hash map. You should be able to read one.

---

## Summary

At senior level, the lock-free repertoire expands from textbook designs to production-grade structures: Vyukov MPMC, Click's hash map, lock-free skip lists. The bigger story, though, is memory reclamation. Hazard pointers and EBR are the tools that take you from a Go-with-GC algorithm to a portable lock-free algorithm. Both are subtle. Both are usually unnecessary in Go.

The deeper lesson is when *not* to use lock-free. The list of structures where lock-free wins is short and specific: counters, SPSC, MPSC, read-mostly maps. Outside that list, a well-tuned mutex is usually competitive and always more debuggable. The honest engineering answer to "should I write a lock-free X?" is almost always "no, but here is the profile that proves it."

Three takeaways:

1. Vyukov's bounded MPMC queue is the highest-leverage lock-free structure to know. It is short, copy-friendly, and solves a real production problem.
2. Memory reclamation is the hidden cost of lock-free in non-GC languages. Hazard pointers and EBR are the canonical answers; the GC is Go's free pass, with a real GC cost.
3. Lock-free is hard, lock-free loses more often than it wins, and lock-free code is much harder to debug than locking code. Use mutexes unless you have a profile that proves you cannot.

---

## Related Topics

- [01-cas-algorithms](../01-cas-algorithms/) — CAS, the universal primitive
- [02-aba-problem](../02-aba-problem/) — ABA, version counters, and the Go GC
- [04-memory-fences](../04-memory-fences/) — Memory ordering interplay with reclamation
- [05-lock-free-vs-wait-free](../05-lock-free-vs-wait-free/) — Where the structures here sit on the progress hierarchy
- [03-sync-package/07-atomic](../../03-sync-package/07-atomic/) — The primitives you build on
- [03-sync-package/06-map](../../03-sync-package/06-map/) — A production-grade lock-free-ish map in the std lib
