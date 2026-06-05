# Suffix Automaton (SAM) — Senior Level

> A suffix automaton is rarely the bottleneck on a short string — but the moment the text is hundreds of megabytes, the alphabet is large, multiple strings must share one index, or the result must be exact and reproducible across languages, every detail (transition storage, clone accounting, generalized-SAM merging, terminal marking, memory layout, and testing strategy) becomes a correctness or performance incident.

## Table of Contents
1. [Introduction](#1-introduction)
2. [Memory: Array vs Map Transitions and the Alphabet](#2-memory-array-vs-map-transitions-and-the-alphabet)
3. [Generalized SAM for Multiple Strings](#3-generalized-sam-for-multiple-strings)
4. [Large-Text Indexing](#4-large-text-indexing)
5. [The Suffix-Link Tree as a Query Engine](#5-the-suffix-link-tree-as-a-query-engine)
6. [Numerical and Counting Concerns](#6-numerical-and-counting-concerns)
7. [Code Examples](#7-code-examples)
8. [Observability and Testing](#8-observability-and-testing)
9. [Failure Modes](#9-failure-modes)
10. [Summary](#10-summary)

---

## 1. Introduction

At the senior level the question is no longer "why does the SAM recognize all substrings" but "what system am I building on top of it, and what breaks when I scale it?". A suffix automaton shows up in production in several guises that share one engine:

1. **A substring index over a fixed large text** — answer "does `p` occur, and how often" for a stream of queries, where the text is large and the queries are many.
2. **A multi-document index** — a *generalized* SAM over a set of documents, answering "in how many documents does substring `p` appear" or "longest substring common to all".
3. **An analytic engine** — distinct-substring counts, total distinct length, k-th substring, ranking, all derived from `len`/`link` and the suffix-link tree.

All three reduce to: *build the automaton (or generalized automaton) once, precompute aggregates over the suffix-link tree, then answer each query by an `O(|p|)` walk plus an `O(1)` lookup.* The senior decisions are: how to store transitions to fit memory and stay fast, how to merge multiple strings without corrupting endpos semantics, how to lay the structure out for cache-friendly traversal, and how to verify correctness when the text is too large to brute-force.

---

## 2. Memory: Array vs Map Transitions and the Alphabet

### 2.1 The transition-storage trade-off

Each state stores its outgoing transitions as `char → state`. Two layouts dominate:

| Layout | Lookup | Memory | Best for |
|--------|--------|--------|----------|
| Fixed array `[σ]int` per state | `O(1)` | `O(states · σ)` | small fixed alphabet (DNA σ=4, lowercase σ=26) |
| Hash map per state | `O(1)` amortized, larger constant | `O(total edges)` = `O(states)` | large/sparse alphabet (Unicode, σ up to 10⁵) |
| Sorted small vector | `O(log deg)` | `O(total edges)` | medium alphabet, cache-friendly |
| Global open-addressing table keyed by `(state,char)` | `O(1)` amortized | `O(total edges)`, low overhead | huge graphs where per-node maps waste memory |

For `n = 10^6` and `σ = 26`, array transitions cost `~2·10^6 · 26 · 4 bytes ≈ 200 MB` — often too much. The map or global-table layout stores only the `≤ 3n-4` real edges, `~12 MB`. The rule: **arrays for small σ and speed, maps/tables for large σ or tight memory.**

### 2.2 Alphabet compression

If the alphabet is large but the text uses few distinct symbols, **remap** characters to a dense `[0, σ')` range first. This shrinks array transitions and improves cache behavior. Keep the inverse map for reporting.

### 2.3 Memory accounting

Per state you store: `len` (int), `link` (int), `cnt` (long), `firstpos` (int, optional), terminal flag (bit), and transitions. With ≤ `2n-1` states, the non-transition overhead is `O(n)`. The transitions dominate; choose their layout deliberately. Preallocate to `2n` states to avoid reallocation churn during the online build.

---

## 3. Generalized SAM for Multiple Strings

A **generalized suffix automaton** indexes the substrings of a *set* of strings `{s_1, …, s_m}`. Two correct construction strategies:

### 3.1 Reset-`last` insertion (simple, with a guard)

Insert each string in turn, resetting `last = root` before each. Crucially, you must **not** create a duplicate state when the next character's transition already exists and is solid:

```
extendGeneralized(c):
    if next[last][c] exists:
        q = next[last][c]
        if len[q] == len[last] + 1:
            last = q            # reuse, no new state
            return
        else:
            clone q -> clone (len = len[last]+1, copy next/link, redirect),
            link[q] = clone, last = clone
            return
    # otherwise the usual extend path, then last = cur
    ...
```

Forgetting the "transition already exists" guard creates spurious states and breaks the size bound and the endpos semantics. This is the single most common generalized-SAM bug.

### 3.2 Build over a trie (robust)

Insert all strings into a trie, then run the SAM construction in **BFS order over the trie**, treating each trie node's incoming character as one `extend`, with `last` set to the SAM state of the parent trie node. This avoids the reset pitfalls and handles shared prefixes cleanly. It costs `O(total length · σ)` for the trie plus the linear SAM build.

### 3.3 Per-document occurrence sets

To answer "in how many documents does `p` appear", attach to each prefix-end state a document id, then aggregate **distinct document ids** up the suffix-link tree. For small `m`, a bitmask per state works; for large `m`, use small-to-large merging of sets or an Euler-tour + offline color-counting (the "number of distinct colors in a subtree" technique) to keep it `O(n log n)`.

---

## 4. Large-Text Indexing

### 4.1 Streaming construction

Because the SAM is built **online**, you can feed a streaming text without holding all of it in a parsed form — each `extend` is `O(1)` amortized. This suits log indexing or incremental document ingestion. You only need the growing automaton in memory, not a second copy of the text (though you often keep the text for reporting positions).

### 4.2 Reporting positions, not just counts

A bare SAM counts occurrences but does not by itself list their positions. Store `firstpos[v]` = `len[cur]-1` at creation (the end position of the first occurrence). For the original (non-clone) states this is exact; clones inherit the first occurrence of the state they split from. To list *all* positions of a pattern, collect `firstpos` over the subtree of the matched state in the suffix-link tree (each prefix-end in that subtree is an occurrence end). For many positions, that subtree enumeration is `O(occurrences)`.

### 4.3 Persistence and serialization

Serialize the parallel arrays `len`, `link`, `cnt`, and the transition table (as `(state, char, target)` triples or compressed per-state). Avoid serializing per-state hash maps directly; flatten to a CSR-style (compressed sparse row) edge list for compactness and fast reload. Validate on load with the `≤ 2n-1` / `≤ 3n-4` invariants and a checksum.

### 4.4 Cache-friendly layout

Store states in `len`-sorted order (or BFS order of the link tree) so that suffix-link-tree aggregations touch memory sequentially. Use Structure-of-Arrays (`len[]`, `link[]`, `cnt[]`) rather than Array-of-Structures so each pass streams one array.

### 4.5 Incremental queries during streaming

A subtle benefit of the online build: you can answer "number of distinct substrings of the prefix so far" *after every character* in `O(1)` amortized. Maintain a running total and, after each `extend`, add `len[cur] − len[link[cur]]`; a clone contributes a net zero change to the distinct count (it removes a portion of `q`'s range and re-adds it under the clone). This lets a streaming indexer report a live "vocabulary size" without recomputation — Task 10 in [`tasks.md`](./tasks.md). The same trick does **not** work for occurrence counts (those require the final link tree), so design the API to separate "online-friendly" aggregates from "post-build" ones.

---

## 5. The Suffix-Link Tree as a Query Engine

Most "advanced" SAM queries are tree queries on the suffix-link tree:

| Query | Tree operation |
|-------|----------------|
| Occurrences of `p` | `cnt[v]` = subtree leaf-sum (precomputed) |
| All positions of `p` | enumerate `firstpos` over subtree of `v` |
| #distinct documents containing `p` | distinct-color count in subtree of `v` |
| Longest substring occurring ≥ `t` times | deepest `v` (by `len`) with `cnt[v] ≥ t` |
| Number of distinct substrings | `Σ len[v]-len[link[v]]` |

Precompute with an **Euler tour** (entry/exit times) so each subtree becomes a contiguous range; then offline queries reduce to range problems (BIT/segment tree) or to a single DFS aggregation. This converts a zoo of substring questions into one well-understood tree-query toolkit.

### 5.1 Euler-tour layout in practice

Run a DFS over the suffix-link tree (children = states `v` with a given `link[v]`), recording `tin[v]` and `tout[v]`. A state's subtree is exactly the contiguous index range `[tin[v], tout[v]]`. Then: occurrence count is a prefix-sum of prefix-end markers over that range; "distinct documents" is a distinct-color count over that range (offline, sorted by `tout`, with a BIT); "k-th occurrence position" is an order-statistic over the prefix-end positions in the range. Building the Euler tour is `O(n)`; each offline query batch is `O((n + q) log n)`. This single layout subsumes most "advanced SAM problem" variants you will encounter.

### 5.2 Avoiding recursion on deep trees

The suffix-link tree can have depth `Θ(n)` (e.g. for `s = "aaaa…"`). A recursive DFS will stack-overflow on long inputs. Two robust alternatives: (1) the `len`-ordered iterative sweep for aggregations that only need parent-from-child accumulation (no explicit DFS), and (2) an explicit stack for the Euler tour. Always prefer iteration; the `len`-descending order is a free topological sort that replaces recursion for the common occurrence/total-length/distinct queries.

---

## 6. Numerical and Counting Concerns

### 6.1 Overflow in counts

`cnt[v]` (occurrence counts) and "number of distinct substrings" can be large. Distinct-substring count for `n = 10^6` is up to `~5·10^{11}` — fits in 64-bit, but **not** 32-bit. Use 64-bit (`int64`/`long`) for all aggregates. If a problem asks modulo a prime, reduce the running sums.

### 6.2 k-th substring rank overflow

When counting paths for the k-th distinct substring, the path counts can exceed 64-bit for large `n`. Cap counts at `k` (or at a sentinel `> k`) during accumulation so comparisons stay valid without overflow, or use modular-free saturating addition.

### 6.3 Determinism across languages

The automaton's *structure* is canonical (it is the minimal DFA), but **state numbering** depends on insertion order and clone timing. For cross-language reproducibility, compare *semantic* outputs (distinct count, occurrence counts, LCS length), not raw state ids, and iterate transitions in a fixed (e.g. character-sorted) order when output order matters.

### 6.4 Modular distinct-substring counting

Some problems ask for the number of distinct substrings *modulo a prime* (when the exact value is astronomically large for very long strings). The formula `Σ len[v]-len[link[v]]` is a sum of non-negative terms, so reduce the running total mod `p` after each addition — no subtraction, no negative-residue concern. The total-length variant `Σ T(len[v]) - T(len[link[v]])` *does* involve a subtraction; normalize with `((x % p) + p) % p` to keep residues non-negative in Go and Java, where `%` can return negatives.

### 6.5 Counting-sort the `len` order

The single most important performance detail for aggregations: states have `len ∈ [0, n]`, so order them by `len` with a **counting sort** (`O(n)`), not a comparison sort (`O(n log n)`). Bucket states by `len`, then iterate buckets from high to low. This `len`-descending order is the topological order of the suffix-link tree and is reused for occurrence counts, total-length sums, and "longest substring occurring ≥ t times" — compute it once and cache it.

---

## 7. Code Examples

### 7.1 Go — array-transition SAM with terminal marking and firstpos

```go
package main

import "fmt"

const SIGMA = 26

type SAM struct {
	next   [][SIGMA]int32
	link   []int32
	length []int32
	first  []int32 // first occurrence end position
	clone  []bool
	last   int32
}

func NewSAM(cap int) *SAM {
	s := &SAM{}
	s.next = make([][SIGMA]int32, 1, 2*cap)
	for i := range s.next[0] {
		s.next[0][i] = -1
	}
	s.link = append(s.link, -1)
	s.length = append(s.length, 0)
	s.first = append(s.first, -1)
	s.clone = append(s.clone, false)
	s.last = 0
	return s
}

func (s *SAM) newState() int32 {
	var row [SIGMA]int32
	for i := range row {
		row[i] = -1
	}
	s.next = append(s.next, row)
	s.link = append(s.link, -1)
	s.length = append(s.length, 0)
	s.first = append(s.first, -1)
	s.clone = append(s.clone, false)
	return int32(len(s.next) - 1)
}

func (s *SAM) Extend(c int32, pos int) {
	cur := s.newState()
	s.length[cur] = s.length[s.last] + 1
	s.first[cur] = int32(pos)
	p := s.last
	for p != -1 && s.next[p][c] == -1 {
		s.next[p][c] = cur
		p = s.link[p]
	}
	if p == -1 {
		s.link[cur] = 0
	} else {
		q := s.next[p][c]
		if s.length[p]+1 == s.length[q] {
			s.link[cur] = q
		} else {
			clone := s.newState()
			s.next[clone] = s.next[q]
			s.link[clone] = s.link[q]
			s.length[clone] = s.length[p] + 1
			s.first[clone] = s.first[q]
			s.clone[clone] = true
			for p != -1 && s.next[p][c] == q {
				s.next[p][c] = clone
				p = s.link[p]
			}
			s.link[q] = clone
			s.link[cur] = clone
		}
	}
	s.last = cur
}

func (s *SAM) MarkTerminals() []bool {
	term := make([]bool, len(s.next))
	for v := s.last; v != -1; v = s.link[v] {
		term[v] = true
	}
	return term
}

func main() {
	s := "abcbc"
	sam := NewSAM(len(s))
	for i := 0; i < len(s); i++ {
		sam.Extend(int32(s[i]-'a'), i)
	}
	term := sam.MarkTerminals()
	fmt.Println("states:", len(sam.next), "terminals marked:", countTrue(term))
}

func countTrue(b []bool) int {
	c := 0
	for _, x := range b {
		if x {
			c++
		}
	}
	return c
}
```

### 7.2 Java — generalized SAM via reset-last with the existence guard

```java
import java.util.*;

public class GeneralizedSAM {
    List<int[]> next = new ArrayList<>(); // size-26 rows, -1 = absent
    List<Integer> link = new ArrayList<>();
    List<Integer> length = new ArrayList<>();
    int last = 0;

    GeneralizedSAM() { newState(0, -1); }

    int newState(int len, int lk) {
        int[] row = new int[26];
        Arrays.fill(row, -1);
        next.add(row);
        length.add(len);
        link.add(lk);
        return next.size() - 1;
    }

    void extend(int c) {
        if (next.get(last)[c] != -1) {
            int q = next.get(last)[c];
            if (length.get(q) == length.get(last) + 1) {
                last = q;                       // reuse existing path
            } else {
                int clone = newState(length.get(last) + 1, link.get(q));
                next.get(clone)[c] = next.get(q)[c]; // shallow copy below
                System.arraycopy(next.get(q), 0, next.get(clone), 0, 26);
                int p = last;
                while (p != -1 && next.get(p)[c] == q) {
                    next.get(p)[c] = clone;
                    p = link.get(p);
                }
                link.set(q, clone);
                last = clone;
            }
            return;
        }
        int cur = newState(length.get(last) + 1, -1);
        int p = last;
        while (p != -1 && next.get(p)[c] == -1) {
            next.get(p)[c] = cur;
            p = link.get(p);
        }
        if (p == -1) {
            link.set(cur, 0);
        } else {
            int q = next.get(p)[c];
            if (length.get(p) + 1 == length.get(q)) {
                link.set(cur, q);
            } else {
                int clone = newState(length.get(p) + 1, link.get(q));
                System.arraycopy(next.get(q), 0, next.get(clone), 0, 26);
                while (p != -1 && next.get(p)[c] == q) {
                    next.get(p)[c] = clone;
                    p = link.get(p);
                }
                link.set(q, clone);
                link.set(cur, clone);
            }
        }
        last = cur;
    }

    void addString(String s) {
        last = 0;
        for (char ch : s.toCharArray()) extend(ch - 'a');
    }

    public static void main(String[] args) {
        GeneralizedSAM g = new GeneralizedSAM();
        g.addString("abab");
        g.addString("bcbc");
        System.out.println("total states = " + g.next.size());
    }
}
```

### 7.3 Python — distinct-document count over a generalized SAM

```python
class GenSAM:
    def __init__(self):
        self.nxt = [{}]
        self.link = [-1]
        self.length = [0]
        self.docs = [set()]   # which documents touch this state (small m)
        self.last = 0

    def extend(self, c, doc):
        if c in self.nxt[self.last]:
            q = self.nxt[self.last][c]
            if self.length[q] == self.length[self.last] + 1:
                self.last = q
                self.docs[q].add(doc)
                return
            clone = self._split(self.last, c, q)
            self.last = clone
            self.docs[clone].add(doc)
            return
        cur = len(self.nxt)
        self.nxt.append({}); self.link.append(-1)
        self.length.append(self.length[self.last] + 1)
        self.docs.append({doc})
        p = self.last
        while p != -1 and c not in self.nxt[p]:
            self.nxt[p][c] = cur
            p = self.link[p]
        if p == -1:
            self.link[cur] = 0
        else:
            q = self.nxt[p][c]
            if self.length[p] + 1 == self.length[q]:
                self.link[cur] = q
            else:
                clone = self._split(p, c, q)
                self.link[cur] = clone
        self.last = cur

    def _split(self, p, c, q):
        clone = len(self.nxt)
        self.nxt.append(dict(self.nxt[q]))
        self.link.append(self.link[q])
        self.length.append(self.length[p] + 1)
        self.docs.append(set())
        pp = p
        while pp != -1 and self.nxt[pp].get(c) == q:
            self.nxt[pp][c] = clone
            pp = self.link[pp]
        self.link[q] = clone
        return clone

    def add_string(self, s, doc):
        self.last = 0
        for ch in s:
            self.extend(ch, doc)

    def doc_counts(self):
        order = sorted(range(len(self.nxt)), key=lambda v: self.length[v], reverse=True)
        for v in order:
            if self.link[v] != -1:
                self.docs[self.link[v]] |= self.docs[v]
        return [len(d) for d in self.docs]


if __name__ == "__main__":
    g = GenSAM()
    g.add_string("abab", 0)
    g.add_string("bcbc", 1)
    counts = g.doc_counts()
    print("states:", len(g.nxt))
    # "b" appears in both docs -> its state has doc-count 2
```

---

## 8. Observability and Testing

A SAM result is opaque — one wrong link silently corrupts every downstream aggregate. Build checks in from day one.

| Check | Why |
|-------|-----|
| State count `≤ 2n-1`, edges `≤ 3n-4` | Catches spurious states (often a generalized-SAM bug). |
| `len[link[v]] < len[v]` for all `v ≠ root` | Link-tree must strictly decrease in `len`. |
| Distinct-substring sum vs brute force | The single best oracle for small `n`. |
| Occurrence count vs naive `count(s, p)` | Validates the link-tree aggregation. |
| Every prefix is recognized | Walking each prefix from root must succeed. |
| Terminal states = exactly the suffix classes | Walk links from `last`; cross-check by recognizing every suffix. |
| `A · I`-style: re-walk all substrings | Each generated substring must land on a state with `len` in range. |

The single most valuable test is the **brute-force distinct-substring oracle**: enumerate all `O(n^2)` substrings of a short random string into a set and compare its size to `Σ len[v]-len[link[v]]`. It catches almost every structural bug (bad clone, bad link, missing redirect).

### 8.1 A property-test battery

Run these on every CI build over random strings of length ≤ 30 across alphabets of size 1–4 (small alphabets force many clones):

```text
for random s:
    build SAM(s)
    assert states <= 2|s|-1 and edges <= 3|s|-4
    assert distinct_formula(SAM) == |set(all substrings of s)|
    for random substring p of s and random absent q:
        assert recognizes(SAM, p) and not recognizes(SAM, q)
        assert occ(SAM, p) == naive_count(s, p)
    assert LCS(SAM(s), t) == brute_lcs(s, t) for random t
```

Small alphabets are essential: a unary string `"aaaa"` exercises the clone path maximally and is where off-by-one length bugs surface.

### 8.2 Production guardrails

For a service, log the state/edge counts at build time (an anomalous ratio signals corruption), assert the size bounds before serving, and keep a sampled shadow check that recomputes a handful of occurrence counts with a naive scan to detect aggregation drift after code changes.

---

## 9. Failure Modes

### 9.1 Broken clone (the classic)

Forgetting to copy `q`'s transitions into the clone, or mis-setting `len[clone]`, yields an automaton that mis-recognizes substrings and corrupts every count. Mitigation: keep `extend` byte-identical to a reference; test the clone path with repetitive strings.

### 9.2 Spurious states in generalized SAM

Omitting the "transition already exists" guard on reset-`last` insertion creates duplicate states, breaking the size bound and producing wrong distinct/occurrence counts. Mitigation: use the guarded extend (Section 3.1) or the trie-based build (Section 3.2); assert `states ≤ 2·totalLen`.

### 9.3 Counting clones as occurrences

Initializing `cnt[clone] = 1` overcounts. Clones must start at `cnt = 0`; only prefix-end states contribute one. Mitigation: set `cnt` at creation based on whether the state is a clone.

### 9.4 Memory blow-up from array transitions

`O(states · σ)` arrays explode for large σ (e.g. σ = 10^5). Mitigation: remap the alphabet, or switch to map/CSR transition storage; estimate `states · σ · 4 bytes` before choosing.

### 9.5 32-bit overflow in aggregates

Distinct-substring counts and occurrence sums exceed 2^31 for moderate `n`. Mitigation: use 64-bit for `cnt`, distinct counts, and total-length sums; reduce mod `p` if the problem demands.

### 9.6 Wrong topological order in aggregation

Aggregating `cnt` up the tree in `len`-*ascending* order pushes counts the wrong way, leaving parents undercounted. Mitigation: sort/counting-sort by `len` **descending**; children must be processed before parents.

### 9.7 Confusing substring recognition with acceptance

Treating "substring of `s`" as "walk ends in a terminal state" is wrong: substring membership is just "the walk survived". Terminal states identify **suffixes**. Mitigation: keep the two notions distinct in code and comments.

### 9.8 Position reporting from clones

Reporting `firstpos` of a clone as a fresh occurrence double-reports. Mitigation: define `firstpos[clone]` as inherited from `q`, and enumerate occurrences via the subtree of prefix-end states, not raw clone positions.

### 9.9 Forgetting to reset matched length in LCS

In the longest-common-substring routine, after following a suffix link on a failed transition you must set the matched length to `len` of the *new* state, not decrement it by one. A decrement undercounts whenever the link skips more than one length level. Mitigation: write `v = link[v]; l = len[v]` and add a property test against the `O(|s||t|)` brute force.

### 9.10 Reusing a stale `len` order after edits

If you mutate the automaton (e.g. a generalized SAM that keeps inserting) after computing the `len`-descending order, the cached order is stale and aggregations are wrong. Mitigation: recompute the order after the final insertion, and make the aggregation phase clearly post-build; never interleave inserts and aggregations.

---

## 10. Summary

- The SAM engine is the same online `extend`; senior work is everything *around* it: storage, multi-string merging, large-text streaming, and verification.
- **Transition storage** is the first memory decision: arrays for small σ and speed (`O(states·σ)`), maps/CSR for large σ or tight memory (`O(edges)`). Remap the alphabet when sparse.
- **Generalized SAM** indexes many strings; the guarded reset-`last` extend or a trie-driven build avoids spurious states. Per-document aggregation uses bitmasks or distinct-color subtree counting.
- **Large-text indexing** leverages the online build for streaming; report positions via `firstpos` + suffix-link subtree, and serialize as flattened CSR arrays with invariant checks on load.
- The **suffix-link tree** is the query engine: occurrence counts, position lists, document counts, and "longest substring occurring ≥ t times" are all subtree aggregations, often via an Euler tour.
- Use **64-bit** for counts and distinct-substring totals; numbering is non-canonical, so test *semantic* outputs across languages.
- Keep a **brute-force distinct-substring oracle** and size-bound assertions; they catch the clone, link, and generalized-merge bugs that are otherwise invisible.

### Decision summary

- **One text, many substring/occurrence queries** → single SAM, precompute `cnt` over the link tree, `O(|p|)` per query.
- **Many documents** → generalized SAM (guarded extend or trie build); aggregate distinct documents up the tree.
- **Streaming/incremental text** → exploit the online build; keep only the automaton in memory.
- **Need sorted suffixes / LCP** → use a suffix array (`04`) instead.
- **Large alphabet, tight memory** → map/CSR transitions and alphabet remapping.
- **Reporting all match positions** → `firstpos` + suffix-link subtree enumeration.

References to study further: Blumer et al. (DAWG construction), the cp-algorithms suffix-automaton article (generalized SAM and applications), Ukkonen's suffix tree for the dual view, the "distinct colors in a subtree" technique for multi-document queries, and sibling topics `04-suffix-array`, `13-suffix-tree`, and `11-trie`.