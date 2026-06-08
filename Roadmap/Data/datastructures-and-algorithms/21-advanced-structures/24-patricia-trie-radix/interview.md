# PATRICIA Trie / Radix Tree — Interview Preparation

> **Audience:** Engineers preparing for technical interviews. Tiered questions (Junior → Middle → Senior → Professional) with focused expected answers, followed by a full coding challenge — a radix tree with insert/search plus longest-prefix match — in Go, Java, and Python.

The radix tree is a high-signal topic: it shows you understand the trie family, memory trade-offs, and the IP-routing problem that drives real systems. Many "trie" interview questions are *better* answered with a radix tree, and senior interviews probe ART and longest-prefix match directly.

---

## Junior Questions (What / How)

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | What is a radix tree / compressed trie? | A trie where chains of single-child nodes are merged into one edge labeled with a string. |
| 2 | How does it differ from a plain trie? | Plain trie: one node per character. Radix tree: one node per branching point; edges carry multi-char labels. |
| 3 | What's the time complexity of search? | O(L), L = key length, independent of number of stored keys. |
| 4 | Why is `isEnd` still needed? | One stored key can be a prefix of another (`roman` / `romane`), so "leaf = key" is wrong. |
| 5 | What does "path compression" mean? | Collapsing a run of single-child nodes into a single string-labeled edge. |
| 6 | Give an example where a radix tree saves memory. | `"international"` is 13 nodes in a plain trie, 1 node (edge label) in a radix tree. |
| 7 | What is `commonPrefixLen` and why does every operation use it? | Longest common prefix of two strings; decides full-match (descend), partial (split/fail), or prefix-of-label. |
| 8 | What is the alphabet / radix? | The branching base: 2 (binary/PATRICIA), 256 (byte-wise), 16 (Ethereum nibbles). |
| 9 | Can a radix tree do prefix queries? | Yes — `startsWith` walks labels; a prefix may end in the middle of an edge and still match. |
| 10 | What operation might insert trigger that search never does? | An **edge split** when the new key diverges mid-edge. |
| 11 | Is the same key inserted twice a problem? | No — idempotent; only the terminal flag matters. |
| 12 | What is the empty-string key's behavior? | Sets `root.isEnd = true`; search/`startsWith` of `""` returns from the root. |

---

## Middle Questions (Why / When)

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | Walk through inserting `romanus` after `romane`. | Split `romane` edge at `roman`; old node keeps `e`, new node `us`, branching node `roman` created. |
| 2 | When does insert split vs. just descend? | Split when `commonPrefixLen < len(edge label)`; descend when the whole label matches. |
| 3 | When the new key is a prefix of an existing edge, what happens? | Split at end of key; mark the **split node** terminal — don't add a child. |
| 4 | What is longest-prefix match and why does it matter? | Find the longest stored key that's a prefix of the query; it routes every IP packet. |
| 5 | How do you implement LPM on a radix tree? | Descend remembering the deepest terminal node passed; return it when you can't follow further. |
| 6 | What is a PATRICIA trie specifically? | Morrison's binary radix tree storing skip-bit indices; one full key compare at the leaf. |
| 7 | Why does PATRICIA need a final full comparison? | Skipped bits are never tested during descent; the leaf compare catches differences in them. |
| 8 | How does delete preserve the structure? | Clear `isEnd`; if a node becomes single-child non-terminal, **merge** its edge into the child. |
| 9 | Radix tree vs. hash table — when each? | Hash table for pure exact-match (smaller/faster); radix tree for prefix/LPM/range/sorted queries. |
| 10 | Radix tree vs. plain trie — the key trade-off? | Radix: O(N) nodes, more complex code (split/merge). Plain: simpler, Θ(total chars) nodes. |
| 11 | What's the node-count bound and why? | ≤ 2N−1: every internal node branches (≥2 children) or is terminal, so internal < leaves ≤ N. |
| 12 | What is a ternary search tree and when over a radix tree? | BST-of-characters hybrid; medium/large alphabet, BST-like memory, accepts O(log Σ) factor. |
| 13 | How would you store edge labels efficiently? | `(offset, length)` slices into the original key bytes, not copied substrings. |
| 14 | What is level compression (LC-trie)? | Replace `k` dense binary levels with one `2^k`-ary node; cuts depth and cache misses. |

---

## Senior Questions (Systems / Scale)

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | How does Linux route IP packets? | `fib_trie` LC-trie: path + level compression, RCU lock-free reads, LPM per packet. |
| 2 | Why not a hash table for the FIB? | LPM needs all prefix lengths; collisions break determinism; prefix updates are natural in a trie. |
| 3 | What is the Adaptive Radix Tree (ART) and where is it used? | Byte-wise radix tree with adaptive node sizes; DuckDB and HyPer main-memory indexes. |
| 4 | Name ART's node types and their fan-out ranges. | Node4 (1–4), Node16 (5–16), Node48 (17–48), Node256 (49–256). |
| 5 | Why does ART use four node types? | Avoid the 2 KB fixed 256-pointer node when fan-out is small; match nodes to cache lines. |
| 6 | How does Node16 do its lookup fast? | SIMD compare of all 16 key bytes against the search byte in one instruction. |
| 7 | How does Node48 save space vs Node256? | 256-byte index map into a 48-slot child array — 4× smaller for low-mid fan-out. |
| 8 | Why does ART beat hash tables for a DB index? | Comparable memory and point-lookup speed, *plus* ordered range scans hash tables can't do. |
| 9 | How is concurrency handled? | RCU (FIB), Optimistic Lock Coupling / ROWEX (ART) — read-optimized, lock-free or retry-based. |
| 10 | What is the DIR-24-8 layout (DPDK)? | Flattened LPM: a 16M-entry array for 24 bits + 8-bit second tables; ≤ 2 memory accesses. |
| 11 | What's a Merkle-Patricia trie? | PATRICIA + per-node hashing; commits state to a root hash with O(L) inclusion proofs (Ethereum). |
| 12 | How do you detect compression drift in production? | Monitor node-count / key-count ratio; deletes without merge inflate it. |

---

## Professional Questions (Proofs / Analysis)

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | Prove search is O(L). | Matched labels tile a prefix of q; Σℓᵢ ≤ |q|; O(1) child lookup per step. |
| 2 | Prove the node count is ≤ 2N−1. | N terminals; every other internal node has degree ≥ 2 ⇒ internal < leaves ≤ N. |
| 3 | Prove insert never creates a single-child non-terminal node. | Split case: split is terminal, or it gains two children; induction on `I_comp`. |
| 4 | Prove longest-prefix match is correct. | Unique descent path for q; stored prefixes = terminals on it; depth monotone ⇒ deepest is longest. |
| 5 | Why is PATRICIA's leaf compare necessary and sufficient? | Skipped bits untested; compare catches them; descent invariant guarantees the right leaf. |
| 6 | Give ART's amortized resize cost. | O(1) amortized: ≤ 3 promotions per node; accounting method charges O(1) per added child. |
| 7 | Prove ART total space is O(N) bytes. | ≤ N−1 inner nodes × O(1) bytes/child × O(N) total edges. |
| 8 | How many cache misses for an ART lookup on dense data? | ≈ O(log₂₅₆ N) — small nodes fit a cache line, path compression shortens height. |
| 9 | Worst-case bytes-per-child across ART node types? | Bounded (~52 B at boundaries) vs unbounded (2048/f) for a fixed 256-node. |
| 10 | When is the 2N−1 bound tight? | N keys diverging at distinct positions: exactly N leaves, N−1 internal nodes. |
| 11 | How does PATRICIA achieve exactly N nodes? | Internal nodes double as leaves via upward back-edges (no separate leaf nodes). |
| 12 | Compare deterministic latency: radix tree vs hash table. | Radix: O(L) worst-case, no tail. Hash: O(1) avg but O(L·n) collision tail. |

---

## Rapid-Fire Conceptual Questions

These are quick "do you really understand it" checks an interviewer mixes in.

| # | Question | One-line answer |
|---|----------|-----------------|
| 1 | Is a radix tree a balanced structure? | No — its shape follows the keys; height is O(L) worst-case, O(log_r N) expected for random keys. |
| 2 | Can a radix tree store values, not just keys? | Yes — attach a value to terminal nodes; it becomes a radix *map* (ART, routers do this). |
| 3 | Does inserting in sorted order help? | Yes for cache/branch-prediction; it does not change correctness or asymptotics. |
| 4 | What's the difference between a radix tree and a B-tree? | Radix branches on key *symbols* (no comparisons); B-tree branches on key *comparisons* with wide nodes for disk. |
| 5 | Why can't a hash table do longest-prefix match? | It only finds exact keys; LPM needs to try every prefix length, which a tree does in one descent. |
| 6 | What makes ART "adaptive"? | Node representation (4/16/48/256) changes with fan-out to fit cache lines and save memory. |
| 7 | Where does the name PATRICIA come from? | "Practical Algorithm To Retrieve Information Coded In Alphanumeric" (Morrison, 1968). |
| 8 | Is the empty string a valid key? | Yes — it marks the root terminal; acts as the default route in LPM/routing. |
| 9 | What invariant must delete restore that insert can't break? | No single-child non-terminal internal node — delete merges to restore it. |
| 10 | Radix r for IPv4 routing vs Ethereum state? | IPv4: r = 2 (PATRICIA, bits). Ethereum: r = 16 (hex nibbles). |
| 11 | What's "compression drift"? | Deleting without merging slowly turns the radix tree back into a plain trie. |
| 12 | How do you make a radix tree concurrent for reads? | Copy-on-write the O(L) modified path + atomic root swap (RCU-style); readers lock-free. |

---

## Debugging Deep-Dive: "My inserted key isn't found"

A frequent interview/live-coding scenario. A candidate inserts `["test", "team"]`, then `search("test")` returns false. Walk the diagnosis:

1. **Check `commonPrefixLen`.** The classic bug: looping `while i <= min(...)` (off-by-one) or comparing the wrong indices. `"test"` and `"team"` share `"te"`; `cpl` must return exactly 2. If it returns 3, the split point is wrong and `"test"`'s suffix becomes corrupted.
2. **Check the split's terminal flag.** After splitting `"test"` at `"te"`, the node spelling `"test"` (now the `"st"` child) must keep `isEnd = true`. If the code moves `isEnd` to the wrong node, `search("test")` lands on a non-terminal node.
3. **Check `search`'s mid-edge handling.** `search` must return false only when an edge *diverges*; if it wrongly returns false when an edge *fully matches but is the last one*, every multi-edge key fails. The condition is `cpl < len(child.label) ⇒ fail`, then consume `cpl` and continue.
4. **Check children keying.** Children keyed by first character must be re-keyed after a split: the old child's first character changed from `'t'` (of `"test"`) to `'s'` (of `"st"`). Forgetting to re-key the split's child under the new first character orphans the subtree.

The fix in 90% of these cases is the split logic. The interviewer is testing whether you can *reason about the invariant* (`labels concatenate to the path`) rather than print-debug blindly.

---

## Coding Challenge (3 Languages)

### Challenge: Radix Tree with Insert, Search, and Longest-Prefix Match

> Implement a byte/character radix tree supporting:
> - `insert(key)` — with correct edge splitting.
> - `search(key)` — exact membership.
> - `longestPrefix(key)` — the longest stored key that is a prefix of `key` (the IP-routing operation).
>
> All operations must be O(L). Children are keyed by the first character of each edge label.
>
> **Example:**
> ```
> insert("10")          // 10.0.0.0/8
> insert("1010")        // 10.10.x.x style longer prefix
> insert("")            // default route
> longestPrefix("10101") -> "1010"
> longestPrefix("1099")  -> "10"
> longestPrefix("9")     -> ""      (default route)
> search("10")           -> true
> search("101")          -> false
> ```

#### Go

```go
package main

import "fmt"

type rnode struct {
	label    string
	children map[byte]*rnode
	isEnd    bool
}

type Radix struct{ root *rnode }

func NewRadix() *Radix { return &Radix{root: &rnode{children: map[byte]*rnode{}}} }

func cpl(a, b string) int {
	n := len(a)
	if len(b) < n {
		n = len(b)
	}
	i := 0
	for i < n && a[i] == b[i] {
		i++
	}
	return i
}

func (t *Radix) Insert(key string) {
	n := t.root
	for {
		if key == "" {
			n.isEnd = true
			return
		}
		child, ok := n.children[key[0]]
		if !ok {
			n.children[key[0]] = &rnode{label: key, isEnd: true, children: map[byte]*rnode{}}
			return
		}
		k := cpl(child.label, key)
		if k == len(child.label) {
			key = key[k:]
			n = child
			continue
		}
		split := &rnode{label: child.label[:k], children: map[byte]*rnode{}}
		child.label = child.label[k:]
		split.children[child.label[0]] = child
		n.children[key[0]] = split
		if k == len(key) {
			split.isEnd = true
		} else {
			rest := key[k:]
			split.children[rest[0]] = &rnode{label: rest, isEnd: true, children: map[byte]*rnode{}}
		}
		return
	}
}

func (t *Radix) Search(key string) bool {
	n := t.root
	for key != "" {
		child, ok := n.children[key[0]]
		if !ok {
			return false
		}
		k := cpl(child.label, key)
		if k < len(child.label) {
			return false
		}
		key = key[k:]
		n = child
	}
	return n.isEnd
}

func (t *Radix) LongestPrefix(key string) (string, bool) {
	n := t.root
	best, ok := "", false
	spelled := ""
	for {
		if n.isEnd {
			best, ok = spelled, true
		}
		if key == "" {
			break
		}
		child, present := n.children[key[0]]
		if !present {
			break
		}
		k := cpl(child.label, key)
		if k < len(child.label) {
			break
		}
		spelled += child.label
		key = key[k:]
		n = child
	}
	return best, ok
}

func main() {
	t := NewRadix()
	for _, k := range []string{"10", "1010", ""} {
		t.Insert(k)
	}
	p, _ := t.LongestPrefix("10101")
	fmt.Printf("%q\n", p) // "1010"
	p, _ = t.LongestPrefix("1099")
	fmt.Printf("%q\n", p) // "10"
	p, _ = t.LongestPrefix("9")
	fmt.Printf("%q\n", p) // ""
	fmt.Println(t.Search("10"))  // true
	fmt.Println(t.Search("101")) // false
}
```

#### Java

```java
import java.util.HashMap;
import java.util.Map;

public class Solution {
    static final class Node {
        String label;
        Map<Character, Node> children = new HashMap<>();
        boolean isEnd;
        Node(String l) { label = l; }
    }

    private final Node root = new Node("");

    static int cpl(String a, String b) {
        int n = Math.min(a.length(), b.length()), i = 0;
        while (i < n && a.charAt(i) == b.charAt(i)) i++;
        return i;
    }

    void insert(String key) {
        Node n = root;
        while (true) {
            if (key.isEmpty()) { n.isEnd = true; return; }
            Node child = n.children.get(key.charAt(0));
            if (child == null) {
                Node leaf = new Node(key); leaf.isEnd = true;
                n.children.put(key.charAt(0), leaf); return;
            }
            int k = cpl(child.label, key);
            if (k == child.label.length()) { key = key.substring(k); n = child; continue; }
            Node split = new Node(child.label.substring(0, k));
            child.label = child.label.substring(k);
            split.children.put(child.label.charAt(0), child);
            n.children.put(key.charAt(0), split);
            if (k == key.length()) split.isEnd = true;
            else {
                String rest = key.substring(k);
                Node leaf = new Node(rest); leaf.isEnd = true;
                split.children.put(rest.charAt(0), leaf);
            }
            return;
        }
    }

    boolean search(String key) {
        Node n = root;
        while (!key.isEmpty()) {
            Node child = n.children.get(key.charAt(0));
            if (child == null) return false;
            int k = cpl(child.label, key);
            if (k < child.label.length()) return false;
            key = key.substring(k); n = child;
        }
        return n.isEnd;
    }

    String longestPrefix(String key) {
        Node n = root; String best = null, spelled = "";
        while (true) {
            if (n.isEnd) best = spelled;
            if (key.isEmpty()) break;
            Node child = n.children.get(key.charAt(0));
            if (child == null) break;
            int k = cpl(child.label, key);
            if (k < child.label.length()) break;
            spelled += child.label; key = key.substring(k); n = child;
        }
        return best;
    }

    public static void main(String[] args) {
        Solution t = new Solution();
        t.insert("10"); t.insert("1010"); t.insert("");
        System.out.println(t.longestPrefix("10101")); // 1010
        System.out.println(t.longestPrefix("1099"));  // 10
        System.out.println(t.longestPrefix("9"));      // (empty string)
        System.out.println(t.search("10"));            // true
        System.out.println(t.search("101"));           // false
    }
}
```

#### Python

```python
class _Node:
    __slots__ = ("label", "children", "is_end")
    def __init__(self, label=""):
        self.label, self.children, self.is_end = label, {}, False


def _cpl(a, b):
    n = min(len(a), len(b)); i = 0
    while i < n and a[i] == b[i]:
        i += 1
    return i


class Radix:
    def __init__(self):
        self.root = _Node("")

    def insert(self, key):
        n = self.root
        while True:
            if key == "":
                n.is_end = True; return
            child = n.children.get(key[0])
            if child is None:
                leaf = _Node(key); leaf.is_end = True
                n.children[key[0]] = leaf; return
            k = _cpl(child.label, key)
            if k == len(child.label):
                key = key[k:]; n = child; continue
            split = _Node(child.label[:k])
            child.label = child.label[k:]
            split.children[child.label[0]] = child
            n.children[key[0]] = split
            if k == len(key):
                split.is_end = True
            else:
                rest = key[k:]
                leaf = _Node(rest); leaf.is_end = True
                split.children[rest[0]] = leaf
            return

    def search(self, key):
        n = self.root
        while key:
            child = n.children.get(key[0])
            if child is None:
                return False
            k = _cpl(child.label, key)
            if k < len(child.label):
                return False
            key = key[k:]; n = child
        return n.is_end

    def longest_prefix(self, key):
        n, best, spelled = self.root, None, ""
        while True:
            if n.is_end:
                best = spelled
            if not key:
                break
            child = n.children.get(key[0])
            if child is None:
                break
            k = _cpl(child.label, key)
            if k < len(child.label):
                break
            spelled += child.label; key = key[k:]; n = child
        return best


if __name__ == "__main__":
    t = Radix()
    for k in ["10", "1010", ""]:
        t.insert(k)
    print(repr(t.longest_prefix("10101")))  # '1010'
    print(repr(t.longest_prefix("1099")))   # '10'
    print(repr(t.longest_prefix("9")))      # ''
    print(t.search("10"))                   # True
    print(t.search("101"))                  # False
```

**Complexity:** every operation is O(L) where L is the key length; the tree has ≤ 2N−1 nodes. Longest-prefix match is the exact operation an IP router runs per packet.

### Follow-ups the interviewer may ask

- **Add delete with merge.** Clear `isEnd`; if a node becomes single-child non-terminal, fuse its label into the child. (Covered in `tasks.md`.)
- **Make it a binary PATRICIA over fixed-width keys.** Switch the alphabet to bits and add skip-bit indices with a final full compare.
- **Convert LPM to true IP routing.** Encode CIDR prefixes as bitstrings of their significant bits and store next-hops at terminals.
- **Make it concurrent.** Discuss RCU or Optimistic Lock Coupling for read-mostly workloads.

---

## Bonus Challenge: Count Nodes and Verify Compression

> Extend the radix tree with `nodeCount()` and a check that the structure respects the `≤ 2N − 1` bound. This is a common follow-up to confirm you understand *why* the radix tree saves memory, not just *that* it does.

#### Python

```python
def node_count(node):
    return 1 + sum(node_count(c) for c in node.children.values())


def key_count(node):
    return (1 if node.is_end else 0) + sum(key_count(c) for c in node.children.values())


def verify_bound(tree):
    n = key_count(tree.root)
    nodes = node_count(tree.root)
    # root is counted; for N >= 1 keys the bound is nodes <= 2N (root + 2N-1)
    assert nodes <= 2 * n + 1, f"compression violated: {nodes} nodes for {n} keys"
    return nodes, n


t = Radix()
for w in ["romane", "romanus", "romulus", "rubens", "ruber", "rubicon", "rubicundus"]:
    t.insert(w)
nodes, n = verify_bound(t)
print(f"{n} keys -> {nodes} nodes (bound 2N-1 = {2*n - 1})")
# 7 keys -> 13 nodes (bound 2N-1 = 13)  -- tight!
```

#### Go

```go
func nodeCount(n *rnode) int {
	c := 1
	for _, ch := range n.children {
		c += nodeCount(ch)
	}
	return c
}

func keyCount(n *rnode) int {
	c := 0
	if n.isEnd {
		c = 1
	}
	for _, ch := range n.children {
		c += keyCount(ch)
	}
	return c
}
```

**Why interviewers ask this:** the answer reveals whether you understand that the radix tree's win is **node count O(N)**, not faster per-operation time (search is O(L) for both plain and compressed tries). The tight `13 = 2×7 − 1` on this dataset is the proof in miniature — every internal node is a genuine branching point.

The deeper follow-up: *"What would the plain trie's node count be?"* Answer: roughly the number of distinct characters along all paths (~34 here), so the compression ratio is ~2.6× on this tiny set and grows with key length — the motivation for the whole structure.

---

## Interview Strategy

When you see a problem involving **strings or bitstrings** plus any of:

- "most specific match" / "longest matching prefix" / "routing"
- "memory-efficient prefix lookup" / "dictionary that's too big as a plain trie"
- "in-memory index with range scans"
- "CIDR" / "IP forwarding" / "autocomplete with tight memory"

reach for a **radix tree** (or its binary PATRICIA form). If the interviewer says "trie" but the keys are long with little branching, propose the compressed variant and explain the O(N) node win.

---

## Further Reading

- **Morrison (1968)** — the original PATRICIA paper.
- **Leis, Kemper, Neumann (2013)** — "The Adaptive Radix Tree", ICDE.
- **Nilsson & Karlsson (1999)** — "IP-Address Lookup Using LC-Tries", IEEE JSAC.
- The plain-trie interview set this builds on: [`09-trees/05-trie/interview.md`](../../09-trees/05-trie/interview.md) (esp. LC 208, 211, 648 — many are cleaner with a radix tree).
- Continue with [`tasks.md`](./tasks.md) for hands-on implementation exercises.
