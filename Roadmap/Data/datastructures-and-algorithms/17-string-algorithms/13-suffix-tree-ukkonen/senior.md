# Suffix Tree & Ukkonen's Algorithm — Senior Level

> **Focus:** Running suffix trees in production — the real memory cost (and why suffix arrays / automata are usually preferred), generalized suffix trees, scaling to large genomes, a property-test battery and failure-mode catalog, and the engineering decisions that decide whether a suffix tree is the right tool at all.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [The Memory Problem](#2-the-memory-problem)
3. [Generalized Suffix Trees](#3-generalized-suffix-trees)
4. [Large Genomes and External Memory](#4-large-genomes-and-external-memory)
5. [Alphabet and Child-Storage Engineering](#5-alphabet-and-child-storage-engineering)
6. [Online Construction and Streaming](#6-online-construction-and-streaming)
7. [Code: Production-Shaped Builds](#7-code-production-shaped-builds)
8. [Testing and Observability](#8-testing-and-observability)
9. [Failure Modes](#9-failure-modes)
10. [Choosing Tree vs Array vs Automaton](#10-choosing-tree-vs-array-vs-automaton)
11. [Concurrency and Persistence](#11-concurrency-and-persistence)
12. [Capacity Planning Worksheet](#12-capacity-planning-worksheet)
13. [Migration Playbook: Tree → Array/FM-index](#13-migration-playbook-tree--arrayfm-index)
14. [Summary](#14-summary)

---

## 1. Introduction

At middle level you learned *how* to build a suffix tree in `O(n)`. At senior level the question changes from "can I build it?" to "should I, and how do I keep it alive in production?" The suffix tree is theoretically beautiful and practically **heavy**: its `O(n)` node count hides a constant of 20–40 bytes per input character once you account for pointers, children maps, suffix links, and metadata. For a 3-billion-base human genome that is 60–120 GB — frequently a non-starter.

So the senior reality is a triage:

- For most substring/repeat/common-substring tasks, a **suffix array + LCP array** (sibling `04`) gives the same query power at `~8n` bytes and far better cache locality. It is the default production choice.
- For minimal substring automata and incremental distinct-substring counts, a **suffix automaton** (sibling `12`) is lighter and simpler than a suffix tree.
- The suffix **tree** earns its keep when you need genuine `O(m)` walking (not `O(m log n)` binary search), online extension by trailing characters, the explicit branching structure for algorithms like matching statistics, Ziv–Lempel factorization, or when an existing library/codebase already speaks suffix trees.

This file is about owning that decision and the operational details that follow from it.

### 1.1 The senior mental checklist

Before writing a line of suffix-tree code in production, answer:

1. **Does the data fit in RAM at 20–40 bytes/char?** If not, stop — use an FM-index or memory-mapped suffix array.
2. **Do I truly need `O(m)` walking, or is `O(m log n)` fine?** If the latter, a suffix array is simpler and lighter.
3. **Is the index static or growing?** Static favors the suffix array; append-heavy favors an online tree/automaton.
4. **What is the alphabet size?** Tiny (DNA) favors array children; large (Unicode) forces hash/hybrid children and inflates memory.
5. **How many distinct query types?** A single membership query is KMP territory; a rich query mix justifies a full index.

If the answers do not clearly point at a suffix tree, they point at a suffix array or FM-index — which is the correct default more often than not.

---

## 2. The Memory Problem

### 2.1 Where the bytes go

A naive pointer-based node looks like:

```
Node {
  start:    int32           // 4 bytes
  end:      *int  / int     // 8 bytes (pointer) for leaves
  children: map[byte]*Node  // 48+ bytes overhead + per-entry cost
  link:     *Node           // 8 bytes
}
```

With a hash-map children container, a single internal node can cost 80–150 bytes; even array-of-pointers children cost `8·|Σ|` bytes each. Across `~2n` nodes you reach the dreaded **20–40× blowup** over the raw text. This is the single most cited reason engineers abandon suffix trees for suffix arrays.

### 2.2 Compression tactics

- **Children as sorted small arrays** instead of hash maps for low-degree nodes (most nodes have ≤ 4 children) — cuts overhead dramatically.
- **Index-pair edges only** (never store substrings) — non-negotiable; this is the difference between `O(n)` and `O(n²)`.
- **Flat arrays of structs** with integer indices instead of pointers — kills 8-byte-pointer overhead, improves locality, and enables `int32` "pointers."
- **Implicit leaf ends** via the global-end box — never store a per-leaf end value.
- **Compressed suffix trees / CDAWG** — advanced succinct structures reach `O(n log |Σ|)` bits, but the implementation cost is high; usually only worth it for genomic scale.
- **Shared text buffer** — never copy the input into nodes; all edges index the one immutable text buffer. A surprising number of naive implementations accidentally retain per-edge substrings.
- **Pool / arena allocation** — allocate nodes from a contiguous arena and reference them by `int32` index. This removes per-node allocator headers (often 16 bytes each) and dramatically improves cache locality during traversal.

A realistic target after these tactics is **12–16 bytes per input character** for a low-degree alphabet, versus 30+ for a careless pointer-and-hash implementation. The single highest-leverage change is almost always replacing hash-map children with sorted small arrays for the (overwhelmingly common) low-degree nodes.

### 2.3 The honest comparison

| Structure | Bytes / char (typical) | Query "is P in S?" |
|-----------|------------------------|--------------------|
| Suffix tree (pointers, hash children) | 20–40 | `O(m)` |
| Suffix tree (flat int32, array children) | 12–20 | `O(m)` |
| Suffix array + LCP | ~8 | `O(m log n)` or `O(m + log n)` with LCP |
| Suffix automaton | ~10–16 | `O(m)` |
| Raw text | 1 | `O(nm)` scan |

The takeaway: a flat, int-indexed suffix tree is competitive, but the suffix array still wins on memory and code simplicity for the vast majority of tasks. Reach for the tree only when its specific strengths matter.

### 2.4 Why suffix arrays are the default

It is worth stating the case bluntly, because it is the single most important senior judgment in this topic:

- **4× less memory** (~8n vs ~30n bytes in typical implementations).
- **Cache-friendly:** a suffix array is a flat integer array scanned with binary search; a suffix tree is a pointer graph traversed with cache-missing hops.
- **Simpler, safer code:** SA-IS plus Kasai is a few hundred lines of well-understood, allocation-light code with no pointer aliasing hazards.
- **Same answers:** by the equivalence proof (`professional.md` Section 9), the array + LCP answers every query the tree does, at worst an `O(log n)` factor slower.
- **Better persistence:** arrays memory-map and serialize trivially.

The suffix tree's compensating advantages — true `O(m)` walking, online appends, explicit branching for matching statistics and LZ — are real but *narrow*. If your requirements do not name one of them explicitly, choose the array. Defaulting to the tree "because it is more powerful" is the most common senior-level mistake on this topic.

A useful framing for design reviews: write down the exact query the feature needs, then ask "which is the lightest structure that answers it within the latency budget?" Nine times out of ten the honest answer is a suffix array (or even KMP/Z for a single pattern), and the suffix tree's elegance is a trap that costs memory you did not need to spend.

In short: respect the suffix tree as the conceptual parent of suffix arrays and automata, learn Ukkonen well enough to implement and debug it, and then — in production — reach for the lighter child unless the parent's specific powers are genuinely required.

---

## 3. Generalized Suffix Trees

A **generalized suffix tree (GST)** indexes **multiple** strings `S_1, S_2, …, S_k` in one tree, enabling longest-common-substring, all-pairs common substrings, and document-retrieval queries.

### 3.1 Construction approaches

1. **Concatenate with distinct separators:** build the tree of `S_1 #_1 S_2 #_2 … S_k #_k` where each `#_j` is a unique terminator. Distinct separators prevent a substring from spanning two inputs. Simple but introduces "garbage" leaves/edges containing separators that you must filter.
2. **Run Ukkonen sequentially**, resetting the active point and reusing the same tree, tagging each leaf with its source-string id. Cleaner (no separator garbage) but trickier to implement correctly.

### 3.2 Per-node color sets

Tag every leaf with its source string's id ("color"). For each internal node, compute the **set of colors** appearing in its subtree (a `O(n)` DFS with bitsets for small `k`, or small-to-large merging for large `k`). Then:

- **Longest common substring of all `k` strings** = deepest node whose color set is full.
- **Document frequency** ("in how many strings does substring `P` appear?") = popcount of `P`-endpoint's color set.

### 3.3 Pitfalls

- A shared separator (`$` for both strings) lets substrings cross the boundary and produces wrong answers — always use **distinct** separators.
- Counting *occurrences* across documents requires distinguishing "occurs at all" (color set) from "occurs `c` times" (leaf counts) — keep both if you need both.
- Color-set computation must be linear; a careless `O(n·k)` merge negates the suffix tree's advantage.

### 3.4 Separator-free generalized construction

For many documents, the separator approach wastes nodes on separator characters and inflates the tree. The cleaner production technique is to run Ukkonen **once per document on the same tree**, resetting the active point to the root between documents and tagging each newly created leaf with the current document id. This avoids separator garbage entirely and keeps the leaf count equal to the sum of document lengths. The subtlety is that suffixes shared across documents must still terminate distinctly — achieved by giving each document its own unique terminator that is conceptually appended but not materialized as a separate alphabet symbol. When in doubt, the distinct-separator method is simpler to get correct; the separator-free method is the optimization for large `k`.

---

## 4. Large Genomes and External Memory

For genomic-scale `n` (10⁸–10⁹), in-RAM pointer suffix trees explode. Senior options:

- **Suffix arrays via `SA-IS`/`DC3`** in `O(n)` with `~4–8n` bytes, plus an LCP array via Kasai's algorithm. This is the standard genomics choice (BWA, bowtie ultimately use FM-index / BWT built on suffix arrays).
- **FM-index / BWT** — a *self-index* derived from the suffix array that supports backward-search pattern matching in space close to the **compressed** text size. The dominant production technique for read alignment.
- **Disk-based / external-memory suffix trees** (e.g., `DiGeST`, `ERA`, `Trellis`) tile construction to bound RAM, at the cost of substantial I/O complexity.
- **Compressed suffix trees (CST)** — combine an FM-index, a compressed LCP, and a balanced-parentheses topology to emulate suffix-tree navigation in `O(n log |Σ|)`-ish bits. Powerful but heavy to implement; libraries like `sdsl-lite` provide them.

The senior lesson: at genome scale, *nobody* ships a naive pointer suffix tree. They ship an FM-index or a compressed suffix array and emulate the tree operations they need.

---

## 5. Alphabet and Child-Storage Engineering

The children container is the dominant per-node cost and the dominant cache-miss source.

| Children container | Lookup | Space/node | Best for |
|--------------------|--------|------------|----------|
| Fixed array `[|Σ|]` | `O(1)` | `8·|Σ|` bytes | tiny alphabets (DNA `{A,C,G,T,$}`) |
| Hash map | `O(1)` expected | high overhead | large/unknown alphabets |
| Sorted small array + binary search | `O(log deg)` | minimal | most nodes (low degree) |
| Hybrid (array if small, map if large) | `O(1)`/`O(log)` | adaptive | general-purpose libraries |

For DNA, a 5-slot array is unbeatable. For arbitrary Unicode text, a hash map or hybrid is necessary, and you should expect the children overhead to dominate memory. **Always measure** with a heap profiler before optimizing; the bottleneck is almost always children storage, not the node structs.

### 5.1 Byte-vs-rune indexing

A subtle production hazard: the edge `[start, end]` indices must index the *same unit* you compare on. For UTF-8 text:

- **Byte indexing** is simplest and correct as long as queries are also byte strings; a multi-byte character is just a fixed byte sequence and matches naturally. This is the recommended default.
- **Rune (code-point) indexing** requires decoding and is only needed if your alphabet model is per-code-point (e.g., for linguistic analysis). Mixing the two — building on bytes but querying on runes — silently corrupts matches.

Pick one unit, document it, and enforce it at the API boundary. For DNA, ASCII, and most log processing, byte indexing is both correct and fastest.

### 5.2 Worked alphabet-cost example

Consider indexing a 100 MB log file (`n = 10^8`) over a ~100-symbol printable-ASCII alphabet:

| Children container | Bytes/node (children only) | Approx total (2n nodes) |
|--------------------|----------------------------|--------------------------|
| Array `[128]` (int32) | 512 | ~100 GB — infeasible |
| Hash map | ~80–120 | ~16–24 GB — heavy |
| Sorted small array | ~16–32 (low degree) | ~3–6 GB — viable |

The array-children layout that is perfect for DNA is **catastrophic** for a 128-symbol alphabet because it allocates a full slot vector per node. This single decision can be the difference between a feasible and an infeasible deployment — which is why senior reviews scrutinize the children container above almost everything else.

---

## 6. Online Construction and Streaming

Ukkonen is **online**: it can ingest the string left-to-right and maintain a valid (implicit) suffix tree of the prefix seen so far. This enables:

- **Appending trailing characters** cheaply — extend the existing tree without rebuilding. Each new char is amortized `O(1)`.
- **Streaming substring queries** on a growing log/text, with the caveat that queries see the *implicit* tree (the longest few suffixes may not yet be explicit). Append a temporary `$` for an explicit snapshot, or accept implicit-tree semantics.

What Ukkonen does **not** support cheaply: **prepending**, **deleting**, or **editing in the middle**. The structure is fundamentally append-only. For a sliding-window index, you typically rebuild or use a different structure; there is no efficient general "delete a character" operation on a suffix tree.

### 6.1 Sliding-window strategies

When you need a window that both grows on the right and shrinks on the left (e.g., LZ77 with a bounded window, or a streaming dedup buffer), the suffix tree alone is insufficient. Practical patterns:

- **Rebuild on slide** — recompute the tree for each window. Acceptable only for small windows or infrequent slides.
- **Suffix tree of a doubled buffer** — periodically rebuild over a window twice the target size and re-use until the window passes the midpoint, amortizing rebuild cost.
- **Switch structures** — a directed acyclic word graph (DAWG) or an FM-index over the window, or simply a rolling-hash index, often serves sliding windows better than a suffix tree.
- **Online suffix automaton** — the suffix automaton (sibling `12`) is also append-only but is lighter and is frequently the better online choice when only membership/counting is needed.

### 6.2 Snapshot semantics during streaming

A streaming consumer that queries the tree mid-build sees the **implicit** tree of the prefix consumed so far. Two consequences a senior must communicate to API users:

1. **Membership is correct** — a substring of the consumed prefix is found, even if its suffix is not yet an explicit leaf.
2. **Leaf-based counts may be incomplete** — occurrence counts that rely on counting leaves can under-report until pending suffixes are made explicit. Append a temporary sentinel for an exact snapshot, or document the "eventually consistent" count semantics.

Failing to document this is a classic source of "the count is sometimes wrong by one or two" bug reports that are actually correct implicit-tree behavior.

---

## 7. Code: Production-Shaped Builds

### 7.1 Go — flat, int-indexed suffix tree (locality-friendly)

```go
package main

import "fmt"

// Flat arena: nodes live in a slice; "pointers" are int32 indices.
// Edge label is text[start:end]; leaves use end == leafEnd (global).
type STree struct {
	text     []byte
	start    []int32 // edge start per node
	end      []int32 // edge end per node; -2 means "use leafEnd"
	first    []int32 // first child (or -1)
	link     []int32 // suffix link
	next     []int32 // sibling list
	edgeCh   []byte  // first char of the edge into this node (for sibling search)
	leafEnd  int32
	nodeCnt  int32
}

const useLeafEnd = int32(-2)

func (t *STree) endOf(v int32) int32 {
	if t.end[v] == useLeafEnd {
		return t.leafEnd
	}
	return t.end[v]
}

func (t *STree) child(v int32, c byte) int32 {
	for w := t.first[v]; w != -1; w = t.next[w] {
		if t.edgeCh[w] == c {
			return w
		}
	}
	return -1
}

// contains walks the flat tree following pattern p — O(|p|).
func (t *STree) contains(p []byte) bool {
	v, i := int32(0), 0
	for i < len(p) {
		w := t.child(v, p[i])
		if w == -1 {
			return false
		}
		j := t.start[w]
		for j <= t.endOf(w) && i < len(p) {
			if t.text[j] != p[i] {
				return false
			}
			i++
			j++
		}
		v = w
	}
	return true
}

func main() {
	// Construction omitted here for brevity (see middle.md / interview.md
	// for the full Ukkonen build); this shows the flat, cache-friendly layout.
	fmt.Println("flat suffix tree skeleton — child/edge access via int32 indices")
}
```

### 7.2 Python — generalized suffix tree color tagging (LCS of two strings)

```python
SEP1, SEP2 = "#", "$"   # distinct separators are mandatory


def longest_common_substring(a, b, build_tree, walk_nodes):
    """
    build_tree(text) -> tree with .root, nodes carrying (start,end,children).
    walk_nodes(tree) -> yields (node, string_depth, leaf_source_set).
    Returns the LCS of a and b via deepest node whose subtree has both colors.
    """
    text = a + SEP1 + b + SEP2
    boundary = len(a)  # leaves with suffix-start <= boundary belong to 'a'
    tree = build_tree(text)

    best_depth, best_node = 0, None
    for node, depth, colors in walk_nodes(tree, boundary):
        if len(colors) == 2 and depth > best_depth:
            best_depth, best_node = depth, node
    return best_depth  # length of LCS; reconstruct path-label for the string


# walk_nodes computes, for each internal node, the set of source-colors in
# its subtree by a post-order DFS (small-to-large or bitset union).
```

### 7.3 Java — heap-budget guard before building

```java
public class SuffixTreeGuard {
    // Reject builds that would blow the heap; estimate ~32 bytes/char worst case.
    static void assertBudget(int n, long maxBytes) {
        long est = (long) n * 32L;
        if (est > maxBytes) {
            throw new IllegalStateException(
                "Suffix tree for n=" + n + " needs ~" + est +
                " bytes (> budget " + maxBytes + "). Use a suffix array / FM-index.");
        }
    }

    public static void main(String[] args) {
        int n = 50_000_000;
        try {
            assertBudget(n, 1L << 30); // 1 GB budget
        } catch (IllegalStateException e) {
            System.out.println("Guard tripped: " + e.getMessage());
        }
    }
}
```

---

## 8. Testing and Observability

### 8.1 Property-test battery

Run these on random and adversarial strings (`aaaa...`, Fibonacci words, random DNA, all-distinct alphabets):

1. **Substring oracle:** for every substring `P` of `S` (sampled), `tree.contains(P)` is `true`; for random non-substrings, `false`. Cross-check against a naive `O(n²)` substring set.
2. **Leaf count:** the tree has exactly `n+1` leaves (with `$`).
3. **Node bound:** total nodes `≤ 2n+1`; flag any violation as a structural bug.
4. **Suffix coverage:** the multiset of root-to-leaf path-labels equals the set of suffixes of `S$`.
5. **Distinct-substring agreement:** sum of edge lengths equals a brute-force distinct-substring count for small `n`.
6. **LRS / LCS agreement:** deepest-internal-node answers match a brute-force check.
7. **Ukkonen == naive:** build both trees, canonicalize, and compare on thousands of random strings.

### 8.2 Production guardrails

- **Memory budget check** before building (Section 7.3); fail fast with a "use a suffix array" message.
- **Build-time metrics:** nodes created, splits performed, peak `remaining`, build duration — log them; anomalies signal pathological input.
- **Fuzzing:** feed random bytes including the would-be sentinel to confirm sentinel-uniqueness handling.
- **Build-time SLO:** alert if build throughput drops below an expected characters/second floor; a regression often signals an accidental `O(n²)` path (e.g., a missing suffix link or a per-edge string copy).
- **Memory ceiling alert:** track resident set size during the build and abort gracefully before an OOM kill, emitting the `n` and estimated bytes so on-call can route to the array/FM-index path.
- **Invariant assertions in debug builds:** every internal non-root node has ≥ 2 children; every internal node (except root) has a suffix link after the build.

### 8.3 Differential and regression testing

- **Cross-implementation diff:** if you maintain both a naive and a Ukkonen build (or two language ports), run them on a shared corpus and diff canonicalized trees. Any divergence is a bug in one of them.
- **Cross-structure diff:** validate the suffix tree's lexicographic-DFS leaf order equals an independently built suffix array, and that LCA string-depths equal the LCP array. This catches subtle ordering or depth bugs.
- **Golden-file regression:** snapshot the answers to a fixed query set on a fixed corpus; fail CI if any answer changes unexpectedly across refactors.
- **Mutation testing:** deliberately introduce off-by-ones (e.g., `end` vs `end+1`) in a test branch and confirm the property tests catch them; an undetected mutation means a coverage gap.

### 8.4 Adversarial corpus generator

A reusable generator should emit, at minimum: all-equal strings (`a^n`), two-block strings (`a^k b^k`), Fibonacci/Thue–Morse words (maximal distinct-substring growth), random DNA, random over a large alphabet, and strings containing the would-be sentinel. These exercise the active-length, skip/count, and sentinel-uniqueness paths that random ASCII rarely stresses.

---

## Applications Cookbook (production framings)

| Task | Suffix-tree recipe | Production notes |
|------|--------------------|------------------|
| Plagiarism / near-duplicate detection | generalized tree of documents; deep two-color nodes = shared passages | use distinct separators; threshold on passage length |
| Log pattern mining | longest repeated substring = most common recurring log fragment | strip timestamps first to avoid spurious repeats |
| Genome read alignment | substring/approximate match via matching statistics | at scale use FM-index, not a pointer tree |
| Autocomplete over a corpus | walk to prefix; enumerate subtree leaves for completions | cap enumeration; pre-rank by frequency (leaf counts) |
| Distinct n-gram counting | distinct-substring sum restricted by depth | the automaton (sibling `12`) is often lighter here |
| Data compression (LZ77/LZSS) | matching statistics give the longest prior match | the canonical suffix-tree application |

Each recipe maps to the same handful of primitives — walk, leaf-count, deepest-node, color-set — which is why a single well-tested suffix-tree library powers many features. The senior skill is recognizing which primitive a vague product request reduces to, and whether a lighter structure delivers it.

---

## 9. Failure Modes

### 9.1 Missing or non-unique sentinel
The tree becomes implicit, some suffixes vanish into edges, and queries silently return wrong results. **Symptom:** leaf count `< n+1`. **Fix:** append a char guaranteed outside the alphabet.

### 9.2 Leaf end stored by value
Leaves stop growing after creation, so the global-end trick fails and most suffixes are truncated. **Symptom:** short, wrong edge labels on leaves. **Fix:** store leaf end as a shared box/index sentinel.

### 9.3 Suffix link omitted or wrong
Each extension re-descends from the root → `O(n²)` build, or, worse, lands at the wrong node and corrupts the tree. **Symptom:** quadratic build time or structural assertion failures. **Fix:** set links on the newly created internal node per phase.

### 9.4 Memory blowup
A pointer/hash-map tree on a large input OOMs. **Symptom:** allocator pressure, GC thrash, OOM kill. **Fix:** flat int-indexed layout, sorted-array children, or switch to a suffix array / FM-index.

### 9.5 Shared separator in a generalized tree
Substrings cross document boundaries and LCS answers include spurious matches. **Symptom:** an "LCS" that does not actually appear in one of the inputs. **Fix:** distinct separators per string.

### 9.6 Off-by-one in interval convention
Mixing inclusive `[start,end]` with the global `leafEnd` (which is an *index*, inclusive) produces edge lengths off by one and infinite descents. **Symptom:** hangs or one-char-short labels. **Fix:** define `len = end - start + 1` and use it everywhere.

### 9.7 Cache-hostile traversal at scale
Pointer chasing across a huge tree dominates query latency. **Symptom:** queries far slower than the `O(m)` bound suggests. **Fix:** flat arena layout, or a cache-friendly suffix array with binary search.

### 9.8 Treating walks/repeats as simple structures incorrectly
Assuming an internal node means "occurs exactly twice" — it means "occurs **at least** twice." **Symptom:** wrong occurrence counts. **Fix:** count leaves in the subtree for exact occurrence counts.

### 9.9 Retaining the text buffer incorrectly
Edges index into the original text; if the text buffer is garbage-collected or mutated after the build, every edge label becomes wrong. **Symptom:** corrupted labels or crashes after the source string is freed/modified. **Fix:** keep the (immutable) text alive for the tree's lifetime; treat it as part of the structure.

### 9.10 Recursion depth on adversarial inputs
A recursive DFS over `a^n$` recurses `O(n)` deep and can overflow the stack. **Symptom:** stack overflow on long, low-branching inputs. **Fix:** use an explicit stack for traversals, or bound recursion depth; this is exactly why the `interview.md` distinct-substring solutions use an explicit stack.

### Failure-mode triage table

| Symptom | Most likely cause | First check |
|---------|-------------------|-------------|
| leaf count ≠ n+1 | missing/duplicate sentinel | print the appended terminator |
| quadratic build time | suffix links not followed | log #re-descents per phase |
| truncated leaf labels | leaf end stored by value | confirm leaves share `leafEnd` |
| OOM | hash-map children on big alphabet | heap-profile children container |
| LCS includes non-existent string | shared separator | use distinct `#`, `$` |
| off-by-one labels / hangs | interval convention mismatch | assert `len = end−start+1` |
| count wrong by 1–2 mid-stream | implicit-tree snapshot | append temporary `$` for exact counts |

---

## 10. Choosing Tree vs Array vs Automaton

| Requirement | Best structure | Reason |
|-------------|----------------|--------|
| Minimal memory, simple code, batch queries | **Suffix array + LCP** (`04`) | ~8n bytes, cache-friendly, `O(n)` build |
| `O(m)` substring walk, online growth | **Suffix tree** | constant-time-per-char walking, append support |
| Minimal substring DFA, incremental distinct count | **Suffix automaton** (`12`) | smallest automaton, online, easy distinct-substring DP |
| Genome-scale pattern matching | **FM-index / BWT** | compressed self-index, near-`text`-size memory |
| Longest common substring of k strings | **Generalized suffix tree/array** | color sets over the combined index |
| One pattern, one text | **KMP / Z** | `O(n+m)`, negligible memory |

**Rule of thumb:** start with a suffix array. Escalate to a suffix tree only for the operations a suffix array cannot do cheaply (true `O(m)` walking, online extension, explicit branching algorithms), and escalate to a compressed index (FM-index / CST) at genomic scale.

---

## 11. Concurrency and Persistence

### 11.1 Read concurrency

A fully built suffix tree is **immutable** if you stop appending, so it is naturally safe for concurrent reads: many threads can run `contains`, `countOccurrences`, or DFS aggregates against the same tree without locks. The only shared mutable state during the build is the global end and the active point, so:

- **Build single-threaded, query multi-threaded.** This is the dominant production pattern: construct once, freeze, then fan out read traffic.
- **Precompute read-side aggregates** (leaf counts, string-depths, color sets) during the freeze step so query threads never write.
- **Avoid lazy memoization on the read path** unless it is lock-free or per-thread; a shared lazy cache reintroduces write contention and data races.

### 11.2 Incremental appends under concurrency

Because Ukkonen mutates the active point and may split edges, **appending while querying is unsafe** without coordination. Options:

- **Copy-on-publish:** build a new version in the background, then atomically swap a pointer that readers dereference. Old readers finish on the old version; new readers see the new one. Memory doubles transiently.
- **Reader-writer lock:** a single writer holds the lock during `extend`; readers share it otherwise. Simple but the writer stalls reads.
- **Segmented index:** shard the corpus, rebuild only the affected shard, and merge results at query time. Avoids global rebuilds for append-heavy workloads.

### 11.3 Persistence and serialization

Suffix trees serialize poorly as pointer graphs. The robust approach:

- **Serialize the flat arena** (arrays of `start`, `end`, child indices, links) plus the original text. On load, the int "pointers" are valid immediately — no pointer fix-up.
- **Or serialize only the text and rebuild on load** — Ukkonen is `O(n)`, so for moderate `n` rebuilding is cheaper and simpler than persisting the structure, and it avoids version-skew bugs in the serialized format.
- For very large indices, persist a **suffix array / FM-index** instead; they are designed for memory-mapped, on-disk use and dominate suffix trees for durable storage.

---

## 12. Capacity Planning Worksheet

Before choosing a suffix tree, run the numbers. Let `n` be the text length in characters.

| Quantity | Formula | Example (`n = 10^7`, ASCII) |
|----------|---------|-----------------------------|
| Raw text | `n` bytes | 10 MB |
| Suffix array (int32) | `4n` bytes | 40 MB |
| Suffix array + LCP | `8n` bytes | 80 MB |
| Suffix tree (flat int32) | `12n–20n` bytes | 120–200 MB |
| Suffix tree (pointer, hash children) | `20n–40n` bytes | 200–400 MB |
| FM-index | `~0.5n–2n` bytes (compressed) | 5–20 MB |

**Decision gates:**

1. If `raw_text > available_RAM / 2`, do **not** use an in-memory pointer suffix tree; use an FM-index or memory-mapped suffix array.
2. If you need `O(m)` walking *and* `n` fits comfortably, a flat int32 suffix tree is viable.
3. If queries are batchable and `O(m log n)` is acceptable, a suffix array halves-to-quarters your memory.
4. Always add ~30% headroom for build-time scratch (the active-point machinery and transient node allocations).

**Build-time budget.** Ukkonen does roughly `c · n` operations with a small constant `c` (a handful of comparisons and a child lookup per character). On commodity hardware expect `10^7`–`10^8` characters/second depending on alphabet and children container. Hash-map children can be 3–5× slower than array children; benchmark on your real alphabet before committing.

---

## 13. Migration Playbook: Tree → Array/FM-index

When a suffix tree outgrows its budget, migrate without changing the query contract:

1. **Inventory the queries** your service exposes: substring membership, occurrence counts, longest-repeated, distinct counts, document frequency. Each has a suffix-array or FM-index equivalent.
2. **Map each query** to its array form:
   - membership → binary search on `SA` (`O(m log n)`), or backward search on the FM-index (`O(m)`).
   - occurrence count → the size of the `SA` range matching `P` (one binary-search pair).
   - longest repeated → `max(LCP)` and its position.
   - distinct count → `Σ (n − SA[i]) − Σ LCP[i]`.
   - document frequency → colored `SA` ranges or a wavelet tree over document ids.
3. **Build the suffix array** with SA-IS (`O(n)`) and the LCP with Kasai (`O(n)`); validate it against the tree's lexicographic-DFS output (they must match — see `professional.md` Section 9).
4. **Shadow-run** the new path against the old tree on production traffic, diffing answers, before cutting over.
5. **Cut over** behind a feature flag; keep the tree path available for rollback until confidence is high.
6. **Decommission** the tree and reclaim the memory.

This playbook is the senior-level resolution of the memory problem: you rarely "fix" a suffix tree's memory — you migrate to the structure that should have been chosen, while preserving behavior.

---

## 14. Summary

In production, a suffix tree is a powerful but expensive index: its `O(n)` node count carries a 20–40× memory constant that makes the **suffix array + LCP** (sibling `04`) the default choice for most substring tasks and the **suffix automaton** (sibling `12`) the choice for minimal automata and distinct-substring counting. The suffix tree earns its place when you need genuine `O(m)` walking, online extension by trailing characters, or the explicit branching structure. Production-shaping means using flat int-indexed arenas instead of pointers, sorted-array or hybrid children instead of hash maps, and shared global-end leaves. Generalized suffix trees with distinct separators and per-node color sets solve longest-common-substring and document-frequency queries. At genome scale, ship an FM-index / compressed suffix tree rather than a pointer tree. Guard every build with a memory budget, test against a naive `O(n²)` oracle and the structural invariants (`n+1` leaves, `≤ 2n+1` nodes, every internal node ≥ 2 children with a suffix link), and watch for the canonical failure modes — missing sentinel, by-value leaf ends, omitted suffix links, and shared separators. Choose the lightest structure that meets the query contract; the suffix tree is rarely it, but when it is, it is unbeatable.
