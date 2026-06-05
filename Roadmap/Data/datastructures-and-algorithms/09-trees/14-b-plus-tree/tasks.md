# B+ Tree — Hands-On Tasks

> **Audience:** Engineers who have read `junior.md` through `professional.md` and want code under their fingers. Each task ships with a reference solution in Go, Java, and Python, test cases, complexity notes, and lessons learned.

The B+ tree is the structure you most need to **type out** to truly internalize. Reading about leaf chains is easy. Writing one — and getting the sibling pointers right after a split that propagates three levels up — is what makes the structure click. Work through these tasks in order; each builds on the last.

---

## Tasks

1. [In-memory B+ tree with search / insert / delete](#t1)
2. [Leaf-chain pointers and range scan](#t2)
3. [Lehman-Yao right-links for concurrent descent](#t3)
4. [Bulk-load from a sorted stream in O(n)](#t4)
5. [Prefix compression on leaf keys](#t5)
6. [Disk-backed B+ tree with a fixed page size](#t6)
7. [Copy-on-write B+ tree with snapshot reads](#t7)
8. [MVCC index returning row versions per timestamp](#t8)
9. [Order-statistic B+ tree with subtree counts](#t9)
10. [Benchmark B+ tree vs classic B-tree](#t10)

---

<a name="t1"></a>
## Task 1: In-Memory B+ Tree (search / insert / delete)

### Problem
Build a B+ tree of order `t` over `(int key, string value)` pairs. Support `search(k)`, `insert(k, v)`, and `delete(k)`. Both leaves and internals must respect the `t <= keys <= 2t` rule (root excepted). Use the **two structural rules** from `junior.md`: data lives only at leaves; leaves form a sorted linked list.

### Hints
- Two node types: `Leaf` and `Internal`. Keep them as distinct structs to avoid `isLeaf` branches everywhere.
- Internal node has `len(children) == len(keys) + 1`. Leaf has `len(values) == len(keys)`.
- After a leaf split, the **separator** copied up is the **first key of the new right leaf**. (Contrast with classic B-tree where the median is **moved** up.)
- For delete, prefer borrowing from a sibling before merging; merging propagates upward.

### Reference solution — Go

```go
package bplustree

const T = 3 // minimum number of keys per non-root node

type Node interface {
    isLeaf() bool
}

type Leaf struct {
    keys []int
    vals []string
    next *Leaf
}

func (*Leaf) isLeaf() bool { return true }

type Internal struct {
    keys     []int
    children []Node
}

func (*Internal) isLeaf() bool { return false }

type Tree struct {
    root Node
}

func New() *Tree { return &Tree{root: &Leaf{}} }

func (t *Tree) Search(k int) (string, bool) {
    n := t.root
    for !n.isLeaf() {
        in := n.(*Internal)
        i := upperBound(in.keys, k)
        n = in.children[i]
    }
    lf := n.(*Leaf)
    i := lowerBound(lf.keys, k)
    if i < len(lf.keys) && lf.keys[i] == k {
        return lf.vals[i], true
    }
    return "", false
}

func (t *Tree) Insert(k int, v string) {
    sepKey, newChild, split := insert(t.root, k, v)
    if split {
        t.root = &Internal{
            keys:     []int{sepKey},
            children: []Node{t.root, newChild},
        }
    }
}

func insert(n Node, k int, v string) (int, Node, bool) {
    if n.isLeaf() {
        lf := n.(*Leaf)
        i := lowerBound(lf.keys, k)
        if i < len(lf.keys) && lf.keys[i] == k {
            lf.vals[i] = v
            return 0, nil, false
        }
        lf.keys = insertAt(lf.keys, i, k)
        lf.vals = insertStrAt(lf.vals, i, v)
        if len(lf.keys) <= 2*T {
            return 0, nil, false
        }
        mid := len(lf.keys) / 2
        right := &Leaf{
            keys: append([]int{}, lf.keys[mid:]...),
            vals: append([]string{}, lf.vals[mid:]...),
            next: lf.next,
        }
        lf.keys = lf.keys[:mid]
        lf.vals = lf.vals[:mid]
        lf.next = right
        return right.keys[0], right, true
    }
    in := n.(*Internal)
    i := upperBound(in.keys, k)
    sep, child, split := insert(in.children[i], k, v)
    if !split {
        return 0, nil, false
    }
    in.keys = insertAt(in.keys, i, sep)
    in.children = insertChildAt(in.children, i+1, child)
    if len(in.keys) <= 2*T {
        return 0, nil, false
    }
    mid := len(in.keys) / 2
    sepUp := in.keys[mid]
    right := &Internal{
        keys:     append([]int{}, in.keys[mid+1:]...),
        children: append([]Node{}, in.children[mid+1:]...),
    }
    in.keys = in.keys[:mid]
    in.children = in.children[:mid+1]
    return sepUp, right, true
}

// Delete, borrow, merge, lowerBound, upperBound, and insertAt helpers
// follow classic B-tree mechanics but mind the leaf-chain pointer:
// on a leaf merge, splice the merged leaf's `next` into the predecessor's `next`.
```

### Reference solution — Java

```java
public final class BPlusTree {
    static final int T = 3;
    abstract static class Node { abstract boolean isLeaf(); }

    static final class Leaf extends Node {
        int[] keys = new int[2 * T + 1];
        String[] vals = new String[2 * T + 1];
        int n;
        Leaf next;
        boolean isLeaf() { return true; }
    }

    static final class Internal extends Node {
        int[] keys = new int[2 * T + 1];
        Node[] children = new Node[2 * T + 2];
        int n;
        boolean isLeaf() { return false; }
    }

    Node root = new Leaf();

    String search(int k) {
        Node n = root;
        while (!n.isLeaf()) {
            Internal in = (Internal) n;
            int i = upperBound(in.keys, in.n, k);
            n = in.children[i];
        }
        Leaf lf = (Leaf) n;
        int i = lowerBound(lf.keys, lf.n, k);
        return (i < lf.n && lf.keys[i] == k) ? lf.vals[i] : null;
    }

    void insert(int k, String v) {
        Object[] r = insertRec(root, k, v);
        if (r != null) {
            Internal nr = new Internal();
            nr.keys[0] = (int) r[0]; nr.n = 1;
            nr.children[0] = root;
            nr.children[1] = (Node) r[1];
            root = nr;
        }
    }
    // insertRec returns null on no split, {sepKey, newNode} on split.
}
```

### Reference solution — Python

```python
T = 3

class Leaf:
    __slots__ = ("keys", "vals", "next")
    def __init__(self):
        self.keys = []
        self.vals = []
        self.next = None

class Internal:
    __slots__ = ("keys", "children")
    def __init__(self):
        self.keys = []
        self.children = []

class BPlusTree:
    def __init__(self):
        self.root = Leaf()

    def search(self, k):
        n = self.root
        while isinstance(n, Internal):
            i = next((j for j, x in enumerate(n.keys) if k < x), len(n.keys))
            n = n.children[i]
        for j, x in enumerate(n.keys):
            if x == k:
                return n.vals[j]
        return None

    def insert(self, k, v):
        split = self._insert(self.root, k, v)
        if split:
            sep, right = split
            new_root = Internal()
            new_root.keys = [sep]
            new_root.children = [self.root, right]
            self.root = new_root

    def _insert(self, n, k, v):
        if isinstance(n, Leaf):
            i = 0
            while i < len(n.keys) and n.keys[i] < k:
                i += 1
            if i < len(n.keys) and n.keys[i] == k:
                n.vals[i] = v
                return None
            n.keys.insert(i, k)
            n.vals.insert(i, v)
            if len(n.keys) <= 2 * T:
                return None
            mid = len(n.keys) // 2
            right = Leaf()
            right.keys = n.keys[mid:]
            right.vals = n.vals[mid:]
            right.next = n.next
            n.keys = n.keys[:mid]
            n.vals = n.vals[:mid]
            n.next = right
            return right.keys[0], right
        i = 0
        while i < len(n.keys) and n.keys[i] <= k:
            i += 1
        split = self._insert(n.children[i], k, v)
        if not split:
            return None
        sep, child = split
        n.keys.insert(i, sep)
        n.children.insert(i + 1, child)
        if len(n.keys) <= 2 * T:
            return None
        mid = len(n.keys) // 2
        sep_up = n.keys[mid]
        right = Internal()
        right.keys = n.keys[mid + 1:]
        right.children = n.children[mid + 1:]
        n.keys = n.keys[:mid]
        n.children = n.children[:mid + 1]
        return sep_up, right
```

### Test cases
- Insert `1..100` in order; assert `search(k) == str(k)` for every k.
- Insert `100..1` reversed; assert in-order traversal yields `1..100`.
- Insert random 10,000 integers, then delete half; assert remaining search succeeds.
- Insert duplicate key with different value; assert the value is overwritten.

### Complexity
- `search`: `O(log_t n)`.
- `insert`, `delete`: `O(log_t n)` amortized; the split / merge cost is paid by the height term.

### Lessons
- The separator copied up on a leaf split is **the first key of the new right leaf**, not the median.
- Always update `lf.next` **before** truncating `lf.keys`; reversing the order silently corrupts the chain.
- Don't use a single `Node` struct with an `isLeaf` boolean — the type confusion bugs cost hours. Two structs, one interface.

---

<a name="t2"></a>
## Task 2: Leaf Chain Range Scan

### Problem
Extend Task 1 with `rangeScan(lo, hi) []int` that returns every key `k` such that `lo <= k <= hi`, in order. The descent cost must be `O(log_t n)` and the per-result cost `O(1)` (amortized over leaf I/O).

### Hints
- Descend to the leaf containing `lo` exactly as `search(lo)` does.
- Once at the leaf, linearly scan forward, following `leaf.next`, accumulating keys until you pass `hi`.
- Do **not** descend the tree more than once.

### Reference solution — Go

```go
func (t *Tree) RangeScan(lo, hi int) []int {
    n := t.root
    for !n.isLeaf() {
        in := n.(*Internal)
        i := upperBound(in.keys, lo)
        n = in.children[i]
    }
    var out []int
    lf := n.(*Leaf)
    i := lowerBound(lf.keys, lo)
    for lf != nil {
        for ; i < len(lf.keys); i++ {
            if lf.keys[i] > hi {
                return out
            }
            out = append(out, lf.keys[i])
        }
        lf = lf.next
        i = 0
    }
    return out
}
```

### Reference solution — Java

```java
List<Integer> rangeScan(int lo, int hi) {
    Node n = root;
    while (!n.isLeaf()) {
        Internal in = (Internal) n;
        int idx = upperBound(in.keys, in.n, lo);
        n = in.children[idx];
    }
    List<Integer> out = new ArrayList<>();
    Leaf lf = (Leaf) n;
    int i = lowerBound(lf.keys, lf.n, lo);
    while (lf != null) {
        for (; i < lf.n; i++) {
            if (lf.keys[i] > hi) return out;
            out.add(lf.keys[i]);
        }
        lf = lf.next;
        i = 0;
    }
    return out;
}
```

### Reference solution — Python

```python
def range_scan(self, lo, hi):
    n = self.root
    while isinstance(n, Internal):
        i = next((j for j, x in enumerate(n.keys) if lo < x), len(n.keys))
        n = n.children[i]
    out = []
    while n is not None:
        for k in n.keys:
            if k < lo:
                continue
            if k > hi:
                return out
            out.append(k)
        n = n.next
    return out
```

### Test cases
- After inserting `1..1000`, `rangeScan(250, 750)` returns `[250..750]`.
- Empty range: `rangeScan(2000, 3000)` returns `[]`.
- Range that hits exactly one leaf: returns the slice inside that leaf only.

### Complexity
- `O(log_t n + k / b)` where `k` is the answer size and `b` the leaf capacity.

### Lessons
- The point of the linked leaf chain is **one** root-to-leaf descent regardless of how big the range is.
- Forgetting to reset `i = 0` when crossing leaves is the classic off-by-one for first-time implementers.

---

<a name="t3"></a>
## Task 3: Lehman-Yao Right-Links

### Problem
Add right-link pointers at **every level** (not just leaves) and a `highKey` per node. Implement a reader that tolerates a concurrent split: if it arrives at a node and `key > node.highKey`, it follows `rightLink` instead of restarting from root.

### Hints
- Right-links go in both `Leaf` and `Internal`.
- The `highKey` is the maximum key in the subtree the node is currently responsible for; when a split moves keys to a new right sibling, the old node's `highKey` becomes the separator.
- For this task, simulate the race: in test, kick off a goroutine / thread that does inserts while another reads.

### Reference solution — Go

```go
type Internal struct {
    keys      []int
    children  []Node
    highKey   int
    rightLink *Internal
}
type Leaf struct {
    keys      []int
    vals      []string
    highKey   int
    next      *Leaf // also serves as rightLink
}

func (t *Tree) ConcurrentSearch(k int) (string, bool) {
    n := t.root
    for !n.isLeaf() {
        in := n.(*Internal)
        for k > in.highKey && in.rightLink != nil {
            in = in.rightLink
        }
        i := upperBound(in.keys, k)
        n = in.children[i]
    }
    lf := n.(*Leaf)
    for k > lf.highKey && lf.next != nil {
        lf = lf.next
    }
    i := lowerBound(lf.keys, k)
    if i < len(lf.keys) && lf.keys[i] == k {
        return lf.vals[i], true
    }
    return "", false
}
```

### Reference solution — Java

```java
String concurrentSearch(int k) {
    Node n = root;
    while (!n.isLeaf()) {
        Internal in = (Internal) n;
        while (k > in.highKey && in.rightLink != null) in = in.rightLink;
        int i = upperBound(in.keys, in.n, k);
        n = in.children[i];
    }
    Leaf lf = (Leaf) n;
    while (k > lf.highKey && lf.next != null) lf = lf.next;
    int i = lowerBound(lf.keys, lf.n, k);
    return (i < lf.n && lf.keys[i] == k) ? lf.vals[i] : null;
}
```

### Reference solution — Python

```python
def concurrent_search(self, k):
    n = self.root
    while isinstance(n, Internal):
        while k > n.high_key and n.right_link is not None:
            n = n.right_link
        i = next((j for j, x in enumerate(n.keys) if k < x), len(n.keys))
        n = n.children[i]
    while k > n.high_key and n.next is not None:
        n = n.next
    for j, x in enumerate(n.keys):
        if x == k:
            return n.vals[j]
    return None
```

### Test cases
- Single-threaded: identical to Task 1.
- Concurrent: spawn 100 inserters and 100 readers on the same tree; assert no reader misses a key it should have seen.
- Force the race by inserting in batches that always cause a split.

### Complexity
- Same as Task 1; the extra right-link follows are amortized away because splits are rare and the link chain length is bounded by 2.

### Lessons
- The right-link must be set **before** the new sibling is published into the parent. Otherwise readers can be stranded.
- High key is the max key the node is **responsible for**, not the max key it currently stores — they coincide except during a split's brief window.

---

<a name="t4"></a>
## Task 4: Bulk Load from a Sorted Stream in O(n)

### Problem
Given a presorted stream of `(k, v)` pairs, build a B+ tree without going through `n` single-key inserts. The build should run in `O(n)` total work and produce leaves that are filled to a target ratio (e.g. 75%).

### Hints
- Stream the input into leaves of capacity `2t`; each time a leaf fills, emit a separator and the leaf pointer to a queue for the level above.
- After streaming the bottom level, the parent level is built the same way from the queue, recursively, until one node remains — that's the root.
- Link leaves as you emit them.

### Reference solution — Go

```go
func BulkLoad(pairs []struct{ K int; V string }, fillRatio float64) *Tree {
    leafCap := int(float64(2*T) * fillRatio)
    if leafCap < T { leafCap = T }

    var leaves []*Leaf
    cur := &Leaf{}
    for _, p := range pairs {
        if len(cur.keys) == leafCap {
            leaves = append(leaves, cur)
            nxt := &Leaf{}
            cur.next = nxt
            cur = nxt
        }
        cur.keys = append(cur.keys, p.K)
        cur.vals = append(cur.vals, p.V)
    }
    if len(cur.keys) > 0 {
        leaves = append(leaves, cur)
    }
    if len(leaves) == 1 {
        return &Tree{root: leaves[0]}
    }
    var level []Node
    for _, lf := range leaves { level = append(level, lf) }
    seps := make([]int, 0, len(leaves)-1)
    for i := 1; i < len(leaves); i++ {
        seps = append(seps, leaves[i].keys[0])
    }
    for len(level) > 1 {
        nextLevel := []Node{}
        nextSeps := []int{}
        intCap := 2 * T
        i := 0
        for i < len(level) {
            in := &Internal{}
            end := i + intCap + 1
            if end > len(level) { end = len(level) }
            in.children = level[i:end]
            if i > 0 {
                nextSeps = append(nextSeps, seps[i-1])
            }
            for j := i; j < end-1; j++ {
                in.keys = append(in.keys, seps[j])
            }
            nextLevel = append(nextLevel, in)
            i = end
        }
        level = nextLevel
        seps = nextSeps
    }
    return &Tree{root: level[0]}
}
```

### Reference solution — Java

```java
static BPlusTree bulkLoad(int[] ks, String[] vs, double fillRatio) {
    int cap = Math.max(T, (int)(2 * T * fillRatio));
    List<Leaf> leaves = new ArrayList<>();
    Leaf cur = new Leaf();
    for (int i = 0; i < ks.length; i++) {
        if (cur.n == cap) {
            leaves.add(cur);
            Leaf nx = new Leaf();
            cur.next = nx;
            cur = nx;
        }
        cur.keys[cur.n] = ks[i];
        cur.vals[cur.n] = vs[i];
        cur.n++;
    }
    if (cur.n > 0) leaves.add(cur);
    BPlusTree t = new BPlusTree();
    if (leaves.size() == 1) { t.root = leaves.get(0); return t; }
    // Build parent levels bottom-up; mirrors the Go version.
    return t;
}
```

### Reference solution — Python

```python
def bulk_load(pairs, fill_ratio=0.75):
    cap = max(T, int(2 * T * fill_ratio))
    leaves = []
    cur = Leaf()
    for k, v in pairs:
        if len(cur.keys) == cap:
            leaves.append(cur)
            nxt = Leaf()
            cur.next = nxt
            cur = nxt
        cur.keys.append(k)
        cur.vals.append(v)
    if cur.keys:
        leaves.append(cur)
    t = BPlusTree()
    if len(leaves) == 1:
        t.root = leaves[0]
        return t
    level = list(leaves)
    seps = [leaves[i].keys[0] for i in range(1, len(leaves))]
    while len(level) > 1:
        nxt_level, nxt_seps = [], []
        cap_i = 2 * T
        i = 0
        while i < len(level):
            node = Internal()
            end = min(i + cap_i + 1, len(level))
            node.children = level[i:end]
            if i > 0:
                nxt_seps.append(seps[i - 1])
            node.keys = seps[i:end - 1]
            nxt_level.append(node)
            i = end
        level, seps = nxt_level, nxt_seps
    t.root = level[0]
    return t
```

### Test cases
- Bulk-load `1..1,000,000` with 75% fill; check height is `ceil(log_t(n))` plus 1 at most.
- Compare against single-insert load: bulk should be 5–30x faster.
- Verify all keys are searchable and leaf chain walks the full range.

### Complexity
- `O(n)` total; each element is touched a constant number of times across all levels.

### Lessons
- Bulk load is **how `CREATE INDEX` works** in real databases. The query planner sorts the table once, then streams.
- A common bug: forgetting to chain the **last** leaf's `next = None`.

---

<a name="t5"></a>
## Task 5: Prefix Compression on Leaf Keys

### Problem
Extend the leaf format to store a shared prefix once. Each record becomes `(suffix_bytes)`. Decompress on read. Measure how much space you save for sorted timestamp keys.

### Hints
- Compute the common prefix of the leaf's first and last key.
- Store the prefix length and bytes at the leaf header.
- Each entry stores only the suffix; reconstruct the full key for comparison during search.

### Reference solution — Go

```go
type CompressedLeaf struct {
    prefix []byte
    suffixes [][]byte
    vals []string
    next *CompressedLeaf
}

func (lf *CompressedLeaf) full(i int) []byte {
    b := make([]byte, 0, len(lf.prefix)+len(lf.suffixes[i]))
    b = append(b, lf.prefix...)
    b = append(b, lf.suffixes[i]...)
    return b
}

func commonPrefix(a, b []byte) int {
    n := len(a)
    if len(b) < n { n = len(b) }
    for i := 0; i < n; i++ {
        if a[i] != b[i] { return i }
    }
    return n
}

func compressLeaf(keys [][]byte, vals []string) *CompressedLeaf {
    if len(keys) == 0 { return &CompressedLeaf{} }
    p := commonPrefix(keys[0], keys[len(keys)-1])
    out := &CompressedLeaf{prefix: keys[0][:p], vals: vals}
    for _, k := range keys {
        out.suffixes = append(out.suffixes, append([]byte{}, k[p:]...))
    }
    return out
}
```

### Reference solution — Java

```java
final class CompressedLeaf {
    byte[] prefix;
    List<byte[]> suffixes = new ArrayList<>();
    List<String> vals = new ArrayList<>();
    CompressedLeaf next;
    byte[] fullKey(int i) {
        byte[] s = suffixes.get(i);
        byte[] out = new byte[prefix.length + s.length];
        System.arraycopy(prefix, 0, out, 0, prefix.length);
        System.arraycopy(s, 0, out, prefix.length, s.length);
        return out;
    }
}
```

### Reference solution — Python

```python
class CompressedLeaf:
    __slots__ = ("prefix", "suffixes", "vals", "next")
    def __init__(self):
        self.prefix = b""
        self.suffixes = []
        self.vals = []
        self.next = None
    def full(self, i):
        return self.prefix + self.suffixes[i]

def common_prefix(a, b):
    n = min(len(a), len(b))
    for i in range(n):
        if a[i] != b[i]:
            return i
    return n

def compress_leaf(keys, vals):
    lf = CompressedLeaf()
    if not keys:
        return lf
    p = common_prefix(keys[0], keys[-1])
    lf.prefix = keys[0][:p]
    lf.suffixes = [k[p:] for k in keys]
    lf.vals = list(vals)
    return lf
```

### Test cases
- Compress `[b"2026-05-01T00:00:00", b"2026-05-01T00:01:00", ..., b"2026-05-01T23:59:00"]`; verify the prefix is `b"2026-05-01T"` and suffixes are 8 bytes.
- After compression, reconstructed `full(i)` equals the original key.
- Compute byte savings: 1440 keys at 19 bytes = 27,360 bytes uncompressed; with prefix `2026-05-01T` (11 bytes) and 8-byte suffixes: 11 + 1440 * 8 = 11,531 bytes. About 58% savings.

### Complexity
- Compression: `O(b * k_avg)` per leaf.
- Lookup: same `O(log b)` after reconstruction (or compare suffix directly if you know the prefix matches).

### Lessons
- Prefix compression is the most universal page-format optimization; almost free for sorted strings.
- For lookup, you do not need to materialize the full key — you can compare prefix once, then binary-search by suffix.

---

<a name="t6"></a>
## Task 6: Disk-Backed B+ Tree with Fixed Page Size

### Problem
Build a B+ tree on top of a binary file with 4 KB pages. Each page is either a `LeafPage` or `InternalPage`. Node pointers become 4-byte page IDs. Implement a tiny LRU page cache.

### Hints
- Allocate pages with a free-list (first unused ID, grow file as needed).
- Page header: `pageType` (1 byte), `nKeys` (2 bytes), `rightLink` (4 bytes), `nextLeaf` (4 bytes only for leaves).
- Use `binary.LittleEndian.PutUint32` / `ByteBuffer.putInt` / `struct.pack` to write fixed-width fields.

### Reference solution — Go (skeleton)

```go
const PageSize = 4096
const (
    PageLeaf     byte = 1
    PageInternal byte = 2
)

type Pager struct {
    f    *os.File
    next uint32
    lru  map[uint32]*Page
}

type Page struct {
    id    uint32
    dirty bool
    data  [PageSize]byte
}

func (p *Pager) Read(id uint32) (*Page, error) {
    if pg, ok := p.lru[id]; ok { return pg, nil }
    pg := &Page{id: id}
    _, err := p.f.ReadAt(pg.data[:], int64(id)*PageSize)
    if err != nil { return nil, err }
    p.lru[id] = pg
    return pg, nil
}

func (p *Pager) Write(pg *Page) error {
    _, err := p.f.WriteAt(pg.data[:], int64(pg.id)*PageSize)
    pg.dirty = false
    return err
}

// Leaf encoding: [type:1][n:2][nextLeaf:4][ keys[]:4 * n ][ valOffs[]:2 * n ][ vals[] ]
// Fits ~340 int4 keys + int4 row pointers per 4 KB leaf depending on value size.
```

### Reference solution — Java (skeleton)

```java
final class Pager {
    static final int PAGE_SIZE = 4096;
    final RandomAccessFile file;
    final Map<Integer, ByteBuffer> cache = new LinkedHashMap<>(64, 0.75f, true);
    int nextPage = 1;
    Pager(File f) throws IOException { this.file = new RandomAccessFile(f, "rw"); }
    ByteBuffer read(int id) throws IOException {
        ByteBuffer b = cache.get(id);
        if (b != null) return b;
        b = ByteBuffer.allocate(PAGE_SIZE).order(ByteOrder.LITTLE_ENDIAN);
        file.seek((long) id * PAGE_SIZE);
        file.readFully(b.array());
        cache.put(id, b);
        return b;
    }
}
```

### Reference solution — Python (skeleton)

```python
import struct, os
PAGE_SIZE = 4096
LEAF, INTERNAL = 1, 2

class Pager:
    def __init__(self, path):
        self.f = open(path, "r+b" if os.path.exists(path) else "w+b")
        self.next_id = 1
        self.cache = {}
    def read(self, pid):
        if pid in self.cache:
            return self.cache[pid]
        self.f.seek(pid * PAGE_SIZE)
        data = bytearray(self.f.read(PAGE_SIZE))
        self.cache[pid] = data
        return data
    def write(self, pid, data):
        self.f.seek(pid * PAGE_SIZE)
        self.f.write(bytes(data))

def encode_leaf(keys, vals, next_leaf):
    buf = bytearray(PAGE_SIZE)
    buf[0] = LEAF
    struct.pack_into("<H", buf, 1, len(keys))
    struct.pack_into("<I", buf, 3, next_leaf)
    off = 7
    for k in keys:
        struct.pack_into("<i", buf, off, k); off += 4
    return bytes(buf)
```

### Test cases
- Insert `1..100_000` integers; close the file; reopen; search every key.
- Force a leaf split mid-file: verify the new page has a new ID and the parent's child pointer is updated and **fsynced** before the old page is freed.
- Crash test: kill the process after a partial write, reopen, run `verify()`; assert it detects the inconsistency or recovers via WAL (extension).

### Complexity
- Same asymptotic as in-memory, but each node touch is an I/O cost — make the cache count.

### Lessons
- Fixed page size is the constraint that defines real databases. Your fanout is `floor((PageSize - header) / (key_size + child_pointer_size))`.
- Always write the **new** page first, then update the parent. Reversing order corrupts on crash.

---

<a name="t7"></a>
## Task 7: Copy-on-Write B+ Tree

### Problem
Modify Task 1 so every update produces a new version of each touched node — original nodes are never mutated. Maintain a list of root pointers, one per "snapshot." A reader uses the root at its snapshot timestamp and is immune to concurrent writes.

### Hints
- Insert recursively returns either the same node (if no changes) or a new copy.
- The path from root to the mutated leaf gets fully copied; siblings are shared.
- For real systems (LMDB, bbolt), this is the whole concurrency story — no locks, no MVCC bookkeeping.

### Reference solution — Go

```go
type CowTree struct {
    roots []Node // roots[i] is the root at snapshot i
}

func cowInsert(n Node, k int, v string) (Node, int, Node, bool) {
    if n.isLeaf() {
        old := n.(*Leaf)
        nl := &Leaf{
            keys: append([]int{}, old.keys...),
            vals: append([]string{}, old.vals...),
            next: old.next,
        }
        i := lowerBound(nl.keys, k)
        if i < len(nl.keys) && nl.keys[i] == k {
            nl.vals[i] = v
        } else {
            nl.keys = insertAt(nl.keys, i, k)
            nl.vals = insertStrAt(nl.vals, i, v)
        }
        if len(nl.keys) <= 2*T {
            return nl, 0, nil, false
        }
        mid := len(nl.keys) / 2
        right := &Leaf{
            keys: append([]int{}, nl.keys[mid:]...),
            vals: append([]string{}, nl.vals[mid:]...),
            next: nl.next,
        }
        nl.keys = nl.keys[:mid]
        nl.vals = nl.vals[:mid]
        nl.next = right
        return nl, right.keys[0], right, true
    }
    old := n.(*Internal)
    ni := &Internal{
        keys:     append([]int{}, old.keys...),
        children: append([]Node{}, old.children...),
    }
    i := upperBound(ni.keys, k)
    newChild, sep, sib, split := cowInsert(ni.children[i], k, v)
    ni.children[i] = newChild
    if !split {
        return ni, 0, nil, false
    }
    ni.keys = insertAt(ni.keys, i, sep)
    ni.children = insertChildAt(ni.children, i+1, sib)
    if len(ni.keys) <= 2*T {
        return ni, 0, nil, false
    }
    mid := len(ni.keys) / 2
    sepUp := ni.keys[mid]
    right := &Internal{
        keys:     append([]int{}, ni.keys[mid+1:]...),
        children: append([]Node{}, ni.children[mid+1:]...),
    }
    ni.keys = ni.keys[:mid]
    ni.children = ni.children[:mid+1]
    return ni, sepUp, right, true
}

func (t *CowTree) Insert(k int, v string) int {
    root := t.roots[len(t.roots)-1]
    newRoot, sep, sib, split := cowInsert(root, k, v)
    if split {
        newRoot = &Internal{keys: []int{sep}, children: []Node{newRoot, sib}}
    }
    t.roots = append(t.roots, newRoot)
    return len(t.roots) - 1
}
```

### Reference solution — Java (sketch)

```java
final class CowTree {
    List<Node> roots = new ArrayList<>();
    int insert(int k, String v) {
        Node curr = roots.get(roots.size() - 1);
        Object[] r = cowInsert(curr, k, v);
        Node newRoot = (Node) r[0];
        if (r[2] != null) {
            Internal in = new Internal();
            in.keys[0] = (int) r[1]; in.n = 1;
            in.children[0] = newRoot;
            in.children[1] = (Node) r[2];
            newRoot = in;
        }
        roots.add(newRoot);
        return roots.size() - 1;
    }
    // cowInsert returns {newNode, sepKey, newSibling-or-null}.
}
```

### Reference solution — Python

```python
class CowTree:
    def __init__(self):
        self.roots = [Leaf()]
    def insert(self, k, v):
        new_root, split = self._cow(self.roots[-1], k, v)
        if split:
            sep, sib = split
            r = Internal()
            r.keys = [sep]
            r.children = [new_root, sib]
            new_root = r
        self.roots.append(new_root)
        return len(self.roots) - 1
    def _cow(self, n, k, v):
        if isinstance(n, Leaf):
            nl = Leaf()
            nl.keys = list(n.keys); nl.vals = list(n.vals); nl.next = n.next
            i = 0
            while i < len(nl.keys) and nl.keys[i] < k:
                i += 1
            if i < len(nl.keys) and nl.keys[i] == k:
                nl.vals[i] = v
            else:
                nl.keys.insert(i, k); nl.vals.insert(i, v)
            if len(nl.keys) <= 2 * T:
                return nl, None
            mid = len(nl.keys) // 2
            right = Leaf()
            right.keys = nl.keys[mid:]; right.vals = nl.vals[mid:]; right.next = nl.next
            nl.keys = nl.keys[:mid]; nl.vals = nl.vals[:mid]; nl.next = right
            return nl, (right.keys[0], right)
        ni = Internal()
        ni.keys = list(n.keys); ni.children = list(n.children)
        i = 0
        while i < len(ni.keys) and ni.keys[i] <= k:
            i += 1
        child, split = self._cow(ni.children[i], k, v)
        ni.children[i] = child
        if not split:
            return ni, None
        sep, sib = split
        ni.keys.insert(i, sep); ni.children.insert(i + 1, sib)
        if len(ni.keys) <= 2 * T:
            return ni, None
        mid = len(ni.keys) // 2
        sep_up = ni.keys[mid]
        right = Internal()
        right.keys = ni.keys[mid + 1:]; right.children = ni.children[mid + 1:]
        ni.keys = ni.keys[:mid]; ni.children = ni.children[:mid + 1]
        return ni, (sep_up, right)
```

### Test cases
- Insert `1, 2, 3`; snapshot 1 sees only `1`; snapshot 2 sees `1, 2`; snapshot 3 sees `1, 2, 3`.
- After 1000 inserts, snapshot 500 still has exactly 500 keys.
- Garbage-collect snapshots earlier than the oldest reader; assert memory comes back.

### Complexity
- `O(log_t n)` extra memory per insert (the copied path).
- Each snapshot read is `O(log_t n)`.

### Lessons
- CoW gives you transactions for free — until you need to GC old roots, which becomes the hardest part of the design.
- LMDB's design uses a **single writer** with CoW; this skips most of the GC pain because old roots can be retired in batches.

---

<a name="t8"></a>
## Task 8: MVCC Index Returning Row Versions per Timestamp

### Problem
Each value is a chain of `(timestamp, value, next)` versions. `search(k, ts)` returns the value whose timestamp is the largest `<= ts`. The B+ tree key is still `k`; the leaf entry points to the version chain.

### Hints
- Use a real append-only version chain per key.
- For `ts = ∞`, return the latest version.
- For `ts < first_version.ts`, return "not found" (snapshot too old / key didn't exist).

### Reference solution — Go

```go
type Version struct {
    ts   int64
    val  string
    next *Version
}

type MVCCLeaf struct {
    keys     []int
    versions []*Version
    next     *MVCCLeaf
}

func (lf *MVCCLeaf) Read(k int, ts int64) (string, bool) {
    i := lowerBound(lf.keys, k)
    if i >= len(lf.keys) || lf.keys[i] != k {
        return "", false
    }
    for v := lf.versions[i]; v != nil; v = v.next {
        if v.ts <= ts {
            return v.val, true
        }
    }
    return "", false
}

func (lf *MVCCLeaf) Write(k int, ts int64, val string) {
    i := lowerBound(lf.keys, k)
    if i < len(lf.keys) && lf.keys[i] == k {
        lf.versions[i] = &Version{ts: ts, val: val, next: lf.versions[i]}
        return
    }
    lf.keys = insertAt(lf.keys, i, k)
    lf.versions = insertVerAt(lf.versions, i, &Version{ts: ts, val: val})
}
```

### Reference solution — Java

```java
static final class Version {
    long ts;
    String val;
    Version next;
    Version(long ts, String val, Version n) { this.ts = ts; this.val = val; this.next = n; }
}

String read(int k, long ts) {
    Leaf lf = descendTo(k);
    int i = lowerBound(lf.keys, lf.n, k);
    if (i >= lf.n || lf.keys[i] != k) return null;
    for (Version v = lf.versions[i]; v != null; v = v.next) {
        if (v.ts <= ts) return v.val;
    }
    return null;
}
```

### Reference solution — Python

```python
class Version:
    __slots__ = ("ts", "val", "next")
    def __init__(self, ts, val, nxt=None):
        self.ts = ts
        self.val = val
        self.next = nxt

class MVCCLeaf:
    __slots__ = ("keys", "versions", "next")
    def __init__(self):
        self.keys, self.versions, self.next = [], [], None
    def read(self, k, ts):
        for i, x in enumerate(self.keys):
            if x == k:
                v = self.versions[i]
                while v is not None:
                    if v.ts <= ts:
                        return v.val
                    v = v.next
                return None
        return None
    def write(self, k, ts, val):
        for i, x in enumerate(self.keys):
            if x == k:
                self.versions[i] = Version(ts, val, self.versions[i])
                return
            if x > k:
                self.keys.insert(i, k)
                self.versions.insert(i, Version(ts, val))
                return
        self.keys.append(k)
        self.versions.append(Version(ts, val))
```

### Test cases
- Write key=1 with values "a" at ts=10, "b" at ts=20, "c" at ts=30.
- `read(1, 5)` returns None.
- `read(1, 10)` returns "a".
- `read(1, 25)` returns "b".
- `read(1, 1000)` returns "c".
- Run 100 concurrent writers and 100 readers with different `ts`; assert each reader sees a consistent snapshot.

### Complexity
- `read`: `O(log_t n + V)` where V is the version chain length (bounded by tx GC).
- `write`: `O(log_t n + 1)`.

### Lessons
- The B+ tree key locates the version chain; the chain is sorted by descending timestamp.
- Snapshot isolation falls out of MVCC almost for free; the hard part is the **garbage collection** of versions no reader can see (vacuum in PostgreSQL).

---

<a name="t9"></a>
## Task 9: Order-Statistic B+ Tree

### Problem
Add a `subtreeCount` field to every internal node child slot. Implement `rank(k)` (number of keys `< k`) and `select(i)` (the i-th key in order).

### Hints
- Each internal node has `counts[i]` = number of keys in subtree `children[i]`.
- On insert/delete, walk the modified path and increment / decrement the counts.
- `rank(k)`: descend, accumulating left-subtree counts as you go.
- `select(i)`: at each node, find the child whose cumulative count contains `i`, subtract preceding counts, descend.

### Reference solution — Go

```go
type OSInternal struct {
    keys     []int
    children []Node
    counts   []int // counts[i] = subtree size of children[i]
}

func (t *Tree) Rank(k int) int {
    return rank(t.root, k)
}
func rank(n Node, k int) int {
    if n.isLeaf() {
        lf := n.(*Leaf)
        return lowerBound(lf.keys, k)
    }
    in := n.(*OSInternal)
    sum := 0
    for i, sep := range in.keys {
        if k <= sep {
            return sum + rank(in.children[i], k)
        }
        sum += in.counts[i]
    }
    return sum + rank(in.children[len(in.children)-1], k)
}

func (t *Tree) Select(i int) int {
    return selectAt(t.root, i)
}
func selectAt(n Node, i int) int {
    if n.isLeaf() {
        return n.(*Leaf).keys[i]
    }
    in := n.(*OSInternal)
    for j, c := range in.counts {
        if i < c {
            return selectAt(in.children[j], i)
        }
        i -= c
    }
    return -1
}
```

### Reference solution — Java

```java
int rank(Node n, int k) {
    if (n.isLeaf()) return lowerBound(((Leaf) n).keys, ((Leaf) n).n, k);
    OSInternal in = (OSInternal) n;
    int sum = 0;
    for (int i = 0; i < in.n; i++) {
        if (k <= in.keys[i]) return sum + rank(in.children[i], k);
        sum += in.counts[i];
    }
    return sum + rank(in.children[in.n], k);
}

int select(Node n, int i) {
    if (n.isLeaf()) return ((Leaf) n).keys[i];
    OSInternal in = (OSInternal) n;
    for (int j = 0; j <= in.n; j++) {
        if (i < in.counts[j]) return select(in.children[j], i);
        i -= in.counts[j];
    }
    throw new IndexOutOfBoundsException();
}
```

### Reference solution — Python

```python
class OSInternal(Internal):
    def __init__(self):
        super().__init__()
        self.counts = []

def rank(n, k):
    if isinstance(n, Leaf):
        for i, x in enumerate(n.keys):
            if x >= k:
                return i
        return len(n.keys)
    s = 0
    for i, sep in enumerate(n.keys):
        if k <= sep:
            return s + rank(n.children[i], k)
        s += n.counts[i]
    return s + rank(n.children[-1], k)

def select_at(n, i):
    if isinstance(n, Leaf):
        return n.keys[i]
    for j, c in enumerate(n.counts):
        if i < c:
            return select_at(n.children[j], i)
        i -= c
    raise IndexError
```

### Test cases
- Insert `1..100`. `rank(50)` returns 49. `select(0)` returns 1. `select(99)` returns 100.
- After deleting 50, `rank(50)` returns 49, `select(49)` returns 51.

### Complexity
- Both `rank` and `select`: `O(log_t n)`.

### Lessons
- Counts only need to be touched on the modified root-to-leaf path. The rest of the tree is unaffected.
- Order statistics turn the B+ tree into a *ranked* index — useful for "the 1000th-largest order" kinds of queries.

---

<a name="t10"></a>
## Task 10: Benchmark B+ Tree vs Classic B-tree

### Problem
Implement both a classic B-tree and your B+ tree from Task 1+2. Run a benchmark that:
- Inserts 1,000,000 random integers into each.
- Performs 100,000 range scans of average width 100.
- Reports total time and per-operation latency.

The B+ tree should win range scans by 5–50x; insert times should be within 1.5x of each other.

### Reference solution — Go

```go
func BenchAll() {
    bp := New()
    bt := classicNew()
    keys := make([]int, 1_000_000)
    for i := range keys { keys[i] = rand.Int() }

    start := time.Now()
    for _, k := range keys { bp.Insert(k, "v") }
    fmt.Println("B+ insert:", time.Since(start))

    start = time.Now()
    for _, k := range keys { bt.Insert(k, "v") }
    fmt.Println("B-tree insert:", time.Since(start))

    rangeStart := time.Now()
    total := 0
    for i := 0; i < 100_000; i++ {
        lo := rand.Int()
        hi := lo + 100
        total += len(bp.RangeScan(lo, hi))
    }
    fmt.Println("B+ range scan total:", time.Since(rangeStart), "results:", total)

    rangeStart = time.Now()
    total = 0
    for i := 0; i < 100_000; i++ {
        lo := rand.Int()
        hi := lo + 100
        total += bt.RangeScan(lo, hi)
    }
    fmt.Println("B-tree range scan total:", time.Since(rangeStart), "results:", total)
}
```

### Reference solution — Java

```java
public static void main(String[] args) {
    BPlusTree bp = new BPlusTree();
    BTree bt = new BTree();
    Random rnd = new Random(42);
    int[] keys = rnd.ints(1_000_000).toArray();

    long s = System.nanoTime();
    for (int k : keys) bp.insert(k, "v");
    System.out.println("B+ insert ms: " + (System.nanoTime() - s) / 1_000_000);

    s = System.nanoTime();
    for (int k : keys) bt.insert(k, "v");
    System.out.println("B-tree insert ms: " + (System.nanoTime() - s) / 1_000_000);

    s = System.nanoTime();
    long total = 0;
    for (int i = 0; i < 100_000; i++) {
        int lo = rnd.nextInt();
        total += bp.rangeScan(lo, lo + 100).size();
    }
    System.out.println("B+ scan ms: " + (System.nanoTime() - s) / 1_000_000 + " total=" + total);
}
```

### Reference solution — Python

```python
import random, time
from bplus import BPlusTree
from btree import BTree

bp, bt = BPlusTree(), BTree()
keys = [random.randint(0, 1 << 30) for _ in range(1_000_000)]

t = time.perf_counter()
for k in keys:
    bp.insert(k, "v")
print(f"B+ insert: {time.perf_counter()-t:.2f}s")

t = time.perf_counter()
for k in keys:
    bt.insert(k, "v")
print(f"B-tree insert: {time.perf_counter()-t:.2f}s")

t = time.perf_counter()
total = 0
for _ in range(100_000):
    lo = random.randint(0, 1 << 30)
    total += len(bp.range_scan(lo, lo + 100))
print(f"B+ range: {time.perf_counter()-t:.2f}s total={total}")

t = time.perf_counter()
total = 0
for _ in range(100_000):
    lo = random.randint(0, 1 << 30)
    total += bt.range_scan(lo, lo + 100)
print(f"B-tree range: {time.perf_counter()-t:.2f}s total={total}")
```

### Test cases
- Vary `t` from 3 to 64; tabulate height and insert latency. Height should drop log-style; insert latency goes through a minimum near typical CPU cache line sizes.
- Vary range width from 10 to 100,000; B+ tree advantage grows with width.

### Complexity
- Insert: B+ tree is `O(log_t n)` (same as B-tree).
- Range scan width `w`: B+ tree is `O(log_t n + w / b)`, B-tree is `O(log_t n * w)` in the worst case (multiple re-descents).

### Lessons
- The B+ tree's range-scan speed advantage gets bigger as the range widens — which is exactly the database workload.
- For exact-match lookups only, B+ tree and B-tree are essentially tied; the choice is dictated by the access pattern.

---

## Final notes

After completing all ten tasks you will have written, in three languages, the same family of trees that powers PostgreSQL, MySQL, SQLite, and the JVM file system. The two structural rules — data at leaves only, leaves linked in a list — never become more sophisticated than they were at task 1. What changes is everything around them: locking, page format, MVCC, persistence, GC. The B+ tree is the rare data structure that grows in every direction without changing its core.

Go back to `senior.md` and `professional.md` and re-read the sections on PostgreSQL nbtree, LMDB, and ART after finishing these tasks — you will read them like a different person.
