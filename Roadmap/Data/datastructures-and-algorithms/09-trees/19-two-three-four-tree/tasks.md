# 2-3-4 Tree — Hands-On Tasks

> **Audience:** Anyone who has read `junior.md` and wants to cement the structure by implementing it. Tasks are ordered foundational → advanced. Each task lists a goal, constraints, hints, a difficulty tag, and acceptance criteria.

A 2-3-4 tree is a perfectly height-balanced search tree whose internal nodes are **2-nodes** (1 key, 2 children), **3-nodes** (2 keys, 3 children), or **4-nodes** (3 keys, 4 children), with **all leaves at the same depth**. It is exactly a B-tree of order 4 (`t = 2`). The defining trick is **top-down insertion**: descending toward the leaf, you preemptively **split every full 4-node you meet**, which guarantees the node you finally insert into has room and that any split's median always has a non-full parent to absorb it. The structure is information-equivalent to a red-black tree — Task 9 makes that correspondence concrete.

Tasks 1–4 build the core (model, search, top-down split-on-the-way-down insert, level printer, equal-depth check). Tasks 5–8 round it out (full invariant checker, height/occupancy stats, the red-black encoding, bottom-up vs top-down comparison). Tasks 9–12 push to advanced territory (top-down delete, O(n) bulk load, order statistics, a fuzz harness).

Pick your language (Go / Java / Python). Reference solutions below are in Python for brevity; Go and Java translations follow the patterns in `junior.md` §10. Cross-references: [`../18-two-three-tree/tasks.md`](../18-two-three-tree/tasks.md) (the order-3 sibling), [`../11-b-tree/tasks.md`](../11-b-tree/tasks.md) (the general-order parent), [`../04-red-black/tasks.md`](../04-red-black/tasks.md) (the binary encoding), and this topic's [`junior.md`](junior.md), [`middle.md`](middle.md), [`senior.md`](senior.md), [`professional.md`](professional.md).

---

## Task 1 — Model the 2-, 3-, and 4-node

**Difficulty:** Beginner

**Goal:** Define a node type that can hold **one, two, or three** keys and **two, three, or four** children, plus predicates `is_2node()`, `is_3node()`, `is_4node()`, `is_full()`, and `is_leaf()`.

**Constraints:**
- Keep `keys` and `children` as variable-length lists so a single type serves all three arities. A node is well-formed when `len(keys) ∈ {1, 2, 3}` and (`is_leaf()` or `len(children) == len(keys) + 1`).
- A **4-node is a real, stored state** here — unlike the 2-3 tree, where the 4-node is only transient. `is_full()` means exactly `len(keys) == 3`.

**Hints:**
- A 4-node stores keys `[a, b, c]` (`a < b < c`) and children `[c0, c1, c2, c3]` covering `(-∞, a)`, `(a, b)`, `(b, c)`, `(c, +∞)`.
- One `len(keys)`-driven shape avoids three classes and makes split logic uniform.

**Acceptance:**
- `Node([10]).is_2node()` is true; `Node([10, 20]).is_3node()` is true; `Node([10, 20, 30]).is_4node()` and `.is_full()` are both true.
- A leaf 4-node reports `is_leaf()` and `is_4node()` simultaneously.

**Reference (Python):**
```python
class Node:
    __slots__ = ("keys", "children")
    def __init__(self, keys, children=None):
        self.keys = keys                      # 1, 2, or 3 sorted keys
        self.children = children or []        # 0 (leaf), 2, 3, or 4
    def is_leaf(self):  return not self.children
    def is_2node(self): return len(self.keys) == 1
    def is_3node(self): return len(self.keys) == 2
    def is_4node(self): return len(self.keys) == 3
    def is_full(self):  return len(self.keys) == 3

class Tree234:
    def __init__(self):
        self.root = None
```

---

## Task 2 — Search

**Difficulty:** Beginner

**Goal:** Implement `search(key) -> bool` with one comparison ladder that handles 2-, 3-, and 4-nodes uniformly.

**Constraints:**
- Visit at most one node per level: O(height) = O(log n) comparisons.
- Recursive or iterative — your choice.

**Hints:**
- Scan `keys` left to right and stop at the first key `≥ key`. The child index equals the number of keys strictly less than `key`.
- If the stopping key equals `key`, it's a hit; otherwise descend into child `i` (or fail if leaf).

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

## Task 3 — Top-down insertion with preemptive splitting

**Difficulty:** Beginner

**Goal:** Implement `insert(key)` in the canonical **top-down** style: as you descend toward the leaf, **split every full 4-node before you pass through it**. By the time you reach the leaf, it is guaranteed to have a free slot, so the final insertion never cascades.

**Constraints:**
- Duplicates are ignored (set semantics).
- A split's median **always** rises into the parent — and because you split full nodes on the way down, the parent is guaranteed non-full, so it can absorb the median with no further work.
- The root is a special case: if the root is full, split it first, which grows the height by one. This is the **only** place the height increases.

**Hints:**
- `split_child(parent, i)` splits `parent.children[i]` (a full 4-node `[a, b, c]`): `a` stays in a new left node, `c` in a new right node, and `b` is inserted into `parent.keys` at position `i`, with the two halves replacing the old child.
- The descent invariant: before descending into a child, ensure neither the current node (handled at the root) nor the child you're about to enter is full. Split the child if it is, then re-pick the child after the median lands in the parent.
- Contrast with the 2-3 tree, where splits propagate **upward**. Here they happen **downward and eagerly**, so insertion is a single root-to-leaf pass with no recursion-unwinding phase.

**Acceptance:**
- Inserting `1..7` in order grows a balanced tree whose root splits exactly when it first fills; `verify()` (Task 4) passes after every insert.
- Inserting the same set in random order yields a tree that also passes `verify()` and contains every key.

**Reference (Python):**
```python
def insert(self, key):
    if self.root is None:
        self.root = Node([key]); return
    if self.root.is_full():                       # split root -> height grows
        old = self.root
        self.root = Node([], [old])
        self._split_child(self.root, 0)
    self._insert_nonfull(self.root, key)

def _split_child(self, parent, i):
    full = parent.children[i]                      # a full 4-node [a, b, c]
    a, b, c = full.keys
    left  = Node([a])
    right = Node([c])
    if not full.is_leaf():
        left.children  = full.children[0:2]
        right.children = full.children[2:4]
    parent.keys.insert(i, b)
    parent.children[i:i+1] = [left, right]

def _insert_nonfull(self, node, key):
    i = 0
    while i < len(node.keys) and key > node.keys[i]:
        i += 1
    if i < len(node.keys) and key == node.keys[i]:
        return                                     # duplicate
    if node.is_leaf():
        node.keys.insert(i, key)                   # guaranteed room
        return
    if node.children[i].is_full():
        self._split_child(node, i)
        if key > node.keys[i]:                     # median may shift target
            i += 1
        elif key == node.keys[i]:
            return                                 # the rising median == key
    self._insert_nonfull(node.children[i], key)
```

---

## Task 4 — Level-order printer and the equal-depth invariant

**Difficulty:** Beginner

**Goal:** Implement `show()` that prints the tree one level per line (each node as its key list), and `verify_equal_depth()` confirming **all leaves sit at the same depth**.

**Constraints:**
- `show()` lists nodes left-to-right within each level.
- `verify_equal_depth()` returns `False` (not raise) on a malformed tree so it can drive fuzz tests.

**Hints:**
- `show()` is a level BFS: print the current frontier, then build the next frontier from all children.
- For equal depth: a DFS that returns the leaf depth and asserts every leaf agrees; a mismatch anywhere fails the check.

**Acceptance:**
- For inserts `10, 20, 5, 6, 12, 30, 7, 17, 3, 25` the printer groups every level on its own line and all leaf nodes appear on the final line.
- `verify_equal_depth()` returns `True` on any tree produced by Task 3 inserts.

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

## Task 5 — Full invariant checker

**Difficulty:** Intermediate

**Goal:** Write `validate()` returning `True` iff the tree satisfies **all three** 2-3-4 invariants: (a) **ordering** — keys sorted within each node and each subtree strictly bounded by its separators; (b) **equal depth** — every leaf at the same depth; (c) **node arity** — every node holds 1–3 keys and every internal node has exactly `len(keys)+1` children.

**Constraints:**
- One pass. Return a boolean; optionally surface the first violating node for debugging.

**Hints:**
- Carry `(lo, hi)` bounds down the recursion. Keys `[k0, ..., k_{m-1}]` split the interval into `(lo, k0), (k0, k1), ..., (k_{m-1}, hi)`.
- Equal depth falls out of the same recursion if the helper returns leaf depth and the caller asserts all children agree.
- Arity is a local check: reject `len(keys) ∉ {1,2,3}` and any internal node with `len(children) != len(keys)+1`.

**Acceptance:**
- Passes on every tree built by Task 3.
- Tamper deliberately — append a fourth key to some node, or drop a child — and `validate()` returns `False`.

**Reference (Python):**
```python
def validate(self):
    INF = float("inf")
    def walk(node, lo, hi):
        if not (1 <= len(node.keys) <= 3):              # arity
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

## Task 6 — Height and occupancy measurement

**Difficulty:** Intermediate

**Goal:** Implement `height()` (edge count root→leaf) and `occupancy()` (fraction of key slots filled, `total_keys / (3 * node_count)`), then report both across build orders.

**Constraints:**
- Compare ascending inserts `1..n`, descending inserts `n..1`, and random inserts for `n = 10000`.

**Hints:**
- For a 2-3-4 tree, `log₄(n+1) - 1 ≤ height ≤ log₂(n+1) - 1`. Because top-down insertion splits eagerly, the tree leans toward 2- and 3-nodes; you will rarely see height near the lower (all-4-node) bound for incremental inserts.
- A pure-2-node tree has 1/3 occupancy; a pure-4-node tree has 100%. Random top-down inserts typically land around ~60–70%.
- **Observation worth noting:** preemptive splitting trades higher occupancy for a strictly single-pass insert. Compare against a lazy (Task 8) variant to see the difference.

**Acceptance:**
- `height()` for `n = 10000` is between 6 and 13 inclusive for all three orders.
- Random inserts report different (typically higher) occupancy than worst-case ascending inserts on the same `n`.

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
    return keys / (3 * nodes) if nodes else 0.0
```

---

## Task 7 — Encode the 2-3-4 tree as a red-black tree

**Difficulty:** Intermediate

**Goal:** Implement `to_rb()` converting a 2-3-4 tree into an equivalent **red-black** binary tree, then **round-trip** it: rebuild a 2-3-4 tree from the red-black encoding and assert it is structurally identical to the original. This is the concrete proof that the two structures are isomorphic.

**Constraints:**
- A **2-node** `[a]` → a single **black** node `a`.
- A **3-node** `[a, b]` → a black node with **one** red child. (Pick a convention — e.g. left-leaning: `b` black on top, `a` red on its left. Be consistent.)
- A **4-node** `[a, b, c]` → `b` black on top, with `a` and `c` as **two red children** (`a` left, `c` right). The two red links are exactly the two extra keys that made it a 4-node.

**Hints:**
- The black-height of the red-black tree equals the height of the 2-3-4 tree, because **only black links cross 2-3-4 levels**; red links live **within** a former 3- or 4-node.
- This is the historical origin of red-black trees (Guibas–Sedgewick): a red-black tree *is* a binary encoding of a 2-3-4 tree, and the insert recoloring/rotation cases map one-to-one onto 4-node splits.
- For the round-trip: walk the red-black tree and **glue** each black node together with its red children back into a single 2-/3-/4-node, recursing into the black grandchildren as the 2-3-4 children. Compare against [`../04-red-black/tasks.md`](../04-red-black/tasks.md) Task 6 for an independently-built tree.

**Acceptance:**
- For any 2-3-4 tree, `to_rb()` yields a tree where no red node has a red child and every root-to-leaf path crosses the same number of black links.
- In-order traversal of the red-black encoding equals the sorted key list.
- `from_rb(to_rb(t))` is structurally equal to `t` (same node shapes, same keys, same children) for 1000 random trees.

**Reference (Python):**
```python
RED, BLACK = True, False
class RBNode:
    __slots__ = ("key", "left", "right", "color")
    def __init__(self, key, color=BLACK):
        self.key = key; self.left = self.right = None; self.color = color

def to_rb(node):
    if node is None:
        return None
    k = node.keys
    if node.is_2node():
        h = RBNode(k[0], BLACK)
        if not node.is_leaf():
            h.left, h.right = to_rb(node.children[0]), to_rb(node.children[1])
        return h
    if node.is_3node():                                  # left-leaning
        b = RBNode(k[1], BLACK); a = RBNode(k[0], RED); b.left = a
        if not node.is_leaf():
            a.left, a.right = to_rb(node.children[0]), to_rb(node.children[1])
            b.right = to_rb(node.children[2])
        return b
    # 4-node [a, b, c] -> b(black) with red a (left) and red c (right)
    b = RBNode(k[1], BLACK); a = RBNode(k[0], RED); c = RBNode(k[2], RED)
    b.left, b.right = a, c
    if not node.is_leaf():
        a.left, a.right = to_rb(node.children[0]), to_rb(node.children[1])
        c.left, c.right = to_rb(node.children[2]), to_rb(node.children[3])
    return b
```

---

## Task 8 — Bottom-up insertion and a top-down vs bottom-up comparison

**Difficulty:** Intermediate

**Goal:** Implement an alternative **bottom-up** `insert_bottom_up(key)` that descends without splitting, inserts at the leaf, and lets a temporary overflow (a transient 5-key node, or a 4-node treated as splittable) propagate splits **upward** — exactly like the 2-3 tree's promotion-return insert. Then compare the two strategies on identical inputs.

**Constraints:**
- Bottom-up must produce a tree that passes `validate()` and contains the same key set as top-down on the same insert sequence — though the **shapes may differ**.
- Measure: number of node splits and final occupancy for both strategies over `n = 100000` random inserts.

**Hints:**
- Bottom-up reuses the 2-3 promotion shape: `_insert` returns either `None` (absorbed) or `(median, left, right)`; the caller installs the median, splitting again if that overflows. A node here can hold up to 3 keys, so it only splits when a 4th would arrive.
- Top-down does *more* splits (it splits any full node it merely passes through, even when no insert ultimately needs it), but guarantees a single pass and is concurrency-friendly (no upward retry under locking).
- Bottom-up does *fewer, demand-driven* splits and tends to pack nodes a little fuller, but needs the return trip.

**Acceptance:**
- Over the same random sequence, both trees have identical key sets and pass `validate()`.
- The split count for top-down is `≥` the split count for bottom-up; report both numbers and the occupancy of each final tree.

**Reference sketch (Python):**
```python
def insert_bottom_up(self, key):
    if self.root is None:
        self.root = Node([key]); return
    promo = self._ins_bu(self.root, key)
    if promo is not None:
        median, left, right = promo
        self.root = Node([median], [left, right])

def _ins_bu(self, node, key):
    i = 0
    while i < len(node.keys) and key > node.keys[i]:
        i += 1
    if i < len(node.keys) and key == node.keys[i]:
        return None
    if node.is_leaf():
        node.keys.insert(i, key)
    else:
        promo = self._ins_bu(node.children[i], key)
        if promo is None:
            return None
        median, left, right = promo
        node.keys.insert(i, median)
        node.children[i:i+1] = [left, right]
    if len(node.keys) <= 3:
        return None
    # overflow: split the 4-key node, push the median (index 1) up
    mid = node.keys[1]
    left  = Node(node.keys[0:1], node.children[0:2] if node.children else [])
    right = Node(node.keys[2:4], node.children[2:5] if node.children else [])
    return (mid, left, right)
```

---

## Task 9 — Full top-down deletion: borrow, fuse, root collapse

**Difficulty:** Advanced

**Goal:** Implement `delete(key)` in the **top-down** style: as you descend toward the key (or its predecessor), **ensure each node you enter has at least 2 keys** before descending into it, by borrowing from a sibling or fusing with one. This guarantees that when you reach the leaf you can remove the key without underflow.

**Constraints:**
- Deletions preserve all three invariants and keep the tree perfectly balanced after every operation.
- The root collapses (height shrinks) when a fuse empties it of keys, leaving a single child.

**Hints:**
- **Internal key:** replace it with its in-order **predecessor** (largest key in the left-subtree's rightmost leaf), then delete that predecessor from the leaf — reduces every case to a leaf deletion.
- **The proactive invariant (top-down):** before descending into `children[i]`, if that child is a 2-node (only 1 key), fix it *first*:
  - **Borrow** from an adjacent sibling that has ≥ 2 keys: rotate a key through the parent (parent separator down into the child, sibling's extreme key up into the parent).
  - **Fuse** when both neighbors are 2-nodes: merge the child, one parent separator, and a sibling into a single 4-node (1 + 1 + 1 keys). This may reduce the parent — but because you maintained the invariant on the way down, the parent always has a spare key to give, so the fuse is safe.
- **Root collapse:** if the root ends with zero keys after a fuse, make its single remaining child the new root.
- This mirrors the B-tree top-down delete in [`../11-b-tree/tasks.md`](../11-b-tree/tasks.md) Task 2 specialized to `t = 2`; the borrow-vs-fuse decision is identical. Compare with the 2-3 delete in [`../18-two-three-tree/tasks.md`](../18-two-three-tree/tasks.md) Task 10.

**Acceptance:**
- A fuzz run of 50,000 mixed insert/delete operations keeps `delete`'s key set identical to a Python `set` oracle, and `validate()` passes after **every** operation.
- Deleting all keys from a non-trivial tree ends at an empty tree (`root is None`) with no intermediate invariant break.
- Repeatedly deleting the current minimum from `1..n` shrinks height monotonically and never violates equal-depth.

**Reference (Python, core skeleton):**
```python
def delete(self, key):
    if self.root is None:
        return
    self._delete(self.root, key)
    if not self.root.keys:                          # root collapse
        self.root = self.root.children[0] if self.root.children else None

def _delete(self, node, key):
    i = 0
    while i < len(node.keys) and key > node.keys[i]:
        i += 1
    if i < len(node.keys) and key == node.keys[i]:
        if node.is_leaf():
            node.keys.pop(i)                        # safe: node has >= 2 keys
        else:
            pred = self._max_key(node.children[i])  # in-order predecessor
            node.keys[i] = pred
            self._ensure(node, i)
            self._delete(node.children[i], pred)
    elif not node.is_leaf():
        self._ensure(node, i)
        # _ensure may have fused children[i] leftward, shifting the target
        if i > len(node.keys):
            i = len(node.keys)
        self._delete(node.children[i], key)

def _max_key(self, node):
    while not node.is_leaf():
        node = node.children[-1]
    return node.keys[-1]

def _ensure(self, parent, i):
    """Guarantee parent.children[i] has >= 2 keys (borrow or fuse)."""
    child = parent.children[i]
    if len(child.keys) >= 2:
        return
    left  = parent.children[i-1] if i > 0 else None
    right = parent.children[i+1] if i < len(parent.children)-1 else None
    if left and len(left.keys) >= 2:                # borrow from left
        child.keys.insert(0, parent.keys[i-1])
        parent.keys[i-1] = left.keys.pop()
        if not left.is_leaf():
            child.children.insert(0, left.children.pop())
    elif right and len(right.keys) >= 2:            # borrow from right
        child.keys.append(parent.keys[i])
        parent.keys[i] = right.keys.pop(0)
        if not right.is_leaf():
            child.children.append(right.children.pop(0))
    elif left:                                      # fuse with left sibling
        left.keys.append(parent.keys.pop(i-1))
        left.keys.extend(child.keys)
        left.children.extend(child.children)
        parent.children.pop(i)
    else:                                           # fuse with right sibling
        child.keys.append(parent.keys.pop(i))
        child.keys.extend(right.keys)
        child.children.extend(right.children)
        parent.children.pop(i+1)
```
> The subtle bug surface is the index shift after a left-fuse (the target child moved to position `i-1`). Drive `_ensure` with `validate()` after every op before trusting the torture test.

---

## Task 10 — Bulk-load from a sorted array in O(n)

**Difficulty:** Advanced

**Goal:** Implement `Tree234.bulk_load(sorted_keys)` building a valid 2-3-4 tree directly from a sorted, duplicate-free array in O(n), **without** routing each key through `insert`.

**Constraints:**
- No splits during construction — pack the leaf layer, then each parent layer, bottom-up.
- Result must pass `validate()` and have the same key set as the input.

**Hints:**
- Build the **leaf layer** greedily as 4-nodes (3 keys each), but never leave a final node with 0 keys: if a remainder of length 1 or 2 would be left, redistribute the last full group so the tail is a valid 1–3-key node (e.g. turn a trailing `[..3][1]` into `[..2][2]`).
- For each internal layer, group children into runs of 2–4 the same way. Separators are the **minimum key of each non-first child's subtree** — track each node's min key (leftmost leaf key) as you go up.
- Stop when a single node remains: that is the root.
- This is the order-4 specialization of the B-tree bulk loader in [`../11-b-tree/tasks.md`](../11-b-tree/tasks.md) Task 4 and the order-3 one in [`../18-two-three-tree/tasks.md`](../18-two-three-tree/tasks.md) Task 8.

**Acceptance:**
- For `sorted_keys = list(range(10**6))`, `bulk_load` completes in well under 2 seconds in Python and `validate()` passes.
- `occupancy()` of a bulk-loaded tree is ≥ 90% (proof that nodes were packed, not split).

**Reference sketch (Python):**
```python
@staticmethod
def bulk_load(sorted_keys):
    if not sorted_keys:
        return Tree234()
    def group_sizes(n, lo=2, hi=3):
        """Sizes (number of keys per leaf / children per parent) for n items,
           each in [lo, hi], with no leftover of size < lo."""
        sizes = []
        while n > 0:
            take = min(hi, n)
            if n - take == 1 and take > lo:       # avoid a lone leftover
                take -= 1
            sizes.append(take); n -= take
        return sizes

    # Leaf layer: 1..3 keys per node, carrying (node, min_key).
    leaves, i = [], 0
    for take in group_sizes(len(sorted_keys), lo=1, hi=3):
        node = Node(sorted_keys[i:i+take])
        leaves.append((node, node.keys[0])); i += take

    layer = leaves
    while len(layer) > 1:
        parents, j = [], 0
        for grp in group_sizes(len(layer), lo=2, hi=4):  # 2..4 children
            kids = layer[j:j+grp]; j += grp
            seps = [cmin for (_, cmin) in kids[1:]]
            node = Node(seps, [c for (c, _) in kids])
            parents.append((node, kids[0][1]))
        layer = parents

    t = Tree234(); t.root = layer[0][0]
    return t
```
> The grouping arithmetic (no leftover smaller than the minimum) is the subtle part — drive it with `validate()` over every `n` from 1 to a few thousand before trusting 10⁶.

---

## Task 11 — Order statistics via subtree-size augmentation

**Difficulty:** Advanced

**Goal:** Augment every node with `size` (number of keys in its subtree) and implement `kth_smallest(k)`, `rank(key)` (count of keys `< key`), and a `range(lo, hi)` iterator.

**Constraints:**
- `size` must stay correct across inserts, splits, fuses, borrows, and deletes.
- `kth_smallest` and `rank` run in O(height).

**Hints:**
- `node.size = sum(child.size for child) + len(node.keys)` (a leaf's size is just `len(node.keys)`). Recompute on the way back after any structural change, or maintain it incrementally inside `split_child` / `_ensure`.
- `kth_smallest`: at a node, walk children/keys left to right. For each child, if `k ≤ child.size`, descend; else subtract `child.size`. After a child, the next separator key answers `k == 1`; else subtract 1 and continue.
- `range(lo, hi)`: in-order traversal pruned by `lo`/`hi`, skipping subtrees wholly outside the interval; visits O(log n + output) nodes.
- This is the order-4 analog of [`../11-b-tree/tasks.md`](../11-b-tree/tasks.md) Task 6 and the size augmentation in [`../04-red-black/tasks.md`](../04-red-black/tasks.md) Task 7.

**Acceptance:**
- For 10⁴ random distinct keys, `kth_smallest(k) == sorted(keys)[k-1]` for every `k ∈ [1, n]`.
- `rank(x)` equals `bisect_left(sorted(keys), x)` for arbitrary `x`.
- After 10,000 mixed insert/delete ops, `root.size` equals the live key count.

**Reference (Python):**
```python
def subtree_size(node):                       # recompute helper
    return (len(node.keys) if node.is_leaf()
            else sum(subtree_size(c) for c in node.children) + len(node.keys))

def kth_smallest(node, k):                    # 1-indexed; assumes node.size set
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

## Task 12 — Property-based fuzz harness

**Difficulty:** Advanced

**Goal:** Build **one** randomized harness that interleaves inserts and deletes, and after **every** operation checks all invariants plus membership against a reference `set`. Reuse it to validate Tasks 3, 8, 9, and 11.

**Constraints:**
- The harness must catch every standard bug class: comparison-ladder off-by-ones, a forgotten root split or root collapse, separator confusion in a 4-node, a wrong index after a left-fuse, and stale `size` fields.

**Hints:**
- Keep a sorted oracle list for `kth`/`rank` checks and a `set` for membership.
- Bias the operation mix toward the structure you are stressing: ~70% inserts early to grow the tree, then a balanced mix, then ~70% deletes to force fuses and root collapse.

**Acceptance:**
- A single 50,000-op fuzz run passes: every `search` matches the oracle, `kth_smallest`/`rank` match the sorted oracle, and `validate()` returns `True` after every op.
- Re-seed and rerun 100 times with different seeds; zero failures.

**Reference (Python):**
```python
from bisect import insort
import random

def stress(ops):
    t = Tree234(); oracle = []
    for op, key in ops:
        if op == "ins":
            if key not in oracle: insort(oracle, key)
            t.insert(key)
        elif op == "del":
            if key in oracle: oracle.remove(key)
            t.delete(key)
        elif op == "find":
            assert t.search(key) == (key in oracle)
        elif op == "kth" and oracle:
            k = key % len(oracle) + 1
            assert kth_smallest(t.root, k) == oracle[k - 1]
        assert t.validate(), f"invariant broken after {op} {key}"
    # final membership sweep
    for k in oracle:
        assert t.search(k)

def random_ops(n, hi):
    ops = []
    for _ in range(n):
        r = random.random()
        op = "ins" if r < 0.5 else "del" if r < 0.8 else "find" if r < 0.95 else "kth"
        ops.append((op, random.randrange(hi)))
    return ops

for seed in range(100):
    random.seed(seed)
    stress(random_ops(50_000, 5_000))
```

A single clean 50,000-op run catches the bugs that defeat hand-tested implementations: the root cases (split on the way down, collapse on the way up) and the index shift after a left-fuse in delete.

---

## Recommended order

1. Task 1 (model) — get the node shape right; everything depends on it.
2. Task 2 (search) — trivial, gives an early sanity check.
3. Task 4 (printer + equal-depth) — your eyes during every later task.
4. Task 3 (top-down split-on-the-way-down insert) — the heart of the structure.
5. Task 5 (full validator) — fold into every later test.
6. Task 6 (height/occupancy) — measurement intuition for free.
7. Task 7 (red-black encoding + round-trip) — makes the isomorphism tangible.
8. Task 8 (bottom-up vs top-down) — clarifies *why* the eager split matters.
9. Task 9 (delete) — the single hardest task; do not skip the fuzz test.
10. Task 10 (bulk load) — quick once the validator exists.
11. Task 11 (order statistics) — additive once delete keeps sizes honest.
12. Task 12 (fuzz harness) — the integration test for everything above.

Completing Tasks 1–12 with a clean 50,000-op fuzz run leaves you fluent in 2-3-4 tree mechanics and ready for [`senior.md`](senior.md)'s systems context — and you will understand, concretely, why a 2-3-4 tree, a B-tree of order 4, and a red-black tree are three views of one idea.
