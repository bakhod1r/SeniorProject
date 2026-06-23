---
layout: default
title: False Sharing — Interview
parent: False Sharing
grand_parent: Memory Ordering Barriers
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/22-memory-ordering-barriers/05-false-sharing/interview/
---

# False Sharing — Interview Questions

> Practice questions ranging from junior to staff-level. Each has a model answer, common wrong answers, and follow-up probes.

---

## Junior

### Q1. What is false sharing?

**Model answer.** False sharing happens when two CPU cores write to two different variables that happen to live on the same 64-byte cache line. Although the variables are logically independent, the hardware tracks coherence at line granularity, so every write from one core invalidates the line in the other core's cache. The result is a cache-line ping-pong that serialises the supposedly-parallel writes.

**Common wrong answers.**
- "It's when two goroutines share a variable." (No — that is true sharing.)
- "It's a race condition." (No — false sharing is a *performance* issue; the program is correct.)
- "It's when the compiler shares memory between goroutines." (Confused.)

**Follow-up.** *Why is it called "false"?* Because the cache thinks the data is shared, but logically it is not — the goroutines touch different variables. The sharing is an artifact of cache-line granularity, not program semantics.

---

### Q2. What is a cache line?

**Model answer.** A cache line is the unit of memory the CPU moves between RAM and its caches. On modern x86-64 and ARM64, it is 64 bytes. On PowerPC, it is 128 bytes. When you read or write any byte, the CPU loads the full cache line containing it.

**Follow-up.** *Why is 64 the magic number?* It is the coherence granularity chosen by the hardware. Smaller would mean too many lines (more bookkeeping); larger would mean too much memory moved per access. 64 is a tradeoff that has held for two decades.

---

### Q3. How do you fix false sharing in Go?

**Model answer.** Add cache-line padding to space variables onto separate cache lines:

```go
type Padded struct {
    v int64
    _ [56]byte // pad to 64 bytes
}
```

For an array of such structs, each element is on its own cache line. Different goroutines writing different elements no longer cause cache-line bouncing.

**Follow-up.** *Why 56 bytes and not 64?* Because the `int64` is already 8 bytes; 8 + 56 = 64.

---

### Q4. Does `go test -race` detect false sharing?

**Model answer.** No. The race detector finds *data races* — unsynchronised concurrent access to the same memory location. False sharing involves *different* memory locations and (typically) properly-synchronised atomic accesses. The race detector is silent.

**Follow-up.** *What tools do detect false sharing?* Microbenchmarks (run with `-cpu=1,2,4,8`), `perf c2c` on Linux, and hardware-counter sampling via `perf record -e cache-misses`.

---

### Q5. Is false sharing a correctness bug or a performance bug?

**Model answer.** Performance. The program produces correct results; it just runs slowly. There is no incorrect behaviour, no missed update, no panic — just throughput collapse under multi-core load.

---

### Q6. Why does a single atomic operation become slow under false sharing?

**Model answer.** Every atomic write requires the cache line to be in the *exclusive* state in the writing core's L1. If another core also holds the line (because it wrote to a neighbouring variable), the line must be invalidated there first. The invalidation message + ownership transfer takes 30-80 ns. Without false sharing, the same atomic costs ~5 ns.

---

### Q7. What is the difference between false sharing and true sharing?

**Model answer.** True sharing: multiple goroutines write the *same* variable. The cache-line bouncing is logically required. False sharing: multiple goroutines write *different* variables that happen to share a line. The bouncing has no semantic purpose; it is an artifact of cache granularity.

Padding fixes false sharing. Sharding (per-CPU variables, aggregated on read) fixes true sharing.

---

### Q8. What happens if you have eight `int64` counters in an array and eight goroutines each increment their own counter?

**Model answer.** All eight `int64`s pack into one 64-byte cache line. Every increment from any goroutine invalidates the line in every other goroutine's cache. The throughput collapses to roughly single-core speed or worse, despite eight cores being available.

**Follow-up.** *How do you fix it?* Pad each counter to 64 bytes:

```go
var counters [8]struct {
    v int64
    _ [56]byte
}
```

Now each counter is on its own cache line.

---

## Middle

### Q9. Why does `sync.Pool` pad its `poolLocal` struct to 128 bytes instead of 64?

**Model answer.** Intel CPUs have an L2 cache prefetcher that fetches pairs of adjacent 64-byte cache lines together (as a 128-byte unit). Even with 64-byte padding, the prefetcher can pull a neighbouring line into the same coherence event, creating prefetcher-induced false sharing. Padding to 128 bytes protects against this.

**Follow-up.** *On what architectures does this matter?* Primarily Intel x86-64. AMD and ARM have less aggressive adjacent-line prefetching; 64-byte padding is usually sufficient there.

---

### Q10. Walk me through designing a sharded counter library for a high-throughput Go service.

**Model answer.**

1. **Shard count**: `runtime.GOMAXPROCS(0)`. One shard per core means writes from different cores hit different shards.
2. **Layout**: each shard is a struct sized to one cache line, with the counter at offset 0 and padding bytes filling the rest.
3. **Hash function**: caller supplies a shard ID (often a hash of the request key, or a per-goroutine ID).
4. **Increment**: `atomic.AddInt64` on the chosen shard. ~5 ns uncontended.
5. **Read**: sum all shards. O(N) atomic loads.
6. **Layout test**: a unit test that asserts `unsafe.Sizeof(shard{}) == 64`.

The result scales linearly with cores up to GOMAXPROCS, with no contention on writes.

**Follow-up.** *What about NUMA?* For multi-socket servers, group shards by socket; aggregate per-socket and globally with a hierarchical structure.

---

### Q11. What does `perf c2c` report, and how do you interpret it?

**Model answer.** `perf c2c` (cache-to-cache) tracks cache-line transfers between cores. The report lists cache lines by total HITM (hit-modified) events. For each hot line, it shows:

- Total HITM count.
- Per-CPU breakdown.
- Source file:line of accesses (with debug info).
- Annotation of "false sharing detected" on individual offsets.

A line with high HITM counts from multiple different CPUs writing to *different offsets* within the line is a classic false-sharing hot spot. The fix: pad the containing struct.

---

### Q12. Compare a `sync.Mutex` and a padded atomic counter under high contention.

**Model answer.**

- `sync.Mutex`: serialises all writers through one lock. Throughput is independent of core count and bounded by the lock's overhead (~25 ns/lock-unlock pair).
- Padded atomic counter (sharded): each core writes its own shard. Throughput scales linearly with cores; each increment costs ~5 ns.
- *Unpadded* atomic counter shared across all cores: under contention, throughput drops to single-core speed or worse (~30-100 ns/op) due to cache-line bouncing.

For high-rate counters: padded sharded atomic is fastest. For low-rate counters: any solution is fine. For mutual-exclusion of complex critical sections: mutex (atomics cannot replace mutexes for multi-variable updates).

---

### Q13. Can read-only access cause false sharing?

**Model answer.** No. Multiple cores reading the same line both hold *shared* copies; no invalidation traffic, no bouncing. False sharing requires at least one *writer*. A read-only data structure shared across cores is cache-friendly.

**Follow-up.** *What if one core writes and others read?* That is one-writer-many-readers. Each write invalidates readers' copies. Readers must re-fetch on next read. The line bounces between writer and readers, but readers do not bounce among themselves. This is *true sharing*; the fix is to write less often or use immutable-published patterns.

---

### Q14. How does the Go runtime avoid false sharing in `sync.Pool`?

**Model answer.** Each P has its own `poolLocal` slot in an array. The `poolLocal` struct is explicitly padded to 128 bytes (a multiple of cache line, defensive against Intel's adjacent-line prefetcher). The runtime pins goroutines to their current P via `runtime_procPin` for the duration of pool operations, ensuring per-P slot access is single-writer.

This combination — padded slots + pin-to-P — eliminates both false sharing and most coherence traffic for the hot path.

---

### Q15. What is a goroutine pool, and how does false sharing affect its design?

**Model answer.** A goroutine pool is a fixed set of worker goroutines that consume from a shared queue. Two false-sharing concerns:

1. **Producer/consumer indexes**: if `head` (written by producers) and `tail` (written by consumers) share a cache line, every operation bounces the line. Pad them apart.
2. **Per-worker statistics**: if each worker has a `processed` counter and they all live in a contiguous slice, the counters false-share. Pad each worker struct to a cache line.

A well-designed pool addresses both.

---

### Q16. Explain MESI in your own words.

**Model answer.** MESI tracks the state of each cache line in each core's L1: Modified (this core holds the only copy, and it differs from RAM), Exclusive (this core has the only copy, matches RAM), Shared (multiple cores have read-only copies), Invalid (no valid copy here).

Writes require the line in Modified state, which means invalidating all other cores' copies. Reads can be served from Shared, Exclusive, or Modified. False sharing keeps two cores alternating between Modified and Invalid for the same line, with traffic on every transition.

---

### Q17. What is the relationship between false sharing and NUMA?

**Model answer.** NUMA (Non-Uniform Memory Access) means different cores have different latencies to different memory regions. A cache-line bounce within a socket is ~30-80 ns; across sockets is 100-300 ns. False sharing across NUMA nodes is 3-10x more expensive than within a node.

Mitigations:
- Pin processes to sockets (one Go process per socket).
- Allocate per-socket memory.
- Aggregate per-socket-and-globally with hierarchical sharding.

The Go runtime does not currently expose NUMA-aware primitives; user code handles this at the application or deployment level.

---

### Q18. How do you write a benchmark that demonstrates false sharing?

**Model answer.** Two struct types: adjacent (multiple ints packed) and padded (each int on its own cache line). N goroutines each increment one index in a tight loop. Run at `-cpu=1` (baseline) and `-cpu=8` (contended).

```go
func BenchmarkAdjacent(b *testing.B) {
    a := &Adjacent{}
    var wg sync.WaitGroup
    workers := 8
    wg.Add(workers)
    b.ResetTimer()
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
```

At `-cpu=8`, adjacent is 10-20x slower than padded. At `-cpu=1`, they are equal.

---

## Senior

### Q19. Design a high-throughput metrics library for a service handling 1M requests/sec.

**Model answer.** Requirements: writes are hot (multiple per request); reads are periodic (every few seconds). Approach:

1. **Per-CPU sharded counters**: one shard per `GOMAXPROCS`. Each shard is a 64-byte-padded struct with counters for relevant metrics (latency sum, latency count, errors, etc.).
2. **Shard selection**: cheap goroutine-to-shard hash, ideally via `runtime_procPin` for ~5ns selection cost.
3. **Read aggregation**: sum all shards on read; cost is O(NumCPU) ~30 atomic loads.
4. **Hierarchical aggregation** (optional): for very large servers (NUMA), aggregate per-socket and globally with a background goroutine; read serves from global with bounded lag.
5. **Storage**: in-memory atomic counters; periodically flush to time-series DB (Prometheus, InfluxDB).
6. **Documentation**: caller knows to pass a stable shard hint per request.

**Follow-up.** *What if I have 100,000 unique metric names?* Use a `sync.Map` of name → counter, with the counter itself being a sharded structure. Sparse access patterns reduce contention; high-cardinality keys are spread out.

---

### Q20. Explain the cost model for cache-line bouncing.

**Model answer.**

```
T_op = T_uncontended + P_bounce * T_bounce

T_uncontended ≈ 5 ns (atomic on L1-resident line)
T_bounce ≈ 30 ns intra-socket, 150 ns cross-socket
P_bounce ≈ 1 - 1/N for N concurrent writers
```

For 8 cores hammering one line: `T_op ≈ 5 + (7/8) * 30 ≈ 30 ns`, vs ~5 ns uncontended. The 6x degradation per op, multiplied by 8 cores in parallel, looks like effectively single-core throughput.

Padding eliminates `P_bounce`. Speedup: roughly `T_bounce / T_uncontended * concurrency factor`, often 10-20x for 8-core systems.

---

### Q21. How does Go's scheduler handle work stealing, and what false-sharing risks does it have?

**Model answer.** Each P has a runqueue (256-entry array with head/tail indices). When a P's queue is empty, it steals half of another P's queue via CAS on the source's `runqhead`.

Risks:
- The local P writes `runqtail`; the stealer writes `runqhead`. If they share a cache line, every local enqueue / steal causes a bounce.
- Mitigated by the runtime placing other fields between them (so they are typically on different cache lines in modern Go versions).
- Cross-CPU CAS during stealing is expensive; the protocol is designed so stealing is rare (only on local-empty conditions).

The Go runtime has historically tuned this layout; it remains under active improvement.

---

### Q22. What is `runtime_procPin`, and when should you use it?

**Model answer.** `runtime_procPin` is an internal runtime function (accessible via `go:linkname`) that pins the current goroutine to its current P (and thus its OS thread) for the duration of the call. It returns the P's ID; `runtime_procUnpin` releases.

Use cases:
- Accessing a per-P data structure without atomics (since you are guaranteed to be on the same P).
- Avoiding preemption during a very short critical section.

Risks:
- Pinning disables preemption, so a long-running pin can disrupt scheduling.
- A pinned goroutine cannot be migrated; if it blocks on I/O, the M may be parked.
- The function is internal; future runtime changes may break its API.

Use sparingly. Typical pin windows are sub-microsecond.

---

### Q23. Walk through finding a false-sharing bug in a production service using `perf c2c`.

**Model answer.**

1. **Symptom**: p99 latency spikes correlate with traffic. CPU usage is high but throughput plateaus.
2. **Hypothesis**: a hot shared variable is bottlenecking.
3. **Capture**: `sudo perf c2c record -F 5000 -p $(pidof service) sleep 30` during peak load.
4. **Report**: `sudo perf c2c report --stdio`. Look at top cache lines by HITM count.
5. **Identify**: the report shows a struct's field at high HITM, with hits from multiple CPUs at *different offsets within the same line*. This is the signature of false sharing.
6. **Diagnose**: in code, the struct has multiple counters used by different goroutines. They share a cache line.
7. **Fix**: add `[56]byte` padding between the counters; verify struct sizes with `unsafe.Sizeof`.
8. **Verify**: re-run `perf c2c`; HITM count drops by orders of magnitude. p99 latency returns to baseline.

---

### Q24. When should you *not* pad?

**Model answer.** Padding wastes memory. Do not pad:

- **Read-only data**. No coherence traffic exists.
- **Single-writer data**. The line stays exclusive on the writer's core; no bouncing.
- **Cold data**. If the variable is updated infrequently (< 100K ops/sec/core), false sharing cost is negligible.
- **Already-isolated allocations**. A separately-allocated struct does not share lines with other allocations.
- **Code paths where memory pressure matters more than throughput**. Padding bloats working sets and may cause L1/L2 cache misses to dominate.

Always benchmark before padding. Padding without measurement is cargo culting.

---

### Q25. Compare the Go runtime's approach to false sharing avoidance with Java's `@Contended`.

**Model answer.**

- **Go**: manual padding via struct fields. `runtime/internal/sys.CacheLinePad` is internal; user code defines its own constants. No language-level support.
- **Java**: `@Contended` annotation (JEP 142, Java 8+). The JVM inserts padding automatically. Disabled by default; enabled with `-XX:-RestrictContended`. Used in `java.util.concurrent` extensively.

Tradeoffs: Go's approach is more explicit and predictable; Java's is more ergonomic. Both achieve the same hardware effect.

The pattern at the hardware level — pad to 64 or 128 bytes — is identical. Only the syntax differs.

---

### Q26. How would you teach a junior engineer about false sharing?

**Model answer.**

1. Start with a benchmark: have them write Adjacent vs Padded counters, run at `-cpu=1,8`, see 20x difference.
2. Show `unsafe.Sizeof` and `unsafe.Offsetof` to verify layout.
3. Walk through `sync.Pool` source to show real-world padding patterns.
4. Demonstrate `perf c2c` on a stress test.
5. Have them review a piece of concurrent code and identify potential hotspots.
6. Discuss when *not* to pad — emphasise measurement.
7. Connect to memory model: padding is performance, not correctness.

The goal: they leave with a mental model (lines, not bytes) and a tool (benchmarks + perf) to apply it.

---

## Staff / Principal

### Q27. Design a cache-aware lock-free MPMC (multi-producer, multi-consumer) queue in Go.

**Model answer.** Use the Dmitry Vyukov bounded queue design adapted for Go:

1. **Layout**: producer state (`enq`) and consumer state (`deq`) each on their own cache line (padded). Buffer follows.
2. **Slot design**: each slot has a sequence counter (atomic) and a value. Producers CAS the sequence to claim a slot for writing; consumers CAS to claim for reading. Pad slots if expected high contention.
3. **Memory ordering**: use `atomic.Load*` with release/acquire semantics implicit in Go's atomics.
4. **Capacity**: power-of-two for fast modular indexing via mask.
5. **Padding**: enq state, deq state, and metadata each on separate cache lines.

```go
type Queue struct {
    head atomic.Uint64
    _    [56]byte
    tail atomic.Uint64
    _    [56]byte
    mask uint64
    buf  []slot
}

type slot struct {
    seq atomic.Uint64
    val interface{}
    _   [40]byte // pad if slots are hot
}
```

Properties: each producer writes a slot, reads (and CASes) the head, occasionally checks the tail. Each consumer writes a slot's seq, reads (and CASes) the tail, occasionally checks the head. Head and tail are on separate lines, so producer-consumer don't false-share. Slot padding optional based on contention pattern.

---

### Q28. A team's metrics library shows 200% CPU on a single core under load, but other cores are idle. What might be happening?

**Model answer.** Several possibilities, in decreasing order of likelihood:

1. **All goroutines hit one shard**. The shard hash is broken (e.g., always returns 0). The single shard's cache line is hammered. Other cores are idle waiting for the lock or atomic to complete.
2. **Goroutine pinned via `runtime.LockOSThread`** to one core, with all work funnelling through it.
3. **A `sync.Mutex` is the bottleneck**, serialising all writers through one goroutine on one core. Other goroutines are blocked waking.
4. **False sharing across shards** is so bad that throughput collapses; only one core can hold the line in modified state at a time.

Diagnose with `pprof` (which goroutines are running where) and `perf c2c` (which cache lines are bouncing). Fix depending on root cause: better hash, sharding, padding.

---

### Q29. How does the Linux kernel's per-CPU variable system compare to Go's `runtime_procPin`?

**Model answer.**

- **Linux**: kernel exposes `DEFINE_PER_CPU(type, name)` macros, with `get_cpu_var(name)` / `put_cpu_var(name)` for safe access. Disables preemption during the section. Per-CPU memory is physically per-CPU (NUMA-local). Used pervasively for stats, allocators, RCU.
- **Go**: `runtime_procPin` pins to a P (≈ scheduler unit, not OS CPU directly). The P-to-CPU mapping is fluid (a P moves between OS threads, which the OS scheduler moves between CPUs). Memory is shared; per-P data is logical, not physical.

Cross-language lesson: Linux makes per-CPU explicit and physical; Go makes per-P implicit and logical. Both achieve similar throughput characteristics but with different guarantees.

---

### Q30. You have a 32-core server with two sockets. What architectural changes might you make to your Go service to fully utilise it without false sharing pain?

**Model answer.**

1. **Two Go processes**, one per socket, each with `GOMAXPROCS=16`. Pin each process via `numactl --cpunodebind=0` and `--cpunodebind=1`. Memory allocation goes to the local node.
2. **Inter-process communication** via Unix domain sockets, shared memory (mmap), or local TCP. Aim for batching to amortise IPC cost.
3. **Within each process**, 16-shard sharded counters with cache-line padding.
4. **For shared state** (cross-socket): minimise. Use eventual-consistency patterns. Aggregate per-socket and reconcile periodically.
5. **Load balancing**: a front-end balancer routes requests to the local-socket process based on key affinity.

This avoids the worst case (cross-socket cache-line bouncing) while preserving multi-core scaling within each socket. It also gives independent failure domains.

**Alternative**: a single Go process with `GOMAXPROCS=32`. Pros: simpler architecture, less IPC. Cons: cross-socket cache traffic for shared state; no NUMA awareness in Go runtime, so per-P caches may live on remote sockets.

The right choice depends on shared-state size and access patterns.

---

### Q31. Explain why the Go runtime uses 128-byte padding in some places but 64-byte in others.

**Model answer.** The runtime is conservative with memory, padding only where measurement justifies it.

- **64-byte padding**: sufficient for coherence-level false-sharing avoidance on amd64/arm64. Used in places where the prefetcher is not a major concern (e.g., between cold fields).
- **128-byte padding**: used in `sync.Pool.poolLocal` because pools are heavily contended and Intel's adjacent-line prefetcher (operating in 128-byte units) could cause additional false sharing.

The choice is driven by:
1. Measured contention in benchmarks.
2. Memory cost of doubling padding.
3. Architecture-specific prefetcher behaviour.

Reading the source comments in `sync/pool.go` shows the reasoning explicitly.

---

### Q32. Suppose a future architecture uses 256-byte cache lines. What would change in the Go runtime?

**Model answer.**

1. `runtime/internal/sys.CacheLineSize` would change to 256 for that arch.
2. `CacheLinePad` automatically becomes `[256]byte`.
3. `sync.Pool.poolLocal`'s padding (currently `128 - sizeof%128`) would re-tune to `256 - sizeof%256`.
4. Memory cost of all padded structures roughly doubles.
5. Benchmarks would need to be re-run; some structures might be too costly to pad and would use a different design (e.g., further sharding).
6. The race detector, GC, and other runtime parts are unaffected (cache lines are below their abstraction).

User code that hardcoded `[56]byte` or `64` would be incorrect for the new architecture. Best practice is to compute padding from `CacheLineSize` or use the `runtime/internal/sys` constant via `go:linkname`.

---

### Q33. Should false-sharing awareness be a regular part of code review?

**Model answer.** For hot-path concurrent code, yes. For most application code, no.

Yes-cases:
- Per-CPU statistics.
- Lock-free queues / stacks.
- High-throughput message buses.
- Connection pools.
- Caches.

No-cases:
- HTTP handlers operating at ms-scale.
- Database query code.
- Cold initialisation paths.

The skill is recognising which category a piece of code falls into. A reviewer who flags every potentially-shared int as "consider padding" creates noise; one who flags hot arrays of counters caught at the right moment adds value.

---

### Q34. How do you avoid false-sharing regressions in a large codebase?

**Model answer.** Several techniques:

1. **Benchmark suites in CI**: scaling benchmarks (`-cpu=1,2,4,8,16`) that fail if regressions appear.
2. **`unsafe.Sizeof` unit tests** for padded structs.
3. **Comments**: every padding field has a comment explaining its purpose.
4. **Centralised padding types**: `cachepad.Line`, `cachepad.Pad56` in an internal package. Easier to grep and reason about.
5. **Code review checklists**: explicit "are there hot fields in this struct" questions.
6. **Production telemetry**: hardware counter sampling identifies new hot spots.
7. **Periodic re-profiling**: every major release, run `perf c2c` against load tests to catch drift.

---

### Q35. Write a Go function that, given two pointers, tells whether they share a cache line.

**Model answer.**

```go
import "unsafe"

const cacheLine = 64

func SameLine(a, b unsafe.Pointer) bool {
    return uintptr(a)/cacheLine == uintptr(b)/cacheLine
}
```

Usage:

```go
type S struct { x, y int64 }
var s S
fmt.Println(SameLine(unsafe.Pointer(&s.x), unsafe.Pointer(&s.y)))
// true: x and y are adjacent (16 bytes total), share a line
```

For diagnostic use during development. In production code, struct layout should be designed up-front, not checked at runtime.

---

### Q36. Why doesn't Go provide native `alignas(64)` or similar?

**Model answer.** A few reasons:

1. **Portability**: cache line size varies (64, 128, 32 across architectures). A language-level annotation would either need to be architecture-aware (compilation complexity) or accept a constant (still leaves user choice).
2. **Memory cost**: automatic padding is a tax all users pay; manual padding lets users opt in.
3. **Philosophical**: Go prefers explicit over implicit. Padding is an optimisation decision; making it explicit communicates intent.
4. **Sufficiency**: `[N]byte` is enough. The community convention is well-established.

Future Go versions might add an annotation, but as of Go 1.22+, manual padding is the path.

---

### Q37. Describe a war story where false sharing caused a production incident.

**Model answer.** *(A model story; adapt to your experience.)*

A metrics library used a single `atomic.Int64` per metric, hashed by name into a `sync.Map`. Under load (10K req/s), p99 latency was 100ms — well within SLA. We scaled to 100K req/s expecting linear growth in CPU. Instead, CPU saturated at 200% (effectively single-core), p99 spiked to 500ms, and throughput plateaued.

Investigation: `pprof` showed `atomic.AddInt64` at the top. `perf c2c` showed three hot metrics' counters all on the same cache line (allocation alignment). The three metrics were each updated thousands of times per second by different goroutines; the line was bouncing on every increment.

Fix: replaced single atomics with sharded-and-padded counters. p99 returned to 100ms; throughput scaled linearly with cores.

Lesson: hot metrics need cache-line-aware structures from the start. The bug was latent for months until traffic crossed the threshold; it would have been catastrophic if it surfaced during a peak event.

---

## Tricky / Trap Questions

### TQ1. If I add padding to my struct, will it slow down the program in cases without contention?

**Answer.** Slightly. Larger structs mean fewer fit in L1, and copies (by-value passing) cost more. For a benchmark that exercises a single goroutine, padded versions are sometimes 1-2% slower (cache pressure). The benefit is in multi-core scenarios.

Best practice: pad only where you have measured contention. Padded structs pay a small cost everywhere for a large benefit in hot paths.

---

### TQ2. Is `atomic.Int64` already padded?

**Answer.** No. `atomic.Int64` is an 8-byte type; the wrapper does not introduce padding. To pad, wrap it:

```go
type Padded struct {
    v atomic.Int64
    _ [56]byte
}
```

---

### TQ3. What is `runtime.LockOSThread`'s effect on cache locality?

**Answer.** None directly. It pins the goroutine to its current OS thread, but the OS can still migrate that thread between cores. For cache locality you need both `LockOSThread` and OS-level affinity (`sched_setaffinity` on Linux, `taskset`).

---

### TQ4. Does the Go GC affect false sharing?

**Answer.** The GC walks pointer fields during marking. Padded structs (with `[N]byte` padding) have no pointer fields in the padding, so GC walks are unaffected. However, GC operations can briefly touch struct metadata and headers, causing transient line bounces. For pathological cases (very frequent GCs touching very hot structs), this can degrade benchmark numbers, but it is rarely the dominant cost.

---

### TQ5. Why is `sync.Mutex` not padded?

**Answer.** `sync.Mutex` is small (8 bytes) and its hot path (uncontended fast path) is a single atomic CAS. False sharing on adjacent mutexes is rare because the *containing struct* is usually larger and naturally separates them. If you place mutexes in an array, *you* should pad the container:

```go
type PaddedMutex struct {
    sync.Mutex
    _ [56]byte // pad container to 64
}
```

The standard library leaves this to the caller for flexibility.

---

### TQ6. Can two read-mostly counters in different goroutines false-share?

**Answer.** Yes, if either is occasionally written. Reads alone never bounce, but a write from one goroutine invalidates the other's read. If reads vastly outnumber writes, the cost is small (a few invalidations per second). If writes are frequent (even if reads are more frequent), false sharing applies.

---

### TQ7. Is false sharing more or less of a problem in Go than in C++?

**Answer.** The same. The hardware mechanism is identical. The difference is in syntax: C++ has `alignas(64)` and `std::hardware_destructive_interference_size`; Go uses manual `[N]byte` padding. Both achieve the same effect.

Go's garbage collector adds occasional metadata touches that can momentarily share lines, but this is a minor effect not specific to Go.

---

### TQ8. If I run my benchmark on a hyperthreaded core (two logical CPUs on one physical), will it show false sharing?

**Answer.** No, or weakly. Hyperthreads share L1 cache; their "false sharing" is just shared cache access, not coherence bouncing. To reliably reproduce false sharing, use two physical cores. On Linux: `taskset -c 0,2 ./benchmark` to pin to two even-numbered cores (often the two physical cores in a hyperthread pair).

---

That is the interview question bank for false sharing in Go. Practice these out loud — explaining cache coherence verbally is harder than reading about it.
