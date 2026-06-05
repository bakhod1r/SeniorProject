# Tries (Prefix Trees) for String Processing — Interview Preparation

Tries are an interview staple because they reward one crisp insight — *"walk one character per edge; `search` checks `isEnd`, `startsWith` does not"* — and then test whether you can (a) implement insert/search/startsWith cleanly in `O(L)`, (b) extend the structure for prefix counting and ranked autocomplete, (c) handle wildcards and DFS-based word problems, and (d) explain when a trie beats a hash set (the prefix operations). This file is a question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Task | Tool | Complexity |
|------|------|------------|
| Add / find a word | `insert` / `search` (walk + `isEnd`) | `O(L)` |
| Any word with prefix `p`? | `startsWith` (walk only) | `O(L)` |
| How many words start with `p`? | `passCount` field | `O(L)` |
| Top-k completions of `p` | walk + size-k heap (or cached per node) | `O(L + S log k)` |
| Wildcard `.` search | DFS over children at `.` positions | `O(Σ^dots · L)` worst |
| Word Search on a grid | trie of words + grid DFS/backtracking | prunes dead branches |
| Longest word built from words | insert all, DFS keeping only `isEnd` chains | `O(m)` |
| Exact membership only | use a **hash set**, not a trie | `O(L)` |

Core skeleton:

```text
insert(w):     cur=root; for c in w: cur=cur.child(c, create=true); cur.isEnd=true
walk(s):       cur=root; for c in s: cur=cur.child(c); if none: return null; return cur
search(w):     n=walk(w); return n!=null && n.isEnd
startsWith(p): return walk(p)!=null
```

Key facts:
- **Cost is `O(L)`**, independent of the number of words `n`.
- `search` needs the final `isEnd` check; `startsWith` does not — the #1 trie bug.
- A node can be both an end-of-word and a waypoint (e.g. `car` inside `card`).
- Tries do prefix queries a hash set **cannot**; that is the whole reason to use one.

---

## Junior Questions (10 Q&A)

### J1. What is a trie and what is it for?
A tree where each edge is one character and each root-to-node path spells a prefix of stored keys. It supports `insert`, exact `search`, and prefix queries (`startsWith`, prefix count, autocomplete) all in `O(L)` — the length of the query, not the number of stored words.

### J2. What does a trie node store?
Links to children (one per possible next character — a map or fixed array) and an `isEnd` boolean marking whether a complete word ends at this node. It does **not** store its own character; the edge label implies it.

### J3. What is the difference between `search` and `startsWith`?
Both walk the query's characters from the root. `search` returns true only if the path exists **and** the final node has `isEnd == true` (a complete word). `startsWith` returns true if the path merely exists, regardless of `isEnd`. So `startsWith("ca")` can be true while `search("ca")` is false.

### J4. What is the time complexity of insert/search/startsWith?
`O(L)` where `L` is the query length — independent of how many words `n` are stored. Each operation follows at most `L` edges.

### J5. Why use a trie instead of a hash set?
A hash set does exact membership in `O(L)` too, but it **cannot** answer prefix questions — `startsWith`, prefix counts, autocomplete — because hashing scrambles strings and destroys prefix relationships. Use a trie the moment you need any prefix operation.

### J6. How do you implement autocomplete?
Walk to the prefix node (`O(L)`); if it exists, DFS the subtree collecting every `isEnd` node, prepending the prefix to each path found.

### J7. Array children or map children?
Array (`children[c-'a']`) is fastest and cache-friendly but wastes `Σ` pointers per node — good for small fixed alphabets. A map stores only existing children — good for sparse or Unicode alphabets. Trade-off: speed/locality vs memory/flexibility.

### J8. What happens if one word is a prefix of another, like `car` and `card`?
They coexist. The `r` node is `isEnd` (for `car`) and also a waypoint to `card`. The `isEnd` flag is exactly what distinguishes the two roles.

### J9. How do you count how many words start with a prefix?
Add a `passCount` field, incremented at every node during insert. Then `walk(prefix).passCount` answers in `O(L)` with no DFS.

### J10. What is the cost of building a trie of all keys?
`O(m)` where `m` is the total number of characters across all keys (each character inserted once).

---

## Mid-Level Questions (8 Q&A)

### M1. How does a compressed (radix) trie differ from a plain trie?
It merges chains of single-child nodes into one edge labeled with a substring, so edges carry strings, not single characters. This bounds node count at `O(n)` (number of keys) instead of `O(m)` (total characters), ideal for long sparse keys. Full detail in `21-advanced-structures/24-25`.

### M2. What is a ternary search trie and when is it useful?
A node holds a character and three children: left (smaller char, same position), right (larger char, same position), mid (matched char, advance position). It is a trie/BST hybrid giving compact storage (3 pointers per node) for large alphabets without an array's waste or a map's per-entry overhead.

### M3. How do you rank autocomplete suggestions?
Store a frequency at each `isEnd` node. To get the top-k, DFS the prefix subtree and keep a size-k min-heap by frequency (`O(S log k)`). For latency-critical typeahead, precompute and cache the top-k at every node so a query is `O(L + k)`.

### M4. How do you delete a word from a trie correctly?
Walk to the end node; if not `isEnd`, the word is absent. Clear `isEnd` (or decrement `wordCount`). Then unwind: delete a node only if it has no children and is not itself an end-of-word — never prune a node another word passes through. A `passCount` field makes the safety check explicit.

### M5. Implement search with a `.` wildcard that matches any character.
DFS: at a normal character, descend the single matching child; at `.`, recurse into **all** children. Worst case `O(Σ^d · L)` where `d` is the number of dots, but typically far less because most branches die quickly.

### M6. How does a trie sort strings?
Insert all strings, then pre-order DFS visiting children in alphabetical order; each `isEnd` node yields the next key in lexicographic order. It is an MSD radix sort, `O(m)`, and deduplicates for free.

### M7. What memory does a trie use vs a hash set?
A hash set is one slot per key, compact and cache-friendly. A trie shares prefixes (saving space when keys overlap) but pays `Σ` pointers per node with arrays, or hash overhead per node with maps — often larger than a hash set for disjoint keys. The win is functionality, not raw size.

### M8. How is a trie used in Aho-Corasick?
The set of patterns is stored as a trie (the goto function); failure links are added to make it a full automaton that scans text in `O(text + matches)`. The trie is the dictionary backbone. See sibling `05`.

---

## Senior Questions (7 Q&A)

### S1. How would you store a 100M-entry dictionary memory-efficiently?
A pointer/map trie would burn 10–20× the raw data in memory. Use a **double-array trie** (two flat integer arrays, cache-friendly, mmap-able) or a **DAWG/MA-FSA** (the minimal DFA, sharing suffixes as well as prefixes). Build offline from sorted keys, serialize, memory-map at load.

### S2. Explain longest-prefix match and where it is used.
Given overlapping prefixes (e.g. IP routes `10/8`, `10.1/16`, `10.1.2/24`), pick the **most specific** match. Walk the address bits down a binary trie and keep the deepest marked node; the default route `/0` is the fallback. This is how routers forward packets.

### S3. Why is a trie operation `O(L)` independent of `n`?
A trie is a DFA; running it on a length-`L` input takes exactly `L` transitions regardless of how many states (words) it has. The run length is bounded by the input, not the state count.

### S4. How do you make a trie safe for concurrent reads with occasional writes?
Build it immutable and serve lock-free reads. For updates, copy nodes along the changed path (copy-on-write), share the rest, and atomically swap the root — readers see a consistent old or new version, never a torn state. Or double-buffer whole dictionaries with an atomic pointer flip.

### S5. What is a DAWG and what does it give up?
A directed acyclic word graph shares suffixes too, yielding the minimal automaton for the key set. The trade-off: shared nodes mean you can no longer attach per-word data by node identity — you need an FST (output along the path) or ordinal-indexed values.

### S6. When would you NOT use a trie?
When you only need exact membership (a hash set is simpler and usually faster), when keys are long and disjoint (a trie wastes nodes), or when cache locality dominates and a flat hash table wins.

### S7. How do you test a trie implementation?
Property-based testing against a brute-force list-of-strings oracle (all queries must agree), serialization round-trips, deletion invariants (other words survive, no orphans, `passCount` recount matches), alphabet fuzzing (Unicode, empty, very long keys), and memory regression checks in CI.

---

## Behavioral Prompts

- **"Tell me about a time you chose a data structure for a feature."** Frame autocomplete: explain why a hash set failed (no prefix queries), why you chose a trie, and how you handled ranking and memory.
- **"Describe a performance problem you debugged."** A pointer trie thrashing the cache on deep keys; you switched to a compact representation and measured the latency drop.
- **"How do you decide between a simple and a complex solution?"** Start with a map trie; only move to radix/DAWG/double-array when profiling shows memory or latency is the bottleneck — avoid premature optimization.
- **"How do you ensure correctness of a tricky data structure?"** Oracle-based property testing and serialization round-trips; explain catching a deletion bug that silently removed sibling words.
- **"How do you communicate a trade-off to non-experts?"** Explain the memory-vs-functionality trade of a trie using the phone-keyboard autocomplete analogy.

---

## Coding Challenge 1: Implement Trie (insert / search / startsWith)

**Problem.** Implement a `Trie` supporting `insert(word)`, `search(word)` (exact), and `startsWith(prefix)`. (LeetCode 208.)

#### Go
```go
package main

import "fmt"

type Trie struct {
	children [26]*Trie
	isEnd    bool
}

func Constructor() Trie { return Trie{} }

func (t *Trie) Insert(word string) {
	cur := t
	for i := 0; i < len(word); i++ {
		c := word[i] - 'a'
		if cur.children[c] == nil {
			cur.children[c] = &Trie{}
		}
		cur = cur.children[c]
	}
	cur.isEnd = true
}

func (t *Trie) find(s string) *Trie {
	cur := t
	for i := 0; i < len(s); i++ {
		c := s[i] - 'a'
		if cur.children[c] == nil {
			return nil
		}
		cur = cur.children[c]
	}
	return cur
}

func (t *Trie) Search(word string) bool {
	n := t.find(word)
	return n != nil && n.isEnd
}

func (t *Trie) StartsWith(prefix string) bool { return t.find(prefix) != nil }

func main() {
	t := Constructor()
	t.Insert("apple")
	fmt.Println(t.Search("apple"))   // true
	fmt.Println(t.Search("app"))     // false
	fmt.Println(t.StartsWith("app")) // true
	t.Insert("app")
	fmt.Println(t.Search("app")) // true
}
```

#### Java
```java
class Trie {
    private final Trie[] children = new Trie[26];
    private boolean isEnd = false;

    public Trie() {}

    public void insert(String word) {
        Trie cur = this;
        for (char ch : word.toCharArray()) {
            int c = ch - 'a';
            if (cur.children[c] == null) cur.children[c] = new Trie();
            cur = cur.children[c];
        }
        cur.isEnd = true;
    }

    private Trie find(String s) {
        Trie cur = this;
        for (char ch : s.toCharArray()) {
            int c = ch - 'a';
            if (cur.children[c] == null) return null;
            cur = cur.children[c];
        }
        return cur;
    }

    public boolean search(String word) {
        Trie n = find(word);
        return n != null && n.isEnd;
    }

    public boolean startsWith(String prefix) { return find(prefix) != null; }

    public static void main(String[] args) {
        Trie t = new Trie();
        t.insert("apple");
        System.out.println(t.search("apple"));   // true
        System.out.println(t.search("app"));     // false
        System.out.println(t.startsWith("app")); // true
    }
}
```

#### Python
```python
class Trie:
    def __init__(self):
        self.children = {}
        self.is_end = False

    def insert(self, word):
        cur = self
        for ch in word:
            if ch not in cur.children:
                cur.children[ch] = Trie()
            cur = cur.children[ch]
        cur.is_end = True

    def _find(self, s):
        cur = self
        for ch in s:
            if ch not in cur.children:
                return None
            cur = cur.children[ch]
        return cur

    def search(self, word):
        n = self._find(word)
        return n is not None and n.is_end

    def starts_with(self, prefix):
        return self._find(prefix) is not None


if __name__ == "__main__":
    t = Trie()
    t.insert("apple")
    print(t.search("apple"))     # True
    print(t.search("app"))       # False
    print(t.starts_with("app"))  # True
```

---

## Coding Challenge 2: Search Suggestions (Autocomplete)

**Problem.** Given `products` and a `searchWord`, after each typed character of `searchWord` return up to 3 lexicographically smallest products that share the typed prefix. (LeetCode 1268.)

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

func suggestedProducts(products []string, searchWord string) [][]string {
	sort.Strings(products)
	res := [][]string{}
	prefix := ""
	for _, ch := range searchWord {
		prefix += string(ch)
		cur := []string{}
		// products is sorted, so first 3 with this prefix are the answer
		for _, p := range products {
			if len(p) >= len(prefix) && p[:len(prefix)] == prefix {
				cur = append(cur, p)
				if len(cur) == 3 {
					break
				}
			}
		}
		res = append(res, cur)
	}
	return res
}

func main() {
	fmt.Println(suggestedProducts(
		[]string{"mobile", "mouse", "moneypot", "monitor", "mousepad"}, "mouse"))
}
```

#### Java
```java
import java.util.*;

public class SearchSuggestions {
    public List<List<String>> suggestedProducts(String[] products, String searchWord) {
        Arrays.sort(products);
        List<List<String>> res = new ArrayList<>();
        StringBuilder prefix = new StringBuilder();
        for (char ch : searchWord.toCharArray()) {
            prefix.append(ch);
            List<String> cur = new ArrayList<>();
            for (String p : products) {
                if (p.startsWith(prefix.toString())) {
                    cur.add(p);
                    if (cur.size() == 3) break;
                }
            }
            res.add(cur);
        }
        return res;
    }

    public static void main(String[] args) {
        System.out.println(new SearchSuggestions().suggestedProducts(
            new String[]{"mobile","mouse","moneypot","monitor","mousepad"}, "mouse"));
    }
}
```

#### Python
```python
class Solution:
    def suggestedProducts(self, products, searchWord):
        products.sort()
        res, prefix = [], ""
        for ch in searchWord:
            prefix += ch
            cur = []
            for p in products:
                if p.startswith(prefix):
                    cur.append(p)
                    if len(cur) == 3:
                        break
            res.append(cur)
        return res


if __name__ == "__main__":
    print(Solution().suggestedProducts(
        ["mobile", "mouse", "moneypot", "monitor", "mousepad"], "mouse"))
```

*A trie variant precomputes the 3 smallest at each node for `O(L)`-per-keystroke queries; the sorted-scan above is the simplest correct form for moderate sizes.*

---

## Coding Challenge 3: Longest Word Built One Char at a Time

**Problem.** Given `words`, return the longest word that can be built one character at a time by other words in the list (each prefix must itself be a word). Ties → lexicographically smallest. (LeetCode 720.)

#### Go
```go
package main

import "fmt"

type Node struct {
	ch    [26]*Node
	isEnd bool
}

func longestWord(words []string) string {
	root := &Node{}
	for _, w := range words {
		cur := root
		for i := 0; i < len(w); i++ {
			c := w[i] - 'a'
			if cur.ch[c] == nil {
				cur.ch[c] = &Node{}
			}
			cur = cur.ch[c]
		}
		cur.isEnd = true
	}
	best := ""
	var dfs func(n *Node, path string)
	dfs = func(n *Node, path string) {
		if len(path) > len(best) || (len(path) == len(best) && path < best) {
			best = path
		}
		for c := 0; c < 26; c++ {
			// only descend into children that are themselves words
			if n.ch[c] != nil && n.ch[c].isEnd {
				dfs(n.ch[c], path+string(rune('a'+c)))
			}
		}
	}
	dfs(root, "")
	return best
}

func main() {
	fmt.Println(longestWord([]string{"w", "wo", "wor", "worl", "world"})) // world
	fmt.Println(longestWord([]string{"a", "banana", "app", "appl", "ap", "apply", "apple"})) // apple
}
```

#### Java
```java
public class LongestWord {
    static class Node { Node[] ch = new Node[26]; boolean isEnd; }
    private String best = "";

    public String longestWord(String[] words) {
        Node root = new Node();
        for (String w : words) {
            Node cur = root;
            for (char c : w.toCharArray()) {
                int i = c - 'a';
                if (cur.ch[i] == null) cur.ch[i] = new Node();
                cur = cur.ch[i];
            }
            cur.isEnd = true;
        }
        dfs(root, new StringBuilder());
        return best;
    }

    private void dfs(Node n, StringBuilder path) {
        String s = path.toString();
        if (s.length() > best.length() ||
            (s.length() == best.length() && s.compareTo(best) < 0)) best = s;
        for (int c = 0; c < 26; c++) {
            if (n.ch[c] != null && n.ch[c].isEnd) {
                path.append((char) ('a' + c));
                dfs(n.ch[c], path);
                path.deleteCharAt(path.length() - 1);
            }
        }
    }

    public static void main(String[] args) {
        System.out.println(new LongestWord().longestWord(
            new String[]{"a","banana","app","appl","ap","apply","apple"})); // apple
    }
}
```

#### Python
```python
class Node:
    def __init__(self):
        self.ch = {}
        self.is_end = False


class Solution:
    def longestWord(self, words):
        root = Node()
        for w in words:
            cur = root
            for c in w:
                if c not in cur.ch:
                    cur.ch[c] = Node()
                cur = cur.ch[c]
            cur.is_end = True

        self.best = ""

        def dfs(n, path):
            if (len(path) > len(self.best) or
                    (len(path) == len(self.best) and path < self.best)):
                self.best = path
            for c in sorted(n.ch):
                if n.ch[c].is_end:        # only build through real words
                    dfs(n.ch[c], path + c)

        dfs(root, "")
        return self.best


if __name__ == "__main__":
    print(Solution().longestWord(
        ["a", "banana", "app", "appl", "ap", "apply", "apple"]))  # apple
```

---

## Coding Challenge 4: Word Dictionary with `.` Wildcard

**Problem.** Design `addWord(word)` and `search(word)` where `search` may contain `.` matching any single letter. (LeetCode 211.)

#### Go
```go
package main

import "fmt"

type WordDictionary struct {
	children map[byte]*WordDictionary
	isEnd    bool
}

func Constructor() WordDictionary {
	return WordDictionary{children: make(map[byte]*WordDictionary)}
}

func (d *WordDictionary) AddWord(word string) {
	cur := d
	for i := 0; i < len(word); i++ {
		c := word[i]
		if cur.children[c] == nil {
			cur.children[c] = &WordDictionary{children: make(map[byte]*WordDictionary)}
		}
		cur = cur.children[c]
	}
	cur.isEnd = true
}

func (d *WordDictionary) Search(word string) bool {
	var dfs func(node *WordDictionary, i int) bool
	dfs = func(node *WordDictionary, i int) bool {
		if i == len(word) {
			return node.isEnd
		}
		c := word[i]
		if c == '.' {
			for _, child := range node.children {
				if dfs(child, i+1) {
					return true
				}
			}
			return false
		}
		next := node.children[c]
		return next != nil && dfs(next, i+1)
	}
	return dfs(d, 0)
}

func main() {
	d := Constructor()
	d.AddWord("bad")
	d.AddWord("dad")
	d.AddWord("mad")
	fmt.Println(d.Search("pad")) // false
	fmt.Println(d.Search("bad")) // true
	fmt.Println(d.Search(".ad")) // true
	fmt.Println(d.Search("b..")) // true
}
```

#### Java
```java
import java.util.*;

public class WordDictionary {
    private final Map<Character, WordDictionary> children = new HashMap<>();
    private boolean isEnd = false;

    public WordDictionary() {}

    public void addWord(String word) {
        WordDictionary cur = this;
        for (char c : word.toCharArray()) {
            cur = cur.children.computeIfAbsent(c, k -> new WordDictionary());
        }
        cur.isEnd = true;
    }

    public boolean search(String word) { return dfs(this, word, 0); }

    private boolean dfs(WordDictionary node, String word, int i) {
        if (i == word.length()) return node.isEnd;
        char c = word.charAt(i);
        if (c == '.') {
            for (WordDictionary child : node.children.values())
                if (dfs(child, word, i + 1)) return true;
            return false;
        }
        WordDictionary next = node.children.get(c);
        return next != null && dfs(next, word, i + 1);
    }

    public static void main(String[] args) {
        WordDictionary d = new WordDictionary();
        d.addWord("bad"); d.addWord("dad"); d.addWord("mad");
        System.out.println(d.search("pad")); // false
        System.out.println(d.search(".ad")); // true
        System.out.println(d.search("b..")); // true
    }
}
```

#### Python
```python
class WordDictionary:
    def __init__(self):
        self.children = {}
        self.is_end = False

    def addWord(self, word):
        cur = self
        for c in word:
            if c not in cur.children:
                cur.children[c] = WordDictionary()
            cur = cur.children[c]
        cur.is_end = True

    def search(self, word):
        def dfs(node, i):
            if i == len(word):
                return node.is_end
            c = word[i]
            if c == ".":
                return any(dfs(child, i + 1) for child in node.children.values())
            nxt = node.children.get(c)
            return nxt is not None and dfs(nxt, i + 1)

        return dfs(self, 0)


if __name__ == "__main__":
    d = WordDictionary()
    for w in ["bad", "dad", "mad"]:
        d.addWord(w)
    print(d.search("pad"))  # False
    print(d.search(".ad"))  # True
    print(d.search("b.."))  # True
```

---

## Closing Tips

- Always state the `O(L)`-independent-of-`n` property; it is the headline interviewers want to hear.
- Keep the `search`/`startsWith` distinction explicit — verbalize "search needs `isEnd`, startsWith does not."
- For autocomplete, mention ranking (heap or precomputed top-k) even if the prompt only asks for correctness.
- For wildcard/word-search, the pattern is DFS over children; describe pruning before you code.
- Know the alternatives: hash set (no prefixes), radix trie (fewer nodes), DAWG (minimal size). Mentioning them signals depth.

---

## Further Reading

- LeetCode 208, 211, 212 (Word Search II), 648 (Replace Words), 720, 1268, 1032 — trie-tagged problems.
- *Algorithms* (Sedgewick & Wayne), Chapter 5 — string symbol tables.
- Sibling `17-string-algorithms/05` — Aho-Corasick over a trie dictionary.
- Sibling `15-recursion-backtracking` — Word Search and DFS pruning with a trie.
- Sibling `21-advanced-structures/24-25` — radix tries and TSTs for follow-up "optimize memory" questions.
