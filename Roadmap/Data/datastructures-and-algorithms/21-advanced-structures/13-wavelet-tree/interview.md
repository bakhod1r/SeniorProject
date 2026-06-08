# Wavelet Tree — Interview Preparation

> Tiered question bank (Junior → Middle → Senior → Professional) followed by the canonical coding challenge: **range k-th smallest via a wavelet tree**, fully solved in Go, Java, and Python. Answers are kept concise but complete enough to say out loud in an interview.

---

## How to Use This

- Read the question, attempt an answer aloud, then check against the "Expected answer" notes.
- The **bold one-liner** is the answer an interviewer wants first; the rest is the follow-up depth.
- The coding challenge at the end is the single most common wavelet-tree interview/contest task. Implement it in your strongest language first, then port.

---

## Junior Questions (What / How)

**J1. What is a wavelet tree, in one sentence?**
**A succinct structure over a sequence with alphabet `[0, σ)` that recursively splits the *alphabet* in half, storing one bitvector per node, and answers `access`, `rank`, `select`, `quantile`, and `range count` in `O(log σ)`.** The key contrast: a segment tree splits *positions*; a wavelet tree splits *values*.

**J2. What does each bit in a node's bitvector mean?**
At a node covering alphabet `[a, b)` with midpoint `m`, `B[i] = 0` means the i-th element of that node's sequence is in the lower half `[a, m)` (goes left); `B[i] = 1` means it is in the upper half `[m, b)` (goes right).

**J3. What is `rank0(B, i)` and `rank1(B, i)`?**
`rank1(B, i)` = number of `1`-bits in `B[0..i)`; `rank0(B, i) = i − rank1(B, i)`. They are the navigation primitive: a `0`-bit element at position `i` lands at position `rank0(B, i)` in the left child.

**J4. How tall is a wavelet tree and why?**
`⌈log₂ σ⌉` levels, because each level halves the alphabet range until each leaf holds a single symbol. That is why queries cost `O(log σ)`, not `O(log n)`.

**J5. How does `access(i)` work?**
Descend from the root; at each node the bit `B[i]` tells you left or right, and `rank0`/`rank1` remaps `i` into the child. After `log σ` levels the alphabet collapses to one value — that is `S[i]`. **We reconstruct the value bit by bit; we never stored it directly.**

**J6. What is `rank_c(i)`?**
The number of occurrences of symbol `c` in the prefix `S[0..i)`. You descend the path the bits of `c` dictate, remapping `i` via `rank0`/`rank1`; at `c`'s leaf, `i` is the count.

**J7. What does `quantile(l, r, k)` return?**
The `k`-th smallest value (0-indexed; `k=0` → minimum) in the range `S[l..r)`. `quantile(l, r, (r−l)/2)` is the range **median**.

**J8. Why must the per-level partition be *stable*?**
Because `rank` maps a position to its child index by counting how many same-direction elements precede it. If you reordered within a half, that count would no longer match the child's actual position, breaking every query.

**J9. What is the space of a wavelet tree?**
About `n · ⌈log₂ σ⌉` bits (one bit per element per level), plus lower-order rank overhead — essentially the raw data size. That is what "succinct" means.

**J10. Wavelet tree vs segment tree — the headline difference?**
Segment tree splits the index range and answers `O(log n)`; wavelet tree splits the alphabet and answers `O(log σ)`. For small alphabets the wavelet tree is faster and far smaller, and it does order-statistics (k-th) that a plain sum segment tree cannot.

**J11. Is a wavelet tree mutable?**
No — it is **static** by default. You rebuild to change the sequence. Dynamic variants exist but are complex and slower.

**J12. Give one real use of a wavelet tree.**
The **FM-index** for substring search in genomics/full-text — a wavelet tree over the BWT provides the `rank` in the backward-search loop.

---

## Middle Questions (Why / When)

**M1. When would you choose a wavelet tree over a merge sort tree?**
When you need **multiple** query types (rank/select/quantile/range-count), the data is static, σ is small/compressible, and you want **online** `O(log σ)` range-k-th plus much smaller space. A merge sort tree is simpler but gives `O(log² n)`–`O(log³ n)` range-k-th and uses `O(n log n)` ints.

**M2. When would you choose a persistent segment tree instead?**
When you need **versioned / "as-of-prefix"** queries, or when σ ≈ n (almost all values distinct) so the alphabet advantage vanishes. PST gives the same `O(log σ)` range-k-th plus persistence the wavelet tree lacks.

**M3. How does `quantile` decide left vs right at each level?**
Compute `cnt_left` = number of range elements in the left child (`rank0(r) − rank0(l)`). If `k < cnt_left`, the answer is among the smaller half → go left. Else subtract `cnt_left` from `k` and go right. Works because **all left values < all right values**.

**M4. How is `select_c(j)` different from `rank_c(i)`?**
`rank` walks **top-down** (map a prefix into a child via `rank`). `select` walks **bottom-up**: descend to `c`'s leaf to locate the j-th occurrence, then climb back up mapping child position → parent position via `select0`/`select1`. It is the inverse of `rank`.

**M5. How do you count elements in a value range `[lo, hi]` within `S[l..r)`?**
`countLess(l, r, hi+1) − countLess(l, r, lo)`, where `countLess` is a single `O(log σ)` descent that adds the whole left-subtree count whenever the threshold routes right (all those left values are below the threshold).

**M6. Why coordinate-compress before building?**
To make σ = number of *distinct* values, minimizing tree height (`log σ`) and total bits (`n log σ`), and to avoid wasting levels on empty alphabet ranges. Keep the inverse map to translate answer symbols back to real values.

**M7. What is the build cost and why?**
`O(n log σ)`: each of the `log σ` levels scans all `n` elements once to write a bit and stably partition.

**M8. You get the k-th value from `quantile`. How do you also get its frequency in the range for free?**
At the leaf, the carried range width `r − l` equals the count of that value in `[l, r)`. Read it off — no extra cost.

**M9. Range median over a sliding window of a static array — which structure?**
Wavelet tree: `quantile(l, r, (r−l)/2)` in `O(log σ)` per window, flat in `n`. (If the array changes, you would rebuild or use a different structure.)

**M10. Why is wavelet-tree query time "flat in n"?**
Query cost depends on `log σ`, not `log n`. Two sequences of length 1e3 and 1e6 over the same alphabet have the same per-query level count. A latency that grows with `n` signals a bug (a position-bound structure slipped in).

**M11. How would you verify a wavelet-tree implementation?**
Random-test against brute force: for `rank_c`, count occurrences directly; for `quantile`, sort the window and index `k`; for `range count`, filter and count. Test σ=1, σ=2, n=0, n=1, all-equal, all-distinct.

**M12. What's the conventions pitfall that causes most bugs?**
Mixing inclusive `[l, r]` and half-open `[l, r)`. Standardize on half-open `[l, r)` (matches `rank`'s prefix semantics) and inclusive `[lo, hi]` for value bounds; convert only at the API edge.

**M13. Range k-th *largest* from a k-th-smallest implementation?**
`quantile(l, r, (r−l)−1−k)`, or mirror the algorithm using `cnt_right` and flipping the comparison.

---

## Senior Questions (Systems / Scale)

**S1. The teaching implementation uses `int prefix[]` per node. Why is that wrong in production?**
It uses `O(n log σ)` *words* — roughly 32× the bits it should — making the structure **bigger than the raw data**, defeating succinctness. Production uses **bit-packed bitvectors** with an O(1) `rank` index (`o(n)` bits).

**S2. How do you get O(1) `rank` on a bitvector with only `o(n)` extra bits?**
A two-level (superblock/block) directory plus hardware `popcount`: superblocks (e.g. every 512 bits) store absolute ranks; per-word blocks store relative ranks; the final partial word is popcounted. ~0.25·n extra bits. This is the "rank9" layout.

**S3. What is the wavelet matrix and why prefer it?**
A reorganization storing **one contiguous bitvector per level** (instead of one per node) with a global `z_ℓ` = zero-count offset. Same `O(log σ)` queries, but far better **cache locality** (one bitvector per level, sequential), so it is the production layout. Navigation: bit-0 → `rank0`, bit-1 → `z_ℓ + rank1`.

**S4. Walk through the FM-index backward search.**
Maintain a suffix-array interval `[sp, ep)`. For each pattern char `c` from right to left: `sp = C[c] + rank_c(sp)`, `ep = C[c] + rank_c(ep)` (the `rank` is on the wavelet tree over the BWT). If `sp ≥ ep`, no match; else `ep − sp` occurrences. Cost `O(m log σ)` for a length-`m` pattern — **independent of corpus size**.

**S5. Why is `select` usually slower than `rank` in production wavelet trees?**
True O(1) `select` (Clark) is intricate; most systems use **sampled select or binary search**, accepting a slightly higher cost because `rank` dominates the inner loops (e.g., FM-index backward search). For *locate* you instead sample the suffix array.

**S6. How do you make a wavelet tree hit the entropy bound `nH₀`?**
Shape the tree like a **Huffman code** over symbol frequencies (frequent symbols → shorter paths), and/or use **RRR-compressed** bitvectors. Total bitvector length becomes the weighted path length ≈ `n(H₀+1)`; RRR pushes toward `nH₀`.

**S7. Design a service for p99 latency over arbitrary time windows on an immutable event column.**
Quantize latency into σ buckets, coordinate-compress, build a **wavelet matrix** per sealed snapshot offline. Serve `quantile(l, r, floor(0.99·(r−l)))` per window in `O(log σ)`. Architecture: append-only ingest → seal immutable snapshot → offline build/merge → atomic version swap (LSM-like lifecycle).

**S8. σ suddenly grows in production. What breaks and how do you catch it?**
Height `log σ` grows, bits `n log σ` balloon — usually because coordinate compression failed or raw values leaked in. Monitor `alphabet_size` and `bits_per_symbol`; alert on jumps. Fix by re-compressing.

**S9. Your quantile latency starts growing with data size. Diagnosis?**
A red flag — wavelet queries must be flat in `n`. Likely a position-bound structure crept in, or `rank` degraded to a linear scan (rank index not built). Benchmark a single `rank` in isolation.

**S10. Why are wavelet trees mmap-friendly for text indexes?**
They are built once, queried for years, read-only. Serialize and `mmap` the bit-packed structure so the OS page cache shares it across processes and avoids per-process heap copies.

**S11. How does a wavelet tree support 2D range counting (points in a rectangle)?**
Sort points by `x`, let position = `x`-rank and symbol = `y`-value; then "points with `x ∈ [l, r)` and `y ∈ [lo, hi]`" is exactly `rangeCount(l, r, lo, hi)` in `O(log σ)`.

**S12. Compare wavelet tree, PST, and merge sort tree on memory for n=1e6, σ=256.**
WT ≈ 1 MB (bit-packed) + ~25% rank; PST ≈ 32 MB (pointer nodes); MST ≈ 80 MB (`n log n` ints). The WT is 30–80× smaller — the reason it underlies compressed indexes.

---

## Professional Questions (Proofs / Theory)

**P1. Prove `quantile` is `O(log σ)`.**
Each iteration halves `b − a` (the alphabet width), so after `⌈log₂ σ⌉` iterations the loop exits at a leaf. Each iteration does two `rank` calls (O(1)) and O(1) bookkeeping. Hence `O(log σ)`. (Correctness is a loop-invariant argument: at each step the answer provably stays in the retained half with `k` adjusted by the skipped-smaller count.)

**P2. State and prove the Mapping Lemma.**
If element at position `i` of node `v`'s sequence has `B[i]=0`, it occupies position `rank0(B, i)` in the left child; if `B[i]=1`, position `rank1(B, i)` in the right. Proof: the left subsequence collects exactly the `0`-bit elements in order; `rank0(B, i)` counts those strictly before `i`; order preservation places the element at that index.

**P3. Prove the total bitvector length is exactly `n log σ` bits.**
At each level the nodes partition `S` by value into disjoint alphabet ranges, and every element appears in exactly one node's sequence — so the sum of bitvector lengths per level is `n`. Over `⌈log₂ σ⌉` levels: `n⌈log₂ σ⌉` bits.

**P4. Why is `n log σ` optimal (lower bound)?**
There are `σⁿ` distinct sequences over `[0,σ)`; distinguishing them needs `⌈log₂(σⁿ)⌉ = n⌈log₂ σ⌉` bits. So the dominant term is information-theoretically optimal; the `o(n log σ)` overhead is the cost of `O(log σ)` queries.

**P5. How do you achieve O(1) `rank` with `o(t)` redundancy (sketch)?**
Two-level directory: superblocks of size `log²t` store absolute ranks (`o(t)` bits total); blocks of size `(log t)/2` store relative ranks; a universal table over all `2^{(log t)/2} = √t` block patterns yields the in-block popcount in O(1). All directories sum to `o(t)` bits. (Jacobson 1989 / Clark 1996.)

**P6. What does RRR buy you?**
Raman–Raman–Rao bitvectors store `t` bits with `m` ones in `log C(t,m) + o(t)` bits — the zero-order entropy `nH₀(B) + o(t)` — while keeping O(1) `rank`/`select`. Applied per level, the wavelet tree's space tracks input entropy, enabling `nH₀(S)`-bound compressed indexes.

**P7. Prove `select_c` is correct via the rank/select inverse identity.**
For internal `v`, `rank0(B, select0(B, p+1)) = p` and the bit there is `0`. By the Mapping Lemma, `select0(B, p+1)` is the parent position of child-left position `p`. Composing these up-maps along the reversed root-to-`c` path lifts the j-th occurrence (leaf position `j−1`) to its absolute index in `S`.

**P8. Give the entropy-shaped space bound and its proof idea.**
Huffman-shaping gives `n(H₀(S)+1) + o(n log σ)` bits. The total bitvector length equals `Σᵢ depth(symbol of S[i])` = the message's total code length under the tree-defining prefix code; Huffman minimizes this with average ≤ `H₀ + 1` per symbol.

**P9. Formally separate wavelet tree from merge sort tree on range k-th.**
WT: `Θ(log σ)` with O(1) ranks per level. The MST strategy must binary-search the answer value (`Θ(log σ)` outer) and, per probe, run `upper_bound` (`Θ(log n)`) on each of `Θ(log n)` canonical nodes — `Ω(log σ · log n)` for that strategy. Hence WT is asymptotically better when σ is small.

**P10. Why can't the `o(·)` overhead be removed entirely while keeping O(1) queries?**
Cell-probe lower bounds (Pătraşcu, Golynski) show supporting `rank` and `select` in O(1) forces `Ω(t · log log t / log t)` redundancy in standard models — the `o(t)` term is provably necessary, so `(1+o(1))·n log σ` is essentially optimal for this query set.

**P11. When does the wavelet tree lose to the persistent segment tree, formally?**
When `σ = Θ(n)` (nearly all distinct), `log σ = Θ(log n)`, so both are `Θ(log n)`; then the PST's *persistence* (versioned queries) is a strictly larger capability the WT lacks — choose PST. The WT only dominates on space and rank/select.

**P12. Why does the wavelet matrix preserve correctness while flattening the tree?**
The per-level stable radix sort means level `ℓ+1`'s single bitvector is the concatenation of all level-`ℓ` children, with the `z_ℓ` zero-count as the boundary. The navigation `0 → rank0`, `1 → z_ℓ + rank1` reproduces exactly the tree's child maps (Mapping Lemma) under this concatenation, so all proofs carry over verbatim.

---

## Rapid-Fire (one-liners)

| # | Q | A |
|---|---|---|
| R1 | Query complexity? | `O(log σ)` |
| R2 | Space? | `n log σ + o(n log σ)` bits |
| R3 | Build? | `O(n log σ)` |
| R4 | Mutable? | No (static) |
| R5 | Splits what? | The alphabet (not positions) |
| R6 | Navigation primitive? | `rank0` / `rank1` on bitvectors |
| R7 | k-th smallest decision? | `k < cnt_left` → left, else `k −= cnt_left`, right |
| R8 | `select` direction? | Bottom-up (inverse of `rank`) |
| R9 | Production layout? | Wavelet **matrix** |
| R10 | Headline application? | FM-index (BWT substring search) |
| R11 | Beats MST because? | Online `O(log σ)` k-th, far less space |
| R12 | Loses to PST when? | Need persistence, or σ ≈ n |

---

## Coding Challenge — Range k-th Smallest via Wavelet Tree

> **Problem.** You are given a static array `A` of `n` integers and `q` queries. Each query is `(l, r, k)` (0-indexed, half-open `[l, r)`, `0 ≤ k < r − l`). Return the `k`-th smallest value in `A[l..r)` (`k = 0` → minimum). Values may be arbitrary integers — **coordinate-compress** first. Target `O((n + q) log σ)`.
>
> Example: `A = [1, 5, 2, 7, 5, 4, 3, 8, 9, 6]`, query `(2, 8, 3)` → subarray `[2,7,5,4,3,8]`, sorted `[2,3,4,5,7,8]`, `k=3` → **5**.

Each solution: coordinate-compress, build a wavelet tree (matrix style for Go/Java; pointer style is fine too), answer each query in `O(log σ)`, and translate the answer symbol back to the original value.

### Go

```go
package main

import (
	"fmt"
	"math/bits"
	"sort"
)

type bitVector struct {
	words []uint64
	rankS []int32
	n     int
}

func newBitVector(n int) *bitVector {
	return &bitVector{words: make([]uint64, (n+63)/64), rankS: make([]int32, (n+63)/64+1), n: n}
}
func (b *bitVector) set(i int) { b.words[i>>6] |= 1 << uint(i&63) }
func (b *bitVector) get(i int) int {
	return int((b.words[i>>6] >> uint(i&63)) & 1)
}
func (b *bitVector) build() {
	acc := int32(0)
	for w := range b.words {
		b.rankS[w] = acc
		acc += int32(bits.OnesCount64(b.words[w]))
	}
	b.rankS[len(b.words)] = acc
}
func (b *bitVector) rank1(i int) int {
	w := i >> 6
	base := int(b.rankS[w])
	if r := i & 63; r > 0 {
		base += bits.OnesCount64(b.words[w] & ((1 << uint(r)) - 1))
	}
	return base
}
func (b *bitVector) rank0(i int) int { return i - b.rank1(i) }
func (b *bitVector) zeros() int      { return b.n - int(b.rankS[len(b.words)]) }

type waveletMatrix struct {
	bv      []*bitVector
	z       []int
	bitsLen int
	n       int
}

func newWaveletMatrix(data []int, sigma int) *waveletMatrix {
	bitsLen := 1
	for (1 << bitsLen) < sigma {
		bitsLen++
	}
	if sigma <= 1 {
		bitsLen = 1
	}
	n := len(data)
	wm := &waveletMatrix{bitsLen: bitsLen, n: n, bv: make([]*bitVector, bitsLen), z: make([]int, bitsLen)}
	cur := append([]int(nil), data...)
	for level := 0; level < bitsLen; level++ {
		shift := uint(bitsLen - 1 - level)
		b := newBitVector(n)
		for i, x := range cur {
			if (x>>shift)&1 == 1 {
				b.set(i)
			}
		}
		b.build()
		wm.bv[level] = b
		wm.z[level] = b.zeros()
		next := make([]int, 0, n)
		for i, x := range cur {
			if b.get(i) == 0 {
				next = append(next, x)
			}
		}
		for i, x := range cur {
			if b.get(i) == 1 {
				next = append(next, x)
			}
		}
		cur = next
	}
	return wm
}

// quantile: k-th smallest (0-indexed) in [l, r).
func (wm *waveletMatrix) quantile(l, r, k int) int {
	val := 0
	for level := 0; level < wm.bitsLen; level++ {
		b := wm.bv[level]
		l0, r0 := b.rank0(l), b.rank0(r)
		cntLeft := r0 - l0
		if k < cntLeft {
			l, r = l0, r0
		} else {
			k -= cntLeft
			val |= 1 << uint(wm.bitsLen-1-level)
			l = wm.z[level] + (l - l0)
			r = wm.z[level] + (r - r0)
		}
	}
	return val
}

func rangeKth(A []int, queries [][3]int) []int {
	// coordinate-compress
	vals := append([]int(nil), A...)
	sort.Ints(vals)
	uniq := vals[:0]
	for i, v := range vals {
		if i == 0 || v != vals[i-1] {
			uniq = append(uniq, v)
		}
	}
	idx := func(v int) int { return sort.SearchInts(uniq, v) }
	comp := make([]int, len(A))
	for i, v := range A {
		comp[i] = idx(v)
	}
	wm := newWaveletMatrix(comp, len(uniq))
	out := make([]int, len(queries))
	for qi, q := range queries {
		sym := wm.quantile(q[0], q[1], q[2])
		out[qi] = uniq[sym] // back to original value
	}
	return out
}

func main() {
	A := []int{1, 5, 2, 7, 5, 4, 3, 8, 9, 6}
	queries := [][3]int{{2, 8, 3}, {0, 10, 0}, {0, 10, 9}, {4, 7, 1}}
	fmt.Println(rangeKth(A, queries)) // [5 1 9 4]
}
```

### Java

```java
import java.util.*;

public class RangeKth {
    static final class BitVector {
        final long[] words; final int[] rankS; final int n;
        BitVector(int n) { this.n = n; words = new long[(n + 63) >> 6]; rankS = new int[words.length + 1]; }
        void set(int i) { words[i >> 6] |= 1L << (i & 63); }
        int get(int i)  { return (int) ((words[i >> 6] >>> (i & 63)) & 1); }
        void build() {
            int acc = 0;
            for (int w = 0; w < words.length; w++) { rankS[w] = acc; acc += Long.bitCount(words[w]); }
            rankS[words.length] = acc;
        }
        int rank1(int i) {
            int w = i >> 6, base = rankS[w], r = i & 63;
            if (r > 0) base += Long.bitCount(words[w] & ((1L << r) - 1));
            return base;
        }
        int rank0(int i) { return i - rank1(i); }
        int zeros() { return n - rankS[words.length]; }
    }

    static final class WaveletMatrix {
        final BitVector[] bv; final int[] z; final int bitsLen, n;
        WaveletMatrix(int[] data, int sigma) {
            int bl = 1; while ((1 << bl) < sigma) bl++;
            bitsLen = Math.max(bl, 1); n = data.length;
            bv = new BitVector[bitsLen]; z = new int[bitsLen];
            int[] cur = data.clone();
            for (int level = 0; level < bitsLen; level++) {
                int shift = bitsLen - 1 - level;
                BitVector b = new BitVector(n);
                for (int i = 0; i < n; i++) if (((cur[i] >> shift) & 1) == 1) b.set(i);
                b.build(); bv[level] = b; z[level] = b.zeros();
                int[] next = new int[n]; int p = 0;
                for (int i = 0; i < n; i++) if (b.get(i) == 0) next[p++] = cur[i];
                for (int i = 0; i < n; i++) if (b.get(i) == 1) next[p++] = cur[i];
                cur = next;
            }
        }
        int quantile(int l, int r, int k) {
            int val = 0;
            for (int level = 0; level < bitsLen; level++) {
                BitVector b = bv[level];
                int l0 = b.rank0(l), r0 = b.rank0(r), cntLeft = r0 - l0;
                if (k < cntLeft) { l = l0; r = r0; }
                else { k -= cntLeft; val |= 1 << (bitsLen - 1 - level);
                       l = z[level] + (l - l0); r = z[level] + (r - r0); }
            }
            return val;
        }
    }

    static int[] rangeKth(int[] A, int[][] queries) {
        int[] vals = A.clone(); Arrays.sort(vals);
        int m = 0; for (int i = 0; i < vals.length; i++) if (i == 0 || vals[i] != vals[i-1]) vals[m++] = vals[i];
        int[] uniq = Arrays.copyOf(vals, m);
        int[] comp = new int[A.length];
        for (int i = 0; i < A.length; i++) {
            int lo = 0, hi = m; int v = A[i];
            while (lo < hi) { int mid = (lo + hi) >>> 1; if (uniq[mid] < v) lo = mid + 1; else hi = mid; }
            comp[i] = lo;
        }
        WaveletMatrix wm = new WaveletMatrix(comp, m);
        int[] out = new int[queries.length];
        for (int qi = 0; qi < queries.length; qi++) {
            int sym = wm.quantile(queries[qi][0], queries[qi][1], queries[qi][2]);
            out[qi] = uniq[sym];
        }
        return out;
    }

    public static void main(String[] args) {
        int[] A = {1, 5, 2, 7, 5, 4, 3, 8, 9, 6};
        int[][] queries = {{2, 8, 3}, {0, 10, 0}, {0, 10, 9}, {4, 7, 1}};
        System.out.println(Arrays.toString(rangeKth(A, queries))); // [5, 1, 9, 4]
    }
}
```

### Python

```python
import bisect


class _BitVector:
    __slots__ = ("words", "rankS", "n")

    def __init__(self, n):
        self.n = n
        self.words = [0] * ((n + 63) // 64)
        self.rankS = [0] * (len(self.words) + 1)

    def set(self, i):
        self.words[i >> 6] |= 1 << (i & 63)

    def get(self, i):
        return (self.words[i >> 6] >> (i & 63)) & 1

    def build(self):
        acc = 0
        for w in range(len(self.words)):
            self.rankS[w] = acc
            acc += self.words[w].bit_count()
        self.rankS[-1] = acc

    def rank1(self, i):
        w = i >> 6
        base = self.rankS[w]
        r = i & 63
        if r:
            base += (self.words[w] & ((1 << r) - 1)).bit_count()
        return base

    def rank0(self, i):
        return i - self.rank1(i)

    def zeros(self):
        return self.n - self.rankS[-1]


class WaveletMatrix:
    def __init__(self, data, sigma):
        bits_len = 1
        while (1 << bits_len) < sigma:
            bits_len += 1
        self.bits_len = max(bits_len, 1)
        self.n = len(data)
        self.bv = []
        self.z = []
        cur = list(data)
        for level in range(self.bits_len):
            shift = self.bits_len - 1 - level
            b = _BitVector(self.n)
            for i, x in enumerate(cur):
                if (x >> shift) & 1:
                    b.set(i)
            b.build()
            self.bv.append(b)
            self.z.append(b.zeros())
            zeros = [x for x in cur if not ((x >> shift) & 1)]
            ones = [x for x in cur if (x >> shift) & 1]
            cur = zeros + ones

    def quantile(self, l, r, k):
        val = 0
        for level in range(self.bits_len):
            b = self.bv[level]
            l0, r0 = b.rank0(l), b.rank0(r)
            cnt_left = r0 - l0
            if k < cnt_left:
                l, r = l0, r0
            else:
                k -= cnt_left
                val |= 1 << (self.bits_len - 1 - level)
                l = self.z[level] + (l - l0)
                r = self.z[level] + (r - r0)
        return val


def range_kth(A, queries):
    uniq = sorted(set(A))
    comp = [bisect.bisect_left(uniq, v) for v in A]
    wm = WaveletMatrix(comp, len(uniq))
    out = []
    for l, r, k in queries:
        sym = wm.quantile(l, r, k)
        out.append(uniq[sym])
    return out


if __name__ == "__main__":
    A = [1, 5, 2, 7, 5, 4, 3, 8, 9, 6]
    queries = [(2, 8, 3), (0, 10, 0), (0, 10, 9), (4, 7, 1)]
    print(range_kth(A, queries))  # [5, 1, 9, 4]
```

### Test cases (all three should print the same)

| Query `(l, r, k)` | Subarray `A[l..r)` | Sorted | Answer |
|---|---|---|---|
| `(2, 8, 3)` | `[2,7,5,4,3,8]` | `[2,3,4,5,7,8]` | **5** |
| `(0, 10, 0)` | whole array | min | **1** |
| `(0, 10, 9)` | whole array | max | **9** |
| `(4, 7, 1)` | `[5,4,3]` | `[3,4,5]` | **4** |

**Complexity.** Build `O(n log σ)`; each query `O(log σ)`; coordinate compression `O(n log n)` once. Total `O(n log n + (n + q) log σ)`, space `O(n log σ)` bits.

### Common interview follow-ups on this challenge
- *"Now also return how many times that k-th value appears in the range."* → at the leaf, `r − l` is the frequency (see `middle.md` `quantileWithCount`).
- *"Now support range count of values in `[lo, hi]`."* → `countLess(l, r, hi+1) − countLess(l, r, lo)`.
- *"What if the array is huge and you must minimize memory?"* → bit-packed wavelet matrix with rank9 (this code already bit-packs); discuss `n log σ` bits.
- *"What if queries are 'as of an earlier prefix'?"* → that needs persistence → persistent segment tree (`../11-persistent-segment-tree/`).

---

## Final Tips

- Lead with **"splits the alphabet, `O(log σ)`, succinct `n log σ` bits"** — it signals you know the essence.
- For range-k-th, state the **`k < cnt_left`** decision rule crisply; it is the line interviewers listen for.
- Know **one application** cold (FM-index) and **one rival trade-off** (PST = persistence, MST = simplicity).
- If asked to code, **coordinate-compress first** and use **half-open `[l, r)`** — it prevents the off-by-one bugs that sink most attempts.

**Next step:** [tasks.md](./tasks.md) — graded practice tasks (beginner, intermediate, advanced) in Go, Java, and Python.
