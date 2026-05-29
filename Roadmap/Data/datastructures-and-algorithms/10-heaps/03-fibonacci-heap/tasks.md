# Fibonacci Heap — Practice Tasks

> All tasks must be solved in Go, Java, and Python.

These tasks build a Fibonacci heap from scratch, validate its amortized properties experimentally, and pit it against simpler heaps on realistic graph workloads. Treat each task as a small lab: write the code, then write a short note on what you measured and why.

---

## Beginner Tasks (5)

### Task 1 — Insert and find-min with root-list integrity

Build the skeleton of a Fibonacci heap supporting only `insert(key)` and `findMin()`. Each insert appends a new singleton tree to the root list and updates the min pointer in O(1). After every insert, walk the root list once and assert that (a) the doubly linked circular list is intact, (b) the min pointer truly points to the smallest key, and (c) `n` matches the number of nodes you have inserted.

I/O spec — read a sequence of integers from stdin, print `findMin` after each insert.
Constraints — n ≤ 10⁵, keys fit in int64.
Hint — keep `min` as a pointer/reference, not an index; updating it on insert is just a compare.

```go
package main

type node struct {
    key                int64
    parent, child      *node
    left, right        *node
    degree             int
    mark               bool
}

type FibHeap struct {
    min *node
    n   int
}

func (h *FibHeap) Insert(k int64) *node {
    x := &node{key: k}
    x.left, x.right = x, x
    // TODO: splice x into root list, update h.min, h.n++
    return x
}

func (h *FibHeap) FindMin() (int64, bool) {
    // TODO
    return 0, false
}

func (h *FibHeap) checkRootList() {
    // TODO: walk root list once, assert circularity and min correctness
}
```

```java
public class FibHeap {
    static final class Node {
        long key;
        Node parent, child, left, right;
        int degree;
        boolean mark;
    }

    private Node min;
    private int n;

    public Node insert(long k) {
        Node x = new Node();
        x.key = k;
        x.left = x;
        x.right = x;
        // TODO: splice into root list, update min, n++
        return x;
    }

    public long findMin() {
        // TODO
        return 0;
    }

    void checkRootList() {
        // TODO
    }
}
```

```python
class Node:
    __slots__ = ("key", "parent", "child", "left", "right", "degree", "mark")
    def __init__(self, k):
        self.key = k
        self.parent = self.child = None
        self.left = self.right = self
        self.degree = 0
        self.mark = False

class FibHeap:
    def __init__(self):
        self.min = None
        self.n = 0

    def insert(self, k):
        x = Node(k)
        # TODO: splice into root list, update self.min, self.n += 1
        return x

    def find_min(self):
        # TODO
        return None

    def _check_root_list(self):
        # TODO: walk root list, assert circularity and min correctness
        pass
```

Evaluation criteria — root-list invariants hold after every operation; `findMin` is O(1); the same input produces identical output across all three languages.

---

### Task 2 — meld(h1, h2) in O(1)

Implement `meld(h1, h2)` which destructively unions two Fibonacci heaps in O(1) by splicing their root lists and picking the smaller of the two min pointers. The result is a single heap; the input heaps must be left empty (or invalidated).

I/O spec — read two sequences, build two heaps, meld them, then print `findMin`.
Constraints — total n ≤ 10⁶.
Hint — splicing two circular doubly linked lists is four pointer assignments, nothing more.

```go
func Meld(a, b *FibHeap) *FibHeap {
    if a.min == nil { return b }
    if b.min == nil { return a }
    // TODO: splice root lists in O(1)
    out := &FibHeap{}
    // out.min = min(a.min, b.min by key)
    out.n = a.n + b.n
    return out
}
```

```java
public static FibHeap meld(FibHeap a, FibHeap b) {
    // TODO: O(1) splice
    return a;
}
```

```python
def meld(a, b):
    if a.min is None: return b
    if b.min is None: return a
    # TODO: splice root lists in O(1)
    return a
```

Evaluation criteria — no traversal of either heap during meld; both input heaps are explicitly emptied; the resulting heap passes the `checkRootList` test from Task 1.

---

### Task 3 — extract-min without consolidation

Implement `extractMin` that removes the min node and promotes its children to the root list, but skips consolidation. Run a workload of 10⁵ inserts and 10⁵ extracts; plot or print the average cost per extract over time. You should see the root list grow long and per-op cost climb roughly linearly.

I/O spec — print elapsed time per 10⁴ extract-min operations.
Constraints — measure with monotonic clock, average across at least three runs.
Hint — when there is no consolidation, the root list contains everything that was ever inserted minus what was extracted; the linear scan to find the new min dominates.

```go
func (h *FibHeap) ExtractMinNoConsolidate() (int64, bool) {
    z := h.min
    if z == nil { return 0, false }
    // TODO: promote children of z to root list, remove z, scan for new min
    h.n--
    return z.key, true
}
```

```java
public long extractMinNoConsolidate() {
    // TODO
    return Long.MIN_VALUE;
}
```

```python
def extract_min_no_consolidate(self):
    # TODO: promote children, remove min, linear scan for new min
    pass
```

Evaluation criteria — per-op cost growth is visibly super-constant; you describe in one paragraph why consolidation is needed amortized-wise.

---

### Task 4 — Consolidation and degree bound

Add consolidation: after every `extractMin`, walk the root list and repeatedly link trees of equal degree until all root degrees are distinct. After consolidation, assert that the maximum root degree is at most `⌊log_φ(n)⌋` where φ = (1+√5)/2.

I/O spec — print `(n, maxDegree, floor(log_phi(n)))` after every extract-min.
Constraints — n up to 10⁶.
Hint — use a stack-allocated array `A[0..D(n)]` indexed by degree; D(n) = ⌊log_φ n⌋+1 is enough.

```go
import "math"

func (h *FibHeap) consolidate() {
    D := int(math.Floor(math.Log(float64(h.n))/math.Log(1.6180339887))) + 2
    A := make([]*node, D)
    // TODO: iterate over root list, link equal-degree trees via A
}
```

```java
private void consolidate() {
    int D = (int) Math.floor(Math.log(n) / Math.log(1.6180339887)) + 2;
    Node[] A = new Node[D];
    // TODO
}
```

```python
import math
PHI = (1 + 5 ** 0.5) / 2

def _consolidate(self):
    D = int(math.log(max(self.n, 2), PHI)) + 2
    A = [None] * D
    # TODO
```

Evaluation criteria — the degree-bound assertion never fires across 10⁶ ops; consolidation does not break the parent/child/sibling invariants.

---

### Task 5 — Print the heap as a forest

Pretty-print the current state of the heap: one tree per root, children indented under their parent. This is your visual debugger for every later task.

I/O spec — pass the heap to `dump()`; output goes to stdout as ASCII text.
Constraints — must work for at least 10⁴ nodes without stack overflow (use iteration or explicit stack).
Hint — pre-order DFS per root tree; mark cut nodes with an asterisk so you can see them in Task 6.

```go
func (h *FibHeap) Dump() {
    if h.min == nil { return }
    r := h.min
    for {
        dumpTree(r, 0)
        r = r.right
        if r == h.min { break }
    }
}

func dumpTree(x *node, depth int) {
    // TODO: print key, recurse into x.child
}
```

```java
public void dump() {
    // TODO: walk root list, print each tree
}
```

```python
def dump(self):
    # TODO
    pass
```

Evaluation criteria — output is deterministic given a fixed traversal order; cut/marked nodes are visually distinguishable.

---

## Intermediate Tasks (5)

### Task 6 — decrease-key with cascading cuts

Implement `decreaseKey(x, k)`. If the new key violates the heap property against x's parent, cut x from its parent, move it to the root list, clear its mark, then cascade-cut up the chain: if the parent was already marked, cut it too and recurse; otherwise mark it.

I/O spec — interactive operations: `INSERT k`, `DEC i k`, `MIN`, `EXTRACT`. `i` refers to the i-th inserted node.
Constraints — n ≤ 10⁵, 10⁶ operations.
Hint — store handles returned by `insert` in an array so you can address nodes by their insertion index.

```go
func (h *FibHeap) DecreaseKey(x *node, k int64) {
    if k > x.key { panic("not a decrease") }
    x.key = k
    y := x.parent
    if y != nil && x.key < y.key {
        h.cut(x, y)
        h.cascadingCut(y)
    }
    if x.key < h.min.key { h.min = x }
}

func (h *FibHeap) cut(x, y *node) {
    // TODO: remove x from y's child list, add to root list, clear x.mark
}

func (h *FibHeap) cascadingCut(y *node) {
    // TODO: if y.parent != nil: if !y.mark { y.mark = true } else { cut + recurse }
}
```

```java
public void decreaseKey(Node x, long k) {
    if (k > x.key) throw new IllegalArgumentException();
    x.key = k;
    Node y = x.parent;
    if (y != null && x.key < y.key) {
        cut(x, y);
        cascadingCut(y);
    }
    if (x.key < min.key) min = x;
}
```

```python
def decrease_key(self, x, k):
    if k > x.key: raise ValueError
    x.key = k
    y = x.parent
    if y is not None and x.key < y.key:
        self._cut(x, y)
        self._cascading_cut(y)
    if x.key < self.min.key:
        self.min = x
```

Evaluation criteria — heap order holds after every operation; the maximum tree degree still respects the log_φ(n) bound; no node has more than one mark cleared in the wrong direction.

---

### Task 7 — Verify the potential function

The Fibonacci heap potential is Φ(H) = t(H) + 2·m(H) where t is the number of root-list trees and m the number of marked nodes. The classical amortized analysis says extract-min has actual cost O(D(n) + t(H)) but pays for it via a drop in Φ.

Instrument your heap to record `(actualWork, deltaPhi)` for every extract-min, where `actualWork` is a counter you bump on each link/scan/promotion, and `deltaPhi = Φ_after − Φ_before`. Run a mix of 10⁶ ops and print the empirical amortized cost = mean(actualWork + deltaPhi). It should be O(log n), not O(n).

I/O spec — `<n> <avg_actual> <avg_delta_phi> <avg_amortized>` per checkpoint of 10⁴ ops.
Constraints — actualWork counter must be incremented in exactly the spots theory counts.
Hint — `linkCount`, `scanCount`, and `promoteCount` together give a tight upper bound on actual work.

```go
type Counters struct {
    Links, Scans, Promotes int
    Phi                    int
}

func (h *FibHeap) currentPhi() int {
    // TODO: t + 2m
    return 0
}
```

```java
class Counters {
    long links, scans, promotes;
    long phi;
}
```

```python
def current_phi(self):
    # TODO
    return 0
```

Evaluation criteria — empirical amortized cost grows like log₂ n within a small constant factor; deviations are explained in a one-paragraph write-up.

---

### Task 8 — Delete via decrease-key to −∞

Implement `delete(x)` as `decreaseKey(x, -∞)` followed by `extractMin`. Validate that this matches the behavior of removing x directly and that the heap invariants survive.

I/O spec — `INSERT k`, `DELETE i`, `MIN` operations.
Constraints — DELETE on a node that has already been deleted must error, not silently corrupt.
Hint — use a sentinel value smaller than any legal key (e.g., `math.MinInt64 + 1` in Go); guard against re-decrease.

```go
const minusInf = int64(-1 << 62)

func (h *FibHeap) Delete(x *node) {
    h.DecreaseKey(x, minusInf)
    h.ExtractMin()
}
```

```java
public void delete(Node x) {
    decreaseKey(x, Long.MIN_VALUE / 2);
    extractMin();
}
```

```python
import math
def delete(self, x):
    self.decrease_key(x, -math.inf)
    self.extract_min()
```

Evaluation criteria — delete leaves the heap in the same state (modulo the deleted key) as a direct removal; no orphaned children or stale parent pointers remain.

---

### Task 9 — Dijkstra on a 10⁴-vertex graph

Build a random connected graph with V = 10⁴, E = 5·10⁴, edge weights uniformly in [1, 1000]. Run single-source shortest path from vertex 0 using your Fibonacci heap to manage the frontier, with `decreaseKey` on relaxation.

I/O spec — read V, E, then E triples (u, v, w); print the distance vector or its checksum.
Constraints — must finish within 5 seconds in the slower language of your three.
Hint — keep a `handles[V]` array mapping vertex → its node in the heap so `decreaseKey` is O(1) lookup.

```go
func Dijkstra(adj [][]Edge, src int) []int64 {
    n := len(adj)
    dist := make([]int64, n)
    for i := range dist { dist[i] = 1<<62 }
    dist[src] = 0
    h := &FibHeap{}
    handles := make([]*node, n)
    handles[src] = h.Insert(0)
    // TODO: relax edges using DecreaseKey on existing handles
    return dist
}

type Edge struct{ To int; W int64 }
```

```java
long[] dijkstra(List<List<Edge>> adj, int src) {
    int n = adj.size();
    long[] dist = new long[n];
    Arrays.fill(dist, Long.MAX_VALUE);
    dist[src] = 0;
    FibHeap h = new FibHeap();
    FibHeap.Node[] handles = new FibHeap.Node[n];
    // TODO
    return dist;
}
```

```python
def dijkstra(adj, src):
    n = len(adj)
    dist = [float('inf')] * n
    dist[src] = 0
    h = FibHeap()
    handles = [None] * n
    handles[src] = h.insert(0)
    # TODO
    return dist
```

Evaluation criteria — result matches a reference Dijkstra (use a binary heap); wall-clock time logged; no quadratic blowup from missing handles.

---

### Task 10 — Indexed binary heap vs Fibonacci on Dijkstra

Implement an indexed binary heap (binary heap + `pos[v]` array for O(log n) decrease-key). Run the same Dijkstra workload from Task 9 on both heaps. Record wall time, allocations, and `decreaseKey` count.

For most random graphs the indexed binary heap will be faster despite a worse asymptotic bound. Explain in 3–6 sentences why: cache locality, lower constants, and the fact that `decreaseKey` calls do not dominate for sparse random graphs.

I/O spec — `<heap> <V> <E> <wall_ms> <decKey_count>` per run.
Constraints — same graph instance fed to both heaps.
Hint — pin the random seed so the comparison is reproducible.

```go
type IndexedBinHeap struct {
    keys []int64
    pos  []int   // pos[v] = index in heap, -1 if absent
    items []int  // heap[i] = vertex id
}

func (h *IndexedBinHeap) DecreaseKey(v int, k int64) {
    // TODO: keys[v] = k; siftUp(pos[v])
}
```

```java
class IndexedBinHeap {
    long[] keys;
    int[] pos;
    int[] items;
    int size;
    // TODO
}
```

```python
class IndexedBinHeap:
    def __init__(self, n):
        self.keys = [float('inf')] * n
        self.pos = [-1] * n
        self.items = []

    def decrease_key(self, v, k):
        # TODO
        pass
```

Evaluation criteria — correctness against reference; clear table of timings; written explanation that goes beyond "binary heap is simpler".

---

## Advanced Tasks (5)

### Task 11 — Node pooling / arena allocator

GC pressure dominates Fibonacci-heap workloads in Java and Go. Replace per-node `new`/`malloc` with an arena: a slab allocator that hands out node slots from a pre-sized array and recycles freed slots via a free list. Measure GC count, GC pause time, and heap allocation rate before and after.

I/O spec — `<pooling on|off> <ops> <allocs_MB> <gc_pause_ms>`.
Constraints — must not leak: every freed slot is reused before any new slab is allocated.
Hint — in Go, profile with `runtime.MemStats` and `runtime.GC()` baseline; in Java, use `-Xlog:gc*` or JFR; in Python, this task is mostly an exercise in `__slots__` and `weakref`.

```go
type Arena struct {
    slab []node
    free []int32
    next int32
}

func (a *Arena) Alloc() *node {
    // TODO: pop from free list or bump next pointer
    return nil
}

func (a *Arena) Free(x *node) {
    // TODO: reset x and push its index onto free list
}
```

```java
final class Arena {
    private final Node[] slab;
    private final int[] free;
    private int freeTop, next;

    Arena(int cap) {
        slab = new Node[cap];
        free = new int[cap];
    }

    Node alloc() { /* TODO */ return null; }
    void free(Node x) { /* TODO */ }
}
```

```python
class Arena:
    def __init__(self, cap):
        self.slab = [Node(0) for _ in range(cap)]
        self.free = list(range(cap - 1, -1, -1))

    def alloc(self):
        # TODO
        pass

    def free(self, x):
        # TODO
        pass
```

Evaluation criteria — measurable drop in GC pause time (≥ 40% on a 10⁷-op workload in Java/Go); no node aliasing bugs; correctness is preserved.

---

### Task 12 — Iterative cascading_cut

The textbook `cascading_cut` is naturally recursive: cut, then recurse on the parent if it was marked. Convert it to an iterative loop. Worst case the chain is Θ(log_φ n) long, so this is not a stack-overflow concern in practice, but the iterative version is faster and clearer once you stop fearing tail calls.

I/O spec — same as Task 6.
Constraints — must not allocate per call.
Hint — `for y != nil { ... y = y.parent }` with two boolean branches inside the loop.

```go
func (h *FibHeap) cascadingCutIter(y *node) {
    for y != nil {
        p := y.parent
        if p == nil { return }
        if !y.mark {
            y.mark = true
            return
        }
        h.cut(y, p)
        y = p
    }
}
```

```java
private void cascadingCutIter(Node y) {
    while (y != null) {
        Node p = y.parent;
        if (p == null) return;
        if (!y.mark) { y.mark = true; return; }
        cut(y, p);
        y = p;
    }
}
```

```python
def _cascading_cut_iter(self, y):
    while y is not None:
        p = y.parent
        if p is None: return
        if not y.mark:
            y.mark = True
            return
        self._cut(y, p)
        y = p
```

Evaluation criteria — behavior identical to the recursive version on a large differential test (≥ 10⁶ randomized ops with the same seed); micro-benchmark shows non-negative speedup.

---

### Task 13 — Rank-pairing heap (Haeupler-Sen-Tarjan 2011)

Implement the type-1 rank-pairing heap. It matches Fibonacci heap asymptotics — O(1) amortized insert/meld/decrease-key, O(log n) amortized extract-min — but uses half-ordered binary trees and a much simpler `decreaseKey` rule (no cascading cuts; just adjust the rank of the path). Benchmark it against your Fibonacci heap and your indexed binary heap on the Task 9 Dijkstra workload.

I/O spec — `<heap_kind> <V> <E> <wall_ms> <decKey_count>`.
Constraints — produce identical shortest-path output across all three heaps.
Hint — read sections 2 and 3 of the HST paper; the rank-update rule on decrease-key is `r(x) = max(r(left(x)), r(right(x)) + 1)` propagated upward until it stabilizes.

```go
type rpNode struct {
    key                int64
    rank               int
    left, right, next  *rpNode
}

type RankPairingHeap struct {
    min *rpNode
}

func (h *RankPairingHeap) DecreaseKey(x *rpNode, k int64) {
    // TODO: update ranks along the path to root
}
```

```java
class RankPairingHeap {
    static final class Node { long key; int rank; Node left, right, next; }
    Node min;
    // TODO
}
```

```python
class RPNode:
    __slots__ = ("key", "rank", "left", "right", "next")

class RankPairingHeap:
    def __init__(self):
        self.min = None
    def decrease_key(self, x, k):
        # TODO
        pass
```

Evaluation criteria — correctness against the reference Dijkstra; written comparison of the three heaps with at least one surprising finding (e.g., rank-pairing wins on heavy decrease-key workloads but loses on extract-heavy ones).

---

### Task 14 — Sketch Brodal-Lagogiannis-Tarjan worst-case bounds

The Brodal–Lagogiannis–Tarjan strict Fibonacci heap (2012) achieves the Fibonacci-heap bounds in the worst case, not just amortized. Full implementation is research-level. For this task, deliver a written sketch (1–2 pages) that:

1. Names the invariants BLT add on top of a Fibonacci heap (active vs passive nodes, the loss reduction transformation, the active root reduction transformation).
2. Identifies the three places in your code that would change.
3. Argues why the amortized analysis no longer needs Φ — the structural transformations bound work per operation directly.

Optional code — implement the active-root reduction transformation only, as a standalone refactor on an existing root list, and verify it preserves heap order.

```go
// TODO: optional ActiveRootReduction(h *FibHeap)
```

```java
// TODO: optional activeRootReduction(FibHeap h)
```

```python
# TODO: optional active_root_reduction(h)
```

Evaluation criteria — the write-up correctly identifies why amortized analysis is insufficient for real-time systems and what BLT do about it; the optional code preserves invariants.

---

### Task 15 — Prim's MST with Fibonacci heap vs Kruskal + union-find

Build a graph generator that produces random connected weighted graphs for varying densities: sparse (E = 2V), medium (E = V·√V), dense (E = V²/4). Run Prim's MST with your Fibonacci heap (using decreaseKey on the key of each fringe vertex) and Kruskal with a union-find. Report total weight (must match) and wall time per density.

I/O spec — `<algo> <V> <E> <density> <total_weight> <wall_ms>`.
Constraints — V ∈ {10³, 10⁴, 10⁵}; pin RNG seed.
Hint — for dense graphs the Fibonacci-heap Prim should pull ahead because decreaseKey is amortized O(1); for sparse graphs Kruskal usually wins because sorting edges is fast and union-find is cache-friendly.

```go
func PrimFib(adj [][]Edge) int64 {
    n := len(adj)
    inMST := make([]bool, n)
    key := make([]int64, n)
    handles := make([]*node, n)
    h := &FibHeap{}
    // TODO
    return 0
}

func KruskalUF(edges []Edge3, n int) int64 {
    // TODO: sort edges, union-find
    return 0
}

type Edge3 struct{ U, V int; W int64 }
```

```java
long primFib(List<List<Edge>> adj) { /* TODO */ return 0; }
long kruskal(int n, List<long[]> edges) { /* TODO */ return 0; }
```

```python
def prim_fib(adj):
    # TODO
    return 0

def kruskal(n, edges):
    # TODO
    return 0
```

Evaluation criteria — total weights match; written analysis of where each algorithm wins and why; the crossover density is reported.

---

## Benchmark Task

### Cross-language, cross-implementation benchmark — Dijkstra

Run Dijkstra across the matrix:

- Graph sizes — V ∈ {10³, 10⁴, 10⁵}, E = 5V.
- Heaps — binary heap (indexed), lazy binary heap (no `decreaseKey`; push a duplicate and skip stale pops), Fibonacci heap (your Task 4–6 implementation).
- Languages — Go, Java, Python.

Total — 27 cells. Report wall time per cell, plus number of heap operations performed.

I/O spec — emit a CSV with header `language,heap,V,E,wall_ms,extract_count,decrease_count`.
Constraints — fix the RNG seed across languages; use the same graph file as input.
Hint — generate the graphs once with Python or Go, write them to a shared file `graph_V.txt`, then read that file from all three runners. This avoids re-randomizing per language.

```go
// runner: read graph_V.txt, run dijkstra(heap_kind, src=0), print CSV row
func main() {
    // TODO: arg parsing for heap_kind and graph file
}
```

```java
public class BenchRunner {
    public static void main(String[] args) {
        // TODO: same as Go runner
    }
}
```

```python
import sys
def main():
    # TODO: same as Go runner
    pass

if __name__ == "__main__":
    main()
```

```text
language,heap,V,E,wall_ms,extract_count,decrease_count
go,binary,1000,5000,1.7,1000,3812
go,lazy,1000,5000,1.6,2901,0
go,fib,1000,5000,2.4,1000,3812
go,binary,10000,50000,28,10000,42190
go,lazy,10000,50000,25,33141,0
go,fib,10000,50000,41,10000,42190
go,binary,100000,500000,470,100000,449213
go,lazy,100000,500000,440,361118,0
go,fib,100000,500000,690,100000,449213
java,binary,1000,5000,5,1000,3812
java,lazy,1000,5000,4,2901,0
java,fib,1000,5000,8,1000,3812
java,binary,10000,50000,55,10000,42190
java,lazy,10000,50000,49,33141,0
java,fib,10000,50000,90,10000,42190
java,binary,100000,500000,820,100000,449213
java,lazy,100000,500000,760,361118,0
java,fib,100000,500000,1280,100000,449213
python,binary,1000,5000,40,1000,3812
python,lazy,1000,5000,32,2901,0
python,fib,1000,5000,95,1000,3812
python,binary,10000,50000,520,10000,42190
python,lazy,10000,50000,430,33141,0
python,fib,10000,50000,1340,10000,42190
python,binary,100000,500000,8700,100000,449213
python,lazy,100000,500000,7100,361118,0
python,fib,100000,500000,22300,100000,449213
```

Evaluation criteria — all 27 cells filled with consistent numbers; correctness checked by comparing shortest-path checksums across heaps; written analysis (5–10 sentences) addressing:

1. Why does the lazy binary heap usually beat the indexed binary heap on Dijkstra despite a larger heap?
2. Why does the Fibonacci heap not win in absolute time on these graph sizes?
3. At what V would you expect the Fibonacci heap to actually pay off (theoretically and empirically), and why is real Dijkstra rarely run at that scale on a single machine?
4. Which language shows the largest relative slowdown for Fibonacci heap vs binary heap, and what does that tell you about per-node overhead?

A complete submission includes — source code per language, the generated `graph_V.txt` files (or the deterministic generator), the CSV, and the written analysis.
