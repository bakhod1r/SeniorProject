# Object Model & Layout — Professional Level

> **Topic:** [Object Model & Layout](README.md)
> **Focus:** Layout as a production discipline — designing object models for footprint, throughput, and tail latency at scale; off-heap and columnar layouts; ABI-stable wire structs; layout regressions in CI; and the cross-runtime trade-offs you defend in a design review.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Pros & Cons](#pros--cons)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Best Practices](#best-practices)
12. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [What You Can Build](#what-you-can-build)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)
19. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **When billions of objects, a P99 SLO, and a multi-team API all depend on how a record is arranged in memory, layout stops being a micro-optimization and becomes architecture.**

At production scale, object layout decisions show up in the metrics that matter: heap size and GC pause time, cache-miss rate and instructions-per-cycle, serialization throughput, and the cost-per-request on your cloud bill. A 20-byte-per-object saving is irrelevant for a thousand objects and a multi-million-dollar decision for ten billion. A single field that false-shares can cap a 64-core box at the throughput of an 8-core one. A wire struct whose layout drifts across a version boundary corrupts data silently for every client.

This page treats layout as the production discipline it becomes for staff-level engineers: choosing **on-heap vs off-heap vs columnar** representations and owning the consequences; building object models that an allocator and GC can manage cheaply; pinning **ABI-stable** layouts at trust boundaries (wire formats, FFI, shared memory) so they never drift; and **guarding layout in CI** so a careless field addition doesn't regress footprint or re-fork a hidden class. It also covers the cross-runtime arguments you must make crisply in a design review: when boxing is acceptable, when to flatten, when to go SoA/columnar, and how to quantify the trade-offs rather than assert them.

The professional distinction is **ownership and quantification**. A senior knows the mechanisms; a professional sets the policy, defends it with numbers, encodes it as an enforced invariant, and accepts responsibility for the production outcome.

---

## Prerequisites

- **Required:** The senior page: compressed oops, mark-word encoding, vtables, hot/cold splitting, false sharing, deopt mechanics.
- **Required:** Practical experience reading production profiles — GC logs, flame graphs, `perf stat`/`perf c2c`, allocation profilers.
- **Required:** Familiarity with at least one serialization/columnar format (Protobuf/FlatBuffers/Cap'n Proto, Arrow/Parquet).
- **Helpful:** Having owned an SLO and traced a latency regression to its physical cause.
- **Helpful:** Experience with off-heap memory (`Unsafe`/`MemorySegment`, `mmap`, custom allocators) or FFI/ABI boundaries.

You do **not** need novel research; you need disciplined application, measurement, and the judgment to choose among known techniques under real constraints.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Footprint** | Total memory a population of objects occupies, including headers, padding, boxing, and structural overhead. |
| **On-heap** | Objects managed by the language's GC/allocator, carrying its headers and layout rules. |
| **Off-heap** | Memory the runtime doesn't manage as objects (native, `mmap`, `MemorySegment`), laid out by you, header-free. |
| **Columnar** | Storing each field as a contiguous column across all records (SoA at storage scale); the basis of Arrow/Parquet/vectorized engines. |
| **ABI** | Application Binary Interface — the binding contract for how data is laid out in memory/registers across a boundary. |
| **Wire layout** | The byte arrangement of a record as it crosses a network/file/process boundary; must be stable and endianness-defined. |
| **Schema evolution** | Changing a record's fields over time without breaking older/newer readers. |
| **Layout regression** | An unintended change to object size/shape that increases footprint or breaks an inline-cache/deopt assumption. |
| **Value type / inline class** | A type stored inline without an object header (Rust struct, Go struct, C++ value, Java Project Valhalla value class). |
| **Arena / region allocation** | Bump-allocating many objects in one contiguous block, freed together; improves locality and dealloc cost. |
| **Cache footprint** | The working set's size relative to L1/L2/L3; the predictor of whether a hot loop is cache-resident. |
| **NUMA locality** | Whether an object's memory is on the socket of the core that accesses it; cross-socket access is far slower. |
| **Flattening** | Replacing a pointer-to-sub-object with the sub-object's fields inline, removing a hop and a header. |

---

## Core Concepts

### 1. Footprint Is a First-Class Production Metric

For a population of N objects, footprint is `N × (header + fields + padding + per-object-structure)`. At scale, the per-object *constants* dominate: 16 bytes of JVM header times 10 billion objects is 160 GB of pure overhead, independent of your actual data. The professional habit is to **budget footprint per record** like a latency budget: enumerate the header, the padding (from field order), the boxing (every boxed field is +pointer +header), and the structural overhead (map nodes, list backing arrays, reference indirection).

This budget drives architecture. It's why high-cardinality systems flatten objects, intern repeated values, choose primitive-specialized collections, and frequently abandon the object model entirely for **off-heap** or **columnar** storage where there are *no per-object headers at all* — one header amortized across millions of rows.

### 2. Layout Drives GC Behavior

The object model and the garbage collector are coupled. Layout affects GC three ways:

- **Allocation rate.** Boxing and short-lived wrapper objects (autoboxed integers, iterator objects, lambda captures) flood the young generation, driving minor-GC frequency. Flattening and primitives cut allocation rate directly.
- **Object count and graph shape.** The GC's mark cost scales with the number of objects and references it must trace. Ten million tiny linked objects are far more expensive to trace than one array of values, even at equal bytes — pointer-chasing defeats the GC's prefetch just as it defeats yours.
- **Survivor footprint and promotion.** Larger objects (from padding/boxing) fill survivor spaces faster and promote sooner, raising old-gen pressure and full-GC risk.

So a layout change that looks local ("I boxed this field") can show up as a global GC-pause regression. Professionals reason about layout and GC together, and validate with GC logs, not intuition.

### 3. On-Heap vs Off-Heap vs Columnar

Three regimes, chosen by scale and access pattern:

- **On-heap objects.** Natural, GC-managed, ergonomic. Pays headers/boxing per object. Correct default until footprint or GC pauses say otherwise.
- **Off-heap (native) buffers.** You allocate a flat region (`MemorySegment`, `Unsafe`, `mmap`, native malloc) and lay records out by hand — no per-object header, no GC tracing of the contents, full layout control, and the data can be memory-mapped or shared between processes. The cost is manual lifetime management, no type safety, and the engineering burden of a hand-rolled layout. This is how caches (e.g. large LRUs), columnar stores, and message buffers dodge GC entirely.
- **Columnar / SoA at storage scale.** Store each field as a contiguous column. One schema (one "header") describes millions of rows. Enables vectorized scans, aggressive compression (run-length, dictionary, bit-packing per column), and SIMD. This is the layout of Arrow, Parquet, ClickHouse, and every modern analytical engine — the object model dissolved into columns because analytical loops read one field across all rows.

The decision is access-pattern-driven: random whole-record access favors on-heap/off-heap row layout; scan-and-aggregate-one-field favors columnar.

### 4. ABI-Stable Wire and FFI Layouts

The moment a struct crosses a trust boundary — network, file, shared memory, FFI to another language — its layout becomes a **contract**, and the compiler's freedom to reorder fields or pick padding becomes a liability. Professionals **pin** these layouts:

- **`repr(C)` in Rust, `#pragma pack`/explicit padding in C, no field reordering** — the layout must match the spec exactly and never change with compiler version.
- **Define endianness explicitly.** A multi-byte field's byte order must be specified (network byte order / little-endian) and converted on read/write; never assume the writer and reader share endianness.
- **Version the schema.** Use a format with defined evolution rules (Protobuf field numbers, FlatBuffers vtables, Cap'n Proto) rather than a raw C struct if the schema will change — raw structs have *no* evolution story and break the instant you add a field.
- **Distinguish in-memory from on-wire.** The fast in-memory layout (reordered, padded for the CPU) is usually *not* the wire layout (packed, endianness-fixed). Convert at the boundary; don't let the wire format dictate your hot-path layout, or vice versa.

A layout drift here is a silent data-corruption incident, not a slowdown. It is treated with the rigor of an API contract.

### 5. Guarding Layout in CI

Layout regressions are invisible in normal tests — the program is *correct*, just bigger or slower. So professionals make layout an **asserted, version-controlled invariant**:

- **Size assertions.** `static_assert(sizeof(T) == 32)` in C++, `const _ = [...]` size checks in Rust/Go, JOL-based size tests in Java. A field addition that bloats the struct fails the build.
- **Offset assertions** for ABI structs: pin each field's offset so a reorder is caught.
- **Allocation-profile gates.** A perf test that fails if allocation rate or object count regresses past a threshold catches accidental boxing.
- **Deopt/shape monitoring** in JS/TS perf suites: assert hot functions stay optimized (no `--trace-deopt` output for the hot path).

The principle: **a layout property the system depends on must be encoded as a test**, because nothing else will catch its regression until production metrics move.

### 6. Value Types: Removing the Object Tax by Construction

The cleanest fix for header overhead is to not have a header. Languages provide **value types**:

- **C, C++, Go, Rust** structs are values by default — inline, header-free, embeddable. Composing them flattens naturally.
- **Java Project Valhalla** introduces **value classes** (and primitive classes) that the JVM can flatten — an array of value-class points becomes a dense block of `x,y` pairs with no per-element header or indirection, closing the gap with C structs while keeping Java semantics.
- **C# structs** are inline value types; an array of structs is contiguous and header-free, unlike an array of classes.

Designing with value types where identity isn't needed is the highest-leverage footprint decision available, because it removes the per-object overhead at the type level rather than fighting it object by object.

### 7. NUMA, Page Locality, and Large Pages

At the largest scale, *where* memory physically lives matters. On a multi-socket box, accessing memory attached to another socket (cross-NUMA) is markedly slower. Layout interacts with NUMA: per-thread/per-socket data structures (the sharding from the senior page) should be **allocated on the accessing socket's node** (first-touch policy, `numactl`, `mbind`). Huge/large pages reduce TLB pressure for big contiguous structures (off-heap buffers, large arenas). These are production realities for low-latency and high-throughput systems where the object model's *placement*, not just its *shape*, determines performance. They're out of scope to detail here but in scope to recognize: a perfectly laid-out object on the wrong NUMA node is still slow.

### 8. Cross-Runtime Trade-off Decisions

In a design review you'll be asked to justify a representation. The professional answer is quantified and context-aware:

- **"Box or flatten?"** Flatten when the field is on a hot path or the object count is high; tolerate boxing for low-cardinality, cold, or nullable-by-design fields where ergonomics win.
- **"Row or columnar?"** Columnar when the dominant access is scan/aggregate over few fields; row when access is whole-record and random.
- **"On-heap or off-heap?"** Go off-heap when GC pauses or footprint from a large, long-lived, simply-structured dataset (a cache, a buffer pool) dominate, and you can afford manual lifetime management.
- **"Polymorphism or closed set?"** Keep vtables for open, extensible hierarchies; use closed sets (`variant`, sealed types, enums) on hot paths to enable devirtualization.

Each is a trade between ergonomics/flexibility and footprint/speed, decided by *measured* importance, not dogma.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Footprint budget** | A shipping manifest where the per-box packaging weight, multiplied by a million boxes, dwarfs the cargo — so you redesign the packaging, not the cargo. |
| **On-heap vs off-heap** | Storing goods in a managed, staffed warehouse (GC) vs renting a bare lot you organize and guard yourself (off-heap): less service, more control, no per-shelf tax. |
| **Columnar storage** | A spreadsheet stored column-by-column so "sum all salaries" reads one contiguous strip instead of hopping across every row. |
| **ABI-stable wire layout** | A legal contract: every clause (field) in a fixed place; reorder one and every counterparty misreads the document. |
| **Endianness at the boundary** | Two countries writing dates differently — you must convert at the border or every date is wrong. |
| **Layout CI gate** | A scale at the loading dock that rejects any pallet over the weight limit before it ships. |
| **Value types** | Stamping the part directly into the assembly instead of bolting on a separately-boxed, separately-tracked component. |
| **NUMA locality** | Keeping each team's files in their own office rather than a distant central archive they must walk to. |

---

## Mental Models

### The "Multiply by N" Model

Every layout decision has a per-object cost; the architecture question is always *what is N?* A header is 16 bytes — trivial at N=1,000, decisive at N=10 billion. Before optimizing layout, estimate N and multiply. Conversely, before *ignoring* layout, multiply to confirm it's truly negligible. This single discipline separates premature micro-optimization from genuine architecture: the same 16 bytes is noise or a six-figure cloud line item depending only on N.

### The "Boundary vs Interior" Model

Split your data world into **interior** (hot in-memory representation, optimized for the CPU and GC: reordered, flattened, maybe SoA) and **boundary** (wire/FFI/persisted representation, optimized for stability and interop: packed, endianness-fixed, schema-versioned). They are *different* layouts connected by a conversion step. Conflating them — letting the wire format dictate your hot-path struct, or shipping your CPU-optimized struct raw over the wire — is a classic source of both slowness and corruption. Keep them separate; own the conversion.

### The "Layout Is a Contract You Must Test" Model

A layout property the system relies on — a struct size, a field offset, a hot function staying monomorphic, an allocation rate ceiling — is a contract. Untested contracts rot. Model each such property as something with a **test that fails when it's violated**, in the same way you'd test an API response shape. If you can't articulate the test, you don't actually have the guarantee; you have a hope that holds until the next refactor.

---

## Code Examples

### Java — Size and offset assertions as a layout gate

```java
import org.openjdk.jol.info.ClassLayout;
import static org.junit.jupiter.api.Assertions.assertEquals;

class Record { long id; int a, b; }   // expect: 16 hdr + 8 + 4 + 4 = 32, padded

@Test void layoutIsStable() {
    long size = ClassLayout.parseClass(Record.class).instanceSize();
    // Lock the size: adding a field or reordering carelessly fails the build.
    assertEquals(32, size, "Record layout changed — review footprint impact");
}
```

### Java — Off-heap record store with the Foreign Memory API

```java
import java.lang.foreign.*;
import static java.lang.foreign.ValueLayout.*;

// One contiguous off-heap block; no per-record header, no GC tracing.
MemoryLayout REC = MemoryLayout.structLayout(
    JAVA_LONG.withName("id"),
    JAVA_INT.withName("a"),
    JAVA_INT.withName("b"));            // 16 bytes/record, exact, header-free

try (Arena arena = Arena.ofConfined()) {
    long n = 100_000_000;
    MemorySegment seg = arena.allocate(REC.byteSize() * n);
    var idAt = REC.varHandle(MemoryLayout.PathElement.groupElement("id"));
    // 100M records = 1.6 GB flat; the on-heap object version would add
    // ~16 bytes/record of header (+1.6 GB) plus GC tracing cost.
}
```

### Rust — Pinned ABI layout with compile-time assertions

```rust
#[repr(C)]                    // stable field order + C padding; no reordering
pub struct WireHeader {
    pub magic: u32,           // offset 0
    pub version: u16,         // offset 4
    pub flags: u16,           // offset 6
    pub length: u64,          // offset 8
}

// CI gate: any layout drift fails to compile.
const _: () = assert!(std::mem::size_of::<WireHeader>() == 16);
const _: () = assert!(std::mem::offset_of!(WireHeader, length) == 8);

impl WireHeader {
    pub fn length_le(&self) -> u64 { u64::from_le(self.length) } // fix endianness at boundary
}
```

### C++ — `static_assert` on size and offset for an FFI struct

```cpp
#include <cstdint>
#include <cstddef>

#pragma pack(push, 1)
struct Packet {              // wire layout: exact, no padding, must not drift
    uint8_t  type;           // 0
    uint32_t length;         // 1  (misaligned on purpose: it's a wire format)
    uint16_t crc;            // 5
};
#pragma pack(pop)

static_assert(sizeof(Packet) == 7, "Packet wire layout changed");
static_assert(offsetof(Packet, crc) == 5, "Packet field moved");
```

### Go — Columnar (SoA) store for a scan workload

```go
// Row store (AoS): scanning one field hops 64 bytes per record.
type Trade struct { Px float64; Qty float64; Ts int64; Sym [8]byte }

// Columnar store (SoA): "sum of Px" streams one contiguous slice.
type Trades struct {
    Px  []float64
    Qty []float64
    Ts  []int64
    Sym [][8]byte
}
// Aggregations over Px now vectorize and stay cache-resident.
```

### Java — Allocation-rate guard (sketch)

```java
// In a perf test: run the workload, sample allocation via JFR/async-profiler,
// and fail if bytes-allocated-per-op exceeds a budget. Catches accidental boxing
// (autoboxing in a stream, Optional in a loop) before it ships.
assertThat(allocatedBytesPerOp).isLessThan(BUDGET_BYTES);
```

---

## Pros & Cons

| Decision | Pros | Cons |
|----------|------|------|
| **On-heap objects** | Ergonomic, type-safe, GC-managed; default. | Per-object header/boxing; GC tracing cost; pauses at scale. |
| **Off-heap buffers** | No header, no GC tracing, mmap/shareable, full layout control. | Manual lifetime, no type safety, hand-rolled (un)marshalling, segfault risk. |
| **Columnar / SoA** | Vectorizable scans, strong compression, one header per column, cache-resident aggregation. | Poor for whole-record random access; complex updates; reassembly cost. |
| **Pinned ABI layout** | Stable, interoperable, corruption-proof across boundaries. | Rigid; no compiler reorder benefit; manual endianness; weak evolution unless schema'd. |
| **Layout CI gates** | Catch footprint/shape regressions at build time. | Maintenance; brittle if too strict; must be updated with intentional changes. |
| **Value types / flattening** | Remove header tax at the type level; dense arrays; fewer allocations. | Lose reference identity/nullability; not always available (pre-Valhalla Java). |
| **NUMA/large-page placement** | Lower latency and TLB pressure at top scale. | Platform-specific, complex, easy to get wrong; premature for most systems. |

---

## Use Cases

Professional layout engineering is warranted when:

- **Object cardinality is in the millions to billions.** Per-object constants dominate the cost; flattening, off-heap, or columnar pays for itself.
- **GC pauses or heap size threaten an SLO.** Layout changes (less boxing, off-heap caches, fewer/larger objects) directly reduce allocation rate and tracing cost.
- **An analytical/scan workload reads few fields across many records.** Columnar/SoA is the architecture, not an optimization.
- **Data crosses a versioned boundary** — network protocol, on-disk format, FFI, shared memory. Layout becomes a contract requiring pinning and schema evolution.
- **A hot path must stay optimized across releases.** Shape/deopt and allocation regressions need CI gates.
- **You're at the top of the latency/throughput curve** where NUMA and page placement become measurable.

It is *not* warranted for modest scale, cold paths, prototypes, or anywhere correctness and delivery speed dominate and the footprint multiplies to nothing.

---

## Coding Patterns

### Pattern 1: Separate interior and boundary representations

```rust
struct Trade { px: f64, qty: f64 }          // interior: CPU-optimized, may reorder
#[repr(C)] struct TradeWire { px: u64, qty: u64 }  // boundary: pinned, endianness-fixed
// explicit to_wire()/from_wire() conversions at the edge
```

### Pattern 2: Lock layout with a compile-time/CI assertion

```cpp
static_assert(sizeof(HotRecord) == 32, "footprint regression — review");
```
```rust
const _: () = assert!(std::mem::size_of::<HotRecord>() == 32);
```

### Pattern 3: Off-heap arena for a large, simply-typed dataset

```java
try (Arena arena = Arena.ofShared()) {
    MemorySegment data = arena.allocate(recordSize * count);
    // bump-allocate records; free the whole arena at once; zero GC tracing
}
```

### Pattern 4: Columnar layout for scan-heavy data

```go
type Cols struct { a []int64; b []float64; c []byte }  // one column per field
```

### Pattern 5: Prefer value types / flattening where identity isn't needed

```rust
struct Line { start: Point, end: Point }  // Point flattened inline, no Box, no header
```

---

## Best Practices

- **Budget footprint per record and multiply by N** before choosing a representation; revisit when N changes by an order of magnitude.
- **Validate layout against GC, not intuition.** Confirm boxing/flattening changes with GC logs and allocation profiles.
- **Keep interior and boundary layouts separate,** connected by an explicit, tested conversion; define endianness at the boundary.
- **Pin ABI layouts with size/offset assertions** and use a schema'd format (Protobuf/FlatBuffers/Cap'n Proto) when the schema will evolve.
- **Gate layout in CI:** size assertions, allocation-rate budgets, and (for JS/TS) deopt-free hot-path checks.
- **Reach for off-heap or columnar deliberately,** only when footprint/GC/scan-pattern justify the loss of ergonomics and safety.
- **Use value types and flattening** as the structural fix for header overhead where identity and nullability aren't required.
- **Treat NUMA/large-page placement as the last 10%** — measure first; it matters only at the top of the performance curve.
- **Document the *why*** of every non-obvious layout choice; the next engineer will otherwise "clean it up" and reintroduce the regression.

---

## Edge Cases & Pitfalls

- **The "it's only 8 bytes" dismissal.** Multiply by N before dismissing. Eight bytes across ten billion objects is 80 GB.
- **Wire format leaking into the hot path** (or vice versa). A packed, endianness-fixed wire struct used directly as the in-memory hot object is misaligned and slow; a CPU-reordered struct shipped raw over the wire corrupts data.
- **Raw structs as a wire format with no schema evolution.** Adding a field to a raw C struct breaks every existing reader. Use a format with defined evolution if the schema can change.
- **Off-heap lifetime bugs.** No GC means use-after-free, leaks, and double-frees return; an off-heap cache needs rigorous lifetime ownership (arenas, RAII, confined/shared arenas).
- **Endianness assumed, not specified.** Works in dev (same architecture), corrupts in production across heterogeneous hosts (x86 writer, ARM reader).
- **CI gates too strict or never updated.** A size assertion that's "always tweaked to pass" provides no protection; an intentional layout change must consciously update the gate, with review.
- **Columnar updates and point lookups.** Columnar is brilliant for scans and brutal for "update record 5's three fields" or "fetch one whole record"; don't force a transactional workload into it.
- **Valhalla/value-type identity loss.** Flattening removes reference identity — `==`, locking on the object, and nullability semantics change; not a drop-in for every class.
- **NUMA first-touch surprises.** Memory is placed on the node that *first writes* it, not the one that allocates it; initialize per-thread data from the thread that will use it.
- **GC interactions you didn't model.** Reducing object size can change promotion timing and survivor occupancy in non-obvious ways; always re-measure pauses after a layout change.

---

## Test Yourself

1. A service holds 8 billion cache entries. Each could be an on-heap object (16-byte header + 24 bytes of fields, padded) or an off-heap 24-byte record. Compute the footprint difference and argue when off-heap is justified.
2. Your P99 latency regressed after a refactor that replaced an `int` field with `Integer` in a hot path. Explain the chain from that one-field change to a GC-pause regression.
3. Design the interior and boundary layouts for a market-data tick, naming exactly what differs between them and where the conversion lives.
4. Write the CI gate (size + offset assertions) for an ABI struct that three teams' services depend on. What does each assertion protect against?
5. A reporting query sums one column across 2 billion rows. Argue for columnar over row layout with concrete cache-line and compression reasoning. When would row layout still win?
6. You move a hot LRU cache off-heap to cut GC pauses. List the three new failure modes you've taken on and how you'd guard each.
7. Explain how NUMA first-touch can make a "correctly sharded" per-core structure slow, and how you'd fix the allocation.
8. When would you keep a vtable-based polymorphic hierarchy in production despite the dispatch cost, and when would you convert it to a closed set?

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│         OBJECT MODEL & LAYOUT — PRODUCTION DISCIPLINE           │
├──────────────────────────────────────────────────────────────────┤
│ FOOTPRINT = N × (header + fields + padding + structure)          │
│   ALWAYS multiply by N before optimizing OR dismissing           │
├──────────────────────────────────────────────────────────────────┤
│ REGIME by access pattern + scale:                                │
│   on-heap   : default; ergonomic; pays header/boxing + GC        │
│   off-heap  : flat, header-free, mmap/shareable; manual lifetime │
│   columnar  : scan few fields over many rows; vectorize+compress │
├──────────────────────────────────────────────────────────────────┤
│ LAYOUT <-> GC: boxing -> alloc rate; object count -> mark cost;  │
│   bigger objects -> faster promotion -> old-gen pressure         │
├──────────────────────────────────────────────────────────────────┤
│ INTERIOR vs BOUNDARY: two layouts, one conversion                │
│   interior: reordered/flattened/SoA for CPU+GC                   │
│   boundary: packed, endianness-fixed, schema-versioned          │
├──────────────────────────────────────────────────────────────────┤
│ PIN ABI: static_assert size & offset; define endianness;        │
│   use schema'd format if fields evolve (don't ship raw structs)  │
├──────────────────────────────────────────────────────────────────┤
│ CI GATES: size asserts | offset asserts | alloc-rate budget |    │
│   deopt-free hot path (JS) -> regressions fail the BUILD         │
├──────────────────────────────────────────────────────────────────┤
│ STRUCTURAL FIX: value types / flatten -> remove header at type   │
│ TOP 10%: NUMA first-touch + large pages (measure first)          │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- At scale, **footprint** is a first-class metric: `N × (header + fields + padding + structure)`, where per-object constants dominate when N is large. Always multiply by N before optimizing or dismissing.
- **Layout and GC are coupled:** boxing drives allocation rate, object count drives mark cost, larger objects promote sooner. A local layout change can be a global pause regression — validate with GC logs.
- Choose the **regime** by access pattern and scale: **on-heap** (default, ergonomic, header-paying), **off-heap** (flat, header-free, GC-free, manually managed), or **columnar/SoA** (scan-and-aggregate, vectorizable, compressible).
- Keep **interior** (CPU/GC-optimized) and **boundary** (wire/FFI, packed, endianness-fixed, schema-versioned) representations **separate**, joined by an explicit, tested conversion. Never let one dictate the other.
- **Pin ABI layouts** with size and offset assertions, define endianness explicitly, and use a schema'd format for evolvable wire data — raw structs have no evolution story.
- **Guard layout in CI:** size/offset assertions, allocation-rate budgets, and deopt-free hot-path checks turn invisible layout regressions into build failures, because a depended-on layout property is a contract that must be tested.
- **Value types and flattening** remove the header tax structurally; reach for off-heap/columnar deliberately, accepting the loss of ergonomics and safety only when footprint, GC, or scan patterns justify it.
- At the top of the performance curve, **NUMA first-touch placement and large pages** decide whether a well-shaped object is also well-placed — measure before reaching for them.
- The professional stance is **ownership and quantification**: set the layout policy, defend it with numbers, encode it as an enforced invariant, and own the production result.

---

## What You Can Build

- **A footprint calculator** that, given a class/struct definition and an N, reports on-heap vs off-heap vs columnar footprint and flags the dominant overhead.
- **An off-heap record store** (Java Foreign Memory or C++/Rust over `mmap`) with a flat layout, benchmarked against the on-heap equivalent for footprint and GC-pause impact.
- **A layout-regression CI suite:** size/offset assertions for ABI structs, an allocation-rate gate for a hot path, and a deopt-free check for a Node service.
- **A columnar mini-engine** that loads a dataset row-wise and column-wise and compares scan-one-field throughput, with per-column compression.
- **An interior/boundary codec** that maintains a CPU-optimized in-memory struct and a pinned, endianness-defined, versioned wire format, with round-trip and evolution tests.

---

## Further Reading

- *Apache Arrow* and *Parquet* specifications — the reference designs for columnar/SoA layout at scale.
- *Project Valhalla* (JEPs and design notes) — value/primitive classes and flattening on the JVM.
- Java *Foreign Function & Memory API* (JEP 454 and successors) — off-heap layout and FFI.
- *Cap'n Proto* and *FlatBuffers* design docs — zero-copy, schema-evolved wire layouts.
- *Designing Data-Intensive Applications* — Kleppmann; encoding, evolution, and storage-layout chapters.
- *Systems Performance* — Brendan Gregg; NUMA, large pages, and how layout shows up in production profiles.
- *Data-Oriented Design* — Richard Fabian; the production case for SoA and layout-led architecture.
- Vendor optimization manuals (Intel/AMD) and `perf` documentation for `c2c`, `stat`, and memory analysis.

---

## Related Topics

- This folder: `junior.md`, `middle.md`, `senior.md`, `interview.md`, `tasks.md`.
- The next runtime topic, **method dispatch**, is where the polymorphism-vs-closed-set trade-off from this page is decided at the instruction level.
- **Garbage collection** is the runtime subsystem most tightly coupled to the layout decisions here — allocation rate, tracing cost, and promotion all follow from the object model.
- **Data representation** owns the boxing/tagging/value-type material that drives footprint at the field level.
- **Cache architecture, NUMA, and the memory hierarchy** determine whether a well-shaped object is also well-placed and cache-resident.
- **Serialization and wire formats** are the boundary-layout discipline this page pins and version-controls.

---

## Diagrams & Visual Aids

### Three Layout Regimes

```text
ON-HEAP (rows, managed)        OFF-HEAP (rows, flat)       COLUMNAR (SoA)
┌────────────┐ ┌────────────┐  ┌────┬────┬────┬────┐       a: [a0 a1 a2 a3 ...]
│hdr│ a │ b  │ │hdr│ a │ b  │  │ a  │ b  │ a  │ b  │       b: [b0 b1 b2 b3 ...]
└────────────┘ └────────────┘  └────┴────┴────┴────┘       c: [c0 c1 c2 c3 ...]
 +header each, GC-traced        no header, no GC,           one schema for all
 scattered                      contiguous, mmap-able        rows; scans stream
```

### Interior vs Boundary

```text
   INTERIOR (in memory)                  BOUNDARY (on the wire)
 ┌──────────────────────┐   to_wire()   ┌──────────────────────────┐
 │ reordered, padded,   │──────────────▶│ packed, endianness-fixed, │
 │ flattened, maybe SoA │◀──────────────│ schema-versioned          │
 │ tuned for CPU + GC   │   from_wire() │ tuned for stability       │
 └──────────────────────┘               └──────────────────────────┘
        DIFFERENT layouts, joined by an explicit, TESTED conversion
```

### The Multiply-by-N Decision

```text
 per-object overhead: 16 bytes
        │
        ├── N = 1,000        -> 16 KB     -> ignore
        ├── N = 1,000,000    -> 16 MB     -> maybe
        └── N = 10,000,000,000 -> 160 GB  -> ARCHITECTURE
                                            (flatten / off-heap / columnar)
```

### Layout as a Tested Contract

```text
  source change ──▶ struct grows / field reorders / boxing creeps in
                          │
                   ┌──────┴───────────────────────────┐
                   ▼                                   ▼
        static_assert(sizeof==32)            alloc-rate budget gate
        offset assertions                    deopt-free hot-path check
                   │                                   │
                   └──────────── BUILD FAILS ──────────┘
            the regression is caught here, not in production metrics
```
