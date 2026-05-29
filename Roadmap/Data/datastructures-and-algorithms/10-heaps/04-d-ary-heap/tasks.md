# D-Ary Heap — Practice Tasks

> All tasks must be solved in Go, Java, and Python.

A d-ary heap is a generalisation of the binary heap where every internal node has up to `d` children instead of 2. The tree becomes shallower (height `log_d n`) but each sift-down compares against `d` candidates. This trade-off matters in practice — for Dijkstra-style workloads with many `decrease-key` calls a 4-ary heap is often measurably faster than a binary one. The tasks below take you from the arithmetic basics through indexed implementations, cache-aware layouts, and finally a cross-language benchmark.

Useful index arithmetic to keep in mind for a 0-based array with branching factor `d`:

```text
parent(i)      = (i - 1) / d            for i > 0
kth_child(i,k) = d * i + k + 1          for k in [0, d)
first_child(i) = d * i + 1
last_child(i)  = d * i + d
height(n)      = ceil(log_d(n * (d-1) + 1)) - 1
```

---

## Beginner Tasks (5)

### Task 1 — Implement push and pop for a d-ary min-heap with d=4

**Problem.** Build a minimal 4-ary min-heap that supports `Push(x)` and `Pop() -> x`. Use an array as the backing store. The smallest element must always be at index 0. Do not use any standard-library heap — write the sift-up and sift-down yourself.

**I/O spec.** A driver pushes the sequence `5, 2, 8, 1, 9, 3, 7, 4, 6` then pops everything. The popped order must be `1, 2, 3, 4, 5, 6, 7, 8, 9`.

**Constraints.** O(log_4 n) per operation. No recursion required, iterative loops are fine. Keys are 64-bit integers.

**Hint.** Inside sift-down look at indices `4*i+1 .. 4*i+4`, clamp to `len(heap)`, pick the smallest child, swap if it beats the parent, repeat.

```go
package heap4

type MinHeap4 struct{ a []int64 }

func New() *MinHeap4 { return &MinHeap4{} }

func (h *MinHeap4) Push(x int64) {
    h.a = append(h.a, x)
    // TODO: sift up from index len(h.a)-1
}

func (h *MinHeap4) Pop() int64 {
    // TODO: swap [0] with last, shrink, sift down from 0
    return 0
}

func (h *MinHeap4) Len() int { return len(h.a) }
```

```java
public final class MinHeap4 {
    private long[] a = new long[16];
    private int n = 0;

    public void push(long x) {
        if (n == a.length) a = java.util.Arrays.copyOf(a, a.length * 2);
        a[n++] = x;
        // TODO: sift up from index n-1
    }

    public long pop() {
        long top = a[0];
        a[0] = a[--n];
        // TODO: sift down from 0
        return top;
    }

    public int size() { return n; }
}
```

```python
class MinHeap4:
    def __init__(self):
        self.a = []

    def push(self, x: int) -> None:
        self.a.append(x)
        # TODO: sift up from len(self.a) - 1

    def pop(self) -> int:
        # TODO: swap [0] with last, pop, sift down from 0
        return 0

    def __len__(self) -> int:
        return len(self.a)
```

**Evaluation.** Pop order matches sorted input; push/pop both O(log n); no external heap library used; passes a 10 000-element randomised round trip.

---

### Task 2 — Generalise your binary-heap code by parametrising d

**Problem.** Take an existing binary-heap implementation (write a small one if you have none) and refactor it so the branching factor `d` becomes a constructor parameter. The same code must run correctly for `d ∈ {2, 3, 4, 8}`.

**I/O spec.** A test harness creates four heaps with `d = 2, 3, 4, 8`, pushes the same 1 000 random integers, pops them all and asserts the four output sequences are identical and sorted.

**Constraints.** `d >= 2`. Avoid hard-coded `2` or `<< 1` anywhere — everything must derive from `d`.

**Hint.** The two places that change are `parent(i) = (i-1)/d` and the child loop `for k in 0..d`. Everything else stays the same.

```go
type Heap struct {
    a []int64
    d int
}

func New(d int) *Heap {
    if d < 2 { panic("d must be >= 2") }
    return &Heap{d: d}
}

func (h *Heap) parent(i int) int { return (i - 1) / h.d }
// TODO: siftUp, siftDown using h.d
```

```java
public final class DAryHeap {
    private final int d;
    private long[] a = new long[16];
    private int n = 0;

    public DAryHeap(int d) {
        if (d < 2) throw new IllegalArgumentException("d >= 2");
        this.d = d;
    }
    // TODO: parent(i), siftUp, siftDown parametrised on d
}
```

```python
class DAryHeap:
    def __init__(self, d: int):
        if d < 2:
            raise ValueError("d >= 2")
        self.d = d
        self.a: list[int] = []

    def _parent(self, i: int) -> int:
        return (i - 1) // self.d
    # TODO: sift_up, sift_down using self.d
```

**Evaluation.** Identical popped sequences across all four `d` values; no `d`-specific branches; one set of unit tests parametrised over `d`.

---

### Task 3 — Verify parent/child arithmetic for d=4 with an assertion test

**Problem.** Write a test that walks indices `0 .. 1000` and asserts that for every `i`, `parent(kth_child(i, k)) == i` for `k ∈ [0, d)`, and that `kth_child(i, k)` produces strictly increasing, contiguous indices. This catches off-by-one errors before they corrupt a heap silently.

**I/O spec.** No console output on success. On failure print `i`, `k`, expected, got.

**Constraints.** Pure arithmetic, no heap state involved. Should finish in milliseconds.

**Hint.** Remember the asymmetry: `parent(0)` is undefined and must not be tested. Start the loop at `i = 1` for the parent check.

```go
func TestArithmetic4(t *testing.T) {
    d := 4
    parent := func(i int) int { return (i - 1) / d }
    child := func(i, k int) int { return d*i + k + 1 }
    // TODO: loop i in [0, 1000], k in [0, d)
}
```

```java
@Test
void arithmetic4() {
    int d = 4;
    for (int i = 0; i < 1000; i++) {
        for (int k = 0; k < d; k++) {
            int c = d * i + k + 1;
            // TODO: assertEquals(i, (c - 1) / d)
        }
    }
}
```

```python
def test_arithmetic_4():
    d = 4
    for i in range(1000):
        for k in range(d):
            c = d * i + k + 1
            assert (c - 1) // d == i, (i, k, c)
```

**Evaluation.** Test passes for `d = 2, 3, 4, 8, 16` without modification; failure message identifies the offending index.

---

### Task 4 — Compare comparison counts of push×100 between d=2 and d=4

**Problem.** Instrument your heap to count key comparisons. Push 100 random integers into a `d=2` heap and a `d=4` heap, record total comparisons, then divide. Report the ratio.

**I/O spec.** Print three numbers: `comparisons_d2`, `comparisons_d4`, `ratio = d2 / d4`. Use the same random seed for both runs.

**Constraints.** A comparison is one `a[i] < a[j]` (or equivalent) call. Counter must be incremented exactly once per call.

**Hint.** Push is sift-up — each step does one comparison against the parent. Expect roughly `log_2(100) ≈ 6.6` vs `log_4(100) ≈ 3.3`, so the ratio should be near 2. Sift-up, unlike sift-down, does not get penalised by larger `d`.

```go
type Counter struct{ Comparisons int64 }

func (c *Counter) less(a, b int64) bool {
    c.Comparisons++
    return a < b
}
// TODO: thread the counter through Push
```

```java
final class Counter {
    long comparisons = 0;
    boolean less(long a, long b) { comparisons++; return a < b; }
}
```

```python
class Counter:
    def __init__(self):
        self.comparisons = 0

    def less(self, a, b) -> bool:
        self.comparisons += 1
        return a < b
```

**Evaluation.** Same seed gives reproducible counts; ratio is roughly 2 (±10%) for n=100; write-up explains why sift-up favours larger `d`.

---

### Task 5 — Build-heap an unsorted array of size 1000 with d=4 in O(n)

**Problem.** Implement `Heapify(a []int64)` that turns an arbitrary array into a valid 4-ary min-heap in linear time. Use the bottom-up Floyd algorithm: start at the last non-leaf and sift-down toward index 0.

**I/O spec.** Input: random array of 1 000 int64 values. Output: same array, rearranged so the min-heap property holds for `d=4`. Verify by repeatedly popping and checking the output is sorted.

**Constraints.** O(n) time, O(1) extra memory. Do not push elements one by one (that would be O(n log n)).

**Hint.** The last non-leaf is at index `(n - 2) / d`. Loop from there down to 0 calling sift-down on each.

```go
func Heapify4(a []int64) {
    n := len(a)
    if n < 2 { return }
    d := 4
    start := (n - 2) / d
    for i := start; i >= 0; i-- {
        // TODO: siftDown(a, i, n, d)
    }
}
```

```java
public static void heapify4(long[] a) {
    int n = a.length;
    if (n < 2) return;
    int d = 4;
    for (int i = (n - 2) / d; i >= 0; i--) {
        // TODO: siftDown(a, i, n, d)
    }
}
```

```python
def heapify4(a: list[int]) -> None:
    n = len(a)
    if n < 2:
        return
    d = 4
    for i in range((n - 2) // d, -1, -1):
        sift_down(a, i, n, d)  # TODO
```

**Evaluation.** Heapified array satisfies `a[parent] <= a[child]` for every index; total comparisons grow linearly with n (verify by doubling n); subsequent pop sequence is sorted.

---

## Intermediate Tasks (5)

### Task 6 — Implement decrease-key in an indexed d-ary heap

**Problem.** Build an *indexed* d-ary heap: each item has an external integer ID, and you can call `DecreaseKey(id, newKey)` to lower an existing item's key. To do this in O(log_d n) you need a `pos[id] -> heap_index` map updated on every swap.

**I/O spec.** Insert 100 (id, key) pairs, then call `DecreaseKey(id, key - 1000)` on 50 random IDs. Pop everything and assert the order matches the sorted final keys.

**Constraints.** `DecreaseKey` is O(log_d n) — it does a sift-up only. The `pos` array must stay consistent through every swap; a single missed update will corrupt the heap silently. New key must be `<=` current key (reject otherwise).

**Hint.** Wrap your swap function so it always updates `pos[a[i].id] = i` and `pos[a[j].id] = j`. Never swap raw without going through that helper.

```go
type Item struct{ ID int; Key int64 }

type IndexedHeap struct {
    a   []Item
    pos []int // pos[id] = index in a, -1 if absent
    d   int
}

func (h *IndexedHeap) DecreaseKey(id int, newKey int64) error {
    i := h.pos[id]
    if i < 0 { return errors.New("absent") }
    if newKey > h.a[i].Key { return errors.New("not a decrease") }
    h.a[i].Key = newKey
    // TODO: siftUp(i)
    return nil
}
```

```java
public final class IndexedDAryHeap {
    private long[] keys;
    private int[] ids;
    private int[] pos; // pos[id] -> heap index
    private final int d;
    private int n = 0;

    public void decreaseKey(int id, long newKey) {
        int i = pos[id];
        if (i < 0) throw new NoSuchElementException();
        if (newKey > keys[i]) throw new IllegalArgumentException();
        keys[i] = newKey;
        // TODO: siftUp(i)
    }
}
```

```python
class IndexedDAryHeap:
    def __init__(self, d: int, capacity: int):
        self.d = d
        self.keys: list[int] = []
        self.ids: list[int] = []
        self.pos = [-1] * capacity

    def decrease_key(self, id: int, new_key: int) -> None:
        i = self.pos[id]
        if i < 0:
            raise KeyError(id)
        if new_key > self.keys[i]:
            raise ValueError("not a decrease")
        self.keys[i] = new_key
        # TODO: sift_up(i)
```

**Evaluation.** `pos[]` remains consistent after every operation (write an internal check); decrease-key is O(log_d n); randomised test of 10 000 mixed ops passes.

---

### Task 7 — Use the indexed d-ary heap to implement Dijkstra; compare with d=2 baseline on V=10⁴, E=5·10⁴

**Problem.** Implement Dijkstra's shortest path using your indexed d-ary heap. Run it twice on the same graph — once with `d=2`, once with `d=4`. Report wall-clock time, peak heap size, and number of `decrease-key` calls.

**I/O spec.** Generate a random connected graph with V=10 000, E=50 000, edge weights uniform in `[1, 100]`. Source is vertex 0. Output: distance array length V; print timing summary.

**Constraints.** Use `decrease-key` rather than the "lazy duplicates" trick — this is the case where d-ary supposedly shines. Each vertex is in the heap at most once.

**Hint.** Dijkstra does O(V) extract-min and O(E) decrease-key. With `d=4` extract-min becomes about 2× slower (more children scanned) but decrease-key becomes about 2× faster (shallower tree). Net effect depends on E/V ratio.

```go
func Dijkstra(g Graph, src int, d int) []int64 {
    n := g.NumVertices()
    dist := make([]int64, n)
    for i := range dist { dist[i] = math.MaxInt64 }
    dist[src] = 0
    h := NewIndexedHeap(d, n)
    h.Insert(src, 0)
    for h.Len() > 0 {
        // TODO: extract-min, relax edges, decrease-key
    }
    return dist
}
```

```java
public long[] dijkstra(Graph g, int src, int d) {
    int n = g.numVertices();
    long[] dist = new long[n];
    Arrays.fill(dist, Long.MAX_VALUE);
    dist[src] = 0;
    IndexedDAryHeap h = new IndexedDAryHeap(d, n);
    h.insert(src, 0);
    // TODO: main loop
    return dist;
}
```

```python
def dijkstra(g, src: int, d: int) -> list[int]:
    n = g.num_vertices()
    dist = [10**18] * n
    dist[src] = 0
    h = IndexedDAryHeap(d, n)
    h.insert(src, 0)
    # TODO: main loop
    return dist
```

**Evaluation.** Both runs produce identical distances; timing table reported in markdown; commentary on why your machine prefers `d=2` or `d=4` on this E/V ratio.

---

### Task 8 — Build a heap sort with d=4 — verify O(n log n) with comparison counts

**Problem.** Implement heap-sort using an in-place 4-ary max-heap. Count comparisons. Sort arrays of size `n ∈ {1k, 4k, 16k, 64k}` and verify the comparison count divided by `n log_2 n` is approximately constant.

**I/O spec.** Print a table: `n`, `comparisons`, `comparisons / (n * log2(n))`. The last column should stabilise around a constant (your job is to discover what it is for `d=4`).

**Constraints.** In-place: O(1) extra memory beyond a counter. Use bottom-up heapify (Task 5) for the build phase.

**Hint.** The build phase is O(n). The extract phase is O(n log_4 n). Total comparisons ≈ `2n log_4 n` (each sift-down level does up to `d-1 = 3` child-vs-child + 1 parent-vs-child = 4 comparisons per level).

```go
func HeapSort4(a []int64) (comparisons int64) {
    // build max-heap
    // for i := n-1; i > 0; i-- { swap(a[0], a[i]); siftDown(a, 0, i, 4, &cmp) }
    return
}
```

```java
public static long heapSort4(long[] a) {
    long[] cmp = {0};
    // TODO: build then extract loop
    return cmp[0];
}
```

```python
def heap_sort_4(a: list[int]) -> int:
    cmp = [0]
    # TODO: build then extract loop
    return cmp[0]
```

**Evaluation.** Output is sorted; ratio column varies by less than 10% across the four sizes; write-up explains the constant factor relative to binary heap sort.

---

### Task 9 — Implement a top-k tracker using a d-ary max-heap of size k

**Problem.** Stream of `n` integers, keep the smallest `k`. Use a max-heap of capacity `k`: if a new value is smaller than the root, replace the root and sift down. Use `d=4`.

**I/O spec.** Input: `n=10⁶` random integers, `k=100`. Output: the 100 smallest values in any order. Verify against a reference sort.

**Constraints.** O((n - k) log_4 k) total time. Memory is O(k), not O(n).

**Hint.** Fill the heap with the first `k` values then heapify once. After that, for each remaining value, compare to `a[0]`. If smaller, write to `a[0]` and sift down — no pop+push needed.

```go
func TopK(stream []int64, k int) []int64 {
    h := make([]int64, k)
    copy(h, stream[:k])
    Heapify4Max(h)
    for _, x := range stream[k:] {
        if x < h[0] {
            h[0] = x
            // TODO: siftDownMax(h, 0, k, 4)
        }
    }
    return h
}
```

```java
public static long[] topK(long[] stream, int k) {
    long[] h = Arrays.copyOf(stream, k);
    heapifyMax4(h);
    for (int i = k; i < stream.length; i++) {
        if (stream[i] < h[0]) {
            h[0] = stream[i];
            // TODO: siftDownMax(h, 0, k, 4)
        }
    }
    return h;
}
```

```python
def top_k(stream: list[int], k: int) -> list[int]:
    h = stream[:k]
    heapify_max_4(h)
    for x in stream[k:]:
        if x < h[0]:
            h[0] = x
            sift_down_max_4(h, 0, k)  # TODO
    return h
```

**Evaluation.** Output set equals the 100 smallest values of the input; total comparisons bounded by `n * log_4 k`; memory profile flat at k entries.

---

### Task 10 — Implement a sliding window minimum on a d-ary heap

**Problem.** Given an array `a[0..n)` and window size `w`, output `min(a[i..i+w))` for `i = 0..n-w`. Use a *lazy-deletion* indexed d-ary min-heap: insert with index, when extracting check if the popped index is still inside the window, otherwise discard.

**I/O spec.** Input: `a = [4,3,7,1,9,2,8,5,6]`, `w=3`. Output: `[3,1,1,1,2,2,5]`.

**Constraints.** Use `d=4`. Even though the optimal solution is a monotonic deque (O(n)), this task is about the heap mechanics — accept O(n log n).

**Hint.** Store `(value, original_index)`. After every `extract-min` peek at the next root and discard while `root.index <= i - w`. Track active size separately.

```go
func WindowMin(a []int64, w int) []int64 {
    out := make([]int64, 0, len(a)-w+1)
    h := NewMinHeap4Pair()
    for i, v := range a {
        h.Push(v, i)
        if i >= w-1 {
            for h.Peek().idx <= i-w { h.Pop() }
            out = append(out, h.Peek().val)
        }
    }
    return out
}
```

```java
public static long[] windowMin(long[] a, int w) {
    DAryHeapPair h = new DAryHeapPair(4);
    long[] out = new long[a.length - w + 1];
    for (int i = 0; i < a.length; i++) {
        h.push(a[i], i);
        if (i >= w - 1) {
            while (h.peekIndex() <= i - w) h.pop();
            out[i - w + 1] = h.peekValue();
        }
    }
    return out;
}
```

```python
def window_min(a: list[int], w: int) -> list[int]:
    h = MinHeap4Pair()
    out: list[int] = []
    for i, v in enumerate(a):
        h.push(v, i)
        if i >= w - 1:
            while h.peek_index() <= i - w:
                h.pop()
            out.append(h.peek_value())
    return out
```

**Evaluation.** Matches the deque-based reference on 10 randomised arrays; lazy-deletion correctly discards stale entries; heap size bounded by `n` (worst case) but typically far smaller.

---

## Advanced Tasks (5)

### Task 11 — Find empirically optimal d on YOUR machine for V=10⁵, E=10⁶ Dijkstra. Sweep d ∈ {2, 3, 4, 6, 8, 12, 16}

**Problem.** Run Dijkstra on the same random graph (V=10⁵, E=10⁶) for each `d` in the sweep. Repeat 5 times per `d`, drop the slowest, average the rest. Report a table and a brief analysis of where the optimum sits and why.

**I/O spec.** Output: markdown table with columns `d`, `mean_ms`, `stdev_ms`, `comparisons`. Plus a one-paragraph commentary identifying the winner and the runner-up.

**Constraints.** Same graph instance, same source vertex, same RNG seed across all `d`. Warm up the JIT/runtime with one untimed run before measuring.

**Hint.** Modern desktop machines with 64-byte cache lines and SIMD-capable comparators tend to favour `d ∈ {4, 8}`. Larger `d` keeps more children in cache per sift-down step but increases per-step comparison cost. Plot the curve if you can.

```go
func Bench() {
    g := RandomGraph(1e5, 1e6, 42)
    for _, d := range []int{2, 3, 4, 6, 8, 12, 16} {
        var samples []float64
        for run := 0; run < 5; run++ {
            t := time.Now()
            _ = Dijkstra(g, 0, d)
            samples = append(samples, time.Since(t).Seconds()*1000)
        }
        // TODO: drop max, mean, stdev
    }
}
```

```java
public static void bench() {
    Graph g = RandomGraph.build(100_000, 1_000_000, 42);
    int[] ds = {2, 3, 4, 6, 8, 12, 16};
    for (int d : ds) {
        // TODO: 5 runs, drop max, mean, stdev
    }
}
```

```python
def bench():
    g = random_graph(100_000, 1_000_000, seed=42)
    for d in [2, 3, 4, 6, 8, 12, 16]:
        samples = []
        for _ in range(5):
            t = time.perf_counter()
            dijkstra(g, 0, d)
            samples.append((time.perf_counter() - t) * 1000)
        # TODO: drop max, mean, stdev
```

**Evaluation.** Reproducible numbers across two runs on the same machine (within 10%); winner identified with rationale; commentary discusses why your specific E/V ratio favours that `d`.

---

### Task 12 — Implement struct-of-arrays storage (separate keys[] and values[]) and compare cache-miss rate

**Problem.** Re-implement the indexed d-ary heap using parallel arrays `keys[]` and `payloads[]` instead of an array of structs. The hot path (sift-down) touches only `keys[]`; the payload is fetched only when the user extracts. Measure cache-miss rate and wall time vs the AOS version on a Dijkstra workload.

**I/O spec.** Output: table comparing AOS vs SOA on V=10⁵, E=10⁶ — `cache_misses` (`perf stat` on Linux, `Instruments` on macOS, JVM `-XX:+PrintGCDetails` or Go's `runtime/pprof` for indirect signals), wall time, and instructions retired if available.

**Constraints.** Same algorithm, same graph, same `d`. Only the heap's memory layout changes.

**Hint.** SOA wins when the payload is large and only the key is touched during heap maintenance. With `(int id, double key, void* value)` AOS each comparison drags 24 bytes through cache; SOA pulls 8 bytes. The payoff scales with `d`.

```go
type SOA struct {
    keys []int64
    ids  []int
    d    int
}
// TODO: same API as IndexedHeap but with two separate arrays
```

```java
public final class SoaHeap {
    private long[] keys;
    private int[] ids;
    private int[] pos;
    private final int d;
    // TODO: implementation
}
```

```python
class SoaHeap:
    def __init__(self, d: int, capacity: int):
        self.d = d
        self.keys: list[int] = []
        self.ids: list[int] = []
        self.pos = [-1] * capacity
    # TODO: implementation
```

**Evaluation.** SOA shows lower last-level cache miss rate; wall time difference reported with confidence interval; discussion of when AOS is still better (small payloads, frequent extract).

---

### Task 13 — Multi-threaded d-ary heap: per-subtree mutex. Run a producer-consumer benchmark

**Problem.** Build a concurrent d-ary heap where each subtree rooted at depth `k` has its own mutex. Producers call `Push`, consumers call `Pop`. Compare against a coarse-grained single-mutex heap on a workload of 4 producers + 4 consumers performing 1M ops each.

**I/O spec.** Output: throughput (ops/sec) for fine-grained vs coarse-grained; contention statistics if your runtime exposes them (`go tool trace`, JFR, `cProfile` is too crude — use `concurrent-log-handler` or similar).

**Constraints.** Heap invariant must hold after every successful op. Avoid deadlock by acquiring locks top-down only. Use `d=4`. Linearisability is not required — sequential consistency at the API level is.

**Hint.** Lock the path from root to leaf using lock-coupling: hold the parent lock, take the child lock, release the parent. This serialises operations on the same path but allows disjoint paths to run in parallel. Beware: extract-min always starts at the root, which becomes a hotspot — consider sharded heaps if you see saturation.

```go
type ConcurrentHeap struct {
    mu     []sync.Mutex // one per node
    a      []int64
    d      int
}

func (h *ConcurrentHeap) Push(x int64) {
    // TODO: lock-couple from root down
}
```

```java
public final class ConcurrentDAryHeap {
    private final ReentrantLock[] locks;
    private final long[] a;
    private final int d;
    // TODO: lock-coupled push/pop
}
```

```python
# Python's GIL makes fine-grained locking less impactful;
# do this with multiprocessing or use threads only for I/O-bound producers.
class ConcurrentHeap:
    def __init__(self, d: int, capacity: int):
        self.d = d
        self.a: list[int] = []
        self.locks = [threading.Lock() for _ in range(capacity)]
    # TODO: lock-coupled push/pop
```

**Evaluation.** Heap invariant verified after the run; throughput improves with thread count up to some saturation point; deadlock-free under 10-minute stress test; commentary on root contention.

---

### Task 14 — Implement a d-ary heap with bulk-decrease-key (lower the keys of all items matching a predicate) — analyse complexity

**Problem.** Support `BulkDecreaseKey(pred func(item) bool, delta int64)` that subtracts `delta` from every item satisfying `pred`. The heap invariant must be restored at the end. Analyse the complexity in terms of `m` (matching items) and `n` (heap size).

**I/O spec.** Insert 10⁵ items, run `BulkDecreaseKey` with a predicate matching ~10% of items, then pop everything and assert sorted order matches the updated keys.

**Constraints.** Must beat the naive `for id where pred: decrease-key(id, ...)` which is O(m log_d n) — your version should be O(n) when m is large by re-heapifying bottom-up.

**Hint.** When m is small, individual decrease-keys are best (O(m log_d n)). When m is large (say m > n / log n), it is cheaper to apply the delta in one pass and then call `Heapify` (O(n)). Make the choice at runtime.

```go
func (h *IndexedHeap) BulkDecreaseKey(pred func(Item) bool, delta int64) {
    matches := 0
    for _, it := range h.a {
        if pred(it) { matches++ }
    }
    if matches < len(h.a)/int(math.Log2(float64(len(h.a)+2))) {
        // TODO: per-item decrease-key path
    } else {
        // TODO: bulk apply + heapify
    }
}
```

```java
public void bulkDecreaseKey(Predicate<Item> pred, long delta) {
    // TODO: count matches, choose strategy, restore invariant
}
```

```python
def bulk_decrease_key(self, pred, delta: int) -> None:
    # TODO: count matches, choose strategy, restore invariant
    pass
```

**Evaluation.** Both strategies produce identical final heap state; selection threshold documented; benchmark confirms the chosen threshold beats either pure strategy.

---

### Task 15 — Implement Prim's MST using d-ary heap on a random graph and report comparisons vs binary

**Problem.** Implement Prim's minimum spanning tree using your indexed d-ary heap with `decrease-key`. Run it on a random connected graph (V=10⁴, E=10⁵, weights uniform in `[1, 1000]`) for `d ∈ {2, 4, 8}` and report total weight (should be identical), wall time, and comparison count.

**I/O spec.** Output: MST total weight (same for all three runs), and a table `d`, `comparisons`, `time_ms`, `decrease_key_calls`. The total weight must equal the reference (Kruskal with union-find) implementation.

**Constraints.** Use `decrease-key` rather than re-insertion. Each vertex enters the heap at most once. Same graph and seed across all `d`.

**Hint.** Prim's heap operations are dominated by `decrease-key` (one per edge). This is where d-ary heaps theoretically shine — `decrease-key` is sift-up only, which gets cheaper as `d` grows.

```go
func PrimMST(g Graph, d int) (totalWeight int64, comparisons int64) {
    // TODO: indexed d-ary heap, key[v] = lightest known edge to v
    return
}
```

```java
public static long primMst(Graph g, int d, long[] cmpOut) {
    // TODO: indexed d-ary heap, key[v] = lightest known edge to v
    return 0;
}
```

```python
def prim_mst(g, d: int) -> tuple[int, int]:
    # TODO: indexed d-ary heap, key[v] = lightest known edge to v
    return 0, 0
```

**Evaluation.** Total weight matches Kruskal reference; comparison count drops monotonically from `d=2` to `d=8`; wall time may not — report whichever direction your machine shows and explain.

---

## Benchmark Task

### Task B — Cross-language and cross-d benchmark: push n then pop n

**Problem.** Build a benchmark harness that, for each combination of language (Go, Java, Python), `d ∈ {2, 4, 8, 16}`, and `n ∈ {10⁴, 10⁵, 10⁶}`, pushes `n` random int64 values and then pops all of them. Record wall time and total comparisons.

**I/O spec.** A single markdown table at the end with columns `language`, `d`, `n`, `time_ms`, `comparisons`, `comparisons_per_op`. 3 × 4 × 3 = 36 rows.

**Constraints.** Same RNG seed across runs. Warm up the JVM and the Go runtime with one untimed `(n=10⁴, d=2)` run before measuring. For Python, measure with `time.perf_counter`; do not include heap construction in the timing. Disable GC during measurement where possible (`runtime.GC()` then disable in Go, `System.gc()` plus `-XX:+DisableExplicitGC` in Java, `gc.disable()` in Python).

**Hint.** Wall time tells you the language overhead; comparisons tell you the algorithmic cost (which should be roughly equal across languages for the same `d` and `n`). When they diverge, the gap is constant factor (interpreter loop, JIT, bounds checks). Expect Python to be 30–100× slower than Go/Java on this micro-benchmark; that is normal and a useful number to internalise.

```go
func BenchHeap() {
    seed := int64(42)
    for _, d := range []int{2, 4, 8, 16} {
        for _, n := range []int{10000, 100000, 1000000} {
            rng := rand.New(rand.NewSource(seed))
            h := NewDAryHeap(d)
            data := make([]int64, n)
            for i := range data { data[i] = rng.Int63() }
            runtime.GC(); runtime.GC()
            t := time.Now()
            for _, v := range data { h.Push(v) }
            for h.Len() > 0 { h.Pop() }
            elapsed := time.Since(t).Milliseconds()
            fmt.Printf("| go | %d | %d | %d |\n", d, n, elapsed)
        }
    }
}
```

```java
public static void benchHeap() {
    long seed = 42L;
    int[] ds = {2, 4, 8, 16};
    int[] ns = {10_000, 100_000, 1_000_000};
    for (int d : ds) {
        for (int n : ns) {
            Random rng = new Random(seed);
            DAryHeap h = new DAryHeap(d);
            long[] data = new long[n];
            for (int i = 0; i < n; i++) data[i] = rng.nextLong();
            System.gc();
            long t0 = System.nanoTime();
            for (long v : data) h.push(v);
            while (h.size() > 0) h.pop();
            long ms = (System.nanoTime() - t0) / 1_000_000L;
            System.out.printf("| java | %d | %d | %d |%n", d, n, ms);
        }
    }
}
```

```python
def bench_heap():
    seed = 42
    for d in [2, 4, 8, 16]:
        for n in [10_000, 100_000, 1_000_000]:
            rng = random.Random(seed)
            h = DAryHeap(d)
            data = [rng.getrandbits(63) for _ in range(n)]
            gc.disable()
            t0 = time.perf_counter()
            for v in data:
                h.push(v)
            while len(h) > 0:
                h.pop()
            ms = (time.perf_counter() - t0) * 1000
            gc.enable()
            print(f"| python | {d} | {n} | {ms:.0f} |")
```

**Evaluation.** Table is complete (36 rows); same `comparisons_per_op` across languages for matching `(d, n)` (within rounding); commentary identifies the optimal `d` per language and explains the divergence; raw results reproducible by re-running with the same seed.

---

## Submission Checklist

- All three language implementations build and run from a single command per language (e.g. `go test ./...`, `mvn test`, `pytest`).
- Every task has automated tests, not just visual inspection.
- Random seeds are fixed and reported alongside results.
- Benchmark tables are committed as markdown next to the source.
- Commentary in the advanced tasks explains the empirical findings, not just the numbers.
