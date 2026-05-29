# Skew Heap — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task is graded on correctness, asymptotic behavior, and code clarity.
> Skew heaps are self-adjusting mergeable heaps with O(log n) amortized cost
> per operation and no balance metadata (no rank, no NPL).

---

## Beginner Tasks (5)

### Task 1 — Recursive meld(a, b) with unconditional child swap

Implement the canonical recursive `meld` operation on a skew heap. Whenever
two non-empty trees are merged, the root with the smaller key becomes the
new root, its right subtree is recursively melded with the other tree, and
then its left and right children are unconditionally swapped. This single
swap rule is the entire balancing mechanism of a skew heap.

I/O spec:
- Input: two binary tree roots `a`, `b` (each may be `null`).
- Output: the root of the melded skew heap.

Constraints:
- Min-heap order; keys are 64-bit signed integers.
- No use of priority queues from the standard library.
- Recursion depth may be up to O(n) in the worst case; that is acceptable
  for this task but should be remembered when sizing the stack.

Hint:
- After the recursive call returns, the new right child is the result of
  the recursion. Then swap left and right unconditionally. Do not branch on
  any rank or size.

Starter code:

```go
package skewheap

type Node struct {
    Key         int64
    Left, Right *Node
}

func Meld(a, b *Node) *Node {
    if a == nil {
        return b
    }
    if b == nil {
        return a
    }
    // TODO: ensure a has the smaller key (swap a and b if needed)
    // TODO: a.Right = Meld(a.Right, b)
    // TODO: unconditional swap of a.Left and a.Right
    return a
}
```

```java
public final class SkewHeap {
    static final class Node {
        long key;
        Node left, right;
        Node(long k) { this.key = k; }
    }

    public static Node meld(Node a, Node b) {
        if (a == null) return b;
        if (b == null) return a;
        // TODO: make a the root with the smaller key
        // TODO: a.right = meld(a.right, b)
        // TODO: swap a.left and a.right
        return a;
    }
}
```

```python
class Node:
    __slots__ = ("key", "left", "right")
    def __init__(self, key):
        self.key = key
        self.left = None
        self.right = None

def meld(a, b):
    if a is None:
        return b
    if b is None:
        return a
    # TODO: if b.key < a.key, swap a and b
    # TODO: a.right = meld(a.right, b)
    # TODO: a.left, a.right = a.right, a.left
    return a
```

Evaluation criteria:
- Correct heap order on randomized inputs.
- Exactly one unconditional swap per recursive frame.
- Handles empty inputs without special cases beyond the two guards.

---

### Task 2 — Insert as meld with a singleton

Implement `insert(root, key)` by constructing a singleton node and melding
it with the existing heap. Show that this reduces insertion to the meld
primitive and inherits the O(log n) amortized bound.

I/O spec:
- Input: root of skew heap, integer key.
- Output: new root after insertion.

Constraints:
- Must not modify any node other than those visited by `meld`.
- Allocation must be O(1) per insert (one new node).

Hint:
- The whole body is `return meld(root, new Node(key))`.

Starter code:

```go
func Insert(root *Node, key int64) *Node {
    // TODO: allocate singleton and meld
    return root
}
```

```java
public static Node insert(Node root, long key) {
    // TODO: allocate singleton and meld
    return root;
}
```

```python
def insert(root, key):
    # TODO: return meld(root, Node(key))
    return root
```

Evaluation criteria:
- After N random inserts the heap contains exactly N keys.
- Min is the smallest key inserted.
- No allocations beyond the one new node.

---

### Task 3 — Extract-min via meld of root's children

Implement `extract_min(root)` which returns the root's key and the new
heap. The new heap is the meld of the root's left and right children.

I/O spec:
- Input: non-null root.
- Output: pair `(min_key, new_root)`.

Constraints:
- Calling on an empty heap is undefined; raise or return a sentinel
  consistently per language.
- Must not traverse the heap; the call uses only the root and its two
  immediate children.

Hint:
- `new_root = meld(root.left, root.right)`; the popped node can be
  discarded.

Starter code:

```go
func ExtractMin(root *Node) (int64, *Node) {
    // TODO: return root.Key and Meld(root.Left, root.Right)
    return 0, nil
}
```

```java
public static long extractMin(Node[] rootRef) {
    // rootRef is a one-element array so we can mutate the caller's reference
    Node r = rootRef[0];
    // TODO: rootRef[0] = meld(r.left, r.right)
    return r.key;
}
```

```python
def extract_min(root):
    # TODO: return (root.key, meld(root.left, root.right))
    return 0, None
```

Evaluation criteria:
- Repeated extract-min yields a sorted non-decreasing sequence.
- Total work to drain a heap of N keys is O(N log N) amortized.
- O(1) extra space per call beyond recursion.

---

### Task 4 — Verify the heap-order invariant after every operation

Write a `verify(root)` predicate that returns true iff every node's key is
no greater than the keys of its two children. Wrap insert and extract-min
so that the invariant is checked after each call during tests.

I/O spec:
- Input: root.
- Output: boolean.

Constraints:
- Must be O(n) and recursion- or stack-based.
- Used only in test harnesses; production calls should not pay this cost.

Hint:
- A standard DFS suffices. Do not check balance, only key order.

Starter code:

```go
func Verify(root *Node) bool {
    // TODO: DFS; for every node, key <= left.key (if left) and key <= right.key (if right)
    return true
}
```

```java
public static boolean verify(Node root) {
    // TODO: iterative DFS using ArrayDeque
    return true;
}
```

```python
def verify(root):
    # TODO: iterative DFS; reject when child.key < node.key
    return True
```

Evaluation criteria:
- Detects a hand-corrupted heap where one child key is decreased.
- Returns true on all heaps produced by the reference implementation.
- Reports the offending node when failing (bonus).

---

### Task 5 — Print the heap as an indented tree

Implement a `printTree(root, indent)` function that writes the structure
to standard output, indented by depth, with the right child first so the
output reads top-to-bottom in a familiar tree layout.

I/O spec:
- Input: root, indent string (e.g., `"    "`).
- Output: lines to stdout.

Constraints:
- Each node is printed once.
- Null subtrees are omitted (do not print blanks).

Hint:
- DFS with a `depth` parameter; print `indent * depth + str(key)`.

Starter code:

```go
func PrintTree(n *Node, depth int) {
    if n == nil {
        return
    }
    // TODO: recurse on right with depth+1, print, recurse on left with depth+1
}
```

```java
public static void printTree(Node n, int depth) {
    if (n == null) return;
    // TODO: same recursion order as Go example
}
```

```python
def print_tree(node, depth=0):
    if node is None:
        return
    # TODO: print_tree(node.right, depth+1)
    # TODO: print(" " * (4*depth) + str(node.key))
    # TODO: print_tree(node.left, depth+1)
```

Evaluation criteria:
- Output for `[5,3,8,1]` after sequential inserts is visually correct.
- Right-then-root-then-left order is preserved.
- No output for an empty heap.

---

## Intermediate Tasks (5)

### Task 6 — Iterative meld (no recursion)

Re-implement `meld` without recursion. Walk the right spines of both
trees, link them in non-decreasing key order, and then perform the
unconditional left/right swap along the resulting spine from bottom up.

I/O spec:
- Input: two roots.
- Output: melded root.

Constraints:
- Stack usage is O(1) in addition to the implicit list of visited nodes.
- Must match the recursive version on every input.

Hint:
- Phase 1: collect the right spines into one ascending-key list.
- Phase 2: link them right-to-left, swapping children at each node so
  every visited node ends up with its old right child as its new left
  child.

Starter code:

```go
func MeldIter(a, b *Node) *Node {
    // TODO: gather right spines, link in ascending key order, swap children
    return nil
}
```

```java
public static Node meldIter(Node a, Node b) {
    // TODO: same plan as Go
    return null;
}
```

```python
def meld_iter(a, b):
    # TODO: gather spines into a list, sort by key, link from tail to head
    return None
```

Evaluation criteria:
- 10^6 random melds produce identical structures to the recursive version
  modulo tie-breaking on equal keys.
- No stack-overflow on degenerate right-leaning inputs (n=10^6).
- Runs at least 1.3x faster than the recursive version for n>=10^5.

---

### Task 7 — K-way merge of K=4 sorted arrays using a skew heap

Given four sorted ascending arrays `A, B, C, D`, output the fully merged
sorted sequence using a skew heap of size at most 4. Each heap entry
carries a key and a (source-array, index) tag.

I/O spec:
- Input: four ascending integer arrays.
- Output: one ascending merged array.

Constraints:
- Heap holds at most one entry per source array at any time.
- Total work is O(N log K), where N = |A|+|B|+|C|+|D| and K=4.

Hint:
- Push the head of each array. Repeatedly extract-min, append to output,
  and push the next element from the same source array.

Starter code:

```go
type Entry struct {
    Key      int64
    Src, Pos int
}

func MergeK(arrs [][]int64) []int64 {
    // TODO: build skew heap of Entry, drive it as above
    return nil
}
```

```java
public static long[] mergeK(long[][] arrs) {
    // TODO: build skew heap of (key, src, pos) records
    return new long[0];
}
```

```python
def merge_k(arrs):
    # TODO: maintain skew heap of (key, src, pos)
    return []
```

Evaluation criteria:
- Output equals `sorted(A + B + C + D)`.
- Memory usage is O(K) for the heap plus output.
- Stable when two heads carry equal keys (lower `src` first).

---

### Task 8 — Compare comparison counts between leftist and skew on the same input

Instrument both a leftist heap and a skew heap to count key comparisons
performed inside `meld`. Run the same workload — `M` mixed inserts and
extract-mins — and report total comparisons and comparisons per
operation.

I/O spec:
- Input: workload of (op, key) pairs.
- Output: tab-separated table of `op_count, leftist_cmps, skew_cmps`.

Constraints:
- Both implementations must use identical comparison primitives.
- `M >= 10^5` for the table to be meaningful.

Hint:
- Skew is expected to win on random workloads and lose modestly on
  adversarial right-spine workloads.

Starter code:

```go
func RunWorkload(ops []Op) (leftistCmps, skewCmps int64) {
    // TODO: drive both heaps in parallel, count comparisons
    return
}
```

```java
public static long[] runWorkload(Op[] ops) {
    // TODO: returns [leftistCmps, skewCmps]
    return new long[]{0, 0};
}
```

```python
def run_workload(ops):
    # TODO: returns (leftist_cmps, skew_cmps)
    return 0, 0
```

Evaluation criteria:
- Both heaps produce the same extract-min sequence.
- Reported numbers are reproducible across runs with a fixed seed.
- Short discussion of when skew wins and when it does not.

---

### Task 9 — Lazy delete with a deletion flag

Add a boolean `deleted` flag on each node. Implement `lazyDelete(node)`
which marks the node, and modify `extractMin` to skip and meld around
deleted roots until a live one is found.

I/O spec:
- Input: node reference for `lazyDelete`; nothing for `extractMin`.
- Output: extracted live key, or sentinel if heap is logically empty.

Constraints:
- Marking is O(1).
- Amortized extract-min remains O(log n) over a workload where at most
  half the nodes are deleted.

Hint:
- Keep a `liveCount` counter so callers can detect emptiness without
  walking the tree.

Starter code:

```go
func LazyDelete(n *Node) { /* TODO: set n.Deleted = true */ }

func ExtractMinLazy(root *Node) (int64, *Node, bool) {
    // TODO: while root != nil and root.Deleted: root = Meld(root.Left, root.Right)
    return 0, root, false
}
```

```java
public static long extractMinLazy(Node[] rootRef) {
    // TODO: skip deleted roots by repeatedly melding their children
    return 0;
}
```

```python
def extract_min_lazy(root):
    # TODO: loop while root and root.deleted: root = meld(root.left, root.right)
    return 0, root, False
```

Evaluation criteria:
- Deleted keys never appear in the output sequence.
- `liveCount` stays consistent under random insert/delete/extract.
- Performance does not degrade by more than 2x compared to eager delete
  on workloads with <=50% deletions.

---

### Task 10 — Build a Huffman code using a skew heap

Use a skew heap of (frequency, subtree) entries to build a Huffman tree:
repeatedly extract the two minima, combine them under a new internal
node whose frequency is the sum, and insert the result. Output the
canonical code lengths per symbol.

I/O spec:
- Input: array of (symbol, frequency).
- Output: array of (symbol, code_length).

Constraints:
- Total runtime is O(n log n) for n distinct symbols.
- Ties broken deterministically (e.g., by symbol value).

Hint:
- Stop when the heap has a single tree; its depth-per-leaf gives the code
  length.

Starter code:

```go
func Huffman(symbols []Symbol) []CodeLen {
    // TODO: skew heap on Symbol frequencies, combine pairs, DFS for depths
    return nil
}
```

```java
public static int[] huffman(int[] freq) {
    // TODO: skew heap of internal node references
    return new int[freq.length];
}
```

```python
def huffman(freq):
    # TODO: build tree via skew heap, return code lengths in symbol order
    return []
```

Evaluation criteria:
- Sum of `freq[i] * codeLen[i]` matches a reference Huffman implementation.
- No code length exceeds `n - 1`.
- Deterministic output for a given input order.

---

## Advanced Tasks (5)

### Task 11 — Adversarial input making a single extract-min Θ(n)

Find a sequence of inserts that produces a skew heap whose extract-min
visits Θ(n) nodes. The amortized bound permits this single bad
operation; your job is to exhibit and explain the construction.

I/O spec:
- Input: n.
- Output: ordered list of insert keys producing a worst-case extract-min.

Constraints:
- After all inserts, the heap must be a right-leaning chain or close to
  it so the children's meld walks the whole spine.
- Provide a written justification (5–10 lines) in a `notes.txt` file.

Hint:
- Inserting strictly increasing keys does not always work because the
  swap rule perturbs the spine. Consider sequences that first build a
  long right chain and then trigger a meld that walks it.

Starter code:

```go
func AdversarialInserts(n int) []int64 {
    // TODO: design the sequence; verify by measuring nodes visited in extract-min
    return nil
}
```

```java
public static long[] adversarialInserts(int n) {
    // TODO: same idea
    return new long[n];
}
```

```python
def adversarial_inserts(n):
    # TODO: return list of keys
    return []
```

Evaluation criteria:
- On the generated input, extract-min visits at least `0.4 * n` nodes
  for n=10^4.
- Written explanation cites the credit-balance argument.
- Reproducible from a fixed seed.

---

### Task 12 — Persistent (purely functional) skew heap

Implement a persistent skew heap in which every operation returns a new
root and never mutates existing nodes. Old versions remain valid and
queryable.

I/O spec:
- Each call to `insert` and `extractMin` returns a fresh root.
- Old roots continue to support `min` and `extractMin` correctly.

Constraints:
- Path copying along the merged spine is acceptable; do not deep-copy
  the whole tree.
- Memory cost per operation is O(log n) amortized.

Hint:
- In `meld`, always allocate a new `Node` for each frame instead of
  mutating `a`. The unconditional swap is now a constructor argument.

Starter code:

```go
type PNode struct {
    Key         int64
    Left, Right *PNode
}

func PMeld(a, b *PNode) *PNode {
    // TODO: allocate fresh nodes; never mutate a or b
    return nil
}
```

```java
public record PNode(long key, PNode left, PNode right) {
    public static PNode meld(PNode a, PNode b) {
        // TODO: construct new records
        return null;
    }
}
```

```python
class PNode:
    __slots__ = ("key", "left", "right")
    def __init__(self, key, left=None, right=None):
        self.key = key
        self.left = left
        self.right = right

def pmeld(a, b):
    # TODO: build new PNode instances along the merged spine
    return None
```

Evaluation criteria:
- Old roots return their old min after subsequent operations.
- Total allocated nodes for a workload of M operations is O(M log n).
- Property test: replay any prefix of operations and observe identical
  states to the original sequence at that point.

---

### Task 13 — Decrease-key with parent pointers

Augment the skew heap with parent pointers and implement `decreaseKey`:
detach the node's subtree from its parent, set the new key, and meld the
detached subtree with the root. Note that this is rare in practice
because parent pointers complicate the swap rule.

I/O spec:
- Input: node reference, new key (new key <= old key).
- Output: new root.

Constraints:
- Maintain parent pointers correctly through every meld and every swap.
- O(log n) amortized for `decreaseKey`.

Hint:
- The swap step has to fix up parent pointers of the swapped children.

Starter code:

```go
type DNode struct {
    Key                int64
    Parent, Left, Right *DNode
}

func DecreaseKey(root, n *DNode, newKey int64) *DNode {
    // TODO: detach, update key, meld with root
    return root
}
```

```java
public static DNode decreaseKey(DNode root, DNode n, long newKey) {
    // TODO: detach n, set n.key = newKey, meld with root
    return root;
}
```

```python
def decrease_key(root, n, new_key):
    # TODO: detach n from its parent, set n.key, meld(root, n)
    return root
```

Evaluation criteria:
- After randomized inserts and decrease-keys, the heap order invariant
  holds.
- Parent pointers consistent: every non-root has a parent whose child
  pointer points back.
- Amortized cost measured over 10^5 decrease-keys is O(log n).

---

### Task 14 — Skew-pairing hybrid heap

Build a hybrid that uses skew melding for small subtrees and pairing-heap
multipass for large ones, switching at a threshold `T`. Measure whether
the hybrid beats either pure variant on mixed workloads.

I/O spec:
- Input: workload, threshold T.
- Output: workload completion time and operation counts.

Constraints:
- The hybrid must still satisfy the heap-order invariant.
- Threshold tuning is done empirically; report the best T found.

Hint:
- Track subtree size lazily (only when needed) so the threshold check is
  cheap.

Starter code:

```go
func HybridMeld(a, b *Node, T int) *Node {
    // TODO: if size(a)+size(b) < T use skew rule; else use pairing two-pass
    return nil
}
```

```java
public static Node hybridMeld(Node a, Node b, int T) {
    // TODO: same plan as Go
    return null;
}
```

```python
def hybrid_meld(a, b, T):
    # TODO: branch on combined size against threshold T
    return None
```

Evaluation criteria:
- Hybrid produces identical extract-min order to either pure version.
- A clearly chosen T (often in [16, 256]) outperforms both pure variants
  on at least one of the benchmark workloads.
- Report includes a small table of `T` vs. throughput.

---

### Task 15 — Dijkstra using a skew heap (V=10^4, E=5·10^4)

Implement Dijkstra's single-source shortest path using a skew heap as
the priority queue. Use lazy delete or re-insertion to handle distance
updates (no decrease-key required).

I/O spec:
- Input: graph as adjacency list with non-negative integer weights.
- Output: array of shortest distances from a chosen source.

Constraints:
- V = 10^4, E = 5*10^4 in the test graph.
- Runtime should be within 2x of a binary-heap baseline on the same
  graph.

Hint:
- Push `(dist, v)` pairs. On pop, ignore the pair if `dist > bestDist[v]`.
  This is the standard "stale entries" trick.

Starter code:

```go
func Dijkstra(adj [][]Edge, src int) []int64 {
    // TODO: skew heap of (dist, v) with stale-entry skipping
    return nil
}
```

```java
public static long[] dijkstra(int[][] adjW, int src) {
    // adjW[v] alternates (neighbor, weight)
    // TODO: skew heap of long-packed (dist, v)
    return new long[0];
}
```

```python
def dijkstra(adj, src):
    # TODO: skew heap holding (dist, v); skip stale tuples
    return []
```

Evaluation criteria:
- Matches reference distances on a held-out test graph.
- Total heap operations counted and reported.
- Wall-clock within 2x of a binary-heap baseline.

---

## Benchmark Task

Cross-language and cross-impl benchmark: skew heap vs leftist heap vs
pairing heap. Three languages (Go, Java, Python). Three sizes n in
{10^4, 10^5, 10^6}. Three workloads:

1. `INSERT_ALL_THEN_DRAIN`: n random inserts followed by n extract-mins.
2. `MIXED_50_50`: 2n operations, each independently insert or extract
   with probability 1/2, modulo non-empty guards.
3. `MELD_HEAVY`: build sqrt(n) heaps of size n/sqrt(n) each, then meld
   them pairwise down to one.

Measurement rules:
- Wall-clock with a monotonic clock; warm up JVM with 3 untimed runs.
- Same RNG seed across languages and impls.
- Report median of 7 runs; discard min and max.
- Memory peak via OS-level tools (RSS) or language-specific profilers.

Deliverables:
- A CSV with columns `lang,impl,workload,n,median_ms,peak_rss_mb`.
- A short summary (10–20 lines) discussing which heap wins where.
- Notes on tail latency: 99th percentile of single-operation time for
  the `MIXED_50_50` workload at n=10^5.

Starter table (text):

```text
lang   impl     workload                 n        median_ms   peak_rss_mb
go     skew     INSERT_ALL_THEN_DRAIN    10000    ...         ...
go     leftist  INSERT_ALL_THEN_DRAIN    10000    ...         ...
go     pairing  INSERT_ALL_THEN_DRAIN    10000    ...         ...
...
```

Evaluation criteria:
- All 81 rows are populated (3 langs * 3 impls * 3 workloads * 3 sizes).
- Methodology is reproducible from a single script.
- Summary distinguishes amortized winners from worst-case winners and
  notes the cost of Python recursion limits for large `n`.
