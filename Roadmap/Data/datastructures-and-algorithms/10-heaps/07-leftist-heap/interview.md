# Leftist Heap — Interview Preparation

A leftist heap is a mergeable priority queue built from a binary tree that
satisfies the heap-order property and an additional **leftist property** on
the *null path length* (NPL). The skewed structure guarantees `O(log n)`
**meld**, and every other operation is expressed in terms of meld. Interviews
on leftist heaps are common in advanced algorithms courses, functional data
structures (Okasaki) interviews, and at companies that test mergeable heap
variants (skew heap, pairing heap, binomial heap, Fibonacci heap).

---

## Quick-Reference Cheat Sheet

```text
Property              Value
--------------------  ----------------------------------------
Shape                 Binary tree, biased left (no balance)
Heap order            parent.key <= child.key  (min-heap)
NPL (s)               distance to nearest null descendant
                      s(null) = -1, s(x) = 1 + min(s(L), s(R))
Leftist invariant     s(left)  >=  s(right)  for every node
Right spine length    <= floor(log2(n + 1))

Operation             Time         Notes
--------------------  -----------  ------------------------------
meld(h1, h2)          O(log n)     core primitive, recursive
insert(x)             O(log n)     meld with single-node heap
find-min              O(1)         root
extract-min           O(log n)     meld of root's two children
decrease-key (id)     O(log n)     not native; needs parent ptrs
delete arbitrary      O(log n)     same; cut + meld
build from n keys     O(n)         pairwise meld + queue trick
space                 O(n) ptrs    left, right, key, npl per node
mergeable             YES          unlike binary heap
persistent variant    YES          immutable copy of right spine
```

```text
Mental model:
  - All "real work" happens on the RIGHT spine.
  - The leftist property keeps that spine short: O(log n).
  - meld walks down both right spines, then swaps children
    bottom-up so the LARGER NPL stays on the left.
```

---

## Junior Questions (10 Q&A)

### J1. What is a leftist heap?
A leftist heap is a binary-tree-based min-heap (or max-heap) that supports
**meld in `O(log n)`**. It keeps the heap-order property — every parent is
`<=` its children — *plus* an extra structural rule: the **null path length
(NPL)** of the left child is at least that of the right child at every node.
That bias forces the right spine of the tree to be short, which is exactly
where meld does its work. It is one of the simplest mergeable priority
queues and a common stepping stone before skew heaps and pairing heaps.

### J2. Define null path length (NPL).
NPL, written `s(x)`, is the length of the shortest path from node `x` down
to a `null` descendant. By convention `s(null) = -1`, a leaf has `s = 0`,
and internally `s(x) = 1 + min(s(left), s(right))`. NPL counts edges, not
nodes. It is **not** the same as height or as subtree size — a tall left
subtree can still have NPL `0` if its right child is null.

### J3. State the leftist property.
For every node `x`, `s(left(x)) >= s(right(x))`. In plain words: the left
subtree must be **at least as "deep to its nearest null" as the right
subtree**. This pushes shallowness to the right, so the right spine — the
path that always goes right from the root — becomes the shortest path to a
null, with length at most `floor(log2(n+1))`.

### J4. Why is a leftist heap not a balanced tree?
Balance is about subtree *sizes* or *heights*. A leftist heap can be
extremely skewed; the left subtree of the root may have all `n-1` nodes
while the right subtree has none. What is bounded is the **right spine**,
not the overall shape. So a leftist heap is "balanced only along the right
edge," which is enough because meld only walks that edge.

### J5. How is insert implemented?
Insert wraps the new key in a single-node heap with `s = 0` and calls
`meld(existing, new)`. There is no special-case insertion code — every
mutation goes through meld. Cost is `O(log n)` because meld traverses two
right spines that are each `O(log n)` long.

### J6. How is extract-min implemented?
Take the root's key as the result, then **meld its left and right children
together** and make the result the new root. Again, no separate sift-down
logic is needed; meld alone preserves the invariants. Cost: `O(log n)`.

### J7. Is leftist heap the same as a binary heap?
No. A binary heap is an array-based **complete** tree with implicit
parent/child indices. A leftist heap is a pointer-based, intentionally
*unbalanced* tree. Binary heaps cannot meld in `O(log n)` (they need
`O(n)`); leftist heaps can. Binary heaps win on cache locality and constant
factors; leftist heaps win when you need merging.

### J8. Min-heap or max-heap?
Either. The only thing that changes is the comparison used in meld
(`a.key < b.key` vs `a.key > b.key`). The leftist structural property is
about NPL, not about ordering direction. By default, textbooks use min.

### J9. What does NPL `s(x) = 0` mean?
It means node `x` is on the boundary — either it is a leaf, or one of its
children is `null`. The fact that *every* leftist heap has at least one node
with `s = 0` (the rightmost on the right spine) is what makes the right
spine the "exit lane" for meld.

### J10. How does meld look at the top level?
Compare the roots. Whichever is smaller becomes the new root; keep its left
child untouched and **recursively meld its right child with the other
heap**. After the recursive call returns, check the new node's children's
NPLs — if `right` now has a bigger `s` than `left`, swap them. Update the
parent's `s` to `1 + min(s(left), s(right))`.

---

## Middle Questions (12 Q&A)

### M1. Why does the leftist property guarantee `O(log n)` right spine?
**Claim:** if `s(root) = r`, the tree contains at least `2^(r+1) - 1` nodes.
**Proof sketch:** induction. By the leftist property, both subtrees have
`s >= r - 1`, so each contains at least `2^r - 1` nodes; plus the root
yields `2^(r+1) - 1`. Therefore `r <= log2(n+1) - 1`, and the right spine
has length `r + 1 <= log2(n+1)`. QED.

### M2. Why is `NPL` used instead of subtree size or height?
Subtree size would force rebalancing on every insert (like an AVL/RB tree)
and complicate meld. Height is also a valid biasing metric and gives a
similar bound, but NPL is **easier to maintain locally** during meld: after
recursing on the right child, we only need to look at our immediate
children's `s` values to decide whether to swap. NPL is the smallest piece
of information that lets us prove the spine bound while keeping meld pure.

### M3. Walk through meld(h1, h2) step by step.
1. If `h1 == null`, return `h2`; symmetric.
2. Let `small = min(h1.root, h2.root)`, `large = the other`.
3. Recursively `small.right = meld(small.right, large)`.
4. If `s(small.left) < s(small.right)`, swap `small.left` and `small.right`.
5. Update `s(small) = 1 + min(s(small.left), s(small.right))`.
6. Return `small`.

### M4. What is the recurrence and why is meld `O(log n)`?
Let `n1, n2` be sizes and `r1, r2` be right spine lengths. Each recursive
call shortens *one* of those spines by one. Total work is therefore
`O(r1 + r2) = O(log n1 + log n2) = O(log n)`.

### M5. How do you build a leftist heap from `n` items in `O(n)`?
Put each item in a queue as a single-node heap. Repeatedly dequeue two,
meld, and enqueue the result. After `n - 1` melds we have one heap. The
analysis mirrors `O(n)` Floyd-style heap construction: half the melds are
size-1 with size-1 (`O(1)` each), the next quarter are size-2 with size-2,
etc. The geometric sum is `O(n)`.

### M6. Can you implement decrease-key?
Yes, but only if every node has a **parent pointer**. To decrease key of
node `x`: lower the key; if the heap-order with parent is violated, **cut**
`x` from its parent (the parent's child becomes `x`'s sibling), recompute
NPLs on the path up (possibly swapping children), and `meld(root, x)`.
Cost: `O(log n)`. Without parent pointers it is impossible in sublinear time.

### M7. How is delete(node) different from extract-min?
Delete-min just melds the root's two children. Deleting an arbitrary node
`x` requires (a) cutting `x` from its parent, (b) melding `x.left` with
`x.right` to form `x'`, (c) reattaching `x'` where `x` was, and (d) fixing
NPLs and possibly swapping all the way up to the root. With parent
pointers this is `O(log n)`.

### M8. Compare leftist heap vs skew heap.
A skew heap has the same meld algorithm **without** tracking NPL — it
**always** swaps children after the recursive meld. There is no leftist
invariant, no extra field, and worst case per meld is `O(n)`, but
**amortized** is `O(log n)`. Leftist heaps give worst-case `O(log n)` at
the cost of one extra integer per node. Skew is simpler; leftist is more
predictable.

### M9. Compare leftist heap vs binomial heap.
Both meld in `O(log n)`. Binomial heaps support `O(1)` amortized insert
(via lazy meld of trees of distinct order); leftist heaps are `O(log n)`
worst-case insert. Binomial heaps have richer structure (forest of B_k
trees); leftist heaps are a single binary tree, easier to teach and code.
Fibonacci heaps further improve insert and decrease-key but are far more
complex.

### M10. Is leftist heap stable?
No. Like most heaps, equal keys may be reordered. If stability matters,
augment the key with an insertion counter.

### M11. Why is leftist heap a great fit for persistent / functional code?
Meld only mutates nodes on the *right spine* of each input. In a
persistent variant you copy that spine (`O(log n)` nodes) and share the
left subtrees. So persistent meld is `O(log n)` time **and** `O(log n)`
extra space. Okasaki uses this as an introductory example in *Purely
Functional Data Structures*.

### M12. What invariants must `meld` preserve?
Three: (1) heap-order at every node; (2) leftist property `s(left) >=
s(right)`; (3) `s(x) = 1 + min(s(left), s(right))`. Step 3 of meld
(the swap) restores invariant (2); step 5 (recomputing `s`) restores (3).
Invariant (1) is preserved because the smaller root always becomes the
parent.

---

## Senior Questions (8 Q&A)

### S1. Prove the right spine of an `n`-node leftist heap has length `<= floor(log2(n+1))`.
Let `r = s(root)`. We show by induction on `r` that the subtree size
`size >= 2^(r+1) - 1`. Base: `r = 0` gives `size >= 1 = 2^1 - 1`. Step:
both children have `s >= r - 1`, so each subtree has size `>= 2^r - 1`,
plus the root gives `>= 2^(r+1) - 1`. The right spine length is `r + 1`
(it visits the root, then drops `s` by exactly 1 each step). So
`spine = r + 1 <= log2(n + 1)`.

### S2. Prove meld terminates and returns a valid leftist heap.
Termination: each recursive call replaces `small.right` with
`meld(small.right, large)`. The total work counter `r1 + r2` strictly
decreases. Validity: invariant (1) holds because we always pick the smaller
root as parent. Invariant (2) holds because the explicit swap step fixes
any violation introduced by the recursive call. Invariant (3) holds by the
recomputation. Therefore induction over `r1 + r2` gives a valid leftist
heap.

### S3. Why is the swap step a *local* fix?
Before the recursion, the subtree was already leftist, so
`s(small.left) >= s(small.right)`. The recursion can only change
`small.right` and therefore `s(small.right)`. So the only possible new
violation is at this exact node. Fixing it does **not** require touching
deeper levels — by induction the subtrees we attach are already leftist.

### S4. Build-heap analysis: prove `O(n)`.
With queue-based pairwise meld, the work for melding two heaps of size
`<= k` is `O(log k)`. At round `i` we have roughly `n / 2^i` heaps of size
`2^i`, paying `O(i)` each, contributing `O((n / 2^i) * i) = O(n * i / 2^i)`.
Summing `i = 1..log n` gives `O(n * sum i / 2^i) = O(n)` since
`sum i / 2^i` converges to 2.

### S5. Why is `O(log n)` worst-case worse than `O(log n)` amortized for some workloads?
A skew heap may temporarily build a degenerate spine, paying `O(n)` for
one meld but `O(log n)` *amortized*. For a real-time system with hard
per-operation deadlines (audio, control loops), the worst case dominates,
so leftist beats skew. For batch workloads where total throughput matters,
skew's simpler code and identical asymptotic cost often win.

### S6. How would you implement decrease-key in `O(log n)` worst-case?
Add `parent` pointers. To decrease key of `x` by `delta`:
1. `x.key -= delta`.
2. If `x` is the root or `x.key >= parent.key`, done.
3. Otherwise cut `x`: set the corresponding child of `parent` to null.
4. Walk up from `parent`, recomputing `s` and possibly swapping children;
   stop when `s` no longer changes.
5. `root = meld(root, x)`.
Total: two `O(log n)` traversals.

### S7. Can leftist heap give `O(1)` find-min and `O(log n)` everything else?
Yes — find-min is the root, which is `O(1)`. The "everything else in
`O(log n)`" is achieved as long as you have parent pointers (for arbitrary
delete and decrease-key). Without them you have `O(1)` find-min,
`O(log n)` insert / extract-min / meld, but only `O(n)` decrease-key.

### S8. Why is leftist heap considered a "purely functional" data structure?
Because meld is the *only* primitive, and it can be implemented without
mutation: it returns a fresh node with new pointers along the right spine,
sharing all left subtrees with the input. Insert and extract-min compose
trivially. The resulting persistent leftist heap supports `O(log n)`
operations with full structural sharing — Okasaki's canonical example.

---

## Professional Questions (6 Q&A)

### P1. When would you choose leftist heap in production over `std::priority_queue` or `java.util.PriorityQueue`?
When you genuinely need **`O(log n)` meld**. Examples: merging two
priority queues during graph contraction, parallel best-first search
gathering results from worker threads, persistent / undo-able event
queues, or simulations that split and merge timelines. Array-based binary
heaps have better cache behavior and lower constant factors for plain
insert / extract-min, so default to them unless meld is on the hot path.

### P2. How would you make a leftist heap thread-safe?
Coarse: a single mutex around the whole heap — fine for low contention.
Better for read-heavy: a `RWMutex` since find-min is read-only. For real
concurrency you usually move to a *persistent* leftist heap with a CAS on
the root pointer — readers see immutable snapshots, writers retry on
conflict. Lock-free mutable leftist heaps exist in the literature but are
rarely worth the complexity; pairing or skew heaps are easier to make
concurrent in practice.

### P3. How do you test a leftist heap implementation?
Mix three layers: (a) unit tests for invariants (heap-order, leftist NPL,
correct `s` values) after every operation; (b) **property-based tests**
that drive random sequences of insert / meld / extract-min and assert the
extracted sequence is non-decreasing and the multiset matches; (c)
differential tests against `std::priority_queue` / Python `heapq` for
identical inputs. Add a fuzz harness for meld with two random heaps and
check size, min, and invariants.

### P4. What is the typical pitfall when implementing meld iteratively?
Most engineers do meld recursively because it is short and beautiful. An
iterative version merges the right spines into one ordered list, then
walks **back up** swapping children where the leftist property is
violated. The classic bug: forgetting to update `s` during the upward pass,
which silently breaks the right-spine bound and eventually degrades meld
to `O(n)`. Always recompute `s` exactly when you re-link children.

### P5. How does leftist heap interact with garbage collection in managed languages?
Each meld creates churn: along the right spine, nodes are either swapped
or have their `right` pointer rewritten. In a generational GC this is
short-lived garbage if you do persistent meld (path copying) and may
trigger frequent young-gen collections. Mitigations: object pooling for
nodes if profiling shows allocation pressure; use primitive `int` keys
with packed structs in Go / Rust; in Java, prefer flat arrays for the
underlying binary heap unless meld is required.

### P6. How would you adapt leftist heap to support `k` simultaneous priority queues that occasionally merge?
Keep each PQ as its own leftist heap root. Merging two of them is one
`meld`, `O(log n)`. This is much better than the binary-heap approach,
which requires rebuilding (`O(n + m)`). This pattern shows up in
**Kruskal-with-edge-priorities**, **union-find with extra ranking
priority**, and **Dijkstra on a forest of components**. The leftist heap
is essentially "DSU for priority queues."

---

## Behavioral / System-Design Questions (5)

### B1. "Tell me about a time you chose a non-standard data structure."
Frame it: (1) the problem (mergeable priority queue inside a scheduler);
(2) the default (`PriorityQueue`) and why it failed (meld was `O(n)`,
caused tail latency at p99); (3) the alternatives considered (binomial,
pairing, leftist); (4) why you picked leftist (simplest worst-case
`O(log n)` meld, easy code review); (5) the measurable result (p99 dropped
from 80ms to 9ms).

### B2. Design a real-time event scheduler for thousands of timelines that may merge/split.
Use one leftist heap per timeline, each keyed by `(event_time, seq)`.
Split = unlink a subtree (requires parent pointers) and meld remainder.
Merge = `meld(h1, h2)` in `O(log n)`. The global "next event" is the min
across active heap roots, maintained in a second small leftist heap of
roots. This composition gives `O(log T + log n)` per operation, where
`T` is the number of timelines.

### B3. Design a system that merges two top-K leaderboards in real time.
Each shard maintains a max-leftist-heap of size `K`. To produce the
global top-K, meld the shard heaps pairwise — `O(K log K)` total because
each shard heap has size `K` and meld is `O(log K)`. Compare with the
binary-heap variant, which would need `O(K * shards)` rebuild. Mention
correctness under late updates: timestamp keys + idempotent extract.

### B4. Walk through a debugging story for a heap that "lost" elements.
Common cause: meld mutates an input that the caller still references.
Symptom: after `h3 = meld(h1, h2)`, future operations on `h1` see corrupt
NPLs because nodes are now shared. Fix: either document destructive
semantics clearly, or switch to a persistent leftist heap. Mention how
property-based tests with shadow models would have caught it.

### B5. How do you teach leftist heap to a junior engineer in 15 minutes?
Three drawings: (1) NPL labels on a small tree showing the rightmost-null
shortest path; (2) the leftist invariant `s(left) >= s(right)` violated
and then fixed by swap; (3) meld walking down two right spines and fixing
NPLs on the way back up. End with "insert and extract-min are just meld in
disguise." Skip proofs; promise them on a follow-up.

---

## Coding Challenges

### Challenge 1: Implement leftist heap + meld + extract-min from scratch

Write a min leftist heap supporting `Insert`, `FindMin`, `ExtractMin`, and
`Meld`. Assert leftist + heap invariants in tests.

#### Go

```go
package leftist

type Node struct {
	Key         int
	Npl         int
	Left, Right *Node
}

type Heap struct{ Root *Node }

func New() *Heap { return &Heap{} }

func (h *Heap) Empty() bool { return h.Root == nil }

func (h *Heap) FindMin() (int, bool) {
	if h.Root == nil {
		return 0, false
	}
	return h.Root.Key, true
}

func (h *Heap) Insert(k int) {
	h.Root = meld(h.Root, &Node{Key: k, Npl: 0})
}

func (h *Heap) ExtractMin() (int, bool) {
	if h.Root == nil {
		return 0, false
	}
	k := h.Root.Key
	h.Root = meld(h.Root.Left, h.Root.Right)
	return k, true
}

func (h *Heap) Meld(other *Heap) {
	h.Root = meld(h.Root, other.Root)
	other.Root = nil
}

func npl(n *Node) int {
	if n == nil {
		return -1
	}
	return n.Npl
}

func meld(a, b *Node) *Node {
	if a == nil {
		return b
	}
	if b == nil {
		return a
	}
	if a.Key > b.Key {
		a, b = b, a
	}
	a.Right = meld(a.Right, b)
	if npl(a.Left) < npl(a.Right) {
		a.Left, a.Right = a.Right, a.Left
	}
	a.Npl = 1 + min(npl(a.Left), npl(a.Right))
	return a
}

func min(x, y int) int {
	if x < y {
		return x
	}
	return y
}
```

#### Java

```java
public class LeftistHeap {
    static class Node {
        int key, npl;
        Node left, right;
        Node(int k) { key = k; npl = 0; }
    }

    private Node root;

    public boolean isEmpty()  { return root == null; }
    public int     findMin()  { return root.key; }

    public void insert(int k) {
        root = meld(root, new Node(k));
    }

    public int extractMin() {
        int k = root.key;
        root = meld(root.left, root.right);
        return k;
    }

    public void meld(LeftistHeap other) {
        root = meld(root, other.root);
        other.root = null;
    }

    private static int npl(Node n) { return n == null ? -1 : n.npl; }

    private static Node meld(Node a, Node b) {
        if (a == null) return b;
        if (b == null) return a;
        if (a.key > b.key) { Node t = a; a = b; b = t; }
        a.right = meld(a.right, b);
        if (npl(a.left) < npl(a.right)) {
            Node t = a.left; a.left = a.right; a.right = t;
        }
        a.npl = 1 + Math.min(npl(a.left), npl(a.right));
        return a;
    }
}
```

#### Python

```python
class Node:
    __slots__ = ("key", "npl", "left", "right")
    def __init__(self, key):
        self.key, self.npl = key, 0
        self.left = self.right = None

def npl(n):
    return -1 if n is None else n.npl

def meld(a, b):
    if a is None: return b
    if b is None: return a
    if a.key > b.key:
        a, b = b, a
    a.right = meld(a.right, b)
    if npl(a.left) < npl(a.right):
        a.left, a.right = a.right, a.left
    a.npl = 1 + min(npl(a.left), npl(a.right))
    return a

class LeftistHeap:
    def __init__(self):
        self.root = None
    def empty(self): return self.root is None
    def find_min(self): return self.root.key
    def insert(self, k):
        self.root = meld(self.root, Node(k))
    def extract_min(self):
        k = self.root.key
        self.root = meld(self.root.left, self.root.right)
        return k
    def meld_with(self, other):
        self.root = meld(self.root, other.root)
        other.root = None
```

---

### Challenge 2: K-way merge of K=10 sorted streams using a leftist heap

Given 10 already-sorted integer streams, produce one fully sorted output
stream. Use a leftist heap keyed by `(value, stream_index)` so we always
know which stream to advance.

#### Go

```go
package main

import "fmt"

type Item struct {
	Val, Stream, Pos int
}

type Node struct {
	It          Item
	Npl         int
	Left, Right *Node
}

func npl(n *Node) int {
	if n == nil {
		return -1
	}
	return n.Npl
}

func meld(a, b *Node) *Node {
	if a == nil {
		return b
	}
	if b == nil {
		return a
	}
	if a.It.Val > b.It.Val {
		a, b = b, a
	}
	a.Right = meld(a.Right, b)
	if npl(a.Left) < npl(a.Right) {
		a.Left, a.Right = a.Right, a.Left
	}
	a.Npl = 1 + min(npl(a.Left), npl(a.Right))
	return a
}

func min(x, y int) int {
	if x < y {
		return x
	}
	return y
}

func KMerge(streams [][]int) []int {
	var root *Node
	for i, s := range streams {
		if len(s) > 0 {
			root = meld(root, &Node{It: Item{Val: s[0], Stream: i, Pos: 0}})
		}
	}
	out := make([]int, 0)
	for root != nil {
		it := root.It
		out = append(out, it.Val)
		root = meld(root.Left, root.Right)
		next := it.Pos + 1
		if next < len(streams[it.Stream]) {
			root = meld(root, &Node{It: Item{Val: streams[it.Stream][next], Stream: it.Stream, Pos: next}})
		}
	}
	return out
}

func main() {
	streams := [][]int{
		{1, 11, 21}, {2, 12}, {3, 13, 23, 33}, {4}, {5, 15, 25},
		{6, 16}, {7, 17, 27}, {8}, {9, 19}, {10, 20, 30},
	}
	fmt.Println(KMerge(streams))
}
```

#### Java

```java
import java.util.*;

public class KMerge {
    static class Item {
        int val, stream, pos;
        Item(int v, int s, int p) { val = v; stream = s; pos = p; }
    }
    static class Node {
        Item it; int npl; Node left, right;
        Node(Item i) { it = i; }
    }

    static int npl(Node n) { return n == null ? -1 : n.npl; }

    static Node meld(Node a, Node b) {
        if (a == null) return b;
        if (b == null) return a;
        if (a.it.val > b.it.val) { Node t = a; a = b; b = t; }
        a.right = meld(a.right, b);
        if (npl(a.left) < npl(a.right)) {
            Node t = a.left; a.left = a.right; a.right = t;
        }
        a.npl = 1 + Math.min(npl(a.left), npl(a.right));
        return a;
    }

    public static List<Integer> merge(int[][] streams) {
        Node root = null;
        for (int i = 0; i < streams.length; i++) {
            if (streams[i].length > 0) {
                root = meld(root, new Node(new Item(streams[i][0], i, 0)));
            }
        }
        List<Integer> out = new ArrayList<>();
        while (root != null) {
            Item it = root.it;
            out.add(it.val);
            root = meld(root.left, root.right);
            int next = it.pos + 1;
            if (next < streams[it.stream].length) {
                root = meld(root, new Node(new Item(streams[it.stream][next], it.stream, next)));
            }
        }
        return out;
    }

    public static void main(String[] args) {
        int[][] s = {
            {1,11,21},{2,12},{3,13,23,33},{4},{5,15,25},
            {6,16},{7,17,27},{8},{9,19},{10,20,30}
        };
        System.out.println(merge(s));
    }
}
```

#### Python

```python
class Item:
    __slots__ = ("val", "stream", "pos")
    def __init__(self, v, s, p):
        self.val, self.stream, self.pos = v, s, p

class Node:
    __slots__ = ("it", "npl", "left", "right")
    def __init__(self, it):
        self.it = it
        self.npl = 0
        self.left = self.right = None

def npl(n): return -1 if n is None else n.npl

def meld(a, b):
    if a is None: return b
    if b is None: return a
    if a.it.val > b.it.val:
        a, b = b, a
    a.right = meld(a.right, b)
    if npl(a.left) < npl(a.right):
        a.left, a.right = a.right, a.left
    a.npl = 1 + min(npl(a.left), npl(a.right))
    return a

def k_merge(streams):
    root = None
    for i, s in enumerate(streams):
        if s:
            root = meld(root, Node(Item(s[0], i, 0)))
    out = []
    while root is not None:
        it = root.it
        out.append(it.val)
        root = meld(root.left, root.right)
        nxt = it.pos + 1
        if nxt < len(streams[it.stream]):
            root = meld(root, Node(Item(streams[it.stream][nxt], it.stream, nxt)))
    return out

if __name__ == "__main__":
    streams = [
        [1,11,21],[2,12],[3,13,23,33],[4],[5,15,25],
        [6,16],[7,17,27],[8],[9,19],[10,20,30],
    ]
    print(k_merge(streams))
}
```

Expected output (all three): `[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
15, 16, 17, 19, 20, 21, 23, 25, 27, 30, 33]`.

Total work: `N log K` where `N` is total elements and `K = 10`. Each
element triggers one extract-min (`O(log K)`) and one insert (`O(log K)`).

---

## Common Pitfalls in Interviews

1. **Confusing NPL with height or size.** NPL is the *shortest* path to a
   null; height is the *longest* path to a leaf. They differ on every
   nontrivial tree. Saying "the leftist property keeps the tree balanced"
   is wrong — it keeps the right spine short.
2. **Forgetting to update `s` after the swap.** A surprisingly common bug.
   Always recompute `s(node) = 1 + min(s(left), s(right))` after relinking.
3. **Claiming meld is `O(1)`.** It is `O(log n)`. The thing that is
   `O(1)` is the *amount of work per recursion level*, but there are
   `O(log n)` levels.
4. **Treating leftist heap like a binary heap stored in an array.** Then
   you cannot meld in `O(log n)`. The pointer structure is essential.
5. **Mutating shared subtrees.** If two callers share `h1` and one calls
   `meld(h1, h2)`, the other caller's view is corrupted. Either document
   destructive semantics or implement persistent meld.
6. **Implementing meld with a sort.** Sorting the union is `O(n log n)`,
   destroying the whole point. Trust the recursion.
7. **Swapping unconditionally.** That is a skew heap, not a leftist heap.
   Leftist swaps *only* when `s(left) < s(right)`.
8. **Saying decrease-key is `O(log n)` without parent pointers.** Without
   parents you cannot find a node in less than `O(n)`. State the
   prerequisite explicitly.
9. **Mixing min and max conventions mid-proof.** Pick one, stick with it.
10. **Forgetting that find-min is `O(1)`.** Some candidates "implement" it
    by walking left children, confusing leftist heap with a BST.

---

## What Interviewers Are Really Testing

- **Understanding of structural invariants.** Can you state the leftist
  property precisely, and can you prove the right-spine bound?
- **Comfort with recursion on linked structures.** Meld is the cleanest
  example of structural recursion in heap-land; sloppy recursion shows
  up immediately as a wrong NPL or a corrupted tree.
- **Asymptotic intuition.** Why `O(log n)` worst case? Why is build
  `O(n)` not `O(n log n)`? Why does the binary heap not match?
- **Trade-off thinking.** When would you actually pick this over a binary
  heap, a binomial heap, a pairing heap, or a Fibonacci heap?
- **Functional programming sensibilities.** Recognizing that meld is the
  only primitive and that the data structure is naturally persistent
  signals familiarity with Okasaki-style thinking.
- **Engineering judgment.** Will you write parent pointers (and pay the
  memory cost) just to support decrease-key? Will you accept skew heap's
  amortized bound to save a field per node? Are you comfortable arguing
  both sides?
- **Debugging discipline.** Bugs in leftist heap rarely throw exceptions;
  they silently degrade performance. Good candidates volunteer invariant
  checks and property-based tests without being prompted.

Master meld and the rest of leftist heap — insert, extract-min, build,
delete, decrease-key, persistence — falls out almost for free. That is
why interviewers love it: one elegant primitive, many derived operations,
a clean proof, and a concrete trade-off story versus more famous heaps.
