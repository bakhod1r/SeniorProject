# B+ Tree — Interview Problems

> **Audience:** Candidates preparing for systems / databases interviews. Each problem has a solution in Go, Java, and Python. Time targets: 30–45 minutes per problem on a whiteboard.

Most B+ tree interview problems are **implementation-heavy**: they test whether you can write split logic, maintain the leaf chain, or reason about concurrency. We focus on the eight problems that come up most often in storage-engine and infrastructure interviews.

---

## Problems

1. [In-memory B+ tree with insert / search / delete and ordered iterator](#p1)
2. [Range scan via leaf chain](#p2)
3. [Bulk-load from sorted input](#p3)
4. [Concurrent insert with optimistic latching](#p4)
5. [Index-organized table where leaves carry full rows](#p5)
6. [Snapshot reads via copy-on-write](#p6)
7. [Disk-backed B+ tree with fixed page size](#p7)
8. [Verify B+ tree invariants](#p8)

---

<a name="p1"></a>
## Problem 1: In-Memory B+ Tree with Ordered Iterator

**Prompt:** Implement a B+ tree supporting `insert(k, v)`, `search(k)`, `delete(k)`, and `iter()` (an in-order iterator over all `(k, v)` pairs).

### Key ideas
- Two node types: `Leaf` and `Internal`.
- Leaves are linked via `nextLeaf` pointers.
- `iter()` starts at the leftmost leaf and walks the chain.

### Go
```go
type Leaf struct {
    keys []int
    vals []string
    next *Leaf
}
type Internal struct {
    keys     []int
    children []interface{}
}
type BPlus struct {
    root  interface{}
    order int       // max keys per node
}

func (b *BPlus) Iter() <-chan [2]interface{} {
    ch := make(chan [2]interface{})
    go func() {
        defer close(ch)
        // Find leftmost leaf
        node := b.root
        for {
            in, ok := node.(*Internal)
            if !ok {
                break
            }
            node = in.children[0]
        }
        leaf := node.(*Leaf)
        for leaf != nil {
            for i := range leaf.keys {
                ch <- [2]interface{}{leaf.keys[i], leaf.vals[i]}
            }
            leaf = leaf.next
        }
    }()
    return ch
}
```

### Java
```java
public Iterable<Entry> iter() {
    return () -> new Iterator<>() {
        Leaf<V> leaf = leftmost();
        int idx = 0;

        public boolean hasNext() {
            while (leaf != null && idx >= leaf.keys.length) {
                leaf = leaf.next;
                idx = 0;
            }
            return leaf != null;
        }

        public Entry next() {
            Entry e = new Entry(leaf.keys[idx], leaf.vals[idx]);
            idx++;
            return e;
        }
    };
}

private Leaf<V> leftmost() {
    Node n = root;
    while (n instanceof Internal in) n = in.children[0];
    return (Leaf<V>) n;
}
```

### Python
```python
def __iter__(self):
    node = self.root
    while not node.is_leaf:
        node = node.children[0]
    leaf = node
    while leaf is not None:
        for k, v in zip(leaf.keys, leaf.values):
            yield k, v
        leaf = leaf.next_leaf
```

**Common mistake:** building the iterator on top of recursive in-order tree traversal. That works but is O(log n) per `next()` call. The leaf-chain approach is O(1) per step.

---

<a name="p2"></a>
## Problem 2: Range Scan via Leaf Chain

**Prompt:** Implement `range_scan(lo, hi)` returning all keys `k` with `lo <= k <= hi`.

### Key idea
- One descent to the leaf containing `lo`.
- Walk the leaf chain forward, emitting matching keys until you see one `> hi`.

### Python
```python
def range_scan(self, lo, hi):
    leaf = self._find_leaf(lo)
    while leaf is not None:
        for k, v in zip(leaf.keys, leaf.values):
            if k < lo:
                continue
            if k > hi:
                return
            yield k, v
        leaf = leaf.next_leaf
```

### Go
```go
func (b *BPlus) RangeScan(lo, hi int) [][2]interface{} {
    var out [][2]interface{}
    leaf := b.findLeaf(lo)
    for leaf != nil {
        for i, k := range leaf.keys {
            if k < lo {
                continue
            }
            if k > hi {
                return out
            }
            out = append(out, [2]interface{}{k, leaf.vals[i]})
        }
        leaf = leaf.next
    }
    return out
}
```

### Java
```java
public List<Entry> rangeScan(int lo, int hi) {
    List<Entry> out = new ArrayList<>();
    Leaf<V> leaf = findLeaf(lo);
    while (leaf != null) {
        for (int i = 0; i < leaf.keys.length; i++) {
            if (leaf.keys[i] < lo) continue;
            if (leaf.keys[i] > hi) return out;
            out.add(new Entry(leaf.keys[i], leaf.vals[i]));
        }
        leaf = leaf.next;
    }
    return out;
}
```

**Follow-up:** "what if I need the records sorted DESCENDING?" → either maintain a doubly-linked leaf chain and reverse-walk, or descend to the leaf containing `hi` and walk backward through that leaf, then if exhausted, use `find_leaf` again on the predecessor key.

---

<a name="p3"></a>
## Problem 3: Bulk-Load from Sorted Input

**Prompt:** Given a sorted stream of `(key, value)` pairs, build a B+ tree in `O(n)` time without ever performing an insert/split.

### Algorithm
1. Read records and pack them into leaves at `fillfactor` (say 75%).
2. As each leaf fills, link it from the previous leaf and remember its smallest key.
3. Once all leaves are built, build internal levels bottom-up.

### Python
```python
def bulk_load(sorted_pairs, leaf_cap=4, internal_cap=4):
    # 1. Build leaves.
    leaves = []
    cur = Leaf()
    for k, v in sorted_pairs:
        if len(cur.keys) >= leaf_cap:
            leaves.append(cur)
            cur = Leaf()
        cur.keys.append(k)
        cur.values.append(v)
    if cur.keys:
        leaves.append(cur)

    # 2. Link leaves.
    for i in range(len(leaves) - 1):
        leaves[i].next_leaf = leaves[i + 1]

    if len(leaves) == 1:
        return BPlusTree.from_root(leaves[0])

    # 3. Build internal levels bottom-up.
    children = leaves
    while len(children) > 1:
        parents = []
        cur = Internal()
        cur.children.append(children[0])
        for child in children[1:]:
            if len(cur.keys) >= internal_cap:
                parents.append(cur)
                cur = Internal()
                cur.children.append(child)
            else:
                # First key of right subtree becomes routing key.
                first_key = _leftmost_key(child)
                cur.keys.append(first_key)
                cur.children.append(child)
        parents.append(cur)
        children = parents
    return BPlusTree.from_root(children[0])

def _leftmost_key(node):
    while not node.is_leaf:
        node = node.children[0]
    return node.keys[0]
```

### Go / Java
Analogous; build leaves array, link, then build internal levels in a loop until one node remains.

**Why this matters:** Production `CREATE INDEX` uses exactly this. Insert-by-insert would be O(n log n) with high constants. Bulk load is O(n) after the sort, dominated by sequential I/O.

**Follow-up:** "what fill factor would you choose?" → 70–80% for write-heavy workloads (room for inserts without immediate splits), 95–100% for read-only / archive indexes (maximum density).

---

<a name="p4"></a>
## Problem 4: Concurrent Insert with Optimistic Latching

**Prompt:** Make the B+ tree thread-safe for concurrent inserts without using a global lock. Reads should never block.

### Key ideas
- Per-node version counter.
- Readers do version-check → read → version-check; retry on mismatch.
- Writers acquire a per-node lock when modifying.

### Python (simplified)
```python
import threading

class OLCNode:
    def __init__(self):
        self.version = 0
        self.lock = threading.Lock()
        # ... keys, children, etc.

def optimistic_read(node, op):
    while True:
        v1 = node.version
        if v1 & 1:           # write in progress
            continue
        result = op(node)    # MUST NOT mutate
        v2 = node.version
        if v1 == v2:
            return result
        # else retry

def write(node, op):
    with node.lock:
        node.version += 1    # mark "write in progress" (odd)
        op(node)
        node.version += 1    # mark complete (even)
```

### Go
```go
type OLCNode struct {
    version uint64           // atomic
    lock    sync.Mutex
}

func OptimisticRead[R any](n *OLCNode, op func() R) R {
    for {
        v1 := atomic.LoadUint64(&n.version)
        if v1&1 == 1 {        // writer in progress
            runtime.Gosched()
            continue
        }
        result := op()
        v2 := atomic.LoadUint64(&n.version)
        if v1 == v2 {
            return result
        }
    }
}
```

### Java
```java
class OLCNode {
    volatile long version;
    final ReentrantLock lock = new ReentrantLock();
}

<R> R optimisticRead(OLCNode n, Supplier<R> op) {
    while (true) {
        long v1 = n.version;
        if ((v1 & 1) == 1) { Thread.yield(); continue; }
        R r = op.get();
        long v2 = n.version;
        if (v1 == v2) return r;
    }
}
```

**Follow-up:** "what about descent through multiple nodes?" → version-check each node along the descent path; if any version changes, retry from root. This is the **hand-over-hand optimistic latching** pattern used in HyPer.

---

<a name="p5"></a>
## Problem 5: IOT-Style Storage Where Leaves Carry Full Rows

**Prompt:** Implement a B+ tree where the leaf stores the entire row, not just a pointer.

### Key idea
- Leaf cells are `(primary_key, full_row)`.
- Secondary indexes would carry `(secondary_key, primary_key)` and require a second tree walk to fetch the row.

### Python
```python
from dataclasses import dataclass

@dataclass
class Row:
    pk: int
    name: str
    email: str
    created_at: str

class IOTLeaf:
    def __init__(self):
        self.keys = []         # primary keys
        self.rows = []         # Row objects
        self.next_leaf = None
        self.is_leaf = True

class IOTBPlusTree:
    def insert(self, row: Row):
        self._insert(self.root, row.pk, row)
    # search returns the full Row, not just a value:
    def search(self, pk) -> Row | None:
        leaf = self._find_leaf(pk)
        for k, row in zip(leaf.keys, leaf.rows):
            if k == pk:
                return row
        return None
```

### Trade-offs to articulate in interview
- **Pro:** primary-key lookups return the full row in one descent — no heap fetch.
- **Pro:** primary-key range scans are physically sequential.
- **Con:** secondary index lookups require a second B+ tree walk.
- **Con:** if rows are large, leaf fanout drops, tree height grows.
- **Con:** updating the primary key physically moves the row.

This is exactly InnoDB's primary index, Oracle IOT, and SQLite `WITHOUT ROWID`.

---

<a name="p6"></a>
## Problem 6: Snapshot Reads via Copy-on-Write

**Prompt:** Make the B+ tree support consistent snapshot reads concurrent with writes, without any locks held during reads.

### Key idea
- Never modify a node in place. On any mutation, allocate a new node and update parent pointers up to a new root.
- Each transaction sees the tree via a single root pointer captured at transaction start.

### Python
```python
class CoWNode:
    # Immutable! Once published, never modified.
    pass

class CoWLeaf(CoWNode):
    def __init__(self, keys, values, next_leaf):
        self.keys = tuple(keys)
        self.values = tuple(values)
        self.next_leaf = next_leaf

class CoWInternal(CoWNode):
    def __init__(self, keys, children):
        self.keys = tuple(keys)
        self.children = tuple(children)

class CoWBPlusTree:
    def __init__(self):
        self._root = CoWLeaf((), (), None)
        self._lock = threading.Lock()    # write only

    def snapshot(self):
        return self._root          # atomic load

    def search(self, key, snapshot=None):
        node = snapshot or self._root
        while not isinstance(node, CoWLeaf):
            i = bisect.bisect_right(node.keys, key)
            node = node.children[i]
        for k, v in zip(node.keys, node.values):
            if k == key:
                return v
        return None

    def insert(self, key, value):
        with self._lock:           # single writer
            new_root = self._cow_insert(self._root, key, value)
            self._root = new_root  # atomic swap

    def _cow_insert(self, node, key, value):
        # returns a NEW node (and possibly a sibling for split)
        ...
```

**Follow-up:** "how do you reclaim old versions?" → reference-count each snapshot or use epoch-based GC (LMDB uses an explicit "old root list" with reader pinning). Old nodes become garbage when all snapshots that referenced them are released.

This is the LMDB / bbolt design pattern.

---

<a name="p7"></a>
## Problem 7: Disk-Backed B+ Tree with Fixed Page Size

**Prompt:** Implement a B+ tree that stores its pages in a single file at fixed page size (e.g., 4 KB). Each node serializes into one page. Provide `read_page(page_id)` and `write_page(page_id, data)`.

### Key ideas
- Each node has a `page_id` (page number in the file).
- Child pointers are `page_id` integers, not memory pointers.
- A simple page allocator (free-list or bump allocator) manages new page_ids.

### Python (sketch)
```python
PAGE_SIZE = 4096

class DiskBPlusTree:
    def __init__(self, path):
        self.f = open(path, 'r+b')
        self.next_page_id = self._count_pages()
        self.root_page_id = 0       # convention: page 0 is the root

    def read_page(self, page_id) -> bytes:
        self.f.seek(page_id * PAGE_SIZE)
        return self.f.read(PAGE_SIZE)

    def write_page(self, page_id, data):
        assert len(data) == PAGE_SIZE
        self.f.seek(page_id * PAGE_SIZE)
        self.f.write(data)
        self.f.flush()

    def serialize_leaf(self, leaf) -> bytes:
        # [flag=LEAF (1B)][n (4B)][next_page_id (4B)]
        # [(key (8B), value (...))] * n
        # pad with zeros
        ...

    def serialize_internal(self, in_) -> bytes:
        # [flag=INTERNAL (1B)][n (4B)]
        # [child_page_id_0 (4B)]
        # [(key (8B), child_page_id (4B))] * n
        ...

    def search(self, key):
        page_id = self.root_page_id
        while True:
            data = self.read_page(page_id)
            if data[0] == LEAF_FLAG:
                return self._leaf_lookup(data, key)
            page_id = self._internal_route(data, key)
```

**Discussion points:**
- Endianness: pick one and stick with it.
- Alignment: keys/pointers should be naturally aligned (no unaligned `int64` reads).
- Overflow: rows larger than (page_size / 4) need an overflow chain.
- WAL: a simple `write_page` is not crash-safe — discuss what's needed (FPW or doublewrite) without implementing it.

This problem assesses whether the candidate can design serialization formats, not whether they can write a thousand lines of bit-twiddling. Sketch and discuss is enough.

---

<a name="p8"></a>
## Problem 8: Verify B+ Tree Invariants

**Prompt:** Write a `validate(tree)` function that checks all B+ tree invariants. Return a list of violations.

### Invariants to check
1. Uniform height: every root-to-leaf path has the same length.
2. Routing rule: for an internal node with keys `[k1, ..., kn]` and children `[c0, ..., cn]`, every key in subtree `ci` is `>= ki` and `< k_{i+1}` (with `k0 = -∞`, `k_{n+1} = +∞`).
3. Leaf-key count: every non-root leaf has between `t-1` and `2t-1` keys.
4. Internal-key count: every non-root internal node has between `t-1` and `2t-1` keys.
5. Leaf chain: traversing the chain from the leftmost leaf visits every key in ascending order; no leaf is missed; no cycle.
6. Routing-key correctness: every routing key in an internal node matches the smallest key of the corresponding right subtree's leftmost leaf.

### Python
```python
def validate(tree, t=3) -> list[str]:
    errors = []

    # Check uniform height
    heights = set()
    def collect_heights(node, depth):
        if node.is_leaf:
            heights.add(depth)
        else:
            for c in node.children:
                collect_heights(c, depth + 1)
    collect_heights(tree.root, 0)
    if len(heights) > 1:
        errors.append(f"non-uniform height: {heights}")

    # Check routing rule and key counts
    def check(node, lo, hi):
        for k in node.keys:
            if (lo is not None and k < lo) or (hi is not None and k >= hi):
                errors.append(f"key {k} out of routing range [{lo}, {hi})")
        if node.is_leaf:
            return
        # Non-root internal: t-1 <= |keys| <= 2t-1
        if node is not tree.root:
            if not (t - 1 <= len(node.keys) <= 2 * t - 1):
                errors.append(f"internal node key count {len(node.keys)} out of bounds")
        # Recurse
        prev = lo
        for i, child in enumerate(node.children):
            nxt = node.keys[i] if i < len(node.keys) else hi
            check(child, prev, nxt)
            prev = nxt

    check(tree.root, None, None)

    # Check leaf chain
    leaves_via_descent = []
    def collect_leaves(node):
        if node.is_leaf:
            leaves_via_descent.append(node)
        else:
            for c in node.children:
                collect_leaves(c)
    collect_leaves(tree.root)

    leftmost = leaves_via_descent[0]
    leaves_via_chain = []
    seen = set()
    leaf = leftmost
    while leaf is not None:
        if id(leaf) in seen:
            errors.append("cycle in leaf chain")
            break
        seen.add(id(leaf))
        leaves_via_chain.append(leaf)
        leaf = leaf.next_leaf

    if len(leaves_via_descent) != len(leaves_via_chain):
        errors.append(
            f"leaf chain length ({len(leaves_via_chain)}) != tree leaf count ({len(leaves_via_descent)})"
        )

    # Check ascending order along chain
    last_key = None
    for leaf in leaves_via_chain:
        for k in leaf.keys:
            if last_key is not None and k < last_key:
                errors.append(f"out-of-order leaf chain: {last_key} -> {k}")
            last_key = k

    return errors
```

**Interview discussion:**
- "What's the time complexity?" → O(n + h × b) where h is height and b is fanout. Practically O(n) since we visit every key.
- "How would you run this in production?" → in dev/test builds always; in production, sampling-based (validate one random leaf per second) or during background `VACUUM`.

This problem assesses whether the candidate truly understands B+ tree invariants, beyond just being able to code one.

---

## Bonus: Comparison Benchmark

**Prompt:** Compare your B+ tree against a classic B-tree on the same workload. Report point-lookup latency and range-scan latency.

### Expectation in interview
You don't need to implement both. Articulate:
- Point lookup: roughly the same I/O cost; B+ tree may have one extra leaf access (because it can't terminate early at an internal match), but in practice this is negligible.
- Range scan: B+ tree wins decisively. For a scan returning `k` records over a tree of fanout `b`, B+ does `O(log n + k/b)` sequential I/O; classic B-tree does `O(log n + k)` with tree traversal at every step. For `k = 1M, b = 100`: B+ does ~10⁴ sequential reads, B-tree does ~10⁶ random reads — a 100× gap.

That qualitative explanation is more valuable than benchmark numbers in a 45-minute interview.

---

## Summary

These eight problems cover the surface area of "implement a B+ tree" interviews. The recurring themes:

1. **Distinguish leaves from internals.** Data lives at leaves; routing keys are not records.
2. **Maintain the leaf chain.** Splits and merges must splice / unsplice correctly.
3. **Copy-up for leaf splits, move-up for internal splits.**
4. **Iterating via the leaf chain is O(1) per step.** Don't iterate via tree traversal.
5. **Concurrency is hard.** Latch coupling, OLC, Lehman-Yao right-links, CoW — each is a coherent answer to the same problem.

If you can implement problem 1 correctly under interview pressure and articulate the trade-offs for problems 4–6, you have demonstrated mastery.

---

## Further Practice

- LeetCode 731, 732 (interval problems where range scans help).
- Build a tiny SQLite-style storage engine — see CMU 15-445 Database Systems course project handouts.
- Read PostgreSQL `src/backend/access/nbtree/README` and identify which interview problems it addresses.
