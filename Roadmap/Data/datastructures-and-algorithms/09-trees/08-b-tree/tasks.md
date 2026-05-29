# B-Tree — Hands-On Tasks

> **Audience:** Anyone who has read `junior.md` and wants to cement the structure by implementing it. Tasks are ordered from foundational to advanced. Each task has acceptance criteria, hints, and a reference solution sketch.

Tasks 1–3 build the core in-memory B-tree. Tasks 4–7 add functionality (bulk load, range queries, kth-smallest, pretty printing). Tasks 8–10 push to advanced territory: copy-on-write, disk persistence, concurrency.

Pick your language (Go / Java / Python). All reference solutions below are in Python for brevity — Go and Java translations are straightforward and follow the patterns in `junior.md` §10.

---

## Task 1 — In-memory B-tree: search + insert with proactive split

**Goal:** Build `BTree(t)` supporting `insert(key)` and `search(key) -> bool`. Use the proactive-split insert from `junior.md` §10/§11.

**Acceptance:**
- `BTree(2)`, insert random `0..999` shuffled — `search(k)` returns `True` for every inserted `k` and `False` for every absent `k`.
- After each insert, the tree obeys all five invariants from `junior.md` §5.
- Height ≤ `log_t((n+1)/2) + 1`.

**Hints:**
- The split function is the trickiest piece. The median is at index `t-1` of the full child's `keys`. The left half is `keys[0..t-2]`; the right half is `keys[t..2t-2]`.
- After splitting `parent.children[i]`, the parent has one extra key inserted at index `i`, so reconsider whether the descent should go to index `i` or `i+1`.

**Reference (Python):** See `junior.md` §10.1.

---

## Task 2 — Delete with redistribute/merge

**Goal:** Add `delete(key)` to the tree from Task 1. Use proactive fill on the way down: before stepping into a child with `t-1` keys, borrow from a sibling or merge.

**Acceptance:**
- After every insert + delete sequence on a random workload of 10,000 operations, the tree's keys match a `set` oracle.
- After every delete, all five B-tree invariants still hold.
- The root collapses (`root = root.children[0]`) when it ends up empty after delete.

**Hints:**
- Three structural cases (`junior.md` §10.4). Memorize them.
- For "find predecessor": walk to the rightmost leaf of the left child; the largest key there is the predecessor.
- Always try **borrow** before **merge**. Borrow is one O(1) operation; merge costs O(t) and changes the parent's structure.

**Reference (Python):** See `junior.md` §10.4 — full annotated implementation.

---

## Task 3 — Inorder traversal yielding sorted keys

**Goal:** Implement `inorder()` returning a generator/iterator of all keys in ascending order.

**Acceptance:**
- For any B-tree built from any sequence of inserts, `list(tree.inorder()) == sorted(tree.keys)` where `tree.keys` is the multiset of inserted keys.
- Generator is **lazy** — does not materialize the whole list. Pulling `next()` returns the next key in O(log n) amortized.

**Hints:**
- Recursive form is trivial: for each internal node, walk children left-to-right and yield separator keys in between.
- Lazy variant: use a stack of `(node, index)` pairs. Push the root, push the leftmost path. Each `next()` pops, yields a key, and pushes the next child's leftmost path.

**Reference (Python):**

```python
def inorder(self):
    yield from self._inorder(self.root)

def _inorder(self, node):
    for i in range(len(node.keys)):
        if not node.leaf:
            yield from self._inorder(node.children[i])
        yield node.keys[i]
    if not node.leaf:
        yield from self._inorder(node.children[-1])
```

Lazy stack variant:
```python
def inorder_lazy(self):
    stack = []
    def push_left(node):
        while True:
            stack.append((node, 0))
            if node.leaf: break
            node = node.children[0]
    push_left(self.root)
    while stack:
        node, i = stack.pop()
        yield node.keys[i]
        if i + 1 < len(node.keys):
            stack.append((node, i + 1))
        if not node.leaf:
            push_left(node.children[i + 1])
```

---

## Task 4 — Bulk-load from a sorted stream

**Goal:** Implement `BTree.bulk_load(sorted_iter, t)` returning a fully-built B-tree in O(n) without any splits.

**Acceptance:**
- For inputs of size up to 10⁶, completes in < 2 seconds in Python (any reasonable implementation).
- Result equals what you would get from individual inserts in terms of contents.
- Average node fill ≥ 90% (proves no internal splits happened during loading).

**Hints:**
- Build the leaf layer first (greedily pack `2t-1` keys per leaf).
- For each subsequent layer, take pairs (or up-to-`2t`) of children, promote the smallest key of each non-first child as a separator.
- Stop when one node remains; it is the root.

**Reference:** See `middle.md` §4.

---

## Task 5 — Range query `[lo, hi]`

**Goal:** Implement `range(lo, hi)` returning all keys in the inclusive range, in ascending order.

**Acceptance:**
- For a tree of `n = 10⁵` random keys with 1,000 random range queries, results match `sorted(set(arr) & range(lo, hi+1))`.
- Visits only O(log_t n + k/t) nodes for `k` results — verify by counting node visits and comparing to a sanity bound.

**Hints:**
- At each node, find the first key `≥ lo` using binary search.
- Walk keys left to right; recurse into left children as you go.
- Stop the moment a key exceeds `hi`.

**Reference:** See `interview.md` Problem 3.

---

## Task 6 — Augment with subtree size; implement kth-smallest

**Goal:** Add a `size` field to every node and maintain it on insert/delete/split/merge. Implement `kth(k) -> key`.

**Acceptance:**
- For a tree of `n = 10⁴` random distinct keys, `tree.kth(k) == sorted(keys)[k-1]` for every `k ∈ [1, n]`.
- After 10,000 random insert + delete operations, the size field on the root equals the current number of keys.

**Hints:**
- After any mutation that changes a subtree's key count, walk the path back to the root and recompute `node.size = sum(child.size for child) + len(node.keys)`.
- For kth-smallest: at each internal node, walk children left to right summing `child.size` plus 1 for each separator. When the cumulative count would meet or exceed `k`, recurse into that child.
- See `interview.md` Problem 4 for the algorithm.

---

## Task 7 — Pretty-print: per-level horizontal layout

**Goal:** Implement `tree.show()` that prints the tree level by level, with each node showing its key list and the lines between connecting children to parents.

**Acceptance:**
- For small trees (≤ 20 keys), the output fits on a single screen and visually conveys the structure.
- Each level's nodes are listed in left-to-right order.

**Hints:**
- Use BFS by level. At each level print each node's `[k0, k1, ...]` with a separator (e.g., `   `).
- For an extra-pretty version, compute the horizontal positions so children align under their parent's separator. Most teaching implementations skip this and just print levels.

**Reference (Python):**
```python
def show(self):
    if not self.root.keys:
        print("(empty)")
        return
    level = [self.root]
    while level:
        print("  ".join("[" + ",".join(str(k) for k in node.keys) + "]" for node in level))
        next_level = []
        for node in level:
            next_level.extend(node.children)
        level = next_level
```

For the canonical inserts of `junior.md` §9 (`10,20,5,6,12,30,7,17`) with `t=3`, the output is:
```
[10]
[5,6,7]  [12,17,20,30]
```

---

## Task 8 — Persistent B-tree using path copying

**Goal:** Implement `PersistentBTree` where each `insert(key)` returns a **new tree** sharing all unmodified subtrees with the old one. The original tree must remain unchanged.

**Acceptance:**
- `t1 = PersistentBTree(t); t2 = t1.insert(5); t3 = t2.insert(7)` — `t1.keys() == []`, `t2.keys() == [5]`, `t3.keys() == [5, 7]`.
- Memory usage for `n` snapshots of an `m`-key tree is O(n + m × log_t m), not O(n × m).
- Search on any old snapshot still works.

**Hints:**
- The insert never mutates an existing node. Each modified node is copied; its unchanged children are aliased from the old version. Modified children become new copies.
- The data structure looks like a stream of root pointers, each rooting a tree that shares most of its body with previous roots.
- Splits create entirely new nodes for both halves; the old (full) node is left unreferenced by the new tree but still referenced by older snapshots.

**Reference (Python):**

```python
class PNode:
    __slots__ = ("t", "keys", "children", "leaf")
    def __init__(self, t, keys=None, children=None, leaf=True):
        self.t = t; self.keys = keys or []; self.children = children or []; self.leaf = leaf

def p_insert(root, key, t):
    if len(root.keys) == 2 * t - 1:
        new_root = PNode(t, leaf=False, children=[root])
        new_root = p_split(new_root, 0)
        return p_insert_nonfull(new_root, key)
    return p_insert_nonfull(root, key)

def p_split(parent, idx):
    t = parent.t
    full = parent.children[idx]
    median = full.keys[t-1]
    left = PNode(t, keys=list(full.keys[:t-1]),
                 children=list(full.children[:t]) if not full.leaf else [],
                 leaf=full.leaf)
    right = PNode(t, keys=list(full.keys[t:]),
                  children=list(full.children[t:]) if not full.leaf else [],
                  leaf=full.leaf)
    new_parent = PNode(t,
        keys=parent.keys[:idx] + [median] + parent.keys[idx:],
        children=parent.children[:idx] + [left, right] + parent.children[idx+1:],
        leaf=False)
    return new_parent

def p_insert_nonfull(node, key):
    if node.leaf:
        i = 0
        while i < len(node.keys) and node.keys[i] < key:
            i += 1
        new_keys = node.keys[:i] + [key] + node.keys[i:]
        return PNode(node.t, keys=new_keys, leaf=True)
    i = 0
    while i < len(node.keys) and node.keys[i] < key:
        i += 1
    child = node.children[i]
    if len(child.keys) == 2 * node.t - 1:
        node = p_split(node, i)
        if key > node.keys[i]:
            i += 1
        child = node.children[i]
    new_child = p_insert_nonfull(child, key)
    new_children = node.children[:i] + [new_child] + node.children[i+1:]
    return PNode(node.t, keys=list(node.keys), children=new_children, leaf=False)
```

Wrap with a class that tracks the root pointer for each "version".

---

## Task 9 — Disk-backed B-tree (Go implementation recommended)

**Goal:** Build a B-tree whose nodes live in fixed-size pages of a binary file. Each node occupies exactly one page (e.g., 4 KB). The tree survives restart.

**Acceptance:**
- Open a file, insert 10,000 keys, close. Reopen the file, search for all keys — every search returns hit.
- Use a simple LRU buffer pool (~100 pages).
- Crash recovery is **not** required (Task 10 covers WAL); but the modified root pointer is the **last** byte written so a clean shutdown is consistent.

**Hints:**
- Page layout (see `interview.md` Problem 10 for details).
- Free-list at page 0; current root pointer in the header.
- Use `bytes.Buffer` / `bytearray` for serialization. Fixed-width int64 keys keep the layout simple.
- Buffer pool: a `map[PageID]*Node` for cache + a list of recently-used IDs for LRU eviction.

**Go skeleton:**

```go
package diskbtree

const PageSize = 4096
const T = 100 // minimum degree

type PageID uint64

type Pager struct {
    f        *os.File
    cache    map[PageID]*Node
    dirty    map[PageID]bool
    rootID   PageID
}

func Open(path string) (*Pager, error) { ... }
func (p *Pager) Read(id PageID) (*Node, error) { ... }
func (p *Pager) Write(id PageID, n *Node) error { ... }
func (p *Pager) Alloc() (PageID, error) { ... }
func (p *Pager) Flush() error { ... }
func (p *Pager) Close() error { ... }
```

**Reference:** Look at bbolt's `node.go` and `page.go` (~500 lines combined) for production-grade page layout.

---

## Task 10 — Concurrency: hand-over-hand locking insert/search

**Goal:** Make the in-memory B-tree thread-safe using **lock coupling** (latch crabbing): only acquire the next lock before releasing the current one; multiple readers must be able to descend concurrently.

**Acceptance:**
- 10 reader threads searching while 1 writer thread inserts produces no panics, deadlocks, or missed keys.
- A reader that starts descent before a writer's split still finds the key (either in the un-split node before the writer reaches it, or in the new structure after).
- Use `sync.RWMutex` (Go), `ReentrantReadWriteLock` (Java), or `threading.RLock` (Python).

**Hints:**
- For **search**: acquire R-lock on root. Loop: pick child, acquire R-lock on child, release R-lock on parent.
- For **insert**: acquire W-lock on root. Loop: pick child, acquire W-lock on child. If child is "safe" (not full), release W-locks on all ancestors. Otherwise hold them.
- Tracking "all ancestors I still hold" cleanly in code requires a stack.

**Go reference:**

```go
type Node struct {
    mu       sync.RWMutex
    keys     []int
    children []*Node
    leaf     bool
}

func (tr *Tree) Search(key int) bool {
    tr.root.mu.RLock()
    cur := tr.root
    for !cur.leaf {
        i := 0
        for i < len(cur.keys) && key > cur.keys[i] { i++ }
        if i < len(cur.keys) && cur.keys[i] == key {
            cur.mu.RUnlock()
            return true
        }
        child := cur.children[i]
        child.mu.RLock()
        cur.mu.RUnlock()           // hand off
        cur = child
    }
    // leaf
    found := false
    for _, k := range cur.keys {
        if k == key { found = true; break }
    }
    cur.mu.RUnlock()
    return found
}

// Insert uses the same pattern with W-locks; release ancestors when a "safe" child is reached.
```

For an optimistic-latching variant (read-locks on the descent, upgrade to write-lock only at the leaf, retry pessimistically on conflict), see `middle.md` §5 — this is closer to what real engines do.

---

## Testing strategy across all tasks

Build a **single test harness** you reuse for every task:

```python
def stress_test(t, ops):
    tree = BTree(t)
    oracle = sorted([])   # or use a sortedcontainers.SortedList
    for op, key in ops:
        if op == "ins":
            tree.insert(key); insort(oracle, key)
        elif op == "del":
            tree.delete(key)
            if key in oracle: oracle.remove(key)
        elif op == "find":
            assert tree.search(key) == (key in oracle)
        elif op == "kth":
            assert tree.kth(key) == oracle[key - 1]
        elif op == "range":
            lo, hi = key
            assert list(tree.range(lo, hi)) == [k for k in oracle if lo <= k <= hi]
        assert tree.verify(), f"invariant broken after {op} {key}"
```

Drive it with `random.choices` and `random.shuffle`. A single 10,000-op fuzz run typically catches all the standard bugs (off-by-ones, missing root collapse, separator confusion, etc.).

---

## Recommended order

1. Task 1 (insert) — get the structure right.
2. Task 3 (inorder) — gives you the sanity check.
3. Task 8 (verify, from `interview.md` Problem 8) — integrate into every later test.
4. Task 2 (delete) — the hardest single task.
5. Task 5 (range), Task 6 (kth) — additive features.
6. Task 4 (bulk load) — quick once tests work.
7. Task 7 (pretty-print) — invaluable for debugging Task 9 and beyond.
8. Task 8 (persistent) — exercises the immutability mindset.
9. Task 9 (disk) — exercises serialization.
10. Task 10 (concurrent) — capstone.

If you complete all 10 with passing fuzz tests, you have implemented something close to a production-grade embedded ordered KV store. Compare your code line-count to bbolt (~1,500 lines) and SQLite's `btree.c` (~10,000 lines) to calibrate your accomplishment.
