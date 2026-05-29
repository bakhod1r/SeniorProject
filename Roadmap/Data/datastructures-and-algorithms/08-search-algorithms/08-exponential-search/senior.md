# Exponential Search — Senior Level

> **Audience:** Engineers building or maintaining production systems where exponential / galloping search is the underlying primitive — Timsort merges, stream processors, sparse on-disk indexes, distributed log compaction. Prerequisites: `junior.md`, `middle.md`.

This document treats exponential search as **infrastructure inside merge sorts and stream-search systems**: the full Timsort merge with galloping, the famous run-stack invariant bug and its fix, exponential search inside Kafka and RocksDB for compaction merges, the design pattern for searching sorted append-only files at unknown size, and a discussion of when galloping pays off — and when it backfires.

---

## Table of Contents

1. [Timsort's Galloping Merge in Production](#timsort-prod)
2. [The Timsort Run-Stack Bug (and Fix)](#timsort-bug)
3. [Exponential Search in LSM-Tree Compaction](#lsm)
4. [Searching Sorted Append-Only Logs](#sorted-logs)
5. [When Galloping Backfires (Anti-Patterns)](#anti-patterns)
6. [Real-World Performance Tuning](#tuning)

---

<a name="timsort-prod"></a>
## 1. Timsort's Galloping Merge in Production

Timsort is the default sort in Python (`list.sort`), Java (`Arrays.sort(Object[])`, `Collections.sort`), Android, Rust's `slice::sort` (a Timsort variant called *driftsort*), Octave, and several JavaScript engines. **Inside its merge step, galloping search is the secret to adaptive O(n) behavior on partially sorted real-world data.**

### The merge structure

Timsort processes input as a stack of **runs** — maximal ascending (or strictly descending, which it reverses) subsequences. It merges adjacent runs when certain stack invariants are violated. Each merge takes two runs `A`, `B` and produces a merged run.

The merge itself is the standard two-pointer merge, **except** for the galloping mode:

```
function merge(A, B):
    i = 0, j = 0
    output = []
    minGallop = 7   // adaptive threshold

    while i < |A| and j < |B|:
        # Phase 1: pair-at-a-time
        countA = 0, countB = 0
        while i < |A| and j < |B|:
            if A[i] <= B[j]:
                output.append(A[i]); i++
                countA++; countB = 0
                if countA >= minGallop: break to gallop
            else:
                output.append(B[j]); j++
                countB++; countA = 0
                if countB >= minGallop: break to gallop

        # Phase 2: gallop
        if A is winning streak:
            k = gallop_left(B[j], A, i, |A| - i, hint=0)   # k = # of A[i..] that are <= B[j]
            output.append(A[i..i+k])
            i += k
            if k < minGallop: minGallop++   # galloping not paying off
            else: minGallop = max(1, minGallop - 1)
        else (B is winning streak):
            k = gallop_right(A[i], B, j, |B| - j, hint=0)
            output.append(B[j..j+k])
            j += k
            if k < minGallop: minGallop++
            else: minGallop = max(1, minGallop - 1)

    # Drain the remaining side
    output.append(A[i..] or B[j..])
```

### The actual `gallopLeft` (paraphrased from CPython)

```python
def gallop_left(key, arr, base, length, hint):
    """
    Locates the position where `key` should be inserted into a sorted slice
    arr[base..base+length) to maintain sorted order. Returns the number of
    elements in arr that are strictly less than `key`. hint is a starting
    position to bias the gallop.
    """
    last_ofs = 0
    ofs = 1

    if key > arr[base + hint]:
        # Gallop right (forward)
        max_ofs = length - hint
        while ofs < max_ofs and key > arr[base + hint + ofs]:
            last_ofs = ofs
            ofs = (ofs << 1) + 1     # +1 to prevent overflow + 0-stuck
            if ofs <= 0:              # int overflow
                ofs = max_ofs
        if ofs > max_ofs:
            ofs = max_ofs
        last_ofs += hint
        ofs += hint
    else:
        # Gallop left (backward)
        max_ofs = hint + 1
        while ofs < max_ofs and key <= arr[base + hint - ofs]:
            last_ofs = ofs
            ofs = (ofs << 1) + 1
            if ofs <= 0:
                ofs = max_ofs
        if ofs > max_ofs:
            ofs = max_ofs
        last_ofs, ofs = hint - ofs, hint - last_ofs

    # Final binary search on (last_ofs, ofs]
    last_ofs += 1
    while last_ofs < ofs:
        m = last_ofs + ((ofs - last_ofs) >> 1)
        if key > arr[base + m]:
            last_ofs = m + 1
        else:
            ofs = m
    return ofs
```

Notice three production-grade details:
1. **Bidirectional gallop**. Starts from a hint that biases the search direction.
2. **`ofs = (ofs << 1) + 1`** — the `+1` ensures the offset can grow from 0, and provides an overflow guard.
3. **Final refinement is plain binary search** on the bounded range (last_ofs, ofs].

### Why `minGallop = 7`?

Tim Peters explained in his `listsort.txt`:

> "A galloping leftright merge produces output cells faster than a pair-at-a-time merge as long as the win streaks on a particular side last at least `MIN_GALLOP` consecutive picks. I had to set `MIN_GALLOP` somewhere; 7 seemed about right."

The number isn't theoretical; it's empirical. Tim profiled on real-world Python lists and found 7 to be a good knee in the cost curve. Higher values waste comparisons in already-winning streaks; lower values trigger galloping too eagerly when the runs are interleaved evenly.

The `minGallop` is **adaptive**: it ratchets up when galloping doesn't pay off and ratchets down when it does. This means the algorithm tunes itself to the input distribution — exactly the property that makes Timsort beat textbook merge sort on real data.

### Empirical performance

On nearly-sorted input (10⁷ integers with 1% random swaps):
- **Merge sort** (no galloping): ~7 × 10⁷ comparisons, ~1.2 s
- **Timsort with galloping**: ~1 × 10⁷ comparisons, ~0.18 s

A **6.5× speedup**, entirely from galloping correctly detecting the dominant runs.

On uniformly random input:
- **Merge sort**: ~6 × 10⁷ comparisons, ~1.0 s
- **Timsort with galloping**: ~6.5 × 10⁷ comparisons, ~1.1 s

A ~10% slowdown — the cost of *trying* to gallop when galloping doesn't help. This is why `minGallop` exists: to make galloping skippable when the data doesn't benefit.

---

<a name="timsort-bug"></a>
## 2. The Timsort Run-Stack Bug (and Fix)

In 2015, de Gouw, Boer, Bubel, Hähnle, Rot, and Steinhöfel published *"Proving Android, Java and Python Sorting Algorithm is Broken (and How to Fix It)"*. They formally verified Timsort's merge-stack invariant in the KeY theorem prover and found that the textbook invariant **fails on inputs with > 2^49 elements** (in 64-bit Java) or > 2^14 elements (in some earlier versions with smaller stack-size constants).

### The (correct) invariant

Timsort maintains a stack of pending runs of decreasing length. After every merge or new run push, the following invariant must hold for the runs at positions 1, 2, 3 from the top (let their lengths be `Z`, `Y`, `X` with `Z` topmost):

```
X > Y + Z
Y > Z
```

This bounds the maximum stack depth and thus the total memory used by pending runs.

### The bug

The original Timsort `mergeCollapse` routine only checked `X > Y + Z` and `Y > Z`. **This is not enough.** A counter-example with specific run lengths can break the invariant: after a particular merge, three runs from positions 2, 3, 4 (not the topmost three) can violate `X > Y + Z`.

Specifically, the buggy code checked `runLen[i-2] > runLen[i-1] + runLen[i]` only for the top three runs. After a merge that combines runs 2 and 3, the new run can cause the *next-down* triple to violate the invariant, but `mergeCollapse` won't notice because it only looks at the top.

### The fix

The 2015 paper's fix:

```java
private void mergeCollapse() {
    while (stackSize > 1) {
        int n = stackSize - 2;
        if (n > 0 && runLen[n-1] <= runLen[n] + runLen[n+1] ||
            n > 1 && runLen[n-2] <= runLen[n-1] + runLen[n]) {     // <-- added
            if (runLen[n-1] < runLen[n+1])
                n--;
        } else if (n < 0 || runLen[n] > runLen[n+1]) {
            break;
        }
        mergeAt(n);
    }
}
```

The added line `n > 1 && runLen[n-2] <= runLen[n-1] + runLen[n]` extends the check one level deeper. This was patched into OpenJDK in 2015, into CPython for 3.6.5, and into Android.

### Why galloping was not the bug

The bug is in **run-stack management**, not in galloping. Galloping's own bound-overflow guard (`ofs = (ofs << 1) + 1; if ofs <= 0: ofs = max_ofs`) was correct. The lesson is that **exponential search itself is small and easy to verify** — the surrounding orchestration (when to merge which runs) is the part that breaks.

This is a good practical insight: when reviewing merge-sort-based code in production, focus auditing effort on the merge orchestration, not the inner gallop loop.

---

<a name="lsm"></a>
## 3. Exponential Search in LSM-Tree Compaction

LSM-trees (Log-Structured Merge-trees) — used in LevelDB, RocksDB, Cassandra, ScyllaDB, ClickHouse, TiDB — store data in **sorted-string tables (SSTables)** at multiple levels. Periodically, **compaction** merges overlapping SSTables into a new SSTable, similar to merge sort. Galloping search shows up wherever the compaction merges sorted streams.

### RocksDB's merge iterator

RocksDB's `MergingIterator` (in `db/merge_iterator.cc`) merges N sorted SSTables key-by-key into one sorted output stream. The naive approach uses a min-heap of N entries — each `next()` call pops the minimum and pushes the next key from the same SSTable.

The optimization (when N = 2): instead of one-pair-at-a-time, **gallop one side when it's winning streaks**. The exponential search finds how many keys from side A are strictly less than the next key from side B, then bulk-copies them.

This matters because compactions move terabytes of data per day on production clusters. A 10% speedup from galloping translates to hours of saved I/O.

### Cassandra's `MergeIterator`

Cassandra (in `org.apache.cassandra.utils.MergeIterator`) follows the same pattern. The Java code uses a `Reducer` to combine duplicate-key rows from different SSTables (Cassandra is eventually consistent, so the same primary key can appear in multiple SSTables with different timestamps).

Galloping is **not** used inside Cassandra's `MergeIterator` itself, but it is used inside Java's `Arrays.sort` of the per-SSTable buffer — so transitively, compaction benefits from Timsort's galloping.

### ClickHouse's parts merging

ClickHouse stores data in **parts** (similar to SSTables) sorted by primary key. Background merges combine parts. ClickHouse's merge code in `MergingSortedAlgorithm` uses a heap, but the *inner* sort of each part uses Pdqsort or radix sort. No galloping in the merge per se — ClickHouse uses bulk-vectorized comparisons (SIMD) to achieve speed.

### The takeaway

Galloping is most valuable in **2-way merges of long sorted streams with long monotonic runs**. It loses to heap-based N-way merges when N > 2 because the heap's overhead dominates. So:

- 2-way merge of long runs → gallop.
- N-way merge (N > 2) → min-heap (loser tree).
- Inner sort of small blocks → Timsort (which uses galloping internally).

---

<a name="sorted-logs"></a>
## 4. Searching Sorted Append-Only Logs

A common production pattern: an append-only log file sorted by some key (timestamp, sequence number, offset). You want to:

1. **Find the first record with key >= X** (range start).
2. **Find the last record with key <= Y** (range end).
3. **Stream between them** sequentially.

The challenge: you don't want to call `fstat` to get the file size (slow on network filesystems, FUSE, or compressed/encrypted overlays), and the file is growing concurrently with reads.

### Exponential search on a fixed-record-size log

If each record is exactly `R` bytes (e.g., padded fixed-width entries), record `i` lives at byte offset `i * R`. Read with `pread(fd, buf, R, i * R)` and treat OOB reads (`pread` returns 0) as "past end".

```python
def find_first_ge(fd, key, R):
    """fd: file descriptor. R: record size. Returns first record idx whose key >= target, or -1."""
    def read_key(i):
        buf = os.pread(fd, R, i * R)
        if len(buf) < R:
            return float('inf')
        return parse_key(buf)

    # Phase 1: gallop
    bound = 1
    while read_key(bound) < key:
        bound *= 2

    # Phase 2: lower_bound
    lo, hi = bound // 2, bound
    while lo < hi:
        mid = (lo + hi) // 2
        if read_key(mid) < key:
            lo = mid + 1
        else:
            hi = mid
    result_key = read_key(lo)
    return lo if result_key != float('inf') else -1
```

This is **exactly** the algorithm Kafka uses on its `.index` files (which are fixed 8-byte-offset + 4-byte-relative-position entries), simplified for clarity. Kafka's actual implementation uses `mmap` and plain binary search because the size is known from kernel metadata, but for tools that bypass the broker (like recovery scripts that walk segments directly), exponential search on disk is the natural pattern.

### Exponential search on a variable-record-size log

Variable-width records (e.g., JSON-lines, length-prefixed binary records) make indexing harder — you can't compute byte offset from record index directly. Solutions:

1. **Maintain a sparse index** (key → byte position every Nth record), then binary-search the index plus sequential scan within the gap.
2. **Use a separate sorted index file** with `(key, byte_position)` pairs of fixed size — then exponential search the index, then read the data file.

The sparse-index pattern is universal in log-structured storage: Kafka's `.index`, RocksDB's block-based SSTable index, Lucene's `.tip` file, Parquet's column chunk metadata. All of them rely on **fast search inside the index**, which is binary or exponential depending on size knowledge.

### Concurrent appends

If the log is being appended to during the search, `bound` can race past records that didn't exist when the gallop started. Solutions:

1. **Snapshot the size** before searching: `size = fstat().st_size; max_bound = size / R`. Then cap the gallop.
2. **Treat OOB reads as "past end"** consistently — the gallop will naturally terminate at the current end-of-log, and a refining binary search will find the answer in the snapshot.

The OOB-sentinel pattern is robust to concurrent appends: new records appear *after* the snapshot, so they're invisible to the search, which gives a consistent point-in-time view.

---

<a name="anti-patterns"></a>
## 5. When Galloping Backfires (Anti-Patterns)

Galloping is not always a win. Here are scenarios where it hurts.

### 5.1 Interleaved data

When the two sorted streams are perfectly interleaved (`A = [1, 3, 5, 7, …]`, `B = [2, 4, 6, 8, …]`), galloping kicks in after `minGallop` consecutive wins, **finds only one** matching element, then incurs the overhead of switching back to pair-at-a-time. Net cost: 2-3× more comparisons than pair-at-a-time alone.

Mitigation: the adaptive `minGallop` ratchets *up* when galloping fails, suppressing future gallop attempts. After a few failed gallops, `minGallop` climbs to 50+ and galloping is effectively disabled.

### 5.2 Tiny arrays

For arrays of length < 32, the gallop's overhead (multiple multiplications, branch predictor cold start, the bound-overflow check) dominates. Plain binary search or even linear scan wins. Timsort's threshold is 32: arrays smaller than this are sorted with insertion sort, no merging at all.

### 5.3 Expensive comparisons with cheap data access

If your comparison function is a network call (e.g., comparing two distributed entities), every probe costs milliseconds. Exponential search makes **more** probes than plain binary search in the worst case (about 2×), so it's worse. The opposite holds when comparisons are cheap and data access is the bottleneck — then exponential's lower constant for front-loaded targets wins.

### 5.4 Branch misprediction on modern CPUs

The gallop loop is hard to branch-predict: each iteration's comparison can go either way, and the branch direction depends on data. On a modern x86, ~5 ns per mispredicted branch. Plain binary search has the same problem, but the gallop's *additional* loop adds extra branches.

For very small arrays (say n = 100), a fully linear scan is sometimes faster than either galloping or binary search, because branch prediction loves linear loops.

### 5.5 Heap-based N-way merges

When merging N > 2 sorted streams, a min-heap (or tournament tree / loser tree) is asymptotically optimal. Galloping doesn't help because at any moment, the "winning streak" of one side can be terminated by any of the N-1 other sides — galloping must constantly check all of them, defeating the bulk-copy advantage.

For N = 2, galloping wins. For N >= 3, use a heap.

---

<a name="tuning"></a>
## 6. Real-World Performance Tuning

### 6.1 Profiling the merge

When tuning a merge-heavy workload, instrument three counters:

1. **`pair_compares`** — comparisons during pair-at-a-time mode.
2. **`gallop_compares`** — comparisons during galloping.
3. **`gallop_bulk_count`** — total elements bulk-copied by galloping.

A healthy mix: `gallop_bulk_count / (pair_compares + gallop_compares) > 5`. If the ratio is < 1, galloping is costing more than it saves; consider disabling it (set `minGallop = INT_MAX`).

### 6.2 Adapting `minGallop` for your data

Timsort's default `minGallop = 7` is good for general-purpose Python lists. For specific workloads, you may want:

- **Highly sorted data** (logs, monotonic IDs): lower `minGallop` (e.g., 3) to gallop sooner.
- **Highly interleaved data** (random keys): higher `minGallop` (e.g., 32) to avoid spurious gallops.

Java's TimSort hardcodes 32; CPython's uses 7. The right value depends on your data — measure, don't guess.

### 6.3 SIMD-augmented pair-at-a-time

Modern CPUs can compare 8–16 integers per cycle with SIMD. For numeric merges, a pair-at-a-time mode that compares 8 elements at once **beats** galloping for moderately interleaved data, because galloping reverts to scalar comparisons inside the binary search refine phase.

Production sorters (Google's *pdqsort* successor, Intel's *Parallel Studio* sorters, ClickHouse's merge) use SIMD heavily in the pair-at-a-time mode and only gallop on truly long runs.

### 6.4 Cache-friendly galloping

Galloping with a hint near a cache line boundary is much faster than galloping from far away. Production implementations align the data and start the gallop's first probe at a cache-line-aligned address.

For a 64-byte cache line and 8-byte keys, this means the first 8 keys are essentially free; the gallop's first `log₂(8) = 3` probes hit the same cache line. Modern CPUs prefetch the next cache line automatically, so probes 4-7 are also fast.

### 6.5 When to skip galloping entirely

For the following cases, just use plain binary search and stop worrying:

- Length is known and small (< 1000).
- Comparisons are cheap and access is random.
- The target distribution is uniform.
- You're inside a tight library function with a fixed CI budget.

Reserve galloping for:
- Unknown / unbounded length.
- Two-way merges of long sorted streams (Timsort, LSM compaction).
- Galloping with hint inside iterative merge loops.
- Stream search where front-loaded targets dominate the workload.

---

## Closing Thoughts

Exponential search is the algorithm that turns "I don't know how long the data is" and "the target is probably near the front" from problems into non-issues. In production, you see it most often as the **inner loop of merge algorithms** (Timsort, LSM compaction), as the **search primitive of unknown-size data sources** (sorted streams, sparse on-disk indexes), and as the **structural pattern of skip lists and high-fanout B-trees**.

The 30 lines of code in `junior.md` show up — in production — inside the sorting routine of every Python list, every Java `Arrays.sort(Object[])`, every Android sort, every CockroachDB transaction commit. Galloping search is one of the highest-impact-per-line algorithms in the practical computer science canon, hiding behind a deceptively simple two-loop structure.

---

## Further Reading

- **Tim Peters**, "Listsort.txt" — the original Timsort design document. Required reading.
- **de Gouw, Boer, Bubel, Hähnle, Rot, Steinhöfel**, "Proving that Android's, Java's and Python's Sorting Algorithm is Broken (and Showing How to Fix It)" — Tools and Algorithms for the Construction and Analysis of Systems, 2015.
- **OpenJDK source**: `java.util.TimSort` — production-grade Java galloping implementation.
- **CPython source**: `Objects/listobject.c` — Python's Timsort.
- **RocksDB documentation** — block-based table format and merge iterator.
- **Kafka source**: `kafka.log.OffsetIndex` — sparse index lookup.
- **Pugh**, "Skip Lists: A Probabilistic Alternative to Balanced Trees" (1990).
- **Bentley & Yao**, "An Almost Optimal Algorithm for Unbounded Searching" (1976).
- Continue with `professional.md` for the formal complexity proof and the Bentley-Yao optimality bound.
