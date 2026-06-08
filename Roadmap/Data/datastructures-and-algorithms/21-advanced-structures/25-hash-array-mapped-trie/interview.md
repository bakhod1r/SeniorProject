# Hash Array Mapped Trie (HAMT) — Interview Preparation

> 45 tiered questions (Junior → Middle → Senior → Professional) with answer focus, expanded model answers for the highest-signal questions, and a full coding challenge — implement HAMT `get` and `insert` with bitmap + popcount in Go, Java, and Python.

## How to Use This File

Skim the tables first to self-test. For any question you cannot answer crisply, read the matching expanded answer in [Deep-Dive Model Answers](#deep-dive). Then do the coding challenge end-to-end in all three languages without looking — interviewers care most about whether you can derive the **popcount index** and explain **why the old version survives an insert**.

---

## Junior Questions (What / How)

| # | Question | Expected Answer Focus |
|---|---|---|
| 1 | What is a HAMT in one sentence? | A persistent map storing entries in a trie keyed on 5-bit chunks of the key's hash, with nodes compressed by a bitmap + popcount. |
| 2 | Why "5 bits per level"? What does it give you? | `2^5 = 32` children per node → a shallow tree; depth ≈ `log₃₂ n`. |
| 3 | How do you compute the chunk used at depth `d`? | `chunk = (hash >> (5*d)) & 0x1F`, a number 0–31. |
| 4 | What is the bitmap in a node for? | Bit `i` is 1 iff slot `i` has a child; lets a node store only present children. |
| 5 | What does popcount do here? | Counts present slots **below** a target slot → the index into the dense child array. |
| 6 | Give the formula to find a child's array index. | `index = popcount(bitmap & ((1 << slot) - 1))`. |
| 7 | Why not just store a 32-element array per node? | Most slots are empty; that wastes memory. The bitmap + dense array store only present children. |
| 8 | What is the time complexity of `get`? | `O(log₃₂ n)`, effectively O(1) — ~6 hops even for a billion keys. |
| 9 | How do you check whether a slot is present? | `bitmap & (1 << slot) != 0`. |
| 10 | What happens on `insert` to the old map? | Nothing — `insert` returns a **new** map; the old one is unchanged (immutability). |
| 11 | What is structural sharing? | Two map versions pointing at the same physical subtree node because it didn't change. |
| 12 | What is a leaf / entry node? | A node holding an actual `(key, value)` pair at the bottom of a path. |
| 13 | Why compare full keys at a leaf, not just hashes? | Two different keys can share a hash; equal hash ≠ equal key. |
| 14 | What's the branching factor and max depth for a 32-bit hash? | 32; max depth `⌈32/5⌉ = 7`. |
| 15 | Name a real system that uses a HAMT. | Clojure persistent maps/vectors, Scala `immutable.HashMap`, Haskell `unordered-containers`. |

---

## Middle Questions (Why / When)

| # | Question | Expected Answer Focus |
|---|---|---|
| 16 | Why is path copying cheap? | Only the O(log₃₂ n) nodes on the root-to-change path are copied; all sibling subtrees are shared by pointer. |
| 17 | Why does the tree stay balanced without rebalancing? | Uniform hashing distributes keys; a depth-`d` node holds ~`n/32^d` keys, so depth ≈ `log₃₂ n`. |
| 18 | Distinguish a slot collision from a full hash collision. | Slot collision (same chunk, different full hash) → split into a deeper node. Full hash collision (different keys, same hash) → collision node. |
| 19 | How is a full hash collision stored? | A collision node: a small bucket of `(key,value)` entries compared by key. |
| 20 | What is "splitting" on insert? | Replacing a leaf with an internal node that distinguishes two colliding-prefix keys by their next chunk. |
| 21 | What invariant must the bitmap and array satisfy? | `len(children) == popcount(bitmap)`, and the k-th set bit maps to `children[k]`. |
| 22 | Why must `delete` collapse single-child nodes? | Otherwise churn leaves redundant internal nodes, making the tree deeper than `log₃₂ n`. |
| 23 | HAMT vs mutable hash table — key differences? | HAMT is immutable/persistent, never rehashes, O(log₃₂ n); hash table is mutable, O(1), but full copy for a snapshot and resize spikes. |
| 24 | HAMT vs persistent balanced BST? | HAMT is ~5× shallower (`log₃₂` vs `log₂`) and never rehashes, but gives no key ordering; the BST is ordered. |
| 25 | When would you choose a HAMT over a hash map? | When you need cheap immutable versions / snapshots / lock-free shared reads. |
| 26 | When would you NOT use a HAMT? | Single-owner mutable map with no versioning — a plain hash map is faster and lighter. |
| 27 | What's the cost of making a new version vs a full copy? | O(log₃₂ n) vs O(n). |
| 28 | Why is iteration order not sorted? | It follows the hash-defined trie order, not key order. |
| 29 | How can a structural `merge` of two HAMTs be fast? | Skip subtrees that are pointer-equal (identical), since immutable nodes can be shared. |
| 30 | What allocation problem do many immutable inserts cause? | O(n log₃₂ n) garbage nodes — solved by transients/builders. |

---

## Senior Questions (Production / Design)

| # | Question | Expected Answer Focus |
|---|---|---|
| 31 | What is CHAMP and what two problems does it fix? | Compressed HAMP-tree: splits `dataMap`/`nodeMap` for cache locality, and enforces canonical shape for fast structural equality. |
| 32 | How does CHAMP lay out a node's array? | Inline data entries packed at the front, sub-node pointers packed at the back; two popcount indexes. |
| 33 | What are transients and why use them? | A temporarily-mutable, single-owner HAMT; mutate owned nodes in place during a batch build, then `freeze` to immutable — turns O(n log n) allocations into O(n). |
| 34 | What is the ownership invariant for transients? | Mutate a node in place only if it carries this transient's edit token; published nodes (no token) are never mutated. |
| 35 | Why might a HAMT be "slower" than a hash map despite same Big-O? | Pointer chasing → more cache misses, plus allocation/GC churn per update. |
| 36 | How do Clojure vectors relate to HAMTs? | Same 32-way trie, but keyed on the integer index sliced into 5-bit chunks instead of a hash. |
| 37 | Design a lock-free copy-on-write config store with a HAMT. | Atomic ref to an immutable root; readers read lock-free; writer CAS-swaps a new path-copied root. |
| 38 | What is hash flooding and how do you defend? | Attacker submits colliding keys → giant collision nodes → O(n) ops. Defend with seeded/randomized hashes, bounded buckets. |
| 39 | How do you bound memory when keeping many versions? | Share structure (automatic) + drop old roots you no longer need; keep a bounded history window. |
| 40 | What metrics would you monitor for a HAMT in prod? | Max depth, collision-node count, nodes-allocated-per-update, GC pause p99, retained version count. |

---

## Professional Questions (Proofs / Theory)

| # | Question | Expected Answer Focus |
|---|---|---|
| 41 | Prove the expected depth is `Θ(log₃₂ n)`. | A depth-`d` node holds `n/32^d` keys in expectation; becomes a leaf when `32^d > n` → `d = log₃₂ n`. |
| 42 | Give the high-probability depth bound. | Union bound on key pairs sharing a `tD`-bit prefix: `Pr[depth > 2 log₃₂ n + c] ≤ (1/2)·32^{-c}`. |
| 43 | Compare bitmap-node vs full-array space. | `32 + p·P` bits vs `32·P` bits; for `p=1, P=64` it's 96 vs 2048 bits (~21×). |
| 44 | Why is popcount indexing O(1) extra space? | The bitmap doubles as the rank directory — no auxiliary index; one hardware instruction. |
| 45 | State the multi-version memory bound and why it beats naive copying. | `O(n + m·log₃₂ n)` vs `O(n·m)`; path copying shares all unchanged structure; `1/t` factor makes it 5× cheaper per version than a persistent BST. |

---

<a name="deep-dive"></a>
## Deep-Dive Model Answers

These are the eight questions interviewers probe hardest. Practice saying each answer out loud in under a minute.

### D1 — Walk me through `get` end-to-end.

"I compute `h = hash(key)`. Then at depth 0 I take the lowest 5 bits, `slot = h & 0x1F`. I test the node's bitmap: `bitmap & (1 << slot)`. If that bit is 0, the key is absent — done. If it's 1, the child is at dense index `popcount(bitmap & ((1 << slot) - 1))` — the number of present slots below mine. I follow that pointer, shift the hash right by 5, and repeat at depth 1, then depth 2, and so on. When I hit a leaf I compare the **full key** (not just the hash) and return the value or 'not found'. Total hops are the tree depth, `O(log₃₂ n)`, effectively a constant ~6."

### D2 — Why does an `insert` not destroy the old map?

"Because no node is ever mutated. `insert` walks down to where the change happens and rebuilds **only the nodes on that path** as fresh copies, each with one child pointer redirected. Every sibling subtree is reused by pointer — that's structural sharing. The old root still points at the old, unchanged path nodes, so querying the old version gives the old answers. I copied ~`log₃₂ n` small nodes, not the whole map."

### D3 — Derive the dense index again, slowly.

"The dense array holds only present children in slot order. The child for slot `s` sits after all present children whose slot is below `s`. 'How many present slots are below `s`' is exactly `popcount(bitmap & ((1 << s) - 1))`. The mask `(1 << s) - 1` is all 1-bits in positions `0..s-1`; ANDing keeps only the present-and-below bits; popcount counts them. That count is the array index. Forgetting the `-1` is the classic bug — it would count slot `s` itself."

### D4 — Slot collision vs full hash collision.

"Slot collision: two keys share the same 5-bit chunk at some depth but differ deeper in the hash. I resolve it by **splitting** — replacing the leaf with an internal node and recursing on the next chunk until they diverge. Full hash collision: two distinct keys with identical 32-bit hashes. There are no more bits to split on, so I store both in a **collision node**, a tiny bucket compared by key. Good hashes make those essentially never happen unless an attacker is choosing keys."

### D5 — Why is the tree balanced with no rotations?

"Because placement is by hash, and the hash is uniform. A node at depth `d` is reached only by keys agreeing in the first `5d` hash bits, so it holds about `n / 32^d` keys in expectation. That drops below one around `d = log₃₂ n`, which is therefore the expected depth. Randomness gives balance for free — no rebalancing logic. The price is that a bad or adversarial hash can ruin it, which is why hash quality matters."

### D6 — HAMT vs hash table vs persistent BST — one line each.

"Hash table: O(1), mutable, but a snapshot is a full O(n) copy and it has resize spikes. Persistent BST: O(log₂ n), immutable, ordered, but ~5× deeper than a HAMT. HAMT: O(log₃₂ n), immutable, no ordering, no rehash, ~5× shallower than a BST, and a new version costs only O(log₃₂ n). Pick HAMT when you need cheap immutable versions and don't need ordering."

### D7 — What are transients and when do they matter?

"Building a map with N immutable inserts allocates `O(N log₃₂ n)` garbage nodes. A transient is a temporarily-mutable HAMT owned by one thread: it tags nodes with an edit token and mutates owned nodes in place, copying-and-owning unowned ones once. `persistent!` freezes it by dropping the tokens. That turns a batch build into `O(N)` allocations. It's the standard fast path in Clojure/Scala for bulk construction."

### D8 — What is CHAMP and why did Scala adopt it?

"CHAMP splits a node's bitmap into a `dataMap` (inline key/value entries) and a `nodeMap` (sub-node pointers), packing data at the front of the array and sub-nodes at the back. That improves cache locality and iteration speed. It also enforces a **canonical shape** — no singleton sub-nodes — so two maps with the same entries have identical structure, which makes `equals` short-circuit on bitmaps and pointer equality. Scala's `immutable.HashMap` moved to CHAMP in 2.13 for the memory and speed wins."

---

## Coding Challenge (3 Languages)

### Challenge: Implement HAMT `get` and `insert` with bitmap + popcount

> Build an **immutable** HAMT keyed on a 32-bit hash with **5-bit chunks**.
> - `insert(root, hash, key, value)` returns a **new** root (path copying) without mutating the old one.
> - `get(root, hash, key)` returns the value or a "not found" signal.
> - Use a **bitmap** + **popcount** to address children in a dense array.
> - Handle leaf splitting; for equal full hashes, store both keys in a small collision bucket.
> - **Invariant to verify:** after `r2 = insert(r1, ...)`, querying `r1` must be unaffected.

#### Go

```go
package main

import (
	"fmt"
	"math/bits"
)

const bpl = 5
const mask = (1 << bpl) - 1

type entry struct {
	hash  uint32
	key   string
	value int
}

type node struct {
	bitmap   uint32
	children []*node
	entries  []entry // non-empty => leaf or collision bucket
}

func chunk(h uint32, d int) uint32 { return (h >> (uint(d) * bpl)) & mask }
func denseIndex(bm, slot uint32) int { return bits.OnesCount32(bm & ((1 << slot) - 1)) }

func get(n *node, h uint32, k string) (int, bool) {
	d := 0
	for n != nil {
		if n.entries != nil {
			for _, e := range n.entries {
				if e.key == k {
					return e.value, true
				}
			}
			return 0, false
		}
		s := chunk(h, d)
		if n.bitmap&(1<<s) == 0 {
			return 0, false
		}
		n = n.children[denseIndex(n.bitmap, s)]
		d++
	}
	return 0, false
}

func leafNode(e entry) *node { return &node{entries: []entry{e}} }

func insert(n *node, h uint32, k string, v, d int) *node {
	e := entry{h, k, v}
	if n == nil {
		return leafNode(e)
	}
	if n.entries != nil {
		// overwrite if key present
		for _, ex := range n.entries {
			if ex.key == k {
				out := &node{}
				out.entries = make([]entry, len(n.entries))
				copy(out.entries, n.entries)
				for i := range out.entries {
					if out.entries[i].key == k {
						out.entries[i].value = v
					}
				}
				return out
			}
		}
		existing := n.entries[0]
		if existing.hash == h {
			// full hash collision -> grow the bucket
			out := &node{entries: append(append([]entry{}, n.entries...), e)}
			return out
		}
		// split: build internal node distinguishing existing vs new
		inner := &node{}
		inner = insert(inner, existing.hash, existing.key, existing.value, d)
		// re-add the rest of the bucket (usually size 1)
		for i := 1; i < len(n.entries); i++ {
			ex := n.entries[i]
			inner = insert(inner, ex.hash, ex.key, ex.value, d)
		}
		return insert(inner, h, k, v, d)
	}
	s := chunk(h, d)
	i := denseIndex(n.bitmap, s)
	out := &node{bitmap: n.bitmap, children: append([]*node{}, n.children...)}
	if n.bitmap&(1<<s) == 0 {
		out.bitmap |= 1 << s
		out.children = append(out.children, nil)
		copy(out.children[i+1:], out.children[i:])
		out.children[i] = leafNode(e)
	} else {
		out.children[i] = insert(n.children[i], h, k, v, d+1)
	}
	return out
}

func main() {
	var r1 *node
	r1 = insert(r1, 0b01001, "a", 1, 0)
	r1 = insert(r1, 0b00110, "b", 2, 0)
	r2 := insert(r1, 0b11010, "c", 3, 0)

	v, ok := get(r2, 0b11010, "c", )
	fmt.Println(v, ok)            // 3 true
	_, ok = get(r1, 0b11010, "c") // r1 must NOT see "c"
	fmt.Println(ok)               // false  (persistence verified)
}
```

#### Java

```java
import java.util.*;

public class HAMTChallenge {
    static final int B = 5, M = (1 << B) - 1;

    static final class Entry {
        int hash; String key; int value;
        Entry(int h, String k, int v) { hash = h; key = k; value = v; }
    }
    static final class Node {
        int bitmap; Node[] children; List<Entry> entries; // entries != null => leaf/bucket
    }

    static int chunk(int h, int d) { return (h >>> (d * B)) & M; }
    static int denseIndex(int bm, int s) { return Integer.bitCount(bm & ((1 << s) - 1)); }

    static Integer get(Node n, int h, String k) {
        int d = 0;
        while (n != null) {
            if (n.entries != null) {
                for (Entry e : n.entries) if (e.key.equals(k)) return e.value;
                return null;
            }
            int s = chunk(h, d);
            if ((n.bitmap & (1 << s)) == 0) return null;
            n = n.children[denseIndex(n.bitmap, s)];
            d++;
        }
        return null;
    }

    static Node leaf(Entry e) {
        Node n = new Node(); n.entries = new ArrayList<>(List.of(e)); return n;
    }

    static Node insert(Node n, int h, String k, int v, int d) {
        Entry e = new Entry(h, k, v);
        if (n == null) return leaf(e);
        if (n.entries != null) {
            for (Entry ex : n.entries) {
                if (ex.key.equals(k)) {
                    Node out = new Node(); out.entries = new ArrayList<>();
                    for (Entry x : n.entries)
                        out.entries.add(x.key.equals(k) ? e : x);
                    return out;
                }
            }
            Entry first = n.entries.get(0);
            if (first.hash == h) {
                Node out = new Node();
                out.entries = new ArrayList<>(n.entries); out.entries.add(e);
                return out;
            }
            Node inner = new Node();
            inner = insert(inner, first.hash, first.key, first.value, d);
            for (int i = 1; i < n.entries.size(); i++) {
                Entry x = n.entries.get(i);
                inner = insert(inner, x.hash, x.key, x.value, d);
            }
            return insert(inner, h, k, v, d);
        }
        int s = chunk(h, d), i = denseIndex(n.bitmap, s);
        Node out = new Node(); out.bitmap = n.bitmap;
        if ((n.bitmap & (1 << s)) == 0) {
            out.bitmap |= (1 << s);
            int len = n.children == null ? 0 : n.children.length;
            out.children = new Node[len + 1];
            if (n.children != null) {
                System.arraycopy(n.children, 0, out.children, 0, i);
                System.arraycopy(n.children, i, out.children, i + 1, len - i);
            }
            out.children[i] = leaf(e);
        } else {
            out.children = n.children.clone();
            out.children[i] = insert(n.children[i], h, k, v, d + 1);
        }
        return out;
    }

    public static void main(String[] args) {
        Node r1 = null;
        r1 = insert(r1, 0b01001, "a", 1, 0);
        r1 = insert(r1, 0b00110, "b", 2, 0);
        Node r2 = insert(r1, 0b11010, "c", 3, 0);
        System.out.println(get(r2, 0b11010, "c")); // 3
        System.out.println(get(r1, 0b11010, "c")); // null (persistence verified)
    }
}
```

#### Python

```python
class Entry:
    __slots__ = ("hash", "key", "value")
    def __init__(self, h, k, v): self.hash = h; self.key = k; self.value = v

class Node:
    __slots__ = ("bitmap", "children", "entries")
    def __init__(self):
        self.bitmap = 0; self.children = []; self.entries = None  # entries -> leaf/bucket

B, M = 5, (1 << 5) - 1
def chunk(h, d): return (h >> (d * B)) & M
def dense_index(bm, s): return (bm & ((1 << s) - 1)).bit_count()

def get(n, h, k):
    d = 0
    while n is not None:
        if n.entries is not None:
            for e in n.entries:
                if e.key == k:
                    return e.value, True
            return None, False
        s = chunk(h, d)
        if not (n.bitmap & (1 << s)):
            return None, False
        n = n.children[dense_index(n.bitmap, s)]
        d += 1
    return None, False

def leaf(e):
    n = Node(); n.entries = [e]; return n

def insert(n, h, k, v, d):
    e = Entry(h, k, v)
    if n is None:
        return leaf(e)
    if n.entries is not None:
        if any(ex.key == k for ex in n.entries):
            out = Node()
            out.entries = [e if ex.key == k else ex for ex in n.entries]
            return out
        first = n.entries[0]
        if first.hash == h:
            out = Node(); out.entries = list(n.entries) + [e]; return out
        inner = Node()
        inner = insert(inner, first.hash, first.key, first.value, d)
        for ex in n.entries[1:]:
            inner = insert(inner, ex.hash, ex.key, ex.value, d)
        return insert(inner, h, k, v, d)
    s = chunk(h, d); i = dense_index(n.bitmap, s)
    out = Node(); out.bitmap = n.bitmap; out.children = list(n.children)
    if not (n.bitmap & (1 << s)):
        out.bitmap |= (1 << s)
        out.children = n.children[:i] + [leaf(e)] + n.children[i:]
    else:
        out.children[i] = insert(n.children[i], h, k, v, d + 1)
    return out

if __name__ == "__main__":
    r1 = None
    r1 = insert(r1, 0b01001, "a", 1, 0)
    r1 = insert(r1, 0b00110, "b", 2, 0)
    r2 = insert(r1, 0b11010, "c", 3, 0)
    print(get(r2, 0b11010, "c"))  # (3, True)
    print(get(r1, 0b11010, "c"))  # (None, False) -- persistence verified
```

**Follow-ups the interviewer may ask:**
- Add `delete` with single-child collapse (see [middle.md](./middle.md)).
- Convert to **CHAMP** layout (split `dataMap`/`nodeMap`) — see [senior.md](./senior.md).
- Add **transients** for an O(n) batch build — see [senior.md](./senior.md).
- Prove the O(log₃₂ n) depth bound — see [professional.md](./professional.md).

---

## Rapid-Fire Round (one-liners)

| # | Question | One-line answer |
|---|---|---|
| 1 | Mask to count present slots below `s`? | `(1 << s) - 1`. |
| 2 | Bit to test presence of slot `s`? | `bitmap & (1 << s)`. |
| 3 | Set slot `s` in the bitmap? | `bitmap | (1 << s)`. |
| 4 | Clear slot `s` in the bitmap? | `bitmap & ~(1 << s)`. |
| 5 | Dense array length equals…? | `popcount(bitmap)`. |
| 6 | Java pitfall when shifting the hash? | Use `>>>` (unsigned), not `>>`. |
| 7 | Max depth for a 64-bit hash, 5-bit chunks? | `⌈64/5⌉ = 13`. |
| 8 | Cost of a snapshot of a HAMT? | O(1) — copy the root pointer. |
| 9 | Why immutable nodes are thread-safe to share? | They never change, so no data races on reads. |
| 10 | What makes CHAMP's `equals` fast? | Canonical shape → short-circuit on bitmaps and pointer equality. |
| 11 | Clojure vector is a HAMT keyed on…? | The integer index, sliced into 5-bit chunks. |
| 12 | Defense against hash flooding? | Seeded/randomized hash (SipHash) + bounded buckets. |

---

## System-Design Prompt — "Versioned config store"

> **Prompt:** Design an in-memory configuration store that thousands of reader threads query continuously, that one updater modifies frequently, and that supports "give me an immutable snapshot of the config as of now" for audit and rollback.

**Strong answer outline:**

1. **Structure:** store the config as a HAMT (immutable map) referenced by a single atomic pointer (`atomic.Pointer` / `AtomicReference`).
2. **Reads:** load the root once per request and read lock-free — the map a reader holds never mutates, so no locks, no torn reads, stable latency.
3. **Writes:** the updater loads the current root, builds a new version via path-copying `insert`/`delete` (O(log₃₂ n)), then CAS-swaps the atomic pointer; retry on CAS failure.
4. **Snapshots:** `snapshot()` returns the current root pointer — O(1). The snapshot and the live map share all unchanged structure, so keeping many snapshots is cheap.
5. **History/rollback:** keep a bounded ring of recent roots; "rollback to version i" is `ref.set(history[i])`.
6. **Defenses:** seeded hash for untrusted config keys; cap retained history to avoid leaking shared nodes; metrics on map depth and collision-node count.

**Why not a mutable hash map + lock?** Locks serialize readers and add tail latency; snapshots require an O(n) full copy. The HAMT gives lock-free reads and O(1) snapshots — exactly the workload's needs.

---

## Whiteboard Derivations (practice these by hand)

### W1 — Compute the dense index

> A node has children in slots `{2, 5, 9, 20}`. Find the dense array index for slot 9, and say whether slot 7 is present.

```text
bitmap (bits 2,5,9,20 set) — for slot 9:
    mask  = (1 << 9) - 1            = 0b0000_0000_0001_1111_1111  (bits 0..8)
    below = bitmap & mask           = bits {2, 5} set             (9 and 20 excluded)
    index = popcount(below) = 2     -> children[2] holds slot 9's child.
slot 7:
    bitmap & (1 << 7) = 0           -> slot 7 NOT present.
```

### W2 — Trace a 2-level lookup

> 5-bit chunks. `hash(key) = 0b...11010_00110_01001`. Trace `get`.

```text
depth 0: chunk = 0b01001 = 9.  test root bitmap bit 9 -> present.
         index = popcount(rootBitmap below bit 9). descend.
depth 1: chunk = 0b00110 = 6.  test bit 6 -> present. index = popcount below 6. descend.
depth 2: chunk = 0b11010 = 26. test bit 26 -> reach leaf. compare full key. return value.
Total: 3 hops -> O(log_32 n).
```

### W3 — Count copied nodes on insert

> A map has depth 4 along the insertion path, and the new key lands in an empty slot at depth 4. How many nodes are allocated?

```text
Copied internal nodes: one per path level = 4 (depths 0,1,2,3) plus the depth-4 node
   where the slot is set = the node that gains the new child.
New leaf: 1.
=> ~5 fresh nodes; everything off the path is shared by pointer. O(log_32 n) allocations.
```

### W4 — Estimate depth for n = 50,000

```text
log_32(50000) = ln(50000)/ln(32) = 10.82 / 3.466 = 3.12  ~  3-4 levels.
So get/insert touch ~3-4 nodes. "Effectively constant."
```

---

## Interview Pitfalls to Avoid

- Indexing `children[slot]` directly (slot is 0–31; the dense array is shorter). Always use the popcount index.
- Saying "O(1)" without qualification — say **O(log₃₂ n), effectively O(1)**; the interviewer wants the honest bound.
- Claiming HAMTs are always faster than hash maps — they are not; they trade speed for persistence.
- Forgetting full-key comparison at the leaf (equal hash ≠ equal key).
- Mutating a node in place "for efficiency" and silently breaking older versions.
- Confusing the two collision types (split vs collision node).
- Forgetting that delete must collapse single-child nodes, or the tree silently deepens.

---

## Mock-Interview Script (45 minutes)

A realistic flow an interviewer might run, so you can rehearse pacing:

| Minutes | Phase | What you should demonstrate |
|---|---|---|
| 0–5 | Warm-up (Q1, Q3, Q5) | Define a HAMT; derive the chunk and the popcount index out loud. |
| 5–10 | Whiteboard W1 + W2 | Compute a dense index and trace a 2-level lookup by hand without errors. |
| 10–25 | Code `get` + `insert` | Implement bitmap + popcount + path copying in your strongest language; talk through immutability. |
| 25–32 | Persistence question (D2) | Explain why the old version survives; show the shared vs copied nodes on the board. |
| 32–40 | Scaling (Q31, Q37) | Bring up CHAMP, transients, and the lock-free copy-on-write config design. |
| 40–45 | Trade-offs (D6) | Compare against a hash map and a persistent BST; state when *not* to use a HAMT. |

**Self-grading rubric:**

- **Pass:** correct `get`/`insert`, correct popcount index, clear immutability explanation.
- **Strong:** also handles collisions, states O(log₃₂ n) honestly, and names a real user (Clojure/Scala).
- **Standout:** discusses CHAMP/transients, hash flooding defense, and the persistent-vector duality unprompted.

---

**Next step:** [Practice Tasks →](./tasks.md) — 15 graded tasks plus a benchmark across Go, Java, and Python.
