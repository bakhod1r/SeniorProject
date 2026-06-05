# B+ Tree — Middle Level

> **Audience:** Engineers who have a working B+ tree from `junior.md` and want to understand the variants and techniques used in real production systems. Prerequisite: `junior.md` and `09-trees/08-b-tree`.

This document covers the **family of practical B+ tree designs** that differ from the textbook implementation: the **B-link tree** (Lehman & Yao 1981) that enables concurrent operations with minimal locking, **latch coupling vs lock-free** designs, **copy-on-write B+ trees** (LMDB, bbolt) that never mutate existing pages, **fractal trees / Bε-trees** (TokuDB) that buffer writes in internal nodes, **prefix compression and suffix truncation** for tighter packing, **index-organized tables** (Oracle IOT, InnoDB), **write-ahead log interaction** for crash safety, and **bulk loading** techniques for `CREATE INDEX` performance.

---

## Table of Contents

1. [B-link Trees (Lehman & Yao 1981)](#blink)
2. [Latch Coupling vs Lock-Free B+ Trees](#latches)
3. [Copy-on-Write B+ Trees (LMDB, bbolt)](#cow)
4. [Fractal Trees and Bε-Trees (TokuDB)](#fractal)
5. [Prefix Compression and Suffix Truncation](#compression)
6. [Index-Organized Tables (Oracle IOT, InnoDB)](#iot)
7. [WAL Interaction: Crash Safety](#wal)
8. [Bulk Loading via Sorted Runs](#bulk)

---

<a name="blink"></a>
## 1. B-link Trees (Lehman & Yao 1981)

The classic textbook B+ tree assumes single-threaded access. Real databases serve thousands of concurrent transactions; a naive implementation that locks the whole tree during inserts would be unusable. The **B-link tree** (Lehman & Yao 1981, *"Efficient Locking for Concurrent Operations on B-Trees"*) is the foundational design that solves this.

### The key idea

Add a **right-link pointer at every level**, not just at the leaves. Each internal node has, in addition to its child pointers, a pointer to its **right sibling at the same level**. Plus, each node stores a **high key** — the maximum key value in its subtree.

```
                           [50 | rightLink ----------------------> next root sibling]
                          /         \
                  [20 | rightLink -> 80]                            [80 | rightLink -> nil]
                 /        \                                        /         \
       [10|20|*]   [30|40|*]                                [60|70|*]  [80|90|*]
```

(`*` denotes the leaf chain pointer that the standard B+ tree already had.)

### Why right-links solve concurrency

The classic split protocol races: thread A is descending toward a leaf when thread B simultaneously splits the leaf. Thread A reaches a node that no longer holds the key it expected — the key has moved to the new right sibling that didn't exist when A started its descent.

With right-links, A's recovery is trivial: if A reaches a node and finds the search key is **greater than the node's high key**, A simply **follows the right-link** to the new sibling. No restart from root, no global lock. The link "heals" the race.

### The Lehman-Yao protocol in pseudocode

```python
def search(root, key):
    node = root
    while not node.is_leaf:
        # Follow right-links while key > node.high_key
        while key > node.high_key and node.right_link is not None:
            node = node.right_link
        node = node.children[find_child_slot(node.keys, key)]
    # At leaf level, same rule
    while key > node.high_key and node.right_link is not None:
        node = node.right_link
    return node.find(key)
```

### Why this matters

- **Readers never block.** No latch is needed during search — readers tolerate concurrent splits because right-links rescue them.
- **Writers only latch one node at a time** (during the split itself). They release the latch before propagating the split upward.
- **No global lock** is ever required, even for tree-restructuring operations.

### Used by

- **PostgreSQL `nbtree`** (entire on-disk B-tree access method) — a near-textbook Lehman-Yao implementation, in `src/backend/access/nbtree/`. The right-link at every level is in `BTPageOpaqueData::btpo_next`.
- **Berkeley DB**, **InnoDB** (with modifications).
- Many in-memory concurrent B-trees descend from this design.

The 1981 paper is one of the most-cited database systems papers of all time, precisely because every other concurrent B-tree variant traces back to it.

---

<a name="latches"></a>
## 2. Latch Coupling vs Lock-Free B+ Trees

When traversing a B+ tree under concurrent access, you need **some** form of synchronization. There are three families.

### 2.1 Tree latching (coarse)

Single reader-writer lock on the whole tree. Simple, correct, useless at scale. Only seen in toy implementations or in trees where contention is known to be near zero.

### 2.2 Latch coupling (a.k.a. crab latching)

Acquire a latch on each node as you descend. **Release the parent latch as soon as you confirm the child won't trigger a structural change.**

```
Descent for search (read):
  acquire shared latch on root
  while node is internal:
      acquire shared latch on chosen child
      release shared latch on parent     <- "crab" forward
      node = child

Descent for insert (write):
  acquire exclusive latch on root
  while node is internal:
      acquire exclusive latch on chosen child
      if child is "safe" (will not split):       # i.e., child has spare capacity
          release exclusive latch on parent
      node = child
```

A node is **safe** if it has spare capacity. For inserts: not full. For deletes: more than half-full. If a child is safe, no split/merge will propagate to the parent, so you can release the parent latch immediately.

Latch coupling is the dominant approach in disk-resident B+ trees: PostgreSQL nbtree, MySQL InnoDB, SQL Server, Oracle all use variants. It scales decently with reader concurrency, less so with writer concurrency on hot keys.

### 2.3 Lock-free / optimistic latching

The Bw-tree (Microsoft Research / SQL Server Hekaton, Levandoski et al. 2013) avoids latches entirely. Each "page" is conceptually a base page plus a chain of delta records (insert, delete, update) attached via CAS. Lookups walk the delta chain. Periodically a base page is rewritten to fold deltas in.

Pros: high concurrency, lock-free reads. Cons: complex, GC pressure, harder to reason about.

In-memory B+ trees increasingly use **optimistic latch coupling (OLC)**: readers check version counters before and after each step; if a version changed, they retry. Common in modern HTAP systems (HyPer, Umbra).

### 2.4 Choosing

| Workload | Recommendation |
|---|---|
| Disk-resident, mixed reads/writes | Latch coupling (Lehman-Yao right-links + crab latching) |
| Disk-resident, read-heavy | Lehman-Yao with shared latches |
| In-memory, very high concurrency | Optimistic latch coupling or Bw-tree |
| Single-writer, multi-reader, durable | Copy-on-write (next section) |

---

<a name="cow"></a>
## 3. Copy-on-Write B+ Trees (LMDB, bbolt)

A radically different concurrency model: **never modify a page in place**. Instead, allocate a new page with the modification, walk up the tree allocating new versions of each ancestor (the "copy path"), and atomically swap the root pointer.

### Why this is brilliant

- **No latches.** Readers see a consistent snapshot of the tree by reading the root pointer once. Writers do not interfere with readers because they never touch existing pages.
- **Crash safety for free.** The new root pointer is written last in a single atomic operation. If the system crashes mid-write, the old root is still valid; recovery rolls back nothing.
- **Trivial snapshot isolation.** Each reader pins the root pointer when it starts; subsequent writes don't affect it. MVCC without explicit version chains.
- **No WAL needed for the tree itself.** The structure is its own log.

### Drawback: write amplification

Inserting one record forces a rewrite of the entire root-to-leaf path. For a tree of height 4, one insert allocates 4 new pages. Plus, **no garbage collection mid-transaction**: dead pages from the old version can only be reclaimed after no reader is using them.

### Single-writer model

Because the design relies on root-swap atomicity, **only one writer at a time**. This is fine for many workloads (Git, LMDB, bbolt), bad for high-throughput OLTP. Multi-writer COW variants exist but are complex.

### Production systems

- **LMDB** (Lightning Memory-Mapped Database): single-file, mmap'd, COW B+ tree. Used by OpenLDAP, Monero, many embedded apps.
- **bbolt** (Bolt fork in Go): COW B+ tree, single-file, single-writer. Used by etcd, Consul, many Go embedded apps.
- **Btrfs**: COW B+ tree at the file-system level.
- **ZFS**: COW Merkle B+ tree.

### Code sketch

```go
type Snapshot struct {
    root *Node            // immutable
}

func (db *DB) update(fn func(tx *Tx)) error {
    db.writeLock.Lock()              // single writer
    defer db.writeLock.Unlock()
    tx := newWriteTx(db.snapshot)    // starts from current root
    fn(tx)
    newSnapshot := tx.commit()       // allocates new path, swaps root atomically
    db.snapshot = newSnapshot
    return nil
}

func (db *DB) view(fn func(tx *Tx)) {
    snap := db.snapshot              // single atomic read
    tx := newReadTx(snap)
    fn(tx)                           // reads from immutable snapshot
}
```

Notice how readers (`view`) need **no locks** beyond the single atomic load of the snapshot pointer.

---

<a name="fractal"></a>
## 4. Fractal Trees and Bε-Trees (TokuDB)

In a classic B+ tree, an insert eventually requires a leaf-page rewrite. On a 16 KB leaf with 64-byte records, that's writing 16 KB to disk for one 64-byte change — a **256× write amplification**.

**Bε-trees** (B-epsilon trees), commercially known as **fractal trees** by TokuTek (now part of Percona TokuDB), reduce write amplification by **buffering writes inside internal nodes**.

### The idea

Each internal node has, in addition to keys and child pointers, a **message buffer** holding pending insert/delete operations. When you insert, the operation is written into the root's message buffer (one log-ish write, very cheap). When the root buffer overflows, its messages are **flushed** to the appropriate child's buffer. When a child's buffer overflows, it flushes one level deeper. Messages reach a leaf only when many have accumulated.

```
                  root [routing keys | msg buf: insert(45), delete(72), ... ]
                 /    \
            [routing keys | msg buf]    [routing keys | msg buf]
            ...
            leaves
```

### Why this saves writes

Instead of one disk write per insert, a leaf is rewritten only when **B** messages have accumulated for it (where B is leaf capacity). Amortized, each insert costs `O(log_B(n) / B)` page writes — for fanout 100, that's about 30× fewer writes than a classic B+ tree.

### Theoretical complexity

The "ε" comes from the analysis: a Bε-tree with internal-node buffer fraction ε ∈ (0, 1) has:
- Point lookup: `O(log_{B^ε}(n)) = O((1/ε) log_B(n))` I/Os
- Insert (amortized): `O((log_B(n)) / B^{1-ε})` I/Os

For ε = 1/2, insert cost is `O((log_B n) / √B)` — roughly the geometric mean of LSM-tree insert cost and B-tree lookup cost. The "fractal" in the name refers to this self-similar buffer structure.

### Used by

- **TokuDB / TokuMX** (Percona): high-write-throughput storage engine for MySQL / MongoDB.
- **BetrFS**: a Linux file system using Bε-trees as the on-disk index.
- Some modern HBase-alternative key-value engines.

### Trade-off vs LSM trees

LSM trees (LevelDB, RocksDB) also reduce write amplification by buffering. Bε-trees offer better range scan performance (still a B+ tree at heart) while LSM trees offer simpler implementation. Modern systems mix and match: WiredTiger uses a B+ tree with LSM-like compaction phases.

---

<a name="compression"></a>
## 5. Prefix Compression and Suffix Truncation

A B+ tree page is fixed size (e.g., 8 KB). The number of keys per page determines fanout, which determines tree height. Anything that fits more keys per page is a direct win.

### 5.1 Prefix compression

Adjacent keys in a sorted leaf often share **long common prefixes**:

```
2026-05-29T10:31:42.001
2026-05-29T10:31:42.002
2026-05-29T10:31:42.003
...
```

Instead of storing each timestamp in full, the page stores a prefix once and the deltas per key:

```
prefix: "2026-05-29T10:31:42.0"
keys: ["01", "02", "03", ...]
```

For sorted timestamps or UUID-suffixed keys this saves 80–95% of leaf space. PostgreSQL nbtree added prefix compression in **PostgreSQL 13** (2020); fanout improved measurably on indexes over timestamp columns.

### 5.2 Suffix truncation

A routing key in an **internal node** does not need to be a full leaf key. It only needs to be **any value that separates** the right subtree's smallest key from the left subtree's largest key. So we can **truncate** the routing key to the shortest discriminating prefix.

Example: left subtree's largest key = `"banana"`, right subtree's smallest key = `"orange"`. The routing key can be the single character `"o"` (or even an empty string, since the first byte alone separates them). The internal node stores `"o"`, saving bytes vs. storing `"orange"` in full.

For long keys (URLs, JSON column values, long strings), suffix truncation **dramatically** increases internal-node fanout — sometimes 10× — which shortens the tree.

Used by: PostgreSQL nbtree (since v12), SQL Server, most modern B+ tree implementations.

### 5.3 Order-preserving compression caveats

Both techniques require that the compressed representation **preserves** order — comparison must still work without decompression. Prefix compression and suffix truncation do this naturally. General-purpose compression (gzip, snappy) does not — you cannot binary-search a gzipped leaf. That's why production B+ trees use structural compression rather than block compression for index pages.

---

<a name="iot"></a>
## 6. Index-Organized Tables (Oracle IOT, InnoDB)

A normal table separates **the heap** (where rows live) from **the indexes** (which point into the heap). A primary-key lookup goes: index → row pointer → heap fetch. Two I/Os.

An **index-organized table (IOT)** eliminates the heap. **The primary-key B+ tree IS the table**. Leaves carry full rows, not pointers.

```
Primary key B+ tree:
   [routing]
   /        \
[leaf: (1, row1) | (2, row2) | (3, row3)] -> [leaf: (4, row4) | ...]
```

Secondary indexes in an IOT carry `(secondary_key, primary_key)` pairs. A secondary lookup goes: secondary index → primary key → walk the primary B+ tree → row. Slower than a heap-based design's "secondary index → row pointer" for non-covering queries.

### Trade-offs

**Pros:**
- Primary-key lookups are one I/O (read the leaf, you have the row).
- Range scans on the primary key are blazingly fast (one descent + leaf chain walk; rows are physically clustered).
- No duplicate storage of primary key (one in heap + one in index).

**Cons:**
- Secondary index lookups need an extra primary-tree traversal.
- Updates to the primary key are expensive (row physically moves).
- Inserts can require leaf splits more often (rows are larger than just keys).
- Tree height is taller (rows take more space per leaf).

### Real systems

- **Oracle IOT**: opt-in per table via `ORGANIZATION INDEX`. Used for narrow, primary-key-heavy tables (lookup tables, dimension tables).
- **MySQL InnoDB**: **all tables are IOTs** by default. The primary key (or a synthetic ROW_ID) clusters the rows in a B+ tree.
- **SQLite WITHOUT ROWID**: opt-in IOT mode.
- **MongoDB WiredTiger**: documents in a B+ tree by document ID.
- **CockroachDB / Spanner**: primary key clustering at the storage layer.

### Why InnoDB chose IOT-by-default

For OLTP workloads dominated by primary-key lookups (e.g., `SELECT * FROM users WHERE id = 42`), saving one I/O per query is huge. The secondary-index cost is a deliberate trade-off. Schema design for InnoDB heavily emphasizes choosing a clustering primary key that matches the dominant query pattern (sequential `BIGINT` IDs, or composite keys like `(tenant_id, created_at)`).

---

<a name="wal"></a>
## 7. WAL Interaction: Crash Safety

A B+ tree update modifies a page in memory. If the system crashes before the dirty page is written to disk, the change is lost. Worse, **a torn write** — where the OS or disk writes only half a page — can corrupt the tree.

The standard solution: **write-ahead log (WAL)**.

### Full-page writes (FPW)

PostgreSQL's strategy: **before** writing a dirty page to disk, write the **entire page image** to the WAL. After a crash, the recovery process replays the WAL, restoring full-page images for any page that might have been torn.

```
Step 1. user issues INSERT
Step 2. dirty index page in shared buffer
Step 3. WAL record: "full-page image of page #123 + redo info for insert"
Step 4. crash safe? yes — recovery can rebuild page from WAL
Step 5. eventually checkpointed: dirty page flushed to disk
```

The cost: **write amplification**. The first modification of a page after a checkpoint writes the full page to WAL — an 8 KB record for a 64-byte change. Postgres mitigates this with longer checkpoint intervals and `wal_compression`.

### MySQL InnoDB: doublewrite buffer

InnoDB writes pages first to a **doublewrite buffer** (a contiguous 2 MB area), then to their actual location. After a crash, recovery checks both locations; a half-torn page in its final location can be restored from the (already-flushed) doublewrite copy. Cleverly avoids full-page logging at the cost of doubled I/O for page writes.

### Delta records

For B+ tree updates, you can log just the **delta** (insert key K with value V into page P at slot S) rather than the full page. This is cheaper but requires the page to be intact pre-redo. Used in conjunction with FPW: FPW once per checkpoint, then delta records.

### MVCC interaction

PostgreSQL's MVCC stores multiple row versions in the heap, but the **index** only needs to know which TIDs (heap addresses) exist for a key. When a row is updated, a new heap tuple is created; the index gets a new (key, new_TID) entry but the old (key, old_TID) entry stays until vacuum. The B+ tree never knows about row versions directly — it just maintains a multi-set of TIDs per key.

This is why **PostgreSQL has HOT updates** (Heap-Only Tuple): if a row update doesn't change indexed columns and the new tuple fits in the same heap page, no index update is needed at all.

---

<a name="bulk"></a>
## 8. Bulk Loading via Sorted Runs

`CREATE INDEX` on a billion-row table cannot insert keys one-by-one — that would be `O(n log n)` insertions, each triggering possible splits. **Bulk loading** assembles the index bottom-up in `O(n log n)` total (for the sort, plus linear for the build).

### The algorithm

1. **Scan** the source table, extracting `(indexed_key, row_TID)` pairs.
2. **Sort** by key using external merge sort (because the data won't fit in RAM).
3. **Build leaves linearly**: pack sorted pairs into leaves at `fillfactor` (e.g., 70%). Link them as you go.
4. **Build internal levels bottom-up**: for each leaf, emit the smallest key + a pointer; group these into internal nodes; repeat for the next level up until one node remains (the root).

### Why this is fast

- No splits, no merges, no rebalancing.
- Sequential I/O throughout (writing leaves left-to-right).
- Internal levels are tiny (`n / b` keys per level, geometric series).

A bulk-loaded 1-billion-row index over an 8-byte integer column, 8 KB pages, fanout 256: about 4 GB of leaves, 16 MB of internal nodes. Total time dominated by the sort, typically minutes on modern hardware.

### Used by

- `CREATE INDEX` in PostgreSQL, MySQL, Oracle, SQL Server.
- `pg_restore` and similar tools.
- Bulk-load APIs in LevelDB / RocksDB (though those are LSM, the principle applies to merging sorted runs).

### Pitfalls

- **Fillfactor matters.** A fully packed index (100% fill) will split on the first insert; pick 70–80% for write-heavy workloads.
- **WAL pressure.** Logging every page during build can saturate WAL. PostgreSQL has `wal_level=minimal` for unlogged bulk loads — faster but breaks streaming replication.
- **Constraint validation.** UNIQUE constraints require a second pass to detect duplicates; some systems pipeline this during the sort.

---

## Cheat Sheet — Variant Selection

```
Variant                  Use when                                     Examples
----------------------   -----------------------------------------    --------------------------
Classic B+ tree          Single-threaded, simple                      Toy / teaching
Lehman-Yao (B-link)      High-concurrency on disk                     PostgreSQL nbtree
Latch-coupling B+ tree   Mixed reads/writes, disk-resident            InnoDB, SQL Server
Optimistic latch coupling  In-memory, very high concurrency           HyPer, Umbra
Bw-tree                  In-memory, lock-free                         SQL Server Hekaton
Copy-on-write B+ tree    Single-writer, snapshot isolation, crash-safe LMDB, bbolt, etcd
Bε-tree / fractal tree   Write-heavy, range queries still needed      TokuDB, BetrFS
Index-organized table    Primary-key-heavy OLTP                       InnoDB (default), Oracle IOT
B+ tree with prefix compression   Sorted timestamps, long keys         Postgres 13+ nbtree
```

---

## Further Reading

- **Lehman, P. L. & Yao, S. B.** (1981). *Efficient Locking for Concurrent Operations on B-Trees*. ACM TODS. The B-link tree paper. Read it.
- **Graefe, G.** (2011). *Modern B-Tree Techniques*. Foundations and Trends in Databases. Best modern survey; covers prefix compression, fractured indexes, latching protocols, Bε-trees.
- **Levandoski, J. J., Lomet, D. B., Sengupta, S.** (2013). *The Bw-Tree: A B-tree for New Hardware Platforms*. ICDE. The Bw-tree paper.
- **Bender, M. A. et al.** (2007). *An Introduction to Bε-trees and Write-Optimization*. The foundational Bε-tree analysis.
- **Petrov, A.** *Database Internals*, O'Reilly, 2019. Chapters 2–4.
- **PostgreSQL source code**: `src/backend/access/nbtree/README` — narrative of how Lehman-Yao is implemented in production. One of the best learning resources for concurrent B+ trees.
- **LMDB source**: ~10,000 lines of C; entire COW B+ tree fits in `mdb.c`.
- Continue with `senior.md` for the specifics of how each major database uses these techniques.
