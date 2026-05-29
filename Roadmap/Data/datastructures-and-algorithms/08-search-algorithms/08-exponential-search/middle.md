# Exponential Search — Middle Level

> **Audience:** Engineers comfortable with iterative binary search and the two-phase exponential layout from `junior.md`. We now compare exponential against its closest cousin (jump search), explore the Timsort galloping merge, generalize to unbounded **monotonic-predicate** problems, and walk through the variations used in real production systems.

This document covers: a side-by-side analysis of **exponential vs. jump search** (when to pick which), the **galloping merge** at the heart of Timsort, exponential search applied to **monotonic predicates** on unbounded ranges (not just sorted arrays), the **first-occurrence** variant with duplicates, exponential search on **streams** and **append-only logs**, and the production patterns used in Kafka, RocksDB, and skip-list traversal.

---

## Table of Contents

1. [Exponential vs. Jump Search](#vs-jump)
2. [First Occurrence with Exponential + Binary](#first-occurrence)
3. [Exponential Search on Monotonic Predicates](#predicate)
4. [Galloping Merge — Timsort's Use](#timsort)
5. [Streams, Append-Only Logs, and Cursor Pagination](#streams)
6. [Skip-List Traversal as Exponential Search](#skip-list)
7. [Comparison with Plain Binary Search](#vs-binary)

---

<a name="vs-jump"></a>
## 1. Exponential vs. Jump Search

Both algorithms answer the same question — *"find a target in a sorted sequence faster than linear"* — but they probe differently:

- **Jump search** probes additively: indices `√n, 2√n, 3√n, …` until overshoot, then linear scan inside the bucket. Time: O(√n).
- **Exponential search** probes multiplicatively: indices `1, 2, 4, 8, 16, …` until overshoot, then binary search inside the bucket. Time: O(log p) where `p` is the target's index.

### When jump search wins

- **Comparisons are expensive but random access is also expensive.** On magnetic tape or a CD-ROM, seek time dominates and is roughly the same for any seek distance. Jump search does fewer "long jumps". Exponential's first probe is at index 1; the last probe (for a target near the end) is at index `~n`. Total seek distance: O(n).
- **You need predictable per-query worst-case cost.** Jump search is *always* O(√n). Exponential search is O(log p) — better on average for front-loaded targets, but its constant factor and behavior depends on `p`.
- **Memory is layout-friendly to fixed strides.** Streaming over a sorted file with `O(√n)` strides plays well with the OS prefetcher.

### When exponential search wins

- **You don't know the length.** Jump search needs `n` to compute `√n`; exponential search discovers the upper bound by doubling.
- **The target is likely near the front.** Exponential is O(log p) which crushes jump's O(√n) when `p << n`.
- **Large arrays (n > 10⁶).** O(log p) ≤ O(log n) = ~20 probes vs. O(√n) = 1000 probes. Not close.
- **You're inside a merge algorithm.** Galloping search (the merge use case) needs the multiplicative growth pattern.

### Concrete comparison

For `n = 10⁹`, target at position `p`:

| `p` | Jump search probes | Exponential search probes |
|---|---|---|
| 5 | ~31,623 (sqrt(10⁹)) | ~6 (2·log₂(5+1)) |
| 100 | ~31,623 | ~14 |
| 10⁵ | ~31,623 | ~34 |
| 5 × 10⁸ | ~31,623 | ~60 (worse than jump!) |

Wait — for `p ≈ n`, jump beats exponential? Yes! `O(√n) = O(√p)` whereas exponential is `O(log p)`. `√(5×10⁸) ≈ 22,360` while `2·log₂(5×10⁸) ≈ 58`. So **exponential is still better for `p` near `n`** in this example. Jump only wins when the constant factor matters more than the asymptotic class, which is roughly never in practice.

Conclusion: **exponential search is strictly better than jump search on RAM-resident sorted arrays of unknown length.** Jump search survives in legacy systems and on storage media where seek distance dominates.

---

<a name="first-occurrence"></a>
## 2. First Occurrence with Exponential + Binary

A common interview variant: *"Find the **first** occurrence of `target` in a sorted array with duplicates, where the array length is unknown."*

The trick: phase 1 (gallop) still works — it finds an `arr[bound] >= target`. Phase 2 (bisect) becomes a `lower_bound` search instead of an exact-match search.

### Python:
```python
def first_occurrence_unknown_size(reader, target):
    """reader.get(i) returns arr[i] or INF if OOB."""
    INF = 2**31 - 1

    # Phase 1: gallop until we find an index >= target
    bound = 1
    while reader.get(bound) < target:
        bound *= 2

    # Phase 2: lower_bound on [bound // 2, bound]
    lo, hi = bound // 2, bound
    while lo < hi:
        mid = (lo + hi) // 2
        if reader.get(mid) < target:
            lo = mid + 1
        else:
            hi = mid

    return lo if reader.get(lo) == target else -1
```

### Go:
```go
func FirstOccurrenceUnknownSize(r Reader, target int) int {
    bound := 1
    for r.Get(bound) < target {
        bound *= 2
    }
    lo, hi := bound/2, bound
    for lo < hi {
        mid := lo + (hi-lo)/2
        if r.Get(mid) < target {
            lo = mid + 1
        } else {
            hi = mid
        }
    }
    if r.Get(lo) == target {
        return lo
    }
    return -1
}
```

### Java:
```java
public static int firstOccurrenceUnknownSize(Reader r, int target) {
    int bound = 1;
    while (r.get(bound) < target) bound *= 2;
    int lo = bound / 2, hi = bound;
    while (lo < hi) {
        int mid = lo + (hi - lo) / 2;
        if (r.get(mid) < target) lo = mid + 1;
        else                     hi = mid;
    }
    return r.get(lo) == target ? lo : -1;
}
```

The pattern: **exponential search + lower_bound** instead of exponential search + exact-match. Same O(log p) total cost.

### Last occurrence

Symmetric:
```python
def last_occurrence_unknown_size(reader, target):
    bound = 1
    while reader.get(bound) <= target:    # note: <= for upper_bound
        bound *= 2

    lo, hi = bound // 2, bound
    while lo < hi:
        mid = (lo + hi) // 2
        if reader.get(mid) <= target:
            lo = mid + 1
        else:
            hi = mid

    return lo - 1 if lo > 0 and reader.get(lo - 1) == target else -1
```

This is `upper_bound - 1`. Same idea as the bounded case from `02-binary-search/middle.md` — only the gallop is novel.

---

<a name="predicate"></a>
## 3. Exponential Search on Monotonic Predicates

Just as binary search generalizes to *"find the first index where a monotonic predicate is true"*, exponential search generalizes to **the same problem on unbounded ranges**.

### Setup

Let `p : ℤ_{>=0} → {⊥, ⊤}` be a monotonic predicate: once `p(i) = ⊤`, every `p(j)` for `j >= i` is also `⊤`. Find the smallest `i` where `p(i) = ⊤`, with **no upper bound given**.

### Algorithm

```
# Phase 1: find any upper bound where p(bound) = True
bound = 1
while not p(bound):
    bound *= 2

# Phase 2: binary search [bound // 2, bound] for the boundary
lo, hi = bound // 2, bound
while lo < hi:
    mid = (lo + hi) // 2
    if p(mid):
        hi = mid
    else:
        lo = mid + 1
return lo
```

**Python:**
```python
def find_first_true_unbounded(predicate):
    """Smallest i >= 0 where predicate(i) is True. Predicate must be monotonic."""
    bound = 1
    while not predicate(bound):
        bound *= 2
    lo, hi = bound // 2, bound
    while lo < hi:
        mid = (lo + hi) // 2
        if predicate(mid):
            hi = mid
        else:
            lo = mid + 1
    return lo
```

**Go:**
```go
func FindFirstTrueUnbounded(pred func(int) bool) int {
    bound := 1
    for !pred(bound) {
        bound *= 2
    }
    lo, hi := bound/2, bound
    for lo < hi {
        mid := lo + (hi-lo)/2
        if pred(mid) {
            hi = mid
        } else {
            lo = mid + 1
        }
    }
    return lo
}
```

**Java:**
```java
public static int findFirstTrueUnbounded(java.util.function.IntPredicate p) {
    int bound = 1;
    while (!p.test(bound)) bound *= 2;
    int lo = bound / 2, hi = bound;
    while (lo < hi) {
        int mid = lo + (hi - lo) / 2;
        if (p.test(mid)) hi = mid;
        else             lo = mid + 1;
    }
    return lo;
}
```

### Use cases

- **Find the smallest `n` such that `f(n) >= threshold`** when you don't know an upper bound for `n`. Examples: smallest array size that triggers a slowdown; smallest workload that exhausts memory; smallest input that crashes a bug (this generalizes `git bisect` to non-array domains).
- **Find the smallest integer power of 2 ≥ `x`** — though this has a trivial `1 << ceil(log2(x))` form.
- **Find the first failing call in a sequence of API requests** when you can replay individually but don't know when failures started.
- **Binary search on the answer when the answer range is unknown.** A parametric search problem (`02-binary-search/middle.md` §3) where you don't know the upper bound a priori — gallop until the predicate flips.

### Performance

Same O(log p) bound as the array case, where `p` is the smallest true index. Each predicate call may be expensive (a database query, a build-and-test run), so reducing probe count is high-leverage.

---

<a name="timsort"></a>
## 4. Galloping Merge — Timsort's Use

Timsort, designed by Tim Peters in 2002 for Python's `list.sort()`, became the standard for Java's `Collections.sort` and `Arrays.sort` on objects (replacing merge sort in JDK 7), and the default in Android, Rust, and V8's `Array.prototype.sort` (after V8 12.5). Galloping search is the most important *adaptive* trick Timsort uses to crush real-world workloads.

### The problem Timsort's merge solves

When merging two sorted runs `A` and `B` of sizes `m` and `n`, the standard merge does `m + n - 1` comparisons in the worst case. But if **most** elements of `A` are smaller than **all** elements of `B`, the merge does `m + n - 1` wasted comparisons — we should just append `A` then `B`.

The middle ground: **runs frequently have long monotonic stretches**. In real data, after a few interleaved comparisons, one side often "wins" many elements in a row. Galloping search detects this and **bulk-copies** the winning side.

### The `minGallop` adaptive heuristic

Timsort maintains a counter `minGallop` (default 7). The merge loop:

1. **One-pair-at-a-time** comparison. Pick the smaller of `A[i]` or `B[j]`, advance, repeat.
2. After one side wins `minGallop` consecutive picks, switch to **galloping mode**.
3. **Gallop**: find via exponential search how many *more* elements of the winning side are less than the current top of the other side. Bulk-copy them.
4. After galloping for a while, if the merge has stopped being lopsided, **increment** `minGallop` to make galloping harder to trigger. If galloping keeps winning, **decrement** `minGallop`.

### Pseudocode for `gallopLeft`

This finds the first index `k` in `arr[base..base+len)` where `arr[k] >= key`, starting from a hint position.

```python
def gallop_left(key, arr, base, length, hint):
    """
    Return the index k in [base, base + length] such that arr[base + k - 1] < key <= arr[base + k].
    Equivalent to: number of elements in arr[base..) that are strictly less than key.
    """
    last_offset = 0
    offset = 1

    if key > arr[base + hint]:
        # gallop right (forward)
        max_offset = length - hint
        while offset < max_offset and key > arr[base + hint + offset]:
            last_offset = offset
            offset = offset * 2 + 1   # +1 guards against overflow
            if offset <= 0:
                offset = max_offset
        if offset > max_offset:
            offset = max_offset
        # translate back to absolute
        last_offset += hint
        offset += hint
    else:
        # gallop left (backward)
        max_offset = hint + 1
        while offset < max_offset and key <= arr[base + hint - offset]:
            last_offset = offset
            offset = offset * 2 + 1
            if offset <= 0:
                offset = max_offset
        if offset > max_offset:
            offset = max_offset
        last_offset, offset = hint - offset, hint - last_offset

    # binary search on (last_offset, offset]
    last_offset += 1
    while last_offset < offset:
        mid = last_offset + (offset - last_offset) // 2
        if key > arr[base + mid]:
            last_offset = mid + 1
        else:
            offset = mid
    return offset
```

This is paraphrased from CPython's `Objects/listobject.c` `gallop_left`. Notice the `offset = offset * 2 + 1` instead of plain `offset *= 2` — the `+1` prevents zero-stuck loops when `offset = 0` and avoids overflow checks (the `if offset <= 0` is the overflow guard).

### Why it works on real data

Real-world data (logs by time, IDs by creation order, names sorted alphabetically with new additions appended) often contains long sorted runs separated by short scrambled regions. After the scrambled region, one side dominates the merge for hundreds of consecutive picks. Galloping detects this in `log₂(run_length)` probes and bulk-copies — turning what would be O(n) merge work into O(log n) work for that stretch.

Tim Peters claims (in his original `listsort.txt`) that Timsort's galloping makes it run in **O(n)** time on data that is "almost sorted" — beating merge sort's O(n log n) worst case.

### Java's evolution

Java 7's `Arrays.sort(Object[])` switched from merge sort to Timsort precisely because of galloping's adaptive performance. The implementation in `java.util.TimSort` mirrors Tim Peters' code line-for-line in spirit — including the `gallopLeft` and `gallopRight` helper methods.

Curiously, Java's Timsort had a long-running [bug](http://www.envisage-project.eu/proving-android-java-and-python-sorting-algorithm-is-broken-and-how-to-fix-it/) (the "stack of pending runs" invariant), which forced specific runs to exceed an array's worth of nested merges. The fix was a 2015 patch by de Gouw et al., who formally verified the merge-stack invariant with a theorem prover. Galloping itself was not implicated — the bug was in the run-stack tracking, separate from the galloping search.

We cover the full Timsort run management in `senior.md`.

---

<a name="streams"></a>
## 5. Streams, Append-Only Logs, and Cursor Pagination

### 5.1 Sorted append-only logs

Many systems store events in sorted append-only files: Kafka topic partitions (sorted by offset), Prometheus TSDB chunks (sorted by timestamp), git pack files (sorted by SHA-1), Elasticsearch segments (sorted by Lucene's internal doc ID).

To find the first entry with offset ≥ X in a Kafka partition:

1. The partition has a sparse **index file** with `(offset, file_position)` pairs every ~4096 bytes. Standard binary search.
2. Once you have a position, you seek into the log file and parse the next record.

But what if the index file is itself sorted by offset and you don't know its length without `stat`ing it? **Exponential search** the index file:

```python
def find_offset_in_index(index_file, target_offset):
    # Each index entry is 16 bytes: 8 bytes offset, 8 bytes file position.
    # Don't stat the file — discover its length by exponential search.

    def read_entry(i):
        try:
            index_file.seek(i * 16)
            data = index_file.read(16)
            if len(data) < 16:
                return (2**63 - 1, 0)    # sentinel: past end
            return struct.unpack('>qq', data)
        except OSError:
            return (2**63 - 1, 0)

    # Gallop
    bound = 1
    while read_entry(bound)[0] < target_offset:
        bound *= 2

    # Bisect
    lo, hi = bound // 2, bound
    while lo < hi:
        mid = (lo + hi) // 2
        if read_entry(mid)[0] < target_offset:
            lo = mid + 1
        else:
            hi = mid
    offset, pos = read_entry(lo)
    return pos if offset >= target_offset else -1
```

The win: **no `stat` call**, which on some filesystems (e.g., FUSE-mounted, network mounts) costs more than a few `pread` calls.

### 5.2 Cursor pagination

REST APIs often paginate sorted results via cursors. `GET /events?after_cursor=abc123` returns the next page.

If the underlying storage is a sorted array and the cursor encodes the previous offset, exponential search **with a hint** locates the next page in O(log(page_size)) — much faster than O(log(total_records)).

```python
def fetch_page_after_cursor(arr, cursor_offset, page_size):
    # We expect the next page to be near (but after) cursor_offset.
    # Gallop forward from cursor_offset.
    n = len(arr)
    if cursor_offset >= n:
        return []

    # Gallop until we have at least page_size results past cursor_offset
    bound = 1
    while cursor_offset + bound < n and bound < page_size:
        bound *= 2

    end = min(cursor_offset + bound, n)
    return arr[cursor_offset:end][:page_size]
```

This pattern matters when the result set is huge and pages are small relative to total size.

### 5.3 Sorted Kafka offset lookup

Kafka brokers expose `offsetForTimes(topic, partition, timestamp)` which returns the smallest offset whose record timestamp is >= the given timestamp. Implementation: exponential search over the on-disk `.timeindex` file, then a refining binary search. The index is sparse, so you finish with a sequential scan of the actual log records.

Kafka's actual code uses plain binary search on the in-memory mmap'd index, because the index size *is* known. But for **historical lookups** that bypass the index (e.g., debugging tools that read raw segments), exponential search is the standard pattern.

---

<a name="skip-list"></a>
## 6. Skip-List Traversal as Exponential Search

A **skip list** (Pugh, 1990) is a probabilistic data structure that achieves O(log n) search by maintaining multiple levels of forward pointers — level 0 has every element, level 1 has ~n/2, level 2 has ~n/4, etc. To search:

```
1. Start at the head node at the highest level.
2. At the current level: walk forward while next.key < target.
3. When you can't go further at this level, drop down one level.
4. At level 0, the next node is either the target or where the target would go.
```

Each level corresponds to a "stride" of size `~2^level`. The search effectively **gallops** down through levels — at level k you skip `~2^k` elements per hop. Once you can't go further at level k, you've narrowed the range, and you continue refining at lower levels.

This is exactly exponential search **structured into the data structure itself**. The "gallop" is the high-level walk; the "bisect" is the cascade through descending levels.

### Why it matters

- Skip lists are easier to implement than balanced trees (no rotations).
- They're used in **Redis sorted sets** (`ZADD`, `ZRANGEBYSCORE`), LevelDB's memtable, and Apache Cassandra's memtable.
- The asymptotic O(log n) search is realized by the gallop-then-refine structure.

The lesson: the gallop-then-bisect pattern shows up not just in algorithms-on-arrays but also in **structures that are inherently galloped** — skip lists, B-trees with high fanout, fractional cascading. Understanding exponential search builds the right intuition for all of these.

---

<a name="vs-binary"></a>
## 7. Comparison with Plain Binary Search

| Property | Plain Binary Search | Exponential Search |
|---|---|---|
| **Time** | O(log n) | O(log p), where `p` is target's index |
| **Best case (target near front)** | O(log n) | **O(log p)** — much better |
| **Worst case (target near back)** | O(log n) | O(log p) ≈ O(log n) — about 2× slower constant |
| **Length must be known** | YES | NO |
| **Two phases** | NO — one bisect | YES — gallop + bisect |
| **Probes for target at index 5 in n = 10⁹** | ~30 | ~6 |
| **Probes for target at index 10⁹/2** | ~30 | ~60 |
| **Streams / unbounded data** | Cannot use | Natural fit |
| **Bug surface** | Off-by-one in bisect bounds | Off-by-one in bisect **plus** bound-overflow in gallop |
| **Standard library version** | Yes (most languages) | No — implement yourself |
| **Common in** | Random target, known length | Front-loaded target, unknown length, merge algorithms |

### Decision rule

```
Is the length known?
  No  → exponential search.
  Yes:
    Is the target distribution roughly uniform?
      Yes → binary search (simpler, equally fast on average).
      No, expected near the front → exponential search.
      No, expected near the back → reversed exponential search (gallop from n-1).
```

### Hybrid: exponential then binary as a wrapper for binary

A pragmatic library function for *any* sorted search problem:

```python
def smart_search(arr, target):
    if not arr:
        return -1
    if target < arr[0]:
        return -1
    if target > arr[-1]:
        return -1
    # Within range; use exponential to localize, then bisect inside.
    return exponential_search(arr, target)
```

Always slightly more work than plain binary in the worst case, but always at most 2× slower, and dramatically faster for front-loaded targets. Some Java implementations of `Arrays.binarySearch` internally check if `target <= arr[mid_init]` for a small `mid_init` to short-circuit — basically a one-shot gallop.

---

## Cheat Sheet — When to Use Each Variant

```
Variant                                    Use when
-------                                    --------
Plain exponential search                   Sorted array, length known but target likely near front
Search in unknown-size array               LeetCode 702 / sorted stream
First/last occurrence (unbounded)          Sorted array with duplicates, unknown length
Predicate version (unbounded)              Monotonic predicate without known upper bound
Galloping with hint                        Inside merge algorithms (Timsort)
Reverse gallop (from n-1)                  Target expected near the back of known-size array
Skip-list traversal                        Sorted set / map with both range queries and updates
Jump search                                Sequential-access media (tape, slow disk)
Binary search                              Random target in known-size array (default choice)
```

---

## Further Reading

- **Bentley & Yao**, "An Almost Optimal Algorithm for Unbounded Searching" (1976) — proves O(log p) is optimal.
- **Tim Peters**, `listsort.txt` in CPython's source tree — the Timsort design document.
- **Java's `java.util.TimSort`** source — production-quality galloping implementation.
- **Pugh**, "Skip Lists: A Probabilistic Alternative to Balanced Trees" (1990) — the skip list paper.
- **Kafka source code**, `core/src/main/scala/kafka/log/OffsetIndex.scala` — production binary/exponential search on disk-resident sparse indexes.
- Continue with `senior.md` for the Timsort merge's full implementation, real-world stream search systems, and the run-stack invariant bug.
