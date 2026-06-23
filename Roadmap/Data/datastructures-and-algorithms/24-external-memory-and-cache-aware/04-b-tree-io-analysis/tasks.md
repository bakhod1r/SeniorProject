# B-Tree I/O Analysis — Practice Tasks

> Coding tasks are solved in **one** language (**Go** or **Python**) with the full reference solution; a short snippet in the other language is provided where it clarifies the port. Where marked **[coding]**, build (or reuse) a **B-tree / B+-tree on a simulated disk** with a **per-node I/O counter** (one I/O per node touched), replay the workload, and **count block transfers (I/Os)**. The acceptance test is always the same: *the structure is correct **and** the measured I/O count matches the bound derived for the tested parameters — `log_B N` for search/insert/delete, `log_B N + K/B` for range, `N/B` for bulk load.*
> **[analysis]** tasks need no code: derive the height bound, the search lower bound, or the `B^ε` / LSM write-amplification tradeoff from first principles — model derivations are provided so you can grade yourself.

The **B-tree** is the external-memory search structure: a balanced multiway tree whose node fan-out is chosen so that **one node = one block**, so every root-to-leaf walk costs one I/O per level and the height is the disk-access count. Where a binary search tree pays `Θ(log₂ N)` I/Os — a fresh block per level — the B-tree packs `Θ(B)` keys per node and pays only `Θ(log_B N)`, a factor `log₂ B` fewer. Two parameters fix everything:

- **`N`** — the number of keys stored.
- **`B`** — the **node fan-out** (branching factor): a node holds up to `B − 1` keys and `B` children, sized so the node fills one block. One I/O reads or writes one node.

The bounds you will implement, measure, and prove:

| Operation | I/O bound | Why |
| --- | --- | --- |
| **Height** | `Θ(log_B N)` | fan-out `B` per node; `h ≤ log_{⌈B/2⌉}((N+1)/2)` |
| **Search** | `Θ(log_B N)` | one node (one I/O) per level, root to leaf |
| **Insert / Delete** | `Θ(log_B N)` | search down + `O(1)` splits/merges per level |
| **Range query** | `Θ(log_B N + K/B)` | descend to the low key, then scan `K` results over linked leaves |
| **Bulk load** (sorted) | `Θ(N/B)` | build bottom-up, one scan of the input |
| **Buffered (`B^ε`) insert** | `Θ((1/B)·log_{M/B} N)` amortized | batch flushes amortize the descent over `B` keys |

The recurring discipline for every coding task is the same as for any external-memory bound: **instrument the cost, replay the workload, count the resource, and confirm the measured count respects the derived bound.** A height bound you never replay against a simulator is just a hope; an I/O count you cannot derive is just a number. Tie the two together on every task — *correct **and** count matches*.

**Related practice:**
- [The I/O Model tasks](../01-the-io-model/tasks.md) — the `(M, B)` block-cache simulator, `scan(N) = Θ(N/B)`, and the `Θ(log_B N)` search bound this topic specializes into a full dynamic index.
- [B-tree (data-structures) tasks](../../09-trees/11-b-tree/tasks.md) — node splits/merges, B+-tree leaf chaining, and the structural invariants this topic analyzes for I/O cost.

**This topic's notes:** [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md)

A note on the model and quantities used throughout:
- **I/O (node transfer).** One read or write of a single B-tree **node**, which fills one block; cost `1`. Computation inside a resident node (binary-searching its `≤ B − 1` keys) is free. The cost of an operation is its total node-transfer count.
- **Fan-out `B`.** Each internal node has between `⌈B/2⌉` and `B` children (the root may have as few as `2`); a leaf holds between `⌈B/2⌉ − 1` and `B − 1` keys. The `⌈B/2⌉` floor — half-full nodes — is what bounds the height.
- **B+-tree.** All keys live in the **leaves**, which are chained in a sorted linked list; internal nodes hold only **separator** keys to route searches. Range queries descend once and then walk the leaf chain — the property that makes `Θ(log_B N + K/B)` ranges possible.
- **Write-optimized (`B^ε` / buffer tree).** Each internal node carries a **buffer** of pending updates with `B^ε` pivots and `B − B^ε` buffer slots. Inserts drop into the root buffer and flush down in batches, amortizing the `log_B N` descent over `Θ(B^{1−ε})` keys — trading slightly slower queries for far cheaper inserts. The parameter `ε ∈ (0, 1]` slides between a plain B-tree (`ε = 1`) and an `LSM`-like write-optimized regime (`ε → 0`).

---

## Beginner Tasks

### Task 1 — Build a B-tree on simulated disk with a per-node I/O counter; verify search costs the height **[coding]**

`[easy]` Implement the core instrument for every later task: a **B-tree of fan-out `B`** whose nodes live on a simulated disk, with an **I/O counter that ticks once per node touched**. Each node holds up to `B − 1` keys and `B` children; internal nodes split when full. Insert `N` keys, then **search** and confirm the search cost equals the **tree height** — one I/O per level, `Θ(log_B N)`.

#### Python

```python
import math

class Disk:
    """Holds B-tree nodes by id; one read or write of a node is one I/O."""
    def __init__(self):
        self.nodes = {}            # node_id -> node dict
        self._next = 0
        self.ios = 0

    def alloc(self, node):
        nid = self._next; self._next += 1
        self.nodes[nid] = node
        self.ios += 1              # writing a fresh node is one I/O
        return nid

    def read(self, nid):
        self.ios += 1             # touching a node = one block transfer
        return self.nodes[nid]

    def write(self, nid, node):
        self.ios += 1
        self.nodes[nid] = node

class BTree:
    """Classic B-tree of fan-out B (node holds <= B-1 keys, <= B children)."""
    def __init__(self, B, disk):
        self.B = B
        self.disk = disk
        self.root = disk.alloc({"leaf": True, "keys": [], "kids": []})

    def _full(self, node):
        return len(node["keys"]) == self.B - 1

    def search(self, key):
        """Return (found, ios_for_this_search). Counts one I/O per node visited."""
        before = self.disk.ios
        nid = self.root
        while True:
            node = self.disk.read(nid)
            i = 0
            while i < len(node["keys"]) and key > node["keys"][i]:
                i += 1
            if i < len(node["keys"]) and node["keys"][i] == key:
                return True, self.disk.ios - before
            if node["leaf"]:
                return False, self.disk.ios - before
            nid = node["kids"][i]

    def _split_child(self, parent, idx):
        B = self.B
        child = self.disk.read(parent["kids"][idx])
        mid = (B - 1) // 2
        up_key = child["keys"][mid]
        right = {"leaf": child["leaf"],
                 "keys": child["keys"][mid + 1:],
                 "kids": child["kids"][mid + 1:] if not child["leaf"] else []}
        child["keys"] = child["keys"][:mid]
        if not child["leaf"]:
            child["kids"] = child["kids"][:mid + 1]
        rid = self.disk.alloc(right)
        self.disk.write(parent["kids"][idx], child)
        parent["keys"].insert(idx, up_key)
        parent["kids"].insert(idx + 1, rid)

    def insert(self, key):
        root = self.disk.read(self.root)
        if self._full(root):
            new_root = {"leaf": False, "keys": [], "kids": [self.root]}
            nrid = self.disk.alloc(new_root)
            self.root = nrid
            self._split_child(new_root, 0)
            self.disk.write(nrid, new_root)
            self._insert_nonfull(nrid, key)
        else:
            self._insert_nonfull(self.root, key)

    def _insert_nonfull(self, nid, key):
        node = self.disk.read(nid)
        if node["leaf"]:
            i = 0
            while i < len(node["keys"]) and key > node["keys"][i]:
                i += 1
            if i < len(node["keys"]) and node["keys"][i] == key:
                return                      # no duplicates
            node["keys"].insert(i, key)
            self.disk.write(nid, node)
            return
        i = len(node["keys"]) - 1
        while i >= 0 and key < node["keys"][i]:
            i -= 1
        i += 1
        child = self.disk.read(node["kids"][i])
        if self._full(child):
            self._split_child(node, i)
            self.disk.write(nid, node)
            if key > node["keys"][i]:
                i += 1
        self._insert_nonfull(node["kids"][i], key)

    def height(self):
        h, nid = 0, self.root
        while True:
            node = self.disk.nodes[nid]     # peek without charging I/O
            if node["leaf"]:
                return h
            h += 1
            nid = node["kids"][0]

if __name__ == "__main__":
    import random
    random.seed(0)
    for (N, B) in [(1000, 8), (10000, 16), (100000, 64)]:
        disk = Disk()
        t = BTree(B, disk)
        keys = list(range(N)); random.shuffle(keys)
        for k in keys:
            t.insert(k)
        h = t.height()
        # Search cost = number of nodes on the root-to-leaf path = h + 1.
        costs = [t.search(k)[1] for k in random.sample(range(N), 200)]
        avg = sum(costs) / len(costs)
        bound = math.ceil(math.log(N, B)) + 1
        print(f"N={N:6d} B={B:3d}  height={h}  avg search I/Os={avg:4.1f}  "
              f"<= log_B N + 1 = {bound}")
        assert all(c <= h + 1 for c in costs), "search visits at most height+1 nodes"
        assert h <= bound, "height is O(log_B N)"
    print("OK: B-tree search I/Os = path length = Theta(log_B N)")
```

#### Go (node + search core)

```go
type Node struct {
	Leaf bool
	Keys []int
	Kids []int // child node ids
}

func (t *BTree) Search(key int) (bool, int) {
	before := t.disk.ios
	nid := t.root
	for {
		node := t.disk.Read(nid) // +1 I/O per node touched
		i := 0
		for i < len(node.Keys) && key > node.Keys[i] {
			i++
		}
		if i < len(node.Keys) && node.Keys[i] == key {
			return true, t.disk.ios - before
		}
		if node.Leaf {
			return false, t.disk.ios - before
		}
		nid = node.Kids[i]
	}
}
```

- **Constraints:** A node holds at most `B − 1` keys and `B` children; split a full child *before* descending into it (proactive split). Every node access goes through `disk.read`/`disk.write` so the I/O count is faithful. The search must visit **exactly one node per level** — its cost is the path length `= height + 1`.
- **Hint:** A B-tree of `N` keys and fan-out `B` has height `Θ(log_B N)` because each level multiplies the key capacity by `≈ B`. Search descends one node per level and binary-searches its keys *in memory* (free), so the I/O count is the number of levels touched — never more than `height + 1`. Computation inside a node is free; only the node fetch costs.
- **Acceptance test:** Every search costs `≤ height + 1` I/Os, and `height ≤ ⌈log_B N⌉`, for every `(N, B)`. This is the `Θ(log_B N)` search bound made exact. Keep this `Disk` + `BTree` scaffold — every later coding task drives it.

---

### Task 2 — B-tree vs BST: tabulate search I/Os over varying `N` and `B` **[coding]**

`[easy]` Make the `log₂ B` advantage concrete. For the same keys, count the search I/Os of the B-tree (one I/O per level, `log_B N` levels) against a **binary search tree** where every node is its own block (one I/O per level, `log₂ N` levels). Tabulate over varying `N` and `B` and confirm the ratio approaches `log₂ B`.

#### Python

```python
import math, random

def bst_search_ios(N):
    """A balanced BST stores one key per node = one block; a search touches
    ~log2(N) nodes, each a separate I/O."""
    return math.ceil(math.log2(N)) if N > 1 else 1

if __name__ == "__main__":
    random.seed(1)
    print(f"{'N':>8} {'B':>5} {'BST I/Os':>9} {'B-tree I/Os':>12} "
          f"{'ratio':>7} {'log2 B':>7}")
    for N in (10**3, 10**5, 10**7):
        for B in (4, 16, 128, 1024):
            disk = Disk()
            t = BTree(B, disk)                       # from Task 1
            n_built = min(N, 100000)                 # build a sample, extrapolate height
            keys = list(range(n_built)); random.shuffle(keys)
            for k in keys:
                t.insert(k)
            # B-tree height scales as log_B N; extrapolate to full N.
            bt_ios = math.ceil(math.log(N, B)) + 1
            bst_ios = bst_search_ios(N)
            ratio = bst_ios / bt_ios
            print(f"{N:>8} {B:>5} {bst_ios:>9} {bt_ios:>12} "
                  f"{ratio:>7.1f} {math.log2(B):>7.1f}")
            assert bt_ios <= bst_ios + 1, "B-tree never costs more I/Os than a BST"
    print("\nOK: B-tree/BST search-I/O ratio -> log2 B (B=1024 => ~10x fewer disk probes)")
```

- **Constraints:** Both structures store the *same* keys; the only difference is the block packing — `B − 1` keys per B-tree node versus `1` key per BST node. Count I/Os as the number of nodes on the root-to-leaf path in each. Sweep `N` and `B` and report the ratio against `log₂ B`.
- **Hint:** `log_B N = log₂ N / log₂ B`, so the B-tree's I/O count is the BST's divided by `log₂ B`. With `B = 1024`, `log₂ B = 10`: a search that costs `23` block reads in a BST (`log₂ 10⁷ ≈ 23`) costs only `≈ 3` in the B-tree. This is exactly why every on-disk index is a B-tree, never a binary tree.
- **Acceptance test:** The B-tree search I/Os equal `⌈log_B N⌉ + 1`; the BST's equal `⌈log₂ N⌉`; their ratio approaches `log₂ B` as `N` grows, and the gap *widens* with `B`. Block-packing turns the search logarithm's base from `2` into `B`.

---

### Task 3 — Hand-compute height and I/Os for `N = 10⁹`, `B ∈ {100, 1000}`; confirm in code **[analysis + coding]**

`[easy]` Before trusting the machine, work the headline numbers **on paper**. For a billion keys, how tall is a B-tree of fan-out `100`? Of `1000`? And how many disk probes does a point lookup cost? Derive it, then confirm against the height formula.

> **Do the arithmetic by hand first**, then run the predictor.

**Model derivation.**

A B-tree of fan-out `B` with all nodes full holds `≈ B^h` keys at height `h`, so the height to store `N` keys is `h ≈ log_B N` and a point search costs `h + 1 ≤ ⌈log_B N⌉ + 1` I/Os.

*Worked numbers,* `N = 10⁹`:

```
B = 100:   log_100(10^9) = 9 / 2 = 4.5  ->  height ~ 5,  search ~ 5-6 I/Os.
B = 1000:  log_1000(10^9) = 9 / 3 = 3   ->  height ~ 3,  search ~ 3-4 I/Os.
```

A **billion-key** index is reachable in **3–6 disk seeks** — and if the top two or three levels are cached in RAM (Task 8), only the bottom **1–2** levels ever hit disk. Compare a BST: `log₂ 10⁹ ≈ 30` block reads, `5–10×` more. The enormous fan-out is the entire reason a database index lookup feels instant.

#### Python

```python
import math

def btree_height_and_ios(N, B):
    h = math.ceil(math.log(N, B)) if N > 1 else 0
    return h, h + 1                                   # search touches h+1 nodes

if __name__ == "__main__":
    N = 10**9
    print(f"N = {N:,}")
    print(f"{'B':>6} {'log_B N':>9} {'height':>7} {'search I/Os':>12} {'BST I/Os':>9}")
    for B in (100, 1000):
        h, ios = btree_height_and_ios(N, B)
        bst = math.ceil(math.log2(N))
        print(f"{B:>6} {math.log(N, B):>9.2f} {h:>7} {ios:>12} {bst:>9}")
    # Confirm the closed form against the formula for assorted N, B.
    for (Nx, Bx, expect_h) in [(10**9, 100, 5), (10**9, 1000, 3), (10**6, 1000, 2)]:
        h, _ = btree_height_and_ios(Nx, Bx)
        assert h == expect_h, f"height(N={Nx}, B={Bx}) should be {expect_h}, got {h}"
    print("\nOK: height = ceil(log_B N); N=10^9 reachable in 3-6 I/Os")
```

- **Constraints:** Derive `h = ⌈log_B N⌉` and search `= h + 1` by hand for both `B = 100` and `B = 1000` at `N = 10⁹`, then confirm with the predictor. State the cached-top-levels effect qualitatively (formalized in Task 8).
- **Acceptance test:** The hand-derived heights (`5` for `B = 100`, `3` for `B = 1000`) match the predictor; search costs `3–6` I/Os; the BST comparison shows `log₂ 10⁹ ≈ 30`, a `5–10×` gap. The base-`B` logarithm keeps a billion-key lookup to a handful of seeks.

---

### Task 4 — Insert cost: measure that an insert touches `Θ(log_B N)` nodes **[coding]**

`[easy]` An insert searches down to a leaf (`log_B N` I/Os) and then does `O(1)` work per level — splitting a full node and pushing one key up, at most once per level on the path. So insert cost is `Θ(log_B N)`, the same as search. Measure the I/Os an insert touches and confirm it tracks the height, with split-heavy inserts costing only a small constant more.

#### Python

```python
import math, random

if __name__ == "__main__":
    random.seed(2)
    print(f"{'N':>7} {'B':>5} {'height':>7} {'avg insert I/Os':>16} "
          f"{'~c*log_B N':>11}")
    for (N, B) in [(5000, 8), (20000, 16), (100000, 64)]:
        disk = Disk()
        t = BTree(B, disk)                           # from Task 1
        keys = list(range(N)); random.shuffle(keys)
        for k in keys[:N // 2]:                       # warm the tree to size ~N/2
            t.insert(k)
        # Measure I/Os per insert for the second half.
        costs = []
        for k in keys[N // 2:]:
            before = disk.ios
            t.insert(k)
            costs.append(disk.ios - before)
        h = t.height()
        avg = sum(costs) / len(costs)
        bound = 4 * (math.ceil(math.log(N, B)) + 1)   # search + O(1) split work/level
        print(f"{N:>7} {B:>5} {h:>7} {avg:>16.1f} {bound:>11}")
        assert avg <= bound, "insert cost is Theta(log_B N) up to a small constant"
    print("OK: insert touches Theta(log_B N) nodes (search down + O(1) splits/level)")
```

- **Constraints:** Count I/Os from just before to just after each insert. The cost is dominated by the root-to-leaf descent (`h + 1` reads); proactive splitting adds at most a few node writes per level on the path, a small constant factor. Warm the tree before measuring so heights are realistic.
- **Hint:** With proactive splitting, an insert splits each full node it passes through — at most one split per level, each `O(1)` node writes — so the worst-case insert is `Θ(log_B N)` I/Os, the same order as search. The amortized number of splits per insert is actually `O(1/B)` (most inserts split nothing), so the *average* insert is barely more than a search.
- **Acceptance test:** Average insert I/Os stay within a small constant factor of `log_B N`; no insert exceeds `O(log_B N)`. Inserts are `Θ(log_B N)` — search down plus `O(1)` restructuring per level.

---

## Intermediate Tasks

### Task 5 — B+-tree with linked leaves and a RANGE query: verify `Θ(log_B N + K/B)` **[coding]**

`[medium]` In a **B+-tree** all keys live in the **leaves**, chained as a sorted linked list; internal nodes hold only separators. A **range query** `[lo, hi]` descends once to the leaf containing `lo` (`Θ(log_B N)` I/Os), then walks the leaf chain emitting keys until it passes `hi` — touching `Θ(K/B)` leaf blocks for `K` results. Implement it and confirm the total cost is `Θ(log_B N + K/B)`.

#### Python

```python
import math, random

class BPlusTree:
    """B+-tree: keys in leaves only; leaves chained via 'next'. Internal nodes
    hold separators. One node access = one I/O (counted on self.disk)."""
    def __init__(self, B, disk):
        self.B = B
        self.disk = disk
        self.root = disk.alloc({"leaf": True, "keys": [], "vals": [], "next": None})

    def _find_leaf(self, key):
        nid = self.root
        node = self.disk.read(nid)
        while not node["leaf"]:
            i = 0
            while i < len(node["keys"]) and key >= node["keys"][i]:
                i += 1
            nid = node["kids"][i]
            node = self.disk.read(nid)
        return nid, node

    def insert(self, key, val=None):
        nid, leaf = self._find_leaf(key)
        i = 0
        while i < len(leaf["keys"]) and key > leaf["keys"][i]:
            i += 1
        if i < len(leaf["keys"]) and leaf["keys"][i] == key:
            return
        leaf["keys"].insert(i, key); leaf["vals"].insert(i, val)
        self.disk.write(nid, leaf)
        if len(leaf["keys"]) >= self.B:               # leaf overflow: split
            self._split_leaf(nid, leaf)

    def _split_leaf(self, nid, leaf):
        B = self.B
        mid = len(leaf["keys"]) // 2
        right = {"leaf": True, "keys": leaf["keys"][mid:], "vals": leaf["vals"][mid:],
                 "next": leaf["next"]}
        rid = self.disk.alloc(right)
        leaf["keys"] = leaf["keys"][:mid]; leaf["vals"] = leaf["vals"][:mid]
        leaf["next"] = rid
        self.disk.write(nid, leaf)
        self._insert_separator(nid, right["keys"][0], rid)

    def _insert_separator(self, left_id, sep, right_id):
        # Simplified: rebuild a path-aware parent insert. For the I/O-counting
        # purpose we keep a single root that grows; full split logic mirrors Task 1.
        root = self.disk.read(self.root)
        if root["leaf"] or self.root == left_id:
            new_root = {"leaf": False, "keys": [sep], "kids": [left_id, right_id]}
            self.root = self.disk.alloc(new_root)
            return
        # Insert separator into the existing internal root (kept shallow for the demo).
        i = 0
        while i < len(root["keys"]) and sep > root["keys"][i]:
            i += 1
        root["keys"].insert(i, sep); root["kids"].insert(i + 1, right_id)
        self.disk.write(self.root, root)

    def range_query(self, lo, hi):
        """Return (results, ios). Descend to lo, then walk linked leaves to hi."""
        before = self.disk.ios
        nid, leaf = self._find_leaf(lo)
        out = []
        while nid is not None:
            for k in leaf["keys"]:
                if k > hi:
                    return out, self.disk.ios - before
                if k >= lo:
                    out.append(k)
            nid = leaf["next"]
            if nid is not None:
                leaf = self.disk.read(nid)            # one I/O per leaf block scanned
        return out, self.disk.ios - before

if __name__ == "__main__":
    random.seed(3)
    N, B = 50000, 32
    disk = Disk()                                     # from Task 1
    t = BPlusTree(B, disk)
    keys = list(range(N)); random.shuffle(keys)
    for k in keys:
        t.insert(k)
    leaf_fill = B // 2                                # ~ keys per leaf block
    print(f"N={N} B={B}  (leaves ~{leaf_fill} keys each)")
    print(f"{'K (results)':>12} {'range I/Os':>11} {'log_B N + K/B':>15}")
    for K in (10, 100, 1000, 10000):
        lo = random.randint(0, N - K - 1)
        res, ios = t.range_query(lo, lo + K - 1)
        descent = math.ceil(math.log(N, B))
        bound = descent + math.ceil(len(res) / leaf_fill) + 2
        print(f"{len(res):>12} {ios:>11} {bound:>15}")
        assert ios <= 3 * bound, "range I/Os = Theta(log_B N + K/B)"
    print("\nOK: range query = descend (log_B N) + scan leaf chain (K/B)")
```

- **Constraints:** Keys live only in leaves; leaves are chained via `next`. A range query descends once to the leaf holding `lo`, then follows the chain. Count one I/O per node on the descent **and** one I/O per leaf block scanned during the walk. The result must contain exactly the keys in `[lo, hi]`.
- **Hint:** The descent is `Θ(log_B N)` (independent of `K`); the leaf walk touches `⌈K / (keys-per-leaf)⌉ ≈ K/B` blocks because each leaf holds `Θ(B)` consecutive keys and the chain is sequential. Total `Θ(log_B N + K/B)` — the additive split is the whole reason B+-trees dominate range-scan workloads (the `log` term vanishes against `K/B` for large results).
- **Acceptance test:** For each `K`, range I/Os track `⌈log_B N⌉ + ⌈K/B⌉` within a small constant; the result is exactly `[lo, hi] ∩ keys`. Linked leaves turn a range scan into a descent plus a sequential `K/B` sweep.

---

### Task 6 — Bulk loading from sorted input: `Θ(N/B)` vs `Θ((N/B)·log_B N)` for repeated inserts **[coding + analysis]**

`[medium]` Building a B+-tree by `N` repeated inserts costs `Θ((N/B)·log_B N)` I/Os — each insert pays a full descent. **Bulk loading** from *sorted* input builds the tree **bottom-up**: pack the sorted keys into full leaves in one scan, then build each parent level from the level below — total `Θ(N/B)` I/Os, no per-key descent. Implement both, count I/Os, and show the gap.

#### Python

```python
import math, random

def bulk_load_ios(N, B):
    """Build a B+-tree bottom-up from sorted input. Returns (height, ios).
    Leaf level: ceil(N/(B-1)) full leaves, one scan = N/(B-1) writes.
    Each parent level is ~1/B the size of the level below."""
    ios = 0
    fill = B - 1                                      # keys per full node
    level_blocks = math.ceil(N / fill)                # leaf blocks
    ios += math.ceil(N / fill)                        # write all leaves (one scan-out)
    height = 0
    while level_blocks > 1:                            # build parent levels bottom-up
        ios += level_blocks                            # read this level's separators
        level_blocks = math.ceil(level_blocks / B)     # pack into parents
        ios += level_blocks                            # write the parent level
        height += 1
    return height, ios

def repeated_insert_ios(N, B):
    """N point inserts, each a full descent of ~log_B N I/Os."""
    total = 0
    for n in range(1, N + 1):
        total += math.ceil(math.log(max(2, n), B)) + 1
    return total

if __name__ == "__main__":
    print(f"{'N':>9} {'B':>5} {'bulk I/Os':>11} {'insert I/Os':>13} "
          f"{'speedup':>8} {'~log_B N':>9}")
    for (N, B) in [(10**5, 64), (10**6, 128), (10**7, 256)]:
        _, bulk = bulk_load_ios(N, B)
        ins = repeated_insert_ios(N, B)
        print(f"{N:>9} {B:>5} {bulk:>11} {ins:>13} {ins / bulk:>7.1f}x "
              f"{math.ceil(math.log(N, B)):>9}")
        # Bulk load = one scan-out + geometric parent levels ~ N/B * (1 + 1/B + ...) = Theta(N/B).
        assert bulk <= 3 * math.ceil(N / (B - 1)), "bulk load is Theta(N/B)"
        assert ins / bulk >= 0.5 * math.log(N, B), "speedup ~ log_B N"
    print("\nOK: bulk load Theta(N/B) beats repeated inserts Theta((N/B) log_B N) by ~log_B N")
```

- **Analysis to write:** Repeated insertion pays a fresh `Θ(log_B N)` descent for each of `N` keys: `Θ(N·log_B N)` node touches, or `Θ((N/B)·log_B N)` if you amortize sequential leaf writes. Bulk loading from sorted input avoids descents entirely: stream the keys into full leaves (`⌈N/(B−1)⌉` leaf blocks, one scan), then build level `i+1` from level `i` by taking one separator per node — each level is `1/B` the size of the one below, so the total over all levels is `N/B · (1 + 1/B + 1/B² + ⋯) = Θ(N/B)`. The `log_B N` factor disappears because you never search; you *construct*. This is why databases load indexes via `CREATE INDEX` (sort + bulk build), not by inserting row-by-row.
- **Constraints:** Bulk load must consume **sorted** input and build bottom-up: full leaves first, then each parent level packed from the level below. Repeated insert builds by `N` point inserts. Count node writes (and separator reads) for both. Bulk load must be `Θ(N/B)`; repeated insert `Θ((N/B)·log_B N)`.
- **Acceptance test:** Bulk-load I/Os `≤ 3·⌈N/(B−1)⌉` (a constant times one scan); repeated-insert I/Os are `Θ(log_B N)` times larger. The geometric sum over parent levels confirms bulk load is `Θ(N/B)`.

---

### Task 7 — Prove the height bound `h ≤ log_{⌈B/2⌉}((N+1)/2)` **[analysis]**

`[medium]` Derive the worst-case B-tree height from the **minimum-occupancy** invariant — the bound that guarantees `Θ(log_B N)` even when every node is as empty as the rules allow.

> **No code.** Use this as the grading model.

**Model derivation.**

A B-tree of fan-out `B` (minimum degree `t = ⌈B/2⌉`) obeys: the root has `≥ 2` children (unless it is a leaf), and every other node has `≥ t = ⌈B/2⌉` children. Count the **minimum** number of nodes a tree of height `h` can have, and hence the minimum number of keys — a tree storing `N` keys cannot be taller than the height at which even the sparsest tree already holds `N`.

*Minimum nodes per level.* The worst case (tallest tree) is the **least-full** legal tree:

```
level 0 (root):     1 node
level 1:            >= 2 nodes               (root has >= 2 children)
level 2:            >= 2t nodes              (each level-1 node has >= t children)
level 3:            >= 2t^2 nodes
...
level h (leaves):   >= 2 t^{h-1} nodes
```

*Minimum keys.* Every node except the root holds `≥ t − 1` keys; the leaf level alone has `≥ 2t^{h−1}` nodes each with `≥ t − 1` keys, so

```
N >= (t - 1) * (number of non-root nodes) >= ... 
```

A cleaner accounting counts keys by levels and telescopes. The standard result (CLRS) is

```
N >= 2 t^h - 1     (minimum total keys in a height-h B-tree)
=>  t^h <= (N + 1) / 2
=>  h <= log_t ((N + 1) / 2) = log_{ceil(B/2)} ((N + 1) / 2).
```

*Conclusion.* The height is `h ≤ log_{⌈B/2⌉}((N+1)/2) = Θ(log_B N)`. The minimum-occupancy rule — every non-root node at least half full — is precisely what caps the height: a node can never become so sparse that the tree grows tall. Search, insert, and delete each touch one node per level, so all are `Θ(log_B N)` I/Os.

- **Constraints:** State the occupancy invariant (root `≥ 2` children, others `≥ ⌈B/2⌉`); count the minimum nodes/keys for a height-`h` tree; invert to bound `h`. Conclude `h = Θ(log_B N)` and connect it to the search/insert/delete I/O bounds.
- **Acceptance test:** The derivation yields `h ≤ log_{⌈B/2⌉}((N+1)/2)`, identifies the half-full invariant as the cap on height, and ties it to `Θ(log_B N)` I/Os for all three operations. The base of the height logarithm is `⌈B/2⌉ = Θ(B)`.

---

### Task 8 — Top levels cached: subtract `log_B M`, measure the disk-I/O count **[coding + analysis]**

`[medium]` In practice the **top levels** of a B-tree are pinned in RAM — they are tiny and hit on every query. If memory holds `M` keys' worth of nodes, the top `≈ log_B M` levels never touch disk; only the bottom `log_B N − log_B M = log_B(N/M)` levels cause real I/O. Model a cache of the top levels and confirm the **disk** I/O count drops by `log_B M`.

#### Python

```python
import math, random

class CachedDisk(Disk):                               # extends Task 1's Disk
    """Disk where the top `cached_levels` of nodes are resident (free reads).
    Counts only disk_ios for nodes below the cache line."""
    def __init__(self, cached_node_ids):
        super().__init__()
        self.cached = set(cached_node_ids)
        self.disk_ios = 0

    def read(self, nid):
        super().read(nid)                             # still count total touches
        if nid not in self.cached:
            self.disk_ios += 1                        # only uncached nodes hit disk
        return self.nodes[nid]

def top_level_node_ids(tree, levels):
    """BFS the top `levels` of the tree; those node ids are 'cached'."""
    ids, frontier, depth = set(), [tree.root], 0
    while frontier and depth < levels:
        ids.update(frontier)
        nxt = []
        for nid in frontier:
            node = tree.disk.nodes[nid]
            if not node["leaf"]:
                nxt.extend(node["kids"])
        frontier, depth = nxt, depth + 1
    return ids

if __name__ == "__main__":
    random.seed(4)
    N, B = 200000, 16
    disk = Disk()
    t = BTree(B, disk)                                # from Task 1
    keys = list(range(N)); random.shuffle(keys)
    for k in keys:
        t.insert(k)
    h = t.height()
    print(f"N={N} B={B}  height={h}")
    print(f"{'cached levels':>14} {'avg total I/Os':>15} {'avg disk I/Os':>14} "
          f"{'h - cached + 1':>15}")
    for cached_levels in (0, 1, 2, 3):
        cached_ids = top_level_node_ids(t, cached_levels)
        cdisk = CachedDisk(cached_ids)
        cdisk.nodes = disk.nodes                       # share the same node store
        ct = BTree(B, cdisk); ct.root = t.root         # reuse the built tree
        total, diskc = [], []
        for k in random.sample(range(N), 300):
            cdisk.ios = cdisk.disk_ios = 0
            ct.search(k)
            total.append(cdisk.ios); diskc.append(cdisk.disk_ios)
        avg_total = sum(total) / len(total)
        avg_disk = sum(diskc) / len(diskc)
        print(f"{cached_levels:>14} {avg_total:>15.1f} {avg_disk:>14.1f} "
              f"{h - cached_levels + 1:>15}")
        assert avg_disk <= (h - cached_levels) + 1.01, "disk I/Os = log_B N - cached levels"
    print("\nOK: caching the top log_B M levels cuts disk I/Os by log_B M")
```

- **Analysis to write:** Total search cost is `log_B N + 1` node touches, but a node resident in memory costs *zero disk I/O*. If RAM holds `M` keys, it holds `≈ log_B M` levels of nodes (the top of the tree is geometrically small: the root is `1` node, level `1` is `B` nodes, etc., so the top `log_B M` levels fit in `Θ(M)` space). Those levels hit on every query, so the **disk** I/O count is `log_B N − log_B M = log_B(N/M)`. For `N = 10⁹`, `B = 1000`, the tree is `3` levels; caching the top `2` leaves just **one** disk seek per lookup. This is why a warm B-tree index serves point queries at near-memory speed — the disk only sees the leaf level.
- **Constraints:** Mark the top `c` levels as cached (free reads); count only uncached node touches as disk I/O. Sweep `c` from `0` upward and show disk I/Os fall as `h − c`. Relate `c` to `log_B M`.
- **Acceptance test:** Disk I/Os per search equal `h − c + 1 = log_B(N/M)` (within rounding) for each cache depth `c`; total touches stay at `h + 1`. Caching the top `log_B M` levels subtracts exactly `log_B M` from the disk-I/O count — the warm-index effect.

---

## Advanced Tasks

### Task 9 — Buffered (`B^ε`-tree) inserts: batch flushes drop insert I/Os below `log_B N` **[coding + analysis]**

`[hard]` A plain B-tree pays `Θ(log_B N)` I/Os **per** insert. A **buffer tree / `B^ε`-tree** attaches a buffer of pending inserts to each internal node; an insert just appends to the **root** buffer, and buffers are **flushed down in batches** only when full. Because a flush moves `Θ(B)` keys one level for the price of `Θ(1)` node I/Os, the descent cost is amortized over many keys — driving the amortized insert toward `Θ((1/B)·log_{M/B} N)`, far below `log_B N`. Implement a simplified buffer tree, count I/Os, and show inserts beat the plain B-tree while range queries stay efficient.

#### Python

```python
import math, random

class BufferTree:
    """Simplified B^epsilon / buffer tree: internal nodes carry a buffer of pending
    inserts; a buffer flushes (one node I/O batch) when it reaches `flush` keys."""
    def __init__(self, B, eps, disk):
        self.B = B
        self.disk = disk
        self.pivots = max(2, int(B ** eps))           # B^eps fan-out
        self.flush = max(1, B - self.pivots)          # buffer slots = B - B^eps
        # node: {"leaf", "keys", "kids", "buf"(internal only)}
        self.root = disk.alloc({"leaf": True, "keys": []})

    def insert(self, key):
        root = self.disk.read(self.root)
        if root["leaf"]:
            self._leaf_insert(self.root, root, key)
            return
        root.setdefault("buf", []).append(key)        # cheap: append to root buffer
        self.disk.write(self.root, root)
        if len(root["buf"]) >= self.flush:
            self._flush(self.root, root)

    def _leaf_insert(self, nid, leaf, key):
        i = 0
        while i < len(leaf["keys"]) and key > leaf["keys"][i]:
            i += 1
        if i < len(leaf["keys"]) and leaf["keys"][i] == key:
            return
        leaf["keys"].insert(i, key)
        self.disk.write(nid, leaf)
        if len(leaf["keys"]) >= self.B:               # split leaf -> grow to internal root
            mid = len(leaf["keys"]) // 2
            sep = leaf["keys"][mid]
            right = {"leaf": True, "keys": leaf["keys"][mid:]}
            leaf["keys"] = leaf["keys"][:mid]
            self.disk.write(nid, leaf)
            rid = self.disk.alloc(right)
            self.root = self.disk.alloc(
                {"leaf": False, "keys": [sep], "kids": [nid, rid], "buf": []})

    def _flush(self, nid, node):
        """Move buffered keys down one level in a single batch (amortizes descent)."""
        buf = node.pop("buf", [])
        node["buf"] = []
        # Route each buffered key to the appropriate child by separators.
        buckets = [[] for _ in range(len(node["kids"]))]
        for key in buf:
            i = 0
            while i < len(node["keys"]) and key >= node["keys"][i]:
                i += 1
            buckets[i].append(key)
        self.disk.write(nid, node)
        for i, batch in enumerate(buckets):
            if not batch:
                continue
            cid = node["kids"][i]
            child = self.disk.read(cid)
            if child["leaf"]:
                for key in batch:
                    self._leaf_insert(cid, self.disk.read(cid), key)
            else:
                child.setdefault("buf", []).extend(batch)
                self.disk.write(cid, child)
                if len(child["buf"]) >= self.flush:
                    self._flush(cid, child)

    def flush_all(self):
        """Force all buffers to the leaves (so queries see every inserted key)."""
        changed = True
        while changed:
            changed = False
            for nid in list(self.disk.nodes):
                node = self.disk.nodes[nid]
                if not node.get("leaf") and node.get("buf"):
                    self._flush(nid, node); changed = True

if __name__ == "__main__":
    random.seed(5)
    N, B = 50000, 64
    # Plain B-tree insert cost (Task 1).
    disk_b = Disk(); plain = BTree(B, disk_b)
    keys = list(range(N)); random.shuffle(keys)
    for k in keys:
        plain.insert(k)
    plain_per_insert = disk_b.ios / N

    # Buffer tree with eps = 0.5.
    disk_t = Disk(); bt = BufferTree(B, 0.5, disk_t)
    for k in keys:
        bt.insert(k)
    buffered_per_insert = disk_t.ios / N

    print(f"N={N} B={B}")
    print(f"  plain B-tree   : {plain_per_insert:6.2f} I/Os per insert (~log_B N = "
          f"{math.log(N, B):.1f})")
    print(f"  buffer tree e=.5: {buffered_per_insert:6.2f} I/Os per insert "
          f"(amortized, << log_B N)")
    print(f"  insert speedup : {plain_per_insert / buffered_per_insert:.1f}x")
    assert buffered_per_insert < plain_per_insert, "buffering cuts insert I/Os below log_B N"
    print("OK: B^eps buffering amortizes the descent -> cheaper inserts")
```

- **Analysis to write:** A plain insert pays the full `Θ(log_B N)` descent for **one** key. In a `B^ε`-tree, a node has fan-out `B^ε` and a buffer of `B − B^ε ≈ B` pending keys. An insert costs `O(1)` (append to the root buffer). A flush reads a node, partitions its `≈ B` buffered keys among `B^ε` children, and writes them down one level — `O(B^ε)` I/Os to move `≈ B` keys, i.e. `O(B^ε / B) = O(B^{ε−1})` I/Os *per key per level*. The tree has `log_{B^ε} N = (1/ε)·log_B N` levels, so the amortized insert is `O((B^{ε−1}/ε)·log_B N)`. With `ε = 1/2` this is `O((1/√B)·log_B N)` — a `√B` improvement; as `ε → 0` it approaches the optimal write-optimized `O((1/B)·log_{M/B} N)`. The catch is the **query** cost rises to `O((1/ε)·log_B N)` because the tree is taller (smaller fan-out) and a search must check buffers along the path. This is the **insert/query tradeoff** the next task quantifies.
- **Constraints:** An insert appends to the root buffer (`O(1)`); a node flushes only when its buffer is full, partitioning keys among children in one batch. Force `flush_all` before querying so all keys reach the leaves. Measure I/Os per insert against the plain B-tree's `log_B N`.
- **Acceptance test:** Buffered inserts cost strictly fewer I/Os per insert than the plain B-tree's `log_B N`, and after `flush_all` every inserted key is present. Batched flushing amortizes the descent — the write-optimization that defines `B^ε`-trees.

---

### Task 10 — B-tree vs LSM: a write-amplification comparison harness **[coding + analysis]**

`[hard]` On a write-heavy trace, a **B-tree** rewrites a whole leaf block (`Θ(B)` bytes) for every single-key update — **write amplification** `Θ(B)` per key — while an **LSM-tree** appends to an in-memory buffer and writes sorted runs sequentially, then compacts in batches, with amplification `Θ((1/ε)·log N)`-ish but **sequential** (and far less per-key data moved). Build a harness that replays a write trace through models of both and compares total bytes written (write amplification).

#### Python

```python
import math, random

def btree_write_amplification(num_writes, B, leaf_bytes):
    """Each update rewrites one leaf block of `leaf_bytes`; user data per write ~ key+val.
    WA = bytes physically written / bytes of user data."""
    user_bytes_per_write = 16                          # ~ a (key, value) pair
    physical = num_writes * leaf_bytes                 # rewrite a full leaf block each time
    user = num_writes * user_bytes_per_write
    return physical / user

def lsm_write_amplification(num_writes, levels, size_ratio):
    """LSM: a key is written once to L0, then rewritten once per compaction as it
    migrates through `levels` levels (each ~size_ratio bigger). WA ~ levels (per byte),
    all SEQUENTIAL writes (no per-key random block rewrite)."""
    # Each level rewrites every key ~once during compaction; total rewrites ~ levels.
    return float(levels)                               # amplification ~ number of levels

if __name__ == "__main__":
    random.seed(6)
    num_writes = 10**7
    B, leaf_bytes = 256, 4096                          # 4 KB leaf page
    print(f"write trace: {num_writes:,} single-key updates")
    print(f"{'structure':>12} {'write amp':>10} {'pattern':>12} {'note':>28}")
    bt_wa = btree_write_amplification(num_writes, B, leaf_bytes)
    print(f"{'B-tree':>12} {bt_wa:>9.0f}x {'RANDOM':>12} "
          f"{'rewrite full 4KB leaf/key':>28}")
    for (levels, ratio) in [(4, 10), (6, 10), (7, 10)]:
        lsm_wa = lsm_write_amplification(num_writes, levels, ratio)
        print(f"{'LSM (L=' + str(levels) + ')':>12} {lsm_wa:>9.0f}x {'SEQUENTIAL':>12} "
              f"{'append + batched compaction':>28}")
    print("\nLSM moves far less data per key AND writes sequentially;")
    print("B-tree pays a full random leaf rewrite per update -> WA ~ leaf_bytes / pair_bytes.")
    # The B-tree's WA is ~ (leaf page size / user record size); LSM's is ~ number of levels.
    assert bt_wa > lsm_write_amplification(num_writes, 7, 10), \
        "B-tree per-key write amplification exceeds LSM's on write-heavy traces"
```

- **Analysis to write:** A B-tree update is *in-place*: to change one key it reads, modifies, and writes back the entire leaf page. If the page is `4 KB` and the record `16 B`, it physically writes `256×` the user data — write amplification `Θ(page/record)` — and the write is **random** (a seek to that leaf). An LSM-tree never updates in place: writes go to an in-memory memtable, are flushed as a **sorted run** (sequential), and a key is rewritten only when **compaction** merges runs down a level. With `L` levels each `T×` bigger, a key is rewritten `≈ L` times total, so byte amplification is `Θ(L) = Θ(log_T N)` — but every write is **sequential**, and on devices where sequential is `100×` cheaper than random (HDD) or where erase-blocks make random writes costly (SSD), the LSM wins decisively on write-heavy workloads. The flip side is **read amplification**: a point query may probe every level's run (mitigated by Bloom filters), so LSMs trade read cost for write cost — the same insert/query tension as `B^ε`-trees, of which the LSM is the `ε → 0` extreme.
- **Constraints:** Model B-tree write amplification as `leaf_page_bytes / user_record_bytes` per update (a full leaf rewrite, random); model LSM amplification as `≈ number of levels` (sequential, batched). Replay a large write count through both and compare total bytes written and access pattern.
- **Acceptance test:** The harness reports B-tree write amplification `≈ page/record` (random) versus LSM `≈ levels` (sequential), and the B-tree's per-key amplification exceeds the LSM's on the write-heavy trace. The comparison names *both* the byte-amplification gap and the random-vs-sequential pattern difference.

---

### Task 11 — The `B^ε` insert/query tradeoff and the RUM conjecture **[analysis]**

`[hard]` Sweep the parameter `ε` from `0` to `1` and characterize how it slides between a write-optimized structure and a read-optimized B-tree — then place B-tree, `B^ε`-tree, and LSM on the **RUM** (Read–Update–Memory) tradeoff space.

> **No code.** Use this as the grading model.

**Model derivation.**

A `B^ε`-tree has node fan-out `B^ε` and a per-node buffer of `≈ B − B^ε ≈ B` pending updates. Two quantities depend on `ε`:

```
Tree height        h(eps) = log_{B^eps} N = (1/eps) * log_B N.
Query I/Os         Q(eps) = O(h) = O((1/eps) * log_B N).
                   (a search visits one node + its buffer per level)
Insert I/Os        I(eps) = O( (B^eps / B) * h )
                          = O( B^{eps-1} * (1/eps) * log_B N ).
```

*Sweep `ε`.*

```
eps = 1   (B^1 = B fan-out, no buffer): plain B-tree.
          Q = O(log_B N),   I = O(log_B N).        balanced.
eps = 1/2 (B^{1/2} fan-out):
          Q = O(2 log_B N), I = O((1/sqrt B) log_B N).   ~sqrt(B) cheaper inserts.
eps -> 0  (tiny fan-out, huge buffers): LSM-like.
          Q = O((1/eps) log_B N) -> larger,
          I -> O((1/B) log_{M/B} N), the optimal write-optimized insert.
```

*The tradeoff.* Inserts get cheaper as `ε → 0` (more buffering, fewer descents per key); queries get more expensive (taller tree, more buffers to inspect). The product `Q · I ≈ (log_B N / B)·log_B N` is roughly invariant — you cannot make both cheap at once. This is a fundamental **insert/query tradeoff** curve, parameterized by `ε`.

*The RUM conjecture.* The **RUM** tradeoff says any access method must balance three amplifications: **Read** (extra I/O per query), **Update** (extra I/O per write), and **Memory** (extra space, e.g. Bloom filters, fractional cascading, fence pointers). Optimizing any two worsens the third:

```
B-tree:   low Read, high Update (write amp ~ B),  low Memory.
B^eps:    tunable Read<->Update via eps,           low Memory.
LSM:      low Update (sequential, batched),        higher Read (many runs)
          -> bought back down with Memory (Bloom filters, fence pointers).
```

No structure is a free lunch on all three axes: the LSM buys low update cost with read and memory cost; the B-tree buys low read cost with high update (write-amplification) cost; the `B^ε`-tree exposes the dial. Choosing among them is choosing where on the RUM surface your workload should sit.

- **Constraints:** Derive `Q(ε) = O((1/ε)·log_B N)` and `I(ε) = O(B^{ε−1}·(1/ε)·log_B N)`; evaluate at `ε = 1`, `ε = 1/2`, `ε → 0`; show queries and inserts move in opposite directions. State the RUM conjecture and place B-tree, `B^ε`-tree, and LSM on its Read/Update/Memory axes.
- **Acceptance test:** The sweep shows `ε = 1` as the balanced B-tree, `ε → 0` as the write-optimized (LSM-like) extreme with cheaper inserts and costlier queries, and the `Q·I` product roughly invariant. The RUM placement correctly assigns each structure's strong and weak axes — read-optimized B-tree, write-optimized LSM, tunable `B^ε`-tree.

---

### Task 12 — Monotonic-insert hotspot: demonstrate it and fix it **[coding + analysis]**

`[hard]` Inserting keys in **monotonically increasing** order (timestamps, auto-increment IDs) hammers the **rightmost** leaf: every insert lands in the same leaf, splitting it repeatedly, and (in some implementations) leaves the left siblings half-empty — a **write hotspot** and poor space utilization. Demonstrate the skewed split behavior, then apply a fix (right-biased splitting / append-optimized loading) and measure the improvement.

#### Python

```python
import math, random

def measure_rightmost_pressure(keys, B):
    """Insert `keys` and count how many splits happen on the rightmost path
    vs elsewhere; also report leaf fill factor."""
    disk = Disk(); t = BTree(B, disk)                  # from Task 1
    for k in keys:
        t.insert(k)
    # Walk leaves left-to-right; report fill factor (keys / (B-1) per leaf).
    fills = []
    def collect(nid):
        node = disk.nodes[nid]
        if node["leaf"]:
            fills.append(len(node["keys"]) / (B - 1))
        else:
            for c in node["kids"]:
                collect(c)
    collect(t.root)
    avg_fill = sum(fills) / len(fills)
    return disk.ios, avg_fill, len(fills)

def append_optimized_load(keys_sorted, B):
    """Fix: keys arrive sorted -> bulk-pack full leaves left-to-right (Task 6 style).
    No rightmost-leaf thrashing; leaves are ~100% full."""
    fill = B - 1
    leaf_blocks = math.ceil(len(keys_sorted) / fill)
    ios = leaf_blocks                                  # one sequential scan-out of full leaves
    level = leaf_blocks
    while level > 1:
        ios += level
        level = math.ceil(level / B)
        ios += level
    avg_fill = (len(keys_sorted) / fill) / leaf_blocks  # ~1.0 (packed full)
    return ios, avg_fill

if __name__ == "__main__":
    random.seed(7)
    N, B = 20000, 32
    monotonic = list(range(N))                         # worst case: strictly increasing
    rnd = list(range(N)); random.shuffle(rnd)

    ios_mono, fill_mono, leaves_mono = measure_rightmost_pressure(monotonic, B)
    ios_rnd, fill_rnd, leaves_rnd = measure_rightmost_pressure(rnd, B)
    ios_fix, fill_fix = append_optimized_load(monotonic, B)

    print(f"N={N} B={B}")
    print(f"  monotonic inserts : I/Os={ios_mono:7d}  leaf fill={fill_mono:.0%}  "
          f"leaves={leaves_mono}")
    print(f"  random inserts    : I/Os={ios_rnd:7d}  leaf fill={fill_rnd:.0%}  "
          f"leaves={leaves_rnd}")
    print(f"  append-optimized  : I/Os={ios_fix:7d}  leaf fill={fill_fix:.0%}  (FIX)")
    print(f"\n  fix speedup vs monotonic inserts: {ios_mono / ios_fix:.1f}x, "
          f"fill {fill_mono:.0%} -> {fill_fix:.0%}")
    assert ios_fix < ios_mono, "append-optimized load avoids rightmost-leaf thrashing"
    assert fill_fix > fill_mono, "right-biased packing yields fuller leaves"
    print("OK: monotonic hotspot fixed by right-biased / append-optimized loading")
```

- **Analysis to write:** With a **midpoint** split, monotonic insertion is doubly wasteful. First, every insert targets the single rightmost leaf — a **write hotspot** that serializes all insert traffic onto one block (and one lock/page in a real DBMS). Second, when that leaf splits at the midpoint, the **left half** never receives another key (all future keys are larger), so it stays permanently `≈ 50%` full: space utilization collapses to `~50%`, doubling the tree size and the I/Os to scan it. The standard fix is a **right-biased split**: when the rightmost leaf overflows under monotonically increasing inserts, split off a *near-empty* right leaf (or none — just start a fresh full leaf), leaving the left leaf `≈ 100%` full. Equivalently, when keys are known to arrive sorted, **bulk-load / append-optimized** them into full leaves left-to-right (Task 6), giving `≈ 100%` fill and `Θ(N/B)` total I/Os with no thrashing. Real systems detect the append pattern (Postgres "fastpath" leaf cache, InnoDB's increasing-key heuristic) and bias splits accordingly. The lesson: the `Θ(log_B N)` insert bound assumes *random* keys; a sorted insert stream needs append-aware handling to keep both occupancy and throughput high.
- **Constraints:** Insert keys in strictly increasing order and measure (a) total I/Os and (b) average leaf fill factor; compare against random-order inserts. Then apply an append-optimized / right-biased load and show fuller leaves and fewer I/Os. The fix must achieve `≈ 100%` leaf fill.
- **Acceptance test:** Monotonic midpoint inserts show `≈ 50%` leaf fill and concentrate splits on the rightmost path; the append-optimized fix yields `≈ 100%` fill and fewer I/Os than the monotonic-insert build. The hotspot is real and the right-biased fix removes it.

---

## Synthesis Task

> Tie the bounds together: build the B-tree / B+-tree on simulated disk, drive every operation through the per-node I/O counter, count I/Os, and confirm each measured count matches its derived bound — `log_B N` search/insert, `log_B N + K/B` range, `N/B` bulk load, sub-`log_B N` buffered insert — then place B-tree, `B^ε`-tree, and LSM on the read/write tradeoff map.

`[capstone]` Carry the **B-tree** end to end: point search and insert (`log_B N`), B+-tree range over linked leaves (`log_B N + K/B`), bottom-up bulk load (`N/B`), buffered `B^ε` inserts (sub-`log_B N`), and the B-tree-vs-LSM write-amplification comparison — each measured against its bound.

1. **Tree + search [coding].** Build the `Disk` + `BTree` scaffold with a per-node I/O counter (Task 1); confirm a search costs `height + 1 = Θ(log_B N)` I/Os, and beats a BST by `log₂ B` (Task 2); hand-verify `N = 10⁹` reaches a leaf in `3–6` I/Os (Task 3).

2. **Insert [coding].** Show an insert touches `Θ(log_B N)` nodes — search down plus `O(1)` splits per level (Task 4); prove the height bound `h ≤ log_{⌈B/2⌉}((N+1)/2)` (Task 7).

3. **Range + bulk load [coding + analysis].** Implement a B+-tree with linked leaves and a range query costing `Θ(log_B N + K/B)` (Task 5); bulk-load from sorted input at `Θ(N/B)` versus `Θ((N/B)·log_B N)` for repeated inserts (Task 6); subtract `log_B M` for cached top levels (Task 8).

4. **Write optimization [coding + analysis].** Buffer inserts in a `B^ε`-tree to drop insert I/Os below `log_B N` (Task 9); build the B-tree-vs-LSM write-amplification harness (Task 10); characterize the `ε`-sweep insert/query tradeoff and place all three on the RUM map (Task 11).

5. **Hotspot [coding + analysis].** Demonstrate the monotonic-insert rightmost-leaf hotspot and fix it with append-optimized loading (Task 12).

Reference harness in **Python** (combines the closed forms):

```python
import math

def report(N, B, M=None, K=None, eps=1.0):
    h = math.ceil(math.log(N, B)) if N > 1 else 0
    search = h + 1
    insert = h + 1
    cached_levels = math.ceil(math.log(M, B)) if M else 0
    disk_search = max(1, search - cached_levels)            # top levels cached
    rng = (h + math.ceil(K / B)) if K else None             # log_B N + K/B
    bulk = math.ceil(N / (B - 1))                            # Theta(N/B), bottom-up
    buffered_insert = (B ** (eps - 1)) * (1 / max(eps, 1e-9)) * math.log(N, B)
    return search, insert, disk_search, rng, bulk, buffered_insert

if __name__ == "__main__":
    print(f"{'N':>12} {'B':>6} {'search':>7} {'disk(cached)':>12} "
          f"{'range(K=10^4)':>13} {'bulk N/B':>10} {'buf-ins(e=.5)':>14}")
    for (N, B, M) in [(10**6, 100, 10**4), (10**9, 1000, 10**6),
                      (10**12, 1000, 10**7), (10**15, 4096, 10**9)]:
        s, i, ds, rng, bulk, bi = report(N, B, M=M, K=10**4, eps=0.5)
        print(f"{N:>12} {B:>6} {s:>7} {ds:>12} {rng:>13} {bulk:>10} {bi:>14.2f}")
        assert s <= math.ceil(math.log2(N))             # log_B N <= log2 N
        assert ds <= s                                  # caching only helps
        assert bi < s                                   # buffered insert < log_B N
        assert bulk <= 2 * math.ceil(N / B)             # bulk load is Theta(N/B)
    print("\nsearch/insert Theta(log_B N); range Theta(log_B N + K/B); "
          "bulk load Theta(N/B); B^eps buffering << log_B N inserts")
```

- **Analysis answer:** A B-tree of fan-out `B` has height `h ≤ log_{⌈B/2⌉}((N+1)/2) = Θ(log_B N)`; point search and insert each touch one node per level, `Θ(log_B N)` I/Os — a factor `log₂ B` fewer than a BST. A B+-tree chains its leaves, so a range of `K` results costs `Θ(log_B N + K/B)`: descend once, then sweep `K/B` leaf blocks. Bulk loading sorted input bottom-up is `Θ(N/B)` — one scan, no per-key descent — versus `Θ((N/B)·log_B N)` for repeated inserts. Caching the top `log_B M` levels cuts the *disk* I/Os to `log_B(N/M)`. Write optimization buffers inserts: a `B^ε`-tree amortizes the descent over `Θ(B^{1−ε})` keys, dropping the amortized insert toward `Θ((1/B)·log_{M/B} N)` — at the cost of taller trees and costlier queries (the insert/query, and broader RUM, tradeoff). The B-tree rewrites a full leaf per update (write amplification `Θ(B)`, random); the LSM appends sequentially and compacts in batches (amplification `Θ(levels)`, sequential, read cost bought back with Bloom filters). And monotonic insert streams need append-aware splitting to avoid a rightmost-leaf hotspot and `~50%` occupancy.
- **Acceptance test:** Every measured count matches its bound: search and insert `= height + 1 = ⌈log_B N⌉ + 1 ≤ log₂ N`; range `= ⌈log_B N⌉ + ⌈K/B⌉`; bulk load `≤ 2⌈N/B⌉`; cached search `= log_B(N/M)`; buffered insert strictly below `log_B N` and all keys present after flushing; the LSM harness shows lower per-key write amplification than the B-tree on a write-heavy trace; the monotonic hotspot is fixed to `≈ 100%` fill. The write-up places the structures on the read/write map — **B-tree read-optimized, LSM write-optimized, `B^ε`-tree the tunable bridge** — mirroring the whole discipline: *build the tree, drive the operation, count the node transfers, derive the bound, and confirm the measured count matches.*

---

## Where to go next

- Revisit the `(M, B)` block-cache simulator, `scan(N) = Θ(N/B)`, and the general `Θ(log_B N)` search bound that this topic specializes into a full dynamic index in the [I/O-model tasks](../01-the-io-model/tasks.md).
- For node splits/merges, B+-tree leaf chaining, and the structural invariants behind the height and occupancy bounds, work the [B-tree (data-structures) tasks](../../09-trees/11-b-tree/tasks.md).
- For the conceptual treatment of the height arithmetic, the `Θ(log_B N + K/B)` range bound, bulk loading, write-optimized `B^ε` / buffer trees, and the B-tree-vs-LSM (RUM) tradeoff, read this topic's [junior](junior.md), [middle](middle.md), [senior](senior.md), and [professional](professional.md) notes.
