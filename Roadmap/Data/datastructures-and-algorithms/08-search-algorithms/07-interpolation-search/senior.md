# Interpolation Search — Senior Level

> **Audience:** Engineers building or maintaining production systems where interpolation search is the underlying primitive — SSTable block indexes, scientific time-series, sequential-ID databases, network packet sequence lookups, and learned index structures. Prerequisites: `junior.md`, `middle.md`.

This document treats interpolation search as **infrastructure**, not as a coding-interview puzzle. We cover where it actually lives in production: inside RocksDB and LevelDB SSTable block indexes, inside Prometheus and InfluxDB time-window resolution, inside TCP sequence-number tracking for reordered packets, inside PostgreSQL B-tree page-probe heuristics with histogram statistics, and the modern descendant — **learned index structures** — that treat interpolation as a special case of a trained position-prediction model.

---

## Table of Contents

1. [SSTable Block Index Lookups (LevelDB / RocksDB)](#sstable)
2. [Time-Series Database Point Queries](#timeseries)
3. [Network Packet Sequence-Number Tracking](#packets)
4. [PostgreSQL Histogram-Aware Probes](#postgres)
5. [Learned Index Structures — Interpolation Generalized](#learned)
6. [When Interpolation Beats Binary in Production](#vs-binary)

---

<a name="sstable"></a>
## 1. SSTable Block Index Lookups (LevelDB / RocksDB)

**Sorted-string tables (SSTables)** are the on-disk storage format of LevelDB, RocksDB, Cassandra, ScyllaDB, ClickHouse parts, HBase, and the WiredTiger engine in MongoDB. They are immutable, sorted-by-key files designed for read-heavy workloads.

### SSTable structure recap

An SSTable consists of:
1. **Data blocks** — sorted (key, value) pairs, typically 4–64 KB each (default 4 KB in LevelDB).
2. **Index block** — for each data block, the **first key** and the **byte offset**. The index is itself sorted.
3. **Bloom filter** — fast "definitely not present" check.
4. **Footer** — pointers to the index and metadata.

### Where interpolation fits

The **index block** is the natural target for interpolation search:
- It's small (often < 1 MB even for huge SSTables).
- Its keys are often roughly uniformly distributed (especially when keys are hashes or sequence numbers).
- Each probe is essentially free (in-memory after the first load).

**LevelDB's block-index search (simplified):**

```cpp
// Block::Iter::Seek — the interpolation-style probe in LevelDB's
// internal block reader (paraphrased and simplified).
// Real source: leveldb/table/block.cc
Status Block::Iter::Seek(const Slice& target) {
    uint32_t left = 0, right = num_restarts_ - 1;
    while (left < right) {
        // For uniform-ish restart keys, an interpolation step here can
        // skip closer to the target. The production code uses binary
        // search by default, but workloads with regular key distributions
        // benefit from an interpolation hint.
        uint32_t mid = (left + right + 1) / 2;
        uint32_t region_offset = GetRestartPoint(mid);
        // ... parse key at region_offset, compare to target ...
        if (key_at_mid < target) left = mid;
        else                     right = mid - 1;
    }
    // ...
}
```

The real LevelDB uses pure binary search by default for **portability** (keys can be arbitrary user-defined comparators). But forks targeting specific workloads — **HBase's KeyValueIndex** (for monotonic timestamp keys) and **ScyllaDB's partition-index lookups** (for hashed keys) — use interpolation-style heuristics where the workload guarantees uniformity.

### Where the win comes from

A typical SSTable in a high-QPS database serves millions of point lookups per second. Each lookup descends through:
1. **Bloom filter check** — ~50 ns.
2. **Index block search** — binary: ~200 ns; interpolation: ~80 ns.
3. **Data block search** (after one disk I/O if not cached) — binary: ~500 ns; interpolation: ~150 ns.

For a 1 MB index block with 250 restart points, interpolation reduces ~8 probes to ~3 probes. Aggregated across millions of queries per second, that's a meaningful CPU saving.

### Caveat: when LevelDB-style stores avoid interpolation

LevelDB's keys are arbitrary user bytes. Comparators can do anything (case-insensitive sort, reversed timestamps, composite keys with type prefixes). Interpolation requires a meaningful numeric distance — impossible on arbitrary bytes. So the default is binary.

When you **own the key format** and can guarantee uniformity (e.g., a single-table-per-database design where keys are auto-incrementing IDs), you can swap in interpolation at the application layer or build a custom storage engine. This is what **ClickHouse's MergeTree** does for primary key indexes on numeric columns.

---

<a name="timeseries"></a>
## 2. Time-Series Database Point Queries

Time-series databases (TSDBs) — Prometheus, InfluxDB, TimescaleDB, VictoriaMetrics — store millions of samples per second, each timestamped. Point queries ("value at time T") and range queries ("values in [T1, T2]") are the fundamental operations.

### The structural insight

In a TSDB chunk that covers ~2 hours with one sample per 15 seconds, you have **480 samples**. Their timestamps are **uniformly spaced** (sampling is regular). This is the ideal case for interpolation search.

For a query like "value at timestamp T":
- **Binary search**: 9 probes.
- **Interpolation**: ~2 probes.

For a query like "values in [T1, T2]" with 1,000 matching samples:
- Both algorithms find the endpoints; the bulk cost is the linear scan between them.
- Interpolation saves ~14 probes total (7 per endpoint) — negligible vs the 1,000-sample scan.

### Prometheus implementation

Prometheus's `tsdb` package stores chunks of compressed samples. To find a sample at time `t`:

```go
// Simplified from prometheus/tsdb/chunkenc/xor.go
func (it *xorIterator) Seek(t int64) bool {
    if it.numTotal == 0 {
        return false
    }
    // The real Prometheus uses linear scan inside a small chunk because
    // chunks are small (~120 samples). For larger chunks, interpolation
    // would dominate. The InfluxDB engine uses interpolation explicitly
    // for its TSM index.
    for it.Next() {
        if it.At() >= t {
            return true
        }
    }
    return false
}
```

Prometheus uses **linear scan within a chunk** because chunks are deliberately tiny (~120 samples). For coarser indexes (which chunk covers which time range), it uses **interpolation** on the chunk meta-index because chunk start times are nearly uniformly spaced.

### InfluxDB's TSM file index

InfluxDB stores data in **TSM (Time-Structured Merge tree)** files, similar to SSTables but with explicit time-key ordering. Each file has an index of (series_key, min_time, max_time, offset). To answer "value at time T for series S":

1. **Hash lookup** for series S.
2. **Interpolation search** on the (min_time, max_time) ranges to find the right TSM file. Time ranges are nearly uniform across files due to write patterns.
3. **Interpolation search inside** the chosen file's block index, where blocks are uniformly time-spaced.
4. **Linear scan** within the block (only ~1000 samples).

The chain of interpolation searches takes the lookup from ~30 probes (binary throughout) to ~6 probes (interpolation throughout). On the I/O-dominated cost, that's not a huge win — but on the CPU side it relieves the tightest hot loop.

### TimescaleDB chunk routing

TimescaleDB stores data in **chunks** keyed by time range. For a query at time T:

1. **Range-table lookup**: which chunks overlap T?
2. PostgreSQL's planner uses the chunk's `range_start` / `range_end` columns, which are **uniformly spaced** when chunks are time-bucketed (default).
3. The planner internally invokes a range-based interpolation to pick the chunk.

This is **not** documented as "interpolation search" in TimescaleDB's source, but the effect is identical: the dimension-slice metadata is laid out for uniform-distribution lookups.

---

<a name="packets"></a>
## 3. Network Packet Sequence-Number Tracking

TCP packet sequence numbers are **monotonically increasing 32-bit integers** (with wraparound). When packets arrive out of order, the receiver must determine where a packet fits in the reassembly buffer.

### The lookup problem

A receiver buffers up to ~64 KB of out-of-order packets, holding maybe 50 (seq, length) tuples sorted by seq. When a new packet with sequence `S` arrives:
- Is `S` already buffered (duplicate)?
- Where does `S` belong in the sorted buffer?

This is a sorted-array search problem. The buffer is **small** (~50 entries) and the sequence numbers are **highly uniform** — successive packets differ by ~1500 bytes (Ethernet MTU) reliably.

### Implementation in real stacks

Linux's TCP reassembly queue (`tcp_data_queue_ofo` in `net/ipv4/tcp_input.c`) uses an **RB-tree** (`struct rb_root tcp_ofoq`) for the out-of-order queue. The RB-tree gives O(log n) inserts and lookups regardless of distribution.

**FreeBSD** historically used a linked list, scanning linearly — fast for small queues but quadratic on large ones.

**No major kernel uses interpolation search** for sequence-number lookups, primarily because:
1. The queue is too small (n < 100) to justify interpolation's overhead.
2. The worst case (packets sorted but with one massive gap) violates uniformity.

### Where it does appear: high-rate UDP reassembly

In user-space packet processors handling 10M+ packets per second (DPDK pipelines, QUIC-over-UDP receivers, IPFIX collectors), some implementations switch to **interpolation search** on sequence-number indexes:

```c
// QUIC packet reordering buffer (simplified)
// Each entry: (packet_number, ack_time)
// Packet numbers are strictly increasing in QUIC; never reused.
int find_packet(struct pkt_entry *buf, size_t n, uint64_t pn) {
    if (n == 0) return -1;
    size_t lo = 0, hi = n - 1;
    while (lo <= hi && pn >= buf[lo].pn && pn <= buf[hi].pn) {
        if (buf[lo].pn == buf[hi].pn) {
            return buf[lo].pn == pn ? (int)lo : -1;
        }
        // Interpolate: QUIC packet numbers are sequential, ideal case.
        size_t pos = lo + (size_t)((pn - buf[lo].pn) * (hi - lo)
                                 / (buf[hi].pn - buf[lo].pn));
        if (pos > hi) pos = hi;
        if (buf[pos].pn == pn) return (int)pos;
        if (buf[pos].pn < pn) lo = pos + 1;
        else                  hi = pos - 1;
    }
    return -1;
}
```

The combination of **strictly sequential numbers** and **high lookup rate** (one per packet) makes interpolation worthwhile. The arithmetic per probe is amortized against ~10× fewer probes.

### Why not always interpolation here?

When the network is heavily lossy, queue gaps grow non-uniformly. The "interpolation" assumption breaks. Production code defaults to **hybrid** with a binary fallback after 2–3 probes, exactly as in the database case.

---

<a name="postgres"></a>
## 4. PostgreSQL Histogram-Aware Probes

PostgreSQL's query planner uses **histograms** of column values to estimate selectivity and choose plans. These histograms are sorted arrays of bucket boundaries — exactly the kind of data interpolation search excels at.

### The histogram structure

For a column `event_time`, PostgreSQL keeps in `pg_statistic`:
- `histogram_bounds`: an array of ~100 equally-frequent bucket boundaries. By construction, each bucket holds 1% of the data.
- `most_common_vals`: a list of the most frequent values.
- `correlation`: how sorted the column is physically.

To estimate the number of rows matching `WHERE event_time < '2025-06-15'`, PostgreSQL needs to find where `'2025-06-15'` lies in `histogram_bounds`. This is a sorted-array search.

### How PostgreSQL does it today

Look at `src/backend/utils/adt/selfuncs.c`, function `histogram_selectivity`:

```c
// Paraphrased PostgreSQL selectivity estimator
double histogram_selectivity(Datum constval, Datum *hist_values, int hist_nvalues) {
    int lobound = 0, hibound = hist_nvalues - 1;
    while (lobound < hibound) {
        int mid = (lobound + hibound) / 2;
        // Binary search the histogram for constval.
        if (DatumGetBool(FunctionCall2(opproc, hist_values[mid], constval)))
            lobound = mid + 1;
        else
            hibound = mid;
    }
    // ... interpolate selectivity within the resulting bucket ...
    return (double)lobound / hist_nvalues;
}
```

**Currently binary**, because histograms are small (100 entries) — interpolation overhead would dominate. But within the **chosen bucket**, PostgreSQL does linear **interpolation on the value distance**:

```c
// In the same function, after locating the bucket:
double bucket_low_dist  = convert_to_scalar(constval) - convert_to_scalar(hist_values[lo]);
double bucket_size_dist = convert_to_scalar(hist_values[hi]) - convert_to_scalar(hist_values[lo]);
double frac_inside      = bucket_low_dist / bucket_size_dist;
double selectivity      = (lobound + frac_inside) / hist_nvalues;
```

This is **linear interpolation inside the bucket** — exactly the formula at the heart of interpolation search, used for **selectivity estimation** rather than position lookup. The intellectual lineage is direct: same formula, different purpose.

### Where pure interpolation search lives in PostgreSQL

Inside the **BRIN (Block Range Index)**: each block range stores a min/max for the indexed column. For a query, PostgreSQL must find the right range. Some BRIN extensions (`pg_visibility`, `pg_bloom`) provide **interpolated range-finders** for large block-range arrays where binary search would be wasteful.

It also appears in **timestamp-based partition pruning** — `pg_partman` and TimescaleDB use interpolation-style lookups on the dimension-slice metadata.

---

<a name="learned"></a>
## 5. Learned Index Structures — Interpolation Generalized

In 2018, Kraska et al. (Google) published **"The Case for Learned Index Structures"**, which formalized interpolation search as a special case of a more general idea: **train a model to predict the position of a key, then refine with local search**.

### The paper's insight

A B-tree is a model: "given key K, predict the leaf page where K lives." A trained neural network can do the same — and on uniform data, it does it **with smaller storage and fewer cache misses** than the B-tree.

The pipeline:
1. **Train**: fit a model `f(key) -> predicted_index` on the sorted data.
2. **Query**: compute `pred = f(key)`. The true position is within `±err` of `pred` (training error bound).
3. **Local search**: binary or linear search within `[pred - err, pred + err]`.

### Why interpolation is a special case

If you fit a **degree-1 polynomial** (i.e., a straight line) to the (key, index) pairs, the model is exactly:

```
predicted_index = lo + ((key - arr[lo]) / (arr[hi] - arr[lo])) * (hi - lo)
```

That **is** the interpolation search formula. The "training" is one-time computation of `(arr[lo], arr[hi])`. The "error bound" is the worst-case interpolation error over the dataset.

A learned index generalizes this by:
- Using a **higher-degree polynomial** (quadratic, cubic) for curved data.
- Using a **two-level model** (RMI = recursive model index): a top-level model predicts which leaf model to use, then the leaf model predicts the position.
- Using a **neural network** for non-monotonic or multi-dimensional keys.

### Production status of learned indexes

- **Google internal**: used in Spanner and BigTable for certain partition-routing decisions (per published descriptions; details remain internal).
- **Open-source**: ALEX (Microsoft, 2020) — an adaptive learned index supporting inserts. PGM-index — a piecewise geometric model with provable error bounds.
- **DBMS prototypes**: research integrations into MySQL and PostgreSQL exist but are not in mainline as of 2026.

### The lesson for senior engineers

Interpolation search is the **simplest learned index** — a one-line model. When you understand it deeply, the leap to learned indexes is small: replace the linear model with a fitted polynomial or neural net, replace the binary fallback with a tighter bounded search.

If your workload has a known stable distribution and you need every ounce of lookup performance, **learned indexes are the natural progression** from interpolation search. For most workloads, interpolation (or hybrid) is already enough.

---

<a name="vs-binary"></a>
## 6. When Interpolation Beats Binary in Production

The textbook says interpolation is O(log log n), binary is O(log n), so interpolation wins. **Reality is more nuanced.** Here are scenarios where interpolation actually wins in production:

### 6.1 Large, uniform numeric indexes

Time-series chunk indexes, packet sequence buffers, SSTable index blocks with hashed keys, sequential ID partition maps. The combination of *large* (10⁴–10⁶ entries), *numeric*, and *uniform* makes interpolation 3–5× faster than binary.

### 6.2 Disk-resident data with high probe latency

When each probe costs a disk seek (~100 µs), fewer probes is dramatically better. Even on a 10⁶-entry on-disk sorted file, binary is 20 probes (2 ms) and interpolation is 5 probes (0.5 ms). The 4× difference is felt by the user.

This is why MaxMind's GeoIP2 database, which is essentially a sorted-by-IP-range lookup table, uses an **interpolation-like binary search tree layout** internally — IP addresses are roughly uniform in their high bits.

### 6.3 Hot-path lookups in scientific simulation

Climate models, fluid dynamics, lookup-driven physics — these often involve millions of lookups per simulated second into pre-computed tables (water density vs temperature, atmospheric pressure vs altitude, NIST property tables). The tables are **deliberately uniform** (sampled at regular intervals). Interpolation is standard.

NumPy's `numpy.interp` is *technically* doing interpolation **of the value**, not the index, but the underlying lookup uses a similar binary-search-with-interpolation-hint approach for performance.

### 6.4 In-memory caches with sorted keys

A **sorted-array cache** of numeric keys (e.g., a price-by-product-id table updated nightly) is read constantly during the day. Interpolation halves CPU on every read.

### 6.5 When the binary search worst case is itself a problem

Some systems batch lookups (e.g., a search index processing 10,000 queries against a single sorted array per batch). On uniform data, interpolation's lower average means lower **batch latency** and lower **CPU usage per batch**, both of which matter for cost.

### Summary table

| Workload | Best choice |
|---|---|
| Sorted numeric data, uniform, < 1000 entries | Binary (interpolation overhead dominates) |
| Sorted numeric data, uniform, > 10,000 entries | **Hybrid interpolation+binary** |
| Sorted numeric data, skewed distribution | Binary search |
| Sorted strings, structs, opaque keys | Binary search (interpolation N/A) |
| Disk-resident sorted file, uniform keys | **Hybrid interpolation+binary** |
| Time-series chunk index | **Hybrid interpolation** |
| Database B-tree page navigation | Binary (keys can be arbitrary) |
| In-memory hash table | Hash (interpolation N/A) |
| Sequential packet sequence numbers | **Interpolation** with bounded fallback |
| Real-time / regulated systems | Binary (must guarantee worst case) |
| Massive datasets with known distribution | **Learned index** (RMI/ALEX/PGM) |

### When interpolation is the wrong tool

- **Real-time audio buffers** with strict 1-ms processing budgets — O(n) worst case is unacceptable.
- **Brake/safety controllers** in cars — same reason.
- **High-frequency trading order books** — orders cluster around mid-price, distribution is heavily non-uniform.
- **B-tree internal nodes** of general-purpose databases — keys can be anything.

### The senior takeaway

Interpolation search is not "fast binary search". It's a **specialized technique** that, applied to the right workload, gives 3–10× speedup, and applied to the wrong workload, gives 10–1000× slowdown. The decision is workload-driven, not language- or framework-driven.

Whenever you reach for interpolation search in production:
1. **Verify the distribution is uniform** (or measure it).
2. **Use the hybrid pattern** with binary fallback.
3. **Benchmark on realistic data**, not synthetic uniform.
4. **Document the assumption** so future maintainers know why interpolation was chosen.

---

## Closing Thoughts

Interpolation search is what binary search aspires to be on the right data: fewer probes, lower latency, lower CPU. It is the algorithm hidden inside time-series engines, sequence-number trackers, scientific lookup tables, and the conceptual ancestor of learned index structures. Used carelessly, it is a footgun — pathological inputs are common and the worst case is O(n).

The senior-level takeaway: **always pair interpolation with a fallback.** Pure interpolation belongs in textbooks. Hybrid interpolation belongs in production. And when the workload truly demands it, look at learned indexes as the next step — the same idea, generalized.

---

## Further Reading

- **Peterson**, "Addressing for Random-Access Storage" (1957) — the original idea.
- **Perl, Itai, Avni**, "Interpolation Search — A Log Log N Search" (CACM, 1978) — the average-case proof.
- **Kraska et al.**, "The Case for Learned Index Structures" (SIGMOD 2018) — interpolation generalized via ML.
- **Ferragina & Vinciguerra**, "The PGM-index: a fully-dynamic compressed learned index with provable worst-case bounds" (VLDB 2020).
- **Ding et al.**, "ALEX: An Updatable Adaptive Learned Index" (SIGMOD 2020).
- **LevelDB source**, `table/block.cc` — production block index search.
- **InfluxDB TSM design doc** — `docs/tsm.md` in the open-source repo.
- **PostgreSQL source**, `src/backend/utils/adt/selfuncs.c` — histogram-based selectivity with interpolation.
- Continue with `professional.md` for the formal complexity analysis and the O(log log n) proof.
