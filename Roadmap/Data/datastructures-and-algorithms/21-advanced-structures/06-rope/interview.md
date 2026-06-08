# Rope — Interview Questions & Coding Challenge

> **Audience:** Anyone preparing for systems / data-structure interviews where editor buffers, large-string editing, or balanced-tree-over-positions come up. Questions are tiered **Junior → Middle → Senior → Professional**, with a final coding challenge implementing `concat`, `split`, and `insert` in Go, Java, and Python.

How to use this: cover the answer, attempt the question aloud, then check. The "why it matters" notes flag what an interviewer is really probing.

---

## Table of Contents

1. [Tier 1 — Junior (Q1–Q12c): What & How](#tier1)
2. [Tier 2 — Middle (Q13–Q26d): Why & When](#tier2)
3. [Tier 3 — Senior (Q27–Q38d): Systems](#tier3)
4. [Tier 4 — Professional (Q39–Q52): Proofs & Trade-offs](#tier4)
5. [Coding Challenge — concat / split / insert](#challenge)

---

<a name="tier1"></a>
## Tier 1 — Junior (Q1–Q12): What & How

**Q1. What is a rope?**
A balanced binary tree that represents a long string/sequence. Leaves hold short character chunks; internal nodes hold no characters, only structural info (a **weight**). It makes mid-string editing O(log n) instead of O(n). *Why it matters: baseline definition.*

**Q2. What does a leaf store vs an internal node?**
A **leaf** stores an actual chunk of characters (e.g., `"Hello_"`). An **internal node** stores no text — only its `weight` (and usually cached `length`) and pointers to two children. All text lives in leaves.

**Q3. Define "weight."**
The weight of a node is the **number of characters in its left subtree**. For a leaf it is the length of its own chunk.

**Q4. Why store weight = left-subtree size and not total length?**
Because weight is exactly what you need to decide which way to descend for a position: if `i < weight` the character is on the left; otherwise it is on the right and you re-base with `i -= weight`.

**Q5. How do you find the character at position `i` (index)?**
Start at the root. While at an internal node: if `i < weight` go left; else `i -= weight` and go right. At the leaf, return `chunk[i]`. O(log n).

**Q6. What is the cost of `index` and why?**
O(log n): each step descends one level, and a balanced rope has height O(log n), then a small leaf scan.

**Q7. How does `concat(A, B)` work and what does it cost?**
Make a new internal node with left = A, right = B, weight = length of A. No characters are copied → **O(1)** structurally.

**Q8. What is `length` of an internal node in terms of weight?**
`length = weight + length(right child)` — the left side (weight) plus the right side. Weight alone is *not* the total length.

**Q9. Why is editing a flat string O(n)?**
Inserting/deleting in the middle shifts (copies) the entire tail of the contiguous buffer.

**Q10. Read the whole string from a rope — how?**
In-order traversal of the leaves, concatenating their chunks left to right. O(n).

**Q11. What happens to `index` if you only ever concat and never rebalance?**
The tree can become a tall spine (like a linked list), so `index` degrades to O(n). Ropes are fast only while balanced.

**Q12. Give a real use of ropes.**
Text editors / large-file editing, large-string manipulation, collaborative editing buffers — anywhere mid-string edits on big text must stay fast.

**Q12a. Where does the name "rope" come from?**
From tying many short text "strands" (chunks) together into one long sequence — and being able to splice (concat) or cut (split) the rope cheaply by manipulating a few junctions, never re-spinning the fibers.

**Q12b. Walk the index descent for `index(10)` on `"Hello_my_name_is_Simon"` (root weight 11).**
`10 < 11` → left (i=10); next node weight 6, `10 ≥ 6` → right (i=4); next weight 5, `4 < 5` → left; leaf `"my_na"[4] = 'a'`. Answer `'a'`, visiting 3 internal nodes + 1 leaf.

**Q12c. Does the rope copy characters during `concat`?**
No. `concat` allocates one internal node pointing at A and B; the characters stay where they are. That is why concat is O(1).

---

<a name="tier2"></a>
## Tier 2 — Middle (Q13–Q26): Why & When

**Q13. What is `split(i)` and what does it return?**
It cuts the rope at position `i` into two ropes: `L` covering `[0, i)` and `R` covering `[i, n)`. O(log n).

**Q14. Sketch the `split` algorithm.**
Descend like `index`. At an internal node, if `i <= weight` recurse into the left child and concat the right child onto the right result; else recurse into the right child (with `i - weight`) and concat the left child onto the left result. At a leaf, slice the chunk.

**Q15. Express `insert(i, s)` using split/concat.**
`(L, R) = split(i); return concat(concat(L, leaf(s)), R)`. Cost O(log n + |s|).

**Q16. Express `delete(i, j)`.**
`(L, mid) = split(i); (_, R) = split(mid, j - i); return concat(L, R)`. Cost O(log n) — independent of how many characters are deleted.

**Q17. Why is delete O(log n) no matter how big the deleted range is?**
It is two splits and one concat; the deleted middle subtree is simply discarded, never scanned character-by-character.

**Q18. How do you extract a substring `[i, j)` efficiently?**
Descend to the boundary, then walk leaves left-to-right collecting `j - i` characters. O(log n + m). Do **not** call `index` in a loop (that is O(m log n)).

**Q19. Name three balancing strategies for ropes.**
(1) Rotation-based (AVL / red-black), (2) randomized treap priorities (split/merge), (3) amortized rebuild when height exceeds a threshold (Boehm–Atkinson–Plass Fibonacci bound).

**Q20. Which balancing strategy is most popular and why?**
The **implicit treap**: split/merge are tiny (~15 lines each), give expected O(log n) with no hand-coded rotations, and make persistence automatic.

**Q21. Compare a rope to a gap buffer.**
A gap buffer (Emacs) is one contiguous buffer with a movable gap at the cursor: edits *at the cursor* are O(1), but editing far from the cursor costs O(distance) to move the gap, and concat/split are O(n). A rope makes edits O(log n) *anywhere* and concat O(1), at the cost of worse cache locality.

**Q22. Compare a rope to a piece table.**
A piece table (VS Code, early Word) keeps the original text read-only, appends edits to a separate buffer, and stores a list of "pieces" (spans). Edits add/split pieces — no copying of existing text — and undo is trivial (keep the old piece list). VS Code's "piece-tree" stores that list in a balanced tree, giving O(log n) random access — converging with a rope.

**Q23. When would you NOT use a rope?**
Small strings, mostly-read workloads, or append-only building (use a `StringBuilder`/`bytes.Buffer`). Ropes lose on O(1) random indexing and cache locality.

**Q24. What is the per-character access cost trade-off vs a flat array?**
Flat array: O(1) random index. Rope: O(log n). You trade fast random access for cheap mid-string edits.

**Q25. What goes wrong if you forget `i -= weight` when descending right?**
You index the right subtree with a position that still counts the left characters → off by `weight`, returning the wrong character.

**Q26. How do you keep a rope from filling with tiny leaves after many edits?**
Coalesce adjacent small leaves into chunks of a target size, and split leaves that grow past the cap.

**Q26a. Is a rope a kind of BST? Keyed on what?**
Yes — structurally it is a balanced BST keyed on **position**, not value. The weight (left-subtree size) is the order-statistic that lets you locate the k-th element, exactly like an order-statistic tree or an implicit treap.

**Q26b. How does VS Code's "piece-tree" relate to a rope?**
It is a piece table whose piece list lives in a balanced (red-black) tree, giving O(log n) random access. A rope stores characters in leaves; a piece-tree stores references into two append-only buffers. They converge: both are balanced trees over text spans with O(log n) edits.

**Q26c. Why is `concat` listed as O(1) for ropes but a balanced concat as O(log n)?**
A *naive* concat is one node (O(1)) but can unbalance the tree. A *balanced* concat (e.g., treap `merge`) walks the path to splice while preserving balance, costing O(log n). You pay O(log n) to keep future operations fast.

**Q26d. How would you reverse a rope in O(?)?**
With a lazy "reversed" flag per node (like an implicit treap with a reverse tag): mark the node, swap children's roles on descent, push the flag down lazily. Reverse becomes O(1) to mark, O(log n) per subsequent access — a classic implicit-treap trick.

---

<a name="tier3"></a>
## Tier 3 — Senior (Q27–Q38): Systems

**Q27. How do you implement O(1) undo/redo with a rope?**
Make nodes immutable; each edit path-copies the O(log n) affected nodes and returns a new root, sharing untouched subtrees. Keep a stack of roots — undo/redo is a pointer swap, O(1).

**Q28. What is path copying and what does it cost in space?**
Building new nodes only along the affected root-to-leaf path and sharing the rest. O(log n) new nodes per edit; retaining k versions costs O(n + k·log n).

**Q29. Why is the treap variant especially good for persistence?**
Its split/merge already build new nodes without in-place rotation, so immutability and structure sharing come for free — no special persistence machinery.

**Q30. How does a rope relate to collaborative editing (OT / CRDT)?**
The rope is the *local* fast buffer; concurrency correctness lives in an OT or CRDT layer *above* it. Don't make the rope itself a CRDT — positions shift under concurrent edits, so CRDTs key by stable identifiers, not integer positions.

**Q31. Why store byte offsets internally but expose Unicode units?**
Byte offsets are unambiguous and fast. But a "character" the user sees is a grapheme cluster (possibly several bytes / code points). Convert at the API boundary and round cuts to valid boundaries to avoid mojibake.

**Q32. How do you get O(log n) line/column mapping?**
Augment each node with a **newline count** (`newlines(left) + newlines(right)`), then descend adding the left subtree's newline count when going right — the same weight-descent shape applied to newlines.

**Q33. How do you open a 2 GB file instantly with a rope?**
Use reference-leaves that point into a memory-mapped (mmap) read-only original (`file, offset, length`); the OS pages in only what is viewed. Edits become small private leaves. This converges with the piece-tree.

**Q34. What is the single biggest performance lever in a rope?**
Chunk size. Too small → tall tree, huge pointer overhead, poor locality. Too large → expensive intra-leaf edits. 64–256 bytes is the typical sweet spot.

**Q35. How does chunk size affect memory?**
Memory ≈ n bytes of text + O(n / chunk) internal nodes. With tiny chunks, node overhead can exceed the text itself.

**Q36. Why might a rope appear memory-hungry, and what is the fix?**
Tiny chunks produce many internal nodes. The fix is larger chunks plus coalescing small leaves — not abandoning the rope.

**Q37. How are snapshots cheap with a persistent rope?**
A snapshot is just a retained root pointer — O(1) to capture, O(log n) per access, with all structure shared.

**Q38. Why is a separate line index a bad idea compared to node augmentation?**
A side index drifts out of sync with edits and is error-prone; augmenting nodes maintains the statistic automatically in O(log n) per edit.

**Q38a. How would you implement "find/replace all" efficiently on a rope?**
Iterate leaves left-to-right (O(n)) with a rolling matcher (KMP/Boyer–Moore) across chunk boundaries, collecting match positions; then apply replacements right-to-left (so earlier positions stay valid) via `replace`, or batch them into one split/concat pass. Avoid `index`-per-character.

**Q38b. Two adjacent leaves are `"ab"` and `"cd"`. A search for `"bc"` must work — what's the subtlety?**
Matches can straddle chunk boundaries. A correct scanner cannot treat leaves independently; it must carry matcher state across the boundary (or briefly view a sliding window spanning two leaves).

**Q38c. How do you bound memory growth across a long editing session?**
Cap retained undo versions (drop or coalesce the oldest), and periodically coalesce tiny leaves. Persistent versions are O(log n) each but unbounded history still grows; bounding `k` keeps space at O(n + k·log n).

**Q38d. Your rope-backed editor stutters every few minutes. Likely cause with the BAP model?**
A periodic O(n) **rebuild** firing when the Fibonacci height predicate is violated. Fix by switching to a continuously-balanced variant (treap merge or AVL) so there is no O(n) spike, trading occasional cheap cost for smooth latency.

#### Common interview pitfalls (senior)

- Claiming O(1) concat *and* always-balanced from one operation — pick a balancing model.
- Treating the rope as the merge authority for collaboration instead of layering OT/CRDT on top.
- Forgetting Unicode: splitting inside a multi-byte sequence or grapheme cluster corrupts text.
- Using a side line-index that drifts; augment nodes instead.
- Reading a huge file fully into RAM rather than using mmap reference-leaves.

---

<a name="tier4"></a>
## Tier 4 — Professional (Q39–Q52): Proofs & Trade-offs

**Q39. State the weight invariant and why it makes `index` correct.**
WI: for every internal node, `weight = length(left child)` and `length = weight + length(right child)`. It guarantees that going right skips exactly `weight` characters, so `i -= weight` re-bases the position correctly; induction on height proves `index` returns `S[i]`.

**Q40. Prove `index` is O(height).**
Each loop iteration descends one level (left or right), so it runs at most `height` times, plus an O(chunk) leaf scan. Balanced height O(log n) ⇒ O(log n).

**Q41. Why is `split` O(log n)?**
The recursion follows exactly one root-to-leaf path (one recursive call per level), doing O(1) work plus one O(1) concat per level, and slicing at most one leaf. So O(height) = O(log n).

**Q42. State the Fibonacci height bound.**
(Boehm–Atkinson–Plass) A balanced rope of height `h` has length ≥ `F(h+2)`. Since `F(k) ≈ φ^k/√5`, height `h ≤ log_φ(n√5) − 2 = O(log n) ≈ 1.44 log₂ n`.

**Q43. Prove a treap has expected O(log n) height.**
With i.i.d. uniform priorities, the treap equals the BST built by inserting keys in priority order (random order). Element `j` is an ancestor of `i` iff it has the max priority in the contiguous range between them, giving expected ancestor count `∑ 1/(|i−j|+1) = O(log n)` (harmonic sums). Hence expected depth O(log n).

**Q44. Naive concat is O(1); why is the *amortized* story more subtle?**
Naive O(1) concats let the tree drift out of balance; periodic rebuilds (O(n)) restore it. By the potential method, charging rebuilds to the imbalance-creating operations gives amortized O(log n), but the **worst single operation is O(n)** — unsuitable for hard real-time.

**Q45. Compare treap merge vs naive concat for latency.**
Treap merge is O(log n) expected and keeps balance continuously (no O(n) spikes). Naive concat is O(1) but suffers occasional O(n) rebuilds. Choose treap (or AVL) for smooth latency.

**Q46. What is the persistence space cost for k versions, and why?**
O(n + k·log n). Each edit path-copies O(log n) nodes and shares the rest; the base structure is O(n/chunk). This beats O(k·n) full-copy snapshots exponentially in the per-version term.

**Q47. When do you choose AVL/red-black over a treap for a rope?**
When you need **strict worst-case** O(log n) per operation (latency SLOs), since treap bounds are expected/with-high-probability, not worst-case.

**Q48. Why would you build a high-fanout (B-tree) rope?**
To reduce height and improve cache/disk locality when leaves back the page cache or disk; fewer levels mean fewer cache misses, at the cost of more per-node work.

**Q49. A candidate claims their rope "concats in O(1) and is always balanced." What's wrong?**
You cannot have both with a single naive concat. O(1) concat does not rebalance, so adversarial concat sequences build a spine. "Always balanced" requires either O(log n) balanced merges or periodic O(n) rebuilds — so the claim conflates two incompatible models.

**Q50. Why does a delete of length m cost O(log n), not O(m), while a substring of length m costs O(log n + m)?**
Delete discards a subtree (no per-character work), so it is O(log n). Substring must *materialize* m characters into an output, so it pays O(m) to copy them on top of the O(log n) descent.

**Q51. When concurrent edits arrive, why can't the rope's integer positions be the source of truth?**
Concurrent edits shift positions: A's "insert at 10" means something different after B's delete at 5 shifts everything. CRDTs key characters by stable identifiers precisely to avoid this; the rope is the fast local buffer, with OT/CRDT resolving position drift above it.

**Q52. State the persistence space bound and contrast with full-copy snapshots.**
Path copying: O(log n) new nodes per edit ⇒ O(n + k·log n) for k versions. Full-copy snapshots: O(k·n). Path copying replaces the `n` per version with `log n` — an exponential improvement in version overhead.

### Quick complexity reference

| Operation | Rope (balanced) | Flat string |
|---|---|---|
| index `i` | O(log n) | O(1) |
| concat (naive / balanced) | O(1) / O(log n) | O(a+b) |
| split / insert / delete | O(log n) | O(n) |
| substring (m chars) | O(log n + m) | O(m) |
| undo/redo (persistent) | O(1) | O(n) or op-log |
| line ↔ position | O(log n) augmented | O(n) or side index |
| space (k versions) | O(n + k·log n) | O(k·n) |

### Rapid-fire (one-liners)

- *Weight is…* the left subtree's character count.
- *Text lives only in…* leaves.
- *Going right means…* `i -= weight`.
- *Everything reduces to…* split + concat.
- *Most popular balancing…* implicit treap (split/merge).
- *Cheap undo comes from…* immutable nodes + path copying.
- *Biggest perf lever…* chunk size (64–256 bytes).
- *Huge files via…* mmap reference-leaves (rope ≈ piece-tree).
- *Don't make the rope a…* CRDT — layer OT/CRDT above it.
- *Worst-case strict O(log n) needs…* AVL/red-black, not a treap.

---

<a name="challenge"></a>
## Coding Challenge — concat / split / insert

> **Task.** Implement an immutable rope supporting `concat(A, B)`, `split(rope, i)` → `(L, R)`, and `insert(rope, i, s)`, plus `index` and `toString` for verification. Leaves hold strings; internal nodes hold weight = left-subtree length and a cached total length. `insert` must be expressed as `split` + two `concat`s. Target O(log n) per structural op (balancing optional but discussed).

**Approach.** Leaf = chunk; internal = (left, right, weight=len(left), length). `concat` is one new node (O(1)). `split` descends by weight, partitioning each node and re-concatenating the off-path child onto the correct side (O(height)). `insert(i, s) = concat(concat(L, leaf(s)), R)` where `(L, R) = split(i)`. We include a tiny `toString` (leaf walk) and `index` to verify against a flat string.

### Go

```go
package main

import "fmt"

type Node struct {
	left, right *Node
	chunk       string
	weight, length int
}

func Leaf(s string) *Node { return &Node{chunk: s, weight: len(s), length: len(s)} }

func Concat(a, b *Node) *Node {
	if a == nil { return b }
	if b == nil { return a }
	return &Node{left: a, right: b, weight: a.length, length: a.length + b.length}
}

func isLeaf(n *Node) bool { return n != nil && n.left == nil && n.right == nil }

func Split(n *Node, i int) (*Node, *Node) {
	if n == nil { return nil, nil }
	if isLeaf(n) {
		if i <= 0 { return nil, n }
		if i >= len(n.chunk) { return n, nil }
		return Leaf(n.chunk[:i]), Leaf(n.chunk[i:])
	}
	if i <= n.weight {
		l, rsub := Split(n.left, i)
		return l, Concat(rsub, n.right)
	}
	lsub, r := Split(n.right, i-n.weight)
	return Concat(n.left, lsub), r
}

func Insert(n *Node, i int, s string) *Node {
	l, r := Split(n, i)
	return Concat(Concat(l, Leaf(s)), r)
}

func Index(n *Node, i int) byte {
	for !isLeaf(n) {
		if i < n.weight { n = n.left } else { i -= n.weight; n = n.right }
	}
	return n.chunk[i]
}

func String(n *Node) string {
	if n == nil { return "" }
	if isLeaf(n) { return n.chunk }
	return String(n.left) + String(n.right)
}

func main() {
	r := Concat(Leaf("Hello_"), Leaf("world"))   // "Hello_world"
	r = Insert(r, 6, "big_")                      // "Hello_big_world"
	fmt.Println(String(r))                        // Hello_big_world
	fmt.Printf("%c\n", Index(r, 10))              // 'w' (H0..o4 _5 b6 i7 g8 _9 w10)
	l, rr := Split(r, 6)
	fmt.Printf("%q | %q\n", String(l), String(rr)) // "Hello_" | "big_world"
}
```

### Java

```java
public class RopeChallenge {
    static final class Node {
        final Node left, right;
        final String chunk;        // non-null only for leaves
        final int weight, length;
        Node(Node l, Node r, String c, int w, int len) {
            left = l; right = r; chunk = c; weight = w; length = len;
        }
        static Node leaf(String s) { return new Node(null, null, s, s.length(), s.length()); }
        boolean isLeaf() { return chunk != null; }
    }

    static Node concat(Node a, Node b) {
        if (a == null) return b;
        if (b == null) return a;
        return new Node(a, b, null, a.length, a.length + b.length);
    }

    static Node[] split(Node n, int i) {
        if (n == null) return new Node[]{null, null};
        if (n.isLeaf()) {
            if (i <= 0) return new Node[]{null, n};
            if (i >= n.chunk.length()) return new Node[]{n, null};
            return new Node[]{Node.leaf(n.chunk.substring(0, i)),
                              Node.leaf(n.chunk.substring(i))};
        }
        if (i <= n.weight) {
            Node[] s = split(n.left, i);
            return new Node[]{s[0], concat(s[1], n.right)};
        }
        Node[] s = split(n.right, i - n.weight);
        return new Node[]{concat(n.left, s[0]), s[1]};
    }

    static Node insert(Node n, int i, String s) {
        Node[] p = split(n, i);
        return concat(concat(p[0], Node.leaf(s)), p[1]);
    }

    static char index(Node n, int i) {
        while (!n.isLeaf()) {
            if (i < n.weight) n = n.left; else { i -= n.weight; n = n.right; }
        }
        return n.chunk.charAt(i);
    }

    static String toStr(Node n) {
        if (n == null) return "";
        if (n.isLeaf()) return n.chunk;
        return toStr(n.left) + toStr(n.right);
    }

    public static void main(String[] a) {
        Node r = concat(Node.leaf("Hello_"), Node.leaf("world"));
        r = insert(r, 6, "big_");
        System.out.println(toStr(r));        // Hello_big_world
        System.out.println(index(r, 10));    // w
        Node[] s = split(r, 6);
        System.out.println(toStr(s[0]) + " | " + toStr(s[1])); // Hello_ | big_world
    }
}
```

### Python

```python
class Node:
    __slots__ = ("left", "right", "chunk", "weight", "length")
    def __init__(self, left=None, right=None, chunk=None):
        self.left, self.right, self.chunk = left, right, chunk
        if chunk is not None:
            self.weight = self.length = len(chunk)
        else:
            self.weight = left.length
            self.length = left.length + right.length

def leaf(s): return Node(chunk=s)

def concat(a, b):
    if a is None: return b
    if b is None: return a
    return Node(left=a, right=b)

def is_leaf(n): return n is not None and n.chunk is not None

def split(n, i):
    if n is None: return None, None
    if is_leaf(n):
        if i <= 0: return None, n
        if i >= len(n.chunk): return n, None
        return leaf(n.chunk[:i]), leaf(n.chunk[i:])
    if i <= n.weight:
        l, rsub = split(n.left, i)
        return l, concat(rsub, n.right)
    lsub, r = split(n.right, i - n.weight)
    return concat(n.left, lsub), r

def insert(n, i, s):
    l, r = split(n, i)
    return concat(concat(l, leaf(s)), r)

def index(n, i):
    while not is_leaf(n):
        if i < n.weight: n = n.left
        else: i -= n.weight; n = n.right
    return n.chunk[i]

def to_str(n):
    if n is None: return ""
    if is_leaf(n): return n.chunk
    return to_str(n.left) + to_str(n.right)

if __name__ == "__main__":
    r = concat(leaf("Hello_"), leaf("world"))
    r = insert(r, 6, "big_")
    print(to_str(r))          # Hello_big_world
    print(index(r, 10))       # w
    l, rr = split(r, 6)
    print(to_str(l), "|", to_str(rr))   # Hello_ | big_world
```

### Verification harness (Python) — property test vs flat string

```python
import random

def fuzz():
    s = "abcdefgh"
    r = leaf(s)
    for _ in range(2000):
        op = random.choice(("ins", "del", "split"))
        n = len(s)
        if op == "ins":
            i = random.randint(0, n)
            t = "".join(random.choice("xyz") for _ in range(random.randint(1, 3)))
            r = insert(r, i, t)
            s = s[:i] + t + s[i:]
        elif op == "del" and n > 0:
            i = random.randint(0, n - 1); j = random.randint(i + 1, n)
            l, rest = split(r, i); _, rr = split(rest, j - i)
            r = concat(l, rr); s = s[:i] + s[j:]
        elif op == "split" and n > 0:
            k = random.randint(0, n)
            l, rr = split(r, k); r = concat(l, rr)  # split then rejoin == identity
        assert to_str(r) == s, (to_str(r), s)
        if s:
            k = random.randint(0, len(s) - 1)
            assert index(r, k) == s[k]
    print("all property checks passed")

fuzz()
```

**Follow-ups an interviewer may ask:**
- *Make it balanced.* Add random priorities and replace `concat` with treap `merge`, `split` with treap `split` — see `professional.md` §11.
- *Make it persistent.* Keep nodes immutable (already are here) and retain old roots in a list → O(1) undo.
- *Add line/column.* Augment each node with a newline count and descend on it (`senior.md` §6).
- *Cap chunk size.* Split oversized leaves and coalesce tiny ones to control height and overhead.

**What the interviewer is checking in this challenge:**

1. **Do you put characters only in leaves?** Mixing text into internal nodes is an instant red flag — internal nodes hold weight/length, nothing else.
2. **Is the weight set to the *left* subtree length?** A candidate who sets `weight = len(b)` in `concat` has the invariant backwards; `index` will return wrong characters.
3. **Do you re-base on the right descent (`i -= weight`)?** This single line is where most candidates introduce an off-by-`weight` bug.
4. **Is `insert` expressed as split + two concats?** That demonstrates you understand split/concat as the primitive basis, not just memorized code.
5. **Do you re-attach split children to the correct side?** Right child → right result when cutting left; left child → left result when cutting right. Getting this wrong loses or duplicates characters.
6. **Can you verify with a flat-string oracle?** Producing the fuzz harness shows engineering maturity — you test invariants, not just the happy path.

**Scoring rubric (what "good" looks like):**

| Signal | Junior pass | Strong hire |
|---|---|---|
| Node model | leaves hold text | + cached length, immutable nodes |
| `concat` | O(1), weight = len(A) | discusses balancing cost trade-off |
| `split` | correct partition | explains O(log n) one-path argument |
| `insert` | works | derived purely from split + concat |
| Testing | a few examples | property test vs flat string |
| Extensions | — | offers treap balancing / persistence / line index unprompted |

A complete answer implements all three operations correctly, expresses `insert` via `split`/`concat`, verifies against a flat string, and can articulate the O(log n) bound from the weight invariant and the path-length argument.

---

**Next step:** [tasks.md](tasks.md) — graded implementation tasks (junior → senior) to build a full rope library.
