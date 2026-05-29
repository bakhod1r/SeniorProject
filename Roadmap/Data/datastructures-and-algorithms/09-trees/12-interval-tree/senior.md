# Interval Tree — Senior Level

> **Audience:** Senior engineers who have shipped interval-related code and want a tour of where interval trees live in real systems. We assume you have read `junior.md` and `middle.md`.

This document is a survey of **production deployments** of interval trees and close relatives. The patterns repeat: a domain has objects that occupy intervals on some axis (time, address space, genome coordinates, chromosome positions, register lifetimes), queries ask "which objects overlap this point or range", and the structure of choice is an augmented BST or a centered tree.

---

## Table of Contents

1. [Calendar Systems — Google Calendar, Outlook, iCal](#calendar)
2. [Bioinformatics — BEDtools, samtools, `intervaltree`, Bx-python](#bioinformatics)
3. [Network Flow Analysis](#network)
4. [GIS and 1D Projections](#gis)
5. [Linux Kernel — `lib/interval_tree.c` and VMA Lookup](#linux-kernel)
6. [LLVM Register Allocation — Live Ranges](#llvm)
7. [Database Range Indexes — PostgreSQL GiST](#postgres)
8. [JVM GC — Free-List Interval Tracking](#jvm-gc)
9. [Compilers — Live-Variable Analysis in Linear-Scan Register Allocation](#linear-scan)

---

<a name="calendar"></a>
## 1. Calendar Systems — Google Calendar, Outlook, iCal

Every calendar app must answer "what events overlap this view window?" thousands of times per session as the user scrolls. The data model is uniform: `event = (start_time, end_time, metadata)`. The query is **range overlap**: `event.end >= window.start && event.start <= window.end`.

### Google Calendar

Google's backend serves overlap queries from a sharded time-series index. Within each shard, the active-event set is held in an augmented in-memory structure that behaves like a centered interval tree at query time and is rebuilt periodically as events are added or removed. Critically, **recurring events** are not materialized — a "every Monday at 10am for 6 months" event is stored as a recurrence rule and *expanded* only when the query window asks for it. The interval tree indexes the recurrence rules' active spans, and individual occurrences are computed on demand.

The latency budget for a calendar overlap query is on the order of 50 ms end-to-end across an entire account's history — only achievable with O(log n + k) primitives.

### Microsoft Outlook / Exchange

Exchange's calendar store uses an interval index on top of its JET storage engine. The "free/busy" lookup — "is user X available between 14:00 and 15:00 on Tuesday?" — is a stabbing-and-range query under the hood. The free/busy view is a derivative of the interval set: the complement of the union of busy intervals over the query window.

### iCal / `libical`

`libical` ships in macOS and many Linux distros. Its `icalcomponent_foreach_recurrence` API takes a `time_t start, time_t end` and iterates events overlapping the window. Internally it materializes recurrence patterns into a temporary interval list and sweeps it — a small-n setting where a sorted list outperforms an interval tree. For large calendars (10⁵+ events), wrapping `libical` with an interval-tree-backed prefilter is a common pattern.

---

<a name="bioinformatics"></a>
## 2. Bioinformatics — BEDtools, samtools, `intervaltree`, Bx-python

Genomic data is naturally interval-structured. Genes, exons, regulatory elements, ChIP-seq peaks, read alignments — each is a `(chromosome, start, end)` triple. Queries are overwhelmingly "give me everything overlapping region X on chromosome Y".

### BEDtools

`bedtools intersect` is the gold-standard tool for genomic overlap queries. Under the hood, BEDtools uses a **chromosome-keyed** dictionary mapping each chromosome to its own interval tree of features. The implementation is a centered (McCreight-style) tree of intervals, batch-built when the BED file is loaded. Query throughput is millions of overlaps per second on a single thread.

Why per-chromosome? Because overlap is impossible across chromosomes — there is no genomic coordinate that spans chr1 and chr2 — so partitioning gives both data locality and an embarrassingly parallel structure.

### samtools / htslib

`samtools` and the `htslib` C library use **tabix-style** indexed BAM/VCF/BED files. The on-disk index uses **R-trees of bin intervals** (the "linear index" and "binning index" of UCSC and `samtools` BAM specs) rather than in-memory interval trees, because the queries hit terabyte-scale files where I/O dominates. But once a candidate set is loaded, the in-memory layer is an interval-tree-style stab.

### Python `intervaltree`

The `intervaltree` PyPI package is a pure-Python implementation of a self-balancing centered interval tree. It is widely used in genomics scripting because it presents a Pythonic API:

```python
from intervaltree import IntervalTree, Interval
t = IntervalTree()
t[10:20] = "gene_A"
t[15:25] = "exon_3"
t[100:200] = "promoter"
overlapping = t[12:18]      # set of Intervals overlapping [12, 18)
```

Half-open semantics (`[start, end)`), exactly matching BED. Insertion is O(log n), query is O(log n + k). The implementation handles dynamic insert/delete via lazy splitting; for batch loads, `IntervalTree(initial_intervals)` does an O(n log n) build.

### `bx-python`

Galaxy Project's `bx-python` ships a Cython-accelerated interval tree with API compatible with `intervaltree` but ~10× faster. Used in production by ENCODE pipelines and many academic groups.

---

<a name="network"></a>
## 3. Network Flow Analysis

Packet capture and flow analysis software (Wireshark, Zeek/Bro, ntopng, Suricata) constantly run interval queries:

- **Time-window overlaps.** "Which TCP flows were active between 14:30:00 and 14:30:05?" Each flow is a time interval; the query is range-overlap.
- **Port-range firewall lookup.** Firewall rules often specify port ranges (e.g., `allow tcp 8000-8999`). An incoming packet on port 8042 triggers a stab-query against the rule set.
- **CIDR longest-prefix match** is a different problem (it's an *interval* problem in disguise — `10.0.0.0/24` is the address interval `[10.0.0.0, 10.0.0.255]` — but the canonical structure is a *trie*, not an interval tree; tries match the prefix structure of IPv4/IPv6 better).

Suricata's firewall rule index is an augmented interval tree over port ranges with a hash-map first-level lookup on protocol; this matches "first identify protocol via O(1) hash, then stab the port-range interval tree" in O(1 + log n + k).

---

<a name="gis"></a>
## 4. GIS and 1D Projections

For 2D and 3D spatial data, the canonical index is an **R-tree** (PostGIS, MongoDB 2dsphere, SQLite R*Tree module). Interval trees rarely appear *directly* in GIS because most geographic queries are 2D bounding-box overlaps.

The exception: **1D projections**. If you project a 2D bounding box `(xmin, ymin, xmax, ymax)` onto the x-axis you get an interval `(xmin, xmax)`, and onto the y-axis another. Some GIS engines use interval-tree-style prefilters on a projection before the full 2D test — a coarse filter that prunes 99% of candidates, followed by an exact 2D check. This is the **filter-and-refine** pattern in spatial databases.

PostgreSQL's GiST and SP-GiST extensions implement R-tree-like behavior but allow plugging in interval-tree operators for 1D types (`int4range`, `tsrange`, `daterange`).

---

<a name="linux-kernel"></a>
## 5. Linux Kernel — `lib/interval_tree.c` and VMA Lookup

The Linux kernel contains a generic, type-safe augmented RB interval tree implemented in `include/linux/interval_tree.h` and `lib/interval_tree.c`. It is built on top of `lib/rbtree.c` plus the augmentation framework in `include/linux/rbtree_augmented.h`.

### `INTERVAL_TREE_DEFINE` macro

The header defines a macro:

```c
INTERVAL_TREE_DEFINE(ITSTRUCT, ITRB, ITTYPE, ITSUBTREE, ITSTART, ITLAST, ITSTATIC, ITPREFIX)
```

It generates strongly typed `insert`, `remove`, and `iter_first` / `iter_next` functions for any user-defined struct. Callers provide the field accessors (`ITSTART`, `ITLAST`) so the same tree can index any interval-typed struct without dynamic dispatch. The result is zero-overhead generics in C.

### VMA tree (`mm/mmap.c`)

Every process has a list of **virtual memory areas** — contiguous ranges of virtual addresses with uniform properties (read/write/execute, file-backed, anonymous). When the kernel handles a page fault at address `addr`, it must find the VMA containing `addr`. With thousands of VMAs in a long-running process, a linear scan is too slow.

Pre-Linux-2.6 the kernel used a sorted list. Linux 2.6 introduced an augmented RB interval tree of VMAs. Linux 6.x is **migrating** to a Maple Tree (range-keyed B+ tree) which handles VMA queries even more efficiently, but the interval-tree pattern is still in many subsystems.

The augmentation: `__rb_subtree_last = max last-byte of any VMA in this subtree`. The lookup is identical to the CLRS `overlapSearch` from `junior.md`.

### Other kernel interval trees

- **KASAN** (Kernel Address Sanitizer) — tracks live allocations as intervals; lookup on every memory access.
- **KVM** — guest memory slot lookup.
- **DMA mapping** — IOMMU page-region tracking.
- **Page cache** — extent indexing in some filesystems.

---

<a name="llvm"></a>
## 6. LLVM Register Allocation — Live Ranges

In LLVM, every SSA value has a **live range** — the interval(s) between its definition and last use. The Greedy and Linear Scan register allocators ask constantly:

- "Which live ranges overlap this point?" (stab) — for spill decisions.
- "Which live ranges interfere with this candidate live range?" (overlap) — for the interference graph.

LLVM's `LiveInterval` class in `llvm/CodeGen/LiveInterval.h` represents a value's lifetime as a list of `LiveRange` segments — half-open `[Start, End)` intervals in *slot index* space. The `LiveIntervals` analysis builds and maintains the per-virtual-register intervals; the `MachineRegisterInfo` queries them via overlap predicates.

The internal data structure is *not* a CLRS interval tree — LLVM uses a sorted vector of segments per live interval (typical interval count per value is small) plus a global query layer. But the *algorithm* is interval overlap. For a CPU with many physical registers and a hot inner loop, the allocator may call `LiveInterval::overlaps(other)` thousands of times.

---

<a name="postgres"></a>
## 7. Database Range Indexes — PostgreSQL GiST

PostgreSQL supports range types: `int4range`, `int8range`, `numrange`, `tsrange`, `tstzrange`, `daterange`. You can index them with GiST or SP-GiST:

```sql
CREATE INDEX idx_meeting_when ON meetings USING GIST (when_range);
SELECT * FROM meetings WHERE when_range && tsrange('2026-05-29 14:00', '2026-05-29 15:00');
```

The `&&` operator is the **overlap** predicate. GiST's implementation for range types is an R-tree-like generalization that partitions intervals by bounding ranges at each node. It is not a pure interval tree (R-trees were independently invented in 1984), but it answers the same questions with the same asymptotics. For 1D data the two structures are very close in performance; R-trees were designed to scale to higher dimensions.

The TimescaleDB extension adds a custom **chunk skip index** layered on top, partitioning time by chunks and pruning entire chunks at the planner level — another instance of "filter, then refine".

---

<a name="jvm-gc"></a>
## 8. JVM GC — Free-List Interval Tracking

Generational garbage collectors maintain **free lists** — sets of free address intervals available for allocation. After a young-generation collection promotes survivors to old-gen, the old-gen free list is updated. Coalescing adjacent free intervals and finding a free interval of at least size `S` are the two hot operations.

The Hotspot CMS collector used a binary tree of free chunks keyed by size, with secondary linked-list bucketing for popular sizes. ZGC and Shenandoah use page-granular free lists with bit-vector tracking. The G1 collector uses region-grained free lists — simpler than interval trees because regions are uniform size.

The Azul Zing JVM uses an *augmented* binary search tree of free chunks that supports both size-keyed and address-keyed queries with O(log n) — a *bi-indexed* interval set.

---

<a name="linear-scan"></a>
## 9. Compilers — Live-Variable Analysis in Linear-Scan Register Allocation

The **linear-scan** register allocator (Poletto and Sarkar, 1999) sorts live intervals by start point and sweeps left-to-right, maintaining an "active" set of intervals that overlap the current sweep position. At each new interval:

1. **Expire** active intervals whose end is before the current start. (Iterate the active set sorted by end; pop the head while its end is past.)
2. If a free register is available, assign it.
3. Otherwise spill the active interval with the latest end point (or the new one, depending on heuristic).

The active set is a small `std::set<LiveInterval*, ByEnd>`. Total complexity O(n log n). It does *not* need a full interval tree because intervals are seen in start-sorted order — the active set is the only structure required.

This is a worked example of when **interval trees are not the right answer**: if your access pattern is a sorted sweep, a heap/sorted-set is enough. Reach for an interval tree when the queries are **out of order** or **random access**.

---

**Where to go next.** `professional.md` digs into concurrency models for interval trees (lock coupling, RCU, optimistic concurrency), cache-conscious layouts (Eytzinger, B+tree-of-intervals), bulk operations, persistent variants, and multidimensional generalizations (2D interval trees → kd-trees → R-trees).
