# B+ Tree — Professional Level

> **Audience:** Engineers designing storage engines, database internals, or working on the edge of CPU / memory / disk hardware. Prerequisite: `senior.md`.

This document covers the techniques used at the cutting edge: page-format optimizations that turn fanout into a tunable knob, lock-free designs, cache-conscious layouts, the MVCC interaction with the index, hardware-conscious leaf sizing for modern SSDs and NVMe, and the in-memory alternatives (ART, HOT) that have come to dominate when the dataset fits in RAM.

---

## Table of Contents

1. [Page Format Optimizations](#page-format)
2. [Slot Directories vs Inlined Offsets](#slot-dir)
3. [Lock-Free B+ Trees](#lock-free)
4. [Cache-Conscious Leaf Layout](#cache)
5. [WAL Design and MVCC Interaction](#wal-mvcc)
6. [Write Amplification](#write-amp)
7. [In-Memory Alternatives: ART and HOT](#in-memory)
8. [Hardware-Conscious Leaf Sizing](#hardware)
9. [FoundationDB and Modern Distributed B+ Trees](#distributed)

---

<a name="page-format"></a>
## 1. Page Format Optimizations

A B+ tree page must support: efficient binary search on keys, insertion of a new key at a sorted position, deletion of a key, and serialization to/from disk. The naive layout — sorted array of fixed-size records — is too inflexible for production. Real implementations use:

### Variable-length records

Real keys (strings, JSON, composite columns) vary in size. A fixed-size record layout wastes space; a variable-length layout requires a slot directory (see next section).

### Prefix compression (refresher)

Adjacent keys share prefixes. Store the prefix once at the page level; each record is `(prefix_length, suffix_bytes)`. For sorted timestamps a 23-byte ISO-8601 string compresses to 2–3 bytes per record.

PostgreSQL nbtree's implementation (`btree_compress_tuple` / `_bt_compress_one_page`): when a page fills, attempt to compress; if it frees enough space, defer the split. This is **on-demand compression** — keys are stored uncompressed by default and only compressed when space pressure demands it. The trade-off: read cost is the same (decompression happens), but writes are simpler when space is abundant.

### Suffix truncation in internal nodes (refresher)

Internal-node routing keys can be truncated to the shortest discriminating prefix. For URL-keyed indexes, a 200-byte URL might truncate to 8 bytes, increasing fanout dramatically.

### Differential encoding

For monotonically increasing or decreasing keys (sequence numbers, timestamps), store the first key in full and subsequent keys as deltas. With variable-length integers (varints), a sequential `BIGINT` column compresses from 8 bytes to 1–2 bytes per record.

### Bit-packed structures

Some specialized indexes use bit-packed integer encoding inside leaves: a leaf with 256 keys in the range `[0, 65536)` packs each key into 16 bits — 512 bytes for 256 keys vs 2 KB for naive 8-byte integers.

---

<a name="slot-dir"></a>
## 2. Slot Directories vs Inlined Offsets

When records are variable-length, you need an indirection layer to support binary search.

### Slot directory layout

```
+--------------------------------------+
| page header                          |
+--------------------------------------+
| slot[0] -> offset 4012               |   // slot directory (fixed-size pointers)
| slot[1] -> offset 4000               |
| slot[2] -> offset 3988               |
| ...                                  |
+--------------------------------------+
| (free space, grows down)             |
| ...                                  |
| (free space, grows up)               |
+--------------------------------------+
| record_2: "carrot|val"               |  // records grow from end of page
| record_1: "broccoli|val"             |
| record_0: "apple|val"                |
+--------------------------------------+
```

Slots are fixed-size (typically 2–4 bytes per slot) and sorted by key. Records are stored from the end of the page, growing inward.

**Insert:** find slot position via binary search, shift later slots up, write the record at the bottom of free space, point new slot at it.

**Delete:** mark slot as deleted (lazy) or shift slots down (immediate). Vacuum compacts later.

**Binary search:** uses slots, not records. Each step does one slot lookup + one record dereference.

### Why slot directories?

- Supports variable-length records.
- Sorted slot order means binary search works without moving record data.
- Insert/delete only shifts the slot directory, not the (larger) record area.

### Used by

- PostgreSQL nbtree (`ItemIdData[]` is the slot directory; `IndexTuple` is the record).
- MySQL InnoDB ("compact" row format uses a slot directory; "dynamic" format extends it for off-page BLOBs).
- SQLite (cell pointer array in the page header).

### Drawback

Each record access is two memory loads (slot, then record). For cache-resident pages this is fine. For memory-bound in-memory B+ trees, this can hurt — which is why in-memory designs (ART, HOT) avoid slot directories.

---

<a name="lock-free"></a>
## 3. Lock-Free B+ Trees

In a multi-core server, latches become contention bottlenecks. **Lock-free B+ trees** eliminate latches entirely.

### Bender et al. (Cache-Oblivious B-Trees)

A theoretical foundation: B+ tree layouts that adapt to any cache size without explicit cache-aware tuning. Combined with version-based concurrency, this enables wait-free reads.

### Read-mostly designs via RCU

**Read-Copy-Update** (RCU) is a Linux-kernel-style technique: writers create new versions of nodes; readers continue to use the old version until they finish; old versions are reclaimed only after all readers have moved on.

Applied to B+ trees: a writer building a new leaf doesn't disturb readers walking the old leaf. The transition is atomic — a single CAS on the parent's child pointer makes the new leaf visible. Old nodes are placed on a grace-period queue and freed later.

Used heavily in **Linux kernel** data structures (the radix tree, the maple tree) and increasingly in user-space B+ tree libraries (the `userspace-rcu` library).

### OLFIT (Optimistic Latch-Free Index Traversal)

Cha et al. (2001) introduced optimistic latching: each node has a version counter. Readers:
1. Read the version.
2. Read the node contents.
3. Re-read the version. If it changed, restart.

Writers acquire the latch, modify, increment the version, release. Readers never block; they might retry.

The trade-off: under heavy write contention, readers retry repeatedly. Modern variants (HyPer's, Umbra's) add **hand-over-hand optimistic latching**: instead of restarting from root, retry only the last level.

### Bw-tree (revisit from middle.md)

Microsoft Research's Bw-tree (Levandoski et al. 2013) extends the lock-free approach further: each "page" is a base page plus a chain of delta records linked via CAS. No in-place modification, no latches, ever. Used in SQL Server Hekaton (in-memory tables) and the Azure Cosmos DB backend.

### Cost of going lock-free

- Implementation complexity is high.
- Memory reclamation (RCU grace periods, hazard pointers, epoch-based reclamation) is non-trivial.
- Memory overhead per node is higher (version counters, delta chains).

For high-throughput in-memory OLTP these costs pay off. For disk-resident B+ trees with latency-dominated I/O, latch coupling is simpler and effectively just as fast.

---

<a name="cache"></a>
## 4. Cache-Conscious Leaf Layout

Modern CPUs have multi-level caches with strict size and line-size constraints (typically 32–64 KB L1, 256–512 KB L2, 8–64 MB L3, cache line 64 bytes). A B+ tree page layout that ignores these costs throughput.

### Cache-line-aligned slots

Pack slot directories so each binary-search probe touches one cache line. For an 8 KB page with 128 slots, 8-byte slots fit 8 per cache line — binary search touches 4–5 cache lines per probe. Smaller slots (2 or 4 bytes) reduce probes to 2–3.

### Hot/cold record separation

Within a leaf, recent inserts cluster at the high end of the sort order (for time-series data). Layout the slot directory to put recent records at adjacent slots so a `SELECT * WHERE ts > now() - interval '1 hour'` touches a small contiguous slot range.

### Eytzinger-layout internal nodes

For very wide internal nodes (fanout 1000+), the slot directory itself is large. A standard binary-search layout has random-feeling probe patterns. The **Eytzinger layout** rearranges the slots so that the binary-search probe pattern is sequential in memory — see `08-search-algorithms/02-binary-search/professional.md`. Used in some experimental in-memory B+ trees.

### Tiered / hierarchical leaves

For NVMe SSDs with very high throughput (~3 GB/s read, ~1 GB/s write), large leaves (32–128 KB) amortize page-fault overhead. Inside the leaf, a small in-leaf index (a "leaf-internal" B-tree) speeds up binary search.

### Compactness as cache savings

Every byte saved is a byte that doesn't fall out of cache. Prefix compression, suffix truncation, and bit-packing all directly improve cache hit rate.

---

<a name="wal-mvcc"></a>
## 5. WAL Design and MVCC Interaction

### Per-page redo records

The cheapest WAL strategy: each modification logs a **delta record** describing the change (e.g., "insert key K at slot S on page P"). On recovery, replay the delta against the (assumed intact) page.

This requires the page to be consistent before the redo applies. **Full-page writes** (FPW), as PostgreSQL uses for the first modification after each checkpoint, ensure consistency.

### MVCC and the index

PostgreSQL's MVCC: each heap row has multiple versions (tuples) with begin/end transaction IDs. The B+ tree's leaf cells point to all live versions' heap TIDs for a given key — the index doesn't track row visibility, it just maintains all (key, TID) pairs and lets the heap visibility check filter them.

This decouples the index from MVCC mechanics — keeps the B+ tree simple — but means **the index grows with every row version**, leading to "index bloat". `VACUUM` removes dead TIDs from the index.

InnoDB's MVCC: row versions live in the **undo log**, not the heap. The clustered index leaf holds the current version; readers follow undo log chains to find their snapshot's version. The B+ tree never sees old versions — they live elsewhere.

WiredTiger's MVCC: in-leaf update chains. Each leaf cell can be the head of an append-only chain of versions, sorted by timestamp. Readers walk the chain until they find their snapshot.

Three different solutions to the same problem; each affects B+ tree behavior subtly:
- Postgres: simple index, expensive vacuum.
- InnoDB: clean index, expensive undo navigation.
- WiredTiger: in-place versioning, complex leaf structure.

### REDO vs UNDO

REDO logs (replay-forward) are sufficient for crash recovery if all writes happen at commit. UNDO logs (rollback) are needed for transaction abort and MVCC snapshot reads. Most production engines use both: REDO for durability, UNDO for isolation.

---

<a name="write-amp"></a>
## 6. Write Amplification

The fundamental cost equation of any disk-backed structure: how many bytes of disk write does one byte of user-visible write produce?

### Classic B+ tree

- Insert: write the modified leaf page. For a 16 KB page and a 64-byte insert, that's **256× write amplification**.
- Page split: write two pages (256 + 256 = 512×).
- WAL write: another 16 KB per checkpoint cycle for FPW.

### CoW B+ tree

- Insert: write the entire root-to-leaf path. For height 4, that's 4 × 16 KB = 64 KB per insert.
- But: no WAL needed, so the comparison is closer than it appears.

### Bε-tree

- Buffered insert: a few bytes to the root buffer. Amortized cost = total page rewrites / total inserts = `O(log_B(n) / B^{1-ε})`. For ε = 1/2 and B = 100: roughly 1.2× amplification per insert across the whole structure.
- Trade: lookups are slower because they walk message buffers.

### LSM tree (comparison point)

- Insert: append to memtable, periodically flush to a sorted file, periodically merge files. Amplification depends on compaction strategy: tiered ~10×, leveled ~30–50×.

### Why this matters for SSDs

SSDs have finite write endurance (typically 1000–10000 writes per cell). Write amplification × storage capacity = wear. A 1 TB SSD with 256× write amplification reaches its endurance limit after writing 4 TB of user data — months on a busy database. Engines explicitly tune for low write amplification on SSDs (smaller pages, larger leaves to amortize, batched writes).

---

<a name="in-memory"></a>
## 7. In-Memory Alternatives: ART and HOT

When the dataset fits entirely in RAM, the B+ tree's disk-optimized design becomes overhead. Two modern alternatives have come to dominate in-memory indexes.

### ART — Adaptive Radix Trees (Leis et al. 2013)

The ART (Adaptive Radix Tree) is a radix tree where each node's fanout adapts to the actual key density. Four node types: ART4, ART16, ART48, ART256, with capacity 4, 16, 48, 256 children respectively. A sparse node uses the small variant; a dense node grows to ART256.

**Why ART wins in memory:**
- No comparisons during traversal — each step is an array lookup by byte.
- Cache-friendly: ART4 fits in one cache line; ART16 in two; ART48 uses a 256-byte child-index lookup table.
- Memory-efficient compared to standard tries — adaptive node size avoids the "256 NULL children per node" trap.
- Lock-free variants (ROART) exist for concurrent workloads.

Used in: HyPer (MIT), Umbra, DuckDB (since 0.6), some in-memory analytical engines.

ART does **not** support efficient range queries the way B+ trees do — radix trees lack sibling links by default. Production ART implementations add explicit ordered iteration support.

### HOT — Height-Optimized Trie (Binnig et al. 2018)

HOT extends ART with explicit ordered iteration and lower memory overhead. Each node holds a bitmap describing which keys pass through it; traversal uses SIMD instructions for parallel comparison. Achieves ART's lookup speed while supporting B+ tree-style range scans.

Used in: research systems (TUM HyPer), some specialized in-memory engines.

### When to use B+ tree vs ART vs HOT

| Workload | Best |
|---|---|
| Disk-resident, range-heavy | B+ tree (always) |
| In-memory, exact-match heavy | Hash table |
| In-memory, range-heavy, integer/short keys | ART or HOT |
| In-memory, mixed, complex keys | B+ tree (still) |
| In-memory, lock-free required | Bw-tree, ART variants |

For most production OLTP, the simpler answer remains "B+ tree" because the I/O cost of disk pages dominates any in-memory micro-architectural savings.

---

<a name="hardware"></a>
## 8. Hardware-Conscious Leaf Sizing

Page size is the single most important tunable parameter of a B+ tree. Hardware capabilities have shifted dramatically over decades:

| Hardware era | Page size | Why |
|---|---|---|
| 1970s mainframe disk | 512 B – 4 KB | Disk sector size; minimize block waste |
| 1990s spinning disk | 8 KB | Seek-dominated; larger pages amortize seeks |
| 2000s RAID HDD | 8–16 KB | Stripe alignment, controller cache |
| 2010s SATA SSD | 16 KB | Match flash erase block (sub-)units |
| 2020s NVMe SSD | 32–128 KB | High throughput; amortize software overhead |
| 2030s persistent memory | 256 B – 4 KB | Byte-addressable; fine-grained writes acceptable |

### Why bigger pages don't always win

A bigger leaf:
- Higher fanout → shallower tree (good).
- More work per modification (rewrite full leaf) → write amplification (bad).
- Better sequential scan (good).
- Larger in-memory cache eviction granularity (worse hit rate for random workloads).

For NVMe with very high read throughput but limited write endurance, the sweet spot for production is typically 8–16 KB despite the device's capability.

### NVMe-specific considerations

- **Write granularity**: 4 KB read but 16 KB write (typical). Don't waste IOPS by writing smaller-than-4-KB.
- **Parallelism**: NVMe queues support 64K commands. Issue many concurrent reads — B+ tree range scans can prefetch leaves asynchronously.
- **Atomic write size**: 4 KB is atomic on most NVMe; larger may tear. Page size = 4 KB minimizes WAL FPW need.

### Persistent memory (Intel Optane PMem, NVDIMMs)

PMem is byte-addressable and durable. B+ tree designs for PMem (FAST&FAIR, Wort, NV-Tree) maintain durability via cache-line-granularity flushes (`CLWB`) rather than full page writes. This changes the calculus completely: page size becomes more like cache line size (64 B), and the design space shifts toward "B-tree with persistent links" rather than "page-oriented B+ tree".

Intel discontinued Optane in 2022; CXL-attached memory is the current contender.

---

<a name="distributed"></a>
## 9. FoundationDB and Modern Distributed B+ Trees

Distributed B+ trees span multiple machines. The major design choice: where do internal nodes live, and how do routing keys reach clients?

### FoundationDB

FoundationDB uses a **shared-nothing distributed B+ tree** where keys are partitioned across nodes (storage servers) by key range. The "tree" is implicit: a routing layer (the **proxy** + **resolver** layers) directs reads and writes to the correct storage server. Each storage server runs a local B+ tree (or LSM, depending on engine).

Range queries that span multiple shards are coordinated by the client driver, which fans out reads in parallel and aggregates results.

### CockroachDB / Spanner

Similar architecture: ranges of keys are leased to specific nodes. Range splits, merges, and rebalances happen at the cluster level. Within a range, each replica maintains its own B+ tree (Pebble for CockroachDB, an internal store for Spanner).

### Why this isn't quite a "distributed B+ tree"

Strictly, these systems are **distributed sorted maps** built atop per-node B+ trees, not a single distributed B+ tree. The tree-shaped routing structure (the "tree of ranges") is metadata, not an index structure with the usual B+ tree invariants.

Truly distributed B+ trees — where individual tree levels or nodes span multiple machines — exist mostly in research. They struggle with the latency of cross-node pointer chases. The shard-then-local-tree pattern is the dominant production design.

### Consensus and B+ trees

Replicating a B+ tree across multiple nodes (for HA) requires replicated state machines: Raft (etcd uses bbolt + Raft), Paxos. The B+ tree state is treated as opaque "current state of replicated state machine"; the protocol replicates either log entries (Raft) or page deltas. CoW B+ trees pair particularly well with Raft because the immutable snapshot can be checkpointed and shipped to a follower wholesale.

---

## Cheat Sheet — Modern Design Choices

```
Concern                          Modern answer
-------                          --------------
Variable-length records          Slot directory (offsets at start, payloads at end)
Tight fanout                     Prefix compression in leaves, suffix truncation in internals
High concurrency on disk         Lehman-Yao right-links + optimistic latch coupling
High concurrency in memory       Bw-tree, OLC, ART/HOT
Crash safety, simple             Copy-on-write
Crash safety, high write thrpt   WAL with FPW or doublewrite + delta records
Snapshot isolation               CoW (LMDB), MVCC chains (InnoDB undo, WT version chains)
Low write amplification          Bε-tree / fractal tree
Sub-microsecond in-memory        ART or HOT (not B+ tree)
Persistent memory                Cache-line-granular durability with CLWB
Distributed                      Shard by key range, run local B+ tree per shard
```

---

## Further Reading

- **Leis, V., Kemper, A., Neumann, T.** (2013). *The Adaptive Radix Tree: ARTful Indexing for Main-Memory Databases*. ICDE. Read alongside Binnig et al. 2018 for HOT.
- **Binnig, C., Hildenbrand, S., Färber, F.** (2018). *HOT: A Height Optimized Trie Index for Main-Memory Database Systems*. SIGMOD.
- **Levandoski, J. J., Lomet, D. B., Sengupta, S.** (2013). *The Bw-Tree*. ICDE.
- **Bender, M. A. et al.** (2007). *An Introduction to Bε-Trees and Write-Optimization*. The Bε-tree paper.
- **Cha, S. K. et al.** (2001). *Cache-conscious concurrency control of main-memory indexes on shared-memory multiprocessor systems*. VLDB. The OLFIT paper.
- **Wang, Z. et al.** (2018). *Building a Bw-Tree Takes More Than Just Buzz Words*. SIGMOD. Practical guide to implementing one.
- **Wu, X. et al.** (2017). *NoveLSM: A Nonvolatile, Single-Level Write-Optimized Key-Value Store*. ATC. Hardware-conscious storage.
- **PostgreSQL src/backend/access/nbtree/** — the reference implementation. Read the README first.
- Continue with `interview.md` for problems that exercise these techniques.
