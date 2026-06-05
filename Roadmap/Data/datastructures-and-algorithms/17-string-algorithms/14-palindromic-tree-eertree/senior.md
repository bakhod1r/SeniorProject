# Palindromic Tree (eertree) — Senior Level

> The eertree is rarely the bottleneck on a short string — but the moment the string is `10^8` characters, the alphabet is Unicode-sized, you must support **multiple strings** or **persistence/rollback**, or the structure sits behind a streaming service, every detail (children layout, memory per node, the suffix-link walk's amortization, count-propagation order, and the correctness of generalized/persistent variants) becomes a correctness or performance incident.

## Table of Contents
1. [Introduction](#1-introduction)
2. [Memory Layout: Map vs Array Children](#2-memory-layout-map-vs-array-children)
3. [The Online Construction as a Production Engine](#3-the-online-construction-as-a-production-engine)
4. [Generalized eertree for Multiple Strings](#4-generalized-eertree-for-multiple-strings)
5. [Persistent and Rollback eertree](#5-persistent-and-rollback-eertree)
6. [Count Propagation at Scale](#6-count-propagation-at-scale)
7. [Series Links and Factorization Workloads](#7-series-links-and-factorization-workloads)
8. [Code Examples](#8-code-examples)
9. [Observability and Testing](#9-observability-and-testing)
10. [Failure Modes](#10-failure-modes)
11. [Summary](#11-summary)

---

## 1. Introduction

At the senior level the question is no longer "why does each character add at most one palindrome" but "what system am I building around the eertree, and what breaks when I scale it?". The structure shows up in three production guises that share one engine:

1. **Bulk palindrome analytics** — distinct counts, total occurrences, richness, and per-position statistics over very long strings (genomics, log analysis, plagiarism/repeat detection). The string may be `10^8`+ characters; memory per node and children layout dominate.
2. **Multi-string / corpus queries** — building one **generalized eertree** over many strings to find palindromes shared across documents, or per-document occurrence counts.
3. **Interactive / versioned input** — appending and **rolling back** characters (e.g. an editor, a DFS over a trie of strings), which needs a **persistent or rollback** eertree.

All three reduce to: *maintain the two roots, the per-node `len`/`link`/children, and the active `last` pointer; append characters online; annotate nodes; and (for queries) propagate along suffix links.* The senior decisions are how to keep memory linear, how to keep the append amortized `O(1)`, how to generalize correctly to multiple strings and to rollback, and how to verify results when the string is too large to brute-force.

This document treats those decisions in production terms.

---

## 2. Memory Layout: Map vs Array Children

The single biggest engineering lever is how each node stores its children (the character-labeled edges).

| Layout | Memory / node | Lookup | Best for |
|--------|---------------|--------|----------|
| **Array `int[|Σ|]`** | `|Σ|` ints (e.g. 26×4 = 104 B) | `O(1)`, cache-friendly | small fixed alphabets (DNA, lowercase) |
| **Hash map** | proportional to children present | `O(1)` expected, slower constant | large/sparse alphabets (Unicode) |
| **Sorted small vector / open addressing** | proportional to children | `O(log d)` or `O(1)` | medium alphabets, memory-tight |

### 2.1 The `O(n · |Σ|)` trap

With array children, total memory is `O(n · |Σ|)`. For `n = 10^7` and `|Σ| = 26`, that is `~1 GB` of child pointers alone — often unacceptable. Three mitigations:

- **Map children** drop memory to `O(total distinct edges) = O(n)`, at a constant-factor time cost.
- **Coordinate-compress the alphabet** to only the characters that actually appear, shrinking `|Σ|`.
- **Open-addressed flat hashing** per node (a tiny inline hash table) gives near-array speed with near-map memory for moderate alphabets.

### 2.2 Struct-of-arrays vs array-of-structs

For cache performance and to avoid per-node object overhead (critical in Java/Python), store the eertree as **parallel arrays** (`len[]`, `link[]`, `occ[]`, and a children container per node) rather than an array of node objects. Reverse-creation-order propagation then becomes a simple backward loop over a primitive array — fast and allocation-free.

### 2.3 Memory budget

Each node needs: `len` (4 B), `link` (4 B), optional `occ` (8 B), optional `series`/`diff` (8 B), plus children. So `~24 B` of bookkeeping + children per node, and at most `n + 2` nodes. With map children the dominant term is the map overhead; preallocating and reusing map capacity, or using a compact custom map, matters at `10^7`+.

### 2.4 A concrete memory comparison

For `n = 10^7` lowercase-letter text:

| Layout | Per-node children | Total (≈10^7 nodes) | Build speed |
|--------|-------------------|---------------------|-------------|
| `int32[26]` array | 104 B | ~1.1 GB just for children | fastest |
| open-addressed inline (cap 4) | ~24 B | ~250 MB | ~1.3× array time |
| `HashMap<Char,Int>` | ~48–80 B + overhead | ~600 MB–1 GB (boxed) | ~2–4× array time |

The array layout is fastest but memory-hostile; for very long strings the open-addressed inline table is usually the best trade-off. In managed runtimes (Java/Python) **boxing** is the silent killer — a `HashMap<Character,Integer>` boxes both key and value, ballooning per-entry cost; use primitive-keyed maps (e.g. fastutil `Char2IntOpenHashMap`) or a custom open-addressed `int[]` to stay competitive.

### 2.5 Alphabet compression

When the alphabet is large but only a few symbols appear (e.g. a DNA file that is really 4 symbols, or text restricted to a known set), **remap** characters to a dense `0..k-1` range at ingestion. This shrinks array-children width from `|Σ|` to `k`, often turning an infeasible array layout into a feasible one. The remap table is `O(|Σ|)` and built in one pass; downstream code is unchanged because it already indexes by the compressed symbol.

---

## 3. The Online Construction as a Production Engine

### 3.1 Amortization in practice

The suffix-link walk inside `add` is amortized `O(1)` because `len[last]` rises by at most 2 per character and falls by at least 1 per walk step, with total rise bounded by `n`. In production this means: do **not** add per-character safety loops or rebuild logic that breaks the amortization; a single stray `O(len)` operation per character silently degrades the build to `O(n²)`. Profile by tracking total walk steps — it must stay `≤ 2n`.

### 3.2 Append returns rich signals

A production `add` should expose: whether a **new palindrome** was created (for online distinct counts), the new `last` (longest palindromic suffix), `len[last]` (its length), and `endCount[last]` (palindromes ending here). These are all `O(1)` to surface and turn the eertree into a streaming analytics engine.

### 3.3 Streaming and bounded memory

The eertree is genuinely **online**: you never need the full string buffered for the *structure* (though `getLink` indexes `s[i - len - 1]`, so you do need the characters of palindromic suffixes still reachable — in practice the whole processed prefix, unless you bound palindrome length). For unbounded streams, cap the maximum palindrome length to bound the retained suffix window, accepting that palindromes longer than the cap are not tracked.

### 3.4 Incremental query maintenance

Many services want the distinct count, total count, and per-position count live as characters arrive. Distinct (`nodes - 2`) and per-position (`endCount[last]`) are already `O(1)` per character. **Total occurrences**, however, normally needs the terminal reverse-order propagation. Two production patterns:

- **Lazy:** maintain only `occ[v]` (times `v` became `last`); run the `O(n)` propagation on demand when a total query lands. Cheap appends, occasional `O(n)` query.
- **Eager:** maintain a running total via `Σ endCount[last_i]` (which equals the total, Corollary 7.4 of the professional file) — incremented by `endCount[last]` each character. This gives the running total in `O(1)` per character without any propagation pass.

The eager pattern is preferred for streaming dashboards; the lazy pattern for batch analytics where queries are rare.

### 3.5 Determinism and reproducibility

The eertree build is fully deterministic given the input string and alphabet mapping — no randomness, no hash-order dependence (provided child iteration order is not exposed). This makes it ideal for **golden-file testing** across languages: the same string must produce identical node counts, distinct counts, and total counts in Go, Java, and Python. Any divergence signals an implementation bug (usually the length-1 link or the index off-by-one). Pin a small corpus of dense-palindrome strings as golden inputs in CI.

---

## 4. Generalized eertree for Multiple Strings

A **generalized eertree** stores the distinct palindromes of a *collection* of strings, so you can ask "which palindromes appear in document A and document B" or "how many distinct palindromes across the whole corpus".

### 4.1 Construction

Process each string, but **reset `last` to the empty root** between strings (a palindrome cannot span two independent strings). The nodes, `len`, `link`, and children **persist** across strings — that is what makes shared palindromes share a node. Key subtlety: `getLink`'s bounds check `i - len[x] - 1 < 0` must be relative to the **current string's** start, so use a per-string offset or re-zero `i` and keep a per-string character buffer.

### 4.2 Per-string annotations

To know which strings a palindrome occurs in, keep a per-node bitset or count vector indexed by string id, incremented whenever that node becomes `last` while processing the corresponding string. To avoid double-counting within one string, mark "last string id that touched this node" and only bump when it changes. Memory is `O(nodes × numStrings / 64)` for bitsets — fine for a handful of documents, costly for thousands (use hashing or sampling then).

### 4.3 Correctness pitfall

The classic bug is **not resetting `last`** between strings, which lets the suffix-link walk find a palindrome ending in the *previous* string and fabricate a cross-string palindrome that does not exist. Always reset `last = emptyRoot` and re-base the position index per string.

---

## 5. Persistent and Rollback eertree

Interactive workloads append a character and later **undo** it (editor backspace; DFS that appends along a trie edge then backtracks). Two strategies:

### 5.1 Rollback (undo log)

Because `add` mutates a bounded set of fields — it appends at most one node, sets one child edge, updates `last` (and `occ`/`endCount`) — you can record an **undo record** per `add`:

```
undo record:
  prevLast
  createdNode?   (node index, or none)
  editedChildEdge (cur, c) and its previous value (usually "absent")
  prevOccDelta / endCount entry
```

To roll back, pop the record: restore `last`, remove the created node (it is always the last node, so a simple length decrement of the parallel arrays), and clear the child edge. This gives **`O(1)` amortized rollback** and is the standard technique for "eertree on a trie" (process all strings sharing prefixes via DFS, appending on the way down and rolling back on the way up — building a generalized eertree without re-processing shared prefixes).

### 5.2 Full persistence

True persistence (query any past version) requires path-copying the mutated nodes per version, like a persistent segment tree. It is heavier and rarely needed; **rollback** covers the common DFS/undo case. Reach for full persistence only when you must keep *all* versions queryable simultaneously.

### 5.3 The "eertree on a trie" pattern

Given many strings arranged as a trie, do a DFS: on entering an edge labeled `c`, call `add(c)` with the parent node's `last` as context; on leaving, roll back. This builds the generalized eertree of all strings in `O(totalTrieSize · |Σ|)` instead of `O(Σ stringLengths)`, sharing work across common prefixes — a major win for large dictionaries of related strings.

### 5.4 Rollback constraints

Rollback is only sound while the eertree is in its "construction" phase — i.e. before any terminal mutation like occurrence-count propagation. The undo log restores `last`, the node arrays, and the touched child edge, but it does **not** track changes made by `Finalize()` (which rewrites `occ` across the whole tree). Therefore:

- **Never roll back after finalizing.** If you need counts mid-DFS, recompute them from a fresh pass on the current node set rather than propagating-then-rolling-back.
- **The created node is always the last index.** Removing it is a simple array truncation; this relies on `add` only ever appending. If any code reorders nodes, rollback breaks.
- **The edited edge is always an insertion** (the palindrome was new), so undo is "delete the edge", never "restore an old target". The undo log can store just `(parent, char)`.

These constraints make rollback `O(1)` and bug-resistant, but they are load-bearing — a violation (e.g. mutating an existing edge during `add`) silently corrupts the undo.

### 5.5 Choosing rollback vs rebuild

For a DFS over a trie, rollback is essential (rebuilding per node is `O(depth)` extra). For a simple editor with rare undos, the cost of rebuilding from the buffer on undo may be acceptable and far simpler. Decision rule: if undos are frequent or interleaved with deep append sequences (trie DFS), use rollback; if undos are rare and the string is short, rebuild-on-undo is simpler and less error-prone.

---

## 6. Count Propagation at Scale

### 6.1 Occurrence counts

Each time a node becomes `last`, it gains one occurrence; every palindromic suffix of it also occurs there. So initialize `occ[v] = (times v was last)`, then **propagate up suffix links in reverse creation order**:

```
for v from lastNode down to firstRealNode:
    occ[link[v]] += occ[v]
```

After this, `occ[v]` is the exact occurrence count of palindrome `v`. Total palindromic substrings = `Σ occ[v]`. This is `O(n)` and allocation-free over parallel arrays.

### 6.2 Why reverse creation order is exactly length-descending

Nodes are created with **non-decreasing** `len` (a new palindrome is `len[cur] + 2`, and `cur` is always an already-existing node of smaller length). Hence creation index order is a topological order of the suffix-link tree by length, and processing in reverse guarantees a node's full count is accumulated before being pushed to its (shorter) suffix-link parent. No explicit sort by length is required — a meaningful constant-factor and simplicity win at scale.

### 6.3 Per-position and prefix aggregates

`endCount[last]` after each character is the number of palindromes ending there; a prefix sum gives total palindromes in any prefix. `len[last]` is the longest palindromic suffix per prefix. Both are `O(1)` per character and feed palindromic-factorization DPs.

### 6.4 Overflow and modular pipelines

Total occurrences are `Θ(n²)` in the worst case (`a^n` gives `n(n+1)/2`), overflowing 32-bit around `n ≈ 92682`. Always use 64-bit `occ` accumulators. When the problem demands the count modulo a prime, reduce at every `occ[link[v]] += occ[v]` step; the reduction is a ring homomorphism and commutes with propagation, so the final value is the true total mod `p`. If an *exact* huge count is needed beyond 64-bit, run the propagation under several coprime primes and CRT-combine — embarrassingly parallel, like the matrix-exponentiation counting pipeline (sibling `32` in `11-graphs`).

### 6.5 Parallelism limits

The eertree **build** is inherently sequential: each `add` depends on the previous `last`. There is no known work-efficient parallel construction, so for a single huge string you cannot trivially parallelize. What *is* parallelizable: building **independent** eertrees for unrelated strings (corpus sharding), and the CRT-prime runs of the occurrence-count pipeline. The propagation pass is sequential (parent depends on children) but `O(n)` and cheap. Plan capacity around the sequential build being the bottleneck.

---

## 7. Series Links and Factorization Workloads

For DPs that aggregate over **all** palindromic suffixes of every prefix (minimum palindromic factorization, counting palindromic partitions), naive suffix-chain walks are `O(n²)`. **Series links** (`diff`/`slink`) exploit that the palindromic suffixes form `O(log n)` arithmetic-progression series:

```
diff[v]  = len[v] - len[link[v]]
slink[v] = (diff[v] == diff[link[v]]) ? slink[link[v]] : link[v]
```

The series DP keeps, per series, a running best value at the top of the series and updates it in `O(1)` as you move down, achieving **`O(n log n)`** total. This is the production-grade method for:

- **Minimum palindromic factorization** (fewest palindromes a string splits into).
- **Counting the number of palindromic factorizations** (mod a prime).
- **Even/odd palindromic partition** variants.

Implementing the series DP correctly is subtle (the "series ancestor" handoff between consecutive positions); test it hard against an `O(n²)` DP oracle on small inputs.

### 7.1 Maintaining series links incrementally

Compute `diff[v]` and `slink[v]` **at node creation**, in `O(1)`:

```
diff[v]  = len[v] - len[link[v]]
slink[v] = (diff[v] == diff[link[v]]) ? slink[link[v]] : link[v]
```

Because `link[v]` already exists when `v` is created (it is a shorter palindrome), `diff[link[v]]` and `slink[link[v]]` are available — no second pass. This keeps the augmented build still `O(1)` amortized per character.

### 7.2 The series DP, sketched

For minimum factorization `f`, maintain a per-node `seriesAns`. When processing position `i`, iterate the `O(log n)` series of `last` via `slink`; for each series, update its stored `seriesAns` from the previous position's value (the "series ancestor" handoff: a series at position `i` corresponds to one at position `i - diff` shifted by the period), then combine to get `f(i)`. The handoff is the subtle part — it relies on the fact that a series' palindromes at consecutive positions differ by exactly the period. Getting it wrong produces answers that are correct on short inputs (few series) but wrong on long, periodic ones; hence the `O(n²)`-oracle test on strings like `a^k b a^k`.

### 7.3 When to skip series links entirely

Series links are pure overhead for the common queries (distinct, total, per-position, longest, richness) — those need only plain `link`. Add `diff`/`slink` **only** when implementing a factorization-style DP that aggregates over all palindromic suffixes. Over-engineering the eertree with series links you never use wastes memory (`8 B`/node) and invites bugs. Default to plain suffix links; reach for series links on demand.

---

## 8. Code Examples

### 8.1 Go — production eertree with map children, occurrence counts, and rollback

```go
package main

import "fmt"

type Eertree struct {
	s        []int32
	len      []int
	link     []int
	next     []map[int32]int
	occ      []int64
	last     int
	undo     [][3]int // (prevLast, createdNode or -1, parentForEdge or -1)
	undoCh   []int32  // edge char to clear on rollback
}

func NewEertree() *Eertree {
	return &Eertree{
		len:  []int{-1, 0},
		link: []int{0, 0},
		next: []map[int32]int{{}, {}},
		occ:  []int64{0, 0},
		last: 1,
	}
}

func (e *Eertree) getLink(x, i int) int {
	for i-e.len[x]-1 < 0 || e.s[i-e.len[x]-1] != e.s[i] {
		x = e.link[x]
	}
	return x
}

func (e *Eertree) Add(c int32) bool {
	i := len(e.s)
	e.s = append(e.s, c)
	prevLast := e.last
	cur := e.getLink(e.last, i)
	if v, ok := e.next[cur][c]; ok {
		e.last = v
		e.occ[v]++
		e.undo = append(e.undo, [3]int{prevLast, -1, -1})
		e.undoCh = append(e.undoCh, 0)
		return false
	}
	now := len(e.len)
	e.len = append(e.len, e.len[cur]+2)
	e.next = append(e.next, map[int32]int{})
	e.occ = append(e.occ, 1)
	if e.len[now] == 1 {
		e.link = append(e.link, 1)
	} else {
		e.link = append(e.link, e.next[e.getLink(e.link[cur], i)][c])
	}
	e.next[cur][c] = now
	e.last = now
	e.undo = append(e.undo, [3]int{prevLast, now, cur})
	e.undoCh = append(e.undoCh, c)
	return true
}

// Rollback the most recent Add (assumes no Finalize/propagation has run).
func (e *Eertree) Rollback() {
	k := len(e.undo) - 1
	rec := e.undo[k]
	ch := e.undoCh[k]
	e.undo = e.undo[:k]
	e.undoCh = e.undoCh[:k]
	e.s = e.s[:len(e.s)-1]
	if rec[1] != -1 { // a node was created
		delete(e.next[rec[2]], ch)
		e.len = e.len[:rec[1]]
		e.link = e.link[:rec[1]]
		e.next = e.next[:rec[1]]
		e.occ = e.occ[:rec[1]]
	} else {
		e.occ[e.last]-- // we had incremented an existing node
	}
	e.last = rec[0]
}

func main() {
	e := NewEertree()
	for _, c := range []int32{0, 1, 0} { // "aba"
		e.Add(c)
	}
	fmt.Println("distinct after aba:", len(e.len)-2) // 3
	e.Rollback()                                     // undo last 'a'
	fmt.Println("distinct after ab:", len(e.len)-2)  // 2
}
```

### 8.2 Java — generalized eertree over multiple strings (per-string occurrence)

```java
import java.util.*;

public class GeneralizedEertree {
    int[] len = new int[2];
    int[] link = new int[2];
    List<Map<Character, Integer>> next = new ArrayList<>(List.of(new HashMap<>(), new HashMap<>()));
    int size = 2, last = 1;
    char[] s; int base; // current string buffer and start offset

    GeneralizedEertree() { len[0] = -1; len[1] = 0; link[0] = 0; link[1] = 0; }

    int getLink(int x, int i) {
        while (i - len[x] - 1 < base || s[i - len[x] - 1] != s[i]) x = link[x];
        return x;
    }

    void add(char c, int i) {
        int cur = getLink(last, i);
        Integer ex = next.get(cur).get(c);
        if (ex != null) { last = ex; return; }
        if (size == len.length) { len = Arrays.copyOf(len, size * 2); link = Arrays.copyOf(link, size * 2); }
        int now = size++;
        len[now] = len[cur] + 2;
        next.add(new HashMap<>());
        link[now] = (len[now] == 1) ? 1 : next.get(getLink(link[cur], i)).get(c);
        next.get(cur).put(c, now);
        last = now;
    }

    void addString(String str) {
        s = str.toCharArray();
        base = 0;          // re-zero per string buffer
        last = 1;          // CRITICAL: reset to empty root between strings
        for (int i = 0; i < s.length; i++) add(s[i], i);
    }

    public static void main(String[] args) {
        GeneralizedEertree g = new GeneralizedEertree();
        g.addString("aba");
        g.addString("aca");
        // distinct palindromes across both: a, b, c, aba, aca -> 5
        System.out.println("distinct across corpus: " + (g.size - 2)); // 5
    }
}
```

### 8.3 Python — distinct, total, richness with a brute-force oracle

```python
class Eertree:
    def __init__(self):
        self.s, self.length, self.link = [], [-1, 0], [0, 0]
        self.to, self.occ, self.last = [dict(), dict()], [0, 0], 1

    def _gl(self, x, i):
        while i - self.length[x] - 1 < 0 or self.s[i - self.length[x] - 1] != self.s[i]:
            x = self.link[x]
        return x

    def add(self, c):
        i = len(self.s); self.s.append(c)
        cur = self._gl(self.last, i)
        if c in self.to[cur]:
            self.last = self.to[cur][c]; self.occ[self.last] += 1; return
        now = len(self.length)
        self.length.append(self.length[cur] + 2); self.to.append(dict()); self.occ.append(1)
        self.link.append(1 if self.length[now] == 1 else self.to[self._gl(self.link[cur], i)][c])
        self.to[cur][c] = now; self.last = now

    def finalize(self):
        for v in range(len(self.length) - 1, 1, -1):
            self.occ[self.link[v]] += self.occ[v]


def oracle(s):
    distinct = {s[i:j] for i in range(len(s)) for j in range(i + 1, len(s) + 1) if s[i:j] == s[i:j][::-1]}
    total = sum(1 for i in range(len(s)) for j in range(i + 1, len(s) + 1) if s[i:j] == s[i:j][::-1])
    return len(distinct), total


if __name__ == "__main__":
    import random
    for _ in range(2000):
        s = "".join(random.choice("ab") for _ in range(random.randint(0, 12)))
        e = Eertree()
        for ch in s:
            e.add(ch)
        e.finalize()
        distinct = len(e.length) - 2
        total = sum(e.occ[2:])
        assert (distinct, total) == oracle(s), s
    print("all property tests passed")
```

---

## 9. Observability and Testing

An eertree result is opaque — a wrong distinct count looks like any other number. Build checks in from day one.

| Check | Why |
|-------|-----|
| Brute-force oracle on small strings | Catches the length-1-link bug, the off-by-two root bug, and propagation-order bugs. |
| `numberOfNodes ≤ n + 2` invariant | A violation means a duplicate node was created (a `getLink` bug). |
| Total walk steps `≤ 2n` | Confirms the amortization is intact; a regression means `O(n²)` lurking. |
| `Σ occ[v] == Σ endCount[last_i]` | Two independent computations of total occurrences must agree. |
| `len[link[v]] < len[v]` for all real nodes | Suffix links must strictly decrease length. |
| Length-1 nodes link to empty root | The single most common bug. |
| Generalized: reset `last` per string | Cross-string palindromes must not appear. |
| Rollback round-trip | `add` then `Rollback` must restore byte-identical state. |

### 9.1 A property-test battery

```text
for random small string s over a 2-3 letter alphabet:
    build eertree; finalize
    assert nodes - 2 == distinct_palindromes_bruteforce(s)
    assert sum(occ[2:]) == total_palindromes_bruteforce(s)
    assert sum(endCount[last_i]) == total
    assert all len[link[v]] < len[v] for real v
    assert all len-1 nodes link to empty root
for rollback: add k chars, rollback k, assert state == empty-state
```

The most valuable test is the **brute-force oracle** comparing distinct and total counts for `|s| ≤ 14` over a tiny alphabet (which maximizes palindrome density and so exercises long suffix chains).

### 9.0 Adversarial test strings

Beyond random inputs, hand-pick adversarial cases that stress specific invariants:

- `a^n` — maximal total count (`n(n+1)/2`), longest suffix-link chains, worst for occurrence overflow.
- `(ab)^k` — alternating, exercises both odd and even palindromes and frequent reuse.
- `a^k b a^k` — forces a long suffix-link collapse at the middle, stressing the amortization (a single `add` walks `Θ(k)`).
- random over `{a,b}` — densest palindrome structure, best brute-force coverage per length.
- a string with one rare character among a common one — stresses map vs array children behavior.

Running the oracle on this fixed adversarial set plus random inputs gives high confidence cheaply.

### 9.2 Production guardrails

For a service, add: an **input validator** (alphabet within bounds, length within the configured cap); a **node-count gauge** logged per build (should track `≤ n + 2`); and a **walk-step counter** sampled in canary builds to detect amortization regressions before they hit `O(n²)` in production.

---

## 10. Failure Modes

### 10.1 Length-1 suffix link to the wrong root
Linking single characters to the imaginary root instead of the empty root corrupts every downstream suffix-link computation. Mitigation: explicit `if len == 1: link = emptyRoot`, asserted in tests.

### 10.2 Missing bounds guard in `getLink`
Indexing `s[i - len - 1]` without checking `>= 0` (or `>= base` in the generalized case) crashes or reads stale data. Mitigation: the `< 0` / `< base` check must be the **first** clause, short-circuiting before the array access.

### 10.3 Broken amortization
A stray per-character `O(len)` loop (e.g. recomputing `endCount` by walking the chain) silently turns the build into `O(n²)`. Mitigation: maintain `endCount`/`occ`/`diff` in `O(1)` at creation; monitor total walk steps `≤ 2n`.

### 10.4 Propagation order
Pushing `occ` parent-before-child loses counts. Mitigation: iterate nodes in reverse creation order (length-descending); never sort by something else.

### 10.5 Generalized: forgot to reset `last`
Carrying `last` across strings fabricates cross-string palindromes. Mitigation: reset `last = emptyRoot` and re-base the index at each new string.

### 10.6 Memory blow-up with array children
`O(n · |Σ|)` child memory OOMs on long strings or big alphabets. Mitigation: map children, alphabet compression, or open-addressed inline tables.

### 10.7 Overflow on totals
Total occurrences are `~n²/2`; 32-bit overflows for `n` beyond `~90 000`. Mitigation: 64-bit `occ` and sums; modular reduction if the problem asks for it.

### 10.8 Rollback after propagation
Rolling back after `Finalize()` (which mutated `occ` via propagation) corrupts counts. Mitigation: never roll back after finalizing; keep propagation as a terminal, non-undoable step, or recompute counts from a fresh pass.

---

## 11. Summary

- **Memory layout is the senior lever.** Array children are `O(1)` and cache-friendly but `O(n · |Σ|)` memory; map (or compressed/open-addressed) children are `O(n)` memory at a constant-factor time cost. Store as parallel arrays, not node objects.
- **Keep the append amortized `O(1)`.** The suffix-link walk is linear in total by the `len[last]` potential argument; any stray per-character `O(len)` work breaks it. Monitor total walk steps `≤ 2n`.
- **Generalized eertree** stores palindromes across many strings: persist nodes/links/children, but **reset `last` to the empty root** and re-base the index per string; annotate with per-string bitsets/counts.
- **Rollback** exploits that `add` mutates a bounded set of fields (one node, one edge, `last`); an undo log gives `O(1)` rollback, powering the "eertree on a trie" DFS that builds a generalized eertree sharing prefix work. Full persistence (path-copying) is heavier and rarely needed.
- **Count propagation** is one reverse-creation-order pass (length-descending by construction): `occ[link[v]] += occ[v]` yields exact occurrences; total = `Σ occ`. `endCount[last]` gives per-position counts; `len[last]` gives longest palindromic suffix per prefix.
- **Series links** (`diff`/`slink`) compress the `O(log n)` length-series of palindromic suffixes, turning factorization DPs from `O(n²)` to `O(n log n)`.
- **Always keep a brute-force oracle** for distinct and total counts on small dense-palindrome strings; it catches the length-1-link, off-by-two-root, and propagation-order bugs that account for nearly every real defect.

### Decision summary

- **Long string, distinct/total counts** → array children if `|Σ|` small and memory allows; else map/compressed children; 64-bit counts.
- **Multiple strings / corpus** → generalized eertree, reset `last` per string, per-string annotations.
- **Append + undo (editor, trie DFS)** → rollback eertree with an undo log.
- **All-versions-queryable** → persistent (path-copying) eertree — only if truly required.
- **Factorization / aggregate over all palindromic suffixes** → series links, `O(n log n)`.
- **Just the longest palindrome or a quick total** → use Manacher (sibling `11`) instead.

References to study further: Rubinchik–Shur (the original EERTREE paper and its multi-string/persistent extensions), the series-link palindromic-factorization results (Kosolobov–Rubinchik–Shur; Borozdin–Kosolobov–Rubinchik–Shur), suffix-automaton `endpos` propagation (the structural cousin of occurrence propagation), and sibling topics `11-manacher` and the parent `17-string-algorithms`.
