# Two Pointers — Senior Level

## Table of Contents

1. [Why Two Pointers Matters in Production](#why-two-pointers-matters-in-production)
2. [Parsers, Tokenizers, and I/O](#parsers-tokenizers-and-io)
3. [Stream Deduplication and Compaction Pipelines](#stream-deduplication-and-compaction-pipelines)
4. [K-Way Merge — Generalizing Variant C](#k-way-merge--generalizing-variant-c)
5. [Distributed Sorted-Stream Merge](#distributed-sorted-stream-merge)
6. [LSM Compaction — Two Pointers at Disk Scale](#lsm-compaction--two-pointers-at-disk-scale)
7. [Database Joins — Sort-Merge Is Two Pointers](#database-joins--sort-merge-is-two-pointers)
8. [Concurrency and Parallelization Constraints](#concurrency-and-parallelization-constraints)
9. [Observability and Edge-Case Logging](#observability-and-edge-case-logging)
10. [Failure Modes](#failure-modes)
11. [Summary](#summary)

---

## Why Two Pointers Matters in Production

Two pointers is not just an interview trick. It is the underlying loop in some of the most expensive code paths in real systems:

- The **merge step** in external mergesort (the algorithm that sorts files larger than RAM).
- The **compaction step** in every log-structured merge (LSM) tree — RocksDB, LevelDB, Cassandra, ScyllaDB.
- The **sort-merge join** in PostgreSQL, MySQL, Oracle, and every analytical database.
- The **byte scan** in HTTP parsers, JSON parsers, log shippers, and protocol decoders.
- The **deduplication step** in event pipelines (Kafka Streams, Flink, Spark).
- The **range intersection** in inverted-index search (Lucene, Elasticsearch posting lists).

In all of these, the data is too big to fit in memory, and the operation is too hot to afford allocations. Two pointers gives you **constant extra memory, sequential I/O, and a tight inner loop the CPU can pipeline**.

---

## Parsers, Tokenizers, and I/O

A tokenizer is two pointers in disguise: a **start** cursor marks the beginning of the current token, an **end** cursor scans forward. When `end` hits a delimiter, the slice `[start, end)` is emitted as a token, and `start` jumps to `end + 1`.

### Production-grade CSV-style scanner

#### Go

```go
package scanner

import "io"

// Scan emits each comma-separated token in r without allocating a new
// buffer per token. Uses two-pointer (start, end) over the read buffer.
// Returns total tokens emitted.
type Tokenizer struct {
    r        io.Reader
    buf      []byte
    start    int
    end      int
    onToken  func(token []byte)
}

func New(r io.Reader, capacity int, onToken func([]byte)) *Tokenizer {
    return &Tokenizer{
        r:       r,
        buf:     make([]byte, capacity),
        onToken: onToken,
    }
}

func (t *Tokenizer) Run() (int, error) {
    n, count := 0, 0
    var err error
    for {
        n, err = t.r.Read(t.buf[t.end:])
        if n == 0 && err != nil {
            // emit final token, then return
            if t.end > t.start {
                t.onToken(t.buf[t.start:t.end])
                count++
            }
            if err == io.EOF {
                return count, nil
            }
            return count, err
        }
        t.end += n
        for i := t.start; i < t.end; i++ {
            if t.buf[i] == ',' || t.buf[i] == '\n' {
                t.onToken(t.buf[t.start:i])
                count++
                t.start = i + 1
            }
        }
        // compact: move unread bytes to the front
        copy(t.buf, t.buf[t.start:t.end])
        t.end -= t.start
        t.start = 0
    }
}
```

#### Java

```java
import java.io.InputStream;
import java.io.IOException;
import java.util.function.Consumer;

public class Tokenizer {
    private final InputStream in;
    private final byte[] buf;
    private int start = 0;
    private int end = 0;

    public Tokenizer(InputStream in, int capacity) {
        this.in = in;
        this.buf = new byte[capacity];
    }

    public int run(Consumer<byte[]> onToken) throws IOException {
        int count = 0;
        while (true) {
            int n = in.read(buf, end, buf.length - end);
            if (n <= 0) {
                if (end > start) {
                    byte[] token = new byte[end - start];
                    System.arraycopy(buf, start, token, 0, end - start);
                    onToken.accept(token);
                    count++;
                }
                return count;
            }
            end += n;
            for (int i = start; i < end; i++) {
                if (buf[i] == ',' || buf[i] == '\n') {
                    byte[] token = new byte[i - start];
                    System.arraycopy(buf, start, token, 0, i - start);
                    onToken.accept(token);
                    count++;
                    start = i + 1;
                }
            }
            // compact
            System.arraycopy(buf, start, buf, 0, end - start);
            end -= start;
            start = 0;
        }
    }
}
```

#### Python

```python
from typing import BinaryIO, Callable

def tokenize(reader: BinaryIO,
             capacity: int,
             on_token: Callable[[bytes], None]) -> int:
    """Emit each comma- or newline-delimited token from reader.
    Two-pointer scan over a fixed-size buffer. Returns token count."""
    buf = bytearray(capacity)
    start, end, count = 0, 0, 0
    while True:
        n = reader.readinto(memoryview(buf)[end:])
        if not n:
            if end > start:
                on_token(bytes(buf[start:end]))
                count += 1
            return count
        end += n
        i = start
        while i < end:
            if buf[i] == ord(',') or buf[i] == ord('\n'):
                on_token(bytes(buf[start:i]))
                count += 1
                start = i + 1
            i += 1
        # compact: shift the unread tail to the front
        leftover = end - start
        buf[:leftover] = buf[start:end]
        start, end = 0, leftover
```

### What the senior engineer notices

- **Zero allocations per token (Go)** — `t.buf[t.start:i]` is a slice header, not a copy. In hot paths this is the difference between 100 MB/s and 1 GB/s throughput.
- **Compaction** at the end of each read cycle keeps `end - start` bounded by the buffer size; without it, you would have to grow the buffer indefinitely or fail on tokens that span reads.
- **Backpressure**: if a token does not fit in the buffer even after compaction, the scanner must either grow, error, or split. Real parsers expose this as a config knob.
- **Streaming, not loading**: the whole point is that you never hold the entire file in RAM.

This is the same two-pointer pattern as `removeDuplicates` (slow/fast), just with `start` as the slow pointer and `end` as the fast pointer.

---

## Stream Deduplication and Compaction Pipelines

A common pipeline stage is: **events arrive sorted by timestamp; emit only the latest event per key, dropping stale duplicates.** If the input is sorted by `(key, timestamp)`, this is a slow/fast two-pointer scan:

```text
slow = 0
for fast in 1..n:
    if events[fast].key != events[slow].key:
        slow += 1
        events[slow] = events[fast]
    else if events[fast].timestamp > events[slow].timestamp:
        events[slow] = events[fast]
emit events[0..slow]
```

Same shape as `removeDuplicates`, with a richer merge rule. In a streaming engine you replace the in-memory array with a bounded buffer and use the same algorithm against the input stream.

**Why this matters at scale:**

- A single Kafka partition can deliver millions of events per second. Anything more than `O(1)` per event will not keep up.
- Allocating per event triggers GC pressure that dominates throughput. Two pointers naturally writes in place into a pre-allocated buffer.
- The pattern composes — chain `[parse -> dedup -> filter -> serialize]` and each stage is a two-pointer over the previous stage's output buffer.

---

## K-Way Merge — Generalizing Variant C

The merge-style two-pointer over **two** sorted streams generalizes to **k** sorted streams by replacing the `if A[i] < B[j]` comparison with a **min-heap** of size k holding `(current_value, source_index)`.

```text
heap = [(stream_i.peek(), i) for each input stream i]
heapify(heap)
while heap not empty:
    val, src = pop(heap)
    emit(val)
    if streams[src].advance():
        push(heap, (streams[src].peek(), src))
```

Time: `O(N log k)` where `N` is the total number of elements across all streams. The two-pointer variant is the special case `k = 2`, where the heap collapses to a single comparison.

#### Go

```go
package kmerge

import "container/heap"

type Item struct {
    Value int
    Src   int
}

type MinHeap []Item

func (h MinHeap) Len() int           { return len(h) }
func (h MinHeap) Less(i, j int) bool { return h[i].Value < h[j].Value }
func (h MinHeap) Swap(i, j int)      { h[i], h[j] = h[j], h[i] }
func (h *MinHeap) Push(x any)        { *h = append(*h, x.(Item)) }
func (h *MinHeap) Pop() any {
    old := *h
    n := len(old)
    x := old[n-1]
    *h = old[:n-1]
    return x
}

// MergeK takes k sorted slices and returns a single sorted slice.
// Time: O(N log k). Space: O(k) for the heap.
func MergeK(streams [][]int) []int {
    h := &MinHeap{}
    cursors := make([]int, len(streams))
    for i, s := range streams {
        if len(s) > 0 {
            heap.Push(h, Item{Value: s[0], Src: i})
        }
    }
    var out []int
    for h.Len() > 0 {
        top := heap.Pop(h).(Item)
        out = append(out, top.Value)
        cursors[top.Src]++
        if cursors[top.Src] < len(streams[top.Src]) {
            heap.Push(h, Item{Value: streams[top.Src][cursors[top.Src]], Src: top.Src})
        }
    }
    return out
}
```

#### Java

```java
import java.util.*;

public class KMerge {
    public static int[] mergeK(int[][] streams) {
        PriorityQueue<int[]> heap = new PriorityQueue<>(
            Comparator.comparingInt(a -> a[0])
        );
        int[] cursors = new int[streams.length];
        int total = 0;
        for (int i = 0; i < streams.length; i++) {
            if (streams[i].length > 0) {
                heap.offer(new int[]{streams[i][0], i});
            }
            total += streams[i].length;
        }
        int[] out = new int[total];
        int idx = 0;
        while (!heap.isEmpty()) {
            int[] top = heap.poll();
            out[idx++] = top[0];
            int src = top[1];
            cursors[src]++;
            if (cursors[src] < streams[src].length) {
                heap.offer(new int[]{streams[src][cursors[src]], src});
            }
        }
        return out;
    }
}
```

#### Python

```python
import heapq

def merge_k(streams: list[list[int]]) -> list[int]:
    """K-way merge using a min-heap. Time: O(N log k). Space: O(k)."""
    heap: list[tuple[int, int, int]] = []  # (value, src, cursor)
    for i, s in enumerate(streams):
        if s:
            heapq.heappush(heap, (s[0], i, 0))
    out: list[int] = []
    while heap:
        val, src, cur = heapq.heappop(heap)
        out.append(val)
        if cur + 1 < len(streams[src]):
            heapq.heappush(heap, (streams[src][cur + 1], src, cur + 1))
    return out
```

This is the algorithm behind:

- `sort -m` on Unix (merging sorted files).
- The final pass of external mergesort.
- The `MERGE` operator in Postgres for sort-merge joins of more than two relations.
- Lucene's `MultiTermsEnum` walking parallel term dictionaries.

---

## Distributed Sorted-Stream Merge

When the streams live on different machines, the two-pointer (or k-way) pattern still works, but the cost model changes:

- **Comparisons are cheap** (microseconds), but **fetching the next element is expensive** (network round-trip, milliseconds).
- Solution: **batch reads**. Each remote stream is buffered locally; the merger only blocks when its buffer empties.
- The number of comparisons is unchanged, but the **wall-clock time** is dominated by network parallelism, not the algorithm.

A real-world distributed merge (e.g., a federated query across shards):

```text
For each shard:
    open a sorted result iterator (kept warm by the shard)
    pre-fetch a batch of K rows into a local ring buffer

Merger thread:
    pop smallest current head across all shards (min-heap)
    emit row
    if buffer empties, async fetch next batch from that shard
```

The two-pointer pattern is the **logical algorithm**; the production system wraps it with **prefetching, backpressure, and timeout handling** so that one slow shard does not stall the whole merge.

---

## LSM Compaction — Two Pointers at Disk Scale

A log-structured merge tree (RocksDB, LevelDB, Cassandra) stores data in sorted runs called **SSTables**. Periodically, multiple SSTables are merged into one, dropping tombstones and obsolete versions. This **compaction** is a two-pointer (or k-way) merge over sorted files:

```text
for each pair (or k-tuple) of SSTables being compacted:
    open sorted iterator on each
    use merge-style two pointers / k-way:
        on tie of keys: keep the newer version (or drop both if tombstoned)
        write the survivor to the output SSTable
```

Key engineering decisions wrapped around the two-pointer core:

| Concern | How it interacts with the merge |
|---------|-------------------------------|
| Throttling | Limit MB/s of compaction I/O so foreground writes are not starved |
| Crash safety | Write to a `.tmp` file, fsync, atomic rename |
| Bloom filters | Each input has a Bloom filter; the merger emits a Bloom filter for the output |
| Block cache | Reads go through a cache so hot keys are not re-fetched from disk |
| Versioning | Each emitted SSTable gets a new manifest entry under a write lock |

The inner loop is just `i++` or `j++`, but the system around it is what makes the merge resilient. If you can write `merge_two_sorted_arrays` cleanly, you have already implemented the heart of an LSM engine; the rest is plumbing.

---

## Database Joins — Sort-Merge Is Two Pointers

For an equi-join `R.x = S.x` where both relations are sorted on `x`, the **sort-merge join** is variant C of two pointers:

```text
i = 0; j = 0
while i < |R| and j < |S|:
    if R[i].x < S[j].x: i += 1
    elif R[i].x > S[j].x: j += 1
    else:
        # Cartesian product of all matching rows
        i_end = i
        j_end = j
        while i_end < |R| and R[i_end].x == R[i].x: i_end += 1
        while j_end < |S| and S[j_end].x == S[j].x: j_end += 1
        for a in R[i:i_end], for b in S[j:j_end]:
            emit(a, b)
        i = i_end; j = j_end
```

The subtle part is the **inner Cartesian product** on matching groups — duplicates on either side multiply the output. The optimizer's choice between hash join, sort-merge join, and nested-loop join depends on input sizes, indexes, and memory budgets, but when sort-merge wins, the inner loop is exactly this two-pointer pattern.

---

## Concurrency and Parallelization Constraints

Two pointers is **inherently sequential** — each step depends on the previous one (which side moved). This makes parallelization hard:

- **No SIMD speedup** for the converging variant: branches depend on data values.
- **Partitioning across threads** works for slow/fast partition (each thread handles a chunk, then a final merge step combines the slow-pointer outputs).
- **Merge-style scales** via the **k-way merge** with a min-heap, but the merger itself remains a single hot thread; parallelism is in the **producers** (one thread per sorted input).

When you really must parallelize:

1. **Partition the input range** into `p` chunks.
2. Run two pointers independently on each chunk.
3. Use a **gather / reduce** step to combine results — itself often a k-way merge.

Beware of false sharing if the chunks write into adjacent cache lines of a shared output buffer. The standard fix is to give each worker its own output, then concatenate.

---

## Observability and Edge-Case Logging

In production code, the inner loop usually does **not** log, because logging in a 100k-iter loop would crush throughput. Senior engineers add observability **outside** the loop:

| Signal | What it tells you |
|--------|-------------------|
| Total tokens emitted vs bytes read | Whether the parser is making forward progress |
| Number of merge ties | High tie counts may indicate duplicate-heavy input — consider dedup |
| Per-stream advance counts (k-way merge) | Detect a "lazy" or stuck stream that is starving the merger |
| Buffer-compaction count | Frequent compactions = undersized buffer |
| Time spent in `read()` vs in the inner loop | If `read()` dominates, increase batch size; if inner loop dominates, profile branch mispredicts |
| Tail-drain count | If you frequently end with one side fully consumed and the other still has thousands of elements, your input distributions are skewed |

For the converging variant specifically, log the **terminal `r - l`** value. Always zero or one? Good. Frequently the loop exits with `r - l > 0`? You may be discarding the right side too eagerly — invariant bug.

---

## Failure Modes

| Failure | Cause | Mitigation |
|---------|-------|------------|
| Infinite loop | Neither pointer advances on some branch | Assertion: at least one of `l`, `r` changes each iter; static analysis can catch this |
| Wrong dedup in 3-sum | Forgot to skip equal neighbors on `l` or `r` | Property-based tests with duplicate-heavy inputs |
| Hash collision in stream dedup | Using a hash instead of full key equality | Always compare full keys after a hash match |
| Slow stream stalls k-way merge | Producer blocks on I/O | Per-stream timeout; partial result with sentinel |
| Buffer overflow in scanner | Single token larger than buffer | Grow-or-error policy with clear log; surface as a parse error |
| Memory pressure in compaction | k too large -> heap too large -> GC churn | Cap k per merge level (e.g., L0 -> L1 with k <= 10) |
| Cache pollution from large merges | Streaming reads evict useful pages | `madvise(MADV_SEQUENTIAL)` / direct I/O bypasses the cache |
| Integer overflow on `l + r` mid-calc | Mixing two-pointer with binary search snippets | Use `l + (r - l) / 2` |
| Lost trailing elements in merge | Forgot the leftover-drain loops | Code review + boundary tests |

---

## Summary

At the senior level, two pointers stops being "a coding-interview pattern" and starts being **the inner loop of half the data-plane code you will ever write**. Parsers, dedup, compaction, joins, k-way merges — they all share the same skeleton, and the engineering decisions are about what wraps that skeleton: buffering, backpressure, batching, observability, and failure handling.

When you read RocksDB compaction code, the Postgres merge join planner, or a high-throughput log shipper, the inner pointer dance will look familiar. The senior skill is keeping the inner loop tight while everything around it copes with real-world I/O, concurrency, and operational realities.
