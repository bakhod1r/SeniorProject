# Suffix Arrays (and the LCP Array) — Interview Preparation

Suffix arrays are a favourite interview topic because they reward one crisp insight — *"sort all suffixes; their starting indices are the suffix array, and adjacent overlaps are the LCP array"* — and then test whether you can (a) construct it efficiently with prefix doubling, (b) build the LCP array in linear time with Kasai's algorithm, (c) search a pattern by binary search in `O(m log n)`, and (d) turn `SA + LCP` into distinct-substring, longest-repeated, and longest-common-substring answers. This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Sorted order of all suffixes | suffix array `SA` | `O(n log n)` (doubling), `O(n)` (SA-IS) |
| Sorted position of suffix `i` | rank array (inverse of `SA`) | `O(n)` from `SA` |
| Overlap of adjacent sorted suffixes | LCP array (Kasai) | `O(n)` |
| Does pattern `p` occur, where? | two binary searches on `SA` | `O(m log n)` |
| LCP of two arbitrary suffixes | RMQ over `LCP` | `O(1)` after `O(n log n)` |
| Number of distinct substrings | `SA + LCP` | `n(n+1)/2 − Σ LCP` |
| Longest repeated substring | `LCP` | `max(LCP)` |
| Longest common substring of two strings | concat `A#B` + `LCP` | `O(\|A\|+\|B\|)` |

Core construction skeleton:

```text
buildSA(s):                          # prefix doubling
    sa[i] = i ;  rank[i] = s[i]
    for k = 1; k < n; k *= 2:
        sort sa by (rank[i], rank[i+k])   # radix -> O(n) per round
        recompute rank from new order
        if all ranks distinct: break
    return sa                        # O(n log n)

buildLCP(s, sa):                     # Kasai, O(n)
    h = 0
    for i in 0..n-1 (string order):
        if rank[i] > 0:
            j = sa[rank[i]-1]
            while s[i+h] == s[j+h]: h++
            lcp[rank[i]] = h
            if h > 0: h--
    return lcp
```

Key facts:
- `SA` is a **permutation** of `0..n-1`; `rank` is its inverse (`rank[SA[r]] = r`).
- `LCP[r]` is the overlap of **adjacent** sorted suffixes; arbitrary pairs need RMQ (`min LCP[a+1..b]`).
- Kasai is `O(n)` because the running overlap `h` **drops by at most 1** per position.
- Distinct substrings `= n(n+1)/2 − Σ LCP`; longest repeated `= max LCP`.

---

## Junior Questions (12 Q&A)

### J1. What is a suffix array?
For a string `s` of length `n`, list all `n` suffixes, sort them lexicographically, and write down their starting indices in that sorted order. That array of indices is the suffix array `SA`. It is a permutation of `0..n-1`; the suffix strings themselves are never stored.

### J2. What is the rank array?
The inverse permutation of `SA`: `rank[i]` is the sorted position of the suffix starting at index `i`, satisfying `rank[SA[r]] = r`. Kasai's algorithm and prefix doubling both need it.

### J3. What is the LCP array?
`LCP[r]` is the length of the longest common prefix of the suffix at sorted rank `r` and the one at rank `r-1` — the overlap between two *adjacent* suffixes in sorted order. `LCP[0]` is undefined (set to 0).

### J4. Why does sorting suffixes help search?
Every substring is a prefix of some suffix, and all suffixes starting with a pattern `p` form a contiguous block in sorted order. So checking "does `p` occur" becomes a binary search over `SA`, costing `O(m log n)` for a length-`m` pattern.

### J5. How fast can you build a suffix array?
Naively `O(n² log n)` (sorting full suffixes). Prefix doubling is `O(n log² n)` with a comparison sort, `O(n log n)` with a radix sort. Linear `O(n)` is possible with SA-IS or DC3.

### J6. What does prefix doubling do?
It sorts suffixes by their first `1, 2, 4, …` characters, doubling each round. After sorting by the first `k` characters it sorts by the first `2k` using the pair `(rank of first k, rank of next k)`, reusing the previous ranks so each round is one sort.

### J7. What is Kasai's algorithm?
A linear-time method to build the LCP array given `SA` and `rank`. It processes positions in string order, carrying a running overlap `h` that only ever decreases by 1, so the total work is `O(n)`.

### J8. How do you count distinct substrings?
`n(n+1)/2 − Σ LCP`. The total number of substrings counted with repeats is `n(n+1)/2`; subtracting the LCP sum removes the prefixes that adjacent sorted suffixes share (already counted).

### J9. How do you find the longest repeated substring?
It is the largest entry in the LCP array. `max(LCP)` gives its length, and the suffix at that rank gives its text. A repeated substring is a prefix shared by two suffixes, maximized at adjacent sorted suffixes.

### J10. What is the time and space of a suffix array?
Space is `O(n)` integers (`SA`, optionally `rank` and `LCP`). Construction is `O(n log n)` (doubling) or `O(n)` (SA-IS). Search is `O(m log n)`. The constants are tiny because everything is contiguous arrays.

### J11. Is a suffix array directed at directed/undirected anything? What about a sentinel?
It is purely a string structure. A sentinel `$` (smaller than all characters) is often appended so no suffix is a prefix of another, simplifying comparisons; it is optional if you compare prefixes carefully.

### J12 (analysis). Why is prefix doubling `O(n log n)` and not `O(n²)`?
Because comparisons use precomputed *ranks*, each pair comparison is `O(1)` regardless of how many characters the prefix covers. With a radix sort each of the `O(log n)` rounds is `O(n)`, giving `O(n log n)`. Comparing actual characters would cost `O(k)` per comparison and blow up.

---

## Middle Questions (12 Q&A)

### M1. Prove that prefix doubling sorts correctly.
After sorting by the first `k` characters, two suffixes' first `2k` characters compare exactly as the pairs `(rank_k[i], rank_k[i+k])` compare lexicographically: the first block decides if it differs, otherwise the second block (the first `k` chars of suffix `i+k`) decides. Inductively, after `⌈log₂ n⌉` rounds the ranks are distinct and equal the final order.

### M2. Why does Kasai run in `O(n)`?
When you move from suffix `i` to `i+1`, you drop one leading character, and the LCP with the sorted predecessor can decrease by at most 1. So the running `h` is never reset to 0; across all `n` positions it can decrease at most `n` times, so the total increments are `O(n)`.

### M3. How do you search a pattern with the suffix array?
Two binary searches: one for the leftmost suffix `≥ p`, one for the leftmost suffix whose length-`m` prefix exceeds `p`. The range between them is the contiguous block of occurrences; its width is the count and the `SA` entries are positions. `O(m log n)`.

### M4. How do you make doubling `O(n log n)` instead of `O(n log² n)`?
Replace the comparison sort in each round with a two-pass stable radix (counting) sort on the integer pairs: sort stably by the second key, then by the first. Each pass is `O(n)`, so each round is `O(n)`, giving `O(n log n)` total.

### M5. How do you find the longest common substring of two strings?
Concatenate `C = A # B` with a separator absent from both, build `SA` and `LCP` of `C`, then take the maximum `LCP[r]` over adjacent suffixes that start on *opposite sides* of the separator. The opposite-side condition makes the shared prefix common to both strings, not a repeat within one.

### M6. Why does the distinct-substring formula work?
Suffix `SA[r]` contributes `(n − SA[r])` prefixes, of which `LCP[r]` are shared with the previous sorted suffix (already counted). New substrings per rank: `(n − SA[r]) − LCP[r]`. Summing and using `Σ(n − SA[r]) = n(n+1)/2` gives `n(n+1)/2 − Σ LCP`.

### M7. What is the LCP of two non-adjacent suffixes?
`lcp(SA[a], SA[b]) = min(LCP[a+1], …, LCP[b])`. Build a sparse-table RMQ over the LCP array for `O(1)` queries after `O(n log n)` preprocessing. This is the basis for matching statistics and constrained-repeat queries.

### M8. What is the role of the sentinel `$`?
Appending a unique smallest character ensures no suffix is a prefix of another, which simplifies comparisons and makes SA-IS's typing rules and BWT derivation clean. It costs one extra position; you can skip it if you handle prefix ties directly.

### M9. How does a suffix array compare to a suffix tree?
Same query power, far less memory and far better cache behaviour (contiguous arrays vs pointers). The suffix tree searches in `O(m)` worst case vs the array's `O(m log n)` (or `O(m + log n)` with LCP), and is online-ish; the array is static. `SA + LCP + RMQ` simulates the suffix tree (enhanced suffix array).

### M10. How does a suffix array compare to a suffix automaton?
The suffix automaton (`12-suffix-automaton`) is online — you can append a character in amortized `O(1)` — while the suffix array is static. Both give `O(n)` distinct-substring counts (the automaton sums `len − link.len`, the array uses `n(n+1)/2 − Σ LCP`). Use the automaton when the string grows; use the array for static memory-tight indexing.

### M11. What is the worst-case input for prefix doubling?
A small alphabet with long repeated prefixes (e.g. `"aaaa…"` or DNA). Suffixes stay tied for many rounds, forcing the full `⌈log₂ n⌉` doubling rounds before ranks become distinct.

### M12 (analysis). Where does the suffix array show up beyond search?
As the construction scaffold for the **Burrows-Wheeler Transform** and **FM-index** (`10-burrows-wheeler-transform`): `BWT[i] = s[SA[i]-1]`, and the FM-index adds rank/select plus a sampled SA for compressed `O(m)` backward search — the backbone of genome aligners.

---

## Senior Questions (10 Q&A)

### S1. When would you use SA-IS instead of prefix doubling?
For the largest inputs (genome-scale, hundreds of millions of characters) where `O(n)` beats `O(n log n)` meaningfully, or in latency-critical production indexing. SA-IS uses induced sorting (S/L typing, LMS substrings, two linear bucket scans, recurse on a halved string) for true linear time, at the cost of much harder implementation.

### S2. How do you answer the LCP of two arbitrary suffixes in `O(1)`?
Build a sparse-table range-minimum structure over the LCP array. `lcp(SA[a], SA[b]) = min(LCP[a+1..b])`, so each query is one `O(1)` range-minimum after `O(n log n)` preprocessing. This lifts a plain SA to suffix-tree query power.

### S3. How do you handle a multi-gigabyte text?
Use 32-bit indices while `n < 2³¹` (halves memory, denser cache); 64-bit beyond. Free the `rank` array after Kasai. Compress the alphabet to `0..σ-1`. If the text exceeds RAM, use external-memory SA construction (eSAIS, pSAscan). Memory-map the read-only array and serve queries in parallel.

### S4. How does the suffix array relate to the FM-index?
The chain is `text → SA → BWT → FM-index`. `BWT[i] = s[SA[i]-1]`. The FM-index stores the BWT plus rank/select and a sampled SA, answering count queries by `O(m)` backward search in `O(n H_k)` bits — often under one byte per character, far smaller than the plain SA. Build the SA first regardless.

### S5. Why is a suffix array static, and what if the text changes?
There is no cheap incremental update; appending or editing the text invalidates the sorted order. For a changing corpus, rebuild in batch, or switch to the online suffix automaton (`12-suffix-automaton`), which appends characters in amortized `O(1)`.

### S6. How do you verify a suffix array when `n` is too large to brute-force?
Assert `SA` is a permutation of `0..n-1`. Sample-check that adjacent suffixes are lexicographically nondecreasing. Verify the LCP against direct character comparison on a small slice. Cross-check the distinct-substring count against a brute set for small `n`. Round-trip the BWT (inverse BWT reconstructs the text).

### S7. What is the most common performance bug in Kasai?
Resetting `h` to 0 each iteration instead of decrementing by 1. The output stays correct, but the "drops by at most 1" invariant is destroyed and the algorithm degrades to `O(n²)` — a silent latency catastrophe on large input. Always `h--` only when `h > 0`.

### S8. How do you serve many pattern queries at scale?
The `SA` is read-only and shareable; each `O(m log n)` query is independent, so distribute queries across workers. For high throughput layer an FM-index for `O(m)` counting. For repeated LCP-based queries, prebuild the RMQ once and share it.

### S9. How would you get search down to `O(m + log n)`?
Cache the LCP between the pattern and the current `lo`/`hi` boundaries during the binary search (Manber-Myers refinement). This avoids re-comparing already-matched prefix characters, so the total character comparisons across all `O(log n)` steps is `O(m + log n)` rather than `O(m log n)`.

### S10 (analysis). Why do SA + LCP encode the suffix tree?
The suffix tree's leaves, read left to right, appear in `SA` order; its internal nodes correspond to LCP-intervals (maximal ranges with a given range-minimum LCP). A single `O(n)` stack scan of the LCP array enumerates these intervals, so any suffix-tree traversal can be done over `SA + LCP + RMQ` with arrays instead of pointers — the enhanced suffix array.

---

## Professional Questions (8 Q&A)

### P1. Design a full-text substring search service over a fixed corpus.
Build `SA` (SA-IS for large corpora) and `LCP` once, offline; memory-map the arrays read-only. Each query is two binary searches (`O(m log n)`) returning the occurrence range; `SA` entries inside it are positions. For counting at scale, layer an FM-index for `O(m)` queries and a compressed index. Rebuild in batch when the corpus changes (the structure is static).

### P2. The answer to distinct-substring count overflows 32-bit. What do you do?
`n(n+1)/2` exceeds `int32` for `n > ~65000`. Use a 64-bit accumulator for both the total and the LCP sum. If even `n(n+1)/2` exceeds 64-bit (astronomically large `n`), use big integers or report modulo a prime as the problem dictates.

### P3. Your suffix array build is too slow at `n = 5·10⁸`. What levers do you pull?
Switch from `O(n log n)` doubling to SA-IS (`O(n)`). Use 32-bit indices for cache density. Compress the alphabet so counting-sort buckets are minimal. If it exceeds RAM, use external-memory construction. Profile the multiply-free hot loops; Kasai should never be the bottleneck (`O(n)`).

### P4. How do you debug "the suffix array is wrong" in production?
Assert `SA` is a permutation first (catches comparator/radix bugs instantly). Diff against the naive `O(n² log n)` oracle on small adversarial inputs (all-equal, periodic, single-character alphabet). Verify the LCP against direct pairwise comparison. Round-trip the BWT. The small-alphabet oracle exercises the doubling rounds hardest and catches partial bugs.

### P5. When is a suffix array the wrong choice?
When the text changes frequently (no cheap updates — use a suffix automaton), when you need guaranteed `O(m)` search and have memory to spare (suffix tree), or when `n` is tiny and a direct scan / KMP (`01-kmp`) is simpler. Also when you need a compressed index — then build the FM-index on top.

### P6. How do you compute matching statistics of `B` against `A`?
Build `SA + LCP + RMQ` of `A` (or the generalized structure of `A#B`). For each position of `B`, the matching statistic (longest substring of `B` starting there that occurs in `A`) is computed by advancing through the suffix array using the RMQ-backed LCP to skip already-matched characters, in `O(|B|)` amortized — the array analogue of the suffix-tree algorithm.

### P7. How do suffix arrays connect to compression?
The BWT, computed directly from the SA (`BWT[i] = s[SA[i]-1]`), clusters equal characters together, which run-length and entropy coders compress well (bzip2). The FM-index is a *searchable* compressed index over the BWT. So the suffix array is the bridge from "index" to "compressed index" — sibling `10-burrows-wheeler-transform`.

### P8 (analysis). Why can't a comparison-based argument rule out linear construction?
Sorting `n` arbitrary items needs `Ω(n log n)` comparisons, but suffixes are not arbitrary — they overlap, so a single character comparison contributes information about many suffixes simultaneously. SA-IS and DC3 exploit this shared structure (induced sorting, difference covers) to reach `O(n)` for integer alphabets, sidestepping the comparison lower bound.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you replaced a slow string search with an indexed approach.
Look for a concrete story: a substring/occurrence workload that was scanning the text per query (`O(nm)` total), the insight to build a reusable index (suffix array or FM-index), the measured speedup (per-query `O(m log n)`), and the correctness check against the old scan. Strong answers mention memory budgeting and the static-vs-dynamic trade-off.

### B2. A teammate used `LCP[r]` to get the LCP of two non-adjacent suffixes and shipped a bug. How do you handle it?
Explain calmly that `LCP[r]` is only the overlap of *adjacent* sorted suffixes; the LCP of arbitrary suffixes is the range-minimum `min LCP[a+1..b]`, which needs an RMQ structure. Show a tiny counterexample. Frame it as a teaching moment and pair on adding the sparse-table RMQ plus a property test against a naive min.

### B3. Design a feature to detect plagiarism between two documents.
Longest-common-substring (and more generally, total shared content) via a generalized suffix array of `A # B`: build `SA + LCP`, take the max (and sum of) LCP over opposite-side adjacent suffixes. Discuss normalization (case, whitespace), the separator choice, scaling to many documents (pairwise vs a single generalized array), and thresholds for "suspicious" overlap.

### B4. How would you explain a suffix array to a junior engineer?
Start from the textbook-index analogy: sort every "tail" of the text alphabetically and store only where each begins. Then show that any phrase you search for lands in a contiguous block, found by binary search. Lead with the two gotchas: it stores *positions* not strings, and it is *static* (rebuild on change). Mention the LCP array as the companion that answers "what repeats".

### B5. Your indexing job is using too much memory. How do you investigate?
Each int array is `4n` (32-bit) or `8n` (64-bit) bytes; check the index width is appropriate for `n`. Confirm you free `rank` after Kasai. Verify the alphabet is compressed (huge buckets waste space). For batched queries, ensure the RMQ/SA are shared read-only, not duplicated per request. Profile allocations; the fix is usually width choice plus freeing transient arrays.

---

## Coding Challenges

### Challenge 1: Build the Suffix Array and LCP Array

**Problem.** Given a string `s`, build its suffix array `SA` (prefix doubling) and LCP array (Kasai). Return both.

**Example.**
```text
s = "banana"  ->  SA = [5,3,1,0,4,2],  LCP = [0,1,3,0,0,2]
```

**Constraints.** `1 ≤ n ≤ 10⁵` (doubling), `O(n log² n)` acceptable.

**Go.**
```go
package main

import (
	"fmt"
	"sort"
)

func buildSA(s string) []int {
	n := len(s)
	sa := make([]int, n)
	rank := make([]int, n)
	tmp := make([]int, n)
	for i := 0; i < n; i++ {
		sa[i] = i
		rank[i] = int(s[i])
	}
	for k := 1; k < n; k <<= 1 {
		cmp := func(a, b int) bool {
			if rank[a] != rank[b] {
				return rank[a] < rank[b]
			}
			ra, rb := -1, -1
			if a+k < n {
				ra = rank[a+k]
			}
			if b+k < n {
				rb = rank[b+k]
			}
			return ra < rb
		}
		sort.Slice(sa, func(i, j int) bool { return cmp(sa[i], sa[j]) })
		tmp[sa[0]] = 0
		for i := 1; i < n; i++ {
			tmp[sa[i]] = tmp[sa[i-1]]
			if cmp(sa[i-1], sa[i]) {
				tmp[sa[i]]++
			}
		}
		copy(rank, tmp)
		if rank[sa[n-1]] == n-1 {
			break
		}
	}
	return sa
}

func buildLCP(s string, sa []int) []int {
	n := len(s)
	rank := make([]int, n)
	for r := 0; r < n; r++ {
		rank[sa[r]] = r
	}
	lcp := make([]int, n)
	h := 0
	for i := 0; i < n; i++ {
		if rank[i] > 0 {
			j := sa[rank[i]-1]
			for i+h < n && j+h < n && s[i+h] == s[j+h] {
				h++
			}
			lcp[rank[i]] = h
			if h > 0 {
				h--
			}
		} else {
			h = 0
		}
	}
	return lcp
}

func main() {
	s := "banana"
	sa := buildSA(s)
	fmt.Println(sa)            // [5 3 1 0 4 2]
	fmt.Println(buildLCP(s, sa)) // [0 1 3 0 0 2]
}
```

**Java.**
```java
import java.util.*;

public class BuildSALCP {
    static int[] rank;

    static int[] buildSA(String s) {
        int n = s.length();
        Integer[] sa = new Integer[n];
        rank = new int[n];
        int[] tmp = new int[n];
        for (int i = 0; i < n; i++) { sa[i] = i; rank[i] = s.charAt(i); }
        for (int k = 1; k < n; k <<= 1) {
            final int kk = k, nn = n;
            Comparator<Integer> cmp = (a, b) -> {
                if (rank[a] != rank[b]) return Integer.compare(rank[a], rank[b]);
                int ra = a + kk < nn ? rank[a + kk] : -1;
                int rb = b + kk < nn ? rank[b + kk] : -1;
                return Integer.compare(ra, rb);
            };
            Arrays.sort(sa, cmp);
            tmp[sa[0]] = 0;
            for (int i = 1; i < n; i++)
                tmp[sa[i]] = tmp[sa[i - 1]] + (cmp.compare(sa[i - 1], sa[i]) < 0 ? 1 : 0);
            for (int i = 0; i < n; i++) rank[i] = tmp[i];
            if (rank[sa[n - 1]] == n - 1) break;
        }
        int[] out = new int[n];
        for (int i = 0; i < n; i++) out[i] = sa[i];
        return out;
    }

    static int[] buildLCP(String s, int[] sa) {
        int n = s.length();
        int[] rnk = new int[n];
        for (int r = 0; r < n; r++) rnk[sa[r]] = r;
        int[] lcp = new int[n];
        int h = 0;
        for (int i = 0; i < n; i++) {
            if (rnk[i] > 0) {
                int j = sa[rnk[i] - 1];
                while (i + h < n && j + h < n && s.charAt(i + h) == s.charAt(j + h)) h++;
                lcp[rnk[i]] = h;
                if (h > 0) h--;
            } else h = 0;
        }
        return lcp;
    }

    public static void main(String[] args) {
        String s = "banana";
        int[] sa = buildSA(s);
        System.out.println(Arrays.toString(sa));            // [5, 3, 1, 0, 4, 2]
        System.out.println(Arrays.toString(buildLCP(s, sa))); // [0, 1, 3, 0, 0, 2]
    }
}
```

**Python.**
```python
def build_sa(s):
    n = len(s)
    sa = list(range(n))
    rank = [ord(c) for c in s]
    tmp = [0] * n
    k = 1
    while k < n:
        def key(i):
            return (rank[i], rank[i + k] if i + k < n else -1)
        sa.sort(key=key)
        tmp[sa[0]] = 0
        for i in range(1, n):
            tmp[sa[i]] = tmp[sa[i - 1]] + (1 if key(sa[i - 1]) < key(sa[i]) else 0)
        rank = tmp[:]
        if rank[sa[-1]] == n - 1:
            break
        k <<= 1
    return sa


def build_lcp(s, sa):
    n = len(s)
    rank = [0] * n
    for r in range(n):
        rank[sa[r]] = r
    lcp = [0] * n
    h = 0
    for i in range(n):
        if rank[i] > 0:
            j = sa[rank[i] - 1]
            while i + h < n and j + h < n and s[i + h] == s[j + h]:
                h += 1
            lcp[rank[i]] = h
            if h > 0:
                h -= 1
        else:
            h = 0
    return lcp


if __name__ == "__main__":
    s = "banana"
    sa = build_sa(s)
    print(sa)              # [5, 3, 1, 0, 4, 2]
    print(build_lcp(s, sa))  # [0, 1, 3, 0, 0, 2]
```

---

### Challenge 2: Count Distinct Substrings

**Problem.** Given a string `s`, return the number of distinct non-empty substrings, using `SA + LCP` and the formula `n(n+1)/2 − Σ LCP`.

**Example.**
```text
s = "banana"  ->  21 - 6 = 15
s = "aaa"     ->  6 - 3 = 3   (a, aa, aaa)
```

**Constraints.** `1 ≤ n ≤ 10⁵`; answer fits in 64-bit.

**Go.**
```go
package main

import "fmt"

// reuse buildSA, buildLCP from Challenge 1

func distinctSubstrings(s string) int64 {
	n := int64(len(s))
	sa := buildSA(s)
	lcp := buildLCP(s, sa)
	total := n * (n + 1) / 2
	for _, v := range lcp {
		total -= int64(v)
	}
	return total
}

func main() {
	fmt.Println(distinctSubstrings("banana")) // 15
	fmt.Println(distinctSubstrings("aaa"))     // 3
}
```

**Java.**
```java
public class DistinctSubstrings {
    // reuse BuildSALCP.buildSA / buildLCP

    static long distinct(String s) {
        int n = s.length();
        int[] sa = BuildSALCP.buildSA(s);
        int[] lcp = BuildSALCP.buildLCP(s, sa);
        long total = (long) n * (n + 1) / 2;
        for (int v : lcp) total -= v;
        return total;
    }

    public static void main(String[] args) {
        System.out.println(distinct("banana")); // 15
        System.out.println(distinct("aaa"));     // 3
    }
}
```

**Python.**
```python
# reuse build_sa, build_lcp from Challenge 1

def distinct_substrings(s):
    n = len(s)
    sa = build_sa(s)
    lcp = build_lcp(s, sa)
    return n * (n + 1) // 2 - sum(lcp)


if __name__ == "__main__":
    print(distinct_substrings("banana"))  # 15
    print(distinct_substrings("aaa"))      # 3
```

---

### Challenge 3: Longest Repeated Substring

**Problem.** Given `s`, return the longest substring that occurs at least twice (any one if tied; empty string if none). Use `max(LCP)`.

**Example.**
```text
s = "banana"   ->  "ana"
s = "abcabc"   ->  "abc"
s = "abcd"     ->  ""    (no repeats)
```

**Constraints.** `1 ≤ n ≤ 10⁵`.

**Go.**
```go
package main

import "fmt"

func longestRepeated(s string) string {
	sa := buildSA(s)
	lcp := buildLCP(s, sa)
	bestLen, bestR := 0, 0
	for r := 1; r < len(s); r++ {
		if lcp[r] > bestLen {
			bestLen, bestR = lcp[r], r
		}
	}
	start := sa[bestR]
	return s[start : start+bestLen]
}

func main() {
	fmt.Printf("%q\n", longestRepeated("banana")) // "ana"
	fmt.Printf("%q\n", longestRepeated("abcabc")) // "abc"
	fmt.Printf("%q\n", longestRepeated("abcd"))   // ""
}
```

**Java.**
```java
public class LongestRepeated {
    static String longestRepeated(String s) {
        int[] sa = BuildSALCP.buildSA(s);
        int[] lcp = BuildSALCP.buildLCP(s, sa);
        int bestLen = 0, bestR = 0;
        for (int r = 1; r < s.length(); r++)
            if (lcp[r] > bestLen) { bestLen = lcp[r]; bestR = r; }
        int start = sa[bestR];
        return s.substring(start, start + bestLen);
    }

    public static void main(String[] args) {
        System.out.println("[" + longestRepeated("banana") + "]"); // [ana]
        System.out.println("[" + longestRepeated("abcabc") + "]"); // [abc]
        System.out.println("[" + longestRepeated("abcd") + "]");   // []
    }
}
```

**Python.**
```python
def longest_repeated(s):
    sa = build_sa(s)
    lcp = build_lcp(s, sa)
    best_len, best_r = 0, 0
    for r in range(1, len(s)):
        if lcp[r] > best_len:
            best_len, best_r = lcp[r], r
    start = sa[best_r]
    return s[start: start + best_len]


if __name__ == "__main__":
    print(repr(longest_repeated("banana")))  # 'ana'
    print(repr(longest_repeated("abcabc")))  # 'abc'
    print(repr(longest_repeated("abcd")))     # ''
```

---

### Challenge 4: Longest Common Substring of Two Strings

**Problem.** Given strings `A` and `B`, return the longest substring common to both. Concatenate `A # B`, build `SA + LCP`, and take the max LCP over adjacent suffixes from opposite sides of the separator.

**Example.**
```text
A = "banana", B = "ananas"  ->  "anana"
A = "abc",    B = "xyz"     ->  ""
```

**Constraints.** `1 ≤ |A|, |B| ≤ 5·10⁴`.

**Go.**
```go
package main

import "fmt"

func longestCommonSubstring(a, b string) string {
	sep := "\x01" // smaller than all printable chars, in neither string
	c := a + sep + b
	sa := buildSA(c)
	lcp := buildLCP(c, sa)
	na := len(a)
	bestLen, bestStart := 0, 0
	for r := 1; r < len(c); r++ {
		i, j := sa[r-1], sa[r]
		inA := func(x int) bool { return x < na }
		if inA(i) != inA(j) && lcp[r] > bestLen {
			bestLen, bestStart = lcp[r], sa[r]
		}
	}
	return c[bestStart : bestStart+bestLen]
}

func main() {
	fmt.Printf("%q\n", longestCommonSubstring("banana", "ananas")) // "anana"
	fmt.Printf("%q\n", longestCommonSubstring("abc", "xyz"))       // ""
}
```

**Java.**
```java
public class LongestCommonSubstring {
    static String lcs(String a, String b) {
        String c = a + "" + b;
        int[] sa = BuildSALCP.buildSA(c);
        int[] lcp = BuildSALCP.buildLCP(c, sa);
        int na = a.length(), bestLen = 0, bestStart = 0;
        for (int r = 1; r < c.length(); r++) {
            int i = sa[r - 1], j = sa[r];
            boolean inA_i = i < na, inA_j = j < na;
            if (inA_i != inA_j && lcp[r] > bestLen) {
                bestLen = lcp[r];
                bestStart = sa[r];
            }
        }
        return c.substring(bestStart, bestStart + bestLen);
    }

    public static void main(String[] args) {
        System.out.println("[" + lcs("banana", "ananas") + "]"); // [anana]
        System.out.println("[" + lcs("abc", "xyz") + "]");       // []
    }
}
```

**Python.**
```python
def longest_common_substring(a, b):
    sep = "\x01"  # smaller than all chars, in neither string
    c = a + sep + b
    sa = build_sa(c)
    lcp = build_lcp(c, sa)
    na = len(a)
    best_len, best_start = 0, 0
    for r in range(1, len(c)):
        i, j = sa[r - 1], sa[r]
        if (i < na) != (j < na) and lcp[r] > best_len:
            best_len, best_start = lcp[r], sa[r]
    return c[best_start: best_start + best_len]


if __name__ == "__main__":
    print(repr(longest_common_substring("banana", "ananas")))  # 'anana'
    print(repr(longest_common_substring("abc", "xyz")))         # ''
```

---

## Final Tips

- Lead with the one-liner: *"Sort all suffixes — their start indices are the suffix array; adjacent overlaps are the LCP array. Build SA in `O(n log n)`, LCP in `O(n)` with Kasai."*
- Immediately flag the gotchas: `SA` stores **positions not strings**, it is **static**, and `LCP[r]` is only the **adjacent** overlap (arbitrary pairs need RMQ).
- For search, reach for **two binary searches** bracketing the contiguous occurrence range (`O(m log n)`).
- For distinct/repeat/common-substring questions, reach for the **LCP array** (`n(n+1)/2 − Σ LCP`, `max LCP`, opposite-side concat LCP).
- Always offer to verify against a naive `O(n² log n)` oracle on small inputs, especially over a tiny alphabet.
