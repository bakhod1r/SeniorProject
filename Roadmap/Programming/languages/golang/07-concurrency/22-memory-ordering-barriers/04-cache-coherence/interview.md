---
layout: default
title: Cache Coherence — Interview
parent: Cache Coherence
grand_parent: Memory Ordering Barriers
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/22-memory-ordering-barriers/04-cache-coherence/interview/
---

# Cache Coherence — Interview Questions

A graded set of interview questions from junior through staff. Each comes with a sample answer.

---

## Junior Level

### Q1: What is a cache line?

**A:** The smallest unit of memory that the CPU cache transfers in and out. On x86 and most ARM cores it is 64 bytes. On Apple silicon it is 128 bytes. The hardware never moves less than a whole line.

### Q2: What is false sharing?

**A:** When two logically independent variables sit on the same cache line, and updates to one force coherence traffic (invalidations) on the line containing both. Even though no code mentions the variables together, the hardware treats the line as one unit. Symptoms: parallel code that does not scale.

### Q3: How do you fix false sharing?

**A:** Pad the variables apart so each lives on its own cache line. In Go, use `cpu.CacheLinePad` or anonymous `_ [56]byte` fields between hot variables.

### Q4: Are atomic operations cheap?

**A:** No. On x86, `atomic.AddInt64` is roughly 6 nanoseconds uncontended — about 20× slower than a plain `++`. Under contention, it can exceed 30 ns. Atomics ride on the same cache coherence machinery as plain writes, plus a memory fence.

### Q5: How do you measure if your code has false sharing?

**A:** Three steps:
1. Run benchmarks with `-cpu=1,2,4,8` and look for sublinear scaling.
2. Use `pprof` to look for atomic and mutex functions at the top.
3. On Linux, run `perf c2c` which reports hot cache lines and HITM events.

### Q6: What does `sync.Pool` do and why is it fast?

**A:** It provides a per-P (per scheduler processor) cache of reusable objects. The hot path touches only the current P's slot — no cross-core coherence. Each slot is padded to 128 bytes for safety on Apple silicon.

### Q7: What is the cache line size on Apple silicon?

**A:** 128 bytes on the performance cores. Padding meant for x86 (56 bytes after an 8-byte field) is insufficient on M1/M2/M3.

### Q8: Why is `runtime.LockOSThread` not sufficient for cache locality?

**A:** It pins a goroutine to its OS thread, but the OS can still migrate the thread between physical cores. For true cache locality, combine with `cgo` and `sched_setaffinity` to bind the thread to a specific core.

### Q9: What is the difference between `atomic.AddInt64` and `++` on an int64?

**A:** `atomic.AddInt64` is indivisible across goroutines and includes a memory fence. `++` is not atomic and is racy if shared. The atomic version costs about 20× more per operation on uncontended access, much more under contention.

### Q10: What is the role of `cpu.CacheLinePad`?

**A:** A type from `golang.org/x/sys/cpu` that, when included as a field, pads the struct so the next field starts on a new cache line. Sized at build time per architecture (64 bytes on x86, 128 on Apple).

---

## Middle Level

### Q11: Explain MESI.

**A:** A four-state cache coherence protocol. A cache line in a core's cache can be in:
- Modified (M): this core has the only valid copy, dirty.
- Exclusive (E): this core has the only valid copy, clean.
- Shared (S): multiple cores have copies, all clean.
- Invalid (I): no valid copy.

Reads are cheap from M, E, S. Writes from S require invalidating other copies (expensive). Writes from M are local (cheap).

### Q12: What happens at the hardware level when two cores both do `atomic.AddInt64` on the same variable?

**A:** Each operation requires the line in M state on the executing core. The first core's write puts the line in M; the second core's request issues an RFO (Read-For-Ownership), which invalidates the first core's copy. The line bounces between the cores. Under sustained contention, each operation takes roughly the cross-core invalidation latency (~30ns same-socket).

### Q13: What is a store buffer?

**A:** A per-core queue of pending stores that have retired in program order but not yet drained to L1. The store buffer allows out-of-order execution. A LOCK-prefixed instruction (or MFENCE) flushes the store buffer.

### Q14: Why is `atomic.LoadInt64` cheaper than `atomic.StoreInt64` on x86?

**A:** On x86, plain loads are acquire by default (TSO model). `atomic.LoadInt64` compiles to a plain MOV — cheap. Stores require a fence to ensure global visibility; `atomic.StoreInt64` typically compiles to XCHG (implicitly LOCKed) — expensive.

### Q15: How is ARM's atomic implementation different from x86's?

**A:** Two ways:
1. Memory model: ARM is weak; explicit fences (DMB ISH) are needed for cross-location ordering. x86's TSO does it implicitly.
2. Atomic instructions: ARMv8 uses LL/SC (LDXR/STXR) or LSE (LDADD, CAS). x86 uses LOCK prefix. LL/SC can livelock under heavy contention; LSE is direct.

### Q16: Why does `sync.RWMutex` sometimes perform worse than `sync.Mutex`?

**A:** `RWMutex` has internal state (reader counter, writer signal) that is mutated on every RLock and RUnlock. The state's cache line bounces among readers. For short critical sections, this overhead exceeds the gain. `RWMutex` wins only when the critical section is long enough to amortise the overhead.

### Q17: What does `perf c2c` do?

**A:** Linux tool that captures hardware events related to cache-to-cache transfers. The report aggregates per cache line, showing which addresses are hot, which cores are reading/writing, and the HITM (Hit-Modified) counts that indicate false sharing.

### Q18: Explain per-CPU sharding.

**A:** A pattern where a shared counter (or similar) is split into N slots, indexed by CPU or goroutine ID hash. Each slot is padded to a cache line. The hot path writes only to its own slot; coherence traffic is eliminated. Sum operations are O(N) but rare.

### Q19: What is the difference between MESI and MOESI?

**A:** MOESI adds an Owned (O) state to MESI. A line in O state is dirty (different from memory) AND shared with other cores. The Owned core forwards the data to readers and is responsible for write-back. This delays the write-back, saving memory bandwidth. AMD chips use MOESI; Intel uses MESIF.

### Q20: When would you choose `sync.Map` over a sharded mutex map?

**A:** When the workload is read-heavy (>10:1) with a stable key set. `sync.Map` uses a snapshot-based read path that is faster than any locked read. For write-heavy or churning key sets, sharded maps with mutexes are usually faster.

---

## Senior Level

### Q21: Design a per-CPU sharded counter library.

**A:** Sketch:

```go
type Counter struct {
    shards []paddedInt64
    mask   uint64
}

type paddedInt64 struct {
    v atomic.Int64
    _ cpu.CacheLinePad
}

func New() *Counter {
    n := nextPow2(runtime.GOMAXPROCS(0))
    return &Counter{shards: make([]paddedInt64, n), mask: uint64(n - 1)}
}

func (c *Counter) Add(hint uint64, d int64) {
    c.shards[hint&c.mask].v.Add(d)
}

func (c *Counter) Sum() int64 {
    var s int64
    for i := range c.shards {
        s += c.shards[i].v.Load()
    }
    return s
}
```

Considerations:
- Number of shards: power-of-two of GOMAXPROCS for fast modulo.
- Hint: caller passes a fast-changing value for distribution.
- Memory: ~64 × NumCPU bytes per counter.
- Read consistency: Sum is eventually accurate; concurrent writes are visible asynchronously.
- Per-P variant: use `runtime.procPin/Unpin` for guaranteed CPU-shard match.

### Q22: How do you NUMA-tune a Go service?

**A:** Three layers:
1. **Process pinning**: Use `numactl --cpunodebind=N --membind=N` to bind the process.
2. **Per-socket sharding**: Run one process per NUMA node and load-balance externally.
3. **Memory locality**: Ensure goroutines touch memory allocated on their node (Linux first-touch). This often requires `cgo` and `sched_setaffinity`.

For most cloud Go services, NUMA is invisible (single-node VM). For bare metal: process-per-node is the simplest pattern.

### Q23: Why is `runtime.LockOSThread` insufficient for NUMA isolation?

**A:** It pins goroutine to OS thread; the OS may schedule the thread on any CPU. For true CPU pinning, need cgo `sched_setaffinity`. Combined: pin goroutine to thread, pin thread to core.

### Q24: Walk through `sync.Pool`'s hot path.

**A:**
1. `pin()` calls `runtime.procPin()` to prevent goroutine migration. Returns pointer to current P's `poolLocal`.
2. Check `local.private` (single-slot per-P stash). If non-nil, return it; clear the slot.
3. If private is nil, try `local.shared.popHead()` — atomic op on the local P's shared deque.
4. If shared head is empty, slow path: try stealing from other Ps' shared tails or victim cache.
5. `procUnpin()`.
6. If still nil and `New` is set, call `New`.

The hot path is private slot check — zero coherence with other Ps.

### Q25: Compare `sync.Map` with a sharded mutex map. When is each better?

**A:**
- `sync.Map`: read-mostly with stable keys. Snapshot-based read is essentially free.
- Sharded mutex map: write-heavy or churning keys. Each shard is independent; locks scale to NumShards-fold parallelism.

For roughly 90:10 read:write with stable keys, `sync.Map` wins. For 50:50 or write-heavy, sharded maps win. Benchmark to confirm.

### Q26: How does the Go GC interact with cache coherence?

**A:**
- Write barrier: each pointer write during marking records to a per-P buffer. Per-P access avoids coherence. Periodic flush to global buffer is a brief coherence event.
- Mark assist: when heap grows fast, mutator goroutines do marking work; touches shared mark state.
- STW phases: short (sub-millisecond) sync points; all Ps touch barriers; brief coherence events.
- For pointer-heavy workloads, write barrier overhead is visible during marking. Reduce pointers in hot paths to mitigate.

### Q27: Explain Read-For-Ownership.

**A:** A coherence operation issued when a core wants to write to a cache line it does not hold in Modified or Exclusive state. The RFO causes the fabric to invalidate all other copies of the line and grant this core Modified state. RFOs are expensive: ~30ns same-socket, ~200ns cross-socket. RFO storms (many cores contending) collapse throughput.

### Q28: Design a lock-free SPSC ring buffer.

**A:**

```go
type Ring[T any] struct {
    write atomic.Uint64
    cachedRead uint64
    _ cpu.CacheLinePad

    read atomic.Uint64
    cachedWrite uint64
    _ cpu.CacheLinePad

    buf  []T
    mask uint64
}

func (r *Ring[T]) Push(v T) bool {
    w := r.write.Load()
    if w-r.cachedRead >= uint64(len(r.buf)) {
        r.cachedRead = r.read.Load()
        if w-r.cachedRead >= uint64(len(r.buf)) {
            return false
        }
    }
    r.buf[w&r.mask] = v
    r.write.Store(w + 1)
    return true
}

func (r *Ring[T]) Pop() (T, bool) {
    var zero T
    rr := r.read.Load()
    if rr == r.cachedWrite {
        r.cachedWrite = r.write.Load()
        if rr == r.cachedWrite {
            return zero, false
        }
    }
    v := r.buf[rr&r.mask]
    r.read.Store(rr + 1)
    return v, true
}
```

Cached indices reduce cross-core reads. Padding isolates head and tail lines. Each side touches its own line in M state mostly.

### Q29: How would you set up CI to catch coherence regressions?

**A:** A CI job that:
1. Runs `go test -bench=. -count=10 -cpu=1,4,16 -benchtime=3s` on every PR.
2. Compares against a baseline using `benchstat`.
3. Fails if any benchmark regresses by more than a threshold (e.g., 10%).
4. Stores benchmark results as artifacts for trend analysis.

Additionally, a scaling benchmark that explicitly checks that ns/op stays within a tolerance from `-cpu=1` to `-cpu=16` would catch sublinear scaling.

### Q30: How would you operationalize cache-awareness on a fleet?

**A:**
- Continuous profiling (Pyroscope, Parca, or commercial).
- Alerts on top-function CPU percentages (atomics, mutexes).
- Periodic `perf c2c` runs in canary.
- Documented postmortem template for coherence incidents.
- Code review checklist including cache concerns.
- Mentoring plan for new engineers.

---

## Staff / Principal Level

### Q31: A new architecture (e.g., RISC-V) is being considered. What cache-aware design concerns would you raise?

**A:**
- Cache line size and alignment requirements.
- Memory model (likely weak; explicit fences needed).
- Atomic instruction availability (LSE-equivalent vs LL/SC).
- NUMA topology if multi-socket variants exist.
- Compiler support for `//go:align` and `cpu.CacheLinePad`.
- Performance counters available for diagnosis.
- Build tags needed for architecture-specific padding.

### Q32: Your company runs Go on multi-socket bare metal. Throughput is sublinear. What is your plan?

**A:**
1. Profile to confirm coherence is the issue (not network, disk, etc).
2. Run `perf c2c` to identify hot cache lines.
3. Apply per-CPU or per-socket sharding to those lines.
4. Consider running one process per NUMA node, load-balanced externally.
5. Pad shared mutexes and atomic state.
6. Add NUMA-aware monitoring and alerting.
7. Document architecture decisions for the team.

### Q33: Walk me through how `sync.Map`'s design balances read and write performance.

**A:** Two maps internally: `read` (atomically swappable) and `dirty` (mutex-protected). Reads hit `read.m[key]` via atomic load — no lock. If the key isn't in `read`, the read takes the mutex and checks `dirty` (miss path). After enough misses, `dirty` is promoted to a new `read`, atomic-swapped. Writes either update in-place via atomic CAS on the entry's pointer (if key in `read`) or take the mutex and update `dirty`. Trade-offs: hot reads are free; cold reads pay a mutex; writes are mutex-bound; promotion is O(N).

### Q34: What are the limits of cache-aware design in Go?

**A:**
- Cannot pin to physical cores without cgo.
- Cannot control NUMA placement without cgo and OS calls.
- Cannot directly issue cache-line operations (no `_mm_clflush` equivalent).
- Compiler does not auto-pad.
- Generics make padding math awkward.
- Per-P slots require unexported runtime functions.

Workarounds exist for all of these, but they involve unsafe code, build tags, or `go:linkname` to runtime. Acceptable for libraries; not for casual user code.

### Q35: How do you mentor a team to be cache-aware?

**A:**
1. Pair-program a fix on an actual coherence bug in the codebase.
2. Run benchmarks together; show the scaling collapse.
3. Apply the fix; show the improvement.
4. Document the pattern; add it to the team wiki.
5. Add CI benchmarks to enforce.
6. Code review the next coherence-related PR with the mentee.
7. Have the mentee teach the next person.

After ~3 months, the team has the foundation. After a year, it is reflex.

### Q36: Compare Go's approach to cache coherence with C++ and Rust.

**A:**
- **Go**: Manual padding via fields; cpu.CacheLinePad; sync.Pool for per-P. No compiler help.
- **C++**: `alignas(64)` for alignment; manual padding too; no built-in per-thread pools (Boost has alternatives).
- **Rust**: Crates like `crossbeam-utils::CachePadded`; channel implementations are cache-aware; nuanced ownership prevents some bugs.

All three rely on manual cache-aware design. Compiler help is minimal in all three. The patterns are universal.

### Q37: How would you contribute a cache-coherence improvement to the Go runtime?

**A:** Process:
1. Identify a concrete improvement (e.g., padding for a specific runtime struct).
2. Profile to demonstrate the issue (benchmarks at multiple `-cpu`).
3. Implement the fix.
4. Add benchmarks proving the improvement.
5. Open a CL on Gerrit (`go-review.googlesource.com`).
6. Engage reviewers; iterate.
7. Get approved and merged.

The bar is high. The Go team values correctness, simplicity, and broad benefit. A patch that helps one architecture but hurts another is unlikely to land.

### Q38: A junior engineer claims removing all padding will improve performance. How do you respond?

**A:** Politely ask for evidence. Request they run the existing benchmark suite. If the benchmarks show improvement (unlikely), accept. If not, demonstrate the regression and explain why padding is load-bearing. Update the layout documentation to make the invariant clearer.

### Q39: What is the future of cache coherence in Go?

**A:** Speculatively:
- Better per-P APIs (potentially exposing `procPin` officially).
- More aggressive compiler optimisations around atomics.
- NUMA awareness in the runtime (long discussion; uncertain).
- Better tooling for hardware counter access (cloud-friendly profiling).
- Generics-friendly padding patterns.

The fundamentals will not change. Cache lines and coherence are physical realities.

### Q40: Sum up cache coherence in Go in one paragraph.

**A:** Cache coherence is the hardware contract that keeps every CPU core's view of memory consistent. The unit of sharing is the cache line (64 or 128 bytes). Independent writes to the same line bounce between cores expensively. Atomic operations ride on coherence; they are not free. Padding isolates hot fields; sharding distributes contention; snapshot pointers enable cheap reads. The Go runtime is heavily cache-aware in its internals. Tools (`pprof`, `perf c2c`, `benchstat`, `-cpu` sweeps) diagnose issues. The economic argument is overwhelming at scale: a small layout fix can save large fleet costs. Apply the patterns; measure the results; mentor the team; ship Go that scales.

---

## Closing

These forty questions span junior to staff. A candidate fluent across all of them has deep cache-coherence knowledge.

For interviewers: pick a subset appropriate to the level. Listen for: precision, examples, trade-off reasoning.

For candidates: practise these answers. Internalise. Then bring concrete examples from your own work.

End of interview.md.

---

## Bonus Section: Twenty Quick-Fire Questions

For rapid-fire screening.

1. **Q:** Cache line size on x86? **A:** 64 bytes.
2. **Q:** Cache line size on Apple silicon? **A:** 128 bytes.
3. **Q:** What protocol manages cache coherence? **A:** MESI (or variants like MOESI).
4. **Q:** What does false sharing mean? **A:** Independent variables sharing a cache line, causing unintended invalidation.
5. **Q:** How do you fix false sharing? **A:** Padding to a cache line boundary.
6. **Q:** What is `cpu.CacheLinePad`? **A:** Portable padding type from `x/sys/cpu`.
7. **Q:** Are atomic operations free? **A:** No. They pay coherence cost plus fence cost.
8. **Q:** Name a Go primitive that uses per-P state. **A:** `sync.Pool`.
9. **Q:** What is `runtime.LockOSThread`? **A:** Pins goroutine to OS thread; not to CPU.
10. **Q:** How do you detect false sharing on Linux? **A:** `perf c2c`.
11. **Q:** When is `sync.Map` better than a sharded map? **A:** Read-heavy with stable keys.
12. **Q:** What is MESI? **A:** Four-state cache coherence (Modified, Exclusive, Shared, Invalid).
13. **Q:** What is RFO? **A:** Read-For-Ownership, coherence message for exclusive write access.
14. **Q:** What is a store buffer? **A:** Per-core queue of pending stores.
15. **Q:** Why does ARM use LL/SC? **A:** Weak memory model atomic RMW primitive.
16. **Q:** What is `benchstat` for? **A:** Statistical comparison of Go benchmarks.
17. **Q:** What does `-cpu=N` in `go test -bench` do? **A:** Sets GOMAXPROCS for the run.
18. **Q:** How many waiter bits does sync.Mutex use? **A:** All bits above bit 3.
19. **Q:** What is the snoop filter? **A:** Hardware table tracking which cores hold each line.
20. **Q:** What is NUMA? **A:** Non-Uniform Memory Access; memory cost varies by socket.

Quick-fire format helps screen for fluency.

---

## Bonus Section: Five Design Whiteboard Questions

Ask candidates to design, on a whiteboard, in 15-20 minutes each.

### Design 1: A per-CPU counter for a metrics library

Expected: padded struct, sharded by GOMAXPROCS, hint-based shard selection, O(N) Sum.

### Design 2: A snapshot-based config store

Expected: `atomic.Pointer[Config]`, padded, Set/Get methods, immutable snapshots.

### Design 3: A lock-free SPSC queue

Expected: padded head/tail, cached indices, wait-free Push/Pop.

### Design 4: A sharded mutex registry

Expected: array of padded mutexes, hash-based selection, no global mutex.

### Design 5: A high-throughput HTTP server's request handler

Expected: hot path avoids mutex; uses snapshot pointer for config; per-CPU counters for stats; sync.Pool for buffers.

Listen for: layout reasoning, trade-off articulation, awareness of edge cases.

---

## Bonus Section: A Final Reflection on Interviewing for This Topic

Interviewing for cache-coherence knowledge is hard because:

- Most candidates have never measured false sharing.
- Many "senior" candidates conflate coherence with consistency.
- Performance questions tempt over-explanation.

Good signals:
- Mentions concrete tools (pprof, perf c2c, benchstat).
- Articulates trade-offs (padding has memory cost; sharding has merge cost).
- References standard library examples (sync.Pool, sync.Map).
- Acknowledges hardware variation (Apple vs x86).
- Defaults to "I would measure" rather than "I would assume."

Red flags:
- "Always pad everything."
- "Atomics are free."
- "RWMutex is always faster for reads."
- "Lock-free is always best."

A candidate who can defend cache-aware design with specific examples from their own code is at senior+ level.

End of interview.md.

---

## Long Bonus: Ten More Advanced Questions

### Q41: How would you tune `GOMAXPROCS` in a container with CPU quota?

**A:** Use `go.uber.org/automaxprocs`. It reads cgroup CPU quota and sets `GOMAXPROCS` accordingly. Without it, Go sees host CPUs and creates too many Ps; per-P state grows; coherence between Ps is wasted.

### Q42: Walk through a coherence-bound debugging session.

**A:**
1. Observe scaling collapse (production or benchmark).
2. `pprof` CPU profile; find atomics/mutexes at top.
3. Hypothesize a contended structure; verify with `unsafe.Sizeof` and address printing.
4. Reproduce in a minimal benchmark.
5. `perf c2c` (if Linux) for ground-truth.
6. Apply padding or sharding.
7. Re-bench; confirm.
8. Deploy to canary; verify in production profile.
9. Write postmortem; add CI test.

### Q43: What if the contended atomic is in a third-party library you can't modify?

**A:**
- File an issue / PR upstream with measurements.
- Wrap the library's API in your own per-CPU sharded layer that batches calls.
- Replace the library if it cannot be fixed.

### Q44: How does the Go GC's write barrier affect cache?

**A:** Each pointer write during marking enters a per-P buffer. The buffer line is hot on one P only — no coherence with other Ps. Periodic flush to a global queue causes brief coherence events. Pointer-heavy workloads during GC see slowdown; reducing pointers in the hot path helps.

### Q45: When would you use `runtime.LockOSThread()`?

**A:**
- When making OS-level calls that require thread-local state (X11, OpenGL, signal handlers).
- For real-time threads where (combined with cgo affinity) you want core pinning.
- Rare in idiomatic Go.

### Q46: Compare cache coherence to distributed systems consensus.

**A:** Both ensure consistent state across multiple actors. Cache coherence runs in nanoseconds across CPU cores; consensus runs in milliseconds across servers. Both use protocols (MESI for cache, Raft/Paxos for distributed). Both have variants for performance (MOESI, multi-leader Raft). Both have CAP-like trade-offs.

### Q47: What is the simplest microbenchmark demonstrating false sharing?

**A:**

```go
var pair struct{ a, b int64 }

func BenchmarkFalseSharing(b *testing.B) {
    var wg sync.WaitGroup
    wg.Add(2)
    go func() { defer wg.Done(); for i := 0; i < b.N; i++ { atomic.AddInt64(&pair.a, 1) } }()
    go func() { defer wg.Done(); for i := 0; i < b.N; i++ { atomic.AddInt64(&pair.b, 1) } }()
    wg.Wait()
}
```

Run with `-cpu=2`. Add padding between a and b; rerun. Throughput difference reveals false sharing.

### Q48: How does `sync.Mutex` interact with cache coherence?

**A:**
- The mutex's state word's line is hot.
- Uncontended Lock: CAS on line in M state — ~10ns.
- Contended Lock: CAS on line in S (other waiters) — invalidates, ~30ns+.
- Heavy contention: line bounces, plus parking via semaphore.
- The mutex itself is ~16 bytes; padding makes sense if it lives in a struct with other hot fields.

### Q49: Estimate the cost of a coherence-bound counter in $/year.

**A:** Hand-wavy: suppose a service uses 1000 cores at $50/core/month = $600k/year. If 10% of CPU is wasted on coherence (typical for unpadded counters at scale), that's $60k/year wasted. A 4-hour engineering investment to pad-and-shard recovers it. ROI ~1000:1.

### Q50: Final question: in your career, when did cache coherence matter most?

**A:** (Candidate-specific.) A good answer cites a concrete project, the symptom (sublinear scaling, high pprof time in atomics, etc.), the diagnosis (`perf c2c`, benchmark sweep, etc.), the fix (padding, sharding, redesign), the result (Xx improvement). Specific numbers and lessons learned. Vague answers like "in high-throughput systems" are red flags.

---

## Absolute Final Note

These fifty questions cover the spectrum. Use them as a starting point. Customize to your role and seniority. Listen for specifics, trade-off reasoning, and humility about hardware.

End of interview.md.

---

## Extra: System Design with Cache Coherence in Mind

A senior+ design interview prompt:

> Design a real-time analytics pipeline that ingests 1M events/sec on a single 32-core box.

Expected discussion:

- **Sharded ingestion channels:** N channels, hash by event ID. Avoid single-channel contention.
- **Per-CPU aggregation:** Each shard maintains local counters; periodic merge to a global view.
- **Padded counter structures:** Each counter on its own cache line.
- **Snapshot-based readout:** Atomic pointer for the query interface.
- **GC tuning:** Pre-allocate buffers; sync.Pool for events.
- **CPU affinity:** Pin ingest goroutines if latency-critical.
- **Monitoring:** Continuous profile + perf counter sampling.

A candidate who covers most of these is at staff level.

---

## Closing

These interview materials should help in both giving and receiving interviews. Cache-coherence knowledge is a differentiator in senior Go interviews.

Apply, practice, learn.

End of interview.md, finally.

---

## One Final Set of Twenty Quick Questions

For warm-up or rapid screening:

1. What's the unit of cache sharing? — Cache line.
2. What size? — 64 or 128 bytes.
3. Why pad? — Isolate hot fields.
4. Why shard? — Distribute writes.
5. What's a snapshot pointer? — atomic.Pointer for immutable state.
6. What's per-CPU sharding? — One slot per logical CPU.
7. What's `cpu.CacheLinePad`? — Portable padding.
8. What's MESI? — Cache coherence protocol.
9. What's a snoop? — Coherence query.
10. What's RFO? — Read-For-Ownership.
11. What's a fence? — Memory barrier instruction.
12. What's `LOCK XADD`? — x86 atomic add.
13. What's LSE? — ARM Large System Extensions for atomics.
14. What's the cost of contended atomics? — Roughly cross-core latency.
15. What's the cost of uncontended atomics? — ~6 ns on x86.
16. What's `perf c2c`? — Linux false-sharing profiler.
17. What's `sync.Pool`? — Per-P object cache.
18. What's `sync.Map`? — Snapshot-based concurrent map.
19. What's `RWMutex`'s pitfall? — Reader counter contention.
20. What's the rule of thumb? — Cache line is unit; pad apart; shard distribute; measure always.

Use any subset that fits the interview length.

End.
