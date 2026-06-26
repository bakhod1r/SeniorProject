# Memory Layout — Interview Questions
> **Topic:** [Memory Layout](README.md)

A bank of interview questions on memory layout — alignment, padding, packing, cache lines, false sharing, AoS/SoA, pointer chasing, object headers, and the tooling that measures it all. Each answer is written to be *said out loud* in an interview: a crisp lead, the reasoning, and the trade-off that signals seniority.

---

## Table of Contents
- [Conceptual](#conceptual)
- [Tool-Specific](#tool-specific)
- [Tricky / Trap](#tricky--trap)
- [Design](#design)

---

## Conceptual

## Question 1
**Why is `sizeof(struct)` usually larger than the sum of its fields?**

Because the compiler inserts **padding** to satisfy each field's alignment requirement. A field of size *N* must sit at an offset that is a multiple of its alignment (usually *N*), so the compiler skips bytes (padding) to reach an aligned offset. It also adds **trailing padding** so the struct's total size is a multiple of its strictest field's alignment — that guarantees every element stays aligned when the struct is used in an array. So `sizeof` = fields + internal padding + trailing padding. A `{char, int, char}` is 12 bytes, not 6.

## Question 2
**What is natural alignment and why does the hardware care?**

Natural alignment means a primitive of size *N* is placed at an address divisible by *N*: a 4-byte int on a 4-byte boundary, an 8-byte double on an 8-byte boundary. The hardware cares because the CPU fetches memory in aligned chunks (and whole 64-byte cache lines). An aligned value fits in one fetch; a misaligned one may straddle two fetch units, needing two reads plus stitching — slower on x86, and a **hardware fault** on strict-alignment architectures like many ARM, MIPS, and SPARC.

## Question 3
**How do you minimize padding in a struct, and why does it work?**

Order fields from **largest alignment to smallest**. Padding appears when a small field is followed by a larger one that needs to jump to an aligned offset. If you place the big fields first, each subsequent field's natural offset is already satisfied, and small fields pack into what would otherwise be gaps. `{int, char, char}` is 8 bytes; the same fields as `{char, int, char}` are 12. It's a behavior-preserving, free optimization — but only in languages that honor declared order (C, Go); Rust may already reorder for you.

## Question 4
**What is a cache line and why does it dominate layout decisions?**

A cache line is the fixed unit (almost always **64 bytes**) the CPU transfers between cache and memory. You never load one byte — touching any byte loads its whole 64-byte line. This makes the cache line, not the byte, the real unit of cost. Good layout means the bytes you use together share a line (one fill serves them all) and unrelated/cold bytes don't ride along wasting bandwidth and evicting useful data. Almost every layout technique — reordering, hot/cold splitting, SoA, false-sharing padding — is ultimately about controlling what shares a 64-byte line.

## Question 5
**Explain false sharing and how to fix it.**

False sharing is when two threads write to *different* variables that happen to occupy the **same cache line**. There's no logical contention, but cache coherence operates per-line: each write forces exclusive ownership of the whole line, invalidating the other core's copy, so the line ping-pongs between cores on every write. Code that should scale linearly instead slows down as you add threads. The fix is to pad/align each hot, concurrently-written field onto its **own cache line** — `@Contended` in Java, `crossbeam::CachePadded` in Rust, manual padding in Go/C (`alignas(64)`). You trade ~56 bytes per field for often a 5–10× speedup.

## Question 6
**AoS vs. SoA — what are they and how do you choose?**

AoS (array of structs) stores each record's fields contiguously, records end-to-end: `Particle[]`. SoA (struct of arrays) gives each field its own array: `float x[], y[], z[]`. Choose by **access pattern**: if you operate on *one field across many records* (a columnar scan, vectorized math, a bulk filter), SoA wins — the array is dense, every cache-line byte is useful, and it auto-vectorizes to SIMD. If you operate on *many fields of one record* (fetch a whole entity, OLTP), AoS wins — one record is one contiguous read. Columnar databases (ClickHouse, Parquet, Arrow) are SoA; row stores (Postgres, InnoDB) are AoS — for exactly these reasons.

## Question 7
**Why are linked lists "cache-hostile" despite O(n) traversal being optimal?**

Big-O ignores the constant, and for memory that constant is enormous. Each list node is a separate heap allocation that can live anywhere; traversal is a chain of **dependent loads** — you can't compute the address of `next->next` until `next` resolves, so the CPU can't prefetch or run ahead. Every hop is a likely cache miss (~200 cycles) and the pipeline stalls. A contiguous array holding the same values traverses as a linear sweep the prefetcher predicts perfectly, amortizing misses across whole cache lines — often 10–50× faster for identical Big-O. This is why hot paths prefer flat, index-based structures.

## Question 8
**What overhead does a managed runtime add to object layout?**

Per-object **headers**. The JVM prepends a mark word (8 bytes: identity hash, GC age/mark, lock bits) plus a klass pointer (4 bytes compressed, else 8) — so a boxed `Integer` wrapping 4 bytes of data costs 16. .NET adds a sync-block index plus a method-table pointer (~16 bytes). CPython objects carry a refcount and type pointer (a bare `int` is ~28 bytes). This is why boxed collections (`Long[]`) are disastrous — header bloat *plus* pointer chasing — and why primitive arrays, value types, and off-heap buffers exist. Notably, **Go has no per-object header**: a heap struct is just its fields, with GC metadata in separate side tables.

---

## Tool-Specific

## Question 9
**What does `pahole` do and when do you reach for it?**

`pahole` (from the `dwarves` package) reads a binary's DWARF debug info and prints a struct's **exact byte layout**: each field's offset and size, the **holes** (padding) with byte counts, where 64-byte **cache-line boundaries** fall, and a summary of size vs. sum-of-members. `pahole --reorganize` even proposes a reordered, hole-minimized layout. You reach for it before optimizing any hot struct — it replaces "I think there's padding" with a byte-exact map, and it shows which fields straddle cache lines. It needs `-g` debug info; stripped binaries give nothing.

## Question 10
**How would you confirm false sharing with `perf`?**

Use `perf c2c` (cache-to-cache): `perf c2c record -- ./bench` then `perf c2c report`. It ranks cache lines by cross-core contention via **HITM** events — a load that hits a *Modified* line in another core's cache, the fingerprint of sharing. The report breaks each hot line down by **byte offset and CPU**, so you see exactly which two fields, written by which cores, are colliding. Then map those offsets back to fields with `pahole`, pad/separate them, and re-record to confirm the HITM count collapsed. High *remote* HITM is the signal.

## Question 11
**Which hardware counter actually tells you a cache miss cost you wall-clock time?**

`cycle_activity.stalls_l3_miss` (and relatives) — the cycles the core stalled with nothing to do but wait on memory. Raw `LLC-load-misses` is misleading: the out-of-order engine and prefetcher hide misses that aren't on the dependency-critical path, so you can cut miss counts and gain *zero* wall-clock. The honest metric is stall cycles. I'd also normalize misses to **MPKI** (misses per kilo-instruction) to compare runs, and use the stall counter to tell **latency-bound** problems (pointer chasing — high stalls, low IPC) from **bandwidth-bound** ones (bulk scans), because they need different fixes.

## Question 12
**How do you verify an AoS→SoA change actually helped, beyond wall-clock?**

Predict named counters and check them. SoA should: raise **cache-line utilization** (fewer bytes loaded per useful byte) and cut **LLC-load-misses** and **DRAM bandwidth** for the same work; enable **SIMD** — confirm with the compiler's vectorization report (`-Rpass=loop-vectorize` / `-fopt-info-vec`) that scalar ops became vector ops, and watch **IPC** rise in `perf stat`; and let the **hardware prefetcher** work on the now-contiguous arrays. If wall-clock improved but these didn't, something else changed — and if counters improved but wall-clock didn't, the bottleneck moved. Both must agree.

---

## Tricky / Trap

## Question 13
**A teammate adds `#pragma pack(1)` to a struct and it works fine on their x86 laptop but crashes on the ARM device. Why?**

Packing removes padding, so fields become misaligned — e.g., a `uint32_t` at offset 1. x86 *tolerates* misaligned scalar loads (just slower), so it "works." Many ARM/MIPS/embedded targets require alignment and **fault** on a misaligned access, hence the crash. Worse, even on x86, taking a **pointer or reference** to a packed field (`&p->field`) is **undefined behavior** in C and Rust, because the reference type promises an alignment the field doesn't have — so it can break under optimization anywhere. Rule: pack only at serialization boundaries, and read packed fields **by value** (`memcpy` to a local), never by pointer.

## Question 14
**Two threads each increment their own atomic counter, yet adding the second thread makes it *slower*. The counters are correct. What's wrong?**

False sharing. Atomics make the operations *correct*, not *contention-free*. If the two counters sit on the same 64-byte cache line, every atomic write forces exclusive ownership of that whole line, ping-ponging it between cores — coherence traffic that gets worse with more threads. The fix is layout, not atomics: pad each counter onto its own cache line. Confirm with `perf c2c` (you'll see one line with high remote HITM stored by both CPUs). Padding to 128 bytes may be needed if the L2 adjacent-line prefetcher pulls line pairs.

## Question 15
**You reordered a Rust struct's fields to "minimize padding" and `size_of` didn't change. Why?**

Because a plain Rust struct has **no guaranteed field order** — the compiler is already free to reorder fields to minimize padding, and almost certainly did before you touched it. Your manual reorder changes the *source*, not the *layout*. Field order only matters when you pin the layout with `#[repr(C)]` (declared order, C ABI) or `#[repr(packed)]`. So in idiomatic Rust, don't hand-optimize order for size — the compiler owns it. This is the opposite of C and Go, where declared order *is* the layout and ordering is your responsibility.

## Question 16
**Why might increasing a JVM's heap from 30 GB to 40 GB make it hold *less* live data and run slower?**

The 32 GB **compressed-oops cliff**. Below ~32 GB, the JVM stores object references as 32-bit values scaled by the 8-byte alignment, so every reference and klass pointer is 4 bytes instead of 8. Cross 32 GB and compressed oops switch off: all references widen to 8 bytes, inflating every object and every pointer. The per-object overhead can grow enough that a 40 GB heap fits fewer live objects than a 31 GB one, plus the larger pointers hurt cache density. The fix is to size the heap to stay just under the threshold, or jump well past it knowingly.

---

## Design

## Question 17
**Design the in-memory layout for a particle system: 10M particles, a physics step that updates position from velocity 60×/sec, and occasional single-particle picking for rendering.**

The dominant workload is the physics step — one operation (`pos += vel`) over *one set of fields* across all 10M particles, 60 times a second. That screams **SoA**: separate dense `float` arrays for `x, y, z, vx, vy, vz`. Benefits: the physics loop sweeps contiguous arrays (perfect prefetch, full cache-line utilization), auto-vectorizes to SIMD (8 lanes/AVX), and never loads `color`/render-only fields it doesn't need. Picking a single particle is rare and tolerates the SoA cost (a few scattered reads). I'd keep render-only/cold fields (color, material id) in their own SoA arrays so the hot pass skips them entirely. If single-record locality mattered more, I'd consider **AoSoA** (tiles of 8 in SoA) to balance SIMD and locality. I'd validate with `perf stat` (LLC misses down, IPC up from vectorization) and confirm SIMD in the vectorization report — not assume it.

## Question 18
**You own a service whose throughput plateaus and even regresses past 8 cores, despite no obvious lock contention. Walk me through diagnosing and fixing it.**

First I'd suspect a layout-level scalability killer, not just locks. I'd run `perf c2c record` on the loaded service and read the report for cache lines with high **remote HITM** — that's cores fighting over a line. The usual culprits are a shared counter/metrics struct, a sharded-but-too-densely-packed lock array, or a queue's head/tail indices on the same line. I'd map the offending offsets to fields with `pahole`, then decide **false vs. true sharing**: if they're unrelated fields, pad each onto its own cache line (`@Contended`/`CachePadded`/manual) — false sharing, fixed by separation. If it's genuinely the same datum (a global atomic everyone increments), padding won't help; I'd re-architect: per-core/per-thread accumulation summed periodically, sharding by key, or a different sync strategy. I'd also check `perf c2c`'s remote-vs-local split for NUMA effects — cross-socket traffic can masquerade as false sharing and may need NUMA-aware placement instead. Finally, confirm the fix end-to-end: HITM collapsed in a re-record, and throughput now scales with cores.
