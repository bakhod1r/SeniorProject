# LSM-Tree — Hands-On Tasks

> All tasks must be solvable in **Go**, **Java**, and **Python**. Reference sketches below are in Python for brevity; Go/Java translations follow the patterns in `junior.md` §12 and `interview.md`. Tasks 1–5 build the core engine; tasks 6–10 add the production accelerators (bloom filter, sparse index, leveled compaction, WAL); tasks 11–15 push to scale, correctness, and benchmarking.

---

## Beginner Tasks

### Task 1 — Memtable + flush + newest-first get

**Goal:** Implement `LSM(flush_at)` with `put(k, v)`, `get(k)`, and an automatic flush of the memtable to an immutable in-memory sorted SSTable when it reaches `flush_at` entries. `get` resolves the memtable then SSTables newest-first.

**Acceptance:**
- After `put("b","1") put("d","2") put("a","3")` with `flush_at=3`, there is exactly one SSTable `[a=3, b=1, d=2]` and the memtable is empty.
- `get` returns the newest value when a key was overwritten across flushes (e.g. `put("d","5")` after a flush → `get("d")=="5"`).
- Each SSTable is sorted; newer SSTables are searched first.

**Hints:**
- Keep SSTables in a list with index 0 = newest (prepend on flush).
- Binary-search inside each SSTable.

**Reference (Python):** See `junior.md` §12.3.

---

### Task 2 — Deletes via tombstones

**Goal:** Add `delete(k)` that inserts a tombstone, and make `get` return "not found" when the newest version of a key is a tombstone.

**Acceptance:**
- `put("b","1")` (flush) then `delete("b")` → `get("b")` is not-found, even though `b=1` still exists in an older SSTable.
- A `delete` on a never-existing key is harmless.

**Hints:**
- Represent a tombstone as a sentinel value (e.g. a unique string or a `None`-wrapper).
- `delete(k)` is just `put(k, TOMBSTONE)`.

**Common bug:** removing the key instead of tombstoning — the deleted value resurrects on the next read.

---

### Task 3 — Compaction (merge all SSTables)

**Goal:** Implement `compact()` that merges all SSTables into one, keeping the newest value per key and dropping tombstones.

**Acceptance:**
- After the §11 trace, `compact()` yields a single SSTable `[a=3, c=4, d=5]` (no `b`, no tombstone, no stale `d=2`).
- Post-compaction `get` results are unchanged for live keys and still not-found for deleted keys.

**Hints:**
- Iterate SSTables oldest→newest into a dict so newer overwrites older; then drop tombstones and sort.
- Verify with an oracle (a plain dict that you apply the same put/delete stream to).

**Reference (Python):** See `junior.md` §12.3 `compact`.

---

### Task 4 — Range scan (k-way merge)

**Goal:** Add `scan(lo, hi)` returning all live `(key, value)` pairs with `lo <= key < hi`, in sorted order, merging across the memtable and all SSTables with newest-wins, suppressing tombstoned keys.

**Acceptance:**
- A key updated in a newer SSTable appears once with its newest value.
- A key deleted (tombstone in a newer source) does **not** appear, even if an older SSTable holds it.
- Output is sorted ascending by key.

**Hints:**
- Build iterators over each source; use a heap keyed by `key`, breaking ties by source recency (newest first).
- When several sources sit on the same key, take the newest entry and advance *all* iterators past that key.

**Common bug:** forgetting that a tombstone must suppress the key, then be filtered from the output.

---

### Task 5 — WAL and crash recovery

**Goal:** Add a write-ahead log: every `put`/`delete` appends to an on-disk (or in-memory list standing in for disk) log *before* updating the memtable. Implement `recover()` that rebuilds the memtable by replaying the WAL.

**Acceptance:**
- Simulate a crash by discarding the in-memory memtable but keeping the WAL; `recover()` reconstructs the exact pre-crash state (verified against an oracle).
- After a flush, the WAL segment covering the flushed memtable is truncated.

**Hints:**
- Order matters: append to WAL → (fsync) → apply to memtable → ack.
- On recovery, replay entries in order; later entries overwrite earlier ones.

**Common bug:** truncating the WAL before the memtable is durably flushed → data loss on crash.

---

## Intermediate Tasks

### Task 6 — Bloom filter per SSTable

**Goal:** Attach a bloom filter to each SSTable. In `get`, consult the filter first; skip the SSTable's block read when the filter says "definitely not present."

**Acceptance:**
- For a key absent from an SSTable, the filter returns "no" (no false negatives), and the SSTable is skipped without a "block read" (count block reads to prove it).
- Measured false-positive rate over many random absent keys is within ~2× of the theoretical `p` for the chosen bits/key.

**Hints:**
- Bits per key ≈ `1.44·log2(1/p)`; `k` hashes ≈ `(m/n)·ln 2`. Use two independent hashes to derive `k` (Kirsch–Mitzenmacher double hashing).
- Instrument a `block_reads` counter to demonstrate the savings.

---

### Task 7 — Sparse index per SSTable

**Goal:** Lay out each SSTable as fixed-size blocks. Build a sparse index (first key + block offset per block). `get` binary-searches the index, reads one block, then searches within it.

**Acceptance:**
- A lookup performs exactly **one** block read (after the bloom check passes), regardless of SSTable size.
- The sparse index size is `O(num_blocks)`, not `O(num_keys)`.

**Hints:**
- Pick a block size in entries (e.g. 4). The index entry for block `j` is `(keys[j*block], j)`.
- Binary-search the index for the largest first-key `<= target`; that's the block to read.

---

### Task 8 — Leveled compaction

**Goal:** Replace flat SSTables with leveled organization: L0 (overlapping), then levels L1, L2, ... each `fanout×` larger with **non-overlapping** key ranges. Flushes go to L0; when a level exceeds its budget, compact its overflow into the next level (newest-wins).

**Acceptance:**
- After many puts, each level ≥1 has non-overlapping SSTable ranges, and a point read probes at most one SSTable per level (plus L0).
- Read amplification (sources probed per get) is bounded by `≈ number_of_levels`, much lower than flat.

**Hints:**
- Model a level ≥1 as one sorted run; cascading overflow merges newer-into-older.
- Verify the non-overlap invariant after each compaction.

**Reference (Python):** See `middle.md` §10.3.

---

### Task 9 — Size-tiered compaction + amplification comparison

**Goal:** Implement size-tiered compaction (merge `T` similarly-sized SSTables into the next tier) alongside the leveled one from Task 8. Instrument **write, read, and space amplification** for both.

**Acceptance:**
- On the same workload, size-tiered shows **lower write amp** and **higher read/space amp** than leveled — reproduce the §2/§12 numbers in `middle.md` qualitatively.
- A summary table prints WA / RA / SA for each strategy.

**Hints:**
- WA = total disk bytes written / user bytes; RA = sources probed per get; SA = stored bytes / live bytes.
- Use the same random put/delete/get stream for both strategies.

---

### Task 10 — Sequence numbers and snapshot reads

**Goal:** Stamp every write with a monotonically increasing sequence number. Store keys as `(user_key, seq)` sorted by `user_key` asc, `seq` desc. Implement `get_as_of(key, snapshot_seq)` returning the newest version with `seq <= snapshot_seq`.

**Acceptance:**
- `get_as_of` reflects only writes up to the snapshot, ignoring newer ones (MVCC).
- Plain `get(key)` equals `get_as_of(key, current_seq)`.

**Hints:**
- "Newest wins" becomes "first entry per `user_key` in the (key asc, seq desc) order whose `seq <= snapshot`."
- A tombstone version still applies if it's the chosen version for that snapshot.

---

## Advanced Tasks

### Task 11 — Concurrent memtable with background flush

**Goal:** Make writes non-blocking during flush: when the active memtable fills, freeze it (move to an immutable queue) and start a fresh active memtable immediately; a background worker flushes frozen memtables. `get` checks active → frozen (newest-first) → SSTables.

**Acceptance:**
- Writes never block on flush (no foreground stall in the common case).
- Reads see a consistent newest-first view across active, frozen, and on-disk sources under concurrent load.
- Stress test with concurrent writers + readers against an oracle (eventually consistent after flushes settle).

**Hints:**
- Go: a skip list or `sync.RWMutex`-guarded map + a channel-fed flush goroutine. Java: `ConcurrentSkipListMap` + an executor. Python: `threading` + a flush thread.
- The immutable-memtable queue must be searched newest-first, between the active memtable and the SSTables.

---

### Task 12 — Rate-limited compaction scheduler with metrics

**Goal:** Run compaction in the background under a token-bucket rate limiter (bytes/sec), triggered when compaction debt (pending bytes) exceeds a threshold. Emit write/read/space amplification and pending-bytes metrics.

**Acceptance:**
- Compaction throughput never exceeds the configured byte rate (measured over a window).
- Under sustained ingest above the compaction rate, `pending_bytes` (debt) rises — demonstrate the leading indicator of a write stall.
- Metrics are queryable at any time.

**Hints:**
- Use the scheduler skeletons in `senior.md` §8.
- Simulate a "write stall": when debt crosses a stop-threshold, block/slow `put`.

---

### Task 13 — Tombstone garbage collection with grace period

**Goal:** Implement correct tombstone GC: drop a tombstone during compaction **only** when the compaction reaches the bottom level (no older copy can survive) **and** a configured grace period (wall-clock or logical) has elapsed.

**Acceptance:**
- A tombstone dropped only at the bottom level + after grace; otherwise retained.
- Construct a scenario where dropping a tombstone too early would resurrect a key, and show your implementation does not.

**Hints:**
- Track each tombstone's creation time/seq; compare against `now - grace` at compaction.
- The bottom-level check: this compaction includes the oldest run that could contain the key.

---

### Task 14 — Persist SSTables to real files

**Goal:** Write SSTables to actual files with the layout from `middle.md` §5 (data blocks, index block, filter block, footer) and per-block CRC checksums. Reopen the database from disk and serve reads; verify checksums on read.

**Acceptance:**
- A database survives process restart: reopen, replay WAL for the un-flushed memtable, and serve correct reads.
- A deliberately corrupted block is detected via checksum on read (and recovered from WAL/another copy if available).

**Hints:**
- Footer stores offsets of index and filter blocks; read it first on open.
- Use a length-prefixed entry encoding; compute and store a CRC per data block.

---

### Task 15 — Benchmark: LSM-tree vs B-tree (or sorted map)

**Goal:** Benchmark your LSM-tree against a B-tree / balanced sorted map (`TreeMap`, `container/list`+, Python `sortedcontainers`) across (a) write-heavy, (b) read-heavy, and (c) delete-heavy workloads, reporting throughput and the three amplifications for the LSM-tree.

> Compare performance across all 3 languages and both structures.

#### Go

```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

func main() {
	sizes := []int{1000, 10000, 100000}
	for _, n := range sizes {
		// build a workload: 70% writes, 25% reads, 5% deletes
		ops := make([]int, n)
		keys := make([]string, n)
		for i := range ops {
			r := rand.Intn(100)
			switch {
			case r < 70:
				ops[i] = 0 // put
			case r < 95:
				ops[i] = 1 // get
			default:
				ops[i] = 2 // delete
			}
			keys[i] = fmt.Sprintf("k%d", rand.Intn(n))
		}
		start := time.Now()
		// runLSMWorkload(ops, keys)   // your LSM-tree
		elapsed := time.Since(start)
		fmt.Printf("n=%7d: %.3f ms\n", n, float64(elapsed.Milliseconds()))
	}
}
```

#### Java

```java
import java.util.*;

public class Benchmark {
    public static void main(String[] args) {
        int[] sizes = {1000, 10000, 100000};
        Random rnd = new Random(42);
        for (int n : sizes) {
            int[] ops = new int[n];
            String[] keys = new String[n];
            for (int i = 0; i < n; i++) {
                int r = rnd.nextInt(100);
                ops[i] = r < 70 ? 0 : (r < 95 ? 1 : 2);   // put / get / delete
                keys[i] = "k" + rnd.nextInt(n);
            }
            long start = System.nanoTime();
            // runLsmWorkload(ops, keys);   // your LSM-tree
            long elapsed = System.nanoTime() - start;
            System.out.printf("n=%7d: %.3f ms%n", n, elapsed / 1_000_000.0);
        }
    }
}
```

#### Python

```python
import random, time

def main():
    for n in (1_000, 10_000, 100_000):
        random.seed(42)
        ops, keys = [], []
        for _ in range(n):
            r = random.randint(0, 99)
            ops.append(0 if r < 70 else (1 if r < 95 else 2))  # put/get/delete
            keys.append(f"k{random.randint(0, n)}")
        start = time.perf_counter()
        # run_lsm_workload(ops, keys)   # your LSM-tree
        elapsed = (time.perf_counter() - start) * 1000
        print(f"n={n:>7}: {elapsed:.3f} ms")

if __name__ == "__main__":
    main()
```

**Acceptance:**
- The LSM-tree out-throughputs the in-place sorted-map structure on the write-heavy workload.
- The read-heavy and delete-heavy results illustrate the read/space-amplification trade-off (LSM slower or larger).
- Report write/read/space amplification for the LSM-tree across all three workloads, and discuss which compaction strategy you would pick for each.
