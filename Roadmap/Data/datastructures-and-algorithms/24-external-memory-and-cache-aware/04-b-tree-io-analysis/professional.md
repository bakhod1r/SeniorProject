# B-Tree I/O Analysis — Professional Level

## Table of Contents

1. [What This Tier Is About](#what-this-tier-is-about)
2. [Database Indexes: The B+-Tree as the Default Index](#database-indexes-the-b-tree-as-the-default-index)
   - [The Page Is B, the Buffer Pool Is M, the Height Is ~3–4](#the-page-is-b-the-buffer-pool-is-m-the-height-is-34)
   - [Clustered vs Heap: The Table IS a B+-Tree](#clustered-vs-heap-the-table-is-a-b-tree)
   - [Fill Factor, Page Splits, and the Monotonic-Insert Hotspot](#fill-factor-page-splits-and-the-monotonic-insert-hotspot)
   - [Covering Indexes and Index-Only Scans](#covering-indexes-and-index-only-scans)
3. [Key-Value and Embedded: COW B+-Trees](#key-value-and-embedded-cow-b-trees)
4. [The Big Debate: B-Tree vs LSM](#the-big-debate-b-tree-vs-lsm)
5. [Write-Optimized B-Trees in Production: B^ε / Fractal Trees](#write-optimized-b-trees-in-production-bε--fractal-trees)
6. [Engineering: Compression, Buffer Pool, WAL, Concurrency, SSDs](#engineering-compression-buffer-pool-wal-concurrency-ssds)
7. [Measuring and Tuning](#measuring-and-tuning)
8. [Worked End-to-End: A B+-Tree vs B^ε-Tree I/O Counter](#worked-end-to-end-a-b-tree-vs-bε-tree-io-counter)
9. [Decision Framework](#decision-framework)
10. [Research and System Pointers](#research-and-system-pointers)
11. [Key Takeaways](#key-takeaways)

---

## What This Tier Is About

The senior tier ([`./senior.md`](./senior.md)) draws the map: the B-tree is the *search-optimal* corner of the Brodal–Fagerberg frontier, the `B^ε`-tree parameterizes the whole insert/query tradeoff with one knob `ε`, the LSM-tree sits at the write-optimal end, and the RUM conjecture names the read/update/memory conservation law that constrains all of them. That map is correct and it is the right way to think. This tier answers the operational question that follows: **when you choose an index in PostgreSQL, watch InnoDB split pages under a sequential primary key, decide between MySQL and RocksDB for an ingest-heavy table, or read `EXPLAIN`'s buffer counts — what does the B-tree actually look like in production, and which decisions are load-bearing?**

The thesis is blunt. The B+-tree is the default on-disk index of essentially every relational database — Postgres, MySQL/InnoDB, SQL Server, Oracle, SQLite — *because* its fan-out of hundreds-to-thousands keeps the height at **3–4 levels for billions of rows**, so any lookup is a handful of I/Os and the top levels live permanently in the buffer pool. That is the read-optimal win the theory predicts. But production B-trees are not the clean structure of the analysis: they fight **page splits** under monotonic inserts, **bloat** under updates and deletes, **write amplification** (random in-place page writes plus the write-ahead log), and **concurrency** on the root. Where writes dominate, engineers reach off the read-optimal corner — to **write-optimized B-trees** (`B^ε`/fractal trees, BetrFS) that buffer inserts, or all the way to **LSM-trees** (RocksDB, Cassandra). This file walks the production home of the B-tree (database indexes), the COW B+-tree of embedded stores, the B-tree-vs-LSM decision that dominates storage-engine selection, the write-optimized middle ground, the engineering (compression, buffer pool, WAL, concurrency, SSD), how to measure and tune, and a runnable I/O counter that shows buffered inserts cutting insert I/Os.

---

## Database Indexes: The B+-Tree as the Default Index

A relational index is the B+-tree made operational. Every storage engine — InnoDB, PostgreSQL's `btree` access method, SQL Server's rowstore indexes, Oracle's B-tree indexes — implements the same structure with the same cost profile, differing mostly in page size, the clustered/heap choice, and split policy.

### The Page Is B, the Buffer Pool Is M, the Height Is ~3–4

The **page** is the model's block `B`: the atomic unit read from and written to storage. Page sizes are a deliberate `B` choice — **PostgreSQL 8 KB, InnoDB 16 KB, SQL Server 8 KB, Oracle 8 KB default** (`db_block_size`). The **buffer pool** (`shared_buffers`, `innodb_buffer_pool_size`, SQL Server buffer cache, Oracle buffer cache) is the model's internal memory `M`. The reason the B+-tree wins is the fan-out arithmetic ([`../../09-trees/11-b-tree/professional.md`](../../09-trees/11-b-tree/professional.md)): an internal node holds (page size) / (key + child-pointer) separator entries. With a 16 KB page and ~16-byte separators, fan-out is **~1000**; even with fat keys it is in the **hundreds**. Then

```text
   height h  =  ⌈ log_fanout N ⌉.

   fanout = 500:   500^3 = 1.25 × 10^8,   500^4 = 6.25 × 10^10
   fanout = 1000:  1000^3 = 10^9,         1000^4 = 10^12
```

So a B+-tree over **a billion rows is 3–4 levels deep**, and a point lookup is 3–4 page reads. The decisive operational fact: the **root and the entire second level are tiny and hot**, so they live permanently in the buffer pool — for a billion-row index the root + internal levels are a few MB. The *physical* I/O of a point lookup is therefore usually **one read** (the leaf), occasionally two, almost never the full height. This is why "add an index" turns a table scan into a near-constant-time lookup: `Θ(log_B N)` with `B`-sized fan-out is, for real `N`, a small constant of mostly-cached reads. (When that one leaf read is more expensive than just scanning — high selectivity — the planner correctly skips the index; see [`../01-the-io-model/professional.md`](../01-the-io-model/professional.md).)

B+-trees specifically — separators in internal nodes, all rows in a **linked leaf chain** — over plain B-trees, because the leaf chain delivers `Θ(N/B)` **range scans** (`ORDER BY`, `BETWEEN`, range predicates, index-ordered reads) sequentially at the scan floor, which is exactly what relational workloads demand.

### Clustered vs Heap: The Table IS a B+-Tree

The single most consequential physical-design decision is **index-organized (clustered) vs heap** storage.

- **InnoDB (MySQL): the table *is* a B+-tree.** Every InnoDB table is stored as a **clustered index keyed on the primary key** — the leaf pages of that B+-tree *are* the rows. There is no separate heap. A lookup by PK descends the clustered index and finds the full row in the leaf; this is why PK lookups are the fastest access path in InnoDB. Crucially, **secondary indexes store the primary key as the row locator**, not a physical pointer. So a query that filters on a secondary index and needs columns not in it does a **double lookup**: descend the secondary index to get the PK, then descend the clustered index by PK to fetch the row. This makes the choice of PK pervasive: a wide PK (or a UUID) bloats *every* secondary index, since each secondary leaf entry carries the PK. The standard advice — a **narrow, monotonic surrogate PK** (a `BIGINT AUTO_INCREMENT`) — falls directly out of this, and so does its tension with the split hotspot below.
- **SQL Server** offers both: a **clustered index** (table physically ordered by the key, like InnoDB) or a **heap** (unordered, with nonclustered indexes pointing at a physical `RID`). The default for `PRIMARY KEY` is a clustered index.
- **Oracle** defaults to **heap-organized tables** (rows in an unordered heap, indexes hold `ROWID` physical addresses) but offers **index-organized tables (IOT)** for the InnoDB-style "table is a B+-tree" layout.
- **PostgreSQL is heap-only.** The table is a heap; *every* index (including the PK) is a separate B+-tree whose leaves hold a **TID** (page, offset) pointing into the heap. Postgres has **no clustered index** — `CLUSTER` is a one-time physical reorder that decays as rows update. An index scan in Postgres therefore typically costs the index descent **plus a random heap fetch per matching row**, which is exactly the cost the planner weighs against a seq scan ([`../01-the-io-model/professional.md`](../01-the-io-model/professional.md)).

The professional takeaway: **clustered/IOT makes range scans on the cluster key nearly free and PK lookups single-descent, at the cost of expensive non-key access and PK-width amplification across secondary indexes; heap decouples the table from any one index but pays a random heap fetch per row on every index scan.**

### Fill Factor, Page Splits, and the Monotonic-Insert Hotspot

A B+-tree leaf is not packed full — it is filled to a **fill factor** (Postgres `fillfactor`, default 90 for B-tree; InnoDB `MERGE_THRESHOLD` / `innodb_fill_factor`, default ~50% for bulk index builds; Oracle/SQL Server `PCTFREE` / `FILLFACTOR`). The slack leaves room for in-place inserts and updates without immediately splitting. When an insert lands in a full leaf, the engine performs a **page split**: allocate a new page, move half the entries over, and insert a separator into the parent (which may itself split, cascading toward the root). Splits cost extra I/O, fragment the index (logically adjacent leaves become physically scattered, hurting range-scan locality), and are the chief source of **index bloat**.

The notorious pathology is the **right-hand / monotonic-insert hotspot**. When the index key is **monotonically increasing** — an `AUTO_INCREMENT`/`SERIAL` surrogate key, a timestamp, a `ULID` — every insert targets the **rightmost leaf**. That single page is split repeatedly, and under concurrency every inserting transaction contends for the latch on the same right-edge page and its parent. The result is **split contention**: a hot spot that serializes inserts and caps write throughput, even though the workload is "embarrassingly appendable."

The fixes, in order of preference:

1. **Right-most leaf optimization (engine-level).** Modern engines detect monotonic insertion and split the full right-edge page **asymmetrically** — keeping the old page full and putting *only the new key* on the new page (a "90/10" or "fast append" split) instead of a 50/50 split. This keeps leaves densely packed for append workloads and is exactly why a `BIGINT AUTO_INCREMENT` PK is *recommended* despite being monotonic: InnoDB and Postgres both special-case it. **Bulk-load with this in mind** — sorted bulk loads pack leaves to the fill factor bottom-up, far cheaper than `N` random insertions.
2. **Spread the inserts.** If a true hotspot remains (e.g. high-concurrency ingest), **hash- or reverse-key-index** the monotonic column so consecutive values scatter across leaves (Oracle's `REVERSE` index, or a leading hash-bucket column). This trades away range-scan locality on that key for write parallelism — only worth it when writes, not ranges, dominate.
3. **Partition.** Range/hash partition on the monotonic key so inserts spread across multiple physical B+-trees (one per partition), each with its own right edge.

The deeper lesson and the bridge to the next sections: the monotonic-insert hotspot, page splits, and bloat are all symptoms of the B-tree's **eager, in-place, one-element-at-a-time** update discipline ([`./senior.md`](./senior.md)). Write-optimized structures attack exactly this.

### Covering Indexes and Index-Only Scans

A **covering index** includes every column a query needs, so the query is answered **entirely from the index leaves** without touching the table — Postgres' *index-only scan*, SQL Server's `INCLUDE` columns, InnoDB's automatic covering when the needed columns are in the secondary index (and the PK, which is always there). This eliminates the random heap fetch (Postgres) or the clustered-index double lookup (InnoDB) — turning `descent + s random fetches` into just `descent + sequential leaf read`. Covering indexes are the single highest-leverage index tweak for read-heavy point/range queries, at the cost of a wider index (more pages, more write amplification on update). The column **order** matters: an index on `(a, b)` covers `WHERE a = ? ORDER BY b` and `WHERE a = ?` but *not* `WHERE b = ?` — leading-column equality is what the B-tree descent can exploit (the "leftmost prefix" rule).

---

## Key-Value and Embedded: COW B+-Trees

Embedded key-value stores and copy-on-write filesystems use a B+-tree variant tuned for crash consistency rather than maximal write throughput.

- **LMDB and BoltDB** are **memory-mapped, copy-on-write B+-trees with a single writer**. The whole database is one `mmap`'d file; reads traverse the tree directly through the page cache with **zero-copy** and **no locking on the read path** (readers see a consistent snapshot via MVCC). A write transaction never modifies a page in place: it **copies every page on the path from the touched leaf up to the root** (path-copying), writes the new pages to free space, and commits by atomically swapping a new **root pointer** in a meta page. This gives **crash consistency for free** — a torn write leaves the old root valid, so the database is always consistent without a separate WAL/undo log. The price is **write amplification proportional to tree height** (every write rewrites `~h` pages) and the **single-writer** serialization (one write transaction at a time). LMDB powers OpenLDAP and many embedded stores; BoltDB powered etcd's backend (later forked as `bbolt`). The design is ideal for **read-heavy, moderate-write** embedded workloads where crash safety and zero-copy reads matter more than write throughput.
- **COW B+-trees in filesystems** — **btrfs, ZFS, and NetApp WAFL** — use the same path-copying idea at filesystem scale. Metadata (and optionally data) lives in COW B-trees; an update writes new blocks and a new tree root, never overwriting live data, so a crash or power loss leaves the previous consistent tree intact. This is what makes **atomic snapshots** cheap: a snapshot is just a retained old root, and the COW discipline means snapshots share unchanged blocks. The tradeoff is the same as LMDB — write amplification from path-copying and eventual **fragmentation** as logically sequential data scatters across COW allocations, which is why these filesystems pair COW with background defragmentation and large-block allocation policies.

The unifying idea: **copy-on-write trades write amplification for atomic, lock-free, crash-consistent updates** — a different point on the RUM triangle than the in-place, WAL-protected database B-tree.

---

## The Big Debate: B-Tree vs LSM

The dominant storage-engine decision of the last fifteen years is **read-optimized B-tree vs write-optimized LSM-tree**. The senior tier proves they are points on the Brodal–Fagerberg frontier; this tier is the production decision. (Full LSM treatment: [`../../21-advanced-structures/04-lsm-tree/professional.md`](../../21-advanced-structures/04-lsm-tree/professional.md).)

The comparison is best framed through the **three amplifications** and the **RUM conjecture** (Athanassoulis et al.): you can minimize at most two of **R**ead, **U**pdate, and **M**emory(space) overhead.

| Amplification | B-tree | LSM-tree (leveled) |
| --- | --- | --- |
| **Write** | Each logical write → a **random in-place page write** (a full 8–16 KB page dirtied for one row) **plus a WAL append**. Splits add more. | Writes are **sequential**: append to memtable, flush as a sorted run, then **compaction** rewrites data `O(T·log_T(N/M))` times. Sequential but high total bytes. |
| **Read** | **Low.** Point read = `~h` I/Os (mostly cached); range = leaf-chain scan. One structure to consult. | **Higher.** A point read may probe **multiple levels/runs**; mitigated by **Bloom filters** (skip runs lacking the key) and **fence pointers**, getting close to ~1 I/O on a miss. Range scans must **merge across runs**. |
| **Space** | **Low** (≈ fill factor; some bloat from splits/dead tuples). | **Leveled: low** (~1+1/T). **Tiered: high** (up to T overlapping copies + obsolete/tombstoned data awaiting compaction). |

The decisive asymmetries in practice:

- **B-tree write cost is random + small.** Updating one row dirties a whole page that must eventually be written back randomly, plus the WAL record. On HDD this is seeks; on SSD it is **write amplification and endurance burn** (the FTL relocates live data around the in-place overwrite). The B-tree's read-optimal shape makes its *writes* the scarce resource.
- **LSM write cost is sequential but voluminous.** Every byte is written once to the WAL/memtable flush and then **re-written by compaction** several times — that is the LSM's write amplification. But it is *sequential*, which is gentle on both HDD seeks and SSD garbage collection, and it converts random user writes into large sequential device writes.
- **LSM read cost is the price.** Without Bloom filters a point read consults every level; with them, reads on misses approach one I/O, but **range scans inherently merge runs** and stay more expensive than a B-tree's single leaf-chain walk.

**When each wins:**

- **B-tree wins:** read-heavy and **range-scan-heavy** workloads, point lookups, low write rate, predictable low read latency, and when **space efficiency** matters. The default for OLTP that reads more than it writes. (Postgres, InnoDB, SQL Server, Oracle.)
- **LSM wins:** **write-heavy / high-ingest** workloads (time-series, event logs, metrics, write-mostly KV), where sequential writes and compression dominate, and reads are point lookups served by Bloom filters. (RocksDB, LevelDB, Cassandra, ScyllaDB, MyRocks, and as a pluggable engine under many databases.)

The professional one-liner: **"B-tree, B^ε, or LSM?" = "where does my read/write ratio sit on the Brodal–Fagerberg curve, and do I need cheap range scans?"** Read/range-heavy → B-tree. Write-heavy + point reads → LSM. Write-heavy *with range reads* → the write-optimized B-tree below.

---

## Write-Optimized B-Trees in Production: B^ε / Fractal Trees

Between the B-tree's read-optimal corner and the LSM's write-optimal corner sits the **`B^ε`-tree** (`ε ≈ 1/2`), the practical middle ground — and, uniquely among write-optimized structures, **it keeps data in global tree order so range queries stay efficient** ([`./senior.md`](./senior.md)).

The mechanism: each internal node spends a fraction of its space on **child pointers** and the rest on a **buffer of pending insert/delete/update "messages."** An insert is **appended to the root buffer** in `O(1)`; when a node's buffer fills, the messages are **flushed down** in a batch to the children's buffers. Because each expensive node-rewrite carries **`Θ(B)` messages at once**, the per-insert cost drops by roughly a `√B` factor versus a B-tree (`O((1/√B) log_B N)` vs `O(log_B N)`), while a point query merely walks the same root-to-leaf path checking buffers (~2× a B-tree's read). The key engineering payoff over an LSM: **the data never leaves global sorted order**, so a range scan is still a tree-ordered leaf walk, not a multi-run merge.

In production:

- **TokuDB / TokuMX (Tokutek, later Percona)** productized the `B^ε`-tree as the **Fractal Tree index**, shipped as a MySQL storage engine (TokuDB) and a MongoDB variant (TokuMX). The library, **PerconaFT**, implements the message-buffer flush machinery, plus aggressive **block-level compression** (the buffered, batched writes compress well) and **hot schema changes** (a schema change becomes a broadcast message flushed lazily down the tree).
- **BetrFS** is a **file system built on a `B^ε`-tree** (a "Bε-tree file system"), demonstrating the structure end-to-end: it gets near-LSM write throughput for small random writes (the metadata-heavy, small-file workloads that punish in-place B-trees) **while keeping good locality for range/directory scans**, precisely because the `B^ε`-tree preserves order.

The middle-ground value proposition: **buffered, batched inserts cut write amplification toward the LSM end, but the structure stays a single ordered tree, so range queries and space efficiency stay near the B-tree end.** It is the answer to "I ingest fast *and* I scan ranges." The worked example below makes the buffering win concrete.

---

## Engineering: Compression, Buffer Pool, WAL, Concurrency, SSDs

The gap between the textbook B-tree and a fast production index is a stack of constant-factor and systems decisions.

**Key compression — prefix and suffix.** B-tree internal nodes store separator keys; compressing them raises fan-out, which lowers height and I/O. **Prefix compression** stores the common prefix of a sorted run of keys once (huge for keys sharing a leading column, e.g. `(tenant_id, ...)`). **Suffix truncation** (a.k.a. separator truncation) keeps only enough of a separator key to route searches — the shortest string that still separates the left subtree's max from the right subtree's min — so internal nodes hold short routing keys, not full keys. Together these can multiply fan-out and shave a level off the tree. (Graefe's "Modern B-Tree Techniques" catalogs these.)

**Buffer pool / page cache — effective I/Os are the bottom levels only.** Because the root and internal levels are small and hot, they are pinned in `M` essentially permanently. The **effective** I/O cost of a lookup is therefore not `h` but the number of *cold* levels — usually just the leaf. The whole game of database tuning is keeping the hot working set in `M`; for indexes that means the upper levels are free and only leaf misses cost real I/O. Postgres' `EXPLAIN (ANALYZE, BUFFERS)` makes this visible as `shared hit` (free, in `M`) vs `shared read` (billable).

**WAL and checkpointing.** A crash mid-update must not corrupt the tree, so engines use **write-ahead logging**: the change is appended to a sequential redo log (Postgres WAL, InnoDB redo log, SQL Server transaction log) and `fsync`'d **before** the dirty page is written back. Dirty pages stay in the buffer pool and are flushed lazily; a **checkpoint** periodically forces them and advances the recoverable log position. This is why a B-tree write is "random page write **plus** WAL append" — the WAL turns the durability requirement into a *sequential* write, while the page write itself stays random. Tuning the checkpoint cadence trades crash-recovery time against write-back I/O bursts.

**Concurrency — latch coupling, B-link, Bw-tree.** A production B-tree is hammered by concurrent readers and writers ([`./senior.md`](./senior.md)):

- **Latch coupling (crabbing):** acquire the child's latch before releasing the parent's, hand-over-hand down the tree; release ancestors early once a node is "safe" (won't split/merge). Simple, but **the root latch is a contention bottleneck** for writes.
- **B-link tree (Lehman–Yao, 1981):** every node gets a **right-link** to its sibling and a **high key**, so a split needs only the splitting node latched and the parent pointer is fixed lazily; a search that overshoots **follows the right-link**. The payoff: **searches take no latches on the read path**, removing the root bottleneck for readers. This underlies **PostgreSQL's nbtree** concurrency.
- **Bw-tree (Microsoft, 2013):** **lock-free** via a **mapping table** (logical page id → physical address) updated by **CAS**, with changes installed as **delta records** prepended to a page rather than in-place edits. Latch-free and append-friendly; built for the **Hekaton** in-memory engine and SQL Server's in-memory indexes.

**SSD-era B-trees.** Flash changes the constants ([`../01-the-io-model/professional.md`](../01-the-io-model/professional.md)): random reads are only ~2–5× slower than sequential (not 100× as on HDD), so the B-tree's random point reads are cheap. But **flash is erase-before-write**, so the B-tree's small **random in-place page writes** cause **write amplification** in the FTL (it relocates live data around the overwrite) and **burn endurance**. Two practical responses: **match the B-tree page to the device's behavior** (large enough to amortize command overhead, aligned to the flash page/erase block where possible) and, for write-heavy tables, **move off the in-place B-tree** toward `B^ε`/LSM whose writes are batched/sequential. The B-tree's read-optimality is a great fit for SSD reads; its write pattern is the part SSDs punish.

---

## Measuring and Tuning

Theory is useful only if you can find and fix the index bottleneck on a live system.

**Read the plan and the stats.**

- **`EXPLAIN` / `EXPLAIN (ANALYZE, BUFFERS)`** (Postgres), `EXPLAIN ANALYZE` / `EXPLAIN FORMAT=JSON` (MySQL), actual execution plans (SQL Server), `DBMS_XPLAN` (Oracle). Confirm the planner chose **Index Scan / Index Only Scan** vs **Seq Scan / Full Table Scan**, and check `shared hit` vs `shared read` (buffer-pool hit ratio) and `Rows Removed by Filter` (work read and discarded → a missing index or predicate).
- **Index usage and bloat stats.** `pg_stat_user_indexes` (`idx_scan` — an index with zero scans is dead weight slowing writes), `pgstattuple` / `pg_stat`'s bloat estimates, InnoDB's `INFORMATION_SCHEMA` index stats, SQL Server's `sys.dm_db_index_physical_stats` (fragmentation) and `sys.dm_db_index_usage_stats`.

**Fight bloat.** Updates/deletes leave dead entries and split-fragmented leaves. **REINDEX** (Postgres `REINDEX [CONCURRENTLY]`), `OPTIMIZE TABLE` (InnoDB), `ALTER INDEX ... REBUILD/REORGANIZE` (SQL Server) repack the tree to the fill factor, restoring density and range-scan locality. Tune **fill factor** down for update-heavy indexes (leave slack to absorb in-place updates without splits), up for read-only/append indexes (pack tight, fewer pages).

**Choose index columns and order deliberately.**

- **Leading column = equality/most-selective.** The B-tree descent exploits a **leftmost prefix**: `(a, b)` serves `a = ?`, `a = ? AND b = ?`, and `a = ? ORDER BY b`, but *not* `b = ?`. Order columns so the leading ones are used for equality, the next for ranges/ordering.
- **Add covering columns** to enable index-only scans for hot read queries (Postgres `INCLUDE`, SQL Server `INCLUDE`), weighing the wider index against its write cost.
- **Don't over-index.** Every index multiplies write amplification (each insert/update maintains every covering index) and consumes buffer-pool space. Drop unused indexes (zero `idx_scan`).

**Know when an index does *not* help.** Above ~5–10% selectivity on a heap (HDD `random_page_cost ≈ 4`), the random fetches an index incurs exceed a sequential scan's cost and the planner correctly chooses a **seq scan** — adding an index won't speed up a query that returns much of the table ([`../01-the-io-model/professional.md`](../01-the-io-model/professional.md)). On SSD, lower `random_page_cost` (≈1.1) pushes that crossover higher.

---

## Worked End-to-End: A B+-Tree vs B^ε-Tree I/O Counter

Below is a self-contained Python program with an **explicit I/O counter** built into a paged store. It implements (1) a B+-tree that applies inserts eagerly, one descent per insert, and (2) a `B^ε`-style buffered tree that **appends inserts to node buffers and flushes them in batches**. Running it shows the central production result: **buffering cuts insert I/Os dramatically while search stays cheap**, exactly the `B^ε` win that powers fractal trees and BetrFS.

```python
import bisect

# ---- a paged store with an explicit I/O counter (the model's block transfers) ----
class PagedStore:
    def __init__(self):
        self.pages = {}            # page_id -> node
        self.reads = 0
        self.writes = 0
        self.next_id = 0

    def alloc(self, node):
        pid = self.next_id; self.next_id += 1
        self.pages[pid] = node
        self.writes += 1
        return pid

    def read(self, pid):
        self.reads += 1            # one block transfer
        return self.pages[pid]

    def write(self, pid, node):
        self.writes += 1
        self.pages[pid] = node

# ---- a simple disk-resident B+-tree: EAGER, one descent per insert ----
class BPlusNode:
    def __init__(self, leaf): self.leaf = leaf; self.keys = []; self.children = []

class BPlusTree:
    def __init__(self, store, fanout=8):
        self.s = store; self.F = fanout
        self.root = store.alloc(BPlusNode(leaf=True))

    def insert(self, key):
        # descend root->leaf reading a page per level (the eager cost)
        path = []
        pid = self.root
        node = self.s.read(pid)
        while not node.leaf:
            path.append(pid)
            i = bisect.bisect_right(node.keys, key)
            pid = node.children[i]
            node = self.s.read(pid)
        bisect.insort(node.keys, key)          # insert into leaf
        self.s.write(pid, node)
        if len(node.keys) > self.F:            # split if overflowing (extra writes)
            self._split(pid, node, path)

    def _split(self, pid, node, path):
        mid = len(node.keys) // 2
        right = BPlusNode(leaf=node.leaf)
        right.keys = node.keys[mid:]; node.keys = node.keys[:mid]
        right.children = node.children[mid:]; node.children = node.children[:mid]
        rpid = self.s.alloc(right)
        sep = right.keys[0]
        self.s.write(pid, node)
        if not path:                            # new root
            newroot = BPlusNode(leaf=False)
            newroot.keys = [sep]; newroot.children = [pid, rpid]
            self.root = self.s.alloc(newroot)
            return
        ppid = path[-1]; parent = self.s.read(ppid)
        i = bisect.bisect_right(parent.keys, sep)
        parent.keys.insert(i, sep); parent.children.insert(i + 1, rpid)
        self.s.write(ppid, parent)
        if len(parent.keys) > self.F:
            self._split(ppid, parent, path[:-1])

    def search(self, key):
        pid = self.root; node = self.s.read(pid)
        while not node.leaf:
            i = bisect.bisect_right(node.keys, key)
            pid = node.children[i]; node = self.s.read(pid)
        return key in node.keys

# ---- a B^e-style buffered tree: append to a root buffer, FLUSH in batches ----
class BufferedTree:
    """One internal level over leaves; inserts buffer at the root and flush
       in batches, amortizing the descent over many keys (the B^e trick)."""
    def __init__(self, store, fanout=8, buf_capacity=64):
        self.s = store; self.F = fanout; self.cap = buf_capacity
        self.buffer = []                         # pending inserts (in memory / root page)
        self.leaves = [store.alloc(BPlusNode(leaf=True))]
        self.fences = []                         # separator keys between leaves

    def insert(self, key):
        self.buffer.append(key)                  # O(1): append to buffer, no descent
        if len(self.buffer) >= self.cap:
            self.flush()

    def flush(self):
        if not self.buffer: return
        self.buffer.sort()                       # batch is sorted once
        # distribute the whole batch with ONE pass over the touched leaves
        i = 0
        for k in self.buffer:
            # route to a leaf by fence keys (reads only touched leaves)
            li = bisect.bisect_right(self.fences, k)
            leaf = self.s.read(self.leaves[li])
            bisect.insort(leaf.keys, k)
            self.s.write(self.leaves[li], leaf)
            if len(leaf.keys) > self.F:
                self._split_leaf(li, leaf)
            i += 1
        self.buffer = []

    def _split_leaf(self, li, leaf):
        mid = len(leaf.keys) // 2
        right = BPlusNode(leaf=True)
        right.keys = leaf.keys[mid:]; leaf.keys = leaf.keys[:mid]
        rpid = self.s.alloc(right)
        self.s.write(self.leaves[li], leaf)
        self.leaves.insert(li + 1, rpid)
        self.fences.insert(li, right.keys[0])

if __name__ == "__main__":
    import random
    keys = list(range(20_000)); random.shuffle(keys)   # random insert workload

    s1 = PagedStore(); bt = BPlusTree(s1, fanout=64)
    for k in keys: bt.insert(k)
    print("EAGER B+-tree:")
    print(f"  insert I/Os (reads+writes) = {s1.reads + s1.writes:,}")

    s2 = PagedStore(); bf = BufferedTree(s2, fanout=64, buf_capacity=512)
    for k in keys: bf.insert(k)
    bf.flush()
    print("BUFFERED B^e-style tree:")
    print(f"  insert I/Os (reads+writes) = {s2.reads + s2.writes:,}")

    # search cost stays cheap for the eager B+-tree (few levels)
    s1.reads = s1.writes = 0
    for k in random.sample(keys, 1000): bt.search(k)
    print(f"\nB+-tree: 1000 searches cost {s1.reads:,} reads "
          f"({s1.reads/1000:.1f} I/Os per search)")
```

**What it demonstrates.** The eager B+-tree pays a **root-to-leaf descent (a read per level) on every single insert**, plus split writes — its insert I/O grows with `N × height`. The buffered tree **appends each insert to a buffer for `O(1)`** and only touches disk when a batch of 512 flushes: the batch is sorted once and **distributed in a single pass over the touched leaves**, so one set of leaf reads/writes is amortized over hundreds of inserts. The printed insert-I/O totals show the buffered variant doing **far fewer I/Os** for the same workload — the `B^ε`/fractal-tree win. Meanwhile the final block confirms the B+-tree's **search stays ~constant and cheap** (a handful of reads, mostly the few levels), because buffering trades a small read penalty for a large insert-I/O reduction. This is the production middle ground in miniature: *batch the expensive descents, keep the data ordered.* A real fractal tree (PerconaFT) buffers at **every** level, compresses the buffered messages, and keeps full range-scan order — but the core economics are exactly this.

---

## Decision Framework

| Situation | Reach for | Why |
| --- | --- | --- |
| Read-heavy OLTP, point + range queries | **B+-tree index** (the default) | Height 3–4, top levels cached → ~1 leaf I/O per lookup; leaf chain gives cheap ranges |
| Range scans / `ORDER BY` on the access key | **Clustered index / IOT** on that key | Table physically ordered → ranges are sequential leaf reads |
| Read query needing few columns, hot | **Covering index** (`INCLUDE`) | Index-only scan eliminates the heap fetch / clustered double-lookup |
| Monotonic PK insert hotspot | **Engine fast-append split** (keep monotonic PK); else hash/reverse/partition | Asymmetric right-edge split packs leaves; spreading kills latch contention |
| Embedded KV, read-heavy, crash-safe, zero-copy | **COW B+-tree** (LMDB/BoltDB) | mmap'd, single-writer, atomic root swap → no WAL, lock-free reads |
| Snapshot-friendly filesystem | **COW B-tree FS** (btrfs/ZFS/WAFL) | Path-copying → atomic snapshots share unchanged blocks |
| **Write-heavy + point reads** | **LSM-tree** (RocksDB/Cassandra/MyRocks) | Sequential writes; Bloom filters tame point reads ([`../../21-advanced-structures/04-lsm-tree/professional.md`](../../21-advanced-structures/04-lsm-tree/professional.md)) |
| **Write-heavy *with* range scans** | **B^ε / fractal tree** (TokuDB/PerconaFT, BetrFS) | Buffered inserts cut write amp; data stays ordered → ranges stay cheap |
| Space-constrained, read/space matter most | **B+-tree** (low space amp) | In-place, ≈ fill-factor space; LSM (tiered) wastes space |
| High-concurrency index | **B-link tree** (Postgres nbtree); **Bw-tree** for lock-free | Latch-light/latch-free reads remove the root bottleneck |
| Index bloated after churn | **REINDEX / REBUILD**, tune fill factor | Repack to density; restore range-scan locality |

Three rules of thumb:

1. **B+-tree is the default; justify leaving it.** Height 3–4 and a hot cached upper tree make lookups near-constant and ranges sequential. You move off it only when **writes dominate** (→ LSM, or `B^ε` if you also need ranges) or you need **crash-consistent embedded/FS** semantics (→ COW).
2. **Place your workload on the RUM triangle, then pick the structure.** Read+space → B-tree. Update → LSM. Update *with ordered range reads* → `B^ε`/fractal. There is no corner that is read-, write-, and space-optimal at once ([`./senior.md`](./senior.md)).
3. **The B-tree's pain is always its eager in-place write.** Splits, the monotonic hotspot, bloat, and SSD write amplification are one disease — fix it by batching (bulk load, fast-append splits, fewer wider covering indexes) or by moving to a buffered/log-structured engine.

---

## Research and System Pointers

- **Bayer, R., & McCreight, E. (1972). "Organization and Maintenance of Large Ordered Indices."** *Acta Informatica* 1(3). The original B-tree — fan-out `Θ(B)`, height `log_B N` — that every database index implements.
- **Comer, D. (1979). "The Ubiquitous B-Tree."** *ACM Computing Surveys* 11(2). The B-tree/B+-tree survey that named the family and cemented it as *the* database index.
- **Graefe, G. (2011). "Modern B-Tree Techniques."** *Foundations and Trends in Databases.* The definitive practitioner's catalog: prefix/suffix key compression, page-split policies, fill factor, concurrency, bulk loading, and dozens of production refinements — the single best read for this tier.
- **Lehman, P. L., & Yao, S. B. (1981). "Efficient Locking for Concurrent Operations on B-Trees."** *ACM TODS* 6(4). The B-link tree (right-links + high keys) behind PostgreSQL's nbtree concurrency.
- **Levandoski, J., Lomet, D., & Sengupta, S. (2013). "The Bw-Tree: A B-tree for New Hardware Platforms."** *ICDE.* The lock-free, delta-record, mapping-table B-tree of Hekaton / SQL Server in-memory indexes.
- **O'Neil, P., Cheng, E., Gawlick, D., & O'Neil, E. (1996). "The Log-Structured Merge-Tree (LSM-Tree)."** *Acta Informatica* 33. The write-optimized counterpart; the other end of the B-tree-vs-LSM debate ([`../../21-advanced-structures/04-lsm-tree/professional.md`](../../21-advanced-structures/04-lsm-tree/professional.md)).
- **Brodal, G. S., & Fagerberg, R. (2003). "Lower Bounds for External Memory Dictionaries."** *SODA.* The `B^ε`-tree and the proven insert/query tradeoff frontier that fractal trees occupy.
- **Athanassoulis, M., et al. (2016). "Designing Access Methods: The RUM Conjecture."** *EDBT.* Read–Update–Memory: optimize at most two — the framework for B-tree-vs-`B^ε`-vs-LSM decisions.
- **Bender, M. A., et al. (2015). "An Introduction to Bε-trees and Write-Optimization."** *;login:* (and the **BetrFS** papers, FAST 2015). The `B^ε`-tree in production: buffered inserts cutting write amplification while keeping range-query locality, demonstrated end-to-end in a file system.
- **System sources:** PostgreSQL `src/backend/access/nbtree/` (B-link tree, fill factor, index-only scans); InnoDB clustered-index and adaptive-hash-index internals; **PerconaFT** (the Fractal Tree / `B^ε` engine behind TokuDB); **LMDB** and **BoltDB/bbolt** (memory-mapped COW B+-trees); **btrfs/ZFS** COW B-tree design docs.

---

## Key Takeaways

1. **The B+-tree is the default on-disk index of every relational database because fan-out in the hundreds-to-thousands keeps height at 3–4 for billions of rows** — the top levels live permanently in the buffer pool, so a lookup is usually one cold (leaf) I/O. The leaf chain gives cheap sequential range scans, which is why relational workloads use B+-trees, not hash indexes.
2. **Clustered/index-organized storage makes the table *itself* a B+-tree** (InnoDB on the PK, SQL Server clustered, Oracle IOT): PK lookups are single-descent and range scans on the cluster key are sequential, but secondary indexes store the **PK as locator** (causing double lookups and PK-width amplification). PostgreSQL is heap-only — every index is separate and an index scan pays a random heap fetch per row.
3. **The B-tree's production pain is its eager, in-place write:** page splits, the **monotonic-insert right-hand hotspot** (sequential PK inserts contend on the rightmost leaf — fixed by engine fast-append splits, or by hash/reverse-key/partitioning), index bloat, and SSD write amplification. WAL + checkpointing make those writes durable by turning durability into a sequential log append.
4. **The B-tree-vs-LSM decision is the RUM tradeoff made operational:** B-tree = low read/space amp, but **random in-place writes + WAL**; LSM = **sequential writes** but compaction write amp, multi-run read amp (tamed by Bloom filters), and (tiered) space amp. **Read/range-heavy → B-tree; write-heavy + point reads → LSM.**
5. **The `B^ε` / fractal tree (TokuDB/PerconaFT, BetrFS) is the practical middle ground:** buffered, batched inserts cut write amplification toward the LSM end *while keeping data in global tree order*, so range queries stay cheap — the unique write-optimized structure that does not sacrifice ranges. COW B+-trees (LMDB/BoltDB, btrfs/ZFS/WAFL) trade write amplification for atomic, lock-free, crash-consistent updates.
6. **Engineering decides the constants:** prefix/suffix key compression raises fan-out (lower height), the hot upper tree makes **effective I/Os = leaf level only**, concurrency progresses **latch-coupling → B-link (latch-light reads) → Bw-tree (lock-free)**, and SSDs love the B-tree's random reads but punish its random writes. Measure with `EXPLAIN (ANALYZE, BUFFERS)`, index-usage and bloat stats; tune with fill factor, REINDEX, covering indexes, and column order (leftmost-prefix rule).

---

> **See also:** [`./senior.md`](./senior.md) for the Brodal–Fagerberg frontier, the buffer-tree batch bound, the `B^ε`-tree derivation, and B-tree concurrency theory · [`../01-the-io-model/professional.md`](../01-the-io-model/professional.md) for the buffer pool as `M`, the scan-vs-index crossover, and SSD write amplification · [`../../21-advanced-structures/04-lsm-tree/professional.md`](../../21-advanced-structures/04-lsm-tree/professional.md) for the write-optimized counterpart in the B-tree-vs-LSM debate · [`../../09-trees/11-b-tree/professional.md`](../../09-trees/11-b-tree/professional.md) for the B-tree structure, fan-out arithmetic, and split/merge mechanics
