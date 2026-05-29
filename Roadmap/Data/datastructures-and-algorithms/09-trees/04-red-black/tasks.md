# Red-Black Tree — Hands-On Tasks

> Implement these in your language of choice. Suggested order: 1 → 2 → 3 → 5 → 4 → 6 → 7 → 8 → 9 → 10. Each task lists the goal, the approach, and a reference solution.

---

## Task 1 — Node with Color Enum and NIL Sentinel

**Goal.** Define the Node type with a strongly typed color and a singleton NIL sentinel.

**Why first.** Every subsequent task assumes this shape. Get the type model right and the code below falls out cleanly.

**Approach.**
- Use an `enum`-style type for color: `RED` and `BLACK`. Boolean is fine; bit field is fine.
- Allocate a single NIL node per tree (or per type, globally).
- NIL has `color = BLACK`, undefined key, and (importantly) `left = right = parent = NIL` (self-reference). Self-reference simplifies fixup boundary cases.

**Go reference:**
```go
type color bool
const (
    red   color = true
    black color = false
)

type Node struct {
    key                 int
    color               color
    left, right, parent *Node
}

type Tree struct {
    root *Node
    nil_ *Node
}

func New() *Tree {
    sentinel := &Node{color: black}
    // Self-reference: simplifies fixup edge cases.
    sentinel.left = sentinel
    sentinel.right = sentinel
    sentinel.parent = sentinel
    return &Tree{root: sentinel, nil_: sentinel}
}
```

**Test.** `t := New(); t.root == t.nil_` and `t.nil_.color == black`.

---

## Task 2 — leftRotate / rightRotate Handling NIL Correctly

**Goal.** Implement rotations that correctly maintain parent pointers and handle the case where the rotated node was the root.

**Approach.** The rotation reroots a small subtree. Three pointer updates:
1. Move the inner subtree (`y.left` for left rotation) to be `x`'s new right child.
2. Update `y`'s parent to `x`'s old parent (handling the "x was root" case).
3. Make `x` the new left child of `y`.

Carefully update every reverse parent pointer (the moved subtree's parent, `y.parent`, `x.parent`).

**Go reference:**
```go
func (t *Tree) leftRotate(x *Node) {
    y := x.right
    x.right = y.left
    if y.left != t.nil_ {
        y.left.parent = x
    }
    y.parent = x.parent
    switch {
    case x.parent == t.nil_:
        t.root = y
    case x == x.parent.left:
        x.parent.left = y
    default:
        x.parent.right = y
    }
    y.left = x
    x.parent = y
}

func (t *Tree) rightRotate(y *Node) {
    x := y.left
    y.left = x.right
    if x.right != t.nil_ {
        x.right.parent = y
    }
    x.parent = y.parent
    switch {
    case y.parent == t.nil_:
        t.root = x
    case y == y.parent.right:
        y.parent.right = x
    default:
        y.parent.left = x
    }
    x.right = y
    y.parent = x
}
```

**Test.** Build a 3-node tree `{10, [5, 15]}`, rotate left around `10`, verify the BST property and parent pointers.

---

## Task 3 — Insert + Insert-Fixup with All 6 Cases

**Goal.** Implement `insert(key)` that does a standard BST insertion (new node colored red) followed by the case-analysis fixup that restores red-black properties.

**Approach.** Walk down to find the insertion point, attach the new red node, then loop upward fixing violations:

1. If `z.parent` is black, no violation, exit.
2. Identify the uncle. If uncle is red → Case 1: recolor and move up.
3. Otherwise the uncle is black. If `z` is the "inner" grandchild (zig-zag), rotate the parent to convert to "outer" → Case 2. Then recolor parent black, grandparent red, rotate grandparent → Case 3.
4. Symmetric mirror cases when `z.parent` is a right child.
5. After the loop, set `root.color = BLACK`.

**Full reference code is in `junior.md` section 11.2-11.4.**

**Test.** Insert the sequence `[10, 20, 30, 15, 25, 5, 7, 12, 50, 8]` and verify all 5 properties hold after each insert (using task 5's validator).

---

## Task 4 — Delete + Delete-Fixup

**Goal.** Implement `delete(key)` covering all 4 cases of the deletion fixup.

**Approach.** Detailed in `interview.md` problem 2. The framework:
1. Find the node `z`.
2. Splice it out (or splice out its in-order successor `y` if `z` has 2 children).
3. Track `y_orig_color`. If it was BLACK, run `deleteFixup(x)` where `x` is the node that replaced the spliced-out one.
4. `deleteFixup` carries an "extra black" up the tree via 4 cases on the sibling `w` of `x`.

**Java reference (full):**
```java
public void delete(K key) {
    Node<K> z = search(key);
    if (z == NIL) return;
    Node<K> y = z, x;
    boolean yOrigColor = y.color;
    if (z.left == NIL) {
        x = z.right;
        transplant(z, z.right);
    } else if (z.right == NIL) {
        x = z.left;
        transplant(z, z.left);
    } else {
        y = minimum(z.right);
        yOrigColor = y.color;
        x = y.right;
        if (y.parent == z) {
            x.parent = y;
        } else {
            transplant(y, y.right);
            y.right = z.right;
            y.right.parent = y;
        }
        transplant(z, y);
        y.left = z.left;
        y.left.parent = y;
        y.color = z.color;
    }
    if (yOrigColor == BLACK) deleteFixup(x);
}

private void transplant(Node<K> u, Node<K> v) {
    if (u.parent == NIL)            root = v;
    else if (u == u.parent.left)    u.parent.left = v;
    else                            u.parent.right = v;
    v.parent = u.parent;
}

private Node<K> minimum(Node<K> x) {
    while (x.left != NIL) x = x.left;
    return x;
}

private void deleteFixup(Node<K> x) {
    while (x != root && x.color == BLACK) {
        if (x == x.parent.left) {
            Node<K> w = x.parent.right;
            if (w.color == RED) {                       // Case 1
                w.color = BLACK;
                x.parent.color = RED;
                leftRotate(x.parent);
                w = x.parent.right;
            }
            if (w.left.color == BLACK && w.right.color == BLACK) {   // Case 2
                w.color = RED;
                x = x.parent;
            } else {
                if (w.right.color == BLACK) {                         // Case 3
                    w.left.color = BLACK;
                    w.color = RED;
                    rightRotate(w);
                    w = x.parent.right;
                }
                w.color = x.parent.color;                             // Case 4
                x.parent.color = BLACK;
                w.right.color = BLACK;
                leftRotate(x.parent);
                x = root;
            }
        } else {
            Node<K> w = x.parent.left;
            if (w.color == RED) {
                w.color = BLACK;
                x.parent.color = RED;
                rightRotate(x.parent);
                w = x.parent.left;
            }
            if (w.right.color == BLACK && w.left.color == BLACK) {
                w.color = RED;
                x = x.parent;
            } else {
                if (w.left.color == BLACK) {
                    w.right.color = BLACK;
                    w.color = RED;
                    leftRotate(w);
                    w = x.parent.left;
                }
                w.color = x.parent.color;
                x.parent.color = BLACK;
                w.left.color = BLACK;
                rightRotate(x.parent);
                x = root;
            }
        }
    }
    x.color = BLACK;
}
```

**Test.** Insert 1..15 sequentially, then delete in random order, verifying the validator passes after each delete.

---

## Task 5 — Validator: Check All 5 Properties

**Goal.** Write a debug `validate()` that returns true iff the tree satisfies all 5 red-black properties.

**Approach.** One recursive helper that returns the subtree's black-height or `-1` if invalid. The full code is in `interview.md` problem 3.

**Why critical.** Every RB tree bug manifests as a property violation. Without this check, you'll spend hours wondering why `delete` corrupted the tree. With it, you know within one iteration which property broke.

**Extra checks worth adding:**
- Every internal node's parent pointer is consistent with the parent's left/right child.
- No cycles in the tree (already implied by valid parent/child, but worth a separate test).
- `tree.root.parent == NIL` and `NIL.color == BLACK`.

```python
def validate_strict(self):
    if self.root is self.NIL:
        return True
    if self.root.color != BLACK or self.root.parent is not self.NIL:
        return False
    seen = set()
    def walk(node, parent):
        if node is self.NIL:
            return 1
        if node in seen:
            raise ValueError("cycle detected")
        seen.add(node)
        if node.parent is not parent:
            raise ValueError(f"parent mismatch at key {node.key}")
        if node.color == RED:
            if node.left.color == RED or node.right.color == RED:
                raise ValueError(f"red-red at key {node.key}")
        left_bh = walk(node.left, node)
        right_bh = walk(node.right, node)
        if left_bh != right_bh:
            raise ValueError(f"black-height mismatch at key {node.key}")
        return left_bh + (0 if node.color == RED else 1)
    walk(self.root, self.NIL)
    return True
```

**Test.** Tamper with a working tree (manually set a node red incorrectly) and verify validator catches it.

---

## Task 6 — Implement LLRB (Sedgewick) and Compare Line Counts

**Goal.** Implement Sedgewick's Left-Leaning Red-Black tree in your language. Compare the total line count with your CLRS implementation.

**Approach.** Detailed in `middle.md` section 4. The whole insert is ~30 lines. The delete is harder — see Sedgewick's paper or "Algorithms" 4th ed. for the `moveRedLeft` / `moveRedRight` helpers.

**Python LLRB insert (full):**
```python
RED, BLACK = True, False

class LLRBNode:
    __slots__ = ('key', 'left', 'right', 'color')
    def __init__(self, key, color=RED):
        self.key = key
        self.left = self.right = None
        self.color = color

class LLRB:
    def __init__(self):
        self.root = None
    @staticmethod
    def is_red(node):
        return node is not None and node.color == RED
    @staticmethod
    def rotate_left(h):
        x = h.right
        h.right = x.left
        x.left = h
        x.color = h.color
        h.color = RED
        return x
    @staticmethod
    def rotate_right(h):
        x = h.left
        h.left = x.right
        x.right = h
        x.color = h.color
        h.color = RED
        return x
    @staticmethod
    def flip_colors(h):
        h.color = not h.color
        h.left.color = not h.left.color
        h.right.color = not h.right.color
    def _insert(self, h, key):
        if h is None:
            return LLRBNode(key, RED)
        if key < h.key:    h.left = self._insert(h.left, key)
        elif key > h.key:  h.right = self._insert(h.right, key)
        if self.is_red(h.right) and not self.is_red(h.left):
            h = self.rotate_left(h)
        if self.is_red(h.left) and self.is_red(h.left.left):
            h = self.rotate_right(h)
        if self.is_red(h.left) and self.is_red(h.right):
            self.flip_colors(h)
        return h
    def insert(self, key):
        self.root = self._insert(self.root, key)
        self.root.color = BLACK
```

**Compare:** CLRS insert in Python (~80 lines including rotations) vs LLRB above (~30 lines). The simplification is real, but LLRB does more rotations on average — measure this in task 9.

---

## Task 7 — Augment with Subtree Size; Implement select/rank

**Goal.** Add a `size` field to every node holding the subtree size. Use it to implement `select(k)` (k-th smallest key) and `rank(key)` (number of keys < key).

**Approach.** Maintain `node.size = node.left.size + node.right.size + 1` (NIL has size 0). Update on every insert, delete, and rotation.

- `select(k)`: walk down, comparing `k` to `node.left.size`. If equal, return `node.key`. If smaller, go left. Else, subtract `left.size + 1` from `k` and go right.
- `rank(key)`: walk down, accumulating subtree sizes on the left side.

**Go reference (rotation must update sizes):**
```go
type Node struct {
    key                 int
    color               color
    size                int        // NEW: subtree size
    left, right, parent *Node
}

func (t *Tree) updateSize(x *Node) {
    if x != t.nil_ {
        x.size = x.left.size + x.right.size + 1
    }
}

func (t *Tree) leftRotate(x *Node) {
    // ... existing rotation code ...
    t.updateSize(x)   // x is now lower; update first
    t.updateSize(x.parent)  // then the new parent (y)
}

func (t *Tree) Select(k int) int {
    if k < 0 || k >= t.root.size {
        panic("out of range")
    }
    x := t.root
    for {
        leftSize := x.left.size
        switch {
        case k == leftSize:
            return x.key
        case k < leftSize:
            x = x.left
        default:
            k -= leftSize + 1
            x = x.right
        }
    }
}

func (t *Tree) Rank(key int) int {
    rank := 0
    x := t.root
    for x != t.nil_ {
        if key < x.key {
            x = x.left
        } else if key > x.key {
            rank += x.left.size + 1
            x = x.right
        } else {
            return rank + x.left.size
        }
    }
    return rank
}
```

**Test.** Insert 100 random unique integers, sort them in a separate slice; assert `select(k) == sorted[k]` and `rank(x) == sorted.bisect_left(x)`.

---

## Task 8 — Sorted-Set Wrapper Offering ceiling/floor/lower/higher

**Goal.** Wrap your RB tree in a clean API matching `java.util.NavigableSet`.

**Approach.** Just the four directional queries plus standard add/remove/contains/iterator. Internal traversal patterns documented in `interview.md` problem 7.

**Python:**
```python
class SortedSet:
    def __init__(self):
        self._tree = RBTree()
        self._size = 0
    def add(self, key):
        if not self.contains(key):
            self._tree.insert(key)
            self._size += 1
    def remove(self, key):
        if self.contains(key):
            self._tree.delete(key)
            self._size -= 1
    def contains(self, key):
        return self._tree.search(key) is not self._tree.NIL
    def ceiling(self, key):
        x, c = self._tree.root, None
        while x is not self._tree.NIL:
            if x.key >= key:
                c, x = x, x.left
            else:
                x = x.right
        return c.key if c else None
    def floor(self, key):
        x, c = self._tree.root, None
        while x is not self._tree.NIL:
            if x.key <= key:
                c, x = x, x.right
            else:
                x = x.left
        return c.key if c else None
    def higher(self, key):
        x, c = self._tree.root, None
        while x is not self._tree.NIL:
            if x.key > key:
                c, x = x, x.left
            else:
                x = x.right
        return c.key if c else None
    def lower(self, key):
        x, c = self._tree.root, None
        while x is not self._tree.NIL:
            if x.key < key:
                c, x = x, x.right
            else:
                x = x.left
        return c.key if c else None
    def __len__(self):
        return self._size
    def __iter__(self):
        return self._inorder(self._tree.root)
    def _inorder(self, node):
        if node is self._tree.NIL:
            return
        yield from self._inorder(node.left)
        yield node.key
        yield from self._inorder(node.right)
```

**Test.** Compare against Java `TreeSet` for the same operation sequence.

---

## Task 9 — Microbenchmark vs AVL: random insert N=10^6

**Goal.** Build a microbenchmark that compares your RB tree, your AVL tree (from topic 03-avl), and a `HashMap`/dict on the same workload.

**Approach.**
1. Generate `N = 1_000_000` random integers (use a seeded RNG so the comparison is fair).
2. Insert all of them into each structure; record elapsed time.
3. Look up each one; record elapsed time.
4. Delete in random order; record elapsed time.
5. Report tree height for the tree structures.

**Python sketch:**
```python
import random, time

def benchmark(name, structure, keys):
    t0 = time.perf_counter()
    for k in keys: structure.insert(k)
    t_ins = time.perf_counter() - t0

    t0 = time.perf_counter()
    for k in keys: structure.search(k)
    t_lkp = time.perf_counter() - t0

    random.shuffle(keys)
    t0 = time.perf_counter()
    for k in keys: structure.delete(k)
    t_del = time.perf_counter() - t0

    print(f"{name}: insert {t_ins:.2f}s | lookup {t_lkp:.2f}s | delete {t_del:.2f}s")

random.seed(42)
keys = random.sample(range(10**8), 1_000_000)
benchmark("RB", RBTree(), keys[:])
benchmark("AVL", AVLTree(), keys[:])
```

**Expected.** RB and AVL within 20% on lookup, RB ~10-30% faster on insert/delete. Both ~5-10× slower than `dict`/`HashMap` for the same workload. RB tree height ~22-24, AVL height ~19-21.

**Lesson.** The numeric difference is small relative to the cost of comparing keys or the cost of `random.sample`. For real systems, choose by API needs (ordered? range queries?), not by microbenchmark.

---

## Task 10 — RB-Backed Ordered Multiset for the Skyline Problem

**Goal.** Solve LeetCode 218 (Skyline Problem) using your RB tree as an ordered multiset.

**Approach.** Detailed in `interview.md` problem 6. The multiset stores active building heights; you query the maximum at each x-event.

**To turn your RB tree into a multiset:**
- Either change comparison to allow duplicates (insert duplicates to the right consistently).
- Or use the tree as a map `height → count`, decrementing on remove.

The second approach is cleaner and matches what Java's `TreeMap` does:

```python
class HeightMultiset:
    def __init__(self):
        self._counts = RBTree()  # tree of (height, count)
    def add(self, height):
        node = self._counts.search(height)
        if node is self._counts.NIL:
            self._counts.insert(height, 1)
        else:
            node.value += 1
    def remove(self, height):
        node = self._counts.search(height)
        node.value -= 1
        if node.value == 0:
            self._counts.delete(height)
    def max(self):
        # Walk to rightmost node
        x = self._counts.root
        if x is self._counts.NIL:
            return 0
        while x.right is not self._counts.NIL:
            x = x.right
        return x.key
```

**Test.** Run on the standard LeetCode test cases and assert correct skyline points.

---

## Suggested Extras (Not Required)

- **Task 11 — Persistent RB.** Implement Okasaki's persistent variant in your language. ~50 lines including delete.
- **Task 12 — Iterator-stable iteration.** Implement an external iterator that survives unrelated inserts/deletes between `next()` calls (matches `TreeMap.Iterator` semantics).
- **Task 13 — Bulk union via Adams' algorithm.** Implement O(m·log(n/m+1)) union for two RB trees. Hardest task in this list.
- **Task 14 — Serialize and deserialize.** Persist the tree to disk; reload in O(n) using the sorted-array construction from `interview.md` problem 8.

Working through tasks 1–10 takes 8-15 hours and leaves you fluent in RB tree mechanics, ready for `senior.md`'s real-world systems context.
