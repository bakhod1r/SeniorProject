# B-Tree — Interview Problems

> **Audience:** Candidates preparing for systems-heavy or database-engineering interviews. Prerequisite: `junior.md` for the proactive-split insert and three-case delete; `middle.md` for bulk load and concurrency.

The B-tree itself rarely shows up as a vanilla LeetCode problem — but in systems interviews (database, storage, search engine, distributed KV), questions like "how would you implement an on-disk index?" or "implement a sorted indexed dictionary like TreeMap" come up constantly. The 10 problems below cover the implementation skills you should be able to demonstrate.

For each problem we discuss the approach, then give Go, Java, and Python sketches.

---

## Problem 1 — Implement B-tree insert with split-on-the-way-down

**Statement:** Build a `BTree(t)` class that supports `insert(key)`. Use the proactive-split algorithm: before descending into a full child, split it.

**Approach:**
1. If the root is full, allocate a new root and split the old root as its child. Tree height grows by 1.
2. Descend non-recursively or recursively. At each internal node, find the child index for the key. If that child is full, split it; the median rises into the parent. Then re-pick the child based on the comparison with the new separator.
3. At the leaf, slot the key into sorted position.

Time: O(t · log_t n). Each level does O(t) work (the slot shift), and there are O(log_t n) levels.

**Python:**
```python
def insert(self, key):
    if self.root.is_full():
        new_root = BTreeNode(self.t, leaf=False)
        new_root.children.append(self.root)
        self._split_child(new_root, 0)
        self.root = new_root
    self._insert_nonfull(self.root, key)

def _insert_nonfull(self, n, key):
    i = len(n.keys) - 1
    if n.leaf:
        n.keys.append(0)
        while i >= 0 and key < n.keys[i]:
            n.keys[i+1] = n.keys[i]; i -= 1
        n.keys[i+1] = key
        return
    while i >= 0 and key < n.keys[i]: i -= 1
    i += 1
    if n.children[i].is_full():
        self._split_child(n, i)
        if key > n.keys[i]: i += 1
    self._insert_nonfull(n.children[i], key)
```

**Go and Java implementations** appear in `junior.md` §10 — they are the canonical reference; reuse them.

**Common gotchas:**
- Forgetting the `if key > new_separator` correction after a split.
- Off-by-one in the split function: the median is at index `t-1`, not `t`.
- Allocating the new root via the old root reference but then forgetting to wire `new_root.children[0] = old_root`.

---

## Problem 2 — Implement B-tree delete with all three cases

**Statement:** Add `delete(key)` to the B-tree. Use proactive fill: before descending into a child with `t-1` keys, top it up to `t` keys by borrow or merge.

**Approach:** Three structural cases, exactly as in `junior.md` §10.4:

1. **Key in a leaf:** remove directly.
2. **Key in an internal node:**
   - If left child has `≥ t` keys, replace with the predecessor (rightmost of left subtree), recurse on the predecessor.
   - Else if right child has `≥ t` keys, replace with the successor, recurse on the successor.
   - Else: merge the two children with the separator in between, then recurse into the merged child.
3. **Key not present here, must descend:** ensure target child has `≥ t` keys (borrow or merge), then recurse.

After the call, if the root has zero keys, promote `root.children[0]`.

**Python:** Full reference in `junior.md`. Key invariant: every recursive call enters a node that already has at least `t` keys (except possibly the root), so any later deletion cannot underflow.

**Go (sketch):**
```go
func (tr *Tree) Delete(key int) {
    tr.delete(tr.root, key)
    if len(tr.root.keys) == 0 && !tr.root.leaf {
        tr.root = tr.root.children[0]
    }
}

func (tr *Tree) delete(n *Node, key int) {
    t := tr.t
    idx := 0
    for idx < len(n.keys) && key > n.keys[idx] { idx++ }
    if idx < len(n.keys) && n.keys[idx] == key {
        if n.leaf {
            n.keys = append(n.keys[:idx], n.keys[idx+1:]...)
        } else {
            tr.deleteInternal(n, idx)
        }
        return
    }
    if n.leaf { return }
    flag := idx == len(n.keys)
    if len(n.children[idx].keys) < t {
        tr.fill(n, idx)
    }
    if flag && idx > len(n.keys) {
        tr.delete(n.children[idx-1], key)
    } else {
        tr.delete(n.children[idx], key)
    }
}
```

`deleteInternal`, `fill`, `borrowFromPrev`, `borrowFromNext`, `merge` mirror the Python code in `junior.md` §10.4.

**Java:** Same structure; flesh out from the Go pseudo-code.

**Common gotchas:**
- Not adjusting the descent index when `flag` is set and `idx > len(node.keys)` after a merge.
- Forgetting to promote `root.children[0]` after the root drains.
- Borrowing from a sibling without updating the parent separator.

---

## Problem 3 — Range query: list keys in `[lo, hi]`

**Statement:** Implement `range(lo, hi)` returning all keys in the inclusive range in ascending order.

**Approach:** In-order traversal pruned by the range bounds. At each internal node with keys `K[0] < K[1] < ... < K[k-1]`:

- For each `K[i]`, recurse into `children[i]` if `lo < K[i]` (its range may overlap).
- If `lo <= K[i] <= hi`, emit `K[i]`.
- After the last key, recurse into `children[k]` if `K[k-1] < hi`.

Pruning is essential: visit only O(log_t n + k/t) nodes for `k` results.

**Python:**
```python
def range_query(self, lo, hi):
    out = []
    self._range(self.root, lo, hi, out)
    return out

def _range(self, node, lo, hi, out):
    i = 0
    while i < len(node.keys) and node.keys[i] < lo: i += 1
    while i < len(node.keys) and node.keys[i] <= hi:
        if not node.leaf:
            self._range(node.children[i], lo, hi, out)
        out.append(node.keys[i])
        i += 1
    if not node.leaf:
        self._range(node.children[i], lo, hi, out)
```

**Time:** O(log_t n + k) for `k` keys in the range. Space O(k).

---

## Problem 4 — Find the k-th smallest key

**Statement:** Augment the tree so each node carries `size = total keys in this subtree`. Implement `kth(k)` returning the k-th smallest key in O(t · log_t n).

**Approach:** At each internal node, walk the keys left to right. For each separator key `K[i]`, the keys in `children[i]` come before it, then `K[i]` itself comes next. So the index of `K[i]` within the whole tree, relative to this node, is `sum(children[0..i].size) + i`. Compare `k` with this running total.

**Maintenance:** Insert and delete must update `size` along the path:
- After every insert, increment `size` on every ancestor.
- After every delete, decrement.
- After every split or merge, recompute `size` for the affected nodes from `len(keys) + sum(child.size)`.

**Python:**
```python
class BTreeNode:
    def __init__(self, t, leaf=True):
        ...
        self.size = 0   # total keys in subtree rooted here

def kth(node, k):
    # k is 1-indexed
    if node.leaf:
        return node.keys[k - 1]
    cur = 0
    for i in range(len(node.keys)):
        sub = node.children[i].size
        if k <= cur + sub:
            return kth(node.children[i], k - cur)
        cur += sub
        if k == cur + 1:
            return node.keys[i]
        cur += 1
    return kth(node.children[-1], k - cur)
```

**Time:** O(log_t n × t). The `× t` is the linear scan within the node; for large `t`, do a prefix-sum binary search to drop it to O(log_t n · log₂ t).

---

## Problem 5 — Bulk load from sorted input

**Statement:** Given a sorted iterator of `n` keys and a parameter `t`, build a B-tree in O(n) without any splits.

**Approach:** Pack the leaf layer left to right, taking the smallest key from each leaf (after the first) as the separator into the next layer up. Repeat until one root remains.

The complete reference Python is in `middle.md` §4. Go and Java versions are mechanical translations.

**Time:** O(n). Space: O(n / t) extra for the layer-building queues.

**Common gotchas:**
- Last leaf may have fewer than `t-1` keys — fine, the root is the only node permitted to have any count from 1 upward, and the **last** node at every level is also lenient in practice.
- Forgetting to set `leaf = False` on internal-node objects after the first level.
- Choosing the wrong separator key (median vs first vs last of the right child); in a B-tree, the first key of the right child is conventional.

---

## Problem 6 — Concurrent B-tree with lock coupling

**Statement:** Make the B-tree thread-safe for many concurrent readers and one writer at a time using lock coupling (latch crabbing).

**Approach:** Each node carries a `sync.RWMutex` (Go) / `ReentrantReadWriteLock` (Java) / `threading.Lock` + `threading.Condition` (Python).

**Search:**
1. Acquire read lock on root.
2. While not at leaf: pick child, acquire read lock on child, release read lock on parent.

**Insert:**
1. Acquire write lock on root.
2. Descend: for each step, acquire write lock on child. If child is **safe** (not full), release write locks on all ancestors. Otherwise hold them.
3. At leaf, perform the insert (and propagate split upward — though with proactive splitting in step 2 there is no upward propagation).

**Go sketch:**
```go
type Node struct {
    mu       sync.RWMutex
    keys     []int
    children []*Node
    leaf     bool
}

func (tr *Tree) Search(key int) bool {
    tr.root.mu.RLock()
    return search(tr.root, key)
}

func search(n *Node, key int) bool {
    defer n.mu.RUnlock()
    i := 0
    for i < len(n.keys) && key > n.keys[i] { i++ }
    if i < len(n.keys) && n.keys[i] == key { return true }
    if n.leaf { return false }
    child := n.children[i]
    child.mu.RLock()
    // release parent before recursing — "crabbing"
    n.mu.RUnlock()
    // re-defer for child... easier expressed iteratively
    ...
}
```

In practice, write the search iteratively so you can manually release the parent before recursing. For the insert, see the optimistic-latching discussion in `middle.md` §5 — most production engines use that variant.

---

## Problem 7 — Sorted indexed dictionary (TreeMap clone)

**Statement:** Implement a `SortedMap<K, V>` supporting `put`, `get`, `delete`, `floorKey(k)`, `ceilingKey(k)`, and `subMap(lo, hi)` — like Java's `TreeMap` or C++'s `std::map`.

**Approach:** A B-tree with `t = 16` to `t = 32` makes a great in-memory ordered map. Each node holds keys + values + child pointers. Use binary search within a node since `t` is large enough.

**Operations:**
- `put`: standard insert; if key exists, overwrite value.
- `get`: search; return value or `null`.
- `delete`: standard B-tree delete; cleanup empty root.
- `floorKey(k)`: largest key `≤ k`. Walk down: at each node, find largest key `≤ k`; remember its position. If the candidate child has a leaf with a key `≤ k`, prefer the deeper one. The classical recursive solution: traverse left while node's key > k; once you find a key `≤ k`, recurse right of that key looking for a closer one.
- `ceilingKey(k)`: symmetric.
- `subMap(lo, hi)`: range traversal as in Problem 3.

**Java sketch:**
```java
public V floor(K key) {
    return floor(root, key);
}
private V floor(Node n, K key) {
    int i = 0;
    while (i < n.size && cmp(n.keys[i], key) < 0) i++;
    // either n.keys[i] >= key, or i == n.size
    if (n.leaf) {
        if (i == 0) return null;
        return n.values[i - 1];
    }
    V deeper = floor(n.children[i], key);
    if (deeper != null) return deeper;
    if (i > 0) return n.values[i - 1];
    return null;
}
```

**Why this is a real question:** Many languages' ordered map types are red-black trees (Java, C++). A candidate who can implement a B-tree-backed TreeMap shows understanding of multi-way trees, the equivalence to red-black, and the cache-friendly variant choice (`middle.md` §3).

---

## Problem 8 — Verify B-tree invariants (debug helper)

**Statement:** Write `verify()` that returns `true` if the structure obeys every B-tree invariant; otherwise `false` (or throws a descriptive error).

**Invariants to check (`junior.md` §5):**
1. Every non-root node has between `t-1` and `2t-1` keys (root: 1 to `2t-1`, or 0 if tree is empty).
2. Every internal node has exactly `len(keys) + 1` children.
3. Keys within a node are sorted ascending.
4. All leaves are at the same depth.
5. The BST property holds across separator keys: every key in `children[i]` is less than `keys[i]`, and every key in `children[i+1]` is greater than `keys[i]`.

**Python:**
```python
def verify(self):
    return self._verify(self.root, is_root=True, lo=None, hi=None)[0] != -1

def _verify(self, node, is_root, lo, hi):
    """Return (depth, is_valid). depth=-1 means invalid."""
    n = len(node.keys)
    if not is_root and n < self.t - 1: return (-1, False)
    if n > 2 * self.t - 1:               return (-1, False)
    if is_root and n == 0 and not node.leaf: return (-1, False)
    for i in range(1, n):
        if node.keys[i-1] >= node.keys[i]: return (-1, False)
    if lo is not None and n > 0 and node.keys[0] <= lo: return (-1, False)
    if hi is not None and n > 0 and node.keys[-1] >= hi: return (-1, False)

    if node.leaf:
        return (0, True)

    if len(node.children) != n + 1: return (-1, False)
    depths = set()
    for i, c in enumerate(node.children):
        clo = lo if i == 0 else node.keys[i-1]
        chi = hi if i == n else node.keys[i]
        d, ok = self._verify(c, False, clo, chi)
        if not ok: return (-1, False)
        depths.add(d)
        if len(depths) > 1: return (-1, False)
    return (depths.pop() + 1, True)
```

**Go and Java:** translate directly. Wrap in unit tests that run after every fuzz-inserted sequence.

---

## Problem 9 — Convert a sorted array to a balanced B-tree of given t

**Statement:** Given a sorted `int[]` and `t`, return a fully-built B-tree.

**Approach:** Identical to bulk load (Problem 5) when the input is already an array. Slight variation: if you want a *recursive* solution (rather than the layer-by-layer iterative one), use:

```python
def build(self, arr, t):
    # Each call returns the root of a B-tree of the given subarray
    return self._build(arr, 0, len(arr) - 1, t)

def _build(self, arr, lo, hi, t):
    if lo > hi: return None
    n = hi - lo + 1
    if n <= 2 * t - 1:
        node = BTreeNode(t, leaf=True)
        node.keys = arr[lo:hi+1]
        return node
    # Split current range into ≤ 2t chunks, recurse on each
    chunks = max(2, (n + (2 * t - 1) - 1) // (2 * t - 1))
    chunks = min(chunks, 2 * t)
    chunk_size = n // chunks
    node = BTreeNode(t, leaf=False)
    pos = lo
    for c in range(chunks):
        end = pos + chunk_size - 1 if c < chunks - 1 else hi
        child_root = self._build(arr, pos, end, t)
        node.children.append(child_root)
        if c < chunks - 1:
            # take separator: smallest key of the next chunk
            sep = arr[end + 1]
            node.keys.append(sep)
            pos = end + 1
    return node
```

The recursive form is harder to balance perfectly. The iterative bulk load (Problem 5 / `middle.md` §4) is preferred in production.

---

## Problem 10 — Implement a basic disk-backed B-tree

**Statement:** Implement a B-tree where each node lives in a fixed-size **page** in a file. Pages are addressed by 0-based page ID. The tree should:
- Persist across process restarts.
- Use one fixed-size page per node (e.g., 4 KB).
- Survive crashes by writing the modified root pointer last.

**Approach:**
1. Define a page layout:
   ```
   byte 0:        leaf flag (0 or 1)
   bytes 1-4:     int32 key count n
   bytes 5..:     n × int64 keys
   bytes ...:     (n+1) × int64 child page IDs (if internal)
   ```
2. Allocate pages via a free-list at page 0 (or by appending to the file).
3. Cache pages in memory by a simple LRU buffer pool.
4. Every operation reads pages on demand, marks them dirty on write, evicts via LRU.
5. On a "commit", write the new root page ID into a header page atomically.

**Go skeleton:**
```go
type PageID uint64

type Pager struct {
    f         *os.File
    pageSize  int
    cache     map[PageID]*Node
    pinCounts map[PageID]int
}

func (p *Pager) get(id PageID) *Node { ... }
func (p *Pager) newPage(n *Node) PageID { ... }
func (p *Pager) flush() { ... }

type DiskBTree struct {
    pager   *Pager
    rootID  PageID
    t       int
}
```

**Layout for `t = 100`:** Each key 8 B + each child 8 B → 2t-1 = 199 keys + 200 children = ~3 KB of key/child data + header ≈ fits 4 KB page. In practice you choose `t` after deciding page size and key/value sizes.

**Crash safety**: A real engine writes a **write-ahead log** of every page change before modifying the page (see `professional.md` §7). A simplified version: maintain two copies of the header page and atomically alternate which is "current" via a sequence number (the bbolt approach).

**Real-world reference:** Read SQLite's `src/btree.c` (~10,000 lines, beautifully commented) and bbolt's `bucket.go` + `node.go` (~1,500 lines) for the two extremes of approach.

---

## How interviews use these problems

Different companies pull from this set differently:

- **Database company (Snowflake, MongoDB, Cockroach, Yugabyte):** expect Problems 1, 2, 6, 10. Plus deep discussion of B+ tree differences, WAL, concurrency.
- **Cloud infrastructure (AWS DynamoDB, Google Spanner):** Problems 5, 6, 10, plus the LSM-vs-B-tree trade-off (`professional.md` §4).
- **General systems (Stripe, Cloudflare):** Problem 1 or 2 for whiteboard; Problems 3, 4, 7 for "library work".
- **FAANG generalist:** Problems 4, 7, 8 (auxiliary skills); the full implement-B-tree-from-scratch is rare.

The single most important skill is being able to **describe the proactive split + proactive fill protocol clearly** and explain *why* it makes B-tree operations one-pass. Master that explanation and most B-tree questions become straightforward.

---

## Pitfalls in every interview

- **Confusing `t` semantics.** Clarify whether `t` is minimum degree (CLRS) or maximum children before you write code.
- **Hand-waving "we just split when full"** without specifying the proactive direction. Interviewers will ask whether you split before or after descent.
- **Forgetting the root collapse after delete.**
- **Choosing the wrong page size in disk-backed problems.** Default 4 KB unless the interviewer mentions otherwise.
- **Confusing B-tree with B+ tree** during the discussion. State explicitly which variant you are implementing.
- **Skipping the verify helper.** Real engineers ship `verify()` alongside the structure. Mention it.

---

## References for interview prep

- CLRS Chapter 18 for the canonical algorithms.
- `https://github.com/etcd-io/bbolt` source — small, readable, production-grade CoW B+ tree.
- `https://github.com/sqlite/sqlite/blob/master/src/btree.c` — the masterclass.
- LeetCode 1146 (Snapshot Array) for an indirect CoW B-tree question.
- LeetCode 220 (Contains Duplicate III) for an in-memory sorted-bucket question that maps to B-tree-style ordered set operations.
