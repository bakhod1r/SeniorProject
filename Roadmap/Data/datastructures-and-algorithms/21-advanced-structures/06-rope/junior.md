# Rope — Junior Level

> **Read time: ~45 minutes** · **Audience:** Students who know binary trees, recursion, and arrays/strings, and now want a data structure that edits *huge* strings without copying the whole thing every time.

A **rope** is a balanced binary tree that stores a long string (or any sequence) as many small chunks at its leaves, so that **indexing, concatenation, splitting, inserting, and deleting** are all O(log n) instead of the O(n) you pay with a flat array or a `std::string`. The name comes from the idea of tying many short "strands" of text together into one long "rope" — you can splice ropes together or cut them apart cheaply, because you only ever move a few tree pointers, never the underlying characters.

If you have ever wondered how a text editor stays responsive while you type into the middle of a 500 MB log file, or how a collaborative editor merges two people's edits without re-sending the whole document, the rope is one of the classic answers. This document teaches the rope from scratch: what the leaves and internal nodes hold, what the magical **weight** field is, and how to do `index` and `concat` with a fully worked example on a small string.

---

## Table of Contents

1. [Introduction — Why Flat Strings Are Slow to Edit](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts — Leaves, Internal Nodes, and Weight](#core-concepts)
5. [Big-O Summary](#big-o)
6. [Real-World Analogies](#analogies)
7. [Pros and Cons (vs Flat String / Array)](#pros-cons)
8. [Step-by-Step Walkthrough on `"Hello_my_name_is_Simon"`](#walkthrough)
9. [Code Examples — Go, Java, Python](#code-examples)
10. [Coding Patterns — Descend by Weight](#patterns)
11. [Error Handling](#errors)
12. [Performance Tips](#performance-tips)
13. [Best Practices](#best-practices)
14. [Edge Cases](#edge-cases)
15. [Common Mistakes](#common-mistakes)
16. [Cheat Sheet](#cheat-sheet)
17. [Visual Animation Reference](#animation)
18. [Summary](#summary)
19. [Further Reading](#further-reading)

---

<a name="introduction"></a>
## 1. Introduction — Why Flat Strings Are Slow to Edit

Suppose you store a document as a single flat array of characters — exactly what a normal `String`, `[]byte`, or `str` is under the hood:

```
"Hello_my_name_is_Simon"
 H e l l o _ m y _ n a m e _ i s _ S i m o n
 0 1 2 3 4 5 ...
```

Reading one character is fast: `s[7]` is O(1). But **editing** is the problem. Watch what happens when you insert the word `"there_"` after `"Hello_"` (position 6):

1. Allocate a new buffer of size `old + 6`.
2. Copy the first 6 characters.
3. Copy the 6 new characters.
4. Copy the remaining 16 characters.

That is **O(n)** work — every insert touches the whole tail of the string. For a 22-character demo string nobody cares. For a 500 MB source file, every keystroke would copy hundreds of megabytes. The editor would freeze.

The same pain shows up for:

- **Concatenation:** joining two strings of length `a` and `b` copies `a + b` characters — O(a + b).
- **Deletion in the middle:** shift everything after the cut left — O(n).
- **Splitting:** cut the string into two halves — copy both — O(n).

A **rope** fixes all of these. The key insight: **stop storing the string as one contiguous block.** Instead, break it into short chunks, hang those chunks off the leaves of a balanced binary tree, and at each internal node remember the **weight** = the number of characters in its *left* subtree. With that one extra number per node you can:

| Operation | Flat string | Rope |
|---|---|---|
| Index character `i` | O(1) | **O(log n)** |
| Concatenate two strings | O(a + b) | **O(1)** (or O(log n) if rebalancing) |
| Split at position `i` | O(n) | **O(log n)** |
| Insert in the middle | O(n) | **O(log n)** |
| Delete a range | O(n) | **O(log n)** |
| Substring of length `m` | O(m) | **O(log n + m)** |

Ropes were introduced by **Hans-J. Boehm, Russ Atkinson, and Michael Plass** in their 1995 paper *"Ropes: An Alternative to Strings"* (Software—Practice & Experience). They power text editors, the SGI C++ STL `rope` class, and the buffer layer behind several real editors. In this Roadmap, the rope sits in the **advanced structures** section because it is really "a balanced binary search tree where the key is *position* instead of *value*" — closely related to the implicit **treap** (`22-randomized-algorithms/04-treap`) and to the **segment tree** (`09-trees/06-segment-tree`), which both also store aggregates over positions.

---

<a name="prerequisites"></a>
## 2. Prerequisites

To get the most out of this document you should be comfortable with:

1. **Binary trees.** Nodes with up to two children, recursion that descends left or right, the notion of leaves and internal nodes, and tree height.
2. **Recursion.** Most rope operations recurse on `(node, position)`. The control flow looks like a binary-search descent.
3. **Strings and arrays.** You should know that a flat string is a contiguous block and that inserting into the middle is O(n).
4. **Big-O for balanced trees.** Knowing why a balanced binary tree has height O(log n) is essential, because *every* rope time bound depends on the tree staying balanced.
5. **(Helpful) Binary search trees.** A rope is structurally a BST keyed on position. If `09-trees/02-bst` feels comfortable, ropes will click faster.

If any of these is shaky, review **09-trees/01-binary-tree**, **09-trees/02-bst**, and **05-basic-data-structures/01-array** in this Roadmap first.

---

<a name="glossary"></a>
## 3. Glossary

| Term | Definition |
|---|---|
| **Rope** | A balanced binary tree representing a string/sequence; leaves hold short substrings. |
| **Leaf** | A node that holds an actual chunk of characters (e.g., `"Hello_"`). Has no children. |
| **Internal node** | A node with children; holds **no characters itself**, only structural info (weight). |
| **Chunk / fragment** | The short flat string stored at one leaf, typically 8–128 characters. |
| **Weight** | The total number of characters in a node's **left subtree** (for a leaf, its own length). The single most important field. |
| **Length** | The total characters under a node = weight(node) + length(right subtree). |
| **Index / char-at** | Return the character at position `i`. Descends using weights. |
| **Concat** | Build a new internal node whose left child is rope A and right child is rope B. |
| **Split** | Cut a rope at position `i` into two ropes covering `[0, i)` and `[i, n)`. |
| **Insert** | Place a string at position `i` = split at `i`, concat left + new + right. |
| **Delete** | Remove `[i, j)` = split out the middle, concat the two outer pieces. |
| **Substring / report** | Collect the characters of `[i, j)` into a flat string. |
| **Balance** | Keeping the tree height O(log n) so operations stay fast. |
| **Rebalance** | Restructuring an unbalanced rope back to O(log n) height. |

---

<a name="core-concepts"></a>
## 4. Core Concepts — Leaves, Internal Nodes, and Weight

### 4.1 Two kinds of nodes

A rope has exactly two node types, and the distinction is the whole trick:

- **Leaf node:** holds a short flat string (a chunk). It is where the actual characters live. Example: a leaf might hold `"name_"`.
- **Internal node:** holds **no characters**. It has a left child and a right child, and it stores a single number: the **weight**.

So the *only* place text physically lives is the leaves. Internal nodes are pure structure. Reading the whole string left-to-right is just an **in-order traversal** that concatenates the leaf chunks in order.

```
        [•]              ← internal node (weight = 6)
       /   \
  "Hello_"  "world"      ← two leaves
```

Reading in order: visit left leaf `"Hello_"`, then right leaf `"world"` → `"Hello_world"`.

### 4.2 The weight field — the heart of the rope

**Weight of a node = the number of characters in its left subtree.**

- For a **leaf**, the weight is just the length of its own chunk (it has no children, so we treat its content as "the left side").
- For an **internal node**, weight = total characters reachable through the *left* child.

Why store only the left subtree's size? Because that is exactly the information you need to decide *which way to descend* when looking up a position. If you want character `i`:

```
at an internal node with weight w:
    if i < w:   the character is in the LEFT subtree  → recurse left,  position i
    else:       the character is in the RIGHT subtree → recurse right, position i - w
```

That subtraction `i - w` is the magic: when you go right, you "skip past" all `w` characters on the left, so the position re-bases to the right subtree's local coordinate system. This is identical in spirit to how an **order-statistic tree** finds the k-th element, and to how an **implicit treap** keys nodes by subtree size.

### 4.3 Why weight = left-subtree size makes index O(log n)

Each step of the descent either goes left or right and moves down one level. A balanced rope has height O(log n). So `index` does at most O(log n) comparisons and one final scan inside a small leaf chunk → **O(log n)**.

### 4.4 Concat is (almost) free

To concatenate rope **A** and rope **B**, you do *not* copy any characters. You make a brand-new internal node whose:

- left child = A,
- right child = B,
- weight = total length of A.

```
concat(A, B):
        [• weight = len(A)]
       /                   \
      A                     B
```

That is **O(1)** structurally (plus an O(log n) walk if you need `len(A)` and you didn't cache it, or if you choose to rebalance). No character is moved. This is the rope's superpower: joining a 1 GB rope and a 2 GB rope is a single pointer operation.

### 4.5 Length vs weight

A common confusion: **weight is not the total length** of the subtree.

```
length(leaf)     = len(chunk)
length(internal) = weight(internal) + length(right child)
                 = (chars on left)  + (chars on right)
weight(internal) = length(left child)   ← only the left!
```

To get the total length of a rope, you add the weight (left) to the length of the right subtree. Many implementations cache `length` at each node too, so both are O(1) reads.

### 4.6 The shape can be unbalanced — and that is the catch

Nothing in `concat` forces balance. If you concatenate 1000 single-character ropes one at a time, you get a "spine" 1000 nodes tall — a linked list in disguise. Then `index` becomes O(n). Keeping the rope **balanced** (height O(log n)) is what `middle.md` and `professional.md` cover in depth. For now, just remember: **ropes are fast only while balanced.**

---

<a name="big-o"></a>
## 5. Big-O Summary

| Operation | Time | Space |
|---|---|---|
| **Index** (char at position `i`) | **O(log n)** | O(log n) recursion |
| **Concat** A + B | **O(1)** structural; **O(log n)** if rebalanced | O(1) |
| **Split** at `i` | **O(log n)** | O(log n) |
| **Insert** string at `i` | **O(log n)** | O(log n) |
| **Delete** range `[i, j)` | **O(log n)** | O(log n) |
| **Substring** `[i, j)` of length `m` | **O(log n + m)** | O(m) |
| **Length** of a node | **O(1)** (cached) | — |
| **Total memory** | O(n) characters + O(n / chunk) internal nodes | — |

For a balanced rope on `n = 10⁹` characters with a height of about 30, an index lookup is ~30 pointer hops — under a microsecond. A flat-string insert into that same buffer would copy up to a gigabyte.

---

<a name="analogies"></a>
## 6. Real-World Analogies

### 6.1 A physical rope of short strands
A real rope is many short fibers twisted together. To make a longer rope you splice (concat) two ropes — you tie the ends, you do not re-spin the fibers. To cut a rope (split) you snip once. Editing the rope's *middle* is a local splice. That is exactly the data structure: short character "strands" at the leaves, joined and cut by manipulating a few junction points.

### 6.2 A book bound in chapters
A 1000-page book is bound as separate signatures (folded sheets) stitched together. To insert a new chapter you do not reprint the book — you stitch a new signature into the binding. The table of contents (the internal nodes with their page counts = weights) tells you which signature page 738 lives in without flipping every page.

### 6.3 A train of cars
Each leaf chunk is a train car holding some passengers (characters). The couplings between cars are internal nodes. To join two trains (concat) you couple them — O(1). To find "passenger #500" you read each car's capacity (weight) and skip whole cars until you reach the right one — O(log n) with a balanced coupling tree.

### 6.4 Git's content-addressed trees
Git stores a directory as a tree of blobs; editing one file creates new tree nodes along one path and *shares* all the untouched subtrees. Persistent ropes (`senior.md`) do the same for text: an edit clones one root-to-leaf path and shares everything else, giving cheap undo/version history.

---

<a name="pros-cons"></a>
## 7. Pros and Cons (vs Flat String / Array)

### Pros
- **Cheap mid-string edits.** Insert/delete/split/concat are O(log n) instead of O(n). This is the entire reason ropes exist.
- **O(1) concatenation.** Joining huge texts is a single node allocation; no characters move.
- **No giant contiguous allocation.** A 2 GB document does not need a single 2 GB block of RAM; it is many small chunks. This avoids allocator fragmentation and reallocation storms.
- **Structure sharing / persistence.** Because edits touch only one path, you can keep old versions cheaply for undo and collaborative editing (`senior.md`).
- **Good for append-heavy logs and editors.** Repeatedly appending or inserting stays fast.

### Cons
- **Slower indexing.** O(log n) per character vs O(1) for a flat array. Iterating the whole string is fine (use an iterator), but random single-char access is slower.
- **Worse cache locality.** Characters are scattered across many small chunks rather than one contiguous run. CPUs love contiguous memory; ropes give that up.
- **Memory overhead per node.** Each internal node costs pointers + a weight field. With tiny chunks the overhead can dwarf the text. Chunk-size tuning (`senior.md`) matters.
- **Must stay balanced.** A naive concat-only workload degrades to O(n). You need a balancing discipline (treap priorities, AVL/red-black rotations, or periodic rebuild).
- **More code and complexity.** A flat string is trivial; a correct rope with balancing and splitting is a few hundred lines.

### Decision matrix
| Need | Use |
|---|---|
| Short, mostly-read string | **Flat string** |
| Build a string by appending many pieces | **StringBuilder / bytes.Buffer** (amortized O(1) append) |
| Large text with frequent mid-string edits | **Rope** |
| Editor buffer with undo + huge files | **Rope** (or piece table — see `middle.md`) |
| Random read-only indexing dominates | **Flat string** |

---

<a name="walkthrough"></a>
## 8. Step-by-Step Walkthrough on `"Hello_my_name_is_Simon"`

This is the canonical example from the original Boehm–Atkinson–Plass paper. The string is `"Hello_my_name_is_Simon"` (22 characters; underscores stand for spaces so the chunks line up). We split it across leaves:

```
leaves (left to right):
  "Hello_"  "my_na"  "me_i"  "s_"  "Simon"
   len 6      len 5    len 4   len 2  len 5     total = 22
```

### 8.1 The tree with weights

Each internal node's weight = characters in its **left** subtree:

```
                       [• w=11]                      ← root: left subtree = 11 chars
                      /        \
              [• w=6]            [• w=6]
             /      \           /       \
       "Hello_"   [• w=5]    "s_"      "Simon"
      (leaf,6)   /      \   (leaf,2)   (leaf,5)
            "my_na"   "me_i"
            (leaf,5)  (leaf,4)
```

Let us verify the weights:
- The leaf `"Hello_"` has weight 6 (its own length).
- The node above `"my_na"`/`"me_i"` has weight 5 = length of left child `"my_na"`.
- The node above `"Hello_"` and that subtree has weight 6 = length of `"Hello_"`.
- The node above `"s_"`/`"Simon"` has weight 2 = length of `"s_"`.
- The **root** has weight 11 = `"Hello_"` (6) + `"my_na"` (5) = everything in its left subtree.

Total length = root.weight (11) + length(right subtree) = 11 + (2 + 5) = **22.** Correct.

### 8.2 Index: find character at position 10

We want `index(10)`. Position 10 in `"Hello_my_name_is_Simon"` is the second `m` in `"name"` — let us confirm with the descent.

```
start at root, i = 10, weight = 11
  i (10) < weight (11)? YES → go LEFT, i stays 10
node [• w=6], i = 10, weight = 6
  i (10) < weight (6)? NO → go RIGHT, i = 10 - 6 = 4
node [• w=5], i = 4, weight = 5
  i (4) < weight (5)? YES → go LEFT, i stays 4
leaf "my_na", i = 4
  return chunk[4] = 'a'        (m=0, y=1, _=2, n=3, a=4)
```

So `index(10) = 'a'`. Count it out in the original string: `H(0) e(1) l(2) l(3) o(4) _(5) m(6) y(7) _(8) n(9) a(10)` → yes, position 10 is `'a'`. The descent visited **3 internal nodes + 1 leaf**, i.e. O(log n), and never touched the other leaves.

### 8.3 Concat: join `"Hello_my_name_is_Simon"` with `"_says_hi"`

Build rope **B** for `"_says_hi"` (one leaf, length 8). Concatenation makes a new root:

```
              [• w=22]            ← new root: weight = len(A) = 22
             /        \
            A          B
   (the 22-char rope)  "_says_hi" (leaf, 8)
```

No characters were copied. The new total length is 22 + 8 = 30. To read `index(25)`: `25 < 22`? No → go right, `i = 25 - 22 = 3` → leaf `"_says_hi"`, `chunk[3] = 'y'`. (`_=0 s=1 a=2 y=3`.) Correct.

### 8.4 Split: cut the original at position 11

`split(11)` should give left = `"Hello_my_na"` (11 chars) and right = `"me_is_Simon"` (11 chars). Look at the tree from §8.1: position 11 falls exactly on the boundary between the `"my_na"` leaf and the `"me_i"` leaf — a clean cut between siblings. The descent walks root → right? No, `11 < weight 11` is false, so we go right with `i = 0`... and the right subtree starts exactly at `"me_i"`. We collect everything left of the cut into one rope and everything right into another, re-linking O(log n) nodes. (Full split code is in `middle.md`; here we just see it lands on a leaf boundary and needs no character copying.)

### 8.5 Why this beats a flat string

Every one of these operations touched only an O(log n) path. The same edits on the flat 22-char string would each copy up to 22 characters — fine here, catastrophic at 22 million.

---

<a name="code-examples"></a>
## 9. Code Examples — Go, Java, Python

Below is a minimal **immutable** rope supporting `len`, `index`, and `concat`. We keep leaves as plain strings and internal nodes as left/right pairs with a cached weight and total length. (Split/insert/delete and balancing live in `middle.md`.)

### Go

```go
package rope

// Node is either a leaf (left==nil && right==nil, holds chunk)
// or an internal node (chunk=="", has children).
type Node struct {
	left, right *Node
	chunk       string // non-empty only for leaves
	weight      int    // chars in LEFT subtree (leaf: len(chunk))
	length      int    // total chars under this node (cached)
}

// Leaf builds a leaf node from a chunk.
func Leaf(s string) *Node {
	return &Node{chunk: s, weight: len(s), length: len(s)}
}

// Concat joins a and b into a new internal node in O(1).
func Concat(a, b *Node) *Node {
	if a == nil {
		return b
	}
	if b == nil {
		return a
	}
	return &Node{
		left:   a,
		right:  b,
		weight: a.length,          // chars on the left
		length: a.length + b.length,
	}
}

// Len returns the total number of characters (O(1), cached).
func (n *Node) Len() int {
	if n == nil {
		return 0
	}
	return n.length
}

// Index returns the character at position i in O(log n).
func (n *Node) Index(i int) byte {
	for n.right != nil || n.left != nil { // while internal
		if i < n.weight {
			n = n.left
		} else {
			i -= n.weight
			n = n.right
		}
	}
	return n.chunk[i] // we are at a leaf
}
```

### Java

```java
public final class Rope {

    /** A node is a leaf (chunk != null) or internal (left/right set). */
    static final class Node {
        final Node left, right;
        final String chunk;   // non-null only for leaves
        final int weight;     // chars in LEFT subtree (leaf: chunk length)
        final int length;     // total chars under this node (cached)

        private Node(Node l, Node r, String c, int w, int len) {
            left = l; right = r; chunk = c; weight = w; length = len;
        }

        static Node leaf(String s) {
            return new Node(null, null, s, s.length(), s.length());
        }

        static Node concat(Node a, Node b) {
            if (a == null) return b;
            if (b == null) return a;
            return new Node(a, b, null, a.length, a.length + b.length);
        }
    }

    private Node root;

    public Rope(String s) { root = (s.isEmpty()) ? null : Node.leaf(s); }
    private Rope(Node n)  { root = n; }

    public int length() { return root == null ? 0 : root.length; }

    public Rope concat(Rope other) {
        return new Rope(Node.concat(this.root, other.root));
    }

    /** Character at position i, O(log n). */
    public char index(int i) {
        Node n = root;
        while (n.chunk == null) {           // while internal
            if (i < n.weight) {
                n = n.left;
            } else {
                i -= n.weight;
                n = n.right;
            }
        }
        return n.chunk.charAt(i);
    }
}
```

### Python

```python
class Node:
    """Leaf if chunk is not None; else internal with left/right children."""
    __slots__ = ("left", "right", "chunk", "weight", "length")

    def __init__(self, left=None, right=None, chunk=None):
        self.left = left
        self.right = right
        self.chunk = chunk
        if chunk is not None:               # leaf
            self.weight = len(chunk)
            self.length = len(chunk)
        else:                               # internal
            self.weight = left.length        # chars on the left
            self.length = left.length + right.length


def leaf(s: str) -> Node:
    return Node(chunk=s)


def concat(a: Node, b: Node) -> Node:
    if a is None:
        return b
    if b is None:
        return a
    return Node(left=a, right=b)             # weight/length computed in __init__


def rope_len(n: Node) -> int:
    return 0 if n is None else n.length


def index(n: Node, i: int) -> str:
    """Character at position i, O(log n)."""
    while n.chunk is None:                   # while internal
        if i < n.weight:
            n = n.left
        else:
            i -= n.weight
            n = n.right
    return n.chunk[i]                         # at a leaf
```

### Quick test (Python)

```python
# Build "Hello_world" from two leaves and index into it.
r = concat(leaf("Hello_"), leaf("world"))
print(rope_len(r))                 # 11
print("".join(index(r, k) for k in range(rope_len(r))))  # Hello_world
print(index(r, 7))                 # 'o' (the 'o' in world: w=0 o=1 ... wait, position 7)
# positions: H0 e1 l2 l3 o4 _5 w6 o7 r8 l9 d10  -> index 7 = 'o'
```

---

<a name="patterns"></a>
## 10. Coding Patterns — Descend by Weight

Every read-style rope operation is the same loop: **descend by comparing the position to the weight.**

```
def descend(node, i):
    while node is internal:
        if i < node.weight:        # target is on the LEFT
            node = node.left
        else:                      # target is on the RIGHT
            i -= node.weight       # re-base position past the left subtree
            node = node.right
    # node is now the leaf containing position i; local offset is i
    return node, i
```

This spine appears in:
- **`index(i)`** — descend, then return `leaf.chunk[i]`.
- **`split(i)`** — descend, collecting left pieces and right pieces along the path (`middle.md`).
- **`substring(i, j)`** — descend to `i`, then collect leaves left-to-right until you have `j - i` characters.

The mirror operation, **`concat`**, builds *up* instead of down: make a parent with the right weight. Internalize "index/split descend by weight; concat builds a parent" and the rope stops being mysterious.

---

<a name="errors"></a>
## 11. Error Handling

| Error | Cause | Fix |
|---|---|---|
| `IndexOutOfRange` on `chunk[i]` | `i >= length` passed to `index` | Validate `0 <= i < length` before descending. |
| Wrong character returned | Forgot `i -= weight` when going right | Always re-base the position when descending right. |
| Crash on empty rope | `root == nil` and you dereference it | Treat `nil`/`None` as the empty rope of length 0. |
| `concat` loses characters | Weight set to `len(b)` instead of `len(a)` | Weight = **left** subtree length, not right. |
| Stale `length`/`weight` after an edit | Cached fields not updated on mutation | Recompute cached fields bottom-up after every structural change (or stay immutable). |
| O(n) index | Tree degenerated into a spine | Rebalance after heavy concat-only workloads (`middle.md`). |

---

<a name="performance-tips"></a>
## 12. Performance Tips

1. **Cache `length` at every node.** Then `len`, `weight`, and the `concat` weight are all O(1) reads instead of O(log n) recomputations.
2. **Pick a sensible chunk size (8–128 chars).** Too small → huge tree, pointer overhead, bad cache use. Too big → mid-chunk inserts copy more. See `senior.md`.
3. **Use an iterator for full scans.** Do not call `index(i)` in a loop from 0 to n — that is O(n log n). Walk the leaves left-to-right in O(n) instead.
4. **Concatenate short adjacent leaves.** If two neighboring leaves are tiny, merge their chunks into one leaf to keep the tree shallow.
5. **Stay immutable for safety, mutable for raw speed.** Immutable ropes share structure (great for undo); in-place mutable ropes have lower per-edit allocation.
6. **Batch edits.** If you are applying many edits, split once and concat once rather than per-character.

---

<a name="best-practices"></a>
## 13. Best Practices

- **Make internal nodes hold no characters.** Mixing text into internal nodes complicates every invariant. Text lives only at leaves.
- **Define weight precisely: "characters in the left subtree."** Write it in a comment at the top of the file; it is the field everyone misremembers.
- **Always re-base the position when you go right (`i -= weight`).** This single line is responsible for most rope bugs.
- **Keep leaves immutable.** Treat each chunk string as read-only; build new leaves on edit. This makes structure sharing and undo trivial.
- **Choose one balancing strategy and stick to it** (treap priorities, AVL rotations, or periodic rebuild). Mixing strategies invites subtle imbalance.
- **Unit-test against a flat string.** For random operation sequences, a flat `str` is the ground truth oracle; compare every `index`/`substring`.
- **Handle the empty rope as a first-class value** (length 0, `nil` root).

---

<a name="edge-cases"></a>
## 14. Edge Cases

| Case | Input | Expected behavior |
|---|---|---|
| Empty rope | `""` | length 0; `index` always invalid |
| Single leaf | `"abc"` | behaves like a flat string of length 3 |
| Index 0 | `index(0)` | first character |
| Index n−1 | `index(len-1)` | last character |
| Index = length | `index(n)` | out of range → error |
| Concat with empty | `concat(A, empty)` | returns `A` unchanged |
| All leaves length 1 | 1000 one-char leaves | works but may be unbalanced → O(n) index |
| Split at 0 or at n | `split(0)`, `split(n)` | one side is the empty rope |
| Position exactly on a leaf boundary | `index(weight)` | first char of the right subtree |

---

<a name="common-mistakes"></a>
## 15. Common Mistakes

1. **Weight = right subtree instead of left.** The descent breaks completely. Weight is always the **left** subtree's character count.
2. **Forgetting `i -= weight` when going right.** You then index the right subtree with a position that still counts the left characters — off by `weight`.
3. **Putting characters in internal nodes.** Text belongs only at leaves; internal nodes are structure.
4. **Confusing weight with total length.** Weight is just the left side; total length = weight + length(right).
5. **Never rebalancing.** Concat-only workloads build a spine; index degrades to O(n).
6. **Indexing in a loop for a full read.** O(n log n); use a leaf iterator for O(n).
7. **Mutating a shared leaf in place.** Breaks structure sharing and any old versions; build new leaves instead.
8. **Off-by-one at split boundaries.** Decide once whether `split(i)` puts position `i` in the left or right half (convention: left = `[0, i)`, right = `[i, n)`).
9. **Not caching length, then recomputing it inside `concat`.** Turns an O(1) concat into O(n).
10. **Assuming `len(chunk)` equals character count for multibyte text.** For UTF-8, "length" in *runes* differs from *bytes*; decide your unit early (see `senior.md`).

---

<a name="cheat-sheet"></a>
## 16. Cheat Sheet

```
NODE
    leaf:     chunk (string), weight = len(chunk), length = len(chunk)
    internal: left, right, weight = length(left), length = len(left)+len(right)

WEIGHT  = number of characters in the LEFT subtree
LENGTH  = weight + length(right)   (cache it!)

INDEX(node, i)            # O(log n)
    while node is internal:
        if i < node.weight: node = node.left
        else:               i -= node.weight; node = node.right
    return node.chunk[i]

CONCAT(a, b)              # O(1) structural
    new internal node:
        left = a, right = b
        weight = length(a)
        length = length(a) + length(b)

SPLIT(i)   -> (left[0,i), right[i,n))   # O(log n), see middle.md
INSERT(i,s) = let (L,R)=split(i); concat(concat(L, leaf(s)), R)
DELETE(i,j) = let (L,_)=split(i); let (_,R)=split(j); concat(L, R)

COMPLEXITY (balanced)
    index O(log n)   concat O(1)   split O(log n)
    insert/delete O(log n)   substring O(log n + m)
    space O(n)
```

---

<a name="animation"></a>
## 17. Visual Animation Reference

See `animation.html` in this folder. It renders a rope as a binary tree on a dark canvas: internal nodes show their **weight**, leaves show their **chunk** text. Buttons let you **build** a sample rope, run an **index** lookup (watch the descent recolor the path and re-base the position as it goes right), **concat** two ropes (a new root appears with no characters copied), and **split** at a position (the tree separates into two). A side panel narrates each step ("i=10 ≥ weight 6 → go right, i becomes 4"), a Big-O table lists every operation, and a log records the sequence. Run one index lookup and the "descend by weight" pattern becomes permanent.

---

<a name="summary"></a>
## 18. Summary

- A **rope** is a balanced binary tree storing a string as short chunks at its leaves; internal nodes hold no text, only a **weight**.
- **Weight = number of characters in the left subtree.** It lets `index` descend in O(log n): go left if `i < weight`, else go right with `i -= weight`.
- **Concat is O(1)** — just make a parent node; no characters are copied. This is the rope's headline feature.
- Split, insert, and delete are all **O(log n)** (covered in `middle.md`), versus **O(n)** for flat strings.
- The catch: ropes are fast only while **balanced**. Naive concat-only workloads degrade to O(n) and must be rebalanced.
- Ropes trade O(1) random indexing and cache locality (which flat strings have) for cheap mid-string editing — exactly the trade text editors want.

Master leaves, weights, index, and concat here, and `middle.md` will add split/insert/delete and balancing, `senior.md` will build a real editor buffer with undo and collaboration, and `professional.md` will prove the O(log n) bounds and analyze amortized concat and persistence.

---

<a name="further-reading"></a>
## 19. Further Reading

- **Boehm, H.-J., Atkinson, R., Plass, M.**, *"Ropes: An Alternative to Strings"*, Software—Practice & Experience, 25(12), 1995. The original paper; readable and the source of the `"Hello_my_name_is_Simon"` example.
- **SGI STL `rope` documentation** — the production C++ rope class, with chunk-size and balancing notes.
- **CP-Algorithms** — "Treap (implicit key)": `https://cp-algorithms.com/data_structures/treap.html`. A rope's split/merge logic mirrors the implicit treap almost exactly.
- **Cross-links in this Roadmap:** `09-trees/02-bst` (a rope is a BST keyed on position), `09-trees/06-segment-tree` (aggregates over positions), `22-randomized-algorithms/04-treap` (the balancing technique most rope tutorials reach for).
- Continue with `middle.md` for split, insert, delete, balancing, and how ropes compare to gap buffers and piece tables.

**Next step:** [middle.md](middle.md) — split/insert/delete in O(log n), balancing strategies, and rope vs array vs gap buffer vs piece table.
