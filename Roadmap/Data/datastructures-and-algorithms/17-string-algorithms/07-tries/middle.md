# Tries (Prefix Trees) for String Processing — Middle Level

> **One-line summary:** Once you know the basic trie, the next layer is making it *useful at scale*: prefix counting with a per-node counter, **ranked** autocomplete (top-k by frequency), the **compressed / radix trie** that merges single-child chains, the **ternary search trie** (a space-saving hybrid), the array-vs-map children trade-off, sorting strings by trie traversal, and a clear-eyed comparison with hash sets.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prefix Counting and Frequency](#prefix-counting-and-frequency)
3. [Autocomplete Ranking (Top-k)](#autocomplete-ranking-top-k)
4. [The Compressed / Radix Trie](#the-compressed--radix-trie)
5. [Ternary Search Tries](#ternary-search-tries)
6. [Array vs Map Children](#array-vs-map-children)
7. [Sorting Strings via a Trie](#sorting-strings-via-a-trie)
8. [Tries vs Hash Sets](#tries-vs-hash-sets)
9. [Deletion Done Right](#deletion-done-right)
10. [Code Examples](#code-examples)
11. [Coding Patterns](#coding-patterns)
12. [Performance Tips](#performance-tips)
13. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
14. [Common Mistakes](#common-mistakes)
15. [Cheat Sheet](#cheat-sheet)
16. [Visual Animation](#visual-animation)
17. [Summary](#summary)
18. [Further Reading](#further-reading)

---

## Introduction

The junior file gave you a working trie with `insert`, `search`, `startsWith`, and a basic autocomplete. That is enough to pass a "Implement Trie" interview question, but a production autocomplete feature needs more: it must rank suggestions (you do not want `cat` before `category` in random order — you want the most *popular* words first), it must not waste memory on millions of keys, and it must answer "how many words start with this prefix?" in `O(L)` rather than re-walking the whole subtree.

This middle layer is about those refinements. We add a **prefix counter** so prefix-count queries are `O(L)`. We make autocomplete **ranked** by frequency (top-k with a heap). We introduce the **compressed / radix trie**, which collapses long single-child chains (`i → n → t → e → r` for `internationalization`) into a single labeled edge, dramatically cutting node count for real dictionaries — the full data-structure treatment is in `21-advanced-structures/24-25`, so here we explain the idea and when to reach for it. We meet the **ternary search trie (TST)**, a clever middle ground between a trie and a BST. We weigh **array vs map** children quantitatively. We show that a single pre-order DFS sorts strings. And we put the trie head-to-head with the hash set so you know exactly when each wins.

The throughline: a plain trie is simple but memory-hungry and unranked; each refinement trades a little complexity for a lot of practicality. Choose based on your alphabet size, key overlap, and query mix.

---

## Prefix Counting and Frequency

Add two integer fields to each node:

- **`passCount`** — how many inserted keys pass *through* this node (incremented for every character of every insert). Reading `walk(prefix).passCount` answers "how many keys start with `prefix`" in `O(L)`.
- **`wordCount`** — how many times the *exact* word ending at this node was inserted. Supports duplicates and frequency-based ranking.

```
insert(word):
    cur = root
    for ch in word:
        cur = cur.children.get_or_create(ch)
        cur.passCount += 1          # every node on the path
    cur.wordCount += 1
    cur.isEnd = true                # isEnd is just wordCount > 0
```

Now:

- `countPrefix(p)` = `walk(p).passCount` (0 if the path breaks). **`O(L)`, no DFS.**
- `countWord(w)` = `walk(w).wordCount`.
- `erase(w)` decrements both counters along the path (see deletion below).

The `passCount` field is the single most useful upgrade to a basic trie: it turns the common "how many products start with `app`" query from an `O(subtree)` DFS into an `O(L)` read.

---

## Autocomplete Ranking (Top-k)

Real autocomplete does not return all completions in lexicographic order; it returns the **most relevant few** — usually the highest-frequency words. Store a frequency (the `wordCount` above, or a search-popularity score) at each end-of-word node. To produce the top-k suggestions for a prefix:

1. `walk(prefix)` to the prefix node (`O(L)`).
2. DFS the subtree, collecting `(word, frequency)` pairs for every `isEnd` node.
3. Select the top-k by frequency — a size-k min-heap gives `O(S log k)` where `S` is the subtree's word count, beating a full sort `O(S log S)`.

```
topK(prefix, k):
    node = walk(prefix); if node == null: return []
    heap = min-heap of size k by frequency
    dfs(node, prefix):
        if node.isEnd: heap.offer((freq, word)); if heap.size > k: heap.poll()
        for child: dfs(child, ...)
    return heap drained, highest first
```

**Faster variant — store top-k at each node.** For latency-critical typeahead (Google-scale), precompute and cache the top-k completions *at every node* at build time. Then a query is just `walk(prefix)` + read the cached list — `O(L + k)`, no DFS at query time. The cost is extra memory and a rebuild when frequencies change; this is the classic time/space trade-off behind production typeahead.

---

## The Compressed / Radix Trie

A plain trie wastes nodes on long non-branching chains. The word `internationalization` becomes ~20 single-child nodes, each holding a whole children map for one child. A **compressed trie** (a.k.a. **radix trie**, **PATRICIA trie**, **radix tree**) fixes this by **merging every chain of single-child nodes into one edge labeled with a substring**.

```
Plain trie for {"team", "tea", "ten"}:        Radix trie:
  t-e-a-m*                                       t
       \-(a is end: tea*)                        └─ "te"
  t-e-n*                                             ├─ "a"*   (and "a"->"m"* )
                                                     └─ "n"*
```

Edges now carry strings, not single characters. Search walks edge-by-edge, matching the query against each edge's label; a branch is created mid-edge (an "edge split") when a new key diverges partway through a label.

| Property | Plain trie | Radix / compressed trie |
|----------|-----------|--------------------------|
| Edge label | one character | a substring |
| Node count | up to `m` (total chars) | `O(n)` — bounded by number of keys (proof in `professional.md`) |
| Best for | dense, short, overlapping keys | long sparse keys, large dictionaries, routing tables |
| Complexity | a bit more code (edge splits) | search still `O(L)` |

Use a radix trie when keys are long and branching is sparse (URLs, file paths, IP prefixes, dictionary words). The detailed implementation — edge splitting, merging, the Patricia bit-trie variant — lives in **`21-advanced-structures/24-25`**; treat this section as the motivation and pointer.

---

## Ternary Search Tries

A **ternary search trie (TST)** stores each node with a character and **three** children: `left` (next char is smaller), `mid` (next char matches — advance the query), and `right` (next char is larger). It is a hybrid of a trie (the `mid` pointer advances the string) and a BST (the `left`/`right` pointers search among sibling characters).

```
TST node: { char c; bool isEnd; node left, mid, right; value }
search: compare query char to c → go left/right (same query position) or mid (next query position)
```

| | Array trie | Map trie | TST |
|--|-----------|----------|-----|
| Memory per node | Σ pointers (wasteful) | hash entries | 3 pointers + 1 char (compact) |
| Lookup per char | O(1) index | O(1) hash | O(log Σ) BST step |
| Alphabet | small only | any | any |
| Sorted output | yes | needs sort | yes (in-order) |

TSTs shine for large alphabets where an array would waste space but a hash map's per-entry overhead is unwelcome — they get trie-like search speed with BST-like memory. Sedgewick champions them for string symbol tables. Full treatment: **`21-advanced-structures/24`**.

---

## Array vs Map Children

This is the central memory/speed knob of a trie.

**Array children** — `node.children = [Σ]*node`, indexed `children[ch - base]`:

- Pro: O(1) child lookup with a single array index, excellent cache behavior, no hashing.
- Con: every node allocates Σ pointers regardless of how many it uses. For Σ=26 and millions of mostly-one-child nodes, that is ~26× pointer waste. For Σ=256 (bytes) or Unicode it is catastrophic.

**Map children** — `node.children = map[char]node`:

- Pro: stores only the children that exist; supports any alphabet including full Unicode.
- Con: per-entry hash overhead (load factor, buckets), worse cache locality, slightly slower lookups.

Rule of thumb:

| Situation | Choose |
|-----------|--------|
| Lowercase a–z, performance-critical, dense | array[26] |
| Bytes (Σ=256), mostly sparse nodes | map, or a hybrid |
| Unicode / arbitrary characters | map |
| Huge dictionary, memory-bound | radix trie or TST or DAWG (see senior) |
| A few thousand short keys, simplicity matters | map (less code, fine perf) |

Hybrids exist: small nodes use a list/array of pairs, large nodes promote to a map (the "array-mapped trie" idea). The senior file covers double-array tries and DAWGs for extreme cases.

---

## Sorting Strings via a Trie

Insert all `n` strings into a trie, then do a **pre-order DFS visiting children in alphabetical order**. Every `isEnd` node you reach, in visitation order, yields the keys in **lexicographic order**.

```
sortedKeys():
    out = []
    dfs(root, "")
    return out
dfs(node, path):
    if node.isEnd: out.append(path)   # repeat wordCount times for duplicates
    for ch in sorted(node.children):  # ascending edge labels
        dfs(node.children[ch], path + ch)
```

Cost is `O(m)` where `m` is the total number of characters (each node visited once), plus the cost of ordering children (free with an array, `O(Σ log Σ)` per node with a map). This is essentially a **most-significant-digit radix sort** of the strings, and it deduplicates for free (unless you replay `wordCount`). The correctness proof — that pre-order with sorted edges equals lexicographic order — is in `professional.md`.

---

## Tries vs Hash Sets

| Capability | Hash set | Trie |
|-----------|----------|------|
| Exact membership | `O(L)` avg (hash the key) | `O(L)` worst case |
| `startsWith` / prefix queries | **impossible** (hashing destroys prefixes) | `O(L)` |
| Prefix count | impossible | `O(L)` with `passCount` |
| Autocomplete | scan all keys `O(n·L)` | `O(L + subtree)` |
| Sorted iteration | needs full sort `O(n log n)` | `O(m)` pre-order DFS |
| Worst-case lookup | `O(n)` on bad collisions | `O(L)` always |
| Memory (overlapping keys) | one slot per key | shared prefixes save space |
| Memory (disjoint keys) | compact | many nodes, can be larger |
| Cache locality | excellent (flat array) | poor (scattered nodes) |

**Decision:** if you only ever do exact membership, use a hash set — it is simpler and usually faster in practice. The moment you need *any* prefix operation — `startsWith`, prefix count, autocomplete, longest-prefix-match, sorted output — the trie is the right tool, and a hash set cannot do it at all.

---

## Deletion Done Right

Deletion is where naive tries break. To erase `car` from a trie that also holds `card`, you must **not** delete the `c`/`a`/`r` nodes, because `card` still passes through them.

Correct algorithm:

1. Walk to the end node; if it is not `isEnd`, the word is absent — stop.
2. Clear `isEnd` (or decrement `wordCount`). Decrement `passCount` along the path.
3. On the way back up, delete a node **only if** it has no children **and** is not itself an end-of-word.

```
delete(word):
    walk down, pushing nodes on a stack; if path breaks or not isEnd: return false
    end.wordCount -= 1
    if end.wordCount == 0: end.isEnd = false
    for node from end up to root:
        node.passCount -= 1
        if node has no children and not node.isEnd and node != root:
            remove node from its parent
        else:
            break   # someone still needs this node
    return true
```

The `passCount` field doubles as a safety check: a node with `passCount > 0` after the decrement still serves other keys and must survive.

---

## Code Examples

### Example: Trie with prefix counting and ranked autocomplete

#### Go

```go
package main

import (
	"container/heap"
	"fmt"
)

type Node struct {
	children  map[byte]*Node
	pass      int // keys passing through
	freq      int // exact-word frequency (end-of-word if > 0)
}

func newNode() *Node { return &Node{children: make(map[byte]*Node)} }

type Trie struct{ root *Node }

func New() *Trie { return &Trie{root: newNode()} }

func (t *Trie) Insert(w string, times int) {
	cur := t.root
	for i := 0; i < len(w); i++ {
		c := w[i]
		nxt, ok := cur.children[c]
		if !ok {
			nxt = newNode()
			cur.children[c] = nxt
		}
		nxt.pass += times
		cur = nxt
	}
	cur.freq += times
}

func (t *Trie) walk(p string) *Node {
	cur := t.root
	for i := 0; i < len(p); i++ {
		nxt, ok := cur.children[p[i]]
		if !ok {
			return nil
		}
		cur = nxt
	}
	return cur
}

func (t *Trie) CountPrefix(p string) int {
	n := t.walk(p)
	if n == nil {
		return 0
	}
	return n.pass
}

type pair struct {
	word string
	freq int
}
type minHeap []pair

func (h minHeap) Len() int            { return len(h) }
func (h minHeap) Less(i, j int) bool  { return h[i].freq < h[j].freq }
func (h minHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *minHeap) Push(x interface{}) { *h = append(*h, x.(pair)) }
func (h *minHeap) Pop() interface{} {
	old := *h
	n := len(old)
	x := old[n-1]
	*h = old[:n-1]
	return x
}

func (t *Trie) TopK(prefix string, k int) []pair {
	node := t.walk(prefix)
	h := &minHeap{}
	if node == nil {
		return nil
	}
	var dfs func(n *Node, path string)
	dfs = func(n *Node, path string) {
		if n.freq > 0 {
			heap.Push(h, pair{path, n.freq})
			if h.Len() > k {
				heap.Pop(h)
			}
		}
		for c, ch := range n.children {
			dfs(ch, path+string(c))
		}
	}
	dfs(node, prefix)
	out := make([]pair, h.Len())
	for i := len(out) - 1; i >= 0; i-- {
		out[i] = heap.Pop(h).(pair)
	}
	return out
}

func main() {
	t := New()
	t.Insert("cat", 5)
	t.Insert("car", 9)
	t.Insert("card", 2)
	t.Insert("care", 7)
	fmt.Println(t.CountPrefix("ca")) // 23
	fmt.Println(t.TopK("car", 2))    // [{car 9} {care 7}]
}
```

#### Java

```java
import java.util.*;

public class RankedTrie {
    static class Node {
        Map<Character, Node> ch = new HashMap<>();
        int pass = 0, freq = 0;
    }
    private final Node root = new Node();

    public void insert(String w, int times) {
        Node cur = root;
        for (char c : w.toCharArray()) {
            cur = cur.ch.computeIfAbsent(c, x -> new Node());
            cur.pass += times;
        }
        cur.freq += times;
    }

    private Node walk(String p) {
        Node cur = root;
        for (char c : p.toCharArray()) {
            cur = cur.ch.get(c);
            if (cur == null) return null;
        }
        return cur;
    }

    public int countPrefix(String p) {
        Node n = walk(p);
        return n == null ? 0 : n.pass;
    }

    public List<Map.Entry<String, Integer>> topK(String prefix, int k) {
        Node node = walk(prefix);
        PriorityQueue<Map.Entry<String, Integer>> heap =
            new PriorityQueue<>(Comparator.comparingInt(Map.Entry::getValue));
        if (node == null) return List.of();
        dfs(node, new StringBuilder(prefix), heap, k);
        List<Map.Entry<String, Integer>> out = new ArrayList<>(heap);
        out.sort((a, b) -> b.getValue() - a.getValue());
        return out;
    }

    private void dfs(Node n, StringBuilder path,
                     PriorityQueue<Map.Entry<String, Integer>> heap, int k) {
        if (n.freq > 0) {
            heap.offer(Map.entry(path.toString(), n.freq));
            if (heap.size() > k) heap.poll();
        }
        for (Map.Entry<Character, Node> e : n.ch.entrySet()) {
            path.append(e.getKey());
            dfs(e.getValue(), path, heap, k);
            path.deleteCharAt(path.length() - 1);
        }
    }

    public static void main(String[] args) {
        RankedTrie t = new RankedTrie();
        t.insert("cat", 5); t.insert("car", 9);
        t.insert("card", 2); t.insert("care", 7);
        System.out.println(t.countPrefix("ca")); // 23
        System.out.println(t.topK("car", 2));    // [car=9, care=7]
    }
}
```

#### Python

```python
import heapq


class Node:
    __slots__ = ("ch", "pass_", "freq")

    def __init__(self):
        self.ch = {}
        self.pass_ = 0
        self.freq = 0


class RankedTrie:
    def __init__(self):
        self.root = Node()

    def insert(self, w, times=1):
        cur = self.root
        for c in w:
            nxt = cur.ch.get(c)
            if nxt is None:
                nxt = Node()
                cur.ch[c] = nxt
            nxt.pass_ += times
            cur = nxt
        cur.freq += times

    def _walk(self, p):
        cur = self.root
        for c in p:
            cur = cur.ch.get(c)
            if cur is None:
                return None
        return cur

    def count_prefix(self, p):
        n = self._walk(p)
        return n.pass_ if n else 0

    def top_k(self, prefix, k):
        node = self._walk(prefix)
        if node is None:
            return []
        heap = []  # min-heap of (freq, word)

        def dfs(n, path):
            if n.freq > 0:
                heapq.heappush(heap, (n.freq, path))
                if len(heap) > k:
                    heapq.heappop(heap)
            for c, child in n.ch.items():
                dfs(child, path + c)

        dfs(node, prefix)
        return [(w, f) for f, w in sorted(heap, reverse=True)]


if __name__ == "__main__":
    t = RankedTrie()
    for w, f in [("cat", 5), ("car", 9), ("card", 2), ("care", 7)]:
        t.insert(w, f)
    print(t.count_prefix("ca"))  # 23
    print(t.top_k("car", 2))     # [('car', 9), ('care', 7)]
```

**Run:** `go run main.go` | `javac RankedTrie.java && java RankedTrie` | `python ranked.py`

---

## Coding Patterns

### Pattern 1: Counter fields over re-DFS

**Intent:** Any aggregate over a prefix's subtree (count, sum of frequencies, min/max key) can be precomputed as a node field maintained on insert/delete, turning an `O(subtree)` query into an `O(L)` read. Prefix count is the canonical example.

### Pattern 2: Bounded top-k with a size-k heap

**Intent:** When you only need the best k results from a large candidate set, keep a min-heap of size k. Offer each candidate; if the heap exceeds k, poll the smallest. `O(S log k)` instead of `O(S log S)`.

### Pattern 3: Edge-split for radix tries

**Intent:** In a radix trie, when a new key diverges in the middle of an existing edge label, split that edge into a shared prefix node plus two branches. This keeps every internal node branching and the node count `O(n)`.

---

## Performance Tips

- Maintain `passCount` so prefix counts are `O(L)`; never re-walk a subtree for a count.
- For hot typeahead, cache the precomputed top-k completions at each node — query becomes `O(L + k)`.
- Use a radix trie when keys are long with little branching; it can cut node count by an order of magnitude.
- Prefer array children for fixed small alphabets (a–z), maps for sparse/Unicode, TST for large alphabets with memory pressure.
- Build once, query many: amortize the `O(m)` build across thousands of queries.
- For sorting, a trie deduplicates for free; replay `wordCount` only if you need duplicates preserved.

---

## Edge Cases & Pitfalls

- **`passCount` drift** — if insert and delete do not both maintain `passCount`, prefix counts silently rot. Keep them symmetric.
- **Top-k ties** — equal frequencies need a tiebreak (lexicographic) for deterministic output; otherwise results jiggle.
- **Radix edge split bugs** — splitting at the wrong offset corrupts the shared prefix; test with keys that diverge at every position.
- **TST balance** — inserting keys in sorted order makes the BST dimension degenerate (linked list of siblings); shuffle or balance.
- **Array trie + Unicode** — `ch - 'a'` underflows; never index an array with arbitrary characters.
- **Sorting with maps** — map children are unordered; you must sort edge labels per node or the output is not lexicographic.

---

## Common Mistakes

1. **Re-DFSing for prefix counts** instead of reading a `passCount` field — `O(subtree)` where `O(L)` suffices.
2. **Full-sorting candidates for top-k** instead of a size-k heap — wastes work on results you discard.
3. **Treating a radix trie like a char trie** — edges carry substrings; matching must compare label-by-label and handle splits.
4. **Using an array of Σ pointers for a large alphabet** — memory explodes; use a map, TST, or radix trie.
5. **Forgetting children are unordered in a map** — then claiming sorted output without sorting edge labels.
6. **Deleting shared nodes** — pruning a node that other keys traverse breaks them; guard with `passCount`/child checks.

---

## Cheat Sheet

| Need | Tool | Cost |
|------|------|------|
| Prefix count | `passCount` field | `O(L)` |
| Top-k autocomplete | walk + size-k heap | `O(L + S log k)` |
| Top-k, latency-critical | cached top-k per node | `O(L + k)` |
| Small node count, long keys | radix / compressed trie | `O(n)` nodes |
| Large alphabet, low memory | ternary search trie | `O(log Σ)` per char |
| Sorted strings | pre-order DFS, sorted edges | `O(m)` |
| Exact membership only | use a hash set instead | `O(L)` |

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive visualization.
>
> The animation builds shared-prefix branches, then demonstrates a `search`/`startsWith` walk and an autocomplete collection — the same operations this file ranks and counts. Watch how the prefix node anchors both the count (subtree size) and the autocomplete DFS.

---

## Summary

The middle layer turns a textbook trie into a production-grade one. A `passCount` field makes prefix counting `O(L)`. Ranked autocomplete uses a frequency score and a size-k heap, or precomputed per-node top-k for the lowest latency. The compressed/radix trie merges single-child chains to bound node count at `O(n)` — ideal for long, sparse keys (full treatment in `21/24-25`). Ternary search tries trade an `O(log Σ)` per-character step for compact, alphabet-agnostic storage. Array children are fast but wasteful; map children are flexible but heavier. A single pre-order DFS sorts strings (and deduplicates). And against a hash set the rule is simple: hash set for pure membership, trie the instant any prefix operation appears.

---

## Further Reading

- *Algorithms* (Sedgewick & Wayne), Chapter 5 — R-way tries, TSTs, and string symbol-table performance.
- Sibling topic `21-advanced-structures/24-25` — compressed/radix tries and TSTs in full.
- Sibling topic `17-string-algorithms/05` — Aho-Corasick over a trie dictionary.
- Donald R. Morrison (1968) — the original PATRICIA paper.
- cp-algorithms.com — "Trie" and string data structures.
- Redis / database engines — radix trees in practice (Redis `rax`, Linux routing tables).
