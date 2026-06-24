# LSM-Tree Storage Engine (Build-Your-Own)

> Build the write-optimized storage engine that sits under RocksDB, Cassandra,
> and LevelDB — WAL, memtable, SSTables, Bloom filters, compaction — then push
> it past hundreds of millions of keys and *measure* the read/write/space
> amplification you traded for those fast writes. Stop guessing why LSM beats a
> B-tree on writes; prove it against `bbolt`.

| | |
|---|---|
| **Tier** | Staff (database internals) |
| **Primary domain** | Database storage engines |
| **Skills exercised** | LSM-tree design, WAL & crash recovery, SSTable format, skiplists, compaction (size-tiered vs leveled), Bloom filters, block cache, read/write/space amplification, Go (`bbolt`/`badger`/`pebble` for comparison) |
| **Interview sections** | 5 (postgres/storage), 17 (performance), 23 (db selection) |
| **Est. effort** | 5–8 focused days |

---

## 1. Context

You're the engineer who owns the write path for a time-series / event store. The
team is on a B-tree-backed engine (`bbolt`) and random-write ingest has hit a
wall: every insert dirties a random page, fsync amplifies it, and at a few tens
of thousands of writes/s the disk is saturated doing random I/O. Someone says
"just use RocksDB" — but nobody on the team can explain *why* RocksDB ingests
faster, what it costs (space on disk balloons during heavy updates, reads
sometimes touch many files), or when that trade is wrong.

Your job in this project is to **build an LSM-tree key-value engine from scratch
in Go** — memtable, write-ahead log, on-disk SSTables, Bloom filters, and
compaction — load it with **hundreds of millions of keys far larger than RAM**,
and characterize the three amplifications (write, read, space) under sustained
write load with compaction running. Then put it head-to-head with a B-tree
engine and explain, with numbers, exactly where each one wins.

You will produce a working engine and a findings note with curves, not opinions.

## 2. Goals / Non-goals

**Goals**
- Implement the full LSM write path: **WAL → memtable (skiplist) → flush to an
  immutable SSTable**, with the memtable swapped to a read-only "immutable" state
  during flush so writes never block on disk.
- Implement an on-disk **SSTable format** (sorted data blocks + sparse index +
  Bloom filter + footer) and a read path that goes memtable → SSTables
  newest-first, using Bloom filters to skip files that can't contain the key.
- Implement **both compaction strategies** — size-tiered and leveled — behind one
  interface, and measure the write/space/read-amplification trade-off between
  them.
- Implement **tombstones** for deletes, and prove space is actually reclaimed
  once a tombstone outlives all older versions of the key.
- Implement **crash recovery**: replay the WAL on startup and prove `Get` returns
  every acknowledged write after a `kill -9` mid-load.
- **Quantify** write-amp, read-amp, and space-amp under a sustained write load,
  and compare write throughput and read latency against `bbolt` (B-tree).

**Non-goals**
- A full SQL layer, transactions across keys, or MVCC snapshots beyond a single
  sequence number per write (a stretch goal, not the baseline).
- Distributed replication or sharding — this is a **single-node** engine. (The
  distributed story lives in `staff/03` and `staff/07`.)
- Beating RocksDB on absolute throughput. You're building to *understand*, and to
  measure the same trade-offs RocksDB makes — not to ship a competitor.
- Pluggable comparators / column families. One key space, bytewise ordering.

## 3. Functional requirements

1. A **`DB`** type exposing `Put(key, val)`, `Get(key) → (val, found)`,
   `Delete(key)`, and `Scan(start, end) → iterator` (ordered, merging memtable +
   all SSTables). See §8.
2. **Durability:** `Put`/`Delete` append to the WAL and fsync (or group-commit
   batch fsync) **before** acknowledging. A crash after ack must not lose the
   write.
3. **Memtable flush:** when the active memtable exceeds a size threshold (e.g.
   64 MB), it becomes immutable, a new active memtable + new WAL segment are
   created, and the immutable memtable is flushed to a new L0 SSTable in the
   background. Foreground writes do not stall on a healthy flush.
4. **SSTable on disk:** sorted data blocks (~4 KB), a sparse block index, a
   per-SSTable Bloom filter, and a footer with offsets + a magic number.
   Self-describing and re-openable.
5. **Compaction:** a background compactor merges SSTables per the chosen strategy
   (`size-tiered` | `leveled`, selectable by config), drops shadowed/obsolete
   versions and collectable tombstones, and updates the **manifest** atomically.
6. **Block cache:** an LRU cache of decoded data blocks, sized by config, sitting
   in front of SSTable block reads.
7. **Crash recovery:** on open, read the manifest to find live SSTables, then
   replay any un-flushed WAL segments into a fresh memtable. The engine is
   correct after an arbitrary `kill -9`.
8. A **`cmd/load`** harness drives configurable write/read mixes at a target rate
   over a key space far larger than RAM, and a **`cmd/chaos`** can `kill -9` the
   process mid-load for recovery tests.

## 4. Load & data profile

- **Volume:** ingest **≥ 200 million keys** in a single sustained run; total
  on-disk dataset **≥ 50 GB** so it is **far larger than RAM** (cap the box or
  the process at, e.g., 8 GB so reads *must* hit SSTables on disk).
- **Key/value size:** 16-byte keys, 100–256 B values (report the exact pair).
  Test one small-value and one fat-value (1 KB) profile.
- **Key distribution:** two workloads, both deterministic from a seed —
  - **uniform random** keys (worst case for read locality and Bloom benefit), and
  - **Zipfian** (s≈1.0) hot-key updates so the *same* keys are rewritten many
    times — this is what creates space amplification and exercises compaction.
- **Update/delete mix:** at least one run with **≥ 50% overwrites** of existing
  keys and **10% deletes**, so obsolete versions and tombstones accumulate and
  must be reclaimed.
- **Traffic model:** open-model writer (fixed offered rate, not "as fast as
  compaction drains") so you can *observe a write stall* when compaction falls
  behind. State the model.

## 5. Non-functional requirements / SLOs

| Metric | Target |
|--------|--------|
| Sustained write throughput (16 B key, 100 B val, WAL fsync on) | Find & report the ceiling; justify it (WAL fsync? memtable insert? flush back-pressure?) and compare to `bbolt` on the **same** random-write load |
| `Get` p99, **warm** block cache, key present | < 1 ms |
| `Get` p99, **cold** cache, key on disk (must read 1 block + maybe index) | < 10 ms; report block reads/op |
| `Get` for an **absent** key | Mostly served from Bloom filters with **0 disk reads**; report false-positive rate vs configured bits/key |
| **Write amplification** (bytes written to disk ÷ bytes of user data) | Measured per compaction strategy; size-tiered should be **lower** write-amp, leveled **lower** read/space-amp — show the numbers |
| **Read amplification** (SSTables/blocks touched per `Get`) | Measured with and without Bloom filters; bounded under leveled compaction |
| **Space amplification** (bytes on disk ÷ bytes of live data) | Measured under the overwrite-heavy run; show compaction **reclaiming** it back toward ~1.1× |
| Crash recovery | After `kill -9` mid-load, **every acknowledged write is present** and the DB re-opens cleanly |
| Write stall under compaction debt | Measured: when L0 file count / compaction backlog crosses a threshold, report the foreground write-rate drop |

> The point is not a magic throughput number — it's to **find** your engine's
> ceiling, **name** the three amplifications, and **prove** how each compaction
> strategy moves them.

## 6. Architecture constraints & guidance

- **Language:** Go. Pure-Go, no cgo. Use the standard library for I/O; a
  hand-rolled skiplist for the memtable is encouraged (you'll cite it in
  interviews).
- **Reference engines to compare against, not vendor:** `etcd-io/bbolt` (B-tree,
  the write-amp foil), and read the source of `dgraph-io/badger` and
  `cockroachdb/pebble` (Go LSM engines) for SSTable/manifest/compaction design
  decisions. You are reimplementing their ideas, not importing them.
- **One writer goroutine** owns the WAL + active memtable; flush and compaction
  run on **background goroutines**. Reads are lock-light over an immutable
  *version* (the set of live SSTables) swapped atomically on each
  flush/compaction.
- **Manifest is the source of truth** for which SSTables are live and at what
  level. Edits to it must be atomic (append a versioned edit + fsync, or
  write-new-then-rename) so a crash mid-compaction never corrupts the LSM shape.
- **Instrument everything** with Prometheus: write throughput, WAL fsync latency,
  memtable size, flush/compaction rate, bytes-written-to-disk counter (for
  write-amp), live-vs-on-disk bytes (space-amp), SSTables-touched-per-Get and
  Bloom-filter-rejections (read-amp), block-cache hit ratio, `Get` p50/p99/p999.

## 7. Data model

### WAL (write-ahead log)
```
record:  [ crc32 (4B) | type (1B) | seq (8B) | klen (varint) | vlen (varint) | key | value ]
         type ∈ { PUT, DELETE }    DELETE carries an empty value (tombstone marker)
         one WAL segment per memtable; segment is deleted only after its memtable's
         SSTable is durably in the manifest. Group-commit: batch records, one fsync.
```

### Memtable (in-RAM, mutable)
```
skiplist keyed by (user_key ASC, seq DESC)  → value | tombstone
size-tracked; at threshold → frozen to "immutable memtable", flushed to L0.
```

### SSTable (on-disk, immutable, sorted)
```
┌──────────────── data blocks (~4 KB each) ────────────────┐
│  [ entry: shared/unshared key prefix | vlen | seq | val ] │  (prefix-compressed, sorted)
├──────────────── meta ─────────────────────────────────────┤
│  bloom filter block      (≈10 bits/key → ~1% FP)          │
│  sparse index block      (first key + offset per block)   │
├──────────────── footer (fixed size) ─────────────────────┤
│  index offset | bloom offset | min/max key | magic (8B)   │
└───────────────────────────────────────────────────────────┘
```

### Manifest (the LSM shape, source of truth)
```
versioned edit log:  add/remove SSTable {file_id, level, min_key, max_key, size}
                     next_file_id, last_sequence
applied atomically; CURRENT pointer names the live manifest. Crash-safe via fsync+rename.
```

## 8. KV API contract

```go
type DB interface {
    Put(key, val []byte) error          // WAL append + fsync, then memtable insert
    Get(key []byte) (val []byte, found bool, err error)  // memtable → L0..Ln newest-first; Bloom-gated
    Delete(key []byte) error            // writes a tombstone (a PUT of a delete marker)
    Scan(start, end []byte) (Iterator, error)  // merged, ordered; hides shadowed & tombstoned keys
    Close() error                       // flush memtable, sync, write manifest
}
```

- **Read precedence:** newest wins. Memtable first, then immutable memtable, then
  L0 (newest→oldest, may overlap), then L1..Ln (non-overlapping → binary search).
  A tombstone seen before any older value means **not found**.
- **Bloom gate:** before reading any SSTable's blocks, check its Bloom filter;
  skip the file on a negative. Report the false-positive rate.
- **`Scan`** is a k-way merge iterator over the memtable + every live SSTable,
  surfacing only the newest version per key and dropping tombstoned keys.

## 9. Key technical challenges

- **Compaction is the whole game.** Size-tiered merges similarly-sized runs
  (low write-amp, but high space-amp and high read-amp because many overlapping
  runs persist); leveled keeps non-overlapping sorted runs per level (low
  read/space-amp, but high write-amp because data is rewritten every level). You
  must implement both and **show the trade-off on real curves** — this is the
  core staff-level artifact.
- **The three amplifications pull against each other.** You cannot minimize
  write, read, *and* space at once (the RUM conjecture). Pick a target SLO and
  defend which amplification you sacrificed.
- **Tombstone reclamation.** A delete writes a marker, not a deletion. The space
  is only freed when compaction merges the tombstone past the **oldest** SSTable
  that could hold the key. Get this wrong and deletes either resurrect data or
  never reclaim space. Prove on-disk bytes actually drop.
- **Write stalls / back-pressure.** If the offered write rate exceeds what flush
  + compaction can absorb, L0 files pile up, read-amp explodes, and you must
  **throttle the writer** (or accept unbounded read latency). Measure where the
  stall kicks in and how RocksDB-style slowdown triggers behave.
- **Crash safety at every boundary.** WAL fsync before ack; manifest edit atomic
  before deleting a compacted input; a half-written SSTable must be invisible.
  One missed fsync = a lost or corrupt key after `kill -9`.
- **Bloom sizing.** Bits/key trades RAM for fewer disk reads on absent keys. Pick
  a number, predict the FP rate, then measure it.

## 10. Experiments to run (break it / tune it)

Record before/after numbers for each:

1. **Write throughput vs B-tree.** Same random-write load (uniform keys) into
   your LSM vs `bbolt`. Report writes/s, disk write bytes, and CPU. Explain *why*
   LSM wins (sequential WAL + batched flush vs random page dirtying + fsync).
2. **Bloom-filter win.** `Get` of **absent** keys, with Bloom filters on vs off.
   Report disk reads/op and p99 for each, plus the measured false-positive rate
   vs the configured bits/key (e.g. 10 bits → ~1%).
3. **Compaction strategy bake-off.** Size-tiered vs leveled on the *same*
   overwrite-heavy workload. Plot **write-amp, space-amp, and `Get` p99** for
   each. Name which one you'd pick for a write-heavy vs read-heavy SLO and why.
4. **Space amplification under heavy updates.** Run the Zipfian overwrite +
   delete workload; chart on-disk bytes vs live bytes over time. Show compaction
   **reclaiming** space (tombstones + obsolete versions dropped) back toward
   ~1.1×.
5. **Cold vs warm block cache.** `Get` p99 immediately after open (cold) vs after
   the working set is cached (warm). Report block-cache hit ratio and the
   crossover.
6. **Crash recovery correctness.** During a sustained write run, `kill -9` the
   process. On restart, prove **every acknowledged write is present** (diff the
   ack log against post-recovery `Get`s) and report WAL-replay time.
7. **Write stall.** Drive the writer above the compaction drain rate. Find the
   point where L0 piles up, capture the read-amp spike and the foreground
   write-rate drop, and decide your throttle policy.
8. **Bits/key sweep.** Bloom at 4 / 10 / 16 bits/key — RAM cost vs measured FP
   rate vs absent-key `Get` p99. Find the knee.

## 11. Milestones

1. WAL + skiplist memtable + recovery; `Put`/`Get`/`Delete` in memory, durable
   across restart. Prove the WAL replays.
2. SSTable writer/reader (blocks + sparse index + footer) + memtable flush to L0;
   `Get` falls through to disk. Manifest tracks live files.
3. Bloom filters + block cache; experiments 2 and 5.
4. Size-tiered compaction, then leveled behind the same interface; experiment 3.
5. Tombstone reclamation + space-amp run (experiment 4); write-stall hunt
   (experiment 7); B-tree bake-off (experiment 1); chaos recovery (experiment 6).
6. Findings note: the three amplification curves + the LSM-vs-B-tree verdict.

## 12. Acceptance criteria (definition of done)

- [ ] ≥ 200M-key, ≥ 50 GB run on a RAM-capped box, with `Get`s served from disk
      (prove the dataset exceeds RAM and reads hit SSTables).
- [ ] Write-throughput number reported **with the bottleneck named and proven**
      (pprof / `iostat` / fsync-latency evidence), and beating `bbolt` on random
      writes with an explained mechanism.
- [ ] Write-amp, read-amp, and space-amp each **measured** and plotted, for **both**
      compaction strategies, on the same workload.
- [ ] Bloom-filter on/off curve: absent-key `Get` shows **0 disk reads** on a
      negative, with the measured FP rate matching the configured bits/key.
- [ ] Space-amp chart shows compaction **reclaiming** space under overwrite+delete.
- [ ] After `kill -9` mid-load, `counted == acknowledged`: **every** acked write
      is present post-recovery (show the diff).
- [ ] Every number is reproducible from a committed command + config + seed.

## 13. Stretch goals

- **Leveled with overlap-aware key-range picking** (LevelDB-style: compact the
  L0→L1 file whose key range overlaps fewest L1 files). Measure the write-amp win.
- **MVCC snapshots:** keep a read sequence number; `Get`/`Scan` at a snapshot,
  and hold a tombstone/old-version until the oldest snapshot passes it.
- **Tiered + leveled hybrid** (RocksDB universal-ish) and where it sits on the
  amplification triangle.
- **Compression** (snappy/zstd) per data block; chart space-amp and `Get` CPU.
- **Prefix Bloom / partitioned index** for range-scan-heavy workloads.
- Swap your engine in and benchmark against `badger` and `pebble` on the same
  harness — explain every gap.

## 14. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| Write path & durability | WAL + memtable + flush works; survives clean restart | Group-commit fsync; survives arbitrary `kill -9`; explains every crash-safety boundary |
| SSTable & read path | Reads fall through memtable → SSTables correctly | Sparse index + block cache; minimizes blocks/op; explains the read cost |
| Bloom filters | Uses them; sees fewer disk reads | Sizes bits/key to a target FP rate, predicts it, then proves it |
| Compaction | Implements one strategy that keeps the LSM bounded | Implements **both**, quantifies write/read/space-amp for each, picks per SLO |
| **Amplification reasoning** | Knows the three amplifications exist | **Reasons about the trade-off (RUM), proves it on curves, and says when LSM vs B-tree** |
| Space reclamation | Deletes work | Proves tombstones + obsolete versions are reclaimed; on-disk bytes drop |
| Communication | Clear findings note | Could defend the amplification triangle and the B-tree comparison to a staff panel |

> Staff bar in one line: you can stand in front of the three-amplification
> triangle and explain — with your own numbers — why a write-heavy ingest store
> picks an LSM and size-tiered compaction, while a read-heavy, update-light OLTP
> table is better off on a B-tree.

## 15. References

- O'Neil et al., *The Log-Structured Merge-Tree (LSM-Tree)* (1996) — the original.
- *Designing Data-Intensive Applications*, Ch. 3 — "Storage and Retrieval"
  (SSTables, LSM vs B-tree, amplification).
- Athanassoulis et al., *Designing Access Methods: The RUM Conjecture* (read /
  update / memory can't all be minimized) — the trade-off you must defend.
- LevelDB / RocksDB design docs: SSTable format, manifest, leveled compaction,
  write stalls; RocksDB tuning guide on the amplification trade-offs.
- Cassandra docs: size-tiered vs leveled compaction strategies.
- Go engines to read: `etcd-io/bbolt` (B-tree foil), `dgraph-io/badger`,
  `cockroachdb/pebble` (production Go LSM, the closest mirror of this build).
- See also: `Interview Question/05-postgresql-and-sql/` (storage internals,
  index structures), `Interview Question/17-performance-engineering/` (the three
  amplifications, fsync, I/O), and
  `Interview Question/23-database-types-and-selection/` (LSM-vs-B-tree, when to
  pick which engine).
