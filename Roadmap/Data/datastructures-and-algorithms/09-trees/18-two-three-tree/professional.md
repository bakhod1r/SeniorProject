# 2-3 Tree — Professional Level

> **Audience:** Engineers who ship the data structures they design — language-runtime authors, functional-library maintainers, and anyone choosing the backbone for an immutable ordered collection or a concurrent map. Prerequisite: `senior.md`.

`senior.md` established the central fact: in RAM you almost never deploy a literal mutable 2-3 tree, because its binary encoding (LLRB / standard red-black) delivers the identical asymptotics with a leaner node and a better-predicted hot path, and on disk its high-order generalization (the B-tree) wins. This file is about the *one regime where the literal 2-3 structure is the right production choice*: the **immutable / persistent / functional** setting. That is where bounded fan-out, balance-by-construction, and cheap structural sharing combine into something no binary tree matches — and it is where the 2-3 finger tree quietly powers Haskell's `Data.Sequence`, Scala/Clojure-style persistent sequences, ropes, and order-statistic sequences.

We cover why 2-3 is structurally ideal for persistence, the engineering of path-copying and copy-on-write, why mutable balanced trees are hostile to fine-grained locking (and what to do instead), the cache-behavior argument against the in-RAM mutable form, a production-flavored persistent core with an invariant checker and property-based test strategy, and a decision framework with research pointers.

---

## Table of Contents

1. [Why 2-3 Is Ideal for the Persistent / Functional Setting](#why-persistent)
2. [2-3 Finger Trees in Production: Data.Sequence and Friends](#finger-trees)
3. [Persistence Engineering: Path Copying, Structural Sharing, GC](#persistence-eng)
4. [Concurrency: Immutable + CAS-Root vs Lock-Free Skip Lists](#concurrency)
5. [Performance vs the Binary Encoding: Cache and Pointer-Chasing](#perf)
6. [A Persistent 2-3 Tree Core (Go) with Invariant Checker](#go-core)
7. [Testing: Property-Based and Model-Based](#testing)
8. [Decision Framework and Research Pointers](#decision)

---

<a name="why-persistent"></a>
## 1. Why 2-3 Is Ideal for the Persistent / Functional Setting

Persistence — keeping every prior version of a structure cheaply available — is the workload that inverts the RAM trade-off from `senior.md`. There, the variable-arity 2-3 node was a liability: branchy `if 2-node … else 3-node …` code on the hot path, irregular layout the CPU dislikes. Under immutability that same bounded arity becomes a decisive *asset*. Four properties line up:

1. **Bounded fan-out bounds copy cost.** A persistent update must copy every node it touches (you cannot mutate a node a previous version still points at). With arity capped at 3, each copied node is tiny — at most two keys and three child references — and the copied spine is `O(log n)` nodes. A high-order B-tree node, by contrast, holds hundreds of keys; copying one to change a single key wastes most of the page. **Small, fixed-size copies are exactly what path copying wants**, and 2-3 gives the smallest such node that is still multiway-balanced. (Wider persistent trees like Clojure's HAMT-based vectors push fan-out to 32 to amortize pointer-chasing, but they accept large copies and rely on bitmap tricks; the 2-3 finger tree gets fast *ends* and *split/concat* that a HAMT vector does not.)

2. **Balanced by construction — no rebalancing version to fork.** Every 2-3 tree is *perfectly* height-balanced (all leaves at equal depth) as an invariant of its shape, not as the result of a rotation pass. There is no "rebalance step" whose intermediate states a concurrent reader could observe, and no per-node balance metadata (height, color, rank) to copy and keep consistent. The split-on-overflow / merge-on-underflow logic restores balance *as part of* the insert/delete, so a freshly produced version is immediately and provably balanced.

3. **Structural sharing is maximal and obvious.** Because the only nodes that change are on the root-to-leaf spine, every subtree hanging off that spine is shared pointer-equal with the previous version. The bounded arity keeps the *number* of distinct subtrees small and the sharing boundary crisp.

4. **Algebraic shape matches sum types.** A 2-3 node is naturally `Two | Three`, an algebraic data type that makes "at most two keys" *unrepresentable-by-construction* (see the Haskell core in `senior.md` §10). The compiler enforces the core invariant the Go version must check at runtime. This is why purely-functional libraries reach for 2-3 rather than red-black: the red/black color bit and its "no two reds in a row" rule are an *encoding artifact* with no meaning in the multiway view, and they complicate the persistent code for zero benefit once you are already immutable.

The summary: **mutable RAM rewards the binary encoding; immutable RAM rewards the multiway 2-3 form directly.** The very property that hurts in place — carrying explicit multi-key nodes — is what makes copies cheap and balance free when you can never mutate.

---

<a name="finger-trees"></a>
## 2. 2-3 Finger Trees in Production: Data.Sequence and Friends

The single most consequential shipping use of the 2-3 structure is **Hinze & Paterson's 2-3 finger tree** (2006), introduced in `senior.md` §7 and developed here as the production object it actually is.

### The shape

A finger tree is a 2-3 tree *turned on its side* and cached at both ends. Structurally:

```
FingerTree a = Empty
             | Single a
             | Deep (Digit a) (FingerTree (Node a)) (Digit a)
```

- The two `Digit`s are the **fingers** — buffers of 1–4 elements at the left and right ends, giving immediate access to both ends.
- The middle is a finger tree *one level deeper*, whose elements are `Node`s — a **2-node or 3-node** of the level above. This is where the 2-3 structure lives: the spine is a sequence of 2-3 groupings, and the deepening recursion is what keeps the whole thing balanced by construction.

### The complexities, and why 2-3 delivers them

| Operation | Cost | Mechanism |
|---|---|---|
| `cons` / `snoc` (push either end) | **amortized O(1)** | mutate a digit; only when a digit overflows (size 5) does a 2-3 `Node` get pushed one level down |
| `head` / `last` / `viewL` / `viewR` (pop either end) | **amortized O(1)** | read/shrink a digit; underflow borrows from the next level |
| `><` (concat) | **O(log min(n, m))** | merge the two spines, forming 2-3 nodes from the leftover digits |
| `splitAt` / `split` by a predicate | **O(log n)** | descend the spine, splitting digits and reassembling |
| indexing / `lookup` | **O(log n)** | with a *size* annotation (next paragraph) |

The amortized O(1) ends come straight from the banker's method: each `Deep` constructor can "afford" a constant amount of deferred work because a digit must fill from 1 to 4 before it forces a single 2-3 node down a level, and that push deposits exactly the credit the analysis needs. **The 2-3 grouping is what makes the digit-overflow accounting balance** — a different arity breaks the constant.

### One skeleton, many structures: the monoid annotation

The reason finger trees matter beyond `Data.Sequence` is that the spine is **generic over a measure**: annotate each element with a value from a monoid, cache the monoidal sum at every node, and `split` on a predicate over running sums. Choosing the monoid reskins the structure:

- **measure = size (`Sum Int`)** → a random-access **sequence** (`Data.Sequence.Seq`): `index`, `splitAt`, `insertAt` all O(log n).
- **measure = max priority** → a **priority queue** with O(log n) `deleteMax`.
- **measure = interval-max** → an **interval map** / ordered set.
- **measure = (size, …)** on character chunks → a **rope** for editor text buffers with O(log n) split/concat — the canonical "big editable string" structure.
- **measure = key-max** → an ordered **`Map`/`Set`** with split/merge.

This generality is why Haskell ships *one* `Data.FingerTree` and builds `Data.Sequence` on top, and why the structure shows up in Scala (`finger-tree` libraries), Clojure-adjacent code, Idris, and rope implementations. It is the 2-3 tree's most important real appearance — **not as a search tree, but as the measured spine of an immutable sequence.**

### Where it also conceptually appears

Even outside finger trees, the 2-3 idea is the *conceptual basis* of the balanced trees in standard libraries: red-black trees (`std::map`, `TreeMap`, the Linux kernel) and AA trees are binary encodings of 2-3 / 2-3-4 trees (`senior.md` §1, [`../04-red-black/professional.md`](../04-red-black/professional.md)). So the structure's footprint in production is enormous — but split: the *binary projection* runs the mutable in-RAM maps, and the *literal multiway form* runs the immutable sequences.

---

<a name="persistence-eng"></a>
## 3. Persistence Engineering: Path Copying, Structural Sharing, GC

### Path copying, concretely

To insert into an immutable 2-3 tree you return a *new root*. The new root plus the freshly built nodes along the root-to-leaf spine are allocated; every subtree off the spine is shared with the prior version by pointer. Cost: **O(log n) new nodes per update, O(log n) time, O(1) versions retained for free.** A read on any version is identical to a non-persistent read — O(log n) pointer chases — because the shared subtrees are ordinary nodes.

The functional `insert` in `senior.md` §10 *is* a path-copying implementation: each `Two`/`Three` constructor on the way back up the recursion allocates a new node holding the rebuilt child and sharing its siblings. No special machinery; immutability plus a structural recursion gives persistence automatically.

### Structural-sharing cost model

For `N` updates against an initially-empty tree you allocate `Θ(N · log n)` nodes total. Two consequences:

- **Memory.** Old versions you still reference keep their unique spines alive. If you keep *all* versions (e.g., an undo history), live memory grows `Θ(N · log n)`. If you keep only the latest (the common case — you discard the old root after the atomic swap), the old spines become garbage immediately and live memory stays `Θ(n)`.
- **GC behavior.** The churn is many small, short-lived nodes — exactly what a generational / nursery collector is built for. In Haskell's GHC, the spine nodes die in the young generation and never reach the old generation, so collection is cheap; this is *why* path copying is idiomatic there. In a non-GC language you pay per-node reference counting: an `Arc`/`shared_ptr` per node and an atomic increment on every shared subtree captured into the new version, plus atomic decrements as old versions drop. That refcount traffic, not the allocation, is usually the dominant cost in Rust/C++ persistent trees. Choose `Rc` (non-atomic) if the structure never crosses threads, `Arc` only if it does.

### Copy-on-write and the atomic root swap

Path copying *is* copy-on-write at node granularity: you never write a node a previous version can see; you write a fresh copy and rebuild the spine above it. The published version is named by a single pointer — **the root**. Swapping that pointer atomically (a single `compare-and-swap` on a machine word) makes the new version visible to all readers in one indivisible step. This is the linchpin of the concurrency story in §4: a writer can build an entire new version off to the side touching no node any reader holds, then make it live with one CAS. Readers that captured the old root keep traversing a fully consistent, immutable snapshot until they are done — no locks, no torn reads, no coordination.

---

<a name="concurrency"></a>
## 4. Concurrency: Immutable + CAS-Root vs Lock-Free Skip Lists

### Why mutable balanced trees resist fine-grained locking

A mutable 2-3 tree (or any rebalancing BST) is genuinely hostile to fine-grained locking, for a structural reason: **an insert or delete can cascade splits or merges from the leaf all the way to the root, and the set of nodes that will be modified is not known until the cascade resolves.** To lock correctly you would have to either:

- grab a tree-wide latch (kills write concurrency — serial writers), or
- latch-couple down the descent and *retain* latches on every node that might still split/merge as you go (a node is "safe" to release only once you know it will not be touched by a cascade from below) — complex, and on the write path it still pins a long chain of nodes.

The disk world solved a version of this for B-trees with **Lehman–Yao right-links and latch-coupling** ([`../11-b-tree/professional.md`](../11-b-tree/professional.md)), letting searches descend without locking. But porting that to an in-RAM 2-3 tree buys little, because in RAM you would not pick a 2-3 tree to begin with, and the multi-pointer atomicity problem (a split rewrites several parent/child pointers that a single CAS cannot update together) remains — the same wall that keeps lock-free *red-black* trees out of standard libraries (Howley & Jones 2012; see [`../04-red-black/professional.md`](../04-red-black/professional.md)).

### The immutable + CAS-root answer

Immutability dissolves the problem instead of solving it:

- **Readers are wait-free.** Each reader captures the current root (one atomic load) and traverses an immutable snapshot. No node it can see will ever change. No locks, no retries, no memory fences beyond the acquire on the root load.
- **A writer builds a new version privately** via path copying (touching no live node), then publishes it with **one `CAS(&root, oldRoot, newRoot)`**. If the CAS fails (another writer won), it rebases its update onto the new root and retries — standard optimistic concurrency.
- **Reclamation** of superseded versions is the only subtlety: you must not free an old spine while a reader might still be inside it. A GC handles this automatically; without one you use epoch-based reclamation or hazard pointers (`crossbeam-epoch` in Rust, RCU-style grace periods in C).

This is the **copy-on-write / persistent-data-structure** pattern that LMDB and bbolt use for *on-disk* B-trees (single-writer, atomic root swap, lock-free readers — [`../11-b-tree/professional.md`](../11-b-tree/professional.md)) and that functional runtimes use for *in-memory* maps. It trades write throughput (writers serialize on the root CAS; a hot single-writer model is typical) for trivially correct, contention-free reads.

### Comparison to lock-free skip lists

For a **mutable, highly-concurrent ordered map with many concurrent writers**, the field has standardized not on any tree but on the **lock-free skip list** (`ConcurrentSkipListMap` in Java, `crossbeam-skiplist` in Rust, the in-memory store in many LSM MemTables). The reason is the mirror image of the tree problem: a skip-list insert touches only the new node and its forward pointers, **one CAS per level, no restructuring, no rotation, no cascade** — so fine-grained lock-freedom is achievable and practical.

The decision, then, is sharp:

| Workload | Choice | Why |
|---|---|---|
| Read-mostly, snapshot semantics, occasional writes | **Immutable 2-3 tree + CAS root** | wait-free reads, simple, gives consistent snapshots and time-travel for free |
| Many concurrent writers, no snapshot need | **Lock-free skip list** | local CAS updates, no cascade, high write concurrency |
| Single writer, mostly read, durable | **CoW B-tree** (LMDB/bbolt) | the on-disk version of the CAS-root pattern |

Immutable trees win when you *want* snapshots (MVCC, undo, time-travel debugging); skip lists win when you want raw concurrent write throughput and do not need a consistent point-in-time view.

---

<a name="perf"></a>
## 5. Performance vs the Binary Encoding: Cache and Pointer-Chasing

It is worth being quantitative about *why* the in-RAM mutable 2-3 tree loses to its red-black encoding, because the same reasoning tells you when the multiway form wins.

### Why the mutable 2-3 tree loses in RAM

A 2-3 tree and its LLRB encoding have the *same* number of levels of *black* (real) structure, but the multiway node is the wrong shape for a CPU:

- **Variable-arity nodes mean branchy, mispredicted code on the hot path.** Each node visit runs `if 2-node (1 key, 2 children) else 3-node (2 keys, 3 children)`, and the child-selection loop has a data-dependent trip count. The branch predictor cannot learn it. The binary encoding has *one* uniform node shape and a single comparison per visit — the branch predictor and the out-of-order engine eat it.
- **More comparisons per level, scattered nodes per pointer-chase.** A 2-3 node does up to 2 key comparisons to pick a child; an LLRB node does 1 per visit. Per-level the multiway form does more work, and because nodes are individually heap-allocated and scattered, *every* node visit is a potential cache miss either way. The multiway form's "fewer levels" advantage is real on disk (a level is a page fetch) but evaporates in RAM, where ~80–100 ns of DRAM latency dominates and the binary encoding simply chases fewer mispredicted branches per cache miss.
- **Mutation rewrites more pointers.** A 2-3 split/merge mutates several keys and child pointers across two or three nodes; an LLRB rotation/flip is a fixed small pointer dance the compiler inlines.

Net, for a *mutable in-RAM* ordered map, the LLRB / red-black encoding beats the literal 2-3 tree on both lookup and update at the same asymptotics — which is exactly why `std::map`, `TreeMap`, and the kernel ship the binary form and *no one ships the literal 2-3 tree* (`senior.md` §6).

### Where the multiway form wins, and the bridge to high order

The multiway form wins precisely when a "level" costs more than a comparison:

- **On disk/SSD**, a level is a page I/O. Then you do not pick order 3 — you pick the order that fills a page (hundreds to thousands of keys), collapsing height to 3–4 and minimizing I/O. The 2-3 tree is the order-3 special case of this idea; the **B-tree is the same idea at the order that matters** ([`../11-b-tree/professional.md`](../11-b-tree/professional.md)).
- **Cache-conscious in-RAM B-trees** (order ~16, a node sized to a few cache lines — Rust's `BTreeMap`, `absl::btree_map`) beat *both* the red-black tree and the literal 2-3 tree on large sets, by packing many keys per cache line and shrinking height to ~5 ([`../04-red-black/professional.md`](../04-red-black/professional.md) §7). The 2-3 tree is too narrow to get this packing win; it sits in the worst spot — multiway overhead without multiway payoff.
- **Immutable sequences**, where the win is not search speed at all but cheap copies + fast ends + log-time split/concat — the finger-tree regime of §2.

So the literal 2-3 tree is dominated in *every mutable* setting (by red-black in narrow-RAM, by cache-conscious B-trees in wide-RAM, by high-order B-trees on disk) and shines only in the *immutable* one. That is the honest performance verdict, and it is why this file spends its energy on persistence.

---

<a name="go-core"></a>
## 6. A Persistent 2-3 Tree Core (Go) with Invariant Checker

`senior.md` §9 gave a *mutable* Go 2-3 tree (the teaching form) and §10 a *persistent* Haskell core. Here is a production-flavored **persistent (immutable)** ordered-set core in Go — the form you would actually use under the CAS-root concurrency model of §4. Nodes are never mutated after construction; `Insert` returns a new tree sharing all untouched subtrees. The same `(promoted, right)` split protocol is used, but every node on the spine is freshly allocated.

```go
package twothree

import "fmt"

// node is immutable after construction. A 2-node has 1 key / 2 kids;
// a 3-node has 2 keys / 3 kids; a leaf has 0 kids.
type node struct {
	keys     []int
	children []*node
}

func (n *node) leaf() bool { return n == nil || len(n.children) == 0 }

// Tree is a persistent ordered set. The zero value is an empty tree.
// Copy a Tree value freely; Insert returns a new Tree, sharing structure.
type Tree struct{ root *node }

// ---------- Search (identical to the mutable form: reads don't copy) ----------

func (t Tree) Contains(k int) bool {
	n := t.root
	for n != nil {
		i := 0
		for i < len(n.keys) && k > n.keys[i] {
			i++
		}
		if i < len(n.keys) && n.keys[i] == k {
			return true
		}
		if n.leaf() {
			return false
		}
		n = n.children[i]
	}
	return false
}

// ---------- Persistent Insert ----------
//
// The split protocol is the `Grown` sum type of the Haskell core
// (senior.md §10) transcribed to Go: inserting into a subtree either
// produces a rebuilt subtree that absorbed the key (stay), or a split
// (promote mid, new right). Every node on the path is rebuilt fresh;
// every off-path subtree is shared by pointer. ins* never mutates a node.

// grown is the result of inserting into a subtree: either the rebuilt
// subtree absorbed the key (stay), or it split (promote mid, new right).
type grown struct {
	stay  *node // non-nil  => absorbed; this is the rebuilt subtree
	mid   int   // valid    => split
	left  *node //          => split: rebuilt left half
	right *node //          => split: new right half
	split bool
}

func insG(n *node, k int) grown {
	i := 0
	for i < len(n.keys) && k > n.keys[i] {
		i++
	}
	if i < len(n.keys) && n.keys[i] == k {
		return grown{stay: n} // present: share the existing node unchanged
	}
	if n.leaf() {
		nk := insAt(n.keys, i, k)
		if len(nk) <= 2 {
			return grown{stay: &node{keys: nk}}
		}
		return splitFour(nk, nil)
	}
	g := insG(n.children[i], k)
	if g.split {
		nk := insAt(n.keys, i, g.mid)
		nc := replaceAndInsert(n.children, i, g.left, g.right)
		if len(nk) <= 2 {
			return grown{stay: &node{keys: nk, children: nc}}
		}
		return splitFour(nk, nc)
	}
	// child absorbed: rebuild THIS node with the one rebuilt child, share the rest
	nc := replaceChild(n.children, i, g.stay)
	return grown{stay: &node{keys: n.keys, children: nc}}
}

// splitFour decomposes an overflowed (3-key) node into left | mid | right.
func splitFour(keys []int, kids []*node) grown {
	left := &node{keys: []int{keys[0]}}
	right := &node{keys: []int{keys[2]}}
	if len(kids) == 4 {
		left.children = []*node{kids[0], kids[1]}
		right.children = []*node{kids[2], kids[3]}
	}
	return grown{split: true, mid: keys[1], left: left, right: right}
}

func (t Tree) InsertClean(k int) Tree {
	if t.root == nil {
		return Tree{root: &node{keys: []int{k}}}
	}
	g := insG(t.root, k)
	if g.split {
		return Tree{root: &node{keys: []int{g.mid}, children: []*node{g.left, g.right}}}
	}
	return Tree{root: g.stay}
}

// ---------- pure slice helpers (always allocate; never alias the input) ----------

func insAt(s []int, i, v int) []int {
	out := make([]int, len(s)+1)
	copy(out, s[:i])
	out[i] = v
	copy(out[i+1:], s[i:])
	return out
}
func replaceChild(s []*node, i int, v *node) []*node {
	out := make([]*node, len(s))
	copy(out, s)
	out[i] = v
	return out
}
func replaceAndInsert(s []*node, i int, l, r *node) []*node {
	out := make([]*node, 0, len(s)+1)
	out = append(out, s[:i]...)
	out = append(out, l, r)
	out = append(out, s[i+1:]...)
	return out
}

// ---------- Invariant checker (the heart of the test suite) ----------

// Check verifies the four defining properties: (1) key counts in {1,2};
// (2) child count == keys+1 for internal nodes; (3) keys sorted and within
// the child's key range; (4) all leaves at equal depth.
func (t Tree) Check() error {
	if t.root == nil {
		return nil
	}
	_, err := check(t.root, nil, nil)
	return err
}

func check(n *node, lo, hi *int) (depth int, err error) {
	if len(n.keys) < 1 || len(n.keys) > 2 {
		return 0, fmt.Errorf("node has %d keys (must be 1 or 2)", len(n.keys))
	}
	if len(n.keys) == 2 && n.keys[0] >= n.keys[1] {
		return 0, fmt.Errorf("keys not strictly sorted: %v", n.keys)
	}
	if lo != nil && n.keys[0] <= *lo {
		return 0, fmt.Errorf("key %d violates lower bound %d", n.keys[0], *lo)
	}
	if hi != nil && n.keys[len(n.keys)-1] >= *hi {
		return 0, fmt.Errorf("key %d violates upper bound %d", n.keys[len(n.keys)-1], *hi)
	}
	if n.leaf() {
		return 0, nil
	}
	if len(n.children) != len(n.keys)+1 {
		return 0, fmt.Errorf("%d keys but %d children", len(n.keys), len(n.children))
	}
	first := -1
	for i := range n.children {
		clo, chi := lo, hi
		if i > 0 {
			clo = &n.keys[i-1]
		}
		if i < len(n.keys) {
			chi = &n.keys[i]
		}
		d, e := check(n.children[i], clo, chi)
		if e != nil {
			return 0, e
		}
		if first == -1 {
			first = d
		} else if d != first {
			return 0, fmt.Errorf("unequal leaf depth: %d vs %d", first, d)
		}
	}
	return first + 1, nil
}
```

**Complexity.** `Contains` is `O(log n)` with no allocation. `InsertClean` is `O(log n)` time and allocates `O(log n)` nodes (the spine) plus their small slices; every off-spine subtree is shared. `Check` is `O(n)`. The structural-sharing property is exactly what makes the receiver still valid after `InsertClean` — the old root and all its subtrees are untouched, so an old `Tree` value remains a usable, consistent snapshot. (`Delete` follows the symmetric persistent pattern: rebuild the spine, repair underflow by borrowing or merging while allocating new nodes, never mutating an existing one; it is omitted for length but mirrors `senior.md` §9's `fixUnderflow`/`merge` with copies instead of in-place edits.)

---

<a name="testing"></a>
## 7. Testing: Property-Based and Model-Based

A balanced tree is the textbook target for **property-based testing**: the invariants are precise, machine-checkable, and far stronger than any handful of examples. Three layers, in increasing power:

**1. Invariant properties after every operation.** Generate a random sequence of inserts/deletes, apply them, and assert `Check() == nil` after *each* step — not just at the end. This catches transient corruption (e.g., a split that produces a node with three keys, or an underflow repair that leaves unequal leaf depths) the moment it appears. The properties:

- key counts ∈ {1, 2} (no leaked transient 4-node);
- all leaves at equal depth (perfect balance);
- in-order traversal is strictly increasing (BST ordering);
- child count == keys + 1 for internal nodes.

**2. Model-based testing against a reference.** Maintain a trusted reference model — a sorted `[]int` or the language's built-in ordered set — alongside the 2-3 tree. Apply the *same* random operation stream to both, and after each operation assert the tree's in-order traversal equals the model. This is the strongest functional test: it verifies not just "still a valid 2-3 tree" but "represents exactly the right set." In Go, `testing/quick` or a hand-rolled command generator drives it; in Haskell, **QuickCheck** with a `Model` newtype and a list of `Command`s; in Rust, `proptest`/`quickcheck`. The pattern is the standard *stateful / command-based* property test.

**3. Persistence-specific properties** (the ones that matter for the immutable core of §6):

- **Snapshot immutability:** capture `t0`, perform `t1 := t0.InsertClean(k)`, then assert `t0` still contains exactly its original elements and `t0.Check() == nil`. A bug that mutates a shared node in place fails here even though `t1` looks correct.
- **Structural sharing:** after `t1 := t0.InsertClean(k)`, walk both and assert that subtrees off the modified spine are *pointer-identical* across versions (sharing is a performance contract, not just a correctness one — losing it silently turns O(log n) updates into O(n)).
- **Round-trip / replay:** build a tree from a shuffled list, delete all elements in another shuffled order, assert the result is empty and `Check()` held throughout.

Shrinking is the payoff that makes property tests worth the setup: when a generated 10,000-operation sequence fails, the framework automatically reduces it to the minimal failing case (often 3–4 operations), which is usually enough to read off the bug. For balanced trees, **delete is where bugs hide** (the borrow/merge cascade), so weight the generator toward delete-heavy sequences and toward keys that force underflow.

---

<a name="decision"></a>
## 8. Decision Framework and Research Pointers

The professional-level decision, distilled — and deliberately consistent with `senior.md` §11, now sharpened by the persistence and concurrency analysis above:

- **Immutable / persistent ordered collection, or a sequence needing fast ends + O(log n) split/concat (ropes, editor buffers, undo histories, MVCC snapshots)?** → **2-3 tree / 2-3 finger tree.** *This is the one regime where the literal 2-3 structure is the right production choice.* Bounded fan-out makes path copying cheap, balance-by-construction needs no rebalance-state to fork, and the monoid-annotated finger tree gives you sequences, priority queues, interval maps, and ropes from one skeleton. Ship it: this is what `Data.Sequence` does.
- **Read-mostly concurrent ordered map where snapshot semantics are wanted?** → **Immutable 2-3 tree + atomic CAS root.** Wait-free readers, single-CAS publish, free time-travel. Reclaim old versions with GC or epoch-based reclamation.
- **Many concurrent writers, no snapshot need?** → **Lock-free skip list**, not a tree. Local CAS updates, no cascade.
- **Mutable in-RAM general-purpose ordered map?** → **Red-black tree** (the 2-3-4 binary encoding) for small/medium sets, or a **cache-conscious B-tree** (`BTreeMap`, `absl::btree_map`) for large ones — *not* the literal 2-3 tree, which loses to both ([`../04-red-black/professional.md`](../04-red-black/professional.md)).
- **Data on disk/SSD or much larger than cache?** → **B-tree / B+ tree** at page-filling order ([`../11-b-tree/professional.md`](../11-b-tree/professional.md)). The 2-3 tree is just the order-3 special case; never use order 3 here.
- **Teaching or deriving red-black/B-tree invariants from first principles?** → **The 2-3 tree itself.** Its highest-value role remains conceptual: the parent of the entire red-black family and the bridge to B-trees.

The unifying thought, carried over from `senior.md` and now grounded: the 2-3 tree is less a structure you deploy than the *idea* behind the ones you do — red-black is its binary projection for mutable RAM, the B-tree is its high-order generalization for disk, and the 2-3 finger tree is its immutable, sideways form for sequences. The professional skill is knowing which projection the workload demands.

### Research pointers

- **Hinze, R., & Paterson, R.** (2006). *Finger Trees: A Simple General-Purpose Data Structure.* JFP 16(2). The 2-3 finger tree behind `Data.Sequence`; read it to understand the digit/spine accounting and the monoid-measure generalization.
- **Okasaki, C.** (1998). *Purely Functional Data Structures.* Cambridge. The path-copying technique, the banker's/physicist's amortized methods, and why bounded arity makes persistence cheap.
- **Guibas, L. J., & Sedgewick, R.** (1978). *A Dichromatic Framework for Balanced Trees.* FOCS. Red-black trees introduced *as a binary encoding* of 2-3 and 2-3-4 trees — the origin of the equivalence this whole topic rests on.
- **Hopcroft, J. E.** (with Aho & Ullman), *The Design and Analysis of Computer Algorithms* (1974). The classic source crediting Hopcroft with the 2-3 tree and giving the O(log n) operation analysis.
- **Sedgewick, R.** (2008). *Left-Leaning Red-Black Trees.* The explicit 2-3 ↔ LLRB construction; the cleanest bridge between the multiway and binary views.
- **Howley, S. V., & Jones, J.** (2012). *A Non-Blocking Internal Binary Search Tree.* SPAA. Why lock-free rebalancing trees are hard — the negative result that pushes concurrent maps toward skip lists or immutability.
- **Bagwell, P.** (2001). *Ideal Hash Trees*; and Hickey's Clojure HAMTs — the wide-fan-out persistent alternative, useful contrast to 2-3 finger trees when you want persistent *random-access* vectors rather than fast ends + split/concat.

---

## Where to Go Next

- `senior.md` — the equivalence proofs (2-3 ↔ LLRB ↔ AA), height bounds, and the mutable Go / persistent Haskell cores this file builds on.
- [`../11-b-tree/professional.md`](../11-b-tree/professional.md) — the 2-3 tree's high-order generalization in real storage engines: CoW root swaps, WAL, mmap vs buffer-pool.
- [`../04-red-black/professional.md`](../04-red-black/professional.md) — the binary projection in production: cache analysis, lock-free variants, persistent path copying, the bridge back to B-trees.
