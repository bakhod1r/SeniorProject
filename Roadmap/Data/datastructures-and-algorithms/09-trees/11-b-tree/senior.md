# B-Tree — Senior Level

> **Audience:** Engineers building or operating production systems where the B-tree is the substrate. Prerequisite: `middle.md`.

This document is a field guide to **B-trees in real software** — which database, filesystem, or embedded engine uses which variant, with what page size, what locking, and what crash-recovery scheme. The point is to give you the exact vocabulary you need when reading source code, tuning a workload, or designing a new storage component.

---

## 1. Relational Databases

### 1.1 PostgreSQL — `nbtree` (Lehman-Yao B+ tree)

- **Index access method:** `btree` is the default and has been since release 6.4 (1998). Source under `src/backend/access/nbtree/`.
- **Page size:** 8 KB by default (`BLCKSZ` compile-time constant; configurable).
- **Variant:** B+ tree with **Lehman-Yao right-links** for concurrency. Internal nodes hold separator keys + child pointers; leaves hold full index tuples with a pointer (TID) into the heap.
- **Locking:** **No latches on the descent path** — search reads pages with only a buffer pin, no exclusive lock. Inserts use **page-level latches** acquired in descent order, released as soon as the next is taken. The Lehman-Yao right-link rescues searches that race with concurrent splits.
- **MVCC:** Index tuples are not versioned; the heap is. Index lookups must visit the heap to check visibility. This is why PostgreSQL has higher index-lookup cost than InnoDB (which embeds versioning in the index).
- **Crash recovery:** WAL records every page-level modification (insert, split, vacuum). Recovery replays WAL against the on-disk pages.
- **`FILLFACTOR`:** Per-index tunable (10–100, default 90 for B-tree). Controls how full pages start; leaves room for in-place updates and slows split rate.
- **HOT updates** keep some updates in the heap without rewriting the index, avoiding B-tree dirty I/O when index keys don't change.

### 1.2 MySQL InnoDB — clustered B+ tree

- **Source:** `storage/innobase/btr/` (the B-tree code is several thousand lines of C++).
- **Page size:** 16 KB by default (configurable per tablespace to 4 / 8 / 32 / 64 KB).
- **Variant:** **Clustered B+ tree on the primary key.** The leaves *contain the row data itself* — not pointers to a separate heap. This is called an **index-organized table** (Oracle terminology) or **clustered index** (Microsoft / MySQL terminology).
- **Secondary indexes** are themselves B+ trees, but their leaf entries store the **primary key value**, not a row pointer. A secondary lookup is therefore two B+ tree traversals: first to find the PK, then to find the row in the clustered index.
- **Locking:** Page-latches via `mtr` (mini-transaction) framework. Index tree latch can be S or X; combined with page latches in a release-as-you-descend pattern.
- **MVCC:** Row versions stored in **rollback segments** (undo log). Each row carries a hidden transaction ID and a rollback pointer; visibility is computed against the reader's snapshot.
- **Adaptive Hash Index (AHI):** InnoDB watches B-tree access patterns and, for hot leaf pages, builds an in-memory hash index pointing directly to records — short-circuiting the tree walk. Tunable via `innodb_adaptive_hash_index`.

### 1.3 SQL Server — clustered & non-clustered B+ trees

- **Page size:** **8 KB**, fixed (never configurable). Eight pages form a 64 KB extent.
- **Variant:** B+ tree. **Clustered** indexes contain the data; **non-clustered** indexes store the row's clustering key (or RID if heap-organized).
- **Locking:** Page locks (`PAGELATCH_*`) and key-range locks for SERIALIZABLE.
- **MVCC:** Optional via "Read Committed Snapshot Isolation" — uses tempdb to hold row versions. Tree itself is not versioned.
- **Page split direction tuning:** SQL Server supports **right-pad inserts** (sequential workload tuning) via the GUID NEWSEQUENTIALID() function, since insert order matters for split frequency.

### 1.4 Oracle — B-tree indexes

- **Default index type:** B-tree (since Oracle 7). Source is proprietary.
- **Page size ("block size"):** 8 KB default; tablespace can use 2/4/8/16/32 KB.
- **Variant:** B+ tree. Internal nodes are "branch blocks"; leaves are "leaf blocks". Leaves are linked into a doubly-linked list for ascending and descending range scans.
- **Index-Organized Tables (IOT):** Oracle's name for clustered tables. The full row sits in the B+ tree leaf.
- **Reverse-key indexes:** A B-tree variant where keys are byte-reversed before indexing. Used to spread monotonically-increasing keys (timestamps, sequence values) across leaf pages to reduce hot-spot contention in RAC clusters.
- **Bitmap indexes:** A *different* index type, useful for low-cardinality columns; not B-tree. Mentioned only because Oracle docs lump them together.

### 1.5 SQLite — embedded B-tree

- **Source:** `src/btree.c` and `src/btreeInt.h` — about 10,000 lines of C, beautifully commented.
- **Page size:** 4 KB default; configurable 512 B to 64 KB at database creation.
- **Variant:** SQLite stores two kinds of B-trees per database:
  - **Table B-tree:** every table is a B+ tree keyed by a 64-bit ROWID, leaves hold full row payload.
  - **Index B-tree:** every secondary index is a B-tree (not B+; intermediate nodes also store the key) of (index-key, ROWID) pairs.
- The file format spec (`https://www.sqlite.org/fileformat.html`, section 1.3 ff.) is the canonical reference for the on-disk layout. Worth reading in full as a model of clarity.
- **Locking:** Database-level (no concurrent writes). Concurrent readers OK during the WAL journaling mode.
- **Crash recovery:** Two modes: rollback journal (older) or **WAL** (default since 3.7.0). WAL mode also gives reader-writer concurrency.

---

## 2. Embedded Key-Value Stores

### 2.1 BoltDB / bbolt — CoW B+ tree

- **License & origin:** BoltDB (Ben Johnson, 2014; archived 2018), forked as **bbolt** by etcd-io (2018-).
- **Page size:** 4 KB.
- **Variant:** **Copy-on-write B+ tree**, single-writer / many-reader, fully mmap'd. Based on LMDB's design (Howard Chu's design influence is explicit in the README).
- **Used by:** **etcd** (so transitively by **Kubernetes**), **Consul** (via bbolt as Raft log store), **InfluxDB v1**.
- **Crash recovery:** None needed — CoW writes are atomic at the meta-page swap.
- **Concurrency:** One writer at a time; readers see consistent snapshots via the old meta page.

### 2.2 LMDB — Lightning Memory-Mapped Database

- **Source:** `mdb.c` in OpenLDAP's repo; ~6,000 lines of C.
- **Page size:** 4 KB (matches OS page size on x86_64).
- **Variant:** mmap'd **copy-on-write B+ tree**, single-writer.
- **Used by:** OpenLDAP slapd, Monero, libmdbx (a hardened fork), some Ethereum clients, Cuckoo Cycle miners.
- **Recovery:** Crash-safe by the same atomic meta-page swap; ~5x faster than file-based engines for read-heavy workloads precisely because there is no buffer pool — the OS page cache is the buffer pool.
- **Limitations:** Single writer (every transaction takes the global write lock); cannot expand beyond mmap'd size without remapping.

### 2.3 BerkeleyDB — B-tree, hash, queue, recno

- **Originated:** University of Berkeley CSRG, then Sleepycat → Oracle (acquired 2006).
- **Page size:** 512 B to 64 KB; default 4 or 8 KB.
- **Variant:** Standard B+ tree with **lock manager** for fine-grained concurrency, full **WAL**, and ARIES-style recovery.
- **Used by:** Subversion, Bogofilter, Postfix (queue), older OpenLDAP back-end (replaced by LMDB), Citus's hstore predecessor.

### 2.4 WiredTiger — MongoDB default since 3.2

- **Source:** `https://github.com/wiredtiger/wiredtiger`.
- **Variant:** **B-tree** (configurable page size, default 32 KB internal / 32 KB leaf) with copy-on-write writes batched into checkpoints. Also supports an LSM mode (rarely used since 3.2).
- **Concurrency:** **Hazard pointers** for lock-free reads; per-page exclusive latches for writes.
- **MVCC:** Each row carries timestamps; readers see a consistent snapshot at their read timestamp.

---

## 3. Filesystems

### 3.1 HFS+ — macOS catalog B-tree

- HFS+ stores the directory tree, allocation map, and file extents as **B\*-trees** (the high-fill Knuth variant, see `middle.md`). Catalog node size 8 KB; allocation block typically 4 KB.
- The "Catalog B\*-Tree" maps `(parentDirID, name)` → file metadata. Lookup, listing, and creation all go through this tree.
- HFS+ has no journaling for catalog updates by default — relies on transactions in the journal file. Replaced by APFS in macOS 10.13 (2017).

### 3.2 APFS — B-tree of B-trees

- APFS keeps **multiple B+ trees per volume**: an object map, an extent reference tree, a snapshot metadata tree, a fsroot per volume.
- **CoW** everywhere; updates write new nodes upward to a new root that becomes visible atomically.
- Snapshots are O(1) — they just retain an old root pointer. Same model as Btrfs and LMDB.

### 3.3 NTFS — Master File Table B+ tree

- Each NTFS volume's MFT (Master File Table) is a sequence of 1 KB records, but directory entries are indexed by **B+ trees** stored as `$INDEX_ROOT` and `$INDEX_ALLOCATION` attributes on the directory's MFT record.
- Page (index buffer) size: 4 KB on modern volumes (used to be 1 KB).
- Resilient: every B+ tree change is fenced by the NTFS log file's checkpoint structure.

### 3.4 XFS — B+ trees everywhere

- XFS is famously "all B+ trees". Per allocation group, separate B+ trees for:
  - **Free space by block number** (location).
  - **Free space by extent size** (size).
  - **Inode allocation** (bitmap-based B+ tree, "iallocag").
  - **Reverse mapping** (which file owns which extent — added with rmap-enabled XFS).
- Page (block) size: 4 KB by default. Originally designed for SGI IRIX in 1993 — one of the earliest filesystems built around B+ trees end-to-end.

### 3.5 Btrfs — B-tree of B-trees, CoW throughout

- Btrfs is literally **"B-tree filesystem"**; every metadata structure is a CoW B-tree.
- Separate B-trees for: subvolume root, file extents, checksums, free space, device tree, quota tree, UUID tree.
- 4 KB nodes (default); CoW writes new pages, atomically swaps a superblock pointer at commit.
- Snapshots, send/receive, and clones all leverage the CoW tree structure for cheap shared subtrees.

### 3.6 Ext4 — HTree directory index

- Ext4 directories use an "htree" — a **bounded-depth B-tree** (max 2 or 3 levels) keyed by the **hash of the filename**. The htree was added in ext3 to make large directories (>10K entries) tolerable.
- Not a full B-tree: hashed keys defeat range queries (`readdir` returns hash-order garbage, not alphabetical), but constant-bounded depth is enough for ext4's use case.

### 3.7 ZFS — Merkle-tree DMU

- ZFS's **Data Management Unit (DMU)** uses CoW indirect blocks arranged in a Merkle B-tree: every block carries a 256-bit checksum stored in its parent, so any corruption is detected when reading. Combined with redundancy (mirrors / raidz), corruption is automatically repaired.
- Block sizes are variable, up to 1 MB (`recordsize` property); a typical filesystem record is 128 KB.

---

## 4. Linux Kernel

- **`drivers/md/dm-btree*`** — Device Mapper's persistent B-tree, used by `dm-thin` (thin provisioning) and `dm-cache`.
- **`fs/btrfs/ctree.c`** — Btrfs's CoW B-tree implementation, ~5,000 lines of C.
- **`lib/btree.c`** — A simple in-memory B+ tree library used by a handful of subsystems (e.g., DRM memory managers).
- **Kernel `radix_tree`** — superseded by `xarray` — is a radix tree, not a B-tree, but it solves similar in-RAM-indexing problems where a B-tree would also fit.

---

## 5. Operational Considerations

### 5.1 Page/buffer pool alignment

A B-tree node should be exactly **one disk page**. If the engine uses **direct I/O** (`O_DIRECT`), the buffer must be aligned to the device's logical block size (usually 512 B or 4 KB). If it uses buffered I/O, alignment is less critical but still helps with `mmap` and partial-page reads.

### 5.2 The page cache interaction

Most B-tree engines have their **own buffer pool** that competes with the OS page cache. PostgreSQL's `shared_buffers` (default 128 MB, tune to 25% of RAM) is the most famous example. The conventional wisdom for double caching: keep the database's buffer pool small enough that OS page cache can still hold "secondary" pages, or use `mmap` and let the OS do all the caching (LMDB / bbolt approach). InnoDB's `innodb_buffer_pool_size` should typically be 50-70% of RAM on dedicated database servers — InnoDB does not rely on OS page cache.

### 5.3 Sequential-insert hot spots

Monotonically-increasing primary keys (timestamp, UUID v1, auto-increment) cause every new key to land in the **rightmost leaf**. That leaf becomes a hot spot: every writer queues for it, every split affects only the right edge of the tree. Mitigations:

- **Hash-keyed indexes** (Oracle reverse-key indexes).
- **UUID v4** instead of v1 (random distribution).
- **Page split at 100%** instead of 50% so right-edge inserts don't waste left-side capacity (`FILLFACTOR 100` for append-only tables in PostgreSQL).
- **Partitioning** the table so the hot-spot is split across N partitions.

### 5.4 Index bloat and rebuild

Repeated insert/delete cycles leave nodes underfull. PostgreSQL's `VACUUM` reclaims dead tuples but does not compact the tree itself; `REINDEX` rebuilds. InnoDB compacts on the fly during page splits but can still get bloated under random-delete patterns. Periodically rebuilding indexes on long-lived OLTP tables is normal hygiene.

### 5.5 Online schema changes

`CREATE INDEX CONCURRENTLY` in PostgreSQL builds a B-tree in two passes while accepting writes. InnoDB similarly supports online `ALTER TABLE ... ADD INDEX` since 5.6. Both use a side-log of writes that arrive during the build, then replay them at the end with appropriate locks.

---

## 6. Quick reference table

| System | Variant | Page size | Concurrency | CoW | Where keys live |
|---|---|---|---|---|---|
| PostgreSQL btree | B+ Lehman-Yao | 8 KB | page latches + right-link | no | leaves only |
| InnoDB | B+ clustered | 16 KB | mtr latches | no | leaves; clustered = data |
| SQL Server | B+ | 8 KB | page latches | no | leaves only |
| Oracle | B+ | 8 KB | latches + KCBR | no | leaves only |
| SQLite | Table B+ / Index B | 4 KB | DB-level | no | leaves (table) / both (index) |
| BoltDB / bbolt | B+ CoW | 4 KB | 1 writer | yes | leaves only |
| LMDB | B+ CoW mmap | 4 KB | 1 writer | yes | leaves only |
| BerkeleyDB | B+ | 4-8 KB | lock mgr | no | leaves only |
| WiredTiger | B-tree | 32 KB | hazard ptr | yes | both |
| HFS+ catalog | B\* | 4-8 KB | volume lock | no | both |
| Btrfs | B-tree CoW | 4 KB+ | rwsem per tree | yes | both |
| XFS | B+ | 4 KB | per-AG latches | no | leaves only |
| NTFS index | B+ | 4 KB | reserved range | no | leaves only |
| Ext4 htree | Hashed B-tree | 4 KB | dir mutex | no | leaves only |

---

## 7. Reading list

- **Stonebraker, M., & Hellerstein, J. M.** (2007). *Architecture of a Database System.* Foundations and Trends in Databases. Chapter 4 covers buffer management and indexes.
- **Ramakrishnan, R., & Gehrke, J.** *Database Management Systems*, 3rd ed., Chapters 10-12. The textbook on indexes and storage.
- **Hellerstein, J. M., Stonebraker, M., & Hamilton, J.** (2007). *Architecture of a Database System.* The buffer pool chapter is essential.
- **Petrov, A.** *Database Internals*, Chapters 2-3 (B-tree basics), 6 (variants), 13 (anti-entropy).
- **PostgreSQL** source: `src/backend/access/nbtree/README` — the maintainers' own explanation of the Lehman-Yao implementation. Required reading.
- **SQLite** file format spec: `https://www.sqlite.org/fileformat.html`. The clearest statement of B-tree on-disk layout you will find anywhere.
- **MySQL InnoDB** internals: Jeremy Cole's blog series at `https://blog.jcole.us/innodb/`.
- **LMDB design** paper by Howard Chu (2011), available from the OpenLDAP site.
- **Bender, M. A., et al.** *Don't Thrash: How to Cache Your Hash on Flash.* VLDB 2012. SSDs vs B-trees vs LSM.
