# Mini Message Broker (Kafka-Lite)

> Build a Kafka-like log broker from scratch in Go: a segmented append-only log,
> partitions, consumer groups with offset tracking, and basic leader/follower
> replication. The goal isn't a feature-complete Kafka — it's to *feel*, in code
> you wrote, exactly why a broker hits hundreds of MB/s on commodity disks, and
> exactly what it costs to make those bytes durable.

| | |
|---|---|
| **Tier** | Staff (storage engine / distributed log) |
| **Primary domain** | Storage engines / distributed systems |
| **Skills exercised** | Append-only segmented log, page cache & zero-copy (`sendfile`), sparse offset index (`mmap`), partitions, consumer groups & rebalancing, fsync/durability trade-offs, retention & compaction, ISR replication, crash recovery (CRC/truncate), Go `os`/`syscall` |
| **Interview sections** | 11 (messaging), 13 (distributed systems), 17 (performance) |
| **Est. effort** | 5–8 focused days |

---

## 1. Context

You've benchmarked real Kafka in [`labs/01`](../../labs/01-kafka-throughput-and-exactly-once/)
and watched a 3-broker cluster push enormous throughput at `acks=all`. You know
*that* it's fast. You can quote "sequential I/O, page cache, zero-copy" in an
interview. But when a staff interviewer asks **"walk me through what happens to a
single byte from `Produce` to a follower's disk, and tell me which `syscall`
moves it on the consume path,"** you go fuzzy.

This project closes that gap by making you build the thing. You will write a
broker — call it `broqd` — that stores records in a segmented append-only log on
local disk, partitions a topic for parallelism, lets consumer groups track
offsets and rebalance, and replicates a partition to a follower. Then you push it
to **hundreds of MB/s on a single node**, grow a log to **hundreds of GB across
segments**, deliberately crash it mid-write, and prove it recovers.

This is the **build-it-yourself counterpart** to `labs/01` (which *benchmarks*
real Kafka). Where that lab tunes knobs, this one makes you implement the
mechanism behind every knob. At the end you should be able to hold your numbers
next to Kafka's and explain the gap.

## 2. Goals / Non-goals

**Goals**
- Implement a **segmented append-only log**: an active segment, rolling at a size
  threshold, base-offset-named segment files, with a **sparse offset index** for
  O(log n) seeks.
- Achieve **sequential-write produce** and **zero-copy consume** (`sendfile`), and
  *measure* both against the naive userspace-copy alternative.
- Support **partitions** (independent logs) and **consumer groups** with
  committed offsets and a working **rebalance** when members join/leave.
- Implement the **produce-batching ↔ fsync durability** trade-off as explicit,
  measurable policies (`acks=0/1/all`, `fsync` per-batch vs interval).
- Implement **retention** (time- and size-based segment deletion) and at least a
  prototype of **log compaction** (keep latest value per key).
- Implement **leader/follower replication** with an **ISR-style** acknowledgement
  and measure replication lag.
- Implement **crash recovery**: on startup, scan the active segment, validate
  per-record **CRCs**, and **truncate to the last valid record**.

**Non-goals**
- Re-implementing the Kafka wire protocol byte-for-byte. Design a clean binary
  protocol of your own; interoperability with real Kafka clients is not required.
- A controller/consensus layer for leader election. Configure leader/follower
  **statically** per partition (that's `staff/03` Raft territory — cross-ref, but
  don't build it here).
- Exactly-once / transactions. At-least-once delivery with offset commits is the
  bar (EOS is `labs/01` and `staff/05`).
- Tiered/object storage. Local disk only — the OS mechanics are the lesson.

## 3. Functional requirements

1. A **broker** (`cmd/broqd`) hosts topics. Each topic has N **partitions**; each
   partition is an independent **segmented log** directory on disk.
2. A **producer client** (`cmd/produce`) appends record batches to a
   `(topic, partition)` with a configurable `acks` level and batch size, and gets
   back the **base offset** assigned to the batch.
3. A **consumer client** (`cmd/consume`) fetches records from a `(topic,
   partition)` starting at an offset, using the offset index to seek, and reads
   via the broker's **zero-copy** path.
4. **Consumer groups**: multiple consumers in a group divide a topic's partitions
   among themselves; each owns a disjoint subset. **Committed offsets** are
   persisted (in an internal `__offsets` partition, Kafka-style) and survive
   restart. A member join/leave triggers a **rebalance**.
5. **Retention**: a background task deletes whole segments older than
   `retention.ms` or once total partition size exceeds `retention.bytes`.
6. **Replication**: a partition has one **leader** and ≥1 **follower**; the
   follower fetches from the leader and the leader tracks the **high-watermark**
   (highest offset replicated to the ISR). `acks=all` waits for the ISR.
7. **Recovery**: on startup the broker validates the tail of each active segment
   by CRC and truncates any partial trailing write.

## 4. Load & data profile

- **Throughput target:** sustained **hundreds of MB/s** produce *and* consume on
  a single node (NVMe SSD). State your disk's sequential-write ceiling first
  (`fio`), then chase a meaningful fraction of it.
- **Log size:** grow a single partition to **≥ 200 GB** across rolled segments
  (e.g. 1 GB `segment.bytes` → ≥ 200 segments) so seek, retention, and recovery
  are exercised at real scale — not 3 segments in a unit test.
- **Record size:** test at least two — **256 B** (small events, header-dominated)
  and **4 KB** (fat payload, throughput-dominated). Report both.
- **Partitions:** test **1, 8, 32** partitions to show parallel-consume scaling.
- **Generator:** `cmd/gen` produces deterministic records given a seed; keys are
  **Zipfian** (s≈1.1) over a key space so the compaction experiment has hot keys.
- **Traffic model:** open-model producer (fixed send rate) so consumer lag and
  follower replication lag are observable, not masked by closed-loop coupling.

## 5. Non-functional requirements / SLOs

| Metric | Target |
|--------|--------|
| Sustained produce throughput (4 KB, `acks=1`, `fsync` interval) | ≥ **300 MB/s** single node; report % of measured `fio` sequential-write ceiling and name the bound |
| Sustained consume throughput (4 KB, zero-copy `sendfile`) | ≥ **500 MB/s** from page cache; ≥ **1.5×** the userspace-copy path on identical data |
| Produce p99 latency (`acks=1`, batched) | < **10 ms** at 80% of throughput ceiling |
| Durability (`acks=all`, `fsync` per-batch) | Acknowledged records survive `kill -9` + power-loss simulation; **zero acknowledged loss** |
| Offset-seek time (200 GB log, random offset) | < **5 ms** via sparse index (not a full scan) |
| Replication lag (follower, steady state below ceiling) | Bounded and flat; report follower offset gap vs leader high-watermark |
| Recovery time after `kill -9` mid-write | Bounded; truncates to last valid CRC'd record; **no corrupt record served** |

> The point isn't to beat Kafka. It's to **find your broker's ceiling, name what
> bounds it (disk bandwidth? page-cache eviction? CRC CPU? fsync stalls?), and
> prove it.**

## 6. Architecture constraints & guidance

- **Single Go binary** for the broker; producer/consumer as separate binaries so
  you can scale and kill them independently. Run the follower as a second `broqd`
  process on a different port/data-dir.
- **Disk-first design.** Records are written to the active segment file via
  buffered `os.File` appends; offsets are physical positions you control. Do not
  hide the storage behind an embedded KV — *you* manage the bytes.
- **Page cache is your cache.** Do not build a userspace read cache for the hot
  path; lean on the OS page cache and `sendfile` so you experience why Kafka
  does. (Measure `vmtouch`/`/proc/meminfo` to see the cache working.)
- **`sendfile(2)`** for the consume path: in Go, `net.TCPConn.ReadFrom` over an
  `*os.File` triggers `sendfile` on Linux; verify with `strace -e sendfile`.
- **`mmap(2)`** for the sparse offset index: memory-map the small `.index` file so
  binary-search lookups don't `read()` syscall per probe.
- **`fsync(2)`** is the durability primitive: expose it as a policy, never assume
  it. Know that a plain `write()` only reaches the page cache, not the platter.
- Instrument with Prometheus: produce/consume MB/s and records/s, fsync count &
  duration, segment count, active-segment size, follower lag, p50/p99/p999
  produce/fetch latency, page-cache hit behavior.
- Pin the kernel/filesystem in your findings — `fsync` and `sendfile` behavior
  varies (ext4 vs xfs, SSD vs the page cache).

## 7. Data model (segments, index, offsets)

A partition is a directory; the log is a sequence of **segment** file pairs named
by their **base offset** (zero-padded), Kafka-style:

```
data/events-0/
  00000000000000000000.log     # records [0 .. 17404)            (rolled segment)
  00000000000000000000.index   # sparse: relative-offset → file position
  00000000000000017404.log     # records [17404 .. 35012)        (rolled segment)
  00000000000000017404.index
  00000000000000035012.log     # records [35012 .. )             active until rolled
  00000000000000035012.index
  ...
  leader-epoch-checkpoint      # (stretch) leader epoch → start offset
```

**Record (on-disk, length-prefixed, CRC-guarded):**

```
record = | length: uint32 | crc32c: uint32 | attrs: uint8 |
           | timestamp: int64 | key_len: int32 | key | value_len: int32 | value |
```

- `length` lets the recovery scan walk record-by-record and stop cleanly at a
  partial tail.
- `crc32c` (Castagnoli, hardware-accelerated) covers everything after it; a CRC
  mismatch on the trailing record ⇒ partial write ⇒ **truncate here**.
- The **offset** is *not* stored per record — it's implicit: `base_offset +
  records-before-it`. This is why Kafka offsets are dense integers and seeks are
  arithmetic.

**Sparse offset index (`.index`, `mmap`'d):**

```
index_entry = | relative_offset: uint32 | file_position: uint32 |   // 8 bytes, fixed
```

- One entry every `index.interval.bytes` (e.g. 4 KB) of log — *sparse*, so the
  index for a 1 GB segment is ~2 MB and lives in memory.
- **Seek to offset X:** binary-search the index for the largest entry ≤ X to get a
  nearby file position, then **scan forward** a few records to the exact offset.
  O(log n) + a short bounded scan, never a full segment read.

**Committed offsets:** stored as records in an internal compacted partition
`__offsets-*`, keyed by `(group, topic, partition)` → `committed_offset`. Latest
value per key wins after compaction — exactly why Kafka uses a *compacted* topic
for this.

## 8. Interface contract (produce / consume / commit)

A simple length-prefixed binary protocol over TCP (define request/response
structs; one frame = `| len: uint32 | type: uint8 | payload |`).

```
Produce(topic, partition, acks, []record) -> { base_offset, log_append_time }
    acks=0   broker doesn't wait (fire-and-forget)
    acks=1   leader appended to its log (page cache), maybe not fsync'd
    acks=all leader + full ISR appended; respected fsync policy

Fetch(topic, partition, fetch_offset, max_bytes) -> stream of record bytes
    served via sendfile from the segment file; returns high_watermark so a
    consumer never reads past committed/replicated data

JoinGroup(group, member_id, topics) -> { generation, assignment[] }
LeaveGroup(group, member_id)        -> triggers rebalance, bumps generation
Heartbeat(group, member_id, generation) -> ok | rebalance_in_progress
CommitOffset(group, topic, partition, offset) -> ok   // appended to __offsets
FetchOffset(group, topic, partition)          -> committed_offset
```

Client/broker config via flags/env: `-acks`, `-batch-bytes`, `-linger`,
`-fsync` (`none|interval:Nms|each`), `-segment-bytes`, `-index-interval`,
`-retention-ms`, `-retention-bytes`, `-partitions`, `-replication`.

## 9. Key technical challenges

- **Zero-copy consume.** A naive consumer does `read()` segment → user buffer →
  `write()` socket: four copies and two crossings. `sendfile` keeps the bytes in
  kernel space (page cache → socket buffer) — zero user copies. Getting Go to
  actually take the `sendfile` path (and proving it with `strace`) is the
  challenge, and the throughput delta is the payoff. The catch: `sendfile` can't
  transform bytes, so any per-record framing/transformation forfeits it — design
  the on-disk format so the consumer can ship raw segment ranges.
- **Crash recovery correctness.** A `write()` that returns success is only in the
  page cache; a `kill -9` (or power loss) can leave a half-written trailing
  record. Recovery must scan from the last index checkpoint, validate each
  record's length+CRC, and **truncate** at the first invalid byte — without ever
  serving a torn record or losing an `fsync`'d one. Test it by killing mid-append
  and asserting `committed ⊆ surviving ⊆ attempted`.
- **The fsync ↔ throughput cliff.** `fsync` per batch makes every produce wait on
  the disk's IOPS, collapsing throughput; `fsync` on an interval risks losing the
  last interval on crash. This is the durability knee — quantify it, don't
  hand-wave it.
- **Replication & the high-watermark.** The follower fetches like a consumer; the
  leader advances the high-watermark only when the ISR has the record, and
  consumers must never read past it (or a leader failover could "un-commit" data
  they saw). Tracking the HWM and the ISR membership correctly is the distributed
  core.
- **Rebalancing without chaos.** When a consumer joins/leaves, partitions must be
  reassigned with no two consumers owning the same partition at once (double
  processing) and no partition orphaned. Measure the stop-the-world pause.

## 10. Experiments to run (break it / tune it)

Record before/after numbers (throughput MB/s & records/s, p50/p99/p999, fsync
count/duration, CPU, page-cache state) for each:

1. **Batch size × fsync policy sweep.** `batch-bytes ∈ {4K, 64K, 1M}` ×
   `fsync ∈ {none, interval:100ms, each}`. Plot produce throughput vs durability.
   Find the **knee** where per-batch fsync collapses throughput, and quantify the
   loss window of interval-fsync.
2. **Sequential vs random write.** Append to the active segment (sequential) vs a
   variant that seeks to a random offset before each write. Show the order-of-
   magnitude gap on the *same* disk — this is the whole reason a log is a log.
3. **Zero-copy vs userspace-copy consume.** Same data, same client: `sendfile`
   path vs a `read()`-into-buffer-then-`write()` path. Confirm `sendfile` via
   `strace`; report the throughput and CPU delta (target ≥ 1.5×).
4. **Partition count vs parallel consume.** 1 → 8 → 32 partitions, one consumer
   per partition in a group. Find where added partitions stop helping (disk
   bandwidth saturates) and where coordination overhead starts hurting.
5. **Segment roll & retention under load.** Run a sustained produce that rolls
   segments while a retention task deletes old ones. Prove no consumer reading an
   old offset crashes or reads a deleted segment; report segment churn rate.
6. **Compaction.** With Zipfian keys, run log compaction and show the log shrinks
   to ~unique-key size while the latest value per key is preserved. Report
   read/write amplification of the compaction pass.
7. **Replication lag.** Drive produce above and below the follower's fetch
   throughput; plot follower offset gap vs leader high-watermark. Kill the
   follower, restart it, measure catch-up time.
8. **Crash mid-write recovery.** `kill -9` the broker during a heavy append.
   Restart, run recovery, and prove: every `acks=all`/fsync'd record survived, no
   torn record is served, and the truncation point is the last valid CRC. Repeat
   ~50× to build confidence.
9. **Compare to real Kafka.** Run the equivalent produce/consume workload against
   the `labs/01` Kafka cluster on the same hardware. Put the numbers side by side
   and **explain the gap** (Kafka's batching, its mmap'd index, its segment sizes,
   replication factor).

## 11. Milestones

1. Single-partition segmented log: append, roll at `segment.bytes`, base-offset
   naming, sparse index, `Fetch` by offset via index seek. First throughput run.
2. Zero-copy consume (`sendfile`) + the userspace-copy baseline; experiments 2–3.
3. Partitions + consumer groups + offset commit in `__offsets`; rebalance on
   join/leave; experiment 4.
4. fsync policies + retention + compaction; experiments 1, 5, 6.
5. Leader/follower replication, high-watermark, `acks=all` over ISR; experiment 7.
6. Crash recovery (CRC + truncate); experiment 8. Kafka comparison (experiment 9)
   + findings note.

## 12. Acceptance criteria (definition of done)

- [ ] A single partition grows to **≥ 200 GB** across rolled segments; a random
      offset seek returns in **< 5 ms** via the sparse index (show the trace).
- [ ] Sustained produce throughput reported **with the bottleneck named and
      proven** (`fio` ceiling, `iostat`, pprof, or fsync-stall evidence).
- [ ] Zero-copy consume is **≥ 1.5×** the userspace path on identical data, with
      `strace` proof that `sendfile` is actually used.
- [ ] Batch × fsync knee curve plotted; the interval-fsync loss window quantified.
- [ ] Consumer group: a join/leave triggers a clean rebalance with **no double
      ownership** of a partition; committed offsets survive consumer restart.
- [ ] Retention deletes old segments under load with **no reader error**;
      compaction shrinks a Zipfian log to ~unique-key size.
- [ ] Replication: follower stays within a bounded lag; `acks=all` waits for the
      ISR; follower catch-up time after restart reported.
- [ ] After **`kill -9` mid-write**, recovery truncates to the last valid CRC'd
      record; every `acks=all` record survives; **no corrupt record is served**
      (50-run soak).
- [ ] A side-by-side Kafka comparison (experiment 9) with the gap **explained**.
- [ ] Every number is reproducible from a committed command + config.

## 13. Stretch goals

- **Leader epochs** + a proper truncation protocol so a returning follower that
  diverged truncates correctly (the Kafka KIP-101 problem).
- **Tiered storage**: offload sealed segments to object storage and fetch on
  demand; measure cold-read latency.
- **Idempotent producer**: producer ID + sequence number to dedup retried batches
  (the first half of Kafka EOS).
- **Quotas/backpressure**: throttle a producer that outruns replication so the ISR
  never falls behind unboundedly.
- **Group coordinator as a Raft group** — bolt this onto `staff/03` for real
  leader election instead of static config.

## 14. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| Log/storage design | Append-only log that rolls segments and seeks by index | Explains *why* sequential I/O + page cache + dense offsets give the throughput; designs the on-disk format so `sendfile` is possible |
| Throughput analysis | Reports a produce/consume ceiling | Names and **proves** the bound (disk bandwidth vs fsync vs CRC CPU vs page-cache eviction); knows the next bottleneck |
| Durability trade-offs | Shows fsync affects latency | Quantifies the fsync/throughput knee; recommends an `acks`/fsync setting for a stated SLO and loss tolerance |
| Zero-copy | Knows `sendfile` avoids copies | Implements it, proves it with `strace`, measures the delta, and explains what design constraints zero-copy imposes |
| Recovery | Detects corruption on startup | CRC+truncate is provably correct under `kill -9`; articulates `committed ⊆ surviving` and never serves a torn record |
| Replication | Follower copies the leader's log | Tracks the high-watermark/ISR correctly; explains why consumers can't read past the HWM and what a failover would un-commit |
| Communication | Clear findings note | Side-by-sides own numbers with real Kafka and defends every gap to a staff panel |

## 15. References

- *Designing Data-Intensive Applications* — Ch. 3 (log-structured storage),
  Ch. 11 (stream processing, message brokers, the log abstraction).
- Kafka docs: log internals, the index, `segment.bytes`, retention & compaction,
  replication & ISR, the high-watermark. Jay Kreps, *"The Log."*
- Linux `man` pages: `sendfile(2)`, `mmap(2)`, `fsync(2)`, `pwrite(2)`,
  `fallocate(2)`. Go `os`/`syscall`, `net.TCPConn.ReadFrom` (sendfile path),
  `golang.org/x/sys/unix`, `hash/crc32` (Castagnoli/`crc32c`).
- **Build-vs-benchmark counterpart:** [`labs/01-kafka-throughput-and-exactly-once`](../../labs/01-kafka-throughput-and-exactly-once/)
  — benchmark *real* Kafka, then compare your broker's numbers and design to it
  (experiment 9). See also [`staff/08-lsm-tree-storage-engine`](../08-lsm-tree-storage-engine/)
  for the read-optimized storage counterpart, and [`staff/03-raft-metadata-kv-store`](../03-raft-metadata-kv-store/)
  for the consensus layer this project deliberately omits.
- Matching theory: [`Interview Question/11-messaging-and-event-streaming/`](../../Interview%20Question/11-messaging-and-event-streaming/)
  and [`Interview Question/17-performance-engineering/`](../../Interview%20Question/17-performance-engineering/).
