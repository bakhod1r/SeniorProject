# Tries (Prefix Trees) for String Processing — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with a precise spec and starter code in all three languages. Implement the trie logic and validate against the evaluation criteria.
> **Always test against a brute-force list-of-strings oracle on small inputs before trusting the trie result** — every `search`/`startsWith`/count/autocomplete answer must match a linear scan over the inserted words.

---

## Beginner Tasks (5)

### Task 1 — Insert and search

**Problem.** Implement a `Trie` with `insert(word)` and `search(word)` (exact match). `search` returns true only if the exact word was inserted.

**Input / Output spec.**
- A sequence of operations: `insert X` or `search X`.
- For each `search`, print `true` or `false`.

**Constraints.**
- Words are lowercase a–z, length `1 ≤ L ≤ 100`.
- Up to `10^5` operations.

**Hint.** Walk character by character creating missing children; mark `isEnd` at the last node. `search` returns `node != null && node.isEnd`.

**Starter — Go.**
```go
package main

import "fmt"

type Trie struct {
	children map[byte]*Trie
	isEnd    bool
}

func New() *Trie { return &Trie{children: make(map[byte]*Trie)} }

func (t *Trie) Insert(word string) {
	// TODO
}

func (t *Trie) Search(word string) bool {
	// TODO
	return false
}

func main() {
	t := New()
	t.Insert("cat")
	fmt.Println(t.Search("cat")) // true
	fmt.Println(t.Search("ca"))  // false
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static class Trie {
        Map<Character, Trie> children = new HashMap<>();
        boolean isEnd = false;
        void insert(String word) { /* TODO */ }
        boolean search(String word) { /* TODO */ return false; }
    }

    public static void main(String[] args) {
        Trie t = new Trie();
        t.insert("cat");
        System.out.println(t.search("cat")); // true
        System.out.println(t.search("ca"));  // false
    }
}
```

**Starter — Python.**
```python
class Trie:
    def __init__(self):
        self.children = {}
        self.is_end = False

    def insert(self, word):
        pass  # TODO

    def search(self, word):
        return False  # TODO


if __name__ == "__main__":
    t = Trie()
    t.insert("cat")
    print(t.search("cat"))  # True
    print(t.search("ca"))   # False
```

---

### Task 2 — startsWith

**Problem.** Add `startsWith(prefix)` to the trie: return true if any inserted word begins with `prefix`.

**Input / Output spec.** Operations `insert X` / `prefix X`; print `true`/`false` per `prefix`.

**Constraints.** Same as Task 1.

**Hint.** Walk the prefix's characters; if the path exists, return true — do **not** check `isEnd`.

**Starter — Go.**
```go
func (t *Trie) StartsWith(prefix string) bool {
	// TODO: walk prefix; return whether the path exists
	return false
}
```

**Starter — Java.**
```java
boolean startsWith(String prefix) {
    // TODO: walk prefix; return whether the path exists
    return false;
}
```

**Starter — Python.**
```python
def starts_with(self, prefix):
    # TODO: walk prefix; return whether the path exists
    return False
```

---

### Task 3 — Count words with a given prefix

**Problem.** Support `countPrefix(prefix)`: how many inserted words start with `prefix` (counting duplicates).

**Input / Output spec.** Operations `insert X` / `count X`; print the count per `count`.

**Constraints.** Up to `10^5` ops; words lowercase, `L ≤ 100`.

**Hint.** Maintain a `passCount` integer on each node, incremented at every node during insert. `countPrefix` = `walk(prefix).passCount`.

**Starter — Go.**
```go
type Node struct {
	children map[byte]*Node
	pass     int
	isEnd    bool
}
// Insert must do: node.pass++ at each node on the path.
// CountPrefix: walk to prefix node, return its pass (0 if path breaks).
```

**Starter — Java.**
```java
static class Node {
    Map<Character, Node> children = new HashMap<>();
    int pass = 0;
    boolean isEnd = false;
}
// insert: node.pass++ at each node; countPrefix: walk + return pass
```

**Starter — Python.**
```python
class Node:
    def __init__(self):
        self.children = {}
        self.pass_ = 0
        self.is_end = False
# insert: node.pass_ += 1 at each node; count_prefix: walk + return pass_
```

---

### Task 4 — List all words in sorted order

**Problem.** Return all inserted distinct words in lexicographic order using a trie traversal (no external sort).

**Input / Output spec.** Insert a list of words; print them one per line, sorted ascending.

**Constraints.** Up to `10^4` words, lowercase, `L ≤ 50`.

**Hint.** Pre-order DFS visiting children in sorted key order; emit `path` at each `isEnd` node.

**Starter — Go.**
```go
func (t *Trie) Sorted() []string {
	// TODO: DFS with sorted child keys, append path at isEnd nodes
	return nil
}
```

**Starter — Java.**
```java
List<String> sorted() {
    // TODO: DFS with sorted child keys (or use a TreeMap), collect isEnd paths
    return new ArrayList<>();
}
```

**Starter — Python.**
```python
def sorted_keys(self):
    out = []
    # TODO: dfs visiting sorted(children), append path at is_end
    return out
```

---

### Task 5 — Basic autocomplete

**Problem.** Implement `autocomplete(prefix)`: return all inserted words starting with `prefix`, in lexicographic order.

**Input / Output spec.** Insert words, then for a query prefix print all matching words (sorted), or an empty list.

**Constraints.** Up to `10^4` words, `L ≤ 50`.

**Hint.** Walk to the prefix node; if it exists, DFS collecting `isEnd` paths (seed `path` with the prefix).

**Starter — Go.**
```go
func (t *Trie) Autocomplete(prefix string) []string {
	// TODO: walk to prefix node; DFS collect, seeding path = prefix
	return nil
}
```

**Starter — Java.**
```java
List<String> autocomplete(String prefix) {
    // TODO: walk to prefix node; DFS collect, seeding path = prefix
    return new ArrayList<>();
}
```

**Starter — Python.**
```python
def autocomplete(self, prefix):
    # TODO: walk to prefix node; DFS collect, seeding path = prefix
    return []
```

---

## Intermediate Tasks (4)

### Task 6 — Top-k autocomplete by frequency

**Problem.** Each word has an insertion frequency. `topK(prefix, k)` returns the k highest-frequency words starting with `prefix`, ties broken lexicographically.

**Input / Output spec.** Insert `(word, freq)` pairs; query `(prefix, k)` → up to k `(word, freq)` pairs, highest freq first.

**Constraints.** Up to `10^5` words; `1 ≤ k ≤ 20`.

**Hint.** Store `freq` at end-of-word nodes. DFS the prefix subtree into a size-k min-heap by `(freq, -lexical)`; drain highest-first.

**Starter — Go.**
```go
// Node: children map[byte]*Node; freq int
// TopK: walk to prefix; DFS into a size-k min-heap; return drained desc.
func (t *Trie) TopK(prefix string, k int) []struct{ Word string; Freq int } {
	return nil // TODO
}
```

**Starter — Java.**
```java
// Use a PriorityQueue of size k ordered by frequency (then lexicographic).
List<Map.Entry<String,Integer>> topK(String prefix, int k) {
    return new ArrayList<>(); // TODO
}
```

**Starter — Python.**
```python
import heapq
def top_k(self, prefix, k):
    # TODO: walk; dfs into size-k min-heap; return sorted desc
    return []
```

---

### Task 7 — Word Dictionary with `.` wildcard

**Problem.** Implement `addWord(word)` and `search(word)` where `search` may contain `.` matching any single character.

**Input / Output spec.** Operations `add X` / `search X`; print `true`/`false`.

**Constraints.** Words/queries lowercase + `.`, `L ≤ 25`; up to `10^4` ops.

**Hint.** DFS: at a letter descend that child; at `.` recurse into all children. Match only when the index reaches the word length **and** the node is `isEnd`.

**Starter — Go.**
```go
func (d *WordDictionary) Search(word string) bool {
	// TODO: recursive DFS handling '.' as "try all children"
	return false
}
```

**Starter — Java.**
```java
boolean search(String word) {
    // TODO: recursive DFS handling '.' as "try all children"
    return false;
}
```

**Starter — Python.**
```python
def search(self, word):
    # TODO: recursive dfs handling '.' as "try all children"
    return False
```

---

### Task 8 — Replace words with shortest root

**Problem.** Given a dictionary of roots and a sentence, replace every word by the **shortest** root that is a prefix of it (if any). (LeetCode 648.)

**Input / Output spec.** Read roots and a sentence; print the transformed sentence.

**Constraints.** Up to `10^3` roots, sentence up to `10^6` chars.

**Hint.** Build a trie of roots. For each word, walk it through the trie and stop at the first `isEnd` node — that is the shortest matching root; otherwise keep the word.

**Starter — Go.**
```go
func replaceWords(dictionary []string, sentence string) string {
	// TODO: build trie of roots; for each word, walk until first isEnd
	return ""
}
```

**Starter — Java.**
```java
String replaceWords(List<String> dictionary, String sentence) {
    // TODO: build trie of roots; for each word, walk until first isEnd
    return "";
}
```

**Starter — Python.**
```python
def replaceWords(self, dictionary, sentence):
    # TODO: build trie of roots; for each word, walk until first is_end
    return ""
```

---

### Task 9 — Delete a word (with pruning)

**Problem.** Add `delete(word)` that removes a word and prunes nodes that become useless (no children and not an end-of-word), without breaking other words.

**Input / Output spec.** Operations `insert`/`delete`/`search`; print `search` results.

**Constraints.** Up to `10^5` ops; verify other words survive deletion.

**Hint.** Walk down stacking nodes; clear `isEnd` at the end. Unwind: remove a node only if it has no children and is not `isEnd`. A `passCount` field makes the safety check explicit.

**Starter — Go.**
```go
func (t *Trie) Delete(word string) bool {
	// TODO: clear isEnd; prune empty, non-end nodes on the way up
	return false
}
```

**Starter — Java.**
```java
boolean delete(String word) {
    // TODO: clear isEnd; prune empty, non-end nodes on the way up
    return false;
}
```

**Starter — Python.**
```python
def delete(self, word):
    # TODO: clear is_end; prune empty, non-end nodes on the way up
    return False
```

---

## Advanced Tasks (3)

### Task 10 — Word Search II (trie + grid backtracking)

**Problem.** Given an `m×n` board of letters and a list of words, return all words found in the board (adjacent horizontally/vertically, no cell reused per word). (LeetCode 212.)

**Input / Output spec.** Read the board and words; print all found words.

**Constraints.** Board up to `12×12`, up to `3·10^4` words.

**Hint.** Build a trie of the words. DFS from each cell, descending the trie in lockstep with the path; when you reach an `isEnd` node, record the word. Prune branches that leave the trie. Mark `isEnd=false` (or remove leaf) after finding to dedup.

**Starter — Go.**
```go
func findWords(board [][]byte, words []string) []string {
	// TODO: build trie; DFS each cell in lockstep with trie descent
	return nil
}
```

**Starter — Java.**
```java
List<String> findWords(char[][] board, String[] words) {
    // TODO: build trie; DFS each cell in lockstep with trie descent
    return new ArrayList<>();
}
```

**Starter — Python.**
```python
def findWords(self, board, words):
    # TODO: build trie; dfs each cell in lockstep with trie descent
    return []
```

---

### Task 11 — Longest-prefix match (IP routing)

**Problem.** Given routing rules `(prefix, length, nextHop)` over 32-bit addresses, answer `lookup(addr)` returning the next hop of the **longest** matching prefix (default route `/0` is the fallback).

**Input / Output spec.** Insert rules, then queries; print the next hop per query.

**Constraints.** Up to `10^5` rules and queries.

**Hint.** Binary trie over address bits (MSB first). Mark nodes with their next hop. On lookup, descend bit by bit and remember the deepest marked node seen.

**Starter — Go.**
```go
// RNode { child [2]*RNode; hop string; has bool }
func (rt *RouteTrie) Lookup(addr uint32) (string, bool) {
	// TODO: descend 32 bits; keep deepest marked hop (default = root mark)
	return "", false
}
```

**Starter — Java.**
```java
String lookup(long addr) {
    // TODO: descend 32 bits; keep deepest marked hop (default = root mark)
    return null;
}
```

**Starter — Python.**
```python
def lookup(self, addr):
    # TODO: descend 32 bits; keep deepest marked hop (default = root mark)
    return None
```

---

### Task 12 — Maximum XOR of two numbers (binary trie pointer)

**Problem.** Given an array of integers, find the maximum XOR of any two elements using a **binary trie** over the bits. (LeetCode 421.) *This is the bit-trie cousin of the string trie; the structure is identical with a 2-symbol alphabet. See sibling `18-bit-manipulation/06` for full coverage.*

**Input / Output spec.** Read the array; print the maximum pairwise XOR.

**Constraints.** Up to `2·10^5` numbers, values fit in 32 bits.

**Hint.** Insert each number's 32 bits (MSB first) into a binary trie. For each number, greedily descend toward the *opposite* bit at each level to maximize XOR; sum the bit values where you succeed.

**Starter — Go.**
```go
func findMaximumXOR(nums []int) int {
	// TODO: binary trie; for each num greedily take the opposite bit
	return 0
}
```

**Starter — Java.**
```java
int findMaximumXOR(int[] nums) {
    // TODO: binary trie; for each num greedily take the opposite bit
    return 0;
}
```

**Starter — Python.**
```python
def findMaximumXOR(self, nums):
    # TODO: binary trie; for each num greedily take the opposite bit
    return 0
```

---

## Evaluation Criteria

| Criterion | Requirement |
|-----------|-------------|
| Correctness | Matches a brute-force list-of-strings oracle on random inputs. |
| Complexity | Core ops `O(L)`; autocomplete `O(L + subtree)`; no accidental `O(n·L)` scans where a trie walk suffices. |
| `search` vs `startsWith` | Distinguished correctly (the `isEnd` check). |
| Deletion (Task 9) | Other words survive; no orphaned nodes; counts stay consistent. |
| Memory | Sensible children representation for the alphabet; no Σ-array for Unicode. |
| Edge cases | Empty string, duplicate inserts, prefix-of-another, missing path, wildcard all-dots. |
| Languages | Working solution in Go, Java, **and** Python. |

---

## Testing Harness Sketch (Python oracle)

```python
import random, string

def oracle_search(words, q):
    return q in words

def oracle_starts(words, p):
    return any(w.startswith(p) for w in words)

def fuzz():
    for _ in range(2000):
        words = set()
        t = Trie()
        for _ in range(random.randint(0, 30)):
            w = "".join(random.choices("ab", k=random.randint(1, 6)))
            words.add(w); t.insert(w)
        q = "".join(random.choices("ab", k=random.randint(1, 6)))
        assert t.search(q) == oracle_search(words, q)
        assert t.starts_with(q) == oracle_starts(words, q)
    print("ok")

# fuzz()  # run after implementing Trie
```

Run the fuzzer after each task; mismatches localize bugs faster than any debugger.

---

## Further Reading

- LeetCode 208, 211, 212, 421, 648, 720, 1032, 1268 — trie-tagged problems mapped to these tasks.
- Sibling `17-string-algorithms/05` — Aho-Corasick (Task 10's multi-pattern cousin).
- Sibling `18-bit-manipulation/06` — binary/XOR tries (Task 12).
- Sibling `21-advanced-structures/24-25` — radix tries and TSTs for memory-optimized follow-ups.
- *Algorithms* (Sedgewick & Wayne), Chapter 5 — string symbol tables and tries.
