# Word Search on a Grid (DFS Backtracking + Trie) — Senior Level

> Word Search is trivial on a 4×4 board with four words. The moment the dictionary holds tens of thousands of entries, the grid is large, the service answers many boards per second, or the board is shared across worker threads, every detail — Trie memory layout, leaf pruning, sentinel choice, board mutation vs thread safety, parallelization granularity, and the brute-force oracle you test against — becomes a correctness or performance incident.

## Table of Contents
1. [Introduction](#1-introduction)
2. [Large-Dictionary Trie Engineering](#2-large-dictionary-trie-engineering)
3. [Trie Memory: Arrays, Maps, and DAWGs](#3-trie-memory-arrays-maps-and-dawgs)
4. [Pruning Engineering](#4-pruning-engineering)
5. [Marking Strategy and Thread Safety](#5-marking-strategy-and-thread-safety)
6. [Parallelization](#6-parallelization)
7. [Code Examples](#7-code-examples)
8. [Observability and Testing](#8-observability-and-testing)
9. [Failure Modes](#9-failure-modes)
10. [Summary](#10-summary)

---

## 1. Introduction

At the senior level the question is no longer "how does the mark/unmark DFS work" but "what system am I building, and what breaks when I scale it?". Grid word search shows up in several production-flavored guises that share one engine:

1. **Dictionary matching at scale** — find all of `W` (10³–10⁵) dictionary words on a board. The Trie sweep is the only sane approach; the engineering is in Trie memory, pruning, and de-duplication.
2. **High-throughput board scoring** — a Boggle/word-game service scores thousands of boards per second against a fixed dictionary. The Trie is built once and shared read-only; per-request work must be allocation-light and thread-safe.
3. **Large or streaming grids** — the board is big enough that a separate `visited` array, board copying, or recursion depth becomes a real cost.

All three reduce to: *build a Trie of the dictionary once, DFS the grid carrying a Trie node, prune aggressively, and collect end-node words.* The senior decisions are: how to keep the Trie small and cache-friendly, how to prune so the search shrinks as it runs, how to mark without breaking thread safety, how to parallelize, and how to verify results when the dictionary is too large to eyeball.

This document treats those decisions in production terms.

The recurring tension throughout is between **per-solve optimizations** that mutate shared state (leaf pruning, in-place marking, marker clearing) and the **shareability** that high throughput demands (an immutable Trie, a read-only board). The senior craft is knowing which optimizations to keep when the artifact is shared — and the answer is almost always: keep the non-mutating prunes, move per-solve state into per-request structures, and treat the Trie as a compiled, immutable asset.

---

## 2. Large-Dictionary Trie Engineering

### 2.1 Build once, share read-only

The Trie is a function of the dictionary, not the board. Build it **once** at startup and share it **read-only** across every board and every worker. Rebuilding the Trie per request is the classic latency and GC regression — symptoms are throughput that scales inversely with dictionary size and heavy allocation churn. Treat the Trie like a compiled artifact.

### 2.2 The mutation problem with leaf pruning

Word Search II's leaf-pruning optimization (detach dead leaves; clear end-markers) **mutates the Trie**. That is fine for a one-shot single-threaded solve, but it destroys the "build once, share read-only" property: after the first board, the Trie has lost the words it found. Two reconciliations:

- **Immutable Trie + per-solve found-set.** Do not mutate the Trie; instead track found words in a per-solve `set` and skip duplicates there. The Trie stays shareable; you lose the shrinking-Trie speedup but gain thread safety.
- **Per-solve mutable copy or scoped markers.** Keep markers in a per-solve side table keyed by node identity, not on the node itself. You get pruning *and* shareability at the cost of a hash lookup per end-node.

The trade is **pruning power vs shareability**. For a single offline solve, mutate freely. For a shared-service Trie, keep it immutable and move per-solve state outside it.

### 2.3 Pre-filtering by board letter set

Before building or sweeping, compute the **multiset of letters on the board**. Any dictionary word using a letter not on the board, or using a letter more times than it appears, **cannot** be formed — prune it before it ever enters the search. For a fixed dictionary and varying boards, you can pre-bucket words by their letter signature and skip whole buckets. This is an `O(board + word)` filter that eliminates the majority of a large dictionary on a typical board.

The savings are substantial because a typical board uses only a fraction of the alphabet (a `4×4` board has 16 cells, so at most 16 distinct letters, often fewer), while a dictionary spans all 26. Any word containing one of the ~10 absent letters is dropped instantly. On a random small board, this commonly filters 70–90% of a large dictionary before the sweep begins, and the filter cost (`O(board + word)` per word) is dwarfed by the sweep cost it avoids. The one caveat: the filter is per board, so for a service it runs on every request — but it is cheap enough that the net effect is a large latency reduction, not an addition.

---

## 3. Trie Memory: Arrays, Maps, and DAWGs

### 3.1 Array-of-26 vs hash map children

| Child representation | Lookup | Memory per node | Best for |
|----------------------|--------|-----------------|----------|
| `array[26]` of pointers | `O(1)`, no hashing | 26 pointers always (sparse waste) | fixed lowercase alphabet, speed-critical |
| hash map `char → node` | `O(1)` amortized, hashing cost | proportional to actual children | large/Unicode alphabets, sparse nodes |
| sorted array + binary search | `O(log children)` | compact | memory-tight, moderate alphabet |

For the LeetCode lowercase case, `array[26]` is fastest and cache-friendliest; the wasted null slots are a small price. For Unicode or huge alphabets, a map keeps nodes compact.

### 3.2 DAWG / DAFSA: minimizing the Trie

A **DAWG** (Directed Acyclic Word Graph), a.k.a. **DAFSA**, is a minimized Trie: identical suffixes are **shared**, collapsing the structure from a tree into a DAG. For a natural-language dictionary this can cut node count by an order of magnitude (English shares vast numbers of suffixes like `-ing`, `-tion`, `-ed`). The grid DFS is unchanged — you still descend child edges — but the structure is far smaller, improving cache behavior and memory.

The catch: a DAWG **shares nodes across words**, so you **cannot** store a per-node `word` string or mutate end-markers without affecting other words. With a DAWG you reconstruct the matched word from the DFS path (you have it in hand — it is the sequence of grid letters), and you track found words in an external set. DAWG buys memory; it costs you the "store word at node / prune leaves" conveniences.

### 3.3 Compressed Trie (radix tree)

A **radix tree** (Patricia trie) compresses chains of single-child nodes into one edge labeled with a substring. It reduces node count for dictionaries with long unique suffixes. The grid DFS must then match an edge **substring** against a sequence of grid cells, which complicates the mark/unmark (you mark several cells per edge). Worth it only when memory is the binding constraint and the dictionary has long shared stems.

### 3.4 Memory budget

Each `array[26]` node is ~`26 × 8 = 208` bytes (pointers) plus overhead. A 100,000-word dictionary with ~1M Trie nodes is ~200 MB with array nodes — often the dominant memory cost. A map-based or DAWG representation can bring this down 5–10×. Measure node count (`distinct prefixes`) before choosing.

### 3.5 Choosing the representation: a decision matrix

| Constraint | Representation | Why |
|------------|----------------|-----|
| Lowercase, latency-critical, memory ample | `array[26]` Trie | fastest child lookup, cache-friendly |
| Large/Unicode alphabet | hash-map Trie | nodes sized to actual children, no 26-slot waste |
| Memory-bound, natural-language dict | DAWG/DAFSA | suffix sharing, 5–10× fewer nodes |
| Long shared stems, few branches | radix/Patricia | compress single-child chains |
| Concurrent solves, shared dict | immutable `array[26]` + per-solve set | shareable, no mutation |

The representation choice is mostly independent of the sweep algorithm — the DFS descends "a child for this letter" regardless of how children are stored. The exception is the **radix tree**, where one edge spans several letters, so the DFS must consume multiple grid cells per edge and the mark/unmark logic marks all of them. That coupling is why radix trees are reserved for the memory-bound case; for everything else, pick by alphabet size and concurrency, not by the sweep.

### 3.6 Empirical node-count rule of thumb

For an English word list, the Trie node count is typically `~0.4–0.6 × K` (substantial prefix sharing at the front), and the DAWG node count is typically `~0.1–0.2 × K` (further suffix sharing). So a 100k-word, ~900k-character list yields roughly 400k Trie nodes (~85 MB array-backed) versus ~120k DAWG nodes (~25 MB). Measuring both at build time and logging the ratio is the cheapest way to decide whether the DAWG's loss of per-node word storage (you must reconstruct words from the path) is worth the memory win for your dictionary.

---

## 4. Pruning Engineering

Pruning is where Word Search II earns its keep. The `4^L` bound is never realized because each technique cuts the tree:

### 4.1 Prefix-existence pruning (mandatory)

Descend to a neighbor only if the current Trie node has a child for that cell's letter. This restricts the DFS to grid paths spelling **live dictionary prefixes** — the search tree is shaped by the dictionary, not the alphabet. This is the foundational prune; without it you are doing brute-force grid enumeration.

### 4.2 Leaf pruning (dead-end removal)

After recording a word, clear its end-marker; if a node then has no children and no word, **detach it** from its parent. As words are found, the Trie shrinks, so later branches dead-end sooner. (Subject to the mutability trade-off of §2.2.)

### 4.3 Board-letter pruning

Skip dictionary words (or whole DFS branches) that need a letter not present on the board, or needed more often than available (§2.3). Cheap and high-yield.

### 4.4 Length and reachability bounds

- A word longer than `M·N` (the cell count) cannot fit — drop it.
- A word longer than the largest connected region of usable cells cannot fit — a stronger but costlier bound.
- If the board lacks `word[0]` entirely, the word is impossible.

### 4.5 Start-cell restriction

Begin DFS only from cells whose letter is a **child of the Trie root**. Cells that start no dictionary word never launch a search. Combined with prefix pruning, this means the very first step is already filtered.

### 4.6 The ordering principle

Apply the cheapest, highest-yield prunes first: board-letter filter (`O(board)`) and start-cell restriction before any recursion; prefix pruning at every step; leaf pruning lazily as words are found. Expensive prunes (connected-region sizing) are worth it only on large boards with large dictionaries.

### 4.7 Pruning impact, ranked

| Prune | Cost to apply | Typical yield | When it pays |
|-------|---------------|---------------|--------------|
| Prefix-existence | `O(1)` per step | enormous (shapes whole search) | always — mandatory |
| Start-cell restriction | `O(M·N)` once | high (skips dead starts) | always |
| Board-letter filter | `O(board + word)` per word | high on large dicts/small boards | large dictionary |
| Leaf pruning | `O(1)` amortized per word found | moderate, grows as words found | single-threaded solve |
| Length bound (`> M·N`) | `O(1)` per word | low (few such words) | always (cheap) |
| Connected-region sizing | `O(M·N)` flood-fill | low–moderate | large sparse boards |

The first two prunes are doing almost all the work; they convert the brute-force `O(M·N·4^{L_max})` enumeration into a search shaped by the intersection of grid paths and the dictionary. Board-letter filtering is the next lever specifically when `W` is large. The rest are incremental. A common engineering mistake is to invest in the exotic prunes (region sizing) before confirming the mandatory ones are present — always verify prefix-existence and start-cell restriction first; they are the difference between feasible and infeasible.

### 4.8 Pruning and the mutability trade-off

Leaf pruning is the one prune that **mutates the Trie**, so it is incompatible with the immutable-shared-Trie model (§2.2). In a concurrent service you give up leaf pruning and rely on the non-mutating prunes (prefix-existence, start-cell, board-letter), tracking found words in a per-solve set. The measured cost of dropping leaf pruning is usually small — prefix-existence already dominates — so the trade (lose a minor prune, gain shareability and thread safety) is almost always correct at scale. Reserve leaf pruning for the offline single-solve case where the Trie is disposable.

---

## 5. Marking Strategy and Thread Safety

### 5.1 In-place sentinel vs visited array — production view

| Strategy | Extra space | Thread-safe shared board? | Notes |
|----------|-------------|---------------------------|-------|
| In-place `'#'` sentinel | `O(1)` | **No** | mutates the shared board |
| Per-worker `visited` array | `O(M·N)` per worker | Yes (board read-only) | clean for parallelism |
| Per-worker board copy | `O(M·N)` per worker | Yes | simplest correctness, more memory |
| Bitset `visited` | `O(M·N/64)` per worker | Yes | compact; good when `M·N ≤ 64` fits one word |

The in-place trick is elegant single-threaded but **breaks the moment two threads share a board** — one thread's `'#'` corrupts another's view. For any concurrent solve, give each worker its own `visited` (or its own board copy) and keep the board itself read-only.

### 5.2 Sentinel selection

The sentinel must be outside the dictionary alphabet. For `a–z`, `'#'` is safe. For arbitrary input, pick a value that cannot appear (e.g. a byte ≥ 0x80, or a dedicated visited array). A sentinel collision is a silent correctness bug: a cell marked with a value that *is* a valid letter can be matched as that letter.

### 5.3 Restoration discipline

Every return path must restore the cell. In languages without `defer`/`finally` you must restore before each `return`, including early successes. A single missed restore corrupts every subsequent start. In Go, a `defer` to restore is tempting but adds overhead in the hot path; explicit restore is usually preferred. Encode the restore as the last statement of the recursive body so it is visually unmissable.

---

## 6. Parallelization

### 6.1 Parallel over start cells

The DFS from each start cell is independent — there is no shared mutable state if each worker owns its `visited` array (and the Trie is immutable). Distribute the `M·N` start cells across workers; each accumulates a local found-set; merge at the end. This is embarrassingly parallel.

### 6.2 Parallel over boards

A board-scoring service parallelizes naturally across **requests**: each board is an independent solve against the shared read-only Trie. This is the more common production axis — many small boards rather than one huge board.

### 6.3 What does NOT parallelize cleanly

- **Leaf pruning** mutates the Trie, so it cannot run concurrently on a shared Trie. Use the immutable-Trie + per-solve found-set model (§2.2) for parallel solves.
- **A single DFS path** is inherently sequential (each step depends on the last). Parallelism lives **across start cells / boards**, not within one path.

### 6.4 Granularity

For one board, parallelizing across `M·N` starts has low overhead only if each start does meaningful work; on tiny boards the thread overhead dominates and single-threaded wins. The real throughput win is parallel-across-boards in a service. Size the worker pool to cores, batch small boards, and keep the Trie pinned in shared memory.

### 6.5 Parallelization axes summary

| Axis | Independent? | Shared state | Best for |
|------|--------------|--------------|----------|
| Across boards (requests) | Yes | immutable Trie (read-only) | board-scoring service |
| Across start cells (one board) | Yes (per-worker visited) | immutable Trie | large single board |
| Within one DFS path | No (sequential) | — | never |
| Across CRT-style shards | N/A here | — | not applicable to this problem |

The dominant production pattern is **across boards**: each request is a self-contained solve against the shared Trie, so the system scales linearly with cores until the Trie's shared-memory bandwidth or the result-merge becomes the bottleneck (rarely). Within-board start-cell parallelism is a secondary lever for the unusual case of one very large board.

### 6.6 The merge step

Each worker produces a local found-set; the final result is their union. For "find all words," the union is `O(total found)`; for "count," sum the per-worker counts **only if** workers de-duplicate against a shared concurrent set (otherwise a word found on two boards' overlap — impossible here since boards are independent — or via two start cells on the same board would be double-counted). On a single board parallelized across start cells, use a concurrent set or merge sorted local lists to de-duplicate, since the same word can be reached from start cells handled by different workers. This is the concurrency analogue of the single-threaded de-dup (clear-the-marker), reframed as set-union because the shared Trie must not be mutated.

---

## 7. Code Examples

### 7.1 Go — thread-safe Word Search II (immutable Trie, per-solve visited)

```go
package main

import (
	"fmt"
	"sort"
	"sync"
)

type TrieNode struct {
	children [26]*TrieNode
	word     string
}

func buildTrie(words []string) *TrieNode {
	root := &TrieNode{}
	for _, w := range words {
		node := root
		for i := 0; i < len(w); i++ {
			idx := w[i] - 'a'
			if node.children[idx] == nil {
				node.children[idx] = &TrieNode{}
			}
			node = node.children[idx]
		}
		node.word = w
	}
	return root
}

// solve uses a per-call visited grid so the shared Trie/board are never mutated.
func solve(board [][]byte, root *TrieNode) []string {
	rows, cols := len(board), len(board[0])
	visited := make([][]bool, rows)
	for i := range visited {
		visited[i] = make([]bool, cols)
	}
	foundSet := map[string]struct{}{}

	var dfs func(r, c int, node *TrieNode)
	dfs = func(r, c int, node *TrieNode) {
		if r < 0 || r >= rows || c < 0 || c >= cols || visited[r][c] {
			return
		}
		next := node.children[board[r][c]-'a']
		if next == nil {
			return // prefix prune
		}
		if next.word != "" {
			foundSet[next.word] = struct{}{} // de-dup via set; Trie untouched
		}
		visited[r][c] = true
		dfs(r-1, c, next)
		dfs(r+1, c, next)
		dfs(r, c-1, next)
		dfs(r, c+1, next)
		visited[r][c] = false
	}

	for r := 0; r < rows; r++ {
		for c := 0; c < cols; c++ {
			dfs(r, c, root)
		}
	}
	out := make([]string, 0, len(foundSet))
	for w := range foundSet {
		out = append(out, w)
	}
	sort.Strings(out)
	return out
}

// solveMany scores many boards in parallel against one shared immutable Trie.
func solveMany(boards [][][]byte, root *TrieNode) [][]string {
	results := make([][]string, len(boards))
	var wg sync.WaitGroup
	for i := range boards {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			results[i] = solve(boards[i], root)
		}(i)
	}
	wg.Wait()
	return results
}

func main() {
	root := buildTrie([]string{"oath", "pea", "eat", "rain"})
	board := [][]byte{
		[]byte("oaan"), []byte("etae"), []byte("ihkr"), []byte("iflv"),
	}
	fmt.Println(solve(board, root)) // [eat oath]
}
```

### 7.2 Java — board-letter pre-filter before the sweep

```java
import java.util.*;

public class PrefilterSearch {
    static List<String> findWords(char[][] board, String[] words) {
        int[] avail = new int[26];
        for (char[] row : board) for (char ch : row) avail[ch - 'a']++;

        List<String> candidates = new ArrayList<>();
        for (String w : words) {
            int[] need = new int[26];
            boolean ok = w.length() <= board.length * board[0].length;
            for (int i = 0; ok && i < w.length(); i++) {
                int c = w.charAt(i) - 'a';
                if (++need[c] > avail[c]) ok = false;   // needs a letter the board lacks
            }
            if (ok) candidates.add(w);                  // only winnable words survive
        }
        // ... build a Trie from `candidates` and run the standard sweep ...
        return candidates; // (placeholder: feed these into the Trie sweep)
    }

    public static void main(String[] args) {
        char[][] board = {{'a', 'b'}, {'c', 'd'}};
        System.out.println(findWords(board, new String[]{"abdc", "zzz", "ab"}));
        // "zzz" pruned (no z on board); long impossible words pruned
    }
}
```

### 7.3 Python — DAWG-style: reconstruct word from path, external found-set

```python
class Node:
    __slots__ = ("children", "is_end")

    def __init__(self):
        self.children = {}
        self.is_end = False  # shared-suffix safe: no per-node word string


def build_dawg_like(words):
    # A plain Trie here; a true DAWG would merge equivalent suffix subtrees.
    root = Node()
    for w in words:
        node = root
        for ch in w:
            node = node.children.setdefault(ch, Node())
        node.is_end = True
    return root


def find_words(board, words):
    root = build_dawg_like(words)
    rows, cols = len(board), len(board[0])
    found = set()
    path = []  # reconstruct the word from the path (DAWG-safe)

    def dfs(r, c, node):
        if not (0 <= r < rows and 0 <= c < cols):
            return
        ch = board[r][c]
        if ch == "#":
            return
        nxt = node.children.get(ch)
        if nxt is None:
            return                       # prefix prune
        path.append(ch)
        if nxt.is_end:
            found.add("".join(path))     # external set, Trie untouched
        board[r][c] = "#"                # in-place mark (single-threaded here)
        dfs(r - 1, c, nxt)
        dfs(r + 1, c, nxt)
        dfs(r, c - 1, nxt)
        dfs(r, c + 1, nxt)
        board[r][c] = ch                 # unmark
        path.pop()

    for r in range(rows):
        for c in range(cols):
            dfs(r, c, root)
    return sorted(found)


if __name__ == "__main__":
    board = [list("oaan"), list("etae"), list("ihkr"), list("iflv")]
    print(find_words(board, ["oath", "pea", "eat", "rain"]))  # ['eat', 'oath']
```

---

## 8. Observability and Testing

A word-search result is a set of strings — one missing or spurious word looks like any other. Build checks in from day one.

| Check | Why |
|-------|-----|
| Brute-force per-word oracle on small boards | The single most valuable test: run Word Search I for each dictionary word and compare the set to the Trie sweep. |
| No-duplicate invariant | Each found word appears once; catches missing end-marker clears. |
| Board-unchanged-after-solve | Assert the board equals its pre-solve copy; catches missed unmarks. |
| Subset-of-dictionary | Every found word is in the dictionary; catches path-reconstruction bugs. |
| Letter-availability sanity | Found words use only letters present on the board with sufficient multiplicity. |
| Determinism across languages | Same board + dictionary → identical sorted output in Go/Java/Python. |
| Trie node-count metric | Logged at build; a sudden jump signals a malformed dictionary. |

The brute-force oracle is decisive: for `M·N ≤ 16`, `L ≤ 6`, run the naive per-word Word Search I and diff the result sets. It catches the de-dup bug, the missed-unmark bug, and the prefix-prune bug at once.

### 8.1 A property-test battery

```text
for random small board, random small dictionary:
    assert trie_sweep(board, dict) == { w in dict : word_search_i(board, w) }   # the oracle
    assert board unchanged after solve                                          # restore invariant
    assert no duplicates in result
    assert every result word is in dict
    assert every result word's letters are a sub-multiset of the board's letters
```

These five invariants, on a few hundred random instances, give high confidence. The oracle equality is the strongest single check.

### 8.2 Production guardrails

For a board-scoring service: log the **Trie node count** and **dictionary size** at build; emit per-request **found-count** and **latency**; add an input validator (board rectangular, letters in the expected alphabet, dictionary non-empty); and assert the Trie is never mutated when shared (e.g., a checksum of the structure at startup vs after a batch of solves).

### 8.3 Why the brute-force oracle is non-negotiable

The result of a word search is an opaque set of strings — a single missing or extra word is invisible to inspection, and the optimized Trie sweep has several subtle failure points (missed unmark, sentinel collision, missing de-dup, wrong prefix lookup) that all produce *plausible* wrong output. The brute-force oracle — running the dead-simple per-word Word Search I and comparing sets — is the only check that catches *all* of these at once, because it computes the same predicate by an independent, obviously-correct route. Run it on every CI build over a few hundred random small instances. The cost is negligible (small boards, small dictionaries) and the confidence is high: any divergence localizes a real bug in the optimized path. This mirrors the layered-DP oracle prescribed for walk counting in sibling `11-graphs/32-paths-fixed-length` — in both topics, the optimized algorithm is trusted only after it agrees with a slow, transparent reference on exhaustive small cases.

---

## 9. Failure Modes

### 9.1 Missed unmark / restore

A code path that returns without restoring the cell corrupts every later start. Mitigation: restore as the final statement of the recursive body; assert board-unchanged in tests.

### 9.2 Sentinel collision

A sentinel that is a valid dictionary letter is matched as that letter — silent wrong results. Mitigation: use a non-alphabet sentinel or a `visited` array.

### 9.3 Duplicate reports

Forgetting to clear the end-marker (or using a Trie sweep without a found-set) reports the same word multiple times when it can be traced via multiple paths. Mitigation: clear markers or use a set.

### 9.4 Mutating a shared Trie

Leaf pruning / marker clearing on a Trie shared across boards or threads makes the second solve miss words the first one "consumed". Mitigation: immutable Trie + per-solve found-set (§2.2), or per-solve Trie copy.

### 9.5 Sharing a mutable board across threads

In-place marking with a shared board is a data race. Mitigation: per-worker `visited` array or board copy; keep the board read-only.

### 9.6 Trie memory blowup

A large dictionary with array[26] nodes can exhaust memory. Mitigation: map-based nodes, a DAWG, or a radix tree; measure node count first.

### 9.7 Rebuilding the Trie per request

A service that constructs the Trie inside each request pays `O(K)` and heavy GC per call. Mitigation: build once at startup, share read-only.

### 9.8 Stack overflow on long words / large grids

Deep recursion (depth up to `L`, or `M·N` for pathological grids) can overflow the stack. Mitigation: bound `L`, or convert to an explicit stack for very deep cases.

### 9.9 Treating walks as simple paths confusion

This problem already requires **distinct cells** (a simple path on the grid), enforced by marking — but a subtle bug is allowing diagonal moves or relaxing the no-reuse rule, which silently changes the answer. Mitigation: pin the direction set and the no-reuse invariant explicitly and test them.

---

## 10. Summary

- **Build the Trie once, share it read-only.** Rebuilding per request is a latency/GC regression. The Trie is a compiled artifact of the dictionary.
- **Leaf pruning mutates the Trie**, conflicting with sharing. Reconcile via an **immutable Trie + per-solve found-set** for concurrent/repeated solves, or mutate freely only for a one-shot offline solve.
- **Trie memory is the dominant cost** at scale. `array[26]` is fastest for lowercase; maps are compact for large alphabets; a **DAWG/DAFSA** shares suffixes for an order-of-magnitude reduction (at the cost of per-node word storage); radix trees compress unique stems.
- **Prune in cost order:** board-letter filter and start-cell restriction before recursion; prefix-existence pruning at every step; leaf pruning lazily. The `4^L` bound is never realized because pruning shapes the search by the dictionary.
- **Marking:** in-place sentinel is O(1) but not thread-safe; for parallelism use a per-worker `visited` array or board copy and keep the board read-only. The sentinel must be outside the alphabet, and restoration must happen on every return path.
- **Parallelize across start cells and across boards**, never within a single DFS path. A board-scoring service scales by request.
- **Always keep a brute-force per-word oracle** plus board-unchanged, no-duplicate, subset-of-dictionary, and letter-availability invariants; they catch nearly every real bug.

### Production checklist

Before shipping a board-search service, confirm:

1. **Trie built once at startup**, pinned read-only, never rebuilt per request.
2. **No Trie mutation** on the shared instance (no leaf pruning / marker clearing); per-solve state in a per-request set.
3. **Per-request `visited` array** (or board copy); the board is read-only if shared.
4. **Sentinel disjoint from the alphabet** if in-place marking is used anywhere.
5. **Board-letter pre-filter** applied per board to drop impossible words.
6. **Start-cell restriction + prefix-existence pruning** present (the mandatory prunes).
7. **De-dup** via set-union (the concurrency-safe form), counted/reported once per word.
8. **Brute-force oracle** wired into CI on small boards; board-unchanged and no-duplicate assertions on every solve in tests.
9. **Metrics**: Trie node count and dictionary size logged at build; per-request found-count and latency emitted.
10. **Race-clean**: validated with the race detector / thread sanitizer under concurrent load.

Items 1–3 are the most common scaling regressions (rebuilt Trie, mutated shared Trie, shared mutable board); items 5–6 are the most common performance omissions; items 8–10 are the correctness and operability backstops.

### Decision summary

- **One word** → Word Search I, in-place marking, `O(M·N·4^L)`.
- **A dictionary, single solve** → Word Search II, mutable Trie with leaf pruning.
- **A dictionary, repeated/concurrent solves** → immutable shared Trie + per-solve found-set + per-worker visited.
- **Memory-bound large dictionary** → DAWG or map-based / radix Trie.
- **High-throughput service** → build Trie once, parallel across boards, board-letter pre-filter per board.
- **Boggle** → 8-direction adjacency, length filter, scoring pass; same Trie sweep.

### One-line takeaways
- The Trie is a compiled artifact: build once, share read-only, never rebuild per request.
- Leaf pruning trades shareability for speed; at scale, drop it and keep the non-mutating prunes.
- Memory is the scaling wall: array[26] for speed, DAWG for size, measure node count first.
- Prefix-existence and start-cell restriction do almost all the pruning work; verify them before exotic prunes.
- In-place marking is a space optimization, not thread-safe; use per-worker `visited` for concurrency.
- Parallelize across boards/requests, never within a DFS path.
- The brute-force per-word oracle is the one test that catches every subtle bug at once.

References to study further: DAWG/DAFSA construction (incremental minimization, Daciuk et al.), Patricia/radix tries, the Aho-Corasick automaton as an alternative multi-pattern matcher (see `professional.md`), Boggle solver engineering, and sibling topics in `16-backtracking` and the Trie material in `tree-traversals`.
