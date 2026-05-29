# Trie — Interview Problems

> **Audience:** Engineers preparing for technical interviews. Each problem is stated, solved in Go / Java / Python, and followed by an analysis of time and space complexity.

The trie is a high-signal data structure in interviews: solving a problem with one usually shows you can spot the prefix-shape of a problem. This document collects the canonical 12 problems, in roughly increasing difficulty.

---

## Table of Contents

1. [LC 208 — Implement Trie](#lc208)
2. [LC 211 — Design Add and Search Words (wildcards)](#lc211)
3. [LC 648 — Replace Words](#lc648)
4. [LC 677 — Map Sum Pairs](#lc677)
5. [LC 720 — Longest Word in Dictionary](#lc720)
6. [LC 1268 — Search Suggestions System](#lc1268)
7. [LC 212 — Word Search II (trie + DFS on grid)](#lc212)
8. [LC 421 — Maximum XOR of Two Numbers (binary trie)](#lc421)
9. [LC 745 — Stream of Characters (Aho-Corasick-lite)](#lc745)
10. [LC 588 — Design In-Memory File System](#lc588)
11. [Aho-Corasick — Multi-Pattern Search](#aho)
12. [Spell Checker — Edit Distance ≤ 1 Suggestions](#spell)

---

<a name="lc208"></a>
## 1. LC 208 — Implement Trie (Prefix Tree)

> Implement `insert(word)`, `search(word)`, `startsWith(prefix)`. All operations on lowercase letters.

The warm-up. Covered fully in `junior.md` §9. Recap solution:

### Go

```go
type Trie struct {
    children [26]*Trie
    isEnd    bool
}

func Constructor() Trie { return Trie{} }

func (t *Trie) Insert(word string) {
    cur := t
    for i := 0; i < len(word); i++ {
        idx := word[i] - 'a'
        if cur.children[idx] == nil { cur.children[idx] = &Trie{} }
        cur = cur.children[idx]
    }
    cur.isEnd = true
}

func (t *Trie) Search(word string) bool {
    n := t.walk(word)
    return n != nil && n.isEnd
}

func (t *Trie) StartsWith(p string) bool { return t.walk(p) != nil }

func (t *Trie) walk(s string) *Trie {
    cur := t
    for i := 0; i < len(s); i++ {
        idx := s[i] - 'a'
        if cur.children[idx] == nil { return nil }
        cur = cur.children[idx]
    }
    return cur
}
```

### Java

```java
class Trie {
    private final Trie[] children = new Trie[26];
    private boolean isEnd;

    public void insert(String word) {
        Trie cur = this;
        for (char c : word.toCharArray()) {
            int i = c - 'a';
            if (cur.children[i] == null) cur.children[i] = new Trie();
            cur = cur.children[i];
        }
        cur.isEnd = true;
    }

    public boolean search(String word) {
        Trie n = walk(word);
        return n != null && n.isEnd;
    }

    public boolean startsWith(String prefix) { return walk(prefix) != null; }

    private Trie walk(String s) {
        Trie cur = this;
        for (char c : s.toCharArray()) {
            int i = c - 'a';
            if (cur.children[i] == null) return null;
            cur = cur.children[i];
        }
        return cur;
    }
}
```

### Python

```python
class Trie:
    def __init__(self):
        self.children = {}
        self.is_end = False

    def insert(self, word: str) -> None:
        cur = self
        for ch in word:
            if ch not in cur.children:
                cur.children[ch] = Trie()
            cur = cur.children[ch]
        cur.is_end = True

    def search(self, word: str) -> bool:
        n = self._walk(word)
        return n is not None and n.is_end

    def startsWith(self, prefix: str) -> bool:
        return self._walk(prefix) is not None

    def _walk(self, s: str):
        cur = self
        for ch in s:
            cur = cur.children.get(ch)
            if cur is None: return None
        return cur
```

**Complexity:** O(L) per operation; O(N · L) space.

---

<a name="lc211"></a>
## 2. LC 211 — Design Add and Search Words (wildcards)

> Implement `addWord(word)` and `search(word)`, where `search` may contain `'.'` matching any letter.

Recursive DFS: at a `'.'`, branch into all 26 children.

### Python

```python
class WordDictionary:
    def __init__(self):
        self.children = {}
        self.is_end = False

    def addWord(self, word):
        cur = self
        for ch in word:
            cur = cur.children.setdefault(ch, WordDictionary())
        cur.is_end = True

    def search(self, word):
        return self._dfs(self, word, 0)

    def _dfs(self, node, word, i):
        if i == len(word):
            return node.is_end
        ch = word[i]
        if ch == '.':
            return any(self._dfs(c, word, i + 1) for c in node.children.values())
        nxt = node.children.get(ch)
        return False if nxt is None else self._dfs(nxt, word, i + 1)
```

### Go

```go
type WordDictionary struct {
    children [26]*WordDictionary
    isEnd    bool
}

func (d *WordDictionary) AddWord(word string) {
    cur := d
    for i := 0; i < len(word); i++ {
        idx := word[i] - 'a'
        if cur.children[idx] == nil { cur.children[idx] = &WordDictionary{} }
        cur = cur.children[idx]
    }
    cur.isEnd = true
}

func (d *WordDictionary) Search(word string) bool {
    return dfs(d, word, 0)
}
func dfs(n *WordDictionary, w string, i int) bool {
    if n == nil { return false }
    if i == len(w) { return n.isEnd }
    if w[i] == '.' {
        for _, c := range n.children {
            if dfs(c, w, i+1) { return true }
        }
        return false
    }
    return dfs(n.children[w[i]-'a'], w, i+1)
}
```

### Java

```java
class WordDictionary {
    private final WordDictionary[] children = new WordDictionary[26];
    private boolean isEnd;

    public void addWord(String word) {
        WordDictionary cur = this;
        for (char c : word.toCharArray()) {
            int i = c - 'a';
            if (cur.children[i] == null) cur.children[i] = new WordDictionary();
            cur = cur.children[i];
        }
        cur.isEnd = true;
    }

    public boolean search(String word) { return dfs(this, word, 0); }

    private boolean dfs(WordDictionary n, String w, int i) {
        if (n == null) return false;
        if (i == w.length()) return n.isEnd;
        char c = w.charAt(i);
        if (c == '.') {
            for (WordDictionary child : n.children)
                if (dfs(child, w, i + 1)) return true;
            return false;
        }
        return dfs(n.children[c - 'a'], w, i + 1);
    }
}
```

**Complexity:** Worst-case search O(26^d) where d = number of `.`s; typically O(L · branching).

---

<a name="lc648"></a>
## 3. LC 648 — Replace Words

> Given a dictionary of roots and a sentence, replace every word with the shortest root that is its prefix.

Build a trie of roots. For each word, walk the trie until you hit a terminal node; emit that prefix.

### Python

```python
class Solution:
    def replaceWords(self, dictionary, sentence):
        root = {}
        for w in dictionary:
            cur = root
            for ch in w:
                cur = cur.setdefault(ch, {})
            cur['$'] = True

        def shortest(word):
            cur = root
            buf = []
            for ch in word:
                if ch not in cur: return word
                buf.append(ch)
                cur = cur[ch]
                if cur.get('$'): return ''.join(buf)
            return word

        return ' '.join(shortest(w) for w in sentence.split())
```

### Go

```go
type rNode struct {
    ch    [26]*rNode
    isEnd bool
}

func replaceWords(dictionary []string, sentence string) string {
    root := &rNode{}
    for _, w := range dictionary {
        cur := root
        for i := 0; i < len(w); i++ {
            idx := w[i] - 'a'
            if cur.ch[idx] == nil { cur.ch[idx] = &rNode{} }
            cur = cur.ch[idx]
        }
        cur.isEnd = true
    }
    parts := strings.Split(sentence, " ")
    for i, w := range parts {
        cur := root
        for j := 0; j < len(w); j++ {
            idx := w[j] - 'a'
            if cur.ch[idx] == nil { break }
            cur = cur.ch[idx]
            if cur.isEnd { parts[i] = w[:j+1]; break }
        }
    }
    return strings.Join(parts, " ")
}
```

### Java

```java
class Solution {
    static class N { N[] c = new N[26]; boolean end; }
    public String replaceWords(List<String> dict, String sentence) {
        N root = new N();
        for (String w : dict) {
            N cur = root;
            for (char ch : w.toCharArray()) {
                int i = ch - 'a';
                if (cur.c[i] == null) cur.c[i] = new N();
                cur = cur.c[i];
            }
            cur.end = true;
        }
        String[] parts = sentence.split(" ");
        for (int k = 0; k < parts.length; k++) {
            N cur = root; StringBuilder sb = new StringBuilder();
            for (char ch : parts[k].toCharArray()) {
                int i = ch - 'a';
                if (cur.c[i] == null) { sb.setLength(0); break; }
                cur = cur.c[i]; sb.append(ch);
                if (cur.end) { parts[k] = sb.toString(); break; }
            }
        }
        return String.join(" ", parts);
    }
}
```

**Complexity:** O(total dictionary chars + total sentence chars).

---

<a name="lc677"></a>
## 4. LC 677 — Map Sum Pairs

> `insert(key, val)` overrides any prior value. `sum(prefix)` returns the sum of values of all keys starting with prefix.

Store the **delta** so a re-insert correctly updates. Maintain a per-node `sum_in_subtree`.

### Python

```python
class MapSum:
    def __init__(self):
        self.children = {}
        self.sum = 0
        self.vals = {}                          # key → last inserted value, at root only

    def insert(self, key, val):
        delta = val - self.vals.get(key, 0)
        self.vals[key] = val
        cur = self
        for ch in key:
            cur = cur.children.setdefault(ch, MapSum())
            cur.sum += delta

    def sum(self, prefix):
        cur = self
        for ch in prefix:
            cur = cur.children.get(ch)
            if cur is None: return 0
        return cur.sum
```

**Complexity:** insert O(L), sum O(L).

---

<a name="lc720"></a>
## 5. LC 720 — Longest Word in Dictionary

> Find the longest word in `words` such that **every prefix** of it is also in `words`. Ties → lexicographically smallest.

Insert all words, then BFS/DFS the trie following only edges to `isEnd` children (so every step is itself a word). Track the longest path; on tie pick lexicographically smaller.

### Python

```python
class Solution:
    def longestWord(self, words):
        root = {}
        for w in words:
            cur = root
            for ch in w:
                cur = cur.setdefault(ch, {})
            cur['$'] = w
        best = ""
        def dfs(node):
            nonlocal best
            for ch in sorted(node):
                if ch == '$': continue
                child = node[ch]
                if '$' not in child: continue       # word not stored at this prefix
                if len(child['$']) > len(best) or (len(child['$']) == len(best) and child['$'] < best):
                    best = child['$']
                dfs(child)
        dfs(root)
        return best
```

**Complexity:** O(total chars).

---

<a name="lc1268"></a>
## 6. LC 1268 — Search Suggestions System

> Given products and a `searchWord`, after each prefix of `searchWord` return up to 3 lexicographically smallest products that start with that prefix.

Two solutions: **trie with per-node top-3 sorted list**, or **sort + binary search**. The trie shows the right shape; binary search is the punchline that this problem is just a sorted-prefix scan.

### Trie solution (Python)

```python
class Solution:
    def suggestedProducts(self, products, searchWord):
        products.sort()
        root = {}
        for p in products:
            cur = root
            for ch in p:
                cur = cur.setdefault(ch, {'top': []})
                if len(cur['top']) < 3:
                    cur['top'].append(p)
        out = []
        cur = root
        for ch in searchWord:
            cur = cur.get(ch) if cur else None
            out.append(cur['top'] if cur else [])
        return out
```

### Binary-search solution (Python)

```python
from bisect import bisect_left
class Solution:
    def suggestedProducts(self, products, searchWord):
        products.sort()
        out, prefix = [], ""
        for ch in searchWord:
            prefix += ch
            i = bisect_left(products, prefix)
            out.append([p for p in products[i:i+3] if p.startswith(prefix)])
        return out
```

**Complexity:** trie O(total chars); binary search O(L · (log N + 3 · L)).

---

<a name="lc212"></a>
## 7. LC 212 — Word Search II

> Given an M×N board and a list of words, return all words found in the board (8-direction-free, only orthogonal, no cell reuse within one word).

Build a trie of the words. DFS each board cell, walking the trie in parallel with the path on the board. Backtrack on dead ends. **Crucial pruning**: when a leaf word is found, mark it found and *prune the leaf from the trie* to avoid re-finding it.

### Python

```python
class Solution:
    def findWords(self, board, words):
        root = {}
        for w in words:
            cur = root
            for ch in w: cur = cur.setdefault(ch, {})
            cur['$'] = w

        m, n = len(board), len(board[0])
        out = []
        def dfs(r, c, node):
            ch = board[r][c]
            child = node.get(ch)
            if child is None: return
            w = child.pop('$', None)
            if w: out.append(w)
            board[r][c] = '#'
            for dr, dc in ((-1,0),(1,0),(0,-1),(0,1)):
                nr, nc = r+dr, c+dc
                if 0 <= nr < m and 0 <= nc < n and board[nr][nc] != '#':
                    dfs(nr, nc, child)
            board[r][c] = ch
            if not child:
                del node[ch]                       # prune dead branch
        for r in range(m):
            for c in range(n):
                dfs(r, c, root)
        return out
```

**Complexity:** O(m · n · 4^L_max) worst case, but the trie pruning drops it to near-linear in practice. Without a trie, naive solution times out on LC.

---

<a name="lc421"></a>
## 8. LC 421 — Maximum XOR of Two Numbers in an Array

> Given an integer array, find the maximum `a[i] XOR a[j]` over all pairs.

Insert each number's 32-bit representation into a **binary trie**, MSB-first. For each number, greedily walk the trie taking the opposite bit at each step — this maximizes the XOR.

### Python

```python
class Solution:
    def findMaximumXOR(self, nums):
        root = {}
        BITS = max(nums).bit_length()
        for n in nums:
            cur = root
            for i in range(BITS - 1, -1, -1):
                b = (n >> i) & 1
                cur = cur.setdefault(b, {})
        best = 0
        for n in nums:
            cur, x = root, 0
            for i in range(BITS - 1, -1, -1):
                b = (n >> i) & 1
                want = 1 - b
                if want in cur:
                    x |= (1 << i)
                    cur = cur[want]
                else:
                    cur = cur[b]
            best = max(best, x)
        return best
```

### Go

```go
func findMaximumXOR(nums []int) int {
    type node struct{ child [2]*node }
    root := &node{}
    bits := 0
    for _, n := range nums { for n > (1<<bits) { bits++ } }
    if bits == 0 { bits = 1 }
    insert := func(n int) {
        cur := root
        for i := bits - 1; i >= 0; i-- {
            b := (n >> i) & 1
            if cur.child[b] == nil { cur.child[b] = &node{} }
            cur = cur.child[b]
        }
    }
    query := func(n int) int {
        cur, x := root, 0
        for i := bits - 1; i >= 0; i-- {
            b := (n >> i) & 1
            want := 1 - b
            if cur.child[want] != nil {
                x |= 1 << i; cur = cur.child[want]
            } else {
                cur = cur.child[b]
            }
        }
        return x
    }
    for _, n := range nums { insert(n) }
    best := 0
    for _, n := range nums {
        if x := query(n); x > best { best = x }
    }
    return best
}
```

**Complexity:** O(N · 32) — linear in the input, independent of value magnitude.

This pattern (binary trie + greedy XOR) appears in many problems: max XOR of subarray, k-th max XOR pair, etc.

---

<a name="lc745"></a>
## 9. LC 745 — Stream of Characters

> Build a `StreamChecker` over a fixed dictionary; `query(letter)` returns true if any dictionary word matches a suffix of the stream so far.

The trick: store the dictionary **reversed**. Walk the trie with the latest characters reversed. A simpler-than-full-Aho-Corasick approach.

### Python

```python
class StreamChecker:
    def __init__(self, words):
        self.root = {}
        for w in words:
            cur = self.root
            for ch in reversed(w):
                cur = cur.setdefault(ch, {})
            cur['$'] = True
        self.stream = []
        self.max_len = max(len(w) for w in words)

    def query(self, letter):
        self.stream.append(letter)
        if len(self.stream) > self.max_len:
            self.stream.pop(0)
        cur = self.root
        for ch in reversed(self.stream):
            if '$' in cur: return True
            cur = cur.get(ch)
            if cur is None: return False
        return '$' in cur
```

For true linear-time multi-pattern checking, build the full Aho-Corasick automaton — see §11.

---

<a name="lc588"></a>
## 10. LC 588 — Design In-Memory File System

> Implement `ls`, `mkdir`, `addContentToFile`, `readContentFromFile`. Paths use `/`.

A file system is essentially a trie where each edge is labeled with a path segment (a string, not a character) — this is a **radix tree of paths**.

### Python

```python
class FileSystem:
    def __init__(self):
        self.root = {'_files': {}, '_dirs': {}}

    def _walk(self, path):
        if path == '/': return self.root
        node = self.root
        for seg in path.split('/')[1:]:
            if seg in node['_dirs']:
                node = node['_dirs'][seg]
            elif seg in node['_files']:
                return node['_files'][seg]      # file path
            else:
                return None
        return node

    def ls(self, path):
        node = self._walk(path)
        if isinstance(node, str):
            return [path.split('/')[-1]]
        if node is None: return []
        return sorted(list(node['_dirs']) + list(node['_files']))

    def mkdir(self, path):
        node = self.root
        for seg in path.split('/')[1:]:
            if seg not in node['_dirs']:
                node['_dirs'][seg] = {'_files': {}, '_dirs': {}}
            node = node['_dirs'][seg]

    def addContentToFile(self, filePath, content):
        parts = filePath.split('/')
        dir_path, name = '/'.join(parts[:-1]) or '/', parts[-1]
        self.mkdir(dir_path)
        d = self._walk(dir_path)
        d['_files'][name] = d['_files'].get(name, '') + content

    def readContentFromFile(self, filePath):
        parts = filePath.split('/')
        dir_path, name = '/'.join(parts[:-1]) or '/', parts[-1]
        d = self._walk(dir_path)
        return d['_files'][name]
```

Multi-character edges → radix-tree shape; per-node children indexed by segment string.

---

<a name="aho"></a>
## 11. Aho-Corasick — Multi-Pattern Search

> Build an Aho-Corasick automaton from a set of patterns; given a text, return all (pattern, position) matches.

The interview classic. Covered conceptually in `middle.md` §4; full implementation in `tasks.md` task 8.

### Python (compact)

```python
from collections import deque

class AhoCorasick:
    def __init__(self, patterns):
        self.go = [{}]
        self.fail = [0]
        self.out = [[]]
        for p in patterns:
            cur = 0
            for ch in p:
                if ch not in self.go[cur]:
                    self.go.append({}); self.fail.append(0); self.out.append([])
                    self.go[cur][ch] = len(self.go) - 1
                cur = self.go[cur][ch]
            self.out[cur].append(p)
        # BFS failure links
        q = deque()
        for ch, nxt in self.go[0].items():
            self.fail[nxt] = 0; q.append(nxt)
        while q:
            r = q.popleft()
            for ch, nxt in self.go[r].items():
                f = self.fail[r]
                while f and ch not in self.go[f]: f = self.fail[f]
                self.fail[nxt] = self.go[f].get(ch, 0) if self.go[f].get(ch, 0) != nxt else 0
                self.out[nxt] += self.out[self.fail[nxt]]
                q.append(nxt)

    def search(self, text):
        cur, hits = 0, []
        for i, ch in enumerate(text):
            while cur and ch not in self.go[cur]: cur = self.fail[cur]
            cur = self.go[cur].get(ch, 0)
            for p in self.out[cur]:
                hits.append((i - len(p) + 1, p))
        return hits
```

**Complexity:** O(text + total pattern length + matches).

---

<a name="spell"></a>
## 12. Spell Checker — Edit Distance ≤ 1 Suggestions

> Given a dictionary and a misspelled query, return all dictionary words within edit distance 1 (one insertion / deletion / substitution).

The brute force is "compare query to every dictionary word", O(N · L). A trie cuts this dramatically: walk the trie tracking a **DP row** of edit distances along the way. Prune branches whose minimum cost already exceeds 1.

### Python

```python
def spell_suggest(root, word, max_edits=1):
    out = []
    def dfs(node, path, ch_idx, prev_row):
        cur_row = [prev_row[0] + 1]
        for i, c in enumerate(word):
            ins = cur_row[i] + 1
            dele = prev_row[i + 1] + 1
            sub = prev_row[i] + (0 if c == ch_idx else 1)
            cur_row.append(min(ins, dele, sub))
        if cur_row[-1] <= max_edits and node.get('$'):
            out.append(''.join(path))
        if min(cur_row) <= max_edits:
            for c, child in node.items():
                if c == '$': continue
                path.append(c)
                dfs(child, path, c, cur_row)
                path.pop()
    dfs(root, [], '', list(range(len(word) + 1)))
    return out
```

The pruning (`min(cur_row) <= max_edits`) is what makes this fast: any branch whose cheapest cost already exceeds the budget is skipped. Empirically this is 10–100× faster than the naive N × L scan on English dictionaries.

This is the algorithm behind every spell-checker dropdown you've ever used.

---

## Interview Strategy

When you see a problem with **strings** and any of:

- "prefix" / "starts with"
- "dictionary" / "vocabulary"
- "longest matching ..."
- "search many patterns at once"
- "tab completion" / "autocomplete"
- "word search" / "find all words in a grid"
- "XOR of pairs / max XOR" (binary trie)
- "stream and detect"

reach for a trie first. The right data structure makes most of these problems short and clean; the wrong one makes them intractable.

---

## Further Reading

- LeetCode tag "Trie" — currently ~50 problems; the 12 above cover the major patterns.
- **Sedgewick & Wayne**, *Algorithms*, Chapter 5.2 — for the textbook treatment.
- Continue with `tasks.md` for hands-on implementation tasks with full reference solutions.
