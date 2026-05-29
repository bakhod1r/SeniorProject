# Jump Search — Senior Level

> **Audience:** Engineers building or maintaining systems where storage access patterns dominate algorithm choice — sorted log files, columnar storage formats, append-only event stores, tape archives, and distributed sorted blob layouts. Prerequisites: `junior.md`, `middle.md`.

This document treats jump search as **infrastructure for asymmetric-access storage**, not a classroom curiosity. We cover where it actually appears in production: sorted log file scans, Parquet / ORC column-block locator structures, Cassandra / HBase SSTable index searches, forward-only sorted streams over the network, append-only event-sourcing time ranges, and the recurring `√n` pattern in tiered storage. We also explain when **binary search wins anyway** even on these systems, so you can make defensible choices.

---

## Table of Contents

1. [Sorted Log File Scans with Block Indexes](#sorted-log)
2. [Columnar Storage Block Locators (Parquet, ORC, ClickHouse)](#columnar)
3. [SSTable Index Blocks (Cassandra, RocksDB, LevelDB)](#sstable)
4. [Forward-Only Sorted Streams in Distributed Systems](#streams)
5. [Append-Only Event Stores and Time-Range Queries](#event-store)
6. [Tiered Storage and the `√n` Pattern](#tiered)

---

<a name="sorted-log"></a>
## 1. Sorted Log File Scans with Block Indexes

Many production systems store time-ordered or ID-ordered records in **sorted append-only files** — exactly the workload where forward seeks are cheap and backward seeks are expensive. The canonical pattern: every `m` records, write a "block header" containing the **first key** in the next block. The result is a sparse index that exactly fits the jump-search model.

### The structure

```
File layout:
[block 0 header: first key = K₀, byte offset = 0]
[block 0 records: K₀, K₁, ..., K_{m-1}]
[block 1 header: first key = K_m, byte offset = ...]
[block 1 records: K_m, K_{m+1}, ..., K_{2m-1}]
...
[block (n/m - 1) header: ...]
[block (n/m - 1) records]
```

To find a record with key `T`:

1. **Jump phase:** read block headers sequentially. Stop at the first block whose first key is `> T`. The target, if present, is in the previous block.
2. **Linear phase:** load that block, scan its records.

### Why this is jump search, not binary search

Reading sequential block headers from a file is **bandwidth-bound**: the OS prefetches the next page, the disk controller streams data at hundreds of MB/s. Binary search on the same structure would require ~`log(n/m)` *random* seeks into the headers, each costing ~50 µs on SSD or ~10 ms on HDD.

For `n = 10⁹` records with `m = 1000` (so 10⁶ blocks):
- **Binary search on headers:** `log₂(10⁶) ≈ 20` random seeks. SSD: 1 ms. HDD: 200 ms.
- **Jump search on headers:** `1000` sequential reads ≈ one streaming read at the start of the file, ~10 ms regardless.

On HDD, jump search wins by 20×. On SSD, binary search wins by 10×. The crossover depends on your storage class.

### Real example: SQLite SQLAR archives

SQLAR (SQLite Archive) stores compressed files in a SQLite database. For huge archives, the table is sorted by filename, and a **sparse index page** maps `filename_prefix → first row offset`. Lookups jump along the sparse index until they find the right block, then linear-scan inside it. Pure jump search.

### Real example: BAM/BCF genomic indexes

BAM files (binary alignment maps, used in genomics) are huge sorted records with a companion **`.bai` index** that lists, every 16 KB, the byte offset of the first record. To find reads overlapping a region:

1. Read the `.bai` index linearly to find the right 16 KB chunk.
2. Seek to that chunk in the BAM file.
3. Linear-scan the chunk for matching reads.

This is jump search, with chunk size 16 KB instead of a literal `√n`. The motivation is **disk-block alignment**, not asymptotic optimality — but the structure is identical.

### Implementation sketch (Python)

```python
import struct

class SortedLogReader:
    """Block-indexed sorted log on disk."""

    def __init__(self, path, block_size):
        self.path = path
        self.m = block_size
        self.headers = self._load_headers()   # [(first_key, byte_offset), ...]

    def _load_headers(self):
        headers = []
        with open(self.path, 'rb') as f:
            while True:
                hdr = f.read(16)
                if len(hdr) < 16:
                    break
                key, offset = struct.unpack('>QQ', hdr)
                headers.append((key, offset))
                # Skip the block body (block_size records, fixed width).
                f.seek(self.m * 16, 1)
        return headers

    def find(self, target):
        # Jump phase: linear scan of headers.
        block = -1
        for i, (k, _) in enumerate(self.headers):
            if k > target:
                break
            block = i
        if block < 0:
            return None

        # Linear phase: load the block, scan it.
        offset = self.headers[block][1]
        with open(self.path, 'rb') as f:
            f.seek(offset)
            data = f.read(self.m * 16)        # one block
        for j in range(self.m):
            k, v = struct.unpack_from('>QQ', data, j * 16)
            if k == target:
                return v
            if k > target:
                return None
        return None
```

The header array is small enough to fit in memory; the body lives on disk. One seek per query (to the block), one streaming read. Vastly cheaper than `log n` seeks for the binary-search alternative on HDD.

---

<a name="columnar"></a>
## 2. Columnar Storage Block Locators (Parquet, ORC, ClickHouse)

**Parquet** and **ORC** are columnar storage formats used pervasively in Hadoop, Spark, AWS Athena, BigQuery, Snowflake. Each file holds many columns, each column is split into row groups, each row group is split into pages (~1 MB each), and each page can be **compressed independently**. To find a value in a sorted column:

1. The file footer holds **row group statistics**: min/max of the sort column in each group.
2. To find a target, linear-scan (or jump-scan) the row-group min/max to find the right group.
3. Inside the row group, **page index** holds per-page min/max.
4. Inside the page, decompress and linear-scan.

This is **multi-level jump search**:

```
n total rows
├── divided into k row groups (k ≈ 100–1000)
    ├── each row group has p pages (p ≈ 100–10,000)
        ├── each page has e elements
```

With `n = 10⁹`, `k = 1000`, `p = 1000`, `e = 1000`:
- Row-group scan: 1000 comparisons (cached metadata).
- Page-index scan: 1000 comparisons (per-group).
- In-page decompress + linear: 1000 comparisons.
- **Total: 3 × √∛(10⁹) ≈ 3000 comparisons**, plus 1 decompress.

A pure binary search over row groups would need `log₂(1000) ≈ 10` comparisons, but the row-group statistics are *sequentially laid out* in memory, so jumping is essentially free.

### Why jump dominates inside Parquet

The row-group statistics are **inline** in the footer. Once loaded, scanning them in order is L1-cache speed. Doing a binary search adds branches; doing a sequential scan with SIMD `_mm_cmpgt_epi32` compares 16 values per cycle. For typical row-group counts (100–10,000), linear/jump scan with SIMD is faster than binary search.

This is the principle behind **predicate pushdown**: the query engine inspects metadata at every level and uses jump-style scans to eliminate row groups and pages before decompressing data. The asymptotic complexity is `O(√n)`, but the constants are tiny because everything is sequential and SIMD-friendly.

### ClickHouse data parts and granules

ClickHouse organizes each table partition into **parts**, each part into **granules** of `index_granularity = 8192` rows. The **primary key index** holds the first row of each granule. To answer `WHERE id = X`:

1. Binary-search the primary key index (small enough to fit in RAM).
2. Read the granule (8192 rows from disk).
3. Linear-scan or vectorize within the granule.

ClickHouse explicitly uses binary search at level 1 because the primary key index is fully in RAM and small. But it switches to **vectorized linear scan** inside the granule because that's faster than further bisection on 8192 rows.

This is a **hybrid**: binary at coarse level + jump-style block scan inside the granule. The hybrid wins when each level has different access characteristics.

### Lesson

Columnar formats use **multi-level block structures**, and the "best" search at each level depends on whether that level is in RAM (binary), is sequentially laid out (jump/SIMD), or requires decompression per access (linear inside the block).

---

<a name="sstable"></a>
## 3. SSTable Index Blocks (Cassandra, RocksDB, LevelDB)

**Sorted-string tables (SSTables)** — used by Cassandra, RocksDB (and through it CockroachDB, TiDB, MyRocks, ScyllaDB), LevelDB, and HBase — store immutable sorted key-value pairs. Each SSTable contains:

- **Data blocks** — sorted (key, value) pairs, typically 4–64 KB each.
- **Index block** — `(first_key, offset)` per data block.
- **Bloom filter** — fast "definitely not present" check.
- **Footer** — pointers to the index.

### The lookup path

```
1. Bloom filter check       → if "no", return immediately (~1 µs).
2. Search the index block   → locate the right data block.
3. Load that data block     → from disk or block cache.
4. Search inside the block  → find the exact (key, value).
```

Step 2 and step 4 can each use binary or jump search. **Which one each engine picks depends on the block size and the in-RAM layout.**

### RocksDB's approach

RocksDB's **block-based table format** stores the index as a sorted array of `(first_key, offset)` pairs. By default, RocksDB uses **binary search** on the index: the index fits in RAM, random access is free, `log n` wins.

But there's a configurable option: **`block_restart_interval`** (default 16). Inside each data block, RocksDB **does not** store every key — it stores every 16th key as a "restart point" and **prefix-compresses** the keys in between. To find a key within a block:

1. **Binary search** the restart points (sorted offsets in the block).
2. **Linear scan** forward from the located restart point through up to 15 prefix-compressed entries.

This is exactly jump search: binary at the coarse level, linear at the fine level, with block size `m = 16`. The motivation isn't `√n` optimality; it's **prefix compression** — you can't randomly access a prefix-compressed key without first decompressing the whole run, so linear scan from a restart point is the only option.

The principle: when **per-element access has nonzero setup cost**, jump-style "find the block, then scan it" is the right structure regardless of `m = √n` analysis.

### Cassandra's approach

Cassandra SSTables historically used a **sparse index**: only every `column_index_size_in_kb` worth of keys gets an index entry. To find a key:

1. **Binary search** the sparse summary (in RAM) to find the right index page.
2. **Linear scan** the index page to find the right data block.
3. **Linear scan** the data block to find the key.

Steps 2 and 3 are jump-style. The sparse summary keeps memory usage `O(√n)` or `O(∛n)` of total keys, and the linear scans within pages exploit sequential disk reads.

### LevelDB's approach

LevelDB uses the same block-based format that RocksDB inherited. Same restart-point binary-then-linear hybrid. The restart interval is configurable; smaller intervals mean more binary-search precision but more index storage.

### The recurring lesson

In LSM-tree storage engines, **binary search picks the block; jump/linear picks the element inside the block**. The reason is always one of:

- Prefix compression (RocksDB / LevelDB).
- Variable-length encoding (most disk formats).
- SIMD-friendly tight loops (modern columnar).
- Page-aligned I/O (one block = one page = one I/O unit).

You will see this pattern *everywhere*. Understanding it is what makes jump search relevant to senior engineers.

---

<a name="streams"></a>
## 4. Forward-Only Sorted Streams in Distributed Systems

Streaming sorted data — from Kafka topics partitioned by key, from S3 byte-range reads of a sorted Parquet file, from a paged gRPC stream — typically does not support random seek backward. You can:

- Read forward from the start (slow).
- Skip forward by a known amount (fast — sequential prefetch).
- Reset to the start (slow).

**Binary search is impossible** in this model: you cannot freely re-seek backward. Jump search (with linear scan inside the located block) is the natural fit.

### Kafka consumer with key-ordered partitions

Imagine a Kafka topic where messages within a partition are guaranteed key-ordered (e.g., via a sort-merge upstream). To find the message with key `K`:

1. Use `seek(offset)` to skip forward by `m` messages.
2. Read one message; check its key.
3. If key < K, repeat; if key ≥ K, you've overshot.
4. Re-seek to the **previous block's start offset** (jumped past during step 1).
5. Read the block linearly to find the exact match.

The trick: between step 1 and step 4, you've made one backward seek — and only by `m` messages. Compare with binary search, which would need `log(n)` arbitrary seeks; in Kafka, each `seek()` triggers an offset commit and can be O(ms). Jump search bounds the backward-seek work to `O(√n)`.

In practice, Kafka workloads rarely sort by message key (they sort by partition key for routing), but key-ordered indexed topics do appear — and jump-style seeks dominate there.

### S3 byte-range reads of sorted Parquet column

When querying a sorted column in a Parquet file on S3:

1. Read the file footer (one HTTP request).
2. Read the row-group statistics linearly (footer is small).
3. Identify the row group containing the target via jump scan.
4. Issue one HTTP byte-range request for that row group.
5. Decompress and scan.

Two HTTP requests total, regardless of `n`. The jump scan in step 3 is in-memory metadata scanning, vanishingly fast.

A naïve binary search over byte-range reads would require `log n` HTTP requests, each ~100 ms. Jump search wins by orders of magnitude here.

### Snowflake micropartitions

Snowflake organizes table data into **micropartitions** (50–500 MB each), each with statistics on the columns. Range and point queries jump-scan the micropartition statistics to prune, then read only the surviving partitions.

This is exactly jump search at the partition level: linear (or jump-style) metadata scan, no per-partition binary search needed because the metadata for hundreds of partitions fits in tens of KB.

### Lesson

Distributed systems that page data over the network nearly always use **jump-style "scan the metadata, then load one block"** patterns. Binary search would multiply the number of network round trips, which is the cost that matters.

---

<a name="event-store"></a>
## 5. Append-Only Event Stores and Time-Range Queries

Event sourcing systems (EventStore, Kafka with `cleanup.policy=compact`, custom append-only logs) store events in **monotonically increasing timestamp** order. The classic query is "give me all events in `[t1, t2]`".

### The naïve approach

Binary search for `t1`, then sequential scan until `t2`. Two binary searches, then sequential read. Standard. Works fine when the event store supports random access.

### The append-only constraint

Many event stores are **strictly append-only on disk**. Each event is encoded with a variable-length header (length-prefix, then payload). You cannot do random access without a separate offset index — and many systems skip building one.

### Sparse offset index = jump search

The common solution: maintain a **sparse offset index** in memory. Every `m` events, record `(timestamp, byte_offset)`. To find time `t`:

1. **Jump scan** the in-memory sparse index for the largest entry with `timestamp ≤ t`. This is `O(√n)` metadata scan or `O(log n)` binary if the index fits in RAM (it usually does — `n/m` entries for `m = 1000` is 1‰ of `n`).
2. **Seek** to that byte offset.
3. **Linear scan forward** through events, comparing timestamps, until you reach `t` or exceed it.

This is jump search where the "block" is `m` events and the **linear scan is unavoidable** because events have variable size — no random access inside the block.

### Real example: Kafka log segments

Kafka stores each partition as a sequence of **log segments** (default 1 GB each). Each segment has a companion **offset index** mapping `message offset → byte position` at every `index.interval.bytes` (default 4 KB) of payload. To find a message by offset:

1. Binary search the segment file list (small, in RAM).
2. Binary search the offset index of that segment (also small).
3. Seek to the located byte position.
4. Linear-scan messages within ~4 KB until the exact offset.

Two binary searches at coarse levels + one linear scan within ~4 KB. The 4 KB linear phase is **deliberately bounded** to be `O(1)` in practice — Kafka chose `index.interval.bytes` so that the linear scan is one page-read at most.

This is the same pattern: bound the linear phase by a constant or by `√n`, and let binary search handle the coarse navigation.

### Real example: Prometheus time-series chunks

Prometheus stores time-series data in **chunks** (~120 samples per chunk). Each block on disk holds many chunks. To answer "give me samples in time range `[t1, t2]`":

1. **Index lookup** finds the block containing the time range (binary search over block metadata).
2. **Linear scan** through chunks within the block, comparing each chunk's `min_time` and `max_time`.
3. **Decompress** the chunks that overlap, linear-scan inside for exact bounds.

Step 2 is jump-style — small enough metadata to scan linearly, no binary search benefit. Step 3 is forced linear because chunk compression is sequential.

### Implementation sketch (Go)

```go
package eventstore

import (
    "encoding/binary"
    "io"
    "os"
)

type SparseEntry struct {
    Timestamp int64
    Offset    int64
}

type EventStore struct {
    path  string
    index []SparseEntry // jump index in RAM
    m     int           // events per block
}

// Find returns the byte offset of the first event with timestamp >= t.
func (s *EventStore) Find(t int64) (int64, error) {
    // Jump scan the in-RAM index (linear scan; index is small).
    var prev SparseEntry
    found := false
    for _, e := range s.index {
        if e.Timestamp > t {
            break
        }
        prev = e
        found = true
    }
    if !found {
        return 0, nil // before first event
    }

    // Seek to prev.Offset, linear scan forward.
    f, err := os.Open(s.path)
    if err != nil {
        return 0, err
    }
    defer f.Close()
    if _, err := f.Seek(prev.Offset, io.SeekStart); err != nil {
        return 0, err
    }
    for i := 0; i < s.m; i++ {
        var ts int64
        var lenBuf [4]byte
        if err := binary.Read(f, binary.BigEndian, &ts); err != nil {
            return 0, err
        }
        if ts >= t {
            // Found the start of the range.
            return prev.Offset, nil
        }
        if _, err := io.ReadFull(f, lenBuf[:]); err != nil {
            return 0, err
        }
        payloadLen := binary.BigEndian.Uint32(lenBuf[:])
        if _, err := f.Seek(int64(payloadLen), io.SeekCurrent); err != nil {
            return 0, err
        }
    }
    return prev.Offset, nil
}
```

The in-RAM index is `O(n/m)`; the on-disk linear scan is `O(m)`. Total `O(n/m + m)`, minimized at `m = √n`.

---

<a name="tiered"></a>
## 6. Tiered Storage and the `√n` Pattern

Tiered storage — RAM cache + SSD + cold object store — exhibits the same access asymmetry that makes jump search relevant. The pattern recurs:

- **Hot tier (RAM)**: per-element access is ~10 ns. Binary search dominates.
- **Warm tier (local SSD)**: per-element access is ~50 µs. Binary search dominates **iff** you have a per-block index; otherwise jump-style block locator.
- **Cold tier (S3 / Glacier)**: per-element access is ~100 ms. Jump-style "find the block, do one fetch" dominates — binary search costs `log n` round trips, jump costs `√n` metadata reads but **one** fetch.

The right structure is almost always:

```
[Hot summary in RAM]  →  binary search to pick a warm-tier block
[Warm-tier blocks]    →  jump/linear scan inside the block, OR fetch from cold
[Cold-tier blobs]     →  fetch one blob, scan
```

Three levels, three different optimal algorithms, all working together. **Jump search is the algorithm of the middle tier.**

### Concrete: AWS S3 + Athena + Parquet

A common analytics stack:

- Footer of each Parquet file lives in S3.
- Athena's coordinator reads the footer (~10 KB) via byte-range GET.
- It **linearly scans** row-group statistics to find candidate row groups.
- It issues one byte-range GET per candidate row group.
- Inside each row group, it decompresses pages and scans.

The metadata scan is jump-style (linear with SIMD). The per-row-group fetch is the "block load". The in-page scan is linear-with-vectorization. Three layers of "scan, locate, fetch, scan".

This is the structure of *every* modern columnar analytics engine. The literal `√n` formula doesn't appear, but the **"narrow + sequential + cached" outer layer and "wide + structured" inner layer** is exactly the jump search architecture.

### Concrete: Cassandra's read path

A read in Cassandra walks through:

1. **Memtable** (RAM, sorted): binary or skip-list search.
2. **Bloom filters** (RAM, per-SSTable): O(1) "definitely not present" check.
3. **Partition index summary** (RAM, sparse): binary search for the right index page.
4. **Partition index** (disk, but cached): one block-aligned read + scan.
5. **Data file** (disk): one block-aligned read + scan.

Layers 3 → 4 → 5 are jump-style: sparse index → page → block. At each transition, you locate by metadata (fast) and load by block (one I/O). Cassandra has tuned the spacing (`index_interval` and `column_index_size_in_kb`) to roughly balance levels, just as the AM-GM derivation suggests.

### The general principle

When storage has **asymmetric access cost** — fast metadata, slow per-byte — the optimal search has a coarse "linear/jump scan of metadata" outer layer and a "load one chunk + scan locally" inner layer. The block size is chosen to balance the two costs, which is the same `n/m + m` calculus that gives `m = √n` in the uniform-access model.

Jump search is the pure-form expression of this principle. Once you internalize it, you see it in every tiered storage system you read about.

---

## Closing Thoughts

Jump search **is not used** as a top-level algorithm on plain in-RAM arrays — binary search wins. But the **architecture** of jump search — coarse scan to locate a block, then linear scan inside the block — is the spine of every tiered storage system, every columnar format, every LSM-tree engine, every append-only event store.

When senior engineers say "binary search beats jump search", they're correct about RAM arrays and wrong about everything else. The correct answer to "which search algorithm should this system use?" is **"binary at the levels where random access is free, jump-style at the levels where each access costs an I/O or a decompression."** That mixed architecture is what powers Cassandra, RocksDB, ClickHouse, Parquet, BigQuery, Snowflake, and every distributed analytics platform.

Master jump search not because you will write a `O(√n)` algorithm on an `int[]`, but because the **block-scan-then-load** pattern is one of the most important architectural ideas in modern data systems.

---

## Further Reading

- **Shneiderman**, "Jump Searching: A Fast Sequential Search Technique" (CACM, 1978) — the original paper.
- **Dean & Ghemawat**, "LevelDB: A Fast Persistent Key-Value Store" (Google, 2011) — block-based SSTable format and restart-point search.
- **Cassandra documentation** — partition index summary and column index, both jump-style structures.
- **Parquet specification** — row group statistics, page index, predicate pushdown.
- **ClickHouse documentation** — primary key index and granule-based data layout.
- **Kafka log segment format** — sparse offset index and byte-position lookup.
- **Prometheus TSDB** — chunk and block index design.
- **Snowflake architecture papers** — micropartition pruning.
- Continue with `professional.md` for the formal `√n` derivation, the lower-bound proof for asymmetric-access search, cache-aware variants, and the connection to van Emde Boas layouts.
