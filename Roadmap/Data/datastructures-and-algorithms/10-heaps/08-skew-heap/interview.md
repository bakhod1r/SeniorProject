# Skew Heap — Interview Preparation

A focused interview prep document for skew heaps: self-adjusting mergeable
heaps with amortised O(log n) operations and no balance metadata. The questions
below escalate from definitions to amortised analysis, comparisons with
leftist/pairing/binomial heaps, and design problems where meldability matters.

---

## Quick-Reference Cheat Sheet

```text
Skew heap = self-adjusting binary heap, no rank/null-path-length stored.

Core operation: meld(h1, h2)
  if h1 == nil: return h2
  if h2 == nil: return h1
  if h1.key > h2.key: swap(h1, h2)
  h1.right = meld(h1.right, h2)
  swap(h1.left, h1.right)   // <-- the "skew" step (unconditional)
  return h1

Operations (all reduce to meld):
  insert(x)      = meld(h, singleton(x))
  extractMin()   = root.key; h = meld(h.left, h.right)
  decreaseKey    = not natively supported (no parent pointers)

Complexity (amortised):
  meld / insert / extractMin = O(log n)
  Worst case single op        = O(n)        (tolerated, amortised pays)

vs Leftist heap:
  Leftist  = stores npl, only swaps when invariant violated -> worst-case log n
  Skew     = stores nothing, swaps unconditionally          -> amortised  log n

Potential function (Sleator-Tarjan):
  Phi = number of "heavy right" nodes on right spines
  Amortised cost of meld <= log_phi(n) + O(1), phi = golden ratio

When to use:
  - Need meldable priority queue, code simplicity matters
  - Amortised bound acceptable (not hard real-time)
  - Don't need decrease-key (use Fibonacci/pairing instead)
```

---

## Junior Questions (10 Q&A)

### J1. What is a skew heap?
A skew heap is a self-adjusting binary tree that satisfies the min-heap (or
max-heap) order property: every parent key is less than or equal to its
children. Unlike a leftist heap, it stores no balance information at all —
no rank, no null path length, no size. All operations are expressed as calls
to a single primitive, `meld`, which merges two skew heaps into one. The data
structure is interesting because it achieves O(log n) amortised performance
purely by structural "self-adjustment" — swapping children on every recursive
merge step.

### J2. What is the heap-order property?
Heap order means that for every node `x` with children `l` and `r`, the key at
`x` is no greater than the keys at `l` and `r` (for a min-heap). This property
is local — it does not say anything about the relative order of `l` and `r`.
As a consequence, the minimum of the entire heap is always at the root, which
is what makes `findMin` an O(1) operation. Skew heaps preserve this property
during `meld` by always making the smaller-rooted heap the new root.

### J3. How do you insert into a skew heap?
You create a single-node heap containing the new key and meld it with the
existing heap: `h = meld(h, newNode(x))`. There is no special-case logic for
insertion — it reuses the meld primitive. This is why skew-heap code is so
short: insert, extract-min, and union all collapse to a single function. The
amortised cost is O(log n).

### J4. How do you extract the minimum?
The minimum sits at the root, so you read it directly. Then you discard the
root and meld its two children into a single new heap: `h = meld(h.left,
h.right)`. The amortised cost is again O(log n) because the meld walks two
right spines whose combined length is amortised logarithmic. No reheapify-down
loop is needed — the structure repairs itself through meld's child swaps.

### J5. What is the "skew" step?
The skew step is the unconditional swap of the left and right children of
every node visited during a meld. After the recursive call to
`meld(h1.right, h2)` returns, you swap `h1.left` and `h1.right`. This swap is
the entire mechanism by which skew heaps stay balanced on average. It is
performed regardless of any condition — there is no rank to check, unlike a
leftist heap.

### J6. How do skew heaps differ from binary heaps?
A binary heap is an array-backed complete binary tree with rigid structure;
a skew heap is a pointer-based binary tree with no shape constraint at all.
Binary heaps give worst-case O(log n) for insert and extract but cannot meld
two heaps in better than O(n). Skew heaps give amortised O(log n) for all
three operations including meld. Binary heaps win on cache locality and
constant factors; skew heaps win on meldability and code simplicity.

### J7. Can a skew heap become very unbalanced?
Yes. A single meld operation can leave a path of length up to n, and a single
operation may cost O(n) in the worst case. The amortised analysis tolerates
this: the expensive operation "pays" for future cheap ones by reducing the
potential of the structure. Over any sequence of m operations on a heap that
grows to size n, total work is O(m log n).

### J8. What does it mean that skew heaps are "self-adjusting"?
Self-adjusting means the structure rearranges itself on every operation
without consulting any stored balance information. Splay trees are the
canonical example for BSTs; skew heaps are the meldable-heap analogue. The
amortised guarantee comes from the fact that any expensive operation must
have been "paid for" by potential built up by prior cheap operations,
analysed via a potential function.

### J9. Does a skew heap support decrease-key?
Not natively, because nodes do not store parent pointers and there is no easy
way to bubble a decreased value up. You can simulate it by inserting a new
node and lazily ignoring the old one, or by deleting and re-inserting if you
have an external handle. If decrease-key is a frequent operation, pick a
pairing heap or a Fibonacci heap instead.

### J10. Where are skew heaps useful in practice?
They shine when you need a meldable priority queue but do not want the code
complexity of leftist or binomial heaps, and you are willing to accept
amortised rather than worst-case bounds. Concrete uses: k-way merge of
streams, event simulation where you occasionally merge subsystem queues,
graph algorithms that combine priority queues from subproblems, and
recursive divide-and-conquer where two child heaps must be combined.

---

## Middle Questions (10 Q&A)

### M1. Walk through the meld algorithm in detail.
Given two heaps `h1` and `h2`: if either is null, return the other. Otherwise
ensure `h1.key <= h2.key` (swap them if not). The new root is `h1`. Recurse:
`h1.right = meld(h1.right, h2)`. Then unconditionally swap `h1.left` and
`h1.right`. Return `h1`. The recursion walks the right spines of both inputs;
the post-recursion swap rotates the merged spine into the left subtree, so
the next meld will walk a different path. This rotation is what bounds
amortised work to O(log n).

### M2. Why is the analysis amortised rather than worst-case?
Because a single meld can walk a long right spine — up to O(n) in pathological
cases — there is no worst-case logarithmic bound. The amortised view counts
work across a sequence: each expensive op reduces a potential function so
much that subsequent ops become cheap. Sleator and Tarjan proved that any
sequence of m operations starting from an empty heap costs O(m log n) total.
For applications that need a per-operation worst-case bound (real-time
systems, adversarial scheduling), a different heap is required.

### M3. What is the potential function used in the analysis?
Define a node as "heavy" if its right subtree has more nodes than its left
subtree, and "light" otherwise. The potential `Phi(h)` is the number of heavy
nodes on the right spine of `h`. When meld walks the right spines and swaps
children, every heavy node visited becomes light (because the larger subtree
moves to the left), which decreases Phi. The amortised cost is the real cost
minus the drop in Phi, and it works out to O(log n) per operation.

### M4. What is a "heavy" child?
For a node `x` with left subtree size `L` and right subtree size `R`, the
right child is heavy if `R > L`, and light otherwise. Heavy right children
are what make a right spine "expensive" to walk — they indicate the spine
has many descendants. The skew step is engineered to flip heavy right
children into the left subtree, so they are not encountered on the next
meld's right-spine walk.

### M5. Compare skew heap with leftist heap.
Both are pointer-based binary heaps where every operation reduces to meld,
and both walk right spines during meld. The leftist heap maintains a null
path length (npl) at every node and swaps children only when the right npl
exceeds the left npl, guaranteeing worst-case O(log n). The skew heap stores
no rank and swaps unconditionally, achieving the same bound only amortised
but with simpler code and less per-node memory. If you need worst-case
guarantees, choose leftist; if you want a single recursive function and
amortised bounds, choose skew.

### M6. Why does swapping children unconditionally still work?
The intuition is that swapping moves the "heavy" subtree to the left, where
it will not be traversed by the next meld. Even though an individual operation
might swap a light child into the right position, the potential function
accounts for this: any swap that increases potential is paid for by other
parts of the analysis. Across a long sequence, the total number of heavy
right children on any right spine remains bounded by O(log n) amortised.

### M7. How does extract-min work and why is it cheap?
Extract-min removes the root and melds the two orphaned subtrees. The cost
is exactly the cost of one meld, so it inherits the amortised O(log n) bound.
Note the contrast with binary heaps: there is no sift-down loop, no
percolate, no comparing with both children at each level. Instead, the meld
naturally restores order because both subtrees were already heaps.

### M8. Can you write the iterative version of meld?
Yes. Collect the right spines of both heaps into a list sorted by key. Walk
the list from the highest key to the lowest, attaching each node's existing
left child as the new right child (which is then swapped to be the new left
child) and chaining the smaller-key nodes upward. The iterative version
avoids recursion-stack overhead and is closer to what production code looks
like for large heaps. It still does the same total work as the recursive
form.

### M9. Compare skew heap with binomial heap.
Binomial heaps maintain a forest of binomial trees and use a meld that
mimics binary addition; their meld is worst-case O(log n) and they support
clean structural composition. Skew heaps maintain only the heap-order
property with no forest structure and achieve the same bound amortised with
far less code. Binomial heaps are preferred when you want predictable
per-operation cost and a forest-structured invariant; skew heaps are
preferred when meld must be as simple as possible and amortised cost is OK.

### M10. Compare skew heap with pairing heap.
Both are self-adjusting and conceptually simple, but pairing heaps support
decrease-key efficiently (with experimentally observed O(log n) amortised
cost), while skew heaps do not. Pairing heaps use a multi-way tree and a
two-pass merge; skew heaps use a binary tree and a single recursive meld.
For Dijkstra or Prim with decrease-key, pairing heaps usually win. For pure
insert/extract-min/meld workloads, both are competitive and skew is often
faster in practice due to its simpler inner loop.

---

## Senior Questions (8 Q&A)

### S1. Prove that meld is O(log n) amortised.
Use the potential function `Phi(h)` = number of heavy right children on the
right spine of `h`. Let `r1, r2` be the lengths of the right spines of the
two inputs, and let `l1, l2` be the numbers of light right children on those
spines. The real cost is `O(r1 + r2)`. After meld, every heavy right child
on either spine becomes a light left child (because of the unconditional
swap), so Phi decreases by at least `(r1 - l1) + (r2 - l2)`. Amortised cost
= real + delta(Phi) <= O(l1 + l2). A classical argument shows the number of
light right children on any spine is at most `log_2(n)`. Hence amortised cost
is O(log n).

### S2. Why is the swap unconditional rather than conditional like leftist?
Conditional swaps (only when right npl > left npl) require storing and
maintaining npl at every node, which costs memory and complicates code. The
amortised analysis shows the unconditional swap is sufficient: by always
rotating the merged spine into the left position, the structure converges
toward balance over many operations. Removing the conditional removes a
branch from the hot path, and the simpler code is easier to verify and
optimise. The trade is per-operation worst-case for asymptotic simplicity.

### S3. How would you implement a meldable priority queue across distributed
nodes using skew heaps?
Each node maintains a local skew heap, and merging two queues becomes a
single meld call. Because skew heaps have no structural invariant beyond
heap order, you can serialise a subtree, ship it across the network, and
meld it into the receiver's heap with no special reconciliation step. The
amortised log n cost still holds globally. The tricky part is decrease-key
or delete-by-handle across nodes, which the skew heap does not natively
support — you would need an external index or switch to a different heap.

### S4. What's the impact of skew heap's unbounded right spine on tail
latency in interactive systems?
Because a single op can be O(n), interactive systems that care about p99 or
p999 latency may see occasional stalls when an expensive meld walks a long
spine. If your service has a 10 ms p99 SLA and you have a heap with millions
of elements, you may exceed the SLA on the rare bad operation even though
average performance is excellent. Mitigations: bound heap size, switch to
leftist or binomial heap for worst-case guarantees, or amortise the work
across multiple ticks of a scheduler.

### S5. Can you build a persistent (immutable) skew heap?
Yes — because meld is a top-down recursive operation that only walks the
right spines, you can implement it functionally by reconstructing the spine
nodes on the path and sharing all left subtrees. Each meld creates O(log n)
amortised new nodes, the rest are shared with the previous version. This
makes skew heaps a good fit for functional programming languages and gives
you a meldable priority queue with structural sharing for free. The
amortised analysis still applies if you analyse against a single chain of
versions (not branching, which can break amortised bounds).

### S6. How does the choice between recursive and iterative meld affect
performance in practice?
The recursive form is shorter and matches the analysis exactly, but it pays
function-call overhead and risks stack overflow on adversarial inputs that
produce long right spines. The iterative form linearises the spines first
and then rebuilds the merged spine in one pass; it has the same big-O but
better constants and no stack risk. For production code on large heaps (say
n > 10^6), prefer iterative; for teaching or small heaps, recursive is
fine.

### S7. Why doesn't skew heap support efficient decrease-key?
Decrease-key needs to find the node holding the changed key (handles are
usually external pointers), then bubble it toward the root. Without parent
pointers, bubble-up needs a different mechanism — typically cutting the
node's subtree out and melding it back into the root. Cutting requires
knowing the parent, which means storing parent pointers, which doubles the
memory per node and complicates meld. Even with parent pointers, the
amortised analysis breaks down because the potential function relies on
spine structure that decrease-key disrupts. Pairing and Fibonacci heaps
were designed specifically to support decrease-key.

### S8. How would you adapt skew heap for max-heap semantics?
Flip the comparison in meld: when `h1.key < h2.key`, swap. Everything else
is identical — the structural mechanics (swap children unconditionally,
walk right spines) is independent of the comparison direction. In a
language with generics or type parameters, you would parameterise the
comparator. In production code, supporting both via a single class with a
comparator function is cleaner than duplicating the implementation.

---

## Professional Questions (6 Q&A)

### P1. Design a production-grade meldable priority queue library where skew
heap is one backend.
Define an abstract interface: `insert`, `findMin`, `extractMin`, `meld`,
`size`, `empty`. Provide multiple backends — binary heap (default, fast
constants), skew heap (meldable, simple), leftist heap (meldable, worst-case
bounds), pairing heap (meldable + decrease-key). Let users pick at
construction time based on which operations they need. Document the
asymptotic bounds and worst-case behaviour of each backend explicitly. Add
benchmarks for typical workloads so users can choose informed defaults.
Skew heap is the default for "I need meld but don't care about worst case."

### P2. What testing strategy would you use for a skew heap implementation?
Property-based tests are the gold standard: generate random sequences of
operations, maintain a parallel reference heap (e.g., array-backed binary
heap), and assert that `extractMin` returns the same sequence from both.
Add invariant checks after every op: every parent <= every child (heap order),
no cycles, every node reachable from root. Stress-test with adversarial
inputs that force long right spines, and confirm amortised throughput
remains O(log n) over m ops. Microbenchmark meld for various input shapes
(balanced, left-heavy, right-heavy) to validate the analysis empirically.

### P3. How would you instrument a skew heap to detect performance
pathologies in production?
Track per-op real time and emit p50/p95/p99/max histograms. Track right
spine length on each meld and emit a histogram; a sudden shift in this
distribution warns of adversarial inputs or a usage pattern that's stressing
the amortised analysis. Track heap size and total melds per second. If max
spine length exceeds log2(n) * some constant for many consecutive ops, page
an operator — this indicates either a bug or a workload where skew heap is
no longer appropriate, and switching to leftist may be wise.

### P4. Walk through a memory layout optimisation for skew heap.
The naive node is `{key, leftPtr, rightPtr}` — three words. You can pool
nodes in an arena to avoid allocator overhead and improve cache locality,
since meld touches nodes along a spine in order. For 32-bit indices in
place of 64-bit pointers, use a slab allocator; this halves per-node memory
and packs more nodes per cache line. If keys are small (e.g., 32-bit ints),
inline them. For purely functional implementations, persistent vectors of
nodes with structural sharing keep memory bounded. The main trade-off is
that arena reuse complicates concurrent access.

### P5. How does skew heap fit (or not) into concurrent / lock-free
designs?
Poorly out of the box — meld mutates pointers along the right spine of
both inputs, which is hard to make lock-free without a complex CAS-based
algorithm. Common production patterns: (a) coarse lock per heap, simple
but limits throughput; (b) shard by key range or by hash, so each thread
mostly hits its own heap, and merge across shards occasionally; (c)
use a different concurrent priority queue altogether (skip lists, relaxed
priority queues). If you need a lock-free meldable PQ, skew heap is
usually not the right choice — pick a structure designed for concurrency.

### P6. When would you choose skew heap over a binary heap in a production
service?
When you need to meld two queues — for example, combining priority queues
from multiple workers, merging in late-arriving events from a recovery
stream, or composing subsolutions in a divide-and-conquer scheduler. Binary
heaps require O(n) to meld, which is unacceptable if meld is on a hot
path. If meld is rare or you can rebuild a heap occasionally, binary heap
is still preferred for its cache-friendliness and worst-case bounds. The
decision turns on meld frequency and your tolerance for amortised vs
worst-case bounds.

---

## Behavioral / System-Design Questions (5)

### B1. Tell me about a time you chose between two algorithms with the same
asymptotic complexity but different amortised vs worst-case profiles.
Strong answer: name the system, the SLA (especially the p99 latency
budget), and how you measured both algorithms under realistic load. Discuss
why amortised bounds are or are not acceptable given the SLA, and how you
validated the choice empirically. Mention how you instrumented production
to detect pathological cases. Skew heap vs leftist heap is a natural concrete
example: you might have chosen leftist for a real-time path and skew for a
batch path.

### B2. Describe a system you designed where mergeability of priority
queues mattered.
Examples: a distributed event simulator where each worker maintains a
local schedule and occasionally merges with a neighbour; a graph
algorithm that processes connected components in parallel and merges
their frontiers; a streaming aggregator that combines per-partition
top-k structures. Discuss why a non-meldable structure (binary heap)
would have forced an O(n) merge and what that would have cost. Tie the
choice to measured improvement, not theory.

### B3. How would you explain skew heap to a junior engineer in five
minutes?
Start with the problem: we have two heaps and we need to combine them
fast. Show why binary heaps are bad at this (have to rebuild from
scratch, O(n)). Introduce skew heap as a binary tree that maintains only
heap order with no shape constraint. Show meld in 10 lines of code. Note
the crucial unconditional swap, and acknowledge that this is the
"magic" — the structure pays itself off over many operations. Mention
the amortised bound and that it works because of a clever potential
argument, without going into the proof.

### B4. Have you ever switched away from a self-adjusting data structure
in production? Why?
This question probes whether you understand the worst-case implications.
Strong answer: discuss a real-time system with strict tail latency
where occasional O(n) operations were unacceptable. Describe how you
detected the problem (latency histograms, complaints from users) and
how you migrated to a worst-case-bounded alternative. Emphasise the
decision was driven by measurement, not theory.

### B5. Design a job scheduler that supports both priority-queue
operations and queue merging.
Discuss the core data structure choice: meldable priority queue (skew
or leftist depending on SLA), bucketed by priority class. Explain how
jobs flow in (insert, O(log n)), how workers pull (extract-min,
O(log n)), and how subsystem queues merge (meld, O(log n)). Add
monitoring: queue length distribution, spine length, age of oldest
job. Discuss failure modes: what happens if meld is on a request path
and a long spine causes a stall, and how you would mitigate (size cap,
fall back to leftist, shard).

---

## Coding Challenges (2)

### Challenge 1: Implement Skew Heap from Scratch
Implement `insert`, `extractMin`, and `meld` for an integer skew heap.
All three should reduce to a single `meld` primitive.

#### Go
```go
package main

import "fmt"

type Node struct {
	key         int
	left, right *Node
}

type SkewHeap struct {
	root *Node
	size int
}

func meld(a, b *Node) *Node {
	if a == nil {
		return b
	}
	if b == nil {
		return a
	}
	if a.key > b.key {
		a, b = b, a
	}
	a.right = meld(a.right, b)
	a.left, a.right = a.right, a.left
	return a
}

func (h *SkewHeap) Insert(x int) {
	h.root = meld(h.root, &Node{key: x})
	h.size++
}

func (h *SkewHeap) ExtractMin() (int, bool) {
	if h.root == nil {
		return 0, false
	}
	min := h.root.key
	h.root = meld(h.root.left, h.root.right)
	h.size--
	return min, true
}

func (h *SkewHeap) Meld(other *SkewHeap) {
	h.root = meld(h.root, other.root)
	h.size += other.size
	other.root = nil
	other.size = 0
}

func main() {
	h := &SkewHeap{}
	for _, x := range []int{5, 1, 9, 3, 7, 2} {
		h.Insert(x)
	}
	for h.size > 0 {
		v, _ := h.ExtractMin()
		fmt.Print(v, " ")
	}
	fmt.Println()
	// Output: 1 2 3 5 7 9
}
```

#### Java
```java
public class SkewHeap {
    static class Node {
        int key;
        Node left, right;
        Node(int k) { key = k; }
    }

    private Node root;
    private int size;

    static Node meld(Node a, Node b) {
        if (a == null) return b;
        if (b == null) return a;
        if (a.key > b.key) { Node t = a; a = b; b = t; }
        a.right = meld(a.right, b);
        Node tmp = a.left; a.left = a.right; a.right = tmp;
        return a;
    }

    public void insert(int x) {
        root = meld(root, new Node(x));
        size++;
    }

    public Integer extractMin() {
        if (root == null) return null;
        int min = root.key;
        root = meld(root.left, root.right);
        size--;
        return min;
    }

    public void meld(SkewHeap other) {
        root = meld(root, other.root);
        size += other.size;
        other.root = null;
        other.size = 0;
    }

    public int size() { return size; }

    public static void main(String[] args) {
        SkewHeap h = new SkewHeap();
        for (int x : new int[]{5, 1, 9, 3, 7, 2}) h.insert(x);
        while (h.size() > 0) System.out.print(h.extractMin() + " ");
        System.out.println();
        // Output: 1 2 3 5 7 9
    }
}
```

#### Python
```python
import sys
sys.setrecursionlimit(10**6)


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
    if a.key > b.key:
        a, b = b, a
    a.right = meld(a.right, b)
    a.left, a.right = a.right, a.left
    return a


class SkewHeap:
    def __init__(self):
        self.root = None
        self.size = 0

    def insert(self, x):
        self.root = meld(self.root, Node(x))
        self.size += 1

    def extract_min(self):
        if self.root is None:
            return None
        m = self.root.key
        self.root = meld(self.root.left, self.root.right)
        self.size -= 1
        return m

    def meld_with(self, other):
        self.root = meld(self.root, other.root)
        self.size += other.size
        other.root = None
        other.size = 0


if __name__ == "__main__":
    h = SkewHeap()
    for x in [5, 1, 9, 3, 7, 2]:
        h.insert(x)
    out = []
    while h.size > 0:
        out.append(h.extract_min())
    print(*out)
    # Output: 1 2 3 5 7 9
```

---

### Challenge 2: K-way Merge Using Skew Heap
Given `k` sorted lists, produce a single sorted output. Use one skew heap
holding the front element of each list, with a pointer back to the list it
came from. Compare to using `k` separate binary heaps merged pairwise: skew
heap lets you meld leftovers of partial merges in O(log n) per meld, useful
when the input arrives in waves.

#### Go
```go
package main

import "fmt"

type Item struct {
	val, listIdx, elemIdx int
}

type KNode struct {
	item        Item
	left, right *KNode
}

func kmeld(a, b *KNode) *KNode {
	if a == nil {
		return b
	}
	if b == nil {
		return a
	}
	if a.item.val > b.item.val {
		a, b = b, a
	}
	a.right = kmeld(a.right, b)
	a.left, a.right = a.right, a.left
	return a
}

func kWayMerge(lists [][]int) []int {
	var root *KNode
	for i, l := range lists {
		if len(l) > 0 {
			root = kmeld(root, &KNode{item: Item{l[0], i, 0}})
		}
	}
	var out []int
	for root != nil {
		it := root.item
		out = append(out, it.val)
		root = kmeld(root.left, root.right)
		if it.elemIdx+1 < len(lists[it.listIdx]) {
			next := &KNode{item: Item{lists[it.listIdx][it.elemIdx+1], it.listIdx, it.elemIdx + 1}}
			root = kmeld(root, next)
		}
	}
	return out
}

func main() {
	lists := [][]int{{1, 4, 9}, {2, 5, 8}, {3, 6, 7}}
	fmt.Println(kWayMerge(lists))
	// Output: [1 2 3 4 5 6 7 8 9]
}
```

#### Java
```java
import java.util.*;

public class KWayMergeSkew {
    static class Node {
        int val, listIdx, elemIdx;
        Node left, right;
        Node(int v, int li, int ei) { val = v; listIdx = li; elemIdx = ei; }
    }

    static Node meld(Node a, Node b) {
        if (a == null) return b;
        if (b == null) return a;
        if (a.val > b.val) { Node t = a; a = b; b = t; }
        a.right = meld(a.right, b);
        Node tmp = a.left; a.left = a.right; a.right = tmp;
        return a;
    }

    public static List<Integer> kWayMerge(List<List<Integer>> lists) {
        Node root = null;
        for (int i = 0; i < lists.size(); i++) {
            if (!lists.get(i).isEmpty()) {
                root = meld(root, new Node(lists.get(i).get(0), i, 0));
            }
        }
        List<Integer> out = new ArrayList<>();
        while (root != null) {
            int v = root.val, li = root.listIdx, ei = root.elemIdx;
            out.add(v);
            root = meld(root.left, root.right);
            if (ei + 1 < lists.get(li).size()) {
                root = meld(root, new Node(lists.get(li).get(ei + 1), li, ei + 1));
            }
        }
        return out;
    }

    public static void main(String[] args) {
        List<List<Integer>> lists = List.of(
            List.of(1, 4, 9), List.of(2, 5, 8), List.of(3, 6, 7));
        System.out.println(kWayMerge(lists));
        // Output: [1, 2, 3, 4, 5, 6, 7, 8, 9]
    }
}
```

#### Python
```python
import sys
sys.setrecursionlimit(10**6)


class KNode:
    __slots__ = ("val", "li", "ei", "left", "right")

    def __init__(self, val, li, ei):
        self.val = val
        self.li = li
        self.ei = ei
        self.left = None
        self.right = None


def meld(a, b):
    if a is None:
        return b
    if b is None:
        return a
    if a.val > b.val:
        a, b = b, a
    a.right = meld(a.right, b)
    a.left, a.right = a.right, a.left
    return a


def k_way_merge(lists):
    root = None
    for i, l in enumerate(lists):
        if l:
            root = meld(root, KNode(l[0], i, 0))
    out = []
    while root is not None:
        v, li, ei = root.val, root.li, root.ei
        out.append(v)
        root = meld(root.left, root.right)
        if ei + 1 < len(lists[li]):
            root = meld(root, KNode(lists[li][ei + 1], li, ei + 1))
    return out


if __name__ == "__main__":
    print(k_way_merge([[1, 4, 9], [2, 5, 8], [3, 6, 7]]))
    # Output: [1, 2, 3, 4, 5, 6, 7, 8, 9]
```

---

## Common Pitfalls in Interviews

- **Claiming worst-case O(log n).** Skew heap's bound is amortised; a
  single operation can degrade to O(n). Interviewers will probe whether
  you know the difference. Be precise.
- **Forgetting the unconditional swap.** Without the swap, you have a
  buggy heap that does not self-adjust. The swap is the entire mechanism;
  candidates who omit or condition it have not actually built a skew heap.
- **Confusing with leftist heap.** Leftist stores npl and swaps
  conditionally; skew stores nothing and swaps unconditionally. Mixing
  them up signals you have not internalised the analysis.
- **Trying to support decrease-key without parent pointers.** It cannot
  be done efficiently in a skew heap. Recognise the limitation and
  recommend pairing or Fibonacci heap instead.
- **Recursing without checking stack depth.** Adversarial inputs can
  produce O(n) right spines; the recursive meld then risks stack
  overflow. Mention iterative implementation for production.
- **Skipping null checks in meld.** The first two lines of meld handle
  null inputs. Forgetting them is a common bug.
- **Sloppy potential-function explanation.** If asked to outline the
  amortised proof, name "heavy right children on the right spine" as
  the potential and explain why the swap converts heavy to light.
- **Underselling cache effects.** Pointer chasing has worse locality
  than a binary heap's array. Acknowledge this in performance
  discussions — skew heap wins on meldability, not raw constants.

---

## What Interviewers Are Really Testing

- **Comfort with amortised analysis.** Can you reason about a sequence
  of operations as a whole rather than one at a time? Do you understand
  potential functions? This is the conceptual core of the question.
- **Comparative judgment across data structures.** Skew vs leftist vs
  binomial vs pairing vs binary — can you pick the right tool given a
  workload (decrease-key frequency, meld frequency, SLA, memory budget)?
- **Code minimalism.** Skew heap meld is famously short. Can you write
  it correctly in 10 lines, including null checks and the unconditional
  swap?
- **Awareness of worst-case behaviour.** Do you know when amortised
  bounds are unacceptable (real-time, hard p99 SLAs) and what to do
  instead?
- **Practical instincts.** Do you instrument production correctly? Do
  you stress-test? Do you understand cache effects and concurrency
  limitations?
- **Recognising structural transferability.** The "swap children
  unconditionally" trick reappears in other self-adjusting structures.
  Strong candidates connect skew heap to splay trees and pairing heaps.
- **Honest engineering trade-offs.** Skew heap is rarely the absolute
  best choice in production but is often "good enough" with minimal
  code. Acknowledging this nuance is a sign of seniority.
