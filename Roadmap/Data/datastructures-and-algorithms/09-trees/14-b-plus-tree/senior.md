# B+ Tree — Senior Level

> **Audience:** Engineers designing or troubleshooting production databases and storage engines. Prerequisite: `middle.md`.

This document maps the techniques from `middle.md` onto **real, named systems**. When a query plan in PostgreSQL says `Index Scan using orders_pkey`, what is actually happening on disk? When an InnoDB schema decision says "the primary key matters more than you think", why? Understanding the on-disk B+ tree layout of each major engine is what separates an engineer who can read query plans from one who can architect schemas.

---

## Table of Contents

1. [PostgreSQL `nbtree` Access Method](#postgres)
2. [MySQL InnoDB Clustered B+ Tree](#innodb)
3. [SQLite B+ Tree Storage Layer](#sqlite)
4. [Oracle B-tree (B+ tree) and IOTs](#oracle)
5. [SQL Server Clustered / Non-Clustered Indexes](#mssql)
6. [LMDB and bbolt (CoW B+ trees)](#lmdb)
7. [WiredTiger (MongoDB's default)](#wiredtiger)
8. [B+ Trees in File Systems](#filesystems)
9. [OLAP / Sequential Scan Optimization](#olap)

---

<a name="postgres"></a>
## 1. PostgreSQL `nbtree` Access Method

PostgreSQL implements its on-disk B-tree at `src/backend/access/nbtree/`. The "n" in nbtree stands for "Nathan" Smyth's rewrite in the early '90s — but the design is pure Lehman-Yao with PostgreSQL-specific touches.

### Key facts

- **Page size:** 8 KB by default (compile-time `BLCKSZ`).
- **Variant:** Lehman-Yao B-link tree with right-link pointers at every level.
- **Held in the leaf:** `(indexed_columns, heap_TID)`. The leaf does **not** store the row itself — PostgreSQL is heap-based, not IOT-based.
- **Duplicate handling:** keys with the same indexed-column value are tie-broken by `heap_TID`. This effectively makes the index keys unique at the storage layer, which is critical for concurrent inserts and avoids "duplicate key" complications during split.
- **Concurrency:** lockless reads (Lehman-Yao); short-duration buffer pins during navigation; LWLocks (light-weight locks) only when splitting/merging.

### Page layout (from `src/include/access/nbtree.h`)

```
+------------------------------------------+
| PageHeader (24 bytes)                    |
+------------------------------------------+
| ItemIdData[] (line pointers)             |
+------------------------------------------+
| free space (grows down from here)        |
| ... ...                                  |
| free space (grows up from here)          |
+------------------------------------------+
| IndexTuple_n                             |
| ...                                      |
| IndexTuple_1                             |
+------------------------------------------+
| BTPageOpaqueData (special)               |
|   btpo_prev: left sibling                |
|   btpo_next: right sibling (right-link)  |
|   btpo.level: tree level (leaf = 0)      |
|   btpo_flags: leaf? deleted? half-dead?  |
|   btpo_cycleid: split cycle              |
+------------------------------------------+
```

The `BTPageOpaqueData` at the end of each page holds the **right-link** (`btpo_next`) used for Lehman-Yao recovery. Note that PostgreSQL also keeps a **left link** (`btpo_prev`) — making the leaf chain doubly-linked. This enables backward scans (`ORDER BY ... DESC`) without re-descent.

### Inside the leaf: TIDs as tiebreakers

When you `CREATE INDEX idx ON t(col)`, multiple rows can have the same `col` value. Each entry in the leaf is `(col_value, ctid)` where `ctid` is the heap row's address (block + offset). The B+ tree sorts by `(col_value, ctid)`, so even with millions of duplicates the index order is total.

### Range scans

PostgreSQL range scans use the **doubly-linked leaf chain**. `EXPLAIN (ANALYZE) SELECT * FROM t WHERE col BETWEEN 100 AND 200 ORDER BY col` shows `Index Scan` — that is: descend once to leaf for 100, walk right via `btpo_next` until past 200.

For `ORDER BY col DESC`, the planner uses **backward index scan** — same descent, but walks via `btpo_prev`.

### Index scan vs index-only scan

- **Index scan**: walk B+ tree, get TIDs, fetch heap pages for each.
- **Index-only scan**: if the requested columns are all in the index (covering index), skip the heap. Requires the heap pages' "all-visible" bit (from the visibility map) to be set.

The `CREATE INDEX ... INCLUDE (cols)` syntax (since PG 11) explicitly puts extra columns in the leaf to enable index-only scans without making them part of the search key.

### Where to look in the source

- `src/backend/access/nbtree/README` — narrative of the design.
- `src/backend/access/nbtree/nbtinsert.c` — split logic.
- `src/backend/access/nbtree/nbtsearch.c` — descent + Lehman-Yao recovery.
- `src/backend/access/nbtree/nbtutils.c` — page format helpers.

Reading this code carefully teaches more than any textbook.

---

<a name="innodb"></a>
## 2. MySQL InnoDB Clustered B+ Tree

InnoDB is the standard storage engine for MySQL. Its core design choice: **every table is an index-organized B+ tree clustered on the primary key**.

### Key facts

- **Page size:** 16 KB by default (`innodb_page_size`).
- **Variant:** B+ tree with latch coupling and "btr_optimistic_insert" fast path.
- **Held in the leaf of the primary index:** **the entire row** (clustered index = IOT).
- **Held in the leaf of a secondary index:** `(secondary_key, primary_key)`. No row data — secondary lookups require a second walk of the primary tree.

### Why "the primary key IS the table"

When you `INSERT INTO t (id, ...)`, InnoDB inserts the entire row into the leaf of the primary-key B+ tree at the slot for that key. Rows are physically clustered (stored sorted by PK) in disk order. A primary-key range scan is the fastest possible operation: one descent + sequential leaf-chain walk, with rows already in order.

### Implications for schema design

1. **Sequential primary keys are good.** `BIGINT AUTO_INCREMENT` inserts at the rightmost leaf — minimal splits, maximum locality. `UUID v4` primary keys insert randomly across the tree, causing splits everywhere and destroying buffer-pool efficiency. This is why ULID, UUID v7, and Snowflake IDs exist: sortable identifiers that retain primary-key locality.

2. **Secondary indexes are slower than they look.** A query like `SELECT * FROM t WHERE email = ?` walks the secondary index on `email`, gets the primary key, then walks the primary tree to fetch the row. Two B+ tree descents per row.

3. **Covering indexes are powerful.** If a query needs only columns that are in the secondary index, no primary-tree walk is needed. Same with `KEY(a, b, c)` covering `WHERE a = ? AND b = ?` returning `c`.

4. **Avoid wide primary keys.** Every secondary index leaf carries the full primary key. A 100-byte PK means 100 bytes of overhead per secondary-index entry — multiplied by every secondary index and every row.

### Locking model

InnoDB uses **next-key locks** (record + gap locks) on the B+ tree to provide REPEATABLE READ isolation without phantom reads. A range scan locks the gap between adjacent leaves to prevent another transaction from inserting into the range. This is one of the most subtle aspects of InnoDB performance and the source of many "why is my INSERT blocked" tickets.

### Doublewrite buffer (revisit from middle.md)

InnoDB's WAL strategy: pages are written first to a 2 MB doublewrite buffer, then to their target location. Crash-safe against torn writes without per-page FPW logging.

### Sources

- `mysql-server/storage/innobase/btr/` — B+ tree code.
- `storage/innobase/include/page0page.h` — page layout.
- MySQL docs: "Clustered and Secondary Indexes", "InnoDB Storage Engine".

---

<a name="sqlite"></a>
## 3. SQLite B+ Tree Storage Layer

SQLite's entire database is a single file containing one or more B+ trees. The file format is so well-documented and minimal that it has become the canonical learning resource for B+ tree internals.

### Key facts

- **Page size:** configurable from 512 bytes to 64 KB, default 4 KB.
- **Variant:** B+ tree with two distinct internal layouts: "table B+ tree" (clustered, holds rows) and "index B+ tree" (non-clustered, holds keys + rowids).
- **WITHOUT ROWID tables** (introduced in 2013): opt-in IOT mode where the user-defined primary key is the clustering key.
- **Default tables**: clustered on the integer `rowid` column. Secondary indexes carry `rowid` as the tiebreaker.

### Why study SQLite's format?

The file format specification (https://www.sqlite.org/fileformat.html, Section 1.6) walks through every byte of a B+ tree page. It is **the** reference for understanding what a real B+ tree looks like on disk. A few hundred lines of prose explain:

- Page types (table leaf, table interior, index leaf, index interior).
- Cell pointer arrays and cell payload layout.
- Overflow chains for oversized records.
- The "freeblock" mechanism for in-page free-space management.

### Notable design choice: payload overflow

If a record is larger than a fraction of the page (default ~1/4), the prefix lives in the leaf and the rest spills into an **overflow page chain**. The leaf cell holds just enough payload for sorting + a pointer to the overflow chain. This keeps leaves uniformly sized regardless of row width.

### Single-writer model

SQLite supports many readers but only one writer at a time, coordinated by a file lock. The B+ tree is mutated in place; durability is provided by either a **rollback journal** (default) or **write-ahead log** (`PRAGMA journal_mode=WAL`). The WAL mode is essentially a separate log file that lets readers proceed even during a write transaction.

### Why this matters for you

SQLite is everywhere: every Android app, every iOS app, Firefox, Chrome, many desktop apps. When your Android app feels slow, there is a good chance a SQLite B+ tree is the bottleneck — possibly because of an inappropriate index or page size choice. Knowing SQLite's exact layout is a debugging superpower.

---

<a name="oracle"></a>
## 4. Oracle B-tree (B+ tree) and IOTs

Oracle's "B-tree index" is implemented as a B+ tree in practice (despite the name). Documentation often blurs the distinction.

### Standard heap-organized table + B+ tree indexes

Most Oracle tables are heap-organized. The primary key index is a B+ tree pointing to `ROWID` (a physical row address). Secondary indexes are similar B+ trees pointing to `ROWID`.

### Index-Organized Tables (IOT)

Opt-in via `CREATE TABLE ... ORGANIZATION INDEX`. The primary-key B+ tree IS the table; leaves carry the full row. Used heavily for narrow lookup tables and dimension tables in warehousing.

### Compressed indexes

Oracle supports **index key compression** (similar to prefix compression in `middle.md`). For composite indexes where the leading columns have low cardinality, this can shrink the index by 80–95%. Configurable per index: `CREATE INDEX ... COMPRESS [n]`.

### Bitmap indexes

For low-cardinality columns (gender, status), Oracle offers bitmap indexes — fundamentally different structure, not a B+ tree. Outside the scope of this document, but worth knowing as an alternative.

### Online index rebuild

Oracle's `ALTER INDEX ... REBUILD ONLINE` rebuilds an index without blocking writes. Internally, this is a bulk-load of a new tree alongside the old, with concurrent updates captured in a journal and replayed at swap time. The same pattern appears in nearly every production database.

---

<a name="mssql"></a>
## 5. SQL Server Clustered / Non-Clustered Indexes

SQL Server's terminology distinguishes:

- **Clustered index**: an IOT-style B+ tree clustering rows by the index key. A table has at most one. Default is the primary key (if one is declared).
- **Non-clustered index**: a B+ tree pointing to the clustered index's key (if the table is clustered) or to RIDs (if it is a heap).

### Page size

8 KB fixed. Not configurable, unlike PostgreSQL or InnoDB.

### Concurrency

SQL Server uses **latches** (lightweight short-term locks for physical structures) and **locks** (transactional). The B+ tree itself is protected by latches; transaction isolation uses locks on key ranges. The "hekaton" in-memory engine uses Bw-trees (lock-free, see `middle.md`).

### Filtered indexes

A non-clustered index can be defined `WHERE <predicate>` to include only the matching rows. Smaller B+ tree, faster scans, but only useful for queries matching that predicate.

### Included columns

`CREATE INDEX ... INCLUDE (cols)` puts extra columns in the leaf (but not as part of the search key) — same idea as Postgres's `INCLUDE`. Enables covering for queries that need extra columns without bloating the index search structure.

---

<a name="lmdb"></a>
## 6. LMDB and bbolt (CoW B+ trees)

The radical alternative: **copy-on-write** (see `middle.md`).

### LMDB

- **Implementation:** ~10,000 lines of C. The B+ tree code is in `mdb.c`.
- **Page size:** matches OS page size (typically 4 KB).
- **Memory model:** mmap the entire database file. Pages are accessed by direct pointer arithmetic into the mmap'd region.
- **Concurrency:** unlimited concurrent readers, single writer. The writer holds a global lock; readers pin a snapshot via root pointer (RCU-style).
- **Durability:** the new root pointer is written last, in a single page write. If the write succeeds, the new state is committed; if it fails or is torn, the old root is still valid. No WAL needed.
- **Used by:** OpenLDAP slapd (its origin), Monero, many embedded apps. Often cited for its small code size and exceptional read performance.

### bbolt

- **Implementation:** Go port and fork of Bolt (which was inspired by LMDB). ~3,000 lines of Go.
- **Used by:** etcd (Kubernetes' control plane), Consul, many Go services.
- **Same model:** mmap, single-writer, CoW B+ tree, snapshot reads.

### When CoW B+ trees lose

- **Write-heavy workloads.** Every insert rewrites the root-to-leaf path; write amplification is high.
- **Multi-writer needs.** Single-writer is by design; you cannot scale write throughput by adding cores.
- **Long-running readers + heavy writes.** Old versions can't be garbage-collected while a reader holds the snapshot, causing the file to grow unboundedly.

### When CoW B+ trees win

- **Read-heavy workloads with occasional writes.** etcd's typical pattern.
- **Crash safety without complex recovery.** Useful for embedded systems where you can't afford a WAL.
- **Snapshot consistency.** Each reader sees a frozen view; perfect for backup and replication snapshots.

---

<a name="wiredtiger"></a>
## 7. WiredTiger (MongoDB's default)

WiredTiger is MongoDB's default storage engine since v3.2. It is a hybrid: B+ tree on disk with LSM-like compaction and an in-memory write buffer.

### Key facts

- **Page size:** typically 32 KB (configurable). Larger pages → fewer levels → fewer I/O for large datasets.
- **Compression:** built-in block compression (snappy by default). The page is decompressed on read, recompressed on write. This violates the "compressed pages must preserve order" principle by maintaining an in-memory **uncompressed** version of each accessed page.
- **Concurrency:** modified Bw-tree-influenced design with multi-version concurrency control. Writers do not block readers.
- **Schemas:** documents (BSON) stored in leaves. Each document is identified by `_id` which is the clustering key (B+ tree primary index = collection storage).

### MVCC

WiredTiger maintains multiple versions of documents via append-only update chains. The B+ tree's leaf cells point to the latest committed version; readers can navigate version chains to find the version visible to their snapshot.

### Why this matters

MongoDB's performance characteristics — fast `_id` lookups, slower secondary-index lookups, expensive sharded range queries — flow directly from WiredTiger's B+ tree design. Knowing this lets you predict why a particular query is slow.

---

<a name="filesystems"></a>
## 8. B+ Trees in File Systems

B+ trees are not just for databases. Many file systems use B+ trees for directory metadata, extent maps, and free-space tracking.

### NTFS (Microsoft)

The Master File Table (MFT) and directory indexes are B+ trees. Files are looked up by name in a per-directory B+ tree; extent allocation uses another B+ tree.

### XFS (Linux)

Extensive B+ tree usage: directory entries, free-space btrees, inode allocation btrees, extent maps. XFS is notable for B+ trees with hundreds of millions of entries that scale to multi-petabyte file systems without performance cliffs.

### Btrfs (Linux)

Copy-on-write B+ tree at the file-system level. Every metadata structure (directory, extent map, snapshot tree, subvolume tree) is a CoW B+ tree. Snapshots are O(1) — just share the root pointer.

### ReiserFS (historical Linux)

The "dancing tree" was a B+ tree variant that aggressively rebalanced for space efficiency. Famous for cramming small files into internal node slack space.

### Why FS designers love B+ trees

- Directories with millions of files: ext2's linked-list directory was O(n) per lookup; ext4 added an HTree (B+ tree-like). NTFS, XFS, Btrfs use B+ trees throughout.
- Extent maps: a file fragmented into thousands of pieces needs an efficient sparse map; a B+ tree keyed by file offset is the right structure.
- Snapshot/cloning support: CoW B+ trees make snapshots constant-time.

---

<a name="olap"></a>
## 9. OLAP / Sequential Scan Optimization

For analytical workloads, B+ trees are sometimes used differently:

### Sorted columnar storage with B+ tree row-group indexes

Parquet, ORC, and similar columnar formats store data in row groups, each with a min/max per column. A B+ tree over `(column_min, column_max)` per row group allows skipping groups during scan. This is **zone-mapping**, a B+ tree of row-group metadata — fast at locating relevant groups for predicate-pushdown queries.

### TimescaleDB chunks

TimescaleDB partitions time-series data into chunks (by time range) and maintains a B+ tree of chunks. Range queries first locate the relevant chunks via the B+ tree, then sequentially scan within each chunk. The B+ tree here is a meta-index over partitions, not over rows.

### Sequential scan via leaf chain

For an OLAP query that scans an entire table sorted by an indexed column, the B+ tree's leaf chain provides exactly the right access pattern: linear sequential I/O, no random access. Combined with prefetching and asynchronous I/O (PostgreSQL 17's async I/O, MySQL InnoDB's `innodb_read_io_threads`), this can saturate disk bandwidth.

### When NOT to use B+ trees for OLAP

For pure OLAP (data warehousing, analytics), specialized formats often beat B+ trees:
- Columnar storage (Parquet, ORC, ClickHouse).
- LSM trees (Cassandra, BigTable) for write-heavy time-series.
- Bitmap indexes (Druid, Pinot) for low-cardinality dimensions.

But for OLTP and HTAP (hybrid transactional/analytical processing), B+ trees remain dominant precisely because they handle both point lookups and range scans well.

---

## Cheat Sheet — System Mapping

```
System              Variant                       Leaf contents          Page size
------              -------                       --------------         ---------
PostgreSQL nbtree   Lehman-Yao (B-link)           (key, heap_TID)        8 KB
MySQL InnoDB        Latch-coupled IOT             (PK, full row)          16 KB
MySQL InnoDB sec.   Latch-coupled                 (sec_key, PK)           16 KB
SQLite              Classic + WAL                 row or (key, rowid)    4 KB (default)
SQLite WITHOUT ROWID Classic IOT                   (PK, full row)         4 KB
Oracle B-tree       Latch-coupled                 (key, ROWID)            8 KB (default)
Oracle IOT          Latch-coupled IOT             (PK, full row)          8 KB
SQL Server clust.   Latch-coupled IOT             (PK, full row)          8 KB
SQL Server non-cl.  Latch-coupled                 (sec_key, clustering)   8 KB
LMDB                Copy-on-write                 (key, value)            OS page
bbolt               Copy-on-write                 (key, value)            4 KB
WiredTiger          B+ tree + MVCC + LSM-like     BSON docs               32 KB
NTFS                B+ tree                       directory entries       cluster size
XFS                 B+ tree                       directory/extent        block size
Btrfs               CoW B+ tree                   FS metadata             16 KB
```

---

## Further Reading

- **PostgreSQL `src/backend/access/nbtree/README`** — narrative of nbtree's Lehman-Yao implementation.
- **MySQL InnoDB**: "InnoDB Storage Engine" chapter of the MySQL Reference Manual. Sections on clustered/secondary indexes are essential.
- **SQLite file format**: https://www.sqlite.org/fileformat.html, Section 1.6. The cleanest documentation of any production B+ tree.
- **Oracle Concepts Guide**: chapter on indexes and IOTs.
- **LMDB design paper**: Howard Chu, "Lightning Memory-Mapped Database" (OpenLDAP project, 2011).
- **bbolt design notes**: https://github.com/etcd-io/bbolt — the README explains the CoW model.
- **WiredTiger architecture**: https://source.wiredtiger.com/develop/architecture.html.
- **Graefe, G.** (2011). *Modern B-Tree Techniques* — connects production techniques back to the academic literature.
- Continue with `professional.md` for hardware-conscious leaf layouts, lock-free design, ART, and modern in-memory alternatives.
