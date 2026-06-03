# Huffman Coding — Mathematical Foundations and Complexity Theory

## Table of Contents

1. [Formal Definitions — Codes, Prefix-Freeness, Kraft](#1-formal-definitions--codes-prefix-freeness-kraft)
2. [The Optimality Theorem (statement)](#2-the-optimality-theorem-statement)
3. [Proof of Optimality — Exchange Argument + Induction](#3-proof-of-optimality--exchange-argument--induction)
4. [The Kraft–McMillan Inequality](#4-the-kraftmcmillan-inequality)
5. [Shannon Entropy and the Source-Coding Lower Bound](#5-shannon-entropy-and-the-source-coding-lower-bound)
6. [How Close Huffman Gets: H ≤ L < H + 1](#6-how-close-huffman-gets-h--l--h--1)
7. [Length-Limited Codes — Package-Merge Correctness](#7-length-limited-codes--package-merge-correctness)
8. [k-ary Huffman and the Count Condition](#8-k-ary-huffman-and-the-count-condition)
9. [Complexity Analysis](#9-complexity-analysis)
10. [Comparison with Arithmetic Coding, ANS, Shannon–Fano, Hu–Tucker](#10-comparison-with-arithmetic-coding-and-ans)
11. [Open Directions and Summary](#11-open-directions-and-summary)
12. [Reference Code (Optimality Verifier + Entropy)](#12-reference-code-optimality-verifier--entropy)

---

## 1. Formal Definitions — Codes, Prefix-Freeness, Kraft

Let the source alphabet be `S = {s₁, …, s_n}` with positive weights (frequencies or probabilities) `w₁, …, w_n`, `w_i > 0`. A **binary code** is a map `C : S → {0,1}*` assigning each symbol a finite binary string `C(sᵢ)` of length `ℓᵢ = |C(sᵢ)|`.

**Definitions.**

- `C` is **prefix-free** (a *prefix code*) iff no codeword is a prefix of another: for `i ≠ j`, `C(sᵢ)` is not a prefix of `C(sⱼ)`.
- `C` is **uniquely decodable** iff the induced map on concatenations `S* → {0,1}*` is injective. Every prefix-free code is uniquely decodable (decode greedily left to right).
- The **weighted path length** (a.k.a. cost, total code length) is
  ```
  L(C) = Σᵢ wᵢ · ℓᵢ.
  ```
  If `wᵢ` are probabilities (`Σ wᵢ = 1`), `L(C)` is the **average codeword length**.

A prefix code corresponds bijectively to a **binary tree** with the `n` symbols at its leaves: the codeword `C(sᵢ)` is the sequence of left(`0`)/right(`1`) edges from root to leaf `sᵢ`, so `ℓᵢ = depth(sᵢ)`. Thus

```
L(C) = Σᵢ wᵢ · depth(sᵢ)   = the weighted external path length of the tree.
```

**Optimal code.** `C*` is **optimal** for `(S, w)` iff `L(C*) ≤ L(C)` for every prefix code `C` over `S`. We may restrict attention to **full** binary trees (every internal node has two children): a unary internal node could be contracted to shorten a codeword, never increasing cost.

---

## 2. The Optimality Theorem (statement)

> **Theorem (Huffman, 1952).** The greedy algorithm — repeatedly replace the two minimum-weight symbols `x, y` by a single symbol `z` with weight `w(z) = w(x) + w(y)`, recurse, then split `z` back into the pair `(x, y)` as children — produces a prefix code of **minimum** weighted path length `L`. Equivalently, the Huffman tree minimizes `Σᵢ wᵢ · depth(sᵢ)` over all binary trees with the `n` symbols at the leaves.

Two structural facts drive the proof:

- **(A) Greedy-choice property.** There exists an optimal tree in which the two minimum-weight symbols are sibling leaves of **maximum depth**.
- **(B) Optimal substructure.** Merging `x, y` into `z` yields an instance of size `n − 1` whose optimal solution, expanded, is optimal for the size-`n` instance.

---

## 3. Proof of Optimality — Exchange Argument + Induction

### 3.1 Lemma A (greedy choice)

Let `x, y` be two symbols of smallest weight (`w(x) ≤ w(y) ≤ w(s)` for all other `s`). Let `T` be **any** optimal tree.

First, in a full optimal tree the two deepest leaves are siblings. (If the deepest leaf `a` had no sibling leaf, its sibling subtree could be lifted, strictly reducing cost — contradicting optimality; fullness forces a sibling, and the sibling is a leaf else `a` is not deepest.) Call these deepest siblings `b, c`, at depth `d_max`.

Now build `T'` from `T` by **swapping** `x ↔ b` and `y ↔ c`. The change in cost from swapping `x` and `b` is

```
ΔL = (w(x)·depth(b) + w(b)·depth(x)) − (w(x)·depth(x) + w(b)·depth(b))
   = (w(b) − w(x)) · (depth(x) − depth(b)).
```

Since `w(x) ≤ w(b)` (x is minimum) and `depth(x) ≤ depth(b) = d_max` (b is deepest), we have `(w(b) − w(x)) ≥ 0` and `(depth(x) − depth(b)) ≤ 0`, so `ΔL ≤ 0`. The same holds for swapping `y` and `c`. Hence `L(T') ≤ L(T)`; as `T` was optimal, `L(T') = L(T)` and `T'` is **also optimal**, with `x, y` as the deepest sibling pair. ∎

### 3.2 Lemma B (optimal substructure)

Form the reduced instance: replace `x, y` by a new symbol `z` with `w(z) = w(x) + w(y)`, alphabet `S' = (S ∖ {x,y}) ∪ {z}` of size `n − 1`. For **any** tree `T'` over `S'` in which `z` is a leaf, expand `z` into an internal node with children `x, y` to get a tree `T` over `S`. Then

```
L(T) = L(T') + w(x) + w(y).
```

*Proof of the identity:* every symbol other than `x, y` has the same depth in `T` and `T'`. The symbol `z` at depth `depth(z)` in `T'` contributes `w(z)·depth(z)`; in `T`, `x` and `y` sit at depth `depth(z)+1`, contributing `(w(x)+w(y))·(depth(z)+1) = w(z)·depth(z) + w(x)+w(y)`. The difference is exactly `w(x)+w(y)`, independent of `T'`. ∎

### 3.3 The induction

We prove the Huffman tree is optimal by induction on `n`.

- **Base `n = 1`:** the single symbol gets the empty codeword (or, by convention, the 1-bit code `0`); trivially optimal.
- **Base `n = 2`:** codes `0` and `1`; cost `w₁ + w₂`, clearly minimal.
- **Inductive step:** assume Huffman is optimal for all alphabets of size `n − 1`. Given size `n`, let `x, y` be the two minimum-weight symbols and let `H` be the Huffman tree (which merges `x, y` first). Let `H'` be the Huffman tree of the reduced instance `S'`. By the induction hypothesis `H'` is optimal for `S'`, and `H` is `H'` with `z` expanded into `(x, y)`, so by Lemma B `L(H) = L(H') + w(x)+w(y)`.

  Now take **any** optimal tree `T` for `S`. By Lemma A we may assume `x, y` are sibling deepest leaves in `T`; contract them to a leaf `z`, yielding a tree `T'` for `S'`. By Lemma B, `L(T) = L(T') + w(x)+w(y)`. Since `H'` is optimal for `S'`, `L(H') ≤ L(T')`, hence

  ```
  L(H) = L(H') + w(x)+w(y) ≤ L(T') + w(x)+w(y) = L(T).
  ```

  So `L(H) ≤ L(T)` for the optimal `T`, forcing `L(H) = L(T)`: **Huffman is optimal.** ∎

The proof is the canonical demonstration that a greedy algorithm is correct because the problem has both the **greedy-choice property** (Lemma A) and **optimal substructure** (Lemma B).

---

## 4. The Kraft–McMillan Inequality

Codeword **lengths** are constrained, independent of the actual bit patterns.

> **Kraft inequality.** A binary prefix code with lengths `ℓ₁, …, ℓ_n` exists **iff**
> ```
> Σᵢ 2^(−ℓᵢ)  ≤  1.
> ```

> **McMillan's theorem.** The *same* inequality is necessary for **any uniquely decodable** code — not just prefix codes. Consequence: prefix codes lose nothing in achievable length over the broader class of uniquely decodable codes; the optimal prefix code is optimal among all uniquely decodable codes.

*Sketch (Kraft, existence direction).* Order lengths `ℓ₁ ≤ … ≤ ℓ_n`. Assign codewords greedily: the codeword of length `ℓᵢ` is the next available binary string that is not an extension of a previously assigned one. The count of forbidden length-`ℓᵢ` prefixes is `Σ_{j<i} 2^(ℓᵢ − ℓⱼ) ≤ 2^{ℓᵢ} − 1 < 2^{ℓᵢ}` when the Kraft sum is `≤ 1`, so a free codeword always remains. *(McMillan's direction bounds `(Σ 2^{−ℓᵢ})^k` by counting decodable strings and lets `k → ∞`.)* ∎

**Why it matters here.** Optimization over prefix codes is equivalent to: *minimize `Σ wᵢ ℓᵢ` over integer `ℓᵢ ≥ 1` subject to `Σ 2^{−ℓᵢ} ≤ 1`.* Huffman solves this integer program exactly. The continuous relaxation (allowing real `ℓᵢ`) is solved by `ℓᵢ = −log₂ pᵢ` — which is precisely the entropy, the next section.

---

## 5. Shannon Entropy and the Source-Coding Lower Bound

For a probability distribution `p₁, …, p_n` (`pᵢ > 0`, `Σ pᵢ = 1`), the **Shannon entropy** is

```
H(p) = − Σᵢ pᵢ log₂ pᵢ      (bits per symbol).
```

> **Source-coding lower bound.** Every uniquely decodable binary code has average length `L = Σ pᵢ ℓᵢ ≥ H(p)`.

*Proof.* Let `qᵢ = 2^{−ℓᵢ} / Z` with `Z = Σ 2^{−ℓⱼ} ≤ 1` (Kraft/McMillan). Then
```
L − H = Σ pᵢ ℓᵢ + Σ pᵢ log₂ pᵢ
      = Σ pᵢ log₂( pᵢ · 2^{ℓᵢ} )
      = Σ pᵢ log₂( pᵢ / qᵢ ) − log₂ Z
      = D(p ‖ q) − log₂ Z
      ≥ 0,
```
because the **Kullback–Leibler divergence** `D(p‖q) ≥ 0` (Gibbs' inequality) and `log₂ Z ≤ 0` (since `Z ≤ 1`). Equality requires `qᵢ = pᵢ` and `Z = 1`, i.e. `ℓᵢ = −log₂ pᵢ` — achievable only when every `pᵢ` is a power of two. ∎

This is the hard floor: **no code beats entropy.** Huffman, optimal among prefix codes, comes as close as integer lengths allow.

---

## 6. How Close Huffman Gets: H ≤ L < H + 1

> **Theorem.** The Huffman code `C*` for distribution `p` satisfies
> ```
> H(p)  ≤  L(C*)  <  H(p) + 1.
> ```

*Proof.* The lower bound `H ≤ L(C*)` is Section 5. For the upper bound, construct the **Shannon code** with lengths `ℓᵢ = ⌈−log₂ pᵢ⌉`. These satisfy Kraft because `Σ 2^{−⌈−log₂ pᵢ⌉} ≤ Σ 2^{log₂ pᵢ} = Σ pᵢ = 1`, so a prefix code with these lengths exists. Its average length is
```
L_Shannon = Σ pᵢ ⌈−log₂ pᵢ⌉ < Σ pᵢ (−log₂ pᵢ + 1) = H(p) + 1.
```
Since Huffman is **optimal**, `L(C*) ≤ L_Shannon < H + 1`. ∎

**Tightness.** Both bounds are achievable in the limit. `L = H` exactly when all `pᵢ` are powers of two (e.g. `p = (1/2, 1/4, 1/8, 1/8)` gives `L = H = 1.75`). The gap approaches 1 for a near-deterministic source: with `p = (1−ε, ε/(n−1), …)`, the dominant symbol "wants" `−log₂(1−ε) → 0` bits but is forced to ≥ 1.

**Closing the gap by blocking.** Coding `k`-symbol blocks as super-symbols of a product source `pᵏ` gives `H(pᵏ) = k·H(p)`, and the per-symbol Huffman length satisfies
```
H(p) ≤ L_k / k < H(p) + 1/k  →  H(p)   as k → ∞.
```
So blocking drives Huffman to the entropy at the cost of an exponentially larger alphabet (`nᵏ`). Arithmetic coding achieves the same convergence without the alphabet blow-up (Section 10).

---

## 7. Length-Limited Codes — Package-Merge Correctness

The **length-limited** problem: minimize `Σ wᵢ ℓᵢ` subject to `1 ≤ ℓᵢ ≤ L` and the Kraft constraint `Σ 2^{−ℓᵢ} ≤ 1`.

**Coin-collector reformulation (Larmore–Hirschberg).** Each symbol `i` may be placed at any depth `d ∈ {1, …, L}`; placing it at depth `d` is a **coin** of *width* `2^{−d}` and *cost* `wᵢ`. A valid code uses a multiset of coins whose total width is exactly `(n − 1)` units of `1` … precisely, one must select coins so that for each symbol the chosen depths form a valid full tree; equivalently choose the cheapest set of coins of total width `n − 1` (the **numismatic** total), with `2(n − 1)` coins selected. The optimal selection is found by the **package-merge** sweep:

```
At each width level (from finest 2^{−L} up to 2^{−1}):
   (1) PACKAGE adjacent pairs of the current coin list into coins of the next coarser width;
   (2) MERGE those packages with the original coins available at the next level, keep sorted by cost.
Select the cheapest 2(n−1) coins overall; symbol i's length = number of selected coins it appears in.
```

> **Theorem (Larmore–Hirschberg, 1990).** Package-merge returns code lengths minimizing `Σ wᵢ ℓᵢ` subject to `max ℓᵢ ≤ L`, in `O(n · L)` time and `O(n)` working space (with linked structures).

*Why correct (sketch).* The Kraft budget of `1` is partitioned into "coins" of dyadic widths; minimizing cost under a fixed total width is a matroid-like greedy on sorted coins, and the package step exactly enforces that a node at depth `d` can only exist if its two children at depth `d+1` were "paid for." The selection of the cheapest `2(n−1)` coins corresponds to the cheapest full binary tree of depth `≤ L`. When `L ≥ ⌈log₂ n⌉` and large enough, the result coincides with ordinary Huffman. ∎

The price of the cap: `L(C_limited) ≥ L(C_Huffman)`, with the excess `→ 0` as `L → n − 1`.

---

## 8. k-ary Huffman and the Count Condition

For an output alphabet of size `k` (a `k`-ary prefix code, leaves of a `k`-ary tree), each merge combines the `k` smallest weights. A **full** `k`-ary tree with `m` leaves satisfies `m ≡ 1 (mod k − 1)` (each internal node converts `k` nodes into 1, removing `k − 1`). Therefore the number of merges that exactly consume the alphabet requires

```
(n − 1) ≡ 0   (mod  k − 1).
```

If not, **pad** with `((k−1) − ((n−1) mod (k−1)))` dummy symbols of weight `0`; these sink to the deepest level and cost nothing. The greedy "merge the `k` smallest" is then optimal by the same exchange + substructure argument generalized to `k` children: the `k` smallest weights can be made sibling deepest leaves, and merging them reduces the instance by `k − 1`. Binary Huffman is `k = 2`, where the condition `(n−1) ≡ 0 (mod 1)` is vacuous — no padding ever needed.

---

## 9. Complexity Analysis

| Stage | Time | Space | Justification |
|-------|------|-------|---------------|
| Count frequencies | `Θ(N)` | `Θ(n)` | Single pass over `N` input symbols, `n` distinct. |
| Build min-heap | `Θ(n)` | `Θ(n)` | Bottom-up heapify of `n` leaves. |
| `n − 1` merges | `Θ(n log n)` | `Θ(n)` | Each merge: two `O(log n)` extract-mins + one `O(log n)` insert. |
| Derive lengths/codes | `Θ(n)` | `Θ(n)` | One tree traversal. |
| Canonical assignment | `Θ(n log n)` | `Θ(n)` | Sort by `(length, symbol)`. |
| **Construction total** | **`Θ(n log n)`** | **`Θ(n)`** | Heap merges dominate. |
| Length-limited (package-merge) | `Θ(n·L)` | `Θ(n)` | `L` levels, `O(n)` coins each. |
| Encode message | `Θ(N)` (output `Θ(Σ wᵢ ℓᵢ)` bits) | `Θ(output)` | Concatenate codewords. |
| Decode (tree walk) | `Θ(output bits)` | `Θ(1)` | One step per bit. |
| Decode (table, `MAX_BITS` table) | `Θ(#symbols)` | `Θ(2^{MAX_BITS})` | One table read per symbol. |

**Sorted-input refinement.** If the `n` weights are already sorted, Huffman runs in `Θ(n)` using **two queues** (one of leaves in sorted order, one of merged nodes, which is automatically sorted because merged weights are non-decreasing): each step takes the two smallest fronts of the two queues — no heap, no `log n`. This is the optimal `Θ(n)` construction when input is pre-sorted, and `Θ(n log n)` collapses to the sort.

**Lower bound.** Building the optimal code requires distinguishing relative orders of weights; in the comparison model, `Ω(n log n)` is necessary for unsorted input (reduction from sorting), so `Θ(n log n)` is optimal there, and `Θ(n)` is optimal for sorted input.

---

### 9.1 Cache behavior and constant factors

The merge loop touches `O(n)` heap nodes with near-random access (heap reorders break locality), but for `n ≤ 256` the entire working set fits in L1, so the build is bound by branch prediction in the `Less` comparator, not memory. The two costly real-data passes — **encode** and **decode** — are the cache story that matters:

- **Encode** reads the input sequentially (streaming, prefetcher-friendly) and indexes a small code table (256 entries → fits L1). It is essentially memory-bandwidth bound.
- **Decode (tree walk)** chases child pointers — pointer-chasing with poor locality and a data-dependent branch per bit; this is the slow path.
- **Decode (table)** reads one entry from a `2^{MAX_BITS}` table per symbol. With `MAX_BITS ≤ 15` the table is ≤ 64–128 KB (L2); multi-level tables keep the hot root table in L1. Branch-light and cache-friendly — an order of magnitude faster than the walk.

### 9.2 Average-case length under a random source

For a memoryless source with distribution `p`, the **expected** Huffman codeword length equals the weighted path length of the constructed tree and satisfies `H(p) ≤ E[ℓ] < H(p) + 1` (Section 6). A sharper bound by Gallager (1978) gives `E[ℓ] ≤ H(p) + p_max + 0.086` where `p_max` is the largest symbol probability — so when no symbol dominates, Huffman is provably within a fraction of a bit of entropy, and the worst-case full-bit slack only appears for near-deterministic sources.

### 9.3 Space–time trade-offs

| Strategy | Time | Space | Trade-off |
|----------|------|-------|-----------|
| Tree-walk decode | `Θ(bits)`, slow constant | `Θ(n)` | Minimal memory, poor throughput. |
| Single-level table | `Θ(symbols)` | `Θ(2^{MAX_BITS})` | Fast; large table for big `MAX_BITS`. |
| Multi-level table | `Θ(symbols)`, 1–2 reads | `Θ(2^{root} + Σ sub)` | Small hot set; slight indirection for long codes. |
| Canonical (lengths only) | rebuild `Θ(n log n)` | `Θ(n)` transmit | Tiny header; rebuild cost amortized over the block. |
| Block (`k`-grams) | `Θ(n^k log n^k)` build | `Θ(n^k)` table | Approaches entropy; alphabet explodes. |

## 10. Comparison with Arithmetic Coding and ANS

| Property | Huffman | Arithmetic coding | ANS (tANS/rANS) |
|----------|---------|-------------------|-----------------|
| Avg length vs `H` | `[H, H+1)` | `≤ H + ε` (ε ~ a couple bits total) | `≈ H` |
| Codeword granularity | integer bits | fractional (effective) | fractional (effective) |
| Per-symbol decode | table read | multiply/divide + renorm | table read / shift |
| Build cost | `Θ(n log n)` | model only | `Θ(n)` table |
| Strength | simple, fast, optimal *prefix* code | exact, handles any `pᵢ` | arithmetic-quality at table speed |
| Used in | DEFLATE, JPEG, MP3 | JPEG2000, CABAC (H.264/265) | Zstandard, LZFSE, modern codecs |

The fundamental gap: Huffman is optimal **among integer-length prefix codes**, but the true optimum is fractional (`−log₂ pᵢ`). Arithmetic coding and ANS realize fractional lengths by encoding the *whole message* as a single number (arithmetic) or via state transitions on a normalized frequency table (ANS), eliminating the `< H + 1` slack at the cost of a state machine instead of a static table. Huffman remains the default where the slack is acceptable and patent-free simplicity is valued.

---

### 10.1 Why Huffman beats Shannon–Fano

Shannon–Fano coding (1948–49) splits the sorted symbol set **top-down** into two groups of as-equal-as-possible probability, recursing. It is near-optimal but **not guaranteed minimal**: the top-down split can mis-assign a length by a bit. Example distribution `p = (0.35, 0.17, 0.17, 0.16, 0.15)` — Shannon–Fano produces a code strictly longer than Huffman's. Huffman's **bottom-up** merging of the two least-likely symbols is what makes it provably optimal (Section 3), and is the reason it superseded Shannon–Fano universally. The lesson: greedy *from the bottom* (combine cheapest) is optimal here, while greedy *from the top* (split balanced) is not.

### 10.2 Optimal alphabetic codes (Hu–Tucker)

A plain Huffman code may permute symbols at the leaves arbitrarily. Some applications (searchable codes, order-preserving compression) require the leaves to appear in **symbol order** left to right — an **alphabetic** prefix code. The minimum-cost alphabetic code is **not** produced by Huffman; the **Hu–Tucker algorithm** (1971) solves it in `Θ(n log n)` by a more intricate "compatible merge" rule that never crosses the symbol order, then re-levels. Its cost is at most that of Huffman plus a small additive term, and equals Huffman only when the optimal Huffman tree happens to be order-preserving.

## 11. Open Directions and Summary

### 11.1 Advanced / related directions

- **Optimal alphabetic codes (Hu–Tucker)** — minimum-cost prefix codes that additionally preserve symbol order at the leaves (for searchable codes); `O(n log n)` and *not* solved by plain Huffman.
- **Optimal codes with unequal letter costs (Varn / Karp)** — when output symbols cost different amounts (e.g. Morse dot vs dash); the greedy merge no longer suffices, and it becomes an integer program / LP.
- **Adaptive optimality** — FGK and Vitter's algorithms maintain an optimal code online under the sibling property, with provable bounds on extra bits vs the static optimum.
- **Context modeling** — Huffman codes a memoryless model; PPM, CM, and CABAC exploit context, where the *model*, not the coder, captures the redundancy.

### 11.2 Historical and complexity placement

Huffman (1952) gave the first provably optimal prefix code, superseding Shannon–Fano (which is near-optimal but not guaranteed minimal). Kraft (1949) and McMillan (1956) pinned the length constraint; Shannon (1948) set the entropy floor. Larmore–Hirschberg (1990) solved the length-limited case; Vitter (1987) the adaptive case; Duda (2009) introduced ANS, which now displaces Huffman in many modern codecs for its near-entropy performance at comparable speed.

### 11.3 Summary

Huffman coding is the integer-length-optimal prefix code, proven optimal by an **exchange argument** (the two lightest symbols can be made deepest siblings) plus **optimal substructure** (merge then recurse), the textbook greedy correctness pair. The **Kraft–McMillan** inequality characterizes achievable lengths and shows prefix codes lose nothing to uniquely decodable codes; **Shannon entropy** `H = −Σ pᵢ log₂ pᵢ` is the unbeatable floor, and Huffman lands in the tight band `H ≤ L < H + 1`, with the up-to-1-bit slack arising from integer rounding of the ideal length `−log₂ pᵢ`. Construction is `Θ(n log n)` (or `Θ(n)` on sorted input via two queues), length-limited construction is `Θ(n·L)` via package-merge, and the residual sub-bit slack is what arithmetic coding and ANS exist to remove.

---

## 12. Reference Code (Optimality Verifier + Entropy)

A verifier that (1) builds the Huffman code, (2) computes `L`, `H`, and asserts `H ≤ L < H + 1`, (3) checks the **Kraft equality** `Σ 2^{−ℓ} = 1` for a complete code, and (4) brute-forces optimality on tiny alphabets by trying all length vectors satisfying Kraft. All three print the same verdicts.

#### Go

```go
package main

import (
	"container/heap"
	"fmt"
	"math"
	"sort"
)

type nd struct {
	w, ord      int
	leaf        bool
	id          int
	left, right *nd
}
type pq []*nd

func (p pq) Len() int            { return len(p) }
func (p pq) Less(i, j int) bool  { if p[i].w != p[j].w { return p[i].w < p[j].w }; return p[i].ord < p[j].ord }
func (p pq) Swap(i, j int)       { p[i], p[j] = p[j], p[i] }
func (p *pq) Push(x any)         { *p = append(*p, x.(*nd)) }
func (p *pq) Pop() any           { o := *p; n := len(o); x := o[n-1]; *p = o[:n-1]; return x }

func lengths(w []int) []int {
	n := len(w)
	if n == 1 {
		return []int{1}
	}
	h := &pq{}
	for i, wi := range w {
		heap.Push(h, &nd{w: wi, ord: i, leaf: true, id: i})
	}
	ord := n
	for h.Len() > 1 {
		a := heap.Pop(h).(*nd)
		b := heap.Pop(h).(*nd)
		heap.Push(h, &nd{w: a.w + b.w, ord: ord, left: a, right: b})
		ord++
	}
	L := make([]int, n)
	var walk func(x *nd, d int)
	walk = func(x *nd, d int) {
		if x.leaf {
			L[x.id] = d
			return
		}
		walk(x.left, d+1)
		walk(x.right, d+1)
	}
	walk(heap.Pop(h).(*nd), 0)
	return L
}

func main() {
	w := []int{5, 2, 2, 1, 1} // abracadabra weights
	total := 0
	for _, x := range w {
		total += x
	}
	L := lengths(w)

	avg, kraft, H := 0.0, 0.0, 0.0
	for i, li := range L {
		p := float64(w[i]) / float64(total)
		avg += p * float64(li)
		kraft += math.Pow(2, -float64(li))
		H += -p * math.Log2(p)
	}
	fmt.Printf("lengths = %v\n", L)
	fmt.Printf("H = %.4f, L = %.4f, H<=L<H+1: %v\n", H, avg, H <= avg+1e-9 && avg < H+1)
	fmt.Printf("Kraft sum = %.4f (== 1 for complete code: %v)\n", kraft, math.Abs(kraft-1) < 1e-9)

	// Brute force optimality on this tiny alphabet.
	best := bruteOptimal(w)
	fmt.Printf("Huffman L*total = %d, brute min = %d, optimal: %v\n",
		int(avg*float64(total)+0.5), best, int(avg*float64(total)+0.5) == best)
	_ = sort.Ints
}

func bruteOptimal(w []int) int {
	n := len(w)
	best := math.MaxInt32
	maxLen := n // codewords never need more than n-1 bits
	combo := make([]int, n)
	var rec func(i int)
	rec = func(i int) {
		if i == n {
			k := 0.0
			cost := 0
			for j := 0; j < n; j++ {
				k += math.Pow(2, -float64(combo[j]))
				cost += w[j] * combo[j]
			}
			if k <= 1+1e-9 && cost < best {
				best = cost
			}
			return
		}
		for l := 1; l <= maxLen; l++ {
			combo[i] = l
			rec(i + 1)
		}
	}
	rec(0)
	return best
}
```

#### Java

```java
import java.util.*;

public class Verifier {
    static class N { int w, ord, id; boolean leaf; N left, right;
        N(int w, int o, int id, boolean l) { this.w=w; ord=o; this.id=id; leaf=l; } }

    static int[] lengths(int[] w) {
        int n = w.length;
        if (n == 1) return new int[]{1};
        PriorityQueue<N> h = new PriorityQueue<>(
            (a, b) -> a.w != b.w ? a.w - b.w : a.ord - b.ord);
        for (int i = 0; i < n; i++) h.add(new N(w[i], i, i, true));
        int ord = n;
        while (h.size() > 1) {
            N a = h.poll(), b = h.poll();
            N m = new N(a.w + b.w, ord++, -1, false); m.left = a; m.right = b; h.add(m);
        }
        int[] L = new int[n];
        walk(h.poll(), 0, L);
        return L;
    }
    static void walk(N x, int d, int[] L) {
        if (x.leaf) { L[x.id] = d; return; }
        walk(x.left, d + 1, L); walk(x.right, d + 1, L);
    }

    static int best;
    static int bruteOptimal(int[] w) {
        best = Integer.MAX_VALUE;
        rec(w, new int[w.length], 0);
        return best;
    }
    static void rec(int[] w, int[] combo, int i) {
        int n = w.length;
        if (i == n) {
            double k = 0; int cost = 0;
            for (int j = 0; j < n; j++) { k += Math.pow(2, -combo[j]); cost += w[j]*combo[j]; }
            if (k <= 1 + 1e-9 && cost < best) best = cost;
            return;
        }
        for (int l = 1; l <= n; l++) { combo[i] = l; rec(w, combo, i + 1); }
    }

    public static void main(String[] args) {
        int[] w = {5, 2, 2, 1, 1};
        int total = Arrays.stream(w).sum();
        int[] L = lengths(w);
        double avg = 0, kraft = 0, H = 0;
        for (int i = 0; i < w.length; i++) {
            double p = (double) w[i] / total;
            avg += p * L[i]; kraft += Math.pow(2, -L[i]); H += -p * (Math.log(p) / Math.log(2));
        }
        System.out.println("lengths = " + Arrays.toString(L));
        System.out.printf("H = %.4f, L = %.4f, H<=L<H+1: %b%n", H, avg, H <= avg + 1e-9 && avg < H + 1);
        System.out.printf("Kraft sum = %.4f (==1: %b)%n", kraft, Math.abs(kraft - 1) < 1e-9);
        int huff = (int) Math.round(avg * total);
        System.out.printf("Huffman cost = %d, brute = %d, optimal: %b%n",
            huff, bruteOptimal(w), huff == bruteOptimal(w));
    }
}
```

#### Python

```python
import heapq
import math
from itertools import count, product


def lengths(w):
    n = len(w)
    if n == 1:
        return [1]
    tie = count()
    heap = [[w[i], next(tie), i, None, None] for i in range(n)]
    heapq.heapify(heap)
    while len(heap) > 1:
        a = heapq.heappop(heap)
        b = heapq.heappop(heap)
        heapq.heappush(heap, [a[0] + b[0], next(tie), -1, a, b])
    L = [0] * n
    def walk(node, d):
        _, _, idx, left, right = node
        if idx != -1:
            L[idx] = d
        else:
            walk(left, d + 1); walk(right, d + 1)
    walk(heap[0], 0)
    return L


def brute_optimal(w):
    n = len(w)
    best = math.inf
    for combo in product(range(1, n + 1), repeat=n):
        if sum(2 ** -l for l in combo) <= 1 + 1e-9:
            cost = sum(wi * l for wi, l in zip(w, combo))
            best = min(best, cost)
    return best


if __name__ == "__main__":
    w = [5, 2, 2, 1, 1]
    total = sum(w)
    L = lengths(w)
    avg = sum((wi / total) * li for wi, li in zip(w, L))
    kraft = sum(2 ** -li for li in L)
    H = -sum((wi / total) * math.log2(wi / total) for wi in w)
    print("lengths =", L)
    print(f"H = {H:.4f}, L = {avg:.4f}, H<=L<H+1: {H <= avg + 1e-9 < H + 1 + 1e-9}")
    print(f"Kraft sum = {kraft:.4f} (== 1: {abs(kraft - 1) < 1e-9})")
    huff = round(avg * total)
    print(f"Huffman cost = {huff}, brute = {brute_optimal(w)}, optimal: {huff == brute_optimal(w)}")
```

**What it does:** builds the Huffman lengths, reports `H`, `L`, the Kraft sum, and **brute-forces** the optimal integer-length code under the Kraft constraint to *prove* Huffman matched the minimum on a small alphabet.
**Run:** `go run main.go` | `javac Verifier.java && java Verifier` | `python verifier.py`

### 12.1 Implementation notes

- The brute-force optimality check is exponential (`n^n` length vectors) — use it only as a tiny-alphabet regression oracle, exactly as the spanning-tree brute force served Kirchhoff.
- The Kraft sum equals `1` for a **complete** Huffman code (every internal node has two children); a sum `< 1` signals a non-full tree (a bug, since Huffman trees are always full).
- Entropy `H` uses probabilities `wᵢ / Σwⱼ`; assert `H ≤ L < H + 1` as a correctness invariant in tests.
- For sorted weights, replace the heap with the **two-queue** method to reach `Θ(n)` and confirm identical lengths.
