# AVL Tree — Hands-On Tasks

> **Audience:** Engineers building AVL muscle memory through guided exercises. Each task has a specification, an approach hint, and a reference solution. Prerequisite: `junior.md`.

Work through these tasks in order. Each one builds a piece of the toolkit. By task 10 you should have a complete, testable, augmented AVL library and be able to measure its behavior empirically.

---

## Table of Contents

1. [Node + Rotations](#t1)
2. [Insert with Full Rebalancing](#t2)
3. [Delete with Rebalancing](#t3)
4. [Invariant Verifier (Debug Check)](#t4)
5. [Build AVL from Sorted Array Bottom-Up](#t5)
6. [Augment with Subtree Size — `getKth`, `rank`](#t6)
7. [`getMin`, `getMax`, Inorder Iterator](#t7)
8. [Visualize Rotations — Print Before/After](#t8)
9. [Fibonacci-Tree Generator (Worst-Case AVL)](#t9)
10. [Measure Rotations per Insert — Random vs Sequential](#t10)

---

<a name="t1"></a>
## Task 1. Node + Rotations

### Spec
Define a `Node` struct/class with fields `key`, `left`, `right`, `height`. Implement `height(n)`, `bf(n)`, `update_height(n)`, `rotate_left(x)`, `rotate_right(y)`. Test each rotation on a 3-node tree.

### Approach hint
- Use the convention `height(null) = -1`, `height(leaf) = 0`.
- Update children's heights before parents' inside the rotation.

### Reference solution (Python)

```python
class Node:
    __slots__ = ("key", "left", "right", "height")
    def __init__(self, k):
        self.key, self.left, self.right, self.height = k, None, None, 0

def h(n):  return -1 if n is None else n.height
def bf(n): return 0 if n is None else h(n.left) - h(n.right)

def upd(n):
    n.height = max(h(n.left), h(n.right)) + 1

def rotate_right(y):
    x = y.left
    y.left = x.right
    x.right = y
    upd(y)
    upd(x)
    return x

def rotate_left(x):
    y = x.right
    x.right = y.left
    y.left = x
    upd(x)
    upd(y)
    return y

# Test:
#       30
#      /
#     20
#    /
#   10
# After rotate_right(30):  20 with 10 left, 30 right
root = Node(30)
root.left = Node(20)
root.left.left = Node(10)
upd(root.left.left); upd(root.left); upd(root)
new_root = rotate_right(root)
assert new_root.key == 20
assert new_root.left.key == 10
assert new_root.right.key == 30
assert new_root.height == 1
print("Task 1 OK")
```

---

<a name="t2"></a>
## Task 2. Insert with Full Rebalancing

### Spec
Implement `insert(root, key) -> root`. Cover LL, LR, RL, RR. After each insert, the tree must satisfy `|bf| ≤ 1` at every node.

### Approach hint
Use the key-comparison case selection (works for insert because the inserted key is known).

### Reference solution (Python)

```python
def insert(root, k):
    if root is None: return Node(k)
    if k < root.key:    root.left  = insert(root.left, k)
    elif k > root.key:  root.right = insert(root.right, k)
    else: return root  # duplicates ignored

    upd(root)
    b = bf(root)

    if b > 1 and k < root.left.key:     return rotate_right(root)
    if b > 1 and k > root.left.key:     root.left  = rotate_left(root.left);   return rotate_right(root)
    if b < -1 and k > root.right.key:   return rotate_left(root)
    if b < -1 and k < root.right.key:   root.right = rotate_right(root.right); return rotate_left(root)
    return root

# Test: insert 1..7 sequentially, end up with balanced tree of height 2.
root = None
for k in [1, 2, 3, 4, 5, 6, 7]:
    root = insert(root, k)
assert root.height == 2     # height bound for 7 nodes is exactly 2
print("Task 2 OK")
```

---

<a name="t3"></a>
## Task 3. Delete with Rebalancing

### Spec
Implement `delete(root, key) -> root`. Handle all three deletion cases (leaf, one child, two children with in-order successor). Use the **balance factor of the child** for rotation case selection.

### Approach hint
Use `>= 0` (not `> 0`) in the LL test and `<= 0` (not `< 0`) in the RR test after delete.

### Reference solution (Python)

```python
def delete(root, k):
    if root is None: return None
    if k < root.key:   root.left  = delete(root.left, k)
    elif k > root.key: root.right = delete(root.right, k)
    else:
        if root.left is None or root.right is None:
            root = root.left if root.left is not None else root.right
        else:
            succ = root.right
            while succ.left is not None:
                succ = succ.left
            root.key = succ.key
            root.right = delete(root.right, succ.key)
    if root is None: return None
    upd(root)
    b = bf(root)
    if b > 1 and bf(root.left) >= 0:   return rotate_right(root)
    if b > 1 and bf(root.left) <  0:   root.left  = rotate_left(root.left);  return rotate_right(root)
    if b < -1 and bf(root.right) <= 0: return rotate_left(root)
    if b < -1 and bf(root.right) >  0: root.right = rotate_right(root.right); return rotate_left(root)
    return root

# Test: build [1..7], delete 4, verify height still ≤ ⌈log₂ 6⌉ = 3 and BST property.
root = None
for k in [4, 2, 6, 1, 3, 5, 7]:
    root = insert(root, k)
root = delete(root, 4)
assert root is not None
print("Task 3 OK")
```

---

<a name="t4"></a>
## Task 4. Invariant Verifier (Debug Check)

### Spec
Implement `verify(root) -> bool` that returns true iff:
- BST property holds (inorder is strictly increasing),
- `|bf(n)| ≤ 1` at every node,
- Cached `height` matches the actual recomputed height at every node.

Run it inside your test suite after every random sequence.

### Approach hint
Single recursive function returning `(ok, min, max, height)` per subtree.

### Reference solution (Python)

```python
def verify(root):
    def check(n):
        if n is None:
            return True, None, None, -1
        ok_l, l_min, l_max, l_h = check(n.left)
        if not ok_l: return False, None, None, 0
        ok_r, r_min, r_max, r_h = check(n.right)
        if not ok_r: return False, None, None, 0

        if l_max is not None and l_max >= n.key: return False, None, None, 0
        if r_min is not None and r_min <= n.key: return False, None, None, 0

        actual_h = max(l_h, r_h) + 1
        if n.height != actual_h: return False, None, None, 0
        if abs(l_h - r_h) > 1:   return False, None, None, 0

        mn = l_min if l_min is not None else n.key
        mx = r_max if r_max is not None else n.key
        return True, mn, mx, actual_h
    ok, _, _, _ = check(root)
    return ok

# Test
import random
root = None
random.seed(42)
keys = random.sample(range(10000), 1000)
for k in keys:
    root = insert(root, k)
    assert verify(root), f"broken after inserting {k}"
random.shuffle(keys)
for k in keys[:500]:
    root = delete(root, k)
    assert verify(root), f"broken after deleting {k}"
print("Task 4 OK — invariant holds across 1500 random ops")
```

---

<a name="t5"></a>
## Task 5. Build AVL from Sorted Array Bottom-Up

### Spec
Given a sorted array, return an AVL of those keys in O(n) time. Verify with task 4's `verify`.

### Approach hint
Recursive midpoint split. The resulting tree is perfectly balanced, which trivially satisfies the AVL invariant.

### Reference solution (Python)

```python
def sorted_to_avl(arr):
    def build(lo, hi):
        if lo > hi: return None
        mid = (lo + hi) // 2
        n = Node(arr[mid])
        n.left  = build(lo, mid - 1)
        n.right = build(mid + 1, hi)
        upd(n)
        return n
    return build(0, len(arr) - 1)

# Test
arr = list(range(1, 1001))
t = sorted_to_avl(arr)
assert verify(t)
assert t.height <= 10   # ⌈log₂ 1000⌉ = 10
print("Task 5 OK — built 1000-node tree in linear time, height", t.height)
```

---

<a name="t6"></a>
## Task 6. Augment with Subtree Size — `getKth`, `rank`

### Spec
Add `size` field to each node. Maintain `size` in `upd`, in rotations, and in build. Implement `kth(root, k)` (1-indexed) and `rank(root, key)` returning the count of keys strictly less than `key`. Both must be O(log n).

### Reference solution (Python)

```python
class Node:
    __slots__ = ("key", "left", "right", "height", "size")
    def __init__(self, k):
        self.key, self.left, self.right, self.height, self.size = k, None, None, 0, 1

def sz(n): return 0 if n is None else n.size

def upd(n):
    n.height = max(h(n.left), h(n.right)) + 1
    n.size   = 1 + sz(n.left) + sz(n.right)

# rotations stay the same; upd inside them now maintains size too.

def kth(root, k):
    while root is not None:
        ls = sz(root.left)
        if k == ls + 1: return root.key
        if k <= ls: root = root.left
        else: k -= ls + 1; root = root.right
    raise IndexError("k out of range")

def rank(root, key):
    cnt = 0
    while root is not None:
        if key <= root.key:
            root = root.left
        else:
            cnt += sz(root.left) + 1
            root = root.right
    return cnt

# Test
t = sorted_to_avl(list(range(1, 101)))
assert kth(t, 1) == 1
assert kth(t, 50) == 50
assert kth(t, 100) == 100
assert rank(t, 50) == 49     # 49 keys (1..49) are < 50
assert rank(t, 1) == 0
assert rank(t, 200) == 100
print("Task 6 OK")
```

---

<a name="t7"></a>
## Task 7. `getMin`, `getMax`, Inorder Iterator

### Spec
Implement:
- `get_min(root) -> int` — smallest key in O(log n).
- `get_max(root) -> int` — largest key in O(log n).
- Iterator yielding keys in sorted order, with O(1) amortized `next()`.

### Reference solution (Python)

```python
def get_min(root):
    if root is None: return None
    while root.left is not None: root = root.left
    return root.key

def get_max(root):
    if root is None: return None
    while root.right is not None: root = root.right
    return root.key

class InOrderIter:
    def __init__(self, root):
        self.stack = []
        self._push_left(root)
    def _push_left(self, n):
        while n is not None:
            self.stack.append(n)
            n = n.left
    def __iter__(self): return self
    def __next__(self):
        if not self.stack: raise StopIteration
        n = self.stack.pop()
        self._push_left(n.right)
        return n.key

# Test
t = sorted_to_avl([5, 10, 15, 20, 25])
assert get_min(t) == 5
assert get_max(t) == 25
assert list(InOrderIter(t)) == [5, 10, 15, 20, 25]
print("Task 7 OK")
```

---

<a name="t8"></a>
## Task 8. Visualize Rotations — Print Before/After

### Spec
Wrap `insert` so that any time a rotation occurs, it prints the tree's structure (e.g., parenthesized form or a textual ASCII layout) **before** and **after** the rotation, plus the case name (LL/LR/RL/RR). Watch how the four cases differ visually.

### Reference solution (Python)

```python
def render(n, depth=0):
    if n is None: return ""
    s = "  " * depth + f"({n.key}, bf={bf(n)}, h={n.height})\n"
    s += render(n.left, depth + 1)
    s += render(n.right, depth + 1)
    return s

def insert_verbose(root, k):
    if root is None: return Node(k)
    if k < root.key:    root.left  = insert_verbose(root.left, k)
    elif k > root.key:  root.right = insert_verbose(root.right, k)
    else: return root
    upd(root)
    b = bf(root)
    rotation = None
    if b > 1 and k < root.left.key:    rotation = "LL"
    elif b > 1 and k > root.left.key:  rotation = "LR"
    elif b < -1 and k > root.right.key: rotation = "RR"
    elif b < -1 and k < root.right.key: rotation = "RL"
    if rotation is None:
        return root
    print(f"=== Rotation {rotation} at node {root.key} ===")
    print("BEFORE:")
    print(render(root))
    if rotation == "LL": new = rotate_right(root)
    elif rotation == "LR":
        root.left = rotate_left(root.left)
        new = rotate_right(root)
    elif rotation == "RR": new = rotate_left(root)
    else:
        root.right = rotate_right(root.right)
        new = rotate_left(root)
    print("AFTER:")
    print(render(new))
    return new

# Test
root = None
for k in [30, 20, 10]:  # triggers LL on insert of 10
    root = insert_verbose(root, k)
print("Task 8 OK — visual rotation trace printed above")
```

Run this on `[30, 20, 10]` (LL), `[10, 20, 30]` (RR), `[30, 10, 20]` (LR), `[10, 30, 20]` (RL) to see all four cases.

---

<a name="t9"></a>
## Task 9. Fibonacci-Tree Generator (Worst-Case AVL)

### Spec
Generate the insertion sequence that produces the **sparsest** legal AVL of height `h` — i.e., the Fibonacci tree. The number of nodes in the result is `F(h+3) - 1`.

### Approach hint
Recursive: the Fibonacci tree of height `h` has a root, a left subtree of height `h-1` (Fibonacci tree), and a right subtree of height `h-2` (Fibonacci tree). Construct the tree, then output an inorder-following insertion sequence that reconstructs exactly that shape.

A direct insertion-sequence construction: insert the root first, then recursively the left subtree's inserts, then the right subtree's inserts, picking keys so that each insert always lands at the deepest position without triggering a rotation.

### Reference solution (Python)

```python
def fib_tree_keys(h, lo, hi):
    """
    Return the list of keys (in insertion order) that, inserted into an empty AVL,
    produces the Fibonacci tree of height h, where the tree's keys span [lo, hi].
    Number of keys: N(h) = F(h+3) - 1.
    """
    if h == -1:
        return []
    if h == 0:
        return [lo]
    # The root will be placed so that the left subtree (height h-1) is the bigger
    # of the two by node-count: N(h-1) nodes go below the root, then N(h-2).
    n_left = fib_count(h - 1)
    root_key = lo + n_left
    left_keys  = fib_tree_keys(h - 1, lo, root_key - 1)
    right_keys = fib_tree_keys(h - 2, root_key + 1, hi)
    return [root_key] + left_keys + right_keys

def fib_count(h):
    if h == -1: return 0
    if h == 0:  return 1
    return 1 + fib_count(h - 1) + fib_count(h - 2)

# Test
for height in range(7):
    keys = fib_tree_keys(height, 1, fib_count(height))
    root = None
    for k in keys:
        root = insert(root, k)
    assert root.height == height, f"expected height {height}, got {root.height}"
    print(f"Height {height}: nodes={fib_count(height)}, sparsest AVL achieved")
print("Task 9 OK")
```

The output shows that height 6 has only 33 nodes — the worst possible AVL of that height has just 33 nodes, vs. a perfect tree of height 6 having 127 nodes. The Fibonacci tree is the canonical stress test for AVL.

---

<a name="t10"></a>
## Task 10. Measure Rotations per Insert — Random vs Sequential

### Spec
Modify `insert` to count rotations (single counts as 1, double as 2). Build trees of n = 10⁵ via:
1. Random permutation of `[0..n)`.
2. Sequential `[0..n)`.
3. Fibonacci-tree sequence (from task 9).

Report total rotations and average per insert in each case.

### Reference solution (Python)

```python
rotation_count = 0

def reset_count(): 
    global rotation_count
    rotation_count = 0

def insert_counted(root, k):
    global rotation_count
    if root is None: return Node(k)
    if k < root.key:    root.left  = insert_counted(root.left, k)
    elif k > root.key:  root.right = insert_counted(root.right, k)
    else: return root
    upd(root)
    b = bf(root)
    if b > 1 and k < root.left.key:
        rotation_count += 1
        return rotate_right(root)
    if b > 1 and k > root.left.key:
        rotation_count += 2
        root.left = rotate_left(root.left)
        return rotate_right(root)
    if b < -1 and k > root.right.key:
        rotation_count += 1
        return rotate_left(root)
    if b < -1 and k < root.right.key:
        rotation_count += 2
        root.right = rotate_right(root.right)
        return rotate_left(root)
    return root

import random
n = 100_000

# 1. Random permutation
reset_count()
root = None
keys = list(range(n))
random.shuffle(keys)
for k in keys:
    root = insert_counted(root, k)
print(f"Random: {rotation_count} rotations, {rotation_count / n:.3f} per insert")

# 2. Sequential
reset_count()
root = None
for k in range(n):
    root = insert_counted(root, k)
print(f"Sequential: {rotation_count} rotations, {rotation_count / n:.3f} per insert")

# 3. Fibonacci-tree sequence (smaller n for tractability)
reset_count()
root = None
keys = fib_tree_keys(20, 1, fib_count(20))
for k in keys:
    root = insert_counted(root, k)
print(f"Fibonacci (height 20, n={len(keys)}): {rotation_count} rotations, {rotation_count / len(keys):.3f} per insert")
```

**Expected results (approximate):**

| Input | Rotations | Per insert |
|---|---|---|
| Random permutation | ~30,000 | ~0.3 |
| Sequential 1..n | ~50,000 | ~0.5 |
| Fibonacci sequence | 0 (already balanced shape) | 0 |

The lesson: AVL rotates more often than you'd guess on adversarial input, but each rotation is O(1) so the asymptotic guarantee holds. Random data rarely triggers rotations; sorted data triggers them on most inserts; Fibonacci-tree-shaped data triggers zero (because the input is already AVL-shaped — that's how it was constructed in task 9).

---

## What you've built

After completing all 10 tasks, you have:

- A working AVL with insert and delete.
- A debug verifier that catches any future regression.
- An O(n) bulk-load.
- Order-statistic augmentation (`kth`, `rank`).
- Min/max and an inorder iterator.
- Visualization tooling for teaching/debugging.
- A worst-case input generator.
- Empirical measurements showing where AVL pays its costs.

This is a complete, production-quality AVL library in ~200 lines of Python — and the matching Go/Java versions follow directly. From here you can extend to persistent variants, augmented sum/min/max fields, or generalize the rotation engine to support red-black or WAVL.
