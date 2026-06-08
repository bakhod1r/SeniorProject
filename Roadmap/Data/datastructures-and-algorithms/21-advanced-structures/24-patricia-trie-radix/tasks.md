# PATRICIA Trie / Radix Tree — Hands-On Tasks

> **Audience:** Engineers who learn by building. Each task is a self-contained exercise. Implement first, then compare against the reference solution. Tasks scale from "first radix tree" through "edge splitting", "longest-prefix match", "delete with merge", up to a "binary PATRICIA / IP router" and "Adaptive Radix Tree node types".
>
> All tasks should be solved in **Go**, **Java**, and **Python**. Reference solutions are given in one or two languages — port the rest yourself.

---

## Beginner Tasks

### Task 1 — Minimal radix tree: insert + search

**Goal:** Implement `insert(key)` and `search(key)` for a character radix tree with map children keyed by the first character of each edge label. Handle the edge split on insert. Fail by returning false, never crashing.

- **Constraints:** O(L) per operation. Test with `["test", "team", "toast"]`, then search `"te"` (false), `"test"` (true), `"toaster"` (false).
- **Expected:** `search` returns true only for exactly-inserted keys.
- **Evaluation:** correct split logic; `commonPrefixLen` off-by-one free.

#### Go (reference)

```go
package radix

type node struct {
	label    string
	children map[byte]*node
	isEnd    bool
}

type Tree struct{ root *node }

func New() *Tree { return &Tree{root: &node{children: map[byte]*node{}}} }

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

func (t *Tree) Insert(key string) {
	n := t.root
	for {
		if key == "" {
			n.isEnd = true
			return
		}
		c, ok := n.children[key[0]]
		if !ok {
			n.children[key[0]] = &node{label: key, isEnd: true, children: map[byte]*node{}}
			return
		}
		k := cpl(c.label, key)
		if k == len(c.label) {
			key, n = key[k:], c
			continue
		}
		s := &node{label: c.label[:k], children: map[byte]*node{}}
		c.label = c.label[k:]
		s.children[c.label[0]] = c
		n.children[key[0]] = s
		if k == len(key) {
			s.isEnd = true
		} else {
			r := key[k:]
			s.children[r[0]] = &node{label: r, isEnd: true, children: map[byte]*node{}}
		}
		return
	}
}

func (t *Tree) Search(key string) bool {
	n := t.root
	for key != "" {
		c, ok := n.children[key[0]]
		if !ok || cpl(c.label, key) < len(c.label) {
			return false
		}
		key, n = key[cpl(c.label, key):], c
	}
	return n.isEnd
}
```

---

### Task 2 — `startsWith` (prefix query, may end mid-edge)

**Goal:** Add `startsWith(prefix)` returning true if `prefix` is a prefix of any stored key. The prefix may end **inside** an edge label and still count.

- **Constraints:** O(L). After inserting `["rubicon"]`, `startsWith("rubic")` must return true even though no node spells exactly `"rubic"`.
- **Evaluation:** the `cp == len(prefix)` mid-edge case is handled.

#### Python (reference)

```python
def starts_with(tree, prefix):
    n = tree.root
    while prefix:
        child = n.children.get(prefix[0])
        if child is None:
            return False
        k = _cpl(child.label, prefix)
        if k == len(prefix):
            return True            # consumed, possibly mid-edge
        if k < len(child.label):
            return False
        prefix = prefix[k:]
        n = child
    return True
```

---

### Task 3 — Enumerate all keys with a given prefix (sorted)

**Goal:** Implement `keysWithPrefix(prefix) -> []string`, returning every stored key starting with `prefix`, in lexicographic order. Walk to the prefix node (possibly mid-edge), then DFS in label order collecting terminals.

- **Constraints:** O(L + answer size). Children of each node are visited in sorted first-character order.
- **Expected:** `["app", "apple", "apply"]` for prefix `"app"`.

#### Python (reference)

```python
def keys_with_prefix(tree, prefix):
    n, consumed, rest = tree.root, "", prefix
    while rest:
        child = n.children.get(rest[0])
        if child is None:
            return []
        k = _cpl(child.label, rest)
        if k == len(rest):
            consumed += child.label; n = child; break
        if k < len(child.label):
            return []
        consumed += child.label; rest = rest[k:]; n = child
    out = []
    def dfs(node, path):
        if node.is_end:
            out.append(path)
        for ch in sorted(node.children):
            c = node.children[ch]
            dfs(c, path + c.label)
    dfs(n, consumed)
    return out
```

---

### Task 4 — Count nodes vs. plain-trie nodes (measure compression)

**Goal:** Implement `nodeCount()` (radix-tree nodes) and `plainTrieNodeCount()` (total characters + 1 = what a plain trie would use). Print the compression ratio after inserting a word list.

- **Constraints:** O(total nodes). Use the dictionary `["romane","romanus","romulus","rubens","ruber","rubicon","rubicundus"]`.
- **Expected:** radix ~13 nodes; plain-trie ~ sum of lengths + branching ≈ 50+; ratio ≈ 4×.
- **Evaluation:** confirms the O(N)-vs-Θ(total chars) story empirically.

#### Go (reference)

```go
func (t *Tree) NodeCount() int { return count(t.root) }
func count(n *node) int {
	c := 1
	for _, ch := range n.children {
		c += count(ch)
	}
	return c
}

// Plain trie would use 1 node per character + root.
func (t *Tree) PlainTrieNodeCount() int { return chars(t.root) + 1 }
func chars(n *node) int {
	total := 0
	for _, ch := range n.children {
		total += len(ch.label) + chars(ch)
	}
	return total
}
```

---

### Task 5 — Longest-prefix match

**Goal:** Implement `longestPrefix(key) -> (string, bool)`: the longest stored key that is a prefix of `key`. This is the IP-routing operation.

- **Constraints:** O(L). Insert `["", "10", "1010"]`; `longestPrefix("10101")` → `"1010"`; `longestPrefix("9")` → `""` (default route).
- **Evaluation:** remembers the **deepest terminal** seen during descent.

#### Python (reference)

```python
def longest_prefix(tree, key):
    n, best, spelled = tree.root, None, ""
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
```

---

## Intermediate Tasks

### Task 6 — Delete with merge

**Goal:** Implement `delete(key) -> bool`. Clear `isEnd`; if the node becomes a non-terminal leaf, detach it; if it becomes a single-child non-terminal node, **merge** its label into its child. Maintain the no-single-child-internal-node invariant.

- **Constraints:** O(L). Insert `["roman","romane","romanus"]`, delete `"romanus"`; the `roman` node should remain (it's terminal). Then delete `"roman"`; now `roman` becomes single-child non-terminal and must merge into `romane`.
- **Evaluation:** after deletions, node count equals a freshly built tree of the remaining keys.

#### Go (reference)

```go
func (t *Tree) Delete(key string) bool { return del(t.root, key) }

func del(n *node, key string) bool {
	if key == "" {
		if !n.isEnd {
			return false
		}
		n.isEnd = false
		return true
	}
	c, ok := n.children[key[0]]
	if !ok {
		return false
	}
	k := cpl(c.label, key)
	if k < len(c.label) || !del(c, key[k:]) {
		return false
	}
	if len(c.children) == 0 && !c.isEnd {
		delete(n.children, key[0])
	} else if len(c.children) == 1 && !c.isEnd {
		var only *node
		for _, g := range c.children {
			only = g
		}
		only.label = c.label + only.label
		n.children[key[0]] = only
	}
	return true
}
```

---

### Task 7 — IP longest-prefix-match router (CIDR)

**Goal:** Build a router. `addRoute(prefix, prefixLen, nextHop)` inserts a CIDR route; `lookup(ipv4) -> nextHop` does longest-prefix match. Convert each prefix to a bitstring of its `prefixLen` significant bits and store `nextHop` at the terminal.

- **Constraints:** O(32) per lookup. Add `0.0.0.0/0 → "default"`, `10.0.0.0/8 → "A"`, `10.1.0.0/16 → "B"`. Lookup `10.1.2.3` → `"B"`; `10.9.9.9` → `"A"`; `8.8.8.8` → `"default"`.
- **Evaluation:** correct most-specific selection; default route works.

#### Python (reference)

```python
def ip_to_bits(ip):
    parts = [int(p) for p in ip.split(".")]
    val = (parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]
    return format(val, "032b")

class Router:
    def __init__(self):
        self.tree = Radix()        # value-carrying radix over '0'/'1'
        self.hop = {}              # bitstring prefix -> next hop

    def add_route(self, ip, plen, nexthop):
        bits = ip_to_bits(ip)[:plen]
        self.tree.insert(bits)
        self.hop[bits] = nexthop

    def lookup(self, ip):
        bits = ip_to_bits(ip)
        best = longest_prefix(self.tree, bits)   # from Task 5
        return self.hop.get(best) if best is not None else None
```

---

### Task 8 — Value-carrying radix map

**Goal:** Turn the set into a map: `put(key, value)` and `get(key)`. Store the value at terminal nodes; re-`put` overwrites. Ensure splits carry values correctly (the value belongs to the node that was terminal, not the new split node).

- **Constraints:** O(L). `put("car",1); put("card",2); put("car",9)` → `get("car")==9`, `get("card")==2`, `get("ca")==None`.
- **Evaluation:** value survives an edge split that happens *after* the key was inserted (insert `"card"` after `"car"` and confirm `"car"`'s value is intact).

---

### Task 9 — Serialize and load a radix tree

**Goal:** Implement `serialize() -> bytes` and `load(bytes)` so a built tree can be persisted and reloaded without rebuilding (the static/`mmap` pattern from `senior.md`). A pre-order encoding of `(label, isEnd, childCount)` per node suffices.

- **Constraints:** load is O(total nodes), no per-key insertion. Round-trip must preserve `search` and `longestPrefix` results.
- **Evaluation:** `load(serialize(t))` answers identically to `t` on a random query set.

---

### Task 10 — Property test against a reference set

**Goal:** Write a randomized test: generate random keys, mirror every `insert`/`delete`/`search` against a language `set`/`map`, and assert the radix tree agrees after each operation. Also assert `nodeCount() <= 2*size - 1` and the no-single-child invariant.

- **Constraints:** thousands of random ops over a small alphabet (forces many splits/merges).
- **Evaluation:** any divergence is a bug in split or merge — exactly where radix-tree bugs hide.

#### Python (reference harness)

```python
import random, string

def invariant_ok(node, is_root=False):
    # no single-child non-terminal internal node (root exempt)
    if not is_root and not node.is_end and len(node.children) == 1:
        return False
    return all(invariant_ok(c) for c in node.children.values())

def fuzz():
    ref = set()
    t = Radix()
    alpha = "ab"
    for _ in range(5000):
        k = "".join(random.choice(alpha) for _ in range(random.randint(0, 6)))
        if random.random() < 0.6:
            t.insert(k); ref.add(k)
        else:
            delete(t, k); ref.discard(k)   # from Task 6
        assert t.search(k) == (k in ref)
        assert invariant_ok(t.root, is_root=True)
    print("fuzz OK")
```

---

## Advanced Tasks

### Task 11 — Binary PATRICIA with skip bits

**Goal:** Implement a true PATRICIA trie over fixed-width bitstring keys (e.g., 32-bit ints). Each node stores a `bit` index; descent uses upward back-edges and stops when `node.bit <= prev.bit`; confirm with one full key comparison at the leaf.

- **Constraints:** O(W) per op (W = key width). N keys ⇒ exactly N nodes.
- **Evaluation:** matches a reference set on insert/search; node count == key count.

---

### Task 12 — Adaptive Radix Tree node types

**Goal:** Implement the four ART inner-node types — Node4, Node16, Node48, Node256 — with `findChild(byte)`, `addChild(byte, child)`, and automatic **grow** at the thresholds (4→16→48→256) and **shrink** on deletion. Use a linear scan for Node4, sorted-array (or SIMD-style) for Node16, the 256-byte index map for Node48, and direct indexing for Node256.

- **Constraints:** O(1) amortized grow/shrink; correct `findChild` for every type.
- **Evaluation:** insert a key distribution that forces a node through all four types; verify lookups stay correct across every transition.

#### Java (Node4 / Node48 sketch)

```java
abstract class ArtNode {
    abstract ArtNode findChild(byte k);
    abstract ArtNode addChild(byte k, ArtNode child);  // may return a grown node
}

final class Node4 extends ArtNode {
    byte[] keys = new byte[4];
    ArtNode[] children = new ArtNode[4];
    int count;
    ArtNode findChild(byte k) {
        for (int i = 0; i < count; i++) if (keys[i] == k) return children[i];
        return null;
    }
    ArtNode addChild(byte k, ArtNode child) {
        if (count < 4) { keys[count] = k; children[count] = child; count++; return this; }
        Node16 grown = new Node16();
        for (int i = 0; i < 4; i++) grown.addChild(keys[i], children[i]);
        return grown.addChild(k, child);
    }
}

final class Node48 extends ArtNode {
    byte[] childIndex = new byte[256];   // 0 = empty, else 1-based slot
    ArtNode[] children = new ArtNode[48];
    int count;
    Node48() { java.util.Arrays.fill(childIndex, (byte) 0); }
    ArtNode findChild(byte k) {
        int idx = childIndex[k & 0xFF] & 0xFF;
        return idx == 0 ? null : children[idx - 1];
    }
    ArtNode addChild(byte k, ArtNode child) {
        if (count < 48) {
            children[count] = child;
            childIndex[k & 0xFF] = (byte) (count + 1);
            count++; return this;
        }
        Node256 grown = new Node256();
        for (int b = 0; b < 256; b++) {
            int idx = childIndex[b] & 0xFF;
            if (idx != 0) grown.addChild((byte) b, children[idx - 1]);
        }
        return grown.addChild(k, child);
    }
}
```

---

### Task 13 — Merkle-Patricia trie (authenticated)

**Goal:** Augment the radix tree so each node carries `hash = H(label ‖ isEnd ‖ sorted child hashes)`. Expose `rootHash()` and `prove(key) -> path` (the sibling hashes along the root-to-key path) plus a `verify(key, value, proof, rootHash)` function.

- **Constraints:** lookups O(L); proofs O(L) hashes. Changing any value changes the root hash.
- **Evaluation:** a valid proof verifies; tampering with any node in the proof fails verification. This mirrors Ethereum's state trie.

---

### Task 14 — Edge labels as zero-copy slices

**Goal:** Re-implement the radix tree storing edge labels as `(keyId, start, end)` slices into an arena of original key bytes, instead of copied substrings. Splitting must re-slice without copying.

- **Constraints:** no per-edge string allocation. Measure memory vs. the substring version on 100k keys.
- **Evaluation:** identical query results; materially lower memory (report the delta).

---

### Task 15 — Concurrent reads with RCU-style updates

**Goal:** Make the tree safe for many concurrent readers and one writer using copy-on-write at the modified path (publish a new root atomically; readers see a consistent snapshot). Readers take no locks.

- **Constraints:** readers never block; a writer touches only the O(L) modified path and swaps the root pointer atomically.
- **Evaluation:** stress test with N reader threads + 1 writer; assert no reader ever observes a torn/intermediate tree.

---

## Benchmark Task

> Compare radix-tree build and lookup performance across all 3 languages, and against a hash set, on a prefix-heavy key set.

#### Go

```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

func randKey() string {
	b := make([]byte, 12)
	for i := range b {
		b[i] = byte('a' + rand.Intn(8))
	}
	return string(b)
}

func main() {
	sizes := []int{1000, 10000, 100000}
	for _, n := range sizes {
		keys := make([]string, n)
		for i := range keys {
			keys[i] = randKey()
		}
		t := New()
		start := time.Now()
		for _, k := range keys {
			t.Insert(k)
		}
		build := time.Since(start)
		q := keys[:min(1000, n)]
		start = time.Now()
		for i := 0; i < 50; i++ {
			for _, k := range q {
				t.Search(k)
			}
		}
		look := time.Since(start)
		fmt.Printf("n=%7d build=%6.1fms lookup=%6.3fus/op\n",
			n, float64(build.Milliseconds()),
			float64(look.Nanoseconds())/float64(50*len(q))/1000)
	}
}

func min(a, b int) int { if a < b { return a }; return b }
```

#### Java

```java
import java.util.*;

public class Bench {
    static String randKey(Random r) {
        char[] c = new char[12];
        for (int i = 0; i < 12; i++) c[i] = (char) ('a' + r.nextInt(8));
        return new String(c);
    }
    public static void main(String[] args) {
        Random r = new Random(1);
        for (int n : new int[]{1000, 10000, 100000}) {
            String[] keys = new String[n];
            for (int i = 0; i < n; i++) keys[i] = randKey(r);
            Solution t = new Solution();           // radix tree from interview.md
            long s = System.nanoTime();
            for (String k : keys) t.insert(k);
            long build = System.nanoTime() - s;
            int qn = Math.min(1000, n);
            s = System.nanoTime();
            for (int it = 0; it < 50; it++)
                for (int i = 0; i < qn; i++) t.search(keys[i]);
            long look = System.nanoTime() - s;
            System.out.printf("n=%7d build=%6.1fms lookup=%6.3fus/op%n",
                n, build / 1e6, look / 1e3 / (50.0 * qn));
        }
    }
}
```

#### Python

```python
import random, timeit, string

def rand_key():
    return "".join(random.choice("abcdefgh") for _ in range(12))

for n in (1_000, 10_000, 100_000):
    keys = [rand_key() for _ in range(n)]
    t = Radix()
    build = timeit.timeit(lambda: [t.insert(k) for k in keys], number=1)
    q = keys[: min(1000, n)]
    look = timeit.timeit(lambda: [t.search(k) for k in q], number=50)
    print(f"n={n:>7} build={build*1000:6.1f}ms "
          f"lookup={look/(50*len(q))*1e6:6.3f}us/op")
```

> **Expected shape:** lookup time per op stays roughly flat as `n` grows tenfold (the O(L) property). A hash set will usually beat the radix tree on pure exact-match — the radix tree's value is prefix/LPM/range queries, which the hash set cannot do at all.
