# Suffix Tree & Ukkonen's Algorithm — Practice Tasks

These tasks build mastery from the ground up: first the suffix-tree shape and queries (naive build is fine), then Ukkonen's online construction with its three tricks, then advanced applications and "when not to use it" judgment. Each task gives a problem, I/O spec, constraints, hints, and starter code in **Go, Java, and Python**. Build on `S$` with a unique sentinel unless told otherwise, and test every implementation against a brute-force oracle on small random strings.

---

## Beginner Tasks (5)

### Task 1 — Naive suffix tree + substring check

**Problem.** Build a suffix tree of `S$` by inserting each suffix into a trie (naive `O(n²)`), then answer "is `P` a substring of `S`?" in `O(|P|)`.

**Input.** A string `S` and a list of query patterns.
**Output.** For each pattern, `true`/`false`.
**Constraints.** `1 ≤ |S| ≤ 2000`. Lowercase letters.
**Hints.**
- Append a sentinel `$` that does not appear in `S`.
- Store edges as `[start, end]` index pairs; never copy substrings.
- To query, walk from the root matching characters along edge labels.

**Starter — Go.**
```go
package main

import "fmt"

type Node struct { start, end int; children map[byte]*Node }

func build(s string) *Node { /* insert each suffix; split on divergence */ return nil }
func contains(root *Node, s, p string) bool { /* walk down following p */ return false }

func main() {
	s := "mississippi$"
	root := build(s)
	fmt.Println(contains(root, s, "issi")) // true
}
```

**Starter — Java.**
```java
import java.util.*;
public class T1 {
    static class Node { int start, end; Map<Character,Node> ch=new HashMap<>(); }
    static Node build(String s){ /* TODO */ return null; }
    static boolean contains(Node root, String s, String p){ /* TODO */ return false; }
    public static void main(String[] a){
        String s="mississippi$";
        System.out.println(contains(build(s), s, "issi")); // true
    }
}
```

**Starter — Python.**
```python
class Node:
    def __init__(self, s, e): self.start = s; self.end = e; self.ch = {}

def build(s): ...        # insert each suffix, split on divergence
def contains(root, s, p): ...

if __name__ == "__main__":
    s = "mississippi$"
    print(contains(build(s), s, "issi"))  # True
```

---

### Task 2 — Count leaves under a node (occurrence count)

**Problem.** Extend Task 1: for a pattern `P` that occurs, return how many times it occurs in `S` (= number of leaves in the subtree below `P`'s endpoint).

**Input.** `S`, queries `P`.
**Output.** Occurrence count per query (0 if absent).
**Constraints.** `1 ≤ |S| ≤ 2000`.
**Hints.**
- Precompute, by one post-order DFS, the leaf count under each node.
- Walk to `P`'s endpoint, then read the leaf count of the node you land on (or the child whose edge you ended inside).
- A node with no children is a leaf (count 1).

**Starter — Python.**
```python
def occurrences(root, s, p):
    # walk to endpoint of p, then return leaf-count of that subtree
    ...
```

**Starter — Go.**
```go
func leafCount(n *Node) int { /* DFS: 1 if no children, else sum */ return 0 }
func occurrences(root *Node, s, p string) int { /* walk then count */ return 0 }
```

**Starter — Java.**
```java
static int leafCount(Node n){ /* DFS */ return 0; }
static int occurrences(Node root, String s, String p){ /* TODO */ return 0; }
```

---

### Task 3 — Number of distinct substrings

**Problem.** Count the distinct non-empty substrings of `S` as the sum of edge-label lengths over the tree of `S$`, minus the `n+1` substrings that contain `$`.

**Input.** `S`.
**Output.** An integer count.
**Constraints.** `1 ≤ |S| ≤ 2000`.
**Hints.**
- `len(edge) = end - start + 1`.
- Sum over **all** edges via DFS/stack, then subtract `len(S) + 1` for the `$`-bearing substrings.
- Verify against a brute-force set of all substrings for small `S`.

**Starter — Python.**
```python
def count_distinct(s):
    text = s + "$"
    root = build(text)
    total = 0
    # sum (end - start + 1) over all edges
    return total - (len(s) + 1)
```

**Starter — Go.**
```go
func countDistinct(s string) int {
    text := s + "$"
    root := build(text)        // naive build from Task 1
    total := 0
    // DFS/stack: total += end - start + 1 for every edge
    return total - (len(s) + 1)
}
```

**Starter — Java.**
```java
static long countDistinct(String s){
    String t = s + "$";
    Node root = build(t);      // naive build from Task 1
    long total = 0;
    // DFS/stack: total += end - start + 1 for every edge
    return total - (s.length() + 1);
}
```

**Check.** `count_distinct("abab") == 7`, `count_distinct("aaa") == 3`, `count_distinct("abc") == 6`.

---

### Task 4 — Longest repeated substring (deepest internal node)

**Problem.** Return the longest substring of `S` that occurs at least twice.

**Input.** `S`.
**Output.** The longest repeated substring (any one if ties; empty if none).
**Constraints.** `1 ≤ |S| ≤ 2000`.
**Hints.**
- An internal node (≥ 2 children, not the root) marks a repeated substring.
- Track the maximum **string-depth** internal node during a DFS; its path-label is the answer.
- Strip a trailing `$` from the answer if present.

**Starter — Java.**
```java
static String longestRepeated(String s){
    // build tree of s + "$"; DFS for deepest internal node
    return "";
}
```

**Starter — Go.**
```go
func longestRepeated(s string) string {
    t := s + "$"
    root := build(t)
    bestLen, bestLabel := 0, ""
    // DFS carrying (depth, label); on internal node (>=2 children, not root)
    // update best when depth > bestLen
    _ = root
    return strings.TrimRight(bestLabel, "$")
}
```

**Starter — Python.**
```python
def longest_repeated(s):
    text = s + "$"
    root = build(text)
    best = (0, "")
    # dfs(node, depth, label): if internal and depth>best[0], update
    return best[1].rstrip("$")
```

**Check.** `"banana" -> "ana"`, `"abcabcabc" -> "abcabc"` (or another length-6 repeat), `"abc" -> ""`.

---

### Task 5 — Verify against a brute-force oracle

**Problem.** Write a tester: for random strings of length ≤ 12, compare your suffix-tree `contains` against a brute-force `P in S` check for all substrings and many random non-substrings.

**Input.** None (generates random cases).
**Output.** "OK" or the first failing `(S, P)`.
**Constraints.** Run ≥ 10 000 random trials.
**Hints.**
- Generate `S` over a 2–3 letter alphabet to maximize repeats.
- Enumerate all `O(|S|²)` substrings as positive cases.
- Generate random short strings as negative cases and check both agree.

**Starter — Python.**
```python
import random

def brute(s, p): return p in s

def test():
    for _ in range(10000):
        s = "".join(random.choice("ab") for _ in range(random.randint(1, 12)))
        root = build(s + "$")
        # check all substrings (positive) and random strings (negative)
    print("OK")
```

---

## Intermediate Tasks (5)

### Task 6 — Ukkonen's algorithm (full online build)

**Problem.** Implement Ukkonen's `O(n)` construction with the global end pointer, suffix links, and the active point with skip/count. Expose `contains(P)`.

**Input.** `S` (sentinel appended by you), queries `P`.
**Output.** `true`/`false` per query, and node count (assert `≤ 2|S|+1`).
**Constraints.** `1 ≤ |S| ≤ 10^5`.
**Hints.**
- Store leaf `end` as a shared box/reference to `leafEnd`; set `leafEnd = i` each phase.
- Maintain `(active_node, active_edge, active_length)` and `remaining`.
- `walk_down` (skip/count) before any character comparison.
- After a root Rule-2 split: `active_length--`, `active_edge = i - remaining + 1`. Otherwise follow the suffix link.
- Set `last_new.link` to the next created internal node (or the active node on Rule 3).

**Starter — Python.**
```python
class Node:
    __slots__ = ("start", "end", "ch", "link")
    def __init__(self, s, e): self.start=s; self.end=e; self.ch={}; self.link=None

class SuffixTree:
    def __init__(self, text):
        self.t = text; self.leaf_end = [-1]
        self.root = Node(-1, [-1]); self.root.link = self.root
        self.an = self.root; self.ae = -1; self.al = 0; self.rem = 0
        for i in range(len(text)): self._ext(i)
    def _ext(self, i): ...     # implement the three rules + tricks
    def contains(self, p): ...
```

**Starter — Go / Java.** Mirror the structure: `extend(i)` loop over `remaining`, `walkDown` skip/count, suffix-link setup. (See `middle.md` / `interview.md` for full references.)

---

### Task 7 — Longest common substring of two strings

**Problem.** Build a generalized suffix tree of `A + "#" + B + "$"` and return the longest common substring.

**Input.** Strings `A`, `B`.
**Output.** The LCS (any one if ties).
**Constraints.** `1 ≤ |A|, |B| ≤ 5000`.
**Hints.**
- Use **distinct** separators `#` and `$` so no substring spans the boundary.
- A leaf's suffix-start ≤ `|A|` ⇒ color 0 (from `A`), else color 1 (from `B`).
- The deepest internal node whose subtree has both colors is the answer.

**Starter — Go.**
```go
func lcs(a, b string) string {
    text := a + "#" + b + "$"
    // build, DFS returning color sets, track deepest two-colored node
    return ""
}
```

**Starter — Java.**
```java
static String lcs(String a, String b){
    String text = a + "#" + b + "$";
    int boundary = a.length();   // suffix-start <= boundary => color 0 (A)
    Node root = build(text);
    // DFS returning Set<Integer> of colors; when size==2 and depth>best, record
    return "";
}
```

**Starter — Python.**
```python
def lcs(a, b):
    text = a + "#" + b + "$"
    boundary = len(a)
    root = build(text)
    # dfs(node, depth, label) -> set of colors; both colors + deeper => update best
    return ""
```

**Check.** `lcs("xabxac", "abcabxabcd")` has length 4 (`"abxa"`); `lcs("abc", "xyz")` is empty.

---

### Task 8 — Count occurrences of every query pattern fast

**Problem.** Given `S` and `Q` patterns, answer each "how many times does `P_q` occur in `S`?" in `O(|P_q|)` after an `O(n)` precompute.

**Input.** `S`, then `Q` patterns.
**Output.** `Q` integers.
**Constraints.** `1 ≤ |S| ≤ 10^5`, `Σ|P_q| ≤ 10^6`.
**Hints.**
- Precompute leaf counts per node once (DFS).
- Each query is a walk to the endpoint + a single leaf-count read.
- Handle "pattern ends inside an edge" by reading the child node's leaf count.

**Starter — Python.**
```python
def precompute_leafcounts(tree): ...   # post-order DFS
def count_occurrences(tree, p): ...    # walk then read leaf count
```

---

### Task 9 — k-th smallest distinct substring

**Problem.** Given `S` and an integer `k`, return the `k`-th lexicographically smallest distinct substring of `S`.

**Input.** `S`, `k`.
**Output.** The substring, or "INVALID" if `k` exceeds the distinct count.
**Constraints.** `1 ≤ |S| ≤ 3000`, `1 ≤ k ≤ 10^12`.
**Hints.**
- Visit children in sorted order of their first character.
- For each edge, the substrings along it are visited in order; subtract counts as you descend.
- Each character along an edge is one more distinct substring; decrement `k` per character.

**Starter — Python.**
```python
def kth_distinct(s, k):
    text = s + "$"
    root = build(text)
    # DFS children in sorted first-char order; walk each edge char by char,
    # decrement k per character (skip those containing '$'); return label when k==0
    return "INVALID"
```

**Starter — Go / Java.** DFS in lexicographic child order; at each edge, walk character by character, decrementing `k`; when `k` hits 0, return the accumulated label. Skip characters at or after the `$` position so only substrings of `S` are counted.

**Check.** For `s = "aab"`, sorted distinct substrings are `a, aa, aab, ab, b`; `kth_distinct("aab", 3) == "aab"`.

---

### Task 10 — Match a pattern and list all occurrence positions

**Problem.** Given `S` and a pattern `P`, return all start positions where `P` occurs, in any order.

**Input.** `S`, `P`.
**Output.** The list of 0-based start indices.
**Constraints.** `1 ≤ |S| ≤ 10^5`, `1 ≤ |P| ≤ |S|`.
**Hints.**
- Each leaf's suffix-start index (recoverable as `n - depth` where `depth` is its string-depth) is an occurrence.
- Walk to `P`'s endpoint, then collect all leaf suffix-starts in the subtree.
- Cost `O(|P| + occ)`.

**Starter — Python.**
```python
def find_all(tree, p):
    # walk to endpoint of p; collect leaf suffix-starts in the subtree
    ...
```

---

## Advanced Tasks (5)

### Task 11 — Generalized suffix tree for k documents + document frequency

**Problem.** Index `k` documents in one generalized suffix tree. For a query `P`, return in how many documents `P` appears (document frequency).

**Input.** `k` documents, then queries.
**Output.** Document frequency per query.
**Constraints.** `k ≤ 50`, total length ≤ `10^5`.
**Hints.**
- Use distinct separators per document, or run Ukkonen sequentially tagging leaves by document id.
- Compute per-node color sets via post-order DFS (bitset of `k` bits for small `k`).
- Query = popcount of the `P`-endpoint node's color set.

**Starter — Java.**
```java
static int[] colorSet(Node n){ /* bitset union over children */ return null; }
static int docFrequency(Node root, String text, String p){ /* walk + popcount */ return 0; }
```

---

### Task 12 — Matching statistics (longest match at each position)

**Problem.** Given text `T` (build its suffix tree) and a query string `P`, compute for each position `i` of `P` the length of the longest prefix of `P[i..]` that is a substring of `T`. This is the matching-statistics array.

**Input.** `T`, `P`.
**Output.** An array `ms[0..|P|-1]`.
**Constraints.** `|T|, |P| ≤ 10^5`.
**Hints.**
- Walk `P` down the suffix tree of `T`; on a mismatch, follow a **suffix link** and continue from the shortened context (amortized `O(1)` per step).
- Total time is `O(|P|)` — the same trick that proves Ukkonen `O(n)`.
- Matching statistics underlie approximate matching and LZ factorization.

**Starter — Go / Python.** Maintain a current node + depth; on mismatch, use the suffix link and `skip/count` to re-descend; record the depth at each `i`.

---

### Task 13 — Compare suffix tree vs suffix array on memory and queries

**Problem.** Build both a suffix tree and a suffix array + LCP for the same `S`. Verify they agree (lexicographic DFS of the tree gives the suffix array; LCA depths give LCP). Report memory used by each.

**Input.** `S`.
**Output.** "MATCH" if the array derived from the tree equals an independently built suffix array; plus byte counts for each structure.
**Constraints.** `1 ≤ |S| ≤ 5·10^4`.
**Hints.**
- Lexicographic DFS over the tree (children sorted by first edge char) visits leaves in SA order.
- The string-depth of the LCA of adjacent leaves equals the LCP value.
- Use this task to *feel* why the suffix array is preferred for memory.

**Starter — Python.**
```python
def tree_to_sa_lcp(tree, n): ...    # ordered DFS -> (SA, LCP)
def independent_sa(s): ...          # e.g., sorted(range(len(s)), key=lambda i: s[i:])
```

---

### Task 14 — Online appends and implicit-tree snapshots

**Problem.** Build the suffix tree incrementally with Ukkonen, and after each appended character, answer a substring query against the **current** prefix. Demonstrate the implicit-vs-explicit distinction.

**Input.** A stream of characters and interleaved queries.
**Output.** Query answers against the prefix seen so far.
**Constraints.** Stream length ≤ `10^5`.
**Hints.**
- Between phases the tree is *implicit*; the longest few suffixes may not be explicit leaves yet.
- A substring query still works on the implicit tree (membership is correct), but leaf-based counts may be incomplete.
- Append a temporary `$` to snapshot an explicit tree if you need exact leaf counts.

**Starter — Python.**
```python
class StreamingTree(SuffixTree):
    def feed(self, c):
        self.t += c
        self._ext(len(self.t) - 1)   # one phase for the new char
    def snapshot_explicit(self):
        # append a temporary '$', build, query, then discard for exact counts
        ...
```

**Starter — Go / Java.** Reuse your Ukkonen builder; expose `extend(c)` and `contains(p)` callable mid-stream.

**Check.** After feeding `"ban"`, `contains("ba")` is true and `contains("ana")` is false; after `"banana"`, `contains("ana")` is true.

---

### Task 15 — Decide: suffix tree, array, automaton, or KMP?

**Problem.** Given a problem spec, output which structure is the right tool and why.

**Input.** A spec: `(text_size, num_queries, query_type, memory_budget, alphabet)`.
**Output.** One of `{SUFFIX_TREE, SUFFIX_ARRAY, SUFFIX_AUTOMATON, KMP_OR_Z, FM_INDEX}` plus a one-line justification.
**Constraints.** Cover at least 8 spec combinations.
**Hints.**
- Single pattern, single text → KMP/Z.
- Many substring queries, tight memory → suffix array.
- Minimal automaton / incremental distinct counts → suffix automaton.
- True `O(m)` walking, online appends → suffix tree.
- Genome scale → FM-index.

**Starter — Python.**
```python
def choose(text_size, num_queries, query_type, memory_budget, alphabet):
    # return (structure, reason)
    ...
```

---

## Benchmark Task

### Task B — Naive `O(n²)` vs Ukkonen `O(n)` build crossover

**Problem.** Measure the build time of the naive suffix tree and Ukkonen's tree as `n` grows, on the worst case `"a"*n + "$"` (a deep, skinny tree). Find roughly where Ukkonen overtakes naive.

**Input.** A range of `n` (e.g. `1000, 2000, 4000, 8000, 16000`).
**Output.** A table of `(n, naive_ms, ukkonen_ms)` and the approximate crossover.
**Constraints.** Keep naive `n` modest (`≤ 2·10^4`) since it is `O(n²)`.
**Hints.**
- The all-`a` string is the canonical stress test: every phase triggers a long active-length walk, exposing skip/count and off-by-one bugs.
- Expect naive to grow quadratically while Ukkonen stays near-linear.
- Validate both builds agree (same substring set) before timing.

**Starter — Python.**
```python
import time

def bench(n):
    s = "a" * n + "$"
    t0 = time.perf_counter(); build_naive(s);   naive = time.perf_counter() - t0
    t0 = time.perf_counter(); SuffixTree(s);     ukk = time.perf_counter() - t0
    return n, naive * 1000, ukk * 1000

if __name__ == "__main__":
    for n in (1000, 2000, 4000, 8000, 16000):
        print(bench(n))
```

**Starter — Go / Java.** Mirror the timing harness with your two builders; print milliseconds per `n`.

---

## General Guidance for All Tasks

- **Always append a unique sentinel `$`.** The single most common bug source; without it the tree is implicit and queries silently misbehave.
- **Store edges as `[start, end]` index pairs**, never copied substrings, or you lose the `O(n)` space guarantee.
- **Pick an interval convention** (inclusive end vs the global `leafEnd` index) and use `len = end - start + 1` everywhere.
- **Test against a brute-force oracle** (naive build, or direct `P in S`) on thousands of small random strings before trusting Ukkonen.
- **Stress with adversarial inputs**: `"aaaa…"`, Fibonacci words, all-distinct alphabets — these expose active-length and skip/count off-by-ones.
- **For Ukkonen**, verify suffix links are actually followed (a missing link silently degrades to `O(n²)`) and that leaf ends are shared boxes (or leaves stop growing).
- **Know when to switch**: if memory is tight or code simplicity matters, a suffix array + LCP (sibling `04`) answers the same questions; a suffix automaton (sibling `12`) is best for minimal automata and distinct counts.
- **Reconstruct labels carefully**: a node's path-label is the concatenation of edge labels from the root; its string-depth is the sum of edge lengths.
