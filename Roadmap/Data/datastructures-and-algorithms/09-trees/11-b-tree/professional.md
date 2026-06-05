# B-Tree — Professional Level

> **Audience:** Engineers building storage engines, query optimizers, or high-throughput indexed systems. Prerequisite: `senior.md`.

This document is concerned with what happens after you have already implemented a correct B-tree and now you need it to be **fast**: cache-conscious node layout, vectorized scanning inside a node, the buffer-managed vs mmap'd trade-off, the LSM-tree alternative, adaptive radix trees as hot-page replacements, write-ahead logging interaction, **index-organized tables**, and notes on modern storage engines.

---

## 1. Cache-Conscious Node Layout

The B-tree's headline win comes from packing many keys per page. Inside that page, the secondary win comes from packing many keys per **CPU cache line**.

### The numbers

Modern x86-64 CPUs use 64-byte cache lines. A 4 KB page holds 64 cache lines. If a node has 256 8-byte keys, that's 2 KB of key data — 32 cache lines just for keys, plus another 32 for child pointers if you store them adjacently. A linear scan touches each cache line once; a binary search touches log₂(256) = 8, but at *unpredictable* offsets — each comparison is a cache miss until the page is fully warm.

### Structure-of-arrays vs array-of-structs

```
// AoS (naive):
struct Entry { uint64_t key; uint64_t child_ptr; };
struct Node { Entry entries[2 * T - 1]; uint16_t n; bool leaf; };

// SoA (cache-friendly):
struct Node {
    uint64_t keys[2 * T - 1];
    uint64_t children[2 * T];
    uint16_t n;
    bool leaf;
};
```

Binary-searching the SoA version touches only the `keys` array — half the cache lines. The children are not pulled in until you have decided which subtree to enter. **2× speedup on a hot in-memory B-tree** is typical for this change alone.

### "Eytzinger" layout for in-RAM search trees

For purely in-memory B-trees that never spill to disk, Khuong & Morin (2017, "Array Layouts for Comparison-Based Searching") showed that an **Eytzinger / level-order layout** — store the implicit binary tree of a sorted array breadth-first — gives 2-4× faster lookups than std::lower_bound due to perfect cache prefetcher prediction. The idea generalizes to B-trees: instead of storing children by pointer, store the whole subtree's keys in a contiguous level-order block. This is what **Algolia's `instantsearch`** uses for autocompletion indexes; what **Roaring Bitmaps** uses internally; and what some modern OLAP engines use for their dictionary indexes.

### Slotted page layout (the database convention)

Real database pages are not homogeneous arrays. They use a **slotted page** layout:

```
+--------------------------------------------------+
| header (page LSN, flags, checksum)               |
+----+----+----+--------------------------+--------+
| s0 | s1 | s2 | ...        free space   | k2|k1|k0|
+----+----+----+--------------------------+--------+
   ^    ^    ^                              ^  ^  ^
   |    |    +-- offset of key 2 (variable) +--+--+-- keys grow right-to-left
   |    +-- offset of key 1 (variable size)
   +-- offset of key 0
```

Slot pointers grow from the start of the page; variable-length records grow from the end. Inserting and deleting only rewrites the slot directory and the affected record; no global shift. Used by PostgreSQL, InnoDB, SQL Server, Oracle, SQLite, BerkeleyDB — every production B-tree.

---

## 2. SIMD Scanning Within a Node

For nodes with hundreds of keys, **binary search has 8 cache misses but ~8 comparisons**. **Linear search with SIMD has 0 cache misses (sequential prefetcher loves it) and ~256/16 = 16 SIMD comparisons** that retire 4 per cycle. On modern hardware, linear SIMD search **beats binary search up to ~512 keys per node**.

Polychroniou, Raghavan & Ross (2015, "Rethinking SIMD Vectorization for In-Memory Databases") showed AVX2 / AVX-512 scans of sorted 32-bit keys at 30+ GB/s. The same technique is used in:

- **DuckDB**'s `lower_bound` for sorted columns.
- **ClickHouse**'s skip indexes and dictionary lookups.
- **VictoriaMetrics**'s index scan.
- **Apache Arrow**'s vectorized kernel set.

Pseudocode (AVX2, 8x 32-bit keys at a time):
```c
__m256i vtarget = _mm256_set1_epi32(target);
for (int i = 0; i < n; i += 8) {
    __m256i v = _mm256_loadu_si256((__m256i*)(keys + i));
    __m256i cmp = _mm256_cmpgt_epi32(v, vtarget);
    uint32_t mask = _mm256_movemask_epi8(cmp);
    if (mask) {
        // first set bit's byte index / 4 is the relative key offset
        return i + (__builtin_ctz(mask) >> 2);
    }
}
return n;
```

For variable-length keys (strings), you typically use a **fixed-prefix array** in the node header and only fall through to the full key on prefix tie.

---

## 3. Buffer-Managed vs mmap'd B-Trees

There are two schools for relating B-tree pages to disk pages:

### Buffer-managed (PostgreSQL, InnoDB, SQL Server, Oracle, BerkeleyDB)

The engine maintains its own **buffer pool** of fixed-size frames. Page reads go through a hash table from page-id to frame; cache replacement is LRU-2 or clock-with-frequency. The engine fully controls eviction and write-back.

**Pros:**
- Predictable eviction policy tuned to database access patterns.
- Can be larger than RAM via spilling (rarely done).
- Direct I/O (`O_DIRECT`) bypasses double-caching.
- Easy to instrument: cache hit rates, dirty-page counts, etc.

**Cons:**
- ~5,000 lines of complex C++ buffer manager code.
- Doubles memory if buffered I/O is used (OS page cache + buffer pool).

### mmap'd (LMDB, bbolt, GreenplumDB's append-only tables historically)

The whole file is mmap'd. Page reads are pointer dereferences; the kernel handles paging via the OS page cache. No buffer pool code.

**Pros:**
- Tiny code (LMDB is 6,000 lines total, including everything).
- Zero-copy reads — the index page in the OS cache *is* the buffer.
- No double caching.

**Cons:**
- No control over eviction policy.
- Page faults can stall threads unpredictably; tail latencies can spike.
- TLB pressure on huge databases (mitigated by huge pages).
- Andy Pavlo's *"Are You Sure You Want to Use MMAP in Your Database Management System?"* (CIDR 2022) is a famous broadside arguing mmap is incompatible with serious crash safety and concurrency for general-purpose DBMSes. LMDB / bbolt sidestep most of his arguments via single-writer CoW design.

### When to pick which

- **Single-writer, mostly-read, low operational complexity:** mmap. LMDB and bbolt have proven this at scale (etcd, Monero).
- **Many concurrent writers, online schema changes, write-ahead logging, partial recovery:** buffer pool. PostgreSQL and InnoDB are the canonical examples.

---

## 4. LSM Trees vs B-Trees

The LSM (Log-Structured Merge) tree, popularized by Google's Bigtable (2006) and incarnated in **LevelDB / RocksDB / Cassandra / HBase / ScyllaDB / Apache Pinot**, is the B-tree's main rival for write-heavy workloads. The contrast:

|  | B-tree | LSM tree |
|---|---|---|
| **Write path** | random in-place updates to leaf pages | append-only sorted run; flush MemTable to immutable SSTable |
| **Read path** | one traversal, ~1 leaf read | check MemTable, then check each level's SSTable (until found) → **read amplification** |
| **Space** | ~70% leaf utilization | many copies of the same key across levels until compaction |
| **Compaction** | none required | continuous background merge across levels — high write amplification |
| **Range scan** | sequential leaf walk | merge-iterate across MemTable + each level |
| **Best for** | mixed read/write, smaller datasets, OLTP | write-heavy, append-mostly, time-series, log ingestion |

### The compaction trade-off

LSM trees buffer writes in memory and write whole sorted SSTables in batches. Background **compaction** merges levels, removing duplicates. The cost: each key may be rewritten 10-20 times on its journey from level 0 to the bottom — **write amplification** of 10x is common. The benefit: writes are sequential I/O, ~30x faster on HDD and 5-10x faster on SSD vs random B-tree writes.

### Read amplification trade-off

A read in an LSM may need to consult every level until it finds the key (or a tombstone). Bloom filters per SSTable cut this to ~1 random read in expectation. Still slower than a B-tree's single traversal.

### The hybrid: WiredTiger

MongoDB's default engine offers **both** modes per collection. B-tree by default; LSM available for ingest-heavy collections. Most users stick with B-tree.

### Compaction strategies

- **Tiered (Cassandra default):** group N similar-sized SSTables into one larger SSTable. Lower write amp, higher space amp.
- **Leveled (RocksDB/LevelDB default):** each level is N× larger than the previous; compaction merges from one level to the next. Higher write amp, lower space amp.
- **Universal (RocksDB):** combines both.
- **Tiered + Leveled (FoundationDB, ScyllaDB):** different policies at different levels.

The classic LSM analysis paper is **Sears & Ramakrishnan (2012), "bLSM: A General Purpose Log Structured Merge Tree"**. Modern surveys: Luo & Carey (2020), "LSM-based Storage Techniques: A Survey".

---

## 5. WiredTiger's Leaf Split Policy

WiredTiger (MongoDB's default engine) makes a non-obvious design choice: **leaves split at insert time, internal nodes do not split synchronously**. Internal nodes accumulate "pending" inserts in their in-memory image; at the next eviction, they reconcile into multiple smaller on-disk pages.

This decouples the synchronous insert path (only touches a leaf and updates its in-memory image) from the asynchronous reconciliation (rebuilds parent representations during eviction). Throughput goes up; tail latency on inserts goes down. The trade-off is more memory used for in-memory page images and more CPU during reconciliation.

The full design is documented at `https://source.wiredtiger.com/develop/arch-index.html`.

---

## 6. Adaptive Radix Trees as Hot-Page Replacements

For pages or sub-indexes that are entirely in-memory and constantly hit, a B-tree may not be the right shape. The **Adaptive Radix Tree** (ART) of Leis, Kemper & Neumann (ICDE 2013, "The Adaptive Radix Tree: ARTful Indexing for Main-Memory Databases") provides:

- O(k) lookup where k is key length in bytes (not log n).
- 4-way / 16-way / 48-way / 256-way nodes that switch type as they fill up — keeping memory low for sparse subtrees.
- Prefix compression so common key prefixes are stored once.

Performance: ART beats a tuned in-memory B-tree by ~2x on uniform integer keys, ~5x on string keys with shared prefixes. Used by **HyPer**, **DuckDB**, **CedarDB**, **Umbra**.

For systems that need persistence, **persistent ART** variants exist but are less common than B+ trees because ART's lookups are not as cache-friendly when the tree spills to disk (each node is just one cache line, not a full page).

---

## 7. Write-Ahead Logging Interaction

A B-tree modification cannot be "atomic on disk" — splitting a node requires writing two pages, updating the parent, and possibly cascading upward. If a crash occurs mid-split, the on-disk tree is left inconsistent.

The standard fix is **write-ahead logging (WAL)**. Before any page modification:

1. Construct a log record describing the change (typically: redo info = new page content; undo info = old page content).
2. Force the log record to durable storage (fsync).
3. Then modify the page in the buffer pool. The dirty page is flushed lazily.

After a crash, recovery:
- **Redo:** Replay all log records since the last checkpoint to bring pages forward.
- **Undo:** Roll back any uncommitted transactions.

The reference recovery algorithm is **ARIES** (Mohan et al., 1992, "ARIES: A Transaction Recovery Method Supporting Fine-Granularity Locking and Partial Rollbacks Using Write-Ahead Logging"). InnoDB, SQL Server, Oracle, and DB2 all implement ARIES or variants. PostgreSQL uses a simpler scheme based on full-page writes after each checkpoint.

### Log record per B-tree operation

A B-tree insert generates 1–4 log records:
- INSERT-KEY-IN-LEAF (1 record).
- SPLIT-LEAF (1 record describing both the new sibling and the parent update).
- ...possibly cascading up.

Compaction tip: many engines log only the *difference* (the new key and the split point) rather than the full new page content, saving WAL bandwidth.

### CoW trees: no log

Copy-on-write B-trees skip WAL entirely. The atomic root pointer swap *is* the commit. This is why bbolt and LMDB are dramatically simpler than InnoDB. Trade-off: every commit costs writing the whole modified path (~log n pages).

---

## 8. Index-Organized Tables (Clustered Indexes)

When the B+ tree leaf contains the **full row data**, not a row pointer, the table is called an **Index-Organized Table** (Oracle) or **clustered index** (Microsoft/MySQL).

### Benefits

- **One I/O for the entire row** on a primary-key lookup. A heap-based table needs index lookup + heap fetch.
- **Range scans on the primary key are sequential** on disk because rows are physically ordered by PK.
- **Secondary index entries are smaller** because they don't carry full TIDs — they carry the PK (which for InnoDB doubles as the row's "location").

### Costs

- **Secondary index lookup is two B+ tree traversals**: one for PK, one for row.
- **PK update is expensive**: the row physically moves to its new location in the clustered index, and every secondary index pointing at that PK must be invalidated and rewritten.
- **Large variable-length rows distort fanout**: a clustered B+ tree page that contains a 4 KB BLOB inline holds far fewer rows. InnoDB pushes such columns to overflow pages and stores only a pointer in the leaf.

### Who uses what

| Engine | Default |
|---|---|
| InnoDB | Always clustered on PK |
| Oracle | Heap by default; IOT optional |
| SQL Server | Heap by default; clustered if explicit |
| PostgreSQL | Always heap; no clustered indexes |
| SQLite | Always clustered on ROWID |

PostgreSQL's CLUSTER command is a one-time physical reordering, *not* a maintained clustered index — order degrades immediately on subsequent inserts.

---

## 9. Modern Storage Engines (a Selective Survey)

### FoundationDB

Distributed key-value store; Apple acquired & open-sourced (2018). Storage engine is **RocksDB-backed** (LSM), but its transaction layer is a B-tree-like Merkle tree over keys for verification and conflict detection.

### Aerospike

Real-time KV store. Two-layer architecture: **in-memory primary index is a red-black tree** (= 2-3-4 B-tree), per-node sharded; on-disk records sit in append-only "stripes" with the in-memory index pointing into them.

### ClickHouse

Column-store OLAP. Each table is sorted by its **primary key**, but the "index" is a sparse **skip index** — one entry per data granule (typically 8192 rows). Not a true B-tree. Each granule is found via binary search of this sparse array.

### CockroachDB / TiDB / YugabyteDB

Distributed SQL. Each range is stored as RocksDB (LSM) on each node. The "B-tree" character lives at the SQL-engine layer in the form of secondary indexes, also stored in RocksDB.

### Umbra / HyPer

Academic in-memory databases. ART for primary indexes. B-tree for some secondary indexes when range scans dominate.

### BumbleDB

Specialized B-tree variants for hybrid memory/storage hierarchies — research projects out of CMU's database group focusing on persistent memory (PMEM / Optane).

### Velox / DuckDB

Embedded OLAP. DuckDB uses ART for hash joins and a **B+ tree per table** for primary key indexes; column data stored in compressed segments separate from the index.

---

## 10. Tail-Latency and Operational Tips

- **Checkpoint pacing.** A naive engine forces all dirty pages at checkpoint time, spiking write latency. Modern engines (PostgreSQL `checkpoint_completion_target`, InnoDB `innodb_io_capacity`) spread the writes across the checkpoint interval.
- **Buffer pool warm-up.** Cold cache lookups can be 1000x slower than warm. PostgreSQL has `pg_prewarm`; InnoDB serializes the buffer pool to disk for fast restart.
- **Read-ahead.** Sequential scans should trigger prefetch of the next several leaf pages; almost all engines do this via the OS readahead mechanism + their own scan-detection heuristic.
- **Auto-vacuum tuning.** PostgreSQL's autovacuum doesn't reorganize B-tree pages; rebuild periodically with `REINDEX CONCURRENTLY` on hot tables.
- **Index bloat measurement.** Use `pgstattuple` (PostgreSQL) or `SHOW TABLE STATUS` (InnoDB) to see the fill ratio. Below 50% means a rebuild will help.
- **Compression.** InnoDB row-format COMPRESSED applies per-page zlib; halves disk space but doubles CPU. PostgreSQL TOAST compresses individual oversized columns.

---

## Reading list

- **Petrov, A.** *Database Internals*, Part I (storage), 2019. The current best single source.
- **Hellerstein, J. M., Stonebraker, M., & Hamilton, J.** (2007). *Architecture of a Database System.* The reference architecture.
- **Mohan, C., et al.** (1992). *ARIES: A Transaction Recovery Method...* The WAL design paper.
- **Leis, V., Kemper, A., & Neumann, T.** (2013). *The Adaptive Radix Tree: ARTful Indexing for Main-Memory Databases.* ICDE.
- **Polychroniou, O., Raghavan, A., & Ross, K. A.** (2015). *Rethinking SIMD Vectorization for In-Memory Databases.* SIGMOD.
- **Khuong, P.-V., & Morin, P.** (2017). *Array Layouts for Comparison-Based Searching.* JEA.
- **Pavlo, A., et al.** (2022). *Are You Sure You Want to Use MMAP in Your Database Management System?* CIDR. The mmap critique.
- **Sears, R., & Ramakrishnan, R.** (2012). *bLSM: A General Purpose Log Structured Merge Tree.* SIGMOD.
- **Luo, C., & Carey, M. J.** (2020). *LSM-based Storage Techniques: A Survey.* VLDB Journal.
- **Graefe, G.** (2011). *Modern B-Tree Techniques.* Foundations and Trends in Databases 3(4). 200 pages of optimizations from 1970 to now.
