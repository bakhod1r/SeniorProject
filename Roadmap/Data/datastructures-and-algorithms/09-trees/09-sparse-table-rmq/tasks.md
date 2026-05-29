# Sparse Table & RMQ — Hands-On Tasks

> Ten implementation tasks, ordered from foundational to advanced. Each has a clear acceptance test and a reference solution sketch. Solve them in any language (templates given in Python for brevity).

---

## Task 1 — Implement Sparse Table for Range Min

**Goal.** Build the canonical sparse table over an integer array supporting `query(l, r) -> int`.

**Requirements.**
- `O(n log n)` preprocessing time and space.
- `O(1)` query.
- Inclusive bounds: `query(l, r)` returns `min(arr[l..r])`.
- Handle the empty array gracefully.

**Acceptance test:**
```python
st = SparseTable([3, 1, 4, 1, 5, 9, 2, 6])
assert st.query(0, 7) == 1
assert st.query(2, 6) == 1
assert st.query(4, 5) == 5
assert st.query(6, 7) == 2
assert st.query(0, 0) == 3
```

**Reference sketch.** Build row 0 as a copy of the input. For `k = 1..floor(log2(n))`, set `st[k][i] = min(st[k-1][i], st[k-1][i + 2^(k-1)])`. Query uses `k = floor(log2(r - l + 1))` and reads two cells.

---

## Task 2 — Generalize to a `combine` Function

**Goal.** Refactor task 1 to accept an arbitrary idempotent binary operation as a parameter. Verify with `min`, `max`, `gcd`, `bitwise AND`, `bitwise OR`.

**Acceptance test:**
```python
import operator, math
arr = [12, 8, 18, 24, 6, 30]
st_min = SparseTableOp(arr, min)
st_max = SparseTableOp(arr, max)
st_gcd = SparseTableOp(arr, math.gcd)
st_and = SparseTableOp(arr, operator.and_)
st_or  = SparseTableOp(arr, operator.or_)

assert st_min.query(1, 4) == 6
assert st_max.query(0, 5) == 30
assert st_gcd.query(0, 5) == 2
assert st_and.query(0, 5) == (12 & 8 & 18 & 24 & 6 & 30)
assert st_or.query(0, 5)  == (12 | 8 | 18 | 24 | 6 | 30)
```

**Caveat.** Add a docstring warning that `op` MUST be idempotent. A randomized test catches accidents:
```python
import random
for _ in range(100):
    a = [random.randint(0, 1000) for _ in range(50)]
    st = SparseTableOp(a, min)
    l, r = sorted(random.sample(range(50), 2))
    assert st.query(l, r) == min(a[l:r+1])
```

---

## Task 3 — O(1) Log Lookup via Precomputed Log Table

**Goal.** Replace any `math.log2` in your code with a precomputed integer log table. Verify equivalence on `n = 1..10000`.

**Acceptance test:**
```python
def build_log(n):
    lg = [0] * (n + 1)
    for i in range(2, n + 1):
        lg[i] = lg[i // 2] + 1
    return lg

lg = build_log(10000)
for x in range(1, 10001):
    assert lg[x] == int.bit_length(x) - 1
```

**Discussion.** The two methods agree everywhere; the table is one memory read, `bit_length` is one CPU instruction on modern hardware. Either is fine.

---

## Task 4 — Cartesian Tree Construction in O(n)

**Goal.** Given an array, build the Cartesian tree (each node stores parent pointer) using the stack-based algorithm of Gabow, Bentley, Tarjan (1984).

**Acceptance test:** the constructed parent pointers satisfy:
- exactly one node has `parent == -1` (the root, at the index of the global min);
- in-order traversal of the tree visits indices `0..n-1` in order;
- for every non-root `i`, `arr[parent[i]] <= arr[i]`.

```python
def cartesian_tree(arr):
    n = len(arr)
    parent = [-1] * n
    stack = []
    for i in range(n):
        last = -1
        while stack and arr[stack[-1]] > arr[i]:
            last = stack.pop()
        if last != -1: parent[last] = i
        if stack: parent[i] = stack[-1]
        stack.append(i)
    return parent

arr = [3, 1, 4, 1, 5, 9, 2, 6]
p = cartesian_tree(arr)
root = p.index(-1)
assert arr[root] == min(arr)
# Verify heap property:
for i, par in enumerate(p):
    if par != -1:
        assert arr[par] <= arr[i]
```

---

## Task 5 — RMQ via Cartesian Tree + Euler Tour (Bender-Farach-Colton)

**Goal.** Use the Cartesian tree from task 4. Compute an Euler tour. Use sparse table on the depth array to answer RMQ in O(1).

**Steps:**
1. Build the Cartesian tree (task 4).
2. DFS the tree recording the Euler tour and depth sequence.
3. Record `first[i]` — the first time node `i` appears in the tour.
4. Build a sparse table on the depth array storing the **index** of the min.
5. For RMQ `(l, r)`: compute the LCA of nodes `l` and `r` in the Cartesian tree using the sparse table; this LCA index is the answer.

**Acceptance test:** matches the plain sparse table on random inputs.

```python
import random
arr = [random.randint(0, 1000) for _ in range(100)]
bft = BenderFarachColton(arr)  # your implementation
plain = SparseTable(arr)
for _ in range(1000):
    l, r = sorted(random.sample(range(100), 2))
    assert bft.query_min(l, r) == plain.query(l, r)
```

---

## Task 6 — 2D Sparse Table for Rectangle Min

**Goal.** Build a 2-D sparse table supporting rectangle min queries on a static grid.

**Acceptance test:**
```python
g = [
    [3, 1, 4, 1],
    [5, 9, 2, 6],
    [5, 3, 5, 8],
    [9, 7, 9, 3],
]
st2 = ST2D(g)
assert st2.query(0, 0, 3, 3) == 1
assert st2.query(1, 0, 3, 2) == 2
assert st2.query(2, 1, 3, 3) == 3
assert st2.query(0, 0, 0, 3) == 1
```

**Complexity.** O(n·m·log n·log m) build, O(1) query reading four cells.

---

## Task 7 — Disjoint Sparse Table for Range Sum

**Goal.** Implement the disjoint sparse table over a static array, supporting range sum in O(1). The result must agree with prefix sums.

**Acceptance test:**
```python
import random
a = [random.randint(-100, 100) for _ in range(200)]
dst = DisjointSparseSum(a)
ps = [0]
for x in a: ps.append(ps[-1] + x)
for _ in range(1000):
    l, r = sorted(random.sample(range(200), 2))
    assert dst.query(l, r) == ps[r + 1] - ps[l]
```

**Discussion.** For pure integer sum, prefix sums are simpler and faster. The disjoint sparse table earns its keep on **non-invertible monoids** like string concatenation or matrix product, where prefix sums don't apply.

---

## Task 8 — Build LCP from Suffix Array via Kasai, Then RMQ for LCE

**Goal.** Given a string `S`:
1. Build the suffix array (any algorithm — naive O(n² log n) is fine for testing).
2. Compute the LCP array using Kasai's algorithm in O(n).
3. Build a min-sparse-table over LCP.
4. Answer LCE queries: given two positions `i, j`, find the longest common prefix of `S[i..]` and `S[j..]` in O(1).

**Acceptance test:**
```python
s = "banana"
# Brute LCE:
def lce_brute(s, i, j):
    n = len(s); k = 0
    while i + k < n and j + k < n and s[i+k] == s[j+k]: k += 1
    return k

# Built structure:
sa = suffix_array(s)        # your implementation
rank, st = lce_preprocess(s, sa)

for i in range(len(s)):
    for j in range(i + 1, len(s)):
        assert lce(rank, st, i, j) == lce_brute(s, i, j)
```

**Output.** For `"banana"` the LCE of suffix 1 (`"anana"`) and suffix 3 (`"ana"`) is 3.

---

## Task 9 — Benchmark Sparse Table vs Segment Tree on 10⁶ Queries

**Goal.** Generate a random array of `n = 10⁶` integers and `q = 10⁶` random `(l, r)` queries. Measure:
- Build time of sparse table vs segment tree.
- Total query time of each.
- Queries per second of each.

**Expected results on a modern x86 CPU:**

| Structure | Build (10⁶ elts) | Query (10⁶ queries) | Q/sec |
|---|---|---|---|
| Sparse table | ~200 ms | ~20 ms | ~50 M |
| Segment tree | ~50 ms | ~300 ms | ~3 M |

Sparse table queries are ~15× faster but build is ~4× slower. Trade-off depends on the build:query ratio in your workload.

**Implementation pointers.**
- Use `time.perf_counter()` in Python or `time.Now()` in Go.
- Warm up with 10⁴ queries before timing.
- Use **the same random seed** across runs.

---

## Task 10 — LeetCode 84 (Largest Rectangle) Using Sparse Table + Divide & Conquer

**Goal.** Implement the divide-and-conquer solution to LC 84:
- Build sparse table storing the **index** of the min height in any range.
- `solve(l, r) = max( h[argmin] * (r - l + 1), solve(l, m - 1), solve(m + 1, r) )` where `m = argmin(l, r)`.

**Acceptance test:**
```python
assert largest_rectangle([2, 1, 5, 6, 2, 3]) == 10
assert largest_rectangle([2, 4]) == 4
assert largest_rectangle([6, 7, 5, 2, 4, 5, 9, 3]) == 16
```

**Discussion.** This is **O(n log n) average** because the recursion depth equals the Cartesian tree depth, which is `O(log n)` for random arrays but can be `O(n)` on adversarial input (already sorted). The monotonic-stack solution is **strictly O(n) worst-case** — use it in interviews. The sparse-table version is included to demonstrate the "argmin sparse table" technique that appears in advanced range-query problems.

---

## Optional Stretch: Task 11 — Compare With `math/bits.Len` Hardware Path

**Goal.** In Go (or Java with `Integer.numberOfLeadingZeros`), measure the speed difference between:
- log-table lookup
- `bits.Len(uint(L)) - 1` hardware path

On a typical x86 CPU you should see the hardware path slightly faster (single `lzcnt` vs single memory read). On cold caches the difference is larger because the log table can fall out of L1.

```go
// Microbench harness:
func BenchmarkLogTable(b *testing.B) {
    lg := buildLogTable(1 << 20)
    var sum int
    for i := 0; i < b.N; i++ {
        sum += lg[1 + (i & ((1 << 20) - 1))]
    }
    _ = sum
}

func BenchmarkBitsLen(b *testing.B) {
    var sum int
    for i := 0; i < b.N; i++ {
        sum += bits.Len(uint(1 + (i & ((1 << 20) - 1)))) - 1
    }
    _ = sum
}
```

---

## What You Should Be Able to Do After These Tasks

- Write a sparse table from scratch in any of Go/Java/Python in under five minutes.
- Choose the right structure for any "range query" problem: sparse table, segment tree, Fenwick, prefix sums, or disjoint sparse table.
- Build the Cartesian tree of an array and explain its relationship to RMQ and LCA.
- Construct suffix array, LCP array via Kasai, and answer LCE queries in O(1).
- Benchmark sparse table vs segment tree and explain when each wins.
- Implement 2D and disjoint sparse tables for the less common but still real query types.

Mastery of these tasks puts you in the top percentile for interview competence on range-query problems — and gives you the toolkit used in production by Lucene, BWA, sdsl-lite, and the modern wave of compressed text indexes.
