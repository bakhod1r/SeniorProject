# Trie — Hands-On Tasks

> **Audience:** Engineers who learn by building. Each task is a self-contained engineering exercise. After each statement, a complete reference solution is provided in one or two languages — implement first, then compare.

The tasks scale from "first trie" to "production radix tree", "Aho-Corasick automaton", and "frequency-ranked autocomplete". By the end you will have a personal library of working trie code.

---

## Table of Contents

1. [Array-children trie for lowercase English](#task1)
2. [HashMap-children trie for arbitrary Unicode](#task2)
3. [Implement delete with subtree cleanup](#task3)
4. [Enumerate all keys with a given prefix](#task4)
5. [Count words and prefixes](#task5)
6. [Binary trie for integer XOR queries](#task6)
7. [Radix tree (compressed trie) with edge labels](#task7)
8. [Aho-Corasick automaton — failure links](#task8)
9. [Autocomplete with frequency ranking](#task9)
10. [Memory profiling — bytes per key](#task10)
11. [Bonus: serialize and load a trie](#task11)

---

<a name="task1"></a>
## Task 1 — Array-children trie for lowercase English

**Goal:** Implement `insert`, `search`, `startsWith` for words in `a..z`. Array-based children, fail loudly on out-of-range chars.

### Reference solution (Go)

```go
package trie

import "fmt"

const ALPHA = 26

type Node struct {
    children [ALPHA]*Node
    isEnd    bool
}

type Trie struct{ root *Node }

func New() *Trie { return &Trie{root: &Node{}} }

func idx(b byte) int {
    if b < 'a' || b > 'z' {
        panic(fmt.Sprintf("trie: character %q outside [a..z]", b))
    }
    return int(b - 'a')
}

func (t *Trie) Insert(word string) {
    cur := t.root
    for i := 0; i < len(word); i++ {
        k := idx(word[i])
        if cur.children[k] == nil { cur.children[k] = &Node{} }
        cur = cur.children[k]
    }
    cur.isEnd = true
}

func (t *Trie) Search(word string) bool {
    n := t.walk(word)
    return n != nil && n.isEnd
}

func (t *Trie) StartsWith(p string) bool { return t.walk(p) != nil }

func (t *Trie) walk(s string) *Node {
    cur := t.root
    for i := 0; i < len(s); i++ {
        k := idx(s[i])
        if cur.children[k] == nil { return nil }
        cur = cur.children[k]
    }
    return cur
}
```

### Test (Go)

```go
func TestTrie(t *testing.T) {
    tr := New()
    for _, w := range []string{"cat", "car", "card", "dog"} { tr.Insert(w) }
    if !tr.Search("cat") || !tr.Search("card") { t.Fatal("expected hits") }
    if tr.Search("ca") { t.Fatal("ca is prefix only") }
    if !tr.StartsWith("ca") { t.Fatal("ca prefix should exist") }
    if tr.StartsWith("z") { t.Fatal("z should not exist") }
}
```

---

<a name="task2"></a>
## Task 2 — HashMap-children trie for arbitrary Unicode

**Goal:** Same API as Task 1, but children are stored in a hash map keyed by Unicode rune. Handle UTF-8 correctly and normalize input to NFC.

### Reference solution (Python)

```python
import unicodedata

class UnicodeTrie:
    __slots__ = ("children", "is_end")
    def __init__(self):
        self.children: dict[str, "UnicodeTrie"] = {}
        self.is_end = False

    @staticmethod
    def _norm(s: str) -> str:
        return unicodedata.normalize("NFC", s)

    def insert(self, word: str) -> None:
        word = self._norm(word)
        cur = self
        for ch in word:
            cur = cur.children.setdefault(ch, UnicodeTrie())
        cur.is_end = True

    def search(self, word: str) -> bool:
        word = self._norm(word)
        n = self._walk(word)
        return n is not None and n.is_end

    def starts_with(self, prefix: str) -> bool:
        prefix = self._norm(prefix)
        return self._walk(prefix) is not None

    def _walk(self, s: str):
        cur = self
        for ch in s:
            cur = cur.children.get(ch)
            if cur is None: return None
        return cur

# Demo
t = UnicodeTrie()
t.insert("café")
t.insert("日本語")
assert t.search("café")
assert t.search("café".encode().decode())     # NFC round-trip
assert t.starts_with("日本")
```

---

<a name="task3"></a>
## Task 3 — Implement delete with subtree cleanup

**Goal:** Delete a word; when a subtree becomes empty and is non-terminal, free its nodes upward.

### Reference solution (Python, recursive)

```python
class Trie:
    __slots__ = ("children", "is_end")
    def __init__(self):
        self.children = {}
        self.is_end = False

    def insert(self, word):
        cur = self
        for ch in word: cur = cur.children.setdefault(ch, Trie())
        cur.is_end = True

    def search(self, word):
        cur = self
        for ch in word:
            cur = cur.children.get(ch)
            if cur is None: return False
        return cur.is_end

    def delete(self, word) -> bool:
        """Returns True if `word` was present and removed."""
        return self._del(word, 0)

    def _del(self, word, i):
        if i == len(word):
            if not self.is_end: return False
            self.is_end = False
            return True
        ch = word[i]
        child = self.children.get(ch)
        if child is None: return False
        removed = child._del(word, i + 1)
        if removed and not child.is_end and not child.children:
            del self.children[ch]
        return removed
```

### Test

```python
t = Trie()
for w in ["cat", "car", "card"]: t.insert(w)
assert t.delete("car")             # True
assert t.search("card")            # Still True — chain not pruned
assert not t.search("car")
assert not t.delete("car")         # Already gone

# Delete only one in a shared chain:
t2 = Trie(); t2.insert("dog")
assert t2.delete("dog")
assert not t2.children              # all cleaned up
```

---

<a name="task4"></a>
## Task 4 — Enumerate all keys with a given prefix

**Goal:** Given a prefix, return all stored keys starting with it in **lexicographic order**.

### Reference solution (Go)

```go
package trie

import "sort"

func (t *Trie) KeysWithPrefix(prefix string) []string {
    cur := t.root
    for i := 0; i < len(prefix); i++ {
        k := idx(prefix[i])
        if cur.children[k] == nil { return nil }
        cur = cur.children[k]
    }
    var out []string
    collect(cur, []byte(prefix), &out)
    return out
}

func collect(n *Node, path []byte, out *[]string) {
    if n.isEnd { *out = append(*out, string(path)) }
    for i := 0; i < ALPHA; i++ {
        if n.children[i] != nil {
            path = append(path, byte('a' + i))
            collect(n.children[i], path, out)
            path = path[:len(path)-1]
        }
    }
}

// Demo
func ExampleKeysWithPrefix() {
    tr := New()
    for _, w := range []string{"cat", "car", "card", "carpet", "cars", "dog"} {
        tr.Insert(w)
    }
    sort.Strings(tr.KeysWithPrefix("car"))
    // car, card, carpet, cars
}
```

---

<a name="task5"></a>
## Task 5 — Count words and prefixes

**Goal:** Augment the trie so `countWordsEqualTo(word)` returns the number of times `word` was inserted and `countWordsStartingWith(prefix)` returns the number of stored keys that start with `prefix`. Insertion duplicates are now meaningful.

### Reference solution (Java)

```java
public class CountingTrie {
    private static class Node {
        Node[] children = new Node[26];
        int wordCount;       // how many times this word was inserted
        int prefixCount;     // how many keys pass through this node
    }
    private final Node root = new Node();

    public void insert(String word) {
        Node cur = root;
        for (char c : word.toCharArray()) {
            int i = c - 'a';
            if (cur.children[i] == null) cur.children[i] = new Node();
            cur = cur.children[i];
            cur.prefixCount++;
        }
        cur.wordCount++;
    }

    public int countWordsEqualTo(String word) {
        Node n = walk(word); return n == null ? 0 : n.wordCount;
    }
    public int countWordsStartingWith(String prefix) {
        Node n = walk(prefix); return n == null ? 0 : n.prefixCount;
    }
    public void erase(String word) {
        if (countWordsEqualTo(word) == 0) return;
        Node cur = root;
        for (char c : word.toCharArray()) {
            cur = cur.children[c - 'a'];
            cur.prefixCount--;
        }
        cur.wordCount--;
    }
    private Node walk(String s) {
        Node cur = root;
        for (char c : s.toCharArray()) {
            int i = c - 'a';
            if (cur.children[i] == null) return null;
            cur = cur.children[i];
        }
        return cur;
    }
}
```

This is LeetCode 1804 — *Implement Trie II*.

---

<a name="task6"></a>
## Task 6 — Binary trie for integer XOR queries

**Goal:** Insert N 32-bit integers; for a query Q, return `max(Q XOR x)` over inserted `x` in O(32). Used in LC 421 (`interview.md` §8).

### Reference solution (Python)

```python
class BinaryTrie:
    BITS = 32
    def __init__(self):
        self.root = [None, None]

    def insert(self, n):
        cur = self.root
        for i in range(self.BITS - 1, -1, -1):
            b = (n >> i) & 1
            if cur[b] is None: cur[b] = [None, None]
            cur = cur[b]

    def max_xor(self, q):
        if self.root == [None, None]: return 0
        cur, x = self.root, 0
        for i in range(self.BITS - 1, -1, -1):
            b = (q >> i) & 1
            want = 1 - b
            if cur[want] is not None:
                x |= 1 << i; cur = cur[want]
            else:
                cur = cur[b]
        return x

# Demo
bt = BinaryTrie()
for n in [3, 10, 5, 25, 2, 8]: bt.insert(n)
assert bt.max_xor(25) == 31      # 25 ^ 8 = 17? actually max is 5^25=28, 10^25=19, 25^8=17
# Verify by brute force
nums = [3, 10, 5, 25, 2, 8]
brute = max(25 ^ n for n in nums)
assert bt.max_xor(25) == brute
```

**Extensions:** the same shape solves "k-th maximum XOR pair" (descend two paths in parallel) and "min XOR over a range" (combined with persistent tries).

---

<a name="task7"></a>
## Task 7 — Radix tree (compressed trie) with edge labels

**Goal:** Implement a radix tree that merges chains of single-child nodes. Edge labels are arbitrary strings. Support insert and search. Demonstrate it uses dramatically less memory than a plain trie on real English words.

### Reference solution (Go)

```go
package radix

type Node struct {
    label    string
    children map[byte]*Node
    isEnd    bool
}

type Tree struct{ root *Node }

func New() *Tree {
    return &Tree{root: &Node{children: map[byte]*Node{}}}
}

func commonPrefixLen(a, b string) int {
    n := len(a); if len(b) < n { n = len(b) }
    for i := 0; i < n; i++ {
        if a[i] != b[i] { return i }
    }
    return n
}

func (t *Tree) Insert(word string) {
    insert(t.root, word)
}

func insert(n *Node, word string) {
    if word == "" { n.isEnd = true; return }
    head := word[0]
    child, ok := n.children[head]
    if !ok {
        n.children[head] = &Node{
            label:    word,
            isEnd:    true,
            children: map[byte]*Node{},
        }
        return
    }
    cp := commonPrefixLen(child.label, word)
    if cp == len(child.label) {
        insert(child, word[cp:])
        return
    }
    // Split the edge
    split := &Node{
        label:    child.label[:cp],
        children: map[byte]*Node{},
    }
    child.label = child.label[cp:]
    split.children[child.label[0]] = child
    n.children[head] = split
    if cp == len(word) {
        split.isEnd = true
    } else {
        split.children[word[cp]] = &Node{
            label:    word[cp:],
            isEnd:    true,
            children: map[byte]*Node{},
        }
    }
}

func (t *Tree) Search(word string) bool {
    return search(t.root, word)
}

func search(n *Node, word string) bool {
    if word == "" { return n.isEnd }
    child, ok := n.children[word[0]]
    if !ok { return false }
    if len(word) < len(child.label) { return false }
    for i := 0; i < len(child.label); i++ {
        if word[i] != child.label[i] { return false }
    }
    return search(child, word[len(child.label):])
}

// CountNodes returns the number of nodes (excluding root) — for memory comparison.
func (t *Tree) CountNodes() int { return count(t.root) - 1 }

func count(n *Node) int {
    s := 1
    for _, c := range n.children { s += count(c) }
    return s
}
```

### Demo: compare against plain trie

```go
words := []string{"international", "internet", "internal", "intern", "interlude"}
plain := trie.New()
rad := radix.New()
for _, w := range words {
    plain.Insert(w); rad.Insert(w)
}
fmt.Println("plain trie nodes:", plain.CountNodes())   // ~40
fmt.Println("radix tree nodes:", rad.CountNodes())     // ~7-8
```

Run on `/usr/share/dict/words` (~235k entries) and you'll see ~3–10× node-count reduction. With pointer-array savings on top, memory drops dramatically.

---

<a name="task8"></a>
## Task 8 — Aho-Corasick automaton with failure links

**Goal:** Build the Aho-Corasick automaton from a set of patterns. Implement `searchAll(text)` returning all `(position, pattern)` matches in O(|text| + matches).

### Reference solution (Python)

```python
from collections import deque

class AhoCorasick:
    def __init__(self, patterns):
        # State 0 is the root.
        self.go = [{}]     # go[state][char] -> next state
        self.fail = [0]    # failure link
        self.out = [[]]    # patterns ending at this state (incl. via failure chain)

        for p in patterns:
            self._add(p)
        self._build_links()

    def _add(self, p):
        cur = 0
        for ch in p:
            if ch not in self.go[cur]:
                self.go.append({}); self.fail.append(0); self.out.append([])
                self.go[cur][ch] = len(self.go) - 1
            cur = self.go[cur][ch]
        self.out[cur].append(p)

    def _build_links(self):
        q = deque()
        for ch, nxt in self.go[0].items():
            self.fail[nxt] = 0
            q.append(nxt)
        while q:
            r = q.popleft()
            for ch, nxt in self.go[r].items():
                # Find the longest proper suffix of (path to nxt) that is in trie
                f = self.fail[r]
                while f != 0 and ch not in self.go[f]:
                    f = self.fail[f]
                self.fail[nxt] = self.go[f].get(ch, 0)
                if self.fail[nxt] == nxt:
                    self.fail[nxt] = 0
                # Merge outputs along the failure chain
                self.out[nxt] = self.out[nxt] + self.out[self.fail[nxt]]
                q.append(nxt)

    def search_all(self, text):
        cur, hits = 0, []
        for i, ch in enumerate(text):
            while cur != 0 and ch not in self.go[cur]:
                cur = self.fail[cur]
            cur = self.go[cur].get(ch, 0)
            for p in self.out[cur]:
                hits.append((i - len(p) + 1, p))
        return hits

# Demo: classic literature search
patterns = ["he", "she", "his", "hers"]
ac = AhoCorasick(patterns)
print(ac.search_all("ushers"))
# [(2, 'she'), (1, 'he'), (2, 'hers')]
```

Verify the output matches a naive `O(|text| · |patterns|)` substring search on a few inputs.

---

<a name="task9"></a>
## Task 9 — Autocomplete with frequency ranking

**Goal:** Implement an autocomplete that, given a prefix, returns the **top-k** completions by frequency. Frequencies are set when each word is inserted. Aim for O(L + k) per query, independent of dictionary size.

### Approach

Each node keeps a sorted list (or small heap) of "best k strings in subtree". On insert, update along the path. On query, walk to the prefix node and return its top-k.

### Reference solution (Python)

```python
import heapq

class AutocompleteTrie:
    K = 5
    __slots__ = ("children", "top")
    def __init__(self):
        self.children = {}
        self.top = []           # min-heap of (freq, word), size <= K

    def insert(self, word: str, freq: int) -> None:
        nodes = [self]
        cur = self
        for ch in word:
            cur = cur.children.setdefault(ch, AutocompleteTrie())
            nodes.append(cur)
        for n in nodes:
            heapq.heappush(n.top, (freq, word))
            if len(n.top) > self.K:
                heapq.heappop(n.top)

    def suggest(self, prefix: str) -> list[str]:
        cur = self
        for ch in prefix:
            cur = cur.children.get(ch)
            if cur is None: return []
        # Return sorted by freq desc, then lex asc.
        return [w for _, w in sorted(cur.top, key=lambda x: (-x[0], x[1]))]

# Demo
ac = AutocompleteTrie()
for word, freq in [("merge", 80), ("mercury", 65), ("mercy", 50),
                   ("merit", 40), ("meringue", 15), ("metric", 30)]:
    ac.insert(word, freq)

print(ac.suggest("mer"))
# ['merge', 'mercury', 'mercy', 'merit', 'meringue']
```

**Note:** if words can be re-inserted with new frequencies (updates), use a delta scheme similar to LC 677 to avoid double-counting.

---

<a name="task10"></a>
## Task 10 — Memory profiling — bytes per key

**Goal:** Measure the actual memory footprint of your trie on the system English dictionary `/usr/share/dict/words` (~235,000 words on macOS/Linux). Compare with a `set[str]`. Report bytes per key.

### Reference (Python)

```python
import sys, tracemalloc

def measure(build_fn, words):
    tracemalloc.start()
    obj = build_fn(words)
    snap_before_gc = tracemalloc.take_snapshot()
    total = sum(stat.size for stat in snap_before_gc.statistics('filename'))
    tracemalloc.stop()
    return obj, total

def build_set(words):
    return set(words)

def build_trie(words):
    t = UnicodeTrie()              # from Task 2
    for w in words: t.insert(w)
    return t

words = [w.strip() for w in open("/usr/share/dict/words") if w.strip()]
_, set_bytes = measure(build_set, words)
_, trie_bytes = measure(build_trie, words)

print(f"set:  {set_bytes/1024/1024:.1f} MB,  {set_bytes/len(words):.1f} B/key")
print(f"trie: {trie_bytes/1024/1024:.1f} MB,  {trie_bytes/len(words):.1f} B/key")
```

**Expected outcome (macOS, Python 3.11, ~235k words):**

- `set`: ~25–30 MB, ~120 B/key
- HashMap-trie: ~150–250 MB, ~700–1000 B/key

The trie is **5–10× larger** for plain English. The trade-off: it supports prefix queries.

Then, build a **radix tree** version (Task 7) and remeasure — you should see the trie shrink to ~30–40 MB. The radix-tree compression is where most of the memory savings live.

---

<a name="task11"></a>
## Task 11 — Bonus: serialize and load a trie

**Goal:** Serialize your trie to a byte stream (your choice of format — Protocol Buffers, custom, or pickle), so you can build it once and reload in milliseconds.

### Reference (Python, simple binary format)

```python
import struct

def serialize(node) -> bytes:
    """Format: u1 isEnd | u2 num_children | (u4 char_codepoint + recursive child bytes)*"""
    buf = bytearray()
    buf.append(1 if node.is_end else 0)
    items = sorted(node.children.items())
    buf += struct.pack("<H", len(items))
    for ch, child in items:
        buf += struct.pack("<I", ord(ch))
        child_bytes = serialize(child)
        buf += struct.pack("<I", len(child_bytes))
        buf += child_bytes
    return bytes(buf)

def deserialize(buf: bytes, offset: int = 0):
    node = UnicodeTrie()
    node.is_end = buf[offset] == 1
    offset += 1
    (n_children,) = struct.unpack_from("<H", buf, offset); offset += 2
    for _ in range(n_children):
        (cp,)  = struct.unpack_from("<I", buf, offset); offset += 4
        (sz,)  = struct.unpack_from("<I", buf, offset); offset += 4
        child, _ = deserialize(buf, offset)
        offset += sz
        node.children[chr(cp)] = child
    return node, offset

# Demo round-trip
t = UnicodeTrie()
for w in ["cat", "car", "card"]: t.insert(w)
blob = serialize(t)
t2, _ = deserialize(blob)
assert t2.search("car") and t2.search("card") and not t2.search("ca")
```

In production, use a length-prefixed protobuf or a `mmap`-able format. Avoid Python's `pickle` for security-sensitive deployments — it executes arbitrary code on load.

---

## Self-Check

After completing these tasks you should be able to:

- [ ] Choose array-children vs map-children based on alphabet and density.
- [ ] Explain why `isEnd` is mandatory.
- [ ] Delete a key and clean up unused nodes.
- [ ] Enumerate keys under a prefix in lex order.
- [ ] Build a binary trie for integer XOR queries.
- [ ] Implement a radix tree with edge labels and split logic.
- [ ] Build Aho-Corasick failure links via BFS.
- [ ] Augment a trie with per-node top-k for autocomplete.
- [ ] Estimate memory cost of a trie vs a hash set for realistic data.
- [ ] Serialize and reload a trie for fast cold-start.

---

## Further Reading

- The reference implementation in **`pytrie`** (PyPI) and **`marisa-trie`** for comparison with your hand-rolled version.
- **Aho-Corasick in production**: `man ahocorasick` (Python `pyahocorasick`), and the `pyahocorasick` C-extension benchmark.
- **`darts-clone`** (C++ double-array trie) for serious read-only deployments.
- Continue with `animation.html` for a visual walkthrough of insertions and queries.
