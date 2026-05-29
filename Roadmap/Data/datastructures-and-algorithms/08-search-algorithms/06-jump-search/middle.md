# Jump Search — Middle Level

> **Audience:** Engineers comfortable with classic jump search who want the variant family used in real systems and competitive programming. Prerequisite: `junior.md`.

This document covers the **family of search algorithms built around block jumping**: the jump-then-binary hybrid (`O(√n + log √n)`), jump search on linked lists with explicit skip pointers (the conceptual seed of skip lists), the exponential / galloping cousin (block size doubles instead of staying at `√n`), variable block sizes for skewed distributions, the connection to **sqrt decomposition** in competitive programming, and a clear-eyed comparison against binary search across realistic access models.

---

## Table of Contents

1. [Jump-then-Binary Hybrid](#hybrid)
2. [Jump Search on Linked Lists with Skip Pointers](#linked-list)
3. [Exponential / Galloping Search — Jump's Adaptive Cousin](#exponential)
4. [Variable Block Sizes and Distribution Awareness](#variable)
5. [Sqrt Decomposition — Jump Search Generalized](#sqrt-decomp)
6. [Jump vs Binary Across Access Models](#vs-binary)

---

<a name="hybrid"></a>
## 1. Jump-then-Binary Hybrid

Classic jump search uses linear scan inside the located block. If the block has size `√n`, that's `√n` extra comparisons. Replacing the linear scan with **binary search** gives `√n + log(√n) = √n + (1/2) log n` total. For practical `n`, the `log √n` term is negligible — the algorithm is still `O(√n)` — but the constant on the second phase improves dramatically.

### When is the hybrid worth it?

- Block fits in cache (so each binary-search probe is L1-hit).
- Backward seeks inside the block are cheap (random access within the block).
- The constant matters: `√10⁶ = 1000` vs. `(1/2)log 10⁶ ≈ 10` is a 100× reduction in the second phase.

When the block is on tape or paged storage and backward seeks within the block are expensive, **don't switch to binary** — linear scan inside one already-loaded block is the right move.

### Implementation

**Go:**
```go
package jumpsearch

import "math"

func JumpBinarySearch(arr []int, target int) int {
    n := len(arr)
    if n == 0 {
        return -1
    }
    m := int(math.Sqrt(float64(n)))
    if m < 1 {
        m = 1
    }

    // Phase 1: jump until overshoot.
    prev := 0
    step := m
    for step < n && arr[step-1] < target {
        prev = step
        step += m
    }

    // Phase 2: BINARY search inside [prev, min(step, n)).
    lo := prev
    hi := step - 1
    if hi >= n {
        hi = n - 1
    }
    for lo <= hi {
        mid := lo + (hi-lo)/2
        if arr[mid] == target {
            return mid
        }
        if arr[mid] < target {
            lo = mid + 1
        } else {
            hi = mid - 1
        }
    }
    return -1
}
```

**Java:**
```java
public static int jumpBinarySearch(int[] arr, int target) {
    int n = arr.length;
    if (n == 0) return -1;
    int m = Math.max(1, (int) Math.sqrt(n));

    int prev = 0, step = m;
    while (step < n && arr[step - 1] < target) {
        prev = step;
        step += m;
    }

    int lo = prev, hi = Math.min(step, n) - 1;
    while (lo <= hi) {
        int mid = lo + (hi - lo) / 2;
        if (arr[mid] == target) return mid;
        if (arr[mid] < target)  lo = mid + 1;
        else                    hi = mid - 1;
    }
    return -1;
}
```

**Python:**
```python
import math
from bisect import bisect_left

def jump_binary_search(arr, target):
    n = len(arr)
    if n == 0:
        return -1
    m = max(1, int(math.isqrt(n)))

    prev, step = 0, m
    while step < n and arr[step - 1] < target:
        prev = step
        step += m

    # Binary search inside [prev, min(step, n))
    lo, hi = prev, min(step, n) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if arr[mid] == target:
            return mid
        if arr[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1
```

### Analysis

- Jump phase: up to `⌈√n⌉` comparisons.
- Binary phase: up to `⌈log₂(√n + 1)⌉ ≈ (1/2)log₂(n) + 1` comparisons.
- **Total: `√n + (1/2)log n + O(1)` comparisons** — still `O(√n)`, but with a much smaller second-phase constant.

In a benchmark on `n = 10⁶`, classic jump averages ~1500 comparisons per query; hybrid averages ~1010. The hybrid is essentially always better when random access is uniform.

### Why doesn't this dethrone binary search?

Because the **jump phase still costs `O(√n)`**. The hybrid improves the second phase from `O(√n)` to `O(log n)`, but the bottleneck remains the first phase. To break `O(√n)`, you must accelerate the jumps themselves — which is exactly what exponential search does (see §3).

---

<a name="linked-list"></a>
## 2. Jump Search on Linked Lists with Skip Pointers

A sorted singly-linked list cannot be binary-searched: each `mid` access costs `O(n)`. Linear search is `O(n)`. **Jump search with skip pointers** gives `O(√n)`.

### The data structure

Augment the linked list with an array of "skip pointers": every `m`-th node has a direct pointer to the node `m` positions later. With `m = √n`, you have `√n` skip pointers.

```
1 → 4 → 9 → 16 → 25 → 36 → 49 → 64 → 81 → 100 → 121 → 144 → 169 → 196 → 225 → 256
↓                  ↓                   ↓                    ↓
  skip-4    ━━━━━  skip-4    ━━━━━━━━  skip-4     ━━━━━━━  skip-4
```

`skip[0]` points at the head, `skip[1]` at index 4, `skip[2]` at index 8, etc. Building this auxiliary array is `O(n)` time and `O(√n)` extra space.

### The search

```python
import math

class Node:
    __slots__ = ("val", "next")
    def __init__(self, v):
        self.val = v
        self.next = None

def build_skip(head, n, m):
    """Build an array of every m-th node from head."""
    skip = []
    cur = head
    i = 0
    while cur is not None:
        if i % m == 0:
            skip.append(cur)
        cur = cur.next
        i += 1
    return skip

def jump_search_linked(head, n, target):
    if n == 0 or head is None:
        return None
    m = max(1, int(math.isqrt(n)))
    skip = build_skip(head, n, m)

    # Jump phase: scan the skip array.
    block = 0
    while block + 1 < len(skip) and skip[block + 1].val <= target:
        block += 1

    # Linear phase: walk forward from skip[block] up to m steps.
    cur = skip[block]
    for _ in range(m):
        if cur is None:
            break
        if cur.val == target:
            return cur
        if cur.val > target:
            return None
        cur = cur.next
    return None
```

**Go:**
```go
package jumpsearch

import "math"

type Node struct {
    Val  int
    Next *Node
}

func buildSkip(head *Node, n, m int) []*Node {
    skip := make([]*Node, 0, (n+m-1)/m)
    cur := head
    i := 0
    for cur != nil {
        if i%m == 0 {
            skip = append(skip, cur)
        }
        cur = cur.Next
        i++
    }
    return skip
}

func JumpSearchLinked(head *Node, n, target int) *Node {
    if n == 0 || head == nil {
        return nil
    }
    m := int(math.Sqrt(float64(n)))
    if m < 1 {
        m = 1
    }
    skip := buildSkip(head, n, m)
    block := 0
    for block+1 < len(skip) && skip[block+1].Val <= target {
        block++
    }
    cur := skip[block]
    for i := 0; i < m && cur != nil; i++ {
        if cur.Val == target {
            return cur
        }
        if cur.Val > target {
            return nil
        }
        cur = cur.Next
    }
    return nil
}
```

**Java:**
```java
import java.util.ArrayList;
import java.util.List;

public class JumpLinked {
    static class Node {
        int val;
        Node next;
        Node(int v) { this.val = v; }
    }

    public static Node search(Node head, int n, int target) {
        if (n == 0 || head == null) return null;
        int m = Math.max(1, (int) Math.sqrt(n));

        List<Node> skip = new ArrayList<>();
        Node cur = head;
        int i = 0;
        while (cur != null) {
            if (i % m == 0) skip.add(cur);
            cur = cur.next;
            i++;
        }

        int block = 0;
        while (block + 1 < skip.size() && skip.get(block + 1).val <= target) {
            block++;
        }

        Node walker = skip.get(block);
        for (int k = 0; k < m && walker != null; k++) {
            if (walker.val == target) return walker;
            if (walker.val > target)  return null;
            walker = walker.next;
        }
        return null;
    }
}
```

### Complexity

- **Skip array scan:** `O(√n)` comparisons.
- **Linear walk inside block:** `O(√n)` comparisons.
- **Total:** `O(√n)` time.
- **Extra space:** `O(√n)` for the skip array.
- **Build cost:** `O(n)` one-time.

### Relationship to skip lists

A **skip list** (Pugh, 1990) generalizes this idea: instead of one level of skip pointers spaced `√n` apart, use *log n* levels of pointers where level `k` skips `2^k` nodes (randomized expected). Lookup becomes `O(log n)` expected.

The single-level deterministic version we built above is the conceptual ancestor. If `√n` skip pointers give `O(√n)` lookup, then by recursion `√√n` skip-skip pointers give `O(√√n)` for the skip phase, then `O(√n)` total — and you can keep going. Skip lists are the limit of this construction with randomized levels.

### Production use

Pure single-level skip-pointer linked lists are rare in production today; the multi-level skip list (and its concurrent variants, like Java's `ConcurrentSkipListMap`) dominates. But the structure is still taught because:

1. It's the simplest example of trading space (`O(√n)`) for lookup speed (`O(√n)`).
2. It's the foundation for understanding skip lists.
3. It appears in disk-based sorted indexes where leaf nodes are linked lists.

---

<a name="exponential"></a>
## 3. Exponential / Galloping Search — Jump's Adaptive Cousin

Plain jump search jumps by a **fixed** stride `√n`. **Exponential search** (Bentley & Yao, 1976) jumps by a **doubling** stride: `1, 2, 4, 8, 16, ...`. Once it overshoots, it does a binary search on the resulting range.

### Why doubling?

Fixed `√n` makes sense when you know `n` and want `O(√n)` worst case. But if the target is near the front of the array, fixed-stride jump search wastes work: even a target at index 5 forces you to do at least one full `√n` jump.

Exponential search is **adaptive**: it finds a target at position `k` in `O(log k)` comparisons, regardless of total `n`.

### Implementation

**Go:**
```go
package jumpsearch

func ExponentialSearch(arr []int, target int) int {
    n := len(arr)
    if n == 0 {
        return -1
    }
    if arr[0] == target {
        return 0
    }

    // Doubling phase: find an upper bound.
    bound := 1
    for bound < n && arr[bound] < target {
        bound *= 2
    }

    // Binary search in [bound/2, min(bound, n-1)].
    lo := bound / 2
    hi := bound
    if hi >= n {
        hi = n - 1
    }
    for lo <= hi {
        mid := lo + (hi-lo)/2
        if arr[mid] == target {
            return mid
        }
        if arr[mid] < target {
            lo = mid + 1
        } else {
            hi = mid - 1
        }
    }
    return -1
}
```

**Java:**
```java
public static int exponentialSearch(int[] arr, int target) {
    int n = arr.length;
    if (n == 0) return -1;
    if (arr[0] == target) return 0;

    int bound = 1;
    while (bound < n && arr[bound] < target) bound *= 2;

    int lo = bound / 2;
    int hi = Math.min(bound, n - 1);
    while (lo <= hi) {
        int mid = lo + (hi - lo) / 2;
        if (arr[mid] == target) return mid;
        if (arr[mid] < target)  lo = mid + 1;
        else                    hi = mid - 1;
    }
    return -1;
}
```

**Python:**
```python
def exponential_search(arr, target):
    n = len(arr)
    if n == 0:
        return -1
    if arr[0] == target:
        return 0
    bound = 1
    while bound < n and arr[bound] < target:
        bound *= 2
    lo = bound // 2
    hi = min(bound, n - 1)
    while lo <= hi:
        mid = (lo + hi) // 2
        if arr[mid] == target:
            return mid
        if arr[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1
```

### Complexity

If the target is at position `k`:
- Doubling phase: `O(log k)` — we double until we exceed `k`.
- Binary search phase: `O(log k)` — the range `[k/2, 2k]` has size `O(k)`.
- **Total: `O(log k)`** — *not* `O(log n)`. Independent of array length.

For targets near the front of a huge sorted file, exponential search is **enormously** better than binary search:
- Binary on `n = 10⁹` looking for position 100: ~30 comparisons.
- Exponential on the same: `log₂(200) ≈ 8` comparisons.

### Jump vs Exponential — when to choose

| Property | Jump (`√n`) | Exponential (doubling) |
|---|---|---|
| **Best at front** | No — still `O(√n)` | Yes — `O(log k)` |
| **Worst overall** | `O(√n)` | `O(log n)` |
| **Bounded `n`?** | Yes, must know `n` | No — handles unbounded streams |
| **Forward-only friendly** | Yes (linear scan in block) | Yes-ish (binary inside range still random) |
| **Implementation simplicity** | Simpler — one loop, one stride | Two phases — doubling then binary |

In practice, **exponential search dominates** jump search on adaptive workloads and unbounded streams. Jump search wins specifically when forward-only access matters more than adaptivity.

### Galloping search in TimSort

Java's `Arrays.sort` (TimSort) uses **galloping search** — essentially exponential search — to find where one run's first element should be inserted into another. The doubling structure exploits the fact that, after merging many runs, consecutive runs' boundaries are typically close, so `O(log k)` for `k = small` saves a lot over `O(log n)`.

---

<a name="variable"></a>
## 4. Variable Block Sizes and Distribution Awareness

Plain jump search uses fixed `m = √n`. When the data has a known **distribution**, you can do better.

### Skewed data

Suppose your array stores Unix timestamps that were collected at irregular intervals: 90% of events in the first 10% of time range, sparse afterward. With fixed-size blocks, the first 10% of indices have density 9× the rest — so the linear-phase cost varies wildly depending on which block you land in.

A **distribution-aware** jump search adjusts block size based on local density:

```python
def adaptive_jump(arr, target):
    n = len(arr)
    if n == 0:
        return -1
    # Estimate "density" near the target via the value range.
    lo_val, hi_val = arr[0], arr[-1]
    if lo_val == hi_val:
        return 0 if lo_val == target else -1
    # Interpolation-based initial stride.
    frac = (target - lo_val) / (hi_val - lo_val)
    estimated_idx = max(0, min(n - 1, int(frac * n)))
    # Use a stride proportional to √n but biased toward estimated_idx.
    base = max(1, int(n ** 0.5))
    # Snap forward to estimated_idx in big chunks first, then refine.
    prev = 0
    step = base
    while step < n and arr[step - 1] < target:
        prev = step
        # Bigger stride when we're far from estimated_idx, smaller when close.
        if abs(step - estimated_idx) > base:
            step += base * 2
        else:
            step += base
    # Linear scan inside block.
    for i in range(prev, min(step, n)):
        if arr[i] == target:
            return i
        if arr[i] > target:
            return -1
    return -1
```

In production, this is rarely worth the complexity. **Interpolation search** (which we cover separately) is the cleaner answer for uniformly distributed data. Variable-stride jump search is a teaching aid for "asymptotics are not destiny" rather than a real-world choice.

### Block sizes other than `√n`

Sometimes domain constraints dictate a block size:

- **Block-aligned files:** `m = page_size / element_size`. The "block" is now a physical I/O unit.
- **B-tree leaves:** `m = leaf_node_capacity`.
- **Sqrt decomposition on `n = 10⁵`:** people often use `m = 350` instead of `316` because 350 divides evenly into common test sizes and improves cache alignment.

If `m` is fixed by infrastructure rather than chosen for asymptotic optimality, you accept the `O(n/m + m)` cost with whatever `m` you have. The algorithm still works; it's just no longer at the `√n` optimum.

---

<a name="sqrt-decomp"></a>
## 5. Sqrt Decomposition — Jump Search Generalized

**Sqrt decomposition** is a family of data structure techniques where an array of size `n` is split into `√n` blocks of size `√n`. Each block maintains a precomputed aggregate (sum, max, xor, GCD, ...). Range queries and point updates become `O(√n)`.

### The data structure

```
arr =   [a₀, a₁, a₂, ..., a_{n-1}]
blocks = [ block 0  ][ block 1  ]...[ block ⌈n/m⌉-1 ]   each size m = √n
agg =    [ Σ b0     , Σ b1      , ..., Σ b_{k-1}     ]
```

`agg[k]` is the precomputed sum (or max, or whatever) of block `k`.

### Range sum query `[l, r]`

```python
def range_sum(arr, agg, m, l, r):
    s = 0
    while l <= r and l % m != 0:        # walk left partial block
        s += arr[l]; l += 1
    while l + m - 1 <= r:               # full blocks
        s += agg[l // m]
        l += m
    while l <= r:                       # walk right partial block
        s += arr[l]; l += 1
    return s
```

The three loops are **at most `√n` iterations each** — the partials are within a block, and the full-block loop runs `O(√n)` times. Total `O(√n)`.

### Point update

```python
def update(arr, agg, m, i, val):
    arr[i] = val
    block_id = i // m
    agg[block_id] = sum(arr[block_id * m : (block_id + 1) * m])
```

Both `O(√n)` (recomputing one block's aggregate).

### Connection to jump search

Sqrt decomposition uses **exactly the same block structure** as jump search. The "jump phase" of a search is the "full-blocks" loop. The "linear phase" of a search is the "partial-block" loop. The block size `√n` is optimal for the same AM-GM reason.

If you understand jump search, you understand the spine of sqrt decomposition.

### Where it appears in competitive programming

- **Range sum / max / min over a mutable array** (when you don't want to use a segment tree).
- **Mo's algorithm** for offline range queries — sort queries by `(left/√n, right)` and process; each block transition costs `O(√n)`.
- **K-th smallest in a range** with offline queries.
- **Heavy-light decomposition** on trees with bucketed branches.

For competitive programmers, "block size `√n`" is reflexive. The jump-search intuition transfers directly.

### Sqrt decomposition variants

- **Block size `√(n log n)`** for some range-query problems where the aggregate update has logarithmic cost.
- **Two-level decomposition**: blocks of `n^(2/3)` containing sub-blocks of `n^(1/3)` — for problems where two-level updates dominate.
- **Cache-conscious block sizes**: `m = cache_line_size / element_size`, ignoring `√n` entirely, for tight-loop performance work.

---

<a name="vs-binary"></a>
## 6. Jump vs Binary Across Access Models

### Model 1 — In-RAM, random-access `int[]`

Binary search wins decisively. Cache-line jumps don't matter (everything fits in L2/L3 for `n ≤ 10⁶`), branch prediction handles binary search's tight loop well, and `log n` < `√n` for any `n > 1`. **No reason to use jump search here.**

### Model 2 — On-disk sorted file with random seeks (SSD)

Each I/O is ~100 µs. Binary search: `log n` I/Os ≈ 30 × 100 µs = 3 ms. Jump search: `√n` I/Os ≈ 1000 × 100 µs = 100 ms. Binary still wins by ~30×.

**Exception:** if you can stream the block once located (sequential read at GB/s), jump-then-stream may win. But on SSDs the per-I/O cost is dominated by latency, not throughput, so binary's fewer seeks usually win.

### Model 3 — On-tape or rotating-media sorted data

Forward seek is fast; backward seek is slow. Binary search's bidirectional probes are penalized: each "go left" probe requires reversing the spindle (~seconds). Jump search uses **only forward seeks** during the jump phase, with at most `√n` backward steps inside one already-loaded block — and that block can be cached in memory before the linear phase.

In this model, jump search can be **50–100× faster** than binary search, depending on the asymmetry between forward and backward seek costs.

### Model 4 — Singly-linked list

- Linear search: `O(n)`.
- Binary search: `O(n)` per probe × `log n` probes = `O(n log n)`. Worse than linear.
- Jump search **with skip pointers**: `O(√n)` time, `O(√n)` extra space.

Jump search wins by construction. (Skip lists generalize to `O(log n)` expected, but require multi-level pointers.)

### Model 5 — Streaming sorted data without random access

Binary search is **impossible** — you can't seek backward. Jump search adapted to streaming reads the data forward in chunks of `√n`, comparing the last element of each chunk against the target. Once you overshoot, the current chunk is in your buffer; linear-scan it.

This is essentially how some streaming database engines locate a row inside a sorted column block in Parquet / ORC.

### Model 6 — Network-paged data with high per-request overhead

Binary search: `log n` requests, each ~100 ms = ~3 seconds for `n = 10⁹`. Jump search: `√n` requests pipelined as sequential range reads, often <1 second on a CDN-style cache.

This is why bandwidth-bounded distributed storage layers (S3 byte-range reads, HDFS block reads) sometimes prefer jump-style scans over binary search for sorted blobs.

### Summary

| Access model | Winner |
|---|---|
| In-RAM array, random access | **Binary** |
| SSD sorted file, random seek | **Binary** (usually) |
| HDD / tape, backward seek expensive | **Jump** |
| Singly-linked list with skip pointers | **Jump** |
| Streaming, no rewind | **Jump** (binary impossible) |
| Bandwidth-bounded network paged | **Jump** (often) |
| Unknown / unbounded length | **Exponential** (best of both) |

The right answer to "should I use jump or binary?" is: **what does access cost look like in your storage model?** If forward seeks are cheap and backward seeks are expensive (or impossible), jump wins. Otherwise, binary wins.

---

## Cheat Sheet — Algorithm Selection

```
Question                                            Best tool
---------                                           ----------
Sorted array in RAM, random access                  Binary search (O(log n))
Sorted array on tape / append-only log              Jump search (O(√n) fwd-only)
Sorted singly-linked list with skip pointers        Jump search (O(√n))
Sorted streaming data, no rewind                    Jump search (O(√n))
Target near front of huge sorted data               Exponential search (O(log k))
Unbounded sorted data, length unknown               Exponential search
Sorted array + mutable + range query                Sqrt decomposition (O(√n))
Sorted array + mutable + frequent updates           Segment tree (O(log n))
Distribution-uniform, fast in-RAM lookup            Interpolation search (O(log log n))
```

---

## Further Reading

- **Shneiderman**, "Jump Searching: A Fast Sequential Search Technique" (CACM, 1978).
- **Bentley & Yao**, "An Almost Optimal Algorithm for Unbounded Searching" (1976) — exponential search.
- **Pugh**, "Skip Lists: A Probabilistic Alternative to Balanced Trees" (1990).
- **Sleator & Tarjan**, "Self-Adjusting Binary Search Trees" (1985) — splay trees, related adaptive structures.
- **Mo's algorithm** for offline range queries — `https://codeforces.com/blog/entry/72690`.
- Continue with `senior.md` for production usage: sorted log file scans, Parquet column block lookup, Cassandra SSTable index blocks, and forward-only sorted streams in distributed systems.
