# Suffix Arrays and the LCP Array — Mathematical Foundations and Correctness

## Table of Contents
1. Formal Definitions
2. Correctness of Prefix Doubling
3. Complexity of Prefix Doubling with Radix Sort
4. The LCP Array and Kasai's Algorithm (Correctness Proof)
5. The "LCP Decreases by at Most 1" Lemma
6. Distinct-Substring Formula
7. Longest Repeated and Longest Common Substring
8. Correctness of Binary-Search Pattern Matching
9. LCP, RMQ, and the LCP-Interval Tree
10. Lower Bounds and Linear-Time Construction
11. Relationship to Suffix Trees and Automata
12. Summary

---

## 1. Formal Definitions

Let `s = s[0] s[1] … s[n-1]` be a string of length `n` over a totally ordered alphabet `Σ`. We write `s[i..]` for the suffix starting at index `i`, i.e. `s[i] s[i+1] … s[n-1]`.

**Definition 1.1 (Lexicographic order).** For strings `x, y`, write `x < y` if at the first index `t` where they differ `x[t] < y[t]`, or if `x` is a proper prefix of `y`. This is a total order on the set of all strings. When a sentinel `$ ∉ Σ` with `$ < c` for all `c ∈ Σ` is appended, no suffix is a prefix of another, and the order on suffixes is total without the prefix tie-break.

**Definition 1.2 (Suffix array).** The **suffix array** `SA` of `s` is the permutation of `{0, 1, …, n-1}` such that

```
s[SA[0]..] < s[SA[1]..] < … < s[SA[n-1]..].
```

That is, `SA[r]` is the starting index of the suffix of rank `r` in sorted order. `SA` is well-defined because the suffixes are pairwise distinct (they have distinct lengths, so any two differ).

**Definition 1.3 (Rank array).** The **rank** array is the inverse permutation: `rank[SA[r]] = r` and equivalently `SA[rank[i]] = i`. `rank[i]` is the sorted position of suffix `s[i..]`.

**Definition 1.4 (Longest common prefix).** For strings `x, y`, `lcp(x, y)` is the length of their longest common prefix: the largest `ℓ` with `x[0..ℓ-1] = y[0..ℓ-1]`.

**Definition 1.5 (LCP array).** The **LCP array** is defined for `r ≥ 1` by

```
LCP[r] = lcp( s[SA[r-1]..], s[SA[r]..] ),
```

the length of the longest common prefix of two **adjacent** suffixes in sorted order. By convention `LCP[0] = 0` (no predecessor).

**Definition 1.6 (k-order).** For `k ≥ 1`, define the **k-rank** of suffix `i`, denoted `rank_k[i]`, as the rank of suffix `i` when suffixes are ordered by their first `min(k, n-i)` characters, with ties (equal `k`-prefixes) sharing the same rank. `rank_0[i]` is constant; `rank_1[i]` orders by the first character. We prove prefix doubling computes `rank_{2^t}` from `rank_{2^{t-1}}`.

**Notation.** `n = |s|`, `σ = |Σ|` (alphabet size), `m` the pattern length in search, and "suffix `i`" abbreviates `s[i..]`. We use the half-open convention `[a, b)` for index ranges. The Iverson bracket `[P]` is `1` if `P` holds else `0`.

**Definition 1.7 (Substring vs suffix).** A **substring** of `s` is any contiguous block `s[i..j]`. The number of *positions* of non-empty substrings (counting repeats) is `n(n+1)/2`, since a substring is chosen by a start `i` and a length `1 ≤ ℓ ≤ n − i`. Every substring is a prefix of the suffix `s[i..]`, which is why the sorted suffixes (the suffix array) implicitly organize all substrings — the structural fact underlying every result below.

**Definition 1.8 (Occurrence).** A pattern `p` *occurs* at position `i` in `s` if `s[i..i+|p|-1] = p`, equivalently if `p` is a prefix of suffix `s[i..]`. The set of occurrence positions of `p` is exactly `{ SA[r] : r ∈ [lo, hi) }` for the contiguous rank range determined in Section 8.

---

## 2. Correctness of Prefix Doubling

Prefix doubling sorts suffixes by progressively longer prefixes whose lengths are powers of two. The central claim is that the rank after round `t` equals the order induced by the first `2^t` characters.

**Definition 2.1 (Pair key).** In round `t` (with `k = 2^{t-1}`), define for each suffix `i` the pair

```
pair_t[i] = ( rank_k[i],  rank_k[i + k] ),
```

where `rank_k[i + k] = -1` (a value smaller than every real rank) if `i + k ≥ n`, meaning the second half is empty.

**Theorem 2.2 (Doubling invariant).** Let `rank_k` order suffixes by their first `k` characters. Then ordering suffixes by `pair_t[i]` (lexicographically on the pair) orders them by their first `2k` characters; i.e. the ranks obtained by sorting the pairs equal `rank_{2k}`.

**Proof.** Fix two suffixes `i, j`. We must show `s[i..]` and `s[j..]` compare under "first `2k` characters" exactly as `pair_t[i]` and `pair_t[j]` compare lexicographically.

The first `2k` characters of suffix `i` are the concatenation of its first `k` characters (block `A_i = s[i .. i+k-1]`) and its next `k` characters (block `B_i = s[i+k .. i+2k-1]`), with missing characters past position `n` treated as the empty string (which is smallest).

*Case 1: `A_i ≠ A_j` within the first `k` characters.* Then `rank_k[i] ≠ rank_k[j]`, and since `rank_k` orders by exactly those `k` characters, `rank_k[i] < rank_k[j] ⟺ A_i < A_j ⟺ (first 2k chars of i) < (first 2k chars of j)` (the first block already decides). The pair comparison agrees because the first components differ and decide the pair.

*Case 2: `A_i = A_j` (first `k` chars equal), so `rank_k[i] = rank_k[j]`.* Then the comparison of the first `2k` characters is decided by the second blocks `B_i` vs `B_j`, i.e. by the first `k` characters of suffixes `i+k` and `j+k`. By definition `rank_k[i+k]` and `rank_k[j+k]` order *those* suffixes by their first `k` characters, so `B_i < B_j ⟺ rank_k[i+k] < rank_k[j+k]`. The empty-block convention (`-1`) correctly makes a shorter suffix's empty second block sort first, matching the prefix rule of lexicographic order. The pair comparison falls through to the second component and agrees. ∎

**Corollary 2.3 (Termination and correctness).** After `t` rounds, `rank_{2^t}` orders suffixes by their first `2^t` characters. Once `2^t ≥ n`, every suffix's "first `2^t` characters" is the whole suffix, and since suffixes are distinct, all ranks are distinct and equal the final `SA` order. Hence at most `⌈log₂ n⌉` rounds suffice, and the algorithm is correct.

**Early-stop justification.** If after some round all ranks are already distinct (`rank[SA[n-1]] = n-1`), then suffixes are fully ordered by their first `2^t` characters; further doubling cannot reorder a total order, so the loop may stop. This is correct because distinct ranks mean the prefix comparison has already separated every pair.

### 2.1 Worked Doubling Trace (`banana`)

Let `s = banana`, `n = 6`. Initial single-character ranks (`a=0, b=1, n=2`):

```
i :  0  1  2  3  4  5
s :  b  a  n  a  n  a
r0:  1  0  2  0  2  0      (rank by first 1 char)
```

Round `k = 1`, sort by pairs `(r0[i], r0[i+1])` (second `= -1` past the end):

```
i :  pair (r0[i], r0[i+1])
0 :  (1, 0)     banana
1 :  (0, 2)     anana
2 :  (2, 0)     nana
3 :  (0, 2)     ana
4 :  (2, 0)     na
5 :  (0, -1)    a
sorted pairs:  (0,-1)@5, (0,2)@1, (0,2)@3, (1,0)@0, (2,0)@2, (2,0)@4
sa  = [5, 1, 3, 0, 2, 4]
r1  : 5->0, 1->1, 3->1, 0->2, 2->3, 4->3   (ties: (0,2) shared by 1,3; (2,0) by 2,4)
r1[i] by index = [2, 1, 3, 1, 3, 0]
```

Round `k = 2`, sort by pairs `(r1[i], r1[i+2])`:

```
i :  pair (r1[i], r1[i+2])
0 :  (2, 3)    banana
1 :  (1, 1)    anana
2 :  (3, 3)    nana
3 :  (1, 0)    ana
4 :  (3, -1)   na
5 :  (0, -1)   a
sorted: (0,-1)@5, (1,0)@3, (1,1)@1, (2,3)@0, (3,-1)@4, (3,3)@2
sa  = [5, 3, 1, 0, 4, 2]
r2[i] by index = [3, 2, 5, 1, 4, 0]   (all distinct!)
```

All ranks are now distinct, so `SA = [5, 3, 1, 0, 4, 2]`, matching Definition 1.2. Two rounds (`k = 1, 2`) sufficed because `2² = 4 ≥ ⌈log₂ 6⌉`-worth of separation was reached early — the early-stop condition fired. This trace is exactly what the animation visualizes.

**Why ranks, not characters, in the comparison.** In Round `k = 2` we compared `(r1[i], r1[i+2])`, never re-reading the string. The rank `r1[i]` already encodes the full first-2-character ordering, and `r1[i+2]` encodes characters 3–4. So a single integer-pair comparison captures a 4-character comparison in `O(1)`. This is the crux of Theorem 3.1's complexity: the work per comparison is independent of `k`.

---

## 3. Complexity of Prefix Doubling with Radix Sort

**Theorem 3.1.** Prefix doubling with a stable radix (counting) sort on the pair keys runs in `O(n log n)` time and `O(n)` space.

**Proof.** There are `⌈log₂ n⌉ = O(log n)` rounds (Corollary 2.3). Each round must (a) form the pair keys, (b) sort `n` pairs, and (c) recompute ranks.

(a) and (c) are single `O(n)` passes. For (b): each pair component is an integer in `{-1, 0, …, n-1}`, a range of size `O(n)`. A **least-significant-digit radix sort** on the pair sorts first (stably) by the second component, then (stably) by the first; each pass is a counting sort over a key range of `O(n)`, costing `O(n + n) = O(n)`. Two passes per round = `O(n)`. Stability of the first pass is what guarantees the final order is lexicographic on the pair: equal first-components retain the second-component order established by the first pass.

Total: `O(log n)` rounds × `O(n)` per round = `O(n log n)`. Space: a constant number of length-`n` integer arrays = `O(n)`. ∎

**Remark (comparison-sort variant).** Replacing the radix sort with a general comparison sort costs `O(n log n)` per round (each pair comparison is `O(1)` using the precomputed ranks), giving `O(n log² n)` total — simpler to code, one log-factor slower. The `O(1)` pair comparison is the key: because we compare *ranks*, not characters, each comparison is constant time regardless of `k`. Naively comparing the actual `2k`-character prefixes would cost `O(k)` per comparison and reintroduce the quadratic blow-up.

**Remark (radix-stability is load-bearing).** If the counting sort is not stable, Case 2 of Theorem 2.2 fails: ties in the first component would not preserve the second-component order, and the resulting ranks would not equal `rank_{2k}`. Stability is a correctness requirement, not merely a performance nicety.

### 3.1 The Two-Pass Radix Argument in Detail

LSD (least-significant-digit) radix sort on the pair `(first, second)` proceeds:

```
Pass 1: stable counting sort of the suffixes by `second` key  (the less significant digit)
Pass 2: stable counting sort by `first` key                   (the more significant digit)
```

**Claim.** After Pass 2 the suffixes are ordered lexicographically by `(first, second)`.

**Proof.** Counting sort is stable, so Pass 2 orders by `first` while preserving, among equal-`first` elements, the order established by Pass 1 — which is the order by `second`. Hence equal-`first` elements end up ordered by `second`, and unequal-`first` elements by `first`. That is exactly lexicographic order on the pair. ∎

Each pass touches a key range of size `O(n)` (ranks lie in `[−1, n)`, shifted to `[0, n]`): the count array has `O(n)` buckets, the prefix-sum is `O(n)`, and the placement scan is `O(n)`. Two passes are `O(n)`. The empty-second-half sentinel must map to the smallest bucket (here `0`, with real ranks shifted by `+1`) so that a shorter suffix's missing second block sorts first, matching the prefix rule of Definition 1.1.

**Why not sort by `first` then `second`?** MSD-first (sort by `first`, then `second` within groups) also works but requires recursion or per-group sub-sorts; the LSD two-pass formulation is simpler and branch-free, which is why competitive implementations prefer it. Either is `O(n)` per round; the LSD version's flat memory access is faster in practice.

---

## 4. The LCP Array and Kasai's Algorithm (Correctness Proof)

Kasai's algorithm computes `LCP[r]` for all `r` in `O(n)` given `SA` and `rank`. It processes positions in **string order** `i = 0, 1, …, n-1`, maintaining a running length `h`.

```
KASAI(s, SA, rank):
  h := 0
  for i := 0 to n-1:
    if rank[i] > 0:
      j := SA[rank[i] - 1]            # predecessor of suffix i in sorted order
      while i+h < n and j+h < n and s[i+h] == s[j+h]:
        h := h + 1
      LCP[rank[i]] := h
      if h > 0: h := h - 1
    else:
      h := 0                          # suffix i is the smallest; no predecessor
  return LCP
```

**Theorem 4.1 (Kasai correctness).** After the loop, `LCP[r] = lcp(s[SA[r-1]..], s[SA[r]..])` for all `r ≥ 1`.

**Proof.** Consider iteration `i` with `rank[i] = r > 0` and predecessor `j = SA[r-1]`. The `while` loop extends `h` as long as `s[i+h] = s[j+h]` and both indices are in range; on exit `h` is exactly `lcp(s[i..], s[j..])`, which is `LCP[r]` by definition (suffix `i` is at rank `r`, its sorted predecessor is suffix `j`). The bounds `i+h < n` and `j+h < n` ensure no out-of-range read; lexicographic order guarantees the predecessor is well-defined. Hence every `LCP[r]` is set to its correct value exactly once (each `r ≥ 1` corresponds to exactly one `i` with `rank[i] = r`). The `if rank[i] > 0` guard skips the globally smallest suffix, which has no predecessor and correctly contributes no `LCP` entry. ∎

The non-obvious part is not *correctness* (the `while` loop plainly computes the LCP) but **linear time**, which rests on the next lemma.

**Why string order, not sorted order.** A natural-looking alternative would iterate over ranks `r = 1, 2, …` and compute each `LCP[r]` directly. That fails to amortize: consecutive ranks correspond to lexicographically adjacent suffixes whose *starting positions* in the string are unrelated, so there is no carryable quantity. Kasai's insight is to iterate over *string positions* `i`, where suffix `i+1` is suffix `i` with one character stripped — a relationship that Lemma 5.1 turns into a bounded change in `h`. The `rank` array is what lets the algorithm jump from position `i` to its sorted predecessor `SA[rank[i]-1]` in `O(1)`, marrying the two orders.

---

## 5. The "LCP Decreases by at Most 1" Lemma

**Lemma 5.1.** Let `i` be a position with `rank[i] = r > 0` and predecessor `j = SA[r-1]`, and suppose `lcp(s[i..], s[j..]) = h ≥ 1`. Then for position `i+1`, its predecessor `j' = SA[rank[i+1]-1]` satisfies `lcp(s[i+1..], s[j'..]) ≥ h - 1`.

**Proof.** Since `lcp(s[i..], s[j..]) = h ≥ 1`, the first `h` characters of suffixes `i` and `j` agree, in particular `s[i] = s[j]`. Removing the first character from both gives suffixes `i+1` and `j+1`, which therefore share a common prefix of length `h - 1`:

```
lcp(s[i+1..], s[j+1..]) = h - 1.
```

Now, `j = SA[r-1]` is the suffix immediately *less than* suffix `i`. Removing the leading (equal) character preserves order: `s[j+1..] < s[i+1..]` (because `s[j..] < s[i..]` and they share `s[i] = s[j]`, the order is decided after the first character, i.e. between `s[j+1..]` and `s[i+1..]`). So suffix `j+1` is **some** suffix smaller than suffix `i+1`. The *immediate* predecessor `j'` of suffix `i+1` is the largest suffix still smaller than `i+1`, so `s[j+1..] ≤ s[j'..] < s[i+1..]`.

Because `s[j+1..]` and `s[i+1..]` share a prefix of length `h-1`, and `s[j'..]` lies lexicographically **between** them, `s[j'..]` must also share that length-`(h-1)` prefix with `s[i+1..]` (any string sandwiched between two strings that agree on their first `h-1` characters must itself agree on those characters). Therefore `lcp(s[i+1..], s[j'..]) ≥ h - 1`. ∎

**Theorem 5.2 (Linear time).** Kasai's algorithm runs in `O(n)` time.

**Proof.** The only non-constant work per iteration is the `while` loop, which increments `h`. By Lemma 5.1, between iteration `i` and `i+1` the value of `h` decreases by at most 1 (the `if h>0: h--`). Thus across all `n` iterations the total number of decrements is at most `n`. Since `h` starts at `0`, is bounded above by `n`, and decreases at most `n` times total, the total number of *increments* (each one `while`-iteration) is at most `n + n = O(n)` (increments ≤ decrements + final value ≤ `n` + `n`). Every other operation per iteration is `O(1)`. Total `O(n)`. ∎

This amortized argument — `h` can fall by at most 1 per step, so it cannot rise more than `O(n)` times total — is the entire reason Kasai beats the obvious `O(n²)` pairwise computation. Resetting `h := 0` each iteration (a common bug) breaks Lemma 5.1's reuse and reintroduces quadratic behavior.

### 5.1 Worked Kasai Trace (`banana`)

With `SA = [5,3,1,0,4,2]`, `rank = [3,2,5,1,4,0]`, process positions `i = 0..5` in string order, carrying `h`:

```
i=0 (rank 3): pred = SA[2] = 1.  compare s[0..]=banana, s[1..]=anana
              s[0]=b != s[1]=a -> h stays 0.  LCP[3] = 0.  (h>0? no)
i=1 (rank 2): pred = SA[1] = 3.  compare s[1..]=anana, s[3..]=ana
              a=a, n=a? no after 3 chars: "ana" matches -> h grows to 3.  LCP[2] = 3.  h-- -> 2
i=2 (rank 5): pred = SA[4] = 4.  compare s[2..]=nana, s[4..]=na with h=2 start
              s[2+2]=n? s[2..]="nana", s[4..]="na": shared "na" len 2 -> h=2.  LCP[5] = 2.  h-- -> 1
i=3 (rank 1): pred = SA[0] = 5.  compare s[3..]=ana, s[5..]=a with h=1 start
              shared "a" len 1 -> h=1.  LCP[1] = 1.  h-- -> 0
i=4 (rank 4): pred = SA[3] = 0.  compare s[4..]=na, s[0..]=banana
              n != b -> h=0.  LCP[4] = 0.
i=5 (rank 0): rank == 0, no predecessor -> h = 0.  (LCP[0] stays 0)
```

Result `LCP = [0, 1, 3, 0, 0, 2]`, matching Definition 1.5. Note `h` started each comparison from its carried value (`i=2` started at `h=2`, `i=3` at `h=1`), never re-scanning from scratch — the operational realization of Lemma 5.1. The total number of character comparisons across all six positions is bounded by `2n = 12`, confirming Theorem 5.2's `O(n)`.

**Contrast with the naive `O(n²)`.** A naive LCP fill would, for each rank `r`, restart the character comparison from `h = 0`, giving worst-case `Θ(n²)` on strings like `aaaa…` where every adjacent LCP is large. Kasai's carried `h` collapses this to linear precisely because Lemma 5.1 guarantees the carried value loses at most one unit per position.

---

## 6. Distinct-Substring Formula

**Theorem 6.1.** The number of distinct (non-empty) substrings of `s` equals

```
D = n(n+1)/2 − Σ_{r=1}^{n-1} LCP[r].
```

**Proof.** Every non-empty substring of `s` is a non-empty prefix of at least one suffix. Consider the suffixes in sorted order `SA[0], …, SA[n-1]`. We count each distinct substring exactly once by attributing it to the **first** sorted suffix whose prefix it is.

Suffix `SA[r]` has length `n − SA[r]`, hence `n − SA[r]` non-empty prefixes. Of these, the ones that are *also* prefixes of the previous sorted suffix `SA[r-1]` were already attributed to an earlier suffix; there are exactly `LCP[r]` such shared prefixes (the common prefix of the two adjacent suffixes has length `LCP[r]`, contributing `LCP[r]` shared prefixes of lengths `1, …, LCP[r]`).

A key fact makes this attribution exact: because the suffixes are sorted, the prefixes that suffix `SA[r]` shares with *any* earlier suffix are exactly the prefixes it shares with its **immediate** predecessor `SA[r-1]`. (If a prefix of length `ℓ` is shared with some earlier suffix `SA[r']` with `r' < r-1`, then by sortedness every suffix between them, including `SA[r-1]`, also has that length-`ℓ` prefix; so the longest shared-with-an-earlier prefix is `LCP[r]`.) Therefore the number of **new** distinct substrings contributed by suffix `SA[r]` is

```
new(r) = (n − SA[r]) − LCP[r],
```

with `LCP[0] := 0` so suffix `SA[0]` contributes all `n − SA[0]` of its prefixes. Summing over all ranks and using that `SA` is a permutation (`Σ_r (n − SA[r]) = Σ_{ℓ=1}^{n} ℓ = n(n+1)/2`):

```
D = Σ_{r=0}^{n-1} new(r) = Σ_r (n − SA[r]) − Σ_{r=1}^{n-1} LCP[r] = n(n+1)/2 − Σ LCP[r]. ∎
```

**Worked check (`banana`, `n = 6`).** `n(n+1)/2 = 21`, `Σ LCP = 0+1+3+0+0+2 = 6`, so `D = 15`. Direct enumeration of the distinct substrings of `banana` (`a, b, n, an, ba, na, ana, ban, nan, anan, bana, nana, banan, anana, banana`) yields exactly 15. ✓

**Corollary 6.2 (distinct substrings of a given length).** Extending the same attribution, the number of distinct substrings of *exactly* length `ℓ` equals the number of ranks `r` with `(n − SA[r]) ≥ ℓ > LCP[r]` — i.e. ranks whose suffix is long enough to have a length-`ℓ` prefix that is *new* (longer than the shared `LCP[r]`). Summing this indicator over `r` gives the per-length distinct count in `O(n)` per length, or all lengths at once with a difference array. This refines Theorem 6.1 from a total to a length-resolved distribution, useful for "how many distinct substrings of length ≤ L" queries.

**Corollary 6.3 (k-th smallest distinct substring).** Walking ranks in increasing order, suffix `SA[r]` introduces its new prefixes (lengths `LCP[r]+1 … n−SA[r]`) in increasing length, and these are lexicographically larger than everything introduced before (sortedness). Accumulating the per-rank new-count `(n − SA[r]) − LCP[r]` until it reaches `k` locates the rank, and the residual offset gives the exact length; the answer is that prefix of `s[SA[r]..]`. This is the formal justification of Task 11 in [`tasks.md`](./tasks.md), correct in `O(n)` after `SA + LCP`.

---

## 7. Longest Repeated and Longest Common Substring

**Theorem 7.1 (Longest repeated substring).** The length of the longest substring of `s` that occurs at least twice equals `max_{r≥1} LCP[r]`, and the substring itself is the first `LCP[r*]` characters of suffix `SA[r*]` where `r* = argmax LCP[r]`.

**Proof.** A substring `w` repeats iff it is a common prefix of two distinct suffixes, i.e. `|w| ≤ lcp(s[a..], s[b..])` for two ranks `a < b`. We claim the maximum of `lcp(s[SA[a]..], s[SA[b]..])` over all pairs `a < b` is attained by an **adjacent** pair (`b = a+1`). Indeed, for any `a < b`,

```
lcp(s[SA[a]..], s[SA[b]..]) = min_{a < r ≤ b} LCP[r]   (Theorem 9.1 below)
                            ≤ LCP[a+1].
```

So no non-adjacent pair has a larger LCP than some adjacent pair lying inside it. Hence the maximum repeated-prefix length over all pairs equals `max_r LCP[r]`, achieved at the adjacent pair `(r*-1, r*)`. The repeated substring is the shared prefix of suffixes `SA[r*-1]` and `SA[r*]`, i.e. the first `LCP[r*]` characters of either, e.g. `s[SA[r*] .. SA[r*]+LCP[r*]-1]`. ∎

**Theorem 7.2 (Longest common substring of two strings).** Let `A, B` be strings and `#` a separator with `# ∉ A, # ∉ B` and `#` smaller than every character of `A, B`. Build `SA` and `LCP` of `C = A # B`. Then the length of the longest common substring of `A` and `B` is

```
max { LCP[r] : suffix SA[r-1] and suffix SA[r] start on opposite sides of the # }.
```

**Proof.** A common substring `w` of `A` and `B` is a prefix of some suffix of `C` beginning in `A` *and* a prefix of some suffix beginning in `B`. The separator `#` (absent from both and smaller than all characters) guarantees that a common prefix of an `A`-side and a `B`-side suffix cannot cross the separator: it terminates at or before the `#`, hence lies entirely within `A` and within `B`, so it is a genuine common substring. By the same adjacency argument as Theorem 7.1, the maximum LCP between an `A`-side suffix and a `B`-side suffix over *all* such pairs is attained at an **adjacent** sorted pair whose two members lie on opposite sides (a non-adjacent opposite-side pair `(a, b)` has `lcp = min_{a<r≤b} LCP[r] ≤ LCP[r']` for some adjacent opposite-side pair inside it, because between any two opposite-side suffixes there is an adjacent opposite-side transition). Therefore scanning adjacent pairs and taking the maximum `LCP[r]` over opposite-side pairs gives the answer. ∎

The "opposite sides" condition is essential: an adjacent pair on the *same* side measures a repeat *within* one string, not a *common* substring.

### 7.1 Worked Longest-Common-Substring Trace (`A = "ab"`, `B = "bab"`)

Build `C = "ab" + # + "bab"` with `#` smaller than all letters. The suffixes of `C` (indices `0..5`, with `#` at index 2):

```
idx 0: ab#bab        (A-side)
idx 1: b#bab         (A-side)
idx 2: #bab          (separator)
idx 3: bab           (B-side)
idx 4: ab            (B-side)
idx 5: b             (B-side)
```

Sorting (with `#` smallest):

```
rank 0: #bab     (idx 2, sep)
rank 1: ab       (idx 4, B)
rank 2: ab#bab   (idx 0, A)
rank 3: b        (idx 5, B)
rank 4: b#bab    (idx 1, A)
rank 5: bab      (idx 3, B)
LCP   : [0, 0, 2, 0, 1, 1]
```

Now scan adjacent pairs for *opposite-side* matches (A-side iff idx `< len(A) = 2`):

```
r=1 (B idx4) vs r=2 (A idx0): opposite!  LCP=2 -> candidate "ab"
r=4 (A idx1) vs r=5 (B idx3): opposite!  LCP=1 -> candidate "b"
r=3 (B idx5) vs r=4 (A idx1): opposite!  LCP=0
```

Maximum opposite-side LCP is `2`, giving the longest common substring `"ab"` (it appears in `A = "**ab**"` and in `B = "b**ab**"`). The same-side pair at `r=2/r=3` is skipped — it would measure a repeat within one string, not a common substring. ∎ (worked instance of Theorem 7.2)

**Why a non-distinct separator would fail.** If `#` were replaced by, say, `a`, then a "common prefix" of an A-side and B-side suffix could run *across* the boundary into the other string's content, reporting a substring that does not actually occur in both. The separator being absent and smallest guarantees any cross-boundary common prefix terminates at the separator, confining matches to genuine common substrings.

---

## 8. Correctness of Binary-Search Pattern Matching

**Theorem 8.1.** The suffixes of `s` that have pattern `p` (length `m`) as a prefix occupy a contiguous range `[lo, hi)` of ranks in `SA`, where

```
lo = min { r : s[SA[r] .. SA[r]+m-1] ≥ p },
hi = min { r : s[SA[r] .. SA[r]+m-1] > p } (compared as length-≤m prefixes).
```

Both bounds are found by binary search in `O(m log n)`; the occurrences are `{ SA[r] : lo ≤ r < hi }`.

**Proof.** Define the key `key(r) = s[SA[r] .. min(SA[r]+m, n) - 1]`, the length-(≤`m`) prefix of suffix `SA[r]`. Because `SA` lists suffixes in lexicographic order, the sequence `key(0), key(1), …` is **non-decreasing** (truncating sorted strings to a common length preserves order). A pattern `p` is a prefix of suffix `SA[r]` iff `key(r) = p` (its length-`m` prefix equals `p`), and since `key` is monotone, the set `{ r : key(r) = p }` is a contiguous interval. `lo` is the first index where `key(r) ≥ p` (the interval's left end, since everything before is `< p`); `hi` is the first index where `key(r) > p` (one past the interval's right end). Monotonicity makes both computable by binary search; each comparison inspects at most `m` characters, and there are `O(log n)` of them, giving `O(m log n)`. The matching suffixes' start positions are `SA[lo], …, SA[hi-1]`. ∎

**Refinement to `O(m + log n)`.** Maintaining `lcp(p, key(lo))` and `lcp(p, key(hi))` across the binary search (the Manber-Myers technique) avoids re-comparing already-matched prefix characters, reducing the total character comparisons to `O(m + log n)`. Correctness follows because the cached LCP values lower-bound how many characters can be skipped without changing the comparison outcome.

### 8.1 Worked Search Trace (`p = "ana"` in `banana`)

With `SA = [5, 3, 1, 0, 4, 2]` and the corresponding sorted suffixes:

```
rank 0: a        (idx 5)
rank 1: ana      (idx 3)
rank 2: anana    (idx 1)
rank 3: banana   (idx 0)
rank 4: na       (idx 4)
rank 5: nana     (idx 2)
```

**Lower bound** (first suffix whose length-3 prefix `≥ "ana"`):

```
[lo,hi)=[0,6) mid=3 -> "ban" >= "ana"? yes -> hi=3
[0,3) mid=1 -> "ana" >= "ana"? yes -> hi=1
[0,1) mid=0 -> "a"   >= "ana"? "a" < "ana" (shorter prefix of "ana") -> lo=1
lo = 1
```

**Upper bound** (first suffix whose length-3 prefix `> "ana"`):

```
[lo,hi)=[0,6) mid=3 -> "ban" > "ana"? yes -> hi=3
[0,3) mid=1 -> "ana" > "ana"? no (equal) -> lo=2
[2,3) mid=2 -> "ana" (from "anana") > "ana"? no (equal) -> lo=3
hi = 3
```

Range `[1, 3)` covers ranks 1 and 2 — suffixes `ana`(idx 3) and `anana`(idx 1), both starting with `ana`. So `"ana"` occurs **twice**, at positions `SA[1] = 3` and `SA[2] = 1`. This matches direct inspection (`b**ana**na` at index 1 via `anana`, and `ban**ana**` at index 3). The occurrence count is the range width `hi − lo = 2`, computed in `O(m log n)` character work. ∎ (as a worked instance of Theorem 8.1)

**Boundary subtlety.** The comparison truncates each suffix to `min(SA[r]+m, n)` characters. The suffix `a`(idx 5) of length 1 compares as `"a" < "ana"` because `"a"` is a proper prefix of `"ana"` (Definition 1.1's prefix rule), correctly placing it *before* the match range. Mishandling the truncation — e.g. comparing the full suffix `"a"` against the full pattern `"ana"` but treating shorter-as-larger — is the classic search bug; the prefix rule of lexicographic order resolves it cleanly.

---

## 9. LCP, RMQ, and the LCP-Interval Tree

**Theorem 9.1 (LCP of arbitrary suffixes).** For ranks `a < b`,

```
lcp( s[SA[a]..], s[SA[b]..] ) = min_{a < r ≤ b} LCP[r].
```

**Proof.** Let `M = min_{a < r ≤ b} LCP[r]`. *(≥ M):* every adjacent pair in `[a, b]` shares at least `M` characters, and "shares a prefix of length `M`" is transitive across the chain `SA[a], SA[a+1], …, SA[b]` (all consecutive members agree on their first `M` characters, hence so do the endpoints). So `lcp(SA[a], SA[b]) ≥ M`. *(≤ M):* let the minimum be achieved at index `r₀ ∈ (a, b]`, so `LCP[r₀] = M`. Suffixes `SA[r₀-1]` and `SA[r₀]` agree on exactly `M` characters and **differ** at position `M`. Since `SA[a] ≤ SA[r₀-1] < SA[r₀] ≤ SA[b]` in sorted order and the order is decided at position `M` between `r₀-1` and `r₀`, suffixes `SA[a]` and `SA[b]` cannot agree beyond position `M` (they straddle that decisive difference). So `lcp(SA[a], SA[b]) ≤ M`. ∎

**Corollary 9.2 (O(1) LCP queries).** Build a sparse-table range-minimum structure over `LCP` in `O(n log n)` preprocessing; then `lcp(s[SA[a]..], s[SA[b]..])` is one `O(1)` range-minimum query. This is the algebraic basis for matching statistics and constrained-repeat queries.

**Worked LCP-RMQ example (`banana`).** `LCP = [0, 1, 3, 0, 0, 2]`. The LCP of the suffixes at ranks `1` (`ana`, idx 3) and `2` (`anana`, idx 1) is `min LCP[2..2] = 3` — they share `ana`. The LCP of ranks `1` (`ana`) and `5` (`nana`, idx 2) is `min LCP[2..5] = min(3,0,0,2) = 0` — no common prefix (`a…` vs `n…`). Direct comparison confirms both. The range minimum being driven to `0` by the `LCP[3]=0` boundary between `anana` and `banana` is the algebraic encoding of "these suffixes diverge in their first character."

**LCP-interval tree.** An **LCP-interval** of value `ℓ` is a maximal range `[a, b]` with `LCP[a] < ℓ`, `LCP[b+1] < ℓ`, `min_{a<r≤b} LCP[r] = ℓ`. These intervals, nested by containment, are in bijection with the **internal nodes of the suffix tree** of `s`; a single `O(n)` stack scan of the LCP array enumerates them. This is the formal sense in which `SA + LCP` *is* the suffix tree, flattened into arrays (the enhanced suffix array).

**The O(n) stack-scan for intervals.** Process ranks left to right maintaining a stack of open intervals keyed by LCP value; when `LCP[r]` is smaller than the stack top, pop and close intervals (emitting suffix-tree internal nodes), then push the new value. Each rank is pushed and popped at most once, so the scan is `O(n)`. This is the array-based replacement for an explicit suffix-tree DFS and underlies enhanced-suffix-array algorithms for repeats, maximal repeats, and supermaximal repeats.

**Worked interval (`banana`).** With `LCP = [0,1,3,0,0,2]`, the interval `[1, 2]` has minimum LCP `3` (suffixes `ana`, `anana`) — it corresponds to the suffix-tree internal node spelling `ana`, the longest repeated substring. The interval `[1, 5]` (everything starting with `a` or `n`... actually `[1,2]` for the `a`-branch) shows how nested intervals mirror the tree's nesting. The local minimum `LCP[5]=2` opens the interval for the repeated `na`. Enumerating these by the stack scan reconstructs `banana`'s suffix-tree branching without ever allocating a tree node.

---

## 10. Lower Bounds and Linear-Time Construction

**Sorting lower bound.** Constructing `SA` sorts the `n` suffixes; in the comparison model, sorting `n` items needs `Ω(n log n)` comparisons. But suffixes are not arbitrary items — they share structure — so this bound does **not** preclude linear *character-based* construction.

**Why the comparison bound does not bind.** The `Ω(n log n)` decision-tree bound assumes each comparison yields one bit about an arbitrary permutation. Suffixes overlap: comparing `s[i..]` and `s[j..]` at the first differing character simultaneously constrains the order of *many* suffix pairs (all those sharing the same prefix). This shared information lets character-based algorithms extract more than one bit of order per character examined, evading the comparison lower bound. The genuine lower bound for SA construction is `Ω(n)` (you must read the input), and SA-IS/DC3 match it for integer alphabets.

**Theorem 10.1 (Linear-time construction exists).** `SA` can be built in `O(n)` time for an integer alphabet of size `O(n)`.

**Proof (by algorithm).** SA-IS (Nong-Zhang-Chan 2009) and DC3/Skew (Kärkkäinen-Sanders 2003) both achieve `O(n)`. DC3's recurrence is `T(n) = T(⌈2n/3⌉) + O(n) = O(n)` (master theorem, since `2/3 < 1` and the non-recursive work is linear): it sorts the `mod-3 ∈ {1,2}` suffixes via recursion on a `2n/3`-length reduced string, sorts the `mod-3 = 0` suffixes by one radix pass using those ranks, and merges with `O(1)`-character comparisons enabled by the difference-cover property. SA-IS's recurrence is `T(n) = T(n/2) + O(n) = O(n)` because the recursive call is on the LMS-substring-named string of length `≤ n/2`, and the induced-sort step (two linear bucket scans) is `O(n)`. ∎

The induced-sorting principle underlying SA-IS: given the sorted order of the LMS suffixes, the order of all L-type suffixes is determined by a single left-to-right bucket scan, and the order of all S-type suffixes by a single right-to-left scan — each scan places a suffix using the already-placed suffix one position to its right/left in the text. The correctness of this induction is the technical heart of the linear bound; see Section 2 of `senior.md` for the operational description.

**LCP in linear time.** Kasai (Theorem 5.2) builds the LCP array in `O(n)` given `SA` and `rank`, so the full `SA + LCP` package is `O(n)` for an integer alphabet.

### 10.1 The Difference-Cover Property (DC3)

DC3's merge step needs to compare a `mod-3 = 0` suffix against a `mod-3 ∈ {1,2}` suffix in `O(1)`. The trick is the **difference cover** `{1, 2}` modulo 3: for any two positions `i, j`, there is a small shift `δ ∈ {0, 1, 2}` such that both `i + δ` and `j + δ` fall in the "sampled" classes `{1, 2}` whose ranks are already known from the recursion. Concretely, to compare suffix `i` (class 0) with suffix `j` (class 1 or 2), compare at most 1–2 raw characters until both shifted positions are sampled, then break the tie with the precomputed ranks. Because the cover guarantees a bounded `δ`, each comparison is `O(1)`, making the merge `O(n)`.

**Theorem 10.2 (DC3 merge correctness).** Using the difference cover `{1, 2} mod 3`, any two suffixes can be compared in `O(1)` given the ranks of the sampled suffixes, so the three-way merge runs in `O(n)`.

**Proof sketch.** For positions `i ≡ 0` and `j ≡ 1 (mod 3)`: shifting by `δ = 1` makes `i + 1 ≡ 1` and `j + 1 ≡ 2`, both sampled. Comparing `s[i]` vs `s[j]` (one character) and, on tie, the sampled ranks of `i+1` vs `j+1` decides the order. The `i ≡ 0, j ≡ 2` case uses `δ = 2` similarly (compare two characters then sampled ranks). The cover `{1, 2}` is chosen precisely so that some bounded shift lands both indices in the sampled set; this is the defining "difference cover" condition. ∎

This is the conceptual counterpart to SA-IS's induced sorting: both achieve `O(n)` by ensuring each comparison/placement uses already-computed order information rather than re-scanning characters, just via different combinatorial mechanisms (difference covers vs S/L induction).

---

## 11. Relationship to Suffix Trees and Automata

**Suffix tree ≅ SA + LCP.** The suffix tree of `s` (sibling `13-suffix-tree-ukkonen`) has its leaves, read left to right, in suffix-array order, and its internal nodes correspond to LCP-intervals (Section 9). Thus a depth-first traversal of the suffix tree visits leaves in `SA` order, and the branching depth at each internal node is the corresponding LCP value. Any suffix-tree algorithm can be reformulated over `SA + LCP + RMQ` with the same `O(n)` space but array (not pointer) access — the enhanced suffix array of Abouelhoda-Kurtz-Ohlebusch.

**Suffix automaton (sibling `12-suffix-automaton`).** The suffix automaton (DAWG) recognizes all substrings of `s` with `O(n)` states. Its number of distinct substrings equals `Σ_state (len(state) − len(link(state)))`, which is an independent derivation of the same distinct-substring count `n(n+1)/2 − Σ LCP` from Theorem 6.1 — two structures, one combinatorial invariant. The automaton is online-constructible (append a character in amortized `O(1)`), whereas the suffix array is inherently static; this is the structural reason to prefer the automaton when the string grows.

**Counting equivalence.** All three structures encode the same object — the set of substrings of `s` — and therefore agree on every substring-counting quantity. They differ in *access pattern* (array vs pointer vs automaton transition), *construction model* (offline sort vs online), and *memory constant*, which is what drives the engineering choice rather than asymptotics.

### 11.1 The Suffix Array as the Sorted Leaves of the Suffix Tree

**Proposition 11.1.** Let `T` be the suffix tree of `s` (with leaf `ℓ_i` representing suffix `s[i..]`), where each node's children are ordered by their first edge character. Then a left-to-right depth-first traversal of `T` visits the leaves in the order `ℓ_{SA[0]}, ℓ_{SA[1]}, …, ℓ_{SA[n-1]}`.

**Proof.** In a suffix tree with children ordered by edge label, the root-to-leaf path spells the suffix, and the left-to-right order of leaves is exactly the lexicographic order of the path-labels — i.e. of the suffixes. The suffix at leaf visited at position `r` is therefore the `r`-th smallest suffix, whose start index is `SA[r]` by Definition 1.2. ∎

**Proposition 11.2 (Internal-node string depth = LCP minimum).** The string depth of the lowest common ancestor of leaves `ℓ_{SA[a]}` and `ℓ_{SA[b]}` (for `a < b`) equals `lcp(s[SA[a]..], s[SA[b]..]) = min LCP[a+1..b]` (Theorem 9.1). Thus the suffix tree's internal-node depths are precisely the LCP-array range-minima, and the tree's branching structure is the Cartesian tree of the LCP array.

**Corollary 11.3.** Building the Cartesian tree of the `LCP` array in `O(n)` yields the suffix tree's topology (without explicit edge strings) directly from `SA + LCP`. This is the formal bridge between the array representation and the tree representation: same information, two layouts.

### 11.2 Distinct-Substring Count: Three Derivations Agree

The distinct-substring count is a single integer computable from any of the three structures, and the three formulas are provably equal:

| Structure | Formula | Reason |
|-----------|---------|--------|
| Suffix array | `n(n+1)/2 − Σ LCP` | Theorem 6.1 |
| Suffix tree | `Σ_edges (edge string length)` | each substring = a unique tree position |
| Suffix automaton | `Σ_states (len(v) − len(link(v)))` | each state's endpos-class contributes its length range |

**Proposition 11.4.** All three equal the number of distinct substrings `D`.

**Proof sketch.** Each non-empty substring corresponds to a unique *position* in the suffix tree (a node or a point along an edge), so the total edge-string length counts them exactly. The suffix automaton's state `v` represents all substrings whose end-position set equals `v`'s, contributing the `len(v) − len(link(v))` distinct lengths in its equivalence class; summing over states counts each substring once. The suffix-array formula counts each substring at the first sorted suffix where it appears as a prefix (Theorem 6.1). Three different countings of the same set must coincide. ∎

For `banana`: the array gives `21 − 6 = 15`; the suffix tree of `banana$` has edge-label lengths summing (over the non-sentinel substrings) to `15`; the suffix automaton's `Σ(len − link.len)` is `15`. The agreement is a useful cross-check when implementing any of the three.

### 11.3 When the Equivalence Breaks in Practice

Although the structures are information-theoretically equivalent for *static* counting, they diverge sharply on **dynamics** and **access cost**:

- The suffix automaton admits *online* extension (append a character, amortized `O(1)`); the suffix array does not, because inserting a new suffix can reorder the whole array.
- The suffix tree gives `O(m)` search via direct child navigation; the suffix array gives `O(m log n)` (or `O(m + log n)` with the Manber-Myers LCP refinement) because it must binary-search.
- The suffix array's `O(n)` integers with unit-stride access dominate on real hardware (cache, prefetch) despite the suffix tree's better search asymptotics — the constant factor, not the `O`, decides for most workloads.

These practical divergences, not the asymptotic equivalence, are what a senior engineer reasons about when choosing a structure; the theory here certifies *correctness* of any choice, while `senior.md` weighs the *engineering* trade-offs.

---

## 12. Summary

- **Definitions.** `SA` is the permutation sorting suffixes lexicographically; `rank` is its inverse; `LCP[r]` is the longest common prefix of adjacent sorted suffixes `SA[r-1], SA[r]`.
- **Prefix doubling correctness** (Theorem 2.2): ordering by the pair `(rank_k[i], rank_k[i+k])` equals ordering by the first `2k` characters; `⌈log₂ n⌉` rounds reach the full order. The `O(1)` comparison of *ranks* (not characters) is what avoids quadratic blow-up.
- **Complexity** (Theorem 3.1): with a **stable** two-pass radix sort per round, prefix doubling is `O(n log n)` time, `O(n)` space; stability is a correctness requirement, not just a speed trick.
- **Kasai** (Theorems 4.1, 5.2): computes `LCP` in `O(n)`; correctness is immediate, linearity rests on Lemma 5.1 — *the LCP decreases by at most 1* as the starting position advances, so `h` rises at most `O(n)` times total.
- **Distinct substrings** (Theorem 6.1): `D = n(n+1)/2 − Σ LCP`, because suffix `SA[r]` contributes `(n − SA[r]) − LCP[r]` new prefixes and `Σ(n − SA[r]) = n(n+1)/2`.
- **Longest repeated** (Theorem 7.1) is `max LCP`; **longest common substring** of two strings (Theorem 7.2) is the max LCP over adjacent opposite-side suffixes of `A # B` — both rely on the adjacency property `lcp(SA[a], SA[b]) = min LCP[a+1..b]`.
- **Search** (Theorem 8.1): matching suffixes form a contiguous rank range found by two binary searches in `O(m log n)`, refinable to `O(m + log n)` with cached LCP.
- **RMQ on LCP** (Theorem 9.1): `lcp(SA[a], SA[b]) = min LCP[a+1..b]`, giving `O(1)` arbitrary-pair LCP after `O(n log n)` sparse-table build; LCP-intervals are the suffix tree's internal nodes.
- **Linear construction** (Theorem 10.1): SA-IS (`T(n)=T(n/2)+O(n)`) and DC3 (`T(n)=T(2n/3)+O(n)`) achieve `O(n)` for integer alphabets, beating the comparison-sort `Ω(n log n)` by exploiting shared suffix structure via induced sorting / difference covers.

### Theorem Reference Table

| Result | Statement | Cost |
|--------|-----------|------|
| Doubling invariant (2.2) | pair-sort by ranks ⇒ order by `2k` chars | `O(1)` per comparison |
| Doubling complexity (3.1) | radix doubling builds `SA` | `O(n log n)` |
| Kasai correctness (4.1) | computes adjacent LCPs | — |
| LCP-drop lemma (5.1) | LCP falls by ≤ 1 per position | enables `O(n)` Kasai |
| Distinct substrings (6.1) | `n(n+1)/2 − Σ LCP` | `O(n)` |
| Longest repeated (7.1) | `max LCP` | `O(n)` |
| Longest common substring (7.2) | max opposite-side LCP of `A#B` | `O(\|A\|+\|B\|)` |
| Search range (8.1) | contiguous rank interval | `O(m log n)` |
| Arbitrary LCP (9.1) | `min LCP[a+1..b]` | `O(1)` after `O(n log n)` |
| Linear construction (10.1) | SA-IS / DC3 | `O(n)` |
| DC3 merge (10.2) | difference-cover `O(1)` compare | `O(n)` merge |
| LCP-interval enumeration (9) | stack scan = suffix-tree nodes | `O(n)` |

### Invariants Worth Memorizing

These compact identities are the practical distillation of the theory and recur in every implementation and proof:

```
rank[SA[r]] = r           and      SA[rank[i]] = i        (inverse permutation)
LCP[r] = lcp(SA[r-1], SA[r])                              (adjacent overlap)
lcp(SA[a], SA[b]) = min LCP[a+1 .. b]   (a < b)           (arbitrary pair via RMQ)
distinct substrings = n(n+1)/2 - Σ LCP                    (Theorem 6.1)
longest repeated = max LCP                                (Theorem 7.1)
new substrings at rank r = (n - SA[r]) - LCP[r]           (per-rank contribution)
occurrences of p = [lo, hi) contiguous rank range         (Theorem 8.1)
```

Each is proven above; together they let you derive almost every suffix-array query by composition, without re-deriving from suffixes. The single most error-prone of these in code is the arbitrary-pair LCP range `[a+1, b]` (note the `+1`), whose off-by-one is the subject of `senior.md` §9.10.

### Worked-Example Index

Every proof above is anchored by a concrete trace on a small string, so the abstract claims can be checked by hand:

- **Doubling** (§2.1): `banana` → `SA = [5,3,1,0,4,2]` in two rounds, showing rank-pair comparison.
- **Kasai** (§5.1): `banana` → `LCP = [0,1,3,0,0,2]` with the carried `h` traced position by position.
- **Distinct substrings** (§6): `banana` → `21 − 6 = 15`, enumerated to confirm.
- **Longest common substring** (§7.1): `ab` / `bab` → `"ab"` via opposite-side LCP.
- **Binary search** (§8.1): `"ana"` in `banana` → range `[1,3)`, two occurrences.
- **LCP-RMQ** (§9): `lcp(ana, nana) = 0`, `lcp(ana, anana) = 3` via range minimum.
- **LCP-interval** (§9): interval `[1,2]` with value `3` = the `ana` internal node.

Reproducing these by hand (or against the `naive_sa` / `naive_lcp` oracles in [`tasks.md`](./tasks.md)) is the fastest way to internalize the theory and to validate an implementation.

Foundational references: Manber-Myers (1990, suffix arrays + `O(m+log n)` search); Kasai-Lee-Arimura-Arikawa-Park (2001, linear LCP); Kärkkäinen-Sanders (2003, DC3/Skew); Nong-Zhang-Chan (2009, SA-IS); Abouelhoda-Kurtz-Ohlebusch (2004, enhanced suffix arrays); Gusfield (*Algorithms on Strings, Trees, and Sequences*). Sibling topics: `10-burrows-wheeler-transform`, `12-suffix-automaton`, `13-suffix-tree-ukkonen`.
