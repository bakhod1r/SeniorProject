# Palindromic Tree (eertree) — Middle Level

> **Focus:** The online `O(n)` construction in full (the suffix-link walk to find the longest extensible palindromic suffix), counting **distinct** vs **total** palindromic occurrences, series/quick links for fast traversal, per-position palindrome counts, palindromic richness, and how the eertree compares to Manacher (sibling `11`).
>
> **Prerequisite:** the junior file's two roots, `add`, and suffix-link basics.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [Comparison with Alternatives](#comparison-with-alternatives)
4. [Advanced Patterns](#advanced-patterns)
5. [Counting Total Occurrences](#counting-total-occurrences)
6. [Series Links and Quick Links](#series-links-and-quick-links)
7. [Code Examples](#code-examples)
8. [Error Handling](#error-handling)
9. [Performance Analysis](#performance-analysis)
10. [Best Practices](#best-practices)
11. [Visual Animation](#visual-animation)
12. [Summary](#summary)

This level assumes you have read the junior file (two roots, `add`, suffix links) and focuses on turning the built tree into answers and on the data-structure refinements that make those answers fast.

---

## Introduction

At junior level the message was a single fact: each appended character creates at most one new distinct palindrome, so the eertree has `≤ n + 2` nodes. That fact is the *what*; this file is the *how* and the *why-fast*. At middle level you start asking the engineering questions that decide whether your solution is correct *and* fast:

- Exactly how does the online construction find the longest palindromic suffix that can be extended, and why is the suffix-link walk amortized `O(n)`?
- How do you count not just **distinct** palindromes but the **total number of palindromic occurrences** (the same palindrome counted once per occurrence)?
- How do you compute the **number of palindromic substrings ending at each position** — a building block for many problems?
- What are **series links** (a.k.a. quick links / fast suffix links), and how do they let you process all palindromic suffixes of a position in `O(log n)` instead of `O(suffix-chain length)`?
- What is **palindromic richness**, and how does the eertree decide it in one pass?
- When should you reach for the eertree, and when is Manacher (sibling `11`) the better tool?

These are the questions that separate "I memorized the node bound" from "I can pick and annotate the right palindrome structure for the problem in front of me." We answer each with worked examples on small strings (`ababa`, `aaaa`) so the mechanics are concrete, then state the complexity and the failure modes you will hit in practice.

---

## Deeper Concepts

### The online construction, restated precisely

Let `s[0..i]` be the prefix processed so far, and let `last` be the node of the **longest palindromic suffix** of `s[0..i-1]`. To append `s[i] = c`:

```
1. cur = getLink(last, i):
       walk suffix links from last while
       (i - len[cur] - 1 < 0)  OR  (s[i - len[cur] - 1] != c)
   This finds the longest palindromic suffix X of s[0..i-1]
   such that c X c is a palindromic suffix of s[0..i].
2. If next[cur][c] already exists, that palindrome occurred before:
       last = next[cur][c]; done (no new node).
3. Else create node 'now' with len[now] = len[cur] + 2, then:
       if len[now] == 1: link[now] = emptyRoot
       else:             link[now] = next[ getLink(link[cur], i) ][c]
       next[cur][c] = now; last = now.
```

The expression `s[i - len[cur] - 1]` is the character **immediately before** the occurrence of `X` that ends at position `i - 1`; if it equals `c`, then `c X c` is exactly a palindrome ending at `i`. The imaginary root (`len = -1`) makes `i - len - 1 = i`, so `s[i] == c` is trivially true there — that is why the walk always terminates: the imaginary root catches every character as a length-1 palindrome.

### Why the suffix-link walk is amortized linear

Each `getLink` call walks *up* the suffix-link tree (toward shorter palindromes), decreasing `len[last]`. A new node *increases* `len[last]` by at most 2 per character (a new palindrome is at most 2 longer than the previous `last`). Since `len[last]` can rise by `O(n)` total over the whole string, it can fall by at most `O(n)` total across all walks. Hence the **total** work of all suffix-link walks is `O(n)`, and each `add` is amortized `O(1)` walk steps (plus the `O(|Σ|)` or `O(1)` child lookup). This is the same potential argument that makes the KMP failure-function walk and the suffix-automaton construction linear.

### The suffix-link tree

The suffix links form a tree rooted at the empty root (with the imaginary root as a special parent). For any node `P`, the chain `P → link[P] → link[link[P]] → … → emptyRoot` lists the palindromic suffixes of `P` in **strictly decreasing length**. This tree is the backbone for:

- **Occurrence counting** — propagate counts from each node up to its suffix-link parent.
- **Per-position counts** — `len[last]` after each `add` relates to how many palindromes end there.
- **Series links** — a compressed version of this tree for fast traversal.

### `last` after each character = longest palindrome ending there

After processing `s[i]`, `last` is the node of the **longest palindromic suffix** of `s[0..i]`. Walking suffix links from `last` enumerates **all** palindromic suffixes ending at `i` (every palindrome that ends at position `i`). The *number* of such palindromes is the **count of palindromes ending at position `i`** — a quantity we compute incrementally below.

### A full trace on `ababa`

Watching `last` and the new node per character makes the construction concrete:

```
i  c   getLink finds          new node (len)   suffix link   last     distinct
0  a   imaginary root          a (1)            ε             a        1
1  b   imaginary root          b (1)            ε             b        2
2  a   a (s[0]=a matches)      aba (3)          a             aba      3
3  b   b (s[1]=b matches)      bab (3)          b             bab      4
4  a   aba (s[1]=b? walk...)   ababa (5)        aba           ababa    5
```

At `i = 4`, `getLink` starts from `last = bab`, checks `s[4 - 3 - 1] = s[0] = a = c` ✓ — so `bab` wraps to `ababa`. Its suffix link is the longest proper palindromic suffix of `ababa`, found by walking from `link[bab] = b`: `s[4 - 1 - 1] = s[2] = a = c` ✓ and the edge `b --a-->`... actually the link resolves to `aba`. Final distinct count: `5 = nodes - 2`. Each character created exactly one node — `ababa` is **rich**.

---

## Comparison with Alternatives

### eertree vs Manacher vs suffix-based structures

| Approach | Builds | Distinct palindromes? | Total occurrences? | Per-position counts? | Online? |
|----------|--------|-----------------------|--------------------|--------------------|---------|
| **Manacher** (`11`) | `O(n)` | **No** (counts radii, not the set) | Yes (sum of radii) | Yes | No (needs whole string) |
| **eertree** | `O(n)` | **Yes** (one node each) | Yes (count propagation) | Yes (`series`/`diff` links) | **Yes** |
| Suffix automaton + reverse | `O(n)` | Indirect / harder | Indirect | Harder | Partly |
| Brute force + set | `O(n²)`–`O(n³)` | Yes | Yes | Yes | Yes but slow |

The decisive differences:

- **Manacher** computes, for each center, the maximum palindrome radius. From radii you can *count* total palindromic substrings in `O(n)`, but you get **no explicit set of distinct palindromes** and nowhere to attach per-palindrome annotations. Use it for the **longest** palindrome or a quick total count.
- **eertree** materializes each distinct palindrome as a node you can label (occurrence count, first/last position, depth), supports **online** updates, and answers distinct/total/per-position queries from one structure. Use it whenever the *set* of palindromes or per-palindrome data matters.

A worked contrast on `ababa`: Manacher reports radii `[0,1,0,2,0,2,0,2,0,1,0]` (over the gap-augmented string) from which the total count `9` is summable, but it never names the palindromes `a, b, aba, bab, ababa` as distinct objects. The eertree produces exactly those five nodes, each annotatable — and reports `distinct = 5`, which Manacher cannot do without extra hashing.

A quick way to remember the split: **Manacher answers "how many / how long", the eertree answers "which ones / how each".** If your problem mentions *distinct* palindromes, per-palindrome annotations, richness, factorization, or streaming input, it is an eertree problem; if it asks only for the longest palindrome or a single total count, Manacher is the lighter choice.

### When each wins

| Need | Tool | Why |
|------|------|-----|
| Longest palindromic substring | Manacher | One pass, tiny constant, no tree |
| Total count of palindromic substrings | Manacher *or* eertree | Manacher: sum radii; eertree: sum occurrence counts |
| **Number of distinct** palindromic substrings | **eertree** | `numberOfNodes - 2`; Manacher cannot do this directly |
| Per-palindrome data (counts, positions) | eertree | Each palindrome is an addressable node |
| Online / streaming input | eertree | Built character by character |
| Palindromic richness check | eertree | `distinct == n` test in one pass |

---

## Advanced Patterns

### Pattern: New-palindrome flag

`add()` returns a boolean: did this character create a new node (a new distinct palindrome)? This single bit drives online distinct counts, richness detection, and "first position introducing palindrome X" queries. Keep it in the return type even if a caller ignores it.

### Pattern: Distinct palindrome count (one line)

```
distinct = numberOfNodes - 2
```

Every non-root node is exactly one distinct palindromic substring. Built in `O(n)`, read in `O(1)`. The `- 2` is for the two roots — subtracting only one is the single most common bug, producing an off-by-one that small tests may not catch (e.g. `"abc"` would report 4 instead of 3).

### Pattern: Palindromes ending at each position

When we append `s[i]` and set `last`, the number of palindromic substrings ending at position `i` equals the **depth of `last` in the suffix-link tree** — the length of the chain `last → link[last] → … → emptyRoot`. This is true because the palindromic suffixes ending at `i` are exactly the nodes on that chain (each is a palindrome that ends at `i`). Naively walking that chain per position is `O(n²)` worst case (string `aaaa…`), so we maintain a `seriesCount` (a.k.a. `cnt` on the suffix-link tree) incrementally:

```
endCount[node] = endCount[link[node]] + 1   // computed when node is created
palindromesEndingAt[i] = endCount[last]      // O(1) per position
```

Summing `palindromesEndingAt[i]` over all `i` gives the **total number of palindromic substrings** (with multiplicity).

### Pattern: Total palindromic substrings (with multiplicity)

```
total = Σ_i endCount[last_after_i]
```

Equivalently, propagate per-node occurrence counts up the suffix-link tree (next section) and sum `occ[node] * 1` — both give the total count of palindromic occurrences. Having two independent formulas for the same quantity is a gift: compute both and assert they match in tests. A mismatch points to either a bad `endCount` recurrence or a wrong propagation order — and tells you immediately which path is broken.

### Pattern: Longest palindromic suffix per prefix

`len[last]` after processing `s[i]` is precisely the **length of the longest palindromic suffix** of the prefix `s[0..i]`. Recording it for every `i` yields the longest-palindromic-suffix-per-prefix array in `O(n)` — useful for problems that decompose a string into palindromic pieces (palindromic factorization / partitioning).

### Pattern: Online distinct count

Because `add()` returns whether a node was created, the running distinct count is a prefix sum of those booleans: `distinct(i) = distinct(i-1) + [add created a node]`. This gives the distinct-palindrome count of *every prefix* in `O(1)` per character, with no recomputation — handy for streaming inputs or for problems that query the distinct count at many prefixes. The slope of this curve (all 1s ⇒ rich) also reads off palindromic richness for free.

```mermaid
graph TD
    E[eertree built online] --> D[distinct = nodes - 2]
    E --> P[per-position: endCount of last]
    P --> T[total occurrences = Σ endCount]
    E --> R[richness: distinct == n ?]
    E --> S[series links for O(log n) suffix traversal]
    E --> L[len of last = longest palindromic suffix per prefix]
```

---

## Counting Total Occurrences

**Distinct** palindromes count each palindrome once. **Total occurrences** count each palindromic substring once per occurrence (so `a` in `aba` contributes 2 because `a` occurs twice). The eertree computes total occurrences via **suffix-link propagation**.

### The propagation idea

When `add()` finishes and sets `last` to some node `v`, that means a new *occurrence* of the palindrome `v` ends at the current position. Give each node a counter `occ[v]`, incremented by 1 each time it becomes `last`. After the whole string is processed, **every palindromic suffix of `v` also occurs at that position**, so its count must inherit `v`'s count. Process nodes in **decreasing order of length** (children before suffix-link parents) and push:

```
for v in nodes sorted by len descending (skip the two roots):
    occ[link[v]] += occ[v]
```

Because nodes are created in non-decreasing length order, iterating the node array **in reverse creation order** already visits longer palindromes before their (shorter) suffix-link parents — no sort needed. After propagation, `occ[v]` is the **number of occurrences** of palindrome `v` in the whole string, and `Σ occ[v]` over non-root nodes is the **total number of palindromic substrings**.

### Why reverse creation order works

A node's suffix link always points to a **shorter** palindrome, and shorter palindromes are created **no later** in the online build only if they were already present — but the safe, always-correct ordering is "by length descending". Since `len` is non-decreasing in creation index, reverse-creation order is a valid length-descending order, so each node's count is fully accumulated before it is pushed to its parent. This is the palindromic analogue of the suffix-automaton's `endpos`-size propagation along suffix links.

### Worked propagation on `ababa`

Initial `occ` (times each became `last`): `a:1, b:1, aba:1, bab:1, ababa:1`. Propagating in reverse creation order:

```
ababa → aba:   occ[aba]  += 1  → aba = 2
bab   → b:     occ[b]    += 1  → b   = 2
aba   → a:     occ[a]    += 2  → a   = 3
b     → ε:     (root, ignored)
a     → ε:     (root, ignored)
```

Final: `a:3, b:2, aba:2, bab:1, ababa:1`, sum = **9**. Notice `a`'s count grew to 3 by inheriting from `aba` (which had already inherited from `ababa`) — the suffix-link path `ababa → aba → a` correctly funnels every long-palindrome occurrence down to its palindromic suffixes. This is exactly why the order must be length-descending: `aba` must receive `ababa`'s contribution *before* it pushes to `a`.

### Cross-check via per-position counts

Independently, `endCount[last]` per position for `ababa` is `[1, 1, 2, 2, 3]`, summing to `9` — the same total. Two unrelated computations (subtree propagation vs per-position depth) agreeing is a strong correctness signal; if they disagree, you have a propagation-order or `endCount` bug.

---

## Series Links and Quick Links

The suffix-link chain of a node can be long (`O(n)` for `aaaa…`). Many problems need to process **all palindromic suffixes** ending at a position — e.g. palindromic factorization DP (the minimum number of palindromes a prefix splits into). Walking the full chain per position is `O(n²)`.

### The key structural fact

For any node, the **differences** `len[v] - len[link[v]]` along the suffix-link chain take only `O(log n)` distinct values, and the chain partitions into `O(log n)` **series**: maximal runs where this difference is constant. This is a number-theoretic property of palindromes (related to the "Three Squares" / periodicity lemma): the palindromic suffixes of any string form `O(log n)` arithmetic progressions of lengths.

### Series link (diff link)

Define, for each node `v`:

```
diff[v]   = len[v] - len[link[v]]                  // the "step" to the suffix-link parent
slink[v]  = (diff[v] == diff[link[v]]) ? slink[link[v]] : link[v]
```

`slink[v]` (the **series link** / **quick link**) jumps directly to the **top of the current series** — skipping over all suffixes whose `diff` equals `diff[v]`. Walking `slink` instead of `link` visits only `O(log n)` nodes per position, because there are only `O(log n)` series.

### What series links unlock

- **Palindromic factorization** in `O(n log n)`: the famous result that the minimum number of palindromes a string splits into can be computed with eertree + series links (Eertree + the "series ancestor" DP of Kosolobov–Rubinchik–Shur and of Borozdin et al.).
- **Counting palindromic substrings ending at `i`** without walking the full chain.
- Any DP that aggregates over all palindromic suffixes of every prefix.

For pure distinct/total counting you do **not** need series links — plain suffix links suffice. Series links matter when you must *iterate* all palindromic suffixes efficiently.

### Why only `O(log n)` series

The reason palindromic suffix lengths form only `O(log n)` arithmetic progressions is a periodicity fact (the Three-Squares lemma): whenever the `diff` to the suffix-link parent stays constant, the palindromes share a period, and each time `diff` *changes*, the palindrome length at least halves. A length can halve at most `log₂ n` times, so there are `O(log n)` distinct `diff` values — hence `O(log n)` series. This is the same "repeated halving gives logarithmic depth" intuition behind the Euclidean algorithm's running time, applied to palindrome lengths instead of integers.

### Worked series example on `aaaa`

For `s = "aaaa"`, the palindromic suffixes at the last position are `aaaa, aaa, aa, a` with lengths `4, 3, 2, 1`. Each `diff = 1` (consecutive lengths differ by 1), so they form a **single series** with `diff = 1`. `slink` of `aaaa` jumps straight past `aaa, aa` to the top of the series. A factorization DP over this chain touches one series, not four nodes — and for `a^n` it touches `O(1)` series instead of `n` nodes, which is exactly where series links turn an `O(n²)` DP into `O(n log n)`.

---

## Code Examples

### Distinct count, total occurrences, and per-position counts

#### Go

```go
package main

import "fmt"

const SIGMA = 26

type Eertree struct {
	s        []byte
	len      []int
	link     []int
	next     []map[byte]int
	occ      []int64 // occurrence count (before propagation: times node was 'last')
	endCount []int   // # palindromes ending here (depth in suffix-link tree)
	last     int
}

func NewEertree() *Eertree {
	e := &Eertree{
		len:      []int{-1, 0},
		link:     []int{0, 0},
		next:     []map[byte]int{{}, {}},
		occ:      []int64{0, 0},
		endCount: []int{0, 0},
		last:     1,
	}
	return e
}

func (e *Eertree) getLink(x, i int) int {
	for i-e.len[x]-1 < 0 || e.s[i-e.len[x]-1] != e.s[i] {
		x = e.link[x]
	}
	return x
}

func (e *Eertree) Add(c byte) {
	i := len(e.s)
	e.s = append(e.s, c)
	cur := e.getLink(e.last, i)
	if v, ok := e.next[cur][c]; ok {
		e.last = v
		e.occ[v]++
		return
	}
	now := len(e.len)
	e.len = append(e.len, e.len[cur]+2)
	e.next = append(e.next, map[byte]int{})
	e.occ = append(e.occ, 1)
	var lnk int
	if e.len[now] == 1 {
		lnk = 1
	} else {
		lnk = e.next[e.getLink(e.link[cur], i)][c]
	}
	e.link = append(e.link, lnk)
	e.endCount = append(e.endCount, e.endCount[lnk]+1)
	e.next[cur][c] = now
	e.last = now
}

// Propagate occurrence counts up the suffix links (reverse creation order).
func (e *Eertree) Finalize() {
	for v := len(e.len) - 1; v >= 2; v-- {
		e.occ[e.link[v]] += e.occ[v]
	}
}

func main() {
	e := NewEertree()
	s := "ababa"
	for i := 0; i < len(s); i++ {
		e.Add(s[i] - 'a')
	}
	distinct := len(e.len) - 2
	var total int64
	e.Finalize()
	for v := 2; v < len(e.len); v++ {
		total += e.occ[v]
	}
	fmt.Println("distinct:", distinct) // 5: a,b,aba,bab,ababa
	fmt.Println("total:", total)       // 9
}
```

#### Java

```java
import java.util.*;

public class EertreeCounts {
    char[] s = new char[0];
    List<Integer> len = new ArrayList<>(List.of(-1, 0));
    List<Integer> link = new ArrayList<>(List.of(0, 0));
    List<Map<Character, Integer>> next = new ArrayList<>(List.of(new HashMap<>(), new HashMap<>()));
    List<Long> occ = new ArrayList<>(List.of(0L, 0L));
    List<Integer> endCount = new ArrayList<>(List.of(0, 0));
    int last = 1;

    int getLink(int x, int i) {
        while (i - len.get(x) - 1 < 0 || s[i - len.get(x) - 1] != s[i]) x = link.get(x);
        return x;
    }

    void add(char c, int i) {
        int cur = getLink(last, i);
        Integer existing = next.get(cur).get(c);
        if (existing != null) { last = existing; occ.set(existing, occ.get(existing) + 1); return; }
        int now = len.size();
        len.add(len.get(cur) + 2);
        next.add(new HashMap<>());
        occ.add(1L);
        int lnk = (len.get(now) == 1) ? 1 : next.get(getLink(link.get(cur), i)).get(c);
        link.add(lnk);
        endCount.add(endCount.get(lnk) + 1);
        next.get(cur).put(c, now);
        last = now;
    }

    void finalizeCounts() {
        for (int v = len.size() - 1; v >= 2; v--) occ.set(link.get(v), occ.get(link.get(v)) + occ.get(v));
    }

    public static void main(String[] args) {
        EertreeCounts e = new EertreeCounts();
        String str = "ababa";
        e.s = str.toCharArray();
        for (int i = 0; i < str.length(); i++) e.add(str.charAt(i), i);
        e.finalizeCounts();
        long total = 0;
        for (int v = 2; v < e.len.size(); v++) total += e.occ.get(v);
        System.out.println("distinct: " + (e.len.size() - 2)); // 5
        System.out.println("total: " + total);                 // 9
    }
}
```

#### Python

```python
class Eertree:
    def __init__(self):
        self.s = []
        self.length = [-1, 0]
        self.link = [0, 0]
        self.to = [dict(), dict()]
        self.occ = [0, 0]        # times node became 'last'
        self.end_count = [0, 0]  # # palindromes ending at a position whose LPS is this node
        self.last = 1

    def _get_link(self, x, i):
        while i - self.length[x] - 1 < 0 or self.s[i - self.length[x] - 1] != self.s[i]:
            x = self.link[x]
        return x

    def add(self, c):
        i = len(self.s)
        self.s.append(c)
        cur = self._get_link(self.last, i)
        if c in self.to[cur]:
            self.last = self.to[cur][c]
            self.occ[self.last] += 1
            return
        now = len(self.length)
        self.length.append(self.length[cur] + 2)
        self.to.append(dict())
        self.occ.append(1)
        lnk = 1 if self.length[now] == 1 else self.to[self._get_link(self.link[cur], i)][c]
        self.link.append(lnk)
        self.end_count.append(self.end_count[lnk] + 1)
        self.to[cur][c] = now
        self.last = now

    def finalize(self):
        for v in range(len(self.length) - 1, 1, -1):
            self.occ[self.link[v]] += self.occ[v]


if __name__ == "__main__":
    e = Eertree()
    end_at = []
    for ch in "ababa":
        e.add(ch)
        end_at.append(e.end_count[e.last])  # palindromes ending at this position
    e.finalize()
    distinct = len(e.length) - 2
    total = sum(e.occ[2:])
    print("distinct:", distinct)         # 5
    print("total:", total)               # 9
    print("ending at each position:", end_at)  # [1, 1, 2, 2, 3]
```

The per-position counts `[1, 1, 2, 2, 3]` for `ababa` sum to `9`, matching the total occurrence count — two independent ways to compute the same quantity. The `Finalize()` step runs the reverse-creation-order propagation exactly once after the whole string is processed; do not call it mid-build or after a rollback (it mutates `occ` across the tree and is not undoable). The `endCount`-based per-position counts, by contrast, are available live during the build without any finalization — which is why streaming dashboards prefer them.

---

## Error Handling

| Scenario | What goes wrong | Correct approach |
|----------|-----------------|------------------|
| Total count too small | Only counted `last` once, forgot suffix-link propagation. | Run `Finalize()` to push `occ` up suffix links before summing. |
| Propagation in wrong order | Pushed counts parent-before-child, losing contributions. | Iterate nodes in **reverse creation order** (length descending). |
| Per-position count off | Walked the suffix chain per position (`O(n²)`) or miscomputed depth. | Maintain `endCount[node] = endCount[link[node]] + 1` at creation; read `endCount[last]`. |
| Series link wrong | Compared `diff` to the wrong neighbor. | `slink[v] = (diff[v]==diff[link[v]]) ? slink[link[v]] : link[v]`, computed at creation. |
| Overflow on total | Total occurrences can be `~n²/2`, exceeding 32-bit. | Use 64-bit for `occ` and the total sum. |
| Distinct off by one | Subtracted one root instead of two. | `distinct = numberOfNodes - 2`. |
| Length-1 link wrong | Linked single chars to the imaginary root. | Length-1 palindromes link to the **empty** root (length 0). |
| Finalize called twice | Propagated `occ` more than once, doubling counts. | Run the reverse-order propagation exactly once, as a terminal step. |

---

## Performance Analysis

| `n` | Build (`O(n)`) | Distinct read | Total occ. (build + propagate) | Notes |
|-----|----------------|---------------|-------------------------------|-------|
| 10³ | instant | O(1) | O(n) | trivial |
| 10⁶ | ~ms | O(1) | O(n) | fine in any language with array children |
| 10⁷ | tens of ms | O(1) | O(n) | use array children + preallocation; maps slow here |
| 10⁸ | needs care | O(1) | O(n) | array children, primitive arrays, avoid per-node objects |

The whole pipeline is linear: build `O(n · |Σ|)` (array) or `O(n log |Σ|)` (map), occurrence propagation `O(n)`, per-position counts `O(n)`. The constant factor is dominated by child lookups; for big `n` and small alphabets, fixed `int[|Σ|]` arrays beat maps by a wide margin (no hashing, cache-friendly), at the cost of `O(n · |Σ|)` memory. For `n = 10^6` over lowercase letters, array children build in tens of milliseconds in a compiled language; the same in pure Python with `dict` children is seconds — acceptable for tasks but a reason to prefer Go/Java/C++ for very large inputs.

```python
# Sanity: per-position counts sum to total occurrences
assert sum(end_at) == total
```

The single biggest correctness check is the **brute-force oracle**: count distinct (set of palindromic substrings) and total (count all palindromic substrings with multiplicity) the `O(n²)` way for small `n`, and diff against the eertree.

---

## Best Practices

- **Annotate at creation:** compute `endCount`, `diff`, and `slink` when a node is created, not in a later pass — it keeps everything `O(1)` per character.
- **Propagate once at the end:** occurrence counts need a single reverse-order pass; do not propagate after every character.
- **64-bit counts:** total occurrences are `O(n²)`; always use 64-bit accumulators.
- **Array children for small Σ, maps for large:** keep the rest of the code identical; only the child container changes.
- **Use series links only when iterating suffixes:** for plain distinct/total counts, suffix links suffice; series links add complexity you do not need.
- **Always validate against the brute-force oracle** on random small strings for distinct, total, and per-position counts.
- **Length-1 palindromes link to the empty root** (length 0), never the imaginary root — the classic bug.
- **Use 64-bit even for the running total** computed via `Σ endCount[last]`; it reaches `Θ(n²)` just like the propagated total.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive view.
>
> The middle-level animation highlights:
> - The suffix-link walk from `last` searching for the longest extensible palindromic suffix `X`
> - Whether the edge `X --c-->` already exists (reuse) or a new node is created
> - The new node's `len = len[X] + 2` and its suffix link being set
> - The running distinct count (`nodes - 2`) and palindromes-ending-here as characters are appended
> - The two roots (imaginary `len -1`, empty `len 0`) and the two parity trees they anchor
> - An editable string so you can watch how `aaaa` (one long chain) differs from `abab` (interleaved)

---

## Summary

The online eertree construction maintains `last` (the longest palindromic suffix of the current prefix) and, for each appended character `c`, **walks suffix links** from `last` to find the longest palindromic suffix `X` such that `cXc` is a palindrome ending at the new position. If the edge already exists, the palindrome was seen before (no new node); otherwise it creates exactly one new node — the reason the structure is linear, proven by an amortized-potential argument on `len[last]`. **Distinct** palindromes are `numberOfNodes - 2`; **total** palindromic occurrences come from propagating per-node `occ` counts up the suffix-link tree in reverse creation order; the **number of palindromes ending at each position** is `endCount[last]`, tracked in `O(1)` per character. **Series links** compress the `O(log n)`-many length-progressions of palindromic suffixes so you can iterate all palindromic suffixes of every prefix in `O(n log n)` — the key to palindromic factorization. Use the eertree (not Manacher) whenever you need the explicit **set** of distinct palindromes or per-palindrome annotations; reach for Manacher (sibling `11`) for the single longest palindrome or a quick total count. The senior file covers production concerns (memory layout, generalized/rollback eertrees); the professional file proves the `≤ n + 2` bound, the amortization, and the occurrence-propagation correctness.
