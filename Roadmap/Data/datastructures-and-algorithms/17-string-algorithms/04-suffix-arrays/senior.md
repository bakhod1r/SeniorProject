# Suffix Arrays (and the LCP Array) — Senior Level

> A suffix array is rarely the bottleneck on a small string — but the moment you index a multi-gigabyte genome, serve substring queries at scale, or need the array to back an FM-index, every detail (linear-time construction, memory layout, sentinel handling, RMQ on LCP, integer width, testing against an oracle) becomes a correctness or performance incident.

## Table of Contents
1. [Introduction](#1-introduction)
2. [Linear-Time Construction: SA-IS and DC3](#2-linear-time-construction-sa-is-and-dc3)
3. [Memory Layout and Integer Width](#3-memory-layout-and-integer-width)
4. [Large-Text Indexing in Practice](#4-large-text-indexing-in-practice)
5. [Suffix Array vs FM-index / BWT](#5-suffix-array-vs-fm-index--bwt)
6. [LCP, RMQ, and Range Queries](#6-lcp-rmq-and-range-queries)
7. [Code Examples](#7-code-examples)
8. [Observability and Testing](#8-observability-and-testing)
9. [Failure Modes](#9-failure-modes)
10. [Summary](#10-summary)

---

## 1. Introduction

At the senior level the question is no longer "what does the suffix array mean" but "what system am I indexing, and what breaks when I scale it?". Suffix arrays show up in three production guises that share one engine:

1. **Full-text search indexes** — a fixed corpus (logs, source code, documents) where substring/occurrence queries must be fast and the index must fit in memory or on disk.
2. **Bioinformatics** — reference genomes of `10⁸`–`10⁹` bases, where the suffix array (often as the spine of an FM-index) enables read alignment.
3. **Data compression** — the Burrows-Wheeler Transform (`10-burrows-wheeler-transform`) is computed directly from the suffix array; bzip2-style compressors and FM-indexes both depend on it.

All three reduce to: *build `SA` (and usually `LCP`) over a large text in linear or near-linear time and memory, then answer queries by binary search or by an FM-index built on top.* The senior decisions are: which construction algorithm, how to lay out memory, how to handle the sentinel and the alphabet, how to add the auxiliary structures (RMQ on LCP) that lift a plain SA to suffix-tree query power, and how to verify correctness when the input is far too large to brute-force.

---

## 2. Linear-Time Construction: SA-IS and DC3

Prefix doubling is `O(n log n)`; for the largest inputs you want true `O(n)`. Two linear algorithms dominate.

### 2.1 SA-IS (Suffix Array by Induced Sorting)

SA-IS (Nong, Zhang, Chan 2009) is the de facto production algorithm — linear time, small constant, and the basis of most library implementations (e.g. `libdivsufsort`-class and `sais`). The high-level idea:

1. **Classify each suffix as S-type or L-type.** Suffix `i` is **S-type** if `s[i..]` is lexicographically smaller than `s[i+1..]`, else **L-type**. The last (sentinel) suffix is S-type. Classification is one right-to-left pass, `O(n)`.
2. **Identify LMS positions** (Left-Most S-type): an S-type position immediately preceded by an L-type position. The substrings between consecutive LMS positions ("LMS substrings") are the recursion's reduced alphabet.
3. **Induced sort.** Place LMS suffixes into bucket boundaries, then *induce* the order of all L-type suffixes (left-to-right scan) and all S-type suffixes (right-to-left scan) from the already-placed ones. This two-scan induction is the algorithm's core trick.
4. **Recurse on the reduced string** of LMS-substring names. If all LMS names are distinct, the order is direct; otherwise recurse on a string of length `≤ n/2`, giving the `T(n) = T(n/2) + O(n) = O(n)` recurrence.

The induced-sorting insight: once you know the relative order of the LMS suffixes, the order of every other suffix is *forced* and computable by two linear scans over the bucket array. The recursion depth is `O(log n)` but the work halves each level, so total work is `O(n)`.

### 2.2 DC3 / Skew (Difference Cover modulo 3)

DC3 (Kärkkäinen-Sanders 2003) is the conceptually cleanest linear algorithm:

1. Sort the suffixes at positions `i mod 3 ∈ {1, 2}` by radix-sorting their first three characters, then recurse on the resulting reduced string (length `~2n/3`).
2. Sort the positions `i mod 3 == 0` using the ranks from step 1 (one radix pass).
3. **Merge** the two sorted groups with a comparison that, thanks to the "difference cover" property, only needs `O(1)` characters plus a precomputed rank to compare any two suffixes.

The recurrence is `T(n) = T(2n/3) + O(n) = O(n)`. DC3 is elegant and easy to prove correct but has a larger constant and more memory traffic than SA-IS; SA-IS is preferred in practice.

### 2.3 Which to use

| Need | Choice |
|------|--------|
| Production, fastest, smallest constant | **SA-IS** (or a tuned `divsufsort`) |
| Teaching / provable elegance | DC3 / Skew |
| `n ≤ few million`, simplicity matters | prefix doubling + radix (`O(n log n)`) |
| Quick prototype / correctness oracle | naive `O(n² log n)` |

Implementing SA-IS correctly is genuinely hard (bucket boundary bookkeeping, the recursion's reduced-alphabet naming, induced-sort scan directions). In practice, link a battle-tested library; implement it yourself only to learn or when no dependency is allowed.

### 2.4 Worked SA-IS Classification (`banana$`)

Take `s = banana$` with `$` the smallest character. Classify S/L right-to-left (S-type if `s[i..] < s[i+1..]`):

```
i :  0   1   2   3   4   5   6
s :  b   a   n   a   n   a   $
type: L   S   L   S   L   S   S        ($ is S-type by rule)
LMS:      *           *       *        (S-type preceded by L-type, plus i=6 region)
```

LMS positions (Left-Most S-type) are `1, 3` (and the sentinel boundary). The LMS substrings between consecutive LMS positions are `ana$`-style segments; SA-IS sorts *those* (recursively if they are not all distinct), then induces the order of every L-type suffix by a left-to-right bucket scan and every S-type suffix by a right-to-left bucket scan. For `banana$` the LMS substrings turn out distinct enough that one induction level resolves the full order, yielding `SA = [6, 5, 3, 1, 0, 4, 2]` (the `$` suffix at index 6 sorts first). The recursion's base case — all LMS names distinct — is reached quickly here; adversarial inputs (`aaaa…`) force the full `O(log n)` recursion depth, but the halving keeps total work linear.

### 2.5 Why induced sorting is linear, intuitively

The induction places a suffix using the already-sorted suffix immediately to its right (for L-type, scanning buckets left to right) or left (for S-type, scanning right to left). Each suffix is placed exactly once per scan, and each scan is a single linear pass over the bucket array, so the non-recursive work is `O(n)`. The recursion runs on a string of LMS names of length `≤ n/2` (LMS positions are non-adjacent), giving `T(n) = T(n/2) + O(n) = O(n)`. The subtlety that makes implementations error-prone is maintaining the *current insertion pointer* per bucket as suffixes are induced — an off-by-one there silently corrupts a handful of entries that pass naive smoke tests but fail the permutation/oracle checks of Section 8.

---

## 3. Memory Layout and Integer Width

### 3.1 Integer width

`SA`, `rank`, and `LCP` are arrays of length `n`. For `n < 2³¹` use 32-bit integers (`int32`); this halves memory versus 64-bit and improves cache density — critical at genome scale. For `n ≥ 2³¹` (multi-gigabyte texts) you need 64-bit indices, doubling the footprint. A `10⁹`-base genome needs `4 GB` for a 32-bit `SA` alone; the auxiliary arrays multiply that.

| Array | Width | Bytes for `n = 10⁹` |
|-------|-------|----------------------|
| `SA` (int32) | 4 | 4 GB |
| `rank` (int32) | 4 | 4 GB (often discarded after LCP) |
| `LCP` (int32) | 4 | 4 GB |
| text (bytes) | 1 | 1 GB |

The `rank` array is needed for Kasai but can be **freed after** the LCP array is built — a meaningful saving when memory is tight.

### 3.2 Flat arrays, contiguous access

Store everything as flat contiguous arrays of fixed-width integers. Prefix doubling and Kasai are dominated by sequential or near-sequential scans, which the hardware prefetcher loves. This cache friendliness is the suffix array's decisive advantage over the pointer-chasing suffix tree (`13-suffix-tree-ukkonen`): same asymptotics, dramatically better constants and memory.

### 3.3 Alphabet compression

If the alphabet is large or sparse, compress characters to a dense range `0..σ-1` first (a sort + map, `O(n + σ)`). SA-IS and radix doubling both run in time proportional to the *effective* alphabet size; compressing it shrinks the counting-sort buckets and the recursion.

### 3.3b Effective vs nominal alphabet

A subtle scaling point: SA-IS and radix doubling cost time proportional to the *effective* alphabet (the number of distinct characters actually present), not the nominal range. A genome over `{A, C, G, T}` has `σ = 4`, so counting-sort buckets are tiny regardless of how characters are encoded. But naively bucketing over the full `0..255` byte range wastes a 256-entry count array per radix pass — negligible for one pass, but it adds up across `log n` rounds and pollutes the cache. Always remap to a dense `0..σ-1` range first; the remap is one `O(n + σ)` pass and pays for itself immediately.

### 3.4 Sentinel handling

Appending a unique sentinel `$` (smaller than every real character) guarantees no suffix is a prefix of another and makes SA-IS's last-suffix-is-S-type rule clean. The cost is one extra position (`n+1`). Decide once whether your `n` includes the sentinel and keep every downstream consumer (LCP, search, BWT) consistent — an off-by-one here corrupts every query.

---

## 4. Large-Text Indexing in Practice

### 4.1 Construction at scale

For `n` in the hundreds of millions: SA-IS in-memory if RAM allows (`~5–9n` bytes peak with 32-bit indices), or an **external-memory** suffix array construction (e.g. eSAIS, pSAscan) when the text exceeds RAM. External construction trades disk I/O for the ability to index texts larger than memory; it is essential for genome-scale corpora on commodity hardware.

### 4.2 Query serving

A built `SA` is read-only and trivially shareable across threads/processes (memory-map the file). Substring queries are `O(m log n)` independent reads — embarrassingly parallel across queries. For higher throughput, layer an FM-index (Section 5) to get `O(m)` count queries with a much smaller index.

### 4.3 Static, not dynamic

Suffix arrays are **static**: appending or editing the text invalidates the array, and there is no cheap incremental update (unlike the online suffix automaton, `12-suffix-automaton`). For a changing corpus you either rebuild periodically (batch indexing) or pick a structure designed for updates. State this constraint explicitly in any design review — "we will rebuild nightly" is a legitimate answer, "we will patch the SA in place" usually is not.

### 4.3b Worked memory budget for a human genome

Consider indexing the human reference genome, `n ≈ 3.1 × 10⁹` bases (so a 32-bit `SA` is *not* enough — `n > 2³¹`):

| Component | Width | Bytes |
|-----------|-------|-------|
| Text (2-bit packed ACGT) | 0.25 B/base | ~775 MB |
| `SA` (40–48-bit packed, or 64-bit) | 5–8 B | ~16–25 GB |
| `LCP` (only if needed) | 5–8 B | ~16–25 GB |

This is why genome aligners do **not** store a plain SA + LCP; they store an **FM-index** (Section 5), which compresses to roughly `0.5–2 GB` while still supporting `O(m)` backward search. The plain suffix array is the *construction intermediate*, often built in external memory and discarded once the BWT/FM-index is derived. Recognizing that the SA is a means, not the deliverable, is a key senior insight at genome scale.

### 4.3c Memory-mapping and shared read-only access

Once built, persist `SA` (and `LCP`) as raw little-endian integer files and `mmap` them at query time. Benefits: zero deserialization cost, OS page cache shared across processes, and demand paging so only the touched pages load. Because the arrays are immutable after construction, many query threads/processes share one mapping with no locking. The only caveat is endianness portability — pin a byte order in the file format, or store a header byte and byte-swap on mismatch.

### 4.4 Enhanced suffix array

A plain `SA` + `LCP` plus a few auxiliary arrays (a "child table" / LCP-interval tree) can simulate every suffix-tree traversal in the same `O(n)` space but with arrays instead of pointers — the **enhanced suffix array** (Abouelhoda-Kurtz-Ohlebusch). This is how you get full suffix-tree functionality (e.g. matching statistics, suffix links) without the pointer overhead, and it is the structure behind several genome aligners.

---

## 5. Suffix Array vs FM-index / BWT

The suffix array is the construction-time scaffold for the **FM-index**, a compressed full-text index (pointer to sibling `10-burrows-wheeler-transform`).

### 5.1 The chain SA → BWT → FM-index

```
text  --SA-->  suffix array  --rotate--> BWT  --rank/select-->  FM-index
```

- The **BWT** of `s` is `BWT[i] = s[SA[i] - 1]` (the character preceding each sorted suffix, with wraparound for `SA[i] = 0`). So the BWT is a one-pass derivation from the suffix array.
- The **FM-index** stores the BWT plus rank/select data structures and a sampled suffix array. It answers "how many times does `p` occur" by **backward search** in `O(m)` time, using `O(n log σ)` *bits* (often a fraction of the plain `SA`'s bytes after compression).

### 5.2 Trade-offs

| Property | Plain SA (+LCP) | FM-index |
|----------|------------------|----------|
| Space | `O(n log n)` bits (4–12 bytes/char) | `O(n H_k)` bits (compressed, often `< 1` byte/char) |
| Count `p` occurrences | `O(m log n)` | `O(m)` backward search |
| Locate occurrences | direct from `SA` | `O(occ · sample_rate)` via sampled SA |
| LCP / repeat queries | natural (`LCP` array) | needs extra structures |
| Construction | SA-IS, then queries directly | build SA, then BWT, then index |

Use a **plain SA + LCP** when you need LCP-based queries (distinct substrings, longest repeats) and memory is adequate. Use an **FM-index** when the corpus is huge and you need a compressed index with `O(m)` counting — the genomics standard (BWA, Bowtie). The SA is the bridge: you almost always build it first.

### 5.3 Backward search, concretely

The FM-index counts occurrences of `p` by processing `p` **right to left**, maintaining a range `[lo, hi)` of BWT rows whose suffixes are prefixed by the processed suffix of `p`. Each step uses the rank/select structure and the `C[]` array (count of characters smaller than `c`):

```
[lo, hi) = [0, n)
for c in reverse(p):
    lo = C[c] + rank(c, lo)
    hi = C[c] + rank(c, hi)
    if lo >= hi: return 0      # p does not occur
return hi - lo                  # number of occurrences
```

Each `rank(c, ·)` is `O(1)` (with a wavelet tree / bitvector index) or `O(log σ)`, so the whole count is `O(m)` (or `O(m log σ)`), independent of `n`. To *locate* the actual positions, walk the LF-mapping from each row in `[lo, hi)` until you hit a sampled SA entry — the sample rate trades index size against locate latency.

### 5.4 Why the SA is still indispensable

Even when the deliverable is an FM-index, the suffix array is the construction backbone: the BWT is literally `s[SA[i]-1]`, and the sampled SA stored in the FM-index is a subsample of the full SA. There is no practical way to build a correct BWT without (explicitly or implicitly) computing the suffix order. Modern pipelines build the SA (often via SA-IS in external memory), emit the BWT, build rank/select, subsample the SA, then discard the full SA. So mastering SA construction is a prerequisite for the compressed-index world, not an alternative to it.

---

## 6. LCP, RMQ, and Range Queries

### 6.1 LCP of arbitrary suffixes via RMQ

`LCP[r]` only gives the overlap of *adjacent* sorted suffixes. The LCP of any two suffixes at ranks `a < b` equals the **minimum** of `LCP[a+1 .. b]`:

```
LCP(suffix SA[a], suffix SA[b]) = min( LCP[a+1], …, LCP[b] )
```

Build a **sparse-table RMQ** over the LCP array (`O(n log n)` preprocessing, `O(1)` query) and you can answer the LCP of any two suffixes in `O(1)`. This is the workhorse behind matching statistics, repeated-substring with constraints, and pattern search refined to `O(m + log n)`.

### 6.2 LCP-interval tree

The LCP array implicitly encodes the suffix tree's internal-node structure: each "LCP interval" `[i, j]` with a local minimum LCP value corresponds to an internal node. Traversing these intervals (via a stack scan of the LCP array, `O(n)`) reconstructs suffix-tree traversals without building the tree — the enhanced-suffix-array technique from Section 4.4.

### 6.3 Search refined with LCP

The plain `O(m log n)` binary search recompares the pattern prefix at every step. By caching the LCP between the pattern and the current `lo`/`hi` boundaries (the Manber-Myers refinement), you avoid re-scanning already-matched characters and reach `O(m + log n)`. This matters when `m` is large and `n` is huge.

### 6.4 Matching statistics over the LCP-RMQ

A common downstream task is **matching statistics**: for each position of a query `B`, the length of the longest substring starting there that occurs anywhere in the indexed text `A`. With `SA + LCP + RMQ` of `A`, you walk a "current rank window" through `B`, extending matches and using the `O(1)` RMQ-backed LCP to know how many characters survive when you fail and must move to an adjacent suffix. The amortized cost is `O(|B|)` — the array analogue of the suffix-tree matching-statistics algorithm (Chang-Lawler). This is the building block for approximate matching, alignment seeding, and longest-common-extension queries that genome tools depend on.

### 6.5 Longest common extension (LCE)

`LCE(i, j)` is the length of the longest common prefix of suffixes `i` and `j` — exactly `lcp(s[i..], s[j..])`. Via Theorem 9.1 it is `min LCP[rank-range]`, an `O(1)` RMQ query after `O(n log n)` preprocessing (or `O(n)` with an `O(n)`-build RMQ). LCE queries are the workhorse behind many string algorithms (palindrome detection, approximate matching with `k` mismatches via the Kangaroo method, tandem-repeat finding). Building the suffix array purely to answer LCE queries in `O(1)` is a frequent senior design choice when a problem reduces to "compare two substrings for equality / common-prefix length" many times.

---

## 7. Code Examples

### 7.1 Go — SA-IS classification + RMQ on LCP (sparse table)

```go
package main

import (
	"fmt"
	"math/bits"
)

// classifySL returns S/L types (true = S-type) for SA-IS, O(n).
func classifySL(s []int32) []bool {
	n := len(s)
	t := make([]bool, n)
	if n == 0 {
		return t
	}
	t[n-1] = true // sentinel suffix is S-type
	for i := n - 2; i >= 0; i-- {
		if s[i] < s[i+1] {
			t[i] = true
		} else if s[i] > s[i+1] {
			t[i] = false
		} else {
			t[i] = t[i+1]
		}
	}
	return t
}

// sparseRMQ answers min(lcp[l..r]) in O(1) after O(n log n) build.
type sparseRMQ struct {
	table [][]int
	log   []int
}

func buildRMQ(lcp []int) *sparseRMQ {
	n := len(lcp)
	logT := make([]int, n+1)
	for i := 2; i <= n; i++ {
		logT[i] = logT[i/2] + 1
	}
	K := bits.Len(uint(n)) // number of levels
	table := make([][]int, K)
	table[0] = append([]int(nil), lcp...)
	for j := 1; j < K; j++ {
		size := n - (1 << j) + 1
		if size < 0 {
			size = 0
		}
		table[j] = make([]int, size)
		for i := 0; i < size; i++ {
			a := table[j-1][i]
			b := table[j-1][i+(1<<(j-1))]
			if a < b {
				table[j][i] = a
			} else {
				table[j][i] = b
			}
		}
	}
	return &sparseRMQ{table, logT}
}

func (r *sparseRMQ) query(l, rr int) int { // min over [l, rr]
	j := r.log[rr-l+1]
	a := r.table[j][l]
	b := r.table[j][rr-(1<<j)+1]
	if a < b {
		return a
	}
	return b
}

func main() {
	s := []int32{'b', 'a', 'n', 'a', 'n', 'a'}
	fmt.Println("S/L types:", classifySL(s))
	lcp := []int{0, 1, 3, 0, 0, 2}
	rmq := buildRMQ(lcp)
	// LCP of suffixes at ranks 1 and 2 = min(lcp[2..2]) = 3
	fmt.Println("LCP(rank1, rank2) =", rmq.query(2, 2)) // 3
}
```

### 7.2 Java — BWT from suffix array, and sampled-SA sketch

```java
import java.util.*;

public class BwtFromSA {
    // BWT[i] = s[SA[i]-1], with wraparound to the sentinel for SA[i]==0.
    static char[] bwt(String s, int[] sa) {
        int n = s.length();
        char[] out = new char[n];
        for (int i = 0; i < n; i++) {
            int p = sa[i];
            out[i] = (p == 0) ? '$' : s.charAt(p - 1);
        }
        return out;
    }

    // A sampled suffix array keeps every k-th SA entry to save memory;
    // the rest are recovered by walking the FM-index LF-mapping (sketch).
    static int[] sampleSA(int[] sa, int rate) {
        int n = sa.length;
        int[] sample = new int[(n + rate - 1) / rate];
        for (int i = 0, j = 0; i < n; i += rate, j++) sample[j] = sa[i];
        return sample;
    }

    public static void main(String[] args) {
        String s = "banana$";
        int[] sa = {6, 5, 3, 1, 0, 4, 2}; // SA of "banana$"
        System.out.println("BWT: " + new String(bwt(s, sa)));      // annb$aa
        System.out.println("sampled SA (rate 2): " + Arrays.toString(sampleSA(sa, 2)));
    }
}
```

### 7.3 Python — enhanced query: longest repeated substring with RMQ, and memory note

```python
class SparseRMQ:
    def __init__(self, arr):
        self.n = len(arr)
        self.log = [0] * (self.n + 1)
        for i in range(2, self.n + 1):
            self.log[i] = self.log[i // 2] + 1
        K = self.log[self.n] + 1 if self.n else 1
        self.table = [arr[:]] + [[0] * self.n for _ in range(K - 1)]
        for j in range(1, K):
            span = 1 << j
            for i in range(self.n - span + 1):
                self.table[j][i] = min(self.table[j - 1][i],
                                       self.table[j - 1][i + (span >> 1)])

    def query(self, l, r):  # min over [l, r] inclusive
        j = self.log[r - l + 1]
        return min(self.table[j][l], self.table[j][r - (1 << j) + 1])


def lcp_of_suffixes(rmq, rank_a, rank_b):
    """O(1) LCP of two suffixes given their sorted ranks."""
    if rank_a == rank_b:
        return None  # same suffix
    lo, hi = sorted((rank_a, rank_b))
    return rmq.query(lo + 1, hi)  # min of LCP[lo+1 .. hi]


if __name__ == "__main__":
    lcp = [0, 1, 3, 0, 0, 2]   # banana
    rmq = SparseRMQ(lcp)
    # LCP of the two suffixes at ranks 1 (ana) and 4 (na) = min(lcp[2..4]) = 0
    print(lcp_of_suffixes(rmq, 1, 4))  # 0
    # Note: free the rank[] array after Kasai if memory is tight at genome scale.
```

---

## 8. Observability and Testing

A suffix array is opaque — one wrong index looks like any other. Build in checks from day one.

| Check | Why |
|-------|-----|
| `SA` is a permutation of `0..n-1` | Catches comparator / radix-stability bugs immediately. |
| `SA` matches naive `O(n² log n)` oracle on small inputs | Catches construction bugs end-to-end. |
| Adjacent suffixes are sorted | `s[SA[r-1]:] <= s[SA[r]:]` for all `r` (sample-checked at scale). |
| `LCP` verified by direct char comparison on small inputs | Catches Kasai `h`-reset / bound bugs. |
| Distinct-substring count cross-checked | `n(n+1)/2 − Σ LCP` vs a brute set of substrings for small `n`. |
| BWT round-trips | Inverse BWT reconstructs the text — validates the SA→BWT derivation. |
| RMQ vs naive min | Sparse-table query equals a direct `min` scan on random ranges. |

The single most valuable test is the **naive oracle**: build `SA` and `LCP` the slow way for `n ≤ 50` over a tiny alphabet and compare entrywise. The small alphabet maximizes shared prefixes and exercises the doubling/SA-IS recursion hardest.

### 8.1 Property-test battery

```text
for random small string s over {a,b}:
    SA  = build(s);   assert sorted(SA) == range(len(s))
    assert adjacent suffixes are lexicographically nondecreasing
    LCP = kasai(s, SA); assert LCP matches direct pairwise LCP
    assert distinct_substrings(s) == len(set of all substrings)
    assert inverse_bwt(bwt(s, SA)) == s
    assert RMQ(LCP).query(l, r) == min(LCP[l..r]) for random l<=r
```

These invariants, run over a few hundred random instances per build, catch the overwhelming majority of bugs — especially the partial bugs that pass on distinct-character inputs but fail when prefixes collide.

### 8.2 Adversarial test inputs

A fuzzer over `{a, b}` is good, but hand-craft these adversarial cases explicitly — each targets a different failure class:

| Input | Targets |
|-------|---------|
| `"aaaaaaaa"` | Kasai `h`-reset (max adjacent LCP), SA-IS deepest recursion. |
| `"abababab"` | Periodic prefixes, doubling-round count, tie-breaking in rank recompute. |
| `"a"`, `""` | Boundary `n = 1` / `n = 0` indexing. |
| `"abcdefg"` | All-distinct chars: SA-IS one-level base case; should NOT mask `h`-reset bugs. |
| `"zyxwvu"` | Reverse-sorted: stresses the comparator/radix direction. |
| random length-`50` over `{a,b,c}` | General correctness against the naive oracle. |

The all-distinct input is deceptively dangerous: many partial implementations pass it (no prefix collisions exercise the recursion or the carried `h`), so a green run on `"abcdefg"` proves almost nothing. The `"aaaa…"` input is the single most valuable adversarial test.

### 8.3 Cross-language determinism

When the same structure ships in Go, Java, and Python (as in this repo's tasks), assert byte-identical `SA` and `LCP` across all three on the same seeded inputs. Differences usually trace to (a) signed vs unsigned character codes, (b) unstable sorts breaking the doubling tie-break, or (c) locale-sensitive string comparison. Pin character handling to raw code points and use an explicit, stable comparator everywhere.

---

## 9. Failure Modes

### 9.0 A note on how these fail in practice

The failure modes below are ranked by how often they bite real systems. The top three — Kasai `h`-reset (silent quadratic), wrong index width (silent corruption past `2³¹`), and full-suffix comparison in search (silent quadratic per query) — share a dangerous property: the output is *correct* on small or benign inputs, so unit tests pass and the bug ships, surfacing only as a latency or memory incident under production-scale data. The defense is the adversarial fixtures (§8.2) and the production instrumentation above: a permutation check, a latency histogram keyed on suffix length, and a memory gauge keyed on `n`.

### 9.1 SA-IS implementation bugs

The induced-sort bucket-boundary bookkeeping and the recursion's LMS-naming are the two hardest parts to get right; subtle off-by-ones produce an array that is *almost* sorted. Mitigation: test against the naive oracle on adversarial small inputs (all-equal, periodic, single-character-alphabet) and verify `SA` is a permutation.

### 9.2 Kasai `h` reset

Resetting `h` to 0 each iteration (instead of decrementing by 1) silently destroys the `O(n)` guarantee, degrading to `O(n²)` — correct output, catastrophic latency on large input. Mitigation: only `h--` when `h > 0`, and benchmark on a large worst-case string.

### 9.3 Integer overflow / width

`n(n+1)/2` overflows 32-bit for `n > ~65000`; the distinct-substring count must use 64-bit. A 32-bit `SA` is wrong for `n ≥ 2³¹`. Mitigation: choose index width from `n` deliberately; use 64-bit for the substring-count accumulator regardless.

### 9.4 Sentinel / off-by-one

Inconsistent sentinel handling (some consumers assume `n`, others `n+1`) corrupts BWT and search. Mitigation: pin the convention once; the BWT round-trip test catches the mismatch.

### 9.5 Alphabet assumptions

Hardcoding ASCII bucket counts breaks on Unicode or binary data. Mitigation: compress the alphabet to `0..σ-1` and size buckets from the *observed* `σ`.

### 9.6 Treating SA as dynamic

Patching `SA` after a text edit. There is no cheap incremental update; the array must be rebuilt. Mitigation: design for batch rebuild, or use the online suffix automaton (`12-suffix-automaton`) when updates are frequent.

### 9.7 Missing RMQ for arbitrary-LCP queries

Reading `LCP[r]` and assuming it gives the LCP of *non-adjacent* suffixes. It only gives adjacent overlap; arbitrary pairs need the range-minimum over `LCP[a+1..b]`. Mitigation: build the sparse-table RMQ whenever you need LCP of non-adjacent suffixes.

### 9.8 Separator collision in generalized suffix arrays

When building a generalized suffix array over `A # B` (or `s_1 # s_2 # … # s_K`), reusing a separator that appears in the input — or using the *same* separator between multiple strings — lets a "common substring" run across a boundary, inflating results. Mitigation: pick separators that are (a) absent from every input, (b) smaller than all real characters, and (c) *distinct* per boundary for the `K`-string case, so no cross-string match can span two segments. Validate by asserting no reported common substring contains a separator.

### 9.9 Quadratic search from full-suffix comparison

Comparing the *entire* suffix against the pattern at each binary-search step (instead of only the first `m` characters) turns `O(m log n)` search into `O(n log n)` per query — invisible on short suffixes, catastrophic when suffixes are long. Mitigation: truncate the comparison to `min(SA[r]+m, n)`; add a micro-benchmark on a long text with a short pattern to surface the regression.

### 9.10 Building RMQ on the wrong range

A subtle but common bug: building the sparse table over `LCP[0..n-1]` and querying `[a, b]` instead of `[a+1, b]`. `LCP[0]` is meaningless (no predecessor) and the correct range for `lcp(SA[a], SA[b])` is `min LCP[a+1..b]` (Theorem 9.1 in `professional.md`). Off-by-one here returns LCP values that are too small (or reads the bogus `LCP[0]`). Mitigation: encapsulate the conversion `(positions i, j) → (ranks) → (range [lo+1, hi])` in one tested function and never inline it.

---

## 10. Summary

- **Linear construction** (SA-IS / DC3) replaces `O(n log n)` prefix doubling at genome scale; SA-IS's induced sorting (S/L typing, LMS substrings, two-scan induction, recurse on a halved string) is the production choice, DC3/Skew the elegant teaching alternative.
- **Memory layout is the senior lever**: flat 32-bit arrays for `n < 2³¹`, 64-bit beyond; free `rank` after Kasai; compress the alphabet; the contiguous-array layout is exactly why a suffix array beats a pointer-heavy suffix tree (`13`) in practice despite identical asymptotics.
- **Large-text indexing** is static and read-only: memory-map the array, serve `O(m log n)` queries in parallel, rebuild in batch (no cheap updates); use external-memory construction when the text exceeds RAM.
- **The suffix array backs the FM-index**: `BWT[i] = s[SA[i]-1]`, and the FM-index adds rank/select + a sampled SA for `O(m)` compressed backward search (sibling `10-burrows-wheeler-transform`). Use plain SA+LCP for repeat/distinct queries; use the FM-index for compressed `O(m)` counting at scale.
- **RMQ on LCP** lifts a plain SA to suffix-tree power: `LCP(SA[a], SA[b]) = min(LCP[a+1..b])` in `O(1)` after `O(n log n)` sparse-table build; the LCP-interval / enhanced-suffix-array view simulates the whole suffix tree with arrays.
- **Test against a naive oracle** over a tiny alphabet, verify `SA` is a permutation, verify Kasai against pairwise LCP, and round-trip the BWT — these catch nearly every real bug, including the Kasai `h`-reset that silently goes quadratic.

### Decision summary

- **`n ≤ few million`, simplicity** → prefix doubling + radix (`O(n log n)`).
- **Huge text, production** → SA-IS (link a library); external-memory if it exceeds RAM.
- **Compressed index, `O(m)` counting** → FM-index built from the SA (`10-burrows-wheeler-transform`).
- **LCP of arbitrary suffix pairs / suffix-tree traversals** → sparse-table RMQ on LCP / enhanced suffix array.
- **Frequent text updates** → not a suffix array; use the online suffix automaton (`12`).

### Construction-method decision flow

```text
n small (<= few thousand)?          -> naive sort (oracle) or doubling, simplicity wins
n <= few million, simple build?     -> prefix doubling + radix sort  (O(n log n))
n huge, need speed, in RAM?         -> SA-IS (link a library)        (O(n))
n exceeds RAM?                      -> external-memory SA (eSAIS / pSAscan)
deliverable is a compressed index?  -> build SA -> BWT -> FM-index, discard SA
text grows online?                  -> not an SA at all; suffix automaton (12)
```

### What to instrument in production

- **Build time and peak memory**, tagged by `n` and effective alphabet `σ` — sudden regressions flag an un-minimized alphabet or a 64-bit width applied where 32-bit suffices.
- **Permutation invariant** on every build (`sorted(SA) == range(n)`), behind a feature flag in production, always on in CI.
- **Query latency histogram** for search; a tail that scales with suffix length (not `log n`) reveals the full-suffix-comparison bug (§9.9).
- **BWT round-trip** as a periodic integrity check on persisted indexes — a corrupted page surfaces as a reconstruction mismatch.

These are cheap to add and catch the failure modes of Section 9 before they reach users; the permutation check alone would have caught the majority of SA-IS implementation bugs the author has seen in practice.

References to study further: Nong-Zhang-Chan (SA-IS, 2009); Kärkkäinen-Sanders (DC3/Skew, 2003); Manber-Myers (1990, original SA + `O(m + log n)` search); Kasai et al. (2001, linear LCP); Abouelhoda-Kurtz-Ohlebusch (enhanced suffix arrays); Ferragina-Manzini (FM-index). Sibling topics: `10-burrows-wheeler-transform`, `12-suffix-automaton`, `13-suffix-tree-ukkonen`.
