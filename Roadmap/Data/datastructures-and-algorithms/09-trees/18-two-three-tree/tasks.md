# 2-3 Tree — Hands-On Tasks

> **Audience:** Anyone who has read `junior.md` and wants to cement the structure by implementing it. Tasks are ordered foundational → advanced. Each task lists a goal, constraints, hints, a difficulty tag, and acceptance criteria.

A 2-3 tree is a perfectly height-balanced search tree whose internal nodes are either **2-nodes** (1 key, 2 children) or **3-nodes** (2 keys, 3 children), with **all leaves at the same depth**. It is exactly a B-tree of order 3 (`t = 2`). Insertion splits a temporary overfull node and pushes the median up; deletion borrows from or merges siblings. The structure is information-equivalent to a left-leaning red-black tree — Task 9 makes that correspondence concrete.

Tasks 1–4 build the core (model, search, single-split insert, level printer, invariant). Tasks 5–8 round it out (cascading-split insert, height/occupancy stats, the LLRB encoding, bulk loading). Tasks 9–12 push to advanced territory (full delete, persistence, order statistics, a fuzz harness).

Pick your language (Go / Java / Python). Reference solutions below are in Python for brevity; Go and Java translations follow the patterns in `junior.md` §10. Cross-references: [`../11-b-tree/tasks.md`](../11-b-tree/tasks.md) (the order-3 generalization), [`../04-red-black/tasks.md`](../04-red-black/tasks.md) (the binary encoding), and this topic's [`junior.md`](junior.md), [`middle.md`](middle.md), [`senior.md`](senior.md), [`professional.md`](professional.md).

---

## Task 1 — Model the 2-node and the 3-node

**Difficulty:** Beginner

**Goal:** Define a node type that can hold **one or two** keys and **two or three** children, plus predicates `is_2node()`, `is_3node()`, and `is_leaf()`.

**Constraints:**
- Keep `keys` and `children` as variable-length lists so the same type serves both arities. A node is well-formed when `len(keys) ∈ {1, 2}` and (`is_leaf()` or `len(children) == len(keys) + 1`).
- Do **not** model the temporary 4-node as a stored state — it exists only transiently inside `insert` (Tasks 3 and 5).

**Hints:**
- A 3-node stores keys `[a, b]` with `a < b` and children `[lt, mid, gt]` covering `(-∞, a)`, `(a, b)`, `(b, +∞)`.
- A single `len(keys)`-driven shape avoids two separate classes and makes the split logic uniform.

**Acceptance:**
- `Node([10]).is_2node()` is true; `Node([10, 20]).is_3node()` is true.
- A leaf 3-node reports `is_leaf()` true and `is_3node()` true simultaneously.

**Reference (Python):**
```python
class Node:
    __slots__ = ("keys", "children")
    def __init__(self, keys, children=None):
        self.keys = keys                      # 1 or 2 sorted keys
        self.children = children or []        # 0 (leaf), 2, or 3
    def is_leaf(self):  return not self.children
    def is_2node(self): return len(self.keys) == 1
    def is_3node(self): return len(self.keys) == 2

class Tree23:
    def __init__(self):
        self.root = None
```

---

## Task 2 — Search

**Difficulty:** Beginner

**Goal:** Implement `search(key) -> bool` with a clean comparison ladder that handles both 2-nodes and 3-nodes.

**Constraints:**
- Visit at most one node per level: O(height) = O(log n) comparisons.
- No recursion required, but a recursive version is fine.

**Hints:**
- At a 2-node: `key == k0` hit; `key < k0` go left; else go right.
- At a 3-node: compare against `k0` then `k1`. The child index equals the number of keys strictly less than `key`.
- Generalize: scan `keys` left to right, stop at the first key `≥ key`; if it is equal you found it, otherwise descend into child `i`.

**Acceptance:**
- For a tree built from `0..999` shuffled, `search(k)` is true for every inserted `k` and false for every absent value.

**Reference (Python):**
```python
def search(self, key):
    node = self.root
    while node is not None:
        i = 0
        while i < len(node.keys) and key > node.keys[i]:
            i += 1
        if i < len(node.keys) and key == node.keys[i]:
            return True
        node = None if node.is_leaf() else node.children[i]
    return False
```

---

## Task 3 — Insertion with a single split

**Difficulty:** Beginner

**Goal:** Implement `insert(key)` for the cases that need **at most one** split: inserting into a leaf 2-node (becomes a 3-node, no split) and into a leaf 3-node whose parent is a 2-node (the leaf splits, the median moves up, the parent becomes a 3-node).

**Constraints:**
- Duplicates are ignored (set semantics).
- Defer the cascading case (full root, chains of splits) to Task 5 — but structure the code so Task 5 is a small extension, not a rewrite.

**Hints:**
- Inserting into a leaf 3-node temporarily forms a 4-node with keys `[a, b, c]` (`a < b < c`). Split it: `b` rises, `[a]` and `[c]` become the two new leaves.
- The cleanest formulation returns a "promotion" from the recursion: either `None` (absorbed in place) or `(median, left, right)` (caller must install the median). This single shape scales directly to cascading splits.

**Acceptance:**
- Inserting `[10, 20]` then `5` then `30` yields root keys `[10, 20]` with leaf children `[5]`, `[]`, `[30]` after the appropriate splits, all leaves at depth 1.
- After every insert the tree passes the Task 4 verifier.

**Reference (Python):**
```python
def insert(self, key):
    if self.root is None:
        self.root = Node([key]); return
    promo = self._insert(self.root, key)
    if promo is not None:                       # root split
        median, left, right = promo
        self.root = Node([median], [left, right])

def _insert(self, node, key):
    if node.is_leaf():
        return self._add_key(node, key, left=None, right=None)
    i = 0
    while i < len(node.keys) and key > node.keys[i]:
        i += 1
    if i < len(node.keys) and key == node.keys[i]:
        return None                              # duplicate
    promo = self._insert(node.children[i], key)
    if promo is None:
        return None
    median, left, right = promo
    node.children[i:i+1] = [left, right]
    return self._add_key(node, median, left=None, right=None, at=i)

def _add_key(self, node, key, left, right, at=None):
    if at is None:
        if key in node.keys: return None
        at = 0
        while at < len(node.keys) and key > node.keys[at]:
            at += 1
    node.keys.insert(at, key)
    if len(node.keys) <= 2:                       # absorbed
        return None
    # overflow: split the temporary 4-node
    mid = node.keys[1]
    left_node  = Node([node.keys[0]], node.children[0:2] if node.children else [])
    right_node = Node([node.keys[2]], node.children[2:4] if node.children else [])
    return (mid, left_node, right_node)
```

---

## Task 4 — Level-order printer and the equal-depth invariant

**Difficulty:** Beginner

**Goal:** Implement `show()` that prints the tree one level per line (each node as its key list), and `verify()` that confirms **all leaves sit at the same depth**.

**Constraints:**
- `show()` lists nodes left-to-right within each level.
- `verify()` must return `False` (not raise) on a malformed tree so it can drive fuzz tests.

**Hints:**
- `show()` is a BFS by level: print the current frontier, then build the next frontier from all children.
- For equal-depth: a DFS that returns the leaf depth and asserts every leaf agrees. A mismatch anywhere fails the check.

**Acceptance:**
- For inserts `10, 20, 5, 6, 12, 30, 7, 17` the printer output groups every level on its own line and all leaf nodes appear on the final line.
- `verify()` returns `True` on any tree produced by Task 3 / Task 5 inserts.

**Reference (Python):**
```python
def show(self):
    if self.root is None:
        print("(empty)"); return
    level = [self.root]
    while level:
        print("   ".join("[" + ",".join(map(str, n.keys)) + "]" for n in level))
        level = [c for n in level if not n.is_leaf() for c in n.children]

def _leaf_depth(self, node, d):
    if node.is_leaf():
        return d
    depths = {self._leaf_depth(c, d + 1) for c in node.children}
    return depths.pop() if len(depths) == 1 else -1   # -1 ⇒ unequal

def verify_equal_depth(self):
    return self.root is None or self._leaf_depth(self.root, 0) != -1
```

---

## Task 5 — Cascading-split insertion that grows the root

**Difficulty:** Intermediate

**Goal:** Extend Task 3 so a split can propagate up an arbitrary number of levels, eventually splitting the root and increasing the height by one.

**Constraints:**
- The tree must remain perfectly balanced after every insert — growth happens **only** at the root, never at a leaf.
- Insert `1..N` in ascending order (the worst case for split chains) for `N = 100000` and stay within O(N log N).

**Hints:**
- If you wrote `_insert` to return a promotion (Task 3), cascading already works: each level either absorbs the promotion or splits and forwards a new promotion. The root case in `insert` installs a fresh root when the top promotion is non-`None`.
- The reason the tree stays balanced: every leaf gains depth simultaneously when the root splits, because the new root sits one level above the entire old tree.

**Acceptance:**
- Inserting `1, 2, 3, 4, 5, 6, 7` in order produces a height-1 tree (root + leaves), then the 4-node-driven splits keep it balanced; `verify()` passes after each insert.
- For ascending inserts `1..n`, height grows as `⌈log₃(n+1)⌉ ≤ h ≤ ⌈log₂(n+1)⌉` — measure it in Task 7.

**Reference:** No new code beyond Task 3 if you used the promotion-return shape. If you wrote an in-place variant, refactor it now — the promotion form is the one that scales.

---

## Task 6 — Full invariant checker

**Difficulty:** Intermediate

**Goal:** Write `validate()` that returns `True` iff the tree satisfies **all three** 2-3 invariants: (a) **ordering** — keys sorted within each node and each subtree strictly bounded by its separators; (b) **equal depth** — every leaf at the same depth; (c) **node arity** — every node is a 2-node or 3-node, and an internal node has exactly `len(keys)+1` children.

**Constraints:**
- One pass. Return a boolean; optionally also surface the first violating node for debugging.

**Hints:**
- Carry `(lo, hi)` bounds down the recursion. A 2-node `[k]` splits the interval into `(lo, k)` and `(k, hi)`; a 3-node `[a, b]` splits into `(lo, a)`, `(a, b)`, `(b, hi)`.
- Equal depth falls out of the same recursion if the helper returns the leaf depth and the caller asserts all children agree.
- Arity is a local check: reject `len(keys) ∉ {1,2}` and any internal node with `len(children) != len(keys)+1`.

**Acceptance:**
- Passes on every tree built by Tasks 3 and 5.
- Tamper deliberately — append a third key to some node, or drop a child — and `validate()` returns `False`.

**Reference (Python):**
```python
def validate(self):
    INF = float("inf")
    def walk(node, lo, hi):
        if not (1 <= len(node.keys) <= 2):              # arity
            return None
        if any(node.keys[i] >= node.keys[i+1] for i in range(len(node.keys)-1)):
            return None                                  # sorted-within-node
        if not (lo < node.keys[0] and node.keys[-1] < hi):
            return None                                  # bounds
        if node.is_leaf():
            return 0
        if len(node.children) != len(node.keys) + 1:    # arity
            return None
        bounds = [lo] + node.keys + [hi]
        depths = set()
        for i, c in enumerate(node.children):
            d = walk(c, bounds[i], bounds[i+1])
            if d is None: return None
            depths.add(d)
        return depths.pop() + 1 if len(depths) == 1 else None
    return self.root is None or walk(self.root, -INF, INF) is not None
```

---

## Task 7 — Height and occupancy measurement

**Difficulty:** Intermediate

**Goal:** Implement `height()` (edge count from root to any leaf) and `occupancy()` (fraction of key slots filled, i.e. `total_keys / (2 * node_count)`), then report both across several build orders.

**Constraints:**
- Compare ascending inserts `1..n`, descending inserts `n..1`, and random inserts for `n = 10000`.

**Hints:**
- For a 2-3 tree, `log₃(n+1) - 1 ≤ height ≤ log₂(n+1) - 1`. Ascending/descending inserts push toward the upper (all-2-node-ish) bound; random inserts mix 2- and 3-nodes.
- Occupancy of a pure-2-node tree is 50%; a pure-3-node tree is 100%. Real trees land in between — typically ~65–75% for random data.

**Acceptance:**
- `height()` for `n = 10000` is between 8 and 14 inclusive for all three orders.
- Random inserts report strictly higher occupancy than worst-case ascending inserts on the same `n`.

**Reference (Python):**
```python
def height(self):
    h, node = 0, self.root
    while node is not None and not node.is_leaf():
        node = node.children[0]; h += 1
    return h

def occupancy(self):
    keys = nodes = 0
    stack = [self.root] if self.root else []
    while stack:
        n = stack.pop()
        keys += len(n.keys); nodes += 1
        stack.extend(n.children)
    return keys / (2 * nodes) if nodes else 0.0
```

---

## Task 8 — Bulk-load from a sorted array in O(n)

**Difficulty:** Advanced

**Goal:** Implement `Tree23.bulk_load(sorted_keys)` that builds a valid 2-3 tree directly from a sorted, duplicate-free array in O(n), **without** routing each key through `insert`.

**Constraints:**
- No splits during construction — pack the leaf layer, then each parent layer, bottom-up.
- Result must pass `validate()` and have the same key set as the input.

**Hints:**
- Build the **leaf layer** greedily as 3-nodes (2 keys each), but never leave a final node with 0 keys: if a remainder of length 1 would result, convert the previous group into two 2-nodes so the tail is a valid node.
- For each internal layer, group children into 2s and 3s the same way. The separators are the **minimum key of each non-first child's subtree** — track each node's min key (the leftmost leaf key of its subtree) as you go up.
- Stop when a single node remains: that is the root.
- This is the order-3 specialization of the B-tree bulk loader in [`../11-b-tree/tasks.md`](../11-b-tree/tasks.md) Task 4.

**Acceptance:**
- For `sorted_keys = list(range(10**6))`, `bulk_load` completes in well under 2 seconds in Python and `validate()` passes.
- `occupancy()` of a bulk-loaded tree is ≥ 90% (proof that nodes were packed, not split).

**Reference sketch (Python):**
```python
@staticmethod
def bulk_load(sorted_keys):
    if not sorted_keys:
        return Tree23()
    # Leaf layer: nodes carry (node, min_key). Pack 2 keys/node, fix length-1 tail.
    leaves, i, n = [], 0, len(sorted_keys)
    while i < n:
        take = 2 if n - i != 1 else 1
        if n - i == 3:                  # avoid leaving a lone key next round
            take = 2
        node = Node(sorted_keys[i:i+take])
        leaves.append((node, node.keys[0]))
        i += take
    layer = leaves
    while len(layer) > 1:
        parents, j, m = [], 0, len(layer)
        while j < m:
            grp = 3 if (m - j) % 2 == 1 and (m - j) != 4 else 2
            grp = min(grp, m - j)
            kids = layer[j:j+grp]
            seps = [child_min for (_, child_min) in kids[1:]]
            node = Node(seps, [c for (c, _) in kids])
            parents.append((node, kids[0][1]))
            j += grp
        layer = parents
    t = Tree23(); t.root = layer[0][0]
    return t
```
> The grouping arithmetic (avoiding a lone leftover child or key) is the subtle part — drive it with `validate()` over every `n` from 1 to a few thousand before trusting it on 10⁶.

---

## Task 9 — Encode the 2-3 tree as a left-leaning red-black tree

**Difficulty:** Advanced

**Goal:** Implement `to_llrb()` converting a 2-3 tree into its **left-leaning red-black** (LLRB) binary encoding, and verify the result is a valid LLRB tree (no right-leaning red links, no two reds in a row, equal black-height).

**Constraints:**
- A **2-node** maps to a single black node.
- A **3-node** `[a, b]` maps to two binary nodes: `b` black on top with `a` as a **red left child** — the red link glues the pair that was one 3-node.
- Children attach in order: 3-node children `[lt, mid, gt]` become `a.left = enc(lt)`, `a.right = enc(mid)`, `b.right = enc(gt)`.

**Hints:**
- The black-height of the LLRB tree equals the height of the 2-3 tree, because only black links cross levels — red links live **within** a former 3-node.
- This is the precise sense in which LLRB trees and 2-3 trees are "the same structure." Compare your encoded tree against an LLRB built by direct insertion from [`../04-red-black/tasks.md`](../04-red-black/tasks.md) Task 6 — the *shapes* match when keys are inserted in the same order.

**Acceptance:**
- For any 2-3 tree, `to_llrb()` yields a tree where every red link leans left, no node has two red children or a red child of a red node, and every root-to-leaf path crosses the same number of black links.
- In-order traversal of the LLRB encoding equals the sorted key list.

**Reference (Python):**
```python
RED, BLACK = True, False
class RBNode:
    __slots__ = ("key", "left", "right", "color")
    def __init__(self, key, color=BLACK):
        self.key = key; self.left = self.right = None; self.color = color

def to_llrb(node):
    if node is None:
        return None
    if node.is_2node():
        h = RBNode(node.keys[0], BLACK)
        if not node.is_leaf():
            h.left  = to_llrb(node.children[0])
            h.right = to_llrb(node.children[1])
        return h
    # 3-node [a, b] -> b(black) with red-left a
    a = RBNode(node.keys[0], RED)
    b = RBNode(node.keys[1], BLACK)
    b.left = a
    if not node.is_leaf():
        a.left  = to_llrb(node.children[0])
        a.right = to_llrb(node.children[1])
        b.right = to_llrb(node.children[2])
    return b
```

---

## Task 10 — Full deletion: swap-with-predecessor, borrow, merge, root collapse

**Difficulty:** Advanced

**Goal:** Implement `delete(key)` covering every structural case and surviving a fuzz torture test against a `set` oracle.

**Constraints:**
- Deletions must preserve all three invariants and keep the tree perfectly balanced after every operation.
- The root collapses (height shrinks) when its only key is consumed by a merge that empties it.

**Hints:**
- **Internal key:** replace it with its in-order **predecessor** (the largest key in the left-subtree's rightmost leaf), then delete that predecessor from the leaf — reduces every case to a leaf deletion.
- **Leaf with 2 keys (3-node leaf):** just remove the key; the leaf becomes a 2-node. Done.
- **Leaf with 1 key (2-node leaf) — underflow:** the hard case. Try to **borrow** from an adjacent sibling that is a 3-node (rotate a key through the parent). If no sibling can spare a key, **merge** the leaf with a sibling and the separating parent key, which may underflow the parent — recurse upward.
- **Root collapse:** if a merge leaves the root with zero keys, make its single remaining child the new root.
- This mirrors the B-tree delete in [`../11-b-tree/tasks.md`](../11-b-tree/tasks.md) Task 2 specialized to `t = 2`; the "borrow vs. merge" decision is identical. A proactive top-down variant (ensure each node has ≥ 2 keys before descending) avoids the upward recursion — implement whichever you find clearer, then test both against the same oracle.

**Acceptance:**
- A fuzz run of 50,000 mixed insert/delete operations keeps `delete`'s key set identical to a Python `set` oracle, and `validate()` passes after **every** operation.
- Deleting all keys from a non-trivial tree ends at an empty tree (`root is None`) with no intermediate invariant break.
- Repeatedly deleting the current minimum from `1..n` shrinks height monotonically and never violates equal-depth.

**Reference:** Full annotated implementation in [`middle.md`](middle.md) §3 (borrow/merge) and [`senior.md`](senior.md) (the proactive top-down formulation). Implement from the hints first; consult the reference only to compare your case analysis.

---

## Task 11 — Persistent (immutable) 2-3 tree with structural sharing

**Difficulty:** Advanced

**Goal:** Implement `PersistentTree23` where `insert(key)` returns a **new** tree that shares all unmodified subtrees with the old one; the original is untouched.

**Constraints:**
- No node is ever mutated. Each modified node along the insertion path is **copied**; its unchanged children are aliased from the previous version.
- Memory for `n` successive snapshots of an `m`-key tree is O(n + m + n·log m), not O(n·m).

**Hints:**
- The promotion-return insert from Task 3 is already nearly functional — it only needs to allocate new `Node`s instead of mutating in place. Splits naturally create fresh nodes for both halves; the old full node stays referenced by older snapshots.
- A persistent 2-3 tree is the canonical immutable ordered map: Clojure's sorted collections and Scala's `TreeMap` rest on the same path-copying idea (over red-black/2-3 hybrids).

**Acceptance:**
- `t1 = PersistentTree23(); t2 = t1.insert(5); t3 = t2.insert(7)` gives `t1.keys() == []`, `t2.keys() == [5]`, `t3.keys() == [5, 7]`.
- Searching any old snapshot still works after later inserts.
- A path-only copy: inserting one key into an `m`-key tree allocates O(log m) new nodes, verifiable by counting allocations.

**Reference (Python):**
```python
def p_insert(root, key):
    if root is None:
        return Node([key])
    promo = _p_insert(root, key)
    if isinstance(promo, Node):
        return promo
    median, left, right = promo
    return Node([median], [left, right])

def _p_insert(node, key):                 # returns Node (absorbed) or (median,l,r)
    if node.is_leaf():
        if key in node.keys: return node
        keys = sorted(node.keys + [key])
        return _maybe_split(Node(keys))
    i = 0
    while i < len(node.keys) and key > node.keys[i]:
        i += 1
    if i < len(node.keys) and key == node.keys[i]:
        return node
    res = _p_insert(node.children[i], key)
    if isinstance(res, Node):
        kids = list(node.children); kids[i] = res
        return Node(list(node.keys), kids)
    median, left, right = res
    keys = node.keys[:i] + [median] + node.keys[i:]
    kids = node.children[:i] + [left, right] + node.children[i+1:]
    return _maybe_split(Node(keys, kids))

def _maybe_split(node):
    if len(node.keys) <= 2:
        return node
    mid = node.keys[1]
    l = Node([node.keys[0]], node.children[0:2] if node.children else [])
    r = Node([node.keys[2]], node.children[2:4] if node.children else [])
    return (mid, l, r)
```
Wrap with a class that holds the current root and exposes `insert` returning a new wrapper.

---

## Task 12 — Order statistics via subtree-size augmentation

**Difficulty:** Advanced

**Goal:** Augment every node with `size` (number of keys in its subtree) and implement `kth_smallest(k)` and `rank(key)` (count of keys `< key`), plus a `range(lo, hi)` iterator.

**Constraints:**
- `size` must stay correct across inserts, splits, and (if you did Task 10) deletes, borrows, and merges.
- `kth_smallest` and `rank` run in O(height).

**Hints:**
- `node.size = sum(child.size for child) + len(node.keys)` (a leaf's size is just `len(node.keys)`). Recompute on the way back up after any structural change, or store it and update incrementally.
- `kth_smallest`: at a node, walk children/keys left to right. For each child, if `k ≤ child.size`, descend; else subtract `child.size`. After a child, the next separator key accounts for `k == 1` ⇒ that key is the answer; else subtract 1 and continue.
- `range(lo, hi)`: in-order traversal pruned by `lo`/`hi` — skip subtrees wholly outside the interval; visits O(log n + output) nodes.
- This is the order-3 analog of [`../11-b-tree/tasks.md`](../11-b-tree/tasks.md) Task 6 and the size augmentation in [`../04-red-black/tasks.md`](../04-red-black/tasks.md) Task 7.

**Acceptance:**
- For 10⁴ random distinct keys, `kth_smallest(k) == sorted(keys)[k-1]` for every `k ∈ [1, n]`.
- `rank(x)` equals `bisect_left(sorted(keys), x)` for arbitrary `x`.
- After 10,000 mixed insert/delete ops, `root.size` equals the live key count.

**Reference (Python):**
```python
def kth_smallest(node, k):                # 1-indexed
    if node.is_leaf():
        return node.keys[k - 1]
    for i, child in enumerate(node.children):
        if k <= child.size:
            return kth_smallest(child, k)
        k -= child.size
        if i < len(node.keys):
            if k == 1:
                return node.keys[i]
            k -= 1
    raise IndexError("k out of range")
```

---

## Testing strategy across all tasks

Build **one** harness and reuse it everywhere — the same approach as the B-tree and red-black task sets:

```python
from bisect import insort
def stress(ops):
    t = Tree23(); oracle = []
    for op, key in ops:
        if op == "ins":
            if key not in oracle: insort(oracle, key)
            t.insert(key)
        elif op == "del":
            if key in oracle: oracle.remove(key)
            t.delete(key)
        elif op == "find":
            assert t.search(key) == (key in oracle)
        elif op == "kth":
            assert kth_smallest(t.root, key) == oracle[key - 1]
        assert t.validate(), f"invariant broken after {op} {key}"
```

Drive it with `random.choices` and `random.shuffle`. A single 50,000-op fuzz run catches the standard bugs: off-by-ones in the comparison ladder, a forgotten root split or root collapse, separator confusion in the 3-node, and stale `size` fields.

---

## Recommended order

1. Task 1 (model) — get the node shape right; everything else depends on it.
2. Task 2 (search) — trivial, gives an early sanity check.
3. Task 4 (printer + equal-depth) — your eyes during every later task.
4. Task 3 (single-split insert) → Task 5 (cascading) — the promotion-return shape unlocks both at once.
5. Task 6 (full validator) — fold into every later test.
6. Task 7 (height/occupancy) — measurement intuition for free.
7. Task 8 (bulk load) — quick once the validator exists.
8. Task 9 (LLRB encoding) — makes the red-black correspondence tangible.
9. Task 10 (delete) — the single hardest task; do not skip the fuzz test.
10. Task 11 (persistent) — exercises the immutability mindset.
11. Task 12 (order statistics) — additive once delete keeps sizes honest.

Completing Tasks 1–12 with a clean 50,000-op fuzz run leaves you fluent in 2-3 tree mechanics and ready for [`senior.md`](senior.md)'s systems context — and you will understand, concretely, why a 2-3 tree, a B-tree of order 3, and a left-leaning red-black tree are three views of one idea.
