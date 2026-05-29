# Trie (Prefix Tree) — Junior Level

> **Read time: ~40 minutes** · **Audience:** Students who know arrays, strings, and basic trees, and want to learn the data structure that powers autocomplete, spell-check, and IP routing.

A **trie** (pronounced "try" or "tree", a clip of "re**trie**val") is a tree-shaped data structure that stores a **set of strings** in a way that makes both **exact lookup** and **prefix lookup** run in time **O(L)** — where `L` is the length of the query string — **completely independent of how many strings are stored**. That last property is the astonishing one. A hash set with one million words answers `contains("merengue")` in O(L) too, but it cannot answer `startsWith("mer")` at all without scanning every key. A trie answers both in the same O(L) walk.

The name was coined by Edward Fredkin in his 1960 paper *"Trie Memory"* (Communications of the ACM 3:9, 490–499); the structure itself was independently invented by René de la Briandais in 1959. Donald Knuth's *The Art of Computer Programming, Volume 3*, §6.3 ("Digital Searching"), gives the definitive analysis.

This document teaches you the trie **so concretely** that by the end you can implement it from memory in three languages, explain why it beats a hash set on prefix queries, and recognize it everywhere — in your phone's autocomplete, in `git`'s tab completion, in the Linux kernel's routing table.

---

## Table of Contents

1. [Introduction — O(L) Independent of Dictionary Size](#introduction)
2. [Prerequisites — Strings and Character Sets](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts — Shared Prefix Paths](#core-concepts)
5. [Big-O Summary](#big-o-summary)
6. [Real-World Analogies](#analogies)
7. [Pros and Cons](#pros-and-cons)
8. [Step-by-Step Walkthrough](#walkthrough)
9. [Code Examples — Go, Java, Python](#code-examples)
10. [Coding Patterns — DFS Enumerate, Prefix Pruning](#patterns)
11. [Error Handling — Unicode and Case](#errors)
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
## 1. Introduction — O(L) Independent of Dictionary Size

Imagine a dictionary with **one million** English words. You type "**mer**" into a search box and want the suggestions: *mercury, mercy, merge, meringue, merit, merlot, mermaid, ...* How fast can a computer give you that list?

- A **linear scan** of the word list takes O(N × L) where N is the dictionary size (10⁶) and L is the prefix length (3) — about 3 million character comparisons.
- A **hash set** of the full words can confirm `"mercury"` is present in O(L) but it has **no notion of prefix**. To list everything beginning with "mer" it would still scan all million keys.
- A **sorted array of words** can locate the first match in O(L log N) via binary search and then linearly read suggestions until the prefix no longer matches. Acceptable, but ties the cost to N.
- A **trie** locates the node corresponding to "mer" in **exactly 3 character steps**, regardless of whether the dictionary has 100 words or 100 billion. Once at that node, listing all keys below it is O(answer size) — you cannot do better than reading the result.

That is the trie's headline property: **search and prefix queries cost O(L), not O(L · log N) and not O(L · N)**. The number of stored strings simply does not appear in the complexity.

How? A trie is a tree where **each edge is labeled with a single character**, and each node represents the unique prefix obtained by concatenating the labels from the root. Strings that share a prefix share a path. The word "cat" and the word "car" share the path `c → a` and only diverge at the third character. The word "card" extends "car" by one more node. Lookup is a literal letter-by-letter walk from the root.

The structure was independently described by **Briandais (1959)** and named by **Fredkin (1960)**. Knuth's TAOCP §6.3 calls it a **digital tree** and gives the canonical analysis. Today tries power:

- **Autocomplete** in every search box on the planet (Google, Algolia, ElasticSearch suggesters).
- **Spell-check** in word processors (compressed-trie variants).
- **T9 / multi-tap text entry** on dumb phones.
- **IP routing tables** in the Linux kernel (binary trie, longest-prefix match).
- **Tokenizers** for large language models (BPE greedy match).
- **Ethereum**'s state storage (Merkle Patricia Trie).

By the end of this document you will understand all of these well enough to read the kernel source.

---

<a name="prerequisites"></a>
## 2. Prerequisites — Strings and Character Sets

To follow this document comfortably you need:

1. **Strings as sequences of characters.** You know that `"cat"[0] == 'c'`, that string concatenation is `"ca" + "t"`, and that string length is computed at construction time.
2. **A character set (alphabet).** A trie's branching factor equals the alphabet size: 26 for lowercase English, 36 for alphanumeric, 128 for ASCII, ~1.1 million for full Unicode. The alphabet decides whether `children` is a small array, a map, or a bitmap.
3. **Trees and recursion.** You should know what "root", "node", "child", and "leaf" mean. A trie is a tree; insert and search are simple tree walks. We will write iterative and recursive versions side by side.
4. **Asymptotic notation (Big-O).** You should be comfortable saying "this is O(L)" where L is a parameter the algorithm depends on.
5. **Hash maps.** We compare the trie to a hash set of strings constantly. You should know that `HashMap<String, V>.get(key)` is O(L) average where L is the key length (hashing the key takes time proportional to its length).

If any of the above feels shaky, read the strings and trees sections of any standard data-structures textbook first.

---

<a name="glossary"></a>
## 3. Glossary

| Term | Definition |
|---|---|
| **Trie** | A tree where each node represents a prefix; each edge is labeled with one character. Pronounced "try" (Fredkin's preference) or "tree" (after the parent word "retrieval"). |
| **Root** | A single empty-string node. Always present, even if the trie is empty. |
| **Node** | A position in the tree. Contains: a children pointer/map, and a flag indicating "a stored key ends here". |
| **Edge** | The link from a node to one of its children. Labeled with the character that extends the parent's prefix to the child's prefix. |
| **Children** | The set of outgoing edges from a node, keyed by character. Implemented as fixed array (size = alphabet), HashMap, or bitmap. |
| **isEnd / terminal flag** | A boolean on each node indicating "this node corresponds to a complete inserted key". Required because the path to a stored word may be a prefix of another stored word. |
| **Key / word** | A string stored in the trie. Equivalent to "a path from the root to a node whose `isEnd` is true". |
| **Prefix** | Any string corresponding to a path from the root. Not necessarily a stored key. |
| **Lookup path** | The sequence of nodes visited when searching for a key or prefix, one node per character. |
| **Alphabet (Σ)** | The set of distinct characters used. Size `|Σ|` determines the branching factor. |
| **Branching factor** | How many children a node may have. Equals `|Σ|`. |
| **Compressed / radix trie** | A trie variant that merges chains of single-child nodes into one edge labeled with a string. Saves memory on sparse keys. Covered in `middle.md`. |
| **Leaf** | A node with no children. May or may not be terminal — a leaf without `isEnd` is wasted space and should be cleaned up on delete. |

---

<a name="core-concepts"></a>
## 4. Core Concepts — Shared Prefix Paths

### 4.1 The structural invariant

A trie stores a **set of strings** such that:

> **The path from the root to any node, spelled by concatenating edge labels, is the prefix that node represents.**

So if you walk root → 'c' → 'a' → 't', you are at the node representing the prefix "cat". Whether "cat" is *stored* depends on that node's `isEnd` flag.

### 4.2 Shared prefixes = shared paths

The big win: **two stored words that share a prefix share the same path nodes** up to the divergence point. Insert "cat", "car", "card":

```
        (root)
          │
          c
          │
        (c)
          │
          a
          │
        (ca)
         ╱ ╲
        t   r
       ╱     ╲
     (cat*) (car*)
              │
              d
              │
            (card*)
```

`*` marks `isEnd = true`. "cat", "car", "card" each have their own terminal node, but they share the `c → a` path. If you also insert "carbon", it would extend the existing "car*" path with `→ b → o → n`. The savings grow with prefix overlap; for English text with heavy prefix sharing (suffix-rich morphology), the savings are substantial.

### 4.3 The terminal flag is non-negotiable

Why can't we just say "a leaf node = a stored word"? Because **one stored word can be a prefix of another**. Storing "car" and "card" gives the structure above where "car*" is **not** a leaf — it has a child. Without `isEnd`, you cannot tell whether "car" is itself a stored key or merely a transit node toward "card".

This is a classic beginner bug: people omit `isEnd` and then `search("ca")` returns true after inserting "cat", because the path exists. The fix is one boolean per node.

### 4.4 Operations are walks

All three primary operations are short walks:

- **insert(word)**: from root, for each character `c` in `word`, follow the `c` child if it exists, otherwise create it; at the end, set `isEnd = true`.
- **search(word)**: from root, for each character `c`, follow the `c` child; if any is missing, return false; at the end, return `isEnd`.
- **startsWith(prefix)**: same as search but **do not check `isEnd`** — any reachable node counts.

Three of the most useful operations on a string set, all in O(L) and all 5 lines of code.

### 4.5 Children representation

Three choices:

1. **Fixed array of size |Σ|.** For lowercase English, `children[26]`. O(1) child lookup by indexing `children[c - 'a']`. Wastes memory on sparse nodes (most slots are null) but trivially fast. Best when the alphabet is small and the trie is dense.
2. **HashMap<Character, Node>.** Constant amortized lookup, memory proportional to actual children. Best for large or unknown alphabets (Unicode, byte sequences).
3. **Sorted list of (char, child) pairs.** O(|Σ|) lookup but tiny memory. Best when most nodes have very few children.

For a junior-level implementation we'll cover both array-children and HashMap-children. Production tries use sophisticated layouts — see `professional.md`.

---

<a name="big-o-summary"></a>
## 5. Big-O Summary

Let `L` = length of the query/insert key, `N` = number of stored keys, `Σ` = alphabet.

| Operation | Time | Space added | Notes |
|---|---|---|---|
| **Insert(word)** | O(L) | up to O(L · |Σ|) per new node (array children) or O(L) (map children) | Worst case allocates L new nodes |
| **Search(word)** | O(L) | O(1) | Independent of N |
| **StartsWith(prefix)** | O(L) | O(1) | Independent of N |
| **Delete(word)** | O(L) | frees up to L nodes | Requires walking down then cleaning unused chain |
| **Enumerate prefix** | O(L + K · L_max) | O(L_max) recursion | K = number of matching keys, L_max = max key length |
| **Total space (worst)** | — | O(N · L · |Σ|) | All keys distinct from root with array children |
| **Total space (best, full sharing)** | — | O(N + L · |Σ|) | All keys share one full path |

For a million English words averaging 8 characters with HashMap children, a typical trie uses on the order of a few hundred megabytes — much more than a 30 MB hash set of the strings. **Tries trade memory for query flexibility.** If you only need exact-match lookup, use a hash set; if you need prefix queries, the trie's memory is worth it.

For 26-letter array-children: each node is 26 pointers = 208 bytes (64-bit) plus boolean ≈ 216 bytes. A trie with one million nodes uses ~216 MB just for pointers. HashMap children with average 3 children per node bring this to ~70 MB.

---

<a name="analogies"></a>
## 6. Real-World Analogies

### 6.1 Library card catalog

Older libraries had **drawer cabinets** organized first by the first letter of the author's surname, then by the second, then the third. To find "Eco, Umberto" you opened the "E" drawer, walked to the "Ec" section, then "Eco". Each step narrowed the choice. That is exactly a trie traversal — root → 'E' → 'c' → 'o' → ...

### 6.2 Search box autocomplete

Type "**git p**" into the GitHub search and you instantly see "git push", "git pull", "git pr", "git pretty-format". The frontend caches a trie of popular queries; each keystroke walks one edge down. Without a trie, the server would have to scan every popular query on every keystroke — impossible at scale.

### 6.3 T9 phone keyboard

Old "dumb phones" had three letters per key (`2 = abc`, `3 = def`, ...). Pressing `2-2-8` could mean "act", "bat", "cat". The phone used a trie of valid English words keyed by **digit sequences**, ranked by frequency. As you typed, the trie walk would narrow the candidate set.

### 6.4 Tab completion in shells

When you type `cd Doc<TAB>` in bash, the shell walks a trie of filenames in the current directory (built lazily from `readdir`) and completes to the longest unambiguous prefix — exactly the operation of "find the deepest node where this prefix is unambiguous" in trie terms.

### 6.5 Spell-check

A word processor consults a trie of valid dictionary words. As you type, it walks the trie; if it cannot follow your characters, you have a typo. For suggestions it does a *bounded edit-distance walk* — explore neighbors of the partial path within edit-distance 1 or 2 of what you typed.

---

<a name="pros-and-cons"></a>
## 7. Pros and Cons

### Pros

- **O(L) lookup independent of dictionary size.** The only data structure that gives this for strings.
- **Native prefix support.** `startsWith` and "list everything starting with X" are free.
- **Lexicographic ordering for free.** A DFS in alphabet order visits keys in sorted order.
- **Memory sharing on overlap-heavy datasets.** Words sharing prefixes share paths.
- **Easy to compose with other operations.** Wildcards, edit-distance walks, multi-pattern search (Aho-Corasick) all extend the trie nicely.
- **No hashing required.** No risk of hash-collision DoS attacks.

### Cons

- **Memory overhead** is high for small alphabets if implemented with fixed arrays. A 26-pointer array per node wastes most slots.
- **Slower than hash table** for exact lookup at modest dataset size, because each step is a pointer chase rather than one hash computation. For `n = 1000` words and a query that hits, a HashSet often beats a trie.
- **Cache-unfriendly.** Each node lives in its own allocation; walking the trie chases pointers across memory. See `middle.md` for HAT-tries and burst tries that fix this.
- **No built-in support for non-prefix substring search.** For "find all positions of *pattern* in *text*", use a **suffix tree / suffix automaton** (see `middle.md` and `09-suffix-trees`), not a plain trie.
- **Implementation complexity** for production tries (compression, bitmap children, persistence) is non-trivial.
- **Bad fit for dense numeric keys.** A trie of 32-bit integers as decimal strings is much worse than a HashMap of ints.

---

<a name="walkthrough"></a>
## 8. Step-by-Step Walkthrough

Let's insert "cat", "car", "card", "dog" one at a time and then run several queries. We'll use lowercase English letters as the alphabet.

**Initial state**: only the root node, no children, no `isEnd`.

```
(root)
```

### Insert "cat"

From root: no 'c' child → create it. Move down. No 'a' child → create. Move down. No 't' child → create. Move down. Mark `isEnd = true`.

```
(root)
  │c
 (c)
  │a
 (ca)
  │t
 (cat*)
```

### Insert "car"

From root: 'c' exists → follow. 'a' exists → follow. No 'r' child at the "ca" node — create it. Move down. Mark `isEnd = true`.

```
(root)
  │c
 (c)
  │a
 (ca)
 ╱ ╲
t   r
│    │
(cat*) (car*)
```

Notice the shared `c → a` path: we did **not** allocate new nodes for "c" or "ca" the second time.

### Insert "card"

From root: walk c → a → r (all exist). No 'd' child at "car" — create. Move down. Mark `isEnd = true`. Note "car*" is still terminal AND now has a child "d".

```
(root)
  │c
 (c)
  │a
 (ca)
 ╱ ╲
t   r
│    │
(cat*) (car*)
        │d
       (card*)
```

This is exactly why we need `isEnd`: "car" is a stored word AND a prefix of another stored word.

### Insert "dog"

Fresh path from the root.

```
(root)
 ╱   ╲
c     d
│     │
(c)  (d)
│     │
a     o
│     │
(ca) (do)
╱ ╲    │
t  r   g
│   │   │
(cat*)(car*)(dog*)
       │
       d
       │
      (card*)
```

### Query: `search("ca")`

Walk c → a. Land on node "ca". Check `isEnd` → **false**. Return false. "ca" is a prefix but not a stored key.

### Query: `startsWith("ca")`

Walk c → a. Land on "ca". Return **true**. The node exists; we don't care about `isEnd`.

### Query: `search("card")`

Walk c → a → r → d. Land on "card*". Check `isEnd` → **true**. Return true.

### Query: `search("cab")`

Walk c → a. At "ca", look for 'b' child. None → return **false**.

### Query: `search("dogs")`

Walk d → o → g. At "dog*", look for 's' child. None → return **false**.

Notice every operation took exactly L = `len(query)` steps. There were 4 stored words but query length never had a factor of 4 anywhere.

---

<a name="code-examples"></a>
## 9. Code Examples — Go, Java, Python

### 9.1 Array-children trie for lowercase English

This is the fastest implementation when the alphabet is small and fixed (26 lowercase letters, or 36 alphanumeric).

#### Go

```go
package trie

// Trie supports insert / search / startsWith over lowercase ASCII a-z.
type Trie struct {
    root *node
}

type node struct {
    children [26]*node
    isEnd    bool
}

func New() *Trie { return &Trie{root: &node{}} }

func (t *Trie) Insert(word string) {
    cur := t.root
    for i := 0; i < len(word); i++ {
        idx := word[i] - 'a'
        if cur.children[idx] == nil {
            cur.children[idx] = &node{}
        }
        cur = cur.children[idx]
    }
    cur.isEnd = true
}

func (t *Trie) Search(word string) bool {
    n := t.walk(word)
    return n != nil && n.isEnd
}

func (t *Trie) StartsWith(prefix string) bool {
    return t.walk(prefix) != nil
}

// walk returns the node at the end of the path, or nil if the path is missing.
func (t *Trie) walk(s string) *node {
    cur := t.root
    for i := 0; i < len(s); i++ {
        idx := s[i] - 'a'
        if cur.children[idx] == nil {
            return nil
        }
        cur = cur.children[idx]
    }
    return cur
}
```

#### Java

```java
public final class Trie {
    private static final int ALPHA = 26;

    private static final class Node {
        Node[] children = new Node[ALPHA];
        boolean isEnd;
    }

    private final Node root = new Node();

    public void insert(String word) {
        Node cur = root;
        for (int i = 0; i < word.length(); i++) {
            int idx = word.charAt(i) - 'a';
            if (cur.children[idx] == null) cur.children[idx] = new Node();
            cur = cur.children[idx];
        }
        cur.isEnd = true;
    }

    public boolean search(String word) {
        Node n = walk(word);
        return n != null && n.isEnd;
    }

    public boolean startsWith(String prefix) {
        return walk(prefix) != null;
    }

    private Node walk(String s) {
        Node cur = root;
        for (int i = 0; i < s.length(); i++) {
            int idx = s.charAt(i) - 'a';
            if (cur.children[idx] == null) return null;
            cur = cur.children[idx];
        }
        return cur;
    }
}
```

#### Python

```python
class Trie:
    __slots__ = ("root",)

    def __init__(self):
        # children: list[Trie|None] of size 26; isEnd: bool
        self.root = [None] * 27       # index 26 reserved for the isEnd flag
        # children at indices 0..25, terminal flag at index 26

    def insert(self, word: str) -> None:
        cur = self.root
        for ch in word:
            idx = ord(ch) - ord('a')
            if cur[idx] is None:
                cur[idx] = [None] * 27
            cur = cur[idx]
        cur[26] = True

    def search(self, word: str) -> bool:
        n = self._walk(word)
        return n is not None and n[26] is True

    def starts_with(self, prefix: str) -> bool:
        return self._walk(prefix) is not None

    def _walk(self, s: str):
        cur = self.root
        for ch in s:
            idx = ord(ch) - ord('a')
            if cur[idx] is None:
                return None
            cur = cur[idx]
        return cur
```

The Python version uses a list-as-node trick for compactness and speed; in idiomatic Python you might prefer a small `Node` class with `__slots__`.

### 9.2 HashMap-children trie for arbitrary Unicode

When the alphabet is large (full Unicode, or you simply don't want to think about it), use a map.

#### Go

```go
package trie

type MapNode struct {
    children map[rune]*MapNode
    isEnd    bool
}

type MapTrie struct {
    root *MapNode
}

func NewMap() *MapTrie {
    return &MapTrie{root: &MapNode{children: map[rune]*MapNode{}}}
}

func (t *MapTrie) Insert(word string) {
    cur := t.root
    for _, r := range word {                    // ranges over runes, not bytes
        nxt, ok := cur.children[r]
        if !ok {
            nxt = &MapNode{children: map[rune]*MapNode{}}
            cur.children[r] = nxt
        }
        cur = nxt
    }
    cur.isEnd = true
}

func (t *MapTrie) Search(word string) bool {
    n := t.walk(word)
    return n != nil && n.isEnd
}

func (t *MapTrie) StartsWith(p string) bool { return t.walk(p) != nil }

func (t *MapTrie) walk(s string) *MapNode {
    cur := t.root
    for _, r := range s {
        nxt, ok := cur.children[r]
        if !ok {
            return nil
        }
        cur = nxt
    }
    return cur
}
```

#### Java

```java
import java.util.HashMap;
import java.util.Map;

public final class MapTrie {
    private static final class Node {
        Map<Character, Node> children = new HashMap<>();
        boolean isEnd;
    }
    private final Node root = new Node();

    public void insert(String word) {
        Node cur = root;
        for (int i = 0; i < word.length(); i++) {
            char c = word.charAt(i);
            cur = cur.children.computeIfAbsent(c, k -> new Node());
        }
        cur.isEnd = true;
    }

    public boolean search(String w) {
        Node n = walk(w);
        return n != null && n.isEnd;
    }

    public boolean startsWith(String p) { return walk(p) != null; }

    private Node walk(String s) {
        Node cur = root;
        for (int i = 0; i < s.length(); i++) {
            cur = cur.children.get(s.charAt(i));
            if (cur == null) return null;
        }
        return cur;
    }
}
```

#### Python

```python
class MapTrie:
    __slots__ = ("children", "is_end")

    def __init__(self):
        self.children: dict[str, "MapTrie"] = {}
        self.is_end = False

    def insert(self, word: str) -> None:
        cur = self
        for ch in word:
            if ch not in cur.children:
                cur.children[ch] = MapTrie()
            cur = cur.children[ch]
        cur.is_end = True

    def search(self, word: str) -> bool:
        n = self._walk(word)
        return n is not None and n.is_end

    def starts_with(self, prefix: str) -> bool:
        return self._walk(prefix) is not None

    def _walk(self, s: str):
        cur = self
        for ch in s:
            cur = cur.children.get(ch)
            if cur is None:
                return None
        return cur
```

### 9.3 Recursive insert/search (for the sake of comparison)

The recursive form looks the same as a tree recursion you've seen for binary trees. Here's the Python version, since it's the most compact:

```python
def insert_rec(node: MapTrie, word: str, i: int = 0) -> None:
    if i == len(word):
        node.is_end = True
        return
    ch = word[i]
    if ch not in node.children:
        node.children[ch] = MapTrie()
    insert_rec(node.children[ch], word, i + 1)

def search_rec(node: MapTrie | None, word: str, i: int = 0) -> bool:
    if node is None:
        return False
    if i == len(word):
        return node.is_end
    return search_rec(node.children.get(word[i]), word, i + 1)
```

In production, **prefer iterative** — recursion adds O(L) stack frames for no benefit.

### 9.4 Quick demo

```python
t = MapTrie()
for w in ["cat", "car", "card", "dog"]:
    t.insert(w)

assert t.search("cat")          # True
assert t.search("car")          # True
assert t.search("card")         # True
assert not t.search("ca")       # prefix only, not a key
assert t.starts_with("ca")      # True
assert not t.starts_with("cab") # False
```

---

<a name="patterns"></a>
## 10. Coding Patterns — DFS Enumerate, Prefix Pruning

### 10.1 Enumerate all keys with a given prefix

To list every stored word that starts with `prefix`, walk to the prefix node, then DFS down collecting every node with `isEnd = true`.

#### Python

```python
def keys_with_prefix(root: MapTrie, prefix: str) -> list[str]:
    cur = root
    for ch in prefix:
        cur = cur.children.get(ch)
        if cur is None:
            return []
    out: list[str] = []
    _collect(cur, list(prefix), out)
    return out

def _collect(node: MapTrie, path: list[str], out: list[str]) -> None:
    if node.is_end:
        out.append("".join(path))
    for ch in sorted(node.children):           # sorted → lexicographic order
        path.append(ch)
        _collect(node.children[ch], path, out)
        path.pop()
```

The cost is O(L + K · L_max): one O(L) walk to the prefix node, plus traversal of every node beneath that contributes a key (K total keys, each up to L_max characters of path).

#### Go

```go
func (t *MapTrie) KeysWithPrefix(prefix string) []string {
    cur := t.walk(prefix)
    if cur == nil { return nil }
    var out []string
    var path []rune
    for _, r := range prefix {
        path = append(path, r)
    }
    collect(cur, path, &out)
    return out
}
func collect(n *MapNode, path []rune, out *[]string) {
    if n.isEnd {
        *out = append(*out, string(path))
    }
    // For lexicographic order, sort keys; omitted for brevity.
    for r, ch := range n.children {
        path = append(path, r)
        collect(ch, path, out)
        path = path[:len(path)-1]
    }
}
```

### 10.2 Pruning during DFS

When you only want, say, the **first 10** suggestions, stop the DFS as soon as you have collected 10. This works because the DFS in lexicographic order visits keys in sorted order — exactly the suggestions you want for an autocomplete UI.

```python
def top_k_with_prefix(root: MapTrie, prefix: str, k: int) -> list[str]:
    cur = root
    for ch in prefix:
        cur = cur.children.get(ch)
        if cur is None:
            return []
    out: list[str] = []
    def dfs(node: MapTrie, path: list[str]) -> bool:
        if len(out) >= k:
            return True                                # signal stop
        if node.is_end:
            out.append("".join(path))
            if len(out) >= k:
                return True
        for ch in sorted(node.children):
            path.append(ch)
            if dfs(node.children[ch], path):
                path.pop()
                return True
            path.pop()
        return False
    dfs(cur, list(prefix))
    return out
```

For frequency-ranked autocomplete (the real use case), augment each node with a **best-score-in-subtree** field and do a priority-DFS instead. See `tasks.md` task 9.

### 10.3 Longest common prefix of stored words

Walk from the root as long as the current node has **exactly one child and is not terminal**.

```python
def longest_common_prefix(root: MapTrie) -> str:
    out = []
    cur = root
    while len(cur.children) == 1 and not cur.is_end:
        ch, nxt = next(iter(cur.children.items()))
        out.append(ch)
        cur = nxt
    return "".join(out)
```

### 10.4 Deletion (with cleanup)

Deletion is more involved because, after marking the terminal flag false, you may want to free the unused chain of nodes leading up to it — but only if they have no other children and are not themselves terminal.

The pattern: recurse to the bottom, unset `isEnd`, then on the way back, if the current node has no children and is not terminal, signal the parent to drop it.

```python
def delete(node: MapTrie, word: str, i: int = 0) -> bool:
    """Returns True if the parent should drop `node` from its children."""
    if i == len(word):
        if not node.is_end:
            return False                  # word not present
        node.is_end = False
    else:
        ch = word[i]
        child = node.children.get(ch)
        if child is None:
            return False                  # word not present
        if delete(child, word, i + 1):
            del node.children[ch]
    # Tell parent to drop us if we have no children and we are not terminal
    return not node.is_end and not node.children
```

We will revisit delete formally in `tasks.md` task 3.

---

<a name="errors"></a>
## 11. Error Handling — Unicode and Case

The two real-world bugs that bite trie users:

### 11.1 Case sensitivity

If you build a 26-slot array-children trie and a user types `"Cat"` instead of `"cat"`, `'C' - 'a'` is negative. You get an array-out-of-bounds (Java) or read garbage (C/Go). Fix:

```java
public void insert(String word) {
    word = word.toLowerCase(Locale.ROOT);    // normalize at the boundary
    ...
}
```

Always lowercase **once at the boundary** (insert/search/startsWith), not inside the inner loop. And use `Locale.ROOT` to avoid the Turkish-I problem: in Turkish locale, `"I".toLowerCase()` is `"ı"`, not `"i"`.

### 11.2 Unicode normalization

The string `"café"` can be encoded two ways:

- **NFC (composed)**: 4 code points — `c`, `a`, `f`, `é` (single character U+00E9).
- **NFD (decomposed)**: 5 code points — `c`, `a`, `f`, `e`, ◌́ (combining acute accent U+0301).

Both render visually identical. A user typing on macOS may produce NFD; another typing on Windows may produce NFC. **A trie compares code points, not visual characters** — so the two encodings hit different paths.

The fix: normalize at the boundary.

- **Python**: `unicodedata.normalize("NFC", s)`.
- **Java**: `Normalizer.normalize(s, Normalizer.Form.NFC)`.
- **Go**: `golang.org/x/text/unicode/norm.NFC.String(s)`.

Pick a form and apply it consistently to **every** string going into the trie and every query coming out. NFC is the standard recommendation for storage.

### 11.3 Out-of-alphabet characters

A 26-slot trie should reject (or normalize) characters outside `a..z`. Either:

- Throw `IllegalArgumentException` (Java) / panic (Go) / raise `ValueError` (Python).
- Silently skip them.
- Use a wider alphabet (e.g., 128 ASCII slots).

The choice depends on whether silent ingestion is acceptable for your use case. For an interview/junior implementation, throwing is best — fail loudly.

### 11.4 Empty string

The empty string `""` is a valid key. Inserting it sets `root.isEnd = true`. Searching for it returns `root.isEnd`. None of the loops execute. Make sure your code handles this without special casing (it does, naturally, if written correctly).

---

<a name="performance-tips"></a>
## 12. Performance Tips

1. **Pre-compute the character → index mapping.** Instead of `c - 'a'` inside the hot loop, set up an `int[128]` lookup table once. Slightly faster for restricted alphabets and lets you handle uppercase/digits in one branchless lookup.

2. **Allocate nodes from a pool.** Java's GC and Go's allocator are fast, but for a million-key insert, batching node allocations into a pool (or even a flat `int[][]` adjacency table) drops GC pressure dramatically. See `professional.md`.

3. **Use array children for hot tries, map children for cold ones.** Mixed implementations exist (small-array for the dense top levels, hashmap for the sparse deep levels). The HAT-trie is the classical example.

4. **Cache-pack nodes.** A node struct with 26 pointers spans 4 cache lines. If you store the children inline as `int` indices into an arena, the whole node fits in one or two lines. See `professional.md`'s discussion of LOUDS and succinct tries.

5. **Avoid recursion for very deep tries.** Deep recursion = stack pressure; iterative is one register update per character.

6. **Bulk-insert in sorted order.** Sorted insertion improves CPU branch prediction and L1 hit rate for both array-children and map-children.

7. **For prefix queries, prune aggressively.** If you only need the top 10 suggestions, stop the DFS once you have them; don't enumerate the entire subtree.

8. **Profile before optimizing.** A naive HashMap trie that takes 200 MB and answers in 200 ns is often perfectly fine in production. Don't optimize what you cannot measure.

---

<a name="best-practices"></a>
## 13. Best Practices

- **Always include `isEnd`**; never use "leaf = terminal" as the proxy.
- **Document the alphabet** in the type or javadoc: "lowercase ASCII a–z only", "any Unicode rune", etc.
- **Normalize input at the boundary** (case + Unicode NFC).
- **Choose array vs map children deliberately** based on alphabet size and density. Mixing is fine in production tries.
- **Don't store the original key at every internal node** unless you need it. Save memory.
- **Provide a `size()` method** by maintaining a counter on insert/delete — easier than walking the tree.
- **Write the iterative form first** — clearer to reason about, no stack overflow risk, easier to profile.
- **Use `__slots__` in Python** for trie nodes. The memory savings are large at million-node scale.
- **In Go**, prefer `map[rune]` over `map[byte]` only when you actually need Unicode; bytes are 8× cheaper.
- **In Java**, prefer the array-children form unless the alphabet is genuinely large; `HashMap<Character, Node>` boxes every char.

---

<a name="edge-cases"></a>
## 14. Edge Cases

| Case | Expected behavior |
|---|---|
| Empty trie, search any | `false` |
| Empty trie, startsWith `""` | `true` (the empty prefix exists at root) |
| Insert `""`, then search `""` | `true` |
| Insert `"a"`, then search `""` | `true` only if you also marked `root.isEnd` for `""` |
| Insert `"car"`, then search `"ca"` | `false`; `startsWith("ca")` is `true` |
| Insert `"car"`, `"car"` twice | Idempotent: only the terminal flag matters, nothing duplicates |
| Insert `"car"`, `"card"`, delete `"car"` | After delete, `"card"` still returns true; `"car*"` becomes non-terminal but the node stays because of the child |
| Insert `"card"`, delete `"car"` (which was never inserted) | No-op; trie unchanged |
| Unicode key with combining characters | Behavior depends on normalization; document your choice |
| Very long key (10⁶ chars) | Works but allocates 10⁶ nodes for a single key — pathological |
| Key with characters outside the alphabet | Throw, or expand the alphabet |

---

<a name="common-mistakes"></a>
## 15. Common Mistakes

1. **Omitting `isEnd`.** "ca" returns true after inserting "cat" because the path exists. The single most common beginner bug.

2. **Confusing `search` and `startsWith`.** `search` requires `isEnd`; `startsWith` does not. Mixing them up is the second most common bug.

3. **Forgetting case normalization.** "CAT" doesn't match "cat" in a case-sensitive trie. Normalize at the boundary.

4. **Forgetting Unicode normalization.** "café" (NFC) and "café" (NFD) look the same but live at different paths.

5. **Not handling out-of-range characters.** `c - 'a'` for `c = '#'` gives a negative array index. Crashes or reads garbage.

6. **Allocating a 26-pointer array per node when the alphabet is full Unicode.** Wastes 1 million pointers per node. Use a map.

7. **Forgetting to clear/unmark `isEnd` on delete.** "search returns true forever" bug.

8. **Not cleaning up empty subtrees on delete.** Memory leak: dead nodes accumulate.

9. **Storing the full key at every leaf "just in case".** Multiplies memory by L unnecessarily.

10. **Using a trie when a HashSet would do.** If you never do prefix or range queries, a HashSet is smaller and faster.

11. **Treating the trie as a multiset.** A trie is a **set**; the second insert of "cat" is a no-op. To count, augment the node with a counter. See `tasks.md` task 5.

12. **Walking past the end of the input string** in iterative code — classic off-by-one when the loop index is shared with a child-array index.

---

<a name="cheat-sheet"></a>
## 16. Cheat Sheet

```
NODE
    children: array[26] | HashMap<Char, Node>
    isEnd:    bool

INSERT(word):
    cur = root
    for ch in word:
        if cur.children[ch] is missing: create
        cur = cur.children[ch]
    cur.isEnd = true

SEARCH(word):
    cur = walk(word)
    return cur != null && cur.isEnd

STARTS_WITH(prefix):
    return walk(prefix) != null

WALK(s):
    cur = root
    for ch in s:
        if cur.children[ch] is missing: return null
        cur = cur.children[ch]
    return cur

DELETE(word):
    recurse to terminal, unset isEnd,
    on return: drop child if it has no children and is not terminal

ENUMERATE_PREFIX(prefix):
    walk to prefix node; DFS in alphabet order collecting isEnd nodes

COMPLEXITY
    Insert / search / startsWith / delete: O(L)
    Space: O(N · L · |Σ|) worst, O(N + L · |Σ|) with full sharing
    Independent of N for the time complexity
```

---

<a name="animation"></a>
## 17. Visual Animation Reference

See `animation.html` in this folder. It draws the trie as a top-down tree, animates insertions character by character (following existing edges then branching), animates searches with green/red/yellow highlighting (found / not found / prefix-only), and lists the stored words in a side panel. A statistics panel shows node count, total characters stored, longest word, and alphabet size. Build your intuition by inserting a small dictionary and watching the path overlap grow.

---

<a name="summary"></a>
## 18. Summary

- A **trie** is a tree where each edge is labeled with a character. Each path from the root spells a prefix; each node stores a boolean `isEnd` marking whether that prefix is a stored key.
- **Insert, search, and startsWith all run in O(L)** where L is the query length, **independent of how many strings are stored**. This is the defining property.
- **Shared prefixes share paths**, giving memory savings on prefix-heavy datasets (English text, IP addresses, URLs).
- Use **array children** for small alphabets (a..z, 0..9, ASCII); use **HashMap children** for Unicode or unknown alphabets.
- The **terminal flag (`isEnd`) is mandatory** because one stored word may be a prefix of another.
- Normalize input (case + Unicode NFC) at the boundary.
- Tries are everywhere: autocomplete, spell-check, T9, IP routing, BPE tokenizers, Ethereum's Merkle Patricia Trie. We will see those in `senior.md`.
- Read `middle.md` next for compressed tries, ternary search trees, suffix tries, Aho-Corasick, and DAWGs.

---

<a name="further-reading"></a>
## 19. Further Reading

- **Briandais (René de la)**, *"File Searching Using Variable Length Keys"*, Proceedings of the Western Joint Computer Conference, 1959. The original description.
- **Fredkin, Edward**, *"Trie Memory"*, Communications of the ACM 3:9, pp. 490–499, 1960. Coined the name "trie" from "retrieval".
- **Knuth, Donald E.**, *The Art of Computer Programming, Volume 3: Sorting and Searching*, 2nd ed., Addison-Wesley, 1998. §6.3 "Digital Searching" — the definitive analysis, including memory and depth bounds.
- **Sedgewick, Robert & Wayne, Kevin**, *Algorithms*, 4th ed., Addison-Wesley, 2011. Chapter 5.2 "Tries" — practical implementations.
- **Gusfield, Dan**, *Algorithms on Strings, Trees, and Sequences*, Cambridge University Press, 1997. Comprehensive treatment of trie variants including suffix structures.
- CLRS (Cormen, Leiserson, Rivest, Stein) does **not** cover tries in detail — surprising omission. Use Knuth or Sedgewick.
- LeetCode problems 208, 211, 212, 648, 677, 720, 1268. We solve all of these in `interview.md`.
- Continue with `middle.md` for compressed tries, suffix tries, Aho-Corasick, and DAWGs.
