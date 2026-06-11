# Data-Oriented Programming — Professional Level

> **Roadmap:** [Programming Paradigms](../README.md) → Data-Oriented Programming
> *The same idea — group data by access pattern, stream it contiguously — scales from a game's ECS to a petabyte analytics engine. Columnar storage is data-oriented design wearing a database's clothes.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [ECS at Scale — DOTS, Bevy, EnTT](#ecs-at-scale--dots-bevy-entt)
3. [The Columnar-Database Connection](#the-columnar-database-connection)
4. [Vectorized Execution — Arrow, DuckDB, ClickHouse](#vectorized-execution--arrow-duckdb-clickhouse)
5. [SIMD & Vectorization Synergy](#simd--vectorization-synergy)
6. [False Sharing & Data-Oriented Concurrency](#false-sharing--data-oriented-concurrency)
7. [Profiling-Driven Layout](#profiling-driven-layout)
8. [DOD in Compilers and Engines](#dod-in-compilers-and-engines)
9. [Where This Sits in the Paradigm Map](#where-this-sits-in-the-paradigm-map)
10. [Common Mistakes](#common-mistakes)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## Introduction

> Focus: **DOD in production systems — engines, databases, SIMD, and concurrency.**

By this level the AoS/SoA mechanics are reflex. What separates a professional is seeing that data-oriented design is **one principle expressed across wildly different systems**: a game engine streaming components, an analytics engine scanning columns, a compiler walking an IR, a NumPy kernel vectorizing a column — all are the same move, *group data by how it's accessed and stream it contiguously so the CPU's caches, prefetcher, and vector units stay fed.* This page connects DOD to the columnar-database world (Parquet, Arrow, vectorized execution), the SIMD layer that packed layouts unlock, the false-sharing trap that bites data-oriented concurrency, and the profiling that drives all of it. The CPU/memory mechanics themselves live in [Language Internals](../../language-internals/) and [System Design](../../../Architecture/system-design/); here we focus on the *paradigm in production*.

---

## ECS at Scale — DOTS, Bevy, EnTT

Production ECS frameworks are where DOD's "components as SoA" meets the engineering of real games. The three reference points:

- **Unity DOTS** (Data-Oriented Technology Stack) — Unity's C# stack: the **Entity Component System**, the **Burst** compiler (LLVM-based, auto-vectorizing math-heavy systems), and the **C# Job System** (work distributed across cores with data-dependency tracking). Components are `IComponentData` structs stored in **archetype chunks** — 16 KB blocks holding entities with the *same* component set, laid out SoA within the chunk. A system's query iterates matching chunks, streaming packed components; Burst then SIMD-vectorizes the inner loop. This is the full DOD stack productized: SoA layout, contiguous iteration, vectorization, and parallelism in one framework.

- **Bevy** (Rust) — an open-source ECS engine. Defaults to **archetype/table storage** (SoA tables grouped by component set) with an opt-in **sparse-set** storage per component for ones that are added/removed frequently. Systems are plain Rust functions whose parameters declare their component access (`Query<(&Position, &mut Velocity)>`); Bevy's scheduler reads those declarations to run non-conflicting systems in parallel automatically. It's a clean demonstration that *the data-access declaration is also the parallelism plan.*

- **EnTT** (C++) — a header-only ECS used in production (Minecraft's engine among others). It's the canonical **sparse-set** ECS: each component type has a packed array plus a sparse index, making iteration cache-friendly *and* add/remove cheap (O(1) without archetype moves), at a slight iteration-locality cost versus pure archetypes.

```rust
// Bevy: the function signature IS the data-access contract AND the parallelism hint.
fn movement(mut q: Query<(&mut Transform, &Velocity)>, time: Res<Time>) {
    for (mut tf, vel) in &mut q {          // streams packed Transform + Velocity
        tf.translation += vel.0 * time.delta_seconds();
    }
}
```

**The professional distinction — archetype vs sparse-set storage:**

| | **Archetype/table** (DOTS, Bevy default, flecs) | **Sparse-set** (EnTT, Bevy opt-in) |
|---|---|---|
| Iteration | Fastest — fully packed per archetype | Fast — packed, slightly less optimal |
| Add/remove component | **Costly** — moves entity to another archetype (memcpy) | **Cheap** — O(1), no move |
| Best for | Stable component sets, max iteration speed | Churny components (tags toggled per frame) |

Choosing storage per component type — stable layout in archetypes, volatile flags in sparse sets — is the kind of layout decision that defines ECS performance work at scale.

> **The scaling lesson:** at production scale, ECS is not just "SoA components" — it's a storage-strategy problem (archetype vs sparse-set), a vectorization problem (Burst/SIMD over chunks), and a scheduling problem (parallelize by declared data access). The data layout drives all three.

---

## The Columnar-Database Connection

Here is the insight that elevates DOD from "a games thing" to a universal principle: **columnar storage is data-oriented design applied to data systems.** A row-store (OLTP, classic AoS) keeps each row's fields together on disk/page:

```
Row store (AoS): [id=1,name=A,price=10,qty=3][id=2,name=B,price=20,qty=1]…
```

A column-store (OLAP, SoA) keeps each *column* together:

```
Column store (SoA):  id:    [1, 2, 3, …]
                     name:  [A, B, C, …]
                     price: [10, 20, 30, …]   ← SUM(price) scans ONLY this
                     qty:   [3, 1, 5, …]
```

The analytics query `SELECT SUM(price) FROM sales WHERE region='EU'` reads only the `price` and `region` columns — and reads each as a packed, contiguous run. It never touches `name`, `id`, or the dozens of other columns. This is **exactly** the AoS→SoA argument from the junior page, scaled from cache lines to disk pages and memory bandwidth:

- **Less data moved.** A row-store drags whole rows (every column) through I/O and cache to compute one aggregate; the column-store reads only the queried columns. On a 50-column table, that's a ~50× reduction in bytes scanned.
- **Better compression.** A column holds *homogeneous* values (all prices, all dates), so run-length, dictionary, delta, and bit-packing encodings work far better than on mixed-type rows — less I/O and less decompression work.
- **Vectorizable.** A packed column of `int32`/`float64` is precisely the input SIMD wants (next section).

This is why **Parquet/ORC** (columnar on-disk formats), **Apache Arrow** (columnar *in-memory* standard), and column-store engines (Redshift, BigQuery, ClickHouse, Vertica, DuckDB, Snowflake) dominate analytics. They are DOD's "group by access pattern, stream contiguously" reasoning, applied to the question *"what does an analytical query actually read?"* — answer: a few columns, in full. And a pandas/Polars DataFrame is the same idea in process memory: each column is a packed array (Arrow buffers in Polars), so column-wise vectorized ops are fast and row-by-row iteration is the slow AoS-style anti-pattern.

> **The unification:** ECS groups by component, columnar DBs group by column, NumPy groups by axis — all three are SoA, all three exist because *the access pattern reads one field across many records,* and SoA is the layout that serves that pattern at cache, memory, and disk scale alike.

---

## Vectorized Execution — Arrow, DuckDB, ClickHouse

Columnar layout enables a query-execution style that is itself deeply data-oriented: **vectorized (batch) execution.** Classic databases use the **Volcano/iterator model** — one `next()` call per row, pulling a single tuple up through a tree of operators. That's elegant but cache- and branch-hostile: per-row virtual calls, poor instruction locality, no chance to vectorize.

Vectorized engines (pioneered by **MonetDB/X100**, now standard in **DuckDB**, **ClickHouse**, **Velox**, **Photon**) instead push **batches of column values** (e.g., 1024–2048 elements) through each operator at a time:

- A filter operator scans a packed column vector and produces a selection vector — a tight loop the compiler can auto-vectorize.
- Per-row interpreter overhead is amortized across the whole batch (one `next()` per 2048 rows, not per row).
- Data stays in cache-resident batches; operators are written as loops over arrays, not per-tuple methods.

This is the DOD mindset at the query-engine level: **process many values per call, over contiguous arrays, in tight loops** — the same reason a game system sweeps a component array instead of calling `entity.update()` a million times. **Apache Arrow** provides the lingua franca: a standardized columnar in-memory format so engines, languages, and tools share vectorized data *zero-copy*, without per-system serialization.

> **The parallel:** the Volcano "one row at a time through virtual calls" model is to vectorized execution what AoS pointer-chasing is to an SoA sweep. The fix is identical in spirit: batch contiguous data and run tight loops over it.

---

## SIMD & Vectorization Synergy

SoA isn't just cache-friendly — it's the layout that **SIMD** (Single Instruction, Multiple Data) demands. A SIMD instruction operates on a vector register holding 4/8/16 lanes (SSE/AVX2/AVX-512, ARM NEON/SVE), applying one operation to all lanes at once. To fill those lanes efficiently, you need the *same field from consecutive records packed contiguously* — which is exactly what SoA gives you and AoS denies.

```cpp
// SoA: x[] is contiguous → load 8 floats into one AVX register, add 8 at once.
//   The compiler auto-vectorizes this; or write intrinsics for guaranteed packing.
for (size_t i = 0; i < n; ++i) x[i] += vx[i] * dt;   // 8 lanes/iteration with AVX

// AoS: x is strided (one per 76-byte struct) → SIMD must GATHER scattered values,
//   which is slow and often defeats the win. The layout fights the vector unit.
for (auto& e : entities) e.x += e.vx * dt;            // hard/inefficient to vectorize
```

The relationship is causal: **SoA makes auto-vectorization possible; AoS forces gather/scatter that erases the benefit.** This is why DOTS pairs ECS (SoA storage) with Burst (an auto-vectorizing compiler), why columnar engines vectorize column batches, and why NumPy/BLAS operate on packed arrays. Stack the effects and a hot loop can win *twice*: once from cache locality (fewer RAM stalls) and again from SIMD (more work per instruction). DOD is, in large part, the discipline of *laying data out so the vector units can be fed.*

> **The synergy:** cache locality keeps the CPU from waiting on memory; SIMD does more per cycle once data arrives. SoA is the single layout that unlocks both — which is why high-performance kernels are SoA almost without exception.

---

## False Sharing & Data-Oriented Concurrency

Data-oriented thinking is essential — and uniquely subtle — in concurrent code, because of **false sharing**: the cache-coherency trap that turns "independent" threads into contending ones.

The mechanism: coherency operates at **cache-line granularity (64 bytes)**, not per variable. If two threads write to two *different* variables that happen to sit on the **same cache line**, every write invalidates the other core's copy of the whole line. The cores ping-pong the line back and forth over the coherency protocol, serializing what should be parallel work — a brutal, invisible slowdown with zero logical contention.

```cpp
// FALSE SHARING: counters[0] and counters[1] share a cache line.
//   Two threads incrementing them thrash the line between cores → ~no speedup.
struct { long count; } counters[NUM_THREADS];   // packed: adjacent longs, one line

// FIX: pad each counter to its own cache line (or use per-thread locals).
struct alignas(64) PaddedCounter { long count; char pad[64 - sizeof(long)]; };
PaddedCounter counters[NUM_THREADS];            // each on its own line → no thrash
```

The data-oriented fixes are layout fixes: **pad/align hot per-thread data to 64-byte boundaries** (`alignas(64)`, C++'s `std::hardware_destructive_interference_size`, Java's `@Contended`, Rust's `crossbeam` `CachePadded`), or **give each thread its own local** and combine at the end. Note the tension with ordinary DOD: packing data tightly is good for *single-threaded* cache use but can *cause* false sharing across threads — so concurrent hot data sometimes wants the *opposite* of tight packing (deliberate padding). Recognizing which regime you're in is a senior+ skill.

This is also why ECS schedulers (Bevy, DOTS) track *which components each system writes*: systems with disjoint writes can parallelize safely, and the framework lays out/partitions data to avoid both logical contention and false sharing.

> **The concurrency twist:** DOD usually says "pack tightly." Concurrency adds "...except hot data written by different threads, which you must *spread* across cache lines." False sharing is the cache line biting you from the parallel direction.

---

## Profiling-Driven Layout

Professionals don't guess layouts — they let measurements dictate them, then verify. The toolkit and discipline:

- **Find the memory-bound hot loop.** `perf record`/`perf stat` (`cache-misses`, `LLC-load-misses`, stalled-cycles-backend), Intel VTune's Memory Access analysis, AMD μProf, or `cachegrind`. The signature of a DOD opportunity is a hot loop with a high last-level-cache miss rate and low arithmetic intensity.
- **Read the roofline.** Plot the loop against the roofline model: if it's under the memory-bandwidth roof, layout changes (better locality) move it up; if it's already compute-bound, layout won't help and you optimize the math/SIMD instead.
- **Inspect struct layout.** `pahole` (Linux) shows struct size, field offsets, padding holes, and how many cache lines a struct spans — directly revealing hot/cold split and field-reorder opportunities. Reordering fields to fill padding holes and to cluster hot fields is a cheap, high-leverage move before any SoA rewrite.
- **Confirm vectorization.** Compiler vectorization reports (`-fopt-info-vec` in GCC, `-Rpass=loop-vectorize` in Clang) or inspecting the emitted assembly tell you whether the SoA loop actually vectorized — sometimes it didn't, and a small change (restrict pointers, alignment) unlocks it.
- **Always measure before/after on the real workload.** A microbenchmark that fits in L1 lies. Use representative data sizes and access patterns, and keep the layout change only if it wins by a margin that justifies the complexity.

> **The professional loop:** profile → identify memory-bound hot path → reorder/split/SoA the *specific* data it touches → verify cache misses dropped, vectorization happened, and the workload got faster → keep only what paid. Layout is an empirical discipline, not a style.

---

## DOD in Compilers and Engines

Two production domains beyond games make DOD's universality concrete:

- **Compilers.** Modern compilers process *huge* homogeneous streams — tokens, AST nodes, IR instructions — in hot passes, exactly the DOD profile. **Rust's compiler** uses interning and index-based (arena/SoA-ish) data structures rather than pointer-rich graphs, partly for cache locality. **LLVM** and especially newer designs lean on flat, contiguous representations; **Carbon** and **Zig** explicitly adopt data-oriented compiler internals (Zig's self-hosted compiler is a well-documented DOD case study, replacing pointer-heavy structs with SoA and index handles for major memory and speed wins). The pattern: replace `Box<Node>` graphs with `Vec<Node>` + `u32` indices, turning pointer-chasing into array indexing.

- **Game/simulation engines.** Beyond ECS, engines apply DOD throughout: particle systems as parallel arrays, transform hierarchies stored as flat arrays processed in order, render queues as sorted data streams. Unreal's **Mass** framework, the **Frostbite** and **Naughty Dog** engine talks, and Bitsquid/Stingray are touchstones for "the engine is a set of data transformations over big arrays."

The throughline with columnar databases: *whenever a system's hot path is "the same operation over a large homogeneous stream of records,"* the data-oriented layout — contiguous, grouped by access, index- rather than pointer-linked — is the high-performance answer, whether the records are entities, rows, tokens, or IR instructions.

> **The generalization:** games, databases, and compilers independently converged on the same layout because they share the same hot-path shape — bulk operations over homogeneous record streams. DOD is the name for designing data to suit that shape.

---

## Where This Sits in the Paradigm Map

DOD doesn't replace the imperative substrate — it *is* imperative code (loops over arrays; see [02 — Imperative & Procedural](../02-imperative-and-procedural/)) with a deliberate stance on **data layout**. Its relationship to the neighbors:

- **vs OOP** ([Object-Oriented Programming](../../object-oriented-programming/)) — the explicit foil. OOP bundles data+behavior per object and accepts implicit, pointer-graph layout; DOD separates data from behavior and designs layout for the CPU. They optimize different cost functions (modeling vs throughput).
- **vs Array-Oriented** ([12 — Array-Oriented Programming](../12-array-oriented-programming/)) — close cousins. Array-oriented (APL, NumPy, dataframes) makes *whole-array operations* the unit of expression; DOD makes *array layout* the unit of design. SoA is the data layout array-oriented code naturally operates on — they pair constantly.
- **vs Imperative/Procedural** — DOD's implementation language. The loops, indices, and arrays are pure procedural code; DOD is the *design discipline* about what those arrays contain and how they're grouped.
- **Mechanics live elsewhere.** Cache hierarchy, coherency protocols, SIMD ISAs, and memory models are [Language Internals](../../language-internals/) and [System Design](../../../Architecture/system-design/) material; this page treats them as the *forces DOD designs around,* not the subject itself.

> **Placement:** DOD is a *design stance layered on imperative code* — "structure your arrays for the machine" — adjacent to array-oriented programming and defined largely in contrast to OOP's object-graph default.

---

## Common Mistakes

- **Thinking DOD is "just for games."** Columnar databases, vectorized query engines, NumPy/Polars, and data-oriented compilers are all DOD. Missing the connection means missing where it pays in *your* domain.
- **SoA without checking vectorization.** Assuming SoA auto-vectorized; the compiler may have bailed (aliasing, alignment, reductions). Verify with vectorization reports or assembly, or the SIMD half of the win never lands.
- **Packing concurrent hot data tightly.** Applying single-threaded "pack tight" wisdom to per-thread counters/state and creating false sharing — the exact opposite of what concurrent layout needs (pad to a cache line).
- **Adopting ECS storage blindly.** Using archetype storage for components toggled every frame (paying constant archetype-move costs) when sparse-set storage was the right call — or vice versa.
- **Microbenchmarking in L1.** Benchmarking a layout change on data that fits in cache, seeing no difference (or a fake one), and drawing the wrong conclusion. Use realistic working-set sizes.
- **Reordering nothing before rewriting everything.** Skipping cheap wins — field reordering to fill padding holes (`pahole`), hot/cold splitting — and jumping straight to a full SoA rewrite that may not have been necessary.

---

## Summary

At the professional level, data-oriented design reveals itself as **one principle across many systems**: group data by access pattern and stream it contiguously so caches, the prefetcher, and vector units stay fed. **ECS frameworks** (Unity DOTS, Bevy, EnTT) productize it for games, where the real engineering is storage strategy (**archetype vs sparse-set**), vectorization (Burst/SIMD over packed chunks), and scheduling by declared data access. The same reasoning *is* **columnar storage** in databases — Parquet/Arrow/ClickHouse/DuckDB keep each column packed because an analytical query reads a few columns in full, exactly the AoS→SoA argument scaled to disk and memory bandwidth — and it underpins **vectorized execution**, which batches column values through tight loops instead of pulling one row at a time through virtual calls. SoA is also the layout **SIMD** demands (packed lanes, not strided gathers), so high-performance kernels win twice: cache locality plus vectorization. In concurrency, data-oriented layout must additionally avoid **false sharing** — padding per-thread hot data to 64-byte lines, the one place DOD says *spread* rather than *pack*. All of it is **profiling-driven**: find the memory-bound hot loop, inspect layout with `pahole`/`perf`/VTune, reorder-split-SoA the specific data, verify cache misses dropped and vectorization happened, and keep only what measurably paid. The same pattern recurs in **compilers** (index-linked IR streams in Zig, Rust, LLVM) because games, databases, and compilers share one hot-path shape: bulk operations over homogeneous record streams.

---

## Further Reading

- Daniel Abadi et al., *The Design and Implementation of Modern Column-Oriented Database Systems* — the definitive survey of columnar storage and vectorized execution.
- Peter Boncz et al., *MonetDB/X100: Hyper-Pipelining Query Execution* (CIDR 2005) — the paper that launched vectorized execution.
- Apache Arrow documentation — the columnar in-memory standard behind modern data tooling.
- Unity DOTS / Bevy ECS / EnTT documentation — archetype vs sparse-set storage in production.
- Andrew Kelley, *Practical Data-Oriented Design* (Handmade Seattle 2021) — Zig's compiler DOD rewrite, a concrete case study.
- Ulrich Drepper, *What Every Programmer Should Know About Memory* — caches, coherency, and false sharing in depth.

---

## Related Topics

- [02 — Imperative & Procedural](../02-imperative-and-procedural/) — the array-and-loop substrate DOD designs over.
- [12 — Array-Oriented Programming](../12-array-oriented-programming/) — whole-array/vectorized operations over SoA data.
- [01 — Overview & Taxonomy](../01-overview-and-taxonomy/) — DOD's place among paradigms.
- [Object-Oriented Programming](../../object-oriented-programming/) — the object-graph default DOD contrasts with.
- [Language Internals](../../language-internals/) — cache hierarchy, coherency, SIMD, and memory models (the mechanics).
- [`senior.md`](senior.md) — the trade-offs and when DOD is worth it vs premature.
- [`interview.md`](interview.md) — the full Q&A bank across both meanings of "data-oriented."
