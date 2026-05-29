# Trie — Middle Level

> **Audience:** Engineers who have implemented the plain trie from `junior.md` and want the variant family used in real libraries, competitive programming, and full-text search systems.

A plain trie wastes memory on long single-child chains and chooses one fixed children representation. Real systems use **compressed tries**, **ternary search trees**, **suffix tries**, **failure-link automata (Aho-Corasick)**, **minimized acyclic word graphs (DAWGs)**, and **cache-aware hybrid layouts (burst tries)**. This document is the tour of those variants — when to reach for each, how they trade off, and pointers to the canonical papers.

---

## Table of Contents

1. [Compressed Trie / Radix Tree / Patricia Trie](#compressed)
2. [Ternary Search Tree](#tst)
3. [Suffix Trie → Suffix Tree](#suffix)
4. [Aho-Corasick Automaton](#aho-corasick)
5. [DAWG — Directed Acyclic Word Graph](#dawg)
6. [Burst Tries — Cache-Friendly Hybrid](#burst)
7. [Lexicographic Iteration](#lex-iter)
8. [Children Representation — Array vs Map vs Bitmap (HAMT)](#children)

---

<a name="compressed"></a>
## 1. Compressed Trie / Radix Tree / Patricia Trie

A plain trie pays one node per character. If you insert `"international"` into an empty trie, it spends 13 nodes to store one word. Each internal node has exactly one child — pure overhead.

**Morrison's PATRICIA** (Practical Algorithm To Retrieve Information Coded In Alphanumeric, Morrison 1968) and the general **radix tree** fix this by **merging chains of single-child nodes into one edge labeled with a string**.

### Example

Insert "team", "tea", "tear", "ten" into a plain trie vs a compressed one:

```
Plain trie                Compressed trie
(root)                    (root)
  │t                        │"te"
 (t)                       (te)
  │e                       /  \
 (te)                    "a" "n"*
 /  \                    /
"a" "n"*               (tea)*
 │                      │
(tea)*                "m"|"r"
 /  \                  ↓   ↓
"m"  "r"            (team)*(tear)*
 │   │
(team)*(tear)*
```

A compressed trie's edges carry **substrings**, not single characters. Nodes only exist where branching or termination happens. For a list of random English words (10⁶ entries), a compressed trie uses ~10–20× less memory than a plain trie.

### Three names, slightly different things

People use these terms loosely; here's a reasonable distinction:

- **Compressed trie**: any trie with merged single-child chains. Edge labels are arbitrary strings.
- **Radix tree** (or *radix trie*): synonym used in databases and the Linux kernel. Often implies a specific radix r (e.g., radix-2 = binary, radix-256 = byte-based). Edge labels are strings.
- **PATRICIA trie**: specifically Morrison's 1968 binary trie where each node tests one bit and stores a bit index. Highly memory-efficient for keys that are bitstrings (IP addresses). Used in BSD route lookup and in `Map<K,V>` libraries for prefix-set data.

### Operations on a radix tree

- **Search(word)**: walk edges, matching characters; if you reach the end of `word` exactly at a terminal node, hit. If you fail to match an edge's label, miss.
- **Insert(word)**: walk as far as you can; if you stop in the middle of an edge label, **split the edge** at the divergence point and create a new branch.
- **Delete(word)**: unmark `isEnd`; if the node now has exactly one child, **merge** the edge with the child's edge (the inverse of split).

The edge-split and edge-merge operations are what makes compressed-trie code longer than plain-trie code. Beyond that, queries are the same shape.

### Reference implementation sketch (Go)

```go
type radixNode struct {
    label    string             // the (multi-char) edge label leading into this node
    children map[byte]*radixNode
    isEnd    bool
}

func (n *radixNode) insert(word string) {
    if word == "" {
        n.isEnd = true
        return
    }
    head := word[0]
    child, ok := n.children[head]
    if !ok {
        n.children[head] = &radixNode{label: word, isEnd: true,
                                      children: map[byte]*radixNode{}}
        return
    }
    // find longest common prefix of child.label and word
    cp := commonPrefix(child.label, word)
    if cp == len(child.label) {
        child.insert(word[cp:])
        return
    }
    // split the edge: child.label = cp + suffix
    split := &radixNode{
        label:    child.label[:cp],
        children: map[byte]*radixNode{},
    }
    child.label = child.label[cp:]
    split.children[child.label[0]] = child
    n.children[head] = split
    if cp == len(word) {
        split.isEnd = true
    } else {
        split.children[word[cp]] = &radixNode{
            label: word[cp:], isEnd: true,
            children: map[byte]*radixNode{},
        }
    }
}
```

We cover a full implementation in `tasks.md` task 7.

### Real-world radix trees

- **Linux kernel** routes IPv4/IPv6 packets through a compressed binary trie (`net/ipv4/fib_trie.c`, derived from the *level-compressed* LC-trie by Nilsson & Karlsson 1998). Each lookup is one prefix match against the routing table.
- **BSD kernel**: PATRICIA trie for the routing table.
- **etcd / Consul** use radix trees internally for key prefix watches and snapshots.
- **The Go standard library**'s `net/http.ServeMux` uses a (small) trie-like structure for route matching; popular routers like `chi` and `httprouter` use radix trees.
- **PostgreSQL**'s GIN index uses a trie-like layout for token dictionaries.

---

<a name="tst"></a>
## 2. Ternary Search Tree

The **Ternary Search Tree (TST)**, introduced by Bentley & Sedgewick in "Fast Algorithms for Sorting and Searching Strings" (SODA 1997), is a hybrid between a binary search tree (BST) and a trie.

Each node holds **one character** plus three pointers:

- `lo` — child for characters less than this one,
- `eq` — child for characters equal to this one (advances one character in the input),
- `hi` — child for characters greater than this one.

Compared to a trie:

- **Memory**: O(1) pointers per node × number of *characters across all keys* — much less than a trie's `|Σ|`-pointer arrays.
- **Time**: O(L + log |Σ|) average per lookup — slightly worse than the trie's O(L) but with a tiny constant.
- **Sorted iteration**: free, just like a trie.

### Lookup pseudocode

```
search(node, key, idx):
    if node == nil: return false
    c = key[idx]
    if c < node.ch: return search(node.lo, key, idx)
    if c > node.ch: return search(node.hi, key, idx)
    if idx == len(key) - 1: return node.isEnd
    return search(node.eq, key, idx + 1)
```

### When to reach for TST

- You have a **medium-to-large alphabet** (Unicode-ish or ASCII printable) and array-children would be wasteful but you still want trie-like prefix queries.
- You want **prefix matching with wildcards** — TST handles `'?'` in a query elegantly by exploring all three branches.
- Memory is tight.

### When **not** to use TST

- Tiny fixed alphabet (use array-children trie).
- You need worst-case O(L) — TST is O(L · log |Σ|) which is slightly worse and can degenerate without rebalancing.

Sedgewick's *Algorithms* book chapter 5.2 has detailed benchmarks: TST often beats array-children tries on real English text by 2–3× in memory at the cost of a small constant-factor slowdown in queries.

---

<a name="suffix"></a>
## 3. Suffix Trie → Suffix Tree

A **suffix trie** of a string `S` is the trie of **every suffix of S**:

For `S = "banana$"` (the `$` is a sentinel guaranteeing no suffix is a prefix of another):

```
suffixes: "banana$", "anana$", "nana$", "ana$", "na$", "a$", "$"
```

The suffix trie supports:

- **Substring search**: is `P` a substring of `S`? Walk from the root; if you can follow all of `P`, yes. O(|P|) — vastly better than scanning `S`.
- **Count of occurrences**: how many times does `P` appear in `S`? Count terminal nodes in the subtree.
- **Longest repeated substring**, **longest common substring of two strings**, and many more — see Gusfield.

### The problem with a plain suffix trie

It has **O(n²) nodes** in the worst case. For `S` of length 10⁶, a billion nodes. Useless in practice.

### Suffix tree — compressed suffix trie

The **suffix tree** is the compressed (radix) version: chains of single-child nodes are merged, so the tree has **O(n) nodes**. Construction in O(n):

- **Weiner (1973)**: first linear-time construction.
- **McCreight (1976)**: simpler linear-time algorithm, often taught.
- **Ukkonen (1995)**: **online** linear-time construction — you can build the suffix tree of `S` one character at a time, which is critical for streaming use cases.

We treat suffix trees as their own topic in `09-trees/09-suffix-tree` (or in `15-string-algorithms`, depending on your roadmap layout) — they deserve a chapter of their own.

### Modern alternatives

- **Suffix array** (Manber & Myers 1991): a sorted array of suffix starting positions. Same queries as suffix tree, less memory (4 bytes per suffix instead of ~20). Most production text-search engines use a suffix array plus the BWT (Burrows-Wheeler transform) and LCP (longest common prefix) array.
- **FM-index** (Ferragina & Manzini 2000): a compressed-index version of the BWT, used in DNA aligners (BWA, Bowtie) and full-text search.

Suffix tries are mostly **pedagogical** today — they motivate the suffix tree, which motivates the suffix array, which motivates the FM-index. The lineage is worth understanding.

---

<a name="aho-corasick"></a>
## 4. Aho-Corasick Automaton

Aho & Corasick, "Efficient String Matching: An Aid to Bibliographic Search" (Communications of the ACM 18:6, 1975), invented an algorithm that searches **a text for many patterns simultaneously** in time **O(|text| + total pattern length + number of matches)** — linear in the input.

The structure is a **trie of the patterns** augmented with **failure links**.

### Construction

1. Build the trie of all patterns in the usual way. Mark terminal nodes with the pattern they correspond to.
2. **BFS from the root** computing failure links:
   - The root's failure link is null.
   - For each child `c` of root: failure link = root.
   - For each other node `n` reached via character `ch` from parent `p`:
     - Start at `p.fail`. Walk failure links while `cur.children[ch]` is missing.
     - `n.fail = cur.children[ch]` (or root if walking reached null and root has no `ch` child).
3. Also propagate **output sets**: a node's output = its own pattern (if terminal) ∪ its failure-link's output. This captures the case where a shorter pattern ends inside a longer one.

### Matching

Walk the text one character at a time. At position `i`, try to follow the trie edge for `text[i]`. If missing, follow failure links until you find a node whose child for `text[i]` exists (or you bottom out at root). Move to that child. Emit all patterns in its output set, at position `i`.

The total work is bounded by the text length plus the total pattern length plus matches found — **linear**.

### Pseudocode (BFS for failure links)

```python
def build_failure_links(root):
    queue = deque()
    for ch, child in root.children.items():
        child.fail = root
        queue.append(child)
    while queue:
        node = queue.popleft()
        for ch, child in node.children.items():
            f = node.fail
            while f is not root and ch not in f.children:
                f = f.fail
            child.fail = f.children.get(ch, root)
            if child.fail is child:
                child.fail = root
            child.output = list(child.terminals) + list(child.fail.output)
            queue.append(child)
```

We will build the full thing in `tasks.md` task 8.

### Where Aho-Corasick is used in production

- **`grep -F`** (and `fgrep`): multi-pattern fixed-string search. The classic use case from the 1975 paper.
- **`fail2ban`**: scan log lines against many regex/literal patterns to detect intrusion attempts.
- **ClamAV**: scan files against a database of millions of malware signature patterns.
- **Snort / Suricata**: intrusion-detection rule matching at line rate.
- **Bro / Zeek**: protocol analyzers use Aho-Corasick for signature scanning.
- **Lucene**: synonyms and stop-word lookup over inverted-index streams.
- **Stenotype-stenographer software**: matching short syllable sequences to phonemes.

If you need to match more than ~3 patterns against the same text, Aho-Corasick is almost always the right answer.

---

<a name="dawg"></a>
## 5. DAWG — Directed Acyclic Word Graph

A trie has the redundancy of repeating the same suffix in many subtrees. Consider words ending in `-tion`: action, fiction, motion, nation, option, station... each has its own `t → i → o → n*` chain at the end.

A **DAWG (Directed Acyclic Word Graph)**, also called a **MA-FSA (Minimal Acyclic Finite-State Automaton)**, **merges all isomorphic subtrees** to share suffix structure.

The result is a **directed acyclic graph** (no longer a tree — multiple parents per node) that represents the same set of strings as the trie but with dramatically less storage.

### Construction

- **Daciuk et al. (2000)**, "Incremental construction of minimal acyclic finite-state automata", gives the standard algorithm: insert words in sorted order, after each insert, walk back up the new path and merge any node whose subtree is structurally identical to an existing one (canonicalize via a hash table keyed on `(isEnd, sorted_children_map)`).
- For an English dictionary, the DAWG is typically **3–5× smaller** than the trie and **10–50× smaller** than the original word list.

### Trade-offs

- **DAWG cannot store associated values per key** without breaking the suffix sharing, because the value would need to distinguish merged paths. Most practical DAWGs are **sets**, not maps. (Workarounds exist with auxiliary arrays.)
- **DAWG is read-mostly.** After insertion-sort-and-build, deleting a word in the middle requires rebuilding adjacent merges. Most production uses build once, query forever.

### Production uses

- **Spell checkers**: `hunspell`, `mspell`, `aspell` all use DAWG / MA-FSA representations of their dictionaries for fast lookup and memory efficiency.
- **Scrabble engines**: GADDAG and DAWG are core data structures. Quackle, Maven, and most strong Scrabble bots build a DAWG of the official word list.
- **MARISA-trie** (`professional.md`): a recursive succinct DAWG-like structure used in Japanese input-method engines.

---

<a name="burst"></a>
## 6. Burst Tries — Cache-Friendly Hybrid

Heinz, Zobel & Williams, "Burst Tries: A Fast, Efficient Data Structure for String Keys" (ACM TOIS 20:2, 2002), addressed the cache-locality problem of plain tries.

The idea:

1. The trie's **upper levels** are normal trie nodes (small fan-out, frequently visited, fit in cache anyway).
2. The trie's **lower levels** are replaced by **containers** — small sorted arrays or hash tables holding the remaining suffixes of keys.
3. When a container exceeds a threshold (typically 32–1024 entries), it **bursts**: a new trie node is created and the suffixes are re-partitioned by their next character.

This dramatically improves cache hit rates because, during a query, the cold path is one container scan rather than many trie-pointer chases. Empirically, burst tries match or beat hash tables on string-set workloads while retaining trie-style prefix queries.

The **HAT-trie** (Askitis & Sinha 2007, see `professional.md`) is a refinement using cache-conscious hash tables as the containers.

For most application-level code, you won't implement a burst trie yourself; you'd use the C++ implementation from the original paper or the Rust `qp-trie` crate. But knowing that *the right answer to "trie is slow for me" is often "use a burst trie or HAT-trie"* saves you from reinventing it.

---

<a name="lex-iter"></a>
## 7. Lexicographic Iteration

A trie supports sorted iteration for free: a depth-first search visiting children in alphabet order emits the keys in lexicographic order, in time O(N · L_avg).

```python
def iter_sorted(root):
    yield from _iter(root, [])

def _iter(node, path):
    if node.is_end:
        yield "".join(path)
    for ch in sorted(node.children):
        path.append(ch)
        yield from _iter(node.children[ch], path)
        path.pop()
```

For an array-children trie with a fixed alphabet, iteration is even cheaper — just scan slots 0..|Σ| in order, no sort needed:

```python
def iter_sorted_array(node, path):
    if node.is_end:
        yield "".join(path)
    for i in range(26):
        if node.children[i] is not None:
            path.append(chr(ord('a') + i))
            yield from iter_sorted_array(node.children[i], path)
            path.pop()
```

This gives you **range iteration** as a corollary: to iterate keys in `[lo, hi]`, walk to the smallest key ≥ `lo`, then iterate forward until you exceed `hi`. Very useful for autocomplete-with-pagination and for "give me the next 50 alphabetically after this one" queries.

The naive recursive iterator uses a call stack of depth L. For very deep tries, convert to an iterative form with an explicit stack of `(node, child_index)` tuples.

---

<a name="children"></a>
## 8. Children Representation — Array vs Map vs Bitmap (HAMT)

The single biggest implementation choice is **how to store a node's children**. Here are the major options, with trade-offs.

### Fixed array of size |Σ|

```
children: Node*[ALPHA]
```

- **Pros**: O(1) child lookup. Cache-line-friendly for small alphabets.
- **Cons**: Wastes memory on sparse nodes. For |Σ| = 26 and average 2 children, ~92% of slots are null.
- **Use when**: alphabet is small and dense (lowercase English, digits, DNA bases ACGT).

### HashMap<char, Node>

```
children: HashMap<Char, Node*>
```

- **Pros**: Memory proportional to actual children. Handles Unicode trivially.
- **Cons**: Per-entry overhead (pointers, hash bucket bookkeeping), unfriendly cache access, boxes chars in Java.
- **Use when**: alphabet is large or unknown; nodes are sparse.

### Sorted array of (char, Node) pairs

```
children: array of (Char, Node*) sorted by char
```

- **Pros**: Tight memory, cache-friendly for small fan-out (≤16 children).
- **Cons**: O(|children|) lookup or O(log |children|) with binary search; insertion is O(|children|) shift.
- **Use when**: most nodes have very few children (e.g., compressed tries, suffix arrays).

### Bitmap + array — HAMT (Bagwell 2001)

The **Hash Array Mapped Trie (HAMT)** by Phil Bagwell, "Ideal Hash Trees" (EPFL 2001), uses:

- A **bitmap** (a single machine word: 32 or 64 bits) where bit `i` indicates whether child `i` is present.
- A packed **array of only the present children**, no nulls.

To look up child `c`:
1. Compute `bit = 1 << c`.
2. If `bitmap & bit == 0`, child is absent.
3. Else child is at index `popcount(bitmap & (bit - 1))` in the packed array.

Result: O(1) amortized lookup, with memory proportional only to children actually present. The `popcount` is one instruction on modern CPUs (`POPCNT`).

HAMT is the foundation of:

- **Clojure**'s `PersistentHashMap` and `PersistentVector`.
- **Scala**'s `immutable.HashMap`.
- **Haskell**'s `Data.HashMap.Strict` (the `unordered-containers` package).
- **CHAMP** (Steindorfer & Vinju 2015) — a refinement with better cache behavior, used in modern Scala and Java collections.

For a senior engineer interview, knowing HAMT exists and being able to explain how the bitmap-index trick works is a strong signal. We dig deeper in `professional.md`.

### Decision matrix

| Alphabet size | Fan-out per node | Best choice |
|---|---|---|
| Small (≤32) | Dense | Array children |
| Small (≤32) | Sparse | Bitmap + array (HAMT-style) |
| Medium (≤256) | Mixed | Bitmap + array, or sorted-pair array |
| Large (Unicode) | Mixed | HashMap children, or HAMT chunked by 5-bit groups |
| Compressed trie | n/a | Map by first character of edge label |

---

## Cheat Sheet — Choosing a Trie Variant

```
Need                                            Variant
---------                                       -------------
Plain set/map with prefix queries               Plain trie (junior.md)
Memory-tight set with prefix queries            Compressed / radix trie
Medium alphabet, BST-like memory                Ternary search tree
Substring search inside one fixed text          Suffix tree (or array)
Multi-pattern search in a stream                Aho-Corasick
Spell-checker, immutable dictionary             DAWG / MA-FSA
Cache-friendly, very large dataset              Burst trie / HAT-trie
Persistent immutable map                        HAMT / CHAMP
IP routing, longest-prefix match                Binary PATRICIA, LC-trie
```

---

## Further Reading

- **Briandais (1959)** and **Fredkin (1960)** — origins (see `junior.md`).
- **Morrison, D. R.** (1968), "PATRICIA — Practical Algorithm to Retrieve Information Coded in Alphanumeric", JACM 15:4.
- **Aho, A. V. & Corasick, M. J.** (1975), "Efficient String Matching", CACM 18:6.
- **Bentley, J. & Sedgewick, R.** (1997), "Fast Algorithms for Sorting and Searching Strings", SODA.
- **Ukkonen, E.** (1995), "On-line Construction of Suffix Trees", Algorithmica 14:3.
- **Nilsson, S. & Karlsson, G.** (1999), "IP-Address Lookup Using LC-Tries", IEEE JSAC.
- **Daciuk, J. et al.** (2000), "Incremental Construction of Minimal Acyclic Finite-State Automata", Computational Linguistics 26:1.
- **Heinz, S., Zobel, J., Williams, H. E.** (2002), "Burst Tries: A Fast, Efficient Data Structure for String Keys", ACM TOIS.
- **Bagwell, P.** (2001), "Ideal Hash Trees", EPFL Technical Report.
- Continue with `senior.md` for production usage in DNS resolvers, Linux IP routing, Lucene FST, Aho-Corasick in `grep -F`, BPE tokenizers, and Ethereum's Merkle Patricia Trie.
