# Bit-Parallel Techniques (Word-Level Parallelism / Bitset Acceleration) — Senior Level

> Bit-parallelism is rarely the algorithm — it is the *constant factor* that decides whether a correct `O(n·T)` or `O(V³)` solution ships or times out. At the senior level the questions are: which bitset representation (`std::bitset` vs dynamic_bitset vs hand-rolled `uint64[]`), how cache and alignment govern the real `/64`, when the `/64` actually matters, the harder bit-vector DPs (Myers' edit distance), going beyond one register with SIMD, and how to test and reason about failure modes that survive every functional test.

## Table of Contents
1. [Introduction](#1-introduction)
2. [Choosing a Bitset Representation](#2-choosing-a-bitset-representation)
3. [Cache, Alignment, and the Real `/64`](#3-cache-alignment-and-the-real-64)
4. [When `/64` Matters (and When It Does Not)](#4-when-64-matters-and-when-it-does-not)
5. [Myers' Bit-Vector Edit Distance](#5-myers-bit-vector-edit-distance)
6. [Bitset-Accelerated DP at Scale](#6-bitset-accelerated-dp-at-scale)
7. [Beyond Words: SIMD and SWAR](#7-beyond-words-simd-and-swar)
8. [Code Examples](#8-code-examples)
9. [Observability and Testing](#9-observability-and-testing)
10. [Failure Modes](#10-failure-modes)
11. [Summary](#11-summary)

---

## 1. Introduction

By the senior level you already know `B |= B << w` and Shift-Or. The questions that decide a production outcome are different:

1. **Representation.** Compile-time-fixed width (`std::bitset<N>`), runtime width (`boost::dynamic_bitset`, Java `BitSet`), or a hand-rolled `uint64[]`? The choice governs inlining, allocation, and whether shift-OR is even expressible.
2. **Memory behavior.** The theoretical 64× rarely materializes verbatim; it is gated by cache, alignment, and how the bitset streams through memory. A bitset that spills L2 every pass loses much of its advantage.
3. **Applicability.** The `/64` only helps when the *bottleneck loop is boolean* and the asymptotic class is already acceptable. Reaching for bits on the wrong loop is wasted complexity.
4. **Harder DPs.** Myers' bit-vector edit distance computes a whole DP column with a handful of word ops — a genuinely subtle bit-parallel algorithm worth understanding end to end.
5. **Beyond one register.** AVX2/AVX-512 widen the divisor to 256/512; `std::bitset` and good compilers already auto-vectorize the word loops.

This document treats those decisions in production terms, with the running subset-sum / reachability / matching examples as anchors.

A unifying caution underlies all of it: bit-parallelism is a *constant-factor* tool. Every section returns to the same discipline — measure before optimizing, confirm the loop is boolean and hot, keep the working set in cache, and never relabel the resulting `/64` as a complexity-class change in a design document.

---

## 2. Choosing a Bitset Representation

### 2.1 The three options

| Representation | Width fixed at | Allocation | Shift-OR support | Best for |
|----------------|----------------|-----------|------------------|----------|
| `std::bitset<N>` (C++) | compile time | stack/inline | `<<`, `|`, `&`, `count`, no resize | known bound `N`, hottest loops |
| `boost::dynamic_bitset` / Java `BitSet` | run time | heap | `<<`/shift varies; Java `BitSet` lacks `<<` | unknown width, set algebra |
| hand-rolled `uint64[]` | run time | you control | you implement (cross-word shift) | subset-sum shift, full control, SIMD intent |

**`std::bitset<N>`** is the fastest when `N` is a compile-time constant: the whole thing is inlined, often register-allocated for small `N`, and `operator<<`/`operator|` are word loops the compiler vectorizes. Its limitation is the fixed `N` — you cannot size it from input at runtime. A common pattern in competitive programming is to set `N` to the problem's maximum bound (e.g. `bitset<100001>`) and accept the slight over-allocation for the zero-cost inlining.

**`dynamic_bitset` / Java `BitSet`** trade a heap allocation and indirection for runtime sizing. Critically, **Java's `BitSet` has no left-shift operator** — you cannot write `B |= B << w` directly; you must hand-roll the shift over `toLongArray()`/`words`, which is why the subset-sum examples in this topic use a custom `long[]` class. Java `BitSet` is fine for set algebra (`and`/`or`/`andNot`/`cardinality`) but not for shift-OR DP.

**Hand-rolled `uint64[]`** is the workhorse for shift-OR subset-sum and for any case where you want explicit control over the cross-word carry, alignment, or a path to SIMD. It is the most code but the most predictable.

### 2.2 Decision rule

- Compile-time bound, hottest loop, C++ → `std::bitset<N>`.
- Runtime width, mostly set algebra → `dynamic_bitset` / Java `BitSet` / Python `int`.
- Shift-OR DP (subset-sum), or you need SIMD/alignment control → hand-rolled `uint64[]`.
- Prototyping / scripting → Python `int` (it *is* an arbitrary-width bitset with C-speed `<<`/`|`).

A frequent senior mistake is reaching for Java `BitSet` to implement subset-sum and discovering there is no `<<`; recognize this up front.

### 2.3 What each representation gives you (and costs you)

| Concern | `std::bitset<N>` | `dynamic_bitset` / `BitSet` | `uint64[]` | Python `int` |
|---------|------------------|-----------------------------|-----------|--------------|
| Runtime sizing | no | yes | yes | yes |
| Left shift `<<` | yes | C++ yes / Java **no** | you write it | yes (auto-carry) |
| Allocation | none (inline) | heap | one block | per-op (GC'd) |
| SIMD-friendly | compiler does it | opaque | you control | no |
| Inlining | full | virtual-ish | full | interpreted |
| Best use | hottest fixed-`N` loop | set algebra | shift-OR / SIMD | prototyping |

The table encodes the rule: if you can fix `N` at compile time and the loop is hot, `std::bitset<N>` is unbeatable and free; if not, hand-rolled `uint64[]` gives the most control for shift-OR; everything else is a convenience tradeoff.

### 2.4 The `std::bitset` shift is the reference implementation

When in doubt about your hand-rolled cross-word shift, compare it against `std::bitset<N>::operator<<`, which is the canonical correct, vectorized version. Many bugs in a custom `uint64[]` shift surface immediately when diffed against the same operation in `std::bitset`. Treat the standard library as your oracle for the shift, not just for correctness but for the loop structure a good compiler emits.

---

## 3. Cache, Alignment, and the Real `/64`

### 3.1 The 64× is an instruction-count ceiling, not a wall-clock guarantee

`/64` counts *fewer instructions*. Wall-clock speedup also depends on whether those word reads hit cache. A bitset of `T` bits is `T/8` bytes; subset-sum sweeps the whole bitset once per item. If `T/8` exceeds L2, every pass streams from L3/DRAM and the effective speedup shrinks — though the 8× *density* over `bool[]` (which is `T` bytes) still helps the bitset win.

### 3.2 Density is half the benefit

A `bool[]` of `10^6` is 1 MB; the equivalent bitset is 125 KB — often the difference between spilling L2 and fitting it. The packing improves cache behavior *independently* of the per-instruction parallelism, so even a poorly-vectorized bitset loop usually beats `bool[]` on memory-bound workloads.

### 3.3 Alignment and word size

- Align the word array to 32/64 bytes if you intend to hand it to SIMD (`_mm256_load_si256` requires 32-byte alignment; misaligned uses the slower `loadu`).
- Use the *native* word (`uint64` on 64-bit CPUs). Using `uint32` halves the parallelism for no benefit on a 64-bit machine.
- Keep the bitset contiguous (one allocation), not an array-of-rows-of-pointers, so each pass is a linear stream the prefetcher loves.

### 3.4 Streaming vs random access

Bitset shift-OR and word-parallel set algebra are *streaming* (sequential word reads) — ideal for prefetch. Random single-bit `test(s)` across a huge bitset is *random access* and cache-unfriendly; if your access pattern is random and sparse, a hash set may beat the bitset despite the `/64`.

### 3.5 A back-of-envelope cache model

To predict whether the `/64` materializes, compare the working-set size against cache levels:

| Bitset bits `T` | Bytes `T/8` | Fits in | Expected vs theoretical 64× |
|-----------------|-------------|---------|------------------------------|
| 256 K | 32 KB | L1/L2 | near 64× |
| 4 M | 500 KB | L2/L3 | ~40–64× |
| 64 M | 8 MB | L3/DRAM | memory-bound, ~10–20× |
| 1 G | 125 MB | DRAM | bandwidth-bound, but still beats `bool[]` 8× density |

The lesson: bit-parallelism's instruction-count win is real, but past L2 the workload becomes memory-bound and the *density* advantage (8× fewer bytes than `bool[]`) dominates the *parallelism* advantage. Cap the universe (Section 6.3) to keep the working set resident whenever possible.

### 3.6 False sharing and threading

If you parallelize a bitset operation across threads (e.g. one thread per chunk of words), align chunk boundaries to cache lines (64 bytes = 8 words). Two threads writing adjacent words in the same cache line cause **false sharing** — the line ping-pongs between cores' caches, often making the parallel version slower than serial. Partition by cache-line-aligned word ranges, never by individual words.

---

## 4. When `/64` Matters (and When It Does Not)

### 4.1 It matters when the boolean loop is the bottleneck

The `/64` pays off precisely when:

- the inner loop is over booleans (reachable/not, matched/not, present/absent),
- that loop dominates the runtime,
- the universe `T` is dense and fits in memory,
- and the asymptotic class is *already* acceptable (you need a constant, not a better exponent).

Subset-sum (`O(n·T)`), transitive closure (`O(V³)`), banded edit distance, and substring search all fit.

### 4.2 It does NOT matter when…

- **The class is wrong.** A `/64` on an exponential algorithm is still exponential. Fix the algorithm first.
- **The data is sparse.** A bitset of `10^9` slots with 100 set bits wastes `10^9/64` word reads; a hash set is `O(100)`.
- **The values are not booleans.** If each "lane" needs more than one bit of state (counts, weights), naive bitset packing fails; you need SWAR with masking (Section 7) or real arithmetic.
- **The loop isn't hot.** Bit-parallelizing a cold path adds bug surface for no measurable gain. Profile first.

### 4.3 The honest framing

Present the `/64` to reviewers as: *"same Big-O, ~64× fewer instructions and 8× denser memory, contingent on cache behavior; measured speedup X on our data."* Never claim it changes complexity class — that is the single most common overstatement in code review.

### 4.4 A decision checklist before reaching for bits

Run this checklist before bit-packing a loop:

1. **Is the loop hot?** Profile. If it is not in the top few hotspots, the added bug surface is not worth it.
2. **Is the inner state one bit?** Reachable/not, matched/not, present/absent — yes. Counts, weights, scores — no (use SWAR or real arithmetic).
3. **Is the universe dense and bounded?** Density above `~1/64` and a size that fits in memory — yes. Sparse over a huge universe — use a hash set. (Formally, the bitset's `O(T/64)` beats a sparse set's `O(m)` exactly when `T/64 < m`, i.e. density `> 1/64`.)
4. **Is the asymptotic class already acceptable?** The `/64` is a constant; it will not rescue an exponential algorithm.
5. **Can you write a scalar oracle?** If you cannot cheaply verify the bit-parallel result, do not ship it.

If all five are "yes", bit-parallelism is the right tool and will likely deliver a large, measurable win. A "no" on any of 2–4 means the `/64` is the wrong lever.

### 4.5 Real-world wins and non-wins

- **Win:** competitive-programming subset-sum / knapsack feasibility with `n·T ≈ 10^8` — the `/64` is the difference between TLE and AC.
- **Win:** transitive closure on a few-thousand-vertex dependency graph in a build system or type checker.
- **Win:** exact and fuzzy substring search in a log scanner (Shift-Or / Bitap).
- **Non-win:** sparse adjacency (use adjacency lists); counting (not feasibility) of subsets (use FFT/DP); a cold initialization loop.

---

## 5. Myers' Bit-Vector Edit Distance

Myers' 1999 algorithm computes the Levenshtein edit distance between a pattern `P` (length `m ≤ 64`) and a text, processing each text column with a fixed handful of word operations — `O(1)` per column instead of `O(m)`, i.e. an `O(nm)` DP collapsed to `O(n·⌈m/64⌉)`.

### 5.0 Why edit distance is the hardest interesting case

Subset-sum and Shift-Or pack *Boolean* state — feasibility and match-frontier — which is free (no carries). Edit distance is different: each DP cell holds an *integer* distance, not a bit. The breakthrough of Myers is realizing that, thanks to the unit-difference property, you do not need to store the integers — only the *differences* between adjacent cells, which are in `{-1,0,+1}` and therefore encode in two bits per cell. That is what brings an inherently arithmetic DP into the bit-parallel world, and it is why Myers is the canonical "advanced" bit-parallel algorithm: it is the bridge from free Boolean packing to carry-aware arithmetic packing.

### 5.1 The insight: encode the DP column as bit vectors

The classic edit-distance DP fills a column where consecutive entries differ by `±1` or `0` (the **Lipschitz / unit-difference property** of the edit matrix). Myers represents a column not by the values but by **two bit vectors of the vertical differences**:

- `VP` (vertical positive): bit `j` set iff `D[j] - D[j-1] = +1`.
- `VN` (vertical negative): bit `j` set iff `D[j] - D[j-1] = -1`.

Because every vertical difference is in `{-1, 0, +1}`, these two bit vectors fully encode the column. The whole column update is then a sequence of additions, shifts, ANDs, ORs, and XORs on `VP`, `VN`, and a per-character **equality vector** `Eq` (bit `j` set iff `P[j] == text[i]`, the same precomputed masks as Shift-Or).

The encoding loses nothing: given `VP`, `VN`, and the boundary value `D[i][0] = i` (or the relevant initialization), the entire column of integer distances is reconstructible by a running sum. But the algorithm never reconstructs it — it propagates the differences directly, which is what keeps every column update to `O(1)` word operations.

### 5.2 The core update (one text character `c`)

```
Eq  = peq[c]                          # equality mask for current char
Xv  = Eq | VN
Xh  = (((Eq & VP) + VP) ^ VP) | Eq    # the carry-propagating add is the crux
HP  = VN | ~(Xh | VP)
HN  = VP & Xh
# extract the score delta at the bottom row
if HP & topBit: score += 1
elif HN & topBit: score -= 1
# shift horizontals into verticals for the next column
HP <<= 1; HN <<= 1
VP = HN | ~(Xv | HP)
VN = HP & Xv
```

The single arithmetic add `(Eq & VP) + VP` is what makes it bit-parallel: the **carry propagation of integer addition** simulates the chained `min` of the DP across all `m` rows at once. That is the deep trick — Myers reuses the ALU's carry chain as a parallel scan over the DP column.

### 5.3 Why it is correct (sketch)

The unit-difference property means the column is a path of `±1/0` steps; the horizontal and vertical difference vectors form a closed update system. Myers proved the boolean formulas above reproduce exactly the recurrence `D[i][j] = min(D[i-1][j]+1, D[i][j-1]+1, D[i-1][j-1]+[P[j]≠c])`, with the carry in `(Eq & VP) + VP` encoding the propagation of a "the diagonal won" signal up the column. The bottom-row delta accumulates into the running distance. Full proof in Myers (1999); the takeaway is that addition's carry is a parallel prefix operation, and the unit-difference structure is what lets two bit vectors stand in for the whole column.

### 5.4 Extensions and limits

- **`m > 64`**: block the pattern into `⌈m/64⌉` words and carry the add and shifts across blocks — `O(n·⌈m/64⌉)`.
- **LCS**: the longest common subsequence length is recoverable from the same bit-vector machinery (Crochemore/Hunt-Szymanski-style bit-parallel LCS), since LCS is edit distance with only insert/delete.
- **Approximate search**: report positions where the running distance `≤ k` — this is how high-performance fuzzy matchers (e.g. `edlib`) work.

### 5.5 When to use Myers vs the scalar DP

Myers wins decisively when the pattern is short (`m ≤ 64`, one word) and the text is long — its per-character cost is a handful of register ops with no inner loop. For `m` only slightly above 64, the blocked version is still excellent. The scalar `O(nm)` DP is preferable only when you also need the **full alignment / backtrace** (Myers gives the distance and, with extra bookkeeping, the score profile, but reconstructing the exact alignment from the bit vectors is more involved than from the scalar DP table). Decision: distance-only or banded-search → Myers; full traceback alignment → scalar DP (or Hirschberg for linear space).

### 5.6 The unit-difference property is the whole foundation

Myers' encoding is only valid because adjacent edit-distance cells differ by `{-1, 0, +1}` (proved in `professional.md §7`). If you alter the cost model — say, substitution costs 2, or affine gap penalties — the unit-difference property can break, and the two-bit-vector encoding no longer applies. Affine-gap alignment (Gotoh) needs three DP layers and does **not** bit-pack the Myers way. Before reaching for Myers, confirm your cost model preserves unit differences; otherwise you need a different (often non-bit-parallel) algorithm.

---

## 6. Bitset-Accelerated DP at Scale

### 6.0 Recognizing a bit-parallel DP

The signature of a bit-packable DP: each layer is a *boolean vector*, and the transition is a *shift-and-combine* (shift by a constant, then OR/AND with another bitset). Subset-sum (`shift by w, OR`), Shift-Or (`shift by 1, OR mask`), and reachability (`OR neighbor rows`) all fit. If the transition needs per-cell arithmetic beyond a fixed shift and a Boolean combine — multiplication, conditional add, comparison — it is not a candidate for the free 1-bit packing. The diagnostic question is: *"is the next layer obtainable from the current one by shifts and bitwise logic alone?"* If yes, bit-parallelize; if no, the row is not Boolean and you need SWAR or scalar arithmetic.

### 6.1 The pattern: a boolean DP row is a bitset

Any DP whose row/layer is a boolean vector with a *shift-and-combine* transition is a bitset-acceleration candidate. Subset-sum (`B |= B << w`) is the archetype; others:

- **Coin reachability / making-change feasibility**: same shift-OR.
- **Bounded scheduling feasibility**: feasible-time sets as bitsets, union under task durations.
- **Bit-parallel automaton DP**: Shift-Or, Bitap, and Myers are all "automaton state as bitset, step with word ops".

### 6.2 Reconstruction adds a factor, not a class

Reachability bitsets answer *whether*, not *which*. Reconstructing the chosen items costs `O(n)` extra per query (walk items backward, test `t - w` reachability before each item was folded in). If you need *all* solutions or *counts*, the boolean bitset is insufficient — you are back to counting DP (which is not a single-bit quantity and does not bit-pack).

To reconstruct, you need the reachable set *before* each item was folded in. Two options: (1) keep a snapshot of `B` per item (`O(n·T/64)` memory) and walk backward, or (2) recompute prefixes on demand. The backward walk: for target `t`, scan items `n-1 … 0`; if item `w_i` could have contributed (i.e. `t - w_i` was reachable using items `< i`), include it and set `t -= w_i`. This `O(n)` post-pass turns a yes/no answer into an actual subset.

### 6.3 Keep the universe bounded

The bitset cost is `O(n·T/64)`; `T` is the lever. Cap the bitset to the largest target you care about (Section 4 of middle.md). For subset-sum with a query cap `C`, mask off bits beyond `C` each step — bounding both memory and the word count.

### 6.4 Composability with binary exponentiation

Bitset Boolean matrix multiply composes with the matrix-power skeleton from `11-graphs`: each squaring is a bitset multiply (`O(V³/64)`), so exact-length-`k` reachability is `O((V³/64) log k)`. The same composition gives bitset-accelerated automaton iteration. The key engineering point: the squaring ladder is *read-only* after construction, so cache it once and share it across queries (the same "don't rebuild per request" lesson from the matrix-power topic). The `/64` and the `log k` are independent wins that multiply.

### 6.5 What does not bit-pack

A boolean DP row bit-packs; a *counting* or *weighted* DP row does not, because each cell holds more than one bit of information. If your DP tracks "how many ways" or "minimum cost", you cannot OR-and-shift it into a bitset — you need integer arithmetic per cell, possibly SWAR-packed if the values are small and bounded (e.g. costs in `[0, 15]` fit in 4-bit SWAR lanes), but never the free 1-bit packing. Recognizing this boundary early saves a doomed bit-packing attempt: ask "is each lane one bit?" before reaching for the bitset.

---

## 7. Beyond Words: SIMD and SWAR

### 7.1 Wider registers, larger divisor

A 64-bit GPR gives `/64`. AVX2 (`__m256i`) gives `/256`; AVX-512 gives `/512`. For pure boolean word loops (`and`/`or`/`xor`/shift), modern compilers **auto-vectorize** the `uint64[]` loop into AVX, so a hand-rolled word loop often already gets `/256` on the AND/OR passes. Explicit intrinsics buy more on shift-OR (cross-lane shifts are awkward in SIMD) and on popcount (`VPOPCNTQ` on AVX-512).

### 7.1b Auto-vectorization in practice

A telling experiment: compile the same `uint64[]` OR loop with `-O2 -mavx2` and inspect the assembly. Modern GCC/Clang emit `vpor ymm` instructions, processing four 64-bit words per iteration — a free `/256` on the OR/AND passes, with no intrinsics. The same loop at `-O0` or without AVX emits scalar `or` on 64-bit GPRs (`/64`). The takeaway: *write clean `uint64[]` loops and let the compiler widen them*; reach for explicit intrinsics only when the assembly shows it failed to vectorize (often due to aliasing — add `restrict`/non-overlapping guarantees) or for operations the autovectorizer cannot express (cross-lane shift, `VPOPCNTQ`).

### 7.2 SWAR: arithmetic within a register

**SIMD Within A Register** packs *multi-bit* sub-values into one word and does arithmetic on all of them with masking to stop carries crossing fields. Classic examples:

- **Parallel popcount** (the `0x5555…`, `0x3333…`, `0x0F0F…` Hamming-weight folding) — adds bit counts in parallel lanes.
- **Byte-wise SIMD compares** using `(x - 0x0101…) & ~x & 0x8080…` to find a zero byte (the libc `strlen`/`memchr` trick).
- **Saturating lane adds** with mask-and-correct to prevent inter-lane carry.

SWAR is the generalization of the bit trick from *1-bit* lanes (pure boolean, free) to *k-bit* lanes (arithmetic, needs masking). Myers' edit distance (Section 5) is essentially SWAR: it deliberately *uses* the carry chain rather than blocking it.

### 7.3 Portability and detection

- `std::bitset`, `popcount`/`__builtin_popcountll`, `Long.bitCount`, `bits.OnesCount64` map to `POPCNT` where available and fall back otherwise.
- Runtime CPU feature detection (`cpuid`) chooses AVX paths; ship a scalar `uint64[]` fallback.
- Do not over-invest in intrinsics until profiling shows the word loop is the bottleneck and the compiler is *not* already vectorizing it (check the assembly).

### 7.4 Why shift is the hard part for SIMD

The Boolean logic ops (`AND/OR/XOR`) vectorize trivially — they are lane-independent, so a 256-bit register does four 64-bit ANDs with one instruction. The **shift** is the problem: a whole-bitset `<< d` needs bits to cross 64-bit lane boundaries, and SIMD lane-crossing shifts are awkward (`_mm256_slli_si256` shifts by *bytes* within 128-bit halves, not freely across the full register). This is why subset-sum's `B |= B << w` benefits less from explicit AVX than the AND/OR-heavy set algebra and reachability do. For shift-OR, the practical advice is: let the compiler handle the `uint64[]` shift loop, and reserve manual AVX for the OR/AND passes. The cross-lane shift complexity in SIMD mirrors the cross-word carry complexity in the scalar `uint64[]` implementation — the same fundamental difficulty, one level up.

### 7.5 GPU and the limits of widening

The widening trend (64 → 256 → 512 → GPU warps of thousands of lanes) has diminishing returns for shift-heavy bit-parallel algorithms: the wider the register, the more painful cross-lane data movement becomes, and shift-OR is shift-dominated. Pure set-algebra and reachability (OR/AND-dominated) scale better with width. The rule of thumb: *the more your workload is "combine lanes with logic" the better it widens; the more it is "move bits across positions" the more 64-bit GPRs (with their cheap full-width shift) remain competitive.*

---

## 8. Code Examples

### 8.1 C++ — `std::bitset` subset-sum (the cleanest fixed-width form)

```cpp
#include <bitset>
#include <iostream>
const int MAXSUM = 100000;

bool canMake(const int* w, int n, int target) {
    std::bitset<MAXSUM + 1> B;
    B[0] = 1;                       // empty subset
    for (int i = 0; i < n; i++)
        B |= B << w[i];             // add w[i] to all reachable sums
    return B[target];
}

int main() {
    int w[] = {3, 1, 2, 64, 65};
    std::cout << canMake(w, 5, 67) << " count=" << /*...*/ 0 << "\n";
}
```

`std::bitset<N> << w` is exactly the cross-word shift, written for you and vectorized by the compiler — the reference implementation of `B |= B << w`.

### 8.2 Go — Myers' bit-vector edit distance (pattern ≤ 64)

```go
package main

import "fmt"

// myers computes Levenshtein distance between pat (len<=64) and text.
func myers(pat, text string) int {
	m := len(pat)
	var peq [256]uint64
	for j := 0; j < m; j++ {
		peq[pat[j]] |= 1 << uint(j)
	}
	var VP uint64 = (1 << uint(m)) - 1 // all ones in low m bits
	var VN uint64 = 0
	score := m
	top := uint64(1) << uint(m-1)
	for i := 0; i < len(text); i++ {
		eq := peq[text[i]]
		xv := eq | VN
		xh := (((eq & VP) + VP) ^ VP) | eq
		hp := VN | ^(xh | VP)
		hn := VP & xh
		if hp&top != 0 {
			score++
		} else if hn&top != 0 {
			score--
		}
		hp = (hp << 1) | 1 // shift in, optimistic
		hn <<= 1
		VP = hn | ^(xv | hp)
		VN = hp & xv
	}
	return score
}

func main() {
	fmt.Println(myers("kitten", "sitting")) // 3
}
```

### 8.3 Python — SWAR parallel popcount (no hardware POPCNT)

```python
def swar_popcount64(x):
    x = x & 0xFFFFFFFFFFFFFFFF
    x = x - ((x >> 1) & 0x5555555555555555)              # pairs
    x = (x & 0x3333333333333333) + ((x >> 2) & 0x3333333333333333)  # nibbles
    x = (x + (x >> 4)) & 0x0F0F0F0F0F0F0F0F              # bytes
    return (x * 0x0101010101010101 & 0xFFFFFFFFFFFFFFFF) >> 56


if __name__ == "__main__":
    print(swar_popcount64(0b1011010110), bin(0b1011010110).count("1"))
```

This is SWAR: each fold adds bit-counts in parallel lanes, the masks preventing one lane's sum from corrupting its neighbor — the multi-bit generalization of the free 1-bit boolean parallelism.

---

## 9. Observability and Testing

A bit-parallel result is opaque — one wrong word looks like any other large number. Build checks from day one.

| Check | Why |
|-------|-----|
| Scalar oracle on small inputs | The decisive test: scalar boolean DP vs bitset, entrywise. Catches cross-word shift bugs. |
| `bitShift == 0` and `wordShift` boundary cases | The `>> 64` UB and word-boundary carries are the top bug source. |
| popcount equals `bin(x).count("1")` | Validates SWAR / hardware popcount paths agree. |
| Shift-Or matches vs `str.find` loop | Confirms the match convention and the `m-1` match bit. |
| Myers distance vs full DP | Validates the carry-add formulas against the textbook recurrence. |
| Random-input fuzz across languages | Same inputs → identical Go/Java/Python/C++ results (mind Python's unbounded int — mask to 64). |

The single most valuable test is the **scalar oracle**: recompute reachability/distance the slow, obvious way for small sizes and diff. It catches the overwhelming majority of cross-word and convention bugs.

The second most valuable check is **invariant assertions in the hot path during development** (compiled out in release): assert bit 0 of the subset-sum bitset is always set (the empty subset), assert the bitset width never exceeds the cap, and assert popcount is monotonically non-decreasing as items are folded in (subset-sum reachability only grows). These cheap invariants surface a corruption the moment it happens, rather than as a wrong final answer.

### 9.1 Property tests

```text
for random weights, random target t in [0, sum]:
    assert bitset_reachable(weights, t) == scalar_oracle(weights, t)
for random pattern (len<=64), random text:
    assert shift_or(text, pat) == naive_find_all(text, pat)
    assert myers(pat, text) == full_dp_levenshtein(pat, text)
invariants:
    popcount(B) == scalar count of reachable sums
    bit 0 of B always set (empty subset)
```

### 9.2 Production guardrails

Log the bitset *width* and word count per call so an accidental `T`-blowup (un-capped subset-sum) shows up as memory growth. Assert the pattern length `≤ 64` before single-word Shift-Or/Myers, with an explicit multi-word fallback. Mask Python ints to 64 bits in any code that must mirror fixed-width languages, or results silently diverge once a shift carries past bit 63.

### 9.3 Boundary-focused test matrix

The cross-word shift is the bug epicenter; test it at exactly these boundaries:

| Case | Why it breaks |
|------|---------------|
| `w` a multiple of 64 | `bitShift == 0` → `>> 64` UB in the carry term |
| `w` spanning two words (e.g. 70) | exercises both `wordShift` and `bitShift` carry |
| `w = 0` | no-op; must not corrupt `B` |
| `w` larger than the bitset | bits fall off the end; must not index out of bounds |
| top word partially used | high bits beyond `T` must stay clear |
| pattern length exactly 64 | `1 << 64` and `(1<<m)-1` overflow edge in masks |

A test suite hitting all six, plus random fuzz against the scalar oracle, catches essentially every cross-word and convention bug before production.

### 9.4 Differential testing across languages

Because the topic mandates Go, Java, and Python implementations, use them as cross-checks: run the same random inputs through all three and assert identical output. This catches Java `>>` vs `>>>` sign bugs, Python unbounded-int divergence (mask to 64), and Go unsigned-shift edge cases simultaneously. Differential testing across three independent implementations is a stronger correctness signal than any single-language test suite.

---

## 10. Failure Modes

### 10.1 The `>> 64` undefined-behavior trap

Computing the cross-word carry as `word >> (64 - bitShift)` when `bitShift == 0` is `>> 64`, undefined in C/C++/Go/Java (often a no-op or full-width, CPU-dependent). Mitigation: guard with `if bitShift > 0`; or special-case whole-word shifts.

### 10.2 Wrong shift direction in place

In-place left shift iterating low→high overwrites source words before reading them, silently dropping reachable sums. Mitigation: left shift goes high→low; right shift low→high.

### 10.3 Python's unbounded int diverging from fixed-width

`B << 1` in Python never overflows, so a port of Shift-Or/Myers that omits the `& ((1<<64)-1)` mask diverges from Go/Java once a bit passes position 63. Mitigation: mask to the intended width every step in mirror implementations.

### 10.4 Java `BitSet` has no `<<`

Attempting `B |= B << w` with `java.util.BitSet` does not compile — there is no shift. Mitigation: hand-roll `long[]` for shift-OR; reserve `BitSet` for set algebra.

### 10.5 Claiming a complexity-class improvement

Code review red flag: "this bitset makes it `O(n)`." No — it makes `O(n·T)` into `O(n·T/64)`, same class. Mitigation: state constant-factor explicitly; never relabel the Big-O.

### 10.6 Bit-packing non-boolean state

Trying to pack counts/weights one-per-bit and expecting `<<`/`|` to do arithmetic — inter-lane carries corrupt everything. Mitigation: use SWAR with masking, or real arithmetic; reserve pure bit-parallelism for 1-bit-per-lane booleans.

### 10.7 Sparse universe waste

A bitset over a `10^9` universe with a handful of set bits sweeps `10^9/64` words per pass — slower than a hash set. Mitigation: switch to a sparse set when density is low.

### 10.8 Pattern longer than the word, silently truncated

Single-word Shift-Or/Myers with `m > 64` drops the high pattern bits and reports wrong matches/distances with no error. Mitigation: assert `m ≤ 64` or implement the multi-word version.

### 10.9 Top-word garbage bits

A bitset of `T` bits whose top word is only partially used can carry stale high bits (above bit `T-1`) after a shift. If a later `popcount` or `ffs` reads those, it over-counts or returns a phantom element. Mitigation: mask the top word to `T mod 64` valid bits after any shift that could set bits beyond `T`.

### 10.10 Mismatched semiring (counting vs Boolean)

Reaching for a bitset to *count* (e.g. number of subsets reaching a sum) instead of to decide *feasibility* silently produces wrong results — OR saturates, it does not add. Mitigation: confirm the quantity is one bit (feasibility) before bit-packing; counting needs integer DP or FFT.

### 10.11 Forgetting that the shift consumes, then squares

In bitset Boolean matrix power, a common bug is squaring the matrix *before* multiplying it into the result on a set bit, or reusing a mutated matrix across the loop. Mitigation: follow the exact `R = mul(R,A); A = mul(A,A)` order and never alias `R` and `A`.

---

## 11. Summary

- **Representation drives everything.** `std::bitset<N>` for compile-time-bounded hot loops (it gives you `<<` for free); `dynamic_bitset`/Java `BitSet`/Python `int` for runtime-sized set algebra (but Java `BitSet` has **no** `<<`, so subset-sum needs a hand-rolled `long[]`); hand-rolled `uint64[]` when you need shift-OR control or a path to SIMD.
- **The real `/64` is gated by cache and alignment.** It is an instruction-count ceiling; the 8× density (vs `bool[]`) is half the practical benefit because it keeps data in L2. Stream sequentially; align for SIMD.
- **The `/64` matters only on a hot boolean loop whose class is already acceptable.** It is a constant factor — never a complexity-class change. Fix the algorithm before packing bits; use a hash set when the universe is sparse.
- **Myers' bit-vector edit distance** computes a whole DP column in `O(1)` word ops by encoding vertical differences as two bit vectors and reusing the ALU's **carry chain** as a parallel scan — the deepest bit-parallel DP, extensible to `m > 64` by blocking and to LCS.
- **SIMD widens the divisor** to 256/512; compilers auto-vectorize boolean word loops. **SWAR** generalizes the trick to multi-bit lanes with masking (parallel popcount, byte-wise compares) — the same family, one bit-width up.
- **Test against a scalar oracle.** Cross-word shifts, the `>> 64` UB, shift direction, match conventions, and Python's unbounded int are the failure modes that survive casual testing and only the oracle/property tests catch.

### Anti-pattern catalog (quick scan)

```text
B = B << w           # WRONG: forces taking every item; use B |= B << w
word >> (64 - 0)     # WRONG: >> 64 UB; guard bitShift > 0
for i := 0 .. n      # WRONG direction for in-place left shift; go high -> low
long x = b >> k      # WRONG in Java for unsigned moves; use >>>
bitset over 1e9, ~50 set bits   # WRONG: sparse; use a hash set
"this bitset makes it O(n)"     # WRONG: it's O(n*T/64), same class
pack counts one-per-bit          # WRONG: needs SWAR or real arithmetic
single-word Shift-Or, m = 100    # WRONG: m > 64 truncates; go multi-word
```

Each line is a real bug seen in review; the comment is the fix. Keep this list near your bit-parallel code.

### Decision summary

- **Subset-sum / knapsack reachability, fixed bound** → `std::bitset<N>` `B |= B << w`; runtime bound → hand-rolled `uint64[]`.
- **Set algebra, runtime width** → `dynamic_bitset` / Java `BitSet` / Python `int`.
- **Substring search, short pattern** → Shift-Or/Bitap; fuzzy → Bitap-with-errors.
- **Edit distance / LCS, pattern ≤ 64** → Myers' bit-vector; `> 64` → blocked Myers.
- **Boolean reachability / transitive closure** → bitset rows, OR-combine (`O(V³/64)`).
- **Wider parallelism on a proven-hot word loop** → let the compiler auto-vectorize; reach for AVX intrinsics only when assembly shows it is not.
- **Multi-bit lanes / arithmetic in a register** → SWAR with masking, not naive bit-packing.

### Production readiness checklist

Before shipping bit-parallel code, confirm:

- [ ] Representation chosen deliberately (`std::bitset` / `uint64[]` / `BitSet` / Python `int`) and documented.
- [ ] Cross-word shift tested at all boundaries (Section 9.3) and against a scalar oracle.
- [ ] Working set sized to fit cache where possible; universe capped (Section 6.3).
- [ ] Pattern-length / `m ≤ 64` assertions with multi-word fallback.
- [ ] Top-word masking after shifts; Java `>>>` not `>>`; Python masked to 64 if mirroring.
- [ ] Performance claim stated as constant-factor `/64`, with a measured number, never a Big-O change.
- [ ] Differential test across the three language implementations.

A bit-parallel routine that passes this list is both correct and honestly characterized — the two failure modes (silent corruption and overstated complexity) that this level exists to prevent.

References: Myers (1999) "A fast bit-vector algorithm for approximate string matching"; Baeza-Yates & Gonnet (Shift-Or/Bitap); Wu-Manber (1992) for approximate Bitap; *Hacker's Delight* (Warren) for SWAR and popcount; `std::bitset` / `boost::dynamic_bitset` docs; Intel intrinsics guide (AVX2/AVX-512, `VPOPCNTQ`); the `edlib` library for production Myers; sibling topics `01-bitwise-operators`, `13/06-bitmask-dp`, and `13/09-sum-over-subsets`, plus the Boolean-reachability material in `11-graphs`.
