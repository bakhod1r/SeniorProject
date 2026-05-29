# Leftist Heap — Practice Tasks

> All tasks must be solved in Go, Java, and Python.

This file collects 15 practice tasks plus one benchmark task for the leftist heap
data structure. The tasks progress from computing the null path length (NPL) and
verifying the invariant, through implementing meld / insert / extract-min, into
applied problems (K-way merge, Huffman codes), and finally to advanced variants
(persistent, lazy-deleted, weight-biased). Solve each task in all three target
languages — Go, Java, and Python — so that you internalise the structure
independent of any one runtime's quirks.

---

## Beginner Tasks (5)

### Task 1 — Compute NPL for each node

**Problem.** Given the root of a binary tree, compute the null path length (NPL)
for every node, where `NPL(nil) = -1` and `NPL(node) = 1 + min(NPL(left),
NPL(right))`. Return the NPL values as a level-order list. NPL is the foundation
of the leftist invariant, so this task forces you to compute it before you ever
balance anything.

**I/O.**

```text
Input  : root of a binary tree with N nodes (1 <= N <= 10^5)
Output : list of N integers, NPL of each node in level order
```

**Constraints.** O(N) time, O(N) auxiliary memory.

**Hint.** Post-order DFS first (children before parent), then a second BFS pass
to emit the values in level order. Cache NPL on each node.

```go
type Node struct {
    Val         int
    Left, Right *Node
    NPL         int
}

func ComputeNPL(root *Node) []int {
    // TODO: post-order compute NPL on every node
    // TODO: level-order traversal collecting NPL values
    return nil
}
```

```java
class Node {
    int val, npl;
    Node left, right;
    Node(int v) { this.val = v; this.npl = -1; }
}

public class NplComputer {
    public static List<Integer> computeNpl(Node root) {
        // TODO: post-order DFS to fill node.npl
        // TODO: BFS to collect level-order list
        return List.of();
    }
}
```

```python
class Node:
    __slots__ = ("val", "left", "right", "npl")
    def __init__(self, val):
        self.val, self.left, self.right, self.npl = val, None, None, -1

def compute_npl(root):
    # TODO: post-order DFS, set node.npl
    # TODO: BFS, return list of npl values
    return []
```

**Evaluation.** Correct base case `NPL(nil) = -1`; correct `min` (not `max`);
exactly one DFS + one BFS; no recomputation.

---

### Task 2 — Verify the leftist invariant

**Problem.** Given a binary tree where every node carries an NPL value, verify
the leftist invariant: for every node, `NPL(left) >= NPL(right)`. Return `true`
if the tree satisfies the invariant everywhere, `false` otherwise, together with
the path to the first violating node.

**I/O.**

```text
Input  : root of a binary tree with NPL annotations
Output : (bool, []int) — verdict + path of indices from root to first violation
```

**Constraints.** O(N) time, O(H) recursion stack (H = height).

**Hint.** A `nil` child has `NPL = -1`. Visit pre-order; bail out as soon as you
find `NPL(left) < NPL(right)` and unwind the path.

```go
func VerifyLeftist(root *Node) (bool, []int) {
    // TODO: DFS, compare NPL of children, return path on first failure
    return true, nil
}
```

```java
public static record Verdict(boolean ok, List<Integer> path) {}

public static Verdict verifyLeftist(Node root) {
    // TODO: pre-order DFS, short-circuit on first violation
    return new Verdict(true, List.of());
}
```

```python
def verify_leftist(root):
    # TODO: DFS, short-circuit on violation, return (ok, path)
    return True, []
```

**Evaluation.** Treats `nil` as NPL `-1`; reports the *first* violation, not the
last; path indices go 0 = left, 1 = right.

---

### Task 3 — Implement recursive meld

**Problem.** Implement the canonical recursive meld of two leftist heaps. After
melding, swap children if `NPL(right) > NPL(left)` to restore the invariant, and
update `NPL(parent) = 1 + NPL(right)`.

**I/O.**

```text
Input  : roots a, b of two leftist heaps (min-heap order)
Output : root of the melded heap
```

**Constraints.** O(log N + log M) per meld.

**Hint.** Recurse `meld(a, b)`: assume `a.val <= b.val` (swap if not), set
`a.right = meld(a.right, b)`, then leftist-fix `a`.

```go
func Meld(a, b *Node) *Node {
    if a == nil { return b }
    if b == nil { return a }
    if a.Val > b.Val { a, b = b, a }
    // TODO: a.Right = Meld(a.Right, b); leftist-fix a
    return a
}
```

```java
public static Node meld(Node a, Node b) {
    if (a == null) return b;
    if (b == null) return a;
    if (a.val > b.val) { Node t = a; a = b; b = t; }
    // TODO: a.right = meld(a.right, b); fix a
    return a;
}
```

```python
def meld(a, b):
    if a is None: return b
    if b is None: return a
    if a.val > b.val: a, b = b, a
    # TODO: a.right = meld(a.right, b); fix a
    return a
```

**Evaluation.** Min-heap order preserved; leftist invariant restored at every
returned node; NPL updated correctly; runtime O(log N + log M).

---

### Task 4 — Implement insert (meld with singleton)

**Problem.** Implement `insert(root, x)` as `meld(root, &Node{Val: x})`. Do not
write a separate insert algorithm — *insert is meld with a singleton heap*. This
task forces you to internalise that idiom.

**I/O.**

```text
Input  : leftist heap root, key x
Output : new root after inserting x
```

**Constraints.** O(log N) amortised.

**Hint.** Build a `Node{val: x}` with NPL 0, then call your `Meld`.

```go
func Insert(root *Node, x int) *Node {
    // TODO: return Meld(root, &Node{Val: x})
    return root
}
```

```java
public static Node insert(Node root, int x) {
    // TODO: return meld(root, new Node(x));
    return root;
}
```

```python
def insert(root, x):
    # TODO: return meld(root, Node(x))
    return root
```

**Evaluation.** No special-case insert code; reuses `meld`; preserves leftist
invariant; passes `verify_leftist` after every insert in a random sequence.

---

### Task 5 — Implement extract-min

**Problem.** Implement `extract_min(root)` returning `(min, new_root)` where
`min = root.val` and `new_root = meld(root.left, root.right)`.

**I/O.**

```text
Input  : non-empty leftist heap root
Output : (int min, root after removing min)
```

**Constraints.** O(log N).

**Hint.** Save `root.val`, then return `meld(root.left, root.right)`. No
re-heapification is needed beyond the meld.

```go
func ExtractMin(root *Node) (int, *Node) {
    // TODO: return root.Val, Meld(root.Left, root.Right)
    return 0, nil
}
```

```java
public static record Extracted(int min, Node root) {}

public static Extracted extractMin(Node root) {
    // TODO: return new Extracted(root.val, meld(root.left, root.right));
    return new Extracted(0, null);
}
```

```python
def extract_min(root):
    # TODO: return root.val, meld(root.left, root.right)
    return 0, None
```

**Evaluation.** Returns smallest key; new root satisfies leftist invariant;
total cost O(log N); does not leak the old root reference (in Go/Java release
it; in Python rely on GC).

---

## Intermediate Tasks (5)

### Task 6 — Convert an arbitrary binary tree to a leftist heap

**Problem.** Given an arbitrary binary tree of N integers (no heap order, no
leftist invariant), convert it to a leftist *min*-heap of the same N elements.
Use repeated meld in level order: treat every node as a singleton, push onto a
FIFO, repeatedly dequeue two and meld and re-enqueue.

**I/O.**

```text
Input  : binary tree with N nodes
Output : root of a leftist min-heap containing the same N values
```

**Constraints.** O(N log N) time, O(N) memory.

**Hint.** Detach children before pushing onto the queue, otherwise `meld` will
inherit stray subtrees.

```go
func TreeToLeftistHeap(root *Node) *Node {
    // TODO: flatten to singletons, FIFO-meld pairs until one remains
    return nil
}
```

```java
public static Node treeToLeftist(Node root) {
    // TODO: Deque<Node> queue of singletons, meld two at a time
    return null;
}
```

```python
from collections import deque

def tree_to_leftist(root):
    # TODO: BFS collect singletons, meld pairwise via deque
    return None
```

**Evaluation.** Output passes `verify_leftist` and is a valid min-heap;
queue-based meld instead of N inserts (asymptotically same but conceptually
cleaner).

---

### Task 7 — K-way merge using a leftist heap (K = 4)

**Problem.** Merge 4 sorted arrays into a single sorted array using a leftist
heap whose keys are `(value, source_array_index, position_in_source)`. Each pop
emits the next element and pushes its successor from the same source.

**I/O.**

```text
Input  : 4 sorted arrays a, b, c, d
Output : single sorted array containing all elements
```

**Constraints.** O(N log K) where N is total length and K = 4.

**Hint.** Min-heap by `value`; carry the source index so you know which array to
advance.

```go
type Entry struct{ Val, Src, Idx int }

func KWayMerge4(arrs [4][]int) []int {
    // TODO: insert head of each array, loop: extract min, push successor
    return nil
}
```

```java
public static int[] kwayMerge4(int[][] arrs) {
    // TODO: leftist heap of (val, src, idx); same loop
    return new int[0];
}
```

```python
def kway_merge4(arrs):
    # TODO: heap of tuples, extract-min, push successor
    return []
```

**Evaluation.** Output sorted; total work O(N log 4); heap never grows beyond 4
entries; correctly handles arrays of different lengths.

---

### Task 8 — Iterative meld (no recursion)

**Problem.** Re-implement meld iteratively. Walk down the right spines of both
heaps, link the smaller-key node into a result list, then walk back up swapping
children and recomputing NPL.

**I/O.**

```text
Input  : roots a, b of two leftist heaps
Output : root of the melded heap, without using recursion
```

**Constraints.** O(log N + log M); no recursion stack.

**Hint.** Phase 1: pop the smaller of the two right-spine heads and append it to
a stack. Phase 2: pop the stack, attaching each node as the right child of the
previous, swapping when `NPL(right) > NPL(left)`.

```go
func MeldIter(a, b *Node) *Node {
    // TODO: two-phase iterative meld
    return nil
}
```

```java
public static Node meldIter(Node a, Node b) {
    // TODO: stack-based meld
    return null;
}
```

```python
def meld_iter(a, b):
    # TODO: phase 1 collect, phase 2 stitch + leftist-fix
    return None
```

**Evaluation.** No recursion; bit-for-bit identical output to recursive meld on
the same input; passes `verify_leftist`; faster on n = 10^7 in cache-cold
benchmarks (see Task 15).

---

### Task 9 — Huffman code from frequencies

**Problem.** Given character frequencies, build a Huffman tree using a leftist
heap as the priority queue, then derive the code for each character. The min-heap
keys are subtree weights; each step extracts two minimal trees and melds them
into a new internal node whose weight is their sum.

**I/O.**

```text
Input  : map char -> int frequency (1 <= freq, total <= 10^7)
Output : map char -> string (the binary code)
```

**Constraints.** O(N log N) where N is the number of distinct chars.

**Hint.** Wrap each `(weight, subtree)` in a heap node. After the heap shrinks
to a single tree, DFS it accumulating the bit string.

```go
type HuffNode struct {
    Weight       int
    Char         rune
    Left, Right  *HuffNode
}

func HuffmanCodes(freq map[rune]int) map[rune]string {
    // TODO: heap of HuffNode by weight; build tree; DFS to codes
    return nil
}
```

```java
public static Map<Character, String> huffmanCodes(Map<Character, Integer> freq) {
    // TODO: leftist heap by weight; build; DFS for codes
    return Map.of();
}
```

```python
def huffman_codes(freq):
    # TODO: build leftist heap of (weight, subtree); pop two, meld two, push
    # TODO: DFS final tree to assign 0/1
    return {}
```

**Evaluation.** Codes are prefix-free; weighted code length equals the optimal
Huffman length; ties broken consistently; alphabet of size 1 handled (single bit
or zero bits — pick one and document).

---

### Task 10 — Weight-biased leftist heap

**Problem.** Implement the weight-biased variant where each node stores
`size = 1 + size(left) + size(right)` instead of NPL, and the invariant becomes
`size(left) >= size(right)`. Reuse the same meld skeleton but with `size`
instead of NPL.

**I/O.**

```text
Input  : sequence of insert and extract-min operations
Output : sequence of extracted minima
```

**Constraints.** Same O(log N) bounds, but the recursion can be unfolded into
an iterative single-pass meld (Okasaki's trick).

**Hint.** Track size in every node; swap children if `size(right) > size(left)`
after `meld(a.right, b)`. The single-pass version computes sizes top-down on
descent instead of bottom-up on return.

```go
type WBNode struct {
    Val          int
    Size         int
    Left, Right  *WBNode
}

func WBMeld(a, b *WBNode) *WBNode {
    // TODO: same skeleton as Meld, but compare Size and re-balance by Size
    return nil
}
```

```java
public static WBNode wbMeld(WBNode a, WBNode b) {
    // TODO: size-based meld
    return null;
}
```

```python
def wb_meld(a, b):
    # TODO: weight-biased meld
    return None
```

**Evaluation.** Invariant `size(left) >= size(right)` holds at every node; same
O(log N) operations; single-pass meld variant produces identical output.

---

## Advanced Tasks (5)

### Task 11 — Persistent leftist heap (Okasaki)

**Problem.** Implement a *persistent* leftist heap: every operation returns a
new root, and the old root is still usable and unchanged. Use immutable nodes
(in Go and Java, never mutate fields after construction; in Python, freeze with
`__slots__` and never reassign).

**I/O.**

```text
Input  : a versioned sequence of inserts, extracts, and references to old
         versions
Output : the correct min for each query, against any version
```

**Constraints.** Operations stay O(log N); space O(log N) per operation thanks
to path copying.

**Hint.** Meld builds a fresh node at every step on the right spine, sharing the
left subtree. Old roots remain unaffected because no node is ever rewritten.

```go
type PNode struct {
    Val          int
    NPL          int
    Left, Right  *PNode
}

func PMeld(a, b *PNode) *PNode {
    // TODO: allocate a brand-new node at every recursive step
    return nil
}
```

```java
public final class PNode {
    public final int val, npl;
    public final PNode left, right;
    public PNode(int val, int npl, PNode left, PNode right) {
        this.val = val; this.npl = npl; this.left = left; this.right = right;
    }
}

public static PNode pmeld(PNode a, PNode b) {
    // TODO: pure-functional meld
    return null;
}
```

```python
class PNode:
    __slots__ = ("val", "npl", "left", "right")
    def __init__(self, val, npl, left, right):
        self.val, self.npl, self.left, self.right = val, npl, left, right

def pmeld(a, b):
    # TODO: never mutate; always allocate a fresh PNode
    return None
```

**Evaluation.** Reading a snapshot from N operations ago gives the original
heap; no field is ever reassigned; per-op allocation O(log N).

---

### Task 12 — Lazy delete

**Problem.** Add a `deleted bool` flag and a `lazyDelete(node)` that marks
without rebalancing. Modify `extractMin` to repeatedly pop until it sees a
non-deleted root, performing meld on the children at each skip.

**I/O.**

```text
Input  : sequence of insert, lazy_delete(handle), extract_min
Output : extracted minima skipping the lazily-deleted nodes
```

**Constraints.** Amortised O(log N) per op; worst case O(M log N) for a single
extract following M lazy deletes — but the cost is paid by those M deletes.

**Hint.** Hand out node handles from insert. On `lazy_delete`, set the flag
only. On `extract_min`, loop: if `root.deleted`, `root = meld(left, right)` and
try again.

```go
type LNode struct {
    Val          int
    NPL          int
    Deleted      bool
    Left, Right  *LNode
}

func LazyDelete(h *LNode) { h.Deleted = true }

func LExtractMin(root *LNode) (int, *LNode) {
    // TODO: loop, skipping deleted roots via meld
    return 0, nil
}
```

```java
public static int lazyExtractMin(LNode[] rootRef) {
    // TODO: skip deleted, repeat meld
    return 0;
}
```

```python
def lazy_extract_min(root):
    # TODO: while root and root.deleted: root = meld(root.left, root.right)
    return 0, None
```

**Evaluation.** Live nodes are returned in order; deleted nodes are silently
skipped; amortised cost matches the theoretical bound on random workloads.

---

### Task 13 — Kth smallest from a stream

**Problem.** Stream of N integers (N up to 10^7); at every step output the
current kth smallest (k fixed up front). Use a *max*-heap (leftist heap with
negated keys, or with a reversed comparator) of size k.

**I/O.**

```text
Input  : k (1 <= k <= 10^4), stream of N integers
Output : after each input, the current kth smallest
```

**Constraints.** O(log k) per element; heap never exceeds k elements.

**Hint.** Maintain a max-leftist-heap of size k containing the smallest k seen
so far. For each new x: if heap has fewer than k items insert x; else if
x < heap-max, replace the max with x. The current root is the kth smallest.

```go
func KthSmallestStream(k int, stream <-chan int) <-chan int {
    // TODO: bounded max-heap of size k
    return nil
}
```

```java
public static IntStream kthSmallestStream(int k, IntStream input) {
    // TODO: bounded max-leftist-heap, emit root after each element
    return IntStream.empty();
}
```

```python
def kth_smallest_stream(k, stream):
    # TODO: yield current kth smallest after each element
    yield from ()
```

**Evaluation.** Output matches a reference `sorted(stream[:i+1])[k-1]` for every
prefix where i+1 >= k; per-element cost O(log k); memory O(k).

---

### Task 14 — Decrease-key with parent pointers

**Problem.** Add parent pointers to your leftist heap and implement
`decreaseKey(handle, new_value)`. After the update, detach the subtree rooted
at the handle and re-meld it with the root.

**I/O.**

```text
Input  : sequence of insert (returning handles) and decrease_key(handle, v)
Output : after each op, the current min via extract_min
```

**Constraints.** O(log N) per decrease-key; parent pointers must stay consistent
under meld.

**Hint.** The hard part is *maintaining* parent pointers across meld — every
time meld swaps children or assigns `a.right`, fix `child.parent`. On
decrease-key, splice out the subtree (clear `parent`'s child pointer, clear own
`parent`), update the value, then `meld(root, subtree)`.

```go
type DNode struct {
    Val            int
    NPL            int
    Parent         *DNode
    Left, Right    *DNode
}

func DecreaseKey(root, h *DNode, v int) *DNode {
    // TODO: splice out h's subtree, update value, meld back
    return root
}
```

```java
public static DNode decreaseKey(DNode root, DNode h, int v) {
    // TODO: detach subtree, update, re-meld
    return root;
}
```

```python
def decrease_key(root, h, v):
    # TODO: splice subtree, update, re-meld
    return root
```

**Evaluation.** Parent pointers consistent after every meld; new value <= old
value enforced; final extract_min order matches a reference Python heapq with
manual update-by-replace.

---

### Task 15 — Recursive vs iterative meld benchmark (n = 10^7)

**Problem.** Benchmark recursive meld (Task 3) vs iterative meld (Task 8) on
random insert / extract-min workloads of size 10^7. Report wall-clock time,
peak memory, and recursion depth seen by recursive meld.

**I/O.**

```text
Input  : n (10^7), seed for reproducibility
Output : table — variant | total ms | max recursion depth | peak MB
```

**Constraints.** Run each variant 5 times, report median; pin to a single
thread; disable GC where possible (Go: `runtime.GC` then `GOGC=off`; Java:
`-Xms = -Xmx`; Python: `gc.disable()` for the timed section).

**Hint.** In Go, raise stack via larger goroutine; in Java, watch for
`StackOverflowError` on the recursive variant past ~10^4 NPL spine length; in
Python, `sys.setrecursionlimit(10**6)` then expect a `RecursionError` anyway —
that *is* the result.

```go
func BenchmarkMeld(n int, seed int64) {
    // TODO: time both variants on identical sequences
}
```

```java
public static void benchmarkMeld(int n, long seed) {
    // TODO: same workload, both variants
}
```

```python
def benchmark_meld(n, seed):
    # TODO: time both variants, report median over 5 runs
    pass
```

**Evaluation.** Recursive variant either matches iterative within ~10 % on n =
10^6, or fails outright at n = 10^7 (document which); iterative variant scales;
report includes peak memory and depth.

---

## Benchmark Task

**Problem.** Cross-language, cross-implementation benchmark — compare four
priority-queue implementations across three languages on a fixed workload:
N insertions of random keys followed by N extract-mins.

**Implementations.**

```text
1. Leftist heap (your implementation, recursive meld)
2. Skew heap (no NPL, swap children unconditionally)
3. Binomial heap (forest of binomial trees)
4. Pairing heap (multi-way, two-pass meld on extract)
```

**Languages.** Go, Java, Python — same algorithms, same sequences.

**Sizes.** N in {10^4, 10^5, 10^6}.

**Output table.**

```text
size  | impl       | go ms | java ms | python ms | java/go | python/go
1e4   | leftist    |       |         |           |         |
1e4   | skew       |       |         |           |         |
1e4   | binomial   |       |         |           |         |
1e4   | pairing    |       |         |           |         |
1e5   | leftist    |       |         |           |         |
... (same rows for 1e5 and 1e6)
```

**Protocol.**

```text
- Same seed across languages; same key sequence.
- Median of 5 runs per cell.
- Warm-up: 1 untimed run.
- Java: -Xms = -Xmx = 4G, -XX:+UseSerialGC.
- Go: GOGC=off, runtime.GC() before timing.
- Python: gc.disable() during timing; CPython 3.12 reference.
- Single-threaded; pin process to one core where possible.
```

**Constraints.** Must report per-op latency (ns) as well as totals; must report
peak RSS; must reject any run whose deviation from the median exceeds 20 %.

**Evaluation.**

```text
- Correctness: extracted sequences identical across all 12 cells.
- Stability: stdev < 20 % of median per cell.
- Insight: written paragraph explaining the *order* between implementations
  (typically pairing < leftist ~ skew < binomial for these sizes, with caveats).
- Cross-language ratios: java/go and python/go columns populated and discussed.
```

**Hint.** Plot log-log — slope ~1 confirms O(N log N) for all four; intercept
differences reveal constant factors. Pairing heap is often fastest in practice
despite its weaker theoretical bounds.

---

## Submission checklist

```text
[ ] All 15 tasks implemented in Go, Java, Python
[ ] Tests for each task pass on random workloads of size 10^4
[ ] Task 15 benchmark report committed
[ ] Final benchmark table populated with real numbers
[ ] Short write-up (~300 words) interpreting the benchmark
[ ] No mutation in Task 11 (verified by a sharing test)
[ ] Parent pointers consistent in Task 14 (verified by a walk)
[ ] No emojis, English only, fenced code blocks language-tagged
```
