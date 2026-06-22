# 2-3-4 Tree — Interview Questions

> **Audience:** Candidates preparing for SDE/SDE-II/senior interviews where balanced-search-tree internals come up — and *especially* anyone who has been asked the marquee senior question, "explain how a red-black tree *really* works." The 2-3-4 tree is the structure a red-black tree secretly *is*, so it is the single most leverage-rich tree to understand cold. Prerequisite: `junior.md` for the top-down split insert; `middle.md` for delete and the red-black equivalence.

A 2-3-4 tree is a **B-tree of order 4**: every node is a **2-node** (1 key, 2 children), a **3-node** (2 keys, 3 children), or a **4-node** (3 keys, 4 children), and *every leaf sits at exactly the same depth*. The one distinctive twist versus the 2-3 tree is the **top-down preemptive split**: on the way *down* during an insert, you split every full 4-node you pass through, so the leaf you finally reach always has room — and a split never has to cascade back *up*. That single design choice is what makes the 2-3-4 tree map so cleanly onto a red-black tree's color flips.

This file walks through graded questions — Conceptual, Mechanics, Coding, and Comparison — with strong model answers, Go and Python reference code, and difficulty tags. Trace the code; every line is meant to run.

---

## Table of Contents

**Conceptual**
1. [What is a 2-3-4 tree? (Easy)](#q1)
2. [The equal-depth invariant and height bounds (Easy)](#q2)
3. [Why does top-down preemptive splitting guarantee no upward cascade? (Medium)](#q3)
4. [The red-black isomorphism — the marquee question (Hard)](#q4)
5. [Why are red-black trees non-unique while 2-3-4 trees are unique? (Hard)](#q5)

**Mechanics**
6. [Trace a top-down insertion with a preemptive split (Medium)](#q6)
7. [Trace a top-down deletion: borrow, fuse, root collapse (Hard)](#q7)

**Coding**
8. [Implement search and top-down insert (Medium)](#q8)
9. [Implement delete or an invariant checker (Hard)](#q9)

**Comparison & Trade-offs**
10. [2-3-4 vs red-black vs 2-3 vs AVL vs B-tree (Medium)](#q10)
11. [Why does production code ship red-black instead of literal 2-3-4? (Medium)](#q11)

**Wrap-up**
12. [Edge cases & gotchas](#edge)
13. [Rapid-fire Q&A](#rapid)
14. [Common mistakes](#mistakes)
15. [Tips & summary](#tips)

---

<a name="q1"></a>
## 1. What is a 2-3-4 tree? — *Easy*

**Model answer.**

A 2-3-4 tree is a perfectly height-balanced search tree built from three kinds of internal nodes:

- A **2-node** holds **one key** and has **two children** — the ordinary BST node. Left subtree `< key`, right subtree `> key`.
- A **3-node** holds **two keys** `a < b` and has **three children**: `< a`, `(a, b)`, `> b`.
- A **4-node** holds **three keys** `a < b < c` and has **four children**: `< a`, `(a, b)`, `(b, c)`, `> c`.

The defining invariant is that **all leaves are at the same depth** — there are no null-child shortcuts, so every root-to-leaf path has identical length. Because the tree can never get lopsided, search, insert, and delete are all O(log n) worst case, with no rotations and no balance factors.

It is exactly a **B-tree of order 4** (minimum degree `t = 2`): each node holds between `t-1 = 1` and `2t-1 = 3` keys. The 2-3 tree caps one key earlier (at 3-nodes); the 2-3-4 tree's extra node type — the 4-node — is precisely what lets it use the *top-down* insertion strategy that makes it isomorphic to a red-black tree.

**Follow-up — "What's the single most important difference from a 2-3 tree?"** The 2-3-4 tree allows 4-nodes, and it splits them **preemptively on the way down** rather than reactively bubbling overflow back up. That eliminates the upward cascade and is the whole reason it maps onto red-black color flips so cleanly ([Q3](#q3), [Q4](#q4)). See `../18-two-three-tree/interview.md`.

---

<a name="q2"></a>
## 2. The equal-depth invariant and height bounds — *Easy*

**Model answer.**

State the invariant precisely:

> Every path from the root to any leaf passes through exactly the same number of nodes.

This is *structurally preserved*, not restored after the fact. New keys are absorbed into existing leaf nodes (a 2-node becomes a 3-node, a 3-node becomes a 4-node — no new level), and the tree only gets taller when the **root itself splits**, which pushes every leaf down by one level simultaneously. There is no way to lengthen one path without lengthening all of them.

**Height bounds.** Let `h` be the height (edges on a root-to-leaf path) and `n` the number of keys.

- **Maximum height (sparsest).** Tallest when every node is a 2-node — a perfect binary tree, `n = 2^(h+1) - 1`, giving `h ≤ log₂(n + 1) - 1 ≈ log₂ n`.
- **Minimum height (densest).** Shortest when every node is a 4-node, carrying 3 keys with 4 children — a complete quaternary tree. A complete 4-ary tree of height `h` has `(4^(h+1) - 1)/3` nodes, each with 3 keys, so `n = 4^(h+1) - 1`, giving `h ≥ log₄(n + 1) - 1 ≈ log₄ n`.

Putting it together:

```
log₄ n  ≤  h  ≤  log₂ n
```

Both ends are Θ(log n), so search/insert/delete are O(log n) worst case. Note the lower bound `log₄ n = ½ log₂ n` is *shorter* than the 2-3 tree's `log₃ n` densest case — packing three keys per node makes a denser tree.

**Follow-up — "Comparisons per node?"** At most 3 (against all three keys of a 4-node), so total work is O(h) = O(log n) comparisons. Constant per level.

---

<a name="q3"></a>
## 3. Why does top-down preemptive splitting guarantee no upward cascade? — *Medium*

**Model answer.**

This is the conceptual heart of the 2-3-4 tree, so be ready to defend it.

**The strategy.** On a single root-to-leaf descent for an insert, *before* you step into any node, you check: is it a **4-node** (full)? If so, **split it immediately** — promote its middle key into the parent, leaving two 2-nodes. Only *then* do you descend.

**The key invariant this maintains:** when you arrive at any node during the descent, **its parent is never a 4-node**. Why? Because you split the parent before descending into it. So when *this* node splits, the middle key it pushes up always lands in a parent that has room (a 2-node or 3-node, never full). The promotion therefore *never overflows the parent* — there is nothing to cascade.

**Contrast with the 2-3 tree.** A 2-3 tree splits *reactively*: it descends to the leaf, inserts, and if the leaf overflows it bubbles a key *up*, which may overflow the parent, which bubbles up again — a cascade that can ripple all the way to the root on the way back up. The 2-3-4 tree pays a tiny bit extra on the way down (splitting some 4-nodes that might not have strictly needed it) to buy a guarantee: **the insert is a single top-down pass with no bottom-up phase**. That property is exactly what a red-black tree's top-down insert reproduces with color flips ([Q4](#q4)).

**The one special case.** If the **root** is a full 4-node when you start, split it first: it becomes three 2-nodes (a new 2-node root with two 2-node children), and the tree's height grows by one. This is the *only* way height increases — and, as in every B-tree, it happens at the root and lifts all leaves uniformly.

**One-line delivery:** "I split full 4-nodes on the way down, so every node I split has a parent with room — the promotion is absorbed locally and never cascades upward."

---

<a name="q4"></a>
## 4. The red-black isomorphism — the marquee question — *Hard*

**Model answer.**

This is *the* classic senior-level "do you actually understand red-black trees" question. The answer: **a red-black tree is a binary encoding of a 2-3-4 tree.** Red links are the "internal glue" that binds the keys of a single multi-key node together; black links are the real B-tree edges.

**The mapping.** Take a 2-3-4 node and represent it as a small cluster of binary nodes joined by **red** links; the links *leaving* the cluster are **black**:

- A **2-node** (1 key) → a single **black** node. No red links.
- A **3-node** (2 keys `a < b`) → two binary nodes joined by **one red** link: `b` black with a red child `a` (or the mirror). Three black links leave the cluster — its three children.
- A **4-node** (3 keys `a < b < c`) → `b` black with **two red children** `a` and `c`. Four black links leave — its four children.

Now translate the red-black properties directly:

- **"No red node has a red child."** A red-red chain would glue three keys into one cluster *plus another* — a 5-node, which a 2-3-4 tree forbids. So this property is *exactly* "no node holds more than 3 keys."
- **"Every root-to-leaf path has the same number of black nodes" (equal black-height).** Black links *are* the 2-3-4 tree edges, so equal black-height is *exactly* "all leaves at equal depth in the 2-3-4 tree."

So a red-black tree's two structural invariants are literally the 2-3-4 tree's two invariants, viewed through the encoding.

**Why a 4-node split = a color flip.** Here is the part that makes interviewers nod. In the encoding, a **full 4-node** is a black node `b` with **two red children** `a` and `c`. The 2-3-4 top-down algorithm says: split this 4-node — promote `b` into the parent, leaving `a` and `c` as independent 2-nodes.

In the red-black encoding, "promote `b`" means: make `b` **red** (it joins its parent's cluster) and make its two children `a` and `c` **black** (they become independent 2-nodes). That is precisely the red-black **color flip**: flip `b` red, flip both children black. No data moves, no rotation happens — just three recolorings. The 4-node split *is* the color flip.

After the flip, `b` being red may collide with a red parent (a red-red violation) — which corresponds exactly to "the promoted key landed in a node that is now over-full and must itself be fixed." The red-black tree resolves *that* with **rotations**, which correspond to the 2-3-4 tree rearranging keys within and between clusters to keep them validly shaped. (In a strict top-down 2-3-4 insert the parent was guaranteed not full, so the analogous red-black insert splits 4-nodes top-down too and the rotation is local.)

**One-sentence delivery:** "Red links glue keys into a B-tree node, black links form the B-tree skeleton, a full 4-node is a black node with two red children, and splitting it — promoting the middle key — is exactly the color flip that turns the middle node red and its children black." See `../04-red-black/interview.md`.

---

<a name="q5"></a>
## 5. Why are red-black trees non-unique while 2-3-4 trees are unique? — *Hard*

**Model answer.**

This is the natural sharp follow-up to [Q4](#q4), and a strong discriminator between candidates who *memorized* the isomorphism and those who *understand* it.

**The fact.** For a given set of keys inserted in a given order, the 2-3-4 tree's shape is **fully determined** — there is exactly one valid tree. But the same keys can be stored in **several distinct valid red-black trees**. The isomorphism is therefore *not* a bijection: it is many-to-one. Several red-black trees collapse to the *same* 2-3-4 tree.

**The reason: the 3-node has two encodings.** Recall the mapping. A 2-node and a 4-node each have *one* red-black encoding:

- 2-node → a lone black node (no choice).
- 4-node → black node with two red children (no choice — both slots filled).

But a **3-node** `a < b` has **two** valid encodings, because the single red link can attach on *either* side:

```
  left-leaning              right-leaning
       b (black)                 a (black)
      /                            \
    a (red)                          b (red)
```

Both represent the identical 3-node `{a, b}` with the identical three children. A general red-black tree is free to choose either orientation independently at every 3-node — so a 2-3-4 tree with `k` 3-nodes corresponds to up to `2^k` distinct valid red-black trees. That ambiguity is exactly why red-black trees are **non-unique**.

**The flip side — making red-black unique again.** If you *forbid* one of the two orientations — say, require every red link to lean **left** — you collapse the ambiguity and recover a one-to-one encoding. That constraint is the **left-leaning red-black (LLRB)** tree. But notice: LLRB forbids a node from having two red children in the *general* arrangement and, in Sedgewick's standard formulation, encodes a **2-3 tree** (no 4-nodes), not a 2-3-4 tree. The lesson to deliver: *the non-uniqueness lives entirely in the 3-node's two orientations; pin the orientation down and you get a canonical encoding.*

**One-sentence delivery:** "A 2-node and a 4-node each encode one way, but a 3-node's single red link can lean left or right, so each 3-node doubles the number of valid red-black trees — pin the lean and the encoding becomes unique." See `../18-two-three-tree/interview.md` for the 2-3 / LLRB side.

---

<a name="q6"></a>
## 6. Trace a top-down insertion with a preemptive split — *Medium*

**Model answer.**

The whole point of the trace is to show the **split-on-the-way-down** discipline. Whenever the descent reaches a full 4-node, split it *first*, then continue.

**Concrete trace.** Begin with this 2-3-4 tree (all leaves at depth 1):

```
              [10 | 20 | 30]
             /    |    |    \
          [5]  [15]  [25]  [40 | 50]
```

The root is a full **4-node**. Insert **`45`**.

**Step 1 — split the root preemptively.** Before descending into a full root 4-node, split it. Middle key `20` rises to become a new root; `10` and `30` become its two children, splitting the four old children between them:

```
                    [20]
                   /    \
              [10]      [30]
             /    \    /    \
          [5]   [15] [25]  [40 | 50]
```

Height grew from 1 to 2 — and all leaves are still level. Now descend for `45`: `45 > 20` → right; `45 > 30` → right child `[40 | 50]`.

**Step 2 — reach the leaf, which has room.** `[40 | 50]` is a 3-node — not full, no split needed. Insert `45` between them → `[40 | 45 | 50]`:

```
                    [20]
                   /    \
              [10]      [30]
             /    \    /    \
          [5]   [15] [25]  [40 | 45 | 50]
```

Now insert **`48`**. Descend: `48 > 20` → right; `48 > 30` → right child `[40 | 45 | 50]` — a full **4-node** on the path. **Split it on the way down**: middle key `45` rises into the parent `[30]`, making it `[30 | 45]`; the leaf splits into `[40]` and `[50]`:

```
                    [20]
                   /    \
              [10]    [30 | 45]
             /    \   /   |    \
          [5]  [15] [25] [40]  [50]
```

Now finish descending for `48`: `48 > 45` → rightmost child `[50]`. Insert → `[48 | 50]`:

```
                    [20]
                   /    \
              [10]    [30 | 45]
             /    \   /   |    \
          [5]  [15] [25] [40]  [48 | 50]
```

**Talking points:** "The root was a 4-node so I split it preemptively, growing the tree by a level uniformly. When I later hit the full `[40|45|50]` leaf-side node on my way down, I split it *before* inserting — the promoted `45` landed in a parent that had room, so nothing cascaded back up. One clean top-down pass."

---

<a name="q7"></a>
## 7. Trace a top-down deletion: borrow, fuse, root collapse — *Hard*

**Model answer.**

Deletion is the hard direction in every balanced tree. The 2-3-4 tree uses a **top-down** delete that mirrors the insert's spirit: on the way *down* you ensure the child you are about to enter is **not a bare 2-node** (1 key), by **borrowing** from a sibling or **fusing**, so that when you finally remove a key from a leaf, it always has a spare. This avoids a bottom-up underflow cascade, just as preemptive splitting avoids an upward overflow cascade.

**The protocol.**

1. **Descend, keeping the current node "fat."** Before stepping into a child that is a 2-node, enrich it:
   - **Borrow (rotate)** — if an *adjacent sibling* is a 3- or 4-node (has a spare key): rotate a key through the parent. The parent's separating key drops into the thin child; the sibling's adjacent key (plus a child pointer) rises to replace the separator.
   - **Fuse (merge)** — if *every* adjacent sibling is also a 2-node: pull the parent's separating key *down* and merge the thin child + separator + sibling into a single **4-node**.
2. **Reduce to a leaf deletion.** If the key lives in an internal node, swap it with its in-order **predecessor** (largest key in the left subtree — always in a leaf) or successor, then delete from the leaf.
3. **Remove from the leaf.** Because the top-down enrichment guaranteed the leaf is *not* a bare 2-node, removing one key always leaves at least one behind — no underflow.
4. **Root collapse.** If a fuse at the top empties the root (it had one key and donated it), the merged child becomes the new root; the tree loses a level.

**Concrete trace.** Take the tree from [Q6](#q6):

```
                    [20]
                   /    \
              [10]    [30 | 45]
             /    \   /   |    \
          [5]  [15] [25] [40]  [48 | 50]
```

Delete **`5`**. Descend from root `[20]` toward the left child `[10]` — but `[10]` is a bare 2-node, so enrich it first. Its adjacent sibling is `[30 | 45]`, a 3-node with a spare. **Borrow** across the root: the root separator `20` drops into `[10]` making it `[10 | 20]`, and the sibling's smallest key `30` rises to become the new root separator. The sibling's leftmost child `[25]` moves over to become `[10|20]`'s new rightmost child:

```
                    [30]
                   /    \
            [10 | 20]    [45]
           /   |    \    /   \
        [5] [15] [25] [40]  [48 | 50]
```

Now `[10 | 20]` is fat. Descend into it for `5`: `5 < 10` → leftmost child `[5]`, a leaf. Remove `5`... but `[5]` is itself a bare 2-node we are about to delete *from*, so before removing we ensure it has a spare. Its adjacent sibling `[15]` is also a 2-node — no borrow. **Fuse**: pull the separator `10` down and merge `[5]` + `10` + `[15]` into the 4-node `[5 | 10 | 15]`. That leaves `[10|20]` as `[20]`:

```
                    [30]
                   /    \
              [20]      [45]
             /    \     /   \
   [5 | 10 | 15] [25] [40]  [48 | 50]
```

Now remove `5` from the leaf `[5 | 10 | 15]` (a 4-node, plenty of spare) → `[10 | 15]`:

```
                    [30]
                   /    \
              [20]      [45]
             /    \     /   \
      [10 | 15] [25] [40]  [48 | 50]
```

Done — one top-down pass, with a borrow and a fuse, and no bottom-up cascade. (Had a fuse propagated all the way up and emptied a one-key root, we'd **collapse** it, dropping a level uniformly.)

**Contrast — root collapse.** If at some descent both the child *and* both its siblings are 2-nodes and the parent is the root holding a single key, fusing pulls the root's only key down into the merged 4-node, the root becomes keyless, and we promote the merged node as the new root — the tree shrinks by one level, all leaves staying level.

---

<a name="q8"></a>
## 8. Implement search and top-down insert — *Medium*

**Model answer.**

We represent a node with up to three keys and up to four children. Search is a multi-way descent. Insert is a **top-down** pass: at the root, split if it is full; then at each step, *before* descending into a child, split that child if it is a full 4-node — so promotions always land in a parent with room and never cascade.

**Python:**
```python
class Node:
    def __init__(self, keys=None, children=None):
        self.keys = keys or []          # 1..3 keys, sorted
        self.children = children or []  # 0 (leaf), or len(keys)+1

    def is_leaf(self):
        return not self.children

    def is_full(self):
        return len(self.keys) == 3      # a 4-node


class TwoThreeFourTree:
    def __init__(self):
        self.root = Node()

    def search(self, key):
        node = self.root
        while node is not None:
            i = 0
            while i < len(node.keys) and key > node.keys[i]:
                i += 1
            if i < len(node.keys) and node.keys[i] == key:
                return True
            if node.is_leaf():
                return False
            node = node.children[i]     # child i covers the gap before keys[i]
        return False

    def insert(self, key):
        root = self.root
        if root.is_full():              # split a full root → height grows
            new_root = Node(children=[root])
            self._split_child(new_root, 0)
            self.root = new_root
        self._insert_nonfull(self.root, key)

    def _split_child(self, parent, i):
        """Split parent.children[i], a full 4-node [a|b|c], promoting b into parent."""
        full = parent.children[i]
        a, b, c = full.keys
        left = Node(keys=[a])
        right = Node(keys=[c])
        if not full.is_leaf():          # distribute the four children 2/2
            left.children = full.children[0:2]
            right.children = full.children[2:4]
        parent.keys.insert(i, b)        # promote middle key
        parent.children[i:i+1] = [left, right]

    def _insert_nonfull(self, node, key):
        if node.is_leaf():
            # node is guaranteed not full here (caller split it if needed)
            i = 0
            while i < len(node.keys) and key > node.keys[i]:
                i += 1
            if i < len(node.keys) and node.keys[i] == key:
                return              # ignore duplicates
            node.keys.insert(i, key)
            return
        i = 0
        while i < len(node.keys) and key > node.keys[i]:
            i += 1
        if i < len(node.keys) and node.keys[i] == key:
            return                  # duplicate
        if node.children[i].is_full():
            self._split_child(node, i)      # split on the way DOWN
            if key > node.keys[i]:          # promoted key may shift our path
                i += 1
        self._insert_nonfull(node.children[i], key)
```

**Go:**
```go
type Node struct {
    keys     []int
    children []*Node
}

func (n *Node) isLeaf() bool { return len(n.children) == 0 }
func (n *Node) isFull() bool { return len(n.keys) == 3 }

type Tree struct{ root *Node }

func NewTree() *Tree { return &Tree{root: &Node{}} }

func (t *Tree) Search(key int) bool {
    n := t.root
    for n != nil {
        i := 0
        for i < len(n.keys) && key > n.keys[i] {
            i++
        }
        if i < len(n.keys) && n.keys[i] == key {
            return true
        }
        if n.isLeaf() {
            return false
        }
        n = n.children[i]
    }
    return false
}

func (t *Tree) Insert(key int) {
    if t.root.isFull() {
        newRoot := &Node{children: []*Node{t.root}}
        splitChild(newRoot, 0)
        t.root = newRoot
    }
    insertNonfull(t.root, key)
}

// splitChild splits parent.children[i] = [a|b|c], promoting b into parent at i.
func splitChild(parent *Node, i int) {
    full := parent.children[i]
    a, b, c := full.keys[0], full.keys[1], full.keys[2]
    left := &Node{keys: []int{a}}
    right := &Node{keys: []int{c}}
    if !full.isLeaf() {
        left.children = append(left.children, full.children[0:2]...)
        right.children = append(right.children, full.children[2:4]...)
    }
    // insert b into parent.keys at i
    parent.keys = append(parent.keys, 0)
    copy(parent.keys[i+1:], parent.keys[i:])
    parent.keys[i] = b
    // replace children[i] with {left, right}
    nc := make([]*Node, 0, len(parent.children)+1)
    nc = append(nc, parent.children[:i]...)
    nc = append(nc, left, right)
    nc = append(nc, parent.children[i+1:]...)
    parent.children = nc
}

func insertNonfull(n *Node, key int) {
    i := 0
    for i < len(n.keys) && key > n.keys[i] {
        i++
    }
    if i < len(n.keys) && n.keys[i] == key {
        return // duplicate
    }
    if n.isLeaf() {
        n.keys = append(n.keys, 0)
        copy(n.keys[i+1:], n.keys[i:])
        n.keys[i] = key
        return
    }
    if n.children[i].isFull() {
        splitChild(n, i) // split on the way down
        if key > n.keys[i] {
            i++
        }
    }
    insertNonfull(n.children[i], key)
}
```

**Time:** O(log n) for both — one root-to-leaf descent with O(1) work per level. **Space:** O(log n) recursion for insert (or O(1) if you write the descent iteratively, which the top-down structure makes natural). Trace both on the [Q6](#q6) example to confirm the preemptive split of the full root and the on-the-way-down split of `[40|45|50]`.

> Note the elegance of top-down insert: because every full node on the path is split *before* you enter it, the recursion never has to return anything — there is no "bubble the median back up" return value as there is in the 2-3 tree's bottom-up insert (`../18-two-three-tree/interview.md`, Q8). That asymmetry is the coding fingerprint of the preemptive-split design.

---

<a name="q9"></a>
## 9. Implement delete or an invariant checker — *Hard*

**Model answer.**

Two flavors of "hard" coding question show up. The invariant checker is the higher-leverage one to have ready — it is shorter, it is what you reach for to *debug* a delete, and interviewers love it. Lead with it, then sketch delete.

A 2-3-4 tree is valid iff:

1. Every node has 1, 2, or 3 keys (a 2-, 3-, or 4-node). The root may transiently hold fewer only mid-operation.
2. Every internal node has exactly `len(keys) + 1` children; leaves have 0.
3. Keys within a node are strictly sorted.
4. Search-tree ordering holds across every separator (each child's keys fall in the correct gap).
5. **All leaves are at the same depth** — the invariant that *is* the balance guarantee.

The cleanest checker returns the uniform leaf depth of each subtree (or `-1` for invalid) and verifies all children of a node agree.

**Python:**
```python
def is_valid(self):
    return self._check(self.root, lo=None, hi=None) != -1

def _check(self, node, lo, hi):
    """Return uniform leaf depth of this subtree, or -1 if any invariant fails."""
    k = len(node.keys)
    if k < 1 or k > 3:
        if node is self.root and k == 0 and not node.children:
            return 0                                # empty tree is valid
        return -1                                   # invariant 1
    for i in range(1, k):
        if node.keys[i - 1] >= node.keys[i]:
            return -1                               # invariant 3 (strict sort)
    if (lo is not None and node.keys[0] <= lo) or \
       (hi is not None and node.keys[-1] >= hi):
        return -1                                   # invariant 4 (range bound)
    if node.is_leaf():
        return 0
    if len(node.children) != k + 1:
        return -1                                   # invariant 2
    depths = set()
    for i, child in enumerate(node.children):
        clo = lo if i == 0 else node.keys[i - 1]
        chi = hi if i == k else node.keys[i]
        d = self._check(child, clo, chi)
        if d == -1:
            return -1
        depths.add(d)
        if len(depths) > 1:
            return -1                               # invariant 5 (equal depth)
    return depths.pop() + 1
```

**Go:**
```go
func (t *Tree) IsValid() bool {
    return check(t.root, nil, nil) != -1
}

// lo/hi are *int; nil means "unbounded".
func check(n *Node, lo, hi *int) int {
    k := len(n.keys)
    if k < 1 || k > 3 {
        if len(n.children) == 0 && k == 0 {
            return 0 // empty tree
        }
        return -1
    }
    for i := 1; i < k; i++ {
        if n.keys[i-1] >= n.keys[i] {
            return -1
        }
    }
    if (lo != nil && n.keys[0] <= *lo) || (hi != nil && n.keys[k-1] >= *hi) {
        return -1
    }
    if n.isLeaf() {
        return 0
    }
    if len(n.children) != k+1 {
        return -1
    }
    depth := -1
    for i, c := range n.children {
        clo, chi := lo, hi
        if i > 0 {
            clo = &n.keys[i-1]
        }
        if i < k {
            chi = &n.keys[i]
        }
        d := check(c, clo, chi)
        if d == -1 {
            return -1
        }
        if depth == -1 {
            depth = d
        } else if depth != d {
            return -1
        }
    }
    return depth + 1
}
```

**Time:** O(n) — visits every node once. **Space:** O(log n) recursion.

**Delete sketch.** A top-down delete (see the [Q7](#q7) trace) is a descent that keeps the *current* node fat:

```python
def delete(self, key):
    self._delete(self.root, key)
    # root collapse: a keyless internal root promotes its single child
    if not self.root.keys and self.root.children:
        self.root = self.root.children[0]

def _delete(self, node, key):
    i = 0
    while i < len(node.keys) and key > node.keys[i]:
        i += 1
    found = i < len(node.keys) and node.keys[i] == key
    if node.is_leaf():
        if found:
            node.keys.pop(i)                    # guaranteed >=2 keys here, so safe
        return
    if found:
        # replace with in-order predecessor from child[i], then delete it there
        self._ensure_fat(node, i)               # may shift indices/structure
        # re-locate after possible fuse
        i = 0
        while i < len(node.keys) and key > node.keys[i]:
            i += 1
        if i < len(node.keys) and node.keys[i] == key:
            pred = self._max_key(node.children[i])
            node.keys[i] = pred
            self._delete(node.children[i], pred)
        else:
            self._delete(node.children[i], key) # fuse moved it down
    else:
        self._ensure_fat(node, i)               # enrich child[i] before descending
        i = min(i, len(node.keys))              # index may shift after a fuse
        # re-pick child after enrichment
        j = 0
        while j < len(node.keys) and key > node.keys[j]:
            j += 1
        self._delete(node.children[j], key)
```

`_ensure_fat(node, i)` is the borrow-or-fuse routine: if `children[i]` has only one key, borrow from an adjacent 3-/4-node sibling (drop the parent separator in, lift the sibling's key + child out), else fuse `children[i]` + separator + a sibling into a 4-node. `_max_key` walks rightmost to the leaf. The single most error-prone part — as in every B-tree delete — is **moving the orphaned child pointer** during a borrow or fuse on internal nodes; forget it and you corrupt the subtree silently. Always run the invariant checker after a randomized sequence of deletes; it catches the bug immediately via an unequal-depth or range violation.

**Time:** O(log n) for delete — one descent, O(1) repair per level. **Space:** O(log n).

---

<a name="q10"></a>
## 10. 2-3-4 vs red-black vs 2-3 vs AVL vs B-tree — when does each win? — *Medium*

**Model answer.**

| Property | 2-3-4 tree | Red-black | 2-3 tree | AVL | B-tree (order ≫ 4) |
|---|---|---|---|---|---|
| Worst-case height | `log₂ n` | `2 log₂ n` | `log₂ n` | `1.44 log₂ n` | `log_t n` (very shallow) |
| Balance mechanism | top-down split / borrow / fuse | rotations + recolor | bottom-up split / merge | rotations + balance factor | split / merge nodes |
| Insert cascade | none (top-down preempt) | local fixup | can cascade up | rotations propagate | batched |
| Node shape | variable arity (2/3/4) | uniform binary + color bit | variable arity (2/3) | uniform binary + balance int | wide variable arity |
| Implementation effort | conceptually clean; awkward variable-arity node | hard delete, but uniform nodes | simplest model | moderate | well-trodden but heavy |
| Cache / disk fit | poor (small nodes, pointer chasing) | poor | poor | poor | **excellent** (one I/O per level) |

**When each wins:**

- **AVL** — read-heavy in-memory workloads where lookups dominate. Strictest balance (`1.44 log n`) → shortest trees → fastest searches. Pays with more rotations on writes. See `../03-avl/interview.md`.
- **Red-black** — write-mixed in-memory workloads and the default for standard libraries (`std::map`, Java `TreeMap`, the Linux CFS scheduler). Looser balance → fewer rotations per update. The production-grade *binary encoding* of a 2-3-4 tree. See `../04-red-black/interview.md`.
- **2-3-4 tree** — almost never the production choice *directly*; its value is **conceptual** (the model behind red-black) and as a teaching device for the top-down split. The "literal" 2-3-4 tree is implemented as a red-black tree in practice ([Q11](#q11)).
- **2-3 tree** — the even simpler model (no 4-nodes); its clean binary encoding is the LLRB / AA tree. See `../18-two-three-tree/interview.md`.
- **B-tree / B+ tree** — anything backed by disk or large enough that cache misses dominate (databases, filesystems). Wide nodes amortize each pointer dereference (= page read) across hundreds of keys. The 2-3-4 tree is literally a B-tree of order 4 — just too narrow to pay off on disk. See `../11-b-tree/interview.md`.

**The crisp summary:** "In memory, AVL for read-heavy, red-black for write-heavy; on disk, a wide B-tree; the 2-3-4 tree is the order-4 B-tree that explains *why* a red-black tree is balanced — and it ships *as* a red-black tree."

---

<a name="q11"></a>
## 11. Why does production code ship red-black instead of literal 2-3-4? — *Medium*

**Model answer.**

The 2-3-4 tree and the red-black tree are *the same algorithm* viewed two ways ([Q4](#q4)), so the choice is purely about representation cost. Red-black wins on every practical axis for an **in-memory** container:

1. **Uniform node layout.** A red-black node always has exactly two child pointers, one key (one value), and one color **bit** (usually stolen from pointer alignment, so effectively free). A literal 2-3-4 node has *variable arity*: 1–3 keys and 2–4 children, forcing either a fixed-size 3-key/4-child node (wasting ~⅔ of the slots in the common 2-node case) or dynamically sized slices (an allocation and an indirection per node). Uniform binary nodes are smaller, simpler to allocate, and friendlier to a slab/arena allocator.

2. **No special-casing on node arity in the hot path.** Search and insert in a red-black tree branch on a single comparison and a color check. A literal 2-3-4 search must, at each node, figure out whether it is a 2-, 3-, or 4-node and run a 1-, 2-, or 3-way comparison — more branches, worse for the branch predictor.

3. **Rotations are cheaper than node restructuring.** Splitting/fusing a variable-arity node means shuffling key and child *arrays* (memmoves). A red-black rotation just repoints a handful of pointers. The color flip ([Q4](#q4)) replaces the split with three bit writes.

4. **Same asymptotics, same guarantees.** Both are Θ(log n) height, both O(log n) per operation. You give up nothing in big-O by encoding the 2-3-4 tree as red-black — you only gain a tighter, more cache-friendly memory layout.

So nobody ships a literal 2-3-4 tree as a general-purpose ordered map: they ship the red-black encoding, which *is* a 2-3-4 tree with a better memory representation and pointer-only rebalancing. The 2-3-4 tree earns its keep purely as the **mental model** that makes red-black insert/delete comprehensible.

**Where the variable-arity node *does* win:** on **disk**, where you want each node to fill a page and hold *hundreds* of keys to minimize I/Os — that is the B-tree, and there the wide variable-arity node is exactly right (`../11-b-tree/interview.md`). The 2-3-4 tree is just the order-4 special case, too narrow to benefit from page-sized nodes.

---

<a name="edge"></a>
## 12. Edge cases & gotchas

- **Empty tree.** `search` returns false, `delete` is a no-op, first `insert` lands the key in the (empty) root leaf. Decide whether the root starts as an empty node or `nil` and handle it consistently.
- **Splitting a full root.** This is the *only* place height grows. Always check the root for fullness *before* the descent and split it into a fresh 3-node-of-2-nodes if needed; forgetting this breaks the "parent always has room" invariant immediately.
- **Promote the *middle* key on split.** Splitting `[a|b|c]` always promotes `b`. Promoting `a` or `c` breaks ordering. (And the children split 2/2: `{c0,c1}` go left, `{c2,c3}` go right.)
- **Index shift after a split.** After `splitChild(node, i)` the promoted key sits at `node.keys[i]`; if the search key is greater than it, your path moves to `children[i+1]`. Forgetting the `if key > node.keys[i]: i += 1` adjustment sends the key down the wrong subtree.
- **Duplicate insert.** Decide the policy up front (ignore / count / overwrite). The reference code ignores duplicates by checking equality during descent. State your choice.
- **Deleting an internal key.** You cannot remove it directly — swap with the in-order predecessor (or successor), which always lives in a leaf, then delete from the leaf.
- **Borrow/fuse drops a child pointer.** When you rotate or merge on internal nodes, the donated/absorbed key brings a *child pointer* that must move with it. Forgetting it corrupts the subtree with no immediate crash — only the invariant checker catches it.
- **Root collapse on delete.** A fuse that empties a single-key root must promote the merged child as the new root, shrinking the tree by a level. Skipping it leaves a useless keyless root.
- **Confusing 2-3-4 with 2-3.** A 2-3 tree has *no* 4-nodes and uses bottom-up (reactive) splitting; the 2-3-4 tree adds 4-nodes and splits top-down (preemptively). Mixing the two models is a classic stumble (`../18-two-three-tree/interview.md`).

---

<a name="rapid"></a>
## 13. Rapid-fire Q&A

**Q: What B-tree is a 2-3-4 tree?** A: Order 4 (minimum degree `t = 2`); each node holds 1–3 keys.

**Q: When does height increase?** A: Only when the root is split (a full root 4-node), uniformly lifting all leaves.

**Q: When does height decrease?** A: Only when a fuse empties a single-key root and it collapses.

**Q: Why split on the way *down*?** A: So every node you split has a non-full parent — the promoted key is absorbed locally, never cascading up.

**Q: A 4-node split corresponds to which red-black operation?** A: A color flip — middle node turns red, its two children turn black.

**Q: Why are red-black trees non-unique?** A: A 3-node's single red link can lean left or right; each 3-node doubles the number of valid encodings.

**Q: How do you make the red-black encoding unique?** A: Forbid one lean — e.g. left-leaning red-black (which encodes a 2-3 tree).

**Q: Max keys / children per node?** A: 3 keys, 4 children (a 4-node).

**Q: Height range?** A: `log₄ n ≤ h ≤ log₂ n`, so Θ(log n).

**Q: Does it use rotations?** A: No — balance comes from split/borrow/fuse. (Its red-black *encoding* uses rotations to mimic those.)

**Q: Why ship red-black instead of literal 2-3-4?** A: Uniform binary nodes + a single color bit are smaller, more cache-friendly, and rebalance with pointer rotations instead of array shuffles — same big-O, better constants.

**Q: Predecessor of an internal key — where?** A: Rightmost key of the leftmost-descending path from that key's left child; always a leaf.

---

<a name="mistakes"></a>
## 14. Common mistakes

1. **Splitting reactively (bottom-up) instead of preemptively (top-down).** That is the 2-3 tree's strategy; the 2-3-4 tree splits full 4-nodes *on the descent*, which is what kills the cascade and matches red-black color flips.
2. **Forgetting to split a full root before descending.** The "parent always has room" guarantee depends on it.
3. **Promoting the wrong key on a split.** Always the **middle** key rises; the children split 2/2.
4. **Not adjusting the child index after an on-the-way-down split.** If the promoted key is less than the search key, the path shifts to the next child.
5. **Claiming red-black trees are unique.** They are not — the 3-node's two orientations make the encoding many-to-one ([Q5](#q5)).
6. **Saying a 4-node split is a rotation.** It is a **color flip** (recoloring); rotations handle the *resulting* red-red collision, not the split itself.
7. **Deleting an internal key directly** instead of swapping with a leaf predecessor/successor first.
8. **Losing the orphaned child pointer** during a borrow or fuse on internal nodes.
9. **Forgetting the root collapse** after a fuse empties the root.
10. **Confusing "isomorphic" with "identical."** A red-black tree *encodes* a 2-3-4 tree; it stores the same keys with the same ordering and balance guarantees, but in a binary shape with color bits.

---

<a name="tips"></a>
## 15. Tips & summary

**How interviewers actually use the 2-3-4 tree:**

- As the **answer to "how does a red-black tree really work?"** — the highest-leverage thing to know. A red-black tree *is* a 2-3-4 tree encoded in binary; a 4-node split *is* a color flip ([Q4](#q4)). Deliver this crisply and you have demonstrated real understanding, not memorized cases.
- As the setup for the **uniqueness follow-up** — "why are red-black trees non-unique?" → because a 3-node has two encodings ([Q5](#q5)). This separates the candidates who *get* the isomorphism from those who recited it.
- As a **teaching device** for top-down balancing — preemptive splitting is conceptually cleaner than bottom-up cascades ([Q3](#q3)).
- Occasionally as a **full implementation** (search + top-down insert, [Q8](#q8); rarely delete, [Q9](#q9)) at companies that build their own ordered containers or storage engines.

**The four things to nail:**

1. **The equal-depth invariant + top-down preemptive split** — *this* is why there is no upward cascade ([Q2](#q2), [Q3](#q3)).
2. **The red-black isomorphism** — the mapping, and *why a 4-node split equals a color flip* ([Q4](#q4)). Highest leverage.
3. **The non-uniqueness reason** — the 3-node's two orientations ([Q5](#q5)).
4. **The trade-off** — why production ships red-black, not literal 2-3-4 ([Q11](#q11)).

If you can draw the [Q6](#q6) root-split-then-on-the-way-down split, hand-trace the [Q7](#q7) borrow/fuse/collapse delete, and explain the red-black isomorphism *including* the color-flip-equals-split insight and the 3-node non-uniqueness, you have covered everything a 2-3-4-tree interview question is likely to probe.

**Cross-references:**
- 2-3 tree (the no-4-node model; bottom-up splits): `../18-two-three-tree/interview.md`
- Red-black (the production binary encoding of this tree): `../04-red-black/interview.md`
- B-tree (the disk-oriented generalization; this is the order-4 case): `../11-b-tree/interview.md`
- AVL (the strict-balance in-memory alternative): `../03-avl/interview.md`
