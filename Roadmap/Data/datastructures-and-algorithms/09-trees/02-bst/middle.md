# Binary Search Tree — Middle Level

> **Audience:** Engineers comfortable with the recursive BST primitives from `junior.md`. We now build the algorithms that real code reaches for: predecessor/successor, range queries, BST verification (the classic interview pitfall), in-place BST-to-linked-list conversion, balanced builds from sorted input, and the two famous randomized/self-adjusting relatives — treaps and splay trees.

This document closes the gap between "I can implement a BST" and "I understand BSTs well enough to know when not to use one." We pay careful attention to **verification** — the seemingly easy problem of confirming a tree is a BST is the single most common BST interview trap, and getting it wrong means getting LC 98 wrong, which has happened to hundreds of thousands of candidates.

---

## Table of Contents

1. [Inorder Traversal Yields Sorted — Proof and Use](#inorder)
2. [Predecessor and Successor — With and Without Parent Pointers](#succ-pred)
3. [Range Queries — `findInRange(lo, hi)` with Pruning](#range)
4. [Randomized Insertion Order — Why Random Wins](#random)
5. [Treaps — Randomized BSTs in Practice](#treap)
6. [Splay Trees — Self-Adjusting BSTs (Sleator & Tarjan 1985)](#splay)
7. [BST Verification — The Min/Max Bound Approach](#verify)
8. [Convert BST to Sorted Doubly Linked List In-Place](#dll)
9. [Build a Balanced BST from a Sorted Array](#balanced-from-sorted)
10. [Why Standalone BSTs Are Rare in Production](#why-rare)

---

<a name="inorder"></a>
## 1. Inorder Traversal Yields Sorted — Proof and Use

We claimed this in `junior.md`. A clean inductive proof:

**Claim.** Let `T` be a BST with `n` nodes. The inorder traversal of `T` lists the keys in strictly increasing order.

**Proof by structural induction on `T`.**

*Base case.* `T` is empty. The traversal lists nothing, which is trivially sorted.

*Inductive step.* `T` has root `r` with left subtree `L` and right subtree `R`. By the BST invariant, every key in `L` is `< r.key`, and every key in `R` is `> r.key`. By induction hypothesis, `inorder(L)` is sorted and `inorder(R)` is sorted. The full traversal emits `inorder(L) ++ [r.key] ++ inorder(R)`. Since every element of `inorder(L)` is `< r.key` and every element of `inorder(R)` is `> r.key`, the concatenation is sorted. ∎

This proof underlies *many* problems:

- **k-th smallest element** (LC 230): do an inorder traversal, return the k-th key emitted. Iterative version with an explicit stack is below.
- **Validate BST** (LC 98): do an inorder traversal and check that each emitted key is strictly greater than the previous. (We also cover the bounds-based approach below.)
- **Two-sum in a BST** (LC 653): inorder gives sorted array; then standard two-pointer.

### Iterative inorder traversal (the canonical stack technique):

```python
def inorder_iter(root):
    stack = []
    n = root
    while n is not None or stack:
        while n is not None:
            stack.append(n)
            n = n.left
        n = stack.pop()
        yield n.key            # visit
        n = n.right
```

**Go:**
```go
func InorderIter(root *Node) []int {
    var out []int
    stack := []*Node{}
    n := root
    for n != nil || len(stack) > 0 {
        for n != nil {
            stack = append(stack, n)
            n = n.Left
        }
        n = stack[len(stack)-1]
        stack = stack[:len(stack)-1]
        out = append(out, n.Key)
        n = n.Right
    }
    return out
}
```

**Java:**
```java
public static List<Integer> inorderIter(BSTNode root) {
    List<Integer> out = new ArrayList<>();
    Deque<BSTNode> stack = new ArrayDeque<>();
    BSTNode n = root;
    while (n != null || !stack.isEmpty()) {
        while (n != null) {
            stack.push(n);
            n = n.left;
        }
        n = stack.pop();
        out.add(n.key);
        n = n.right;
    }
    return out;
}
```

### k-th smallest (no extra storage past the k-th element)

```python
def kth_smallest(root, k):
    stack = []
    n = root
    while n is not None or stack:
        while n is not None:
            stack.append(n); n = n.left
        n = stack.pop()
        k -= 1
        if k == 0:
            return n.key
        n = n.right
    raise ValueError("k out of range")
```

Time: O(h + k) — walks down to the leftmost leaf and then up at most k times. Beats "collect all then index" both in time and in memory.

---

<a name="succ-pred"></a>
## 2. Predecessor and Successor — With and Without Parent Pointers

The **inorder successor** of node `x` is the next key after `x.key` in the inorder traversal.

### Case 1: `x` has a right subtree
The successor is the **leftmost** node of `x.right`. O(h).

### Case 2: `x` has no right subtree
The successor is the **lowest ancestor of `x` whose left subtree contains `x`**. Equivalently, you walk up from `x` until you cross a "right-to-parent" edge for the first time; that parent is the successor. If you never cross such an edge, `x` is the maximum and has no successor.

### Without parent pointers — start from the root

If your nodes don't store parent pointers, you find the successor by walking down from the root:

**Python:**
```python
def successor(root, target_key):
    """Smallest key in the BST that is > target_key. None if no such key."""
    succ = None
    n = root
    while n is not None:
        if n.key > target_key:
            succ = n              # candidate; try to find smaller candidate left
            n = n.left
        else:
            n = n.right           # n.key <= target; must go right
    return succ
```

**Go:**
```go
func Successor(root *Node, target int) *Node {
    var succ *Node
    for n := root; n != nil; {
        if n.Key > target {
            succ = n
            n = n.Left
        } else {
            n = n.Right
        }
    }
    return succ
}
```

**Java:**
```java
public static BSTNode successor(BSTNode root, int target) {
    BSTNode succ = null;
    BSTNode n = root;
    while (n != null) {
        if (n.key > target) {
            succ = n;
            n = n.left;
        } else {
            n = n.right;
        }
    }
    return succ;
}
```

Symmetric for predecessor: track the largest key `<= target` while walking.

### With parent pointers — start from `x`

If `x` is given as a node with a `.parent` link, you don't need to descend from the root:

```python
def successor_from_node(x):
    if x.right is not None:
        n = x.right
        while n.left is not None:
            n = n.left
        return n
    # walk up until we cross a left-child edge
    n = x
    while n.parent is not None and n.parent.right is n:
        n = n.parent
    return n.parent          # None if we ran off the top (x was the max)
```

Parent pointers cost an extra word per node and complicate insertion/deletion (every link change is now two writes). Use them only if your workload truly needs O(h) successor-from-node and you don't want a re-search from the root.

**Amortized cost.** A standard textbook fact (CLRS 12.3 exercise) is that walking through all `n` inorder successors starting from the min costs `O(n)` total, not `O(n h)`, because each edge is traversed at most twice. So if you are iterating the BST in order, the amortized successor cost is O(1).

---

<a name="range"></a>
## 3. Range Queries — `findInRange(lo, hi)` with Pruning

A BST shines at **range queries**: list every key in `[lo, hi]`. The naive approach (full inorder, filter) costs O(n). The pruned approach costs `O(k + h)` where `k` is the number of matches.

The trick: at each node, decide whether to recurse into each child using the BST invariant.

**Python:**
```python
def find_in_range(root, lo, hi, out=None):
    if out is None:
        out = []
    if root is None:
        return out
    # Only descend left if there could be a key >= lo there
    if root.key > lo:
        find_in_range(root.left, lo, hi, out)
    if lo <= root.key <= hi:
        out.append(root.key)
    if root.key < hi:
        find_in_range(root.right, lo, hi, out)
    return out
```

**Go:**
```go
func FindInRange(root *Node, lo, hi int) []int {
    var out []int
    var rec func(*Node)
    rec = func(n *Node) {
        if n == nil { return }
        if n.Key > lo { rec(n.Left) }
        if n.Key >= lo && n.Key <= hi { out = append(out, n.Key) }
        if n.Key < hi { rec(n.Right) }
    }
    rec(root)
    return out
}
```

**Java:**
```java
public static void findInRange(BSTNode root, int lo, int hi, List<Integer> out) {
    if (root == null) return;
    if (root.key > lo)               findInRange(root.left,  lo, hi, out);
    if (root.key >= lo && root.key <= hi) out.add(root.key);
    if (root.key < hi)               findInRange(root.right, lo, hi, out);
}
```

**Why this is `O(k + h)`:** Every node visited either lies on the boundary path from the root to the lower or upper endpoint (`O(h)` total), or it is part of the output (contributes 1 to `k`). Subtrees outside the range are skipped entirely thanks to the pruning conditions. This style is used in interval trees, KD-trees, and many geometric data structures.

Time-series databases like **Prometheus** and **InfluxDB** perform analogous pruned range scans over their internal index structures — the BST invariant generalizes to "any tree where children's coordinate ranges partition the parent's range".

---

<a name="random"></a>
## 4. Randomized Insertion Order — Why Random Wins

Recall from `junior.md`: insertion order determines tree shape. **Random** insertion order yields expected height `Θ(log n)`.

The precise statement (Knuth TAOCP v3, §6.2.2, exercise 6, and Robson 1979): if you insert `n` distinct keys in **uniformly random** permutation, the expected internal path length is `2n H_n - 4n + O(log n)` where `H_n` is the n-th harmonic number, and the expected height is `Θ(log n)` with constant around `4.31107...`.

**Sedgewick's trick.** When you have all `n` keys up front and can pick the insertion order, **shuffle them** before inserting. This gives expected `O(n log n)` build time and expected `O(log n)` height. It is the simplest way to get a "probably balanced" BST without changing the tree code at all.

**Go:**
```go
import "math/rand"

func BuildRandomized(keys []int) *Node {
    shuffled := append([]int{}, keys...)
    rand.Shuffle(len(shuffled), func(i, j int) {
        shuffled[i], shuffled[j] = shuffled[j], shuffled[i]
    })
    var root *Node
    for _, k := range shuffled {
        root = Insert(root, k)
    }
    return root
}
```

**Python:**
```python
import random
def build_randomized(keys):
    keys = keys[:]
    random.shuffle(keys)
    root = None
    for k in keys:
        root = insert(root, k)
    return root
```

The catch is that **insertion-order randomization works only at build time**. If you keep inserting new keys at runtime (a long-lived BST), an adversary or just an unlucky workload can still skew the tree. For that, you need a randomized data structure that re-randomizes on every insertion: a treap.

---

<a name="treap"></a>
## 5. Treaps — Randomized BSTs in Practice

A **treap** (= tree + heap) is a BST that *also* maintains a max-heap on a **random priority** assigned to each node at insertion time. The shape of the tree is determined by the priorities (which are random), not by the order of insertion — so the tree is balanced *in expectation* regardless of how the keys arrive.

### The invariant

Each node carries `key` and `priority`. The structure satisfies **both**:

- BST invariant on `key`.
- Max-heap invariant on `priority`: every node's priority is `≥` its children's priorities.

### Insertion (sketch)

1. Insert the new node by key as you would in a vanilla BST (it becomes a leaf).
2. Now check the heap invariant. If the new node's priority is greater than its parent's, **rotate** it up. Keep rotating until either the priority property holds or the node becomes the root.

A **rotation** is a O(1) local restructure that preserves the BST invariant while moving a node up by one level. (Rotations are central to AVL/Red-Black — fully covered in `03-avl`.)

### Why treaps are balanced in expectation

Because priorities are random and uniformly distributed, the shape of the treap is the shape that would arise if you inserted the keys in priority order — i.e., a uniformly random insertion order. By the random-BST result, expected height is `O(log n)`.

### Treap-by-priority insertion (Python sketch)

```python
import random
class TreapNode:
    __slots__ = ("key", "prio", "left", "right")
    def __init__(self, key):
        self.key = key
        self.prio = random.random()
        self.left = self.right = None

def rotate_right(n):
    l = n.left
    n.left = l.right
    l.right = n
    return l

def rotate_left(n):
    r = n.right
    n.right = r.left
    r.left = n
    return r

def treap_insert(root, key):
    if root is None:
        return TreapNode(key)
    if key < root.key:
        root.left = treap_insert(root.left, key)
        if root.left.prio > root.prio:
            root = rotate_right(root)
    elif key > root.key:
        root.right = treap_insert(root.right, key)
        if root.right.prio > root.prio:
            root = rotate_left(root)
    return root
```

Expected `O(log n)` for insert/search/delete; constant factors comparable to red-black trees and much simpler to implement. Treaps are common in competitive programming and in some database internals (e.g., LMDB uses different structures, but the idea of priority-driven balance shows up). Detailed coverage is beyond this document — see Aragon & Seidel, "Randomized Search Trees" (Algorithmica 1996).

---

<a name="splay"></a>
## 6. Splay Trees — Self-Adjusting BSTs (Sleator & Tarjan 1985)

A **splay tree** is a BST that, after every operation, performs a sequence of rotations to bring the most recently accessed node to the root. The idea was introduced by Daniel Sleator and Robert Tarjan in their 1985 paper "Self-Adjusting Binary Search Trees" (JACM 32(3)).

### Why this is interesting

Splay trees do **not** explicitly maintain any balance condition. They have no color bits, no balance factors, no priorities. After any individual operation, the tree can be wildly unbalanced. But across a *sequence* of operations, they guarantee:

- **Amortized O(log n)** per operation. Worst case for a single operation is O(n), but it cannot happen too often.
- **Working-set property.** Frequently accessed elements stay near the root, giving better-than-`log n` per access for skewed workloads. A splay tree implementing a "recently used" cache adapts to the access pattern automatically.

### The splay operation

When you access a node `x`, you splay it to the root via a sequence of three rotation patterns:

1. **Zig** — `x` is the child of the root. One rotation.
2. **Zig-zig** — `x` and its parent are both left children (or both right). Rotate parent first, then `x`.
3. **Zig-zag** — `x` and its parent are opposite children. Rotate `x` twice.

We won't implement splay here — it is a topic in its own right (often covered alongside Tango trees and other competitive analysis structures). The pedagogical takeaway is that BST-with-rotations supports **adaptive balance** through purely local rules.

Splay trees are used in **Linux's old anticipatory scheduler** (now retired), some implementations of **GLib's caches**, **WindowMaker**, and various memory allocators. They are a great example of "amortized analysis pays off" in the real world.

---

<a name="verify"></a>
## 7. BST Verification — The Min/Max Bound Approach

> *The single most common BST interview mistake.*

**Naive (WRONG) verification:**

```python
def is_bst_WRONG(root):
    if root is None: return True
    if root.left  and root.left.key  >= root.key: return False
    if root.right and root.right.key <= root.key: return False
    return is_bst_WRONG(root.left) and is_bst_WRONG(root.right)
```

This passes the tree

```
    10
   /  \
  5    15
      /  \
     6    20      <-- 6 < 10, violates BST invariant globally
```

because each individual node passes the local check (`6 < 15`, fine; `15 > 10`, fine), but the **6 is in the right subtree of 10** — globally illegal.

### Correct approach 1: min/max bounds

Pass down the valid range for each subtree:

**Python:**
```python
import math
def is_bst(root, lo=-math.inf, hi=math.inf):
    if root is None:
        return True
    if not (lo < root.key < hi):
        return False
    return (is_bst(root.left,  lo, root.key) and
            is_bst(root.right, root.key, hi))
```

**Go:**
```go
import "math"

func IsBST(root *Node) bool {
    var rec func(n *Node, lo, hi float64) bool
    rec = func(n *Node, lo, hi float64) bool {
        if n == nil { return true }
        k := float64(n.Key)
        if k <= lo || k >= hi { return false }
        return rec(n.Left, lo, k) && rec(n.Right, k, hi)
    }
    return rec(root, math.Inf(-1), math.Inf(1))
}
```

**Java:**
```java
public static boolean isBST(BSTNode root) {
    return helper(root, Long.MIN_VALUE, Long.MAX_VALUE);
}
private static boolean helper(BSTNode n, long lo, long hi) {
    if (n == null) return true;
    if (n.key <= lo || n.key >= hi) return false;
    return helper(n.left,  lo, n.key) &&
           helper(n.right, n.key, hi);
}
```

Subtle point: the bounds are **open intervals** for a strict BST (no duplicates). If you allow equal keys on one side, switch one comparison to `<=` consistently. **Use `long` (Java) or `float64 infinity` (Go) for the bounds** to handle nodes with the maximum integer key — using `Integer.MIN_VALUE`/`MAX_VALUE` as sentinels causes false negatives if a node's key equals them. This was a famous gotcha in early LC 98 solutions.

### Correct approach 2: inorder traversal

Run inorder traversal; verify the sequence is strictly increasing.

```python
def is_bst_inorder(root):
    prev = [-math.inf]      # mutable container so the nested function can update it
    def rec(n):
        if n is None: return True
        if not rec(n.left): return False
        if n.key <= prev[0]: return False
        prev[0] = n.key
        return rec(n.right)
    return rec(root)
```

Both approaches are O(n). Choose by taste; the min/max approach is easier to reason about for deeply nested counterexamples.

---

<a name="dll"></a>
## 8. Convert BST to Sorted Doubly Linked List In-Place

Reinterpret each node's `left` as `prev` and `right` as `next`. The result is a sorted doubly linked list using the **same memory** — no new allocations.

The trick is a stateful inorder traversal that, at each `visit`, wires the current node into the tail of the list under construction.

**Python:**
```python
def bst_to_dll(root):
    """Return the head of a sorted doubly linked list using the BST's nodes.
       After the call, .left = prev, .right = next."""
    head = [None]
    prev = [None]
    def visit(n):
        if n is None: return
        visit(n.left)
        if prev[0] is None:
            head[0] = n
        else:
            prev[0].right = n
            n.left = prev[0]
        prev[0] = n
        visit(n.right)
    visit(root)
    return head[0]
```

**Go:**
```go
func BSTToDLL(root *Node) *Node {
    var head, prev *Node
    var visit func(*Node)
    visit = func(n *Node) {
        if n == nil { return }
        visit(n.Left)
        if prev == nil {
            head = n
        } else {
            prev.Right = n
            n.Left = prev
        }
        prev = n
        visit(n.Right)
    }
    visit(root)
    return head
}
```

**Java:**
```java
public static BSTNode bstToDLL(BSTNode root) {
    BSTNode[] state = {null, null};   // state[0] = head, state[1] = prev
    visit(root, state);
    return state[0];
}
private static void visit(BSTNode n, BSTNode[] state) {
    if (n == null) return;
    visit(n.left, state);
    if (state[1] == null) state[0] = n;
    else { state[1].right = n; n.left = state[1]; }
    state[1] = n;
    visit(n.right, state);
}
```

To make it **circular**, add one more step at the end: `prev.right = head; head.left = prev`.

This problem appears as LC 426 ("Convert Binary Search Tree to Sorted Doubly Linked List"). Time O(n), space O(h) for the stack. The trick — repurposing existing pointers rather than allocating — is a recurring pattern in low-level data-structure code (memory allocators, garbage collectors, in-place sort implementations).

---

<a name="balanced-from-sorted"></a>
## 9. Build a Balanced BST from a Sorted Array

If you have `n` sorted keys, you can build a perfectly balanced BST in `O(n)` time by recursively picking the middle as the root.

**Python:**
```python
def sorted_array_to_bst(arr, lo=0, hi=None):
    if hi is None: hi = len(arr) - 1
    if lo > hi: return None
    mid = (lo + hi) // 2
    root = Node(arr[mid])
    root.left  = sorted_array_to_bst(arr, lo, mid - 1)
    root.right = sorted_array_to_bst(arr, mid + 1, hi)
    return root
```

**Go:**
```go
func SortedArrayToBST(arr []int) *Node {
    var rec func(lo, hi int) *Node
    rec = func(lo, hi int) *Node {
        if lo > hi { return nil }
        mid := lo + (hi-lo)/2
        return &Node{Key: arr[mid], Left: rec(lo, mid-1), Right: rec(mid+1, hi)}
    }
    return rec(0, len(arr)-1)
}
```

**Java:**
```java
public static BSTNode sortedArrayToBST(int[] arr) {
    return rec(arr, 0, arr.length - 1);
}
private static BSTNode rec(int[] arr, int lo, int hi) {
    if (lo > hi) return null;
    int mid = lo + (hi - lo) / 2;
    BSTNode n = new BSTNode(arr[mid]);
    n.left  = rec(arr, lo, mid - 1);
    n.right = rec(arr, mid + 1, hi);
    return n;
}
```

The resulting tree has height `⌈log₂(n+1)⌉` — optimally balanced.

This is the standard approach for **rebuilding a degenerate BST**: inorder-traverse it into a sorted array, then sorted-array-to-BST. Total work O(n). Some libraries use this as a periodic "compaction" step instead of maintaining balance after every operation. See LC 1382 (Balance a BST) in `interview.md`.

---

<a name="why-rare"></a>
## 10. Why Standalone BSTs Are Rare in Production

If random insertion gives expected O(log n) height, why are vanilla BSTs essentially never used in production?

**1. Inputs are rarely uniformly random.** Real workloads insert timestamps (monotonic), IDs (often monotonic), sorted user data, etc. Adversarial inputs can degrade the tree on purpose — there is published work on hash-table DoS attacks; the BST equivalent is "send sorted keys, watch the server's O(log n) suddenly become O(n)".

**2. The skew is invisible until it hurts.** A BST that has slowly degraded over months of operation looks identical from the API surface. The first symptom is a tail-latency cliff. Detecting this requires monitoring tree height, which most teams don't bother with — they just use a balanced tree from day one.

**3. Hibbard deletion drift.** Repeated deletions using the inorder successor (or predecessor) algorithm slowly skew the tree even if insertions are random. Knuth's TAOCP section §6.2.2 has the analysis.

**4. Balanced trees are barely more complex.** Red-Black trees add color bits and rotations on top of the same BST code you already wrote. Java's `TreeMap` is ~2000 lines of source; the BST core is the same algorithm you write in `junior.md`, plus rotations.

**5. Cache performance is bad either way.** Both balanced and unbalanced BSTs jump around memory. If you're going to take the cache-miss hit, you want the asymptotic guarantee.

**6. Modern alternatives win for typical workloads.**
   - **Sorted array + binary search** wins for read-mostly data: contiguous memory, predictable layout, no per-node overhead.
   - **Hash table** wins for exact-match lookups: O(1) average without ordering.
   - **B-tree / B+-tree** wins for disk-resident data: fanout flattens the height, page-aligned nodes amortize the seek cost. Almost every database uses B-trees, not BSTs.
   - **Skip list** is sometimes preferred over BSTs for ease of concurrent implementation (Java's `ConcurrentSkipListMap`).

The bottom line: a vanilla BST is a **teaching structure**. It exists in your code only if you are studying, or implementing one of the balanced variants (AVL, Red-Black, treap, splay) from it as a starting point. Reach for `TreeMap`, `std::map`, `sortedcontainers.SortedDict`, or `slices.SortedFunc` in production.

The next document, `senior.md`, surveys what production libraries and OS kernels actually use BSTs (in their balanced forms) for.

---

## Further Reading

- **Sleator & Tarjan.** "Self-Adjusting Binary Search Trees." JACM 32(3), 1985. The splay-tree paper.
- **Aragon & Seidel.** "Randomized Search Trees." Algorithmica 16, 1996. The original treap paper.
- **Knuth.** TAOCP Vol. 3, §6.2.2, especially exercises 6 and 23 on expected path length and Hibbard-deletion asymmetry.
- **Robson, J. M.** "The Height of Binary Search Trees." Australian Computer Journal 11(4), 1979.
- **CLRS** 4th ed. Chapter 12 (BST), Chapter 13 (Red-Black). The expected-height proof for random insertion is exercise 12.4.
- Continue to `senior.md` for production BST applications and the BST-vs-array cache analysis.
