# Treap (Tree + Heap) — Interview Preparation

> **Audience:** Candidates preparing for coding and systems interviews where balanced search trees, randomized data structures, or "implement an ordered set with split/merge" come up. The treap is a favorite because it lets an interviewer probe three things at once: do you understand *randomized* balancing (vs deterministic AVL/red-black), can you reason about *two invariants at once* (BST on keys, heap on priorities), and can you write the elegant *split/merge* primitives under time pressure.

This file has **48 tiered questions with answers** (junior → middle → senior → professional) followed by a full **coding challenge** — an order-statistics treap supporting `insert`, `erase`, `kth`, `rank`, plus `split`/`merge` — implemented in Go, Java, and Python with tests.

---

## Table of Contents

1. [Junior Questions (Q1–Q14)](#junior)
2. [Middle Questions (Q15–Q28)](#middle)
3. [Senior Questions (Q29–Q40)](#senior)
4. [Professional Questions (Q41–Q48)](#professional)
5. [Coding Challenge — Order-Statistics Treap (Go / Java / Python)](#challenge)
6. [Rapid-Fire Cheat Answers](#rapid-fire)

---

<a name="junior"></a>
## 1. Junior Questions (Q1–Q14)

**Q1. What is a treap?**
A binary tree that is simultaneously a **BST on its keys** and a **max-heap on a per-node random priority**. The name is "tree" + "heap". The random priorities make its shape behave like a randomly-built BST, giving expected `O(log n)` operations regardless of input order.

**Q2. Why does a plain BST need balancing in the first place?**
A plain BST's shape depends on insertion order. Inserting sorted data (`1,2,3,…`) produces a right-spine of height `n`, so every operation degrades to `O(n)`. Balancing keeps the height `O(log n)`.

**Q3. How does a treap stay balanced without tracking heights or colors?**
It assigns each node a random priority at creation and maintains the heap property on those priorities. Since the (key, priority) pairs uniquely determine the tree (the highest-priority node is always the root, recursively), and priorities are random, the resulting shape is a random BST — balanced in expectation. No balance metadata is computed.

**Q4. What are the two invariants, and on which field does each operate?**
BST invariant on **key**: left subtree keys `<` node key `<` right subtree keys. Heap invariant on **priority**: node priority `≥` both children's priorities (max-heap). The mantra: *keys decide left/right, priorities decide up/down*.

**Q5. Is the root the largest key?**
No — that is the most common misconception. The root is the node with the **highest priority**, whose key can be anything. The heap order is on priorities, not keys.

**Q6. What is the expected time complexity of search, insert, and delete?**
All `O(log n)` expected. Worst case is `O(n)`, but only from an unlucky run of the RNG — never forced by the input.

**Q7. How do you search in a treap?**
Exactly like a plain BST: descend by key comparison, ignoring priority entirely. Priority is irrelevant to search.

**Q8. What is a rotation and why is it legal?**
A rotation is a constant-time local restructuring that moves a child above its parent while **preserving the inorder (BST) order**. There are two mirror forms, rotate-left and rotate-right. It is legal precisely because the inorder sequence is unchanged.

**Q9. How does rotation-based insert work?**
Insert the key as an ordinary BST leaf, then **bubble it up**: while the new node's priority exceeds its parent's, rotate it up (rotate-right if it's a left child, rotate-left if it's a right child). Stop when the heap property is restored.

**Q10. How does rotation-based delete work?**
Find the node, then **rotate it down** toward its higher-priority child until it becomes a leaf, then detach it. Rotating toward the larger-priority child keeps the heap property intact on the way down.

**Q11. What does inorder traversal of a treap produce?**
Sorted keys — because a treap is still a BST on keys. Priority does not affect inorder order.

**Q12. Where do the priorities come from, and can they change?**
From a random source (e.g. `rand.Int()`), set **once at node creation**. They are immutable — never recomputed. Recomputing a priority corrupts the tree shape.

**Q13. What happens if all nodes get the same priority?**
The "unique tree" becomes ambiguous and the structure can degenerate to a line (`O(n)`). This is the classic bug from an unseeded or constant RNG. Use a wide random range so collisions are essentially impossible.

**Q14. Treap vs AVL in one sentence each.**
AVL gives a *guaranteed* worst-case `O(log n)` via height tracking and rotations; a treap gives an *expected* `O(log n)` via random priorities, with far simpler code and no balance metadata.

---

<a name="middle"></a>
## 2. Middle Questions (Q15–Q28)

**Q15. What are `split` and `merge`, with their contracts?**
`split(T, x)` → `(L, R)` where `L` holds keys `< x` and `R` holds keys `≥ x`. `merge(L, R)` joins two treaps where **every key in `L` < every key in `R`** into one. Both are `O(log n)` expected.

**Q16. Why do practitioners prefer split/merge over rotations?**
Split/merge eliminates the per-level "which rotation?" case analysis and expresses *every* operation (insert, delete, range extract, set union) as a short composition. The code is shorter and generalizes to the implicit treap.

**Q17. Express insert and delete using split/merge.**
Insert `k`: `split(T,k) → (L,R)`; `merge(merge(L, Node(k)), R)`. Delete `k`: split out the single node equal to `k` (split at `k`, then at `k+1`) and `merge` the outer parts; or, cleanest, find the node and replace it with `merge(left, right)`.

**Q18. How does `merge` decide the root?**
Whichever input root has the **higher priority** becomes the merged root (heap invariant). If `L`'s root wins, its left subtree is untouched and its right child becomes `merge(L.right, R)`; symmetric if `R` wins.

**Q19. Why is `split` guaranteed to keep the heap property?**
`split` only re-routes child pointers along one root-to-leaf path; it **never modifies a priority** and never moves a node above an ancestor. Each output subtree keeps its nodes' original relative priority order, so it is automatically a valid heap on priorities.

**Q20. How do you add order statistics (k-th element, rank)?**
Store `size` (subtree node count) at each node, updated as `size = 1 + size(left) + size(right)` after every structural change. Then `kth` and `rank` are `O(log n)` descents using subtree sizes. Always call `update()` at the end of `split`/`merge`/rotations.

**Q21. What is an implicit treap?**
A treap with **no stored key** — a node's logical key is its *position* (0-based index) in the inorder order, derived on the fly from subtree sizes. It turns the treap into a dynamic array supporting `O(log n)` insert-at, erase-at, range reverse, and range queries.

**Q22. How do you split an implicit treap by position?**
`split_by_size(t, k)`: cut off the first `k` elements into `L`, the rest into `R`. At each node compare `k` against `size(left)`: if `size(left) < k`, the node and its left subtree go left and you recurse right with `k - size(left) - 1`; otherwise recurse left.

**Q23. How does range reverse work in `O(log n)`?**
Split out the block `[l, r]`, toggle a **lazy "reversed" flag** on its root, and merge it back. You don't reverse anything immediately. When you later descend into a flagged node (during split/merge/query), you **push** the flag: swap its children, propagate the flag to both, clear it on the node.

**Q24. What is lazy propagation and why is it needed here?**
Lazy propagation defers a pending update (reverse, range-add) until the affected subtree is actually visited, materializing it exactly when needed. Without it, a range op would touch `O(range size)` nodes; with it, each op stays `O(log n)`. Every `split`/`merge` must `push` before inspecting a node's children.

**Q25. How do range aggregate queries (sum/min) work?**
Augment each node with a subtree aggregate (e.g. `subtree_sum`), maintained in `update()` like `size`. A range query splits out `[l, r]` and reads its root's aggregate in `O(log n)`, then merges back.

**Q26. Treap vs skip list?**
Both randomized, both expected `O(log n)`, both simple. Skip lists are easier to make lock-free (Java's `ConcurrentSkipListMap`). Treaps offer native split/merge and the implicit-sequence operations, which skip lists don't. Their analyses are essentially identical.

**Q27. Treap vs the Martínez–Roura randomized BST?**
Both are randomized balanced BSTs with the same expected bounds. The treap fixes a random *priority per node* (shape then deterministic); the Martínez–Roura version makes a random *choice during each insert/delete* using subtree sizes, storing no priority. Same tree distribution; the treap is usually considered simpler and is the one with the famous split/merge.

**Q28. When does a treap actually degrade to `O(n)`?**
Only when the random priorities happen to be a very unlucky sequence (e.g., monotone), which has probability that drops polynomially in `n`. Crucially it is **independent of the input keys** — there is no "sorted input" attack as with a plain BST.

---

<a name="senior"></a>
## 3. Senior Questions (Q29–Q40)

**Q29. When would you choose a treap over the standard-library ordered map?**
When you need `split`/`merge` in `O(log n)`, an implicit-sequence structure (insert-at / range reverse / range aggregate), or cheap immutable snapshots (persistence). The standard library (red-black) is better for a plain ordered map with guaranteed worst case.

**Q30. Design a real-time leaderboard with rank queries.**
Use an order-statistics treap keyed by `(score, player_id)` (high score first), with `size` augmentation. `submit-score` = erase old key, insert new (`O(log n)`); `rank(player)` = `select`/`rank` query (`O(log n)`); `top-k` / window = `select` boundaries and iterate. A hash map can't do rank; a sorted array can't do `O(log n)` updates; a plain BST can't `split` out a page cheaply.

**Q31. How do you make a treap persistent (immutable snapshots)?**
Path-copying: never mutate a node — allocate a *new* node whenever you'd write to one. `split`/`merge` then rebuild only the `O(log n)` touched path and share the rest. Each version is a distinct root pointer; old readers see a frozen, consistent view forever. Cost is `O(log n)` new nodes per update.

**Q32. What uses persistence in practice?**
MVCC snapshots / time-travel reads, undo/redo stacks (each edit = a new version, undo = previous root), and lock-free reads (readers traverse an immutable version, never a torn node).

**Q33. How do you make a treap concurrent?**
Three options: (a) coarse RW lock — simple, serializes writers; (b) **copy-on-write root swap** — writers build a new immutable version and atomically CAS the root, giving lock-free reads and serialized writers (the pragmatic sweet spot); (c) hand-rolled lock-free treap — intricate and rarely worth it; if you need concurrency without split/merge, use a skip list.

**Q34. What's the memory cost of a treap, and how do you reduce it?**
~5 words per node (key, priority, two children, size). The extra `priority` word over a plain BST is the tax. Reduce it with an **arena/object pool** using 32-bit indices instead of 64-bit pointers (denser, cache-friendlier, trivially serializable) — the standard competitive-programming layout with parallel arrays.

**Q35. Why might a B-tree beat a treap for read-mostly data despite identical asymptotics?**
Cache behavior. A treap does `O(log n)` pointer chases, each a potential ~150-cycle cache miss. A B-tree packs many keys per node and does far fewer misses. For read-mostly in-memory indexes, the B-tree often wins wall-clock. The treap wins when you need split/merge or persistence, not raw lookup throughput.

**Q36. What is the rope use case?**
A rope is a balanced tree of string fragments for large mutable text (editors, diff engines). An implicit treap *is* a rope: position-keyed nodes give `O(log n)` insert, delete, concat, substring, and reverse on multi-megabyte documents where naïve string ops are `O(n)`.

**Q37. How do you implement fast set union/intersection on treaps?**
Recursive split/merge (Blelloch–Reid-Miller): pick the higher-priority root, split the other treap by that key, recurse on matching halves, merge. Union of sizes `m ≤ n` is `O(m log(n/m))` expected — better than `O(m+n)` merge-by-scan when sets are asymmetric.

**Q38. What observability would you add to a production treap?**
Gauge the actual `height` against `≈1.39·log₂ n` and alert if `height > c·log n` (catches a broken RNG — e.g. unseeded → all priorities equal). Track node count (memory), p99.9 op latency (tail), and, for persistence, live-version count (snapshot leaks) and node-alloc rate (GC pressure). A debug-build dual-invariant assertion catches most structural bugs.

**Q39. What are the main failure modes?**
Degenerate line from a broken/unseeded RNG; adversarial seed prediction; `size` desync from a missed `update()`; stack overflow on a tall unlucky tree; version/snapshot leaks in persistence; allocation blow-up under write-heavy persistence.

**Q40. When should you NOT use a treap?**
Hard real-time needing a *guaranteed* (not expected) bound → AVL/red-black. Plain ordered map → standard library. Concurrent ordered map without split/merge → skip list. Read-mostly static lookups → sorted array / B-tree.

---

<a name="professional"></a>
## 4. Professional Questions (Q41–Q48)

**Q41. State and justify the uniqueness theorem.**
For a set of items with distinct keys and distinct priorities there is exactly one treap. Proof by induction: the heap property forces the max-priority item to be the root; the BST property forces the key partition into left (`< root.key`) and right (`> root.key`); recurse on each side. Nothing is chosen, so the tree is unique.

**Q42. Why is a treap equivalent to a random-permutation BST?**
Building a BST by inserting keys in *decreasing priority order* (no rotations) reproduces exactly the unique treap (highest priority becomes root first, etc.). Random priorities make "decreasing priority order" a uniformly random permutation, so the treap is distributed as a random-permutation BST — for every input, since the randomness is in the priorities, not the input order.

**Q43. Prove the expected depth of a node is `O(log n)`.**
Sort keys by rank `x₁<…<xₙ`. Key `xⱼ` is an ancestor of `xᵢ` iff `xⱼ` has the max priority among the rank-range between `i` and `j` (size `|i−j|+1`), which happens with probability `1/(|i−j|+1)`. By linearity, `E[depth(xᵢ)] = Σ_{j≠i} 1/(|i−j|+1) = H_i + H_{n−i+1} − 2 ≤ 2H_n = Θ(log n)`.

**Q44. Why is the relevant sum the harmonic number, and what else shares it?**
Because the ancestor probability is `1/(range size)`, summing over ranges gives `Σ 1/d = H_n ≈ ln n`. The same harmonic sum governs random-BST average depth and randomized-quicksort comparison counts — all three are the same analysis.

**Q45. Give the high-probability height bound.**
`depth(xᵢ)` is a sum of (within-side) independent indicators with mean `≤ 2 ln n`. Chernoff gives `Pr[depth ≥ c ln n] ≤ n^{−β(c)}`; a union bound over `n` nodes gives `Pr[height ≥ c ln n] ≤ n^{1−β}`. For any desired `a`, choosing `c` large enough makes `Pr[height ≥ c ln n] ≤ n^{−a}` — tall treaps are polynomially rare, regardless of input.

**Q46. Prove `merge` correct.**
Induction on total size. The root must be the higher-priority of the two input roots (it's the global max since all `L`-keys `<` all `R`-keys). Keep it; its untouched subtree stays valid, and the other child is `merge(...)` of two sets still satisfying the all-less-than precondition. BST and heap properties both hold; by uniqueness it's *the* treap on the union. Cost = one spine walk = `O(log n)`.

**Q47. Why is the expected number of rotations per insert/delete `O(1)`?**
A delete rotates the target down until it's a leaf; the rotation count equals the combined lengths of the right spine of its left child and the left spine of its right child. The expected length of such a spine in a random treap is `< 1` (a telescoping `Σ 1/k(k+1)`), so expected rotations `< 2`. Insert is the reverse of a delete, so it has the same `O(1)` expected rotation count — even though the update *cost* is `O(log n)` (dominated by the descent).

**Q48. Compare the treap and skip-list analyses.**
Both reduce to "a random element is the maximum (resp. promoted highest) among a size-`m` set with probability `1/m` (resp. `pᵏ`), summed by linearity." The treap's harmonic sum `Σ 1/m` and the skip list's geometric tower `Σ pᵏ` price the same `Θ(log n)` depth. Both have `O(n)` unlucky worst cases and `n^{−a}` height tails; they are the same theorem in different clothing.

---

<a name="challenge"></a>
## 5. Coding Challenge — Order-Statistics Treap

> **Problem.** Implement an ordered **multiset-free set** of integers backed by a treap, supporting:
> - `Insert(key)` — add a key (ignore duplicates),
> - `Erase(key)` — remove a key if present,
> - `Contains(key)` — membership,
> - `Kth(k)` — the k-th smallest key, 0-indexed,
> - `Rank(key)` — number of keys strictly less than `key`,
> - `Split(key)` / `Merge` — exposed as primitives.
>
> All operations expected `O(log n)`. Use the split/merge formulation with a `size` augmentation. Build it in Go, Java, and Python and verify against a sorted reference.

### Go

```go
package main

import (
	"fmt"
	"math/rand"
	"sort"
)

type Node struct {
	key      int
	priority uint64
	size     int
	left     *Node
	right    *Node
}

func newNode(key int) *Node {
	return &Node{key: key, priority: rand.Uint64(), size: 1}
}

func sz(n *Node) int {
	if n == nil {
		return 0
	}
	return n.size
}

func update(n *Node) *Node {
	if n != nil {
		n.size = 1 + sz(n.left) + sz(n.right)
	}
	return n
}

// split: l has keys < key, r has keys >= key.
func split(t *Node, key int) (*Node, *Node) {
	if t == nil {
		return nil, nil
	}
	if t.key < key {
		l, r := split(t.right, key)
		t.right = l
		return update(t), r
	}
	l, r := split(t.left, key)
	t.left = r
	return l, update(t)
}

// merge: all keys in l < all keys in r.
func merge(l, r *Node) *Node {
	if l == nil {
		return r
	}
	if r == nil {
		return l
	}
	if l.priority > r.priority {
		l.right = merge(l.right, r)
		return update(l)
	}
	r.left = merge(l, r.left)
	return update(r)
}

type Treap struct{ root *Node }

func (t *Treap) Contains(key int) bool {
	n := t.root
	for n != nil && n.key != key {
		if key < n.key {
			n = n.left
		} else {
			n = n.right
		}
	}
	return n != nil
}

func (t *Treap) Insert(key int) {
	if t.Contains(key) {
		return
	}
	l, r := split(t.root, key)
	t.root = merge(merge(l, newNode(key)), r)
}

func (t *Treap) Erase(key int) {
	l, midR := split(t.root, key)
	_, r := split(midR, key+1) // mid (== key) is dropped
	t.root = merge(l, r)
}

// Kth returns the k-th smallest key (0-indexed).
func (t *Treap) Kth(k int) (int, bool) {
	n := t.root
	for n != nil {
		ls := sz(n.left)
		switch {
		case k < ls:
			n = n.left
		case k == ls:
			return n.key, true
		default:
			k -= ls + 1
			n = n.right
		}
	}
	return 0, false
}

// Rank returns the number of keys strictly less than key.
func (t *Treap) Rank(key int) int {
	r, n := 0, t.root
	for n != nil {
		if key <= n.key {
			n = n.left
		} else {
			r += sz(n.left) + 1
			n = n.right
		}
	}
	return r
}

func main() {
	t := &Treap{}
	ref := map[int]bool{}
	for i := 0; i < 2000; i++ {
		x := rand.Intn(500)
		if rand.Intn(2) == 0 {
			t.Insert(x)
			ref[x] = true
		} else {
			t.Erase(x)
			delete(ref, x)
		}
	}
	// verify against sorted reference
	keys := make([]int, 0, len(ref))
	for k := range ref {
		keys = append(keys, k)
	}
	sort.Ints(keys)
	for i, k := range keys {
		got, ok := t.Kth(i)
		if !ok || got != k {
			panic(fmt.Sprintf("Kth(%d)=%d want %d", i, got, k))
		}
		if t.Rank(k) != i {
			panic(fmt.Sprintf("Rank(%d)=%d want %d", k, t.Rank(k), i))
		}
	}
	fmt.Printf("OK: %d keys verified\n", len(keys))
}
```

### Java

```java
import java.util.*;

public class TreapChallenge {
    static final Random RNG = new Random();

    static class Node {
        int key;
        long priority;
        int size = 1;
        Node left, right;
        Node(int key) { this.key = key; this.priority = RNG.nextLong(); }
    }

    static int sz(Node n) { return n == null ? 0 : n.size; }

    static Node update(Node n) {
        if (n != null) n.size = 1 + sz(n.left) + sz(n.right);
        return n;
    }

    // split: ret[0] keys < key, ret[1] keys >= key.
    static Node[] split(Node t, int key) {
        if (t == null) return new Node[]{null, null};
        if (t.key < key) {
            Node[] s = split(t.right, key);
            t.right = s[0];
            return new Node[]{update(t), s[1]};
        } else {
            Node[] s = split(t.left, key);
            t.left = s[1];
            return new Node[]{s[0], update(t)};
        }
    }

    static Node merge(Node l, Node r) {
        if (l == null) return r;
        if (r == null) return l;
        if (l.priority > r.priority) {
            l.right = merge(l.right, r);
            return update(l);
        } else {
            r.left = merge(l, r.left);
            return update(r);
        }
    }

    Node root;

    boolean contains(int key) {
        Node n = root;
        while (n != null && n.key != key) n = key < n.key ? n.left : n.right;
        return n != null;
    }

    void insert(int key) {
        if (contains(key)) return;
        Node[] s = split(root, key);
        root = merge(merge(s[0], new Node(key)), s[1]);
    }

    void erase(int key) {
        Node[] s1 = split(root, key);
        Node[] s2 = split(s1[1], key + 1); // s2[0] == key, dropped
        root = merge(s1[0], s2[1]);
    }

    Integer kth(int k) {
        Node n = root;
        while (n != null) {
            int ls = sz(n.left);
            if (k < ls) n = n.left;
            else if (k == ls) return n.key;
            else { k -= ls + 1; n = n.right; }
        }
        return null;
    }

    int rank(int key) {
        int r = 0; Node n = root;
        while (n != null) {
            if (key <= n.key) n = n.left;
            else { r += sz(n.left) + 1; n = n.right; }
        }
        return r;
    }

    public static void main(String[] args) {
        TreapChallenge t = new TreapChallenge();
        TreeSet<Integer> ref = new TreeSet<>();
        for (int i = 0; i < 2000; i++) {
            int x = RNG.nextInt(500);
            if (RNG.nextBoolean()) { t.insert(x); ref.add(x); }
            else { t.erase(x); ref.remove(x); }
        }
        List<Integer> keys = new ArrayList<>(ref);
        for (int i = 0; i < keys.size(); i++) {
            int k = keys.get(i);
            if (!Objects.equals(t.kth(i), k))
                throw new AssertionError("kth(" + i + ")=" + t.kth(i) + " want " + k);
            if (t.rank(k) != i)
                throw new AssertionError("rank(" + k + ")=" + t.rank(k) + " want " + i);
        }
        System.out.println("OK: " + keys.size() + " keys verified");
    }
}
```

### Python

```python
import random

class Node:
    __slots__ = ("key", "priority", "size", "left", "right")
    def __init__(self, key):
        self.key = key
        self.priority = random.random()
        self.size = 1
        self.left = None
        self.right = None

def sz(n):
    return n.size if n else 0

def update(n):
    if n:
        n.size = 1 + sz(n.left) + sz(n.right)
    return n

def split(t, key):
    """l: keys < key, r: keys >= key."""
    if t is None:
        return None, None
    if t.key < key:
        l, r = split(t.right, key)
        t.right = l
        return update(t), r
    else:
        l, r = split(t.left, key)
        t.left = r
        return l, update(t)

def merge(l, r):
    if l is None: return r
    if r is None: return l
    if l.priority > r.priority:
        l.right = merge(l.right, r)
        return update(l)
    else:
        r.left = merge(l, r.left)
        return update(r)

class Treap:
    def __init__(self):
        self.root = None

    def contains(self, key):
        n = self.root
        while n and n.key != key:
            n = n.left if key < n.key else n.right
        return n is not None

    def insert(self, key):
        if self.contains(key):
            return
        l, r = split(self.root, key)
        self.root = merge(merge(l, Node(key)), r)

    def erase(self, key):
        l, mid_r = split(self.root, key)
        _, r = split(mid_r, key + 1)   # == key is dropped
        self.root = merge(l, r)

    def kth(self, k):
        n = self.root
        while n:
            ls = sz(n.left)
            if k < ls:
                n = n.left
            elif k == ls:
                return n.key
            else:
                k -= ls + 1
                n = n.right
        return None

    def rank(self, key):
        r, n = 0, self.root
        while n:
            if key <= n.key:
                n = n.left
            else:
                r += sz(n.left) + 1
                n = n.right
        return r

if __name__ == "__main__":
    t = Treap()
    ref = set()
    for _ in range(2000):
        x = random.randrange(500)
        if random.random() < 0.5:
            t.insert(x); ref.add(x)
        else:
            t.erase(x); ref.discard(x)
    keys = sorted(ref)
    for i, k in enumerate(keys):
        assert t.kth(i) == k, f"kth({i})={t.kth(i)} want {k}"
        assert t.rank(k) == i, f"rank({k})={t.rank(k)} want {i}"
    print(f"OK: {len(keys)} keys verified")
```

**Discussion of the solution.**
- The whole structure is built from two primitives, `split` and `merge`; every public operation is a short composition, so there are no rotation cases to get wrong.
- `update()` is called at the end of every `split` and `merge`, keeping `size` consistent — the single discipline that makes `kth`/`rank` correct.
- `contains` is a plain BST descent (priority irrelevant). `erase` uses the "split at `key`, split at `key+1`, drop the middle, merge the outer parts" idiom; for non-integer keys, replace it with the `merge(left, right)`-of-children variant.
- The `main`/test harness fuzzes 2000 random insert/erase operations against a sorted reference (`map`/`TreeSet`/`set`) and verifies `kth` and `rank` for every key — exactly the kind of property test an interviewer loves to see you reach for.

**Common follow-ups an interviewer asks:**
1. *"Make it persistent."* → Stop mutating nodes; in `split`/`merge` allocate a fresh node instead of writing to `t`, sharing untouched subtrees (see `senior.md` §5).
2. *"Add range sum over `[lo, hi]`."* → Add a `subtree_sum` field maintained in `update()`; split out `[lo, hi]`, read the block root's `subtree_sum`, merge back.
3. *"Make it an implicit treap with insert-at-position and reverse."* → Replace key-based `split` with `split_by_size`, drop the key field, add a lazy `reversed` flag with `push` (see `middle.md` §6–§7).
4. *"What's the worst case and how likely?"* → `O(n)` from unlucky priorities; probability `n^{−a}` for tunable `a`, independent of input (see `professional.md` §5).

---

<a name="rapid-fire"></a>
## 6. Rapid-Fire Cheat Answers

| Prompt | One-line answer |
|---|---|
| Treap = ? | BST on keys + max-heap on random priorities |
| Root holds? | Highest **priority** (not largest key) |
| Search cost | `O(log n)` expected, plain BST descent |
| Balance mechanism | random priorities → random-BST shape |
| Two primitives | `split` (cut at key) + `merge` (join ordered) |
| Insert via split/merge | split at k, merge L + node + R |
| Delete cleanest | replace node with `merge(left, right)` |
| Order statistics | store `size`, descend by subtree sizes |
| Implicit treap | key = position from subtree sizes |
| Range reverse | split block, toggle lazy flag, merge; `push` on descent |
| Expected depth | `H_i + H_{n−i+1} − 2 ≤ 2 ln n` |
| Height tail | `Pr[height ≥ c ln n] ≤ n^{−a}` |
| Rotations/update | `O(1)` expected |
| vs AVL/RB | expected vs guaranteed `O(log n)`; far simpler |
| vs skip list | treap has split/merge; skip list easier lock-free |
| Persistence | path-copy, `O(log n)` new nodes/update |
| Worst case | `O(n)`, only from unlucky RNG, input-independent |
| Classic bug | unseeded RNG → equal priorities → degenerate line |

---

**Next step:** Practice with [`tasks.md`](./tasks.md) — 15 graded exercises (beginner → advanced) in Go, Java, and Python, plus a cross-language benchmark.
