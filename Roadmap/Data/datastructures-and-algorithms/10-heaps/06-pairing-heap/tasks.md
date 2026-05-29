# Pairing Heap — Practice Tasks

> All tasks must be solved in Go, Java, and Python.

A pairing heap is a self-adjusting heap with a multi-way tree shape and a remarkably small implementation footprint. Most operations are O(1) amortized (`insert`, `find-min`, `meld`, `decrease-key`), and `extract-min` is O(log n) amortized via the famous two-pass merging of children. The tasks below take you from a clean reference implementation through Dijkstra/A* and a cross-language benchmark against binary and Fibonacci heaps.

---

## Beginner Tasks (5)

### Task 1 — Implement meld(a, b)

**Problem.** Implement the fundamental `meld` operation: given two pairing-heap roots `a` and `b`, return the root of the combined heap. The root with the smaller key wins, and the loser becomes the leftmost child of the winner. This is the building block for every other pairing-heap operation.

**I/O spec.** Two heap roots (either may be `nil`). Output: the merged root.

**Constraints.** Must be O(1). Must preserve heap order. Inputs of the same heap must not be passed twice.

**Hint.** Keep children in a singly-linked list ordered most-recently-added first; pushing a new child to the front is O(1).

```go
type Node struct {
    key      int
    child    *Node // leftmost child
    sibling  *Node // next sibling
    prev     *Node // previous sibling or parent
}

func Meld(a, b *Node) *Node {
    if a == nil { return b }
    if b == nil { return a }
    // TODO: pick winner by key, attach loser as leftmost child of winner,
    // update prev/sibling pointers, return winner.
    return nil
}
```

```java
class Node {
    int key;
    Node child, sibling, prev;
    Node(int k) { key = k; }
}

static Node meld(Node a, Node b) {
    if (a == null) return b;
    if (b == null) return a;
    // TODO: implement.
    return null;
}
```

```python
class Node:
    __slots__ = ("key", "child", "sibling", "prev")
    def __init__(self, k):
        self.key = k
        self.child = self.sibling = self.prev = None

def meld(a, b):
    if a is None: return b
    if b is None: return a
    # TODO: implement.
    return None
```

**Evaluation criteria.**
- Symmetry: `meld(a, b)` and `meld(b, a)` produce the same min-root key.
- Pointer hygiene: loser's `prev` points to winner; winner's `prev` is unchanged.
- 1000 random meld sequences leave heap-order intact.

---

### Task 2 — Implement insert and find-min

**Problem.** Build `Insert(h, key)` and `FindMin(h)` on top of `Meld`. Inserting a key creates a single-node heap and melds it; `FindMin` simply returns the root's key. Both must be O(1).

**I/O spec.** Sequence of operations from stdin: `I k` inserts `k`, `F` prints the current minimum.

**Constraints.** No restructuring during insert. `FindMin` must not modify the heap.

**Hint.** Wrap the root in a `Heap` struct so the API can swap the root without callers holding stale pointers.

```go
type Heap struct{ root *Node }

func (h *Heap) Insert(k int) {
    n := &Node{key: k}
    h.root = Meld(h.root, n)
}

func (h *Heap) FindMin() (int, bool) {
    if h.root == nil { return 0, false }
    return h.root.key, true
}
```

```java
class PairingHeap {
    Node root;
    void insert(int k) { root = meld(root, new Node(k)); }
    Integer findMin() { return root == null ? null : root.key; }
}
```

```python
class PairingHeap:
    def __init__(self): self.root = None
    def insert(self, k):
        self.root = meld(self.root, Node(k))
    def find_min(self):
        return None if self.root is None else self.root.key
```

**Evaluation criteria.**
- 10^6 random inserts complete in under 1 second per language.
- `FindMin` returns the global minimum across all inserts.
- Heap-order invariant holds after each insert.

---

### Task 3 — Implement extract-min with two-pass merge

**Problem.** Remove and return the minimum. After detaching the root, melt its children list using the canonical two-pass procedure: left-to-right pair-meld, then right-to-left fold of the resulting list.

**I/O spec.** `E` extracts and prints the min; mixed with `I k` inserts.

**Constraints.** Amortized O(log n). Must handle 0, 1, 2, and odd numbers of children.

**Hint.** Collect children into an array first, then loop in pairs; this keeps both passes iterative-friendly.

```go
func (h *Heap) ExtractMin() (int, bool) {
    if h.root == nil { return 0, false }
    k := h.root.key
    // TODO: gather children into a slice, two-pass meld, set h.root.
    return k, true
}
```

```java
Integer extractMin() {
    if (root == null) return null;
    int k = root.key;
    // TODO: two-pass merge of root's children.
    return k;
}
```

```python
def extract_min(self):
    if self.root is None: return None
    k = self.root.key
    # TODO: two-pass merge.
    return k
```

**Evaluation criteria.**
- Extracting all n keys produces a sorted sequence.
- 10^5 mixed ops run under 500 ms.
- No reference to the old root remains.

---

### Task 4 — Verify heap-order invariant after every operation

**Problem.** Add a `verify()` method that walks the entire tree and asserts each child key is `>=` its parent. Wire it into a test harness that toggles checking via a build flag / env var so production builds skip the cost.

**I/O spec.** Returns a boolean. On violation, returns the offending `(parent, child)` pair.

**Constraints.** O(n). Must not mutate the heap. Recursion depth must not blow the stack for n = 10^5 (use an explicit stack).

**Hint.** Do an iterative DFS using a slice/Deque/list as the worklist.

```go
func (h *Heap) Verify() (ok bool, badParent, badChild int) {
    // TODO: iterative DFS, compare each child to parent.
    return true, 0, 0
}
```

```java
boolean verify() {
    // TODO: iterative DFS.
    return true;
}
```

```python
def verify(self):
    # TODO: iterative DFS.
    return True
```

**Evaluation criteria.**
- Detects synthetic corruption (manually swap two keys).
- Fuzz: 10^4 random insert/extract sequences all pass.
- Runs in O(n) memory using explicit stack, no recursion.

---

### Task 5 — Build a pairing heap from an array of n values

**Problem.** Implement `BuildHeap(values []int) *Heap`. Two strategies: (a) successive `Insert` (O(n) amortized), (b) pair-and-fold the input directly. Implement both and document which one wins in practice.

**I/O spec.** One line `n`, next line `n` integers. Print the extracted sequence.

**Constraints.** Strategy (a) must run in O(n) amortized time. Strategy (b) must avoid recursion.

**Hint.** Strategy (b): treat each value as a singleton, two-pass meld the whole array, return the survivor.

```go
func BuildHeapByInsert(vs []int) *Heap { /* TODO */ return &Heap{} }
func BuildHeapByPairing(vs []int) *Heap { /* TODO */ return &Heap{} }
```

```java
static PairingHeap buildByInsert(int[] vs) { /* TODO */ return new PairingHeap(); }
static PairingHeap buildByPairing(int[] vs) { /* TODO */ return new PairingHeap(); }
```

```python
def build_by_insert(vs): ...  # TODO
def build_by_pairing(vs): ... # TODO
```

**Evaluation criteria.**
- Both strategies produce identical sorted output when drained.
- Benchmark on n = 10^6 random integers; report ns/op for each strategy.
- Memory: O(n) nodes, no leaks (run with `go test -race` or `python -X tracemalloc`).

---

## Intermediate Tasks (5)

### Task 6 — Implement decrease-key via cut + meld

**Problem.** Add `DecreaseKey(node, newKey)`. If `node` is not the root, detach it from its parent/sibling list, set the new key, and `Meld` the cut subtree back with the main root. Amortized cost is O(log n) in the standard analysis; recent work shows tighter bounds.

**I/O spec.** Accepts a pointer/handle returned by `Insert`. `newKey <= node.key` required.

**Constraints.** Must not break the sibling list of the parent. Returns error if `newKey > node.key`.

**Hint.** Maintain `prev` so cutting is O(1): unlink, then meld the detached subtree with the root.

```go
func (h *Heap) DecreaseKey(n *Node, newKey int) error {
    if newKey > n.key { return errors.New("not a decrease") }
    n.key = newKey
    if n == h.root { return nil }
    // TODO: cut n from sibling list, meld back.
    return nil
}
```

```java
void decreaseKey(Node n, int newKey) {
    if (newKey > n.key) throw new IllegalArgumentException();
    n.key = newKey;
    if (n == root) return;
    // TODO: cut + meld.
}
```

```python
def decrease_key(self, n, new_key):
    if new_key > n.key: raise ValueError
    n.key = new_key
    if n is self.root: return
    # TODO: cut + meld.
```

**Evaluation criteria.**
- 10^5 random decrease-keys leave heap-order intact.
- Idempotent: decreasing to the same value is a no-op.
- Verify invariant after every call in fuzz mode.

---

### Task 7 — Implement delete via decrease-key to −∞ + extract-min

**Problem.** Implement `Delete(node)` by setting `node`'s key to negative infinity, decrease-keying to bubble it to the root, then extracting. Compare against a direct `Delete` that cuts and two-pass-melds the subtree's children.

**I/O spec.** Handle-based API. Returns the deleted key.

**Constraints.** Both variants must agree on the resulting heap. Use a sentinel that is strictly less than any legal key.

**Hint.** For the direct variant: if `node == root` it's just `extract-min`; otherwise cut, two-pass meld its children, meld result with root.

```go
func (h *Heap) Delete(n *Node) int {
    h.DecreaseKey(n, math.MinInt)
    k, _ := h.ExtractMin()
    return k
}
func (h *Heap) DeleteDirect(n *Node) int { /* TODO */ return 0 }
```

```java
int delete(Node n) {
    decreaseKey(n, Integer.MIN_VALUE);
    return extractMin();
}
int deleteDirect(Node n) { /* TODO */ return 0; }
```

```python
def delete(self, n):
    self.decrease_key(n, float("-inf"))
    return self.extract_min()
def delete_direct(self, n): ...  # TODO
```

**Evaluation criteria.**
- Both variants produce identical post-delete heap when fed the same op stream.
- Benchmark: which is faster for 10^5 random deletions on n = 10^5?
- No node leaks; deleted nodes are unreachable from root.

---

### Task 8 — Iterative two-pass merge (no recursion)

**Problem.** Reimplement two-pass merge purely iteratively using an explicit array/queue. Recursion-based versions blow the stack at n ~ 10^5 in Python and Java with default stack size; the iterative version must handle n = 10^6 cleanly.

**I/O spec.** Internal API used by `ExtractMin`. Expose `twoPassMerge(children []*Node) *Node` for testing.

**Constraints.** No recursion anywhere. Two linear passes; the second pass folds right-to-left.

**Hint.** First pass: index `i` from 0 to len-1 step 2, store `meld(children[i], children[i+1])` into a `paired` slice. Second pass: walk `paired` from the end melding into an accumulator.

```go
func twoPassMerge(cs []*Node) *Node {
    // TODO: pair pass + right-to-left fold.
    return nil
}
```

```java
static Node twoPassMerge(List<Node> cs) {
    // TODO: iterative two-pass.
    return null;
}
```

```python
def two_pass_merge(cs):
    # TODO: iterative two-pass.
    return None
```

**Evaluation criteria.**
- Drains n = 10^6 keys in sorted order under 3 seconds.
- No stack overflow on adversarial monotone inputs.
- Matches the recursive reference on 10^4 random inputs.

---

### Task 9 — K-way merge with pairing heap

**Problem.** Given k sorted streams, merge them into one sorted output by inserting one node per stream tagged with stream-id, then repeatedly extracting and re-inserting the next value from the popped stream. Compare against melding k pre-built heaps and draining.

**I/O spec.** `k` then `k` sorted streams (sentinel-terminated). Output: single merged sorted stream.

**Constraints.** Total work O(N log k) where N = sum of stream sizes. No materializing all data in memory.

**Hint.** Two designs: (a) classic top-of-stream heap of size k, (b) meld k independent heaps then drain — measure which is faster.

```go
type Item struct{ key, stream int }
func KWayMerge(streams []<-chan int) <-chan int { /* TODO */ return nil }
```

```java
static int[] kWayMerge(int[][] streams) { /* TODO */ return new int[0]; }
```

```python
def k_way_merge(streams):
    # TODO: yield merged sorted values.
    yield from ()
```

**Evaluation criteria.**
- k = 1000 streams of 10^3 keys each: correct merged output.
- Memory bounded to O(k) heap nodes at any time.
- Benchmark vs `heapq.merge` / `PriorityQueue` / `container/heap`.

---

### Task 10 — Dijkstra using pairing heap on V=10^4, E=5·10^4

**Problem.** Implement Dijkstra's shortest-path algorithm with a pairing heap as the priority queue, using `DecreaseKey` instead of duplicate-insert. Maintain a `handle` array mapping vertex -> heap node.

**I/O spec.** Graph in CSR; source vertex `s`. Output: `dist[]` array.

**Constraints.** O((V+E) log V) amortized. No more than V live nodes in the heap.

**Hint.** Pre-allocate `handle = make([]*Node, V)`. On relaxation, if `handle[v] == nil` insert, else decrease-key.

```go
func Dijkstra(g *Graph, s int) []int64 {
    // TODO: pairing heap + handle array.
    return nil
}
```

```java
static long[] dijkstra(Graph g, int s) {
    // TODO.
    return null;
}
```

```python
def dijkstra(g, s):
    # TODO: pairing heap + handle map.
    return []
```

**Evaluation criteria.**
- Matches reference Dijkstra (binary heap) on 100 random graphs.
- Decrease-key call count recorded; should be <= E.
- Wall-clock time under 1 second per language for V = 10^4, E = 5·10^4.

---

## Advanced Tasks (5)

### Task 11 — Benchmark pairing heap vs indexed binary heap on Dijkstra (V=10^5, E=10^6)

**Problem.** Run Dijkstra on dense and sparse graphs at V = 10^5, E = 10^6 using both an indexed binary heap and a pairing heap. Report wall-clock, allocations, cache misses (Linux `perf`) and decrease-key counts. The theoretical edge of pairing heap depends on the ratio of decrease-keys to extract-mins.

**I/O spec.** Graph generator: random Erdős–Rényi with integer weights in [1, 10^6]. Output: CSV with `(impl, density, time_ms, dk_count, em_count)`.

**Constraints.** Same RNG seed across implementations. Warm up JIT for Java, GC-free measurement loops in Go.

**Hint.** Use Go's `testing.B`, JMH for Java, `pytest-benchmark` or hand-rolled `time.perf_counter_ns()` for Python.

```go
func BenchmarkDijkstraPairing(b *testing.B) { /* TODO */ }
func BenchmarkDijkstraBinary(b *testing.B)  { /* TODO */ }
```

```java
@Benchmark public void dijkstraPairing(Blackhole bh) { /* TODO */ }
@Benchmark public void dijkstraBinary(Blackhole bh)  { /* TODO */ }
```

```python
def bench_dijkstra_pairing(): ...  # TODO
def bench_dijkstra_binary(): ...   # TODO
```

**Evaluation criteria.**
- Report includes ns/op, allocs/op, decrease-key/extract-min counts.
- Statistical significance: 30 runs per cell, report median + IQR.
- Discussion: when is pairing faster and why?

---

### Task 12 — Multi-pass merge variant (left-to-right only); measure degradation

**Problem.** Replace two-pass merge with a single left-to-right fold. This is known to give worse amortized bounds (Ω(log n / log log n) extra per extract). Implement it and quantify the slowdown empirically on uniform random and worst-case-monotone inputs.

**I/O spec.** Internal flag `mergeStrategy = {TwoPass, MultiPassLR}`. Run both on identical workloads.

**Constraints.** Same external API. Must verify heap-order after each op.

**Hint.** Multi-pass LR: accumulator = children[0]; for i from 1 to end, accumulator = meld(accumulator, children[i]).

```go
type Strategy int
const ( TwoPass Strategy = iota; MultiPassLR )
func (h *Heap) SetStrategy(s Strategy) { h.strategy = s }
```

```java
enum Strategy { TWO_PASS, MULTI_PASS_LR }
void setStrategy(Strategy s) { this.strategy = s; }
```

```python
class Strategy: TWO_PASS, MULTI_PASS_LR = 0, 1
def set_strategy(self, s): self.strategy = s
```

**Evaluation criteria.**
- On uniform random: report slowdown ratio.
- On sorted-descending input: report slowdown ratio (expected: large).
- Plot `extract-min` average cost vs n on log-log axes for both strategies.

---

### Task 13 — Auxiliary two-pass with lazy children list

**Problem.** Implement the auxiliary two-pass variant where children are kept in a lazy linked list and only restructured during `extract-min`. Use a doubly-linked sibling list to make decrease-key cuts O(1) without traversing.

**I/O spec.** Same API as the standard variant.

**Constraints.** Decrease-key cut must be O(1) worst case. Children list traversal happens only inside two-pass merge.

**Hint.** Each node has `prev` and `next` siblings; the leftmost child has `prev` pointing to the parent. Add a flag to distinguish.

```go
type LazyNode struct {
    key                  int
    child, prev, next    *LazyNode
    isLeftmost           bool
}
```

```java
class LazyNode {
    int key;
    LazyNode child, prev, next;
    boolean isLeftmost;
}
```

```python
class LazyNode:
    __slots__ = ("key","child","prev","next","is_leftmost")
```

**Evaluation criteria.**
- Decrease-key timing constant regardless of subtree size.
- Same sorted output as standard variant on 10^4 random op streams.
- Memory overhead: extra pointer per node, measured.

---

### Task 14 — Adversarial input that forces a single extract-min to be Θ(n)

**Problem.** Construct an op sequence such that a particular `extract-min` performs Θ(n) work. Pairing heap is famous for hiding bad worst cases inside good amortized bounds; the goal is to expose one.

**I/O spec.** A generator producing an op log; a test that runs it and measures the cost of the targeted extract.

**Constraints.** Use deterministic seeded construction. The chosen extract must be identifiable (e.g. "extract #k").

**Hint.** A long chain of insertions in decreasing order followed by a single extract often gives a very wide root child-list; two-pass merge then has to walk all of it.

```go
func AdversarialOps(n int) []Op { /* TODO */ return nil }
```

```java
static List<Op> adversarialOps(int n) { /* TODO */ return List.of(); }
```

```python
def adversarial_ops(n):
    # TODO: build a sequence whose nth extract is Theta(n).
    return []
```

**Evaluation criteria.**
- For n in {10^3, 10^4, 10^5}, the targeted extract's instruction count grows linearly.
- Plot extract cost vs n on linear axes: should be a line.
- Document the structural reason in 4-6 sentences.

---

### Task 15 — A* search on a 2D grid using pairing heap

**Problem.** Implement A* path-finding on a grid with weighted cells and Manhattan heuristic, using a pairing heap as the open-set. Compare node-expansion counts and wall-clock vs a binary-heap A*.

**I/O spec.** Grid in ASCII: `#` blocked, digit `0-9` cost. Start `S`, goal `G`. Output: path length and path.

**Constraints.** Admissible heuristic. Re-open closed nodes if a better g-score is found (or prove the heuristic is consistent and skip).

**Hint.** Open-set entries keyed by `f = g + h`. On finding a shorter path to an open node, `DecreaseKey` instead of inserting a duplicate.

```go
func AStar(grid [][]byte, start, goal Point) ([]Point, int) { /* TODO */ return nil, 0 }
```

```java
static List<Point> aStar(byte[][] grid, Point s, Point g) { /* TODO */ return List.of(); }
```

```python
def a_star(grid, start, goal):
    # TODO: pairing-heap open set.
    return []
```

**Evaluation criteria.**
- Returns optimal path on 100 random 500x500 grids.
- Decrease-key calls counted; same as expected for consistent heuristic.
- Wall-clock parity or better vs binary-heap baseline.

---

## Benchmark Task

### Cross-language, cross-implementation: push n then pop n with intermixed decrease-key

**Problem.** Build a unified benchmark harness that runs the same workload across Go, Java, and Python, and across three priority-queue implementations: pairing heap, indexed binary heap, and Fibonacci heap. Workload: insert `n` keys with random integer values, then perform `n` operations chosen uniformly from `{extract-min, decrease-key}` with ratios `r in {0, 0.25, 0.5, 0.75, 1.0}` decrease-key share. Report wall-clock, allocations, and memory peak.

**I/O spec.** Driver reads a YAML or JSON config:

```text
sizes: [10000, 100000, 1000000]
dk_ratios: [0.0, 0.25, 0.5, 0.75, 1.0]
impls: [pairing, binary, fibonacci]
seed: 42
warmup_iters: 3
measure_iters: 10
```

Output: CSV `impl,lang,n,r,median_ms,p99_ms,allocs,peak_bytes`.

**Constraints.**
- Identical workload across languages (use the same RNG-seeded op stream serialized once, replayed everywhere).
- Warm up JIT (Java) and Python's allocator before measuring.
- For Go, pin GOMAXPROCS=1 during measurement to remove scheduler noise.
- For Python, use `time.perf_counter_ns()` and disable GC (`gc.disable()`) inside measurement loops.

**Hint.** Generate the op stream once in a "spec" file (`ops.bin` or `ops.txt`) and have each language consume it; this removes RNG-divergence as a source of error.

```go
type Spec struct {
    Sizes        []int
    DKRatios     []float64
    Impls        []string
    Seed         int64
    Warmup       int
    Measure      int
}

func RunBenchmark(spec Spec, out *csv.Writer) error {
    // TODO: for each (impl, n, r): generate ops, warmup, measure, write rows.
    return nil
}
```

```java
record Spec(int[] sizes, double[] dkRatios, String[] impls,
            long seed, int warmup, int measure) {}

static void runBenchmark(Spec spec, PrintWriter csv) {
    // TODO: same structure as Go driver.
}
```

```python
import time, gc, csv

def run_benchmark(spec, out_path):
    # TODO: replay shared op stream per impl, write CSV.
    pass
```

**Reporting requirements.**
- One CSV per language, plus one merged CSV with a `lang` column.
- Plots: `median_ms` vs `n` for each `r`, one subplot per impl, log-log axes.
- Discussion (200-400 words) covering:
  - When does pairing beat Fibonacci despite worse big-O?
  - Where does the binary heap shine (small n, no decrease-key)?
  - Cost of pointer-chasing in Java vs cache-friendly Go slices vs Python object overhead.
  - Effect of GC pauses on tail latency (p99).

**Evaluation criteria.**
- Reproducible: same seed produces identical op stream across all three languages.
- Statistical rigor: median + p99 reported, not just mean.
- Correctness check: after every workload the heap is drained and the output is verified sorted.
- Cross-language sanity: rankings of `(impl, r)` agree directionally across Go/Java/Python; absolute timings differ but the curves should have the same shape.

---

## Submission checklist

- [ ] All 15 tasks implemented in Go, Java, and Python.
- [ ] Heap-order verifier wired into a fuzz test for each language.
- [ ] Benchmark harness reproduces with a single command per language.
- [ ] CSV output produced and plots generated.
- [ ] Short write-up (one page) summarizing findings and surprises.
