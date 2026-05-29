# Binomial Heap — Interview Preparation

A binomial heap is a forest of binomial trees that supports `O(log n)` insert, find-min, extract-min, decrease-key, delete — and crucially `O(log n)` **meld** (union). This page collects the questions interviewers actually ask, from juniors poking at the structure to staff engineers stress-testing the amortised analysis.

---

## Quick-Reference Cheat Sheet

| Operation       | Worst-case | Amortised |
|-----------------|-----------|-----------|
| `find-min`      | O(log n)  | O(1)*     |
| `insert`        | O(log n)  | O(1)      |
| `meld(H1, H2)`  | O(log n)  | O(log n)  |
| `extract-min`   | O(log n)  | O(log n)  |
| `decrease-key`  | O(log n)  | O(log n)  |
| `delete`        | O(log n)  | O(log n)  |

\* O(1) if the heap caches a pointer to the current min.

Key invariants:

- A binomial tree `B_k` has `2^k` nodes, height `k`, and root degree `k`.
- A binomial heap with `n` nodes contains exactly one `B_k` for every bit set in `n` — so the number of trees equals `popcount(n)` and is bounded by `floor(log2 n) + 1`.
- Roots form a singly linked **root list** sorted by ascending degree.
- Each tree is min-heap ordered.

Mental model: a binomial heap is binary addition of `n` made physical — melding two heaps mirrors adding two binary numbers with carries.

---

## Junior Questions (10 Q&A)

### J1. What is a binomial heap?
A binomial heap is a collection (forest) of heap-ordered binomial trees, where each tree `B_k` contains `2^k` nodes. The heap stores at most one tree of each order, linked together in a root list. It supports the standard priority-queue operations plus efficient meld in `O(log n)`. It generalises the idea of a binary heap from "one perfect tree" to "a forest of perfect powers-of-two trees".

### J2. What is a binomial tree?
A binomial tree `B_k` is defined recursively: `B_0` is a single node, and `B_k` is two `B_{k-1}` trees linked so that one root becomes the leftmost child of the other. `B_k` has `2^k` nodes, height `k`, and root degree `k`. The number of nodes at depth `i` equals `C(k, i)` — which is exactly why the structure is called *binomial*.

### J3. Why use a binomial heap instead of a binary heap?
The killer feature is `O(log n)` meld. A binary heap can also meld in `O(log n)` only if you do something clever; the naive approach is `O(n)`. So if your workload joins priority queues — multi-source Dijkstra variants, MST algorithms, scheduling merges — binomial heap is a natural fit.

### J4. How do you find the minimum?
Scan the root list and return the smallest root. Since there are at most `floor(log2 n) + 1` trees, this is `O(log n)`. Most production implementations cache a pointer to the min root and update it on insert/extract, giving `O(1)` find-min.

### J5. How does insert work at a high level?
Create a one-node heap (a single `B_0`) and meld it with the existing heap. Meld walks the root lists like binary addition: equal-order trees get linked into the next order, just like a carry bit. Worst-case insert is `O(log n)`, amortised `O(1)`.

### J6. How are two binomial trees of the same order linked?
You compare the two roots and make the larger root a child of the smaller root. This preserves heap order and produces a `B_{k+1}` from two `B_k`s in `O(1)`. The new child is prepended to the parent's child list.

### J7. What does the root list look like?
A singly linked list of roots ordered by ascending degree (`B_0, B_1, B_2, ...`). Each root has pointers to its sibling (next root) and its child (head of its child list). Children form their own linked list — typically ordered by *descending* degree so meld is easy.

### J8. How many trees can a binomial heap have?
At most `floor(log2 n) + 1`. Concretely, the number of trees equals the number of 1-bits in the binary representation of `n` — `popcount(n)`. For `n = 13 = 1101_2`, you have three trees: `B_3`, `B_2`, and `B_0`.

### J9. Is a binomial heap a min-heap or max-heap?
Either — it's parametric on the comparison. The invariant "each parent is `<=` (or `>=`) its children" is preserved by every operation. Most textbook presentations use min-heap ordering because Dijkstra/Prim need it.

### J10. Can a binomial heap store duplicates?
Yes. Duplicates are allowed because the heap-order invariant uses `<=`, not `<`. Two equal keys can sit in any relative order without breaking correctness.

---

## Middle Questions (12 Q&A)

### M1. Walk through `meld(H1, H2)` step by step.
First, merge the two root lists by ascending degree (linear scan, like merging two sorted lists). Then walk the merged list and consolidate: whenever you see three consecutive same-degree roots or two consecutive same-degree roots not followed by another of that degree, link the two smaller-keyed ones into a tree of the next degree. The pattern mirrors carrying in binary addition. Total work is `O(log n)`.

### M2. Why is the number of trees equal to `popcount(n)`?
Because each tree `B_k` holds exactly `2^k` nodes, and a heap contains at most one `B_k` per order, the multiset of tree orders uniquely encodes `n` as a sum of distinct powers of two — that is, the binary representation of `n`. So a `B_k` is present iff bit `k` of `n` is set, and the count of trees is the count of set bits.

### M3. Why does insert amortise to O(1)?
Use accounting: each insert pays 2 credits — one for itself and one stored on the new node. When carries link two trees during a future insert, the stored credit pays for the link. The total credits stored never exceed `popcount(n)`, and every carry consumes a credit, so a sequence of `n` inserts does `O(n)` work total — `O(1)` amortised per insert. This is the same analysis as incrementing a binary counter.

### M4. How does extract-min work?
Find the min root, detach it from the root list, reverse its child list (children are stored in descending order, so reversing gives ascending — a valid heap), then meld the result back with the rest of the original heap. Three steps: scan (O(log n)), reverse (O(log n)), meld (O(log n)). Total `O(log n)`.

### M5. Why reverse the child list during extract-min?
Because children of a `B_k` root form a forest `B_{k-1}, B_{k-2}, ..., B_0` that is *almost* a binomial heap — but it's ordered backwards. Reversing produces an ascending-degree root list, which is the required form. After reversal, it's a valid binomial heap and can be melded.

### M6. How does decrease-key work?
Update the key in place, then sift up: while the node's key is smaller than its parent's, swap them (or swap satellite data via pointer rewiring). Since each binomial tree has height `O(log n)`, decrease-key is `O(log n)`. Heap order is restored after sift-up because we only fix the path from the node to the root.

### M7. How is delete implemented?
Decrease the key to `-infinity` (or any sentinel smaller than every real key), which bubbles it to the root, then extract-min. Both steps are `O(log n)`, so delete is `O(log n)`.

### M8. What's the difference between worst-case and amortised cost for insert?
Worst-case insert is `O(log n)` — happens when `n = 2^k - 1`, so inserting one more element triggers a cascade of `k` links (all bits flip during a carry, like `01111 + 1 = 10000`). But across a sequence of `n` inserts, the total number of links is `O(n)` because each link corresponds to a single carry, and a binary counter only has `O(n)` total carries over `n` increments.

### M9. How is the child list typically organised?
Children of a root form a singly linked list ordered by *descending* degree (largest child first). This is convenient for two reasons: (1) when we link `B_k` into another `B_k` to form `B_{k+1}`, the new child becomes the largest and is prepended in `O(1)`; (2) during extract-min, reversing the child list yields the standard ascending root list.

### M10. What data does each node hold?
Typically: `key`, optional satellite `value`, `degree` (number of children), `parent` pointer, `child` pointer (head of child list), `sibling` pointer (next root or next child). The `parent` pointer is needed for `decrease-key`'s sift-up. Without it, decrease-key would be O(log² n) or require auxiliary structures.

### M11. Can a binomial heap implement Dijkstra's algorithm?
Yes. With `V` vertices and `E` edges, Dijkstra with a binomial heap runs in `O((V + E) log V)` — same asymptotic as a binary heap. The win comes only if you need meld; for vanilla Dijkstra, a binary heap is simpler with the same complexity, and a Fibonacci heap is theoretically faster.

### M12. Is the structure stable?
Not by default. Two elements with equal keys may end up in arbitrary order. If stability matters, you can encode insertion order into a composite key (`(key, insertionTimestamp)`), which forces a deterministic tie-break.

---

## Senior Questions (10 Q&A)

### S1. Derive the recurrence and closed-form for the number of nodes in `B_k`.
By definition `B_k` is two `B_{k-1}` joined at the roots, so `|B_k| = 2 * |B_{k-1}|` with `|B_0| = 1`. Unrolling gives `|B_k| = 2^k`. Inductively, the number of nodes at depth `i` in `B_k` is `C(k, i)`: at depth 0 we have 1 (= C(k,0)); for depth `i > 0`, a node at depth `i` in `B_k` is either at depth `i` in the original `B_{k-1}` or at depth `i-1` in the newly attached `B_{k-1}` — so the count is `C(k-1, i) + C(k-1, i-1) = C(k, i)` by Pascal's identity.

### S2. Prove the amortised O(1) bound on insert formally.
Define potential `Φ(H) = t(H)` (number of trees). Insert adds one tree (`ΔΦ ≥ +1`) before any links. Each link during meld reduces the tree count by 1 (`ΔΦ = -1`). If insert performs `k` links, the actual cost is `k + 1`, and `ΔΦ = -k + 1`. Amortised cost = actual + ΔΦ = `(k + 1) + (1 - k) = 2 = O(1)`. The potential function is always non-negative and starts at 0, so the amortised bound is valid.

### S3. When is a binomial heap a better fit than a Fibonacci heap?
When you care about predictable per-operation cost and simpler invariants. Fibonacci heaps have great amortised bounds (`O(1)` for insert and decrease-key) but huge constants, bad cache behaviour, and only amortised guarantees — bad for hard-real-time or worst-case-sensitive workloads. Binomial heaps give clean `O(log n)` worst-case for all operations, simpler code, and better cache locality.

### S4. How would you implement persistent (immutable) binomial heaps?
Represent the root list and child lists as functional linked lists with structural sharing. `meld` becomes a pure function that returns a new heap; old heaps remain valid. Insert is `meld(singleton, h)`, which copies only the spine traversed during carrying — `O(log n)` nodes — so each version uses `O(log n)` extra memory. This is the basis of Okasaki's purely functional binomial heaps.

### S5. How do you handle decrease-key without parent pointers?
Two options. (1) Maintain a hash map from value pointers to tree positions and rebuild the path; impractical. (2) Use a different representation where children point to parents via implicit thread pointers or where you locate the node via path encoding stored at the handle. In practice, parent pointers are the right answer — they cost one extra word per node but enable `O(log n)` decrease-key trivially.

### S6. Discuss cache behaviour of binomial heaps vs binary heaps.
Binary heaps stored in arrays are extremely cache-friendly: parents and children are contiguous (or within a few cache lines). Binomial heaps are pointer-based — every traversal chases pointers, suffering cache misses. For large `n` and workloads dominated by extract-min, a binary heap is often 2-5x faster in wall-clock time despite identical asymptotic complexity. Binomial heaps shine only when meld is on the critical path.

### S7. How does meld relate to binary addition?
Direct correspondence. Each heap is a binary number where bit `k` is 1 iff `B_k` is present. Melding heaps `H1` and `H2` of sizes `n1` and `n2` produces a heap of size `n1 + n2`, and the link operations exactly track the carry bits in the addition `n1 + n2`. Total links over the meld = total carry positions, which is at most `log(n1 + n2)`.

### S8. What happens during meld if two heaps both have a `B_k`?
The two `B_k` roots are compared; the larger root becomes a child of the smaller, producing a single `B_{k+1}`. This `B_{k+1}` then collides with any pre-existing `B_{k+1}` (a "carry"), and the link cascades. The cascade terminates at the first order where there is no existing tree — exactly like a binary increment terminates at the first 0 bit.

### S9. Sketch the consolidation loop for extract-min.
Pseudocode: walk through the root list while keeping pointers `prev, x, next`. While `next != null`: if `degree(x) != degree(next)` or (`next.sibling != null && degree(next.sibling) == degree(x)`), advance. Otherwise, link `x` and `next` by comparing keys, making the larger the child of the smaller, and continue without advancing. The three-tree special case prevents a premature link that would skip a valid cascade.

### S10. How would you implement a meldable priority queue if you also need `O(1)` decrease-key?
Use a Fibonacci heap, a relaxed binomial heap, or a pairing heap. All three sacrifice strict structural invariants to defer work and achieve `O(1)` amortised decrease-key. Binomial heaps cannot do better than `O(log n)` decrease-key without breaking their invariants because the sift-up path has length up to `log n`.

---

## Professional Questions (6 Q&A)

### P1. You're tasked with merging 1000 priority queues from 1000 worker shards. Why binomial heap?
With per-shard size `m`, meld is `O(log m)`. Merging 1000 shards via meld is `O(1000 * log(total))` = `O(1000 * log(1000m))`. A binary heap would need either an `O(n)` linear meld per join (totaling `O(n * 1000)`) or a global rebuild. Binomial heap is asymptotically and practically better whenever meld dominates.

### P2. How do you persist a binomial heap to disk for crash recovery?
Don't serialise the pointer graph directly — serialise a recipe: append-only log of operations (insert/extract/meld), or periodically checkpoint by writing nodes in pre-order with their degrees. On recovery, replay the log or rebuild from the checkpoint. For high write throughput, the log approach with periodic compaction works well. Avoid serialising raw pointers; on reload you'd need fix-up.

### P3. How would you make a binomial heap thread-safe?
Coarse approach: single mutex around the heap; simple, fine for low contention. Better: split into per-shard binomial heaps with periodic meld under lock, exploiting the `O(log n)` meld. For lock-free: very hard, because operations restructure many pointers; the literature has very few lock-free meldable heaps. Most production code uses sharded heaps with a merge thread.

### P4. Discuss memory overhead per node in a production C++/Go implementation.
Each node typically holds: `key` (8 bytes), `value` pointer (8 bytes), `parent`, `child`, `sibling` pointers (24 bytes), `degree` (4 bytes, often padded to 8). That's roughly 48-56 bytes per node — about 6-7x the cost of a binary-heap slot (which is just the key/value pair in an array). For tight memory budgets with billions of items, binary heaps or implicit d-ary heaps win.

### P5. How would you choose between binomial, pairing, and Fibonacci heaps in production?
Default to pairing heap: simple, fast in practice, good amortised bounds without the Fibonacci heap's bookkeeping. Use binomial when you need clean worst-case `O(log n)` per op and meld. Use Fibonacci only if benchmarks show decrease-key is the bottleneck and you can tolerate amortised guarantees — rare in practice. For most real workloads, a plain binary heap or pairing heap beats a binomial heap on wall-clock.

### P6. How would you instrument a binomial heap to expose useful operational metrics?
Track: (1) tree count per operation (should stay near `log n`), (2) max degree observed (should match `floor(log2 n)`), (3) link count per meld (carry chain length), (4) time spent in extract-min vs insert vs meld. Alert if max degree exceeds `1.5 * log2(n)` — indicates a bug in consolidation. Counter for total links is useful to validate amortised bounds in production.

---

## Behavioral / System-Design Questions (5)

### B1. Tell me about a time you replaced a simpler data structure with a binomial heap.
Strong answer pattern: identify the original bottleneck (meld cost), describe the metric that exposed it (latency p99 spiked during shard merges), the candidates you considered (binary heap with batch rebuild, pairing heap, binomial heap), the criteria (predictable worst-case, simple invariants, low memory churn), the result (e.g., meld latency went from `O(n)` to `O(log n)`, p99 dropped 10x), and what you learned (e.g., simpler structures often win until they don't).

### B2. Design a scalable job scheduler where workers can merge their pending queues during failover.
Each worker keeps a local binomial heap of jobs ordered by priority/deadline. On failover, the surviving worker melds the failed worker's heap into its own in `O(log n)`. Persist heaps to durable storage via append-only log so failover doesn't lose work. Use sharded heaps to scale beyond one node, with a leader that coordinates meld during rebalancing.

### B3. Design a multi-source Dijkstra over a graph with billions of edges.
Per-source heap initially small; as searches expand, sources merge via meld when they meet in the graph. Binomial heap gives `O(log n)` meld, enabling parallel expansion. Bound memory with disk-spilling: when a heap exceeds RAM threshold, spill the largest tree to disk. On the other hand, if meld is rare, a simpler binary heap per source suffices.

### B4. A senior engineer says "binomial heaps are obsolete, use Fibonacci heaps." How do you respond?
Push back politely with data. Fibonacci heaps look better on paper but are slower in practice for almost all workloads due to constants and cache behavior. Cite published benchmarks (Larkin/Sen/Tarjan 2014) showing pairing/binomial heaps beat Fibonacci heaps in measured wall-clock for Dijkstra, MST, etc. The right answer depends on workload; reach for evidence, not folklore.

### B5. How would you teach a junior the difference between worst-case and amortised analysis using a binomial heap?
Use the binary counter analogy: incrementing a counter `n` times costs `O(n)` total, but a single increment can flip `k` bits when it carries. Per-op worst-case is `O(log n)`, but the average across many ops is `O(1)`. Binomial heap insert is literally a binary increment over the tree-count bitmask. Show the code, count the links over 16 inserts, plot per-op cost — the spike pattern (1,1,2,1,3,1,2,1,4,1,2,1,3,1,2,1,5) makes amortisation visceral.

---

## Coding Challenges

### Challenge 1 — Implement insert + meld + extract-min and verify popcount invariant

Build a binomial heap supporting `insert(x)`, `meld(H)`, and `extractMin()`. After every operation, assert that the number of trees in the root list equals `popcount(size)`.

Show runnable Go, Java, and Python implementations.

#### Go solution

```go
package main

import (
	"fmt"
	"math/bits"
)

type Node struct {
	key                     int
	degree                  int
	parent, child, sibling *Node
}

type BinomialHeap struct {
	head *Node
	size int
}

func link(y, z *Node) { // y becomes child of z; caller ensures z.key <= y.key
	y.parent = z
	y.sibling = z.child
	z.child = y
	z.degree++
}

func mergeRootLists(a, b *Node) *Node {
	if a == nil {
		return b
	}
	if b == nil {
		return a
	}
	var head, tail *Node
	for a != nil && b != nil {
		var pick *Node
		if a.degree <= b.degree {
			pick, a = a, a.sibling
		} else {
			pick, b = b, b.sibling
		}
		if head == nil {
			head = pick
		} else {
			tail.sibling = pick
		}
		tail = pick
	}
	if a != nil {
		tail.sibling = a
	} else {
		tail.sibling = b
	}
	return head
}

func union(h1, h2 *BinomialHeap) *BinomialHeap {
	res := &BinomialHeap{size: h1.size + h2.size}
	res.head = mergeRootLists(h1.head, h2.head)
	if res.head == nil {
		return res
	}
	var prev *Node
	x := res.head
	next := x.sibling
	for next != nil {
		if x.degree != next.degree || (next.sibling != nil && next.sibling.degree == x.degree) {
			prev = x
			x = next
		} else if x.key <= next.key {
			x.sibling = next.sibling
			link(next, x)
		} else {
			if prev == nil {
				res.head = next
			} else {
				prev.sibling = next
			}
			link(x, next)
			x = next
		}
		next = x.sibling
	}
	return res
}

func (h *BinomialHeap) Insert(k int) {
	h2 := &BinomialHeap{head: &Node{key: k}, size: 1}
	merged := union(h, h2)
	h.head, h.size = merged.head, merged.size
}

func (h *BinomialHeap) ExtractMin() int {
	if h.head == nil {
		panic("empty")
	}
	var prevMin, minNode, prev *Node
	cur := h.head
	minNode = cur
	for cur.sibling != nil {
		if cur.sibling.key < minNode.key {
			prevMin = cur
			minNode = cur.sibling
		}
		cur = cur.sibling
	}
	if prevMin == nil {
		h.head = minNode.sibling
	} else {
		prevMin.sibling = minNode.sibling
	}
	// reverse children
	var revHead *Node
	c := minNode.child
	for c != nil {
		next := c.sibling
		c.sibling = revHead
		c.parent = nil
		revHead = c
		c = next
	}
	h.size--
	tmp := &BinomialHeap{head: revHead}
	merged := union(h, tmp)
	h.head = merged.head
	_ = prev
	return minNode.key
}

func (h *BinomialHeap) treeCount() int {
	n := 0
	for x := h.head; x != nil; x = x.sibling {
		n++
	}
	return n
}

func main() {
	h := &BinomialHeap{}
	for _, v := range []int{7, 3, 9, 1, 4, 8, 2, 6, 5, 10, 11, 12, 13} {
		h.Insert(v)
		if h.treeCount() != bits.OnesCount(uint(h.size)) {
			panic("invariant broken")
		}
	}
	for h.size > 0 {
		fmt.Println(h.ExtractMin())
		if h.treeCount() != bits.OnesCount(uint(h.size)) {
			panic("invariant broken after extract")
		}
	}
}
```

#### Java solution

```java
import java.util.*;

public class BinomialHeap {
    static class Node {
        int key, degree;
        Node parent, child, sibling;
        Node(int k) { key = k; }
    }

    Node head;
    int size;

    static void link(Node y, Node z) {
        y.parent = z;
        y.sibling = z.child;
        z.child = y;
        z.degree++;
    }

    static Node mergeRoots(Node a, Node b) {
        Node head = null, tail = null;
        while (a != null && b != null) {
            Node pick;
            if (a.degree <= b.degree) { pick = a; a = a.sibling; }
            else { pick = b; b = b.sibling; }
            if (head == null) head = pick; else tail.sibling = pick;
            tail = pick;
        }
        if (tail != null) tail.sibling = (a != null ? a : b);
        else head = (a != null ? a : b);
        return head;
    }

    static BinomialHeap union(BinomialHeap h1, BinomialHeap h2) {
        BinomialHeap res = new BinomialHeap();
        res.size = h1.size + h2.size;
        res.head = mergeRoots(h1.head, h2.head);
        if (res.head == null) return res;
        Node prev = null, x = res.head, next = x.sibling;
        while (next != null) {
            if (x.degree != next.degree ||
                (next.sibling != null && next.sibling.degree == x.degree)) {
                prev = x; x = next;
            } else if (x.key <= next.key) {
                x.sibling = next.sibling;
                link(next, x);
            } else {
                if (prev == null) res.head = next; else prev.sibling = next;
                link(x, next);
                x = next;
            }
            next = x.sibling;
        }
        return res;
    }

    public void insert(int k) {
        BinomialHeap tmp = new BinomialHeap();
        tmp.head = new Node(k);
        tmp.size = 1;
        BinomialHeap m = union(this, tmp);
        this.head = m.head; this.size = m.size;
    }

    public int extractMin() {
        Node prevMin = null, minNode = head, prev = null, cur = head;
        while (cur.sibling != null) {
            if (cur.sibling.key < minNode.key) { prevMin = cur; minNode = cur.sibling; }
            cur = cur.sibling;
        }
        if (prevMin == null) head = minNode.sibling;
        else prevMin.sibling = minNode.sibling;

        Node rev = null, c = minNode.child;
        while (c != null) {
            Node nx = c.sibling;
            c.sibling = rev; c.parent = null;
            rev = c; c = nx;
        }
        size--;
        BinomialHeap tmp = new BinomialHeap();
        tmp.head = rev;
        BinomialHeap m = union(this, tmp);
        head = m.head;
        return minNode.key;
    }

    int treeCount() {
        int n = 0;
        for (Node x = head; x != null; x = x.sibling) n++;
        return n;
    }

    public static void main(String[] args) {
        BinomialHeap h = new BinomialHeap();
        int[] vals = {7, 3, 9, 1, 4, 8, 2, 6, 5, 10, 11, 12, 13};
        for (int v : vals) {
            h.insert(v);
            if (h.treeCount() != Integer.bitCount(h.size))
                throw new AssertionError("popcount invariant broken");
        }
        while (h.size > 0) {
            System.out.println(h.extractMin());
            if (h.treeCount() != Integer.bitCount(h.size))
                throw new AssertionError("popcount invariant broken");
        }
    }
}
```

#### Python solution

```python
class Node:
    __slots__ = ("key", "degree", "parent", "child", "sibling")
    def __init__(self, k):
        self.key = k
        self.degree = 0
        self.parent = self.child = self.sibling = None

class BinomialHeap:
    def __init__(self):
        self.head = None
        self.size = 0

    @staticmethod
    def _link(y, z):
        y.parent = z
        y.sibling = z.child
        z.child = y
        z.degree += 1

    @staticmethod
    def _merge_roots(a, b):
        head = tail = None
        while a and b:
            if a.degree <= b.degree:
                pick, a = a, a.sibling
            else:
                pick, b = b, b.sibling
            if head is None:
                head = pick
            else:
                tail.sibling = pick
            tail = pick
        rest = a if a else b
        if tail:
            tail.sibling = rest
        else:
            head = rest
        return head

    @classmethod
    def _union(cls, h1, h2):
        res = BinomialHeap()
        res.size = h1.size + h2.size
        res.head = cls._merge_roots(h1.head, h2.head)
        if res.head is None:
            return res
        prev = None
        x = res.head
        nxt = x.sibling
        while nxt is not None:
            if x.degree != nxt.degree or (nxt.sibling and nxt.sibling.degree == x.degree):
                prev, x = x, nxt
            elif x.key <= nxt.key:
                x.sibling = nxt.sibling
                cls._link(nxt, x)
            else:
                if prev is None:
                    res.head = nxt
                else:
                    prev.sibling = nxt
                cls._link(x, nxt)
                x = nxt
            nxt = x.sibling
        return res

    def insert(self, k):
        tmp = BinomialHeap()
        tmp.head = Node(k)
        tmp.size = 1
        m = BinomialHeap._union(self, tmp)
        self.head, self.size = m.head, m.size

    def extract_min(self):
        prev_min, min_node = None, self.head
        cur = self.head
        while cur.sibling:
            if cur.sibling.key < min_node.key:
                prev_min, min_node = cur, cur.sibling
            cur = cur.sibling
        if prev_min is None:
            self.head = min_node.sibling
        else:
            prev_min.sibling = min_node.sibling
        rev = None
        c = min_node.child
        while c:
            nx = c.sibling
            c.sibling, c.parent = rev, None
            rev, c = c, nx
        self.size -= 1
        tmp = BinomialHeap()
        tmp.head = rev
        m = BinomialHeap._union(self, tmp)
        self.head = m.head
        return min_node.key

    def tree_count(self):
        n, x = 0, self.head
        while x:
            n += 1
            x = x.sibling
        return n

if __name__ == "__main__":
    h = BinomialHeap()
    for v in [7, 3, 9, 1, 4, 8, 2, 6, 5, 10, 11, 12, 13]:
        h.insert(v)
        assert h.tree_count() == bin(h.size).count("1"), "invariant broken"
    while h.size > 0:
        print(h.extract_min())
        assert h.tree_count() == bin(h.size).count("1"), "invariant broken"
```

**Complexity.** Each insert is `O(log n)` worst-case and `O(1)` amortised. Each extract-min is `O(log n)`. The invariant check is `O(log n)` and fires per operation, so the assertion does not change asymptotic cost.

---

### Challenge 2 — K-way merge of K=10 sorted streams using binomial heap meld

Given 10 sorted streams, produce a single sorted output. Build a one-node heap per element initially? No — better: build a small binomial heap per stream (lazy approach) and meld them all in `O(K log N)` total, then extract-min `N` times.

A more idiomatic merge uses a heap of stream-head iterators, but here we demonstrate meld explicitly: each stream is converted to a binomial heap (by inserting all elements), then all heaps are melded pairwise (or in a tree of melds), and the final heap is drained.

#### Go solution

```go
package main

import "fmt"

// Reuse the BinomialHeap type from Challenge 1.

func kwayMerge(streams [][]int) []int {
	if len(streams) == 0 {
		return nil
	}
	heaps := make([]*BinomialHeap, 0, len(streams))
	for _, s := range streams {
		h := &BinomialHeap{}
		for _, v := range s {
			h.Insert(v)
		}
		heaps = append(heaps, h)
	}
	// pairwise meld
	for len(heaps) > 1 {
		next := make([]*BinomialHeap, 0, (len(heaps)+1)/2)
		for i := 0; i < len(heaps); i += 2 {
			if i+1 < len(heaps) {
				next = append(next, union(heaps[i], heaps[i+1]))
			} else {
				next = append(next, heaps[i])
			}
		}
		heaps = next
	}
	root := heaps[0]
	out := make([]int, 0, root.size)
	for root.size > 0 {
		out = append(out, root.ExtractMin())
	}
	return out
}

func main() {
	streams := [][]int{
		{1, 4, 7}, {2, 5, 8}, {3, 6, 9}, {0, 10, 20},
		{11, 12, 13}, {14, 15, 16}, {17, 18, 19},
		{21, 22, 23}, {24, 25, 26}, {27, 28, 29},
	}
	fmt.Println(kwayMerge(streams))
}
```

#### Java solution

```java
import java.util.*;

public class KWayMergeBinomial {
    static List<Integer> merge(List<List<Integer>> streams) {
        List<BinomialHeap> heaps = new ArrayList<>();
        for (List<Integer> s : streams) {
            BinomialHeap h = new BinomialHeap();
            for (int v : s) h.insert(v);
            heaps.add(h);
        }
        while (heaps.size() > 1) {
            List<BinomialHeap> next = new ArrayList<>();
            for (int i = 0; i < heaps.size(); i += 2) {
                if (i + 1 < heaps.size())
                    next.add(BinomialHeap.union(heaps.get(i), heaps.get(i + 1)));
                else
                    next.add(heaps.get(i));
            }
            heaps = next;
        }
        BinomialHeap root = heaps.get(0);
        List<Integer> out = new ArrayList<>(root.size);
        while (root.size > 0) out.add(root.extractMin());
        return out;
    }

    public static void main(String[] args) {
        List<List<Integer>> streams = Arrays.asList(
            Arrays.asList(1, 4, 7), Arrays.asList(2, 5, 8),
            Arrays.asList(3, 6, 9), Arrays.asList(0, 10, 20),
            Arrays.asList(11, 12, 13), Arrays.asList(14, 15, 16),
            Arrays.asList(17, 18, 19), Arrays.asList(21, 22, 23),
            Arrays.asList(24, 25, 26), Arrays.asList(27, 28, 29)
        );
        System.out.println(merge(streams));
    }
}
```

#### Python solution

```python
def kway_merge(streams):
    heaps = []
    for s in streams:
        h = BinomialHeap()
        for v in s:
            h.insert(v)
        heaps.append(h)
    while len(heaps) > 1:
        nxt = []
        for i in range(0, len(heaps), 2):
            if i + 1 < len(heaps):
                nxt.append(BinomialHeap._union(heaps[i], heaps[i + 1]))
            else:
                nxt.append(heaps[i])
        heaps = nxt
    root = heaps[0]
    out = []
    while root.size > 0:
        out.append(root.extract_min())
    return out

if __name__ == "__main__":
    streams = [
        [1, 4, 7], [2, 5, 8], [3, 6, 9], [0, 10, 20],
        [11, 12, 13], [14, 15, 16], [17, 18, 19],
        [21, 22, 23], [24, 25, 26], [27, 28, 29],
    ]
    print(kway_merge(streams))
```

**Complexity.** Let `N` be the total element count and `K = 10`. Building per-stream heaps costs `O(N)` amortised (each insert `O(1)` amortised). The pairwise meld tree has `log K` levels; total meld work is `O(N log K)` in the worst case (each meld is `O(log N)`, repeated `K - 1` times). Extract-min `N` times costs `O(N log N)`. Total: `O(N log N)` — same as a streaming k-way merge but demonstrates meld semantics.

A streaming merge using a heap of `K` iterators is `O(N log K)` and faster in practice; we used meld here because that's the binomial heap's headline feature.

---

## Common Pitfalls in Interviews

- **Forgetting children are reverse-ordered.** During extract-min, omitting the child-list reversal leaves the resulting forest with descending degrees — `meld` then breaks because it assumes ascending order.
- **Conflating amortised and worst-case.** Saying "insert is O(1)" without "amortised" gets corrected by the interviewer. Always qualify.
- **Missing the three-tree case in consolidation.** Skipping the `next.sibling != null && next.sibling.degree == x.degree` check links the wrong pair and produces multiple trees of the same degree — the cardinal sin.
- **Decrease-key without parent pointers.** Some textbooks omit them; in code, sift-up needs them or it's `O(log² n)`.
- **Confusing binomial trees with binary trees.** A binomial tree `B_k` has root degree `k` (not `2`); children form a list, not left/right.
- **Forgetting to update `size`.** Easy bug; the popcount invariant assertion in Challenge 1 catches it immediately.
- **Stable handles broken by linking.** If you hand out node pointers as handles for decrease-key, you must not allocate new nodes during link — only rewire existing ones.

---

## What Interviewers Are Really Testing

| Signal                                | What it shows                                       |
|---------------------------------------|-----------------------------------------------------|
| Can you explain meld via binary addition | You understand structural correspondences          |
| Can you derive the popcount invariant | You can reason about invariants from definitions    |
| Can you justify amortised O(1) insert | You know amortised analysis (potential/accounting)  |
| Can you spot the consolidation special case | You read code carefully                       |
| Can you compare with Fibonacci/pairing heaps | You know the broader heap landscape, not just one entry |
| Can you discuss cache effects         | You think about real-world performance, not just theory |

The deepest signal is whether you can move between three levels — structure ("forest of binomial trees"), behaviour ("meld mirrors binary addition"), and analysis ("amortised O(1) by potential `Φ = t(H)`"). Candidates who only know one of those layers stand out as having memorised, not understood.
